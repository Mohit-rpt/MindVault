import React from 'react';
import { X, Network, FileText, Tag, ArrowRight, ShieldCheck, Hash } from 'lucide-react';
import type { GraphEntityDetailDto } from '@mindvault/shared';

interface EntityDetailDrawerProps {
  entity: GraphEntityDetailDto | null;
  onClose: () => void;
  onExploreNeighborhood: (entityId: string) => void;
}

const TYPE_COLORS: Record<string, string> = {
  CONCEPT: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20',
  TECHNOLOGY: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
  ORGANIZATION: 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20',
  PERSON: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
  LOCATION: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20',
  METRIC: 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border-cyan-500/20',
  PRODUCT: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20',
};

export const EntityDetailDrawer: React.FC<EntityDetailDrawerProps> = ({
  entity,
  onClose,
  onExploreNeighborhood,
}) => {
  if (!entity) return null;

  const typeColor =
    TYPE_COLORS[entity.entityType.toUpperCase()] ||
    'bg-theme-surface-secondary text-theme-text-secondary border-theme-border/60';

  return (
    <div className="w-80 sm:w-96 h-full bg-theme-surface border-l border-theme-border shadow-modal flex flex-col z-30 animate-fadeIn">
      {/* Drawer Header */}
      <div className="p-4 border-b border-theme-border/60 flex items-start justify-between gap-3 bg-theme-surface-secondary/30">
        <div className="space-y-1 min-w-0">
          <div className="flex items-center gap-2">
            <span
              className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold uppercase tracking-wider border ${typeColor}`}
            >
              {entity.entityType}
            </span>
            <span className="text-[11px] font-mono text-theme-text-muted">
              Degree: {entity.totalDegree}
            </span>
          </div>
          <h2
            className="text-base font-semibold text-theme-text truncate"
            title={entity.canonicalName}
          >
            {entity.canonicalName}
          </h2>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg text-theme-text-muted hover:text-theme-text hover:bg-theme-surface transition-colors"
          title="Close details"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Drawer Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-5 custom-scrollbar text-xs">
        {/* Description Section */}
        <div className="space-y-1.5">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-theme-text-muted">
            Description
          </div>
          <p className="text-theme-text-secondary leading-relaxed bg-theme-surface-secondary/40 p-2.5 rounded-xl border border-theme-border/50">
            {entity.description || 'No detailed description extracted for this entity.'}
          </p>
        </div>

        {/* Connectivity Metrics */}
        <div className="grid grid-cols-3 gap-2">
          <div className="p-2.5 rounded-xl bg-theme-surface-secondary/50 border border-theme-border/50 text-center">
            <div className="text-base font-bold text-theme-accent">{entity.totalDegree}</div>
            <div className="text-[10px] text-theme-text-muted font-medium">Total Degree</div>
          </div>
          <div className="p-2.5 rounded-xl bg-theme-surface-secondary/50 border border-theme-border/50 text-center">
            <div className="text-base font-bold text-theme-text">{entity.inDegree}</div>
            <div className="text-[10px] text-theme-text-muted font-medium">In-Degree</div>
          </div>
          <div className="p-2.5 rounded-xl bg-theme-surface-secondary/50 border border-theme-border/50 text-center">
            <div className="text-base font-bold text-theme-text">{entity.outDegree}</div>
            <div className="text-[10px] text-theme-text-muted font-medium">Out-Degree</div>
          </div>
        </div>

        {/* Aliases & Acronyms */}
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-theme-text-muted">
            <Tag className="w-3 h-3 text-theme-accent" />
            <span>Aliases & Synonyms ({entity.aliases.length})</span>
          </div>
          {entity.aliases.length === 0 ? (
            <div className="text-theme-text-muted italic text-[11px]">No synonyms recorded.</div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {entity.aliases.map((alias) => (
                <span
                  key={alias}
                  className="px-2 py-0.5 rounded-lg bg-theme-surface-secondary border border-theme-border/60 text-theme-text text-[11px] font-mono"
                >
                  {alias}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Document Mentions & Provenance */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-theme-text-muted">
              <FileText className="w-3 h-3 text-theme-accent" />
              <span>Document References ({entity.documentReferences.length})</span>
            </div>
            <span className="text-[10px] font-mono text-theme-text-muted">
              {entity.mentionCount} mentions
            </span>
          </div>

          {entity.documentReferences.length === 0 ? (
            <div className="text-theme-text-muted italic text-[11px]">
              No document mentions found.
            </div>
          ) : (
            <div className="space-y-1.5">
              {entity.documentReferences.map((ref) => (
                <div
                  key={ref.documentId}
                  className="flex items-center justify-between p-2 rounded-xl bg-theme-surface-secondary/40 border border-theme-border/50"
                >
                  <div className="flex items-center gap-2 truncate pr-2">
                    <FileText className="w-3.5 h-3.5 text-theme-accent shrink-0" />
                    <span className="truncate text-theme-text font-medium text-[11px]">
                      {ref.documentName}
                    </span>
                  </div>
                  <span className="px-1.5 py-0.5 rounded bg-theme-accent/10 text-theme-accent text-[10px] font-mono shrink-0">
                    {ref.mentionCount}x
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Drawer Actions Footer */}
      <div className="p-3.5 border-t border-theme-border/60 bg-theme-surface-secondary/20 flex gap-2">
        <button
          onClick={() => onExploreNeighborhood(entity.id)}
          className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-theme-accent hover:bg-theme-accent-hover text-white font-medium text-xs shadow-subtle transition-all"
        >
          <Network className="w-3.5 h-3.5" />
          <span>Expand Neighborhood</span>
        </button>
      </div>
    </div>
  );
};
