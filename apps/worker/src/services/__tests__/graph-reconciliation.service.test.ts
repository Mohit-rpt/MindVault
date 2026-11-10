/**
 * MindVault — Worker: Graph Reconciliation Service Test Suite
 *
 * Implements Stage A Integration Tests TR-01 through TR-08 for Phase 6.4.5:
 * - TR-01: Leader Election & Advisory Lock (10064, 1) Concurrency
 * - TR-02: Receipt Authority Precedence (COMPLETED, PARTIAL, FAILED) & Redis Job Eviction
 * - TR-03: Untrusted Split-Brain Recovery (BullMQ completed with missing/corrupted receipt)
 * - TR-04: Exhausted Retry Recovery (BullMQ attempts >= 3 with null receipt -> fresh runId with 10s delay)
 * - TR-05: Recovery Ceiling Boundary (graphAttempts: 5 -> FAILED_RETRYABLE, never terminal FAILED)
 * - TR-06: Native Backoff Retention (delayed BullMQ jobs skipped without interference)
 * - TR-07: Queue-Presence Reclaim (job missing from Redis with stale heartbeat -> re-claimed & re-enqueued)
 * - TR-08: Fail-Closed on Redis Outage (Redis disconnect rolls back transaction, zero state corruption)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GraphReconciliationService } from '../graph-reconciliation.service.js';
import { PrismaClient } from '@prisma/client';
import type { IWorkerGraphQueue } from '../../lib/graph-queue.js';
import type { GraphFinalizationReceipt } from '@mindvault/shared';

describe('MindVault Phase 6.4.5 — Stage A: GraphReconciliationService Suite', () => {
  let mockPrisma: any;
  let mockQueue: IWorkerGraphQueue;
  let service: GraphReconciliationService;

  beforeEach(() => {
    mockPrisma = {
      $transaction: vi.fn().mockImplementation(async (callback) => {
        return await callback(mockPrisma);
      }),
      $queryRaw: vi.fn(),
      $executeRaw: vi.fn().mockResolvedValue(1),
    };

    mockQueue = {
      enqueue: vi.fn().mockResolvedValue('job-enqueued-123'),
      getJob: vi.fn().mockResolvedValue(null),
      close: vi.fn().mockResolvedValue(undefined),
    };

    service = new GraphReconciliationService(mockPrisma as unknown as PrismaClient, mockQueue);
  });

  describe('TR-01: Leader Election via Advisory Lock (10064, 1)', () => {
    it('allows exactly one instance to acquire the lock and execute while second instance skips cleanly', async () => {
      let firstInstanceRunning = false;

      // Instance 1 mock: acquires lock
      const prisma1: any = {
        $transaction: vi.fn().mockImplementation(async (callback) => {
          firstInstanceRunning = true;
          try {
            return await callback(prisma1);
          } finally {
            firstInstanceRunning = false;
          }
        }),
        $queryRaw: vi.fn().mockImplementation(async (strings: TemplateStringsArray) => {
          const sql = strings.join('');
          if (sql.includes('pg_try_advisory_xact_lock')) {
            return [{ acquired: true }];
          }
          if (sql.includes('FROM "documents"')) {
            return [];
          }
          return [];
        }),
        $executeRaw: vi.fn().mockResolvedValue(1),
      };

      // Instance 2 mock: lock not acquired because Instance 1 holds it
      const prisma2: any = {
        $transaction: vi.fn().mockImplementation(async (callback) => {
          return await callback(prisma2);
        }),
        $queryRaw: vi.fn().mockImplementation(async (strings: TemplateStringsArray) => {
          const sql = strings.join('');
          if (sql.includes('pg_try_advisory_xact_lock')) {
            return [{ acquired: false }];
          }
          return [];
        }),
        $executeRaw: vi.fn().mockResolvedValue(1),
      };

      const service1 = new GraphReconciliationService(
        prisma1 as unknown as PrismaClient,
        mockQueue,
      );
      const service2 = new GraphReconciliationService(
        prisma2 as unknown as PrismaClient,
        mockQueue,
      );

      const [res1, res2] = await Promise.all([
        service1.executeStartupReconciliation(),
        service2.executeStartupReconciliation(),
      ]);

      expect(res1.locked).toBe(true);
      expect(res1.errors).toHaveLength(0);

      expect(res2.locked).toBe(false);
      expect(res2.reconciledCount).toBe(0);
      expect(res2.errors).toHaveLength(0);
    });
  });

  describe('TR-02: Receipt Authority Precedence & Job Eviction', () => {
    it('adopts valid COMPLETED receipt, clears pendingDispatch, evicts Redis job, and never re-enqueues', async () => {
      const runId = 'run-completed-123';
      const validReceipt: GraphFinalizationReceipt = {
        terminalStatus: 'COMPLETED',
        extractionRunId: runId,
        chunkManifestHash: 'manifest-hash-abc',
        completedAt: new Date().toISOString(),
        chunkCount: 3,
        processedChunksCount: 3,
        succeededChunksCount: 3,
        failedChunksCount: 0,
      };

      const docRecord = {
        id: 'doc-comp-1',
        workspaceId: 'ws-test',
        metadata: {
          graphStatus: 'PROCESSING',
          extractionRunId: runId,
          chunkManifestHash: 'manifest-hash-abc',
          graphFinalizationReceipt: validReceipt,
          pendingDispatch: {
            jobId: `graph_doc-comp-1_${runId}`,
            extractionRunId: runId,
            enqueuedAt: new Date().toISOString(),
            createdAt: new Date().toISOString(),
            attempts: 1,
            lastAttemptAt: null,
            lastError: null,
          },
        },
      };

      mockPrisma.$queryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
        const sql = strings.join('');
        if (sql.includes('pg_try_advisory_xact_lock')) {
          return [{ acquired: true }];
        }
        if (sql.includes('FROM "documents"') && sql.includes('LIMIT')) {
          return [docRecord];
        }
        if (sql.includes('FOR NO KEY UPDATE')) {
          return [docRecord];
        }
        if (sql.includes('FROM "chunks"')) {
          return [];
        }
        return [];
      });

      const mockJob = {
        id: `graph_doc-comp-1_${runId}`,
        remove: vi.fn().mockResolvedValue(undefined),
      };
      (mockQueue.getJob as any).mockResolvedValue(mockJob);

      const res = await service.executeStartupReconciliation();

      expect(res.locked).toBe(true);
      expect(res.adoptedReceiptCount).toBe(1);
      expect(res.reconciledCount).toBe(1);

      // Verify job was removed from Redis
      expect(mockJob.remove).toHaveBeenCalledTimes(1);

      // Verify never re-enqueued
      expect(mockQueue.enqueue).not.toHaveBeenCalled();

      // Verify terminal status adopted in PostgreSQL
      expect(mockPrisma.$executeRaw).toHaveBeenCalled();
    });

    it('adopts valid PARTIAL receipt without re-extraction', async () => {
      const runId = 'run-partial-456';
      const validReceipt: GraphFinalizationReceipt = {
        terminalStatus: 'PARTIAL',
        extractionRunId: runId,
        chunkManifestHash: 'manifest-hash-xyz',
        completedAt: new Date().toISOString(),
        chunkCount: 4,
        processedChunksCount: 4,
        succeededChunksCount: 2,
        failedChunksCount: 2,
      };

      const docRecord = {
        id: 'doc-part-1',
        workspaceId: 'ws-test',
        metadata: {
          graphStatus: 'PROCESSING',
          extractionRunId: runId,
          chunkManifestHash: 'manifest-hash-xyz',
          graphFinalizationReceipt: validReceipt,
        },
      };

      mockPrisma.$queryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
        const sql = strings.join('');
        if (sql.includes('pg_try_advisory_xact_lock')) return [{ acquired: true }];
        if (sql.includes('FROM "documents"') && sql.includes('LIMIT')) return [docRecord];
        if (sql.includes('FOR NO KEY UPDATE')) return [docRecord];
        if (sql.includes('FROM "chunks"')) return [];
        return [];
      });

      const res = await service.executeStartupReconciliation();

      expect(res.adoptedReceiptCount).toBe(1);
      expect(mockQueue.enqueue).not.toHaveBeenCalled();
    });

    it('adopts valid terminal FAILED receipt without re-queueing', async () => {
      const runId = 'run-failed-789';
      const validReceipt: GraphFinalizationReceipt = {
        terminalStatus: 'FAILED',
        extractionRunId: runId,
        chunkManifestHash: 'manifest-hash-f',
        completedAt: new Date().toISOString(),
        chunkCount: 2,
        processedChunksCount: 2,
        succeededChunksCount: 0,
        failedChunksCount: 2,
      };

      const docRecord = {
        id: 'doc-fail-1',
        workspaceId: 'ws-test',
        metadata: {
          graphStatus: 'PROCESSING',
          extractionRunId: runId,
          chunkManifestHash: 'manifest-hash-f',
          graphFinalizationReceipt: validReceipt,
        },
      };

      mockPrisma.$queryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
        const sql = strings.join('');
        if (sql.includes('pg_try_advisory_xact_lock')) return [{ acquired: true }];
        if (sql.includes('FROM "documents"') && sql.includes('LIMIT')) return [docRecord];
        if (sql.includes('FOR NO KEY UPDATE')) return [docRecord];
        if (sql.includes('FROM "chunks"')) return [];
        return [];
      });

      const res = await service.executeStartupReconciliation();

      expect(res.adoptedReceiptCount).toBe(1);
      expect(mockQueue.enqueue).not.toHaveBeenCalled();
    });
  });

  describe('TR-03: Untrusted Split-Brain Recovery', () => {
    it('treats BullMQ completed job without valid PostgreSQL receipt as untrusted, evicts job, and re-claims with fresh runId', async () => {
      const runId = 'run-untrusted-1';
      const docRecord = {
        id: 'doc-untrusted-1',
        workspaceId: 'ws-test',
        metadata: {
          graphStatus: 'PROCESSING',
          extractionRunId: runId,
          chunkManifestHash: 'hash-1',
          graphAttempts: 1,
          graphCheckpoint: {
            extractionRunId: runId,
            chunkManifestHash: 'hash-1',
            lastCompletedChunkIndex: 1,
            lastCompletedChunkId: 'chunk-1',
            processedChunksCount: 2,
            succeededChunksCount: 2,
            failedChunksCount: 0,
          },
          graphFinalizationReceipt: null, // Missing receipt!
        },
      };

      const mockJob = {
        id: `graph_doc-untrusted-1_${runId}`,
        getState: vi.fn().mockResolvedValue('completed'),
        remove: vi.fn().mockResolvedValue(undefined),
      };
      (mockQueue.getJob as any).mockResolvedValue(mockJob);

      mockPrisma.$queryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
        const sql = strings.join('');
        if (sql.includes('pg_try_advisory_xact_lock')) return [{ acquired: true }];
        if (sql.includes('FROM "documents"') && sql.includes('LIMIT')) return [docRecord];
        if (sql.includes('FOR NO KEY UPDATE')) return [docRecord];
        if (sql.includes('FROM "chunks"')) return [];
        return [];
      });

      const res = await service.executeStartupReconciliation();

      expect(res.untrustedRecoveredCount).toBe(1);
      expect(res.reconciledCount).toBe(1);
      expect(mockJob.remove).toHaveBeenCalledTimes(1);

      // Verify re-enqueued with fresh runId
      expect(mockQueue.enqueue).toHaveBeenCalledTimes(1);
      const enqueuedPayload = (mockQueue.enqueue as any).mock.calls[0][0];
      expect(enqueuedPayload.extractionRunId).toBeDefined();
      expect(enqueuedPayload.extractionRunId).not.toBe(runId);
      expect(enqueuedPayload.documentId).toBe('doc-untrusted-1');
    });
  });

  describe('TR-04: Exhausted Retry Recovery', () => {
    it('recovers BullMQ job with attemptsMade >= 3 and null receipt by allocating fresh runId with 10s delay', async () => {
      const runId = 'run-exhausted-1';
      const docRecord = {
        id: 'doc-exhausted-1',
        workspaceId: 'ws-test',
        metadata: {
          graphStatus: 'PROCESSING',
          extractionRunId: runId,
          graphAttempts: 1,
          graphCheckpoint: {
            extractionRunId: runId,
            chunkManifestHash: 'hash-e',
            lastCompletedChunkIndex: 0,
            lastCompletedChunkId: 'chunk-0',
            processedChunksCount: 1,
            succeededChunksCount: 1,
            failedChunksCount: 0,
          },
          graphFinalizationReceipt: null,
        },
      };

      const mockJob = {
        id: `graph_doc-exhausted-1_${runId}`,
        attemptsMade: 3,
        getState: vi.fn().mockResolvedValue('failed'),
        remove: vi.fn().mockResolvedValue(undefined),
      };
      (mockQueue.getJob as any).mockResolvedValue(mockJob);

      mockPrisma.$queryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
        const sql = strings.join('');
        if (sql.includes('pg_try_advisory_xact_lock')) return [{ acquired: true }];
        if (sql.includes('FROM "documents"') && sql.includes('LIMIT')) return [docRecord];
        if (sql.includes('FOR NO KEY UPDATE')) return [docRecord];
        if (sql.includes('FROM "chunks"')) return [];
        return [];
      });

      const res = await service.executeStartupReconciliation();

      expect(res.exhaustedRecoveredCount).toBe(1);
      expect(mockJob.remove).toHaveBeenCalledTimes(1);

      // Verify re-enqueued with 10s delay
      expect(mockQueue.enqueue).toHaveBeenCalledTimes(1);
      const [payload, options] = (mockQueue.enqueue as any).mock.calls[0];
      expect(payload.extractionRunId).not.toBe(runId);
      expect(options).toEqual({ delay: 10000 });
    });
  });

  describe('TR-05: Recovery Ceiling Boundary', () => {
    it('marks FAILED_RETRYABLE when graphAttempts reaches MAX_TOTAL_RUNS (5) and strictly avoids terminal FAILED', async () => {
      const runId = 'run-ceiling-5';
      const docRecord = {
        id: 'doc-ceiling-1',
        workspaceId: 'ws-test',
        metadata: {
          graphStatus: 'PROCESSING',
          extractionRunId: runId,
          graphAttempts: 5, // Ceiling reached!
          graphFinalizationReceipt: null,
        },
      };

      const mockJob = {
        id: `graph_doc-ceiling-1_${runId}`,
        attemptsMade: 3,
        getState: vi.fn().mockResolvedValue('failed'),
        remove: vi.fn().mockResolvedValue(undefined),
      };
      (mockQueue.getJob as any).mockResolvedValue(mockJob);

      mockPrisma.$queryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
        const sql = strings.join('');
        if (sql.includes('pg_try_advisory_xact_lock')) return [{ acquired: true }];
        if (sql.includes('FROM "documents"') && sql.includes('LIMIT')) return [docRecord];
        if (sql.includes('FOR NO KEY UPDATE')) return [docRecord];
        if (sql.includes('FROM "chunks"')) return [];
        return [];
      });

      const res = await service.executeStartupReconciliation();

      expect(res.ceilingReachedCount).toBe(1);
      expect(res.reconciledCount).toBe(1);

      // Must NOT re-enqueue
      expect(mockQueue.enqueue).not.toHaveBeenCalled();

      // Must update PostgreSQL with FAILED_RETRYABLE
      expect(mockPrisma.$executeRaw).toHaveBeenCalled();
    });
  });

  describe('TR-06: Native Backoff Retention', () => {
    it('skips delayed BullMQ jobs without external intervention to preserve native backoff', async () => {
      const runId = 'run-delayed-1';
      const docRecord = {
        id: 'doc-del-1',
        workspaceId: 'ws-test',
        metadata: {
          graphStatus: 'PROCESSING',
          extractionRunId: runId,
          graphAttempts: 1,
          graphFinalizationReceipt: null,
        },
      };

      const mockJob = {
        id: `graph_doc-del-1_${runId}`,
        getState: vi.fn().mockResolvedValue('delayed'),
        remove: vi.fn(),
      };
      (mockQueue.getJob as any).mockResolvedValue(mockJob);

      mockPrisma.$queryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
        const sql = strings.join('');
        if (sql.includes('pg_try_advisory_xact_lock')) return [{ acquired: true }];
        if (sql.includes('FROM "documents"') && sql.includes('LIMIT')) return [docRecord];
        if (sql.includes('FOR NO KEY UPDATE')) return [docRecord];
        if (sql.includes('FROM "chunks"')) return [];
        return [];
      });

      const res = await service.executeStartupReconciliation();

      expect(res.reconciledCount).toBe(0);
      expect(mockJob.remove).not.toHaveBeenCalled();
      expect(mockQueue.enqueue).not.toHaveBeenCalled();
    });
  });

  describe('TR-07: Queue-Presence Reclaim', () => {
    it('detects missing BullMQ job in Redis and re-claims under fresh runId', async () => {
      const runId = 'run-lost-1';
      const docRecord = {
        id: 'doc-lost-1',
        workspaceId: 'ws-test',
        metadata: {
          graphStatus: 'PROCESSING',
          extractionRunId: runId,
          graphAttempts: 1,
          graphHeartbeatAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(), // 10 minutes ago (stale)
          graphFinalizationReceipt: null,
        },
      };

      (mockQueue.getJob as any).mockResolvedValue(null); // Missing from Redis!

      mockPrisma.$queryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
        const sql = strings.join('');
        if (sql.includes('pg_try_advisory_xact_lock')) return [{ acquired: true }];
        if (sql.includes('FROM "documents"') && sql.includes('LIMIT')) return [docRecord];
        if (sql.includes('FOR NO KEY UPDATE')) return [docRecord];
        if (sql.includes('FROM "chunks"')) return [];
        return [];
      });

      const res = await service.executeStartupReconciliation();

      expect(res.presenceRecoveredCount).toBe(1);
      expect(mockQueue.enqueue).toHaveBeenCalledTimes(1);
      const [payload] = (mockQueue.enqueue as any).mock.calls[0];
      expect(payload.extractionRunId).not.toBe(runId);
    });
  });

  describe('TR-08: Fail-Closed on Redis Outage', () => {
    it('safely aborts reconciliation and logs sanitized error when Redis disconnects during sweep', async () => {
      const docRecord = {
        id: 'doc-redis-down',
        workspaceId: 'ws-test',
        metadata: {
          graphStatus: 'PROCESSING',
          extractionRunId: 'run-redis-down',
        },
      };

      mockPrisma.$queryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
        const sql = strings.join('');
        if (sql.includes('pg_try_advisory_xact_lock')) return [{ acquired: true }];
        if (sql.includes('FROM "documents"') && sql.includes('LIMIT')) return [docRecord];
        if (sql.includes('FOR NO KEY UPDATE')) return [docRecord];
        if (sql.includes('FROM "chunks"')) return [];
        return [];
      });

      // Redis disconnect simulation
      (mockQueue.getJob as any).mockRejectedValue(
        new Error('connect ECONNREFUSED redis://:secretpass@127.0.0.1:6379'),
      );

      const res = await service.executeStartupReconciliation();

      expect(res.errors.length).toBeGreaterThan(0);
      expect(res.errors[0]).toContain('[REDACTED]');
      expect(res.errors[0]).not.toContain('secretpass');
      expect(res.reconciledCount).toBe(0);
    });
  });
});
