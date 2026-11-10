# MindVault Post-Phase Stage 1.1: Real-world RAG Quality Validation — Initial Readiness Audit

**Milestone:** Post-Phase Execution — Stage 1  
**Task:** 1.1 — Existing RAG Evaluation Infrastructure & Readiness Audit  
**Mode:** STRICT READ-ONLY AUDIT  
**Implementation Authorization:** NOT GRANTED  
**Date:** November 9, 2026  
**Auditor:** Antigravity Agent  
**Repository Working Directory:** `c:\Users\mohit\OneDrive\Desktop\MindVault`  
**Current Monorepo Status:** 750/750 tests passing (66 suites), 0 type errors, clean build

---

## 1. Executive Summary

This audit establishes whether the MindVault Retrieval-Augmented Generation (RAG) platform, following the completion of Phases 1 through 6.9, is prepared to undergo empirical quality validation against realistic, multi-format documents and realistic user queries.

MindVault possesses an advanced, rigorously engineered retrieval and generative pipeline. The codebase features a production-ready three-way hybrid retrieval engine combining PostgreSQL pgvector cosine similarity, PostgreSQL GIN full-text search (`ts_rank_cd`), and a 1-hop knowledge graph traversal with evidence provenance. It implements Reciprocal Rank Fusion (RRF) with a deterministic 4-level tie-breaker, a 6-stage context assembler enforcing bounded dual budgeting (75% narrative floor, 25% graph ceiling), SSE streaming with token delivery, regex-based citation extraction (`[S\d+]`), and grounding status classification.

However, an empirical inspection of the actual repository reveals a fundamental bifurcation between **production runtime code** and **existing evaluation infrastructure**:

1. **Mock & In-Memory Decoupling:** All existing offline evaluation runners (`retrieval:evaluate`, `rag:evaluate`, `conversation:evaluate`, `graph:evaluate`) run exclusively against `InMemoryDatabaseService`, `MockEmbeddingProvider`, and `MockLLMProvider` using a tiny synthetic corpus of 3 mock documents (8 chunks) and 5 queries. Zero existing benchmarks measure pgvector index latency, PostgreSQL GIN recall, or live LLM factual accuracy and hallucination rates on disk files.
2. **Unsupported Ingestion Format (CSV):** The evaluation requirements specify an evaluation corpus containing PDF, DOCX, TXT, MD, and CSV documents. However, the production API explicitly rejects `.csv` uploads with HTTP `400 UNSUPPORTED_FILE_TYPE` (`SUPPORTED_EXTENSIONS = ['.pdf', '.docx', '.txt', '.md']` in `apps/api/src/modules/document/document.service.ts` line 17), and the worker extractor throws an `Unsupported document format` exception (`apps/worker/src/modules/ingestion/extractors/index.ts` line 48).
3. **Metric Instrumentation Gaps:** Standard information retrieval metrics (`Recall@5`, `MRR@10`) exist mathematically in `RetrievalMetrics` but are only evaluated for $K \in \{1, 3\}$ in test scripts. Advanced generation quality metrics—including LLM-as-a-judge Answer Correctness, claim-level Citation Precision, Citation Completeness, and Abstention Accuracy—are completely absent from the current benchmark harness.

### Audit Verdict

**READY WITH CONDITIONS**

The platform architecture is robust, fully typed, and operationally sound, but real-world RAG validation cannot proceed blindly without satisfying two non-negotiable operational conditions:

- **Condition 1 (Ingestion Format Conformance):** Because production code modifications are strictly prohibited in this phase, all CSV tabular evaluation datasets must be ingested in structured Markdown table format (`.md`) or structured text (`.txt`).
- **Condition 2 (Isolated Real-World Harness):** A dedicated, standalone evaluation harness must be constructed in Stage 1.2 that boots against a real PostgreSQL instance (with pgvector and pg_trgm) and connects to a real embedding/LLM provider (Ollama or Gemini) without modifying existing production source code or disturbing existing in-memory unit/integration test suites.

---

## 2. Actual Architecture Discovered

An exhaustive source code inspection was conducted across `@mindvault/api`, `@mindvault/worker`, and `@mindvault/shared`. Below is the verified architectural reality:

```
+----------------------------------------------------------------------------------------------------+
|                                     MINDVAULT RAG PIPELINE                                         |
+----------------------------------------------------------------------------------------------------+
|                                                                                                    |
|  [ Ingestion ]                                                                                     |
|   Uploaded File (.pdf, .docx, .txt, .md)                                                           |
|        |                                                                                           |
|        v                                                                                           |
|   extractDocument() ----> Chunker (700 target, 900 max, 120 overlap tokens)                        |
|                                |                                                                   |
|                                v                                                                   |
|   Embedding Provider (Ollama nomic-embed-text / Mock, 768 dims) + GraphExtractorService            |
|                                |                                                                   |
|        +-----------------------+------------------------+                                          |
|        |                                                |                                          |
|        v                                                v                                          |
|   PostgreSQL `document_chunks`                   PostgreSQL Knowledge Graph                        |
|   - embedding vector(768)                        - `knowledge_graph_entities`                      |
|   - search_vector tsvector                       - `knowledge_graph_relations`                     |
|                                                  - `knowledge_graph_evidence`                      |
|                                                                                                    |
+----------------------------------------------------------------------------------------------------+
|                                                                                                    |
|  [ Retrieval & Fusion ]                                                                            |
|   User Query                                                                                       |
|        |                                                                                           |
|        +-------------------+--------------------+--------------------+                             |
|        |                   |                    |                    |                             |
|        v                   v                    v                    v (Optional)                  |
|   Vector Search      Keyword Search       Graph Retrieval       Conversation Rewriter              |
|   (pgvector <=>)    (ts_rank_cd FTS)      (1-Hop Traversal)    (Multi-turn Pronouns/Ellipses)      |
|        |                   |                    |                                                  |
|        +-------------------+--------------------+                                                  |
|                            |                                                                       |
|                            v                                                                       |
|                Reciprocal Rank Fusion (RRF)                                                        |
|                Score = Sum( w_m / (60 + rank_m) )                                                  |
|                4-Tier Deterministic Tie-Breaker                                                    |
|                            |                                                                       |
+----------------------------------------------------------------------------------------------------+
|                                                                                                    |
|  [ Context Assembly & Generation ]                                                                 |
|   ContextAssembler (6 Stages):                                                                     |
|   - Stage 1: Narrative Budgeting (75% floor = ~2250-3000 tokens)                                   |
|   - Stage 2: Graph Candidates & Option B Surviving Evidence Check                                  |
|   - Stage 3: Graph Budget Allocation (25% ceiling) + Dynamic Backfill                              |
|   - Stage 4: Narrative Freezing & [S1]...[SN] Mapping                                              |
|   - Stage 5: Graph Proposition Formatting with Surviving [S#] Tags                                 |
|   - Stage 6: Prompt Construction (<evidence>, <knowledge_graph_evidence>)                          |
|                            |                                                                       |
|                            v                                                                       |
|   RAGService / LLMProvider (Streaming SSE or Non-Streaming)                                        |
|   Events: `start` -> `retrieval_complete` -> `sources` -> `token`* -> `validation` -> `done`       |
|                            |                                                                       |
|                            v                                                                       |
|   CitationValidatorService (Regex /\[S(\d+)\]/g) + GroundingService                                |
|   Outputs: GROUNDED, PARTIALLY_GROUNDED, INSUFFICIENT_EVIDENCE, CITATION_INVALID                   |
|                                                                                                    |
+----------------------------------------------------------------------------------------------------+
```

