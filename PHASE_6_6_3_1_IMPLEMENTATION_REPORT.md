# MindVault Phase 6.6.3.1 — Implementation Report

## Types, DTOs & Locale-Independent Sorters

**Milestone:** Phase 6.6 — GraphRAG Retrieval  
**Subtask:** 6.6.3.1 — Graph Evidence Context Representation & Deterministic Sorters  
**Execution Mode:** STRICT, BOUNDED IMPLEMENTATION  
**Authorization:** EXPLICITLY APPROVED (Subtask 6.6.3.1 only)  
**Date:** 2026-11-09  
**Status:** COMPLETED & VERIFIED

---

## 1. Executive Summary

Subtask 6.6.3.1 has been implemented and verified in strict accordance with [`PHASE_6_6_3_IMPLEMENTATION_PLAN.md`](./PHASE_6_6_3_IMPLEMENTATION_PLAN.md) and [`PHASE_6_6_3_READINESS_AUDIT.md`](./PHASE_6_6_3_READINESS_AUDIT.md).

This subtask establishes the strongly typed representations for knowledge graph evidence propositions in retrieved contexts, extends shared interfaces with graph relation provenance, and implements locale-independent UTF-16 code-point and natural numeric comparison utilities. These utilities guarantee 100% deterministic, byte-for-byte identical sorting across disparate Node.js runtimes and operating systems.

All changes maintain full backward compatibility with existing retrieval, generation, and conversation services. Zero regressions were introduced across the entire test suite.

---

## 2. Modified Files

| File Path                                                                                                                                |  Action  | Description                                                                                                                                                                                                                   |
| :--------------------------------------------------------------------------------------------------------------------------------------- | :------: | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`packages/shared/src/types.ts`](./packages/shared/src/types.ts)                                                                         | Modified | Added `ContextGraphRelationDto`, extended `ContextSourceItem` with `supportedRelationIds?: string[]`, and extended `SearchContextDto` with `graphRelations?: ContextGraphRelationDto[]`.                                      |
| [`apps/api/src/modules/retrieval/context/context.assembler.ts`](./apps/api/src/modules/retrieval/context/context.assembler.ts)           | Modified | Implemented `compareStringsCodePoint`, `compareCitationTags`, `compareCandidateRelations`, `ContextAssembler.formatGraphProposition`, and static comparator aliases; forwarded `supportedRelationIds` to `ContextSourceItem`. |
| [`apps/api/src/modules/retrieval/context/context.assembler.test.ts`](./apps/api/src/modules/retrieval/context/context.assembler.test.ts) | Modified | Expanded unit test suite from 4 to 20 tests, verifying code-point sorting, multi-digit numeric citation sequencing, 4-tier candidate relation comparison, proposition formatting, and backward compatibility.                 |

---

## 3. Detailed Technical Implementation

### 3.1 Shared Types & DTO Contracts (`packages/shared/src/types.ts`)

1. **`ContextGraphRelationDto`**:

   ```typescript
   export interface ContextGraphRelationDto {
     relationId: string;
     sourceCanonicalName: string;
     targetCanonicalName: string;
     relationType: string;
     confidence: number;
     depth: number;
     supportingCitationIds: string[];
     formattedProposition: string;
   }
   ```
   - Strongly types active knowledge graph propositions included in the assembled search context.
   - Carries epistemic metadata (`confidence`, traversal `depth`) alongside the supporting narrative citations (`supportingCitationIds`).

2. **`ContextSourceItem` Extension**:

   ```typescript
   export interface ContextSourceItem {
     citationId: string;
     documentId: string;
     documentName: string;
     chunkId: string;
     chunkIndex: number;
     pageNumber: number | null;
     pageRange: string | null;
     section: string | null;
     content: string;
     rank: number;
     score: number;
     retrievalSources: string[];
     supportedRelationIds?: string[]; // Added: Graph provenance link
   }
   ```

3. **`SearchContextDto` Extension**:
   ```typescript
   export interface SearchContextDto {
     content: string;
     tokenEstimate: number;
     sources: ContextSourceItem[];
     graphRelations?: ContextGraphRelationDto[]; // Added: Structured graph propositions
   }
   ```

---

### 3.2 Locale-Independent Deterministic Sorters (`context.assembler.ts`)

#### 1. `compareStringsCodePoint`

```typescript
/**
 * Exact UTF-16 code unit comparison (locale-independent).
 * Guarantees identical ordering across any OS, locale, or ICU environment.
 */
export function compareStringsCodePoint(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
```

- **Rationale & Guarantee:** Standard JavaScript `a.localeCompare(b)` depends on host OS collation tables and Node.js ICU configurations (e.g. Swedish and German treat umlauts such as `ä` differently). The binary relational operators (`<` and `>`) evaluate raw UTF-16 code units (e.g. `z` = 122 < `ä` = 228), guaranteeing identical results on Windows, Linux, Docker, and macOS.

#### 2. `compareCitationTags`

