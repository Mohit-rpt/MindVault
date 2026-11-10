# MindVault Phase 6.6 — Task 6.6.2.2 Architecture Clarification Addendum

**Milestone:** Phase 6.6 — GraphRAG Retrieval  
**Task:** 6.6.2.2 — Graph Retrieval Channel Service (`GraphRetrievalService`) & `RetrievalService` Integration  
**Mode:** STRICT READ-ONLY CLARIFICATION AUDIT  
**Implementation Authorization:** NOT GRANTED  
**Date:** 2026-11-09  
**Reference Document:** [`PHASE_6_6_2_2_READINESS_AUDIT.md`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/PHASE_6_6_2_2_READINESS_AUDIT.md)  
**Deliverable:** `PHASE_6_6_2_2_CLARIFICATION_ADDENDUM.md`

---

## 1. Executive Summary

This architecture clarification addendum provides rigorous, unambiguous resolutions to four architectural areas identified during the review of [`PHASE_6_6_2_2_READINESS_AUDIT.md`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/PHASE_6_6_2_2_READINESS_AUDIT.md):

1. **Channel-Level Failure Isolation:** An exhaustive 8-state truth table defining exact system behavior when 1, 2, or 3 channels fail, guaranteeing that infrastructure failures never produce false empty search results and that graph fail-soft behavior never masks core channel outages.
2. **Retrieval Mode Contracts:** Definitive behavioral specifications for all five retrieval modes (`semantic`, `keyword`, `hybrid`, `graph`, `graphrag`), establishing query vector requirements and proving seed discovery equivalence between `graph` and `graphrag`.
3. **Query Embedding Lifecycle:** Verification that embedding generation occurs at most once per request, is shared concurrently across Channel 1 (Vector) and Channel 3 (Graph Seeds), and is never redundantly computed by `GraphRetrievalService`.
4. **Security & Tenancy Proof:** Formal end-to-end verification of workspace isolation across all 7 participating database tables, query stages, and candidate construction.

### Final Clarification Verdict: **READY FOR IMPLEMENTATION AUTHORIZATION**

---

## 2. Channel-Level Failure Isolation Matrix

### 2.1 The Core Channel vs. Enrichment Channel Principle

MindVault's retrieval architecture establishes a clear separation of responsibility between **Bedrock Channels** and the **Graph Enrichment Channel**:

- **Bedrock Channels (Semantic & Keyword):** Dense vector search and sparse full-text search constitute the foundational search engine. If an infrastructure defect occurs in PostgreSQL pgvector or full-text indexing, the system MUST NOT silently swallow the error or pretend the search executed cleanly. Doing so would turn a critical database outage into a **false empty search result** (`results: []`), deceiving users into believing no relevant documents exist in their workspace.
- **Graph Enrichment Channel (Knowledge Graph Evidence):** The knowledge graph represents an advanced structural layer with multi-hop recursive joins and an explicit statement timeout (`2500ms`). In `graphrag` mode, graph expansion is **fail-soft**: if graph traversal times out or encounters a transient failure, the system catches the error, logs a warning, records telemetry error metadata, and continues serving the user using the surviving Bedrock channels.
- **Rule of Non-Suppression:** Graph fail-soft handling applies **exclusively** to Channel 3 (Graph). It must never intercept, catch, or suppress errors originating from Channel 1 (Semantic) or Channel 2 (Keyword).

---

### 2.2 Exhaustive 8-State Failure Matrix (`mode: 'graphrag'`)

Let $S_1$ (Semantic), $S_2$ (Keyword), and $S_3$ (Graph) represent the execution states of the three concurrent retrieval channels:

| State | Channel 1: Semantic | Channel 2: Keyword |  Channel 3: Graph   | Pipeline Outcome                       | HTTP Status | Telemetry Metadata                                                                                             | Result Payload & User Impact                                                                           |
| :---: | :-----------------: | :----------------: | :-----------------: | :------------------------------------- | :---------: | :------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------- |
| **1** |       **OK**        |       **OK**       |       **OK**        | **FULL SUCCESS**                       |   **200**   | `semanticSearchUsed: true`<br>`keywordSearchUsed: true`<br>`graphSearchUsed: true`                             | Complete 3-way RRF fused results with multi-channel corroboration and graph provenance.                |
| **2** |       **OK**        |       **OK**       | **FAIL (Timeout)**  | **DEGRADED SUCCESS (Fail-Soft Graph)** |   **200**   | `semanticSearchUsed: true`<br>`keywordSearchUsed: true`<br>`graphSearchUsed: false`<br>`graphError: 'TIMEOUT'` | Full 2-way RRF fused results (`semantic` + `keyword`). Log warning recorded. Zero false empty results. |
| **3** |       **OK**        |       **OK**       | **FAIL (DB Error)** | **DEGRADED SUCCESS (Fail-Soft Graph)** |   **200**   | `semanticSearchUsed: true`<br>`keywordSearchUsed: true`<br>`graphSearchUsed: false`<br>`graphError: 'FAILED'`  | Full 2-way RRF fused results (`semantic` + `keyword`). Log warning recorded. Zero false empty results. |
| **4** |      **FAIL**       |       **OK**       |       **OK**        | **FAIL-HARD (Core Failure)**           |   **500**   | N/A (Transaction/Query Rejection)                                                                              | Pipeline throws `AppError(500, 'SEMANTIC_SEARCH_FAILED')`. Semantic outage is **not** suppressed.      |
| **5** |      **FAIL**       |       **OK**       |      **FAIL**       | **FAIL-HARD (Core Failure)**           |   **500**   | N/A (Transaction/Query Rejection)                                                                              | Pipeline throws `AppError(500, 'SEMANTIC_SEARCH_FAILED')`.                                             |
| **6** |       **OK**        |      **FAIL**      |       **OK**        | **FAIL-HARD (Core Failure)**           |   **500**   | N/A (Transaction/Query Rejection)                                                                              | Pipeline throws `AppError(500, 'KEYWORD_SEARCH_FAILED')`. Keyword outage is **not** suppressed.        |
| **7** |       **OK**        |      **FAIL**      |      **FAIL**       | **FAIL-HARD (Core Failure)**           |   **500**   | N/A (Transaction/Query Rejection)                                                                              | Pipeline throws `AppError(500, 'KEYWORD_SEARCH_FAILED')`.                                              |
| **8** |      **FAIL**       |      **FAIL**      |       **ANY**       | **FAIL-HARD (Total Outage)**           |   **500**   | N/A (Transaction/Query Rejection)                                                                              | Pipeline throws `AppError(500, 'RETRIEVAL_PIPELINE_ERROR')`. Zero false empty results.                 |

---

### 2.3 Single-Channel and Two-Channel Mode Failure Rules

For non-`graphrag` modes, failure isolation is strictly fail-hard:

- **`mode === 'semantic'`:** If vector search fails $\implies$ Throws HTTP 500.
- **`mode === 'keyword'`:** If lexical search fails $\implies$ Throws HTTP 500.
- **`mode === 'hybrid'`:** If either vector search OR lexical search fails $\implies$ Throws HTTP 500 (100% backward compatibility with Phase 3).
- **`mode === 'graph'`:** If graph retrieval times out $\implies$ Throws HTTP 504 [`GraphTraversalTimeoutError`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/modules/graph/errors/graph-traversal.error.ts#L3). If graph repository fails $\implies$ Throws HTTP 500. It does **not** fall back to vector or keyword search because the user explicitly requested graph-only evidence.

---

### 2.4 Natural Zero-Match Handling vs. Infrastructure Failure

To prevent false empty results:

1. **Natural Zero-Match:** All active channels execute without database errors, but return empty candidate lists because no matching terms, vectors, or graph entities exist in the workspace.
   - Response: Returns HTTP 200 with `results: []`, `totalResults: 0`. This is legitimate search behavior.
2. **Infrastructure Failure:** A database query rejects or times out.
   - In `graphrag` mode: If graph fails, surviving Bedrock channels (`semantic` + `keyword`) produce the response. If both Bedrock channels also return 0 candidates, the response returns `results: []` with `graphError: 'TIMEOUT' | 'FAILED'` clearly annotated in metadata so clients know graph retrieval was unavailable.
   - If a Bedrock channel fails: It throws an HTTP 500 error immediately. Under no circumstances will a broken pgvector or tsvector query return an HTTP 200 with `results: []`.

---

## 3. Retrieval Mode Contracts

MindVault supports five distinct retrieval modes. All existing modes (`semantic`, `keyword`, `hybrid`) retain 100% identical behavioral and contractual compatibility.

### 3.1 Contract Comparison Matrix

| Property                        |      `semantic`       |       `keyword`       |                `hybrid`                |           `graph`            |                  `graphrag`                  |
| :------------------------------ | :-------------------: | :-------------------: | :------------------------------------: | :--------------------------: | :------------------------------------------: |
| **Channel 1: Vector Search**    |      **Active**       |       Inactive        |               **Active**               |           Inactive           |                  **Active**                  |
| **Channel 2: Keyword Search**   |       Inactive        |      **Active**       |               **Active**               |           Inactive           |                  **Active**                  |
| **Channel 3: Graph Retrieval**  |       Inactive        |       Inactive        |                Inactive                |          **Active**          |                  **Active**                  |
| **Query Embedding Required?**   |        **YES**        |        **NO**         |                **YES**                 |           **YES**            |                   **YES**                    |
| **Embedding Generation Count**  |         **1**         |         **0**         |                 **1**                  |            **1**             |                    **1**                     |
| **Seed Discovery Strategy**     |          N/A          |          N/A          |                  N/A                   | Canonical + Alias + Semantic |         Canonical + Alias + Semantic         |
| **Graph Statement Timeout**     |          N/A          |          N/A          |                  N/A                   |    **2500ms (Fail-Hard)**    |            **2500ms (Fail-Soft)**            |
| **Fusion Algorithm**            | None (Single Channel) | None (Single Channel) |           2-Way RRF ($k=60$)           |    None (Single Channel)     |              3-Way RRF ($k=60$)              |
| **Candidate Slicing / topK**    |       $\le 50$        |       $\le 50$        |                $\le 50$                |           $\le 50$           |                   $\le 50$                   |
| **Supported Sources in DTO**    |    `['semantic']`     |     `['keyword']`     | `['semantic']`, `['keyword']`, or both |         `['graph']`          | Subset of `['semantic', 'keyword', 'graph']` |
| **`metadata.graph` Populated?** |          No           |          No           |                   No                   |           **YES**            |    **YES** (if chunk has graph evidence)     |

---

### 3.2 Does Graph-Only Retrieval Require Query Embeddings?

> **Architectural Ruling: YES.**  
> In `mode === 'graph'`, query vector generation is **MANDATORY** and executes exactly once.

#### Justification:

The Task 6.6.1 seed discovery engine ([`buildSeedDiscoveryQuery`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/modules/graph/queries/graph-retrieval.sql.ts#L16-L110)) combines three matching strategies:

1. **Canonical Lexical Match:** Exact match against `graph_entities.normalized_name` ($1.0$).
2. **Alias Lexical Match:** Exact match against `graph_entity_aliases.normalized_alias` ($0.95$).
3. **Semantic Vector Match:** Cosine similarity against `graph_entities.embedding` with threshold $\ge 0.70$.

If `mode === 'graph'` did not generate a query vector:

- A user searching for a paraphrased concept (e.g., _"durable log buffer mechanism"_) would fail to match the canonical name _"Write-Ahead Logging"_ or its alias _"WAL"_.
- The query would discover 0 seeds and return an empty result, crippling graph retrieval for conceptual queries.
- Providing `queryVector` allows semantic seed discovery to locate the anchor entity with score $\approx 0.82$, triggering 2-hop traversal and returning all substantiating document chunks.

#### Seed Discovery Equivalence:

The seed discovery logic, parameters, and algorithms are **100% IDENTICAL** between `mode === 'graph'` and `mode === 'graphrag'`:

```typescript
const seeds = await this.graphRepo.discoverEntitySeeds({
  workspaceId,
  ngrams,
  queryVector, // Shared 768-dim vector
  maxSeeds: 5,
});
```

---

## 4. Query Embedding Lifecycle

### 4.1 Strict Lifecycle Invariants

1. **At Most Once per Request:** Embedding inference occurs at most once during any search request.
2. **Single Injection Point:** Generation is performed exclusively inside `RetrievalService.executeSearch()`.
3. **Zero Redundancy in `GraphRetrievalService`:** `GraphRetrievalService` never imports or invokes [`EmbeddingService`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/modules/retrieval/embeddings/embedding.service.ts). It accepts an optional `queryVector?: number[]` in its options interface.
4. **Zero Generation in Keyword Mode:** If `mode === 'keyword'`, embedding generation is bypassed entirely (0 ms latency overhead, 0 API tokens consumed).
5. **Fail-Hard on Embedding Failure:** If embedding generation fails (e.g., Ollama offline or embedding service unavailable), the error immediately bubbles up to the controller as HTTP 500/503. It is never silently caught or converted to an empty search result.

---

### 4.2 Lifecycle Flow Diagram

```
                             HTTP POST /api/retrieval/search
                                           │
                                           ▼
                               RetrievalService.executeSearch()
                                           │
                                           ▼
                               QueryProcessor.process(query)
                                           │
                        ┌──────────────────┴──────────────────┐
                        │ mode === 'keyword'?                 │
                        └──────────────────┬──────────────────┘
                                           │
                    ┌──────────────────────┴──────────────────────┐
                    │ YES                                         │ NO (semantic, hybrid,
                    ▼                                             │     graph, graphrag)
           queryVector = undefined                                ▼
                    │                           EmbeddingService.generateQueryVector()
                    │                           (Produces 768-dim float vector)
                    │                                             │
                    │                                             ├─► THROW (If Embedding Fails -> HTTP 500/503)
                    │                                             │
                    │                                             ▼
                    │                                   queryVector: number[]
                    │                                             │
                    ├─────────────────────────────────────────────┤
                    │                                             │
                    ▼                                             ▼
        Channel 1: Vector Search                     Channel 3: Graph Retrieval
        dbService.searchVectorChunks(                GraphRetrievalService.retrieveChunks(
          workspaceId,                                 workspaceId,
          queryVector,                                 query,
          filterOptions                                { queryVector, terms, exactPhrases }
        )                                            )
                                                                  │
                                                                  ▼
                                                      Stage 1: Seed Discovery
                                                      graphRepo.discoverEntitySeeds(
                                                        { workspaceId, ngrams, queryVector }
                                                      )
                                                      (NO redundant embedding call)
```

---

## 5. Security and Tenancy Verification

The graph retrieval channel traverses seven distinct database tables. Tenancy is strictly verified and guaranteed across all stages:

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Workspace Alpha Request                         │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
    ┌───────────────────────────────┴───────────────────────────────┐
    ▼                                                               ▼
Stage 1: Seed Discovery                                Stage 2: 2-Hop Traversal & Evidence
graph_entities:                                        graph_relations:
  WHERE workspace_id = $1                                WHERE workspace_id = $1
graph_entity_aliases:                                  relation_evidence:
  WHERE workspace_id = $1                                WHERE workspace_id = $1
  AND entity.workspace_id = $1                         chunk_entity_mentions:
                                                         WHERE workspace_id = $1
                                                       document_chunks:
                                                         WHERE "workspaceId" = $1
                                                       documents:
                                                         WHERE "workspaceId" = $1
                                                         AND status = 'COMPLETED'
```

### 5.1 Verification Checklist across Every Table

1. **`graph_entities`:** Filtered by `e.workspace_id = ${workspaceId}` in all seed discovery queries. Foreign workspace entities cannot be returned as seeds.
2. **`graph_entity_aliases`:** Filtered by `a.workspace_id = ${workspaceId}` with inner join `JOIN graph_entities e ON a.entity_id = e.id AND e.workspace_id = ${workspaceId}`. Foreign aliases cannot match.
3. **`graph_relations`:** Filtered by `r.workspace_id = ${workspaceId}` in anchor and recursive lateral CTEs. Cross-workspace relations cannot be traversed.
4. **`relation_evidence`:** Joined via `re.workspace_id = ${workspaceId}`. Foreign evidence records cannot substantiate traversed relations.
5. **`chunk_entity_mentions`:** Filtered by `cem.workspace_id = ${workspaceId}`. Foreign entity mentions cannot substantiate chunks.
6. **`document_chunks`:** Joined via `c."workspaceId" = ${workspaceId}`. Foreign chunks cannot be resolved.
7. **`documents`:** Joined via `d."workspaceId" = ${workspaceId}` and strictly checked with `d.status = 'COMPLETED'`. Documents in `PENDING`, `PROCESSING`, or `FAILED` states are excluded.
8. **In-Memory IDOR Rejection:** If a malicious client supplies foreign `documentIds` in `request.filters.documentIds`, the SQL joins and post-query filtering reject them completely, returning 0 candidates.

---

## 6. Required Implementation Plan Adjustments

Based on this clarification audit, the following concrete specifications are confirmed for Task 6.6.2.2:

1. **Promise Dispatch Mechanism:**
   In `RetrievalService.executeSearch()` for `mode === 'graphrag'`, use `Promise.all` with a dedicated `try/catch` wrapper specifically surrounding `GraphRetrievalService.retrieveChunks()`:

   ```typescript
   if (mode === 'graphrag') {
     let graphError: 'TIMEOUT' | 'FAILED' | undefined;
     const [semRes, kwRes, graphRes] = await Promise.all([
       dbService.searchVectorChunks(workspaceId, queryVector!, filterOptions),
       dbService.searchKeywordChunks(workspaceId, processedQuery.keywordQuery, filterOptions),
       GraphRetrievalService.retrieveChunks(workspaceId, processedQuery.rawQuery, {
         queryVector,
         terms: processedQuery.terms,
         exactPhrases: processedQuery.exactPhrases,
         filters: request.filters,
         topK: candidateFetchLimit,
       }).catch((err) => {
         const isTimeout =
           err instanceof GraphTraversalTimeoutError || err.name === 'GraphTraversalTimeoutError';
         graphError = isTimeout ? 'TIMEOUT' : 'FAILED';
         console.warn(`[WARN] [GRAPH_RETRIEVAL] Graph channel degraded: ${err.message}`);
         return {
           chunks: [],
           relations: [],
           seeds: [],
           timings: { seedDiscoveryMs: 0, evidenceTraversalMs: 0, totalGraphMs: 0 },
         };
       }),
     ]);
     // Proceed to Three-Way RRF with fail-soft telemetry...
   }
   ```
   - If Vector Search rejects $\implies$ Uncaught $\implies$ Entire search fails (500).
   - If Keyword Search rejects $\implies$ Uncaught $\implies$ Entire search fails (500).
   - If Graph Retrieval rejects $\implies$ Caught $\implies$ Returns empty graph candidates, sets `graphError`, fuses Vector + Keyword (200).

2. **Graph-Only Mode Execution:**
   In `mode === 'graph'`:
   - Generate `queryVector = await EmbeddingService.generateQueryVector(processedQuery.normalizedQuery)`.
   - Call `GraphRetrievalService.retrieveChunks()` directly **WITHOUT** a catch wrapper so that `GraphTraversalTimeoutError` (504) or repository failures (500) bubble directly to the client.

---

## 7. Final Readiness Verdict

### Final Verdict: **READY FOR IMPLEMENTATION AUTHORIZATION**

All open architecture questions regarding channel-level failure isolation, retrieval mode contracts, query embedding lifecycles, and multi-tenant security have been thoroughly audited and resolved.

> [!CAUTION]
>
> ### FINAL AUTHORIZATION GATE: IMPLEMENTATION NOT AUTHORIZED
>
> **Implementation authorization for Task 6.6.2.2 remains STRICTLY NOT GRANTED.**  
> Zero source code modifications have been made. Awaiting explicit human approval to proceed with Task 6.6.2.2 implementation.
