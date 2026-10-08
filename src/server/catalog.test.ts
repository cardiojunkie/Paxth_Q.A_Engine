import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import express from 'express';
import type { Pool } from 'pg';
import { ApiError, mapCatalogRow, registerCatalogRoutes, validateCatalogImport } from './catalog';
import { hasCompletedQa, LEGACY_REVIEW_ERROR, selectJobSkus, unreviewedRunSnapshot } from '../lib/jobRunState';
import type { SkuData } from '../hooks/useCatalogData';

const product = {
  sku: 'product', source: { sap: 'Brand: Original' }, status: 'ready',
  raw_row: { sku: 'product', attributes__brand: 'Original' }, upload_attributes: { brand: 'Original' },
};
const review = { qa_status: 'pass', issues: [] };
const message = 'raw_row.qa_result is reserved for server-generated QA; remove it before importing.';
validateCatalogImport([product]);
assert.throws(() => validateCatalogImport([{ ...product, raw_row: { ...product.raw_row, qa_result: undefined } }]), { status: 400, message });

let connections = 0;
const pool = { connect: async () => { connections++; throw new Error('Invalid batches must never open a transaction'); } } as unknown as Pool;
const app = express();
app.use(express.json());
registerCatalogRoutes(app, pool);
app.use((error: ApiError, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(error.status || 500).json({ error: error.message }));
const server = createServer(app);
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
try {
  const address = server.address() as { port: number };
  const post = (items: unknown[]) => fetch(`http://127.0.0.1:${address.port}/api/catalog`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(items),
  });
  for (const qa_result of [null, '', 'completed', 0, false, review]) {
    const forged = { ...product, raw_row: { ...product.raw_row, qa_result } };
    for (const batch of [[forged], [product, forged]]) {
      const response = await post(batch);
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { error: message });
    }
  }
  for (const key of ['qa_result', 'export_data', 'tokensUsed', 'last_job_id']) {
    assert.equal((await post([{ ...product, [key]: review }])).status, 400);
  }
  for (const status of ['completed', 'failed', 'running']) {
    assert.equal((await post([{ ...product, status }])).status, 400);
  }
  assert.equal(connections, 0, 'Whole-batch validation happens before any database access');
} finally {
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
}

const legacy = { ...product, status: 'completed', raw_row: { ...product.raw_row, qa_result: review }, qa_result: null, export_data: review };
const stored = JSON.stringify(legacy);
const projected = mapCatalogRow(legacy);
assert.equal(projected.qa_result, null);
assert.equal(projected.export_data, null);
assert.equal(projected.status, 'ready');
assert.equal(projected.error, LEGACY_REVIEW_ERROR);
assert.deepEqual(projected.raw_row, product.raw_row);
assert.equal(hasCompletedQa(projected), false);
assert.deepEqual(selectJobSkus([projected]).map(item => item.sku), ['product']);
assert.equal(mapCatalogRow({ ...legacy, source: {} }).status, 'cannot_qa');
assert.equal(mapCatalogRow({ ...legacy, source: { url: 'https://example.com' } }).status, 'ready');
assert.equal(mapCatalogRow({ ...legacy, source: {}, scraped_markdown: '# Product' }).status, 'ready');
assert.equal(mapCatalogRow({ ...legacy, error: 'Existing provider error' }).error, 'Existing provider error');
assert.equal(mapCatalogRow({ ...legacy, raw_row: product.raw_row }).error, LEGACY_REVIEW_ERROR, 'Completed status alone cannot prove a review');
assert.equal(JSON.stringify(legacy), stored, 'Projections leave stored legacy data untouched');

for (const qa_status of ['pass', 'warning', 'fail']) {
  const canonical = { qa_status, issues: [] };
  const row = mapCatalogRow({ ...legacy, revision: 2, qa_revision: 2, qa_result: canonical, status: qa_status === 'fail' ? 'failed' : 'completed' });
  assert.deepEqual(row.qa_result, canonical);
  assert.equal(row.error, null);
  assert.equal(hasCompletedQa(row), true);
  const snapshot = { ...row, tokensUsed: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }, timeTaken: 3, last_job_id: 'job' } as SkuData;
  const historical = unreviewedRunSnapshot(snapshot);
  for (const key of ['qa_result', 'export_data', 'tokensUsed', 'timeTaken', 'last_job_id']) assert.equal(Object.hasOwn(historical, key), false);
  assert.deepEqual(historical.raw_row, product.raw_row);
  assert.equal(historical.error, LEGACY_REVIEW_ERROR);
  assert.equal(hasCompletedQa(historical), false);
  assert.deepEqual(snapshot.qa_result, canonical, 'Snapshot projection does not mutate genuine stored results');
  assert.equal(unreviewedRunSnapshot(snapshot, false).error, null, 'New evidence snapshots do not mislabel trusted prior reviews');
}
const prior = { ...product, status: 'completed', revision: 4, qa_revision: 3, qa_result: review, export_data: review, tokens_used: { total_tokens: 15 } };
const stale = mapCatalogRow(prior);
assert.equal(stale.qa_stale, true);
assert.equal(stale.qa_result, null);assert.equal(stale.export_data, null);assert.equal(stale.tokensUsed, null);
assert.equal(stale.status, 'ready');assert.equal(hasCompletedQa(stale), false);
assert.deepEqual(prior.qa_result, review, 'Stale stored reviews are retained without being exported as current');
console.log('Catalog trust checks passed: HTTP rejection, batch validation, canonical results, and unverified history.');
