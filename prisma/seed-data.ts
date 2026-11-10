/**
 * MindVault — Deterministic Demo Seed Data Specification
 *
 * Defines the complete, authoritative showcase workspace assets:
 * - Demo User & Workspace Membership
 * - Six Technical Showcase Documents (MV-DOC-01 through MV-DOC-06)
 * - Deterministic 768-dimensional L2-Normalized Unit Vector Embeddings
 * - 14 Knowledge Graph Entities with Aliases
 * - 16 Cross-Document Directed Relations with Verbatim Text Evidence
 * - Chunk Entity Mentions with Offsets and Confidence
 * - Grounded Multi-Turn Historical Chat Sessions with Structured Citations
 *
 * Security & Isolation:
 * All data is strictly bound to workspace 'ws_demo_showcase_001'.
 * Embeddings are explicitly tagged as synthetic demo vectors ('mock-embed-768').
 */

import { createHash } from 'node:crypto';

// =========================================================================
// 1. Identity & Workspace Configuration
// =========================================================================

export const DEMO_CONFIG = {
  userId: 'usr_demo_user_001',
  userEmail: 'demo@mindvault.local',
  userName: 'Demo Presenter',
  userPlainPassword: 'DemoPassword123!',
  workspaceId: 'ws_demo_showcase_001',
  workspaceName: 'MindVault Architecture Showcase',
  workspaceSlug: 'demo-showcase',
  workspaceRoleId: 'mem_demo_owner_001',
  embeddingModel: 'mock-embed-768',
  embeddingDimension: 768,
} as const;

// =========================================================================
// 2. Deterministic Vector Generator (L2-Normalized Unit Vectors)
// =========================================================================

/**
 * Deterministically generates a 768-dimensional finite L2-normalized unit vector
 * from arbitrary input text using cyclic SHA-256 byte hashing.
 *
 * Matches the mathematical properties and dimensionality of MockEmbeddingProvider.
 */
export function generateSyntheticDemoEmbedding(text: string, dimension = 768): number[] {
  const hash = createHash('sha256').update(text).digest();
  const vector = new Array<number>(dimension);

  for (let i = 0; i < dimension; i++) {
    const byte = hash[i % hash.length];
    // Map byte 0..255 to range [-1.0, 1.0]
    vector[i] = (byte / 255.0) * 2.0 - 1.0;
  }

  // Compute L2 Euclidean norm
  const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
  if (norm > 0) {
    for (let i = 0; i < dimension; i++) {
      vector[i] = Number((vector[i] / norm).toFixed(7));
    }
  }

  return vector;
}

// =========================================================================
// 3. Showcase Technical Documents & Authoritative Content
// =========================================================================

export interface SeedDocumentDefinition {
  id: string;
  originalName: string;
  storageKey: string;
  mimeType: string;
  extension: string;
  title: string;
  rawContent: string;
  pageCount: number;
  metadata: Record<string, unknown>;
  chunks: Array<{
    id: string;
    chunkIndex: number;
    content: string;
    tokenCount: number;
    pageStart: number;
    pageEnd: number;
    headingHierarchy: string[];
  }>;
}

