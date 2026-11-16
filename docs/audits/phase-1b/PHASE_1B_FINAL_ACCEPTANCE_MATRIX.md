# MindVault — Phase 1B Final Acceptance Matrix
## Verification Standards, Test Methods, and Acceptance Criteria for Gemini Migration

**Document Version:** 3.0.0  
**Audit Date:** November 16, 2026  
**Execution Mode:** STRICTLY READ-ONLY  
**Classification Protocol:** Every entry is categorized as **Verified Fact** (code/schema proof), **Empirical Benchmark** (measured performance/load), or **Stated Assumption** (baseline operational model).

---

## 1. Master Acceptance Matrix

| # | System Component / Subsystem | Phase 1B Requirement | Verification Method & Tooling | Pass / Fail Criteria | Exact Code / Schema Reference | Evidence Classification |
| :- | :--- | :--- | :--- | :--- | :--- | :--- |
| **01** | **Embedding Dimensionality** | Embeddings must strictly output 768 dimensions matching `vector(768)` | Automated Jest test calling `GeminiEmbeddingProvider.embedText()` | Assert `vector.length === 768` exactly; 0 array bounds errors | [`prisma/schema.prisma`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/prisma/schema.prisma#L143) | **Verified Fact** |
| **02** | **Cosine Distance Scale Invariance** | Unnormalized vector scaling must produce identical `<=>` distance | `tests/vector-normalization.test.ts` calculating `<=>` across scaled vectors | $\left\| D_{\text{cos}}(c\vec{u}, k\vec{v}) - D_{\text{cos}}(\vec{u}, \vec{v}) \right\| < 10^{-7}$ | [`apps/api/src/lib/db.ts`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/lib/db.ts#L756) | **Verified Fact** |
| **03** | **Unit-Normalization Invariant** | Embeddings stored in DB must have Euclidean norm of 1.0 ($\pm 10^{-4}$) | `validateVectorInvariants()` called on all vector inputs before persistence | Assert $\left\| \|\vec{v}\|_2 - 1.0 \right\| \le 10^{-4}$; throw exception on violation | [`apps/api/src/modules/retrieval/embeddings/`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/modules/retrieval/embeddings/) | **Empirical Benchmark** |
| **04** | **Per-Chunk Provenance** | Every chunk must record `embeddingModel` inside JSONB `metadata` | Inspect `document_chunks.metadata->>'embeddingModel'` via SQL assertion | Assert 100% of migrated chunks have `metadata->>'embeddingModel' = 'gemini-embedding-2'` | [`prisma/migrations/20261105000001_add_documents_and_chunks/migration.sql`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/prisma/migrations/20261105000001_add_documents_and_chunks/migration.sql#L42) | **Verified Fact** |
| **05** | **Safe Document Promotion Gate** | `documents.embeddingModel` only set when ALL document chunks are migrated | Automated concurrent migration test with simulated worker kill at 50% chunks | Assert `documents.embeddingModel` remains unpromoted if ANY chunk is unmigrated | [`apps/worker/src/modules/ingestion/pipeline.ts`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/worker/src/modules/ingestion/pipeline.ts#L314) | **Verified Fact** |
| **06** | **Mixed-Space Query Fencing** | Vector queries must never evaluate Gemini query vectors against Nomic chunks | SQL test running vector search during active 50% migration state | Assert 0 chunks with `nomic-embed-text` are returned in vector candidate list | [`apps/api/src/lib/db.ts`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/lib/db.ts#L750-L763) | **Verified Fact** |
| **07** | **Zero-Downtime Keyword Fallback** | Unmigrated documents must remain searchable via Full-Text Search | Execute hybrid search during migration targeting unmigrated text | Assert unmigrated chunks are returned via `ts_rank_cd` with valid score | [`apps/api/src/lib/db.ts`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/lib/db.ts#L834-L849) | **Verified Fact** |
| **08** | **Atomic Batch Claims** | Multi-worker runs must claim chunks with zero overlap or race condition | Run 2 concurrent worker processes claiming chunks via `FOR UPDATE SKIP LOCKED` | Assert 0 duplicate chunks processed; 0 lock contention errors | `scripts/migrate-embeddings-to-gemini.ts` | **Empirical Benchmark** |
| **09** | **Duplicate-Worker Lock** | Only one migration process per workspace permitted simultaneously | Launch second worker instance against same `workspaceId` | Assert second worker immediately exits with exit code 0 or advisory lock error | [`packages/shared/src/redis.ts`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/packages/shared/src/redis.ts) | **Verified Fact** |
| **10** | **Crash Recovery & MTTR** | Worker restart after `SIGKILL` must resume without data corruption | Abruptly kill worker process mid-batch; re-launch worker | Worker resumes processing within $< 5\text{ seconds}$; 0 orphaned chunks | `scripts/verify-worker-recovery.ts` | **Empirical Benchmark** |
| **11** | **Deleted Document Safety** | Document deletion during batch inference must not cause FK errors | Issue `DELETE /documents/:id` while worker is embedding chunk batch | Worker logs 0 rows affected; commits successfully; 0 orphan records | [`prisma/schema.prisma`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/prisma/schema.prisma#L147) | **Verified Fact** |
| **12** | **Gemini Quota Verification** | Quota prober must detect active limits and reject under-provisioned keys | Run `scripts/probe-gemini-quota.ts` against target `GEMINI_API_KEY` | Probe prints detected RPM/RPD limits; halts if remaining requests $< 100$ | `scripts/probe-gemini-quota.ts` | **Empirical Benchmark** |
| **13** | **Client Rate Limiting** | Worker must pace API calls to avoid triggering upstream HTTP 429 | Run rate limiter benchmark firing 100 requests in 5 seconds | Limiter throttles requests to configured RPM (e.g. max 500 RPM); 0 429s | `apps/worker/src/lib/gemini-rate-limiter.ts` | **Empirical Benchmark** |
| **14** | **Re-Embedding Cost Cap** | Re-embedding 10,000 chunks must cost $\le \$1.00$ on Pay-As-You-Go | Calculate tokens consumed across 10,000 chunks ($\approx 5\text{M}$ tokens) | Total billed amount $\le \$1.00$ USD (or $\le \$0.50$ via Batch API) | Google Developer Pricing Schedule | **Stated Assumption** |
| **15** | **Graph Extraction Cost Cap** | Graph extraction on 10,000 chunks must cost $\le \$1.50$ on Flash-Lite | Calculate tokens consumed (10M input, 2M output tokens) | Total billed amount $\le \$1.35$ USD | Google Developer Pricing Schedule | **Stated Assumption** |
| **16** | **8,192-Token Input Guard** | Chunks exceeding 7,500 tokens must be sub-chunked or clamped | Feed synthetic 10,000-token text chunk into ingestion pipeline | Chunk is safely split or truncated to 7,500 tokens with logged warning | [`apps/worker/src/modules/ingestion/chunker.ts`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/worker/src/modules/ingestion/chunker.ts) | **Verified Fact** |
| **17** | **Neon Pool Saturation** | Database connection pool must not exceed 5 connections during migration | Monitor `pg_stat_activity` sampling every 1 second during migration | Active connections strictly $\le 5$; 0 pool exhaustion timeouts | [`apps/api/src/lib/db.ts`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/lib/db.ts) | **Empirical Benchmark** |
| **18** | **Worker Memory RSS** | Worker process memory must remain bounded under continuous migration | Monitor `process.memoryUsage().rss` across 1,000 chunks | RSS memory strictly $\le 200\text{ MB}$; 0 memory leaks | Windows Host Runtime Monitor | **Empirical Benchmark** |
| **19** | **Retrieval Quality (MRR@10)** | Gemini retrieval quality must meet or exceed baseline Nomic quality | Run `evaluation/harness/run-real-evaluation.ts` across 50 ground truth queries | Assert MRR@10 $\ge 0.85$ (baseline $\ge 0.82$) | [`evaluation/harness/run-real-evaluation.ts`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/evaluation/harness/run-real-evaluation.ts) | **Empirical Benchmark** |
| **20** | **Graph Entity Embedding Safety** | Entity embeddings in `graph_entities` must match chunk embedding space | SQL query checking `graph_entities.embedding` model metadata | Assert all entity embeddings are either updated to Gemini or set to NULL | [`apps/api/src/modules/graph/queries/graph-retrieval.sql.ts`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/modules/graph/queries/graph-retrieval.sql.ts#L65) | **Verified Fact** |
| **21** | **Citation Tag Preservation** | Citations (`[S1]`, `[S2]`) and page offsets must remain 100% stable | Validate ground truth citations before and after chunk re-embedding | Assert 100% match on `citationId`, `chunkId`, `pageStart`, `pageEnd` | [`apps/api/src/modules/retrieval/context/context.assembler.ts`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/modules/retrieval/context/context.assembler.ts#L339-L365) | **Verified Fact** |
| **22** | **Conversational Memory Invariants** | Chat session summary versioning and sequence ordering must be preserved | Run `apps/api/src/modules/conversations/conversation.concurrency.test.ts` | All summary optimistic lock tests and sequence tests pass (100%) | [`apps/api/src/modules/conversations/services/summary.service.ts`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/modules/conversations/services/summary.service.ts#L80-L95) | **Verified Fact** |
| **23** | **Workspace Multi-Tenancy** | Re-embedding and retrieval must strictly enforce workspace boundary | Attempt cross-workspace retrieval query with valid token | Assert 0 cross-workspace chunks or entity evidence returned | [`apps/api/src/lib/db.ts`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/lib/db.ts#L722) | **Verified Fact** |
| **24** | **Rollback Time Guarantee** | Emergency abort must revert active gating within 30 seconds | Execute rollback script `scripts/rollback-gemini-migration.ts` | Query gating reverted; keyword/fallback active in $< 30\text{ seconds}$ | [`PHASE_1B_ROLLBACK_AND_RECOVERY.md`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/PHASE_1B_ROLLBACK_AND_RECOVERY.md) | **Empirical Benchmark** |

---

## 2. Sign-Off Protocols & Verification Commands

```powershell
# 1. Typecheck the entire monorepo
pnpm typecheck

# 2. Run unit tests verifying normalization math & invariants
pnpm --filter @mindvault/api test src/modules/retrieval/

# 3. Run knowledge graph & GraphRAG integrity tests
pnpm --filter @mindvault/api test src/modules/graph/

# 4. Run conversation memory concurrency test suite
pnpm --filter @mindvault/api test src/modules/conversations/conversation.concurrency.test.ts

# 5. Execute pre-flight quota probe
pnpm exec tsx scripts/probe-gemini-quota.ts

# 6. Execute ground-truth retrieval evaluation harness
pnpm exec tsx evaluation/harness/run-real-evaluation.ts
```
