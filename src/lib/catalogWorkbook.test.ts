import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import {
  CATALOG_WORKBOOK_LIMITS,
  parseCatalogWorksheet,
  populateJobResultsWorksheet,
} from "./catalogWorkbook.ts";

const headers = ["zeta", "10", "sku", "attribute_set", "source__sap"];
assert.equal(CATALOG_WORKBOOK_LIMITS.rows, 5_000);
const sourceWorkbook = new ExcelJS.Workbook();
const sourceSheet = sourceWorkbook.addWorksheet("Catalog");
sourceSheet.addRow(headers);
sourceSheet.addRow(["last", "ten", "sku-1", "TV", "truth"]);

const importedWorkbook = new ExcelJS.Workbook();
await importedWorkbook.xlsx.load(await sourceWorkbook.xlsx.writeBuffer());
const parsed = parseCatalogWorksheet(importedWorkbook.worksheets[0]!, "catalog.xlsx");
assert.deepEqual(parsed[0].source.headerOrder, headers);

const exportedWorkbook = new ExcelJS.Workbook();
populateJobResultsWorksheet(exportedWorkbook.addWorksheet("QA Results"), parsed);
const roundTrippedWorkbook = new ExcelJS.Workbook();
await roundTrippedWorkbook.xlsx.load(await exportedWorkbook.xlsx.writeBuffer());
assert.deepEqual(
  (roundTrippedWorkbook.worksheets[0].getRow(1).values as ExcelJS.CellValue[]).slice(1, headers.length + 1),
  headers,
);

const duplicateSheet = new ExcelJS.Workbook().addWorksheet("Duplicates");
duplicateSheet.addRow(headers);
duplicateSheet.addRow(["a", "b", "same-sku", "TV", "truth"]);
duplicateSheet.addRow(["c", "d", "same-sku", "TV", "truth"]);
assert.throws(() => parseCatalogWorksheet(duplicateSheet, "duplicates.xlsx"), /Duplicate SKU/);

const oversizedSheet = new ExcelJS.Workbook().addWorksheet("Oversized");
oversizedSheet.addRow(["sku", "source__sap"]);
oversizedSheet.addRow(["sku-2", "x".repeat(CATALOG_WORKBOOK_LIMITS.cellCharacters + 1)]);
assert.throws(() => parseCatalogWorksheet(oversizedSheet, "oversized.xlsx"), /character limit/);

const missingSkuSheet = new ExcelJS.Workbook().addWorksheet("Missing SKU");
missingSkuSheet.addRow(["sku", "source__sap"]);
missingSkuSheet.addRow(["", "truth"]);
assert.throws(() => parseCatalogWorksheet(missingSkuSheet, "missing-sku.xlsx"), /data but no SKU/);

const sparseSheet = new ExcelJS.Workbook().addWorksheet("Sparse");
sparseSheet.addRow(["sku"]);
sparseSheet.getRow(CATALOG_WORKBOOK_LIMITS.rows + 2).getCell(1).value = "too-far";
assert.throws(() => parseCatalogWorksheet(sparseSheet, "sparse.xlsx"), /row limit/);
