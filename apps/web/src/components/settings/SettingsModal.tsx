import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useTheme, type AppTheme } from '../../context/ThemeContext';
import {
  X,
  Palette,
  Bot,
  Users,
  Shield,
  Laptop,
  Check,
  Sun,
  Moon,
  AlertCircle,
  Loader2,
  Trash2,
} from 'lucide-react';
import type { ApiResponse, SessionDto, WorkspaceDto } from '@mindvault/shared';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
  const { user, activeWorkspace, accessToken, setActiveWorkspace, refreshWorkspaces, logout } =
    useAuth();
  const { theme, setTheme } = useTheme();

  const [activeTab, setActiveTab] = useState<'appearance' | 'models' | 'workspace' | 'account'>(
    'appearance',
  );

  const [sessions, setSessions] = useState<SessionDto[]>([]);
  const [workspaceDetails, setWorkspaceDetails] = useState<WorkspaceDto | null>(null);
  const [workspaceName, setWorkspaceName] = useState('');
  const [isUpdatingWorkspace, setIsUpdatingWorkspace] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Load workspace details & sessions when opened
  useEffect(() => {
    if (!isOpen || !accessToken || !activeWorkspace) return;

    let mounted = true;
    async function loadData() {
      try {
        const [wsRes, sesRes] = await Promise.all([
          fetch(`/api/workspaces/${activeWorkspace?.id}`, {
            headers: { Authorization: `Bearer ${accessToken}` },
          }),
          fetch('/api/auth/sessions', {
            headers: { Authorization: `Bearer ${accessToken}` },
          }),
        ]);

        if (wsRes.ok && mounted) {
          const wsJson: ApiResponse<WorkspaceDto> = await wsRes.json();
          if (wsJson.data) {
            setWorkspaceDetails(wsJson.data);
            setWorkspaceName(wsJson.data.name);
          }
        }

        if (sesRes.ok && mounted) {
          const sesJson: ApiResponse<SessionDto[]> = await sesRes.json();
          if (sesJson.data) {
            setSessions(sesJson.data);
          }
        }
      } catch {
        // Best effort
      }
    }

    loadData();
    return () => {
      mounted = false;
    };
  }, [isOpen, accessToken, activeWorkspace]);

  if (!isOpen) return null;

  const handleUpdateWorkspace = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeWorkspace || !workspaceName.trim()) return;

    setIsUpdatingWorkspace(true);
    setMessage(null);

    try {
      const res = await fetch(`/api/workspaces/${activeWorkspace.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ name: workspaceName.trim() }),
      });

      const json: ApiResponse<WorkspaceDto> = await res.json();
      if (res.ok && json.data) {
        setActiveWorkspace(json.data);
        await refreshWorkspaces();
        setMessage({ text: 'Workspace name updated successfully.', type: 'success' });
      } else {
        throw new Error(json.error?.message || 'Failed to update workspace');
      }
    } catch (err) {
      setMessage({
        text: err instanceof Error ? err.message : 'Update failed',
        type: 'error',
      });
    } finally {
      setIsUpdatingWorkspace(false);
    }
  };

  const handleRevokeSession = async (sessionId: string) => {
    try {
      const res = await fetch(`/api/auth/sessions/${sessionId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (res.ok) {
        setSessions((prev) => prev.filter((s) => s.id !== sessionId));
        setMessage({ text: 'Session revoked successfully.', type: 'success' });
      }
    } catch {
      setMessage({ text: 'Failed to revoke session.', type: 'error' });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 animate-fadeIn">
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm transition-opacity" onClick={onClose} />

      {/* Modal Surface */}
      <div className="relative w-full max-w-2xl bg-theme-surface border border-theme-border rounded-2xl shadow-modal overflow-hidden flex flex-col md:flex-row h-[560px] max-h-[90vh] z-10 text-theme-text">
        {/* Left Settings Navigation Sidebar */}
        <div className="w-full md:w-52 border-b md:border-b-0 md:border-r border-theme-border bg-theme-surface-secondary/50 p-3 space-y-1 shrink-0">
          <div className="px-3 py-2 text-xs font-semibold text-theme-text tracking-tight flex items-center justify-between">
            <span>Settings</span>
          </div>

          <button
            onClick={() => {
              setActiveTab('appearance');
              setMessage(null);
            }}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium transition-colors ${
              activeTab === 'appearance'
                ? 'bg-theme-surface text-theme-text shadow-subtle border border-theme-border/60'
                : 'text-theme-text-secondary hover:text-theme-text hover:bg-theme-surface-hover'
            }`}
          >
            <Palette className="w-4 h-4 text-theme-accent" />
            <span>Appearance</span>
          </button>

          <button
            onClick={() => {
              setActiveTab('models');
              setMessage(null);
            }}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium transition-colors ${
              activeTab === 'models'
                ? 'bg-theme-surface text-theme-text shadow-subtle border border-theme-border/60'
                : 'text-theme-text-secondary hover:text-theme-text hover:bg-theme-surface-hover'
            }`}
          >
            <Bot className="w-4 h-4 text-theme-accent" />
            <span>AI & Models</span>
          </button>

          <button
            onClick={() => {
              setActiveTab('workspace');
              setMessage(null);
            }}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium transition-colors ${
              activeTab === 'workspace'
                ? 'bg-theme-surface text-theme-text shadow-subtle border border-theme-border/60'
                : 'text-theme-text-secondary hover:text-theme-text hover:bg-theme-surface-hover'
            }`}
          >
            <Users className="w-4 h-4 text-theme-accent" />
            <span>Workspace</span>
          </button>

          <button
            onClick={() => {
              setActiveTab('account');
              setMessage(null);
            }}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium transition-colors ${
              activeTab === 'account'
                ? 'bg-theme-surface text-theme-text shadow-subtle border border-theme-border/60'
                : 'text-theme-text-secondary hover:text-theme-text hover:bg-theme-surface-hover'
            }`}
          >
            <Shield className="w-4 h-4 text-theme-accent" />
            <span>Account & Security</span>
          </button>
        </div>

        {/* Right Settings Content Area */}
        <div className="flex-1 flex flex-col min-w-0 h-full">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-theme-border/60">
            <h3 className="text-sm font-semibold capitalize text-theme-text">
              {activeTab === 'appearance' && 'Appearance & Themes'}
              {activeTab === 'models' && 'AI Model Configuration'}
              {activeTab === 'workspace' && 'Workspace Settings'}
              {activeTab === 'account' && 'Account & Security'}
            </h3>
            <button
              onClick={onClose}
              className="p-1 rounded-lg text-theme-text-muted hover:text-theme-text hover:bg-theme-surface-secondary transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Feedback banner */}
          {message && (
            <div
              className={`mx-6 mt-3 p-2.5 rounded-xl text-xs flex items-center gap-2 border ${
                message.type === 'success'
                  ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20'
                  : 'bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/20'
              }`}
            >
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{message.text}</span>
            </div>
          )}

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar text-xs">
            {/* 1. APPEARANCE TAB */}
            {activeTab === 'appearance' && (
              <div className="space-y-5">
                <div>
                  <h4 className="font-medium text-theme-text text-sm mb-1">Theme Selection</h4>
                  <p className="text-theme-text-secondary text-xs">
                    Choose between MindVault&apos;s signature Warm Cream or Dark Graphite palettes.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  {/* Warm Cream Card */}
                  <div
                    onClick={() => setTheme('cream')}
                    className={`cursor-pointer rounded-2xl border p-4 transition-all space-y-3 ${
                      theme === 'cream'
                        ? 'border-theme-accent ring-2 ring-theme-accent/30 bg-[#F7F5F0] text-[#252521] shadow-subtle'
                        : 'border-theme-border bg-theme-surface-secondary/40 hover:border-theme-border/80'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Sun className="w-4 h-4 text-[#8B7860]" />
                        <span className="font-semibold text-xs text-[#252521]">Warm Cream</span>
                      </div>
                      {theme === 'cream' && (
                        <div className="w-4 h-4 rounded-full bg-[#8B7860] text-white flex items-center justify-center">
                          <Check className="w-2.5 h-2.5 stroke-[3]" />
                        </div>
                      )}
                    </div>

                    {/* Miniature swatch mockup */}
                    <div className="p-2.5 rounded-xl bg-[#FBFAF7] border border-[#E5E2DA] space-y-1.5">
                      <div className="w-3/4 h-2 rounded bg-[#EEEBE3]" />
                      <div className="w-1/2 h-2 rounded bg-[#E5E2DA]" />
                    </div>

                    <p className="text-[11px] text-[#77766F] leading-relaxed">
                      Warm ivory backgrounds with charcoal typography and soft shadows. Default experience.
                    </p>
                  </div>

                  {/* Dark Graphite Card */}
                  <div
                    onClick={() => setTheme('graphite')}
                    className={`cursor-pointer rounded-2xl border p-4 transition-all space-y-3 ${
                      theme === 'graphite'
                        ? 'border-theme-accent ring-2 ring-theme-accent/30 bg-[#171816] text-[#ECECE6] shadow-subtle'
                        : 'border-theme-border bg-theme-surface-secondary/40 hover:border-theme-border/80'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Moon className="w-4 h-4 text-[#B8A68B]" />
                        <span className="font-semibold text-xs text-[#ECECE6]">Dark Graphite</span>
                      </div>
                      {theme === 'graphite' && (
                        <div className="w-4 h-4 rounded-full bg-[#B8A68B] text-[#171816] flex items-center justify-center">
                          <Check className="w-2.5 h-2.5 stroke-[3]" />
                        </div>
                      )}
                    </div>

                    {/* Miniature swatch mockup */}
                    <div className="p-2.5 rounded-xl bg-[#20211E] border border-[#353630] space-y-1.5">
                      <div className="w-3/4 h-2 rounded bg-[#30312B]" />
                      <div className="w-1/2 h-2 rounded bg-[#353630]" />
                    </div>

                    <p className="text-[11px] text-[#A3A39A] leading-relaxed">
                      Sophisticated dark surfaces with warm stone accents. Avoids pure black fatigue.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* 2. MODELS TAB */}
            {activeTab === 'models' && (
              <div className="space-y-4">
                <div>
                  <h4 className="font-medium text-theme-text text-sm mb-1">Configured Providers</h4>
                  <p className="text-theme-text-secondary text-xs">
                    MindVault integrates both Google Gemini Cloud and Local Ollama inference.
                  </p>
                </div>

                <div className="space-y-2.5">
                  {/* Gemini Card */}
                  <div className="p-3.5 rounded-xl border border-theme-border bg-theme-surface-secondary/30 flex items-center justify-between">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2 font-medium text-theme-text">
                        <span>⚡ Google Gemini Flash</span>
                        <span className="text-[10px] px-1.5 py-0.2 rounded bg-amber-500/15 text-amber-600 dark:text-amber-400 font-mono">
                          gemini-3.5-flash
                        </span>
                      </div>
                      <p className="text-[11px] text-theme-text-secondary">
                        Ultra-fast streaming reasoning + multimodal image interpretation.
                      </p>
                    </div>
                    <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">
                      Connected
                    </span>
                  </div>

                  {/* Ollama Card */}
                  <div className="p-3.5 rounded-xl border border-theme-border bg-theme-surface-secondary/30 flex items-center justify-between">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2 font-medium text-theme-text">
                        <span>🦙 Ollama Local</span>
                        <span className="text-[10px] px-1.5 py-0.2 rounded bg-purple-500/15 text-purple-600 dark:text-purple-400 font-mono">
                          qwen3:0.6b
                        </span>
                      </div>
                      <p className="text-[11px] text-theme-text-secondary">
                        100% private, on-device offline inference (http://localhost:11434).
                      </p>
                    </div>
                    <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">
                      Active
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* 3. WORKSPACE TAB */}
            {activeTab === 'workspace' && activeWorkspace && (
              <div className="space-y-4">
                <form onSubmit={handleUpdateWorkspace} className="space-y-3">
                  <div>
                    <label className="text-xs font-medium text-theme-text block mb-1">
                      Workspace Name
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={workspaceName}
                        onChange={(e) => setWorkspaceName(e.target.value)}
                        className="flex-1 px-3 py-1.5 rounded-xl border border-theme-border bg-theme-surface-secondary/70 text-theme-text text-xs focus:outline-none focus:border-theme-accent/60"
                      />
                      <button
                        type="submit"
                        disabled={isUpdatingWorkspace || workspaceName === activeWorkspace.name}
                        className="px-3 py-1.5 rounded-xl bg-theme-accent text-white font-medium hover:bg-theme-accent-hover disabled:opacity-40 transition-colors"
                      >
                        {isUpdatingWorkspace ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          'Save'
                        )}
                      </button>
                    </div>
                  </div>
                </form>

                <div className="pt-2 border-t border-theme-border/60">
                  <h5 className="font-medium text-theme-text text-xs mb-2">Members</h5>
                  <div className="space-y-1.5">
                    {workspaceDetails?.members?.map((m) => (
                      <div
                        key={m.userId}
                        className="flex items-center justify-between p-2 rounded-xl bg-theme-surface-secondary/40 border border-theme-border/60 text-xs"
                      >
                        <span className="font-medium text-theme-text">{m.user?.email || m.userId}</span>
                        <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-theme-surface text-theme-accent border border-theme-border">
                          {m.role}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* 4. ACCOUNT TAB */}
            {activeTab === 'account' && user && (
              <div className="space-y-5">
                <div className="p-3.5 rounded-xl border border-theme-border bg-theme-surface-secondary/30 space-y-1">
                  <div className="text-[11px] text-theme-text-muted">Signed In As</div>
                  <div className="text-sm font-medium text-theme-text">{user.email}</div>
                  <div className="text-[11px] text-theme-text-secondary">User ID: {user.id}</div>
                </div>

                <div className="space-y-2">
                  <h5 className="font-medium text-theme-text text-xs">Active Login Sessions</h5>
                  <div className="space-y-1.5">
                    {sessions.map((s) => (
                      <div
                        key={s.id}
                        className="flex items-center justify-between p-2.5 rounded-xl border border-theme-border bg-theme-surface text-xs"
                      >
                        <div className="flex items-center gap-2">
                          <Laptop className="w-3.5 h-3.5 text-theme-accent" />
                          <div>
                            <p className="font-medium text-theme-text truncate max-w-[200px]">
                              Session {s.id.slice(0, 8)}... {s.isCurrent ? '(Current)' : ''}
                            </p>
                            <p className="text-[10px] text-theme-text-muted">
                              Created {new Date(s.createdAt).toLocaleDateString()} • Expires {new Date(s.expiresAt).toLocaleDateString()}
                            </p>
                          </div>
                        </div>

                        {!s.isCurrent && (
                          <button
                            onClick={() => handleRevokeSession(s.id)}
                            className="p-1 rounded text-theme-text-muted hover:text-rose-500 hover:bg-theme-surface-secondary transition-colors"
                            title="Revoke session"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="pt-2 border-t border-theme-border/60">
                  <button
                    onClick={logout}
                    className="w-full py-2 px-3 rounded-xl border border-rose-500/30 text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 transition-colors font-medium text-xs text-center"
                  >
                    Sign Out of MindVault
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
