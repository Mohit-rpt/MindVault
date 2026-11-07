/**
 * MindVault — Knowledge Graph: Relation Resolver & Deduplicator
 *
 * Validates relation endpoints, rejects self-loops and hallucinated evidence,
 * normalizes relation types with synonym canonicalization, canonicalizes symmetric edges,
 * and executes deterministic relation deduplication and inverse-relation consolidation
 * while preserving multi-chunk supporting evidence.
 */

import type {
  IGraphRepository,
  GraphRelationRecord,
} from '../repositories/graph.repository.interface.js';
import { EntityNormalizer } from '../normalizers/entity.normalizer.js';
import type { ExtractedRelation } from '@mindvault/shared';

export interface ValidatedRelation {
  sourceEntityId: string;
  targetEntityId: string;
  relationType: string;
  description?: string;
  confidence: number;
  evidence: string;
}

/**
 * Inverse relation pairs mapping passive/subordinate forms to active/canonical forms.
 * When an inverse relation already exists in the graph, evidence is attached to the existing
 * canonical edge to avoid disconnected duplicate knowledge.
 */
export const INVERSE_RELATION_MAP: Readonly<Record<string, string>> = Object.freeze({
  PART_OF: 'CONTAINS',
  WORKS_FOR: 'EMPLOYS',
  OWNED_BY: 'OWNS',
  PRODUCED_BY: 'PRODUCES',
  STORED_IN: 'STORES',
});

/**
 * Strict evidence validator for provenance tracking.
 * - Applies Unicode NFKC decomposition/composition.
 * - Safely strips enclosing outer quotes ("...", '...', «...», “...”).
 * - Normalizes whitespace sequences (\s+, NBSP, zero-width spaces -> single space).
 * - Checks exact full normalized substring match.
 * - Allows explicitly defined trailing punctuation variations (. , ! ? ; :).
 * - Rejects partial-prefix matches and fabricated continuations without exception.
 */
