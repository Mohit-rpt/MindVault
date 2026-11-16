import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock prisma before importing CompanionService
vi.mock('../apps/api/src/lib/prisma.js', () => {
  return {
    prisma: {
      companionDevice: {
        create: vi.fn().mockImplementation(async ({ data }) => ({
          id: `dev-${Math.random().toString(36).slice(2, 8)}`,
          userId: data.userId,
          deviceName: data.deviceName,
          platform: data.platform || 'win32',
          tokenHash: data.tokenHash,
          createdAt: new Date(),
        })),
      },
      workspaceMember: {
        findUnique: vi.fn().mockResolvedValue({
          userId: 'user-claimant-1',
          workspaceId: 'ws-pair-test',
          role: 'ADMIN',
        }),
      },
    },
  };
});

import { getDocumentQueueName, getGraphQueueName } from '@mindvault/shared';
import {
  BullMQDocumentQueue,
  InMemoryDocumentQueue,
} from '../apps/api/src/modules/document/document.queue.js';
import {
  BullMQGraphExtractionQueue,
  InMemoryGraphExtractionQueue,
} from '../apps/api/src/modules/graph/queue/graph-extraction.queue.js';
import { BullMQWorkerGraphQueue } from '../apps/worker/src/lib/graph-queue.js';
import { DocumentIngestionPipeline } from '../apps/worker/src/modules/ingestion/pipeline.js';
import { GraphExtractionWorker } from '../apps/worker/src/modules/graph/worker/graph-extraction.worker.js';
import { CompanionService } from '../apps/api/src/modules/companion/companion.service.js';
import { RedisRateLimitStore } from '../apps/api/src/modules/companion/companion.routes.js';
import { setRedisHealthClient } from '../apps/api/src/routes/health.js';

