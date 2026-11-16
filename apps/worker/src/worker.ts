import { Worker, Job } from 'bullmq';
import { Logger } from './utils/logger.js';
import { env } from './config/env.js';
import {
  type ProcessDocumentJobPayload,
  getDocumentQueueName,
  toBullQueueName,
  parseRedisUrl,
  sanitizeRedisUrl,
  sanitizeErrorMessage,
} from '@mindvault/shared';
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
import { WorkerHeartbeatService } from './services/worker-heartbeat.service.js';
import { validateOllamaEnvironment } from './lib/ollama-validator.js';

export class WorkerService {
  private logger = new Logger('WorkerService');
  private isRunning = false;
  private bullWorker: Worker<ProcessDocumentJobPayload> | null = null;
  private bullWorkers: Worker<ProcessDocumentJobPayload>[] = [];
  private bullWorkersByQueue: Map<string, Worker<ProcessDocumentJobPayload>> = new Map();
  private registeredWorkspaces: Set<string> = new Set();
  private discoveryIntervalTimer: NodeJS.Timeout | null = null;
  private workerOptions: any = null;
  private forceLiveBullMQ = false;
  private pipeline: DocumentIngestionPipeline | null = null;
  private graphWorker: GraphExtractionWorker;
  private recoveryService: DispatchRecoveryService;
  private reconciliationService: GraphReconciliationService;
  private heartbeatService: WorkerHeartbeatService;

  constructor(
    pipeline?: DocumentIngestionPipeline,
    graphWorker?: GraphExtractionWorker,
    recoveryService?: DispatchRecoveryService,
    reconciliationService?: GraphReconciliationService,
    heartbeatService?: WorkerHeartbeatService,
  ) {
    if (pipeline) {
      this.pipeline = pipeline;
    }
    this.graphWorker = graphWorker || graphExtractionWorker;
    this.recoveryService = recoveryService || new DispatchRecoveryService();
    this.reconciliationService = reconciliationService || new GraphReconciliationService();
    this.heartbeatService =
      heartbeatService ||
      new WorkerHeartbeatService(env.REDIS_URL, env.WORKER_CONCURRENCY, env.NODE_ENV);
  }

  public getRegisteredWorkspaces(): string[] {
    return [...this.registeredWorkspaces];
  }

  public getBullWorkers(): Worker<ProcessDocumentJobPayload>[] {
    return [...this.bullWorkers];
  }

  public getBullWorker(): Worker<ProcessDocumentJobPayload> | null {
    return this.bullWorker || this.bullWorkers[0] || null;
  }

  public async resolveWorkspaces(options?: { workspaceIds?: string[] }): Promise<string[]> {
    if (options?.workspaceIds && options.workspaceIds.length > 0) {
      return [
        ...new Set(
          options.workspaceIds
            .map((id) => id.trim())
            .filter((id) => Boolean(id) && id !== 'undefined' && id !== 'null'),
        ),
      ];
    }
    if (process.env.AUTHORIZED_WORKSPACE_IDS) {
      const ids = process.env.AUTHORIZED_WORKSPACE_IDS.split(',')
        .map((s) => s.trim())
        .filter((id) => Boolean(id) && id !== 'undefined' && id !== 'null');
      if (ids.length > 0) return [...new Set(ids)];
    }
    if (process.env.AUTHORIZED_WORKSPACE_ID) {
      const single = process.env.AUTHORIZED_WORKSPACE_ID.trim();
      if (single && single !== 'undefined' && single !== 'null') return [single];
    }
    if (env.WORKER_TYPE === 'cloud' || env.WORKER_TYPE === 'all') {
      try {
        const { prisma } = await import('./lib/prisma.js');
        if (prisma.workspace?.findMany) {
          const list = await prisma.workspace.findMany({ select: { id: true } });
          return list.map((w: any) => w.id).filter((id: string) => Boolean(id));
        }
      } catch (err: any) {
        this.logger.warn(`Could not discover workspaces from database: ${err.message}`);
      }
    }
    return [];
  }

