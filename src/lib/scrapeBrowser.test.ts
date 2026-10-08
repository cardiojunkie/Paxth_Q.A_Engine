import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createConnection } from 'node:net';
import { readdir, readFile } from 'node:fs/promises';
import { scrapePage, collectPage } from './browserScrape';
import { startScrapeProxy, ScrapeError } from './scrapeNetwork';

let mode='complete', loads=0, privateHits=0, unsafeHits=0, browserCount=0;
const amazonUrl='http://www.amazon.ae/Fixture/dp/B0GQCXP6VM/ref?th=1&tag=a%2Bb&tag=second&blank=';
let amazonSubmissions=0, amazonProducts:string[]=[], amazonHomepages=0, amazonSubmittedAt=0;
const amazonFields={'amzn':'token+/=','amzn-r':'/Fixture/dp/B0GQCXP6VM/ref?th=1&tag=a+b','field-keywords':''};
const privateServer=createServer((_req,res)=>{privateHits++;res.end('secret');});
await new Promise<void>(resolve=>privateServer.listen(0,'127.0.0.1',resolve));
const fixture=createServer(async(req,res)=>{
  if(req.headers.host==='www.amazon.ae') {
    res.setHeader('Content-Type','text/html; charset=utf-8');
    const url=new URL(req.url!,amazonUrl);
    if(url.pathname==='/errors_page/validateCaptcha') {
      amazonSubmissions++;
      amazonSubmittedAt=performance.now();
      assert.equal(req.method,'GET');
      assert.deepEqual([...url.searchParams],Object.entries(amazonFields),'Native verification preserves every hidden field');
      if(mode==='amazon-hang-verification'){res.write('<html><body>Verification waiting');return;}
      res.setHeader('Set-Cookie','verified=1; Path=/; HttpOnly');
      const landing=mode.includes('homepage')?'/' : mode==='amazon-variant'?new URL(amazonUrl).pathname+'?th=2':mode==='amazon-private'?'http://127.0.0.1/private':new URL(amazonUrl).pathname+new URL(amazonUrl).search;
      res.writeHead(302,{Location:landing});res.end();return;
    }
    if(url.pathname==='/'){amazonHomepages++;res.end('<h1>Amazon homepage, not product evidence</h1>');return;}
    if(!url.pathname.includes('/dp/')&&!url.pathname.includes('/product')){if(url.pathname==='/purchase')unsafeHits++;res.end('resource');return;}
    amazonProducts.push(req.url!);
    if(req.headers.cookie?.includes('verified=1') && mode!=='amazon-persistent') {
      const asin=mode==='amazon-asin'?'B000000000':'B0GQCXP6VM';
      const title=mode==='amazon-no-title'?'':"setTimeout(()=>productTitle.textContent='Verified television',1200);";
      const changed=mode==='amazon-late-asin'?"setTimeout(()=>document.getElementById('ASIN').value='B000000000',2600);":'';
      res.end(`<title>Fixture television</title><input type="hidden" id="ASIN" name="ASIN" value="${asin}"><main><h1 id="productTitle"></h1><p>Requested television: 220 V</p></main><script>${title}${changed}</script>`);return;
    }
    const arabic=mode.includes('arabic');
    const message=arabic?'انقر فوق الزر أدناه لمتابعة التسوق':'Click the button below to continue shopping';
    const label=arabic?'متابعة التسوق.':'Continue shopping';
    const action=mode==='amazon-unsafe-action'?'/purchase':mode==='amazon-foreign-action'?'http://other.example/errors_page/validateCaptcha':'/errors_page/validateCaptcha';
    const inputs=Object.entries(amazonFields).filter(([name])=>mode!=='amazon-missing-field'||name!=='amzn-r').map(([name,value])=>`<input type="hidden" name="${name}" value="${value.replaceAll('&','&amp;')}">`).join('');
    const extra=mode==='amazon-captcha'?'<input name="captcha">':mode==='amazon-captcha-image'?'<img src="/captcha.png" alt="CAPTCHA">':mode==='amazon-multiple-submit'?'<button>Other submit</button>':'';
    const mutation=mode==='amazon-mutated-fields'?'<script>document.forms[0].onsubmit=()=>document.querySelector("input[name=amzn]").value="changed"</script>':'';
    res.end(`<title>Amazon.ae</title><h4>${message}</h4><form method="${mode==='amazon-post'?'post':'get'}" action="${action}">${inputs}<button type="submit">${label}</button>${extra}</form>${mutation}`);return;
  }
  if(req.url?.includes('/purchase') || req.url?.includes('/archive'))unsafeHits++;
  if(req.url==='/slow-data'){setTimeout(()=>res.end('Slow initial render: 240 V'),2500);return;}
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
  if(mode==='slow'){res.end('<main aria-busy="true" id="content"><h1>Slow product</h1><p id="initial"></p><button type="button" id="specs">Show specifications</button><p id="specification"></p></main><script>fetch("/slow-data").then(r=>r.text()).then(t=>{initial.textContent=t;content.setAttribute("aria-busy","false")});specs.onclick=()=>setTimeout(()=>specification.textContent="Slow specifications: 18 W",1800);</script>');return;}
  if(mode==='modal-order'){res.end('<header>Site chrome</header><main><h1>Dialog product</h1><button type="button" id="openDialog">View details</button><details><summary>Background specifications</summary><p>Background rating: 7 A</p></details></main><section>Outside main weight: 33 g</section><dialog id="lastDialog"><p>Dialog warranty: 48 months</p><button type="button" id="dismiss">Close</button></dialog><footer>Site footer</footer><script>openDialog.onclick=()=>lastDialog.showModal();dismiss.onclick=()=>lastDialog.close();</script>');return;}
  if(mode==='unclosed-dialog'){res.end('<main><h1>Unclosed dialog product</h1><button type="button" id="openDialog">View details</button></main><dialog id="lastDialog"><p>Dialog evidence retained</p></dialog><script>openDialog.onclick=()=>lastDialog.showModal();</script>');return;}
  if(mode==='variants'){res.end('<main><h1>Original product</h1><p id="identity">Original variant: 18 W</p><div role="progressbar" aria-valuenow="80" aria-valuemin="0" aria-valuemax="100">Rating: 80%</div><div class="Variant"><button role="tab" id="blue">Blue</button></div></main><script>blue.onclick=()=>identity.textContent="Other variant: 42 W";</script>');return;}
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
  const result=await collectPage('http://public.example/product?offer=42',AbortSignal.timeout(120000),proxyFactory);
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
  assert.equal(result.status,'collected');
  for(const code of ['BLOCKED_SUBRESOURCES','IFRAME_CONTENT_UNCHECKED'])assert.ok(result.report.warnings.some(w=>w.code===code),`Missing advisory ${code}`);
  mode='slow';
  const slow=await collectPage('http://public.example/product',AbortSignal.timeout(120000),proxyFactory);
  assert.equal(slow.status,'collected');
  for(const evidence of ['240 V','18 W'])assert.ok(slow.markdown.includes(evidence),`Missing delayed evidence: ${evidence}`);
  mode='modal-order';
  const dialog=await collectPage('http://public.example/product',AbortSignal.timeout(120000),proxyFactory);
  assert.equal(dialog.status,'collected');
  for(const evidence of ['48 months','7 A','33 g'])assert.ok(dialog.markdown.includes(evidence),`Missing dialog/body evidence: ${evidence}`);
  assert.doesNotMatch(dialog.markdown,/Site chrome|Site footer/);
  assert.equal(dialog.report.characters,dialog.markdown.length);
  mode='unclosed-dialog';
  const unresolvedDialog=await collectPage('http://public.example/product',AbortSignal.timeout(120000),proxyFactory);
  assert.equal(unresolvedDialog.status,'partial');
  assert.match(unresolvedDialog.markdown,/Dialog evidence retained/);
  assert.ok(unresolvedDialog.report.warnings.some(w=>w.code==='DIALOG_UNRESOLVED'));
  mode='variants';
  const variant=await collectPage('http://public.example/product',AbortSignal.timeout(120000),proxyFactory);
  assert.equal(variant.status,'collected','A determinate rating is not a loading spinner');
  assert.equal(variant.report.clicks,0,'Variant controls must remain untouched regardless of class casing');
  assert.match(variant.markdown,/Original variant: 18 W/);assert.doesNotMatch(variant.markdown,/Other variant: 42 W/);
  mode='blocked';
  await assert.rejects(scrapePage('http://public.example/product',AbortSignal.timeout(120000),proxyFactory),error=>error instanceof ScrapeError&&error.code==='PAGE_BLOCKED');
  mode='many';
  await assert.rejects(scrapePage('http://public.example/product',AbortSignal.timeout(120000),proxyFactory),error=>error instanceof ScrapeError&&error.code==='INCOMPLETE_CONTENT');
  mode='unsupported';
  const partial=await collectPage('http://public.example/product',AbortSignal.timeout(120000),proxyFactory);
  assert.equal(partial.status,'partial');
  assert.match(partial.markdown,/Product/);
  assert.doesNotMatch(partial.markdown,/Hidden evidence/);
  assert.deepEqual(partial.report.unresolvedControls,['Open archive']);
  await assert.rejects(scrapePage('http://public.example/product',AbortSignal.timeout(120000),proxyFactory),error=>error instanceof ScrapeError&&error.code==='INCOMPLETE_CONTENT');
  mode='changed';
  await assert.rejects(collectPage('http://public.example/product',AbortSignal.timeout(120000),proxyFactory),error=>error instanceof ScrapeError&&error.code==='PAGE_CHANGED'&&!('markdown' in error)&&error.report?.characters===0);
  for(const language of ['english','arabic'])for(const landing of ['direct','homepage']) {
    mode=`amazon-${language}-${landing}`;amazonSubmissions=0;amazonProducts=[];amazonHomepages=0;
    const recovered=await collectPage(amazonUrl,AbortSignal.timeout(120000),proxyFactory);
    assert.equal(recovered.status,'collected');
    assert.equal(recovered.finalUrl,amazonUrl);
    assert.match(recovered.markdown,/Verified television/);
    assert.match(recovered.markdown,/220 V/);
    assert.doesNotMatch(recovered.markdown,/continue shopping|متابعة التسوق|homepage/i);
    assert.equal(amazonSubmissions,1,'Exactly one verification submission');
    assert.deepEqual(amazonProducts,Array(2).fill(new URL(amazonUrl).pathname+new URL(amazonUrl).search),'Product requests preserve query values, duplicates and blanks');
    assert.equal(amazonHomepages,landing==='homepage'?1:0);
    assert.equal(recovered.report.clicks,1);
    assert.ok(recovered.report.warnings.some(w=>w.code==='AMAZON_CONTINUE_RECOVERED'));
    assert.doesNotMatch(JSON.stringify(recovered.report),/token|field-keywords|amzn-r/,'Diagnostics never disclose verification fields');
  }
  for(const scenario of ['persistent','captcha','captcha-image','post','unsafe-action','foreign-action','multiple-submit','missing-field','mutated-fields','asin','late-asin','variant','private','no-title','no-asin','hang-verification']) {
    mode=`amazon-${scenario}`;amazonSubmissions=0;amazonProducts=[];amazonHomepages=0;
    const changed=['asin','late-asin','variant','mutated-fields','private'].includes(scenario);
    const url=scenario==='no-asin'?amazonUrl.replace('/dp/B0GQCXP6VM','/product'):amazonUrl;
    await assert.rejects(collectPage(url,AbortSignal.timeout(120000),proxyFactory),error=>{
      assert.ok(error instanceof ScrapeError);
      assert.equal(error.code,changed?'PAGE_CHANGED':scenario==='no-title'?'PAGE_UNAVAILABLE':'PAGE_BLOCKED',scenario);
      assert.equal(error.report?.characters,0,'Hard failures discard all accumulated content');
      assert.ok(!('markdown' in error));
      return true;
    });
    assert.equal(amazonSubmissions,['persistent','asin','late-asin','variant','private','no-title','hang-verification'].includes(scenario)?1:0,scenario);
    if(scenario==='hang-verification')assert.ok(performance.now()-amazonSubmittedAt<20_000,'Recovery stays within 15 seconds plus cleanup');
  }
  assert.equal(privateHits,0,'Private verification redirects cannot reach the host');
  assert.equal(unsafeHits,0,'Unsafe form actions are never submitted');
  const privateTarget=()=>startScrapeProxy((async()=>[{address:'127.0.0.1',family:4}]) as any,()=>{throw new Error('A private target must never be dialled');});
  await assert.rejects(collectPage('http://public.example/product',AbortSignal.timeout(120000),privateTarget),error=>error instanceof ScrapeError&&error.code==='PRIVATE_ADDRESS'&&!('markdown' in error));
  const timedTarget=()=>startScrapeProxy((async()=>{throw new ScrapeError('Public URL lookup timed out.',504,'TIMEOUT');}) as any);
  await assert.rejects(collectPage('http://public.example/product',AbortSignal.timeout(120000),timedTarget),error=>error instanceof ScrapeError&&error.code==='TIMEOUT'&&error.message==='Public URL lookup timed out.');
  mode='hang';
  await assert.rejects(scrapePage('http://public.example/product',AbortSignal.timeout(5000),proxyFactory),error=>error instanceof ScrapeError&&error.code==='CANCELLED');
  const remaining=await Promise.all((await readdir('/proc')).filter(p=>/^\d+$/.test(p)).map(async pid=>{
    const cmd=await readFile(`/proc/${pid}/cmdline`,'utf8').catch(()=> '');
    return cmd.split('\0')[0].endsWith('/chrome') && cmd.includes('paxth-browser-') ? pid : null;
  }));
  assert.deepEqual(remaining.filter(Boolean),[],'Cancellation leaves no live Chromium process');
  console.log('Real CloakBrowser + Scrapling checks passed: delayed rendering, disclosures, dialogs, lazy loading, access blocks, page identity, limits and bounded Amazon English/Arabic recovery.');
} finally {
  fixture.closeAllConnections();privateServer.closeAllConnections();
  await Promise.all([new Promise<void>(resolve=>fixture.close(()=>resolve())),new Promise<void>(resolve=>privateServer.close(()=>resolve()))]);
}
