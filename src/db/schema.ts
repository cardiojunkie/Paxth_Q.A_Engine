import { pgTable, text, serial, timestamp, jsonb, boolean, integer, pgEnum, uniqueIndex, check, index, primaryKey } from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';

export const userRoleEnum = pgEnum('user_role', ['admin', 'user']);

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  username: text('username').notNull().unique(),
  password: text('password').notNull(),
  role: userRoleEnum('role').default('user').notNull(),
  lastLogin: timestamp('last_login'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, table => [uniqueIndex('users_normalized_username_idx').on(sql`lower(btrim(${table.username}))`)]);

export const attributeSets = pgTable('attribute_sets', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  rulesMarkdown: text('rules_markdown').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [uniqueIndex('attribute_sets_normalized_name_idx').on(sql`lower(btrim(${table.name}))`)]);

export const qaAgentSettings = pgTable('qa_agent_settings', {
  id: text('id').primaryKey(),
  memory: text('memory').notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const jobs = pgTable('jobs', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  createdAt: text('created_at').notNull(),
  attributeSet: text('attribute_set'),
  skus: jsonb('skus').notNull().default([]),
  status: text('status').default('pending').notNull(), // pending, running, completed, failed
  tokensUsed: jsonb('tokens_used'),
  timeTaken: integer('time_taken'),
  error: text('error'),
}, table => [check('jobs_valid_status',sql`${table.status} IN ('pending','running','completed','failed')`), check('jobs_skus_array',sql`jsonb_typeof(${table.skus})='array' AND NOT jsonb_path_exists(${table.skus}, '$[*] ? (@.type() != "string" || @ == "")')`)]);

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
  revision: integer('revision').default(0).notNull(),
});

export const siteSelectors = pgTable('site_selectors', {
  id: text('id').primaryKey(),
  website: text('website').notNull(),
  selectors: text('selectors').notNull(),
  tabSelector: text('tab_selector'),
  tabContentSelector: text('tab_content_selector'),
  tabWaitMs: integer('tab_wait_ms'),
  enabled: boolean('enabled').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, table => [uniqueIndex('site_selectors_website_idx').on(table.website), check('site_selectors_canonical', sql`${table.website} = lower(btrim(${table.website})) AND ${table.website} NOT LIKE 'www.%' AND ${table.website} NOT LIKE '%/' AND ${table.website} NOT LIKE '%.'`)]);

// Relationships
export const skuDataRelations = relations(skuData, ({ one }) => ({
  attributeSet: one(attributeSets, {
    fields: [skuData.attributeSetId],
    references: [attributeSets.id],
  }),
}));

export const sessions = pgTable('sessions', {
  tokenHash: text('token_hash').primaryKey(), userId: text('user_id').notNull().references(()=>users.id,{onDelete:'cascade'}),
  createdAt: timestamp('created_at',{withTimezone:true}).defaultNow().notNull(), expiresAt: timestamp('expires_at',{withTimezone:true}).notNull(),
}, table=>[index('sessions_user_id_idx').on(table.userId),index('sessions_expires_at_idx').on(table.expiresAt)]);
export const providerSettings = pgTable('provider_settings', {
  id:text('id').primaryKey(),settings:jsonb('settings').notNull(),
}, table=>[check('provider_settings_id_check',sql`${table.id}='default'`)]);
export const jobRuns = pgTable('job_runs', {
  id:text('id').primaryKey(),jobId:text('job_id').notNull().references(()=>jobs.id,{onDelete:'cascade'}),requestId:text('request_id').notNull(),
  actorId:text('actor_id').notNull(),actorName:text('actor_name').notNull(),mode:text('mode').notNull(),selectedSku:text('selected_sku'),
  status:text('status').notNull().default('queued'),configuration:jsonb('configuration').notNull(),ownerToken:text('owner_token'),
  createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),startedAt:timestamp('started_at',{withTimezone:true}),finishedAt:timestamp('finished_at',{withTimezone:true}),error:text('error'),
},table=>[uniqueIndex('job_runs_job_id_request_id_key').on(table.jobId,table.requestId),uniqueIndex('job_runs_one_active').on(table.jobId).where(sql`${table.status} IN ('queued','running','cancelling')`),
  check('job_runs_mode_check',sql`${table.mode} IN ('unfinished','all','single')`),check('job_runs_status_check',sql`${table.status} IN ('queued','running','cancelling','completed','failed','cancelled')`)]);
export const jobRunItems = pgTable('job_run_items', {
  runId:text('run_id').notNull().references(()=>jobRuns.id,{onDelete:'cascade'}),sku:text('sku').notNull(),position:integer('position').notNull(),revision:integer('revision').notNull(),snapshot:jsonb('snapshot').notNull(),
  status:text('status').notNull(),attempts:integer('attempts').notNull().default(0),scrapeStarted:boolean('scrape_started').notNull().default(false),
  startedAt:timestamp('started_at',{withTimezone:true}),finishedAt:timestamp('finished_at',{withTimezone:true}),result:jsonb('result'),error:text('error'),
},table=>[primaryKey({columns:[table.runId,table.sku]}),check('job_run_items_status_check',sql`${table.status} IN ('queued','running','completed','failed','cancelled','skipped')`),check('job_run_items_attempts_check',sql`${table.attempts} BETWEEN 0 AND 3`)]);
