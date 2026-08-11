import assert from "node:assert/strict";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { Server } from "node:http";
import { createApp } from "../../server.ts";
import { loadAuthConfig } from "./auth.ts";
import { createPool } from "./database.ts";

const connectionString = process.env.DATABASE_URL;

assert.equal(process.env.PAXTH_RUN_DB_TESTS, "1", "Refusing to modify PostgreSQL without PAXTH_RUN_DB_TESTS=1");
assert.ok(connectionString, "DATABASE_URL is required");

const databaseUrl = new URL(connectionString);
assert.ok(["postgres:", "postgresql:"].includes(databaseUrl.protocol), "Test URL must use PostgreSQL");
assert.equal(databaseUrl.search + databaseUrl.hash, "", "Test URL must not contain connection overrides or a fragment");
const hostname = databaseUrl.hostname.replace(/^\[|\]$/g, "");
const addresses = isIP(hostname) ? [{ address: hostname }] : await lookup(hostname, { all: true });
assert.ok(
  addresses.length > 0 && addresses.every(({ address }) => address === "::1" || /^127\./.test(address)),
  "Refusing to modify a non-loopback PostgreSQL server",
);
const databaseName = decodeURIComponent(databaseUrl.pathname.slice(1));
assert.ok(databaseName.endsWith("_test") && !databaseName.includes("/"), "Test database name must end in _test");

const origin = "https://enzqm.aiccloud.online";
const password = "correct horse battery staple";
const apiKey = "integration-secret-api-key";
const auth = loadAuthConfig({
  ADMIN_USERNAME: "admin",
  ADMIN_PASSWORD_SCRYPT: "scrypt$131072$8$1$MDEyMzQ1Njc4OWFiY2RlZg==$6FprYHTFsXknvwZ92YQBgBBStM5YQLYkqgAq+B0yKwM=",
  SESSION_SECRET: Buffer.alloc(32, 7).toString("base64"),
  PUBLIC_ORIGIN: origin,
  NODE_ENV: "production",
});
const settingsKey = Buffer.alloc(32, 9);
const pool = createPool(connectionString);
let server: Server | undefined;

async function truncateAppTables() {
  await pool.query("truncate job_results, jobs, sku_data, attribute_sets, site_selectors, app_settings restart identity cascade");
  await pool.query("insert into app_settings (id, migration_version) values (1, '0000_vps_ready')");
}

