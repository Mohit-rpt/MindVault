import React from 'react';
import { Search, Filter, Layers, RefreshCw } from 'lucide-react';
import type { EntityType } from '@mindvault/shared';

interface GraphFilterBarProps {
  searchTerm: string;
  onSearchChange: (value: string) => void;
  selectedType: string;
  onTypeChange: (type: string) => void;
  depth: number;
  onDepthChange: (depth: number) => void;
  onRefresh: () => void;
  isLoading: boolean;
  totalEntities: number;
  totalRelations: number;
}

const ENTITY_TYPES: Array<{ label: string; value: string; color: string }> = [
  {
    label: 'All Types',
    value: 'ALL',
    color: 'bg-theme-surface-secondary text-theme-text-secondary',
  },
  {
    label: 'Concept',
    value: 'CONCEPT',
    color: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20',
  },
  {
    label: 'Technology',
    value: 'TECHNOLOGY',
    color: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
  },
  {
    label: 'Organization',
    value: 'ORGANIZATION',
    color: 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20',
  },
  {
    label: 'Person',
    value: 'PERSON',
    color: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
  },
  {
    label: 'Location',
    value: 'LOCATION',
    color: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20',
  },
  {
    label: 'Metric',
    value: 'METRIC',
    color: 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border-cyan-500/20',
  },
  {
    label: 'Product',
    value: 'PRODUCT',
    color: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20',
  },
];

export const GraphFilterBar: React.FC<GraphFilterBarProps> = ({
  searchTerm,
  onSearchChange,
  selectedType,
  onTypeChange,
  depth,
  onDepthChange,
  onRefresh,
  isLoading,
  totalEntities,
  totalRelations,
}) => {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-theme-surface border-b border-theme-border/60">
      {/* Left: Search & Filter Pills */}
      <div className="flex flex-wrap items-center gap-2.5 flex-1 min-w-[280px]">
        {/* Search input */}
        <div className="relative min-w-[200px] max-w-xs flex-1">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-theme-text-muted" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search entities & concepts..."
            className="w-full pl-8 pr-3 py-1.5 bg-theme-surface-secondary/70 border border-theme-border/80 rounded-xl text-xs text-theme-text placeholder-theme-text-muted focus:outline-none focus:border-theme-accent/50 transition-colors"
          />
        </div>

        {/* Entity Type Filter dropdown/pills */}
        <div className="flex items-center gap-1 overflow-x-auto custom-scrollbar py-0.5">
          {ENTITY_TYPES.slice(0, 5).map((t) => {
            const isActive = selectedType === t.value;
            return (
              <button
                key={t.value}
                onClick={() => onTypeChange(t.value)}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-colors shrink-0 ${
                  isActive
                    ? 'bg-theme-accent text-white border-theme-accent shadow-sm'
                    : 'bg-theme-surface-secondary text-theme-text-secondary border-theme-border/60 hover:text-theme-text hover:bg-theme-surface-hover'
                }`}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Right: Depth Selector, Stats & Refresh */}
      <div className="flex items-center gap-2.5 shrink-0">
        {/* Depth Selector */}
        <div className="flex items-center gap-1.5 px-2.5 py-1 bg-theme-surface-secondary/70 border border-theme-border/80 rounded-xl text-xs text-theme-text-secondary">
          <Layers className="w-3.5 h-3.5 text-theme-accent" />
          <span className="text-[11px] font-medium">Depth:</span>
          {[1, 2, 3].map((d) => (
            <button
              key={d}
              onClick={() => onDepthChange(d)}
              className={`w-5 h-5 rounded flex items-center justify-center text-[10px] font-semibold transition-colors ${
                depth === d
                  ? 'bg-theme-accent text-white shadow-xs'
                  : 'text-theme-text-muted hover:text-theme-text hover:bg-theme-surface'
              }`}
            >
              {d}
            </button>
          ))}
        </div>

        {/* Stats Pills */}
        <div className="hidden sm:flex items-center gap-1.5 text-[11px] font-mono text-theme-text-muted px-2 py-1 bg-theme-surface-secondary/50 rounded-lg border border-theme-border/50">
          <span>{totalEntities} entities</span>
          <span>•</span>
          <span>{totalRelations} relations</span>
        </div>

        {/* Refresh Button */}
        <button
          onClick={onRefresh}
          disabled={isLoading}
          className="p-1.5 rounded-xl border border-theme-border/80 bg-theme-surface hover:bg-theme-surface-hover text-theme-text-secondary hover:text-theme-text transition-colors disabled:opacity-50 shadow-subtle"
          title="Refresh Graph"
        >
          <RefreshCw
            className={`w-3.5 h-3.5 text-theme-accent ${isLoading ? 'animate-spin' : ''}`}
          />
        </button>
      </div>
    </div>
  );
};
