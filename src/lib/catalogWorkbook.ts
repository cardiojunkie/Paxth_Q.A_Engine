import type { Worksheet } from "exceljs";
import type { QAStatus, SkuData } from "../hooks/useCatalogData";
import { getCommonHeaderOrder, getExportColumns } from "./jobRunState";

export const CATALOG_WORKBOOK_LIMITS = {
  fileBytes: 10 * 1024 * 1024,
  rows: 5_000,
  columns: 500,
  cellCharacters: 10_000,
  totalCharacters: 5_000_000,
} as const;

export function parseCatalogWorksheet(sheet: Worksheet, fileName: string): SkuData[] {
  if (sheet.actualRowCount < 2) throw new Error("The first worksheet has no data rows.");
  if (sheet.rowCount - 1 > CATALOG_WORKBOOK_LIMITS.rows) {
    throw new Error(`Workbook exceeds the ${CATALOG_WORKBOOK_LIMITS.rows.toLocaleString()} row limit.`);
  }
  if (sheet.actualColumnCount > CATALOG_WORKBOOK_LIMITS.columns) {
    throw new Error(`Workbook exceeds the ${CATALOG_WORKBOOK_LIMITS.columns} column limit.`);
  }

  const headerOrder = Array.from(
    { length: sheet.actualColumnCount },
    (_, index) => sheet.getRow(1).getCell(index + 1).text.trim(),
  );
  if (headerOrder.some((header) => !header)) throw new Error("Every used column must have a header.");
  if (new Set(headerOrder.map((header) => header.toLowerCase())).size !== headerOrder.length) {
    throw new Error("Column headers must be unique.");
  }
  const skuHeader = headerOrder.find((header) => header.toLowerCase() === "sku");
  if (!skuHeader) throw new Error("A 'sku' column is required.");

  const parsedSkus: SkuData[] = [];
  const seen = new Set<string>();
  let totalCharacters = 0;
  for (let rowIndex = 2; rowIndex <= sheet.rowCount; rowIndex++) {
    const values = headerOrder.map((_, columnIndex) => sheet.getRow(rowIndex).getCell(columnIndex + 1).text);
    if (values.every((value) => !value.trim())) continue;
    for (const value of values) {
      if (value.length > CATALOG_WORKBOOK_LIMITS.cellCharacters) {
        throw new Error(`Cell ${rowIndex} exceeds the ${CATALOG_WORKBOOK_LIMITS.cellCharacters.toLocaleString()} character limit.`);
      }
      totalCharacters += value.length;
    }
    if (totalCharacters > CATALOG_WORKBOOK_LIMITS.totalCharacters) {
      throw new Error(`Workbook text exceeds the ${CATALOG_WORKBOOK_LIMITS.totalCharacters.toLocaleString()} character limit.`);
    }

    const row = Object.fromEntries(headerOrder.map((header, index) => [header, values[index]]));
    const sku = String(row[skuHeader] || "").trim();
    if (!sku) throw new Error(`Row ${rowIndex} has data but no SKU.`);
    if (seen.has(sku)) throw new Error(`Duplicate SKU '${sku}' found in the workbook.`);
    seen.add(sku);

    const upload_attributes: Record<string, string> = {};
    const source: SkuData["source"] = { fileName, headerOrder };
    let attribute_set: string | undefined;
    for (const [key, value] of Object.entries(row)) {
      const lower = key.toLowerCase();
      if (key.startsWith("attributes__")) upload_attributes[key.slice(12)] = value;
      else if (key === "source__sap" || lower === "sap") source.sap = value;
      else if (key === "source__url" || lower === "url") source.url = value;
      else if (lower === "attribute_set" || lower === "attribute set") attribute_set = value;
    }
    const status: QAStatus = source.sap || source.url ? "ready" : "cannot_qa";
    parsedSkus.push({ sku, upload_attributes, source, raw_row: row, status, attribute_set });
  }

  if (!parsedSkus.length) throw new Error("No unique, non-empty SKUs were found.");
  return parsedSkus;
}

export function populateJobResultsWorksheet(sheet: Worksheet, jobResults: SkuData[]) {
  const headerOrder = getCommonHeaderOrder(jobResults);
  if (!headerOrder?.headers.length) throw new Error("Original workbook headers are missing or incompatible.");

  const maxIssues = Math.max(0, ...jobResults.map((sku) => {
    const qa = sku.qa_result || sku.raw_row?.qa_result;
    return Array.isArray(qa?.issues) ? qa.issues.length : 0;
  }));
  sheet.columns = getExportColumns(headerOrder.headers, maxIssues);

  for (const sku of jobResults) {
    const qa = sku.qa_result || sku.raw_row?.qa_result;
    const rowData: Record<string, unknown> = {};
    headerOrder.headers.forEach((header, index) => {
      const value = sku.raw_row?.[header];
      rowData[`input_${index}`] = value && typeof value === "object" ? JSON.stringify(value) : value;
    });
    rowData.qa_status = qa?.qa_status || sku.status;
    rowData.qa_scrape_status = sku.scrape_status || "";
    rowData.job_error = sku.error || "";
    if (Array.isArray(qa?.issues)) qa.issues.forEach((issue: any, index: number) => {
      rowData[`error_${index + 1}`] = `${issue.field || "general"}: ${issue.explanation || ""}`;
    });
    sheet.addRow(rowData);
  }
  sheet.getRow(1).font = { bold: true };
}
