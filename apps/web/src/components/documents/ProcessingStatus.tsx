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
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
          <CheckCircle2 className="w-3 h-3" />
          Ready
        </span>
      );

    case 'PROCESSING':
      return (
        <span
          className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-blue-500/10 text-blue-400 border border-blue-500/20 animate-pulse"
          title={stage ? `Stage: ${stage}` : undefined}
        >
          <Loader2 className="w-3 h-3 animate-spin" />
          {stage || 'Processing'}
        </span>
      );

    case 'QUEUED':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-purple-500/10 text-purple-400 border border-purple-500/20">
          <Clock className="w-3 h-3" />
          Queued
        </span>
      );

    case 'UPLOADED':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">
          <Clock className="w-3 h-3" />
          Uploaded
        </span>
      );

    case 'FAILED':
      return (
        <span
          className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-rose-500/10 text-rose-400 border border-rose-500/20"
          title={errorMessage || 'Ingestion failed'}
        >
          <AlertCircle className="w-3 h-3" />
          Failed
        </span>
      );

    case 'DELETING':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-vault-800 text-vault-400 border border-vault-700">
          <Trash2 className="w-3 h-3" />
          Deleting
        </span>
      );

    default:
      return null;
  }
};
