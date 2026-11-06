# MindVault — Phase 3: Repository Audit & Technical Baseline

**Date:** November 2026  
**Auditor:** Lead Backend & AI Infrastructure Engineer  
**Scope:** Architecture & Database Audit for Phase 3 (Retrieval Engine & Hybrid Search)

---

## 1. Executive Summary

MindVault has successfully completed Phase 0 (monorepo & project foundations), Phase 1 (authentication, session lifecycle, RBAC, workspace isolation), and Phase 2 (document ingestion pipeline, text extraction, chunking, 768-dimensional vector storage, and background processing).

The objective of Phase 3 is to transform MindVault from a document ingestion platform into an evidence-grounded, multi-tenant knowledge retrieval engine featuring hybrid search (semantic vector + PostgreSQL full-text search), Reciprocal Rank Fusion (RRF), extensible reranking, metadata filtering, context assembly with strict token budgeting, citation tracking, and offline retrieval evaluation.

This audit evaluates the codebase's existing infrastructure, data models, embedding contracts, database access patterns, security guarantees, and readiness for Phase 3 implementation.

---

## 2. Ingestion & Embedding Architecture

### 2.1 Current Embedding Model & Dimension

- **Embedding Provider Abstraction:** Defined in `packages/shared/src/types.ts` as `EmbeddingProvider`:
  ```typescript
  export interface EmbeddingProvider {
    readonly modelName: string;
    readonly dimension: number;
    generateEmbedding(text: string): Promise<number[]>;
    generateEmbeddings(texts: string[]): Promise<number[][]>;
  }
  ```
- **Active Model:** `nomic-embed-text` (v1.5) via Ollama (`http://localhost:11434/api/embeddings`).
- **Fixed Dimension:** Exactly **768** dimensions.
- **Test Mode Provider:** `MockEmbeddingProvider` (deterministic 768-dimensional normalized unit vector generated using SHA-256 hash seeds), enabling reproducible offline test suites with zero external network dependencies.
- **Document Chunk Embeddings:** Chunks generated during ingestion are populated with 768-dim vectors and persisted to the PostgreSQL `document_chunks` table.

### 2.2 Storage & Indexing in PostgreSQL

- **pgvector Extension:** Enabled via `CREATE EXTENSION IF NOT EXISTS vector;` in migration `20261105000001_add_documents_and_chunks`.
- **Vector Column:** `document_chunks.embedding` typed as `vector(768)`.
- **Vector Index:** Hierarchical Navigable Small World (HNSW) index using cosine distance:
  ```sql
  CREATE INDEX "document_chunks_embedding_idx"
  ON "document_chunks" USING hnsw ("embedding" vector_cosine_ops);
  ```
- **Metric:** Cosine distance (`<=>`). Cosine similarity is derived as:
  $$\text{Cosine Similarity} = 1 - (\text{embedding} \Leftrightarrow \text{query\_vector})$$

---

## 3. Data Model Audit

### 3.1 `Document` Model (`prisma/schema.prisma`)

- `id` (UUID): Primary key.
- `workspaceId` (UUID): Foreign key to `workspaces(id)` on delete cascade. Indexed.
- `uploadedById` (UUID): Foreign key to `users(id)` on delete cascade.
- `originalName` (String): Original filename (e.g. `report.pdf`).
- `mimeType` (String): e.g. `application/pdf`, `text/markdown`, etc.
- `extension` (String): e.g. `pdf`, `docx`, `txt`, `md`.
- `sizeBytes` (BigInt): File size in bytes.
- `checksum` (String): SHA-256 hash. Indexed together with `workspaceId`.
- `storageKey` (String): Disk storage path for the original binary.
- `status` (`DocumentStatus` enum: `UPLOADED`, `QUEUED`, `PROCESSING`, `COMPLETED`, `FAILED`, `DELETING`). Indexed.
- `errorMessage` (String, nullable): Error log when status is `FAILED`.
- `pageCount` (Int, nullable): Total pages extracted for paginated formats (PDF).
- `chunkCount` (Int): Total number of chunks generated.
- `embeddingModel` (String, nullable): Model identifier used to embed (e.g. `nomic-embed-text`).
- `embeddingDimension` (Int, nullable): Fixed dimension (e.g. 768).
- `metadata` (Json): Document-level metadata dictionary.
- `createdAt`, `updatedAt`, `processedAt` (Timestamps).

### 3.2 `DocumentChunk` Model (`prisma/schema.prisma`)

- `id` (UUID): Primary key.
- `documentId` (UUID): Foreign key to `documents(id)` on delete cascade. Indexed.
- `workspaceId` (UUID): Foreign key to `workspaces(id)` on delete cascade. Indexed.
- `chunkIndex` (Int): 0-indexed position within the parent document. Unique together with `documentId`.
- `content` (Text): Normalized chunk text content.
- `tokenCount` (Int): Estimated token count for context budgeting.
- `pageStart` (Int, nullable): Starting page number (1-indexed) in original document.
- `pageEnd` (Int, nullable): Ending page number (1-indexed) in original document.
- `metadata` (Json): Chunk-level metadata (heading, section, character offsets, total chunks).
- `embedding` (`Unsupported("vector(768)")?`): pgvector column.
- `createdAt` (Timestamp).

