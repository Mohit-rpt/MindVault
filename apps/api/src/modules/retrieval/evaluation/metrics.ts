/**
 * MindVault — Retrieval Evaluation Framework: Information Retrieval Metrics
 *
 * Implements standard IR evaluation formulas:
 * - Precision@K
 * - Recall@K
 * - Mean Reciprocal Rank (MRR)
 * - Discounted Cumulative Gain (DCG@K)
 * - Normalized Discounted Cumulative Gain (nDCG@K)
 */

export class RetrievalMetrics {
  /**
   * Precision@K: Fraction of top-K retrieved documents that are relevant.
   * Precision@K = |retrieved@K ∩ relevant| / K
   */
  public static precisionAtK(
    retrievedIds: string[],
    relevantIds: Set<string> | string[],
    k: number,
  ): number {
    if (k <= 0) return 0;
    const relSet = relevantIds instanceof Set ? relevantIds : new Set(relevantIds);
    if (relSet.size === 0) return 0;

    const topK = retrievedIds.slice(0, k);
    let hits = 0;
    for (const id of topK) {
      if (relSet.has(id)) {
        hits++;
      }
    }
    return hits / k;
  }

  /**
   * Recall@K: Fraction of all relevant documents that are retrieved in top-K.
   * Recall@K = |retrieved@K ∩ relevant| / |relevant|
   */
  public static recallAtK(
    retrievedIds: string[],
    relevantIds: Set<string> | string[],
    k: number,
  ): number {
    const relSet = relevantIds instanceof Set ? relevantIds : new Set(relevantIds);
    if (relSet.size === 0) return 0;

    const topK = retrievedIds.slice(0, k);
    let hits = 0;
    for (const id of topK) {
      if (relSet.has(id)) {
        hits++;
      }
    }
    return hits / relSet.size;
  }

  /**
   * Reciprocal Rank (RR): Reciprocal of the rank of the first relevant document.
   * RR = 1 / rank_first
   */
  public static reciprocalRank(
    retrievedIds: string[],
    relevantIds: Set<string> | string[],
  ): number {
    const relSet = relevantIds instanceof Set ? relevantIds : new Set(relevantIds);
    if (relSet.size === 0) return 0;

    for (let i = 0; i < retrievedIds.length; i++) {
      if (relSet.has(retrievedIds[i])) {
        return 1 / (i + 1);
      }
    }
    return 0;
  }

  /**
   * Mean Reciprocal Rank (MRR): Average of RR across a query set.
   */
  public static meanReciprocalRank(rrValues: number[]): number {
    if (rrValues.length === 0) return 0;
    const sum = rrValues.reduce((acc, val) => acc + val, 0);
    return sum / rrValues.length;
  }

  /**
   * Discounted Cumulative Gain at K (DCG@K).
   * DCG@K = Σ [ (2^rel_i - 1) / log2(i + 1) ]
   */
  public static dcgAtK(
    retrievedIds: string[],
    relevanceGrades: Map<string, number>,
    k: number,
  ): number {
    if (k <= 0) return 0;
    const topK = retrievedIds.slice(0, k);
    let dcg = 0;

    for (let i = 0; i < topK.length; i++) {
      const id = topK[i];
      const rel = relevanceGrades.get(id) || 0;
      if (rel > 0) {
        const gain = Math.pow(2, rel) - 1;
        const discount = Math.log2(i + 2); // i is 0-indexed, so rank = i+1, log2(rank+1) = log2(i+2)
        dcg += gain / discount;
      }
    }

    return dcg;
  }

  /**
   * Normalized Discounted Cumulative Gain at K (nDCG@K).
   * nDCG@K = DCG@K / IDCG@K
   */
  public static ndcgAtK(
    retrievedIds: string[],
    relevanceGrades: Map<string, number>,
    k: number,
  ): number {
    if (k <= 0 || relevanceGrades.size === 0) return 0;

    const actualDcg = this.dcgAtK(retrievedIds, relevanceGrades, k);
    if (actualDcg === 0) return 0;

    // Ideal DCG: sort all grades descending
    const idealGrades = Array.from(relevanceGrades.values()).sort((a, b) => b - a);
    let idcg = 0;
    const idealLimit = Math.min(k, idealGrades.length);

    for (let i = 0; i < idealLimit; i++) {
      const rel = idealGrades[i];
      if (rel > 0) {
        const gain = Math.pow(2, rel) - 1;
        const discount = Math.log2(i + 2);
        idcg += gain / discount;
      }
    }

    if (idcg === 0) return 0;
    return Math.min(1.0, actualDcg / idcg);
  }
}
