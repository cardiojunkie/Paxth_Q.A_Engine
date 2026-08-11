import React, { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { apiFetch } from "../lib/api";
import { type SkuData, useCatalogData } from "../hooks/useCatalogData";
import { type User } from "../types";

export interface Job {
  id: string;
  name: string;
  createdAt: string;
  attribute_set: string;
  skus: string[];
  status: "pending" | "queued" | "running" | "completed" | "completed_with_errors" | "failed" | "stopped";
  progress?: { processed: number; total: number; currentSku?: string };
  tokensUsed?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  timeTaken?: number;
  error?: string | null;
  queuedAt?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
}

export type NewJob = Pick<Job, "name" | "attribute_set" | "skus">;

export interface AppNotification {
  id: string;
  type: "success" | "error" | "info" | "warning";
  title: string;
  message: string;
  timestamp: string;
  read: boolean;
}

interface AppContextType {
  user: User | null;
  isCheckingSession: boolean;
  login: (username: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  skuDataList: SkuData[];
  addParsedData: (data: SkuData[]) => Promise<void>;
  clearData: () => Promise<void>;
  removeSkus: (skus: string[]) => Promise<void>;
  isLoadingSkuData: boolean;
  jobs: Job[];
  addJob: (job: NewJob) => Promise<void>;
  queueJobs: (ids: string[]) => Promise<void>;
  stopJob: (id: string) => Promise<void>;
  removeJob: (id: string) => Promise<void>;
  getJobResults: (id: string) => Promise<SkuData[]>;
  refreshJobs: () => Promise<void>;
  notifications: AppNotification[];
  addNotification: (notification: Omit<AppNotification, "id" | "timestamp" | "read">) => void;
  markNotificationRead: (id: string) => void;
  clearNotifications: () => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);
type SessionResponse = { authenticated: true; username: string };

function removeLegacyCredentials() {
  localStorage.removeItem("paxth_qa_user_session");
  localStorage.removeItem("paxth_qa_users_db_v1");
  localStorage.removeItem("lastFileName");
  const rawSettings = localStorage.getItem("qa-analyzer-settings");
  if (!rawSettings) return;
  try {
    const settings = JSON.parse(rawSettings);
    delete settings.apiKey;
    localStorage.setItem("qa-analyzer-settings", JSON.stringify(settings));
  } catch {
    localStorage.removeItem("qa-analyzer-settings");
  }
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const catalog = useCatalogData(Boolean(user));

  useEffect(() => {
    removeLegacyCredentials();
    apiFetch<SessionResponse>("/api/auth/session")
      .then((session) => setUser({ username: session.username }))
      .catch(() => setUser(null))
      .finally(() => setIsCheckingSession(false));
  }, []);

  useEffect(() => {
    const unauthorize = () => setUser(null);
    window.addEventListener("paxth:unauthorized", unauthorize);
    return () => window.removeEventListener("paxth:unauthorized", unauthorize);
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    try {
      await apiFetch("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const session = await apiFetch<SessionResponse>("/api/auth/session");
      setUser({ username: session.username });
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : "Sign in failed." };
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiFetch("/api/auth/logout", { method: "POST", body: "{}" });
    } finally {
      setUser(null);
      setJobs([]);
    }
  }, []);

  const refreshJobs = useCallback(async () => {
    if (!user) return;
    const nextJobs = await apiFetch<Job[]>("/api/jobs");
    setJobs(nextJobs);
    await catalog.refresh(true);
  }, [user, catalog.refresh]);

  useEffect(() => {
    if (!user) {
      setJobs([]);
      return;
    }
    void refreshJobs().catch((error) => console.error("Failed to fetch jobs", error));
    const timer = window.setInterval(() => {
      void refreshJobs().catch((error) => console.error("Failed to poll jobs", error));
    }, 2000);
    return () => window.clearInterval(timer);
  }, [user, refreshJobs]);

  const addJob = useCallback(async (newJob: NewJob) => {
    await apiFetch("/api/jobs", { method: "POST", body: JSON.stringify(newJob) });
    await refreshJobs();
  }, [refreshJobs]);

  const queueJobs = useCallback(async (ids: string[]) => {
    await apiFetch("/api/jobs/run", { method: "POST", body: JSON.stringify({ ids }) });
    await refreshJobs();
  }, [refreshJobs]);

  const stopJob = useCallback(async (id: string) => {
    await apiFetch(`/api/jobs/${encodeURIComponent(id)}/stop`, { method: "POST", body: "{}" });
    await refreshJobs();
  }, [refreshJobs]);

  const removeJob = useCallback(async (id: string) => {
    await apiFetch(`/api/jobs/${encodeURIComponent(id)}`, { method: "DELETE" });
    setJobs((previous) => previous.filter((job) => job.id !== id));
  }, []);

  const getJobResults = useCallback((id: string) =>
    apiFetch<SkuData[]>(`/api/jobs/${encodeURIComponent(id)}/results`), []);

  const clearData = useCallback(async () => {
    await catalog.clearAllData();
  }, [catalog.clearAllData]);

  const addNotification = useCallback((notification: Omit<AppNotification, "id" | "timestamp" | "read">) => {
    setNotifications((previous) => [{
      ...notification,
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      read: false,
    }, ...previous]);
  }, []);

  return <AppContext.Provider value={{
    user,
    isCheckingSession,
    login,
    logout,
    skuDataList: catalog.skuDataList,
    addParsedData: catalog.addParsedData,
    clearData,
    removeSkus: catalog.removeSkus,
    isLoadingSkuData: catalog.isLoading,
    jobs,
    addJob,
    queueJobs,
    stopJob,
    removeJob,
    getJobResults,
    refreshJobs,
    notifications,
    addNotification,
    markNotificationRead: (id) => setNotifications((previous) => previous.map((item) => item.id === id ? { ...item, read: true } : item)),
    clearNotifications: () => setNotifications([]),
  }}>
    {children}
  </AppContext.Provider>;
}

export function useAppContext() {
  const context = useContext(AppContext);
  if (!context) throw new Error("useAppContext must be used within an AppProvider");
  return context;
}
