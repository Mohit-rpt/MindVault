import React, { useState, useEffect, useRef, useCallback } from 'react';
import type {
  ChatSessionDto,
  ChatMessageDto,
  ContextSourceItem,
  GroundingValidationResult,
} from '@mindvault/shared';
import { useAuth } from '../../context/AuthContext';
import { ConversationHeader } from './ConversationHeader';
import { ChatTimeline } from './ChatTimeline';
import { ChatComposer, type ChatSendOptions } from './ChatComposer';
import { SourcePanel } from './SourcePanel';
import { AlertCircle } from 'lucide-react';

export interface KnowledgeAssistantProps {
  workspaceId: string;
  sessions?: ChatSessionDto[];
  activeSessionId?: string | null;
  onSelectSession?: (sessionId: string) => void;
  onNewSession?: () => void;
  onRenameSession?: (sessionId: string, newTitle: string) => Promise<void>;
  onArchiveSession?: (sessionId: string) => Promise<void>;
  onDeleteSession?: (sessionId: string) => Promise<void>;
  loadSessions?: () => Promise<void>;
  onToggleSidebar?: () => void;
}

export const KnowledgeAssistant: React.FC<KnowledgeAssistantProps> = ({
  workspaceId,
  sessions = [],
  activeSessionId = null,
  onSelectSession = () => {},
  onNewSession = () => {},
  onRenameSession = async () => {},
  onArchiveSession = async () => {},
  onDeleteSession = async () => {},
  loadSessions = async () => {},
  onToggleSidebar,
}) => {
  const { accessToken } = useAuth();

  const [messages, setMessages] = useState<ChatMessageDto[]>([]);
  const [sources, setSources] = useState<ContextSourceItem[]>([]);
  const [highlightedCitationId, setHighlightedCitationId] = useState<string | null>(null);

  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingAssistantId, setStreamingAssistantId] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [showSourcesPanel, setShowSourcesPanel] = useState(false);
  const [draftPrompt, setDraftPrompt] = useState<string>('');

  const abortControllerRef = useRef<AbortController | null>(null);

  // Load messages whenever activeSessionId changes
  const loadMessages = useCallback(
    async (sessionId: string) => {
      setIsLoadingMessages(true);
      setError(null);
      try {
        const response = await fetch(`/api/conversations/${sessionId}/messages?limit=100`, {
          headers: {
            'Content-Type': 'application/json',
            ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
            'X-Workspace-ID': workspaceId,
          },
        });

        if (response.ok) {
          const json = await response.json();
          const loadedMessages: ChatMessageDto[] = json.data?.items || [];
          setMessages(loadedMessages);

          // Find sources from the latest assistant message if available
          const lastAssistant = [...loadedMessages]
            .reverse()
            .find((m) => m.role === 'ASSISTANT' && m.citations && m.citations.length > 0);
          if (lastAssistant && lastAssistant.citations) {
            setSources(lastAssistant.citations);
          } else {
            setSources([]);
          }
        } else {
          const errData = await response.json().catch(() => ({}));
          setError(errData.error?.message || 'Failed to load conversation history.');
        }
      } catch (err: unknown) {
        const msg =
          err instanceof Error ? err.message : 'Network error while loading conversation messages.';
        setError(msg);
      } finally {
        setIsLoadingMessages(false);
      }
    },
    [workspaceId, accessToken],
  );

  // Reload messages when activeSessionId changes
  useEffect(() => {
    if (activeSessionId) {
      loadMessages(activeSessionId);
    } else {
      setMessages([]);
      setSources([]);
    }
  }, [activeSessionId, loadMessages]);

  const handleCitationClick = (citationId: string) => {
    setShowSourcesPanel(true);
    setHighlightedCitationId(citationId);
    const elementId = `source-${citationId.replace(/[^a-zA-Z0-9]/g, '')}`;
    setTimeout(() => {
      const el = document.getElementById(elementId);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 50);
  };

  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsStreaming(false);

    // Update active streaming message status to CANCELLED in UI
    if (streamingAssistantId) {
      setMessages((prev) =>
        prev.map((m) => (m.id === streamingAssistantId ? { ...m, status: 'CANCELLED' } : m)),
      );
      setStreamingAssistantId(undefined);
    }
  };

  // Main streaming conversation dispatcher
  const handleSend = async (userQuery: string, options: ChatSendOptions) => {
    setError(null);
    setHighlightedCitationId(null);

    let currentSessionId = activeSessionId;

    // 1. Create a session first if none is active
    if (!currentSessionId) {
      try {
        const createRes = await fetch('/api/conversations', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
            'X-Workspace-ID': workspaceId,
          },
          body: JSON.stringify({
            title: userQuery.trim().slice(0, 50) || 'New Conversation',
          }),
        });

        if (!createRes.ok) {
          const errData = await createRes.json().catch(() => ({}));
          throw new Error(errData.error?.message || 'Failed to create conversation session.');
        }

        const createdJson = await createRes.json();
        const newSession: ChatSessionDto = createdJson.data;
        currentSessionId = newSession.id;
        onSelectSession(currentSessionId);
        await loadSessions();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Could not initialize conversation.';
        setError(msg);
        return;
      }
    }

    // 2. Optimistically append USER message and placeholder ASSISTANT message
    const tempUserMessageId = `temp-user-${Date.now()}`;
    const tempAssistantMessageId = `temp-asst-${Date.now()}`;

    const tempUserMessage: ChatMessageDto = {
      id: tempUserMessageId,
      sessionId: currentSessionId,
      workspaceId,
      role: 'USER',
      content: userQuery,
      status: 'COMPLETED',
      sequenceNumber: messages.length + 1,
      citations: [],
      metadata: options.image
        ? {
            image: {
              mimeType: options.image.mimeType,
              data: options.image.data,
              name: options.image.name,
            },
          }
        : {},
      tokenEstimate: 0,
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    };

    const tempAssistantMessage: ChatMessageDto = {
      id: tempAssistantMessageId,
      sessionId: currentSessionId,
      workspaceId,
      role: 'ASSISTANT',
      content: '',
      status: 'STREAMING',
      sequenceNumber: messages.length + 2,
      citations: [],
      metadata: {
        provider: options.provider,
      },
      tokenEstimate: 0,
      createdAt: new Date().toISOString(),
      completedAt: null,
    };

    setMessages((prev) => [...prev, tempUserMessage, tempAssistantMessage]);
    setIsStreaming(true);
    setStreamingAssistantId(tempAssistantMessageId);

    // 3. Initiate SSE connection
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const response = await fetch(`/api/conversations/${currentSessionId}/messages/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          'X-Workspace-ID': workspaceId,
        },
        body: JSON.stringify({
          content: userQuery,
          provider: options.provider,
          image: options.image,
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

      let realAssistantId = tempAssistantMessageId;
      let realUserMessageId = tempUserMessageId;

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
              case 'start': {
                realAssistantId = data.assistantMessageId || data.messageId || realAssistantId;
                realUserMessageId = data.userMessageId || realUserMessageId;
                setStreamingAssistantId(realAssistantId);

                setMessages((prev) =>
                  prev.map((m) => {
                    if (m.id === tempUserMessageId) {
                      return { ...m, id: realUserMessageId };
                    }
                    if (m.id === tempAssistantMessageId) {
                      return { ...m, id: realAssistantId };
                    }
                    return m;
                  }),
                );
                break;
              }

              case 'sources': {
                const retrievedSources: ContextSourceItem[] = data.sources || [];
                setSources(retrievedSources);
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === realAssistantId || m.id === tempAssistantMessageId
                      ? { ...m, citations: retrievedSources }
                      : m,
                  ),
                );
                break;
              }

              case 'token': {
                const textChunk = data.text || '';
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === realAssistantId || m.id === tempAssistantMessageId
                      ? { ...m, content: m.content + textChunk }
                      : m,
                  ),
                );
                break;
              }

              case 'validation': {
                const grounding: GroundingValidationResult = data.grounding;
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === realAssistantId || m.id === tempAssistantMessageId
                      ? {
                          ...m,
                          metadata: {
                            ...(m.metadata || {}),
                            grounding,
                          },
                        }
                      : m,
                  ),
                );
                break;
              }

              case 'done': {
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === realAssistantId || m.id === tempAssistantMessageId
                      ? {
                          ...m,
                          ...(data.message ? data.message : {}),
                          status: 'COMPLETED',
                          metadata: {
                            ...(m.metadata || {}),
                            ...(data.message?.metadata || {}),
                          },
                          citations: data.citations || data.message?.citations || m.citations,
                          tokenEstimate:
                            data.totalTokens || data.message?.tokenEstimate || m.tokenEstimate,
                          completedAt: new Date().toISOString(),
                        }
                      : m,
                  ),
                );
                loadSessions();
                break;
              }

              case 'error': {
                setError(data.message || 'Generation error');
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === realAssistantId || m.id === tempAssistantMessageId
                      ? { ...m, status: 'FAILED' }
                      : m,
                  ),
                );
                break;
              }
            }
          } catch {
            // Partial JSON ignored
          }
        }
      }
    } catch (err: unknown) {
      const isAbort = err instanceof Error && err.name === 'AbortError';
      if (!isAbort) {
        const errorMsg =
          err instanceof Error ? err.message : 'Failed to generate answer from knowledge base.';
        setError(errorMsg);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === tempAssistantMessageId || m.status === 'STREAMING'
              ? { ...m, status: 'FAILED' }
              : m,
          ),
        );
      }
    } finally {
      setIsStreaming(false);
      setStreamingAssistantId(undefined);
      abortControllerRef.current = null;
    }
  };

  const activeSession = sessions.find((s) => s.id === activeSessionId) || null;

  return (
    <div className="flex-1 flex flex-col h-full min-w-0 bg-theme-bg overflow-hidden relative">
      {/* Minimal Header */}
      <ConversationHeader
        session={activeSession}
        onRename={(newTitle) => activeSessionId && onRenameSession(activeSessionId, newTitle)}
        onArchive={() => activeSessionId && onArchiveSession(activeSessionId)}
        onDelete={() => activeSessionId && onDeleteSession(activeSessionId)}
        onToggleSidebar={onToggleSidebar}
        evidenceCount={sources.length}
        onToggleEvidence={() => setShowSourcesPanel(!showSourcesPanel)}
        isEvidenceOpen={showSourcesPanel}
      />

      {/* Global Error Banner */}
      {error && (
        <div className="mx-4 mt-3 max-w-3xl sm:mx-auto w-full p-3 rounded-xl border border-rose-500/20 bg-rose-500/10 text-xs text-rose-700 dark:text-rose-300 flex items-center justify-between gap-2 shadow-subtle">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-500 shrink-0" />
            <span>{error}</span>
          </div>
          <button
            onClick={() => setError(null)}
            className="text-xs font-semibold text-rose-600 dark:text-rose-400 hover:underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Main Messages Timeline (Centered, comfortable measure) */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {isLoadingMessages ? (
          <div className="flex-1 flex items-center justify-center text-xs text-theme-text-muted">
            Loading conversation history...
          </div>
        ) : (
          <ChatTimeline
            messages={messages}
            isStreaming={isStreaming}
            streamingAssistantId={streamingAssistantId}
            onCitationClick={handleCitationClick}
            onRetry={(content) =>
              handleSend(content, {
                mode: 'hybrid',
                topK: 5,
                temperature: 0.2,
                provider: 'gemini',
              })
            }
            onSelectPrompt={(prompt) => {
              handleSend(prompt, {
                mode: 'hybrid',
                topK: 5,
                temperature: 0.2,
                provider: 'gemini',
              });
            }}
          />
        )}
      </div>

      {/* Floating Bottom Composer */}
      <div className="p-3 sm:pb-6 bg-gradient-to-t from-theme-bg via-theme-bg to-transparent">
        <ChatComposer
          onSend={handleSend}
          onStop={handleStop}
          isStreaming={isStreaming}
          draftPrompt={draftPrompt}
        />
      </div>

      {/* Slide-Over Evidence Drawer */}
      {showSourcesPanel && sources.length > 0 && (
        <div className="fixed inset-y-0 right-0 z-40 w-full sm:w-96 bg-theme-surface border-l border-theme-border shadow-modal p-4 animate-slideIn flex flex-col">
          <SourcePanel
            sources={sources}
            highlightedCitationId={highlightedCitationId}
            onCitationClick={handleCitationClick}
            onClose={() => setShowSourcesPanel(false)}
          />
        </div>
      )}
    </div>
  );
};
