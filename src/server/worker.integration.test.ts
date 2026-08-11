import assert from "node:assert/strict";
import { Pool } from "pg";
import { writeSettings, type AppSettings } from "./settings.ts";
import { QA_PROMPT_VERSION } from "./qa.ts";
import { startJobWorker } from "./worker.ts";

const databaseUrl = process.env.DATABASE_URL || "";
const parsedUrl = (() => {
  assert.equal(process.env.PAXTH_RUN_DB_TESTS, "1", "Set PAXTH_RUN_DB_TESTS=1 to run destructive database tests");
  const value = new URL(databaseUrl);
  assert.ok(["127.0.0.1", "localhost", "::1", "[::1]"].includes(value.hostname), "Worker DB tests require a loopback PostgreSQL host");
  assert.ok(decodeURIComponent(value.pathname.slice(1)).endsWith("_test"), "Worker DB tests require a database name ending in _test");
  return value;
})();

const pool = new Pool({ connectionString: parsedUrl.href, max: 3 });
const settingsKey = Buffer.alloc(32, 42);
const endpoint = "https://1.1.1.1/v1/chat/completions";
const workers: ReturnType<typeof startJobWorker>[] = [];
const originalFetch = globalThis.fetch;
const calls = new Map<string, number>();

const passResult = {
  qa_status: "pass",
  confidence: "high",
  summary: "The uploaded data matches the SAP source.",
  issue_count: 0,
  issues: [],
  source_notes: { sap_used: true, url_used: false, source_conflicts: [] },
};
const failResult = {
  qa_status: "fail",
  confidence: "high",
  summary: "The uploaded colour conflicts with SAP.",
  issue_count: 1,
  issues: [{
    field: "colour",
    issue_type: "data_mismatch",
    severity: "critical",
    uploaded_value: "blue",
    source_truth: "red",
    explanation: "The values differ.",
    suggested_fix: "Use red.",
    cell_color: "red",
  }],
  source_notes: { sap_used: true, url_used: false, source_conflicts: [] },
};

globalThis.fetch = (async (_input: URL | RequestInfo, init?: RequestInit) => {
  const body = JSON.parse(String(init?.body));
  const content = body.messages?.find((message: { role?: string }) => message.role === "user")?.content;
  const sku = typeof content === "string" ? /^SKU: ([^\n]+)/.exec(content)?.[1] : undefined;
  assert.ok(sku, "The worker request must identify its SKU");
  calls.set(sku, (calls.get(sku) || 0) + 1);
  if (sku === "STOP-DURING-RETRY") {
    await pool.query("update jobs set stop_requested = true where id = 'worker-test-stop-retry'");
    return new Response("temporary provider failure", { status: 503 });
  }
  const result = sku.startsWith("RETRY-") ? {} : sku === "BATCH-001" ? failResult : passResult;
  return new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify(result) } }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  }), { status: 200, headers: { "content-type": "application/json" } });
}) as typeof fetch;

const settings: AppSettings = {
  baseUrl: endpoint,
  apiKey: "worker-integration-test-key",
  modelName: "test-model",
  temperature: 0,
  maxTokens: 100,
  maxRetries: 0,
  scraperTimeout: 5000,
  maxPageContentLength: 1000,
};

function runConfig(maxRetries: number) {
  const { apiKey: _apiKey, ...safeSettings } = { ...settings, maxRetries };
  return { settings: safeSettings, rulesMarkdown: "", promptVersion: QA_PROMPT_VERSION };
}

async function insertJob(id: string, skus: string[], options: { maxRetries?: number; status?: string; stopRequested?: boolean; expired?: boolean } = {}) {
  for (const sku of skus) {
    await pool.query(`insert into sku_data (sku, upload_attributes, source, raw_row, status)
      values ($1, $2, $3, $4, 'ready')`, [sku, { colour: "blue" }, { sap: "colour: red" }, { sku }]);
  }
  await pool.query(`insert into jobs (id, name, created_at, skus, status, total_count, stop_requested,
      queued_at, lease_owner, lease_expires_at, run_config)
    values ($1, $2, $3, $4, $5, $6, $7, now(), $8, $9, $10)`, [
    id,
    id,
    new Date().toISOString(),
    JSON.stringify(skus),
    options.status || "queued",
    skus.length,
    options.stopRequested || false,
    options.expired ? "dead-worker" : null,
    options.expired ? new Date(Date.now() - 60_000) : null,
    runConfig(options.maxRetries || 0),
  ]);
}

