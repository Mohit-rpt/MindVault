import React, { useState } from 'react';
import type { ChatSessionDto } from '@mindvault/shared';
import {
  MessageSquare,
  Plus,
  Search,
  MoreVertical,
  Trash2,
  Archive,
  Edit2,
  Clock,
  Sparkles,
} from 'lucide-react';

interface ConversationSidebarProps {
  sessions: ChatSessionDto[];
  activeSessionId: string | null;
  onSelectSession: (sessionId: string) => void;
  onNewSession: () => void;
  onRenameSession: (sessionId: string, newTitle: string) => void;
  onArchiveSession: (sessionId: string) => void;
  onDeleteSession: (sessionId: string) => void;
  isLoading: boolean;
}

export const ConversationSidebar: React.FC<ConversationSidebarProps> = ({
  sessions,
  activeSessionId,
  onSelectSession,
  onNewSession,
  onRenameSession,
  onArchiveSession,
  onDeleteSession,
  isLoading,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const filteredSessions = sessions.filter((s) =>
    s.title.toLowerCase().includes(searchTerm.toLowerCase()),
  );

  const handleStartRename = (session: ChatSessionDto) => {
    setRenamingId(session.id);
    setRenameValue(session.title);
    setMenuOpenId(null);
  };

  const handleSaveRename = (sessionId: string) => {
    if (renameValue.trim()) {
      onRenameSession(sessionId, renameValue.trim());
    }
    setRenamingId(null);
  };

  return (
    <div className="w-full lg:w-72 flex flex-col h-full rounded-2xl border border-vault-800 bg-vault-950/80 p-3 space-y-3">
      {/* New Conversation Button */}
      <button
        onClick={onNewSession}
        className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-medium text-xs shadow-md shadow-blue-600/20 transition-all"
      >
        <Plus className="w-4 h-4" />
        <span>New Conversation</span>
      </button>

      {/* Search Input */}
      <div className="relative">
        <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-vault-500" />
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Search chats..."
          className="w-full pl-8 pr-3 py-1.5 bg-vault-900/60 border border-vault-800 rounded-lg text-xs text-white placeholder-vault-500 focus:outline-none focus:border-blue-500"
        />
      </div>

      {/* Sessions List */}
      <div className="flex-1 overflow-y-auto space-y-1 pr-1 custom-scrollbar">
        {isLoading && sessions.length === 0 ? (
          <div className="p-4 text-center text-xs text-vault-500">Loading chats...</div>
        ) : filteredSessions.length === 0 ? (
          <div className="p-4 text-center text-xs text-vault-500">
            {searchTerm ? 'No matching conversations' : 'No conversation history'}
          </div>
        ) : (
          filteredSessions.map((session) => {
            const isActive = session.id === activeSessionId;
            const isMenuOpen = menuOpenId === session.id;
            const isRenaming = renamingId === session.id;

            return (
              <div
                key={session.id}
                className={`group relative flex items-center justify-between rounded-xl px-2.5 py-2 text-xs transition-colors cursor-pointer ${
                  isActive
                    ? 'bg-blue-600/15 text-blue-400 border border-blue-500/30 font-medium'
                    : 'text-vault-300 hover:bg-vault-900/60 hover:text-white border border-transparent'
                }`}
                onClick={() => onSelectSession(session.id)}
              >
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <MessageSquare
                    className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-blue-400' : 'text-vault-500'}`}
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
                      className="w-full bg-vault-900 border border-blue-500 rounded px-1.5 py-0.5 text-xs text-white focus:outline-none"
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <div className="truncate flex-1">
                      <div className="truncate text-white/90">{session.title}</div>
                      <div className="text-[10px] text-vault-500 flex items-center gap-1.5 mt-0.5">
                        <Clock className="w-2.5 h-2.5" />
                        <span>{new Date(session.lastMessageAt).toLocaleDateString()}</span>
                        <span>•</span>
                        <span>{session.messageCount} msgs</span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Session Actions Menu */}
                <div className="relative shrink-0 ml-1" onClick={(e) => e.stopPropagation()}>
                  <button
                    onClick={() => setMenuOpenId(isMenuOpen ? null : session.id)}
                    className="p-1 rounded hover:bg-vault-800 text-vault-400 hover:text-white transition-colors"
                  >
                    <MoreVertical className="w-3.5 h-3.5" />
                  </button>

                  {isMenuOpen && (
                    <div className="absolute right-0 top-6 z-30 w-36 rounded-xl border border-vault-800 bg-vault-900 py-1 shadow-xl text-[11px]">
                      <button
                        onClick={() => handleStartRename(session)}
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-vault-300 hover:bg-vault-800 hover:text-white transition-colors text-left"
                      >
                        <Edit2 className="w-3 h-3 text-blue-400" />
                        <span>Rename</span>
                      </button>
                      <button
                        onClick={() => {
                          onArchiveSession(session.id);
                          setMenuOpenId(null);
                        }}
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-vault-300 hover:bg-vault-800 hover:text-white transition-colors text-left"
                      >
                        <Archive className="w-3 h-3 text-amber-400" />
                        <span>Archive</span>
                      </button>
                      <button
                        onClick={() => {
                          onDeleteSession(session.id);
                          setMenuOpenId(null);
                        }}
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-rose-400 hover:bg-rose-500/10 transition-colors text-left"
                      >
                        <Trash2 className="w-3 h-3" />
                        <span>Delete</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Memory Status Badge */}
      <div className="pt-2 border-t border-vault-800/80 flex items-center justify-between text-[10px] text-vault-500 font-mono">
        <span className="flex items-center gap-1 text-emerald-400">
          <Sparkles className="w-3 h-3" />
          Bounded Memory
        </span>
        <span>Phase 5</span>
      </div>
    </div>
  );
};
