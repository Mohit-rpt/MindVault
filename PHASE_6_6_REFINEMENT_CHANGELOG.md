# MindVault Phase 6.6 — Architecture Blueprint Refinement Changelog

**Milestone:** Phase 6.6 — GraphRAG Retrieval  
**Mode:** ARCHITECTURE REFINEMENT CHANGELOG  
**Status:** COMPLETED — AWAITING HUMAN IMPLEMENTATION AUTHORIZATION  
**Date:** 2026-11-08

---

## 1. Executive Summary

Following a strict review of the initial Phase 6.6 GraphRAG Retrieval architecture audit and blueprint, eight specific technical, mathematical, and architectural issues were raised.

This document logs the exhaustive, systematic resolution of all eight issues across the authoritative Phase 6.6 documentation suite:

1. [`PHASE_6_6_ARCHITECTURE_AUDIT.md`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/PHASE_6_6_ARCHITECTURE_AUDIT.md)
2. [`PHASE_6_6_ARCHITECTURE_BLUEPRINT.md`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/PHASE_6_6_ARCHITECTURE_BLUEPRINT.md)
3. [`PHASE_6_6_TASK_BREAKDOWN.md`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/PHASE_6_6_TASK_BREAKDOWN.md)
4. [`PHASE_6_6_EVALUATION_PLAN.md`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/PHASE_6_6_EVALUATION_PLAN.md)

**Mandate Adherence:**

- **Zero Code Modification:** Zero lines of production code, test code, or database migrations were modified during this refinement turn.
- **Task 6.6.1 Implementation:** NOT started. Awaiting explicit human authorization.
- **Zero Phase 6.5 Regression:** Completed Phase 6.5 traversal contracts, tests, and APIs remain completely untouched and pristine.

---

## 2. Issue-by-Issue Resolution Matrix

### Issue 1: Global Traversal Work Bound

- **Problem:** While Phase 6.5 enforced a per-node fanout ceiling of $K_{fanout} \le 15$, multi-seed queries ($S \le 5$) could combinatorially expand to $5 \times 15 \times 15 = 1,125$ intermediate relation candidates before applying the final LIMIT 50, creating a Denial of Service risk.
- **Resolution:**
  - Architected a hard global intermediate ceiling of **$M\_{intermediate} \le 150$ relations in SQL**.
  - Enforced in SQL through four explicit stages:
    1. Anchor stage: `LIMIT 50` on initial edge union.
    2. Frontier parent restriction: only top $P \le 10$ distinct neighbor entities ordered by salience are expanded into Depth 2.
    3. Lateral recursive limit: `LIMIT 10` per frontier parent ($10 \times 10 = \le 100$ recursive relations max).
    4. Deduplication CTE: `deduplicated_relations` groups by `relation_id` via `DISTINCT ON (relation_id)` with an immutable `LIMIT 150` on the intermediate pool prior to joining evidence tables.
  - Deterministic pruning order: `ORDER BY depth ASC, confidence DESC, weight DESC, relation_id ASC`.
- **Target Documentation:** `PHASE_6_6_ARCHITECTURE_AUDIT.md` §6, `PHASE_6_6_ARCHITECTURE_BLUEPRINT.md` §2.2.A–B, `PHASE_6_6_TASK_BREAKDOWN.md` Task 6.6.1.

---

### Issue 2: Graph Scoring Specification

- **Problem:** The preliminary graph scoring formula was incomplete, lacked mathematical bounds, lacked default values for missing confidence fields, and lacked worked numerical examples.
- **Resolution:**
  - Formulated the exact, closed-form bounded scoring model:
    $$\text{Score}_{graph}(c) = \min\left(1.0, \; S_{max}(c) + \sum_{j \neq max} 0.2 \times S_j(c)\right) \in [0.0, 1.0]$$
    with individual relation score:
    $$\text{Score}_{relation}(c, r_j) = S_{seed} \times W_{rel} \times C_{rel} \times E_{ev} \times \delta(d)$$
    where $\delta(1) = 1.0, \delta(2) = 0.5$, and mention score:
    $$\text{Score}_{mention}(c) = S_{seed} \times C_{mention} \times 0.75$$
  - Defined explicit evidence confidence default ($0.85$) and fallback for missing/null evidence ($0.50$).
  - Provided three complete worked numerical examples:
    - _Example 1 (Single 1-hop relation):_ Score = $0.855$.
    - _Example 2 (Multiple relations at depth 1 & 2):_ Score = $0.913$.
    - _Example 3 (Direct entity mention only):_ Score = $0.641$.
  - Specified deterministic ordering and 1-indexed rank generation $r_{graph}(c) \in [1, 50]$ for RRF.
- **Target Documentation:** `PHASE_6_6_ARCHITECTURE_BLUEPRINT.md` §2.2.C.

