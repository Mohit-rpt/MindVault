/**
 * MindVault — Knowledge Graph: Status Precedence & Receipt Builder (§6.9.2, Task 6.4.4)
 *
 * Implements the authoritative Section 6.9.2 Final Status Precedence decision table:
 * - Case 1: All chunks successful (s = N, f = 0) -> COMPLETED (valid even with 0 extracted relations)
 * - Case 2 & 3: Partial success (s > 0, f > 0, s + f = N) -> PARTIAL (preserves valid triples in graph)
 * - Case 4a: Zero chunks successful due to permanent content errors (s = 0, f = N) -> FAILED (terminal receipt)
 *
 * Note: Case 4b (Infrastructure Retry Exhaustion) and Case 6 (Shutdown Deferral) do NOT call this finalizer:
 * - Case 4b leaves status in PROCESSING with null receipt for background reconciler (§6.4.2).
 * - Case 6 sets QUEUED with null receipt for immediate restart pickup (§6.7.1).
 */

import {
  type GraphFinalizationReceipt,
  type GraphTerminalStatus,
  validateFinalizationReceipt,
} from '@mindvault/shared';

export interface FinalizationDecisionInput {
  totalChunks: number;
  succeededChunksCount: number;
  failedChunksCount: number;
  extractionRunId: string;
  chunkManifestHash: string;
  completedAt?: string;
}

export interface FinalizationDecisionResult {
  terminalStatus: GraphTerminalStatus;
  receipt: GraphFinalizationReceipt;
}

export function determineTerminalStatusAndReceipt(
  input: FinalizationDecisionInput,
): FinalizationDecisionResult {
  const {
    totalChunks,
    succeededChunksCount,
    failedChunksCount,
    extractionRunId,
    chunkManifestHash,
    completedAt = new Date().toISOString(),
  } = input;

  let terminalStatus: GraphTerminalStatus;

  if (totalChunks === 0) {
    terminalStatus = 'COMPLETED';
  } else if (succeededChunksCount === totalChunks && failedChunksCount === 0) {
    // Case 1: All chunks successful. Valid even with 0 extracted relations.
    terminalStatus = 'COMPLETED';
  } else if (succeededChunksCount > 0 && failedChunksCount > 0) {
    // Case 2 & 3: Partial success. Preserves valid triples in graph.
    terminalStatus = 'PARTIAL';
  } else if (succeededChunksCount === 0 && failedChunksCount === totalChunks) {
    // Case 4a: Zero chunks successful due to permanent content/schema failure.
    terminalStatus = 'FAILED';
  } else {
    // Fallback: if some chunks succeeded, mark PARTIAL; otherwise FAILED
    terminalStatus = succeededChunksCount > 0 ? 'PARTIAL' : 'FAILED';
  }

  const receipt: GraphFinalizationReceipt = {
    terminalStatus,
    extractionRunId,
    chunkManifestHash,
    completedAt,
    chunkCount: totalChunks,
    processedChunksCount: succeededChunksCount + failedChunksCount,
    succeededChunksCount,
    failedChunksCount,
  };

  if (!validateFinalizationReceipt(receipt, extractionRunId, chunkManifestHash, totalChunks)) {
    throw new Error(
      `Internal Error: Generated finalization receipt violated strengthened receipt invariants: ${JSON.stringify(receipt)}`,
    );
  }

  return {
    terminalStatus,
    receipt,
  };
}
