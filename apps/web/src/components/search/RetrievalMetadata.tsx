import React, { useState } from 'react';
import type { SearchMetadataDto } from '@mindvault/shared';
import { Clock, CheckCircle2, ChevronDown, ChevronUp } from 'lucide-react';

interface RetrievalMetadataProps {
  metadata: SearchMetadataDto;
}

export const RetrievalMetadata: React.FC<RetrievalMetadataProps> = ({ metadata }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const { timings, semanticSearchUsed, keywordSearchUsed, rerankingApplied, totalResults } =
    metadata;

  return (
    <div className="rounded-xl border border-theme-border bg-theme-surface p-3 text-xs text-theme-text-muted shadow-xs">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-1.5 text-theme-text font-medium">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
            <span>
              {totalResults} {totalResults === 1 ? 'match' : 'matches'} retrieved
            </span>
          </div>

          <div className="flex items-center gap-1.5 text-theme-text-muted">
            <Clock className="w-3.5 h-3.5 text-blue-500" />
            <span>{timings.totalMs} ms total</span>
          </div>

          <div className="flex items-center gap-2">
            {semanticSearchUsed && (
              <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">
                Vector pgvector
              </span>
            )}
            {keywordSearchUsed && (
              <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                FTS tsvector
              </span>
            )}
            <span
              className={`px-2 py-0.5 rounded text-[10px] font-medium border ${
                rerankingApplied
                  ? 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20'
                  : 'bg-theme-surface-secondary text-theme-text-muted border-theme-border'
              }`}
              title={
                rerankingApplied
                  ? 'Model-based reranking rescored candidate results'
                  : 'Reranker is unconfigured or disabled; preserving native RRF order'
              }
            >
              Reranker: {rerankingApplied ? 'Active' : 'No-Op Fallback'}
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center gap-1 text-[11px] text-theme-text-muted hover:text-theme-text transition-colors"
        >
          <span>Telemetry Details</span>
          {isExpanded ? (
            <ChevronUp className="w-3.5 h-3.5" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5" />
          )}
        </button>
      </div>

      {isExpanded && (
        <div className="mt-3 pt-3 border-t border-theme-border grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
          <div className="p-2 rounded-lg bg-theme-surface-secondary border border-theme-border">
            <span className="text-theme-text-muted block">Query Normalization</span>
            <span className="font-mono text-theme-text font-medium">
              {timings.queryProcessingMs} ms
            </span>
          </div>
          {timings.embeddingGenerationMs !== undefined && (
            <div className="p-2 rounded-lg bg-theme-surface-secondary border border-theme-border">
              <span className="text-theme-text-muted block">Query Embedding</span>
              <span className="font-mono text-theme-text font-medium">
                {timings.embeddingGenerationMs} ms
              </span>
            </div>
          )}
          {timings.semanticSearchMs !== undefined && (
            <div className="p-2 rounded-lg bg-theme-surface-secondary border border-theme-border">
              <span className="text-theme-text-muted block">pgvector Cosine Search</span>
              <span className="font-mono text-theme-text font-medium">
                {timings.semanticSearchMs} ms
              </span>
            </div>
          )}
          {timings.keywordSearchMs !== undefined && (
            <div className="p-2 rounded-lg bg-theme-surface-secondary border border-theme-border">
              <span className="text-theme-text-muted block">PostgreSQL FTS</span>
              <span className="font-mono text-theme-text font-medium">
                {timings.keywordSearchMs} ms
              </span>
            </div>
          )}
          {timings.fusionMs !== undefined && (
            <div className="p-2 rounded-lg bg-theme-surface-secondary border border-theme-border">
              <span className="text-theme-text-muted block">RRF Fusion (k=60)</span>
              <span className="font-mono text-theme-text font-medium">{timings.fusionMs} ms</span>
            </div>
          )}
          {timings.contextAssemblyMs !== undefined && (
            <div className="p-2 rounded-lg bg-theme-surface-secondary border border-theme-border">
              <span className="text-theme-text-muted block">Context Assembly</span>
              <span className="font-mono text-theme-text font-medium">
                {timings.contextAssemblyMs} ms
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
