# MindVault Phase 6.6 — Task 6.6.2.2 Architecture & Implementation Readiness Audit

**Milestone:** Phase 6.6 — GraphRAG Retrieval  
**Task:** 6.6.2.2 — Graph Retrieval Channel Service (`GraphRetrievalService`) & `RetrievalService` Integration  
**Mode:** STRICT READ-ONLY ARCHITECTURE AUDIT  
**Implementation Authorization:** NOT GRANTED  
**Date:** 2026-11-09  
**Auditor:** Independent Architecture & Retrieval System Auditor  
**Deliverable:** `PHASE_6_6_2_2_READINESS_AUDIT.md`

---

## 1. Executive Summary

This architecture and implementation-readiness audit examines the codebase to establish the exact design, data flow, failure semantics, and verification plan for **Task 6.6.2.2: Graph Retrieval Channel Service (`GraphRetrievalService`) & `RetrievalService` Integration**.

The audit was conducted in **strict read-only mode**; zero application code, configuration files, database schemas, migrations, or existing unit/integration tests were modified.

### Final Readiness Verdict: **READY WITH CONDITIONS**

The codebase is technically, architecturally, and operationally prepared for Task 6.6.2.2. The readiness conditions are strictly specified and validated below:

1. **Foundation Verified (Task 6.6.2.1 Complete):** The pure Reciprocal Rank Fusion engine ([`apps/api/src/modules/retrieval/fusion/rrf.fusion.ts`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/modules/retrieval/fusion/rrf.fusion.ts)) is fully implemented and tested with 28 passing unit tests. It natively accepts three channels (`semantic`, `keyword`, `graph`), preserves graph provenance metadata, suppresses intra-channel duplicates, and enforces 4-tier deterministic tie-breaking.
2. **Repository Baseline Intact (Task 6.6.1 Complete):** The SQL repository queries ([`buildSeedDiscoveryQuery`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/modules/graph/queries/graph-retrieval.sql.ts#L16-L110), [`buildGraphEvidenceQuery`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/modules/graph/queries/graph-retrieval.sql.ts#L127-L360)) and repository methods ([`discoverEntitySeeds`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/modules/graph/repositories/graph.repository.ts#L493-L515), [`searchGraphEvidence`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/modules/graph/repositories/graph.repository.ts#L517-L577)) are verified with 312 passing graph module tests.
3. **Condition A (Shared Schema Extension):** Extend [`RetrievalModeEnum`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/packages/shared/src/types.ts#L286) to include `'graph'` and `'graphrag'`, and [`SearchTimingMetadata`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/packages/shared/src/types.ts#L358-L368) to include `graphSearchMs` and `graphSeedDiscoveryMs`.
4. **Condition B (Fail-Soft Isolation in Hybrid/GraphRAG):** Graph channel timeouts (`2500ms`) or errors in `mode === 'graphrag'` must degrade gracefully to 2-way (`semantic` + `keyword`) search with telemetry warnings, while dedicated single-mode `mode === 'graph'` must fail-hard (throw HTTP 504 / 500).
5. **Condition C (Shared Vector Generation):** `RetrievalService` must generate the 768-dimensional query vector exactly once per query and pass it concurrently to Channel 1 (Vector Search) and Channel 3 (Semantic Seed Discovery), eliminating duplicate embedding overhead.

---

## 2. Existing Architecture Findings

### 2.1 Existing `RetrievalService` Orchestration

- **Location:** [`apps/api/src/modules/retrieval/services/retrieval.service.ts`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/modules/retrieval/services/retrieval.service.ts#L21-L196)
- **Current Lifecycle:**
  1. _Query Processing:_ [`QueryProcessor.process(request.query)`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/modules/retrieval/query/query.processor.ts#L65-L125) validates query length (1–1000 characters), normalizes Unicode (NFKC), collapses whitespace, and extracts alphanumeric terms and exact quoted phrases.
  2. _Channel 1 (Semantic):_ When `mode === 'semantic' || mode === 'hybrid'`, calls [`EmbeddingService.generateQueryVector()`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/modules/retrieval/embeddings/embedding.service.ts#L150) (768-dim vector) and executes [`dbService.searchVectorChunks()`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/lib/db.ts#L708-L766).
  3. _Channel 2 (Keyword):_ When `mode === 'keyword' || mode === 'hybrid'`, executes [`dbService.searchKeywordChunks()`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/lib/db.ts#L792-L850).
  4. _Fusion:_ Calls [`ReciprocalRankFusion.fuse(semanticResults, keywordResults, { topK })`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/modules/retrieval/fusion/rrf.fusion.ts#L471) or maps single-mode candidates.
  5. _Reranking:_ Optional top-N reranking via [`RerankerService.rerankCandidates()`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/modules/retrieval/reranking/reranker.service.ts#L140).
  6. _Context Assembly:_ Optional context assembly via [`ContextAssembler.assemble()`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/modules/retrieval/context/context.assembler.ts#L62-L138) with token budgeting and citations.
  7. _DTO Mapping:_ Maps fused candidates to [`SearchResultItem[]`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/packages/shared/src/types.ts#L322-L336).

### 2.2 Semantic Vector Search Implementation

- **Location:** [`apps/api/src/lib/db.ts#L708-L766`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/lib/db.ts#L708-L766)
- **Substrate:** PostgreSQL `pgvector` with cosine distance operator `<=>`.
- **Query Filter Invariants:**
  ```sql
  WHERE c."workspaceId" = $1
    AND d."workspaceId" = $1
    AND d."status" = 'COMPLETED'
    AND c."embedding" IS NOT NULL
  ```
- **Similarity Scoring:** `similarity = 1 - (c."embedding" <=> $2::vector)` (clamped to $[0.0, 1.0]$).
- **Candidate Bound:** `LIMIT $3` (clamped $[1, 50]$).

### 2.3 Sparse Lexical Search Implementation

- **Location:** [`apps/api/src/lib/db.ts#L792-L850`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/lib/db.ts#L792-L850)
- **Substrate:** PostgreSQL Full-Text Search with `tsvector` on `c."search_vector"`.
- **Query Filter Invariants:**
  ```sql
  WHERE c."workspaceId" = $1
    AND d."workspaceId" = $1
    AND d."status" = 'COMPLETED'
    AND (
      c."search_vector" @@ websearch_to_tsquery('english', $2)
      OR c."search_vector" @@ plainto_tsquery('english', $2)
    )
  ORDER BY "rankScore" DESC
  LIMIT $3
  ```
- **Rank Scoring:** `ts_rank_cd(c."search_vector", websearch_to_tsquery('english', $2))`.

### 2.4 Phase 6.6.1 Graph Evidence Repository Baseline

- **Location:** [`apps/api/src/modules/graph/repositories/graph.repository.ts#L493-L577`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/modules/graph/repositories/graph.repository.ts#L493-L577)
- **Interface:** [`IGraphRepository`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/modules/graph/repositories/graph.repository.interface.ts#L103-L147)
- **Two-Stage Retrieval Architecture:**
  1. **Stage 1: Seed Discovery (`discoverEntitySeeds`):**
     - SQL Builder: [`buildSeedDiscoveryQuery`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/modules/graph/queries/graph-retrieval.sql.ts#L16-L110).
     - Matches lexical canonical names ($1.0$), aliases ($0.95$), and semantic embeddings ($\ge 0.70$).
     - Deduplicates matches via `DISTINCT ON ("entityId")` and re-orders globally by `seedScore DESC, canonicalName ASC, entityId ASC LIMIT maxSeeds`.
     - Parameter bound: $S \le 5$ seeds.
  2. **Stage 2: Bounded Graph Evidence Expansion (`searchGraphEvidence`):**
     - SQL Builder: [`buildGraphEvidenceQuery`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/modules/graph/queries/graph-retrieval.sql.ts#L127-L360).
     - Anchor member: Depth 1 relations capped at `LIMIT 50`.
     - Frontier member: Top 10 deduplicated parents by salience, expanding up to 10 lateral relations each (max 100 recursive relations).
     - Intermediate bound: Hard `LIMIT 150` on `deduplicated_relations` before joining evidence tables.
     - Evidence streams: Strategy 1 (`relation_evidence`) + Strategy 2 (`chunk_entity_mentions`).
     - Evidence deduplication: Groups by chunk identity tuple before scoring to prevent duplicate evidence inflation.
     - Closed-form score: $\min(1.0, 0.8 \cdot S_{\max} + 0.2 \sum S_i) \in [0.0, 1.0]$.
     - Tenant and document bounds: Enforces `workspace_id = $1` on all 7 tables and `d.status = 'COMPLETED'`.
     - Execution time: 1.86 ms in PostgreSQL 16 (0 disk spills).
  3. **Statement Timeout:** Wrapped in Prisma interactive transaction with `SET LOCAL statement_timeout = '2500ms'`, mapping SQLSTATE `57014` to [`GraphTraversalTimeoutError`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/modules/graph/errors/graph-traversal.error.ts#L3).

### 2.5 Phase 6.6.2.1 RRF Fusion Engine & Public Interfaces

- **Location:** [`apps/api/src/modules/retrieval/fusion/rrf.fusion.ts`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/modules/retrieval/fusion/rrf.fusion.ts)
- **Public API:**
  ```typescript
  export class ReciprocalRankFusion {
    public static fuseChannels(
      channels: ThreeChannelInput,
      options?: FusionOptions,
    ): FusedCandidate[];

    public static fuse(
      semanticResults: Array<SearchChunkResult | NormalizedCandidate>,
      keywordResults: Array<SearchChunkResult | NormalizedCandidate>,
      graphOrOptions?:
        Array<RawGraphChunkRow | SearchChunkResult | NormalizedCandidate> | FusionOptions,
      options?: FusionOptions,
    ): FusedCandidate[];
  }
  ```
- **Engine Capabilities:**
  - Standard formula: $\text{RRF}(d) = \sum_{m} \mathbb{I}(d \in \mathcal{R}_m) \cdot \frac{w_m}{k + r_m(d)}$ ($k=60$).
  - Universal input adapter [`extractCandidate()`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/modules/retrieval/fusion/rrf.fusion.ts#L98-L206) handles [`SearchChunkResult`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/lib/db.ts#L91), [`RawGraphChunkRow`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/packages/shared/src/types.ts#L1141), and [`NormalizedCandidate`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/modules/retrieval/fusion/rrf.fusion.ts#L36).
  - Intra-channel deduplication tracks `seenInThisChannel = new Set<string>()`.
  - Provenance preservation: Merges `supportedRelationIds`, `relationTypes`, and `graphRelations` deterministically via Sets/Maps.
  - Four-tier tie-breaking: `rrfScore DESC` $\to$ `retrievalSources.length DESC` $\to$ `chunkIndex ASC` $\to$ `chunkId ASC` (UTF-16 code point comparison).

### 2.6 Graph Database Models and Relationships

- **Location:** [`prisma/schema.prisma#L249-L362`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/prisma/schema.prisma#L249-L362)
- Participating Models:
  1. `GraphEntity` (`graph_entities`): Contains `id`, `workspaceId`, `canonicalName`, `normalizedName`, `entityType`, `embedding (vector(768))`.
  2. `GraphEntityAlias` (`graph_entity_aliases`): Contains `id`, `workspaceId`, `entityId`, `alias`, `normalizedAlias`.
  3. `GraphRelation` (`graph_relations`): Contains `id`, `workspaceId`, `sourceEntityId`, `targetEntityId`, `relationType`, `weight`, `confidence`.
  4. `ChunkEntityMention` (`chunk_entity_mentions`): Links `chunkId`, `entityId`, `workspaceId`, `mentionText`.
  5. `RelationEvidence` (`relation_evidence`): Links `relationId`, `chunkId`, `documentId`, `workspaceId`, `confidence`.
  6. `DocumentChunk` (`document_chunks`): Source passages with `workspaceId`, `documentId`, `chunkIndex`, `content`.
  7. `Document` (`documents`): Source files with `workspaceId`, `status`, `originalName`, `extension`.
- Foreign key cascade: Every record cascades from `Workspace`, guaranteeing complete multi-tenant physical containment.

### 2.7 Dependency Injection and Module Registration Patterns

- In the retrieval module, core services use static dispatch facades (`RetrievalService`, `QueryProcessor`, `EmbeddingService`, `ReciprocalRankFusion`, `ContextAssembler`, `RerankerService`).
- In the graph module, [`GraphTraversalService`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/modules/graph/services/graph-traversal.service.ts#L51) uses constructor dependency injection with default fallback:
  ```typescript
  constructor(private readonly graphRepo: IGraphRepository = graphRepository) {}
  ```
- In database abstraction, [`dbService: IDatabaseService`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/lib/db.ts#L1976) allows swapping between `PrismaDatabaseService` and `InMemoryDatabaseService` via `setDatabaseService()`.

### 2.8 Authorization, Workspace Isolation, and Document Filtering

- **HTTP Layer:** [`authorizeWorkspace('MEMBER')`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/middleware/authorizeWorkspace.ts) middleware resolves workspace membership and attaches `req.workspaceMember`.
- **Controller Layer:** [`RetrievalController.search`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/modules/retrieval/retrieval.controller.ts#L7-L51) strictly extracts `workspaceId` and validates payload with [`SearchRequestSchema`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/packages/shared/src/types.ts#L307).
- **Service Layer:** `workspaceId` is threaded to all database operations.
- **SQL Layer:** Tenancy is physically enforced at every join (`workspace_id = $1`).
- **Document Status:** Only documents with `status = 'COMPLETED'` are visible in all 3 channels.

### 2.9 Existing Retrieval DTOs and Shared Types

- **Location:** [`packages/shared/src/types.ts#L286-L370`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/packages/shared/src/types.ts#L286-L370)
- `RetrievalModeEnum`: Currently `z.enum(['hybrid', 'semantic', 'keyword'])`.
- `SearchRequestSchema`: Validates `query`, `mode`, `topK` ($[1, 50]$), `includeContext`, `maxContextTokens`, `filters`, `enableReranking`.
- `SearchResultItem`: Standard item containing `chunkId`, `documentId`, `documentName`, `content`, `chunkIndex`, `rank`, `score`, `retrievalSources` (`Array<'semantic' | 'keyword' | 'graph'>`), `citationId`, `metadata`.
- `SearchTimingMetadata`: Records `queryProcessingMs`, `embeddingGenerationMs`, `semanticSearchMs`, `keywordSearchMs`, `fusionMs`, `rerankingMs`, `contextAssemblyMs`, `totalMs`.

### 2.10 Error Handling, Timeouts, and Logging Conventions

- **Errors:** Handled through [`AppError`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/middleware/errorHandler.ts#L5) base class with `statusCode`, `code`, and `message`.
- **Timeouts:** Graph queries enforce `2500ms` via `SET LOCAL statement_timeout = '2500ms'`, throwing [`GraphTraversalTimeoutError`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/modules/graph/errors/graph-traversal.error.ts#L3) (HTTP 504).
- **Logging:** Structured `console.warn` / `console.error` with bracketed log prefixes (`[ERROR] [CODE]`, `[WARN] [GRAPH_RETRIEVAL]`).

---

## 3. Proposed `GraphRetrievalService` Architecture

### 3.1 Service Responsibilities

`GraphRetrievalService` coordinates Channel 3 retrieval across two distinct sequential stages:

1. **N-Gram Generation & Lexical Normalization:**
   - Decomposes the user search query into candidate entity n-grams (1-gram, 2-gram, 3-gram).
   - Incorporates exact quoted phrases from `QueryProcessor.process(query).exactPhrases`.
   - Incorporates normalized query string.
   - Normalizes each candidate n-gram through [`EntityNormalizer.normalize(gram)`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/modules/graph/normalizers/entity.normalizer.ts#L117).
   - Deduplicates and bounds the n-gram array (max 25 n-grams) to prevent oversized SQL queries.
2. **Stage 1 — Seed Entity Discovery:**
   - Calls `this.graphRepo.discoverEntitySeeds({ workspaceId, ngrams, queryVector, maxSeeds: 5 })`.
   - If 0 seeds are discovered: Immediately returns empty output (`{ chunks: [], relations: [], seeds: [] }`) with recorded timings. Does **not** throw an error.
3. **Stage 2 — Bounded Graph Evidence Expansion:**
   - If $\ge 1$ seeds are discovered: Calls `this.graphRepo.searchGraphEvidence({ workspaceId, seedEntityIds, topK, minConfidence: 0.6, minWeight: 0.5 })`.
   - Receives `GraphEvidenceQueryResult` containing `chunks: RawGraphChunkRow[]` and `relations: RawGraphRelationRow[]`.
4. **Post-Query In-Memory Filtering:**
   - If caller supplies `request.filters` (`documentIds`, `fileTypes`, `pageStart`, `pageEnd`): Filters the returned `RawGraphChunkRow[]` in-memory.
   - Preserves filter semantics identical to vector and keyword search without mutating Task 6.6.1 SQL queries.
5. **Telemetry & Timings:**
   - Accurately measures and returns `seedDiscoveryMs` and `evidenceTraversalMs`.

### 3.2 Service Contracts & Types

```typescript
export interface GraphRetrievalOptions {
  topK?: number;
  queryVector?: number[];
  terms?: string[];
  exactPhrases?: string[];
  filters?: {
    documentIds?: string[];
    fileTypes?: string[];
    pageStart?: number;
    pageEnd?: number;
  };
  minConfidence?: number;
  minWeight?: number;
}

export interface GraphRetrievalOutput {
  chunks: RawGraphChunkRow[];
  relations: RawGraphRelationRow[];
  seeds: DiscoveredSeedEntity[];
  timings: {
    seedDiscoveryMs: number;
    evidenceTraversalMs: number;
    totalGraphMs: number;
  };
}
```

### 3.3 Class Definition & Dependency Injection

```typescript
export class GraphRetrievalService {
  constructor(private readonly graphRepo: IGraphRepository = graphRepository) {}

  public async retrieveChunks(
    workspaceId: string,
    query: string,
    options?: GraphRetrievalOptions,
  ): Promise<GraphRetrievalOutput>;

  // Static convenience facade delegating to singleton
  public static async retrieveChunks(
    workspaceId: string,
    query: string,
    options?: GraphRetrievalOptions,
  ): Promise<GraphRetrievalOutput>;
}

export const graphRetrievalService = new GraphRetrievalService();
```

---

## 4. Dependency and Data-Flow Diagrams

### 4.1 System Component Dependencies

```
┌────────────────────────────────────────────────────────────────────────┐
│                        RetrievalController                             │
│                  POST /api/retrieval/search                            │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                         RetrievalService                               │
│                   Pipeline Orchestration Core                          │
└───────┬───────────────────┬────────────────────┬───────────────────┬───┘
        │                   │                    │                   │
        ▼                   ▼                    ▼                   ▼
┌───────────────┐   ┌───────────────┐   ┌─────────────────┐ ┌────────────────┐
│QueryProcessor │   │EmbeddingServ. │   │DatabaseService  │ │GraphRetrieval- │
│Normalization  │   │768-dim Vector │   │Vector & Keyword │ │Service (NEW)   │
└───────────────┘   └───────┬───────┘   └─────────────────┘ └────────┬───────┘
                            │ (shared queryVector)                   │
                            └────────────────────────────────────────┘
                                                                     │
                                                                     ▼
                                                            ┌────────────────┐
                                                            │GraphRepository │
                                                            │Seeds & Evidence│
                                                            └────────────────┘
```

### 4.2 Three-Way Concurrency & Data Flow (`mode: 'graphrag'`)

```
                         User Query + WorkspaceID
                                    │
                                    ▼
                         QueryProcessor.process()
                                    │
                                    ▼
                    EmbeddingService.generateQueryVector()
                        (Produces 768-dim queryVector)
                                    │
                    ┌───────────────┼───────────────┐
                    │               │               │
                    ▼               ▼               ▼
            Channel 1 (Vector) Channel 2 (Keyword) Channel 3 (Graph)
            dbService.         dbService.          GraphRetrievalService.
            searchVectorChunks searchKeywordChunks retrieveChunks
            (queryVector)      (keywordQuery)      (ngrams + queryVector)
                    │               │               │
                    │               │               ▼
                    │               │       Stage 1: Seeds (S <= 5)
                    │               │               │
                    │               │       Stage 2: 2-Hop Evidence
                    │               │               │
                    ▼               ▼               ▼
            Vector Chunks      Keyword Chunks   Graph Chunks + Relations
                    │               │               │
                    └───────────────┼───────────────┘
                                    ▼
                    ReciprocalRankFusion.fuseChannels()
                     - Deduplicate intra-channel
                     - 3-Way RRF: w / (60 + rank)
                     - Preserve graph provenance
                     - 4-Tier Tie-Breaking
                                    │
                                    ▼
                        Fused Top-K Candidates
                                    │
                                    ▼
                         ContextAssembler & DTO
```

---

## 5. Exact Implementation Scope for Task 6.6.2.2

### 5.1 Modified Files

1. **`packages/shared/src/types.ts`:**
   - Update `RetrievalModeEnum` to:
     ```typescript
     export const RetrievalModeEnum = z.enum([
       'hybrid',
       'semantic',
       'keyword',
       'graph',
       'graphrag',
     ]);
     ```
   - Update `SearchTimingMetadata` to include:
     ```typescript
     graphSearchMs?: number;
     graphSeedDiscoveryMs?: number;
     ```
   - Rebuild `@mindvault/shared`.
2. **`apps/api/src/modules/retrieval/services/retrieval.service.ts`:**
   - Import `GraphRetrievalService`.
   - Update `executeSearch` to support `mode: 'graph'` and `mode: 'graphrag'`.
   - Single query vector generation shared between Channel 1 and Channel 3.
   - Concurrent dispatch via `Promise.all` with fail-soft isolation in `graphrag` mode.
   - Delegate fusion to `ReciprocalRankFusion.fuseChannels()`.
   - Map graph provenance to `SearchResultItem.metadata.graph`.
   - Populate fine-grained telemetry timings.

### 5.2 New Files

1. **`apps/api/src/modules/retrieval/services/graph-retrieval.service.ts`:**
   - Implements `GraphRetrievalService` with n-gram generation, seed discovery, evidence traversal, in-memory filtering, and timing tracking.
2. **`apps/api/src/modules/retrieval/services/graph-retrieval.service.test.ts`:**
   - Dedicated unit tests for `GraphRetrievalService` with mock `IGraphRepository`.
3. **`apps/api/src/modules/retrieval/__tests__/retrieval.orchestration.test.ts`:**
   - Comprehensive orchestration tests for `RetrievalService` across all 5 modes (`semantic`, `keyword`, `hybrid`, `graph`, `graphrag`), concurrency, failure isolation, and telemetry.

---

## 6. Explicit Out-of-Scope Items

To guarantee stability and prevent scope creep, the following are strictly **PROHIBITED** from Task 6.6.2.2:

- **NO Task 6.6.1 modifications:** Do NOT edit SQL query builders in `graph-retrieval.sql.ts` or repository methods in `graph.repository.ts`.
- **NO Phase 6.5 traversal modifications:** Do NOT edit traversal routes, controllers, or services in `modules/graph/`.
- **NO Database migrations:** Zero changes to `prisma/schema.prisma` or migration files.
- **NO RRF reimplementation:** Do NOT alter the core mathematical logic or tie-breaking in `rrf.fusion.ts`.
- **NO Downstream generation changes:** Do NOT edit `rag.service.ts` or `conversation-rag.service.ts` (deferred to Task 6.6.3).
- **NO Evaluation harness execution:** Do NOT run the 25-query benchmark evaluation (deferred to Task 6.6.4).
- **NO Additional third-party dependencies:** Use only existing packages.

---

## 7. Failure-Handling Strategy

A failure in one retrieval channel must never silently produce misleading results. The architecture implements the following deterministic failure matrix:

| Failure Scenario                                 | Mode = `graphrag` Behavior                                                                                                                           | Single-Mode Behavior (`semantic`, `keyword`, `graph`) | User-Facing Impact                                                         |
| :----------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------- | :------------------------------------------------------------------------- |
| **Graph Traversal Timeout (`57014` / `2500ms`)** | Catches `GraphTraversalTimeoutError`, logs warning, records `graphError: 'TIMEOUT'` in telemetry, fuses remaining channels (`semantic` + `keyword`). | Throws HTTP 504 `GraphTraversalTimeoutError`.         | Degraded 2-way search response in `graphrag`; structured error in `graph`. |
| **Graph Repository Execution Failure**           | Catches error, logs structured warning, records `graphError: 'FAILED'` in telemetry, fuses remaining channels (`semantic` + `keyword`).              | Throws HTTP 500 `InternalServerError`.                | Degraded 2-way search response in `graphrag`; structured error in `graph`. |
| **Zero Discovered Seeds (Natural Empty)**        | Returns `{ chunks: [], relations: [], seeds: [] }` without error, fuses remaining channels.                                                          | Returns HTTP 200 with `results: []`.                  | Valid empty results or vector/keyword results.                             |
| **Zero Evidence Chunks (Natural Empty)**         | Returns `{ chunks: [], relations: [], seeds }` without error, fuses remaining channels.                                                              | Returns HTTP 200 with `results: []`.                  | Valid search response.                                                     |
| **Vector Search Failure**                        | Catches error, logs warning, records `vectorError: 'FAILED'`, fuses remaining channels (`keyword` + `graph`).                                        | Throws HTTP 500 `InternalServerError`.                | Degraded search response.                                                  |
| **Lexical Search Failure**                       | Catches error, logs warning, records `keywordError: 'FAILED'`, fuses remaining channels (`semantic` + `graph`).                                      | Throws HTTP 500 `InternalServerError`.                | Degraded search response.                                                  |
| **All Active Channels Fail**                     | All active channels fail $\implies$ Throws HTTP 500 `RetrievalPipelineError`.                                                                        | Throws corresponding HTTP error.                      | Structured error envelope (zero false empty results).                      |
| **Embedding Generation Failure**                 | Cannot produce query vector $\implies$ Throws HTTP 500 / 503 `EmbeddingServiceError`.                                                                | Throws HTTP 500 / 503 `EmbeddingServiceError`.        | Structured error envelope.                                                 |

### Architectural Justification for Fail-Soft `graphrag`:

In `graphrag` mode, user satisfaction relies on obtaining relevant search results quickly. If the graph subsystem experiences a timeout or transient failure, vector and keyword search provide strong, immediate fallback content. A degraded response with a recorded warning is far superior to dropping the user's entire search/chat interaction with a 500/504 error. Conversely, if a client explicitly requests `mode: 'graph'`, they require knowledge graph evidence; returning degraded vector results would violate their explicit contract, so fail-hard (504/500) is required.

---

## 8. Security and Isolation Analysis

1. **Physical Tenancy Enforcement across All 7 Tables:**
   - Every join in `buildSeedDiscoveryQuery` and `buildGraphEvidenceQuery` validates `workspace_id = $1`.
   - Cross-workspace entities, aliases, relations, mentions, and evidence chunks return 0 rows.
2. **Document Lifecycle Isolation:**
   - Incomplete documents (`PENDING`, `PROCESSING`, `FAILED`) are strictly excluded at the SQL level via `d.status = 'COMPLETED'`.
3. **In-Memory Filter Containment:**
   - Client-provided `filterOptions` (`documentIds`, `fileTypes`, `pageStart`, `pageEnd`) are strictly enforced in-memory if not already filtered by SQL.
4. **Statement Timeout Guardrails:**
   - Connection-scoped timeout of `2500ms` inside transaction prevents slow recursive graph queries from monopolizing PostgreSQL connection pool workers.
5. **No SQL Injection Vectors:**
   - All parameters (`workspaceId`, `ngrams`, `queryVector`, `seedEntityIds`, `topK`) are passed via Prisma parameterized SQL templates (`Prisma.sql` / `$queryRaw`).

---

## 9. Comprehensive Test Matrix for Task 6.6.2.2

| Test Suite                               | File                                                                       |     Tests / Target     | Purpose                                                                                                                                                                          |
| :--------------------------------------- | :------------------------------------------------------------------------- | :--------------------: | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **GraphRetrievalService Unit Tests**     | `apps/api/src/modules/retrieval/services/graph-retrieval.service.test.ts`  |      **12 tests**      | Validates n-gram extraction, seed resolution, 0-seed handling, in-memory filtering, timing tracking, and mock repository integration.                                            |
| **RetrievalService Orchestration Tests** | `apps/api/src/modules/retrieval/__tests__/retrieval.orchestration.test.ts` |      **18 tests**      | Validates parallel dispatch, single vector generation reuse, all 5 modes (`semantic`, `keyword`, `hybrid`, `graph`, `graphrag`), telemetry recording, and fail-soft degradation. |
| **Two-Channel Backward Compatibility**   | `apps/api/src/modules/retrieval/retrieval.test.ts`                         | **Existing 12 tests**  | Verifies zero regressions for existing Phase 3 search tests.                                                                                                                     |
| **RRF Fusion Tests**                     | `apps/api/src/modules/retrieval/fusion/rrf.fusion.test.ts`                 | **Existing 28 tests**  | Verifies pure fusion engine integrity.                                                                                                                                           |
| **Graph Module Tests**                   | `apps/api/src/modules/graph/__tests__/`                                    | **Existing 312 tests** | Verifies graph traversal and repository query integrity.                                                                                                                         |
| **Typecheck & Monorepo Validation**      | `pnpm typecheck` & `pnpm lint`                                             |      **0 errors**      | Monorepo-wide static analysis across all 4 packages.                                                                                                                             |

---

## 10. Risks and Unresolved Questions

1. **Risk: N-Gram Combinatorial Explosion:**
   - _Risk:_ Very long search queries could generate dozens of n-grams, increasing SQL `ANY(ARRAY[...])` overhead.
   - _Mitigation:_ Cap n-grams to 1-gram, 2-gram, and 3-gram, filter out stop words or tokens with length $\le 1$, and take the top 25 distinct normalized n-grams.
2. **Risk: Disparate Result Sets Leading to Empty Fused Results:**
   - _Risk:_ If graph returns chunks but vector/keyword return different chunks, does RRF drop graph chunks?
   - _Mitigation:_ Verified in Phase 6.6.2.1 tests; single-channel graph chunks receive $1.0 / (60 + r)$ and are ranked appropriately.
3. **Unresolved Question: Should `RetrievalModeEnum` default remain `'hybrid'` or switch to `'graphrag'`?**
   - _Resolution:_ Default MUST remain `'hybrid'` to preserve 100% backward compatibility for existing clients. Clients wanting GraphRAG explicitly pass `mode: 'graphrag'`.

---

## 11. Recommended Implementation Sequence

Once human authorization is granted, execute Task 6.6.2.2 in the following strict order:

1. **Step 1 — Shared Schema Updates (`packages/shared/src/types.ts`):**
   - Extend `RetrievalModeEnum` to `['hybrid', 'semantic', 'keyword', 'graph', 'graphrag']`.
   - Extend `SearchTimingMetadata` to include `graphSearchMs` and `graphSeedDiscoveryMs`.
   - Build `@mindvault/shared`.
2. **Step 2 — Implement `GraphRetrievalService` (`graph-retrieval.service.ts`):**
   - Build n-gram extractor with `EntityNormalizer`.
   - Wire `discoverEntitySeeds` and `searchGraphEvidence`.
   - Add post-query in-memory filtering.
3. **Step 3 — Unit Test `GraphRetrievalService` (`graph-retrieval.service.test.ts`):**
   - Write and verify unit test suite with mock `IGraphRepository`.
4. **Step 4 — Integrate `RetrievalService` (`retrieval.service.ts`):**
   - Wire concurrent three-channel retrieval.
   - Share `queryVector` across Channel 1 and Channel 3.
   - Add fail-soft error handling in `graphrag` mode.
   - Connect `ReciprocalRankFusion.fuseChannels()`.
   - Format `SearchResultItem.metadata.graph`.
5. **Step 5 — Integration Tests (`retrieval.orchestration.test.ts`):**
   - Test all 5 modes, concurrency, fail-soft, and telemetry.
6. **Step 6 — Monorepo Regression Verification:**
   - Run `pnpm typecheck`, `pnpm lint`, and full test suites.
7. **Step 7 — Implementation Report:**
   - Author `PHASE_6_6_2_2_IMPLEMENTATION_REPORT.md`.

---

## 12. Final Readiness Verdict & Authorization Gate

### Final Verdict: **READY WITH CONDITIONS**

The architecture for Task 6.6.2.2 is completely specified, robustly isolated, and verified against all codebase dependencies.

> [!CAUTION]
>
> ### FINAL AUTHORIZATION GATE: IMPLEMENTATION NOT AUTHORIZED
>
> **Implementation authorization for Task 6.6.2.2 is currently NOT GRANTED.**  
> Zero source code modifications have been made. Awaiting explicit human approval to proceed with implementation.
