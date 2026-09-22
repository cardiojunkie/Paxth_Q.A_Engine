import React, { createContext, useContext, useState, useCallback, ReactNode, useEffect } from 'react';
import { useCatalogData } from '../hooks/useCatalogData';
import { User, UserAccount, UserAccountInput } from '../types';
import { api, ApiError } from '../lib/api';

export interface Job {
  id: string;
  name: string;
  createdAt: string;
  attribute_set: string;
  skus: string[];
  status: 'pending' | 'running' | 'completed' | 'failed';
  tokensUsed?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  timeTaken?: number;
  error?: string | null;
}

export interface AppNotification {
  id: string;
  type: 'success' | 'error' | 'info' | 'warning';
  title: string;
  message: string;
  timestamp: string;
  read: boolean;
}

type AccountResult = { success: boolean; error?: string };
type Catalog = ReturnType<typeof useCatalogData>;
interface AppContextType {
  user: User | null;
  sessionLoading: boolean;
  login: (username: string, password: string) => Promise<AccountResult>;
  logout: () => Promise<boolean>;
  usersList: UserAccount[];
  addUserAccount: (user: UserAccountInput) => Promise<AccountResult>;
  updateUserAccount: (id: string, updates: Partial<UserAccountInput>) => Promise<AccountResult>;
  deleteUserAccount: (id: string) => Promise<AccountResult>;
  skuDataList: Catalog['skuDataList'];
  addParsedData: Catalog['addParsedData'];
  updateSku: Catalog['updateSku'];
  deleteSku: (sku: string) => Promise<boolean>;
  clearData: () => Promise<boolean>;
  removeSkus: Catalog['removeSkus'];
  catalogError: string;
  isLoadingSkuData: boolean;
  jobs: Job[];
  addJobs: (newJobs: Job[]) => Promise<boolean>;
  updateJob: (id: string, updates: Partial<Job>) => Promise<boolean>;
  removeJob: (id: string) => Promise<boolean>;
  refreshData: () => Promise<void>;
  notifications: AppNotification[];
  addNotification: (notification: Omit<AppNotification, 'id' | 'timestamp' | 'read'>) => void;
  markNotificationRead: (id: string) => void;
  clearNotifications: () => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);
const messageOf = (error: unknown) => error instanceof Error ? error.message : 'Request failed. Please retry.';

