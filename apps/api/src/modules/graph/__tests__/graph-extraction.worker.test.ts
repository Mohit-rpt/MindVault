import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../../../lib/prisma.js';
import { graphRepository } from '../repositories/graph.repository.js';
import { GraphExtractionService } from '../services/graph-extraction.service.js';
import { GraphExtractionWorker } from '../worker/graph-extraction.worker.js';
import { MockExtractionProvider } from '../providers/mock-extraction.provider.js';
import { InMemoryGraphExtractionQueue } from '../queue/graph-extraction.queue.js';

describe('Phase 6.1: GraphExtractionWorker Integration Tests', () => {
  let wsId: string;
  let docId: string;
  let chunkId: string;
  let mockProvider: MockExtractionProvider;
  let worker: GraphExtractionWorker;

  const content = 'PostgreSQL is used by MindVault for relational data and graph storage.';

  beforeAll(async () => {
    mockProvider = new MockExtractionProvider();
    const service = new GraphExtractionService({
      graphRepo: graphRepository,
      provider: mockProvider,
    });
    worker = new GraphExtractionWorker(service);

    const ws = await prisma.workspace.create({
      data: { name: 'Worker Test WS', slug: `worker-ws-${Date.now()}` },
    });
    wsId = ws.id;

    const user = await prisma.user.create({
      data: {
        email: `worker-test-${Date.now()}@mindvault.dev`,
        passwordHash: 'dummy',
        name: 'Worker Tester',
      },
    });

    const doc = await prisma.document.create({
      data: {
        workspaceId: wsId,
        uploadedById: user.id,
        originalName: 'Worker_Storage.pdf',
        mimeType: 'application/pdf',
        extension: 'pdf',
        sizeBytes: BigInt(1024),
        checksum: `chk-w-${Date.now()}`,
        storageKey: `key-w-${Date.now()}`,
      },
    });
    docId = doc.id;

    const chunk = await prisma.documentChunk.create({
      data: {
        documentId: docId,
        workspaceId: wsId,
        chunkIndex: 0,
        content,
        tokenCount: 11,
      },
    });
    chunkId = chunk.id;
  });

  afterAll(async () => {
    await prisma.workspace.delete({ where: { id: wsId } });
  });

  it('processes a single-chunk job payload successfully', async () => {
    mockProvider.setResponseForChunk(content, {
      version: '1.0',
      entities: [
        { name: 'PostgreSQL', entityType: 'TECHNOLOGY', aliases: [], confidence: 0.95 },
        { name: 'MindVault', entityType: 'PRODUCT', aliases: [], confidence: 0.98 },
      ],
      relations: [
        {
          sourceEntity: 'MindVault',
          targetEntity: 'PostgreSQL',
          relationType: 'USES',
          description: 'MindVault uses PostgreSQL',
          confidence: 0.95,
          evidence: 'PostgreSQL is used by MindVault for relational data',
        },
      ],
    });

    const result = await worker.processJob({
      workspaceId: wsId,
      documentId: docId,
      chunkId,
    });

    expect(result).not.toBeNull();
    const chunkRes = result as any;
    expect(chunkRes.chunkId).toBe(chunkId);
    expect(chunkRes.entitiesResolved).toBe(2);
    expect(chunkRes.relationsPersisted).toBe(1);
  });

  it('processes a document-level job payload successfully', async () => {
    const result = await worker.processJob({
      workspaceId: wsId,
      documentId: docId,
    });

    expect(result).not.toBeNull();
    const docRes = result as any;
    expect(docRes.status).toBe('COMPLETED');
    expect(docRes.totalChunks).toBe(1);
  });

  it('handles deleted document gracefully without crashing', async () => {
    const fakeDocId = 'non_existent_doc_id';
    const result = await worker.processJob({
      workspaceId: wsId,
      documentId: fakeDocId,
    });

    expect(result).toBeNull();
  });

  it('handles deleted chunk gracefully without crashing', async () => {
    const fakeChunkId = 'non_existent_chunk_id';
    const result = await worker.processJob({
      workspaceId: wsId,
      documentId: docId,
      chunkId: fakeChunkId,
    });

    expect(result).toBeNull();
  });

  it('rejects invalid job payload missing workspaceId or documentId', async () => {
    await expect(
      worker.processJob({
        workspaceId: '',
        documentId: docId,
      }),
    ).rejects.toThrow(/workspaceId and documentId are required/);

    await expect(
      worker.processJob({
        workspaceId: wsId,
        documentId: '',
      }),
    ).rejects.toThrow(/workspaceId and documentId are required/);
  });

  it('dispatches and consumes jobs asynchronously via InMemoryGraphExtractionQueue', async () => {
    const memoryQueue = new InMemoryGraphExtractionQueue();
    let processed = false;

    memoryQueue.handler = async (payload) => {
      await worker.processJob(payload);
      processed = true;
    };

    await memoryQueue.enqueue({
      workspaceId: wsId,
      documentId: docId,
      chunkId,
    });

    expect(memoryQueue.jobs).toHaveLength(1);

    // Wait for in-memory asynchronous handler to execute
    for (let i = 0; i < 30; i++) {
      if (processed) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(processed).toBe(true);

    await memoryQueue.close();
    expect(memoryQueue.jobs).toHaveLength(0);
  });
});
