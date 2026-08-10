import React, { useState, useRef, useEffect } from "react";
import { Bell, Check, Trash2, Info, CheckCircle, AlertTriangle, XCircle } from "lucide-react";
import { useAppContext } from "../context/AppContext";
import { cn } from "../lib/utils";

export function NotificationsMenu() {
  const { notifications, markNotificationRead, clearNotifications } = useAppContext();
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  
  const unreadCount = notifications.filter(n => !n.read).length;

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const getIcon = (type: string) => {
    switch (type) {
      case "success": return <CheckCircle className="w-4 h-4 text-green-500" />;
      case "error": return <XCircle className="w-4 h-4 text-red-500" />;
      case "warning": return <AlertTriangle className="w-4 h-4 text-orange-500" />;
      default: return <Info className="w-4 h-4 text-blue-500" />;
    }
  };

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 text-[#8C8882] hover:text-[#1A1A1A] hover:bg-[#F5F2EF] rounded-sm transition-colors"
      >
        <Bell className="w-5 h-5" />
        {unreadCount > 0 && (
          <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full"></span>
        )}
      </button>

      {isOpen && (
        <div className="absolute top-full right-0 mt-2 w-80 bg-white border border-[#E5E2DE] rounded-sm shadow-xl z-50 overflow-hidden flex flex-col max-h-[400px]">
          <div className="p-3 border-b border-[#E5E2DE] bg-[#F5F2EF] flex items-center justify-between shrink-0">
            <h4 className="text-[11px] uppercase tracking-widest font-bold text-[#1A1A1A]">Notifications</h4>
            {notifications.length > 0 && (
              <button 
                onClick={clearNotifications}
                className="text-[#8C8882] hover:text-red-600 transition-colors"
                title="Clear all"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          
          <div className="overflow-y-auto flex-1 p-2 space-y-1">
            {notifications.length === 0 ? (
              <div className="text-center p-6 text-[#8C8882] text-sm">
                No new notifications
              </div>
            ) : (
              notifications.map((notification) => (
                <div 
                  key={notification.id} 
                  className={cn(
                    "p-3 rounded-sm border transition-colors relative cursor-pointer",
                    notification.read 
                      ? "bg-transparent border-transparent opacity-70" 
                      : "bg-[#FDFCFB] border-[#E5E2DE] shadow-sm"
                  )}
                  onClick={() => markNotificationRead(notification.id)}
                >
                  <div className="flex gap-3 items-start">
                    <div className="mt-0.5 shrink-0">
                      {getIcon(notification.type)}
                    </div>
                    <div className="flex-1 pr-6">
                      <h5 className={cn(
                        "text-xs font-bold mb-1", 
                        !notification.read ? "text-[#1A1A1A]" : "text-[#8C8882]"
                      )}>
                        {notification.title}
                      </h5>
                      <p className="text-[11px] text-[#8C8882] leading-snug">
                        {notification.message}
                      </p>
                      <span className="text-[9px] uppercase tracking-widest text-[#8C8882]/70 block mt-2">
                        {new Date(notification.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                  </div>
                  {!notification.read && (
                    <div className="absolute top-3 right-3 w-1.5 h-1.5 rounded-full bg-blue-500"></div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
