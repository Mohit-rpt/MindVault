import React from 'react';
import { CheckCircle2, AlertCircle, Loader2, FileText } from 'lucide-react';

export interface UploadItem {
  id: string;
  name: string;
  size: number;
  progress: number;
  status: 'uploading' | 'success' | 'error';
  errorMessage?: string;
}

interface UploadProgressProps {
  items: UploadItem[];
  onDismiss?: (id: string) => void;
}

export const UploadProgress: React.FC<UploadProgressProps> = ({ items, onDismiss }) => {
  if (items.length === 0) return null;

  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="space-y-2 mb-6">
      <h4 className="text-xs font-semibold text-vault-300 uppercase tracking-wider">
        Upload Queue ({items.length})
      </h4>
      <div className="space-y-2">
        {items.map((item) => (
          <div
            key={item.id}
            className="p-3 rounded-xl border border-vault-800 bg-vault-900/60 flex items-center justify-between text-xs"
          >
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <div className="p-2 rounded-lg bg-vault-800 text-vault-400 shrink-0">
                <FileText className="w-4 h-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-medium text-white truncate max-w-xs">{item.name}</span>
                  <span className="text-[11px] text-vault-400 font-mono">
                    {formatSize(item.size)}
                  </span>
                </div>
                {/* Progress bar */}
                <div className="w-full bg-vault-800 rounded-full h-1.5 overflow-hidden">
                  <div
                    className={`h-full transition-all duration-300 ${
                      item.status === 'error'
                        ? 'bg-rose-500'
                        : item.status === 'success'
                          ? 'bg-emerald-500'
                          : 'bg-blue-500'
                    }`}
                    style={{ width: `${item.progress}%` }}
                  />
                </div>
                {item.errorMessage && (
                  <p className="text-[11px] text-rose-400 mt-1 truncate">{item.errorMessage}</p>
                )}
              </div>
            </div>

            <div className="ml-4 shrink-0">
              {item.status === 'uploading' && (
                <Loader2 className="w-4 h-4 animate-spin text-blue-400" />
              )}
              {item.status === 'success' && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
              {item.status === 'error' && (
                <div className="flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-400" />
                  {onDismiss && (
                    <button
                      onClick={() => onDismiss(item.id)}
                      className="text-vault-500 hover:text-vault-300 text-xs"
                    >
                      ×
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