### Detailed Component Inventory & Code Grounding

1. **Document Ingestion & Extractors (`apps/worker/src/modules/ingestion/extractors/`):**
   - PDF: Parsed with `pdf-parse` (`pdf.extractor.ts`), extracting page-by-page text.
   - DOCX: Parsed with `mammoth` (`docx.extractor.ts`), converting Word paragraphs into raw text.
   - Text & Markdown: Direct UTF-8 decoders (`text.extractor.ts`, `markdown.extractor.ts`).
   - Format Gate: `SUPPORTED_EXTENSIONS` (`apps/api/src/modules/document/document.service.ts` line 17) restricts extensions strictly to `.pdf`, `.docx`, `.txt`, `.md`.
2. **Chunking & Boundary Segmentation (`apps/worker/src/modules/ingestion/chunking/chunker.ts`):**
   - Target chunk size: 700 tokens; Max chunk size: 900 tokens; Overlap: 120 tokens (`DEFAULT_CHUNKING_CONFIG`).
   - Token estimation heuristic: `estimateTokens(text) = Math.ceil(text.length / 4)`.
   - Structural boundary respect: Deconstructs documents by Markdown headers (`#`, `##`, `###`), double newlines (paragraphs), and sentence punctuation (`.`, `!`, `?`).
   - Metadata preservation: Chunk objects record `chunkIndex`, `pageStart`, `pageEnd`, `headingHierarchy` (breadcrumbs), and `tokenCount`.
3. **Embeddings & Vector Storage (`apps/worker/src/modules/ingestion/embeddings/index.ts` & `apps/api/src/lib/db.ts`):**
   - Active providers: `OllamaEmbeddingProvider` (default model `nomic-embed-text`, 768 dimensions) and `MockEmbeddingProvider`.
   - Stored in PostgreSQL table `document_chunks` column `embedding vector(768)`.
   - Vector similarity query: Uses PostgreSQL pgvector cosine distance operator `<=>` via `1 - (c."embedding" <=> $2::vector) AS score`, filtered by `c."workspaceId" = $1 AND d."status" = 'COMPLETED'`.
4. **Full-Text Search (`apps/api/src/lib/db.ts`):**
   - Column `search_vector tsvector` indexed via PostgreSQL GIN.
   - Uses `ts_rank_cd(c."search_vector", websearch_to_tsquery('english', $2))` with fallback to `plainto_tsquery`.
5. **Hybrid Fusion (`apps/api/src/modules/retrieval/fusion/rrf.fusion.ts`):**
   - Reciprocal Rank Fusion: $RRF(d) = \sum_{m \in M} \frac{w_m}{k + \text{rank}_m(d)}$, with $k=60$.
   - Channels: Semantic (weight 1.0), Keyword (weight 1.0), Graph Evidence (weight 1.0).
   - Deterministic 4-level tie-breaker:
     1. `rrfScore DESC`
     2. `retrievalSources.length DESC` (cross-channel consensus)
     3. `chunkIndex ASC` (document narrative order)
     4. `chunkId ASC` (locale-independent UTF-8 code point comparison via `compareStringsCodePoint`)
6. **Graph Extraction & GraphRAG Traversal (`apps/worker/src/modules/graph/` & `apps/api/src/modules/retrieval/services/graph-retrieval.service.ts`):**
   - Entity & relation extraction runs during worker document processing.
   - Graph retrieval executes a 1-hop seed discovery query joining entities, relations, and evidence chunks in PostgreSQL with a mandatory 2500ms safety timeout (`Promise.race`).
7. **Context Assembly & Token Budgeting (`apps/api/src/modules/retrieval/context/context.assembler.ts`):**
   - Implements bounded dual budgeting: 75% narrative floor, 25% graph ceiling.
   - Dynamically backfills unused graph budget into narrative chunks.
   - Enforces Option B surviving evidence sufficiency: Graph relations survive if and only if at least one supporting evidence chunk survived narrative budgeting.
   - Freezes narrative sources into deterministic `[S1]`, `[S2]`, ... citation mappings.
8. **Generation, Grounding & Citations (`apps/api/src/modules/generation/services/`):**
   - `RAGService.generateAnswer` and `generateAnswerStream` orchestrate retrieval, prompt building, LLM execution, and validation.
   - `CitationValidatorService` parses `/\[S(\d+)\]/g` tags and cross-references against provided sources.
   - `GroundingService` assigns statuses: `GROUNDED`, `PARTIALLY_GROUNDED`, `INSUFFICIENT_EVIDENCE`, or `CITATION_INVALID`.
9. **Conversational Context & Query Rewriting (`apps/api/src/modules/conversations/`):**
   - `QueryContextService` analyzes multi-turn context (pronouns, demonstratives, elliptical follow-ups, topic shifts) and rewrites ambiguous follow-up queries prior to retrieval.
   - Persistent conversation sessions with rolling summary compression for conversations exceeding token windows.

---

## 3. Existing Evaluation Infrastructure

The repository contains four dedicated evaluation benchmark scripts registered in `package.json`:

```bash
# Available evaluation commands:
pnpm retrieval:evaluate     # tsx src/modules/retrieval/evaluation/eval.runner.ts
pnpm rag:evaluate           # tsx src/modules/generation/evaluation/rag.eval.runner.ts
pnpm conversation:evaluate  # tsx src/modules/conversations/evaluation/conversation.eval.runner.ts
pnpm graph:evaluate         # tsx src/modules/graph/evaluation/graph.eval.runner.ts
```

### Empirical Execution Results of Existing Runners

All four benchmarks were executed directly in the repository environment during this audit:

#### 1. Retrieval Evaluation (`pnpm retrieval:evaluate`)

- **Corpus:** `EVALUATION_CORPUS` (3 synthetic documents: `doc_eval_01`, `doc_eval_02`, `doc_eval_03`; total 8 chunks).
- **Queries:** 5 synthetic queries (`EVALUATION_QUERIES`) with hardcoded graded relevance maps.
- **Engine:** `InMemoryDatabaseService`, `MockEmbeddingProvider`.
- **Measured Metrics:**
  - Hybrid Search: `MRR = 0.767`, `nDCG@3 = 0.783`, `Precision@1 = 0.600`, `Recall@3 = 0.700`
  - Keyword Search: `MRR = 1.000`, `nDCG@3 = 0.950`, `Precision@1 = 1.000`, `Recall@3 = 0.700`
  - Semantic Search: `MRR = 0.517`, `nDCG@3 = 0.459`, `Precision@1 = 0.400`, `Recall@3 = 0.300`
