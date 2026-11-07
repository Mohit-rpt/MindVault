# MindVault — RAG Pipeline & Retrieval Architecture Audit

**Audit Date:** November 7, 2026  
**Auditor:** Principal RAG Engineer & Senior Systems Architect  
**Components Evaluated:** Ingestion, Chunking, Embeddings, Hybrid Retrieval, Fusion, Reranking, Generation, Citations, Conversational Memory

---

## 1. End-to-End Information Retrieval Pipeline Flow

```mermaid
flowchart TD
    subgraph Ingestion Pipeline (BullMQ Worker)
        RawDoc["Raw Document File (PDF/DOCX/MD/TXT)"] --> Extract["Document Extractor (pdf-parse / mammoth)"]
        Extract --> Norm["Text Normalizer (NFKC, Clean Whitespace)"]
        Norm --> Chunk["Recursive Chunker (500 tokens, 10% overlap)"]
        Chunk --> EmbedGen["Embedding Service (bge-m3, 768d)"]
        EmbedGen --> PGStore["PostgreSQL Storage (pgvector + tsvector)"]
    end

    subgraph Retrieval Pipeline (API)
        UserQuery["User Natural Query"] --> QueryContext["Query Context Service (Anaphora & History Rewrite)"]
        QueryContext --> CleanQuery["Contextualized Query"]
        CleanQuery --> EmbedQuery["Vector Embedding"]
        CleanQuery --> FTSQuery["Full-Text Query (plainto_tsquery)"]

        EmbedQuery --> DenseSearch["Dense HNSW Cosine Search (Top 20)"]
        FTSQuery --> SparseSearch["Sparse GIN FTS Search (Top 20)"]

        DenseSearch --> RRF["Reciprocal Rank Fusion (k=60)"]
        SparseSearch --> RRF

        RRF --> Rerank["Reranker Layer (NoOp / Cross-Encoder)"]
        Rerank --> Assembler["Context Assembler (Token Budget & [Sn] Attribution)"]
    end

    subgraph Generation & Validation Pipeline (API)
        Assembler --> PromptBuild["Conversational Prompt Builder (Context Boundaries)"]
        PromptBuild --> LLM["LLM Generation (Gemini 2.5 Flash / Ollama)"]
        LLM --> StreamSSE["SSE Stream to Client"]
        LLM --> CitVal["Citation Validator & Grounding Classifier"]
        CitVal --> Finalize["Persist ChatMessage with Citations"]
    end
```

---

## 2. Ingestion Subsystem Audit

### 2.1 File Extraction Engine

Located in `apps/worker/src/modules/ingestion/extractors/`:

- **`PdfExtractor`**: Uses `pdf-parse` (v1.1.1). Extracts raw text page by page.
  - _Limitation:_ Does not parse images, OCR scanned pages, or maintain complex multi-column table layouts.
- **`DocxExtractor`**: Uses `mammoth` (v1.8.0). Converts DOCX to raw text and semantic HTML structures.
- **`MarkdownExtractor`**: Uses `marked` (v14.1.4). Preserves markdown section hierarchy and headings into chunk metadata.
- **`TextExtractor`**: UTF-8 plain text decoder with invalid byte replacement.

### 2.2 Normalization & Chunking

- **`TextNormalizer`** (`apps/worker/src/modules/ingestion/normalizer.ts`):
  - Normalizes Unicode to standard **NFKC** form.
  - Strips null characters (`\0`) and non-printable control characters.
  - Collapses redundant consecutive whitespace and tabs while preserving paragraph breaks.
- **`RecursiveCharacterChunker`** (`apps/worker/src/modules/ingestion/chunker.ts`):
  - Target chunk size: **500 tokens** (approx. 2000 characters).
  - Chunk overlap: **50 tokens** (10%).
  - Hierarchy separators: `["\n\n", "\n", ". ", "? ", "! ", " ", ""]`.
  - Heading preservation: Attaches nearest active section heading to chunk metadata (`metadata.heading`).

---

## 3. Retrieval & Hybrid Search Subsystem Audit

### 3.1 Embedding Model & Vector Space

- **Model:** `bge-m3` via Ollama (`http://localhost:11434/api/embeddings`) or `MockEmbeddingProvider` in test suites.
- **Vector Dimension:** **768** dimensions (`vector(768)` in PostgreSQL).
- **Metric:** Cosine distance (`<=>` operator in pgvector).

### 3.2 Full-Text Search (FTS)

- **Engine:** PostgreSQL native `tsvector` with English dictionary configuration (`to_tsvector('english', content)`).
- **Index:** GIN index on `search_vector`.
- **Ranking:** `ts_rank_cd(search_vector, plainto_tsquery('english', $1))` with cover density calculation.

### 3.3 Reciprocal Rank Fusion (RRF)

- Implemented in `apps/api/src/modules/retrieval/services/rrf.service.ts`.
- Formula:
  $$\text{RRF Score}(d) = \sum_{m \in \{\text{dense}, \text{sparse}\}} \frac{1}{k + \text{rank}_m(d)}$$
  where $k = 60$.
- Deduplication: Chunks appearing in both dense and sparse candidate lists receive boosted combined scores.

### 3.4 Reranker Implementation

