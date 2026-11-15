import type {
  DocumentStorageProvider,
  EmbeddingProvider,
  ProcessDocumentJobPayload,
} from '@mindvault/shared';
import {
  computeChunkManifestHash,
  formatExtractionJobId,
  getDocumentQueueName,
  type PendingDispatch,
} from '@mindvault/shared';
import crypto from 'node:crypto';
import { extractDocument } from './extractors/index.js';
import { normalizeText } from './normalization/text.normalizer.js';
import { chunkDocument } from './chunking/chunker.js';
import { Logger } from '../../utils/logger.js';

import type { IWorkerGraphQueue } from '../../lib/graph-queue.js';

export interface IngestionDatabaseService {
  findDocumentById(id: string): Promise<any>;
  updateDocument(id: string, data: any): Promise<any>;
  createDocumentChunks(chunks: any[]): Promise<void>;
}

export class DocumentIngestionPipeline {
  private logger = new Logger('DocumentIngestionPipeline');

  constructor(
    private storage: DocumentStorageProvider,
    private embeddings: EmbeddingProvider,
    private db: IngestionDatabaseService,
    private graphQueue?: IWorkerGraphQueue,
  ) {}

  public async processDocument(
    payload: ProcessDocumentJobPayload,
    options?: { rerouteQueueOverride?: any },
  ): Promise<{ status?: string; targetWorkspaceId?: string; error?: string } | void> {
    const { documentId, workspaceId } = payload;
    this.logger.info(`Starting ingestion for document ${documentId} in workspace ${workspaceId}`);

    // Worker Capability Routing (§OPS-01)
    const requiresLocal = (payload as any).requiresLocal || payload.capability === 'local';
    if (process.env.WORKER_TYPE === 'cloud' && requiresLocal) {
      const targetQueueName = getDocumentQueueName(workspaceId, 'local');
      this.logger.warn(
        `Job ${documentId} requires local execution but was received by cloud worker. Re-routing safely to '${targetQueueName}'.`,
      );
      if (options?.rerouteQueueOverride) {
        await options.rerouteQueueOverride.add(
          'process-document',
          { ...payload, capability: 'local', requiresLocal: true },
          {
            jobId: `proc_${documentId}`,
            attempts: 3,
            backoff: { type: 'exponential', delay: 1000 },
          },
        );
        return { status: 'rerouted_to_local', targetWorkspaceId: workspaceId };
      }
      if (process.env.NODE_ENV === 'test' && !(options as any)?.forceReroute) {
        return { status: 'skipped_local_required', targetWorkspaceId: workspaceId };
      }
      try {
        const { Queue } = await import('bullmq');
        const { parseRedisUrl, toBullQueueName } = await import('@mindvault/shared');
        const conn = parseRedisUrl(process.env.REDIS_URL || '', 'producer');
        const targetQ = new Queue(toBullQueueName(targetQueueName), { connection: conn as any });
        await targetQ.add(
          'process-document',
          { ...payload, capability: 'local', requiresLocal: true },
          {
            jobId: `proc_${documentId}`,
            attempts: 3,
            backoff: { type: 'exponential', delay: 1000 },
          },
        );
        await targetQ.close();
        return { status: 'rerouted_to_local', targetWorkspaceId: workspaceId };
      } catch (err: any) {
        this.logger.error(`Failed to reroute local-required job: ${err.message}`);
        throw new Error(`Failed to reroute local-required job ${documentId}: ${err.message}`);
      }
    }

    if (
      process.env.WORKER_TYPE === 'local' &&
      payload.capability === 'cloud' &&
      !(payload as any).requiresLocal
    ) {
      const targetQueueName = getDocumentQueueName(workspaceId, 'cloud');
      this.logger.warn(
        `Job ${documentId} has cloud capability but was received by local worker. Re-routing safely to '${targetQueueName}'.`,
      );
      if (options?.rerouteQueueOverride) {
        await options.rerouteQueueOverride.add('process-document', payload, {
          jobId: `proc_${documentId}`,
          attempts: 3,
          backoff: { type: 'exponential', delay: 1000 },
        });
        return { status: 'rerouted_to_cloud', targetWorkspaceId: workspaceId };
      }
      if (process.env.NODE_ENV === 'test' && !(options as any)?.forceReroute) {
        return { status: 'skipped_cloud_required', targetWorkspaceId: workspaceId };
      }
      try {
        const { Queue } = await import('bullmq');
        const { parseRedisUrl, toBullQueueName } = await import('@mindvault/shared');
        const conn = parseRedisUrl(process.env.REDIS_URL || '', 'producer');
        const targetQ = new Queue(toBullQueueName(targetQueueName), { connection: conn as any });
        await targetQ.add('process-document', payload, {
          jobId: `proc_${documentId}`,
          attempts: 3,
          backoff: { type: 'exponential', delay: 1000 },
        });
        await targetQ.close();
        return { status: 'rerouted_to_cloud', targetWorkspaceId: workspaceId };
      } catch (err: any) {
        this.logger.error(`Failed to reroute cloud job: ${err.message}`);
        throw new Error(`Failed to reroute cloud job ${documentId}: ${err.message}`);
      }
    }

    // Tenant Isolation Boundary Check (§ARC-01)
    const authorizedWorkspaceId = process.env.AUTHORIZED_WORKSPACE_ID;
    if (authorizedWorkspaceId && authorizedWorkspaceId !== workspaceId) {
      const capability = requiresLocal ? 'local' : payload.capability || 'cloud';
      const targetQueueName = getDocumentQueueName(workspaceId, capability);
      this.logger.warn(
        `Job for workspace ${workspaceId} was received by worker authorized only for ${authorizedWorkspaceId}. Re-routing safely to '${targetQueueName}'.`,
      );
      try {
        let targetQ = options?.rerouteQueueOverride;
        if (!targetQ) {
          const { Queue } = await import('bullmq');
          const { parseRedisUrl, toBullQueueName } = await import('@mindvault/shared');
          const conn = parseRedisUrl(process.env.REDIS_URL || '', 'producer');
          targetQ = new Queue(toBullQueueName(targetQueueName), { connection: conn as any });
        }
        await targetQ.add('process-document', payload, {
          jobId: `proc_${documentId}`,
          attempts: 3,
          backoff: { type: 'exponential', delay: 1000 },
        });
        if (!options?.rerouteQueueOverride) {
          await targetQ.close();
        }
        return { status: 'rerouted', targetWorkspaceId: workspaceId };
      } catch (err: any) {
        this.logger.error(`Failed to reroute foreign job: ${err.message}`);
        throw new Error(`Failed to reroute foreign job ${documentId}: ${err.message}`);
      }
    }

    const doc = await this.db.findDocumentById(documentId);
    if (!doc) {
      throw new Error(`Document ${documentId} not found in database`);
    }

    if (doc.workspaceId !== workspaceId) {
      throw new Error(
        `Workspace mismatch: document ${documentId} does not belong to workspace ${workspaceId}`,
      );
    }

    try {
      // 1. Stage: PROCESSING (EXTRACTING)
      await this.db.updateDocument(documentId, {
        status: 'PROCESSING',
        metadata: { ...doc.metadata, processingStage: 'EXTRACTING' },
      });

      // 2. Read raw file buffer from storage (with cloud-to-local hybrid fallback)
      let fileBuffer: Buffer;
      if (await this.storage.exists(doc.storageKey)) {
        fileBuffer = await this.storage.read(doc.storageKey);
      } else if (doc.metadata?.rawContentBase64) {
        // Hybrid cloud-to-local bridge:
        // File was uploaded through cloud API; local Windows worker reconstructs from database payload
        fileBuffer = Buffer.from(doc.metadata.rawContentBase64, 'base64');
        try {
          await this.storage.save(doc.storageKey, fileBuffer);
        } catch {
          // Non-blocking local filesystem caching
        }
      } else {
        fileBuffer = await this.storage.read(doc.storageKey);
      }

      // 3. Extract text
      const extraction = await extractDocument(fileBuffer, doc.extension, doc.mimeType);

      // 4. Stage: NORMALIZING
      await this.db.updateDocument(documentId, {
        metadata: {
          ...doc.metadata,
          processingStage: 'NORMALIZING',
          extractedMetadata: extraction.metadata,
        },
      });

      const normalized = normalizeText(extraction.extractedText);

      // Verify extractable text is present
      if (!normalized || normalized.trim().length === 0) {
        const errorMsg =
          extraction.warnings && extraction.warnings.length > 0
            ? extraction.warnings[0]
            : 'Document contains no extractable text content';
        await this.db.updateDocument(documentId, {
          status: 'FAILED',
          errorMessage: errorMsg,
          metadata: { ...doc.metadata, processingStage: 'FAILED', warnings: extraction.warnings },
        });
        this.logger.warn(`Document ${documentId} extraction failed: ${errorMsg}`);
        return;
      }

      // 5. Stage: CHUNKING
      await this.db.updateDocument(documentId, {
        metadata: { ...doc.metadata, processingStage: 'CHUNKING' },
      });

      const chunks = chunkDocument(normalized, undefined, extraction.pages);

      if (chunks.length === 0) {
        await this.db.updateDocument(documentId, {
          status: 'FAILED',
          errorMessage: 'Document chunking yielded 0 chunks',
          metadata: { ...doc.metadata, processingStage: 'FAILED' },
        });
        return;
      }

      // 6. Stage: EMBEDDING
      await this.db.updateDocument(documentId, {
        metadata: {
          ...doc.metadata,
          processingStage: 'EMBEDDING',
          pendingChunks: chunks.length,
        },
      });

      const chunkTexts = chunks.map((c) => c.content);
      const embeddings = await this.embeddings.generateEmbeddings(chunkTexts);

      // 7. Stage: STORING
      await this.db.updateDocument(documentId, {
        metadata: { ...doc.metadata, processingStage: 'STORING' },
      });

      const dbChunks = chunks.map((c, idx) => ({
        id: `chk_${documentId}_${c.chunkIndex}`,
        documentId,
        workspaceId,
        chunkIndex: c.chunkIndex,
        content: c.content,
        tokenCount: c.tokenCount,
        pageStart: c.pageStart,
        pageEnd: c.pageEnd,
        heading: c.heading,
        metadata: {
          heading: c.heading,
          tokenCount: c.tokenCount,
          ...c.metadata,
        },
        embedding: embeddings[idx],
      }));

      await this.db.createDocumentChunks(dbChunks);

      // 8. Stage: COMPLETED with Atomic Claim & Intent (§6.3.3)
      const extractionRunId = crypto.randomUUID();
      const manifestChunks = dbChunks.map((c) => ({
        chunkIndex: c.chunkIndex,
        id: c.id,
        content: c.content,
      }));
      const chunkManifestHash = computeChunkManifestHash(doc.checksum, manifestChunks);
      const jobId = formatExtractionJobId(documentId, extractionRunId);
      const nowIso = new Date().toISOString();

      const pendingDispatch: PendingDispatch = {
        extractionRunId,
        jobId,
        enqueuedAt: null,
        createdAt: nowIso,
        attempts: 0,
        lastAttemptAt: null,
        lastError: null,
      };

      // Strip rawContentBase64 upon durable chunk & vector storage completion (§DAT-01)
      const { rawContentBase64: _removedContent, ...cleanMetadata } = (doc.metadata as any) || {};

      const updatedMetadata = {
        ...cleanMetadata,
        processingStage: 'COMPLETED',
        warnings: extraction.warnings,
        graphStatus: 'QUEUED',
        extractionRunId,
        chunkManifestHash,
        graphQueuedAt: nowIso,
        graphAttempts: 1,
        pendingDispatch,
      };

      await this.db.updateDocument(documentId, {
        status: 'COMPLETED',
        errorMessage: null,
        pageCount: extraction.pageCount || 1,
        chunkCount: chunks.length,
        embeddingModel: this.embeddings.modelName,
        embeddingDimension: this.embeddings.dimension,
        processedAt: new Date(),
        metadata: updatedMetadata,
      });

      this.logger.info(
        `Successfully completed ingestion for document ${documentId}: ${chunks.length} chunks embedded and stored.`,
      );

      // 9. Asynchronous Knowledge Graph Extraction Handoff (Claim-and-Intent Protocol, outside DB Tx)
      if (this.graphQueue) {
        try {
          const docCapability = requiresLocal ? 'local' : 'cloud';
          await this.graphQueue.enqueue({
            documentId,
            workspaceId,
            extractionRunId,
            chunkManifestHash,
            capability: docCapability,
            requiresLocal,
          });

          // Confirm dispatch in DB
          await this.db.updateDocument(documentId, {
            metadata: {
              ...updatedMetadata,
              pendingDispatch: {
                ...pendingDispatch,
                enqueuedAt: new Date().toISOString(),
              },
            },
          });

          this.logger.info(
            `Enqueued document ${documentId} for knowledge graph extraction (run: ${extractionRunId}, job: ${jobId})`,
          );
        } catch (err: any) {
          this.logger.warn(
            `Failed to enqueue document ${documentId} for graph extraction: ${err.message}. Intent remains pending in DB for background recovery.`,
          );
        }
      }
    } catch (err: any) {
      this.logger.error(`Document ${documentId} ingestion failed: ${err.message}`, {
        stack: err.stack,
      });

      await this.db.updateDocument(documentId, {
        status: 'FAILED',
        errorMessage: err.message || 'Internal ingestion processing error',
        metadata: { ...doc.metadata, processingStage: 'FAILED' },
      });

      throw err;
    }
  }
}