- **Execution Time:** ~2.1 seconds.

#### 2. Generative RAG Evaluation (`pnpm rag:evaluate`)

- **Cases:** 5 test cases (`RAG_EVALUATION_CASES`: 3 grounded, 1 insufficient evidence, 1 prompt injection).
- **Engine:** `InMemoryDatabaseService`, `MockEmbeddingProvider`, `MockLLMProvider`.
- **Measured Metrics:**
  - Citation Validity Rate: 100.0%
  - Insufficient Evidence Detection: 100.0%
  - Prompt Injection Containment: 100.0%
  - Average Total Latency: 8.8 ms
  - Average Retrieval Latency: 8.4 ms
- **Execution Time:** ~2.3 seconds.

#### 3. Conversational RAG Evaluation (`pnpm conversation:evaluate`)

- **Scenarios:** 15 multi-turn scenarios (`CONVERSATION_EVAL_SCENARIOS`: single-turn, pronoun resolution, demonstratives, ellipsis, comparative, topic shift, topic return, rolling summary, adversarial injection, cross-workspace isolation, abort recovery, lifecycle).
- **Results:** 15/15 passed (100.0%).
- **Execution Time:** 56 ms.

#### 4. Knowledge Graph Evaluation (`pnpm graph:evaluate`)

- **Scenarios:** 15 graph traversal and entity resolution items (`GRAPH_EVAL_DATASET`).
- **Results:** 15/15 passed (100.0%).
  - Extraction Precision: 100.0%
  - Extraction Recall: 100.0%
  - Entity Resolution Accuracy: 100.0%
  - Evidence Coverage: 100.0%
  - Multi-Hop Path Recall: 100.0%
- **Execution Time:** 24 ms.

### Critical Limitations of Existing Infrastructure

While these evaluation runners provide excellent regression protection for business logic and algorithms, they suffer from severe real-world blind spots:

1. **Zero Database Grounding:** Tests mock the database with an in-memory hash map (`InMemoryDatabaseService`). They bypass PostgreSQL `pgvector` index calculations, disk I/O, concurrency locks, and GIN full-text index tokenization.
2. **Zero Model Grounding:** Embeddings are produced by `MockEmbeddingProvider` (deterministic murmur-hash). Generative responses are produced by `MockLLMProvider` (pre-scripted canned strings). Real-world issues such as embedding semantic drift, LLM instruction following decay, token hallucination, and prompt format drift are completely invisible to these runners.
3. **Corpus Triviality:** The retrieval corpus consists of only 8 chunks (~800 tokens total). Real enterprise workloads index thousands of chunks across hundreds of pages, introducing index fragmentation, vector collisions, and low-rank noise.
4. **No Real Document Parsing:** The runners bypass file extraction entirely; chunks are hardcoded as TypeScript string literals. The text parsing stages (`pdf-parse`, `mammoth`) are never exercised during evaluation.

---

## 4. Document Ingestion Readiness

An audit of `apps/worker/src/modules/ingestion/extractors/` and `apps/api/src/modules/document/document.service.ts` evaluated the platform's readiness to ingest real-world document formats:

| Format               | Ingestion Pipeline Support                  | Extractor Library    | Extraction Quality & Behavioral Risks                                                                                                                                                                                             | Readiness Status                     |
| :------------------- | :------------------------------------------ | :------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :----------------------------------- |
| **PDF (`.pdf`)**     | Supported (`SUPPORTED_EXTENSIONS`, line 17) | `pdf-parse` (v1.1.1) | Page numbers are accurately extracted (`pageStart`, `pageEnd`). However, multi-column layouts, header/footer boilerplate, and complex tables are flattened into unstructured text blocks, potentially corrupting semantic chunks. | **READY**                            |
| **DOCX (`.docx`)**   | Supported (`SUPPORTED_EXTENSIONS`, line 17) | `mammoth` (v1.6.0)   | Extracts raw paragraph text cleanly. Loss of visual hierarchy (callouts, floating sidebars) and embedded spreadsheet tables.                                                                                                      | **READY**                            |
| **TXT (`.txt`)**     | Supported (`SUPPORTED_EXTENSIONS`, line 17) | UTF-8 Text Decoder   | Preserves raw formatting, code snippets, and structured ASCII tables cleanly. Zero layout ambiguity.                                                                                                                              | **READY**                            |
| **Markdown (`.md`)** | Supported (`SUPPORTED_EXTENSIONS`, line 17) | Markdown Extractor   | Preserves heading hierarchy (`#`, `##`, `###`) directly into chunk metadata `headingHierarchy`. Code blocks and Markdown tables preserved intact.                                                                                 | **READY**                            |
| **CSV (`.csv`)**     | **REJECTED AT API GATE**                    | **NONE**             | **NOT SUPPORTED:** In `document.service.ts` line 71, uploading `.csv` throws `400 UNSUPPORTED_FILE_TYPE`. In worker `extractDocument()`, line 48 throws `Unsupported document format`.                                            | **NOT READY** (Requires Condition 1) |

### Empirical Ingestion Findings

- **Chunker Sizing:** `DEFAULT_CHUNKING_CONFIG` targets 700 tokens with a 900-token ceiling and 120-token overlap. This configuration is well-calibrated for standard 768-dimension embedding models (`nomic-embed-text`), avoiding chunk truncation.
- **Page Attribution Integrity:** Chunker locates page offsets by substring matching chunks against raw extracted page buffers (`findPageForText`). For PDF documents, this reliably tags `pageStart` and `pageEnd` for citation display.
- **CSV Handling Resolution:** To satisfy the user requirement for multi-document tabular evaluation without violating safety constraints (no production code modifications), all tabular datasets must be formatted as GitHub Flavored Markdown tables (`.md`) or tab-delimited text (`.txt`).

---

## 5. Retrieval Evaluation Readiness

The hybrid retrieval engine was audited across its three core channels and fusion layer:

### Vector Retrieval (Semantic Channel)

- **Algorithm:** Cosine distance `<=>` in PostgreSQL pgvector.
- **Score Calculation:** `score = 1 - (c."embedding" <=> $2::vector)`.
- **Query Structure:** Scoped strictly by workspace ID and completed document status:
  ```sql
  SELECT c.id, c."documentId", c."workspaceId", c."chunkIndex", c.content, c."tokenCount",
         c."pageStart", c."pageEnd", c.metadata, d."originalName" as "documentName",
         1 - (c."embedding" <=> $2::vector) AS score
  FROM "document_chunks" c
  JOIN "documents" d ON d.id = c."documentId"
  WHERE c."workspaceId" = $1 AND d."status" = 'COMPLETED'
  ORDER BY score DESC LIMIT $3;
  ```
- **Readiness:** **READY**. The SQL query and parameterization are sound and injection-proof.