export function AppProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [usersList, setUsersList] = useState<UserAccount[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const { skuDataList, addParsedData, catalogError, updateSku, removeSkus, refreshCatalog, resetCatalog, isLoading } = useCatalogData(Boolean(user));

  const addNotification = useCallback((notification: Omit<AppNotification, 'id' | 'timestamp' | 'read'>) => {
    setNotifications(prev => [{ ...notification, id: crypto.randomUUID(), timestamp: new Date().toISOString(), read: false }, ...prev]);
  }, []);
  const notifyFailure = useCallback((error: unknown) => {
    addNotification({ type: 'error', title: 'Request failed', message: messageOf(error) });
  }, [addNotification]);

  useEffect(() => {
    // Discard browser-owned credentials; only the server session can establish identity.
    for (const key of ['paxth_qa_user_session', 'paxth_qa_users_db_v1', 'qa-analyzer-settings']) {
      try { localStorage.removeItem(key); } catch { /* Storage may be disabled. */ }
    }
    const expire = () => { setUser(null); setJobs([]); setUsersList([]); };
    window.addEventListener('session-expired', expire);
    let active = true;
    api<User>('/api/auth/me').then(value => { if (active) setUser(value); }).catch(error => {
      if (active && !(error instanceof ApiError && error.status === 401)) notifyFailure(error);
    }).finally(() => { if (active) setSessionLoading(false); });
    return () => { active = false; window.removeEventListener('session-expired', expire); };
  }, [notifyFailure]);

  const refreshJobs = useCallback(async () => { setJobs(await api<Job[]>('/api/jobs')); }, []);
  const refreshData = useCallback(async () => {
    await Promise.all([refreshCatalog(), refreshJobs()]);
  }, [refreshCatalog, refreshJobs]);

  useEffect(() => {
    if (!user) { setJobs([]); setUsersList([]); return; }
    let active = true;
    api<Job[]>('/api/jobs').then(value => { if (active) setJobs(value); }).catch(error => { if (active) notifyFailure(error); });
    if (user.role === 'admin') api<UserAccount[]>('/api/users').then(value => { if (active) setUsersList(value); }).catch(error => { if (active) notifyFailure(error); });
    else setUsersList([]);
    return () => { active = false; };
  }, [user, notifyFailure]);

  const login = useCallback(async (username: string, password: string): Promise<AccountResult> => {
    try {
      setUser(await api<User>('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }));
      return { success: true };
    } catch (error) { return { success: false, error: messageOf(error) }; }
  }, []);

  const logout = useCallback(async () => {
    try { await api('/api/auth/logout', { method: 'POST' }); setUser(null); setJobs([]); setUsersList([]); return true; }
    catch (error) { notifyFailure(error); return false; }
  }, [notifyFailure]);

  const addUserAccount = useCallback(async (newUser: UserAccountInput): Promise<AccountResult> => {
    try {
      const account = await api<UserAccount>('/api/users', { method: 'POST', body: JSON.stringify(newUser) });
      setUsersList(prev => [account, ...prev]);
      return { success: true };
    } catch (error) { return { success: false, error: messageOf(error) }; }
  }, []);

  const updateUserAccount = useCallback(async (id: string, updates: Partial<UserAccountInput>): Promise<AccountResult> => {
    try {
      const account = await api<UserAccount>(`/api/users/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(updates) });
      setUsersList(prev => prev.map(item => item.id === id ? account : item));
      if (id === user?.id) setUser(null); // Account changes revoke every session, including this one.
      return { success: true };
    } catch (error) { return { success: false, error: messageOf(error) }; }
  }, [user?.id]);

  const deleteUserAccount = useCallback(async (id: string): Promise<AccountResult> => {
    try {
      await api(`/api/users/${encodeURIComponent(id)}`, { method: 'DELETE' });
      setUsersList(prev => prev.filter(account => account.id !== id));
      if (id === user?.id) setUser(null);
      return { success: true };
    } catch (error) { return { success: false, error: messageOf(error) }; }
  }, [user?.id]);

  const deleteSku = useCallback((sku: string) => removeSkus([sku]), [removeSkus]);
  const clearData = useCallback(async () => {
    try {
      await api('/api/data', { method: 'DELETE' });
      setJobs([]);
      resetCatalog();
      return true;
    } catch (error) { notifyFailure(error); return false; }
  }, [resetCatalog, notifyFailure]);

  const addJobs = useCallback(async (newJobs: Job[]) => {
    try {
      const saved = await api<Job[]>('/api/jobs', { method: 'POST', body: JSON.stringify(newJobs) });
      setJobs(prev => [...prev, ...saved]);
      return true;
    } catch (error) { notifyFailure(error); return false; }
  }, [notifyFailure]);

  const updateJob = useCallback(async (id: string, updates: Partial<Job>) => {
    try {
      const saved = await api<Job>(`/api/jobs/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(updates) });
      setJobs(prev => prev.map(job => job.id === id ? saved : job));
      return true;
    } catch (error) { notifyFailure(error); return false; }
  }, [notifyFailure]);

  const removeJob = useCallback(async (id: string) => {
    try {
      await api(`/api/jobs/${encodeURIComponent(id)}`, { method: 'DELETE' });
      setJobs(prev => prev.filter(job => job.id !== id));
      return true;
    } catch (error) { notifyFailure(error); return false; }
  }, [notifyFailure]);

  const markNotificationRead = useCallback((id: string) => setNotifications(prev => prev.map(item => item.id === id ? { ...item, read: true } : item)), []);
  const clearNotifications = useCallback(() => setNotifications([]), []);
  return (
    <AppContext.Provider value={{
      user, sessionLoading, login, logout, usersList, addUserAccount, updateUserAccount, deleteUserAccount,
      skuDataList, addParsedData, updateSku, deleteSku, clearData, removeSkus, catalogError, isLoadingSkuData: isLoading,
      jobs, addJobs, updateJob, removeJob, refreshData,
      notifications, addNotification, markNotificationRead, clearNotifications,
    }}>{children}</AppContext.Provider>
  );
}

export function useAppContext() {
  const context = useContext(AppContext);
  if (!context) throw new Error('useAppContext must be used within an AppProvider');
  return context;
}