export const DEMO_DOCUMENTS: SeedDocumentDefinition[] = [
  {
    id: 'doc_demo_mv_01',
    originalName: 'MV-DOC-01.md',
    storageKey: 'demo_MV-DOC-01.md',
    mimeType: 'text/markdown',
    extension: 'md',
    title: 'Distributed Cloud Storage and Sharding Architecture Spec',
    pageCount: 1,
    metadata: {
      documentId: 'MV-DOC-01',
      version: '2.4',
      classification: 'Technical Core',
      isDemo: true,
      syntheticEmbeddings: true,
      sourceCorpus: 'evaluation/corpus/MV-DOC-01.md',
    },
    rawContent: `# Distributed Cloud Storage and Sharding Architecture Spec

**Document Identifier:** MV-DOC-01 | **Version:** 2.4 | **Classification:** Technical Core

## 1. Multi-Zone Replication and Quorum Management

The storage subsystem implements distributed active-passive chunk replication across three availability zones. Cross-zone consistency utilizes a quorum policy where write acknowledgments require W=2 confirmation out of N=3 replicas. Read operations enforce R=2 consensus before returning. Data blocks are partitioned using consistent hash rings to balance IO load.

## 2. Chunk Hashing and Cryptographic Integrity

Every stored chunk is validated using a deterministic SHA-256 hash digest. Chunk address verification ensures that chunk content is not tampered with at rest. When paragraphs exceed targetTokens (700), recursive boundary decomposition splits on sentence punctuation with 120-token overlap, up to a hard ceiling of maxTokens (900).

## 3. Raft Consensus Leases and Heartbeats

Leader election leases are renewed via periodic heartbeats set to 1500ms intervals. If the active leader fails to emit a heartbeat within this lease window, candidate nodes trigger an election protocol. Data encryption at rest employs AES-256-GCM authenticated encryption for all persistent block stores.

## 4. Subsystem Dependencies and Revocation Cascades

The Hybrid Retrieval Engine queries Vector Search Index directly. The Incident Health Daemon monitors replication lag across all shard leaders. Revocation of tenant master keys disables document decryption, the embedding pipeline, and context assembly.
`,
    chunks: [
      {
        id: 'chk_demo_mv_01_0',
        chunkIndex: 0,
        content: `# Distributed Cloud Storage and Sharding Architecture Spec

**Document Identifier:** MV-DOC-01 | **Version:** 2.4 | **Classification:** Technical Core

## 1. Multi-Zone Replication and Quorum Management

The storage subsystem implements distributed active-passive chunk replication across three availability zones. Cross-zone consistency utilizes a quorum policy where write acknowledgments require W=2 confirmation out of N=3 replicas. Read operations enforce R=2 consensus before returning. Data blocks are partitioned using consistent hash rings to balance IO load.

## 2. Chunk Hashing and Cryptographic Integrity

Every stored chunk is validated using a deterministic SHA-256 hash digest. Chunk address verification ensures that chunk content is not tampered with at rest. When paragraphs exceed targetTokens (700), recursive boundary decomposition splits on sentence punctuation with 120-token overlap, up to a hard ceiling of maxTokens (900).

## 3. Raft Consensus Leases and Heartbeats

Leader election leases are renewed via periodic heartbeats set to 1500ms intervals. If the active leader fails to emit a heartbeat within this lease window, candidate nodes trigger an election protocol. Data encryption at rest employs AES-256-GCM authenticated encryption for all persistent block stores.

## 4. Subsystem Dependencies and Revocation Cascades

The Hybrid Retrieval Engine queries Vector Search Index directly. The Incident Health Daemon monitors replication lag across all shard leaders. Revocation of tenant master keys disables document decryption, the embedding pipeline, and context assembly.`,
        tokenCount: 402,
        pageStart: 1,
        pageEnd: 1,
        headingHierarchy: [
          'Distributed Cloud Storage and Sharding Architecture Spec',
          'Multi-Zone Replication and Quorum Management',
          'Chunk Hashing and Cryptographic Integrity',
          'Raft Consensus Leases and Heartbeats',
          'Subsystem Dependencies and Revocation Cascades',
        ],
      },
    ],
  },
  {
    id: 'doc_demo_mv_02',
    originalName: 'MV-DOC-02.md',
    storageKey: 'demo_MV-DOC-02.md',
    mimeType: 'text/markdown',
    extension: 'md',
    title: 'Enterprise Zero-Trust Security and Identity Governance Policy',
    pageCount: 1,
    metadata: {
      documentId: 'MV-DOC-02',
      version: '3.1',
      classification: 'Security Directive',
      isDemo: true,
      syntheticEmbeddings: true,
      sourceCorpus: 'evaluation/corpus/MV-DOC-02.md',
    },
    rawContent: `# Enterprise Zero-Trust Security and Identity Governance Policy

**Document Identifier:** MV-DOC-02 | **Version:** 3.1 | **Classification:** Security Directive

## 1. Authentication Gateway and Token Lifecycle

Authentication filter executes prior to rate limiter. Missing Bearer token results in immediate 401 Unauthorized. User access JWT tokens have a strict time-to-live (TTL) of 15 minutes. Refresh tokens rotate every 7 days. Session authentication utilizes write-through caching; Redis failure triggers failover to PostgreSQL session backup table.

## 2. Horizontal Multi-Tenant Isolation

Horizontal tenant isolation is cryptographically guaranteed by scoping every database predicate to the verified workspaceId extracted from the signed token. RBAC links User via WorkspaceRole to Workspace, gating all child Document and DocumentChunk records. Users cannot query assets belonging to foreign workspaces.

## 3. Rate Limiting Boundaries and Governance

API rate limiting tiers: Free tier permits up to 100 req/min; Enterprise tier allows up to 1000 req/min before returning HTTP 429 Too Many Requests.

## 4. Role Hierarchy and Cryptographic Authority

Workspace Admin is scoped strictly to tenant assets including document uploads, user invites, and API keys. Platform Superadmin oversees physical infrastructure and cluster nodes. Tenant encryption key rotation requires Security Incident Officer role; Tier-1 on-call personnel do not possess key rotation authority.
`,
    chunks: [
      {
        id: 'chk_demo_mv_02_0',
        chunkIndex: 0,
        content: `# Enterprise Zero-Trust Security and Identity Governance Policy

**Document Identifier:** MV-DOC-02 | **Version:** 3.1 | **Classification:** Security Directive

## 1. Authentication Gateway and Token Lifecycle

Authentication filter executes prior to rate limiter. Missing Bearer token results in immediate 401 Unauthorized. User access JWT tokens have a strict time-to-live (TTL) of 15 minutes. Refresh tokens rotate every 7 days. Session authentication utilizes write-through caching; Redis failure triggers failover to PostgreSQL session backup table.

## 2. Horizontal Multi-Tenant Isolation

Horizontal tenant isolation is cryptographically guaranteed by scoping every database predicate to the verified workspaceId extracted from the signed token. RBAC links User via WorkspaceRole to Workspace, gating all child Document and DocumentChunk records. Users cannot query assets belonging to foreign workspaces.

## 3. Rate Limiting Boundaries and Governance

API rate limiting tiers: Free tier permits up to 100 req/min; Enterprise tier allows up to 1000 req/min before returning HTTP 429 Too Many Requests.

## 4. Role Hierarchy and Cryptographic Authority

Workspace Admin is scoped strictly to tenant assets including document uploads, user invites, and API keys. Platform Superadmin oversees physical infrastructure and cluster nodes. Tenant encryption key rotation requires Security Incident Officer role; Tier-1 on-call personnel do not possess key rotation authority.`,
        tokenCount: 370,
        pageStart: 1,
        pageEnd: 1,
        headingHierarchy: [
          'Enterprise Zero-Trust Security and Identity Governance Policy',
          'Authentication Gateway and Token Lifecycle',
          'Horizontal Multi-Tenant Isolation',
          'Rate Limiting Boundaries and Governance',
          'Role Hierarchy and Cryptographic Authority',
        ],
      },
    ],
  },
  {
    id: 'doc_demo_mv_03',
    originalName: 'MV-DOC-03.md',
    storageKey: 'demo_MV-DOC-03.md',
    mimeType: 'text/markdown',
    extension: 'md',
    title: 'Production Operations Runbook: Incident Management & Disaster Recovery',
    pageCount: 1,
    metadata: {
      documentId: 'MV-DOC-03',
      version: '4.0',
      classification: 'Operational Runbook',
      isDemo: true,
      syntheticEmbeddings: true,
      sourceCorpus: 'evaluation/corpus/MV-DOC-03.md',
    },
    rawContent: `# Production Operations Runbook: Incident Management & Disaster Recovery

**Document Identifier:** MV-DOC-03 | **Version:** 4.0 | **Classification:** Operational Runbook

## 1. Incident Severity Definitions

Incidents are classified into four tiers: Sev-1 (Complete cluster degradation or data unavailability), Sev-2 (Major performance degradation exceeding SLA), Sev-3 (Non-blocking component failure), and Sev-4 (Inquiry). Tier-1 on-call manages Sev-1 triage and coordinates emergency operational response.

## 2. Disaster Recovery Objectives and Failover Triggers

Disaster Recovery Target: Recovery Point Objective (RPO) < 1 minute; Recovery Time Objective (RTO) < 15 minutes. Automatic primary failover engages when replica lag exceeds 5000ms. If primary database becomes unresponsive, health probes initiate automatic promotion of the hot standby replica.

## 3. Service Level Agreements (SLAs)

SLA mandates p99 retrieval latency < 150ms and initial token dispatched < 2000ms. If retrieval exceeds the 150ms boundary, alerts trigger priority auto-scaling.

## 4. Ingestion Pipeline Queues and Dead-Letter Policies

Queue timeout triggers 3 retries then DLQ. Status COMPLETED triggers NotificationService WebSocket and schedules GraphExtractionTask for background entity resolution.
`,
    chunks: [
      {
        id: 'chk_demo_mv_03_0',
        chunkIndex: 0,
        content: `# Production Operations Runbook: Incident Management & Disaster Recovery

**Document Identifier:** MV-DOC-03 | **Version:** 4.0 | **Classification:** Operational Runbook

## 1. Incident Severity Definitions

Incidents are classified into four tiers: Sev-1 (Complete cluster degradation or data unavailability), Sev-2 (Major performance degradation exceeding SLA), Sev-3 (Non-blocking component failure), and Sev-4 (Inquiry). Tier-1 on-call manages Sev-1 triage and coordinates emergency operational response.

## 2. Disaster Recovery Objectives and Failover Triggers

Disaster Recovery Target: Recovery Point Objective (RPO) < 1 minute; Recovery Time Objective (RTO) < 15 minutes. Automatic primary failover engages when replica lag exceeds 5000ms. If primary database becomes unresponsive, health probes initiate automatic promotion of the hot standby replica.

## 3. Service Level Agreements (SLAs)

SLA mandates p99 retrieval latency < 150ms and initial token dispatched < 2000ms. If retrieval exceeds the 150ms boundary, alerts trigger priority auto-scaling.

## 4. Ingestion Pipeline Queues and Dead-Letter Policies

Queue timeout triggers 3 retries then DLQ. Status COMPLETED triggers NotificationService WebSocket and schedules GraphExtractionTask for background entity resolution.`,
        tokenCount: 322,
        pageStart: 1,
        pageEnd: 1,
        headingHierarchy: [
          'Production Operations Runbook: Incident Management & Disaster Recovery',
          'Incident Severity Definitions',
          'Disaster Recovery Objectives and Failover Triggers',
          'Service Level Agreements (SLAs)',
          'Ingestion Pipeline Queues and Dead-Letter Policies',
        ],
      },
    ],
  },
  {
    id: 'doc_demo_mv_04',
    originalName: 'MV-DOC-04.md',
    storageKey: 'demo_MV-DOC-04.md',
    mimeType: 'text/markdown',
    extension: 'md',
    title: 'API Gateway Routing and Server-Sent Events Protocol Specification',
    pageCount: 1,
    metadata: {
      documentId: 'MV-DOC-04',
      version: '1.8',
      classification: 'Integration Protocol',
      isDemo: true,
      syntheticEmbeddings: true,
      sourceCorpus: 'evaluation/corpus/MV-DOC-04.md',
    },
    rawContent: `# API Gateway Routing and Server-Sent Events Protocol Specification

**Document Identifier:** MV-DOC-04 | **Version:** 1.8 | **Classification:** Integration Protocol

## 1. Gateway Routing Architecture and Endpoints

The gateway dispatches incoming POST /api/rag/stream requests to RAGService. RAGService triggers RetrievalService on PostgreSQL document_chunks using hybrid vector and keyword channels. SSE stream lifecycle emits standard events: start -> retrieval_complete -> sources -> token* -> validation -> done.

## 2. Connection Heartbeat and Abort Lifecycle

The gateway dispatches a comment heartbeat (: ping) every 15 seconds to prevent intermediate proxy timeout. Client socket termination propagates an AbortSignal, terminating upstream LLM generators and marking the record CANCELLED.

## 3. Error Envelopes and Ingestion Format Boundaries

Supported extensions: .pdf, .docx, .txt, .md. Spreadsheets must be converted to Markdown tables. Error event envelope emits code FILE_TOO_LARGE and transitions document to FAILED when payload exceeds 25MB boundary.

## 4. Context Assembly Dual Budgeting Limits

Rate limit excess yields 429 Too Many Requests. ContextAssembler drops chunks exceeding maxContextTokens according to the 75% narrative floor and 25% graph ceiling policy. Chunks that do not fit within the token budget are omitted.
`,
    chunks: [
      {
        id: 'chk_demo_mv_04_0',
        chunkIndex: 0,
        content: `# API Gateway Routing and Server-Sent Events Protocol Specification

**Document Identifier:** MV-DOC-04 | **Version:** 1.8 | **Classification:** Integration Protocol

## 1. Gateway Routing Architecture and Endpoints

The gateway dispatches incoming POST /api/rag/stream requests to RAGService. RAGService triggers RetrievalService on PostgreSQL document_chunks using hybrid vector and keyword channels. SSE stream lifecycle emits standard events: start -> retrieval_complete -> sources -> token* -> validation -> done.

## 2. Connection Heartbeat and Abort Lifecycle

The gateway dispatches a comment heartbeat (: ping) every 15 seconds to prevent intermediate proxy timeout. Client socket termination propagates an AbortSignal, terminating upstream LLM generators and marking the record CANCELLED.

## 3. Error Envelopes and Ingestion Format Boundaries

Supported extensions: .pdf, .docx, .txt, .md. Spreadsheets must be converted to Markdown tables. Error event envelope emits code FILE_TOO_LARGE and transitions document to FAILED when payload exceeds 25MB boundary.

## 4. Context Assembly Dual Budgeting Limits

Rate limit excess yields 429 Too Many Requests. ContextAssembler drops chunks exceeding maxContextTokens according to the 75% narrative floor and 25% graph ceiling policy. Chunks that do not fit within the token budget are omitted.`,
        tokenCount: 337,
        pageStart: 1,
        pageEnd: 1,
        headingHierarchy: [
          'API Gateway Routing and Server-Sent Events Protocol Specification',
          'Gateway Routing Architecture and Endpoints',
          'Connection Heartbeat and Abort Lifecycle',
          'Error Envelopes and Ingestion Format Boundaries',
          'Context Assembly Dual Budgeting Limits',
        ],
      },
    ],
  },
  {
    id: 'doc_demo_mv_05',
    originalName: 'MV-DOC-05.md',
    storageKey: 'demo_MV-DOC-05.md',
    mimeType: 'text/markdown',
    extension: 'md',
    title: 'Infrastructure Configuration Reference: Environment Directives',
    pageCount: 1,
    metadata: {
      documentId: 'MV-DOC-05',
      version: '2.1',
      classification: 'Systems Architecture',
      isDemo: true,
      syntheticEmbeddings: true,
      sourceCorpus: 'evaluation/corpus/MV-DOC-05.md',
    },
    rawContent: `# Infrastructure Configuration Reference: Environment Directives

**Document Identifier:** MV-DOC-05 | **Version:** 2.1 | **Classification:** Systems Architecture

## 1. Database and Pool Connection Bounds

DB_POOL_MAX=20 # Maximum concurrent connections per API gateway instance
DB_TIMEOUT_MS=5000 # Database query execution timeout in milliseconds
WORKER_CONCURRENCY=5 # Concurrent background jobs processed per worker node

## 2. Document Payload Boundaries and Extractor Handling

MAX_FILE_SIZE_BYTES=26214400 # 25 Megabytes absolute payload boundary
Extractor error marks document FAILED with errorMessage in PostgreSQL documents table.

## 3. Knowledge Graph Traversal Timeouts and Loop Guards

GRAPH_TIMEOUT_MS=2500 and visited set evaluation prevent cyclic loops during multi-hop path traversal. Multi-hop queries abort after 2500ms to preserve generation response budgets.

## 4. Retrieval Channel Weights and Thresholds

SIMILARITY_FLOOR=0.65 # Minimum cosine similarity required for vector chunk survival
FTS_WEIGHT=1.0 # Multiplier weight for PostgreSQL full-text search channel
`,
    chunks: [
      {
        id: 'chk_demo_mv_05_0',
        chunkIndex: 0,
        content: `# Infrastructure Configuration Reference: Environment Directives

**Document Identifier:** MV-DOC-05 | **Version:** 2.1 | **Classification:** Systems Architecture

## 1. Database and Pool Connection Bounds

DB_POOL_MAX=20 # Maximum concurrent connections per API gateway instance
DB_TIMEOUT_MS=5000 # Database query execution timeout in milliseconds
WORKER_CONCURRENCY=5 # Concurrent background jobs processed per worker node

## 2. Document Payload Boundaries and Extractor Handling

MAX_FILE_SIZE_BYTES=26214400 # 25 Megabytes absolute payload boundary
Extractor error marks document FAILED with errorMessage in PostgreSQL documents table.

## 3. Knowledge Graph Traversal Timeouts and Loop Guards

GRAPH_TIMEOUT_MS=2500 and visited set evaluation prevent cyclic loops during multi-hop path traversal. Multi-hop queries abort after 2500ms to preserve generation response budgets.

## 4. Retrieval Channel Weights and Thresholds

SIMILARITY_FLOOR=0.65 # Minimum cosine similarity required for vector chunk survival
FTS_WEIGHT=1.0 # Multiplier weight for PostgreSQL full-text search channel`,
        tokenCount: 273,
        pageStart: 1,
        pageEnd: 1,
        headingHierarchy: [
          'Infrastructure Configuration Reference: Environment Directives',
          'Database and Pool Connection Bounds',
          'Document Payload Boundaries and Extractor Handling',
          'Knowledge Graph Traversal Timeouts and Loop Guards',
          'Retrieval Channel Weights and Thresholds',
        ],
      },
    ],
  },
  {
    id: 'doc_demo_mv_06',
    originalName: 'MV-DOC-06.md',
    storageKey: 'demo_MV-DOC-06.md',
    mimeType: 'text/markdown',
    extension: 'md',
    title: 'MindVault Infrastructure Benchmark Report (Q3-2026)',
    pageCount: 1,
    metadata: {
      documentId: 'MV-DOC-06',
      type: 'Tabular Metrics Benchmark',
      format: 'Markdown Table',
      isDemo: true,
      syntheticEmbeddings: true,
      sourceCorpus: 'evaluation/corpus/MV-DOC-06.md',
    },
    rawContent: `# MindVault Infrastructure Benchmark Report (Q3-2026)

**Document Identifier:** MV-DOC-06 | **Type:** Tabular Metrics Benchmark | **Format:** Markdown Table

## 1. Regional Retrieval Performance and Cost Metrics

The following empirical benchmark measurements were gathered across 5 global deployment regions using synthetic production query workloads on HNSW vector indexes:

| Region           | Provider | Index Type | Vector Search p50 (ms) | Vector Search p95 (ms) | Vector Search p99 (ms) | Compute Cost / 10k Qs ($) | Max QPS |
| :--------------- | :------- | :--------- | :--------------------- | :--------------------- | :--------------------- | :------------------------ | :------ |
| \`us-east-1\`      | AWS      | HNSW       | 42                     | 86                     | 112                    | 0.015                     | 850     |
| \`us-west-2\`      | AWS      | HNSW       | 48                     | 94                     | 126                    | 0.016                     | 780     |
| \`eu-west-1\`      | AWS      | HNSW       | 55                     | 102                    | 138                    | 0.012                     | 710     |
| \`ap-southeast-1\` | AWS      | HNSW       | 74                     | 134                    | 168                    | 0.018                     | 620     |
| \`sa-east-1\`      | AWS      | HNSW       | 92                     | 165                    | 210                    | 0.022                     | 490     |

## 2. Benchmark Observations & SLA Conformance Analysis

- **Latency SLA Compliance:** The operational SLA mandates p99 retrieval latency < 150ms. Regions \`us-east-1\` (112ms), \`us-west-2\` (126ms), and \`eu-west-1\` (138ms) satisfy the SLA. Regions \`ap-southeast-1\` (168ms) and \`sa-east-1\` (210ms) fail the SLA.
- **Cost Efficiency Evaluation:** Region \`eu-west-1\` meets the p99 SLA (< 150ms at 138ms) while having the lowest compute cost at $0.012 per 10k queries.
- **Fastest Regional Profile:** In \`us-east-1\`, p50 retrieval is 42ms and p99 is 112ms, yielding the highest throughput at 850 QPS.
`,
    chunks: [
      {
        id: 'chk_demo_mv_06_0',
        chunkIndex: 0,
        content: `# MindVault Infrastructure Benchmark Report (Q3-2026)

**Document Identifier:** MV-DOC-06 | **Type:** Tabular Metrics Benchmark | **Format:** Markdown Table

## 1. Regional Retrieval Performance and Cost Metrics

The following empirical benchmark measurements were gathered across 5 global deployment regions using synthetic production query workloads on HNSW vector indexes:

| Region           | Provider | Index Type | Vector Search p50 (ms) | Vector Search p95 (ms) | Vector Search p99 (ms) | Compute Cost / 10k Qs ($) | Max QPS |
| :--------------- | :------- | :--------- | :--------------------- | :--------------------- | :--------------------- | :------------------------ | :------ |
| \`us-east-1\`      | AWS      | HNSW       | 42                     | 86                     | 112                    | 0.015                     | 850     |
| \`us-west-2\`      | AWS      | HNSW       | 48                     | 94                     | 126                    | 0.016                     | 780     |
| \`eu-west-1\`      | AWS      | HNSW       | 55                     | 102                    | 138                    | 0.012                     | 710     |
| \`ap-southeast-1\` | AWS      | HNSW       | 74                     | 134                    | 168                    | 0.018                     | 620     |
| \`sa-east-1\`      | AWS      | HNSW       | 92                     | 165                    | 210                    | 0.022                     | 490     |

## 2. Benchmark Observations & SLA Conformance Analysis

- **Latency SLA Compliance:** The operational SLA mandates p99 retrieval latency < 150ms. Regions \`us-east-1\` (112ms), \`us-west-2\` (126ms), and \`eu-west-1\` (138ms) satisfy the SLA. Regions \`ap-southeast-1\` (168ms) and \`sa-east-1\` (210ms) fail the SLA.
- **Cost Efficiency Evaluation:** Region \`eu-west-1\` meets the p99 SLA (< 150ms at 138ms) while having the lowest compute cost at $0.012 per 10k queries.
- **Fastest Regional Profile:** In \`us-east-1\`, p50 retrieval is 42ms and p99 is 112ms, yielding the highest throughput at 850 QPS.`,
        tokenCount: 520,
        pageStart: 1,
        pageEnd: 1,
        headingHierarchy: [
          'MindVault Infrastructure Benchmark Report (Q3-2026)',
          'Regional Retrieval Performance and Cost Metrics',
          'Benchmark Observations & SLA Conformance Analysis',
        ],
      },
    ],
  },
];

