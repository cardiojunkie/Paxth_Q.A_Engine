import { type FormEvent, useEffect, useRef, useState } from "react";
import { AlertCircle, CheckCircle, Download, Play, Save, Upload } from "lucide-react";
import { useAppContext } from "../context/AppContext";
import { type SettingsUpdate, useSettings } from "../hooks/useSettings";
import { useSiteSelectors } from "../hooks/useSiteSelectors";
import { apiFetch } from "../lib/api";
import type { AttributeSet, SiteSelectorRule } from "../types";

const ATTRIBUTE_STORAGE_KEY = "qa-analyzer-attribute-sets";
const MAX_BACKUP_BYTES = 5 * 1024 * 1024;
const MAX_ITEMS = 500;

type EditableSettings = SettingsUpdate & { apiKey: string };
type SelectorDraft = Pick<SiteSelectorRule, "website" | "selectors" | "enabled"> & {
  tabSelector: string;
  tabContentSelector: string;
  tabWaitMs: number;
};

const emptySelector = (): SelectorDraft => ({
  website: "",
  selectors: "",
  tabSelector: "",
  tabContentSelector: "",
  tabWaitMs: 300,
  enabled: true,
});

const editableSettings = (settings: ReturnType<typeof useSettings>["settings"]): EditableSettings => {
  const { hasApiKey: _hasApiKey, ...editable } = settings;
  return { ...editable, apiKey: "" };
};

