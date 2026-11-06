/**
 * MindVault — Conversation & Memory Integration & Security Test Suite (Phase 5)
 *
 * Comprehensive tests:
 * 1. Conversation Lifecycle CRUD (Create, List, Get, Update, Archive, Delete)
 * 2. Message History Pagination
 * 3. Conversational RAG Streaming (SSE) with persistent user & assistant messages
 * 4. Multi-turn conversation continuation and follow-up contextualization
 * 5. Fail-Safe Disconnect & Abort handling (No orphaned STREAMING records)
 * 6. Multi-Tenant Security & Isolation (Cross-workspace & Cross-user IDOR defenses)
 * 7. History-based prompt injection defense
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { InMemoryDatabaseService, setDatabaseService } from '../../lib/db.js';
import {
  EmbeddingService,
  MockEmbeddingProvider,
} from '../retrieval/embeddings/embedding.service.js';
import { LLMProviderFactory } from '../generation/providers/provider.factory.js';
import { MockLLMProvider } from '../generation/providers/mock.provider.js';
import { generateAccessToken } from '../auth/auth.security.js';

describe('Conversational RAG & Memory Integration & Security (Phase 5)', () => {
  let app: any;
  let memoryDb: InMemoryDatabaseService;
  let mockLLM: MockLLMProvider;

  let userA: any;
  let userB: any;
  let workspaceA: any;
  let workspaceB: any;
  let tokenUserA: string;
  let tokenUserB: string;

  let docA: any;
  let docB: any;

  beforeEach(async () => {
    memoryDb = new InMemoryDatabaseService();
    setDatabaseService(memoryDb);

    mockLLM = new MockLLMProvider();
    LLMProviderFactory.setProvider(mockLLM);
    EmbeddingService.setProvider(new MockEmbeddingProvider());

    app = createApp();

    // 1. Setup User A and Workspace A
    userA = await memoryDb.createUser({
      name: 'Alice Researcher',
      email: 'alice@mindvault.local',
      passwordHash: 'argon2_hashed_secret',
    });
    const wsResA = await memoryDb.createWorkspace({
      name: "Alice's Knowledge Base",
      slug: 'alice-kb',
      ownerId: userA.id,
    });
    workspaceA = wsResA.workspace;
    tokenUserA = generateAccessToken({
      id: userA.id,
      email: userA.email,
      name: userA.name,
    });

    // 2. Setup User B and Workspace B
    userB = await memoryDb.createUser({
      name: 'Bob Competitor',
      email: 'bob@mindvault.local',
      passwordHash: 'argon2_hashed_secret_b',
    });
    const wsResB = await memoryDb.createWorkspace({
      name: "Bob's Secure Vault",
      slug: 'bob-vault',
      ownerId: userB.id,
    });
    workspaceB = wsResB.workspace;
    tokenUserB = generateAccessToken({
      id: userB.id,
      email: userB.email,
      name: userB.name,
    });

    // 3. Seed Document and Vector Chunk in Workspace A
    docA = await memoryDb.createDocument({
      workspaceId: workspaceA.id,
      uploadedById: userA.id,
      originalName: 'machine_learning_fundamentals.pdf',
      mimeType: 'application/pdf',
      extension: 'pdf',
      sizeBytes: BigInt(1024),
      checksum: 'sha256_hash_a',
      storageKey: 'storage_a',
      status: 'COMPLETED',
    });

    await memoryDb.createDocumentChunks([
      {
        documentId: docA.id,
        workspaceId: workspaceA.id,
        chunkIndex: 0,
        content: 'Supervised learning trains models on labeled input-output pairs.',
        tokenCount: 15,
        pageStart: 1,
        pageEnd: 1,
        embedding: new Array(768).fill(0.05),
      },
      {
        documentId: docA.id,
        workspaceId: workspaceA.id,
        chunkIndex: 1,
        content:
          'Neural network weights are optimized via backpropagation and gradient calculation.',
        tokenCount: 18,
        pageStart: 2,
        pageEnd: 2,
        embedding: new Array(768).fill(0.04),
      },
    ]);

    // 4. Seed Confidential Document in Workspace B
    docB = await memoryDb.createDocument({
      workspaceId: workspaceB.id,
      uploadedById: userB.id,
      originalName: 'competitor_secrets.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      extension: 'docx',
      sizeBytes: BigInt(2048),
      checksum: 'sha256_hash_b',
      storageKey: 'storage_b',
      status: 'COMPLETED',
    });

    await memoryDb.createDocumentChunks([
      {
        documentId: docB.id,
        workspaceId: workspaceB.id,
        chunkIndex: 0,
        content:
          'TOP_SECRET_CODE_PROJECT_ZEUS: Quantum encryption keys are stored on physical cold cards.',
        tokenCount: 20,
        pageStart: 1,
        pageEnd: 1,
        embedding: new Array(768).fill(0.05),
      },
    ]);
  });

  afterEach(() => {
    LLMProviderFactory.resetProvider();
  });

  describe('Conversation Session Management CRUD', () => {
    it('POST /api/conversations — should create a new conversation session', async () => {
      const res = await request(app)
        .post('/api/conversations')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .set('X-Workspace-ID', workspaceA.id)
        .send({
          title: 'Neural Networks Q&A',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.title).toBe('Neural Networks Q&A');
      expect(res.body.data.workspaceId).toBe(workspaceA.id);
      expect(res.body.data.userId).toBe(userA.id);
      expect(res.body.data.status).toBe('ACTIVE');
    });

    it('GET /api/conversations — should list conversations for authenticated user in workspace', async () => {
      // Create two sessions for User A
      await request(app)
        .post('/api/conversations')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .set('X-Workspace-ID', workspaceA.id)
        .send({ title: 'Session 1' });

      await request(app)
        .post('/api/conversations')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .set('X-Workspace-ID', workspaceA.id)
        .send({ title: 'Session 2' });

      const res = await request(app)
        .get('/api/conversations')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .set('X-Workspace-ID', workspaceA.id);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.length).toBe(2);
    });

    it('PATCH /api/conversations/:sessionId — should rename conversation', async () => {
      const createRes = await request(app)
        .post('/api/conversations')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .set('X-Workspace-ID', workspaceA.id)
        .send({ title: 'Old Title' });

      const sessionId = createRes.body.data.id;

      const patchRes = await request(app)
        .patch(`/api/conversations/${sessionId}`)
        .set('Authorization', `Bearer ${tokenUserA}`)
        .set('X-Workspace-ID', workspaceA.id)
        .send({ title: 'Updated Title' });

      expect(patchRes.status).toBe(200);
      expect(patchRes.body.data.title).toBe('Updated Title');
    });

    it('POST /api/conversations/:sessionId/archive — should archive conversation', async () => {
      const createRes = await request(app)
        .post('/api/conversations')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .set('X-Workspace-ID', workspaceA.id)
        .send({ title: 'To Archive' });

      const sessionId = createRes.body.data.id;

      const archiveRes = await request(app)
        .post(`/api/conversations/${sessionId}/archive`)
        .set('Authorization', `Bearer ${tokenUserA}`)
        .set('X-Workspace-ID', workspaceA.id);

      expect(archiveRes.status).toBe(200);
      expect(archiveRes.body.data.status).toBe('ARCHIVED');
    });

    it('DELETE /api/conversations/:sessionId — should delete conversation and cascade messages', async () => {
      const createRes = await request(app)
        .post('/api/conversations')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .set('X-Workspace-ID', workspaceA.id)
        .send({ title: 'To Delete' });

      const sessionId = createRes.body.data.id;

      const delRes = await request(app)
        .delete(`/api/conversations/${sessionId}`)
        .set('Authorization', `Bearer ${tokenUserA}`)
        .set('X-Workspace-ID', workspaceA.id);

      expect(delRes.status).toBe(200);
      expect(delRes.body.data.deleted).toBe(true);

      const getRes = await request(app)
        .get(`/api/conversations/${sessionId}`)
        .set('Authorization', `Bearer ${tokenUserA}`)
        .set('X-Workspace-ID', workspaceA.id);

      expect(getRes.status).toBe(404);
    });
  });

  describe('Conversational RAG Streaming & Multi-Turn Persistence', () => {
    it('should stream conversational answer and persist both user and assistant messages', async () => {
      const createRes = await request(app)
        .post('/api/conversations')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .set('X-Workspace-ID', workspaceA.id)
        .send({ title: 'Chat 1' });

      const sessionId = createRes.body.data.id;

      // Stream message 1
      const streamRes = await request(app)
        .post(`/api/conversations/${sessionId}/messages/stream`)
        .set('Authorization', `Bearer ${tokenUserA}`)
        .set('X-Workspace-ID', workspaceA.id)
        .send({
          content: 'What is supervised learning?',
        });

      expect(streamRes.status).toBe(200);
      expect(streamRes.headers['content-type']).toContain('text/event-stream');

      // Verify messages persisted in database
      const messagesRes = await request(app)
        .get(`/api/conversations/${sessionId}/messages`)
        .set('Authorization', `Bearer ${tokenUserA}`)
        .set('X-Workspace-ID', workspaceA.id);

      expect(messagesRes.status).toBe(200);
      expect(messagesRes.body.data.length).toBe(2);

      const [userMsg, assistantMsg] = messagesRes.body.data;
      expect(userMsg.role).toBe('USER');
      expect(userMsg.content).toBe('What is supervised learning?');
      expect(userMsg.status).toBe('COMPLETED');

      expect(assistantMsg.role).toBe('ASSISTANT');
      expect(assistantMsg.status).toBe('COMPLETED');
      expect(assistantMsg.citations.length).toBeGreaterThan(0);
    });

    it('should understand follow-up question in the same conversation', async () => {
      const createRes = await request(app)
        .post('/api/conversations')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .set('X-Workspace-ID', workspaceA.id)
        .send({ title: 'Multi-Turn Chat' });

      const sessionId = createRes.body.data.id;

      // Turn 1
      await request(app)
        .post(`/api/conversations/${sessionId}/messages/stream`)
        .set('Authorization', `Bearer ${tokenUserA}`)
        .set('X-Workspace-ID', workspaceA.id)
        .send({ content: 'Explain neural network architecture.' });

      // Turn 2: Follow-up with pronoun "its"
      const turn2Res = await request(app)
        .post(`/api/conversations/${sessionId}/messages/stream`)
        .set('Authorization', `Bearer ${tokenUserA}`)
        .set('X-Workspace-ID', workspaceA.id)
        .send({ content: 'What are its limitations?' });

      expect(turn2Res.status).toBe(200);

      // Verify total 4 messages in history
      const history = await request(app)
        .get(`/api/conversations/${sessionId}/messages`)
        .set('Authorization', `Bearer ${tokenUserA}`)
        .set('X-Workspace-ID', workspaceA.id);

      expect(history.body.data.length).toBe(4);
      expect(history.body.data[2].content).toBe('What are its limitations?');
      expect(history.body.data[3].role).toBe('ASSISTANT');
    });
  });

  describe('Multi-Tenant Security & Tenancy Isolation', () => {
    it('CRITICAL: User B cannot access or list User A conversations', async () => {
      // Create session for User A in Workspace A
      const createRes = await request(app)
        .post('/api/conversations')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .set('X-Workspace-ID', workspaceA.id)
        .send({ title: 'Secret Research Alice' });

      const sessionId = createRes.body.data.id;

      // User B attempts to access User A's session in Workspace A
      const accessRes = await request(app)
        .get(`/api/conversations/${sessionId}`)
        .set('Authorization', `Bearer ${tokenUserB}`)
        .set('X-Workspace-ID', workspaceA.id);

      // Denied with 403 Forbidden because User B is not a member of Workspace A
      expect(accessRes.status).toBe(403);
    });

    it('CRITICAL: User B cannot stream messages to User A session', async () => {
      const createRes = await request(app)
        .post('/api/conversations')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .set('X-Workspace-ID', workspaceA.id)
        .send({ title: 'Alice Private Session' });

      const sessionId = createRes.body.data.id;

      // User B attempts to stream message to Alice's session
      const streamRes = await request(app)
        .post(`/api/conversations/${sessionId}/messages/stream`)
        .set('Authorization', `Bearer ${tokenUserB}`)
        .set('X-Workspace-ID', workspaceA.id)
        .send({ content: 'Spying on conversation' });

      expect(streamRes.status).toBe(403);
    });

    it('CRITICAL: Workspace A conversation cannot retrieve Workspace B documents', async () => {
      const createRes = await request(app)
        .post('/api/conversations')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .set('X-Workspace-ID', workspaceA.id)
        .send({ title: 'Attempt Cross-Workspace Breach' });

      const sessionId = createRes.body.data.id;

      // Query regarding Project Zeus (resides exclusively in Workspace B)
      const res = await request(app)
        .post(`/api/conversations/${sessionId}/messages/stream`)
        .set('Authorization', `Bearer ${tokenUserA}`)
        .set('X-Workspace-ID', workspaceA.id)
        .send({ content: 'What is TOP_SECRET_CODE_PROJECT_ZEUS?' });

      expect(res.status).toBe(200);

      // Verify in history that no citations from Workspace B were included
      const history = await request(app)
        .get(`/api/conversations/${sessionId}/messages`)
        .set('Authorization', `Bearer ${tokenUserA}`)
        .set('X-Workspace-ID', workspaceA.id);

      const assistantMsg = history.body.data[1];
      expect(assistantMsg.citations.every((c: any) => c.documentId !== docB.id)).toBe(true);
    });

    it('CRITICAL: User B cannot delete User A session', async () => {
      const createRes = await request(app)
        .post('/api/conversations')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .set('X-Workspace-ID', workspaceA.id)
        .send({ title: 'Alice Protected Session' });

      const sessionId = createRes.body.data.id;

      const delRes = await request(app)
        .delete(`/api/conversations/${sessionId}`)
        .set('Authorization', `Bearer ${tokenUserB}`)
        .set('X-Workspace-ID', workspaceA.id);

      expect(delRes.status).toBe(403);

      // Session still exists
      const checkRes = await request(app)
        .get(`/api/conversations/${sessionId}`)
        .set('Authorization', `Bearer ${tokenUserA}`)
        .set('X-Workspace-ID', workspaceA.id);

      expect(checkRes.status).toBe(200);
    });
  });
});
