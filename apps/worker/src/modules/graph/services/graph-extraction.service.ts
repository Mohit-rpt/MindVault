/**
 * MindVault — Knowledge Graph: Extraction Pipeline Service
 *
 * Orchestrates LLM extraction, schema validation, entity resolution,
 * mention recording, relation deduplication, and evidence attachment.
 */

import { prisma } from '../../../lib/prisma.js';
import { Prisma } from '@prisma/client';
import type { IGraphRepository } from '../repositories/graph.repository.interface.js';
import { GraphRepository, graphRepository } from '../repositories/graph.repository.js';
import type { IKnowledgeExtractionProvider } from '../providers/extraction-provider.interface.js';
import { createExtractionProvider } from '../providers/provider.factory.js';
import { EntityNormalizer } from '../normalizers/entity.normalizer.js';
import { EntityResolver } from '../resolvers/entity.resolver.js';
import { RelationResolver } from '../resolvers/relation.resolver.js';
import { ExtractionFencedError } from '../errors/extraction-fenced.error.js';
import { computeRelationLockKey, sortRelationsByLockKey } from '../utils/advisory-lock.util.js';
import {
  KnowledgeExtractionResponseSchema,
  type KnowledgeExtractionResponse,
  type ChunkExtractionResult,
  type DocumentGraphExtractionResult,
  type ExtractionValidationFailures,
  type GraphChunkCheckpoint,
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

export interface PersistChunkExtractionInput {
  workspaceId: string;
  documentId: string;
  chunkId: string;
  chunkIndex: number;
  totalChunks: number;
  content: string;
  extractionRunId: string;
  workerToken: string;
  expectedLeaseGeneration?: bigint | number;
  chunkManifestHash: string;
  rawExtraction: KnowledgeExtractionResponse;
  previousCheckpoint?: GraphChunkCheckpoint;
}

export interface PersistChunkExtractionResult {
  updatedCheckpoint: GraphChunkCheckpoint;
  entitiesExtracted: number;
  entitiesResolved: number;
  mentionsCreated: number;
  relationsExtracted: number;
  relationsPersisted: number;
  evidenceCreated: number;
  diagnostics?: {
    validationFailures: ExtractionValidationFailures;
  };
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
   * Invokes LLM extraction and validates schema strictly OUTSIDE database transactions.
   * Zero database locks are held during model inference or network requests.
   */
  public async extractRaw(
    content: string,
    context?: {
      documentTitle?: string;
      sectionHeading?: string;
      pageNumber?: number;
      abortSignal?: AbortSignal;
      workspaceId?: string;
    },
  ): Promise<KnowledgeExtractionResponse> {
    const rawExtraction = await this.provider.extract(
      content,
      context
        ? {
            ...context,
            workspaceId: context.workspaceId || '',
          }
        : undefined,
    );
    return KnowledgeExtractionResponseSchema.parse(rawExtraction);
  }

  /**
   * Persists extracted entities, mentions, relations, evidence, and advances chunk checkpoint
   * within a single atomic database transaction under document row locking (FOR NO KEY UPDATE)
   * and deterministic 64-bit relation advisory locks in ascending numerical order.
   *
   * Executes strict pre-commit lease validation: if worker is stale, superseded, or expired,
   * rolls back the transaction completely with ExtractionFencedError.
   */
  public async persistChunkExtraction(
    tx: Prisma.TransactionClient,
    input: PersistChunkExtractionInput,
  ): Promise<PersistChunkExtractionResult> {
    // 1. Tier 1 Document Row Lock: Lock document row in NO KEY UPDATE mode
    const lockedRows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id
      FROM "documents"
      WHERE id = ${input.documentId} AND "workspaceId" = ${input.workspaceId}
      FOR NO KEY UPDATE;
    `;

    if (!lockedRows || lockedRows.length === 0) {
      throw new ExtractionFencedError(
        `Document not found: ${input.documentId} in workspace ${input.workspaceId}`,
      );
    }

    // 2. Separate Lease & Ownership Read under fresh snapshot after acquiring row lock
    const docRows = await tx.$queryRaw<
      Array<{
        id: string;
        metadata: any;
        extractionRunId: string | null;
        graphWorkerToken: string | null;
        graphLeaseGeneration: string | null;
        graphLeaseExpiresAt: string | null;
        graphStatus: string | null;
        graphFinalizationReceipt: any;
        isLeaseValid: boolean;
      }>
    >`
      SELECT
        id,
        metadata,
        metadata->>'extractionRunId' AS "extractionRunId",
        metadata->>'graphWorkerToken' AS "graphWorkerToken",
        metadata->>'graphLeaseGeneration' AS "graphLeaseGeneration",
        metadata->>'graphLeaseExpiresAt' AS "graphLeaseExpiresAt",
        metadata->>'graphStatus' AS "graphStatus",
        metadata->'graphFinalizationReceipt' AS "graphFinalizationReceipt",
        ((metadata->>'graphLeaseExpiresAt')::timestamptz > clock_timestamp()) AS "isLeaseValid"
      FROM "documents"
      WHERE id = ${input.documentId} AND "workspaceId" = ${input.workspaceId};
    `;

    const doc = docRows[0];
    if (!doc) {
      throw new ExtractionFencedError(`Document snapshot failed: ${input.documentId}`);
    }

    // 3. Fencing checks
    if (doc.extractionRunId !== input.extractionRunId) {
      throw new ExtractionFencedError(
        `Worker fenced: active extraction run superseded (expected ${input.extractionRunId}, found ${doc.extractionRunId})`,
      );
    }

    if (doc.graphWorkerToken !== input.workerToken) {
      throw new ExtractionFencedError(
        `Worker fenced: worker token mismatch (expected ${input.workerToken}, found ${doc.graphWorkerToken})`,
      );
    }

    if (input.expectedLeaseGeneration !== undefined && doc.graphLeaseGeneration != null) {
      if (BigInt(doc.graphLeaseGeneration) !== BigInt(input.expectedLeaseGeneration)) {
        throw new ExtractionFencedError(
          `Worker fenced: lease generation mismatch (expected ${input.expectedLeaseGeneration}, found ${doc.graphLeaseGeneration})`,
        );
      }
    }

    if (['COMPLETED', 'FAILED', 'PARTIAL'].includes(doc.graphStatus || '')) {
      throw new ExtractionFencedError(
        `Worker fenced: extraction run is already in terminal state "${doc.graphStatus}"`,
      );
    }

    if (doc.graphFinalizationReceipt != null) {
      throw new ExtractionFencedError(
        'Worker fenced: extraction run already finalized with receipt',
      );
    }

    if (!doc.isLeaseValid) {
      throw new ExtractionFencedError(
        `Worker fenced: worker lease expired (leaseExpiresAt=${doc.graphLeaseExpiresAt})`,
      );
    }

    const currentMeta =
      (typeof doc.metadata === 'string' ? JSON.parse(doc.metadata) : doc.metadata) || {};
    const currentCheckpoint = currentMeta.graphCheckpoint as GraphChunkCheckpoint | undefined;

    if (currentMeta.chunkManifestHash && currentMeta.chunkManifestHash !== input.chunkManifestHash) {
      throw new ExtractionFencedError(
        `Worker fenced: source manifest hash mismatch (expected ${input.chunkManifestHash}, found ${currentMeta.chunkManifestHash})`,
      );
    }

    if (
      currentCheckpoint?.chunkManifestHash &&
      currentCheckpoint.chunkManifestHash !== input.chunkManifestHash
    ) {
      throw new ExtractionFencedError(
        `Worker fenced: checkpoint manifest hash mismatch (expected ${input.chunkManifestHash}, found ${currentCheckpoint.chunkManifestHash})`,
      );
    }

    // 4. Persist entities and mentions using transaction client
    const txRepo = new GraphRepository(tx);
    const txEntityResolver = new EntityResolver(txRepo);
    const txRelationResolver = new RelationResolver(txRepo);

    let entitiesResolved = 0;
    let mentionsCreated = 0;
    let relationsPersisted = 0;
    let evidenceCreated = 0;

    const entityIdMap = new Map<string, string>();

    for (const extractedEntity of input.rawExtraction.entities) {
      const normalizedName = EntityNormalizer.normalize(extractedEntity.name);
      if (!normalizedName) continue;

      try {
        const resolution = await txEntityResolver.resolve(input.workspaceId, extractedEntity);
        entitiesResolved++;
        entityIdMap.set(normalizedName, resolution.entity.id);
        entityIdMap.set(resolution.entity.normalizedName, resolution.entity.id);

        if (extractedEntity.aliases) {
          for (const alias of extractedEntity.aliases) {
            const normAlias = EntityNormalizer.normalize(alias);
            if (normAlias) {
              entityIdMap.set(normAlias, resolution.entity.id);
            }
          }
        }

        let startOffset: number | undefined;
        let endOffset: number | undefined;
        const mentionIdx = input.content.toLowerCase().indexOf(extractedEntity.name.toLowerCase());
        if (mentionIdx >= 0) {
          startOffset = mentionIdx;
          endOffset = mentionIdx + extractedEntity.name.length;
        }

        await txRepo.createMentionIdempotent({
          workspaceId: input.workspaceId,
          chunkId: input.chunkId,
          entityId: resolution.entity.id,
          mentionText: extractedEntity.name.slice(0, 255),
          startOffset,
          endOffset,
          confidence: extractedEntity.confidence,
        });
        mentionsCreated++;
      } catch (err: any) {
        console.warn(
          `[GraphExtractionService] Failed to resolve entity in transaction:`,
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

    // 5. Validate relations and pre-calculate advisory lock keys
    interface EvidenceItem {
      relationId: string;
      lockKey: bigint;
      evidenceText: string;
      confidence: number;
    }
    const evidenceItems: EvidenceItem[] = [];

    for (const extractedRelation of input.rawExtraction.relations) {
      const valResult = txRelationResolver.validateWithDetails(
        extractedRelation,
        entityIdMap,
        input.content,
      );

      if (!valResult.isValid || !valResult.validated) {
        if (valResult.failureReason === 'UNRESOLVED_ENDPOINT')
          validationFailures.unresolvedEndpoints++;
        else if (valResult.failureReason === 'SELF_LOOP') validationFailures.selfLoops++;
        else if (valResult.failureReason === 'UNSUPPORTED_RELATION_TYPE')
          validationFailures.unsupportedRelationType++;
        else if (valResult.failureReason === 'LOW_CONFIDENCE')
          validationFailures.lowConfidence++;
        else if (valResult.failureReason === 'INVALID_EVIDENCE')
          validationFailures.invalidEvidence++;
        continue;
      }

      const validatedRelation = valResult.validated;

      try {
        const persistedRel = await txRepo.upsertRelation({
          workspaceId: input.workspaceId,
          sourceEntityId: validatedRelation.sourceEntityId,
          targetEntityId: validatedRelation.targetEntityId,
          relationType: validatedRelation.relationType,
          description: validatedRelation.description,
          weight: 1.0,
          confidence: validatedRelation.confidence,
        });
        relationsPersisted++;

        const lockKey = computeRelationLockKey(input.workspaceId, persistedRel.id);
        evidenceItems.push({
          relationId: persistedRel.id,
          lockKey,
          evidenceText: validatedRelation.evidence,
          confidence: validatedRelation.confidence,
        });
      } catch (err: any) {
        console.warn(
          `[GraphExtractionService] Failed to upsert relation in transaction:`,
          sanitizeErrorMessage(err?.message || 'Unknown error'),
        );
      }
    }

    // 6. Sort evidence items by lockKey in ascending numerical order to prevent AB-BA deadlocks
    const sortedEvidenceItems = sortRelationsByLockKey(evidenceItems);

    // Explicit Tier 2 Advisory Lock Pre-Acquisition in deterministic ascending numerical order
    for (const item of sortedEvidenceItems) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${item.lockKey}::bigint);`;
    }

    // 7. Insert relation evidence in sorted order (trigger re-acquires = instant no-op)
    for (const item of sortedEvidenceItems) {
      try {
        await txRepo.createEvidenceIdempotent({
          workspaceId: input.workspaceId,
          relationId: item.relationId,
          chunkId: input.chunkId,
          documentId: input.documentId,
          evidenceText: item.evidenceText,
          confidence: item.confidence,
        });
        evidenceCreated++;
      } catch (err: any) {
        console.warn(
          `[GraphExtractionService] Failed to insert relation evidence:`,
          sanitizeErrorMessage(err?.message || 'Unknown error'),
        );
      }
    }

    // 8. Atomic Checkpoint Commit & Pre-Commit Lease Validation
    const updatedCheckpoint: GraphChunkCheckpoint = {
      extractionRunId: input.extractionRunId,
      chunkManifestHash: input.chunkManifestHash,
      lastCompletedChunkIndex: input.chunkIndex,
      lastCompletedChunkId: input.chunkId,
      processedChunksCount: input.chunkIndex + 1,
      succeededChunksCount: (input.previousCheckpoint?.succeededChunksCount || 0) + 1,
      failedChunksCount: input.previousCheckpoint?.failedChunksCount || 0,
    };

    const rowsUpdated = await tx.$executeRaw`
      UPDATE "documents"
      SET metadata = jsonb_set(
        jsonb_set(
          jsonb_set(
            metadata,
            '{graphCheckpoint}',
            ${JSON.stringify(updatedCheckpoint)}::jsonb
          ),
          '{graphHeartbeatAt}',
          to_jsonb(to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
        ),
        '{graphLeaseExpiresAt}',
        to_jsonb(to_char((clock_timestamp() + INTERVAL '60 seconds') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
      ),
      "updatedAt" = clock_timestamp()
      WHERE id = ${input.documentId}
        AND "workspaceId" = ${input.workspaceId}
        AND metadata->>'extractionRunId' = ${input.extractionRunId}
        AND metadata->>'graphWorkerToken' = ${input.workerToken}
        AND (metadata->>'graphStatus' = 'PROCESSING' OR metadata->>'graphStatus' = 'QUEUED')
        AND (metadata->>'graphLeaseExpiresAt')::timestamptz > clock_timestamp();
    `;

    if (rowsUpdated === 0) {
      throw new ExtractionFencedError(
        'Pre-commit lease validation failed: lease expired or ownership lost before commit; transaction rolled back',
      );
    }

    return {
      updatedCheckpoint,
      entitiesExtracted: input.rawExtraction.entities.length,
      entitiesResolved,
      mentionsCreated,
      relationsExtracted: input.rawExtraction.relations.length,
      relationsPersisted,
      evidenceCreated,
      diagnostics: {
        validationFailures,
      },
    };
  }

  /**
   * Processes a single document chunk through the full extraction pipeline.
   * If extractionRunId and workerToken are provided in context, executes atomic
   * database transaction persistence with Tier 1 row lock & Tier 2 advisory locks.
   */
  public async extractFromChunk(
    workspaceId: string,
    documentId: string,
    chunkId: string,
    content: string,
    context?: {
      documentTitle?: string;
      sectionHeading?: string;
      pageNumber?: number;
      abortSignal?: AbortSignal;
      extractionRunId?: string;
      workerToken?: string;
      expectedLeaseGeneration?: bigint | number;
      chunkIndex?: number;
      totalChunks?: number;
      chunkManifestHash?: string;
      previousCheckpoint?: GraphChunkCheckpoint;
    },
  ): Promise<ChunkExtractionResult & { __persistedInTransaction?: boolean }> {
    const startTime = performance.now();

    // 1. Invoke LLM Extraction Provider strictly OUTSIDE any database transaction
    const validatedSchema = await this.extractRaw(content, {
      ...context,
      workspaceId,
    });

    // 2. If extractionRunId and workerToken are provided, use atomic transaction persistence
    if (
      context?.extractionRunId &&
      context?.workerToken &&
      context.chunkIndex !== undefined &&
      context.totalChunks !== undefined &&
      context.chunkManifestHash
    ) {
      const persistResult = await prisma.$transaction(
        async (tx) => {
          return await this.persistChunkExtraction(tx, {
            workspaceId,
            documentId,
            chunkId,
            chunkIndex: context.chunkIndex!,
            totalChunks: context.totalChunks!,
            content,
            extractionRunId: context.extractionRunId!,
            workerToken: context.workerToken!,
            expectedLeaseGeneration: context.expectedLeaseGeneration,
            chunkManifestHash: context.chunkManifestHash!,
            rawExtraction: validatedSchema,
            previousCheckpoint: context.previousCheckpoint,
          });
        },
        {
          maxWait: 5000,
          timeout: 15000,
          isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        },
      );

      return {
        chunkId,
        documentId,
        workspaceId,
        entitiesExtracted: persistResult.entitiesExtracted,
        entitiesResolved: persistResult.entitiesResolved,
        mentionsCreated: persistResult.mentionsCreated,
        relationsExtracted: persistResult.relationsExtracted,
        relationsPersisted: persistResult.relationsPersisted,
        evidenceCreated: persistResult.evidenceCreated,
        durationMs: Math.round(performance.now() - startTime),
        __persistedInTransaction: true,
        diagnostics: {
          provider: this.provider.providerName,
          model: (this.provider as any).modelName,
          validationFailures: persistResult.diagnostics?.validationFailures || {
            unresolvedEndpoints: 0,
            selfLoops: 0,
            unsupportedRelationType: 0,
            lowConfidence: 0,
            invalidEvidence: 0,
          },
        },
      };
    }

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