### Full-Text Search (Keyword Channel)

- **Algorithm:** PostgreSQL full-text search using `ts_rank_cd` over `search_vector`.
- **Query Structure:** Combines `websearch_to_tsquery('english', $2)` with fallback to `plainto_tsquery`:
  ```sql
  SELECT c.id, c."documentId", c."workspaceId", c."chunkIndex", c.content, c."tokenCount",
         c."pageStart", c."pageEnd", c.metadata, d."originalName" as "documentName",
         ts_rank_cd(c."search_vector", websearch_to_tsquery('english', $2)) AS rank
  FROM "document_chunks" c
  JOIN "documents" d ON d.id = c."documentId"
  WHERE c."workspaceId" = $1 AND d."status" = 'COMPLETED'
    AND (c."search_vector" @@ websearch_to_tsquery('english', $2) OR c."search_vector" @@ plainto_tsquery('english', $2))
  ORDER BY rank DESC LIMIT $3;
  ```
- **Readiness:** **READY**. Correctly utilizes GIN index and handles punctuation-heavy queries without SQL errors.

### Reciprocal Rank Fusion (RRF Layer)

- **Algorithm:** $RRF(d) = \sum_{m \in M} \frac{w_m}{60 + \text{rank}_m(d)}$.
- **Tie-Breaking:** Enforces strict 4-level deterministic ordering (`rrfScore DESC` $\to$ `retrievalSources.length DESC` $\to$ `chunkIndex ASC` $\to$ `chunkId ASC`).
- **Readiness:** **READY**. Eliminates nondeterministic ranking oscillations across identical retrieval scores.

---

## 6. GraphRAG Evaluation Readiness

The knowledge graph subsystem was audited in `apps/api/src/modules/retrieval/services/graph-retrieval.service.ts` and `apps/api/src/modules/retrieval/context/context.assembler.ts`:

### 1-Hop Seed Discovery & Traversal

- **Seed Discovery:** Extracts candidate entities from query keywords and vector neighbors, then queries `knowledge_graph_relations` joining `knowledge_graph_entities` on source/target and `knowledge_graph_evidence` on relation ID.
- **Workspace Isolation:** All queries strictly filter on `r."workspaceId" = $1` and `e."workspaceId" = $1`.
- **Latency Protection:** Graph retrieval is bounded by a strict 2500ms timeout (`Promise.race`), preventing recursive traversal from blocking generation.

### Context Assembly & Option B Evidence Sufficiency

- **Bounded Budgeting:** 75% narrative floor (~3000 tokens) and 25% graph ceiling (~1000 tokens). Unused graph budget is backfilled into narrative chunks.
- **Option B Policy:** Graph relations are cited if and only if at least one of their supporting evidence chunks survived narrative budgeting. If a relation's supporting chunks are dropped due to token limits, the relation is discarded, preventing hallucinated graph claims.
- **Readiness:** **READY**. Phase 6.6.3 and Phase 6.9 hardening established complete citation safety and multi-tenant isolation.

---

## 7. Answer and Citation Evaluation Readiness

The generation and validation pipeline was audited across `apps/api/src/modules/generation/services/`:

### Prompt Construction & Citation Discipline

- The system prompt (`SYSTEM_PROMPT_V1`) enforces:
  1. Strict grounding invariant (cite only provided evidence `<evidence>` and `<knowledge_graph_evidence>`).
  2. Bracketed citation identifiers (`[S1]`, `[S2]`).
  3. Insufficient evidence admission requirement.
  4. Prompt injection containment.

### Citation Parsing & Verification

- `CitationValidatorService.extractCitationIds(text)` extracts all `/\[S(\d+)\]/g` instances.
- Cross-references extracted IDs against `context.sources`.
- Flags unknown or fabricated citation IDs in `unknownCitationIds`.
- Flags answers that assert facts without citing provided sources.

### Grounding Classification Logic & Risks

`GroundingService.evaluateGrounding` determines grounding status:

- `INSUFFICIENT_EVIDENCE`: Assigned if the answer contains phrases from `INSUFFICIENT_EVIDENCE_PHRASES` or if 0 sources were provided.
- `CITATION_INVALID`: Assigned if any cited `[S#]` is not in `context.sources`.
- `GROUNDED`: Assigned if citations are present, valid, and either all sources are cited or $\le 3$ sources were supplied.
- `PARTIALLY_GROUNDED`: Assigned if citations are valid but fewer than supplied when $> 3$ sources were provided, OR if evidence was supplied but no citations were included.

### Reliability Vulnerabilities Discovered

1. **Partial Grounding False Positive:** If retrieval provides 5 chunks and the LLM accurately answers the question by citing the 2 truly relevant chunks while ignoring 3 noise chunks, `GroundingService` classifies the answer as `PARTIALLY_GROUNDED` instead of `GROUNDED`.
2. **Abstention Phrasing Brittleness:** If an LLM states "I cannot find any mention of this in the files", but omits the exact substrings in `INSUFFICIENT_EVIDENCE_PHRASES`, the response will be classified as `PARTIALLY_GROUNDED` or `GROUNDED` rather than `INSUFFICIENT_EVIDENCE`.
3. **No Claim-Level Verification:** The service verifies that citation tags exist and match source IDs, but does NOT perform Natural Language Inference (NLI) to verify whether the cited chunk actually entails the specific claim preceding the bracket.

---

## 8. Missing Evaluation Capabilities

To conduct realistic, empirical RAG quality validation, the following gaps must be bridged in Stage 1.2:

```
+-----------------------------------+--------------------------------+-------------------------------------+
| Evaluation Dimension              | Current Repository State       | Required Stage 1.2 Capability       |
+-----------------------------------+--------------------------------+-------------------------------------+
| Test Environment                  | In-Memory Mock Database        | Real PostgreSQL + pgvector + FTS    |
| Embedding Generation              | Mock Deterministic Hash        | Real Ollama nomic-embed-text/Gemini |
| LLM Generation                    | Mock Scripted String Match     | Real LLM (Ollama Llama 3 / Gemini)  |
| Information Retrieval Metrics     | Precision@1/3, Recall@1/3, MRR | Add Recall@5, MRR@10, nDCG@10       |
| Retrieval Relevance Scoring       | Binary Graded Map (8 chunks)   | Multi-document Relevance Ground Truth|
| Answer Correctness                | None                           | LLM-as-a-judge vs. Reference Answer |
| Answer Faithfulness (NLI)         | Regex Citation Presence only   | Claim Entailment vs. Cited Chunk    |
| Citation Precision & Completeness | ID Validity only               | Supported Claims / Total Claims     |
| Abstention Accuracy               | Substring match list           | Binary classification on Unanswerable|
| Latency Profiling                 | Single in-memory timestamp     | TTFT, Embedding, DB, Stream Timings |
+-----------------------------------+--------------------------------+-------------------------------------+
```

---

## 9. Proposed Real-World Dataset Structure

