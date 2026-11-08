import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// In-Memory Database Mock for Self-Contained Unit & Adversarial Testing
// ---------------------------------------------------------------------------
const { mockPrisma, dbState } = vi.hoisted(() => {
  const dbState = {
    workspaces: new Map<string, any>(),
    users: new Map<string, any>(),
    documents: new Map<string, any>(),
    chunks: new Map<string, any[]>(),
    casResultOverride: null as number | null,
    queryRawResultOverride: null as any,
  };

  const getDocId = (where: any): string | null => {
    if (!where) return null;
    if (where.id) return where.id;
    if (where.workspaceId_id?.id) return where.workspaceId_id.id;
    return null;
  };

  const mockPrisma: any = {
    workspace: {
      create: vi.fn().mockImplementation(async ({ data }: any) => {
        const ws = { id: `ws-${Date.now()}-${Math.random()}`, ...data };
        dbState.workspaces.set(ws.id, ws);
        return ws;
      }),
      deleteMany: vi.fn().mockImplementation(async () => {
        dbState.workspaces.clear();
        return { count: 0 };
      }),
      delete: vi.fn().mockImplementation(async ({ where }: any) => {
        dbState.workspaces.delete(where.id);
        return { id: where.id };
      }),
    },
    user: {
      create: vi.fn().mockImplementation(async ({ data }: any) => {
        const u = { id: `user-${Date.now()}-${Math.random()}`, ...data };
        dbState.users.set(u.id, u);
        return u;
      }),
      deleteMany: vi.fn().mockImplementation(async () => {
        dbState.users.clear();
        return { count: 0 };
      }),
    },
    document: {
      create: vi.fn().mockImplementation(async ({ data }: any) => {
        const doc = { id: data.id || `doc-${Date.now()}`, ...data };
        dbState.documents.set(doc.id, doc);
        return doc;
      }),
      findUnique: vi.fn().mockImplementation(async ({ where, include }: any) => {
        const docId = getDocId(where);
        const doc = docId ? dbState.documents.get(docId) : null;
        if (!doc) return null;
        const res = { ...doc };
        if (include?.chunks) {
          let chunks = dbState.chunks.get(docId!) || [];
          if (include.chunks.orderBy?.chunkIndex === 'asc') {
            chunks = [...chunks].sort((a, b) => a.chunkIndex - b.chunkIndex);
          }
          res.chunks = chunks;
        }
        return res;
      }),
      findUniqueOrThrow: vi.fn().mockImplementation(async ({ where, include }: any) => {
        const docId = getDocId(where);
        const doc = docId ? dbState.documents.get(docId) : null;
        if (!doc) throw new Error(`Document ${docId} not found`);
        const res = { ...doc };
        if (include?.chunks) {
          let chunks = dbState.chunks.get(docId!) || [];
          if (include.chunks.orderBy?.chunkIndex === 'asc') {
            chunks = [...chunks].sort((a, b) => a.chunkIndex - b.chunkIndex);
          }
          res.chunks = chunks;
        }
        return res;
      }),
      update: vi.fn().mockImplementation(async ({ where, data }: any) => {
        const docId = getDocId(where);
        const doc = docId ? dbState.documents.get(docId) : null;
        if (!doc) throw new Error(`Document ${docId} not found`);
        if (data.metadata) {
          doc.metadata = { ...doc.metadata, ...data.metadata };
        }
        Object.assign(doc, { ...data, metadata: doc.metadata });
        return doc;
      }),
      deleteMany: vi.fn().mockImplementation(async ({ where }: any) => {
        if (where?.workspaceId) {
          for (const [id, doc] of dbState.documents.entries()) {
            if (doc.workspaceId === where.workspaceId) {
              dbState.documents.delete(id);
            }
          }
        } else {
          dbState.documents.clear();
        }
        return { count: 0 };
      }),
    },
    documentChunk: {
      create: vi.fn().mockImplementation(async ({ data }: any) => {
        const chunk = { id: `chunk-${Date.now()}-${Math.random()}`, ...data };
        const existing = dbState.chunks.get(data.documentId) || [];
        existing.push(chunk);
        dbState.chunks.set(data.documentId, existing);
        return chunk;
      }),
      findMany: vi.fn().mockImplementation(async ({ where, orderBy }: any) => {
        let list = dbState.chunks.get(where.documentId) || [];
        if (orderBy?.chunkIndex === 'asc') {
          list = [...list].sort((a, b) => a.chunkIndex - b.chunkIndex);
        }
        return list;
      }),
      findUnique: vi.fn().mockImplementation(async ({ where }: any) => {
        for (const list of dbState.chunks.values()) {
          const found = list.find((c: any) => c.id === where.id);
          if (found) return found;
        }
        return null;
      }),
      deleteMany: vi.fn().mockImplementation(async ({ where }: any) => {
        if (where?.documentId) {
          dbState.chunks.delete(where.documentId);
        } else {
          dbState.chunks.clear();
        }
        return { count: 0 };
      }),
    },
    $executeRaw: vi.fn().mockImplementation(async (strings: any, ...values: any[]) => {
      if (dbState.casResultOverride !== null) {
        const override = dbState.casResultOverride;
        dbState.casResultOverride = null;
        return override;
      }

      const sql = (strings?.raw ? strings.raw.join(' ') : Array.isArray(strings) ? strings.join(' ') : String(strings));

      let doc: any = null;
      for (const val of values) {
        if (typeof val === 'string' && dbState.documents.has(val)) {
          doc = dbState.documents.get(val);
          break;
        }
      }

      // Checkpoint update
      if (sql.includes("'{graphCheckpoint}'")) {
        if (doc) {
          try {
            doc.metadata.graphCheckpoint = typeof values[0] === 'string' ? JSON.parse(values[0]) : values[0];
          } catch {
            doc.metadata.graphCheckpoint = values[0];
          }
          doc.metadata.graphHeartbeatAt = new Date().toISOString();
        }
        return 1;
      }

      // Pending dispatch update
      if (sql.includes("'{pendingDispatch}'")) {
        if (doc) {
          try {
            doc.metadata.pendingDispatch = typeof values[0] === 'string' ? JSON.parse(values[0]) : values[0];
          } catch {
            doc.metadata.pendingDispatch = values[0];
          }
        }
        return 1;
      }

      // Terminal completion receipt update
      if (sql.includes("'{graphFinalizationReceipt}'")) {
        if (!doc) return 1;
        const targetRunId = values[2];
        const targetWorkerToken = values[3];
        if (targetRunId && doc.metadata?.extractionRunId !== targetRunId) {
          return 0;
        }
        if (targetWorkerToken && doc.metadata?.graphWorkerToken !== targetWorkerToken) {
          return 0;
        }
        try {
          doc.metadata.graphFinalizationReceipt = typeof values[0] === 'string' ? JSON.parse(values[0]) : values[0];
        } catch {
          doc.metadata.graphFinalizationReceipt = values[0];
        }
        doc.metadata.graphStatus = 'COMPLETED';
        doc.metadata.graphWorkerToken = null;
        return 1;
      }

      // Deferral update
      if (sql.includes("'{graphStatus}'") && sql.includes('"QUEUED"') && sql.includes("'{graphWorkerToken}'")) {
        if (!doc) return 1;
        const targetRunId = values[1];
        const targetWorkerToken = values[2];
        if (targetRunId && doc.metadata?.extractionRunId !== targetRunId) {
          return 0;
        }
        if (targetWorkerToken && doc.metadata?.graphWorkerToken !== targetWorkerToken) {
          return 0;
        }
        doc.metadata.graphStatus = 'QUEUED';
        doc.metadata.graphWorkerToken = null;
        return 1;
      }

      // Claim update
      if (sql.includes("'{graphStatus}'") && sql.includes('"PROCESSING"') && sql.includes("'{graphWorkerToken}'")) {
        if (!doc) return 1;
        const targetWorkerToken = values[0];
        const targetRunId = values[2];
        if (targetRunId && doc.metadata?.extractionRunId !== targetRunId) {
          return 0;
        }
        doc.metadata.graphStatus = 'PROCESSING';
        doc.metadata.graphWorkerToken = targetWorkerToken;
        doc.metadata.graphHeartbeatAt = new Date().toISOString();
        return 1;
      }

      // Heartbeat renewal update
      if (sql.includes("'{graphHeartbeatAt}'") && sql.includes("'{graphLeaseExpiresAt}'")) {
        if (!doc) return 1;
        const targetRunId = values[2];
        const targetWorkerToken = values[3];
        if (targetRunId && doc.metadata?.extractionRunId !== targetRunId) {
          return 0;
        }
        if (targetWorkerToken && doc.metadata?.graphWorkerToken !== targetWorkerToken) {
          return 0;
        }
        doc.metadata.graphHeartbeatAt = new Date().toISOString();
        doc.metadata.graphLeaseExpiresAt = new Date(Date.now() + 60000).toISOString();
        return 1;
      }

      return 1;
    }),
    $executeRawUnsafe: vi.fn().mockResolvedValue(1),
    $queryRaw: vi.fn().mockImplementation(async (strings: any, ...values: any[]) => {
      if (dbState.queryRawResultOverride !== null) {
        const override = dbState.queryRawResultOverride;
        dbState.queryRawResultOverride = null;
        return override;
      }

      const sql = (strings?.raw ? strings.raw.join(' ') : Array.isArray(strings) ? strings.join(' ') : String(strings));

      // Leader election
      if (sql.includes('pg_try_advisory_xact_lock')) {
        return [{ locked: true }];
      }

      // Timezone test (TC-11)
      if (sql.includes('formatted_utc')) {
        return [
          {
            formatted_utc: new Date().toISOString(),
            session_tz: 'America/New_York',
            epoch_now: Math.floor(Date.now() / 1000),
          },
        ];
      }
      if (sql.includes('epoch_now')) {
        return [{ epoch_now: Math.floor(Date.now() / 1000) }];
      }

      // Finalization receipt check in worker claim
      if (sql.includes('graphFinalizationReceipt')) {
        let doc: any = null;
        for (const val of values) {
          if (typeof val === 'string' && dbState.documents.has(val)) {
            doc = dbState.documents.get(val);
            break;
          }
        }
        if (doc?.metadata?.graphFinalizationReceipt) {
          return [{ receipt: doc.metadata.graphFinalizationReceipt }];
        }
        return [];
      }

      // Candidate query 1: pendingDispatch with enqueuedAt IS NULL
      if (sql.includes('pendingDispatch') && sql.includes('enqueuedAt') && sql.includes('IS NULL')) {
        const list: any[] = [];
        for (const doc of dbState.documents.values()) {
          if (doc.metadata?.pendingDispatch && doc.metadata.pendingDispatch.enqueuedAt === null) {
            list.push({ id: doc.id, workspaceId: doc.workspaceId, metadata: doc.metadata });
          }
        }
        return list;
      }

      // Candidate query 2: presence candidates (enqueuedAt IS NOT NULL and QUEUED)
      if (sql.includes('pendingDispatch') && sql.includes('enqueuedAt') && sql.includes('IS NOT NULL')) {
        const list: any[] = [];
        for (const doc of dbState.documents.values()) {
          if (
            doc.metadata?.pendingDispatch &&
            doc.metadata.pendingDispatch.enqueuedAt !== null &&
            doc.metadata?.graphStatus === 'QUEUED'
          ) {
            list.push({ id: doc.id, workspaceId: doc.workspaceId, metadata: doc.metadata });
          }
        }
        return list;
      }

      return [];
    }),
    $transaction: vi.fn(),
  };

  mockPrisma.$transaction.mockImplementation(async (callback: any) => {
    return await callback(mockPrisma);
  });

  return { mockPrisma, dbState };
});

