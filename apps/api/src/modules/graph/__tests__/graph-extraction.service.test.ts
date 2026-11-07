import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../../../lib/prisma.js';
import { graphRepository } from '../repositories/graph.repository.js';
import { GraphExtractionService } from '../services/graph-extraction.service.js';
import { MockExtractionProvider } from '../providers/mock-extraction.provider.js';

describe('Phase 6.1: GraphExtractionService Pipeline Integration Tests', () => {
  let wsAlphaId: string;
  let wsBetaId: string;
  let docAlphaId: string;
  let chunk1Id: string;
  let chunk2Id: string;
  let mockProvider: MockExtractionProvider;
  let service: GraphExtractionService;

  const chunk1Content =
    'BullMQ is a background message queue for Node.js that uses Redis for reliable job persistence.';
  const chunk2Content =
    'Redis provides sub-millisecond atomic data structures that BullMQ relies upon.';

  beforeAll(async () => {
    mockProvider = new MockExtractionProvider();
    service = new GraphExtractionService({
      graphRepo: graphRepository,
      provider: mockProvider,
    });

    // 1. Create Workspaces
    const wsA = await prisma.workspace.create({
      data: { name: 'Extract WS Alpha', slug: `extract-alpha-${Date.now()}` },
    });
    wsAlphaId = wsA.id;

    const wsB = await prisma.workspace.create({
      data: { name: 'Extract WS Beta', slug: `extract-beta-${Date.now()}` },
    });
    wsBetaId = wsB.id;

    // 2. Create User
    const user = await prisma.user.create({
      data: {
        email: `extract-test-${Date.now()}@mindvault.dev`,
        passwordHash: 'dummy',
        name: 'Extractor Tester',
      },
    });

    // 3. Create Document in Workspace Alpha
    const doc = await prisma.document.create({
      data: {
        workspaceId: wsAlphaId,
        uploadedById: user.id,
        originalName: 'Queue_Systems.pdf',
        mimeType: 'application/pdf',
        extension: 'pdf',
        sizeBytes: BigInt(2048),
        checksum: `chk-ext-${Date.now()}`,
        storageKey: `key-ext-${Date.now()}`,
      },
    });
    docAlphaId = doc.id;

    // 4. Create Chunks
    const c1 = await prisma.documentChunk.create({
      data: {
        documentId: docAlphaId,
        workspaceId: wsAlphaId,
        chunkIndex: 0,
        content: chunk1Content,
        tokenCount: 15,
      },
    });
    chunk1Id = c1.id;

    const c2 = await prisma.documentChunk.create({
      data: {
        documentId: docAlphaId,
        workspaceId: wsAlphaId,
        chunkIndex: 1,
        content: chunk2Content,
        tokenCount: 12,
      },
    });
    chunk2Id = c2.id;
  });

  afterAll(async () => {
    await prisma.workspace.deleteMany({
      where: { id: { in: [wsAlphaId, wsBetaId] } },
    });
  });

  it('extracts entities and relations from a chunk and persists mentions and evidence', async () => {
    mockProvider.setResponseForChunk(chunk1Content, {
      version: '1.0',
      entities: [
        {
          name: 'BullMQ',
          entityType: 'TECHNOLOGY',
          aliases: ['bull-mq'],
          confidence: 0.96,
          sourceText: 'BullMQ is a background message queue',
        },
        {
          name: 'Redis',
          entityType: 'TECHNOLOGY',
          aliases: ['redis-server'],
          confidence: 0.98,
          sourceText: 'uses Redis for reliable job persistence',
        },
      ],
      relations: [
        {
          sourceEntity: 'BullMQ',
          targetEntity: 'Redis',
          relationType: 'USES',
          description: 'BullMQ uses Redis for persistence',
          confidence: 0.95,
          evidence: 'uses Redis for reliable job persistence',
        },
      ],
    });

    const result = await service.extractFromChunk(wsAlphaId, docAlphaId, chunk1Id, chunk1Content);

    expect(result.entitiesExtracted).toBe(2);
    expect(result.entitiesResolved).toBe(2);
    expect(result.mentionsCreated).toBe(2);
    expect(result.relationsPersisted).toBe(1);
    expect(result.evidenceCreated).toBe(1);

    // Verify mentions in database
    const mentions = await prisma.chunkEntityMention.findMany({
      where: { chunkId: chunk1Id, workspaceId: wsAlphaId },
    });
    expect(mentions).toHaveLength(2);

    // Verify relation in database
    const rel = await prisma.graphRelation.findFirst({
      where: { workspaceId: wsAlphaId, relationType: 'USES' },
    });
    expect(rel).not.toBeNull();
    expect(rel?.weight).toBe(1.0);
  });

  it('enforces idempotency on re-extracting the same chunk (no duplicate mentions or evidence)', async () => {
    // Re-extracting chunk1 with same content
    const result2 = await service.extractFromChunk(wsAlphaId, docAlphaId, chunk1Id, chunk1Content);

    expect(result2.entitiesResolved).toBe(2);

    // Mentions count in database must remain 2 (not duplicated to 4)
    const mentions = await prisma.chunkEntityMention.findMany({
      where: { chunkId: chunk1Id, workspaceId: wsAlphaId },
    });
    expect(mentions).toHaveLength(2);

    // Evidence count for chunk1 must remain 1
    const evidence = await prisma.relationEvidence.findMany({
      where: { chunkId: chunk1Id, workspaceId: wsAlphaId },
    });
    expect(evidence).toHaveLength(1);
  });

  it('processes full document across all chunks and records metadata.graphStatus = COMPLETED', async () => {
    mockProvider.setResponseForChunk(chunk2Content, {
      version: '1.0',
      entities: [
        {
          name: 'Redis',
          entityType: 'TECHNOLOGY',
          aliases: [],
          confidence: 0.98,
          sourceText: 'Redis provides sub-millisecond atomic data structures',
        },
        {
          name: 'BullMQ',
          entityType: 'TECHNOLOGY',
          aliases: [],
          confidence: 0.95,
          sourceText: 'BullMQ relies upon',
        },
      ],
      relations: [
        {
          sourceEntity: 'BullMQ',
          targetEntity: 'Redis',
          relationType: 'USES',
          description: 'BullMQ relies upon Redis data structures',
          confidence: 0.99,
          evidence:
            'Redis provides sub-millisecond atomic data structures that BullMQ relies upon.',
        },
      ],
    });

    const docResult = await service.extractDocument(wsAlphaId, docAlphaId);

    expect(docResult.totalChunks).toBe(2);
    expect(docResult.processedChunks).toBe(2);
    expect(docResult.status).toBe('COMPLETED');
    expect(docResult.totalRelations).toBeGreaterThanOrEqual(1);

    // Verify document metadata was updated
    const updatedDoc = await prisma.document.findUniqueOrThrow({
      where: { id: docAlphaId },
    });
    const meta = updatedDoc.metadata as any;
    expect(meta.graphStatus).toBe('COMPLETED');
    expect(meta.graphExtractedAt).toBeDefined();

    // Verify relation was reinforced by chunk2 (weight increased)
    const rel = await prisma.graphRelation.findFirst({
      where: { workspaceId: wsAlphaId, relationType: 'USES' },
    });
    expect(rel?.weight).toBeGreaterThanOrEqual(2.0);
  });

  it('REJECTS extracting document across mismatched workspace (tenant boundary check)', async () => {
    // Attempting to extract Document Alpha with Workspace Beta ID
    await expect(service.extractDocument(wsBetaId, docAlphaId)).rejects.toThrow(
      /not found in workspace/,
    );
  });
});
