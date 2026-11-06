import React, { useState } from 'react';
import type { SearchResponseDto } from '@mindvault/shared';
import { SearchResultCard } from './SearchResultCard';
import { RetrievalMetadata } from './RetrievalMetadata';
import { Search, FileQuestion, BookOpen, Copy, Check } from 'lucide-react';

interface SearchResultsProps {
  response: SearchResponseDto | null;
  isLoading: boolean;
  error: string | null;
}

export const SearchResults: React.FC<SearchResultsProps> = ({ response, isLoading, error }) => {
  const [activeView, setActiveView] = useState<'ranked' | 'context'>('ranked');
  const [copiedContext, setCopiedContext] = useState(false);

  if (isLoading) {
    return (
      <div className="space-y-4 py-6">
        <div className="animate-pulse space-y-3">
          <div className="h-10 bg-theme-surface-secondary rounded-xl" />
          <div className="h-32 bg-theme-surface rounded-xl border border-theme-border" />
          <div className="h-32 bg-theme-surface rounded-xl border border-theme-border" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 rounded-2xl border border-rose-500/20 bg-rose-500/10 text-center space-y-2">
        <h4 className="text-sm font-semibold text-rose-600 dark:text-rose-400">Search Failed</h4>
        <p className="text-xs text-rose-700/80 dark:text-rose-300/80">{error}</p>
      </div>
    );
  }

  if (!response) {
    return (
      <div className="py-16 text-center space-y-3 border border-dashed border-theme-border rounded-2xl bg-theme-surface/50">
        <Search className="w-10 h-10 text-theme-text-muted mx-auto opacity-50" />
        <h4 className="text-sm font-medium text-theme-text">Ready to Search Knowledge</h4>
        <p className="text-xs text-theme-text-muted max-w-sm mx-auto">
          Enter a query above to retrieve evidence-grounded chunks via semantic vector similarity,
          full-text search, or reciprocal rank fusion.
        </p>
      </div>
    );
  }

  if (response.results.length === 0) {
    return (
      <div className="py-16 text-center space-y-3 border border-theme-border rounded-2xl bg-theme-surface/50">
        <FileQuestion className="w-10 h-10 text-theme-text-muted mx-auto opacity-50" />
        <h4 className="text-sm font-medium text-theme-text">No matching chunks found</h4>
        <p className="text-xs text-theme-text-muted max-w-sm mx-auto">
          No document chunks matched your query and filter criteria. Try adjusting your query or
          loosening metadata filters.
        </p>
      </div>
    );
  }

  const handleCopyContext = () => {
    if (!response.context?.content) return;
    navigator.clipboard.writeText(response.context.content);
    setCopiedContext(true);
    setTimeout(() => setCopiedContext(false), 2000);
  };

  return (
    <div className="space-y-4">
      {/* Telemetry Bar */}
      <RetrievalMetadata metadata={response.metadata} />

      {/* View Switcher: Ranked Chunks vs Assembled RAG Context */}
      {response.context && (
        <div className="flex items-center justify-between border-b border-theme-border pb-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveView('ranked')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                activeView === 'ranked'
                  ? 'bg-theme-surface-secondary text-theme-text border border-theme-border font-medium'
                  : 'text-theme-text-muted hover:text-theme-text hover:bg-theme-surface-secondary'
              }`}
            >
              Ranked Candidates ({response.results.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveView('context')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors ${
                activeView === 'context'
                  ? 'bg-theme-surface-secondary text-theme-text border border-theme-border font-medium'
                  : 'text-theme-text-muted hover:text-theme-text hover:bg-theme-surface-secondary'
              }`}
            >
              <BookOpen className="w-3.5 h-3.5 text-purple-500" />
              <span>Assembled RAG Context ({response.context.sources.length} sources)</span>
            </button>
          </div>

          {activeView === 'context' && (
            <button
              type="button"
              onClick={handleCopyContext}
              className="flex items-center gap-1 text-xs text-theme-text-muted hover:text-theme-text transition-colors"
            >
              {copiedContext ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-500" />
                  <span className="text-emerald-500 font-medium">Copied Context</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy Formatted Context</span>
                </>
              )}
            </button>
          )}
        </div>
      )}

      {/* View 1: Ranked Chunks */}
      {activeView === 'ranked' && (
        <div className="space-y-3">
          {response.results.map((result) => (
            <SearchResultCard key={result.chunkId} result={result} />
          ))}
        </div>
      )}

      {/* View 2: Assembled Context */}
      {activeView === 'context' && response.context && (
        <div className="rounded-2xl border border-theme-border bg-theme-surface p-4 space-y-4 shadow-xs">
          <div className="flex items-center justify-between text-xs text-theme-text-muted pb-2 border-b border-theme-border">
            <span>Structured Context Payload (~{response.context.tokenEstimate} tokens)</span>
            <span className="text-[11px] text-theme-text-muted">Ready for LLM Grounding</span>
          </div>

          <pre className="text-xs font-mono text-theme-text whitespace-pre-wrap leading-relaxed overflow-x-auto max-h-[500px] p-3 rounded-xl bg-theme-code border border-theme-border">
            {response.context.content}
          </pre>
        </div>
      )}
    </div>
  );
};
