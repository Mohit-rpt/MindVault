# MindVault Phase 6.3: Extraction Reliability & Provenance — Architecture Audit & Implementation Plan

**Role:** Principal Software Architect, Senior Knowledge Graph Engineer, Backend Reliability Engineer, AI Evaluation Engineer  
**Scope:** Controlled Directed Triples Validation, Controlled Relation Vocabulary, Strict Evidence Grounding, Evidence Lifecycle & Orphan Pruning, Extraction Persistence Reliability, Multi-Document Corroboration, Comprehensive Evaluation Suite, Structured Diagnostics.  
**Out of Scope:** Graph traversal, multi-hop GraphRAG retrieval, tri-modal RRF, community detection, graph explorer UI, conversational graph context. (Phase 6.4+).

---

## 1. Architectural & Implementation Inspection

### 1.1 Existing Architecture Summary (Phases 6.0 – 6.2)

1. **Database Schema & Constraints (`prisma/schema.prisma`):**
   - `graph_entities`: `(workspace_id, id)` and `(workspace_id, normalized_name)` unique constraints; canonical alias sync via trigger.
   - `graph_entity_aliases`: `(workspace_id, normalized_alias)` unique constraint with canonical protection trigger.
   - `graph_relations`: `(workspace_id, id)` and `(workspace_id, source_entity_id, target_entity_id, relation_type)` unique constraints; `chk_graph_relation_no_self_loop`; `chk_graph_relation_confidence` ($[0.0, 1.0]$); `chk_graph_relation_weight` ($\ge 1.0$).
   - `relation_evidence`: `(workspace_id, relation_id, chunk_id)` unique constraint; composite foreign keys enforcing workspace and document-chunk tenant containment.
   - Trigger `trg_relation_evidence_sync_weight`: Invoked `AFTER INSERT OR DELETE ON relation_evidence`. Serializes updates per relation using a 64-bit transactional advisory lock `pg_advisory_xact_lock` and updates relation weight to `GREATEST(1.0, COUNT(DISTINCT chunk_id))`.

