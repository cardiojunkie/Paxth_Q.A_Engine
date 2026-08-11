/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from 'react';
import { AttributeSetsModule } from './components/AttributeSetsModule';
import { DashboardModule } from './components/DashboardModule';
import { JobsModule } from './components/JobsModule';
import { LLMSettingsModule } from './components/LLMSettingsModule';
import { NotificationsMenu } from './components/NotificationsMenu';
import { UserNav } from './components/UserNav';
import { LoginScreen } from './components/LoginScreen';
import { AppProvider, useAppContext } from './context/AppContext';
import { cn } from './lib/utils';

type ModuleType = 'dashboard' | 'attribute-sets' | 'jobs' | 'llm-settings';

function MainLayout() {
  const { user, isCheckingSession } = useAppContext();
  const [activeModule, setActiveModule] = useState<ModuleType>('dashboard');

  if (isCheckingSession) {
    return <div className="min-h-screen grid place-items-center bg-[#FDFCFB] text-sm text-[#8C8882]" role="status">Checking session…</div>;
  }

  if (!user) {
    return <LoginScreen />;
  }

  const navItems = [
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'attribute-sets', label: 'Attribute Sets' },
    { id: 'jobs', label: 'Jobs' },
    { id: 'llm-settings', label: 'LLM Settings' },
  ];

  return (
    <div className="h-screen w-full bg-[#FDFCFB] flex flex-col font-sans text-[#1A1A1A] overflow-hidden">
      <nav className="h-20 border-b border-[#E5E2DE] px-8 sm:px-10 flex items-center justify-between shrink-0 bg-white">
        <div className="flex flex-col justify-center">
          <span className="font-serif italic text-2xl tracking-tight leading-none">Project 22</span>
          <div className="flex items-center gap-1.5 mt-1">
            <span className="w-2 h-2 rounded-full inline-block bg-emerald-500" />
            <span className="text-[10px] font-mono tracking-wider uppercase text-[#8C8882]">
              Server Session Active
            </span>
          </div>
        </div>
        
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5 sm:gap-2 overflow-x-auto max-w-[65vw]">
            {navItems.map((item) => (
              <button
                key={item.id}
                onClick={() => setActiveModule(item.id as ModuleType)}
                aria-current={activeModule === item.id ? 'page' : undefined}
                className={cn(
                  "px-3 sm:px-4 py-2 text-[11px] uppercase tracking-widest transition-colors rounded-sm flex items-center gap-1.5",
                  activeModule === item.id 
                    ? "bg-[#1A1A1A] text-white" 
                    : "text-[#8C8882] hover:bg-[#F5F2EF] hover:text-[#1A1A1A]"
                )}
              >
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
        {activeModule === 'attribute-sets' && <AttributeSetsModule />}
        {activeModule === 'jobs' && <JobsModule />}
        {activeModule === 'llm-settings' && <LLMSettingsModule />}
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
