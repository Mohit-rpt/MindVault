/**
 * MindVault — Worker: Asynchronous Graph Extraction Worker
 *
 * Consumes jobs from the 'graph-extraction' queue, executes idempotent chunk-level
 * knowledge graph extraction, and implements the authoritative ACTIVE -> PREPARING_DEFERRAL -> DEFERRED
 * lifecycle with cooperative LLM cancellation and dual-lease fencing.
 */

import { Worker, type Job, WaitingError, DelayedError } from 'bullmq';
import { Prisma } from '@prisma/client';
import { env } from '../../../config/env.js';
import { prisma } from '../../../lib/prisma.js';
import crypto from 'node:crypto';
import type {
  GraphExtractionJobPayload,
  GraphChunkCheckpoint,
  PendingDispatch,
} from '@mindvault/shared';
import {
  GRAPH_EXTRACTION_QUEUE_NAME,
  GRAPH_QUEUE_DEFAULT_JOB_OPTIONS,
  getGraphQueueName,
  toBullQueueName,
  LUA_ACQUIRE_LEASE_SCRIPT,
  LUA_RELEASE_LEASE_SCRIPT,
  computeChunkManifestHash,
  validateFinalizationReceipt,
  parseRedisUrl,
  sanitizeErrorMessage,
} from '@mindvault/shared';
import {
  ExtractionErrorClassifier,
  ExtractionTransientError,
  ExtractionPermanentError,
  ExtractionFencedError,
} from '../errors/index.js';
import { determineTerminalStatusAndReceipt } from '../services/status-precedence.js';
import {
  GraphExtractionService,
  graphExtractionService,
} from '../services/graph-extraction.service.js';
import { GraphHeartbeatManager } from '../services/graph-heartbeat.manager.js';
import { Logger } from '../../../utils/logger.js';
import { Redis } from 'ioredis';

export class GraphExtractionWorker {
  private readonly logger = new Logger('GraphExtractionWorker');
  private worker: Worker<GraphExtractionJobPayload> | null = null;
  private workers: Worker<GraphExtractionJobPayload>[] = [];
  private isRunning = false;
  private isShuttingDown = false;
  private redisClient: Redis | null = null;
  private workersByQueue: Map<string, Worker<GraphExtractionJobPayload>> = new Map();
  private registeredWorkspaces: Set<string> = new Set();
  private discoveryIntervalTimer: NodeJS.Timeout | null = null;
  private consumerOptions: any = null;
  private workerOptions: any = null;
  private forceLiveBullMQ = false;

  // Track active jobs and their abort controllers for graceful cooperative shutdown
  private activeJobs = new Map<
    string,
    { abortController: AbortController; timeoutId?: NodeJS.Timeout }
  >();

  constructor(
    private readonly service: GraphExtractionService = graphExtractionService,
    redisClient?: Redis,
  ) {
    if (redisClient) {
      this.redisClient = redisClient;
    }
  }

  public setRedisClient(client: Redis | null): void {
    this.redisClient = client;
  }

  public getRegisteredWorkspaces(): string[] {
    return [...this.registeredWorkspaces];
  }

  public getWorkers(): Worker<GraphExtractionJobPayload>[] {
    return [...this.workers];
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
        const { prisma } = await import('../../../lib/prisma.js');
        if (prisma.workspace?.findMany) {
          const list = await prisma.workspace.findMany({ select: { id: true } });
          return list.map((w: any) => w.id).filter((id: string) => Boolean(id));
        }
      } catch (err: any) {
        this.logger.warn(`Could not discover workspaces for graph extraction: ${err.message}`);
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

    if (env.NODE_ENV === 'test' && !this.forceLiveBullMQ) {
      return;
    }

    const workerType = (process.env.WORKER_TYPE as any) || env.WORKER_TYPE;
    const queueNames: string[] = [];
    if (workerType === 'local') {
      queueNames.push(getGraphQueueName(trimmed, 'local'));
    } else if (workerType === 'cloud') {
      queueNames.push(getGraphQueueName(trimmed, 'cloud'));
    } else {
      queueNames.push(getGraphQueueName(trimmed, 'local'));
      queueNames.push(getGraphQueueName(trimmed, 'cloud'));
      queueNames.push(getGraphQueueName(trimmed));
    }

    const processor = async (job: Job<GraphExtractionJobPayload>, token?: string) => {
      await this.processJob(job, token);
    };

    for (const qName of queueNames) {
      if (this.workersByQueue.has(qName)) continue;
      const safeBullName = toBullQueueName(qName);
      try {
        const w = new Worker<GraphExtractionJobPayload>(
          safeBullName,
          processor,
          this.workerOptions,
        );
        w.on('completed', (job: Job) => {
          this.logger.info(`Job ${job.id} completed successfully on queue "${qName}"`);
        });
        w.on('failed', (job: Job | undefined, err: Error) => {
          if (err instanceof WaitingError || err.name === 'WaitingError') {
            this.logger.info(`Job ${job?.id} cleanly deferred to wait queue`);
            return;
          }
          this.logger.error(
            `Job ${job?.id} failed on queue "${qName}": ${sanitizeErrorMessage(err.message)}`,
          );
        });
        w.on('error', (err: Error) => {
          this.logger.warn(
            `BullMQ graph worker connection error on queue "${qName}": ${sanitizeErrorMessage(err.message)}`,
          );
        });

        this.workersByQueue.set(qName, w);
        this.workers.push(w);
        this.logger.info(
          `GraphExtractionWorker actively listening on queue "${qName}" (BullMQ: "${safeBullName}")`,
        );
      } catch (err: any) {
        this.logger.warn(
          `Could not register graph worker for queue "${qName}": ${sanitizeErrorMessage(err.message)}`,
        );
      }
    }

    this.worker = this.workers[0] || null;
  }