  public async registerWorkspace(workspaceId: string): Promise<void> {
    if (!workspaceId || typeof workspaceId !== 'string') {
      throw new Error('Workspace ID must be a non-empty string (cannot be empty or undefined)');
    }
    const trimmed = workspaceId.trim();
    if (!trimmed || trimmed === 'undefined' || trimmed === 'null') {
      throw new Error('Workspace ID must be a non-empty string (cannot be empty or undefined)');
    }
    if (this.registeredWorkspaces.has(trimmed)) {
      return; // Already registered (idempotency guarantee)
    }

    this.registeredWorkspaces.add(trimmed);

    // Keep graph worker in sync
    try {
      await this.graphWorker.registerWorkspace(trimmed);
    } catch {
      // Continue document worker registration
    }

    if (env.NODE_ENV === 'test' && !this.forceLiveBullMQ) {
      return;
    }

    const workerType = (process.env.WORKER_TYPE as any) || env.WORKER_TYPE;
    const queueNames: string[] = [];
    if (workerType === 'local') {
      queueNames.push(getDocumentQueueName(trimmed, 'local'));
    } else if (workerType === 'cloud') {
      queueNames.push(getDocumentQueueName(trimmed, 'cloud'));
    } else {
      queueNames.push(getDocumentQueueName(trimmed, 'local'));
      queueNames.push(getDocumentQueueName(trimmed, 'cloud'));
      queueNames.push(getDocumentQueueName(trimmed));
    }

    for (const qName of queueNames) {
      if (this.bullWorkersByQueue.has(qName)) continue;

      const safeBullName = toBullQueueName(qName);
      try {
        const w = new Worker<ProcessDocumentJobPayload>(
          safeBullName,
          this.createProcessor(),
          this.workerOptions,
        );
        w.on('completed', (job: Job) => {
          this.logger.info(`Job ${job.id} completed successfully on queue "${qName}"`);
        });
        w.on('failed', (job: Job | undefined, err: Error) => {
          this.logger.error(
            `Job ${job?.id} failed on queue "${qName}": ${sanitizeErrorMessage(err.message)}`,
          );
        });
        w.on('error', (err: Error) => {
          this.logger.warn(
            `BullMQ worker connection error on queue "${qName}": ${sanitizeErrorMessage(err.message)}`,
          );
        });

        this.bullWorkersByQueue.set(qName, w);
        this.bullWorkers.push(w);
        this.logger.info(
          `BullMQ worker actively listening on queue "${qName}" (BullMQ: "${safeBullName}")`,
        );
      } catch (err: any) {
        this.logger.warn(
          `Could not register worker for queue "${qName}": ${sanitizeErrorMessage(err.message)}`,
        );
      }
    }

    this.bullWorker = this.bullWorkers[0] || null;
  }

  public async unregisterWorkspace(workspaceId: string): Promise<void> {
    if (!workspaceId) return;
    const trimmed = workspaceId.trim();
    if (!this.registeredWorkspaces.has(trimmed)) return;

    // Unregister from graph worker as well
    try {
      await this.graphWorker.unregisterWorkspace(trimmed);
    } catch {
      // Continue
    }

    const workerType = env.WORKER_TYPE;
    const queueNames = [
      getDocumentQueueName(trimmed, 'local'),
      getDocumentQueueName(trimmed, 'cloud'),
      getDocumentQueueName(trimmed),
    ];

    for (const qName of queueNames) {
      const w = this.bullWorkersByQueue.get(qName);
      if (w) {
        try {
          await w.pause(true);
          await w.close(false);
        } catch (err: any) {
          this.logger.warn(`Error closing worker for queue "${qName}": ${err.message}`);
        }
        this.bullWorkersByQueue.delete(qName);
        this.bullWorkers = this.bullWorkers.filter((worker) => worker !== w);
      }
    }

    this.registeredWorkspaces.delete(trimmed);
    this.bullWorker = this.bullWorkers[0] || null;
    this.logger.info(`Unregistered workspace "${trimmed}" queues cleanly`);
  }

  private async discoverWorkspaces(): Promise<void> {
    if (!this.isRunning) return;
    try {
      const { prisma } = await import('./lib/prisma.js');
      if (prisma.workspace?.findMany) {
        const workspaces = await prisma.workspace.findMany({ select: { id: true } });
        for (const w of workspaces) {
          if (!this.registeredWorkspaces.has(w.id)) {
            await this.registerWorkspace(w.id);
          }
        }
      }
    } catch {
      // Non-blocking discovery
    }
  }

  private createProcessor(): (job: Job<ProcessDocumentJobPayload>) => Promise<void> {
    return async (job: Job<ProcessDocumentJobPayload>) => {
      const startTime = performance.now();
      this.logger.info(`Processing job ${job.id} for document ${job.data.documentId}`);
      this.heartbeatService.recordJobActivity(job.id, job.data.documentId);
      await this.pipeline!.processDocument(job.data);
      const elapsedMs = Math.round(performance.now() - startTime);
      this.logger.info(
        `Job ${job.id} for document ${job.data.documentId} completed in ${elapsedMs}ms`,
      );
    };
  }

