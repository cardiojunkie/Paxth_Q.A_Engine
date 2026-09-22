import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import express from 'express';
import {Pool} from 'pg';
import {drizzle} from 'drizzle-orm/node-postgres';
import * as schema from '../db/schema';
import {initializeQaConfiguration,registerQaConfigurationRoutes} from '../db/qaConfiguration';
import {initializeDatabase,verifySchema} from './database';
import {initializeAuth,registerAuth,hashPassword,hashSessionToken} from './auth';
import {initializeProvider,registerProviderRoutes} from './provider';
import {initializeJobRuns,registerJobRunRoutes,startJobWorker} from './jobRunner';
import {ApiError,registerCatalogRoutes} from './catalog';
import {ProviderError} from '../lib/chatCompletion';

assert.ok(process.env.TEST_DATABASE_URL,'Set TEST_DATABASE_URL to a disposable PostgreSQL instance. Production DATABASE_URL is never used.');
const namespace=`security_${randomUUID().replaceAll('-','')}`;
const root=new Pool({connectionString:process.env.TEST_DATABASE_URL});
await root.query(`CREATE SCHEMA ${namespace}`);
const pool=new Pool({connectionString:process.env.TEST_DATABASE_URL,options:`-c search_path=${namespace}`,max:10,query_timeout:5000});
const server=createServer();
let stopWorker:(()=>Promise<void>)|undefined;
let stopSecond:(()=>Promise<void>)|undefined;
let calls=0, providerMode='success';
const provider=createServer(async(req,res)=>{
  for await(const _ of req) {/* consume local fake request */}
  calls++;
  if(providerMode==='wait') await delay(1200);
  if(providerMode==='permanent'){res.writeHead(400);res.end('{}');return;}
  res.setHeader('Content-Type','application/json');
  res.end(JSON.stringify({choices:[{message:{content:JSON.stringify({qa_status:'pass',confidence:'high',summary:'Matches source',issue_count:0,issues:[],source_notes:{sap_used:true,url_used:false,source_conflicts:[]}})}}],usage:{prompt_tokens:10,completion_tokens:5,total_tokens:15}}));
});
const listen=(s:ReturnType<typeof createServer>)=>new Promise<void>(resolve=>s.listen(0,'127.0.0.1',resolve));
try {
  await initializeDatabase(pool);
  await initializeQaConfiguration(drizzle(pool,{schema}));
  await initializeAuth(pool); await initializeProvider(pool); await initializeJobRuns(pool); await verifySchema(pool);
  // Also exercise idempotent startup migrations.
  await initializeDatabase(pool);
  await listen(provider);
  const providerAddress=provider.address() as any;
  process.env.LLM_BASE_URL=`http://127.0.0.1:${providerAddress.port}/v1`;process.env.LLM_API_KEY='test-secret-only';
  process.env.NODE_ENV='test';
  const app=express();app.use(express.json());
  server.on('request',app);await listen(server);
  const origin=`http://127.0.0.1:${(server.address() as any).port}`;process.env.APP_ORIGIN=origin;
  registerAuth(app,pool);registerCatalogRoutes(app,pool);registerProviderRoutes(app,pool);registerJobRunRoutes(app,pool);registerQaConfigurationRoutes(app,drizzle(pool,{schema}));
  app.use((err:any,_req:any,res:any,_next:any)=>res.status(err instanceof ApiError||err instanceof ProviderError?err.status:err.code==='23505'?409:503).json({error:err.message}));
  const password='test-only-strong-password';
  const hash=await hashPassword(password);
  await pool.query("INSERT INTO users(id,username,password,role) VALUES ('admin','Administrator',$1,'admin'),('user','Operator',$1,'user'),('other','Other',$1,'user')",[hash]);
  const request=async(path:string,method='GET',body?:unknown,cookie='',requestOrigin=origin)=>{
    const response=await fetch(origin+path,{method,headers:{Origin:requestOrigin,'Content-Type':'application/json',Cookie:cookie},...(body===undefined?{}:{body:JSON.stringify(body)})});
    return {status:response.status,body:await response.json(),cookie:response.headers.get('set-cookie')};
  };
  assert.equal((await request('/api/catalog')).status,401);
  assert.equal((await request('/api/catalog','GET',undefined,'paxth_qa_user_session={"role":"admin"}')).status,401);
  assert.equal((await request('/api/auth/login','POST',{username:'Administrator',password},'','https://evil.example')).status,403);
  const adminLogin=await request('/api/auth/login','POST',{username:'administrator',password});assert.equal(adminLogin.status,200);
  assert.match(adminLogin.cookie!,/HttpOnly/);assert.match(adminLogin.cookie!,/SameSite=Strict/);assert.doesNotMatch(JSON.stringify(adminLogin.body),/password|scrypt/);
  const admin=adminLogin.cookie!.split(';')[0];
  assert.equal((await request('/api/users','POST',{username:'Temporary',password,role:'user'},admin)).status,201);
  assert.equal((await request('/api/users','POST',{username:' temporary ',password,role:'user'},admin)).status,409);
  const user=(await request('/api/auth/login','POST',{username:'Operator',password})).cookie!.split(';')[0];
  const other=(await request('/api/auth/login','POST',{username:'Other',password})).cookie!.split(';')[0];
  assert.equal((await request('/api/users','GET',undefined,user)).status,403);
  assert.equal((await request('/api/catalog','DELETE',{all:true},user)).status,403);
  assert.equal((await request('/api/provider-settings','PUT',{},user)).status,403);
  assert.equal((await request('/api/chat','POST',{},user)).status,403);
  await pool.query("INSERT INTO users(id,username,password,role) VALUES('legacy-admin','Legacy','unusable-plaintext','admin')");
  assert.equal((await request('/api/users/admin','DELETE',undefined,admin)).status,409);
  assert.equal((await request('/api/users/admin','PUT',{role:'user'},admin)).status,409);
  const settings=await request('/api/provider-settings','GET',undefined,user);
  assert.equal(settings.status,200);assert.doesNotMatch(JSON.stringify(settings.body),/test-secret-only|apiKey/);
  assert.equal((await request('/api/chat','POST',{baseUrl:'http://evil',apiKey:'x'},admin)).status,400);
  const sku=(id:string)=>({sku:id,source:{sap:'Brand: TestBrand'},raw_row:{sku:id},upload_attributes:{brand:'TestBrand'},attribute_set:'TestSet',status:'ready'});
  assert.equal((await request('/api/catalog','POST',[sku('a'),{sku:'invalid'}],user)).status,400);
  assert.equal((await request('/api/catalog','GET',undefined,user)).body.length,0);
  await pool.query("CREATE FUNCTION fail_import() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.sku='rollback' THEN RAISE EXCEPTION 'injected'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_import BEFORE INSERT ON sku_data FOR EACH ROW EXECUTE FUNCTION fail_import()");
  assert.equal((await request('/api/catalog','POST',[sku('a'),sku('rollback')],user)).status,503);
  assert.equal((await request('/api/catalog','GET',undefined,user)).body.length,0);
  await pool.query('DROP TRIGGER fail_import ON sku_data');
  const inserted=await request('/api/catalog','POST',[sku('a'),sku('b')],user);assert.equal(inserted.body.inserted.length,2);
  const duplicate=await request('/api/catalog','POST',[{...sku('a'),source:{sap:'Overwrite?'}}],user);assert.deepEqual(duplicate.body.skipped,['a']);
  assert.equal((await request('/api/catalog/nope','PUT',{source:{sap:'x'}},user)).status,404);
  assert.equal((await request('/api/jobs','POST',{id:'bad',name:'Bad',skus:{a:true}},user)).status,400);
  const job=await request('/api/jobs','POST',{id:'job',name:'Job',skus:['a','b'],attribute_set:'TestSet'},user);assert.equal(job.status,201);
  const runBody={requestId:randomUUID(),mode:'all'};
  const [first,repeated]=await Promise.all([request('/api/jobs/job/runs','POST',runBody,user),request('/api/jobs/job/runs','POST',runBody,user)]);
  // Concurrent repeatable-read start may serialize-retry as 503, so repeat the same idempotency key.
  const run=first.status===202?first:repeated;
  assert.equal(run.status,202);
  assert.equal((await request('/api/jobs/job/runs','POST',runBody,user)).body.id,run.body.id);
  assert.equal((await request('/api/jobs/job/runs','POST',{...runBody,requestId:randomUUID()},user)).status,409);
  assert.equal((await request('/api/data','DELETE',undefined,admin)).status,409);
  assert.equal((await request(`/api/job-runs/${run.body.id}/cancel`,'POST',{},other)).status,403);
  const waitFor=async(check:()=>Promise<boolean>,label:string)=>{
    for(let i=0;i<160;i++){if(await check())return;await delay(100);}throw new Error(`Timed out: ${label}`);
  };
  providerMode='wait';stopWorker=startJobWorker(pool);stopSecond=startJobWorker(pool);
  await waitFor(async()=>calls>=1,'first provider call');
  await request('/api/catalog/a','PUT',{source:{sap:'New evidence'}},user);
  await waitFor(async()=>(await request(`/api/job-runs/${run.body.id}`,'GET',undefined,user)).body.status==='completed','run completion');
  assert.equal(calls,2,'Two workers must not duplicate calls');
  const history=(await request(`/api/job-runs/${run.body.id}`,'GET',undefined,user)).body;
  assert.equal(history.items[0].snapshot.source.sap,'Brand: TestBrand');assert.ok(history.items[0].result.qa_result);
  const current=(await request('/api/catalog','GET',undefined,user)).body;
  assert.equal(current.find((row:any)=>row.sku==='a').source.sap,'New evidence');assert.ok(!current.find((row:any)=>row.sku==='a').qa_result,'New evidence must not acquire stale result');
  await stopWorker();stopWorker=undefined;await stopSecond();stopSecond=undefined;
  // Simulate an interrupted run with one saved item and a consumed attempt on the other.
  const restart=await request('/api/jobs/job/runs','POST',{requestId:randomUUID(),mode:'all'},user);
  await pool.query("UPDATE job_runs SET status='running',owner_token='old-owner',started_at=now() WHERE id=$1",[restart.body.id]);
  await pool.query("UPDATE job_run_items SET status='completed',result=$2 WHERE run_id=$1 AND sku='b'",[restart.body.id,JSON.stringify(history.items[1].result)]);
  await pool.query("UPDATE job_run_items SET status='running',attempts=1,started_at=now() WHERE run_id=$1 AND sku='a'",[restart.body.id]);
  providerMode='success';const before=calls;stopWorker=startJobWorker(pool);
  await waitFor(async()=>(await request(`/api/job-runs/${restart.body.id}`,'GET',undefined,user)).body.status==='completed','restart recovery');
  assert.equal(calls,before+1);
  assert.equal((await pool.query("SELECT attempts FROM job_run_items WHERE run_id=$1 AND sku='a'",[restart.body.id])).rows[0].attempts,2);
  // Saving a paid result retries only the DB commit.
  await pool.query("CREATE SEQUENCE fail_save_seq; CREATE FUNCTION fail_save() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.result IS NOT NULL AND nextval('fail_save_seq')=1 THEN RAISE EXCEPTION 'injected save failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_save BEFORE UPDATE ON job_run_items FOR EACH ROW EXECUTE FUNCTION fail_save()");
  const beforeSave=calls;const saveRun=await request('/api/jobs/job/runs','POST',{requestId:randomUUID(),mode:'single',sku:'a'},user);
  await waitFor(async()=>(await request(`/api/job-runs/${saveRun.body.id}`,'GET',undefined,user)).body.status==='completed','save retry');
  assert.equal(calls,beforeSave+1,'DB retry must not make a second provider request');
  await pool.query('DROP TRIGGER fail_save ON job_run_items');
  providerMode='permanent';const beforeError=calls;
  const failed=await request('/api/jobs/job/runs','POST',{requestId:randomUUID(),mode:'single',sku:'a'},user);
  await waitFor(async()=>(await request(`/api/job-runs/${failed.body.id}`,'GET',undefined,user)).body.status==='failed','permanent provider error');
  assert.equal(calls,beforeError+1);
  providerMode='wait';const beforeCancel=calls;
  const cancelled=await request('/api/jobs/job/runs','POST',{requestId:randomUUID(),mode:'all'},user);
  await waitFor(async()=>calls>beforeCancel,'inflight cancel');
  assert.equal((await request(`/api/job-runs/${cancelled.body.id}/cancel`,'POST',{},user)).status,200);
  await waitFor(async()=>(await request(`/api/job-runs/${cancelled.body.id}`,'GET',undefined,user)).body.status==='cancelled','cancelled');
  assert.equal(calls,beforeCancel+1,'Cancel prevents dispatching the next SKU');
  await stopWorker();stopWorker=undefined;
  // Neither a restart nor a future retry may reset a consumed budget or deadline.
  const exhausted=await request('/api/jobs/job/runs','POST',{requestId:randomUUID(),mode:'single',sku:'a'},user);
  await pool.query("UPDATE job_run_items SET attempts=3 WHERE run_id=$1 AND sku='a'",[exhausted.body.id]);
  const beforeExhaustion=calls;stopWorker=startJobWorker(pool);
  await waitFor(async()=>(await request(`/api/job-runs/${exhausted.body.id}`,'GET',undefined,user)).body.status==='failed','exhausted attempts');
  assert.equal(calls,beforeExhaustion);
  await stopWorker();stopWorker=undefined;
  const expired=await request('/api/jobs/job/runs','POST',{requestId:randomUUID(),mode:'single',sku:'a'},user);
  await pool.query("UPDATE job_run_items SET started_at=now()-interval '6 minutes' WHERE run_id=$1 AND sku='a'",[expired.body.id]);
  stopWorker=startJobWorker(pool);
  await waitFor(async()=>(await request(`/api/job-runs/${expired.body.id}`,'GET',undefined,user)).body.status==='failed','expired item deadline');
  assert.equal(calls,beforeExhaustion);
  await stopWorker();stopWorker=undefined;
  await initializeDatabase(pool); // Existing populated records remain readable after restart migrations.
  // Clear remains all-or-nothing even if catalog deletion fails after deleting jobs.
  await pool.query("CREATE FUNCTION fail_clear() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected clear failure'; END $$; CREATE TRIGGER fail_clear BEFORE DELETE ON sku_data FOR EACH ROW EXECUTE FUNCTION fail_clear()");
  assert.equal((await request('/api/data','DELETE',undefined,admin)).status,503);
  assert.equal((await request('/api/jobs','GET',undefined,user)).body.length,1);
  await pool.query('DROP TRIGGER fail_clear ON sku_data');
  assert.equal((await request('/api/data','DELETE',undefined,admin)).status,200);
  assert.equal((await request('/api/jobs','GET',undefined,user)).body.length,0);
  await request('/api/users/user','PUT',{password:'replacement-test-password'},admin);
  assert.equal((await request('/api/catalog','GET',undefined,user)).status,401);
  await pool.query('UPDATE sessions SET expires_at=now()-interval \'1 second\' WHERE token_hash=$1',[hashSessionToken(other.split('=')[1])]);
  assert.equal((await request('/api/catalog','GET',undefined,other)).status,401);
  await request('/api/auth/logout','POST',undefined,admin);
  assert.equal((await request('/api/catalog','GET',undefined,admin)).status,401);
  // Existing conflicting selector domains stop migrations without removing data.
  await pool.query("DROP INDEX site_selectors_website_idx; ALTER TABLE site_selectors DROP CONSTRAINT site_selectors_canonical; INSERT INTO site_selectors(id,website,selectors) VALUES('one','example.com','main'),('two','www.example.com','article')");
  await assert.rejects(initializeDatabase(pool),/manual resolution/);
  assert.equal((await pool.query('SELECT * FROM site_selectors')).rowCount,2);
  console.log('Security/database checks passed: sessions, roles, atomic saves, recovery, ownership, cancellation, budgets, history, and migration conflicts.');
} finally {
  await stopWorker?.();await stopSecond?.();server.closeAllConnections();provider.closeAllConnections();
  await Promise.all([new Promise<void>(resolve=>server.close(()=>resolve())),new Promise<void>(resolve=>provider.close(()=>resolve()))]);
  await pool.end();await root.query(`DROP SCHEMA ${namespace} CASCADE`);await root.end();
}
