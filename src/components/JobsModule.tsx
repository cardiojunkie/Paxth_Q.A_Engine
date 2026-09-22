import React, { useState, useRef, useEffect } from "react";
import { Play, Clock, StopCircle, CheckCircle, AlertCircle, Download, Eye, Trash2, X, AlertTriangle, FileSpreadsheet, ChevronDown, ChevronUp } from "lucide-react";
import { useAppContext, Job } from "../context/AppContext";
import type { SkuData } from "../hooks/useCatalogData";
import { getCommonAttributeSet, getCommonHeaderOrder, hasCompletedQa } from "../lib/jobRunState";
import { populateQaWorksheet } from "../lib/qaExcelExport";
import { api } from "../lib/api";
import { cn } from "../lib/utils";
import ExcelJS from "exceljs";
import { saveAs } from "file-saver";

type Run = {
  id: string; jobId: string; actorId: string; actorName: string; status: string;
  createdAt: string; finishedAt?: string; error?: string;
  items?: Array<{ sku: string; status: string; attempts: number; error?: string; snapshot: SkuData; result?: SkuData }>;
};
const active = (run: Run) => ["queued", "running", "cancelling"].includes(run.status);
const request = <T,>(url: string, body?: unknown) => api<T>(url, body === undefined ? {cache:'no-store'} : {method:'POST',body:JSON.stringify(body)});
const runSkus = (run: Run) => (run.items || []).map(item => item.result || {
  ...item.snapshot,
  ...(["queued", "running", "cancelled", "failed"].includes(item.status) ? {
    status: item.status === "running" ? "running" : item.status === "queued" ? "pending" : "failed",
    qa_result: undefined, raw_row: { ...item.snapshot.raw_row, qa_result: undefined },
    error: item.error || (item.status === "cancelled" ? "Cancelled" : null),
  } : {}),
} as SkuData);