  public async start(options?: {
    forceLiveBullMQ?: boolean;
    workspaceIds?: string[];
  }): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('Worker is already running');
      return;
    }

    this.isRunning = true;
    this.forceLiveBullMQ = !!options?.forceLiveBullMQ;
    this.logger.info('🚀 MindVault background worker initialized', {
      concurrency: env.WORKER_CONCURRENCY,
      redisUrl: sanitizeRedisUrl(env.REDIS_URL),
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

    // Preflight Ollama verification for local inference runtime
    if (env.NODE_ENV !== 'test') {
      try {
        const ollamaCheck = await validateOllamaEnvironment({
          baseUrl: env.OLLAMA_BASE_URL,
          generationModel: env.OLLAMA_GENERATION_MODEL,
          embeddingModel: env.EMBEDDING_MODEL,
        });
        if (ollamaCheck.ready) {
          this.logger.info(
            `✅ Local Ollama inference ready at ${env.OLLAMA_BASE_URL} (models: ${ollamaCheck.installedModels.join(', ')})`,
          );
        } else if (ollamaCheck.status === 'MODEL_MISSING') {
          this.logger.warn(`⚠️ Ollama model warning: ${ollamaCheck.remediation}`);
        } else {
          this.logger.warn(
            `⚠️ Ollama endpoint warning: ${ollamaCheck.error}. ${ollamaCheck.remediation}`,
          );
        }
      } catch (err: any) {
        this.logger.warn(`⚠️ Ollama preflight check failed: ${err.message}`);
      }
    }

    // Step 1: Execute startup graph reconciliation BEFORE starting BullMQ queue consumption.
    try {
      this.logger.info('Executing startup graph reconciliation...');
      const sweepResult = await this.reconciliationService.executeStartupReconciliation();
      this.logger.info('Startup graph reconciliation completed', sweepResult);
    } catch (err: any) {
      this.logger.warn(
        `Startup graph reconciliation encountered an error: ${sanitizeErrorMessage(err.message)}. Worker proceeding safely.`,
      );
    }

    // Step 2: Start graph extraction worker runtime
    await this.graphWorker.start(options);

    // Step 3: Start background periodic reconciliation and dispatch recovery services
    this.reconciliationService.start(60000);
    this.recoveryService.start(60000);

    // Step 4: Start worker heartbeat reporting to Redis
    await this.heartbeatService.start();

    // Prepare worker options
    try {
      const redisUrl = process.env.REDIS_URL || env.REDIS_URL;
      const connectionOptions = parseRedisUrl(redisUrl, 'consumer');
      this.workerOptions = {
        concurrency: env.WORKER_CONCURRENCY,
        connection: connectionOptions as any,
        lockDuration: 60000,
        stalledInterval: 30000,
        maxStalledCount: 2,
      };

      // Resolve target workspaces
      const targetWorkspaces = await this.resolveWorkspaces(options);
      for (const wsId of targetWorkspaces) {
        await this.registerWorkspace(wsId);
      }

      // In cloud mode, periodically discover newly added workspaces at runtime
      if ((env.WORKER_TYPE === 'cloud' || env.WORKER_TYPE === 'all') && env.NODE_ENV !== 'test') {
        this.discoveryIntervalTimer = setInterval(() => void this.discoverWorkspaces(), 30000);
      }
    } catch (err: any) {
      this.logger.warn(
        `Could not connect BullMQ worker to Redis: ${sanitizeErrorMessage(err.message)}. Worker running in standby.`,
      );
    }
  }

  public async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    this.logger.info('🛑 Stopping worker service, initiating graceful drain and deferral...');

    if (this.discoveryIntervalTimer) {
      clearInterval(this.discoveryIntervalTimer);
      this.discoveryIntervalTimer = null;
    }

    // 1. Pause ingestion polling immediately across all registered workers
    const allDocWorkers =
      this.bullWorkers.length > 0 ? this.bullWorkers : this.bullWorker ? [this.bullWorker] : [];
    if (allDocWorkers.length > 0) {
      for (const w of allDocWorkers) {
        try {
          await w.pause(true);
        } catch (e: any) {
          this.logger.warn(`Error pausing document worker: ${e.message}`);
        }
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

    // 4. Close ingestion BullMQ workers
    if (allDocWorkers.length > 0) {
      for (const w of allDocWorkers) {
        try {
          await w.close(false);
        } catch (e: any) {
          this.logger.warn(`Error closing document worker: ${e.message}`);
        }
      }
      this.bullWorkers = [];
      this.bullWorkersByQueue.clear();
      this.registeredWorkspaces.clear();
      this.bullWorker = null;
    }

    // 5. Stop dispatch recovery service and await any in-flight sweep
    try {
      await this.recoveryService.stop();
    } catch (e: any) {
      this.logger.warn(`Error stopping dispatch recovery service: ${e.message}`);
    }

    // 6. Stop worker heartbeat publisher
    try {
      await this.heartbeatService.stop();
    } catch (e: any) {
      this.logger.warn(`Error stopping worker heartbeat: ${e.message}`);
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

  public getHeartbeatService(): WorkerHeartbeatService {
    return this.heartbeatService;
  }
}
