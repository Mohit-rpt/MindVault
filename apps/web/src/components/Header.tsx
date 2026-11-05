import React from 'react';
import { Database, ShieldCheck, Sparkles, Terminal } from 'lucide-react';

interface HeaderProps {
  apiStatus: 'checking' | 'connected' | 'disconnected';
}

export const Header: React.FC<HeaderProps> = ({ apiStatus }) => {
  return (
    <header className="border-b border-vault-800 bg-vault-900/60 backdrop-blur sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center shadow-lg shadow-blue-500/20">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-lg tracking-tight text-white">MindVault</span>
              <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20">
                Phase 0: Foundation
              </span>
            </div>
            <p className="text-xs text-vault-400 hidden sm:block">
              AI-Powered Personal Knowledge Operating System
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {/* Live API Health Probe Badge */}
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-vault-800/80 border border-vault-700/60 text-xs">
            <span
              className={`w-2 h-2 rounded-full ${
                apiStatus === 'connected'
                  ? 'bg-emerald-400 animate-pulse shadow-sm shadow-emerald-400'
                  : apiStatus === 'checking'
                    ? 'bg-amber-400'
                    : 'bg-rose-400'
              }`}
            />
            <span className="text-vault-300 font-mono">
              API:{' '}
              {apiStatus === 'connected'
                ? 'Connected'
                : apiStatus === 'checking'
                  ? 'Checking...'
                  : 'Offline'}
            </span>
          </div>

          <div className="hidden md:flex items-center gap-2 text-xs text-vault-400">
            <span className="flex items-center gap-1">
              <Database className="w-3.5 h-3.5 text-vault-500" /> PostgreSQL + pgvector
            </span>
            <span className="text-vault-700">•</span>
            <span className="flex items-center gap-1">
              <Terminal className="w-3.5 h-3.5 text-vault-500" /> BullMQ
            </span>
            <span className="text-vault-700">•</span>
            <span className="flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5 text-vault-500" /> Evidence-Grounded
            </span>
          </div>
        </div>
      </div>
    </header>
  );
};
