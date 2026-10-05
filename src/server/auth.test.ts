import assert from 'node:assert/strict';
import express from 'express';
import type { Pool } from 'pg';
import { registerAuth } from './auth';

const names = ['NODE_ENV', 'APP_ORIGIN', 'CODESPACE_NAME', 'GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN', 'PORT'];
const saved = Object.fromEntries(names.map(name => [name, process.env[name]]));
const pool = { query: async () => { throw new Error('Malformed login must not reach the database'); } } as unknown as Pool;
async function check(expected?: string) {
  const app = express(); app.use(express.json()); registerAuth(app, pool);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const local = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const login = (origin: string, crossSite = false) => fetch(local + '/api/auth/login', {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...(crossSite && { 'Sec-Fetch-Site': 'cross-site' }) }, body: '{}',
  });
  try {
    assert.equal((await login(expected ?? local)).status, 400, 'A matching origin reaches login validation');
    assert.equal((await login('https://evil.example')).status, 403, 'Untrusted origins stay blocked');
    assert.equal((await login(expected ?? local, true)).status, 403, 'Cross-site requests stay blocked');
    if (expected) assert.equal((await login(local)).status, 403, 'Configured origin remains authoritative');
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
}
try {
  for (const name of names) delete process.env[name];
  process.env.NODE_ENV = 'test';
  await check();
  process.env.CODESPACE_NAME = 'test-workspace';
  process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN = 'app.github.dev';
  await check('https://test-workspace-3000.app.github.dev');
  process.env.PORT = '4567';
  await check('https://test-workspace-4567.app.github.dev');
  process.env.APP_ORIGIN = 'https://explicit.example';
  await check('https://explicit.example');
  process.env.NODE_ENV = 'production';
  delete process.env.APP_ORIGIN;
  assert.throws(() => registerAuth(express(), pool), /APP_ORIGIN is required/);
} finally {
  for (const name of names) { if (saved[name] === undefined) delete process.env[name]; else process.env[name] = saved[name]; }
}
console.log('Authentication origin checks passed: local, Codespaces, explicit overrides and cross-site protection.');
