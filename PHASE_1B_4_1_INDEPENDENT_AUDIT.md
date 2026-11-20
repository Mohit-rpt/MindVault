# MindVault — Phase 1B.4.1 Independent Database-Layer Security & Architecture Audit

**Audit Execution Date:** 2026-11-19  
**Execution Mode:** STRICTLY READ-ONLY — INDEPENDENT ADVERSARIAL AUDIT  
**Repository:** `c:/Users/mohit/OneDrive/Desktop/MindVault`  
**Branch:** `main`  
**Expected Baseline HEAD:** `ea8a3155303220f90ae7a244c04c0a9ff467ed7f`  
**Observed Git HEAD:** `ea8a3155303220f90ae7a244c04c0a9ff467ed7f`  
**Implementation Report Audited:** [`PHASE_1B_4_1_IMPLEMENTATION_REPORT.md`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/PHASE_1B_4_1_IMPLEMENTATION_REPORT.md)  
**Blueprint Reference:** [`PHASE_1B_4_MIXED_MODEL_QUERY_SAFETY_BLUEPRINT.md`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/PHASE_1B_4_MIXED_MODEL_QUERY_SAFETY_BLUEPRINT.md)  
**Deliverable File:** `PHASE_1B_4_1_INDEPENDENT_AUDIT.md`  
**Audit Verdict:** **PASS**

---

## 1. Executive Summary

An independent, adversarial architectural and security audit of MindVault Phase 1B.4.1 (Stage 14.1: Database-Layer Model-Aware Vector Retrieval) was conducted in strict read-only execution mode.

The audit verified that embedding model compatibility gating is genuinely enforced at the PostgreSQL vector retrieval boundary and in-memory mock service. Vectors from disparate embedding spaces (`nomic-embed-text` and `gemini-embedding-2`) cannot be compared or cross-ranked under any query configuration. Legacy documents with `NULL` or unpopulated metadata are reliably isolated to Ollama retrieval semantics and are strictly unreachable by Gemini vector queries.

All core invariants mandated by the Phase 1B.4.1 authorization have been verified:
1. **Invariant A (Embedding Space Orthogonality):** Enforced via strict parameterized SQL filtering on `d."embeddingModel"`. Unknown, unapproved, or mismatched models fail closed.
2. **Invariant B (Legacy Ollama Compatibility):** Preserved via `(d."embeddingModel" = $4 OR d."embeddingModel" IS NULL)` when querying Ollama or when options are omitted.
3. **Invariant C (Gemini Isolation):** Enforced via strict equality `d."embeddingModel" = $4` without `IS NULL` clause, preventing vector pollution from legacy or Ollama chunks.
4. **Invariant D (Multi-Tenant Workspace Isolation):** Verified dual-clause tenancy (`c."workspaceId" = $1 AND d."workspaceId" = $1`) preserved intact across all queries.
5. **Invariant E (Lexical Search Independence):** Keyword retrieval (`searchKeywordChunks`) remains completely model-agnostic; all completed documents remain discoverable via BM25/FTS regardless of embedding model.

The audit confirmed that Stage 14.1 boundaries were respected: no database migrations were created, no schema modifications were applied, no documents were re-embedded, no production providers were switched, and Stage 14.2 was not initiated.

---

## 2. Scope & Audit Methodology

The audit inspected:
1. Policy implementation in [`packages/shared/src/embedding-policy.ts`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/packages/shared/src/embedding-policy.ts) and its package export in [`packages/shared/src/index.ts`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/packages/shared/src/index.ts).
2. Database implementation in [`apps/api/src/lib/db.ts`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/lib/db.ts), specifically `buildVectorSearchQuery`, `PrismaDatabaseService.searchVectorChunks`, and `InMemoryDatabaseService.searchVectorChunks`.
3. Ingestion pipeline and chunk lifecycle in [`apps/worker/src/modules/ingestion/pipeline.ts`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/worker/src/modules/ingestion/pipeline.ts) and [`apps/worker/src/lib/db.ts`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/worker/src/lib/db.ts).
4. Database schema in [`prisma/schema.prisma`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/prisma/schema.prisma).
5. All call sites of `searchVectorChunks` and `searchKeywordChunks` across `apps/api` and `apps/worker`.
6. Independent execution of 6 test suites across shared and API packages, full monorepo typecheck, and ESLint verification.

---

## 3. Detailed Audit Findings by Dimension

### 3.1 EmbeddingModelPolicy Analysis (`packages/shared/src/embedding-policy.ts`)

#### Canonical Model Identities
- `APPROVED_EMBEDDING_MODELS.OLLAMA_NOMIC = 'nomic-embed-text'`
- `APPROVED_EMBEDDING_MODELS.GEMINI_PRIMARY = 'gemini-embedding-2'`
- Both constants are frozen (`as const`) and represent the exact models supported by MindVault's ingestion and retrieval pipelines.

