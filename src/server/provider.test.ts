import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import express from 'express';
import type { Pool } from 'pg';
import {completeQa,validateSettings,registerProviderRoutes,getProviderCredentials} from './provider';
import {fetchChatCompletion,providerResponseError,ProviderError} from '../lib/chatCompletion';
import {editableSettings,DEFAULT_SETTINGS} from '../lib/providerSettings';
const keepAlive=setInterval(()=>{},1000);
const original=globalThis.fetch;
const originalUrl=process.env.LLM_BASE_URL, originalKey=process.env.LLM_API_KEY;
const originalLegacyKey=process.env.AICREDITS_API_KEY;
process.env.LLM_BASE_URL='https://provider.example/v1';process.env.LLM_API_KEY='test-only';
try {
  process.env.AICREDITS_API_KEY='legacy-test-only';
  delete process.env.LLM_BASE_URL;delete process.env.LLM_API_KEY;
  assert.deepEqual(getProviderCredentials(),{baseUrl:'https://api.aicredits.in/v1',apiKey:'legacy-test-only'});
  process.env.LLM_BASE_URL='https://provider.example/v1';
  assert.throws(()=>getProviderCredentials(),/Configure both/, 'Never send the legacy key to an overridden destination');
  delete process.env.LLM_BASE_URL;process.env.LLM_API_KEY='test-only';
  assert.throws(()=>getProviderCredentials(),/Configure both/, 'An explicit key requires its explicit destination');
  process.env.LLM_BASE_URL='https://provider.example/v1';
  assert.deepEqual(getProviderCredentials(),{baseUrl:'https://provider.example/v1',apiKey:'test-only'},'Explicit credentials override the legacy pair');
  let calls=0;
  globalThis.fetch=async()=>{calls++;return Response.json({error:'invalid'},{status:400});};
  await assert.rejects(completeQa({},new AbortController().signal),/HTTP 400/);assert.equal(calls,1);
  calls=0;const attempts:number[]=[],failedAttempts:number[]=[];
  globalThis.fetch=async()=>{calls++;return calls<2?Response.json({}, {status:503}):Response.json({ok:true});};
  assert.deepEqual(await completeQa({},new AbortController().signal,{attempts:1,beforeAttempt:async n=>{attempts.push(n);},onAttemptError:async n=>{failedAttempts.push(n);}}),{ok:true});
  assert.deepEqual(attempts,[2,3]);
  assert.deepEqual(failedAttempts,[2]);
  assert.equal(calls,2);
  await assert.rejects(completeQa({},new AbortController().signal,{attempts:3}),/interrupted.*fresh run/);assert.equal(calls,2);
  globalThis.fetch=async()=>{calls++;return Response.json({});};
  await assert.rejects(completeQa({},new AbortController().signal,{beforeAttempt:async()=>{throw new Error('save attempt failed');}}),/save attempt failed/);assert.equal(calls,2);
  calls=0;const savedFailures:Array<{attempt:number;error:ProviderError}>=[];
  globalThis.fetch=async()=>{calls++;return Response.json({error:{message:'Busy test-only Bearer upstream-secret sk-other-secret'}},{status:503});};
  await assert.rejects(completeQa({},new AbortController().signal,{attempts:2,onAttemptError:async(attempt,error)=>{savedFailures.push({attempt,error});}}),/HTTP 503/);
  assert.equal(calls,1);assert.equal(savedFailures[0].attempt,3);
  assert.doesNotMatch(savedFailures[0].error.message,/test-only|upstream-secret|sk-other-secret/);
  await assert.rejects(completeQa({},new AbortController().signal,{attempts:3,lastError:savedFailures[0].error.message}),/Last recorded failure:.*HTTP 503.*fresh run/);
  assert.equal(calls,1,'An exhausted recovery never dispatches another model request');
  delete process.env.LLM_API_KEY;
  try {
    await assert.rejects(completeQa({},new AbortController().signal,{attempts:3,lastError:savedFailures[0].error.message}),/Last recorded failure:.*HTTP 503/);
  } finally {process.env.LLM_API_KEY='test-only';}
  await assert.rejects(completeQa({},new AbortController().signal,{onAttemptError:async()=>{throw new Error('failure checkpoint unavailable');}}),/failure checkpoint unavailable/);
  assert.equal(calls,2,'A failed error checkpoint must not trigger another provider attempt');
  const nativeTimeout=AbortSignal.timeout,windows:number[]=[];
  AbortSignal.timeout=(ms:number)=>{windows.push(ms);return nativeTimeout(ms);};
  try {
    globalThis.fetch=async()=>Response.json({});
    await fetchChatCompletion(process.env.LLM_BASE_URL!,process.env.LLM_API_KEY!,{},new AbortController().signal);
    await completeQa({},new AbortController().signal);
    assert.deepEqual(windows,[90_000,120_000],'QA has a longer request window than retrieval and connectivity');
  } finally {AbortSignal.timeout=nativeTimeout;}
  // Queueing and durable dispatch saves must not shorten the actual provider window.
  let admit!:()=>void;const admissionHold=new Promise<void>(resolve=>{admit=resolve;});
  globalThis.fetch=async(_url,init)=>{
    if(JSON.parse(init!.body as string).hold)await admissionHold;
    return Response.json({});
  };
  const held=Array.from({length:2},()=>fetchChatCompletion(process.env.LLM_BASE_URL!,process.env.LLM_API_KEY!,{hold:true},AbortSignal.timeout(2000)));
  await delay(1);
  const queued=fetchChatCompletion(process.env.LLM_BASE_URL!,process.env.LLM_API_KEY!,{},AbortSignal.timeout(2000),async()=>{await delay(40);},20);
  await delay(40);admit();await Promise.all([...held,queued]);
  calls=0;globalThis.fetch=async()=>{calls++;return Response.json({});};
  await assert.rejects(fetchChatCompletion(process.env.LLM_BASE_URL!,process.env.LLM_API_KEY!,{},AbortSignal.timeout(20),async()=>{await delay(40);},1000),{name:'TimeoutError'});
  assert.equal(calls,0,'Caller cancellation during the dispatch save prevents a provider request');
  // Headers arrive immediately but body stalls. Abort must release the admission slot.
  globalThis.fetch=async()=>new Response(new ReadableStream({start(){}}));
  await assert.rejects(fetchChatCompletion(process.env.LLM_BASE_URL!,process.env.LLM_API_KEY!,{},AbortSignal.timeout(30)));
  await assert.rejects(fetchChatCompletion(process.env.LLM_BASE_URL!,process.env.LLM_API_KEY!,{},AbortSignal.timeout(2000),undefined,30),error=>error instanceof ProviderError && error.status===504 && error.retryable && /request timed out/.test(error.message));
  const ownership=new AbortController(),lost=new Error('Worker ownership lost');
  const abortOwnership=setTimeout(()=>ownership.abort(lost),20);
  try {
    await assert.rejects(fetchChatCompletion(process.env.LLM_BASE_URL!,process.env.LLM_API_KEY!,{},ownership.signal,undefined,1000),error=>error===lost);
  } finally {clearTimeout(abortOwnership);}
  let active=0,maximum=0;
  globalThis.fetch=async()=>{
    active++;maximum=Math.max(maximum,active);
    return new Response(new ReadableStream({start(controller){setTimeout(()=>{active--;controller.enqueue(new TextEncoder().encode('{}'));controller.close();},30);}}));
  };
  await Promise.all(Array.from({length:10},()=>fetchChatCompletion(process.env.LLM_BASE_URL!,process.env.LLM_API_KEY!,{},AbortSignal.timeout(2000))));
  assert.equal(maximum,2);
  let release!:()=>void;const hold=new Promise<void>(resolve=>{release=resolve;});
  globalThis.fetch=async()=>{await hold;return Response.json({});};
  const requests=Array.from({length:10},()=>fetchChatCompletion(process.env.LLM_BASE_URL!,process.env.LLM_API_KEY!,{},AbortSignal.timeout(2000)));
  await delay(1);
  await assert.rejects(fetchChatCompletion(process.env.LLM_BASE_URL!,process.env.LLM_API_KEY!,{},AbortSignal.timeout(1000)),/queue is full/);
  release();await Promise.all(requests);
  assert.throws(()=>validateSettings({...editableSettings(DEFAULT_SETTINGS),apiKey:'browser-key'}),/Invalid/);
  assert.throws(()=>validateSettings({...editableSettings(DEFAULT_SETTINGS),maxTokens:Infinity}),/Invalid/);
  for (const retired of ['scrapperModelName', 'navigationModelInitialized', 'scraperTimeout']) {
    assert.throws(() => validateSettings({ ...editableSettings(DEFAULT_SETTINGS), [retired]: 'retired' }), /Invalid/);
  }
  assert.equal(validateSettings({ ...editableSettings(DEFAULT_SETTINGS), modelName: ' custom/qa ' }).modelName, 'custom/qa');
  const sanitized=await providerResponseError(Response.json({error:{message:'Invalid test-only Bearer secret sk-other-secret'}},{status:401}), 'test-only');
  assert.equal(sanitized.status,502);assert.doesNotMatch(sanitized.message,/test-only|Bearer secret|sk-other-secret/);
  const app=express();app.use(express.json());
  let role='admin';app.use((_req,res,next)=>{res.locals.user={role};next();});
  let settingsReads=0,settingsUnavailable=false;
  const pool={query:async()=>{
    settingsReads++;
    if(settingsUnavailable)throw new Error('Injected settings outage');
    return {rows:[{settings:{...editableSettings(DEFAULT_SETTINGS),maxTokens:1,qaAgentMemory:'Must never enter connectivity prompt'},memory:'Must never enter connectivity prompt'}]};
  }} as unknown as Pool;
  registerProviderRoutes(app,pool);
  const http=app.listen(0,'127.0.0.1');
  await new Promise<void>(resolve=>http.once('listening',resolve));
  const origin='http://127.0.0.1:'+(http.address() as any).port;
  const request=async(body:any)=>{
    const response=await original(origin+'/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    return {status:response.status,body:await response.json()};
  };
  try {
    const payloads:any[]=[];
    globalThis.fetch=async(_url,init)=>{payloads.push(JSON.parse(init!.body as string));return Response.json({choices:[{finish_reason:'stop',message:{content:'OK'}}]});};
    assert.equal((await request({modelName:' draft/qa '})).status,200);
    assert.equal(payloads[0].model,'draft/qa');
    assert.equal(payloads[0].messages.length,1);assert.match(payloads[0].messages[0].content,/connectivity/);
    assert.equal(payloads[0].max_tokens,DEFAULT_SETTINGS.maxTokens,'Connectivity is independent of saved QA output limits');
    assert.equal(settingsReads,0,'A displayed draft model does not need a saved-settings query');
    assert.doesNotMatch(JSON.stringify(payloads),/test-only|Must never|qa_status|sku/);
    assert.equal((await request({})).body.purpose,'qa');
    assert.equal(payloads[1].model,DEFAULT_SETTINGS.modelName);
    settingsUnavailable=true;
    assert.equal((await request({ purpose: 'qa', modelName: 'draft/qa' })).status, 200);
    assert.equal(settingsReads, 1, 'Explicit model tests still work during a settings outage');
    assert.equal((await request({ purpose: 'scrapper', modelName: 'retired/navigation' })).status, 400);
    assert.equal(settingsReads, 1, 'Retired purposes are rejected before settings or provider requests');
    settingsUnavailable=false;
    assert.equal((await request({ purpose: 'qa' })).status, 200);
    assert.equal(payloads.at(-1).model, DEFAULT_SETTINGS.modelName);
    assert.equal((await request({ purpose: 'other' })).status, 400);
    assert.equal((await request({ apiKey: 'bad' })).status, 400);
    role='user';assert.equal((await request({modelName:'draft/qa'})).status,403);role='admin';
    globalThis.fetch=async()=>Response.json({choices:[{message:{content:''}}]});
    assert.match((await request({purpose:'qa'})).body.error,/empty/);
    globalThis.fetch=async()=>Response.json({error:{message:'Wrong key test-only'}},{status:401});
    const upstream=await request({});assert.equal(upstream.status,502);assert.doesNotMatch(upstream.body.error,/test-only/);
    for(const message of [{refusal:'Unavailable'},{content:'Partial'}]) {
      globalThis.fetch=async()=>Response.json({choices:[{finish_reason:message.refusal?'stop':'length',message}]});
      assert.equal((await request({purpose:'qa',modelName:'draft/qa'})).status,502);
    }
    globalThis.fetch=async()=>new Response('<html>Gateway failure</html>');
    assert.match((await request({modelName:'draft/qa'})).body.error,/invalid JSON/);
    globalThis.fetch=async()=>{throw new DOMException('Injected timeout','TimeoutError');};
    assert.equal((await request({modelName:'draft/qa'})).status,504);
    delete process.env.LLM_BASE_URL;delete process.env.LLM_API_KEY;delete process.env.AICREDITS_API_KEY;
    globalThis.fetch=async()=>{throw new Error('No provider call is allowed without credentials');};
    const missing=await request({modelName:'draft/qa'});
    assert.equal(missing.status,503);assert.match(missing.body.error,/Configure both/);
    process.env.AICREDITS_API_KEY='legacy-test-only';
    globalThis.fetch=async(url,init)=>{
      assert.equal(String(url),'https://api.aicredits.in/v1/chat/completions');
      assert.equal(new Headers(init?.headers).get('Authorization'),'Bearer legacy-test-only');
      assert.doesNotMatch(String(init?.body),/legacy-test-only/);
      return Response.json({choices:[{finish_reason:'stop',message:{content:'OK'}}]});
    };
    assert.equal((await request({purpose:'qa',modelName:'draft/qa'})).status,200,'The existing key restores connectivity without copying secrets');
  } finally {http.closeAllConnections();await new Promise<void>(resolve=>http.close(()=>resolve()));}
  console.log('Provider checks passed: retry counts, persistent attempts, stalled bodies, admission, and settings validation.');
}finally{
  clearInterval(keepAlive);
  globalThis.fetch=original;
  if(originalUrl===undefined)delete process.env.LLM_BASE_URL;else process.env.LLM_BASE_URL=originalUrl;
  if(originalKey===undefined)delete process.env.LLM_API_KEY;else process.env.LLM_API_KEY=originalKey;
  if(originalLegacyKey===undefined)delete process.env.AICREDITS_API_KEY;else process.env.AICREDITS_API_KEY=originalLegacyKey;
}
