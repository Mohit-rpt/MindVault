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
              ? 'bg-vault-800 text-white border-vault-700'
              : 'bg-vault-900/60 text-vault-400 border-vault-800 hover:text-white hover:bg-vault-800/40'
          }`}
        >
          <Filter className="w-3.5 h-3.5 text-vault-400" />
          <span>Filters & Configuration</span>
          {hasActiveFilters && <span className="w-2 h-2 rounded-full bg-blue-400 ml-1" />}
        </button>

        {hasActiveFilters && (
          <button
            type="button"
            onClick={handleReset}
            className="text-xs text-vault-500 hover:text-vault-300 flex items-center gap-1"
          >
            <X className="w-3 h-3" />
            <span>Reset filters</span>
          </button>
        )}
      </div>

      {isOpen && (
        <div className="p-4 rounded-xl border border-vault-800 bg-vault-900/40 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
            {/* File Types */}
            <div>
              <label className="text-xs font-semibold text-vault-300 block mb-2">
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
                          ? 'bg-blue-500/20 text-blue-300 border border-blue-500/40 font-semibold'
                          : 'bg-vault-800 text-vault-400 border border-vault-700 hover:text-white'
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
              <label className="text-xs font-semibold text-vault-300 block mb-2">Page Range</label>
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
                  className="w-16 px-2 py-1 rounded bg-vault-950 border border-vault-700 text-xs text-white"
                />
                <span className="text-vault-500 text-xs">to</span>
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
                  className="w-16 px-2 py-1 rounded bg-vault-950 border border-vault-700 text-xs text-white"
                />
              </div>
            </div>

            {/* Context Assembly */}
            <div>
              <label className="text-xs font-semibold text-vault-300 block mb-2">
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
                  className="w-full accent-blue-500"
                />
                <span className="text-xs font-mono text-vault-300 whitespace-nowrap">
                  {filters.maxContextTokens} tok
                </span>
              </div>
            </div>

            {/* Toggles */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-vault-300 block mb-1">Options</label>
              <label className="flex items-center gap-2 text-xs text-vault-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={filters.includeContext}
                  onChange={(e) => onChange({ ...filters, includeContext: e.target.checked })}
                  className="rounded border-vault-700 bg-vault-950 text-blue-500 focus:ring-0"
                />
                <span>Include Assembled Context</span>
              </label>
              <label className="flex items-center gap-2 text-xs text-vault-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={filters.enableReranking}
                  onChange={(e) => onChange({ ...filters, enableReranking: e.target.checked })}
                  className="rounded border-vault-700 bg-vault-950 text-blue-500 focus:ring-0"
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
