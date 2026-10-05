import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { createConnection } from 'node:net';
import { isPublicAddress, validateScrapeInput, acquireScrapeSlot, scrapeWithAgent } from './scrapeAgent';
import { startScrapeProxy, resolvePublicAddress, ScrapeError } from './scrapeNetwork';

const url = 'https://example.com/product?variant=42&colour=black';
assert.equal(validateScrapeInput({ url: 'example.com/product?variant=42&colour=black#specs' }).url, url);
for (const value of [null, 42, '', 'file:///etc/passwd', 'javascript:alert(1)', 'https://user:pass@example.com', 'http://127.1', 'http://2130706433', 'http://[::1]', 'http://10.1.1.1', 'http://service.local', 'http://localhost', 'https://example.com\\bad', 'http://example.com:0', 'http://example.com:5432']) {
  assert.throws(() => validateScrapeInput({ url: value }));
}
for (const address of ['127.0.0.1', '169.254.169.254', '100.64.0.1', '192.0.2.1', '::1', 'fe80::1', 'fc00::1', '::ffff:8.8.8.8', '2001:db8::1', '2002:0808:0808::1']) assert.equal(isPublicAddress(address), false, address);
for (const address of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111']) assert.equal(isPublicAddress(address), true, address);
await assert.rejects(resolvePublicAddress(new URL(url), (async () => [{ address: '8.8.8.8', family: 4 }, { address: '10.0.0.1', family: 4 }]) as any), /public internet/);

const upstream = createServer((req, res) => res.end('Fetched ' + req.url));
await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve));
let lookups = 0, connections = 0, privateDns = false;
const resolve = (async () => { lookups++; return [{ address: privateDns ? '127.0.0.1' : '93.184.216.34', family: 4 }]; }) as any;
const connect = ((options: any) => {
  assert.equal(options.host, '93.184.216.34', 'Connect to the validated IP, never resolve the hostname again');
  connections++;
  return createConnection({ host: '127.0.0.1', port: (upstream.address() as any).port });
}) as typeof createConnection;
const proxy = await startScrapeProxy(resolve, connect);
const throughProxy = (target: string, method = 'GET') => new Promise<{ status: number; body: string }>((accept, reject) => {
  const req = request(proxy.server, { method, path: target, agent: false }, res => {
    let body = ''; res.on('data', chunk => body += chunk); res.on('end', () => accept({ status: res.statusCode!, body }));
  });
  req.on('connect', (res, socket) => { socket.destroy(); accept({ status: res.statusCode!, body: '' }); });
  req.on('error', reject); req.end();
});
try {
  assert.deepEqual(await throughProxy('http://example.com/product?variant=42&colour=black'), { status: 200, body: 'Fetched /product?variant=42&colour=black' });
  assert.equal((await throughProxy('example.com:443', 'CONNECT')).status, 200);
  assert.equal(connections, 2); assert.equal(lookups, 2);
  privateDns = true;
  assert.equal((await throughProxy('http://example.com/rebound')).status, 403, 'Re-resolve and validate every new connection');
  assert.equal((await throughProxy('example.com:443', 'CONNECT')).status, 403);
  for (const target of ['http://127.0.0.1/', 'http://[::1]/', 'http://169.254.169.254/latest/meta-data/', 'http://user:pass@example.com/']) assert.equal((await throughProxy(target)).status, 403);
  assert.equal((await throughProxy('127.0.0.1:443', 'CONNECT')).status, 403);
  assert.equal((await throughProxy('example.com:5432', 'CONNECT')).status, 403);
  assert.equal(connections, 2, 'Rejected addresses never reach TCP connect');
} finally {
  await proxy.close(); upstream.closeAllConnections();
  await new Promise<void>(resolve => upstream.close(() => resolve()));
}

const signal = new AbortController().signal;
const release = await acquireScrapeSlot(signal);
const order: number[] = [];
const queued = Array.from({ length: 8 }, (_, index) => acquireScrapeSlot(signal).then(done => { order.push(index); done(); }));
await assert.rejects(acquireScrapeSlot(signal), /queue is full/);
release(); release(); await Promise.all(queued);
assert.deepEqual(order, [0, 1, 2, 3, 4, 5, 6, 7]);
const hold = await acquireScrapeSlot(signal);
const cancelled = new AbortController();
const cancelledWait = acquireScrapeSlot(cancelled.signal);
cancelled.abort(new Error('Cancelled in queue'));
await assert.rejects(cancelledWait, /Cancelled in queue/);
await assert.rejects(acquireScrapeSlot(signal, 5), /waiting for the browser/);
hold();
await assert.rejects(scrapeWithAgent(url, AbortSignal.abort()), { name: 'AbortError' });
let closed = false;
await assert.rejects(scrapeWithAgent(url, signal, async () => { throw new Error('Missing libraries'); }, async () => ({ server: 'http://127.0.0.1:1234', blocked: undefined, close: async () => { closed = true; } })), (error: any) => error instanceof ScrapeError && error.code === 'BROWSER_UNAVAILABLE');
assert.equal(closed, true);
const afterFailure = await acquireScrapeSlot(signal); afterFailure();
console.log('Scraper checks passed: URL validation, pinned public egress, DNS rebinding rejection, bounded FIFO admission and cleanup.');
