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
import { populateQaWorksheet } from "./qaExcelExport.ts";

const skus = [
  { sku: "done", status: "completed" },
  { sku: "qa-fail", status: "failed", qa_result: { qa_status: "fail" } },
  { sku: "retry", status: "failed" },
];

assert.deepEqual(selectJobSkus(skus).map((sku) => sku.sku), ["retry"]);
assert.deepEqual(selectJobSkus(skus, undefined, true).map((sku) => sku.sku), ["done", "qa-fail", "retry"]);
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
sheet.columns = getExportColumns(importedHeaders, new Set());

const qaHeaders = [
  "sku", "attributes__brand", "attributes__color", "attributes__capacity", "brand", "weight",
  "attributes__model", "source__sap", "source__url", "qa_status", "attribute_set",
];
const qaRows: Parameters<typeof populateQaWorksheet>[2] = [
  {
    status: "failed",
    scrape_status: "success",
    raw_row: {
      sku: "00123", attributes__brand: "Samsng", attributes__color: "Blue", attributes__capacity: "256 GB",
      brand: "Original brand", weight: "2 kg", attributes__model: "M1", source__sap: "Brand: Samsung",
      source__url: "https://example.com/product", qa_status: "Original status", attribute_set: "TV",
      qa_result: { qa_status: "pass", issues: [{ field: "attributes__model", explanation: "Stale result" }] },
    },
    qa_result: {
      qa_status: "fail",
      issues: [
        { field: "attributes__brand", explanation: "The brand does not match SAP.", source_truth: "Samsung", suggested_fix: "Samsung", severity: "critical", cell_color: "yellow" },
        { field: "attributes__brand", explanation: "The brand is misspelled.", suggested_fix: "Samsung", severity: "minor" },
        { field: "color", explanation: "The source says Black.", suggested_fix: "Black", severity: "moderate" },
        { field: "attributes__color", explanation: "Another source says Red.", suggested_fix: "Red", severity: "minor" },
        { field: "capacity", explanation: "Capacity could not be verified.", suggested_fix: " ", severity: "minor" },
        { field: "brand", explanation: "This issue belongs to the exact bare header.", suggested_fix: "Exact brand", severity: "minor" },
        { field: "attributes__weight", explanation: "Weight is inconsistent.", suggested_fix: "1 kg", cell_color: "red" },
        { field: "missing_field", explanation: "An attribute is missing.", suggested_fix: "Missing value", severity: "moderate" },
        { field: "Brand", explanation: "Do not guess a matching column.", severity: "minor" },
        { explanation: "Review the product identity.", severity: "critical" },
      ],
    },
  },
  {
    status: "completed",
    raw_row: {
      sku: "legacy", attributes__brand: "Old brand", attributes__color: "Black", attributes__capacity: 0,
      qa_result: {
        qa_status: "warning",
        issues: [{ field: "attributes__brand", explanation: "Use the complete brand name.", source_truth: "New brand", suggested_fix: "New brand", cell_color: "orange" }],
      },
    },
  },
  {
    status: "completed",
    raw_row: { sku: "clean", attributes__brand: "Samsung", attributes__color: "Black", attributes__model: false },
    qa_result: { qa_status: "pass", issues: [] },
  },
  {
    status: "failed",
    error: "LLM API unavailable",
    raw_row: { sku: "api-error" },
  },
  {
    status: "completed",
    raw_row: { sku: "literal", attributes__model: "Old model", attributes__capacity: 1 },
    qa_result: {
      qa_status: "warning",
      issues: [
        { field: "model", explanation: "Use the exact model text.", suggested_fix: "=MODEL", severity: "minor" },
        { field: "capacity", explanation: "The count should be zero.", source_truth: 0, suggested_fix: 0, severity: "minor" },
      ],
    },
  },
];
const originalRows = JSON.stringify(qaRows);
populateQaWorksheet(workbook.addWorksheet("Cell feedback"), qaHeaders, qaRows);
assert.equal(JSON.stringify(qaRows), originalRows, "Export must not mutate catalog data");

