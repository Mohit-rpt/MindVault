/**
 * MindVault — Retrieval Engine: Reciprocal Rank Fusion (RRF)
 *
 * Implements reciprocal rank fusion to combine candidate ranked lists
 * from disparate retrieval strategies (dense vector semantic search
 * and sparse PostgreSQL full-text search) without scale bias.
 *
 * Formula:
 *   RRF_score(d) = Σ [ 1 / (k + rank_m(d)) ]
 *   where k = 60 (standard RRF constant)
 */

import type { SearchChunkResult } from '../../../lib/db.js';

export interface FusedCandidate {
  chunkId: string;
  documentId: string;
  documentName: string;
  documentExtension: string;
  content: string;
  chunkIndex: number;
  tokenCount: number;
  pageStart: number | null;
  pageEnd: number | null;
  metadata: Record<string, unknown>;
  semanticRank?: number;
  semanticScore?: number;
  keywordRank?: number;
  keywordScore?: number;
  retrievalSources: Array<'semantic' | 'keyword'>;
  rrfScore: number;
  rank: number;
}

export interface FusionOptions {
  /** RRF smoothing constant (default: 60) */
  k?: number;
  /** Maximum number of fused candidates to return (default: 10) */
  topK?: number;
}

export class ReciprocalRankFusion {
  public static readonly DEFAULT_K = 60;

  /**
   * Fuses dense semantic search results and sparse keyword search results.
   *
   * @param semanticResults Results ordered by descending cosine similarity
   * @param keywordResults Results ordered by descending text search rank
   * @param options Fusion tuning parameters (k, topK)
   * @returns Fused candidates deduplicated by chunk ID, sorted by descending fused score
   */
  public static fuse(
    semanticResults: SearchChunkResult[],
    keywordResults: SearchChunkResult[],
    options?: FusionOptions,
  ): FusedCandidate[] {
    const k = options?.k !== undefined && options.k > 0 ? options.k : this.DEFAULT_K;
    const topK = options?.topK !== undefined && options.topK > 0 ? options.topK : 10;

    const candidateMap = new Map<string, FusedCandidate>();

    // 1. Process Semantic Results (1-indexed rank)
    semanticResults.forEach((item, index) => {
      const rank = index + 1;
      const scoreIncrement = 1 / (k + rank);

      const existing = candidateMap.get(item.chunk.id);
      if (existing) {
        existing.rrfScore += scoreIncrement;
        existing.semanticRank = rank;
        existing.semanticScore = item.score;
        if (!existing.retrievalSources.includes('semantic')) {
          existing.retrievalSources.push('semantic');
        }
      } else {
        candidateMap.set(item.chunk.id, {
          chunkId: item.chunk.id,
          documentId: item.chunk.documentId,
          documentName: item.document.originalName,
          documentExtension: item.document.extension,
          content: item.chunk.content,
          chunkIndex: item.chunk.chunkIndex,
          tokenCount: item.chunk.tokenCount,
          pageStart: item.chunk.pageStart,
          pageEnd: item.chunk.pageEnd,
          metadata: item.chunk.metadata || {},
          semanticRank: rank,
          semanticScore: item.score,
          retrievalSources: ['semantic'],
          rrfScore: scoreIncrement,
          rank: 0,
        });
      }
    });

    // 2. Process Keyword Results (1-indexed rank)
    keywordResults.forEach((item, index) => {
      const rank = index + 1;
      const scoreIncrement = 1 / (k + rank);

      const existing = candidateMap.get(item.chunk.id);
      if (existing) {
        existing.rrfScore += scoreIncrement;
        existing.keywordRank = rank;
        existing.keywordScore = item.score;
        if (!existing.retrievalSources.includes('keyword')) {
          existing.retrievalSources.push('keyword');
        }
      } else {
        candidateMap.set(item.chunk.id, {
          chunkId: item.chunk.id,
          documentId: item.chunk.documentId,
          documentName: item.document.originalName,
          documentExtension: item.document.extension,
          content: item.chunk.content,
          chunkIndex: item.chunk.chunkIndex,
          tokenCount: item.chunk.tokenCount,
          pageStart: item.chunk.pageStart,
          pageEnd: item.chunk.pageEnd,
          metadata: item.chunk.metadata || {},
          keywordRank: rank,
          keywordScore: item.score,
          retrievalSources: ['keyword'],
          rrfScore: scoreIncrement,
          rank: 0,
        });
      }
    });

    // 3. Sort by fused RRF score descending
    const sorted = Array.from(candidateMap.values()).sort((a, b) => {
      if (b.rrfScore !== a.rrfScore) {
        return b.rrfScore - a.rrfScore;
      }
      // Stable tie-breaker: prefer chunks appearing in both sources
      if (b.retrievalSources.length !== a.retrievalSources.length) {
        return b.retrievalSources.length - a.retrievalSources.length;
      }
      // Secondary tie-breaker: chunk index ascending
      return a.chunkIndex - b.chunkIndex;
    });

    // 4. Assign 1-indexed overall rank and truncate to topK
    const finalResults = sorted.slice(0, topK).map((candidate, idx) => ({
      ...candidate,
      rank: idx + 1,
    }));

    return finalResults;
  }
}
