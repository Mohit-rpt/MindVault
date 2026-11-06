import { describe, it, expect } from 'vitest';
import { ContextAssembler } from './context.assembler.js';
import type { FusedCandidate } from '../fusion/rrf.fusion.js';

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
});
