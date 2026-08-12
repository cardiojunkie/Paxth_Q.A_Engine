import React, { useState, useEffect } from "react";
import { useSettings, AppSettings } from "../hooks/useSettings";
import { AlertCircle, Save, RotateCcw, CheckCircle, Play } from "lucide-react";
import { cn } from "../lib/utils";
import { useAppContext } from "../context/AppContext";

export function LLMSettingsModule() {
  const { settings, saveSettings, defaultSettings } = useSettings();
  const { addNotification } = useAppContext();
  const [localSettings, setLocalSettings] = useState<AppSettings>(settings);
  const [isSaved, setIsSaved] = useState(false);
  const [isTesting, setIsTesting] = useState(false);

  useEffect(() => {
    setLocalSettings(settings);
  }, [settings]);

  const handleChange = (field: keyof AppSettings, value: string | number) => {
    setLocalSettings((prev) => ({ ...prev, [field]: value }));
    setIsSaved(false);
  };

  const handleSave = () => {
    saveSettings(localSettings);
    setIsSaved(true);
    addNotification({
      type: "success",
      title: "Settings Saved",
      message: "LLM API settings have been updated successfully."
    });
    setTimeout(() => setIsSaved(false), 2000);
  };

  const handleReset = () => {
    saveSettings(defaultSettings);
    setLocalSettings(defaultSettings);
    addNotification({
      type: "info",
      title: "Settings Reset",
      message: "LLM API settings reset to default values."
    });
  };

  const handleTestAPI = async () => {
    if (!localSettings.baseUrl || !localSettings.apiKey || !localSettings.modelName) {
      addNotification({
        type: "error",
        title: "Missing Fields",
        message: "Please fill in Base URL, Model Name, and API Key to test."
      });
      return;
    }

    setIsTesting(true);
    try {
      const res = await fetch(`/api/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          baseUrl: localSettings.baseUrl,
          apiKey: localSettings.apiKey,
          payload: {
            model: localSettings.modelName,
            temperature: 0.1,
            max_tokens: 10,
            messages: [
              { role: "user", content: "Say hello!" }
            ]
          }
        })
      });

      if (!res.ok) {
        let errorText = await res.text();
        try {
          const parsed = JSON.parse(errorText);
          if (parsed.details) {
            try {
              const detailsParsed = JSON.parse(parsed.details);
              if (detailsParsed.error && detailsParsed.error.message) {
                errorText = detailsParsed.error.message;
              }
            } catch (e2) {
              errorText = parsed.details;
            }
          } else if (parsed.error) {
            errorText = parsed.error;
          }
        } catch (e) {}
        throw new Error(`API returned ${res.status}: ${errorText}`);
      }

      addNotification({
        type: "success",
        title: "API Connection Successful",
        message: "Successfully connected to the LLM API endpoint."
      });
    } catch (err: any) {
      console.error("API Test Error:", err);
      addNotification({
        type: "error",
        title: "API Connection Failed",
        message: err.message || "Failed to connect to the API. Check your settings."
      });
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[#FDFCFB] overflow-hidden">
      <header className="px-10 py-8 border-b border-[#E5E2DE] shrink-0 flex items-end justify-between">
        <div>
          <h2 className="font-serif text-4xl tracking-tighter mb-2 text-[#1A1A1A]">LLM Settings</h2>
          <p className="text-[#8C8882] text-sm leading-relaxed max-w-lg">
            Configure language model endpoints, system prompts, API keys, and parameter overrides for the QA engine.
          </p>
        </div>
        <div className="flex gap-4">
          <button
            onClick={handleTestAPI}
            disabled={isTesting}
            className="flex items-center gap-2 px-4 py-2 text-[11px] uppercase font-bold text-[#8C8882] hover:text-[#1A1A1A] hover:bg-[#F5F2EF] transition-colors rounded-sm disabled:opacity-50 border border-[#E5E2DE]"
          >
            {isTesting ? (
              <span className="w-3.5 h-3.5 rounded-full border-2 border-t-[#1A1A1A] border-[#E5E2DE] animate-spin"></span>
            ) : (
              <Play className="w-3.5 h-3.5" />
            )}
            Test API
          </button>
          <button
            onClick={handleReset}
            className="flex items-center gap-2 px-4 py-2 text-[10px] uppercase font-bold text-[#8C8882] hover:text-[#1A1A1A] transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Reset Defaults
          </button>
          <button
            onClick={handleSave}
            className="flex items-center gap-2 px-6 py-2 text-[11px] uppercase tracking-widest border border-[#1A1A1A] bg-[#1A1A1A] text-white hover:bg-black transition-colors rounded-sm"
          >
            <Save className="w-3.5 h-3.5" />
            {isSaved ? "Saved" : "Save Changes"}
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-10">
        <div className="max-w-4xl space-y-12 pb-10">
          
          {/* Warning Banner */}
          <div className="bg-[#FFF8E6] border border-[#F2DCA5] rounded-sm p-4 flex gap-3 text-[#B37B00]">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <div className="text-sm">
              <strong className="block mb-1">Security Notice</strong>
              <p>
                API keys are stored in your browser's local storage. This is suitable for development or internal 
                operations but not for public production applications. Do not share your screen while keys are visible.
              </p>
            </div>
          </div>

          <section>
            <h3 className="font-serif text-xl mb-6 flex items-center gap-3">
              <span className="w-6 h-px bg-[#E5E2DE] inline-block"></span>
              API Configuration
            </h3>
            <div className="grid grid-cols-2 gap-x-8 gap-y-6">
              <div className="col-span-2">
                <label className="block text-[10px] uppercase tracking-widest text-[#8C8882] mb-2">Provider Format</label>
                <select 
                  value={localSettings.llmProvider}
                  onChange={(e) => handleChange("llmProvider", e.target.value)}
                  className="w-full bg-[#F5F2EF] border border-transparent hover:border-[#E5E2DE] focus:border-[#1A1A1A] outline-none rounded-sm px-4 py-2.5 text-sm transition-colors"
                >
                  <option value="openai-compatible">OpenAI Compatible (AICredits, Together, etc.)</option>
                  <option value="openai">OpenAI (Official)</option>
                  <option value="anthropic">Anthropic</option>
                  <option value="gemini">Google Gemini</option>
                </select>
              </div>

              <div className="col-span-2">
                <label className="block text-[10px] uppercase tracking-widest text-[#8C8882] mb-2">Base URL</label>
                <input 
                  type="text"
                  value={localSettings.baseUrl}
                  onChange={(e) => handleChange("baseUrl", e.target.value)}
                  className="w-full bg-[#F5F2EF] border border-transparent hover:border-[#E5E2DE] focus:border-[#1A1A1A] outline-none rounded-sm px-4 py-2.5 text-sm transition-colors"
                  placeholder="https://api.aicredits.in/v1"
                />
              </div>

              <div>
                <label className="block text-[10px] uppercase tracking-widest text-[#8C8882] mb-2">Model Name</label>
                <input 
                  type="text"
                  value={localSettings.modelName}
                  onChange={(e) => handleChange("modelName", e.target.value)}
                  className="w-full bg-[#F5F2EF] border border-transparent hover:border-[#E5E2DE] focus:border-[#1A1A1A] outline-none rounded-sm px-4 py-2.5 text-sm transition-colors"
                  placeholder="deepseek/deepseek-v4-flash"
                />
              </div>

              <div>
                <label className="block text-[10px] uppercase tracking-widest text-[#8C8882] mb-2">API Key</label>
                <input 
                  type="password"
                  value={localSettings.apiKey}
                  onChange={(e) => handleChange("apiKey", e.target.value)}
                  className="w-full bg-[#F5F2EF] border border-transparent hover:border-[#E5E2DE] focus:border-[#1A1A1A] outline-none rounded-sm px-4 py-2.5 text-sm transition-colors font-mono"
                  placeholder="sk-..."
                />
              </div>
            </div>
          </section>

          <section>
            <h3 className="font-serif text-xl mb-6 flex items-center gap-3">
              <span className="w-6 h-px bg-[#E5E2DE] inline-block"></span>
              Execution & LLM Parameters
            </h3>
            <div className="grid grid-cols-2 gap-x-8 gap-y-6">
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-[#8C8882] mb-2">Max Concurrency</label>
                <input 
                  type="number"
                  min="1"
                  max="20"
                  value={Number.isNaN(localSettings.maxConcurrency) ? '' : localSettings.maxConcurrency}
                  onChange={(e) => handleChange("maxConcurrency", e.target.value === '' ? 1 : parseInt(e.target.value, 10))}
                  className="w-full bg-[#F5F2EF] border border-transparent hover:border-[#E5E2DE] focus:border-[#1A1A1A] outline-none rounded-sm px-4 py-2.5 text-sm transition-colors"
                />
                <p className="text-[10px] text-[#8C8882] mt-2">Number of SKUs to process simultaneously (higher is faster, but risks rate limits).</p>
              </div>

              <div>
                <label className="block text-[10px] uppercase tracking-widest text-[#8C8882] mb-2">Max Retries on Error</label>
                <input 
                  type="number"
                  min="0"
                  max="10"
                  value={Number.isNaN(localSettings.maxRetries) ? '' : localSettings.maxRetries}
                  onChange={(e) => handleChange("maxRetries", e.target.value === '' ? 0 : parseInt(e.target.value, 10))}
                  className="w-full bg-[#F5F2EF] border border-transparent hover:border-[#E5E2DE] focus:border-[#1A1A1A] outline-none rounded-sm px-4 py-2.5 text-sm transition-colors"
                />
                <p className="text-[10px] text-[#8C8882] mt-2">Times to retry processing a SKU if the LLM or scraper fails.</p>
              </div>

              <div>
                <label className="block text-[10px] uppercase tracking-widest text-[#8C8882] mb-2">Temperature ({localSettings.temperature})</label>
                <input 
                  type="range"
                  min="0"
                  max="1"
                  step="0.1"
                  value={localSettings.temperature}
                  onChange={(e) => handleChange("temperature", parseFloat(e.target.value))}
                  className="w-full accent-[#1A1A1A]"
                />
                <p className="text-[10px] text-[#8C8882] mt-2">Lower values ensure more deterministic QA output.</p>
              </div>

              <div>
                <label className="block text-[10px] uppercase tracking-widest text-[#8C8882] mb-2">Max Output Tokens</label>
                <input 
                  type="number"
                  min="1"
                  step="1"
                  value={Number.isNaN(localSettings.maxTokens) ? '' : localSettings.maxTokens}
                  onChange={(e) => handleChange("maxTokens", e.target.value === '' ? 1 : Math.max(parseInt(e.target.value, 10), 1))}
                  className="w-full bg-[#F5F2EF] border border-transparent hover:border-[#E5E2DE] focus:border-[#1A1A1A] outline-none rounded-sm px-4 py-2.5 text-sm transition-colors"
                />
                <p className="text-[10px] text-[#8C8882] mt-2">Maximum generated response length. Your provider and model enforce the supported limit.</p>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
