import React, { useState, useRef, useEffect } from 'react';
import { LogOut, ShieldCheck, ChevronDown } from 'lucide-react';
import { useAppContext } from '../context/AppContext';

export function UserNav() {
  const { user, logout, addNotification } = useAppContext();
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  if (!user) return null;

  const handleLogout = async () => {
    try {
      await logout();
    } catch (error) {
      addNotification({ type: 'error', title: 'Sign Out Failed', message: error instanceof Error ? error.message : 'Please try again.' });
    }
  };

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        aria-haspopup="menu"
        className="flex items-center gap-2.5 px-3 py-1.5 rounded-sm border border-[#E5E2DE] hover:border-[#1A1A1A] hover:bg-[#F5F2EF] transition-all bg-white text-left group"
      >
        <div className="w-7 h-7 rounded-sm bg-[#1A1A1A] text-white flex items-center justify-center font-bold text-xs shrink-0 tracking-wider">
          {user.username.charAt(0).toUpperCase()}
        </div>
        <div className="hidden sm:flex flex-col">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-semibold text-[#1A1A1A]">{user.username}</span>
          </div>
        </div>
        <ChevronDown className="w-3.5 h-3.5 text-[#8C8882] group-hover:text-[#1A1A1A] transition-transform duration-200" style={{ transform: isOpen ? 'rotate(180deg)' : 'none' }} />
      </button>

      {isOpen && (
        <div role="menu" className="absolute right-0 mt-2 w-64 bg-white border border-[#E5E2DE] shadow-xl rounded-sm z-50 overflow-hidden py-1">
          <div className="px-4 py-3 border-b border-[#E5E2DE] bg-[#FDFCFB]">
            <p className="text-[10px] uppercase tracking-widest text-[#8C8882] font-medium">Logged in as</p>
            <div className="flex items-center gap-2 mt-1">
              <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
              <span className="text-sm font-bold text-[#1A1A1A]">{user.username}</span>
            </div>
            <p className="text-[11px] text-[#8C8882] mt-1">Authenticated server session</p>
          </div>

          <div className="p-1">
            <button
              onClick={handleLogout}
              role="menuitem"
              className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-red-600 hover:bg-red-50 rounded-sm transition-colors text-left"
            >
              <LogOut className="w-4 h-4" />
              <span>Sign Out</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
