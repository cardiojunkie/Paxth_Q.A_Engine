import type { Pool, PoolClient } from 'pg';
import { isCompleteWebsiteDomain, normalizeWebsite } from '../lib/siteSelectorWebsite';

export const DATA_LOCK = 73462190;
export async function transaction<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // ponytail: serialize writes for this single-worker deployment; split locks only if measured contention warrants it.
    await client.query('SELECT pg_advisory_xact_lock($1)', [DATA_LOCK]);
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

export async function initializeDatabase(pool: Pool) {
  await transaction(pool, async client => {
    await client.query(`
      DO $$ BEGIN CREATE TYPE qa_status AS ENUM ('pending','ready','cannot_qa','running','completed','failed'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
      DO $$ BEGIN CREATE TYPE scrape_status AS ENUM ('success','failed','skipped_no_url'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
      CREATE TABLE IF NOT EXISTS sku_data (
        id SERIAL PRIMARY KEY, sku TEXT NOT NULL UNIQUE, upload_attributes JSONB, source JSONB, raw_row JSONB,
        status qa_status NOT NULL DEFAULT 'pending', attribute_set TEXT, attribute_set_id TEXT,
        scraped_markdown TEXT, scrape_status scrape_status, tokens_used JSONB, time_taken INTEGER,
        error TEXT, qa_result JSONB, export_data JSONB, last_job_id TEXT, revision INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS sku_data_sku_unique ON sku_data (sku);
      ALTER TABLE sku_data ADD COLUMN IF NOT EXISTS attribute_set TEXT;
      ALTER TABLE sku_data ADD COLUMN IF NOT EXISTS qa_result JSONB;
      ALTER TABLE sku_data ADD COLUMN IF NOT EXISTS export_data JSONB;
      ALTER TABLE sku_data ADD COLUMN IF NOT EXISTS last_job_id TEXT;
      ALTER TABLE sku_data ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 0;
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL,
        attribute_set TEXT, skus JSONB NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'pending',
        tokens_used JSONB, time_taken INTEGER, error TEXT
      );
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS attribute_set TEXT;
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS skus JSONB DEFAULT '[]';
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending';
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS tokens_used JSONB;
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS time_taken INTEGER;
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS error TEXT;
      CREATE TABLE IF NOT EXISTS site_selectors (
        id TEXT PRIMARY KEY, website TEXT NOT NULL, selectors TEXT NOT NULL, tab_selector TEXT,
        tab_content_selector TEXT, tab_wait_ms INTEGER, enabled BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(), updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
      ALTER TABLE site_selectors ADD COLUMN IF NOT EXISTS tab_selector TEXT;
      ALTER TABLE site_selectors ADD COLUMN IF NOT EXISTS tab_content_selector TEXT;
      ALTER TABLE site_selectors ADD COLUMN IF NOT EXISTS tab_wait_ms INTEGER;
    `);
    const selectors = (await client.query('SELECT id, website FROM site_selectors')).rows;
    const domains = new Set<string>();
    for (const row of selectors) {
      const website = normalizeWebsite(row.website);
      if (!isCompleteWebsiteDomain(website) || domains.has(website)) {
        throw new Error('Site selector migration needs manual resolution of invalid or duplicate domains; no rules were changed.');
      }
      domains.add(website);
    }
    for (const row of selectors) await client.query('UPDATE site_selectors SET website=$1 WHERE id=$2', [normalizeWebsite(row.website), row.id]);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS site_selectors_website_idx ON site_selectors (website);
      DO $$ BEGIN
        ALTER TABLE jobs ADD CONSTRAINT jobs_skus_array CHECK (skus IS NOT NULL AND jsonb_typeof(skus)='array' AND NOT jsonb_path_exists(skus, '$[*] ? (@.type() != "string" || @ == "")'));
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
      DO $$ BEGIN
        ALTER TABLE jobs ADD CONSTRAINT jobs_valid_status CHECK (status IS NOT NULL AND status IN ('pending','running','completed','failed'));
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
      DO $$ BEGIN
        ALTER TABLE site_selectors ADD CONSTRAINT site_selectors_canonical CHECK (website = lower(btrim(website)) AND website NOT LIKE 'www.%' AND website NOT LIKE '%/' AND website NOT LIKE '%.');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);
  });
}

export async function verifySchema(pool: Pool) {
  const indexes = ['attribute_sets_normalized_name_idx', 'site_selectors_website_idx', 'users_normalized_username_idx', 'job_runs_one_active', 'sku_data_sku_unique'];
  for (const index of indexes) {
    const result = await pool.query(`SELECT i.indisvalid, i.indisunique FROM pg_index i WHERE i.indexrelid=to_regclass($1)`, [index]);
    if (!result.rows[0]?.indisvalid || !result.rows[0]?.indisunique) throw new Error(`Required unique index is unavailable: ${index}`);
  }
  for (const table of ['users','sessions','sku_data','jobs','site_selectors','qa_agent_settings','provider_settings','job_runs','job_run_items']) {
    await pool.query(`SELECT 1 FROM ${table} LIMIT 0`);
  }
  await pool.query('SELECT sku,source,raw_row,upload_attributes,status,attribute_set,attribute_set_id,revision,qa_result,export_data,last_job_id,scraped_markdown,scrape_status,tokens_used,time_taken,error FROM sku_data LIMIT 0');
  await pool.query('SELECT id,name,created_at,attribute_set,skus,status,tokens_used,time_taken,error FROM jobs LIMIT 0');
  const checks = await pool.query(`SELECT conname, convalidated FROM pg_constraint WHERE conrelid IN ('jobs'::regclass,'site_selectors'::regclass) AND conname IN ('jobs_skus_array','jobs_valid_status','site_selectors_canonical')`);
  if (checks.rows.length !== 3 || checks.rows.some(row => !row.convalidated)) throw new Error('Required database constraints are unavailable');
}
