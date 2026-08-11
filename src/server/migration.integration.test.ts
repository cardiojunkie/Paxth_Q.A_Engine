import assert from "node:assert/strict";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { Pool } from "pg";
import { createPool, runMigrations, verifyMigrations } from "./database.js";

const connectionString = process.env.DATABASE_MIGRATION_URL;

assert.equal(process.env.PAXTH_RUN_DB_TESTS, "1", "Refusing to reset PostgreSQL without PAXTH_RUN_DB_TESTS=1");
assert.ok(connectionString, "DATABASE_MIGRATION_URL is required");

const url = new URL(connectionString);
assert.ok(["postgres:", "postgresql:"].includes(url.protocol), "Test URL must use PostgreSQL");
assert.equal(url.search + url.hash, "", "Test URL must not contain connection overrides or a fragment");
const hostname = url.hostname.replace(/^\[|\]$/g, "");
const addresses = isIP(hostname) ? [{ address: hostname }] : await lookup(hostname, { all: true });
assert.ok(
  addresses.length > 0 && addresses.every(({ address }) => address === "::1" || /^127\./.test(address)),
  "Refusing to reset a non-loopback PostgreSQL server",
);
const databaseName = decodeURIComponent(url.pathname.slice(1));
assert.ok(databaseName.endsWith("_test") && !databaseName.includes("/"), "Test database name must end in _test");

const pool = createPool(connectionString);

async function resetDatabase() {
  await pool.query("drop schema if exists drizzle cascade; drop schema if exists public cascade; create schema public");
}

async function assertFreshMigration() {
  await resetDatabase();
  await runMigrations(pool);
  await verifyMigrations(pool);
  const { rows } = await pool.query<{ table_name: string }>(`
    select table_name from information_schema.tables
    where table_schema = 'public' order by table_name
  `);
  assert.deepEqual(rows.map(({ table_name }) => table_name), [
    "app_settings", "attribute_sets", "job_results", "jobs", "site_selectors", "sku_data",
  ]);
  assert.equal((await pool.query("select count(*)::int as count from drizzle.__drizzle_migrations")).rows[0].count, 1);
}

async function installLegacyFixture() {
  await resetDatabase();
  await pool.query(`
    create type user_role as enum ('admin', 'user');
    create type qa_status as enum ('pending', 'ready', 'cannot_qa', 'running', 'completed', 'failed');
    create type scrape_status as enum ('success', 'failed', 'skipped_no_url');

    create table users (
      id text primary key,
      username text not null unique,
      password text not null,
      role user_role not null default 'user',
      last_login timestamp,
      created_at timestamp not null default now()
    );
    create table attribute_sets (
      id text primary key,
      name text not null,
      rules_markdown text not null,
      created_at timestamp not null default now(),
      updated_at timestamp not null default now()
    );
    create table jobs (
      id text primary key,
      name text not null,
      created_at text,
      attribute_set text,
      attribute_set_id text references attribute_sets(id),
      skus jsonb,
      status text default 'pending',
      tokens_used jsonb,
      time_taken integer,
      error text
    );
    create table sku_data (
      id serial primary key,
      sku text not null unique,
      upload_attributes jsonb,
      source jsonb,
      raw_row jsonb,
      status qa_status not null default 'pending',
      attribute_set text,
      attribute_set_id text,
      scraped_markdown text,
      scrape_status scrape_status,
      tokens_used jsonb,
      time_taken integer,
      error text,
      qa_result jsonb,
      export_data jsonb,
      last_job_id text,
      created_at timestamp not null default now()
    );
    create table site_selectors (
      id text primary key,
      website text not null,
      selectors text not null,
      tab_selector text,
      tab_content_selector text,
      tab_wait_ms integer,
      enabled boolean not null default true,
      created_at timestamp not null default now(),
      updated_at timestamp not null default now()
    );
  `);
  await pool.query(`insert into users values
    ('legacy-user', 'legacy-admin', 'plaintext-must-remain-for-later-removal', 'admin', '2025-01-01', '2024-01-01')`);
  await pool.query(`insert into attribute_sets values
    ('attr-keep', 'Phones', '# trusted rules', '2024-01-01', '2024-01-01'),
    ('attr-drop', 'phones', '', '2025-01-01', '2025-01-01')`);
  await pool.query(`insert into jobs
    (id, name, created_at, attribute_set, attribute_set_id, skus, status, tokens_used, time_taken)
    values
    ('job-running', 'Legacy run', '2025-02-01T00:00:00Z', null, 'attr-drop', '["SKU-1","SKU-MISSING"]', 'running', '{"total_tokens":12}', 900),
    ('job-null', 'Partially-created job', null, null, null, null, null, null, null)`);
  await pool.query(`insert into sku_data
    (sku, upload_attributes, source, raw_row, status, attribute_set, attribute_set_id,
     scraped_markdown, scrape_status, tokens_used, time_taken, qa_result, export_data, last_job_id)
    values
    ('SKU-1', '{"title":"Upload title"}', '{"title":"Trusted title"}', '{"SKU":"SKU-1"}',
     'completed', 'phones', 'attr-drop', '# scraped', 'success', '{"total_tokens":12}', 900,
     '{"qa_status":"pass"}', '{"QA Status":"pass"}', 'job-running')`);
  await pool.query(`insert into site_selectors values
    ('selector-old', 'https://WWW.Example.com/', 'main.old', null, null, null, true, '2024-01-01', '2024-01-01'),
    ('selector-new', 'example.com', 'main.new', null, null, 250, true, '2025-01-01', '2025-01-01')`);
}

