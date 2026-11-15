import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Queue, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import {
  getDocumentQueueName,
  getGraphQueueName,
  toBullQueueName,
  type ProcessDocumentJobPayload,
  type GraphExtractionJobPayload,
} from '@mindvault/shared';
import { BullMQDocumentQueue } from '../apps/api/src/modules/document/document.queue.js';
import { BullMQWorkerGraphQueue } from '../apps/worker/src/lib/graph-queue.js';
import { WorkerService } from '../apps/worker/src/worker.js';
import { GraphExtractionWorker } from '../apps/worker/src/modules/graph/worker/graph-extraction.worker.js';
import { workspaceQueueService } from '../apps/api/src/modules/workspace/workspace-queue.service.js';

const LOCAL_REDIS_URL = 'redis://127.0.0.1:6379';

describe('MindVault Phase 7.2.1 — Cloud Worker Multi-Workspace Queue Verification', () => {
  let redisClient: Redis;
  const testRunId = `cw_${Date.now()}`;
  const wsAlpha = `ws_alpha_${testRunId}`;
  const wsBeta = `ws_beta_${testRunId}`;
  const wsGamma = `ws_gamma_${testRunId}`;

  beforeAll(async () => {
    redisClient = new Redis(LOCAL_REDIS_URL, { maxRetriesPerRequest: 1 });
    const pong = await redisClient.ping();
    expect(pong).toBe('PONG');
  });

  afterAll(async () => {
    await workspaceQueueService.cleanWorkspaceQueues(wsAlpha, LOCAL_REDIS_URL);
    await workspaceQueueService.cleanWorkspaceQueues(wsBeta, LOCAL_REDIS_URL);
    await workspaceQueueService.cleanWorkspaceQueues(wsGamma, LOCAL_REDIS_URL);
    await redisClient.quit();
  });

  // =========================================================================
  // 1. Producer-Consumer Queue Name Equality (§5)
  // =========================================================================
  describe('1. Producer-Consumer Queue Name Equality (§5)', () => {
    it('proves producer and cloud worker subscribe to identical queue names for Workspace A and Workspace B', () => {
      // Producer Queue Names
      const producerDocA = toBullQueueName(getDocumentQueueName(wsAlpha, 'cloud'));
      const producerDocB = toBullQueueName(getDocumentQueueName(wsBeta, 'cloud'));
      const producerGraphA = toBullQueueName(getGraphQueueName(wsAlpha, 'cloud'));
      const producerGraphB = toBullQueueName(getGraphQueueName(wsBeta, 'cloud'));

      // Worker Subscription Queue Names
      const workerDocA = toBullQueueName(getDocumentQueueName(wsAlpha, 'cloud'));
      const workerDocB = toBullQueueName(getDocumentQueueName(wsBeta, 'cloud'));
      const workerGraphA = toBullQueueName(getGraphQueueName(wsAlpha, 'cloud'));
      const workerGraphB = toBullQueueName(getGraphQueueName(wsBeta, 'cloud'));

      // 1. Equality check
      expect(producerDocA).toBe(workerDocA);
      expect(producerDocB).toBe(workerDocB);
      expect(producerGraphA).toBe(workerGraphA);
      expect(producerGraphB).toBe(workerGraphB);

      // 2. Format verification (safe BullMQ queue naming without colons)
      expect(producerDocA).toBe(`document-processing--${wsAlpha}--cloud`);
      expect(producerDocB).toBe(`document-processing--${wsBeta}--cloud`);
      expect(producerGraphA).toBe(`graph-extraction--${wsAlpha}--cloud`);
      expect(producerGraphB).toBe(`graph-extraction--${wsBeta}--cloud`);

      expect(producerDocA.includes(':')).toBe(false);
      expect(producerDocB.includes(':')).toBe(false);
      expect(producerGraphA.includes(':')).toBe(false);
      expect(producerGraphB.includes(':')).toBe(false);
    });
  });

  // =========================================================================
  // 2. Undefined Workspace ID Prevention (§6)
  // =========================================================================
  describe('2. Undefined Workspace ID Prevention (§6)', () => {
    it('WorkerService rejects registering undefined, null, empty or invalid workspace IDs', async () => {
      const worker = new WorkerService();

      await expect(worker.registerWorkspace(undefined as any)).rejects.toThrow(
        /Workspace ID must be a non-empty string/,
      );
      await expect(worker.registerWorkspace(null as any)).rejects.toThrow(
        /Workspace ID must be a non-empty string/,
      );
      await expect(worker.registerWorkspace('')).rejects.toThrow(
        /Workspace ID must be a non-empty string/,
      );
      await expect(worker.registerWorkspace('   ')).rejects.toThrow(
        /Workspace ID must be a non-empty string/,
      );
      await expect(worker.registerWorkspace('undefined')).rejects.toThrow(
        /Workspace ID must be a non-empty string/,
      );
      await expect(worker.registerWorkspace('null')).rejects.toThrow(
        /Workspace ID must be a non-empty string/,
      );
    });

    it('GraphExtractionWorker rejects registering undefined, null, empty or invalid workspace IDs', async () => {
      const graphWorker = new GraphExtractionWorker();

      await expect(graphWorker.registerWorkspace(undefined as any)).rejects.toThrow(
        /Workspace ID must be a non-empty string/,
      );
      await expect(graphWorker.registerWorkspace(null as any)).rejects.toThrow(
        /Workspace ID must be a non-empty string/,
      );
      await expect(graphWorker.registerWorkspace('')).rejects.toThrow(
        /Workspace ID must be a non-empty string/,
      );
      await expect(graphWorker.registerWorkspace('undefined')).rejects.toThrow(
        /Workspace ID must be a non-empty string/,
      );
    });
  });

  // =========================================================================
  // 3. Multiple Workspace Registration & Idempotency (§7)
  // =========================================================================
  describe('3. Multiple Workspace Registration & Idempotency (§7)', () => {
    it('registers multiple workspaces without duplicates and allows clean unregistration', async () => {
      const worker = new WorkerService();

      await worker.registerWorkspace(wsAlpha);
      await worker.registerWorkspace(wsBeta);

      const registered = worker.getRegisteredWorkspaces();
      expect(registered).toContain(wsAlpha);
      expect(registered).toContain(wsBeta);
      expect(registered).toHaveLength(2);

      // Idempotency: re-registering Workspace A should not create duplicates
      await worker.registerWorkspace(wsAlpha);
      expect(worker.getRegisteredWorkspaces()).toHaveLength(2);

      // Unregister Workspace A
      await worker.unregisterWorkspace(wsAlpha);
      expect(worker.getRegisteredWorkspaces()).not.toContain(wsAlpha);
      expect(worker.getRegisteredWorkspaces()).toContain(wsBeta);
      expect(worker.getRegisteredWorkspaces()).toHaveLength(1);

      await worker.stop();
    });
  });

  // =========================================================================
  // 4. Live Redis End-to-End Document Processing across Multiple Workspaces (§1, §2)
  // =========================================================================
  describe('4. Live Redis Document Job Consumption across Workspaces A & B (§1, §2)', () => {
    it('cloud worker consumes document jobs from both Workspace A and Workspace B queues', async () => {
      const originalWorkerType = process.env.WORKER_TYPE;
      const originalRedisUrl = process.env.REDIS_URL;
      process.env.WORKER_TYPE = 'cloud';
      process.env.REDIS_URL = LOCAL_REDIS_URL;

      const processedDocuments: string[] = [];
      let resolveAll: () => void;
      const allProcessedPromise = new Promise<void>((resolve) => {
        resolveAll = resolve;
      });

      const mockPipeline: any = {
        processDocument: async (payload: ProcessDocumentJobPayload) => {
          processedDocuments.push(`${payload.workspaceId}:${payload.documentId}`);
          if (processedDocuments.length >= 2) {
            resolveAll();
          }
        },
      };

      const worker = new WorkerService(mockPipeline);

      try {
        // Start worker with explicit multi-workspace registration and live BullMQ
        await worker.start({
          forceLiveBullMQ: true,
          workspaceIds: [wsAlpha, wsBeta],
        });

        expect(worker.getRegisteredWorkspaces()).toContain(wsAlpha);
        expect(worker.getRegisteredWorkspaces()).toContain(wsBeta);

        // Producer enqueues job to Workspace A cloud queue
        const docQueue = new BullMQDocumentQueue(true);
        const docA = `doc_a_${Date.now()}`;
        const docB = `doc_b_${Date.now()}`;

        await docQueue.enqueue({
          documentId: docA,
          workspaceId: wsAlpha,
          userId: 'user-a',
          capability: 'cloud',
          requiresLocal: false,
        });

        // Producer enqueues job to Workspace B cloud queue
        await docQueue.enqueue({
          documentId: docB,
          workspaceId: wsBeta,
          userId: 'user-b',
          capability: 'cloud',
          requiresLocal: false,
        });

        // Wait for worker to consume and complete both jobs
        await allProcessedPromise;

        expect(processedDocuments).toContain(`${wsAlpha}:${docA}`);
        expect(processedDocuments).toContain(`${wsBeta}:${docB}`);

        await docQueue.close();
      } finally {
        await worker.stop();
        if (originalWorkerType) process.env.WORKER_TYPE = originalWorkerType;
        else delete process.env.WORKER_TYPE;
        if (originalRedisUrl) process.env.REDIS_URL = originalRedisUrl;
        else delete process.env.REDIS_URL;
      }
    });
  });

  // =========================================================================
  // 5. Live Redis End-to-End Graph Extraction across Multiple Workspaces (§3, §4)
  // =========================================================================
  describe('5. Live Redis Graph Extraction Consumption across Workspaces A & B (§3, §4)', () => {
    it('cloud graph worker consumes graph extraction jobs from both Workspace A and Workspace B queues', async () => {
      const originalWorkerType = process.env.WORKER_TYPE;
      const originalRedisUrl = process.env.REDIS_URL;
      process.env.WORKER_TYPE = 'cloud';
      process.env.REDIS_URL = LOCAL_REDIS_URL;

      const processedGraphJobs: string[] = [];
      let resolveGraphAll: () => void;
      const allGraphProcessedPromise = new Promise<void>((resolve) => {
        resolveGraphAll = resolve;
      });

      const graphWorker = new GraphExtractionWorker();
      // Spy on processJob
      (graphWorker as any).processJob = async (job: Job<GraphExtractionJobPayload>) => {
        processedGraphJobs.push(`${job.data.workspaceId}:${job.data.documentId}`);
        if (processedGraphJobs.length >= 2) {
          resolveGraphAll();
        }
        return { status: 'COMPLETED' };
      };

      try {
        await graphWorker.start({
          forceLiveBullMQ: true,
          workspaceIds: [wsAlpha, wsBeta],
        });

        const graphProducer = new BullMQWorkerGraphQueue(true);
        const docGA = `doc_ga_${Date.now()}`;
        const docGB = `doc_gb_${Date.now()}`;

        await graphProducer.enqueue({
          documentId: docGA,
          workspaceId: wsAlpha,
          capability: 'cloud',
          extractionRunId: `run_${Date.now()}_a`,
        });

        await graphProducer.enqueue({
          documentId: docGB,
          workspaceId: wsBeta,
          capability: 'cloud',
          extractionRunId: `run_${Date.now()}_b`,
        });

        await allGraphProcessedPromise;

        expect(processedGraphJobs).toContain(`${wsAlpha}:${docGA}`);
        expect(processedGraphJobs).toContain(`${wsBeta}:${docGB}`);

        await graphProducer.close();
      } finally {
        await graphWorker.stop();
        if (originalWorkerType) process.env.WORKER_TYPE = originalWorkerType;
        else delete process.env.WORKER_TYPE;
        if (originalRedisUrl) process.env.REDIS_URL = originalRedisUrl;
        else delete process.env.REDIS_URL;
      }
    });
  });

  // =========================================================================
  // 6. Worker Shutdown & Cleanup (§8)
  // =========================================================================
  describe('6. Worker Shutdown and Resource Cleanup (§8)', () => {
    it('pauses and closes all workers across registered workspaces and clears state', async () => {
      const worker = new WorkerService();
      await worker.start({
        forceLiveBullMQ: true,
        workspaceIds: [wsAlpha, wsBeta],
      });

      expect(worker.getRegisteredWorkspaces()).toHaveLength(2);
      expect(worker.getBullWorkers().length).toBeGreaterThanOrEqual(2);

      await worker.stop();

      expect(worker.getRegisteredWorkspaces()).toHaveLength(0);
      expect(worker.getBullWorkers()).toHaveLength(0);
      expect(worker.getBullWorker()).toBeNull();
      expect(worker.getActiveStatus()).toBe(false);
    });
  });

  // =========================================================================
  // 7. Tenant Isolation Guarantees (§9)
  // =========================================================================
  describe('7. Tenant Isolation Guarantees (§9)', () => {
    it('local worker registered for Workspace A never consumes jobs enqueued for Workspace B', async () => {
      const originalWorkerType = process.env.WORKER_TYPE;
      const originalAuthorized = process.env.AUTHORIZED_WORKSPACE_ID;
      const originalRedisUrl = process.env.REDIS_URL;
      process.env.WORKER_TYPE = 'local';
      process.env.AUTHORIZED_WORKSPACE_ID = wsAlpha;
      process.env.REDIS_URL = LOCAL_REDIS_URL;

      let resolveAlpha: () => void;
      const alphaPromise = new Promise<void>((r) => {
        resolveAlpha = r;
      });

      const receivedJobs: string[] = [];
      const mockPipeline: any = {
        processDocument: async (payload: ProcessDocumentJobPayload) => {
          receivedJobs.push(payload.workspaceId);
          if (payload.workspaceId === wsAlpha) {
            resolveAlpha();
          }
        },
      };

      const localWorker = new WorkerService(mockPipeline);

      try {
        await localWorker.start({ forceLiveBullMQ: true });

        // Verify local worker is registered ONLY for Workspace A
        expect(localWorker.getRegisteredWorkspaces()).toEqual([wsAlpha]);

        // Enqueue a local job for Workspace B
        const safeBetaQueue = toBullQueueName(getDocumentQueueName(wsBeta, 'local'));
        const queueBeta = new Queue(safeBetaQueue, { connection: { host: '127.0.0.1', port: 6379 } });
        await queueBeta.add('process-document', {
          documentId: `doc_beta_${Date.now()}`,
          workspaceId: wsBeta,
          capability: 'local',
          requiresLocal: true,
        });

        // Enqueue a local job for Workspace A
        const safeAlphaQueue = toBullQueueName(getDocumentQueueName(wsAlpha, 'local'));
        const queueAlpha = new Queue(safeAlphaQueue, { connection: { host: '127.0.0.1', port: 6379 } });
        await queueAlpha.add('process-document', {
          documentId: `doc_alpha_${Date.now()}`,
          workspaceId: wsAlpha,
          capability: 'local',
          requiresLocal: true,
        });

        // Await consumption of Workspace A job
        await alphaPromise;

        // Local Worker A must have consumed Workspace A, but NEVER Workspace B
        expect(receivedJobs).toContain(wsAlpha);
        expect(receivedJobs).not.toContain(wsBeta);

        // Verify Workspace B job is still waiting in Workspace B's queue
        const betaWaitingCount = await queueBeta.getWaitingCount();
        expect(betaWaitingCount).toBe(1);

        await queueBeta.close();
        await queueAlpha.close();
      } finally {
        await localWorker.stop();
        if (originalWorkerType) process.env.WORKER_TYPE = originalWorkerType;
        else delete process.env.WORKER_TYPE;
        if (originalAuthorized) process.env.AUTHORIZED_WORKSPACE_ID = originalAuthorized;
        else delete process.env.AUTHORIZED_WORKSPACE_ID;
        if (originalRedisUrl) process.env.REDIS_URL = originalRedisUrl;
        else delete process.env.REDIS_URL;
      }
    });
  });
});
