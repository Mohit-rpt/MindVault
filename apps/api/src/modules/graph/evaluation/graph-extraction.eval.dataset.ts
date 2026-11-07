/**
 * MindVault — Knowledge Graph: Extraction Evaluation Benchmark Dataset
 *
 * Contains standardized technical scenarios with annotated ground-truth
 * entities and relationships to measure extraction precision, recall, and F1.
 */

export interface EvalScenario {
  id: string;
  name: string;
  chunkText: string;
  expectedEntities: Array<{
    name: string;
    entityType: string;
    aliases?: string[];
  }>;
  expectedRelations: Array<{
    sourceEntity: string;
    targetEntity: string;
    relationType: string;
  }>;
}

export const EXTRACTION_EVAL_DATASET: EvalScenario[] = [
  {
    id: 'eval_01_database_indexing',
    name: 'PostgreSQL & pgvector Extension',
    chunkText:
      'PostgreSQL is an open-source relational database that supports the pgvector extension. ' +
      'pgvector implements HNSW indexing for high-dimensional vector search. ' +
      'Engineers use pgvector alongside standard B-Tree indexes for hybrid retrieval.',
    expectedEntities: [
      { name: 'PostgreSQL', entityType: 'TECHNOLOGY', aliases: ['postgres'] },
      { name: 'pgvector', entityType: 'TECHNOLOGY', aliases: ['pg-vector'] },
      { name: 'HNSW', entityType: 'CONCEPT' },
      { name: 'Vector Search', entityType: 'CONCEPT' },
      { name: 'B-Tree', entityType: 'CONCEPT' },
    ],
    expectedRelations: [
      { sourceEntity: 'PostgreSQL', targetEntity: 'pgvector', relationType: 'SUPPORTS' },
      { sourceEntity: 'pgvector', targetEntity: 'HNSW', relationType: 'IMPLEMENTS' },
      { sourceEntity: 'HNSW', targetEntity: 'Vector Search', relationType: 'USED_FOR' },
    ],
  },
  {
    id: 'eval_02_async_queue',
    name: 'BullMQ and Redis Architecture',
    chunkText:
      'BullMQ is a Node.js message queue library backed by Redis. ' +
      'In MindVault, BullMQ manages asynchronous background worker processes. ' +
      'Redis provides in-memory persistence and atomic stream processing for job queues.',
    expectedEntities: [
      { name: 'BullMQ', entityType: 'TECHNOLOGY' },
      { name: 'Node.js', entityType: 'TECHNOLOGY', aliases: ['nodejs'] },
      { name: 'Redis', entityType: 'TECHNOLOGY' },
      { name: 'MindVault', entityType: 'PRODUCT' },
    ],
    expectedRelations: [
      { sourceEntity: 'BullMQ', targetEntity: 'Redis', relationType: 'DEPENDS_ON' },
      { sourceEntity: 'BullMQ', targetEntity: 'Node.js', relationType: 'BUILT_FOR' },
      { sourceEntity: 'MindVault', targetEntity: 'BullMQ', relationType: 'USES' },
    ],
  },
  {
    id: 'eval_03_hybrid_retrieval',
    name: 'Reciprocal Rank Fusion in RAG',
    chunkText:
      'Reciprocal Rank Fusion, commonly known as RRF, is an algorithm that combines rankings ' +
      'from dense vector retrieval and sparse BM25 keyword search. ' +
      'MindVault leverages RRF to improve search accuracy and ground LLM answers.',
    expectedEntities: [
      { name: 'Reciprocal Rank Fusion', entityType: 'CONCEPT', aliases: ['RRF'] },
      { name: 'BM25', entityType: 'CONCEPT' },
      { name: 'MindVault', entityType: 'PRODUCT' },
    ],
    expectedRelations: [
      { sourceEntity: 'Reciprocal Rank Fusion', targetEntity: 'BM25', relationType: 'COMBINES' },
      {
        sourceEntity: 'MindVault',
        targetEntity: 'Reciprocal Rank Fusion',
        relationType: 'LEVERAGES',
      },
    ],
  },
  {
    id: 'eval_04_runtime_compilation',
    name: 'V8 Engine and C++ Interop',
    chunkText:
      'Google developed the V8 JavaScript engine in C++. ' +
      'Node.js embeds V8 to execute JavaScript code outside the browser. ' +
      'Developers write C++ addons to interface directly with V8 memory pointers.',
    expectedEntities: [
      { name: 'Google', entityType: 'ORGANIZATION' },
      { name: 'V8 Engine', entityType: 'TECHNOLOGY', aliases: ['V8'] },
      { name: 'C++', entityType: 'TECHNOLOGY', aliases: ['cpp'] },
      { name: 'Node.js', entityType: 'TECHNOLOGY', aliases: ['nodejs'] },
    ],
    expectedRelations: [
      { sourceEntity: 'Google', targetEntity: 'V8 Engine', relationType: 'DEVELOPED' },
      { sourceEntity: 'Node.js', targetEntity: 'V8 Engine', relationType: 'EMBEDS' },
      { sourceEntity: 'V8 Engine', targetEntity: 'C++', relationType: 'IMPLEMENTED_IN' },
    ],
  },
  {
    id: 'eval_05_microservices_mesh',
    name: 'Docker and Kubernetes Orchestration',
    chunkText:
      'Docker packages software applications into standardized containers. ' +
      'Kubernetes, also known as K8s, automates container deployment and horizontal scaling. ' +
      'Kubernetes uses Docker images to run pods across distributed server clusters.',
    expectedEntities: [
      { name: 'Docker', entityType: 'TECHNOLOGY' },
      { name: 'Kubernetes', entityType: 'TECHNOLOGY', aliases: ['K8s'] },
    ],
    expectedRelations: [
      { sourceEntity: 'Kubernetes', targetEntity: 'Docker', relationType: 'ORCHESTRATES' },
    ],
  },
];
