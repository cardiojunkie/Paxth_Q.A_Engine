import React, { useState, useRef } from "react";
import { Play, StopCircle, CheckCircle, AlertCircle, Clock, Download, Eye, Trash2, X, AlertTriangle, FileSpreadsheet, ChevronDown, ChevronUp } from "lucide-react";
import { useAppContext, Job } from "../context/AppContext";
import { normalizeMaxTokens, useSettings } from "../hooks/useSettings";
import { useAttributeSets } from "../hooks/useAttributeSets";
import {
  getCommonAttributeSet,
  getCommonHeaderOrder,
  getCompletedJobSkuIds,
  getExportColumns,
  getJobRunStatus,
  hasCompletedQa,
  selectJobSkus,
} from "../lib/jobRunState";
import { extractLLMResponseContent, parseLLMJsonResponse } from "../lib/llmResponse";
import { cn } from "../lib/utils";
import ExcelJS from "exceljs";
import { saveAs } from "file-saver";

const QA_SYSTEM_PROMPT = `You are an ecommerce catalogue quality analyst.

Your job is to compare the uploaded ecommerce catalogue attributes against the provided source truth.

Priority of source truth:
1. SAP source data is the highest authority.
2. Scraped product page markdown is secondary.
3. If SAP and scraped markdown conflict, trust SAP.

Do not hallucinate. Do not invent missing product facts. Do not assume facts from generic product knowledge. Only use the provided source data.

Check for:
- factual mismatches
- incorrect title
- incorrect brand
- incorrect model
- incorrect color
- incorrect size/capacity
- incorrect material
- incorrect dimensions/weight
- wrong or unsupported bullet points
- wrong or unsupported description
- spelling errors
- grammar errors
- over-promising claims
- unsupported marketing claims
- missing important information
- contradictions in the uploaded data
- poor customer-facing catalogue wording`;

const QA_JSON_SCHEMA = `CRITICAL INSTRUCTION: You MUST return your response as a single, valid JSON object. Do NOT wrap the JSON in Markdown code blocks (e.g., \`\`\`json). Do NOT add any conversational text, preamble, reasoning, or explanation before or after the JSON.

Required JSON Schema:
{
  "qa_status": "pass" | "warning" | "fail",
  "confidence": "high" | "medium" | "low",
  "summary": "Short summary of findings",
  "issue_count": number,
  "issues": [
    {
      "field": "attribute_name (e.g., attributes__brand)",
      "issue_type": "data_mismatch" | "missing_data" | "formatting" | "spelling_grammar" | "unsupported_claim",
      "severity": "minor" | "moderate" | "critical",
      "uploaded_value": "value from upload",
      "source_truth": "value from source",
      "explanation": "Clear explanation of the issue",
      "suggested_fix": "Suggested corrected value",
      "cell_color": "yellow" | "orange" | "red"
    }
  ],
  "source_notes": {
    "sap_used": boolean,
    "url_used": boolean,
    "source_conflicts": ["conflict 1", "conflict 2"]
  }
}`;

function parseApiErrorMessage(status: number, rawText: string): string {
  if (!rawText) return status ? `LLM API returned HTTP ${status}` : "Unknown error";
  try {
    const json = JSON.parse(rawText);
    if (json.details) {
      if (typeof json.details === "string") return json.details;
      if (json.details.message) return json.details.message;
      return JSON.stringify(json.details);
    }
    if (json.error) {
      if (typeof json.error === "string") return json.error;
      if (json.error.message) return json.error.message;
      return JSON.stringify(json.error);
    }
    if (json.message) return json.message;
  } catch (e) {
    // Not JSON
  }
  return rawText;
}

