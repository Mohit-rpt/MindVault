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
  {
    id: 'eval_06_event_driven_architecture',
    name: 'Apache Kafka Event Streaming',
    chunkText:
      'Apache Kafka is an event streaming platform used for building real-time data pipelines. ' +
      'Microservices publish event messages to Kafka topics. ' +
      'Kafka persists partitioned commit logs across clustered nodes.',
    expectedEntities: [
      { name: 'Apache Kafka', entityType: 'TECHNOLOGY', aliases: ['Kafka'] },
      { name: 'Microservices', entityType: 'CONCEPT' },
    ],
    expectedRelations: [
      { sourceEntity: 'Microservices', targetEntity: 'Apache Kafka', relationType: 'USES' },
    ],
  },
  {
    id: 'eval_07_general_knowledge_org',
    name: 'OpenAI and Leadership',
    chunkText:
      'OpenAI is an artificial intelligence research organization headquartered in San Francisco. ' +
      'Sam Altman serves as the Chief Executive Officer of OpenAI. ' +
      'OpenAI developed ChatGPT to provide conversational AI capabilities.',
    expectedEntities: [
      { name: 'OpenAI', entityType: 'ORGANIZATION' },
      { name: 'San Francisco', entityType: 'LOCATION' },
      { name: 'Sam Altman', entityType: 'PERSON' },
      { name: 'ChatGPT', entityType: 'PRODUCT' },
    ],
    expectedRelations: [
      { sourceEntity: 'OpenAI', targetEntity: 'San Francisco', relationType: 'LOCATED_IN' },
      { sourceEntity: 'Sam Altman', targetEntity: 'OpenAI', relationType: 'WORKS_FOR' },
      { sourceEntity: 'OpenAI', targetEntity: 'ChatGPT', relationType: 'DEVELOPED' },
    ],
  },
  {
    id: 'eval_08_organizational_hierarchy',
    name: 'Anthropic and Model Development',
    chunkText:
      'Anthropic is an AI safety and research public benefit corporation. ' +
      'Dario Amodei works for Anthropic as its Chief Executive Officer. ' +
      'Anthropic produces Claude, a suite of foundation language models.',
    expectedEntities: [
      { name: 'Anthropic', entityType: 'ORGANIZATION' },
      { name: 'Dario Amodei', entityType: 'PERSON' },
      { name: 'Claude', entityType: 'PRODUCT' },
    ],
    expectedRelations: [
      { sourceEntity: 'Dario Amodei', targetEntity: 'Anthropic', relationType: 'WORKS_FOR' },
      { sourceEntity: 'Anthropic', targetEntity: 'Claude', relationType: 'PRODUCES' },
    ],
  },
  {
    id: 'eval_09_ambiguous_statements',
    name: 'Ambiguous Pronoun References',
    chunkText:
      'The company announced that the engineers completed the maintenance window yesterday. ' +
      'They claimed it was faster than previous quarters without identifying the product. ' +
      'Only the Linux servers in the primary datacenter experienced scheduled downtime.',
    expectedEntities: [{ name: 'Linux', entityType: 'TECHNOLOGY' }],
    expectedRelations: [],
  },
  {
    id: 'eval_10_unsupported_claims_negative',
    name: 'Unsupported Negative Control',
    chunkText:
      'Speculation circulates across online forums regarding prospective corporate mergers. ' +
      'However, no formal contractual relations or technological integrations exist between the entities. ' +
      'Unsubstantiated reports should not be treated as verifiable facts.',
    expectedEntities: [],
    expectedRelations: [],
  },
  {
    id: 'eval_11_multidoc_corroboration',
    name: 'Cross-Document Corroboration: TypeScript on Node.js',
    chunkText:
      'TypeScript is an open-source programming language developed by Microsoft. ' +
      'Enterprise backend systems execute TypeScript code compiled for the Node.js runtime environment.',
    expectedEntities: [
      { name: 'TypeScript', entityType: 'TECHNOLOGY', aliases: ['ts'] },
      { name: 'Microsoft', entityType: 'ORGANIZATION' },
      { name: 'Node.js', entityType: 'TECHNOLOGY', aliases: ['nodejs'] },
    ],
    expectedRelations: [
      { sourceEntity: 'Microsoft', targetEntity: 'TypeScript', relationType: 'DEVELOPED' },
      { sourceEntity: 'TypeScript', targetEntity: 'Node.js', relationType: 'USES' },
    ],
  },
];
