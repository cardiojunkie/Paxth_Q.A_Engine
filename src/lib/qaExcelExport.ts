import type { Worksheet } from "exceljs";
import type { SkuData } from "../hooks/useCatalogData";
import { getExportColumns } from "./jobRunState";

type QaIssue = {
  field?: string;
  explanation?: unknown;
  source_truth?: unknown;
  suggested_fix?: unknown;
  severity?: string;
  cell_color?: string;
};

const issueText = (value: unknown): string =>
  typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    ? String(value).trim()
    : "";

export function populateQaWorksheet(
  sheet: Worksheet,
  headers: string[],
  skus: Pick<SkuData, "raw_row" | "qa_result" | "status" | "scrape_status" | "error">[],
) {
  const headerIndexes = new Map(headers.map((header, index) => [header, index]));
  const affectedAttributeIndexes = new Set<number>();

  // Resolve each issue once so column selection and cell notes use the same header.
  const preparedSkus = skus.map((sku) => {
    const qa = sku.qa_result || sku.raw_row?.qa_result;
    const groupedIssues = new Map<number, QaIssue[]>();

    for (const issue of Array.isArray(qa?.issues) ? qa.issues : []) {
      if (!issue || typeof issue !== "object" || Array.isArray(issue)) continue;
      const field = typeof issue.field === "string" ? issue.field : "";
      const alias = field.startsWith("attributes__") ? field.slice("attributes__".length) : `attributes__${field}`;
      const index = field ? headerIndexes.get(field) ?? headerIndexes.get(alias) ?? -1 : -1;
      const group = groupedIssues.get(index) || [];
      group.push(issue);
      groupedIssues.set(index, group);
      if (index >= 0 && headers[index].startsWith("attributes__")) affectedAttributeIndexes.add(index);
    }
    return { sku, qa, groupedIssues };
  });

  sheet.columns = getExportColumns(headers, affectedAttributeIndexes);

  for (const { sku, qa, groupedIssues } of preparedSkus) {
    const rowData: Record<string, any> = {
      qa_status: qa?.qa_status || sku.status,
      qa_scrape_status: sku.scrape_status,
      job_error: sku.error || "",
    };
    headers.forEach((header, index) => {
      const value = sku.raw_row?.[header];
      rowData[`input_${index}`] = typeof value === "object" && value !== null ? JSON.stringify(value) : value;
    });
    const row = sheet.addRow(rowData);
    for (const [index, issues] of groupedIssues) {
      const cell = row.getCell(index === -1 ? "qa_status" : `input_${index}`);
      const notes = issues.map((issue) => [
        `Field: ${issueText(issue.field) || "General"}`,
        issueText(issue.explanation) || "QA reported an issue requiring review.",
        issueText(issue.source_truth) ? `Source truth: ${issueText(issue.source_truth)}` : "",
        issueText(issue.suggested_fix) ? `Suggested correction: ${issueText(issue.suggested_fix)}` : "",
      ].filter(Boolean).join("\n"));

      if (affectedAttributeIndexes.has(index)) {
        const fixes = [...new Set(issues.map((issue) => issueText(issue.suggested_fix)).filter(Boolean))];
        if (fixes.length === 1) {
          row.getCell(`corrected_${index}`).value = fixes[0];
          row.getCell(`corrected_${index}`).alignment = { wrapText: true };
        } else {
          notes.push(fixes.length > 1
            ? "Review required: suggested corrections disagree. The correction cell is blank."
            : "Review required: no correction was supplied. The correction cell is blank.");
        }
      }

      const severity = Math.max(0, ...issues.map((issue) => {
        const rank = ["minor", "moderate", "critical"].indexOf(issue.severity);
        return rank >= 0 ? rank : ["yellow", "orange", "red"].indexOf(issue.cell_color);
      }));
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: ["FFFFFFE0", "FFFFE5B4", "FFFFCCCC"][severity] },
      };
      cell.note = notes.join("\n\n");
    }
  }

  sheet.getRow(1).font = { bold: true };
}
