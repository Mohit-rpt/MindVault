import type {
  DocumentStorageProvider,
  EmbeddingProvider,
  ProcessDocumentJobPayload,
} from '@mindvault/shared';
import {
  computeChunkManifestHash,
  formatExtractionJobId,
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

  public async processDocument(payload: ProcessDocumentJobPayload): Promise<void> {
    const { documentId, workspaceId } = payload;
    this.logger.info(`Starting ingestion for document ${documentId} in workspace ${workspaceId}`);

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

      // 2. Read raw file buffer from storage
      const fileBuffer = await this.storage.read(doc.storageKey);

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

      const updatedMetadata = {
        ...doc.metadata,
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
          await this.graphQueue.enqueue({
            documentId,
            workspaceId,
            extractionRunId,
            chunkManifestHash,
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
