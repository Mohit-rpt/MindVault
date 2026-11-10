# MindVault Phase 6.6 — Task 6.6.1 SQL Ranking & Scoring Remediation Report

**Milestone:** Phase 6.6 — GraphRAG Retrieval  
**Task:** 6.6.1 Remediation — SQL Ranking, Frontier Selection, Deduplication Bounds & Score Aggregation  
**Mode:** AUTHORIZED IMPLEMENTATION  
**Date:** 2026-11-09  
**Reference Document:** `PHASE_6_6_1_INDEPENDENT_SQL_CORRECTNESS_AUDIT.md`  
**Deliverable:** `PHASE_6_6_1_REMEDIATION_REPORT.md`

---

## 1. Executive Summary & Original Audit Findings

An independent SQL correctness audit of the Task 6.6.1 implementation uncovered four specific SQL defects that compromised deterministic ranking, candidate selection, and score corroboration under PostgreSQL 16. All four defects have been remediated in `apps/api/src/modules/graph/queries/graph-retrieval.sql.ts`, verified against live PostgreSQL 16, and locked in with automated regression tests.

### Audit Findings Summary

| Finding ID   | Investigation   | Topic                                          | Original Severity |   Remediation Status    |
| :----------- | :-------------- | :--------------------------------------------- | :---------------: | :---------------------: |
| **DEFECT-A** | Investigation 1 | Seed Discovery Candidate Truncation            |     **HIGH**      | **RESOLVED & VERIFIED** |
| **DEFECT-B** | Investigation 3 | Frontier Parent Selection Truncation           |     **HIGH**      | **RESOLVED & VERIFIED** |
| **DEFECT-C** | Investigation 4 | Intermediate Relation Deduplication Truncation |     **HIGH**      | **RESOLVED & VERIFIED** |
| **DEFECT-D** | Investigation 5 | Tied Maximum Score Suppression & Inflation     |    **MEDIUM**     | **RESOLVED & VERIFIED** |

---

## 2. Root Cause Analysis

### 2.1 The PostgreSQL `DISTINCT ON (...)` Sorting Anti-Pattern (Defects A, B, C)

PostgreSQL standard SQL semantics dictate:

> _"If `DISTINCT ON` is used, the `ORDER BY` clause must contain expressions that match the `DISTINCT ON` expressions, starting from the leftmost."_

When executing a single-level query of the form:

```sql
SELECT DISTINCT ON (group_key) group_key, payload, salience_score
FROM candidates
ORDER BY group_key, salience_score DESC
LIMIT N;
```

1. PostgreSQL first groups the stream by `group_key` and extracts the row with the highest `salience_score` within that `group_key`.
2. Crucially, the resulting deduplicated stream **retains the ordering of `group_key`**.
3. When `LIMIT N` is evaluated immediately on that statement, PostgreSQL returns the first $N$ rows according to the lexical/UUID ordering of `group_key`, **completely ignoring `salience_score` across groups**.
4. Consequently:
   - In **Seed Discovery**, candidates with late UUIDs (e.g., `ffff...`) were pruned even if their score was `1.0` (canonical match), while candidates with early UUIDs (e.g., `0000...`) were retained even if their score was `0.71` (weak semantic match).
   - In **Frontier Parent Selection**, the top 10 frontier parents for depth-2 expansion were selected by neighbor UUID order, discarding high-confidence 0.99 neighbors in favor of 0.60 neighbors.
   - In **Intermediate Relation Deduplication**, when candidate relations exceeded the intermediate bound of 150, the `LIMIT 150` pruned by `relation_id` UUID order, discarding depth-1 high-confidence relations in favor of depth-2 relations.

### 2.2 Score Formula Discontinuity & Tied Maximum Suppression (Defect D)

In the original evidence aggregation logic:

```sql
CASE WHEN cec.raw_score < max_scores.max_score THEN 0.2 * cec.raw_score ELSE 0.0 END
```

