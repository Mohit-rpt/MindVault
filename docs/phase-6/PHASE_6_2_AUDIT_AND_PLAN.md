# MindVault Phase 6.2: Repository Audit, Gap Analysis & Implementation Plan

**Role:** Principal Software Architect, Senior Backend Engineer, Knowledge Graph Engineer, Database Reliability Engineer  
**Scope:** Entity Resolution, Duplicate Detection, Normalization, Type & Confidence Handling, Relation Canonicalization, Database Concurrency, and Persistence Reliability.  
**Out of Scope:** Graph traversal, multi-hop retrieval, GraphRAG, community detection, graph explorer UI, conversational graph context.

---

## 1. Architectural & Implementation Inspection

### 1.1 Existing Phase 6.0 & 6.1 Components

The repository currently contains the following core graph modules:

1. **Database Schema & Constraints (`prisma/schema.prisma` & migrations):**
   - `graph_entities`: `(workspace_id, id)` and `(workspace_id, normalized_name)` unique constraints.
   - `graph_entity_aliases`: `(workspace_id, normalized_alias)` unique constraint. Triggers `trg_entities_sync_canonical_alias` and `trg_protect_canonical_alias` guarantee canonical alias synchronization and protection.
   - `graph_relations`: `(workspace_id, source_entity_id, target_entity_id, relation_type)` unique constraint; `chk_graph_relation_no_self_loop`; `chk_graph_relation_confidence`; `chk_graph_relation_weight`.
   - `chunk_entity_mentions`: Composite foreign keys to `document_chunks(workspaceId, id)` and `graph_entities(workspace_id, id)`.
   - `relation_evidence`: `(workspace_id, relation_id, chunk_id)` unique constraint; composite foreign keys to `document_chunks(workspaceId, documentId, id)` and `graph_relations(workspace_id, id)`. Trigger `trg_relation_evidence_sync_weight` recalculates relation weight upon INSERT/DELETE.
2. **Normalizers (`apps/api/src/modules/graph/normalizers/`):**
   - `EntityNormalizer.normalize(name)`: Unicode NFKC, outer quote stripping, lowercasing, whitespace collapsing, English article stripping, preserves `#./\-_+`.
   - `EntityNormalizer.normalizeRelationType(type)`: Uppercase underscored tokenization.
3. **Resolvers (`apps/api/src/modules/graph/resolvers/`):**
   - `EntityResolver`: 4-step resolution (canonical match, alias match, extracted aliases match, creation with P2002 conflict recovery).
   - `RelationResolver`: Validation (self-loop rejection, confidence filtering, strict evidence validation with NFKC/quotes/trailing punctuation allowance) and persistence (upsert relation + evidence recording).
4. **Repositories (`apps/api/src/modules/graph/repositories/`):**
   - `GraphRepository`: Data access layer for entities, aliases, relations, mentions, and evidence.
5. **Orchestration & Background Processing:**
   - `GraphExtractionService`: Chunk-level and document-level orchestration.
   - `GraphExtractionWorker` & `GraphExtractionQueue`: BullMQ queue with exponential backoff and in-memory test queue.

---

## 2. Gap Analysis

| Domain                                        | Current Implementation                                                               | Identified Vulnerability / Limitation                                                                                                                                                    | Proposed Phase 6.2 Hardening                                                                                                                                                                                                             |
| :-------------------------------------------- | :----------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1. Boundary Punctuation & Normalization**   | Retains `.` everywhere for `Node.js` and `.NET`.                                     | Trailing periods in extraction (e.g. `"PostgreSQL."`) are retained, producing `"postgresql."` which fails to match `"postgresql"`.                                                       | Strip non-semantic trailing/leading punctuation (`.`, `,`, `;`, `:`, `!`, `?`, `-`) while strictly preserving internal semantic punctuation (`Node.js`, `.NET`, `C++`, `C#`, `TCP/IP`). Strip trailing possessive suffixes (`'s`, `’s`). |
| **2. Parenthetical Disambiguation**           | Treats `"PostgreSQL (RDBMS)"` as a single literal string.                            | Fails to match `"PostgreSQL"`.                                                                                                                                                           | Parse parenthetical suffixes: resolve the primary stem (`"PostgreSQL"`) and register the parenthetical content (`"RDBMS"`) as a discovered synonym alias.                                                                                |
| **3. False-Positive Merge Prevention**        | Merges if ANY extracted alias matches an existing entity/alias.                      | Overly broad/generic aliases (e.g. `"system"`, `"database"`, `"model"`, `"app"`) or 1-2 letter acronyms cause unrelated entities to be incorrectly merged.                               | Introduce an alias stop-word/generic filter; require minimum token length for alias-based merging; verify entity type compatibility before merging.                                                                                      |
| **4. Entity Type Compatibility & Enrichment** | New entities get extracted type; existing entities never update type or description. | Weak generic extractions (`CONCEPT`) can overshadow specific knowledge (`TECHNOLOGY`), and existing entities are not enriched with descriptions from subsequent chunks.                  | Implement deterministic taxonomy hierarchy: upgrade `CONCEPT`/`CUSTOM` $\to$ specific type; preserve specific types against downgrade; enrich missing descriptions; increment mention metadata.                                          |
| **5. Relation Canonicalization**              | Only simple regex uppercase (`A_B`). Synonyms produce duplicate edges.               | Synonymous relation types (`DEPENDS_UPON` vs `DEPENDS_ON`, `UTILIZES` vs `USES`, `PART_OF` vs `COMPONENT_OF`) create fragmented duplicate relations.                                     | Canonicalize relation synonyms to standard schema vocabulary (`USES`, `DEPENDS_ON`, `PART_OF`, `PRODUCES`, `STORES`, `CONNECTS_TO`, `EMPLOYS`, `LOCATED_IN`).                                                                            |
| **6. Symmetric & Inverse Relations**          | Strict directional unique constraint `(source, target, type)`.                       | Symmetric relations (`CONNECTED_TO`, `PEER_OF`) produce dual redundant edges `(A, B)` and `(B, A)`. Inverse relations (`CONTAINS` vs `PART_OF`) create disconnected duplicate knowledge. | Canonicalize symmetric relations to deterministic endpoint ordering (`min(id), max(id)`). Provide inverse relation detection so evidence for `(B, PART_OF, A)` reinforces `(A, CONTAINS, B)`.                                            |
| **7. Database Trigger Concurrency**           | `trg_sync_relation_weight_on_evidence_change()` counts evidence without row lock.    | Under `READ COMMITTED` isolation, concurrent evidence insertions for the same relation can calculate weight based on uncommitted snapshots, leading to weight undercounting.             | Add `PERFORM 1 FROM graph_relations WHERE id = target_rel_id FOR UPDATE;` inside the trigger function to serialize concurrent evidence commits for the relation.                                                                         |
| **8. Mention Deduplication**                  | `findMention` then `createMention`. No DB unique constraint on mentions.             | Race conditions under concurrent chunk processing can create duplicate mention rows for the same entity in a chunk.                                                                      | Harden `createMentionIdempotent` with transaction-safe conflict handling and offset normalization.                                                                                                                                       |

