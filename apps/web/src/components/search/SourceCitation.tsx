import React from 'react';
import { FileText, Bookmark } from 'lucide-react';

interface SourceCitationProps {
  citationId: string;
  documentName: string;
  chunkIndex: number;
  pageRange?: string | null;
  section?: string | null;
}

export const SourceCitation: React.FC<SourceCitationProps> = ({
  citationId,
  documentName,
  chunkIndex,
  pageRange,
  section,
}) => {
  return (
    <div className="inline-flex flex-wrap items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-mono border bg-theme-surface-secondary border-theme-border text-theme-text-muted">
      <span className="font-semibold text-purple-600 dark:text-purple-400">{citationId}</span>
      <span className="text-theme-border">|</span>
      <span
        className="inline-flex items-center gap-1 text-theme-text truncate max-w-[180px]"
        title={documentName}
      >
        <FileText className="w-3 h-3 text-theme-text-muted flex-shrink-0" />
        <span className="truncate">{documentName}</span>
      </span>
      <span className="text-theme-text-muted">Chunk {chunkIndex + 1}</span>
      {pageRange && (
        <>
          <span className="text-theme-border">|</span>
          <span className="text-blue-600 dark:text-blue-400 font-medium">{pageRange}</span>
        </>
      )}
      {section && (
        <>
          <span className="text-theme-border">|</span>
          <span
            className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 truncate max-w-[140px]"
            title={section}
          >
            <Bookmark className="w-3 h-3 flex-shrink-0" />
            <span className="truncate">{section}</span>
          </span>
        </>
      )}
    </div>
  );
};
