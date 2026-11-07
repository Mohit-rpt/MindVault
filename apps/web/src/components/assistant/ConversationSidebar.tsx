import React, { useState } from 'react';
import type { ChatSessionDto } from '@mindvault/shared';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import {
  Sparkles,
  Plus,
  Search,
  MessageSquare,
  FileText,
  Search as SearchIcon,
  Settings,
  Sun,
  Moon,
  Trash2,
  Edit2,
  X,
  LogOut,
  FolderGit2,
  Check,
} from 'lucide-react';

export interface SidebarProps {
  sessions: ChatSessionDto[];
  activeSessionId: string | null;
  onSelectSession: (sessionId: string) => void;
  onNewSession: () => void;
  onRenameSession: (sessionId: string, newTitle: string) => void;
  onDeleteSession: (sessionId: string) => void;
  isLoadingSessions: boolean;
  activeView: 'chat' | 'documents' | 'search';
  onSelectView: (view: 'chat' | 'documents' | 'search') => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  isMobileOpen: boolean;
  onCloseMobile: () => void;
  onOpenSettings: () => void;
  onOpenCreateWorkspace: () => void;
}

export const ConversationSidebar: React.FC<SidebarProps> = ({
  sessions,
  activeSessionId,
  onSelectSession,
  onNewSession,
  onRenameSession,
  onDeleteSession,
  isLoadingSessions,
  activeView,
  onSelectView,
  isCollapsed,
  onToggleCollapse,
  isMobileOpen,
  onCloseMobile,
  onOpenSettings,
  onOpenCreateWorkspace,
}) => {
  const { user, workspaces, activeWorkspace, setActiveWorkspace, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();

  const [searchTerm, setSearchTerm] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [showWorkspaceMenu, setShowWorkspaceMenu] = useState(false);

  const filteredSessions = sessions.filter((s) =>
    s.title.toLowerCase().includes(searchTerm.toLowerCase()),
  );

  const handleStartRename = (session: ChatSessionDto, e: React.MouseEvent) => {
    e.stopPropagation();
    setRenamingId(session.id);
    setRenameValue(session.title);
  };

  const handleSaveRename = (sessionId: string) => {
    if (renameValue.trim()) {
      onRenameSession(sessionId, renameValue.trim());
    }
    setRenamingId(null);
  };

  const handleDelete = (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (window.confirm('Delete this conversation?')) {
      onDeleteSession(sessionId);
    }
  };

  const sidebarContent = (
    <div className="flex flex-col h-full justify-between bg-theme-sidebar text-theme-text select-none">
      {/* TOP SECTION: Brand, New Chat, Search */}
      <div className="p-3.5 space-y-3">
        {/* Brand Header */}
        <div className="flex items-center justify-between">
          <div
            onClick={() => onSelectView('chat')}
            className="flex items-center gap-2.5 cursor-pointer group"
          >
            <div className="w-8 h-8 rounded-xl bg-theme-surface text-theme-accent border border-theme-border flex items-center justify-center shadow-subtle group-hover:border-theme-accent/50 transition-colors">
              <Sparkles className="w-4 h-4" />
            </div>
            {!isCollapsed && (
              <div className="flex flex-col">
                <span className="font-semibold text-sm tracking-tight text-theme-text">
                  MindVault
                </span>
                <span className="text-[10px] text-theme-text-muted">Knowledge Companion</span>
              </div>
            )}
          </div>

          {/* Mobile close button */}
          <button
            onClick={onCloseMobile}
            className="lg:hidden p-1.5 rounded-lg text-theme-text-muted hover:text-theme-text"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* New Chat Button */}
        {!isCollapsed && (
          <button
            onClick={() => {
              onSelectView('chat');
              onNewSession();
              onCloseMobile();
            }}
            className="w-full flex items-center justify-between px-3 py-2 rounded-xl bg-theme-surface hover:bg-theme-surface-hover border border-theme-border text-xs font-medium text-theme-text shadow-subtle transition-all group"
          >
            <div className="flex items-center gap-2">
              <Plus className="w-4 h-4 text-theme-accent" />
              <span>New Conversation</span>
            </div>
            <kbd className="hidden sm:inline-block px-1.5 py-0.5 text-[10px] font-mono text-theme-text-muted bg-theme-surface-secondary border border-theme-border/60 rounded">
              ⌘K
            </kbd>
          </button>
        )}

        {/* Search Conversations Input */}
        {!isCollapsed && (
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-theme-text-muted" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search conversations..."
              className="w-full pl-8 pr-3 py-1.5 bg-theme-surface-secondary/70 border border-theme-border/80 rounded-xl text-xs text-theme-text placeholder-theme-text-muted focus:outline-none focus:border-theme-accent/50 font-sans"
            />
          </div>
        )}

        {/* Primary Views Navigation */}
        {!isCollapsed && (
          <div className="space-y-0.5 pt-1 border-t border-theme-border/40">
            <button
              onClick={() => {
                onSelectView('chat');
                onCloseMobile();
              }}
              className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                activeView === 'chat'
                  ? 'bg-theme-surface text-theme-text shadow-subtle border border-theme-border/60'
                  : 'text-theme-text-secondary hover:text-theme-text hover:bg-theme-surface-secondary/60'
              }`}
            >
              <MessageSquare className="w-3.5 h-3.5 text-theme-accent" />
              <span>AI Chat Assistant</span>
            </button>

            <button
              onClick={() => {
                onSelectView('documents');
                onCloseMobile();
              }}
              className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                activeView === 'documents'
                  ? 'bg-theme-surface text-theme-text shadow-subtle border border-theme-border/60'
                  : 'text-theme-text-secondary hover:text-theme-text hover:bg-theme-surface-secondary/60'
              }`}
            >
              <FileText className="w-3.5 h-3.5 text-theme-accent" />
              <span>Knowledge Documents</span>
            </button>

            <button
              onClick={() => {
                onSelectView('search');
                onCloseMobile();
              }}
              className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                activeView === 'search'
                  ? 'bg-theme-surface text-theme-text shadow-subtle border border-theme-border/60'
                  : 'text-theme-text-secondary hover:text-theme-text hover:bg-theme-surface-secondary/60'
              }`}
            >
              <SearchIcon className="w-3.5 h-3.5 text-theme-accent" />
              <span>Deep Vault Search</span>
            </button>
          </div>
        )}
      </div>

      {/* MIDDLE SECTION: Conversations List */}
      {!isCollapsed && (
        <div className="flex-1 overflow-y-auto px-3 space-y-1 custom-scrollbar min-h-0 border-t border-theme-border/40 pt-2">
          <div className="px-2 py-1 text-[10px] font-semibold tracking-wider text-theme-text-muted uppercase">
            Recent Conversations
          </div>

          {isLoadingSessions && sessions.length === 0 ? (
            <div className="p-4 text-center text-xs text-theme-text-muted">Loading chats...</div>
          ) : filteredSessions.length === 0 ? (
            <div className="p-4 text-center text-xs text-theme-text-muted">
              {searchTerm ? 'No matching chats' : 'No conversation history'}
            </div>
          ) : (
            filteredSessions.map((session) => {
              const isActive = activeView === 'chat' && session.id === activeSessionId;
              const isRenaming = renamingId === session.id;

              return (
                <div
                  key={session.id}
                  onClick={() => {
                    onSelectView('chat');
                    onSelectSession(session.id);
                    onCloseMobile();
                  }}
                  className={`group relative flex items-center justify-between rounded-xl px-2.5 py-2 text-xs transition-colors cursor-pointer ${
                    isActive
                      ? 'bg-theme-surface text-theme-text font-medium shadow-subtle border border-theme-border/80'
                      : 'text-theme-text-secondary hover:bg-theme-surface-hover/80 hover:text-theme-text'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <MessageSquare
                      className={`w-3.5 h-3.5 shrink-0 ${
                        isActive ? 'text-theme-accent' : 'text-theme-text-muted'
                      }`}
                    />
                    {isRenaming ? (
                      <input
                        type="text"
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onBlur={() => handleSaveRename(session.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleSaveRename(session.id);
                          if (e.key === 'Escape') setRenamingId(null);
                        }}
                        autoFocus
                        className="w-full bg-theme-surface border border-theme-accent rounded px-1.5 py-0.5 text-xs text-theme-text focus:outline-none"
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : (
                      <span className="truncate text-xs flex-1">{session.title}</span>
                    )}
                  </div>

                  {/* Actions on Hover */}
                  {!isRenaming && (
                    <div className="opacity-0 group-hover:opacity-100 flex items-center gap-1 transition-opacity shrink-0 ml-1">
                      <button
                        onClick={(e) => handleStartRename(session, e)}
                        className="p-1 rounded text-theme-text-muted hover:text-theme-text hover:bg-theme-surface"
                        title="Rename conversation"
                      >
                        <Edit2 className="w-3 h-3" />
                      </button>
                      <button
                        onClick={(e) => handleDelete(session.id, e)}
                        className="p-1 rounded text-theme-text-muted hover:text-rose-500 hover:bg-theme-surface"
                        title="Delete conversation"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* BOTTOM SECTION: Workspace, User, Theme Switcher, Settings */}
      <div className="p-3 border-t border-theme-border/60 space-y-2">
        {/* Workspace Quick Switcher Popover */}
        {!isCollapsed && activeWorkspace && (
          <div className="relative">
            <button
              onClick={() => setShowWorkspaceMenu(!showWorkspaceMenu)}
              className="w-full flex items-center justify-between p-2 rounded-xl bg-theme-surface border border-theme-border text-xs hover:border-theme-accent/50 transition-colors shadow-subtle"
            >
              <div className="flex items-center gap-2 truncate">
                <FolderGit2 className="w-3.5 h-3.5 text-theme-accent shrink-0" />
                <span className="truncate font-medium text-theme-text">{activeWorkspace.name}</span>
              </div>
              <span className="text-[10px] px-1.5 py-0.2 rounded bg-theme-surface-secondary text-theme-accent uppercase font-mono">
                {activeWorkspace.role || 'Member'}
              </span>
            </button>

            {showWorkspaceMenu && (
              <div className="absolute bottom-full left-0 mb-1 w-full rounded-xl bg-theme-surface border border-theme-border shadow-modal p-1.5 space-y-1 z-30 animate-fadeIn">
                <div className="px-2 py-1 text-[10px] uppercase font-semibold text-theme-text-muted">
                  Your Workspaces
                </div>
                {workspaces.map((ws) => (
                  <button
                    key={ws.id}
                    onClick={() => {
                      setActiveWorkspace(ws);
                      setShowWorkspaceMenu(false);
                    }}
                    className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs text-left transition-colors ${
                      ws.id === activeWorkspace.id
                        ? 'bg-theme-surface-secondary font-medium text-theme-text'
                        : 'text-theme-text-secondary hover:text-theme-text hover:bg-theme-surface-hover'
                    }`}
                  >
                    <span className="truncate">{ws.name}</span>
                    {ws.id === activeWorkspace.id && (
                      <Check className="w-3.5 h-3.5 text-theme-accent" />
                    )}
                  </button>
                ))}
                <button
                  onClick={() => {
                    setShowWorkspaceMenu(false);
                    onOpenCreateWorkspace();
                  }}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-theme-accent hover:bg-theme-surface-hover transition-colors font-medium border-t border-theme-border/40 mt-1"
                >
                  <Plus className="w-3 h-3" />
                  <span>Create Workspace</span>
                </button>
              </div>
            )}
          </div>
        )}

        {/* Footer Actions Row: Theme Toggle, Settings, User Sign Out */}
        <div className="flex items-center justify-between pt-1">
          {/* User Info */}
          {!isCollapsed && user && (
            <div className="flex items-center gap-2 min-w-0 pr-1">
              <div className="w-6 h-6 rounded-full bg-theme-accent/20 text-theme-accent flex items-center justify-center text-[11px] font-semibold shrink-0">
                {user.email.slice(0, 1).toUpperCase()}
              </div>
              <span className="truncate text-xs text-theme-text font-medium" title={user.email}>
                {user.email.split('@')[0]}
              </span>
            </div>
          )}

          <div className="flex items-center gap-1 ml-auto">
            {/* Theme Switcher Button */}
            <button
              onClick={toggleTheme}
              className="p-1.5 rounded-lg text-theme-text-secondary hover:text-theme-text hover:bg-theme-surface transition-colors"
              title={`Switch to ${theme === 'cream' ? 'Dark Graphite' : 'Warm Cream'} theme`}
            >
              {theme === 'cream' ? (
                <Moon className="w-4 h-4 text-theme-accent" />
              ) : (
                <Sun className="w-4 h-4 text-amber-300" />
              )}
            </button>

            {/* Settings Button */}
            <button
              onClick={onOpenSettings}
              className="p-1.5 rounded-lg text-theme-text-secondary hover:text-theme-text hover:bg-theme-surface transition-colors"
              title="Settings & Workspace Management"
            >
              <Settings className="w-4 h-4" />
            </button>

            {/* Logout */}
            <button
              onClick={logout}
              className="p-1.5 rounded-lg text-theme-text-secondary hover:text-rose-500 hover:bg-theme-surface transition-colors"
              title="Sign out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop Persistent Collapsible Sidebar */}
      <aside
        className={`hidden lg:flex flex-col h-full border-r border-theme-border transition-all duration-200 shrink-0 ${
          isCollapsed ? 'w-16' : 'w-72'
        }`}
      >
        {sidebarContent}
      </aside>

      {/* Mobile Sliding Drawer Sidebar with Backdrop */}
      {isMobileOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div
            className="fixed inset-0 bg-black/50 backdrop-blur-sm transition-opacity"
            onClick={onCloseMobile}
          />
          <div className="relative w-80 max-w-[85vw] h-full shadow-2xl z-10">{sidebarContent}</div>
        </div>
      )}
    </>
  );
};
