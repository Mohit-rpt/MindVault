import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RetrievalService } from '../services/retrieval.service.js';
import { dbService, type SearchChunkResult } from '../../../lib/db.js';
import { EmbeddingService } from '../embeddings/embedding.service.js';
import { GraphRetrievalService } from '../services/graph-retrieval.service.js';
import { GraphTraversalTimeoutError } from '../../graph/errors/graph-traversal.error.js';
import type { RawGraphChunkRow, RawGraphRelationRow } from '@mindvault/shared';

describe('RetrievalService Orchestration & GraphRAG Integration', () => {
  const wsId = 'workspace-123';
  const dummyVector = new Array(768).fill(0.042);

  const mockSemanticChunks: SearchChunkResult[] = [
    {
      chunk: {
        id: 'chunk-sem-1',
        documentId: 'doc-1',
        workspaceId: wsId,
        chunkIndex: 0,
        content: 'Semantic passage on PostgreSQL storage engine.',
        tokenCount: 60,
        pageStart: 1,
        pageEnd: 1,
        metadata: { header: 'Architecture' },
        createdAt: new Date(),
      },
      document: {
        id: 'doc-1',
        originalName: 'postgres.pdf',
        extension: 'pdf',
        status: 'COMPLETED',
        pageCount: 10,
      },
      score: 0.88,
    },
    {
      chunk: {
        id: 'chunk-shared-1',
        documentId: 'doc-2',
        workspaceId: wsId,
        chunkIndex: 1,
        content: 'Shared passage on Write-Ahead Logging and crash safety.',
        tokenCount: 80,
        pageStart: 3,
        pageEnd: 4,
        metadata: {},
        createdAt: new Date(),
      },
      document: {
        id: 'doc-2',
        originalName: 'wal.md',
        extension: 'md',
        status: 'COMPLETED',
        pageCount: 5,
      },
      score: 0.82,
    },
  ];

  const mockKeywordChunks: SearchChunkResult[] = [
    {
      chunk: {
        id: 'chunk-shared-1',
        documentId: 'doc-2',
        workspaceId: wsId,
        chunkIndex: 1,
        content: 'Shared passage on Write-Ahead Logging and crash safety.',
        tokenCount: 80,
        pageStart: 3,
        pageEnd: 4,
        metadata: {},
        createdAt: new Date(),
      },
      document: {
        id: 'doc-2',
        originalName: 'wal.md',
        extension: 'md',
        status: 'COMPLETED',
        pageCount: 5,
      },
      score: 1.45,
    },
    {
      chunk: {
        id: 'chunk-kw-1',
        documentId: 'doc-3',
        workspaceId: wsId,
        chunkIndex: 2,
        content: 'Keyword match for SQL queries and indexing.',
        tokenCount: 50,
        pageStart: 2,
        pageEnd: 2,
        metadata: {},
        createdAt: new Date(),
      },
      document: {
        id: 'doc-3',
        originalName: 'sql.txt',
        extension: 'txt',
        status: 'COMPLETED',
        pageCount: 4,
      },
      score: 1.2,
    },
  ];

  const mockGraphChunks: RawGraphChunkRow[] = [
    {
      chunkId: 'chunk-shared-1',
      documentId: 'doc-2',
      workspaceId: wsId,
      chunkIndex: 1,
      content: 'Shared passage on Write-Ahead Logging and crash safety.',
      tokenCount: 80,
      pageStart: 3,
      pageEnd: 4,
      metadata: {},
      createdAt: new Date(),
      docOriginalName: 'wal.md',
      docExtension: 'md',
      docStatus: 'COMPLETED',
      docPageCount: 5,
      score: 0.95,
      supportedRelationsCount: 2,
      supportedRelationIds: ['rel-101', 'rel-102'],
      relationTypes: ['USES', 'DEPENDS_ON'],
    },
    {
      chunkId: 'chunk-graph-1',
      documentId: 'doc-4',
      workspaceId: wsId,
      chunkIndex: 0,
      content: 'Knowledge graph evidence for buffer cache synchronization.',
      tokenCount: 55,
      pageStart: 1,
      pageEnd: 1,
      metadata: {},
      createdAt: new Date(),
      docOriginalName: 'buffer.pdf',
      docExtension: 'pdf',
      docStatus: 'COMPLETED',
      docPageCount: 6,
      score: 0.89,
      supportedRelationsCount: 1,
      supportedRelationIds: ['rel-103'],
      relationTypes: ['SYNCHRONIZES_WITH'],
    },
  ];

  const mockGraphRelations: RawGraphRelationRow[] = [
    {
      relationId: 'rel-101',
      sourceEntityId: 'ent-1',
      sourceCanonicalName: 'WAL',
      targetEntityId: 'ent-2',
      targetCanonicalName: 'Checkpoint',
      relationType: 'USES',
      weight: 1.0,
      confidence: 0.9,
      depth: 1,
      evidenceChunkIds: ['chunk-shared-1'],
    },
  ];

  beforeEach(() => {
    vi.spyOn(EmbeddingService, 'generateQueryVector').mockResolvedValue(dummyVector);
    vi.spyOn(dbService, 'searchVectorChunks').mockResolvedValue(mockSemanticChunks);
    vi.spyOn(dbService, 'searchKeywordChunks').mockResolvedValue(mockKeywordChunks);
    vi.spyOn(GraphRetrievalService, 'retrieveChunks').mockResolvedValue({
      chunks: mockGraphChunks,
      relations: mockGraphRelations,
      seeds: [
        {
          entityId: 'ent-1',
          canonicalName: 'WAL',
          entityType: 'CONCEPT',
          seedScore: 1.0,
          matchStrategy: 'LEXICAL',
        },
      ],
      timings: { seedDiscoveryMs: 4.5, evidenceTraversalMs: 8.2, totalGraphMs: 12.7 },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // 1. graphrag executes all 3 channels concurrently
  it('1. executes semantic, keyword, and graph channels concurrently in graphrag mode', async () => {
    const res = await RetrievalService.executeSearch(wsId, {
      query: 'PostgreSQL WAL recovery',
      mode: 'graphrag',
    });

    expect(dbService.searchVectorChunks).toHaveBeenCalledTimes(1);
    expect(dbService.searchKeywordChunks).toHaveBeenCalledTimes(1);
    expect(GraphRetrievalService.retrieveChunks).toHaveBeenCalledTimes(1);
    expect(res.metadata.semanticSearchUsed).toBe(true);
    expect(res.metadata.keywordSearchUsed).toBe(true);
    expect(res.metadata.graphSearchUsed).toBe(true);
  });

  // 2. graphrag performs 3-way RRF and assigns multi-channel sources
  it('2. performs 3-way RRF fusion and tags corroborating sources in graphrag mode', async () => {
    const res = await RetrievalService.executeSearch(wsId, {
      query: 'PostgreSQL WAL recovery',
      mode: 'graphrag',
    });

    const sharedChunk = res.results.find((r) => r.chunkId === 'chunk-shared-1');
    expect(sharedChunk).toBeDefined();
    expect(sharedChunk?.retrievalSources).toContain('semantic');
    expect(sharedChunk?.retrievalSources).toContain('keyword');
    expect(sharedChunk?.retrievalSources).toContain('graph');
    // Multi-corroborated chunk should achieve Top 1 rank
    expect(sharedChunk?.rank).toBe(1);
  });

  // 3. graphrag preserves graph provenance in metadata.graph
  it('3. preserves graph provenance in SearchResultItem.metadata.graph for corroborated chunks', async () => {
    const res = await RetrievalService.executeSearch(wsId, {
      query: 'PostgreSQL WAL recovery',
      mode: 'graphrag',
    });

    const sharedChunk = res.results.find((r) => r.chunkId === 'chunk-shared-1');
    expect(sharedChunk?.metadata?.graph).toBeDefined();
    const graphMeta = sharedChunk?.metadata?.graph as any;
    expect(graphMeta.supportedRelationsCount).toBe(2);
    expect(graphMeta.supportedRelationIds).toEqual(['rel-101', 'rel-102']);
    expect(graphMeta.relationTypes).toEqual(['DEPENDS_ON', 'USES']);
  });

  // 4. graphrag records fine-grained timings including graphSearchMs and graphSeedDiscoveryMs
  it('4. records fine-grained timings including graphSearchMs and graphSeedDiscoveryMs', async () => {
    const res = await RetrievalService.executeSearch(wsId, {
      query: 'PostgreSQL WAL recovery',
      mode: 'graphrag',
    });

    expect(res.metadata.timings.graphSearchMs).toBeDefined();
    expect(res.metadata.timings.graphSeedDiscoveryMs).toBeDefined();
    expect(res.metadata.timings.semanticSearchMs).toBeDefined();
    expect(res.metadata.timings.keywordSearchMs).toBeDefined();
    expect(res.metadata.timings.fusionMs).toBeDefined();
  });

  // 5. graphrag fail-soft on graph timeout
  it('5. degrades gracefully to 2-way semantic+keyword fusion when graph traversal times out', async () => {
    vi.spyOn(GraphRetrievalService, 'retrieveChunks').mockRejectedValueOnce(
      new GraphTraversalTimeoutError(),
    );

    const res = await RetrievalService.executeSearch(wsId, {
      query: 'PostgreSQL WAL recovery',
      mode: 'graphrag',
    });

    expect(res.metadata.graphSearchUsed).toBe(false);
    expect(res.metadata.graphError).toBe('TIMEOUT');
    expect(res.metadata.semanticSearchUsed).toBe(true);
    expect(res.metadata.keywordSearchUsed).toBe(true);
    expect(res.results.length).toBeGreaterThan(0);
  });

  // 6. graphrag fail-soft on graph database error
  it('6. degrades gracefully to 2-way semantic+keyword fusion when graph repository throws DB error', async () => {
    vi.spyOn(GraphRetrievalService, 'retrieveChunks').mockRejectedValueOnce(
      new Error('Graph connection pool exhausted'),
    );

    const res = await RetrievalService.executeSearch(wsId, {
      query: 'PostgreSQL WAL recovery',
      mode: 'graphrag',
    });

    expect(res.metadata.graphSearchUsed).toBe(false);
    expect(res.metadata.graphError).toBe('FAILED');
    expect(res.results.length).toBeGreaterThan(0);
  });

  // 7. graphrag fail-hard on semantic search failure
  it('7. fails hard when semantic search infrastructure fails in graphrag mode', async () => {
    vi.spyOn(dbService, 'searchVectorChunks').mockRejectedValueOnce(
      new Error('pgvector index corrupted'),
    );

    await expect(
      RetrievalService.executeSearch(wsId, {
        query: 'PostgreSQL WAL recovery',
        mode: 'graphrag',
      }),
    ).rejects.toThrow('pgvector index corrupted');
  });

  // 8. graphrag fail-hard on keyword search failure
  it('8. fails hard when keyword search infrastructure fails in graphrag mode', async () => {
    vi.spyOn(dbService, 'searchKeywordChunks').mockRejectedValueOnce(
      new Error('tsquery syntax error in database'),
    );

    await expect(
      RetrievalService.executeSearch(wsId, {
        query: 'PostgreSQL WAL recovery',
        mode: 'graphrag',
      }),
    ).rejects.toThrow('tsquery syntax error in database');
  });

  // 9. graphrag fail-hard on total bedrock failure
  it('9. fails hard when both semantic and keyword channels fail', async () => {
    vi.spyOn(dbService, 'searchVectorChunks').mockRejectedValueOnce(new Error('DB Down'));
    vi.spyOn(dbService, 'searchKeywordChunks').mockRejectedValueOnce(new Error('DB Down'));

    await expect(
      RetrievalService.executeSearch(wsId, {
        query: 'PostgreSQL WAL recovery',
        mode: 'graphrag',
      }),
    ).rejects.toThrow();
  });

  // 10. mode: 'graph' dedicated single mode execution
  it('10. executes dedicated graph-only search and maps single-channel results', async () => {
    const res = await RetrievalService.executeSearch(wsId, {
      query: 'PostgreSQL WAL recovery',
      mode: 'graph',
    });

    expect(GraphRetrievalService.retrieveChunks).toHaveBeenCalledTimes(1);
    expect(dbService.searchVectorChunks).not.toHaveBeenCalled();
    expect(dbService.searchKeywordChunks).not.toHaveBeenCalled();
    expect(res.metadata.graphSearchUsed).toBe(true);
    expect(res.results[0].retrievalSources).toEqual(['graph']);
  });

  // 11. mode: 'graph' fail-hard on timeout
  it('11. fails hard with GraphTraversalTimeoutError when graph traversal times out in graph-only mode', async () => {
    vi.spyOn(GraphRetrievalService, 'retrieveChunks').mockRejectedValueOnce(
      new GraphTraversalTimeoutError(),
    );

    await expect(
      RetrievalService.executeSearch(wsId, {
        query: 'PostgreSQL WAL recovery',
        mode: 'graph',
      }),
    ).rejects.toThrow(GraphTraversalTimeoutError);
  });

  // 12. mode: 'graph' fail-hard on database error
  it('12. fails hard when graph database query fails in graph-only mode', async () => {
    vi.spyOn(GraphRetrievalService, 'retrieveChunks').mockRejectedValueOnce(
      new Error('Relation evidence table unreachable'),
    );

    await expect(
      RetrievalService.executeSearch(wsId, {
        query: 'PostgreSQL WAL recovery',
        mode: 'graph',
      }),
    ).rejects.toThrow('Relation evidence table unreachable');
  });

  // 13. mode: 'hybrid' backward compatibility
  it('13. maintains 100% Phase 3 backward compatibility in hybrid mode (vector+keyword only)', async () => {
    const res = await RetrievalService.executeSearch(wsId, {
      query: 'PostgreSQL WAL recovery',
      mode: 'hybrid',
    });

    expect(dbService.searchVectorChunks).toHaveBeenCalledTimes(1);
    expect(dbService.searchKeywordChunks).toHaveBeenCalledTimes(1);
    expect(GraphRetrievalService.retrieveChunks).not.toHaveBeenCalled();
    expect(res.metadata.semanticSearchUsed).toBe(true);
    expect(res.metadata.keywordSearchUsed).toBe(true);
    expect(res.metadata.graphSearchUsed).toBe(false);
  });

  // 14. mode: 'semantic' backward compatibility
  it('14. maintains 100% backward compatibility in semantic mode (vector only)', async () => {
    const res = await RetrievalService.executeSearch(wsId, {
      query: 'PostgreSQL WAL recovery',
      mode: 'semantic',
    });

    expect(dbService.searchVectorChunks).toHaveBeenCalledTimes(1);
    expect(dbService.searchKeywordChunks).not.toHaveBeenCalled();
    expect(GraphRetrievalService.retrieveChunks).not.toHaveBeenCalled();
    expect(res.metadata.semanticSearchUsed).toBe(true);
  });

  // 15. mode: 'keyword' backward compatibility and zero embedding generation
  it('15. maintains 100% backward compatibility in keyword mode and generates ZERO embeddings', async () => {
    const res = await RetrievalService.executeSearch(wsId, {
      query: 'PostgreSQL WAL recovery',
      mode: 'keyword',
    });

    expect(dbService.searchKeywordChunks).toHaveBeenCalledTimes(1);
    expect(dbService.searchVectorChunks).not.toHaveBeenCalled();
    expect(GraphRetrievalService.retrieveChunks).not.toHaveBeenCalled();
    expect(EmbeddingService.generateQueryVector).not.toHaveBeenCalled();
    expect(res.metadata.keywordSearchUsed).toBe(true);
    expect(res.metadata.timings.embeddingGenerationMs).toBeUndefined();
  });

  // 16. Query embedding lifecycle: exactly one embedding generated
  it('16. generates query embedding at most once per request in graphrag mode', async () => {
    await RetrievalService.executeSearch(wsId, {
      query: 'PostgreSQL WAL recovery',
      mode: 'graphrag',
    });

    expect(EmbeddingService.generateQueryVector).toHaveBeenCalledTimes(1);
  });

  // 17. Shared vector identity
  it('17. shares the exact same 768-dim query vector across semantic and graph channels', async () => {
    await RetrievalService.executeSearch(wsId, {
      query: 'PostgreSQL WAL recovery',
      mode: 'graphrag',
    });

    expect(dbService.searchVectorChunks).toHaveBeenCalledWith(
      wsId,
      dummyVector,
      expect.any(Object),
    );
    expect(GraphRetrievalService.retrieveChunks).toHaveBeenCalledWith(
      wsId,
      expect.any(String),
      expect.objectContaining({ queryVector: dummyVector }),
    );
  });

  // 18. Natural empty results handling
  it('18. returns empty results with HTTP 200 without error flags when channels return 0 candidates naturally', async () => {
    vi.spyOn(dbService, 'searchVectorChunks').mockResolvedValueOnce([]);
    vi.spyOn(dbService, 'searchKeywordChunks').mockResolvedValueOnce([]);
    vi.spyOn(GraphRetrievalService, 'retrieveChunks').mockResolvedValueOnce({
      chunks: [],
      relations: [],
      seeds: [],
      timings: { seedDiscoveryMs: 2.0, evidenceTraversalMs: 0, totalGraphMs: 2.0 },
    });

    const res = await RetrievalService.executeSearch(wsId, {
      query: 'Query with no matches anywhere',
      mode: 'graphrag',
    });

    expect(res.results).toEqual([]);
    expect(res.metadata.totalResults).toBe(0);
    expect(res.metadata.graphError).toBeUndefined();
    expect(res.metadata.graphSearchUsed).toBe(true);
  });
});
