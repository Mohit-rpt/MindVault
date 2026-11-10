import { describe, it, expect } from 'vitest';
import {
  ContextAssembler,
  compareStringsCodePoint,
  compareCitationTags,
  compareCandidateRelations,
} from './context.assembler.js';
import type { FusedCandidate } from '../fusion/rrf.fusion.js';
import type { RawGraphRelationRow } from '@mindvault/shared';

function createMockCandidate(
  chunkId: string,
  content: string,
  tokenCount: number,
  pageStart?: number | null,
  pageEnd?: number | null,
  heading?: string,
): FusedCandidate {
  return {
    chunkId,
    documentId: 'doc_101',
    documentName: 'DeepLearningBook.pdf',
    documentExtension: 'pdf',
    content,
    chunkIndex: 0,
    tokenCount,
    pageStart: pageStart ?? null,
    pageEnd: pageEnd ?? null,
    metadata: heading ? { heading } : {},
    retrievalSources: ['semantic'],
    rrfScore: 0.032,
    rank: 1,
  };
}

describe('ContextAssembler', () => {
  it('should format page reference accurately for single and range pages', () => {
    expect(ContextAssembler.formatPageReference(5, 5)).toEqual({
      pageNumber: 5,
      pageRange: 'p. 5',
    });
    expect(ContextAssembler.formatPageReference(10, 14)).toEqual({
      pageNumber: 10,
      pageRange: 'pp. 10-14',
    });
    expect(ContextAssembler.formatPageReference(null, null)).toEqual({
      pageNumber: null,
      pageRange: null,
    });
  });

  it('should assemble sources with sequential citation IDs [S1], [S2]', () => {
    const candidates = [
      createMockCandidate('c1', 'First paragraph about backpropagation.', 50, 12, 12, 'Backprop'),
      createMockCandidate(
        'c2',
        'Second paragraph about gradient descent.',
        60,
        14,
        15,
        'Optimization',
      ),
    ];

    const assembled = ContextAssembler.assemble(candidates, { maxTokens: 2000 });

    expect(assembled.sources.length).toBe(2);
    expect(assembled.sources[0].citationId).toBe('[S1]');
    expect(assembled.sources[0].section).toBe('Backprop');
    expect(assembled.sources[0].pageRange).toBe('p. 12');

    expect(assembled.sources[1].citationId).toBe('[S2]');
    expect(assembled.sources[1].section).toBe('Optimization');
    expect(assembled.sources[1].pageRange).toBe('pp. 14-15');

    expect(assembled.content).toContain('--- SOURCE [S1]');
    expect(assembled.content).toContain('--- SOURCE [S2]');
  });

  it('should strictly respect token budget constraints', () => {
    const candidates = [
      createMockCandidate('c1', 'Short content 1', 100),
      createMockCandidate('c2', 'Short content 2', 100),
      createMockCandidate('c3', 'Short content 3 that would exceed budget', 200),
    ];

    // Budget of 250 tokens: c1 (~120 tokens with header) + c2 (~120 tokens with header) fits, c3 exceeds
    const assembled = ContextAssembler.assemble(candidates, { maxTokens: 250 });

    expect(assembled.sources.length).toBe(2);
    expect(assembled.sources.map((s) => s.chunkId)).toEqual(['c1', 'c2']);
    expect(assembled.tokenEstimate).toBeLessThanOrEqual(250);
  });

  it('should deduplicate chunks if duplicate chunk IDs are passed', () => {
    const candidates = [
      createMockCandidate('dup_chunk', 'Identical content', 40),
      createMockCandidate('dup_chunk', 'Identical content', 40),
      createMockCandidate('other_chunk', 'Different content', 40),
    ];

    const assembled = ContextAssembler.assemble(candidates);
    expect(assembled.sources.length).toBe(2);
    expect(assembled.sources[0].chunkId).toBe('dup_chunk');
    expect(assembled.sources[1].chunkId).toBe('other_chunk');
  });

  it('should forward supportedRelationIds on ContextSourceItem when present on candidate', () => {
    const candidate = createMockCandidate('c_rel', 'Chunk with graph relation provenance', 50);
    candidate.supportedRelationIds = ['rel_alpha', 'rel_beta'];

    const assembled = ContextAssembler.assemble([candidate]);
    expect(assembled.sources.length).toBe(1);
    expect(assembled.sources[0].supportedRelationIds).toEqual(['rel_alpha', 'rel_beta']);
  });
});