// =========================================================================
// 4. Knowledge Graph Topology (14 Entities, Aliases, 16 Relations, Mentions)
// =========================================================================

export type EntityTypeEnum =
  | 'CONCEPT'
  | 'TECHNOLOGY'
  | 'ORGANIZATION'
  | 'PERSON'
  | 'LOCATION'
  | 'EVENT'
  | 'METRIC'
  | 'PRODUCT'
  | 'CUSTOM'
  | 'OTHER';

export interface SeedGraphEntityDefinition {
  id: string;
  canonicalName: string;
  normalizedName: string;
  entityType: EntityTypeEnum;
  description: string;
  aliases: string[];
}

export const DEMO_GRAPH_ENTITIES: SeedGraphEntityDefinition[] = [
  {
    id: 'ent_demo_gateway',
    canonicalName: 'API Gateway',
    normalizedName: 'api gateway',
    entityType: 'TECHNOLOGY',
    description: 'Routes incoming HTTP/SSE requests and coordinates generation services.',
    aliases: ['gateway', 'api router'],
  },
  {
    id: 'ent_demo_rag_svc',
    canonicalName: 'RAGService',
    normalizedName: 'ragservice',
    entityType: 'TECHNOLOGY',
    description: 'Orchestrates context retrieval, prompt assembly, and LLM answer generation.',
    aliases: ['rag service', 'generation orchestrator'],
  },
  {
    id: 'ent_demo_retrieval_svc',
    canonicalName: 'RetrievalService',
    normalizedName: 'retrievalservice',
    entityType: 'TECHNOLOGY',
    description: 'Coordinates multi-channel hybrid search across vector, keyword, and graph paths.',
    aliases: ['hybrid retrieval engine', 'retrieval engine'],
  },
  {
    id: 'ent_demo_vector_idx',
    canonicalName: 'Vector Search Index',
    normalizedName: 'vector search index',
    entityType: 'TECHNOLOGY',
    description:
      'PostgreSQL pgvector HNSW index indexing 768-dimensional document chunk embeddings.',
    aliases: ['pgvector index', 'hnsw index'],
  },
  {
    id: 'ent_demo_health_daemon',
    canonicalName: 'Incident Health Daemon',
    normalizedName: 'incident health daemon',
    entityType: 'TECHNOLOGY',
    description: 'Monitors cross-zone shard replication lag and cluster node health.',
    aliases: ['health daemon', 'replication monitor'],
  },
  {
    id: 'ent_demo_sec_officer',
    canonicalName: 'Security Incident Officer',
    normalizedName: 'security incident officer',
    entityType: 'CONCEPT',
    description:
      'Role possessing sole administrative authority to rotate tenant cryptographic master keys.',
    aliases: ['incident officer', 'secops lead'],
  },
  {
    id: 'ent_demo_tenant_key',
    canonicalName: 'Tenant Master Key',
    normalizedName: 'tenant master key',
    entityType: 'CONCEPT',
    description:
      'Tenant-specific AES-256-GCM encryption key required for document decryption and embedding.',
    aliases: ['master key', 'tenant encryption key'],
  },
  {
    id: 'ent_demo_redis_store',
    canonicalName: 'Redis Session Store',
    normalizedName: 'redis session store',
    entityType: 'TECHNOLOGY',
    description:
      'Low-latency primary session authentication cache using write-through replication.',
    aliases: ['redis cache', 'session cache'],
  },
  {
    id: 'ent_demo_pg_session_tbl',
    canonicalName: 'PostgreSQL Session Backup Table',
    normalizedName: 'postgresql session backup table',
    entityType: 'TECHNOLOGY',
    description:
      'Durable fallback database store preserving user authentication state upon Redis failure.',
    aliases: ['session backup table', 'postgres session store'],
  },
  {
    id: 'ent_demo_doc_queue',
    canonicalName: 'DocumentQueue',
    normalizedName: 'documentqueue',
    entityType: 'TECHNOLOGY',
    description:
      'BullMQ worker queue managing asynchronous document ingestion, extraction, and chunking.',
    aliases: ['ingestion queue', 'worker queue'],
  },
  {
    id: 'ent_demo_notif_svc',
    canonicalName: 'NotificationService',
    normalizedName: 'notificationservice',
    entityType: 'TECHNOLOGY',
    description:
      'WebSocket notification service dispatching real-time updates when documents complete processing.',
    aliases: ['notification worker', 'websocket notifier'],
  },
  {
    id: 'ent_demo_graph_task',
    canonicalName: 'GraphExtractionTask',
    normalizedName: 'graphextractiontask',
    entityType: 'CONCEPT',
    description:
      'Asynchronous pipeline task resolving named entities and cross-document relationships.',
    aliases: ['graph task', 'graph extraction job'],
  },
  {
    id: 'ent_demo_user_rbac',
    canonicalName: 'User RBAC Role',
    normalizedName: 'user rbac role',
    entityType: 'CONCEPT',
    description:
      'Access control model linking User via WorkspaceRole to Workspace document chunks.',
    aliases: ['rbac model', 'workspace role'],
  },
  {
    id: 'ent_demo_context_assembler',
    canonicalName: 'ContextAssembler',
    normalizedName: 'contextassembler',
    entityType: 'TECHNOLOGY',
    description:
      'Allocates token budgets enforcing the 75% narrative floor and 25% graph ceiling policy.',
    aliases: ['context builder', 'token budgeter'],
  },
];