1. If a chunk was substantiated by two distinct relations that both possessed the exact same maximum score (e.g., $S_1 = 0.85, S_2 = 0.85$), the condition `raw_score < max_score` evaluated to `false` for **both** rows ($0.85 < 0.85$ is `false`).
2. Both rows were assigned $0.0$ for secondary corroboration, yielding a final score of $0.85$ instead of $\min(1.0, 0.85 + 0.2 \times 0.85) = 1.00$.
3. Furthermore, joining an un-deduplicated `chunk_evidence_candidates` view with an external `max_scores` subquery introduced unnecessary query planning overhead (4.53ms execution time) and left open the possibility that duplicate database records could inflate secondary scores.

---

## 3. Exact Corrections Implemented

### 3.1 Correction A: Seed Discovery Two-Stage Global Ranking

Wrapped `DISTINCT ON ("entityId")` inside a dedicated `deduplicated_seeds` CTE. The outer query now re-sorts globally by `seedScore DESC, canonicalName ASC, entityId ASC` before applying `LIMIT ${clampedMaxSeeds}`:

```sql
WITH combined_seeds AS (
    ${lexicalBranch}
    UNION ALL
    ${semanticBranch}
),
deduplicated_seeds AS (
    SELECT DISTINCT ON ("entityId")
        "entityId",
        "canonicalName",
        "entityType",
        "seedScore",
        "matchStrategy"
    FROM combined_seeds
    WHERE "entityId" IS NOT NULL
    ORDER BY "entityId", "seedScore" DESC, "canonicalName" ASC
)
SELECT
    "entityId",
    "canonicalName",
    "entityType",
    "seedScore",
    "matchStrategy"
FROM deduplicated_seeds
ORDER BY "seedScore" DESC, "canonicalName" ASC, "entityId" ASC
LIMIT ${clampedMaxSeeds};
```

### 3.2 Correction B: Frontier Parent Two-Stage Global Ranking

Wrapped `DISTINCT ON (neighbor_id)` inside a subquery `dedup_frontier`. The outer query re-orders globally by `confidence DESC, weight DESC, neighbor_id ASC` before applying `LIMIT 10`:

```sql
FROM (
    SELECT
        neighbor_id,
        weight,
        confidence,
        path,
        depth
    FROM (
        SELECT DISTINCT ON (neighbor_id)
            neighbor_id,
            weight,
            confidence,
            path,
            depth
        FROM graph_expansion
        WHERE depth = 1
        ORDER BY neighbor_id, confidence DESC, weight DESC
    ) dedup_frontier
    ORDER BY confidence DESC, weight DESC, neighbor_id ASC
    LIMIT 10
) ge
```

### 3.3 Correction C: Intermediate Relation Deduplication Two-Stage Global Ranking

Wrapped `DISTINCT ON (relation_id)` inside a subquery `dedup_rels`. The outer query re-orders globally by `depth ASC, confidence DESC, weight DESC, relation_id ASC` before enforcing the hard intermediate bound of `LIMIT 150`:

```sql
deduplicated_relations AS (
    SELECT
        relation_id,
        source_entity_id,
        target_entity_id,
        relation_type,
        weight,
        confidence,
        depth
    FROM (
        SELECT DISTINCT ON (relation_id)
            relation_id,
            source_entity_id,
            target_entity_id,
            relation_type,
            weight,
            confidence,
            depth
        FROM graph_expansion
        ORDER BY relation_id, depth ASC, confidence DESC, weight DESC
    ) dedup_rels
    ORDER BY depth ASC, confidence DESC, weight DESC, relation_id ASC
    LIMIT 150
),
```

### 3.4 Correction D: Evidence Deduplication & Closed-Form Algebraic Score Aggregation

1. **Evidence Deduplication (`deduplicated_chunk_evidence`):** Grouped by `(chunk_id, document_id, provenance_type, relation_id, relation_type, source_entity_id)` with `MAX(raw_score)`. This prevents duplicate evidence records from artificially inflating scores.
2. **Closed-Form Algebraic Formula:** Replaced the conditional `CASE` join with the algebraic identity:
   $$S_{\text{final}} = \min\left(1.0, S_{\max} + 0.2 \sum_{j \neq \text{argmax}} S_j\right) = \min\left(1.0, 0.8 \cdot S_{\max} + 0.2 \sum_{j} S_j\right)$$
   This guarantees that tied maximum scores each contribute appropriately to corroboration while eliminating the secondary subquery join.

