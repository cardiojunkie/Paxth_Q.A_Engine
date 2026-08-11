import { boolean, integer, jsonb, pgEnum, pgTable, primaryKey, serial, text, timestamp } from 'drizzle-orm/pg-core';

export const attributeSets = pgTable('attribute_sets', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  rulesMarkdown: text('rules_markdown').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const jobs = pgTable('jobs', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  createdAt: text('created_at').notNull(),
  attributeSet: text('attribute_set'),
  skus: jsonb('skus').default([]).notNull(),
  status: text('status').default('pending').notNull(),
  tokensUsed: jsonb('tokens_used'),
  timeTaken: integer('time_taken'),
  error: text('error'),
  processedCount: integer('processed_count').default(0).notNull(),
  totalCount: integer('total_count').default(0).notNull(),
  currentSku: text('current_sku'),
  stopRequested: boolean('stop_requested').default(false).notNull(),
  leaseOwner: text('lease_owner'),
  leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
  queuedAt: timestamp('queued_at', { withTimezone: true }),
  startedAt: timestamp('started_at', { withTimezone: true }),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  runConfig: jsonb('run_config'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const qaStatusEnum = pgEnum('qa_status', ['pending', 'ready', 'cannot_qa', 'running', 'completed', 'failed']);
export const scrapeStatusEnum = pgEnum('scrape_status', ['success', 'failed', 'skipped_no_url']);

export const skuData = pgTable('sku_data', {
  id: serial('id').primaryKey(),
  sku: text('sku').notNull().unique(),
  uploadAttributes: jsonb('upload_attributes'),
  source: jsonb('source'),
  rawRow: jsonb('raw_row'),
  status: qaStatusEnum('status').default('pending').notNull(),
  attributeSet: text('attribute_set'),
  attributeSetId: text('attribute_set_id'),
  scrapedMarkdown: text('scraped_markdown'),
  scrapeStatus: scrapeStatusEnum('scrape_status'),
  tokensUsed: jsonb('tokens_used'),
  timeTaken: integer('time_taken'),
  error: text('error'),
  qaResult: jsonb('qa_result'),
  exportData: jsonb('export_data'),
  lastJobId: text('last_job_id'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const siteSelectors = pgTable('site_selectors', {
  id: text('id').primaryKey(),
  website: text('website').notNull(),
  selectors: text('selectors').notNull(),
  tabSelector: text('tab_selector'),
  tabContentSelector: text('tab_content_selector'),
  tabWaitMs: integer('tab_wait_ms'),
  enabled: boolean('enabled').default(true).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const jobResults = pgTable('job_results', {
  jobId: text('job_id').notNull().references(() => jobs.id, { onDelete: 'cascade' }),
  sku: text('sku').notNull(),
  inputSnapshot: jsonb('input_snapshot').notNull(),
  status: text('status').default('pending').notNull(),
  scrapedMarkdown: text('scraped_markdown'),
  scrapeStatus: text('scrape_status'),
  qaResult: jsonb('qa_result'),
  exportData: jsonb('export_data'),
  tokensUsed: jsonb('tokens_used'),
  timeTaken: integer('time_taken'),
  error: text('error'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [primaryKey({ columns: [table.jobId, table.sku] })]);

export const appSettings = pgTable('app_settings', {
  id: integer('id').primaryKey().default(1),
  ciphertext: text('ciphertext'),
  iv: text('iv'),
  authTag: text('auth_tag'),
  keyVersion: integer('key_version').default(1).notNull(),
  migrationVersion: text('migration_version').default('0000_vps_ready').notNull(),
  legacyImportedAt: timestamp('legacy_imported_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