To evaluate MindVault rigorously, a realistic, multi-document enterprise corpus and a 36-question evaluation dataset are proposed below.

### Proposed Corpus: Enterprise Cloud Platform Specification (6 Documents)

1. `MV-DOC-01.pdf` — **Distributed Cloud Storage & Sharding Architecture Spec (v2.4)** (Multi-page PDF: chunk hashing, replication quorums, raft leases, encryption at rest).
2. `MV-DOC-02.pdf` — **Enterprise Zero-Trust Security & Identity Policy (v3.1)** (Multi-page PDF: RBAC permissions, JWT expiration, tenant isolation, rate limits).
3. `MV-DOC-03.docx` — **Production Operations & Incident Management Runbook** (DOCX: P1-P4 severity definitions, failover triggers, RTO/RPO targets, on-call escalations).
4. `MV-DOC-04.md` — **API Gateway Routing & Server-Sent Events (SSE) Protocol Spec** (Markdown: endpoint contracts, SSE event lifecycles, keep-alive headers, error schemas).
5. `MV-DOC-05.txt` — **Service Configuration Reference & Infrastructure Environment Directives** (Plain Text: database pool sizes, timeout parameters, vector thresholds, worker queues).
6. `MV-DOC-06.md` (Transformed CSV) — **Quarterly Infrastructure Latency & Benchmark Metrics Table** (Markdown Table representing CSV data: regional latencies, p50/p95/p99, compute costs, QPS).

---

### Evaluation Questions Specification (36 Questions across 6 Categories)

#### Category 1: Direct Factual Retrieval (Exact single-chunk facts)

| ID           | Question Text                                                                                     | Expected Answer                                                          | Supporting Docs  | Verbatim Ground Truth Snippet                                                         | Difficulty | Answerability |
| :----------- | :------------------------------------------------------------------------------------------------ | :----------------------------------------------------------------------- | :--------------- | :------------------------------------------------------------------------------------ | :--------- | :------------ |
| **EVAL-Q01** | What is the maximum allowed database connection pool size configured for the API gateway service? | The maximum allowed database connection pool size is 20 connections.     | `MV-DOC-05.txt`  | `DB_POOL_MAX=20 # Maximum concurrent connections per API gateway instance`            | Easy       | Answerable    |
| **EVAL-Q02** | What is the expiration lifetime of user access JWT tokens?                                        | Access JWT tokens expire exactly 15 minutes after issuance.              | `MV-DOC-02.pdf`  | `User access JWT tokens have a strict time-to-live (TTL) of 15 minutes.`              | Easy       | Answerable    |
| **EVAL-Q03** | What is the heartbeat lease duration for Raft consensus leader election?                          | The Raft consensus leader election heartbeat lease is 1500 milliseconds. | `MV-DOC-01.pdf`  | `Leader election leases are renewed via periodic heartbeats set to 1500ms intervals.` | Easy       | Answerable    |
| **EVAL-Q04** | What is the maximum file size limit for document uploads in MindVault?                            | The maximum file size limit is 25 MB.                                    | `MV-DOC-05.txt`  | `MAX_FILE_SIZE_BYTES=26214400 # 25 Megabytes absolute payload boundary`               | Easy       | Answerable    |
| **EVAL-Q05** | What is the target Recovery Point Objective (RPO) for a Sev-1 incident?                           | The target RPO for a Sev-1 incident is less than 1 minute.               | `MV-DOC-03.docx` | `Disaster Recovery Target: Recovery Point Objective (RPO) < 1 minute.`                | Easy       | Answerable    |
| **EVAL-Q06** | What interval is specified for the Server-Sent Events (SSE) keep-alive ping?                      | The SSE keep-alive ping interval is 15 seconds.                          | `MV-DOC-04.md`   | `The gateway dispatches a comment heartbeat (: ping) every 15 seconds.`               | Easy       | Answerable    |

#### Category 2: Semantic Retrieval (Paraphrased concepts with zero keyword overlap)

| ID           | Question Text                                                                                                     | Expected Answer                                                                                                                      | Supporting Docs | Verbatim Ground Truth Snippet                                                                                                                                  | Difficulty | Answerability |
| :----------- | :---------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------- | :-------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------- | :--------- | :------------ |
| **EVAL-Q07** | How does the platform defend against unauthorized horizontal tenant data traversal?                               | MindVault enforces workspace isolation where every database query filters on workspaceId, rejecting foreign access via token claims. | `MV-DOC-02.pdf` | `Horizontal tenant isolation is cryptographically guaranteed by scoping every database predicate to the verified workspaceId extracted from the signed token.` | Medium     | Answerable    |
| **EVAL-Q08** | In what manner does the distributed storage cluster ensure data remains synchronized across geographical regions? | Through multi-region quorum writes where a write is acknowledged only after surviving across at least two replica nodes.             | `MV-DOC-01.pdf` | `Cross-zone consistency utilizes a quorum policy where write acknowledgments require W=2 confirmation out of N=3 replicas.`                                    | Medium     | Answerable    |
| **EVAL-Q09** | What safeguards prevent infinite recursion when navigating entity connections?                                    | The graph traversal service enforces a cycle detection guard tracking visited node IDs and aborts after 2500ms.                      | `MV-DOC-05.txt` | `GRAPH_TIMEOUT_MS=2500 and visited set evaluation prevent cyclic loops during multi-hop path traversal.`                                                       | Medium     | Answerable    |
| **EVAL-Q10** | How are high-frequency consumers throttled to avoid cluster degradation?                                          | Tiered rate limiting enforces a 100 requests per minute cap on free accounts and 1000 requests per minute on enterprise tiers.       | `MV-DOC-02.pdf` | `API rate limiting tiers: Free tier permits up to 100 req/min; Enterprise tier allows up to 1000 req/min before returning HTTP 429.`                           | Medium     | Answerable    |
| **EVAL-Q11** | What mechanism guarantees that dropped SSE connections do not leave orphan tasks running?                         | Client disconnection triggers an abort signal that transitions streaming generation into a CANCELLED status.                         | `MV-DOC-04.md`  | `Client socket termination propagates an AbortSignal, terminating upstream LLM generators and marking the record CANCELLED.`                                   | Medium     | Answerable    |
| **EVAL-Q12** | How does the system handle documents where paragraph text exceeds the standard chunk boundary?                    | The chunker splits long paragraphs into sentence units while maintaining a 120-token sliding overlap.                                | `MV-DOC-01.pdf` | `When paragraphs exceed targetTokens (700), recursive boundary decomposition splits on sentence punctuation with 120-token overlap.`                           | Medium     | Answerable    |

#### Category 3: Multi-Document Reasoning (Cross-document synthesis)