2. **Resolvers & Normalizers (`apps/api/src/modules/graph/`):**
   - `EntityNormalizer`: Unicode NFKC, outer quote stripping, lowercasing, whitespace collapsing, English article stripping, possessive suffix stripping, semantic punctuation preservation (`#`, `.`, `/`, `\`, `-`, `_`, `+`), boundary punctuation stripping, parenthetical disambiguation (`extractDisambiguation`), and relation synonym mapping (`normalizeRelationType`).
   - `EntityResolver`: Multi-step canonical and alias resolution, generic alias blocklist, entity type compatibility hierarchy (`determineMergedType`), description enrichment, and `P2002` conflict recovery.
   - `RelationResolver`: Endpoint resolution, self-loop rejection, symmetric relation endpoint ordering, confidence filtering ($\ge 0.5$), inverse relation consolidation (`INVERSE_RELATION_MAP`), and strict evidence validation (`validateEvidenceInChunk`).
   - `GraphExtractionService`: Chunk-level and document-level extraction orchestration, coordinating entity resolution, mention recording, relation validation, and evidence persistence.

3. **Evaluation Runner & Dataset:**
   - 5 technical benchmark scenarios evaluated with entity and relation precision, recall, F1, duplicate rates, and provenance completeness.

---

## 2. Reliability & Provenance Gap Analysis

| Domain                                         | Current Implementation (Phase 6.2)                                                                                                                       | Identified Gap / Vulnerability                                                                                                                                                                                                                     | Required Phase 6.3 Hardening                                                                                                                                                                                                             |
| :--------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1. Evidence Lifecycle & Orphaned Relations** | When all evidence rows for a relation are deleted, `trg_sync_relation_weight_on_evidence_change` executes `SET weight = GREATEST(1.0, distinct_chunks)`. | If all supporting evidence is deleted (e.g., chunk deleted or document removed), `distinct_chunks = 0`, but the relation remains in `graph_relations` with `weight = 1.0`! An unsupported relationship survives indefinitely with zero provenance. | Update trigger: When `TG_OP = 'DELETE'` and `distinct_chunks = 0`, execute `DELETE FROM graph_relations WHERE id = target_rel_id AND workspace_id = target_ws_id;` so unsupported relations are pruned automatically upon evidence loss. |
| **2. Controlled Relation Vocabulary**          | `EntityNormalizer.normalizeRelationType()` tokenizes any arbitrary uppercase string (e.g. `FOO_BAR`, `IS`, `A`) and maps known synonyms.                 | LLMs can extract arbitrary, meaningless, or hallucinated relation tokens that pollute the graph schema with low-quality predicates.                                                                                                                | Define strict `APPROVED_RELATION_TYPES` vocabulary set. Validate extracted relations: reject unapproved / unmappable relation types and log the rejection reason in diagnostics.                                                         |
| **3. Directional Semantics & Self-Loops**      | `sourceEntityId === targetEntityId` dropped; symmetric relations sorted lexicographically.                                                               | Self-loops, missing endpoints, or low confidence are dropped silently without returning actionable diagnostic counters to callers.                                                                                                                 | Formalize `RelationValidationResult` with explicit error classification codes (`SELF_LOOP`, `UNRESOLVED_ENDPOINT`, `UNSUPPORTED_TYPE`, `LOW_CONFIDENCE`, `INVALID_EVIDENCE`).                                                            |
| **4. Multi-Document Corroboration**            | Relations are scoped to `workspaceId`. Evidence records `documentId` and `chunkId`.                                                                      | Need explicit verification and end-to-end testing that multiple chunks across different documents corroborate the same canonical relation, incrementally increasing its weight and tracking multi-document provenance.                             | Implement tests and verify multi-document corroboration across multiple chunk extractions in the same workspace.                                                                                                                         |
| **5. Extraction Diagnostics & Privacy**        | `ChunkExtractionResult` only reports top-level counts. Errors are logged to console.                                                                     | Callers lack structured visibility into provider info, model version, validation failure breakdown, and duration. Sensitive chunk data or tokens could leak if errors are unvetted.                                                                | Enrich extraction results with structured diagnostics (`provider`, `model`, `validationFailures`, `durationMs`) while sanitizing any sensitive text or API tokens.                                                                       |
| **6. Evaluation Dataset Coverage**             | Only 5 technical scenarios (database indexing, message queue, hybrid retrieval, V8, Kubernetes).                                                         | Benchmark lacks testing for organizational hierarchy, general knowledge, ambiguous statements, unsupported claims (negative controls), and multi-document corroboration.                                                                           | Expand `EXTRACTION_EVAL_DATASET` to 10+ standardized scenarios covering technical, organizational, negative control, ambiguous, and multi-document domains. Update mock provider and runner metrics.                                     |

---

## 3. Approved Relationship Vocabulary

The knowledge graph will strictly enforce the following canonical relationship vocabulary:

### 3.1 Taxonomy of Approved Canonical Relations

1. **Structural & Compositional:**
   - `PART_OF` / `CONTAINS` (Hierarchical membership, components)
   - `IMPLEMENTS` / `IMPLEMENTED_IN` (Interface realizations, software architecture)
   - `EMBEDS` (Embedding libraries, sub-runtimes)
2. **Behavioral & Functional:**
   - `USES` / `USED_FOR` (Functional utilization, utility)
   - `DEPENDS_ON` (Hard dependencies, prerequisites)
   - `CONNECTS_TO` / `INTERACTS_WITH` (Networking, API communication, protocols)
   - `PRODUCES` (Generation, compilation, factory output)
   - `STORES` (Data persistence, caching, state storage)
   - `ORCHESTRATES` (Container/workflow orchestration, scheduling)
   - `COMBINES` (Algorithmic or data fusion, blending)
   - `SUPPORTS` (Compatibility, feature support)
3. **Organizational & Attributive:**
   - `WORKS_FOR` / `EMPLOYS` (Employment, affiliation)
   - `OWNS` (Ownership, copyright, corporate acquisition)
   - `LOCATED_IN` (Geographic location, headquarters)
   - `DEVELOPED` (Creation, authoring, software development)
4. **Equivalence & Similarity (Symmetric):**
   - `SIMILAR_TO`, `PEER_OF`, `EQUIVALENT_TO`, `RELATED_TO`

Any extracted relation string is first normalized via synonym mapping (`RELATION_SYNONYMS`). If the canonicalized token is not within `APPROVED_RELATION_TYPES`, it is rejected as unsupported.

---

## 4. Implementation Plan

### Step 1: Database Migration for Orphaned Relation Pruning

- Create migration `prisma/migrations/20261107000500_phase_6_prune_orphaned_relations/migration.sql`:
  - Enhance `trg_sync_relation_weight_on_evidence_change()`:
    ```sql
    IF distinct_chunks = 0 THEN
        DELETE FROM graph_relations
        WHERE id = target_rel_id AND workspace_id = target_ws_id;
    ELSE
        UPDATE graph_relations
        SET weight = GREATEST(1.0, distinct_chunks::DOUBLE PRECISION),
            updated_at = CURRENT_TIMESTAMP
        WHERE id = target_rel_id AND workspace_id = target_ws_id;
    END IF;
    ```
  - Apply with `pnpm exec prisma migrate deploy`.

### Step 2: Relation Resolver Hardening (Controlled Vocabulary & Validation Diagnostics)

- In `relation.resolver.ts`:
  - Define `APPROVED_RELATION_TYPES` ReadonlySet.
  - Implement structured `validateRelation()` returning `{ valid: true; relation: ValidatedRelation } | { valid: false; reason: RelationValidationFailureReason }`.
  - Validate relation type against approved vocabulary after synonym normalization.
  - Reject low confidence ($< 0.5$), self-loops, and missing endpoints.
  - Strict evidence substring validation via `validateEvidenceInChunk()`.

### Step 3: Structured Diagnostics & Extraction Service Observability

- In `graph-extraction.service.ts`:
  - Add diagnostic tracking: provider name, model name, validation failures breakdown (`selfLoops`, `unresolvedEndpoints`, `unsupportedType`, `lowConfidence`, `invalidEvidence`).
  - Sanitize all error messages and logs: never output raw chunk content or credential tokens.
  - Return detailed diagnostics in `ChunkExtractionResult`.

### Step 4: Expand Benchmark Evaluation Dataset & Runner

- In `graph-extraction.eval.dataset.ts`:
  - Add 6 new benchmark scenarios:
    1. `eval_06_event_driven_architecture` (Kafka & EDA)
    2. `eval_07_general_knowledge_org` (OpenAI & Sam Altman)
    3. `eval_08_organizational_hierarchy` (Anthropic & Dario Amodei)
    4. `eval_09_ambiguous_statements` (Pronoun ambiguity & ungrounded entities)
    5. `eval_10_unsupported_claims_negative` (Unsupported/hallucinated relation claims)
    6. `eval_11_multidoc_corroboration` (Cross-document relation reinforcement)
- Update `MockExtractionProvider` heuristic catalog and canned responses to evaluate all scenarios accurately.
- Update `GraphExtractionEvalRunner` to report provenance completeness, invalid relation rate, and detailed metrics.

### Step 5: Test Suite Implementation

- Create comprehensive tests:
  - `apps/api/src/modules/graph/__tests__/relation-provenance-lifecycle.test.ts`: Test evidence deletion, trigger weight recalculation, orphan pruning, multi-document corroboration, and concurrency.
  - `apps/api/src/modules/graph/__tests__/extraction-reliability.test.ts`: Test controlled vocabulary, directional semantics, self-loop rejection, diagnostics, and sanitized error reporting.
  - Add unit tests for new evaluation scenarios and verify `pnpm graph:evaluate`.

### Step 6: Full Verification & Static Checks

- Run `pnpm test` (verify all 40+ test files and ~310 tests pass).
- Run `pnpm typecheck`.
- Run `pnpm lint`.
- Run `pnpm format:check`.
- Run `pnpm graph:evaluate`.

---

## 5. Verification Checklist

- [ ] Migration deployed: `trg_sync_relation_weight_on_evidence_change` deletes relation if `distinct_chunks = 0`.
- [ ] Approved relation vocabulary strictly enforced; arbitrary/unknown relations rejected.
- [ ] Self-loops rejected; missing endpoints rejected; confidence $< 0.5$ rejected.
- [ ] Strict evidence grounding enforced with Unicode NFKC, quote removal, and full sentence matching.
- [ ] Orphaned relation pruning verified when evidence is deleted.
- [ ] Multi-document corroboration verified with correct distinct-chunk weight calculation.
- [ ] Extraction diagnostics return structured telemetry without secret leaks.
- [ ] Benchmark dataset expanded to 11 scenarios covering all requested domains.
- [ ] All unit and integration tests pass with 0 regressions.
- [ ] Typecheck, lint, and format checks pass.
