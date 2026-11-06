# MindVault — Phase 4 Citation Validation & Grounding Engine

**Date:** 2026-11-06  
**Status:** Implemented & Verified  
**Scope:** Citation Extraction, Cross-Validation, Hallucination Detection, and Grounding Status Mapping

---

## 1. Citation Validation Mechanics

A primary risk in LLM generation is citation hallucination: models citing phantom pages, nonexistent documents, or bracketed numbers that were never provided in the prompt context.

The [`CitationValidatorService`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/modules/generation/services/citation-validator.service.ts) implements deterministic post-generation validation:

### 1.1 Citation Identifier Extraction

Citations are extracted from the raw generated answer string using the regular expression:

```typescript
const CITATION_REGEX = /\[S(\d+)\]/g;
```

All occurrences are deduplicated while preserving discovery order.

### 1.2 Cross-Validation Against Retrieved Sources

Extracted citation keys (e.g. `"[S1]"`, `"[S2]"`) are cross-referenced against the authoritative list of sources present in the retrieved context (`context.sources`):

1. **`validCitations`:** Extracted keys that exist in `context.sources`. These are enriched with full document metadata (`documentId`, `documentName`, `chunkId`, `pageNumber`, `pageRange`, `section`).
2. **`unknownCitations`:** Extracted keys that do NOT exist in the retrieved context (e.g., the model wrote `"[S9]"` when only `"[S1]"` and `"[S2]"` were provided).
3. **`unusedCitations`:** Retrieved sources provided to the model that were not cited in the generated answer.

---

## 2. Grounding Status Classification

The [`GroundingService`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/modules/generation/services/grounding.service.ts) analyzes the validated citations and text semantics to assign one of four mutually exclusive statuses:

| Grounding Status        | Definition & Conditions                                                                                                                            | Score |
| :---------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------- | :---- |
| `GROUNDED`              | All citations are valid (`unknownCitations.length === 0`), at least one valid citation is present, and claims are backed by corpus evidence.       | `1.0` |
| `PARTIALLY_GROUNDED`    | Some claims are backed by valid citations, but some retrieved evidence is omitted or minor citation discrepancies exist.                           | `0.7` |
| `INSUFFICIENT_EVIDENCE` | The system or model explicitly admitted a lack of evidence (e.g., "I cannot find sufficient evidence..."), or zero relevant chunks were retrieved. | `0.0` |
| `CITATION_INVALID`      | The model hallucinated one or more nonexistent source keys (`unknownCitations.length > 0`).                                                        | `0.0` |

---

## 3. Honest UI Presentation

MindVault does not attempt to conceal invalid or missing citations. In the frontend [`GroundingBadge`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/web/src/components/assistant/GroundingBadge.tsx) and [`SourcePanel`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/web/src/components/assistant/SourcePanel.tsx):

- **Grounded Responses:** Display a green shield with "Grounded" and link directly to source chunks with page badges.
- **Partially Grounded:** Display an amber warning indicating partial grounding.
- **Insufficient Evidence:** Display a neutral slate notice that the knowledge base does not contain the answer.
- **Invalid Citations:** Display a red warning alerting the user that the model hallucinated reference markers.

This honest reporting guarantees transparency and auditability for enterprise users.