describe('Subtask 6.6.3.1 — Locale-Independent Sorters & Proposition Formatter', () => {
  describe('compareStringsCodePoint', () => {
    it('should correctly order ASCII strings by UTF-16 code units', () => {
      expect(compareStringsCodePoint('apple', 'banana')).toBe(-1);
      expect(compareStringsCodePoint('banana', 'apple')).toBe(1);
      expect(compareStringsCodePoint('same', 'same')).toBe(0);
      expect(compareStringsCodePoint('Alpha', 'alpha')).toBe(-1); // 'A' (65) < 'a' (97)
    });

    it('should maintain strict code-point ordering independent of host locale', () => {
      // In Swedish/German collation, 'ä' (U+00E4) may be sorted before 'z' or at the end.
      // But in pure UTF-16 code unit comparison: 'z' is 122, 'ä' is 228.
      // Therefore 'z' < 'ä' strictly in code-point order.
      expect('z'.charCodeAt(0)).toBeLessThan('ä'.charCodeAt(0));
      expect(compareStringsCodePoint('z', 'ä')).toBe(-1);
      expect(compareStringsCodePoint('ä', 'z')).toBe(1);

      // Verify static reference on ContextAssembler
      expect(ContextAssembler.compareStringsCodePoint('a', 'b')).toBe(-1);
    });

    it('should deterministically sort string arrays', () => {
      const unsorted = ['delta', 'alpha', 'charlie', 'beta', 'Alpha'];
      const sorted = [...unsorted].sort(compareStringsCodePoint);
      expect(sorted).toEqual(['Alpha', 'alpha', 'beta', 'charlie', 'delta']);
    });
  });

  describe('compareCitationTags', () => {
    it('should numerically order single-digit and multi-digit citation tags', () => {
      expect(compareCitationTags('[S1]', '[S2]')).toBeLessThan(0);
      expect(compareCitationTags('[S2]', '[S10]')).toBeLessThan(0);
      expect(compareCitationTags('[S9]', '[S10]')).toBeLessThan(0);
      expect(compareCitationTags('[S10]', '[S20]')).toBeLessThan(0);
      expect(compareCitationTags('[S20]', '[S100]')).toBeLessThan(0);
    });

    it('should correctly sort mixed multi-digit citation tags in numerical sequence', () => {
      const unsorted = ['[S10]', '[S2]', '[S100]', '[S1]', '[S20]', '[S3]'];
      const sorted = [...unsorted].sort(compareCitationTags);
      expect(sorted).toEqual(['[S1]', '[S2]', '[S3]', '[S10]', '[S20]', '[S100]']);
    });

    it('should fall back to code-point comparison for identical numbers with suffixes or non-numeric tags', () => {
      expect(compareCitationTags('[S1_a]', '[S1_b]')).toBe(-1);
      expect(compareCitationTags('[S1_b]', '[S1_a]')).toBe(1);
      expect(compareCitationTags('[S1_a]', '[S1_a]')).toBe(0);
      expect(compareCitationTags('SourceA', 'SourceB')).toBe(-1);
    });

    it('should work identically through ContextAssembler static alias', () => {
      const tags = ['[S10]', '[S2]'];
      expect(tags.sort(ContextAssembler.compareCitationTags)).toEqual(['[S2]', '[S10]']);
    });
  });

  describe('compareCandidateRelations', () => {
    const baseRelation: RawGraphRelationRow = {
      relationId: 'rel_base',
      sourceEntityId: 'e1',
      sourceCanonicalName: 'Alpha',
      targetEntityId: 'e2',
      targetCanonicalName: 'Beta',
      relationType: 'ASSOCIATED_WITH',
      weight: 1.0,
      confidence: 0.9,
      depth: 1,
      evidenceChunkIds: ['chk_1'],
    };

    it('should prioritize Tier 1: depth ASC (direct 1-hop outranks 2-hop)', () => {
      const rel1 = { ...baseRelation, depth: 1, confidence: 0.5 };
      const rel2 = { ...baseRelation, depth: 2, confidence: 0.99 };
      // rel1 should come first even though rel2 has higher confidence
      expect(compareCandidateRelations(rel1, rel2)).toBeLessThan(0);
      expect(compareCandidateRelations(rel2, rel1)).toBeGreaterThan(0);
    });

    it('should prioritize Tier 2: confidence DESC when depths are equal', () => {
      const rel1 = { ...baseRelation, depth: 1, confidence: 0.95, weight: 1.0 };
      const rel2 = { ...baseRelation, depth: 1, confidence: 0.8, weight: 10.0 };
      // rel1 should come first even though rel2 has higher weight
      expect(compareCandidateRelations(rel1, rel2)).toBeLessThan(0);
      expect(compareCandidateRelations(rel2, rel1)).toBeGreaterThan(0);
    });

    it('should prioritize Tier 3: weight DESC when depths and confidences are equal', () => {
      const rel1 = { ...baseRelation, depth: 1, confidence: 0.9, weight: 8.0, relationId: 'z_rel' };
      const rel2 = { ...baseRelation, depth: 1, confidence: 0.9, weight: 2.0, relationId: 'a_rel' };
      // rel1 should come first even though rel2 has smaller relationId
      expect(compareCandidateRelations(rel1, rel2)).toBeLessThan(0);
      expect(compareCandidateRelations(rel2, rel1)).toBeGreaterThan(0);
    });

    it('should prioritize Tier 4: relationId ASC code-point as absolute tie-breaker', () => {
      const rel1 = {
        ...baseRelation,
        depth: 1,
        confidence: 0.9,
        weight: 5.0,
        relationId: 'rel_001',
      };
      const rel2 = {
        ...baseRelation,
        depth: 1,
        confidence: 0.9,
        weight: 5.0,
        relationId: 'rel_002',
      };
      expect(compareCandidateRelations(rel1, rel2)).toBeLessThan(0);
      expect(compareCandidateRelations(rel2, rel1)).toBeGreaterThan(0);
      expect(compareCandidateRelations(rel1, rel1)).toBe(0);
    });

    it('should deterministically sort a collection of heterogeneous relations', () => {
      const relations: RawGraphRelationRow[] = [
        { ...baseRelation, relationId: 'rel_depth2', depth: 2, confidence: 0.99, weight: 10 },
        {
          ...baseRelation,
          relationId: 'rel_depth1_low_conf',
          depth: 1,
          confidence: 0.6,
          weight: 10,
        },
        {
          ...baseRelation,
          relationId: 'rel_depth1_high_conf_low_wt',
          depth: 1,
          confidence: 0.95,
          weight: 1,
        },
        { ...baseRelation, relationId: 'rel_b', depth: 1, confidence: 0.95, weight: 5 },
        { ...baseRelation, relationId: 'rel_a', depth: 1, confidence: 0.95, weight: 5 },
      ];

      const sorted = [...relations].sort(compareCandidateRelations);
      const sortedIds = sorted.map((r) => r.relationId);

      expect(sortedIds).toEqual([
        'rel_a', // depth 1, conf 0.95, weight 5, id 'rel_a'
        'rel_b', // depth 1, conf 0.95, weight 5, id 'rel_b'
        'rel_depth1_high_conf_low_wt', // depth 1, conf 0.95, weight 1
        'rel_depth1_low_conf', // depth 1, conf 0.60, weight 10
        'rel_depth2', // depth 2, conf 0.99, weight 10
      ]);

      // Verify static alias on ContextAssembler
      expect(
        [...relations].sort(ContextAssembler.compareCandidateRelations).map((r) => r.relationId),
      ).toEqual(sortedIds);
    });
  });

  describe('formatGraphProposition', () => {
    const relation: RawGraphRelationRow = {
      relationId: 'rel_123',
      sourceEntityId: 'e_apple',
      sourceCanonicalName: 'Apple Inc.',
      targetEntityId: 'e_tim',
      targetCanonicalName: 'Tim Cook',
      relationType: 'CEO_OF',
      weight: 1.0,
      confidence: 0.987,
      depth: 1,
      evidenceChunkIds: ['chk_1', 'chk_2'],
    };

    it('should format proposition with single citation identifier', () => {
      const proposition = ContextAssembler.formatGraphProposition(relation, ['[S1]']);
      expect(proposition).toBe(
        '- RELATION: "Apple Inc." --[CEO_OF]--> "Tim Cook" (Confidence: 0.99, Depth: 1) [Supported by: [S1]]',
      );
    });

    it('should sort supporting citation IDs numerically even if passed unsorted', () => {
      const unsortedCitations = ['[S10]', '[S2]', '[S1]', '[S20]'];
      const proposition = ContextAssembler.formatGraphProposition(relation, unsortedCitations);
      expect(proposition).toBe(
        '- RELATION: "Apple Inc." --[CEO_OF]--> "Tim Cook" (Confidence: 0.99, Depth: 1) [Supported by: [S1], [S2], [S10], [S20]]',
      );
      // Ensure input array was not mutated
      expect(unsortedCitations).toEqual(['[S10]', '[S2]', '[S1]', '[S20]']);
    });

    it('should format confidence to exactly two decimal places', () => {
      const rel1 = { ...relation, confidence: 0.9 };
      const rel2 = { ...relation, confidence: 1 };
      const rel3 = { ...relation, confidence: 0.754 };

      expect(ContextAssembler.formatGraphProposition(rel1, ['[S1]'])).toContain('Confidence: 0.90');
      expect(ContextAssembler.formatGraphProposition(rel2, ['[S1]'])).toContain('Confidence: 1.00');
      expect(ContextAssembler.formatGraphProposition(rel3, ['[S1]'])).toContain('Confidence: 0.75');
    });
  });
});
