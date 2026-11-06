import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { SearchInput } from './SearchInput';
import { SearchModeSelector } from './SearchModeSelector';
import { SearchFilters, type FilterState } from './SearchFilters';
import { SearchResults } from './SearchResults';
import type { ApiResponse, RetrievalMode, SearchResponseDto } from '@mindvault/shared';
import { Sparkles, ShieldCheck, Database } from 'lucide-react';

export const KnowledgeSearch: React.FC = () => {
  const { activeWorkspace, accessToken } = useAuth();

  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<RetrievalMode>('hybrid');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState<FilterState>({
    fileTypes: [],
    pageStart: undefined,
    pageEnd: undefined,
    enableReranking: false,
    includeContext: true,
    maxContextTokens: 3000,
  });

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchResponse, setSearchResponse] = useState<SearchResponseDto | null>(null);

  const handleSearch = async () => {
    if (!query.trim() || !activeWorkspace || !accessToken) return;

    setIsLoading(true);
    setError(null);

    try {
      const payload = {
        query: query.trim(),
        mode,
        topK: 10,
        includeContext: filters.includeContext,
        maxContextTokens: filters.maxContextTokens,
        enableReranking: filters.enableReranking,
        filters: {
          fileTypes: filters.fileTypes.length > 0 ? filters.fileTypes : undefined,
          pageStart: filters.pageStart,
          pageEnd: filters.pageEnd,
        },
      };

      const res = await fetch('/api/retrieval/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
          'X-Workspace-ID': activeWorkspace.id,
        },
        body: JSON.stringify(payload),
      });

      const json: ApiResponse<SearchResponseDto> = await res.json();

      if (!res.ok || !json.success) {
        throw new Error(json.error?.message || `Search failed with status ${res.status}`);
      }

      if (json.data) {
        setSearchResponse(json.data);
      }
    } catch (err: any) {
      setError(err.message || 'An error occurred during retrieval');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="rounded-xl border border-vault-800 bg-vault-900/40 p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-white">Knowledge Search & Retrieval</h2>
              <p className="text-xs text-vault-400">
                Evidence-grounded hybrid search across indexed workspace documents
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium bg-purple-500/10 text-purple-400 border border-purple-500/20">
              <Database className="w-3 h-3" />
              <span>pgvector + FTS (RRF k=60)</span>
            </span>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <ShieldCheck className="w-3 h-3" />
              <span>Tenancy Isolated</span>
            </span>
          </div>
        </div>

        {/* Search Controls */}
        <div className="space-y-3 pt-2">
          <SearchInput
            value={query}
            onChange={setQuery}
            onSubmit={handleSearch}
            isLoading={isLoading}
          />

          <div className="flex flex-wrap items-center justify-between gap-3">
            <SearchModeSelector mode={mode} onChange={setMode} disabled={isLoading} />

            <SearchFilters
              filters={filters}
              onChange={setFilters}
              isOpen={filtersOpen}
              onToggle={() => setFiltersOpen(!filtersOpen)}
            />
          </div>
        </div>
      </div>

      {/* Results Section */}
      <SearchResults response={searchResponse} isLoading={isLoading} error={error} />
    </div>
  );
};
