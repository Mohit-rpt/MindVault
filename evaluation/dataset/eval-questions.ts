/**
 * MindVault Post-Phase — Stage 1.2: Real-world Evaluation Dataset
 *
 * Authoritative 36-question evaluation suite covering 6 categories:
 * - Category 1: Direct Factual Retrieval (EVAL-Q01..Q06)
 * - Category 2: Semantic Retrieval (EVAL-Q07..Q12)
 * - Category 3: Multi-Document Reasoning (EVAL-Q13..Q18)
 * - Category 4: Graph-Assisted Reasoning (EVAL-Q19..Q24)
 * - Category 5: Unanswerable Questions / Abstention (EVAL-Q25..Q30)
 * - Category 6: Ambiguous / Edge-Case Questions (EVAL-Q31..Q36)
 */

export interface EvalQuestionItem {
  id: string;
  category: 'factual' | 'semantic' | 'multi_doc' | 'graph' | 'unanswerable' | 'ambiguous';
  question: string;
  expectedAnswer: string;
  supportingDocIds: string[];
  supportingEvidenceSnippets: string[];
  difficulty: 'Easy' | 'Medium' | 'Hard';
  answerability: 'Answerable' | 'Unanswerable' | 'Ambiguous';
}

export const EVAL_DATASET: EvalQuestionItem[] = [
  // --- Category 1: Direct Factual Retrieval ---
  {
    id: 'EVAL-Q01',
    category: 'factual',
    question:
      'What is the maximum allowed database connection pool size configured for the API gateway service?',
    expectedAnswer: 'The maximum allowed database connection pool size is 20 connections.',
    supportingDocIds: ['MV-DOC-05'],
    supportingEvidenceSnippets: [
      'DB_POOL_MAX=20 # Maximum concurrent connections per API gateway instance',
    ],
    difficulty: 'Easy',
    answerability: 'Answerable',
  },
  {
    id: 'EVAL-Q02',
    category: 'factual',
    question: 'What is the expiration lifetime of user access JWT tokens?',
    expectedAnswer: 'User access JWT tokens have a strict time-to-live (TTL) of 15 minutes.',
    supportingDocIds: ['MV-DOC-02'],
    supportingEvidenceSnippets: [
      'User access JWT tokens have a strict time-to-live (TTL) of 15 minutes.',
    ],
    difficulty: 'Easy',
    answerability: 'Answerable',
  },
  {
    id: 'EVAL-Q03',
    category: 'factual',
    question: 'What is the heartbeat lease duration for Raft consensus leader election?',
    expectedAnswer:
      'Leader election leases are renewed via periodic heartbeats set to 1500ms intervals.',
    supportingDocIds: ['MV-DOC-01'],
    supportingEvidenceSnippets: [
      'Leader election leases are renewed via periodic heartbeats set to 1500ms intervals.',
    ],
    difficulty: 'Easy',
    answerability: 'Answerable',
  },
  {
    id: 'EVAL-Q04',
    category: 'factual',
    question: 'What is the maximum file size limit for document uploads in MindVault?',
    expectedAnswer: 'The maximum file size limit is 25 MB (26214400 bytes).',
    supportingDocIds: ['MV-DOC-05'],
    supportingEvidenceSnippets: [
      'MAX_FILE_SIZE_BYTES=26214400 # 25 Megabytes absolute payload boundary',
    ],
    difficulty: 'Easy',
    answerability: 'Answerable',
  },
  {
    id: 'EVAL-Q05',
    category: 'factual',
    question: 'What is the target Recovery Point Objective (RPO) for a Sev-1 incident?',
    expectedAnswer:
      'The disaster recovery target Recovery Point Objective (RPO) is less than 1 minute.',
    supportingDocIds: ['MV-DOC-03'],
    supportingEvidenceSnippets: [
      'Disaster Recovery Target: Recovery Point Objective (RPO) < 1 minute;',
    ],
    difficulty: 'Easy',
    answerability: 'Answerable',
  },
  {
    id: 'EVAL-Q06',
    category: 'factual',
    question: 'What interval is specified for the Server-Sent Events (SSE) keep-alive ping?',
    expectedAnswer: 'The gateway dispatches a comment heartbeat (: ping) every 15 seconds.',
    supportingDocIds: ['MV-DOC-04'],
    supportingEvidenceSnippets: [
      'The gateway dispatches a comment heartbeat (: ping) every 15 seconds to prevent intermediate proxy timeout.',
    ],
    difficulty: 'Easy',
    answerability: 'Answerable',
  },

  // --- Category 2: Semantic Retrieval ---
  {
    id: 'EVAL-Q07',
    category: 'semantic',
    question: 'How does the platform defend against unauthorized horizontal tenant data traversal?',
    expectedAnswer:
      'Horizontal tenant isolation is cryptographically guaranteed by scoping every database predicate to the verified workspaceId extracted from the signed token.',
    supportingDocIds: ['MV-DOC-02'],
    supportingEvidenceSnippets: [
      'Horizontal tenant isolation is cryptographically guaranteed by scoping every database predicate to the verified workspaceId extracted from the signed token.',
    ],
    difficulty: 'Medium',
    answerability: 'Answerable',
  },
  {
    id: 'EVAL-Q08',
    category: 'semantic',
    question:
      'In what manner does the distributed storage cluster ensure data remains synchronized across geographical regions?',
    expectedAnswer:
      'Cross-zone consistency utilizes a quorum policy where write acknowledgments require W=2 confirmation out of N=3 replicas, and reads enforce R=2 consensus.',
    supportingDocIds: ['MV-DOC-01'],
    supportingEvidenceSnippets: [
      'Cross-zone consistency utilizes a quorum policy where write acknowledgments require W=2 confirmation out of N=3 replicas. Read operations enforce R=2 consensus before returning.',
    ],
    difficulty: 'Medium',
    answerability: 'Answerable',
  },
  {
    id: 'EVAL-Q09',
    category: 'semantic',
    question: 'What safeguards prevent infinite recursion when navigating entity connections?',
    expectedAnswer:
      'GRAPH_TIMEOUT_MS=2500 and visited set evaluation prevent cyclic loops during multi-hop path traversal.',
    supportingDocIds: ['MV-DOC-05'],
    supportingEvidenceSnippets: [
      'GRAPH_TIMEOUT_MS=2500 and visited set evaluation prevent cyclic loops during multi-hop path traversal.',
    ],
    difficulty: 'Medium',
    answerability: 'Answerable',
  },
  {
    id: 'EVAL-Q10',
    category: 'semantic',
    question: 'How are high-frequency consumers throttled to avoid cluster degradation?',
    expectedAnswer:
      'Tiered rate limiting allows up to 100 req/min for free tier and 1000 req/min for enterprise tier before returning HTTP 429 Too Many Requests.',
    supportingDocIds: ['MV-DOC-02'],
    supportingEvidenceSnippets: [
      'API rate limiting tiers: Free tier permits up to 100 req/min; Enterprise tier allows up to 1000 req/min before returning HTTP 429 Too Many Requests.',
    ],
    difficulty: 'Medium',
    answerability: 'Answerable',
  },
  {
    id: 'EVAL-Q11',
    category: 'semantic',
    question:
      'What mechanism guarantees that dropped SSE connections do not leave orphan tasks running?',
    expectedAnswer:
      'Client socket termination propagates an AbortSignal, terminating upstream LLM generators and marking the record CANCELLED.',
    supportingDocIds: ['MV-DOC-04'],
    supportingEvidenceSnippets: [
      'Client socket termination propagates an AbortSignal, terminating upstream LLM generators and marking the record CANCELLED.',
    ],
    difficulty: 'Medium',
    answerability: 'Answerable',
  },
  {
    id: 'EVAL-Q12',
    category: 'semantic',
    question:
      'How does the system handle documents where paragraph text exceeds the standard chunk boundary?',
    expectedAnswer:
      'When paragraphs exceed targetTokens (700), recursive boundary decomposition splits on sentence punctuation with 120-token overlap up to maxTokens (900).',
    supportingDocIds: ['MV-DOC-01'],
    supportingEvidenceSnippets: [
      'When paragraphs exceed targetTokens (700), recursive boundary decomposition splits on sentence punctuation with 120-token overlap, up to a hard ceiling of maxTokens (900).',
    ],
    difficulty: 'Medium',
    answerability: 'Answerable',
  },

  // --- Category 3: Multi-Document Reasoning ---
  {
    id: 'EVAL-Q13',
    category: 'multi_doc',
    question:
      'Does the API gateway database timeout provide enough buffer for a database failover trigger to execute?',
    expectedAnswer:
      'No. The database query timeout is 5000ms (MV-DOC-05), which exactly equals the 5000ms replica lag failover trigger threshold (MV-DOC-03), leaving no buffer and creating a concurrent race condition.',
    supportingDocIds: ['MV-DOC-03', 'MV-DOC-05'],
    supportingEvidenceSnippets: [
      'Automatic primary failover engages when replica lag exceeds 5000ms.',
      'DB_TIMEOUT_MS=5000 # Database query execution timeout in milliseconds',
    ],
    difficulty: 'Hard',
    answerability: 'Answerable',
  },
  {
    id: 'EVAL-Q14',
    category: 'multi_doc',
    question:
      'How do the token expiration policy and rate limiting interact for an unauthenticated user attempting API access?',
    expectedAnswer:
      'The authentication filter executes prior to the rate limiter, so an unauthenticated request with a missing or invalid token immediately returns 401 Unauthorized before rate limiting is evaluated.',
    supportingDocIds: ['MV-DOC-02', 'MV-DOC-04'],
    supportingEvidenceSnippets: [
      'Authentication filter executes prior to rate limiter. Missing Bearer token results in immediate 401 Unauthorized.',
      'Rate limit excess yields 429 Too Many Requests.',
    ],
    difficulty: 'Hard',
    answerability: 'Answerable',
  },
  {
    id: 'EVAL-Q15',
    category: 'multi_doc',
    question:
      'Which global deployment region recorded in the benchmarks satisfies both the p99 latency SLA and the minimum compute unit cost?',
    expectedAnswer:
      'Region eu-west-1 meets the p99 SLA (< 150ms at 138ms) while having the lowest compute cost at $0.012 per 10k queries.',
    supportingDocIds: ['MV-DOC-03', 'MV-DOC-06'],
    supportingEvidenceSnippets: [
      'SLA mandates p99 retrieval latency < 150ms',
      'Region eu-west-1 meets the p99 SLA (< 150ms at 138ms) while having the lowest compute cost at $0.012 per 10k queries.',
    ],
    difficulty: 'Hard',
    answerability: 'Answerable',
  },
  {
    id: 'EVAL-Q16',
    category: 'multi_doc',
    question:
      'If an incident reaches Severity-1 status, does the on-call engineer have direct permission to rotate tenant cryptographic keys?',
    expectedAnswer:
      'No. Tier-1 on-call manages Sev-1 triage and response, but tenant encryption key rotation requires the Security Incident Officer role.',
    supportingDocIds: ['MV-DOC-02', 'MV-DOC-03'],
    supportingEvidenceSnippets: [
      'Tier-1 on-call manages Sev-1 triage and coordinates emergency operational response.',
      'Tenant encryption key rotation requires Security Incident Officer role; Tier-1 on-call personnel do not possess key rotation authority.',
    ],
    difficulty: 'Hard',
    answerability: 'Answerable',
  },
  {
    id: 'EVAL-Q17',
    category: 'multi_doc',
    question:
      'Compare the Raft leader election heartbeat lease against the SSE keep-alive interval. Which is more frequent and by what ratio?',
    expectedAnswer:
      'The Raft leader election heartbeat (1500ms) is 10 times more frequent than the SSE keep-alive ping (15 seconds / 15000ms).',
    supportingDocIds: ['MV-DOC-01', 'MV-DOC-04'],
    supportingEvidenceSnippets: [
      'Leader election leases are renewed via periodic heartbeats set to 1500ms intervals.',
      'The gateway dispatches a comment heartbeat (: ping) every 15 seconds to prevent intermediate proxy timeout.',
    ],
    difficulty: 'Hard',
    answerability: 'Answerable',
  },
  {
    id: 'EVAL-Q18',
    category: 'multi_doc',
    question:
      'Explain how an ingestion failure due to an oversized document is communicated across the worker queue to the user interface.',
    expectedAnswer:
      'When a document exceeds the 25MB boundary (MAX_FILE_SIZE_BYTES=26214400), the extractor error marks the document FAILED with errorMessage in PostgreSQL, and the gateway error event envelope emits code FILE_TOO_LARGE.',
    supportingDocIds: ['MV-DOC-04', 'MV-DOC-05'],
    supportingEvidenceSnippets: [
      'Error event envelope emits code FILE_TOO_LARGE and transitions document to FAILED when payload exceeds 25MB boundary.',
      'MAX_FILE_SIZE_BYTES=26214400 # 25 Megabytes absolute payload boundary',
      'Extractor error marks document FAILED with errorMessage in PostgreSQL documents table.',
    ],
    difficulty: 'Hard',
    answerability: 'Answerable',
  },

  // --- Category 4: Graph-Assisted Reasoning ---
  {
    id: 'EVAL-Q19',
    category: 'graph',
    question:
      'Which microservice component is directly dependent on the Vector Search Index, and what service monitors its replication lag?',
    expectedAnswer:
      'The Hybrid Retrieval Engine queries Vector Search Index directly, while the Incident Health Daemon monitors replication lag across shard leaders.',
    supportingDocIds: ['MV-DOC-01'],
    supportingEvidenceSnippets: [
      'The Hybrid Retrieval Engine queries Vector Search Index directly. The Incident Health Daemon monitors replication lag across all shard leaders.',
    ],
    difficulty: 'Hard',
    answerability: 'Answerable',
  },
  {
    id: 'EVAL-Q20',
    category: 'graph',
    question:
      'Trace the full dependency path from an incoming /api/rag/stream request to the physical database storage layer.',
    expectedAnswer:
      'Incoming POST /api/rag/stream routes to API Gateway -> RAGService -> RetrievalService -> PostgreSQL document_chunks table with vector and keyword channels.',
    supportingDocIds: ['MV-DOC-04'],
    supportingEvidenceSnippets: [
      'The gateway dispatches incoming POST /api/rag/stream requests to RAGService. RAGService triggers RetrievalService on PostgreSQL document_chunks using hybrid vector and keyword channels.',
    ],
    difficulty: 'Hard',
    answerability: 'Answerable',
  },
  {
    id: 'EVAL-Q21',
    category: 'graph',
    question:
      'If the Primary Redis session store fails, which fallback component preserves user authentication state?',
    expectedAnswer:
      'Session authentication utilizes write-through caching, so Redis failure triggers failover to the PostgreSQL session backup table.',
    supportingDocIds: ['MV-DOC-02'],
    supportingEvidenceSnippets: [
      'Session authentication utilizes write-through caching; Redis failure triggers failover to PostgreSQL session backup table.',
    ],
    difficulty: 'Hard',
    answerability: 'Answerable',
  },
  {
    id: 'EVAL-Q22',
    category: 'graph',
    question:
      "Identify all services affected if the Security Incident Officer revokes an enterprise tenant's master key.",
    expectedAnswer:
      'Revocation of tenant master keys disables document decryption, the embedding pipeline, and context assembly in the storage and retrieval engine.',
    supportingDocIds: ['MV-DOC-01', 'MV-DOC-02'],
    supportingEvidenceSnippets: [
      'Revocation of tenant master keys disables document decryption, the embedding pipeline, and context assembly.',
      'Tenant encryption key rotation requires Security Incident Officer role;',
    ],
    difficulty: 'Hard',
    answerability: 'Answerable',
  },
  {
    id: 'EVAL-Q23',
    category: 'graph',
    question:
      'Which downstream consumers receive notification events when a document transitions to COMPLETED?',
    expectedAnswer:
      'Status COMPLETED triggers NotificationService WebSocket dispatch and schedules GraphExtractionTask for background entity resolution.',
    supportingDocIds: ['MV-DOC-03'],
    supportingEvidenceSnippets: [
      'Status COMPLETED triggers NotificationService WebSocket and schedules GraphExtractionTask for background entity resolution.',
    ],
    difficulty: 'Hard',
    answerability: 'Answerable',
  },
  {
    id: 'EVAL-Q24',
    category: 'graph',
    question:
      'What entities bridge the gap between user role authorization and raw file chunk access?',
    expectedAnswer:
      'RBAC links User via WorkspaceRole to Workspace, gating all child Document and DocumentChunk records.',
    supportingDocIds: ['MV-DOC-02'],
    supportingEvidenceSnippets: [
      'RBAC links User via WorkspaceRole to Workspace, gating all child Document and DocumentChunk records.',
    ],
    difficulty: 'Hard',
    answerability: 'Answerable',
  },

  // --- Category 5: Unanswerable Questions / Abstention ---
  {
    id: 'EVAL-Q25',
    category: 'unanswerable',
    question:
      'What is the pricing discount percentage for enterprise customers committing to a 3-year contract?',
    expectedAnswer:
      'Based on the provided documents, there is insufficient evidence to answer this question. The documents do not mention pricing discounts or contract terms.',
    supportingDocIds: [],
    supportingEvidenceSnippets: [],
    difficulty: 'Medium',
    answerability: 'Unanswerable',
  },
  {
    id: 'EVAL-Q26',
    category: 'unanswerable',
    question:
      'What is the recommended GPU model and VRAM requirement for running local Ollama inference in production?',
    expectedAnswer:
      'Based on the provided documents, there is insufficient evidence to answer this question. Hardware specifications for GPU models and VRAM are not provided.',
    supportingDocIds: [],
    supportingEvidenceSnippets: [],
    difficulty: 'Medium',
    answerability: 'Unanswerable',
  },
  {
    id: 'EVAL-Q27',
    category: 'unanswerable',
    question: 'How many employees work in the security incident response team?',
    expectedAnswer:
      'Based on the provided documents, there is insufficient evidence to answer this question. Team headcounts are not mentioned.',
    supportingDocIds: [],
    supportingEvidenceSnippets: [],
    difficulty: 'Easy',
    answerability: 'Unanswerable',
  },
  {
    id: 'EVAL-Q28',
    category: 'unanswerable',
    question: 'What is the automated migration procedure from MySQL to MindVault PostgreSQL?',
    expectedAnswer:
      'Based on the provided documents, there is insufficient evidence to answer this question. MySQL migration procedures are not documented.',
    supportingDocIds: [],
    supportingEvidenceSnippets: [],
    difficulty: 'Medium',
    answerability: 'Unanswerable',
  },
  {
    id: 'EVAL-Q29',
    category: 'unanswerable',
    question: 'What is the maximum character limit for user profile biographies?',
    expectedAnswer:
      'Based on the provided documents, there is insufficient evidence to answer this question. User profile biographical limits are not documented.',
    supportingDocIds: [],
    supportingEvidenceSnippets: [],
    difficulty: 'Easy',
    answerability: 'Unanswerable',
  },
  {
    id: 'EVAL-Q30',
    category: 'unanswerable',
    question: 'Which cellular mobile carrier provides failover SMS alerting for Sev-1 pages?',
    expectedAnswer:
      'Based on the provided documents, there is insufficient evidence to answer this question. Cellular mobile carriers are not documented.',
    supportingDocIds: [],
    supportingEvidenceSnippets: [],
    difficulty: 'Easy',
    answerability: 'Unanswerable',
  },

  // --- Category 6: Ambiguous / Edge-Case Questions ---
  {
    id: 'EVAL-Q31',
    category: 'ambiguous',
    question: 'What is the timeout value?',
    expectedAnswer:
      'The question is ambiguous as multiple timeouts exist in the system: Database query execution timeout is 5000ms (DB_TIMEOUT_MS=5000 in MV-DOC-05), Graph traversal timeout is 2500ms (GRAPH_TIMEOUT_MS=2500 in MV-DOC-05), and JWT token TTL is 15 minutes (MV-DOC-02).',
    supportingDocIds: ['MV-DOC-02', 'MV-DOC-05'],
    supportingEvidenceSnippets: [
      'DB_TIMEOUT_MS=5000 # Database query execution timeout in milliseconds',
      'GRAPH_TIMEOUT_MS=2500 and visited set evaluation prevent cyclic loops during multi-hop path traversal.',
      'User access JWT tokens have a strict time-to-live (TTL) of 15 minutes.',
    ],
    difficulty: 'Hard',
    answerability: 'Ambiguous',
  },
  {
    id: 'EVAL-Q32',
    category: 'ambiguous',
    question: 'How fast is the system?',
    expectedAnswer:
      'System speed depends on the component and region: In us-east-1, vector retrieval p50 is 42ms and p99 is 112ms (MV-DOC-06), while the operational SLA mandates p99 retrieval < 150ms and initial token dispatch < 2000ms (MV-DOC-03).',
    supportingDocIds: ['MV-DOC-03', 'MV-DOC-06'],
    supportingEvidenceSnippets: [
      'In us-east-1, p50 retrieval is 42ms and p99 is 112ms, yielding the highest throughput at 850 QPS.',
      'SLA mandates p99 retrieval latency < 150ms and initial token dispatched < 2000ms.',
    ],
    difficulty: 'Hard',
    answerability: 'Ambiguous',
  },
  {
    id: 'EVAL-Q33',
    category: 'ambiguous',
    question: 'What does the worker do when an error occurs?',
    expectedAnswer:
      'The behavior depends on the type of error: An extractor error marks the document FAILED with an errorMessage in PostgreSQL (MV-DOC-05); a queue timeout triggers 3 retries then moves the job to the dead-letter queue (DLQ) (MV-DOC-03).',
    supportingDocIds: ['MV-DOC-03', 'MV-DOC-05'],
    supportingEvidenceSnippets: [
      'Extractor error marks document FAILED with errorMessage in PostgreSQL documents table.',
      'Queue timeout triggers 3 retries then DLQ.',
    ],
    difficulty: 'Hard',
    answerability: 'Ambiguous',
  },
  {
    id: 'EVAL-Q34',
    category: 'ambiguous',
    question: 'What permissions does an admin have?',
    expectedAnswer:
      'The permissions depend on the admin role: A Workspace Admin is scoped strictly to tenant assets (document uploads, user invites, API keys), whereas a Platform Superadmin oversees physical infrastructure and cluster nodes (MV-DOC-02).',
    supportingDocIds: ['MV-DOC-02'],
    supportingEvidenceSnippets: [
      'Workspace Admin is scoped strictly to tenant assets including document uploads, user invites, and API keys. Platform Superadmin oversees physical infrastructure and cluster nodes.',
    ],
    difficulty: 'Hard',
    answerability: 'Ambiguous',
  },
  {
    id: 'EVAL-Q35',
    category: 'ambiguous',
    question: 'Can I upload a spreadsheet?',
    expectedAnswer:
      'Raw spreadsheet formats such as CSV or Excel are rejected by the upload API; however, tabular spreadsheet data can be uploaded if formatted as a Markdown table (.md) (MV-DOC-04).',
    supportingDocIds: ['MV-DOC-04'],
    supportingEvidenceSnippets: [
      'Supported extensions: .pdf, .docx, .txt, .md. Spreadsheets must be converted to Markdown tables.',
    ],
    difficulty: 'Medium',
    answerability: 'Ambiguous',
  },
  {
    id: 'EVAL-Q36',
    category: 'ambiguous',
    question: 'What happens when token limits are reached?',
    expectedAnswer:
      'The outcome depends on which limit is reached: Exceeding user API rate limits returns HTTP 429 Too Many Requests (MV-DOC-02, MV-DOC-04); exceeding prompt context tokens causes ContextAssembler to drop low-ranked chunks according to the 75% narrative floor and 25% graph ceiling policy (MV-DOC-04).',
    supportingDocIds: ['MV-DOC-02', 'MV-DOC-04'],
    supportingEvidenceSnippets: [
      'Rate limit excess yields 429 Too Many Requests.',
      'ContextAssembler drops chunks exceeding maxContextTokens according to the 75% narrative floor and 25% graph ceiling policy.',
    ],
    difficulty: 'Hard',
    answerability: 'Ambiguous',
  },
];
