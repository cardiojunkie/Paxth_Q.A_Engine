import assert from 'node:assert/strict';

const origin = new URL(process.argv[2] || 'http://127.0.0.1:3000');
const html = await fetch(new URL('/', origin), { signal: AbortSignal.timeout(10_000) });
assert.equal(html.status, 200, 'Frontend must return HTTP 200');
assert.match(await html.text(), /\/src\/main\.tsx/, 'Frontend must serve the development app');

const health = await fetch(new URL('/healthz', origin), { signal: AbortSignal.timeout(10_000) });
assert.equal(health.status, 200, 'Server must be ready');
assert.equal((await health.json()).status, 'ready');

const client = await fetch(new URL('/@vite/client', origin), { signal: AbortSignal.timeout(10_000) });
assert.equal(client.status, 200, 'Vite client must be available');
const token = (await client.text()).match(/const wsToken = ["']([^"']+)["']/)?.[1];
assert.ok(token, 'Vite client must supply its websocket token');

const endpoint = new URL('/', origin);
endpoint.protocol = endpoint.protocol === 'https:' ? 'wss:' : 'ws:';
endpoint.searchParams.set('token', token);
const socket = new WebSocket(endpoint, 'vite-hmr');
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Live reload did not connect on the frontend port')), 10_000);
    const finish = error => {
      clearTimeout(timer);
      error ? reject(error) : resolve();
    };
    socket.addEventListener('message', event => {
      try {
        assert.equal(JSON.parse(event.data).type, 'connected');
        finish();
      } catch (error) { finish(error); }
    }, { once: true });
    socket.addEventListener('error', () => finish(new Error('Live-reload websocket failed')), { once: true });
    socket.addEventListener('close', () => finish(new Error('Live-reload websocket closed before connecting')), { once: true });
  });
} finally { socket.close(); }

console.log('Development checks passed: frontend, readiness, and live reload share the frontend port.');
