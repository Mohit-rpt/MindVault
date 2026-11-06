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
    <div className="rounded-lg border border-vault-800 bg-vault-900/40 p-3 text-xs text-vault-400">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-1.5 text-white font-medium">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
            <span>
              {totalResults} {totalResults === 1 ? 'match' : 'matches'} retrieved
            </span>
          </div>

          <div className="flex items-center gap-1.5 text-vault-300">
            <Clock className="w-3.5 h-3.5 text-blue-400" />
            <span>{timings.totalMs} ms total</span>
          </div>

          <div className="flex items-center gap-2">
            {semanticSearchUsed && (
              <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-blue-500/10 text-blue-400 border border-blue-500/20">
                Vector pgvector
              </span>
            )}
            {keywordSearchUsed && (
              <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                FTS tsvector
              </span>
            )}
            <span
              className={`px-2 py-0.5 rounded text-[10px] font-medium border ${
                rerankingApplied
                  ? 'bg-purple-500/10 text-purple-400 border-purple-500/20'
                  : 'bg-vault-800/60 text-vault-400 border-vault-700'
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
          className="flex items-center gap-1 text-[11px] text-vault-400 hover:text-white transition-colors"
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
        <div className="mt-3 pt-3 border-t border-vault-800/80 grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
          <div className="p-2 rounded bg-vault-950/40 border border-vault-800/50">
            <span className="text-vault-500 block">Query Normalization</span>
            <span className="font-mono text-vault-200">{timings.queryProcessingMs} ms</span>
          </div>
          {timings.embeddingGenerationMs !== undefined && (
            <div className="p-2 rounded bg-vault-950/40 border border-vault-800/50">
              <span className="text-vault-500 block">Query Embedding</span>
              <span className="font-mono text-vault-200">{timings.embeddingGenerationMs} ms</span>
            </div>
          )}
          {timings.semanticSearchMs !== undefined && (
            <div className="p-2 rounded bg-vault-950/40 border border-vault-800/50">
              <span className="text-vault-500 block">pgvector Cosine Search</span>
              <span className="font-mono text-vault-200">{timings.semanticSearchMs} ms</span>
            </div>
          )}
          {timings.keywordSearchMs !== undefined && (
            <div className="p-2 rounded bg-vault-950/40 border border-vault-800/50">
              <span className="text-vault-500 block">PostgreSQL FTS</span>
              <span className="font-mono text-vault-200">{timings.keywordSearchMs} ms</span>
            </div>
          )}
          {timings.fusionMs !== undefined && (
            <div className="p-2 rounded bg-vault-950/40 border border-vault-800/50">
              <span className="text-vault-500 block">RRF Fusion (k=60)</span>
              <span className="font-mono text-vault-200">{timings.fusionMs} ms</span>
            </div>
          )}
          {timings.contextAssemblyMs !== undefined && (
            <div className="p-2 rounded bg-vault-950/40 border border-vault-800/50">
              <span className="text-vault-500 block">Context Assembly</span>
              <span className="font-mono text-vault-200">{timings.contextAssemblyMs} ms</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
