import React from 'react';
import type { DocumentDto } from '@mindvault/shared';
import { ProcessingStatus } from './ProcessingStatus';
import { X, Download, Calendar, Layers, FileCode, HardDrive, Cpu, AlertCircle } from 'lucide-react';

interface DocumentDetailsProps {
  document: DocumentDto;
  onClose: () => void;
  onDownload: (id: string, name: string) => void;
}

export const DocumentDetails: React.FC<DocumentDetailsProps> = ({
  document,
  onClose,
  onDownload,
}) => {
  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="w-full max-w-lg rounded-2xl border border-theme-border bg-theme-surface p-6 shadow-2xl space-y-5 animate-in zoom-in-95 duration-150">
        <div className="flex items-start justify-between">
          <div className="space-y-1.5 pr-6">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono uppercase bg-theme-surface-secondary px-2 py-0.5 rounded text-theme-text-muted border border-theme-border font-medium">
                {document.extension.replace('.', '')}
              </span>
              <ProcessingStatus
                status={document.status}
                stage={(document.metadata as any)?.processingStage}
                errorMessage={document.errorMessage}
              />
            </div>
            <h3 className="text-base font-semibold text-theme-text break-words">
              {document.originalName}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-theme-text-muted hover:text-theme-text hover:bg-theme-surface-secondary transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {document.errorMessage && (
          <div className="p-3 rounded-xl border border-rose-500/20 bg-rose-500/10 text-xs text-rose-600 dark:text-rose-400 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">Processing Error</p>
              <p className="text-[11px] mt-0.5">{document.errorMessage}</p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 text-xs">
          <div className="p-3 rounded-xl border border-theme-border bg-theme-surface-secondary space-y-1">
            <span className="text-theme-text-muted flex items-center gap-1.5 text-[11px]">
              <Layers className="w-3.5 h-3.5 text-blue-500" />
              Chunks & Pages
            </span>
            <p className="font-mono text-theme-text text-sm font-semibold">
              {document.chunkCount}{' '}
              <span className="text-xs text-theme-text-muted font-normal">chunks</span>
              {document.pageCount ? ` • ${document.pageCount} pgs` : ''}
            </p>
          </div>

          <div className="p-3 rounded-xl border border-theme-border bg-theme-surface-secondary space-y-1">
            <span className="text-theme-text-muted flex items-center gap-1.5 text-[11px]">
              <HardDrive className="w-3.5 h-3.5 text-emerald-500" />
              File Size
            </span>
            <p className="font-mono text-theme-text text-sm font-semibold">
              {formatSize(document.sizeBytes)}
            </p>
          </div>

          <div className="p-3 rounded-xl border border-theme-border bg-theme-surface-secondary space-y-1">
            <span className="text-theme-text-muted flex items-center gap-1.5 text-[11px]">
              <Cpu className="w-3.5 h-3.5 text-purple-500" />
              Embedding Model
            </span>
            <p className="font-mono text-theme-text text-xs font-semibold truncate">
              {document.embeddingModel || 'None'}
            </p>
            <p className="text-[10px] text-theme-text-muted">
              {document.embeddingDimension
                ? `${document.embeddingDimension} dimensions`
                : 'Pending'}
            </p>
          </div>

          <div className="p-3 rounded-xl border border-theme-border bg-theme-surface-secondary space-y-1">
            <span className="text-theme-text-muted flex items-center gap-1.5 text-[11px]">
              <Calendar className="w-3.5 h-3.5 text-amber-500" />
              Uploaded
            </span>
            <p className="text-theme-text text-xs font-medium">
              {new Date(document.createdAt).toLocaleDateString()}
            </p>
            <p className="text-[10px] text-theme-text-muted">
              {new Date(document.createdAt).toLocaleTimeString()}
            </p>
          </div>
        </div>

        {/* Security & Checksum */}
        <div className="p-3 rounded-xl border border-theme-border bg-theme-surface-secondary space-y-1.5 text-xs">
          <div className="flex justify-between items-center text-[11px]">
            <span className="text-theme-text-muted flex items-center gap-1.5">
              <FileCode className="w-3.5 h-3.5 text-cyan-600 dark:text-cyan-400" />
              SHA-256 Checksum
            </span>
          </div>
          <p className="font-mono text-[10px] text-theme-text-muted break-all select-all bg-theme-surface p-2 rounded-lg border border-theme-border">
            {document.checksum}
          </p>
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <button
            onClick={() => onDownload(document.id, document.originalName)}
            className="inline-flex items-center gap-2 px-3.5 py-2 bg-theme-accent hover:opacity-90 text-white rounded-xl text-xs font-medium transition-all shadow-sm"
          >
            <Download className="w-4 h-4" />
            Download Original
          </button>
          <button
            onClick={onClose}
            className="px-3.5 py-2 bg-theme-surface-secondary hover:bg-theme-border text-theme-text rounded-xl text-xs font-medium transition-colors border border-theme-border"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
