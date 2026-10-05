import assert from 'node:assert/strict';
import { request } from 'node:http';
import express from 'express';
import type { Pool } from 'pg';
import { registerAuth } from './auth';

const names = ['NODE_ENV', 'APP_ORIGIN', 'CODESPACE_NAME', 'GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN', 'PORT'];
const saved = Object.fromEntries(names.map(name => [name, process.env[name]]));
const pool = { query: async () => { throw new Error('Malformed login must not reach the database'); } } as unknown as Pool;
async function check(expected?: string, allowLoopback = false) {
  const app = express(); app.use(express.json()); registerAuth(app, pool);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const local = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  // Native HTTP preserves Host overrides, unlike fetch, so these reproduce the actual proxy headers.
  const send = (method: string, path: string, origin: string, site: string | null = 'same-origin', host?: string) => new Promise<{ status: number }>((resolve, reject) => {
    const req = request(local + path, { method, headers: {
      Origin: origin, 'Content-Type': 'application/json', ...(site && { 'Sec-Fetch-Site': site }), ...(host && { Host: host }),
    } }, res => { res.resume(); resolve({ status: res.statusCode! }); });
    req.on('error', reject); req.end('{}');
  });
  const login = (origin: string, site: string | null = 'same-origin', host?: string) => send('POST', '/api/auth/login', origin, site, host);
  try {
    assert.equal((await login(expected ?? local)).status, 400, 'A matching origin reaches login validation');
    assert.equal((await login('https://evil.example')).status, 403, 'Untrusted origins stay blocked');
    assert.equal((await login(expected ?? local, 'cross-site')).status, 403, 'Cross-site requests stay blocked');
    if (expected) assert.equal((await login(local)).status, allowLoopback ? 400 : 403, 'Explicit origin stays authoritative; automatic development supports loopback');
    if (allowLoopback) {
      const port = new URL(local).port;
      for (const host of [`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`]) {
        assert.equal((await login(`http://${host}`, 'same-origin', host)).status, 400, 'Codespaces-rewritten loopback origin reaches login');
        for (const site of [null, 'same-site', 'cross-site']) assert.equal((await login(`http://${host}`, site, host)).status, 403, 'Loopback exception requires same-origin browser metadata');
      }
      assert.equal((await login('https://evil.example', 'same-origin', 'evil.example')).status, 403, 'Matching an unrelated Host does not bypass the check');
      assert.equal((await login('http://localhost:9999')).status, 403, 'Loopback Origin must match the request Host and port');
      assert.equal((await send('PUT', '/api/scraper-settings', `http://localhost:${port}`, 'same-origin', `localhost:${port}`)).status, 401, 'Rewritten settings save reaches session validation');
    }
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
}
try {
  for (const name of names) delete process.env[name];
  process.env.NODE_ENV = 'test';
  await check();
  process.env.CODESPACE_NAME = 'test-workspace';
  process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN = 'app.github.dev';
  await check('https://test-workspace-3000.app.github.dev', true);
  process.env.PORT = '4567';
  await check('https://test-workspace-4567.app.github.dev', true);
  process.env.APP_ORIGIN = 'https://explicit.example';
  await check('https://explicit.example');
  process.env.NODE_ENV = 'production';
  await check('https://explicit.example');
  delete process.env.APP_ORIGIN;
  assert.throws(() => registerAuth(express(), pool), /APP_ORIGIN is required/);
} finally {
  for (const name of names) { if (saved[name] === undefined) delete process.env[name]; else process.env[name] = saved[name]; }
}
console.log('Authentication origin checks passed: local, Codespaces rewrites, settings saves, explicit overrides, production and cross-site protection.');
