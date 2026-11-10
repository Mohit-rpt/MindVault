import { describe, it, expect } from 'vitest';
import { ContextAssembler } from '../context/context.assembler.js';
import type { FusedCandidate } from '../fusion/rrf.fusion.js';
import type { RawGraphRelationRow } from '@mindvault/shared';

function createCandidate(
  chunkId: string,
  content: string,
  tokenCount: number,
  options?: {
    graphRelations?: RawGraphRelationRow[];
    supportedRelationIds?: string[];
    rank?: number;
    score?: number;
    pageStart?: number;
    pageEnd?: number;
    heading?: string;
  },
): FusedCandidate {
  return {
    chunkId,
    documentId: 'doc_1',
    documentName: 'Report.pdf',
    documentExtension: 'pdf',
    content,
    chunkIndex: options?.rank ? options.rank - 1 : 0,
    tokenCount,
    pageStart: options?.pageStart ?? null,
    pageEnd: options?.pageEnd ?? null,
    metadata: options?.heading ? { heading: options.heading } : {},
    retrievalSources:
      options?.graphRelations && options.graphRelations.length > 0 ? ['graph'] : ['semantic'],
    rrfScore: options?.score ?? 0.05,
    rank: options?.rank ?? 1,
    graphRelations: options?.graphRelations,
    supportedRelationIds: options?.supportedRelationIds,
  };
}

function createRelation(
  relationId: string,
  source: string,
  type: string,
  target: string,
  evidenceChunkIds: string[],
  options?: {
    confidence?: number;
    depth?: number;
    weight?: number;
  },
): RawGraphRelationRow {
  return {
    relationId,
    sourceEntityId: `ent_${source.toLowerCase().replace(/\s+/g, '_')}`,
    sourceCanonicalName: source,
    targetEntityId: `ent_${target.toLowerCase().replace(/\s+/g, '_')}`,
    targetCanonicalName: target,
    relationType: type,
    confidence: options?.confidence ?? 0.95,
    depth: options?.depth ?? 1,
    weight: options?.weight ?? 1.0,
    evidenceChunkIds,
  };
}

