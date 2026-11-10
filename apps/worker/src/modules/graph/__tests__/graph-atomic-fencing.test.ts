/**
 * MindVault — Phase 6.4.3: Database-Enforced Atomic Fencing & Checkpointing Adversarial Test Suite
 *
 * Verifies the 10 mandatory invariants from Phase 6.4 Blueprint v4.5.6:
 * - TS-01: Valid active worker persists chunk cleanly
 * - TS-02: Superseded extraction run throws ExtractionFencedError and writes 0 records
 * - TS-03: Stale worker (expired lease / token mismatch) cannot advance checkpoint
 * - TS-04: Graph data and checkpoint roll back together on failure
 * - TS-05: Source-manifest change invalidates stale checkpoints and restarts from Chunk 0
 * - TS-06: Two concurrent workers cannot both persist under invalid ownership
 * - TS-07: Terminal extraction states reject late chunk writes
 * - TS-08: External LLM calls occur strictly outside database transactions
 * - TS-09: Deterministic lock ordering (Tier 1 row lock before Tier 2 advisory locks in ascending numerical order)
 * - TS-10: Checkpoint progression and finalization remain consistent across retries
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ExtractionFencedError } from '../errors/extraction-fenced.error.js';
import { computeRelationLockKey, sortRelationsByLockKey } from '../utils/advisory-lock.util.js';
import {
  computeChunkManifestHash,
  type KnowledgeExtractionResponse,
  type GraphChunkCheckpoint,
} from '@mindvault/shared';
import { GraphExtractionService } from '../services/graph-extraction.service.js';
import { GraphRepository } from '../repositories/graph.repository.js';

// ---------------------------------------------------------------------------
// In-Memory Test State & Mock Database Client
// ---------------------------------------------------------------------------
interface MockDocument {
  id: string;
  workspaceId: string;
  checksum: string;
  metadata: Record<string, any>;
  updatedAt: Date;
}

interface MockChunk {
  id: string;
  documentId: string;
  workspaceId: string;
  chunkIndex: number;
  content: string;
}

class MockPrismaState {
  documents = new Map<string, MockDocument>();
  chunks = new Map<string, MockChunk[]>();
  entities = new Map<string, any>();
  aliases = new Map<string, any>();
  relations = new Map<string, any>();
  mentions = new Map<string, any>();
  evidence = new Map<string, any>();

  // Diagnostic tracking
  inTransaction = false;
  llmCallsInTransaction: string[] = [];
  statementLog: string[] = [];
  advisoryLocksAcquired: bigint[] = [];
  simulateRollbackOnCommit = false;

  reset() {
    this.documents.clear();
    this.chunks.clear();
    this.entities.clear();
    this.aliases.clear();
    this.relations.clear();
    this.mentions.clear();
    this.evidence.clear();
    this.inTransaction = false;
    this.llmCallsInTransaction = [];
    this.statementLog = [];
    this.advisoryLocksAcquired = [];
    this.simulateRollbackOnCommit = false;
  }
}

const testDb = new MockPrismaState();

/**
 * Creates a transaction-scoped Prisma client mock that records statement order,
 * advisory locks, and transactional rollbacks.
 */
