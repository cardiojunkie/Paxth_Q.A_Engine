import type { Express } from 'express';
import type { Pool, PoolClient } from 'pg';
import { transaction } from './database';

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export const object = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);
export const identifier = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= 256 && !/[\x00-\x1f]/.test(value);
export const skuIds = (value: unknown): value is string[] => Array.isArray(value) && value.length > 0 && value.length <= 10000 && value.every(identifier) && new Set(value).size === value.length;
const requireInput = (condition: unknown, message: string) => { if (!condition) throw new ApiError(400, message); };
const sourceValid = (source: unknown) => object(source) && Object.entries(source).every(([key, value]) => key === 'headerOrder'
  ? Array.isArray(value) && value.every(item => typeof item === 'string')
  : ['sap', 'url', 'fileName'].includes(key) && typeof value === 'string');

export function validateCatalogImport(items: unknown): asserts items is any[] {
  requireInput(Array.isArray(items) && items.length > 0 && items.length <= 10000, 'Expected 1–10000 catalog rows');
  for (const item of items as any[]) {
    requireInput(object(item) && identifier(item.sku) && sourceValid(item.source) && object(item.raw_row) && object(item.upload_attributes), 'Each row needs a SKU, source, original row, and upload attributes');
    requireInput(item.attribute_set === undefined || typeof item.attribute_set === 'string', 'Invalid attribute set');
    requireInput(item.status === undefined || ['pending','ready','cannot_qa'].includes(item.status), 'Imports must contain unprocessed SKUs');
    requireInput(!['qa_result','export_data','tokensUsed','last_job_id'].some(key => key in item), 'QA results are written by the server');
  }
}
export function validateJob(value: any) {
  requireInput(object(value) && identifier(value.id) && identifier(value.name) && skuIds(value.skus), 'A job needs an ID, name, and unique non-empty SKU identifiers');
  requireInput(value.attribute_set === undefined || typeof value.attribute_set === 'string', 'Invalid attribute set');
  requireInput(value.status === undefined || value.status === 'pending', 'New jobs must be pending');
  requireInput(value.createdAt === undefined || typeof value.createdAt === 'string' && /^\d{4}-\d\d-\d\dT/.test(value.createdAt) && Number.isFinite(Date.parse(value.createdAt)), 'Invalid job timestamp');
}

export const mapCatalogRow = (row: any) => ({
  sku: row.sku, upload_attributes: row.upload_attributes || {}, source: row.source || {}, raw_row: row.raw_row || {},
  status: row.status, attribute_set: row.attribute_set || row.attribute_set_id || undefined,
  scraped_markdown: row.scraped_markdown, scrape_status: row.scrape_status, tokensUsed: row.tokens_used,
  timeTaken: row.time_taken, error: row.error, qa_result: row.qa_result || row.raw_row?.qa_result,
  export_data: row.export_data, last_job_id: row.last_job_id, revision: row.revision,
});
export const mapJobRow = (row: any) => ({
  id: row.id, name: row.name, createdAt: row.created_at, attribute_set: row.attribute_set || '', skus: row.skus || [],
  status: row.status || 'pending', tokensUsed: row.tokens_used, timeTaken: row.time_taken, error: row.error,
});

async function ensureIdle(client: PoolClient, jobIds?: string[], skus?: string[]) {
  const { rows } = await client.query(`SELECT 1 FROM job_runs r JOIN jobs j ON j.id=r.job_id
    WHERE r.status IN ('queued','running','cancelling') AND
    ($1::text[] IS NULL OR j.id=ANY($1)) AND ($2::text[] IS NULL OR j.skus ?| $2) LIMIT 1`, [jobIds ?? null, skus ?? null]);
  if (rows.length) throw new ApiError(409, 'Cancel active runs and wait for them to stop before deleting or changing this job');
}

