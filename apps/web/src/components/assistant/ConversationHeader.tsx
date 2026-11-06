import React, { useState } from 'react';
import type { ChatSessionDto } from '@mindvault/shared';
import { Bot, Edit2, Archive, Trash2, Sparkles } from 'lucide-react';

interface ConversationHeaderProps {
  session: ChatSessionDto | null;
  onRename: (newTitle: string) => void;
  onArchive: () => void;
  onDelete: () => void;
}

export const ConversationHeader: React.FC<ConversationHeaderProps> = ({
  session,
  onRename,
  onArchive,
  onDelete,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [titleValue, setTitleValue] = useState('');
  const [showSummaryModal, setShowSummaryModal] = useState(false);

  if (!session) {
    return (
      <div className="flex items-center justify-between p-4 rounded-2xl border border-vault-800 bg-vault-900/40">
        <div className="flex items-center gap-2 text-vault-400 text-xs">
          <Bot className="w-4 h-4 text-blue-400" />
          <span>New Conversation</span>
        </div>
      </div>
    );
  }

  const handleStartEdit = () => {
    setTitleValue(session.title);
    setIsEditing(true);
  };

  const handleSaveEdit = () => {
    if (titleValue.trim() && titleValue.trim() !== session.title) {
      onRename(titleValue.trim());
    }
    setIsEditing(false);
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 p-4 rounded-2xl border border-vault-800 bg-vault-900/40">
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <div className="p-2 rounded-xl bg-blue-500/10 text-blue-400 border border-blue-500/20 shrink-0">
          <Bot className="w-4 h-4" />
        </div>

        <div className="min-w-0 flex-1">
          {isEditing ? (
            <input
              type="text"
              value={titleValue}
              onChange={(e) => setTitleValue(e.target.value)}
              onBlur={handleSaveEdit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSaveEdit();
                if (e.key === 'Escape') setIsEditing(false);
              }}
              autoFocus
              className="bg-vault-950 border border-blue-500 rounded px-2 py-0.5 text-sm text-white focus:outline-none w-full max-w-sm"
            />
          ) : (
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-white truncate">{session.title}</h2>
              <button
                onClick={handleStartEdit}
                className="text-vault-500 hover:text-vault-300 transition-colors p-0.5"
                title="Rename conversation"
              >
                <Edit2 className="w-3 h-3" />
              </button>
            </div>
          )}

          <div className="flex items-center gap-2 mt-0.5 text-[11px] text-vault-400">
            <span
              className={`px-1.5 py-0.2 rounded text-[10px] font-mono uppercase ${
                session.status === 'ACTIVE'
                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                  : 'bg-vault-800 text-vault-400'
              }`}
            >
              {session.status}
            </span>
            <span>•</span>
            <span>{session.messageCount} messages</span>
            {session.summary && (
              <>
                <span>•</span>
                <button
                  onClick={() => setShowSummaryModal(true)}
                  className="flex items-center gap-1 text-purple-400 hover:text-purple-300 font-medium transition-colors"
                >
                  <Sparkles className="w-3 h-3" />
                  <span>Memory Summary (v{session.summaryVersion})</span>
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={onArchive}
          className="p-1.5 rounded-lg border border-vault-800 bg-vault-900/60 text-vault-400 hover:text-amber-400 hover:bg-vault-800 transition-colors text-xs flex items-center gap-1.5"
          title="Archive conversation"
        >
          <Archive className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Archive</span>
        </button>
        <button
          onClick={onDelete}
          className="p-1.5 rounded-lg border border-vault-800 bg-vault-900/60 text-vault-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors text-xs flex items-center gap-1.5"
          title="Delete conversation"
        >
          <Trash2 className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Delete</span>
        </button>
      </div>

      {/* Summary Modal Dialog */}
      {showSummaryModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-vault-800 bg-vault-900 p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-purple-400" />
                Rolling Memory Summary (v{session.summaryVersion})
              </h3>
              <button
                onClick={() => setShowSummaryModal(false)}
                className="text-vault-400 hover:text-white text-lg font-bold"
              >
                ×
              </button>
            </div>
            <p className="text-xs text-vault-300 leading-relaxed bg-vault-950 p-3 rounded-xl border border-vault-800/80">
              {session.summary}
            </p>
            <div className="text-[10px] text-vault-500 flex items-center justify-between">
              <span>Summarized through message sequence {session.summarizedThroughSeq}</span>
              <span>Updated: {new Date(session.summaryUpdatedAt || '').toLocaleTimeString()}</span>
            </div>
            <div className="flex justify-end pt-2">
              <button
                onClick={() => setShowSummaryModal(false)}
                className="px-3 py-1.5 rounded-lg bg-vault-800 hover:bg-vault-700 text-white text-xs font-medium transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