const bulletHeaders = ["sku", "attributes__bullet_point_4", "attributes__bullet_point_5", "attributes__bullet_point_6", "source__sap", "qa_status"];
const cleanBulletRow: (typeof qaRows)[number] = {
  status: "completed",
  scrape_status: "success",
  raw_row: {
    sku: "clean", attributes__bullet_point_4: "Four", attributes__bullet_point_5: "Five",
    attributes__bullet_point_6: "Six", source__sap: "Original SAP", qa_status: "Original status",
    qa_result: { issues: [{ field: "attributes__bullet_point_6", suggested_fix: "Stale fix" }] },
  },
  qa_result: { qa_status: "pass", issues: [] },
};
const fiveRow: (typeof qaRows)[number] = {
  ...cleanBulletRow,
  raw_row: { ...cleanBulletRow.raw_row, sku: "five" },
  qa_result: { qa_status: "pass", issues: [{ field: "bullet_point_5", explanation: "Fix bullet five.", suggested_fix: "Fixed five", severity: "minor" }] },
};
const sixRow: (typeof qaRows)[number] = {
  ...cleanBulletRow,
  raw_row: { ...cleanBulletRow.raw_row, sku: "six" },
  qa_result: { qa_status: "fail", issues: [{ field: "attributes__bullet_point_6", explanation: "Fix bullet six.", suggested_fix: "Fixed six", severity: "critical" }] },
};
populateQaWorksheet(workbook.addWorksheet("Five first"), bulletHeaders, [fiveRow, cleanBulletRow]);
populateQaWorksheet(workbook.addWorksheet("Five last"), bulletHeaders, [cleanBulletRow, fiveRow]);
populateQaWorksheet(workbook.addWorksheet("Clean only"), bulletHeaders, [cleanBulletRow]);
populateQaWorksheet(workbook.addWorksheet("Combined"), bulletHeaders, [fiveRow, cleanBulletRow, sixRow]);
populateQaWorksheet(workbook.addWorksheet("Six only"), bulletHeaders, [sixRow]);
populateQaWorksheet(workbook.addWorksheet("General only"), bulletHeaders, [{
  ...cleanBulletRow,
  qa_result: { issues: [{ field: "unknown_attribute", explanation: "Check the product." }, { explanation: "General finding." }] },
}]);
populateQaWorksheet(workbook.addWorksheet("Bare header only"), qaHeaders, [{
  ...qaRows[2], qa_result: { issues: [{ field: "brand", explanation: "Exact header only." }] },
}]);
populateQaWorksheet(workbook.addWorksheet("Legacy only"), qaHeaders, [qaRows[1]]);
populateQaWorksheet(workbook.addWorksheet("Conflicting and missing"), qaHeaders, [qaRows[0]]);

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
]);

const feedback = loadedWorkbook.getWorksheet("Cell feedback")!;
assert.deepEqual((feedback.getRow(1).values as ExcelJS.CellValue[]).slice(1), [
  "sku", "attributes__brand", "Corrected: attributes__brand", "attributes__color", "Corrected: attributes__color",
  "attributes__capacity", "Corrected: attributes__capacity", "brand", "weight", "attributes__model",
  "Corrected: attributes__model", "source__sap", "source__url", "qa_status", "attribute_set",
  "qa_status", "qa_scrape_status", "job_error",
]);
const note = (address: string, worksheet = feedback) => {
  const comment = worksheet.getCell(address).note;
  return typeof comment === "string" ? comment : comment?.texts?.map((part) => part.text).join("") || "";
};
const color = (address: string) => (feedback.getCell(address).fill as ExcelJS.FillPattern)?.fgColor?.argb;

