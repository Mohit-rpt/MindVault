import React from 'react';
import type { DocumentDto } from '@mindvault/shared';
import { ProcessingStatus } from './ProcessingStatus';
import { FileText, FileCode, Download, Trash2, Eye, Layers } from 'lucide-react';

interface DocumentCardProps {
  document: DocumentDto;
  onViewDetails: (doc: DocumentDto) => void;
  onDownload: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  canDelete?: boolean;
}

export const DocumentCard: React.FC<DocumentCardProps> = ({
  document,
  onViewDetails,
  onDownload,
  onDelete,
  canDelete = true,
}) => {
  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const getFileIcon = (ext: string) => {
    switch (ext.toLowerCase().replace('.', '')) {
      case 'pdf':
        return <FileText className="w-5 h-5 text-rose-400" />;
      case 'docx':
        return <FileText className="w-5 h-5 text-blue-400" />;
      case 'md':
        return <FileCode className="w-5 h-5 text-emerald-400" />;
      default:
        return <FileText className="w-5 h-5 text-amber-400" />;
    }
  };

  return (
    <div className="group rounded-2xl border border-vault-800 bg-vault-900/40 hover:bg-vault-900/80 hover:border-vault-700 transition-all p-5 flex flex-col justify-between space-y-4">
      <div className="space-y-3">
        {/* Header: Icon, Extension, Status */}
        <div className="flex items-start justify-between gap-2">
          <div className="p-2.5 rounded-xl bg-vault-950 border border-vault-800/80 shrink-0">
            {getFileIcon(document.extension)}
          </div>
          <ProcessingStatus
            status={document.status}
            stage={(document.metadata as any)?.processingStage}
            errorMessage={document.errorMessage}
          />
        </div>

        {/* Title */}
        <div>
          <h4
            className="text-sm font-semibold text-white truncate hover:text-blue-400 transition-colors cursor-pointer"
            onClick={() => onViewDetails(document)}
            title={document.originalName}
          >
            {document.originalName}
          </h4>
          <p className="text-[11px] text-vault-400 mt-0.5">
            {formatSize(document.sizeBytes)} • {new Date(document.createdAt).toLocaleDateString()}
          </p>
        </div>
      </div>

      {/* Footer Metrics & Actions */}
      <div className="pt-3 border-t border-vault-800/60 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs text-vault-300 font-mono">
          <Layers className="w-3.5 h-3.5 text-vault-400" />
          <span>{document.chunkCount}</span>
          <span className="text-[10px] text-vault-500 font-sans">chunks</span>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => onViewDetails(document)}
            title="View Details"
            className="p-1.5 rounded-lg text-vault-400 hover:text-white hover:bg-vault-800 transition-colors"
          >
            <Eye className="w-4 h-4" />
          </button>
          <button
            onClick={() => onDownload(document.id, document.originalName)}
            title="Download Original"
            className="p-1.5 rounded-lg text-vault-400 hover:text-white hover:bg-vault-800 transition-colors"
          >
            <Download className="w-4 h-4" />
          </button>
          {canDelete && (
            <button
              onClick={() => onDelete(document.id)}
              title="Delete Document"
              className="p-1.5 rounded-lg text-vault-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
