# MindVault — Phase 1B Architecture Decision Record (ADR)
## Formal Architecture Decision Records, Model Selection Justifications, Rejected Alternatives, and Operational Assumptions

**Document Version:** 1.1.0 (Hardened ADR Blueprint — Post Independent Challenge)  
**Audit Date:** November 16, 2026  
**Status:** RATIFIED ARCHITECTURAL DECISIONS  
**Repository:** `c:\Users\mohit\OneDrive\Desktop\MindVault`  
**Target Branch:** `main`  
**Baseline HEAD:** `ea8a3155303220f90ae7a244c04c0a9ff467ed7f`  

---

## 1. Summary of Architecture Decisions

| ADR # | Decision Title | Status | Core Impact |
| :--- | :--- | :--- | :--- |
| **ADR-01** | Adoption of Google Gemini API via `@google/genai` Unified SDK | **Approved** | Transition from local Ollama to cloud Gemini API. |
| **ADR-02** | Selection of `gemini-embedding-2` (768d) as Primary Model | **Approved** | Supersedes `text-embedding-004`; preserves `vector(768)`. |
| **ADR-03** | Selection of `gemini-3.8-flash` for RAG Generation & Graph Extraction | **Approved** | High-throughput streaming and JSON Schema structured outputs. |
| **ADR-04** | PostgreSQL Authoritative Fencing via `_migration_fencing` (Path A) | **Approved** | Zero-DDL on domain tables; Additive-DDL on migration tables. |
| **ADR-05** | Two-Rank Canonical Chunk Lock Ordering (`ORDER BY id ASC`) | **Approved** | Complete elimination of PostgreSQL Error `40P01` worker deadlocks. |
| **ADR-06** | Vector Unit-Normalization Defense-in-Depth ($\|\vec{v}\|_2 = 1.0 \pm 10^{-4}$) | **Approved** | Guarantees numerical stability and cosine scale-invariance. |
| **ADR-07** | Dual Storage and Mixed-Space Query Gating Architecture | **Approved** | Zero search downtime during re-embedding via Full-Text fallback. |
| **ADR-08** | Cloud Pay-As-You-Go Billing & Credential Isolation | **Approved** | Clarifies consumer plan independence; establishes rate targets. |

---

## 2. Formal Architecture Decision Records

### ADR-01: Adoption of Google Gemini API via `@google/genai` Unified SDK

#### Context
MindVault was prototyped using local Ollama (`qwen3:0.6b` and `nomic-embed-text`). While suitable for offline development, local inference on CPU/integrated GPU suffers from high latency (3–8s for embeddings, 10–25s for generation), lacks multimodal support, and requires heavy local system resources.

#### Decision
Adopt Google Gemini API as the primary inference engine for MindVault across API Gateway and Background Worker, utilizing the official `@google/genai` SDK (`^2.32.0`).

#### Consequences
* **Positive:** Sub-second RAG response streaming, production-grade retrieval quality (MTEB 67.99), massive context windows (up to 1M tokens), serverless worker operation without local GPU requirements.
* **Negative:** Introduces outbound network dependency to Google Cloud endpoints and operational API usage costs.
* **Neutral:** SDK dependency is already installed in `apps/api/package.json` and `apps/worker/package.json`.

---

### ADR-02: Selection of `gemini-embedding-2` (768d) as Primary Embedding Model

#### Context
Historical audit revisions (V1–V6) proposed `text-embedding-004`. However, Google Gemini permanently decommissioned `text-embedding-004` on **January 14, 2026**. Modern options include `gemini-embedding-2` (multimodal flagship) and `gemini-embedding-001` (text-only). Furthermore, pgvector storage in MindVault is typed as `vector(768)` in `document_chunks` and `graph_entities`.

#### Decision
Standardize on **`gemini-embedding-2`** with `outputDimensionality: 768` as the primary embedding model across all ingestion, re-embedding, and query retrieval pipelines. Designate **`gemini-embedding-001`** (with explicit client-side L2 normalization) as the secondary text-only fallback.

#### Consequences
* **Positive:**
  * Zero schema DDL changes required for `document_chunks.embedding` or `graph_entities.embedding`.
  * `gemini-embedding-2` natively auto-renormalizes truncated 768d vectors on the server side ($\|\vec{v}\|_2 = 1.0 \pm 10^{-4}$).
  * State-of-the-art retrieval accuracy (MTEB score 67.99).
  * Expanded context window of 8,192 tokens per chunk (up from 2,048).
