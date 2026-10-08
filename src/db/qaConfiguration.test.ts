import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import express from "express";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";
import { initializeQaConfiguration, registerQaConfigurationRoutes } from "./qaConfiguration";
import { DEFAULT_QA_AGENT_MEMORY } from "../lib/qaAgent";
import { CATALOG_PASS_THROUGH_HEADERS } from '../lib/catalogGeneration';

assert.ok(process.env.TEST_DATABASE_URL, "Set TEST_DATABASE_URL to run the database check; it creates and removes its own isolated schema.");
const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, connectionTimeoutMillis: 10000 });
const client = await pool.connect();
const namespace = `qa_config_test_${randomUUID().replaceAll("-", "")}`;
const app = express();
app.use(express.json());
const db = drizzle(client, { schema });
registerQaConfigurationRoutes(app, db);
const server = createServer(app);
try {
  await client.query(`CREATE SCHEMA "${namespace}"`);
  await client.query(`SET search_path TO "${namespace}"`);
  const headers = [...CATALOG_PASS_THROUGH_HEADERS, 'name'].reverse();
  const legacyHeaders = headers.map(header => header === 'attributes__lulu_product_type' ? 'attributes__product_type' : header);
  const legacyRules = `## Catalog Headers\n\n\`\`\`text\n${legacyHeaders.join('\n')}\n\`\`\`\n\nCopy supplied values.`;
  await client.query('CREATE TABLE attribute_sets (id TEXT PRIMARY KEY,name TEXT NOT NULL,rules_markdown TEXT NOT NULL,created_at TIMESTAMP NOT NULL DEFAULT NOW(),updated_at TIMESTAMP NOT NULL DEFAULT NOW())');
  await client.query('INSERT INTO attribute_sets (id,name,rules_markdown) VALUES ($1,$2,$3),($4,$5,$6)',
    ['legacy-valid', 'Legacy Catalog', legacyRules, 'legacy-incomplete', 'Legacy Incomplete', '## Catalog Headers\n\n```text\nsku\n```']);
  await initializeQaConfiguration(db);
  for (const [id, savedHeaders] of [['saved-old', legacyHeaders], ['saved-both', ['attributes__product_type', ...headers]], ['saved-empty', []]] as const) {
    await client.query('INSERT INTO attribute_sets (id,name,rules_markdown,catalog_headers) VALUES ($1,$2,$3,$4::jsonb)',
      [id, id, legacyRules, JSON.stringify(savedHeaders)]);
  }
  await initializeQaConfiguration(db);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const request = async (path: string, method = "GET", body?: unknown) => {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/${path}`, {
      method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json(), cache: response.headers.get("cache-control") };
  };
  const initial = await request("qa-configuration");
  assert.equal(initial.body.qaAgentMemory, DEFAULT_QA_AGENT_MEMORY);
  assert.equal(initial.cache, "no-store");
  assert.ok(initial.body.attributeSets.length > 0);
  assert.deepEqual(initial.body.attributeSets.find((set: any) => set.id === 'legacy-valid').catalogHeaders, headers);
  assert.equal(initial.body.attributeSets.find((set: any) => set.id === 'legacy-valid').rulesMarkdown, legacyRules, 'Migration never rewrites shared rules');
  assert.deepEqual(initial.body.attributeSets.find((set: any) => set.id === 'legacy-incomplete').catalogHeaders, []);
  for (const id of ['saved-old', 'saved-both']) {
    const migrated = initial.body.attributeSets.find((set: any) => set.id === id);
    assert.deepEqual(migrated.catalogHeaders, headers, 'Saved output lists retain canonical order without duplicates');
    assert.equal(migrated.rulesMarkdown, legacyRules);
  }
  assert.deepEqual(initial.body.attributeSets.find((set: any) => set.id === 'saved-empty').catalogHeaders, [], 'Empty lists are not populated from Markdown');
  assert.equal((await request("qa-agent-memory", "PUT", { qaAgentMemory: null })).status, 400);
  assert.equal((await request("qa-agent-memory", "PUT", { qaAgentMemory: "Shared instructions" })).status, 200);
  const created = await request("attribute-sets", "POST", { name: "Integration Product", rulesMarkdown: "Saved rules" });
  assert.equal(created.status, 201);
  assert.deepEqual(created.body.catalogHeaders, []);
  const configured = await request(`attribute-sets/${created.body.id}`, 'PUT', { name: 'Integration Product', rulesMarkdown: 'Saved rules', catalogHeaders: headers });
  assert.deepEqual(configured.body.catalogHeaders, headers);
  for (const invalid of [null, 'sku', ['sku'], legacyHeaders, [...headers, 'attributes__product_type'], [...headers, 'name'], [...headers, ''], [...headers, ' padded'], [...headers, 5]]) {
    assert.equal((await request(`attribute-sets/${created.body.id}`, 'PUT', { name: 'Integration Product', rulesMarkdown: 'Must not save', catalogHeaders: invalid })).status, 400);
    assert.equal((await request('attribute-sets', 'POST', { name: 'Invalid headers', rulesMarkdown: 'Rules', catalogHeaders: invalid })).status, 400);
  }
  for (const missing of CATALOG_PASS_THROUGH_HEADERS) assert.equal((await request('attribute-sets', 'POST', { name: 'Missing pass-through', rulesMarkdown: 'Rules', catalogHeaders: headers.filter(header => header !== missing) })).status, 400);
  assert.equal((await request("attribute-sets", "POST", { name: " integration PRODUCT ", rulesMarkdown: "Wrong rules" })).status, 409);
  const empty = await request("attribute-sets", "POST", { name: "Blank Product", rulesMarkdown: " \n ", catalogHeaders: headers });
  const importRules = [
    { name: "INTEGRATION PRODUCT", rulesMarkdown: "Do not overwrite" },
    { name: "Blank Product", rulesMarkdown: "Imported rules" },
    { name: "Browser Product", rulesMarkdown: "Imported new set" },
  ];
  assert.equal((await request("attribute-sets/import", "POST", importRules)).body.imported, 2);
  assert.equal((await request("attribute-sets/import", "POST", importRules)).body.imported, 0);
  const shared = (await request("qa-configuration")).body;
  assert.equal(shared.attributeSets.find((set: any) => set.id === created.body.id).rulesMarkdown, "Saved rules");
  assert.equal(shared.attributeSets.find((set: any) => set.id === empty.body.id).rulesMarkdown, "Imported rules");
  assert.deepEqual(shared.attributeSets.find((set: any) => set.id === empty.body.id).catalogHeaders, headers, 'Browser rule imports preserve configured headers');
  assert.equal((await request(`attribute-sets/${created.body.id}`, "PUT", { name: "Blank Product", rulesMarkdown: "Duplicate" })).status, 409);
  assert.equal((await request(`attribute-sets/${created.body.id}`, "PUT", { name: "Renamed Product", rulesMarkdown: "Updated rules" })).status, 200);
  assert.deepEqual((await request('qa-configuration')).body.attributeSets.find((set: any) => set.id === created.body.id).catalogHeaders, headers, 'Omitted headers preserve the saved order');
  assert.equal((await request('attribute-sets/legacy-valid', 'PUT', { name: 'Legacy Catalog', rulesMarkdown: legacyRules, catalogHeaders: [] })).status, 200);
  const defaultId = initial.body.attributeSets.find((set: any) => set.name === 'TestSet').id;
  assert.equal((await request(`attribute-sets/${defaultId}`, "DELETE")).status, 200);
  await initializeQaConfiguration(db); // Same initialization used on an application restart.
  const restarted = (await request("qa-configuration")).body;
  assert.equal(restarted.qaAgentMemory, "Shared instructions");
  assert.equal(restarted.attributeSets.find((set: any) => set.id === created.body.id).rulesMarkdown, "Updated rules");
  assert.deepEqual(restarted.attributeSets.find((set: any) => set.id === created.body.id).catalogHeaders, headers);
  assert.deepEqual(restarted.attributeSets.find((set: any) => set.id === 'legacy-valid').catalogHeaders, [], 'Cleared headers stay cleared after restart');
  for (const id of ['saved-old', 'saved-both']) assert.deepEqual(restarted.attributeSets.find((set: any) => set.id === id).catalogHeaders, headers, 'Renamed lists stay stable across restarts');
  assert.deepEqual(restarted.attributeSets.find((set: any) => set.id === 'saved-empty').catalogHeaders, []);
  assert.ok(!restarted.attributeSets.some((set: any) => set.id === defaultId));
  assert.equal(restarted.attributeSets.length, shared.attributeSets.length - 1);
  assert.equal((await request("qa-agent-memory", "PUT", { qaAgentMemory: "  \n " })).body.qaAgentMemory, DEFAULT_QA_AGENT_MEMORY);
  await client.query(`DROP TABLE "${namespace}".qa_agent_settings`);
  assert.equal((await request("qa-configuration")).status, 503, "Database errors must not fall back to browser memory");
  assert.equal((await request("qa-agent-memory", "PUT", { qaAgentMemory: "Not saved" })).status, 503);
  console.log("Shared QA database/API checks passed: output-header migration, validation, atomic updates, safe imports, duplicate protection, restart persistence, and failure responses.");
} finally {
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
  await client.query("RESET search_path");
  await client.query(`DROP SCHEMA IF EXISTS "${namespace}" CASCADE`);
  client.release();
  await pool.end();
}
