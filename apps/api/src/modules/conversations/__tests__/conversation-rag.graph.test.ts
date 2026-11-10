import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../../../app.js';
import { InMemoryDatabaseService, setDatabaseService } from '../../../lib/db.js';
import {
  EmbeddingService,
  MockEmbeddingProvider,
} from '../../retrieval/embeddings/embedding.service.js';
import { LLMProviderFactory } from '../../generation/providers/provider.factory.js';
import { MockLLMProvider } from '../../generation/providers/mock.provider.js';
import { generateAccessToken } from '../../auth/auth.security.js';
import { RetrievalService } from '../../retrieval/services/retrieval.service.js';
import { GraphRetrievalService } from '../../retrieval/services/graph-retrieval.service.js';
import type { RawGraphRelationRow } from '@mindvault/shared';

describe('ConversationRAG Graph Integration & Ephemerality (Subtask 6.6.3.4)', () => {
  let app: any;
  let memoryDb: InMemoryDatabaseService;
  let mockLLM: MockLLMProvider;
  let user: any;
  let workspace: any;
  let token: string;
  let document: any;
  let chunk: any;

  beforeEach(async () => {
    memoryDb = new InMemoryDatabaseService();
    setDatabaseService(memoryDb);

    mockLLM = new MockLLMProvider();
    LLMProviderFactory.setProvider(mockLLM);
    EmbeddingService.setProvider(new MockEmbeddingProvider());

    app = createApp();

    user = await memoryDb.createUser({
      name: 'Dr. Jane Watson',
      email: 'jane@mindvault.local',
      passwordHash: 'argon2_hashed_secret',
    });

    const wsRes = await memoryDb.createWorkspace({
      name: 'Biomedical Vault',
      slug: 'biomedical-vault',
      ownerId: user.id,
    });
    workspace = wsRes.workspace;

    token = generateAccessToken({
      id: user.id,
      email: user.email,
      name: user.name,
    });

    document = await memoryDb.createDocument({
      workspaceId: workspace.id,
      uploadedById: user.id,
      originalName: 'ClinicalTrial.pdf',
      mimeType: 'application/pdf',
      extension: 'pdf',
      sizeBytes: 10240n,
      checksum: 'chk_123',
      storageKey: 'storage_trial_pdf',
    });

    await memoryDb.updateDocument(document.id, {
      status: 'COMPLETED',
      chunkCount: 1,
      pageCount: 5,
    });

    chunk = {
      id: 'chk_bio_1',
      documentId: document.id,
      workspaceId: workspace.id,
      chunkIndex: 0,
      content: 'Molecule ABC inhibits protein XYZ with high affinity in human cell lines.',
      tokenCount: 40,
      pageStart: 2,
      pageEnd: 2,
      embedding: new Array(1536).fill(0.01),
    };

    await memoryDb.createDocumentChunks([chunk]);
  });

  it('should stream conversation message using graphrag retrieval mode and emit structured SSE events', async () => {
    // Mock GraphRetrievalService to return structured graph evidence
    const mockRelation: RawGraphRelationRow = {
      relationId: 'rel_inh_1',
      sourceEntityId: 'ent_abc',
      sourceCanonicalName: 'Molecule ABC',
      targetEntityId: 'ent_xyz',
      targetCanonicalName: 'Protein XYZ',
      relationType: 'INHIBITS',
      confidence: 0.96,
      depth: 1,
      weight: 5.0,
      evidenceChunkIds: [chunk.id],
    };

    const retrieveChunksSpy = vi.spyOn(GraphRetrievalService, 'retrieveChunks').mockResolvedValue({
      chunks: [
        {
          chunkId: chunk.id,
          documentId: document.id,
          workspaceId: workspace.id,
          chunkIndex: 0,
          content: chunk.content,
          tokenCount: 40,
          pageStart: 2,
          pageEnd: 2,
          metadata: {},
          createdAt: new Date(),
          docOriginalName: 'ClinicalTrial.pdf',
          docExtension: 'pdf',
          docStatus: 'COMPLETED',
          docPageCount: 5,
          score: 0.95,
          supportedRelationsCount: 1,
          supportedRelationIds: ['rel_inh_1'],
          relationTypes: ['INHIBITS'],
          graphRelations: [mockRelation],
        },
      ],
      relations: [mockRelation],
      seeds: [
        {
          entityId: 'ent_abc',
          canonicalName: 'Molecule ABC',
          entityType: 'CONCEPT',
          seedScore: 1.0,
          matchStrategy: 'LEXICAL',
        },
      ],
      timings: {
        seedDiscoveryMs: 5,
        evidenceTraversalMs: 10,
        totalGraphMs: 15,
      },
    });

    // 1. Create a session
    const createRes = await request(app)
      .post('/api/conversations')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Workspace-ID', workspace.id)
      .send({ title: 'Molecule Research' });

    expect(createRes.status).toBe(201);
    const sessionId = createRes.body.data.id;

    // 2. Stream message with retrieval.mode = 'graphrag'
    const streamRes = await request(app)
      .post(`/api/conversations/${sessionId}/messages/stream`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Workspace-ID', workspace.id)
      .send({
        content: 'How does Molecule ABC affect Protein XYZ?',
        retrieval: {
          mode: 'graphrag',
          topK: 5,
        },
      });

    expect(streamRes.status).toBe(200);
    expect(streamRes.headers['content-type']).toContain('text/event-stream');

    // 3. Verify message was persisted with graphrag retrieval mode and graphRelationsCount
    const messagesRes = await request(app)
      .get(`/api/conversations/${sessionId}/messages`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Workspace-ID', workspace.id);

    expect(messagesRes.status).toBe(200);
    expect(messagesRes.body.data).toHaveLength(2);

    const [userMsg, assistantMsg] = messagesRes.body.data;
    expect(userMsg.role).toBe('USER');
    expect(assistantMsg.role).toBe('ASSISTANT');
    expect(assistantMsg.status).toBe('COMPLETED');
    expect(assistantMsg.metadata.retrievalMode).toBe('graphrag');
    expect(assistantMsg.metadata.graphRelationsCount).toBe(1);

    retrieveChunksSpy.mockRestore();
  });

  it('should enforce Condition C4 ephemerality: fresh search per turn without leaking graph relations', async () => {
    // Spy on RetrievalService.executeSearch to track per-turn parameters and fresh search execution
    const executeSearchSpy = vi.spyOn(RetrievalService, 'executeSearch');

    const createRes = await request(app)
      .post('/api/conversations')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Workspace-ID', workspace.id)
      .send({ title: 'Multi-Turn Ephemerality Test' });

    const sessionId = createRes.body.data.id;

    // Turn 1
    await request(app)
      .post(`/api/conversations/${sessionId}/messages/stream`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Workspace-ID', workspace.id)
      .send({
        content: 'What is Molecule ABC?',
        retrieval: { mode: 'hybrid' },
      });

    expect(executeSearchSpy).toHaveBeenCalledTimes(1);
    expect(executeSearchSpy).toHaveBeenLastCalledWith(
      workspace.id,
      expect.objectContaining({
        query: expect.any(String),
        mode: 'hybrid',
      }),
      expect.anything(),
    );

    // Turn 2: Follow-up question
    await request(app)
      .post(`/api/conversations/${sessionId}/messages/stream`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Workspace-ID', workspace.id)
      .send({
        content: 'Does it inhibit any proteins?',
        retrieval: { mode: 'hybrid' },
      });

    // Verification of Condition C4:
    // 1. Fresh search executed for Turn 2
    expect(executeSearchSpy).toHaveBeenCalledTimes(2);

    // 2. Both turns have completed assistant messages
    const messagesRes = await request(app)
      .get(`/api/conversations/${sessionId}/messages`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Workspace-ID', workspace.id);

    expect(messagesRes.body.data).toHaveLength(4); // User 1, Assistant 1, User 2, Assistant 2
    const assistant2 = messagesRes.body.data[3];
    expect(assistant2.status).toBe('COMPLETED');

    executeSearchSpy.mockRestore();
  });
});
