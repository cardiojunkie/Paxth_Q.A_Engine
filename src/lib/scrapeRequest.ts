import type { SkuData } from '../hooks/useCatalogData';
import { api } from './api';

export async function scrapeCatalogSku(sku: SkuData, signal?: AbortSignal): Promise<SkuData> {
  const saved = await api<SkuData>(`/api/catalog/${encodeURIComponent(sku.sku)}/scrape`, {
    method: 'POST', body: JSON.stringify({ expectedRevision: sku.revision ?? 0 }), signal,
  });
  if (saved?.sku !== sku.sku || !saved.scraped_markdown?.trim()) {
    throw new Error('The server did not return saved content for this SKU. Refresh the catalog.');
  }
  return saved;
}