async function waitForStatus(id: string, expected: string, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { rows } = await pool.query("select status from jobs where id = $1", [id]);
    if (rows[0]?.status === expected) return;
    if (rows[0]?.status === "failed" && expected !== "failed") throw new Error(`${id} failed unexpectedly`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${id} to become ${expected}`);
}

try {
  await pool.query("select migration_version from app_settings where id = 1");
  await pool.query("truncate job_results, jobs, sku_data, app_settings restart identity cascade");
  await writeSettings(pool, settingsKey, settings);

  workers.push(startJobWorker(pool, settingsKey), startJobWorker(pool, settingsKey));

  const batchSkus = Array.from({ length: 100 }, (_, index) => `BATCH-${String(index + 1).padStart(3, "0")}`);
  await insertJob("worker-test-batch", batchSkus);
  await waitForStatus("worker-test-batch", "completed");
  assert.equal(batchSkus.reduce((total, sku) => total + (calls.get(sku) || 0), 0), 100);
  const batch = await pool.query(`select count(*)::int as completed,
    count(*) filter (where qa_result->>'qa_status' = 'fail')::int as failed_qa
    from job_results where job_id = 'worker-test-batch' and status = 'completed'`);
  assert.deepEqual(batch.rows[0], { completed: 100, failed_qa: 1 });

  await insertJob("worker-test-retry-0", ["RETRY-ZERO"], { maxRetries: 0 });
  await waitForStatus("worker-test-retry-0", "completed_with_errors");
  assert.equal(calls.get("RETRY-ZERO"), 1);

  await insertJob("worker-test-retry-2", ["RETRY-TWO"], { maxRetries: 2 });
  await waitForStatus("worker-test-retry-2", "completed_with_errors");
  assert.equal(calls.get("RETRY-TWO"), 3);

  await insertJob("worker-test-stop-retry", ["STOP-DURING-RETRY"], { maxRetries: 2 });
  await waitForStatus("worker-test-stop-retry", "stopped");
  assert.equal(calls.get("STOP-DURING-RETRY"), 1);
  assert.equal((await pool.query(`select status from job_results
    where job_id = 'worker-test-stop-retry' and sku = 'STOP-DURING-RETRY'`)).rows[0].status, "pending");

  await insertJob("worker-test-single-claim", ["SINGLE-CLAIM"]);
  await waitForStatus("worker-test-single-claim", "completed");
  assert.equal(calls.get("SINGLE-CLAIM"), 1);

  await insertJob("worker-test-recovery", ["RECOVERY-DONE", "RECOVERY-PENDING"], { status: "running", expired: true });
  await pool.query(`insert into job_results (job_id, sku, input_snapshot, status, qa_result)
    select 'worker-test-recovery', sku, jsonb_build_object('sku', sku, 'source', source, 'upload_attributes', upload_attributes),
      'completed', $1 from sku_data where sku = 'RECOVERY-DONE'`, [passResult]);
  await waitForStatus("worker-test-recovery", "completed");
  assert.equal(calls.get("RECOVERY-DONE") || 0, 0);
  assert.equal(calls.get("RECOVERY-PENDING"), 1);

  await insertJob("worker-test-stopped", ["STOPPED-BEFORE-CALL"], { stopRequested: true });
  await waitForStatus("worker-test-stopped", "stopped");
  assert.equal(calls.get("STOPPED-BEFORE-CALL") || 0, 0);

  console.log("durable worker PostgreSQL assertions passed");
} finally {
  await Promise.all(workers.map((worker) => worker.stop()));
  globalThis.fetch = originalFetch;
  await pool.end();
}
