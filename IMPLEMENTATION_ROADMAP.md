# MindVault — Implementation Roadmap

**Project Name:** MindVault  
**Status:** Phase 2 Completed  
**Version:** 1.2  
**Last Updated:** Phase 2 Completion

---

## Overview

This roadmap defines the sequential development phases of **MindVault**, from initial foundation to full production deployment. MindVault follows a disciplined, phase-based engineering workflow where each phase must satisfy concrete acceptance criteria, pass automated tests, and maintain an operable application before subsequent phases commence.

---

## Phase Matrix

| Phase       | Title                          | Focus Area                                                    | Completion Criteria                                                       | Status        |
| ----------- | ------------------------------ | ------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------- |
| **Phase 0** | **Project Foundation**         | Monorepo, tooling, base skeletons, infrastructure definitions | Dev/build scripts pass, health endpoint active, docker definitions ready  | **COMPLETED** |
| **Phase 1** | **Authentication & Workspace** | User identity, sessions, workspace isolation                  | Users can register, log in, manage workspaces with access control         | **COMPLETED** |
| **Phase 2** | **Document Ingestion**         | Upload pipeline, storage, text extraction, chunking, vectors  | Multi-format ingestion, 768-dim embeddings, pgvector storage, async queue | **COMPLETED** |
| **Phase 3** | **Retrieval Engine & Search**  | Vector models, pgvector indexing, similarity retrieval        | Chunks embedded, indexed in pgvector, retrieved via cosine similarity     | **UPCOMING**  |
| **Phase 4** | **Basic RAG Chat**             | Context construction, LLM generation, citation linking        | Evidence-grounded answers with verifiable citations                       | Planned       |
| **Phase 5** | **Advanced Retrieval**         | Hybrid search (vector + BM25/FTS), RRF, reranking             | Measurable NDCG and Recall improvement over vector baseline               | Planned       |
| **Phase 6** | **Knowledge Graph**            | Entity/relationship extraction, graph storage & traversal     | Concept relationships queryable alongside vector retrieval                | Planned       |
| **Phase 7** | **Multimodal Intelligence**    | OCR, scanned documents, image context, table parsing          | Non-text documents extracted and integrated into search index             | Planned       |
| **Phase 8** | **Memory & Agentic Workflows** | Episodic/semantic memory, research planner, verification      | Multi-step research workflows with grounded memory updates                | Planned       |
| **Phase 9** | **Evaluation & Production**    | Benchmarking, security hardening, monitoring, deployment      | Automated RAG evaluation suite, hardened API, production deploy           | Planned       |

---

## Detailed Phase Breakdown

### Phase 0: Project Foundation (Completed)

- Monorepo setup using `pnpm` workspaces (`apps/web`, `apps/api`, `apps/worker`, `packages/shared`, `packages/config`).
- Root configuration: TypeScript strict mode, ESLint, Prettier, Vitest.
- `apps/web`: React + Vite + TypeScript + Tailwind CSS initial shell.
- `apps/api`: Node.js + Express + TypeScript skeleton, Zod environment validation, `/api/health` endpoint, centralized error handling, graceful shutdown.
- `apps/worker`: Node.js + TypeScript worker skeleton, structured logging, graceful lifecycle hooks.
- Infrastructure: `docker-compose.yml` with PostgreSQL (pgvector extension) and Redis.
- Documentation: `README.md`, `docs/DEVELOPMENT.md`, `docs/ARCHITECTURE_DECISIONS.md`.

### Phase 1: Authentication & Workspace (Completed)

- Prisma schema models: `User`, `Workspace`, `WorkspaceMember`, `Session` with proper foreign keys, cascades, and compound indexes.
- Password hashing using Argon2id (64MB memory cost, 3 iterations, 4 parallelism lanes).
- Dual-token session management: short-lived JWT access tokens + rotating refresh tokens.
- Secure, HttpOnly, SameSite cookies for refresh tokens; SHA-256 token hashing in database.
- Token Family Revocation upon reuse detection to mitigate token theft.
- Hierarchical Role-Based Access Control (`OWNER` > `ADMIN` > `MEMBER`) with `authorizeWorkspace` middleware.
- Full workspace isolation preventing cross-tenant Insecure Direct Object References (IDOR).
- React frontend shell with AuthContext, Login, Register, Workspace switcher, and active sessions dashboard.
- 25 automated unit and integration tests passing across all packages.