| ID           | Question Text                                                                                                                   | Expected Answer                                                                                                                                                                                             | Supporting Docs                   | Verbatim Ground Truth Snippet                                                                                           | Difficulty | Answerability |
| :----------- | :------------------------------------------------------------------------------------------------------------------------------ | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------- | :---------------------------------------------------------------------------------------------------------------------- | :--------- | :------------ |
| **EVAL-Q13** | Does the API gateway database timeout provide enough buffer for a database failover trigger to execute?                         | No. The API gateway database timeout is 5000ms (`MV-DOC-05.txt`), whereas the database failover trigger requires replication lag to exceed 5000ms (`MV-DOC-03.docx`), creating a concurrent race condition. | `MV-DOC-03.docx`, `MV-DOC-05.txt` | `DB_TIMEOUT_MS=5000` / `Automatic primary failover engages when replica lag exceeds 5000ms.`                            | Hard       | Answerable    |
| **EVAL-Q14** | How do the token expiration policy and rate limiting interact for an unauthenticated user attempting API access?                | An unauthenticated request is rejected at the API gateway before rate limiting or token expiration checks, returning HTTP 401.                                                                              | `MV-DOC-02.pdf`, `MV-DOC-04.md`   | `Authentication filter executes prior to rate limiter.` / `Missing Bearer token results in immediate 401 Unauthorized.` | Hard       | Answerable    |
| **EVAL-Q15** | Which global deployment region recorded in the benchmarks satisfies both the p99 latency SLA and the minimum compute unit cost? | Region `eu-west-1` meets the p99 SLA (< 150ms at 138ms) while maintaining the lowest cost at $0.012 per 10k queries.                                                                                        | `MV-DOC-03.docx`, `MV-DOC-06.md`  | `SLA mandates p99 retrieval latency < 150ms.` / `eu-west-1                                                              | p99: 138ms | Cost: $0.012` | Hard | Answerable |
| **EVAL-Q16** | If an incident reaches Severity-1 status, does the on-call engineer have direct permission to rotate tenant cryptographic keys? | No. Severity-1 escalation pages Tier-1 on-call, but cryptographic tenant key rotation is restricted exclusively to the Security Incident Officer.                                                           | `MV-DOC-02.pdf`, `MV-DOC-03.docx` | `Tier-1 on-call manages Sev-1 triage.` / `Tenant encryption key rotation requires Security Incident Officer role.`      | Hard       | Answerable    |
| **EVAL-Q17** | Compare the Raft leader election heartbeat lease against the SSE keep-alive interval. Which is more frequent and by what ratio? | The Raft leader election heartbeat (1500ms) is 10 times more frequent than the SSE keep-alive ping (15 seconds / 15000ms).                                                                                  | `MV-DOC-01.pdf`, `MV-DOC-04.md`   | `Raft heartbeat: 1500ms.` / `SSE keep-alive: 15 seconds.`                                                               | Hard       | Answerable    |
| **EVAL-Q18** | Explain how an ingestion failure due to an oversized document is communicated across the worker queue to the user interface.    | Ingestion worker catches the payload violation (> 25MB), marks document status 'FAILED' with error 'FILE_TOO_LARGE' in the DB, and SSE stream emits an error event.                                         | `MV-DOC-04.md`, `MV-DOC-05.txt`   | `MAX_FILE_SIZE_BYTES=26214400` / `Error event envelope emits code FILE_TOO_LARGE and transitions document to FAILED.`   | Hard       | Answerable    |

#### Category 4: Graph-Assisted Reasoning (Multi-hop relationship path traversal)

| ID           | Question Text                                                                                                                 | Expected Answer                                                                                                                | Supporting Docs                   | Verbatim Ground Truth Snippet                                                                               | Difficulty | Answerability |
| :----------- | :---------------------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------- | :-------------------------------- | :---------------------------------------------------------------------------------------------------------- | :--------- | :------------ |
| **EVAL-Q19** | Which microservice component is directly dependent on the Vector Search Index, and what service monitors its replication lag? | The Hybrid Retrieval Engine depends on the Vector Search Index, while the Incident Health Daemon monitors its replication lag. | `MV-DOC-01.pdf`, `MV-DOC-03.docx` | `Hybrid Retrieval Engine queries Vector Search Index.` / `Incident Health Daemon monitors replication lag.` | Hard       | Answerable    |
| **EVAL-Q20** | Trace the full dependency path from an incoming `/api/rag/stream` request to the physical database storage layer.             | Gateway routes request $\to$ RAGService $\to$ RetrievalService $\to$ pgvector / FTS on PostgreSQL `document_chunks`.           | `MV-DOC-04.md`, `MV-DOC-05.txt`   | `Gateway dispatches to RAGService.` / `RAGService triggers RetrievalService on PostgreSQL document_chunks.` | Hard       | Answerable    |
| **EVAL-Q21** | If the Primary Redis session store fails, which fallback component preserves user authentication state?                       | PostgreSQL session backup table acts as the secondary store, synchronized via write-through cache.                             | `MV-DOC-02.pdf`, `MV-DOC-05.txt`  | `Redis failure triggers failover to PostgreSQL session backup table.`                                       | Hard       | Answerable    |
| **EVAL-Q22** | Identify all services affected if the Security Incident Officer revokes an enterprise tenant's master key.                    | Document decryption in Worker, Vector Search embedding generation, and RAG answer generation are all halted.                   | `MV-DOC-01.pdf`, `MV-DOC-02.pdf`  | `Master key revocation disables document decryption, embedding pipeline, and context assembly.`             | Hard       | Answerable    |
| **EVAL-Q23** | Which downstream consumers receive notification events when a document transitions to 'COMPLETED'?                            | DocumentQueue worker emits completion $\to$ NotificationService dispatches WebSocket push $\to$ GraphExtractionTask triggers.  | `MV-DOC-03.docx`, `MV-DOC-04.md`  | `Status COMPLETED triggers NotificationService WebSocket and schedules GraphExtractionTask.`                | Hard       | Answerable    |
| **EVAL-Q24** | What entities bridge the gap between user role authorization and raw file chunk access?                                       | User $\to$ WorkspaceRole $\to$ Workspace $\to$ Document $\to$ DocumentChunk.                                                   | `MV-DOC-02.pdf`, `MV-DOC-05.txt`  | `RBAC links User via WorkspaceRole to Workspace, gating all child Document and DocumentChunk records.`      | Hard       | Answerable    |

#### Category 5: Unanswerable Questions / Abstention (System MUST refuse)

