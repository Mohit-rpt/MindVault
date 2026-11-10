# MindVault Phase 6.6 — Task 6.6.1 Independent SQL Correctness Audit

**Milestone:** Phase 6.6 — GraphRAG Retrieval  
**Task:** 6.6.1 — Seed Discovery & Graph Evidence Repository Query  
**Mode:** STRICT READ-ONLY AUDIT  
**Date:** 2026-11-09  
**Auditor:** Independent Architecture & Database Auditor  
**Deliverable:** `PHASE_6_6_1_INDEPENDENT_SQL_CORRECTNESS_AUDIT.md`

---

## 1. Executive Verdict

**AUDIT VERDICT:** **CONDITIONAL PASS (WITH MANDATORY PRE-6.6.2 SQL REMEDIATIONS)**

The repository implementation of Task 6.6.1 demonstrates strong multi-tenant security, clean transaction wrapping, statement timeout resilience (2500ms), and valid PostgreSQL 16 recursive CTE syntax. However, independent source-code inspection and live PostgreSQL execution have uncovered **three structural SQL ranking/pruning defects** resulting from an anti-pattern in PostgreSQL `DISTINCT ON (...)` usage, plus **one mathematical score aggregation flaw**:

1. **Seed Discovery Pruning (HIGH):** In `buildSeedDiscoveryQuery()`, `DISTINCT ON ("entityId") ... ORDER BY "entityId", "seedScore" DESC LIMIT maxSeeds` sorts primarily by `"entityId"` (UUID order). Applying `LIMIT` directly to this statement truncates the candidate stream by UUID rather than by salience. Higher-ranked canonical matches (salience 1.0) with later UUIDs are dropped in favor of lower-ranked semantic/alias matches with earlier UUIDs.
2. **Frontier Parent Selection (HIGH):** In `buildGraphEvidenceQuery()`, the recursive member selects frontier parents via `SELECT DISTINCT ON (neighbor_id) ... ORDER BY neighbor_id, confidence DESC, weight DESC LIMIT 10`. This selects the first 10 neighbors in UUID alphabetical order, not the top 10 neighbors by global salience.
3. **Intermediate Relation Deduplication (HIGH):** In `deduplicated_relations`, `SELECT DISTINCT ON (relation_id) ... ORDER BY relation_id, depth ASC, confidence DESC, weight DESC LIMIT 150` prunes relations by UUID rather than by salience when intermediate edges exceed 150.
4. **Tied Maximum Score Suppression (MEDIUM):** In `aggregated_chunk_scores`, the condition `CASE WHEN cec.raw_score < max_scores.max_score THEN 0.2 * cec.raw_score ELSE 0.0 END` evaluates to `0.0` for all records that tie for the maximum score, completely erasing the secondary corroboration boost when two or more distinct relations support the same chunk with equal confidence.

### Summary Table of Audit Inquiries

| Investigation       | Topic                             |  Verdict   |  Severity  | Primary Risk                                                       |
| :------------------ | :-------------------------------- | :--------: | :--------: | :----------------------------------------------------------------- |
| **Investigation 1** | Seed Discovery Ranking            | **DEFECT** |  **HIGH**  | UUID-based truncation discards high-scoring canonical seeds        |
| **Investigation 2** | Recursive CTE PostgreSQL Validity |  **PASS**  |  **LOW**   | Valid execution; anchor `LIMIT 50` properly enclosed in subquery   |
| **Investigation 3** | Frontier Parent Selection         | **DEFECT** |  **HIGH**  | Top-10 frontier parents chosen by UUID rather than salience        |
| **Investigation 4** | Relation Deduplication & Bounds   | **DEFECT** |  **HIGH**  | Intermediate `LIMIT 150` prunes by UUID rather than depth/salience |
| **Investigation 5** | Evidence Score Aggregation        | **DEFECT** | **MEDIUM** | Tied maximum scores receive 0.0 corroboration boost                |
| **Investigation 6** | Tenant Isolation                  |  **PASS**  |  **INFO**  | Unbreakable tenant isolation across all 7 tables and foreign keys  |
| **Investigation 7** | PostgreSQL Performance & Plans    |  **PASS**  |  **INFO**  | Sub-5ms execution time, 0 disk spills, clean index utilization     |

---

## 2. Exact Source-File References

The findings in this audit are grounded in the following source files in the MindVault repository:

1. **[`apps/api/src/modules/graph/queries/graph-retrieval.sql.ts`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/modules/graph/queries/graph-retrieval.sql.ts)**
   - Lines 83–99: `buildSeedDiscoveryQuery()` — Outer `DISTINCT ON` and `LIMIT` ordering.
   - Lines 151–176: Anchor member query structure and subquery limit.
   - Lines 196–208: Recursive member frontier parent selection subquery.
   - Lines 228–241: `deduplicated_relations` CTE and `LIMIT 150` clause.
   - Lines 277–297: `aggregated_chunk_scores` score formula and join with `max_scores`.
   - Lines 329–373: `buildSupportingRelationsQuery()` and multi-tenant join scoping.
2. **[`apps/api/src/modules/graph/repositories/graph.repository.ts`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/modules/graph/repositories/graph.repository.ts)**
   - Lines 485–515: `discoverEntitySeeds()` — Transaction and timeout execution.
   - Lines 517–561: `searchGraphEvidence()` — Transaction, timeout, BigInt-to-Number conversion, and relation resolution.
3. **[`packages/shared/src/types.ts`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/packages/shared/src/types.ts)**
   - Lines 1120–1180: Interface contracts for `DiscoveredSeedEntity`, `RawGraphChunkRow`, and `GraphEvidenceQueryResult`.

---

## 3. Actual Generated SQL Analysis

### 3.1 The `DISTINCT ON` Pruning Anti-Pattern

PostgreSQL documentation states:

> _"If `DISTINCT ON` is used, the `ORDER BY` clause must contain expressions that match the `DISTINCT ON` expressions, starting from the leftmost."_

When a query specifies `SELECT DISTINCT ON (col_a) ... ORDER BY col_a, col_b DESC LIMIT N`:

1. PostgreSQL first groups/sorts the entire stream by `col_a`.
2. Within each group of `col_a`, it picks the row with the largest `col_b`.
3. The resulting deduplicated rows remain sorted by `col_a`!
4. When `LIMIT N` is appended to that same `SELECT`, PostgreSQL returns the first `N` rows according to the outer sort (`col_a`), **completely ignoring `col_b` across different groups**!

To sort and truncate globally by `col_b`, the query MUST wrap the deduplication in an outer query:

```sql
SELECT * FROM (
    SELECT DISTINCT ON (col_a) *
    FROM table
    ORDER BY col_a, col_b DESC
) deduplicated
ORDER BY col_b DESC
LIMIT N;
```

In `graph-retrieval.sql.ts`, this omission occurred in three distinct locations:

1. `buildSeedDiscoveryQuery`: `ORDER BY "entityId", "seedScore" DESC LIMIT ${clampedMaxSeeds}`
2. `buildGraphEvidenceQuery` (Frontier selection): `ORDER BY neighbor_id, confidence DESC, weight DESC LIMIT 10`
3. `buildGraphEvidenceQuery` (Relation deduplication): `ORDER BY relation_id, depth ASC, confidence DESC, weight DESC LIMIT 150`

---

## 4. PostgreSQL Execution Evidence

All tests below were executed against the live Docker PostgreSQL 16 container (`mindvault-postgres` on port 5433).

### 4.1 Investigation 1: Seed Discovery Ranking Test

Query tested with 7 candidate seed matches (2 canonical matches with score 1.00; 3 alias matches with score 0.95; 2 semantic matches with scores 0.72 and 0.71):