export function registerCatalogRoutes(app: Express, pool: Pool) {
  app.get('/api/catalog', async (_req, res) => res.json((await pool.query('SELECT * FROM sku_data ORDER BY id')).rows.map(mapCatalogRow)));
  app.post('/api/catalog', async (req, res) => {
    validateCatalogImport(req.body);
    const result = await transaction(pool, async client => {
      const inserted: any[] = [], skipped: string[] = [];
      for (const item of req.body) {
        const result = await client.query(`INSERT INTO sku_data (sku,upload_attributes,source,raw_row,status,attribute_set)
          VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (sku) DO NOTHING RETURNING *`,
        [item.sku, JSON.stringify(item.upload_attributes), JSON.stringify(item.source), JSON.stringify(item.raw_row), item.status || 'pending', item.attribute_set || null]);
        if (result.rows.length) inserted.push(mapCatalogRow(result.rows[0])); else skipped.push(item.sku);
      }
      return { inserted, skipped };
    });
    res.json(result);
  });
  app.put('/api/catalog/:sku', async (req, res) => {
    const item = req.body;
    const fields: Record<string, string> = { source:'source', upload_attributes:'upload_attributes', attribute_set:'attribute_set', scraped_markdown:'scraped_markdown', scrape_status:'scrape_status', status:'status', error:'error' };
    requireInput(object(item) && Object.keys(item).length && Object.keys(item).every(key => Object.hasOwn(fields,key)), 'Only catalog evidence fields may be edited');
    if (item.source !== undefined) requireInput(sourceValid(item.source), 'Invalid source');
    if (item.upload_attributes !== undefined) requireInput(object(item.upload_attributes), 'Invalid attributes');
    for (const key of ['attribute_set','scraped_markdown','error']) if (item[key] !== undefined) requireInput(item[key] === null || typeof item[key] === 'string', `Invalid ${key}`);
    if (item.scrape_status !== undefined) requireInput(['success','failed','skipped_no_url'].includes(item.scrape_status), 'Invalid scrape status');
    if (item.status !== undefined) requireInput(['pending','ready','cannot_qa'].includes(item.status), 'Execution status is controlled by the server');
    const saved = await transaction(pool, async client => {
      const values: any[] = [req.params.sku];
      const assignments = Object.entries(item).map(([key,value]) => {
        values.push(object(value) ? JSON.stringify(value) : value);
        return `${fields[key]}=$${values.length}`;
      });
      if (['source','upload_attributes','attribute_set','scraped_markdown'].some(key => key in item)) {
        if (!('status' in item)) assignments.push("status='ready'");
        if (!('error' in item)) assignments.push("error=CASE WHEN qa_result IS NOT NULL OR raw_row ? 'qa_result' THEN 'Evidence changed; rerun QA.' ELSE NULL END");
      }
      const result = await client.query(`UPDATE sku_data SET ${assignments.join(',')}, revision=revision+1 WHERE sku=$1 RETURNING *`, values);
      if (!result.rows.length) throw new ApiError(404, 'SKU not found');
      return mapCatalogRow(result.rows[0]);
    });
    res.json(saved);
  });
  app.delete('/api/catalog', async (req, res) => {
    requireInput(req.body?.all === true || skuIds(req.body?.skus), 'Specify SKUs or all:true');
    await transaction(pool, async client => {
      await ensureIdle(client, undefined, req.body.all ? undefined : req.body.skus);
      await client.query('DELETE FROM sku_data WHERE $1::text[] IS NULL OR sku=ANY($1)', [req.body.all ? null : req.body.skus]);
    });
    res.json({ success:true });
  });
  app.delete('/api/data', async (_req, res) => {
    await transaction(pool, async client => {
      await ensureIdle(client);
      await client.query('DELETE FROM jobs');
      await client.query('DELETE FROM sku_data');
    });
    res.json({ success:true });
  });
  app.get('/api/jobs', async (_req, res) => res.json((await pool.query('SELECT * FROM jobs ORDER BY created_at,id')).rows.map(mapJobRow)));
  app.post('/api/jobs', async (req, res) => {
    const items = Array.isArray(req.body) ? req.body : [req.body];
    requireInput(items.length > 0 && items.length <= 1000, 'Expected 1–1000 jobs');
    items.forEach(validateJob);
    const saved = await transaction(pool, async client => {
      const rows: any[] = [];
      for (const item of items) {
        const existing = await client.query('SELECT sku FROM sku_data WHERE sku=ANY($1)', [item.skus]);
        requireInput(existing.rows.length === item.skus.length, 'Every job SKU must exist in the catalog');
        const result = await client.query(`INSERT INTO jobs (id,name,created_at,attribute_set,skus,status)
          VALUES ($1,$2,$3,$4,$5,'pending') RETURNING *`, [item.id,item.name,new Date().toISOString(),item.attribute_set || null,JSON.stringify(item.skus)]);
        rows.push(mapJobRow(result.rows[0]));
      }
      return rows;
    });
    res.status(201).json(saved);
  });
  app.put('/api/jobs/:id', async (req, res) => {
    requireInput(object(req.body) && Object.keys(req.body).length > 0 && Object.keys(req.body).every(key => ['name','skus','attribute_set'].includes(key)), 'Only job name, SKUs, and attribute set can be edited');
    const saved = await transaction(pool, async client => {
      await ensureIdle(client, [String(req.params.id)]);
      const current = (await client.query('SELECT * FROM jobs WHERE id=$1', [req.params.id])).rows[0];
      if (!current) throw new ApiError(404, 'Job not found');
      const next = { ...mapJobRow(current), ...req.body, status:'pending' };
      validateJob(next);
      const existing = await client.query('SELECT sku FROM sku_data WHERE sku=ANY($1)', [next.skus]);
      requireInput(existing.rows.length === next.skus.length, 'Every job SKU must exist in the catalog');
      const result = await client.query('UPDATE jobs SET name=$2,skus=$3,attribute_set=$4,status=\'pending\' WHERE id=$1 RETURNING *', [next.id,next.name,JSON.stringify(next.skus),next.attribute_set]);
      return mapJobRow(result.rows[0]);
    });
    res.json(saved);
  });
  app.delete('/api/jobs/:id', async (req, res) => {
    await transaction(pool, async client => {
      await ensureIdle(client, [String(req.params.id)]);
      const result = await client.query('DELETE FROM jobs WHERE id=$1 RETURNING id', [req.params.id]);
      if (!result.rows.length) throw new ApiError(404, 'Job not found');
    });
    res.json({ success:true });
  });
  app.delete('/api/jobs', async (req, res) => {
    requireInput(req.body?.all === true || skuIds(req.body?.ids), 'Specify job IDs or all:true');
    await transaction(pool, async client => {
      await ensureIdle(client, req.body.all ? undefined : req.body.ids);
      await client.query('DELETE FROM jobs WHERE $1::text[] IS NULL OR id=ANY($1)', [req.body.all ? null : req.body.ids]);
    });
    res.json({ success:true });
  });
}
