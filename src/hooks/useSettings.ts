import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { DEFAULT_SETTINGS, editableSettings, normalizeSettings, type AppSettings } from '../lib/providerSettings';
export { normalizeSettings, normalizeMaxTokens } from '../lib/providerSettings';
export type { AppSettings } from '../lib/providerSettings';
export function useSettings() {
  const [settings,setSettings]=useState(DEFAULT_SETTINGS);
  const [isMemoryLoading,setLoading]=useState(true);
  const [memoryError,setError]=useState('');
  useEffect(()=>{
    let active=true;
    try { localStorage.removeItem('qa-analyzer-settings'); } catch { /* Storage can be disabled. */ }
    api<AppSettings>('/api/provider-settings').then(value=>{if(active) setSettings(normalizeSettings(value));})
      .catch(error=>{if(active)setError(error.message);}).finally(()=>{if(active)setLoading(false);});
    return ()=>{active=false;};
  },[]);
  const saveSettings=async(value:AppSettings)=>{
    const saved=await api<AppSettings>('/api/provider-settings',{method:'PUT',body:JSON.stringify(editableSettings(value))});
    setSettings(saved);setError('');
  };
  return {settings,saveSettings,defaultSettings:DEFAULT_SETTINGS,isMemoryLoading,memoryError};
}
