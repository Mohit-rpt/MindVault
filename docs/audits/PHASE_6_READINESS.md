# MindVault — Phase 6 (Knowledge Graph) Architectural Readiness Audit

**Audit Date:** November 7, 2026  
**Auditor:** Principal Software Architect & Knowledge Graph Engineer  
**Objective:** Comprehensive architectural gap analysis and technical roadmap for Phase 6 (Knowledge Graph & GraphRAG)

---

## 1. Executive Readiness Verdict

| Readiness Area                        | Readiness Score                                   | Architectural Status                                                                                      |
| ------------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| **Data Ingestion Pipeline Readiness** | **85%**                                           | BullMQ pipeline, chunk storage, and text normalization provide an ideal foundation for entity extraction. |
| **Database Schema Graph Support**     | **0%**                                            | Zero tables, models, or foreign keys exist for nodes, edges, or triples in Prisma schema.                 |
| **Retrieval Engine Graph Support**    | **15%**                                           | Hybrid retrieval (pgvector + FTS) is operational, but lacks graph traversal or entity resolution.         |
| **Worker Pipeline Extensibility**     | **80%**                                           | Ingestion worker can easily be extended with an entity extraction step or child job.                      |
| **Frontend Visualization Readiness**  | **10%**                                           | Modern conversation shell exists, but zero graph visualization components or libraries are installed.     |
| **Overall Phase 6 Readiness**         | **38% (FOUNDATION READY, GRAPH GAPS IDENTIFIED)** | Ready to begin Phase 6 implementation once data models and extraction strategies are formalized.          |

---

## 2. In-Depth Technical Analysis of the 12 Architectural Questions

### Question 1: Does the current architecture support graph nodes and edges?

**Finding: NO.**

- The current architecture is strictly **document- and chunk-centric**.
- Documents are partitioned into text chunks (`document_chunks`), embedded into vectors, and indexed into a full-text search index (`search_vector`).
- There are no constructs, types, or services in `@mindvault/shared`, `apps/api`, or `apps/worker` representing graph nodes, edges, relations, or entities.

### Question 2: Does the Prisma schema support entities, relations, triples, or graph metadata?

**Finding: NO.**

- In `prisma/schema.prisma`, there are no models for:
  - `Entity` / `Node`
  - `Relation` / `Edge`
  - `Triple` / `Claim`
- The only metadata fields are generic JSONB columns (`document_chunks.metadata` and `chat_messages.metadata`). These store simple flat properties (such as `{ heading: "Section 1" }`), with no relational foreign keys or graph adjacency list structures.

### Question 3: Are there tables or columns reserved for graph data?

**Finding: NO.**

- No reserved tables (`graph_nodes`, `graph_edges`, `entity_mentions`) or placeholder columns exist in any of the 5 database migrations.
- Implementation of Phase 6 will require creating a new migration (Migration 6) to introduce graph persistence.

### Question 4: How should graph data be modeled in PostgreSQL? Or is a dedicated graph DB required?

**Finding: A dedicated graph database is NOT required. PostgreSQL 16 is optimal.**

- **Recommended Schema in PostgreSQL:**
  1. `graph_entities`:
     - `id` (cuid)
     - `workspace_id` (FK to `workspaces.id` with CASCADE)
     - `name` (string, e.g. "PostgreSQL")
     - `canonical_name` (normalized string for deduplication)
     - `entity_type` (e.g. "TECHNOLOGY", "ORGANIZATION", "CONCEPT", "PERSON")
     - `description` (text summary)
     - `embedding` (`vector(768)` for semantic entity search)
     - `metadata` (JSONB)
     - `created_at`, `updated_at`
  2. `graph_relations`:
     - `id` (cuid)
     - `workspace_id` (FK to `workspaces.id` with CASCADE)
     - `source_entity_id` (FK to `graph_entities.id` with CASCADE)
     - `target_entity_id` (FK to `graph_entities.id` with CASCADE)
     - `relation_type` (string, e.g. "IMPLEMENTS", "USES", "PART_OF", "CAUSES")
     - `weight` (float, default 1.0)
     - `description` (text explanation of relationship)
     - `metadata` (JSONB)
     - `created_at`
  3. `chunk_entity_mentions` (Provenance linking chunks to entities):
     - `chunk_id` (FK to `document_chunks.id` with CASCADE)
     - `entity_id` (FK to `graph_entities.id` with CASCADE)
     - `confidence` (float)
- **Why PostgreSQL Over Neo4j / Dedicated Graph DB:**
  - Preserves strict multi-tenant workspace isolation within existing ACID transactions.
  - Allows hybrid queries combining relational metadata, vector cosine distance (`pgvector`), full-text search (`tsvector`), and graph joins in a single database round-trip.
  - Multi-hop traversal (1-to-3 hops) can be performed efficiently using PostgreSQL Recursive Common Table Expressions (`WITH RECURSIVE`).
  - Eliminates the operational overhead, memory consumption, and sync complexity of managing a separate Neo4j cluster.

### Question 5: How should entity extraction fit into the ingestion pipeline?

