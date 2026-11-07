import React, { useState } from 'react';
import type { ChatMessageDto, GroundingValidationResult } from '@mindvault/shared';
import {
  Copy,
  Check,
  AlertTriangle,
  AlertCircle,
  ZoomIn,
  X,
  Zap,
  RotateCcw,
  Sparkles,
} from 'lucide-react';
import { MarkdownRenderer } from './MarkdownRenderer';
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
  const [isImagePreviewOpen, setIsImagePreviewOpen] = useState(false);
  const isUser = message.role === 'USER';

  const handleCopy = () => {
    navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const grounding = (message.metadata?.grounding as GroundingValidationResult) || null;
  const provider = (message.metadata?.provider as string) || null;
  const model = (message.metadata?.model as string) || null;

  // Attached image if present in message metadata
  const attachedImage = message.metadata?.image as
    { mimeType?: string; data?: string; name?: string } | undefined;

  const imageSrc = attachedImage?.data
    ? attachedImage.data.startsWith('data:')
      ? attachedImage.data
      : `data:${attachedImage.mimeType || 'image/png'};base64,${attachedImage.data}`
    : null;

  return (
    <>
      <div
        className={`w-full py-3.5 transition-colors ${isUser ? 'flex justify-end' : 'flex justify-start'}`}
      >
        {isUser ? (
          /* USER MESSAGE: Elegant warm bubble */
          <div className="max-w-[85%] sm:max-w-2xl flex flex-col items-end">
            <div className="rounded-2xl px-4 py-3 bg-theme-user text-theme-text border border-theme-border/60 shadow-subtle space-y-2">
              {/* Attached Image Thumbnail */}
              {imageSrc && (
                <div className="space-y-1">
                  <div
                    onClick={() => setIsImagePreviewOpen(true)}
                    className="group relative inline-block cursor-pointer overflow-hidden rounded-xl border border-theme-border/60 bg-theme-surface shadow-sm transition-transform hover:scale-[1.01]"
                  >
                    <img
                      src={imageSrc}
                      alt={attachedImage?.name || 'Attached image'}
                      className="max-h-56 max-w-full rounded-xl object-contain"
                    />
                    <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity text-white text-xs font-medium gap-1.5">
                      <ZoomIn className="w-3.5 h-3.5" />
                      <span>Click to expand</span>
                    </div>
                  </div>
                  {attachedImage?.name && (
                    <p className="text-[10px] text-theme-text-muted truncate">
                      📎 {attachedImage.name}
                    </p>
                  )}
                </div>
              )}

              {/* User Query Content */}
              <div className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-theme-text font-sans">
                {message.content}
              </div>
            </div>

            <span className="text-[10px] text-theme-text-muted mt-1 mr-1">
              {new Date(message.createdAt).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
          </div>
        ) : (
          /* ASSISTANT MESSAGE: Natural, breathable, non-card typography */
          <div className="w-full max-w-3xl flex gap-3.5 items-start">
            {/* MindVault Mark */}
            <div className="w-7 h-7 rounded-xl bg-theme-surface-secondary text-theme-accent border border-theme-border/80 flex items-center justify-center shrink-0 mt-0.5 shadow-subtle">
              <Sparkles className="w-3.5 h-3.5" />
            </div>

            <div className="flex-1 min-w-0 space-y-2">
              {/* Assistant Attribution Row */}
              <div className="flex items-center justify-between text-xs text-theme-text-muted">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-theme-text text-xs tracking-tight">
                    MindVault
                  </span>

                  {provider === 'gemini' ? (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                      <Zap className="w-2.5 h-2.5 fill-current" />
                      <span>Gemini Flash</span>
                    </span>
                  ) : provider === 'ollama' ? (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20">
                      <span>🦙 Ollama</span>
                      {model && <span className="opacity-75">({model})</span>}
                    </span>
                  ) : null}
                </div>

                <div className="flex items-center gap-1 text-[11px]">
                  <span>
                    {new Date(message.createdAt).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
              </div>

              {/* Assistant Rich Markdown Content */}
              <div className="relative">
                <MarkdownRenderer content={message.content} onCitationClick={onCitationClick} />
                {isStreaming && (
                  <span className="inline-block w-1.5 h-4 bg-theme-accent ml-1 animate-pulse align-middle rounded-sm" />
                )}
              </div>

              {/* Status Indicators */}
              {message.status === 'CANCELLED' && (
                <div className="flex items-center gap-1.5 p-2 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-300 text-xs">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                  <span>Generation stopped by user.</span>
                </div>
              )}

              {message.status === 'FAILED' && (
                <div className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-700 dark:text-rose-300 text-xs">
                  <div className="flex items-center gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0 text-rose-500" />
                    <span>Generation failed.</span>
                  </div>
                  {onRetry && (
                    <button
                      onClick={() => onRetry(message.content)}
                      className="text-xs font-medium text-rose-600 dark:text-rose-400 hover:underline"
                    >
                      Retry
                    </button>
                  )}
                </div>
              )}

              {/* Footer: Grounding Status & Action Toolbar */}
              <div className="pt-2 flex flex-wrap items-center justify-between gap-2 border-t border-theme-border/40 text-xs text-theme-text-muted">
                <div className="flex items-center gap-2">
                  {grounding && (
                    <GroundingBadge
                      status={grounding.groundingStatus}
                      warnings={grounding.warnings}
                      isStreaming={isStreaming}
                    />
                  )}

                  {message.citations && message.citations.length > 0 && (
                    <button
                      type="button"
                      onClick={() =>
                        onCitationClick && onCitationClick(message.citations[0].citationId)
                      }
                      className="text-[11px] font-mono hover:text-theme-accent transition-colors cursor-pointer"
                    >
                      {message.citations.length} cited source
                      {message.citations.length > 1 ? 's' : ''}
                    </button>
                  )}
                </div>

                {/* Subtle Message Action Buttons */}
                <div className="flex items-center gap-1 opacity-70 hover:opacity-100 transition-opacity">
                  <button
                    onClick={handleCopy}
                    className="p-1 rounded-md hover:bg-theme-surface-secondary text-theme-text-secondary hover:text-theme-text transition-colors"
                    title="Copy response"
                  >
                    {copied ? (
                      <Check className="w-3.5 h-3.5 text-emerald-500" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                  </button>

                  {onRetry && (
                    <button
                      onClick={() => onRetry(message.content)}
                      className="p-1 rounded-md hover:bg-theme-surface-secondary text-theme-text-secondary hover:text-theme-text transition-colors"
                      title="Regenerate response"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Modal Zoom for Full-Size Image Preview */}
      {isImagePreviewOpen && imageSrc && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-fadeIn"
          onClick={() => setIsImagePreviewOpen(false)}
        >
          <div className="relative max-w-4xl max-h-[90vh]">
            <img
              src={imageSrc}
              alt="Enlarged view"
              className="max-h-[85vh] max-w-full rounded-2xl object-contain border border-theme-border shadow-2xl"
            />
            <button
              onClick={() => setIsImagePreviewOpen(false)}
              className="absolute -top-3 -right-3 rounded-full bg-theme-surface border border-theme-border p-1.5 text-theme-text shadow-lg hover:bg-theme-surface-secondary transition-colors"
              title="Close preview"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </>
  );
};