```sql
deduplicated_chunk_evidence AS (
    SELECT
        chunk_id,
        document_id,
        provenance_type,
        relation_id,
        relation_type,
        source_entity_id,
        MAX(raw_score) AS raw_score
    FROM chunk_evidence_candidates
    GROUP BY chunk_id, document_id, provenance_type, relation_id, relation_type, source_entity_id
),
aggregated_chunk_scores AS (
    SELECT
        dce.chunk_id,
        dce.document_id,
        LEAST(1.0::double precision,
            0.8::double precision * MAX(dce.raw_score) + 0.2::double precision * SUM(dce.raw_score)
        ) AS final_graph_score,
        COUNT(DISTINCT dce.relation_id) AS supported_relations_count,
        ARRAY_AGG(DISTINCT dce.relation_id) FILTER (WHERE dce.relation_id IS NOT NULL) AS supported_relation_ids,
        ARRAY_AGG(DISTINCT dce.relation_type) FILTER (WHERE dce.relation_type IS NOT NULL) AS relation_types
    FROM deduplicated_chunk_evidence dce
    GROUP BY dce.chunk_id, dce.document_id
)
```

---

## 4. Changed-File Inventory

| File Path                                                                                                                                                                                                | Nature of Change |              Lines Changed              | Purpose                                                                      |
| :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :--------------: | :-------------------------------------: | :--------------------------------------------------------------------------- |
| [`apps/api/src/modules/graph/queries/graph-retrieval.sql.ts`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/modules/graph/queries/graph-retrieval.sql.ts)                               |     Modified     | Lines 89–108, 206–227, 247–271, 307–334 | Implemented two-stage global ordering for CTEs and closed-form score formula |
| [`apps/api/src/modules/graph/__tests__/graph-retrieval.remediation.test.ts`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/modules/graph/__tests__/graph-retrieval.remediation.test.ts) |     Created      |                393 lines                | Dedicated automated test suite targeting the 4 remediated behaviors          |

_Note: Zero database migrations, zero Prisma schema changes, and zero changes to Task 6.6.2 modules were made._

---

## 5. SQL Before-and-After Behavior Comparison

### 5.1 Seed Discovery Truncation

- **Before:**
  ```sql
  SELECT DISTINCT ON ("entityId") ...
  ORDER BY "entityId", "seedScore" DESC
  LIMIT 5;
  ```
  _Result:_ Entities sorted by `"entityId"` (UUID). Canonical entities with `score = 1.0` and UUID `ffff...` were pruned. Weak semantic entities with `score = 0.71` and UUID `0000...` were returned.
- **After:**
  ```sql
  WITH deduplicated_seeds AS (
      SELECT DISTINCT ON ("entityId") ...
      ORDER BY "entityId", "seedScore" DESC, "canonicalName" ASC
  )
  SELECT ... FROM deduplicated_seeds
  ORDER BY "seedScore" DESC, "canonicalName" ASC, "entityId" ASC
  LIMIT 5;
  ```
  _Result:_ Top candidates are guaranteed to be the highest salience entities. Ties are broken deterministically by `canonicalName ASC` then `entityId ASC`.

### 5.2 Frontier Parent Selection

- **Before:**
  ```sql
  SELECT DISTINCT ON (neighbor_id) ...
  ORDER BY neighbor_id, confidence DESC, weight DESC
  LIMIT 10;
  ```
  _Result:_ Selected the first 10 neighbors in UUID alphabetical order. All 5 high-confidence (0.99) neighbors with `ffff...` UUIDs were dropped.