export interface SeedGraphRelationDefinition {
  id: string;
  sourceEntityId: string;
  targetEntityId: string;
  relationType: string;
  description: string;
  weight: number;
  confidence: number;
  evidence: {
    id: string;
    documentId: string;
    chunkId: string;
    evidenceText: string;
    confidence: number;
  };
}

export const DEMO_GRAPH_RELATIONS: SeedGraphRelationDefinition[] = [
  {
    id: 'rel_demo_gateway_rag',
    sourceEntityId: 'ent_demo_gateway',
    targetEntityId: 'ent_demo_rag_svc',
    relationType: 'DISPATCHES_TO',
    description: 'API Gateway dispatches streaming RAG requests directly to RAGService.',
    weight: 1.0,
    confidence: 0.95,
    evidence: {
      id: 'evid_demo_01',
      documentId: 'doc_demo_mv_04',
      chunkId: 'chk_demo_mv_04_0',
      evidenceText: 'The gateway dispatches incoming POST /api/rag/stream requests to RAGService.',
      confidence: 0.95,
    },
  },
  {
    id: 'rel_demo_rag_retrieval',
    sourceEntityId: 'ent_demo_rag_svc',
    targetEntityId: 'ent_demo_retrieval_svc',
    relationType: 'INVOKES',
    description: 'RAGService invokes RetrievalService across hybrid vector and keyword channels.',
    weight: 1.0,
    confidence: 0.95,
    evidence: {
      id: 'evid_demo_02',
      documentId: 'doc_demo_mv_04',
      chunkId: 'chk_demo_mv_04_0',
      evidenceText:
        'RAGService triggers RetrievalService on PostgreSQL document_chunks using hybrid vector and keyword channels.',
      confidence: 0.95,
    },
  },
  {
    id: 'rel_demo_retrieval_vector',
    sourceEntityId: 'ent_demo_retrieval_svc',
    targetEntityId: 'ent_demo_vector_idx',
    relationType: 'QUERIES',
    description: 'RetrievalService queries the pgvector HNSW index directly.',
    weight: 1.0,
    confidence: 0.95,
    evidence: {
      id: 'evid_demo_03',
      documentId: 'doc_demo_mv_01',
      chunkId: 'chk_demo_mv_01_0',
      evidenceText: 'The Hybrid Retrieval Engine queries Vector Search Index directly.',
      confidence: 0.95,
    },
  },
  {
    id: 'rel_demo_health_vector',
    sourceEntityId: 'ent_demo_health_daemon',
    targetEntityId: 'ent_demo_vector_idx',
    relationType: 'MONITORS',
    description: 'Incident Health Daemon monitors replication lag across shard leaders.',
    weight: 0.95,
    confidence: 0.9,
    evidence: {
      id: 'evid_demo_04',
      documentId: 'doc_demo_mv_01',
      chunkId: 'chk_demo_mv_01_0',
      evidenceText: 'The Incident Health Daemon monitors replication lag across all shard leaders.',
      confidence: 0.9,
    },
  },
  {
    id: 'rel_demo_redis_pg_failover',
    sourceEntityId: 'ent_demo_redis_store',
    targetEntityId: 'ent_demo_pg_session_tbl',
    relationType: 'FAILS_OVER_TO',
    description: 'Redis failure triggers automatic session failover to PostgreSQL backup table.',
    weight: 0.95,
    confidence: 0.9,
    evidence: {
      id: 'evid_demo_05',
      documentId: 'doc_demo_mv_02',
      chunkId: 'chk_demo_mv_02_0',
      evidenceText:
        'Session authentication utilizes write-through caching; Redis failure triggers failover to PostgreSQL session backup table.',
      confidence: 0.9,
    },
  },
  {
    id: 'rel_demo_sec_officer_key',
    sourceEntityId: 'ent_demo_sec_officer',
    targetEntityId: 'ent_demo_tenant_key',
    relationType: 'AUTHORITY_OVER',
    description:
      'Security Incident Officer holds exclusive authority to rotate master tenant encryption keys.',
    weight: 1.0,
    confidence: 0.95,
    evidence: {
      id: 'evid_demo_06',
      documentId: 'doc_demo_mv_02',
      chunkId: 'chk_demo_mv_02_0',
      evidenceText:
        'Tenant encryption key rotation requires Security Incident Officer role; Tier-1 on-call personnel do not possess key rotation authority.',
      confidence: 0.95,
    },
  },
  {
    id: 'rel_demo_key_retrieval',
    sourceEntityId: 'ent_demo_tenant_key',
    targetEntityId: 'ent_demo_retrieval_svc',
    relationType: 'GATES_DECRYPTION_OF',
    description: 'Revocation of tenant master keys disables document decryption and retrieval.',
    weight: 0.95,
    confidence: 0.9,
    evidence: {
      id: 'evid_demo_07',
      documentId: 'doc_demo_mv_01',
      chunkId: 'chk_demo_mv_01_0',
      evidenceText:
        'Revocation of tenant master keys disables document decryption, the embedding pipeline, and context assembly.',
      confidence: 0.9,
    },
  },
  {
    id: 'rel_demo_doc_queue_notif',
    sourceEntityId: 'ent_demo_doc_queue',
    targetEntityId: 'ent_demo_notif_svc',
    relationType: 'NOTIFIES_ON_COMPLETE',
    description: 'Document completion in queue triggers WebSocket push notifications.',
    weight: 0.9,
    confidence: 0.85,
    evidence: {
      id: 'evid_demo_08',
      documentId: 'doc_demo_mv_03',
      chunkId: 'chk_demo_mv_03_0',
      evidenceText:
        'Status COMPLETED triggers NotificationService WebSocket and schedules GraphExtractionTask for background entity resolution.',
      confidence: 0.85,
    },
  },
  {
    id: 'rel_demo_doc_queue_graph',
    sourceEntityId: 'ent_demo_doc_queue',
    targetEntityId: 'ent_demo_graph_task',
    relationType: 'SCHEDULES',
    description: 'Document completion in queue automatically schedules graph extraction.',
    weight: 0.9,
    confidence: 0.85,
    evidence: {
      id: 'evid_demo_09',
      documentId: 'doc_demo_mv_03',
      chunkId: 'chk_demo_mv_03_0',
      evidenceText:
        'Status COMPLETED triggers NotificationService WebSocket and schedules GraphExtractionTask for background entity resolution.',
      confidence: 0.85,
    },
  },
  {
    id: 'rel_demo_user_rbac_chunk',
    sourceEntityId: 'ent_demo_user_rbac',
    targetEntityId: 'ent_demo_vector_idx',
    relationType: 'GATES_ACCESS_TO',
    description:
      'RBAC links User via WorkspaceRole to Workspace, gating all child DocumentChunk records.',
    weight: 0.95,
    confidence: 0.9,
    evidence: {
      id: 'evid_demo_10',
      documentId: 'doc_demo_mv_02',
      chunkId: 'chk_demo_mv_02_0',
      evidenceText:
        'RBAC links User via WorkspaceRole to Workspace, gating all child Document and DocumentChunk records.',
      confidence: 0.9,
    },
  },
  {
    id: 'rel_demo_rag_assembler',
    sourceEntityId: 'ent_demo_rag_svc',
    targetEntityId: 'ent_demo_context_assembler',
    relationType: 'DELEGATES_BUDGET_TO',
    description: 'RAGService delegates token budget management to ContextAssembler.',
    weight: 0.95,
    confidence: 0.9,
    evidence: {
      id: 'evid_demo_11',
      documentId: 'doc_demo_mv_04',
      chunkId: 'chk_demo_mv_04_0',
      evidenceText:
        'ContextAssembler drops chunks exceeding maxContextTokens according to the 75% narrative floor and 25% graph ceiling policy.',
      confidence: 0.9,
    },
  },
  {
    id: 'rel_demo_gateway_heartbeat',
    sourceEntityId: 'ent_demo_gateway',
    targetEntityId: 'ent_demo_rag_svc',
    relationType: 'HEARTBEATS_DURING_STREAM',
    description: 'Gateway emits ping comment heartbeats every 15s during active SSE streaming.',
    weight: 0.85,
    confidence: 0.85,
    evidence: {
      id: 'evid_demo_12',
      documentId: 'doc_demo_mv_04',
      chunkId: 'chk_demo_mv_04_0',
      evidenceText:
        'The gateway dispatches a comment heartbeat (: ping) every 15 seconds to prevent intermediate proxy timeout.',
      confidence: 0.85,
    },
  },
  {
    id: 'rel_demo_retrieval_assembler',
    sourceEntityId: 'ent_demo_retrieval_svc',
    targetEntityId: 'ent_demo_context_assembler',
    relationType: 'FEEDS_CANDIDATES_TO',
    description:
      'Retrieval candidates are passed to ContextAssembler for budgeting and deduplication.',
    weight: 0.95,
    confidence: 0.9,
    evidence: {
      id: 'evid_demo_13',
      documentId: 'doc_demo_mv_04',
      chunkId: 'chk_demo_mv_04_0',
      evidenceText:
        'ContextAssembler drops chunks exceeding maxContextTokens according to the 75% narrative floor and 25% graph ceiling policy. Chunks that do not fit within the token budget are omitted.',
      confidence: 0.9,
    },
  },
  {
    id: 'rel_demo_gateway_pool',
    sourceEntityId: 'ent_demo_gateway',
    targetEntityId: 'ent_demo_vector_idx',
    relationType: 'CONNECTS_VIA_POOL',
    description: 'Gateway connects to database using connection pool bounded to 20 instances.',
    weight: 0.85,
    confidence: 0.85,
    evidence: {
      id: 'evid_demo_14',
      documentId: 'doc_demo_mv_05',
      chunkId: 'chk_demo_mv_05_0',
      evidenceText: 'DB_POOL_MAX=20 # Maximum concurrent connections per API gateway instance',
      confidence: 0.85,
    },
  },
  {
    id: 'rel_demo_graph_timeout',
    sourceEntityId: 'ent_demo_retrieval_svc',
    targetEntityId: 'ent_demo_graph_task',
    relationType: 'BOUNDED_BY_TIMEOUT',
    description:
      'Graph retrieval traversal aborts after 2500ms to preserve generation latency budget.',
    weight: 0.85,
    confidence: 0.85,
    evidence: {
      id: 'evid_demo_15',
      documentId: 'doc_demo_mv_05',
      chunkId: 'chk_demo_mv_05_0',
      evidenceText:
        'GRAPH_TIMEOUT_MS=2500 and visited set evaluation prevent cyclic loops during multi-hop path traversal. Multi-hop queries abort after 2500ms to preserve generation response budgets.',
      confidence: 0.85,
    },
  },
  {
    id: 'rel_demo_vector_benchmark',
    sourceEntityId: 'ent_demo_vector_idx',
    targetEntityId: 'ent_demo_health_daemon',
    relationType: 'BENCHMARKED_UNDER',
    description:
      'Vector search retrieval performance is benchmarked against the 150ms p99 operational SLA.',
    weight: 0.9,
    confidence: 0.9,
    evidence: {
      id: 'evid_demo_16',
      documentId: 'doc_demo_mv_06',
      chunkId: 'chk_demo_mv_06_0',
      evidenceText:
        'The operational SLA mandates p99 retrieval latency < 150ms. Regions us-east-1 (112ms), us-west-2 (126ms), and eu-west-1 (138ms) satisfy the SLA. Regions ap-southeast-1 (168ms) and sa-east-1 (210ms) fail the SLA.',
      confidence: 0.9,
    },
  },
];

