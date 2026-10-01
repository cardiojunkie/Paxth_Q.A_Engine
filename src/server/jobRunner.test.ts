import assert from 'node:assert/strict';
import type { PoolClient } from 'pg';
import { transaction } from './jobRunner';

const failure = (code: string) => Object.assign(new Error('test database failure'), { code });
async function check(errors: Error[], rollbackFails = false) {
  const queries: string[] = [];
  let calls = 0;
  const client = { query: async (sql: string) => {
    queries.push(sql);
    if (sql === 'ROLLBACK' && rollbackFails) throw failure('08006');
    if (sql === 'COMMIT' && errors.length) throw errors.shift();
    return { rows: [] };
  } } as unknown as PoolClient;
  const result = transaction(client, async () => ++calls);
  return { result, queries, calls: () => calls };
}

for (const code of ['40001', '40P01']) {
  const test = await check([failure(code), failure(code)]);
  assert.equal(await test.result, 3);
  assert.equal(test.calls(), 3);
  assert.equal(test.queries.filter(sql => sql === 'ROLLBACK').length, 2);
  assert.equal(test.queries.filter(sql => sql.startsWith('BEGIN')).length, 3);
}
const exhausted = await check([failure('40001'), failure('40001'), failure('40001')]);
await assert.rejects(exhausted.result, { code: '40001' });
assert.equal(exhausted.calls(), 3);

for (const code of ['08006', '23505']) {
  const test = await check([failure(code)]);
  await assert.rejects(test.result, { code });
  assert.equal(test.calls(), 1, 'Ambiguous connection errors and ordinary failures are never retried');
}
const rollback = await check([failure('40001')], true);
await assert.rejects(rollback.result, { code: '40001' });
assert.equal(rollback.calls(), 1, 'Failed rollback prevents retrying on an unsafe connection');
console.log('Job transaction checks passed: bounded retries, rollback safety, and ambiguous-commit isolation.');
