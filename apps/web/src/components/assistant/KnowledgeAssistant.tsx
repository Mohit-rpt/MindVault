import React, { useState, useEffect, useRef, useCallback } from 'react';
import type {
  ChatSessionDto,
  ChatMessageDto,
  ContextSourceItem,
  GroundingValidationResult,
  RetrievalMode,
} from '@mindvault/shared';
import { useAuth } from '../../context/AuthContext';
import { ConversationSidebar } from './ConversationSidebar';
import { ConversationHeader } from './ConversationHeader';
import { ChatTimeline } from './ChatTimeline';
import { ChatComposer } from './ChatComposer';
import { SourcePanel } from './SourcePanel';
import { Bookmark, PanelRightClose, PanelRightOpen, AlertCircle } from 'lucide-react';

interface KnowledgeAssistantProps {
  workspaceId: string;
}

export const KnowledgeAssistant: React.FC<KnowledgeAssistantProps> = ({ workspaceId }) => {
  const { accessToken } = useAuth();

  // State
  const [sessions, setSessions] = useState<ChatSessionDto[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessageDto[]>([]);
  const [sources, setSources] = useState<ContextSourceItem[]>([]);
  const [highlightedCitationId, setHighlightedCitationId] = useState<string | null>(null);

  const [isLoadingSessions, setIsLoadingSessions] = useState(false);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingAssistantId, setStreamingAssistantId] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [showSourcesPanel, setShowSourcesPanel] = useState(true);

  const abortControllerRef = useRef<AbortController | null>(null);

  // Fetch all sessions for active workspace
  const loadSessions = useCallback(async () => {
    setIsLoadingSessions(true);
    try {
      const response = await fetch('/api/conversations?limit=50', {
        headers: {
          'Content-Type': 'application/json',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          'X-Workspace-ID': workspaceId,
        },
      });

      if (response.ok) {
        const json = await response.json();
        const loadedSessions: ChatSessionDto[] = json.data?.items || [];
        setSessions(loadedSessions);

        // Auto-select first session if none is selected
        if (!activeSessionId && loadedSessions.length > 0) {
          setActiveSessionId(loadedSessions[0].id);
        }
      }
    } catch {
      // Best-effort session loading
    } finally {
      setIsLoadingSessions(false);
    }
  }, [workspaceId, accessToken, activeSessionId]);

  // Load messages whenever active session changes
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

  // Initial load
  useEffect(() => {
    loadSessions();
  }, [workspaceId]);

  // Reload messages when activeSessionId changes
  useEffect(() => {
    if (activeSessionId) {
      loadMessages(activeSessionId);
    } else {
      setMessages([]);
      setSources([]);
    }
  }, [activeSessionId]);

  // Session Handlers
  const handleSelectSession = (sessionId: string) => {
    if (isStreaming) {
      handleStop();
    }
    setActiveSessionId(sessionId);
  };

  const handleNewSession = () => {
    if (isStreaming) {
      handleStop();
    }
    setActiveSessionId(null);
    setMessages([]);
    setSources([]);
    setError(null);
  };

  const handleRenameSession = async (sessionId: string, newTitle: string) => {
    try {
      const response = await fetch(`/api/conversations/${sessionId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          'X-Workspace-ID': workspaceId,
        },
        body: JSON.stringify({ title: newTitle }),
      });

      if (response.ok) {
        const json = await response.json();
        const updated: ChatSessionDto = json.data;
        setSessions((prev) => prev.map((s) => (s.id === sessionId ? updated : s)));
      }
    } catch {
      // Ignored
    }
  };

  const handleArchiveSession = async (sessionId: string) => {
    try {
      const response = await fetch(`/api/conversations/${sessionId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          'X-Workspace-ID': workspaceId,
        },
        body: JSON.stringify({ status: 'ARCHIVED' }),
      });

      if (response.ok) {
        setSessions((prev) =>
          prev.map((s) => (s.id === sessionId ? { ...s, status: 'ARCHIVED' } : s)),
        );
      }
    } catch {
      // Ignored
    }
  };

  const handleDeleteSession = async (sessionId: string) => {
    try {
      const response = await fetch(`/api/conversations/${sessionId}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          'X-Workspace-ID': workspaceId,
        },
      });

      if (response.ok) {
        const remaining = sessions.filter((s) => s.id !== sessionId);
        setSessions(remaining);
        if (activeSessionId === sessionId) {
          if (remaining.length > 0) {
            setActiveSessionId(remaining[0].id);
          } else {
            setActiveSessionId(null);
            setMessages([]);
            setSources([]);
          }
        }
      }
    } catch {
      // Ignored
    }
  };

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
  const handleSend = async (
    userQuery: string,
    options: { mode: RetrievalMode; topK: number; temperature: number },
  ) => {
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
        setActiveSessionId(currentSessionId);
        setSessions((prev) => [newSession, ...prev]);
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
      metadata: {},
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
      metadata: {},
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
                realAssistantId = data.messageId || realAssistantId;
                realUserMessageId = data.userMessageId || realUserMessageId;
                setStreamingAssistantId(realAssistantId);

                // Reconcile temporary IDs with server-assigned IDs
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

              case 'summary_updated': {
                if (data.summary && currentSessionId) {
                  setSessions((prev) =>
                    prev.map((s) =>
                      s.id === currentSessionId
                        ? {
                            ...s,
                            summary: data.summary,
                            summaryVersion: data.summaryVersion || s.summaryVersion + 1,
                          }
                        : s,
                    ),
                  );
                }
                break;
              }

              case 'done': {
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === realAssistantId || m.id === tempAssistantMessageId
                      ? {
                          ...m,
                          status: 'COMPLETED',
                          citations: data.citations || m.citations,
                          tokenEstimate: data.totalTokens || m.tokenEstimate,
                          completedAt: new Date().toISOString(),
                        }
                      : m,
                  ),
                );
                // Refresh sessions to sync message count and lastMessageAt
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
            // Partial JSON chunk ignored
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
      } else {
        // Cancelled by client
        setMessages((prev) =>
          prev.map((m) =>
            m.id === tempAssistantMessageId || m.status === 'STREAMING'
              ? { ...m, status: 'CANCELLED' }
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
    <div className="flex flex-col lg:flex-row gap-5 h-[calc(100vh-140px)] min-h-[640px]">
      {/* Left Column: Conversations Sidebar */}
      <ConversationSidebar
        sessions={sessions}
        activeSessionId={activeSessionId}
        onSelectSession={handleSelectSession}
        onNewSession={handleNewSession}
        onRenameSession={handleRenameSession}
        onArchiveSession={handleArchiveSession}
        onDeleteSession={handleDeleteSession}
        isLoading={isLoadingSessions}
      />

      {/* Center Column: Main Chat Interface */}
      <div className="flex-1 flex flex-col h-full rounded-2xl border border-vault-800 bg-vault-950/60 overflow-hidden">
        {/* Header Bar */}
        <div className="border-b border-vault-800">
          <ConversationHeader
            session={activeSession}
            onRename={(newTitle) =>
              activeSessionId && handleRenameSession(activeSessionId, newTitle)
            }
            onArchive={() => activeSessionId && handleArchiveSession(activeSessionId)}
            onDelete={() => activeSessionId && handleDeleteSession(activeSessionId)}
          />
        </div>

        {/* Global Error Banner */}
        {error && (
          <div className="mx-4 mt-3 p-3 rounded-xl border border-rose-500/20 bg-rose-500/10 text-xs text-rose-300 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
              <span>{error}</span>
            </div>
            <button
              onClick={() => setError(null)}
              className="text-xs text-rose-400 hover:text-white"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Chat Timeline (Scrollable Messages Area) */}
        <div className="flex-1 flex flex-col min-h-0 relative">
          {isLoadingMessages ? (
            <div className="flex-1 flex items-center justify-center text-xs text-vault-500">
              Loading conversation history...
            </div>
          ) : (
            <ChatTimeline
              messages={messages}
              isStreaming={isStreaming}
              streamingAssistantId={streamingAssistantId}
              onCitationClick={handleCitationClick}
              onRetry={(content) =>
                handleSend(content, { mode: 'hybrid', topK: 5, temperature: 0.2 })
              }
            />
          )}

          {/* Toggle Evidence Drawer Button (if sources exist) */}
          {sources.length > 0 && (
            <button
              type="button"
              onClick={() => setShowSourcesPanel((prev) => !prev)}
              className="absolute top-3 right-3 flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-vault-900/90 border border-vault-700 text-vault-300 text-xs hover:text-white hover:border-vault-600 transition-all shadow-md z-10"
              title={showSourcesPanel ? 'Hide Evidence Sources' : 'Show Evidence Sources'}
            >
              <Bookmark className="w-3.5 h-3.5 text-blue-400" />
              <span>Evidence ({sources.length})</span>
              {showSourcesPanel ? (
                <PanelRightClose className="w-3.5 h-3.5 text-vault-400" />
              ) : (
                <PanelRightOpen className="w-3.5 h-3.5 text-vault-400" />
              )}
            </button>
          )}
        </div>

        {/* Bottom Composer */}
        <div className="border-t border-vault-800 p-4 bg-vault-950/80">
          <ChatComposer onSend={handleSend} onStop={handleStop} isStreaming={isStreaming} />
        </div>
      </div>

      {/* Right Column: Evidence Drawer (collapsible) */}
      {showSourcesPanel && sources.length > 0 && (
        <div className="w-full lg:w-80 flex flex-col h-full rounded-2xl border border-vault-800 bg-vault-950/80 p-3 overflow-y-auto custom-scrollbar">
          <SourcePanel
            sources={sources}
            highlightedCitationId={highlightedCitationId}
            onCitationClick={handleCitationClick}
          />
        </div>
      )}
    </div>
  );
};
