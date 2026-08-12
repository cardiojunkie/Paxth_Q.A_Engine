import React, { useRef, useState, useEffect } from "react";
import { UploadCloud, FileSpreadsheet, AlertCircle, Download, FileText, X, CheckSquare, Square, ExternalLink, Database, Trash2 } from "lucide-react";
import * as XLSX from "xlsx";
import ExcelJS from "exceljs";
import { saveAs } from "file-saver";
import { useAppContext, Job } from "../context/AppContext";
import { SkuData, QAStatus } from "../hooks/useCatalogData";
import { getCommonAttributeSet } from "../lib/jobRunState";
import { cn } from "../lib/utils";

type FilterType = "all" | "ready" | "cannot_qa" | "completed" | "failed";

export function DashboardModule() {
  const { skuDataList, addParsedData, clearData, updateSku, deleteSku, removeSkus, isLoadingSkuData, jobs, addJobs, addNotification } = useAppContext();
  const [fileName, setFileName] = useState<string | null>(localStorage.getItem('lastFileName') || null);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterType>("all");
  const [selectedSkus, setSelectedSkus] = useState<Set<string>>(new Set());
  const [isScraping, setIsScraping] = useState(false);
  const [scrapeProgress, setScrapeProgress] = useState<{current: number, total: number} | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Modal State
  const [viewedMarkdown, setViewedMarkdown] = useState<{sku: string, markdown: string} | null>(null);
  const [viewedSAP, setViewedSAP] = useState<{sku: string, sap: string} | null>(null);
  const [manualScrapeQueue, setManualScrapeQueue] = useState<string[]>([]);
  const [manualScrapeText, setManualScrapeText] = useState("");
  const [skuToDelete, setSkuToDelete] = useState<string | null>(null);
  const [showDeleteSelectedModal, setShowDeleteSelectedModal] = useState(false);
  const [showClearAllModal, setShowClearAllModal] = useState(false);

  const [dbStatus, setDbStatus] = useState<"checking" | "connected" | "disconnected" | "error">("checking");

  useEffect(() => {
    fetch("/api/db-status")
      .then(res => res.json())
      .then(data => {
        if (data.status === "connected") setDbStatus("connected");
        else setDbStatus("disconnected");
      })
      .catch(() => setDbStatus("error"));
  }, []);

  const [searchTerm, setSearchTerm] = useState("");
  const currentFileName = fileName || skuDataList.find(s => s.source?.fileName)?.source?.fileName || null;

  const filteredList = skuDataList.filter(sku => {
    const matchesFilter = filter === "all" || sku.status === filter;
    const matchesSearch = !searchTerm || 
      sku.sku.toLowerCase().includes(searchTerm.toLowerCase()) || 
      (sku.attribute_set && sku.attribute_set.toLowerCase().includes(searchTerm.toLowerCase()));
    return matchesFilter && matchesSearch;
  });

  const handleSelectAll = () => {
    if (isScraping) return;
    if (selectedSkus.size === filteredList.length && filteredList.length > 0) {
      setSelectedSkus(new Set());
    } else {
      setSelectedSkus(new Set(filteredList.map(s => s.sku)));
    }
  };

  const toggleSelection = (sku: string) => {
    if (isScraping) return;
    const next = new Set(selectedSkus);
    if (next.has(sku)) {
      next.delete(sku);
    } else {
      next.add(sku);
    }
    setSelectedSkus(next);
  };

  const handleScrapeSelected = async () => {
    if (selectedSkus.size === 0) return;
    
    setIsScraping(true);
    const skusToProcess = skuDataList.filter(s => selectedSkus.has(s.sku));
    const failedSkus: string[] = [];
    const scrapeErrors: string[] = [];
    
    setScrapeProgress({ current: 0, total: skusToProcess.length });
    
    let processed = 0;
    for (const skuItem of skusToProcess) {
      if (skuItem.source.url) {
        try {
          const res = await fetch("/api/scrape", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: skuItem.source.url })
          });
          
          const data = await res.json();
          
          if (res.ok) {
            updateSku(skuItem.sku, { scraped_markdown: data.markdown, scrape_status: "success" });
          } else {
            const error = data.error || "Scraping failed";
            updateSku(skuItem.sku, { scrape_status: "failed", error });
            failedSkus.push(skuItem.sku);
            scrapeErrors.push(`${skuItem.sku}: ${error}`);
          }
        } catch (err: any) {
          const error = err.message || "Scraping failed";
          updateSku(skuItem.sku, { scrape_status: "failed", error });
          failedSkus.push(skuItem.sku);
          scrapeErrors.push(`${skuItem.sku}: ${error}`);
        }
      } else {
        updateSku(skuItem.sku, { scrape_status: "skipped_no_url" });
      }
      processed++;
      setScrapeProgress({ current: processed, total: skusToProcess.length });
    }
    
    setIsScraping(false);
    setScrapeProgress(null);
    if (failedSkus.length > 0) {
      setManualScrapeQueue(failedSkus);
      addNotification({
        type: "warning",
        title: "Scraping Complete with Errors",
        message: `${failedSkus.length} URL(s) could not be scraped automatically. ${scrapeErrors[0] || ""}`
      });
    } else {
      addNotification({
        type: "success",
        title: "Scraping Complete",
        message: `Successfully scraped all selected SKUs with valid URLs.`
      });
    }
  };

  const handleCreateJob = () => {
    if (selectedSkus.size === 0) return;
    
    const skusToProcess = skuDataList.filter(s => selectedSkus.has(s.sku));
    const attributeSet = getCommonAttributeSet(skusToProcess);

    if (!attributeSet) {
      const selectedSets = [...new Set(skusToProcess.map((sku) => sku.attribute_set?.trim() ? sku.attribute_set : "(missing)"))];
      addNotification({
        type: "error",
        title: "Cannot Create Job",
        message: `Selected SKUs contain multiple or missing attribute sets (${selectedSets.join(", ")}). Choose SKUs with one non-empty attribute set.`
      });
      return;
    }
    
    const invalidSkus = skusToProcess.filter(s => !s.scraped_markdown && !s.source.sap);
    
    if (invalidSkus.length > 0) {
      const manualQueue = invalidSkus.filter(s => s.source.url).map(s => s.sku);
      if (manualQueue.length > 0) {
        setManualScrapeQueue(manualQueue);
        addNotification({
          type: "warning",
          title: "Manual Scraping Required",
          message: "Some SKUs failed automated scraping. Please manually provide the content."
        });
        return;
      }

      addNotification({
        type: "error",
        title: "Cannot Create Job",
        message: `The following SKUs are missing both scraped data and SAP data: ${invalidSkus.map(s => s.sku).join(", ")}. Please scrape them first or provide SAP data.`
      });
      return;
    }

    const createdAt = new Date().toISOString();
    const job: Job = {
      id: `job_${Date.now()}_${attributeSet.replace(/[^a-zA-Z0-9]/g, '_')}`,
      name: `Job for ${attributeSet}`,
      createdAt,
      attribute_set: attributeSet,
      skus: skusToProcess.map(sku => sku.sku),
      status: "pending"
    };

    addJobs([job]);
    setSelectedSkus(new Set());
    addNotification({
      type: "success",
      title: "Job Created",
      message: `Created one job with ${job.skus.length} SKU(s). View it in the Jobs tab.`
    });
  };

  const exportQAExcel = async () => {
    try {
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('QA Results');

      if (skuDataList.length === 0) return;

      const originalHeaders = new Set<string>();
      skuDataList.forEach(sku => {
        Object.keys(sku.raw_row).forEach(k => {
          if (k !== 'qa_result') originalHeaders.add(k);
        });
      });

      let maxIssues = 0;
      skuDataList.forEach(sku => {
        const qa = sku.raw_row.qa_result;
        if (qa && qa.issues && Array.isArray(qa.issues)) {
          maxIssues = Math.max(maxIssues, qa.issues.length);
        }
      });

      const columns = Array.from(originalHeaders).map(h => ({ header: h, key: h, width: 20 }));
      
      const qaColumns = [
        { header: 'qa_status', key: 'qa_status', width: 15 },
        { header: 'qa_scrape_status', key: 'qa_scrape_status', width: 20 },
      ];

      for (let i = 1; i <= maxIssues; i++) {
        qaColumns.push({ header: `Error ${i}`, key: `error_${i}`, width: 60 });
      }

      sheet.columns = [...columns, ...qaColumns] as any;

      skuDataList.forEach((sku) => {
        const rowData: Record<string, any> = { ...sku.raw_row };
        const qa = sku.raw_row.qa_result;
        
        if (qa) {
          rowData.qa_status = qa.qa_status || sku.status;
          
          if (qa.issues && Array.isArray(qa.issues)) {
            qa.issues.forEach((issue: any, index: number) => {
              rowData[`error_${index + 1}`] = `${issue.field || 'general'} : ${issue.uploaded_value || ''} : ${issue.explanation}`;
            });
          }
        }
        
        rowData.qa_scrape_status = sku.scrape_status;

        const row = sheet.addRow(rowData);
        
        if (qa && qa.issues && Array.isArray(qa.issues)) {
          qa.issues.forEach((issue: any, index: number) => {
            const field = issue.field;
            let color = 'FFFFFFE0'; // yellow
            if (issue.cell_color === 'red') color = 'FFFFCCCC';
            else if (issue.cell_color === 'orange') color = 'FFFFE5B4';
            else if (issue.cell_color === 'yellow') color = 'FFFFFFE0';
            
            const errorColIndex = sheet.columns.findIndex((c: any) => c.key === `error_${index + 1}`);
            if (errorColIndex >= 0) {
               const errorCell = row.getCell(errorColIndex + 1);
               errorCell.fill = {
                 type: 'pattern',
                 pattern: 'solid',
                 fgColor: { argb: color }
               };
               if (issue.suggested_fix) {
                 errorCell.note = `Suggestion: ${issue.suggested_fix}`;
               }
            }

            const originalColIndex = sheet.columns.findIndex((c: any) => c.key === field);
            if (originalColIndex >= 0) {
               const originalCell = row.getCell(originalColIndex + 1);
               originalCell.fill = {
                 type: 'pattern',
                 pattern: 'solid',
                 fgColor: { argb: color }
               };
            }
          });
        }
      });

      sheet.getRow(1).font = { bold: true };
      
      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      saveAs(blob, "Catalog_QA_Results.xlsx");
      
    } catch(e) {
      console.error(e);
      addNotification({
        type: "error",
        title: "Export Failed",
        message: "Error generating Excel file. Check console for details."
      });
    }
  };

  const downloadJSON = () => {
    const dataStr = JSON.stringify(skuDataList, null, 2);
    const blob = new Blob([dataStr], { type: "application/json" });
    saveAs(blob, "Catalog_QA_Results.json");
  };

  const handleFileUpload = (file: File) => {
    setError(null);
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: "array" });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const [headerRow = []] = XLSX.utils.sheet_to_json<any[]>(worksheet, {
          header: 1,
          raw: false,
          defval: "",
          blankrows: false,
        });
        const headerOrder = headerRow.map(String);
        const jsonData = XLSX.utils.sheet_to_json<Record<string, any>>(worksheet);

        if (jsonData.length === 0) {
          setError("The uploaded file is empty.");
          return;
        }

        setFileName(file.name);
        localStorage.setItem('lastFileName', file.name);
        const parsedSkus: SkuData[] = [];
        let missingSkuCount = 0;
        const seenInFile = new Set<string>();

        for (const row of jsonData) {
          const skuRaw = row.sku || row.SKU;
          if (!skuRaw) {
            missingSkuCount++;
            continue;
          }
          const skuStr = String(skuRaw).trim();
          if (!skuStr) continue;
          if (seenInFile.has(skuStr)) continue;
          seenInFile.add(skuStr);

          const upload_attributes: Record<string, any> = {};
          const source: SkuData["source"] = { fileName: file.name, headerOrder };
          let attribute_set: string | undefined = undefined;

          for (const [key, value] of Object.entries(row)) {
            if (key.startsWith("attributes__")) {
              upload_attributes[key.replace("attributes__", "")] = value;
            } else if (key === "source__sap" || key.toLowerCase() === "sap") {
              source.sap = String(value);
            } else if (key === "source__url" || key.toLowerCase() === "url") {
              source.url = String(value);
            } else if (key.toLowerCase() === "attribute_set" || key.toLowerCase() === "attribute set") {
              attribute_set = String(value);
            }
          }

          let status: QAStatus = "pending";
          if (!source.sap && !source.url) {
            status = "cannot_qa";
          } else {
            status = "ready";
          }

          parsedSkus.push({
            sku: skuStr,
            upload_attributes,
            source,
            attribute_set,
            raw_row: row,
            status
          });
        }

        if (parsedSkus.length === 0) {
          setError(`No valid SKUs found. Make sure your file has a 'sku' or 'SKU' column.`);
          return;
        }

        // Check against existing catalog SKUs
        const existingSkuMap = new Map(skuDataList.map(item => [item.sku, item]));
        const duplicateSkus = parsedSkus.filter(item => existingSkuMap.has(item.sku));
        const newSkus = parsedSkus.filter(item => !existingSkuMap.has(item.sku));

        if (duplicateSkus.length > 0) {
          const dupSkusStr = duplicateSkus.length <= 3 
            ? duplicateSkus.map(s => s.sku).join(", ") 
            : `${duplicateSkus.slice(0, 3).map(s => s.sku).join(", ")} and ${duplicateSkus.length - 3} more`;

          if (newSkus.length === 0) {
            addNotification({
              type: "warning",
              title: "SKU Already Indexed",
              message: duplicateSkus.length === 1
                ? `SKU ${duplicateSkus[0].sku} is already indexed in the database. Duplicates were not created.`
                : `${duplicateSkus.length} SKU(s) (${dupSkusStr}) are already indexed in the database. Duplicates were not created.`
            });
            return;
          } else {
            addParsedData(newSkus);
            addNotification({
              type: "warning",
              title: "Duplicate SKUs Skipped",
              message: `${duplicateSkus.length} SKU(s) (${dupSkusStr}) were already indexed and skipped. Indexed ${newSkus.length} new SKU(s).`
            });
            return;
          }
        }

        addParsedData(parsedSkus);
        addNotification({
          type: "info",
          title: "File Uploaded",
          message: `Successfully parsed and indexed ${parsedSkus.length} new SKU(s).`
        });
      } catch (err) {
        console.error("Error parsing Excel:", err);
        setError("Failed to parse the Excel file. Please ensure it's a valid .xlsx or .xls file.");
      }
    };
    reader.onerror = () => {
      setError("Failed to read the file.");
    };
    reader.readAsArrayBuffer(file);
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const onDragLeave = () => {
    setIsDragging(false);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileUpload(e.dataTransfer.files[0]);
    }
  };

  

  const exportToExcel = async () => {
    if (skuDataList.length === 0) return;
    
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('QA Results');
    
    const headers = [
      'SKU', 'Status', 'QA Status', 'Confidence', 'Summary', 'Issue Count', 'Missing Attributes Count', 'Mapping Errors Count', 'Attribute Set'
    ];
    worksheet.addRow(headers);
    
    skuDataList.forEach(sku => {
      const qaResult = sku.raw_row?.qa_result || {};
      const stats = qaResult.issue_count || 0;
      
      worksheet.addRow([
        sku.sku,
        sku.status,
        qaResult.qa_status || '',
        qaResult.confidence || '',
        qaResult.summary || '',
        stats,
        qaResult.issues?.filter((i:any) => i.issue_type === 'missing').length || 0,
        qaResult.issues?.filter((i:any) => i.issue_type === 'mapping').length || 0,
        sku.attribute_set || ''
      ]);
    });
    
    const buffer = await workbook.xlsx.writeBuffer();
    saveAs(new Blob([buffer]), 'catalog-qa-results.xlsx');
  };

  const stats = {
    total: skuDataList.length,
    ready: skuDataList.filter(s => s.status === 'ready').length,
    missingSource: skuDataList.filter(s => s.status === 'cannot_qa').length,
    completed: skuDataList.filter(s => s.status === 'completed').length,
    failed: skuDataList.filter(s => s.status === 'failed').length,
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[#FDFCFB] overflow-hidden">
      {/* Top Header */}
      <header className="px-8 py-5 border-b border-[#E5E2DE] shrink-0 flex items-center justify-between bg-white">
        <div className="flex items-center gap-5">
          <h2 className="font-serif text-2xl tracking-tighter text-[#1A1A1A]">Indexed SKUs Dashboard</h2>

          <div className="flex items-center gap-3">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-2 px-3 py-1.5 bg-[#1A1A1A] text-white text-xs font-bold uppercase tracking-wider rounded-sm hover:bg-[#333333] transition-colors shadow-sm"
            >
              <UploadCloud className="w-4 h-4" />
              Upload New File
            </button>
            <input
              type="file"
              ref={fileInputRef}
              onChange={(e) => {
                if (e.target.files && e.target.files.length > 0) {
                  handleFileUpload(e.target.files[0]);
                }
                e.target.value = '';
              }}
              accept=".xlsx,.xls,.csv"
              className="hidden"
            />

            {currentFileName && (
              <div className="flex items-center gap-2 text-xs text-[#8C8882] bg-[#F5F2EF] px-3 py-1.5 rounded-sm border border-[#E5E2DE]">
                <FileSpreadsheet className="w-3.5 h-3.5 text-[#1A1A1A]" />
                <span>File:</span>
                <span className="font-mono text-[#1A1A1A] font-semibold">{currentFileName}</span>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3">
          {skuDataList.length > 0 && (
            <button
              onClick={() => setShowClearAllModal(true)}
              className="text-xs text-rose-600 hover:text-rose-700 px-3 py-1.5 rounded border border-rose-200 hover:bg-rose-50 transition-colors font-medium flex items-center gap-1.5"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Clear All Data
            </button>
          )}
        </div>
      </header>

      {/* Main Dashboard Workspace */}
      <div className="flex-1 overflow-y-auto p-8">
        <div className="max-w-7xl mx-auto space-y-6">
          
          {/* Stats Cards */}
          <div className="grid grid-cols-5 gap-4">
            {[
              { label: "Total Indexed SKUs", value: stats.total, color: "text-[#1A1A1A]" },
              { label: "Ready for QA", value: stats.ready, color: "text-emerald-600" },
              { label: "Missing Source", value: stats.missingSource, color: "text-amber-600" },
              { label: "Completed", value: stats.completed, color: "text-blue-600" },
              { label: "Failed", value: stats.failed, color: "text-rose-600" },
            ].map(stat => (
              <div key={stat.label} className="bg-white border border-[#E5E2DE] p-4 rounded-sm flex flex-col shadow-xs">
                <span className="text-[10px] uppercase tracking-widest text-[#8C8882] mb-1 font-semibold">{stat.label}</span>
                <span className={cn("font-serif text-3xl font-medium", stat.color)}>{stat.value}</span>
              </div>
            ))}
          </div>

          {/* Controls & Action Toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-4 bg-white border border-[#E5E2DE] p-4 rounded-sm shadow-xs">
            <div className="flex items-center gap-4 flex-1">
              {/* Filter Tabs */}
              <div className="flex gap-1 bg-[#F5F2EF] p-1 rounded-sm border border-[#E5E2DE]">
                {(["all", "ready", "cannot_qa", "completed", "failed"] as FilterType[]).map(f => (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    className={cn(
                      "px-3 py-1.5 text-[10px] uppercase font-bold tracking-widest rounded-xs transition-colors",
                      filter === f 
                        ? "bg-[#1A1A1A] text-white shadow-xs" 
                        : "text-[#8C8882] hover:text-[#1A1A1A]"
                    )}
                  >
                    {f.replace("_", " ")}
                  </button>
                ))}
              </div>

              {/* Search Box */}
              <div className="relative max-w-xs flex-1">
                <input
                  type="text"
                  placeholder="Search SKU or Attribute Set..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs bg-[#FDFCFB] border border-[#E5E2DE] rounded-sm focus:outline-none focus:border-[#1A1A1A] placeholder-[#8C8882]"
                />
                {searchTerm && (
                  <button 
                    onClick={() => setSearchTerm("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-[#8C8882] hover:text-[#1A1A1A]"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            <div className="flex items-center gap-3">
              {selectedSkus.size > 0 && (
                <button
                  onClick={() => setShowDeleteSelectedModal(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] uppercase font-bold tracking-widest text-white bg-rose-600 hover:bg-rose-700 rounded-sm transition-colors shadow-xs"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Delete Selected ({selectedSkus.size})
                </button>
              )}

              <button
                onClick={handleCreateJob}
                disabled={selectedSkus.size === 0}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 text-[10px] uppercase font-bold tracking-widest rounded-sm transition-colors",
                  selectedSkus.size === 0
                    ? "bg-[#F5F2EF] text-[#B8B4AE] cursor-not-allowed border border-[#E5E2DE]"
                    : "bg-[#1A1A1A] text-white hover:bg-[#333333] shadow-xs"
                )}
              >
                <FileText className="w-3.5 h-3.5" />
                Create QA Job ({selectedSkus.size})
              </button>
              
              <button
                onClick={handleScrapeSelected}
                disabled={selectedSkus.size === 0 || isScraping}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 text-[10px] uppercase font-bold tracking-widest rounded-sm transition-colors",
                  selectedSkus.size === 0 || isScraping
                    ? "bg-[#F5F2EF] text-[#B8B4AE] cursor-not-allowed border border-[#E5E2DE]"
                    : "bg-[#1A1A1A] text-white hover:bg-[#333333] shadow-xs"
                )}
              >
                <Database className="w-3.5 h-3.5" />
                {isScraping ? "Scraping..." : `Scrape URLs (${selectedSkus.size})`}
              </button>
              
              <button
                onClick={exportToExcel}
                disabled={skuDataList.length === 0}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 border border-[#E5E2DE] text-[10px] uppercase font-bold tracking-widest text-[#1A1A1A] rounded-sm transition-colors",
                  skuDataList.length === 0 ? "opacity-50 cursor-not-allowed" : "hover:bg-[#F5F2EF]"
                )}
              >
                <Download className="w-3.5 h-3.5" />
                Export Results
              </button>
            </div>
          </div>

          {/* Progress Bar (Scraping) */}
          {isScraping && scrapeProgress && (
            <div className="bg-white border border-[#E5E2DE] p-5 rounded-sm shadow-xs">
              <div className="flex justify-between text-xs font-semibold text-[#1A1A1A] mb-2">
                <span>Scraping selected URLs...</span>
                <span className="font-mono">{scrapeProgress.current} / {scrapeProgress.total}</span>
              </div>
              <div className="w-full h-2 bg-[#F5F2EF] rounded-full overflow-hidden">
                <div 
                  className="h-full bg-[#1A1A1A] transition-all duration-300"
                  style={{ width: `${(scrapeProgress.current / scrapeProgress.total) * 100}%` }}
                />
              </div>
            </div>
          )}

          {/* SKU Table View */}
          <div 
            className={cn(
              "bg-white border border-[#E5E2DE] rounded-sm overflow-hidden text-sm shadow-xs transition-colors",
              isDragging ? "border-[#1A1A1A] ring-2 ring-[#1A1A1A]/10 bg-[#FDFCFB]" : ""
            )}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
          >
            {isLoadingSkuData ? (
              <div className="p-16 flex flex-col items-center justify-center gap-3 text-[#8C8882]">
                <div className="w-6 h-6 border-2 border-[#1A1A1A] border-t-transparent rounded-full animate-spin" />
                <span className="text-xs font-mono uppercase tracking-wider">Loading Indexed SKUs...</span>
              </div>
            ) : (
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-[#F5F2EF] border-b border-[#E5E2DE] text-[#8C8882] text-[10px] uppercase tracking-widest select-none">
                    <th className="p-3 w-12 text-center cursor-pointer" onClick={handleSelectAll}>
                      {selectedSkus.size === filteredList.length && filteredList.length > 0 ? (
                        <CheckSquare className="w-4 h-4 inline-block text-[#1A1A1A]" />
                      ) : (
                        <Square className="w-4 h-4 inline-block" />
                      )}
                    </th>
                    <th className="p-3 font-normal">SKU Code</th>
                    <th className="p-3 font-normal">Name</th>
                    <th className="p-3 font-normal">Attribute Set</th>
                    <th className="p-3 font-normal">SAP Available</th>
                    <th className="p-3 font-normal">URL Available</th>
                    <th className="p-3 font-normal">Scraped Data</th>
                    <th className="p-3 font-normal text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredList.map((sku, idx) => (
                    <tr 
                      key={`${sku.sku}-${idx}`}
                      className="border-b border-[#E5E2DE] last:border-0 hover:bg-[#FDFCFB] transition-colors"
                    >
                      <td className="p-3 text-center cursor-pointer" onClick={() => toggleSelection(sku.sku)}>
                        {selectedSkus.has(sku.sku) ? (
                          <CheckSquare className="w-4 h-4 inline-block text-[#1A1A1A]" />
                        ) : (
                          <Square className="w-4 h-4 inline-block text-[#8C8882]" />
                        )}
                      </td>
                      <td className="p-3 font-mono text-[#1A1A1A] font-medium">{sku.sku}</td>
                      <td className="p-3 text-[#1A1A1A]">{sku.raw_row?.name ?? sku.raw_row?.Name ?? <span className="text-[#B8B4AE]">—</span>}</td>
                      <td className="p-3 text-[#1A1A1A]">{sku.attribute_set || <span className="text-[#8C8882] italic">Unassigned</span>}</td>
                      <td className="p-3">
                        {sku.source.sap ? (
                           <button 
                             onClick={() => setViewedSAP({sku: sku.sku, sap: sku.source.sap!})}
                             className="text-blue-600 hover:underline flex items-center gap-1 text-xs"
                           >
                             <FileText className="w-3 h-3" /> View SAP
                           </button>
                        ) : <span className="text-[#B8B4AE]">—</span>}
                      </td>
                      <td className="p-3">
                        {sku.source.url ? (
                          <a href={sku.source.url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline flex items-center gap-1 text-xs">
                            <ExternalLink className="w-3 h-3" /> Link
                          </a>
                        ) : <span className="text-[#B8B4AE]">—</span>}
                      </td>
                      <td className="p-3">
                        {sku.scrape_status === 'success' ? (
                          <button 
                            onClick={() => setViewedMarkdown({ sku: sku.sku, markdown: sku.scraped_markdown || '' })}
                            className="text-emerald-600 hover:underline flex items-center gap-1 text-xs"
                          >
                            <FileText className="w-3 h-3" /> View Data
                          </button>
                        ) : sku.scrape_status === 'failed' ? (
                          <span className="text-rose-500 text-xs">Failed</span>
                        ) : sku.source.url ? (
                          <span className="text-[#8C8882] text-xs">Pending</span>
                        ) : <span className="text-[#B8B4AE]">—</span>}
                      </td>
                      <td className="p-3 text-right">
                         <button 
                           onClick={() => setSkuToDelete(sku.sku)}
                           className="text-[#B8B4AE] hover:text-rose-600 transition-colors p-1"
                           title="Delete SKU"
                         >
                           <Trash2 className="w-4 h-4 inline-block" />
                         </button>
                      </td>
                    </tr>
                  ))}
                  
                  {filteredList.length === 0 && (
                    <tr>
                      <td colSpan={8} className="p-12 text-center">
                        {skuDataList.length === 0 ? (
                          <div className="flex flex-col items-center justify-center gap-3 max-w-md mx-auto py-4">
                            <div className="w-12 h-12 bg-[#F5F2EF] rounded-full flex items-center justify-center text-[#1A1A1A]">
                              <UploadCloud className="w-6 h-6" />
                            </div>
                            <h3 className="font-serif text-xl text-[#1A1A1A]">No Indexed SKUs Found</h3>
                            <p className="text-xs text-[#8C8882] leading-relaxed">
                              Upload an Excel (.xlsx, .csv) file containing catalog SKU data to index them for quality assurance.
                            </p>
                            <button
                              onClick={() => fileInputRef.current?.click()}
                              className="mt-2 px-4 py-2 bg-[#1A1A1A] text-white text-xs font-bold uppercase tracking-widest rounded-sm hover:bg-[#333333] transition-colors"
                            >
                              Upload Excel File
                            </button>
                          </div>
                        ) : (
                          <span className="text-xs text-[#8C8882]">No SKUs matching search or active filter.</span>
                        )}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {skuToDelete && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white w-full max-w-sm rounded-sm shadow-xl p-6 relative">
            <h3 className="font-serif text-2xl text-[#1A1A1A] mb-2">Delete SKU</h3>
            <p className="text-[#8C8882] text-sm mb-6">Are you sure you want to delete SKU <span className="font-mono text-[#1A1A1A] font-semibold">{skuToDelete}</span>? This action cannot be undone.</p>
            <div className="flex justify-end gap-3">
              <button 
                onClick={() => setSkuToDelete(null)}
                className="px-4 py-2 text-xs font-bold uppercase tracking-wider text-[#8C8882] hover:text-[#1A1A1A] transition-colors"
              >
                Cancel
              </button>
              <button 
                onClick={() => {
                  if (removeSkus) removeSkus([skuToDelete]);
                  else deleteSku(skuToDelete);
                  setSkuToDelete(null);
                  addNotification({ type: "success", title: "SKU Deleted", message: `SKU ${skuToDelete} has been removed.` });
                }}
                className="px-4 py-2 bg-rose-600 text-white text-xs font-bold uppercase tracking-wider rounded-sm hover:bg-rose-700 transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Selected Confirmation Modal */}
      {showDeleteSelectedModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white w-full max-w-sm rounded-sm shadow-xl p-6 relative">
            <h3 className="font-serif text-2xl text-[#1A1A1A] mb-2">Delete Selected SKUs</h3>
            <p className="text-[#8C8882] text-sm mb-6">
              Are you sure you want to delete <span className="font-semibold text-[#1A1A1A] font-mono">{selectedSkus.size}</span> selected SKU(s) from the database? This action cannot be undone.
            </p>
            <div className="flex justify-end gap-3">
              <button 
                onClick={() => setShowDeleteSelectedModal(false)}
                className="px-4 py-2 text-xs font-bold uppercase tracking-wider text-[#8C8882] hover:text-[#1A1A1A] transition-colors"
              >
                Cancel
              </button>
              <button 
                onClick={() => {
                  const skusToDelete = Array.from(selectedSkus);
                  const count = skusToDelete.length;
                  removeSkus(skusToDelete);
                  setSelectedSkus(new Set());
                  setShowDeleteSelectedModal(false);
                  addNotification({
                    type: "success",
                    title: "SKUs Deleted",
                    message: `${count} SKU(s) removed from the database.`
                  });
                }}
                className="px-4 py-2 bg-rose-600 text-white text-xs font-bold uppercase tracking-wider rounded-sm hover:bg-rose-700 transition-colors"
              >
                Delete ({selectedSkus.size})
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Clear All Confirmation Modal */}
      {showClearAllModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white w-full max-w-sm rounded-sm shadow-xl p-6 relative">
            <h3 className="font-serif text-2xl text-[#1A1A1A] mb-2">Clear All Data</h3>
            <p className="text-[#8C8882] text-sm mb-6">
              Are you sure you want to delete ALL <span className="font-semibold text-[#1A1A1A] font-mono">{skuDataList.length}</span> indexed SKUs from the database? This action cannot be undone.
            </p>
            <div className="flex justify-end gap-3">
              <button 
                onClick={() => setShowClearAllModal(false)}
                className="px-4 py-2 text-xs font-bold uppercase tracking-wider text-[#8C8882] hover:text-[#1A1A1A] transition-colors"
              >
                Cancel
              </button>
              <button 
                onClick={() => {
                  clearData();
                  setSelectedSkus(new Set());
                  setFileName(null);
                  localStorage.removeItem('lastFileName');
                  setShowClearAllModal(false);
                  addNotification({
                    type: "info",
                    title: "Database Cleared",
                    message: "All indexed SKUs have been removed from the database."
                  });
                }}
                className="px-4 py-2 bg-rose-600 text-white text-xs font-bold uppercase tracking-wider rounded-sm hover:bg-rose-700 transition-colors"
              >
                Clear All Data
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modals for Markdown and SAP */}
      {viewedMarkdown && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white w-full max-w-4xl h-[80vh] flex flex-col rounded-sm shadow-xl relative overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b border-[#E5E2DE] bg-[#FDFCFB]">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-[#1A1A1A]" />
                <h3 className="font-bold text-[#1A1A1A] text-sm">Scraped Markdown Data: <span className="font-mono text-blue-600">{viewedMarkdown.sku}</span></h3>
              </div>
              <button onClick={() => setViewedMarkdown(null)} className="text-[#8C8882] hover:text-[#1A1A1A]">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 p-6 overflow-hidden flex flex-col bg-gray-50 gap-3">
              <label className="text-xs text-[#8C8882] font-medium">Edit or view scraped markdown content:</label>
              <textarea 
                value={viewedMarkdown.markdown}
                onChange={(e) => setViewedMarkdown({ ...viewedMarkdown, markdown: e.target.value })}
                className="flex-1 w-full font-mono text-xs text-gray-800 bg-white p-4 border border-gray-200 rounded resize-none focus:outline-none focus:border-[#1A1A1A]"
                placeholder="Paste or edit scraped markdown here..."
              />
            </div>
            <div className="p-4 border-t border-[#E5E2DE] bg-[#FDFCFB] flex justify-between items-center">
              <span className="text-xs text-[#8C8882] font-mono">{viewedMarkdown.markdown.length} characters</span>
              <div className="flex gap-2">
                <button
                  onClick={() => setViewedMarkdown(null)}
                  className="px-4 py-2 border border-[#E5E2DE] text-xs font-bold uppercase tracking-wider text-[#8C8882] hover:text-[#1A1A1A] rounded-sm transition-colors"
                >
                  Close
                </button>
                <button
                  onClick={() => {
                    updateSku(viewedMarkdown.sku, { 
                      scraped_markdown: viewedMarkdown.markdown, 
                      scrape_status: viewedMarkdown.markdown.trim() ? "success" : "failed" 
                    });
                    addNotification({
                      type: "success",
                      title: "Markdown Saved",
                      message: `Scraped markdown for ${viewedMarkdown.sku} saved to database.`
                    });
                    setViewedMarkdown(null);
                  }}
                  className="px-4 py-2 bg-[#1A1A1A] text-white text-xs font-bold uppercase tracking-wider rounded-sm hover:bg-[#333333] transition-colors"
                >
                  Save Markdown
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Manual Scrape Queue Modal */}
      {manualScrapeQueue.length > 0 && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white w-full max-w-2xl flex flex-col rounded-sm shadow-xl relative overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b border-[#E5E2DE] bg-[#FDFCFB]">
              <div>
                <h3 className="font-bold text-[#1A1A1A] text-sm">Manual Content Input Required</h3>
                <p className="text-xs text-[#8C8882]">Processing {manualScrapeQueue.length} SKU(s) missing scraped content</p>
              </div>
              <button onClick={() => setManualScrapeQueue([])} className="text-[#8C8882] hover:text-[#1A1A1A]">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <span className="text-xs text-[#8C8882] uppercase tracking-wider font-semibold">Current SKU:</span>
                <span className="ml-2 font-mono font-bold text-sm text-[#1A1A1A]">{manualScrapeQueue[0]}</span>
              </div>
              <div>
                <label className="block text-xs font-medium text-[#1A1A1A] mb-1">Paste Markdown / Web Page Content:</label>
                <textarea
                  id="manualScrapeTextarea"
                  rows={8}
                  placeholder="Paste product details or markdown content here..."
                  className="w-full p-3 font-mono text-xs border border-[#E5E2DE] rounded-sm focus:outline-none focus:border-[#1A1A1A]"
                />
              </div>
            </div>
            <div className="p-4 border-t border-[#E5E2DE] bg-[#FDFCFB] flex justify-between items-center">
              <button
                onClick={() => setManualScrapeQueue(prev => prev.slice(1))}
                className="px-4 py-2 text-xs font-bold uppercase tracking-wider text-[#8C8882] hover:text-[#1A1A1A] transition-colors"
              >
                Skip This SKU
              </button>
              <button
                onClick={() => {
                  const textarea = document.getElementById("manualScrapeTextarea") as HTMLTextAreaElement;
                  const text = textarea?.value || "";
                  if (text.trim()) {
                    updateSku(manualScrapeQueue[0], { scraped_markdown: text, scrape_status: "success" });
                    addNotification({
                      type: "success",
                      title: "Content Saved",
                      message: `Saved content for ${manualScrapeQueue[0]}`
                    });
                  }
                  setManualScrapeQueue(prev => prev.slice(1));
                }}
                className="px-4 py-2 bg-[#1A1A1A] text-white text-xs font-bold uppercase tracking-wider rounded-sm hover:bg-[#333333] transition-colors"
              >
                Save & Continue ({manualScrapeQueue.length - 1} left)
              </button>
            </div>
          </div>
        </div>
      )}

      {viewedSAP && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white w-full max-w-4xl h-[80vh] flex flex-col rounded-sm shadow-xl relative overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b border-[#E5E2DE] bg-[#FDFCFB]">
              <h3 className="font-bold text-[#1A1A1A] text-sm">SAP Source Content: <span className="font-mono">{viewedSAP.sku}</span></h3>
              <button onClick={() => setViewedSAP(null)} className="text-[#8C8882] hover:text-[#1A1A1A]">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 p-6 overflow-y-auto bg-gray-50">
              <pre className="whitespace-pre-wrap font-mono text-xs text-gray-800 bg-white p-4 border border-gray-200 rounded">
                {viewedSAP.sap}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
