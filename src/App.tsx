/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import { AttributeSetsModule } from './components/AttributeSetsModule';
import { DashboardModule } from './components/DashboardModule';
import { JobsModule } from './components/JobsModule';
import { LLMSettingsModule } from './components/LLMSettingsModule';
import { ScraperModule } from './components/ScraperModule';
import { UsersModule } from './components/UsersModule';
import { NotificationsMenu } from './components/NotificationsMenu';
import { UserNav } from './components/UserNav';
import { LoginScreen } from './components/LoginScreen';
import { AppProvider, useAppContext } from './context/AppContext';
import { cn } from './lib/utils';
import { Shield } from 'lucide-react';

type ModuleType = 'dashboard' | 'scraper' | 'attribute-sets' | 'jobs' | 'llm-settings' | 'users';

function MainLayout() {
  const { user } = useAppContext();
  const [activeModule, setActiveModule] = useState<ModuleType>('dashboard');
  const [dbStatus, setDbStatus] = useState<'checking' | 'connected' | 'disconnected' | 'error'>('checking');

  useEffect(() => {
    let isMounted = true;
    const checkStatus = () => {
      fetch('/api/db-status')
        .then((res) => res.json())
        .then((data) => {
          if (isMounted) {
            if (data.status === 'connected') setDbStatus('connected');
            else setDbStatus('disconnected');
          }
        })
        .catch(() => {
          if (isMounted) setDbStatus('disconnected');
        });
    };

    checkStatus();
    const interval = setInterval(checkStatus, 15000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  if (!user) {
    return <LoginScreen />;
  }

  const isSystemAdmin = user.role === 'admin';

  const navItems = [
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'scraper', label: 'Scraper' },
    { id: 'attribute-sets', label: 'Attribute Sets' },
    { id: 'jobs', label: 'Jobs' },
    { id: 'llm-settings', label: 'LLM Settings' },
    ...(isSystemAdmin ? [{ id: 'users', label: 'Users', adminOnly: true }] : []),
  ];

  return (
    <div className="h-screen w-full bg-[#FDFCFB] flex flex-col font-sans text-[#1A1A1A] overflow-hidden">
      <nav className="h-20 border-b border-[#E5E2DE] px-8 sm:px-10 flex items-center justify-between shrink-0 bg-white">
        <div className="flex flex-col justify-center">
          <span className="font-serif italic text-2xl tracking-tight leading-none">Paxth QA Engine</span>
          <div className="flex items-center gap-1.5 mt-1">
            <span className={cn(
              "w-2 h-2 rounded-full inline-block transition-all",
              dbStatus === "connected" ? "bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.8)]" : 
              dbStatus === "checking" ? "bg-amber-500 animate-pulse" :
              "bg-rose-500 shadow-[0_0_6px_rgba(244,63,94,0.8)]"
            )} />
            <span className="text-[10px] font-mono tracking-wider uppercase text-[#8C8882]">
              {dbStatus === "connected" ? "Supabase Online" : dbStatus === "checking" ? "Supabase Connecting" : "Supabase Offline"}
            </span>
          </div>
        </div>
        
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5 sm:gap-2">
            {navItems.map((item) => (
              <button
                key={item.id}
                onClick={() => setActiveModule(item.id as ModuleType)}
                className={cn(
                  "px-3 sm:px-4 py-2 text-[11px] uppercase tracking-widest transition-colors rounded-sm flex items-center gap-1.5",
                  activeModule === item.id 
                    ? "bg-[#1A1A1A] text-white" 
                    : "text-[#8C8882] hover:bg-[#F5F2EF] hover:text-[#1A1A1A]"
                )}
              >
                {item.adminOnly && (
                  <Shield className="w-3 h-3 text-amber-400" />
                )}
                <span>{item.label}</span>
              </button>
            ))}
          </div>
          
          <div className="w-[1px] h-6 bg-[#E5E2DE]"></div>
          
          <NotificationsMenu />
          <UserNav />
        </div>
      </nav>
      <main className="flex-1 flex overflow-hidden">
        {activeModule === 'dashboard' && <DashboardModule />}
        {activeModule === 'scraper' && <ScraperModule />}
        {activeModule === 'attribute-sets' && <AttributeSetsModule />}
        {activeModule === 'jobs' && <JobsModule />}
        {activeModule === 'llm-settings' && <LLMSettingsModule />}
        {activeModule === 'users' && <UsersModule />}
      </main>
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <MainLayout />
    </AppProvider>
  );
}

