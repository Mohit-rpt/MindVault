# MindVault — Offline Retrieval Quality Evaluation Framework

**Phase:** Phase 3 (Retrieval Engine & Hybrid Search)  
**Status:** Verification Baseline

---

## 1. Evaluation Methodology

To ensure retrieval quality is quantitatively verifiable rather than subjective, MindVault implements an offline information retrieval (IR) evaluation framework.

The framework benchmarks three retrieval configurations:

1. **Semantic Vector Search:** pgvector cosine similarity over 768-dimensional embeddings.
2. **Keyword Search:** PostgreSQL `tsvector` with `ts_rank_cd` cover-density ranking.
3. **Hybrid Search:** Reciprocal Rank Fusion (RRF, $k=60$) combining semantic and keyword ranked lists.

---

## 2. Metrics Defined

### 2.1 Precision@K

Measures the fraction of retrieved chunks in the top-$K$ that are relevant:
$$\text{Precision@K} = \frac{|\text{Retrieved}_{1..K} \cap \text{Relevant}|}{K}$$

### 2.2 Recall@K

Measures the fraction of total relevant chunks for the query retrieved in the top-$K$:
$$\text{Recall@K} = \frac{|\text{Retrieved}_{1..K} \cap \text{Relevant}|}{|\text{Relevant}|}$$

### 2.3 Mean Reciprocal Rank (MRR)

Measures how high the first relevant document is placed in the ranked list:
$$RR(q) = \frac{1}{\text{rank}_{\text{first relevant}}}$$
$$MRR = \frac{1}{|Q|} \sum_{q \in Q} RR(q)$$

### 2.4 Normalized Discounted Cumulative Gain (nDCG@K)

Accounts for graded relevance (e.g. 3 = Highly Relevant, 2 = Relevant, 1 = Marginally Relevant) with logarithmic rank discounting:
$$DCG@K = \sum_{i=1}^K \frac{2^{rel_i} - 1}{\log_2(i + 1)}$$
$$nDCG@K = \frac{DCG@K}{IDCG@K}$$

---

## 3. Evaluation Corpus & Golden Queries

The deterministic evaluation corpus (`eval.dataset.ts`) spans multiple technical domains:

- **Machine Learning Fundamentals:** Supervised learning, backpropagation, and unsupervised clustering.
- **Database Architecture:** PostgreSQL indexing (B-Tree, GIN) and pgvector HNSW cosine indexing.
- **Application Security:** Multi-tenancy, IDOR defense, and JWT session lifecycle.

Ground-truth queries test:

- Specific algorithmic concepts (e.g. "How does backpropagation calculate gradients in neural networks?")
- Specific database structures (e.g. "What is the purpose of GIN indexes and tsvector in PostgreSQL?")
- Multi-tenant security patterns (e.g. "How to protect multi-tenant architectures against IDOR?")

---

## 4. Benchmark Results

Executing the evaluation suite via `pnpm retrieval:evaluate` yielded the following measured performance:

| Retrieval Mode      | Precision@1 | Precision@3 | Recall@1 | Recall@3 | MRR     | nDCG@3  |
| :------------------ | :---------- | :---------- | :------- | :------- | :------ | :------ |
| **Semantic Vector** | `0.400`     | `0.200`     | `0.200`  | `0.300`  | `0.517` | `0.459` |
| **Keyword (FTS)**   | `1.000`     | `0.400`     | `0.600`  | `0.700`  | `1.000` | `0.950` |
| **Hybrid (RRF)**    | `0.600`     | `0.400`     | `0.300`  | `0.700`  | `0.767` | `0.783` |

### 4.1 Key Observations

1. **Keyword Search Precision on Technical Queries:** For queries with distinctive technical terminology (such as "backpropagation", "GIN", "IDOR", "HNSW"), sparse keyword search matches exact terms with high initial precision.
2. **Hybrid Search Balance:** Hybrid RRF combines the high-precision keyword signal with dense semantic candidate coverage, achieving an overall **MRR of 0.767** and **nDCG@3 of 0.783** with top-3 recall matching pure keyword search (`0.700`).
3. **Reproducibility:** The evaluation executes deterministically offline without network calls, enabling continuous integration performance gating.

---

## 5. Execution Command

To run the offline evaluation benchmark:

```bash
pnpm retrieval:evaluate
```
