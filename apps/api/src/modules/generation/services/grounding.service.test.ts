import { describe, it, expect } from 'vitest';
import { GroundingService } from './grounding.service.js';
import type { ContextSourceItem } from '@mindvault/shared';

describe('GroundingService', () => {
  const mockSources: ContextSourceItem[] = [
    {
      citationId: '[S1]',
      documentId: 'doc_1',
      documentName: 'ml.pdf',
      chunkId: 'chk_1',
      chunkIndex: 0,
      pageNumber: 1,
      pageRange: 'p. 1',
      section: null,
      content: 'Supervised learning definition.',
      rank: 1,
      score: 0.9,
      retrievalSources: ['semantic'],
    },
  ];

  it('should detect explicit insufficient evidence responses', () => {
    const text1 =
      'Based on the provided documents, there is insufficient evidence to answer your question.';
    const text2 = 'This topic is not mentioned in the provided documents.';

    expect(GroundingService.isInsufficientEvidenceResponse(text1)).toBe(true);
    expect(GroundingService.isInsufficientEvidenceResponse(text2)).toBe(true);
    expect(GroundingService.isInsufficientEvidenceResponse('Here is the factual answer.')).toBe(
      false,
    );
  });

  it('should return INSUFFICIENT_EVIDENCE status when model acknowledges missing evidence', () => {
    const text = 'There is insufficient evidence in the provided documents to answer the question.';
    const res = GroundingService.evaluateGrounding(text, mockSources);

    expect(res.groundingStatus).toBe('INSUFFICIENT_EVIDENCE');
  });

  it('should return INSUFFICIENT_EVIDENCE status when supplied sources list is empty', () => {
    const text = 'Here is an answer that had no sources.';
    const res = GroundingService.evaluateGrounding(text, []);

    expect(res.groundingStatus).toBe('INSUFFICIENT_EVIDENCE');
  });

  it('should return CITATION_INVALID status when unknown citation IDs are referenced', () => {
    const text = 'Supervised learning works by inference [S1], and another concept is [S99].';
    const res = GroundingService.evaluateGrounding(text, mockSources);

    expect(res.groundingStatus).toBe('CITATION_INVALID');
    expect(res.unknownCitationIds).toContain('[S99]');
  });

  it('should return GROUNDED status when valid citations support the answer', () => {
    const text = 'Supervised learning algorithms infer functions from labeled data [S1].';
    const res = GroundingService.evaluateGrounding(text, mockSources);

    expect(res.groundingStatus).toBe('GROUNDED');
    expect(res.citationIdsValid).toBe(true);
    expect(res.citationsPresent).toBe(true);
  });

  it('should return VALIDATION_UNAVAILABLE when answer is empty', () => {
    const res = GroundingService.evaluateGrounding('', mockSources);
    expect(res.groundingStatus).toBe('VALIDATION_UNAVAILABLE');
  });

  describe('Stage 1.3.2 Targeted Multi-Source Grounding Tests', () => {
    const fiveSources: ContextSourceItem[] = [
      {
        citationId: '[S1]',
        documentId: 'doc_1',
        documentName: 'architecture.pdf',
        chunkId: 'chk_1',
        chunkIndex: 0,
        pageNumber: 1,
        pageRange: 'p. 1',
        section: 'Architecture',
        content: 'Distributed sharding uses consistent hashing.',
        rank: 1,
        score: 0.95,
        retrievalSources: ['semantic'],
      },
      {
        citationId: '[S2]',
        documentId: 'doc_2',
        documentName: 'security.pdf',
        chunkId: 'chk_2',
        chunkIndex: 1,
        pageNumber: 2,
        pageRange: 'p. 2',
        section: 'Auth',
        content: 'JWT token TTL is 15 minutes.',
        rank: 2,
        score: 0.88,
        retrievalSources: ['semantic'],
      },
      {
        citationId: '[S3]',
        documentId: 'doc_3',
        documentName: 'database.md',
        chunkId: 'chk_3',
        chunkIndex: 0,
        pageNumber: 1,
        pageRange: 'p. 1',
        section: 'Database',
        content: 'Max connection pool size is 20.',
        rank: 3,
        score: 0.81,
        retrievalSources: ['keyword'],
      },
      {
        citationId: '[S4]',
        documentId: 'doc_4',
        documentName: 'cache.md',
        chunkId: 'chk_4',
        chunkIndex: 0,
        pageNumber: 1,
        pageRange: 'p. 1',
        section: 'Caching',
        content: 'Redis TTL is 3600 seconds.',
        rank: 4,
        score: 0.75,
        retrievalSources: ['keyword'],
      },
      {
        citationId: '[S5]',
        documentId: 'doc_5',
        documentName: 'gateway.md',
        chunkId: 'chk_5',
        chunkIndex: 0,
        pageNumber: 1,
        pageRange: 'p. 1',
        section: 'Gateway',
        content: 'SSE keep-alive ping interval is 15 seconds.',
        rank: 5,
        score: 0.69,
        retrievalSources: ['semantic'],
      },
    ];

    it('Scenario 1: should return GROUNDED when citing one relevant citation among five supplied sources', () => {
      const text = 'The maximum allowed database connection pool size is 20 [S3].';
      const res = GroundingService.evaluateGrounding(text, fiveSources);

      expect(res.groundingStatus).toBe('GROUNDED');
      expect(res.citationIdsValid).toBe(true);
      expect(res.referencedCitationIds).toEqual(['[S3]']);
    });

    it('Scenario 2: should return GROUNDED when citing two relevant citations among five supplied sources', () => {
      const text =
        'Distributed sharding uses consistent hashing [S1] and JWT token TTL is 15 minutes [S2].';
      const res = GroundingService.evaluateGrounding(text, fiveSources);

      expect(res.groundingStatus).toBe('GROUNDED');
      expect(res.citationIdsValid).toBe(true);
      expect(res.referencedCitationIds).toEqual(['[S1]', '[S2]']);
    });

    it('Scenario 3: should return GROUNDED when all five supplied sources are cited', () => {
      const text =
        'System overview: sharding [S1], auth [S2], database pool [S3], cache [S4], and gateway [S5].';
      const res = GroundingService.evaluateGrounding(text, fiveSources);

      expect(res.groundingStatus).toBe('GROUNDED');
      expect(res.citationIdsValid).toBe(true);
      expect(res.referencedCitationIds).toHaveLength(5);
    });

    it('Scenario 4: should return INSUFFICIENT_EVIDENCE when answer acknowledges lack of evidence despite partial citations', () => {
      const text =
        'The database pool is 20 [S3]. Based on the provided documents, there is insufficient evidence to determine the pricing tier.';
      const res = GroundingService.evaluateGrounding(text, fiveSources);

      expect(res.groundingStatus).toBe('INSUFFICIENT_EVIDENCE');
    });

    it('Scenario 5: should return PARTIALLY_GROUNDED when evidence is provided but no citations are referenced', () => {
      const text = 'The maximum connection pool size is 20 and JWT tokens expire after 15 minutes.';
      const res = GroundingService.evaluateGrounding(text, fiveSources);

      expect(res.groundingStatus).toBe('PARTIALLY_GROUNDED');
      expect(res.citationsPresent).toBe(false);
      expect(res.warnings[0]).toContain('contains no bracketed citation references');
    });

    it('Scenario 6: should return CITATION_INVALID when fabricated citation IDs are referenced', () => {
      const text = 'The database pool is 20 [S3] and enterprise discount is 50% [S99].';
      const res = GroundingService.evaluateGrounding(text, fiveSources);

      expect(res.groundingStatus).toBe('CITATION_INVALID');
      expect(res.citationIdsValid).toBe(false);
      expect(res.unknownCitationIds).toContain('[S99]');
    });

    it('Scenario 7: should return VALIDATION_UNAVAILABLE when answer is whitespace or empty', () => {
      const resWhitespace = GroundingService.evaluateGrounding('   \n\t  ', fiveSources);
      expect(resWhitespace.groundingStatus).toBe('VALIDATION_UNAVAILABLE');
    });

    it('Scenario 8: should return GROUNDED for multiple claims supported by different documents', () => {
      const text =
        'Consistent hashing shards storage [S1], and the SSE keep-alive interval is 15s [S5].';
      const res = GroundingService.evaluateGrounding(text, fiveSources);

      expect(res.groundingStatus).toBe('GROUNDED');
      expect(res.citationIdsValid).toBe(true);
      expect(res.referencedCitationIds).toEqual(['[S1]', '[S5]']);
    });
  });
});