export function JobsModule() {
  const { skuDataList, jobs, removeJob, addNotification, refreshData, user } = useAppContext();
  const [histories, setHistories] = useState<Record<string, Run[]>>({});
  const [activeRuns, setActiveRuns] = useState<Run[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [pollError, setPollError] = useState("");
  const [selectedJobToView, setSelectedJobToView] = useState<Job | null>(null);
  const [selectedRunId, setSelectedRunId] = useState("");
  const [viewRun, setViewRun] = useState<Run | null>(null);
  const [expandedSku, setExpandedSku] = useState<string | null>(null);
  const [selectedJobs, setSelectedJobs] = useState<Set<string>>(new Set());
  const latest = useRef({ refreshData, jobs });
  latest.current = { refreshData, jobs };
  const jobIds = jobs.map(job => job.id).join("\n");
  const pendingRequests = useRef(new Map<string, string>());

  useEffect(() => {
    let disposed = false;
    let busy = false;
    const poll = async () => {
      if (busy) return;
      busy = true;
      try {
        const pairs = await Promise.all(latest.current.jobs.map(async job => [job.id, await request<Run[]>(`/api/jobs/${encodeURIComponent(job.id)}/runs`)] as const));
        const runs = await Promise.all(pairs.flatMap(([, history]) => history.filter(active)).map(run => request<Run>(`/api/job-runs/${run.id}`)));
        if (!disposed) { setHistories(Object.fromEntries(pairs)); setActiveRuns(runs); setPollError(""); await latest.current.refreshData(); }
      } catch (error) { if (!disposed) setPollError(error instanceof Error ? error.message : "Could not load job progress"); }
      finally { busy = false; }
    };
    void poll();
    const timer = setInterval(poll, 2000);
    return () => { disposed = true; clearInterval(timer); };
  }, [jobIds]);

  useEffect(() => {
    setViewRun(null);
    if (!selectedRunId) return;
    let disposed = false;
    let busy = false;
    const poll = async () => {
      if (busy) return;
      busy = true;
      try { const run = await request<Run>(`/api/job-runs/${selectedRunId}`); if (!disposed) setViewRun(run); }
      catch (error) { if (!disposed) setPollError(error instanceof Error ? error.message : "Could not load run results"); }
      finally { busy = false; }
    };
    void poll();
    const timer = setInterval(poll, 2000);
    return () => { disposed = true; clearInterval(timer); };
  }, [selectedRunId]);

  const runJob = async (jobId: string, _sequential = false, sku?: string, all = false) => {
    const key = `${jobId}:${sku || (all ? "all" : "unfinished")}`;
    const requestId = pendingRequests.current.get(key) || crypto.randomUUID();
    pendingRequests.current.set(key, requestId);
    setSubmitting(true);
    try {
      const run = await request<Run>(`/api/jobs/${encodeURIComponent(jobId)}/runs`, { requestId, mode: sku ? "single" : all ? "all" : "unfinished", ...(sku ? { sku } : {}) });
      pendingRequests.current.delete(key);
      setHistories(previous => ({ ...previous, [jobId]: [run, ...(previous[jobId] || []).filter(item => item.id !== run.id)] }));
      if (active(run)) setActiveRuns(previous => [...previous.filter(item => item.id !== run.id), run]);
      if (selectedJobToView?.id === jobId) setSelectedRunId(run.id);
      addNotification({ type: "success", title: "Job Queued", message: "Execution continues on the server after you close this tab." });
      await refreshData();
      return true;
    } catch (error) {
      addNotification({ type: "error", title: "Could Not Start Job", message: error instanceof Error ? error.message : "Request failed. Retry to check the same request." });
      return false;
    } finally { setSubmitting(false); }
  };
  const runSelectedJobs = async () => {
    for (const id of selectedJobs) if (!activeRuns.some(run => run.jobId === id) && !await runJob(id, true)) break;
  };
  const stopRun = async (run: Run) => {
    try {
      const updated = await request<Run>(`/api/job-runs/${run.id}/cancel`, {});
      setActiveRuns(previous => previous.map(item => item.id === updated.id ? updated : item));
    } catch (error) { addNotification({ type: "error", title: "Could Not Stop Job", message: error instanceof Error ? error.message : "Request failed" }); }
  };
  const deleteJob = async (job: Job) => {
    try {
      if (!await removeJob(job.id)) return;
      setSelectedJobs(previous => new Set([...previous].filter(id => id !== job.id)));
      addNotification({ type: "info", title: "Job Removed", message: `Job "${job.name}" has been deleted.` });
    } catch (error) { addNotification({ type: "error", title: "Could Not Delete Job", message: error instanceof Error ? error.message : "Request failed" }); }
  };
  const loadJobSkus = async (job: Job, runId?: string) => {
    const history = await request<Run[]>(`/api/jobs/${encodeURIComponent(job.id)}/runs`);
    const id = runId || history[0]?.id;
    if (id) return runSkus(await request<Run>(`/api/job-runs/${id}`));
    const skus = job.skus.map(id => skuDataList.find(sku => sku.sku === id));
    if (skus.some(sku => !sku)) throw new Error("Some legacy job SKUs no longer exist in the catalog.");
    return skus as SkuData[];
  };

  const exportJobExcel = async (jobOrJobs: Job | Job[], issuesOnly: boolean = false) => {
    try {
      const jobsToExport = (Array.isArray(jobOrJobs) ? jobOrJobs : [jobOrJobs])
        .filter((job) => !Array.isArray(jobOrJobs) || job.status === "completed");
      if (jobsToExport.length === 0) {
        addNotification({
          type: "warning",
          title: "No Completed Jobs",
          message: "Select at least one completed job to export."
        });
        return;
      }

      const snapshots = await Promise.all(jobsToExport.map(job => loadJobSkus(job,
        !Array.isArray(jobOrJobs) && selectedJobToView?.id === job.id ? selectedRunId : undefined)));
      const allJobSkus = [...new Map(snapshots.flat().map(sku => [sku.sku, sku])).values()];
      const attributeSet = getCommonAttributeSet(allJobSkus);
      if (!attributeSet) {
        addNotification({
          type: "error",
          title: "Cannot Export Jobs",
          message: "The selected completed jobs contain multiple or missing attribute sets. All exported SKUs must use one non-empty attribute set."
        });
        return;
      }

      let jobSkus = allJobSkus;
      if (issuesOnly) {
        jobSkus = jobSkus.filter(sku => {
          const qa = sku.qa_result || (sku.raw_row && sku.raw_row.qa_result);
          return qa && (qa.qa_status === 'fail' || qa.qa_status === 'warning');
        });
      }
      if (jobSkus.length === 0) {
        addNotification({
          type: "warning",
          title: "No Data",
          message: "No SKU data found for this job."
        });
        return;
      }

      const headerOrder = getCommonHeaderOrder(jobSkus);
      if (!headerOrder || headerOrder.headers.length === 0) {
        addNotification({
          type: "error",
          title: "Header Mismatch",
          message: "The selected SKU files do not have the same original header order and cannot be exported together."
        });
        return;
      }

      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet(`QA Results`);
      populateQaWorksheet(sheet, headerOrder.headers, jobSkus);
      
      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const exportName = jobsToExport.length === 1 ? jobsToExport[0].name : `${attributeSet}_Combined`;
      const filename = `${exportName.replace(/[^a-zA-Z0-9_-]/g, '_')}_QA_Results.xlsx`;
      saveAs(blob, filename);

      addNotification({
        type: headerOrder.legacy ? "warning" : "success",
        title: headerOrder.legacy ? "Excel Exported with Header Warning" : "Excel Exported",
        message: headerOrder.legacy
          ? `Exported ${jobSkus.length} SKU(s), but exact header order cannot be guaranteed for legacy uploads.`
          : `Successfully exported ${jobSkus.length} SKU(s) from ${jobsToExport.length} job(s).`
      });
      
    } catch(e) {
      console.error("Export error:", e);
      addNotification({
        type: "error",
        title: "Export Failed",
        message: e instanceof Error ? e.message : "Failed to generate Excel file for job."
      });
    }
  };

  const exportSelectedJobs = () => {
    const completedJobs = jobs.filter((job) => selectedJobs.has(job.id) && job.status === "completed");
    if (completedJobs.length === 0) {
      addNotification({
        type: "warning",
        title: "No Completed Jobs",
        message: "Select at least one completed job to export."
      });
      return;
    }
    void exportJobExcel(completedJobs);
  };

  const getJobSkusList = (job: Job) => {
    if (selectedJobToView?.id === job.id && selectedRunId) return viewRun?.id === selectedRunId ? runSkus(viewRun) : [];
    return job.skus.map(s => skuDataList.find(item => item.sku === s)).filter(Boolean) as typeof skuDataList;
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[#FDFCFB] overflow-hidden">
      <header className="px-10 py-8 border-b border-[#E5E2DE] shrink-0 flex items-end justify-between">
        <div>
          <h2 className="font-serif text-4xl tracking-tighter mb-2 text-[#1A1A1A]">QA Jobs</h2>
          <p className="text-[#8C8882] text-sm leading-relaxed max-w-lg">
            Manage, execute, and export Quality Assurance tasks against selected SKUs.
          </p>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-10">
        <div className="max-w-6xl mx-auto space-y-8">
          
          {pollError && <p role="alert" className="text-sm text-red-700">{pollError}. Progress will retry automatically.</p>}
          {activeRuns.map(run => {
            const items = (run.items || []).filter(item => item.status !== "skipped");
            const completed = items.filter(item => ["completed", "failed", "cancelled"].includes(item.status)).length;
            const canStop = user?.role === "admin" || user?.id === run.actorId;
            return <div key={run.id} className="bg-[#F5F2EF] border border-[#E5E2DE] rounded-sm p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div><h4 className="font-serif text-lg">{jobs.find(job => job.id === run.jobId)?.name} — {run.status}</h4>
                  <p className="text-xs text-[#8C8882]">{completed} of {items.length} processed · Started by {run.actorName}</p></div>
                {canStop && <button onClick={() => stopRun(run)} disabled={run.status === "cancelling"}
                  className="flex items-center gap-2 px-4 py-2 text-xs text-red-700 border border-red-200 rounded-sm disabled:opacity-50">
                  <StopCircle className="w-4 h-4" />{run.status === "cancelling" ? "Cancelling…" : "Cancel Run"}
                </button>}
              </div>
              <p className="text-xs font-mono">{items.find(item => item.status === "running")?.sku || "Waiting for the server worker"}</p>
              <progress aria-label="Job progress" value={completed} max={Math.max(1, items.length)} className="w-full h-2" />
            </div>;
          })}

          <div className="flex items-center justify-between border-b border-[#E5E2DE] pb-4">
            <div className="flex items-center gap-4">
              <h3 className="font-serif text-xl text-[#1A1A1A]">
                Created Jobs ({jobs.length})
              </h3>
              {jobs.length > 0 && (
                <button
                  onClick={() => {
                    if (selectedJobs.size === jobs.length) setSelectedJobs(new Set());
                    else setSelectedJobs(new Set(jobs.map(j => j.id)));
                  }}
                  className="text-[10px] uppercase text-[#8C8882] hover:text-[#1A1A1A] font-bold tracking-wider"
                >
                  {selectedJobs.size === jobs.length ? "Deselect All" : "Select All"}
                </button>
              )}
            </div>
            {selectedJobs.size > 0 && (
              <div className="flex items-center gap-2">
                <button
                  onClick={exportSelectedJobs}
                  className="flex items-center gap-2 px-4 py-2 text-[11px] uppercase tracking-widest border border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 transition-colors rounded-sm"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5" />
                  Export Selected ({selectedJobs.size})
                </button>
                <button
                  onClick={runSelectedJobs}
                  disabled={submitting}
                  className="flex items-center gap-2 px-4 py-2 text-[11px] uppercase tracking-widest border border-[#1A1A1A] bg-[#1A1A1A] text-white hover:bg-black transition-colors rounded-sm disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Play className="w-3.5 h-3.5" />
                  Run Selected ({selectedJobs.size})
                </button>
              </div>
            )}
          </div>

          <div className="space-y-4">
            {jobs.length === 0 && (
              <div className="p-8 border border-dashed border-[#E5E2DE] rounded-sm text-center text-[#8C8882] text-sm">
                No jobs created. Go to the Dashboard to select SKUs and create a job.
              </div>
            )}
            {jobs.map((job) => {
              const jobSkus = getJobSkusList(job);
              const completedCount = jobSkus.filter(hasCompletedQa).length;
              const unresolvedCount = jobSkus.length - completedCount;

              return (
                <div key={job.id} className="bg-white border border-[#E5E2DE] rounded-sm p-5 flex items-center shadow-sm hover:border-[#1A1A1A]/30 transition-all gap-4">
                  <div className="flex-shrink-0 cursor-pointer" onClick={() => {
                    const newSet = new Set(selectedJobs);
                    if (newSet.has(job.id)) newSet.delete(job.id);
                    else newSet.add(job.id);
                    setSelectedJobs(newSet);
                  }}>
                    <input 
                      aria-label={`Select job ${job.name}`}
                      type="checkbox" 
                      checked={selectedJobs.has(job.id)}
                      readOnly
                      className="w-4 h-4 rounded-sm border-[#E5E2DE] text-[#1A1A1A] focus:ring-[#1A1A1A]"
                    />
                  </div>
                  
                  <div className="flex-1 flex flex-col gap-1">
                    <div className="flex items-center gap-3">
                      <h4 className="font-serif text-lg text-[#1A1A1A]">{job.name}</h4>
                      <span className={cn(
                          "px-2 py-0.5 text-[10px] uppercase tracking-widest rounded-sm inline-flex items-center gap-1 font-semibold",
                          job.status === 'pending' && "bg-gray-100 text-gray-800",
                          job.status === 'completed' && "bg-emerald-50 text-emerald-800 border border-emerald-200",
                          job.status === 'failed' && "bg-red-50 text-red-800 border border-red-200",
                          job.status === 'running' && "bg-amber-50 text-amber-800 border border-amber-200"
                        )}>
                          {job.status === 'running' && <span className="w-1.5 h-1.5 rounded-full bg-amber-600 animate-pulse"></span>}
                          {job.status === 'completed' && <CheckCircle className="w-3 h-3 text-emerald-600" />}
                          {job.status}
                      </span>
                    </div>
                    <div className="flex items-center gap-4 text-[11px] font-mono text-[#8C8882] mt-1">
                      <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {new Date(job.createdAt).toLocaleString()}</span>
                      <span>SKUs: {job.skus.length}</span>
                      {completedCount > 0 && (
                        <span className="text-emerald-700 font-semibold">{completedCount}/{job.skus.length} Processed</span>
                      )}
                      {job.tokensUsed && (
                        <span className="text-purple-700 font-semibold">Tokens: {job.tokensUsed.total_tokens.toLocaleString()}</span>
                      )}
                      {job.timeTaken && (
                        <span className="text-[#1A1A1A] font-semibold">Time: {(job.timeTaken / 1000).toFixed(1)}s</span>
                      )}
                    </div>
                    {job.error && (
                      <div className="text-[11px] text-red-600 bg-red-50 p-1.5 px-2 rounded-sm border border-red-100 font-medium flex items-start gap-1.5 mt-1 max-w-full">
                        <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                        <span className="break-all">{job.error}</span>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => { setSelectedJobToView(job); setSelectedRunId(histories[job.id]?.[0]?.id || ""); }}
                      className="flex items-center gap-1.5 px-3 py-2 text-[11px] uppercase font-bold text-[#1A1A1A] bg-[#F5F2EF] hover:bg-[#E5E2DE] transition-colors rounded-sm"
                      title="View job details"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      View Results
                    </button>

                    {completedCount > 0 && (
                      <>
                        <button
                          onClick={() => exportJobExcel(job)}
                          className="flex items-center gap-1.5 px-3 py-2 text-[11px] uppercase tracking-widest font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 transition-colors rounded-sm shadow-sm"
                          title="Export All Job QA Results to Excel"
                        >
                          <FileSpreadsheet className="w-3.5 h-3.5" />
                          Export All
                        </button>
                        
                        <button
                          onClick={() => exportJobExcel(job, true)}
                          className="flex items-center gap-1.5 px-3 py-2 text-[11px] uppercase tracking-widest font-bold text-orange-800 bg-orange-50 border border-orange-200 hover:bg-orange-100 transition-colors rounded-sm shadow-sm"
                          title="Export Only Failed/Warning SKUs to Excel"
                        >
                          <AlertTriangle className="w-3.5 h-3.5" />
                          Issues Only
                        </button>
                      </>
                    )}

                    {unresolvedCount > 0 && (
                      <button
                        onClick={() => runJob(job.id)}
                        disabled={submitting || activeRuns.some(run => run.jobId === job.id)}
                        className="flex items-center gap-2 px-4 py-2 text-[11px] uppercase tracking-widest border border-[#1A1A1A] bg-[#1A1A1A] text-white hover:bg-black transition-colors rounded-sm disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <Play className="w-3.5 h-3.5" />
                        {job.status === 'pending' && completedCount === 0 ? 'Run Q.A' : 'Resume Q.A'}
                      </button>
                    )}

                    {completedCount > 0 && (
                      <button
                        onClick={() => runJob(job.id, false, undefined, true)}
                        disabled={submitting || activeRuns.some(run => run.jobId === job.id)}
                        className="flex items-center gap-2 px-4 py-2 text-[11px] uppercase tracking-widest border border-[#1A1A1A] text-[#1A1A1A] bg-white hover:bg-[#F5F2EF] transition-colors rounded-sm disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <Play className="w-3.5 h-3.5" />
                        Rerun All
                      </button>
                    )}

                    {user?.role === "admin" && <button
                      onClick={() => deleteJob(job)} disabled={activeRuns.some(run => run.jobId === job.id)}
                      className="p-2 text-[#8C8882] hover:text-red-600 hover:bg-red-50 transition-colors rounded-sm disabled:opacity-50"
                      title="Delete Job" aria-label={`Delete job ${job.name}`}>
                      <Trash2 className="w-4 h-4" />
                    </button>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* JOB RESULTS MODAL */}
      {selectedJobToView && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs z-50 flex items-center justify-center p-6">
          <div className="bg-white rounded-sm shadow-2xl w-full max-w-5xl h-[85vh] flex flex-col overflow-hidden border border-[#E5E2DE]">
            
            {/* Header */}
            <div className="p-6 border-b border-[#E5E2DE] bg-[#F5F2EF] flex items-center justify-between shrink-0">
              <div>
                <div className="flex items-center gap-3">
                  <h3 className="font-serif text-2xl text-[#1A1A1A]">{selectedJobToView.name}</h3>
                  <span className="px-2 py-0.5 text-[10px] uppercase font-bold tracking-widest rounded-sm bg-emerald-100 text-emerald-900">
                    Job Details
                  </span>
                </div>
                <p className="text-[11px] font-mono text-[#8C8882] mt-1 flex gap-3">
                  <span>Created: {new Date(selectedJobToView.createdAt).toLocaleString()}</span>
                  <span>SKUs: {selectedJobToView.skus.length}</span>
                  {selectedJobToView.tokensUsed && (
                    <span className="text-purple-700 font-semibold">
                      Tokens: {selectedJobToView.tokensUsed.total_tokens.toLocaleString()} (P: {selectedJobToView.tokensUsed.prompt_tokens.toLocaleString()}, C: {selectedJobToView.tokensUsed.completion_tokens.toLocaleString()})
                    </span>
                  )}
                  {selectedJobToView.timeTaken && (
                    <span className="text-[#1A1A1A] font-semibold">
                      Time: {(selectedJobToView.timeTaken / 1000).toFixed(1)}s
                    </span>
                  )}
                </p>
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={() => exportJobExcel(selectedJobToView)}
                  className="flex items-center gap-2 px-5 py-2 text-[11px] uppercase tracking-widest font-bold text-white bg-emerald-700 hover:bg-emerald-800 transition-colors rounded-sm shadow-sm"
                >
                  <Download className="w-4 h-4" />
                  Export Excel (.xlsx)
                </button>

                <button
                  onClick={() => setSelectedJobToView(null)}
                  className="p-2 text-[#8C8882] hover:text-[#1A1A1A] transition-colors rounded-sm"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Content Body */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {Boolean(histories[selectedJobToView.id]?.length) && <label className="block text-sm">
                Run history
                <select className="ml-3 border rounded p-2" value={selectedRunId} onChange={event => setSelectedRunId(event.target.value)}>
                  {(histories[selectedJobToView.id] || []).map(run => <option key={run.id} value={run.id}>
                    {new Date(run.createdAt).toLocaleString()} · {run.actorName} · {run.status}
                  </option>)}
                </select>
              </label>}
              {selectedRunId && !viewRun && <p>Loading saved run results…</p>}
              {viewRun?.error && <p role="alert" className="text-red-700">{viewRun.error}</p>}
              <div className="text-xs text-[#8C8882] uppercase tracking-widest font-semibold mb-2">
                QA Results per SKU
              </div>

              {getJobSkusList(selectedJobToView).map((sku) => {
                const qa = sku.qa_result || sku.raw_row?.qa_result;
                const issues = qa?.issues || [];
                const isExpanded = expandedSku === sku.sku;
                const displayStatus = sku.error ? "failed" : qa?.qa_status || sku.status;

                return (
                  <div key={sku.sku} className="border border-[#E5E2DE] rounded-sm overflow-hidden bg-[#FDFCFB]">
                    <div 
                      onClick={() => setExpandedSku(isExpanded ? null : sku.sku)}
                      className="p-4 bg-white flex items-center justify-between cursor-pointer hover:bg-[#F5F2EF]/50 transition-colors"
                    >
                      <div className="flex items-center gap-4">
                        <span className="font-mono font-bold text-sm text-[#1A1A1A]">SKU: {sku.sku}</span>
                        <span className={cn(
                          "px-2 py-0.5 text-[10px] uppercase tracking-widest font-bold rounded-sm",
                          displayStatus === 'pass' && "bg-emerald-100 text-emerald-800",
                          displayStatus === 'warning' && "bg-amber-100 text-amber-800",
                          (displayStatus === 'fail' || displayStatus === 'failed') && "bg-red-100 text-red-800",
                          !qa && !sku.error && "bg-gray-100 text-gray-800"
                        )}>
                          {displayStatus}
                        </span>

                        <span className="text-xs text-[#8C8882]">
                          Issues Found: <strong className="text-[#1A1A1A]">{issues.length}</strong>
                        </span>
                        {sku.tokensUsed && (
                          <span className="text-xs text-purple-700 font-mono font-semibold ml-2 border border-purple-200 bg-purple-50 px-1.5 py-0.5 rounded-sm">
                            Tokens: {sku.tokensUsed.total_tokens.toLocaleString()}
                          </span>
                        )}
                        {sku.timeTaken && (
                          <span className="text-xs text-[#1A1A1A] font-mono font-semibold ml-2 border border-[#E5E2DE] bg-white px-1.5 py-0.5 rounded-sm">
                            Time: {(sku.timeTaken / 1000).toFixed(1)}s
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-3">
                        <button
                          onClick={(event) => {
                            event.stopPropagation();
                            runJob(selectedJobToView.id, false, sku.sku);
                          }}
                          disabled={submitting || activeRuns.some(run => run.jobId === selectedJobToView.id)}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] uppercase tracking-widest font-bold text-[#1A1A1A] bg-[#F5F2EF] hover:bg-[#E5E2DE] transition-colors rounded-sm disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <Play className="w-3 h-3" />
                          Rerun Q.A
                        </button>
                        <span
                          className={cn("text-xs italic max-w-xs truncate", sku.error ? "text-red-700" : "text-[#8C8882]")}
                          title={sku.error || qa?.summary || 'No QA run yet'}
                        >
                          {sku.error ? `Error: ${sku.error}` : qa?.summary || 'No QA run yet'}
                        </span>
                        {isExpanded ? <ChevronUp className="w-4 h-4 text-[#8C8882]" /> : <ChevronDown className="w-4 h-4 text-[#8C8882]" />}
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="p-4 border-t border-[#E5E2DE] bg-[#FDFCFB] space-y-4 text-xs">
                        {sku.error && (
                          <div className="p-3 bg-red-50 rounded-sm border border-red-200 text-red-900 mb-2">
                            <strong className="block text-[10px] uppercase tracking-widest text-red-800 mb-1 flex items-center gap-1">
                              <AlertCircle className="w-3 h-3" /> Job Execution Error
                            </strong>
                            <p className="font-mono text-[11px] break-all">{sku.error}</p>
                          </div>
                        )}
                        {qa?.summary && (
                          <div className="p-3 bg-[#F5F2EF] rounded-sm border border-[#E5E2DE]">
                            <strong className="block text-[10px] uppercase tracking-widest text-[#8C8882] mb-1">QA Summary</strong>
                            <p className="text-[#1A1A1A]">{qa.summary}</p>
                          </div>
                        )}

                        {issues.length === 0 ? (
                          !sku.error && <div className="p-4 text-center text-emerald-700 bg-emerald-50 rounded-sm font-semibold">
                            No issues detected for this SKU!
                          </div>
                        ) : (
                          <div className="space-y-3">
                            <strong className="block text-[10px] uppercase tracking-widest text-[#8C8882]">
                              Outlined Discrepancies ({issues.length})
                            </strong>

                            {issues.map((iss: any, idx: number) => (
                              <div 
                                key={idx} 
                                className={cn(
                                  "p-3 rounded-sm border text-xs space-y-2",
                                  iss.cell_color === 'red' && "bg-red-50/70 border-red-200 text-red-900",
                                  iss.cell_color === 'orange' && "bg-orange-50/70 border-orange-200 text-orange-900",
                                  iss.cell_color === 'yellow' && "bg-yellow-50/70 border-yellow-200 text-yellow-900",
                                  !iss.cell_color && "bg-gray-50 border-gray-200"
                                )}
                              >
                                <div className="flex items-center justify-between font-mono text-[11px] font-bold border-b border-black/10 pb-1">
                                  <span>Field: {iss.field || 'General Attribute'}</span>
                                  <span className="uppercase tracking-widest text-[9px] px-1.5 py-0.5 rounded bg-black/10">
                                    {iss.issue_type || 'issue'} | {iss.severity || 'notice'}
                                  </span>
                                </div>

                                <div>
                                  <span className="font-semibold block mb-0.5">Plain English Explanation:</span>
                                  <p className="leading-relaxed">{iss.explanation}</p>
                                </div>

                                {iss.uploaded_value && (
                                  <div className="grid grid-cols-2 gap-2 bg-white/60 p-2 rounded border border-black/5 font-mono text-[11px]">
                                    <div>
                                      <span className="text-[#8C8882] block text-[9px] uppercase">Uploaded Value:</span>
                                      <span className="break-words">{String(iss.uploaded_value)}</span>
                                    </div>
                                    <div>
                                      <span className="text-[#8C8882] block text-[9px] uppercase">Source Truth:</span>
                                      <span className="break-words">{String(iss.source_truth || 'N/A')}</span>
                                    </div>
                                  </div>
                                )}

                                {String(iss.suggested_fix ?? "").trim() ? (
                                  <div className="bg-emerald-50/80 border border-emerald-200 p-2 rounded text-emerald-900 font-mono text-[11px]">
                                    <span className="font-bold block text-[9px] uppercase tracking-widest text-emerald-800">Suggested Fix:</span>
                                    {String(iss.suggested_fix)}
                                  </div>
                                ) : iss.field && (
                                  <p className="font-semibold">
                                    Needs verification: no verified replacement was supplied. The correction stays blank; see the explanation above.
                                  </p>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
