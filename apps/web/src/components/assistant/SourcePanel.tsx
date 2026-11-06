import React, { useState } from 'react';
import type { ContextSourceItem } from '@mindvault/shared';
import { FileText, ChevronDown, ChevronUp, ExternalLink, Bookmark } from 'lucide-react';

interface SourcePanelProps {
  sources: ContextSourceItem[];
  highlightedCitationId?: string | null;
  onCitationClick?: (citationId: string) => void;
}

export const SourcePanel: React.FC<SourcePanelProps> = ({
  sources,
  highlightedCitationId,
  onCitationClick,
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
      <div className="rounded-xl border border-vault-800 bg-vault-900/30 p-5 text-center text-xs text-vault-500">
        No supporting evidence documents retrieved for this query.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-vault-400 flex items-center gap-1.5">
          <Bookmark className="w-3.5 h-3.5 text-blue-400" />
          <span>Verified Sources ({sources.length})</span>
        </h4>
        <span className="text-[11px] text-vault-500">Click a citation tag to inspect evidence</span>
      </div>

      <div className="grid grid-cols-1 gap-2.5">
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
                  ? 'border-blue-500/80 bg-blue-500/10 shadow-lg shadow-blue-500/10'
                  : 'border-vault-800/80 bg-vault-900/40 hover:border-vault-700'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="px-1.5 py-0.5 rounded text-xs font-mono font-bold bg-blue-500/20 text-blue-300 border border-blue-500/30">
                    {source.citationId}
                  </span>
                  <div className="flex items-center gap-1 text-xs font-medium text-white">
                    <FileText className="w-3.5 h-3.5 text-vault-400" />
                    <span className="truncate max-w-[220px]" title={source.documentName}>
                      {source.documentName}
                    </span>
                  </div>
                  {source.pageRange && (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-vault-800 text-vault-300 border border-vault-700">
                      {source.pageRange}
                    </span>
                  )}
                  {source.section && (
                    <span className="text-[11px] text-vault-400 italic truncate max-w-[180px]">
                      "{source.section}"
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-mono text-vault-400">
                    Score: {source.score.toFixed(3)}
                  </span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleExpand(source.chunkId);
                    }}
                    className="p-1 rounded text-vault-400 hover:text-white transition-colors"
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
              <div className="mt-2 text-xs text-vault-300 leading-relaxed">
                <p className={isExpanded ? '' : 'line-clamp-2'}>{source.content}</p>
              </div>

              {isExpanded && (
                <div className="mt-2 pt-2 border-t border-vault-800/60 flex items-center justify-between text-[11px] text-vault-500">
                  <span>Chunk Index: #{source.chunkIndex + 1}</span>
                  <span className="flex items-center gap-1 text-vault-400">
                    <ExternalLink className="w-3 h-3" />
                    <span>Authoritative Server Evidence</span>
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
