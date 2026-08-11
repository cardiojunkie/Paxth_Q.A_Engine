import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import * as XLSX from "xlsx";
import {
  getCommonAttributeSet,
  getCommonHeaderOrder,
  getCompletedJobSkuIds,
  getExportColumns,
  getJobRunStatus,
  selectJobSkus,
} from "./jobRunState.ts";

const skus = [
  { sku: "done", status: "completed" },
  { sku: "qa-fail", status: "failed", qa_result: { qa_status: "fail" } },
  { sku: "retry", status: "failed" },
];

assert.deepEqual(selectJobSkus(skus).map((sku) => sku.sku), ["retry"]);
assert.deepEqual(selectJobSkus(skus, "done").map((sku) => sku.sku), ["done"]);
assert.deepEqual(selectJobSkus([{ ...skus[0], error: "API error", qa_result: {} }]).map((sku) => sku.sku), ["done"]);
assert.equal(getJobRunStatus(skus, new Set(["done"]), false), "failed");
assert.equal(getJobRunStatus(skus, new Set(["retry"]), false), "completed");
assert.equal(getJobRunStatus([...skus, { sku: "waiting", status: "ready" }], new Set(["retry"]), false), "pending");

assert.equal(getCommonAttributeSet([{ attribute_set: "TV" }, { attribute_set: "TV" }]), "TV");
assert.equal(getCommonAttributeSet([]), null);
assert.equal(getCommonAttributeSet([{ attribute_set: "TV" }, { attribute_set: "Audio" }]), null);
assert.equal(getCommonAttributeSet([{ attribute_set: "TV" }, { attribute_set: "tv" }]), null);
assert.equal(getCommonAttributeSet([{ attribute_set: "TV" }, {}]), null);
assert.equal(getCommonAttributeSet([{ attribute_set: " " }]), null);

const persistedHeaders = JSON.parse(JSON.stringify(["10", "2", "sku"]));
assert.deepEqual(
  getCommonHeaderOrder([
    { source: { headerOrder: persistedHeaders }, raw_row: { sku: "1" } },
    { source: { headerOrder: ["10", "2", "sku"] }, raw_row: { sku: "2" } },
  ]),
  { headers: ["10", "2", "sku"], legacy: false },
);
assert.equal(
  getCommonHeaderOrder([
    { source: { headerOrder: ["sku", "title"] } },
    { source: { headerOrder: ["title", "sku"] } },
  ]),
  null,
);
assert.deepEqual(getCommonHeaderOrder([{ raw_row: { sku: "1", title: "Item", qa_result: {} } }]), {
  headers: ["sku", "title"],
  legacy: true,
});
assert.deepEqual(
  getCommonHeaderOrder([
    { source: { headerOrder: ["sku", "title"] } },
    { raw_row: { sku: "2" } },
  ]),
  { headers: ["sku", "title"], legacy: true },
);
assert.equal(
  getCommonHeaderOrder([
    { source: { headerOrder: ["sku", "title"] } },
    { raw_row: { sku: "2", color: "Red" } },
  ]),
  null,
);
assert.deepEqual(
  getCommonHeaderOrder([
    { raw_row: { sku: "1", title: "Item", color: "Red" } },
    { raw_row: { sku: "2", color: "Blue" } },
  ]),
  { headers: ["sku", "title", "color"], legacy: true },
);
assert.equal(getCommonHeaderOrder([]), null);

assert.deepEqual(
  getCompletedJobSkuIds([
    { status: "completed", skus: ["a", "b"] },
    { status: "pending", skus: ["ignored"] },
    { status: "completed", skus: ["b", "c"] },
  ]),
  ["a", "b", "c"],
);
assert.deepEqual(getCompletedJobSkuIds([{ status: "pending", skus: ["ignored"] }]), []);

const importedSheet = XLSX.utils.aoa_to_sheet([
  ["zeta", 10, 2, "qa_status", "sku", "alpha"],
  ["last", "ten", "two", "original", "1", "first"],
]);
const [importedHeaderRow = []] = XLSX.utils.sheet_to_json<any[]>(importedSheet, {
  header: 1,
  raw: false,
  defval: "",
  blankrows: false,
});
const importedHeaders = importedHeaderRow.map(String);
assert.deepEqual(importedHeaders, ["zeta", "10", "2", "qa_status", "sku", "alpha"]);

const workbook = new ExcelJS.Workbook();
const sheet = workbook.addWorksheet("QA Results");
sheet.columns = getExportColumns(importedHeaders, 2);
const loadedWorkbook = new ExcelJS.Workbook();
await loadedWorkbook.xlsx.load(await workbook.xlsx.writeBuffer());
const loadedSheet = loadedWorkbook.getWorksheet("QA Results")!;
assert.deepEqual((loadedSheet.getRow(1).values as ExcelJS.CellValue[]).slice(1), [
  "zeta",
  "10",
  "2",
  "qa_status",
  "sku",
  "alpha",
  "qa_status",
  "qa_scrape_status",
  "job_error",
  "Error 1",
  "Error 2",
]);
