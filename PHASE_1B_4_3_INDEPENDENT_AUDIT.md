# MindVault — Phase 1B.4.3 Independent Adversarial Audit
## Embedding Provider Registry Architecture

**Audit Execution Date:** 2026-11-19  
**Execution Mode:** STRICTLY READ-ONLY — INDEPENDENT SECURITY, ARCHITECTURE & CORRECTNESS AUDIT  
**Repository:** `c:/Users/mohit/OneDrive/Desktop/MindVault`  
**Branch:** `main`  
**Expected Baseline Git HEAD:** `ea8a3155303220f90ae7a244c04c0a9ff467ed7f`  
**Observed Git HEAD:** `ea8a3155303220f90ae7a244c04c0a9ff467ed7f`  
**Implementation Report Audited:** [`PHASE_1B_4_3_IMPLEMENTATION_REPORT.md`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/PHASE_1B_4_3_IMPLEMENTATION_REPORT.md)  
**Approved Blueprint Reference:** [`PHASE_1B_4_MIXED_MODEL_QUERY_SAFETY_BLUEPRINT.md`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/PHASE_1B_4_MIXED_MODEL_QUERY_SAFETY_BLUEPRINT.md) (§14.3)  
**Accepted Previous Stages:**
- Phase 1B.4.1 — Database Layer Model-Aware Vector Retrieval — PASS ([`PHASE_1B_4_1_INDEPENDENT_AUDIT.md`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/PHASE_1B_4_1_INDEPENDENT_AUDIT.md))
- Phase 1B.4.2 — Retrieval Service Integration & Mixed-Model Query Safety — PASS ([`PHASE_1B_4_2_INDEPENDENT_AUDIT.md`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/PHASE_1B_4_2_INDEPENDENT_AUDIT.md))  
**Deliverable File:** `PHASE_1B_4_3_INDEPENDENT_AUDIT.md`  
**Audit Verdict:** **PASS**

---

## 1. Executive Summary

An independent, adversarial architecture, security, and correctness audit of MindVault Phase 1B.4.3 (Stage 14.3: Embedding Provider Registry Architecture) was performed in strict read-only execution mode.

The audit verified that the implementation matches the approved blueprint specifications for Stage 14.3:
1. **Centralized Provider Registry:** [`EmbeddingProviderRegistry`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/modules/retrieval/embeddings/embedding-provider.registry.ts) centralizes registration, introspection, and resolution of embedding providers with canonical identifiers (`'ollama'`, `'gemini'`, `'mock'`).
2. **Deterministic & Safe Registration:** Duplicate provider registrations without `override: true` are rejected with `DuplicateEmbeddingProviderError`, preventing silent runtime provider hijacking.
3. **Fail-Closed Resolution:** Unapproved or unknown provider IDs immediately throw `UnsupportedEmbeddingProviderError`, strictly preventing silent fallbacks to default providers.
4. **Production Defaults Preserved:** When `EMBEDDING_PROVIDER` is unset or omitted, the system defaults to Ollama (`nomic-embed-text`) in production and development environments.
5. **Mock Isolation Enforced:** `MockEmbeddingProvider` is guarded with an explicit runtime check that throws an error if resolved when `NODE_ENV === 'production'`.
6. **Decoupled Configuration:** `EMBEDDING_PROVIDER` was added to [`apps/api/src/config/env.ts`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/config/env.ts) with `default('ollama')`, decoupling LLM text generation (`LLM_PROVIDER`) from embedding retrieval.
7. **Authoritative Compatibility Wiring:** [`EmbeddingService.validateCompatibility()`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/modules/retrieval/embeddings/embedding.service.ts) was successfully wired to [`EmbeddingModelPolicy.isDocumentCompatible()`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/packages/shared/src/embedding-policy.ts).
8. **Strict Stage Boundaries Maintained:** Stage 14.4 (worker ingestion registration) was **not** touched. Zero schema changes or migrations occurred. No production ingestion switches, bulk re-embedding, or GraphRAG modifications were introduced.

---

## 2. Mandatory Pre-Audit Verification

Prior to inspecting implementation details, repository state and git invariants were verified:

1. **Repository Root:** `c:/Users/mohit/OneDrive/Desktop/MindVault`
2. **Active Branch:** `main`
3. **Git HEAD SHA:** `ea8a3155303220f90ae7a244c04c0a9ff467ed7f` (matches expected baseline exactly)
4. **Git Working-Tree Inspection:**
   - **Staged Changes:** None (`git diff --cached` returned empty).
   - **Unstaged Changes:** Strictly limited to authorized Stage 14.3 files (`apps/api/src/config/env.ts`, `apps/api/src/modules/retrieval/embeddings/embedding.service.ts`) alongside pre-existing uncommitted Phase 1B files.
   - **Untracked Files:**
     - `apps/api/src/modules/retrieval/embeddings/embedding-provider.registry.ts`
     - `apps/api/src/modules/retrieval/__tests__/embedding-provider.registry.test.ts`
     - `PHASE_1B_4_3_IMPLEMENTATION_REPORT.md`
     - Pre-existing Phase 1B test and report artifacts.
   - **Commits Created:** 0 (zero git commits created).
5. **Document Verification:** Read and reviewed `PHASE_1B_4_3_IMPLEMENTATION_REPORT.md`, `PHASE_1B_4_MIXED_MODEL_QUERY_SAFETY_BLUEPRINT.md`, `PHASE_1B_4_1_IMPLEMENTATION_REPORT.md`, `PHASE_1B_4_1_INDEPENDENT_AUDIT.md`, `PHASE_1B_4_2_IMPLEMENTATION_REPORT.md`, and `PHASE_1B_4_2_INDEPENDENT_AUDIT.md`.

---

## 3. Blueprint Compliance & Scope Analysis

The approved blueprint ([`PHASE_1B_4_MIXED_MODEL_QUERY_SAFETY_BLUEPRINT.md`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/PHASE_1B_4_MIXED_MODEL_QUERY_SAFETY_BLUEPRINT.md) §14.3) defines Stage 14.3:
> **Stage 14.3: Provider Registry & Dynamic Query Provider Selection**  
> - **Scope:** Update `EmbeddingService` (`apps/api/src/modules/retrieval/embeddings/embedding.service.ts`) to support selecting between Ollama, Gemini, and Mock providers based on environment configuration (`EMBEDDING_PROVIDER`), while preserving Ollama as the default.  
> - **Files Expected to Change:** `apps/api/src/modules/retrieval/embeddings/embedding.service.ts`, `apps/api/src/config/env.ts`  
> - **Tests Required:** Unit tests verifying provider instantiation based on `EMBEDDING_PROVIDER`, and wiring `validateCompatibility` to active provider metadata.  
> - **Acceptance Criteria:** `EMBEDDING_PROVIDER=gemini` initializes `GeminiEmbeddingProvider`; unset or `ollama` initializes `OllamaEmbeddingProvider`. In test mode (`NODE_ENV === 'test'`), defaults to `MockEmbeddingProvider`.

### Scope Compliance Matrix:

| Planned Item | Blueprint Authorization | Actual Implementation | Verdict |
| :--- | :--- | :--- | :--- |
| **Provider Registry Abstraction** | Authorized (§14.3) | `EmbeddingProviderRegistry` class in `embedding-provider.registry.ts` | **COMPLIANT** |
| **Canonical Provider Identifiers** | Authorized (§14.3) | `'ollama'`, `'gemini'`, `'mock'` in `BUILTIN_EMBEDDING_PROVIDERS` | **COMPLIANT** |
| **Environment Variable `EMBEDDING_PROVIDER`** | Authorized (§14.3) | Added to `apps/api/src/config/env.ts` with default `'ollama'` | **COMPLIANT** |
| **Fail-Closed Resolution on Unknown Provider** | Authorized (§14.3) | Throws `UnsupportedEmbeddingProviderError`, no silent fallback | **COMPLIANT** |
| **Duplicate Registration Protection** | Required by prompt | Throws `DuplicateEmbeddingProviderError` unless `override: true` | **COMPLIANT** |
| **Production Default Preservation** | Authorized (§14.3) | Defaults to Ollama in dev/prod; Gemini is never default | **COMPLIANT** |
| **`validateCompatibility` Wiring** | Authorized (§14.3) | Uses `EmbeddingModelPolicy.isDocumentCompatible` | **COMPLIANT** |
| **Worker Ingestion Registration** | Explicitly Deferred (§14.4) | Not implemented; `apps/worker` ingestion files untouched | **COMPLIANT** |
| **Bulk Re-Embedding Migration** | Deferred to Phase 1B.5 | Not implemented; 0 database rows modified | **COMPLIANT** |
| **GraphRAG Architecture** | Explicitly Excluded | Not modified; GraphRAG vector seed untouched | **COMPLIANT** |