async function userSnapshot() {
  const rows = (await pool.query(`
    select id, username, password, role::text, last_login::text, created_at::text from users order by id
  `)).rows;
  const columns = (await pool.query(`
    select column_name, data_type, is_nullable, column_default from information_schema.columns
    where table_schema = 'public' and table_name = 'users' order by ordinal_position
  `)).rows;
  return { rows, columns };
}

async function assertRequiredJobColumns(pool: Pool) {
  const { rows } = await pool.query<{ column_name: string; is_nullable: string }>(`
    select column_name, is_nullable from information_schema.columns
    where table_schema = 'public' and table_name = 'jobs'
      and column_name in ('created_at', 'skus', 'status', 'processed_count', 'total_count', 'stop_requested', 'updated_at')
  `);
  assert.equal(rows.length, 7);
  assert.ok(rows.every(({ is_nullable }) => is_nullable === "NO"), "Durable job state must be non-null");
}

async function assertLegacyMigration() {
  await installLegacyFixture();
  const usersBefore = await userSnapshot();
  await runMigrations(pool);
  await verifyMigrations(pool);

  assert.deepEqual(await userSnapshot(), usersBefore, "The legacy users table must remain untouched");
  assert.deepEqual((await pool.query("select id, name from attribute_sets order by id")).rows, [
    { id: "attr-keep", name: "Phones" },
  ]);
  assert.deepEqual((await pool.query("select attribute_set_id from sku_data where sku = 'SKU-1'")).rows[0], {
    attribute_set_id: "attr-keep",
  });
  assert.deepEqual((await pool.query("select attribute_set_id, attribute_set from jobs where id = 'job-running'")).rows[0], {
    attribute_set_id: "attr-keep",
    attribute_set: "Phones",
  });
  assert.deepEqual((await pool.query("select id, website, selectors from site_selectors")).rows, [
    { id: "selector-new", website: "example.com", selectors: "main.new" },
  ]);

  const jobs = (await pool.query(`
    select id, status, skus, processed_count, total_count, stop_requested,
           lease_owner, lease_expires_at, current_sku, created_at is not null as has_created_at
    from jobs order by id
  `)).rows;
  assert.deepEqual(jobs, [
    {
      id: "job-null", status: "pending", skus: [], processed_count: 0, total_count: 0,
      stop_requested: false, lease_owner: null, lease_expires_at: null, current_sku: null, has_created_at: true,
    },
    {
      id: "job-running", status: "pending", skus: ["SKU-1", "SKU-MISSING"], processed_count: 0, total_count: 2,
      stop_requested: false, lease_owner: null, lease_expires_at: null, current_sku: null, has_created_at: true,
    },
  ]);
  await assertRequiredJobColumns(pool);

  const result = (await pool.query("select * from job_results where job_id = 'job-running' and sku = 'SKU-1'")).rows[0];
  assert.equal(result.status, "completed");
  assert.equal(result.scrape_status, "success");
  assert.deepEqual(result.qa_result, { qa_status: "pass" });
  assert.deepEqual(result.input_snapshot, {
    sku: "SKU-1",
    upload_attributes: { title: "Upload title" },
    source: { title: "Trusted title" },
    raw_row: { SKU: "SKU-1" },
    attribute_set: "phones",
    scraped_markdown: "# scraped",
    scrape_status: "success",
  });
  assert.deepEqual((await pool.query(`select status, error from job_results
    where job_id = 'job-running' and sku = 'SKU-MISSING'`)).rows[0], {
    status: "unavailable",
    error: "Historical result is unavailable because no proven legacy association exists.",
  });

  assert.deepEqual((await pool.query("select id, key_version, migration_version from app_settings")).rows, [
    { id: 1, key_version: 1, migration_version: "0000_vps_ready" },
  ]);
  assert.equal((await pool.query("select count(*)::int as count from drizzle.__drizzle_migrations")).rows[0].count, 1);

  await assert.rejects(
    pool.query("insert into attribute_sets (id, name, rules_markdown) values ('duplicate', 'PHONES', 'x')"),
    (error: { code?: string }) => error.code === "23505",
  );
  await assert.rejects(
    pool.query("insert into site_selectors (id, website, selectors) values ('duplicate', 'EXAMPLE.COM', 'x')"),
    (error: { code?: string }) => error.code === "23505",
  );
  await assert.rejects(
    pool.query("insert into app_settings (id) values (2)"),
    (error: { code?: string }) => error.code === "23514",
  );

  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("delete from sku_data where sku = 'SKU-1'");
    assert.equal((await client.query("select count(*)::int as count from job_results where sku = 'SKU-1'")).rows[0].count, 1);
    await client.query("rollback");

    await client.query("begin");
    await client.query("delete from jobs where id = 'job-running'");
    assert.equal((await client.query("select count(*)::int as count from job_results where job_id = 'job-running'")).rows[0].count, 0);
    await client.query("rollback");
  } finally {
    client.release();
  }
}

try {
  await assertFreshMigration();
  await assertLegacyMigration();
  console.log("Fresh and legacy PostgreSQL migrations passed.");
} finally {
  await pool.end();
}
