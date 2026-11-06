import { describe, it, expect } from 'vitest';
import { ReciprocalRankFusion } from './rrf.fusion.js';
import type { SearchChunkResult } from '../../../lib/db.js';

function createMockResult(id: string, score: number, chunkIndex = 0): SearchChunkResult {
  return {
    chunk: {
      id,
      documentId: 'doc_1',
      workspaceId: 'ws_1',
      chunkIndex,
      content: `Content for chunk ${id}`,
      tokenCount: 50,
      pageStart: 1,
      pageEnd: 1,
      metadata: {},
      createdAt: new Date(),
    },
    document: {
      id: 'doc_1',
      originalName: 'report.pdf',
      extension: 'pdf',
      status: 'COMPLETED',
      pageCount: 5,
    },
    score,
  };
}

describe('ReciprocalRankFusion', () => {
  it('should rank items appearing in both semantic and keyword retrieval highest', () => {
    // Chk1 is rank 1 in semantic and rank 2 in keyword
    // Chk2 is rank 2 in semantic and not in keyword
    // Chk3 is rank 1 in keyword and not in semantic
    const semantic = [createMockResult('chk_1', 0.95), createMockResult('chk_2', 0.85)];
    const keyword = [createMockResult('chk_3', 5.0), createMockResult('chk_1', 4.0)];

    const fused = ReciprocalRankFusion.fuse(semantic, keyword, { k: 60, topK: 10 });

    expect(fused.length).toBe(3);
    // Chk 1 score: 1/(60+1) + 1/(60+2) = 1/61 + 1/62 = 0.016393 + 0.016129 = 0.032522
    // Chk 3 score: 1/(60+1) = 1/61 = 0.016393
    // Chk 2 score: 1/(60+2) = 1/62 = 0.016129
    expect(fused[0].chunkId).toBe('chk_1');
    expect(fused[0].rank).toBe(1);
    expect(fused[0].retrievalSources).toContain('semantic');
    expect(fused[0].retrievalSources).toContain('keyword');
    expect(fused[0].rrfScore).toBeCloseTo(0.032522, 5);

    expect(fused[1].chunkId).toBe('chk_3');
    expect(fused[1].rank).toBe(2);
    expect(fused[1].retrievalSources).toEqual(['keyword']);

    expect(fused[2].chunkId).toBe('chk_2');
    expect(fused[2].rank).toBe(3);
    expect(fused[2].retrievalSources).toEqual(['semantic']);
  });

  it('should handle empty semantic results gracefully', () => {
    const semantic: SearchChunkResult[] = [];
    const keyword = [createMockResult('chk_k1', 10.0), createMockResult('chk_k2', 5.0)];

    const fused = ReciprocalRankFusion.fuse(semantic, keyword);
    expect(fused.length).toBe(2);
    expect(fused[0].chunkId).toBe('chk_k1');
    expect(fused[1].chunkId).toBe('chk_k2');
    expect(fused[0].retrievalSources).toEqual(['keyword']);
  });

  it('should handle empty keyword results gracefully', () => {
    const semantic = [createMockResult('chk_s1', 0.9), createMockResult('chk_s2', 0.7)];
    const keyword: SearchChunkResult[] = [];

    const fused = ReciprocalRankFusion.fuse(semantic, keyword);
    expect(fused.length).toBe(2);
    expect(fused[0].chunkId).toBe('chk_s1');
    expect(fused[1].chunkId).toBe('chk_s2');
    expect(fused[0].retrievalSources).toEqual(['semantic']);
  });

  it('should handle both result sets being empty', () => {
    const fused = ReciprocalRankFusion.fuse([], []);
    expect(fused).toEqual([]);
  });

  it('should respect topK truncation limit', () => {
    const semantic = [
      createMockResult('chk_1', 0.9),
      createMockResult('chk_2', 0.8),
      createMockResult('chk_3', 0.7),
      createMockResult('chk_4', 0.6),
    ];
    const keyword = [createMockResult('chk_5', 4.0), createMockResult('chk_6', 3.0)];

    const fused = ReciprocalRankFusion.fuse(semantic, keyword, { topK: 3 });
    expect(fused.length).toBe(3);
    expect(fused.map((f) => f.rank)).toEqual([1, 2, 3]);
  });

  it('should use custom k parameter when provided', () => {
    const semantic = [createMockResult('chk_1', 0.9)];
    const keyword = [createMockResult('chk_1', 1.0)];

    const fused = ReciprocalRankFusion.fuse(semantic, keyword, { k: 10 });
    // Score with k=10: 1/(10+1) + 1/(10+1) = 2/11 = 0.181818
    expect(fused[0].rrfScore).toBeCloseTo(2 / 11, 5);
  });
});
