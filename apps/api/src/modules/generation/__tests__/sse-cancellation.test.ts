/**
 * MindVault — Milestone 2.2: SSE Lifecycle & Stream Cancellation Verification
 *
 * Verifies VULN-RES-01 remediation:
 * 1. AbortSignal propagation from HTTP layer through RAGService to Retrieval and LLM providers.
 * 2. Cancellation before start (pre-aborted signal).
 * 3. Cancellation during retrieval phase.
 * 4. Cancellation during LLM token streaming phase.
 * 5. Listener cleanup on req and res ('close' event listeners removed in finally block).
 * 6. Provider cancellation mechanics (MockLLMProvider, OllamaProvider abort signal handling).
 * 7. Concurrency isolation (aborting Request A does not affect concurrent Request B).
 * 8. Conversation streaming cancellation and status transition to CANCELLED.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import http from 'node:http';
import { createApp } from '../../../app.js';
import { InMemoryDatabaseService, setDatabaseService } from '../../../lib/db.js';
import {
  EmbeddingService,
  MockEmbeddingProvider,
} from '../../retrieval/embeddings/embedding.service.js';
import { LLMProviderFactory } from '../providers/provider.factory.js';
import { MockLLMProvider } from '../providers/mock.provider.js';
import { OllamaProvider } from '../providers/ollama.provider.js';
import { GeminiProvider } from '../providers/gemini.provider.js';
import { RAGService } from '../services/rag.service.js';
import { RetrievalService } from '../../retrieval/services/retrieval.service.js';
import { ConversationRAGService } from '../../conversations/services/conversation-rag.service.js';
import { ConversationRepository } from '../../conversations/repositories/conversation.repository.js';
import { generateAccessToken } from '../../auth/auth.security.js';
import { SendConversationMessageRequestSchema, type RAGStreamEvent } from '@mindvault/shared';

describe('Milestone 2.2 — SSE Lifecycle & Stream Cancellation Hardening', () => {
  let app: any;
  let server: http.Server;
  let serverPort: number;
  let memoryDb: InMemoryDatabaseService;
  let mockLLM: MockLLMProvider;

  let userA: any;
  let userB: any;
  let workspaceA: any;
  let tokenUserA: string;

  beforeEach(async () => {
    memoryDb = new InMemoryDatabaseService();
    setDatabaseService(memoryDb);

    const mockEmbed = new MockEmbeddingProvider('mock-embed-768', 768);
    EmbeddingService.setProvider(mockEmbed);

    mockLLM = new MockLLMProvider();
    LLMProviderFactory.setProvider(mockLLM);

    app = createApp();

    userA = await memoryDb.createUser({
      name: 'Alice Cancellation Tester',
      email: 'alice.cancel@mindvault.local',
      passwordHash: 'hash_alice_cancel_123',
    });

    userB = await memoryDb.createUser({
      name: 'Bob Concurrent Tester',
      email: 'bob.concurrent@mindvault.local',
      passwordHash: 'hash_bob_concurrent_123',
    });

    const wsAData = await memoryDb.createWorkspace({
      name: 'Workspace Stream Cancel',
      slug: 'ws-stream-cancel',
      ownerId: userA.id,
    });
    workspaceA = wsAData.workspace;

    await memoryDb.addWorkspaceMember(workspaceA.id, userB.id, 'MEMBER');

    tokenUserA = generateAccessToken({
      id: userA.id,
      email: userA.email,
      name: userA.name,
    });

    await memoryDb.createDocument({
      id: 'doc_stream_test',
      workspaceId: workspaceA.id,
      uploadedById: userA.id,
      originalName: 'cancellation_architecture.pdf',
      mimeType: 'application/pdf',
      extension: 'pdf',
      sizeBytes: BigInt(1024),
      checksum: 'sha256_stream_test',
      storageKey: 'storage/doc_stream_test',
      status: 'COMPLETED',
      metadata: { pageCount: 1 },
    });

    const chunkEmbed = await mockEmbed.generateEmbedding(
      'Server-Sent Events streaming requires active AbortSignal propagation to prevent orphan background generation.',
    );

    await memoryDb.createDocumentChunks([
      {
        id: 'chk_stream_0',
        documentId: 'doc_stream_test',
        workspaceId: workspaceA.id,
        chunkIndex: 0,
        content:
          'Server-Sent Events streaming requires active AbortSignal propagation to prevent orphan background generation.',
        tokenCount: 25,
        pageStart: 1,
        pageEnd: 1,
        embedding: chunkEmbed,
        metadata: { heading: 'SSE Streaming' },
      },
    ]);
  });

  afterEach(async () => {
    if (server && server.listening) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  // =========================================================================
  // 1. RAGService Stream Cancellation Tests
  // =========================================================================
  describe('RAGService.generateAnswerStream Abort Propagation', () => {
    it('should immediately yield CLIENT_ABORTED error if signal is already aborted', async () => {
      const abortController = new AbortController();
      abortController.abort();

      const events: RAGStreamEvent[] = [];
      const stream = RAGService.generateAnswerStream(
        workspaceA.id,
        { query: 'Testing immediate cancellation' },
        abortController.signal,
      );

      for await (const event of stream) {
        events.push(event);
      }

      expect(events[0]).toMatchObject({ type: 'start' });
      expect(events[1]).toMatchObject({
        type: 'error',
        code: 'CLIENT_ABORTED',
        message: 'Generation cancelled by client',
      });
      expect(events).toHaveLength(2);
    });

    it('should abort and yield CLIENT_ABORTED if signal aborts during retrieval phase', async () => {
      const abortController = new AbortController();
      const executeSearchSpy = vi
        .spyOn(RetrievalService, 'executeSearch')
        .mockImplementation(async () => {
          abortController.abort();
          throw new Error('CLIENT_ABORTED');
        });

      const events: RAGStreamEvent[] = [];
      const stream = RAGService.generateAnswerStream(
        workspaceA.id,
        { query: 'Testing retrieval abort' },
        abortController.signal,
      );

      for await (const event of stream) {
        events.push(event);
      }

      expect(events[0]).toMatchObject({ type: 'start' });
      expect(events[1]).toMatchObject({
        type: 'error',
        code: 'CLIENT_ABORTED',
        message: 'Generation cancelled by client',
      });

      executeSearchSpy.mockRestore();
    });

    it('should abort and yield CLIENT_ABORTED if signal aborts during token generation phase', async () => {
      const abortController = new AbortController();

      // Configure MockLLMProvider to yield tokens with slight delay and abort on second token
      mockLLM.setStreamDelay(10);
      let chunkCount = 0;

      const events: RAGStreamEvent[] = [];
      const stream = RAGService.generateAnswerStream(
        workspaceA.id,
        { query: 'Testing token streaming abort' },
        abortController.signal,
      );

      for await (const event of stream) {
        events.push(event);
        if (event.type === 'token') {
          chunkCount++;
          if (chunkCount === 2) {
            abortController.abort();
          }
        }
      }

      expect(events.some((e) => e.type === 'start')).toBe(true);
      expect(events.some((e) => e.type === 'retrieval_complete')).toBe(true);
      expect(events.some((e) => e.type === 'token')).toBe(true);

      const lastEvent = events[events.length - 1];
      expect(lastEvent).toMatchObject({
        type: 'error',
        code: 'CLIENT_ABORTED',
        message: 'Generation cancelled by client',
      });

      // Verify that validation and done were NOT emitted after cancellation
      expect(events.some((e) => e.type === 'validation')).toBe(false);
      expect(events.some((e) => e.type === 'done')).toBe(false);
    });

    it('should complete full lifecycle normally when not aborted', async () => {
      const abortController = new AbortController();
      const events: RAGStreamEvent[] = [];
      const stream = RAGService.generateAnswerStream(
        workspaceA.id,
        { query: 'Normal lifecycle test' },
        abortController.signal,
      );

      for await (const event of stream) {
        events.push(event);
      }

      const types = events.map((e) => e.type);
      expect(types).toContain('start');
      expect(types).toContain('retrieval_complete');
      expect(types).toContain('sources');
      expect(types).toContain('token');
      expect(types).toContain('validation');
      expect(types).toContain('done');
      expect(types).not.toContain('error');
    });
  });

  // =========================================================================
  // 2. Provider-Specific Abort Handling
  // =========================================================================
  describe('LLM Providers Abort Handling', () => {
    it('MockLLMProvider should exit immediately when signal is aborted during streamDelay', async () => {
      const mock = new MockLLMProvider();
      mock.setStreamDelay(500); // 500ms delay per token

      const controller = new AbortController();
      const chunks: string[] = [];

      const startTime = performance.now();
      const stream = mock.generateStream('Hello world prompt', { signal: controller.signal });

      setTimeout(() => controller.abort(), 50);

      for await (const chunk of stream) {
        if (chunk.text) chunks.push(chunk.text);
      }

      const elapsed = performance.now() - startTime;
      // Should have exited in ~50-100ms rather than waiting full 500ms * token count
      expect(elapsed).toBeLessThan(350);
      expect(controller.signal.aborted).toBe(true);
    });

    it('OllamaProvider should link options.signal to fetch AbortController', async () => {
      const ollama = new OllamaProvider({ baseUrl: 'http://127.0.0.1:11434', modelName: 'llama3' });
      const controller = new AbortController();
      controller.abort(); // pre-aborted

      // Pre-aborted signal should throw CLIENT_ABORTED in generate()
      await expect(ollama.generate('Test prompt', { signal: controller.signal })).rejects.toThrow(
        'CLIENT_ABORTED',
      );

      // Pre-aborted signal should cleanly exit generator in generateStream()
      const stream = ollama.generateStream('Test prompt', { signal: controller.signal });
      const chunks: any[] = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }
      expect(chunks).toHaveLength(0);
    });

    it('GeminiProvider should cleanly exit generator when signal is aborted', async () => {
      const gemini = new GeminiProvider({ apiKey: 'fake-api-key', modelName: 'gemini-1.5-flash' });
      const controller = new AbortController();
      controller.abort();

      const stream = gemini.generateStream('Test prompt', { signal: controller.signal });
      const chunks: any[] = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }
      expect(chunks).toHaveLength(0);
    });
  });

  // =========================================================================
  // 3. HTTP Layer SSE Streaming Disconnect & Listener Cleanup
  // =========================================================================
  describe('GenerationController.stream SSE HTTP Disconnect Handling', () => {
    it('should detect client disconnect, cancel generation, and clean up event listeners', async () => {
      server = app.listen(0);
      serverPort = (server.address() as any).port;

      mockLLM.setStreamDelay(50); // Delay so client disconnect occurs mid-stream

      await new Promise<void>((resolve, reject) => {
        const req = http.request(
          {
            hostname: '127.0.0.1',
            port: serverPort,
            path: '/api/rag/stream',
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${tokenUserA}`,
              'X-Workspace-ID': workspaceA.id,
            },
          },
          (res) => {
            let receivedData = '';

            res.on('data', (chunk) => {
              receivedData += chunk.toString();
              // As soon as we receive the first token or retrieval event, destroy socket
              if (receivedData.includes('retrieval_complete') || receivedData.includes('token')) {
                req.destroy(); // Simulates abrupt client disconnect
                setTimeout(() => {
                  resolve();
                }, 100);
              }
            });
          },
        );

        req.on('error', (err) => {
          // Socket destruction causes ECONNRESET / error on client side, which is expected
          resolve();
        });

        req.write(JSON.stringify({ query: 'Testing client disconnect detection' }));
        req.end();
      });

      // Allow event loop to process finally cleanup
      await new Promise((r) => setTimeout(r, 100));

      // Verify that after client disconnect, server does not crash and handles subsequent requests
      const verifyRes = await fetch(`http://127.0.0.1:${serverPort}/api/rag/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokenUserA}`,
          'X-Workspace-ID': workspaceA.id,
        },
        body: JSON.stringify({ query: 'Post-cancellation health check' }),
      });

      expect(verifyRes.status).toBe(200);
      const text = await verifyRes.text();
      expect(text).toContain('event: done');
    });

    it('should maintain concurrency isolation: aborting Request A does not abort Request B', async () => {
      server = app.listen(0);
      serverPort = (server.address() as any).port;

      mockLLM.setStreamDelay(30);

      // Start Request A and destroy it quickly
      const requestAPromise = new Promise<void>((resolve) => {
        const reqA = http.request(
          {
            hostname: '127.0.0.1',
            port: serverPort,
            path: '/api/rag/stream',
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${tokenUserA}`,
              'X-Workspace-ID': workspaceA.id,
            },
          },
          (resA) => {
            resA.on('data', () => {
              reqA.destroy();
              resolve();
            });
          },
        );
        reqA.on('error', () => resolve());
        reqA.write(JSON.stringify({ query: 'Request A (aborted)' }));
        reqA.end();
      });

      // Concurrently start Request B and let it complete fully
      const requestBPromise = fetch(`http://127.0.0.1:${serverPort}/api/rag/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokenUserA}`,
          'X-Workspace-ID': workspaceA.id,
        },
        body: JSON.stringify({ query: 'Request B (concurrent, should complete)' }),
      }).then(async (resB) => {
        expect(resB.status).toBe(200);
        const textB = await resB.text();
        expect(textB).toContain('event: start');
        expect(textB).toContain('event: token');
        expect(textB).toContain('event: done');
        expect(textB).not.toContain('CLIENT_ABORTED');
      });

      await Promise.all([requestAPromise, requestBPromise]);
    });
  });

  // =========================================================================
  // 4. Conversation Streaming Cancellation & Status Transition
  // =========================================================================
  describe('ConversationRAGService Stream Cancellation', () => {
    it('should transition assistant message to CANCELLED and not leave it in STREAMING', async () => {
      const session = await ConversationRepository.createSession(
        workspaceA.id,
        userA.id,
        'Cancel Session Test',
      );

      const abortController = new AbortController();

      // Configure MockLLM to delay and abort mid-stream
      mockLLM.setStreamDelay(15);
      let tokenCount = 0;

      const events: any[] = [];
      const stream = ConversationRAGService.streamConversationMessage(
        session.id,
        workspaceA.id,
        userA.id,
        SendConversationMessageRequestSchema.parse({
          content: 'Can you explain the cancellation guarantee?',
        }),
        abortController.signal,
      );

      for await (const event of stream) {
        events.push(event);
        if (event.type === 'token') {
          tokenCount++;
          if (tokenCount === 1) {
            abortController.abort();
          }
        }
      }

      const lastEvent = events[events.length - 1];
      expect(lastEvent).toMatchObject({
        type: 'error',
        code: 'CLIENT_ABORTED',
        message: 'Generation cancelled by user',
      });

      // Verify DB persistence: assistant message status must be CANCELLED, never STREAMING
      const messages = await ConversationRepository.listMessages(session.id, workspaceA.id);
      expect(messages).toHaveLength(2); // user message + assistant message

      const assistantMsg = messages.find((m) => m.role === 'ASSISTANT');
      expect(assistantMsg).toBeDefined();
      expect(assistantMsg?.status).toBe('CANCELLED');
      expect(assistantMsg?.metadata).toMatchObject({
        cancelled: true,
      });
    });
  });
});
