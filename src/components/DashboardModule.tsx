import { useRef, useState } from "react";
import { CheckSquare, Download, ExternalLink, FileText, Square, Trash2, UploadCloud, X } from "lucide-react";
import { useAppContext, type NewJob } from "../context/AppContext";
import { type SkuData } from "../hooks/useCatalogData";
import { CATALOG_WORKBOOK_LIMITS, parseCatalogWorksheet } from "../lib/catalogWorkbook";
import { getCommonAttributeSet } from "../lib/jobRunState";
import { cn } from "../lib/utils";
import { Modal } from "./Modal";

type FilterType = "all" | "ready" | "cannot_qa" | "completed" | "failed";

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function safeWebUrl(value?: string) {
  try {
    const url = new URL(value || "");
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

export function DashboardModule() {
  const {
    skuDataList,
    addParsedData,
    clearData,
    removeSkus,
    isLoadingSkuData,
    addJob,
    addNotification,
  } = useAppContext();
  const [fileName, setFileName] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterType>("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedSkus, setSelectedSkus] = useState<Set<string>>(new Set());
  const [viewedSource, setViewedSource] = useState<{ title: string; content: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const filteredList = skuDataList.filter((sku) => {
    const query = searchTerm.toLowerCase();
    return (filter === "all" || sku.status === filter)
      && (!query || sku.sku.toLowerCase().includes(query) || sku.attribute_set?.toLowerCase().includes(query));
  });

  const notifyError = (title: string, value: unknown) => {
    addNotification({ type: "error", title, message: value instanceof Error ? value.message : "Please try again." });
  };

  const handleFileUpload = async (file: File) => {
    setError(null);
    if (!file.name.toLowerCase().endsWith(".xlsx")) {
      setError("Only .xlsx workbooks are supported.");
      return;
    }
    if (file.size > CATALOG_WORKBOOK_LIMITS.fileBytes) {
      setError("Workbook must be 10 MiB or smaller.");
      return;
    }

    setIsUploading(true);
    try {
      const { default: ExcelJS } = await import("exceljs");
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(new Uint8Array(await file.arrayBuffer()) as any);
      const sheet = workbook.worksheets[0];
      if (!sheet) throw new Error("The workbook has no worksheet.");
      const parsedSkus = parseCatalogWorksheet(sheet, file.name);

      const existing = new Set(skuDataList.map((item) => item.sku));
      const newSkus = parsedSkus.filter((item) => !existing.has(item.sku));
      if (!newSkus.length) throw new Error("Every SKU in this workbook is already indexed.");
      await addParsedData(newSkus);
      setFileName(file.name);
      addNotification({
        type: parsedSkus.length === newSkus.length ? "success" : "warning",
        title: "Workbook Indexed",
        message: `Added ${newSkus.length} SKU(s)${newSkus.length < parsedSkus.length ? `; skipped ${parsedSkus.length - newSkus.length} duplicate(s)` : ""}.`,
      });
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not read the workbook.");
    } finally {
      setIsUploading(false);
    }
  };

  const createJob = async () => {
    const selected = skuDataList.filter((sku) => selectedSkus.has(sku.sku));
    const attributeSet = getCommonAttributeSet(selected);
    if (!attributeSet) {
      addNotification({ type: "error", title: "Cannot Create Job", message: "Choose SKUs with one non-empty attribute set." });
      return;
    }
    if (selected.some((sku) => !sku.source.sap && !sku.source.url)) {
      addNotification({ type: "error", title: "Cannot Create Job", message: "Every selected SKU needs SAP text or a URL." });
      return;
    }
    const job: NewJob = {
      name: `Job for ${attributeSet}`,
      attribute_set: attributeSet,
      skus: selected.map((sku) => sku.sku),
    };
    try {
      await addJob(job);
      setSelectedSkus(new Set());
      addNotification({ type: "success", title: "Job Created", message: `Created a job with ${job.skus.length} SKU(s).` });
    } catch (error) {
      notifyError("Job Creation Failed", error);
    }
  };

  const exportResults = async () => {
    if (!skuDataList.length) return;
    try {
      const { default: ExcelJS } = await import("exceljs");
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet("QA Results");
      sheet.addRow(["SKU", "Status", "Attribute Set", "QA Status", "Summary", "Issues"]);
      for (const sku of skuDataList) {
        const result = sku.qa_result || sku.raw_row?.qa_result || {};
        sheet.addRow([
          sku.sku,
          sku.status,
          sku.attribute_set || "",
          result.qa_status || "",
          result.summary || "",
          Array.isArray(result.issues) ? result.issues.map((issue: any) => issue.explanation || issue.field).join(" | ") : "",
        ]);
      }
      sheet.getRow(1).font = { bold: true };
      download(new Blob([await workbook.xlsx.writeBuffer()], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), "catalog-qa-results.xlsx");
    } catch (error) {
      notifyError("Export Failed", error);
    }
  };

  const toggleAll = () => setSelectedSkus(selectedSkus.size === filteredList.length
    ? new Set()
    : new Set(filteredList.map((item) => item.sku)));

  const stats = {
    total: skuDataList.length,
    ready: skuDataList.filter((item) => item.status === "ready").length,
    completed: skuDataList.filter((item) => item.status === "completed").length,
    failed: skuDataList.filter((item) => item.status === "failed").length,
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[#FDFCFB] overflow-hidden">
      <header className="px-8 py-5 border-b border-[#E5E2DE] bg-white flex items-center justify-between">
        <div>
          <h2 className="font-serif text-2xl">Indexed SKUs Dashboard</h2>
          {fileName && <p className="text-xs text-[#8C8882] mt-1">Last upload: {fileName}</p>}
        </div>
        <div className="flex gap-2">
          <button onClick={() => fileInputRef.current?.click()} disabled={isUploading} className="flex items-center gap-2 px-3 py-2 bg-[#1A1A1A] text-white text-xs uppercase disabled:opacity-50"><UploadCloud className="w-4 h-4" />{isUploading ? "Importing…" : "Upload .xlsx"}</button>
          <input ref={fileInputRef} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden" onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void handleFileUpload(file);
            event.target.value = "";
          }} />
          <button onClick={exportResults} disabled={!skuDataList.length} className="flex items-center gap-2 px-3 py-2 border border-[#E5E2DE] text-xs uppercase disabled:opacity-50"><Download className="w-4 h-4" />Export</button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-8 space-y-5">
        {error && <div role="alert" className="bg-red-50 border border-red-200 text-red-700 p-3 flex justify-between"><span>{error}</span><button aria-label="Dismiss error" onClick={() => setError(null)}><X className="w-4 h-4" /></button></div>}
        <div className="grid grid-cols-4 gap-4">
          {Object.entries(stats).map(([label, value]) => <div key={label} className="bg-white border border-[#E5E2DE] p-4"><span className="text-[10px] uppercase text-[#8C8882]">{label}</span><div className="font-serif text-3xl">{value}</div></div>)}
        </div>
        <div className="bg-white border border-[#E5E2DE] p-4 flex flex-wrap gap-3 items-center">
          <input aria-label="Search catalog" value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Search SKU or attribute set" className="px-3 py-2 border border-[#E5E2DE] text-sm flex-1 min-w-56" />
          <select aria-label="Filter catalog" value={filter} onChange={(event) => setFilter(event.target.value as FilterType)} className="px-3 py-2 border border-[#E5E2DE] text-sm">
            {(["all", "ready", "cannot_qa", "completed", "failed"] as const).map((item) => <option key={item} value={item}>{item.replace("_", " ")}</option>)}
          </select>
          <button onClick={createJob} disabled={!selectedSkus.size} className="px-4 py-2 bg-[#1A1A1A] text-white text-xs uppercase disabled:opacity-50"><FileText className="w-4 h-4 inline mr-2" />Create Job ({selectedSkus.size})</button>
          <button onClick={async () => {
            if (!selectedSkus.size || !window.confirm(`Delete ${selectedSkus.size} selected SKU(s)?`)) return;
            try { await removeSkus([...selectedSkus]); setSelectedSkus(new Set()); }
            catch (error) { notifyError("Delete Failed", error); }
          }} disabled={!selectedSkus.size} className="px-4 py-2 border border-red-200 text-red-700 text-xs uppercase disabled:opacity-50"><Trash2 className="w-4 h-4 inline mr-2" />Delete</button>
          <button onClick={async () => {
            if (!window.confirm("Delete every indexed SKU? Existing jobs and their result snapshots will be preserved.")) return;
            try { await clearData(); setSelectedSkus(new Set()); setFileName(null); }
            catch (error) { notifyError("Clear Failed", error); }
          }} disabled={!skuDataList.length} className="px-4 py-2 border border-red-200 text-red-700 text-xs uppercase disabled:opacity-50">Clear All</button>
        </div>

        <div className="bg-white border border-[#E5E2DE] overflow-x-auto">
          {isLoadingSkuData ? <p className="p-12 text-center text-[#8C8882]" role="status">Loading catalog…</p> : (
            <table className="w-full text-left text-sm">
              <thead className="bg-[#F5F2EF] text-[10px] uppercase text-[#8C8882]"><tr>
                <th className="p-3"><button aria-label="Select all visible SKUs" onClick={toggleAll}>{selectedSkus.size === filteredList.length && filteredList.length ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}</button></th>
                <th className="p-3">SKU</th><th className="p-3">Attribute Set</th><th className="p-3">Sources</th><th className="p-3">Status</th><th className="p-3">Actions</th>
              </tr></thead>
              <tbody>{filteredList.map((sku) => {
                const url = safeWebUrl(sku.source.url);
                return <tr key={sku.sku} className="border-t border-[#E5E2DE]">
                  <td className="p-3"><input aria-label={`Select ${sku.sku}`} type="checkbox" checked={selectedSkus.has(sku.sku)} onChange={() => setSelectedSkus((previous) => { const next = new Set(previous); next.has(sku.sku) ? next.delete(sku.sku) : next.add(sku.sku); return next; })} /></td>
                  <td className="p-3 font-mono">{sku.sku}</td><td className="p-3">{sku.attribute_set || "—"}</td>
                  <td className="p-3 flex gap-3">
                    {sku.source.sap && <button className="text-blue-700" onClick={() => setViewedSource({ title: `${sku.sku} SAP`, content: sku.source.sap! })}>SAP</button>}
                    {url && <a className="text-blue-700" href={url} target="_blank" rel="noreferrer">URL <ExternalLink className="inline w-3 h-3" /></a>}
                    {sku.scraped_markdown && <button className="text-emerald-700" onClick={() => setViewedSource({ title: `${sku.sku} scraped content`, content: sku.scraped_markdown! })}>Scraped</button>}
                  </td>
                  <td className="p-3"><span className={cn("px-2 py-1 text-[10px] uppercase", sku.status === "failed" ? "bg-red-50 text-red-700" : "bg-[#F5F2EF]")}>{sku.status.replace("_", " ")}</span></td>
                  <td className="p-3"><button aria-label={`Delete ${sku.sku}`} onClick={async () => { if (!window.confirm(`Delete SKU ${sku.sku}?`)) return; try { await removeSkus([sku.sku]); } catch (error) { notifyError("Delete Failed", error); } }}><Trash2 className="w-4 h-4 text-red-600" /></button></td>
                </tr>;
              })}</tbody>
            </table>
          )}
          {!isLoadingSkuData && !filteredList.length && <p className="p-12 text-center text-[#8C8882]">No matching SKUs.</p>}
        </div>
      </div>

      {viewedSource && <Modal labelledBy="source-title" onClose={() => setViewedSource(null)}>
        <div className="bg-white w-full max-h-[80vh] flex flex-col">
          <div className="p-4 border-b flex justify-between"><h3 id="source-title" className="font-serif text-xl">{viewedSource.title}</h3><button aria-label="Close source viewer" onClick={() => setViewedSource(null)}><X className="w-5 h-5" /></button></div>
          <pre className="p-5 overflow-auto whitespace-pre-wrap text-xs">{viewedSource.content}</pre>
        </div>
      </Modal>}
    </div>
  );
}