assert.equal(feedback.rowCount, qaRows.length + 1);
assert.equal(feedback.getCell("A2").value, "00123");
assert.equal(feedback.getCell("B2").value, "Samsng");
assert.equal(feedback.getCell("C2").value, "Samsung");
assert.match(note("B2"), /The brand does not match SAP\./);
assert.match(note("B2"), /The brand is misspelled\./);
assert.match(note("B2"), /Source truth: Samsung/);
assert.match(note("B2"), /Suggested correction: Samsung/);
assert.equal(color("B2"), "FFFFCCCC", "Highest severity wins even when the last issue is minor");
assert.equal(feedback.getCell("D2").value, "Blue");
assert.equal(feedback.getCell("E2").value, null);
assert.match(note("D2"), /The source says Black\./);
assert.match(note("D2"), /Another source says Red\./);
assert.match(note("D2"), /Review required: suggested corrections disagree/);
assert.equal(color("D2"), "FFFFE5B4");
assert.equal(feedback.getCell("G2").value, null);
assert.match(note("F2"), /Review required: no correction was supplied/);
assert.equal(color("F2"), "FFFFFFE0");
assert.match(note("H2"), /exact bare header/);
assert.doesNotMatch(note("B2"), /exact bare header/);
assert.match(note("I2"), /Weight is inconsistent/);
assert.equal(color("I2"), "FFFFCCCC");
assert.equal(note("J2"), "", "Top-level results take precedence over stale raw-row results");
assert.equal(feedback.getCell("K2").value, null);
assert.equal(feedback.getCell("L2").value, "Brand: Samsung");
assert.equal(feedback.getCell("M2").value, "https://example.com/product");
assert.equal(feedback.getCell("N2").value, "Original status");
assert.equal(note("N2"), "");
assert.equal(feedback.getCell("O2").value, "TV");
assert.equal(feedback.getCell("P2").value, "fail");
assert.equal(feedback.getCell("Q2").value, "success");
assert.match(note("P2"), /Field: missing_field/);
assert.match(note("P2"), /Suggested correction: Missing value/);
assert.match(note("P2"), /Field: Brand\nDo not guess/);
assert.match(note("P2"), /Field: General\nReview the product identity/);
assert.equal(color("P2"), "FFFFCCCC");
assert.equal(feedback.getCell("C3").value, "New brand", "Legacy stored results still export");
assert.match(note("B3"), /Use the complete brand name/);
assert.equal(color("B3"), "FFFFE5B4");
assert.equal(feedback.getCell("F3").value, 0);
assert.equal(feedback.getCell("P3").value, "warning");
for (const address of ["C4", "E4", "G4", "K4"]) assert.equal(feedback.getCell(address).value, null);
for (const address of ["B4", "D4", "F4", "J4", "P4"]) {
  assert.equal(note(address), "");
  assert.equal(color(address), undefined);
}
assert.equal(feedback.getCell("J4").value, false);
assert.equal(feedback.getCell("P4").value, "pass");
assert.equal(feedback.getCell("P5").value, "failed");
assert.equal(feedback.getCell("R5").value, "LLM API unavailable");
assert.equal(feedback.getCell("K6").value, "=MODEL", "Replacement text must not become an Excel formula");
assert.equal(feedback.getCell("G6").value, "0");
assert.match(note("F6"), /Source truth: 0/);
assert.equal(feedback.getCell("B1").font.bold, true);

