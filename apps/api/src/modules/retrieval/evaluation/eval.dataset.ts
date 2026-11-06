/**
 * MindVault — Retrieval Evaluation: Golden Ground-Truth Evaluation Dataset
 *
 * Deterministic test corpus with labeled relevance judgments for evaluating
 * Semantic, Keyword, and Hybrid (RRF) retrieval strategies.
 */

export interface EvaluationDocument {
  id: string;
  originalName: string;
  extension: string;
  chunks: Array<{
    id: string;
    chunkIndex: number;
    content: string;
    tokenCount: number;
    pageStart?: number;
    pageEnd?: number;
    heading?: string;
  }>;
}

export interface EvaluationQuery {
  id: string;
  query: string;
  /** Ground truth relevant chunk IDs with graded relevance (3: Highly relevant, 2: Relevant, 1: Marginally relevant) */
  relevanceMap: Record<string, number>;
}

export const EVALUATION_CORPUS: EvaluationDocument[] = [
  {
    id: 'eval_doc_ml',
    originalName: 'machine_learning_fundamentals.pdf',
    extension: 'pdf',
    chunks: [
      {
        id: 'chk_ml_0',
        chunkIndex: 0,
        content:
          'Supervised learning algorithms infer a function from labeled training data consisting of input-output pairs.',
        tokenCount: 22,
        pageStart: 1,
        pageEnd: 1,
        heading: 'Introduction to Supervised Learning',
      },
      {
        id: 'chk_ml_1',
        chunkIndex: 1,
        content:
          'Backpropagation computes the gradient of the loss function with respect to the weights of the neural network using the chain rule.',
        tokenCount: 26,
        pageStart: 4,
        pageEnd: 5,
        heading: 'Backpropagation and Gradient Descent',
      },
      {
        id: 'chk_ml_2',
        chunkIndex: 2,
        content:
          'Unsupervised learning discovers hidden patterns or data groupings without requiring pre-assigned ground truth labels, such as k-means clustering.',
        tokenCount: 24,
        pageStart: 8,
        pageEnd: 8,
        heading: 'Unsupervised Clustering',
      },
    ],
  },
  {
    id: 'eval_doc_db',
    originalName: 'postgresql_indexes_and_pgvector.md',
    extension: 'md',
    chunks: [
      {
        id: 'chk_db_0',
        chunkIndex: 0,
        content:
          'Hierarchical Navigable Small World (HNSW) vector indexes in pgvector accelerate approximate nearest neighbor searches using cosine distance vector_cosine_ops.',
        tokenCount: 28,
        pageStart: 1,
        pageEnd: 1,
        heading: 'pgvector HNSW Indexes',
      },
      {
        id: 'chk_db_1',
        chunkIndex: 1,
        content:
          'Generalized Inverted Indexes (GIN) in PostgreSQL index composite text elements and tsvector data for fast full-text search with websearch_to_tsquery.',
        tokenCount: 27,
        pageStart: 2,
        pageEnd: 2,
        heading: 'PostgreSQL Full-Text Search and GIN Indexes',
      },
      {
        id: 'chk_db_2',
        chunkIndex: 2,
        content:
          'B-tree indexes are optimized for equality and range queries on sequential scalar data, providing logarithmic search complexity.',
        tokenCount: 23,
        pageStart: 3,
        pageEnd: 3,
        heading: 'B-Tree Indexing Principles',
      },
    ],
  },
  {
    id: 'eval_doc_sec',
    originalName: 'application_security_guide.docx',
    extension: 'docx',
    chunks: [
      {
        id: 'chk_sec_0',
        chunkIndex: 0,
        content:
          'Multi-tenant isolation requires database queries to enforce workspace scoping directly in SQL to prevent Insecure Direct Object Reference (IDOR) attacks.',
        tokenCount: 28,
        pageStart: 1,
        pageEnd: 2,
        heading: 'Multi-Tenancy and IDOR Prevention',
      },
      {
        id: 'chk_sec_1',
        chunkIndex: 1,
        content:
          'JSON Web Tokens (JWT) store cryptographically signed claims with expiration timestamps and must be verified against server-side secret keys.',
        tokenCount: 25,
        pageStart: 3,
        pageEnd: 3,
        heading: 'Authentication and JWT Lifecycle',
      },
    ],
  },
];

export const EVALUATION_QUERIES: EvaluationQuery[] = [
  {
    id: 'q1',
    query: 'How does backpropagation calculate gradients in neural networks?',
    relevanceMap: {
      chk_ml_1: 3,
      chk_ml_0: 1,
    },
  },
  {
    id: 'q2',
    query: 'What is the purpose of GIN indexes and tsvector in PostgreSQL full-text search?',
    relevanceMap: {
      chk_db_1: 3,
      chk_db_0: 1,
    },
  },
  {
    id: 'q3',
    query: 'How to protect multi-tenant architectures against IDOR and cross-workspace access?',
    relevanceMap: {
      chk_sec_0: 3,
    },
  },
  {
    id: 'q4',
    query: 'HNSW vector cosine distance nearest neighbor search',
    relevanceMap: {
      chk_db_0: 3,
      chk_db_1: 1,
    },
  },
  {
    id: 'q5',
    query: 'Unsupervised clustering patterns without labels',
    relevanceMap: {
      chk_ml_2: 3,
      chk_ml_0: 1,
    },
  },
];
