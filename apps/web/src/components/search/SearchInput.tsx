import React from 'react';
import { Search, Loader2, X } from 'lucide-react';

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  isLoading: boolean;
  placeholder?: string;
}

export const SearchInput: React.FC<SearchInputProps> = ({
  value,
  onChange,
  onSubmit,
  isLoading,
  placeholder = 'Ask a question or search for concepts across your documents...',
}) => {
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !isLoading && value.trim()) {
      e.preventDefault();
      onSubmit();
    }
  };

  return (
    <div className="relative flex items-center w-full">
      <div className="absolute left-3.5 text-theme-text-muted pointer-events-none">
        <Search className="w-4 h-4" />
      </div>

      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={isLoading}
        className="w-full pl-10 pr-24 py-3 rounded-xl bg-theme-surface-secondary border border-theme-border focus:border-theme-accent focus:ring-1 focus:ring-theme-accent text-sm text-theme-text placeholder-theme-text-muted transition-all outline-none"
      />

      <div className="absolute right-2 flex items-center gap-1.5">
        {value && !isLoading && (
          <button
            type="button"
            onClick={() => onChange('')}
            className="p-1 rounded-lg text-theme-text-muted hover:text-theme-text hover:bg-theme-surface transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}

        <button
          type="button"
          onClick={onSubmit}
          disabled={isLoading || !value.trim()}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
            isLoading || !value.trim()
              ? 'bg-theme-surface text-theme-text-muted cursor-not-allowed border border-theme-border'
              : 'bg-theme-accent hover:opacity-90 text-white shadow-sm'
          }`}
        >
          {isLoading ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>Searching</span>
            </>
          ) : (
            <span>Search</span>
          )}
        </button>
      </div>
    </div>
  );
};
