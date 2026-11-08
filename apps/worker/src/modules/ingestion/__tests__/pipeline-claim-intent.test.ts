import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DocumentIngestionPipeline, type IngestionDatabaseService } from '../pipeline.js';
import type {
  DocumentStorageProvider,
  EmbeddingProvider,
  ProcessDocumentJobPayload,
} from '@mindvault/shared';
import type { IWorkerGraphQueue } from '../../../lib/graph-queue.js';

describe('Phase 6.4.1: Ingestion Pipeline Claim-and-Intent Protocol (§6.3.3)', () => {
  let mockStorage: DocumentStorageProvider;
  let mockEmbeddings: EmbeddingProvider;
  let mockDb: IngestionDatabaseService;
  let mockQueue: IWorkerGraphQueue;
  let pipeline: DocumentIngestionPipeline;

  const mockPayload: ProcessDocumentJobPayload = {
    documentId: 'doc-claim-test-123',
    workspaceId: 'ws-claim-test-456',
    userId: 'user-claim-test-789',
  };

  const sampleText = 'This is section one.\n\nThis is section two with more content.';

  beforeEach(() => {
    mockStorage = {
      read: vi.fn().mockResolvedValue(Buffer.from(sampleText)),
      save: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      exists: vi.fn().mockResolvedValue(true),
    };

    mockEmbeddings = {
      modelName: 'text-embedding-3-small',
      dimension: 1536,
      generateEmbedding: vi.fn().mockResolvedValue(new Array(1536).fill(0.01)),
      generateEmbeddings: vi.fn().mockImplementation(async (texts: string[]) => {
        return texts.map(() => new Array(1536).fill(0.01));
      }),
    };

    mockDb = {
      findDocumentById: vi.fn().mockResolvedValue({
        id: mockPayload.documentId,
        workspaceId: mockPayload.workspaceId,
        storageKey: 'test/storage/key.txt',
        mimeType: 'text/plain',
        extension: 'txt',
        checksum: 'sha256-doc-checksum-xyz',
        metadata: { existingKey: 'preservedValue' },
      }),
      updateDocument: vi.fn().mockImplementation(async (_id, data) => data),
      createDocumentChunks: vi.fn().mockResolvedValue(undefined),
    };

    mockQueue = {
      enqueue: vi.fn().mockResolvedValue('graph_doc-claim-test-123_run-abc'),
      close: vi.fn().mockResolvedValue(undefined),
    };

    pipeline = new DocumentIngestionPipeline(mockStorage, mockEmbeddings, mockDb, mockQueue);
  });

  it('records pendingDispatch intent atomically in PostgreSQL with enqueuedAt=null before queueing', async () => {
    await pipeline.processDocument(mockPayload);

    // Verify createDocumentChunks was called with deterministic chunk IDs
    expect(mockDb.createDocumentChunks).toHaveBeenCalledTimes(1);
    const createdChunks = (mockDb.createDocumentChunks as any).mock.calls[0][0];
    expect(createdChunks.length).toBeGreaterThan(0);
    expect(createdChunks[0].id).toBe(`chk_${mockPayload.documentId}_0`);

    // Verify updateDocument was called for Stage 8 (COMPLETED)
    const updateCalls = (mockDb.updateDocument as any).mock.calls;
    // Find the call setting status = 'COMPLETED'
    const completedCall = updateCalls.find((call: any[]) => call[1].status === 'COMPLETED');
    expect(completedCall).toBeDefined();

    const metadata = completedCall[1].metadata;
    expect(metadata.graphStatus).toBe('QUEUED');
    expect(metadata.graphAttempts).toBe(1);
    expect(metadata.extractionRunId).toBeDefined();
    expect(metadata.chunkManifestHash).toBeDefined();
    expect(metadata.chunkManifestHash).toHaveLength(64);

    // Initial pendingDispatch intent in Stage 8 update
    const pending = metadata.pendingDispatch;
    expect(pending).toBeDefined();
    expect(pending.extractionRunId).toBe(metadata.extractionRunId);
    expect(pending.jobId).toBe(`graph_${mockPayload.documentId}_${metadata.extractionRunId}`);
    expect(pending.enqueuedAt).toBeNull();
    expect(pending.createdAt).toBeDefined();
    expect(pending.attempts).toBe(0);
  });

  it('confirms pendingDispatch.enqueuedAt in DB after successful Redis dispatch', async () => {
    await pipeline.processDocument(mockPayload);

    // Verify enqueue was called with run identity & manifest hash
    expect(mockQueue.enqueue).toHaveBeenCalledTimes(1);
    const enqueueArg = (mockQueue.enqueue as any).mock.calls[0][0];
    expect(enqueueArg.documentId).toBe(mockPayload.documentId);
    expect(enqueueArg.workspaceId).toBe(mockPayload.workspaceId);
    expect(enqueueArg.extractionRunId).toBeDefined();
    expect(enqueueArg.chunkManifestHash).toBeDefined();

    // Verify final update confirmed enqueuedAt
    const updateCalls = (mockDb.updateDocument as any).mock.calls;
    const finalUpdate = updateCalls[updateCalls.length - 1];
    expect(finalUpdate[1].metadata.pendingDispatch.enqueuedAt).not.toBeNull();
    expect(new Date(finalUpdate[1].metadata.pendingDispatch.enqueuedAt).getTime()).not.toBeNaN();
  });

  it('leaves pendingDispatch.enqueuedAt=null and succeeds ingestion when Redis enqueue fails (Dual-Write safety)', async () => {
    // Simulate Redis connectivity failure
    (mockQueue.enqueue as any).mockRejectedValueOnce(new Error('ECONNREFUSED: Redis unavailable'));

    // Ingestion pipeline should NOT throw! It logs warning and completes.
    await expect(pipeline.processDocument(mockPayload)).resolves.not.toThrow();

    // Verify updateDocument recorded COMPLETED status and intent survives with enqueuedAt=null
    const updateCalls = (mockDb.updateDocument as any).mock.calls;
    const completedCall = updateCalls.find((call: any[]) => call[1].status === 'COMPLETED');
    expect(completedCall).toBeDefined();
    expect(completedCall[1].metadata.pendingDispatch.enqueuedAt).toBeNull();

    // There should be NO confirmation call after enqueue failure
    const confirmationCall = updateCalls.find(
      (call: any[]) =>
        call[1].metadata?.pendingDispatch?.enqueuedAt !== null &&
        call[1].metadata?.pendingDispatch?.enqueuedAt !== undefined,
    );
    expect(confirmationCall).toBeUndefined();
  });
});