---

## 4. Multi-Tenant Security & Tenancy Boundary

### 4.1 Server-Side Context & Authorization

1. **Authentication Middleware (`authenticate.ts`):**
   - Validates Bearer JWT access token from `Authorization` header or signed cookies.
   - Attaches authenticated user (`req.user = { id, email, name }`) to Express request context.
2. **Workspace Authorization Middleware (`authorizeWorkspace.ts`):**
   - Requires role (`OWNER`, `ADMIN`, or `MEMBER`).
   - Resolves `workspaceId` from route params, query string, or request body.
   - Validates user membership in database.
   - Attaches `req.workspace = { id, name, slug, role }` to request context.
   - Denies non-members with HTTP 403 Forbidden.

### 4.2 Database-Level Tenancy Scoping

- **CRITICAL REQUIREMENT:** Vector similarity queries and keyword searches must **never** retrieve global candidate rows and filter by `workspaceId` in application memory.
- Every retrieval query must enforce `WHERE c."workspaceId" = $workspaceId` inside the SQL statement itself.
- Only documents with status `COMPLETED` may be queried. Documents in `UPLOADED`, `QUEUED`, `PROCESSING`, `FAILED`, or `DELETING` status must be excluded via `JOIN documents d ON c."documentId" = d."id" WHERE d."status" = 'COMPLETED'`.

---

## 5. Safe Raw SQL Query Capabilities

The application employs a dual database service architecture defined in `apps/api/src/lib/db.ts`:

1. **`PrismaDatabaseService` (PostgreSQL + pgvector):**
   - Safe parameterized SQL queries are executed via Prisma's `prisma.$queryRaw` and `prisma.$queryRawUnsafe`.
   - Parameterization with tagged template literals (`$queryRaw\`SELECT ... WHERE c."workspaceId" = ${workspaceId}\``) or positional `$1, $2` parameters completely eliminates SQL injection vulnerabilities.
   - Supports raw pgvector operators (`<=>`) and PostgreSQL Full-Text Search functions (`to_tsvector`, `websearch_to_tsquery`, `ts_rank_cd`).
2. **`InMemoryDatabaseService` (Test & Mock Suite):**
   - Stores documents, members, sessions, and chunks in memory.
   - Supports exact cosine similarity calculation and regex/token keyword matching, allowing unit and integration test suites to execute deterministically without external PostgreSQL daemons.
3. **Pluggable Architecture:**
   - Active database service is swappable via `setDatabaseService(service: IDatabaseService)`.

---

## 6. Gap Analysis & Phase 3 Roadmap

| Area                 | Current State (Phase 2)              | Required State (Phase 3)                                                            | Action Item                                                                                                    |
| :------------------- | :----------------------------------- | :---------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------- |
| **Query Embedding**  | Exists in worker for document chunks | Required in API service for search queries                                          | Implement query embedding generation in `apps/api/src/modules/retrieval/embeddings/` using `EmbeddingProvider` |
| **Query Processing** | Basic string trim                    | Normalization, sanitization, length bounds, token extraction                        | Create `apps/api/src/modules/retrieval/query/query.processor.ts`                                               |
| **Full-Text Search** | None                                 | PostgreSQL English FTS with GIN index and `websearch_to_tsquery`                    | Add migration `20261106000000_add_full_text_search` with functional GIN index                                  |
| **Vector Search**    | Vector insertion only                | Parameterized cosine similarity vector search with metadata filters                 | Implement `searchVectorChunks` in `IDatabaseService`                                                           |
| **Hybrid Fusion**    | None                                 | Reciprocal Rank Fusion ($k=60$) combining vector and FTS ranks                      | Create `apps/api/src/modules/retrieval/fusion/rrf.fusion.ts`                                                   |
| **Reranking**        | None                                 | Extensible `RerankerProvider` abstraction with fallback                             | Create `apps/api/src/modules/retrieval/reranking/` with `NoOpRerankerProvider`                                 |
| **Context Assembly** | None                                 | Structured context builder with token-budget capping and deduplication              | Create `apps/api/src/modules/retrieval/context/context.assembler.ts`                                           |
| **Citations**        | Raw metadata                         | Stable identifiers (`[S1]`, `[S2]`) with document name, page, and chunk details     | Implement source attribution in context assembler and search results                                           |
| **Evaluation**       | None                                 | Offline IR evaluation suite (`Precision@K`, `Recall@K`, `MRR`, `nDCG@K`)            | Create `apps/api/src/modules/retrieval/evaluation/` and `pnpm retrieval:evaluate`                              |
| **Search UI**        | Document library only                | Interactive search bar, mode selector (Hybrid/Semantic/Keyword), results, citations | Create `apps/web/src/components/search/` and integrate into `WorkspaceDashboard.tsx`                           |

---

## 7. Audit Conclusion

The repository is healthy, strictly typed, has 80/80 passing tests, clean workspace isolation, and a solid database abstraction layer. Phase 3 can proceed without disrupting existing Phase 0–2 infrastructure.
