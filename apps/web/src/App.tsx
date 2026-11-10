import React, { useState, useEffect, useCallback } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { useTheme } from './context/ThemeContext';
import { LoginForm } from './components/auth/LoginForm';
import { RegisterForm } from './components/auth/RegisterForm';
import { ConversationSidebar } from './components/assistant/ConversationSidebar';
import { KnowledgeAssistant } from './components/assistant/KnowledgeAssistant';
import { DocumentLibrary } from './components/documents/DocumentLibrary';
import { KnowledgeSearch } from './components/search/KnowledgeSearch';
import { KnowledgeGraphView } from './components/graph/KnowledgeGraphView';
import { SettingsModal } from './components/settings/SettingsModal';
import { CreateWorkspaceModal } from './components/workspace/CreateWorkspaceModal';
import type { ChatSessionDto, ApiResponse } from '@mindvault/shared';
import { Loader2, ArrowLeft, BookOpen, Search, Menu, Network } from 'lucide-react';

const MainApp: React.FC = () => {
  const { user, isLoading, activeWorkspace, accessToken } = useAuth();
  const { theme } = useTheme();

  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [activeView, setActiveView] = useState<'chat' | 'documents' | 'search' | 'graph'>('chat');

  // Sidebar states
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(() => {
    return localStorage.getItem('mindvault_sidebar_collapsed') === 'true';
  });
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);

  // Modals
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isCreateWorkspaceOpen, setIsCreateWorkspaceOpen] = useState(false);

  // Sessions state
  const [sessions, setSessions] = useState<ChatSessionDto[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [isLoadingSessions, setIsLoadingSessions] = useState(false);

  // Toggle collapse and persist
  const handleToggleSidebarCollapse = () => {
    setIsSidebarCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem('mindvault_sidebar_collapsed', String(next));
      return next;
    });
  };

  // Load conversation sessions for active workspace
  const loadSessions = useCallback(async () => {
    if (!activeWorkspace || !accessToken) return;
    setIsLoadingSessions(true);

    try {
      const res = await fetch('/api/conversations?limit=50', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'X-Workspace-ID': activeWorkspace.id,
        },
      });

      if (res.ok) {
        const json: ApiResponse<{ items: ChatSessionDto[]; total: number }> = await res.json();
        if (json.success && json.data) {
          setSessions(json.data.items || []);
        }
      }
    } catch (err) {
      console.error('Failed to load conversations:', err);
    } finally {
      setIsLoadingSessions(false);
    }
  }, [activeWorkspace, accessToken]);

  useEffect(() => {
    if (activeWorkspace) {
      loadSessions();
      // Reset active conversation when switching workspaces
      setActiveSessionId(null);
    }
  }, [activeWorkspace, loadSessions]);

  // Keyboard shortcut listeners (⌘K for New Chat, ⌘B for toggle sidebar)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setActiveSessionId(null);
        setActiveView('chat');
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        handleToggleSidebarCollapse();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleSelectSession = (sessionId: string) => {
    setActiveSessionId(sessionId);
    setActiveView('chat');
  };

  const handleNewSession = () => {
    setActiveSessionId(null);
    setActiveView('chat');
  };

  const handleRenameSession = async (sessionId: string, newTitle: string) => {
    if (!activeWorkspace || !accessToken) return;
    try {
      const res = await fetch(`/api/conversations/${sessionId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
          'X-Workspace-ID': activeWorkspace.id,
        },
        body: JSON.stringify({ title: newTitle }),
      });

      if (res.ok) {
        setSessions((prev) =>
          prev.map((s) => (s.id === sessionId ? { ...s, title: newTitle } : s)),
        );
      }
    } catch (err) {
      console.error('Failed to rename session:', err);
    }
  };

  const handleArchiveSession = async (sessionId: string) => {
    if (!activeWorkspace || !accessToken) return;
    try {
      const res = await fetch(`/api/conversations/${sessionId}/archive`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'X-Workspace-ID': activeWorkspace.id,
        },
      });

      if (res.ok) {
        setSessions((prev) => prev.filter((s) => s.id !== sessionId));
        if (activeSessionId === sessionId) {
          setActiveSessionId(null);
        }
      }
    } catch (err) {
      console.error('Failed to archive session:', err);
    }
  };

  const handleDeleteSession = async (sessionId: string) => {
    if (!activeWorkspace || !accessToken) return;
    try {
      const res = await fetch(`/api/conversations/${sessionId}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'X-Workspace-ID': activeWorkspace.id,
        },
      });

      if (res.ok) {
        setSessions((prev) => prev.filter((s) => s.id !== sessionId));
        if (activeSessionId === sessionId) {
          setActiveSessionId(null);
        }
      }
    } catch (err) {
      console.error('Failed to delete session:', err);
    }
  };

  // Loading Screen
  if (isLoading) {
    return (
      <div className="min-h-screen bg-theme-bg flex flex-col items-center justify-center text-theme-text-muted gap-3">
        <div className="w-9 h-9 rounded-xl bg-theme-accent/15 border border-theme-accent/25 flex items-center justify-center text-theme-accent font-serif font-bold text-sm">
          MV
        </div>
        <div className="flex items-center gap-2 text-xs font-mono">
          <Loader2 className="w-3.5 h-3.5 animate-spin text-theme-accent" />
          <span>Opening MindVault...</span>
        </div>
      </div>
    );
  }

  // Unauthenticated Portal (Warm Cream & Dark Graphite)
  if (!user) {
    return (
      <div className="min-h-screen bg-theme-bg text-theme-text flex flex-col items-center justify-center p-4">
        <div className="w-full max-w-md">
          {authMode === 'login' ? (
            <LoginForm onSwitchToRegister={() => setAuthMode('register')} />
          ) : (
            <RegisterForm onSwitchToLogin={() => setAuthMode('login')} />
          )}

          <footer className="mt-8 text-center text-xs text-theme-text-muted">
            MindVault • Evidence-Grounded AI Knowledge Companion
          </footer>
        </div>
      </div>
    );
  }

  // Authenticated Main Workspace Layout
  return (
    <div className="h-screen w-screen overflow-hidden bg-theme-bg text-theme-text flex">
      {/* Primary Left Collapsible Application Sidebar */}
      <ConversationSidebar
        sessions={sessions}
        activeSessionId={activeSessionId}
        onSelectSession={handleSelectSession}
        onNewSession={handleNewSession}
        onRenameSession={handleRenameSession}
        onDeleteSession={handleDeleteSession}
        isLoadingSessions={isLoadingSessions}
        activeView={activeView}
        onSelectView={setActiveView}
        isCollapsed={isSidebarCollapsed}
        onToggleCollapse={handleToggleSidebarCollapse}
        isMobileOpen={isMobileSidebarOpen}
        onCloseMobile={() => setIsMobileSidebarOpen(false)}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onOpenCreateWorkspace={() => setIsCreateWorkspaceOpen(true)}
      />

      {/* Main Content View Container */}
      <main className="flex-1 flex flex-col h-full overflow-hidden relative">
        {/* VIEW 1: AI Knowledge Assistant (Primary Conversation Interface) */}
        {activeView === 'chat' && (
          <div className="flex-1 h-full overflow-hidden">
            <KnowledgeAssistant
              workspaceId={activeWorkspace?.id || ''}
              sessions={sessions}
              activeSessionId={activeSessionId}
              onSelectSession={handleSelectSession}
              onNewSession={handleNewSession}
              onRenameSession={handleRenameSession}
              onArchiveSession={handleArchiveSession}
              onDeleteSession={handleDeleteSession}
              loadSessions={loadSessions}
              onToggleSidebar={() => setIsMobileSidebarOpen(true)}
            />
          </div>
        )}

        {/* VIEW 2: Knowledge Documents View */}
        {activeView === 'documents' && (
          <div className="flex-1 flex flex-col h-full overflow-y-auto">
            {/* Top Bar with Return to Chat & Breadcrumb */}
            <header className="h-14 border-b border-theme-border px-6 flex items-center justify-between shrink-0 bg-theme-surface/50 backdrop-blur-sm sticky top-0 z-20">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setIsMobileSidebarOpen(true)}
                  className="md:hidden p-1.5 rounded-lg text-theme-text-muted hover:text-theme-text hover:bg-theme-surface-secondary"
                  aria-label="Open sidebar"
                >
                  <Menu className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setActiveView('chat')}
                  className="flex items-center gap-1.5 text-xs text-theme-text-muted hover:text-theme-text py-1 px-2 rounded-lg hover:bg-theme-surface-secondary transition-colors"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>Back to Chat</span>
                </button>
                <div className="h-4 w-px bg-theme-border" />
                <div className="flex items-center gap-2">
                  <BookOpen className="w-4 h-4 text-theme-accent" />
                  <h1 className="text-sm font-semibold text-theme-text">Document Library</h1>
                </div>
              </div>

              <div className="text-xs text-theme-text-muted font-mono">
                {activeWorkspace?.name || 'Workspace'}
              </div>
            </header>

            <div className="flex-1 p-6 max-w-5xl w-full mx-auto">
              <DocumentLibrary />
            </div>
          </div>
        )}

        {/* VIEW 3: Deep Knowledge Search View */}
        {activeView === 'search' && (
          <div className="flex-1 flex flex-col h-full overflow-y-auto">
            {/* Top Bar with Return to Chat & Breadcrumb */}
            <header className="h-14 border-b border-theme-border px-6 flex items-center justify-between shrink-0 bg-theme-surface/50 backdrop-blur-sm sticky top-0 z-20">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setIsMobileSidebarOpen(true)}
                  className="md:hidden p-1.5 rounded-lg text-theme-text-muted hover:text-theme-text hover:bg-theme-surface-secondary"
                  aria-label="Open sidebar"
                >
                  <Menu className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setActiveView('chat')}
                  className="flex items-center gap-1.5 text-xs text-theme-text-muted hover:text-theme-text py-1 px-2 rounded-lg hover:bg-theme-surface-secondary transition-colors"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>Back to Chat</span>
                </button>
                <div className="h-4 w-px bg-theme-border" />
                <div className="flex items-center gap-2">
                  <Search className="w-4 h-4 text-theme-accent" />
                  <h1 className="text-sm font-semibold text-theme-text">Knowledge Retrieval</h1>
                </div>
              </div>

              <div className="text-xs text-theme-text-muted font-mono">
                {activeWorkspace?.name || 'Workspace'}
              </div>
            </header>

            <div className="flex-1 p-6 max-w-5xl w-full mx-auto">
              <KnowledgeSearch />
            </div>
          </div>
        )}

        {/* VIEW 4: Knowledge Graph Explorer View */}
        {activeView === 'graph' && (
          <div className="flex-1 flex flex-col h-full overflow-hidden">
            {/* Top Bar with Return to Chat & Breadcrumb */}
            <header className="h-14 border-b border-theme-border px-6 flex items-center justify-between shrink-0 bg-theme-surface/50 backdrop-blur-sm sticky top-0 z-20">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setIsMobileSidebarOpen(true)}
                  className="md:hidden p-1.5 rounded-lg text-theme-text-muted hover:text-theme-text hover:bg-theme-surface-secondary"
                  aria-label="Open sidebar"
                >
                  <Menu className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setActiveView('chat')}
                  className="flex items-center gap-1.5 text-xs text-theme-text-muted hover:text-theme-text py-1 px-2 rounded-lg hover:bg-theme-surface-secondary transition-colors"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>Back to Chat</span>
                </button>
                <div className="h-4 w-px bg-theme-border" />
                <div className="flex items-center gap-2">
                  <Network className="w-4 h-4 text-theme-accent" />
                  <h1 className="text-sm font-semibold text-theme-text">
                    Knowledge Graph Explorer
                  </h1>
                </div>
              </div>

              <div className="text-xs text-theme-text-muted font-mono">
                {activeWorkspace?.name || 'Workspace'}
              </div>
            </header>

            <div className="flex-1 overflow-hidden">
              <KnowledgeGraphView />
            </div>
          </div>
        )}
      </main>

      {/* Settings Modal (Appearance, Models, Workspace, Account) */}
      <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />

      {/* Create Workspace Modal */}
      <CreateWorkspaceModal
        isOpen={isCreateWorkspaceOpen}
        onClose={() => setIsCreateWorkspaceOpen(false)}
      />
    </div>
  );
};

export const App: React.FC = () => {
  return (
    <AuthProvider>
      <MainApp />
    </AuthProvider>
  );
};
