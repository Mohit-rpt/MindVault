/**
 * MindVault — Knowledge Graph: Extraction Pipeline Service
 *
 * Orchestrates LLM extraction, schema validation, entity resolution,
 * mention recording, relation deduplication, and evidence attachment.
 */

import { prisma } from '../../../lib/prisma.js';
import type { IGraphRepository } from '../repositories/graph.repository.interface.js';
import { graphRepository } from '../repositories/graph.repository.js';
import type { IKnowledgeExtractionProvider } from '../providers/extraction-provider.interface.js';
import { createExtractionProvider } from '../providers/provider.factory.js';
import { EntityNormalizer } from '../normalizers/entity.normalizer.js';
import { EntityResolver } from '../resolvers/entity.resolver.js';
import { RelationResolver } from '../resolvers/relation.resolver.js';
import {
  KnowledgeExtractionResponseSchema,
  type ChunkExtractionResult,
  type DocumentGraphExtractionResult,
  type ExtractionValidationFailures,
} from '@mindvault/shared';

function sanitizeErrorMessage(msg?: string): string {
  if (!msg) return '';
  return msg
    .replace(/bearer\s+[a-zA-Z0-9_\-.]+/gi, 'Bearer [REDACTED]')
    .replace(/(?:password|secret|key|token)=[^&\s]+/gi, '$1=[REDACTED]');
}

export interface GraphExtractionServiceOptions {
  graphRepo?: IGraphRepository;
  provider?: IKnowledgeExtractionProvider;
}

export class GraphExtractionService {
  private readonly graphRepo: IGraphRepository;
  private readonly provider: IKnowledgeExtractionProvider;
  private readonly entityResolver: EntityResolver;
  private readonly relationResolver: RelationResolver;

  constructor(options?: GraphExtractionServiceOptions) {
    this.graphRepo = options?.graphRepo || graphRepository;
    this.provider = options?.provider || createExtractionProvider();
    this.entityResolver = new EntityResolver(this.graphRepo);
    this.relationResolver = new RelationResolver(this.graphRepo);
  }

  /**
   * Processes a single document chunk through the full extraction pipeline.
   */
  public async extractFromChunk(
    workspaceId: string,
    documentId: string,
    chunkId: string,
    content: string,
    context?: { documentTitle?: string; sectionHeading?: string; pageNumber?: number },
  ): Promise<ChunkExtractionResult> {
    const startTime = performance.now();

    // 1. Invoke LLM Extraction Provider
    const rawExtraction = await this.provider.extract(content, {
      ...context,
      workspaceId,
    });

    // 2. Validate Structured Output Schema
    const validatedSchema = KnowledgeExtractionResponseSchema.parse(rawExtraction);

    let entitiesResolved = 0;
    let mentionsCreated = 0;
    let relationsPersisted = 0;
    let evidenceCreated = 0;

    // Map to hold normalized entity name -> resolved entity ID for relation resolution
    const entityIdMap = new Map<string, string>();

    // 3. Resolve Entities & Persist Mentions
    for (const extractedEntity of validatedSchema.entities) {
      const normalizedName = EntityNormalizer.normalize(extractedEntity.name);
      if (!normalizedName) continue;

      try {
        const resolution = await this.entityResolver.resolve(workspaceId, extractedEntity);
        entitiesResolved++;
        entityIdMap.set(normalizedName, resolution.entity.id);
        entityIdMap.set(resolution.entity.normalizedName, resolution.entity.id);

        // Map any aliases as well
        if (extractedEntity.aliases) {
          for (const alias of extractedEntity.aliases) {
            const normAlias = EntityNormalizer.normalize(alias);
            if (normAlias) {
              entityIdMap.set(normAlias, resolution.entity.id);
            }
          }
        }

        // Calculate start/end offset if mention text occurs directly in chunk content
        let startOffset: number | undefined;
        let endOffset: number | undefined;
        const mentionIdx = content.toLowerCase().indexOf(extractedEntity.name.toLowerCase());
        if (mentionIdx >= 0) {
          startOffset = mentionIdx;
          endOffset = mentionIdx + extractedEntity.name.length;
        }

        // 4. Idempotently persist entity mention
        await this.graphRepo.createMentionIdempotent({
          workspaceId,
          chunkId,
          entityId: resolution.entity.id,
          mentionText: extractedEntity.name.slice(0, 255),
          startOffset,
          endOffset,
          confidence: extractedEntity.confidence,
        });
        mentionsCreated++;
      } catch (err: any) {
        console.warn(
          `[GraphExtractionService] Failed to resolve entity "${extractedEntity.name}":`,
          sanitizeErrorMessage(err?.message || 'Unknown error'),
        );
      }
    }

    const validationFailures: ExtractionValidationFailures = {
      unresolvedEndpoints: 0,
      selfLoops: 0,
      unsupportedRelationType: 0,
      lowConfidence: 0,
      invalidEvidence: 0,
    };

    // 5. Validate & Persist Relations with Evidence
    for (const extractedRelation of validatedSchema.relations) {
      const valResult = this.relationResolver.validateWithDetails(
        extractedRelation,
        entityIdMap,
        content,
      );

      if (!valResult.isValid || !valResult.validated) {
        if (valResult.failureReason === 'UNRESOLVED_ENDPOINT')
          validationFailures.unresolvedEndpoints++;
        else if (valResult.failureReason === 'SELF_LOOP') validationFailures.selfLoops++;
        else if (valResult.failureReason === 'UNSUPPORTED_RELATION_TYPE')
          validationFailures.unsupportedRelationType++;
        else if (valResult.failureReason === 'LOW_CONFIDENCE') validationFailures.lowConfidence++;
        else if (valResult.failureReason === 'INVALID_EVIDENCE')
          validationFailures.invalidEvidence++;
        continue;
      }

      const validatedRelation = valResult.validated;

      try {
        const { evidenceId } = await this.relationResolver.resolveAndPersist(
          workspaceId,
          documentId,
          chunkId,
          validatedRelation,
        );
        relationsPersisted++;
        if (evidenceId) {
          evidenceCreated++;
        }
      } catch (err: any) {
        console.warn(
          `[GraphExtractionService] Failed to persist relation:`,
          sanitizeErrorMessage(err?.message || 'Unknown error'),
        );
      }
    }

    const durationMs = Math.round(performance.now() - startTime);

    return {
      chunkId,
      documentId,
      workspaceId,
      entitiesExtracted: validatedSchema.entities.length,
      entitiesResolved,
      mentionsCreated,
      relationsExtracted: validatedSchema.relations.length,
      relationsPersisted,
      evidenceCreated,
      durationMs,
      diagnostics: {
        provider: this.provider.providerName,
        model: (this.provider as any).modelName,
        validationFailures,
      },
    };
  }