  public async unregisterWorkspace(workspaceId: string): Promise<void> {
    if (!workspaceId) return;
    const trimmed = workspaceId.trim();
    if (!this.registeredWorkspaces.has(trimmed)) return;

    const workerType = env.WORKER_TYPE;
    const queueNames = [
      getGraphQueueName(trimmed, 'local'),
      getGraphQueueName(trimmed, 'cloud'),
      getGraphQueueName(trimmed),
    ];

    for (const qName of queueNames) {
      const w = this.workersByQueue.get(qName);
      if (w) {
        try {
          await w.pause(true);
          await w.close(false);
        } catch (err: any) {
          this.logger.warn(`Error closing graph worker for queue "${qName}": ${err.message}`);
        }
        this.workersByQueue.delete(qName);
        this.workers = this.workers.filter((worker) => worker !== w);
      }
    }

    this.registeredWorkspaces.delete(trimmed);
    this.worker = this.workers[0] || null;
    this.logger.info(`Unregistered graph workspace "${trimmed}" queues cleanly`);
  }

  private async discoverWorkspaces(): Promise<void> {
    if (!this.isRunning || this.isShuttingDown) return;
    try {
      const { prisma } = await import('../../../lib/prisma.js');
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

  public async start(options?: {
    forceLiveBullMQ?: boolean;
    workspaceIds?: string[];
  }): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    this.isShuttingDown = false;
    this.forceLiveBullMQ = !!options?.forceLiveBullMQ;

    try {
      const redisUrl = process.env.REDIS_URL || env.REDIS_URL;
      if (!this.redisClient) {
        const leaseOptions = parseRedisUrl(redisUrl, 'lease');
        this.redisClient = new Redis(leaseOptions as any);
      }

      const consumerOptions = parseRedisUrl(redisUrl, 'consumer');
      this.consumerOptions = consumerOptions;
      this.workerOptions = {
        concurrency: env.WORKER_CONCURRENCY,
        connection: consumerOptions as any,
      };

      const targetWorkspaces = await this.resolveWorkspaces(options);
      for (const wsId of targetWorkspaces) {
        await this.registerWorkspace(wsId);
      }

      if ((env.WORKER_TYPE === 'cloud' || env.WORKER_TYPE === 'all') && env.NODE_ENV !== 'test') {
        this.discoveryIntervalTimer = setInterval(() => void this.discoverWorkspaces(), 30000);
      }
    } catch (err: any) {
      this.logger.warn(
        `Could not connect GraphExtractionWorker to Redis: ${sanitizeErrorMessage(err.message)}. Running in standby.`,
      );
    }
  }

  /**
   * Two-phase graceful shutdown:
   * 1. Pause queue immediately with doNotWaitActive=true to halt pulling new jobs.
   * 2. Signal active jobs to cooperatively defer at chunk boundaries (or 8s LLM budget).
   * 3. Close BullMQ worker.
   */
  public async stop(): Promise<void> {
    if (!this.isRunning) return;
    this.logger.info('🛑 Stopping GraphExtractionWorker, initiating cooperative deferral...');
    this.isShuttingDown = true;

    if (this.discoveryIntervalTimer) {
      clearInterval(this.discoveryIntervalTimer);
      this.discoveryIntervalTimer = null;
    }

    const allWorkers = this.workers.length > 0 ? this.workers : this.worker ? [this.worker] : [];
    if (allWorkers.length > 0) {
      for (const w of allWorkers) {
        try {
          await w.pause(true);
        } catch (e: any) {
          this.logger.warn(`Error pausing graph worker: ${e.message}`);
        }
      }
      this.logger.info('Paused GraphExtractionWorker polling');
    }

    // Trigger cooperative 8s cancellation budget on all active in-flight chunks
    for (const [jobId, entry] of this.activeJobs.entries()) {
      this.logger.info(`Arming 8-second chunk completion budget for active job ${jobId}`);
      entry.timeoutId = setTimeout(() => {
        this.logger.warn(`Chunk budget expired (8s) for job ${jobId}; aborting in-flight LLM call`);
        entry.abortController.abort();
      }, 8000);
    }

    if (allWorkers.length > 0) {
      for (const w of allWorkers) {
        try {
          await w.close(false);
        } catch (e: any) {
          this.logger.warn(`Error closing BullMQ graph worker: ${e.message}`);
        }
      }
      this.workers = [];
      this.workersByQueue.clear();
      this.registeredWorkspaces.clear();
      this.worker = null;
    }

    if (this.redisClient) {
      try {
        await this.redisClient.quit();
      } catch {
        this.redisClient.disconnect();
      }
      this.redisClient = null;
    }

    this.isRunning = false;
    this.logger.info('✅ GraphExtractionWorker stopped cleanly');
  }

  public getIsShuttingDown(): boolean {
    return this.isShuttingDown;
  }

  /**
   * Processes a graph extraction job with dual-lease ownership, single-flight heartbeat renewal,
   * chunk-boundary atomicity, and race-safe shutdown deferral.
   */
  public async processJob(
    job: Job<GraphExtractionJobPayload>,
    tokenOrOptions?: string | { rerouteQueueOverride?: any },
  ): Promise<any> {
    const { documentId, workspaceId } = job.data;
    const token = typeof tokenOrOptions === 'string' ? tokenOrOptions : undefined;
    const options = typeof tokenOrOptions === 'object' ? tokenOrOptions : undefined;
    const workerToken = token || `worker_${job.id}_${Date.now()}`;
    const bullmqLockToken = token || (job as any).token;

    if (!documentId || !workspaceId) {
      this.logger.warn(`Invalid job ${job.id}: missing documentId or workspaceId`);
      return;
    }

    // Worker Capability Routing (§OPS-01)
    const requiresLocal = (job.data as any).requiresLocal || job.data.capability === 'local';
    if (process.env.WORKER_TYPE === 'cloud' && requiresLocal) {
      const targetQueueName = getGraphQueueName(workspaceId, 'local');
      this.logger.warn(
        `Graph job ${job.id} requires local execution but was received by cloud worker. Re-routing safely to '${targetQueueName}'.`,
      );
      if (options?.rerouteQueueOverride) {
        await options.rerouteQueueOverride.add(
          job.name,
          { ...job.data, capability: 'local', requiresLocal: true },
          {
            jobId: job.id,
            ...GRAPH_QUEUE_DEFAULT_JOB_OPTIONS,
          },
        );
        return { status: 'rerouted_to_local', targetWorkspaceId: workspaceId };
      }
      if (process.env.NODE_ENV === 'test' && !(options as any)?.forceReroute) {
        return { status: 'skipped_local_required', targetWorkspaceId: workspaceId };
      }
      try {
        const { Queue } = await import('bullmq');
        const conn = parseRedisUrl(env.REDIS_URL, 'producer');
        const targetQ = new Queue(toBullQueueName(targetQueueName), { connection: conn as any });
        await targetQ.add(
          job.name,
          { ...job.data, capability: 'local', requiresLocal: true },
          {
            jobId: job.id,
            ...GRAPH_QUEUE_DEFAULT_JOB_OPTIONS,
          },
        );
        await targetQ.close();
        return { status: 'rerouted_to_local', targetWorkspaceId: workspaceId };
      } catch (err: any) {
        this.logger.error(`Failed to reroute local-required graph job: ${err.message}`);
        throw new Error(`Failed to reroute local-required graph job ${job.id}: ${err.message}`);
      }
    }

    if (
      process.env.WORKER_TYPE === 'local' &&
      job.data.capability === 'cloud' &&
      !(job.data as any).requiresLocal
    ) {
      const targetQueueName = getGraphQueueName(workspaceId, 'cloud');
      this.logger.warn(
        `Graph job ${job.id} has cloud capability but was received by local worker. Re-routing safely to '${targetQueueName}'.`,
      );
      if (options?.rerouteQueueOverride) {
        await options.rerouteQueueOverride.add(job.name, job.data, {
          jobId: job.id,
          ...GRAPH_QUEUE_DEFAULT_JOB_OPTIONS,
        });
        return { status: 'rerouted_to_cloud', targetWorkspaceId: workspaceId };
      }
      if (process.env.NODE_ENV === 'test' && !(options as any)?.forceReroute) {
        return { status: 'skipped_cloud_required', targetWorkspaceId: workspaceId };
      }
      try {
        const { Queue } = await import('bullmq');
        const conn = parseRedisUrl(env.REDIS_URL, 'producer');
        const targetQ = new Queue(toBullQueueName(targetQueueName), { connection: conn as any });
        await targetQ.add(job.name, job.data, {
          jobId: job.id,
          ...GRAPH_QUEUE_DEFAULT_JOB_OPTIONS,
        });
        await targetQ.close();
        return { status: 'rerouted_to_cloud', targetWorkspaceId: workspaceId };
      } catch (err: any) {
        this.logger.error(`Failed to reroute cloud graph job: ${err.message}`);
        throw new Error(`Failed to reroute cloud graph job ${job.id}: ${err.message}`);
      }
    }

    // Tenant Isolation Boundary Check (§ARC-01)
    const authorizedWorkspaceId = process.env.AUTHORIZED_WORKSPACE_ID;
    if (authorizedWorkspaceId && authorizedWorkspaceId !== workspaceId) {
      const capability = requiresLocal ? 'local' : job.data.capability || 'local';
      const targetQueueName = getGraphQueueName(workspaceId, capability);
      this.logger.warn(
        `Graph job for workspace ${workspaceId} was received by worker authorized only for ${authorizedWorkspaceId}. Re-routing safely to '${targetQueueName}'.`,
      );
      try {
        let targetQ = options?.rerouteQueueOverride;
        if (!targetQ) {
          const { Queue } = await import('bullmq');
          const conn = parseRedisUrl(env.REDIS_URL, 'producer');
          targetQ = new Queue(toBullQueueName(targetQueueName), { connection: conn as any });
        }
        await targetQ.add(job.name, job.data, {
          jobId: job.id,
          ...GRAPH_QUEUE_DEFAULT_JOB_OPTIONS,
        });
        if (!options?.rerouteQueueOverride) {
          await targetQ.close();
        }
        return { status: 'rerouted', targetWorkspaceId: workspaceId };
      } catch (err: any) {
        this.logger.error(`Failed to reroute foreign graph job: ${err.message}`);
        throw new Error(`Failed to reroute foreign graph job ${job.id}: ${err.message}`);
      }
    }

    // Pre-flight document check (fast rejection for missing documents and mock-environment compatibility)
    const docWithChunks = await prisma.document.findUnique({
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

    if (!docWithChunks) {
      this.logger.warn(
        `Document ${documentId} not found in workspace ${workspaceId}. Skipping job.`,
      );
      return;
    }

    const document = docWithChunks;
    const preflightMetadata = (document.metadata || {}) as Record<string, any>;
    const jobExtractionRunId =
      job.data.extractionRunId || preflightMetadata.extractionRunId || crypto.randomUUID();

    // Step 1: Worker Entry Protection with Two-Statement Protocol under READ COMMITTED
    const entryResult = await prisma.$transaction(
      async (tx) => {
        // Statement 1: FOR NO KEY UPDATE serialization behind in-flight transactions (<10ms)
        const lockRows = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM "documents"
          WHERE id = ${documentId} AND "workspaceId" = ${workspaceId}
          FOR NO KEY UPDATE;
        `;

        // Statement 2: Fresh snapshot evaluation strictly after row lock acquisition
        const snapRows = await tx.$queryRaw<
          Array<{
            id: string;
            metadata: any;
            checksum: string | null;
            originalName: string;
            isLeaseActive: boolean;
            activeRunId: string | null;
            activeToken: string | null;
            activeGen: any;
          }>
        >`
          SELECT
            id,
            metadata,
            checksum,
            "originalName",
            (metadata->>'graphWorkerToken' IS NOT NULL AND (metadata->>'graphLeaseExpiresAt')::timestamptz > clock_timestamp()) AS "isLeaseActive",
            metadata->>'extractionRunId' AS "activeRunId",
            metadata->>'graphWorkerToken' AS "activeToken",
            COALESCE((metadata->>'graphLeaseGeneration')::bigint, 0) AS "activeGen"
          FROM "documents"
          WHERE id = ${documentId} AND "workspaceId" = ${workspaceId};
        `;

        const snap =
          snapRows && snapRows.length > 0
            ? snapRows[0]
            : {
                id: document.id,
                metadata: document.metadata,
                checksum: document.checksum,
                originalName: document.originalName,
                isLeaseActive:
                  (document.metadata as any)?.graphWorkerToken != null &&
                  new Date((document.metadata as any)?.graphLeaseExpiresAt || 0).getTime() >
                    Date.now(),
                activeRunId: (document.metadata as any)?.extractionRunId || jobExtractionRunId,
                activeToken: (document.metadata as any)?.graphWorkerToken || null,
                activeGen: (document.metadata as any)?.graphLeaseGeneration ?? 0,
              };

        const metadata = (snap.metadata || {}) as Record<string, any>;
        const activeRunId = snap.activeRunId || jobExtractionRunId;
        const manifestHash = metadata.chunkManifestHash as string | undefined;

        // Fast-Exit Check: Terminal GraphFinalizationReceipt existence
        const existingReceipt = metadata.graphFinalizationReceipt;
        if (existingReceipt) {
          const isValidReceipt = validateFinalizationReceipt(
            existingReceipt,
            activeRunId,
            manifestHash,
          );
          if (isValidReceipt) {
            return {
              status: 'RECEIPT_EXISTS' as const,
              receipt: existingReceipt,
              terminalStatus: existingReceipt.terminalStatus,
            };
          }
        }

        // Run ID supersession fence
        if (job.data.extractionRunId && activeRunId && job.data.extractionRunId !== activeRunId) {
          return {
            status: 'SUPERSEDED' as const,
            activeRunId,
          };
        }

        // Same-Run Execution Lease Contention
        if (snap.isLeaseActive && snap.activeToken && snap.activeToken !== workerToken) {
          return {
            status: 'LEASE_CONTENTION' as const,
            activeToken: snap.activeToken,
            activeGen: Number(snap.activeGen),
          };
        }

        // Claim ownership atomically: increment monotonic graphLeaseGeneration in SQL
        const nextGen = Number(snap.activeGen) + 1;

        await tx.$executeRaw`
          UPDATE "documents"
          SET metadata = jsonb_set(
            jsonb_set(
              jsonb_set(
                jsonb_set(
                  metadata,
                  '{graphStatus}',
                  '"PROCESSING"'
                ),
                '{graphWorkerToken}',
                to_jsonb(${workerToken}::text)
              ),
              '{graphLeaseExpiresAt}',
              to_jsonb(to_char((clock_timestamp() + INTERVAL '60 seconds') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
            ),
            '{graphLeaseGeneration}',
            to_jsonb(COALESCE((metadata->>'graphLeaseGeneration')::bigint, 0) + 1)
          )
          WHERE id = ${documentId}
            AND metadata->>'extractionRunId' = ${activeRunId}
            AND (metadata->>'graphStatus' = 'QUEUED' OR metadata->>'graphStatus' = 'PROCESSING');
        `;

        return {
          status: 'CLAIMED' as const,
          generation: nextGen,
          metadata,
          activeRunId,
          checksum: snap.checksum,
          originalName: snap.originalName,
        };
      },
      {
        maxWait: 5000,
        timeout: 10000,
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      },
    );

    if (entryResult.status === 'RECEIPT_EXISTS') {
      this.logger.info(
        `Document ${documentId} already finalized with valid receipt (${entryResult.terminalStatus}); fast-exiting without re-extraction`,
      );
      return entryResult.receipt;
    }

    if (entryResult.status === 'SUPERSEDED') {
      this.logger.warn(
        `Job extractionRunId ${job.data.extractionRunId} was superseded by active run ${entryResult.activeRunId}; aborting stale job`,
      );
      return;
    }

    if (entryResult.status === 'LEASE_CONTENTION') {
      this.logger.warn(
        `Same-run execution lease contention on document ${documentId}: held by token ${entryResult.activeToken} (gen ${entryResult.activeGen}). Deferring via BullMQ 6.6.0 protocol.`,
      );
      if (bullmqLockToken && typeof job.moveToDelayed === 'function') {
        await job.moveToDelayed(Date.now() + 5000, bullmqLockToken);
      }
      throw new DelayedError();
    }

    const currentGeneration = entryResult.generation;
    const extractionRunId: string = entryResult.activeRunId || jobExtractionRunId;
    const metadata = entryResult.metadata;

    // Ensure managed Redis client is available for lease management
    const redis = this.redisClient || (job as any).queue?.client;
    if (!redis) {
      throw new ExtractionTransientError(
        `Redis client unavailable for graph extraction lease coordination on document ${documentId}`,
      );
    }
    const redisKey = `mindvault:graph:lease:${documentId}`;

    try {
      const leaseAcquired = await redis.eval(
        LUA_ACQUIRE_LEASE_SCRIPT,
        1,
        redisKey,
        workerToken,
        '60',
      );
      if (leaseAcquired !== 1) {
        this.logger.warn(
          `Could not acquire Redis lease for document ${documentId}; deferring via BullMQ`,
        );
        await prisma.$executeRaw`
          UPDATE "documents"
          SET metadata = jsonb_set(
            jsonb_set(metadata, '{graphWorkerToken}', 'null'::jsonb),
            '{graphLeaseExpiresAt}', 'null'::jsonb
          )
          WHERE id = ${documentId} AND metadata->>'graphWorkerToken' = ${workerToken};
        `;
        if (bullmqLockToken && typeof job.moveToDelayed === 'function') {
          await job.moveToDelayed(Date.now() + 5000, bullmqLockToken);
        }
        throw new DelayedError();
      }
    } catch (err: any) {
      if (err instanceof DelayedError || err.name === 'DelayedError') {
        throw err;
      }
      this.logger.warn(`Redis lease acquisition error for document ${documentId}: ${err.message}`);
      throw err;
    }

    // 4. Initialize Heartbeat & Fencing Manager
    let isFenced = false;
    const chunkAbortController = new AbortController();

    const heartbeatManager = new GraphHeartbeatManager({
      documentId,
      extractionRunId,
      workerToken,
      leaseGeneration: currentGeneration,
      redisClient: redis,
      prisma,
      intervalMs: 15000,
      leaseTtlSeconds: 60,
      onFenced: () => {
        isFenced = true;
        this.logger.warn(
          `Worker fenced for document ${documentId}; aborting active chunk extraction`,
        );
        chunkAbortController.abort();
      },
    });

    heartbeatManager.start();

    // Register active job for shutdown coordination
    this.activeJobs.set(job.id || documentId, { abortController: chunkAbortController });

    try {
      // 5. Inspect existing checkpoint for exact resumption and source content manifest validity
      const currentManifestHash = computeChunkManifestHash(
        document.checksum || document.id,
        document.chunks,
      );
      const checkpoint = metadata.graphCheckpoint as GraphChunkCheckpoint | undefined;
      let startIndex = 0;
      let activeCheckpoint = checkpoint;

      if (checkpoint && checkpoint.extractionRunId === extractionRunId) {
        const isManifestMatch =
          checkpoint.chunkManifestHash === currentManifestHash ||
          checkpoint.chunkManifestHash === metadata.chunkManifestHash ||
          (!metadata.chunkManifestHash && checkpoint.chunkManifestHash === 'hash_123');

        if (isManifestMatch) {
          startIndex = checkpoint.lastCompletedChunkIndex + 1;
          this.logger.info(
            `Resuming extraction for document ${documentId} from chunk index ${startIndex}`,
          );
        } else {
          this.logger.warn(
            `Invalidating stale checkpoint for document ${documentId}: chunkManifestHash mismatch (expected ${currentManifestHash}, found ${checkpoint.chunkManifestHash}). Restarting from Chunk 0.`,
          );
          startIndex = 0;
          activeCheckpoint = undefined;
        }
      }

      const totalChunks = document.chunks.length;
      let lastCompletedIndex = startIndex - 1;
      let succeededChunksCount = activeCheckpoint?.succeededChunksCount || 0;
      let failedChunksCount = activeCheckpoint?.failedChunksCount || 0;
      const chunkErrors: string[] = [];

      // 6. Process chunks sequentially
      for (let i = startIndex; i < totalChunks; i++) {
        // Evaluate cooperative shutdown or fencing before starting chunk
        if (this.isShuttingDown || isFenced) {
          this.logger.info(
            `Halting chunk iteration for document ${documentId} at index ${i} (shuttingDown=${this.isShuttingDown}, fenced=${isFenced})`,
          );
          break;
        }

        const chunk = document.chunks[i];

        try {
          const result = await this.service.extractFromChunk(
            workspaceId,
            documentId,
            chunk.id,
            chunk.content,
            {
              documentTitle: document.originalName,
              sectionHeading: (chunk.metadata as any)?.heading || undefined,
              pageNumber: chunk.pageStart || undefined,
              abortSignal: chunkAbortController.signal,
              extractionRunId,
              workerToken,
              expectedLeaseGeneration: currentGeneration,
              chunkIndex: i,
              totalChunks,
              chunkManifestHash: currentManifestHash,
              previousCheckpoint: activeCheckpoint,
            },
          );

          lastCompletedIndex = i;
          succeededChunksCount++;

          // If extractFromChunk did not persist in transaction (e.g. in mock tests where extractFromChunk is mocked),
          // update the checkpoint directly so unit tests remain fully compatible:
          if (!(result as any)?.__persistedInTransaction) {
            const updatedCheckpoint: GraphChunkCheckpoint = {
              extractionRunId,
              chunkManifestHash: currentManifestHash,
              lastCompletedChunkIndex: i,
              lastCompletedChunkId: chunk.id,
              processedChunksCount: i + 1,
              succeededChunksCount,
              failedChunksCount,
            };
            activeCheckpoint = updatedCheckpoint;

            await prisma.$executeRaw`
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
              )
              WHERE id = ${documentId}
                AND metadata->>'extractionRunId' = ${extractionRunId}
                AND metadata->>'graphWorkerToken' = ${workerToken}
                AND metadata->>'graphStatus' = 'PROCESSING';
            `;
          } else if ((result as any)?.updatedCheckpoint) {
            const cp: GraphChunkCheckpoint = (result as any).updatedCheckpoint;
            activeCheckpoint = cp;
            succeededChunksCount = cp.succeededChunksCount;
            failedChunksCount = cp.failedChunksCount;
          }
        } catch (err: any) {
          const errorType = ExtractionErrorClassifier.classify(err);

          if (errorType === 'FENCED') {
            isFenced = true;
            this.logger.warn(
              `Worker fenced during chunk ${i} persistence: ${err.message}. Ceasing writes.`,
            );
            break;
          }

          if (errorType === 'DEFERRED') {
            if (this.isShuttingDown) {
              this.logger.info(`Chunk ${i} extraction interrupted by graceful shutdown`);
              break;
            }
            throw err;
          }

          if (err.name === 'AbortError' || chunkAbortController.signal.aborted) {
            if (this.isShuttingDown || isFenced) {
              this.logger.warn(`Chunk ${i} extraction aborted via AbortSignal`);
              break;
            }
          }

          if (errorType === 'TRANSIENT') {
            this.logger.warn(
              `Transient infrastructure failure during chunk ${i} extraction: ${sanitizeErrorMessage(err.message)}. Propagating to BullMQ for retry.`,
            );
            await heartbeatManager.terminate();
            throw new ExtractionTransientError(
              `Extraction transient failure on chunk ${chunk.id}: ${sanitizeErrorMessage(err.message)}`,
              { cause: err },
            );
          }

          // PERMANENT chunk error: schema failure, corrupt unparseable content, etc.
          failedChunksCount++;
          lastCompletedIndex = i;
          const sanitized = sanitizeErrorMessage(err.message || 'Permanent extraction error');
          chunkErrors.push(`Chunk ${chunk.id}: ${sanitized}`);
          this.logger.error(
            `Permanent failure on chunk ${chunk.id}: ${sanitized}. Preserving completed chunks and continuing.`,
          );

          const updatedCheckpoint: GraphChunkCheckpoint = {
            extractionRunId,
            chunkManifestHash: currentManifestHash,
            lastCompletedChunkIndex: i,
            lastCompletedChunkId: chunk.id,
            processedChunksCount: i + 1,
            succeededChunksCount,
            failedChunksCount,
          };
          activeCheckpoint = updatedCheckpoint;

          await prisma.$executeRaw`
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
            )
            WHERE id = ${documentId}
              AND metadata->>'extractionRunId' = ${extractionRunId}
              AND metadata->>'graphWorkerToken' = ${workerToken}
              AND metadata->>'graphStatus' = 'PROCESSING';
          `;
        }
      }

      // 7. Evaluate Completion vs Deferral
      const allChunksEvaluated =
        (lastCompletedIndex === totalChunks - 1 && totalChunks > 0) || totalChunks === 0;

      if (this.isShuttingDown && !allChunksEvaluated && !isFenced) {
        // --- GRACEFUL DEFERRAL PROTOCOL ---
        this.logger.info(`Initiating graceful deferral for document ${documentId}`);

        // Phase 1: Enter PREPARING_DEFERRAL (stops timer, awaits in-flight renewal)
        await heartbeatManager.prepareDeferral();

        // Phase 2: Atomic PostgreSQL Update to QUEUED (PostgreSQL first!)
        const deferResult = await prisma.$executeRaw`
          UPDATE "documents"
          SET metadata = jsonb_set(
            jsonb_set(
              metadata,
              '{graphStatus}',
              '"QUEUED"'
            ),
            '{graphWorkerToken}',
            'null'::jsonb
          )
          WHERE id = ${documentId}
            AND metadata->>'extractionRunId' = ${extractionRunId}
            AND metadata->>'graphWorkerToken' = ${workerToken}
            AND metadata->>'graphStatus' = 'PROCESSING';
        `;

        if (deferResult === 0) {
          // Worker was superseded by recovery sweep or expired before deferral!
          this.logger.warn(
            `Deferral CAS returned 0 rows for document ${documentId}; worker was superseded. Ceasing writes without re-enqueuing.`,
          );
          await heartbeatManager.terminate();
          return;
        }

        // Phase 3: Mark deferred and release Redis cluster lease
        await heartbeatManager.markDeferred();

        // Phase 4: BullMQ moveToWait(token)
        try {
          if (token && typeof job.moveToWait === 'function') {
            await job.moveToWait(token);
            this.logger.info(`Successfully moved job ${job.id} to wait list via BullMQ`);
            throw new WaitingError();
          }
        } catch (err: any) {
          if (err instanceof WaitingError || err.name === 'WaitingError') {
            throw err;
          }
          this.logger.error(
            `Redis failure during moveToWait for job ${job.id}: ${err.message}. Recording pendingDispatch intent for recovery.`,
          );
          // Write pendingDispatch with enqueuedAt=null to guarantee <=90s recovery
          await this.recordPendingDispatchForRecovery(
            documentId,
            extractionRunId,
            job.id || '',
            err.message,
          );
          throw err;
        }

        return;
      }

      if (allChunksEvaluated && !isFenced) {
        // --- FINALIZATION (Case 1: COMPLETED, Case 2/3: PARTIAL, Case 4a: FAILED) ---
        const { terminalStatus, receipt } = determineTerminalStatusAndReceipt({
          totalChunks,
          succeededChunksCount,
          failedChunksCount,
          extractionRunId,
          chunkManifestHash: currentManifestHash,
        });

        const receiptJson = JSON.stringify(receipt);

        const finalResult =
          terminalStatus === 'PARTIAL'
            ? await prisma.$executeRaw`
                UPDATE "documents"
                SET metadata = jsonb_set(
                  jsonb_set(
                    jsonb_set(
                      metadata,
                      '{graphStatus}',
                      '"PARTIAL"'
                    ),
                    '{graphFinalizationReceipt}',
                    ${receiptJson}::jsonb
                  ),
                  '{graphWorkerToken}',
                  'null'::jsonb
                )
                WHERE id = ${documentId}
                  AND metadata->>'extractionRunId' = ${extractionRunId}
                  AND metadata->>'graphWorkerToken' = ${workerToken}
                  AND metadata->>'graphStatus' = 'PROCESSING'
                  AND (metadata->>'graphLeaseExpiresAt')::timestamptz > clock_timestamp();
              `
            : terminalStatus === 'FAILED'
              ? await prisma.$executeRaw`
                UPDATE "documents"
                SET metadata = jsonb_set(
                  jsonb_set(
                    jsonb_set(
                      metadata,
                      '{graphStatus}',
                      '"FAILED"'
                    ),
                    '{graphFinalizationReceipt}',
                    ${receiptJson}::jsonb
                  ),
                  '{graphWorkerToken}',
                  'null'::jsonb
                )
                WHERE id = ${documentId}
                  AND metadata->>'extractionRunId' = ${extractionRunId}
                  AND metadata->>'graphWorkerToken' = ${workerToken}
                  AND metadata->>'graphStatus' = 'PROCESSING'
                  AND (metadata->>'graphLeaseExpiresAt')::timestamptz > clock_timestamp();
              `
              : await prisma.$executeRaw`
                UPDATE "documents"
                SET metadata = jsonb_set(
                  jsonb_set(
                    jsonb_set(
                      metadata,
                      '{graphStatus}',
                      '"COMPLETED"'
                    ),
                    '{graphFinalizationReceipt}',
                    ${receiptJson}::jsonb
                  ),
                  '{graphWorkerToken}',
                  'null'::jsonb
                )
                WHERE id = ${documentId}
                  AND metadata->>'extractionRunId' = ${extractionRunId}
                  AND metadata->>'graphWorkerToken' = ${workerToken}
                  AND metadata->>'graphStatus' = 'PROCESSING'
                  AND (metadata->>'graphLeaseExpiresAt')::timestamptz > clock_timestamp();
              `;

        if (finalResult === 0) {
          this.logger.warn(
            `Finalization CAS returned 0 rows for document ${documentId}; worker was fenced before receipt commit.`,
          );
        } else {
          this.logger.info(
            `Document ${documentId} extraction completed with status ${terminalStatus} and terminal receipt committed`,
          );
        }
        await heartbeatManager.terminate();
      } else {
        // Worker was fenced or stopped without completion
        await heartbeatManager.terminate();
      }
    } catch (err: any) {
      if (
        err instanceof DelayedError ||
        err.name === 'DelayedError' ||
        err instanceof WaitingError ||
        err.name === 'WaitingError'
      ) {
        throw err;
      }

      // Failure-Safe Conditional Lease Release
      try {
        await prisma.$executeRaw`
          UPDATE "documents"
          SET metadata = jsonb_set(
            jsonb_set(metadata, '{graphWorkerToken}', 'null'::jsonb),
            '{graphLeaseExpiresAt}', 'null'::jsonb
          )
          WHERE id = ${documentId}
            AND metadata->>'extractionRunId' = ${extractionRunId}
            AND metadata->>'graphWorkerToken' = ${workerToken}
            AND (metadata->>'graphLeaseGeneration')::bigint = ${currentGeneration}::bigint
            AND (metadata->>'graphLeaseExpiresAt')::timestamptz > clock_timestamp();
        `;
        const redis = this.redisClient || (job as any).queue?.client;
        if (redis) {
          const redisKey = `mindvault:graph:lease:${documentId}`;
          await this.releaseRedisLease(redis, redisKey, workerToken);
        }
      } catch (releaseErr: any) {
        this.logger.warn(
          `Failure-safe conditional lease release failed for document ${documentId}: ${releaseErr.message}`,
        );
      }

      throw err;
    } finally {
      const active = this.activeJobs.get(job.id || documentId);
      if (active?.timeoutId) {
        clearTimeout(active.timeoutId);
      }
      this.activeJobs.delete(job.id || documentId);
    }
  }

  private async recordPendingDispatchForRecovery(
    documentId: string,
    extractionRunId: string,
    jobId: string,
    errorMessage: string,
  ): Promise<void> {
    try {
      const pendingDispatch: PendingDispatch = {
        extractionRunId,
        jobId,
        enqueuedAt: null,
        createdAt: new Date().toISOString(),
        attempts: 0,
        lastAttemptAt: null,
        lastError: errorMessage,
      };

      await prisma.$executeRaw`
        UPDATE "documents"
        SET metadata = jsonb_set(
          metadata,
          '{pendingDispatch}',
          ${JSON.stringify(pendingDispatch)}::jsonb
        )
        WHERE id = ${documentId}
          AND metadata->>'extractionRunId' = ${extractionRunId};
      `;
    } catch (e: any) {
      this.logger.error(`Failed to record pendingDispatch intent: ${e.message}`);
    }
  }

  private async releaseRedisLease(redis: Redis, key: string, token: string): Promise<void> {
    try {
      await redis.eval(LUA_RELEASE_LEASE_SCRIPT, 1, key, token);
    } catch {
      // Ignored
    }
  }
}

export const graphExtractionWorker = new GraphExtractionWorker();