export function validateEvidenceInChunk(
  rawEvidence?: string | null,
  rawChunk?: string | null,
): boolean {
  if (!rawEvidence || !rawChunk) return false;

  // 1. Unicode NFKC normalization
  let ev = rawEvidence.normalize('NFKC').trim();
  const chunk = rawChunk.normalize('NFKC').trim();

  // 2. Safe outer quote removal on evidence
  ev = ev.replace(/^["'`«»“”]+|["'`«»“”]+$/g, '').trim();
  if (ev.length < 3) return false;

  // 3. Lowercase & Whitespace normalization (\s+ -> single space)
  const normChunk = chunk.toLowerCase().replace(/[\s\u00A0\u200B\uFEFF]+/g, ' ');
  const normEv = ev.toLowerCase().replace(/[\s\u00A0\u200B\uFEFF]+/g, ' ');

  // 4. Exact full normalized substring match
  if (normChunk.includes(normEv)) {
    return true;
  }

  // 5. Allowed trailing punctuation variations (. , ! ? ; :)
  const evWithoutTrailingPunct = normEv.replace(/[.,!?;:]+$/, '').trim();
  if (evWithoutTrailingPunct.length >= 3) {
    if (normChunk.includes(evWithoutTrailingPunct)) {
      return true;
    }
  }

  // All partial prefix-only matches or fabricated continuations are rejected
  return false;
}

export class RelationResolver {
  constructor(private readonly graphRepo: IGraphRepository) {}

  /**
   * Validates and prepares an extracted relation against chunk-resolved entities.
   * Throws an error or returns null if the relation is invalid (e.g. self-loop, missing endpoint).
   */
  public validate(
    extracted: ExtractedRelation,
    entityMap: Map<string, string>, // Map of normalized entity name -> resolved entity ID
    chunkContent: string,
  ): ValidatedRelation | null {
    // 1. Resolve source and target entity IDs
    const normSource = EntityNormalizer.normalize(extracted.sourceEntity);
    const normTarget = EntityNormalizer.normalize(extracted.targetEntity);

    const sourceEntityId = entityMap.get(normSource);
    const targetEntityId = entityMap.get(normTarget);

    if (!sourceEntityId || !targetEntityId) {
      // Unresolved endpoint: drop hallucinated or unlinked relation
      return null;
    }

    // 2. Reject self-loops (source == target)
    if (sourceEntityId === targetEntityId) {
      return null;
    }

    // 3. Normalize relation type with synonym canonicalization
    const relationType = EntityNormalizer.normalizeRelationType(extracted.relationType);

    // 4. Canonicalize symmetric relation endpoints (e.g. CONNECTS_TO, SIMILAR_TO)
    // Order endpoints lexicographically so (A, CONNECTS_TO, B) and (B, CONNECTS_TO, A) map to the exact same relation
    let finalSourceId = sourceEntityId;
    let finalTargetId = targetEntityId;
    if (EntityNormalizer.SYMMETRIC_RELATIONS.has(relationType)) {
      if (sourceEntityId > targetEntityId) {
        finalSourceId = targetEntityId;
        finalTargetId = sourceEntityId;
      }
    }

    // 5. Validate confidence score bounds [0.0, 1.0]
    const confidence = Math.min(1.0, Math.max(0.0, extracted.confidence ?? 0.8));
    if (confidence < 0.5) {
      // Drop very low confidence relations
      return null;
    }

    // 6. Strict evidence validation: Ensure entire evidence sentence/clause is grounded in chunk
    const evidence = extracted.evidence?.trim();
    if (!evidence || !validateEvidenceInChunk(evidence, chunkContent)) {
      // Evidence not found or fabricated continuation: reject hallucinated evidence
      return null;
    }

    return {
      sourceEntityId: finalSourceId,
      targetEntityId: finalTargetId,
      relationType,
      description: extracted.description?.trim(),
      confidence,
      evidence,
    };
  }

  /**
   * Upserts the relation into the workspace graph and attaches supporting evidence.
   * Consolidates evidence into existing inverse relations when applicable.
   */
  public async resolveAndPersist(
    workspaceId: string,
    documentId: string,
    chunkId: string,
    validated: ValidatedRelation,
  ): Promise<{ relation: GraphRelationRecord; evidenceId: string }> {
    // 1. Check if an inverse relation already exists in the graph for this entity pair
    // e.g. If (Target, CONTAINS, Source) already exists, and we are adding (Source, PART_OF, Target)
    const inverseType = INVERSE_RELATION_MAP[validated.relationType];
    if (inverseType) {
      const existingInverse = await this.graphRepo.findRelationByEndpoints(
        workspaceId,
        validated.targetEntityId,
        validated.sourceEntityId,
        inverseType,
      );

      if (existingInverse) {
        // Attach evidence to the established canonical inverse relation
        const evidence = await this.graphRepo.createEvidenceIdempotent({
          workspaceId,
          relationId: existingInverse.id,
          chunkId,
          documentId,
          evidenceText: validated.evidence,
          confidence: validated.confidence,
        });

        const refreshed = await this.graphRepo.findRelationById(workspaceId, existingInverse.id);
        return { relation: refreshed || existingInverse, evidenceId: evidence.id };
      }
    }

    // 2. Upsert relation (maintains non-decreasing confidence, initial weight 1.0)
    const relation = await this.graphRepo.upsertRelation({
      workspaceId,
      sourceEntityId: validated.sourceEntityId,
      targetEntityId: validated.targetEntityId,
      relationType: validated.relationType,
      description: validated.description,
      weight: 1.0,
      confidence: validated.confidence,
    });

    // 3. Idempotently record supporting evidence for this relation
    // The database trigger automatically keeps weight = max(1, count(distinct chunkId))
    const evidence = await this.graphRepo.createEvidenceIdempotent({
      workspaceId,
      relationId: relation.id,
      chunkId,
      documentId,
      evidenceText: validated.evidence,
      confidence: validated.confidence,
    });

    // 4. Re-read the relation to return the trigger-synchronized authoritative weight
    const refreshed = await this.graphRepo.findRelationById(workspaceId, relation.id);

    return { relation: refreshed || relation, evidenceId: evidence.id };
  }
}
