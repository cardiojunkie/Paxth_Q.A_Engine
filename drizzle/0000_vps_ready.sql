DO $$ BEGIN
  CREATE TYPE qa_status AS ENUM ('pending', 'ready', 'cannot_qa', 'running', 'completed', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE scrape_status AS ENUM ('success', 'failed', 'skipped_no_url');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS attribute_sets (
  id text PRIMARY KEY,
  name text NOT NULL,
  rules_markdown text NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS sku_data (
  id serial PRIMARY KEY,
  sku text NOT NULL UNIQUE,
  upload_attributes jsonb,
  source jsonb,
  raw_row jsonb,
  status qa_status NOT NULL DEFAULT 'pending',
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
  created_at timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE sku_data ADD COLUMN IF NOT EXISTS upload_attributes jsonb;
ALTER TABLE sku_data ADD COLUMN IF NOT EXISTS source jsonb;
ALTER TABLE sku_data ADD COLUMN IF NOT EXISTS raw_row jsonb;
ALTER TABLE sku_data ADD COLUMN IF NOT EXISTS attribute_set text;
ALTER TABLE sku_data ADD COLUMN IF NOT EXISTS attribute_set_id text;
ALTER TABLE sku_data ADD COLUMN IF NOT EXISTS scraped_markdown text;
ALTER TABLE sku_data ADD COLUMN IF NOT EXISTS scrape_status scrape_status;
ALTER TABLE sku_data ADD COLUMN IF NOT EXISTS tokens_used jsonb;
ALTER TABLE sku_data ADD COLUMN IF NOT EXISTS time_taken integer;
ALTER TABLE sku_data ADD COLUMN IF NOT EXISTS error text;
ALTER TABLE sku_data ADD COLUMN IF NOT EXISTS qa_result jsonb;
ALTER TABLE sku_data ADD COLUMN IF NOT EXISTS export_data jsonb;
ALTER TABLE sku_data ADD COLUMN IF NOT EXISTS last_job_id text;
ALTER TABLE sku_data ADD COLUMN IF NOT EXISTS created_at timestamp NOT NULL DEFAULT now();
--> statement-breakpoint
ALTER TABLE IF EXISTS jobs DROP CONSTRAINT IF EXISTS jobs_attribute_set_id_attribute_sets_id_fk;
ALTER TABLE IF EXISTS jobs DROP CONSTRAINT IF EXISTS jobs_attribute_set_id_fkey;
--> statement-breakpoint
WITH ranked AS (
  SELECT id, first_value(id) OVER (PARTITION BY lower(name) ORDER BY (rules_markdown <> '') DESC, updated_at DESC, id) AS keep_id
  FROM attribute_sets
)
UPDATE sku_data s SET attribute_set_id = ranked.keep_id FROM ranked WHERE s.attribute_set_id = ranked.id AND ranked.id <> ranked.keep_id;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'jobs' AND column_name = 'attribute_set_id') THEN
    EXECUTE $sql$
      WITH ranked AS (
        SELECT id, first_value(id) OVER (PARTITION BY lower(name) ORDER BY (rules_markdown <> '') DESC, updated_at DESC, id) AS keep_id
        FROM attribute_sets
      )
      UPDATE jobs j SET attribute_set_id = ranked.keep_id FROM ranked
      WHERE j.attribute_set_id = ranked.id AND ranked.id <> ranked.keep_id
    $sql$;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'jobs' AND column_name = 'attribute_set') THEN
      EXECUTE $sql$
        UPDATE jobs j SET attribute_set = a.name FROM attribute_sets a
        WHERE j.attribute_set IS NULL AND j.attribute_set_id = a.id
      $sql$;
    END IF;
  END IF;
END $$;
WITH ranked AS (
  SELECT id, row_number() OVER (PARTITION BY lower(name) ORDER BY (rules_markdown <> '') DESC, updated_at DESC, id) AS position
  FROM attribute_sets
)
DELETE FROM attribute_sets a USING ranked WHERE a.id = ranked.id AND ranked.position > 1;
CREATE UNIQUE INDEX IF NOT EXISTS attribute_sets_name_lower_unique ON attribute_sets (lower(name));
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS jobs (
  id text PRIMARY KEY,
  name text NOT NULL,
  created_at text NOT NULL,
  attribute_set text,
  skus jsonb,
  status text NOT NULL DEFAULT 'pending',
  tokens_used jsonb,
  time_taken integer,
  error text,
  processed_count integer NOT NULL DEFAULT 0,
  total_count integer NOT NULL DEFAULT 0,
  current_sku text,
  stop_requested boolean NOT NULL DEFAULT false,
  lease_owner text,
  lease_expires_at timestamptz,
  queued_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  run_config jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS attribute_set text;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS skus jsonb;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending';
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS tokens_used jsonb;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS time_taken integer;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS error text;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS processed_count integer NOT NULL DEFAULT 0;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS total_count integer NOT NULL DEFAULT 0;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS current_sku text;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS stop_requested boolean NOT NULL DEFAULT false;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS lease_owner text;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS queued_at timestamptz;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS started_at timestamptz;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS finished_at timestamptz;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS run_config jsonb;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
--> statement-breakpoint
ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_attribute_set_id_attribute_sets_id_fk;
ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_attribute_set_id_fkey;
ALTER TABLE jobs ALTER COLUMN created_at TYPE text USING created_at::text;
UPDATE jobs SET created_at = now()::text WHERE created_at IS NULL;
UPDATE jobs SET skus = '[]'::jsonb WHERE skus IS NULL;
UPDATE jobs SET status = 'pending' WHERE status IS NULL OR btrim(status) = '';
UPDATE jobs SET processed_count = 0 WHERE processed_count IS NULL;
UPDATE jobs SET total_count = CASE WHEN jsonb_typeof(skus) = 'array' THEN jsonb_array_length(skus) ELSE 0 END WHERE total_count IS NULL;
UPDATE jobs SET stop_requested = false WHERE stop_requested IS NULL;
UPDATE jobs SET updated_at = now() WHERE updated_at IS NULL;
ALTER TABLE jobs ALTER COLUMN created_at SET NOT NULL;
ALTER TABLE jobs ALTER COLUMN skus SET DEFAULT '[]'::jsonb;
ALTER TABLE jobs ALTER COLUMN skus SET NOT NULL;
ALTER TABLE jobs ALTER COLUMN status SET DEFAULT 'pending';
ALTER TABLE jobs ALTER COLUMN status SET NOT NULL;
ALTER TABLE jobs ALTER COLUMN processed_count SET DEFAULT 0;
ALTER TABLE jobs ALTER COLUMN processed_count SET NOT NULL;
ALTER TABLE jobs ALTER COLUMN total_count SET DEFAULT 0;
ALTER TABLE jobs ALTER COLUMN total_count SET NOT NULL;
ALTER TABLE jobs ALTER COLUMN stop_requested SET DEFAULT false;
ALTER TABLE jobs ALTER COLUMN stop_requested SET NOT NULL;
ALTER TABLE jobs ALTER COLUMN updated_at SET DEFAULT now();
ALTER TABLE jobs ALTER COLUMN updated_at SET NOT NULL;
--> statement-breakpoint
UPDATE jobs SET status = 'pending', lease_owner = null, lease_expires_at = null, current_sku = null WHERE status = 'running';
UPDATE jobs SET total_count = jsonb_array_length(skus) WHERE jsonb_typeof(skus) = 'array' AND total_count = 0;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS site_selectors (
  id text PRIMARY KEY,
  website text NOT NULL,
  selectors text NOT NULL,
  tab_selector text,
  tab_content_selector text,
  tab_wait_ms integer,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE site_selectors ADD COLUMN IF NOT EXISTS tab_selector text;
ALTER TABLE site_selectors ADD COLUMN IF NOT EXISTS tab_content_selector text;
ALTER TABLE site_selectors ADD COLUMN IF NOT EXISTS tab_wait_ms integer;
--> statement-breakpoint
UPDATE site_selectors SET website = lower(trim(trailing '/' from
  regexp_replace(regexp_replace(btrim(website), '^https?://', '', 'i'), '^www\.', '', 'i')));
WITH ranked AS (
  SELECT id, row_number() OVER (PARTITION BY lower(website) ORDER BY updated_at DESC, id) AS position
  FROM site_selectors
)
DELETE FROM site_selectors s USING ranked WHERE s.id = ranked.id AND ranked.position > 1;
CREATE UNIQUE INDEX IF NOT EXISTS site_selectors_website_lower_unique ON site_selectors (lower(website));
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS job_results (
  job_id text NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  sku text NOT NULL,
  input_snapshot jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  scraped_markdown text,
  scrape_status text,
  qa_result jsonb,
  export_data jsonb,
  tokens_used jsonb,
  time_taken integer,
  error text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (job_id, sku)
);
--> statement-breakpoint
ALTER TABLE job_results DROP CONSTRAINT IF EXISTS job_results_sku_sku_data_sku_fk;
ALTER TABLE job_results DROP CONSTRAINT IF EXISTS job_results_sku_fkey;
--> statement-breakpoint
INSERT INTO job_results (job_id, sku, input_snapshot, status, scraped_markdown, scrape_status,
  qa_result, export_data, tokens_used, time_taken, error)
SELECT s.last_job_id, s.sku,
  jsonb_build_object(
    'sku', s.sku,
    'upload_attributes', coalesce(s.upload_attributes, '{}'::jsonb),
    'source', coalesce(s.source, '{}'::jsonb),
    'raw_row', coalesce(s.raw_row, '{}'::jsonb),
    'attribute_set', coalesce(s.attribute_set, s.attribute_set_id),
    'scraped_markdown', s.scraped_markdown,
    'scrape_status', s.scrape_status
  ),
  CASE WHEN s.status::text IN ('completed', 'failed', 'cannot_qa') THEN s.status::text ELSE 'pending' END,
  s.scraped_markdown, s.scrape_status::text, s.qa_result, s.export_data, s.tokens_used, s.time_taken, s.error
FROM sku_data s
JOIN jobs j ON j.id = s.last_job_id
WHERE s.last_job_id IS NOT NULL
ON CONFLICT (job_id, sku) DO NOTHING;
--> statement-breakpoint
INSERT INTO job_results (job_id, sku, input_snapshot, status, error)
SELECT j.id, item.sku, jsonb_build_object('sku', item.sku), 'unavailable',
  'Historical result is unavailable because no proven legacy association exists.'
FROM jobs j
CROSS JOIN LATERAL jsonb_array_elements_text(
  CASE WHEN jsonb_typeof(j.skus) = 'array' THEN j.skus ELSE '[]'::jsonb END
) AS item(sku)
WHERE NOT EXISTS (
  SELECT 1 FROM job_results r WHERE r.job_id = j.id AND r.sku = item.sku
)
ON CONFLICT (job_id, sku) DO NOTHING;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS app_settings (
  id integer PRIMARY KEY DEFAULT 1,
  ciphertext text,
  iv text,
  auth_tag text,
  key_version integer NOT NULL DEFAULT 1,
  migration_version text NOT NULL DEFAULT '0000_vps_ready',
  legacy_imported_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT app_settings_singleton CHECK (id = 1)
);
--> statement-breakpoint
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS ciphertext text;
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS iv text;
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS auth_tag text;
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS key_version integer DEFAULT 1;
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS migration_version text DEFAULT '0000_vps_ready';
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS legacy_imported_at timestamptz;
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
UPDATE app_settings SET key_version = 1 WHERE key_version IS NULL;
UPDATE app_settings SET migration_version = '0000_vps_ready' WHERE migration_version IS NULL;
UPDATE app_settings SET updated_at = now() WHERE updated_at IS NULL;
ALTER TABLE app_settings ALTER COLUMN key_version SET DEFAULT 1;
ALTER TABLE app_settings ALTER COLUMN key_version SET NOT NULL;
ALTER TABLE app_settings ALTER COLUMN migration_version SET DEFAULT '0000_vps_ready';
ALTER TABLE app_settings ALTER COLUMN migration_version SET NOT NULL;
ALTER TABLE app_settings ALTER COLUMN updated_at SET DEFAULT now();
ALTER TABLE app_settings ALTER COLUMN updated_at SET NOT NULL;
--> statement-breakpoint
INSERT INTO app_settings (id, migration_version) VALUES (1, '0000_vps_ready')
ON CONFLICT (id) DO UPDATE SET migration_version = excluded.migration_version;
