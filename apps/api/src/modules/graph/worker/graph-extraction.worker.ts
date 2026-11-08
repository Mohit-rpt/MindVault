/**
 * MindVault — Knowledge Graph: Asynchronous Extraction Worker
 *
 * @deprecated As of Phase 6.4.2, `apps/worker` owns the sole production graph extraction runtime
 * (`apps/worker/src/modules/graph/worker/graph-extraction.worker.ts`) with dual-lease fencing,
 * cooperative LLM cancellation, and race-safe shutdown deferral.
 * This class in `apps/api` is retained only for backward compatibility and test mock references.
 */

import { Worker, type Job } from 'bullmq';
import { env } from '../../../config/env.js';
import { prisma } from '../../../lib/prisma.js';
import type { GraphExtractionJobPayload } from '@mindvault/shared';
import {
  GraphExtractionService,
  graphExtractionService,
} from '../services/graph-extraction.service.js';

export class GraphExtractionWorker {
  private worker: Worker<GraphExtractionJobPayload> | null = null;
  private isRunning = false;

  constructor(private readonly service: GraphExtractionService = graphExtractionService) {}

  public async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    if (env.NODE_ENV === 'test') {
      return;
    }

    try {
      this.worker = new Worker<GraphExtractionJobPayload>(
        'graph-extraction',
        async (job: Job<GraphExtractionJobPayload>) => {
          await this.processJob(job.data);
        },
        {
          concurrency: 2,
          connection: {
            url: env.REDIS_URL || 'redis://localhost:6379',
            maxRetriesPerRequest: null,
          },
        },
      );

      this.worker.on('completed', (job: Job) => {
        console.log(`[GraphWorker] Job ${job.id} completed successfully`);
      });

      this.worker.on('failed', (job: Job | undefined, err: Error) => {
        console.error(`[GraphWorker] Job ${job?.id} failed: ${err.message}`);
      });
    } catch (err) {
      console.warn('[GraphWorker] Redis connection not available. Running in standby mode:', err);
    }
  }

  public async stop(): Promise<void> {
    if (!this.isRunning) return;
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
    this.isRunning = false;
  }

  /**
   * Processes a graph extraction job payload idempotently with strict tenant boundary checks.
   */
  public async processJob(payload: GraphExtractionJobPayload) {
    const { workspaceId, documentId, chunkId, forceReextract } = payload;

    if (!workspaceId || !documentId) {
      throw new Error('Invalid job payload: workspaceId and documentId are required');
    }

    // 1. Verify that the document exists and belongs to the specified workspace
    const document = await prisma.document.findUnique({
      where: {
        workspaceId_id: {
          workspaceId,
          id: documentId,
        },
      },
      select: {
        id: true,
        workspaceId: true,
        originalName: true,
        status: true,
      },
    });

    if (!document) {
      // Document may have been deleted while job was in flight: exit cleanly
      console.warn(
        `[GraphWorker] Document ${documentId} not found in workspace ${workspaceId}. Skipping job.`,
      );
      return null;
    }

    // 2. If chunkId is specified, process single chunk
    if (chunkId) {
      const chunk = await prisma.documentChunk.findUnique({
        where: {
          workspaceId_id: {
            workspaceId,
            id: chunkId,
          },
        },
      });

      if (!chunk || chunk.documentId !== documentId) {
        console.warn(
          `[GraphWorker] Chunk ${chunkId} not found or mismatched with document ${documentId}. Skipping.`,
        );
        return null;
      }

      return this.service.extractFromChunk(workspaceId, documentId, chunk.id, chunk.content, {
        documentTitle: document.originalName,
        sectionHeading: (chunk.metadata as any)?.heading || undefined,
        pageNumber: chunk.pageStart || undefined,
      });
    }

    // 3. Process full document
    return this.service.extractDocument(workspaceId, documentId, forceReextract);
  }
}

export const graphExtractionWorker = new GraphExtractionWorker();
