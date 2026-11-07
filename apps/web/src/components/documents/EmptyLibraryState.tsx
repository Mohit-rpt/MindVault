import React from 'react';
import { UploadCloud, FolderOpen } from 'lucide-react';

interface EmptyLibraryStateProps {
  onUploadClick: () => void;
  isFiltered?: boolean;
}

export const EmptyLibraryState: React.FC<EmptyLibraryStateProps> = ({
  onUploadClick,
  isFiltered,
}) => {
  return (
    <div className="text-center py-16 px-4 rounded-2xl border border-theme-border bg-theme-surface shadow-subtle">
      <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-theme-surface-secondary border border-theme-border/80 flex items-center justify-center text-theme-accent">
        {isFiltered ? <FolderOpen className="w-7 h-7" /> : <UploadCloud className="w-7 h-7" />}
      </div>
      <h3 className="text-base font-semibold text-theme-text mb-1">
        {isFiltered ? 'No matching documents' : 'Your Knowledge Vault is empty'}
      </h3>
      <p className="text-xs text-theme-text-muted max-w-sm mx-auto mb-6 leading-relaxed">
        {isFiltered
          ? 'No documents matched your search or status filter. Try clearing your filters or uploading new files.'
          : 'Upload PDF, DOCX, TXT, or Markdown documents to begin building your isolated, searchable knowledge base.'}
      </p>
      {!isFiltered && (
        <button
          onClick={onUploadClick}
          className="inline-flex items-center gap-2 px-4 py-2 bg-theme-accent hover:bg-theme-accent-hover text-white text-xs font-medium rounded-xl shadow-subtle transition-colors"
        >
          <UploadCloud className="w-4 h-4" />
          Upload First Document
        </button>
      )}
    </div>
  );
};
