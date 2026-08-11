import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { analyzeSku, QA_PROMPT_VERSION } from "./qa.js";
import { scrapeProduct } from "./scrape.js";
import { parseSettings, readSettings, type AppSettings } from "./settings.js";

type Job = {
  id: string;
  attribute_set: string | null;
  skus: unknown;
  tokens_used: any;
  time_taken: number | null;
  run_config: unknown;
};
type Snapshot = {
  sku: string;
  upload_attributes?: Record<string, unknown>;
  source?: { sap?: string; url?: string };
  raw_row?: Record<string, unknown>;
  attribute_set?: string;
  scraped_markdown?: string;
  scrape_status?: string;
};
type Queryable = Pick<Pool | PoolClient, "query">;

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

class FatalJobError extends Error {}

export function classifyJobError(error: unknown): "fatal" | "retryable" {
  const value = error as { status?: unknown; message?: unknown } | null;
  const status = Number(value?.status);
  if (Number.isInteger(status) && status >= 400 && status < 500 && status !== 408 && status !== 429) return "fatal";
  const message = typeof value?.message === "string" ? value.message : "";
  return /API key is not configured|LLM endpoint|public HTTPS|private or reserved|private or local|valid HTTPS URL/i.test(message) ? "fatal" : "retryable";
}

export function startJobWorker(pool: Pool, settingsKey: Buffer) {
  let stopping = false;
  const owner = randomUUID();

  // ponytail: one polling worker is deliberate for one VPS; use a queue service only for multiple replicas.
  const done = (async () => {
    while (!stopping) {
      const job = await claimJob(pool, owner);
      if (!job) {
        await wait(1000);
        continue;
      }
      try {
        await runJob(pool, settingsKey, owner, job, () => stopping);
      } catch (error) {
        const message = error instanceof FatalJobError ? error.message : "Worker failed unexpectedly";
        const code = typeof (error as any)?.code === "string" ? (error as any).code.slice(0, 50) : undefined;
        console.error({ message: "Job worker failed", jobId: job.id, code });
        await pool.query(`update jobs set status = 'failed', error = $2, current_sku = null,
          lease_owner = null, lease_expires_at = null, finished_at = now(), updated_at = now()
          where id = $1 and lease_owner = $3`, [job.id, message, owner]);
      }
    }
  })();
  return { stop: async () => { stopping = true; await done; } };
}

async function claimJob(pool: Pool, owner: string): Promise<Job | null> {
  const { rows } = await pool.query(`
    with candidate as (
      select id from jobs
      where status = 'queued' or (status = 'running' and lease_expires_at < now())
      order by queued_at nulls last, created_at
      for update skip locked limit 1
    )
    update jobs j set status = 'running', lease_owner = $1,
      lease_expires_at = now() + interval '5 minutes', started_at = coalesce(started_at, now()), updated_at = now()
    from candidate where j.id = candidate.id returning j.*
  `, [owner]);
  return rows[0] || null;
}

async function ensureResults(pool: Pool, job: Job) {
  const skus = Array.isArray(job.skus) ? job.skus.filter((sku): sku is string => typeof sku === "string") : [];
  if (!skus.length) return;
  const { rows } = await pool.query(`select sku, upload_attributes, source, raw_row, status, attribute_set,
    scraped_markdown, scrape_status from sku_data where sku = any($1::text[])`, [skus]);
  for (const row of rows) {
    await pool.query(`insert into job_results (job_id, sku, input_snapshot, status, scraped_markdown, scrape_status)
      values ($1, $2, $3, 'pending', $4, $5) on conflict (job_id, sku) do nothing`,
    [job.id, row.sku, row, row.scraped_markdown, row.scrape_status]);
  }
}

