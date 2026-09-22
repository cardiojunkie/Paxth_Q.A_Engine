import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {completeQa,validateSettings} from './provider';
import {fetchChatCompletion} from '../lib/chatCompletion';
import {editableSettings,DEFAULT_SETTINGS} from '../lib/providerSettings';
const keepAlive=setInterval(()=>{},1000);
const original=globalThis.fetch;
const originalUrl=process.env.LLM_BASE_URL, originalKey=process.env.LLM_API_KEY;
process.env.LLM_BASE_URL='https://provider.example/v1';process.env.LLM_API_KEY='test-only';
try {
  let calls=0;
  globalThis.fetch=async()=>{calls++;return Response.json({error:'invalid'},{status:400});};
  await assert.rejects(completeQa({},new AbortController().signal),/HTTP 400/);assert.equal(calls,1);
  calls=0;const attempts:number[]=[];
  globalThis.fetch=async()=>{calls++;return calls<2?Response.json({}, {status:503}):Response.json({ok:true});};
  assert.deepEqual(await completeQa({},new AbortController().signal,{attempts:1,beforeAttempt:async n=>{attempts.push(n);}}),{ok:true});
  assert.deepEqual(attempts,[2,3]);
  assert.equal(calls,2);
  await assert.rejects(completeQa({},new AbortController().signal,{attempts:3}),/exhausted/);assert.equal(calls,2);
  globalThis.fetch=async()=>{calls++;return Response.json({});};
  await assert.rejects(completeQa({},new AbortController().signal,{beforeAttempt:async()=>{throw new Error('save attempt failed');}}),/save attempt failed/);assert.equal(calls,2);
  // Headers arrive immediately but body stalls. Abort must release the admission slot.
  globalThis.fetch=async()=>new Response(new ReadableStream({start(){}}));
  await assert.rejects(fetchChatCompletion(process.env.LLM_BASE_URL!,process.env.LLM_API_KEY!,{},AbortSignal.timeout(30)));
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
  console.log('Provider checks passed: retry counts, persistent attempts, stalled bodies, admission, and settings validation.');
}finally{
  clearInterval(keepAlive);
  globalThis.fetch=original;
  if(originalUrl===undefined)delete process.env.LLM_BASE_URL;else process.env.LLM_BASE_URL=originalUrl;
  if(originalKey===undefined)delete process.env.LLM_API_KEY;else process.env.LLM_API_KEY=originalKey;
}