| ID           | Question Text                                                                                            | Expected Answer                                                                                                                                            | Supporting Docs | Verbatim Ground Truth Snippet                   | Difficulty | Answerability |
| :----------- | :------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------- | :-------------- | :---------------------------------------------- | :--------- | :------------ |
| **EVAL-Q25** | What is the pricing discount percentage for enterprise customers committing to a 3-year contract?        | Based on the provided documents, there is insufficient evidence to answer this question. The documents do not mention pricing discounts or contract terms. | None            | N/A (Information completely absent from corpus) | Medium     | Unanswerable  |
| **EVAL-Q26** | What is the recommended GPU model and VRAM requirement for running local Ollama inference in production? | Based on the provided documents, there is insufficient evidence to answer this question. Hardware specifications for Ollama GPUs are not provided.         | None            | N/A (Hardware specifications absent)            | Medium     | Unanswerable  |
| **EVAL-Q27** | How many employees work in the security incident response team?                                          | Based on the provided documents, there is insufficient evidence to answer this question. Team headcounts are not mentioned.                                | None            | N/A (Staffing numbers absent)                   | Easy       | Unanswerable  |
| **EVAL-Q28** | What is the automated migration procedure from MySQL to MindVault PostgreSQL?                            | Based on the provided documents, there is insufficient evidence to answer this question. MySQL migration procedures are not documented.                    | None            | N/A (MySQL migration absent)                    | Medium     | Unanswerable  |
| **EVAL-Q29** | What is the maximum character limit for user profile biographies?                                        | Based on the provided documents, there is insufficient evidence to answer this question. User profile fields are not specified.                            | None            | N/A (Profile schema absent)                     | Easy       | Unanswerable  |
| **EVAL-Q30** | Which cellular mobile carrier provides failover SMS alerting for Sev-1 pages?                            | Based on the provided documents, there is insufficient evidence to answer this question. Cellular carrier details are not mentioned.                       | None            | N/A (Telecom carriers absent)                   | Easy       | Unanswerable  |

#### Category 6: Ambiguous / Edge-Case Questions (Polysemy & incomplete scope)

| ID           | Question Text                                                                                 | Expected Answer                                                                                                                                                                                                        | Supporting Docs                   | Verbatim Ground Truth Snippet                                                                                   | Difficulty | Answerability |
| :----------- | :-------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------- | :-------------------------------------------------------------------------------------------------------------- | :--------- | :------------ |
| **EVAL-Q31** | What is the timeout value? (Ambiguous antecedent: DB timeout vs. Graph timeout vs. JWT TTL)   | The question is ambiguous as multiple timeouts exist: Database query timeout is 5000ms (`MV-DOC-05.txt`), Graph traversal timeout is 2500ms (`MV-DOC-05.txt`), and JWT token TTL is 15 minutes (`MV-DOC-02.pdf`).      | `MV-DOC-02.pdf`, `MV-DOC-05.txt`  | `DB_TIMEOUT_MS=5000` / `GRAPH_TIMEOUT_MS=2500` / `JWT TTL: 15 minutes.`                                         | Hard       | Ambiguous     |
| **EVAL-Q32** | How fast is the system? (Ambiguous metric: p50 vs. p99, retrieval vs. end-to-end)             | System speed depends on metric and region: In `us-east-1`, p50 retrieval is 42ms and p99 is 112ms (`MV-DOC-06.md`), while end-to-end SLA targets response start within 2000ms (`MV-DOC-03.docx`).                      | `MV-DOC-03.docx`, `MV-DOC-06.md`  | `p50: 42ms, p99: 112ms` / `SLA: Initial token dispatched < 2000ms.`                                             | Hard       | Ambiguous     |
| **EVAL-Q33** | What does the worker do when an error occurs? (Ambiguous: extraction error vs. queue timeout) | If document extraction fails, worker sets status to 'FAILED' with errorMessage (`MV-DOC-05.txt`); if queue timeout occurs, BullMQ retries up to 3 times before moving to dead-letter queue (`MV-DOC-03.docx`).         | `MV-DOC-03.docx`, `MV-DOC-05.txt` | `Extractor error marks document FAILED.` / `Queue timeout triggers 3 retries then DLQ.`                         | Hard       | Ambiguous     |
| **EVAL-Q34** | What permissions does an admin have? (Ambiguous: Workspace Admin vs. System Superadmin)       | Documents distinguish between Workspace Admin (manages workspace documents, users, and API keys within workspace boundary) and Platform Superadmin (manages cluster nodes and global tenant keys).                     | `MV-DOC-02.pdf`                   | `Workspace Admin is scoped strictly to tenant assets; Platform Superadmin oversees physical infrastructure.`    | Hard       | Ambiguous     |
| **EVAL-Q35** | Can I upload a spreadsheet? (Edge case: CSV vs. Excel vs. Markdown table)                     | Raw `.csv` and `.xlsx` files are rejected by the upload API (`document.service.ts`), but tabular data formatted as Markdown tables (`.md`) is fully supported.                                                         | `MV-DOC-04.md`, `MV-DOC-05.txt`   | `Supported extensions: .pdf, .docx, .txt, .md. Spreadsheets must be converted to Markdown.`                     | Medium     | Ambiguous     |
| **EVAL-Q36** | What happens when token limits are reached? (Ambiguous: context window vs. rate limit)        | If user rate limit is reached, gateway returns HTTP 429 (`MV-DOC-02.pdf`); if prompt context budget is reached, ContextAssembler truncates low-ranked chunks according to the 75/25 dual budget rule (`MV-DOC-04.md`). | `MV-DOC-02.pdf`, `MV-DOC-04.md`   | `Rate limit excess yields 429 Too Many Requests.` / `ContextAssembler drops chunks exceeding maxContextTokens.` | Hard       | Ambiguous     |

---

## 10. Proposed Execution Strategy

To transition from the current in-memory test environment to authentic real-world quality validation without modifying production code, a three-stage execution strategy is proposed for Stage 1.2 and Stage 1.3:

```
+----------------------------------------------------------------------------------------------------+
|                                    STAGED EXECUTION ROADMAP                                        |
+----------------------------------------------------------------------------------------------------+
|                                                                                                    |
|  [ Stage 1.2: Test Harness Construction & Corpus Preparation ]                                     |
|  - Stand up test database container with pgvector and pg_trgm enabled.                             |
|  - Generate the 6 evaluation documents (PDF, DOCX, TXT, MD, Markdown-CSV) in `test-corpus/`.       |
|  - Ingest documents through worker pipeline into dedicated evaluation workspace `ws_real_eval`.    |
|  - Verify chunking, embeddings, full-text indexes, and knowledge graph extraction in PostgreSQL.   |
|  - Create standalone test runner: `apps/api/src/modules/evaluation/real-eval.runner.ts`.           |
|                                                                                                    |
+----------------------------------------------------------------------------------------------------+
|                                                |                                                   |
|                                                v                                                   |
+----------------------------------------------------------------------------------------------------+
|  [ Stage 1.3: Quantitative Benchmark Execution & Reporting ]                                       |
|  - Run Retrieval Benchmark:                                                                        |
|    * Execute all 36 queries across Semantic, Keyword, and Hybrid modes.                            |
|    * Calculate Precision@K, Recall@5, MRR@10, nDCG@10.                                             |
|  - Run Generation & Grounding Benchmark:                                                           |
|    * Stream answers via RAGService using live model (Ollama / Gemini).                             |
|    * Measure TTFT, stream latency, token generation rate.                                          |
|    * Evaluate Citation Precision, Citation Completeness, and Grounding Status.                     |
|  - Run LLM-as-a-Judge Evaluation:                                                                  |
|    * Evaluate Answer Correctness against reference answers.                                        |
|    * Evaluate Answer Faithfulness (claim entailment).                                              |
|    * Measure Abstention Accuracy on Category 5 questions.                                          |
|  - Publish comprehensive `REAL_WORLD_RAG_BENCHMARK_REPORT.md`.                                     |
|                                                                                                    |
+----------------------------------------------------------------------------------------------------+
```

