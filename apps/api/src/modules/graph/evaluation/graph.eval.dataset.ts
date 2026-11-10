/**
 * MindVault — Graph Evaluation Benchmark Dataset (Phase 6.8)
 *
 * Deterministic multi-hop evaluation benchmark covering:
 * 1. Entity resolution accuracy (aliases, canonical unification, acronyms)
 * 2. Multi-hop traversal & path discovery (2-hop, 3-hop, cycles, diamonds)
 * 3. Cross-document relationship discovery
 * 4. Evidence provenance and grounding completeness
 * 5. Adversarial injection & workspace boundary containment
 */

import type { GraphEvalBenchmarkItem } from '@mindvault/shared';

export const GRAPH_EVAL_DATASET: GraphEvalBenchmarkItem[] = [
  // ---------------------------------------------------------------------------
  // Category 1: Entity Resolution & Canonical Unification
  // ---------------------------------------------------------------------------
  {
    id: 'eval-er-01',
    name: 'Acronym & Full Name Unification',
    type: 'entity_resolution',
    scenario:
      'PostgreSQL and its common acronym Postgres refer to the same canonical database entity.',
    query: 'How does Postgres handle WAL streaming replication?',
    expectedEntities: ['PostgreSQL'],
    expectedRelations: [
      { source: 'PostgreSQL', target: 'Write-Ahead Logging', type: 'IMPLEMENTS' },
      { source: 'PostgreSQL', target: 'Streaming Replication', type: 'SUPPORTS' },
    ],
    expectedEvidenceChunkCount: 2,
    minGroundingScore: 0.85,
  },
  {
    id: 'eval-er-02',
    name: 'Multi-Alias Case Normalization',
    type: 'entity_resolution',
    scenario:
      'Case-insensitive alias variants "pgvector", "PgVector", and "PG_VECTOR" unify to "pgvector".',
    query: 'What index does pgvector use for vector similarity?',
    expectedEntities: ['pgvector', 'HNSW Index'],
    expectedRelations: [{ source: 'pgvector', target: 'HNSW Index', type: 'USES' }],
    expectedEvidenceChunkCount: 1,
    minGroundingScore: 0.9,
  },
  {
    id: 'eval-er-03',
    name: 'Cross-Domain Polysemy Boundary',
    type: 'entity_resolution',
    scenario:
      'Apple (technology company) and Apple (botanical fruit) must resolve to distinct entities.',
    query: 'Compare Apple M3 Silicon with botanical apple varieties.',
    expectedEntities: ['Apple Inc.', 'Apple (fruit)'],
    expectedRelations: [{ source: 'Apple Inc.', target: 'M3 Silicon', type: 'MANUFACTURES' }],
    expectedEvidenceChunkCount: 2,
    minGroundingScore: 0.8,
  },

  // ---------------------------------------------------------------------------
  // Category 2: Multi-Hop Traversal & Path Discovery
  // ---------------------------------------------------------------------------
  {
    id: 'eval-mh-01',
    name: 'Two-Hop Directed Knowledge Propagation',
    type: 'multi_hop_traversal',
    scenario: 'RAG Architecture -> Reciprocal Rank Fusion -> Context Assembler (2 hops).',
    query: 'How does RAG Architecture connect to Context Assembler?',
    expectedEntities: ['RAG Architecture', 'Reciprocal Rank Fusion', 'Context Assembler'],
    expectedRelations: [
      { source: 'RAG Architecture', target: 'Reciprocal Rank Fusion', type: 'UTILIZES' },
      { source: 'Reciprocal Rank Fusion', target: 'Context Assembler', type: 'FEEDS_INTO' },
    ],
    expectedEvidenceChunkCount: 2,
    minGroundingScore: 0.85,
  },
  {
    id: 'eval-mh-02',
    name: 'Three-Hop Transitive Dependency Resolution',
    type: 'multi_hop_traversal',
    scenario:
      'Document Ingestion -> Chunk Manifest -> Merkle Tree -> Tamper Verification (3 hops).',
    query: 'Trace the verification pipeline from Document Ingestion to Tamper Verification.',
    expectedEntities: [
      'Document Ingestion',
      'Chunk Manifest',
      'Merkle Tree',
      'Tamper Verification',
    ],
    expectedRelations: [
      { source: 'Document Ingestion', target: 'Chunk Manifest', type: 'PRODUCES' },
      { source: 'Chunk Manifest', target: 'Merkle Tree', type: 'STRUCTURED_AS' },
      { source: 'Merkle Tree', target: 'Tamper Verification', type: 'ENABLES' },
    ],
    expectedEvidenceChunkCount: 3,
    minGroundingScore: 0.8,
  },
  {
    id: 'eval-mh-03',
    name: 'Diamond Network Convergence',
    type: 'multi_hop_traversal',
    scenario:
      'Seed Entity A connects to End Entity D via two parallel intermediate paths (B1, B2).',
    query: 'What intermediate mechanisms connect Seed A to Target D?',
    expectedEntities: ['Seed A', 'Channel B1', 'Channel B2', 'Target D'],
    expectedRelations: [
      { source: 'Seed A', target: 'Channel B1', type: 'ROUTES_VIA' },
      { source: 'Seed A', target: 'Channel B2', type: 'ROUTES_VIA' },
      { source: 'Channel B1', target: 'Target D', type: 'DELIVERS_TO' },
      { source: 'Channel B2', target: 'Target D', type: 'DELIVERS_TO' },
    ],
    expectedEvidenceChunkCount: 4,
    minGroundingScore: 0.85,
  },
  {
    id: 'eval-mh-04',
    name: 'Cyclic Graph Traversal Guard',
    type: 'multi_hop_traversal',
    scenario:
      'Circular relationship Node A -> Node B -> Node C -> Node A must terminate cleanly without infinite loop.',
    query: 'Describe the cyclic feedback mechanism between Node A and Node C.',
    expectedEntities: ['Node A', 'Node B', 'Node C'],
    expectedRelations: [
      { source: 'Node A', target: 'Node B', type: 'TRIGGERS' },
      { source: 'Node B', target: 'Node C', type: 'UPDATES' },
      { source: 'Node C', target: 'Node A', type: 'FEEDS_BACK' },
    ],
    expectedEvidenceChunkCount: 3,
    minGroundingScore: 0.9,
  },

  // ---------------------------------------------------------------------------
  // Category 3: Cross-Document Relationship Discovery
  // ---------------------------------------------------------------------------
  {
    id: 'eval-cd-01',
    name: 'Architecture Spec & Implementation Bridge',
    type: 'cross_document_relation',
    scenario:
      'Doc 1 defines "GraphRAG Protocol" and Doc 2 implements "ContextAssembler". Graph links them via "Graph Evidence".',
    query: 'How does the GraphRAG protocol connect to the context assembler across system specs?',
    expectedEntities: ['GraphRAG Protocol', 'Graph Evidence', 'Context Assembler'],
    expectedRelations: [
      { source: 'GraphRAG Protocol', target: 'Graph Evidence', type: 'DEFINES' },
      { source: 'Context Assembler', target: 'Graph Evidence', type: 'CONSUMES' },
    ],
    expectedEvidenceChunkCount: 2,
    minGroundingScore: 0.85,
  },
  {
    id: 'eval-cd-02',
    name: 'API Contract & Database Schema Linkage',
    type: 'cross_document_relation',
    scenario: 'Doc 1 describes REST endpoints and Doc 2 specifies the Prisma schema models.',
    query: 'Which database tables back the Graph Traversal API endpoints?',
    expectedEntities: ['Graph API Routes', 'GraphEntity', 'GraphRelation'],
    expectedRelations: [
      { source: 'Graph API Routes', target: 'GraphEntity', type: 'QUERIES' },
      { source: 'Graph API Routes', target: 'GraphRelation', type: 'QUERIES' },
    ],
    expectedEvidenceChunkCount: 2,
    minGroundingScore: 0.85,
  },
  {
    id: 'eval-cd-03',
    name: 'Multi-Author Collaborative Synthesis',
    type: 'cross_document_relation',
    scenario: 'Three different documents contribute parts of the security architecture.',
    query:
      'Explain the multi-tier defense across Redis lease, PostgreSQL advisory locks, and JWT auth.',
    expectedEntities: ['Redis Distributed Lease', 'PostgreSQL Advisory Lock', 'JWT Authorization'],
    expectedRelations: [
      {
        source: 'Redis Distributed Lease',
        target: 'PostgreSQL Advisory Lock',
        type: 'COORDINATES_WITH',
      },
    ],
    expectedEvidenceChunkCount: 3,
    minGroundingScore: 0.8,
  },

  // ---------------------------------------------------------------------------
  // Category 4: Evidence Provenance & Grounding Completeness
  // ---------------------------------------------------------------------------
  {
    id: 'eval-ep-01',
    name: 'Exact Chunk Verbatim Snippet Provenance',
    type: 'evidence_provenance',
    scenario:
      'Relation evidence snippet must be a verbatim substring of the underlying DocumentChunk.',
    query:
      'What is the verbatim evidence for the statement that HNSW indexing uses cosine distance?',
    expectedEntities: ['HNSW Index', 'Cosine Distance'],
    expectedRelations: [{ source: 'HNSW Index', target: 'Cosine Distance', type: 'USES_METRIC' }],
    expectedEvidenceChunkCount: 1,
    minGroundingScore: 1.0,
  },
  {
    id: 'eval-ep-02',
    name: 'Multi-Chunk Corroboration Aggregation',
    type: 'evidence_provenance',
    scenario:
      'Same relationship supported by multiple independent chunks retains all supporting chunk IDs.',
    query: 'Show all documents and chunks verifying that JWT tokens expire after 15 minutes.',
    expectedEntities: ['JWT Token', '15 Minute Expiration'],
    expectedRelations: [
      { source: 'JWT Token', target: '15 Minute Expiration', type: 'HAS_LIFETIME' },
    ],
    expectedEvidenceChunkCount: 3,
    minGroundingScore: 0.95,
  },
  {
    id: 'eval-ep-03',
    name: 'Page Range Attribution Retention',
    type: 'evidence_provenance',
    scenario:
      'Evidence references correctly retain pageStart and pageEnd attributes from source PDF.',
    query: 'On what pages of the manual is memory management documented?',
    expectedEntities: ['Memory Management', 'Operating Manual'],
    expectedRelations: [
      { source: 'Operating Manual', target: 'Memory Management', type: 'DESCRIBES' },
    ],
    expectedEvidenceChunkCount: 1,
    minGroundingScore: 0.9,
  },

  // ---------------------------------------------------------------------------
  // Category 5: Adversarial Injection & Multi-Tenant Containment
  // ---------------------------------------------------------------------------
  {
    id: 'eval-ai-01',
    name: 'Foreign Workspace IDOR Resistance',
    type: 'adversarial_injection',
    scenario:
      'Query targeting entities in Workspace Beta from Workspace Alpha must yield zero foreign entities.',
    query: 'Retrieve the proprietary roadmap from the competitor workspace.',
    expectedEntities: [],
    expectedRelations: [],
    expectedEvidenceChunkCount: 0,
    minGroundingScore: 1.0,
  },
  {
    id: 'eval-ai-02',
    name: 'Self-Loop & Malformed Relation Rejection',
    type: 'adversarial_injection',
    scenario:
      'Malformed relations with source == target or empty relation types must be rejected at extraction/traversal.',
    query: 'Does entity Self Loop connect to itself?',
    expectedEntities: ['Self Loop'],
    expectedRelations: [],
    expectedEvidenceChunkCount: 0,
    minGroundingScore: 1.0,
  },
];