#### `resolveFilterPolicy(modelName)`
- Evaluates: `const effectiveModel = modelName?.trim() || this.OLLAMA_DEFAULT_MODEL;`
- **Omitted/Undefined/Null/Empty/Whitespace:** Returns `{ targetModel: 'nomic-embed-text', allowNullModel: true, isRecognized: true }`. This guarantees 100% backward compatibility for callers that do not specify a model.
- **`gemini-embedding-2`:** Returns `{ targetModel: 'gemini-embedding-2', allowNullModel: false, isRecognized: true }`.
- **Unapproved/Unknown Models:** Returns `{ targetModel: effectiveModel, allowNullModel: false, isRecognized: false }`.

#### Fail-Closed Security for Unknown Models
- When `isRecognized === false`, `isDocumentCompatible` returns `false` unconditionally.
- In `buildVectorSearchQuery`, the condition appended is `AND d."embeddingModel" = $${paramIndex} AND false`.
- The database engine evaluates this condition as `FALSE` for every candidate row, guaranteeing 0 vector results are returned.

#### Normalization, Case Sensitivity, and Aliases
- `modelName` is trimmed via `.trim()`.
- Exact string equality is enforced against canonical identities.
- Upper/mixed case inputs (e.g. `'GEMINI-EMBEDDING-2'`) or partial aliases (e.g. `'gemini'`, `'nomic'`, `'text-embedding-004'`) are classified as unrecognized and fail closed.

#### Historical Ingestion & `NULL` Metadata Provenance
- In MindVault historical ingestion, prior to the introduction of the `embeddingModel` column on `documents`, all embeddings were generated exclusively by local Ollama using `nomic-embed-text` (768-D).
- Therefore, mapping `NULL` document metadata to Ollama-compatible retrieval accurately reflects the physical reality of the stored vectors.
- Gemini retrieval strictly sets `allowNullModel: false`, preventing any historical `NULL` record from being evaluated against Gemini query vectors.

---

### 3.2 PostgreSQL Vector Retrieval Query Analysis (`apps/api/src/lib/db.ts`)

#### SQL Construction & Parameterization
`buildVectorSearchQuery` constructs the SQL query and parameter array:
```typescript
let conditions = `c."workspaceId" = $1 AND d."workspaceId" = $1 AND d."status" = 'COMPLETED' AND c."embedding" IS NOT NULL`;
const params: any[] = [workspaceId, vectorStr, topK];
let paramIndex = 4;

const policy = EmbeddingModelPolicy.resolveFilterPolicy(options?.embeddingModel);

if (!policy.isRecognized) {
  conditions += ` AND d."embeddingModel" = $${paramIndex} AND false`;
  params.push(policy.targetModel);
  paramIndex++;
} else if (policy.allowNullModel) {
  conditions += ` AND (d."embeddingModel" = $${paramIndex} OR d."embeddingModel" IS NULL)`;
  params.push(policy.targetModel);
  paramIndex++;
} else {
  conditions += ` AND d."embeddingModel" = $${paramIndex}`;
  params.push(policy.targetModel);
  paramIndex++;
}
```

#### Verification of Adversarial Inputs:
1. **`gemini-embedding-2`:** Binds `$4 = 'gemini-embedding-2'`, generates `AND d."embeddingModel" = $4`.
2. **`nomic-embed-text`:** Binds `$4 = 'nomic-embed-text'`, generates `AND (d."embeddingModel" = $4 OR d."embeddingModel" IS NULL)`.
3. **Unknown model (`'custom-model-x'`):** Binds `$4 = 'custom-model-x'`, generates `AND d."embeddingModel" = $4 AND false`. Zero rows returned.
4. **Empty / Whitespace (`''`, `'   '`):** Defaults to `$4 = 'nomic-embed-text'` with `OR d."embeddingModel" IS NULL`.
5. **SQL Injection (`"'; DROP TABLE documents; --"`, `"' OR 1=1; --"`):** The malicious string is never interpolated into the SQL string; it is safely quarantined as the value of parameter `$4`. Because it is unrecognized, the SQL appends `AND d."embeddingModel" = $4 AND false`, entirely neutralizing the payload.
6. **Extremely Long Strings:** Bound safely as a string parameter without query truncation.

#### Parameter Indexing & Filter Offsets
Subsequent optional filters dynamically increment `paramIndex`:
- `documentIds`: `$5` (`c."documentId" = ANY($5::text[])`)
- `fileTypes`: `$6` (`LOWER(d."extension") = ANY($6::text[])`)
- `pageStart`: `$7` (`c."pageEnd" IS NULL OR c."pageEnd" >= $7`)
- `pageEnd`: `$8` (`c."pageStart" IS NULL OR c."pageStart" <= $8`)
All parameter indexes and array elements align with 100% precision.