---

## 3. Implementation Plan

### Step 1: Database Trigger Concurrency Hardening (Migration)

- Create migration `20261107000300_phase_6_trigger_concurrency_hardening`:
  - Enhance `trg_sync_relation_weight_on_evidence_change()` with `PERFORM ... FOR UPDATE` row locking on `graph_relations`.
  - Apply migration and test with concurrent simulated evidence insertions.

### Step 2: Advanced Entity Normalizer & Disambiguation

- Extend `EntityNormalizer`:
  - `cleanBoundaryPunctuation()`: safely strips non-essential trailing/leading punctuation without breaking `.NET`, `Node.js`, `C++`, `C#`.
  - `stripPossessive()`: strips trailing possessives (`'s`, `’s`, `'`).
  - `extractDisambiguation()`: splits `"Entity Name (Alias/Context)"` into canonical stem and alias.
  - Comprehensive unit tests covering all edge cases.

### Step 3: Entity Resolver Hardening (Type Hierarchy & False-Positive Prevention)

- Update `EntityResolver`:
  - Introduce `GENERIC_ALIAS_BLOCKLIST` to prevent merges on overly broad terms.
  - Implement `isTypeCompatible(existingType, incomingType)` and `determineMergedType()`.
  - Implement entity enrichment: update description and metadata (mention counts, timestamps) on matched entities.
  - Add positive and negative false-positive merge tests.

### Step 4: Relation Resolver Hardening (Synonym Canonicalization & Symmetric Edges)

- Extend `EntityNormalizer.normalizeRelationType()` with a canonical vocabulary dictionary mapping synonymous relations (e.g. `DEPENDS_UPON` $\to$ `DEPENDS_ON`, `UTILIZES` $\to$ `USES`).
- Update `RelationResolver`:
  - Handle symmetric relation types with deterministic endpoint ordering.
  - Recognize inverse relation pairs so evidence reinforces the canonical directional edge.
  - Add unit and integration tests.

### Step 5: Repository & Service Persistence Reliability

- Update `GraphRepository`:
  - Add `updateEntity` method for type enrichment and description updates.
  - Harden `createMentionIdempotent` with conflict safety.
  - Ensure all database operations adhere to workspace tenant boundaries.

### Step 6: Testing, Concurrency & Security Audit

- Add comprehensive test suites:
  - `apps/api/src/modules/graph/__tests__/entity-resolution-hardening.test.ts`
  - `apps/api/src/modules/graph/__tests__/relation-resolution-hardening.test.ts`
  - `apps/api/src/modules/graph/__tests__/trigger-concurrency.integration.test.ts`
- Run all 36+ existing test files (271+ tests) to guarantee 0 regressions.
- Run `pnpm typecheck`, `pnpm lint`, and `pnpm format:check`.

---

## 4. Verification Checkpoints

1. **Deterministic Resolution:** Same entity with varied casing, punctuation, possessives, and parentheticals resolves to the exact same canonical entity.
2. **False-Positive Guard:** Distinct entities sharing generic terms or acronyms are NOT incorrectly merged.
3. **Type Promotion:** Generic `CONCEPT` entities upgrade to specific `TECHNOLOGY`/`ORGANIZATION` upon higher-confidence evidence without downgrading existing specific types.
4. **Trigger Concurrency:** 10 simultaneous workers inserting evidence for the same relation produce the exact, correct relation weight without lost updates.
5. **Zero Out-of-Scope Code:** Absolutely no graph traversal, multi-hop retrieval, GraphRAG search, or UI code introduced.
