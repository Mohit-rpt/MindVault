import React, { useState } from 'react';
import { Copy, Check, Sparkles } from 'lucide-react';

interface StreamingAnswerProps {
  text: string;
  isStreaming: boolean;
  onCitationClick?: (citationId: string) => void;
}

export const StreamingAnswer: React.FC<StreamingAnswerProps> = ({
  text,
  isStreaming,
  onCitationClick,
}) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  /**
   * Parses text and converts [S1], [S2] into interactive badges.
   */
  const renderFormattedText = (raw: string) => {
    if (!raw) return null;

    const parts = raw.split(/(\[S\d+\])/g);

    return parts.map((part, index) => {
      const match = part.match(/^\[S(\d+)\]$/);
      if (match) {
        return (
          <button
            key={index}
            type="button"
            onClick={() => onCitationClick?.(part)}
            className="inline-flex items-center justify-center px-1.5 py-0.5 mx-0.5 rounded text-[11px] font-mono font-semibold bg-theme-accent/15 text-theme-accent border border-theme-accent/30 hover:bg-theme-accent/25 hover:border-theme-accent/50 transition-colors align-baseline"
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
    <div className="rounded-2xl border border-theme-border bg-theme-surface p-5 space-y-4 shadow-subtle">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-theme-surface-secondary text-theme-accent border border-theme-border">
            <Sparkles className="w-4 h-4" />
          </div>
          <span className="text-sm font-semibold text-theme-text font-serif">MindVault Answer</span>
        </div>

        {text && (
          <button
            type="button"
            onClick={handleCopy}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs text-theme-text-secondary hover:text-theme-text hover:bg-theme-surface-secondary transition-colors"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-500" />
                <span className="text-emerald-500 font-medium">Copied</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                <span>Copy</span>
              </>
            )}
          </button>
        )}
      </div>

      <div className="text-sm text-theme-text leading-relaxed font-sans whitespace-pre-wrap">
        {renderFormattedText(text)}
        {isStreaming && (
          <span className="inline-block w-1.5 h-4 ml-1 bg-theme-accent animate-pulse align-middle rounded-sm" />
        )}
      </div>
    </div>
  );
};
