import React, { createContext, useContext, useState, useCallback, ReactNode, useEffect } from 'react';
import { SkuData, QAStatus, useCatalogData } from '../hooks/useCatalogData';
import { User, UserAccount } from '../types';

export interface Job {
  id: string;
  name: string;
  createdAt: string;
  attribute_set: string;
  skus: string[];
  status: "pending" | "running" | "completed" | "failed";
  tokensUsed?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  timeTaken?: number;
  error?: string;
}

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
  login: (username: string, password: string) => { success: boolean; error?: string };
  logout: () => void;

  usersList: UserAccount[];
  addUserAccount: (user: Omit<UserAccount, 'id' | 'createdAt'>) => { success: boolean; error?: string };
  updateUserAccount: (id: string, updates: Partial<UserAccount>) => { success: boolean; error?: string };
  deleteUserAccount: (id: string) => { success: boolean; error?: string };

  skuDataList: SkuData[];
  addParsedData: (data: SkuData[]) => void;
  updateSku: (sku: string, updates: Partial<SkuData>) => void;
  deleteSku: (sku: string) => void;
  clearData: () => void;
  removeSkus: (skus: string[]) => void;
  updateSkuStatus: (skus: string[], newStatus: QAStatus) => void;
  isLoadingSkuData: boolean;
  
  jobs: Job[];
  addJobs: (newJobs: Job[]) => void;
  updateJob: (id: string, updates: Partial<Job>) => void;
  removeJob: (id: string) => void;

  notifications: AppNotification[];
  addNotification: (notification: Omit<AppNotification, "id" | "timestamp" | "read">) => void;
  markNotificationRead: (id: string) => void;
  clearNotifications: () => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

const DEFAULT_ADMIN_USER = 'Aswath';
const DEFAULT_ADMIN_PASS = 'potusdown@2230';
const SESSION_STORAGE_KEY = 'paxth_qa_user_session';
const USERS_STORAGE_KEY = 'paxth_qa_users_db_v1';

const INITIAL_USERS: UserAccount[] = [
  {
    id: 'user-admin-default',
    username: DEFAULT_ADMIN_USER,
    password: DEFAULT_ADMIN_PASS,
    role: 'admin',
    createdAt: new Date().toISOString(),
  }
];

