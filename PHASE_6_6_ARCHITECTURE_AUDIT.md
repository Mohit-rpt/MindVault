# MindVault Phase 6.6 — GraphRAG Retrieval Architecture Audit

**Milestone:** Phase 6.6 — GraphRAG Retrieval  
**Mode:** STRICT READ-ONLY / AUDIT & INVESTIGATION  
**Status:** ARCHITECTURE & BLUEPRINT REFINEMENT (Implementation NOT Authorized)  
**Date:** 2026-11-08

---

## 1. System Context & Audit Objectives

MindVault's existing retrieval and generative pipeline (Phase 3 & 4) operates as a hybrid retrieval system combining dense semantic vector search (pgvector 768-dimensional cosine distance) and sparse lexical search (PostgreSQL `tsvector` with `ts_rank_cd`), fused via Reciprocal Rank Fusion ($k=60$). While this baseline performs well for local keyword matches and single-hop semantic similarity, it suffers from intrinsic information-retrieval limitations:

1. **Blindness to Relational Topology:** Chunks describing connected concepts (e.g. $Entity_A \rightarrow Relation \rightarrow Entity_B$) are retrieved independently without structural awareness of their logical connection.
2. **Multi-Hop Traversal Failure:** When a user's question requires multi-hop reasoning across document boundaries (e.g., "Which components are impacted when Service X fails?"), neither semantic cosine similarity nor full-text search reliably surfaces the intermediate connecting chunks.
3. **Entity Disambiguation Fragility:** Lexical search struggles with acronyms and synonyms, while vector search can suffer from semantic drift on generic technical terms.

Phase 6 built an enterprise-grade Knowledge Graph foundation:

- Phase 6.0: PostgreSQL schema, referential integrity, and cascading guarantees.
- Phase 6.1: Deterministic entity resolution, relation extraction, and provenance tracking.
- Phase 6.2: Acronym disambiguation, entity normalization, and false-positive merge prevention.
- Phase 6.3/6.4: Fault-tolerant background worker pipelines, distributed leasing, and crash recovery.
- Phase 6.5: Bounded recursive graph traversal (`getNeighborhood`, `findPaths`) with $K_{fanout} \le 15$ intermediate caps, sub-15ms execution latency, and three-tier clamping.

**Objective of Phase 6.6:** Audit the existing retrieval, fusion, graph, and generation systems to design a production-grade **GraphRAG** retrieval engine that seamlessly fuses dense vector search, lexical text search, and knowledge graph traversal into a unified three-way retrieval pipeline under strict multi-tenant and empirical performance constraints.

---

## 2. Existing Phase 3 Retrieval Architecture Audit

### 2.1 Retrieval Service Orchestration (`RetrievalService.executeSearch`)

Located in [`apps/api/src/modules/retrieval/services/retrieval.service.ts`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/modules/retrieval/services/retrieval.service.ts):

- **Inputs:** `workspaceId: string`, `request: Partial<SearchRequest> & { query: string }`.
- **Query Processing:** Delegates to `QueryProcessor.process(request.query)`, which performs Unicode NFKC normalization, whitespace consolidation, unprintable character stripping, exact phrase extraction (`"..."`), and alphanumeric term tokenization.
- **Execution Branches:**
  - `mode === 'semantic'` or `'hybrid'`: Generates a 768-dim embedding vector via `EmbeddingService.generateQueryVector()` and executes `dbService.searchVectorChunks(workspaceId, queryVector, filterOptions)`.
  - `mode === 'keyword'` or `'hybrid'`: Executes `dbService.searchKeywordChunks(workspaceId, processedQuery.keywordQuery, filterOptions)`.
- **Candidate Pool Sizing:** Requests candidateFetchLimit = $\min(topK \times 2, 50)$ from each active channel (e.g., 20 candidates for $topK=10$, up to a maximum of 50).
- **Fusion Execution:** When `mode === 'hybrid'`, calls `ReciprocalRankFusion.fuse(semanticResults, keywordResults, { topK })`.
- **Reranking:** Optional cross-encoder reranking via `RerankerService.rerankCandidates`. **Status:** Existing Phase 3 infrastructure reused without modification (default: `enableReranking = false`).
- **Context Assembly:** Optional context formatting via `ContextAssembler.assemble(rerankedCandidates, { maxTokens })`.
- **Output:** Returns canonical `SearchResponseDto` containing ranked `SearchResultItem[]`, telemetry timings, and optional `SearchContextDto`.

### 2.2 Database Search Implementations (`apps/api/src/lib/db.ts`)

#### A. Vector Search (`searchVectorChunks`)

