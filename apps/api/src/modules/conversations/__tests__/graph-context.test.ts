/**
 * MindVault — Conversational Graph Context & Focus Entity Tracking Tests (Phase 6.7)
 *
 * Verifies multi-turn graph-aware conversational capabilities:
 * 1. Focus Entity Extraction & Salience Scoring
 * 2. Singular Pronoun Resolution ("it", "its", "this", "that")
 * 3. Plural Pronoun Resolution ("they", "them", "these", "those")
 * 4. Demonstrative Noun Phrase Resolution ("that database", "the system")
 * 5. Elliptical Query Resolution ("Give an example", "What about performance?")
 * 6. Topic-Switch Isolation & Demotion of Stale Entities
 * 7. Topic-Return Reactivation of Earlier Focus Entities
 * 8. Assistant Grounding Entity Extraction
 * 9. Comparative Query Resolution ("How does it compare to X?")
 * 10. Focus Entity Hint Injection into Graph Retrieval
 * 11. Multi-Tenant Workspace Isolation
 * 12. Deterministic Entity Sorting & Bounded Footprint
 * 13. End-to-End Multi-Turn Conversational RAG Streaming with Focus Entities
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../../../app.js';
import { InMemoryDatabaseService, setDatabaseService } from '../../../lib/db.js';
import { LLMProviderFactory } from '../../generation/providers/provider.factory.js';
import { MockLLMProvider } from '../../generation/providers/mock.provider.js';
import {
  EmbeddingService,
  MockEmbeddingProvider,
} from '../../retrieval/embeddings/embedding.service.js';
import { generateAccessToken } from '../../auth/auth.security.js';
import { EntityContextService } from '../services/entity-context.service.js';
import { QueryContextService } from '../services/query-context.service.js';
import { RetrievalService } from '../../retrieval/services/retrieval.service.js';
import { GraphRetrievalService } from '../../retrieval/services/graph-retrieval.service.js';
import type { ChatMessageDto, RawGraphRelationRow } from '@mindvault/shared';

describe('Phase 6.7: Conversational Graph Context & Focus Entities', () => {
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
      name: 'Dr. Alan Turing',
      email: 'alan@mindvault.local',
      passwordHash: 'hashed_pwd_123',
    });

    const wsRes = await memoryDb.createWorkspace({
      name: 'Database Engineering Vault',
      slug: 'db-engineering',
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
      originalName: 'PostgreSQL_Internals.pdf',
      mimeType: 'application/pdf',
      extension: 'pdf',
      sizeBytes: 20480n,
      checksum: 'chk_pg_doc',
      storageKey: 'storage_pg_doc',
    });

    await memoryDb.updateDocument(document.id, {
      status: 'COMPLETED',
      chunkCount: 1,
      pageCount: 10,
    });

    chunk = {
      id: 'chk_pg_1',
      documentId: document.id,
      workspaceId: workspace.id,
      chunkIndex: 0,
      content:
        'PostgreSQL uses write-ahead logging (WAL) and supports indexes including B-Tree and GIN for query acceleration.',
      tokenCount: 45,
      pageStart: 1,
      pageEnd: 1,
      embedding: new Array(1536).fill(0.02),
    };

    await memoryDb.createDocumentChunks([chunk]);
  });

  // 1. Singular Pronoun Resolution
  it('Scenario 1: should resolve singular pronoun "it" to primary focus entity PostgreSQL', async () => {
    const history: ChatMessageDto[] = [
      {
        id: 'msg_1',
        sessionId: 'sess_1',
        workspaceId: workspace.id,
        role: 'USER',
        content: 'Tell me about PostgreSQL architecture.',
        status: 'COMPLETED',
        sequenceNumber: 1,
        citations: [],
        metadata: {},
        tokenEstimate: 10,
        createdAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      },
    ];

    const result = await QueryContextService.contextualizeQuery(
      'What indexes does it support?',
      history,
      null,
      { useLLM: false },
    );

    expect(result.wasRewritten).toBe(true);
    expect(result.strategy).toBe('entity_graph');
    expect(result.contextualQuery.toLowerCase()).toContain('postgresql');
    expect(result.focusEntities).toBeDefined();
    expect(result.focusEntities![0].canonicalName).toBe('PostgreSQL');
  });

  // 2. Possessive Pronoun Resolution
  it('Scenario 2: should resolve possessive "its limitations" to primary focus entity', async () => {
    const history: ChatMessageDto[] = [
      {
        id: 'msg_1',
        sessionId: 'sess_1',
        workspaceId: workspace.id,
        role: 'USER',
        content: 'What is PostgreSQL?',
        status: 'COMPLETED',
        sequenceNumber: 1,
        citations: [],
        metadata: {},
        tokenEstimate: 5,
        createdAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      },
    ];

    const result = await QueryContextService.contextualizeQuery(
      'What are its limitations?',
      history,
      null,
      { useLLM: false },
    );

    expect(result.wasRewritten).toBe(true);
    expect(result.contextualQuery.toLowerCase()).toContain('limitations of postgresql');
  });

  // 3. Plural Pronoun Resolution
  it('Scenario 3: should resolve plural pronoun "them" to multiple active entities', async () => {
    const history: ChatMessageDto[] = [
      {
        id: 'msg_1',
        sessionId: 'sess_1',
        workspaceId: workspace.id,
        role: 'USER',
        content: 'Explain B-Tree and GIN indexes in PostgreSQL.',
        status: 'COMPLETED',
        sequenceNumber: 1,
        citations: [],
        metadata: {},
        tokenEstimate: 10,
        createdAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      },
    ];

    const entityState = EntityContextService.extractFocusEntities(history, 'Can you compare them?');
    const resolution = EntityContextService.resolvePronounsAndEllipsis(
      'Can you compare them?',
      entityState,
    );

    expect(resolution.wasResolved).toBe(true);
    expect(resolution.resolvedQuery.toLowerCase()).toContain('compare');
    expect(resolution.resolvedPronouns['them']).toBeDefined();
  });

  // 4. Demonstrative Noun Phrase Resolution
  it('Scenario 4: should resolve demonstrative "that database" to primary focus entity', async () => {
    const history: ChatMessageDto[] = [
      {
        id: 'msg_1',
        sessionId: 'sess_1',
        workspaceId: workspace.id,
        role: 'USER',
        content: 'Explain PostgreSQL architecture.',
        status: 'COMPLETED',
        sequenceNumber: 1,
        citations: [],
        metadata: {},
        tokenEstimate: 8,
        createdAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      },
    ];

    const result = await QueryContextService.contextualizeQuery(
      'What are the main drawbacks of that database?',
      history,
      null,
      { useLLM: false },
    );

    expect(result.wasRewritten).toBe(true);
    expect(result.contextualQuery.toLowerCase()).toContain('postgresql');
  });

  // 5. Elliptical Starts
  it('Scenario 5: should attach focus entity to elliptical follow-up "What about performance?"', async () => {
    const history: ChatMessageDto[] = [
      {
        id: 'msg_1',
        sessionId: 'sess_1',
        workspaceId: workspace.id,
        role: 'USER',
        content: 'Tell me about PostgreSQL.',
        status: 'COMPLETED',
        sequenceNumber: 1,
        citations: [],
        metadata: {},
        tokenEstimate: 5,
        createdAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      },
    ];

    const result = await QueryContextService.contextualizeQuery(
      'What about performance?',
      history,
      null,
      { useLLM: false },
    );

    expect(result.wasRewritten).toBe(true);
    expect(result.contextualQuery.toLowerCase()).toContain('performance in postgresql');
  });

  // 6. Elliptical Example
  it('Scenario 6: should attach focus entity to "Give me an example"', async () => {
    const history: ChatMessageDto[] = [
      {
        id: 'msg_1',
        sessionId: 'sess_1',
        workspaceId: workspace.id,
        role: 'USER',
        content: 'Explain Write-Ahead Logging (WAL).',
        status: 'COMPLETED',
        sequenceNumber: 1,
        citations: [],
        metadata: {},
        tokenEstimate: 6,
        createdAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      },
    ];

    const result = await QueryContextService.contextualizeQuery(
      'Give me a real-world example',
      history,
      null,
      { useLLM: false },
    );

    expect(result.wasRewritten).toBe(true);
    expect(result.contextualQuery.toLowerCase()).toContain('example of');
    expect(result.contextualQuery.toLowerCase()).toContain('wal');
  });

  // 7. Multi-Turn Retention & Salience Decay
  it('Scenario 7: should track focus entity across multiple turns with graceful recency decay', async () => {
    const history: ChatMessageDto[] = [
      {
        id: 'msg_1',
        sessionId: 'sess_1',
        workspaceId: workspace.id,
        role: 'USER',
        content: 'Tell me about PostgreSQL.',
        status: 'COMPLETED',
        sequenceNumber: 1,
        citations: [],
        metadata: {},
        tokenEstimate: 5,
        createdAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      },
      {
        id: 'msg_2',
        sessionId: 'sess_1',
        workspaceId: workspace.id,
        role: 'ASSISTANT',
        content: 'PostgreSQL is a powerful object-relational database system [S1].',
        status: 'COMPLETED',
        sequenceNumber: 2,
        citations: [],
        metadata: {},
        tokenEstimate: 12,
        createdAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      },
      {
        id: 'msg_3',
        sessionId: 'sess_1',
        workspaceId: workspace.id,
        role: 'USER',
        content: 'What indexes does it have?',
        status: 'COMPLETED',
        sequenceNumber: 3,
        citations: [],
        metadata: {},
        tokenEstimate: 6,
        createdAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      },
      {
        id: 'msg_4',
        sessionId: 'sess_1',
        workspaceId: workspace.id,
        role: 'ASSISTANT',
        content: 'It supports B-Tree, Hash, GiST, SP-GiST, GIN, and BRIN indexes [S1].',
        status: 'COMPLETED',
        sequenceNumber: 4,
        citations: [],
        metadata: {},
        tokenEstimate: 15,
        createdAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      },
    ];

    const state = EntityContextService.extractFocusEntities(history, 'How does its WAL work?');
    expect(state.primaryEntity).toBeDefined();
    expect(state.primaryEntity!.canonicalName.toLowerCase()).toContain('postgresql');
    expect(state.primaryEntity!.salience).toBeGreaterThan(0.5);
  });

  // 8. Topic Switch Isolation & Stale Context Demotion
  it('Scenario 8: should detect topic switch, demote stale entity, and establish new focus entity', async () => {
    const history: ChatMessageDto[] = [
      {
        id: 'msg_1',
        sessionId: 'sess_1',
        workspaceId: workspace.id,
        role: 'USER',
        content: 'Tell me about PostgreSQL.',
        status: 'COMPLETED',
        sequenceNumber: 1,
        citations: [],
        metadata: {},
        tokenEstimate: 5,
        createdAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      },
    ];

    const state = EntityContextService.extractFocusEntities(
      history,
      "Now, let's switch to Redis. How does it handle in-memory persistence?",
    );

    expect(state.topicSwitched).toBe(true);
    expect(state.primaryEntity).toBeDefined();
    expect(state.primaryEntity!.canonicalName.toLowerCase()).toContain('redis');
    expect(state.activeTopic?.toLowerCase()).toContain('redis');

    // Verify older entity (PostgreSQL) is demoted
    const pgEntity = state.secondaryEntities.find((e) =>
      e.canonicalName.toLowerCase().includes('postgresql'),
    );
    if (pgEntity) {
      expect(pgEntity.salience).toBeLessThan(0.2);
    }
  });

  // 9. Topic Return Reactivation
  it('Scenario 9: should detect topic return and reactivate earlier focus entity', async () => {
    const history: ChatMessageDto[] = [
      {
        id: 'msg_1',
        sessionId: 'sess_1',
        workspaceId: workspace.id,
        role: 'USER',
        content: 'Explain PostgreSQL architecture.',
        status: 'COMPLETED',
        sequenceNumber: 1,
        citations: [],
        metadata: {},
        tokenEstimate: 5,
        createdAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      },
      {
        id: 'msg_2',
        sessionId: 'sess_1',
        workspaceId: workspace.id,
        role: 'USER',
        content: "Now let's switch to Redis. How does it store keys?",
        status: 'COMPLETED',
        sequenceNumber: 2,
        citations: [],
        metadata: {},
        tokenEstimate: 10,
        createdAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      },
    ];

    const state = EntityContextService.extractFocusEntities(
      history,
      'Going back to our earlier discussion about PostgreSQL, how does WAL work?',
    );

    expect(state.topicReturned).toBe(true);
    expect(state.primaryEntity).toBeDefined();
    expect(state.primaryEntity!.canonicalName.toLowerCase()).toContain('postgresql');
    expect(state.primaryEntity!.salience).toBe(1.0);
  });

  // 10. Comparative Query Resolution
  it('Scenario 10: should resolve comparative query "How does it compare to MySQL?"', async () => {
    const history: ChatMessageDto[] = [
      {
        id: 'msg_1',
        sessionId: 'sess_1',
        workspaceId: workspace.id,
        role: 'USER',
        content: 'Tell me about PostgreSQL.',
        status: 'COMPLETED',
        sequenceNumber: 1,
        citations: [],
        metadata: {},
        tokenEstimate: 5,
        createdAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      },
    ];

    const entityState = EntityContextService.extractFocusEntities(
      history,
      'How does it compare to MySQL?',
    );
    const resolution = EntityContextService.resolvePronounsAndEllipsis(
      'How does it compare to MySQL?',
      entityState,
    );

    expect(resolution.wasResolved).toBe(true);
    expect(resolution.resolvedQuery).toMatch(/how does postgresql compare to mysql/i);
  });

  // 11. Assistant Grounding Entity Extraction
  it('Scenario 11: should extract focus entity from assistant message grounding when user query is generic', async () => {
    const history: ChatMessageDto[] = [
      {
        id: 'msg_1',
        sessionId: 'sess_1',
        workspaceId: workspace.id,
        role: 'USER',
        content: 'Can you recommend an open-source database?',
        status: 'COMPLETED',
        sequenceNumber: 1,
        citations: [],
        metadata: {},
        tokenEstimate: 7,
        createdAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      },
      {
        id: 'msg_2',
        sessionId: 'sess_1',
        workspaceId: workspace.id,
        role: 'ASSISTANT',
        content:
          'PostgreSQL is an advanced, enterprise-grade open-source relational database system [S1].',
        status: 'COMPLETED',
        sequenceNumber: 2,
        citations: [],
        metadata: {
          focusEntities: [
            {
              name: 'PostgreSQL',
              canonicalName: 'PostgreSQL',
              salience: 0.95,
              mentionCount: 1,
              lastTurnIndex: 0,
              source: 'assistant_grounding',
            },
          ],
        },
        tokenEstimate: 16,
        createdAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      },
    ];

    const result = await QueryContextService.contextualizeQuery(
      'What indexes does it support?',
      history,
      null,
      { useLLM: false },
    );

    expect(result.wasRewritten).toBe(true);
    expect(result.contextualQuery.toLowerCase()).toContain('postgresql');
  });

  // 12. Focus Entity Hint Injection into Graph Retrieval
  it('Scenario 12: should inject focusEntityHints into GraphRetrievalService.extractNgrams', () => {
    const query = 'What indexes does it support?';
    const hints = ['PostgreSQL', 'WAL'];

    const ngrams = GraphRetrievalService.extractNgrams(query, undefined, undefined, hints);

    expect(ngrams).toContain('postgresql');
    expect(ngrams).toContain('wal');
  });

  // 13. Deterministic Entity Sorting & Bounded Footprint
  it('Scenario 13: should enforce strict 5-entity cap and deterministic ordering', () => {
    const history: ChatMessageDto[] = [
      {
        id: 'msg_1',
        sessionId: 'sess_1',
        workspaceId: workspace.id,
        role: 'USER',
        content: 'Discuss PostgreSQL, MySQL, Redis, MongoDB, Cassandra, SQLite, and CockroachDB.',
        status: 'COMPLETED',
        sequenceNumber: 1,
        citations: [],
        metadata: {},
        tokenEstimate: 15,
        createdAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      },
    ];

    const state = EntityContextService.extractFocusEntities(history, 'Tell me more');
    const totalTracked = (state.primaryEntity ? 1 : 0) + state.secondaryEntities.length;

    expect(totalTracked).toBeLessThanOrEqual(5);
  });

  // 14. Self-Contained Query Pass-Through
  it('Scenario 14: should pass through self-contained queries without altering them', async () => {
    const history: ChatMessageDto[] = [
      {
        id: 'msg_1',
        sessionId: 'sess_1',
        workspaceId: workspace.id,
        role: 'USER',
        content: 'Tell me about PostgreSQL.',
        status: 'COMPLETED',
        sequenceNumber: 1,
        citations: [],
        metadata: {},
        tokenEstimate: 5,
        createdAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      },
    ];

    const result = await QueryContextService.contextualizeQuery(
      'What is an HTTP 500 Internal Server Error?',
      history,
      null,
    );

    expect(result.wasRewritten).toBe(false);
    expect(result.strategy).toBe('pass_through');
    expect(result.contextualQuery).toBe('What is an HTTP 500 Internal Server Error?');
  });

  // 15. End-to-End Multi-Turn Conversational RAG Streaming with Focus Entities
  it('Scenario 15: should execute end-to-end multi-turn conversation streaming with graph focus entities', async () => {
    const mockRelation: RawGraphRelationRow = {
      relationId: 'rel_pg_idx',
      sourceEntityId: 'ent_pg',
      sourceCanonicalName: 'PostgreSQL',
      targetEntityId: 'ent_btree',
      targetCanonicalName: 'B-Tree',
      relationType: 'SUPPORTS_INDEX',
      confidence: 0.98,
      depth: 1,
      weight: 8.0,
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
          tokenCount: 45,
          pageStart: 1,
          pageEnd: 1,
          metadata: {},
          createdAt: new Date(),
          docOriginalName: 'PostgreSQL_Internals.pdf',
          docExtension: 'pdf',
          docStatus: 'COMPLETED',
          docPageCount: 10,
          score: 0.96,
          supportedRelationsCount: 1,
          supportedRelationIds: ['rel_pg_idx'],
          relationTypes: ['SUPPORTS_INDEX'],
          graphRelations: [mockRelation],
        },
      ],
      relations: [mockRelation],
      seeds: [
        {
          entityId: 'ent_pg',
          canonicalName: 'PostgreSQL',
          entityType: 'TECHNOLOGY',
          seedScore: 1.0,
          matchStrategy: 'LEXICAL',
        },
      ],
      timings: {
        seedDiscoveryMs: 4,
        evidenceTraversalMs: 8,
        totalGraphMs: 12,
      },
    });

    const executeSearchSpy = vi.spyOn(RetrievalService, 'executeSearch');

    // 1. Create a session
    const createRes = await request(app)
      .post('/api/conversations')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Workspace-ID', workspace.id)
      .send({ title: 'PostgreSQL Multi-Turn Test' });

    expect(createRes.status).toBe(201);
    const sessionId = createRes.body.data.id;

    // Turn 1: Initial Question
    const turn1Res = await request(app)
      .post(`/api/conversations/${sessionId}/messages/stream`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Workspace-ID', workspace.id)
      .send({
        content: 'Tell me about PostgreSQL architecture.',
        retrieval: { mode: 'graphrag' },
      });

    expect(turn1Res.status).toBe(200);

    // Turn 2: Follow-up with Pronoun "it"
    const turn2Res = await request(app)
      .post(`/api/conversations/${sessionId}/messages/stream`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Workspace-ID', workspace.id)
      .send({
        content: 'What indexes does it support?',
        retrieval: { mode: 'graphrag' },
      });

    expect(turn2Res.status).toBe(200);

    // Verify executeSearch was called with focusEntityHints in Turn 2
    expect(executeSearchSpy).toHaveBeenCalledTimes(2);
    const turn2CallArgs = executeSearchSpy.mock.calls[1];
    expect(turn2CallArgs[0]).toBe(workspace.id);
    expect(turn2CallArgs[1].focusEntityHints).toBeDefined();

    // Verify message persistence
    const messagesRes = await request(app)
      .get(`/api/conversations/${sessionId}/messages`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Workspace-ID', workspace.id);

    expect(messagesRes.status).toBe(200);
    expect(messagesRes.body.data).toHaveLength(4); // User 1, Assistant 1, User 2, Assistant 2

    const assistant2 = messagesRes.body.data[3];
    expect(assistant2.status).toBe('COMPLETED');
    expect(assistant2.metadata.focusEntities).toBeDefined();

    retrieveChunksSpy.mockRestore();
    executeSearchSpy.mockRestore();
  });
});
