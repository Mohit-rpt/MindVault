# MindVault Phase 6.6 — Final Implementation Readiness Audit

**Milestone:** Phase 6.6 — GraphRAG Retrieval  
**Audit Target:** Task 6.6.1 — Seed Discovery & Graph Evidence Repository Query  
**Mode:** STRICT READ-ONLY AUDIT  
**Status:** **AUTHORIZATION GATE COMPLETED — READY FOR TASK 6.6.1**  
**Date:** 2026-11-08

---

## 1. Executive Audit Summary

An independent, rigorous, read-only readiness audit of the finalized Phase 6.6 architecture documents, PostgreSQL 16.4 database engine, Prisma schema, and existing repository implementation has been executed.

Every architectural constraint, mathematical formula, SQL CTE construct, multi-tenant foreign key boundary, and error-handling pathway was audited against the active codebase. Live query plan analysis was executed on the PostgreSQL instance (`mindvault-postgres` on port 5433).

### Final Recommendation:

# **`READY FOR TASK 6.6.1`**

---

## 2. Comprehensive Checklist Evaluation

|   Check #   | Verification Area                                                       | Verdict  | Primary File / Code References                                                                                                                                                                                                                                 |
| :---------: | :---------------------------------------------------------------------- | :------: | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Check 1** | Recursive SQL global work bound ($M_{intermediate} \le 150$)            | **PASS** | [`PHASE_6_6_ARCHITECTURE_BLUEPRINT.md`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/PHASE_6_6_ARCHITECTURE_BLUEPRINT.md#L144-L256)                                                                                                                       |
| **Check 2** | Graph scoring model, range $[0.0, 1.0]$, and confidence fallback        | **PASS** | [`PHASE_6_6_ARCHITECTURE_BLUEPRINT.md`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/PHASE_6_6_ARCHITECTURE_BLUEPRINT.md#L296-L380)                                                                                                                       |
| **Check 3** | Schema-verified workspace isolation across all 7 tables                 | **PASS** | [`prisma/schema.prisma`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/prisma/schema.prisma#L99-L158), [`#L250-L362`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/prisma/schema.prisma#L250-L362)                                                    |
| **Check 4** | Separation of relationship evidence, mentions, and ungrounded relations | **PASS** | [`PHASE_6_6_ARCHITECTURE_BLUEPRINT.md`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/PHASE_6_6_ARCHITECTURE_BLUEPRINT.md#L258-L287), [`#L420-L460`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/PHASE_6_6_ARCHITECTURE_BLUEPRINT.md#L420-L460)      |
| **Check 5** | 50-per-channel and 150-fused-candidate limits consistency               | **PASS** | [`PHASE_6_6_ARCHITECTURE_BLUEPRINT.md`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/PHASE_6_6_ARCHITECTURE_BLUEPRINT.md#L12-L44), [`PHASE_6_6_TASK_BREAKDOWN.md`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/PHASE_6_6_TASK_BREAKDOWN.md#L55-L75) |
| **Check 6** | 35ms latency budget & component measurement boundaries                  | **PASS** | [`PHASE_6_6_EVALUATION_PLAN.md`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/PHASE_6_6_EVALUATION_PLAN.md#L90-L125)                                                                                                                                      |
| **Check 7** | Single set-oriented SQL statement vs transaction/timeout setup          | **PASS** | [`PHASE_6_6_TASK_BREAKDOWN.md`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/PHASE_6_6_TASK_BREAKDOWN.md#L80-L105)                                                                                                                                        |
| **Check 8** | Task 6.6.1 repository interface, SQL contracts, and error mapping       | **PASS** | [`apps/api/src/modules/graph/repositories/graph.repository.ts`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/modules/graph/repositories/graph.repository.ts#L432-L480)                                                                       |
| **Check 9** | Zero Phase 6.5 regression & zero unnecessary shared DB changes          | **PASS** | [`apps/api/src/modules/graph/repositories/graph.repository.interface.ts`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/modules/graph/repositories/graph.repository.interface.ts#L99-L141)                                                    |

---

## 3. Deep-Dive Audit Findings by Check

### Check 1: Recursive SQL Intermediate Relations Bound ($M_{intermediate} \le 150$)

- **Audit Verdict:** **PASS**
- **Evidence & Code Inspection:**
  - In [`PHASE_6_6_ARCHITECTURE_BLUEPRINT.md`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/PHASE_6_6_ARCHITECTURE_BLUEPRINT.md#L175-L256), the recursive CTE implements a 4-tier structural clamp:
    1. **Anchor Tier (Depth 1):** Bounded by `LIMIT 50` on the union of seed-connected relations.
    2. **Frontier Parent Restriction:** Subquery `ge` selects distinct neighbors from Depth 1 ordered by `confidence DESC, weight DESC LIMIT 10`, bounding frontier expansion to at most 10 parent nodes.
    3. **Lateral Recursive Fan-Out:** Lateral subquery `cand` limits expansion per frontier parent to `LIMIT 10`, guaranteeing at most $10 \times 10 = 100$ recursive relations.
    4. **Intermediate Deduplication & Hard Ceiling:** The `deduplicated_relations` CTE executes `SELECT DISTINCT ON (relation_id) ... ORDER BY relation_id, depth ASC, confidence DESC, weight DESC LIMIT 150`.
  - **Mathematical Guarantee:** Maximum possible intermediate relations generated by the recursive union is $50 + (10 \times 10) = 150$. Even under adversarial seed configurations, the hard `LIMIT 150` on `deduplicated_relations` immutably caps the intermediate relation pool before any evidence tables are joined.
  - **Empirical Engine Verification:** Executed `EXPLAIN` on live PostgreSQL 16.4. The engine successfully compiled the recursive union, subquery scan, nested loop lateral join, and limit into a single deterministic execution plan with zero syntax or recursion errors.

---

### Check 2: Graph Scoring Model, Range $[0.0, 1.0]$, and Confidence Fallback

- **Audit Verdict:** **PASS**
- **Evidence & Code Inspection:**
  - **Mathematical Formula:**
    $$\text{Score}_{graph}(c) = \min\left(1.0, \; S_{max}(c) + \sum_{j \neq max} 0.2 \times S_j(c)\right) \in [0.0, 1.0]$$
  - **Component Ranges:**
    - Seed Match Score: $S_{seed} \in [0.70, 1.0]$ ($1.0$ lexical canonical, $0.95$ alias, $\ge 0.70$ semantic vector).
    - Relation Weight: $W_{rel} \in [0.0, 1.0]$ from `graph_relations.weight`.
    - Relation Confidence: $C_{rel} \in [0.0, 1.0]$ from `graph_relations.confidence`.
    - Depth Penalty: $\delta(d) = 1/d \in \{1.0, 0.5\}$ ($\delta(1) = 1.0$, $\delta(2) = 0.5$).
    - Mention Confidence: $C_{mention} \in [0.0, 1.0]$ dampened by $0.75$.
  - **Resolution of Default 0.85 vs Null Fallback:**
    - Schema inspection of [`prisma/schema.prisma`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/prisma/schema.prisma#L349) reveals:
      `confidence Float @default(0.85)`
    - _Distinction Resolved:_ At document ingestion and extraction time, when the relation extraction pipeline stores evidence records, PostgreSQL inserts the schema default confidence of `0.85`. In the retrieval query, `COALESCE(re.confidence, 0.85)` handles any unpopulated or legacy records by falling back to this schema default. If a stricter penalty is desired for unrated legacy records, `COALESCE(re.confidence, 0.50)` can be configured. The SQL template uses `COALESCE(re.confidence, 0.85)` which perfectly matches the Prisma schema default.
  - **Worked Examples:** Verified all 3 worked numerical examples in Blueprint §2.2.C:
    - Single 1-hop relation: $1.0 \times 1.0 \times 0.90 \times 0.95 \times 1.0 = \mathbf{0.855}$.
    - Multiple relations (1-hop + 2-hop): $0.855 + (0.2 \times 0.289) = \mathbf{0.913}$.
    - Entity mention only: $0.95 \times 0.90 \times 0.75 = \mathbf{0.641}$.
  - **Deterministic Ordering & Rank Assignment:** Chunks are ordered by `final_graph_score DESC, chunkIndex ASC, id ASC`, and assigned 1-indexed ranks $r_{graph}(c) \in [1, 50]$.

---

### Check 3: Schema-Verified Workspace Isolation Across All 7 Tables

- **Audit Verdict:** **PASS**
- **Evidence & Code Inspection:**
  - Audited [`prisma/schema.prisma`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/prisma/schema.prisma) and PostgreSQL `information_schema.columns`.
  - **Authoritative Tenancy Ownership Matrix:**
    1. `graph_entities`: Contains direct `workspace_id` column; primary foreign key to `workspaces(id)`; compound unique on `[workspaceId, id]`. Query: `WHERE e.workspace_id = $1`.
    2. `graph_entity_aliases`: Contains direct `workspace_id` column; compound foreign key `[workspaceId, entityId]` referencing `graph_entities([workspaceId, id])`. Query: `WHERE a.workspace_id = $1`.
    3. `graph_relations`: Contains direct `workspace_id` column; compound foreign keys `[workspaceId, sourceEntityId]` and `[workspaceId, targetEntityId]` referencing `graph_entities([workspaceId, id])`. Query: `WHERE r.workspace_id = $1`.
    4. `relation_evidence`: Contains direct `workspace_id` column; compound foreign key `[workspaceId, relationId]` referencing `graph_relations([workspaceId, id])`, and `[workspaceId, documentId, chunkId]` referencing `document_chunks([workspaceId, documentId, id])`. Query: `WHERE re.workspace_id = $1`.
    5. `chunk_entity_mentions`: Contains direct `workspace_id` column; compound foreign keys `[workspaceId, chunkId]` referencing `document_chunks([workspaceId, id])` and `[workspaceId, entityId]` referencing `graph_entities([workspaceId, id])`. Query: `WHERE cem.workspace_id = $1`.
    6. `document_chunks`: Contains direct `workspaceId` column; compound foreign key `[workspaceId, documentId]` referencing `documents([workspaceId, id])`. Query: `WHERE c."workspaceId" = $1`.
    7. `documents`: Contains direct `workspaceId` column; foreign key referencing `workspaces(id)`. Query: `WHERE d."workspaceId" = $1`.
  - **Column Identifier Case Sensitivity Discovery:**
    Live testing revealed that `document_chunks` and `documents` use camelCase column names in PostgreSQL (`"documentId"`, `"workspaceId"`, `"chunkIndex"`, `"originalName"`), whereas graph tables use snake_case (`workspace_id`, `relation_id`, etc.). In `chunk_evidence_candidates` Strategy 2, referencing `c."documentId" AS document_id` with quotes is strictly required.

---

### Check 4: Separation of Relationship Evidence, Entity Mentions, and Ungrounded Relations

- **Audit Verdict:** **PASS**
- **Evidence & Code Inspection:**
  - In [`PHASE_6_6_ARCHITECTURE_BLUEPRINT.md`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/PHASE_6_6_ARCHITECTURE_BLUEPRINT.md#L258-L287):
    - Strategy 1 (`RELATION_EVIDENCE`): Joins `relation_evidence re` and preserves `dr.relation_id, dr.relation_type, dr.source_entity_id, dr.target_entity_id`.
    - Strategy 2 (`ENTITY_MENTION`): Joins `chunk_entity_mentions cem` and binds `NULL AS relation_id, NULL AS relation_type, NULL AS target_entity_id`.
  - In `aggregated_chunk_scores`:
    - Aggregation filters: `COUNT(DISTINCT cec.relation_id) AS supported_relations_count`, `ARRAY_AGG(DISTINCT cec.relation_id) FILTER (WHERE cec.relation_id IS NOT NULL) AS supported_relation_ids`.
    - A chunk retrieved solely via mention has `supportedRelationsCount = 0` and empty `supportedRelationIds`.
  - **Ungrounded Relations Containment:**
    - Any relation in `graph_relations` with 0 rows in `relation_evidence` produces 0 rows in Strategy 1 (`JOIN relation_evidence re ON dr.relation_id = re.relation_id`). It physically cannot surface any chunks.
    - **Invariant 6.6.1:** ContextAssembler enforces that no relation triple enters prompt context unless at least one supporting chunk exists in `contextPassages` with an active `[S_i]` citation.

---

### Check 5: 50-Per-Channel and 150-Fused-Candidate Limits Consistency

- **Audit Verdict:** **PASS**
- **Evidence & Code Inspection:**
  - All three channels retrieve at most 50 chunks:
    - Channel 1 (Vector): $K_{vec} = \min(topK \times 2, 50) \le 50$.
    - Channel 2 (Lexical): $K_{kw} = \min(topK \times 2, 50) \le 50$.
    - Channel 3 (Graph): $K_{graph} = \text{LEAST}(\text{GREATEST}(\$3::\text{int}, 1), 50) \le 50$.
  - Maximum fused candidate pool entering RRF: $\le 150$ candidates ($50 \times 3$).
  - Full synchronization verified across:
    - Narrative text: [`PHASE_6_6_ARCHITECTURE_BLUEPRINT.md`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/PHASE_6_6_ARCHITECTURE_BLUEPRINT.md#L17)
    - Architecture diagram: [`PHASE_6_6_ARCHITECTURE_BLUEPRINT.md`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/PHASE_6_6_ARCHITECTURE_BLUEPRINT.md#L23-L36)
    - SQL query contract: [`PHASE_6_6_ARCHITECTURE_BLUEPRINT.md`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/PHASE_6_6_ARCHITECTURE_BLUEPRINT.md#L293)
    - Task specifications: [`PHASE_6_6_TASK_BREAKDOWN.md`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/PHASE_6_6_TASK_BREAKDOWN.md#L55-L75)

---

### Check 6: 35ms Latency Target & Measurement Boundaries

- **Audit Verdict:** **PASS**
- **Evidence & Code Inspection:**
  - In [`PHASE_6_6_EVALUATION_PLAN.md`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/PHASE_6_6_EVALUATION_PLAN.md#L90-L125), the 35ms $p_{50}$ latency budget is explicitly defined with clear boundaries:
    - N-Gram Extraction & Entity Normalization: $\le 2\text{ms}$
    - Seed Discovery Query: $\le 8\text{ms}$
    - Bounded Graph Traversal & Evidence Join: $\le 18\text{ms}$
    - Chunk Score Aggregation & Mapping: $\le 3\text{ms}$
    - Three-Way RRF & 4-Tier Tie-Breaking: $\le 4\text{ms}$
    - **Total GraphRAG Channel Overhead Budget:** $\le 35\text{ms}$ at $p_{50}$ ($\le 75\text{ms}$ at $p_{95}$).
  - **Measurement Boundaries Clarified:**
    - Vector search, keyword search, and graph retrieval execute concurrently via `Promise.all`.
    - The 35ms SLA applies to core retrieval with reranking disabled (default).
    - When cross-encoder reranking is enabled, reranker inference latency is recorded separately in telemetry (`timing.rerankMs`) and excluded from the 35ms retrieval SLA.

---

### Check 7: Single Set-Oriented SQL Statement vs Transaction/Timeout Setup

- **Audit Verdict:** **PASS**
- **Evidence & Code Inspection:**
  - In [`PHASE_6_6_TASK_BREAKDOWN.md`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/PHASE_6_6_TASK_BREAKDOWN.md#L80-L105):
    - Interactive Prisma transaction executes:
      1. `SET LOCAL statement_timeout = '2500ms';` — a connection-scoped transaction setting that resets automatically upon transaction completion, preventing connection pool leakage.
      2. Single parameterized SQL query executing all CTEs, joins, and aggregations in one single database round-trip.
  - The distinction between connection-scoped timeout configuration and single-query data retrieval is verified and architecturally clean.

---

### Check 8: Task 6.6.1 Repository Interface, SQL Contracts, and Error Mapping

- **Audit Verdict:** **PASS**
- **Evidence & Code Inspection:**
  - Inspected [`apps/api/src/modules/graph/repositories/graph.repository.ts`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/modules/graph/repositories/graph.repository.ts#L432-L480).
  - The proposed Task 6.6.1 method `searchGraphEvidence` mirrors existing Phase 6.5 methods `traverseNeighborhood` and `findPaths`:
    ```typescript
    return await prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET LOCAL statement_timeout = '2500ms';`;
        return await tx.$queryRaw<RawGraphEvidenceRow[]>(query);
      },
      { timeout: 3500 },
    );
    ```
  - Catch block inspects `err.message?.includes('statement timeout')` or `err.code === '57014'` and maps directly to `GraphTraversalTimeoutError` (HTTP 504).
  - Return types `RawGraphChunkRow` and `RawGraphRelationRow` map cleanly to database output columns.

---

### Check 9: Zero Phase 6.5 Regression & No Unnecessary DB Changes

- **Audit Verdict:** **PASS**
- **Evidence & Code Inspection:**
  - Existing Phase 6.5 traversal methods (`traverseNeighborhood`, `findPaths`), controllers, and tests remain completely untouched.
  - No changes proposed to `apps/api/src/lib/db.ts` other than an optional thin delegation wrapper. `GraphRetrievalService` calls `GraphRepository` directly, avoiding bloating core database utilities.
  - Zero Prisma schema changes and zero database migrations are required.

---

## 4. Implementation Directives for Task 6.6.1

During Task 6.6.1 implementation, the following concrete directives must be observed:

1. **Exact Quoted Column Names:**
   When writing the raw SQL in `graph-retrieval.sql.ts`, all columns belonging to `document_chunks` and `documents` must use double quotes (e.g. `c."documentId" AS document_id`, `c."workspaceId"`, `c."chunkIndex"`, `d."originalName"`).
2. **Interactive Transaction Statement Timeout:**
   Wrap `searchGraphEvidence` in an interactive transaction with `SET LOCAL statement_timeout = '2500ms';` and Prisma transaction timeout of `3500ms`.
3. **Timeout Error Mapping:**
   Catch SQLSTATE `57014` and map to `GraphTraversalTimeoutError`.

---

## 5. Final Readiness Verdict

```
================================================================================
  MINDVAULT PHASE 6.6 FINAL READINESS AUDIT: VERDICT
================================================================================
  Check 1: Global Recursive Work Bound (<= 150 relations)  : PASS
  Check 2: Graph Scoring Model & Range ([0.0, 1.0])        : PASS
  Check 3: Schema-Verified Workspace Isolation (7 tables)  : PASS
  Check 4: Separation of Evidence Types & Ungrounded Rule  : PASS
  Check 5: 50-Per-Channel & 150-Candidate Limits           : PASS
  Check 6: 35ms Latency Budget & Measurement Boundaries    : PASS
  Check 7: Single Set-Oriented SQL vs Setup Statements     : PASS
  Check 8: Repository Interface & Timeout Error Mapping    : PASS
  Check 9: Zero Phase 6.5 Regression & Zero Schema Changes : PASS
--------------------------------------------------------------------------------
  FINAL RECOMMENDATION: READY FOR TASK 6.6.1
================================================================================
```

_Audit complete. Awaiting human authorization before proceeding to Task 6.6.1._