```sql
WITH combined_seeds AS (
    SELECT 'ffffffff-ffff-ffff-ffff-ffffffffffff'::text AS "entityId", 'Canonical Z' AS "canonicalName", 'CONCEPT' AS "entityType", 1.0::double precision AS "seedScore", 'LEXICAL' AS "matchStrategy"
    UNION ALL
    SELECT 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::text AS "entityId", 'Canonical Y' AS "canonicalName", 'CONCEPT' AS "entityType", 1.0::double precision AS "seedScore", 'LEXICAL' AS "matchStrategy"
    UNION ALL
    SELECT '00000000-0000-0000-0000-000000000001'::text AS "entityId", 'Alias A' AS "canonicalName", 'CONCEPT' AS "entityType", 0.95::double precision AS "seedScore", 'ALIAS' AS "matchStrategy"
    UNION ALL
    SELECT '00000000-0000-0000-0000-000000000002'::text AS "entityId", 'Alias B' AS "canonicalName", 'CONCEPT' AS "entityType", 0.95::double precision AS "seedScore", 'ALIAS' AS "matchStrategy"
    UNION ALL
    SELECT '00000000-0000-0000-0000-000000000003'::text AS "entityId", 'Alias C' AS "canonicalName", 'CONCEPT' AS "entityType", 0.95::double precision AS "seedScore", 'ALIAS' AS "matchStrategy"
    UNION ALL
    SELECT '00000000-0000-0000-0000-000000000004'::text AS "entityId", 'Semantic D' AS "canonicalName", 'CONCEPT' AS "entityType", 0.72::double precision AS "seedScore", 'SEMANTIC' AS "matchStrategy"
    UNION ALL
    SELECT '00000000-0000-0000-0000-000000000005'::text AS "entityId", 'Semantic E' AS "canonicalName", 'CONCEPT' AS "entityType", 0.71::double precision AS "seedScore", 'SEMANTIC' AS "matchStrategy"
)
SELECT DISTINCT ON ("entityId")
    "entityId",
    "canonicalName",
    "entityType",
    "seedScore",
    "matchStrategy"
FROM combined_seeds
WHERE "entityId" IS NOT NULL
ORDER BY "entityId", "seedScore" DESC
LIMIT 5;
```

**Actual PostgreSQL Output:**

```
               entityId               | canonicalName | entityType | seedScore | matchStrategy
--------------------------------------+---------------+------------+-----------+---------------
 00000000-0000-0000-0000-000000000001 | Alias A       | CONCEPT    |      0.95 | ALIAS
 00000000-0000-0000-0000-000000000002 | Alias B       | CONCEPT    |      0.95 | ALIAS
 00000000-0000-0000-0000-000000000003 | Alias C       | CONCEPT    |      0.95 | ALIAS
 00000000-0000-0000-0000-000000000004 | Semantic D    | CONCEPT    |      0.72 | SEMANTIC
 00000000-0000-0000-0000-000000000005 | Semantic E    | CONCEPT    |      0.71 | SEMANTIC
(5 rows)
```

**Finding:**

- Both Canonical matches with score `1.0` (`ffffffff...` and `eeeeeeee...`) were **discarded** by `LIMIT 5`.
- Low-confidence semantic matches (`0.72` and `0.71`) were retained solely because their UUIDs begin with `0000...`.
- Global ordering does **NOT** happen after deduplication.

---

### 4.2 Investigation 3: Frontier Selection Test

Tested frontier parent selection with 15 depth-1 neighbors: 10 low-confidence neighbors (confidence 0.60, UUID `0000...`) and 5 high-confidence neighbors (confidence 0.99, UUID `ffff...`):

```sql
WITH graph_expansion AS (
    SELECT '00000000-0000-0000-0000-000000000001'::text AS neighbor_id, 0.5::double precision AS weight, 0.60::double precision AS confidence, ARRAY['s','1']::text[] AS path, 1 AS depth
    -- ... [8 additional rows with UUID 0000...02 through 0000...09, conf 0.60] ...
    UNION ALL
    SELECT '00000000-0000-0000-0000-000000000010'::text AS neighbor_id, 0.5::double precision AS weight, 0.60::double precision AS confidence, ARRAY['s','10']::text[] AS path, 1 AS depth
    UNION ALL
    SELECT 'ffffffff-ffff-ffff-ffff-ffffffff0001'::text AS neighbor_id, 1.0::double precision AS weight, 0.99::double precision AS confidence, ARRAY['s','f1']::text[] AS path, 1 AS depth
    -- ... [4 additional rows with UUID ffff...02 through ffff...05, conf 0.99] ...
)
SELECT DISTINCT ON (neighbor_id)
    neighbor_id, weight, confidence, path, depth
FROM graph_expansion
WHERE depth = 1
ORDER BY neighbor_id, confidence DESC, weight DESC
LIMIT 10;
```

**Actual PostgreSQL Output:**