```typescript
/**
 * Numeric citation tag comparison: [S1] < [S2] < [S10].
 * Extracts integer digits for natural numerical sequence; falls back to code-point comparison.
 */
export function compareCitationTags(a: string, b: string): number {
  const numA = parseInt(a.replace(/\D/g, ''), 10) || 0;
  const numB = parseInt(b.replace(/\D/g, ''), 10) || 0;
  if (numA !== numB) return numA - numB;
  return compareStringsCodePoint(a, b);
}
```

- **Rationale & Guarantee:** Standard string comparison sorts `[S10]` before `[S2]`. This function extracts the integer value, guaranteeing that citations sort in true numeric sequence: `[S1] < [S2] < [S9] < [S10] < [S20] < [S100]`. If numbers are identical (or absent), it deterministically falls back to `compareStringsCodePoint`.

#### 3. `compareCandidateRelations`

```typescript
/**
 * Four-tier deterministic relation ordering:
 * 1. Traversal depth ASC (direct 1-hop outranks 2-hop)
 * 2. Confidence DESC (higher confidence outranks lower)
 * 3. Weight DESC (more corroborated outranks less)
 * 4. Immutable relationId code-point ASC (absolute tie-breaker)
 */
export function compareCandidateRelations(a: RawGraphRelationRow, b: RawGraphRelationRow): number {
  // Tier 1: Traversal depth ASC (direct 1-hop outranks 2-hop)
  if (a.depth !== b.depth) return a.depth - b.depth;
  // Tier 2: Confidence DESC (higher confidence outranks lower)
  if (b.confidence !== a.confidence) return b.confidence - a.confidence;
  // Tier 3: Weight DESC (more corroborated outranks less)
  if (b.weight !== a.weight) return b.weight - a.weight;
  // Tier 4: Immutable relationId code-point ASC (absolute tie-breaker)
  return compareStringsCodePoint(a.relationId, b.relationId);
}
```

- **Rationale & Guarantee:** Establishes a strict weak ordering with a unique total ordering because every relation in a dataset has a unique `relationId`. Direct 1-hop query seed relations always outrank 2-hop peripheral relations, followed by confidence, weight, and immutable code-point tie breaking.

---

### 3.3 Graph Proposition Formatter (`ContextAssembler.formatGraphProposition`)

```typescript
/**
 * Formats a graph relation into an epistemic proposition citing supporting chunk sources.
 * Format: - RELATION: "<Source>" --[<TYPE>]--> "<Target>" (Confidence: <conf>, Depth: <depth>) [Supported by: <[S#], ...>]
 */
public static formatGraphProposition(
  relation: RawGraphRelationRow,
  supportingCitationIds: string[],
): string {
  const sortedCitations = [...supportingCitationIds].sort(compareCitationTags);
  const citationsStr = sortedCitations.join(', ');
  const confidenceStr = relation.confidence.toFixed(2);
  return `- RELATION: "${relation.sourceCanonicalName}" --[${relation.relationType}]--> "${relation.targetCanonicalName}" (Confidence: ${confidenceStr}, Depth: ${relation.depth}) [Supported by: ${citationsStr}]`;
}
```

- Citations are sorted numerically (`[S1], [S2], [S10]`) without mutating the input array.
- Confidence is formatted consistently to 2 decimal places (`toFixed(2)`).
- Generates proposition strings that seamlessly integrate with [`CitationValidatorService`](./apps/api/src/modules/generation/services/citation-validator.service.ts) and system prompt epistemic boundaries.

---

## 4. Verification & Test Evidence

### 4.1 Unit Tests (`apps/api/src/modules/retrieval/context/context.assembler.test.ts`)

Test suite was expanded from 4 baseline tests to 20 tests covering all aspects of Subtask 6.6.3.1.

