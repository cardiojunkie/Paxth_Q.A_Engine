import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer, request } from 'node:http';
import { createConnection } from 'node:net';
import { acquireScrapeSlot, runScrapeWorker, validateScrapeInput, isPublicAddress, scrapePage } from './browserScrape';
import { resolvePublicAddress, startScrapeProxy, ScrapeError } from './scrapeNetwork';

const signal = new AbortController().signal;
const hasCode = (code: string) => (error: unknown) => error instanceof ScrapeError && error.code === code;
assert.equal(validateScrapeInput({ url: 'example.com/product?variant=42#specs' }).url, 'https://example.com/product?variant=42');
for (const url of ['', 'ftp://example.com', 'https://user:pass@example.com', 'http://127.0.0.1', 'http://[::1]', 'http://169.254.169.254', 'http://service.local', 'https://example.com\\bad', 'http://example.com:5432']) assert.throws(() => validateScrapeInput({ url }));
for (const ip of ['127.0.0.1','100.64.0.1','192.0.2.1','::1','fe80::1','fc00::1','::ffff:8.8.8.8','2001:db8::1']) assert.equal(isPublicAddress(ip), false);
for (const ip of ['8.8.8.8','1.1.1.1','2606:4700:4700::1111']) assert.equal(isPublicAddress(ip), true);
await assert.rejects(resolvePublicAddress(new URL('https://example.com'), (async () => [{ address: '8.8.8.8', family: 4 }, { address: '10.0.0.1', family: 4 }]) as any), hasCode('PRIVATE_ADDRESS'));
await assert.rejects(resolvePublicAddress(new URL('https://example.com'), (() => new Promise(() => {})) as any, AbortSignal.timeout(20)), { name: 'AbortError' });
await assert.rejects(scrapePage('https://example.com', AbortSignal.abort()), hasCode('CANCELLED'));

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

let dnsReads=0, hits=0;
const fixture=createServer((_req,res)=>{hits++;res.end('public fixture');});
await new Promise<void>(resolve=>fixture.listen(0,'127.0.0.1',resolve));
const dialed: string[]=[];
const proxy=await startScrapeProxy((async()=>[{address:++dnsReads===1?'8.8.8.8':'127.0.0.1',family:4}]) as any, (options:any)=>{
  dialed.push(options.host);
  return createConnection({host:'127.0.0.1',port:(fixture.address() as any).port});
});
const proxied=(url:string)=>new Promise<number>((resolve,reject)=>{
  const req=request(proxy.server,{path:url,headers:{Connection:'close'}},res=>{res.resume();res.once('end',()=>resolve(res.statusCode!));});
  req.once('error',reject);req.end();
});
try {
  assert.equal(await proxied('http://public.example/product'),200);
  assert.equal(await proxied('http://public.example/product'),403,'A new connection revalidates DNS');
  assert.equal(await proxied('http://169.254.169.254/latest/meta-data'),403);
  assert.deepEqual(dialed,['8.8.8.8'],'Only validated numeric IPs reach TCP dialing');
  assert.equal(hits,1);
} finally {await proxy.close();await new Promise<void>(resolve=>fixture.close(()=>resolve()));}

