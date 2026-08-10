const fs = require('fs');
let code = fs.readFileSync('src/components/DashboardModule.tsx', 'utf-8');

// Replace return JSX
const returnIndex = code.indexOf('return (');
if (returnIndex !== -1) {
  const beforeReturn = code.substring(0, returnIndex);

  const newReturn = `return (
    <div className="flex-1 flex flex-col h-full bg-[#FDFCFB] overflow-hidden">
      {/* Top Header */}
      <header className="px-8 py-5 border-b border-[#E5E2DE] shrink-0 flex items-center justify-between bg-white">
        <div className="flex items-center gap-5">
          <h2 className="font-serif text-2xl tracking-tighter text-[#1A1A1A]">Indexed SKUs Dashboard</h2>
          
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
              onClick={() => {
                if (window.confirm("Are you sure you want to clear all indexed SKUs from the database?")) {
                  clearData();
                  setFileName(null);
                  localStorage.removeItem('lastFileName');
                }
              }}
              className="text-xs text-rose-600 hover:text-rose-700 px-3 py-1.5 rounded border border-transparent hover:border-rose-200 transition-colors font-medium"
            >
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
                  onClick={() => {
                    if (window.confirm(\`Are you sure you want to delete \${selectedSkus.size} selected SKUs?\`)) {
                      if (removeSkus) {
                        removeSkus(Array.from(selectedSkus));
                        setSelectedSkus(new Set());
                      }
                    }
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] uppercase font-bold tracking-widest text-rose-600 hover:bg-rose-50 border border-rose-200 rounded-sm transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Delete ({selectedSkus.size})
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
                {isScraping ? "Scraping..." : \`Scrape URLs (\${selectedSkus.size})\`}
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
                  style={{ width: \`\${(scrapeProgress.current / scrapeProgress.total) * 100}%\` }}
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
                      <td className="p-3 font-mono text-[#1A1A1A] font-medium">{sku.sku}</td>
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
                      <td className="p-3">
                        <span className={cn(
                          "px-2 py-0.5 text-[10px] uppercase font-bold tracking-wider rounded-xs",
                          sku.status === 'ready' ? "bg-emerald-100 text-emerald-800" :
                          sku.status === 'cannot_qa' ? "bg-amber-100 text-amber-800" :
                          sku.status === 'completed' ? "bg-blue-100 text-blue-800" :
                          sku.status === 'failed' ? "bg-rose-100 text-rose-800" :
                          "bg-[#F5F2EF] text-[#8C8882]"
                        )}>
                          {sku.status.replace("_", " ")}
                        </span>
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
                  addNotification({ type: "success", title: "SKU Deleted", message: \`SKU \${skuToDelete} has been removed.\` });
                }}
                className="px-4 py-2 bg-rose-600 text-white text-xs font-bold uppercase tracking-wider rounded-sm hover:bg-rose-700 transition-colors"
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
              <h3 className="font-bold text-[#1A1A1A] text-sm">Scraped Markdown Data: <span className="font-mono">{viewedMarkdown.sku}</span></h3>
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
}`;

  fs.writeFileSync('src/components/DashboardModule.tsx', beforeReturn + newReturn);
  console.log("Updated DashboardModule UI");
} else {
  console.log("Could not find return statement");
}
