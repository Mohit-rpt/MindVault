import React, { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import {
  Users,
  Shield,
  RefreshCw,
  FolderGit2,
  FileText,
  Key,
  CheckCircle2,
  Laptop,
  ArrowRight,
  Sparkles,
  Bot,
} from 'lucide-react';
import type { ApiResponse, SessionDto, WorkspaceDto } from '@mindvault/shared';
import { DocumentLibrary } from '../documents/DocumentLibrary';
import { KnowledgeSearch } from '../search/KnowledgeSearch';
import { KnowledgeAssistant } from '../assistant/KnowledgeAssistant';

export const WorkspaceDashboard: React.FC = () => {
  const { activeWorkspace, accessToken, user, refreshWorkspaces, setActiveWorkspace } = useAuth();
  const [workspaceDetails, setWorkspaceDetails] = useState<WorkspaceDto | null>(null);
  const [sessions, setSessions] = useState<SessionDto[]>([]);
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);
  const [activeTab, setActiveTab] = useState<
    'overview' | 'assistant' | 'search' | 'documents' | 'members' | 'sessions' | 'settings'
  >('overview');
  const [editName, setEditName] = useState('');
  const [feedbackMessage, setFeedbackMessage] = useState<{
    text: string;
    type: 'success' | 'error';
  } | null>(null);

  useEffect(() => {
    if (!activeWorkspace || !accessToken) return;

    let mounted = true;
    setIsLoadingDetails(true);

    async function loadData() {
      try {
        // Fetch detailed workspace info including members
        const wsRes = await fetch(`/api/workspaces/${activeWorkspace?.id}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (wsRes.ok && mounted) {
          const wsJson: ApiResponse<WorkspaceDto> = await wsRes.json();
          if (wsJson.success && wsJson.data) {
            setWorkspaceDetails(wsJson.data);
            setEditName(wsJson.data.name);
          }
        }

        // Fetch active sessions
        const sesRes = await fetch('/api/auth/sessions', {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (sesRes.ok && mounted) {
          const sesJson: ApiResponse<SessionDto[]> = await sesRes.json();
          if (sesJson.success && sesJson.data) {
            setSessions(sesJson.data);
          }
        }
      } catch (err) {
        console.error('Failed to load workspace data:', err);
      } finally {
        if (mounted) setIsLoadingDetails(false);
      }
    }

    loadData();

    return () => {
      mounted = false;
    };
  }, [activeWorkspace, accessToken]);

  const handleRevokeSession = async (sessionId: string) => {
    try {
      const res = await fetch(`/api/auth/sessions/${sessionId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (res.ok) {
        setSessions((prev) => prev.filter((s) => s.id !== sessionId));
        setFeedbackMessage({ text: 'Session successfully revoked', type: 'success' });
      }
    } catch {
      setFeedbackMessage({ text: 'Failed to revoke session', type: 'error' });
    }
  };

  const handleUpdateWorkspace = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeWorkspace) return;

    try {
      const res = await fetch(`/api/workspaces/${activeWorkspace.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ name: editName }),
      });

      const json: ApiResponse<WorkspaceDto> = await res.json();
      if (res.ok && json.success && json.data) {
        setActiveWorkspace(json.data);
        await refreshWorkspaces();
        setFeedbackMessage({ text: 'Workspace updated successfully', type: 'success' });
      } else {
        throw new Error(json.error?.message || 'Update failed');
      }
    } catch (err) {
      setFeedbackMessage({
        text: err instanceof Error ? err.message : 'Update failed',
        type: 'error',
      });
    }
  };

  if (!activeWorkspace) {
    return (
      <div className="p-12 text-center rounded-2xl border border-vault-800 bg-vault-900/40">
        <FolderGit2 className="w-12 h-12 text-vault-500 mx-auto mb-3" />
        <h3 className="text-lg font-semibold text-white">No Workspace Selected</h3>
        <p className="text-sm text-vault-400 mt-1">
          Please create or select a workspace to continue.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Workspace Banner */}
      <div className="rounded-2xl border border-vault-800 bg-gradient-to-r from-vault-900/80 via-vault-900/50 to-vault-950 p-6 sm:p-8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono text-blue-400 uppercase tracking-wider bg-blue-500/10 px-2 py-0.5 rounded border border-blue-500/20">
                Workspace
              </span>
              <span className="text-xs font-mono text-vault-500">slug: {activeWorkspace.slug}</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">
              {activeWorkspace.name}
            </h1>
            <p className="text-xs text-vault-400">
              Created {new Date(activeWorkspace.createdAt).toLocaleDateString()} • Your Role:{' '}
              <span className="font-semibold text-white">{activeWorkspace.role}</span>
            </p>
          </div>

          <div className="flex items-center gap-2">
            {isLoadingDetails && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs text-vault-400 bg-vault-800 border border-vault-700">
                <RefreshCw className="w-3.5 h-3.5 animate-spin text-vault-300" />
                Syncing
              </span>
            )}
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <Shield className="w-3.5 h-3.5" />
              Isolated Space
            </span>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center gap-2 border-t border-vault-800/80 mt-6 pt-4 text-xs font-medium">
          <button
            onClick={() => setActiveTab('overview')}
            className={`px-3 py-1.5 rounded-lg transition-colors ${
              activeTab === 'overview'
                ? 'bg-vault-800 text-white'
                : 'text-vault-400 hover:text-white hover:bg-vault-800/40'
            }`}
          >
            Overview
          </button>
          <button
            onClick={() => setActiveTab('assistant')}
            className={`px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 ${
              activeTab === 'assistant'
                ? 'bg-blue-600 text-white font-medium shadow-sm'
                : 'text-vault-400 hover:text-white hover:bg-vault-800/40'
            }`}
          >
            <Bot className="w-3.5 h-3.5 text-blue-400" />
            AI Assistant
          </button>
          <button
            onClick={() => setActiveTab('search')}
            className={`px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 ${
              activeTab === 'search'
                ? 'bg-purple-600 text-white font-medium shadow-sm'
                : 'text-vault-400 hover:text-white hover:bg-vault-800/40'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5 text-purple-400" />
            Search Knowledge
          </button>
          <button
            onClick={() => setActiveTab('documents')}
            className={`px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 ${
              activeTab === 'documents'
                ? 'bg-vault-800 text-white'
                : 'text-vault-400 hover:text-white hover:bg-vault-800/40'
            }`}
          >
            <FileText className="w-3.5 h-3.5 text-blue-400" />
            Knowledge Documents
          </button>
          <button
            onClick={() => setActiveTab('members')}
            className={`px-3 py-1.5 rounded-lg transition-colors ${
              activeTab === 'members'
                ? 'bg-vault-800 text-white'
                : 'text-vault-400 hover:text-white hover:bg-vault-800/40'
            }`}
          >
            Members ({workspaceDetails?.members?.length || 1})
          </button>
          <button
            onClick={() => setActiveTab('sessions')}
            className={`px-3 py-1.5 rounded-lg transition-colors ${
              activeTab === 'sessions'
                ? 'bg-vault-800 text-white'
                : 'text-vault-400 hover:text-white hover:bg-vault-800/40'
            }`}
          >
            Security & Sessions ({sessions.length})
          </button>
          {(activeWorkspace.role === 'OWNER' || activeWorkspace.role === 'ADMIN') && (
            <button
              onClick={() => setActiveTab('settings')}
              className={`px-3 py-1.5 rounded-lg transition-colors ${
                activeTab === 'settings'
                  ? 'bg-vault-800 text-white'
                  : 'text-vault-400 hover:text-white hover:bg-vault-800/40'
              }`}
            >
              Settings
            </button>
          )}
        </div>
      </div>

      {feedbackMessage && (
        <div
          className={`p-3 rounded-lg text-xs flex items-center justify-between ${
            feedbackMessage.type === 'success'
              ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400'
              : 'bg-rose-500/10 border border-rose-500/20 text-rose-400'
          }`}
        >
          <span>{feedbackMessage.text}</span>
          <button
            onClick={() => setFeedbackMessage(null)}
            className="text-vault-400 hover:text-white font-bold ml-2"
          >
            ×
          </button>
        </div>
      )}

      {/* Tab 1: Overview */}
      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="md:col-span-2 space-y-6">
            <div className="rounded-xl border border-vault-800 bg-vault-900/30 p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-semibold text-white flex items-center gap-2">
                  <FileText className="w-4 h-4 text-blue-400" />
                  Knowledge Documents
                </h3>
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-blue-500/10 text-blue-400 border border-blue-500/20">
                  Phase 2 Active
                </span>
              </div>
              <p className="text-xs text-vault-400">
                Upload PDFs, Markdown notes, Word files, and text documents. MindVault extracts,
                normalizes, chunks, and generates 768-dimensional vector embeddings stored securely
                in PostgreSQL with pgvector.
              </p>
              <div>
                <button
                  onClick={() => setActiveTab('documents')}
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-medium shadow-sm transition-colors"
                >
                  Manage Knowledge Documents
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            <div className="rounded-xl border border-vault-800 bg-vault-900/30 p-6 space-y-3">
              <h3 className="text-sm font-semibold text-white">Workspace Isolation Guarantees</h3>
              <ul className="text-xs text-vault-400 space-y-2 font-mono">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  All future document uploads are strictly scoped to workspace ID{' '}
                  {activeWorkspace.id}.
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  Cross-workspace access (IDOR) rejected at both route and database layer.
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  Vector similarity queries in Phase 3 strictly execute within tenant workspace
                  bounds.
                </li>
              </ul>
            </div>
          </div>

          <div className="space-y-6">
            <div className="rounded-xl border border-vault-800 bg-vault-900/30 p-6 space-y-3">
              <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                <Users className="w-4 h-4 text-purple-400" />
                Workspace Summary
              </h3>
              <div className="text-xs space-y-2 text-vault-300">
                <div className="flex justify-between py-1 border-b border-vault-800/60">
                  <span className="text-vault-500">ID:</span>
                  <span className="font-mono text-[11px] truncate max-w-[140px]">
                    {activeWorkspace.id}
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-vault-800/60">
                  <span className="text-vault-500">Total Members:</span>
                  <span>{workspaceDetails?.members?.length || 1}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-vault-800/60">
                  <span className="text-vault-500">Your Permission:</span>
                  <span className="text-blue-400 font-semibold">{activeWorkspace.role}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab: Knowledge Assistant (Phase 4) */}
      {activeTab === 'assistant' && <KnowledgeAssistant workspaceId={activeWorkspace.id} />}

      {/* Tab: Knowledge Search (Phase 3) */}
      {activeTab === 'search' && <KnowledgeSearch />}

      {/* Tab: Knowledge Documents */}
      {activeTab === 'documents' && <DocumentLibrary />}

      {/* Tab 2: Members */}
      {activeTab === 'members' && (
        <div className="rounded-xl border border-vault-800 bg-vault-900/30 p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-semibold text-white flex items-center gap-2">
              <Users className="w-4 h-4 text-purple-400" />
              Workspace Members
            </h3>
            <span className="text-xs text-vault-400">
              {workspaceDetails?.members?.length || 1} registered
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-vault-800 text-vault-500">
                <tr>
                  <th className="pb-3 font-medium">User</th>
                  <th className="pb-3 font-medium">Role</th>
                  <th className="pb-3 font-medium">Joined</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-vault-800/60">
                {(
                  workspaceDetails?.members || [
                    {
                      id: '1',
                      userId: user?.id || '',
                      workspaceId: activeWorkspace.id,
                      role: activeWorkspace.role || 'OWNER',
                      joinedAt: activeWorkspace.createdAt,
                      user: {
                        id: user?.id || '',
                        name: user?.name || '',
                        email: user?.email || '',
                      },
                    },
                  ]
                ).map((member) => (
                  <tr key={member.id} className="text-vault-300">
                    <td className="py-3">
                      <div className="font-medium text-white">{member.user?.name || 'User'}</div>
                      <div className="text-vault-500 font-mono text-[11px]">
                        {member.user?.email || 'email'}
                      </div>
                    </td>
                    <td className="py-3">
                      <span className="px-2 py-0.5 rounded text-[10px] font-mono font-medium bg-vault-800 text-vault-300 border border-vault-700">
                        {member.role}
                      </span>
                    </td>
                    <td className="py-3 text-vault-500">
                      {new Date(member.joinedAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 3: Security & Sessions */}
      {activeTab === 'sessions' && (
        <div className="rounded-xl border border-vault-800 bg-vault-900/30 p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-semibold text-white flex items-center gap-2">
              <Key className="w-4 h-4 text-cyan-400" />
              Active Login Sessions & Rotation Status
            </h3>
            <span className="text-xs text-vault-400 font-mono">{sessions.length} Active</span>
          </div>
          <p className="text-xs text-vault-400">
            Rotating refresh tokens are stored hashed (SHA-256) in PostgreSQL. If an old token is
            reused, all active sessions are automatically revoked to prevent theft.
          </p>

          <div className="space-y-3">
            {sessions.map((ses) => (
              <div
                key={ses.id}
                className="flex items-center justify-between p-4 rounded-lg bg-vault-950 border border-vault-800/80"
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-vault-900 text-vault-400">
                    <Laptop className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-white font-mono">{ses.id}</span>
                      {ses.isCurrent && (
                        <span className="text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded-full font-medium">
                          Current Device
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-vault-500 flex items-center gap-2 mt-0.5">
                      <span>Created: {new Date(ses.createdAt).toLocaleString()}</span>
                      <span>•</span>
                      <span>Expires: {new Date(ses.expiresAt).toLocaleDateString()}</span>
                    </div>
                  </div>
                </div>

                {!ses.isCurrent && (
                  <button
                    onClick={() => handleRevokeSession(ses.id)}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium text-rose-400 hover:bg-rose-500/10 transition-colors border border-rose-500/20"
                  >
                    Revoke
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tab 4: Settings */}
      {activeTab === 'settings' && (
        <div className="rounded-xl border border-vault-800 bg-vault-900/30 p-6 space-y-6">
          <h3 className="text-base font-semibold text-white">Workspace Configuration</h3>
          <form onSubmit={handleUpdateWorkspace} className="max-w-md space-y-4">
            <div>
              <label className="block text-xs font-medium text-vault-300 mb-1">
                Workspace Name
              </label>
              <input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                required
                className="w-full px-3 py-2 bg-vault-950 border border-vault-800 rounded-lg text-sm text-white focus:outline-none focus:border-blue-500"
              />
            </div>
            <button
              type="submit"
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-medium shadow transition-colors"
            >
              Save Changes
            </button>
          </form>
        </div>
      )}
    </div>
  );
};
