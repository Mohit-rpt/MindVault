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
      <div className="absolute left-3.5 text-vault-500 pointer-events-none">
        <Search className="w-4 h-4" />
      </div>

      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={isLoading}
        className="w-full pl-10 pr-24 py-3 rounded-xl bg-vault-900 border border-vault-700 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 text-sm text-white placeholder-vault-500 transition-all outline-none shadow-inner"
      />

      <div className="absolute right-2 flex items-center gap-1.5">
        {value && !isLoading && (
          <button
            type="button"
            onClick={() => onChange('')}
            className="p-1 rounded-lg text-vault-500 hover:text-white hover:bg-vault-800 transition-colors"
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
              ? 'bg-vault-800 text-vault-500 cursor-not-allowed'
              : 'bg-blue-600 hover:bg-blue-500 text-white shadow-sm shadow-blue-500/20'
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
