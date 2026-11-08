/**
 * MindVault — Knowledge Graph: Extraction Provider Abstraction
 */

import type { KnowledgeExtractionResponse } from '@mindvault/shared';

export interface ExtractionContext {
  documentTitle?: string;
  sectionHeading?: string;
  pageNumber?: number;
  workspaceId: string;
  abortSignal?: AbortSignal;
}

export interface IKnowledgeExtractionProvider {
  readonly providerName: string;
  extract(chunkText: string, context?: ExtractionContext): Promise<KnowledgeExtractionResponse>;
  healthCheck(): Promise<{ ok: boolean; message?: string }>;
}
