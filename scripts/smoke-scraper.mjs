// Disposable production-bundle/container check. No paid provider traffic.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Pool } from 'pg';
assert.ok(process.env.TEST_DATABASE_URL, 'Set TEST_DATABASE_URL to a disposable database; DATABASE_URL is never used.');
const root = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
const namespace = `browser_smoke_${randomUUID().replaceAll('-', '')}`;
const folder = await mkdtemp(path.join(tmpdir(), 'paxth-production-smoke-'));
const url = new URL(process.env.TEST_DATABASE_URL);
url.searchParams.set('options', `-c search_path=${namespace}`);
const port = Number(process.env.SCRAPER_TEST_PORT || 3344);
const container = process.env.SCRAPER_TEST_IMAGE;
const name = `paxth-scrape-smoke-${randomUUID().slice(0, 8)}`;
const username = 'Scraper smoke', password = randomUUID();
const env = { ...process.env, DATABASE_URL: url.href, NODE_ENV: 'production', HOST: '127.0.0.1', PORT: String(port),
  APP_ORIGIN: 'https://scrape-smoke.example', LLM_BASE_URL: 'https://mock.scrape.example/v1', LLM_API_KEY: 'mock-only',
  BOOTSTRAP_ADMIN_USERNAME: username, BOOTSTRAP_ADMIN_PASSWORD: password };
