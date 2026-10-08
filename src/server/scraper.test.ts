import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import express from 'express';
import type { Pool } from 'pg';
import { ScrapeError, type ScrapePreview, type ScrapeReport } from '../lib/browserScrape';
import { registerAuth } from './auth';
import { registerScrapeRoutes } from './scraper';

const environment = ['NODE_ENV', 'APP_ORIGIN', 'CODESPACE_NAME', 'GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN'];
const saved = Object.fromEntries(environment.map(name => [name, process.env[name]]));
const queries: string[] = [], collected: string[] = [];
const pool = { query: async (sql: string) => {
  queries.push(sql);
  assert.match(sql, /^SELECT .* FROM sessions s JOIN users u /, 'URL previews only read authentication; no catalog/job/provider writes');
  return { rows: [{ id: 'operator', username: 'Operator', role: 'user' }] };
}, connect: async () => { throw new Error('URL preview must not open a write transaction'); } } as unknown as Pool;
const report: ScrapeReport = { durationMs: 15, characters: 10, clicks: 1, scrolls: 2, warnings: [], unresolvedControls: [] };
let started!: () => void, cancelled!: () => void;
const startedWait = new Promise<void>(resolve => { started = resolve; });
const cancelledWait = new Promise<void>(resolve => { cancelled = resolve; });
const collect = async (url: string, signal: AbortSignal): Promise<ScrapePreview> => {
  collected.push(url);
  const kind = new URL(url).pathname;
  if (kind === '/blocked') throw new ScrapeError('The website blocked access.', 502, 'PAGE_BLOCKED', report);
  if (kind === '/private-dns') throw new ScrapeError('The URL must resolve exclusively to public internet addresses.', 400, 'PRIVATE_ADDRESS', report);
  if (kind === '/queue-full') throw new ScrapeError('The browser queue is full. Retry shortly.', 503, 'QUEUE_FULL');
  if (kind === '/failure') throw new Error('Secret worker log and provider credential');
  if (kind === '/wait') {
    started();
    await new Promise<void>((_resolve, reject) => signal.addEventListener('abort', () => { cancelled(); reject(signal.reason); }, { once: true }));
  }
  return { status: kind === '/partial' ? 'partial' : 'collected', markdown: '# Evidence', requestedUrl: url, finalUrl: url,
    capturedAt: '2026-10-07T00:00:00.000Z', report: kind === '/partial' ? { ...report, warnings: [{ code: 'UNRESOLVED_CONTROLS', message: 'Some content could not be revealed.' }], unresolvedControls: ['Specifications'] } : report };
};
const app = express(), server = createServer(app);
try {
  for (const name of environment) delete process.env[name];
  process.env.NODE_ENV = 'test';
  app.use(express.json());
  registerAuth(app, pool);
  registerScrapeRoutes(app, collect);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const cookie = `paxth_session=${'a'.repeat(64)}`;
  const post = async (body: unknown, authenticated = true, requestOrigin = origin) => {
    const response = await fetch(origin + '/api/scrape/preview', { method: 'POST', headers: {
      Origin: requestOrigin, 'Content-Type': 'application/json', ...(authenticated ? { Cookie: cookie } : {}),
    }, body: JSON.stringify(body) });
    assert.equal(response.headers.get('cache-control'), 'no-store');
    return { status: response.status, body: await response.json() };
  };
  assert.equal((await post({ url: 'https://example.com/' }, false)).status, 401);
  assert.equal((await post({ url: 'https://example.com/' }, true, 'https://evil.example')).status, 403);
  assert.equal(collected.length, 0);
  assert.equal(queries.length, 0, 'Rejected anonymous/origin requests never reach collection or database');
  for (const body of [{}, [], { url: 'https://example.com/', sku: 'ignored' }, { url: 12 }, { url: 'file:///etc/passwd' }, { url: 'http://127.0.0.1/' }, { url: 'http://192.168.1.1/' }, { url: 'https://example.com:444/' }]) {
    assert.equal((await post(body)).status, 400, 'Reject unsupported input before invoking the worker');
  }
  assert.equal(collected.length, 0);
  const success = await post({ url: 'example.com/product#specifications' });
  assert.equal(success.status, 200);
  assert.deepEqual(success.body, { status: 'collected', markdown: '# Evidence', requestedUrl: 'https://example.com/product', finalUrl: 'https://example.com/product', capturedAt: '2026-10-07T00:00:00.000Z', report });
  const partial = await post({ url: 'https://example.com/partial' });
  assert.equal(partial.status, 200); assert.equal(partial.body.status, 'partial');
  assert.equal(partial.body.markdown, '# Evidence');
  assert.deepEqual(partial.body.report.unresolvedControls, ['Specifications']);
  for (const [path, status, code] of [['blocked', 502, 'PAGE_BLOCKED'], ['private-dns', 400, 'PRIVATE_ADDRESS'], ['queue-full', 503, 'QUEUE_FULL']] as const) {
    const failure = await post({ url: `https://example.com/${path}` });
    assert.equal(failure.status, status); assert.equal(failure.body.code, code);
    assert.ok(!Object.hasOwn(failure.body, 'markdown'), 'Hard failures discard accumulated page text');
    if (path !== 'queue-full') assert.deepEqual(failure.body.report, report, 'Available diagnostics survive hard failures');
  }
  assert.deepEqual(await post({ url: 'https://example.com/failure' }), {
    status: 503, body: { error: 'The browser service could not complete retrieval.', code: 'RETRIEVAL_FAILED' },
  }, 'Unknown worker details remain private');
  const disconnected = request(origin + '/api/scrape/preview', { method: 'POST', headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json' } });
  disconnected.on('error', () => {});
  disconnected.end(JSON.stringify({ url: 'https://example.com/wait' }));
  await Promise.race([startedWait, new Promise((_, reject) => setTimeout(() => reject(new Error('Collection did not start')), 1000).unref())]);
  disconnected.destroy();
  await Promise.race([cancelledWait, new Promise((_, reject) => setTimeout(() => reject(new Error('Disconnect did not cancel collection')), 1000).unref())]);
  assert.ok(queries.every(sql => /^SELECT .* FROM sessions s JOIN users u /.test(sql)));
} finally {
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
  for (const name of environment) { if (saved[name] === undefined) delete process.env[name]; else process.env[name] = saved[name]; }
}
console.log('URL preview route checks passed: authentication, strict input, collected/partial diagnostics, sanitized failures, cancellation and no unrelated writes.');