export function JobsModule() {
  const { skuDataList, updateSku, jobs, updateJob, removeJob, addNotification } = useAppContext();
  const { settings } = useSettings();
  const { attributeSets } = useAttributeSets();
  
  const [runningJobId, setRunningJobId] = useState<string | null>(null);
  const [stopRequested, setStopRequested] = useState(false);
  const stopRequestedRef = useRef(false);
  const [progress, setProgress] = useState({ current: 0, total: 0, currentSku: "", action: "" });
  
  // State for inspecting job results modal
  const [selectedJobToView, setSelectedJobToView] = useState<Job | null>(null);
  const [expandedSku, setExpandedSku] = useState<string | null>(null);
  const [selectedJobs, setSelectedJobs] = useState<Set<string>>(new Set());

  const runSelectedJobs = async () => {
    if (runningJobId || selectedJobs.size === 0) return;
    
    // Sort selected jobs by their current index to run sequentially
    const jobsToRun = Array.from(selectedJobs);
    
    for (const jobId of jobsToRun) {
      if (stopRequestedRef.current) break;
      if (await runJob(jobId, true)) break;
    }
  };

  const runJob = async (jobId: string, isSequential = false, skuId?: string, rerunAll = false): Promise<boolean> => {
    if (runningJobId && !isSequential) return false;
    
    if (!settings.apiKey || !settings.baseUrl || !settings.modelName) {
      addNotification({
        type: "error",
        title: "Missing API Settings",
        message: "Please configure LLM API settings in the LLM Settings module first."
      });
      return false;
    }

    const job = jobs.find(j => j.id === jobId);
    if (!job) return false;

    setRunningJobId(jobId);
    setStopRequested(false);
    stopRequestedRef.current = false;
    await updateJob(jobId, { status: "running", error: null });
    
    const allSkusInJob = job.skus.map((id) => skuDataList.find((sku) => sku.sku === id)).filter(Boolean) as typeof skuDataList;
    const skusToProcess = selectJobSkus(allSkusInJob, skuId, rerunAll);
    const processedSkuIds = new Set<string>();
    
    if (skusToProcess.length === 0) {
      await updateJob(jobId, { status: "completed", error: null });
      addNotification({
        type: "info",
        title: "Job Already Completed",
        message: "All SKUs in this job are already completed."
      });
      setRunningJobId(null);
      setStopRequested(false);
      stopRequestedRef.current = false;
      return false;
    }
    
    let currentIndex = 0;
    let hasError = false;
    let totalJobTokens = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
    const jobStartTime = Date.now();
    
    const maxConcurrency = settings.maxConcurrency || 1;
    const maxRetries = Math.max(settings.maxRetries || 0, 3);

    const processNext = async (): Promise<void> => {
      while (true) {
        if (stopRequestedRef.current) break;
        
        let indexToProcess: number;
        // lock-like index increment
        indexToProcess = currentIndex++;
        if (indexToProcess >= skusToProcess.length) break;

        const skuItem = skusToProcess[indexToProcess];
        const skuStartTime = Date.now();
        
        setProgress(prev => ({
          current: Math.min(currentIndex, skusToProcess.length),
          total: skusToProcess.length,
          currentSku: skuItem.sku,
          action: "Processing..."
        }));
        
        await updateSku(skuItem.sku, { status: "running", error: null });
        
        let attempts = 0;
        let success = false;
        
        while (attempts <= maxRetries && !success && !stopRequestedRef.current) {
          attempts++;
          try {
            let scrapedMarkdown = skuItem.scraped_markdown;
            
            if (skuItem.source.url && skuItem.scrape_status !== "success" && skuItem.scrape_status !== "failed") {
              try {
                const res = await fetch("/api/scrape", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ url: skuItem.source.url })
                });
                const data = await res.json();
                if (res.ok) {
                  scrapedMarkdown = data.markdown;
                  await updateSku(skuItem.sku, { scraped_markdown: scrapedMarkdown, scrape_status: "success" });
                } else {
                  await updateSku(skuItem.sku, { scrape_status: "failed" });
                }
              } catch (err) {
                await updateSku(skuItem.sku, { scrape_status: "failed" });
              }
            }
            
            if (stopRequestedRef.current) {
               await updateSku(skuItem.sku, { status: "ready" });
               break;
            }

            const { attribute_set, source__sap, source__url, ...cleanAttributes } = skuItem.upload_attributes;
            const matchedSet = attributeSets.find(s => s.name === skuItem.attribute_set);
            const mappingRules = matchedSet?.rulesMarkdown || "No specific mapping rules defined for this SKU's attribute set.";
            const dynamicSystemPrompt = `${QA_SYSTEM_PROMPT}\n\n=== ATTRIBUTE MAPPING RULES ===\nApply the following mapping rules when validating the uploaded attributes against the source truth:\n${mappingRules}\n\n${QA_JSON_SCHEMA}`;

            let maxContentLen = 30000;
            if (attempts === 2) maxContentLen = 10000;
            if (attempts === 3) maxContentLen = 3000;
            if (attempts >= 4) maxContentLen = 0;

            let finalMarkdown = scrapedMarkdown || "";
            if (maxContentLen === 0) {
              finalMarkdown = "[Scraped web content omitted for this attempt to reduce context size]";
            } else if (finalMarkdown.length > maxContentLen) {
              finalMarkdown = finalMarkdown.substring(0, maxContentLen) + "\n...[TRUNCATED DUE TO LENGTH LIMIT]...";
            }

            const userPromptContent = `Product SKU: ${skuItem.sku}
Attribute Set: ${skuItem.attribute_set}

=== UPLOADED ATTRIBUTES ===
${JSON.stringify(cleanAttributes, null, 2)}

=== SOURCE SAP TEXT ===
${skuItem.source.sap || "N/A"}

=== SCRAPED WEB CONTENT ===
${finalMarkdown || "N/A"}`.trim();

            let content = "";
            let lastApiErr = "";
            let tokensUsed = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

            let isRateLimit = false;

            const maxTokensVal = normalizeMaxTokens(settings.maxTokens);

            try {
              const res1 = await fetch(`/api/chat`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  baseUrl: settings.baseUrl,
                  apiKey: settings.apiKey,
                  payload: {
                    model: settings.modelName,
                    temperature: Number(settings.temperature) || 0.1,
                    max_tokens: maxTokensVal,
                    response_format: { type: "json_object" },
                    messages: [
                      { role: "system", content: dynamicSystemPrompt },
                      { role: "user", content: userPromptContent }
                    ]
                  }
                })
              });

              if (res1.ok) {
                const data1 = await res1.json();
                if (data1.usage) {
                  tokensUsed = { ...data1.usage };
                }
                content = extractLLMResponseContent(data1);
                if (!content) lastApiErr = `Empty output`;
              } else {
                const raw1 = await res1.text();
                lastApiErr = parseApiErrorMessage(res1.status, raw1);
                if (res1.status === 429) {
                  isRateLimit = true;
                  throw new Error(`Rate limit exceeded (${res1.status}): ${lastApiErr}`);
                }
                if (res1.status === 402 || lastApiErr.toLowerCase().includes("insufficient balance") || lastApiErr.toLowerCase().includes("payment required")) {
                  throw new Error(`LLM API returned error (${res1.status || 402}): Insufficient Balance`);
                }
                if (res1.status === 401 || res1.status === 403) {
                  throw new Error(`Authentication error (${res1.status}): ${lastApiErr}`);
                }
                if (res1.status >= 400) {
                  throw new Error(`LLM API returned error (${res1.status}): ${lastApiErr}`);
                }
              }
            } catch (err1: any) {
              const msg = err1.message || String(err1);
              lastApiErr = parseApiErrorMessage(0, msg);
              if (lastApiErr.includes("429") || lastApiErr.includes("Rate limit")) {
                isRateLimit = true;
                throw err1;
              }
              if (lastApiErr.includes("Authentication error") || msg.includes("LLM API returned error") || msg.includes("Insufficient Balance")) throw err1;
            }

            if ((!content || !content.trim()) && !isRateLimit) {
              const res2 = await fetch(`/api/chat`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  baseUrl: settings.baseUrl,
                  apiKey: settings.apiKey,
                  payload: {
                    model: settings.modelName,
                    temperature: Number(settings.temperature) || 0.1,
                    max_tokens: maxTokensVal,
                    response_format: { type: "json_object" },
                    messages: [
                      { role: "system", content: dynamicSystemPrompt + "\nIMPORTANT: Return ONLY a valid JSON object." },
                      { role: "user", content: userPromptContent }
                    ]
                  }
                })
              });

              if (res2.ok) {
                const data2 = await res2.json();
                if (data2.usage) {
                  tokensUsed = { ...data2.usage };
                }
                content = extractLLMResponseContent(data2);
              } else {
                const raw2 = await res2.text();
                const err2Parsed = parseApiErrorMessage(res2.status, raw2);
                if (res2.status === 429) isRateLimit = true;
                lastApiErr = err2Parsed || lastApiErr;
              }
            }

            // Third fallback: If res1 and res2 both failed, try res3 with minimal user prompt (without web content)
            if ((!content || !content.trim()) && !isRateLimit) {
              const minUserPrompt = `Product SKU: ${skuItem.sku}
Attribute Set: ${skuItem.attribute_set}

=== UPLOADED ATTRIBUTES ===
${JSON.stringify(cleanAttributes, null, 2)}

=== SOURCE SAP TEXT ===
${skuItem.source.sap || "N/A"}`.trim();

              const res3 = await fetch(`/api/chat`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  baseUrl: settings.baseUrl,
                  apiKey: settings.apiKey,
                  payload: {
                    model: settings.modelName,
                    temperature: Number(settings.temperature) || 0.1,
                    max_tokens: maxTokensVal,
                    response_format: { type: "json_object" },
                    messages: [
                      { role: "system", content: dynamicSystemPrompt + "\nIMPORTANT: Return ONLY a valid JSON object." },
                      { role: "user", content: minUserPrompt }
                    ]
                  }
                })
              });

              if (res3.ok) {
                const data3 = await res3.json();
                if (data3.usage) {
                  tokensUsed = { ...data3.usage };
                }
                content = extractLLMResponseContent(data3);
              } else {
                const raw3 = await res3.text();
                const err3Parsed = parseApiErrorMessage(res3.status, raw3);
                if (res3.status === 429) isRateLimit = true;
                throw new Error(`LLM API returned error (${res3.status}): ${err3Parsed || lastApiErr}`);
              }
            }

            if (isRateLimit) {
              throw new Error(`Rate limit exceeded: ${lastApiErr}`);
            }

            if (!content || !content.trim()) throw new Error(`LLM endpoint returned no content. ${lastApiErr}`);
            
            let qaResult: any;
            try {
              qaResult = parseLLMJsonResponse(content);
            } catch (parseError: any) {
              throw new Error(`LLM returned invalid JSON: ${parseError.message}`);
            }
            
            const skuTimeTaken = Date.now() - skuStartTime;
            
            const exportData = {
              qa_status: qaResult.qa_status || "completed",
              summary: qaResult.summary || "",
              confidence: qaResult.confidence || "medium",
              issue_count: qaResult.issue_count || (qaResult.issues ? qaResult.issues.length : 0),
              issues: qaResult.issues || [],
              errors: (qaResult.issues || []).map((issue: any) => `${issue.field || 'general'} : ${issue.uploaded_value || ''} : ${issue.explanation}`),
              cell_colors: (qaResult.issues || []).reduce((acc: Record<string, string>, issue: any) => {
                if (issue.field) {
                  acc[issue.field] = issue.cell_color || "yellow";
                }
                return acc;
              }, {}),
              last_job_id: job.id,
              updated_at: new Date().toISOString()
            };

            await updateSku(skuItem.sku, {
              status: qaResult.qa_status === "fail" ? "failed" : "completed", 
              raw_row: { ...skuItem.raw_row, qa_result: qaResult },
              qa_result: qaResult,
              export_data: exportData,
              last_job_id: job.id,
              tokensUsed,
              timeTaken: (skuItem.timeTaken || 0) + skuTimeTaken,
              error: null
            });
            processedSkuIds.add(skuItem.sku);
            
            totalJobTokens.prompt_tokens += tokensUsed.prompt_tokens || 0;
            totalJobTokens.completion_tokens += tokensUsed.completion_tokens || 0;
            totalJobTokens.total_tokens += tokensUsed.total_tokens || 0;

            success = true;
          } catch (err: any) {
            console.error(`Attempt ${attempts} failed for SKU:`, skuItem.sku, err);
            const errMsg = String(err.message || err);
            
            const isFatalApiError = 
              errMsg.includes("402") || 
              errMsg.toLowerCase().includes("insufficient balance") || 
              errMsg.toLowerCase().includes("payment required") ||
              errMsg.toLowerCase().includes("insufficient_quota") ||
              errMsg.includes("free-models-per-day") || 
              errMsg.includes("Quota Exceeded") || 
              errMsg.includes("Authentication error") ||
              errMsg.includes("401") ||
              errMsg.includes("403");

            if (isFatalApiError) {
               setStopRequested(true);
               stopRequestedRef.current = true;
               addNotification({
                 type: "error",
                 title: "LLM API Fatal Error",
                 message: `Job stopped due to API error: ${errMsg}. Please update your API key or account balance in LLM Settings.`
               });
               attempts = maxRetries + 1; // force break without retrying
            }

            if (attempts > maxRetries) {
              const skuTimeTaken = Date.now() - skuStartTime;
              await updateSku(skuItem.sku, {
                status: "failed",
                timeTaken: (skuItem.timeTaken || 0) + skuTimeTaken,
                error: errMsg
              });
              processedSkuIds.add(skuItem.sku);
              hasError = true;
            } else {
              // Wait briefly before retrying, exponential backoff
              let waitTime = 2000;
              if (errMsg.includes("500") || errMsg.includes("529") || errMsg.includes("429") || errMsg.includes("Rate limit exceeded") || errMsg.includes("Concurrency")) {
                 waitTime = attempts * 5000 + Math.random() * 2000;
              }
              await new Promise(r => setTimeout(r, waitTime));
            }
          }
        }
      }
    };
    
    // Launch workers with staggered start delays to prevent API burst limits
    const workers = Array.from({ length: Math.min(maxConcurrency, skusToProcess.length) }, (_, i) => {
      return (async () => {
        if (i > 0) await new Promise(r => setTimeout(r, i * 400));
        await processNext();
      })();
    });
    await Promise.all(workers);
    
    const finalTokens = {
      prompt_tokens: (job.tokensUsed?.prompt_tokens || 0) + totalJobTokens.prompt_tokens,
      completion_tokens: (job.tokensUsed?.completion_tokens || 0) + totalJobTokens.completion_tokens,
      total_tokens: (job.tokensUsed?.total_tokens || 0) + totalJobTokens.total_tokens,
    };
    
    const jobTimeTaken = Date.now() - jobStartTime;

    const wasStopped = stopRequestedRef.current;
    const finalStatus = getJobRunStatus(allSkusInJob, processedSkuIds, hasError);
    const finalError = finalStatus === "completed"
      ? null
      : finalStatus === "pending"
        ? wasStopped
          ? "Job stopped before all SKUs finished."
          : "Some SKUs are still waiting to run."
        : hasError
          ? "Some SKUs failed to process."
          : "Some SKUs still need attention.";

    await updateJob(jobId, {
      status: finalStatus,
      tokensUsed: finalTokens,
      timeTaken: (job.timeTaken || 0) + jobTimeTaken,
      error: finalError
    });
    setRunningJobId(null);
    setStopRequested(false);
    stopRequestedRef.current = false;
    
    addNotification({
      type: finalStatus === "completed" ? "success" : "warning",
      title: "Job Execution Finished",
      message: `Job ${job.name} ${finalStatus === "completed" ? "finished successfully" : finalStatus === "pending" ? wasStopped ? "was paused" : "still has SKUs to process" : "finished with some errors"}.`
    });
    return wasStopped;
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

      const skuIds = Array.isArray(jobOrJobs)
        ? getCompletedJobSkuIds(jobsToExport)
        : [...new Set(jobOrJobs.skus)];
      const skuMap = new Map(skuDataList.map((sku) => [sku.sku, sku]));
      const missingSkuIds = skuIds.filter((sku) => !skuMap.has(sku));
      if (missingSkuIds.length > 0) {
        addNotification({
          type: "error",
          title: "Export Failed",
          message: `${missingSkuIds.length} SKU(s) no longer exist in the catalog: ${missingSkuIds.slice(0, 5).join(", ")}.`
        });
        return;
      }

      const allJobSkus = skuIds.map((sku) => skuMap.get(sku)!);
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

      let maxIssues = 0;
      jobSkus.forEach(sku => {
        const qa = sku.qa_result || (sku.raw_row && sku.raw_row.qa_result);
        if (qa && qa.issues && Array.isArray(qa.issues)) {
          maxIssues = Math.max(maxIssues, qa.issues.length);
        }
      });

      sheet.columns = getExportColumns(headerOrder.headers, maxIssues);

      jobSkus.forEach((sku) => {
        const rowData: Record<string, any> = {};
        headerOrder.headers.forEach((header, index) => {
          const value = sku.raw_row?.[header];
          rowData[`input_${index}`] = typeof value === "object" && value !== null ? JSON.stringify(value) : value;
        });
        const qa = sku.qa_result || (sku.raw_row && sku.raw_row.qa_result);
        
        if (qa) {
          rowData.qa_status = qa.qa_status || sku.status;
          
          if (qa.issues && Array.isArray(qa.issues)) {
            qa.issues.forEach((issue: any, index: number) => {
              rowData[`error_${index + 1}`] = `${issue.field || 'general'} : ${issue.uploaded_value || ''} : ${issue.explanation}`;
            });
          }
        } else {
          rowData.qa_status = sku.status;
        }
        
        rowData.qa_scrape_status = sku.scrape_status;
        rowData.job_error = sku.error || '';

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

            const originalColIndex = headerOrder.headers.indexOf(field);
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
        message: "Failed to generate Excel file for job."
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
          
          {runningJobId && (
            <div className="bg-[#F5F2EF] border border-[#E5E2DE] rounded-sm p-4 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="font-serif text-lg text-[#1A1A1A]">Running Job: {jobs.find(j => j.id === runningJobId)?.name}</h4>
                  <p className="text-[11px] text-[#8C8882] uppercase tracking-widest mt-1">
                    Processing {progress.current} of {progress.total}
                  </p>
                </div>
                <button
                  onClick={() => {
                    setStopRequested(true);
                    stopRequestedRef.current = true;
                  }}
                  disabled={stopRequested}
                  className="flex items-center gap-2 px-4 py-2 text-[10px] uppercase font-bold text-red-600 border border-red-200 hover:bg-red-50 transition-colors rounded-sm bg-white disabled:opacity-50"
                >
                  <StopCircle className="w-3.5 h-3.5" />
                  {stopRequested ? "Stopping after current..." : "Stop After Current SKU"}
                </button>
              </div>
              
              <div>
                <div className="flex justify-between text-[11px] text-[#1A1A1A] mb-1.5 font-mono">
                  <span>{progress.currentSku}</span>
                  <span className="text-[#8C8882]">{progress.action}</span>
                </div>
                <div className="h-1.5 w-full bg-[#E5E2DE] rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-[#1A1A1A] transition-all duration-300"
                    style={{ width: `${(progress.current / progress.total) * 100}%` }}
                  ></div>
                </div>
              </div>
            </div>
          )}

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
                  disabled={!!runningJobId}
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
                      onClick={() => setSelectedJobToView(job)}
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
                        disabled={!!runningJobId}
                        className="flex items-center gap-2 px-4 py-2 text-[11px] uppercase tracking-widest border border-[#1A1A1A] bg-[#1A1A1A] text-white hover:bg-black transition-colors rounded-sm disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <Play className="w-3.5 h-3.5" />
                        {job.status === 'pending' && completedCount === 0 ? 'Run Q.A' : 'Resume Q.A'}
                      </button>
                    )}

                    {completedCount > 0 && (
                      <button
                        onClick={() => runJob(job.id, false, undefined, true)}
                        disabled={!!runningJobId}
                        className="flex items-center gap-2 px-4 py-2 text-[11px] uppercase tracking-widest border border-[#1A1A1A] text-[#1A1A1A] bg-white hover:bg-[#F5F2EF] transition-colors rounded-sm disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <Play className="w-3.5 h-3.5" />
                        Rerun All
                      </button>
                    )}

                    <button
                      onClick={() => {
                        setSelectedJobs((selected) => {
                          const next = new Set(selected);
                          next.delete(job.id);
                          return next;
                        });
                        removeJob(job.id);
                        addNotification({
                          type: "info",
                          title: "Job Removed",
                          message: `Job "${job.name}" has been deleted.`
                        });
                      }}
                      className="p-2 text-[#8C8882] hover:text-red-600 hover:bg-red-50 transition-colors rounded-sm"
                      title="Delete Job"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
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
                          disabled={!!runningJobId}
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

                                {iss.suggested_fix && (
                                  <div className="bg-emerald-50/80 border border-emerald-200 p-2 rounded text-emerald-900 font-mono text-[11px]">
                                    <span className="font-bold block text-[9px] uppercase tracking-widest text-emerald-800">Suggested Fix:</span>
                                    {iss.suggested_fix}
                                  </div>
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
