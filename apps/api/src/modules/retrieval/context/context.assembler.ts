/**
 * MindVault — Retrieval Engine: Context Assembler & Citation Tracker
 *
 * Responsibilities:
 * - Assembles top-N retrieved chunks into a coherent context block for future RAG generation
 * - Strictly enforces configurable token budgets (default: 3000 tokens)
 * - Generates stable citation identifiers ([S1], [S2], etc.)
 * - Formats source attribution with exact page ranges, section headers, and document names
 * - Deduplicates chunks while maintaining strict relevance order
 * - Never fabricates missing metadata (honestly displays 'N/A' or omits missing pages)
 */

import type { ContextSourceItem, SearchContextDto } from '@mindvault/shared';
import type { FusedCandidate } from '../fusion/rrf.fusion.js';

export interface ContextAssemblyOptions {
  maxTokens?: number;
}

export class ContextAssembler {
  public static readonly DEFAULT_MAX_TOKENS = 3000;

  /**
   * Formats a page range or single page number honestly based on available metadata.
   */
  public static formatPageReference(
    pageStart?: number | null,
    pageEnd?: number | null,
  ): { pageNumber: number | null; pageRange: string | null } {
    if (pageStart !== null && pageStart !== undefined) {
      if (pageEnd !== null && pageEnd !== undefined && pageEnd > pageStart) {
        return {
          pageNumber: pageStart,
          pageRange: `pp. ${pageStart}-${pageEnd}`,
        };
      }
      return {
        pageNumber: pageStart,
        pageRange: `p. ${pageStart}`,
      };
    }

    return {
      pageNumber: null,
      pageRange: null,
    };
  }

  /**
   * Estimates token count for a text chunk using the MindVault heuristic.
   */
  public static estimateTokens(text: string): number {
    if (!text) return 0;
    const words = text.split(/\s+/).length;
    const chars = Math.ceil(text.length / 4);
    return Math.max(1, Math.round((words * 1.3 + chars) / 2));
  }

  /**
   * Assembles ranked chunks into a budgeted context block with citations.
   */
  public static assemble(
    candidates: FusedCandidate[],
    options?: ContextAssemblyOptions,
  ): SearchContextDto {
    const maxTokens = options?.maxTokens || this.DEFAULT_MAX_TOKENS;
    const seenChunkIds = new Set<string>();
    const sources: ContextSourceItem[] = [];
    const contextBlocks: string[] = [];
    let currentTokens = 0;

    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i];

      // Deduplication guard
      if (seenChunkIds.has(candidate.chunkId)) {
        continue;
      }

      const chunkTokens =
        candidate.tokenCount > 0 ? candidate.tokenCount : this.estimateTokens(candidate.content);

      // Check budget constraint (including header overhead ~20 tokens)
      const blockTokenEstimate = chunkTokens + 20;
      if (currentTokens + blockTokenEstimate > maxTokens && sources.length > 0) {
        // Budget exhausted, stop adding chunks
        break;
      }

      seenChunkIds.add(candidate.chunkId);
      const citationId = `[S${sources.length + 1}]`;
      const { pageNumber, pageRange } = this.formatPageReference(
        candidate.pageStart,
        candidate.pageEnd,
      );

      const section =
        (candidate.metadata?.heading as string) || (candidate.metadata?.section as string) || null;

      const sourceItem: ContextSourceItem = {
        citationId,
        documentId: candidate.documentId,
        documentName: candidate.documentName,
        chunkId: candidate.chunkId,
        chunkIndex: candidate.chunkIndex,
        pageNumber,
        pageRange,
        section,
        content: candidate.content,
        rank: candidate.rank,
        score: candidate.rrfScore,
        retrievalSources: candidate.retrievalSources,
      };

      sources.push(sourceItem);

      // Build structured text representation
      let header = `--- SOURCE ${citationId} | Document: ${candidate.documentName} (Chunk: ${candidate.chunkIndex + 1})`;
      if (pageRange) {
        header += ` | Page: ${pageRange}`;
      }
      if (section) {
        header += ` | Section: "${section}"`;
      }
      header += ` ---`;

      contextBlocks.push(`${header}\n${candidate.content}`);
      currentTokens += blockTokenEstimate;
    }

    const content = contextBlocks.join('\n\n');

    return {
      content,
      tokenEstimate: currentTokens,
      sources,
    };
  }
}
