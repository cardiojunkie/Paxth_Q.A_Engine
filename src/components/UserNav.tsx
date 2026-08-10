import React, { useState, useRef, useEffect } from 'react';
import { User as UserIcon, LogOut, ShieldCheck, ChevronDown } from 'lucide-react';
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

  const handleLogout = () => {
    logout();
    addNotification({
      type: 'info',
      title: 'Logged Out',
      message: 'You have been signed out of Paxth QA Engine.'
    });
  };

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2.5 px-3 py-1.5 rounded-sm border border-[#E5E2DE] hover:border-[#1A1A1A] hover:bg-[#F5F2EF] transition-all bg-white text-left group"
      >
        <div className="w-7 h-7 rounded-sm bg-[#1A1A1A] text-white flex items-center justify-center font-bold text-xs shrink-0 tracking-wider">
          {user.username.charAt(0).toUpperCase()}
        </div>
        <div className="hidden sm:flex flex-col">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-semibold text-[#1A1A1A]">{user.username}</span>
            <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-[#1A1A1A]/10 text-[#1A1A1A] font-bold">
              {user.role}
            </span>
          </div>
        </div>
        <ChevronDown className="w-3.5 h-3.5 text-[#8C8882] group-hover:text-[#1A1A1A] transition-transform duration-200" style={{ transform: isOpen ? 'rotate(180deg)' : 'none' }} />
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-64 bg-white border border-[#E5E2DE] shadow-xl rounded-sm z-50 overflow-hidden py-1">
          <div className="px-4 py-3 border-b border-[#E5E2DE] bg-[#FDFCFB]">
            <p className="text-[10px] uppercase tracking-widest text-[#8C8882] font-medium">Logged in as</p>
            <div className="flex items-center gap-2 mt-1">
              <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
              <span className="text-sm font-bold text-[#1A1A1A]">{user.username}</span>
            </div>
            <p className="text-[11px] text-[#8C8882] mt-1">
              Session active since {new Date(user.loginTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </p>
          </div>

          <div className="p-1">
            <button
              onClick={handleLogout}
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
