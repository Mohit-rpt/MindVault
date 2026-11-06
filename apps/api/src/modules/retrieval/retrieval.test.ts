import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { InMemoryDatabaseService, setDatabaseService } from '../../lib/db.js';
import { EmbeddingService, MockEmbeddingProvider } from './embeddings/embedding.service.js';
import { generateAccessToken } from '../auth/auth.security.js';
import type { UserRecord, WorkspaceRecord, DocumentRecord } from '../../lib/db.js';

describe('Retrieval Engine Integration & Security (Phase 3)', () => {
  let app: ReturnType<typeof createApp>;
  let memoryDb: InMemoryDatabaseService;
  let mockEmbedder: MockEmbeddingProvider;

  let userA: UserRecord;
  let userB: UserRecord;
  let workspaceA: WorkspaceRecord;
  let workspaceB: WorkspaceRecord;

  let tokenUserA: string;
  let tokenUserB: string;

  let docCompletedA: DocumentRecord;
  let docProcessingA: DocumentRecord;
  let docCompletedB: DocumentRecord;

  beforeEach(async () => {
    // 1. Initialize in-memory test database and mock embedding provider
    memoryDb = new InMemoryDatabaseService();
    setDatabaseService(memoryDb);

    mockEmbedder = new MockEmbeddingProvider('mock-embed-768', 768);
    EmbeddingService.setProvider(mockEmbedder);

    app = createApp();

    // 2. Seed Users
    userA = await memoryDb.createUser({
      name: 'Alice Engineer',
      email: 'alice@example.com',
      passwordHash: 'hash_pw_1',
    });
    userB = await memoryDb.createUser({
      name: 'Bob Outsider',
      email: 'bob@example.com',
      passwordHash: 'hash_pw_2',
    });

    tokenUserA = generateAccessToken({ id: userA.id, email: userA.email, name: userA.name });
    tokenUserB = generateAccessToken({ id: userB.id, email: userB.email, name: userB.name });

    // 3. Seed Workspaces
    const wsA = await memoryDb.createWorkspace({
      name: 'Workspace Alpha',
      slug: 'ws-alpha',
      ownerId: userA.id,
    });
    workspaceA = wsA.workspace;

    const wsB = await memoryDb.createWorkspace({
      name: 'Workspace Beta',
      slug: 'ws-beta',
      ownerId: userB.id,
    });
    workspaceB = wsB.workspace;

    // 4. Seed Documents in Workspace A
    docCompletedA = await memoryDb.createDocument({
      workspaceId: workspaceA.id,
      uploadedById: userA.id,
      originalName: 'machine_learning.pdf',
      mimeType: 'application/pdf',
      extension: 'pdf',
      sizeBytes: BigInt(2048),
      checksum: 'sha256_doc_a1',
      storageKey: 'storage/doc_a1',
      status: 'COMPLETED',
    });

    docProcessingA = await memoryDb.createDocument({
      workspaceId: workspaceA.id,
      uploadedById: userA.id,
      originalName: 'in_progress_notes.txt',
      mimeType: 'text/plain',
      extension: 'txt',
      sizeBytes: BigInt(512),
      checksum: 'sha256_doc_a2',
      storageKey: 'storage/doc_a2',
      status: 'PROCESSING', // Not COMPLETED!
    });

    // 5. Seed Document in Workspace B (Tenancy Boundary Test)
    docCompletedB = await memoryDb.createDocument({
      workspaceId: workspaceB.id,
      uploadedById: userB.id,
      originalName: 'secret_beta_plans.pdf',
      mimeType: 'application/pdf',
      extension: 'pdf',
      sizeBytes: BigInt(1024),
      checksum: 'sha256_doc_b1',
      storageKey: 'storage/doc_b1',
      status: 'COMPLETED',
    });

    // 6. Seed Document Chunks
    const chunkA1Embed = await mockEmbedder.generateEmbedding(
      'Backpropagation is a widely used algorithm for training artificial neural networks and calculating gradients.',
    );
    const chunkA2Embed = await mockEmbedder.generateEmbedding(
      'Unsupervised learning deals with finding hidden patterns and cluster structures in unlabelled data.',
    );
    const chunkProcessingEmbed = await mockEmbedder.generateEmbedding(
      'This document is still being indexed and should not appear in search results.',
    );
    const chunkBEmbed = await mockEmbedder.generateEmbedding(
      'Confidential Workspace Beta corporate secrets and financial forecasts.',
    );

    await memoryDb.createDocumentChunks([
      {
        id: 'chk_a_1',
        documentId: docCompletedA.id,
        workspaceId: workspaceA.id,
        chunkIndex: 0,
        content:
          'Backpropagation is a widely used algorithm for training artificial neural networks and calculating gradients.',
        tokenCount: 20,
        pageStart: 3,
        pageEnd: 4,
        metadata: { heading: 'Backpropagation Fundamentals' },
        embedding: chunkA1Embed,
      },
      {
        id: 'chk_a_2',
        documentId: docCompletedA.id,
        workspaceId: workspaceA.id,
        chunkIndex: 1,
        content:
          'Unsupervised learning deals with finding hidden patterns and cluster structures in unlabelled data.',
        tokenCount: 18,
        pageStart: 7,
        pageEnd: 7,
        metadata: { heading: 'Clustering' },
        embedding: chunkA2Embed,
      },
    ]);

    await memoryDb.createDocumentChunks([
      {
        id: 'chk_processing',
        documentId: docProcessingA.id,
        workspaceId: workspaceA.id,
        chunkIndex: 0,
        content: 'This document is still being indexed and should not appear in search results.',
        tokenCount: 15,
        embedding: chunkProcessingEmbed,
      },
    ]);

    await memoryDb.createDocumentChunks([
      {
        id: 'chk_b_secret',
        documentId: docCompletedB.id,
        workspaceId: workspaceB.id,
        chunkIndex: 0,
        content: 'Confidential Workspace Beta corporate secrets and financial forecasts.',
        tokenCount: 12,
        embedding: chunkBEmbed,
      },
    ]);
  });

  describe('POST /api/retrieval/search — Retrieval Execution', () => {
    it('should perform hybrid search and return fused results with citations and context', async () => {
      const res = await request(app)
        .post('/api/retrieval/search')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .set('X-Workspace-ID', workspaceA.id)
        .send({
          query: 'Explain backpropagation and neural networks gradient calculation',
          mode: 'hybrid',
          topK: 5,
          includeContext: true,
          maxContextTokens: 2000,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.mode).toBe('hybrid');
      expect(res.body.data.results.length).toBeGreaterThan(0);

      // Verify top result is chk_a_1
      const topResult = res.body.data.results[0];
      expect(topResult.chunkId).toBe('chk_a_1');
      expect(topResult.citationId).toBe('[S1]');
      expect(topResult.documentName).toBe('machine_learning.pdf');
      expect(topResult.pageStart).toBe(3);
      expect(topResult.pageEnd).toBe(4);

      // Verify context block
      expect(res.body.data.context).toBeDefined();
      expect(res.body.data.context.content).toContain('--- SOURCE [S1]');
      expect(res.body.data.context.sources.length).toBeGreaterThan(0);

      // Verify telemetry metadata
      expect(res.body.data.metadata.semanticSearchUsed).toBe(true);
      expect(res.body.data.metadata.keywordSearchUsed).toBe(true);
      expect(res.body.data.metadata.timings.totalMs).toBeGreaterThanOrEqual(0);
    });

    it('should perform semantic-only retrieval', async () => {
      const res = await request(app)
        .post('/api/retrieval/search')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .set('X-Workspace-ID', workspaceA.id)
        .send({
          query: 'neural network algorithms',
          mode: 'semantic',
          topK: 3,
        });

      expect(res.status).toBe(200);
      expect(res.body.data.mode).toBe('semantic');
      expect(res.body.data.metadata.semanticSearchUsed).toBe(true);
      expect(res.body.data.metadata.keywordSearchUsed).toBe(false);
      expect(res.body.data.results[0].retrievalSources).toEqual(['semantic']);
    });

    it('should perform keyword-only retrieval', async () => {
      const res = await request(app)
        .post('/api/retrieval/search')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .set('X-Workspace-ID', workspaceA.id)
        .send({
          query: 'unlabelled clustering patterns',
          mode: 'keyword',
          topK: 3,
        });

      expect(res.status).toBe(200);
      expect(res.body.data.mode).toBe('keyword');
      expect(res.body.data.metadata.semanticSearchUsed).toBe(false);
      expect(res.body.data.metadata.keywordSearchUsed).toBe(true);
      expect(res.body.data.results[0].chunkId).toBe('chk_a_2');
      expect(res.body.data.results[0].retrievalSources).toEqual(['keyword']);
    });

    it('should omit context payload when includeContext is false', async () => {
      const res = await request(app)
        .post('/api/retrieval/search')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .set('X-Workspace-ID', workspaceA.id)
        .send({
          query: 'Backpropagation',
          includeContext: false,
        });

      expect(res.status).toBe(200);
      expect(res.body.data.context).toBeUndefined();
      expect(res.body.data.results.length).toBeGreaterThan(0);
    });

    it('should exclude chunks from documents that are not in COMPLETED status', async () => {
      const res = await request(app)
        .post('/api/retrieval/search')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .set('X-Workspace-ID', workspaceA.id)
        .send({
          query: 'document is still being indexed',
          mode: 'keyword',
        });

      expect(res.status).toBe(200);
      // Chk from docProcessingA must NOT appear in results
      const foundProcessing = res.body.data.results.some(
        (r: any) => r.chunkId === 'chk_processing',
      );
      expect(foundProcessing).toBe(false);
    });

    it('should apply metadata filters for documentIds', async () => {
      const res = await request(app)
        .post('/api/retrieval/search')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .set('X-Workspace-ID', workspaceA.id)
        .send({
          query: 'data patterns',
          filters: {
            documentIds: [docCompletedA.id],
          },
        });

      expect(res.status).toBe(200);
      for (const r of res.body.data.results) {
        expect(r.documentId).toBe(docCompletedA.id);
      }
    });

    it('should apply fileTypes filter', async () => {
      const res = await request(app)
        .post('/api/retrieval/search')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .set('X-Workspace-ID', workspaceA.id)
        .send({
          query: 'neural network',
          filters: {
            fileTypes: ['docx'], // docCompletedA is a pdf, so this should match 0 documents
          },
        });

      expect(res.status).toBe(200);
      expect(res.body.data.results.length).toBe(0);
    });

    it('should apply page range filter', async () => {
      const res = await request(app)
        .post('/api/retrieval/search')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .set('X-Workspace-ID', workspaceA.id)
        .send({
          query: 'learning',
          filters: {
            pageStart: 6, // chk_a_1 is pages 3-4, so it should be excluded; chk_a_2 is page 7
            pageEnd: 10,
          },
        });

      expect(res.status).toBe(200);
      const chunkIds = res.body.data.results.map((r: any) => r.chunkId);
      expect(chunkIds).toContain('chk_a_2');
      expect(chunkIds).not.toContain('chk_a_1');
    });

    it('should reject invalid queries with 400 Bad Request', async () => {
      // Empty query
      const res1 = await request(app)
        .post('/api/retrieval/search')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .set('X-Workspace-ID', workspaceA.id)
        .send({ query: '   ' });
      expect(res1.status).toBe(400);

      // Query too long (>1000 characters)
      const res2 = await request(app)
        .post('/api/retrieval/search')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .set('X-Workspace-ID', workspaceA.id)
        .send({ query: 'a'.repeat(1001) });
      expect(res2.status).toBe(400);

      // Invalid page range filter (pageStart > pageEnd)
      const res3 = await request(app)
        .post('/api/retrieval/search')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .set('X-Workspace-ID', workspaceA.id)
        .send({
          query: 'test query',
          filters: { pageStart: 10, pageEnd: 5 },
        });
      expect(res3.status).toBe(400);
    });
  });

  describe('Security & Multi-Tenant Isolation Tests', () => {
    it('CRITICAL: Workspace A cannot retrieve chunks belonging to Workspace B', async () => {
      const res = await request(app)
        .post('/api/retrieval/search')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .set('X-Workspace-ID', workspaceA.id)
        .send({
          query: 'Confidential Workspace Beta corporate secrets and financial forecasts',
          mode: 'hybrid',
        });

      expect(res.status).toBe(200);
      // Results MUST NOT contain chk_b_secret or any Workspace B chunks
      const leakedChunk = res.body.data.results.find((r: any) => r.chunkId === 'chk_b_secret');
      expect(leakedChunk).toBeUndefined();
      for (const r of res.body.data.results) {
        expect(r.documentId).not.toBe(docCompletedB.id);
      }
    });

    it('CRITICAL: Supplying Workspace B document ID in filters while querying Workspace A returns 0 results (IDOR defense)', async () => {
      const res = await request(app)
        .post('/api/retrieval/search')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .set('X-Workspace-ID', workspaceA.id)
        .send({
          query: 'corporate secrets',
          filters: {
            documentIds: [docCompletedB.id], // Attacker tries to filter by foreign document ID
          },
        });

      expect(res.status).toBe(200);
      expect(res.body.data.results.length).toBe(0);
    });

    it('should deny unauthenticated requests with 401 Unauthorized', async () => {
      const res = await request(app)
        .post('/api/retrieval/search')
        .set('X-Workspace-ID', workspaceA.id)
        .send({ query: 'neural networks' });

      expect(res.status).toBe(401);
    });

    it('should deny search in workspace where user is not a member with 403 Forbidden', async () => {
      // User B is not a member of Workspace A
      const res = await request(app)
        .post('/api/retrieval/search')
        .set('Authorization', `Bearer ${tokenUserB}`)
        .set('X-Workspace-ID', workspaceA.id)
        .send({ query: 'neural networks' });

      expect(res.status).toBe(403);
    });

    it('should safely handle SQL injection payloads as literal string input without errors', async () => {
      const sqliPayload = '\'; DROP TABLE "document_chunks"; -- \' OR 1=1';
      const res = await request(app)
        .post('/api/retrieval/search')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .set('X-Workspace-ID', workspaceA.id)
        .send({ query: sqliPayload });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      // Table and data must remain intact
      expect(memoryDb.chunks.size).toBeGreaterThan(0);
    });
  });
});
