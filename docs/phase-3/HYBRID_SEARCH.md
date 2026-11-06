# MindVault — Hybrid Search & Reciprocal Rank Fusion (RRF)

**Phase:** Phase 3 (Retrieval Engine & Hybrid Search)  
**Status:** Invariant Documentation

---

## 1. Rationale: Why Hybrid Retrieval?

In modern Retrieval-Augmented Generation (RAG) architectures, neither dense vector retrieval nor traditional sparse keyword retrieval is sufficient on its own:

1. **Failure Modes of Pure Semantic Search:**
   - **Out-of-Vocabulary (OOV) & Identifiers:** Semantic embeddings struggle with exact acronyms, error codes, product model numbers (e.g. `CVE-2024-38077`, `GTX-4090`), code tokens, and specific named entities.
   - **Semantic Drift:** High cosine similarity can occur between conceptually related sentences that lack the exact factual keyword requested by the user.

2. **Failure Modes of Pure Keyword Search (BM25 / FTS):**
   - **Vocabulary Mismatch:** Cannot retrieve chunks that use synonyms, paraphrasing, or conceptual equivalents (e.g., searching for "salary negotiation tips" fails to match a chunk discussing "compensation bargaining strategies").
   - **Grammar & Word Order Insensitivity:** Bag-of-words keyword matches ignore grammatical structure and context.

3. **The Hybrid Solution:**
   - MindVault combines both strategies: dense semantic vector search via pgvector and sparse full-text search via PostgreSQL `tsvector`/`ts_rank_cd`.
   - The results are fused into a single unified ranking that captures both conceptual intent and exact keyword matches.

---

## 2. Reciprocal Rank Fusion (RRF)

### 2.1 Why Not Linear Score Combination?

A naive approach would be to linearly combine scores:
$$\text{Score}_{\text{naive}} = \alpha \cdot \text{CosineSimilarity} + (1 - \alpha) \cdot \text{FTS\_Rank}$$

**This approach is fundamentally flawed because:**

- Vector cosine similarity is strictly bounded in $[0, 1]$.
- PostgreSQL `ts_rank_cd` scores are unbounded positive floating-point numbers whose magnitude depends on document length, term density, and query complexity.
- Normalizing unbounded scores with min-max scaling is sensitive to extreme outliers and query variance.

### 2.2 Mathematical Definition of RRF

Reciprocal Rank Fusion (Cormack et al., SIGIR 2009) operates solely on the **ordinal ranks** of items rather than their arbitrary score distributions:

$$RRF\_score(d \in D) = \sum_{m \in M} \frac{1}{k + rank_m(d)}$$

Where:

- $M$: The set of retrieval strategies (in MindVault: dense semantic search and sparse full-text search).
- $rank_m(d)$: The 1-indexed position of document chunk $d$ in the ranked list produced by retrieval strategy $m$.
- $k$: Smoothing constant (default: **60**).

### 2.3 The Role of Constant $k = 60$

- The smoothing constant $k$ dampens the penalty of ranking lower down the list.
- With $k = 60$:
  - A chunk ranked #1 contributes $\frac{1}{60 + 1} = \frac{1}{61} \approx 0.01639$.
  - A chunk ranked #2 contributes $\frac{1}{60 + 2} = \frac{1}{62} \approx 0.01613$.
  - A chunk ranked #10 contributes $\frac{1}{60 + 10} = \frac{1}{70} \approx 0.01429$.
- **Consequence:** Chunks appearing in **both** semantic and keyword result sets receive contributions from both strategies, elevating them above items present in only one set:
  $$\text{Fused Score}(\text{Rank 1 Semantic} + \text{Rank 1 Keyword}) = \frac{1}{61} + \frac{1}{61} \approx 0.03279$$
  This score is roughly double any single-source result, naturally favoring multi-modal consensus.

---

## 3. Implementation Details in MindVault

### 3.1 Candidate Pool Broadening

When a client requests `topK` (e.g. 10), the retrieval service requests a broader candidate pool from both vector and keyword queries:
$$\text{Candidate Fetch Limit} = \min(topK \times 2, 50)$$
This ensures that chunks ranked #12 in semantic search but #2 in keyword search have an opportunity to merge and rise to the final top-10.

### 3.2 Handling Unilateral Matches & Empty Sets

- If a chunk appears only in semantic search, its RRF score receives only the semantic contribution.
- If a chunk appears only in keyword search, it receives only the keyword contribution.
- If one retrieval method returns zero results (e.g. keyword query has no matching terms in the vocabulary), RRF gracefully degrades to the non-empty list without errors or NaN scores.

### 3.3 Stable Tie-Breaking

When two candidates share identical RRF scores (e.g., one was #3 in semantic only, and another was #3 in keyword only):

1. **First tie-breaker:** Chunks supported by multiple retrieval sources (`retrievalSources.length`) take precedence.
2. **Second tie-breaker:** Lower `chunkIndex` within the document takes precedence.