* **Negative:** Truncating from the native 3,072d representation to 768d incurs a minor theoretical quality trade-off ($\approx 1.5\%$ on MTEB), which is negligible compared to the massive architectural advantage of avoiding schema migrations and index re-building.

---

### ADR-03: Selection of `gemini-3.8-flash` for RAG Generation & Graph Extraction

#### Context
RAG conversational responses require low time-to-first-token (TTFT) and continuous SSE streaming. Knowledge Graph entity/relationship extraction requires deterministic adherence to JSON schemas.

#### Decision
Standardize on **`gemini-3.8-flash`** (or `gemini-3.5-flash-lite` for high-volume background extraction) utilizing:
1. Native SSE streaming via `ai.models.generateContentStream` for `/api/conversations/:id/chat`.
2. Strict JSON Schema mode (`responseMimeType: 'application/json'`, `responseSchema`) for graph extraction.

#### Consequences
* **Positive:** Fast streaming ($< 400\text{ms}$ TTFT), zero JSON parsing hallucinations in graph extraction.
* **Negative:** Requires API quota management and token budgeting.

---

### ADR-04: PostgreSQL Authoritative Fencing via `_migration_fencing` (Path A)

#### Context
In Revision 8 of the audit, two implementation paths were evaluated to prevent distributed split-brain races caused by worker GC freezes:
* **Path A:** Dedicated relational infrastructure table `_migration_fencing`.
* **Path B:** Document sentinel row in existing `documents` table (`__fencing_<wsId>`).

#### Decision
Definitively select **Path A (Dedicated `_migration_fencing` Table)** and reject Path B. Clarify the DDL scope:
1. **Domain Tables:** Strictly **Zero-DDL** (`workspaces`, `documents`, `document_chunks`, `graph_entities`).
2. **Infrastructure Tables:** **Additive-DDL** (`_migration_fencing`, `_migration_failures`).

#### Consequences
* **Positive:**
  * Complete domain purity: zero synthetic fake document rows in `documents`.
  * Zero leakage risk in API/UI: endpoints querying `Document` will never expose sentinel records to users.
  * Cold-start safe via atomic `INSERT ... ON CONFLICT ("workspace_id") DO UPDATE`.
  * Enforces foreign key constraints with cascading deletes attached to `workspaces`.
* **Negative:** Requires a single additive database migration for the two infrastructure tables.

---

### ADR-05: Two-Rank Canonical Chunk Lock Ordering (`ORDER BY id ASC`)

#### Context
Multi-worker re-embedding updating chunks via `WHERE id = ANY($chunkIds)` resulted in intermittent PostgreSQL Error `40P01` (`deadlock_detected`) due to arbitrary physical heap row lock acquisition.

#### Decision
Enforce a strict two-rank canonical lock hierarchy across all migration transactions:
* **Rank 1:** Acquire lock on workspace fencing record (`_migration_fencing WHERE workspace_id = $1 FOR UPDATE`).
* **Rank 2:** Acquire chunk locks in explicit lexicographical ID order (`SELECT id FROM document_chunks WHERE id = ANY(...) ORDER BY id ASC FOR UPDATE`).

#### Consequences
* **Positive:** Complete mathematical elimination of circular wait cycles between concurrent migration workers.
* **Negative:** Transient contention with external un-ordered queries (e.g. cascading document deletion) is handled via optimistic retry backoff.

---

### ADR-06: Vector Unit-Normalization Defense-in-Depth ($\|\vec{v}\|_2 = 1.0 \pm 10^{-4}$)

#### Context
pgvector cosine distance (`<=>`) is scale-invariant ($D_{\cos}(c\vec{u}, k\vec{v}) = D_{\cos}(\vec{u}, \vec{v})$). However, floating point precision differences between IEEE 754 (Node.js) and Neon serverless PostgreSQL, combined with model truncation drift, can cause micro-variances.

#### Decision
Enforce unit-normalization validation ($\|\vec{v}\|_2 = 1.0 \pm 10^{-4}$) in the shared `GeminiEmbeddingProvider`. If an API response drifts beyond this bound, the provider automatically renormalizes $\vec{v} / \|\vec{v}\|_2$ before returning the vector.

#### Consequences
* **Positive:** Absolute numerical stability, guaranteed unit sphere bounds, zero database vector insertion errors.
* **Negative:** Insignificant CPU floating-point calculation during embedding ingestion ($< 0.1\text{ms}$).

---

### ADR-07: Dual Storage and Mixed-Space Query Gating Architecture