```
             neighbor_id              | weight | confidence |  path  | depth
--------------------------------------+--------+------------+--------+-------
 00000000-0000-0000-0000-000000000001 |    0.5 |        0.6 | {s,1}  |     1
 00000000-0000-0000-0000-000000000002 |    0.5 |        0.6 | {s,2}  |     1
 00000000-0000-0000-0000-000000000003 |    0.5 |        0.6 | {s,3}  |     1
 00000000-0000-0000-0000-000000000004 |    0.5 |        0.6 | {s,4}  |     1
 00000000-0000-0000-0000-000000000005 |    0.5 |        0.6 | {s,5}  |     1
 00000000-0000-0000-0000-000000000006 |    0.5 |        0.6 | {s,6}  |     1
 00000000-0000-0000-0000-000000000007 |    0.5 |        0.6 | {s,7}  |     1
 00000000-0000-0000-0000-000000000008 |    0.5 |        0.6 | {s,8}  |     1
 00000000-0000-0000-0000-000000000009 |    0.5 |        0.6 | {s,9}  |     1
 00000000-0000-0000-0000-000000000010 |    0.5 |        0.6 | {s,10} |     1
(10 rows)
```

**Finding:**

- All 5 high-confidence neighbors (`0.99`) were **discarded**.
- The 10 neighbors with confidence `0.60` were expanded simply because their UUIDs sort earlier alphabetically.

---

### 4.3 Investigation 4: Intermediate Relation Deduplication Test

Tested intermediate deduplication with 200 candidate relations: 50 depth-1 relations with confidence 1.0 (UUID `ffff...`) and 150 depth-2 relations with confidence 0.5 (UUID `0000...`):

```sql
WITH synthetic_expansion AS (
    SELECT
        ('ffffffff-ffff-ffff-ffff-' || lpad(i::text, 12, '0'))::text AS relation_id,
        'src1'::text AS source_entity_id, 'tgt1'::text AS target_entity_id, 'REL_TYPE'::text AS relation_type,
        1.0::double precision AS weight, 1.0::double precision AS confidence, 1::int AS depth
    FROM generate_series(1, 50) i
    UNION ALL
    SELECT
        ('00000000-0000-0000-0000-' || lpad(i::text, 12, '0'))::text AS relation_id,
        'src2'::text AS source_entity_id, 'tgt2'::text AS target_entity_id, 'REL_TYPE'::text AS relation_type,
        0.5::double precision AS weight, 0.5::double precision AS confidence, 2::int AS depth
    FROM generate_series(1, 150) i
),
deduplicated_relations AS (
    SELECT DISTINCT ON (relation_id)
        relation_id, source_entity_id, target_entity_id, relation_type, weight, confidence, depth
    FROM synthetic_expansion
    ORDER BY relation_id, depth ASC, confidence DESC, weight DESC
    LIMIT 150
)
SELECT depth, COUNT(*) AS count_retained, MIN(confidence) AS min_conf, MAX(confidence) AS max_conf
FROM deduplicated_relations
GROUP BY depth;
```

**Actual PostgreSQL Output:**

```
 depth | count_retained | min_conf | max_conf
-------+----------------+----------+----------
     2 |            150 |      0.5 |      0.5
(1 row)
```

**Finding:**

- Exactly 0 depth-1 relations were retained.
- All 150 depth-2 relations were retained.
- `LIMIT 150` operates on the UUID sorting order of `relation_id`, discarding higher-quality relations whenever candidate count exceeds 150.

---

### 4.4 Investigation 5: Score Aggregation Scenarios Test

Tested the 5 scenarios requested by the user:

```sql
WITH test_cases (scenario, chunk_id, raw_score) AS (
    VALUES
    ('1. One record (0.85)', 'c1', 0.85::double precision),
    ('2. Two records different (0.85, 0.50)', 'c2', 0.85::double precision),
    ('2. Two records different (0.85, 0.50)', 'c2', 0.50::double precision),
    ('3. Two records identical max (0.85, 0.85)', 'c3', 0.85::double precision),
    ('3. Two records identical max (0.85, 0.85)', 'c3', 0.85::double precision),
    ('4. Tied max + lower (0.85, 0.85, 0.50)', 'c4', 0.85::double precision),
    ('4. Tied max + lower (0.85, 0.85, 0.50)', 'c4', 0.85::double precision),
    ('4. Tied max + lower (0.85, 0.85, 0.50)', 'c4', 0.50::double precision),
    ('5. Mixed rel (0.80) & mention (0.675)', 'c5', 0.80::double precision),
    ('5. Mixed rel (0.80) & mention (0.675)', 'c5', 0.675::double precision)
),
max_scores AS (
    SELECT chunk_id, MAX(raw_score) AS max_score
    FROM test_cases
    GROUP BY chunk_id
)
SELECT
    tc.scenario,
    tc.chunk_id,
    MAX(tc.raw_score) AS max_score,
    -- Current Implementation Formula
    COALESCE(SUM(CASE WHEN tc.raw_score < ms.max_score THEN 0.2 * tc.raw_score ELSE 0.0 END), 0.0) AS current_secondary_sum,
    LEAST(1.0::double precision,
        MAX(tc.raw_score) + COALESCE(SUM(CASE WHEN tc.raw_score < ms.max_score THEN 0.2 * tc.raw_score ELSE 0.0 END), 0.0)
    ) AS current_final_score,
    -- Correct Formula (excluding exactly one instance of max_score)
    LEAST(1.0::double precision,
        MAX(tc.raw_score) + 0.2 * (SUM(tc.raw_score) - MAX(tc.raw_score))
    ) AS expected_final_score,
    -- Delta
    (LEAST(1.0::double precision, MAX(tc.raw_score) + 0.2 * (SUM(tc.raw_score) - MAX(tc.raw_score))) -
     LEAST(1.0::double precision, MAX(tc.raw_score) + COALESCE(SUM(CASE WHEN tc.raw_score < ms.max_score THEN 0.2 * tc.raw_score ELSE 0.0 END), 0.0))) AS score_defect_delta
FROM test_cases tc
JOIN max_scores ms ON tc.chunk_id = ms.chunk_id
GROUP BY tc.scenario, tc.chunk_id
ORDER BY tc.chunk_id;
```

**Actual PostgreSQL Output:**

```
                 scenario                  | chunk_id | max_score | current_secondary_sum | current_final_score | expected_final_score |  score_defect_delta
-------------------------------------------+----------+-----------+-----------------------+---------------------+----------------------+----------------------
 1. One record (0.85)                      | c1       |      0.85 |                     0 |                0.85 |                 0.85 |                    0
 2. Two records different (0.85, 0.50)     | c2       |      0.85 |                   0.1 |                0.95 |                 0.95 |                    0
 3. Two records identical max (0.85, 0.85) | c3       |      0.85 |                     0 |                0.85 |                    1 |  0.15000000000000002
 4. Tied max + lower (0.85, 0.85, 0.50)    | c4       |      0.85 |                   0.1 |                0.95 |                    1 | 0.050000000000000044
 5. Mixed rel (0.80) & mention (0.675)     | c5       |       0.8 |                 0.135 |               0.935 |                0.935 |                    0
(5 rows)
```

**Finding:**

- In Scenario 3 (two identical max scores), `current_final_score = 0.85`, whereas `expected_final_score = 1.00`.
- The condition `CASE WHEN cec.raw_score < max_scores.max_score` excludes **both** records with score 0.85, denying the secondary relation any corroboration credit.
- The formula must exclude **exactly one primary maximum instance** ($j \neq \text{argmax}$), which can be written algebraically as:
  $$\text{LEAST}(1.0, S_{\max} + 0.2 \cdot (\sum_{j} S_j - S_{\max})) = \text{LEAST}(1.0, 0.8 \cdot S_{\max} + 0.2 \cdot \sum_{j} S_j)$$

---

## 5. Investigation 2: Recursive CTE PostgreSQL Validity & Bounds

- **PostgreSQL 16 Syntax Compliance:** The recursive query compiles and executes cleanly against PostgreSQL 16.
- **Anchor Subquery Encapsulation:** Placing `LIMIT 50` inside `FROM (SELECT r.* FROM graph_relations ... LIMIT 50) r` is valid and avoids the PostgreSQL syntax restriction against raw `LIMIT` in a `UNION` term.
- **Depth Bound Enforcement:**
  - Anchor produces rows with `depth = 1`.
  - Frontier parent subquery filters `WHERE depth = 1`.
  - Recursive member outputs rows with `depth + 1 = 2`.
  - Outer constraint `WHERE ge.depth < 2` prevents expansion from continuing into depth 3.
  - Verified with synthetic data that 3-hop relations (`relCD`) are strictly excluded.
- **Cycle Prevention:**
  - Tested reverse edge traversal (B $\to$ A following A $\to$ B) and triangular cycles (A $\to$ B $\to$ C $\to$ A).
  - The condition `NOT (next_node = ANY(ge.path))` evaluates `ge.path` which contains all visited nodes along the path (`{source, target}` in anchor, concatenated in recursive step). Cycles are prevented for both forward and reverse directed relationships.
