import React, { useState } from 'react';
import type { ChatSessionDto } from '@mindvault/shared';
import { Edit2, Archive, Trash2, Sparkles, X, Menu } from 'lucide-react';

interface ConversationHeaderProps {
  session: ChatSessionDto | null;
  onRename: (newTitle: string) => void;
  onArchive: () => void;
  onDelete: () => void;
  onToggleSidebar?: () => void;
  evidenceCount?: number;
  onToggleEvidence?: () => void;
  isEvidenceOpen?: boolean;
}

export const ConversationHeader: React.FC<ConversationHeaderProps> = ({
  session,
  onRename,
  onArchive,
  onDelete,
  onToggleSidebar,
  evidenceCount = 0,
  onToggleEvidence,
  isEvidenceOpen = false,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [titleValue, setTitleValue] = useState('');
  const [showSummaryModal, setShowSummaryModal] = useState(false);

  const handleStartEdit = () => {
    if (!session) return;
    setTitleValue(session.title);
    setIsEditing(true);
  };

  const handleSaveEdit = () => {
    if (session && titleValue.trim() && titleValue.trim() !== session.title) {
      onRename(titleValue.trim());
    }
    setIsEditing(false);
  };

  return (
    <>
      <header className="h-14 px-4 sm:px-6 flex items-center justify-between border-b border-theme-border bg-theme-bg/80 backdrop-blur-md sticky top-0 z-20 transition-colors">
        {/* Left: Mobile hamburger & title */}
        <div className="flex items-center gap-3 min-w-0 flex-1">
          {onToggleSidebar && (
            <button
              onClick={onToggleSidebar}
              className="lg:hidden p-1.5 rounded-lg text-theme-text-muted hover:text-theme-text hover:bg-theme-surface transition-colors"
              title="Toggle sidebar"
            >
              <Menu className="w-4 h-4" />
            </button>
          )}

          <div className="min-w-0 flex-1 flex items-center gap-2">
            {!session ? (
              <span className="text-sm font-semibold tracking-tight text-theme-text">
                New Conversation
              </span>
            ) : isEditing ? (
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
                className="bg-theme-surface border border-theme-accent rounded-lg px-2 py-0.5 text-xs text-theme-text focus:outline-none w-full max-w-sm"
              />
            ) : (
              <div
                className="flex items-center gap-1.5 truncate group cursor-pointer"
                onClick={handleStartEdit}
              >
                <h2 className="text-xs sm:text-sm font-semibold text-theme-text truncate tracking-tight">
                  {session.title}
                </h2>
                <button
                  type="button"
                  className="opacity-0 group-hover:opacity-100 text-theme-text-muted hover:text-theme-text transition-opacity p-0.5"
                  title="Rename"
                >
                  <Edit2 className="w-3 h-3" />
                </button>
              </div>
            )}

            {session?.summary && (
              <button
                onClick={() => setShowSummaryModal(true)}
                className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-theme-accent/10 text-theme-accent border border-theme-accent/25 hover:bg-theme-accent/20 transition-colors shrink-0"
                title="View ongoing memory summary"
              >
                <Sparkles className="w-2.5 h-2.5" />
                <span>Memory (v{session.summaryVersion})</span>
              </button>
            )}
          </div>
        </div>

        {/* Right: Evidence Drawer toggle & Conversation Actions */}
        <div className="flex items-center gap-2 shrink-0">
          {evidenceCount > 0 && onToggleEvidence && (
            <button
              type="button"
              onClick={onToggleEvidence}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-medium border transition-colors ${
                isEvidenceOpen
                  ? 'border-theme-accent bg-theme-accent/15 text-theme-accent'
                  : 'border-theme-border bg-theme-surface hover:bg-theme-surface-hover text-theme-text-secondary hover:text-theme-text shadow-subtle'
              }`}
            >
              <span>Evidence</span>
              <span className="font-mono text-[10px] px-1 rounded-full bg-theme-surface-secondary text-theme-accent">
                {evidenceCount}
              </span>
            </button>
          )}

          {session && (
            <>
              <button
                onClick={onArchive}
                className="p-1.5 rounded-lg text-theme-text-muted hover:text-amber-600 dark:hover:text-amber-400 hover:bg-theme-surface transition-colors"
                title="Archive conversation"
              >
                <Archive className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={onDelete}
                className="p-1.5 rounded-lg text-theme-text-muted hover:text-rose-600 dark:hover:text-rose-400 hover:bg-theme-surface transition-colors"
                title="Delete conversation"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </>
          )}
        </div>
      </header>

      {/* Memory Summary Modal Dialog */}
      {showSummaryModal && session?.summary && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fadeIn">
          <div className="w-full max-w-lg rounded-2xl border border-theme-border bg-theme-surface p-5 space-y-3.5 shadow-modal text-theme-text">
            <div className="flex items-center justify-between pb-2 border-b border-theme-border">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-theme-accent" />
                <h3 className="text-xs font-semibold uppercase tracking-wider">
                  Rolling Memory Summary (v{session.summaryVersion})
                </h3>
              </div>
              <button
                onClick={() => setShowSummaryModal(false)}
                className="p-1 rounded-md text-theme-text-muted hover:text-theme-text hover:bg-theme-surface-secondary"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-3.5 rounded-xl bg-theme-surface-secondary/50 border border-theme-border/60 text-xs leading-relaxed text-theme-text font-sans max-h-60 overflow-y-auto custom-scrollbar whitespace-pre-wrap">
              {session.summary}
            </div>

            <div className="flex justify-between items-center text-[10px] text-theme-text-muted pt-1">
              <span>Summarized through turn #{session.summarizedThroughSeq}</span>
              <button
                onClick={() => setShowSummaryModal(false)}
                className="px-3 py-1 rounded-lg bg-theme-surface-secondary hover:bg-theme-surface-hover text-theme-text font-medium text-xs border border-theme-border"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
