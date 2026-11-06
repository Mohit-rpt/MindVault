import React from 'react';
import type { GroundingStatus } from '@mindvault/shared';
import { ShieldCheck, AlertTriangle, AlertCircle, HelpCircle, CheckCircle2 } from 'lucide-react';

interface GroundingBadgeProps {
  status: GroundingStatus;
  warnings?: string[];
  isStreaming?: boolean;
}

export const GroundingBadge: React.FC<GroundingBadgeProps> = ({
  status,
  warnings = [],
  isStreaming = false,
}) => {
  if (isStreaming) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium bg-theme-accent/10 text-theme-accent border border-theme-accent/25">
        <span className="w-1.5 h-1.5 rounded-full bg-theme-accent animate-pulse" />
        Verifying grounding...
      </span>
    );
  }

  switch (status) {
    case 'GROUNDED':
      return (
        <span
          className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/25"
          title="All claims are verified by cited source evidence"
        >
          <ShieldCheck className="w-3 h-3" />
          Evidence Grounded
        </span>
      );

    case 'PARTIALLY_GROUNDED':
      return (
        <span
          className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/25"
          title={warnings.join('; ') || 'Some claims lack direct citation references'}
        >
          <AlertTriangle className="w-3 h-3" />
          Partially Grounded
        </span>
      );

    case 'INSUFFICIENT_EVIDENCE':
      return (
        <span
          className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium bg-theme-surface-secondary text-theme-text-secondary border border-theme-border"
          title="Uploaded documents do not contain sufficient evidence to answer this question"
        >
          <HelpCircle className="w-3 h-3" />
          Insufficient Evidence
        </span>
      );

    case 'CITATION_INVALID':
      return (
        <span
          className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium bg-rose-500/10 text-rose-700 dark:text-rose-400 border border-rose-500/25"
          title={warnings.join('; ') || 'Model cited unknown or fabricated source identifiers'}
        >
          <AlertCircle className="w-3 h-3" />
          Unverified Citations
        </span>
      );

    default:
      return (
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium bg-theme-surface-secondary text-theme-text-muted border border-theme-border">
          <CheckCircle2 className="w-3 h-3" />
          Completed
        </span>
      );
  }
};
