type AttributeSetItem = {
  attribute_set?: string | null;
};

type HeaderItem = {
  source?: { headerOrder?: string[] };
  raw_row?: Record<string, unknown>;
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

export const getExportColumns = (headers: string[], maxIssues: number) => [
  ...headers.map((header, index) => ({ header, key: `input_${index}`, width: 20 })),
  { header: "qa_status", key: "qa_status", width: 15 },
  { header: "qa_scrape_status", key: "qa_scrape_status", width: 20 },
  { header: "job_error", key: "job_error", width: 40 },
  ...Array.from({ length: maxIssues }, (_, index) => ({
    header: `Error ${index + 1}`,
    key: `error_${index + 1}`,
    width: 60,
  })),
];
