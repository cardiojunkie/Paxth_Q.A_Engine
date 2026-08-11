import { useState } from "react";
import { AlertCircle, AlertTriangle, CheckCircle, Clock, Download, Eye, FileSpreadsheet, Play, RefreshCw, StopCircle, Trash2, X } from "lucide-react";
import { useAppContext, type Job } from "../context/AppContext";
import type { SkuData } from "../hooks/useCatalogData";
import { populateJobResultsWorksheet } from "../lib/catalogWorkbook";
import { cn } from "../lib/utils";
import { Modal } from "./Modal";

const ACTIVE_STATUSES = new Set<Job["status"]>(["queued", "running"]);
const EXPORTABLE_STATUSES = new Set<Job["status"]>(["completed", "completed_with_errors"]);

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function JobsModule() {
  const { jobs, queueJobs, stopJob, removeJob, getJobResults, refreshJobs, addNotification } = useAppContext();
  const [selectedJobs, setSelectedJobs] = useState<Set<string>>(new Set());
  const [busyJobs, setBusyJobs] = useState<Set<string>>(new Set());
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [results, setResults] = useState<SkuData[]>([]);
  const [isLoadingResults, setIsLoadingResults] = useState(false);
  const [expandedSku, setExpandedSku] = useState<string | null>(null);

  const notifyError = (title: string, error: unknown) => addNotification({
    type: "error",
    title,
    message: error instanceof Error ? error.message : "Please try again.",
  });

  const withBusy = async (ids: string[], action: () => Promise<void>) => {
    setBusyJobs((previous) => new Set([...previous, ...ids]));
    try {
      await action();
    } finally {
      setBusyJobs((previous) => {
        const next = new Set(previous);
        ids.forEach((id) => next.delete(id));
        return next;
      });
    }
  };

  const queue = async (ids: string[]) => {
    if (!ids.length) return;
    try {
      await withBusy(ids, () => queueJobs(ids));
      addNotification({ type: "success", title: "Jobs Queued", message: `Queued ${ids.length} job(s) for the server worker.` });
    } catch (error) {
      notifyError("Queue Failed", error);
    }
  };

  const stop = async (job: Job) => {
    try {
      await withBusy([job.id], () => stopJob(job.id));
      addNotification({ type: "info", title: "Stop Requested", message: `${job.name} will stop safely.` });
    } catch (error) {
      notifyError("Stop Failed", error);
    }
  };

  const openResults = async (job: Job) => {
    setSelectedJob(job);
    setResults([]);
    setExpandedSku(null);
    setIsLoadingResults(true);
    try {
      setResults(await getJobResults(job.id));
    } catch (error) {
      notifyError("Results Failed", error);
    } finally {
      setIsLoadingResults(false);
    }
  };

  const exportJob = async (job: Job, issuesOnly = false) => {
    try {
      let jobResults = await getJobResults(job.id);
      if (issuesOnly) jobResults = jobResults.filter((sku) => {
        const qa = sku.qa_result || sku.raw_row?.qa_result;
        return qa?.qa_status === "fail" || qa?.qa_status === "warning";
      });
      if (!jobResults.length) throw new Error(issuesOnly ? "This job has no warning or failed results." : "This job has no results.");

      const { default: ExcelJS } = await import("exceljs");
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet("QA Results");
      populateJobResultsWorksheet(sheet, jobResults);
      const suffix = issuesOnly ? "Issues" : "Results";
      download(new Blob([await workbook.xlsx.writeBuffer()], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `${job.name.replace(/[^a-z0-9_-]/gi, "_")}_${suffix}.xlsx`);
    } catch (error) {
      notifyError("Export Failed", error);
    }
  };

  const runnableSelected = jobs.filter((job) => selectedJobs.has(job.id) && !ACTIVE_STATUSES.has(job.status) && job.status !== "completed").map((job) => job.id);

  return (
    <div className="flex-1 flex flex-col h-full bg-[#FDFCFB] overflow-hidden">
      <header className="px-10 py-8 border-b border-[#E5E2DE] flex items-end justify-between">
        <div><h2 className="font-serif text-4xl tracking-tighter mb-2">QA Jobs</h2><p className="text-[#8C8882] text-sm">Jobs continue on the server after this browser closes.</p></div>
        <button onClick={() => void refreshJobs().catch((error) => notifyError("Refresh Failed", error))} className="flex items-center gap-2 px-4 py-2 border border-[#E5E2DE] text-xs uppercase"><RefreshCw className="w-4 h-4" />Refresh</button>
      </header>

      <div className="flex-1 overflow-y-auto p-10">
        <div className="max-w-6xl mx-auto space-y-5">
          <div className="flex items-center justify-between border-b border-[#E5E2DE] pb-4">
            <div className="flex gap-4 items-center"><h3 className="font-serif text-xl">Created Jobs ({jobs.length})</h3>{jobs.length > 0 && <button onClick={() => setSelectedJobs(selectedJobs.size === jobs.length ? new Set() : new Set(jobs.map((job) => job.id)))} className="text-[10px] uppercase text-[#8C8882]">{selectedJobs.size === jobs.length ? "Deselect All" : "Select All"}</button>}</div>
            <button onClick={() => void queue(runnableSelected)} disabled={!runnableSelected.length} className="flex items-center gap-2 px-4 py-2 bg-[#1A1A1A] text-white text-xs uppercase disabled:opacity-50"><Play className="w-4 h-4" />Queue Selected ({runnableSelected.length})</button>
          </div>

          {!jobs.length && <p className="p-10 border border-dashed border-[#E5E2DE] text-center text-[#8C8882]">Create a job from selected Dashboard SKUs.</p>}
          {jobs.map((job) => {
            const active = ACTIVE_STATUSES.has(job.status);
            const busy = busyJobs.has(job.id);
            const progress = job.progress;
            const percent = progress?.total ? Math.min(100, Math.round(progress.processed / progress.total * 100)) : 0;
            return <article key={job.id} className="bg-white border border-[#E5E2DE] p-5 shadow-sm">
              <div className="flex gap-4 items-start">
                <input aria-label={`Select ${job.name}`} type="checkbox" checked={selectedJobs.has(job.id)} onChange={() => setSelectedJobs((previous) => { const next = new Set(previous); next.has(job.id) ? next.delete(job.id) : next.add(job.id); return next; })} />
                <div className="flex-1 min-w-0">
                  <div className="flex gap-3 items-center"><h4 className="font-serif text-lg">{job.name}</h4><span className={cn("px-2 py-0.5 text-[10px] uppercase", job.status === "failed" || job.status === "completed_with_errors" ? "bg-red-50 text-red-700" : active ? "bg-amber-50 text-amber-700" : job.status === "completed" ? "bg-emerald-50 text-emerald-700" : "bg-gray-100")}>{job.status.replaceAll("_", " ")}</span></div>
                  <div className="flex gap-4 mt-2 text-[11px] text-[#8C8882] font-mono"><span><Clock className="inline w-3 h-3" /> {new Date(job.createdAt).toLocaleString()}</span><span>{job.skus.length} SKUs</span>{job.tokensUsed && <span>{job.tokensUsed.total_tokens.toLocaleString()} tokens</span>}</div>
                  {job.error && <p className="mt-2 text-xs text-red-700 flex gap-2"><AlertCircle className="w-4 h-4 shrink-0" />{job.error}</p>}
                  {active && progress && <div className="mt-3"><div className="flex justify-between text-[10px] text-[#8C8882]"><span>{progress.currentSku || "Waiting for worker"}</span><span>{progress.processed}/{progress.total}</span></div><div className="h-1.5 bg-[#E5E2DE] mt-1"><div className="h-full bg-[#1A1A1A]" style={{ width: `${percent}%` }} /></div></div>}
                </div>
                <div className="flex flex-wrap justify-end gap-2 max-w-xl">
                  <button onClick={() => void openResults(job)} className="flex items-center gap-1 px-3 py-2 bg-[#F5F2EF] text-[10px] uppercase"><Eye className="w-3.5 h-3.5" />View</button>
                  {EXPORTABLE_STATUSES.has(job.status) && <><button onClick={() => void exportJob(job)} className="flex items-center gap-1 px-3 py-2 bg-emerald-50 text-emerald-800 text-[10px] uppercase"><FileSpreadsheet className="w-3.5 h-3.5" />Export</button><button onClick={() => void exportJob(job, true)} className="flex items-center gap-1 px-3 py-2 bg-orange-50 text-orange-800 text-[10px] uppercase"><AlertTriangle className="w-3.5 h-3.5" />Issues</button></>}
                  {active ? <button onClick={() => void stop(job)} disabled={busy} className="flex items-center gap-1 px-3 py-2 border border-red-200 text-red-700 text-[10px] uppercase disabled:opacity-50"><StopCircle className="w-3.5 h-3.5" />Stop</button> : job.status !== "completed" && <button onClick={() => void queue([job.id])} disabled={busy} className="flex items-center gap-1 px-3 py-2 bg-[#1A1A1A] text-white text-[10px] uppercase disabled:opacity-50"><Play className="w-3.5 h-3.5" />Queue</button>}
                  <button aria-label={`Delete ${job.name}`} disabled={active || busy} onClick={async () => { if (!window.confirm(`Delete ${job.name}?`)) return; try { await withBusy([job.id], () => removeJob(job.id)); addNotification({ type: "info", title: "Job Deleted", message: `${job.name} was deleted.` }); } catch (error) { notifyError("Delete Failed", error); } }} className="p-2 text-red-600 disabled:opacity-30"><Trash2 className="w-4 h-4" /></button>
                </div>
              </div>
            </article>;
          })}
        </div>
      </div>

      {selectedJob && <Modal labelledBy="job-results-title" onClose={() => setSelectedJob(null)}>
        <div className="bg-white w-full max-h-[85vh] flex flex-col">
          <div className="p-5 border-b flex items-center justify-between"><div><h3 id="job-results-title" className="font-serif text-2xl">{selectedJob.name}</h3><p className="text-xs text-[#8C8882]">Job-specific result snapshot</p></div><div className="flex gap-2"><button onClick={() => void exportJob(selectedJob)} className="flex items-center gap-2 px-4 py-2 bg-emerald-700 text-white text-xs uppercase"><Download className="w-4 h-4" />Export</button><button aria-label="Close job results" onClick={() => setSelectedJob(null)}><X className="w-5 h-5" /></button></div></div>
          <div className="p-5 overflow-y-auto space-y-3">
            {isLoadingResults && <p role="status" className="text-center text-[#8C8882] p-8">Loading results…</p>}
            {!isLoadingResults && !results.length && <p className="text-center text-[#8C8882] p-8">No result snapshots yet.</p>}
            {results.map((sku, index) => {
              const qa = sku.qa_result || sku.raw_row?.qa_result;
              const issues = Array.isArray(qa?.issues) ? qa.issues : [];
              const expanded = expandedSku === sku.sku;
              const contentId = `job-result-${index}`;
              return <section key={sku.sku} className="border border-[#E5E2DE] p-4">
                <button type="button" aria-expanded={expanded} aria-controls={contentId} onClick={() => setExpandedSku(expanded ? null : sku.sku)} className="w-full flex justify-between text-left">
                  <span className="font-mono font-bold">{sku.sku}</span>
                  <span className="text-xs">{qa?.qa_status || sku.status} · {issues.length} issue(s)</span>
                </button>
                {expanded && <div id={contentId} className="pt-4 space-y-3">{qa?.summary && <p className="bg-[#F5F2EF] p-3 text-sm">{qa.summary}</p>}{sku.error && <p className="bg-red-50 text-red-700 p-3 text-sm">{sku.error}</p>}{issues.map((issue: any, issueIndex: number) => <div key={issueIndex} className="border-l-4 border-amber-400 pl-3 text-sm"><strong>{issue.field || "General"}</strong><p>{issue.explanation || "No explanation supplied."}</p>{issue.suggested_fix && <p className="text-emerald-800">Suggested: {issue.suggested_fix}</p>}</div>)}{!issues.length && !sku.error && <p className="text-emerald-700 flex gap-2"><CheckCircle className="w-4 h-4" />No issues recorded.</p>}</div>}
              </section>;
            })}
          </div>
        </div>
      </Modal>}
    </div>
  );
}
