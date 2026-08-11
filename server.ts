import "dotenv/config";
import { binaryInfo } from "cloakbrowser";
import { randomUUID, timingSafeEqual } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import express, { type NextFunction, type Request, type Response } from "express";
import type { Pool, PoolClient } from "pg";
import { clearSessionCookie, createSession, loadAuthConfig, readSession, requireSameOrigin, requireSession, setSessionCookie, verifyPassword, type AuthConfig } from "./src/server/auth.js";
import { createPool, verifyMigrations } from "./src/server/database.js";
import { callLlm, QA_PROMPT_VERSION } from "./src/server/qa.js";
import { requirePublicHttpsUrl } from "./src/server/outbound.js";
import { defaultSettings, loadSettingsKey, parseSettings, publicSettings, readSettings, writeSettings } from "./src/server/settings.js";
import { startJobWorker } from "./src/server/worker.js";

type Db = Pool | PoolClient;
type Deps = { pool: Pool; auth: AuthConfig; settingsKey: Buffer };
class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }
const route = (handler: (request: Request, response: Response) => Promise<unknown>) =>
  (request: Request, response: Response, next: NextFunction) => void handler(request, response).catch(next);
const object = (value: unknown): Record<string, any> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new HttpError(400, "JSON object required");
  return value as Record<string, any>;
};
const requiredText = (value: unknown, name: string, max = 500) => {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new HttpError(400, `${name} is required`);
  return value.trim();
};
const boundedRecord = (value: unknown, name: string) => {
  const result = object(value);
  const visit = (item: unknown, depth: number) => {
    if (depth > 10) throw new HttpError(400, `${name} is too deeply nested`);
    if (typeof item === "string" && item.length > 10000) throw new HttpError(400, `${name} contains an oversized value`);
    if (Array.isArray(item)) item.forEach((child) => visit(child, depth + 1));
    else if (item && typeof item === "object") Object.values(item).forEach((child) => visit(child, depth + 1));
  };
  visit(result, 0);
  return result;
};
const stringArray = (value: unknown, name: string, max = 10000) => {
  if (!Array.isArray(value) || !value.length || value.length > max || value.some((item) => typeof item !== "string" || !item.trim())) {
    throw new HttpError(400, `${name} must be a non-empty string array`);
  }
  return [...new Set(value.map((item) => item.trim()))];
};
const requiredLogId = (value: unknown) => typeof value === "string" && /^[A-Za-z0-9._:-]{1,100}$/.test(value) ? value : randomUUID();

function mapJob(row: any) {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    attribute_set: row.attribute_set || "",
    skus: Array.isArray(row.skus) ? row.skus : [],
    status: row.status,
    tokensUsed: row.tokens_used || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    timeTaken: row.time_taken || 0,
    error: row.error || null,
    progress: { processed: row.processed_count || 0, total: row.total_count || 0, currentSku: row.current_sku || "" },
    queuedAt: row.queued_at || null,
    startedAt: row.started_at || null,
    finishedAt: row.finished_at || null,
  };
}

function mapCatalog(row: any) {
  return {
    sku: row.sku,
    upload_attributes: row.upload_attributes || {},
    source: row.source || {},
    raw_row: row.raw_row || {},
    status: row.status,
    attribute_set: row.attribute_set || row.attribute_set_id || undefined,
    scraped_markdown: row.scraped_markdown || undefined,
    scrape_status: row.scrape_status || undefined,
    tokensUsed: row.tokens_used || undefined,
    timeTaken: row.time_taken || undefined,
    error: row.error || null,
    qa_result: row.qa_result || undefined,
    export_data: row.export_data || undefined,
    last_job_id: row.last_job_id || undefined,
  };
}

function snapshotCatalog(row: any) {
  return {
    sku: row.sku,
    upload_attributes: row.upload_attributes || {},
    source: row.source || {},
    raw_row: row.raw_row || {},
    attribute_set: row.attribute_set || row.attribute_set_id || undefined,
    scraped_markdown: row.scraped_markdown || undefined,
    scrape_status: row.scrape_status || undefined,
  };
}

