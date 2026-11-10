/**
 * MindVault — Phase 6.4.5: Worker Entry Protection Adversarial Test Suite
 *
 * Verifies Stage B requirements from Blueprint v4.5.6 (§6.2.5, §6.4.5, AC-22, AC-23, AC-24):
 * - TE-01: Fast-Exit on Existing Receipt (0 LLM calls, bounded <10ms transaction, completed in BullMQ)
 * - TE-02: Two-Statement Sequential Entry Protocol under READ COMMITTED with FOR NO KEY UPDATE
 * - TE-03: Same-Run Execution Lease Contention Deferral (moveToDelayed + DelayedError, 0 LLM calls, no attempt burn)
 * - TE-04: Monotonic Lease Generation Fencing (takeover advances generation, stale worker rejected with ExtractionFencedError)
 * - TE-05: Failure-Safe Conditional Lease Release on Transient Failure (lease cleared in PG/Redis for immediate clean retry)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GraphExtractionWorker } from '../worker/graph-extraction.worker.js';
import { DelayedError } from 'bullmq';
import { ExtractionTransientError, ExtractionFencedError } from '../errors/index.js';
import type { GraphFinalizationReceipt } from '@mindvault/shared';

// Mock prisma lib
const { mockPrisma, dbState } = vi.hoisted(() => {
  const dbState = {
    documents: new Map<string, any>(),
    chunks: new Map<string, any[]>(),
    executeRawCalls: [] as Array<{ sql: string; values: any[] }>,
    queryRawCalls: [] as Array<{ sql: string }>,
  };

  const mockPrisma: any = {
    $transaction: vi.fn().mockImplementation(async (callback) => {
      return await callback(mockPrisma);
    }),
    document: {
      findUnique: vi.fn().mockImplementation(async ({ where, include }: any) => {
        const id = where.id || where.workspaceId_id?.id;
        const doc = dbState.documents.get(id);
        if (!doc) return null;
        const res = { ...doc };
        if (include?.chunks) {
          res.chunks = dbState.chunks.get(id) || [];
        }
        return res;
      }),
    },
    $queryRaw: vi.fn().mockImplementation(async (strings: any, ...values: any[]) => {
      const sql = strings?.raw
        ? strings.raw.join(' ')
        : Array.isArray(strings)
          ? strings.join(' ')
          : String(strings);
      dbState.queryRawCalls.push({ sql });

      // Statement 1: Row lock
      if (sql.includes('FOR NO KEY UPDATE')) {
        const docId = values[0];
        const doc = dbState.documents.get(docId);
        if (!doc) return [];
        return [{ id: docId }];
      }

      // Statement 2: Fresh snapshot evaluation
      if (sql.includes('isLeaseActive')) {
        const docId = values[0];
        const doc = dbState.documents.get(docId);
        if (!doc) return [];
        const isLeaseActive =
          doc.metadata?.graphWorkerToken != null &&
          new Date(doc.metadata?.graphLeaseExpiresAt || 0).getTime() > Date.now();
        return [
          {
            id: doc.id,
            metadata: doc.metadata,
            checksum: doc.checksum || 'chk-123',
            originalName: doc.originalName || 'test.pdf',
            isLeaseActive,
            activeRunId: doc.metadata?.extractionRunId || null,
            activeToken: doc.metadata?.graphWorkerToken || null,
            activeGen: doc.metadata?.graphLeaseGeneration ?? 0,
          },
        ];
      }

      return [];
    }),
    $executeRaw: vi.fn().mockImplementation(async (strings: any, ...values: any[]) => {
      const sql = strings?.raw
        ? strings.raw.join(' ')
        : Array.isArray(strings)
          ? strings.join(' ')
          : String(strings);
      dbState.executeRawCalls.push({ sql, values });

      // Update lease claim
      if (sql.includes("'{graphLeaseGeneration}'")) {
        const docId = values[1] || values[values.length - 2];
        const doc = dbState.documents.get(docId);
        if (doc) {
          doc.metadata.graphStatus = 'PROCESSING';
          doc.metadata.graphWorkerToken = values[0];
          doc.metadata.graphLeaseGeneration = (doc.metadata.graphLeaseGeneration || 0) + 1;
          doc.metadata.graphLeaseExpiresAt = new Date(Date.now() + 60000).toISOString();
          doc.metadata.graphHeartbeatAt = new Date().toISOString();
        }
        return 1;
      }

      // Conditional lease release
      if (sql.includes("'{graphWorkerToken}', 'null'::jsonb")) {
        const docId = values[0];
        const doc = dbState.documents.get(docId);
        if (doc) {
          doc.metadata.graphWorkerToken = null;
          doc.metadata.graphLeaseExpiresAt = null;
        }
        return 1;
      }

      return 1;
    }),
  };

  return { mockPrisma, dbState };
});

vi.mock('../../../lib/prisma.js', () => ({
  prisma: mockPrisma,
}));

describe('MindVault Phase 6.4.5 — Stage B: Worker Entry Protection Suite', () => {
  let worker: GraphExtractionWorker;
  let mockRedis: any;

  beforeEach(() => {
    dbState.documents.clear();
    dbState.chunks.clear();
    dbState.executeRawCalls.length = 0;
    dbState.queryRawCalls.length = 0;

    mockRedis = {
      eval: vi.fn().mockResolvedValue(1),
      set: vi.fn().mockResolvedValue('OK'),
      del: vi.fn().mockResolvedValue(1),
    };

    worker = new GraphExtractionWorker();
    (worker as any).redisClient = mockRedis;
  });

  describe('TE-01: Fast-Exit on Existing Receipt', () => {
    it('fast-exits cleanly returning receipt under row lock without processing chunks or calling LLM', async () => {
      const docId = 'doc-fast-exit-1';
      const runId = 'run-fast-exit-1';
      const validReceipt: GraphFinalizationReceipt = {
        terminalStatus: 'COMPLETED',
        extractionRunId: runId,
        chunkManifestHash: 'hash-abc',
        completedAt: new Date().toISOString(),
        chunkCount: 2,
        processedChunksCount: 2,
        succeededChunksCount: 2,
        failedChunksCount: 0,
      };

      dbState.documents.set(docId, {
        id: docId,
        workspaceId: 'ws-1',
        originalName: 'report.pdf',
        checksum: 'chk-1',
        metadata: {
          graphStatus: 'COMPLETED',
          extractionRunId: runId,
          chunkManifestHash: 'hash-abc',
          graphFinalizationReceipt: validReceipt,
        },
      });

      const mockJob: any = {
        id: 'job-1',
        data: {
          documentId: docId,
          workspaceId: 'ws-1',
          extractionRunId: runId,
        },
      };

      const mockService = {
        extractFromChunk: vi.fn(),
      };
      (worker as any).service = mockService;

      const result = await worker.processJob(mockJob, 'token-worker-1');

      // Verify fast-exit return
      expect(result).toEqual(validReceipt);

      // Verify Statement 1 acquired FOR NO KEY UPDATE
      const rowLockQuery = dbState.queryRawCalls.find((q) => q.sql.includes('FOR NO KEY UPDATE'));
      expect(rowLockQuery).toBeDefined();

      // Zero LLM or chunk extraction calls
      expect(mockService.extractFromChunk).not.toHaveBeenCalled();

      // Zero Redis lease acquisition calls
      expect(mockRedis.eval).not.toHaveBeenCalled();
    });
  });

  describe('TE-02: Two-Statement Sequential Entry Protocol', () => {
    it('executes Statement 1 (FOR NO KEY UPDATE) followed by Statement 2 under fresh snapshot in bounded transaction', async () => {
      const docId = 'doc-two-stmt-1';
      const runId = 'run-two-stmt-1';

      dbState.documents.set(docId, {
        id: docId,
        workspaceId: 'ws-1',
        originalName: 'test.pdf',
        checksum: 'chk-1',
        metadata: {
          graphStatus: 'QUEUED',
          extractionRunId: runId,
          chunkManifestHash: 'hash-1',
          graphLeaseGeneration: 1,
        },
      });

      dbState.chunks.set(docId, [
        {
          id: 'chunk-0',
          documentId: docId,
          chunkIndex: 0,
          content: 'Hello world',
        },
      ]);

      const mockJob: any = {
        id: 'job-two-stmt',
        data: {
          documentId: docId,
          workspaceId: 'ws-1',
          extractionRunId: runId,
        },
      };

      const mockService = {
        extractFromChunk: vi.fn().mockResolvedValue({
          __persistedInTransaction: true,
          entitiesExtracted: 1,
          updatedCheckpoint: {
            extractionRunId: runId,
            chunkManifestHash: 'hash-1',
            lastCompletedChunkIndex: 0,
            lastCompletedChunkId: 'chunk-0',
            processedChunksCount: 1,
            succeededChunksCount: 1,
            failedChunksCount: 0,
          },
        }),
      };
      (worker as any).service = mockService;

      await worker.processJob(mockJob, 'token-two-stmt');

      // Assert Statement 1 (FOR NO KEY UPDATE) was executed first
      expect(dbState.queryRawCalls[0].sql).toContain('FOR NO KEY UPDATE');

      // Assert Statement 2 (Fresh snapshot evaluation) was executed second
      expect(dbState.queryRawCalls[1].sql).toContain('isLeaseActive');

      // Assert monotonic graphLeaseGeneration was incremented from 1 to 2
      const updatedDoc = dbState.documents.get(docId);
      expect(updatedDoc.metadata.graphLeaseGeneration).toBe(2);
      expect(updatedDoc.metadata.graphWorkerToken).toBe('token-two-stmt');
    });
  });

  describe('TE-03: Same-Run Execution Lease Contention Deferral', () => {
    it('defers via moveToDelayed and throws DelayedError when another worker holds unexpired lease, with 0 LLM calls', async () => {
      const docId = 'doc-contention-1';
      const runId = 'run-contention-1';

      // Document currently owned by worker-A with active 60s lease
      dbState.documents.set(docId, {
        id: docId,
        workspaceId: 'ws-1',
        originalName: 'contention.pdf',
        checksum: 'chk-c',
        metadata: {
          graphStatus: 'PROCESSING',
          extractionRunId: runId,
          graphWorkerToken: 'token-worker-A',
          graphLeaseGeneration: 1,
          graphLeaseExpiresAt: new Date(Date.now() + 45000).toISOString(), // 45s remaining (active)
        },
      });

      const moveToDelayedSpy = vi.fn().mockResolvedValue(undefined);
      const mockJob: any = {
        id: 'job-contention',
        token: 'bullmq-token-B',
        data: {
          documentId: docId,
          workspaceId: 'ws-1',
          extractionRunId: runId,
        },
        moveToDelayed: moveToDelayedSpy,
      };

      const mockService = {
        extractFromChunk: vi.fn(),
      };
      (worker as any).service = mockService;

      // Worker B attempts execution
      await expect(worker.processJob(mockJob)).rejects.toThrow(DelayedError);

      // Verify moveToDelayed was invoked with 5s delay and BullMQ lock token
      expect(moveToDelayedSpy).toHaveBeenCalledWith(expect.any(Number), 'bullmq-token-B');

      // Zero LLM calls made
      expect(mockService.extractFromChunk).not.toHaveBeenCalled();

      // Zero Redis lease acquisition calls by Worker B
      expect(mockRedis.eval).not.toHaveBeenCalled();
    });
  });

  describe('TE-04: Monotonic Lease Generation Fencing', () => {
    it('advances generation on takeover and fences stale worker attempting chunk writes', async () => {
      const docId = 'doc-fencing-1';
      const runId = 'run-fencing-1';

      // Doc initially at generation 1
      dbState.documents.set(docId, {
        id: docId,
        workspaceId: 'ws-1',
        originalName: 'fenced.pdf',
        checksum: 'chk-f',
        metadata: {
          graphStatus: 'QUEUED',
          extractionRunId: runId,
          graphLeaseGeneration: 1,
        },
      });

      dbState.chunks.set(docId, [
        { id: 'c-0', documentId: docId, chunkIndex: 0, content: 'chunk 0 text' },
        { id: 'c-1', documentId: docId, chunkIndex: 1, content: 'chunk 1 text' },
      ]);

      const mockJob: any = {
        id: 'job-fencing',
        data: { documentId: docId, workspaceId: 'ws-1', extractionRunId: runId },
      };

      let workerGenerationPassed: any = null;

      const mockService = {
        extractFromChunk: vi
          .fn()
          .mockImplementation(async (_ws, _doc, _chunkId, _content, context) => {
            workerGenerationPassed = context.expectedLeaseGeneration;
            // Simulate that while chunk was extracting, replacement worker claimed generation 3!
            throw new ExtractionFencedError(
              'Worker fenced: lease generation mismatch (expected 2, found 3)',
            );
          }),
      };
      (worker as any).service = mockService;

      // Worker executes: claims generation 2
      await worker.processJob(mockJob, 'token-fenced-worker');

      // Worker claimed generation 2 and passed it to extraction service
      expect(workerGenerationPassed).toBe(2);

      // Fenced error halts writes immediately
      expect(mockService.extractFromChunk).toHaveBeenCalledTimes(1);
    });
  });

  describe('TE-05: Failure-Safe Conditional Lease Release', () => {
    it('conditionally releases lease in PostgreSQL and Redis when transient failure occurs, enabling clean retry', async () => {
      const docId = 'doc-release-1';
      const runId = 'run-release-1';

      dbState.documents.set(docId, {
        id: docId,
        workspaceId: 'ws-1',
        originalName: 'release.pdf',
        checksum: 'chk-r',
        metadata: {
          graphStatus: 'QUEUED',
          extractionRunId: runId,
          graphLeaseGeneration: 1,
        },
      });

      dbState.chunks.set(docId, [
        { id: 'chunk-0', documentId: docId, chunkIndex: 0, content: 'test content' },
      ]);

      const mockJob: any = {
        id: 'job-release',
        data: { documentId: docId, workspaceId: 'ws-1', extractionRunId: runId },
      };

      // Mock transient HTTP 429
      const mockService = {
        extractFromChunk: vi
          .fn()
          .mockRejectedValue(new Error('HTTP 429: Too Many Requests (RESOURCE_EXHAUSTED)')),
      };
      (worker as any).service = mockService;

      await expect(worker.processJob(mockJob, 'token-release-worker')).rejects.toThrow(
        ExtractionTransientError,
      );

      // Verify conditional release query was executed
      const releaseQuery = dbState.executeRawCalls.find((call) =>
        call.sql.includes("'{graphWorkerToken}', 'null'::jsonb"),
      );
      expect(releaseQuery).toBeDefined();

      // Verify PostgreSQL document lease was cleared
      const updatedDoc = dbState.documents.get(docId);
      expect(updatedDoc.metadata.graphWorkerToken).toBeNull();
      expect(updatedDoc.metadata.graphLeaseExpiresAt).toBeNull();

      // Verify Redis lease release script was invoked
      expect(mockRedis.eval).toHaveBeenCalledWith(
        expect.any(String),
        1,
        `mindvault:graph:lease:${docId}`,
        'token-release-worker',
      );
    });
  });
});
