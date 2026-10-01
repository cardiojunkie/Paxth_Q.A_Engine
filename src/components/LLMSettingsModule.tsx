import { useEffect, useState } from 'react';
import { useSettings, type AppSettings } from '../hooks/useSettings';
import { useAppContext } from '../context/AppContext';
import { api } from '../lib/api';
type TestResult = { purpose: 'qa' | 'scrapper'; modelName: string; status: 'testing' | 'passed' | 'failed'; error?: string };
export function LLMSettingsModule() {
  const { settings, saveSettings, isMemoryLoading, memoryError } = useSettings();
  const { user, addNotification } = useAppContext();
  const [draft, setDraft] = useState(settings);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [tests, setTests] = useState<TestResult[]>([]);
  useEffect(() => { if (!dirty) setDraft(settings); }, [settings, dirty]);
  const change = (key: keyof AppSettings, value: string | number) => { setDirty(true); setDraft(prev => ({ ...prev, [key]: value })); setMessage(''); setTests([]); };
  const act = async (test = false) => {
    if (busy) return;
    setBusy(true); setMessage('');
    try {
      if (test) {
        const checks: TestResult[] = [
          { purpose: 'qa', modelName: draft.modelName.trim(), status: 'testing' },
          { purpose: 'scrapper', modelName: draft.scrapperModelName.trim(), status: 'testing' },
        ];
        setTests(checks);
        await Promise.all(checks.map(async check => {
          let result: TestResult;
          try {
            const response = await api<{ success?: boolean }>('/api/chat', { method: 'POST', body: JSON.stringify({ purpose: check.purpose, modelName: check.modelName }) });
            if (response?.success !== true) throw new Error('The server returned an invalid connectivity test response.');
            result = { ...check, status: 'passed' };
          }
          catch (error) { result = { ...check, status: 'failed', error: (error as Error).message }; }
          setTests(previous => previous.map(item => item.purpose === check.purpose ? result : item));
          addNotification({
            type: result.status === 'passed' ? 'success' : 'error',
            title: `${check.purpose === 'qa' ? 'Q&A' : 'Scrapper'} API ${result.status === 'passed' ? 'Connected' : 'Test Failed'}`,
            message: `${check.modelName}: ${result.status === 'passed' ? 'API connection confirmed.' : result.error}`,
          });
        }));
      }
      else { await saveSettings(draft); setDirty(false); setMessage('Settings saved for everyone.'); }
    }
    catch (error) { setMessage((error as Error).message); } finally { setBusy(false); }
  };
  return <section className="flex-1 overflow-auto p-8 bg-[#FDFCFB]">
    <h2 className="text-2xl font-serif mb-4">LLM Settings</h2>
    <p className="mb-4">Provider credentials are configured on the server. {settings.providerConfigured ? 'Provider configured.' : 'Server provider credentials are missing.'}</p>
    <p className="mb-4 text-sm">Test API sends a short connectivity message to both displayed models without saving changes.</p>
    {(message || memoryError) && <p role="status" className="mb-4">{message || memoryError}</p>}
    {tests.map(test => <p role="status" className="mb-2" key={test.purpose}>{test.purpose === 'qa' ? 'Q&A' : 'Scrapper'} ({test.modelName}): {test.status === 'testing' ? 'Testing…' : test.status === 'passed' ? 'Passed.' : `Failed: ${test.error}`}</p>)}
    <fieldset disabled={user?.role !== 'admin' || busy || isMemoryLoading} className="max-w-3xl space-y-4 disabled:opacity-60">
      <label className="block">Q&A model<input className="block border p-2 w-full" value={draft.modelName} onChange={e => change('modelName', e.target.value)} /></label>
      <label className="block">Scrapper model<input className="block border p-2 w-full" value={draft.scrapperModelName} onChange={e => change('scrapperModelName', e.target.value)} /></label>
      {([['temperature', 'Temperature', 0, 1, 0.1], ['maxTokens', 'Maximum output tokens', 1, 65536, 1], ['maxPageContentLength', 'Maximum evidence characters', 1, 200000, 1]] as const).map(([key, label, min, max, step]) => <label className="block" key={key}>{label}<input className="block border p-2" type="number" min={min} max={max} step={step} value={draft[key]} onChange={e => change(key, Number(e.target.value))} /></label>)}
      <label className="block">Shared QA instructions<textarea className="block border p-2 w-full" rows={14} value={draft.qaAgentMemory} onChange={e => change('qaAgentMemory', e.target.value)} /></label>
      <button className="bg-black text-white px-4 py-2 mr-4" onClick={() => void act()}>Save changes</button>
      <button className="border px-4 py-2" disabled={!draft.modelName.trim() || !draft.scrapperModelName.trim()} onClick={() => void act(true)}>Test API</button>
    </fieldset>
  </section>;
}
