/**
 * MindVault — Retrieval Engine: Reranking Engine Abstraction & Providers
 *
 * Provides a decoupled reranker interface to rescore and reorder top-N candidates.
 *
 * Key Architectural Invariants:
 * - Hardware lightweight: Never forces heavyweight Python/PyTorch dependencies.
 * - Honest reporting: If no reranker model is active, explicitly returns `rerankingApplied: false`.
 * - Graceful fallback: If an external reranker fails or is unconfigured, preserves RRF ranking.
 */

import type { RerankerProvider, RerankerCandidate, RerankerResult } from '@mindvault/shared';
import type { FusedCandidate } from '../fusion/rrf.fusion.js';

/**
 * No-Op Reranker Provider: Default fallback that preserves original RRF ranking.
 */
export class NoOpRerankerProvider implements RerankerProvider {
  public readonly providerName = 'none';

  public async isAvailable(): Promise<boolean> {
    return true;
  }

  public async rerank(
    _query: string,
    candidates: RerankerCandidate[],
    limit?: number,
  ): Promise<{ results: RerankerResult[]; applied: boolean }> {
    const effectiveLimit = limit && limit > 0 ? limit : candidates.length;
    const sliced = candidates.slice(0, effectiveLimit);

    const results: RerankerResult[] = sliced.map((c, index) => ({
      chunkId: c.chunkId,
      score: c.score,
      rank: index + 1,
    }));

    return {
      results,
      applied: false,
    };
  }
}

/**
 * Optional API / Cross-Encoder Reranker Provider placeholder (extensible for Cohere/Jina/Local Cross-Encoders)
 */
export class CustomRerankerProvider implements RerankerProvider {
  public readonly providerName: string;
  private readonly endpoint?: string;
  private readonly apiKey?: string;

  constructor(options?: { providerName?: string; endpoint?: string; apiKey?: string }) {
    this.providerName = options?.providerName || 'custom';
    this.endpoint = options?.endpoint || process.env.RERANKER_ENDPOINT;
    this.apiKey = options?.apiKey || process.env.RERANKER_API_KEY;
  }

  public async isAvailable(): Promise<boolean> {
    return Boolean(this.endpoint);
  }

  public async rerank(
    query: string,
    candidates: RerankerCandidate[],
    limit?: number,
  ): Promise<{ results: RerankerResult[]; applied: boolean }> {
    if (!this.endpoint) {
      // Not configured, fallback to no-op
      const fallback = new NoOpRerankerProvider();
      return fallback.rerank(query, candidates, limit);
    }

    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
        },
        body: JSON.stringify({
          query,
          documents: candidates.map((c) => c.content),
          topN: limit || candidates.length,
        }),
      });

      if (!response.ok) {
        throw new Error(`Reranker HTTP error: ${response.status}`);
      }

      const data = (await response.json()) as {
        results: Array<{ index: number; relevanceScore: number }>;
      };
      const ranked: RerankerResult[] = data.results.map((res, rankIdx) => ({
        chunkId: candidates[res.index].chunkId,
        score: res.relevanceScore,
        rank: rankIdx + 1,
      }));

      return {
        results: ranked,
        applied: true,
      };
    } catch {
      // Resilient fallback on network/service failure
      const fallback = new NoOpRerankerProvider();
      return fallback.rerank(query, candidates, limit);
    }
  }
}

export class RerankerService {
  private static activeProvider: RerankerProvider = new NoOpRerankerProvider();

  public static setProvider(provider: RerankerProvider): void {
    this.activeProvider = provider;
  }

  public static getProvider(): RerankerProvider {
    return this.activeProvider;
  }

  public static resetProvider(): void {
    this.activeProvider = new NoOpRerankerProvider();
  }

  /**
   * Rescores fused candidates if enabled and provider is available.
   */
  public static async rerankCandidates(
    query: string,
    candidates: FusedCandidate[],
    options?: { enabled?: boolean; topN?: number },
  ): Promise<{ candidates: FusedCandidate[]; rerankingApplied: boolean }> {
    if (!options?.enabled || candidates.length === 0) {
      return {
        candidates,
        rerankingApplied: false,
      };
    }

    const provider = this.getProvider();
    const available = await provider.isAvailable();

    if (!available || provider instanceof NoOpRerankerProvider) {
      return {
        candidates,
        rerankingApplied: false,
      };
    }

    const rerankInputs: RerankerCandidate[] = candidates.map((c) => ({
      chunkId: c.chunkId,
      content: c.content,
      score: c.rrfScore,
      initialRank: c.rank,
      metadata: c.metadata,
    }));

    const reranked = await provider.rerank(query, rerankInputs, options.topN);

    if (!reranked.applied) {
      return {
        candidates,
        rerankingApplied: false,
      };
    }

    // Reorder candidates according to reranker results
    const candidateMap = new Map(candidates.map((c) => [c.chunkId, c]));
    const reordered: FusedCandidate[] = [];

    for (const r of reranked.results) {
      const match = candidateMap.get(r.chunkId);
      if (match) {
        reordered.push({
          ...match,
          rank: r.rank,
          rrfScore: r.score, // updated relevance score
        });
        candidateMap.delete(r.chunkId);
      }
    }

    // Append any remaining un-reranked candidates
    for (const remaining of candidateMap.values()) {
      reordered.push({
        ...remaining,
        rank: reordered.length + 1,
      });
    }

    return {
      candidates: reordered,
      rerankingApplied: true,
    };
  }
}
