const fs = require('fs');
let content = fs.readFileSync('src/components/DashboardModule.tsx', 'utf-8');

// Replace the hook destructuring to include removeSkus, isLoadingSkuData
content = content.replace(
  "const { skuDataList, addParsedData, clearData, updateSku, deleteSku, jobs, addJobs, addNotification } = useAppContext();",
  "const { skuDataList, addParsedData, clearData, updateSku, deleteSku, removeSkus, isLoadingSkuData, jobs, addJobs, addNotification } = useAppContext();\n  const [fileName, setFileName] = useState<string | null>(localStorage.getItem('lastFileName') || null);"
);

// In handleFileUpload, set the fileName
content = content.replace(
  "const parsedSkus: SkuData[] = [];",
  "setFileName(file.name);\n        localStorage.setItem('lastFileName', file.name);\n        const parsedSkus: SkuData[] = [];"
);

// Add fileName to source
content = content.replace(
  "const source: { sap?: string; url?: string } = {};",
  "const source: { sap?: string; url?: string; fileName?: string } = { fileName: file.name };"
);

// Find the return statement and replace it completely
const returnIndex = content.indexOf("if (skuDataList.length > 0) {");
if (returnIndex !== -1) {
  const beforeReturn = content.substring(0, returnIndex);
  
  const newReturn = `
  const stats = {
    total: skuDataList.length,
    ready: skuDataList.filter(s => s.status === 'ready').length,
    missingSource: skuDataList.filter(s => s.status === 'cannot_qa').length,
    completed: skuDataList.filter(s => s.status === 'completed').length,
    failed: skuDataList.filter(s => s.status === 'failed').length,
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[#FDFCFB] overflow-hidden">
      <header className="px-10 py-6 border-b border-[#E5E2DE] shrink-0 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <h2 className="font-serif text-3xl tracking-tighter text-[#1A1A1A]">Dashboard</h2>
          
          <div 
            className="flex items-center"
            title={dbStatus === "connected" ? "Database Connected" : dbStatus === "checking" ? "Checking connection..." : "Database Disconnected"}
          >
            <div className={cn(
              "w-2.5 h-2.5 rounded-full",
              dbStatus === "connected" ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]" : 
               dbStatus === "checking" ? "bg-amber-500 animate-pulse" :
              "bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.8)]"
            )} />
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-2 px-3 py-1.5 bg-[#1A1A1A] text-white text-xs font-bold uppercase tracking-wider rounded-sm hover:bg-[#333333] transition-colors"
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
            {fileName && (
              <div className="text-xs text-[#8C8882] bg-[#F5F2EF] px-2 py-1 rounded-sm border border-[#E5E2DE]">
                Last uploaded: <span className="font-mono text-[#1A1A1A]">{fileName}</span>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3">
          {skuDataList.length > 0 && (
            <button
              onClick={() => {
                if (window.confirm("Are you sure you want to clear all data?")) {
                  clearData();
                  setFileName(null);
                  localStorage.removeItem('lastFileName');
                }
              }}
              className="text-xs text-rose-600 hover:text-rose-700 px-2 py-1"
            >
              Clear All Data
            </button>
          )}
        </div>
      </header>

      {isLoadingSkuData ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="w-6 h-6 border-2 border-[#1A1A1A] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : skuDataList.length === 0 ? (
        <div 
          className={cn(
            "flex-1 flex flex-col items-center justify-center m-10 border-2 border-dashed rounded-sm transition-colors",
            isDragging ? "border-[#1A1A1A] bg-[#F5F2EF]" : "border-[#E5E2DE] bg-white",
            error ? "border-rose-300 bg-rose-50" : ""
          )}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
        >
          <div className="w-16 h-16 bg-[#F5F2EF] rounded-full flex items-center justify-center mb-6">
            <UploadCloud className="w-8 h-8 text-[#1A1A1A]" />
          </div>
          <h2 className="text-2xl font-serif text-[#1A1A1A] mb-2">Upload Catalog Data</h2>
          <p className="text-[#8C8882] mb-6 max-w-md text-center leading-relaxed">
            Drag and drop your Excel (.xlsx, .csv) file containing SKU data, or click below to browse.
          </p>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="px-6 py-3 bg-[#1A1A1A] text-white text-xs font-bold uppercase tracking-widest hover:bg-[#2A2A2A] transition-colors rounded-sm shadow-sm"
          >
            Select File
          </button>
          {error && (
            <div className="mt-6 flex items-center gap-2 text-rose-600 bg-rose-50 px-4 py-2 rounded-sm text-sm">
              <AlertCircle className="w-4 h-4" />
              <span>{error}</span>
            </div>
          )}
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-10">
          <div className="max-w-6xl mx-auto space-y-8">
            
            {/* Stats Cards */}
            <div className="grid grid-cols-5 gap-4">
              {[
                { label: "Total SKUs", value: stats.total, color: "text-[#1A1A1A]" },
                { label: "Ready for QA", value: stats.ready, color: "text-green-600" },
                { label: "Missing Source", value: stats.missingSource, color: "text-orange-600" },
                { label: "Completed", value: stats.completed, color: "text-blue-600" },
                { label: "Failed", value: stats.failed, color: "text-red-600" },
              ].map(stat => (
                <div key={stat.label} className="bg-white border border-[#E5E2DE] p-4 rounded-sm flex flex-col">
                  <span className="text-[10px] uppercase tracking-widest text-[#8C8882] mb-1">{stat.label}</span>
                  <span className={cn("font-serif text-3xl", stat.color)}>{stat.value}</span>
                </div>
              ))}
            </div>

            {/* Actions Bar */}
            <div className="flex items-center justify-between bg-white border border-[#E5E2DE] p-4 rounded-sm">
              <div className="flex gap-2">
                {(["all", "ready", "cannot_qa", "completed", "failed"] as FilterType[]).map(f => (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    className={cn(
                      "px-4 py-2 text-[10px] uppercase font-bold tracking-widest rounded-sm transition-colors",
                      filter === f 
                        ? "bg-[#1A1A1A] text-white" 
                        : "text-[#8C8882] hover:bg-[#F5F2EF] hover:text-[#1A1A1A]"
                    )}
                  >
                    {f.replace("_", " ")}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-3">
                {selectedSkus.size > 0 && (
                  <button
                    onClick={() => {
                      if (window.confirm(\`Are you sure you want to delete \${selectedSkus.size} selected SKUs?\`)) {
                        if (removeSkus) {
                          removeSkus(Array.from(selectedSkus));
                          setSelectedSkus(new Set());
                        }
                      }
                    }}
                    className="flex items-center gap-2 px-4 py-2 text-[10px] uppercase font-bold tracking-widest text-rose-600 hover:bg-rose-50 rounded-sm transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Delete Selected ({selectedSkus.size})
                  </button>
                )}
                
                <button
                  onClick={handleScrapeSelected}
                  disabled={selectedSkus.size === 0 || isScraping}
                  className={cn(
                    "flex items-center gap-2 px-4 py-2 text-[10px] uppercase font-bold tracking-widest rounded-sm transition-colors",
                    selectedSkus.size === 0 || isScraping
                      ? "bg-[#F5F2EF] text-[#B8B4AE] cursor-not-allowed"
                      : "bg-[#1A1A1A] text-white hover:bg-[#2A2A2A]"
                  )}
                >
                  <Database className="w-3.5 h-3.5" />
                  {isScraping ? "Scraping..." : \`Scrape URLs (\${selectedSkus.size})\`}
                </button>
                
                <button
                  onClick={exportToExcel}
                  className="flex items-center gap-2 px-4 py-2 border border-[#E5E2DE] text-[10px] uppercase font-bold tracking-widest text-[#1A1A1A] hover:bg-[#F5F2EF] rounded-sm transition-colors"
                >
                  <Download className="w-3.5 h-3.5" />
                  Export Extracted
                </button>
              </div>
            </div>

            {/* Progress Bar (Scraping) */}
            {isScraping && scrapeProgress && (
              <div className="bg-white border border-[#E5E2DE] p-6 rounded-sm">
                <div className="flex justify-between text-sm mb-2">
                  <span className="font-bold text-[#1A1A1A]">Scraping URLs...</span>
                  <span className="text-[#8C8882]">{scrapeProgress.current} / {scrapeProgress.total}</span>
                </div>
                <div className="w-full h-2 bg-[#F5F2EF] rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-[#1A1A1A] transition-all duration-300"
                    style={{ width: \`\${(scrapeProgress.current / scrapeProgress.total) * 100}%\` }}
                  ></div>
                </div>
              </div>
            )}

            {/* Table */}
            <div className="bg-white border border-[#E5E2DE] rounded-sm overflow-hidden text-sm">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-[#F5F2EF] border-b border-[#E5E2DE] text-[#8C8882] text-[10px] uppercase tracking-widest">
                    <th className="p-3 w-12 text-center cursor-pointer" onClick={handleSelectAll}>
                      {selectedSkus.size === filteredList.length && filteredList.length > 0 ? (
                        <CheckSquare className="w-4 h-4 inline-block text-[#1A1A1A]" />
                      ) : (
                        <Square className="w-4 h-4 inline-block" />
                      )}
                    </th>
                    <th className="p-3 font-normal">SKU</th>
                    <th className="p-3 font-normal">Attribute Set</th>
                    <th className="p-3 font-normal">SAP Available</th>
                    <th className="p-3 font-normal">URL Available</th>
                    <th className="p-3 font-normal">Scraped Data</th>
                    <th className="p-3 font-normal">Status</th>
                    <th className="p-3 font-normal text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredList.map((sku, idx) => (
                    <tr 
                      key={\`\${sku.sku}-\${idx}\`}
                      className="border-b border-[#E5E2DE] last:border-0 hover:bg-[#FDFCFB] transition-colors"
                    >
                      <td className="p-3 text-center cursor-pointer" onClick={() => toggleSelection(sku.sku)}>
                        {selectedSkus.has(sku.sku) ? (
                          <CheckSquare className="w-4 h-4 inline-block text-[#1A1A1A]" />
                        ) : (
                          <Square className="w-4 h-4 inline-block text-[#8C8882]" />
                        )}
                      </td>
                      <td className="p-3 font-mono text-[#1A1A1A]">{sku.sku}</td>
                      <td className="p-3 text-[#1A1A1A]">{sku.attribute_set || <span className="text-[#8C8882] italic">N/A</span>}</td>
                      <td className="p-3">
                        {sku.source.sap ? (
                           <button 
                             onClick={() => setViewedSAP({sku: sku.sku, sap: sku.source.sap!})}
                             className="text-blue-600 hover:underline flex items-center gap-1"
                           >
                             <FileText className="w-3 h-3" /> View SAP
                           </button>
                        ) : <span className="text-[#B8B4AE]">—</span>}
                      </td>
                      <td className="p-3">
                        {sku.source.url ? (
                          <a href={sku.source.url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline flex items-center gap-1">
                            <ExternalLink className="w-3 h-3" /> Link
                          </a>
                        ) : <span className="text-[#B8B4AE]">—</span>}
                      </td>
                      <td className="p-3">
                        {sku.scrape_status === 'success' ? (
                          <button 
                            onClick={() => setViewedMarkdown({ sku: sku.sku, markdown: sku.scraped_markdown || '' })}
                            className="text-emerald-600 hover:underline flex items-center gap-1"
                          >
                            <FileText className="w-3 h-3" /> View Data
                          </button>
                        ) : sku.scrape_status === 'failed' ? (
                          <span className="text-rose-500">Failed</span>
                        ) : sku.source.url ? (
                          <span className="text-[#8C8882]">Pending Scrape</span>
                        ) : <span className="text-[#B8B4AE]">—</span>}
                      </td>
                      <td className="p-3">
                        <span className={cn(
                          "px-2 py-1 text-[10px] uppercase font-bold tracking-wider rounded-sm",
                          sku.status === 'ready' ? "bg-green-100 text-green-700" :
                          sku.status === 'cannot_qa' ? "bg-orange-100 text-orange-700" :
                          sku.status === 'completed' ? "bg-blue-100 text-blue-700" :
                          sku.status === 'failed' ? "bg-red-100 text-red-700" :
                          "bg-[#F5F2EF] text-[#8C8882]"
                        )}>
                          {sku.status.replace("_", " ")}
                        </span>
                      </td>
                      <td className="p-3 text-right">
                         <button 
                           onClick={() => setSkuToDelete(sku.sku)}
                           className="text-[#B8B4AE] hover:text-rose-600 transition-colors"
                           title="Delete SKU"
                         >
                           <Trash2 className="w-4 h-4 inline-block" />
                         </button>
                      </td>
                    </tr>
                  ))}
                  {filteredList.length === 0 && (
                    <tr>
                      <td colSpan={8} className="p-10 text-center text-[#8C8882]">
                        No SKUs found for this filter.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {skuToDelete && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white w-full max-w-sm rounded-sm shadow-xl p-6 relative">
            <h3 className="font-serif text-2xl text-[#1A1A1A] mb-2">Delete SKU</h3>
            <p className="text-[#8C8882] mb-6">Are you sure you want to delete SKU <span className="font-mono text-[#1A1A1A]">{skuToDelete}</span>? This action cannot be undone.</p>
            <div className="flex justify-end gap-3">
              <button 
                onClick={() => setSkuToDelete(null)}
                className="px-4 py-2 text-sm text-[#8C8882] hover:text-[#1A1A1A] transition-colors"
              >
                Cancel
              </button>
              <button 
                onClick={() => {
                  if (removeSkus) removeSkus([skuToDelete]);
                  else deleteSku(skuToDelete);
                  setSkuToDelete(null);
                  addNotification({ type: "success", title: "SKU Deleted", message: \`SKU \${skuToDelete} has been removed.\` });
                }}
                className="px-4 py-2 bg-rose-600 text-white text-sm font-bold rounded-sm hover:bg-rose-700 transition-colors"
              >
                Delete
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
              <h3 className="font-bold text-[#1A1A1A]">Scraped Data: {viewedMarkdown.sku}</h3>
              <button onClick={() => setViewedMarkdown(null)} className="text-[#8C8882] hover:text-[#1A1A1A]">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 p-6 overflow-y-auto bg-gray-50">
              <pre className="whitespace-pre-wrap font-mono text-xs text-gray-800 bg-white p-4 border border-gray-200 rounded">
                {viewedMarkdown.markdown}
              </pre>
            </div>
          </div>
        </div>
      )}

      {viewedSAP && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white w-full max-w-4xl h-[80vh] flex flex-col rounded-sm shadow-xl relative overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b border-[#E5E2DE] bg-[#FDFCFB]">
              <h3 className="font-bold text-[#1A1A1A]">SAP Source Text: {viewedSAP.sku}</h3>
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
}`;

  content = beforeReturn + newReturn;
  fs.writeFileSync('src/components/DashboardModule.tsx', content);
  console.log("Rewrote DashboardModule.tsx");
} else {
  console.log("Could not find return statement in DashboardModule");
}