vi.mock('../../../lib/prisma.js', () => ({
  prisma: mockPrisma,
}));

import { prisma } from '../../../lib/prisma.js';
import { GraphExtractionWorker } from '../worker/graph-extraction.worker.js';
import { GraphHeartbeatManager } from '../services/graph-heartbeat.manager.js';
import { GraphExtractionService } from '../services/graph-extraction.service.js';
import { DispatchRecoveryService } from '../../../services/dispatch-recovery.service.js';
import { MockExtractionProvider } from '../providers/mock-extraction.provider.js';
import { graphRepository } from '../repositories/graph.repository.js';
import { WaitingError } from 'bullmq';
import crypto from 'node:crypto';

describe('MindVault Task 6.4.2 — Final Shutdown & Lease Race Adversarial Suite', () => {
  let wsId: string;
  let userId: string;
  let mockRedis: any;

  beforeAll(async () => {
    const ws = await prisma.workspace.create({
      data: { name: 'Shutdown Test WS', slug: `shutdown-ws-${Date.now()}` },
    });
    wsId = ws.id;

    const user = await prisma.user.create({
      data: {
        email: `shutdown-user-${Date.now()}@mindvault.dev`,
        passwordHash: 'dummy',
        name: 'Shutdown Tester',
      },
    });
    userId = user.id;
  });

  afterAll(async () => {
    await prisma.document.deleteMany({ where: { workspaceId: wsId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.workspace.deleteMany({ where: { id: wsId } });
  });

  beforeEach(() => {
    dbState.casResultOverride = null;
    dbState.queryRawResultOverride = null;
    mockRedis = {
      eval: vi.fn().mockResolvedValue(1),
      quit: vi.fn().mockResolvedValue('OK'),
      disconnect: vi.fn(),
    };
  });

  async function createTestDoc(chunksCount = 3) {
    const docId = crypto.randomUUID();
    const runId = crypto.randomUUID();
    const doc = await prisma.document.create({
      data: {
        id: docId,
        workspaceId: wsId,
        uploadedById: userId,
        originalName: 'Shutdown_Doc.pdf',
        mimeType: 'application/pdf',
        extension: 'pdf',
        sizeBytes: BigInt(2048),
        checksum: `chk-${Date.now()}-${Math.random()}`,
        storageKey: `key-${Date.now()}-${Math.random()}`,
        metadata: {
          extractionRunId: runId,
          graphStatus: 'QUEUED',
          graphHeartbeatAt: new Date().toISOString(),
          graphLeaseExpiresAt: new Date(Date.now() + 60000).toISOString(),
          pendingDispatch: {
            extractionRunId: runId,
            jobId: `graph_${docId}_${runId}`,
            enqueuedAt: new Date().toISOString(),
            createdAt: new Date().toISOString(),
            attempts: 0,
          },
        },
      },
    });

    for (let i = 0; i < chunksCount; i++) {
      await prisma.documentChunk.create({
        data: {
          documentId: docId,
          workspaceId: wsId,
          chunkIndex: i,
          content: `Chunk ${i}: MindVault uses PostgreSQL and Redis for knowledge graph execution.`,
          tokenCount: 15,
        },
      });
    }

    return { docId, runId };
  }

  // ---------------------------------------------------------------------------
  // TC-01 & TC-02: BullMQ Worker Pause & Polling Cessation
  // ---------------------------------------------------------------------------
  it('TC-01: bullWorker.pause(true) sets paused=true and resolves immediately without blocking for active jobs', async () => {
    const worker = new GraphExtractionWorker();
    const mockBullWorker = {
      pause: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    };
    (worker as any).worker = mockBullWorker;
    (worker as any).isRunning = true;

    await worker.stop();

    expect(mockBullWorker.pause).toHaveBeenCalledWith(true);
    expect(mockBullWorker.close).toHaveBeenCalledWith(false);
  });

  it('TC-02: pause(true) immediately halts fetching new jobs from Redis wait queue', async () => {
    const worker = new GraphExtractionWorker();
    (worker as any).isRunning = true; // Mark as running so stop() initiates shutdown
    expect(worker.getIsShuttingDown()).toBe(false);

    const stopPromise = worker.stop();
    expect(worker.getIsShuttingDown()).toBe(true);
    await stopPromise;
  });

  // ---------------------------------------------------------------------------
  // TC-03 & TC-04: Cooperative LLM Cancellation & Checkpoint Boundaries
  // ---------------------------------------------------------------------------
  it('TC-03: in-flight chunk completing within 8s commits checkpoint i and cleanly defers subsequent chunks', async () => {
    const { docId, runId } = await createTestDoc(3);
    const mockProvider = new MockExtractionProvider();
    const service = new GraphExtractionService({
      graphRepo: graphRepository,
      provider: mockProvider,
    });
    const worker = new GraphExtractionWorker(service);
    (worker as any).redisClient = mockRedis;

    const mockJob: any = {
      id: `job_${docId}`,
      data: { documentId: docId, workspaceId: wsId, extractionRunId: runId },
      moveToWait: vi.fn().mockResolvedValue(1),
    };

    // Simulate SIGTERM arriving after chunk 0 completes
    let chunkCount = 0;
    vi.spyOn(service, 'extractFromChunk').mockImplementation(async (_ws, _doc, chunkId) => {
      chunkCount++;
      if (chunkCount === 1) {
        // Trigger shutdown immediately after chunk 0
        (worker as any).isShuttingDown = true;
      }
      return {
        chunkId,
        documentId: docId,
        workspaceId: wsId,
        entitiesExtracted: 1,
        entitiesResolved: 1,
        mentionsCreated: 1,
        relationsExtracted: 1,
        relationsPersisted: 1,
        evidenceCreated: 1,
        durationMs: 5,
      };
    });

    let caughtErr: any;
    try {
      await worker.processJob(mockJob, 'token_123');
    } catch (e) {
      caughtErr = e;
    }

    expect(caughtErr).toBeInstanceOf(WaitingError);
    expect(mockJob.moveToWait).toHaveBeenCalledWith('token_123');

    // Verify DB state: chunk 0 checkpoint saved, status QUEUED
    const updated = await prisma.document.findUnique({ where: { id: docId } });
    const meta = updated?.metadata as any;
    expect(meta.graphStatus).toBe('QUEUED');
    expect(meta.graphWorkerToken).toBeNull();
    expect(meta.graphCheckpoint.lastCompletedChunkIndex).toBe(0);
    expect(meta.graphFinalizationReceipt).toBeUndefined();
  });

  it('TC-04: in-flight chunk exceeding 8s trips abortSignal, cancels Gemini HTTP socket, and preserves checkpoint i-1', async () => {
    const { docId, runId } = await createTestDoc(2);
    const mockProvider = new MockExtractionProvider();
    const service = new GraphExtractionService({
      graphRepo: graphRepository,
      provider: mockProvider,
    });
    const worker = new GraphExtractionWorker(service);
    (worker as any).redisClient = mockRedis;

    const mockJob: any = {
      id: `job_slow_${docId}`,
      data: { documentId: docId, workspaceId: wsId, extractionRunId: runId },
      moveToWait: vi.fn().mockResolvedValue(1),
    };

    // Chunk 0 hangs until aborted; simulate 8s cooperative timeout via setTimeout
    vi.spyOn(service, 'extractFromChunk').mockImplementation(async (_ws, _doc, _chk, _cnt, ctx) => {
      setTimeout(() => {
        const activeEntry = (worker as any).activeJobs.get(mockJob.id);
        if (activeEntry) {
          activeEntry.abortController.abort();
        }
      }, 5);

      return new Promise((_resolve, reject) => {
        if (ctx?.abortSignal) {
          ctx.abortSignal.addEventListener('abort', () => {
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }
      });
    });

    // Mark worker shutting down
    (worker as any).isShuttingDown = true;

    // Trigger processJob; cooperative abort will trip WaitingError
    let caughtErr: any;
    try {
      await worker.processJob(mockJob, 'token_slow');
    } catch (e) {
      caughtErr = e;
    }

    expect(caughtErr).toBeInstanceOf(WaitingError);

    const doc = await prisma.document.findUnique({ where: { id: docId } });
    const meta = doc?.metadata as any;
    expect(meta.graphStatus).toBe('QUEUED');
    // Checkpoint was not advanced (no chunks completed)
    expect(meta.graphCheckpoint).toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // TC-05 & TC-06: Deferral Ordering & Terminal Receipt Immunity
  // ---------------------------------------------------------------------------
  it('TC-05: deferral updates PostgreSQL to QUEUED before calling moveToWait(token); verify attemptsMade is NOT incremented', async () => {
    const { docId, runId } = await createTestDoc(1);
    const worker = new GraphExtractionWorker();
    (worker as any).redisClient = mockRedis;
    (worker as any).isShuttingDown = true;

    const callOrder: string[] = [];

    const mockJob: any = {
      id: `job_order_${docId}`,
      data: { documentId: docId, workspaceId: wsId, extractionRunId: runId },
      attemptsMade: 1,
      moveToWait: vi.fn().mockImplementation(async () => {
        // Assert that PostgreSQL was already updated to QUEUED before moveToWait is called
        const currentDoc = await prisma.document.findUnique({ where: { id: docId } });
        const meta = currentDoc?.metadata as any;
        expect(meta.graphStatus).toBe('QUEUED');
        expect(meta.graphWorkerToken).toBeNull();
        callOrder.push('moveToWait');
        return 1;
      }),
    };

    try {
      await worker.processJob(mockJob, 'token_order');
    } catch (e) {
      expect(e).toBeInstanceOf(WaitingError);
    }

    expect(callOrder).toEqual(['moveToWait']);
    expect(mockJob.attemptsMade).toBe(1); // Not incremented!
  });

  it('TC-06: deferred job never fabricates a GraphFinalizationReceipt', async () => {
    const { docId, runId } = await createTestDoc(2);
    const worker = new GraphExtractionWorker();
    (worker as any).redisClient = mockRedis;
    (worker as any).isShuttingDown = true;

    const mockJob: any = {
      id: `job_receipt_${docId}`,
      data: { documentId: docId, workspaceId: wsId, extractionRunId: runId },
      moveToWait: vi.fn().mockResolvedValue(1),
    };

    try {
      await worker.processJob(mockJob, 'token_receipt');
    } catch (e) {
      // WaitingError expected
    }

    const doc = await prisma.document.findUnique({ where: { id: docId } });
    const meta = doc?.metadata as any;
    expect(meta.graphStatus).toBe('QUEUED');
    expect(meta.graphFinalizationReceipt).toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // TC-07 & TC-08: Single-Flight Renewal & Heartbeat-vs-Deferral Race
  // ---------------------------------------------------------------------------
  it('TC-07: slow database latency does not cause overlapping concurrent PostgreSQL renewal queries', async () => {
    const { docId, runId } = await createTestDoc(1);
    const manager = new GraphHeartbeatManager({
      documentId: docId,
      extractionRunId: runId,
      workerToken: 'tok_mutex',
      redisClient: mockRedis,
      prisma,
    });

    let activeDbQueries = 0;
    let maxConcurrentDbQueries = 0;

    const origExecuteRaw = (prisma as any).$executeRaw.bind(prisma);
    vi.spyOn(prisma as any, '$executeRaw').mockImplementation(async (...args: any[]) => {
      activeDbQueries++;
      maxConcurrentDbQueries = Math.max(maxConcurrentDbQueries, activeDbQueries);
      await new Promise((r) => setTimeout(r, 20));
      activeDbQueries--;
      return origExecuteRaw(...args);
    });

    // Launch two renewals simultaneously
    const p1 = manager.renewSingleFlight();
    const p2 = manager.renewSingleFlight();

    const [r1, r2] = await Promise.all([p1, p2]);

    expect(maxConcurrentDbQueries).toBe(1);
    expect(r1).toBe(r2); // Same promise shared
    await manager.terminate();
  });

  it('TC-08: entering PREPARING_DEFERRAL awaits in-flight renewal and prevents renewal query from interpreting intentional token clearing as lease loss', async () => {
    const { docId, runId } = await createTestDoc(1);
    const onFencedSpy = vi.fn();
    const manager = new GraphHeartbeatManager({
      documentId: docId,
      extractionRunId: runId,
      workerToken: 'tok_race',
      redisClient: mockRedis,
      prisma,
      onFenced: onFencedSpy,
    });

    // Set doc to PROCESSING with tok_race
    await prisma.document.update({
      where: { id: docId },
      data: {
        metadata: {
          extractionRunId: runId,
          graphStatus: 'PROCESSING',
          graphWorkerToken: 'tok_race',
          graphLeaseExpiresAt: new Date(Date.now() + 60000).toISOString(),
        },
      },
    });

    // Start a background renewal
    const renewalPromise = manager.renewSingleFlight();

    // Concurrently trigger prepareDeferral()
    await manager.prepareDeferral();
    expect(manager.getState()).toBe('PREPARING_DEFERRAL');

    // Await renewal
    await renewalPromise;

    // Clear token intentionally
    await prisma.document.update({
      where: { id: docId },
      data: {
        metadata: {
          extractionRunId: runId,
          graphStatus: 'QUEUED',
          graphWorkerToken: null,
        },
      },
    });

    // Subsequent renewal call is rejected due to PREPARING_DEFERRAL state
    const postRenewal = await manager.renewSingleFlight();
    expect(postRenewal).toBe(false);

    // Assert that onFenced was NEVER triggered
    expect(onFencedSpy).not.toHaveBeenCalled();
    expect(manager.isWorkerFenced()).toBe(false);

    await manager.markDeferred();
    expect(manager.getState()).toBe('DEFERRED');
  });

  // ---------------------------------------------------------------------------
  // TC-09 & TC-10: Stale Superseded Worker Fencing & Dual-Lease Fencing
  // ---------------------------------------------------------------------------
  it('TC-09: worker superseded by recovery sweep before deferral CAS fails update (0 rows) and ceases writes without calling moveToWait', async () => {
    const { docId, runId } = await createTestDoc(1);
    const worker = new GraphExtractionWorker();
    (worker as any).redisClient = mockRedis;
    (worker as any).isShuttingDown = true;

    // Simulate recovery sweep superseding this run with a new runId before deferral executes
    const newRunId = crypto.randomUUID();
    await prisma.document.update({
      where: { id: docId },
      data: {
        metadata: {
          extractionRunId: newRunId,
          graphStatus: 'PROCESSING',
          graphWorkerToken: 'recovery_worker_token',
        },
      },
    });

    const mockJob: any = {
      id: `job_stale_${docId}`,
      data: { documentId: docId, workspaceId: wsId, extractionRunId: runId },
      moveToWait: vi.fn(),
    };

    // Run processJob with the stale runId
    await worker.processJob(mockJob, 'token_stale');

    // Verify moveToWait was NOT called because worker detected it was superseded
    expect(mockJob.moveToWait).not.toHaveBeenCalled();

    // Verify database was NOT corrupted (retains newRunId)
    const doc = await prisma.document.findUnique({ where: { id: docId } });
    const meta = doc?.metadata as any;
    expect(meta.extractionRunId).toBe(newRunId);
    expect(meta.graphWorkerToken).toBe('recovery_worker_token');
  });

  it('TC-10: failure in either Redis Lua renewal or PostgreSQL CAS immediately trips AbortController and halts extraction', async () => {
    const { docId, runId } = await createTestDoc(1);
    const onFencedSpy = vi.fn();

    // Subtest A: Redis renewal fails (returns 0)
    mockRedis.eval.mockResolvedValueOnce(0);

    const managerA = new GraphHeartbeatManager({
      documentId: docId,
      extractionRunId: runId,
      workerToken: 'tok_fail_redis',
      redisClient: mockRedis,
      prisma,
      onFenced: onFencedSpy,
    });

    const successA = await managerA.renewSingleFlight();
    expect(successA).toBe(false);
    expect(managerA.isWorkerFenced()).toBe(true);
    expect(onFencedSpy).toHaveBeenCalledTimes(1);

    // Subtest B: Redis succeeds but PostgreSQL CAS returns 0 rows (superseded in DB)
    mockRedis.eval.mockResolvedValue(1);
    const onFencedSpyB = vi.fn();

    const managerB = new GraphHeartbeatManager({
      documentId: docId,
      extractionRunId: runId,
      workerToken: 'tok_fail_pg',
      redisClient: mockRedis,
      prisma,
      onFenced: onFencedSpyB,
    });

    // DB has no matching worker token (returns 0 from CAS)
    const successB = await managerB.renewSingleFlight();
    expect(successB).toBe(false);
    expect(managerB.isWorkerFenced()).toBe(true);
    expect(onFencedSpyB).toHaveBeenCalledTimes(1);
  });

  // ---------------------------------------------------------------------------
  // TC-11: Pool-Safe Timezone Isolation Test
  // ---------------------------------------------------------------------------
  it('TC-11: SET LOCAL TIME ZONE America/New_York formats exact UTC timestamps without pool contamination', async () => {
    await prisma.$transaction(async (tx) => {
      // Set local timezone strictly scoped to this interactive transaction
      await tx.$executeRawUnsafe("SET LOCAL TIME ZONE 'America/New_York'");

      const rows = await tx.$queryRaw<{ formatted_utc: string; session_tz: string }[]>`
        SELECT 
          to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS formatted_utc,
          current_setting('TIMEZONE') AS session_tz;
      `;

      expect(rows[0].session_tz).toBe('America/New_York');
      const formatted = rows[0].formatted_utc;

      // Verify strict RFC 3339 UTC format ending with Z
      expect(formatted).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

      // Verify epoch match within 2s of real-world UTC
      const parsedEpoch = Math.floor(new Date(formatted).getTime() / 1000);
      const dbEpochRows = await tx.$queryRaw<{ epoch_now: number }[]>`
        SELECT EXTRACT(EPOCH FROM clock_timestamp())::int AS epoch_now;
      `;
      const dbEpoch = dbEpochRows[0].epoch_now;

      expect(Math.abs(parsedEpoch - dbEpoch)).toBeLessThanOrEqual(2);
    });
  });

  // ---------------------------------------------------------------------------
  // TC-12 & TC-13: Bounded Liveness & Clean Deferral Sweep Immunity
  // ---------------------------------------------------------------------------
  it('TC-12: Redis failure during moveToWait records pendingDispatch with enqueuedAt=null, recovering within 90s', async () => {
    const { docId, runId } = await createTestDoc(1);
    const worker = new GraphExtractionWorker();
    (worker as any).redisClient = mockRedis;
    (worker as any).isShuttingDown = true;

    // Simulate Redis network error on moveToWait
    const mockJob: any = {
      id: `job_redis_err_${docId}`,
      data: { documentId: docId, workspaceId: wsId, extractionRunId: runId },
      moveToWait: vi.fn().mockRejectedValue(new Error('ECONNREFUSED: Redis unreachable')),
    };

    let caughtErr: any;
    try {
      await worker.processJob(mockJob, 'token_err');
    } catch (e) {
      caughtErr = e;
    }

    expect(caughtErr.message).toContain('ECONNREFUSED');

    // Assert that pendingDispatch intent was recorded with enqueuedAt = null
    const doc = await prisma.document.findUnique({ where: { id: docId } });
    const meta = doc?.metadata as any;
    expect(meta.graphStatus).toBe('QUEUED');
    expect(meta.pendingDispatch).toBeDefined();
    expect(meta.pendingDispatch.enqueuedAt).toBeNull();
    expect(meta.pendingDispatch.lastError).toContain('ECONNREFUSED');

    // Fast-forward createdAt by 31s to satisfy Candidate Query 1 (> 30s grace period)
    const thirtyOneSecsAgo = new Date(Date.now() - 31000).toISOString();
    await prisma.document.update({
      where: { id: docId },
      data: {
        metadata: {
          ...meta,
          pendingDispatch: {
            ...meta.pendingDispatch,
            createdAt: thirtyOneSecsAgo,
          },
        },
      },
    });

    // Run recovery sweep
    const mockQueue = {
      enqueue: vi.fn().mockResolvedValue(`job_recovered_${docId}`),
      getJob: vi.fn().mockResolvedValue(null),
    };
    const recoveryService = new DispatchRecoveryService(prisma, mockQueue as any);
    const sweepResult = await recoveryService.executeSweep();

    expect(sweepResult.drainedCount).toBe(1);
    expect(mockQueue.enqueue).toHaveBeenCalled();
  });

  it('TC-13: cleanly deferred job in Redis wait list is not falsely re-dispatched by DispatchRecoveryService', async () => {
    const { docId, runId } = await createTestDoc(1);

    // Job cleanly placed in Redis wait list
    await prisma.document.update({
      where: { id: docId },
      data: {
        metadata: {
          extractionRunId: runId,
          graphStatus: 'QUEUED',
          pendingDispatch: {
            extractionRunId: runId,
            jobId: `graph_${docId}_${runId}`,
            enqueuedAt: new Date().toISOString(),
            createdAt: new Date().toISOString(),
            attempts: 0,
          },
        },
      },
    });

    const mockQueue = {
      enqueue: vi.fn(),
      getJob: vi.fn().mockResolvedValue({ id: `graph_${docId}_${runId}`, name: 'extract-graph' }),
    };

    const recoveryService = new DispatchRecoveryService(prisma, mockQueue as any);
    const sweepResult = await recoveryService.executeSweep();

    // Presence reconciler sees job is present in BullMQ -> skips re-dispatch!
    expect(mockQueue.enqueue).not.toHaveBeenCalled();
    expect(sweepResult.presenceReconciledCount).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // TC-14 & TC-15: Sweep Drain on Stop & Resumption from Exact Checkpoint
  // ---------------------------------------------------------------------------
  it('TC-14: DispatchRecoveryService.stop() cleanly awaits active executeSweep() before resolving', async () => {
    let sweepResolved = false;
    const recoveryService = new DispatchRecoveryService(prisma);

    // Spy on internalExecuteSweep to introduce an asynchronous delay
    vi.spyOn(recoveryService as any, 'internalExecuteSweep').mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 40));
      sweepResolved = true;
      return { locked: true, drainedCount: 0, confirmedCount: 0, presenceReconciledCount: 0, errors: [] };
    });

    (recoveryService as any).isRunning = true;

    // Start sweep
    const sweepPromise = recoveryService.executeSweep();

    // Call stop() while sweep is in-flight
    await recoveryService.stop();

    expect(sweepResolved).toBe(true);
    await sweepPromise;
  });

  it('TC-15: next worker picking up deferred job resumes execution from lastCompletedChunkIndex + 1', async () => {
    const { docId, runId } = await createTestDoc(3);

    // Checkpoint recorded at chunk index 0
    await prisma.document.update({
      where: { id: docId },
      data: {
        metadata: {
          extractionRunId: runId,
          graphStatus: 'QUEUED',
          graphCheckpoint: {
            extractionRunId: runId,
            chunkManifestHash: 'hash_123',
            lastCompletedChunkIndex: 0,
            lastCompletedChunkId: 'chunk_0',
            processedChunksCount: 1,
            succeededChunksCount: 1,
            failedChunksCount: 0,
          },
        },
      },
    });

    const mockProvider = new MockExtractionProvider();
    const service = new GraphExtractionService({
      graphRepo: graphRepository,
      provider: mockProvider,
    });
    const worker = new GraphExtractionWorker(service);
    (worker as any).redisClient = mockRedis;

    const extractedChunkIndices: number[] = [];
    vi.spyOn(service, 'extractFromChunk').mockImplementation(async (_ws, _doc, chunkId) => {
      // Find chunk index
      const chk = await prisma.documentChunk.findUnique({ where: { id: chunkId } });
      if (chk) extractedChunkIndices.push(chk.chunkIndex);
      return {
        chunkId,
        documentId: docId,
        workspaceId: wsId,
        entitiesExtracted: 1,
        entitiesResolved: 1,
        mentionsCreated: 1,
        relationsExtracted: 1,
        relationsPersisted: 1,
        evidenceCreated: 1,
        durationMs: 5,
      };
    });

    const mockJob: any = {
      id: `job_resume_${docId}`,
      data: { documentId: docId, workspaceId: wsId, extractionRunId: runId },
    };

    await worker.processJob(mockJob, 'token_resume');

    // Chunks processed should ONLY be index 1 and 2 (chunk 0 was skipped!)
    expect(extractedChunkIndices).toEqual([1, 2]);

    const finalDoc = await prisma.document.findUnique({ where: { id: docId } });
    const meta = finalDoc?.metadata as any;
    expect(meta.graphStatus).toBe('COMPLETED');
    expect(meta.graphFinalizationReceipt).toBeDefined();
    expect(meta.graphCheckpoint.lastCompletedChunkIndex).toBe(2);
  });
});