function configuredBrowserVersion(env: NodeJS.ProcessEnv = process.env) {
  const version = env.CLOAKBROWSER_VERSION?.trim();
  if (env.NODE_ENV === "production") {
    if (!env.CLOAKBROWSER_LICENSE_KEY?.trim()) throw new Error("CLOAKBROWSER_LICENSE_KEY is required in production");
    if (!version || !/^\d+(?:\.\d+){3,4}$/.test(version)) throw new Error("CLOAKBROWSER_VERSION must be an exact dotted numeric version in production");
    if (env.CLOAKBROWSER_AUTO_UPDATE !== "false") throw new Error("CLOAKBROWSER_AUTO_UPDATE must be false in production");
  }
  return version;
}

export function createApp({ pool, auth, settingsKey }: Deps) {
  const app = express();
  app.set("trust proxy", 1);
  app.disable("x-powered-by");
  app.use(requireSameOrigin(auth));
  app.use("/api/catalog", express.json({ limit: "20mb", strict: true }));
  app.use("/api/legacy-import", express.json({ limit: "5mb", strict: true }));
  app.use(["/api/auth", "/api/settings"], express.json({ limit: "16kb", strict: true }));
  app.use(express.json({ limit: "1mb", strict: true }));

  app.get("/healthz", (_request, response) => response.json({ status: "ok" }));
  app.get("/readyz", route(async (_request, response) => {
    try {
      await verifyMigrations(pool);
      const expectedVersion = configuredBrowserVersion();
      const browser = binaryInfo(expectedVersion);
      if (!browser.installed || (expectedVersion && browser.version !== expectedVersion)) throw new Error("Expected browser binary is not installed");
      response.json({ status: "ready" });
    } catch {
      response.status(503).json({ status: "not_ready" });
    }
  }));

  // ponytail: process-local login throttling is sufficient for one VPS process.
  const failures = new Map<string, { count: number; reset: number }>();
  app.post("/api/auth/login", route(async (request, response) => {
    const body = object(request.body);
    const username = requiredText(body.username, "username", 200);
    if (typeof body.password !== "string" || !body.password.length || body.password.length > 4096) throw new HttpError(400, "password is required");
    const password = body.password;
    const ip = request.ip || "unknown";
    const now = Date.now();
    const attempt = failures.get(ip);
    if (attempt && attempt.reset > now && attempt.count >= 5) throw new HttpError(429, "Too many login attempts; try again later");
    const validPassword = await verifyPassword(auth, password);
    const left = Buffer.from(username);
    const right = Buffer.from(auth.username);
    const validUsername = left.length === right.length && timingSafeEqual(left, right);
    if (!validUsername || !validPassword) {
      failures.set(ip, { count: attempt?.reset && attempt.reset > now ? attempt.count + 1 : 1, reset: now + 15 * 60 * 1000 });
      throw new HttpError(401, "Invalid username or password");
    }
    failures.delete(ip);
    setSessionCookie(response, auth, createSession(auth));
    response.status(204).end();
  }));
  app.get("/api/auth/session", (request, response) => {
    const user = readSession(auth, request);
    if (!user) return response.status(401).json({ error: { code: "authentication_required", message: "Authentication required" } });
    response.json({ authenticated: true, username: user.username });
  });
  app.post("/api/auth/logout", requireSession(auth), (_request, response) => {
    clearSessionCookie(response, auth);
    response.status(204).end();
  });

  app.use("/api", requireSession(auth));

  app.get("/api/catalog", route(async (_request, response) => {
    response.json((await pool.query("select * from sku_data order by id")).rows.map(mapCatalog));
  }));
  app.post("/api/catalog", route(async (request, response) => {
    if (!Array.isArray(request.body) || !request.body.length || request.body.length > 5000) throw new HttpError(400, "Catalog body must be a non-empty array of at most 5,000 rows");
    const client = await pool.connect();
    try {
      await client.query("begin");
      for (const input of request.body) {
        const item = object(input);
        const sku = requiredText(item.sku, "sku", 500);
        const uploadAttributes = item.upload_attributes === undefined ? {} : boundedRecord(item.upload_attributes, "upload_attributes");
        const sourceInput = item.source === undefined ? {} : boundedRecord(item.source, "source");
        const rawRow = item.raw_row === undefined ? {} : boundedRecord(item.raw_row, "raw_row");
        const sap = sourceInput.sap === undefined || sourceInput.sap === "" ? undefined : requiredText(sourceInput.sap, "source.sap", 10000);
        const rawUrl = sourceInput.url === undefined || sourceInput.url === "" ? undefined : requiredText(sourceInput.url, "source.url", 2048);
        let url: string | undefined;
        if (rawUrl) {
          try { url = (await requirePublicHttpsUrl(rawUrl)).toString(); }
          catch { throw new HttpError(400, `source.url is not a public HTTPS URL for SKU ${sku}`); }
        }
        const source = { ...(sap ? { sap } : {}), ...(url ? { url } : {}) };
        const attributeSet = item.attribute_set === undefined || item.attribute_set === null ? null : requiredText(item.attribute_set, "attribute_set", 500);
        const status = source.sap || source.url ? "ready" : "cannot_qa";
        await client.query(`insert into sku_data (sku, upload_attributes, source, raw_row, status, attribute_set, attribute_set_id)
          values ($1,$2,$3,$4,$5::qa_status,$6,$6)
          on conflict (sku) do update set upload_attributes=excluded.upload_attributes, source=excluded.source,
          raw_row=excluded.raw_row, attribute_set=coalesce(excluded.attribute_set,sku_data.attribute_set),
          attribute_set_id=coalesce(excluded.attribute_set_id,sku_data.attribute_set_id)`,
        [sku, uploadAttributes, source, rawRow, status, attributeSet]);
      }
      await client.query("commit");
      response.status(201).json({ success: true });
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally { client.release(); }
  }));
  app.delete("/api/catalog", route(async (request, response) => {
    const body = object(request.body);
    if (body.scope === "all") await pool.query("delete from sku_data");
    else if (body.scope === undefined) await pool.query("delete from sku_data where sku = any($1::text[])", [stringArray(body.skus, "skus")]);
    else throw new HttpError(400, "scope must be 'all'");
    response.json({ success: true });
  }));

  app.get("/api/jobs", route(async (_request, response) => response.json((await pool.query("select * from jobs order by created_at desc")).rows.map(mapJob))));
  app.post("/api/jobs", route(async (request, response) => {
    const body = object(request.body);
    const name = requiredText(body.name, "name", 300);
    const attributeSet = requiredText(body.attribute_set, "attribute_set", 500);
    const skus = stringArray(body.skus, "skus");
    if (!(await pool.query("select 1 from attribute_sets where lower(name)=lower($1)", [attributeSet])).rowCount) {
      throw new HttpError(409, "The requested attribute set does not exist");
    }
    const { rows } = await pool.query("select * from sku_data where sku = any($1::text[])", [skus]);
    if (rows.length !== skus.length) throw new HttpError(400, "One or more SKUs do not exist");
    if (rows.some((row) => (row.attribute_set || row.attribute_set_id) !== attributeSet)) throw new HttpError(400, "All SKUs must use the requested attribute set");
    const id = `job_${randomUUID()}`;
    const createdAt = new Date().toISOString();
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(`insert into jobs (id,name,created_at,attribute_set,skus,status,total_count) values ($1,$2,$3,$4,$5,'pending',$6)`, [id, name, createdAt, attributeSet, JSON.stringify(skus), skus.length]);
      for (const row of rows) await client.query(`insert into job_results (job_id,sku,input_snapshot,status,scraped_markdown,scrape_status)
        values ($1,$2,$3,'pending',$4,$5)`, [id, row.sku, snapshotCatalog(row), row.scraped_markdown, row.scrape_status]);
      await client.query("commit");
    } catch (error) { await client.query("rollback"); throw error; } finally { client.release(); }
    response.status(201).json(mapJob((await pool.query("select * from jobs where id=$1", [id])).rows[0]));
  }));
  app.post("/api/jobs/run", route(async (request, response) => {
    const ids = stringArray(object(request.body).ids, "ids", 100);
    const settings = await readSettings(pool, settingsKey);
    if (!settings.apiKey) throw new HttpError(409, "LLM API key is not configured");
    try { await requirePublicHttpsUrl(settings.baseUrl); } catch { throw new HttpError(409, "The configured LLM endpoint is not a public HTTPS URL"); }
    const { apiKey: _apiKey, ...settingsSnapshot } = settings;
    const client = await pool.connect();
    let queuedCount = 0;
    try {
      await client.query("begin");
      const selected = (await client.query("select * from jobs where id=any($1::text[]) for update", [ids])).rows;
      if (selected.length !== ids.length) throw new HttpError(404, "One or more jobs were not found");
      if (selected.some((job) => !["pending", "failed", "stopped", "completed_with_errors", "queued", "running"].includes(job.status))) {
        throw new HttpError(409, "Only pending, stopped, or failed jobs can be queued");
      }
      for (const job of selected) {
        if (["queued", "running"].includes(job.status)) continue;
        const skus = Array.isArray(job.skus) ? job.skus.filter((sku: unknown): sku is string => typeof sku === "string") : [];
        if (!skus.length) throw new HttpError(409, `Job ${job.id} has no valid SKUs`);
        const rule = (await client.query("select rules_markdown from attribute_sets where lower(name)=lower($1) limit 1", [job.attribute_set || ""])).rows[0];
        if (!rule) throw new HttpError(409, `The attribute set for job ${job.id} no longer exists`);
        const catalog = (await client.query("select * from sku_data where sku=any($1::text[])", [skus])).rows;
        if (catalog.length !== skus.length) throw new HttpError(409, `One or more catalog entries for job ${job.id} no longer exist`);
        for (const row of catalog) {
          await client.query(`insert into job_results (job_id,sku,input_snapshot,status,scraped_markdown,scrape_status)
            values ($1,$2,$3,'pending',$4,$5)
            on conflict (job_id,sku) do update set
              input_snapshot=case when job_results.status in ('completed','cannot_qa') then job_results.input_snapshot else excluded.input_snapshot end,
              status=case when job_results.status in ('completed','cannot_qa') then job_results.status else 'pending' end,
              scraped_markdown=case when job_results.status in ('completed','cannot_qa') then job_results.scraped_markdown else excluded.scraped_markdown end,
              scrape_status=case when job_results.status in ('completed','cannot_qa') then job_results.scrape_status else excluded.scrape_status end,
              qa_result=case when job_results.status in ('completed','cannot_qa') then job_results.qa_result else null end,
              export_data=case when job_results.status in ('completed','cannot_qa') then job_results.export_data else null end,
              tokens_used=case when job_results.status in ('completed','cannot_qa') then job_results.tokens_used else null end,
              time_taken=case when job_results.status in ('completed','cannot_qa') then job_results.time_taken else null end,
              error=case when job_results.status in ('completed','cannot_qa') then job_results.error else null end,
              updated_at=now()`, [job.id, row.sku, snapshotCatalog(row), row.scraped_markdown, row.scrape_status]);
        }
        const runConfig = { settings: settingsSnapshot, rulesMarkdown: rule.rules_markdown, promptVersion: QA_PROMPT_VERSION };
        await client.query(`update jobs set status='queued', queued_at=now(), finished_at=null, stop_requested=false,
          error=null, run_config=$2,
          processed_count=(select count(*) from job_results r where r.job_id=jobs.id and r.status in ('completed','cannot_qa')),
          total_count=(select count(*) from job_results r where r.job_id=jobs.id), updated_at=now() where id=$1`, [job.id, runConfig]);
        queuedCount++;
      }
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally { client.release(); }
    const queued = await pool.query("select * from jobs where id=any($1::text[])", [ids]);
    response.status(202).json({ success: true, jobs: queued.rows.map(mapJob), queued: queuedCount });
  }));
  app.post("/api/jobs/:id/stop", route(async (request, response) => {
    object(request.body || {});
    const result = await pool.query(`update jobs set stop_requested=true,
      status=case when status='queued' then 'stopped' else status end,
      finished_at=case when status='queued' then now() else finished_at end, updated_at=now()
      where id=$1 and status in ('queued','running') returning *`, [request.params.id]);
    if (!result.rowCount) throw new HttpError(409, "Job is not queued or running");
    response.status(202).json({ success: true });
  }));
  app.get("/api/jobs/:id/results", route(async (request, response) => {
    const exists = await pool.query("select 1 from jobs where id=$1", [request.params.id]);
    if (!exists.rowCount) throw new HttpError(404, "Job not found");
    const { rows } = await pool.query("select * from job_results where job_id=$1 order by sku", [request.params.id]);
    response.json(rows.map((row) => ({
      ...(row.input_snapshot || {}), sku: row.sku, status: row.status, scraped_markdown: row.scraped_markdown || undefined,
      scrape_status: row.scrape_status || undefined, qa_result: row.qa_result || undefined, export_data: row.export_data || undefined,
      tokensUsed: row.tokens_used || undefined, timeTaken: row.time_taken || undefined, error: row.error || null, last_job_id: request.params.id,
    })));
  }));
  app.delete("/api/jobs/:id", route(async (request, response) => {
    const result = await pool.query("delete from jobs where id=$1 and status not in ('queued','running')", [request.params.id]);
    if (!result.rowCount) throw new HttpError(409, "Active jobs cannot be deleted");
    response.status(204).end();
  }));
  app.delete("/api/jobs", route(async (request, response) => {
    const body = object(request.body);
    const result = body.scope === "all"
      ? await pool.query("delete from jobs where status not in ('queued','running')")
      : body.scope === undefined
        ? await pool.query("delete from jobs where id=any($1::text[]) and status not in ('queued','running')", [stringArray(body.ids, "ids", 1000)])
        : (() => { throw new HttpError(400, "scope must be 'all'"); })();
    response.json({ success: true, deleted: result.rowCount || 0 });
  }));

  app.get("/api/attribute-sets", route(async (_request, response) => response.json((await pool.query("select * from attribute_sets order by name")).rows.map(mapAttributeSet))));
  app.post("/api/attribute-sets", route(async (request, response) => {
    const input = attributeSetInput(request.body);
    try {
      const { rows } = await pool.query(`insert into attribute_sets (id,name,rules_markdown) values ($1,$2,$3) returning *`, [randomUUID(), input.name, input.rulesMarkdown]);
      response.status(201).json(mapAttributeSet(rows[0]));
    } catch (error: any) { if (error.code === "23505") throw new HttpError(409, "An attribute set with this name already exists"); throw error; }
  }));
  app.put("/api/attribute-sets/:id", route(async (request, response) => {
    const input = attributeSetInput(request.body);
    try {
      const { rows } = await pool.query("update attribute_sets set name=$2,rules_markdown=$3,updated_at=now() where id=$1 returning *", [request.params.id, input.name, input.rulesMarkdown]);
      if (!rows[0]) throw new HttpError(404, "Attribute set not found");
      response.json(mapAttributeSet(rows[0]));
    } catch (error: any) { if (error.code === "23505") throw new HttpError(409, "An attribute set with this name already exists"); throw error; }
  }));
  app.delete("/api/attribute-sets/:id", route(async (request, response) => {
    if (!(await pool.query("delete from attribute_sets where id=$1", [request.params.id])).rowCount) throw new HttpError(404, "Attribute set not found");
    response.status(204).end();
  }));

  app.get("/api/site-selectors", route(async (_request, response) => response.json((await pool.query("select * from site_selectors order by website")).rows.map(mapSelector))));
  app.post("/api/site-selectors", route(async (request, response) => {
    const input = selectorInput(request.body);
    try {
      const { rows } = await pool.query(`insert into site_selectors (id,website,selectors,tab_selector,tab_content_selector,tab_wait_ms,enabled)
        values ($1,$2,$3,$4,$5,$6,$7) returning *`, [randomUUID(), input.website, input.selectors, input.tabSelector, input.tabContentSelector, input.tabWaitMs, input.enabled]);
      response.status(201).json(mapSelector(rows[0]));
    } catch (error: any) { if (error.code === "23505") throw new HttpError(409, "A selector for this website already exists"); throw error; }
  }));
  app.put("/api/site-selectors/:id", route(async (request, response) => {
    const input = selectorInput(request.body);
    try {
      const { rows } = await pool.query(`update site_selectors set website=$2,selectors=$3,tab_selector=$4,tab_content_selector=$5,
        tab_wait_ms=$6,enabled=$7,updated_at=now() where id=$1 returning *`, [request.params.id, input.website, input.selectors, input.tabSelector, input.tabContentSelector, input.tabWaitMs, input.enabled]);
      if (!rows[0]) throw new HttpError(404, "Site selector not found");
      response.json(mapSelector(rows[0]));
    } catch (error: any) { if (error.code === "23505") throw new HttpError(409, "A selector for this website already exists"); throw error; }
  }));
  app.delete("/api/site-selectors/:id", route(async (request, response) => {
    if (!(await pool.query("delete from site_selectors where id=$1", [request.params.id])).rowCount) throw new HttpError(404, "Site selector not found");
    response.status(204).end();
  }));

  app.get("/api/settings", route(async (_request, response) => response.json(publicSettings(await readSettings(pool, settingsKey)))));
  app.put("/api/settings", route(async (request, response) => {
    if (Number((await pool.query("select count(*)::int as count from jobs where status in ('queued','running')")).rows[0].count)) {
      throw new HttpError(409, "Settings cannot change while jobs are queued or running");
    }
    let settings;
    try { settings = parseSettings(request.body, await readSettings(pool, settingsKey)); }
    catch { throw new HttpError(400, "Settings payload is invalid"); }
    let endpoint;
    try { endpoint = await requirePublicHttpsUrl(settings.baseUrl); }
    catch { throw new HttpError(400, "baseUrl must be a public HTTPS URL"); }
    if (!endpoint.pathname.endsWith("/chat/completions")) throw new HttpError(400, "baseUrl must be the exact /chat/completions endpoint");
    await writeSettings(pool, settingsKey, settings);
    response.json(publicSettings(settings));
  }));
  const settingsTests = new Map<string, number[]>();
  app.post("/api/settings/test", route(async (request, response) => {
    object(request.body || {});
    const ip = request.ip || "unknown"; const cutoff = Date.now() - 60000;
    const recent = (settingsTests.get(ip) || []).filter((time) => time > cutoff);
    if (recent.length >= 5) throw new HttpError(429, "Too many settings tests; try again later");
    recent.push(Date.now()); settingsTests.set(ip, recent);
    const settings = await readSettings(pool, settingsKey);
    try {
      await callLlm(settings,
        "Return only this JSON object: {\"qa_status\":\"pass\",\"confidence\":\"high\",\"summary\":\"Connection successful\",\"issue_count\":0,\"issues\":[],\"source_notes\":{\"sap_used\":false,\"url_used\":false,\"source_conflicts\":[]}}",
        "Test the configured connection.");
    } catch { throw new HttpError(502, "LLM connection test failed"); }
    response.json({ success: true });
  }));

  app.post("/api/legacy-import", route(async (request, response) => response.json(await legacyImport(pool, settingsKey, request.body))));

  app.use("/api", (_request, response) => response.status(404).json({ error: { code: "not_found", message: "API endpoint not found" } }));
  if (process.env.NODE_ENV === "production") {
    const publicDir = path.resolve(process.cwd(), "dist/public");
    app.use(express.static(publicDir, { index: false }));
    app.get("*all", (request, response) => path.extname(request.path)
      ? response.status(404).end()
      : response.sendFile(path.join(publicDir, "index.html")));
  }
  app.use((error: any, request: Request, response: Response, _next: NextFunction) => {
    if (response.headersSent) return;
    if (error?.type === "entity.too.large") return response.status(413).json({ error: { code: "body_too_large", message: "Request body is too large" } });
    if (error?.status === 415) return response.status(415).json({ error: { code: "unsupported_media_type", message: "Content-Type must be application/json" } });
    if (error instanceof SyntaxError && "body" in error) return response.status(400).json({ error: { code: "invalid_json", message: "Invalid JSON payload" } });
    const status = error instanceof HttpError ? error.status : 500;
    if (status === 500) console.error({
      message: "Unhandled request error",
      requestId: requiredLogId(request.headers["x-request-id"]),
      method: request.method,
      path: request.path,
      code: typeof error?.code === "string" ? error.code.slice(0, 50) : undefined,
    });
    response.status(status).json({ error: { code: status === 500 ? "internal_error" : "request_error", message: status === 500 ? "Internal server error" : error.message } });
  });
  return app;
}

function mapAttributeSet(row: any) { return { id: row.id, name: row.name, rulesMarkdown: row.rules_markdown, createdAt: new Date(row.created_at).getTime(), updatedAt: new Date(row.updated_at).getTime() }; }
function attributeSetInput(input: unknown) { const body = object(input); return { name: requiredText(body.name, "name", 500), rulesMarkdown: typeof body.rulesMarkdown === "string" && body.rulesMarkdown.length <= 100000 ? body.rulesMarkdown : (() => { throw new HttpError(400, "rulesMarkdown is invalid"); })() }; }
function mapSelector(row: any) { return { id: row.id, website: row.website, selectors: row.selectors, tabSelector: row.tab_selector || undefined, tabContentSelector: row.tab_content_selector || undefined, tabWaitMs: row.tab_wait_ms ?? 300, enabled: row.enabled, createdAt: new Date(row.created_at).getTime(), updatedAt: new Date(row.updated_at).getTime() }; }
function selectorInput(input: unknown) {
  const body = object(input); const website = requiredText(body.website, "website", 253).toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, "");
  if (!website.includes(".") || website.includes("/") || website.includes(":")) throw new HttpError(400, "website must be a complete domain");
  const tabSelector = typeof body.tabSelector === "string" && body.tabSelector.trim() ? body.tabSelector.trim() : null;
  const tabContentSelector = typeof body.tabContentSelector === "string" && body.tabContentSelector.trim() ? body.tabContentSelector.trim() : null;
  if (Boolean(tabSelector) !== Boolean(tabContentSelector)) throw new HttpError(400, "Tab selectors must be provided together");
  const tabWaitMs = body.tabWaitMs === undefined ? 300 : body.tabWaitMs;
  if (!Number.isInteger(tabWaitMs) || tabWaitMs < 0 || tabWaitMs > 10000) throw new HttpError(400, "tabWaitMs must be from 0 to 10000");
  return { website, selectors: requiredText(body.selectors, "selectors", 10000), tabSelector, tabContentSelector, tabWaitMs, enabled: body.enabled !== false };
}

