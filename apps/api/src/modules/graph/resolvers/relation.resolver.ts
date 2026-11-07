/**
 * MindVault — Knowledge Graph: Relation Resolver & Deduplicator
 *
 * Validates relation endpoints, rejects self-loops and hallucinated evidence,
 * normalizes relation types, and executes deterministic relation deduplication
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

    // 3. Normalize relation type
    const relationType = EntityNormalizer.normalizeRelationType(extracted.relationType);

    // 4. Validate confidence score bounds [0.0, 1.0]
    const confidence = Math.min(1.0, Math.max(0.0, extracted.confidence ?? 0.8));
    if (confidence < 0.5) {
      // Drop very low confidence relations
      return null;
    }

    // 5. Evidence validation: Ensure evidence is present and non-empty
    const evidence = extracted.evidence?.trim();
    if (!evidence || evidence.length < 3) {
      return null;
    }

    // Verify evidence text appears in the chunk (case-insensitive substring check)
    const normChunk = chunkContent.toLowerCase().replace(/\s+/g, ' ');
    const normEv = evidence.toLowerCase().replace(/\s+/g, ' ');
    if (!normChunk.includes(normEv)) {
      // If full evidence sentence doesn't match verbatim, check if a significant 20-char substring matches
      const sub = normEv.slice(0, Math.min(normEv.length, 30));
      if (!normChunk.includes(sub)) {
        // Evidence not found in chunk: reject hallucinated evidence
        return null;
      }
    }

    return {
      sourceEntityId,
      targetEntityId,
      relationType,
      description: extracted.description?.trim(),
      confidence,
      evidence,
    };
  }

  /**
   * Upserts the relation into the workspace graph and attaches supporting evidence.
   */
  public async resolveAndPersist(
    workspaceId: string,
    documentId: string,
    chunkId: string,
    validated: ValidatedRelation,
  ): Promise<{ relation: GraphRelationRecord; evidenceId: string }> {
    // 1. Upsert relation (increments weight, updates confidence)
    const relation = await this.graphRepo.upsertRelation({
      workspaceId,
      sourceEntityId: validated.sourceEntityId,
      targetEntityId: validated.targetEntityId,
      relationType: validated.relationType,
      description: validated.description,
      weight: 1.0,
      confidence: validated.confidence,
    });

    // 2. Idempotently record supporting evidence for this relation
    const evidence = await this.graphRepo.createEvidenceIdempotent({
      workspaceId,
      relationId: relation.id,
      chunkId,
      documentId,
      evidenceText: validated.evidence,
      confidence: validated.confidence,
    });

    return { relation, evidenceId: evidence.id };
  }
}
