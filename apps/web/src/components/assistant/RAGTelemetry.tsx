import React, { useState } from 'react';
import type { RAGMetadataDto } from '@mindvault/shared';
import { Clock, Cpu, ChevronDown, ChevronUp, CheckCircle2 } from 'lucide-react';

interface RAGTelemetryProps {
  metadata?: RAGMetadataDto;
}

export const RAGTelemetry: React.FC<RAGTelemetryProps> = ({ metadata }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  if (!metadata) return null;
  const { timings, provider, model, totalSources, retrievalMode } = metadata;

  return (
    <div className="rounded-xl border border-vault-800 bg-vault-900/40 p-3 text-xs text-vault-400">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5 text-white font-medium">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
            <span>
              {totalSources} {totalSources === 1 ? 'source' : 'sources'} synthesized
            </span>
          </div>

          <div className="flex items-center gap-1.5 text-vault-300">
            <Clock className="w-3.5 h-3.5 text-blue-400" />
            <span>{timings.totalMs} ms total</span>
          </div>

          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-mono bg-purple-500/10 text-purple-400 border border-purple-500/20">
            <Cpu className="w-3 h-3" />
            <span>
              {provider}: {model}
            </span>
          </div>

          <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-vault-800 text-vault-300 border border-vault-700 capitalize">
            {retrievalMode} Mode
          </span>
        </div>

        <button
          type="button"
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center gap-1 text-[11px] text-vault-400 hover:text-white transition-colors"
        >
          <span>Latency Telemetry</span>
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
            <span className="text-vault-500 block">Hybrid Retrieval</span>
            <span className="font-mono text-vault-200">{timings.retrievalMs} ms</span>
          </div>
          <div className="p-2 rounded bg-vault-950/40 border border-vault-800/50">
            <span className="text-vault-500 block">Context Assembly</span>
            <span className="font-mono text-vault-200">{timings.contextAssemblyMs} ms</span>
          </div>
          <div className="p-2 rounded bg-vault-950/40 border border-vault-800/50">
            <span className="text-vault-500 block">Prompt Construction</span>
            <span className="font-mono text-vault-200">{timings.promptBuildingMs} ms</span>
          </div>
          <div className="p-2 rounded bg-vault-950/40 border border-vault-800/50">
            <span className="text-vault-500 block">LLM Generation</span>
            <span className="font-mono text-vault-200">{timings.generationDurationMs} ms</span>
          </div>
        </div>
      )}
    </div>
  );
};
