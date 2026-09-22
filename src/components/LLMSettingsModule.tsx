import { useEffect, useState } from 'react';
import { useSettings, type AppSettings } from '../hooks/useSettings';
import { useAppContext } from '../context/AppContext';
import { api } from '../lib/api';
export function LLMSettingsModule() {
  const {settings,saveSettings,isMemoryLoading,memoryError}=useSettings();
  const {user}=useAppContext();
  const [draft,setDraft]=useState(settings);
  const [dirty,setDirty]=useState(false);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  useEffect(()=>{if(!dirty)setDraft(settings);},[settings,dirty]);
  const change=(key:keyof AppSettings,value:string|number)=>{setDirty(true);setDraft(prev=>({...prev,[key]:value}));setMessage('');};
  const act=async(test=false)=>{
    setBusy(true);setMessage('');
    try {if(test){await api('/api/chat',{method:'POST',body:'{}'});setMessage('Saved settings passed the QA response check.');}
      else {await saveSettings(draft);setDirty(false);setMessage('Settings saved for everyone.');}}
    catch(error){setMessage((error as Error).message);}finally{setBusy(false);}
  };
  return <section className="flex-1 overflow-auto p-8 bg-[#FDFCFB]">
    <h2 className="text-2xl font-serif mb-4">LLM Settings</h2>
    <p className="mb-4">Provider credentials are configured on the server. {settings.providerConfigured?'Provider configured.':'Server provider credentials are missing.'}</p>
    <p className="mb-4 text-sm">One SKU runs at a time. Transient failures allow up to three attempts within five minutes. Save changes before testing.</p>
    {(message||memoryError)&&<p role="status" className="mb-4">{message||memoryError}</p>}
    <fieldset disabled={user?.role!=='admin'||busy||isMemoryLoading} className="max-w-3xl space-y-4 disabled:opacity-60">
      <label className="block">Model<input className="block border p-2 w-full" value={draft.modelName} onChange={e=>change('modelName',e.target.value)}/></label>
      {([['temperature','Temperature',0,1,0.1],['maxTokens','Maximum output tokens',1,65536,1],['maxPageContentLength','Maximum evidence characters',1,200000,1]] as const).map(([key,label,min,max,step])=><label className="block" key={key}>{label}<input className="block border p-2" type="number" min={min} max={max} step={step} value={draft[key]} onChange={e=>change(key,Number(e.target.value))}/></label>)}
      <label className="block">Shared QA instructions<textarea className="block border p-2 w-full" rows={14} value={draft.qaAgentMemory} onChange={e=>change('qaAgentMemory',e.target.value)}/></label>
      <button className="bg-black text-white px-4 py-2 mr-4" onClick={()=>void act()}>Save changes</button>
      <button className="border px-4 py-2" disabled={dirty||!settings.providerConfigured} onClick={()=>void act(true)}>Test saved settings</button>
    </fieldset>
  </section>;
}
