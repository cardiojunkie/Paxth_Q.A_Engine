import React, { useState } from 'react';
import { Shield, Lock, User, Eye, EyeOff, ArrowRight, AlertCircle } from 'lucide-react';
import { useAppContext } from '../context/AppContext';

export function LoginScreen() {
  const { login, addNotification } = useAppContext();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);
    const result = await login(username, password);
    setIsLoading(false);
    if (result.success) {
      setPassword('');
      addNotification({ type: 'success', title: 'Signed in', message: `Welcome, ${username.trim()}.` });
    } else setError(result.error || 'Invalid credentials');
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
              Enter your credentials to access the catalog QA engine & rules suite.
            </p>
          </div>

          {/* Error Banner */}
          {error && (
            <div className="mb-6 p-3.5 bg-red-50 border border-red-200 rounded-sm text-red-700 text-xs flex items-start gap-2.5 animate-shake">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <div className="flex-1">
                <span className="font-semibold block mb-0.5">Authentication Failed</span>
                <span className="opacity-90">{error}</span>
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Username field */}
            <div>
              <label htmlFor="username" className="block text-[11px] uppercase tracking-widest font-bold text-[#1A1A1A] mb-1.5">
                Username
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
                  autoComplete="current-password"
                  type={showPassword ? 'text' : 'password'}
                  required
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


        </div>
      </div>

      {/* Footer */}
      <div className="w-full max-w-md text-center text-[11px] text-[#8C8882] z-10">
        <p>Paxth Enterprise QA Automation & Catalog Engine</p>
        <p className="text-[10px] text-[#8C8882]/70 mt-1">Authorized Access Only • Sessions expire after eight hours</p>
      </div>
    </div>
  );
}
