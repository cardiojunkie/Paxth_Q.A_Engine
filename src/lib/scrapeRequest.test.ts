import assert from 'node:assert/strict';
import {previewScrapeUrl, scrapeCatalogSku} from './scrapeRequest';
import type { ScrapePreview } from './cloudScrape';
import type { SkuData } from '../hooks/useCatalogData';
import { ApiError } from './api';
const original=globalThis.fetch;
const sku: SkuData = { sku: 'SKU/1 #?', revision: 12, status: 'ready', upload_attributes: {}, raw_row: {}, source: { url: 'https://example.com/product' } };
const saved = { ...sku, revision: 13, scraped_markdown: '# Product' };
const preview: ScrapePreview = { status: 'partial', markdown: '# Page', requestedUrl: 'https://example.com/test', finalUrl: 'https://example.com/final', capturedAt: '2026-10-07T00:00:00Z', report: { durationMs: 1250, characters: 6, clicks: 1, scrolls: 2, warnings: [{ code: 'UNRESOLVED_CONTROL', message: 'A section could not be revealed.' }], unresolvedControls: ['Specifications'] } };
try {
  const previewController = new AbortController();
  globalThis.fetch=async(path,init)=>{
    assert.equal(path,'/api/scrape/preview');
    assert.equal(init?.credentials,'same-origin');
    assert.equal(init?.signal,previewController.signal);
    assert.deepEqual(JSON.parse(String(init?.body)),{url:preview.requestedUrl});
    return Response.json(preview);
  };
  assert.deepEqual(await previewScrapeUrl(preview.requestedUrl,previewController.signal),preview,'Partial preview content is preserved without a SKU');
  globalThis.fetch=async()=>Response.json({error:'Blocked',code:'PAGE_BLOCKED',report:preview.report},{status:502});
  await assert.rejects(previewScrapeUrl(preview.requestedUrl),error => error instanceof ApiError && error.status===502 && error.code==='PAGE_BLOCKED' && JSON.stringify(error.report)===JSON.stringify(preview.report));
  globalThis.fetch=async()=>Response.json({...preview,markdown:' '});
  await assert.rejects(previewScrapeUrl(preview.requestedUrl),/did not return collected page content/);
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
  await assert.rejects(previewScrapeUrl(preview.requestedUrl,controller.signal),{name:'AbortError'});
}finally{globalThis.fetch=original;}
console.log('Standalone preview and SKU-connected scrape request checks passed.');
