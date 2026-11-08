import { Worker, Job } from 'bullmq';
import { Logger } from './utils/logger.js';
import { env } from './config/env.js';
import type { ProcessDocumentJobPayload } from '@mindvault/shared';
import { DocumentIngestionPipeline } from './modules/ingestion/pipeline.js';
import { WorkerStorageProvider } from './lib/storage.js';
import { PrismaWorkerDatabaseService } from './lib/db.js';
import { createEmbeddingProvider } from './modules/ingestion/embeddings/index.js';
import { BullMQWorkerGraphQueue } from './lib/graph-queue.js';
import {
  GraphExtractionWorker,
  graphExtractionWorker,
} from './modules/graph/worker/graph-extraction.worker.js';
import { DispatchRecoveryService } from './services/dispatch-recovery.service.js';
import { GraphReconciliationService } from './services/graph-reconciliation.service.js';

export class WorkerService {
  private logger = new Logger('WorkerService');
  private isRunning = false;
  private bullWorker: Worker<ProcessDocumentJobPayload> | null = null;
  private pipeline: DocumentIngestionPipeline | null = null;
  private graphWorker: GraphExtractionWorker;
  private recoveryService: DispatchRecoveryService;
  private reconciliationService: GraphReconciliationService;

  constructor(
    pipeline?: DocumentIngestionPipeline,
    graphWorker?: GraphExtractionWorker,
    recoveryService?: DispatchRecoveryService,
    reconciliationService?: GraphReconciliationService,
  ) {
    if (pipeline) {
      this.pipeline = pipeline;
    }
    this.graphWorker = graphWorker || graphExtractionWorker;
    this.recoveryService = recoveryService || new DispatchRecoveryService();
    this.reconciliationService = reconciliationService || new GraphReconciliationService();
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

    // Step 1: Execute startup graph reconciliation BEFORE starting BullMQ queue consumption.
    // Guarantees interrupted, unreceipted, or stale graph extraction jobs are reconciled
    // before new or resumed jobs are processed by this worker.
    try {
      this.logger.info('Executing startup graph reconciliation...');
      const sweepResult = await this.reconciliationService.executeStartupReconciliation();
      this.logger.info('Startup graph reconciliation completed', sweepResult);
    } catch (err: any) {
      this.logger.warn(
        `Startup graph reconciliation encountered an error: ${err.message}. Worker proceeding safely.`,
      );
    }

    // Step 2: Start graph extraction worker runtime
    await this.graphWorker.start();

    // Step 3: Start background periodic reconciliation and dispatch recovery services
    this.reconciliationService.start(60000);
    this.recoveryService.start(60000);

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

    this.logger.info('🛑 Stopping worker service, initiating graceful drain and deferral...');

    // 1. Pause ingestion polling immediately
    if (this.bullWorker) {
      try {
        await this.bullWorker.pause(true);
      } catch (e: any) {
        this.logger.warn(`Error pausing document worker: ${e.message}`);
      }
    }

    // 2. Stop periodic reconciliation service and await in-flight sweep
    try {
      await this.reconciliationService.stop();
    } catch (e: any) {
      this.logger.warn(`Error stopping reconciliation service: ${e.message}`);
    }

    // 3. Stop graph worker (cooperative LLM cancellation budget + chunk deferral)
    try {
      await this.graphWorker.stop();
    } catch (e: any) {
      this.logger.warn(`Error stopping graph worker: ${e.message}`);
    }

    // 4. Close ingestion BullMQ worker
    if (this.bullWorker) {
      try {
        await this.bullWorker.close(false);
      } catch (e: any) {
        this.logger.warn(`Error closing document worker: ${e.message}`);
      }
      this.bullWorker = null;
    }

    // 5. Stop dispatch recovery service and await any in-flight sweep
    try {
      await this.recoveryService.stop();
    } catch (e: any) {
      this.logger.warn(`Error stopping dispatch recovery service: ${e.message}`);
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

  public getGraphWorker(): GraphExtractionWorker {
    return this.graphWorker;
  }

  public getRecoveryService(): DispatchRecoveryService {
    return this.recoveryService;
  }

  public getReconciliationService(): GraphReconciliationService {
    return this.reconciliationService;
  }
}