try {
  await truncateAppTables();
  const app = createApp({ pool, auth, settingsKey });
  server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const request = (path: string, init?: RequestInit) => fetch(`${baseUrl}${path}`, { redirect: "manual", ...init });
  const jsonHeaders = (cookie = "", forwardedFor = "127.0.0.2") => ({
    Origin: origin,
    "Content-Type": "application/json",
    "X-Forwarded-For": forwardedFor,
    ...(cookie ? { Cookie: cookie } : {}),
  });
  const mutate = (path: string, method: string, body: unknown, cookie = "") => request(path, {
    method,
    headers: jsonHeaders(cookie),
    body: JSON.stringify(body),
  });

  assert.equal((await request("/healthz")).status, 200);
  assert.equal((await request("/api/catalog")).status, 401);
  assert.equal((await request("/api/catalog", { headers: { Cookie: "__Host-paxth_session=forged" } })).status, 401);

  assert.equal((await request("/api/auth/login", {
    method: "POST",
    headers: { Origin: "https://evil.example", "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password }),
  })).status, 403);
  assert.equal((await request("/api/auth/login", {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ username: "admin", password }),
  })).status, 415);
  assert.equal((await request("/api/auth/login", {
    method: "POST",
    headers: jsonHeaders("", "127.0.0.3"),
    body: "{",
  })).status, 400);
  assert.equal((await request("/api/auth/login", {
    method: "POST",
    headers: jsonHeaders("", "127.0.0.4"),
    body: JSON.stringify({ username: "admin", password: "x".repeat(17_000) }),
  })).status, 413);

  for (let attempt = 0; attempt < 5; attempt++) {
    assert.equal((await request("/api/auth/login", {
      method: "POST",
      headers: jsonHeaders("", "127.0.0.5"),
      body: JSON.stringify({ username: "admin", password: "wrong password" }),
    })).status, 401);
  }
  assert.equal((await request("/api/auth/login", {
    method: "POST",
    headers: jsonHeaders("", "127.0.0.5"),
    body: JSON.stringify({ username: "admin", password: "wrong password" }),
  })).status, 429);

  async function login(forwardedFor: string) {
    const response = await request("/api/auth/login", {
      method: "POST",
      headers: jsonHeaders("", forwardedFor),
      body: JSON.stringify({ username: "admin", password }),
    });
    assert.equal(response.status, 204);
    const setCookie = response.headers.get("set-cookie") || "";
    assert.match(setCookie, /^__Host-paxth_session=/);
    for (const attribute of ["Path=/", "HttpOnly", "Secure", "SameSite=Strict", "Max-Age=43200"]) {
      assert.match(setCookie, new RegExp(attribute));
    }
    assert.doesNotMatch(setCookie, /Domain=/i);
    return setCookie.split(";", 1)[0];
  }

  let cookie = await login("127.0.0.6");
  const sessionResponse = await request("/api/auth/session", { headers: { Cookie: cookie } });
  assert.equal(sessionResponse.status, 200);
  assert.deepEqual(await sessionResponse.json(), { authenticated: true, username: "admin" });
  const logoutResponse = await mutate("/api/auth/logout", "POST", {}, cookie);
  assert.equal(logoutResponse.status, 204);
  assert.match(logoutResponse.headers.get("set-cookie") || "", /^__Host-paxth_session=;.*Max-Age=0/);
  assert.equal((await request("/api/auth/session", { headers: { Cookie: "__Host-paxth_session=" } })).status, 401);
  cookie = await login("127.0.0.7");

  const settings = {
    baseUrl: "https://1.1.1.1/v1/chat/completions",
    apiKey,
    modelName: "integration-model",
    temperature: 0,
    maxTokens: 128,
    maxRetries: 0,
    scraperTimeout: 5_000,
    maxPageContentLength: 1_000,
  };
  const savedSettings = await mutate("/api/settings", "PUT", settings, cookie);
  assert.equal(savedSettings.status, 200);
  const savedSettingsText = await savedSettings.text();
  assert.doesNotMatch(savedSettingsText, new RegExp(apiKey));
  const safeSettings = JSON.parse(savedSettingsText);
  assert.equal(safeSettings.hasApiKey, true);
  assert.equal(safeSettings.temperature, 0);
  assert.equal(safeSettings.maxRetries, 0);
  for (const field of ["apiKey", "ciphertext", "iv", "authTag", "key"]) assert.equal(field in safeSettings, false);
  const settingsRow = (await pool.query("select ciphertext, iv, auth_tag, key_version from app_settings where id=1")).rows[0];
  assert.equal(settingsRow.key_version, 1);
  assert.ok(settingsRow.ciphertext && settingsRow.iv && settingsRow.auth_tag);
  assert.doesNotMatch(JSON.stringify(settingsRow), new RegExp(apiKey));
  const readSettingsResponse = await request("/api/settings", { headers: { Cookie: cookie } });
  assert.equal(readSettingsResponse.status, 200);
  assert.doesNotMatch(await readSettingsResponse.text(), new RegExp(apiKey));

  assert.equal((await mutate("/api/catalog", "POST", [{
    sku: "PRIVATE-URL",
    source: { url: "https://127.0.0.1/product" },
    upload_attributes: {},
    raw_row: {},
  }], cookie)).status, 400);
  assert.equal((await pool.query("select count(*)::int as count from sku_data where sku='PRIVATE-URL'")).rows[0].count, 0);

  const attributeResponse = await mutate("/api/attribute-sets", "POST", { name: "Phones", rulesMarkdown: "# Trusted rules" }, cookie);
  assert.equal(attributeResponse.status, 201);
  assert.ok((await attributeResponse.json()).id);
  assert.equal((await mutate("/api/catalog", "POST", [{
    sku: "SKU-HTTP-1",
    source: { sap: "Trusted SAP product data" },
    upload_attributes: { title: "Uploaded title" },
    raw_row: { SKU: "SKU-HTTP-1", Title: "Uploaded title" },
    attribute_set: "Phones",
  }], cookie)).status, 201);
  assert.equal((await mutate("/api/catalog", "DELETE", { scope: "false" }, cookie)).status, 400);
  assert.equal((await pool.query("select count(*)::int as count from sku_data where sku='SKU-HTTP-1'")).rows[0].count, 1);

  const jobResponse = await mutate("/api/jobs", "POST", {
    name: "HTTP integration",
    attribute_set: "Phones",
    skus: ["SKU-HTTP-1"],
  }, cookie);
  assert.equal(jobResponse.status, 201);
  const job = await jobResponse.json();
  assert.match(job.id, /^job_/);

  const firstQueue = await mutate("/api/jobs/run", "POST", { ids: [job.id] }, cookie);
  assert.equal(firstQueue.status, 202);
  assert.equal((await firstQueue.json()).queued, 1);
  const secondQueue = await mutate("/api/jobs/run", "POST", { ids: [job.id] }, cookie);
  assert.equal(secondQueue.status, 202);
  assert.equal((await secondQueue.json()).queued, 0);
  assert.deepEqual((await pool.query("select status from jobs where id=$1", [job.id])).rows, [{ status: "queued" }]);
  assert.equal((await pool.query("select count(*)::int as count from job_results where job_id=$1", [job.id])).rows[0].count, 1);
  assert.equal((await mutate("/api/settings", "PUT", settings, cookie)).status, 409);

  assert.equal((await mutate("/api/chat", "POST", {}, cookie)).status, 404);
  assert.equal((await mutate("/api/scrape", "POST", {}, cookie)).status, 404);

  console.log("Authenticated HTTP and PostgreSQL API integration passed.");
} finally {
  if (server) await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()));
  await truncateAppTables().catch(() => undefined);
  await pool.end();
}