```
 ✓ apps/api/src/modules/retrieval/context/context.assembler.test.ts (20 tests) 15ms
   ✓ ContextAssembler > should format page reference accurately for single and range pages
   ✓ ContextAssembler > should assemble sources with sequential citation IDs [S1], [S2]
   ✓ ContextAssembler > should strictly respect token budget constraints
   ✓ ContextAssembler > should deduplicate chunks if duplicate chunk IDs are passed
   ✓ ContextAssembler > should forward supportedRelationIds on ContextSourceItem when present on candidate
   ✓ Subtask 6.6.3.1 — Locale-Independent Sorters & Proposition Formatter > compareStringsCodePoint > should correctly order ASCII strings by UTF-16 code units
   ✓ Subtask 6.6.3.1 — Locale-Independent Sorters & Proposition Formatter > compareStringsCodePoint > should maintain strict code-point ordering independent of host locale
   ✓ Subtask 6.6.3.1 — Locale-Independent Sorters & Proposition Formatter > compareStringsCodePoint > should deterministically sort string arrays
   ✓ Subtask 6.6.3.1 — Locale-Independent Sorters & Proposition Formatter > compareCitationTags > should numerically order single-digit and multi-digit citation tags
   ✓ Subtask 6.6.3.1 — Locale-Independent Sorters & Proposition Formatter > compareCitationTags > should correctly sort mixed multi-digit citation tags in numerical sequence
   ✓ Subtask 6.6.3.1 — Locale-Independent Sorters & Proposition Formatter > compareCitationTags > should fall back to code-point comparison for identical numbers with suffixes or non-numeric tags
   ✓ Subtask 6.6.3.1 — Locale-Independent Sorters & Proposition Formatter > compareCitationTags > should work identically through ContextAssembler static alias
   ✓ Subtask 6.6.3.1 — Locale-Independent Sorters & Proposition Formatter > compareCandidateRelations > should prioritize Tier 1: depth ASC (direct 1-hop outranks 2-hop)
   ✓ Subtask 6.6.3.1 — Locale-Independent Sorters & Proposition Formatter > compareCandidateRelations > should prioritize Tier 2: confidence DESC when depths are equal
   ✓ Subtask 6.6.3.1 — Locale-Independent Sorters & Proposition Formatter > compareCandidateRelations > should prioritize Tier 3: weight DESC when depths and confidences are equal
   ✓ Subtask 6.6.3.1 — Locale-Independent Sorters & Proposition Formatter > compareCandidateRelations > should prioritize Tier 4: relationId ASC code-point as absolute tie-breaker
   ✓ Subtask 6.6.3.1 — Locale-Independent Sorters & Proposition Formatter > compareCandidateRelations > should deterministically sort a collection of heterogeneous relations
   ✓ Subtask 6.6.3.1 — Locale-Independent Sorters & Proposition Formatter > formatGraphProposition > should format proposition with single citation identifier
   ✓ Subtask 6.6.3.1 — Locale-Independent Sorters & Proposition Formatter > formatGraphProposition > should sort supporting citation IDs numerically even if passed unsorted
   ✓ Subtask 6.6.3.1 — Locale-Independent Sorters & Proposition Formatter > formatGraphProposition > should format confidence to exactly two decimal places

 Test Files  1 passed (1)
      Tests  20 passed (20)
```

### 4.2 Module & Subsystem Regression Suites

All existing module suites were executed to verify backward compatibility:

1. **Retrieval Module:**
   - Command: `npx vitest run apps/api/src/modules/retrieval`
   - Result: **7 test files passed, 112 tests passed, 0 failures.**

2. **Generation Module:**
   - Command: `npx vitest run apps/api/src/modules/generation`
   - Result: **5 test files passed, 36 tests passed, 0 failures.**

3. **Conversations Module:**
   - Command: `npx vitest run apps/api/src/modules/conversations`
   - Result: **5 test files passed, 29 tests passed, 0 failures.**

4. **Knowledge Graph Module:**
   - Command: `npx vitest run apps/api/src/modules/graph`
   - Result: **25 test files passed, 312 tests passed, 0 failures.**

### 4.3 Monorepo TypeScript Compilation

- Command: `pnpm typecheck`
- Execution: `@mindvault/shared`, `@mindvault/api`, `@mindvault/worker`, `@mindvault/web`
- Result: **Exit code 0, 0 type errors.**

---

## 5. Contract Compliance Matrix

| Requirement / Invariant                      |    Status     | Evidence / Implementation                                                                                              |
| :------------------------------------------- | :-----------: | :--------------------------------------------------------------------------------------------------------------------- |
| **`ContextGraphRelationDto` defined**        | **Compliant** | Defined in `packages/shared/src/types.ts` and re-exported via `@mindvault/shared`.                                     |
| **`ContextSourceItem.supportedRelationIds`** | **Compliant** | Optional field added to `ContextSourceItem`; forwarded in `context.assembler.ts`.                                      |
| **`SearchContextDto.graphRelations`**        | **Compliant** | Optional array of `ContextGraphRelationDto` added to `SearchContextDto`.                                               |
| **`compareStringsCodePoint`**                | **Compliant** | Implemented using UTF-16 code unit binary operators `<` and `>`, tested with locale-sensitive characters (`z` vs `ä`). |
| **`compareCitationTags`**                    | **Compliant** | Implemented using integer extraction with code-point fallback; correctly sorts `[S1] < [S2] < [S10]`.                  |
| **`compareCandidateRelations`**              | **Compliant** | 4-tier comparison (depth ASC -> confidence DESC -> weight DESC -> relationId ASC).                                     |
| **`formatGraphProposition`**                 | **Compliant** | Formats proposition with exact schema, numerically sorted citations, and 2-decimal confidence.                         |
| **Backward Compatibility**                   | **Compliant** | All existing `assemble()` tests pass unchanged; existing callers unaffected.                                           |
| **Execution Boundary**                       | **Compliant** | Stopped immediately after Subtask 6.6.3.1; did not implement Subtask 6.6.3.2.                                          |

---

## 6. Deviations & Unresolved Issues

- **Deviations:** None. Implementation matches [`PHASE_6_6_3_IMPLEMENTATION_PLAN.md`](./PHASE_6_6_3_IMPLEMENTATION_PLAN.md) exactly.
- **Unresolved Issues:** None.

---

## 7. Execution Boundary Enforcement

Subtask 6.6.3.1 is complete.

In strict compliance with the authorization boundary, execution has stopped. Implementation of **Subtask 6.6.3.2 (Citation-Safe Context Assembly & Budgeting)** requires explicit user authorization before proceeding.
