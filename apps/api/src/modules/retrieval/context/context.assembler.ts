/**
 * MindVault — Retrieval Engine: Context Assembler & Citation Tracker
 *
 * Responsibilities:
 * - Assembles top-N retrieved chunks into a coherent context block for future RAG generation
 * - Strictly enforces configurable token budgets (default: 3000 tokens)
 * - Generates stable citation identifiers ([S1], [S2], etc.)
 * - Formats source attribution with exact page ranges, section headers, and document names
 * - Deduplicates chunks while maintaining strict relevance order
 * - Never fabricates missing metadata (honestly displays 'N/A' or omits missing pages)
 */

import type {
  ContextGraphRelationDto,
  ContextSourceItem,
  RawGraphRelationRow,
  SearchContextDto,
} from '@mindvault/shared';
import type { FusedCandidate } from '../fusion/rrf.fusion.js';

export interface ContextAssemblyOptions {
  maxTokens?: number;
}

/**
 * Exact UTF-16 code unit comparison (locale-independent).
 * Guarantees identical ordering across any OS, locale, or ICU environment.
 */
export function compareStringsCodePoint(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Numeric citation tag comparison: [S1] < [S2] < [S10].
 * Extracts integer digits for natural numerical sequence; falls back to code-point comparison.
 */
export function compareCitationTags(a: string, b: string): number {
  const numA = parseInt(a.replace(/\D/g, ''), 10) || 0;
  const numB = parseInt(b.replace(/\D/g, ''), 10) || 0;
  if (numA !== numB) return numA - numB;
  return compareStringsCodePoint(a, b);
}

/**
 * Four-tier deterministic relation ordering:
 * 1. Traversal depth ASC (direct 1-hop outranks 2-hop)
 * 2. Confidence DESC (higher confidence outranks lower)
 * 3. Weight DESC (more corroborated outranks less)
 * 4. Immutable relationId code-point ASC (absolute tie-breaker)
 */
export function compareCandidateRelations(a: RawGraphRelationRow, b: RawGraphRelationRow): number {
  // Tier 1: Traversal depth ASC (direct 1-hop outranks 2-hop)
  if (a.depth !== b.depth) return a.depth - b.depth;
  // Tier 2: Confidence DESC (higher confidence outranks lower)
  if (b.confidence !== a.confidence) return b.confidence - a.confidence;
  // Tier 3: Weight DESC (more corroborated outranks less)
  if (b.weight !== a.weight) return b.weight - a.weight;
  // Tier 4: Immutable relationId code-point ASC (absolute tie-breaker)
  return compareStringsCodePoint(a.relationId, b.relationId);
}

export class ContextAssembler {
  public static readonly DEFAULT_MAX_TOKENS = 3000;

  public static readonly compareStringsCodePoint = compareStringsCodePoint;
  public static readonly compareCitationTags = compareCitationTags;
  public static readonly compareCandidateRelations = compareCandidateRelations;

  /**
   * Formats a graph relation into an epistemic proposition citing supporting chunk sources.
   * Format: - RELATION: "<Source>" --[<TYPE>]--> "<Target>" (Confidence: <conf>, Depth: <depth>) [Supported by: <[S#], ...>]
   */
  public static formatGraphProposition(
    relation: RawGraphRelationRow,
    supportingCitationIds: string[],
  ): string {
    const sortedCitations = [...supportingCitationIds].sort(compareCitationTags);
    const citationsStr = sortedCitations.join(', ');
    const confidenceStr = relation.confidence.toFixed(2);
    return `- RELATION: "${relation.sourceCanonicalName}" --[${relation.relationType}]--> "${relation.targetCanonicalName}" (Confidence: ${confidenceStr}, Depth: ${relation.depth}) [Supported by: ${citationsStr}]`;
  }

  /**
   * Formats a page range or single page number honestly based on available metadata.
   */
  public static formatPageReference(
    pageStart?: number | null,
    pageEnd?: number | null,
  ): { pageNumber: number | null; pageRange: string | null } {
    if (pageStart !== null && pageStart !== undefined) {
      if (pageEnd !== null && pageEnd !== undefined && pageEnd > pageStart) {
        return {
          pageNumber: pageStart,
          pageRange: `pp. ${pageStart}-${pageEnd}`,
        };
      }
      return {
        pageNumber: pageStart,
        pageRange: `p. ${pageStart}`,
      };
    }

    return {
      pageNumber: null,
      pageRange: null,
    };
  }

  /**
   * Estimates token count for a text chunk using the MindVault heuristic.
   */
  public static estimateTokens(text: string): number {
    if (!text) return 0;
    const words = text.split(/\s+/).length;
    const chars = Math.ceil(text.length / 4);
    return Math.max(1, Math.round((words * 1.3 + chars) / 2));
  }

  /**
   * Assembles ranked chunks into a budgeted context block with citations and knowledge graph evidence.
   * Enforces a guaranteed 75% narrative allocation, a 25% hard graph ceiling, and dynamic backfill.
   */
  public static assemble(
    candidates: FusedCandidate[],
    options?: ContextAssemblyOptions,
  ): SearchContextDto {
    const maxTokens = options?.maxTokens || this.DEFAULT_MAX_TOKENS;
    const graphTokenCeiling = Math.floor(maxTokens * 0.25); // 25% hard ceiling
    const chunkTokenCeiling = Math.floor(maxTokens * 0.75); // 75% guaranteed allocation
    const MAX_GRAPH_RELATIONS = 15;
    const DELIMITER_OVERHEAD = 15; // Overhead for <knowledge_graph_evidence> tags

    // =========================================================================
    // STAGE 1: Collect All Candidate Relations & Merge Evidence Across Candidates
    // =========================================================================
    interface MergedRelationEntry {
      relation: RawGraphRelationRow;
      evidenceChunkIdsSet: Set<string>;
    }

    const allCandidateRelationsMap = new Map<string, MergedRelationEntry>();

    for (const candidate of candidates) {
      if (candidate.graphRelations) {
        for (const rel of candidate.graphRelations) {
          if (!rel?.relationId || typeof rel.relationId !== 'string') continue;
          const relId = rel.relationId.trim();
          if (!relId) continue;

          const existing = allCandidateRelationsMap.get(relId);
          if (!existing) {
            allCandidateRelationsMap.set(relId, {
              relation: { ...rel },
              evidenceChunkIdsSet: new Set(
                (rel.evidenceChunkIds || []).filter(
                  (id): id is string => typeof id === 'string' && id.trim().length > 0,
                ),
              ),
            });
          } else {
            // Incompatibility Guard
            if (
              existing.relation.sourceEntityId !== rel.sourceEntityId ||
              existing.relation.targetEntityId !== rel.targetEntityId ||
              existing.relation.relationType !== rel.relationType
            ) {
              console.warn(
                `[ContextAssembler] Conflicting metadata for relationId "${relId}". Preserving existing.`,
              );
              continue;
            }

            // Merge evidenceChunkIds without losing later candidates' evidence
            if (rel.evidenceChunkIds) {
              for (const chunkId of rel.evidenceChunkIds) {
                if (typeof chunkId === 'string' && chunkId.trim().length > 0) {
                  existing.evidenceChunkIdsSet.add(chunkId.trim());
                }
              }
            }

            // Deterministic metadata conflict resolution: min depth, max confidence, max weight
            existing.relation.depth = Math.min(existing.relation.depth, rel.depth);
            existing.relation.confidence = Math.max(existing.relation.confidence, rel.confidence);
            existing.relation.weight = Math.max(existing.relation.weight, rel.weight);
          }
        }
      }
    }

    // Finalize evidence arrays with locale-independent code-point sort
    const consolidatedRelations: RawGraphRelationRow[] = [];
    for (const entry of allCandidateRelationsMap.values()) {
      const rel = entry.relation;
      rel.evidenceChunkIds = Array.from(entry.evidenceChunkIdsSet).sort(compareStringsCodePoint);
      consolidatedRelations.push(rel);
    }

    // Sort candidate relations using four-tier deterministic ordering
    const sortedCandidateRelations = consolidatedRelations.sort(compareCandidateRelations);

    // Calculate theoretical maximum tokens needed by the candidate relation pool
    let maxPossibleGraphTokens = 0;
    for (let i = 0; i < Math.min(sortedCandidateRelations.length, MAX_GRAPH_RELATIONS); i++) {
      const rel = sortedCandidateRelations[i];
      // Conservative estimate: account for up to 3 citation tags in proposition
      const dummyCitations = rel.evidenceChunkIds.slice(0, 3).map((_, idx) => `[S${idx + 1}]`);
      const dummyFormatted = this.formatGraphProposition(
        rel,
        dummyCitations.length > 0 ? dummyCitations : ['[S1]'],
      );
      maxPossibleGraphTokens += this.estimateTokens(dummyFormatted);
    }
    if (sortedCandidateRelations.length > 0) {
      maxPossibleGraphTokens += DELIMITER_OVERHEAD;
    }
    const reservedGraphTokens = Math.min(graphTokenCeiling, maxPossibleGraphTokens);

    // =========================================================================
    // STAGE 2: Primary Narrative Selection (75% Guaranteed Allocation)
    // =========================================================================
    const seenChunkIds = new Set<string>();
    const sources: ContextSourceItem[] = [];
    const contextBlocks: string[] = [];
    let currentChunkTokens = 0;

    for (const candidate of candidates) {
      if (seenChunkIds.has(candidate.chunkId)) continue;

      const chunkTokens =
        candidate.tokenCount > 0 ? candidate.tokenCount : this.estimateTokens(candidate.content);
      const blockTokenEstimate = chunkTokens + 20;

      // Hard Total Limit: Reject chunk if it exceeds total budget
      if (currentChunkTokens + blockTokenEstimate > maxTokens) {
        if (sources.length === 0) continue; // Skip pathological oversized chunk
        break;
      }

      // 75% Allocation Boundary: Stop Stage 2 if adding chunk exceeds 75% ceiling
      if (currentChunkTokens + blockTokenEstimate > chunkTokenCeiling && sources.length > 0) {
        break;
      }

      seenChunkIds.add(candidate.chunkId);
      const citationId = `[S${sources.length + 1}]`;
      const { pageNumber, pageRange } = this.formatPageReference(
        candidate.pageStart,
        candidate.pageEnd,
      );
      const section =
        (candidate.metadata?.heading as string) || (candidate.metadata?.section as string) || null;

      sources.push({
        citationId,
        documentId: candidate.documentId,
        documentName: candidate.documentName,
        chunkId: candidate.chunkId,
        chunkIndex: candidate.chunkIndex,
        pageNumber,
        pageRange,
        section,
        content: candidate.content,
        rank: candidate.rank,
        score: candidate.rrfScore,
        retrievalSources: candidate.retrievalSources,
        ...(candidate.supportedRelationIds
          ? { supportedRelationIds: candidate.supportedRelationIds }
          : {}),
      });

      let header = `--- SOURCE ${citationId} | Document: ${candidate.documentName} (Chunk: ${candidate.chunkIndex + 1})`;
      if (pageRange) header += ` | Page: ${pageRange}`;
      if (section) header += ` | Section: "${section}"`;
      header += ` ---`;

      contextBlocks.push(`${header}\n${candidate.content}`);
      currentChunkTokens += blockTokenEstimate;
    }

    // =========================================================================
    // STAGE 3: Dynamic Backfill for Narrative Chunks
    // =========================================================================
    const budgetAvailableForBackfill = maxTokens - reservedGraphTokens - currentChunkTokens;
    if (budgetAvailableForBackfill > 50) {
      for (const candidate of candidates) {
        if (seenChunkIds.has(candidate.chunkId)) continue;

        const chunkTokens =
          candidate.tokenCount > 0 ? candidate.tokenCount : this.estimateTokens(candidate.content);
        const blockTokenEstimate = chunkTokens + 20;

        if (currentChunkTokens + reservedGraphTokens + blockTokenEstimate > maxTokens) {
          break; // Strict rank-order prefix preservation
        }

        seenChunkIds.add(candidate.chunkId);
        const citationId = `[S${sources.length + 1}]`;
        const { pageNumber, pageRange } = this.formatPageReference(
          candidate.pageStart,
          candidate.pageEnd,
        );
        const section =
          (candidate.metadata?.heading as string) ||
          (candidate.metadata?.section as string) ||
          null;

        sources.push({
          citationId,
          documentId: candidate.documentId,
          documentName: candidate.documentName,
          chunkId: candidate.chunkId,
          chunkIndex: candidate.chunkIndex,
          pageNumber,
          pageRange,
          section,
          content: candidate.content,
          rank: candidate.rank,
          score: candidate.rrfScore,
          retrievalSources: candidate.retrievalSources,
          ...(candidate.supportedRelationIds
            ? { supportedRelationIds: candidate.supportedRelationIds }
            : {}),
        });

        let header = `--- SOURCE ${citationId} | Document: ${candidate.documentName} (Chunk: ${candidate.chunkIndex + 1})`;
        if (pageRange) header += ` | Page: ${pageRange}`;
        if (section) header += ` | Section: "${section}"`;
        header += ` ---`;

        contextBlocks.push(`${header}\n${candidate.content}`);
        currentChunkTokens += blockTokenEstimate;
      }
    }

    // =========================================================================
    // STAGE 4: Freeze Final Narrative Sources & Build Authoritative Map
    // =========================================================================
    const chunkIdToCitationId = new Map<string, string>();
    for (const source of sources) {
      chunkIdToCitationId.set(source.chunkId, source.citationId);
    }

    // =========================================================================
    // STAGE 5: Evaluate Relation Eligibility Against Frozen Sources
    // =========================================================================
    const finalGraphRelations: ContextGraphRelationDto[] = [];
    const graphPropositionBlocks: string[] = [];
    let currentGraphTokens = 0;
    const effectiveGraphCeiling = Math.min(graphTokenCeiling, maxTokens - currentChunkTokens);

    for (const rel of sortedCandidateRelations) {
      if (finalGraphRelations.length >= MAX_GRAPH_RELATIONS) break;

      // Intersect evidenceChunkIds with authoritative frozen citation map
      const activeCitationIds = (rel.evidenceChunkIds || [])
        .map((id) => chunkIdToCitationId.get(id))
        .filter((tag): tag is string => Boolean(tag))
        .sort(compareCitationTags);

      // Fail-Closed Pruning: Discard if zero chunks survived (consumes 0 tokens)
      if (activeCitationIds.length === 0) continue;

      // Retain relation with surviving evidence chunks (Option B)
      const formatted = this.formatGraphProposition(rel, activeCitationIds);
      const propTokens = this.estimateTokens(formatted);
      const addedOverhead = graphPropositionBlocks.length === 0 ? DELIMITER_OVERHEAD : 0;

      if (currentGraphTokens + propTokens + addedOverhead > effectiveGraphCeiling) {
        continue; // Check if a subsequent shorter proposition fits deterministically
      }

      finalGraphRelations.push({
        relationId: rel.relationId,
        sourceCanonicalName: rel.sourceCanonicalName,
        targetCanonicalName: rel.targetCanonicalName,
        relationType: rel.relationType,
        confidence: rel.confidence,
        depth: rel.depth,
        supportingCitationIds: activeCitationIds,
        formattedProposition: formatted,
      });

      graphPropositionBlocks.push(formatted);
      currentGraphTokens += propTokens + addedOverhead;
    }

    // =========================================================================
    // STAGE 6: Context Block Assembly
    // =========================================================================
    let content = contextBlocks.join('\n\n');
    if (graphPropositionBlocks.length > 0) {
      content += `\n\n<knowledge_graph_evidence>\n${graphPropositionBlocks.join('\n')}\n</knowledge_graph_evidence>`;
    }

    return {
      content,
      tokenEstimate: currentChunkTokens + currentGraphTokens,
      sources,
      graphRelations: finalGraphRelations.length > 0 ? finalGraphRelations : undefined,
    };
  }
}
