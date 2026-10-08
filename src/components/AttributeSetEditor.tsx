import React, { useState, useEffect } from "react";
import { X, Trash2 } from "lucide-react";
import Markdown from "react-markdown";
import { format } from "date-fns";
import { AttributeSet } from "../types";
import { cn } from "../lib/utils";
import { validateCatalogHeaders } from '../lib/catalogGeneration';

interface AttributeSetEditorProps {
  initialData: AttributeSet | null;
  onSave: (data: Omit<AttributeSet, "id" | "createdAt" | "updatedAt">) => void;
  onCancel: () => void;
  onDelete?: () => void;
  disabled?: boolean;
  readOnly?: boolean;
}

export function AttributeSetEditor({ initialData, onSave, onCancel, onDelete, error, disabled, readOnly }: AttributeSetEditorProps & { error?: string | null }) {
  const [name, setName] = useState(initialData?.name || "");
  const [rulesMarkdown, setRulesMarkdown] = useState(initialData?.rulesMarkdown || "");
  const [activeTab, setActiveTab] = useState<"edit" | "preview">("edit");
  const [section, setSection] = useState<'rules' | 'headers'>('rules');
  const [headersText, setHeadersText] = useState(initialData?.catalogHeaders?.join('\n') || '');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    setName(initialData?.name || "");
    setRulesMarkdown(initialData?.rulesMarkdown || "");
    setHeadersText(initialData?.catalogHeaders?.join('\n') || '');
    setSection('rules');
    setActiveTab('edit');
    setShowDeleteConfirm(false);
    setLocalError(null);
  }, [initialData]);

  useEffect(() => {
    if (error) setLocalError(error);
  }, [error]);

  const handleSave = () => {
    if (readOnly) return;
    if (!name.trim()) {
      setLocalError("Please provide a name for the attribute set.");
      return;
    }
    const catalogHeaders = headersText.trim() ? headersText.replace(/\r\n/g, '\n').replace(/\n+$/, '').split('\n') : [];
    try { validateCatalogHeaders(catalogHeaders); }
    catch (error) { setLocalError((error as Error).message); return; }
    setLocalError(null);
    onSave({
      name: name.trim(),
      rulesMarkdown,
      catalogHeaders,
    });
  };

  return (
    <fieldset disabled={disabled} className="flex-1 flex flex-col h-full min-w-0 bg-[#FDFCFB]">
      {/* Header Section */}
      <header className="p-10 pb-6 flex items-end justify-between shrink-0">
        <div className="flex-1 mr-8">
          <input 
            type="text"
            value={name}
            aria-label="Attribute set name"
            readOnly={readOnly}
            onChange={(e) => {
              setName(e.target.value);
              setLocalError(null);
            }}
            placeholder="Untitled Attribute Set"
            className={cn("font-serif text-6xl tracking-tighter mb-2 bg-transparent border-b outline-none p-0 focus:ring-0 w-full placeholder:text-[#E5E2DE] transition-colors text-[#1A1A1A]", localError ? "border-red-500 focus:border-red-500 hover:border-red-500" : "border-transparent hover:border-[#E5E2DE] focus:border-[#1A1A1A]")}
          />
          {localError ? (
            <p role="alert" className="text-red-600 text-sm font-medium mt-2">{localError}</p>
          ) : (
            <p className="text-[#8C8882] text-sm max-w-lg leading-relaxed mt-2">
              Share mapping instructions and examples between QA and Catalog. Configure Catalog output columns and their order separately.
            </p>
          )}
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span className="text-[10px] uppercase tracking-widest text-[#8C8882]">
            {initialData ? "Last Modified" : "Status"}
          </span>
          <span className="font-mono text-xs">
            {initialData ? format(initialData.updatedAt, "MMM dd, yyyy / HH:mm").toUpperCase() : "UNSAVED DRAFT"}
          </span>
          <div className="mt-4 flex gap-4">
             {onDelete && (
                showDeleteConfirm ? (
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] uppercase font-bold text-red-600">Sure?</span>
                    <button 
                      onClick={onDelete}
                      className="text-[10px] uppercase font-bold text-white bg-red-600 px-2 py-0.5 rounded-sm hover:bg-red-700 transition-colors"
                    >
                      Yes
                    </button>
                    <button 
                      onClick={() => setShowDeleteConfirm(false)}
                      className="text-[10px] uppercase font-bold text-[#8C8882] hover:text-[#1A1A1A] transition-colors"
                    >
                      No
                    </button>
                  </div>
                ) : (
                  <button 
                    onClick={() => setShowDeleteConfirm(true)}
                    className="text-[10px] uppercase font-bold text-[#8C8882] hover:text-red-600 flex items-center transition-colors"
                  >
                    <Trash2 className="w-3 h-3 mr-1" /> Delete
                  </button>
                )
             )}
             <button 
                onClick={onCancel}
                className="text-[10px] uppercase font-bold text-[#8C8882] hover:text-[#1A1A1A] flex items-center transition-colors"
             >
                <X className="w-3 h-3 mr-1" /> Close
             </button>
          </div>
        </div>
      </header>

      {/* Rules Grid */}
      <div className="flex-1 px-10 pb-10 grid grid-cols-1 lg:grid-cols-12 gap-8 overflow-hidden min-h-0">
        
        {/* Markdown Rule Editor */}
        <div className="lg:col-span-12 flex flex-col h-full overflow-hidden">
          <div className="flex-1 border border-[#E5E2DE] bg-white p-8 flex flex-col min-h-0">
            <div className="mb-6 flex justify-between items-center shrink-0">
              <div role="group" aria-label="Attribute set sections" className="flex gap-4">
                <button type="button" id="attribute-rules-tab" aria-pressed={section === 'rules'}
                  onClick={() => setSection('rules')} className={cn('text-[11px] font-bold uppercase tracking-widest', section === 'rules' ? 'text-[#1A1A1A]' : 'text-[#8C8882]')}>
                  Mapping Rules
                </button>
                <button type="button" id="attribute-headers-tab" aria-pressed={section === 'headers'}
                  onClick={() => setSection('headers')} className={cn('text-[11px] font-bold uppercase tracking-widest', section === 'headers' ? 'text-[#1A1A1A]' : 'text-[#8C8882]')}>
                  Catalog Output Headers
                </button>
              </div>
              {section === 'rules' && <div className="flex gap-2">
                 <button
                   onClick={() => setActiveTab("edit")}
                   className={cn("text-[10px] uppercase tracking-widest font-bold transition-colors", activeTab === "edit" ? "text-[#1A1A1A]" : "text-[#8C8882] hover:text-[#1A1A1A]")}
                 >
                   Edit
                 </button>
                 <span className="text-[#E5E2DE]">/</span>
                 <button
                   onClick={() => setActiveTab("preview")}
                   className={cn("text-[10px] uppercase tracking-widest font-bold transition-colors", activeTab === "preview" ? "text-[#1A1A1A]" : "text-[#8C8882] hover:text-[#1A1A1A]")}
                 >
                   Preview
                 </button>
              </div>}
            </div>
            
            <div role="region" id={section === 'rules' ? 'attribute-rules-panel' : 'attribute-headers-panel'}
              aria-labelledby={section === 'rules' ? 'attribute-rules-tab' : 'attribute-headers-tab'} className="flex-1 overflow-y-auto min-h-0 relative flex flex-col">
               {section === 'headers' ? <>
                 <p id="catalog-headers-help" className="text-sm text-[#8C8882] mb-4">
                   One exact output header per line, in export order. Include sku, base_code, attributes__lulu_ean, attributes__shipping_weight,
                   attributes__brand, and attributes__lulu_product_type. Leave empty for a QA-only set. This list controls Catalog output only; upload requirements stay fixed.
                 </p>
                 <textarea aria-label="Catalog output headers" aria-describedby="catalog-headers-help" value={headersText} readOnly={readOnly}
                   onChange={event => { setHeadersText(event.target.value); setLocalError(null); }}
                   className="w-full flex-1 resize-none border-0 bg-transparent text-sm leading-relaxed text-[#4A4A4A] focus:ring-0 p-0 font-mono"
                   placeholder="sku&#10;base_code&#10;attributes__lulu_ean&#10;attributes__shipping_weight&#10;attributes__brand&#10;attributes__lulu_product_type&#10;name" />
               </> : activeTab === "edit" ? (
                 <textarea
                   aria-label="Mapping rules"
                   readOnly={readOnly}
                   value={rulesMarkdown}
                   onChange={(e) => setRulesMarkdown(e.target.value)}
                   className="w-full h-full resize-none border-0 bg-transparent text-sm leading-relaxed text-[#4A4A4A] focus:ring-0 p-0 font-mono"
                   placeholder="# Validation Rule: Material_Composition\n\n## Overview\nThis rule checks the alignment between the scraped product data and the SAP Master Data.\n..."
                 />
               ) : (
                 <div className="w-full h-full prose prose-sm prose-gray max-w-none prose-headings:font-serif text-[#4A4A4A]">
                   {rulesMarkdown ? (
                     <Markdown>{rulesMarkdown}</Markdown>
                   ) : (
                     <p className="text-[#8C8882] italic">No rules defined yet.</p>
                   )}
                 </div>
               )}
            </div>

            <div className="mt-6 pt-6 border-t border-[#E5E2DE] flex justify-between items-center shrink-0">
              <div className="text-[10px] text-[#8C8882]">
                SAVE TO SHARE RULES THROUGH SUPABASE
                {readOnly && <span className="block mt-1">Administrator access is required to edit this attribute set.</span>}
              </div>
              <button 
                onClick={handleSave}
                disabled={readOnly}
                className="bg-[#7C8370] text-white text-[11px] px-6 py-2 uppercase tracking-widest font-bold hover:bg-[#686E5E] transition-colors"
              >
                {initialData ? "Update Logic" : "Create Logic"}
              </button>
            </div>
          </div>
        </div>
        
      </div>
    </fieldset>
  );
}
