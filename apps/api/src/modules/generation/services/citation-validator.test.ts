import { describe, it, expect } from 'vitest';
import { CitationValidatorService } from './citation-validator.service.js';
import type { ContextSourceItem } from '@mindvault/shared';

describe('CitationValidatorService', () => {
  const mockSources: ContextSourceItem[] = [
    {
      citationId: '[S1]',
      documentId: 'doc_1',
      documentName: 'ml.pdf',
      chunkId: 'chk_1',
      chunkIndex: 0,
      pageNumber: 1,
      pageRange: 'p. 1',
      section: 'Intro',
      content: 'Supervised learning definition.',
      rank: 1,
      score: 0.9,
      retrievalSources: ['semantic'],
    },
    {
      citationId: '[S2]',
      documentId: 'doc_2',
      documentName: 'db.md',
      chunkId: 'chk_2',
      chunkIndex: 1,
      pageNumber: 5,
      pageRange: 'p. 5',
      section: 'Indexing',
      content: 'HNSW indexing.',
      rank: 2,
      score: 0.85,
      retrievalSources: ['keyword'],
    },
  ];

  it('should extract citation IDs in order of appearance', () => {
    const text = 'Here is fact one [S2] followed by fact two [S1] and another reference to [S2].';
    const ids = CitationValidatorService.extractCitationIds(text);
    expect(ids).toEqual(['[S2]', '[S1]']);
  });

  it('should validate answer containing valid citations', () => {
    const text = 'Supervised learning infers functions [S1] while HNSW accelerates vectors [S2].';
    const res = CitationValidatorService.validate(text, mockSources);

    expect(res.citationIdsValid).toBe(true);
    expect(res.citationsPresent).toBe(true);
    expect(res.validCitationIds).toEqual(['[S1]', '[S2]']);
    expect(res.unknownCitationIds).toEqual([]);
    expect(res.warnings).toHaveLength(0);
  });

  it('should flag unknown fabricated citation IDs', () => {
    const text = 'This claim was invented from [S99] and another from [S1].';
    const res = CitationValidatorService.validate(text, mockSources);

    expect(res.citationIdsValid).toBe(false);
    expect(res.citationsPresent).toBe(true);
    expect(res.validCitationIds).toEqual(['[S1]']);
    expect(res.unknownCitationIds).toEqual(['[S99]']);
    expect(res.warnings[0]).toContain('unknown citation(s): [S99]');
  });

  it('should warn when no citations are present despite evidence supplied', () => {
    const text = 'This answer provides factual claims without citing any source.';
    const res = CitationValidatorService.validate(text, mockSources);

    expect(res.citationsPresent).toBe(false);
    expect(res.citationIdsValid).toBe(true);
    expect(res.warnings[0]).toContain('contains no bracketed citation references');
  });

  it('should filter sources to only those cited in the answer', () => {
    const text = 'Only source one is cited [S1].';
    const filtered = CitationValidatorService.filterCitedSources(text, mockSources);

    expect(filtered).toHaveLength(1);
    expect(filtered[0].citationId).toBe('[S1]');
    expect(filtered[0].documentName).toBe('ml.pdf');
  });
});