### Phase 2: Document Ingestion Pipeline & Vector Knowledge Storage (Completed)

- Secure multipart upload API with file signature / magic byte inspection, 25MB limits, and SHA-256 deduplication.
- Document storage abstraction with path traversal defenses (`LocalFileSystemStorageProvider`, `InMemoryStorageProvider`).
- Multi-format extraction engine for PDF (%PDF validation, scanned PDF detection), DOCX (PK ZIP validation), TXT (binary null byte detection), and Markdown (frontmatter parsing).
- Text normalization pipeline (Unicode NFC, CRLF to LF, non-printable control character removal, markdown structure retention).
- Intelligent structure-aware chunking engine (target 700 tokens, max 900 tokens, 120 tokens overlap) with heading hierarchy preservation and word-level sentence splitting fallbacks.
- Provider-agnostic embedding engine with local Ollama integration (`nomic-embed-text`, 768 dimensions) and deterministic `MockEmbeddingProvider`.
- PostgreSQL vector storage schema in `DocumentChunk` with `vector(768)` and HNSW cosine distance index (`vector_cosine_ops`).
- BullMQ + Redis asynchronous worker processing 8 lifecycle stages (`UPLOADED` -> `QUEUED` -> `PROCESSING` -> `EXTRACTING` -> `NORMALIZING` -> `CHUNKING` -> `EMBEDDING` -> `STORING` -> `COMPLETED`/`FAILED`).
- Document Management REST API (`POST /upload`, `GET /`, `GET /:id`, `GET /:id/status`, `GET /:id/download`, `DELETE /:id`) with strict workspace isolation and IDOR defenses.
- Document Library React frontend with drag-and-drop uploader, live polling for processing documents, filter tabs, metadata inspector, and download/delete controls.
- 80 automated unit, integration, and security tests passing across all packages.

### Phase 3: Embeddings & Vector Search (Upcoming)

- AI provider abstraction interface (`EmbeddingProvider`).
- Local embedding integration (Ollama / `nomic-embed-text` / `bge-m3`) and hosted fallback options.
- pgvector HNSW/IVFFlat index creation and cosine similarity queries.
- Workspace-scoped vector search queries.

### Phase 4: Basic RAG Chat

- AI chat interface with streaming message delivery (SSE / WebSockets).
- RAG Orchestrator: query processing → vector retrieval → context assembly → LLM prompt.
- LLM Provider adapter (Ollama / OpenAI-compatible).
- Citation generation and evidence verification engine.
- Conversation history and persistence.

### Phase 5: Advanced Retrieval & Reranking

- PostgreSQL Full-Text Search (tsvector/tsquery) integration.
- Reciprocal Rank Fusion (RRF) for hybrid keyword + vector retrieval.
- Query rewriting and expansion.
- Cross-encoder reranking pass.
- Retrieval benchmark dataset and evaluation harness.

### Phase 6: Knowledge Graph

- Entity and relationship extraction from document chunks.
- Graph relational schema in PostgreSQL (entities, relations, evidence pointers).
- Graph traversal queries and hybrid graph-vector retrieval.

### Phase 7: Multimodal Intelligence

- OCR pipeline for scanned PDFs and image files.
- Table extraction and structured data representation.
- Multimodal embedding integration.

### Phase 8: Memory & Agentic Workflows

- Episodic and semantic user memory storage with confidence scores and provenance.
- Query planner and research agent with permissioned tool calls.
- Groundedness verification agent.

### Phase 9: Evaluation, Hardening & Deployment

- RAG evaluation benchmarks (Faithfulness, Relevance, Citation Accuracy, Recall@K).
- Security audits, rate limiting, and prompt injection defenses.
- Production containerization and deployment guide.