describe('MindVault — Phase 7: Multi-Tenant Queue Isolation & Concurrency Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    setRedisHealthClient(null);
  });

  // =========================================================================
  // 1. ARC-01: Genuine Workspace Queue Partitioning (§ARC-01)
  // =========================================================================
  describe('1. ARC-01: Genuine Workspace Queue Partitioning', () => {
    it('generates distinct partitioned queue names per workspace with safe fallback', () => {
      expect(getDocumentQueueName('workspace-alpha')).toBe('document-processing:workspace-alpha');
      expect(getDocumentQueueName('workspace-beta')).toBe('document-processing:workspace-beta');
      expect(getDocumentQueueName('')).toBe('document-processing');
      expect(getDocumentQueueName(null)).toBe('document-processing');
      expect(getDocumentQueueName(undefined)).toBe('document-processing');

      expect(getGraphQueueName('workspace-alpha')).toBe('graph-extraction:workspace-alpha');
      expect(getGraphQueueName('workspace-beta')).toBe('graph-extraction:workspace-beta');
      expect(getGraphQueueName('')).toBe('graph-extraction');
      expect(getGraphQueueName(null)).toBe('graph-extraction');
      expect(getGraphQueueName(undefined)).toBe('graph-extraction');
    });

    it('InMemoryDocumentQueue routes jobs to workspace partitions without cross-tenant leakage', async () => {
      const queue = new InMemoryDocumentQueue();

      await queue.enqueue({
        documentId: 'doc-alpha-1',
        workspaceId: 'ws-alpha',
        storageKey: 'key-alpha-1',
        mimeType: 'application/pdf',
        originalName: 'alpha1.pdf',
      });

      await queue.enqueue({
        documentId: 'doc-beta-1',
        workspaceId: 'ws-beta',
        storageKey: 'key-beta-1',
        mimeType: 'application/pdf',
        originalName: 'beta1.pdf',
      });

      await queue.enqueue({
        documentId: 'doc-alpha-2',
        workspaceId: 'ws-alpha',
        storageKey: 'key-alpha-2',
        mimeType: 'text/markdown',
        originalName: 'alpha2.md',
      });

      const alphaJobs = queue.getJobsForWorkspace('ws-alpha');
      const betaJobs = queue.getJobsForWorkspace('ws-beta');
      const gammaJobs = queue.getJobsForWorkspace('ws-gamma');

      expect(alphaJobs).toHaveLength(2);
      expect(alphaJobs.map((j) => j.documentId)).toEqual(['doc-alpha-1', 'doc-alpha-2']);

      expect(betaJobs).toHaveLength(1);
      expect(betaJobs.map((j) => j.documentId)).toEqual(['doc-beta-1']);

      expect(gammaJobs).toHaveLength(0);
    });

    it('InMemoryGraphExtractionQueue routes extraction jobs per workspace', async () => {
      const queue = new InMemoryGraphExtractionQueue();

      const jobId1 = await queue.enqueue({ documentId: 'doc-1', workspaceId: 'ws-1' });
      await queue.enqueue({ documentId: 'doc-2', workspaceId: 'ws-2' });

      expect(queue.jobs).toHaveLength(2);
      const job1 = await queue.getJob(jobId1);
      expect(job1).toBeDefined();
      expect(job1?.data.workspaceId).toBe('ws-1');
    });

    it('BullMQDocumentQueue resolves and caches distinct Queue instances per workspace', () => {
      const queue = new BullMQDocumentQueue();
      const mockQueueA = { name: 'document-processing:ws-tenant-A' } as any;
      const mockQueueB = { name: 'document-processing:ws-tenant-B' } as any;

      (queue as any).queues.set('document-processing:ws-tenant-A', mockQueueA);
      (queue as any).queues.set('document-processing:ws-tenant-B', mockQueueB);

      const queueA = queue.getQueue('ws-tenant-A');
      const queueB = queue.getQueue('ws-tenant-B');
      const queueA_cached = queue.getQueue('ws-tenant-A');

      expect(queueA).toBe(mockQueueA);
      expect(queueB).toBe(mockQueueB);
      // Must return identical cached instance for the same workspace
      expect(queueA).toBe(queueA_cached);
      expect(queueA).not.toBe(queueB);
    });

    it('BullMQGraphExtractionQueue resolves and caches distinct Queue instances per workspace', () => {
      const queue = new BullMQGraphExtractionQueue();
      const mockQueueX = { name: 'graph-extraction:ws-x' } as any;
      const mockQueueY = { name: 'graph-extraction:ws-y' } as any;

      (queue as any).queues.set('graph-extraction:ws-x', mockQueueX);
      (queue as any).queues.set('graph-extraction:ws-y', mockQueueY);

      const queueX = queue.getQueue('ws-x');
      const queueY = queue.getQueue('ws-y');

      expect(queueX).toBe(mockQueueX);
      expect(queueY).toBe(mockQueueY);
      expect(queueX).not.toBe(queueY);
    });

    it('BullMQWorkerGraphQueue routes graph jobs to target workspace queue', async () => {
      const queue = new BullMQWorkerGraphQueue();
      const mockBullQueue = {
        add: vi.fn().mockResolvedValue({ id: 'graph-job-1' }),
        close: vi.fn().mockResolvedValue(undefined),
      };

      // Mock internal queue resolver
      (queue as any).queues.set('graph-extraction:ws-target', mockBullQueue);

      const returnedJobId = await queue.enqueue({
        documentId: 'doc-g-1',
        workspaceId: 'ws-target',
      });

      expect(mockBullQueue.add).toHaveBeenCalledWith(
        'extract-graph',
        expect.objectContaining({ documentId: 'doc-g-1', workspaceId: 'ws-target' }),
        expect.anything(),
      );
      expect(returnedJobId).toMatch(/^graph_doc-g-1_/);
    });
  });

  // =========================================================================
  // 2. Foreign Job Safety & Re-routing (§ARC-01)
  // =========================================================================
  describe('2. Foreign Job Safety & Re-routing (§ARC-01)', () => {
    const mockStorage = { exists: vi.fn(), read: vi.fn(), save: vi.fn() };
    const mockEmbedding = { generateEmbeddings: vi.fn(), getDimension: vi.fn() };
    const mockDb = {
      findDocumentById: vi.fn(),
      updateDocument: vi.fn(),
      createDocumentChunks: vi.fn(),
    };

    it('DocumentIngestionPipeline safely reroutes foreign jobs rather than failing them', async () => {
      const originalAuthorized = process.env.AUTHORIZED_WORKSPACE_ID;
      process.env.AUTHORIZED_WORKSPACE_ID = 'ws-authorized-local';

      try {
        const pipeline = new DocumentIngestionPipeline(
          mockStorage as any,
          mockEmbedding as any,
          mockDb as any,
        );
        const mockRerouteQueue = {
          add: vi.fn().mockResolvedValue({ id: 'rerouted-doc-job-1' }),
          close: vi.fn().mockResolvedValue(undefined),
        };

        const mockJob: any = {
          id: 'foreign-job-999',
          name: 'process-document',
          data: {
            documentId: 'doc-foreign-1',
            workspaceId: 'ws-other-tenant',
            storageKey: 'storage-key-1',
            mimeType: 'application/pdf',
            originalName: 'foreign.pdf',
          },
          attemptsMade: 1,
        };

        const result = await pipeline.processDocument(mockJob.data, {
          rerouteQueueOverride: mockRerouteQueue as any,
        });

        expect(result?.status).toBe('rerouted');
        expect(result?.targetWorkspaceId).toBe('ws-other-tenant');
        expect(mockRerouteQueue.add).toHaveBeenCalledWith(
          'process-document',
          mockJob.data,
          expect.anything(),
        );
      } finally {
        if (originalAuthorized) {
          process.env.AUTHORIZED_WORKSPACE_ID = originalAuthorized;
        } else {
          delete process.env.AUTHORIZED_WORKSPACE_ID;
        }
      }
    });

    it('GraphExtractionWorker safely reroutes foreign extraction jobs rather than failing them', async () => {
      const originalAuthorized = process.env.AUTHORIZED_WORKSPACE_ID;
      process.env.AUTHORIZED_WORKSPACE_ID = 'ws-authorized-graph';

      try {
        const worker = new GraphExtractionWorker();
        const mockRerouteQueue = {
          add: vi.fn().mockResolvedValue({ id: 'rerouted-graph-job-1' }),
          close: vi.fn().mockResolvedValue(undefined),
        };

        const mockJob: any = {
          id: 'foreign-graph-job-888',
          name: 'extract-graph',
          data: {
            documentId: 'doc-foreign-2',
            workspaceId: 'ws-foreign-tenant',
          },
          attemptsMade: 1,
        };

        const result = await worker.processJob(mockJob, {
          rerouteQueueOverride: mockRerouteQueue as any,
        });

        expect(result.status).toBe('rerouted');
        expect(result.targetWorkspaceId).toBe('ws-foreign-tenant');
        expect(mockRerouteQueue.add).toHaveBeenCalledWith(
          'extract-graph',
          mockJob.data,
          expect.anything(),
        );
      } finally {
        if (originalAuthorized) {
          process.env.AUTHORIZED_WORKSPACE_ID = originalAuthorized;
        } else {
          delete process.env.AUTHORIZED_WORKSPACE_ID;
        }
      }
    });
  });

  // =========================================================================
  // 3. Worker Type Capability Routing (§OPS-01)
  // =========================================================================
  describe('3. Worker Type Capability Routing (§OPS-01)', () => {
    const mockStorage = { exists: vi.fn(), read: vi.fn(), save: vi.fn() };
    const mockEmbedding = { generateEmbeddings: vi.fn(), getDimension: vi.fn() };
    const mockDb = {
      findDocumentById: vi.fn(),
      updateDocument: vi.fn(),
      createDocumentChunks: vi.fn(),
    };

    it('DocumentIngestionPipeline defers or reroutes local-required jobs when running as cloud worker', async () => {
      const originalWorkerType = process.env.WORKER_TYPE;
      process.env.WORKER_TYPE = 'cloud';

      try {
        const pipeline = new DocumentIngestionPipeline(
          mockStorage as any,
          mockEmbedding as any,
          mockDb as any,
        );
        const mockJob: any = {
          id: 'job-local-only',
          name: 'process-document',
          data: {
            documentId: 'doc-local-1',
            workspaceId: 'ws-hybrid',
            requiresLocal: true,
          },
          attemptsMade: 1,
        };

        const result = await pipeline.processDocument(mockJob.data);
        expect(result?.status).toBe('skipped_local_required');
      } finally {
        if (originalWorkerType) {
          process.env.WORKER_TYPE = originalWorkerType;
        } else {
          delete process.env.WORKER_TYPE;
        }
      }
    });

    it('GraphExtractionWorker defers or skips local-required jobs when running as cloud worker', async () => {
      const originalWorkerType = process.env.WORKER_TYPE;
      process.env.WORKER_TYPE = 'cloud';

      try {
        const worker = new GraphExtractionWorker();
        const mockJob: any = {
          id: 'job-graph-local',
          name: 'extract-graph',
          data: {
            documentId: 'doc-local-graph',
            workspaceId: 'ws-hybrid-graph',
            requiresLocal: true,
          },
        };

        const result = await worker.processJob(mockJob);
        expect(result?.status).toBe('skipped_local_required');
      } finally {
        if (originalWorkerType) {
          process.env.WORKER_TYPE = originalWorkerType;
        } else {
          delete process.env.WORKER_TYPE;
        }
      }
    });
  });

  // =========================================================================
  // 4. SEC-01: Atomic Pairing Code Claim Concurrency (§SEC-01)
  // =========================================================================
  describe('4. SEC-01: Atomic Pairing Code Claim Concurrency', () => {
    it('guarantees that 10 concurrent claim requests for the same pairing code result in EXACTLY 1 success and 9 failures', async () => {
      // Mock Redis with simulated atomic getdel/Lua behavior
      let storedCodeData: string | null = JSON.stringify({
        userId: 'user-claimant-1',
        workspaceId: 'ws-pair-test',
        expiresAt: Date.now() + 600000,
        createdAt: new Date().toISOString(),
      });

      const mockRedis: any = {
        eval: vi.fn().mockImplementation(async (script, numKeys, key) => {
          // Atomic LUA script simulation: returns value and deletes key in one atomic step
          if (storedCodeData !== null) {
            const data = storedCodeData;
            storedCodeData = null; // atomically deleted
            return data;
          }
          return null; // already deleted / claimed
        }),
      };

      setRedisHealthClient(mockRedis);

      const companionService = new CompanionService();
      const pairingCode = 'MV-PAIR99';

      // Simulate 10 simultaneous claim attempts from 10 client threads
      const attempts = Array.from({ length: 10 }, (_, i) =>
        companionService.claimPairingCode(pairingCode, `Worker-Machine-${i + 1}`, 'win32').then(
          (result) => ({ success: true, result }),
          (error) => ({ success: false, error: error.message }),
        ),
      );

      const results = await Promise.all(attempts);

      const successes = results.filter((r) => r.success);
      const failures = results.filter((r) => !r.success);

      expect(successes).toHaveLength(1);
      expect(failures).toHaveLength(9);
      expect((successes[0] as any).result.deviceToken).toBeDefined();
      expect((successes[0] as any).result.workspaceId).toBe('ws-pair-test');

      failures.forEach((f: any) => {
        expect(f.error).toMatch(/Invalid or expired pairing code/i);
      });
    });
  });

  // =========================================================================
  // 5. NET-01: Distributed Redis Rate Limit Store (§NET-01)
  // =========================================================================
  describe('5. NET-01: Distributed Redis Rate Limit Store', () => {
    it('increments rate limit key atomically via Redis eval script', async () => {
      let redisCounter = 0;
      const windowMs = 60000;

      const mockRedis: any = {
        eval: vi.fn().mockImplementation(async (script, numKeys, key, expireMs) => {
          redisCounter += 1;
          return [redisCounter, 59500]; // returns [count, pttl]
        }),
      };

      const store = new RedisRateLimitStore('test-rl', mockRedis);
      store.init({ windowMs } as any);

      const hit1 = await store.increment('client-ip-1');
      expect(hit1.totalHits).toBe(1);
      expect(hit1.resetTime).toBeInstanceOf(Date);

      const hit2 = await store.increment('client-ip-1');
      expect(hit2.totalHits).toBe(2);

      expect(mockRedis.eval).toHaveBeenCalledTimes(2);
    });

    it('falls back safely to in-memory store when Redis is unavailable or errors', async () => {
      const mockFaultyRedis: any = {
        eval: vi.fn().mockRejectedValue(new Error('Redis connection lost')),
      };

      const store = new RedisRateLimitStore('test-faulty-rl', mockFaultyRedis);
      store.init({ windowMs: 60000 } as any);

      // Should not throw, should fall back to memory
      const hit1 = await store.increment('client-ip-fallback');
      expect(hit1.totalHits).toBe(1);
      expect(hit1.resetTime).toBeInstanceOf(Date);

      const hit2 = await store.increment('client-ip-fallback');
      expect(hit2.totalHits).toBe(2);
    });
  });
});
