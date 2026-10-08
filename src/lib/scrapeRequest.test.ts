import assert from 'node:assert/strict';
import {scrapeCatalogSku} from './scrapeRequest';
import type { SkuData } from '../hooks/useCatalogData';
import { ApiError } from './api';
const original=globalThis.fetch;
const sku: SkuData = { sku: 'SKU/1 #?', revision: 12, status: 'ready', upload_attributes: {}, raw_row: {}, source: { url: 'https://example.com/product' } };
const saved = { ...sku, revision: 13, scraped_markdown: '# Product' };
try {
  globalThis.fetch=async(path,init)=>{
    assert.equal(path,'/api/catalog/SKU%2F1%20%23%3F/scrape');
    assert.equal(init?.credentials, 'same-origin');
    assert.deepEqual(JSON.parse(String(init?.body)),{expectedRevision:12});
    return Response.json(saved);
  };
  assert.deepEqual(await scrapeCatalogSku(sku),saved);
  globalThis.fetch=async()=>Response.json({error:'Unavailable', details:'Use SAP or manual content'},{status:503});
  await assert.rejects(scrapeCatalogSku(sku),{message:'Unavailable'});
  globalThis.fetch=async()=>Response.json({error:'SKU changed; refresh before scraping'},{status:409});
  await assert.rejects(scrapeCatalogSku(sku),error => error instanceof ApiError && error.status === 409);
  globalThis.fetch=async()=>Response.json({...saved,sku:'other'});
  await assert.rejects(scrapeCatalogSku(sku),/did not return saved content for this SKU/);
  globalThis.fetch=async()=>Response.json({...saved,scraped_markdown:' '});
  await assert.rejects(scrapeCatalogSku(sku),/did not return saved content for this SKU/);
  const controller = new AbortController();
  globalThis.fetch=async(_path,init)=>{
    assert.equal(init?.signal,controller.signal);
    throw new DOMException('Aborted', 'AbortError');
  };
  controller.abort();
  await assert.rejects(scrapeCatalogSku(sku,controller.signal),{name:'AbortError'});
}finally{globalThis.fetch=original;}
console.log('SKU-connected saved scrape request checks passed.');
