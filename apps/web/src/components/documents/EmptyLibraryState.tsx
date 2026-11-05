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
    <div className="text-center py-16 px-4 rounded-2xl border border-vault-800 bg-vault-900/20">
      <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-vault-800/60 border border-vault-700/60 flex items-center justify-center text-vault-400">
        {isFiltered ? (
          <FolderOpen className="w-7 h-7" />
        ) : (
          <UploadCloud className="w-7 h-7 text-blue-400" />
        )}
      </div>
      <h3 className="text-base font-semibold text-white mb-1">
        {isFiltered ? 'No matching documents' : 'Your Knowledge Vault is empty'}
      </h3>
      <p className="text-xs text-vault-400 max-w-sm mx-auto mb-6">
        {isFiltered
          ? 'No documents matched your search or status filter. Try clearing your filters or uploading new files.'
          : 'Upload PDF, DOCX, TXT, or Markdown documents to begin building your isolated, searchable knowledge base.'}
      </p>
      {!isFiltered && (
        <button
          onClick={onUploadClick}
          className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium rounded-lg shadow-sm transition-colors"
        >
          <UploadCloud className="w-4 h-4" />
          Upload First Document
        </button>
      )}
    </div>
  );
};