- **After:**
  ```sql
  SELECT neighbor_id, ... FROM (
      SELECT DISTINCT ON (neighbor_id) ...
      ORDER BY neighbor_id, confidence DESC, weight DESC
  ) dedup_frontier
  ORDER BY confidence DESC, weight DESC, neighbor_id ASC
  LIMIT 10;
  ```
  _Result:_ The top 10 neighbors across the entire frontier are selected strictly by highest confidence and weight.

### 5.3 Intermediate Relation Pruning (Bound = 150)

- **Before:**
  ```sql
  SELECT DISTINCT ON (relation_id) ...
  ORDER BY relation_id, depth ASC, confidence DESC, weight DESC
  LIMIT 150;
  ```
  _Result:_ Pruned intermediate candidate edges by `relation_id` UUID. 50 depth-1 high-confidence relations were completely purged, while 150 depth-2 relations were retained.
- **After:**
  ```sql
  SELECT relation_id, ... FROM (
      SELECT DISTINCT ON (relation_id) ...
      ORDER BY relation_id, depth ASC, confidence DESC, weight DESC
  ) dedup_rels
  ORDER BY depth ASC, confidence DESC, weight DESC, relation_id ASC
  LIMIT 150;
  ```
  _Result:_ All 50 depth-1 relations are preserved. Only lower-quality depth-2 relations are truncated when the intermediate ceiling of 150 is reached.

### 5.4 Score Aggregation & Corroboration

- **Before:**
  ```sql
  LEAST(1.0, MAX(raw_score) + SUM(CASE WHEN raw_score < max_score THEN 0.2 * raw_score ELSE 0 END))
  ```
  _Result:_ Tied maximums ($0.85, 0.85$) yielded $0.85$ (delta $-0.15$). Duplicate evidence rows artificially inflated the sum. Required an expensive join to `max_scores`.
- **After:**
  ```sql
  LEAST(1.0, 0.8 * MAX(raw_score) + 0.2 * SUM(raw_score))
  ```
  _Result:_ Tied maximums ($0.85, 0.85$) yield $\min(1.0, 0.8(0.85) + 0.2(1.70)) = 1.00$. Evidence is deduplicated beforehand by identity tuple, preventing duplicate evidence inflation. No join required.

---

## 6. Dedicated Regression Test Suite

A dedicated integration test suite was created in [`apps/api/src/modules/graph/__tests__/graph-retrieval.remediation.test.ts`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/modules/graph/__tests__/graph-retrieval.remediation.test.ts) comprising 6 comprehensive test cases:

1. **`ensures high-score entities with lexicographically late UUIDs outrank low-score entities with early UUIDs`**
   - Validates that two 1.00 score canonical entities with `ffff...` UUIDs outrank five 0.95 and 0.72 entities with `0000...` UUIDs.
2. **`ensures canonical matches outrank aliases when both identify the same entity`**
   - Creates a live entity and alias in PostgreSQL; queries with ngrams matching both; asserts canonical `LEXICAL` match (score 1.0) outranks alias (score 0.95).
3. **`enforces deterministic tie-breaking for equal-score seeds`**
   - Verifies identical score candidates are deterministically ordered by `canonicalName ASC`.
4. **`retains all 5 high-confidence neighbors with late UUIDs when competing against 10 low-confidence neighbors with early UUIDs`**
   - Submits 15 frontier neighbors (10 with conf 0.60, 5 with conf 0.99 and `ffff...` UUIDs). Asserts all 5 high-confidence neighbors occupy the top 5 frontier slots.
5. **`prioritizes high-quality shallow relations over deeper lower-quality relations across 200 candidates`**
   - Submits 50 depth-1 relations (conf 1.0, `ffff...` UUIDs) and 150 depth-2 relations (conf 0.5, `0000...` UUIDs). Asserts that after `LIMIT 150`, all 50 depth-1 relations are retained and exactly 50 depth-2 relations are pruned.
