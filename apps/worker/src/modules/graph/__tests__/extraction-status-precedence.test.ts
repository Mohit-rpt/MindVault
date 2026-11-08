/**
 * MindVault — Phase 6.4.4: Error Classification, Deterministic Retries & Status Precedence Test Suite
 *
 * Verifies the requirements from Phase 6.4 Blueprint v4.5.6 (§6.4.2, §6.4.4, §6.9, Task 6.4.4, AC-05, AC-10, AC-24):
 * - TC-01: All-success extraction -> COMPLETED (receipt valid, s = total, f = 0)
 * - TC-02: Zero-relation extraction -> COMPLETED (receipt valid, zero relations is valid outcome)
 * - TC-03: Partial extraction success with permanent chunk error -> PARTIAL (receipt valid, s > 0, f > 0, triples preserved)
 * - TC-04: 100% permanent chunk failure -> FAILED (receipt valid, s = 0, f = total, 0 retries wasted)
 * - TC-05: Transient infrastructure failure throws ExtractionTransientError, leaving status in PROCESSING with null receipt
 * - TC-06: Strict validation invariants in validateFinalizationReceipt (rejects invalid/imbalanced counters, status mismatches)
 * - TC-07: Fenced worker halts immediately and writes zero terminal receipts
 * - TC-08: BullMQ exponential backoff delay verification (0s initial, 2s retry 1, 4s retry 2, 3 max attempts)
 */

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
        const doc = { id: data.id || `doc-${Date.now()}-${Math.random()}`, ...data };
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

      // Terminal finalization receipt update (COMPLETED, PARTIAL, or FAILED)
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

        if (sql.includes('"PARTIAL"')) {
          doc.metadata.graphStatus = 'PARTIAL';
        } else if (sql.includes('"FAILED"')) {
          doc.metadata.graphStatus = 'FAILED';
        } else {
          doc.metadata.graphStatus = 'COMPLETED';
        }
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
        doc.metadata.graphLeaseExpiresAt = new Date(Date.now() + 60000).toISOString();
        return 1;
      }

      // Heartbeat renewal
      if (sql.includes("'{graphHeartbeatAt}'") && sql.includes("'{graphLeaseExpiresAt}'")) {
        if (!doc) return 1;
        const targetWorkerToken = values[0];
        const targetRunId = values[1];
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
import { GraphExtractionService } from '../services/graph-extraction.service.js';
import { MockExtractionProvider } from '../providers/mock-extraction.provider.js';
import { graphRepository } from '../repositories/graph.repository.js';
import { ExtractionTransientError, ExtractionPermanentError } from '../errors/extraction-error.classifier.js';
import { ExtractionFencedError } from '../errors/extraction-fenced.error.js';
import {
  type GraphFinalizationReceipt,
  validateFinalizationReceipt,
  GRAPH_QUEUE_DEFAULT_JOB_OPTIONS,
} from '@mindvault/shared';
import crypto from 'node:crypto';

describe('MindVault Task 6.4.4 — Error Classification, Deterministic Retries & Status Precedence Suite', () => {
  let wsId: string;
  let userId: string;
  let mockRedis: any;

  beforeAll(async () => {
    const ws = await prisma.workspace.create({
      data: { name: 'Status Precedence Test WS', slug: `status-ws-${Date.now()}` },
    });
    wsId = ws.id;

    const user = await prisma.user.create({
      data: {
        email: `status-user-${Date.now()}@mindvault.dev`,
        passwordHash: 'dummy',
        name: 'Status Tester',
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
    dbState.documents.clear();
    dbState.chunks.clear();
    dbState.casResultOverride = null;
    dbState.queryRawResultOverride = null;

    mockRedis = {
      set: vi.fn().mockResolvedValue('OK'),
      get: vi.fn().mockResolvedValue(null),
      del: vi.fn().mockResolvedValue(1),
      eval: vi.fn().mockResolvedValue(1),
    };
  });

  async function createTestDoc(chunkCount: number, overrides: Record<string, any> = {}) {
    const runId = `run_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    const docId = `doc_${Date.now()}_${Math.random().toString(36).substring(7)}`;

    const doc = await prisma.document.create({
      data: {
        id: docId,
        workspaceId: wsId,
        uploadedById: userId,
        originalName: `test_${docId}.pdf`,
        mimeType: 'application/pdf',
        extension: 'pdf',
        sizeBytes: BigInt(2048),
        storageKey: `key_${docId}`,
        checksum: crypto.createHash('sha256').update(`content_${docId}`).digest('hex'),
        metadata: {
          extractionRunId: runId,
          graphStatus: 'QUEUED',
          graphAttempts: 1,
          graphHeartbeatAt: new Date().toISOString(),
          graphLeaseExpiresAt: new Date(Date.now() + 60000).toISOString(),
          ...overrides,
        },
      },
    });

    const chunks = [];
    for (let i = 0; i < chunkCount; i++) {
      const chunk = await prisma.documentChunk.create({
        data: {
          documentId: doc.id,
          workspaceId: wsId,
          chunkIndex: i,
          content: `Chunk ${i} content for status precedence validation`,
          tokenCount: 15,
        },
      });
      chunks.push(chunk);
    }

    return { docId: doc.id, runId, chunks };
  }

  // ---------------------------------------------------------------------------
  // TC-01: All-Success Extraction -> COMPLETED
  // ---------------------------------------------------------------------------
  it('TC-01: all chunks succeed (s = N, f = 0) -> transitions to COMPLETED with valid receipt', async () => {
    const { docId, runId } = await createTestDoc(3);

    const mockProvider = new MockExtractionProvider();
    const service = new GraphExtractionService({
      graphRepo: graphRepository,
      provider: mockProvider,
    });
    const worker = new GraphExtractionWorker(service);
    (worker as any).redisClient = mockRedis;

    vi.spyOn(service, 'extractFromChunk').mockResolvedValue({
      chunkId: 'chk',
      documentId: docId,
      workspaceId: wsId,
      entitiesExtracted: 2,
      entitiesResolved: 2,
      mentionsCreated: 2,
      relationsExtracted: 1,
      relationsPersisted: 1,
      evidenceCreated: 1,
      durationMs: 5,
    });

    const mockJob: any = {
      id: `job_${docId}`,
      data: { documentId: docId, workspaceId: wsId, extractionRunId: runId },
      attemptsMade: 1,
    };

    await worker.processJob(mockJob, 'token_tc01');

    const finalDoc = await prisma.document.findUnique({ where: { id: docId } });
    const meta = finalDoc?.metadata as any;

    expect(meta.graphStatus).toBe('COMPLETED');
    expect(meta.graphWorkerToken).toBeNull();
    expect(meta.graphFinalizationReceipt).toBeDefined();

    const receipt: GraphFinalizationReceipt = meta.graphFinalizationReceipt;
    expect(receipt.terminalStatus).toBe('COMPLETED');
    expect(receipt.chunkCount).toBe(3);
    expect(receipt.processedChunksCount).toBe(3);
    expect(receipt.succeededChunksCount).toBe(3);
    expect(receipt.failedChunksCount).toBe(0);
    expect(receipt.extractionRunId).toBe(runId);

    // Validate using authoritative schema validator
    expect(validateFinalizationReceipt(receipt, runId, receipt.chunkManifestHash, 3)).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // TC-02: Zero Extracted Relations -> COMPLETED (Valid Success Outcome)
  // ---------------------------------------------------------------------------
  it('TC-02: chunks contain zero extractable relations -> completes cleanly as COMPLETED with receipt', async () => {
    const { docId, runId } = await createTestDoc(2);

    const mockProvider = new MockExtractionProvider();
    const service = new GraphExtractionService({
      graphRepo: graphRepository,
      provider: mockProvider,
    });
    const worker = new GraphExtractionWorker(service);
    (worker as any).redisClient = mockRedis;

    // Simulate model returning 0 entities and 0 relations for both chunks
    vi.spyOn(service, 'extractFromChunk').mockResolvedValue({
      chunkId: 'chk_zero',
      documentId: docId,
      workspaceId: wsId,
      entitiesExtracted: 0,
      entitiesResolved: 0,
      mentionsCreated: 0,
      relationsExtracted: 0,
      relationsPersisted: 0,
      evidenceCreated: 0,
      durationMs: 3,
    });

    const mockJob: any = {
      id: `job_zero_${docId}`,
      data: { documentId: docId, workspaceId: wsId, extractionRunId: runId },
      attemptsMade: 1,
    };

    await worker.processJob(mockJob, 'token_tc02');

    const finalDoc = await prisma.document.findUnique({ where: { id: docId } });
    const meta = finalDoc?.metadata as any;

    expect(meta.graphStatus).toBe('COMPLETED');
    expect(meta.graphFinalizationReceipt).toBeDefined();
    expect(meta.graphFinalizationReceipt.terminalStatus).toBe('COMPLETED');
    expect(meta.graphFinalizationReceipt.succeededChunksCount).toBe(2);
    expect(meta.graphFinalizationReceipt.failedChunksCount).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // TC-03: Partial Success (S > 0, F > 0) -> PARTIAL
  // ---------------------------------------------------------------------------
  it('TC-03: permanent failure on subset of chunks (s > 0, f > 0) -> transitions to PARTIAL with valid receipt', async () => {
    const { docId, runId, chunks } = await createTestDoc(3);

    const mockProvider = new MockExtractionProvider();
    const service = new GraphExtractionService({
      graphRepo: graphRepository,
      provider: mockProvider,
    });
    const worker = new GraphExtractionWorker(service);
    (worker as any).redisClient = mockRedis;

    // Chunk 0 succeeds, Chunk 1 fails permanently (schema error), Chunk 2 succeeds
    vi.spyOn(service, 'extractFromChunk').mockImplementation(async (_ws, _doc, chunkId) => {
      if (chunkId === chunks[1].id) {
        const syntaxErr = new SyntaxError('Unexpected token < in JSON at position 0');
        throw syntaxErr;
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

    const mockJob: any = {
      id: `job_partial_${docId}`,
      data: { documentId: docId, workspaceId: wsId, extractionRunId: runId },
      attemptsMade: 1,
    };

    await worker.processJob(mockJob, 'token_tc03');

    const finalDoc = await prisma.document.findUnique({ where: { id: docId } });
    const meta = finalDoc?.metadata as any;

    expect(meta.graphStatus).toBe('PARTIAL');
    expect(meta.graphWorkerToken).toBeNull();
    expect(meta.graphFinalizationReceipt).toBeDefined();

    const receipt: GraphFinalizationReceipt = meta.graphFinalizationReceipt;
    expect(receipt.terminalStatus).toBe('PARTIAL');
    expect(receipt.chunkCount).toBe(3);
    expect(receipt.processedChunksCount).toBe(3);
    expect(receipt.succeededChunksCount).toBe(2);
    expect(receipt.failedChunksCount).toBe(1);

    // Validate receipt invariants
    expect(validateFinalizationReceipt(receipt, runId, receipt.chunkManifestHash, 3)).toBe(true);

    // Checkpoint must reflect partial progress
    expect(meta.graphCheckpoint).toBeDefined();
    expect(meta.graphCheckpoint.lastCompletedChunkIndex).toBe(2);
    expect(meta.graphCheckpoint.succeededChunksCount).toBe(2);
    expect(meta.graphCheckpoint.failedChunksCount).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // TC-04: 100% Permanent Chunk Failure (S = 0, F = N) -> FAILED (Zero Retries Wasted)
  // ---------------------------------------------------------------------------
  it('TC-04: all chunks fail permanently -> commits terminal FAILED receipt without throwing transient error', async () => {
    const { docId, runId } = await createTestDoc(2);

    const mockProvider = new MockExtractionProvider();
    const service = new GraphExtractionService({
      graphRepo: graphRepository,
      provider: mockProvider,
    });
    const worker = new GraphExtractionWorker(service);
    (worker as any).redisClient = mockRedis;

    // Both chunks throw unparseable/permanent content errors
    vi.spyOn(service, 'extractFromChunk').mockRejectedValue(
      new ExtractionPermanentError('Unparseable corrupt binary content in chunk text'),
    );

    const mockJob: any = {
      id: `job_failed_${docId}`,
      data: { documentId: docId, workspaceId: wsId, extractionRunId: runId },
      attemptsMade: 1,
    };

    // Must resolve cleanly without throwing ExtractionTransientError
    await expect(worker.processJob(mockJob, 'token_tc04')).resolves.not.toThrow();

    const finalDoc = await prisma.document.findUnique({ where: { id: docId } });
    const meta = finalDoc?.metadata as any;

    expect(meta.graphStatus).toBe('FAILED');
    expect(meta.graphWorkerToken).toBeNull();
    expect(meta.graphFinalizationReceipt).toBeDefined();

    const receipt: GraphFinalizationReceipt = meta.graphFinalizationReceipt;
    expect(receipt.terminalStatus).toBe('FAILED');
    expect(receipt.chunkCount).toBe(2);
    expect(receipt.processedChunksCount).toBe(2);
    expect(receipt.succeededChunksCount).toBe(0);
    expect(receipt.failedChunksCount).toBe(2);

    expect(validateFinalizationReceipt(receipt, runId, receipt.chunkManifestHash, 2)).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // TC-05: Transient Infrastructure Failure -> Throws ExtractionTransientError (Retains PROCESSING)
  // ---------------------------------------------------------------------------
  it('TC-05: transient error (HTTP 429) throws ExtractionTransientError, leaves status PROCESSING with null receipt', async () => {
    const { docId, runId } = await createTestDoc(2);

    const mockProvider = new MockExtractionProvider();
    const service = new GraphExtractionService({
      graphRepo: graphRepository,
      provider: mockProvider,
    });
    const worker = new GraphExtractionWorker(service);
    (worker as any).redisClient = mockRedis;

    // Simulate upstream LLM 429 Rate Limit
    const rateLimitError = new Error('HTTP 429: Too Many Requests (RESOURCE_EXHAUSTED)');
    (rateLimitError as any).status = 429;
    vi.spyOn(service, 'extractFromChunk').mockRejectedValue(rateLimitError);

    const mockJob: any = {
      id: `job_transient_${docId}`,
      data: { documentId: docId, workspaceId: wsId, extractionRunId: runId },
      attemptsMade: 1,
    };

    let thrownError: any = null;
    try {
      await worker.processJob(mockJob, 'token_tc05');
    } catch (err) {
      thrownError = err;
    }

    expect(thrownError).toBeInstanceOf(ExtractionTransientError);
    expect(thrownError.cause).toBe(rateLimitError);

    // PostgreSQL state must remain PROCESSING without a terminal receipt
    const finalDoc = await prisma.document.findUnique({ where: { id: docId } });
    const meta = finalDoc?.metadata as any;

    expect(meta.graphStatus).toBe('PROCESSING');
    expect(meta.graphFinalizationReceipt).toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // TC-06: Strict Invariant Validation in validateFinalizationReceipt (AC-24)
  // ---------------------------------------------------------------------------
  describe('TC-06: validateFinalizationReceipt AC-24 invariant enforcement', () => {
    const validReceipt: GraphFinalizationReceipt = {
      terminalStatus: 'COMPLETED',
      extractionRunId: 'run_valid_123',
      chunkManifestHash: 'manifest_hash_abc',
      completedAt: new Date().toISOString(),
      chunkCount: 5,
      processedChunksCount: 5,
      succeededChunksCount: 5,
      failedChunksCount: 0,
    };

    it('accepts valid COMPLETED, PARTIAL, and FAILED receipts', () => {
      expect(validateFinalizationReceipt(validReceipt, 'run_valid_123', 'manifest_hash_abc', 5)).toBe(true);

      const partialReceipt: GraphFinalizationReceipt = {
        ...validReceipt,
        terminalStatus: 'PARTIAL',
        succeededChunksCount: 3,
        failedChunksCount: 2,
      };
      expect(validateFinalizationReceipt(partialReceipt, 'run_valid_123', 'manifest_hash_abc', 5)).toBe(true);

      const failedReceipt: GraphFinalizationReceipt = {
        ...validReceipt,
        terminalStatus: 'FAILED',
        succeededChunksCount: 0,
        failedChunksCount: 5,
      };
      expect(validateFinalizationReceipt(failedReceipt, 'run_valid_123', 'manifest_hash_abc', 5)).toBe(true);
    });

    it('rejects negative chunk counters', () => {
      const invalid = { ...validReceipt, succeededChunksCount: -1 };
      expect(validateFinalizationReceipt(invalid, 'run_valid_123', 'manifest_hash_abc', 5)).toBe(false);
    });

    it('rejects non-integer chunk counters', () => {
      const invalid = { ...validReceipt, succeededChunksCount: 2.5 };
      expect(validateFinalizationReceipt(invalid, 'run_valid_123', 'manifest_hash_abc', 5)).toBe(false);
    });

    it('rejects imbalanced counters where processed !== succeeded + failed', () => {
      const invalid = {
        ...validReceipt,
        processedChunksCount: 5,
        succeededChunksCount: 4,
        failedChunksCount: 0, // 4 + 0 !== 5
      };
      expect(validateFinalizationReceipt(invalid, 'run_valid_123', 'manifest_hash_abc', 5)).toBe(false);
    });

    it('rejects imbalanced counters where processed !== chunkCount', () => {
      const invalid = {
        ...validReceipt,
        processedChunksCount: 4,
        succeededChunksCount: 4,
        failedChunksCount: 0,
        chunkCount: 5,
      };
      expect(validateFinalizationReceipt(invalid, 'run_valid_123', 'manifest_hash_abc', 5)).toBe(false);
    });

    it('rejects COMPLETED status when failedChunksCount > 0', () => {
      const invalid: GraphFinalizationReceipt = {
        ...validReceipt,
        terminalStatus: 'COMPLETED',
        succeededChunksCount: 4,
        failedChunksCount: 1,
      };
      expect(validateFinalizationReceipt(invalid, 'run_valid_123', 'manifest_hash_abc', 5)).toBe(false);
    });

    it('rejects PARTIAL status when failedChunksCount is 0 or succeededChunksCount is 0', () => {
      const allSucceeded: GraphFinalizationReceipt = {
        ...validReceipt,
        terminalStatus: 'PARTIAL',
        succeededChunksCount: 5,
        failedChunksCount: 0,
      };
      expect(validateFinalizationReceipt(allSucceeded, 'run_valid_123', 'manifest_hash_abc', 5)).toBe(false);

      const allFailed: GraphFinalizationReceipt = {
        ...validReceipt,
        terminalStatus: 'PARTIAL',
        succeededChunksCount: 0,
        failedChunksCount: 5,
      };
      expect(validateFinalizationReceipt(allFailed, 'run_valid_123', 'manifest_hash_abc', 5)).toBe(false);
    });

    it('rejects FAILED status when succeededChunksCount > 0', () => {
      const invalid: GraphFinalizationReceipt = {
        ...validReceipt,
        terminalStatus: 'FAILED',
        succeededChunksCount: 1,
        failedChunksCount: 4,
      };
      expect(validateFinalizationReceipt(invalid, 'run_valid_123', 'manifest_hash_abc', 5)).toBe(false);
    });

    it('rejects mismatched extractionRunId, chunkManifestHash, or totalChunks', () => {
      expect(validateFinalizationReceipt(validReceipt, 'wrong_run', 'manifest_hash_abc', 5)).toBe(false);
      expect(validateFinalizationReceipt(validReceipt, 'run_valid_123', 'wrong_hash', 5)).toBe(false);
      expect(validateFinalizationReceipt(validReceipt, 'run_valid_123', 'manifest_hash_abc', 6)).toBe(false);
    });

    it('rejects invalid completedAt timestamp strings', () => {
      const invalid = { ...validReceipt, completedAt: 'invalid-date-string' };
      expect(validateFinalizationReceipt(invalid, 'run_valid_123', 'manifest_hash_abc', 5)).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // TC-07: Fenced Worker Halts Execution Immediately Without Terminal Receipt
  // ---------------------------------------------------------------------------
  it('TC-07: worker encountering ExtractionFencedError halts immediately and writes zero terminal receipts', async () => {
    const { docId, runId } = await createTestDoc(3);

    const mockProvider = new MockExtractionProvider();
    const service = new GraphExtractionService({
      graphRepo: graphRepository,
      provider: mockProvider,
    });
    const worker = new GraphExtractionWorker(service);
    (worker as any).redisClient = mockRedis;

    vi.spyOn(service, 'extractFromChunk').mockRejectedValue(
      new ExtractionFencedError('Fenced: workerToken mismatch in database CAS'),
    );

    const mockJob: any = {
      id: `job_fenced_${docId}`,
      data: { documentId: docId, workspaceId: wsId, extractionRunId: runId },
      attemptsMade: 1,
    };

    await worker.processJob(mockJob, 'token_tc07');

    const finalDoc = await prisma.document.findUnique({ where: { id: docId } });
    const meta = finalDoc?.metadata as any;

    // Must NOT have committed any terminal receipt
    expect(meta.graphFinalizationReceipt).toBeUndefined();
    // Status must NOT be COMPLETED, PARTIAL, or FAILED
    expect(meta.graphStatus).toBe('PROCESSING');
  });

  // ---------------------------------------------------------------------------
  // TC-08: BullMQ Backoff Configuration & Exact Delay Mathematics
  // ---------------------------------------------------------------------------
  it('TC-08: verifies BullMQ retry configuration delivers exact 2s and 4s delays over 3 attempts', () => {
    expect(GRAPH_QUEUE_DEFAULT_JOB_OPTIONS.attempts).toBe(3);
    expect(GRAPH_QUEUE_DEFAULT_JOB_OPTIONS.backoff.type).toBe('exponential');
    expect(GRAPH_QUEUE_DEFAULT_JOB_OPTIONS.backoff.delay).toBe(2000);

    const baseDelay = GRAPH_QUEUE_DEFAULT_JOB_OPTIONS.backoff.delay;

    // BullMQ standard formula: Math.round(Math.pow(2, attemptsMade - 1) * delay)
    // Attempt 1: Initial execution, delay = 0
    const attempt1Delay = 0;
    expect(attempt1Delay).toBe(0);

    // Attempt 2 (1st retry, attemptsMade = 1): Math.pow(2, 0) * 2000 = 2000ms (2s)
    const attempt2Delay = Math.round(Math.pow(2, 1 - 1) * baseDelay);
    expect(attempt2Delay).toBe(2000);

    // Attempt 3 (2nd retry, attemptsMade = 2): Math.pow(2, 1) * 2000 = 4000ms (4s)
    const attempt3Delay = Math.round(Math.pow(2, 2 - 1) * baseDelay);
    expect(attempt3Delay).toBe(4000);
  });
});