const preload = path.join(folder, 'provider.mjs');
await writeFile(preload, `const original=globalThis.fetch;globalThis.fetch=async(url,init)=>{
  if(String(url)!=='https://mock.scrape.example/v1/chat/completions')return original(url,init);
  const input=JSON.parse(JSON.parse(init.body).messages.find(message=>message.role==='user').content);
  await new Promise(resolve=>setTimeout(resolve,5000));
  return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({qa_status:'pass',confidence:'high',summary:'Mock review of supplied evidence',issue_count:0,issues:[],source_notes:{sap_used:!!input.source_sap,url_used:!!input.scraped_markdown,source_conflicts:[]}})}}]});
};`);
let app, peakKiB = 0, meter;
const memory = pid => {
  try {
    const status = readFileSync(`/proc/${pid}/status`, 'utf8');
    const children = readFileSync(`/proc/${pid}/task/${pid}/children`, 'utf8').trim().split(/\s+/).filter(Boolean);
    return Number(status.match(/VmRSS:\s+(\d+)/)?.[1] || 0) + children.reduce((sum, child) => sum + memory(child), 0);
  } catch { return 0; }
};
const command = (file, args) => {
  const result = spawnSync(file, args, { env, stdio: 'pipe', encoding: 'utf8' });
  assert.equal(result.status, 0, result.error?.message || result.stderr);
};
let cookie = '';
const request = async (endpoint, method = 'GET', body, authorized = true, expectedStatus) => {
  const response = await fetch(`http://127.0.0.1:${port}${endpoint}`, { method,
    headers: { Origin: env.APP_ORIGIN, 'Content-Type': 'application/json', ...(authorized ? { Cookie: cookie } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(130000) });
  const data = await response.json();
  if (expectedStatus === undefined) assert.ok(response.ok, `${endpoint}: HTTP ${response.status} ${JSON.stringify(data)}`);
  else assert.equal(response.status, expectedStatus, `${endpoint}: ${JSON.stringify(data)}`);
  return { data, cookie: response.headers.get('set-cookie')?.split(';')[0] };
};
try {
  await root.query(`CREATE SCHEMA ${namespace}`);
  command(process.execPath, ['dist/bootstrap-admin.mjs']);
  await root.query(`ALTER TABLE ${namespace}.users ADD COLUMN scrapegraph_api_key text;
    ALTER TABLE ${namespace}.users ADD COLUMN scrapegraph_settings jsonb DEFAULT '{}';
    UPDATE ${namespace}.users SET scrapegraph_api_key='retired-only',scrapegraph_settings='{"retired":true}';
    CREATE TABLE ${namespace}.provider_settings (id text PRIMARY KEY CHECK(id='default'), settings jsonb NOT NULL);
    INSERT INTO ${namespace}.provider_settings VALUES ('default','{"modelName":"smoke/qa","scrapperModelName":"retired/navigation","navigationModelInitialized":true}');`);
  const args = container ? ['run', '--rm', '--init', '--name', name, '--network', 'host', '--cpus', '1', '--memory', '1536m', '--shm-size', '256m',
    ...['DATABASE_URL','NODE_ENV','HOST','PORT','APP_ORIGIN','LLM_BASE_URL','LLM_API_KEY'].flatMap(key=>['-e', `${key}=${env[key]}`]),
    '-v', `${preload}:/test-provider.mjs:ro`, container, 'node', '--import', '/test-provider.mjs', 'dist/server.mjs']
    : ['--import', preload, 'dist/server.mjs'];
  app = spawn(container ? 'docker' : process.execPath, args, { env, stdio: ['ignore','pipe','pipe'] });
  let logs=''; app.stdout.on('data', b=>{logs+=b;});app.stderr.on('data', b=>{logs+=b;});
  app.on('error', error=>{logs+=error.message;});
  if(!container)meter=setInterval(()=>{peakKiB=Math.max(peakKiB,memory(app.pid));},100);
  let ready = false;
  for(let i=0;i<100;i++){
    if(app.exitCode!==null)throw new Error(logs);
    try { await request('/healthz'); ready=true;break; } catch { await delay(100); }
  }
  assert.ok(ready, logs || 'Production server did not become ready');
  cookie=(await request('/api/auth/login','POST',{username,password},false)).cookie;
  assert.ok(cookie);
  const persisted = (await root.query(`SELECT settings FROM ${namespace}.provider_settings WHERE id='default'`)).rows[0].settings;
  assert.equal(persisted.modelName, 'smoke/qa');
  assert.ok(!('scrapperModelName' in persisted));assert.ok(!('navigationModelInitialized' in persisted));
  const legacy = (await root.query(`SELECT scrapegraph_api_key,scrapegraph_settings FROM ${namespace}.users`)).rows[0];
  assert.equal(legacy.scrapegraph_api_key, 'retired-only');assert.deepEqual(legacy.scrapegraph_settings,{retired:true});
  await request('/api/catalog','POST',[{sku:'smoke',attribute_set:'Smoke',source:{sap:'Brand: TestBrand'},raw_row:{sku:'smoke',attributes__brand:'TestBrand'},upload_attributes:{brand:'TestBrand'},status:'ready'}]);
  const scrapeUrl = process.env.SCRAPER_TEST_URL || 'https://example.com/';
  const imported = await request('/api/catalog','POST',[{sku:'scrape-smoke',attribute_set:'Smoke',source:{url:scrapeUrl},raw_row:{sku:'scrape-smoke'},upload_attributes:{},status:'ready'}]);
  const revision = imported.data.inserted[0].revision;
  await request('/api/catalog','POST',[{sku:'url-job-smoke',attribute_set:'Smoke',source:{url:scrapeUrl},raw_row:{sku:'url-job-smoke'},upload_attributes:{},status:'ready'}]);
  await request('/api/jobs','POST',{id:'smoke',name:'Smoke',skus:['smoke','url-job-smoke'],attribute_set:'Smoke'});
  const started=Date.now();
  const [retrieved, run] = await Promise.all([
    request('/api/catalog/scrape-smoke/scrape','POST',{expectedRevision:revision}),
    request('/api/jobs/smoke/runs','POST',{requestId:randomUUID(),mode:'all'}),
    request('/api/auth/login','POST',{username,password},false),
  ]);
  assert.equal(retrieved.data.sku, 'scrape-smoke');
  assert.ok(retrieved.data.scraped_markdown.length>50);
  assert.match(retrieved.data.scraped_markdown,/Source:/);
  assert.equal(retrieved.data.revision,revision+1);
  assert.equal(retrieved.data.scrape_metadata.method,'browser');
  assert.equal(retrieved.data.scrape_metadata.requestedUrl,scrapeUrl);
  assert.ok(retrieved.data.scrape_metadata.finalUrl);assert.ok(retrieved.data.scrape_metadata.capturedAt);
  const rows = (await request('/api/catalog')).data;
  assert.equal(rows.find(row=>row.sku==='scrape-smoke').scraped_markdown,retrieved.data.scraped_markdown);
  assert.equal(rows.find(row=>row.sku==='smoke').scraped_markdown,null);
  await request('/api/catalog/scrape-smoke/scrape','POST',{expectedRevision:revision},true,409);
  await request('/api/catalog/scrape-smoke','PUT',{expectedRevision:revision,source:{url:scrapeUrl}},true,409);
  let status;
  for(let i=0;i<750;i++){
    status=(await request(`/api/job-runs/${run.data.id}`)).data.status;
    if(['completed','failed','cancelled'].includes(status))break;
    await delay(200);
  }
  assert.equal(status,'completed');
  const finished = (await request('/api/catalog')).data.find(row=>row.sku==='url-job-smoke');
  assert.ok(finished.scraped_markdown?.length>50,'URL-only job saves evidence before QA');
  assert.ok(finished.qa_result,'URL-only job produces a current review');
  assert.equal(finished.qa_stale,false);
  assert.equal(finished.scrape_metadata.method,'browser');
  if(container){
    command('docker',['exec',name,'node','-e',"fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1))"]);
    console.log('Production-container smoke passed with one CPU / 1536 MiB: migration preservation, SKU evidence persistence/revisions, QA, login and readiness.');
  } else {
    assert.ok(peakKiB < 1536*1024, `Observed process RSS ${peakKiB/1024} MiB exceeds the deployment limit`);
    console.log(`Production-bundle smoke passed: migration preservation, SKU evidence persistence/revisions, concurrent QA and login, ${Date.now()-started} ms, peak process RSS ${(peakKiB/1024).toFixed(1)} MiB. PostgreSQL and an external DISPLAY server are excluded.`);
  }
} finally {
  clearInterval(meter);
  if(container)spawnSync('docker',['stop','-t','5',name],{stdio:'ignore'});
  else if(app){app.kill('SIGTERM');await Promise.race([new Promise(resolve=>app.once('close',resolve)),delay(10000)]);if(app.exitCode===null)app.kill('SIGKILL');}
  await root.query(`DROP SCHEMA IF EXISTS ${namespace} CASCADE`);await root.end();
  await rm(folder,{recursive:true,force:true});
}