export function AppProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => {
    try {
      const stored = localStorage.getItem(SESSION_STORAGE_KEY);
      if (stored) {
        return JSON.parse(stored) as User;
      }
    } catch (e) {
      console.error('Failed to parse stored user session', e);
    }
    return null;
  });

  const [usersList, setUsersList] = useState<UserAccount[]>(() => {
    try {
      const storedUsers = localStorage.getItem(USERS_STORAGE_KEY);
      if (storedUsers) {
        const parsed = JSON.parse(storedUsers);
        if (Array.isArray(parsed) && parsed.length > 0) {
          // Ensure default admin exists if deleted accidentally or modified
          const hasAdmin = parsed.some((u: UserAccount) => u.username.toLowerCase() === DEFAULT_ADMIN_USER.toLowerCase());
          if (!hasAdmin) {
            return [...INITIAL_USERS, ...parsed];
          }
          return parsed;
        }
      }
    } catch (e) {
      console.error('Failed to parse stored user database', e);
    }
    return INITIAL_USERS;
  });

  const { skuDataList, addParsedData, updateSkuStatus, updateSku, removeSkus, clearAllData, isLoading } = useCatalogData();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);

  // Fetch initial jobs from database
  useEffect(() => {
    fetch('/api/jobs')
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) {
          setJobs(data);
        }
      })
      .catch(err => {
        console.error("Failed to fetch jobs from database", err);
      });
  }, []);

  // Persist users database changes
  useEffect(() => {
    try {
      localStorage.setItem(USERS_STORAGE_KEY, JSON.stringify(usersList));
    } catch (e) {
      console.error('Failed to save users database', e);
    }
  }, [usersList]);

  const login = useCallback((usernameInput: string, passwordInput: string) => {
    const trimmedUsername = usernameInput.trim();
    if (!trimmedUsername || !passwordInput) {
      return { success: false, error: 'Please enter both username and password.' };
    }

    // Check against usersList
    const matchedAccount = usersList.find(
      u => u.username.toLowerCase() === trimmedUsername.toLowerCase() && u.password === passwordInput
    );

    if (matchedAccount) {
      const authenticatedUser: User = {
        username: matchedAccount.username,
        role: matchedAccount.role,
        loginTime: new Date().toISOString(),
      };

      // Update last login timestamp
      setUsersList(prev => prev.map(u => u.id === matchedAccount.id ? { ...u, lastLogin: new Date().toISOString() } : u));

      setUser(authenticatedUser);
      try {
        localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(authenticatedUser));
      } catch (e) {
        console.error('Failed to save user session', e);
      }
      return { success: true };
    }
    
    return { 
      success: false, 
      error: 'Invalid username or password. Please verify your credentials.' 
    };
  }, [usersList]);

  const logout = useCallback(() => {
    setUser(null);
    try {
      localStorage.removeItem(SESSION_STORAGE_KEY);
    } catch (e) {
      console.error('Failed to remove user session', e);
    }
  }, []);

  const addUserAccount = useCallback((newUser: Omit<UserAccount, 'id' | 'createdAt'>) => {
    const trimmedUsername = newUser.username.trim();
    if (!trimmedUsername) {
      return { success: false, error: 'Username cannot be empty.' };
    }

    if (!newUser.password || newUser.password.length < 4) {
      return { success: false, error: 'Password must be at least 4 characters long.' };
    }

    // Check for existing duplicate username
    const exists = usersList.some(u => u.username.toLowerCase() === trimmedUsername.toLowerCase());
    if (exists) {
      return { success: false, error: `A user with username "${trimmedUsername}" already exists.` };
    }

    const createdAccount: UserAccount = {
      ...newUser,
      username: trimmedUsername,
      id: `user-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      createdAt: new Date().toISOString(),
    };

    setUsersList(prev => [createdAccount, ...prev]);
    return { success: true };
  }, [usersList]);

  const updateUserAccount = useCallback((id: string, updates: Partial<UserAccount>) => {
    if (updates.username) {
      const trimmed = updates.username.trim();
      const duplicate = usersList.some(u => u.id !== id && u.username.toLowerCase() === trimmed.toLowerCase());
      if (duplicate) {
        return { success: false, error: `Username "${trimmed}" is already taken.` };
      }
      updates.username = trimmed;
    }

    setUsersList(prev => prev.map(u => u.id === id ? { ...u, ...updates } : u));
    return { success: true };
  }, [usersList]);

  const deleteUserAccount = useCallback((id: string) => {
    const target = usersList.find(u => u.id === id);
    if (!target) {
      return { success: false, error: 'User not found.' };
    }

    // Do not allow deleting current logged in admin
    if (user && target.username.toLowerCase() === user.username.toLowerCase()) {
      return { success: false, error: 'You cannot delete your own active session account.' };
    }

    // Do not allow deleting default admin Aswath
    if (target.username.toLowerCase() === DEFAULT_ADMIN_USER.toLowerCase()) {
      return { success: false, error: `The default system administrator "${DEFAULT_ADMIN_USER}" cannot be deleted.` };
    }

    setUsersList(prev => prev.filter(u => u.id !== id));
    return { success: true };
  }, [usersList, user]);


  const deleteSku = useCallback((sku: string) => {
    removeSkus([sku]);
  }, [removeSkus]);

  const clearData = useCallback(async () => {
    clearAllData();
    setJobs([]);
    try {
      await fetch('/api/jobs', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ all: true })
      });
    } catch(e) {
      console.error("Failed to clear jobs in database", e);
    }
  }, [clearAllData]);

  const addJobs = useCallback(async (newJobs: Job[]) => {
    setJobs(prev => [...prev, ...newJobs]);
    try {
      await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newJobs)
      });
    } catch(e) {
      console.error("Failed to add jobs to database", e);
    }
  }, []);

  const updateJob = useCallback(async (id: string, updates: Partial<Job>) => {
    setJobs(prev => prev.map(job => job.id === id ? { ...job, ...updates } : job));
    try {
      await fetch(`/api/jobs/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      });
    } catch(e) {
      console.error("Failed to update job in database", e);
    }
  }, []);

  const removeJob = useCallback(async (id: string) => {
    setJobs(prev => prev.filter(job => job.id !== id));
    try {
      await fetch(`/api/jobs/${id}`, {
        method: 'DELETE'
      });
    } catch(e) {
      console.error("Failed to remove job from database", e);
    }
  }, []);

  const addNotification = useCallback((notification: Omit<AppNotification, "id" | "timestamp" | "read">) => {
    setNotifications(prev => [
      {
        ...notification,
        id: Math.random().toString(36).substring(2, 9),
        timestamp: new Date().toISOString(),
        read: false,
      },
      ...prev
    ]);
  }, []);

  const markNotificationRead = useCallback((id: string) => {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
  }, []);

  const clearNotifications = useCallback(() => {
    setNotifications([]);
  }, []);

  return (
    <AppContext.Provider value={{
      user, login, logout,
      usersList, addUserAccount, updateUserAccount, deleteUserAccount,
      skuDataList, addParsedData, updateSku, deleteSku, clearData, removeSkus, updateSkuStatus, isLoadingSkuData: isLoading,
      jobs, addJobs, updateJob, removeJob,
      notifications, addNotification, markNotificationRead, clearNotifications
    }}>
      {children}
    </AppContext.Provider>
  );
}

export function useAppContext() {
  const context = useContext(AppContext);
  if (context === undefined) {
    throw new Error('useAppContext must be used within an AppProvider');
  }
  return context;
}