  /**
   * Processes all eligible chunks of a document for graph extraction.
   */
  public async extractDocument(
    workspaceId: string,
    documentId: string,
    _forceReextract = false,
  ): Promise<DocumentGraphExtractionResult> {
    const startTime = performance.now();

    // 1. Fetch document and ensure strict tenant ownership
    const document = await prisma.document.findUnique({
      where: {
        workspaceId_id: {
          workspaceId,
          id: documentId,
        },
      },
      include: {
        chunks: {
          orderBy: { chunkIndex: 'asc' },
        },
      },
    });

    if (!document) {
      throw new Error(`Document ${documentId} not found in workspace ${workspaceId}`);
    }

    const totalChunks = document.chunks.length;
    let processedChunks = 0;
    let totalEntities = 0;
    let totalRelations = 0;
    let totalEvidence = 0;
    const errors: string[] = [];
    const aggregatedFailures: ExtractionValidationFailures = {
      unresolvedEndpoints: 0,
      selfLoops: 0,
      unsupportedRelationType: 0,
      lowConfidence: 0,
      invalidEvidence: 0,
    };

    // 2. Process chunks
    for (const chunk of document.chunks) {
      try {
        const result = await this.extractFromChunk(
          workspaceId,
          documentId,
          chunk.id,
          chunk.content,
          {
            documentTitle: document.originalName,
            sectionHeading: (chunk.metadata as any)?.heading || undefined,
            pageNumber: chunk.pageStart || undefined,
          },
        );

        processedChunks++;
        totalEntities += result.entitiesResolved;
        totalRelations += result.relationsPersisted;
        totalEvidence += result.evidenceCreated;

        if (result.diagnostics?.validationFailures) {
          aggregatedFailures.unresolvedEndpoints +=
            result.diagnostics.validationFailures.unresolvedEndpoints;
          aggregatedFailures.selfLoops += result.diagnostics.validationFailures.selfLoops;
          aggregatedFailures.unsupportedRelationType +=
            result.diagnostics.validationFailures.unsupportedRelationType;
          aggregatedFailures.lowConfidence += result.diagnostics.validationFailures.lowConfidence;
          aggregatedFailures.invalidEvidence +=
            result.diagnostics.validationFailures.invalidEvidence;
        }
      } catch (err: any) {
        errors.push(
          `Chunk ${chunk.id}: ${sanitizeErrorMessage(err?.message || 'Processing error')}`,
        );
      }
    }

    const durationMs = Math.round(performance.now() - startTime);
    const status = errors.length === 0 ? 'COMPLETED' : processedChunks > 0 ? 'PARTIAL' : 'FAILED';

    // 3. Update document metadata with graph extraction status
    const currentMetadata = (document.metadata as Record<string, unknown>) || {};
    await prisma.document.update({
      where: {
        workspaceId_id: {
          workspaceId,
          id: documentId,
        },
      },
      data: {
        metadata: {
          ...currentMetadata,
          graphStatus: status,
          graphExtractedAt: new Date().toISOString(),
          graphEntitiesCount: totalEntities,
          graphRelationsCount: totalRelations,
          graphErrors: errors.length > 0 ? errors : undefined,
        },
      },
    });

    return {
      documentId,
      workspaceId,
      totalChunks,
      processedChunks,
      totalEntities,
      totalRelations,
      totalEvidence,
      status,
      durationMs,
      errors: errors.length > 0 ? errors : undefined,
      diagnostics: {
        provider: this.provider.providerName,
        model: (this.provider as any).modelName,
        totalValidationFailures: aggregatedFailures,
      },
    };
  }
}

export const graphExtractionService = new GraphExtractionService();