```sql
SELECT
  c."id", c."documentId", c."workspaceId", c."chunkIndex", c."content", c."tokenCount",
  c."pageStart", c."pageEnd", c."metadata", c."createdAt",
  d."originalName" AS "docOriginalName", d."extension" AS "docExtension",
  d."status" AS "docStatus", d."pageCount" AS "docPageCount",
  (1 - (c."embedding" <=> $2::vector)) AS "similarity",
  (c."embedding" <=> $2::vector) AS "distance"
FROM "document_chunks" c
JOIN "documents" d ON c."documentId" = d."id"
WHERE c."workspaceId" = $1 AND d."workspaceId" = $1
  AND d."status" = 'COMPLETED' AND c."embedding" IS NOT NULL
  [...optional documentIds, fileTypes, pageStart, pageEnd filters...]
ORDER BY c."embedding" <=> $2::vector ASC
LIMIT $3
```

- **Index:** Supported by HNSW / IVFFlat vector index on `document_chunks(embedding)`.
- **Candidate Limit:** $K_{vec} = \min(topK \times 2, 50)$.
- **Strengths:** Excellent semantic concept matching, tolerance for varied phrasing.
- **Weaknesses:** Lacks relational path awareness; cannot follow multi-hop entity relationships.

#### B. Full-Text Search (`searchKeywordChunks`)

```sql
SELECT
  c."id", c."documentId", c."workspaceId", c."chunkIndex", c."content", c."tokenCount",
  c."pageStart", c."pageEnd", c."metadata", c."createdAt",
  d."originalName" AS "docOriginalName", d."extension" AS "docExtension",
  d."status" AS "docStatus", d."pageCount" AS "docPageCount",
  ts_rank_cd(c."search_vector", websearch_to_tsquery('english', $2)) AS "rankScore"
FROM "document_chunks" c
JOIN "documents" d ON c."documentId" = d."id"
WHERE c."workspaceId" = $1 AND d."workspaceId" = $1 AND d."status" = 'COMPLETED'
  AND (
    c."search_vector" @@ websearch_to_tsquery('english', $2)
    OR c."search_vector" @@ plainto_tsquery('english', $2)
  )
ORDER BY "rankScore" DESC
LIMIT $3
```

- **Index:** GIN index on `document_chunks(search_vector)`.
- **Candidate Limit:** $K_{kw} = \min(topK \times 2, 50)$.
- **Strengths:** Precise keyword, identifier, code symbol, and version matching.
- **Weaknesses:** Susceptible to vocabulary mismatch and synonym blindness.

---

## 3. Existing Reciprocal Rank Fusion (RRF) Audit

Located in [`apps/api/src/modules/retrieval/fusion/rrf.fusion.ts`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/modules/retrieval/fusion/rrf.fusion.ts):

### 3.1 Mathematical Model

The standard Cormack et al. (2009) formula is implemented:
$$\text{RRF}(d) = \sum_{m \in M} \frac{1}{k + r_m(d)}$$
where:

- $M$ is the set of retrieval models ($M = \{\text{semantic}, \text{keyword}\}$ in Phase 3).
- $r_m(d) \in [1, \text{candidateFetchLimit}]$ is the 1-indexed rank of chunk $d$ in channel $m$.
- $k = 60$ is the standard smoothing constant (mitigates the impact of high-rank outliers).

### 3.2 Current Candidate Data Structure

```typescript
export interface FusedCandidate {
  chunkId: string;
  documentId: string;
  documentName: string;
  documentExtension: string;
  content: string;
  chunkIndex: number;
  tokenCount: number;
  pageStart: number | null;
  pageEnd: number | null;
  metadata: Record<string, unknown>;
  semanticRank?: number;
  semanticScore?: number;
  keywordRank?: number;
  keywordScore?: number;
  retrievalSources: Array<'semantic' | 'keyword'>;
  rrfScore: number;
  rank: number;
}
```

### 3.3 Current Sorting & Tie-Breaking Rules

```typescript
const sorted = Array.from(candidateMap.values()).sort((a, b) => {
  if (b.rrfScore !== a.rrfScore) {
    return b.rrfScore - a.rrfScore;
  }
  // Primary tie-breaker: prefer chunks appearing in multiple retrieval channels
  if (b.retrievalSources.length !== a.retrievalSources.length) {
    return b.retrievalSources.length - a.retrievalSources.length;
  }
  // Secondary tie-breaker: earlier chunk index within the document
  return a.chunkIndex - b.chunkIndex;
});
```

### 3.4 Findings & Extensibility Assessment