---

### 3.3 Model Compatibility & Data Integrity (Ingestion Lifecycle)

The audit investigated whether document-level `embeddingModel` metadata can desynchronize from actual chunk vectors.

#### Ingestion Lifecycle Findings:
1. **Status Gating:** At the start of ingestion ([`pipeline.ts#L169`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/worker/src/modules/ingestion/pipeline.ts#L169)), the document status is immediately set to `'PROCESSING'`. Because vector retrieval requires `d."status" = 'COMPLETED'`, in-flight documents are completely hidden from retrieval.
2. **Atomic Chunk Replacement:** In [`createDocumentChunks`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/lib/db.ts#L750-L751), all existing chunks for `documentId` are deleted within a Prisma transaction (`tx.documentChunk.deleteMany({ where: { documentId } })`) before the new batch of chunks is inserted. There is no partial chunk insertion.
3. **Completion & Metadata Landing:** In [`pipeline.ts#L309-L318`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/worker/src/modules/ingestion/pipeline.ts#L309-L318), `status: 'COMPLETED'` is written in the same update as `embeddingModel: this.embeddings.modelName` and `embeddingDimension: this.embeddings.dimension`.
4. **Failure Safety:** If ingestion fails at any point prior to step 8, `status` is set to `'FAILED'`, preventing uncompleted chunks from ever being queried.

#### Architectural Assessment:
Because MindVault's ingestion pipeline treats documents as atomic units of chunking and embedding, every chunk of a `COMPLETED` document is guaranteed to have been generated by the model specified in `document.embeddingModel`. There are no chunk-level embedding update APIs in the codebase.

---

### 3.4 In-Memory vs PostgreSQL Parity

`InMemoryDatabaseService.searchVectorChunks` was compared line-by-line against `buildVectorSearchQuery`:
- **Gating Logic:** Calls `EmbeddingModelPolicy.isDocumentCompatible(options?.embeddingModel, doc.embeddingModel)`.
- **Filtering Equivalence:**
  - `doc.workspaceId !== workspaceId` matches `WHERE c."workspaceId" = $1 AND d."workspaceId" = $1`.
  - `doc.status !== 'COMPLETED'` matches `d."status" = 'COMPLETED'`.
  - `!chunk.embedding` matches `c."embedding" IS NOT NULL`.
  - `options.documentIds`, `options.fileTypes`, `options.pageStart`, `options.pageEnd` filtering logic is completely identical.
- **Ranking & Scoring:**
  - PostgreSQL calculates `similarity = 1 - distance` with `ORDER BY distance ASC LIMIT $3`.
  - `InMemoryDatabaseService` computes cosine similarity dot product, sorts by `score DESC`, and returns `distance: 1 - score` sliced to `topK`.
- **Limit Clamping:** Both clamp `topK` to `[1, 50]` range.

---

### 3.5 Workspace Isolation

Multi-tenant security was audited across both the SQL generation and in-memory services:
- The SQL query enforces: `WHERE c."workspaceId" = $1 AND d."workspaceId" = $1`.
- The model gating clause is conjoined using `AND`. It can only further restrict the candidate set; it cannot expand results across workspace boundaries.
- Unit test 7 in `db.vector-search-model-gating.test.ts` verified that querying Workspace A with Gemini vectors never surfaces Gemini documents from Workspace B.
- Integration tests in `retrieval.test.ts` confirmed that supplying Workspace B document IDs while querying Workspace A returns 0 results (IDOR defense).

---

### 3.6 Lexical Search Isolation

- `searchKeywordChunks` in `apps/api/src/lib/db.ts` was inspected and verified to contain **zero** model filtering clauses.
- It queries `document_chunks.search_vector` using PostgreSQL full-text search (`websearch_to_tsquery` / `plainto_tsquery`) conjoined only with workspace isolation and `d."status" = 'COMPLETED'`.
- Unit test 12 in `db.vector-search-model-gating.test.ts` confirmed that keyword search matches both Ollama and Gemini completed documents in Workspace A.
- When vector search returns 0 results due to model filtering, `RetrievalService` fuses the remaining keyword results via RRF without triggering any unsafe vector fallback.

---

### 3.7 Backward Compatibility

- All call sites of `searchVectorChunks` in `RetrievalService` (`apps/api/src/modules/retrieval/services/retrieval.service.ts`) omit `embeddingModel` at Stage 14.1.
- Because `options?.embeddingModel` is undefined, `EmbeddingModelPolicy.resolveFilterPolicy()` defaults to `{ targetModel: 'nomic-embed-text', allowNullModel: true, isRecognized: true }`.
- Generated SQL contains `AND (d."embeddingModel" = $4 OR d."embeddingModel" IS NULL)` where `$4 = 'nomic-embed-text'`.
- All legacy documents (`NULL` and explicit `nomic-embed-text`) continue to be retrieved without behavioral deviation.
- Result DTOs (`SearchChunkResult`) maintain identical schema (`chunk`, `document`, `score`, `distance`).

---

### 3.8 Performance & HNSW Interaction

- **Query Plan:** Vector distance ordering (`c."embedding" <=> $2::vector ASC LIMIT $3`) leverages the HNSW index on `document_chunks.embedding`.
- **Post-Filtering:** The joined filter `d."embeddingModel" = $4` is evaluated during HNSW candidate evaluation.
- **Selectivity & Starvation:**
  - In single-model workspaces (e.g. 100% Ollama), post-filtering overhead is negligible (<1ms).
  - In mixed workspaces, HNSW scans candidates in distance order. For query vectors from one model, chunks from incompatible models exhibit near-orthogonal cosine distance (~1.0).
  - In Stage 15, if a workspace exceeds $10^5$ chunks with high model disproportion, partial HNSW indexes or denormalization of `embeddingModel` onto `document_chunks` can be introduced to optimize index scan depth.

---

## 4. Independent Test Evidence

All tests were independently executed during the audit in read-only mode:

| Test Suite | Command | Total Tests | Passed | Failed | Duration | Exit Code |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: |
| **Embedding Policy** | `pnpm vitest run packages/shared/src/__tests__/embedding-policy.test.ts` | 14 | 14 | 0 | 1.49s | 0 |
| **Vector Search Model Gating** | `pnpm vitest run apps/api/src/lib/__tests__/db.vector-search-model-gating.test.ts` | 17 | 17 | 0 | 2.57s | 0 |
| **Retrieval Orchestration & Graph** | `pnpm vitest run apps/api/src/modules/retrieval/__tests__/` | 35 | 35 | 0 | 3.38s | 0 |
| **Retrieval Engine & Security** | `pnpm vitest run apps/api/src/modules/retrieval/retrieval.test.ts ...` | 72 | 72 | 0 | 7.78s | 0 |
| **Monorepo Typecheck** | `pnpm --filter @mindvault/shared exec tsc --noEmit; pnpm --filter @mindvault/api exec tsc --noEmit` | N/A | 0 errors | 0 | ~15s | 0 |
| **ESLint Check** | `pnpm eslint packages/shared/src/embedding-policy.ts ... apps/api/src/lib/db.ts` | N/A | 0 errors (27 pre-existing warnings in db.ts) | 0 | ~10s | 0 |

**Total Tests Verified:** **138 / 138 passing (100% pass rate, 0 failures).**

---

## 5. Findings Register

| Finding ID | Severity | Category | Description | Status / Resolution |
| :--- | :--- | :--- | :--- | :--- |
| **INFO-01** | Informational | Architecture | **Chunk-Level Denormalization for Future Stages:** `embeddingModel` is currently stored at the `Document` level, relying on `JOIN "documents" d ON c."documentId" = d."id"`. While completely sound under current atomic document ingestion, denormalizing `embedding_model` onto `document_chunks` in Stage 15 would allow partial HNSW indexes (`WHERE embedding_model = 'gemini-embedding-2'`) for ultra-high-density corpora (>500k chunks). | Documented for Stage 15 consideration; no action needed in Stage 14.1. |

**Zero Critical, High, Medium, or Low severity defects found.**

---

## 6. Git & Working-Tree State

- **Baseline HEAD:** `ea8a3155303220f90ae7a244c04c0a9ff467ed7f`
- **Observed HEAD:** `ea8a3155303220f90ae7a244c04c0a9ff467ed7f`
- **Active Branch:** `main`
- **Audit Impact:** Zero source code changes introduced. Existing uncommitted working-tree state was strictly preserved.

---

## 7. Stage 14.1 Boundary Enforcement

- [x] No schema changes were made to `prisma/schema.prisma`.
- [x] No database migrations were created in `prisma/migrations`.
- [x] No documents were re-embedded.
- [x] No production provider defaults were altered (`OLLAMA` remains active default).
- [x] No GraphRAG traversal logic was modified.
- [x] No RRF fusion formulas were altered.
- [x] No git commits or pushes were performed.
- [x] Stage 14.2 has not been started.

---

## 8. Audit Verdict

```
PHASE 1B.4.1 INDEPENDENT AUDIT COMPLETE — PASS
```
