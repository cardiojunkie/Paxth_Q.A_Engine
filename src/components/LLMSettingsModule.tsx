import { useEffect, useState } from 'react';
import { useSettings, type AppSettings } from '../hooks/useSettings';
import { useAppContext } from '../context/AppContext';
import { api } from '../lib/api';
type TestResult = { modelName: string; status: 'testing' | 'passed' | 'failed'; error?: string };
export function LLMSettingsModule() {
  const { settings, saveSettings, isMemoryLoading, memoryError } = useSettings();
  const { user, addNotification } = useAppContext();
  const [draft, setDraft] = useState(settings);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  useEffect(() => { if (!dirty) setDraft(settings); }, [settings, dirty]);
  const change = (key: keyof AppSettings, value: string | number) => { setDirty(true); setDraft(prev => ({ ...prev, [key]: value })); setMessage(''); setTestResult(null); };
  const act = async (test = false) => {
    if (busy) return;
    setBusy(true); setMessage('');
    try {
      if (test) {
        const modelName = draft.modelName.trim();
        setTestResult({ modelName, status: 'testing' });
        let result: TestResult;
        try {
          const response = await api<{ success?: boolean }>('/api/chat', { method: 'POST', body: JSON.stringify({ modelName }) });
          if (response?.success !== true) throw new Error('The server returned an invalid connectivity test response.');
          result = { modelName, status: 'passed' };
        } catch (error) { result = { modelName, status: 'failed', error: (error as Error).message }; }
        setTestResult(result);
        addNotification({
          type: result.status === 'passed' ? 'success' : 'error',
          title: `Q&A API ${result.status === 'passed' ? 'Connected' : 'Test Failed'}`,
          message: `${modelName}: ${result.status === 'passed' ? 'API connection confirmed.' : result.error}`,
        });
      }
      else { await saveSettings(draft); setDirty(false); setMessage('Settings saved for everyone.'); }
    }
    catch (error) { setMessage((error as Error).message); } finally { setBusy(false); }
  };
  return <section className="flex-1 overflow-auto p-8 bg-[#FDFCFB]">
    <h2 className="text-2xl font-serif mb-4">LLM Settings</h2>
    <p className="mb-4">Provider credentials are configured on the server. {settings.providerConfigured ? 'Provider configured.' : 'Server provider credentials are missing.'}</p>
    <p className="mb-4 text-sm">Test API checks the displayed Q&A model without saving changes. Scraping uses no model or provider credentials.</p>
    {(message || memoryError) && <p role="status" className="mb-4">{message || memoryError}</p>}
    {testResult && <p role="status" className="mb-2">Q&A ({testResult.modelName}): {testResult.status === 'testing' ? 'Testing…' : testResult.status === 'passed' ? 'Passed.' : `Failed: ${testResult.error}`}</p>}
    <fieldset disabled={user?.role !== 'admin' || busy || isMemoryLoading} className="max-w-3xl space-y-4 disabled:opacity-60">
      <label className="block">Q&A model<input className="block border p-2 w-full" value={draft.modelName} onChange={e => change('modelName', e.target.value)} /></label>
      {([['temperature', 'Temperature', 0, 1, 0.1], ['maxTokens', 'Maximum output tokens', 1, 65536, 1], ['maxPageContentLength', 'Maximum evidence characters', 1, 200000, 1]] as const).map(([key, label, min, max, step]) => <label className="block" key={key}>{label}<input className="block border p-2" type="number" min={min} max={max} step={step} value={draft[key]} onChange={e => change(key, Number(e.target.value))} /></label>)}
      <label className="block">Shared QA instructions<textarea className="block border p-2 w-full" rows={14} value={draft.qaAgentMemory} onChange={e => change('qaAgentMemory', e.target.value)} /></label>
      <button className="bg-black text-white px-4 py-2 mr-4" onClick={() => void act()}>Save changes</button>
      <button className="border px-4 py-2" disabled={!draft.modelName.trim()} onClick={() => void act(true)}>Test API</button>
    </fieldset>
  </section>;
}
