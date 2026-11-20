import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  InMemoryDatabaseService,
  PrismaDatabaseService,
  setDatabaseService,
  type DocumentRecord,
} from '../../../lib/db.js';
import { EmbeddingService, MockEmbeddingProvider } from '../embeddings/embedding.service.js';
import { RetrievalService } from '../services/retrieval.service.js';
import {
  APPROVED_EMBEDDING_MODELS,
  type EmbeddingProvider,
  type SearchVectorChunksOptions,
} from '@mindvault/shared';

describe('Phase 1B.4.2: Retrieval Service Integration & Mixed-Model Query Safety', () => {
  const wsA = 'ws-aaaa-1111-1111-111111111111';
  const wsB = 'ws-bbbb-2222-2222-222222222222';
  const dummyUser = 'user-001';

  let memoryDb: InMemoryDatabaseService;

  // Real mock providers for testing model propagation
  class CustomModelProvider implements EmbeddingProvider {
    public readonly modelName: string;
    public readonly dimension = 768;

    constructor(modelName: string) {
      this.modelName = modelName;
    }

    public async generateEmbedding(_text: string): Promise<number[]> {
      return new Array(768).fill(0.05);
    }

    public async generateEmbeddings(texts: string[]): Promise<number[][]> {
      return texts.map(() => new Array(768).fill(0.05));
    }
  }

  beforeEach(async () => {
    memoryDb = new InMemoryDatabaseService();
    setDatabaseService(memoryDb);
    EmbeddingService.resetProvider();
  });

  afterEach(() => {
    EmbeddingService.resetProvider();
    setDatabaseService(new PrismaDatabaseService());
    vi.restoreAllMocks();
  });

  describe('Section 4.1 & 4.2: Query Embedding Model Identity Resolution & Propagation', () => {
    it('propagates Nomic model identity to dbService.searchVectorChunks when Nomic provider is active', async () => {
      const nomicProvider = new CustomModelProvider(APPROVED_EMBEDDING_MODELS.OLLAMA_NOMIC);
      EmbeddingService.setProvider(nomicProvider);

      const searchSpy = vi.spyOn(memoryDb, 'searchVectorChunks');

      await RetrievalService.executeSearch(wsA, {
        query: 'Neural networks gradient descent',
        mode: 'hybrid',
      });

      expect(searchSpy).toHaveBeenCalledTimes(1);
      const passedOptions = searchSpy.mock.calls[0][2] as SearchVectorChunksOptions;
      expect(passedOptions.embeddingModel).toBe(APPROVED_EMBEDDING_MODELS.OLLAMA_NOMIC);
    });

    it('propagates Gemini model identity to dbService.searchVectorChunks when Gemini provider is active', async () => {
      const geminiProvider = new CustomModelProvider(APPROVED_EMBEDDING_MODELS.GEMINI_PRIMARY);
      EmbeddingService.setProvider(geminiProvider);

      const searchSpy = vi.spyOn(memoryDb, 'searchVectorChunks');

      await RetrievalService.executeSearch(wsA, {
        query: 'Quantum entanglement and teleportation',
        mode: 'hybrid',
      });

      expect(searchSpy).toHaveBeenCalledTimes(1);
      const passedOptions = searchSpy.mock.calls[0][2] as SearchVectorChunksOptions;
      expect(passedOptions.embeddingModel).toBe(APPROVED_EMBEDDING_MODELS.GEMINI_PRIMARY);
    });

    it('propagates Mock test model identity in test environment', async () => {
      EmbeddingService.setProvider(new MockEmbeddingProvider());

      const searchSpy = vi.spyOn(memoryDb, 'searchVectorChunks');

      await RetrievalService.executeSearch(wsA, {
        query: 'Mock test query',
        mode: 'hybrid',
      });

      expect(searchSpy).toHaveBeenCalledTimes(1);
      const passedOptions = searchSpy.mock.calls[0][2] as SearchVectorChunksOptions;
      expect(passedOptions.embeddingModel).toBe(APPROVED_EMBEDDING_MODELS.MOCK_TEST);
    });

    it('fails closed when an unapproved model is active (zero vector candidates returned)', async () => {
      const rogueProvider = new CustomModelProvider('unapproved-vendor-embed-v99');
      EmbeddingService.setProvider(rogueProvider);

      // Seed a document
      const doc = await memoryDb.createDocument({
        id: 'doc-1',
        workspaceId: wsA,
        uploadedById: dummyUser,
        originalName: 'test.pdf',
        mimeType: 'application/pdf',
        extension: 'pdf',
        sizeBytes: 100n,
        checksum: 'c1',
        storageKey: 'k1',
        status: 'COMPLETED',
        embeddingModel: 'unapproved-vendor-embed-v99',
      });

      await memoryDb.createDocumentChunks([
        {
          id: 'chk-1',
          documentId: doc.id,
          workspaceId: wsA,
          chunkIndex: 0,
          content: 'Unapproved model vector chunk',
          tokenCount: 10,
          embedding: new Array(768).fill(0.05),
        },
      ]);

      const res = await RetrievalService.executeSearch(wsA, {
        query: 'vector chunk',
        mode: 'semantic',
      });

      // Rogue provider must fail closed: zero vector candidates returned
      expect(res.results).toHaveLength(0);
      expect(res.metadata.totalResults).toBe(0);
    });
  });

  describe('Section 4.2 & 4.3: End-to-End Database Filtering Isolation Across Models', () => {
    let docNomic: DocumentRecord;
    let docLegacyNull: DocumentRecord;
    let docGemini: DocumentRecord;

    beforeEach(async () => {
      // Seed Nomic document
      docNomic = await memoryDb.createDocument({
        id: 'doc-nomic-1',
        workspaceId: wsA,
        uploadedById: dummyUser,
        originalName: 'nomic_guide.pdf',
        mimeType: 'application/pdf',
        extension: 'pdf',
        sizeBytes: 1024n,
        checksum: 'c-nomic',
        storageKey: 'k-nomic',
        status: 'COMPLETED',
        embeddingModel: APPROVED_EMBEDDING_MODELS.OLLAMA_NOMIC,
      });

      // Seed Legacy Null document (embedded with Ollama before metadata column)
      docLegacyNull = await memoryDb.createDocument({
        id: 'doc-legacy-null-1',
        workspaceId: wsA,
        uploadedById: dummyUser,
        originalName: 'legacy_doc.pdf',
        mimeType: 'application/pdf',
        extension: 'pdf',
        sizeBytes: 1024n,
        checksum: 'c-legacy',
        storageKey: 'k-legacy',
        status: 'COMPLETED',
        embeddingModel: null,
      });

      // Seed Gemini document
      docGemini = await memoryDb.createDocument({
        id: 'doc-gemini-1',
        workspaceId: wsA,
        uploadedById: dummyUser,
        originalName: 'gemini_whitepaper.pdf',
        mimeType: 'application/pdf',
        extension: 'pdf',
        sizeBytes: 1024n,
        checksum: 'c-gemini',
        storageKey: 'k-gemini',
        status: 'COMPLETED',
        embeddingModel: APPROVED_EMBEDDING_MODELS.GEMINI_PRIMARY,
      });

      // Seed chunks for all three documents
      await memoryDb.createDocumentChunks([
        {
          id: 'chk-nomic-1',
          documentId: docNomic.id,
          workspaceId: wsA,
          chunkIndex: 0,
          content: 'Nomic passage on local vector embeddings and semantic search.',
          tokenCount: 20,
          embedding: new Array(768).fill(0.05),
        },
        {
          id: 'chk-legacy-1',
          documentId: docLegacyNull.id,
          workspaceId: wsA,
          chunkIndex: 0,
          content: 'Legacy historical passage embedded before model metadata was recorded.',
          tokenCount: 20,
          embedding: new Array(768).fill(0.05),
        },
        {
          id: 'chk-gemini-1',
          documentId: docGemini.id,
          workspaceId: wsA,
          chunkIndex: 0,
          content: 'Gemini passage on cloud multimodal embeddings and dense representations.',
          tokenCount: 20,
          embedding: new Array(768).fill(0.05),
        },
      ]);
    });

    it('Nomic query retrieves explicit Nomic and legacy NULL documents, but strictly excludes Gemini documents', async () => {
      EmbeddingService.setProvider(new CustomModelProvider(APPROVED_EMBEDDING_MODELS.OLLAMA_NOMIC));

      const res = await RetrievalService.executeSearch(wsA, {
        query: 'vector embeddings passage',
        mode: 'semantic',
      });

      const returnedDocIds = res.results.map((r) => r.documentId);
      expect(returnedDocIds).toContain(docNomic.id);
      expect(returnedDocIds).toContain(docLegacyNull.id);
      expect(returnedDocIds).not.toContain(docGemini.id);
    });

    it('Gemini query retrieves Gemini documents only, strictly excluding explicit Nomic and legacy NULL documents', async () => {
      EmbeddingService.setProvider(new CustomModelProvider(APPROVED_EMBEDDING_MODELS.GEMINI_PRIMARY));

      const res = await RetrievalService.executeSearch(wsA, {
        query: 'multimodal dense representations',
        mode: 'semantic',
      });

      const returnedDocIds = res.results.map((r) => r.documentId);
      expect(returnedDocIds).toContain(docGemini.id);
      expect(returnedDocIds).not.toContain(docNomic.id);
      expect(returnedDocIds).not.toContain(docLegacyNull.id);
    });
  });

  describe('Section 4.4 & 4.5: Fail-Soft Degradation and Lexical Independence', () => {
    let docA: DocumentRecord;

    beforeEach(async () => {
      docA = await memoryDb.createDocument({
        id: 'doc-hybrid-a',
        workspaceId: wsA,
        uploadedById: dummyUser,
        originalName: 'system_architecture.md',
        mimeType: 'text/markdown',
        extension: 'md',
        sizeBytes: 500n,
        checksum: 'c-arch',
        storageKey: 'k-arch',
        status: 'COMPLETED',
        embeddingModel: APPROVED_EMBEDDING_MODELS.OLLAMA_NOMIC,
      });

      await memoryDb.createDocumentChunks([
        {
          id: 'chk-arch-1',
          documentId: docA.id,
          workspaceId: wsA,
          chunkIndex: 0,
          content: 'The PostgreSQL Write-Ahead Log ensures durable crash recovery across all transactions.',
          tokenCount: 25,
          embedding: new Array(768).fill(0.05),
        },
      ]);
    });

    it('degrades gracefully to keyword search in hybrid mode when embedding provider rejects with error (e.g. timeout)', async () => {
      vi.spyOn(EmbeddingService, 'generateQueryVector').mockRejectedValueOnce(
        new Error('Ollama connection timeout after 30000ms'),
      );

      const res = await RetrievalService.executeSearch(wsA, {
        query: 'PostgreSQL Write-Ahead Log crash recovery',
        mode: 'hybrid',
      });

      // Must succeed without throwing 500 error
      expect(res.results.length).toBeGreaterThan(0);
      expect(res.results[0].chunkId).toBe('chk-arch-1');
      expect(res.metadata.semanticSearchUsed).toBe(false);
      expect(res.metadata.keywordSearchUsed).toBe(true);
      expect(res.results[0].retrievalSources).toEqual(['keyword']);
    });

    it('degrades gracefully to keyword search in hybrid mode when dbService.searchVectorChunks throws', async () => {
      vi.spyOn(memoryDb, 'searchVectorChunks').mockRejectedValueOnce(
        new Error('Database vector index locked'),
      );

      const res = await RetrievalService.executeSearch(wsA, {
        query: 'PostgreSQL Write-Ahead Log crash recovery',
        mode: 'hybrid',
      });

      expect(res.results.length).toBeGreaterThan(0);
      expect(res.metadata.semanticSearchUsed).toBe(false);
      expect(res.metadata.keywordSearchUsed).toBe(true);
      expect(res.results[0].retrievalSources).toEqual(['keyword']);
    });

    it('semantic-only search fails hard when query vector generation throws', async () => {
      vi.spyOn(EmbeddingService, 'generateQueryVector').mockRejectedValueOnce(
        new Error('Ollama connection timeout after 30000ms'),
      );

      await expect(
        RetrievalService.executeSearch(wsA, {
          query: 'PostgreSQL Write-Ahead Log',
          mode: 'semantic',
        }),
      ).rejects.toThrow('Ollama connection timeout after 30000ms');
    });

    it('keyword-only search bypasses embedding generation completely and succeeds', async () => {
      const embSpy = vi.spyOn(EmbeddingService, 'generateQueryVector');

      const res = await RetrievalService.executeSearch(wsA, {
        query: 'PostgreSQL Write-Ahead Log',
        mode: 'keyword',
      });

      expect(embSpy).not.toHaveBeenCalled();
      expect(res.results.length).toBeGreaterThan(0);
      expect(res.metadata.semanticSearchUsed).toBe(false);
      expect(res.metadata.keywordSearchUsed).toBe(true);
    });

    it('returns clean empty results when neither vector nor keyword channels match anything', async () => {
      const res = await RetrievalService.executeSearch(wsA, {
        query: 'completely unrelated query about non-existent astrophysical phenomena',
        mode: 'hybrid',
      });

      expect(res.results).toEqual([]);
      expect(res.metadata.totalResults).toBe(0);
      expect(res.metadata.semanticSearchUsed).toBe(true);
      expect(res.metadata.keywordSearchUsed).toBe(true);
    });
  });

  describe('Section 4.7: Workspace Isolation Preservation', () => {
    it('strictly isolates chunks between workspaces under model-aware retrieval', async () => {
      EmbeddingService.setProvider(new CustomModelProvider(APPROVED_EMBEDDING_MODELS.OLLAMA_NOMIC));

      // Document in Workspace A
      const docA = await memoryDb.createDocument({
        id: 'doc-ws-a',
        workspaceId: wsA,
        uploadedById: dummyUser,
        originalName: 'workspace_a.md',
        mimeType: 'text/markdown',
        extension: 'md',
        sizeBytes: 100n,
        checksum: 'c-a',
        storageKey: 'k-a',
        status: 'COMPLETED',
        embeddingModel: APPROVED_EMBEDDING_MODELS.OLLAMA_NOMIC,
      });

      // Document in Workspace B with identical content and high-similarity vector
      const docB = await memoryDb.createDocument({
        id: 'doc-ws-b',
        workspaceId: wsB,
        uploadedById: dummyUser,
        originalName: 'workspace_b_secret.md',
        mimeType: 'text/markdown',
        extension: 'md',
        sizeBytes: 100n,
        checksum: 'c-b',
        storageKey: 'k-b',
        status: 'COMPLETED',
        embeddingModel: APPROVED_EMBEDDING_MODELS.OLLAMA_NOMIC,
      });

      await memoryDb.createDocumentChunks([
        {
          id: 'chk-ws-a',
          documentId: docA.id,
          workspaceId: wsA,
          chunkIndex: 0,
          content: 'Confidential project alpha roadmap and specifications.',
          tokenCount: 15,
          embedding: new Array(768).fill(0.05),
        },
        {
          id: 'chk-ws-b',
          documentId: docB.id,
          workspaceId: wsB,
          chunkIndex: 0,
          content: 'Confidential project beta proprietary secrets and financial forecasts.',
          tokenCount: 15,
          embedding: new Array(768).fill(0.05),
        },
      ]);

      // Query Workspace A
      const resA = await RetrievalService.executeSearch(wsA, {
        query: 'Confidential project secrets',
        mode: 'hybrid',
      });

      const returnedDocIdsA = resA.results.map((r) => r.documentId);
      expect(returnedDocIdsA).toContain(docA.id);
      expect(returnedDocIdsA).not.toContain(docB.id);

      // Query Workspace B
      const resB = await RetrievalService.executeSearch(wsB, {
        query: 'Confidential project secrets',
        mode: 'hybrid',
      });

      const returnedDocIdsB = resB.results.map((r) => r.documentId);
      expect(returnedDocIdsB).toContain(docB.id);
      expect(returnedDocIdsB).not.toContain(docA.id);
    });
  });
});
