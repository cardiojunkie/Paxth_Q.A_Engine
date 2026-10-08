import type { SkuData } from '../hooks/useCatalogData';

/** Compare saved sources without treating formatting or fragment changes as a new page. */
export function evidenceUrl(value?: string | null): string {
  const raw = value?.trim() || '';
  if (!raw) return '';
  try {
    const url = new URL(/^[a-z][a-z\d+.-]*:/i.test(raw) ? raw : `https://${raw}`);
    url.hash = '';
    return url.href;
  } catch { return raw; }
}

export function usableScrapedMarkdown(sku: Pick<SkuData, 'source' | 'scraped_markdown' | 'scrape_metadata'>): string {
  const metadata = sku.scrape_metadata;
  if (metadata && metadata.method !== 'manual' && evidenceUrl(metadata.requestedUrl) !== evidenceUrl(sku.source?.url)) return '';
  return sku.scraped_markdown?.trim() || '';
}