const readLocalAttributeSets = (): AttributeSet[] => {
  try {
    const parsed = JSON.parse(localStorage.getItem(ATTRIBUTE_STORAGE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.slice(0, MAX_ITEMS) : [];
  } catch {
    return [];
  }
};

export function validateBackup(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid backup file.");
  const source = value as Record<string, unknown>;

  if (Array.isArray(source.attributeSets) && source.attributeSets.length > MAX_ITEMS) throw new Error("Backup has too many attribute sets.");
  if (Array.isArray(source.siteSelectors) && source.siteSelectors.length > MAX_ITEMS) throw new Error("Backup has too many site selectors.");

  const attributeSets = (Array.isArray(source.attributeSets) ? source.attributeSets : []).map((item) => {
    if (!item || typeof item !== "object") throw new Error("Invalid attribute set in backup.");
    const data = item as Record<string, unknown>;
    const name = String(data.name || "").trim();
    const rulesMarkdown = String(data.rulesMarkdown || "");
    if (!name || name.length > 200 || rulesMarkdown.length > 200_000) throw new Error("Attribute set exceeds import limits.");
    return {
      id: typeof data.id === "string" && data.id.length <= 100 ? data.id : crypto.randomUUID(),
      name,
      rulesMarkdown,
      createdAt: Number.isFinite(Number(data.createdAt)) ? Number(data.createdAt) : Date.now(),
      updatedAt: Number.isFinite(Number(data.updatedAt)) ? Number(data.updatedAt) : Date.now(),
    } satisfies AttributeSet;
  });

  const siteSelectors = (Array.isArray(source.siteSelectors) ? source.siteSelectors : []).map((item) => {
    if (!item || typeof item !== "object") throw new Error("Invalid site selector in backup.");
    const data = item as Record<string, unknown>;
    const website = String(data.website || "").trim();
    const selectors = String(data.selectors || "").trim();
    if (!website || website.length > 253 || !selectors || selectors.length > 2_000) throw new Error("Site selector exceeds import limits.");
    return {
      id: typeof data.id === "string" && data.id.length <= 100 ? data.id : crypto.randomUUID(),
      website,
      selectors,
      tabSelector: typeof data.tabSelector === "string" ? data.tabSelector.slice(0, 2_000) : undefined,
      tabContentSelector: typeof data.tabContentSelector === "string" ? data.tabContentSelector.slice(0, 2_000) : undefined,
      tabWaitMs: Math.min(10_000, Math.max(0, Number(data.tabWaitMs) || 300)),
      enabled: data.enabled !== false,
      createdAt: Number(data.createdAt) || Date.now(),
      updatedAt: Number(data.updatedAt) || Date.now(),
    } satisfies SiteSelectorRule;
  });

  const rawSettings = source.settings && typeof source.settings === "object" && !Array.isArray(source.settings)
    ? source.settings as Record<string, unknown>
    : {};
  const settings: Record<string, string | number> = {};
  if (rawSettings.llmProvider === "openai-compatible") settings.llmProvider = rawSettings.llmProvider;
  if (typeof rawSettings.modelName === "string" && rawSettings.modelName.trim() && rawSettings.modelName.length <= 200) {
    settings.modelName = rawSettings.modelName.trim();
  }
  if (typeof rawSettings.baseUrl === "string" && rawSettings.baseUrl.length <= 2_048) {
    try {
      const endpoint = new URL(rawSettings.baseUrl);
      if (endpoint.protocol === "https:" && endpoint.pathname.endsWith("/chat/completions")) settings.baseUrl = endpoint.href;
    } catch {
      // Invalid legacy values are skipped; the server keeps its current setting.
    }
  }
  const copyNumber = (name: string, min: number, max: number, integer = true) => {
    const candidate = rawSettings[name];
    if (typeof candidate === "number" && Number.isFinite(candidate) && candidate >= min && candidate <= max && (!integer || Number.isInteger(candidate))) {
      settings[name] = candidate;
    }
  };
  copyNumber("temperature", 0, 1, false);
  copyNumber("maxTokens", 1, 4096);
  copyNumber("maxRetries", 0, 3);
  copyNumber("scraperTimeout", 5_000, 45_000);
  copyNumber("maxPageContentLength", 1_000, 100_000);

  return {
    attributeSets,
    siteSelectors,
    ...(Object.keys(settings).length ? { settings } : {}),
  };
}

export function LLMSettingsModule() {
  const { settings, isLoading, error, saveSettings, testSettings, refresh } = useSettings();
  const {
    rules: siteSelectors,
    isLoading: selectorsLoading,
    error: selectorsError,
    refresh: refreshSelectors,
    addRule,
    updateRule,
    deleteRule,
  } = useSiteSelectors();
  const { addNotification } = useAppContext();
  const [localSettings, setLocalSettings] = useState<EditableSettings>(() => editableSettings(settings));
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isClearingKey, setIsClearingKey] = useState(false);
  const [selectorDraft, setSelectorDraft] = useState<SelectorDraft>(emptySelector);
  const [editingSelectorId, setEditingSelectorId] = useState<string | null>(null);
  const [busySelectorId, setBusySelectorId] = useState<string | null>(null);
  const importInput = useRef<HTMLInputElement>(null);

  useEffect(() => setLocalSettings(editableSettings(settings)), [settings]);

  const change = (field: keyof EditableSettings, value: string | number) => {
    setLocalSettings((previous) => ({ ...previous, [field]: value }));
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const payload = { ...localSettings };
      if (!payload.apiKey) delete payload.apiKey;
      await saveSettings(payload);
      addNotification({ type: "success", title: "Settings Saved", message: "Server settings were updated." });
    } catch (error) {
      addNotification({ type: "error", title: "Save Failed", message: error instanceof Error ? error.message : "Could not save settings." });
    } finally {
      setIsSaving(false);
    }
  };

  const handleTest = async () => {
    setIsTesting(true);
    try {
      await testSettings();
      addNotification({ type: "success", title: "Connection Successful", message: "The server reached the configured LLM provider." });
    } catch (error) {
      addNotification({ type: "error", title: "Connection Failed", message: error instanceof Error ? error.message : "Could not reach the provider." });
    } finally {
      setIsTesting(false);
    }
  };

  const clearApiKey = async () => {
    if (!window.confirm("Clear the configured API key? Jobs cannot run until a new key is saved.")) return;
    setIsClearingKey(true);
    try {
      await saveSettings({ ...localSettings, apiKey: null });
      addNotification({ type: "success", title: "API Key Cleared", message: "The encrypted provider key was removed." });
    } catch (error) {
      addNotification({ type: "error", title: "Clear Failed", message: error instanceof Error ? error.message : "Could not clear the API key." });
    } finally {
      setIsClearingKey(false);
    }
  };

  const resetSelectorForm = () => {
    setEditingSelectorId(null);
    setSelectorDraft(emptySelector());
  };

  const editSelector = (rule: SiteSelectorRule) => {
    setEditingSelectorId(rule.id);
    setSelectorDraft({
      website: rule.website,
      selectors: rule.selectors,
      tabSelector: rule.tabSelector || "",
      tabContentSelector: rule.tabContentSelector || "",
      tabWaitMs: rule.tabWaitMs ?? 300,
      enabled: rule.enabled,
    });
  };

  const saveSelector = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const busyId = editingSelectorId || "new";
    setBusySelectorId(busyId);
    try {
      const payload = {
        ...selectorDraft,
        website: selectorDraft.website.trim(),
        selectors: selectorDraft.selectors.trim(),
        tabSelector: selectorDraft.tabSelector.trim() || undefined,
        tabContentSelector: selectorDraft.tabContentSelector.trim() || undefined,
      };
      if (editingSelectorId) await updateRule(editingSelectorId, payload);
      else await addRule(payload);
      addNotification({ type: "success", title: "Site Selector Saved", message: `${payload.website} is now server-managed.` });
      resetSelectorForm();
    } catch (error) {
      addNotification({ type: "error", title: "Selector Save Failed", message: error instanceof Error ? error.message : "Could not save site selector." });
    } finally {
      setBusySelectorId(null);
    }
  };

  const removeSelector = async (rule: SiteSelectorRule) => {
    if (!window.confirm(`Delete the selector for ${rule.website}?`)) return;
    setBusySelectorId(rule.id);
    try {
      await deleteRule(rule.id);
      if (editingSelectorId === rule.id) resetSelectorForm();
      addNotification({ type: "info", title: "Site Selector Deleted", message: `${rule.website} was removed.` });
    } catch (error) {
      addNotification({ type: "error", title: "Selector Delete Failed", message: error instanceof Error ? error.message : "Could not delete site selector." });
    } finally {
      setBusySelectorId(null);
    }
  };

  const exportLegacyData = async () => {
    try {
      const storedSelectors = JSON.parse(localStorage.getItem("qa-analyzer-site-selectors") || "[]");
      const siteSelectors = Array.isArray(storedSelectors) ? storedSelectors.slice(0, MAX_ITEMS) : [];
      const { hasApiKey: _hasApiKey, ...safeSettings } = settings;
      const body = JSON.stringify({
        version: 1,
        exportedAt: new Date().toISOString(),
        attributeSets: readLocalAttributeSets(),
        siteSelectors,
        settings: safeSettings,
      }, null, 2);
      if (new Blob([body]).size > MAX_BACKUP_BYTES) throw new Error("Legacy data exceeds the 5 MiB backup limit.");
      const url = URL.createObjectURL(new Blob([body], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `paxth-legacy-backup-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      addNotification({ type: "error", title: "Backup Failed", message: error instanceof Error ? error.message : "Could not export legacy data." });
    }
  };

  const importLegacyData = async (file: File) => {
    try {
      if (file.size > MAX_BACKUP_BYTES) throw new Error("Backup files must be 5 MiB or smaller.");
      const backup = validateBackup(JSON.parse(await file.text()));
      const existing = readLocalAttributeSets();
      const existingNames = new Set(existing.map((item) => item.name.trim().toLowerCase()));
      const merged = [...existing, ...backup.attributeSets.filter((item) => !existingNames.has(item.name.toLowerCase()))];
      if (merged.length > MAX_ITEMS) throw new Error(`Combined attribute sets exceed the ${MAX_ITEMS} item limit.`);
      await apiFetch("/api/legacy-import", { method: "POST", body: JSON.stringify({ ...backup, attributeSets: merged }) });
      await Promise.all([
        refresh(),
        apiFetch<AttributeSet[]>("/api/attribute-sets"),
        refreshSelectors(),
      ]);
      window.dispatchEvent(new Event("paxth:attribute-sets-imported"));
      localStorage.removeItem(ATTRIBUTE_STORAGE_KEY);
      localStorage.removeItem("qa-analyzer-site-selectors");
      localStorage.removeItem("qa-analyzer-settings");
      addNotification({ type: "success", title: "Legacy Data Imported", message: "Rules, selectors, and non-secret settings were imported in one server transaction." });
    } catch (error) {
      addNotification({ type: "error", title: "Import Failed", message: error instanceof Error ? error.message : "Invalid backup file." });
    }
  };

  if (isLoading) return <div className="flex-1 grid place-items-center text-sm text-[#8C8882]" role="status">Loading settings…</div>;

  return (
    <div className="flex-1 flex flex-col h-full bg-[#FDFCFB] overflow-hidden">
      <header className="px-10 py-8 border-b border-[#E5E2DE] shrink-0 flex items-end justify-between gap-6">
        <div>
          <h2 className="font-serif text-4xl tracking-tighter mb-2">LLM Settings</h2>
          <p className="text-[#8C8882] text-sm">Provider credentials are encrypted and managed by the server.</p>
        </div>
        <div className="flex gap-3">
          <button onClick={handleTest} disabled={isTesting} className="flex items-center gap-2 px-4 py-2 text-[11px] uppercase font-bold border border-[#E5E2DE] disabled:opacity-50">
            <Play className="w-3.5 h-3.5" /> {isTesting ? "Testing…" : "Test Saved API"}
          </button>
          <button onClick={handleSave} disabled={isSaving} className="flex items-center gap-2 px-6 py-2 text-[11px] uppercase tracking-widest bg-[#1A1A1A] text-white disabled:opacity-50">
            <Save className="w-3.5 h-3.5" /> {isSaving ? "Saving…" : "Save Changes"}
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-10">
        <div className="max-w-4xl space-y-10 pb-10">
          {error && <div role="alert" className="bg-red-50 border border-red-200 p-4 flex gap-3 text-red-700"><AlertCircle className="w-4 h-4 mt-0.5" />{error}</div>}
          <div className="bg-emerald-50 border border-emerald-200 p-4 flex gap-3 text-emerald-800 text-sm">
            <CheckCircle className="w-4 h-4 mt-0.5" />
            API key: {settings.hasApiKey ? "configured. Leave the field blank to keep it." : "not configured."}
          </div>

          <section>
            <h3 className="font-serif text-xl mb-6">Provider</h3>
            <div className="grid grid-cols-2 gap-6">
              <label className="text-[10px] uppercase tracking-widest text-[#8C8882]">Provider Format
                <select value={localSettings.llmProvider} onChange={(event) => change("llmProvider", event.target.value)} className="mt-2 w-full bg-[#F5F2EF] px-4 py-2.5 text-sm">
                  <option value="openai-compatible">OpenAI-compatible</option>
                </select>
              </label>
              <label className="text-[10px] uppercase tracking-widest text-[#8C8882]">Model Name
                <input required value={localSettings.modelName} onChange={(event) => change("modelName", event.target.value)} className="mt-2 w-full bg-[#F5F2EF] px-4 py-2.5 text-sm" />
              </label>
              <label className="col-span-2 text-[10px] uppercase tracking-widest text-[#8C8882]">Chat Completions URL
                <input type="url" required value={localSettings.baseUrl} onChange={(event) => change("baseUrl", event.target.value)} placeholder="https://provider.example/v1/chat/completions" className="mt-2 w-full bg-[#F5F2EF] px-4 py-2.5 text-sm" />
              </label>
              <label className="col-span-2 text-[10px] uppercase tracking-widest text-[#8C8882]">Replace API Key
                <input type="password" autoComplete="new-password" value={localSettings.apiKey} onChange={(event) => change("apiKey", event.target.value)} placeholder={settings.hasApiKey ? "Leave blank to keep current key" : "Enter API key"} className="mt-2 w-full bg-[#F5F2EF] px-4 py-2.5 text-sm font-mono" />
              </label>
              {settings.hasApiKey && <button type="button" onClick={clearApiKey} disabled={isClearingKey} className="col-span-2 justify-self-start text-xs text-red-700 underline disabled:opacity-50">{isClearingKey ? "Clearing…" : "Clear stored API key"}</button>}
            </div>
          </section>

          <section>
            <h3 className="font-serif text-xl mb-6">Execution Limits</h3>
            <div className="grid grid-cols-2 gap-6">
              <label className="text-[10px] uppercase tracking-widest text-[#8C8882]">Retries After First Attempt
                <input type="number" min="0" max="3" value={localSettings.maxRetries} onChange={(event) => change("maxRetries", Number(event.target.value))} className="mt-2 w-full bg-[#F5F2EF] px-4 py-2.5 text-sm" />
                <span className="normal-case tracking-normal block mt-2">0 means one attempt and no retries.</span>
              </label>
              <label className="text-[10px] uppercase tracking-widest text-[#8C8882]">Temperature ({localSettings.temperature})
                <input type="range" min="0" max="1" step="0.1" value={localSettings.temperature} onChange={(event) => change("temperature", Number(event.target.value))} className="mt-3 w-full accent-[#1A1A1A]" />
              </label>
              <label className="text-[10px] uppercase tracking-widest text-[#8C8882]">Max Output Tokens
                <input type="number" min="1" max="4096" value={localSettings.maxTokens} onChange={(event) => change("maxTokens", Number(event.target.value))} className="mt-2 w-full bg-[#F5F2EF] px-4 py-2.5 text-sm" />
              </label>
              <label className="text-[10px] uppercase tracking-widest text-[#8C8882]">Scraper Timeout (ms)
                <input type="number" min="5000" max="45000" step="1000" value={localSettings.scraperTimeout} onChange={(event) => change("scraperTimeout", Number(event.target.value))} className="mt-2 w-full bg-[#F5F2EF] px-4 py-2.5 text-sm" />
              </label>
              <label className="text-[10px] uppercase tracking-widest text-[#8C8882]">Max Page Characters
                <input type="number" min="1000" max="100000" step="1000" value={localSettings.maxPageContentLength} onChange={(event) => change("maxPageContentLength", Number(event.target.value))} className="mt-2 w-full bg-[#F5F2EF] px-4 py-2.5 text-sm" />
              </label>
            </div>
          </section>

          <section className="border-t border-[#E5E2DE] pt-8">
            <h3 className="font-serif text-xl mb-2">Site Selectors</h3>
            <p className="text-sm text-[#8C8882] mb-4">Optional CSS selectors used by the server worker for matching product domains.</p>
            {selectorsError && <div role="alert" className="mb-4 bg-red-50 border border-red-200 p-3 text-sm text-red-700">{selectorsError} <button type="button" onClick={() => void refreshSelectors().catch(() => undefined)} className="ml-2 underline">Retry</button></div>}
            {selectorsLoading ? <p role="status" className="text-sm text-[#8C8882]">Loading site selectors…</p> : (
              <ul className="space-y-2 mb-6">
                {siteSelectors.map((rule) => <li key={rule.id} className="border border-[#E5E2DE] p-3 flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <strong className="text-sm">{rule.website}</strong>
                      <span className="text-[10px] uppercase text-[#8C8882]">{rule.enabled ? "Enabled" : "Disabled"}</span>
                    </div>
                    <code className="block text-xs text-[#8C8882] mt-1 break-all">{rule.selectors}</code>
                  </div>
                  <div className="flex gap-3 shrink-0">
                    <button type="button" onClick={() => editSelector(rule)} disabled={busySelectorId !== null} className="text-xs underline disabled:opacity-50">Edit</button>
                    <button type="button" onClick={() => void removeSelector(rule)} disabled={busySelectorId !== null} className="text-xs text-red-700 underline disabled:opacity-50">Delete</button>
                  </div>
                </li>)}
                {!siteSelectors.length && <li className="text-sm text-[#8C8882]">No site selectors configured.</li>}
              </ul>
            )}

            <form onSubmit={saveSelector} className="bg-white border border-[#E5E2DE] p-5">
              <h4 className="font-semibold text-sm mb-4">{editingSelectorId ? "Edit selector" : "Add selector"}</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <label className="sm:col-span-2 text-[10px] uppercase tracking-widest text-[#8C8882]">Website domain
                  <input required maxLength={253} value={selectorDraft.website} onChange={(event) => setSelectorDraft((previous) => ({ ...previous, website: event.target.value }))} placeholder="shop.example.com" className="mt-2 w-full bg-[#F5F2EF] px-4 py-2.5 text-sm normal-case tracking-normal" />
                </label>
                <label className="sm:col-span-2 text-[10px] uppercase tracking-widest text-[#8C8882]">Product content selectors
                  <textarea required maxLength={10_000} value={selectorDraft.selectors} onChange={(event) => setSelectorDraft((previous) => ({ ...previous, selectors: event.target.value }))} placeholder="main, .product-details" rows={2} className="mt-2 w-full bg-[#F5F2EF] px-4 py-2.5 text-sm font-mono normal-case tracking-normal" />
                </label>
                <label className="text-[10px] uppercase tracking-widest text-[#8C8882]">Tab trigger selector
                  <input maxLength={2_000} value={selectorDraft.tabSelector} onChange={(event) => setSelectorDraft((previous) => ({ ...previous, tabSelector: event.target.value }))} className="mt-2 w-full bg-[#F5F2EF] px-4 py-2.5 text-sm font-mono normal-case tracking-normal" />
                </label>
                <label className="text-[10px] uppercase tracking-widest text-[#8C8882]">Tab content selector
                  <input maxLength={2_000} value={selectorDraft.tabContentSelector} onChange={(event) => setSelectorDraft((previous) => ({ ...previous, tabContentSelector: event.target.value }))} className="mt-2 w-full bg-[#F5F2EF] px-4 py-2.5 text-sm font-mono normal-case tracking-normal" />
                </label>
                <label className="text-[10px] uppercase tracking-widest text-[#8C8882]">Tab wait (ms)
                  <input type="number" required min="0" max="10000" value={selectorDraft.tabWaitMs} onChange={(event) => setSelectorDraft((previous) => ({ ...previous, tabWaitMs: Number(event.target.value) }))} className="mt-2 w-full bg-[#F5F2EF] px-4 py-2.5 text-sm normal-case tracking-normal" />
                </label>
                <label className="self-end flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={selectorDraft.enabled} onChange={(event) => setSelectorDraft((previous) => ({ ...previous, enabled: event.target.checked }))} /> Enabled
                </label>
              </div>
              <p className="text-xs text-[#8C8882] mt-3">Provide both tab selectors or leave both blank.</p>
              <div className="flex gap-3 mt-4">
                <button type="submit" disabled={busySelectorId !== null} className="px-4 py-2 bg-[#1A1A1A] text-white text-[11px] uppercase disabled:opacity-50">{busySelectorId === (editingSelectorId || "new") ? "Saving…" : editingSelectorId ? "Save Selector" : "Add Selector"}</button>
                {editingSelectorId && <button type="button" onClick={resetSelectorForm} disabled={busySelectorId !== null} className="px-4 py-2 border border-[#E5E2DE] text-[11px] uppercase disabled:opacity-50">Cancel</button>}
              </div>
            </form>
          </section>

          <section className="border-t border-[#E5E2DE] pt-8">
            <h3 className="font-serif text-xl mb-2">Legacy Browser Data</h3>
            <p className="text-sm text-[#8C8882] mb-4">Back up or import attribute rules, site selectors, and non-secret settings. Credentials and old sessions are excluded.</p>
            <div className="flex gap-3">
              <button onClick={exportLegacyData} className="flex items-center gap-2 px-4 py-2 text-[11px] uppercase border border-[#E5E2DE]"><Download className="w-4 h-4" />Export Backup</button>
              <button onClick={() => importInput.current?.click()} className="flex items-center gap-2 px-4 py-2 text-[11px] uppercase border border-[#E5E2DE]"><Upload className="w-4 h-4" />Import Backup</button>
              <input ref={importInput} type="file" accept="application/json,.json" className="hidden" onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void importLegacyData(file);
                event.target.value = "";
              }} />
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
