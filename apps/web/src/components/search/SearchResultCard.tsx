import React, { useState } from 'react';
import type { SearchResultItem } from '@mindvault/shared';
import { SourceCitation } from './SourceCitation';
import { ChevronDown, ChevronUp, Copy, Check } from 'lucide-react';

interface SearchResultCardProps {
  result: SearchResultItem;
}

export const SearchResultCard: React.FC<SearchResultCardProps> = ({ result }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [hasCopied, setHasCopied] = useState(false);

  const section =
    (result.metadata?.heading as string) || (result.metadata?.section as string) || null;

  const pageRange =
    result.pageStart !== null && result.pageStart !== undefined
      ? result.pageEnd && result.pageEnd > result.pageStart
        ? `pp. ${result.pageStart}-${result.pageEnd}`
        : `p. ${result.pageStart}`
      : null;

  const handleCopy = () => {
    navigator.clipboard.writeText(result.content);
    setHasCopied(true);
    setTimeout(() => setHasCopied(false), 2000);
  };

  const isMultiSource = result.retrievalSources.length > 1;

  return (
    <div className="rounded-xl border border-vault-800 bg-vault-900/40 hover:border-vault-700 transition-colors p-4 space-y-3">
      {/* Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <SourceCitation
            citationId={result.citationId}
            documentName={result.documentName}
            chunkIndex={result.chunkIndex}
            pageRange={pageRange}
            section={section}
          />
        </div>

        <div className="flex items-center gap-2">
          {/* Retrieval Source Tags */}
          <div className="flex items-center gap-1">
            {result.retrievalSources.includes('semantic') && (
              <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-500/10 text-blue-400 border border-blue-500/20">
                Vector
              </span>
            )}
            {result.retrievalSources.includes('keyword') && (
              <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                Keyword
              </span>
            )}
            {isMultiSource && (
              <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-purple-500/10 text-purple-400 border border-purple-500/20">
                Fused Match
              </span>
            )}
          </div>

          {/* Relevance Score Badge */}
          <span className="px-2 py-0.5 rounded text-[11px] font-mono font-medium bg-vault-800 text-vault-300 border border-vault-700">
            Score: {result.score.toFixed(4)}
          </span>

          {/* Copy Button */}
          <button
            type="button"
            onClick={handleCopy}
            title="Copy chunk text"
            className="p-1.5 rounded-lg text-vault-400 hover:text-white hover:bg-vault-800 transition-colors"
          >
            {hasCopied ? (
              <Check className="w-3.5 h-3.5 text-emerald-400" />
            ) : (
              <Copy className="w-3.5 h-3.5" />
            )}
          </button>
        </div>
      </div>

      {/* Chunk Content */}
      <div className="text-sm text-vault-200 leading-relaxed font-sans">
        <p className={isExpanded ? '' : 'line-clamp-3'}>{result.content}</p>
      </div>

      {/* Footer Details & Expand Toggle */}
      <div className="flex items-center justify-between pt-2 border-t border-vault-800/60 text-[11px] text-vault-500">
        <span className="font-mono">Token estimate: {result.tokenCount} tokens</span>

        {result.content.length > 200 && (
          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex items-center gap-1 text-vault-400 hover:text-white font-medium transition-colors"
          >
            <span>{isExpanded ? 'Show less' : 'Read full chunk'}</span>
            {isExpanded ? (
              <ChevronUp className="w-3.5 h-3.5" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5" />
            )}
          </button>
        )}
      </div>
    </div>
  );
};