**Finding: Pipeline Stage Post-Chunking.**

- Entity extraction should execute **after** text normalization and chunking, but **before** or **concurrently with** chunk vector embedding.
- Flow:
  1. Document ingested and normalized into chunks.
  2. Chunk texts passed to an `EntityExtractionService`.
  3. LLM (or high-speed NER prompt) extracts triples: `(Subject, Relation, Object)`.
  4. Entities and relations are upserted into `graph_entities` and `graph_relations`.
  5. Provenance edge written to `chunk_entity_mentions`.

### Question 6: Should entity extraction happen during chunking or as a separate job?

**Finding: Two-Stage Job Execution via BullMQ.**

- **Recommendation:** Separate child job in BullMQ (`extract-graph-entities`).
- **Rationale:**
  - LLM-based entity extraction is compute- and token-intensive (~1–3 seconds per chunk).
  - If executed synchronously inside the primary chunking job, a 100-page document would cause the job to exceed standard BullMQ lock limits (e.g. 15 minutes) and trigger job stalling or timeouts.
  - By separating it into a distinct job, the document immediately becomes available for hybrid vector/FTS search (fast path), while graph extraction enriches the knowledge base asynchronously in the background (enrichment path).

### Question 7: How should graph search integrate with hybrid search (pgvector + FTS)?

**Finding: Tri-Modal Hybrid Fusion via Reciprocal Rank Fusion (RRF).**

- Current RRF blends 2 modalities: Dense Vector Rank ($k=60$) + Sparse Keyword Rank ($k=60$).
- Phase 6 should upgrade `RRFService` to a **Tri-Modal Fusion Engine**:
  $$\text{Score}(d) = \frac{1}{60 + \text{rank}_{\text{dense}}(d)} + \frac{1}{60 + \text{rank}_{\text{sparse}}(d)} + \frac{1}{60 + \text{rank}_{\text{graph}}(d)}$$
- Where $\text{rank}_{\text{graph}}(d)$ is derived from chunks linked to entities identified during query entity extraction and graph neighborhood traversal.

### Question 8: Does the retrieval pipeline support multi-hop reasoning or graph traversal?

**Finding: NO.**

- The existing `VectorSearchService` and `KeywordSearchService` perform single-shot tabular queries against `document_chunks`.
- They have no capability to traverse from Entity A -> Relation -> Entity B -> Related Chunks.
- Multi-hop reasoning will require a dedicated `GraphTraversalService` implementing BFS/DFS or recursive SQL graph queries.

### Question 9: How will conversational context interact with knowledge graph queries?

**Finding: Contextual Query Entity Resolution.**

- The existing `QueryContextService` already performs anaphora and demonstrative resolution (e.g. resolving "that technique" to "Reciprocal Rank Fusion").
- In Phase 6, `QueryContextService` should also extract **focus entities** from the conversation turn history.
- These focus entities can seed the starting nodes for graph traversal in multi-turn conversations.

### Question 10: What worker changes are required for graph construction?

**Finding: Dedicated Ingestion Pipeline Worker Steps.**

1. Install an entity extraction schema and prompt in `apps/worker/src/modules/ingestion/`.
2. Add a `GraphExtractionProcessor` BullMQ worker handler.
3. Implement an entity resolution service (`EntityResolutionService`) to merge entity variants (e.g. `"Postgres"` and `"PostgreSQL 16"` -> Canonical `"PostgreSQL"`).

### Question 11: What frontend changes are required for graph visualization?

**Finding: Interactive Graph Canvas & Navigation View.**

1. Install a lightweight, performant graph visualization engine in `apps/web`:
   - Recommended: `@xyflow/react` (React Flow) or `cytoscape` / `react-cytoscapejs`.
2. Add a new view component: `apps/web/src/components/graph/KnowledgeGraphView.tsx`.
3. Support both Warm Cream and Dark Graphite styling for graph nodes and edges:
   - Node styling: Warm ivory / dark charcoal pills with entity category colors.
   - Edge styling: Muted brass / graphite curved lines with relation label tooltips.
4. Add node click interactions to inspect connected documents and highlight evidence in the `EvidenceDrawer`.

### Question 12: What are the specific architectural risks of adding Phase 6?

**Finding: 4 Primary Risks to Mitigate:**

1. **Entity Explosion & Disambiguation Complexity:** Without strict entity resolution, every chunk will create duplicate or noisy entities (e.g. `"the company"`, `"it"`, `"data"`). A strict entity schema and confidence threshold must be enforced.
2. **LLM Extraction Latency and Cost:** Running LLM prompts over every chunk significantly increases processing time. Local models like Ollama can be slow; Gemini API incurs API rate limits or costs. Batching and caching are essential.
3. **Graph Density & Traversal Blowup:** Without a max-hop limit (e.g. maximum 2 hops) and edge weighting, recursive graph traversal can degrade query response times.
4. **Data Synchronization on Document Deletion:** When a document is deleted, all orphan entities and relations that only existed in that document must be cleaned up to avoid knowledge drift.
