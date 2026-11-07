# MindVault — Phase 6: Architecture Decision Records (ADRs)

**Document Version:** 1.1.0 (Refined Architecture)  
**Status:** Architectural Decisions Blueprint (Planning Only)  
**Authors:** Principal Software Architect, Senior Backend Engineer, Database Architect, Senior GraphRAG Systems Engineer  
**Date:** November 2026

---

## Index of Architecture Decision Records

- [ADR-01: PostgreSQL Relational Graph Store vs Dedicated Graph Database (Neo4j)](#adr-01-postgresql-relational-graph-store-vs-dedicated-graph-database-neo4j)
- [ADR-02: Multi-Tenant Referential Integrity via Composite Foreign Keys & Normalized Aliases](#adr-02-multi-tenant-referential-integrity-via-composite-foreign-keys--normalized-aliases)
- [ADR-03: Asynchronous Extraction Pipeline with Outbox State & Self-Healing Reconciliation](#adr-03-asynchronous-extraction-pipeline-with-outbox-state--self-healing-reconciliation)
- [ADR-04: Deterministic Structured Extraction via Zod & LLM JSON Mode](#adr-04-deterministic-structured-extraction-via-zod--llm-json-mode)
- [ADR-05: Two-Pass Hybrid Entity Resolution via Normalized Alias Table](#adr-05-two-pass-hybrid-entity-resolution-via-normalized-alias-table)
- [ADR-06: Unified Tri-Modal Reciprocal Rank Fusion via Supporting Chunk Mapping](#adr-06-unified-tri-modal-reciprocal-rank-fusion-via-supporting-chunk-mapping)
- [ADR-07: SQL-Enforced Bounded Recursive Common Table Expressions (CTE) for Traversal](#adr-07-sql-enforced-bounded-recursive-common-table-expressions-cte-for-traversal)
- [ADR-08: Document Deletion Cascade & Invariant-Protected Shared Evidence Pruning](#adr-08-document-deletion-cascade--invariant-protected-shared-evidence-pruning)
- [ADR-09: Selection of `@xyflow/react` for Dual-Theme Graph Canvas](#adr-09-selection-of-xyflowreact-for-dual-theme-graph-canvas)
- [ADR-10: Discrete Citation Attribution & Grounding Integration (`[Gn]`)](#adr-10-discrete-citation-attribution--grounding-integration-gn)

---

### ADR-01: PostgreSQL Relational Graph Store vs Dedicated Graph Database (Neo4j)

#### Status

**ACCEPTED**

#### Context

MindVault requires a storage and query engine for graph entities, typed directed relationships, and multi-hop paths. The engineering team considered deploying a dedicated graph database (Neo4j or Amazon Neptune) versus modeling the graph natively within the existing PostgreSQL 16 database.

#### Alternatives Considered

1. **Neo4j / Cypher Database:** High-performance native graph storage with expressive Cypher traversal queries. Requires managing a secondary database server, dual data ingestion pipelines, separate authentication, and external synchronization.
2. **PostgreSQL Relational Tables (Selected):** Store entities as rows in `graph_entities` and relationships as rows in `graph_relations`, querying paths via Recursive Common Table Expressions (CTEs).

#### Decision

We will store the Knowledge Graph directly inside **PostgreSQL 16** using relational tables and Recursive CTEs.

#### Consequences & Trade-offs

- **Advantages:**
  - Preserves strict multi-tenant workspace isolation within existing ACID transactions (`ON DELETE CASCADE`).
  - Eliminates the operational overhead, memory consumption, backup synchronization, and infrastructure costs of managing a separate Neo4j cluster.
  - Allows seamless relational joins between graph edges, document metadata, full-text search (`tsvector`), and vector embeddings (`pgvector`) in a single SQL query.
- **Trade-offs:**
  - Highly complex, unconstrained graph algorithms (e.g. 10-hop network traversals or PageRank across millions of edges) are slower in relational SQL than in native graph engines.
  - _Mitigation:_ In GraphRAG, multi-hop reasoning rarely exceeds 2 to 3 hops. Bounded CTE queries with strict indexes provide sub-25ms execution for $depth \le 3$, which completely satisfies product requirements.

---

### ADR-02: Multi-Tenant Referential Integrity via Composite Foreign Keys & Normalized Aliases

#### Status

**ACCEPTED (Refined in Pre-Implementation Audit)**

#### Context

Initial drafts utilized standard single-column foreign keys (`source_entity_id REFERENCES graph_entities(id)`). Single-column foreign keys only verify that the target entity exists in PostgreSQL—they do NOT verify that both entities and the relationship belong to the same workspace. An edge in Workspace Alpha could link an entity in Workspace Beta, causing cross-tenant data leaks during recursive traversal. Additionally, denormalized JSONB alias arrays failed to enforce cross-row workspace-scoped alias uniqueness.

#### Decision

1. **Composite Foreign Keys:** All graph relations and junctions enforce multi-tenant isolation at the schema layer using composite foreign keys referencing `(workspace_id, id)` on parent tables:
   - `graph_relations(workspace_id, source_entity_id) REFERENCES graph_entities(workspace_id, id)`
   - `graph_relations(workspace_id, target_entity_id) REFERENCES graph_entities(workspace_id, id)`
   - `chunk_entity_mentions(workspace_id, chunk_id) REFERENCES document_chunks(workspace_id, id)`
   - `relation_evidence(workspace_id, document_id, chunk_id) REFERENCES document_chunks(workspace_id, document_id, id)`
2. **Normalized Alias Storage:** We replace `JSONB aliases` with a dedicated normalized table `graph_entity_aliases` enforcing `UNIQUE (workspace_id, normalized_alias)`.

#### Consequences & Trade-offs

- **Advantages:**
  - Storage-layer mathematical guarantee against cross-tenant leaks. Cross-workspace edge creation causes an immediate SQL foreign key violation (`23503`).
  - Complete elimination of chunk/document split-brain ownership in evidence records.
  - Guaranteed workspace-scoped alias uniqueness and sub-millisecond B-tree lookups.
- **Trade-offs:**
  - Parent tables require compound unique constraints (`@@unique([workspaceId, id])`, `@@unique([workspaceId, documentId, id])`).
  - Migration requires adding composite constraints to existing `document_chunks` table.

---

### ADR-03: Asynchronous Extraction Pipeline with Outbox State & Self-Healing Reconciliation

#### Status

**ACCEPTED (Refined in Pre-Implementation Audit)**

#### Context

LLM-based entity and relationship extraction requires significant compute (~1–3 seconds per chunk). If executed synchronously during document upload, large documents block user workflows. However, simply firing `queue.add()` in memory after database update creates a critical failure window: a process crash between PostgreSQL commit and Redis dispatch permanently abandons graph extraction.

#### Decision

1. **State-Driven Workflow:** When document chunks and embeddings are persisted, `documents.metadata.graphStatus` is atomically updated to `'QUEUED'` in PostgreSQL.
2. **Immediate Fast-Path Dispatch:** The worker immediately calls `graphQueue.add('extract-graph', { documentId, workspaceId })`.
3. **Repeatable Reconciliation Sweeper:** A BullMQ repeatable job executes every 5 minutes, scanning for documents in `status = 'COMPLETED'` with `graphStatus = 'QUEUED'` or stale `graphStatus = 'PROCESSING'` (> 15 minutes old), automatically re-enqueuing them.

#### Consequences & Trade-offs

- **Advantages:**
  - Guarantees zero lost graph jobs across worker restarts, Redis blips, or deployment interruptions.
  - Keeps upload fast-path sub-second while ensuring eventual consistency.
- **Trade-offs:**
  - Requires running a lightweight scheduled sweeper job in the worker cluster.

---

### ADR-04: Deterministic Structured Extraction via Zod & LLM JSON Mode

#### Status

**ACCEPTED**

#### Context

LLMs frequently hallucinate formatting, omit keys, or return conversational preamble when generating structured data.

#### Decision

We enforce strict JSON output schemas using Zod validation. The worker parses every LLM response against `EntityExtractionResponseSchema` and `RelationExtractionResponseSchema`. If validation fails, the turn is retried or safely discarded.

#### Consequences & Trade-offs

- Guarantees 100% type-safe ingestion into the database.
- Prevents database runtime crashes caused by malformed LLM outputs.

---

### ADR-05: Two-Pass Hybrid Entity Resolution via Normalized Alias Table

#### Status

**ACCEPTED (Refined in Pre-Implementation Audit)**

#### Context

Entities extracted from different documents appear in various forms (e.g., _"PostgreSQL"_, _"Postgres"_, _"pg16"_). Merging distinct entities corrupts the graph, while failing to merge variants fragments knowledge.

#### Decision

We implement a two-pass resolution engine:

1. **Pass 1 (Deterministic Exact & Alias Lookup):** Normalize surface name (lowercased alphanumeric string). Query `graph_entities` on `(workspace_id, normalized_name)` and `graph_entity_aliases` on `(workspace_id, normalized_alias)` using indexed B-Tree lookups ($O(\log N)$).
2. **Pass 2 (Contextual Disambiguation):** Check candidate category compatibility (`entityType`). Two entities are never merged solely because of surface similarity if their conceptual categories conflict. Discovered surface variants are recorded in `graph_entity_aliases`.

#### Consequences & Trade-offs

- Eliminates false positive merges (e.g. never merges "Java" and "JavaScript").
- B-Tree index ensures sub-millisecond alias lookups even across tens of thousands of aliases per workspace.
- Workspace-scoped unique constraints on aliases prevent alias collision across distinct canonical entities.

---

### ADR-06: Unified Tri-Modal Reciprocal Rank Fusion via Supporting Chunk Mapping

#### Status

**ACCEPTED (Refined in Pre-Implementation Audit)**

#### Context

MindVault uses 2-way RRF (Dense Vector + Sparse Keyword) which operates on `chunk_id` candidate lists. Graph traversal, however, returns paths of entities and relationships, not chunks directly. Attempting to fuse relations alongside chunks corrupts ranking semantics.

#### Decision

We establish the **Supporting Chunk Mapping Invariant**:

1. Graph traversal retrieves relationship paths matching the query entities.
2. The traversal engine maps every discovered relationship back to its verbatim source `chunk_id`s via `relation_evidence`.
3. Supporting chunks are scored based on edge confidence discounted by path hop distance:
   $$\text{Score}_{\text{graph}}(c) = \max_{R \in \text{path}(c)} \left( \frac{\text{confidence}(R)}{\text{hop\_depth}(R)} \right)$$
4. Supporting chunks are sorted to establish `rank_graph(c)`.
5. Tri-Modal RRF fuses all candidates at the unified chunk level ($k = 60$):
   $$\text{RRF Score}(c) = \sum_{m \in \{\text{dense}, \text{sparse}, \text{graph}\}} \frac{1}{60 + \text{rank}_m(c)}$$
6. Discovered graph relationships are simultaneously passed into prompt generation for discrete `[Gn]` citation synthesis.

#### Consequences & Trade-offs

- Seamlessly unifies GraphRAG with existing vector and BM25 candidate pipelines without schema distortion.
- Documents whose relationships answer multi-hop query connections naturally bubble to the top of retrieval.

---

### ADR-07: SQL-Enforced Bounded Recursive Common Table Expressions (CTE) for Traversal

#### Status

**ACCEPTED (Refined in Pre-Implementation Audit)**

#### Context

Unbounded graph traversal in relational SQL can cause infinite loops in cyclic graphs and exhaust server memory. Relying solely on application-level parameters invites denial-of-service risks if query builders contain bugs.

#### Decision

All traversal queries use PostgreSQL Recursive CTEs with 6 hard safety limits compiled directly into the SQL query:

1. `workspace_id = $1` on anchor member.
2. `workspace_id = $1` on recursive member.
3. Hard recursion depth cap: `depth < 3`.
4. Visited path length cap: `array_length(gw.path, 1) <= 4`.
5. Cycle prevention: `NOT (r.target_entity_id = ANY(gw.path))`.
6. Result edge cap: `LIMIT 50`.
7. Connection timeout: `SET LOCAL statement_timeout = '2500ms'`.

#### Consequences & Trade-offs

- Guarantees sub-25ms query execution under all conditions.
- Completely eliminates runaway recursive queries at the database kernel level.

---

### ADR-08: Document Deletion Cascade & Invariant-Protected Shared Evidence Pruning

#### Status

**ACCEPTED (Refined in Pre-Implementation Audit)**

#### Context

When a document is deleted, relationships asserted by that document must not remain as unverified phantom facts. However, relationships corroborated by other existing documents must be preserved. During document reprocessing, existing chunks are replaced; pruning relations while re-extraction is underway would destroy valid knowledge.

#### Decision

1. **Foreign Key Cascade:** Composite foreign keys automatically delete rows in `relation_evidence` when chunks or documents are removed.
2. **Active Ingestion Invariant:** Orphan relation pruning queries (`DELETE FROM graph_relations WHERE id NOT IN (SELECT relation_id FROM relation_evidence)`) **must never execute** while any document in the workspace is in `graphStatus IN ('PROCESSING', 'REPROCESSING')`.
3. Once active jobs complete, background pruning prunes relations and entities that have zero remaining evidence.

#### Consequences & Trade-offs

- Guarantees 100% evidence-grounded relationships at all times.
- Eliminates knowledge loss during document re-indexing or batch reprocessing.

---

### ADR-09: Selection of `@xyflow/react` for Dual-Theme Graph Canvas

#### Status

**ACCEPTED**

#### Context

We evaluated `@xyflow/react` (React Flow v12), `Cytoscape.js`, and raw D3 for the frontend Knowledge Graph Explorer.

#### Decision

We select `@xyflow/react`. It allows rendering native React JSX components as graph nodes, integrates seamlessly with our Tailwind CSS variables, and natively supports the Warm Cream and Dark Graphite design systems.

#### Consequences & Trade-offs

- High developer productivity, perfect theme switching without canvas repaint lag.
- Viewport performance tuned up to 500 nodes; large graphs (> 1,000 nodes) are capped via server-side top-k subgraphs.

---

### ADR-10: Discrete Citation Attribution & Grounding Integration (`[Gn]`)

#### Status

**ACCEPTED**

#### Context

Users must be able to verify whether a statement made by the AI was derived from a specific document passage or from a synthesized multi-document relationship path.

#### Decision

We introduce discrete citation markers:

- `[Sn]`: Direct chunk citation.
- `[Gn]`: Knowledge graph relationship citation.
  Both are validated post-generation by `CitationValidatorService` and rendered as interactive, inspectable pills in the UI.

#### Consequences & Trade-offs

- Unprecedented transparency: users can click `[G1]` to view the exact entities, relation, and supporting documents that proved the connection.
- Prevents hallucinated multi-hop reasoning by failing validation if the model outputs unverified relation markers.
