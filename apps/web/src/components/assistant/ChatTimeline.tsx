import React, { useEffect, useRef } from 'react';
import type { ChatMessageDto } from '@mindvault/shared';
import { ChatMessage } from './ChatMessage';
import { Sparkles, FileText, Network, Compass, Lightbulb } from 'lucide-react';

interface ChatTimelineProps {
  messages: ChatMessageDto[];
  isStreaming?: boolean;
  streamingAssistantId?: string;
  onCitationClick?: (citationId: string) => void;
  onRetry?: (content: string) => void;
  onSelectPrompt?: (prompt: string) => void;
}

export const ChatTimeline: React.FC<ChatTimelineProps> = ({
  messages,
  isStreaming = false,
  streamingAssistantId,
  onCitationClick,
  onRetry,
  onSelectPrompt,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll on new messages or streaming token updates
  useEffect(() => {
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isStreaming]);

  // EMPTY STATE: Claude/ChatGPT style calm minimal welcome
  if (messages.length === 0) {
    const suggestedPrompts = [
      {
        icon: FileText,
        title: 'Summarize my documents',
        description: 'Get a concise synthesis of uploaded PDFs and notes.',
        prompt: 'Please provide a comprehensive executive summary of my uploaded documents.',
      },
      {
        icon: Network,
        title: 'Find connections',
        description: 'Discover key relationships across your knowledge vault.',
        prompt: 'What are the main interconnected themes across my uploaded knowledge base?',
      },
      {
        icon: Lightbulb,
        title: 'Explain a complex topic',
        description: 'Break down intricate concepts with source citations.',
        prompt: 'Explain the most complex concept in my uploaded files with step-by-step clarity.',
      },
      {
        icon: Compass,
        title: 'Vault overview',
        description: 'What should I know about my uploaded files?',
        prompt: 'What should I know about the files currently in my vault? What are the key takeaways?',
      },
    ];

    return (
      <div className="flex-1 flex flex-col items-center justify-center px-4 py-8 max-w-2xl mx-auto w-full text-center space-y-7 animate-fadeIn">
        {/* Brand Mark */}
        <div className="w-12 h-12 rounded-2xl bg-theme-surface-secondary border border-theme-border/80 flex items-center justify-center text-theme-accent shadow-subtle mx-auto">
          <Sparkles className="w-6 h-6" />
        </div>

        {/* Calm Heading */}
        <div className="space-y-2">
          <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight text-theme-text font-sans">
            Your knowledge, connected.
          </h2>
          <p className="text-xs sm:text-sm text-theme-text-secondary max-w-md mx-auto leading-relaxed">
            Ask questions, explore ideas, and discover insights grounded in your uploaded documents.
          </p>
        </div>

        {/* Suggestion Prompts Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full text-left pt-2">
          {suggestedPrompts.map((item, idx) => {
            const Icon = item.icon;
            return (
              <button
                key={idx}
                type="button"
                onClick={() => onSelectPrompt && onSelectPrompt(item.prompt)}
                className="group flex flex-col justify-between p-3.5 rounded-xl border border-theme-border bg-theme-surface hover:bg-theme-surface-hover hover:border-theme-accent/40 transition-all text-left shadow-subtle"
              >
                <div className="flex items-center gap-2 mb-1.5 text-theme-accent">
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="text-xs font-medium text-theme-text group-hover:text-theme-accent transition-colors">
                    {item.title}
                  </span>
                </div>
                <p className="text-[11px] text-theme-text-muted leading-relaxed">
                  {item.description}
                </p>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-y-auto px-4 sm:px-6 py-6 custom-scrollbar"
    >
      <div className="max-w-3xl mx-auto space-y-4">
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
        <div ref={bottomRef} className="h-4" />
      </div>
    </div>
  );
};