export interface SeedChunkMentionDefinition {
  id: string;
  chunkId: string;
  entityId: string;
  mentionText: string;
  startOffset?: number;
  endOffset?: number;
  confidence: number;
}

export const DEMO_CHUNK_MENTIONS: SeedChunkMentionDefinition[] = [
  // MV-DOC-01
  {
    id: 'ment_demo_01_vector',
    chunkId: 'chk_demo_mv_01_0',
    entityId: 'ent_demo_vector_idx',
    mentionText: 'Vector Search Index',
    confidence: 1.0,
  },
  {
    id: 'ment_demo_01_health',
    chunkId: 'chk_demo_mv_01_0',
    entityId: 'ent_demo_health_daemon',
    mentionText: 'Incident Health Daemon',
    confidence: 1.0,
  },
  {
    id: 'ment_demo_01_key',
    chunkId: 'chk_demo_mv_01_0',
    entityId: 'ent_demo_tenant_key',
    mentionText: 'tenant master keys',
    confidence: 0.95,
  },
  // MV-DOC-02
  {
    id: 'ment_demo_02_redis',
    chunkId: 'chk_demo_mv_02_0',
    entityId: 'ent_demo_redis_store',
    mentionText: 'Redis',
    confidence: 1.0,
  },
  {
    id: 'ment_demo_02_pg_tbl',
    chunkId: 'chk_demo_mv_02_0',
    entityId: 'ent_demo_pg_session_tbl',
    mentionText: 'PostgreSQL session backup table',
    confidence: 1.0,
  },
  {
    id: 'ment_demo_02_sec_off',
    chunkId: 'chk_demo_mv_02_0',
    entityId: 'ent_demo_sec_officer',
    mentionText: 'Security Incident Officer',
    confidence: 1.0,
  },
  {
    id: 'ment_demo_02_key',
    chunkId: 'chk_demo_mv_02_0',
    entityId: 'ent_demo_tenant_key',
    mentionText: 'Tenant encryption key',
    confidence: 0.95,
  },
  {
    id: 'ment_demo_02_rbac',
    chunkId: 'chk_demo_mv_02_0',
    entityId: 'ent_demo_user_rbac',
    mentionText: 'RBAC',
    confidence: 1.0,
  },
  // MV-DOC-03
  {
    id: 'ment_demo_03_queue',
    chunkId: 'chk_demo_mv_03_0',
    entityId: 'ent_demo_doc_queue',
    mentionText: 'Queue',
    confidence: 0.95,
  },
  {
    id: 'ment_demo_03_notif',
    chunkId: 'chk_demo_mv_03_0',
    entityId: 'ent_demo_notif_svc',
    mentionText: 'NotificationService',
    confidence: 1.0,
  },
  {
    id: 'ment_demo_03_graph_task',
    chunkId: 'chk_demo_mv_03_0',
    entityId: 'ent_demo_graph_task',
    mentionText: 'GraphExtractionTask',
    confidence: 1.0,
  },
  // MV-DOC-04
  {
    id: 'ment_demo_04_gateway',
    chunkId: 'chk_demo_mv_04_0',
    entityId: 'ent_demo_gateway',
    mentionText: 'gateway',
    confidence: 1.0,
  },
  {
    id: 'ment_demo_04_rag',
    chunkId: 'chk_demo_mv_04_0',
    entityId: 'ent_demo_rag_svc',
    mentionText: 'RAGService',
    confidence: 1.0,
  },
  {
    id: 'ment_demo_04_retrieval',
    chunkId: 'chk_demo_mv_04_0',
    entityId: 'ent_demo_retrieval_svc',
    mentionText: 'RetrievalService',
    confidence: 1.0,
  },
  {
    id: 'ment_demo_04_assembler',
    chunkId: 'chk_demo_mv_04_0',
    entityId: 'ent_demo_context_assembler',
    mentionText: 'ContextAssembler',
    confidence: 1.0,
  },
  // MV-DOC-05
  {
    id: 'ment_demo_05_gateway',
    chunkId: 'chk_demo_mv_05_0',
    entityId: 'ent_demo_gateway',
    mentionText: 'API gateway',
    confidence: 1.0,
  },
  {
    id: 'ment_demo_05_graph',
    chunkId: 'chk_demo_mv_05_0',
    entityId: 'ent_demo_graph_task',
    mentionText: 'Knowledge Graph Traversal',
    confidence: 0.9,
  },
  // MV-DOC-06
  {
    id: 'ment_demo_06_vector',
    chunkId: 'chk_demo_mv_06_0',
    entityId: 'ent_demo_vector_idx',
    mentionText: 'HNSW vector indexes',
    confidence: 1.0,
  },
];