---

## 4. Critical Audit Area A — Registry Design & Correctness

1. **Canonical Identifier Discipline:**
   - Registered identifiers: `'ollama'`, `'gemini'`, `'mock'`.
   - All input IDs are normalized via `.trim().toLowerCase()`.
   - Non-string or empty IDs are rejected with `InvalidEmbeddingProviderError`.
2. **Separation of Namespaces:**
   - Provider IDs (`'ollama'`, `'gemini'`, `'mock'`) and Model Names (`'nomic-embed-text'`, `'gemini-embedding-2'`, `'mock-embed-768'`) reside in distinct namespaces and are never conflated.
3. **Overwrite Protection:**
   - Calling `register(id, factory)` on an existing ID without `{ override: true }` throws `DuplicateEmbeddingProviderError`.
4. **Encapsulation:**
   - Internal maps (`providers`, `descriptors`) are `private`.
   - `getRegisteredIds()` returns a cloned array sorted alphabetically.
   - `getDescriptor(id)` returns an immutable descriptor object.
   - No arbitrary client or HTTP request can mutate registry state.

---

## 5. Critical Audit Area B — Provider Registration & Factory Safety

1. **Lazy Evaluation:**
   - Factories (`() => new OllamaEmbeddingProvider()`, `() => new GeminiEmbeddingProvider()`, `() => new MockEmbeddingProvider()`) are stored as callbacks.
   - Providers are instantiated lazily only when `resolve()` is called, ensuring zero network or side-effect overhead during registry initialization.
2. **Contract Enforcement on Resolved Instance:**
   - In `resolve()`, the returned provider instance is verified:
     - Must be a non-null object.
     - Must have a non-empty string `modelName`.
     - Must have `dimension === 768` (otherwise throws `EmbeddingDimensionViolation (§MOD-01)`).
     - Must have `generateEmbedding` and `generateEmbeddings` functions.
3. **Recovery and State Isolation:**
   - If a factory throws during `resolve()`, registry internal maps remain uncorrupted.
   - Calling `reset()` clears custom registrations and restores default built-in factories.

---

## 6. Critical Audit Area C — Fail-Closed Provider Resolution

1. **Unknown Provider Rejection:**
   - Resolving an unapproved ID (e.g. `resolve('unsupported-vendor')` or `resolve('anthropic')`) throws `UnsupportedEmbeddingProviderError`.
   - The error lists all approved providers and does **not** fall back to Ollama or Mock.
2. **Environment Variable Safeguard:**
   - If an invalid string is configured in `process.env.EMBEDDING_PROVIDER = 'invalid-provider'`, `resolve()` throws `UnsupportedEmbeddingProviderError`.
3. **Adversarial Input Handling:**
   - Empty string `''` or whitespace `'   '` cleanly falls back to environment/default resolution.
   - Case variants (`'OLLAMA'`, `'Gemini'`, `'MoCk'`) normalize correctly.
   - SQL injection payloads (e.g. `'ollama; DROP TABLE...'`) are treated as literal strings, fail lookup, and throw `UnsupportedEmbeddingProviderError`.

---

## 7. Critical Audit Area D — `EMBEDDING_PROVIDER` Configuration