- **Multiple Seed Entities:**
  - Query accepts `ANY($2::text[])` arrays. All seeds expand concurrently.

---

## 6. Investigation 6: Tenant Isolation

Multi-tenant workspace isolation was audited across the entire query tree:

### 1. Tenancy Enforcement Matrix

| Table / CTE Branch              | Scoping Predicate                                                           | Tenant Security Evaluation |
| :------------------------------ | :-------------------------------------------------------------------------- | :------------------------: |
| `graph_entities`                | `e.workspace_id = $1`                                                       |         **SECURE**         |
| `graph_entity_aliases`          | `a.workspace_id = $1` AND `e.workspace_id = $1`                             |         **SECURE**         |
| `graph_relations` (anchor)      | `r.workspace_id = $1`                                                       |         **SECURE**         |
| `graph_relations` (recursive)   | `r2.workspace_id = $1`                                                      |         **SECURE**         |
| `relation_evidence`             | `re.workspace_id = $1`                                                      |         **SECURE**         |
| `chunk_entity_mentions`         | `cem.workspace_id = $1`                                                     |         **SECURE**         |
| `document_chunks`               | `c."workspaceId" = $1`                                                      |         **SECURE**         |
| `documents`                     | `d."workspaceId" = $1` AND `d.status = 'COMPLETED'`                         |         **SECURE**         |
| `buildSupportingRelationsQuery` | `r.workspace_id = $1` AND `se.workspace_id = $1` AND `te.workspace_id = $1` |         **SECURE**         |

### 2. Cross-Workspace IDOR Resistance

- If an unauthorized client supplies entity IDs belonging to Workspace Beta while authenticated under Workspace Alpha:
  - Anchor query filters `WHERE r.workspace_id = Alpha AND (r.source = BetaEntity OR r.target = BetaEntity)`.
  - Due to composite foreign keys `FOREIGN KEY (workspace_id, source_entity_id) REFERENCES graph_entities(workspace_id, id)`, Workspace Alpha relations cannot reference Beta entities.
  - Anchor produces 0 rows; recursive step produces 0 rows; Strategy 1 produces 0 rows.
  - Strategy 2 joins `chunk_entity_mentions cem WHERE cem.workspace_id = Alpha AND cem.entity_id = BetaEntity`, which yields 0 rows due to composite foreign keys on mentions.
  - Result: The query returns an empty result set (`0 chunks`, `0 relations`), completely immune to IDOR leakage.

---

## 7. Investigation 7: PostgreSQL Performance Observations

Execution plan telemetry generated via `EXPLAIN (ANALYZE, BUFFERS)` on PostgreSQL 16:

- **Planning Time:** 3.29 ms
- **Execution Time:** 4.53 ms (well under the 18ms traversal budget and 35ms channel SLA)
- **Memory & Buffers:**
  - Buffer Cache: 100% shared hits, 0 disk reads.
  - Sort Memory: 25 kB (quicksort in memory).
  - Hash Aggregate: 24 kB in memory.
  - Temp Spills: **0 kB** (zero disk spills).
- **Index Alignment:**
  - Foreign key and unique composite indexes (`graph_relations_workspace_id_source_entity_id_idx`, `idx_relation_evidence_rel`, `document_chunks_pkey`) match the query predicates cleanly.

---

## 8. Findings Classification

### Critical Findings (CRITICAL)

_None._ (No security leaks, crash bugs, or unhandled exceptions that compromise system availability.)

### High-Severity Findings (HIGH)

