import { describe, it, expect, beforeEach } from 'vitest';
import {
  InMemoryDatabaseService,
  buildVectorSearchQuery,
  type DocumentRecord,
} from '../db.js';

describe('Phase 1B.4.1: Database-Layer Model-Aware Vector Retrieval', () => {
  const dummyWorkspaceA = '11111111-1111-1111-1111-111111111111';
  const dummyWorkspaceB = '22222222-2222-2222-2222-222222222222';
  const dummyUser = 'user-001';

  // 768-D query vector
  const queryVector768 = new Array(768).fill(0.05);

  describe('Section 5 & 6: SQL Construction, Parameterization & Security (buildVectorSearchQuery)', () => {
    it('1. builds parameterized SQL for Ollama model with null legacy allowance', () => {
      const { query, params } = buildVectorSearchQuery(dummyWorkspaceA, queryVector768, {
        embeddingModel: 'nomic-embed-text',
        topK: 10,
      });

      expect(query).toContain('WHERE c."workspaceId" = $1 AND d."workspaceId" = $1 AND d."status" = \'COMPLETED\' AND c."embedding" IS NOT NULL');
      expect(query).toContain('AND (d."embeddingModel" = $4 OR d."embeddingModel" IS NULL)');
      expect(query).toContain('ORDER BY c."embedding" <=> $2::vector ASC');
      expect(query).toContain('LIMIT $3');

      expect(params[0]).toBe(dummyWorkspaceA);
      expect(params[1]).toBe(`[${queryVector768.join(',')}]`);
      expect(params[2]).toBe(10);
      expect(params[3]).toBe('nomic-embed-text');
    });

    it('2. defaults to Gemini-compatible parameterized query when options or embeddingModel is omitted', () => {
      const { query: queryNoOptions, params: paramsNoOptions } = buildVectorSearchQuery(
        dummyWorkspaceA,
        queryVector768,
      );

      expect(queryNoOptions).toContain('AND d."embeddingModel" = $4');
      expect(paramsNoOptions[3]).toBe('gemini-embedding-2');

      const { query: queryEmptyOptions, params: paramsEmptyOptions } = buildVectorSearchQuery(
        dummyWorkspaceA,
        queryVector768,
        {},
      );

      expect(queryEmptyOptions).toContain('AND d."embeddingModel" = $4');
      expect(paramsEmptyOptions[3]).toBe('gemini-embedding-2');
    });

    it('3. builds strict parameterized SQL for Gemini model, excluding NULL metadata', () => {
      const { query, params } = buildVectorSearchQuery(dummyWorkspaceA, queryVector768, {
        embeddingModel: 'gemini-embedding-2',
        topK: 15,
      });

      expect(query).toContain('AND d."embeddingModel" = $4');
      expect(query).not.toContain('d."embeddingModel" IS NULL');
      expect(params[0]).toBe(dummyWorkspaceA);
      expect(params[2]).toBe(15);
      expect(params[3]).toBe('gemini-embedding-2');
    });

    it('4. strictly excludes unknown model identities in SQL via false predicate', () => {
      const { query, params } = buildVectorSearchQuery(dummyWorkspaceA, queryVector768, {
        embeddingModel: 'unsupported-model-xyz',
      });

      expect(query).toContain('AND d."embeddingModel" = $4 AND false');
      expect(params[3]).toBe('unsupported-model-xyz');
    });

    it('5. parameterizes model-name safely and prevents SQL injection attempts', () => {
      const injectionPayload = "'; DROP TABLE documents; --";
      const { query, params } = buildVectorSearchQuery(dummyWorkspaceA, queryVector768, {
        embeddingModel: injectionPayload,
      });

      // The injection payload must NEVER appear in the raw SQL string
      expect(query).not.toContain('DROP TABLE');
      expect(query).toContain('d."embeddingModel" = $4');
      // The injection payload is safely quarantined as a bound parameter value
      expect(params[3]).toBe(injectionPayload);
    });

    it('6. correctly offsets parameter indexes when additional filters are combined', () => {
      const { query, params } = buildVectorSearchQuery(dummyWorkspaceA, queryVector768, {
        embeddingModel: 'gemini-embedding-2',
        documentIds: ['doc-1', 'doc-2'],
        fileTypes: ['pdf', 'md'],
        pageStart: 5,
        pageEnd: 10,
        topK: 20,
      });

      expect(query).toContain('d."embeddingModel" = $4');
      expect(query).toContain('c."documentId" = ANY($5::text[])');
      expect(query).toContain('LOWER(d."extension") = ANY($6::text[])');
      expect(query).toContain('(c."pageEnd" IS NULL OR c."pageEnd" >= $7)');
      expect(query).toContain('(c."pageStart" IS NULL OR c."pageStart" <= $8)');

      expect(params[0]).toBe(dummyWorkspaceA);
      expect(params[2]).toBe(20);
      expect(params[3]).toBe('gemini-embedding-2');
      expect(params[4]).toEqual(['doc-1', 'doc-2']);
      expect(params[5]).toEqual(['pdf', 'md']);
      expect(params[6]).toBe(5);
      expect(params[7]).toBe(10);
    });

    it('7. clamps topK to [1, 50] range in SQL parameterization', () => {
      const { params: paramsLow } = buildVectorSearchQuery(dummyWorkspaceA, queryVector768, {
        topK: -5,
      });
      expect(paramsLow[2]).toBe(1);

      const { params: paramsHigh } = buildVectorSearchQuery(dummyWorkspaceA, queryVector768, {
        topK: 200,
      });
      expect(paramsHigh[2]).toBe(50);
    });
  });

  describe('Section 6: Database Service Integration & Invariants (InMemoryDatabaseService)', () => {
    let db: InMemoryDatabaseService;

    // Test documents in Workspace A
    let docOllamaExplicitA: DocumentRecord;
    let docOllamaLegacyNullA: DocumentRecord;
    let docGeminiA: DocumentRecord;
    let docUnprocessedA: DocumentRecord;

    // Test documents in Workspace B (for multi-tenant isolation testing)
    let docGeminiB: DocumentRecord;
    let docOllamaB: DocumentRecord;

    // Synthetic orthogonal unit vectors
    const vecHighSim = new Array(768).fill(0.1); // High dot product with query
    const vecMedSim = new Array(768).fill(0.05); // Medium dot product with query
    const vecLowSim = new Array(768).fill(0.01); // Low dot product with query

    beforeEach(async () => {
      db = new InMemoryDatabaseService();

      // Seed documents in Workspace A
      docOllamaExplicitA = await db.createDocument({
        id: 'doc-ollama-explicit-A',
        workspaceId: dummyWorkspaceA,
        uploadedById: dummyUser,
        originalName: 'ollama_explicit.pdf',
        mimeType: 'application/pdf',
        extension: 'pdf',
        sizeBytes: 1024n,
        checksum: 'cs-ollama-exp-A',
        storageKey: 'key-1',
        status: 'COMPLETED',
        embeddingModel: 'nomic-embed-text',
        embeddingDimension: 768,
      });

      docOllamaLegacyNullA = await db.createDocument({
        id: 'doc-ollama-legacy-null-A',
        workspaceId: dummyWorkspaceA,
        uploadedById: dummyUser,
        originalName: 'ollama_legacy_null.pdf',
        mimeType: 'application/pdf',
        extension: 'pdf',
        sizeBytes: 1024n,
        checksum: 'cs-ollama-null-A',
        storageKey: 'key-2',
        status: 'COMPLETED',
        embeddingModel: null, // Legacy document before embeddingModel column
        embeddingDimension: null,
      });

      docGeminiA = await db.createDocument({
        id: 'doc-gemini-A',
        workspaceId: dummyWorkspaceA,
        uploadedById: dummyUser,
        originalName: 'gemini_doc.pdf',
        mimeType: 'application/pdf',
        extension: 'pdf',
        sizeBytes: 1024n,
        checksum: 'cs-gemini-A',
        storageKey: 'key-3',
        status: 'COMPLETED',
        embeddingModel: 'gemini-embedding-2',
        embeddingDimension: 768,
      });

      docUnprocessedA = await db.createDocument({
        id: 'doc-unprocessed-A',
        workspaceId: dummyWorkspaceA,
        uploadedById: dummyUser,
        originalName: 'pending_gemini.pdf',
        mimeType: 'application/pdf',
        extension: 'pdf',
        sizeBytes: 1024n,
        checksum: 'cs-pending-A',
        storageKey: 'key-4',
        status: 'PROCESSING', // Not COMPLETED
        embeddingModel: 'gemini-embedding-2',
        embeddingDimension: 768,
      });

      // Seed documents in Workspace B (Isolation test)
      docGeminiB = await db.createDocument({
        id: 'doc-gemini-B',
        workspaceId: dummyWorkspaceB,
        uploadedById: dummyUser,
        originalName: 'gemini_doc_ws_B.pdf',
        mimeType: 'application/pdf',
        extension: 'pdf',
        sizeBytes: 1024n,
        checksum: 'cs-gemini-B',
        storageKey: 'key-5',
        status: 'COMPLETED',
        embeddingModel: 'gemini-embedding-2',
        embeddingDimension: 768,
      });

      docOllamaB = await db.createDocument({
        id: 'doc-ollama-B',
        workspaceId: dummyWorkspaceB,
        uploadedById: dummyUser,
        originalName: 'ollama_doc_ws_B.pdf',
        mimeType: 'application/pdf',
        extension: 'pdf',
        sizeBytes: 1024n,
        checksum: 'cs-ollama-B',
        storageKey: 'key-6',
        status: 'COMPLETED',
        embeddingModel: 'nomic-embed-text',
        embeddingDimension: 768,
      });

      // Seed document chunks
      await db.createDocumentChunks([
        // Workspace A Chunks
        {
          id: 'chk-ollama-exp-1',
          documentId: docOllamaExplicitA.id,
          workspaceId: dummyWorkspaceA,
          chunkIndex: 0,
          content: 'Explicit Ollama chunk with high similarity',
          tokenCount: 50,
          embedding: vecHighSim,
        },
        {
          id: 'chk-ollama-null-1',
          documentId: docOllamaLegacyNullA.id,
          workspaceId: dummyWorkspaceA,
          chunkIndex: 0,
          content: 'Legacy Null Ollama chunk with medium similarity',
          tokenCount: 50,
          embedding: vecMedSim,
        },
        {
          id: 'chk-gemini-1',
          documentId: docGeminiA.id,
          workspaceId: dummyWorkspaceA,
          chunkIndex: 0,
          content: 'Gemini primary chunk with high similarity',
          tokenCount: 50,
          embedding: vecHighSim,
        },
        {
          id: 'chk-gemini-2',
          documentId: docGeminiA.id,
          workspaceId: dummyWorkspaceA,
          chunkIndex: 1,
          content: 'Gemini secondary chunk with low similarity',
          tokenCount: 50,
          embedding: vecLowSim,
        },
        {
          id: 'chk-unprocessed-1',
          documentId: docUnprocessedA.id,
          workspaceId: dummyWorkspaceA,
          chunkIndex: 0,
          content: 'Unprocessed document chunk',
          tokenCount: 50,
          embedding: vecHighSim,
        },
        // Workspace B Chunks
        {
          id: 'chk-gemini-b-1',
          documentId: docGeminiB.id,
          workspaceId: dummyWorkspaceB,
          chunkIndex: 0,
          content: 'Workspace B Gemini chunk with highest similarity',
          tokenCount: 50,
          embedding: vecHighSim,
        },
        {
          id: 'chk-ollama-b-1',
          documentId: docOllamaB.id,
          workspaceId: dummyWorkspaceB,
          chunkIndex: 0,
          content: 'Workspace B Ollama chunk',
          tokenCount: 50,
          embedding: vecHighSim,
        },
      ]);
    });

    it('Requirement 1 & 2: Ollama model filtering matches explicit nomic and legacy null docs', async () => {
      const results = await db.searchVectorChunks(dummyWorkspaceA, queryVector768, {
        embeddingModel: 'nomic-embed-text',
      });

      const returnedDocIds = results.map((r) => r.document.id);
      expect(returnedDocIds).toContain('doc-ollama-explicit-A');
      expect(returnedDocIds).toContain('doc-ollama-legacy-null-A');
      expect(returnedDocIds).not.toContain('doc-gemini-A');
    });

    it('Requirement 3 & 4: Gemini model filtering strictly includes Gemini docs and excludes NULL metadata', async () => {
      const results = await db.searchVectorChunks(dummyWorkspaceA, queryVector768, {
        embeddingModel: 'gemini-embedding-2',
      });

      const returnedDocIds = results.map((r) => r.document.id);
      expect(returnedDocIds).toContain('doc-gemini-A');
      expect(returnedDocIds).not.toContain('doc-ollama-legacy-null-A');
      expect(returnedDocIds).not.toContain('doc-ollama-explicit-A');
    });

    it('Requirement 5: Gemini vector retrieval strictly excludes Ollama documents', async () => {
      const results = await db.searchVectorChunks(dummyWorkspaceA, queryVector768, {
        embeddingModel: 'gemini-embedding-2',
      });

      for (const res of results) {
        expect(res.document.id).not.toBe('doc-ollama-explicit-A');
        expect(res.document.id).not.toBe('doc-ollama-legacy-null-A');
      }
    });

    it('Requirement 6: Unknown model identities are excluded (return zero vector results)', async () => {
      const results = await db.searchVectorChunks(dummyWorkspaceA, queryVector768, {
        embeddingModel: 'unknown-vendor-model-v99',
      });

      expect(results).toHaveLength(0);
    });

    it('Requirement 7: Workspace isolation remains strictly enforced across all model queries', async () => {
      // Query Workspace A with Gemini: Workspace B's Gemini doc must NEVER appear
      const geminiResultsA = await db.searchVectorChunks(dummyWorkspaceA, queryVector768, {
        embeddingModel: 'gemini-embedding-2',
      });
      const geminiDocIds = geminiResultsA.map((r) => r.document.id);
      expect(geminiDocIds).not.toContain('doc-gemini-B');

      // Query Workspace A with Ollama: Workspace B's Ollama doc must NEVER appear
      const ollamaResultsA = await db.searchVectorChunks(dummyWorkspaceA, queryVector768, {
        embeddingModel: 'nomic-embed-text',
      });
      const ollamaDocIds = ollamaResultsA.map((r) => r.document.id);
      expect(ollamaDocIds).not.toContain('doc-ollama-B');
    });

    it('Requirement 8: Vector distance ranking and similarity score calculation remain intact', async () => {
      const results = await db.searchVectorChunks(dummyWorkspaceA, queryVector768, {
        embeddingModel: 'gemini-embedding-2',
      });

      expect(results.length).toBeGreaterThanOrEqual(2);
      // chk-gemini-1 (vecHighSim) must rank higher than chk-gemini-2 (vecLowSim)
      expect(results[0].chunk.id).toBe('chk-gemini-1');
      expect(results[1].chunk.id).toBe('chk-gemini-2');

      // Invariants: score in [0, 1], distance >= 0
      for (const r of results) {
        expect(r.score).toBeGreaterThanOrEqual(0);
        expect(r.score).toBeLessThanOrEqual(1);
        expect(r.distance).toBeGreaterThanOrEqual(0);
      }
    });

    it('Requirement 9: Query limit (topK) remains strictly enforced', async () => {
      const results = await db.searchVectorChunks(dummyWorkspaceA, queryVector768, {
        embeddingModel: 'gemini-embedding-2',
        topK: 1,
      });

      expect(results).toHaveLength(1);
      expect(results[0].chunk.id).toBe('chk-gemini-1');
    });

    it('Requirement 10: SQL injection payload as embeddingModel is safely neutralized', async () => {
      const maliciousModel = "' OR 1=1; --";
      const results = await db.searchVectorChunks(dummyWorkspaceA, queryVector768, {
        embeddingModel: maliciousModel,
      });

      // Must not match anything and must not throw an error
      expect(results).toHaveLength(0);
    });

    it('Requirement 11: Vector-search defaults to Gemini when embeddingModel is omitted', async () => {
      // Caller provides no embeddingModel option -> defaults to Gemini
      const resultsNoModel = await db.searchVectorChunks(dummyWorkspaceA, queryVector768);

      const returnedDocIds = resultsNoModel.map((r) => r.document.id);
      expect(returnedDocIds).toContain('doc-gemini-A');
      expect(returnedDocIds).not.toContain('doc-ollama-explicit-A');
      expect(returnedDocIds).not.toContain('doc-ollama-legacy-null-A');
    });

    it('Requirement 12: Lexical retrieval (searchKeywordChunks) remains 100% model-independent', async () => {
      // searchKeywordChunks matches both Ollama and Gemini completed documents
      const kwResults = await db.searchKeywordChunks(dummyWorkspaceA, 'similarity');
      const kwDocIds = kwResults.map((r) => r.document.id);

      // Both Ollama and Gemini documents are returned because lexical search is model-agnostic
      expect(kwDocIds).toContain('doc-ollama-explicit-A');
      expect(kwDocIds).toContain('doc-ollama-legacy-null-A');
      expect(kwDocIds).toContain('doc-gemini-A');

      // Unprocessed documents are still excluded from keyword search
      expect(kwDocIds).not.toContain('doc-unprocessed-A');
      // Workspace B documents are still isolated
      expect(kwDocIds).not.toContain('doc-gemini-B');
    });
  });
});
