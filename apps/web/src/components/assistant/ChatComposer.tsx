import React, { useState, useRef, useEffect } from 'react';
import type { RetrievalMode } from '@mindvault/shared';
import {
  ArrowUp,
  Square,
  Sliders,
  Image as ImageIcon,
  X,
  Zap,
} from 'lucide-react';

export interface ChatSendOptions {
  mode: RetrievalMode;
  topK: number;
  temperature: number;
  provider: 'gemini' | 'ollama';
  image?: {
    mimeType: string;
    data: string;
    name?: string;
  };
}

interface ChatComposerProps {
  onSend: (query: string, options: ChatSendOptions) => void;
  onStop: () => void;
  isStreaming: boolean;
  disabled?: boolean;
  draftPrompt?: string;
}

export const ChatComposer: React.FC<ChatComposerProps> = ({
  onSend,
  onStop,
  isStreaming,
  disabled = false,
  draftPrompt,
}) => {
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<RetrievalMode>('hybrid');
  const [topK, setTopK] = useState(5);
  const [temperature, setTemperature] = useState(0.2);
  const [provider, setProvider] = useState<'gemini' | 'ollama'>('gemini');
  const [attachedImage, setAttachedImage] = useState<{
    mimeType: string;
    data: string;
    name: string;
  } | null>(null);
  const [showOptions, setShowOptions] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Sync draft prompt from suggestion cards if provided
  useEffect(() => {
    if (draftPrompt) {
      setQuery(draftPrompt);
      if (textareaRef.current) {
        textareaRef.current.focus();
        textareaRef.current.style.height = 'auto';
        textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 180)}px`;
      }
    }
  }, [draftPrompt]);

  useEffect(() => {
    if (!isStreaming) {
      textareaRef.current?.focus();
    }
  }, [isStreaming]);

  const adjustHeight = () => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 180)}px`;
    }
  };

  const handleFileSelected = (file: File) => {
    if (!file.type.startsWith('image/')) {
      alert('Please select an image file (PNG, JPG, WebP, GIF).');
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      alert('Image file is too large (maximum size is 10MB).');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const [header, base64Data] = result.split(';base64,');
      const mimeType = header.replace('data:', '') || file.type;

      setAttachedImage({
        mimeType,
        data: base64Data,
        name: file.name,
      });

      // Gemini natively handles multimodal image inputs
      setProvider('gemini');
    };
    reader.readAsDataURL(file);
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          e.preventDefault();
          handleFileSelected(file);
          break;
        }
      }
    }
  };

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = query.trim();
    if ((!trimmed && !attachedImage) || isStreaming || disabled) return;

    const messageContent =
      trimmed ||
      (attachedImage
        ? 'Please analyze, interpret, and explain what is depicted in this attached image.'
        : '');

    // Multimodal images route to Gemini
    const effectiveProvider = attachedImage ? 'gemini' : provider;

    onSend(messageContent, {
      mode,
      topK,
      temperature,
      provider: effectiveProvider,
      image: attachedImage || undefined,
    });

    setQuery('');
    setAttachedImage(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="w-full max-w-3xl mx-auto px-4 sm:px-0">
      {/* Attached Image Thumbnail Preview */}
      {attachedImage && (
        <div className="flex items-center gap-2 p-1.5 mb-2 rounded-xl bg-theme-surface border border-theme-border shadow-subtle max-w-fit animate-fadeIn">
          <img
            src={`data:${attachedImage.mimeType};base64,${attachedImage.data}`}
            alt="Attached preview"
            className="w-10 h-10 rounded-lg object-cover border border-theme-border/60 shrink-0"
          />
          <div className="text-left text-xs min-w-0 pr-2">
            <p className="font-medium text-theme-text truncate max-w-[160px]">
              {attachedImage.name}
            </p>
            <div className="flex items-center gap-1 text-[10px] text-theme-accent font-medium mt-0.5">
              <Zap className="w-2.5 h-2.5 fill-current" />
              <span>Vision Active</span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              setAttachedImage(null);
              if (fileInputRef.current) fileInputRef.current.value = '';
            }}
            className="p-1 rounded-md text-theme-text-muted hover:text-theme-text hover:bg-theme-surface-secondary transition-colors"
            title="Remove attachment"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Floating Composer Container */}
      <form
        onSubmit={handleSubmit}
        className="relative rounded-2xl border border-theme-border bg-theme-surface shadow-composer focus-within:border-theme-accent/60 transition-all p-3"
      >
        <textarea
          ref={textareaRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            adjustHeight();
          }}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={
            attachedImage
              ? 'Ask about this image or your vault documents... (Press Enter)'
              : 'Ask questions, explore ideas, or paste screenshots... (Enter to send)'
          }
          rows={1}
          disabled={isStreaming || disabled}
          className="w-full resize-none bg-transparent px-1 py-1 text-[13.5px] leading-relaxed text-theme-text placeholder-theme-text-muted focus:outline-none disabled:opacity-50 font-sans custom-scrollbar"
        />

        {/* Hidden File Input for Image Upload */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFileSelected(file);
          }}
        />

        {/* Composer Controls Bar */}
        <div className="flex items-center justify-between gap-2 pt-2 border-t border-theme-border/40 mt-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            {/* Model Selector Pill */}
            <div className="flex items-center rounded-lg border border-theme-border bg-theme-surface-secondary p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setProvider('gemini')}
                className={`flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium transition-all ${
                  provider === 'gemini'
                    ? 'bg-theme-surface text-theme-text shadow-subtle border border-theme-border/80'
                    : 'text-theme-text-muted hover:text-theme-text'
                }`}
                title="Google Gemini Flash: Ultra-fast cloud reasoning + vision"
              >
                <span>⚡</span>
                <span className="font-medium">Gemini</span>
              </button>
              <button
                type="button"
                onClick={() => setProvider('ollama')}
                className={`flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium transition-all ${
                  provider === 'ollama'
                    ? 'bg-theme-surface text-theme-text shadow-subtle border border-theme-border/80'
                    : 'text-theme-text-muted hover:text-theme-text'
                }`}
                title="Local Ollama Qwen3: 100% private offline"
              >
                <span>🦙</span>
                <span className="font-medium">Ollama</span>
              </button>
            </div>

            {/* Image Attachment Button */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className={`p-1.5 rounded-lg text-xs transition-colors border ${
                attachedImage
                  ? 'border-theme-accent/50 bg-theme-accent/10 text-theme-accent'
                  : 'border-transparent text-theme-text-muted hover:text-theme-text hover:bg-theme-surface-secondary'
              }`}
              title="Attach image or screenshot (PNG, JPG, WebP) or paste directly"
            >
              <ImageIcon className="w-4 h-4" />
            </button>

            {/* Retrieval Config Popover Trigger */}
            <button
              type="button"
              onClick={() => setShowOptions(!showOptions)}
              className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] transition-colors border ${
                showOptions
                  ? 'border-theme-accent/40 bg-theme-accent/10 text-theme-accent'
                  : 'border-transparent text-theme-text-muted hover:text-theme-text hover:bg-theme-surface-secondary'
              }`}
              title="Configure retrieval mode and parameters"
            >
              <Sliders className="w-3.5 h-3.5" />
              <span className="hidden sm:inline capitalize">{mode}</span>
            </button>
          </div>

          {/* Action Button: Send or Stop */}
          <div className="flex items-center gap-2">
            {isStreaming ? (
              <button
                type="button"
                onClick={onStop}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20 hover:bg-rose-500/20 transition-colors"
                title="Stop generating"
              >
                <Square className="w-3 h-3 fill-current" />
                <span>Stop</span>
              </button>
            ) : (
              <button
                type="submit"
                disabled={(!query.trim() && !attachedImage) || disabled}
                className="w-7 h-7 rounded-xl flex items-center justify-center bg-theme-accent text-white hover:bg-theme-accent-hover disabled:opacity-30 disabled:cursor-not-allowed transition-all shadow-subtle"
                title="Send message"
              >
                <ArrowUp className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Collapsible Retrieval Settings Tray */}
        {showOptions && (
          <div className="mt-3 pt-3 border-t border-theme-border/60 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs animate-fadeIn">
            <div>
              <label className="text-[11px] font-medium text-theme-text-secondary block mb-1">
                Retrieval Mode
              </label>
              <div className="flex rounded-lg border border-theme-border bg-theme-surface-secondary p-0.5">
                {(['hybrid', 'semantic', 'keyword'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMode(m)}
                    className={`flex-1 py-1 rounded text-[11px] capitalize transition-colors ${
                      mode === m
                        ? 'bg-theme-surface text-theme-text font-medium shadow-subtle'
                        : 'text-theme-text-muted hover:text-theme-text'
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="flex justify-between text-[11px] font-medium text-theme-text-secondary mb-1">
                <span>Top Sources</span>
                <span className="font-mono">{topK}</span>
              </div>
              <input
                type="range"
                min="1"
                max="12"
                value={topK}
                onChange={(e) => setTopK(parseInt(e.target.value, 10))}
                className="w-full accent-theme-accent"
              />
            </div>

            <div>
              <div className="flex justify-between text-[11px] font-medium text-theme-text-secondary mb-1">
                <span>Temperature</span>
                <span className="font-mono">{temperature.toFixed(2)}</span>
              </div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={temperature}
                onChange={(e) => setTemperature(parseFloat(e.target.value))}
                className="w-full accent-theme-accent"
              />
            </div>
          </div>
        )}
      </form>

      <p className="text-[10px] text-theme-text-muted text-center mt-2 font-mono opacity-60">
        Enter to send • Shift + Enter for new line • Grounded in workspace documents
      </p>
    </div>
  );
};
