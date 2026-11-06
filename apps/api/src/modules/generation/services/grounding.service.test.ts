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
});
