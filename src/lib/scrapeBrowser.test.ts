import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createConnection } from 'node:net';
import type { Browser } from 'playwright-core';
import { scrapeWithAgent, launchScrapeBrowser } from './scrapeAgent';
import { startScrapeProxy } from './scrapeNetwork';

let privateHits = 0;
const privateServer = createServer((_req, res) => { privateHits++; res.end('Private secret'); });
await new Promise<void>(resolve => privateServer.listen(0, '127.0.0.1', resolve));
const privatePort = (privateServer.address() as any).port;
const fixture = createServer((req, res) => {
  const path = new URL(req.url!, 'http://fixture.example').pathname;
  if (path === '/redirect') { res.writeHead(302, { Location: '/redirect/?variant=42' }); res.end(); return; }
  if (path === '/switch') { res.writeHead(302, { Location: '/product?variant=43' }); res.end(); return; }
  if (path === '/private-redirect') { res.writeHead(302, { Location: `http://127.0.0.1:${privatePort}/secret` }); res.end(); return; }
  res.setHeader('Content-Type', 'text/html');
  if (path === '/empty') { res.end('<html><body><p></p></body></html>'); return; }
  if (path === '/blocked') { res.end('<title>Access Denied</title><p>Verify you are human</p>'); return; }
  if (path === '/oversize') { res.end('<p>' + 'x'.repeat(200001) + '</p>'); return; }
  if (path === '/infinite') { res.end('<title>Infinite</title><h1>Products</h1><div style="height:1100px">Items</div><script>onscroll=()=>{document.body.insertAdjacentHTML("beforeend", "<div style=height:1100px>More items</div>")}</script>'); return; }
  if (path === '/changing') { res.end('<title>Changing</title><p id="count"></p><script>setInterval(()=>count.textContent=Date.now(),50)</script>'); return; }
  if (path === '/delayed') { res.end('<title>Delayed product</title><p id="data">Loading...</p><script>setTimeout(()=>data.textContent="Delayed product specifications: Weight 120 g",700)</script>'); return; }
  if (path === '/many-details') { res.end('<title>Details</title><h1>Product</h1>' + '<details><summary>Section</summary>Content</details>'.repeat(21)); return; }
  if (path === '/leave') { res.end('<title>Product</title><p>Product text</p><button aria-expanded="false" onclick="location.href=\'/other-product\'">Description</button>'); return; }
  if (path === '/private-resources') {
    res.end(`<title>Safe product</title><h1>Public product</h1><p>Size: 20 cm</p><script>
      fetch('http://127.0.0.1:${privatePort}/secret').catch(()=>{});
      fetch('http://internal.example/secret').catch(()=>{});
      new WebSocket('ws://127.0.0.1:${privatePort}/socket');
      </script><iframe src="http://127.0.0.1:${privatePort}/frame"></iframe>`); return;
  }
  res.end(`<!doctype html><title>Fixture product</title>
    <nav>Navigation junk</nav><header>Header junk</header><aside>Cookie notice</aside><main><h1>Fixture product</h1>
    <p>Original description and price AED 100</p><p>Requested: ${req.url}</p>
    <form>Form junk<input value="Private form value"><button>Buy now</button></form>
    <div data-ad-slot="one">Advertising junk</div>
    <details ontoggle="if(this.open)setTimeout(()=>document.getElementById('warranty').textContent='Warranty: 2 years',600)"><summary>Warranty</summary><p id="warranty">Loading warranty</p></details>
    <button onclick="document.getElementById('extra').hidden=false;this.hidden=true">Read more</button><p id="extra" hidden>Additional product description</p>
    <button role="tab" aria-controls="specs" aria-selected="false" onclick="document.getElementById('specs').hidden=false;this.setAttribute('aria-selected','true')">Specifications</button>
    <section id="specs" hidden><table><tr><th>Memory</th><td>12 GB</td></tr><tr><th>Storage</th><td>256 GB</td></tr></table></section>
    <div style="height:1300px"></div><div id="lazy"></div>
    <script>addEventListener('scroll',()=>{document.getElementById('lazy').textContent='Lazy-loaded seller: QMKP'}, {once:true})</script>
    </main><footer>Footer junk</footer>`);
});
await new Promise<void>(resolve => fixture.listen(0, '127.0.0.1', resolve));
const browsers: Browser[] = [];
const launch = async (proxy: { server: string }) => { const browser = await launchScrapeBrowser(proxy); browsers.push(browser); return browser; };
const resolve = (async (host: string) => [{ address: host === 'fixture.example' ? '93.184.216.34' : '127.0.0.1', family: 4 }]) as any;
const connect = ((options: any) => {
  assert.equal(options.host, '93.184.216.34');
  return createConnection({ host: '127.0.0.1', port: (fixture.address() as any).port });
}) as typeof createConnection;
const createProxy = () => startScrapeProxy(resolve, connect);
const scrape = (path: string, signal = AbortSignal.timeout(40000)) => scrapeWithAgent('http://fixture.example' + path, signal, launch, createProxy);
try {
  const content = await scrape('/product?offer=offer_1093511587&sid=QMKP&sellerId=11587');
  for (const text of ['Fixture product', 'Original description', 'Warranty: 2 years', 'Additional product description', 'Memory', '12 GB', '256 GB', 'Lazy-loaded seller: QMKP', 'offer=offer_1093511587&sid=QMKP&sellerId=11587']) assert.ok(content.includes(text), text);
  assert.doesNotMatch(content, /Navigation junk|Header junk|Footer junk|Cookie notice|Advertising junk|Form junk|Private form value|Buy now|addEventListener/);
  assert.match(await scrape('/delayed'), /Weight 120 g/);
  assert.match(await scrape('/redirect?variant=42'), /Retrieved URL: <http:\/\/fixture.example\/redirect\/\?variant=42>/);
  assert.match(await scrape('/private-resources'), /Public product/);
  assert.equal(privateHits, 0, 'Private fetches, frames and WebSockets never reach their destination');
  for (const [path, code] of [
    ['/switch?variant=42', 'PAGE_CHANGED'], ['/blocked', 'PAGE_BLOCKED'], ['/oversize', 'CONTENT_TOO_LARGE'],
    ['/many-details', 'INCOMPLETE_CONTENT'], ['/changing', 'INCOMPLETE_CONTENT'], ['/infinite', 'INCOMPLETE_CONTENT'],
    ['/empty', 'EMPTY_PAGE'], ['/leave', 'PAGE_CHANGED'],
  ]) {
    await assert.rejects(scrape(path), (error: any) => error.code === code, path);
  }
  await assert.rejects(scrape('/private-redirect'));
  assert.equal(privateHits, 0);
  await assert.rejects(scrape('/empty', AbortSignal.timeout(1000)), (error: any) => error.code === 'CANCELLED');
  assert.ok(browsers.every(browser => !browser.isConnected()), 'All successful, failed and cancelled scrapes close their browser');
  console.log('Real browser checks passed: rendering, lazy loading, disclosures, tabs, query identity, private egress, errors, limits and cancellation.');
} finally {
  await Promise.all(browsers.map(browser => browser.close()));
  fixture.closeAllConnections(); privateServer.closeAllConnections();
  await Promise.all([new Promise<void>(resolve => fixture.close(() => resolve())), new Promise<void>(resolve => privateServer.close(() => resolve()))]);
}
