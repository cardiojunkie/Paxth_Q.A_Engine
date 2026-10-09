import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { Express } from 'express';
import type { Pool, PoolClient } from 'pg';
import type { SkuData } from '../hooks/useCatalogData';
import { prepareQaInput } from '../lib/qaAgent';
import { buildQaRequest, parseQaResponse } from '../lib/qaRequest';
import { hasCompletedQa, unreviewedRunSnapshot, withoutRawQaResult } from '../lib/jobRunState';
import { normalizeSettings } from '../lib/providerSettings';
import { scrapeProductPage } from './scrapePipeline';
import { usableScrapedMarkdown } from '../lib/scrapeEvidence';
import { ProviderError } from '../lib/chatCompletion';
import { completeQa, getProviderCredentials, getProviderSettings } from './provider';
import { ApiError, mapCatalogRow, saveScrapedEvidence, saveScrapeFailure, scrapedMetadata, prepareJobCatalogOutputs } from './catalog';
import { CATALOG_PASS_THROUGH_HEADERS, catalogPassThroughValue, hasCompletedCatalog, prepareCatalogInput, parseCatalogResponse } from '../lib/catalogGeneration';
import { catalogMappings, catalogMappingFor, prepareCatalogOutputs } from '../lib/catalogFiles';

// ponytail: global mutation lock and one worker fit this backend; partition by job if throughput requires it.
export const JOB_MUTATION_LOCK = 73462190;
const WORKER_LOCK = 73462191;
const ACTIVE = ['queued', 'running', 'cancelling'];
const SKU_BUDGET_MS = 300_000;
const errorText = (error: unknown) => error instanceof Error ? error.message : 'Job execution failed';
class JobError extends Error { constructor(message: string, public status = 400) { super(message); } }

export async function transaction<T>(client: PoolClient, action: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    try {
      await client.query('SELECT pg_advisory_xact_lock($1)', [JOB_MUTATION_LOCK]);
      const result = await action();
      await client.query('COMMIT');
      return result;
    } catch (error) {
      // Retry only an explicitly aborted transaction; a lost COMMIT response may have committed.
      try { await client.query('ROLLBACK'); } catch { throw error; }
      const code = (error as { code?: string })?.code;
      if (attempt >= 3 || !['40001', '40P01'].includes(code ?? '')) throw error;
    }
  }
}

