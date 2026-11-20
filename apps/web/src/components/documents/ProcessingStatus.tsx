import React from 'react';
import type { DocumentStatus } from '@mindvault/shared';
import { CheckCircle2, AlertCircle, Loader2, Clock, Trash2 } from 'lucide-react';

interface ProcessingStatusProps {
  status: DocumentStatus;
  stage?: string;
  errorMessage?: string | null;
}

export const ProcessingStatus: React.FC<ProcessingStatusProps> = ({
  status,
  stage,
  errorMessage,
}) => {
  switch (status) {
    case 'COMPLETED':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/25">
          <CheckCircle2 className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
          Ready
        </span>
      );

    case 'PROCESSING':
      return (
        <span
          className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-blue-500/10 text-blue-700 dark:text-blue-400 border border-blue-500/25 animate-pulse"
          title={stage ? `Stage: ${stage}` : undefined}
        >
          <Loader2 className="w-3 h-3 animate-spin text-blue-600 dark:text-blue-400" />
          {stage || 'Processing'}
        </span>
      );

    case 'QUEUED':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-purple-500/10 text-purple-700 dark:text-purple-400 border border-purple-500/25">
          <Clock className="w-3 h-3 text-purple-600 dark:text-purple-400" />
          Queued
        </span>
      );

    case 'UPLOADED':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-amber-500/10 text-amber-800 dark:text-amber-400 border border-amber-500/25">
          <Clock className="w-3 h-3 text-amber-700 dark:text-amber-400" />
          Uploaded
        </span>
      );

    case 'FAILED':
      return (
        <span
          className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-rose-500/10 text-rose-700 dark:text-rose-400 border border-rose-500/25"
          title={errorMessage || 'Ingestion failed'}
        >
          <AlertCircle className="w-3 h-3 text-rose-600 dark:text-rose-400" />
          Failed
        </span>
      );

    case 'DELETING':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-theme-surface-secondary text-theme-text-muted border border-theme-border">
          <Trash2 className="w-3 h-3" />
          Deleting
        </span>
      );

    default:
      return null;
  }
};
