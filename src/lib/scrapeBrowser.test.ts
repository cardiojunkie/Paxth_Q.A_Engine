import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createConnection } from 'node:net';
import { readdir, readFile } from 'node:fs/promises';
import { scrapePage } from './browserScrape';
import { startScrapeProxy, ScrapeError } from './scrapeNetwork';

let mode='complete', loads=0, privateHits=0, unsafeHits=0, browserCount=0;
const privateServer=createServer((_req,res)=>{privateHits++;res.end('secret');});
await new Promise<void>(resolve=>privateServer.listen(0,'127.0.0.1',resolve));
const fixture=createServer(async(req,res)=>{
  if(req.url?.includes('/purchase') || req.url?.includes('/archive'))unsafeHits++;
  if(!req.url?.includes('/product')){res.end('resource');return;}
  loads++;
  const browsers=await Promise.all((await readdir('/proc')).filter(pid=>/^\d+$/.test(pid)).map(async pid=>{
    const cmd=await readFile(`/proc/${pid}/cmdline`,'utf8').catch(()=> '');
    return cmd.split('\0')[0].endsWith('/chrome') && !cmd.includes('--type=') && await owned(pid) ? pid : null;
  }));
  browserCount=Math.max(browserCount,browsers.filter(Boolean).length);
  res.setHeader('Content-Type','text/html; charset=utf-8');
  if(mode==='hang'){res.write('<html><main>Loading');return;}
  if(mode==='blocked'){res.end('<title>Just a moment</title><body>Verify you are human</body>');return;}
  if(mode==='unsupported'){res.end('<main><p>Product</p><button type="button" aria-controls="hiddenPanel">Open archive</button><section id="hiddenPanel" hidden>Hidden evidence</section></main>');return;}
  if(mode==='changed'){res.end('<main>Product<script>location.href="/product?variant=other"</script></main>');return;}
  if(mode==='many'){res.end('<main>'+Array.from({length:21},(_,i)=>`<details><summary>Detail ${i}</summary><p>Evidence ${i}</p></details>`).join('')+'</main>');return;}
  res.end(`<!doctype html><html><title>Product fixture</title><base href="http://public.example/catalog/"><main>
  <h1>Product café 😀 漢字</h1><p id="delayed"></p><a href="../manual?lang=en">Product guide</a><img src="image.png" alt="Product photo">
  <div role="tablist"><button type="button" role="tab" aria-selected="true" id="tab1">Overview</button><button type="button" role="tab" aria-selected="false" id="tab2">Dimensions</button></div>
  <section id="panel1"><p>First tab: 12.75 kg</p></section><section id="panel2" hidden><table><tr><th>Width</th><th>Depth</th></tr><tr><td>42.5 cm</td><td>17 cm</td></tr></table></section>
  <details><summary>Care instructions</summary><p>Accordion: clean gently</p></details>
  <button type="button" id="modalButton">View details</button><dialog id="modal"><p>Modal warranty: 36 months</p><button type="button" id="closeModal">Close</button></dialog>
  <button type="button" id="more">Show more</button><p id="moreText"></p>
  <button type="button" id="archive">Open archive</button><p id="archiveText"></p>
  <button type="button" id="purchase">Buy now</button><form><button>Submit</button></form>
  <div style="height:1500px"></div><p id="lazy"></p><iframe src="http://internal.example/private"></iframe></main>
  <script>
  let harmful=0;purchase.onclick=()=>{harmful++;fetch('/purchase',{method:'POST'});};
  setTimeout(()=>delayed.textContent='Delayed render: 220 V',650);
  tab2.onclick=()=>{panel1.hidden=true;panel2.hidden=false;tab1.setAttribute('aria-selected','false');tab2.setAttribute('aria-selected','true');};
  tab1.onclick=()=>{panel1.hidden=false;panel2.hidden=true;tab2.setAttribute('aria-selected','false');tab1.setAttribute('aria-selected','true');};
  modalButton.onclick=()=>modal.showModal();closeModal.onclick=()=>modal.close();
  more.onclick=()=>{moreText.textContent='Expanded rating: 4.8 / 5';more.remove();};
  archive.onclick=()=>{archiveText.textContent='Archive serial: ABC-007';fetch('/archive');};
  window.addEventListener('scroll',()=>{if(scrollY>500)lazy.textContent='Lazy stock: 19 units';});
  fetch('http://127.0.0.1:${(privateServer.address() as any).port}/private').catch(()=>{});
  fetch('http://internal.example/private').catch(()=>{});
  new WebSocket('ws://127.0.0.1:${(privateServer.address() as any).port}/socket');
  navigator.serviceWorker.register('/worker.js').catch(()=>{});
  </script></html>`);
});
await new Promise<void>(resolve=>fixture.listen(0,'127.0.0.1',resolve));
const proxyFactory=()=>startScrapeProxy((async(host:string)=>[{address:host==='internal.example'?'127.0.0.1':'8.8.8.8',family:4}]) as any,(options:any)=>{
  assert.equal(options.host,'8.8.8.8');return createConnection({host:'127.0.0.1',port:(fixture.address() as any).port});
});
const owned = async (pid: string) => {
  for(let hops=0;hops<50 && Number(pid)>1;hops++) {
    if(Number(pid)===process.pid)return true;
    const status=await readFile(`/proc/${pid}/status`,'utf8').catch(()=> '');
    pid=status.match(/PPid:\s+(\d+)/)?.[1] || '1';
  }
  return false;
};
try {
  const result=await scrapePage('http://public.example/product?offer=42',AbortSignal.timeout(120000),proxyFactory);
  const {markdown}=result;
  assert.equal(result.requestedUrl,'http://public.example/product?offer=42');
  assert.equal(result.finalUrl,result.requestedUrl);
  for(const evidence of ['café 😀 漢字','12.75 kg','42.5 cm','17 cm','clean gently','36 months','4.8 / 5','19 units','220 V','offer=42'])assert.ok(markdown.includes(evidence),`Missing evidence: ${evidence}\n${markdown}`);
  assert.match(markdown,/\|.*Width.*Depth.*\|/);
  assert.equal(browserCount,1,'Exactly one CloakBrowser, no extraction browser or navigation model');
  assert.ok(markdown.includes('http://public.example/manual?lang=en'));
  assert.ok(markdown.includes('http://public.example/catalog/image.png'));
  assert.doesNotMatch(markdown,/ABC-007/);
  assert.equal(unsafeHits,0,'Unrelated buttons, forms and purchases are never clicked');
  assert.equal(loads,1,'Capture and Markdown conversion never refetch the product page');
  assert.equal(privateHits,0,'Private subresources and WebSockets cannot reach the host');
  mode='blocked';
  await assert.rejects(scrapePage('http://public.example/product',AbortSignal.timeout(120000),proxyFactory),error=>error instanceof ScrapeError&&error.code==='PAGE_BLOCKED');
  mode='many';
  await assert.rejects(scrapePage('http://public.example/product',AbortSignal.timeout(120000),proxyFactory),error=>error instanceof ScrapeError&&error.code==='INCOMPLETE_CONTENT');
  mode='unsupported';
  await assert.rejects(scrapePage('http://public.example/product',AbortSignal.timeout(120000),proxyFactory),error=>error instanceof ScrapeError&&error.code==='INCOMPLETE_CONTENT');
  mode='changed';
  await assert.rejects(scrapePage('http://public.example/product',AbortSignal.timeout(120000),proxyFactory),error=>error instanceof ScrapeError&&error.code==='PAGE_CHANGED');
  mode='hang';
  await assert.rejects(scrapePage('http://public.example/product',AbortSignal.timeout(5000),proxyFactory),error=>error instanceof ScrapeError&&error.code==='CANCELLED');
  const remaining=await Promise.all((await readdir('/proc')).filter(p=>/^\d+$/.test(p)).map(async pid=>{
    const cmd=await readFile(`/proc/${pid}/cmdline`,'utf8').catch(()=> '');
    return cmd.split('\0')[0].endsWith('/chrome') && cmd.includes('paxth-browser-') ? pid : null;
  }));
  assert.deepEqual(remaining.filter(Boolean),[],'Cancellation leaves no live Chromium process');
  console.log('Real CloakBrowser + Scrapling checks passed: delayed rendering, tabs, tables, Unicode, disclosures, modals, lazy loading, relative links, access blocks, unsupported panels, page identity and interaction limits.');
} finally {
  fixture.closeAllConnections();privateServer.closeAllConnections();
  await Promise.all([new Promise<void>(resolve=>fixture.close(()=>resolve())),new Promise<void>(resolve=>privateServer.close(()=>resolve()))]);
}
