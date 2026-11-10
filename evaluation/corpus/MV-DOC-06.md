# MindVault Infrastructure Benchmark Report (Q3-2026)

**Document Identifier:** MV-DOC-06 | **Type:** Tabular Metrics Benchmark | **Format:** Markdown Table

## 1. Regional Retrieval Performance and Cost Metrics

The following empirical benchmark measurements were gathered across 5 global deployment regions using synthetic production query workloads on HNSW vector indexes:

| Region           | Provider | Index Type | Vector Search p50 (ms) | Vector Search p95 (ms) | Vector Search p99 (ms) | Compute Cost / 10k Qs ($) | Max QPS |
| :--------------- | :------- | :--------- | :--------------------- | :--------------------- | :--------------------- | :------------------------ | :------ |
| `us-east-1`      | AWS      | HNSW       | 42                     | 86                     | 112                    | 0.015                     | 850     |
| `us-west-2`      | AWS      | HNSW       | 48                     | 94                     | 126                    | 0.016                     | 780     |
| `eu-west-1`      | AWS      | HNSW       | 55                     | 102                    | 138                    | 0.012                     | 710     |
| `ap-southeast-1` | AWS      | HNSW       | 74                     | 134                    | 168                    | 0.018                     | 620     |
| `sa-east-1`      | AWS      | HNSW       | 92                     | 165                    | 210                    | 0.022                     | 490     |

## 2. Benchmark Observations & SLA Conformance Analysis

- **Latency SLA Compliance:** The operational SLA mandates p99 retrieval latency < 150ms. Regions `us-east-1` (112ms), `us-west-2` (126ms), and `eu-west-1` (138ms) satisfy the SLA. Regions `ap-southeast-1` (168ms) and `sa-east-1` (210ms) fail the SLA.
- **Cost Efficiency Evaluation:** Region `eu-west-1` meets the p99 SLA (< 150ms at 138ms) while having the lowest compute cost at $0.012 per 10k queries.
- **Fastest Regional Profile:** In `us-east-1`, p50 retrieval is 42ms and p99 is 112ms, yielding the highest throughput at 850 QPS.
