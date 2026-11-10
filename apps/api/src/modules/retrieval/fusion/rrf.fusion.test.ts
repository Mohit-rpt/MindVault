import { describe, it, expect } from 'vitest';
import { ReciprocalRankFusion, type NormalizedCandidate } from './rrf.fusion.js';
import type { SearchChunkResult } from '../../../lib/db.js';
import type { RawGraphChunkRow, RawGraphRelationRow } from '@mindvault/shared';

function createMockResult(
  id: string,
  score: number,
  chunkIndex = 0,
  documentId = 'doc_1',
  metadata: Record<string, unknown> = {},
): SearchChunkResult {
  return {
    chunk: {
      id,
      documentId,
      workspaceId: 'ws_1',
      chunkIndex,
      content: `Content for chunk ${id}`,
      tokenCount: 50,
      pageStart: 1,
      pageEnd: 1,
      metadata,
      createdAt: new Date(),
    },
    document: {
      id: documentId,
      originalName: `${documentId}.pdf`,
      extension: 'pdf',
      status: 'COMPLETED',
      pageCount: 5,
    },
    score,
  };
}

function createMockGraphChunk(
  id: string,
  score: number,
  chunkIndex = 0,
  documentId = 'doc_1',
  options?: {
    supportedRelationIds?: string[];
    relationTypes?: string[];
    graphRelations?: RawGraphRelationRow[];
    metadata?: Record<string, unknown>;
  },
): RawGraphChunkRow {
  return {
    chunkId: id,
    documentId,
    workspaceId: 'ws_1',
    chunkIndex,
    content: `Graph content for chunk ${id}`,
    tokenCount: 50,
    pageStart: 1,
    pageEnd: 1,
    metadata: options?.metadata || {},
    createdAt: new Date(),
    docOriginalName: `${documentId}.pdf`,
    docExtension: 'pdf',
    docStatus: 'COMPLETED',
    docPageCount: 5,
    score,
    supportedRelationsCount: options?.supportedRelationIds?.length || 0,
    supportedRelationIds: options?.supportedRelationIds || [],
    relationTypes: options?.relationTypes || [],
    graphRelations: options?.graphRelations,
  } as RawGraphChunkRow;
}

