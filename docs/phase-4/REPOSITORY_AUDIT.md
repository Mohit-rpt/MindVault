# MindVault — Phase 4 Repository Audit & Pre-Flight Verification

**Date:** 2026-11-06  
**Auditor:** Lead Systems & AI Engineer  
**Objective:** Technical pre-flight audit for Phase 4 (Generative RAG Engine, Evidence Synthesis & Streaming Answers)  
**Baseline Git Commits:** `0a179e3` (Phase 3 implementation), `145736d` (Phase 3 verification audit)

---

## 1. System Architecture Overview

MindVault is organized as a pnpm monorepo with strict TypeScript typing, modular packages, and workspace isolation:

- **Frontend (`apps/web`):** React 18, Vite, Tailwind CSS, Lucide icons.
- **Backend API (`apps/api`):** Node.js 22, Express, Prisma ORM, pgvector, Zod, JWT/HttpOnly cookie auth.
- **Background Worker (`apps/worker`):** BullMQ, Redis, document ingestion pipeline (PDF, DOCX, TXT, Markdown).
- **Shared Package (`packages/shared`):** Contracts, DTOs, schemas, and shared interfaces (`@mindvault/shared`).

```
                    ┌─────────────────────────┐
                    │  React Web Application  │
                    │   (KnowledgeAssistant)  │
                    └────────────┬────────────┘
                                 │ HTTP POST /api/rag/stream (SSE)
                                 ▼
                    ┌─────────────────────────┐
                    │    Express API Gateway  │
                    │    Auth & RBAC Guards   │
                    └────────────┬────────────┘
                                 │
                   ┌─────────────┴─────────────┐
                   ▼                           ▼
        ┌──────────────────────┐    ┌──────────────────────┐
        │   RetrievalEngine    │    │      RAGService      │
        │ - Hybrid Search(RRF) │    │ - Evidence Assembler │
        │ - pgvector (768d)    │    │ - Prompt Builder     │
        │ - PostgreSQL FTS     │    │ - LLMProvider Adapter│
        │ - Citation Headers   │    │ - Citation Validator │
        └──────────────────────┘    │ - Grounding Checker  │
                                    └──────────┬───────────┘
                                               │
                                               ▼
                                    ┌──────────────────────┐
                                    │     LLMProvider      │
                                    │ - OllamaProvider     │
                                    │   (qwen3:0.6b)       │
                                    │ - MockLLMProvider    │
                                    └──────────────────────┘
```

---

## 2. Retrieval Service Integration Points

The Phase 4 RAG engine builds directly upon the Phase 3 retrieval engine without duplicating retrieval logic:

