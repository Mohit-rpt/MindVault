import React, { useState, useRef, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { ChevronDown, Plus, Check } from 'lucide-react';
import type { WorkspaceDto } from '@mindvault/shared';

interface WorkspaceSelectorProps {
  onOpenCreateModal: () => void;
}

export const WorkspaceSelector: React.FC<WorkspaceSelectorProps> = ({ onOpenCreateModal }) => {
  const { workspaces, activeWorkspace, setActiveWorkspace } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelect = (ws: WorkspaceDto) => {
    setActiveWorkspace(ws);
    setIsOpen(false);
  };

  const getRoleBadge = (role?: string) => {
    switch (role) {
      case 'OWNER':
        return 'bg-purple-500/10 text-purple-400 border-purple-500/20';
      case 'ADMIN':
        return 'bg-blue-500/10 text-blue-400 border-blue-500/20';
      default:
        return 'bg-slate-500/10 text-slate-400 border-slate-500/20';
    }
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-theme-surface border border-theme-border hover:border-theme-accent/50 text-left transition-colors shadow-subtle"
      >
        <div className="h-6 w-6 rounded-lg bg-theme-accent/15 text-theme-accent border border-theme-accent/30 flex items-center justify-center text-xs font-bold font-mono">
          {activeWorkspace?.name.charAt(0).toUpperCase() || 'W'}
        </div>
        <div className="flex flex-col">
          <span className="text-xs font-semibold text-theme-text truncate max-w-[140px] sm:max-w-[200px]">
            {activeWorkspace?.name || 'Select Workspace'}
          </span>
          <span className="text-[10px] text-theme-text-muted font-mono">
            {activeWorkspace?.role || 'MEMBER'}
          </span>
        </div>
        <ChevronDown className="w-3.5 h-3.5 text-theme-text-muted ml-1" />
      </button>

      {isOpen && (
        <div className="absolute left-0 mt-2 w-64 rounded-xl bg-theme-surface border border-theme-border shadow-modal p-1 z-50 animate-fadeIn">
          <div className="px-3 py-2 text-[11px] font-semibold text-theme-text-muted uppercase tracking-wider border-b border-theme-border">
            Workspaces
          </div>
          <div className="max-h-60 overflow-y-auto py-1 custom-scrollbar">
            {workspaces.map((ws) => {
              const isSelected = activeWorkspace?.id === ws.id;
              return (
                <button
                  key={ws.id}
                  onClick={() => handleSelect(ws)}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs transition-colors ${
                    isSelected
                      ? 'bg-theme-surface-secondary text-theme-text font-medium'
                      : 'text-theme-text-secondary hover:text-theme-text hover:bg-theme-surface-hover'
                  }`}
                >
                  <div className="flex items-center gap-2 truncate">
                    <span className="truncate">{ws.name}</span>
                    <span
                      className={`text-[9px] px-1.5 py-0.5 rounded border font-medium ${getRoleBadge(
                        ws.role,
                      )}`}
                    >
                      {ws.role}
                    </span>
                  </div>
                  {isSelected && <Check className="w-3.5 h-3.5 text-theme-accent shrink-0" />}
                </button>
              );
            })}
          </div>

          <div className="pt-1 mt-1 border-t border-theme-border">
            <button
              onClick={() => {
                setIsOpen(false);
                onOpenCreateModal();
              }}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-theme-accent hover:bg-theme-surface-secondary transition-colors"
            >
              <Plus className="w-4 h-4" />
              <span>Create Workspace</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
