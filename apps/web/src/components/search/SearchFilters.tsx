import React from 'react';
import { Filter, X } from 'lucide-react';

export interface FilterState {
  fileTypes: string[];
  pageStart?: number;
  pageEnd?: number;
  enableReranking: boolean;
  includeContext: boolean;
  maxContextTokens: number;
}

interface SearchFiltersProps {
  filters: FilterState;
  onChange: (filters: FilterState) => void;
  isOpen: boolean;
  onToggle: () => void;
}

const AVAILABLE_EXTENSIONS = ['pdf', 'md', 'docx', 'txt'];

export const SearchFilters: React.FC<SearchFiltersProps> = ({
  filters,
  onChange,
  isOpen,
  onToggle,
}) => {
  const toggleFileType = (ext: string) => {
    const exists = filters.fileTypes.includes(ext);
    const updated = exists
      ? filters.fileTypes.filter((t) => t !== ext)
      : [...filters.fileTypes, ext];
    onChange({ ...filters, fileTypes: updated });
  };

  const handleReset = () => {
    onChange({
      fileTypes: [],
      pageStart: undefined,
      pageEnd: undefined,
      enableReranking: false,
      includeContext: true,
      maxContextTokens: 3000,
    });
  };

  const hasActiveFilters =
    filters.fileTypes.length > 0 ||
    filters.pageStart !== undefined ||
    filters.pageEnd !== undefined ||
    filters.enableReranking ||
    !filters.includeContext;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onToggle}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
            isOpen || hasActiveFilters
              ? 'bg-theme-surface-secondary text-theme-text border-theme-border font-medium'
              : 'bg-theme-surface text-theme-text-muted border-theme-border hover:text-theme-text hover:bg-theme-surface-secondary'
          }`}
        >
          <Filter className="w-3.5 h-3.5 text-theme-text-muted" />
          <span>Filters & Configuration</span>
          {hasActiveFilters && <span className="w-2 h-2 rounded-full bg-theme-accent ml-1" />}
        </button>

        {hasActiveFilters && (
          <button
            type="button"
            onClick={handleReset}
            className="text-xs text-theme-text-muted hover:text-theme-text flex items-center gap-1"
          >
            <X className="w-3 h-3" />
            <span>Reset filters</span>
          </button>
        )}
      </div>

      {isOpen && (
        <div className="p-4 rounded-xl border border-theme-border bg-theme-surface space-y-4 shadow-xs">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
            {/* File Types */}
            <div>
              <label className="text-xs font-semibold text-theme-text block mb-2">
                File Extensions
              </label>
              <div className="flex flex-wrap gap-1.5">
                {AVAILABLE_EXTENSIONS.map((ext) => {
                  const active = filters.fileTypes.includes(ext);
                  return (
                    <button
                      key={ext}
                      type="button"
                      onClick={() => toggleFileType(ext)}
                      className={`px-2 py-1 rounded text-xs font-mono uppercase transition-colors ${
                        active
                          ? 'bg-theme-accent/20 text-theme-text border border-theme-accent/40 font-semibold'
                          : 'bg-theme-surface-secondary text-theme-text-muted border border-theme-border hover:text-theme-text'
                      }`}
                    >
                      {ext}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Page Range */}
            <div>
              <label className="text-xs font-semibold text-theme-text block mb-2">Page Range</label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="1"
                  placeholder="From"
                  value={filters.pageStart || ''}
                  onChange={(e) =>
                    onChange({
                      ...filters,
                      pageStart: e.target.value ? parseInt(e.target.value, 10) : undefined,
                    })
                  }
                  className="w-16 px-2 py-1 rounded bg-theme-surface-secondary border border-theme-border text-xs text-theme-text outline-none"
                />
                <span className="text-theme-text-muted text-xs">to</span>
                <input
                  type="number"
                  min="1"
                  placeholder="To"
                  value={filters.pageEnd || ''}
                  onChange={(e) =>
                    onChange({
                      ...filters,
                      pageEnd: e.target.value ? parseInt(e.target.value, 10) : undefined,
                    })
                  }
                  className="w-16 px-2 py-1 rounded bg-theme-surface-secondary border border-theme-border text-xs text-theme-text outline-none"
                />
              </div>
            </div>

            {/* Context Assembly */}
            <div>
              <label className="text-xs font-semibold text-theme-text block mb-2">
                Context Token Budget
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min="500"
                  max="8000"
                  step="500"
                  value={filters.maxContextTokens}
                  onChange={(e) =>
                    onChange({
                      ...filters,
                      maxContextTokens: parseInt(e.target.value, 10),
                    })
                  }
                  className="w-full accent-theme-accent"
                />
                <span className="text-xs font-mono text-theme-text-muted whitespace-nowrap">
                  {filters.maxContextTokens} tok
                </span>
              </div>
            </div>

            {/* Toggles */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-theme-text block mb-1">Options</label>
              <label className="flex items-center gap-2 text-xs text-theme-text-muted cursor-pointer hover:text-theme-text">
                <input
                  type="checkbox"
                  checked={filters.includeContext}
                  onChange={(e) => onChange({ ...filters, includeContext: e.target.checked })}
                  className="rounded border-theme-border bg-theme-surface-secondary text-theme-accent focus:ring-0"
                />
                <span>Include Assembled Context</span>
              </label>
              <label className="flex items-center gap-2 text-xs text-theme-text-muted cursor-pointer hover:text-theme-text">
                <input
                  type="checkbox"
                  checked={filters.enableReranking}
                  onChange={(e) => onChange({ ...filters, enableReranking: e.target.checked })}
                  className="rounded border-theme-border bg-theme-surface-secondary text-theme-accent focus:ring-0"
                />
                <span>Enable Reranking (Fallback if offline)</span>
              </label>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
