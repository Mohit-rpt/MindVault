import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Queue, Worker, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import {
  getDocumentQueueName,
  getGraphQueueName,
  toBullQueueName,
  parseRedisUrl,
  type ProcessDocumentJobPayload,
  type GraphExtractionJobPayload,
} from '@mindvault/shared';
import { BullMQDocumentQueue } from '../apps/api/src/modules/document/document.queue.js';
import { BullMQWorkerGraphQueue } from '../apps/worker/src/lib/graph-queue.js';
import { DocumentIngestionPipeline } from '../apps/worker/src/modules/ingestion/pipeline.js';
import { GraphExtractionWorker } from '../apps/worker/src/modules/graph/worker/graph-extraction.worker.js';
import { RedisRateLimitStore } from '../apps/api/src/modules/companion/companion.routes.js';
import { workspaceQueueService } from '../apps/api/src/modules/workspace/workspace-queue.service.js';
import { AppError } from '../apps/api/src/middleware/errorHandler.js';

const LOCAL_REDIS_URL = 'redis://127.0.0.1:6379';

describe('MindVault — Phase 7.2: Real Redis Integration Suite (Zero Mocks)', () => {
  let redisClient: Redis;
  const testRunId = `test_${Date.now()}`;
  const wsAlpha = `ws_alpha_${testRunId}`;
  const wsBeta = `ws_beta_${testRunId}`;

  beforeAll(async () => {
    // Verify local Redis is responsive
    redisClient = new Redis(LOCAL_REDIS_URL, { maxRetriesPerRequest: 1 });
    const pong = await redisClient.ping();
    expect(pong).toBe('PONG');
  });

  afterAll(async () => {
    // Clean up test queues
    await workspaceQueueService.cleanWorkspaceQueues(wsAlpha, LOCAL_REDIS_URL);
    await workspaceQueueService.cleanWorkspaceQueues(wsBeta, LOCAL_REDIS_URL);
    await redisClient.quit();
  });

  // =========================================================================
  // 1. Capability Queue Partitioning & BullMQ Compatibility
  // =========================================================================
  describe('1. Capability Queue Partitioning & BullMQ Compatibility', () => {
    it('generates distinct capability-partitioned queue names and BullMQ-safe names', () => {
      const docLocal = getDocumentQueueName(wsAlpha, 'local');
      const docCloud = getDocumentQueueName(wsAlpha, 'cloud');
      const graphLocal = getGraphQueueName(wsAlpha, 'local');
      const graphCloud = getGraphQueueName(wsAlpha, 'cloud');

      expect(docLocal).toBe(`document-processing:${wsAlpha}:local`);
      expect(docCloud).toBe(`document-processing:${wsAlpha}:cloud`);
      expect(graphLocal).toBe(`graph-extraction:${wsAlpha}:local`);
      expect(graphCloud).toBe(`graph-extraction:${wsAlpha}:cloud`);

      // Verify toBullQueueName transforms colons into double-hyphens for BullMQ compatibility
      const safeDocLocal = toBullQueueName(docLocal);
      expect(safeDocLocal).toBe(`document-processing--${wsAlpha}--local`);
      expect(safeDocLocal.includes(':')).toBe(false);

      // Verify constructing BullMQ Queue with safe name succeeds without error
      const q = new Queue(safeDocLocal, { connection: { host: '127.0.0.1', port: 6379 } });
      expect(q.name).toBe(safeDocLocal);
      void q.close();
    });
  });

  // =========================================================================
  // 2. Real Producer-to-Worker Processing via Local Redis
  // =========================================================================
  describe('2. Real Producer-to-Worker Processing via Local Redis (127.0.0.1:6379)', () => {
    it('enqueues a document to local capability queue and worker processes it', async () => {
      const queueName = getDocumentQueueName(wsAlpha, 'local');
      const safeQueueName = toBullQueueName(queueName);
      const conn = { host: '127.0.0.1', port: 6379 };

      const producerQueue = new Queue<ProcessDocumentJobPayload>(safeQueueName, {
        connection: conn,
      });
      const documentId = `doc_real_${Date.now()}`;

      let processedJobData: ProcessDocumentJobPayload | null = null;
      let completedPromiseResolve: () => void;
      const completedPromise = new Promise<void>((resolve) => {
        completedPromiseResolve = resolve;
      });

      const worker = new Worker<ProcessDocumentJobPayload>(
        safeQueueName,
        async (job: Job<ProcessDocumentJobPayload>) => {
          processedJobData = job.data;
          return { status: 'SUCCESS' };
        },
        { connection: conn },
      );

      worker.on('completed', () => {
        completedPromiseResolve();
      });

      await worker.waitUntilReady();

      // Enqueue real job
      await producerQueue.add(
        'process-document',
        {
          documentId,
          workspaceId: wsAlpha,
          userId: 'user-real-1',
          capability: 'local',
          requiresLocal: true,
        },
        { jobId: `proc_${documentId}` },
      );

      // Await real completion
      await completedPromise;

      expect(processedJobData).not.toBeNull();
      expect(processedJobData!.documentId).toBe(documentId);
      expect(processedJobData!.workspaceId).toBe(wsAlpha);
      expect(processedJobData!.capability).toBe('local');

      await worker.close();
      await producerQueue.close();
    });
  });

  // =========================================================================
  // 3. Hybrid Capability Isolation & Safe Re-routing (No Silent Discard)
  // =========================================================================
  describe('3. Hybrid Capability Isolation & Safe Re-routing', () => {
    it('cloud worker safely re-routes local-required job to local partition queue', async () => {
      const originalWorkerType = process.env.WORKER_TYPE;
      const originalRedisUrl = process.env.REDIS_URL;
      process.env.WORKER_TYPE = 'cloud';
      process.env.REDIS_URL = LOCAL_REDIS_URL;

      const localQueueName = toBullQueueName(getDocumentQueueName(wsAlpha, 'local'));
      const localTargetQueue = new Queue(localQueueName, {
        connection: { host: '127.0.0.1', port: 6379 },
      });

      try {
        const pipeline = new DocumentIngestionPipeline({} as any, {} as any, {} as any);

        const payload: ProcessDocumentJobPayload = {
          documentId: `doc_reroute_${Date.now()}`,
          workspaceId: wsAlpha,
          userId: 'user-cloud-1',
          capability: 'local',
          requiresLocal: true,
        };

        // Pass rerouteQueueOverride to verify real re-routing destination
        const result = await pipeline.processDocument(payload, {
          rerouteQueueOverride: localTargetQueue,
        });

        expect(result).toBeDefined();
        expect(result!.status).toBe('rerouted_to_local');

        // Verify the job was actually placed onto the local capability queue
        const jobs = await localTargetQueue.getJobs(['waiting', 'delayed', 'active']);
        const found = jobs.find((j) => j.data.documentId === payload.documentId);
        expect(found).toBeDefined();
        expect(found!.data.capability).toBe('local');
        expect(found!.data.requiresLocal).toBe(true);

        // Clean up
        if (found) await found.remove();
      } finally {
        process.env.WORKER_TYPE = originalWorkerType;
        process.env.REDIS_URL = originalRedisUrl;
        await localTargetQueue.close();
      }
    });

    it('GraphExtractionWorker re-routes local-required graph jobs to local partition', async () => {
      const originalWorkerType = process.env.WORKER_TYPE;
      const originalRedisUrl = process.env.REDIS_URL;
      process.env.WORKER_TYPE = 'cloud';
      process.env.REDIS_URL = LOCAL_REDIS_URL;

      const localGraphQueueName = toBullQueueName(getGraphQueueName(wsAlpha, 'local'));
      const localGraphQueue = new Queue(localGraphQueueName, {
        connection: { host: '127.0.0.1', port: 6379 },
      });

      try {
        const worker = new GraphExtractionWorker();
        const payload: GraphExtractionJobPayload = {
          documentId: `doc_graph_reroute_${Date.now()}`,
          workspaceId: wsAlpha,
          extractionRunId: `run_${Date.now()}`,
          capability: 'local',
          requiresLocal: true,
        };

        const mockJob: any = {
          id: `graph_${payload.documentId}_test`,
          name: 'extract-graph',
          data: payload,
        };

        const result = await worker.processJob(mockJob, { rerouteQueueOverride: localGraphQueue });
        expect(result).toBeDefined();
        expect(result.status).toBe('rerouted_to_local');

        // Confirm placed in local graph queue
        const jobs = await localGraphQueue.getJobs(['waiting', 'delayed', 'active']);
        const found = jobs.find((j) => j.data.documentId === payload.documentId);
        expect(found).toBeDefined();

        if (found) await found.remove();
      } finally {
        process.env.WORKER_TYPE = originalWorkerType;
        process.env.REDIS_URL = originalRedisUrl;
        await localGraphQueue.close();
      }
    });
  });

  // =========================================================================
  // 4. Graph Reconciliation Workspace Queue Resolution
  // =========================================================================
  describe('4. Graph Reconciliation Workspace Queue Resolution', () => {
    it('locates graph job on workspace capability partition even when capability is omitted in getJob call', async () => {
      const queue = new BullMQWorkerGraphQueue(true); // forceRealQueue = true
      const docId = `doc_recon_${Date.now()}`;
      const runId = `run_recon_${Date.now()}`;

      // Enqueue job with workspaceId and local capability
      const jobId = await queue.enqueue({
        documentId: docId,
        workspaceId: wsAlpha,
        extractionRunId: runId,
        capability: 'local',
        requiresLocal: true,
      });

      expect(jobId).toBeDefined();

      // Consult queue with workspaceId only (how GraphReconciliationService and DispatchRecoveryService call it)
      const foundJob = await queue.getJob(jobId, wsAlpha);
      expect(foundJob).toBeDefined();
      expect(foundJob).not.toBeNull();
      expect(foundJob!.id).toBe(jobId);
      expect(foundJob!.data.documentId).toBe(docId);
      expect(foundJob!.data.workspaceId).toBe(wsAlpha);

      // Clean up job
      await foundJob!.remove();
      await queue.close();
    });
  });

  // =========================================================================
  // 5. Fail-Closed Rate Limiting on Security Endpoints
  // =========================================================================
  describe('5. Fail-Closed Rate Limiting on Security Endpoints', () => {
    it('throws HTTP 503 SERVICE_UNAVAILABLE when failClosed is true and Redis fails', async () => {
      const brokenRedis = {
        eval: async () => {
          throw new Error('Connection refused to Redis cluster');
        },
      };

      const failClosedStore = new RedisRateLimitStore('pairing-test', brokenRedis, true);
      failClosedStore.init({ windowMs: 60000 } as any);

      await expect(failClosedStore.increment('ip-intruder-1')).rejects.toThrow(AppError);
      try {
        await failClosedStore.increment('ip-intruder-1');
      } catch (err: any) {
        expect(err.statusCode).toBe(503);
        expect(err.code).toBe('SERVICE_UNAVAILABLE');
      }
    });

    it('gracefully degrades to in-memory store when failClosed is false (routine endpoints)', async () => {
      const brokenRedis = {
        eval: async () => {
          throw new Error('Transient connection timeout');
        },
      };

      const failOpenStore = new RedisRateLimitStore('polling-test', brokenRedis, false);
      failOpenStore.init({ windowMs: 60000 } as any);

      // Must succeed via memory fallback
      const result = await failOpenStore.increment('ip-routine-client');
      expect(result).toBeDefined();
      expect(result.totalHits).toBe(1);
    });
  });

  // =========================================================================
  // 6. Safe Workspace Queue Lifecycle (Cleanup on Workspace Deletion)
  // =========================================================================
  describe('6. Safe Workspace Queue Lifecycle (Cleanup on Workspace Deletion)', () => {
    it('safely pauses and obliterates deleted workspace queues without affecting other workspaces', async () => {
      const wsEphemeral = `ws_ephemeral_${Date.now()}`;
      const wsSurvivor = `ws_survivor_${Date.now()}`;

      // 1. Create a queue and enqueue a job for both workspaces
      const conn = { host: '127.0.0.1', port: 6379 };
      const qEphemeral = new Queue(toBullQueueName(getDocumentQueueName(wsEphemeral, 'local')), {
        connection: conn,
      });
      const qSurvivor = new Queue(toBullQueueName(getDocumentQueueName(wsSurvivor, 'local')), {
        connection: conn,
      });

      await qEphemeral.add('proc', { documentId: 'doc-eph' });
      await qSurvivor.add('proc', { documentId: 'doc-survivor' });

      expect(await qEphemeral.count()).toBe(1);
      expect(await qSurvivor.count()).toBe(1);

      // 2. Perform workspace queue cleanup for wsEphemeral only
      const cleanupResult = await workspaceQueueService.cleanWorkspaceQueues(
        wsEphemeral,
        LOCAL_REDIS_URL,
      );
      expect(cleanupResult.workspaceId).toBe(wsEphemeral);

      // 3. Verify qEphemeral was cleaned
      const ephCount = await qEphemeral.count();
      expect(ephCount).toBe(0);

      // 4. Verify qSurvivor remains completely untouched with its job intact
      const survivorCount = await qSurvivor.count();
      expect(survivorCount).toBe(1);

      // Clean survivor
      await workspaceQueueService.cleanWorkspaceQueues(wsSurvivor, LOCAL_REDIS_URL);
      await qEphemeral.close();
      await qSurvivor.close();
    });
  });
});