### Mathematical Definitions of Target Evaluation Metrics

1. **Recall@5:**
   $$\text{Recall@5} = \frac{|\text{RetrievedChunks}_{1..5} \cap \text{GoldenChunks}|}{|\text{GoldenChunks}|}$$
2. **Mean Reciprocal Rank (MRR@10):**
   $$\text{MRR@10} = \frac{1}{|Q|} \sum_{q=1}^{|Q|} \frac{1}{\min(\{ \text{rank}(c) : c \in \text{GoldenChunks}_q, \text{rank}(c) \le 10 \} \cup \{\infty\})}$$
3. **Citation Precision:**
   $$\text{Citation Precision} = \frac{\text{Number of citations }[S\#]\text{ whose referenced chunk directly entails the preceding claim}}{\text{Total number of citations }[S\#]\text{ in generated answer}}$$
4. **Citation Completeness:**
   $$\text{Citation Completeness} = \frac{\text{Number of factual assertions with valid supporting citations}}{\text{Total number of factual assertions made in generated answer}}$$
5. **Abstention Accuracy (Refusal Rate on Unanswerables):**
   $$\text{Abstention Accuracy} = \frac{\text{True Negatives (Refused on Cat 5)}}{\text{Total Category 5 Questions (6)}}$$
6. **Answer Correctness (Semantic Accuracy):**
   Scored 1 to 5 via LLM-as-a-judge comparing generated answer against expected answer for factual equivalence, absence of hallucinations, and completeness.

---

## 11. Risks and Dependencies

1. **Production Code Modification Boundary:** Safety constraints strictly prohibit modifying production code. If evaluation exposes bugs in chunk boundaries or citation classification, fixes cannot be applied in this validation phase; they must be documented as findings.
2. **Tabular CSV Rejection:** The upload API strictly rejects `.csv`. Attempting to upload raw `.csv` during real-world evaluation will abort the runner with HTTP 400. Converting CSV to Markdown tables (`.md`) is mandatory.
3. **Ollama / Gemini Nondeterminism:** Unlike `MockLLMProvider`, live generative models exhibit slight output variance across runs even at `temperature = 0.2`. Citation tags may vary between `[S1]` and `[S1, S2]`. The evaluation harness must handle equivalent citation sets gracefully.
4. **Local Hardware Constraints & Latency:** Generating 768-dimensional embeddings and running LLM inference for 36 questions locally on CPU or low-end GPU will introduce noticeable latency (10–30 seconds per question). Runner must incorporate per-query timeouts (60s) and progress logging.
5. **Grounding Classifier False Positives:** Because `GroundingService` assigns `PARTIALLY_GROUNDED` whenever fewer citations are used than the number of provided sources (when sources $> 3$), high-precision answers that cite only the most relevant chunk will be penalized unless the evaluation harness evaluates claim-level entailment independently.

---

## 12. Evidence from Actual Source Files and Test Results

The findings in this audit are grounded in direct repository evidence:

1. **File Format Restriction Evidence:**
   - File: [`apps/api/src/modules/document/document.service.ts`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/modules/document/document.service.ts#L17-L26)
   - Lines 17–25: `export const SUPPORTED_EXTENSIONS = ['.pdf', '.docx', '.txt', '.md'] as const;`
   - Lines 71–77: Throws `400 UNSUPPORTED_FILE_TYPE` on extensions outside this list.
   - File: [`apps/worker/src/modules/ingestion/extractors/index.ts`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/worker/src/modules/ingestion/extractors/index.ts#L19-L50)
   - Line 48: Throws `Unsupported document format` for any extension other than PDF, DOCX, MD, TXT.
2. **Chunking Bounds Evidence:**
   - File: [`apps/worker/src/modules/ingestion/chunking/chunker.ts`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/worker/src/modules/ingestion/chunking/chunker.ts#L22-L26)
   - Lines 22–26: `targetTokens: 700`, `maxTokens: 900`, `overlapTokens: 120`.
3. **pgvector Query Evidence:**
   - File: [`apps/api/src/lib/db.ts`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/lib/db.ts#L480-L505)
   - Cosine operator: `1 - (c."embedding" <=> $2::vector) AS score`.
4. **Full-Text Search Evidence:**
   - File: [`apps/api/src/lib/db.ts`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/lib/db.ts#L520-L545)
   - Ranking formula: `ts_rank_cd(c."search_vector", websearch_to_tsquery('english', $2)) AS rank`.
5. **RRF Tie-Breaker Evidence:**
   - File: [`apps/api/src/modules/retrieval/fusion/rrf.fusion.ts`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/modules/retrieval/fusion/rrf.fusion.ts#L80-L100)
   - 4-level comparator sorting on score, sources count, chunk index, and chunk ID.
6. **Context Budgeting Evidence:**
   - File: [`apps/api/src/modules/retrieval/context/context.assembler.ts`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/modules/retrieval/context/context.assembler.ts#L110-L165)
   - Stage 1: 75% narrative floor. Stage 3: 25% graph ceiling with dynamic narrative backfill.
7. **Citation Parsing Regex Evidence:**
   - File: [`apps/api/src/modules/generation/services/citation-validator.service.ts`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/modules/generation/services/citation-validator.service.ts#L20)
   - Line 20: `private static readonly CITATION_REGEX = /\[S(\d+)\]/g;`
8. **Monorepo Test Suite Integrity:**
   - Execution: `pnpm test`
   - Verified result: 750 passing tests across 66 suites, 0 failures.

---

## 13. Explicit Readiness Verdict

### **VERDICT: READY WITH CONDITIONS**

MindVault's core architecture, retrieval algorithms, graph traversal, and citation validation services are fully implemented, strictly typed, and thoroughly covered by unit tests. The platform is ready to undergo real-world RAG validation, subject to the following two binding conditions:

### Binding Conditions:

1. **Condition C1 — Tabular Ingestion Format Protocol:**
   - Because production code rejects `.csv` files at the API boundary (`document.service.ts` line 71) and production modifications are strictly prohibited, all tabular evaluation data must be ingested as formatted Markdown tables (`.md`) or tab-delimited text (`.txt`).
2. **Condition C2 — Isolated Real-World Test Harness:**
   - Stage 1.2 validation must not compromise existing in-memory regression tests. A standalone test runner (`apps/api/src/modules/evaluation/real-eval.runner.ts`) must be deployed that connects directly to a live PostgreSQL instance (with pgvector) and real embedding/LLM providers (Ollama or Gemini) to execute the 36-question evaluation suite.

---

_End of Audit Report — Awaiting explicit user authorization before proceeding to Stage 1.2._
