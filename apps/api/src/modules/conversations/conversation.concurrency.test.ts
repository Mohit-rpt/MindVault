/**
 * MindVault — Conversation Concurrency, OCC & Recovery Integration Tests (Phase 5)
 *
 * Verifies:
 * 1. Concurrent Message Creation: Serialized atomic sequence allocation prevents duplicates
 * 2. Concurrent Stream Requests: Multi-turn concurrent requests allocate distinct sequences
 * 3. Optimistic Concurrency Control for Summaries: Discards stale summary writes
 * 4. Startup Reconciliation: Recovers orphaned STREAMING and PENDING messages to FAILED
 * 5. Pre-flight Streaming Authorization: Rejects non-existent or cross-tenant sessions before SSE headers
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { InMemoryDatabaseService, setDatabaseService } from '../../lib/db.js';
import { ConversationRepository } from './repositories/conversation.repository.js';
import { ConversationSummaryService } from './services/summary.service.js';
import {
  EmbeddingService,
  MockEmbeddingProvider,
} from '../retrieval/embeddings/embedding.service.js';
import { LLMProviderFactory } from '../generation/providers/provider.factory.js';
import { MockLLMProvider } from '../generation/providers/mock.provider.js';
import { generateAccessToken } from '../auth/auth.security.js';

describe('Conversational Memory Concurrency & Reliability Suite', () => {
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

  beforeEach(async () => {
    memoryDb = new InMemoryDatabaseService();
    setDatabaseService(memoryDb);

    mockLLM = new MockLLMProvider();
    LLMProviderFactory.setProvider(mockLLM);
    EmbeddingService.setProvider(new MockEmbeddingProvider());

    app = createApp();

    // Setup User A & Workspace A
    userA = await memoryDb.createUser({
      name: 'Alice Researcher',
      email: 'alice.concurrency@mindvault.local',
      passwordHash: 'hashed_pw_alice',
    });
    const wsResA = await memoryDb.createWorkspace({
      name: "Alice's Concurrent Vault",
      slug: 'alice-vault',
      ownerId: userA.id,
    });
    workspaceA = wsResA.workspace;
    tokenUserA = generateAccessToken({
      id: userA.id,
      email: userA.email,
      name: userA.name,
    });

    // Setup User B & Workspace B
    userB = await memoryDb.createUser({
      name: 'Bob Competitor',
      email: 'bob.concurrency@mindvault.local',
      passwordHash: 'hashed_pw_bob',
    });
    const wsResB = await memoryDb.createWorkspace({
      name: "Bob's Concurrent Vault",
      slug: 'bob-vault',
      ownerId: userB.id,
    });
    workspaceB = wsResB.workspace;
    tokenUserB = generateAccessToken({
      id: userB.id,
      email: userB.email,
      name: userB.name,
    });

    // Seed document in Workspace A
    docA = await memoryDb.createDocument({
      workspaceId: workspaceA.id,
      uploadedById: userA.id,
      originalName: 'concurrency_guide.pdf',
      mimeType: 'application/pdf',
      extension: 'pdf',
      sizeBytes: BigInt(2048),
      checksum: 'sha256_concurrency_doc',
      storageKey: 'storage_concurrency',
      status: 'COMPLETED',
    });

    await memoryDb.createDocumentChunks([
      {
        documentId: docA.id,
        workspaceId: workspaceA.id,
        chunkIndex: 0,
        content:
          'Concurrency in database systems requires isolation and atomic sequence generators.',
        tokenCount: 15,
        pageStart: 1,
        pageEnd: 1,
        embedding: new Array(768).fill(0.05),
      },
    ]);
  });

  afterEach(() => {
    LLMProviderFactory.resetProvider();
  });

  describe('1. Sequence Allocation & Lock Serialization under Concurrency', () => {
    it('should allocate strictly unique and monotonic sequence numbers when messages are created in parallel', async () => {
      const session = await ConversationRepository.createSession(
        workspaceA.id,
        userA.id,
        'Concurrent Insertion Test',
      );

      // Launch 8 parallel message creations
      const messagePayloads = Array.from({ length: 8 }, (_, i) => ({
        sessionId: session.id,
        workspaceId: workspaceA.id,
        role: (i % 2 === 0 ? 'USER' : 'ASSISTANT') as 'USER' | 'ASSISTANT',
        content: `Concurrent message payload index ${i}`,
        tokenEstimate: 10,
      }));

      const createdMessages = await Promise.all(
        messagePayloads.map((payload) => ConversationRepository.createMessage(payload)),
      );

      expect(createdMessages.length).toBe(8);

      const allocatedSequences = createdMessages.map((m) => m.sequenceNumber);
      const uniqueSequences = new Set(allocatedSequences);

      // Verify no duplicates
      expect(uniqueSequences.size).toBe(8);

      // Verify sequence starts at 1 and is gapless 1..8
      const sorted = [...allocatedSequences].sort((a, b) => a - b);
      expect(sorted).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);

      // Verify session messageCount is 8
      const updatedSession = await ConversationRepository.findSessionById(
        session.id,
        workspaceA.id,
      );
      expect(updatedSession?.messageCount).toBe(8);
    });
  });

  describe('2. Concurrent Stream Requests via API', () => {
    it('should safely process concurrent stream requests with unique sequence allocations', async () => {
      const createRes = await request(app)
        .post('/api/conversations')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .set('X-Workspace-ID', workspaceA.id)
        .send({ title: 'Parallel Stream Test' });

      const sessionId = createRes.body.data.id;

      // Send 3 concurrent streaming requests
      const streamRequests = [
        request(app)
          .post(`/api/conversations/${sessionId}/messages/stream`)
          .set('Authorization', `Bearer ${tokenUserA}`)
          .set('X-Workspace-ID', workspaceA.id)
          .send({ content: 'What is database concurrency?' }),
        request(app)
          .post(`/api/conversations/${sessionId}/messages/stream`)
          .set('Authorization', `Bearer ${tokenUserA}`)
          .set('X-Workspace-ID', workspaceA.id)
          .send({ content: 'Explain isolation levels.' }),
      ];

      const responses = await Promise.all(streamRequests);
      for (const res of responses) {
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toContain('text/event-stream');
      }

      // Check all messages in the session
      const history = await request(app)
        .get(`/api/conversations/${sessionId}/messages`)
        .set('Authorization', `Bearer ${tokenUserA}`)
        .set('X-Workspace-ID', workspaceA.id);

      expect(history.status).toBe(200);
      expect(history.body.data.length).toBe(4); // 2 users + 2 assistants

      const sequences = history.body.data.map((m: any) => m.sequenceNumber);
      const uniqueSequences = new Set(sequences);
      expect(uniqueSequences.size).toBe(4);
      expect(sequences.sort((a: number, b: number) => a - b)).toEqual([1, 2, 3, 4]);
    });
  });

  describe('3. Summary Optimistic Concurrency Control (OCC)', () => {
    it('should reject a stale summary update when session summaryVersion has already advanced', async () => {
      const session = await ConversationRepository.createSession(
        workspaceA.id,
        userA.id,
        'Summary OCC Test',
      );

      // Seed 6 completed messages
      for (let i = 1; i <= 6; i++) {
        await ConversationRepository.createMessage({
          sessionId: session.id,
          workspaceId: workspaceA.id,
          role: i % 2 === 1 ? 'USER' : 'ASSISTANT',
          content: `Discussion message point ${i}`,
          status: 'COMPLETED',
          tokenEstimate: 10,
        });
      }

      // Simulate first summary job (v1, summarizing through sequence 6)
      const freshSession = await ConversationRepository.findSessionById(session.id, workspaceA.id);
      expect(freshSession).not.toBeNull();

      const updatedSummaryV1 = await ConversationSummaryService.generateAndUpdateSummary(
        freshSession!,
        workspaceA.id,
      );
      expect(updatedSummaryV1).not.toBeNull();

      const sessionAfterV1 = await ConversationRepository.findSessionById(
        session.id,
        workspaceA.id,
      );
      expect(sessionAfterV1?.summaryVersion).toBe(1);
      expect(sessionAfterV1?.summarizedThroughSeq).toBe(6);

      // Advance session to v2 directly (simulating a concurrent newer summary job that completed)
      await ConversationRepository.updateSession(session.id, workspaceA.id, {
        summary: 'NEWEST_V2_SUMMARY',
        summaryVersion: 2,
        summarizedThroughSeq: 6,
      });

      // Now invoke a stale job passing the original session snapshot (which had summaryVersion 0 or 1)
      const staleResult = await ConversationSummaryService.generateAndUpdateSummary(
        freshSession!, // has summaryVersion: 0
        workspaceA.id,
      );

      // Verify that the stale write was discarded and the newest summary remains
      expect(staleResult).toBe('NEWEST_V2_SUMMARY');

      const verifiedSession = await ConversationRepository.findSessionById(
        session.id,
        workspaceA.id,
      );
      expect(verifiedSession?.summary).toBe('NEWEST_V2_SUMMARY');
      expect(verifiedSession?.summaryVersion).toBe(2);
    });
  });

  describe('4. Startup Reconciliation of Orphaned Messages', () => {
    it('should reconcile STREAMING and PENDING messages to FAILED on server restart', async () => {
      const session = await ConversationRepository.createSession(
        workspaceA.id,
        userA.id,
        'Orphaned Stream Session',
      );

      // User message
      await ConversationRepository.createMessage({
        sessionId: session.id,
        workspaceId: workspaceA.id,
        role: 'USER',
        content: 'Streaming query that crashed mid-way',
        status: 'COMPLETED',
        tokenEstimate: 5,
      });

      // Assistant message orphaned in STREAMING state
      const orphanedStreaming = await ConversationRepository.createMessage({
        sessionId: session.id,
        workspaceId: workspaceA.id,
        role: 'ASSISTANT',
        content: 'Incomplete partial text...',
        status: 'STREAMING',
        tokenEstimate: 3,
      });

      // Another message orphaned in PENDING state
      const orphanedPending = await ConversationRepository.createMessage({
        sessionId: session.id,
        workspaceId: workspaceA.id,
        role: 'ASSISTANT',
        content: '',
        status: 'PENDING',
        tokenEstimate: 0,
      });

      // Run server startup reconciliation
      const count = await memoryDb.reconcileOrphanedMessages();
      expect(count).toBe(2);

      // Verify messages transitioned to FAILED
      const messages = await ConversationRepository.listMessages(session.id, workspaceA.id);
      const streamingMsg = messages.find((m) => m.id === orphanedStreaming.id);
      const pendingMsg = messages.find((m) => m.id === orphanedPending.id);

      expect(streamingMsg?.status).toBe('FAILED');
      expect((streamingMsg?.metadata as any)?.error).toContain('orphaned');

      expect(pendingMsg?.status).toBe('FAILED');
      expect((pendingMsg?.metadata as any)?.error).toContain('orphaned');
    });
  });

  describe('5. Pre-Flight Streaming Authorization Checks', () => {
    it('should return HTTP 404 JSON (not SSE headers) for non-existent session', async () => {
      const res = await request(app)
        .post('/api/conversations/non_existent_session_id/messages/stream')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .set('X-Workspace-ID', workspaceA.id)
        .send({ content: 'Hello into the void' });

      expect(res.status).toBe(404);
      expect(res.headers['content-type']).toContain('application/json');
      expect(res.headers['content-type']).not.toContain('text/event-stream');
      expect(res.body.success).toBe(false);
    });

    it('should return HTTP 403 JSON (not SSE headers) when User B attempts to stream to User A session in Workspace A', async () => {
      const createRes = await request(app)
        .post('/api/conversations')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .set('X-Workspace-ID', workspaceA.id)
        .send({ title: 'Alice Protected Session' });

      const sessionId = createRes.body.data.id;

      // User B attempts to connect stream to Alice's session
      const streamRes = await request(app)
        .post(`/api/conversations/${sessionId}/messages/stream`)
        .set('Authorization', `Bearer ${tokenUserB}`)
        .set('X-Workspace-ID', workspaceA.id)
        .send({ content: 'Unauthorized intrusion attempt' });

      expect(streamRes.status).toBe(403);
      expect(streamRes.headers['content-type']).toContain('application/json');
      expect(streamRes.headers['content-type']).not.toContain('text/event-stream');
      expect(streamRes.body.success).toBe(false);
    });
  });
});
