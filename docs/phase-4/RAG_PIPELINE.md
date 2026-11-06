# MindVault — Phase 4 RAG Pipeline & Orchestration

**Date:** 2026-11-06  
**Status:** Implemented & Verified  
**Scope:** Pipeline Lifecycle, Token Budgeting Heuristics, Context Assembly, and Answer Synthesis

---

## 1. Pipeline Execution Phases

The RAG pipeline implemented in [`RAGService`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/modules/generation/services/rag.service.ts) follows six discrete phases:

```
[1. Request Ingress] ──► [2. Hybrid Retrieval] ──► [3. Context Assembly]
                                                         │
                                                         ▼
[6. Response Emission] ◄── [5. Post-Validation]  ◄── [4. Generation]
```

### Phase 1: Request Ingress & Parameter Derivation

The caller submits a `RAGAnswerRequestDto` containing:

- `query`: The natural language question (1–1000 characters)
- `mode`: Retrieval mode (`hybrid`, `semantic`, or `keyword`)
- `topK`: Candidate count (default: 5, range 1–20)
- `filters`: Optional constraints (document IDs, file types, page bounds)
- `maxContextTokens`: Maximum token allocation for evidence context (default: 3000)
- `temperature`: LLM generation temperature (default: 0.2)

### Phase 2: Tenant-Isolated Hybrid Retrieval

The query is dispatched to [`RetrievalService.executeSearch()`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/modules/retrieval/services/retrieval.service.ts). All operations run within the tenant's workspace boundary (`workspaceId`). Chunks are retrieved via vector cosine distance (pgvector) and PostgreSQL full-text search (tsvector), fused via Reciprocal Rank Fusion (RRF with $k=60$).

### Phase 3: Context Assembly & Zero-Evidence Short-Circuit

The retrieved chunks are assembled by [`ContextAssembler`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/modules/retrieval/context/context.assembler.ts).

- If `searchResponse.results.length === 0`: The pipeline terminates immediately without invoking the LLM:
  - **Returned Text:** `"I cannot find sufficient evidence in the provided documents to answer your question."`
  - **Grounding Status:** `INSUFFICIENT_EVIDENCE`
  - **Generation Latency:** `0 ms`

### Phase 4: Prompt Construction & LLM Generation

If evidence is present, [`rag.prompt.ts`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/modules/generation/prompts/rag.prompt.ts) constructs the prompt enclosing the assembled sources inside untrusted context delimiters. The active [`LLMProvider`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/modules/generation/providers/llm.provider.ts) generates the response either in batch mode (`generate`) or streaming mode (`generateStream`).

### Phase 5: Citation Parsing & Grounding Evaluation

The generated text is submitted to:

1. [`CitationValidatorService`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/modules/generation/services/citation-validator.service.ts): Identifies all `[S1]`, `[S2]` tokens and categorizes them into valid citations, unknown/hallucinated citations, and unused retrieved sources.
2. [`GroundingService`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/modules/generation/services/grounding.service.ts): Evaluates the relationship between the answer text, the citations, and the retrieved context to assign a deterministic `GroundingStatus`.

### Phase 6: Response Finalization & Telemetry

The pipeline bundles the answer text, cited source metadata, validation metrics, and timing breakdown into `RAGAnswerResponseDto` or emits the final `done` event over SSE.

---

## 2. Token Budgeting Heuristics

MindVault provides an explicit, character-to-token estimation heuristic rather than relying on an ungrounded or slow Python-based tokenizer in the hot path.

### Token Estimation Formula

```typescript
export function estimateTokens(text: string): number {
  if (!text) return 0;
  // Standard English heuristic: 1 token ≈ 4 characters or ~0.75 words
  return Math.ceil(text.length / 4);
}
```

### Context Budget Enforcement

The [`ContextAssembler`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/modules/retrieval/context/context.assembler.ts) packs chunks into the context in descending order of their RRF rank score. Before appending a chunk, it calculates the cumulative estimated token count. If appending the chunk would exceed `maxContextTokens`, the chunk is excluded, ensuring prompt limits are never exceeded.
