import type { SkuData } from "../hooks/useCatalogData";
import { usableScrapedMarkdown } from './scrapeEvidence';

export type JobSkuState = {
  sku: string;
  status: string;
  qa_result?: unknown;
  error?: string | null;
  qa_stale?: boolean;
};

type AttributeSetItem = {
  attribute_set?: string | null;
};

type HeaderItem = {
  source?: { headerOrder?: string[] };
  raw_row?: Record<string, unknown>;
};

type JobItem = {
  status: string;
  skus: string[];
};

export const hasCompletedQa = (sku: JobSkuState) => !sku.error && !sku.qa_stale &&
  ["completed", "failed"].includes(sku.status) && Boolean(sku.qa_result);

export const LEGACY_REVIEW_ERROR = "Legacy review is unverified; rerun QA.";

export function withoutRawQaResult(rawRow: Record<string, any> = {}) {
  const { qa_result, ...original } = rawRow;
  return original;
}

export const unprocessedStatus = (sku: Pick<SkuData, "source" | "scraped_markdown" | "scrape_metadata">) =>
  sku.source?.sap?.trim() || sku.source?.url?.trim() || usableScrapedMarkdown(sku) ? "ready" as const : "cannot_qa" as const;

/** Run snapshots contain evidence, never an authoritative review. */
export function unreviewedRunSnapshot(snapshot: SkuData, markUnverified = true): SkuData {
  const { qa_result, export_data, tokensUsed, timeTaken, last_job_id, catalog_state, ...evidence } = snapshot;
  const unverified = Boolean(qa_result || export_data) || Object.hasOwn(snapshot.raw_row || {}, "qa_result") || snapshot.status === "completed";
  return {
    ...evidence, raw_row: withoutRawQaResult(snapshot.raw_row || {}),
    status: snapshot.status === "completed" ? unprocessedStatus(snapshot) : snapshot.status,
    error: snapshot.error || (markUnverified && unverified ? LEGACY_REVIEW_ERROR : null),
  };
}

export const selectJobSkus = <T extends JobSkuState>(skus: T[], skuId?: string, rerunAll = false) =>
  skuId ? skus.filter((sku) => sku.sku === skuId) : rerunAll ? skus : skus.filter((sku) => !hasCompletedQa(sku));

export const getJobRunStatus = (
  skus: JobSkuState[],
  processedSkuIds: Set<string>,
  runHadError: boolean,
) => {
  if (runHadError) return "failed" as const;

  const remaining = skus.filter((sku) => !processedSkuIds.has(sku.sku) && !hasCompletedQa(sku));
  return remaining.some((sku) => sku.status === "failed") ? "failed" : remaining.length ? "pending" : "completed";
};

export const getCommonAttributeSet = (items: AttributeSetItem[]) => {
  const values = items.map((item) => item.attribute_set);
  if (!values.length || values.some((value) => typeof value !== "string" || !value.trim())) return null;
  return new Set(values).size === 1 ? values[0]! : null;
};

export const getCommonHeaderOrder = (items: HeaderItem[]) => {
  if (!items.length) return null;

  const storedOrders = items
    .map((item) => item.source?.headerOrder)
    .filter((headers): headers is string[] => Boolean(headers?.length));
  if (storedOrders.length) {
    const first = storedOrders[0];
    if (storedOrders.some((headers) => headers.length !== first.length || headers.some((header, index) => header !== first[index]))) {
      return null;
    }

    const headerSet = new Set(first);
    const legacyItems = items.filter((item) => !item.source?.headerOrder?.length);
    if (legacyItems.some((item) => Object.keys(item.raw_row || {}).some((header) => header !== "qa_result" && !headerSet.has(header)))) {
      return null;
    }
    return { headers: first, legacy: legacyItems.length > 0 };
  }

  return {
    headers: [...new Set(items.flatMap((item) => Object.keys(item.raw_row || {}).filter((header) => header !== "qa_result")))],
    legacy: true,
  };
};

export const getCompletedJobSkuIds = (items: JobItem[]) => [
  ...new Set(items.filter((item) => item.status === "completed").flatMap((item) => item.skus)),
];

export const getExportColumns = (headers: string[], affectedAttributeIndexes: ReadonlySet<number>) => [
  ...headers.flatMap((header, index) => [
    { header, key: `input_${index}`, width: 20 },
    ...(header.startsWith("attributes__") && affectedAttributeIndexes.has(index)
      ? [{ header: `Corrected: ${header}`, key: `corrected_${index}`, width: 30 }]
      : []),
  ]),
  { header: "qa_status", key: "qa_status", width: 15 },
  { header: "qa_scrape_status", key: "qa_scrape_status", width: 20 },
  { header: "job_error", key: "job_error", width: 40 },
];
