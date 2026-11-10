import React from 'react';
import { X, Quote, FileText, CheckCircle2, ShieldCheck, ArrowRight } from 'lucide-react';
import type { RelationEvidenceDetailDto } from '@mindvault/shared';

interface RelationEvidenceDrawerProps {
  relation: RelationEvidenceDetailDto | null;
  onClose: () => void;
}

export const RelationEvidenceDrawer: React.FC<RelationEvidenceDrawerProps> = ({
  relation,
  onClose,
}) => {
  if (!relation) return null;

  return (
    <div className="w-80 sm:w-96 h-full bg-theme-surface border-l border-theme-border shadow-modal flex flex-col z-30 animate-fadeIn">
      {/* Header */}
      <div className="p-4 border-b border-theme-border/60 flex items-start justify-between gap-3 bg-theme-surface-secondary/30">
        <div className="space-y-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold uppercase tracking-wider bg-theme-accent/15 text-theme-accent border border-theme-accent/25">
              Verified Relation
            </span>
            <span className="text-[11px] font-mono text-theme-text-muted">
              Confidence: {Math.round(relation.confidence * 100)}%
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-xs font-semibold text-theme-text truncate pt-1">
            <span className="truncate text-theme-accent">
              {relation.sourceEntity.canonicalName}
            </span>
            <ArrowRight className="w-3 h-3 text-theme-text-muted shrink-0" />
            <span className="truncate text-theme-text">{relation.targetEntity.canonicalName}</span>
          </div>
          <div className="text-[11px] font-mono font-medium text-theme-text-secondary">
            [{relation.relationType}]
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg text-theme-text-muted hover:text-theme-text hover:bg-theme-surface transition-colors"
          title="Close evidence"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar text-xs">
        {/* Metric Badges */}
        <div className="grid grid-cols-2 gap-2">
          <div className="p-2.5 rounded-xl bg-theme-surface-secondary/50 border border-theme-border/50 text-center">
            <div className="text-base font-bold text-theme-accent">
              {Math.round(relation.confidence * 100)}%
            </div>
            <div className="text-[10px] text-theme-text-muted font-medium">Confidence</div>
          </div>
          <div className="p-2.5 rounded-xl bg-theme-surface-secondary/50 border border-theme-border/50 text-center">
            <div className="text-base font-bold text-theme-text">{relation.evidence.length}</div>
            <div className="text-[10px] text-theme-text-muted font-medium">Supporting Chunks</div>
          </div>
        </div>

        {/* Evidence Chunks List */}
        <div className="space-y-3">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-theme-text-muted">
            <CheckCircle2 className="w-3 h-3 text-emerald-500" />
            <span>Grounded Source Evidence ({relation.evidence.length})</span>
          </div>

          {relation.evidence.length === 0 ? (
            <div className="text-theme-text-muted italic text-[11px] p-3 rounded-xl bg-theme-surface-secondary/30">
              No direct snippet evidence recorded for this relation.
            </div>
          ) : (
            relation.evidence.map((ev, idx) => (
              <div
                key={ev.evidenceId || idx}
                className="p-3 rounded-xl bg-theme-surface-secondary/40 border border-theme-border/60 space-y-2.5 shadow-xs"
              >
                {/* Document Metadata header */}
                <div className="flex items-center justify-between gap-2 text-[11px]">
                  <div className="flex items-center gap-1.5 truncate text-theme-text font-medium">
                    <FileText className="w-3.5 h-3.5 text-theme-accent shrink-0" />
                    <span className="truncate">{ev.documentName}</span>
                  </div>
                  {ev.pageStart !== null && (
                    <span className="px-1.5 py-0.5 rounded bg-theme-surface border border-theme-border/70 text-[10px] font-mono text-theme-text-muted shrink-0">
                      p. {ev.pageStart}
                      {ev.pageEnd && ev.pageEnd !== ev.pageStart ? `–${ev.pageEnd}` : ''}
                    </span>
                  )}
                </div>

                {/* Grounded Citation Snippet */}
                <div className="relative pl-3 border-l-2 border-theme-accent/60 text-theme-text-secondary leading-relaxed italic text-[11px]">
                  "{ev.snippet}"
                </div>

                {/* Evidence Confidence */}
                <div className="flex items-center justify-between text-[10px] font-mono text-theme-text-muted pt-1 border-t border-theme-border/30">
                  <span>Chunk: {ev.chunkId.slice(0, 8)}...</span>
                  <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                    Score: {Math.round(ev.confidence * 100)}%
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
