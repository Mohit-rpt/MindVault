/**
 * MindVault — Generation Engine: Citation Validation Subsystem
 *
 * Scans generated answers for citation tags ([S1], [S2], etc.), verifies them
 * against authoritative retrieval sources, and detects unknown/fabricated citations.
 */

import type { ContextSourceItem } from '@mindvault/shared';

export interface CitationValidationDetails {
  referencedCitationIds: string[];
  validCitationIds: string[];
  unknownCitationIds: string[];
  citationsPresent: boolean;
  citationIdsValid: boolean;
  warnings: string[];
}

export class CitationValidatorService {
  private static readonly CITATION_REGEX = /\[S(\d+)\]/g;

  /**
   * Extracts all unique citation identifiers (e.g. ['[S1]', '[S2]']) from text in order of appearance.
   */
  public static extractCitationIds(text: string): string[] {
    if (!text) return [];
    const matches = text.match(this.CITATION_REGEX) || [];
    return Array.from(new Set(matches));
  }

  /**
   * Validates referenced citations against supplied sources.
   */
  public static validate(
    answerText: string,
    suppliedSources: ContextSourceItem[],
  ): CitationValidationDetails {
    const referencedIds = this.extractCitationIds(answerText);
    const suppliedIdSet = new Set(suppliedSources.map((s) => s.citationId));

    const validCitationIds: string[] = [];
    const unknownCitationIds: string[] = [];
    const warnings: string[] = [];

    for (const id of referencedIds) {
      if (suppliedIdSet.has(id)) {
        validCitationIds.push(id);
      } else {
        unknownCitationIds.push(id);
      }
    }

    const citationsPresent = referencedIds.length > 0;
    const citationIdsValid = unknownCitationIds.length === 0;

    if (unknownCitationIds.length > 0) {
      warnings.push(
        `Generated answer referenced ${unknownCitationIds.length} unknown citation(s): ${unknownCitationIds.join(', ')}`,
      );
    }

    if (!citationsPresent && suppliedSources.length > 0) {
      warnings.push(
        'Answer contains no bracketed citation references despite retrieved evidence being provided.',
      );
    }

    return {
      referencedCitationIds: referencedIds,
      validCitationIds,
      unknownCitationIds,
      citationsPresent,
      citationIdsValid,
      warnings,
    };
  }

  /**
   * Filters the supplied sources to only those that were actually cited in the answer.
   */
  public static filterCitedSources(
    answerText: string,
    suppliedSources: ContextSourceItem[],
  ): ContextSourceItem[] {
    const referencedSet = new Set(this.extractCitationIds(answerText));
    return suppliedSources.filter((s) => referencedSet.has(s.citationId));
  }
}