describe('ContextAssembler Graph Evidence & Dual Budgeting (Subtask 6.6.3.2)', () => {
  // Scenario 1: Supported ONLY by Stage 3 Backfilled Chunk
  it('Scenario 1: should recognize and format relation supported ONLY by Stage 3 backfilled chunk', () => {
    // maxTokens: 400. Stage 2 ceiling: 300 (75%). Graph ceiling: 100 (25%).
    // Chunk A is ~220 tokens (with header ~240). Fits in Stage 2 (<= 300).
    // Chunk B is ~60 tokens (with header ~80). Exceeds Stage 2 ceiling (240 + 80 = 320 > 300).
    // Reserved graph tokens for Rel 1 is ~30 tokens.
    // Budget available for Stage 3 backfill: 400 - 30 - 240 = 130 > 50.
    // Chunk B enters via Stage 3 backfill as [S2]!
    const rel1 = createRelation('rel_1', 'Alice', 'MANAGES', 'Bob', ['chk_b']);
    const chunkA = createCandidate(
      'chk_a',
      'Chunk A primary content about organization structure.',
      220,
      {
        rank: 1,
        graphRelations: [rel1],
      },
    );
    const chunkB = createCandidate('chk_b', 'Chunk B backfilled content about operations.', 60, {
      rank: 2,
      graphRelations: [rel1],
    });

    const assembled = ContextAssembler.assemble([chunkA, chunkB], { maxTokens: 400 });

    expect(assembled.sources.map((s) => s.chunkId)).toEqual(['chk_a', 'chk_b']);
    expect(assembled.sources[0].citationId).toBe('[S1]');
    expect(assembled.sources[1].citationId).toBe('[S2]');
    expect(assembled.graphRelations).toBeDefined();
    expect(assembled.graphRelations).toHaveLength(1);
    expect(assembled.graphRelations![0].relationId).toBe('rel_1');
    expect(assembled.graphRelations![0].supportingCitationIds).toEqual(['[S2]']);
    expect(assembled.graphRelations![0].formattedProposition).toContain('[Supported by: [S2]]');
    expect(assembled.content).toContain('<knowledge_graph_evidence>');
    expect(assembled.content).toContain('[Supported by: [S2]]');
  });

  // Scenario 2: Supported by BOTH Stage 1 and Stage 3 Chunks
  it('Scenario 2: should format proposition citing BOTH Stage 1 and Stage 3 chunks in numeric order', () => {
    const rel2 = createRelation('rel_2', 'Acme Corp', 'SUBSIDIARY_OF', 'MegaCorp', [
      'chk_a',
      'chk_b',
    ]);
    const chunkA = createCandidate('chk_a', 'Chunk A content.', 220, {
      rank: 1,
      graphRelations: [rel2],
    });
    const chunkB = createCandidate('chk_b', 'Chunk B content.', 60, {
      rank: 2,
      graphRelations: [rel2],
    });

    const assembled = ContextAssembler.assemble([chunkA, chunkB], { maxTokens: 400 });

    expect(assembled.sources.map((s) => s.chunkId)).toEqual(['chk_a', 'chk_b']);
    expect(assembled.graphRelations).toBeDefined();
    expect(assembled.graphRelations![0].supportingCitationIds).toEqual(['[S1]', '[S2]']);
    expect(assembled.graphRelations![0].formattedProposition).toContain(
      '[Supported by: [S1], [S2]]',
    );
  });

  // Scenario 3: Zero Survival (Fail-Closed Pruning)
  it('Scenario 3: should 100% prune relation when zero supporting chunks survive (fail-closed)', () => {
    // Rel 3 is supported only by 'chk_z' which is not in the candidate pool or budget dropped
    const rel3 = createRelation('rel_3', 'Acme', 'OWNS', 'Beta', ['chk_z']);
    const chunkA = createCandidate('chk_a', 'Chunk A content.', 100, {
      rank: 1,
      graphRelations: [rel3],
    });

    const assembled = ContextAssembler.assemble([chunkA], { maxTokens: 400 });

    expect(assembled.sources.map((s) => s.chunkId)).toEqual(['chk_a']);
    expect(assembled.graphRelations).toBeUndefined();
    expect(assembled.content).not.toContain('<knowledge_graph_evidence>');
  });

  // Scenario 4 & 5: Budget Initially Filled by Pruned Relations -> Subsequent Eligible Relation Fills Budget
  it('Scenario 4 & 5: should prune non-surviving top relations and allow subsequent eligible relations to fill budget', () => {
    // Top relations relA and relB have high confidence (0.99, 0.98) but evidence chunk 'chk_dropped' is absent.
    // Subsequent relation relC has lower confidence (0.80) but its evidence chunk 'chk_a' is present.
    const relA = createRelation('rel_a', 'EntA', 'LINK', 'EntB', ['chk_dropped'], {
      confidence: 0.99,
    });
    const relB = createRelation('rel_b', 'EntC', 'LINK', 'EntD', ['chk_dropped'], {
      confidence: 0.98,
    });
    const relC = createRelation('rel_c', 'Alpha', 'PRODUCES', 'Beta', ['chk_a'], {
      confidence: 0.8,
    });

    const chunkA = createCandidate('chk_a', 'Chunk A content.', 100, {
      rank: 1,
      graphRelations: [relA, relB, relC],
    });

    const assembled = ContextAssembler.assemble([chunkA], { maxTokens: 400 });

    expect(assembled.sources.map((s) => s.chunkId)).toEqual(['chk_a']);
    expect(assembled.graphRelations).toBeDefined();
    expect(assembled.graphRelations).toHaveLength(1);
    expect(assembled.graphRelations![0].relationId).toBe('rel_c');
    expect(assembled.graphRelations![0].supportingCitationIds).toEqual(['[S1]']);
  });

  // Scenario 6: Duplicate Relation Evidence Aggregation Across Candidates
  it('Scenario 6: should merge evidenceChunkIds across multiple candidates carrying the same relation', () => {
    // Candidate 1 carries Rel 1 with evidenceChunkIds ['chk_a']
    // Candidate 2 carries Rel 1 with evidenceChunkIds ['chk_b']
    const relCandidate1 = createRelation('rel_1', 'Alice', 'MANAGES', 'Bob', ['chk_a']);
    const relCandidate2 = createRelation('rel_1', 'Alice', 'MANAGES', 'Bob', ['chk_b']);

    const chunkA = createCandidate('chk_a', 'Chunk A mentions management.', 80, {
      rank: 1,
      graphRelations: [relCandidate1],
    });
    const chunkB = createCandidate('chk_b', 'Chunk B also mentions management.', 80, {
      rank: 2,
      graphRelations: [relCandidate2],
    });

    const assembled = ContextAssembler.assemble([chunkA, chunkB], { maxTokens: 400 });

    expect(assembled.graphRelations).toBeDefined();
    expect(assembled.graphRelations).toHaveLength(1);
    expect(assembled.graphRelations![0].supportingCitationIds).toEqual(['[S1]', '[S2]']);
    expect(assembled.graphRelations![0].formattedProposition).toContain(
      '[Supported by: [S1], [S2]]',
    );
  });

  // Scenario 7: Duplicate Evidence Chunk IDs Deduplication
  it('Scenario 7: should deduplicate identical evidenceChunkIds across candidates', () => {
    const rel1 = createRelation('rel_1', 'Alice', 'MANAGES', 'Bob', ['chk_a']);
    const rel2 = createRelation('rel_1', 'Alice', 'MANAGES', 'Bob', ['chk_a']); // Same chunkId

    const chunkA = createCandidate('chk_a', 'Chunk A content.', 80, {
      rank: 1,
      graphRelations: [rel1, rel2],
    });

    const assembled = ContextAssembler.assemble([chunkA], { maxTokens: 400 });

    expect(assembled.graphRelations).toBeDefined();
    expect(assembled.graphRelations![0].supportingCitationIds).toEqual(['[S1]']);
  });

  // Scenario 8: Conflicting Relation Metadata Resolution
  it('Scenario 8: should deterministically resolve metadata conflicts (min depth, max confidence, max weight)', () => {
    const relCandidate1 = createRelation('rel_1', 'Alice', 'MANAGES', 'Bob', ['chk_a'], {
      depth: 2,
      confidence: 0.8,
      weight: 3.0,
    });
    const relCandidate2 = createRelation('rel_1', 'Alice', 'MANAGES', 'Bob', ['chk_a'], {
      depth: 1,
      confidence: 0.95,
      weight: 8.0,
    });

    const chunkA = createCandidate('chk_a', 'Chunk A content.', 80, {
      rank: 1,
      graphRelations: [relCandidate1, relCandidate2],
    });

    const assembled = ContextAssembler.assemble([chunkA], { maxTokens: 400 });

    expect(assembled.graphRelations).toBeDefined();
    expect(assembled.graphRelations![0].depth).toBe(1); // min(2, 1)
    expect(assembled.graphRelations![0].confidence).toBe(0.95); // max(0.80, 0.95)
  });

  // Scenario 9: Single Oversized First Chunk (> 75% allocation)
  it('Scenario 9: should accept single oversized first chunk exceeding 75% ceiling if it fits within maxTokens', () => {
    // maxTokens: 3000. 75% ceiling: 2250.
    // Chunk 1 has 2400 tokens (> 2250, but <= 3000). Accepted to prevent empty context!
    // Remaining budget is reserved for graph evidence (rel_1), so chunk 2 (600 tokens) cannot fit.
    const rel = createRelation('rel_1', 'BigCorp', 'OWNS', 'SmallCo', ['chk_big']);
    const chunkOversized = createCandidate('chk_big', 'Oversized primary content', 2400, {
      rank: 1,
      graphRelations: [rel],
    });
    const chunk2 = createCandidate('chk_2', 'Second chunk', 600, { rank: 2 });

    const assembled = ContextAssembler.assemble([chunkOversized, chunk2], { maxTokens: 3000 });

    expect(assembled.sources).toHaveLength(1);
    expect(assembled.sources[0].chunkId).toBe('chk_big');
    expect(assembled.tokenEstimate).toBeLessThanOrEqual(3000);
    expect(assembled.graphRelations).toBeDefined();
    expect(assembled.graphRelations![0].relationId).toBe('rel_1');
  });

  // Scenario 10: Oversized Chunk Exceeding Total Budget (> maxTokens)
  it('Scenario 10: should skip oversized chunk exceeding total maxTokens defensively', () => {
    // maxTokens: 3000. Chunk 1 is 3500 tokens (> 3000).
    // Chunk 2 is 200 tokens (fits).
    const chunkPathological = createCandidate('chk_huge', 'Huge content', 3500, { rank: 1 });
    const chunkNormal = createCandidate('chk_normal', 'Normal content', 200, { rank: 2 });

    const assembled = ContextAssembler.assemble([chunkPathological, chunkNormal], {
      maxTokens: 3000,
    });

    expect(assembled.sources).toHaveLength(1);
    expect(assembled.sources[0].chunkId).toBe('chk_normal');
  });

  // Scenario 11: Strict Prefix Order Preservation (No Knapsack Cherry-Picking)
  it('Scenario 11: should enforce strict rank-order prefix termination without knapsack skipping', () => {
    // Candidate 1 (100 tokens), Candidate 2 (400 tokens - exceeds remaining 100), Candidate 3 (20 tokens - would fit)
    const chunk1 = createCandidate('chk_1', 'Chunk 1', 100, { rank: 1 });
    const chunk2 = createCandidate('chk_2', 'Chunk 2 exceeds', 400, { rank: 2 });
    const chunk3 = createCandidate('chk_3', 'Chunk 3 small', 20, { rank: 3 });

    const assembled = ContextAssembler.assemble([chunk1, chunk2, chunk3], { maxTokens: 250 });

    expect(assembled.sources.map((s) => s.chunkId)).toEqual(['chk_1']);
    // chunk3 was NOT cherry-picked!
    expect(assembled.sources.map((s) => s.chunkId)).not.toContain('chk_3');
  });

  // Scenario 12: Locale-Independent Numeric Citation Sorting
  it('Scenario 12: should sort multi-digit citations numerically in proposition', () => {
    const chunkIds = Array.from({ length: 11 }, (_, i) => `chk_${i + 1}`);
    const rel = createRelation('rel_multi', 'Org', 'CONNECTS', 'Node', [
      'chk_10',
      'chk_2',
      'chk_1',
    ]);

    const candidates = chunkIds.map((id, idx) =>
      createCandidate(id, `Content for ${id}`, 20, { rank: idx + 1, graphRelations: [rel] }),
    );

    const assembled = ContextAssembler.assemble(candidates, { maxTokens: 2000 });

    expect(assembled.graphRelations).toBeDefined();
    expect(assembled.graphRelations![0].supportingCitationIds).toEqual(['[S1]', '[S2]', '[S10]']);
    expect(assembled.graphRelations![0].formattedProposition).toContain(
      '[Supported by: [S1], [S2], [S10]]',
    );
  });

  // Scenario 13: Deterministic Output Across Repeated Runs
  it('Scenario 13: should produce identical byte-for-byte output across repeated runs with identical candidates', () => {
    const rel = createRelation('rel_1', 'Alpha', 'LINK', 'Beta', ['chk_1']);
    const candidates = [
      createCandidate('chk_1', 'Content 1', 50, { rank: 1, graphRelations: [rel] }),
      createCandidate('chk_2', 'Content 2', 50, { rank: 2, graphRelations: [rel] }),
    ];

    const run1 = ContextAssembler.assemble(candidates, { maxTokens: 500 });
    for (let i = 0; i < 20; i++) {
      const runN = ContextAssembler.assemble(candidates, { maxTokens: 500 });
      expect(runN.content).toBe(run1.content);
      expect(runN.tokenEstimate).toBe(run1.tokenEstimate);
      expect(runN.sources).toEqual(run1.sources);
    }
  });

  // Scenario 14: Total Context Budget Invariant
  it('Scenario 14: should strictly enforce tokenEstimate <= maxTokens across various budget sizes', () => {
    const rel = createRelation('rel_1', 'Alpha', 'LINK', 'Beta', ['chk_1']);
    const candidates = [
      createCandidate('chk_1', 'First content', 80, { rank: 1, graphRelations: [rel] }),
      createCandidate('chk_2', 'Second content', 150, { rank: 2, graphRelations: [rel] }),
      createCandidate('chk_3', 'Third content', 200, { rank: 3, graphRelations: [rel] }),
    ];

    for (const budget of [100, 250, 500, 1500, 3000, 16000]) {
      const assembled = ContextAssembler.assemble(candidates, { maxTokens: budget });
      expect(assembled.tokenEstimate).toBeLessThanOrEqual(budget);
    }
  });

  // Scenario 15: Partial Multi-Chunk Survival (Option B)
  it('Scenario 15: should retain relation and cite only surviving chunk when one supporting chunk is dropped', () => {
    // Rel has evidenceChunkIds: ['chk_survives', 'chk_dropped']
    const rel = createRelation('rel_b', 'Alice', 'OWNS', 'Acme', ['chk_survives', 'chk_dropped']);

    // Candidate 1 fits in budget; Candidate 2 exceeds budget
    const chunkSurvives = createCandidate('chk_survives', 'Surviving content.', 80, {
      rank: 1,
      graphRelations: [rel],
    });
    const chunkDropped = createCandidate('chk_dropped', 'Dropped content exceeding budget.', 500, {
      rank: 2,
      graphRelations: [rel],
    });

    const assembled = ContextAssembler.assemble([chunkSurvives, chunkDropped], { maxTokens: 250 });

    expect(assembled.sources.map((s) => s.chunkId)).toEqual(['chk_survives']);
    expect(assembled.graphRelations).toBeDefined();
    expect(assembled.graphRelations).toHaveLength(1);
    expect(assembled.graphRelations![0].supportingCitationIds).toEqual(['[S1]']);
    expect(assembled.graphRelations![0].formattedProposition).toContain('[Supported by: [S1]]');
    expect(assembled.graphRelations![0].formattedProposition).not.toContain('[S2]');
  });

  // Scenario 16: Primary Narrative Underfills
  it('Scenario 16: should strictly cap graph ceiling at 25% even when primary chunks consume very few tokens', () => {
    // maxTokens: 1000. 25% ceiling = 250 tokens.
    // Primary chunks consume only 50 tokens.
    // Many relations are candidate. Graph relations must NOT consume more than 250 tokens!
    const rels: RawGraphRelationRow[] = Array.from({ length: 15 }, (_, i) =>
      createRelation(
        `rel_${i}`,
        `SourceEntity${i}`,
        'CONNECTED_TO',
        `TargetEntity${i}`,
        ['chk_1'],
        {
          confidence: 0.9 - i * 0.01,
        },
      ),
    );

    const chunk1 = createCandidate('chk_1', 'Short content.', 50, {
      rank: 1,
      graphRelations: rels,
    });

    const assembled = ContextAssembler.assemble([chunk1], { maxTokens: 1000 });

    expect(assembled.sources).toHaveLength(1);
    expect(assembled.graphRelations).toBeDefined();
    // Verify graph propositions didn't exceed 250 tokens
    const graphTokens = assembled.tokenEstimate - (50 + 20);
    expect(graphTokens).toBeLessThanOrEqual(250);
  });

  // Scenario 17: Empty Graph Retrieval
  it('Scenario 17: should assemble text chunks cleanly without graph tags when candidates carry 0 relations', () => {
    const chunk1 = createCandidate('chk_1', 'Text only content.', 100, { rank: 1 });
    const chunk2 = createCandidate('chk_2', 'Second text chunk.', 100, { rank: 2 });

    const assembled = ContextAssembler.assemble([chunk1, chunk2], { maxTokens: 500 });

    expect(assembled.sources).toHaveLength(2);
    expect(assembled.graphRelations).toBeUndefined();
    expect(assembled.content).not.toContain('<knowledge_graph_evidence>');
  });

  // Scenario 18: Graph Channel Failure (Fail-Soft)
  it('Scenario 18: should assemble surviving semantic and keyword candidates without errors when graph failed', () => {
    const chunkSemantic = createCandidate('chk_sem', 'Semantic candidate.', 80, { rank: 1 });
    chunkSemantic.retrievalSources = ['semantic'];
    const chunkKeyword = createCandidate('chk_kw', 'Keyword candidate.', 80, { rank: 2 });
    chunkKeyword.retrievalSources = ['keyword'];

    const assembled = ContextAssembler.assemble([chunkSemantic, chunkKeyword], { maxTokens: 500 });

    expect(assembled.sources).toHaveLength(2);
    expect(assembled.sources[0].retrievalSources).toEqual(['semantic']);
    expect(assembled.sources[1].retrievalSources).toEqual(['keyword']);
    expect(assembled.graphRelations).toBeUndefined();
    expect(assembled.content).not.toContain('<knowledge_graph_evidence>');
  });
});