async function legacyImport(pool: Pool, key: Buffer, input: unknown) {
  const body = object(input); const attributeSets = body.attributeSets ?? []; const selectors = body.siteSelectors ?? [];
  if (!Array.isArray(attributeSets) || !Array.isArray(selectors) || attributeSets.length > 1000 || selectors.length > 1000) throw new HttpError(400, "Legacy import arrays are invalid");
  const client = await pool.connect();
  try {
    await client.query("begin");
    if ((await client.query("select legacy_imported_at from app_settings where id=1")).rows[0]?.legacy_imported_at) throw new HttpError(409, "Legacy data was already imported");
    for (const raw of attributeSets) {
      const item = attributeSetInput(raw); const existing = (await client.query("select id from attribute_sets where lower(name)=lower($1)", [item.name])).rows[0];
      if (existing) await client.query("update attribute_sets set name=$2,rules_markdown=$3,updated_at=now() where id=$1", [existing.id, item.name, item.rulesMarkdown]);
      else await client.query("insert into attribute_sets (id,name,rules_markdown) values ($1,$2,$3)", [randomUUID(), item.name, item.rulesMarkdown]);
    }
    let selectorCount = 0;
    for (const raw of selectors) {
      const item = selectorInput(raw);
      if ((await client.query("select 1 from site_selectors where lower(website)=lower($1)", [item.website])).rowCount) continue;
      await client.query(`insert into site_selectors (id,website,selectors,tab_selector,tab_content_selector,tab_wait_ms,enabled)
        values ($1,$2,$3,$4,$5,$6,$7)`, [randomUUID(), item.website, item.selectors, item.tabSelector, item.tabContentSelector, item.tabWaitMs, item.enabled]); selectorCount++;
    }
    const current = await readSettings(client, key);
    let settings;
    try { settings = body.settings === undefined ? current : parseSettings(body.settings, current, false); }
    catch { throw new HttpError(400, "Legacy settings payload is invalid"); }
    try {
      const endpoint = await requirePublicHttpsUrl(settings.baseUrl);
      if (!endpoint.pathname.endsWith("/chat/completions")) throw new Error("Invalid endpoint path");
    } catch { throw new HttpError(400, "Legacy baseUrl must be a public HTTPS /chat/completions endpoint"); }
    await writeSettings(client, key, settings);
    await client.query("update app_settings set legacy_imported_at=now() where id=1");
    await client.query("commit");
    return { success: true, imported: { attributeSets: attributeSets.length, siteSelectors: selectorCount, settings: body.settings !== undefined } };
  } catch (error) { await client.query("rollback"); throw error; } finally { client.release(); }
}

