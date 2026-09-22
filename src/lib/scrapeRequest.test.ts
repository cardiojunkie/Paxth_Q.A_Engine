import assert from 'node:assert/strict';
import {scrapeUrl} from './scrapeRequest';
const original=globalThis.fetch;
try {
  globalThis.fetch=async(path,init)=>{
    assert.equal(path,'/api/scrape');
    assert.deepEqual(JSON.parse(String(init?.body)),{url:'https://example.com/product'});
    return Response.json({markdown:'# Product'});
  };
  assert.equal(await scrapeUrl(' https://example.com/product '),'# Product');
  globalThis.fetch=async()=>Response.json({error:'Unavailable'},{status:503});
  await assert.rejects(scrapeUrl('https://example.com'),/Unavailable/);
  globalThis.fetch=async()=>Response.json({markdown:' '});
  await assert.rejects(scrapeUrl('https://example.com'),/No product content/);
}finally{globalThis.fetch=original;}
console.log('Credential-free scrape request checks passed.');
