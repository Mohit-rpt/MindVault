import React from 'react';
import type { RetrievalMode } from '@mindvault/shared';
import { Sparkles, Layers, Type } from 'lucide-react';

interface SearchModeSelectorProps {
  mode: RetrievalMode;
  onChange: (mode: RetrievalMode) => void;
  disabled?: boolean;
}

export const SearchModeSelector: React.FC<SearchModeSelectorProps> = ({
  mode,
  onChange,
  disabled = false,
}) => {
  const modes: Array<{
    id: RetrievalMode;
    label: string;
    description: string;
    icon: React.ComponentType<{ className?: string }>;
    accentColor: string;
  }> = [
    {
      id: 'hybrid',
      label: 'Hybrid Search',
      description: 'Combines vector semantics & full-text with Reciprocal Rank Fusion (RRF)',
      icon: Sparkles,
      accentColor: 'text-purple-400 border-purple-500/30 bg-purple-500/10',
    },
    {
      id: 'semantic',
      label: 'Semantic Vector',
      description: 'pgvector 768-dim cosine similarity search over concepts',
      icon: Layers,
      accentColor: 'text-blue-400 border-blue-500/30 bg-blue-500/10',
    },
    {
      id: 'keyword',
      label: 'Keyword (FTS)',
      description: 'PostgreSQL tsvector full-text search with ts_rank_cd ranking',
      icon: Type,
      accentColor: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10',
    },
  ];

  return (
    <div className="flex flex-wrap gap-2">
      {modes.map((item) => {
        const Icon = item.icon;
        const isSelected = mode === item.id;

        return (
          <button
            key={item.id}
            type="button"
            disabled={disabled}
            onClick={() => onChange(item.id)}
            title={item.description}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
              isSelected
                ? `${item.accentColor} shadow-xs`
                : 'border-theme-border bg-theme-surface text-theme-text-muted hover:text-theme-text hover:bg-theme-surface-secondary'
            } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
          >
            <Icon className="w-3.5 h-3.5" />
            <span>{item.label}</span>
          </button>
        );
      })}
    </div>
  );
};
