import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import express from "express";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";
import { initializeQaConfiguration, registerQaConfigurationRoutes } from "./qaConfiguration";
import { DEFAULT_QA_AGENT_MEMORY } from "../lib/qaAgent";

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
  assert.equal((await request("qa-agent-memory", "PUT", { qaAgentMemory: null })).status, 400);
  assert.equal((await request("qa-agent-memory", "PUT", { qaAgentMemory: "Shared instructions" })).status, 200);
  const created = await request("attribute-sets", "POST", { name: "Integration Product", rulesMarkdown: "Saved rules" });
  assert.equal(created.status, 201);
  assert.equal((await request("attribute-sets", "POST", { name: " integration PRODUCT ", rulesMarkdown: "Wrong rules" })).status, 409);
  const empty = await request("attribute-sets", "POST", { name: "Blank Product", rulesMarkdown: " \n " });
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
  assert.equal((await request(`attribute-sets/${created.body.id}`, "PUT", { name: "Blank Product", rulesMarkdown: "Duplicate" })).status, 409);
  assert.equal((await request(`attribute-sets/${created.body.id}`, "PUT", { name: "Renamed Product", rulesMarkdown: "Updated rules" })).status, 200);
  const defaultId = initial.body.attributeSets[0].id;
  assert.equal((await request(`attribute-sets/${defaultId}`, "DELETE")).status, 200);
  await initializeQaConfiguration(db); // Same initialization used on an application restart.
  const restarted = (await request("qa-configuration")).body;
  assert.equal(restarted.qaAgentMemory, "Shared instructions");
  assert.equal(restarted.attributeSets.find((set: any) => set.id === created.body.id).rulesMarkdown, "Updated rules");
  assert.ok(!restarted.attributeSets.some((set: any) => set.id === defaultId));
  assert.equal(restarted.attributeSets.length, shared.attributeSets.length - 1);
  assert.equal((await request("qa-agent-memory", "PUT", { qaAgentMemory: "  \n " })).body.qaAgentMemory, DEFAULT_QA_AGENT_MEMORY);
  await client.query(`DROP TABLE "${namespace}".qa_agent_settings`);
  assert.equal((await request("qa-configuration")).status, 503, "Database errors must not fall back to browser memory");
  assert.equal((await request("qa-agent-memory", "PUT", { qaAgentMemory: "Not saved" })).status, 503);
  console.log("Shared QA database/API checks passed: saves, updates, safe imports, duplicate protection, restart persistence, and failure responses.");
} finally {
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
  await client.query("RESET search_path");
  await client.query(`DROP SCHEMA IF EXISTS "${namespace}" CASCADE`);
  client.release();
  await pool.end();
}