- **Service Entrypoint:** [`RetrievalService.executeSearch(workspaceId, request)`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/modules/retrieval/services/retrieval.service.ts#L30)
- **Request Contract (`SearchRequest`):**
  - `query: string` (required, 1–1000 characters)
  - `mode?: 'hybrid' | 'semantic' | 'keyword'` (default: `'hybrid'`)
  - `topK?: number` (default: `10`, range 1–50)
  - `filters?: { documentIds?, fileTypes?, pageStart?, pageEnd? }`
  - `enableReranking?: boolean` (default: `false`)
  - `includeContext?: boolean` (default: `true`)
  - `maxContextTokens?: number` (default: `3000`)
- **Response Contract (`SearchResponse`):**
  - `results: SearchResultItem[]` (ranked chunks, cosine similarity / FTS cover density scores, RRF consensus)
  - `context: SearchContextDto` (`content: string`, `tokenEstimate: number`, `sources: ContextSourceItem[]`)
  - `metadata: SearchMetadataDto` (telemetry timings, modal flags, reranking flag)

---

## 3. Context and Citation Formatting

Retrieved evidence is assembled by [`ContextAssembler`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/modules/retrieval/context/context.assembler.ts) using bracketed citation identifiers (`[S1]`, `[S2]`, etc.).

Each source block adheres to the strict template:

```text
--- SOURCE [S1] | Document: machine_learning_fundamentals.pdf (Chunk: 2) | Page: pp. 4-5 | Section: "Backpropagation and Gradient Descent" ---
Backpropagation computes the gradient of the loss function with respect to the weights of the neural network using the chain rule.
```

Authoritative server-side metadata fields retained per source:

- `citationId`: `"[S1]"`
- `documentId`: UUID of source document
- `documentName`: Original file name (e.g. `"annual_report.pdf"`)
- `chunkId`: UUID of chunk
- `chunkIndex`: Ordinal index within the document
- `pageNumber`: Starting page number (or null if unpaged)
- `pageRange`: Formatted page range string (e.g. `"pp. 4-5"` or `"p. 1"`)
- `section`: Heading or markdown section (or null)
- `retrievalSources`: `['semantic', 'keyword']`

---

## 4. Available Model Providers & Local Ollama Audit

Inspected local Ollama instance on `http://127.0.0.1:11434`:

1. **Embedding Model (Dedicated — Never used for Generation):**
   - Name: `nomic-embed-text:latest`
   - Purpose: 768-dimensional document and query vector representations.
   - Status: Active and verified in Phase 3 verification audit.
2. **Installed Completion Models Available for Generation:**
   - **`qwen3:0.6b` (Selected Primary Local Generation Model):**
     - Parameter size: **751.63M** (Quantization: `Q4_K_M`)
     - Disk size: **522.6 MB**
     - Capabilities: `["completion", "tools", "thinking"]`
     - Context length: **40,960 tokens**
     - Suitability: Highly efficient, runs on CPU with minimal RAM (<1 GB), ideal for fast local RAG answers on modest hardware.
   - **`qwen3:1.7b` (Secondary Higher-Capacity Model):**
     - Parameter size: **2.0B** (Quantization: `Q4_K_M`)
     - Disk size: **1.35 GB**
     - Context length: **40,960 tokens**

---

## 5. Current Infrastructure & Database Status

| Component                 |           Status           | Operational Notes                                                                                                                                                                                                             |
| :------------------------ | :------------------------: | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **PostgreSQL + pgvector** | **Schema Ready (Offline)** | Port 5432 is closed because Docker Desktop service is stopped and requires elevated Windows permissions. Dual-service architecture enables full test execution via `InMemoryDatabaseService` while Prisma schema is verified. |
| **Redis**                 |       **Configured**       | Configured for `localhost:6379` for BullMQ asynchronous ingestion.                                                                                                                                                            |
| **Ollama**                |     **LIVE & ACTIVE**      | Running on `http://127.0.0.1:11434` with `nomic-embed-text:latest` and `qwen3:0.6b`.                                                                                                                                          |

### Database Optimization: FTS Index Alignment

In the Phase 3 Final Verification Audit, a dual GIN index redundancy was identified:

- `document_chunks_search_vector_idx` on generated column `search_vector`.
- `document_chunks_content_fts_idx` on expression `to_tsvector('english', "content")`.
- Optimization: In `apps/api/src/lib/db.ts`, update `searchKeywordChunks` SQL to query `c."search_vector" @@ websearch_to_tsquery('english', $2)` directly, utilizing the pre-indexed stored column and creating migration `20261106000001_optimize_fts_index` to drop the redundant expression index.

---

## 6. Required Environment Variables

New environment variables added to `apps/api/src/config/env.ts` with Zod validation:

```bash
# Phase 4: Generative RAG & LLM Provider Configuration
LLM_PROVIDER=ollama                     # 'ollama' | 'mock'
OLLAMA_BASE_URL=http://localhost:11434  # URL to Ollama daemon
OLLAMA_GENERATION_MODEL=qwen3:0.6b      # Generation model identifier
LLM_REQUEST_TIMEOUT=60000               # 60 seconds generation timeout
LLM_MAX_OUTPUT_TOKENS=1024              # Maximum response tokens
LLM_TEMPERATURE=0.2                     # Low temperature for factual grounding
```

---

## 7. Identified Architectural Constraints & Limitations

1. **Stateless Q&A Only:** In accordance with Phase 4 scope boundaries, conversational multi-turn memory and chat history are explicitly deferred to a future phase.
2. **Estimated Token Counting:** Token budgets are enforced through character/word heuristics rather than exact BPE tokenizers. We reserve a safety margin (500 tokens) to guarantee context window compliance.
3. **Grounding Scope:** Citation validation proves that citation IDs referenced in the response match genuinely retrieved chunks. It does not perform semantic entailment checking; statuses will be honestly reported as `GROUNDED`, `PARTIALLY_GROUNDED`, `INSUFFICIENT_EVIDENCE`, or `CITATION_INVALID`.
