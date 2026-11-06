/**
 * MindVault — Generation Engine: Grounding & Evidence Validation Service
 *
 * Evaluates answer grounding status against retrieved evidence and citation integrity.
 */

import type {
  ContextSourceItem,
  GroundingStatus,
  GroundingValidationResult,
} from '@mindvault/shared';
import { CitationValidatorService } from './citation-validator.service.js';

export class GroundingService {
  private static readonly INSUFFICIENT_EVIDENCE_PHRASES = [
    'insufficient evidence',
    'not mentioned in the provided',
    'provided documents do not contain',
    'does not contain sufficient information',
    'no evidence available',
    'cannot find information',
    'not found in the uploaded',
    'information is not provided in',
  ];

  /**
   * Assesses whether the answer explicitly acknowledges insufficient evidence.
   */
  public static isInsufficientEvidenceResponse(answerText: string): boolean {
    const lower = answerText.toLowerCase();
    return this.INSUFFICIENT_EVIDENCE_PHRASES.some((phrase) => lower.includes(phrase));
  }

  /**
   * Evaluates the grounding status of an answer given the retrieved sources.
   */
  public static evaluateGrounding(
    answerText: string,
    suppliedSources: ContextSourceItem[],
  ): GroundingValidationResult {
    if (!answerText || !answerText.trim()) {
      return {
        groundingStatus: 'VALIDATION_UNAVAILABLE',
        citationIdsValid: false,
        unknownCitationIds: [],
        citationsPresent: false,
        referencedCitationIds: [],
        warnings: ['Answer text is empty; grounding could not be evaluated.'],
      };
    }

    const citationResult = CitationValidatorService.validate(answerText, suppliedSources);
    const acknowledgesLackOfEvidence = this.isInsufficientEvidenceResponse(answerText);

    let status: GroundingStatus;

    if (acknowledgesLackOfEvidence || suppliedSources.length === 0) {
      status = 'INSUFFICIENT_EVIDENCE';
    } else if (!citationResult.citationIdsValid) {
      status = 'CITATION_INVALID';
    } else if (citationResult.citationsPresent && citationResult.citationIdsValid) {
      // Check if partially grounded (e.g. citations present, but fewer than supplied or partial warning)
      if (
        citationResult.validCitationIds.length < suppliedSources.length &&
        suppliedSources.length > 3
      ) {
        status = 'PARTIALLY_GROUNDED';
      } else {
        status = 'GROUNDED';
      }
    } else {
      // Evidence was supplied but no citations were included
      status = 'PARTIALLY_GROUNDED';
    }

    return {
      groundingStatus: status,
      citationIdsValid: citationResult.citationIdsValid,
      unknownCitationIds: citationResult.unknownCitationIds,
      citationsPresent: citationResult.citationsPresent,
      referencedCitationIds: citationResult.referencedCitationIds,
      warnings: citationResult.warnings,
    };
  }
}