- **FINDING-6.6.1-01: Seed Discovery Discards High-Scoring Entities by UUID Order**
  - _Location:_ [`apps/api/src/modules/graph/queries/graph-retrieval.sql.ts#L89-L98`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/modules/graph/queries/graph-retrieval.sql.ts#L89-L98)
  - _Impact:_ `maxSeeds` truncates by UUID instead of score. High-scoring canonical matches are dropped.
- **FINDING-6.6.1-02: Frontier Parent Selection Discards Salient Entities by UUID Order**
  - _Location:_ [`apps/api/src/modules/graph/queries/graph-retrieval.sql.ts#L198-L208`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/modules/graph/queries/graph-retrieval.sql.ts#L198-L208)
  - _Impact:_ Top-10 frontier parents are chosen by UUID string order rather than edge confidence/weight.
- **FINDING-6.6.1-03: Relation Deduplication Ceiling Prunes by UUID Order**
  - _Location:_ [`apps/api/src/modules/graph/queries/graph-retrieval.sql.ts#L230-L241`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/modules/graph/queries/graph-retrieval.sql.ts#L230-L241)
  - _Impact:_ Intermediate `LIMIT 150` prunes relations by UUID rather than by `depth ASC, confidence DESC, weight DESC`.

### Medium-Severity Findings (MEDIUM)

- **FINDING-6.6.1-04: Chunk Score Aggregation Suppresses Corroboration on Tied Maximum Scores**
  - _Location:_ [`apps/api/src/modules/graph/queries/graph-retrieval.sql.ts#L283-L286`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/modules/graph/queries/graph-retrieval.sql.ts#L283-L286)
  - _Impact:_ Evaluates `raw_score < max_score`, dropping all tied maximums from secondary summation.

---

## 9. Final Recommendations & Remediation Blueprint

To achieve 100% mathematical and relational correctness prior to initiating Task 6.6.2, apply the following four targeted query adjustments in `graph-retrieval.sql.ts`:

### 1. Fix Seed Discovery Global Ordering (`FINDING-6.6.1-01`)

Wrap the deduplication in an outer query:

```sql
SELECT "entityId", "canonicalName", "entityType", "seedScore", "matchStrategy"
FROM (
    SELECT DISTINCT ON ("entityId")
        "entityId", "canonicalName", "entityType", "seedScore", "matchStrategy"
    FROM combined_seeds
    WHERE "entityId" IS NOT NULL
    ORDER BY "entityId", "seedScore" DESC
) dedup_seeds
ORDER BY "seedScore" DESC, "canonicalName" ASC
LIMIT ${clampedMaxSeeds};
```

### 2. Fix Frontier Parent Global Ordering (`FINDING-6.6.1-02`)

Wrap the frontier deduplication in an outer query:

```sql
FROM (
    SELECT neighbor_id, weight, confidence, path, depth
    FROM (
        SELECT DISTINCT ON (neighbor_id)
            neighbor_id, weight, confidence, path, depth
        FROM graph_expansion
        WHERE depth = 1
        ORDER BY neighbor_id, confidence DESC, weight DESC
    ) dedup_frontier
    ORDER BY confidence DESC, weight DESC
    LIMIT 10
) ge
```

### 3. Fix Intermediate Relation Deduplication Ordering (`FINDING-6.6.1-03`)

Wrap `deduplicated_relations` in an outer query:

```sql
deduplicated_relations AS (
    SELECT relation_id, source_entity_id, target_entity_id, relation_type, weight, confidence, depth
    FROM (
        SELECT DISTINCT ON (relation_id)
            relation_id, source_entity_id, target_entity_id, relation_type, weight, confidence, depth
        FROM graph_expansion
        ORDER BY relation_id, depth ASC, confidence DESC, weight DESC
    ) dedup_rels
    ORDER BY depth ASC, confidence DESC, weight DESC
    LIMIT 150
),
```

### 4. Fix Evidence Score Aggregation Formula (`FINDING-6.6.1-04`)

Replace the `< max_score` condition with algebraic exclusion of one maximum instance:

```sql
aggregated_chunk_scores AS (
    SELECT
        cec.chunk_id,
        cec.document_id,
        LEAST(1.0::double precision,
            MAX(cec.raw_score) + 0.2 * (SUM(cec.raw_score) - MAX(cec.raw_score))
        ) AS final_graph_score,
        COUNT(DISTINCT cec.relation_id) AS supported_relations_count,
        ARRAY_AGG(DISTINCT cec.relation_id) FILTER (WHERE cec.relation_id IS NOT NULL) AS supported_relation_ids,
        ARRAY_AGG(DISTINCT cec.relation_type) FILTER (WHERE cec.relation_type IS NOT NULL) AS relation_types
    FROM chunk_evidence_candidates cec
    GROUP BY cec.chunk_id, cec.document_id
)
```

_(Note: This also eliminates the `JOIN max_scores` subquery entirely, simplifying the plan and boosting query performance!)_

---

## 10. Audit Sign-Off

- **Strict Read-Only Guarantee:** No source files, tests, fixtures, or migrations were modified during this audit. The working tree remains identical to the state prior to audit execution.
- **Authorization Status:** Task 6.6.2 remains **UNAUTHORIZED** until the project owner reviews this audit and decides whether to authorize implementation of these four SQL remediations.
