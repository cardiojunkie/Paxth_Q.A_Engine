import React, { useState } from "react";
import { Plus, LayoutTemplate, Pencil, Trash2, FileText, ChevronRight, X, Search } from "lucide-react";
import { format } from "date-fns";
import { useAttributeSets } from "../hooks/useAttributeSets";
import { AttributeSet } from "../types";
import { AttributeSetEditor } from "./AttributeSetEditor";
import { cn } from "../lib/utils";

export function AttributeSetsModule() {
  const { attributeSets, addSet, updateSet, deleteSet } = useAttributeSets();
  const [editingSet, setEditingSet] = useState<AttributeSet | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const filteredSets = attributeSets.filter(set => 
    set.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleCreate = (data: Omit<AttributeSet, "id" | "createdAt" | "updatedAt">) => {
    if (attributeSets.some(s => s.name.toLowerCase() === data.name.trim().toLowerCase())) {
      setEditorError("An attribute set with this name already exists.");
      return;
    }
    setEditorError(null);
    addSet(data);
    setIsCreating(false);
  };

  const handleUpdate = (data: Omit<AttributeSet, "id" | "createdAt" | "updatedAt">) => {
    if (editingSet) {
      if (attributeSets.some(s => s.id !== editingSet.id && s.name.toLowerCase() === data.name.trim().toLowerCase())) {
        setEditorError("An attribute set with this name already exists.");
        return;
      }
      setEditorError(null);
      updateSet(editingSet.id, data);
      setEditingSet(null);
    }
  };

  const handleDelete = (id: string) => {
    setEditorError(null);
    deleteSet(id);
    if (editingSet?.id === id) {
      setEditingSet(null);
    }
  };

  return (
    <>
      {/* Sidebar: Attribute Sets (The 'Table of Contents') */}
      <aside className="w-64 border-r border-[#E5E2DE] flex flex-col shrink-0">
        <div className="p-8 pb-4 shrink-0 flex flex-col gap-4">
          <h2 className="font-serif text-sm italic text-[#8C8882]">Index / Collections</h2>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#8C8882]" />
            <input 
              type="text" 
              placeholder="Search sets..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 text-xs bg-[#F5F2EF] border border-transparent rounded-sm outline-none focus:border-[#1A1A1A] transition-colors text-[#1A1A1A] placeholder:text-[#8C8882]"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-8 pb-8 pt-2 min-h-0">
          <ul className="space-y-4">
            {filteredSets.length === 0 ? (
              <li className="text-[10px] text-[#8C8882] uppercase tracking-widest">No matching sets</li>
            ) : (
              filteredSets.map((set) => {
                const originalIndex = attributeSets.findIndex(s => s.id === set.id);
                return (
                  <li 
                    key={set.id} 
                    className={cn(
                      "flex flex-col cursor-pointer transition-colors",
                      editingSet?.id === set.id ? "border-l-2 border-[#1A1A1A] pl-4 -ml-[18px]" : "opacity-40 hover:opacity-100"
                    )}
                    onClick={() => { setIsCreating(false); setEditingSet(set); setEditorError(null); }}
                  >
                    <span className={cn("text-[10px] mb-1 font-mono", editingSet?.id === set.id ? "text-[#1A1A1A]" : "text-[#8C8882]")}>
                      {(originalIndex + 1).toString().padStart(2, '0')}
                    </span>
                <span className={cn("font-serif text-xl flex items-center gap-2", editingSet?.id === set.id && "font-bold")}>
                  {set.name}
                  {set.rulesMarkdown.trim().length > 0 && (
                    <span className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" title="Has mapping rules"></span>
                  )}
                </span>
                {editingSet?.id === set.id && (
                  <span className="text-[10px] uppercase tracking-tighter mt-1 text-[#8C8882]">Active</span>
                )}
              </li>
                );
              })
            )}
          </ul>
        </div>
        <div className="p-8 pt-6 border-t border-[#E5E2DE] shrink-0 bg-[#FDFCFB]">
          <button
            onClick={() => { setEditingSet(null); setIsCreating(true); setEditorError(null); }}
            className="text-[11px] uppercase tracking-widest border border-[#1A1A1A] px-5 py-2 hover:bg-[#1A1A1A] hover:text-white transition-colors w-full mb-4"
          >
            New Attribute Set
          </button>
          <div className="p-4 bg-[#F5F2EF] rounded-sm">
            <p className="text-[10px] leading-relaxed italic text-[#8C8882]">"Attribute sets define the validation boundary for the DeepSeek-V4-Flash scraper engine."</p>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col overflow-hidden bg-[#FDFCFB]">
        {(isCreating || editingSet) ? (
          <AttributeSetEditor
            initialData={editingSet}
            onSave={isCreating ? handleCreate : handleUpdate}
            onCancel={() => {
              setIsCreating(false);
              setEditingSet(null);
              setEditorError(null);
            }}
            onDelete={editingSet ? () => handleDelete(editingSet.id) : undefined}
            error={editorError}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center p-10">
            <div className="text-center max-w-sm">
              <LayoutTemplate className="mx-auto h-8 w-8 text-[#8C8882] mb-6 opacity-50" />
              <h2 className="font-serif text-3xl mb-4 tracking-tighter">No Selection</h2>
              <p className="text-[#8C8882] text-sm mb-6 leading-relaxed">Select an attribute set from the index to view its mapping rules, or create a new one to define validation logic.</p>
            </div>
          </div>
        )}
      </main>
    </>
  );
}
