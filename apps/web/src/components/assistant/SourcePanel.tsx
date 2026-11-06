import React, { useState } from 'react';
import type { ContextSourceItem } from '@mindvault/shared';
import { FileText, ChevronDown, ChevronUp, ExternalLink, Bookmark, X } from 'lucide-react';

interface SourcePanelProps {
  sources: ContextSourceItem[];
  highlightedCitationId?: string | null;
  onCitationClick?: (citationId: string) => void;
  onClose?: () => void;
}

export const SourcePanel: React.FC<SourcePanelProps> = ({
  sources,
  highlightedCitationId,
  onCitationClick,
  onClose,
}) => {
  const [expandedChunkIds, setExpandedChunkIds] = useState<Set<string>>(new Set());

  const toggleExpand = (chunkId: string) => {
    const next = new Set(expandedChunkIds);
    if (next.has(chunkId)) {
      next.delete(chunkId);
    } else {
      next.add(chunkId);
    }
    setExpandedChunkIds(next);
  };

  if (!sources || sources.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-6 text-center text-xs text-theme-text-muted">
        <Bookmark className="w-8 h-8 opacity-30 mb-2" />
        <p>No supporting sources cited in the current conversation turn.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full space-y-3">
      {/* Drawer Header */}
      <div className="flex items-center justify-between pb-2 border-b border-theme-border">
        <div className="flex items-center gap-2">
          <Bookmark className="w-4 h-4 text-theme-accent" />
          <h4 className="text-xs font-semibold uppercase tracking-wider text-theme-text">
            Verified Evidence ({sources.length})
          </h4>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="p-1 rounded-md text-theme-text-muted hover:text-theme-text hover:bg-theme-surface-secondary transition-colors"
            title="Close evidence panel"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      <p className="text-[11px] text-theme-text-muted">
        Select any citation badge to highlight the ground truth excerpt.
      </p>

      {/* Sources List */}
      <div className="flex-1 overflow-y-auto space-y-2.5 pr-1 custom-scrollbar">
        {sources.map((source) => {
          const isHighlighted = highlightedCitationId === source.citationId;
          const isExpanded = expandedChunkIds.has(source.chunkId);

          return (
            <div
              key={source.chunkId}
              id={`source-${source.citationId.replace(/[^a-zA-Z0-9]/g, '')}`}
              onClick={() => onCitationClick?.(source.citationId)}
              className={`rounded-xl border transition-all p-3 text-left ${
                isHighlighted
                  ? 'border-theme-accent bg-theme-accent/10 shadow-subtle ring-1 ring-theme-accent/40'
                  : 'border-theme-border bg-theme-surface hover:border-theme-border/80'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="px-1.5 py-0.5 rounded text-[11px] font-mono font-bold bg-theme-accent/20 text-theme-accent border border-theme-accent/30">
                    {source.citationId}
                  </span>
                  <div className="flex items-center gap-1 text-xs font-medium text-theme-text">
                    <FileText className="w-3.5 h-3.5 text-theme-text-muted" />
                    <span className="truncate max-w-[180px]" title={source.documentName}>
                      {source.documentName}
                    </span>
                  </div>
                  {source.pageRange && (
                    <span className="px-1 py-0.2 rounded text-[10px] font-mono bg-theme-surface-secondary text-theme-text-secondary border border-theme-border">
                      {source.pageRange}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="text-[10px] font-mono text-theme-text-muted">
                    {(source.score * 100).toFixed(0)}%
                  </span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleExpand(source.chunkId);
                    }}
                    className="p-1 rounded text-theme-text-muted hover:text-theme-text transition-colors"
                  >
                    {isExpanded ? (
                      <ChevronUp className="w-3.5 h-3.5" />
                    ) : (
                      <ChevronDown className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
              </div>

              {/* Chunk Content Preview */}
              <div className="mt-2 text-xs text-theme-text-secondary leading-relaxed font-sans">
                <p className={isExpanded ? '' : 'line-clamp-2'}>{source.content}</p>
              </div>

              {isExpanded && (
                <div className="mt-2 pt-2 border-t border-theme-border/60 flex items-center justify-between text-[11px] text-theme-text-muted">
                  <span>Chunk #{source.chunkIndex + 1}</span>
                  <span className="flex items-center gap-1 text-theme-accent">
                    <ExternalLink className="w-3 h-3" />
                    <span>Ground Truth</span>
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