const exportedHeaders = (worksheet: ExcelJS.Worksheet) => (worksheet.getRow(1).values as ExcelJS.CellValue[]).slice(1);
const metadataHeaders = ["qa_status", "qa_scrape_status", "job_error"];
const fiveHeaders = [
  "sku", "attributes__bullet_point_4", "attributes__bullet_point_5", "Corrected: attributes__bullet_point_5",
  "attributes__bullet_point_6", "source__sap", "qa_status", ...metadataHeaders,
];
for (const [name, affectedRow] of [["Five first", 2], ["Five last", 3]] as const) {
  const worksheet = loadedWorkbook.getWorksheet(name)!;
  assert.deepEqual(exportedHeaders(worksheet), fiveHeaders, "Row order must not change the columns");
  assert.equal(worksheet.getCell(`D${affectedRow}`).value, "Fixed five");
  assert.match(note(`C${affectedRow}`, worksheet), /Fix bullet five/);
  const cleanRow = affectedRow === 2 ? 3 : 2;
  assert.equal(worksheet.getCell(`D${cleanRow}`).value, null);
  assert.equal(note(`C${cleanRow}`, worksheet), "");
  for (const row of [2, 3]) {
    assert.equal(worksheet.getCell(`B${row}`).value, "Four");
    assert.equal(worksheet.getCell(`C${row}`).value, "Five");
    assert.equal(worksheet.getCell(`E${row}`).value, "Six");
    assert.equal(worksheet.getCell(`F${row}`).value, "Original SAP");
    assert.equal(worksheet.getCell(`G${row}`).value, "Original status");
    assert.equal(worksheet.getCell(`H${row}`).value, "pass", "Issue presence, not QA status, determines columns");
    assert.equal(worksheet.getCell(`I${row}`).value, "success");
  }
}
for (const name of ["Clean only", "General only"]) {
  const worksheet = loadedWorkbook.getWorksheet(name)!;
  assert.deepEqual(exportedHeaders(worksheet), [...bulletHeaders, ...metadataHeaders]);
}
const generalOnly = loadedWorkbook.getWorksheet("General only")!;
assert.match(note("G2", generalOnly), /Field: unknown_attribute/);
assert.match(note("G2", generalOnly), /General finding/);
const bareOnly = loadedWorkbook.getWorksheet("Bare header only")!;
assert.deepEqual(exportedHeaders(bareOnly), [...qaHeaders, ...metadataHeaders]);
assert.match(note("E2", bareOnly), /Exact header only/);

const combined = loadedWorkbook.getWorksheet("Combined")!;
assert.deepEqual(exportedHeaders(combined), [
  ...fiveHeaders.slice(0, 5), "Corrected: attributes__bullet_point_6", "source__sap", "qa_status", ...metadataHeaders,
]);
assert.equal(combined.getCell("D2").value, "Fixed five");
assert.equal(combined.getCell("F2").value, null);
assert.equal(combined.getCell("D3").value, null);
assert.equal(combined.getCell("F3").value, null);
assert.equal(combined.getCell("D4").value, null);
assert.equal(combined.getCell("F4").value, "Fixed six");
assert.match(note("E4", combined), /Fix bullet six/);

const sixOnly = loadedWorkbook.getWorksheet("Six only")!;
assert.deepEqual(exportedHeaders(sixOnly), [
  ...bulletHeaders.slice(0, 4), "Corrected: attributes__bullet_point_6", "source__sap", "qa_status", ...metadataHeaders,
], "Excluded rows must not contribute correction columns");
assert.equal(sixOnly.getCell("C2").value, "Five");
assert.equal(sixOnly.getCell("E2").value, "Fixed six");
assert.match(note("D2", sixOnly), /Fix bullet six/);

const legacyOnly = loadedWorkbook.getWorksheet("Legacy only")!;
assert.deepEqual(exportedHeaders(legacyOnly), [
  ...qaHeaders.slice(0, 2), "Corrected: attributes__brand", ...qaHeaders.slice(2), ...metadataHeaders,
]);
assert.equal(legacyOnly.getCell("C2").value, "New brand");
const partial = loadedWorkbook.getWorksheet("Conflicting and missing")!;
assert.deepEqual(exportedHeaders(partial), exportedHeaders(feedback).filter((header) => header !== "Corrected: attributes__model"));
assert.equal(partial.getCell("E2").value, null);
assert.match(note("D2", partial), /suggested corrections disagree/);
assert.equal(partial.getCell("G2").value, null);
assert.match(note("F2", partial), /no correction was supplied/);
assert.equal(partial.getCell("J2").value, "M1");
assert.equal(partial.getCell("K2").value, "Brand: Samsung");
assert.equal(partial.getCell("M2").value, "Original status");
assert.equal(partial.getCell("O2").value, "fail");
assert.match(note("O2", partial), /Field: missing_field/);

console.log("Job state and Excel feedback assertions passed.");
