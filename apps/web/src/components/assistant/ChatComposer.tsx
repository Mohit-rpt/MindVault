import React, { useState, useRef, useEffect } from 'react';
import type { RetrievalMode } from '@mindvault/shared';
import { Send, Square, Sliders, ChevronDown } from 'lucide-react';

interface ChatComposerProps {
  onSend: (
    query: string,
    options: { mode: RetrievalMode; topK: number; temperature: number },
  ) => void;
  onStop: () => void;
  isStreaming: boolean;
  disabled?: boolean;
}

export const ChatComposer: React.FC<ChatComposerProps> = ({
  onSend,
  onStop,
  isStreaming,
  disabled = false,
}) => {
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<RetrievalMode>('hybrid');
  const [topK, setTopK] = useState(5);
  const [temperature, setTemperature] = useState(0.2);
  const [showOptions, setShowOptions] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!isStreaming) {
      textareaRef.current?.focus();
    }
  }, [isStreaming]);

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = query.trim();
    if (!trimmed || isStreaming || disabled) return;

    onSend(trimmed, { mode, topK, temperature });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="space-y-2">
      <form
        onSubmit={handleSubmit}
        className="relative rounded-2xl border border-vault-700 bg-vault-900/60 p-2 focus-within:border-blue-500 focus-within:ring-1 focus-within:ring-blue-500 transition-all"
      >
        <textarea
          ref={textareaRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask a question about your uploaded knowledge base... (Press Enter to send)"
          rows={3}
          disabled={isStreaming || disabled}
          className="w-full resize-none bg-transparent px-3 py-2 text-sm text-white placeholder-vault-500 focus:outline-none disabled:opacity-50"
        />

        <div className="flex items-center justify-between border-t border-vault-800/80 pt-2 px-2">
          {/* Options Dropdown Trigger */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowOptions(!showOptions)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium text-vault-400 hover:text-white hover:bg-vault-800 transition-colors"
            >
              <Sliders className="w-3.5 h-3.5" />
              <span>Config: {mode.toUpperCase()}</span>
              <ChevronDown className="w-3 h-3" />
            </button>
          </div>

          {/* Action Button: Send or Stop */}
          <div className="flex items-center gap-2">
            {isStreaming ? (
              <button
                type="button"
                onClick={onStop}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-xl text-xs font-semibold bg-rose-500/20 text-rose-300 border border-rose-500/40 hover:bg-rose-500/30 transition-colors"
              >
                <Square className="w-3.5 h-3.5 fill-current" />
                <span>Stop Generating</span>
              </button>
            ) : (
              <button
                type="submit"
                disabled={!query.trim() || disabled}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-xl text-xs font-semibold bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shadow-lg shadow-blue-600/20"
              >
                <Send className="w-3.5 h-3.5" />
                <span>Ask MindVault</span>
              </button>
            )}
          </div>
        </div>
      </form>

      {/* Collapsible Options Drawer */}
      {showOptions && (
        <div className="p-3.5 rounded-xl border border-vault-800 bg-vault-950/80 grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
          <div>
            <label className="text-vault-400 block mb-1 font-medium">Retrieval Mode</label>
            <div className="flex rounded-lg border border-vault-700 bg-vault-900 p-0.5">
              {(['hybrid', 'semantic', 'keyword'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={`flex-1 py-1 rounded text-[11px] font-medium capitalize transition-colors ${
                    mode === m
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'text-vault-400 hover:text-white'
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-vault-400 block mb-1 font-medium">Top-K Sources: {topK}</label>
            <input
              type="range"
              min="1"
              max="15"
              value={topK}
              onChange={(e) => setTopK(parseInt(e.target.value, 10))}
              className="w-full accent-blue-500"
            />
          </div>

          <div>
            <label className="text-vault-400 block mb-1 font-medium">
              Temperature: {temperature.toFixed(2)}
            </label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={temperature}
              onChange={(e) => setTemperature(parseFloat(e.target.value))}
              className="w-full accent-blue-500"
            />
          </div>
        </div>
      )}
    </div>
  );
};