async function runJob(pool: Pool, settingsKey: Buffer, owner: string, job: Job, shuttingDown: () => boolean) {
  await ensureResults(pool, job);
  const liveSettings = await readSettings(pool, settingsKey);
  const runConfig = record(job.run_config);
  const settings = parseSettings(record(runConfig.settings), liveSettings, false);
  settings.apiKey = liveSettings.apiKey;
  if (!settings.apiKey) throw new FatalJobError("LLM API key is not configured");
  const rulesMarkdown = typeof runConfig.rulesMarkdown === "string" ? runConfig.rulesMarkdown : "";
  const promptVersion = typeof runConfig.promptVersion === "string" ? runConfig.promptVersion : QA_PROMPT_VERSION;
  if (promptVersion !== QA_PROMPT_VERSION) throw new FatalJobError("The queued prompt version is not supported by this server");

  const { rows: items } = await pool.query(`select * from job_results where job_id = $1
    and status not in ('completed', 'cannot_qa') order by sku`, [job.id]);
  const counts = await pool.query(`select count(*)::int as total,
    count(*) filter (where status in ('completed','cannot_qa'))::int as processed from job_results where job_id = $1`, [job.id]);
  let processed = Number(counts.rows[0].processed);
  const total = Number(counts.rows[0].total);
  let tokens = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  const started = Date.now();
  const heartbeat = setInterval(() => void pool.query(`update jobs set lease_expires_at = now() + interval '5 minutes', updated_at = now()
    where id = $1 and lease_owner = $2`, [job.id, owner]).catch(() => undefined), 30000);
  try {
    for (const item of items) {
      const state = (await pool.query("select stop_requested from jobs where id = $1 and lease_owner = $2", [job.id, owner])).rows[0];
      if (!state || state.stop_requested) {
        if (state?.stop_requested) await stopJob(pool, job.id, owner);
        return;
      }
      if (shuttingDown()) {
        await releaseJob(pool, job.id, owner);
        return;
      }

      const snapshot = item.input_snapshot as Snapshot;
      await pool.query(`update jobs set current_sku = $2, lease_expires_at = now() + interval '5 minutes', updated_at = now()
        where id = $1 and lease_owner = $3`, [job.id, item.sku, owner]);
      await pool.query("update job_results set status = 'running', error = null, updated_at = now() where job_id = $1 and sku = $2", [job.id, item.sku]);
      const skuStarted = Date.now();
      let markdown = item.scraped_markdown || snapshot.scraped_markdown || "";
      let scrapeStatus = item.scrape_status || snapshot.scrape_status || (markdown ? "success" : null);

      if (!markdown && !snapshot.source?.url) scrapeStatus = "skipped_no_url";
      if (!markdown && snapshot.source?.url) {
        try {
          const selector = await findSelector(pool, snapshot.source.url);
          markdown = await scrapeProduct(snapshot.source.url, settings.scraperTimeout, settings.maxPageContentLength, selector);
          scrapeStatus = "success";
        } catch {
          scrapeStatus = "failed";
        }
      }

      if (!markdown && !snapshot.source?.sap) {
        await cannotQaItem(pool, job.id, item.sku, "No trusted source was available for QA.", skuStarted, scrapeStatus);
        processed++;
        await updateProgress(pool, job.id, owner, processed, total);
        continue;
      }
      if (shuttingDown()) {
        await releaseJob(pool, job.id, owner);
        return;
      }

      let result: Awaited<ReturnType<typeof analyzeSku>> | undefined;
      let lastError: unknown;
      for (let attempt = 0; attempt <= settings.maxRetries; attempt++) {
        const attemptState = (await pool.query("select stop_requested from jobs where id = $1 and lease_owner = $2", [job.id, owner])).rows[0];
        if (!attemptState) return;
        if (attemptState.stop_requested) {
          await stopJob(pool, job.id, owner);
          return;
        }
        try {
          result = await analyzeSku(settings, {
            sku: item.sku,
            uploadAttributes: snapshot.upload_attributes || {},
            sap: snapshot.source?.sap,
            scrapedMarkdown: markdown,
            rulesMarkdown,
            promptVersion,
          });
          break;
        } catch (error) {
          lastError = error;
          if (shuttingDown()) {
            await releaseJob(pool, job.id, owner);
            return;
          }
          const retryState = (await pool.query("select stop_requested from jobs where id = $1 and lease_owner = $2", [job.id, owner])).rows[0];
          if (!retryState) return;
          if (retryState.stop_requested) {
            await stopJob(pool, job.id, owner);
            return;
          }
          if (classifyJobError(error) === "fatal") {
            const status = Number((error as any)?.status);
            const message = Number.isInteger(status) ? `LLM provider rejected the request (HTTP ${status}).` : "LLM configuration is invalid.";
            await failItem(pool, job.id, item.sku, message, skuStarted, markdown, scrapeStatus);
            throw new FatalJobError(message);
          }
          if (attempt === settings.maxRetries) break;
          await wait(Math.min(5000, 1000 * 2 ** attempt));
        }
      }

      if (!result) {
        const message = classifyJobError(lastError) === "fatal" ? "LLM configuration is invalid." : "QA failed after retrying a temporary provider or validation error.";
        await failItem(pool, job.id, item.sku, message, skuStarted, markdown, scrapeStatus);
      } else {
        await completeItem(pool, job.id, item.sku, result, skuStarted, markdown, scrapeStatus);
        tokens.prompt_tokens += result.tokens.prompt_tokens;
        tokens.completion_tokens += result.tokens.completion_tokens;
        tokens.total_tokens += result.tokens.total_tokens;
      }
      processed++;
      await updateProgress(pool, job.id, owner, processed, total);
    }

    const previous = job.tokens_used || {};
    const finalTokens = {
      prompt_tokens: Number(previous.prompt_tokens || 0) + tokens.prompt_tokens,
      completion_tokens: Number(previous.completion_tokens || 0) + tokens.completion_tokens,
      total_tokens: Number(previous.total_tokens || 0) + tokens.total_tokens,
    };
    const failures = Number((await pool.query("select count(*)::int as count from job_results where job_id = $1 and status = 'failed'", [job.id])).rows[0].count);
    await pool.query(`update jobs set status = $2, tokens_used = $3, time_taken = coalesce(time_taken, 0) + $4,
      error = $5, processed_count = $6, total_count = $7, current_sku = null, lease_owner = null, lease_expires_at = null,
      finished_at = now(), updated_at = now() where id = $1 and lease_owner = $8`,
    [job.id, failures ? "completed_with_errors" : "completed", finalTokens, Date.now() - started,
      failures ? "Some SKUs failed after safe retries." : null, processed, total, owner]);
  } finally {
    clearInterval(heartbeat);
  }
}

