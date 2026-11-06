import React, { useState } from 'react';
import type { ChatMessageDto, GroundingValidationResult } from '@mindvault/shared';
import { User, Bot, Copy, Check, AlertTriangle, AlertCircle } from 'lucide-react';
import { GroundingBadge } from './GroundingBadge';

interface ChatMessageProps {
  message: ChatMessageDto;
  isStreaming?: boolean;
  onCitationClick?: (citationId: string) => void;
  onRetry?: (content: string) => void;
}

export const ChatMessage: React.FC<ChatMessageProps> = ({
  message,
  isStreaming = false,
  onCitationClick,
  onRetry,
}) => {
  const [copied, setCopied] = useState(false);
  const isUser = message.role === 'USER';

  const handleCopy = () => {
    navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const grounding = (message.metadata?.grounding as GroundingValidationResult) || null;

  // Render text with clickable citation badges
  const renderContentWithCitations = (content: string) => {
    if (!content) return null;

    const parts = content.split(/(\[S\d+\])/g);
    return parts.map((part, index) => {
      const match = part.match(/^\[S(\d+)\]$/);
      if (match) {
        return (
          <button
            key={index}
            onClick={() => onCitationClick && onCitationClick(part)}
            className="inline-flex items-center mx-0.5 px-1.5 py-0.2 text-[11px] font-mono font-bold rounded-md bg-blue-500/15 text-blue-400 border border-blue-500/30 hover:bg-blue-500/30 hover:scale-105 transition-all cursor-pointer"
            title={`View evidence source ${part}`}
          >
            {part}
          </button>
        );
      }
      return <span key={index}>{part}</span>;
    });
  };

  return (
    <div
      className={`flex gap-3 text-xs leading-relaxed ${isUser ? 'justify-end' : 'justify-start'}`}
    >
      {!isUser && (
        <div className="w-7 h-7 rounded-xl bg-blue-500/10 text-blue-400 border border-blue-500/20 flex items-center justify-center shrink-0 mt-0.5">
          <Bot className="w-4 h-4" />
        </div>
      )}

      <div
        className={`max-w-2xl rounded-2xl p-4 space-y-2.5 transition-all ${
          isUser
            ? 'bg-blue-600 text-white rounded-tr-none shadow-md shadow-blue-600/10'
            : 'bg-vault-900/60 border border-vault-800 text-vault-200 rounded-tl-none'
        }`}
      >
        {/* Header Metadata */}
        <div className="flex items-center justify-between gap-3 text-[10px] opacity-75">
          <span className="font-semibold uppercase tracking-wider">
            {isUser ? 'You' : 'MindVault Assistant'}
          </span>
          <div className="flex items-center gap-2">
            <span>
              {new Date(message.createdAt).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
            <button
              onClick={handleCopy}
              className="hover:text-white transition-colors"
              title="Copy message"
            >
              {copied ? (
                <Check className="w-3 h-3 text-emerald-400" />
              ) : (
                <Copy className="w-3 h-3" />
              )}
            </button>
          </div>
        </div>

        {/* Message Content */}
        <div className="whitespace-pre-wrap font-sans text-xs sm:text-[13px] leading-relaxed">
          {isUser ? message.content : renderContentWithCitations(message.content)}
          {isStreaming && (
            <span className="inline-block w-1.5 h-3.5 bg-blue-400 ml-1 animate-pulse align-middle rounded-sm" />
          )}
        </div>

        {/* Status Indicators */}
        {message.status === 'CANCELLED' && (
          <div className="flex items-center gap-1.5 p-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-300 text-[11px]">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            <span>Generation was cancelled by the user.</span>
          </div>
        )}

        {message.status === 'FAILED' && (
          <div className="flex items-center justify-between gap-2 p-2 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-300 text-[11px]">
            <div className="flex items-center gap-1.5">
              <AlertCircle className="w-3.5 h-3.5 shrink-0 text-rose-400" />
              <span>Generation failed.</span>
            </div>
            {onRetry && (
              <button
                onClick={() => onRetry(message.content)}
                className="text-[10px] font-semibold text-rose-400 hover:underline"
              >
                Retry
              </button>
            )}
          </div>
        )}

        {/* Assistant Grounding Badge & Cited Sources */}
        {!isUser && grounding && (
          <div className="pt-2 border-t border-vault-800/80 flex flex-wrap items-center justify-between gap-2">
            <GroundingBadge
              status={grounding.groundingStatus}
              warnings={grounding.warnings}
              isStreaming={isStreaming}
            />

            {message.citations && message.citations.length > 0 && (
              <div className="flex items-center gap-1.5 text-[10px] text-vault-400 font-mono">
                <span>{message.citations.length} cited sources</span>
              </div>
            )}
          </div>
        )}
      </div>

      {isUser && (
        <div className="w-7 h-7 rounded-xl bg-vault-800 text-vault-300 border border-vault-700 flex items-center justify-center shrink-0 mt-0.5">
          <User className="w-4 h-4" />
        </div>
      )}
    </div>
  );
};
