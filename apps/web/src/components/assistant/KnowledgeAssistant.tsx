import React, { useState, useRef } from 'react';
import type {
  ContextSourceItem,
  GroundingValidationResult,
  RAGMetadataDto,
  RetrievalMode,
} from '@mindvault/shared';
import { useAuth } from '../../context/AuthContext';
import { ChatComposer } from './ChatComposer';
import { StreamingAnswer } from './StreamingAnswer';
import { SourcePanel } from './SourcePanel';
import { GroundingBadge } from './GroundingBadge';
import { RAGTelemetry } from './RAGTelemetry';
import { Bot, AlertCircle, FileSearch, HelpCircle } from 'lucide-react';

interface KnowledgeAssistantProps {
  workspaceId: string;
}

export const KnowledgeAssistant: React.FC<KnowledgeAssistantProps> = ({ workspaceId }) => {
  const { accessToken } = useAuth();
  const [query, setQuery] = useState('');
  const [answer, setAnswer] = useState('');
  const [sources, setSources] = useState<ContextSourceItem[]>([]);
  const [grounding, setGrounding] = useState<GroundingValidationResult | null>(null);
  const [metadata, setMetadata] = useState<RAGMetadataDto | undefined>(undefined);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [highlightedCitationId, setHighlightedCitationId] = useState<string | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);

  const handleCitationClick = (citationId: string) => {
    setHighlightedCitationId(citationId);
    const elementId = `source-${citationId.replace(/[^a-zA-Z0-9]/g, '')}`;
    const el = document.getElementById(elementId);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsStreaming(false);
  };

  const handleSend = async (
    userQuery: string,
    options: { mode: RetrievalMode; topK: number; temperature: number },
  ) => {
    setQuery(userQuery);
    setAnswer('');
    setSources([]);
    setGrounding(null);
    setMetadata(undefined);
    setError(null);
    setHighlightedCitationId(null);
    setIsStreaming(true);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const response = await fetch('/api/rag/stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          'X-Workspace-ID': workspaceId,
        },
        body: JSON.stringify({
          query: userQuery,
          retrieval: {
            mode: options.mode,
            topK: options.topK,
          },
          generation: {
            temperature: options.temperature,
          },
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error?.message || `Server returned HTTP ${response.status}`);
      }

      if (!response.body) {
        throw new Error('ReadableStream not supported by browser response.');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      let streamStartTime = performance.now();
      let retrievalDuration = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop() || '';

        for (const rawEvent of events) {
          const lines = rawEvent.split('\n');
          let eventType = '';
          let dataStr = '';

          for (const line of lines) {
            if (line.startsWith('event: ')) {
              eventType = line.replace('event: ', '').trim();
            } else if (line.startsWith('data: ')) {
              dataStr = line.replace('data: ', '').trim();
            }
          }

          if (!dataStr) continue;

          try {
            const data = JSON.parse(dataStr);

            switch (eventType) {
              case 'start':
                streamStartTime = performance.now();
                break;

              case 'retrieval_complete':
                retrievalDuration = data.timings?.retrievalMs || 0;
                break;

              case 'sources':
                setSources(data.sources || []);
                break;

              case 'token':
                setAnswer((prev) => prev + (data.text || ''));
                break;

              case 'validation':
                setGrounding(data.grounding);
                break;

              case 'done':
                setMetadata({
                  provider: 'ollama',
                  model: 'qwen3:0.6b',
                  retrievalMode: options.mode,
                  totalSources: (data.sources || []).length || sources.length,
                  timings: {
                    retrievalMs: retrievalDuration,
                    contextAssemblyMs: 0,
                    promptBuildingMs: 0,
                    generationDurationMs: data.metadata?.generationDurationMs || 0,
                    validationMs: 0,
                    totalMs:
                      data.metadata?.totalMs || Math.round(performance.now() - streamStartTime),
                  },
                });
                break;

              case 'error':
                setError(data.message || 'Generation error');
                break;
            }
          } catch {
            // Ignore partial SSE chunk parses
          }
        }
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        setError(err.message || 'Failed to generate answer from knowledge base.');
      }
    } finally {
      setIsStreaming(false);
      abortControllerRef.current = null;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="rounded-2xl border border-vault-800 bg-gradient-to-r from-vault-900/60 to-vault-950/60 p-5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-blue-500/10 text-blue-400 border border-blue-500/20 shadow-md shadow-blue-500/5">
            <Bot className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-white">Knowledge Assistant</h3>
            <p className="text-xs text-vault-400">
              Grounded, streaming AI synthesis backed by your workspace documents.
            </p>
          </div>
        </div>

        {grounding && (
          <GroundingBadge
            status={grounding.groundingStatus}
            warnings={grounding.warnings}
            isStreaming={isStreaming}
          />
        )}
      </div>

      {/* Chat Composer */}
      <ChatComposer onSend={handleSend} onStop={handleStop} isStreaming={isStreaming} />

      {/* Error Banner */}
      {error && (
        <div className="p-4 rounded-xl border border-rose-500/20 bg-rose-500/10 text-xs text-rose-300 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Active Question & Answer Display */}
      {query && (
        <div className="space-y-4">
          <div className="p-3.5 rounded-xl border border-vault-800 bg-vault-900/30 text-xs text-vault-300 flex items-center gap-2">
            <span className="font-semibold text-vault-400">Question:</span>
            <span className="text-white font-medium">{query}</span>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            {/* Answer Column (2 cols) */}
            <div className="lg:col-span-2 space-y-4">
              <StreamingAnswer
                text={answer}
                isStreaming={isStreaming}
                onCitationClick={handleCitationClick}
              />

              {metadata && <RAGTelemetry metadata={metadata} />}
            </div>

            {/* Evidence Sources Drawer (1 col) */}
            <div className="space-y-4">
              <SourcePanel
                sources={sources}
                highlightedCitationId={highlightedCitationId}
                onCitationClick={handleCitationClick}
              />
            </div>
          </div>
        </div>
      )}

      {/* Empty State when no query has been asked yet */}
      {!query && !isStreaming && (
        <div className="rounded-2xl border border-dashed border-vault-800 bg-vault-900/20 p-12 text-center space-y-4">
          <div className="w-12 h-12 rounded-2xl bg-vault-800 flex items-center justify-center mx-auto text-vault-400">
            <FileSearch className="w-6 h-6" />
          </div>
          <div>
            <h4 className="text-sm font-semibold text-white">Ask anything across your documents</h4>
            <p className="text-xs text-vault-400 max-w-md mx-auto mt-1">
              MindVault retrieves matching chunks, synthesizes evidence into a coherent answer, and
              provides bracketed citations to verified source pages.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2 text-xs text-vault-400">
            <span className="px-2.5 py-1 rounded-lg bg-vault-800/60 border border-vault-700/60 flex items-center gap-1.5">
              <HelpCircle className="w-3.5 h-3.5 text-blue-400" />
              Try asking conceptual questions
            </span>
            <span className="px-2.5 py-1 rounded-lg bg-vault-800/60 border border-vault-700/60 flex items-center gap-1.5">
              <HelpCircle className="w-3.5 h-3.5 text-emerald-400" />
              Verify citation pills [S1]
            </span>
          </div>
        </div>
      )}
    </div>
  );
};
