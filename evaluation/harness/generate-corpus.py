import os

class SimplePDFBuilder:
    def __init__(self):
        self.pages = []  # list of list of strings (lines)

    def add_page(self, lines):
        self.pages.append(lines)

    def build_bytes(self):
        # PDF 1.4 minimal binary writer
        # Objects:
        # 1: Catalog
        # 2: Pages root
        # For each page i (0..N-1):
        #   obj 3 + 2*i: Page object
        #   obj 4 + 2*i: Contents stream
        # obj 3 + 2*N: Font Helvetica
        num_pages = len(self.pages)
        font_obj_id = 3 + 2 * num_pages
        
        objects = {}
        # 1: Catalog
        objects[1] = b'<< /Type /Catalog /Pages 2 0 R >>'
        
        # 2: Pages root
        kids = ' '.join([f'{3 + 2*i} 0 R' for i in range(num_pages)])
        objects[2] = f'<< /Type /Pages /Kids [{kids}] /Count {num_pages} >>'.encode('latin1')
        
        for i, page_lines in enumerate(self.pages):
            page_obj_id = 3 + 2 * i
            content_obj_id = 4 + 2 * i
            
            # Build content stream
            # 50 750 Td, line height 14, font size 11
            stream_parts = ['BT /F1 11 Tf 50 750 Td 14 TL\n']
            for line in page_lines:
                escaped = line.replace('\\', '\\\\').replace('(', '\\(').replace(')', '\\)')
                stream_parts.append(f'({escaped}) \'\n')
            stream_parts.append('ET\n')
            stream_content = ''.join(stream_parts).encode('latin1', errors='replace')
            
            objects[page_obj_id] = f'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents {content_obj_id} 0 R /Resources << /Font << /F1 {font_obj_id} 0 R >> >> >>'.encode('latin1')
            objects[content_obj_id] = f'<< /Length {len(stream_content)} >>\nstream\n'.encode('latin1') + stream_content + b'\nendstream'
            
        objects[font_obj_id] = b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
        
        total_objs = font_obj_id
        out = b'%PDF-1.4\n'
        offsets = {}
        for obj_id in range(1, total_objs + 1):
            offsets[obj_id] = len(out)
            out += f'{obj_id} 0 obj\n'.encode('latin1') + objects[obj_id] + b'\nendobj\n'
            
        xref_offset = len(out)
        out += f'xref\n0 {total_objs + 1}\n0000000000 65535 f \n'.encode('latin1')
        for obj_id in range(1, total_objs + 1):
            out += f'{offsets[obj_id]:010d} 00000 n \n'.encode('latin1')
            
        out += f'trailer\n<< /Size {total_objs + 1} /Root 1 0 R >>\nstartxref\n{xref_offset}\n%%EOF'.encode('latin1')
        return out


