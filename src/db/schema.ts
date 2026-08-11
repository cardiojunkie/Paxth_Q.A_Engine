import { pgTable, text, serial, timestamp, jsonb, boolean, integer, pgEnum } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

export const userRoleEnum = pgEnum('user_role', ['admin', 'user']);

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  username: text('username').notNull().unique(),
  password: text('password').notNull(),
  role: userRoleEnum('role').default('user').notNull(),
  lastLogin: timestamp('last_login'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

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
  skus: jsonb('skus'),
  status: text('status').default('pending').notNull(), // pending, running, completed, failed
  tokensUsed: jsonb('tokens_used'),
  timeTaken: integer('time_taken'),
  error: text('error'),
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
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Relationships
export const skuDataRelations = relations(skuData, ({ one }) => ({
  attributeSet: one(attributeSets, {
    fields: [skuData.attributeSetId],
    references: [attributeSets.id],
  }),
}));