---

### Issue 3: Schema-Verified Workspace Isolation

- **Problem:** Multi-tenant boundaries across all 7 participating graph and retrieval tables needed schema-level verification and explicit proof against cross-tenant IDOR.
- **Resolution:**
  - Inspected `prisma/schema.prisma` and compiled an authoritative 7-table tenancy matrix (`graph_entities`, `graph_entity_aliases`, `graph_relations`, `relation_evidence`, `chunk_entity_mentions`, `document_chunks`, `documents`).
  - Verified that all 7 tables possess direct `workspace_id` columns and compound primary/foreign keys (`[workspaceId, id]`, `[workspaceId, relationId, chunkId]`, etc.).
  - Bound every CTE step and join condition to `workspace_id = $1`.
- **Target Documentation:** `PHASE_6_6_ARCHITECTURE_AUDIT.md` §4, `PHASE_6_6_ARCHITECTURE_BLUEPRINT.md` §3.1.

---

### Issue 4: Evidence Semantics

- **Problem:** Needed explicit differentiation between entity mentions, relationship evidence, and ungrounded relations, as well as clear deduplication semantics for 1-to-many and many-to-1 relationships.
- **Resolution:**
  - Constructed the formal Evidence Classification Matrix:
    - _Relationship Evidence (`relation_evidence`):_ High scoring contribution, formatted as verified relationship triples `[G_i]` citing supporting passages.
    - _Entity Mention Evidence (`chunk_entity_mentions`):_ Dampened score contribution ($0.75 \times C_{mention}$); retrieved as context passage only; cannot synthesize unsupported relations.
    - _Ungrounded Relations (0 evidence rows):_ Strictly excluded from chunk retrieval and prohibited from entering LLM prompt context.
  - Multi-evidence for 1 relation: Aggregated citations `[Evidence: S1, S2]`.
  - Multi-relation for 1 chunk: Chunk emitted once in context; score receives compounding boost; metadata tracks all supported relation IDs.
- **Target Documentation:** `PHASE_6_6_ARCHITECTURE_AUDIT.md` §5, `PHASE_6_6_ARCHITECTURE_BLUEPRINT.md` §2.4.A–B.

---

### Issue 5: Diagram Inconsistencies & Candidate Limits

- **Problem:** Diagrams and text had discrepancies regarding candidate pool limits (some referring to 2K, some to 50), and the status of the cross-encoder reranker was ambiguous.
- **Resolution:**
  - Synchronized candidate limits across narrative, SQL queries, and diagrams:
    - Vector Search: $K_{vec} \le 50$ chunks.
    - Lexical Search: $K_{kw} \le 50$ chunks.
    - Graph Retrieval: $K_{graph} \le 50$ chunks.
    - Maximum candidate pool entering RRF: $\le 150$ candidates.
  - Formally clarified that the Cross-Encoder Reranker is **existing Phase 3 code (`RerankerService`) reused as-is without modification** (default: disabled, top-K truncation if enabled).
  - Updated all Mermaid architectural and sequence diagrams to reflect these exact limits.
- **Target Documentation:** `PHASE_6_6_ARCHITECTURE_AUDIT.md` §2.1, §7, `PHASE_6_6_ARCHITECTURE_BLUEPRINT.md` §1, §4.

---

### Issue 6: Citation Grounding Invariant

- **Problem:** Needed a formal invariant preventing hallucinated or disconnected graph assertions from entering generative prompt contexts when backing chunks are evicted due to token budgeting.
- **Resolution:**
  - Formulated **Invariant 6.6.1 (Citation Grounding Invariant):**
    > _A knowledge graph relationship triple $(E\_{source}) \xrightarrow{REL} (E\_{target})$ can enter the LLM prompt context if and only if at least one of its supporting evidence document chunks is present in the final assembled context passages and possesses an active citation identifier $[S_i]$._
  - Defined explicit Token Budgeting Eviction Rule: If token limits force the eviction of all supporting evidence chunks for a relationship, the relationship triple is **automatically dropped** from the prompt context.
  - Grounding validation: `GroundingService` validates that citations point only to relations whose backing chunks exist in `ContextSources`.
- **Target Documentation:** `PHASE_6_6_ARCHITECTURE_AUDIT.md` §5.2, `PHASE_6_6_ARCHITECTURE_BLUEPRINT.md` §2.4.C–D.

---

### Issue 7: Evaluation Methodology