export async function startServer() {
  configuredBrowserVersion();
  const pool = createPool();
  await verifyMigrations(pool);
  const auth = loadAuthConfig(); const settingsKey = loadSettingsKey();
  const app = createApp({ pool, auth, settingsKey });
  if (process.env.NODE_ENV !== "production") {
    const { createServer } = await import("vite");
    const vite = await createServer({ server: { middlewareMode: true }, appType: "spa" });
    app.use(vite.middlewares);
  }
  const port = Number(process.env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be from 1 to 65535");
  const server = app.listen(port, "0.0.0.0", () => console.log(`Server listening on ${port}`));
  const worker = startJobWorker(pool, settingsKey);
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    const closed = new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await Promise.all([closed, worker.stop()]);
    await pool.end();
  };
  process.once("SIGTERM", () => void shutdown().catch((error) => { console.error({ message: "Graceful shutdown failed", code: error?.code }); process.exitCode = 1; }));
  process.once("SIGINT", () => void shutdown().catch((error) => { console.error({ message: "Graceful shutdown failed", code: error?.code }); process.exitCode = 1; }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer().catch((error) => {
    console.error({ message: "Server startup failed", code: typeof error?.code === "string" ? error.code.slice(0, 50) : undefined });
    process.exit(1);
  });
}
