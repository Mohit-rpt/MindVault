import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GraphRetrievalService } from './graph-retrieval.service.js';
import type { IGraphRepository } from '../../graph/repositories/graph.repository.interface.js';
import type {
  RawGraphChunkRow,
  RawGraphRelationRow,
  DiscoveredSeedEntity,
} from '@mindvault/shared';

describe('GraphRetrievalService Unit Tests', () => {
  let mockGraphRepo: IGraphRepository;
  let service: GraphRetrievalService;

  const mockSeeds: DiscoveredSeedEntity[] = [
    {
      entityId: 'ent-1',
      canonicalName: 'Write-Ahead Logging',
      entityType: 'CONCEPT',
      seedScore: 1.0,
      matchStrategy: 'LEXICAL',
    },
    {
      entityId: 'ent-2',
      canonicalName: 'PostgreSQL',
      entityType: 'PRODUCT',
      seedScore: 0.95,
      matchStrategy: 'ALIAS',
    },
  ];

  const mockChunks: RawGraphChunkRow[] = [
    {
      chunkId: 'chk-1',
      documentId: 'doc-1',
      workspaceId: 'ws-1',
      chunkIndex: 0,
      content: 'WAL ensures durability by writing before disk flush.',
      tokenCount: 45,
      pageStart: 1,
      pageEnd: 2,
      metadata: {},
      createdAt: new Date(),
      docOriginalName: 'postgres-wal.pdf',
      docExtension: 'pdf',
      docStatus: 'COMPLETED',
      docPageCount: 10,
      score: 0.92,
      supportedRelationsCount: 2,
      supportedRelationIds: ['rel-1', 'rel-2'],
      relationTypes: ['USES', 'DEPENDS_ON'],
    },
    {
      chunkId: 'chk-2',
      documentId: 'doc-2',
      workspaceId: 'ws-1',
      chunkIndex: 3,
      content: 'Checkpointing flushes dirty buffers to disk.',
      tokenCount: 50,
      pageStart: 5,
      pageEnd: 6,
      metadata: {},
      createdAt: new Date(),
      docOriginalName: 'postgres-checkpoints.md',
      docExtension: '.md',
      docStatus: 'COMPLETED',
      docPageCount: 8,
      score: 0.75,
      supportedRelationsCount: 1,
      supportedRelationIds: ['rel-3'],
      relationTypes: ['TRIGGERED_BY'],
    },
  ];

  const mockRelations: RawGraphRelationRow[] = [
    {
      relationId: 'rel-1',
      sourceEntityId: 'ent-1',
      sourceCanonicalName: 'Write-Ahead Logging',
      targetEntityId: 'ent-2',
      targetCanonicalName: 'PostgreSQL',
      relationType: 'PART_OF',
      weight: 1.0,
      confidence: 0.9,
      depth: 1,
      evidenceChunkIds: ['chk-1'],
    },
  ];

  beforeEach(() => {
    mockGraphRepo = {
      discoverEntitySeeds: vi.fn().mockResolvedValue(mockSeeds),
      searchGraphEvidence: vi.fn().mockResolvedValue({
        chunks: mockChunks,
        relations: mockRelations,
      }),
    } as unknown as IGraphRepository;

    service = new GraphRetrievalService(mockGraphRepo);
  });

  // 1. N-Gram Extraction — Basic terms and multi-word phrases
  it('1. extracts n-grams from query terms, exact phrases, and full query', () => {
    const ngrams = GraphRetrievalService.extractNgrams(
      'How does Write-Ahead Logging work?',
      ['how', 'does', 'write-ahead', 'logging', 'work'],
      ['Write-Ahead Logging'],
    );

    expect(ngrams).toContain('write-ahead logging');
    expect(ngrams).toContain('logging');
  });

  // 2. N-Gram Extraction — Deduplication and bounds
  it('2. deduplicates n-grams and enforces the MAX_NGRAMS bound of 25', () => {
    const longQuery =
      'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen';
    const ngrams = GraphRetrievalService.extractNgrams(longQuery);

    expect(ngrams.length).toBeLessThanOrEqual(25);
    const uniqueNgrams = new Set(ngrams);
    expect(uniqueNgrams.size).toBe(ngrams.length);
  });

  // 3. N-Gram Extraction — Technical punctuation preservation
  it('3. preserves technical punctuation in n-grams (e.g. Node.js, C++, .NET)', () => {
    const ngrams = GraphRetrievalService.extractNgrams(
      'Deploying Node.js and C++ services on .NET',
    );

    expect(ngrams).toContain('node.js');
    expect(ngrams).toContain('c++');
    expect(ngrams).toContain('.net');
  });

  // 4. Stage 1 Seed Discovery — Parameter passing
  it('4. invokes discoverEntitySeeds with workspaceId, ngrams, and queryVector', async () => {
    const queryVector = new Array(768).fill(0.05);
    await service.retrieveChunks('ws-1', 'Write-Ahead Logging', {
      queryVector,
      topK: 15,
    });

    expect(mockGraphRepo.discoverEntitySeeds).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      ngrams: expect.any(Array),
      queryVector,
      maxSeeds: 5,
    });
  });

  // 5. Zero Seeds Discovered — Graceful empty exit
  it('5. returns empty chunks and relations when 0 seeds are discovered without calling searchGraphEvidence', async () => {
    vi.mocked(mockGraphRepo.discoverEntitySeeds).mockResolvedValueOnce([]);

    const result = await service.retrieveChunks('ws-1', 'Unknown nonexistent term');

    expect(result.chunks).toEqual([]);
    expect(result.relations).toEqual([]);
    expect(result.seeds).toEqual([]);
    expect(mockGraphRepo.searchGraphEvidence).not.toHaveBeenCalled();
    expect(result.timings.totalGraphMs).toBeGreaterThanOrEqual(0);
  });

  // 6. Seeds Discovered — Calls searchGraphEvidence
  it('6. invokes searchGraphEvidence with discovered seed entity IDs and clamped topK', async () => {
    const result = await service.retrieveChunks('ws-1', 'PostgreSQL WAL', {
      topK: 10,
      minConfidence: 0.7,
      minWeight: 0.6,
    });

    expect(mockGraphRepo.searchGraphEvidence).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      seedEntityIds: ['ent-1', 'ent-2'],
      topK: 10,
      minConfidence: 0.7,
      minWeight: 0.6,
    });
    expect(result.chunks.length).toBe(2);
    expect(result.relations.length).toBe(1);
    expect(result.seeds.length).toBe(2);
  });

  // 7. Workspace Filtering — Filter by documentIds
  it('7. filters returned chunks by documentIds', async () => {
    const result = await service.retrieveChunks('ws-1', 'WAL', {
      filters: {
        documentIds: ['doc-1'],
      },
    });

    expect(result.chunks.length).toBe(1);
    expect(result.chunks[0].documentId).toBe('doc-1');
  });

  // 8. Workspace Filtering — Filter by fileTypes
  it('8. filters returned chunks by fileTypes (case-insensitive extension)', async () => {
    const result = await service.retrieveChunks('ws-1', 'WAL', {
      filters: {
        fileTypes: ['md'],
      },
    });

    expect(result.chunks.length).toBe(1);
    expect(result.chunks[0].chunkId).toBe('chk-2');
    expect(result.chunks[0].docExtension).toBe('.md');
  });

  // 9. Workspace Filtering — Filter by pageStart and pageEnd
  it('9. filters returned chunks by pageStart and pageEnd range', async () => {
    const result = await service.retrieveChunks('ws-1', 'WAL', {
      filters: {
        pageStart: 4,
        pageEnd: 7,
      },
    });

    expect(result.chunks.length).toBe(1);
    expect(result.chunks[0].chunkId).toBe('chk-2'); // pages 5-6
  });

  // 10. Query Vector Reuse — Passes query vector without mutation
  it('10. reuses shared queryVector without modification', async () => {
    const queryVector = [0.1, 0.2, 0.3];
    await service.retrieveChunks('ws-1', 'WAL query', { queryVector });

    expect(mockGraphRepo.discoverEntitySeeds).toHaveBeenCalledWith(
      expect.objectContaining({
        queryVector: [0.1, 0.2, 0.3],
      }),
    );
  });

  // 11. Timing Telemetry — Records fine-grained timings
  it('11. records non-negative timing metrics for seed discovery and traversal', async () => {
    const result = await service.retrieveChunks('ws-1', 'WAL');

    expect(result.timings.seedDiscoveryMs).toBeGreaterThanOrEqual(0);
    expect(result.timings.evidenceTraversalMs).toBeGreaterThanOrEqual(0);
    expect(result.timings.totalGraphMs).toBeGreaterThanOrEqual(0);
  });

  // 12. Error Propagation — Propagates repository errors faithfully
  it('12. propagates repository exceptions to caller without swallowing', async () => {
    const dbError = new Error('Database connection failed');
    vi.mocked(mockGraphRepo.discoverEntitySeeds).mockRejectedValueOnce(dbError);

    await expect(service.retrieveChunks('ws-1', 'WAL')).rejects.toThrow(
      'Database connection failed',
    );
  });
});
