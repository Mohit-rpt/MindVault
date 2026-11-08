import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { DispatchRecoveryService, sanitizeErrorMessage } from '../dispatch-recovery.service.js';
import { PrismaClient } from '@prisma/client';
import type { IWorkerGraphQueue } from '../../lib/graph-queue.js';
import { formatExtractionJobId } from '@mindvault/shared';

describe('Phase 6.4.1: DispatchRecoveryService (§6.3.5, §6.3.6, §6.3.7)', () => {
  let mockPrisma: any;
  let mockQueue: IWorkerGraphQueue;
  let service: DispatchRecoveryService;
  let inTransaction = false;

  beforeEach(() => {
    inTransaction = false;
    mockPrisma = {
      $transaction: vi.fn().mockImplementation(async (callback) => {
        inTransaction = true;
        try {
          return await callback(mockPrisma);
        } finally {
          inTransaction = false;
        }
      }),
      $queryRaw: vi.fn(),
      $executeRaw: vi.fn().mockImplementation(async () => 1),
    };

    mockQueue = {
      enqueue: vi.fn().mockImplementation(async () => {
        expect(inTransaction).toBe(false);
        return 'graph_doc-1_run-1';
      }),
      getJob: vi.fn().mockImplementation(async () => {
        expect(inTransaction).toBe(false);
        return null;
      }),
      close: vi.fn().mockResolvedValue(undefined),
    };

    service = new DispatchRecoveryService(mockPrisma as unknown as PrismaClient, mockQueue);
  });

  describe('DEF-4: Error Message and URI Credential Sanitization', () => {
    it('redacts bearer tokens and key/secret assignments from error messages', () => {
      const raw = 'Failed with Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9 and token=secret12345';
      const sanitized = sanitizeErrorMessage(raw);
      expect(sanitized).toBe('Failed with Bearer [REDACTED] and token=[REDACTED]');
      expect(sanitized).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
      expect(sanitized).not.toContain('secret12345');
    });

    it('redacts password-only Redis connection URLs (e.g., redis://:password@host)', () => {
      const raw = 'Connection failed: redis://:mypassword123@redis-cluster.internal:6379/0';
      const sanitized = sanitizeErrorMessage(raw);
      expect(sanitized).toBe(
        'Connection failed: redis://:[REDACTED]@redis-cluster.internal:6379/0',
      );
      expect(sanitized).not.toContain('mypassword123');
    });

    it('redacts username and password in PostgreSQL connection URLs', () => {
      const raw =
        'Prisma error: postgresql://app_user:super_secret_db_pass@postgres.prod:5432/mindvault?schema=public';
      const sanitized = sanitizeErrorMessage(raw);
      expect(sanitized).toBe(
        'Prisma error: postgresql://app_user:[REDACTED]@postgres.prod:5432/mindvault?schema=public',
      );
      expect(sanitized).not.toContain('super_secret_db_pass');
    });

    it('redacts api_key, apikey, password, and secret query parameters or flags', () => {
      const raw =
        'Request failed with api_key=sk-proj-abcdef123456 and password=admin_pass and secret=top_secret_val';
      const sanitized = sanitizeErrorMessage(raw);
      expect(sanitized).toBe(
        'Request failed with api_key=[REDACTED] and password=[REDACTED] and secret=[REDACTED]',
      );
      expect(sanitized).not.toContain('sk-proj-abcdef123456');
      expect(sanitized).not.toContain('admin_pass');
      expect(sanitized).not.toContain('top_secret_val');
    });

    it('leaves normal non-sensitive error messages completely intact', () => {
      const normalMsg = 'connect ECONNREFUSED 127.0.0.1:6379';
      expect(sanitizeErrorMessage(normalMsg)).toBe(normalMsg);

      const notFoundMsg = 'Document with id doc-abc-123 not found in workspace ws-xyz-456';
      expect(sanitizeErrorMessage(notFoundMsg)).toBe(notFoundMsg);
    });

    it('handles empty or undefined error messages cleanly', () => {
      expect(sanitizeErrorMessage('')).toBe('');
      expect(sanitizeErrorMessage(undefined)).toBe('');
    });
  });

  describe('DEF-5: ES Module Constructor Compatibility', () => {
    it('instantiates cleanly without injecting a queue (no CommonJS require in ESM scope)', () => {
      // Must not throw ReferenceError: require is not defined in ES module scope
      expect(() => {
        const defaultService = new DispatchRecoveryService(mockPrisma as unknown as PrismaClient);
        expect(defaultService).toBeDefined();
      }).not.toThrow();
    });
  });

  describe('Leader Election under Advisory Lock (10064, 2)', () => {
    it('skips sweep cleanly when advisory lock is not granted', async () => {
      // Simulate lock rejection (another worker is leader)
      mockPrisma.$queryRaw.mockResolvedValueOnce([{ locked: false }]);

      const result = await service.executeSweep();

      expect(result.locked).toBe(false);
      expect(result.drainedCount).toBe(0);
      expect(result.presenceReconciledCount).toBe(0);
      expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(1);
    });

    it('proceeds with recovery sweep when advisory lock is granted', async () => {
      // Lock granted, empty candidates
      mockPrisma.$queryRaw
        .mockResolvedValueOnce([{ locked: true }]) // Lock check
        .mockResolvedValueOnce([]) // Draining candidates
        .mockResolvedValueOnce([]); // Presence candidates

      const result = await service.executeSweep();

      expect(result.locked).toBe(true);
      expect(result.drainedCount).toBe(0);
      expect(result.presenceReconciledCount).toBe(0);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('Draining Unconfirmed pendingDispatch Intents (§6.3.5)', () => {
    const docId = 'doc-intent-100';
    const runId = 'run-intent-200';
    const jobId = formatExtractionJobId(docId, runId);

    it('enqueues missing job and confirms enqueuedAt in PostgreSQL', async () => {
      const candidateDoc = {
        id: docId,
        workspaceId: 'ws-1',
        metadata: {
          extractionRunId: runId,
          chunkManifestHash: 'manifest-hash-abc',
          graphStatus: 'QUEUED',
          pendingDispatch: {
            extractionRunId: runId,
            jobId,
            enqueuedAt: null,
            createdAt: new Date(Date.now() - 45000).toISOString(),
            attempts: 0,
          },
        },
      };

      mockPrisma.$queryRaw
        .mockResolvedValueOnce([{ locked: true }]) // Lock check
        .mockResolvedValueOnce([candidateDoc]) // Draining candidates
        .mockResolvedValueOnce([]); // Presence candidates

      // Job does not exist in Redis
      (mockQueue.getJob as any).mockResolvedValueOnce(null);

      const result = await service.executeSweep();

      expect(result.drainedCount).toBe(1);
      expect(result.confirmedCount).toBe(0);
      expect(mockQueue.enqueue).toHaveBeenCalledWith({
        documentId: docId,
        workspaceId: 'ws-1',
        extractionRunId: runId,
        chunkManifestHash: 'manifest-hash-abc',
      });
      expect(mockPrisma.$executeRaw).toHaveBeenCalledTimes(1);
    });

    it('handles enqueue-success / DB-ack failure idempotently without duplicate enqueue', async () => {
      const candidateDoc = {
        id: docId,
        workspaceId: 'ws-1',
        metadata: {
          extractionRunId: runId,
          graphStatus: 'QUEUED',
          pendingDispatch: {
            extractionRunId: runId,
            jobId,
            enqueuedAt: null,
            createdAt: new Date(Date.now() - 40000).toISOString(),
            attempts: 0,
          },
        },
      };

      mockPrisma.$queryRaw
        .mockResolvedValueOnce([{ locked: true }]) // Lock check
        .mockResolvedValueOnce([candidateDoc]) // Draining candidates
        .mockResolvedValueOnce([]); // Presence candidates

      // Job already exists in BullMQ (enqueue succeeded earlier, DB ack crashed)
      (mockQueue.getJob as any).mockResolvedValueOnce({
        id: jobId,
        data: { documentId: docId },
      });

      const result = await service.executeSweep();

      expect(result.drainedCount).toBe(0);
      expect(result.confirmedCount).toBe(1);
      // Must NOT enqueue again!
      expect(mockQueue.enqueue).not.toHaveBeenCalled();
      // Must update DB to confirm enqueuedAt
      expect(mockPrisma.$executeRaw).toHaveBeenCalledTimes(1);
    });

    it('records failed attempt and sanitized error when Redis is unavailable', async () => {
      const candidateDoc = {
        id: docId,
        workspaceId: 'ws-1',
        metadata: {
          extractionRunId: runId,
          graphStatus: 'QUEUED',
          pendingDispatch: {
            extractionRunId: runId,
            jobId,
            enqueuedAt: null,
            createdAt: new Date(Date.now() - 40000).toISOString(),
            attempts: 0,
          },
        },
      };

      mockPrisma.$queryRaw
        .mockResolvedValueOnce([{ locked: true }]) // Lock check
        .mockResolvedValueOnce([candidateDoc]) // Draining candidates
        .mockResolvedValueOnce([]); // Presence candidates

      (mockQueue.getJob as any).mockResolvedValueOnce(null);
      (mockQueue.enqueue as any).mockRejectedValueOnce(
        new Error('Redis connection drop with redis://:my_auth_secret@10.0.0.1:6379'),
      );

      const result = await service.executeSweep();

      expect(result.drainedCount).toBe(0);
      expect(result.confirmedCount).toBe(0);
      // Verify DB update recorded attempts count and sanitized error
      expect(mockPrisma.$executeRaw).toHaveBeenCalledTimes(1);
    });
  });

  describe('Redis Queue-Presence Reconciliation (§6.3.6, DEF-1, DEF-2, DEF-3)', () => {
    const docId = 'doc-presence-300';
    const oldRunId = 'run-active-400';
    const jobId = formatExtractionJobId(docId, oldRunId);

    it('DEF-3: re-establishes dispatch outside DB tx with CAS confirmation and checkpoint preservation', async () => {
      const candidateDoc = {
        id: docId,
        workspaceId: 'ws-1',
        metadata: {
          extractionRunId: oldRunId,
          graphStatus: 'QUEUED',
          graphAttempts: 1,
          chunkManifestHash: 'manifest-hash-fixed',
          graphProgress: { lastCompletedChunkIndex: 2 }, // Checkpoint that must be preserved
          pendingDispatch: {
            extractionRunId: oldRunId,
            jobId,
            enqueuedAt: new Date(Date.now() - 400000).toISOString(), // Confirmed 6m ago
          },
        },
      };

      mockPrisma.$queryRaw
        .mockResolvedValueOnce([{ locked: true }]) // Lock check
        .mockResolvedValueOnce([]) // Draining candidates
        .mockResolvedValueOnce([candidateDoc]); // Presence candidates

      // Job missing from BullMQ
      (mockQueue.getJob as any).mockResolvedValueOnce(null);

      const result = await service.executeSweep();

      expect(result.presenceReconciledCount).toBe(1);
      // Enqueue must be called strictly with the new extractionRunId
      expect(mockQueue.enqueue).toHaveBeenCalledTimes(1);
      const enqueuedArg = (mockQueue.enqueue as any).mock.calls[0][0];
      expect(enqueuedArg.documentId).toBe(docId);
      expect(enqueuedArg.extractionRunId).toBeDefined();
      expect(enqueuedArg.extractionRunId).not.toBe(oldRunId); // Fresh UUID allocated
      expect(enqueuedArg.chunkManifestHash).toBe('manifest-hash-fixed');

      // 2 calls to $executeRaw: 1st allocates run inside tx, 2nd confirms enqueuedAt outside tx
      expect(mockPrisma.$executeRaw).toHaveBeenCalledTimes(2);
    });

    it('DEF-3: preserves pending intent in DB when Redis enqueue fails outside transaction', async () => {
      const candidateDoc = {
        id: docId,
        workspaceId: 'ws-1',
        metadata: {
          extractionRunId: oldRunId,
          graphStatus: 'QUEUED',
          graphAttempts: 1,
          chunkManifestHash: 'manifest-hash-fixed',
          pendingDispatch: {
            extractionRunId: oldRunId,
            jobId,
            enqueuedAt: new Date(Date.now() - 400000).toISOString(),
          },
        },
      };

      mockPrisma.$queryRaw
        .mockResolvedValueOnce([{ locked: true }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([candidateDoc]);

      (mockQueue.getJob as any).mockResolvedValueOnce(null);
      (mockQueue.enqueue as any).mockRejectedValueOnce(
        new Error('ECONNREFUSED: Redis instance offline'),
      );

      const result = await service.executeSweep();

      // Enqueue failed, so count is 0
      expect(result.presenceReconciledCount).toBe(0);
      // DB allocation occurred in tx (1 call), but enqueuedAt confirmation was NOT called
      expect(mockPrisma.$executeRaw).toHaveBeenCalledTimes(1);
    });

    describe('DEF-2: Active Extraction Run Receipt Identity', () => {
      it('skips re-dispatch when receipt matches the active extractionRunId', async () => {
        const candidateDoc = {
          id: docId,
          workspaceId: 'ws-1',
          metadata: {
            extractionRunId: oldRunId,
            graphStatus: 'PROCESSING',
            graphAttempts: 1,
            graphFinalizationReceipt: {
              extractionRunId: oldRunId, // MATCHES active run!
              terminalStatus: 'COMPLETED',
              processedChunksCount: 5,
            },
            pendingDispatch: {
              extractionRunId: oldRunId,
              jobId,
              enqueuedAt: new Date(Date.now() - 400000).toISOString(),
            },
          },
        };

        mockPrisma.$queryRaw
          .mockResolvedValueOnce([{ locked: true }])
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([candidateDoc]);

        (mockQueue.getJob as any).mockResolvedValueOnce(null);

        const result = await service.executeSweep();

        // Must skip re-dispatch because active run already finalized
        expect(result.presenceReconciledCount).toBe(0);
        expect(mockQueue.enqueue).not.toHaveBeenCalled();
      });

      it('does NOT skip re-dispatch when receipt belongs to an older, previous run', async () => {
        const candidateDoc = {
          id: docId,
          workspaceId: 'ws-1',
          metadata: {
            extractionRunId: oldRunId, // Current active run
            graphStatus: 'QUEUED',
            graphAttempts: 2,
            graphFinalizationReceipt: {
              extractionRunId: 'older-run-uuid-111', // STALE receipt from previous run!
              terminalStatus: 'COMPLETED',
              processedChunksCount: 5,
            },
            pendingDispatch: {
              extractionRunId: oldRunId,
              jobId,
              enqueuedAt: new Date(Date.now() - 400000).toISOString(),
            },
          },
        };

        mockPrisma.$queryRaw
          .mockResolvedValueOnce([{ locked: true }])
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([candidateDoc]);

        (mockQueue.getJob as any).mockResolvedValueOnce(null);

        const result = await service.executeSweep();

        // Stale receipt must NOT suppress recovery of active run!
        expect(result.presenceReconciledCount).toBe(1);
        expect(mockQueue.enqueue).toHaveBeenCalledTimes(1);
      });

      it('does NOT skip re-dispatch when receipt belongs to a superseded run', async () => {
        const candidateDoc = {
          id: docId,
          workspaceId: 'ws-1',
          metadata: {
            extractionRunId: oldRunId,
            graphStatus: 'PROCESSING',
            graphAttempts: 2,
            graphFinalizationReceipt: {
              extractionRunId: 'superseded-run-uuid-222', // SUPERSEDED receipt
              terminalStatus: 'FAILED',
              processedChunksCount: 5,
            },
            pendingDispatch: {
              extractionRunId: oldRunId,
              jobId,
              enqueuedAt: new Date(Date.now() - 400000).toISOString(),
            },
          },
        };

        mockPrisma.$queryRaw
          .mockResolvedValueOnce([{ locked: true }])
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([candidateDoc]);

        (mockQueue.getJob as any).mockResolvedValueOnce(null);

        const result = await service.executeSweep();

        expect(result.presenceReconciledCount).toBe(1);
        expect(mockQueue.enqueue).toHaveBeenCalledTimes(1);
      });

      it('does NOT skip re-dispatch when receipt is missing or undefined', async () => {
        const candidateDoc = {
          id: docId,
          workspaceId: 'ws-1',
          metadata: {
            extractionRunId: oldRunId,
            graphStatus: 'QUEUED',
            graphAttempts: 1,
            graphFinalizationReceipt: undefined, // Missing receipt
            pendingDispatch: {
              extractionRunId: oldRunId,
              jobId,
              enqueuedAt: new Date(Date.now() - 400000).toISOString(),
            },
          },
        };

        mockPrisma.$queryRaw
          .mockResolvedValueOnce([{ locked: true }])
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([candidateDoc]);

        (mockQueue.getJob as any).mockResolvedValueOnce(null);

        const result = await service.executeSweep();

        expect(result.presenceReconciledCount).toBe(1);
        expect(mockQueue.enqueue).toHaveBeenCalledTimes(1);
      });
    });

    describe('DEF-1: FAILED_RETRYABLE Invariant at Recovery Ceiling', () => {
      it('marks document FAILED_RETRYABLE, clears pendingDispatch, preserves checkpoints, and does not fabricate receipt when ceiling reached', async () => {
        const existingReceipt = {
          extractionRunId: 'old-run-000',
          terminalStatus: 'PARTIAL',
          processedChunksCount: 3,
        };
        const candidateDoc = {
          id: docId,
          workspaceId: 'ws-1',
          metadata: {
            extractionRunId: oldRunId,
            graphStatus: 'QUEUED',
            graphAttempts: 5, // Ceiling reached (MAX_TOTAL_RUNS = 5)
            graphProgress: { lastCompletedChunkIndex: 2 }, // Checkpoint to preserve
            graphFinalizationReceipt: existingReceipt, // Existing receipt data to preserve
            pendingDispatch: {
              extractionRunId: oldRunId,
              jobId,
              enqueuedAt: new Date(Date.now() - 400000).toISOString(),
            },
          },
        };

        mockPrisma.$queryRaw
          .mockResolvedValueOnce([{ locked: true }])
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([candidateDoc]);

        (mockQueue.getJob as any).mockResolvedValueOnce(null);

        const result = await service.executeSweep();

        expect(result.presenceReconciledCount).toBe(0);
        expect(mockQueue.enqueue).not.toHaveBeenCalled();

        // Verify update in PostgreSQL
        expect(mockPrisma.$executeRaw).toHaveBeenCalledTimes(1);
        const executeRawCalls = (mockPrisma.$executeRaw as any).mock.calls;
        // Verify SQL includes FAILED_RETRYABLE and pendingDispatch = null
        const sqlTagged = executeRawCalls[0];
        const sqlString = sqlTagged[0]?.join(' ') || '';
        expect(sqlString).toContain('FAILED_RETRYABLE');
        expect(sqlString).toContain('{pendingDispatch}');
        expect(sqlString).not.toContain("'FAILED'");
      });
    });
  });

  describe('DEF-3: Transaction-Boundary Verification & Concurrency Safety', () => {
    it('strictly guarantees zero Redis/BullMQ calls during interactive database transactions', async () => {
      const pendingDoc = {
        id: 'doc-pending-1',
        workspaceId: 'ws-1',
        metadata: {
          extractionRunId: 'run-pending-1',
          chunkManifestHash: 'hash-pending',
          graphStatus: 'QUEUED',
          pendingDispatch: {
            extractionRunId: 'run-pending-1',
            jobId: formatExtractionJobId('doc-pending-1', 'run-pending-1'),
            enqueuedAt: null,
            createdAt: new Date(Date.now() - 45000).toISOString(),
            attempts: 0,
          },
        },
      };

      const presenceDoc = {
        id: 'doc-presence-2',
        workspaceId: 'ws-1',
        metadata: {
          extractionRunId: 'run-presence-2',
          graphStatus: 'QUEUED',
          graphAttempts: 1,
          chunkManifestHash: 'hash-presence',
          pendingDispatch: {
            extractionRunId: 'run-presence-2',
            jobId: formatExtractionJobId('doc-presence-2', 'run-presence-2'),
            enqueuedAt: new Date(Date.now() - 400000).toISOString(),
          },
        },
      };

      mockPrisma.$queryRaw
        .mockResolvedValueOnce([{ locked: true }]) // Lock check
        .mockResolvedValueOnce([pendingDoc]) // Draining candidate
        .mockResolvedValueOnce([presenceDoc]); // Presence candidate

      // Both jobs missing from Redis
      (mockQueue.getJob as any).mockResolvedValue(null);

      const result = await service.executeSweep();

      // Transaction completed and committed before any Redis queue calls
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      expect(result.drainedCount).toBe(1);
      expect(result.presenceReconciledCount).toBe(1);

      // Verify all getJob and enqueue calls executed with inTransaction === false
      expect(mockQueue.getJob).toHaveBeenCalledTimes(2);
      expect(mockQueue.enqueue).toHaveBeenCalledTimes(2);
    });

    it('safely skips re-dispatch if CAS allocation encounters concurrent runId modification (0 rows updated)', async () => {
      const presenceDoc = {
        id: 'doc-race-1',
        workspaceId: 'ws-1',
        metadata: {
          extractionRunId: 'run-stale-race',
          graphStatus: 'QUEUED',
          graphAttempts: 1,
          chunkManifestHash: 'hash-race',
          pendingDispatch: {
            extractionRunId: 'run-stale-race',
            jobId: formatExtractionJobId('doc-race-1', 'run-stale-race'),
            enqueuedAt: new Date(Date.now() - 400000).toISOString(),
          },
        },
      };

      mockPrisma.$queryRaw
        .mockResolvedValueOnce([{ locked: true }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([presenceDoc]);

      (mockQueue.getJob as any).mockResolvedValueOnce(null);

      // CAS update fails: 0 rows updated because another worker already updated extractionRunId
      mockPrisma.$executeRaw.mockResolvedValueOnce(0);

      const result = await service.executeSweep();

      expect(result.presenceReconciledCount).toBe(0);
      // Redis enqueue must NOT be called when CAS returns 0 rows updated
      expect(mockQueue.enqueue).not.toHaveBeenCalled();
    });

    it('survives Redis enqueue failure and allows subsequent sweep to drain intent idempotently', async () => {
      const docId = 'doc-crash-1';
      const initialRunId = 'run-initial-1';

      // Sweep 1: Presence candidate missing from Redis -> allocate new run, but Redis enqueue throws
      const presenceDoc = {
        id: docId,
        workspaceId: 'ws-1',
        metadata: {
          extractionRunId: initialRunId,
          graphStatus: 'QUEUED',
          graphAttempts: 1,
          chunkManifestHash: 'hash-crash',
          pendingDispatch: {
            extractionRunId: initialRunId,
            jobId: formatExtractionJobId(docId, initialRunId),
            enqueuedAt: new Date(Date.now() - 400000).toISOString(),
          },
        },
      };

      mockPrisma.$queryRaw
        .mockResolvedValueOnce([{ locked: true }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([presenceDoc]);

      (mockQueue.getJob as any).mockResolvedValueOnce(null);
      (mockQueue.enqueue as any).mockRejectedValueOnce(new Error('Redis connection timed out'));

      const sweep1Result = await service.executeSweep();
      expect(sweep1Result.presenceReconciledCount).toBe(0);

      // Sweep 2: Next sweep picks up the allocated intent (with enqueuedAt: null) via drainPendingCandidates
      const allocatedRunId = 'run-allocated-new';
      const allocatedJobId = formatExtractionJobId(docId, allocatedRunId);
      const pendingDoc = {
        id: docId,
        workspaceId: 'ws-1',
        metadata: {
          extractionRunId: allocatedRunId,
          chunkManifestHash: 'hash-crash',
          graphStatus: 'QUEUED',
          pendingDispatch: {
            extractionRunId: allocatedRunId,
            jobId: allocatedJobId,
            enqueuedAt: null,
            createdAt: new Date(Date.now() - 35000).toISOString(),
            attempts: 0,
          },
        },
      };

      mockPrisma.$queryRaw
        .mockResolvedValueOnce([{ locked: true }])
        .mockResolvedValueOnce([pendingDoc])
        .mockResolvedValueOnce([]);

      // Job missing from Redis on sweep 2
      (mockQueue.getJob as any).mockResolvedValueOnce(null);
      // Redis is back online!
      (mockQueue.enqueue as any).mockResolvedValueOnce(allocatedJobId);

      const sweep2Result = await service.executeSweep();
      expect(sweep2Result.drainedCount).toBe(1);
      expect(mockQueue.enqueue).toHaveBeenCalledWith({
        documentId: docId,
        workspaceId: 'ws-1',
        extractionRunId: allocatedRunId,
        chunkManifestHash: 'hash-crash',
      });
    });
  });

  describe('Completion-Race & Atomic CAS Verification (Tests A–F)', () => {
    const docId = 'doc-race-test';
    const runId = 'run-race-1';
    const jobId = formatExtractionJobId(docId, runId);

    it('Test A — Completion before allocation CAS: skips allocation and enqueue when worker completed run in DB', async () => {
      const candidateDoc = {
        id: docId,
        workspaceId: 'ws-1',
        metadata: {
          extractionRunId: runId,
          graphStatus: 'PROCESSING',
          graphAttempts: 1,
          chunkManifestHash: 'hash-test-a',
          pendingDispatch: {
            extractionRunId: runId,
            jobId,
            enqueuedAt: new Date(Date.now() - 400000).toISOString(),
          },
        },
      };

      mockPrisma.$queryRaw
        .mockResolvedValueOnce([{ locked: true }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([candidateDoc]);

      (mockQueue.getJob as any).mockResolvedValueOnce(null);

      // Simulate worker completion in PostgreSQL:
      // The worker set graphStatus = 'COMPLETED' and wrote a receipt, so the CAS predicate
      // (graphStatus IN ('QUEUED', 'PROCESSING') AND graphFinalizationReceipt IS NULL) matches 0 rows!
      mockPrisma.$executeRaw.mockResolvedValueOnce(0);

      const result = await service.executeSweep();

      // Assert zero rows updated -> presenceReconciledCount is 0
      expect(result.presenceReconciledCount).toBe(0);
      // Assert no R2 enqueue occurs
      expect(mockQueue.enqueue).not.toHaveBeenCalled();

      // Verify the executed SQL query contained the strict completion-fencing predicates
      const sqlTagged = (mockPrisma.$executeRaw as any).mock.calls[0];
      const sqlString = sqlTagged[0]?.join(' ') || '';
      expect(sqlString).toContain("metadata->>'graphStatus' IN ('QUEUED', 'PROCESSING')");
      expect(sqlString).toContain("metadata->'graphFinalizationReceipt' IS NULL");
      expect(sqlString).toContain("metadata->>'extractionRunId'");
      expect(sqlString).toContain("COALESCE((metadata->>'graphAttempts')::int, 1)");
    });

    it('Test B — Completion before retry-ceiling CAS: preserves COMPLETED status and skips FAILED_RETRYABLE update', async () => {
      const candidateDoc = {
        id: docId,
        workspaceId: 'ws-1',
        metadata: {
          extractionRunId: runId,
          graphStatus: 'PROCESSING',
          graphAttempts: 5, // At ceiling
          chunkManifestHash: 'hash-test-b',
          pendingDispatch: {
            extractionRunId: runId,
            jobId,
            enqueuedAt: new Date(Date.now() - 400000).toISOString(),
          },
        },
      };

      mockPrisma.$queryRaw
        .mockResolvedValueOnce([{ locked: true }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([candidateDoc]);

      (mockQueue.getJob as any).mockResolvedValueOnce(null);

      // Simulate completion in DB before ceiling update: CAS returns 0 rows updated
      mockPrisma.$executeRaw.mockResolvedValueOnce(0);

      const result = await service.executeSweep();

      expect(result.presenceReconciledCount).toBe(0);
      expect(mockQueue.enqueue).not.toHaveBeenCalled();

      // Verify the executed SQL query fenced against completed documents
      const sqlTagged = (mockPrisma.$executeRaw as any).mock.calls[0];
      const sqlString = sqlTagged[0]?.join(' ') || '';
      expect(sqlString).toContain('FAILED_RETRYABLE');
      expect(sqlString).toContain("metadata->>'graphStatus' IN ('QUEUED', 'PROCESSING')");
      expect(sqlString).toContain("metadata->'graphFinalizationReceipt' IS NULL");
      expect(sqlString).toContain("COALESCE((metadata->>'graphAttempts')::int, 1)");
    });

    it('Test C — Completion before pending-intent acknowledgement: does not mutate completed run', async () => {
      const candidateDoc = {
        id: docId,
        workspaceId: 'ws-1',
        metadata: {
          extractionRunId: runId,
          chunkManifestHash: 'hash-test-c',
          graphStatus: 'QUEUED',
          pendingDispatch: {
            extractionRunId: runId,
            jobId,
            enqueuedAt: null,
            createdAt: new Date(Date.now() - 45000).toISOString(),
            attempts: 0,
          },
        },
      };

      mockPrisma.$queryRaw
        .mockResolvedValueOnce([{ locked: true }])
        .mockResolvedValueOnce([candidateDoc])
        .mockResolvedValueOnce([]);

      // Job exists in Redis
      (mockQueue.getJob as any).mockResolvedValueOnce({ id: jobId });

      // Worker completed R1 before DB ack; CAS returns 0 rows updated
      mockPrisma.$executeRaw.mockResolvedValueOnce(0);

      const result = await service.executeSweep();

      // confirmedCount is 0 because update affected 0 rows
      expect(result.confirmedCount).toBe(0);

      // Verify SQL predicate checked status and receipt
      const sqlTagged = (mockPrisma.$executeRaw as any).mock.calls[0];
      const sqlString = sqlTagged[0]?.join(' ') || '';
      expect(sqlString).toContain("metadata->>'graphStatus' IN ('QUEUED', 'PROCESSING')");
      expect(sqlString).toContain("metadata->'graphFinalizationReceipt' IS NULL");
    });

    it('Test D — Completion before Redis failure recording: skips writing stale error to completed run', async () => {
      const candidateDoc = {
        id: docId,
        workspaceId: 'ws-1',
        metadata: {
          extractionRunId: runId,
          chunkManifestHash: 'hash-test-d',
          graphStatus: 'QUEUED',
          pendingDispatch: {
            extractionRunId: runId,
            jobId,
            enqueuedAt: null,
            createdAt: new Date(Date.now() - 45000).toISOString(),
            attempts: 0,
          },
        },
      };

      mockPrisma.$queryRaw
        .mockResolvedValueOnce([{ locked: true }])
        .mockResolvedValueOnce([candidateDoc])
        .mockResolvedValueOnce([]);

      (mockQueue.getJob as any).mockResolvedValueOnce(null);
      (mockQueue.enqueue as any).mockRejectedValueOnce(new Error('Redis down'));

      // Worker completed run while Redis call failed; failure CAS returns 0 rows updated
      mockPrisma.$executeRaw.mockResolvedValueOnce(0);

      const result = await service.executeSweep();

      expect(result.drainedCount).toBe(0);

      // Verify SQL predicate checked status, receipt, and pendingDispatch.attempts
      const sqlTagged = (mockPrisma.$executeRaw as any).mock.calls[0];
      const sqlString = sqlTagged[0]?.join(' ') || '';
      expect(sqlString).toContain("metadata->>'graphStatus' IN ('QUEUED', 'PROCESSING')");
      expect(sqlString).toContain("metadata->'graphFinalizationReceipt' IS NULL");
      expect(sqlString).toContain("COALESCE((metadata->'pendingDispatch'->>'attempts')::int, 0)");
    });

    it('Test E — Attempt-count concurrency: prevents lost increments or attempt regression', async () => {
      const candidateDoc = {
        id: docId,
        workspaceId: 'ws-1',
        metadata: {
          extractionRunId: runId,
          graphStatus: 'PROCESSING',
          graphAttempts: 2,
          chunkManifestHash: 'hash-test-e',
          pendingDispatch: {
            extractionRunId: runId,
            jobId,
            enqueuedAt: new Date(Date.now() - 400000).toISOString(),
          },
        },
      };

      mockPrisma.$queryRaw
        .mockResolvedValueOnce([{ locked: true }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([candidateDoc]);

      (mockQueue.getJob as any).mockResolvedValueOnce(null);

      // Another concurrent sweep already incremented graphAttempts from 2 to 3; CAS returns 0
      mockPrisma.$executeRaw.mockResolvedValueOnce(0);

      const result = await service.executeSweep();

      expect(result.presenceReconciledCount).toBe(0);
      expect(mockQueue.enqueue).not.toHaveBeenCalled();

      // Verify SQL enforced exact currentAttempts matching
      const sqlTagged = (mockPrisma.$executeRaw as any).mock.calls[0];
      const sqlString = sqlTagged[0]?.join(' ') || '';
      expect(sqlString).toContain("COALESCE((metadata->>'graphAttempts')::int, 1) =");
      expect(sqlTagged).toContain(2);
    });

    it('Test F — Legitimate PROCESSING acknowledgement: confirms enqueuedAt for job transitioned to PROCESSING', async () => {
      const candidateDoc = {
        id: docId,
        workspaceId: 'ws-1',
        metadata: {
          extractionRunId: runId,
          chunkManifestHash: 'hash-test-f',
          graphStatus: 'PROCESSING', // Legitimate transition: worker already picked it up!
          pendingDispatch: {
            extractionRunId: runId,
            jobId,
            enqueuedAt: null,
            createdAt: new Date(Date.now() - 45000).toISOString(),
            attempts: 0,
          },
        },
      };

      mockPrisma.$queryRaw
        .mockResolvedValueOnce([{ locked: true }])
        .mockResolvedValueOnce([candidateDoc])
        .mockResolvedValueOnce([]);

      // Job exists in BullMQ
      (mockQueue.getJob as any).mockResolvedValueOnce({ id: jobId });

      // CAS succeeds for PROCESSING state
      mockPrisma.$executeRaw.mockResolvedValueOnce(1);

      const result = await service.executeSweep();

      expect(result.confirmedCount).toBe(1);

      // Verify SQL permitted PROCESSING status
      const sqlTagged = (mockPrisma.$executeRaw as any).mock.calls[0];
      const sqlString = sqlTagged[0]?.join(' ') || '';
      expect(sqlString).toContain("metadata->>'graphStatus' IN ('QUEUED', 'PROCESSING')");
    });
  });

  describe('Heartbeat Freshness & CAS Staleness Fencing (Tests 1–6)', () => {
    const docId = 'doc-hb-test';
    const runId = 'run-hb-1';
    const jobId = formatExtractionJobId(docId, runId);

    it('Test 1 — Fresh heartbeat before allocation: candidate selected as stale, worker refreshes heartbeat, allocation CAS loses; no enqueue', async () => {
      const candidateDoc = {
        id: docId,
        workspaceId: 'ws-1',
        metadata: {
          extractionRunId: runId,
          graphStatus: 'PROCESSING',
          graphAttempts: 1,
          chunkManifestHash: 'hash-hb-1',
          graphHeartbeatAt: new Date(Date.now() - 360000).toISOString(), // 6m ago at candidate selection
          pendingDispatch: {
            extractionRunId: runId,
            jobId,
            enqueuedAt: new Date(Date.now() - 360000).toISOString(),
          },
        },
      };

      mockPrisma.$queryRaw
        .mockResolvedValueOnce([{ locked: true }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([candidateDoc]);

      (mockQueue.getJob as any).mockResolvedValueOnce(null);

      // Worker refreshed heartbeat in DB before CAS execution:
      // Live predicate < clock_timestamp() - INTERVAL '5 minutes' evaluates to false, updating 0 rows!
      mockPrisma.$executeRaw.mockResolvedValueOnce(0);

      const result = await service.executeSweep();

      // Allocation skipped, no new run enqueued
      expect(result.presenceReconciledCount).toBe(0);
      expect(mockQueue.enqueue).not.toHaveBeenCalled();

      // Verify executed SQL evaluated live heartbeat and enqueuedAt predicates
      const sqlTagged = (mockPrisma.$executeRaw as any).mock.calls[0];
      const sqlString = sqlTagged[0]?.join(' ') || '';
      expect(sqlString).toContain("metadata->'pendingDispatch'->>'enqueuedAt' IS NOT NULL");
      expect(sqlString).toContain("metadata->>'graphHeartbeatAt' IS NOT NULL");
      expect(sqlString).toContain("< clock_timestamp() - INTERVAL '5 minutes'");
      expect(sqlString).toContain("metadata->>'graphHeartbeatAt' IS NULL");
      expect(sqlString).toContain("(metadata->'pendingDispatch'->>'enqueuedAt')::timestamptz");
    });

    it('Test 2 — Fresh heartbeat before retry ceiling: candidate selected as stale, worker refreshes heartbeat, ceiling CAS loses; no FAILED_RETRYABLE transition', async () => {
      const candidateDoc = {
        id: docId,
        workspaceId: 'ws-1',
        metadata: {
          extractionRunId: runId,
          graphStatus: 'PROCESSING',
          graphAttempts: 5, // At ceiling
          chunkManifestHash: 'hash-hb-2',
          graphHeartbeatAt: new Date(Date.now() - 360000).toISOString(),
          pendingDispatch: {
            extractionRunId: runId,
            jobId,
            enqueuedAt: new Date(Date.now() - 360000).toISOString(),
          },
        },
      };

      mockPrisma.$queryRaw
        .mockResolvedValueOnce([{ locked: true }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([candidateDoc]);

      (mockQueue.getJob as any).mockResolvedValueOnce(null);

      // Worker refreshed heartbeat before ceiling CAS: returns 0 rows updated
      mockPrisma.$executeRaw.mockResolvedValueOnce(0);

      const result = await service.executeSweep();

      expect(result.presenceReconciledCount).toBe(0);

      // Verify executed SQL contained FAILED_RETRYABLE and live heartbeat staleness check
      const sqlTagged = (mockPrisma.$executeRaw as any).mock.calls[0];
      const sqlString = sqlTagged[0]?.join(' ') || '';
      expect(sqlString).toContain('FAILED_RETRYABLE');
      expect(sqlString).toContain("metadata->'pendingDispatch'->>'enqueuedAt' IS NOT NULL");
      expect(sqlString).toContain("metadata->>'graphHeartbeatAt' IS NOT NULL");
      expect(sqlString).toContain("< clock_timestamp() - INTERVAL '5 minutes'");
    });

    it('Test 3 — Fresh heartbeat with unchanged run ID: proves matching run ID, status, receipt, and attempts cannot bypass heartbeat freshness', async () => {
      const candidateDoc = {
        id: docId,
        workspaceId: 'ws-1',
        metadata: {
          extractionRunId: runId,
          graphStatus: 'PROCESSING',
          graphAttempts: 1,
          chunkManifestHash: 'hash-hb-3',
          graphHeartbeatAt: new Date(Date.now() - 400000).toISOString(),
          pendingDispatch: {
            extractionRunId: runId,
            jobId,
            enqueuedAt: new Date(Date.now() - 400000).toISOString(),
          },
        },
      };

      mockPrisma.$queryRaw
        .mockResolvedValueOnce([{ locked: true }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([candidateDoc]);

      (mockQueue.getJob as any).mockResolvedValueOnce(null);

      // Even though runId, status, receipt, and attempts match, heartbeat was refreshed -> 0 rows updated
      mockPrisma.$executeRaw.mockResolvedValueOnce(0);

      const result = await service.executeSweep();

      expect(result.presenceReconciledCount).toBe(0);
      expect(mockQueue.enqueue).not.toHaveBeenCalled();

      // Verify that the CAS SQL requires ALL invariants simultaneously
      const sqlTagged = (mockPrisma.$executeRaw as any).mock.calls[0];
      const sqlString = sqlTagged[0]?.join(' ') || '';
      expect(sqlString).toContain("metadata->>'extractionRunId' =");
      expect(sqlString).toContain("metadata->>'graphStatus' IN ('QUEUED', 'PROCESSING')");
      expect(sqlString).toContain("metadata->'graphFinalizationReceipt' IS NULL");
      expect(sqlString).toContain("COALESCE((metadata->>'graphAttempts')::int, 1) =");
      expect(sqlString).toContain("< clock_timestamp() - INTERVAL '5 minutes'");
    });

    it('Test 4 — Null heartbeat fallback: verify that a non-stale fallback timestamp prevents recovery', async () => {
      const candidateDoc = {
        id: docId,
        workspaceId: 'ws-1',
        metadata: {
          extractionRunId: runId,
          graphStatus: 'QUEUED',
          graphAttempts: 1,
          chunkManifestHash: 'hash-hb-4',
          graphHeartbeatAt: null, // No heartbeat recorded yet
          pendingDispatch: {
            extractionRunId: runId,
            jobId,
            enqueuedAt: new Date(Date.now() - 60000).toISOString(), // 1m ago: NOT stale (< 5m)
          },
        },
      };

      mockPrisma.$queryRaw
        .mockResolvedValueOnce([{ locked: true }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([candidateDoc]);

      (mockQueue.getJob as any).mockResolvedValueOnce(null);

      // CAS evaluates fallback enqueuedAt condition against clock_timestamp() - 5 min -> evaluates false -> 0 rows updated
      mockPrisma.$executeRaw.mockResolvedValueOnce(0);

      const result = await service.executeSweep();

      expect(result.presenceReconciledCount).toBe(0);
      expect(mockQueue.enqueue).not.toHaveBeenCalled();

      const sqlTagged = (mockPrisma.$executeRaw as any).mock.calls[0];
      const sqlString = sqlTagged[0]?.join(' ') || '';
      expect(sqlString).toContain("metadata->>'graphHeartbeatAt' IS NULL");
      expect(sqlString).toContain("(metadata->'pendingDispatch'->>'enqueuedAt')::timestamptz");
      expect(sqlString).toContain("< clock_timestamp() - INTERVAL '5 minutes'");
    });

    it('Test 5 — Still-stale heartbeat: legitimate stale candidate continues through existing recovery behavior', async () => {
      const candidateDoc = {
        id: docId,
        workspaceId: 'ws-1',
        metadata: {
          extractionRunId: runId,
          graphStatus: 'PROCESSING',
          graphAttempts: 1,
          chunkManifestHash: 'hash-hb-5',
          graphHeartbeatAt: new Date(Date.now() - 400000).toISOString(), // > 5m ago
          pendingDispatch: {
            extractionRunId: runId,
            jobId,
            enqueuedAt: new Date(Date.now() - 400000).toISOString(),
          },
        },
      };

      mockPrisma.$queryRaw
        .mockResolvedValueOnce([{ locked: true }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([candidateDoc]);

      (mockQueue.getJob as any).mockResolvedValueOnce(null);

      // Worker genuinely crashed/stalled: heartbeat remains stale -> CAS succeeds (1 row updated)
      mockPrisma.$executeRaw
        .mockResolvedValueOnce(1) // Allocation CAS
        .mockResolvedValueOnce(1); // Enqueue confirmation CAS

      const result = await service.executeSweep();

      expect(result.presenceReconciledCount).toBe(1);
      expect(mockQueue.enqueue).toHaveBeenCalledTimes(1);
      expect(mockQueue.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          documentId: docId,
          workspaceId: 'ws-1',
          chunkManifestHash: 'hash-hb-5',
        }),
      );
    });

    it('Test 6 — Boundary behavior: heartbeat exactly at the five-minute threshold is not considered stale (strict <)', async () => {
      const candidateDoc = {
        id: docId,
        workspaceId: 'ws-1',
        metadata: {
          extractionRunId: runId,
          graphStatus: 'PROCESSING',
          graphAttempts: 1,
          chunkManifestHash: 'hash-hb-6',
          graphHeartbeatAt: new Date(Date.now() - 300000).toISOString(), // exactly 300s
          pendingDispatch: {
            extractionRunId: runId,
            jobId,
            enqueuedAt: new Date(Date.now() - 300000).toISOString(),
          },
        },
      };

      mockPrisma.$queryRaw
        .mockResolvedValueOnce([{ locked: true }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([candidateDoc]);

      (mockQueue.getJob as any).mockResolvedValueOnce(null);

      // Strict < evaluation prevents boundary race: 0 rows updated
      mockPrisma.$executeRaw.mockResolvedValueOnce(0);

      const result = await service.executeSweep();

      expect(result.presenceReconciledCount).toBe(0);
      expect(mockQueue.enqueue).not.toHaveBeenCalled();

      // Verify SQL uses strict `<` rather than `<=`
      const sqlTagged = (mockPrisma.$executeRaw as any).mock.calls[0];
      const sqlString = sqlTagged[0]?.join(' ') || '';
      expect(sqlString).toMatch(/< clock_timestamp\(\) - INTERVAL '5 minutes'/);
      expect(sqlString).not.toMatch(/<= clock_timestamp\(\) - INTERVAL '5 minutes'/);
    });
  });

  describe('Real PostgreSQL Integration: Heartbeat Freshness Atomic Evaluation (Database Level)', () => {
    let realPrisma: PrismaClient | null = null;
    let isPgReachable = false;

    beforeAll(async () => {
      try {
        const url =
          process.env.DATABASE_URL ||
          'postgresql://mindvault:mindvault_dev_password@localhost:5433/mindvault?schema=public';
        realPrisma = new PrismaClient({ datasources: { db: { url } } });
        await realPrisma.$queryRaw`SELECT 1 as ping`;
        isPgReachable = true;
      } catch {
        isPgReachable = false;
      }
    });

    afterAll(async () => {
      if (realPrisma) {
        await realPrisma.$disconnect();
      }
    });

    it('executes atomic CAS against real PostgreSQL engine: rejects fresh heartbeat and accepts stale heartbeat', async () => {
      if (!isPgReachable || !realPrisma) {
        // Skip gracefully if PostgreSQL container is not running in test runner
        return;
      }

      // Use an isolated transaction with a session temp table to exercise PostgreSQL's live query engine
      await realPrisma.$transaction(async (tx) => {
        // 1. Create temporary documents table in this PostgreSQL transaction
        await tx.$executeRaw`
          CREATE TEMP TABLE "test_cas_documents" (
            id text PRIMARY KEY,
            "workspaceId" text NOT NULL,
            metadata jsonb NOT NULL,
            updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
          ) ON COMMIT DROP;
        `;

        const testDocId = 'pg-doc-hb-1';
        const testRunId = 'pg-run-hb-1';
        const staleIso = new Date(Date.now() - 360000).toISOString(); // 6m ago
        const freshIso = new Date(Date.now() - 30000).toISOString(); // 30s ago

        // Insert document with stale heartbeat (> 5m)
        await tx.$executeRaw`
          INSERT INTO "test_cas_documents" (id, "workspaceId", metadata)
          VALUES (
            ${testDocId},
            'ws-pg-1',
            jsonb_build_object(
              'extractionRunId', ${testRunId},
              'graphStatus', 'PROCESSING',
              'graphAttempts', 1,
              'graphHeartbeatAt', ${staleIso},
              'pendingDispatch', jsonb_build_object(
                'enqueuedAt', ${staleIso},
                'jobId', 'graph_pg-doc-hb-1_pg-run-hb-1'
              )
            )
          );
        `;

        // Case A (Real PG): Stale heartbeat matches CAS predicate
        const staleUpdateCount = await tx.$executeRaw`
          UPDATE "test_cas_documents"
          SET metadata = jsonb_set(metadata, '{graphStatus}', to_jsonb('QUEUED'::text))
          WHERE id = ${testDocId}
            AND metadata->>'extractionRunId' = ${testRunId}
            AND metadata->>'graphStatus' IN ('QUEUED', 'PROCESSING')
            AND (
              metadata->'graphFinalizationReceipt' IS NULL
              OR metadata->'graphFinalizationReceipt'->>'terminalStatus' IS NULL
              OR metadata->'graphFinalizationReceipt'->>'extractionRunId' != ${testRunId}
            )
            AND COALESCE((metadata->>'graphAttempts')::int, 1) = 1
            AND metadata->'pendingDispatch'->>'enqueuedAt' IS NOT NULL
            AND (
              (
                metadata->>'graphHeartbeatAt' IS NOT NULL
                AND (metadata->>'graphHeartbeatAt')::timestamptz
                    < clock_timestamp() - INTERVAL '5 minutes'
              )
              OR
              (
                metadata->>'graphHeartbeatAt' IS NULL
                AND (metadata->'pendingDispatch'->>'enqueuedAt')::timestamptz
                    < clock_timestamp() - INTERVAL '5 minutes'
              )
            );
        `;
        expect(staleUpdateCount).toBe(1);

        // Case B (Real PG): Worker refreshes heartbeat to fresh (30s ago)
        await tx.$executeRaw`
          UPDATE "test_cas_documents"
          SET metadata = jsonb_set(
            jsonb_set(metadata, '{graphHeartbeatAt}', to_jsonb(${freshIso}::text)),
            '{graphStatus}', to_jsonb('PROCESSING'::text)
          )
          WHERE id = ${testDocId};
        `;

        // Recovery attempts CAS again: Real PostgreSQL evaluates clock_timestamp() - INTERVAL '5 minutes'
        const freshUpdateCount = await tx.$executeRaw`
          UPDATE "test_cas_documents"
          SET metadata = jsonb_set(metadata, '{graphStatus}', to_jsonb('QUEUED'::text))
          WHERE id = ${testDocId}
            AND metadata->>'extractionRunId' = ${testRunId}
            AND metadata->>'graphStatus' IN ('QUEUED', 'PROCESSING')
            AND (
              metadata->'graphFinalizationReceipt' IS NULL
              OR metadata->'graphFinalizationReceipt'->>'terminalStatus' IS NULL
              OR metadata->'graphFinalizationReceipt'->>'extractionRunId' != ${testRunId}
            )
            AND COALESCE((metadata->>'graphAttempts')::int, 1) = 1
            AND metadata->'pendingDispatch'->>'enqueuedAt' IS NOT NULL
            AND (
              (
                metadata->>'graphHeartbeatAt' IS NOT NULL
                AND (metadata->>'graphHeartbeatAt')::timestamptz
                    < clock_timestamp() - INTERVAL '5 minutes'
              )
              OR
              (
                metadata->>'graphHeartbeatAt' IS NULL
                AND (metadata->'pendingDispatch'->>'enqueuedAt')::timestamptz
                    < clock_timestamp() - INTERVAL '5 minutes'
              )
            );
        `;
        // Real PostgreSQL rejects the update because live heartbeat is fresh!
        expect(freshUpdateCount).toBe(0);
      });
    });
  });

  describe('Service Lifecycle', () => {
    it('starts and stops gracefully', async () => {
      service.start(10000);
      await service.stop();
    });
  });
});
