import React from 'react';
import { useAuth } from '../context/AuthContext';
import { WorkspaceSelector } from './workspace/WorkspaceSelector';
import { Sparkles, LogOut } from 'lucide-react';

interface NavbarProps {
  onOpenCreateModal: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({ onOpenCreateModal }) => {
  const { user, logout } = useAuth();

  return (
    <header className="border-b border-vault-800 bg-vault-900/60 backdrop-blur sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center shadow-lg shadow-blue-500/20">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <span className="font-bold text-lg tracking-tight text-white hidden sm:inline">
              MindVault
            </span>
          </div>

          <div className="h-5 w-px bg-vault-800 mx-1 hidden sm:block" />

          {/* Workspace Dropdown */}
          <WorkspaceSelector onOpenCreateModal={onOpenCreateModal} />
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden sm:flex flex-col text-right">
            <span className="text-xs font-semibold text-white">{user?.name}</span>
            <span className="text-[11px] text-vault-400 font-mono">{user?.email}</span>
          </div>

          <button
            onClick={logout}
            title="Log Out"
            className="p-2 rounded-lg text-vault-400 hover:text-white hover:bg-vault-800 transition-colors border border-vault-800"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </header>
  );
};