// =========================================================================
// 5. Realistic Showcase Chat Sessions with Grounded Citations
// =========================================================================

export interface SeedMessageDefinition {
  id: string;
  role: 'USER' | 'ASSISTANT' | 'SYSTEM';
  content: string;
  sequenceNumber: number;
  tokenEstimate: number;
  citations: Array<{
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
    supportedRelationIds?: string[];
  }>;
  metadata: Record<string, unknown>;
}

export interface SeedChatSessionDefinition {
  id: string;
  title: string;
  summary: string;
  messages: SeedMessageDefinition[];
}

export const DEMO_CHAT_SESSIONS: SeedChatSessionDefinition[] = [
  {
    id: 'ses_demo_arch_001',
    title: 'API Gateway to Storage Pipeline Architecture',
    summary:
      'Deep-dive architecture walkthrough exploring how MindVault dispatches incoming SSE streaming requests through RAGService, hybrid retrieval, and pgvector HNSW indexes, with fallback session governance.',
    messages: [
      {
        id: 'msg_demo_arch_001_1',
        role: 'USER',
        sequenceNumber: 1,
        content:
          'How does an incoming /api/rag/stream request travel through MindVaults services down to the physical database storage layer?',
        tokenEstimate: 24,
        citations: [],
        metadata: { isDemo: true, preSeeded: true },
      },
      {
        id: 'msg_demo_arch_001_2',
        role: 'ASSISTANT',
        sequenceNumber: 2,
        content: `Incoming streaming requests follow a strictly decoupled pipeline:

1. **API Gateway Ingress:** The gateway receives incoming \`POST /api/rag/stream\` requests and immediately dispatches them to \`RAGService\` [S1].
2. **Hybrid Retrieval Invocation:** \`RAGService\` triggers \`RetrievalService\` on PostgreSQL \`document_chunks\` using hybrid vector and keyword channels [S1].
3. **Dense Index Query:** The retrieval engine queries the \`Vector Search Index\` directly [S2], while the \`Incident Health Daemon\` continuously monitors replication lag across shard leaders [S2].
4. **Context Budgeting:** \`ContextAssembler\` drops chunks exceeding \`maxContextTokens\` according to the 75% narrative floor and 25% graph ceiling policy [S1].
5. **SSE Heartbeats & Abort Signal:** During streaming, the gateway dispatches a comment heartbeat (\`: ping\`) every 15 seconds to prevent proxy timeouts [S1]. Client disconnects propagate an \`AbortSignal\`, immediately terminating upstream generators.`,
        tokenEstimate: 198,
        citations: [
          {
            citationId: '[S1]',
            documentId: 'doc_demo_mv_04',
            documentName: 'MV-DOC-04.md',
            chunkId: 'chk_demo_mv_04_0',
            chunkIndex: 0,
            pageNumber: 1,
            pageRange: '1',
            section: 'Gateway Routing Architecture and Endpoints',
            content:
              'The gateway dispatches incoming POST /api/rag/stream requests to RAGService. RAGService triggers RetrievalService on PostgreSQL document_chunks using hybrid vector and keyword channels. SSE stream lifecycle emits standard events: start -> retrieval_complete -> sources -> token* -> validation -> done.',
            rank: 1,
            score: 0.95,
            retrievalSources: ['keyword', 'vector', 'graph'],
            supportedRelationIds: ['rel_demo_gateway_rag', 'rel_demo_rag_retrieval'],
          },
          {
            citationId: '[S2]',
            documentId: 'doc_demo_mv_01',
            documentName: 'MV-DOC-01.md',
            chunkId: 'chk_demo_mv_01_0',
            chunkIndex: 0,
            pageNumber: 1,
            pageRange: '1',
            section: 'Subsystem Dependencies and Revocation Cascades',
            content:
              'The Hybrid Retrieval Engine queries Vector Search Index directly. The Incident Health Daemon monitors replication lag across all shard leaders. Revocation of tenant master keys disables document decryption, the embedding pipeline, and context assembly.',
            rank: 2,
            score: 0.91,
            retrievalSources: ['vector', 'graph'],
            supportedRelationIds: ['rel_demo_retrieval_vector', 'rel_demo_health_vector'],
          },
        ],
        metadata: {
          isDemo: true,
          preSeeded: true,
          grounded: true,
          verifiedCitationCount: 2,
        },
      },
      {
        id: 'msg_demo_arch_001_3',
        role: 'USER',
        sequenceNumber: 3,
        content: 'What happens if the primary session cache fails during authentication?',
        tokenEstimate: 14,
        citations: [],
        metadata: { isDemo: true, preSeeded: true },
      },
      {
        id: 'msg_demo_arch_001_4',
        role: 'ASSISTANT',
        sequenceNumber: 4,
        content: `If the primary \`Redis Session Store\` fails, authentication state remains fully protected:

- **Write-Through Failover:** Session authentication utilizes write-through caching; Redis failure automatically triggers failover to the \`PostgreSQL Session Backup Table\` [S3].
- **Tenant Isolation:** Horizontal multi-tenant isolation is cryptographically guaranteed by scoping every database predicate to the verified \`workspaceId\` extracted from the signed token [S3].
- **Token Lifecycle:** User access JWT tokens maintain a strict time-to-live (TTL) of 15 minutes, while refresh tokens rotate every 7 days [S3].
- **Cryptographic Authority:** Tenant encryption key rotation requires the \`Security Incident Officer\` role; Tier-1 on-call personnel do not possess key rotation authority [S3].`,
        tokenEstimate: 172,
        citations: [
          {
            citationId: '[S3]',
            documentId: 'doc_demo_mv_02',
            documentName: 'MV-DOC-02.md',
            chunkId: 'chk_demo_mv_02_0',
            chunkIndex: 0,
            pageNumber: 1,
            pageRange: '1',
            section: 'Authentication Gateway and Token Lifecycle',
            content:
              'User access JWT tokens have a strict time-to-live (TTL) of 15 minutes. Refresh tokens rotate every 7 days. Session authentication utilizes write-through caching; Redis failure triggers failover to PostgreSQL session backup table. Horizontal tenant isolation is cryptographically guaranteed by scoping every database predicate to the verified workspaceId extracted from the signed token.',
            rank: 1,
            score: 0.94,
            retrievalSources: ['keyword', 'vector', 'graph'],
            supportedRelationIds: ['rel_demo_redis_pg_failover', 'rel_demo_sec_officer_key'],
          },
        ],
        metadata: {
          isDemo: true,
          preSeeded: true,
          grounded: true,
          verifiedCitationCount: 1,
        },
      },
    ],
  },
  {
    id: 'ses_demo_bench_002',
    title: 'Regional Latency Benchmarks & SLA Compliance',
    summary:
      'Review of empirical infrastructure benchmarks across 5 global deployment regions, analyzing p99 retrieval latency SLA compliance, throughput, and compute costs.',
    messages: [
      {
        id: 'msg_demo_bench_002_1',
        role: 'USER',
        sequenceNumber: 1,
        content:
          'Which AWS regions meet MindVaults operational retrieval latency SLA, and which region is the most cost-efficient?',
        tokenEstimate: 22,
        citations: [],
        metadata: { isDemo: true, preSeeded: true },
      },
      {
        id: 'msg_demo_bench_002_2',
        role: 'ASSISTANT',
        sequenceNumber: 2,
        content: `Based on the Q3-2026 empirical infrastructure benchmark measurements:

### SLA Requirements
The operational SLA mandates a **p99 retrieval latency < 150ms** and initial token dispatch within 2000ms [S1, S2]. If retrieval exceeds the 150ms boundary, alerts automatically trigger priority auto-scaling [S2].

### Region Performance Comparison
1. **\`us-east-1\` (AWS HNSW):**
   - p50: 42ms | p99: **112ms** (Satisfies SLA)
   - Max QPS: **850** (Fastest regional profile)
   - Cost: $0.015 / 10k queries [S1]
2. **\`us-west-2\` (AWS HNSW):**
   - p50: 48ms | p99: **126ms** (Satisfies SLA)
   - Max QPS: 780 | Cost: $0.016 / 10k queries [S1]
3. **\`eu-west-1\` (AWS HNSW) — Most Cost-Efficient:**
   - p50: 55ms | p99: **138ms** (Satisfies SLA)
   - Max QPS: 710
   - Cost: **$0.012 / 10k queries** (Lowest compute cost among all compliant regions) [S1]

### Non-Compliant Regions
- \`ap-southeast-1\`: p99 **168ms** (Fails SLA) [S1]
- \`sa-east-1\`: p99 **210ms** (Fails SLA) [S1]

In summary, **\`us-east-1\`**, **\`us-west-2\`**, and **\`eu-west-1\`** all meet the operational SLA, with **\`eu-west-1\`** delivering the highest cost efficiency.`,
        tokenEstimate: 310,
        citations: [
          {
            citationId: '[S1]',
            documentId: 'doc_demo_mv_06',
            documentName: 'MV-DOC-06.md',
            chunkId: 'chk_demo_mv_06_0',
            chunkIndex: 0,
            pageNumber: 1,
            pageRange: '1',
            section: 'Benchmark Observations & SLA Conformance Analysis',
            content:
              'The operational SLA mandates p99 retrieval latency < 150ms. Regions us-east-1 (112ms), us-west-2 (126ms), and eu-west-1 (138ms) satisfy the SLA. Regions ap-southeast-1 (168ms) and sa-east-1 (210ms) fail the SLA. Region eu-west-1 meets the p99 SLA (< 150ms at 138ms) while having the lowest compute cost at $0.012 per 10k queries.',
            rank: 1,
            score: 0.98,
            retrievalSources: ['keyword', 'vector'],
            supportedRelationIds: ['rel_demo_vector_benchmark'],
          },
          {
            citationId: '[S2]',
            documentId: 'doc_demo_mv_03',
            documentName: 'MV-DOC-03.md',
            chunkId: 'chk_demo_mv_03_0',
            chunkIndex: 0,
            pageNumber: 1,
            pageRange: '1',
            section: 'Service Level Agreements (SLAs)',
            content:
              'SLA mandates p99 retrieval latency < 150ms and initial token dispatched < 2000ms. If retrieval exceeds the 150ms boundary, alerts trigger priority auto-scaling.',
            rank: 2,
            score: 0.93,
            retrievalSources: ['keyword', 'vector'],
          },
        ],
        metadata: {
          isDemo: true,
          preSeeded: true,
          grounded: true,
          verifiedCitationCount: 2,
        },
      },
    ],
  },
];