def generate_corpus(corpus_dir):
    os.makedirs(corpus_dir, exist_ok=True)
    
    # -------------------------------------------------------------
    # MV-DOC-01.pdf: Distributed Cloud Storage & Sharding Architecture
    # -------------------------------------------------------------
    doc1 = SimplePDFBuilder()
    doc1.add_page([
        "MindVault Architecture Specification: Distributed Cloud Storage and Sharding",
        "Document Identifier: MV-DOC-01 | Version: 2.4 | Classification: Technical Core",
        "==========================================================================",
        "",
        "Section 1: Multi-Zone Replication and Quorum Management",
        "The storage subsystem implements distributed active-passive chunk replication across three",
        "availability zones. Cross-zone consistency utilizes a quorum policy where write acknowledgments",
        "require W=2 confirmation out of N=3 replicas. Read operations enforce R=2 consensus before returning.",
        "Data blocks are partitioned using consistent hash rings to balance IO load.",
        "",
        "Section 2: Chunk Hashing and Cryptographic Integrity",
        "Every stored chunk is validated using a deterministic SHA-256 hash digest. Chunk address verification",
        "ensures that chunk content is not tampered with at rest. When paragraphs exceed targetTokens (700),",
        "recursive boundary decomposition splits on sentence punctuation with 120-token overlap, up to a",
        "hard ceiling of maxTokens (900).",
        "",
        "Section 3: Raft Consensus Leases and Heartbeats",
        "Leader election leases are renewed via periodic heartbeats set to 1500ms intervals. If the active leader",
        "fails to emit a heartbeat within this lease window, candidate nodes trigger an election protocol.",
        "Data encryption at rest employs AES-256-GCM authenticated encryption for all persistent block stores.",
        "",
        "Section 4: Subsystem Dependencies and Revocation Cascades",
        "The Hybrid Retrieval Engine queries Vector Search Index directly. The Incident Health Daemon monitors",
        "replication lag across all shard leaders. Revocation of tenant master keys disables document decryption,",
        "the embedding pipeline, and context assembly."
    ])
    with open(os.path.join(corpus_dir, "MV-DOC-01.pdf"), "wb") as f:
        f.write(doc1.build_bytes())

    # -------------------------------------------------------------
    # MV-DOC-02.pdf: Enterprise Zero-Trust Security & Identity Policy
    # -------------------------------------------------------------
    doc2 = SimplePDFBuilder()
    doc2.add_page([
        "MindVault Security Policy: Enterprise Zero-Trust and Identity Governance",
        "Document Identifier: MV-DOC-02 | Version: 3.1 | Classification: Security Directive",
        "==========================================================================",
        "",
        "Section 1: Authentication Gateway and Token Lifecycle",
        "Authentication filter executes prior to rate limiter. Missing Bearer token results in immediate 401 Unauthorized.",
        "User access JWT tokens have a strict time-to-live (TTL) of 15 minutes. Refresh tokens rotate every 7 days.",
        "Session authentication utilizes write-through caching; Redis failure triggers failover to PostgreSQL session backup table.",
        "",
        "Section 2: Horizontal Multi-Tenant Isolation",
        "Horizontal tenant isolation is cryptographically guaranteed by scoping every database predicate to the",
        "verified workspaceId extracted from the signed token. RBAC links User via WorkspaceRole to Workspace, gating all",
        "child Document and DocumentChunk records. Users cannot query assets belonging to foreign workspaces.",
        "",
        "Section 3: Rate Limiting Boundaries and Governance",
        "API rate limiting tiers: Free tier permits up to 100 req/min; Enterprise tier allows up to 1000 req/min before",
        "returning HTTP 429 Too Many Requests.",
        "",
        "Section 4: Role Hierarchy and Cryptographic Authority",
        "Workspace Admin is scoped strictly to tenant assets including document uploads, user invites, and API keys.",
        "Platform Superadmin oversees physical infrastructure and cluster nodes. Tenant encryption key rotation requires",
        "Security Incident Officer role; Tier-1 on-call personnel do not possess key rotation authority."
    ])
    with open(os.path.join(corpus_dir, "MV-DOC-02.pdf"), "wb") as f:
        f.write(doc2.build_bytes())

    # -------------------------------------------------------------
    # MV-DOC-03.pdf: Production Operations & Disaster Recovery Runbook
    # -------------------------------------------------------------
    doc3 = SimplePDFBuilder()
    doc3.add_page([
        "MindVault Operations Runbook: Incident Management and Disaster Recovery",
        "Document Identifier: MV-DOC-03 | Version: 4.0 | Classification: Operational Runbook",
        "==========================================================================",
        "",
        "Section 1: Incident Severity Definitions",
        "Incidents are classified into four tiers: Sev-1 (Complete cluster degradation or data unavailability),",
        "Sev-2 (Major performance degradation exceeding SLA), Sev-3 (Non-blocking component failure), and Sev-4 (Inquiry).",
        "Tier-1 on-call manages Sev-1 triage and coordinates emergency operational response.",
        "",
        "Section 2: Disaster Recovery Objectives and Failover Triggers",
        "Disaster Recovery Target: Recovery Point Objective (RPO) < 1 minute; Recovery Time Objective (RTO) < 15 minutes.",
        "Automatic primary failover engages when replica lag exceeds 5000ms. If primary database becomes unresponsive,",
        "health probes initiate automatic promotion of the hot standby replica.",
        "",
        "Section 3: Service Level Agreements (SLAs)",
        "SLA mandates p99 retrieval latency < 150ms and initial token dispatched < 2000ms. If retrieval exceeds",
        "the 150ms boundary, alerts trigger priority auto-scaling.",
        "",
        "Section 4: Ingestion Pipeline Queues and Dead-Letter Policies",
        "Queue timeout triggers 3 retries then DLQ. Status COMPLETED triggers NotificationService WebSocket and schedules",
        "GraphExtractionTask for background entity resolution."
    ])
    with open(os.path.join(corpus_dir, "MV-DOC-03.pdf"), "wb") as f:
        f.write(doc3.build_bytes())

    # -------------------------------------------------------------
    # MV-DOC-04.pdf: API Gateway Routing & SSE Protocol Specification
    # -------------------------------------------------------------
    doc4 = SimplePDFBuilder()
    doc4.add_page([
        "MindVault Protocol Specification: API Gateway Routing and Server-Sent Events",
        "Document Identifier: MV-DOC-04 | Version: 1.8 | Classification: Integration Protocol",
        "==========================================================================",
        "",
        "Section 1: Gateway Routing Architecture and Endpoints",
        "The gateway dispatches incoming POST /api/rag/stream requests to RAGService. RAGService triggers RetrievalService",
        "on PostgreSQL document_chunks using hybrid vector and keyword channels. SSE stream lifecycle emits standard events:",
        "start -> retrieval_complete -> sources -> token* -> validation -> done.",
        "",
        "Section 2: Connection Heartbeat and Abort Lifecycle",
        "The gateway dispatches a comment heartbeat (: ping) every 15 seconds to prevent intermediate proxy timeout.",
        "Client socket termination propagates an AbortSignal, terminating upstream LLM generators and marking the record CANCELLED.",
        "",
        "Section 3: Error Envelopes and Ingestion Format Boundaries",
        "Supported extensions: .pdf, .docx, .txt, .md. Spreadsheets must be converted to Markdown tables.",
        "Error event envelope emits code FILE_TOO_LARGE and transitions document to FAILED when payload exceeds 25MB boundary.",
        "",
        "Section 4: Context Assembly Dual Budgeting Limits",
        "Rate limit excess yields 429 Too Many Requests. ContextAssembler drops chunks exceeding maxContextTokens according to",
        "the 75% narrative floor and 25% graph ceiling policy. Chunks that do not fit within the token budget are omitted."
    ])
    with open(os.path.join(corpus_dir, "MV-DOC-04.pdf"), "wb") as f:
        f.write(doc4.build_bytes())

    # -------------------------------------------------------------
    # MV-DOC-05.pdf: Service Configuration Reference & Infrastructure Directives
    # -------------------------------------------------------------
    doc5 = SimplePDFBuilder()
    doc5.add_page([
        "MindVault Configuration Reference: Infrastructure Environment Directives",
        "Document Identifier: MV-DOC-05 | Version: 2.1 | Classification: Systems Architecture",
        "==========================================================================",
        "",
        "Section 1: Database and Pool Connection Bounds",
        "DB_POOL_MAX=20 # Maximum concurrent connections per API gateway instance",
        "DB_TIMEOUT_MS=5000 # Database query execution timeout in milliseconds",
        "WORKER_CONCURRENCY=5 # Concurrent background jobs processed per worker node",
        "",
        "Section 2: Document Payload Boundaries and Extractor Handling",
        "MAX_FILE_SIZE_BYTES=26214400 # 25 Megabytes absolute payload boundary",
        "Extractor error marks document FAILED with errorMessage in PostgreSQL documents table.",
        "",
        "Section 3: Knowledge Graph Traversal Timeouts and Loop Guards",
        "GRAPH_TIMEOUT_MS=2500 and visited set evaluation prevent cyclic loops during multi-hop path traversal.",
        "Multi-hop queries abort after 2500ms to preserve generation response budgets.",
        "",
        "Section 4: Retrieval Channel Weights and Thresholds",
        "SIMILARITY_FLOOR=0.65 # Minimum cosine similarity required for vector chunk survival",
        "FTS_WEIGHT=1.0 # Multiplier weight for PostgreSQL full-text search channel"
    ])
    with open(os.path.join(corpus_dir, "MV-DOC-05.pdf"), "wb") as f:
        f.write(doc5.build_bytes())

    # -------------------------------------------------------------
    # MV-DOC-06.md: Quarterly Infrastructure Latency & Benchmark Metrics Table
    # -------------------------------------------------------------
    doc6_content = """# MindVault Infrastructure Benchmark Report (Q3-2026)
**Document Identifier:** MV-DOC-06 | **Type:** Tabular Metrics Benchmark | **Format:** Markdown Table

## 1. Regional Retrieval Performance and Cost Metrics

The following empirical benchmark measurements were gathered across 5 global deployment regions using synthetic production query workloads on HNSW vector indexes:

| Region | Provider | Index Type | Vector Search p50 (ms) | Vector Search p95 (ms) | Vector Search p99 (ms) | Compute Cost / 10k Qs ($) | Max QPS |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `us-east-1` | AWS | HNSW | 42 | 86 | 112 | 0.015 | 850 |
| `us-west-2` | AWS | HNSW | 48 | 94 | 126 | 0.016 | 780 |
| `eu-west-1` | AWS | HNSW | 55 | 102 | 138 | 0.012 | 710 |
| `ap-southeast-1` | AWS | HNSW | 74 | 134 | 168 | 0.018 | 620 |
| `sa-east-1` | AWS | HNSW | 92 | 165 | 210 | 0.022 | 490 |

## 2. Benchmark Observations & SLA Conformance Analysis
- **Latency SLA Compliance:** The operational SLA mandates p99 retrieval latency < 150ms. Regions `us-east-1` (112ms), `us-west-2` (126ms), and `eu-west-1` (138ms) satisfy the SLA. Regions `ap-southeast-1` (168ms) and `sa-east-1` (210ms) fail the SLA.
- **Cost Efficiency Evaluation:** Region `eu-west-1` meets the p99 SLA (< 150ms at 138ms) while having the lowest compute cost at $0.012 per 10k queries.
- **Fastest Regional Profile:** In `us-east-1`, p50 retrieval is 42ms and p99 is 112ms, yielding the highest throughput at 850 QPS.
"""
    with open(os.path.join(corpus_dir, "MV-DOC-06.md"), "w", encoding="utf-8") as f:
        f.write(doc6_content)

    print(f"Corpus successfully generated in {corpus_dir}")

if __name__ == "__main__":
    generate_corpus("evaluation/corpus")