1. **Schema Definition:**
   - In [`apps/api/src/config/env.ts`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/config/env.ts#L65):
     `EMBEDDING_PROVIDER: z.enum(['ollama', 'gemini', 'mock']).default('ollama')`.
2. **Production Default:**
   - Root `.env` does not specify `EMBEDDING_PROVIDER`.
   - Therefore, `env.EMBEDDING_PROVIDER` defaults to `'ollama'`.
3. **Scope and Decoupling:**
   - Decoupled from `LLM_PROVIDER`: text generation and embedding retrieval can be configured independently.
   - Worker runtime is **not** currently wired to `EMBEDDING_PROVIDER`; worker ingestion remains 100% on Ollama, respecting the Stage 14.4 boundary.
4. **Dynamic Activation Safety:**
   - If an operator sets `EMBEDDING_PROVIDER=gemini`, `EmbeddingService` generates Gemini query vectors.
   - Under Stage 14.1/14.2 model-aware filtering, Gemini queries search only for `gemini-embedding-2` documents.
   - If no Gemini documents exist in the workspace, hybrid search degrades gracefully to BM25 keyword search, preventing 500 errors and preventing cross-space distance calculations.

---

## 8. Critical Audit Area E — Production Default Preservation

| Runtime Environment | `EMBEDDING_PROVIDER` Value | Resolved Provider | Model Name | Production Default Intact? |
| :--- | :--- | :--- | :--- | :--- |
| `NODE_ENV=production` | Unset / Omitted | `OllamaEmbeddingProvider` | `nomic-embed-text` | **YES** |
| `NODE_ENV=development` | Unset / Omitted | `OllamaEmbeddingProvider` | `nomic-embed-text` | **YES** |
| `NODE_ENV=test` | Unset / Omitted | `MockEmbeddingProvider` | `mock-embed-768` | **YES (Test Isolation)** |
| `NODE_ENV=production` | Explicit `'ollama'` | `OllamaEmbeddingProvider` | `nomic-embed-text` | **YES** |
| `NODE_ENV=production` | Explicit `'gemini'` | `GeminiEmbeddingProvider` | `gemini-embedding-2` | **Authorized Option** |
| `NODE_ENV=production` | Explicit `'mock'` | **BLOCKED (Throws Error)** | N/A | **YES (Security Guard)** |

---

## 9. Critical Audit Area F — Mock Provider Isolation

1. **Production Guard:**
   - In `EmbeddingProviderRegistry.resolve()`:
     ```typescript
     if (targetId === 'mock' && process.env.NODE_ENV === 'production') {
       throw new Error('MockEmbeddingProvider cannot be used in production environment.');
     }
     ```
   - Attempting to resolve `'mock'` when `NODE_ENV === 'production'` immediately throws an exception.
2. **Cross-Model Space Isolation:**
   - Verified that `mock-embed-768` vectors cannot retrieve explicit `nomic-embed-text` or `gemini-embedding-2` documents, and real query vectors cannot retrieve `mock-embed-768` documents.

---

## 10. Critical Audit Area G — EmbeddingService Integration & Lifecycle

1. **Registry Delegation:**
   - In [`EmbeddingService.getProvider()`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/modules/retrieval/embeddings/embedding.service.ts#L75-L80):
     ```typescript
     public static getProvider(): EmbeddingProvider {
       if (!this.activeProvider) {
         this.activeProvider = this.registry.resolve();
       }
       return this.activeProvider;
     }
     ```
   - Resolves once and caches in `activeProvider`.
2. **Test Hooks Preserved:**
   - `setProvider(provider)` allows explicit mock injection.
   - `resetProvider()` clears `activeProvider`.
   - `setRegistry(registry)` allows isolated test registry injection.
3. **Public API Backward Compatibility:**
   - `EmbeddingService.getModelName()`
   - `EmbeddingService.generateQueryVector()`
   - `EmbeddingService.generateQueryVectorWithModel()`
   - All method signatures and return types remain 100% backward compatible.

---

## 11. Critical Audit Area H — `validateCompatibility()` Wiring

In [`EmbeddingService.validateCompatibility`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/modules/retrieval/embeddings/embedding.service.ts#L133-L173):
- Replaced previous ad-hoc string comparisons with `EmbeddingModelPolicy.isDocumentCompatible(provider.modelName, doc.embeddingModel)`.

### Verified Compatibility Matrix:
| Query Model | Document Model | Expected | Verified Result |
| :--- | :--- | :--- | :--- |
| `nomic-embed-text` | `nomic-embed-text` | Compatible | **Compatible (`true`)** |
| `nomic-embed-text` | `NULL` (Legacy) | Compatible | **Compatible (`true`)** |
| `nomic-embed-text` | `gemini-embedding-2` | Incompatible | **Incompatible (`false`)** |
| `gemini-embedding-2` | `gemini-embedding-2` | Compatible | **Compatible (`true`)** |
| `gemini-embedding-2` | `nomic-embed-text` | Incompatible | **Incompatible (`false`)** |
| `gemini-embedding-2` | `NULL` (Legacy) | Incompatible | **Incompatible (`false`)** |
| Any | Dimension mismatch (`1536`) | Incompatible | **Incompatible (`false`)** |

---

## 12. Critical Audit Area I — Provider vs Model Identity Separation

The implementation strictly avoids namespace collisions:
- **Registry Provider Namespace:** `ollama`, `gemini`, `mock`.
- **Embedding Model Namespace:** `nomic-embed-text`, `gemini-embedding-2`, `mock-embed-768`.
- In `RetrievalService`, database filtering continues to receive `provider.modelName` (never the provider ID).
- Vector search queries `d."embeddingModel" = 'gemini-embedding-2'` (never `d."embeddingModel" = 'gemini'`).

---

## 13. Critical Audit Area J — Gemini Boundaries & Activation

1. **Registration vs Activation:**
   - `GeminiEmbeddingProvider` is registered as an available factory.
   - It is **not** activated by default.
   - Default remains Ollama in production/development.
2. **Credential Safety:**
   - In production, if `EMBEDDING_PROVIDER=gemini` is configured without `GEMINI_API_KEY`, `new GeminiEmbeddingProvider()` throws `GeminiAuthenticationError` at resolution time, preventing unauthenticated API calls.
   - In test mode (`NODE_ENV === 'test'`), a dummy key allows unit testing without live network calls.

---

## 14. Critical Audit Area L — Stage 14.4 Boundary (Worker Ingestion)

Inspection of [`apps/worker/src/modules/ingestion/embeddings/index.ts`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/worker/src/modules/ingestion/embeddings/index.ts):
- `createEmbeddingProvider` supports only `'ollama' | 'mock'`.
- `GeminiEmbeddingProvider` is **not** imported or registered in the worker.
- Worker ingestion pipeline continues to use Ollama exclusively.
- **Stage 14.4 has NOT been started.**

---

## 15. Critical Audit Area M — GraphRAG & Other Forbidden Scope

- **GraphRAG:** Vector seed retrieval in [`GraphRetrievalService`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/modules/graph/services/graph-retrieval.service.ts) and [`graph-retrieval.sql.ts`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/modules/graph/queries/graph-retrieval.sql.ts) was NOT modified.
- **Database Schema:** Zero migrations in `prisma/migrations/`.
- **Re-Embedding:** Zero bulk re-embedding jobs executed.
- **Git State:** Zero commits created.

---

## 16. Test Verification & Integrity

Independent execution of all test suites was performed:

### 16.1 Registry Test Suite
- **Command:** `pnpm vitest run apps/api/src/modules/retrieval/__tests__/embedding-provider.registry.test.ts --reporter=verbose`
- **Result:** **30 / 30 passed (Duration: 2.15s, Exit code: 0)**

### 16.2 Full 10-Suite Retrieval & Embedding Regression Suite
- **Command:**
  ```bash
  pnpm vitest run \
    apps/api/src/modules/retrieval/__tests__/embedding-provider.registry.test.ts \
    apps/api/src/modules/retrieval/__tests__/retrieval.model-propagation.test.ts \
    apps/api/src/modules/retrieval/__tests__/retrieval.orchestration.test.ts \
    packages/shared/src/__tests__/embedding-policy.test.ts \
    apps/api/src/lib/__tests__/db.vector-search-model-gating.test.ts \
    apps/api/src/modules/retrieval/retrieval.test.ts \
    apps/api/src/modules/retrieval/fusion/rrf.fusion.test.ts \
    apps/api/src/modules/retrieval/query/query.processor.test.ts \
    apps/api/src/modules/retrieval/context/context.assembler.test.ts \
    packages/shared/src/gemini/__tests__/gemini-embedding.provider.test.ts
  ```
- **Result:** **204 / 204 passed across 10 test files (100% pass rate, 0 failures, Duration: 11.22s, Exit code: 0)**

### 16.3 Monorepo Typecheck
- **Command:** `pnpm typecheck`
- **Result:** **Exit code 0** (0 compilation errors across `@mindvault/shared`, `@mindvault/api`, `@mindvault/worker`, `@mindvault/companion`, `@mindvault/web`).

### 16.4 ESLint Verification
- **Command:** `pnpm eslint apps/api/src/config/env.ts apps/api/src/modules/retrieval/embeddings/embedding-provider.registry.ts apps/api/src/modules/retrieval/embeddings/embedding.service.ts apps/api/src/modules/retrieval/__tests__/embedding-provider.registry.test.ts`
- **Result:** **0 errors (8 pre-existing test warning casts, Exit code: 0)**

---

## 17. Git Boundary Verification & Change Classification

- **Initial HEAD SHA:** `ea8a3155303220f90ae7a244c04c0a9ff467ed7f`
- **Final HEAD SHA:** `ea8a3155303220f90ae7a244c04c0a9ff467ed7f`
- **Active Branch:** `main`
- **Commits Created:** 0

### Changed Files Classification:
| File | Change Type | Scope Status | Risk Level |
| :--- | :--- | :--- | :--- |
| `apps/api/src/config/env.ts` | Modified | Authorized Stage 14.3 (`EMBEDDING_PROVIDER`) | Low |
| `apps/api/src/modules/retrieval/embeddings/embedding.service.ts` | Modified | Authorized Stage 14.3 (Registry delegation) | Low |
| `apps/api/src/modules/retrieval/embeddings/embedding-provider.registry.ts` | Created (Untracked) | Authorized Stage 14.3 (Registry abstraction) | Low |
| `apps/api/src/modules/retrieval/__tests__/embedding-provider.registry.test.ts` | Created (Untracked) | Authorized Stage 14.3 (30 tests) | Low |
| `PHASE_1B_4_3_IMPLEMENTATION_REPORT.md` | Created (Untracked) | Authorized Stage 14.3 deliverable | None |
| `PHASE_1B_4_3_INDEPENDENT_AUDIT.md` | Created (Untracked) | Authorized audit deliverable | None |

---

## 18. Findings & Observations

### Finding 1: Informational — Offline Test Credential Handling in Registry
- **Severity:** Informational
- **Location:** `apps/api/src/modules/retrieval/embeddings/embedding-provider.registry.ts:389-393`
- **Observation:** In the built-in Gemini factory, `new GeminiEmbeddingProvider` supplies a test mock API key when `process.env.GEMINI_API_KEY` is not present and `NODE_ENV === 'test'`. In production, `apiKey` is undefined if not configured, causing `GeminiAuthenticationError` to throw immediately upon resolution.
- **Verdict:** Safe and compliant with prompt requirements (`Tests must be deterministic. Do not require live Gemini credentials or external APIs`).

---

## 19. Explicit Boundary Confirmations

- [x] **Explicit Confirmation:** Stage 14.4 (worker ingestion registration) is **NOT** implemented.
- [x] **Explicit Confirmation:** Production ingestion was **NOT** switched.
- [x] **Explicit Confirmation:** No re-embedding occurred.
- [x] **Explicit Confirmation:** GraphRAG was **NOT** modified.
- [x] **Explicit Confirmation:** Production defaults remain 100% Ollama (`nomic-embed-text`).

---

## 20. Audit Verdict

Phase 1B.4.3 (Stage 14.3: Embedding Provider Registry Architecture) satisfies all blueprint requirements, security invariants, error-handling contracts, and boundary restrictions.

```
AUDIT VERDICT: PASS — READY FOR PHASE 1B.4.4 AUTHORIZATION
```
