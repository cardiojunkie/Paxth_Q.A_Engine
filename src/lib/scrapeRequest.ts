import type { SkuData } from '../hooks/useCatalogData';
import { api } from './api';
import type { ScrapePreview } from './browserScrape';

export async function previewScrapeUrl(url: string, signal?: AbortSignal): Promise<ScrapePreview> {
  const result = await api<ScrapePreview>('/api/scrape/preview', { method: 'POST', body: JSON.stringify({ url }), signal });
  if (!result || !['collected', 'partial'].includes(result.status) || !result.markdown?.trim() || !result.report) {
    throw new Error('The server did not return collected page content. Please retry.');
  }
  return result;
}

export async function scrapeCatalogSku(sku: SkuData, signal?: AbortSignal): Promise<SkuData> {
  const saved = await api<SkuData>(`/api/catalog/${encodeURIComponent(sku.sku)}/scrape`, {
    method: 'POST', body: JSON.stringify({ expectedRevision: sku.revision ?? 0 }), signal,
  });
  if (saved?.sku !== sku.sku || !saved.scraped_markdown?.trim()) {
    throw new Error('The server did not return saved content for this SKU. Refresh the catalog.');
  }
  return saved;
}