async function inTransaction(pool: Pool, action: (client: PoolClient) => Promise<void>) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await action(client);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function completeItem(pool: Pool, jobId: string, sku: string, result: Awaited<ReturnType<typeof analyzeSku>>, started: number, markdown: string, scrapeStatus: string | null) {
  const elapsed = Date.now() - started;
  const exportData = {
    qa_status: result.result.qa_status,
    summary: result.result.summary,
    confidence: result.result.confidence,
    issue_count: result.result.issue_count,
    issues: result.result.issues,
    last_job_id: jobId,
    updated_at: new Date().toISOString(),
  };
  await inTransaction(pool, async (client) => {
    await client.query(`update job_results set status = 'completed', qa_result = $3, export_data = $4,
      tokens_used = $5, time_taken = $6, error = null, scraped_markdown = $7, scrape_status = $8, updated_at = now()
      where job_id = $1 and sku = $2`, [jobId, sku, result.result, exportData, result.tokens, elapsed, markdown || null, scrapeStatus]);
    await client.query(`update sku_data set status = 'completed', qa_result = $2, export_data = $3, tokens_used = $4,
      time_taken = coalesce(time_taken, 0) + $5, error = null, scraped_markdown = coalesce($6, scraped_markdown),
      scrape_status = coalesce($7::scrape_status, scrape_status), last_job_id = $8 where sku = $1`,
    [sku, result.result, exportData, result.tokens, elapsed, markdown || null, scrapeStatus, jobId]);
  });
}

async function failItem(pool: Pool, jobId: string, sku: string, message: string, started: number, markdown: string, scrapeStatus: string | null) {
  const safeMessage = message.slice(0, 500);
  await inTransaction(pool, async (client) => {
    await client.query(`update job_results set status = 'failed', error = $3, time_taken = $4,
      scraped_markdown = $5, scrape_status = $6, updated_at = now() where job_id = $1 and sku = $2`,
    [jobId, sku, safeMessage, Date.now() - started, markdown || null, scrapeStatus]);
    await client.query(`update sku_data set status = 'failed', error = $2, last_job_id = $3,
      scraped_markdown = coalesce($4, scraped_markdown), scrape_status = coalesce($5::scrape_status, scrape_status)
      where sku = $1`, [sku, safeMessage, jobId, markdown || null, scrapeStatus]);
  });
}

async function cannotQaItem(pool: Pool, jobId: string, sku: string, reason: string, started: number, scrapeStatus: string | null) {
  await inTransaction(pool, async (client) => {
    await client.query(`update job_results set status = 'cannot_qa', error = $3, time_taken = $4,
      scrape_status = $5, updated_at = now() where job_id = $1 and sku = $2`,
    [jobId, sku, reason, Date.now() - started, scrapeStatus]);
    await client.query(`update sku_data set status = 'cannot_qa', error = $2,
      scrape_status = $3::scrape_status, last_job_id = $4 where sku = $1`, [sku, reason, scrapeStatus, jobId]);
  });
}

async function updateProgress(pool: Pool, jobId: string, owner: string, processed: number, total: number) {
  await pool.query(`update jobs set processed_count = $3, total_count = $4, updated_at = now()
    where id = $1 and lease_owner = $2`, [jobId, owner, processed, total]);
}

async function stopJob(pool: Pool, jobId: string, owner: string) {
  await pool.query("update job_results set status = 'pending', updated_at = now() where job_id = $1 and status = 'running'", [jobId]);
  await pool.query(`update jobs set status = 'stopped', error = 'Job stopped by the administrator.', current_sku = null,
    lease_owner = null, lease_expires_at = null, finished_at = now(), updated_at = now() where id = $1 and lease_owner = $2`, [jobId, owner]);
}

async function releaseJob(pool: Pool, jobId: string, owner: string) {
  await pool.query("update job_results set status = 'pending', updated_at = now() where job_id = $1 and status = 'running'", [jobId]);
  await pool.query(`update jobs set status = 'queued', error = null, current_sku = null, lease_owner = null,
    lease_expires_at = null, updated_at = now() where id = $1 and lease_owner = $2`, [jobId, owner]);
}

async function findSelector(pool: Pool, rawUrl: string) {
  const hostname = new URL(rawUrl).hostname.replace(/^www\./, "").toLowerCase();
  const { rows } = await pool.query("select * from site_selectors where enabled = true");
  return rows
    .filter((row) => hostname === row.website.replace(/^www\./, "") || hostname.endsWith(`.${row.website.replace(/^www\./, "")}`))
    .sort((a, b) => b.website.length - a.website.length)[0];
}
