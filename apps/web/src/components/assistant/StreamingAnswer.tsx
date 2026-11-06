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
            className="inline-flex items-center justify-center px-1.5 py-0.2 mx-0.5 rounded text-[11px] font-mono font-bold bg-blue-500/20 text-blue-300 border border-blue-500/40 hover:bg-blue-500/30 hover:border-blue-400 transition-colors align-baseline"
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
    <div className="rounded-2xl border border-vault-800 bg-vault-900/40 p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-blue-500/10 text-blue-400 border border-blue-500/20">
            <Sparkles className="w-4 h-4" />
          </div>
          <span className="text-sm font-semibold text-white">MindVault Answer</span>
        </div>

        {text && (
          <button
            type="button"
            onClick={handleCopy}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs text-vault-400 hover:text-white hover:bg-vault-800 transition-colors"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-emerald-400">Copied</span>
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

      <div className="text-sm text-vault-100 leading-relaxed font-sans whitespace-pre-wrap">
        {renderFormattedText(text)}
        {isStreaming && (
          <span className="inline-block w-2 h-4 ml-1 bg-blue-400 animate-pulse align-middle" />
        )}
      </div>
    </div>
  );
};
