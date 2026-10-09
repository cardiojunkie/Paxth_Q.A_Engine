import assert from 'node:assert/strict';
import { acquireScrapeSlot, collectPage, isPublicAddress, ScrapeError, validateScrapeInput } from './cloudScrape';
import { resolvePublicAddress } from './scrapeNetwork';

const originalFetch = globalThis.fetch, originalKey = process.env.CRAWL4AI_API_KEY;
const signal = new AbortController().signal;
const hasCode = (code: string) => (error: unknown) => error instanceof ScrapeError && error.code === code;
const keepAlive = setInterval(() => {}, 1000);
const url = 'https://8.8.8.8/product?variant=42';
const markdown = '# منتج café 😀 漢字\n| Price | ₹1,299 · ر.س ٢٠ |\n[Manual](https://example.com/manual)';
let requests = 0;
const success = async (_url: any, init?: RequestInit) => {
  requests++;
  assert.equal(String(_url), 'https://api.crawl4ai.com/scrape');
  assert.equal(init?.method, 'POST'); assert.equal(init?.redirect, 'error');
  assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer cloud-only-key');
  assert.deepEqual(JSON.parse(init?.body as string), { url, format: 'md' });
  assert.doesNotMatch(init?.body as string, /cloud-only-key|LLM_API_KEY|AICREDITS_API_KEY/);
  return Response.json({ ok: true, markdown });
};
try {
  assert.equal(validateScrapeInput({ url: 'example.com/product?variant=42#specs' }).url, 'https://example.com/product?variant=42');
  for (const url of ['', 'ftp://example.com', 'https://user:pass@example.com', 'http://127.0.0.1', 'http://[::1]', 'http://169.254.169.254', 'http://service.local', 'https://example.com\\bad', 'http://example.com:5432']) assert.throws(() => validateScrapeInput({ url }));
  for (const ip of ['127.0.0.1','100.64.0.1','192.0.2.1','::1','fe80::1','fc00::1','::ffff:8.8.8.8','2001:db8::1']) assert.equal(isPublicAddress(ip), false);
  for (const ip of ['8.8.8.8','1.1.1.1','2606:4700:4700::1111']) assert.equal(isPublicAddress(ip), true);
  await assert.rejects(resolvePublicAddress(new URL('https://example.com'), (async () => [{ address: '8.8.8.8', family: 4 }, { address: '10.0.0.1', family: 4 }]) as any), hasCode('PRIVATE_ADDRESS'));
  await assert.rejects(resolvePublicAddress(new URL('https://example.com'), (() => new Promise(() => {})) as any, AbortSignal.timeout(20)), { name: 'AbortError' });
  globalThis.fetch = success;
  delete process.env.CRAWL4AI_API_KEY;
  await assert.rejects(collectPage(url, signal), hasCode('SCRAPER_NOT_CONFIGURED'));
  assert.equal(requests, 0);
  process.env.CRAWL4AI_API_KEY = ' cloud-only-key ';
  await assert.rejects(collectPage('http://127.0.0.1', signal), hasCode('INVALID_URL'));
  await assert.rejects(collectPage('https://example.com', signal, (async () => [{ address: '10.0.0.1', family: 4 }]) as any), hasCode('PRIVATE_ADDRESS'));
  assert.equal(requests, 0, 'Private targets are rejected before cloud collection');
  const page = await collectPage(url + '#specs', signal);
  assert.equal(requests, 1); assert.equal(page.markdown, markdown);
  assert.equal(page.method, 'cloud'); assert.equal(page.crawler, 'crawl4ai');
  assert.equal(page.finalUrl, null); assert.equal(page.capturedAt, null);
  assert.ok(Number.isFinite(Date.parse(page.receivedAt!)));
  assert.equal(page.report.characters, markdown.length);
  assert.ok(!('clicks' in page.report)); assert.ok(!('scrolls' in page.report));
  assert.doesNotMatch(JSON.stringify(page), /cloud-only-key/);
  (await acquireScrapeSlot(signal))();
  const failed = async (response: () => Response, code: string, status?: number) => {
    let calls = 0;
    globalThis.fetch = async () => { calls++; return response(); };
    await assert.rejects(collectPage(url, signal), error => {
      assert.ok(hasCode(code)(error));
      const failure = error as ScrapeError;
      if (status) assert.equal(failure.status, status);
      assert.equal(failure.report?.characters, 0);
      assert.doesNotMatch(failure.message, /cloud-only-key|private-header|evil\.example/);
      return true;
    });
    assert.equal(calls, 1, 'Cloud calls never retry automatically');
    (await acquireScrapeSlot(signal))();
  };
  for (const body of ['broken JSON', 'null', '[]', '{"ok":false,"markdown":"unusable"}']) {
    await failed(() => new Response(body), 'INVALID_RESPONSE');
  }
  for (const body of [{ ok: true }, { ok: true, markdown: '' }, { ok: true, markdown: ' \n ' }, { ok: true, markdown: 42 }]) {
    await failed(() => Response.json(body), 'EMPTY_PAGE');
  }
  await failed(() => Response.json({ ok: true, markdown: 'x'.repeat(200001) }), 'CONTENT_TOO_LARGE', 413);
  let cancelledBody = false;
  await failed(() => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(4 * 1024 * 1024 + 1)); },
    cancel() { cancelledBody = true; },
  })), 'CONTENT_TOO_LARGE', 413);
  assert.equal(cancelledBody, true);
  for (const [status, reason, code, resultStatus] of [
    [401, 'cloud-only-key', 'SCRAPER_AUTH_FAILED', 502], [403, 'private-header', 'SCRAPER_AUTH_FAILED', 502],
    [403, 'blocked', 'PAGE_BLOCKED', 502], [403, 'login-wall', 'PAGE_LOGIN_REQUIRED', 502],
    [402, 'no_credit', 'SCRAPER_CREDITS_EXHAUSTED', 402], [402, 'spend_cap', 'SCRAPER_CREDITS_EXHAUSTED', 402],
    [402, 'plan_cap', 'SCRAPER_CREDITS_EXHAUSTED', 402], [429, 'rate', 'RATE_LIMITED', 429],
    [503, 'fleet-busy', 'FLEET_BUSY', 503], [504, 'deadline', 'TIMEOUT', 504],
    [400, 'url', 'INVALID_URL', 400], [502, 'no-answer', 'PAGE_UNAVAILABLE', 502],
    [302, 'redirect', 'API_REDIRECT', 502],
  ] as const) await failed(() => Response.json({ error: reason, message: 'cloud-only-key Bearer private-header https://evil.example' }, { status }), code, resultStatus);
  for (const [reason, code] of [['blocked', 'PAGE_BLOCKED'], ['login-wall', 'PAGE_LOGIN_REQUIRED'], ['cooldown', 'PAGE_UNAVAILABLE']] as const) {
    await failed(() => Response.json({ ok: false, reason, message: 'cloud-only-key Bearer private-header https://evil.example' }, { status: 403 }), code, 502);
  }
  for (const cause of [{ code: 'ECONNRESET' }, { errors: [{ code: 'SECRET=cloud-only-key' }, { code: 'ENETUNREACH' }] }]) {
    globalThis.fetch = async () => { throw new TypeError('cloud-only-key private-header', { cause }); };
    await assert.rejects(collectPage(url, signal), error => {
      assert.ok(error instanceof ScrapeError); assert.equal(error.code, 'CONNECTION_FAILED');
      assert.match(error.message, /api\.crawl4ai\.com.*(ECONNRESET|ENETUNREACH)/);
      assert.doesNotMatch(error.message, /SECRET|cloud-only-key|private-header/); return true;
    });
  }
  await assert.rejects(collectPage(url, AbortSignal.abort()), hasCode('CANCELLED'));
  const controller = new AbortController();
  let streamCancelled = false;
  globalThis.fetch = async () => new Response(new ReadableStream({
    start() { setTimeout(() => controller.abort(), 10); }, cancel() { streamCancelled = true; },
  }));
  await assert.rejects(collectPage(url, controller.signal), hasCode('CANCELLED'));
  assert.equal(streamCancelled, true);
  const nativeTimeout = AbortSignal.timeout;
  AbortSignal.timeout = ms => nativeTimeout(ms === 120_000 ? 20 : ms);
  globalThis.fetch = async () => new Response(new ReadableStream({ start() {} }));
  try { await assert.rejects(collectPage(url, signal), hasCode('TIMEOUT')); }
  finally { AbortSignal.timeout = nativeTimeout; }
  (await acquireScrapeSlot(signal))();
  const release = await acquireScrapeSlot(signal);
  const cancelled = new AbortController();
  const queuedAbort = acquireScrapeSlot(cancelled.signal);
  cancelled.abort(); await assert.rejects(queuedAbort, { name: 'AbortError' });
  await assert.rejects(acquireScrapeSlot(signal, 10), hasCode('QUEUE_TIMEOUT'));
  const queued = Array.from({ length: 8 }, () => acquireScrapeSlot(signal));
  await assert.rejects(acquireScrapeSlot(signal), hasCode('QUEUE_FULL'));
  release(); release();
  for (const slot of queued) (await slot)();
  (await acquireScrapeSlot(signal))();
} finally {
  clearInterval(keepAlive); globalThis.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.CRAWL4AI_API_KEY; else process.env.CRAWL4AI_API_KEY = originalKey;
}
console.log('Cloud collection checks passed: authentication, URL/DNS boundaries, Unicode, limits, safe errors, deadlines, cancellation and admission.');