function createMockTx(snapshotDb: MockPrismaState, rollbackRef: { shouldRollback: boolean }) {
  // Local transaction staging
  const stagedEntities = new Map<string, any>();
  const stagedRelations = new Map<string, any>();
  const stagedMentions = new Map<string, any>();
  const stagedEvidence = new Map<string, any>();

  const tx: any = {
    $queryRaw: vi.fn().mockImplementation(async (strings: any, ...values: any[]) => {
      const sql = strings?.raw
        ? strings.raw.join(' ')
        : Array.isArray(strings)
          ? strings.join(' ')
          : String(strings);
      snapshotDb.statementLog.push(sql);

      // Tier 1 Document Row Lock: SELECT ... FOR NO KEY UPDATE
      if (sql.includes('FOR NO KEY UPDATE')) {
        const docId = values[0];
        const doc = snapshotDb.documents.get(docId);
        if (!doc) return [];
        return [{ id: doc.id, metadata: doc.metadata }];
      }

      // Snapshot Read: SELECT metadata, ... FROM "documents"
      if (sql.includes("metadata->>'extractionRunId'") || sql.includes('dbWallClock')) {
        const docId = values[0];
        const doc = snapshotDb.documents.get(docId);
        if (!doc) return [];

        const meta = doc.metadata || {};
        const expiresAt = meta.graphLeaseExpiresAt
          ? new Date(meta.graphLeaseExpiresAt).getTime()
          : 0;
        const now = Date.now();
        const isLeaseValid = expiresAt > now;

        return [
          {
            id: doc.id,
            metadata: doc.metadata,
            extractionRunId: meta.extractionRunId || null,
            graphWorkerToken: meta.graphWorkerToken || null,
            graphLeaseGeneration: meta.graphLeaseGeneration || null,
            graphLeaseExpiresAt: meta.graphLeaseExpiresAt || null,
            graphStatus: meta.graphStatus || null,
            graphFinalizationReceipt: meta.graphFinalizationReceipt || null,
            isLeaseValid,
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
      snapshotDb.statementLog.push(sql);

      // Tier 2 Advisory Lock: SELECT pg_advisory_xact_lock(...)
      if (sql.includes('pg_advisory_xact_lock')) {
        const key = BigInt(values[0]);
        snapshotDb.advisoryLocksAcquired.push(key);
        return 1;
      }

      // Step 8: Atomic Checkpoint Commit & Pre-Commit Lease Validation
      if (sql.includes("'{graphCheckpoint}'")) {
        if (snapshotDb.simulateRollbackOnCommit || rollbackRef.shouldRollback) {
          return 0; // CAS failure
        }

        const docId = values[1];
        const doc = snapshotDb.documents.get(docId);
        if (!doc) return 0;

        const expectedRunId = values[3];
        const expectedWorkerToken = values[4];

        if (doc.metadata?.extractionRunId !== expectedRunId) return 0;
        if (doc.metadata?.graphWorkerToken !== expectedWorkerToken) return 0;

        const expiresAt = doc.metadata?.graphLeaseExpiresAt
          ? new Date(doc.metadata.graphLeaseExpiresAt).getTime()
          : 0;
        if (expiresAt <= Date.now()) return 0;

        const checkpointData = typeof values[0] === 'string' ? JSON.parse(values[0]) : values[0];
        doc.metadata.graphCheckpoint = checkpointData;
        doc.metadata.graphHeartbeatAt = new Date().toISOString();
        doc.metadata.graphLeaseExpiresAt = new Date(Date.now() + 60000).toISOString();
        doc.updatedAt = new Date();

        // Commit staged items into main DB on successful checkpoint
        for (const [k, v] of stagedEntities) snapshotDb.entities.set(k, v);
        for (const [k, v] of stagedRelations) snapshotDb.relations.set(k, v);
        for (const [k, v] of stagedMentions) snapshotDb.mentions.set(k, v);
        for (const [k, v] of stagedEvidence) snapshotDb.evidence.set(k, v);

        return 1;
      }

      return 1;
    }),

    graphEntity: {
      findUnique: vi.fn().mockImplementation(async ({ where }: any) => {
        if (where?.workspaceId_id) {
          return (
            snapshotDb.entities.get(where.workspaceId_id.id) ||
            stagedEntities.get(where.workspaceId_id.id) ||
            null
          );
        }
        if (where?.workspaceId_normalizedName) {
          for (const e of [...snapshotDb.entities.values(), ...stagedEntities.values()]) {
            if (e.normalizedName === where.workspaceId_normalizedName.normalizedName) return e;
          }
        }
        return null;
      }),
      create: vi.fn().mockImplementation(async ({ data }: any) => {
        const id = `ent_${Date.now()}_${Math.random()}`;
        const record = { id, ...data };
        stagedEntities.set(id, record);
        return record;
      }),
      update: vi.fn().mockImplementation(async ({ where, data }: any) => {
        const id = where.workspaceId_id.id;
        const existing = snapshotDb.entities.get(id) || stagedEntities.get(id);
        const updated = { ...existing, ...data };
        stagedEntities.set(id, updated);
        return updated;
      }),
    },

    graphEntityAlias: {
      findUnique: vi.fn().mockImplementation(async () => null),
      create: vi.fn().mockImplementation(async ({ data }: any) => {
        const id = `alias_${Date.now()}_${Math.random()}`;
        const record = { id, ...data };
        snapshotDb.aliases.set(id, record);
        return record;
      }),
    },

    graphRelation: {
      findUnique: vi.fn().mockImplementation(async ({ where }: any) => {
        if (where?.workspaceId_id) {
          return (
            snapshotDb.relations.get(where.workspaceId_id.id) ||
            stagedRelations.get(where.workspaceId_id.id) ||
            null
          );
        }
        if (where?.workspaceId_sourceEntityId_targetEntityId_relationType) {
          const w = where.workspaceId_sourceEntityId_targetEntityId_relationType;
          for (const r of [...snapshotDb.relations.values(), ...stagedRelations.values()]) {
            if (
              r.sourceEntityId === w.sourceEntityId &&
              r.targetEntityId === w.targetEntityId &&
              r.relationType === w.relationType
            ) {
              return r;
            }
          }
        }
        return null;
      }),
      create: vi.fn().mockImplementation(async ({ data }: any) => {
        const id = `rel_${Date.now()}_${Math.random()}`;
        const record = { id, ...data };
        stagedRelations.set(id, record);
        return record;
      }),
      update: vi.fn().mockImplementation(async ({ where, data }: any) => {
        const id = where.workspaceId_id.id;
        const existing = snapshotDb.relations.get(id) || stagedRelations.get(id);
        const updated = { ...existing, ...data };
        stagedRelations.set(id, updated);
        return updated;
      }),
    },

    chunkEntityMention: {
      findFirst: vi.fn().mockImplementation(async () => null),
      create: vi.fn().mockImplementation(async ({ data }: any) => {
        const id = `mention_${Date.now()}_${Math.random()}`;
        const record = { id, ...data };
        stagedMentions.set(id, record);
        return { id };
      }),
    },

    relationEvidence: {
      findUnique: vi.fn().mockImplementation(async () => null),
      create: vi.fn().mockImplementation(async ({ data }: any) => {
        const id = `evidence_${Date.now()}_${Math.random()}`;
        const record = { id, ...data };
        stagedEvidence.set(id, record);
        return { id };
      }),
    },
  };

  return { tx, stagedEntities, stagedRelations };
}

describe('MindVault Phase 6.4.3: Database-Enforced Atomic Fencing & Checkpointing', () => {
  const workspaceId = 'ws-test-fencing';
  const documentId = 'doc-test-fencing';
  const extractionRunId = 'run_active_123';
  const workerToken = 'token_worker_active';

  let service: GraphExtractionService;
  let mockProvider: any;

  beforeEach(() => {
    testDb.reset();

    // Default mock document with valid 60s lease
    const chunks: MockChunk[] = [
      {
        id: 'chunk_0',
        documentId,
        workspaceId,
        chunkIndex: 0,
        content: 'Antigravity engine utilizes quantum tunneling to negate gravitational inertia.',
      },
      {
        id: 'chunk_1',
        documentId,
        workspaceId,
        chunkIndex: 1,
        content: 'The quantum tunneling mechanism requires active magnetic containment fields.',
      },
      {
        id: 'chunk_2',
        documentId,
        workspaceId,
        chunkIndex: 2,
        content: 'Magnetic containment fields prevent thermal decoherence in the quantum vacuum.',
      },
    ];

    testDb.chunks.set(documentId, chunks);

    const manifestHash = computeChunkManifestHash('checksum_doc_v1', chunks);

    testDb.documents.set(documentId, {
      id: documentId,
      workspaceId,
      checksum: 'checksum_doc_v1',
      updatedAt: new Date(),
      metadata: {
        extractionRunId,
        graphWorkerToken: workerToken,
        graphStatus: 'PROCESSING',
        graphLeaseExpiresAt: new Date(Date.now() + 60000).toISOString(),
        graphHeartbeatAt: new Date().toISOString(),
        chunkManifestHash: manifestHash,
      },
    });

    mockProvider = {
      providerName: 'MockProvider',
      modelName: 'mock-llm-v1',
      extract: vi.fn().mockImplementation(async (_content: string) => {
        if (testDb.inTransaction) {
          testDb.llmCallsInTransaction.push('extract() called while holding DB transaction lock');
        }
        const sample: KnowledgeExtractionResponse = {
          version: '1.0',
          entities: [
            {
              name: 'Antigravity engine',
              entityType: 'TECHNOLOGY',
              aliases: [],
              description: 'Propulsion device',
              confidence: 0.95,
            },
            {
              name: 'Quantum tunneling',
              entityType: 'CONCEPT',
              aliases: [],
              description: 'Subatomic phenomenon',
              confidence: 0.92,
            },
          ],
          relations: [
            {
              sourceEntity: 'Antigravity engine',
              targetEntity: 'Quantum tunneling',
              relationType: 'USES',
              description: 'Utilizes quantum phenomenon',
              confidence: 0.9,
              evidence: 'Antigravity engine utilizes quantum tunneling',
            },
          ],
        };
        return sample;
      }),
    };

    service = new GraphExtractionService({
      graphRepo: new GraphRepository(),
      provider: mockProvider,
    });
  });

  // -------------------------------------------------------------------------
  // TS-01: Valid active worker persists chunk cleanly
  // -------------------------------------------------------------------------
  it('TS-01: Valid active worker persists chunk cleanly within atomic transaction', async () => {
    const doc = testDb.documents.get(documentId)!;
    const manifestHash = doc.metadata.chunkManifestHash;

    const rawExtraction = await service.extractRaw(testDb.chunks.get(documentId)![0].content);
    const rollbackRef = { shouldRollback: false };
    const { tx } = createMockTx(testDb, rollbackRef);

    const result = await service.persistChunkExtraction(tx, {
      workspaceId,
      documentId,
      chunkId: 'chunk_0',
      chunkIndex: 0,
      totalChunks: 3,
      content: testDb.chunks.get(documentId)![0].content,
      extractionRunId,
      workerToken,
      chunkManifestHash: manifestHash,
      rawExtraction,
    });

    expect(result.updatedCheckpoint.lastCompletedChunkIndex).toBe(0);
    expect(result.updatedCheckpoint.lastCompletedChunkId).toBe('chunk_0');
    expect(result.entitiesResolved).toBe(2);
    expect(result.relationsPersisted).toBe(1);
    expect(result.evidenceCreated).toBe(1);

    // Document metadata has advanced checkpoint
    expect(doc.metadata.graphCheckpoint.lastCompletedChunkIndex).toBe(0);
    expect(doc.metadata.graphCheckpoint.extractionRunId).toBe(extractionRunId);
  });

  // -------------------------------------------------------------------------
  // TS-02: Superseded extraction run throws ExtractionFencedError and writes 0 records
  // -------------------------------------------------------------------------
  it('TS-02: Superseded extraction run throws ExtractionFencedError and rolls back completely', async () => {
    const doc = testDb.documents.get(documentId)!;
    const manifestHash = doc.metadata.chunkManifestHash;

    // Simulate recovery sweep superseding active run with new run ID
    doc.metadata.extractionRunId = 'run_superseded_999';

    const rawExtraction = await service.extractRaw(testDb.chunks.get(documentId)![0].content);
    const rollbackRef = { shouldRollback: false };
    const { tx } = createMockTx(testDb, rollbackRef);

    await expect(
      service.persistChunkExtraction(tx, {
        workspaceId,
        documentId,
        chunkId: 'chunk_0',
        chunkIndex: 0,
        totalChunks: 3,
        content: testDb.chunks.get(documentId)![0].content,
        extractionRunId: 'run_active_123', // Stale run ID
        workerToken,
        chunkManifestHash: manifestHash,
        rawExtraction,
      }),
    ).rejects.toThrow(ExtractionFencedError);

    // Assert zero graph entities or checkpoints were committed
    expect(testDb.entities.size).toBe(0);
    expect(testDb.relations.size).toBe(0);
    expect(doc.metadata.graphCheckpoint).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // TS-03: Stale worker (expired lease / token mismatch) cannot advance checkpoint
  // -------------------------------------------------------------------------
  it('TS-03: Stale worker with expired lease or token mismatch cannot advance checkpoint', async () => {
    const doc = testDb.documents.get(documentId)!;
    const manifestHash = doc.metadata.chunkManifestHash;
    const rawExtraction = await service.extractRaw(testDb.chunks.get(documentId)![0].content);

    // 1. Worker token mismatch
    const rollbackRef1 = { shouldRollback: false };
    const { tx: tx1 } = createMockTx(testDb, rollbackRef1);

    await expect(
      service.persistChunkExtraction(tx1, {
        workspaceId,
        documentId,
        chunkId: 'chunk_0',
        chunkIndex: 0,
        totalChunks: 3,
        content: testDb.chunks.get(documentId)![0].content,
        extractionRunId,
        workerToken: 'different_worker_token', // Token mismatch
        chunkManifestHash: manifestHash,
        rawExtraction,
      }),
    ).rejects.toThrow(ExtractionFencedError);

    // 2. Expired lease
    doc.metadata.graphLeaseExpiresAt = new Date(Date.now() - 5000).toISOString(); // 5s in past
    const rollbackRef2 = { shouldRollback: false };
    const { tx: tx2 } = createMockTx(testDb, rollbackRef2);

    await expect(
      service.persistChunkExtraction(tx2, {
        workspaceId,
        documentId,
        chunkId: 'chunk_0',
        chunkIndex: 0,
        totalChunks: 3,
        content: testDb.chunks.get(documentId)![0].content,
        extractionRunId,
        workerToken,
        chunkManifestHash: manifestHash,
        rawExtraction,
      }),
    ).rejects.toThrow(ExtractionFencedError);
  });

  // -------------------------------------------------------------------------
  // TS-04: Graph data and checkpoint roll back together on failure
  // -------------------------------------------------------------------------
  it('TS-04: Graph data and checkpoint roll back together on transaction failure', async () => {
    const doc = testDb.documents.get(documentId)!;
    const manifestHash = doc.metadata.chunkManifestHash;
    const rawExtraction = await service.extractRaw(testDb.chunks.get(documentId)![0].content);

    // Force CAS failure at Step 8 pre-commit lease validation
    const rollbackRef = { shouldRollback: true };
    const { tx } = createMockTx(testDb, rollbackRef);

    await expect(
      service.persistChunkExtraction(tx, {
        workspaceId,
        documentId,
        chunkId: 'chunk_0',
        chunkIndex: 0,
        totalChunks: 3,
        content: testDb.chunks.get(documentId)![0].content,
        extractionRunId,
        workerToken,
        chunkManifestHash: manifestHash,
        rawExtraction,
      }),
    ).rejects.toThrow(ExtractionFencedError);

    // Verify atomic rollback: no staged items promoted to database
    expect(testDb.entities.size).toBe(0);
    expect(testDb.relations.size).toBe(0);
    expect(testDb.evidence.size).toBe(0);
    expect(doc.metadata.graphCheckpoint).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // TS-05: Source-manifest change invalidates stale checkpoints and restarts from Chunk 0
  // -------------------------------------------------------------------------
  it('TS-05: Source-manifest change invalidates stale checkpoints and rejects late writes', async () => {
    const doc = testDb.documents.get(documentId)!;
    const originalChunks = testDb.chunks.get(documentId)!;

    // Checkpoint was previously recorded against original manifest hash
    const oldManifestHash = computeChunkManifestHash(doc.checksum, originalChunks);
    doc.metadata.graphCheckpoint = {
      extractionRunId,
      chunkManifestHash: oldManifestHash,
      lastCompletedChunkIndex: 1,
      lastCompletedChunkId: 'chunk_1',
      processedChunksCount: 2,
      succeededChunksCount: 2,
      failedChunksCount: 0,
    };

    // User edits document content -> new checksum and new manifest hash
    const modifiedChunks = [
      ...originalChunks.slice(0, 2),
      {
        ...originalChunks[2],
        content: 'EDITED: Magnetic containment fields operating at cryogenic temperatures.',
      },
    ];
    const newManifestHash = computeChunkManifestHash('checksum_doc_v2', modifiedChunks);

    // Stale worker trying to persist chunk with new manifest hash against mismatched checkpoint
    const rawExtraction = await service.extractRaw(originalChunks[0].content);
    const rollbackRef = { shouldRollback: false };
    const { tx } = createMockTx(testDb, rollbackRef);

    await expect(
      service.persistChunkExtraction(tx, {
        workspaceId,
        documentId,
        chunkId: 'chunk_0',
        chunkIndex: 0,
        totalChunks: 3,
        content: originalChunks[0].content,
        extractionRunId,
        workerToken,
        chunkManifestHash: newManifestHash, // Content changed!
        rawExtraction,
      }),
    ).rejects.toThrow(ExtractionFencedError);
  });

  // -------------------------------------------------------------------------
  // TS-06: Two concurrent workers cannot both persist under invalid ownership
  // -------------------------------------------------------------------------
  it('TS-06: Two concurrent workers cannot both persist under invalid ownership', async () => {
    const doc = testDb.documents.get(documentId)!;
    const manifestHash = doc.metadata.chunkManifestHash;
    const rawExtraction = await service.extractRaw(testDb.chunks.get(documentId)![0].content);

    // Worker 1 runs and succeeds
    const rollbackRef1 = { shouldRollback: false };
    const { tx: tx1 } = createMockTx(testDb, rollbackRef1);

    await service.persistChunkExtraction(tx1, {
      workspaceId,
      documentId,
      chunkId: 'chunk_0',
      chunkIndex: 0,
      totalChunks: 3,
      content: testDb.chunks.get(documentId)![0].content,
      extractionRunId,
      workerToken,
      chunkManifestHash: manifestHash,
      rawExtraction,
    });

    expect(doc.metadata.graphCheckpoint.lastCompletedChunkIndex).toBe(0);

    // Worker 2 attempts with a superseded run ID
    const rollbackRef2 = { shouldRollback: false };
    const { tx: tx2 } = createMockTx(testDb, rollbackRef2);

    await expect(
      service.persistChunkExtraction(tx2, {
        workspaceId,
        documentId,
        chunkId: 'chunk_0',
        chunkIndex: 0,
        totalChunks: 3,
        content: testDb.chunks.get(documentId)![0].content,
        extractionRunId: 'run_other_worker',
        workerToken: 'token_other_worker',
        chunkManifestHash: manifestHash,
        rawExtraction,
      }),
    ).rejects.toThrow(ExtractionFencedError);
  });

  // -------------------------------------------------------------------------
  // TS-07: Terminal extraction states reject late chunk writes
  // -------------------------------------------------------------------------
  it('TS-07: Terminal extraction states (COMPLETED, FAILED, PARTIAL, Receipt) reject late chunk writes', async () => {
    const doc = testDb.documents.get(documentId)!;
    const manifestHash = doc.metadata.chunkManifestHash;
    const rawExtraction = await service.extractRaw(testDb.chunks.get(documentId)![0].content);

    const terminalStatuses = ['COMPLETED', 'FAILED', 'PARTIAL'];

    for (const status of terminalStatuses) {
      doc.metadata.graphStatus = status;
      const rollbackRef = { shouldRollback: false };
      const { tx } = createMockTx(testDb, rollbackRef);

      await expect(
        service.persistChunkExtraction(tx, {
          workspaceId,
          documentId,
          chunkId: 'chunk_0',
          chunkIndex: 0,
          totalChunks: 3,
          content: testDb.chunks.get(documentId)![0].content,
          extractionRunId,
          workerToken,
          chunkManifestHash: manifestHash,
          rawExtraction,
        }),
      ).rejects.toThrow(ExtractionFencedError);
    }

    // Also test terminal receipt present
    doc.metadata.graphStatus = 'PROCESSING';
    doc.metadata.graphFinalizationReceipt = {
      terminalStatus: 'COMPLETED',
      extractionRunId,
      completedAt: new Date().toISOString(),
    };

    const rollbackRefReceipt = { shouldRollback: false };
    const { tx: txReceipt } = createMockTx(testDb, rollbackRefReceipt);

    await expect(
      service.persistChunkExtraction(txReceipt, {
        workspaceId,
        documentId,
        chunkId: 'chunk_0',
        chunkIndex: 0,
        totalChunks: 3,
        content: testDb.chunks.get(documentId)![0].content,
        extractionRunId,
        workerToken,
        chunkManifestHash: manifestHash,
        rawExtraction,
      }),
    ).rejects.toThrow(ExtractionFencedError);
  });

  // -------------------------------------------------------------------------
  // TS-08: External LLM calls occur strictly outside database transactions
  // -------------------------------------------------------------------------
  it('TS-08: External LLM calls occur strictly outside database transactions', async () => {
    testDb.inTransaction = false;

    // extractRaw is executed
    const rawExtraction = await service.extractRaw(testDb.chunks.get(documentId)![0].content);

    expect(mockProvider.extract).toHaveBeenCalledTimes(1);
    expect(testDb.llmCallsInTransaction.length).toBe(0);

    // Database transaction is opened AFTER model inference
    testDb.inTransaction = true;
    const rollbackRef = { shouldRollback: false };
    const { tx } = createMockTx(testDb, rollbackRef);

    await service.persistChunkExtraction(tx, {
      workspaceId,
      documentId,
      chunkId: 'chunk_0',
      chunkIndex: 0,
      totalChunks: 3,
      content: testDb.chunks.get(documentId)![0].content,
      extractionRunId,
      workerToken,
      chunkManifestHash: testDb.documents.get(documentId)!.metadata.chunkManifestHash,
      rawExtraction,
    });
    testDb.inTransaction = false;

    // Zero LLM calls happened while inTransaction was true
    expect(testDb.llmCallsInTransaction.length).toBe(0);
  });

  // -------------------------------------------------------------------------
  // TS-09: Deterministic lock ordering (Tier 1 row lock before Tier 2 advisory locks in ascending numerical order)
  // -------------------------------------------------------------------------
  it('TS-09: Deterministic lock ordering: Tier 1 row lock acquired before Tier 2 advisory locks in ascending numerical order', async () => {
    const doc = testDb.documents.get(documentId)!;
    const manifestHash = doc.metadata.chunkManifestHash;

    // Provide multiple relations to test ascending numerical sorting
    const multiRelationResponse: KnowledgeExtractionResponse = {
      version: '1.0',
      entities: [
        { name: 'Entity A', entityType: 'CONCEPT', aliases: [], confidence: 0.9 },
        { name: 'Entity B', entityType: 'CONCEPT', aliases: [], confidence: 0.9 },
        { name: 'Entity C', entityType: 'CONCEPT', aliases: [], confidence: 0.9 },
        { name: 'Entity D', entityType: 'CONCEPT', aliases: [], confidence: 0.9 },
      ],
      relations: [
        {
          sourceEntity: 'Entity A',
          targetEntity: 'Entity B',
          relationType: 'USES',
          confidence: 0.9,
          evidence: 'Entity A uses Entity B in operations',
        },
        {
          sourceEntity: 'Entity B',
          targetEntity: 'Entity C',
          relationType: 'DEPENDS_ON',
          confidence: 0.9,
          evidence: 'Entity B depends on Entity C in operations',
        },
        {
          sourceEntity: 'Entity C',
          targetEntity: 'Entity D',
          relationType: 'CONTAINS',
          confidence: 0.9,
          evidence: 'Entity C contains Entity D in operations',
        },
      ],
    };

    const rollbackRef = { shouldRollback: false };
    const { tx } = createMockTx(testDb, rollbackRef);

    await service.persistChunkExtraction(tx, {
      workspaceId,
      documentId,
      chunkId: 'chunk_0',
      chunkIndex: 0,
      totalChunks: 3,
      content:
        'Entity A uses Entity B in operations. Entity B depends on Entity C in operations. Entity C contains Entity D in operations.',
      extractionRunId,
      workerToken,
      chunkManifestHash: manifestHash,
      rawExtraction: multiRelationResponse,
    });

    // 1. Verify Tier 1 Row Lock was acquired first
    const rowLockIdx = testDb.statementLog.findIndex((s) => s.includes('FOR NO KEY UPDATE'));
    expect(rowLockIdx).toBeGreaterThanOrEqual(0);

    const firstAdvisoryLockIdx = testDb.statementLog.findIndex((s) =>
      s.includes('pg_advisory_xact_lock'),
    );
    expect(firstAdvisoryLockIdx).toBeGreaterThan(rowLockIdx);

    // 2. Verify Tier 2 Advisory locks were acquired in strictly ascending numerical signed 64-bit order
    expect(testDb.advisoryLocksAcquired.length).toBe(3);
    for (let i = 0; i < testDb.advisoryLocksAcquired.length - 1; i++) {
      const current = testDb.advisoryLocksAcquired[i];
      const next = testDb.advisoryLocksAcquired[i + 1];
      expect(current <= next).toBe(true);
    }
  });

  // -------------------------------------------------------------------------
  // TS-10: Checkpoint progression and finalization remain consistent across retries
  // -------------------------------------------------------------------------
  it('TS-10: Checkpoint progression and finalization remain consistent across chunks and retries', async () => {
    const doc = testDb.documents.get(documentId)!;
    const manifestHash = doc.metadata.chunkManifestHash;
    const chunks = testDb.chunks.get(documentId)!;

    let previousCheckpoint: GraphChunkCheckpoint | undefined = undefined;

    // Process chunk 0, 1, 2 sequentially
    for (let i = 0; i < 3; i++) {
      const rawExtraction = await service.extractRaw(chunks[i].content);
      const rollbackRef = { shouldRollback: false };
      const { tx } = createMockTx(testDb, rollbackRef);

      const result = await service.persistChunkExtraction(tx, {
        workspaceId,
        documentId,
        chunkId: chunks[i].id,
        chunkIndex: i,
        totalChunks: 3,
        content: chunks[i].content,
        extractionRunId,
        workerToken,
        chunkManifestHash: manifestHash,
        rawExtraction,
        previousCheckpoint,
      });

      previousCheckpoint = result.updatedCheckpoint;
      expect(result.updatedCheckpoint.lastCompletedChunkIndex).toBe(i);
      expect(result.updatedCheckpoint.processedChunksCount).toBe(i + 1);
    }

    // Verify all 3 chunks completed in checkpoint
    expect(doc.metadata.graphCheckpoint.lastCompletedChunkIndex).toBe(2);
    expect(doc.metadata.graphCheckpoint.processedChunksCount).toBe(3);
    expect(doc.metadata.graphCheckpoint.succeededChunksCount).toBe(3);
  });
});
