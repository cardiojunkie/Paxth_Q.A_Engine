import React, { useState } from 'react';
import { Shield, Lock, User, Eye, EyeOff, ArrowRight, AlertCircle, Key, CheckCircle2, Download } from 'lucide-react';
import { useAppContext } from '../context/AppContext';

export function LoginScreen() {
  const { login, addNotification } = useAppContext();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [hasLegacyData] = useState(() => ["qa-analyzer-attribute-sets", "qa-analyzer-site-selectors", "qa-analyzer-settings"].some((key) => localStorage.getItem(key)));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      const result = await login(username, password);
      setIsLoading(false);

      if (result.success) {
        addNotification({
          type: 'success',
          title: 'Welcome back',
          message: 'Successfully authenticated.'
        });
      } else {
        setError(result.error || 'Invalid credentials');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const downloadLegacyBackup = () => {
    const parse = (key: string, fallback: unknown) => {
      try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); }
      catch { return fallback; }
    };
    const rawSettings = parse("qa-analyzer-settings", {}) as Record<string, unknown>;
    const { apiKey: _redacted, ...settings } = rawSettings;
    const body = JSON.stringify({
      version: 1,
      exportedAt: new Date().toISOString(),
      attributeSets: parse("qa-analyzer-attribute-sets", []),
      siteSelectors: parse("qa-analyzer-site-selectors", []),
      settings,
    }, null, 2);
    if (new Blob([body]).size > 5 * 1024 * 1024) {
      setError("Legacy browser data exceeds the 5 MiB backup limit.");
      return;
    }
    const url = URL.createObjectURL(new Blob([body], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "paxth-legacy-browser-data.json";
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen w-full bg-[#FDFCFB] flex flex-col justify-between items-center p-6 relative font-sans text-[#1A1A1A] overflow-y-auto">
      {/* Background Subtle Grid Pattern */}
      <div 
        className="absolute inset-0 pointer-events-none opacity-[0.03]" 
        style={{
          backgroundImage: `radial-gradient(#1A1A1A 1px, transparent 1px)`,
          backgroundSize: '24px 24px'
        }}
      />

      {/* Top Bar Header Branding */}
      <div className="w-full max-w-5xl flex items-center justify-between z-10 py-2">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-[#1A1A1A] text-white flex items-center justify-center font-serif text-xl italic font-bold rounded-sm shadow-sm">
            P
          </div>
          <div>
            <span className="font-serif italic text-xl tracking-tight text-[#1A1A1A]">Project 22</span>
            <span className="text-[10px] uppercase tracking-widest text-[#8C8882] block">By Paxth Automation Solutions</span>
          </div>
        </div>

        <div className="hidden sm:flex items-center gap-2 text-xs text-[#8C8882] bg-white border border-[#E5E2DE] px-3 py-1.5 rounded-sm">
          <Shield className="w-3.5 h-3.5 text-emerald-600" />
          <span>v2.4 Enterprise Edition</span>
        </div>
      </div>

      {/* Main Login Card Container */}
      <div className="w-full max-w-md my-auto z-10 pt-6 pb-8">
        <div className="bg-white border border-[#E5E2DE] rounded-sm shadow-xl p-8 sm:p-10 relative overflow-hidden">
          {/* Header */}
          <div className="mb-8 text-center">
            <div className="w-12 h-12 bg-[#F5F2EF] border border-[#E5E2DE] rounded-full flex items-center justify-center mx-auto mb-4 text-[#1A1A1A]">
              <Lock className="w-5 h-5" />
            </div>
            <h1 className="text-2xl font-serif font-normal text-[#1A1A1A] tracking-tight">System Sign In</h1>
            <p className="text-xs text-[#8C8882] mt-1.5 leading-relaxed">
              Enter your admin credentials to access the catalog QA engine & rules suite.
            </p>
          </div>

          {/* Error Banner */}
          {error && (
            <div role="alert" className="mb-6 p-3.5 bg-red-50 border border-red-200 rounded-sm text-red-700 text-xs flex items-start gap-2.5 animate-shake">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <div className="flex-1">
                <span className="font-semibold block mb-0.5">Authentication Failed</span>
                <span className="opacity-90">{error}</span>
              </div>
            </div>
          )}

          {/* Server-managed credential notice */}
          <div className="mb-6 bg-[#FDFCFB] border border-[#E5E2DE] p-3 rounded-sm flex items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2 text-[#8C8882] overflow-hidden">
              <Key className="w-4 h-4 text-[#1A1A1A] shrink-0" />
              <span>Credentials are verified securely by the server.</span>
            </div>
          </div>

          {hasLegacyData && <button type="button" onClick={downloadLegacyBackup} className="mb-6 w-full flex items-center justify-center gap-2 border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <Download className="w-4 h-4" /> Download legacy browser-data backup
          </button>}

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Username field */}
            <div>
              <label htmlFor="username" className="block text-[11px] uppercase tracking-widest font-bold text-[#1A1A1A] mb-1.5">
                Username / Admin ID
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-[#8C8882]">
                  <User className="w-4 h-4" />
                </div>
                <input
                  id="username"
                  type="text"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="username"
                  placeholder="Username"
                  className="w-full pl-10 pr-3.5 py-2.5 bg-white border border-[#E5E2DE] rounded-sm text-sm text-[#1A1A1A] placeholder-[#8C8882]/60 focus:outline-none focus:border-[#1A1A1A] focus:ring-1 focus:ring-[#1A1A1A] transition-all"
                />
              </div>
            </div>

            {/* Password field */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label htmlFor="password-input" className="block text-[11px] uppercase tracking-widest font-bold text-[#1A1A1A]">
                  Password
                </label>
              </div>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-[#8C8882]">
                  <Lock className="w-4 h-4" />
                </div>
                <input
                  id="password-input"
                  type={showPassword ? 'text' : 'password'}
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  className="w-full pl-10 pr-10 py-2.5 bg-white border border-[#E5E2DE] rounded-sm text-sm text-[#1A1A1A] placeholder-[#8C8882]/60 focus:outline-none focus:border-[#1A1A1A] focus:ring-1 focus:ring-[#1A1A1A] transition-all font-mono"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-[#8C8882] hover:text-[#1A1A1A] transition-colors"
                  title={showPassword ? "Hide password" : "Show password"}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-3 px-4 bg-[#1A1A1A] hover:bg-[#333333] text-white rounded-sm text-xs uppercase tracking-widest font-bold transition-all flex items-center justify-center gap-2 shadow-sm disabled:opacity-70 group"
            >
              {isLoading ? (
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <>
                  <span>Sign In to Engine</span>
                  <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
                </>
              )}
            </button>
          </form>

          {/* Session summary */}
          <div className="mt-8 pt-6 border-t border-[#E5E2DE] text-[11px] text-[#8C8882] space-y-2 bg-[#FDFCFB] -mx-8 -mb-8 p-6">
            <p className="font-semibold text-[#1A1A1A] flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
              Secure server session
            </p>
            <p>Your password is never stored in this browser.</p>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="w-full max-w-md text-center text-[11px] text-[#8C8882] z-10">
        <p>Paxth Enterprise QA Automation & Catalog Engine</p>
        <p className="text-[10px] text-[#8C8882]/70 mt-1">Authorized Access Only • All session activity logged</p>
      </div>
    </div>
  );
}