- **Problem:** Evaluation plan lacked an exact breakdown across the 25 benchmark queries, a formal definition of multi-hop queries, a 4-point graded relevance scale, the exact nDCG@10 formula, statistical significance testing details, and a component-level latency budget.
- **Resolution:**
  - Defined exact distribution across 25 queries:
    - Category 1 (Single-Hop Factual): 6 queries (24%)
    - Category 2 (Multi-Hop Relational): 8 queries (32%)
    - Category 3 (Acronym/Alias Disambiguation): 5 queries (20%)
    - Category 4 (Cross-Document Relational): 6 queries (24%)
    - Total: 25 queries (100%).
  - Defined Multi-Hop Relational queries: requires path traversal length $\ge 2$ across distinct chunks or documents via explicit `relation_evidence`.
  - Formulated 4-point graded relevance scale: Grade 3 (Highly Relevant), Grade 2 (Relevant), Grade 1 (Marginally Relevant), Grade 0 (Irrelevant).
  - Provided exact macro-averaged nDCG@10 formula and relative improvement metric $\Delta_{\text{rel}}$.
  - Specified two-tailed Wilcoxon signed-rank test with significance threshold $\alpha = 0.05$ (target $p < 0.01$) and rank-biserial effect size.
  - Established component latency budget breaking down the 35ms overhead limit: N-Grams $\le 2\text{ms}$, Seed Discovery $\le 8\text{ms}$, Graph Traversal $\le 18\text{ms}$, Score Aggregation $\le 3\text{ms}$, Three-Way RRF $\le 4\text{ms}$.
- **Target Documentation:** `PHASE_6_6_EVALUATION_PLAN.md` §3, §4, §5, §7.

---

### Issue 8: Task Breakdown Scope & Contracts

- **Problem:** Task 6.6.1 lacked exact TypeScript contracts, database query return types, interactive transaction statement timeout details, SQLSTATE error mapping, and clarity regarding the architectural role of `apps/api/src/lib/db.ts`.
- **Resolution:**
  - Defined exact TypeScript interfaces for Task 6.6.1: `GraphEvidenceQueryParams`, `RawGraphChunkRow`, `RawGraphRelationRow`, and `GraphEvidenceQueryResult`.
  - Specified interactive transaction execution with `SET LOCAL statement_timeout = '2500ms'`.
  - Defined error mapping: SQLSTATE `57014` mapped to HTTP 504 `GraphTraversalTimeoutError`.
  - Clarified architectural role of `db.ts`: `db.ts` will not be bloated with complex graph logic; `GraphRetrievalService` invokes `graphRepository.searchGraphEvidence()` directly, with an optional thin delegation wrapper on `dbService`.
- **Target Documentation:** `PHASE_6_6_TASK_BREAKDOWN.md` Task 6.6.1.

---

## 3. Synchronized Document Suite Summary

| Document                   | Primary File Path                                                                                                              |   Refinement Status    | Scope & Authority                                                                    |
| :------------------------- | :----------------------------------------------------------------------------------------------------------------------------- | :--------------------: | :----------------------------------------------------------------------------------- |
| **Architecture Audit**     | [`PHASE_6_6_ARCHITECTURE_AUDIT.md`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/PHASE_6_6_ARCHITECTURE_AUDIT.md)         | **Refined & Verified** | Authoritative empirical audit of Phase 3, Phase 6.5, tenancy matrix, and code reuse. |
| **Architecture Blueprint** | [`PHASE_6_6_ARCHITECTURE_BLUEPRINT.md`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/PHASE_6_6_ARCHITECTURE_BLUEPRINT.md) | **Refined & Verified** | Authoritative system design, SQL templates, scoring math, and invariants.            |
| **Task Breakdown**         | [`PHASE_6_6_TASK_BREAKDOWN.md`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/PHASE_6_6_TASK_BREAKDOWN.md)                 | **Refined & Verified** | Phased execution roadmap for Tasks 6.6.1–6.6.6 with human authorization gates.       |
| **Evaluation Plan**        | [`PHASE_6_6_EVALUATION_PLAN.md`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/PHASE_6_6_EVALUATION_PLAN.md)               | **Refined & Verified** | Quantitative benchmark dataset, IR metrics, significance tests, and SLA targets.     |
| **Refinement Changelog**   | [`PHASE_6_6_REFINEMENT_CHANGELOG.md`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/PHASE_6_6_REFINEMENT_CHANGELOG.md)     |     **Completed**      | Full traceability of all eight review issues and their exact resolutions.            |

---

## 4. Current Milestone Status & Next Steps

- **Milestone:** Phase 6.6 — GraphRAG Retrieval
- **Current Mode:** Architecture Refinement Complete (Read-Only / Documentation-Only)
- **Implementation Status:** **AWAITING EXPLICIT HUMAN AUTHORIZATION FOR TASK 6.6.1**
- **Immediate Next Step:** Await user authorization to begin **Task 6.6.1: Seed Discovery & Graph Evidence Repository Query**.

---

_End of Refinement Changelog._
