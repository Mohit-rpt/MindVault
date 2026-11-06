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
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-blue-500/10 text-blue-400 border border-blue-500/20">
        <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
        Streaming & Verifying...
      </span>
    );
  }

  switch (status) {
    case 'GROUNDED':
      return (
        <span
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
          title="All claims are verified by cited source evidence"
        >
          <ShieldCheck className="w-3.5 h-3.5" />
          Evidence-Grounded
        </span>
      );

    case 'PARTIALLY_GROUNDED':
      return (
        <span
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20"
          title={warnings.join('; ') || 'Some claims lack direct citation references'}
        >
          <AlertTriangle className="w-3.5 h-3.5" />
          Partially Grounded
        </span>
      );

    case 'INSUFFICIENT_EVIDENCE':
      return (
        <span
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-vault-800 text-vault-300 border border-vault-700"
          title="Uploaded documents do not contain sufficient evidence to answer this question"
        >
          <HelpCircle className="w-3.5 h-3.5" />
          Insufficient Evidence
        </span>
      );

    case 'CITATION_INVALID':
      return (
        <span
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-rose-500/10 text-rose-400 border border-rose-500/20"
          title={warnings.join('; ') || 'Model cited unknown or fabricated source identifiers'}
        >
          <AlertCircle className="w-3.5 h-3.5" />
          Unverified Citations
        </span>
      );

    default:
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-vault-800 text-vault-400 border border-vault-700">
          <CheckCircle2 className="w-3.5 h-3.5" />
          Complete
        </span>
      );
  }
};
