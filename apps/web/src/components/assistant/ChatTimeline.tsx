import React, { useEffect, useRef } from 'react';
import type { ChatMessageDto } from '@mindvault/shared';
import { ChatMessage } from './ChatMessage';
import { Bot, Sparkles, BookOpen, Compass } from 'lucide-react';

interface ChatTimelineProps {
  messages: ChatMessageDto[];
  isStreaming?: boolean;
  streamingAssistantId?: string;
  onCitationClick?: (citationId: string) => void;
  onRetry?: (content: string) => void;
}

export const ChatTimeline: React.FC<ChatTimelineProps> = ({
  messages,
  isStreaming = false,
  streamingAssistantId,
  onCitationClick,
  onRetry,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll on new messages or streaming token updates
  useEffect(() => {
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isStreaming]);

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center space-y-5 rounded-2xl border border-dashed border-vault-800 bg-vault-950/40">
        <div className="w-14 h-14 rounded-2xl bg-blue-500/10 border border-blue-500/20 text-blue-400 flex items-center justify-center shadow-lg shadow-blue-500/5">
          <Bot className="w-7 h-7" />
        </div>

        <div className="space-y-1.5 max-w-md">
          <h3 className="text-base font-semibold text-white">MindVault Conversational Assistant</h3>
          <p className="text-xs text-vault-400 leading-relaxed">
            Ask questions, explore multi-turn follow-ups, and reference previous context. Every
            answer is grounded in your uploaded documents with precise citation badges.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 w-full max-w-lg pt-2 text-left">
          <div className="p-3 rounded-xl bg-vault-900/50 border border-vault-800/80 space-y-1">
            <div className="flex items-center gap-1.5 text-blue-400 text-xs font-medium">
              <Sparkles className="w-3.5 h-3.5" />
              <span>Contextual</span>
            </div>
            <p className="text-[11px] text-vault-400">
              Refers naturally to previous questions and concepts discussed earlier.
            </p>
          </div>

          <div className="p-3 rounded-xl bg-vault-900/50 border border-vault-800/80 space-y-1">
            <div className="flex items-center gap-1.5 text-emerald-400 text-xs font-medium">
              <BookOpen className="w-3.5 h-3.5" />
              <span>Grounded</span>
            </div>
            <p className="text-[11px] text-vault-400">
              All claims are backed by [S1], [S2] source evidence from your vault.
            </p>
          </div>

          <div className="p-3 rounded-xl bg-vault-900/50 border border-vault-800/80 space-y-1">
            <div className="flex items-center gap-1.5 text-purple-400 text-xs font-medium">
              <Compass className="w-3.5 h-3.5" />
              <span>Persistent</span>
            </div>
            <p className="text-[11px] text-vault-400">
              Conversations persist automatically and are isolated to this workspace.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Check if we should render a thinking skeleton when streaming but assistant message is not yet generated
  const hasStreamingAssistantMessage = messages.some(
    (m) => m.id === streamingAssistantId || m.status === 'STREAMING',
  );

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-y-auto space-y-4 p-4 pr-2 custom-scrollbar min-h-[300px]"
    >
      {messages.map((message) => {
        const isThisStreaming =
          isStreaming && (message.id === streamingAssistantId || message.status === 'STREAMING');

        return (
          <ChatMessage
            key={message.id}
            message={message}
            isStreaming={isThisStreaming}
            onCitationClick={onCitationClick}
            onRetry={onRetry}
          />
        );
      })}

      {isStreaming && !hasStreamingAssistantMessage && (
        <div className="flex items-start gap-3">
          <div className="w-7 h-7 rounded-xl bg-blue-500/10 text-blue-400 border border-blue-500/20 flex items-center justify-center shrink-0 animate-pulse">
            <Bot className="w-4 h-4" />
          </div>
          <div className="rounded-2xl rounded-tl-none p-3 bg-vault-900/60 border border-vault-800 text-vault-400 text-xs flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-blue-400 animate-ping" />
            <span>Retrieving workspace knowledge and synthesizing answer...</span>
          </div>
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  );
};
