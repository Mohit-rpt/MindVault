import { Worker, Job } from 'bullmq';
import { Logger } from './utils/logger.js';
import { env } from './config/env.js';
import type { ProcessDocumentJobPayload } from '@mindvault/shared';
import { DocumentIngestionPipeline } from './modules/ingestion/pipeline.js';
import { WorkerStorageProvider } from './lib/storage.js';
import { PrismaWorkerDatabaseService } from './lib/db.js';
import { createEmbeddingProvider } from './modules/ingestion/embeddings/index.js';
import { BullMQWorkerGraphQueue } from './lib/graph-queue.js';

export class WorkerService {
  private logger = new Logger('WorkerService');
  private isRunning = false;
  private bullWorker: Worker<ProcessDocumentJobPayload> | null = null;
  private pipeline: DocumentIngestionPipeline | null = null;

  constructor(pipeline?: DocumentIngestionPipeline) {
    if (pipeline) {
      this.pipeline = pipeline;
    }
  }

  public async start(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('Worker is already running');
      return;
    }

    this.isRunning = true;
    this.logger.info('🚀 MindVault background worker initialized', {
      concurrency: env.WORKER_CONCURRENCY,
      redisUrl: env.REDIS_URL,
      environment: env.NODE_ENV,
    });

    // Initialize pipeline if not injected
    if (!this.pipeline) {
      const storage = new WorkerStorageProvider();
      const embeddingProvider = createEmbeddingProvider();
      const db = new PrismaWorkerDatabaseService();
      const graphQueue = new BullMQWorkerGraphQueue();
      this.pipeline = new DocumentIngestionPipeline(storage, embeddingProvider, db, graphQueue);
    }

    // In test environment, skip spinning up live BullMQ socket unless requested
    if (env.NODE_ENV === 'test') {
      this.logger.info('Worker initialized in test mode (BullMQ listener ready for dispatch)');
      return;
    }

    try {
      this.bullWorker = new Worker<ProcessDocumentJobPayload>(
        'document-processing',
        async (job: Job<ProcessDocumentJobPayload>) => {
          this.logger.info(`Processing job ${job.id} for document ${job.data.documentId}`);
          await this.pipeline!.processDocument(job.data);
        },
        {
          concurrency: env.WORKER_CONCURRENCY,
          connection: {
            url: env.REDIS_URL,
            maxRetriesPerRequest: null,
          },
        },
      );

      this.bullWorker.on('completed', (job: Job) => {
        this.logger.info(`Job ${job.id} completed successfully`);
      });

      this.bullWorker.on('failed', (job: Job | undefined, err: Error) => {
        this.logger.error(`Job ${job?.id} failed: ${err.message}`);
      });

      this.bullWorker.on('error', (err: Error) => {
        this.logger.warn(`BullMQ worker connection error: ${err.message}`);
      });

      this.logger.info('BullMQ worker actively listening on queue "document-processing"');
    } catch (err: any) {
      this.logger.warn(
        `Could not connect BullMQ worker to Redis: ${err.message}. Worker running in standby.`,
      );
    }
  }

  public async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    this.logger.info('🛑 Stopping worker service, releasing resources...');
    if (this.bullWorker) {
      await this.bullWorker.close();
      this.bullWorker = null;
    }

    this.isRunning = false;
    this.logger.info('✅ Worker service gracefully stopped');
  }

  public getActiveStatus(): boolean {
    return this.isRunning;
  }

  public getPipeline(): DocumentIngestionPipeline | null {
    return this.pipeline;
  }
}