- Located in `apps/api/src/modules/retrieval/reranking/reranker.service.ts`.
- **Current State:** Default is `NoOpRerankerProvider` which preserves RRF ranking order.
- **External Support:** An interface `IRerankerProvider` exists with configuration hooks for external cross-encoder endpoints (e.g. BGE-Reranker-Large), but no local model inference is bundled in the default Docker stack.

---

## 4. Evaluation Benchmark Results

The retrieval and RAG evaluation benchmarks were executed on the active codebase with the following quantitative outcomes:

### 4.1 Information Retrieval Benchmark (`pnpm retrieval:evaluate`)

Evaluated across 10 deterministic golden retrieval queries on the test corpus:

| Retrieval Method              | Mean Reciprocal Rank (MRR) | Hit Rate @ 3 | Hit Rate @ 5 | Latency (avg) |
| ----------------------------- | -------------------------- | ------------ | ------------ | ------------- |
| **Dense Vector (HNSW)**       | **0.517**                  | 70.0%        | 80.0%        | 14.2ms        |
| **Sparse Keyword (GIN FTS)**  | **1.000**                  | 100.0%       | 100.0%       | 8.6ms         |
| **Hybrid RRF (Vector + FTS)** | **0.767**                  | 90.0%        | 100.0%       | 18.5ms        |

_Finding:_ Keyword search demonstrates 1.000 MRR on exact keyword matches in the golden dataset. Hybrid RRF balances semantic recall with lexical precision, achieving 100% Hit Rate @ 5.

### 4.2 Generation & Grounding Benchmark (`pnpm rag:evaluate`)

Evaluated across 5 validation scenarios:

| Metric                            | Target   | Actual Result                      | Verification Status |
| --------------------------------- | -------- | ---------------------------------- | ------------------- |
| **Citation Validity Rate**        | >= 95.0% | **100.0%** (12/12 valid citations) | **PASS**            |
| **Insufficient Evidence Refusal** | 100.0%   | **100.0%** (Triggered refusal)     | **PASS**            |
| **Prompt Injection Containment**  | 100.0%   | **100.0%** (Boundaries respected)  | **PASS**            |
| **Hallucinated Citation Rate**    | 0.0%     | **0.0%** (Zero phantom brackets)   | **PASS**            |
| **Average End-to-End Latency**    | < 30.0s  | **20.2s** (Ollama local inference) | **PASS**            |

### 4.3 Conversational RAG & Memory Benchmark (`pnpm conversation:evaluate`)

Evaluated across 15 conversational multi-turn scenarios:

| Category                    | Scenarios Tested | Passed | Failed        | Pass Rate |
| --------------------------- | ---------------- | ------ | ------------- | --------- |
| Single-Turn Baseline        | 1                | 1      | 0             | 100%      |
| Pronoun Resolution          | 1                | 1      | 0             | 100%      |
| Demonstrative Resolution    | 1                | 0      | 1 (`scen_03`) | **0%**    |
| Elliptical Follow-Up        | 1                | 1      | 0             | 100%      |
| Comparative Follow-Up       | 1                | 1      | 0             | 100%      |
| Topic Shift Detection       | 1                | 1      | 0             | 100%      |
| Topic Return                | 1                | 1      | 0             | 100%      |
| Multiple Antecedents        | 1                | 1      | 0             | 100%      |
| Ambiguous Reference         | 1                | 1      | 0             | 100%      |
| Self-Contained              | 1                | 1      | 0             | 100%      |
| Rolling Summarization       | 1                | 1      | 0             | 100%      |
| Adversarial Containment     | 1                | 1      | 0             | 100%      |
| Workspace Isolation         | 1                | 1      | 0             | 100%      |
| Abort / Disconnect Recovery | 1                | 1      | 0             | 100%      |
| Conversation Lifecycle      | 1                | 1      | 0             | 100%      |
| **Overall Benchmark**       | **15**           | **14** | **1**         | **93.3%** |

_Root Cause of `scen_03` Failure:_
`apps/api/src/modules/conversations/evaluation/conversation.eval.dataset.ts` line 100 declares:

```typescript
expectedResolvedTerms: ['rrf', 'reciprocal rank fusion'];
```

The rewrite engine produced `"Tell me more about Reciprocal Rank Fusion for search technique and its formula."`, successfully expanding the demonstrative `"that technique"` into the explicit full phrase `"Reciprocal Rank Fusion for search"`. However, because it did not also append the acronym `"rrf"`, the strict `.every()` assertion failed.

---

## 5. Architectural Gaps for Phase 6 Knowledge Graph

The current RAG pipeline is purely **chunk-centric**. To support Knowledge Graph (GraphRAG), the following components are currently absent:

1. **Entity & Relation Extraction:** No LLM or rule-based pipeline extracts entities (Nodes) or relations (Edges) during ingestion.
2. **Entity Resolution / Disambiguation:** No component resolves synonyms or links identical entities across multiple chunks.
3. **Graph Retrieval & Traversal:** Retrieval queries only search chunks via vector/FTS; there is no 1-hop or 2-hop neighborhood expansion or graph traversal.
4. **Graph-Augmented Prompting:** Prompts format evidence strictly as `[S1] Document Name (Chunk 0): ...`; no graph triple representation (e.g. `(Subject) -[RELATION]-> (Object)`) is formatted into the prompt context.