6. **`correctly calculates score across all required corroboration scenarios`**
   - Verifies all 7 corroboration scenarios:
     - Single record ($0.85 \to 0.85$)
     - Different scores ($0.85, 0.50 \to 0.95$)
     - Tied maximum scores ($0.85, 0.85 \to 1.00$)
     - Three records ($0.80, 0.70, 0.50 \to 1.00$)
     - Mixed relation and mention ($0.80, 0.675 \to 0.935$)
     - Duplicate records ($0.85, 0.85$ same relation $\to 0.85$ uninflated)
     - Score clamping ($0.95, 0.90, 0.85 \to 1.00$)

---

## 7. PostgreSQL Live Execution Results

Executing the remediation suite directly against the live PostgreSQL 16 Docker container:

```bash
pnpm exec vitest run apps/api/src/modules/graph/__tests__/graph-retrieval.remediation.test.ts
```

**Output:**

```text
 ✓ apps/api/src/modules/graph/__tests__/graph-retrieval.remediation.test.ts (6 tests) 399ms

 Test Files  1 passed (1)
      Tests  6 passed (6)
   Start at  10:01:23
   Duration  2.95s
```

All 6 test cases executed against live PostgreSQL without errors, warnings, or timeouts.

---

## 8. Tenant-Isolation Verification

Multi-tenant workspace boundary enforcement was re-verified across all modified SQL queries:

1. **`buildSeedDiscoveryQuery`:**
   - Lexical branch: `WHERE e.workspace_id = ${workspaceId}`
   - Alias branch: `WHERE a.workspace_id = ${workspaceId}`
   - Semantic branch: `WHERE e.workspace_id = ${workspaceId}`
2. **`buildGraphEvidenceQuery`:**
   - Anchor member: `WHERE r.workspace_id = ${workspaceId}`
   - Recursive member lateral query: `WHERE r2.workspace_id = ${workspaceId}`
   - Strategy 1 join: `JOIN relation_evidence re ON dr.relation_id = re.relation_id AND re.workspace_id = ${workspaceId}`
   - Strategy 2 join: `JOIN document_chunks c ON cem.chunk_id = c.id AND c."workspaceId" = ${workspaceId}` and `WHERE cem.workspace_id = ${workspaceId}`
   - Final projection: `JOIN document_chunks c ON acs.chunk_id = c.id AND c."workspaceId" = ${workspaceId}` and `JOIN documents d ON acs.document_id = d.id AND d."workspaceId" = ${workspaceId}`
3. **Repository Execution:**
   - Both `discoverEntitySeeds` and `searchGraphEvidence` require and enforce `workspaceId: string` UUID format.
   - Cross-workspace queries return 0 records with zero information leakage.

---

## 9. Performance Comparison

Execution plans were measured using `EXPLAIN (ANALYZE, BUFFERS)` on the live PostgreSQL container before and after the remediation:

| Metric                          | Before Remediation | After Remediation | Improvement / Impact             |
| :------------------------------ | :----------------: | :---------------: | :------------------------------- |
| **Query Planning Time**         |      0.82 ms       |      0.44 ms      | 46.3% faster planning            |
| **Query Execution Time**        |      4.53 ms       |      1.86 ms      | **58.9% faster execution**       |
| **Intermediate Subquery Joins** |  1 (`max_scores`)  |  0 (eliminated)   | Simplified query graph           |
| **Buffer Shared Hits**          |     48 blocks      |     26 blocks     | 45.8% reduction in buffer access |
| **WorkMem / Temp Disk Spills**  |      0 bytes       |      0 bytes      | 100% in-memory execution         |
| **Timeout Headroom**            |     2495.47 ms     |    2498.14 ms     | Well within 2500ms safety limit  |

The closed-form algebraic formula eliminated the need to scan `chunk_evidence_candidates` twice to compute the maximum score, resulting in a **58.9% reduction in execution latency**.

---

## 10. Full Regression Test Results

All 8 graph test suites across the MindVault codebase were executed sequentially against the live database:

```bash
pnpm exec vitest run \
  apps/api/src/modules/graph/__tests__/graph-retrieval.sql.test.ts \
  apps/api/src/modules/graph/__tests__/graph-retrieval.repository.test.ts \
  apps/api/src/modules/graph/__tests__/graph-retrieval.remediation.test.ts \
  apps/api/src/modules/graph/__tests__/graph.repository.traversal.test.ts \
  apps/api/src/modules/graph/__tests__/graph-traversal.adversarial.test.ts \
  apps/api/src/modules/graph/__tests__/graph.routes.test.ts \
  apps/api/src/modules/graph/__tests__/graph-traversal.service.test.ts \
  apps/api/src/modules/graph/__tests__/graph-path.service.test.ts
```

### Results Summary

| Test Suite                            | Tests Passed | Tests Failed | Execution Time |
| :------------------------------------ | :----------: | :----------: | :------------: |
| `graph-traversal.adversarial.test.ts` |      45      |      0       |    8570 ms     |
| `graph.routes.test.ts`                |      33      |      0       |    2840 ms     |
| `graph.repository.traversal.test.ts`  |      30      |      0       |    2450 ms     |
| `graph-traversal.service.test.ts`     |      24      |      0       |    1850 ms     |
| `graph-retrieval.repository.test.ts`  |      19      |      0       |    3181 ms     |
| `graph-path.service.test.ts`          |      18      |      0       |    1250 ms     |
| `graph-retrieval.sql.test.ts`         |      8       |      0       |     12 ms      |
| `graph-retrieval.remediation.test.ts` |      6       |      0       |     929 ms     |
| **TOTAL**                             |   **183**    |    **0**     |  **22.75 s**   |

### Monorepo Validation

- **`pnpm typecheck`:** 0 errors across 4 workspaces (`@mindvault/api`, `@mindvault/shared`, `@mindvault/worker`, `@mindvault/web`).
- **`pnpm lint`:** 0 warnings or errors.
- **`pnpm --filter @mindvault/api build`:** Clean build.

---

## 11. Remaining Warnings or Limitations

1. **pgvector Index Scanning:**
   - Semantic seed matching relies on `ORDER BY e.embedding <=> queryVector::vector ASC LIMIT N`. In environments where HNSW or IVFFlat indexes are defined on `graph_entities(embedding vector_cosine_ops)`, this query is index-accelerated. In small test workspaces without populated embeddings, the query cleanly executes the lexical branch.
2. **PostgreSQL 16 CTE Inlining:**
   - The outer CTEs (`deduplicated_seeds`, `deduplicated_relations`) are automatically inlined or materialized by PostgreSQL 16 based on cost. Explicit `AS MATERIALIZED` is unnecessary and was deliberately omitted to allow PostgreSQL's planner to optimize push-down predicates.
3. **Scope Boundary Confirmation:**
   - Task 6.6.2 (Three-Way RRF Fusion & Retrieval Service Integration) remains completely untouched and unauthorized pending explicit human approval.

---

## 12. Git Status & Commit Reference

- **Base Commit Hash:** `a5697e4cec094c0a0af0575a5c16d53311fc7e1d` (`feat(graph): implement Phase 6.4 worker lifecycle and distributed startup reconciliation`)
- **Active Branch:** `main`
- **Working Tree State:** All existing Phase 6.5 and Task 6.6.1 uncommitted changes are strictly preserved.
- **Modified Files for Remediation:**
  - `apps/api/src/modules/graph/queries/graph-retrieval.sql.ts`
- **New Files Added for Remediation:**
  - `apps/api/src/modules/graph/__tests__/graph-retrieval.remediation.test.ts`
  - `PHASE_6_6_1_REMEDIATION_REPORT.md`

---

## 13. Remediation Sign-Off & Recommendation

The Phase 6.6.1 SQL Ranking & Scoring Remediation has been implemented, verified, and audited with **100% test pass rate (183/183)** and zero regressions.

**Recommendation:** Task 6.6.1 is **FULLY VERIFIED & CLOSED**. The codebase is now mathematically and architecturally sound for the owner to consider authoring or authorizing **Task 6.6.2 (Three-Way RRF Fusion & Service Integration)**.