- **Zero Redundancy Rule:** The user mandate states: _"Do not introduce a second independent RRF implementation if the existing one can be extended safely."_
- **Assessment:** `ReciprocalRankFusion` can be generalized without breaking changes:
  1. Add `graphRank?: number`, `graphScore?: number`, and update `retrievalSources` to `Array<'semantic' | 'keyword' | 'graph'>`.
  2. Extend `fuse()` signature to accept `graphResults?: SearchChunkResult[]`:
     $$\text{RRF}(d) = \frac{\mathbb{I}_{sem}(d)}{k + r_{sem}(d)} + \frac{\mathbb{I}_{kw}(d)}{k + r_{kw}(d)} + \frac{\mathbb{I}_{graph}(d)}{k + r_{graph}(d)}$$
  3. Enforce a 4-tier deterministic tie-breaking sequence:
     - Tier 1: `rrfScore` descending.
     - Tier 2: `retrievalSources.length` descending (chunks in 3 channels rank ahead of 2, then 1).
     - Tier 3: `chunkIndex` ascending.
     - Tier 4: `chunkId.localeCompare(b.chunkId)` ascending (ensures 100% deterministic ranking across concurrent runs and OS platforms).

---

## 4. Schema-Verified Workspace Isolation Audit

A thorough inspection of `prisma/schema.prisma` and PostgreSQL table definitions was conducted. Every table participating in graph retrieval was verified for direct tenancy ownership, schema foreign keys, and query filtering.

### 4.1 Table-by-Table Tenancy Verification Matrix

| Table Name              | Prisma Model         | Direct `workspace_id` Column? | Authoritative Ownership Path | Foreign Keys Enforcing Tenancy                                                                                                                             | Query Isolation Clause Required |
| :---------------------- | :------------------- | :---------------------------: | :--------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------ |
| `graph_entities`        | `GraphEntity`        |   **YES** (`workspace_id`)    | Direct (`workspaces.id`)     | `workspaceId -> workspaces(id) ON DELETE CASCADE`                                                                                                          | `WHERE e.workspace_id = $1`     |
| `graph_entity_aliases`  | `GraphEntityAlias`   |   **YES** (`workspace_id`)    | Direct (`workspaces.id`)     | `[workspaceId, entityId] -> graph_entities(workspace_id, id) ON DELETE CASCADE`                                                                            | `WHERE a.workspace_id = $1`     |
| `graph_relations`       | `GraphRelation`      |   **YES** (`workspace_id`)    | Direct (`workspaces.id`)     | `[workspaceId, sourceEntityId] -> graph_entities(workspace_id, id)`<br>`[workspaceId, targetEntityId] -> graph_entities(workspace_id, id)`                 | `WHERE r.workspace_id = $1`     |
| `relation_evidence`     | `RelationEvidence`   |   **YES** (`workspace_id`)    | Direct (`workspaces.id`)     | `[workspaceId, relationId] -> graph_relations(workspace_id, id)`<br>`[workspaceId, documentId, chunkId] -> document_chunks(workspace_id, document_id, id)` | `WHERE re.workspace_id = $1`    |
| `chunk_entity_mentions` | `ChunkEntityMention` |   **YES** (`workspace_id`)    | Direct (`workspaces.id`)     | `[workspaceId, chunkId] -> document_chunks(workspace_id, id)`<br>`[workspaceId, entityId] -> graph_entities(workspace_id, id)`                             | `WHERE cem.workspace_id = $1`   |
| `document_chunks`       | `DocumentChunk`      |    **YES** (`workspaceId`)    | Direct (`workspaces.id`)     | `[workspaceId, documentId] -> documents(workspaceId, id) ON DELETE CASCADE`                                                                                | `WHERE c."workspaceId" = $1`    |
| `documents`             | `Document`           |    **YES** (`workspaceId`)    | Direct (`workspaces.id`)     | `workspaceId -> workspaces(id) ON DELETE CASCADE`                                                                                                          | `WHERE d."workspaceId" = $1`    |

### 4.2 Cross-Tenant Exclusion Proof

1. **Schema Composite Foreign Keys:** In Phase 6.0, all relational graph tables were architected with compound primary and foreign keys containing `workspace_id` (e.g. `@@unique([workspaceId, id])`, `@@unique([workspaceId, relationId, chunkId])`). A relation in Workspace A physically cannot reference an entity in Workspace B.
2. **Set-Oriented SQL Bounding:** Every CTE step in the GraphRAG query builder binds `workspace_id = $1`. When an entity seed is discovered, all traversed edges and joined evidence rows must match `$1`.
3. **Zero Cross-Workspace IDOR:** Even if an adversarial client injects an entity ID from Workspace Beta into a query in Workspace Alpha, the condition `e.id = $2 AND e.workspace_id = $1` returns zero rows, preventing cross-tenant enumeration or leakage.

---

## 5. Evidence Semantics & Grounding Invariants

### 5.1 Distinction Between Evidence Types

MindVault maintains two distinct levels of evidence linking graph entities to textual content:

| Evidence Type               | Backing Schema Model                 | Semantic Meaning                                                                                                                                |                    Graph Scoring Contribution                     |                               Permitted in LLM Relational Prompt?                               |
| :-------------------------- | :----------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------: | :---------------------------------------------------------------------------------------------: |
| **Relationship Evidence**   | `RelationEvidence`                   | A specific text passage that explicitly substantiates a relational assertion between two entities (e.g. "PostgreSQL uses Write-Ahead Logging"). | **High:** $W_{rel} \times C_{rel} \times E_{ev} \times \delta(d)$ |      **YES:** Formatted as verified relationship triple `[G_i]` citing the evidence chunk.      |
| **Entity Mention Evidence** | `ChunkEntityMention`                 | An entity appears in a text passage without necessarily asserting a relation (e.g. "PostgreSQL was installed").                                 |         **Medium:** $C_{mention} \times 0.75$ (dampened)          | **NO:** Used only to retrieve relevant context chunks; cannot synthesize unsupported relations. |
| **Ungrounded Relation**     | `GraphRelation` with 0 evidence rows | A relation exists in the schema but has zero supporting evidence passages in `relation_evidence`.                                               |              **ZERO:** Excluded from chunk retrieval              |                    **STRICTLY PROHIBITED:** Must NEVER enter the LLM prompt.                    |

### 5.2 Multiple Evidence & Multiple Relation Deduplication

1. **Multiple evidence records supporting the same relation:**
   - Relation $R$ may have evidence in Chunk $C_1$ and Chunk $C_2$. Both chunks are retrieved and scored. When $R$ is assembled into the prompt context, its citation reference lists all supporting chunks that survived token budgeting: `[Evidence: S1, S2]`.
2. **Multiple relations supported by the same chunk:**
   - A dense passage Chunk $C$ may substantiate multiple relations $R_1, R_2, R_3$.
   - **Deduplication:** Chunk $C$ is emitted only once in `SearchChunkResult[]` and `SearchContextDto.sources`. Its graph score receives an aggregated multi-relation boost (see Blueprint §2.2). Its metadata records all supported relation IDs: `supportedRelationIds: [R1, R2, R3]`.

---

## 6. Phase 6.5 Traversal Invariants & Global Work Bounding

### 6.1 Phase 6.5 Traversal Capabilities

- **Neighborhood Traversal:** [`GraphTraversalService.getNeighborhood`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/modules/graph/services/graph-traversal.service.ts#L53) with depth $\in [1, 3]$ and sub-15ms latency.
- **Path Discovery:** [`GraphTraversalService.findPaths`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/modules/graph/services/graph-traversal.service.ts#L268) with depth $\in [1, 4]$ and cycle containment.

### 6.2 The Global Intermediate Work Bound Problem

In Phase 6.5, per-node fan-out was bounded by `LIMIT 15`. However, for GraphRAG:

- Up to $S \le 5$ seeds can be active simultaneously.
- If 5 seeds each expand 15 edges at depth 1 ($5 \times 15 = 75$ edges), and those 75 intermediate nodes each expand 15 edges at depth 2 ($75 \times 15 = 1,125$ candidate rows), intermediate expansion could expand combinatorially before the outer LIMIT 50 is reached.
- **Audit Conclusion:** A per-node fan-out limit is insufficient on multi-seed queries. A **global intermediate work ceiling** must be enforced in SQL (see Blueprint §2.2).

---

## 7. Code Reuse & Redundancy Analysis

| Component              | Reuse Recommendation        | Rationale                                                                                                                          |
| :--------------------- | :-------------------------- | :--------------------------------------------------------------------------------------------------------------------------------- |
| `ReciprocalRankFusion` | **Reuse and Extend**        | Generalize from 2 channels to 3 channels (`semantic`, `keyword`, `graph`). Avoids maintaining two separate fusion implementations. |
| `EntityNormalizer`     | **Direct Reuse**            | Leverage `EntityNormalizer.normalize()` for consistent n-gram tokenization and canonical string matching against the graph.        |
| `QueryProcessor`       | **Direct Reuse**            | Provides pre-extracted `terms`, `exactPhrases`, and `normalizedQuery`.                                                             |
| `ContextAssembler`     | **Reuse and Augment**       | Maintain existing token budgeting and citation formats while adding optional graph relation summary blocks.                        |
| `RerankerService`      | **Direct Reuse (Existing)** | Existing Phase 3 cross-encoder infrastructure. Reused without modification. No new implementation task required.                   |
| `GroundingService`     | **Direct Reuse**            | Validates `[S1]`, `[S2]` citation references in LLM output regardless of retrieval mode.                                           |
| `RetrievalMetrics`     | **Direct Reuse**            | Standard IR formulas (`precisionAtK`, `recallAtK`, `mrr`, `ndcgAtK`) apply directly to GraphRAG evaluation.                        |

---

_End of Architecture Audit._