export async function initializeJobRuns(pool: Pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS job_runs (
      id text PRIMARY KEY, job_id text NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      request_id text NOT NULL, actor_id text NOT NULL, actor_name text NOT NULL,
      mode text NOT NULL CHECK (mode IN ('unfinished','all','single')), selected_sku text,
      status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','cancelling','completed','failed','cancelled')),
      configuration jsonb NOT NULL, owner_token text,
      created_at timestamptz NOT NULL DEFAULT now(), started_at timestamptz, finished_at timestamptz,
      error text, UNIQUE (job_id, request_id)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS job_runs_one_active ON job_runs(job_id)
      WHERE status IN ('queued','running','cancelling');
    CREATE TABLE IF NOT EXISTS job_run_items (
      run_id text NOT NULL REFERENCES job_runs(id) ON DELETE CASCADE, sku text NOT NULL,
      position integer NOT NULL, revision integer NOT NULL, snapshot jsonb NOT NULL,
      status text NOT NULL CHECK (status IN ('queued','running','completed','failed','cancelled','skipped')),
      attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 3),
      scrape_started boolean NOT NULL DEFAULT false,
      started_at timestamptz, finished_at timestamptz, result jsonb, error text,
      PRIMARY KEY (run_id, sku)
    );
  `);
  const index = await pool.query("SELECT indexdef FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'job_runs_one_active'");
  if (!index.rows[0]?.indexdef.includes('UNIQUE')) throw new Error('Job-run uniqueness constraint is unavailable');
}

const publicRun = (row: any) => ({
  id: row.id, jobId: row.job_id, actorId: row.actor_id, actorName: row.actor_name,
  jobType: row.configuration?.jobType || 'qa',
  catalogHeaders: row.configuration?.catalogMapping?.headers,
  catalogGroups: catalogMappings(row.configuration || {}).map(mapping => ({ attributeSet: mapping.attributeSet, headers: mapping.headers })),
  mode: row.mode, status: row.status, createdAt: row.created_at, startedAt: row.started_at,
  finishedAt: row.finished_at, error: row.error,
});

async function readRun(pool: Pool | PoolClient, id: string) {
  const { rows: [run] } = await pool.query('SELECT * FROM job_runs WHERE id=$1', [id]);
  if (!run) throw new JobError('Run does not exist', 404);
  const { rows } = await pool.query('SELECT * FROM job_run_items WHERE run_id=$1 ORDER BY position', [id]);
  const catalogOutputs = run.configuration.jobType === 'catalog' ? run.configuration.catalogOutputs ||
    prepareCatalogOutputs(rows.map(item => item.snapshot), catalogMappings(run.configuration), true) : undefined;
  return { ...publicRun(run), catalogOutputs, items: rows.map(item => ({
    sku: item.sku, status: item.status, attempts: item.attempts,
    startedAt: item.started_at, finishedAt: item.finished_at, error: item.error,
    snapshot: unreviewedRunSnapshot(item.snapshot),
    result: item.result ? { ...item.result, raw_row: withoutRawQaResult(item.result.raw_row || {}) } : null,
  })) };
}

export function validateRunRequest(body: any) {
  if (!body || typeof body.requestId !== 'string' || !/^[a-zA-Z0-9_-]{16,100}$/.test(body.requestId) ||
      !['unfinished', 'all', 'single'].includes(body.mode) ||
      (body.mode === 'single' && (typeof body.sku !== 'string' || !body.sku.trim())) ||
      (body.mode !== 'single' && body.sku !== undefined) ||
      Object.keys(body).some(key => !['requestId', 'mode', 'sku'].includes(key))) {
    throw new JobError('Supply requestId, mode (unfinished/all/single), and sku only for a single-SKU run');
  }
  return { requestId: body.requestId, mode: body.mode as 'unfinished' | 'all' | 'single', sku: body.sku as string | undefined };
}

export function registerJobRunRoutes(app: Express, pool: Pool) {
  app.post('/api/jobs/:id/runs', async (req, res) => {
    let client: PoolClient | undefined;
    try {
      const input = validateRunRequest(req.body);
      client = await pool.connect();
      const id = await transaction(client, async () => {
        const { rows: [existing] } = await client!.query('SELECT * FROM job_runs WHERE job_id=$1 AND request_id=$2', [req.params.id, input.requestId]);
        if (existing) {
          if (existing.mode !== input.mode || existing.selected_sku !== (input.sku ?? null) || existing.actor_id !== res.locals.user.id) {
            throw new JobError('This requestId was already used for a different request', 409);
          }
          return existing.id;
        }
        const { rows: [job] } = await client!.query('SELECT * FROM jobs WHERE id=$1 FOR UPDATE', [req.params.id]);
        if (!job) throw new JobError('Job does not exist', 404);
        if ((await client!.query('SELECT 1 FROM job_runs WHERE job_id=$1 AND status=ANY($2::text[])', [job.id, ACTIVE])).rowCount) {
          throw new JobError('This job already has an active run', 409);
        }
        const { rows: catalog } = await client!.query('SELECT * FROM sku_data WHERE sku=ANY($1::text[])', [job.skus]);
        const rowsBySku = new Map(catalog.map(row => [row.sku, row]));
        if (!Array.isArray(job.skus) || job.skus.some((sku: string) => !rowsBySku.has(sku))) throw new JobError('A job SKU no longer exists', 409);
        if (input.mode === 'single' && !job.skus.includes(input.sku)) throw new JobError('The SKU is not in this job');
        const jobType = job.job_type || 'qa';
        const prepared = jobType === 'catalog' ? await prepareJobCatalogOutputs(client!, job.skus.map((sku: string) => rowsBySku.get(sku)), !job.catalog_outputs?.shipping) : undefined;
        getProviderCredentials();
        const settings = await getProviderSettings(client!);
        const { rows: [memory] } = await client!.query("SELECT memory FROM qa_agent_settings WHERE id='default'");
        const { rows: sets } = await client!.query('SELECT id,name,rules_markdown AS "rulesMarkdown",catalog_headers AS "catalogHeaders" FROM attribute_sets');
        if (!memory?.memory) throw new JobError('QA memory is unavailable', 503);
        const configuration = { settings, qaAgentMemory: memory.memory, attributeSets: sets, jobType,
          catalogMappings: prepared?.mappings, catalogOutputs: prepared?.outputs,
          catalogMapping: prepared?.mappings.length === 1 ? prepared.mappings[0] : undefined };
        const priorCatalog = jobType === 'catalog' ? (await client!.query(`SELECT DISTINCT ON (i.sku) i.sku,i.result,
          jsonb_build_object('catalogMappings',r.configuration->'catalogMappings','catalogMapping',r.configuration->'catalogMapping') AS configuration
          FROM job_run_items i JOIN job_runs r ON r.id=i.run_id
          WHERE r.job_id=$1 ORDER BY i.sku,r.created_at DESC,r.id DESC`, [job.id])).rows : [];
        const priorBySku = new Map(priorCatalog.map(previous => [previous.sku, previous]));
        const runId = randomUUID();
        await client!.query('INSERT INTO job_runs(id,job_id,request_id,actor_id,actor_name,mode,selected_sku,configuration) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
          [runId, job.id, input.requestId, res.locals.user.id, res.locals.user.username, input.mode, input.sku ?? null, JSON.stringify(configuration)]);
        for (const [position, sku] of job.skus.entries()) {
          const row = rowsBySku.get(sku)!;
          const snapshot = mapCatalogRow(row);
          const previous = priorBySku.get(sku);
          const mapping = prepared?.mappings.find(mapping => mapping.attributeSet === snapshot.attribute_set);
          const previousMapping = previous && catalogMappings(previous.configuration).find(mapping => mapping.attributeSet === snapshot.attribute_set);
          const catalogResult = previous?.result && Array.isArray(previous.result.catalog_state?.cellWarnings) && previousMapping?.rulesMarkdown === mapping?.rulesMarkdown &&
            previous.result.attribute_set === snapshot.attribute_set &&
            previousMapping?.attributeSet === mapping?.attributeSet &&
            JSON.stringify(previousMapping?.headers) === JSON.stringify(mapping?.headers) &&
            JSON.stringify(previous.result.catalog_state?.headers) === JSON.stringify(mapping?.headers) &&
            CATALOG_PASS_THROUGH_HEADERS.every(header => previous.result.catalog_state?.row?.[header] === catalogPassThroughValue(snapshot, header)) &&
            previous.result.catalog_state?.jobId === job.id && previous.result.catalog_state?.revision === row.revision &&
            hasCompletedCatalog(previous.result) ? previous.result : null;
          const completed = jobType === 'catalog' ? Boolean(catalogResult) : hasCompletedQa(snapshot);
          const selected = input.mode === 'all' || (input.mode === 'single' ? sku === input.sku : !completed);
          const priorResult = !selected && completed ? jobType === 'catalog' ? catalogResult : snapshot : null;
          await client!.query('INSERT INTO job_run_items(run_id,sku,position,revision,snapshot,status,result) VALUES($1,$2,$3,$4,$5,$6,$7)',
            [runId, sku, position, row.revision, JSON.stringify(unreviewedRunSnapshot(snapshot, false)), selected ? 'queued' : 'skipped', priorResult ? JSON.stringify(priorResult) : null]);
        }
        await client!.query("UPDATE jobs SET status='running', error=NULL,catalog_outputs=COALESCE($2::jsonb,catalog_outputs),attribute_set=CASE WHEN $2::jsonb IS NOT NULL THEN $3::text ELSE attribute_set END WHERE id=$1",
          [job.id, prepared ? JSON.stringify(prepared.outputs) : null, prepared?.mappings.length === 1 ? prepared.mappings[0].attributeSet : null]);
        return runId;
      });
      res.status(202).json(await readRun(client, id));
    } catch (error) {
      const known = error instanceof JobError || error instanceof ProviderError || error instanceof ApiError;
      if (!known) {
        const code = (error as { code?: string })?.code;
        console.error('Job start database operation failed.', typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code) ? code : 'unavailable');
      }
      res.status(known ? error.status : 503).json({ error: known ? error.message : 'Could not start the run. The database is unavailable; retry using the same request.' });
    }
    finally { client?.release(); }
  });
  app.get('/api/jobs/:id/runs', async (req, res) => {
    try {
      const { rows } = await pool.query('SELECT * FROM job_runs WHERE job_id=$1 ORDER BY created_at DESC', [req.params.id]);
      res.json(rows.map(publicRun));
    } catch { res.status(503).json({ error: 'Could not load run history' }); }
  });
  app.get('/api/job-runs/:id', async (req, res) => {
    try { res.json(await readRun(pool, String(req.params.id))); }
    catch (error) { res.status(error instanceof JobError ? error.status : 503).json({ error: error instanceof JobError ? error.message : 'Could not load progress' }); }
  });
  app.post('/api/job-runs/:id/cancel', async (req, res) => {
    let client: PoolClient | undefined;
    try {
      client = await pool.connect();
      await transaction(client, async () => {
        const { rows: [run] } = await client!.query('SELECT * FROM job_runs WHERE id=$1 FOR UPDATE', [req.params.id]);
        if (!run) throw new JobError('Run does not exist', 404);
        if (run.actor_id !== res.locals.user.id && res.locals.user.role !== 'admin') throw new JobError('You can only stop your own runs', 403);
        if (ACTIVE.includes(run.status)) await client!.query("UPDATE job_runs SET status='cancelling' WHERE id=$1", [run.id]);
      });
      res.json(await readRun(client, String(req.params.id)));
    } catch (error) { res.status(error instanceof JobError ? error.status : 503).json({ error: error instanceof JobError ? error.message : 'Could not cancel the run' }); }
    finally { client?.release(); }
  });
}

const cleanUsage = (usage: any) => Object.fromEntries(['prompt_tokens', 'completion_tokens', 'total_tokens'].map(key =>
  [key, Number.isSafeInteger(usage?.[key]) && usage[key] >= 0 ? usage[key] : 0]));

function withResult(snapshot: SkuData, qa: any, usage: any, elapsed: number, jobId: string): SkuData {
  return { ...snapshot, status: qa.qa_status === 'fail' ? 'failed' : 'completed', error: null, qa_stale: false,
    qa_result: qa, last_job_id: jobId,
    tokensUsed: cleanUsage(usage) as SkuData['tokensUsed'], timeTaken: elapsed,
    export_data: { ...qa, last_job_id: jobId, updated_at: new Date().toISOString() },
  };
}

async function assertOwner(client: PoolClient, runId: string, owner: string, allowCancel = false) {
  const { rows: [run] } = await client.query('SELECT * FROM job_runs WHERE id=$1 AND owner_token=$2 FOR UPDATE', [runId, owner]);
  if (!run || !['running', ...(allowCancel ? ['cancelling'] : [])].includes(run.status)) throw new JobError('Run ownership lost or cancelled', 409);
  return run;
}

async function persistItem(client: PoolClient, run: any, owner: string, item: any, result: SkuData) {
  await transaction(client, async () => {
    await assertOwner(client, run.id, owner);
    await client.query("UPDATE job_run_items SET status=$3,result=$4,error=$5,finished_at=now() WHERE run_id=$1 AND sku=$2 AND status='running'",
      [run.id, item.sku, result.error ? 'failed' : 'completed', JSON.stringify(result), result.error ?? null]);
    // A result remains in history even when newer evidence prevents updating the live catalog.
    if (run.configuration.jobType === 'catalog') {
      await client.query('UPDATE sku_data SET catalog_state=$3 WHERE sku=$1 AND revision=$2',
        [item.sku, item.revision, JSON.stringify(result.catalog_state)]);
      return;
    }
    await client.query(`UPDATE sku_data SET status=$3,qa_result=COALESCE($4::jsonb,qa_result),export_data=COALESCE($5::jsonb,export_data),last_job_id=$6,
      tokens_used=$7,time_taken=$8,error=$9,qa_revision=CASE WHEN $4::jsonb IS NOT NULL THEN $2 ELSE qa_revision END
      WHERE sku=$1 AND revision=$2`, [item.sku, item.revision, result.status,
      result.qa_result ? JSON.stringify(result.qa_result) : null, result.export_data ? JSON.stringify(result.export_data) : null, run.job_id,
      result.tokensUsed ? JSON.stringify(result.tokensUsed) : null, result.timeTaken ?? 0, result.error ?? null]);
  });
}

async function finishRun(client: PoolClient, run: any, owner: string) {
  await transaction(client, async () => {
    const current = await assertOwner(client, run.id, owner, true);
    if (current.status === 'cancelling') await client.query("UPDATE job_run_items SET status='cancelled',finished_at=now(),error='Cancelled' WHERE run_id=$1 AND status IN ('queued','running')", [run.id]);
    const { rows: items } = await client.query('SELECT * FROM job_run_items WHERE run_id=$1 ORDER BY position', [run.id]);
    const failed = items.some(item => item.status === 'failed');
    const cancelled = current.status === 'cancelling';
    const status = cancelled ? 'cancelled' : failed ? 'failed' : 'completed';
    const error = cancelled ? 'Run cancelled; committed results were preserved.' : failed ? 'Some SKUs failed to process.' : null;
    await client.query('UPDATE job_runs SET status=$2,error=$3,finished_at=now(),owner_token=NULL WHERE id=$1', [run.id, status, error]);
    const effective = items.map(item => item.result || unreviewedRunSnapshot(item.snapshot));
    const jobStatus = failed ? 'failed' : effective.every(run.configuration.jobType === 'catalog' ? hasCompletedCatalog : hasCompletedQa) ? 'completed' : 'pending';
    const usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
    for (const item of items.filter(item => item.status !== 'skipped')) for (const key of Object.keys(usage)) usage[key] += cleanUsage(item.result?.tokensUsed)[key];
    await client.query(`UPDATE jobs SET status=$2,error=$3,time_taken=LEAST(2147483647,COALESCE(time_taken,0)::bigint+$4::bigint),
      tokens_used=jsonb_build_object('prompt_tokens',COALESCE((tokens_used->>'prompt_tokens')::bigint,0)+$5::bigint,
      'completion_tokens',COALESCE((tokens_used->>'completion_tokens')::bigint,0)+$6::bigint,
      'total_tokens',COALESCE((tokens_used->>'total_tokens')::bigint,0)+$7::bigint) WHERE id=$1`,
      [run.job_id, jobStatus, error, Math.min(2147483647, Date.now() - new Date(current.started_at).getTime()), usage.prompt_tokens, usage.completion_tokens, usage.total_tokens]);
  });
}

async function executeRun(client: PoolClient, pool: Pool, run: any, owner: string, ownership: AbortSignal, scrape: typeof scrapeProductPage) {
  const settings = normalizeSettings(run.configuration.settings);
  const isCatalog = run.configuration.jobType === 'catalog';
  while (!ownership.aborted) {
    const item = await transaction(client, async () => {
      const current = await assertOwner(client, run.id, owner, true);
      if (current.status === 'cancelling') return null;
      const { rows: [next] } = await client.query("SELECT * FROM job_run_items WHERE run_id=$1 AND status IN ('queued','running') ORDER BY position LIMIT 1", [run.id]);
      if (!next) return null;
      const { rows: [claimed] } = await client.query("UPDATE job_run_items SET status='running',started_at=COALESCE(started_at,now()) WHERE run_id=$1 AND sku=$2 RETURNING *", [run.id, next.sku]);
      return claimed;
    });
    if (!item) { await finishRun(client, run, owner); return; }
    const cancelled = new AbortController();
    let checking = false;
    const monitor = setInterval(async () => {
      if (checking) return;
      checking = true;
      try {
        const { rows: [current] } = await pool.query('SELECT status,owner_token FROM job_runs WHERE id=$1', [run.id]);
        if (current?.status !== 'running' || current?.owner_token !== owner) cancelled.abort(new Error('Run cancelled or ownership lost'));
      } catch { /* Keep a paid response while its save retries; the dedicated connection fences ownership. */ }
      finally { checking = false; }
    }, 500);
    const start = new Date(item.started_at).getTime();
    const remaining = Math.max(1, start + SKU_BUDGET_MS - Date.now());
    const execution = AbortSignal.any([ownership, cancelled.signal, AbortSignal.timeout(remaining)]);
    let snapshot: SkuData = unreviewedRunSnapshot(item.snapshot);
    let result: SkuData;
    let catalogTokens: SkuData['tokensUsed'];
    try {
      if (Date.now() >= start + SKU_BUDGET_MS) throw new Error('SKU exceeded its five-minute execution budget');
      if (snapshot.source.url && !usableScrapedMarkdown(snapshot)) {
        // One retrieval per durable item; a crash requires an explicit rerun.
        if (!item.scrape_started) {
          await transaction(client, async () => {
            await assertOwner(client, run.id, owner);
            await client.query('UPDATE job_run_items SET scrape_started=true WHERE run_id=$1 AND sku=$2', [run.id, item.sku]);
          });
          let retrieved: Awaited<ReturnType<typeof scrapeProductPage>> | undefined;
          let retrievalFailure: unknown;
          try { retrieved = await scrape(snapshot.source.url, execution, settings); }
          catch (error) {
            execution.throwIfAborted();
            retrievalFailure = error;
            snapshot = { ...snapshot, scrape_status: 'failed', scrape_error: errorText(error) };
          }
          const persisted = await transaction(client, async () => {
            await assertOwner(client, run.id, owner);
            execution.throwIfAborted();
            const saved = retrieved
              ? await saveScrapedEvidence(client, item.sku, item.revision, retrieved)
              : await saveScrapeFailure(client, item.sku, item.revision, errorText(retrievalFailure));
            // A newer live revision keeps this evidence in run history only.
            const nextRevision = saved && retrieved ? saved.revision : item.revision;
            const nextSnapshot: SkuData = retrieved ? { ...snapshot, revision: nextRevision, scraped_markdown: retrieved.markdown,
              scrape_metadata: saved?.scrape_metadata || scrapedMetadata(retrieved),
              scrape_status: 'success', scrape_error: null } : snapshot;
            await client.query('UPDATE job_run_items SET snapshot=$3,revision=$4 WHERE run_id=$1 AND sku=$2', [run.id, item.sku, JSON.stringify(nextSnapshot), nextRevision]);
            execution.throwIfAborted();
            return { snapshot: nextSnapshot, revision: nextRevision };
          });
          snapshot = persisted.snapshot;
          item.revision = persisted.revision;
          if (retrievalFailure && !snapshot.source.sap?.trim()) throw retrievalFailure;
        } else if (!snapshot.source.sap?.trim()) throw new Error(snapshot.scrape_error || 'Scraping was interrupted. Rerun this SKU to collect evidence.');
      }
      const input = isCatalog
        ? prepareCatalogInput(snapshot, catalogMappingFor(run.configuration, snapshot.attribute_set), settings.maxPageContentLength)
        : prepareQaInput(snapshot, run.configuration.attributeSets, run.configuration.qaAgentMemory, settings.maxPageContentLength);
      const payload = buildQaRequest(settings, input).payload;
      // DeepSeek thinking produced 30-second gateway failures for catalog rows; QA keeps its existing effort.
      if (isCatalog && payload.model === 'deepseek/deepseek-v4.1-flash') payload.reasoning_effort = 'none';
      const response = await completeQa(payload, execution, {
        taskLabel: isCatalog ? 'Catalog' : 'QA',
        attempts: item.attempts,
        lastError: item.error,
        beforeAttempt: async attempt => {
          execution.throwIfAborted();
          await transaction(client, async () => {
            await assertOwner(client, run.id, owner);
            await client.query('UPDATE job_run_items SET attempts=$3 WHERE run_id=$1 AND sku=$2', [run.id, item.sku, attempt]);
          });
        },
        onAttemptError: async (attempt, error) => {
          execution.throwIfAborted();
          await transaction(client, async () => {
            await assertOwner(client, run.id, owner);
            await client.query('UPDATE job_run_items SET error=$3 WHERE run_id=$1 AND sku=$2',
              [run.id, item.sku, `${isCatalog ? 'Catalog' : 'QA'} attempt ${attempt}: ${error.message}`]);
          });
        },
      });
      if (isCatalog) catalogTokens = cleanUsage(response.usage) as SkuData['tokensUsed'];
      if (isCatalog) {
        const catalog = parseCatalogResponse(response, input as ReturnType<typeof prepareCatalogInput>);
        const timeTaken = Date.now() - start;
        result = { ...snapshot, status: 'completed', error: null, tokensUsed: catalogTokens, timeTaken,
          catalog_state: { ...catalog, headers: catalogMappingFor(run.configuration, snapshot.attribute_set).headers, status: 'completed',
            revision: item.revision, jobId: run.job_id, tokensUsed: catalogTokens, timeTaken } };
      } else {
        result = withResult(snapshot, parseQaResponse(response, input as ReturnType<typeof prepareQaInput>), response.usage, Date.now() - start, run.job_id);
      }
    } catch (error) {
      if (ownership.aborted) { clearInterval(monitor); throw error; }
      if (cancelled.signal.aborted) { clearInterval(monitor); continue; }
      result = { ...snapshot, status: 'failed', qa_result: undefined, export_data: undefined,
        ...(isCatalog && catalogTokens ? { tokensUsed: catalogTokens } : {}),
        error: execution.aborted ? 'SKU exceeded its five-minute execution budget' : errorText(error), timeTaken: Date.now() - start };
      if (isCatalog) result.catalog_state = { status: 'failed', headers: catalogMappingFor(run.configuration, snapshot.attribute_set).headers,
        warnings: [], revision: item.revision, jobId: run.job_id, error: result.error, timeTaken: result.timeTaken, tokensUsed: catalogTokens };
    }
    try {
      // Keep the paid response in memory while retrying only its database commit.
      while (!ownership.aborted && !cancelled.signal.aborted) {
        try { await persistItem(client, run, owner, item, result); break; }
        catch (error) {
          if (error instanceof JobError) throw error;
          console.error('Job result save failed; retaining response and retrying the database commit.');
          await delay(1000, undefined, { signal: ownership });
        }
      }
    } finally { clearInterval(monitor); }
  }
}

export function startJobWorker(pool: Pool, scrape = scrapeProductPage): () => Promise<void> {
  const stop = new AbortController();
  const task = (async () => {
    while (!stop.signal.aborted) {
      let client: PoolClient | undefined;
      const lost = new AbortController();
      const signal = AbortSignal.any([stop.signal, lost.signal]);
      const onLoss = () => lost.abort(new Error('Worker database ownership lost'));
      try {
        client = await pool.connect();
        client.on('error', onLoss);
        client.on('end', onLoss);
        const { rows: [lock] } = await client.query('SELECT pg_try_advisory_lock($1) AS acquired', [WORKER_LOCK]);
        if (lock.acquired) {
          const owner = randomUUID();
          const run = await transaction(client, async () => {
            const { rows: [next] } = await client!.query('SELECT * FROM job_runs WHERE status=ANY($1::text[]) ORDER BY created_at LIMIT 1 FOR UPDATE', [ACTIVE]);
            if (!next) return null;
            const { rows: [claimed] } = await client!.query("UPDATE job_runs SET status=CASE WHEN status='cancelling' THEN status ELSE 'running' END,owner_token=$2,started_at=COALESCE(started_at,now()) WHERE id=$1 RETURNING *", [next.id, owner]);
            return claimed;
          });
          if (run) await executeRun(client, pool, run, owner, signal, scrape);
        }
      } catch (error) {
        if (!stop.signal.aborted) console.error('Job worker paused; unfinished items will resume after database recovery.');
      } finally {
        if (client) {
          await client.query('SELECT pg_advisory_unlock($1)', [WORKER_LOCK]).catch(() => {});
          client.removeListener('error', onLoss); client.removeListener('end', onLoss);
          client.release(lost.signal.aborted);
        }
      }
      await delay(500, undefined, { signal: stop.signal }).catch(() => {});
    }
  })();
  return async () => { stop.abort(new Error('Server shutting down')); await task; };
}
