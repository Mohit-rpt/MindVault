import { describe, it, expect } from 'vitest';
import { RetrievalMetrics } from './metrics.js';

describe('RetrievalMetrics', () => {
  const relevantIds = new Set(['doc_a', 'doc_b']);

  describe('precisionAtK', () => {
    it('should compute correct precision at 1 and 2', () => {
      expect(RetrievalMetrics.precisionAtK(['doc_a', 'doc_c'], relevantIds, 1)).toBe(1.0);
      expect(RetrievalMetrics.precisionAtK(['doc_a', 'doc_c'], relevantIds, 2)).toBe(0.5);
      expect(RetrievalMetrics.precisionAtK(['doc_x', 'doc_y'], relevantIds, 2)).toBe(0.0);
    });

    it('should return 0 when k is 0 or relevant set is empty', () => {
      expect(RetrievalMetrics.precisionAtK(['doc_a'], relevantIds, 0)).toBe(0);
      expect(RetrievalMetrics.precisionAtK(['doc_a'], new Set(), 5)).toBe(0);
    });
  });

  describe('recallAtK', () => {
    it('should compute correct recall at 1 and 2', () => {
      // 2 relevant items: doc_a, doc_b
      expect(RetrievalMetrics.recallAtK(['doc_a', 'doc_c'], relevantIds, 1)).toBe(0.5);
      expect(RetrievalMetrics.recallAtK(['doc_a', 'doc_b'], relevantIds, 2)).toBe(1.0);
      expect(RetrievalMetrics.recallAtK(['doc_x', 'doc_y'], relevantIds, 2)).toBe(0.0);
    });
  });

  describe('reciprocalRank and MRR', () => {
    it('should compute 1.0 when relevant item is rank 1', () => {
      expect(RetrievalMetrics.reciprocalRank(['doc_a', 'doc_c'], relevantIds)).toBe(1.0);
    });

    it('should compute 0.5 when relevant item is rank 2', () => {
      expect(RetrievalMetrics.reciprocalRank(['doc_x', 'doc_b'], relevantIds)).toBe(0.5);
    });

    it('should compute 0 when no relevant item is found', () => {
      expect(RetrievalMetrics.reciprocalRank(['doc_x', 'doc_y'], relevantIds)).toBe(0);
    });

    it('should compute mean reciprocal rank correctly across queries', () => {
      const rrValues = [1.0, 0.5, 0.25]; // (1.0 + 0.5 + 0.25) / 3 = 1.75 / 3 = 0.5833
      expect(RetrievalMetrics.meanReciprocalRank(rrValues)).toBeCloseTo(0.5833, 4);
      expect(RetrievalMetrics.meanReciprocalRank([])).toBe(0);
    });
  });

  describe('dcgAtK and ndcgAtK', () => {
    const relevanceGrades = new Map([
      ['doc_1', 3],
      ['doc_2', 2],
      ['doc_3', 1],
    ]);

    it('should compute perfect nDCG=1.0 for ideal ranking', () => {
      const retrieved = ['doc_1', 'doc_2', 'doc_3'];
      const ndcg = RetrievalMetrics.ndcgAtK(retrieved, relevanceGrades, 3);
      expect(ndcg).toBeCloseTo(1.0, 4);
    });

    it('should compute discounted nDCG when relevant items are degraded in rank', () => {
      const suboptimal = ['doc_3', 'doc_2', 'doc_1'];
      const ndcg = RetrievalMetrics.ndcgAtK(suboptimal, relevanceGrades, 3);
      expect(ndcg).toBeLessThan(1.0);
      expect(ndcg).toBeGreaterThan(0.5);
    });

    it('should return 0 when no relevant items are retrieved', () => {
      expect(RetrievalMetrics.ndcgAtK(['doc_99', 'doc_100'], relevanceGrades, 2)).toBe(0);
    });
  });
});