describe('ReciprocalRankFusion (Task 6.6.2.1 Pure RRF Engine)', () => {
  // ==========================================
  // Category 1: Mathematical Correctness
  // ==========================================
  describe('1. Mathematical Correctness', () => {
    it('1. calculates exact score for single semantic result at rank 1', () => {
      const semantic = [createMockResult('chk_1', 0.95)];
      const fused = ReciprocalRankFusion.fuseChannels({ semantic });

      expect(fused).toHaveLength(1);
      // RRF = 1 / (60 + 1) = 1/61
      expect(fused[0].rrfScore).toBeCloseTo(1 / 61, 7);
      expect(fused[0].rank).toBe(1);
      expect(fused[0].semanticRank).toBe(1);
      expect(fused[0].semanticScore).toBe(0.95);
      expect(fused[0].retrievalSources).toEqual(['semantic']);
    });

    it('2. calculates exact score for single keyword result at rank 1', () => {
      const keyword = [createMockResult('chk_k1', 5.0)];
      const fused = ReciprocalRankFusion.fuseChannels({ keyword });

      expect(fused).toHaveLength(1);
      // RRF = 1 / (60 + 1) = 1/61
      expect(fused[0].rrfScore).toBeCloseTo(1 / 61, 7);
      expect(fused[0].rank).toBe(1);
      expect(fused[0].keywordRank).toBe(1);
      expect(fused[0].keywordScore).toBe(5.0);
      expect(fused[0].retrievalSources).toEqual(['keyword']);
    });

    it('3. calculates exact score for single graph result at rank 1', () => {
      const graph = [createMockGraphChunk('chk_g1', 0.85)];
      const fused = ReciprocalRankFusion.fuseChannels({ graph });

      expect(fused).toHaveLength(1);
      // RRF = 1 / (60 + 1) = 1/61
      expect(fused[0].rrfScore).toBeCloseTo(1 / 61, 7);
      expect(fused[0].rank).toBe(1);
      expect(fused[0].graphRank).toBe(1);
      expect(fused[0].graphScore).toBe(0.85);
      expect(fused[0].retrievalSources).toEqual(['graph']);
    });

    it('4. calculates exact additive synergy when same chunk ranks first in all three channels', () => {
      const semantic = [createMockResult('chk_1', 0.95)];
      const keyword = [createMockResult('chk_1', 5.0)];
      const graph = [createMockGraphChunk('chk_1', 0.92)];

      const fused = ReciprocalRankFusion.fuseChannels({ semantic, keyword, graph });

      expect(fused).toHaveLength(1);
      // RRF = 1/61 + 1/61 + 1/61 = 3/61 ≈ 0.0491803
      const expectedScore = 3 / 61;
      expect(fused[0].rrfScore).toBeCloseTo(expectedScore, 7);
      expect(fused[0].rank).toBe(1);
      expect(fused[0].retrievalSources).toEqual(['semantic', 'keyword', 'graph']);
      expect(fused[0].semanticRank).toBe(1);
      expect(fused[0].keywordRank).toBe(1);
      expect(fused[0].graphRank).toBe(1);
    });

    it('5. calculates exact score when same chunk appears at different ranks in different channels', () => {
      // chk_1 is rank 1 in semantic (1/61), rank 2 in keyword (1/62), rank 3 in graph (1/63)
      const semantic = [createMockResult('chk_1', 0.95)];
      const keyword = [createMockResult('other_1', 4.0), createMockResult('chk_1', 3.0)];
      const graph = [
        createMockGraphChunk('g_other_1', 0.9),
        createMockGraphChunk('g_other_2', 0.8),
        createMockGraphChunk('chk_1', 0.7),
      ];

      const fused = ReciprocalRankFusion.fuseChannels({ semantic, keyword, graph });
      const chk1 = fused.find((f) => f.chunkId === 'chk_1')!;

      expect(chk1).toBeDefined();
      const expectedScore = 1 / 61 + 1 / 62 + 1 / 63;
      expect(chk1.rrfScore).toBeCloseTo(expectedScore, 7);
      expect(chk1.semanticRank).toBe(1);
      expect(chk1.keywordRank).toBe(2);
      expect(chk1.graphRank).toBe(3);
    });

    it('6. correctly handles candidate missing from one or two channels', () => {
      // chk_sem: only semantic (rank 1 -> 1/61)
      // chk_both: semantic rank 2 (1/62) + keyword rank 1 (1/61)
      // chk_graph: only graph rank 1 (1/61)
      const semantic = [
        createMockResult('chk_sem', 0.95, 0),
        createMockResult('chk_both', 0.85, 1),
      ];
      const keyword = [createMockResult('chk_both', 4.0, 1)];
      const graph = [createMockGraphChunk('chk_graph', 0.75, 2)];

      const fused = ReciprocalRankFusion.fuseChannels({ semantic, keyword, graph });

      // chk_both has score 1/61 + 1/62 ≈ 0.032522 -> rank 1
      expect(fused[0].chunkId).toBe('chk_both');
      expect(fused[0].rank).toBe(1);
      expect(fused[0].rrfScore).toBeCloseTo(1 / 61 + 1 / 62, 7);
      expect(fused[0].retrievalSources).toEqual(['semantic', 'keyword']);

      // chk_sem and chk_graph both have score 1/61.
      // chk_sem has chunkIndex 0, chk_graph has chunkIndex 2 -> chk_sem ranks ahead of chk_graph!
      expect(fused[1].chunkId).toBe('chk_sem');
      expect(fused[1].rank).toBe(2);
      expect(fused[1].retrievalSources).toEqual(['semantic']);

      expect(fused[2].chunkId).toBe('chk_graph');
      expect(fused[2].rank).toBe(3);
      expect(fused[2].retrievalSources).toEqual(['graph']);
    });

    it('7. applies custom RRF constant k correctly', () => {
      const semantic = [createMockResult('chk_1', 0.95)];
      const fused = ReciprocalRankFusion.fuseChannels({ semantic }, { k: 20 });

      expect(fused).toHaveLength(1);
      // RRF = 1 / (20 + 1) = 1/21 ≈ 0.047619
      expect(fused[0].rrfScore).toBeCloseTo(1 / 21, 7);
    });

    it('8. applies custom channel weights correctly', () => {
      // semantic weight = 2.0, keyword weight = 1.0, graph weight = 0.5
      const semantic = [createMockResult('chk_s', 0.95)];
      const keyword = [createMockResult('chk_k', 5.0)];
      const graph = [createMockGraphChunk('chk_g', 0.9)];

      const fused = ReciprocalRankFusion.fuseChannels(
        { semantic, keyword, graph },
        { weights: { semantic: 2.0, keyword: 1.0, graph: 0.5 } },
      );

      expect(fused[0].chunkId).toBe('chk_s');
      expect(fused[0].rrfScore).toBeCloseTo(2.0 / 61, 7);

      expect(fused[1].chunkId).toBe('chk_k');
      expect(fused[1].rrfScore).toBeCloseTo(1.0 / 61, 7);

      expect(fused[2].chunkId).toBe('chk_g');
      expect(fused[2].rrfScore).toBeCloseTo(0.5 / 61, 7);
    });
  });

  // ==========================================
  // Category 2: Duplicate Handling
  // ==========================================
  describe('2. Duplicate Handling', () => {
    it('9. produces exactly one fused result when same chunk is in all three channels', () => {
      const semantic = [createMockResult('chk_1', 0.95)];
      const keyword = [createMockResult('chk_1', 5.0)];
      const graph = [createMockGraphChunk('chk_1', 0.9)];

      const fused = ReciprocalRankFusion.fuseChannels({ semantic, keyword, graph });
      expect(fused).toHaveLength(1);
      expect(fused[0].chunkId).toBe('chk_1');
      expect(fused[0].retrievalSources).toHaveLength(3);
    });

    it('10. keeps different chunks from the same document separate', () => {
      const semantic = [
        createMockResult('chk_doc1_c0', 0.95, 0, 'doc_1'),
        createMockResult('chk_doc1_c1', 0.85, 1, 'doc_1'),
      ];

      const fused = ReciprocalRankFusion.fuseChannels({ semantic });
      expect(fused).toHaveLength(2);
      expect(fused[0].chunkId).toBe('chk_doc1_c0');
      expect(fused[0].documentId).toBe('doc_1');
      expect(fused[1].chunkId).toBe('chk_doc1_c1');
      expect(fused[1].documentId).toBe('doc_1');
    });

    it('11. does not inflate provenance when duplicate graph evidence records reference the same relation', () => {
      const graphRel: RawGraphRelationRow = {
        relationId: 'rel-1',
        sourceEntityId: 'e1',
        sourceCanonicalName: 'PostgreSQL',
        targetEntityId: 'e2',
        targetCanonicalName: 'WAL Engine',
        relationType: 'USES',
        weight: 1.0,
        confidence: 0.95,
        depth: 1,
        evidenceChunkIds: ['chk_1'],
      };

      // Two graph evidence entries referencing the exact same relationId: 'rel-1'
      const graphEntry1 = createMockGraphChunk('chk_1', 0.85, 0, 'doc_1', {
        supportedRelationIds: ['rel-1'],
        relationTypes: ['USES'],
        graphRelations: [graphRel],
      });
      const graphEntry2 = createMockGraphChunk('chk_1', 0.85, 0, 'doc_1', {
        supportedRelationIds: ['rel-1'],
        relationTypes: ['USES'],
        graphRelations: [graphRel],
      });

      const fused = ReciprocalRankFusion.fuseChannels({
        graph: [graphEntry1, graphEntry2],
      });

      expect(fused).toHaveLength(1);
      // relationId 'rel-1' must be deduplicated
      expect(fused[0].supportedRelationIds).toEqual(['rel-1']);
      expect(fused[0].supportedRelationsCount).toBe(1);
      expect(fused[0].relationTypes).toEqual(['USES']);
      expect(fused[0].graphRelations).toHaveLength(1);
      expect(fused[0].graphRelations![0].relationId).toBe('rel-1');
    });

    it('12. preserves distinct graph evidence records for the same chunk', () => {
      const rel1: RawGraphRelationRow = {
        relationId: 'rel-1',
        sourceEntityId: 'e1',
        sourceCanonicalName: 'PostgreSQL',
        targetEntityId: 'e2',
        targetCanonicalName: 'WAL',
        relationType: 'USES',
        weight: 1.0,
        confidence: 0.95,
        depth: 1,
        evidenceChunkIds: ['chk_1'],
      };

      const rel2: RawGraphRelationRow = {
        relationId: 'rel-2',
        sourceEntityId: 'e2',
        sourceCanonicalName: 'WAL',
        targetEntityId: 'e3',
        targetCanonicalName: 'Disk Buffer',
        relationType: 'WRITES_TO',
        weight: 0.9,
        confidence: 0.85,
        depth: 2,
        evidenceChunkIds: ['chk_1'],
      };

      const graphEntry = createMockGraphChunk('chk_1', 0.85, 0, 'doc_1', {
        supportedRelationIds: ['rel-1', 'rel-2'],
        relationTypes: ['USES', 'WRITES_TO'],
        graphRelations: [rel1, rel2],
      });

      const fused = ReciprocalRankFusion.fuseChannels({ graph: [graphEntry] });
      expect(fused).toHaveLength(1);
      expect(fused[0].supportedRelationIds).toEqual(['rel-1', 'rel-2']);
      expect(fused[0].supportedRelationsCount).toBe(2);
      expect(fused[0].relationTypes).toEqual(['USES', 'WRITES_TO']);
      expect(fused[0].graphRelations).toHaveLength(2);
    });

    it('13. does not produce duplicate contribution when duplicate candidate appears in same channel', () => {
      // chk_1 appears at index 0 and index 2 in semantic
      const semantic = [
        createMockResult('chk_1', 0.95),
        createMockResult('chk_2', 0.85),
        createMockResult('chk_1', 0.75),
      ];

      const fused = ReciprocalRankFusion.fuseChannels({ semantic });
      const chk1 = fused.find((f) => f.chunkId === 'chk_1')!;

      // chk_1 receives score for rank 1 only (1/61) NOT (1/61 + 1/63)
      expect(chk1.rrfScore).toBeCloseTo(1 / 61, 7);
      expect(chk1.semanticRank).toBe(1);
      expect(chk1.semanticScore).toBe(0.95);
    });

    it('14. resolves conflicting metadata deterministically without last-write-wins', () => {
      const semantic = [
        createMockResult('chk_1', 0.95, 0, 'doc_1', {
          section: 'Introduction',
          source: 'canonical',
        }),
      ];
      const keyword = [
        createMockResult('chk_1', 5.0, 0, 'doc_1', {
          section: 'Intro Heading',
          tag: 'database',
        }),
      ];

      const fused = ReciprocalRankFusion.fuseChannels({ semantic, keyword });
      expect(fused).toHaveLength(1);
      // Section from canonical channel (semantic) is preserved
      expect(fused[0].metadata.section).toBe('Introduction');
      // Additional non-conflicting key from keyword is preserved
      expect(fused[0].metadata.tag).toBe('database');
      expect(fused[0].metadata.source).toBe('canonical');
    });
  });

  // ==========================================
  // Category 3: Determinism & Tie-Breaking
  // ==========================================
  describe('3. Determinism & Tie-Breaking', () => {
    it('15. breaks equal RRF score ties using source-count (Tier 2)', () => {
      // Both candidates will have score = 0.032258
      // chk_multi: appears in 2 channels (semantic rank 2 + keyword rank 2 = 1/62 + 1/62)
      // chk_single: custom weight single channel score = 2.0 / (60 + 2) = 2/62
      const semantic = [createMockResult('dummy_1', 0.99), createMockResult('chk_multi', 0.9)];
      const keyword = [createMockResult('dummy_2', 5.0), createMockResult('chk_multi', 4.0)];
      const graph = [
        createMockGraphChunk('dummy_3', 0.99),
        createMockGraphChunk('chk_single', 0.9),
      ];

      // Setting graph weight = 2.0 so chk_single at rank 2 has score = 2/62 = 1/31
      // chk_multi has score = 1/62 + 1/62 = 2/62 = 1/31
      const fused = ReciprocalRankFusion.fuseChannels(
        { semantic, keyword, graph },
        { weights: { semantic: 1.0, keyword: 1.0, graph: 2.0 } },
      );

      const multi = fused.find((f) => f.chunkId === 'chk_multi')!;
      const single = fused.find((f) => f.chunkId === 'chk_single')!;

      expect(multi.rrfScore).toBeCloseTo(single.rrfScore, 7);
      expect(multi.retrievalSources.length).toBe(2);
      expect(single.retrievalSources.length).toBe(1);

      // multi MUST outrank single due to Tier 2 (retrievalSources.length DESC)
      expect(multi.rank).toBeLessThan(single.rank);
    });

    it('16. breaks equal RRF score and equal source-count ties using chunkIndex (Tier 3)', () => {
      // Both appear in semantic only at rank 1 (score 1/61)
      // chk_earlier has chunkIndex = 2
      // chk_later has chunkIndex = 5
      const semantic = [createMockResult('chk_later', 0.95, 5)];
      const keyword = [createMockResult('chk_earlier', 5.0, 2)];

      const fused = ReciprocalRankFusion.fuseChannels({ semantic, keyword });

      expect(fused[0].rrfScore).toBeCloseTo(fused[1].rrfScore, 7);
      expect(fused[0].retrievalSources.length).toBe(fused[1].retrievalSources.length);

      // chk_earlier (chunkIndex 2) MUST outrank chk_later (chunkIndex 5)
      expect(fused[0].chunkId).toBe('chk_earlier');
      expect(fused[0].chunkIndex).toBe(2);
      expect(fused[1].chunkId).toBe('chk_later');
      expect(fused[1].chunkIndex).toBe(5);
    });

    it('17. breaks remaining ties using canonical chunkId ASCII code point order (Tier 4)', () => {
      // Both appear in single channel, same chunkIndex = 0, same score 1/61
      // chk_alpha = '00000000-0000-0000-0000-000000000001'
      // chk_omega = 'ffffffff-ffff-ffff-ffff-ffffffffffff'
      const semantic = [createMockResult('ffffffff-ffff-ffff-ffff-ffffffffffff', 0.95, 0)];
      const keyword = [createMockResult('00000000-0000-0000-0000-000000000001', 5.0, 0)];

      const fused = ReciprocalRankFusion.fuseChannels({ semantic, keyword });

      expect(fused[0].rrfScore).toBeCloseTo(fused[1].rrfScore, 7);
      expect(fused[0].chunkIndex).toBe(fused[1].chunkIndex);

      // '0000...' < 'ffff...' in UTF-16 code points
      expect(fused[0].chunkId).toBe('00000000-0000-0000-0000-000000000001');
      expect(fused[1].chunkId).toBe('ffffffff-ffff-ffff-ffff-ffffffffffff');
    });

    it('18. produces identical output regardless of channel object property insertion order', () => {
      const c1 = createMockResult('chk_1', 0.9, 0);
      const c2 = createMockResult('chk_2', 0.8, 1);
      const g1 = createMockGraphChunk('chk_3', 0.7, 2);

      const fusedOrder1 = ReciprocalRankFusion.fuseChannels({
        semantic: [c1],
        keyword: [c2],
        graph: [g1],
      });

      const fusedOrder2 = ReciprocalRankFusion.fuseChannels({
        graph: [g1],
        semantic: [c1],
        keyword: [c2],
      });

      expect(fusedOrder1).toEqual(fusedOrder2);
    });

    it('19. produces 100% identical output across repeated consecutive executions', () => {
      const semantic = [createMockResult('chk_1', 0.9), createMockResult('chk_2', 0.8)];
      const keyword = [createMockResult('chk_3', 4.0), createMockResult('chk_1', 3.0)];
      const graph = [createMockGraphChunk('chk_4', 0.7), createMockGraphChunk('chk_2', 0.6)];

      const baseline = ReciprocalRankFusion.fuseChannels({ semantic, keyword, graph });

      for (let i = 0; i < 10; i++) {
        const run = ReciprocalRankFusion.fuseChannels({ semantic, keyword, graph });
        expect(run).toEqual(baseline);
      }
    });
  });

  // ==========================================
  // Category 4: Validation & Boundaries
  // ==========================================
  describe('4. Validation & Boundaries', () => {
    it('20. returns empty array when all channel inputs are empty', () => {
      expect(ReciprocalRankFusion.fuseChannels({})).toEqual([]);
      expect(ReciprocalRankFusion.fuseChannels({ semantic: [], keyword: [], graph: [] })).toEqual(
        [],
      );
      expect(ReciprocalRankFusion.fuse([], [])).toEqual([]);
    });

    it('21. rejects invalid RRF constant k with descriptive error', () => {
      const sem = [createMockResult('chk_1', 0.9)];
      expect(() => ReciprocalRankFusion.fuseChannels({ semantic: sem }, { k: 0 })).toThrow(
        /Invalid RRF constant k/,
      );
      expect(() => ReciprocalRankFusion.fuseChannels({ semantic: sem }, { k: -5 })).toThrow(
        /Invalid RRF constant k/,
      );
      expect(() => ReciprocalRankFusion.fuseChannels({ semantic: sem }, { k: NaN })).toThrow(
        /Invalid RRF constant k/,
      );
      expect(() => ReciprocalRankFusion.fuseChannels({ semantic: sem }, { k: Infinity })).toThrow(
        /Invalid RRF constant k/,
      );
    });

    it('22. rejects invalid channel weights with descriptive error', () => {
      const sem = [createMockResult('chk_1', 0.9)];
      expect(() =>
        ReciprocalRankFusion.fuseChannels({ semantic: sem }, { weights: { semantic: -1.0 } }),
      ).toThrow(/Invalid channel weight/);
      expect(() =>
        ReciprocalRankFusion.fuseChannels({ semantic: sem }, { weights: { keyword: NaN } }),
      ).toThrow(/Invalid channel weight/);
      // All weights zero
      expect(() =>
        ReciprocalRankFusion.fuseChannels(
          { semantic: sem },
          { weights: { semantic: 0, keyword: 0, graph: 0 } },
        ),
      ).toThrow(/at least one channel weight must be positive/);
    });

    it('23. rejects candidate with missing or invalid chunkId', () => {
      const invalidCandidate: any = {
        chunkId: '',
        documentId: 'doc_1',
        chunkIndex: 0,
        content: 'content',
      };

      expect(() => ReciprocalRankFusion.fuseChannels({ semantic: [invalidCandidate] })).toThrow(
        /chunkId must be a non-empty string/,
      );
    });

    it('24. rejects candidate with negative or non-integer chunkIndex', () => {
      const invalidCandidate: any = {
        chunkId: 'chk_1',
        documentId: 'doc_1',
        chunkIndex: -1,
        content: 'content',
      };

      expect(() => ReciprocalRankFusion.fuseChannels({ semantic: [invalidCandidate] })).toThrow(
        /chunkIndex must be a non-negative integer/,
      );

      const nonIntCandidate: any = {
        chunkId: 'chk_1',
        documentId: 'doc_1',
        chunkIndex: 1.5,
        content: 'content',
      };

      expect(() => ReciprocalRankFusion.fuseChannels({ semantic: [nonIntCandidate] })).toThrow(
        /chunkIndex must be a non-negative integer/,
      );
    });

    it('25. cleanly accepts and fuses channel with exactly 50 candidates (candidate count boundary)', () => {
      const candidates: NormalizedCandidate[] = [];
      for (let i = 0; i < 50; i++) {
        candidates.push({
          chunkId: `chk_${i.toString().padStart(3, '0')}`,
          documentId: 'doc_1',
          chunkIndex: i,
          content: `Content for chunk ${i}`,
        });
      }

      const fused = ReciprocalRankFusion.fuseChannels({ semantic: candidates }, { topK: 50 });
      expect(fused).toHaveLength(50);
      expect(fused[0].chunkId).toBe('chk_000');
      expect(fused[49].chunkId).toBe('chk_049');
      expect(fused[49].rank).toBe(50);
    });

    it('26. rejects channel exceeding maximum permitted candidate count (51 candidates)', () => {
      const candidates: NormalizedCandidate[] = [];
      for (let i = 0; i < 51; i++) {
        candidates.push({
          chunkId: `chk_${i.toString().padStart(3, '0')}`,
          documentId: 'doc_1',
          chunkIndex: i,
          content: `Content for chunk ${i}`,
        });
      }

      expect(() =>
        ReciprocalRankFusion.fuseChannels({ semantic: candidates }, { maxChannelCandidates: 50 }),
      ).toThrow(/candidate count \(51\) exceeds maximum allowed limit \(50\)/);
    });
  });

  // ==========================================
  // Category 5: Backward Compatibility
  // ==========================================
  describe('5. Backward Compatibility with Phase 3 Signatures', () => {
    it('supports legacy 2-way positional call: fuse(semantic, keyword, options)', () => {
      const semantic = [createMockResult('chk_1', 0.95), createMockResult('chk_2', 0.85)];
      const keyword = [createMockResult('chk_3', 5.0), createMockResult('chk_1', 4.0)];

      const fused = ReciprocalRankFusion.fuse(semantic, keyword, { k: 60, topK: 10 });

      expect(fused).toHaveLength(3);
      expect(fused[0].chunkId).toBe('chk_1');
      expect(fused[0].rank).toBe(1);
      expect(fused[0].retrievalSources).toContain('semantic');
      expect(fused[0].retrievalSources).toContain('keyword');
      expect(fused[0].rrfScore).toBeCloseTo(1 / 61 + 1 / 62, 5);
    });

    it('supports modern 3-way positional call: fuse(semantic, keyword, graph, options)', () => {
      const semantic = [createMockResult('chk_1', 0.95)];
      const keyword = [createMockResult('chk_2', 4.0)];
      const graph = [createMockGraphChunk('chk_3', 0.85)];

      const fused = ReciprocalRankFusion.fuse(semantic, keyword, graph, { topK: 5 });

      expect(fused).toHaveLength(3);
      const sources = fused.map((f) => f.retrievalSources[0]);
      expect(sources).toContain('semantic');
      expect(sources).toContain('keyword');
      expect(sources).toContain('graph');
    });
  });
});