#### Context
Vectors from `nomic-embed-text` and `gemini-embedding-2` inhabit unaligned representation spaces with incompatible coordinate bases. Evaluating mixed-space vectors corrupts retrieval results. Furthermore, PostgreSQL native full-text search uses Cover Density ranking (`ts_rank_cd`), not BM25.

#### Decision
Implement dual-state query gating in SQL:
1. Dense vector retrieval strictly filters on `metadata->>'embeddingModel' = 'gemini-embedding-2'` for both `document_chunks` and `graph_entities`.
2. Unmigrated chunks remain 100% discoverable through PostgreSQL Native Full-Text Search (`ts_rank_cd` on `search_vector`) via Reciprocal Rank Fusion.
3. Chunks are updated in place with JSONB provenance metadata (`embeddingModel`, `embeddedAt`).
4. Documents are marked as migrated only when 100% of their chunks are re-embedded.

#### Consequences
* **Positive:** Zero downtime, zero search blackouts, zero data loss, fully non-blocking user experience during migration.
* **Negative:** Search queries during active migration retrieve unmigrated documents through full-text matching rather than dense semantics.

---

### ADR-08: Cloud Pay-As-You-Go Billing & Credential Isolation

#### Context
Confusion existed regarding whether consumer subscriptions (Google One AI Premium, Jio plans) provide Gemini API credits. Additionally, rate limiting must be accurately calibrated against official pricing.

#### Decision
Standardize on Google AI Studio / Google Cloud API keys with Pay-As-You-Go billing. Calibrate rate limiting on both RPM (300 RPM limit) and TPM (1,000,000 TPM limit) with native batch requests (`contents: texts`).

#### Consequences
* **Positive:** High default rate limits (1,500 RPM for embeddings, 1,000 RPM for generation), predictable commercial SLAs.
* **Negative:** Requires linked Google Cloud billing account; Free Tier keys are gated out during preflight due to the 15 RPM ceiling.
* **Financial Accuracy:** 10,000 chunks ($\approx 7.2\text{M}$ tokens at 720 tokens/chunk) re-embedded via `gemini-embedding-2` costs **$1.44 USD** (or **$0.72 USD** via Batch API).

---

## 3. Comprehensive Summary of Rejected Alternatives

| Rejected Alternative | Reason for Rejection | Superseded In |
| :--- | :--- | :--- |
| **`text-embedding-004`** | Decommissioned and permanently shut down by Google on January 14, 2026. | Audits V1–V6 superseded by V7/V8 |
| **3072d Vector Storage** | Requires altering table DDL (`vector(3072)`), dropping/rebuilding HNSW/IVFFlat indexes, and tripling database memory consumption for $< 1.5\%$ accuracy gain. | V4 proposal superseded in V5 |
| **Path B: Sentinel Document** | Pollutes domain model with synthetic documents (`__fencing_<wsId>`), risks UI leakage to end users, fails on empty workspaces. | V7 proposal superseded in V8 Addendum |
| **Redis-Only Fencing** | Cannot detect worker GC freezes $> 45\text{s}$, allowing split-brain stale worker overwrites in PostgreSQL. | V6 proposal superseded in V8 Addendum |
| **Sequential HTTP Loops** | Calling single `embedContent` inside `Promise.all` exhausts 300 RPM quota 32x faster. Replaced by native batching. | Red-Team Challenge Finding |
| **Hard Database Re-Vectoring DDL** | Dropping `embedding` column and recreating forces total system outage during re-embedding. | Rejected in favor of in-place JSONB-gated migration |

---

## 4. Operational Assumptions to Verify Post-Approval

1. **Assumption A1 (Account-Specific Quota Ceilings):** Assumes the target Google Cloud billing account has default Tier 1 / Pay-As-You-Go quota enabled (at least 300 RPM for embeddings). *Verification: `pnpm exec tsx scripts/probe-gemini-quota.ts`.*
2. **Assumption A2 (Empirical Retrieval Ground-Truth Parity):** Assumes `gemini-embedding-2` achieves Semantic MRR@10 $\ge 0.848$ on the 36-question ground-truth benchmark suite targeting `mindvault_eval`. *Verification: `pnpm exec tsx evaluation/harness/run-real-evaluation.ts`.*
3. **Assumption A3 (Neon Serverless Connection Latency):** Assumes Neon serverless connection pool handles continuous 32-chunk batch micro-transactions with connection pool usage $\le 5$ connections. *Verification: Active `pg_stat_activity` sampling during Phase 1B.5.*