// A tiny protocol worker verifies process handling without requiring Python or Chromium.
const folder=await mkdtemp(path.join(tmpdir(),'paxth-worker-check-'));
const python=process.env.SCRAPER_PYTHON,headless=process.env.SCRAPER_HEADLESS;
process.env.SCRAPER_PYTHON=process.execPath;process.env.SCRAPER_HEADLESS='true';
const worker=path.join(folder,'worker.mjs');
await writeFile(worker,`import fs from 'node:fs';import {spawn} from 'node:child_process';
const input=JSON.parse(fs.readFileSync(0,'utf8'));
if(input.mode==='crash')process.exit(1);
else if(input.mode==='large')process.stdout.write('x'.repeat(4*1024*1024+1));
else if(input.mode==='error')console.log(JSON.stringify({error:true,code:'PAGE_BLOCKED',details:'private-secret'}));
else if(input.mode==='startup-error')console.log(JSON.stringify({error:true,code:'BROWSER_UNAVAILABLE',reason:input.reason,details:'private-secret'}));
else if(input.mode==='wait') {const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',detached:true});fs.writeFileSync(input.pid,String(child.pid));setInterval(()=>{},1000);}
else {const bytes=Buffer.from(JSON.stringify({markdown:'Unicode: café 😀 漢字'}));for(const byte of bytes)process.stdout.write(Buffer.from([byte]));}
`);
try {
  const startupCancellation=new AbortController();
  const starting=runScrapeWorker({mode:'wait',pid:path.join(folder,'startup-pid')},startupCancellation.signal,worker);
  startupCancellation.abort();
  await assert.rejects(starting,{name:'AbortError'});
  assert.equal((await runScrapeWorker({},signal,worker)).markdown,'Unicode: café 😀 漢字');
  await assert.rejects(runScrapeWorker({mode:'startup-error',reason:'SYSTEM_DEPENDENCIES_MISSING'},signal,worker),error=>{
    assert.ok(hasCode('BROWSER_UNAVAILABLE')(error));assert.match((error as Error).message,/system libraries or fonts are missing/);return true;
  });
  await assert.rejects(runScrapeWorker({mode:'startup-error',reason:'private-secret'},signal,worker),error=>{
    assert.ok(hasCode('BROWSER_UNAVAILABLE')(error));assert.doesNotMatch((error as Error).message,/private-secret/);return true;
  });
  process.env.SCRAPER_PYTHON=path.join(folder,'missing-python');
  await assert.rejects(runScrapeWorker({},signal,worker),/Python worker executable is missing/);
  process.env.SCRAPER_PYTHON=process.execPath;
  const originalPath=process.env.PATH,display=process.env.DISPLAY;
  try {
    process.env.PATH=folder;process.env.SCRAPER_HEADLESS='false';delete process.env.DISPLAY;
    await assert.rejects(runScrapeWorker({},signal,worker),/xvfb-run is missing from PATH/);
  } finally {
    if(originalPath===undefined)delete process.env.PATH;else process.env.PATH=originalPath;
    if(display===undefined)delete process.env.DISPLAY;else process.env.DISPLAY=display;
    process.env.SCRAPER_HEADLESS='true';
  }
  await assert.rejects(runScrapeWorker({mode:'crash'},signal,worker),hasCode('BROWSER_UNAVAILABLE'));
  await assert.rejects(runScrapeWorker({mode:'large'},signal,worker),hasCode('CONTENT_TOO_LARGE'));
  await assert.rejects(runScrapeWorker({mode:'error'},signal,worker),error=>{assert.ok(hasCode('PAGE_BLOCKED')(error));assert.doesNotMatch((error as Error).message,/private-secret/);return true;});
  const pid=path.join(folder,'pid');
  await assert.rejects(runScrapeWorker({mode:'wait',pid},AbortSignal.timeout(300),worker),{name:'TimeoutError'});
  const childPid=Number(await readFile(pid,'utf8'));
  // Linux can retain an exited descendant as a zombie until PID 1 reaps it.
  const status=await readFile(`/proc/${childPid}/status`,'utf8').catch(()=> 'gone');
  assert.ok(status==='gone' || /State:\s+Z/.test(status),'Cancellation kills the descendant process');
} finally {
  if(python===undefined)delete process.env.SCRAPER_PYTHON;else process.env.SCRAPER_PYTHON=python;
  if(headless===undefined)delete process.env.SCRAPER_HEADLESS;else process.env.SCRAPER_HEADLESS=headless;
  await rm(folder,{recursive:true,force:true});
}
console.log('Browser orchestration checks passed: URL/DNS restrictions, queue, Unicode, crashes, cancellation and descendant cleanup.');
