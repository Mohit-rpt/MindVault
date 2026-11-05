# MindVault — Implementation Roadmap

**Project Name:** MindVault  
**Status:** In Progress — Phase 0  
**Version:** 1.0  
**Last Updated:** Phase 0 Kickoff

---

## Overview

This roadmap defines the sequential development phases of **MindVault**, from initial foundation to full production deployment. MindVault follows a disciplined, phase-based engineering workflow where each phase must satisfy concrete acceptance criteria, pass automated tests, and maintain an operable application before subsequent phases commence.

---

## Phase Matrix

| Phase       | Title                          | Focus Area                                                    | Completion Criteria                                                      | Status          |
| ----------- | ------------------------------ | ------------------------------------------------------------- | ------------------------------------------------------------------------ | --------------- |
| **Phase 0** | **Project Foundation**         | Monorepo, tooling, base skeletons, infrastructure definitions | Dev/build scripts pass, health endpoint active, docker definitions ready | **IN PROGRESS** |
| **Phase 1** | **Authentication & Workspace** | User identity, sessions, workspace isolation                  | Users can register, log in, manage workspaces with access control        | Planned         |
| **Phase 2** | **Document Ingestion**         | Upload pipeline, storage, text extraction, chunking           | PDF/TXT/MD uploaded, validated, parsed into structured chunks            | Planned         |
| **Phase 3** | **Embeddings & Vector Search** | Vector models, pgvector indexing, similarity retrieval        | Chunks embedded, indexed in pgvector, retrieved via cosine similarity    | Planned         |
| **Phase 4** | **Basic RAG Chat**             | Context construction, LLM generation, citation linking        | Evidence-grounded answers with verifiable citations                      | Planned         |
| **Phase 5** | **Advanced Retrieval**         | Hybrid search (vector + BM25/FTS), RRF, reranking             | Measurable NDCG and Recall improvement over vector baseline              | Planned         |
| **Phase 6** | **Knowledge Graph**            | Entity/relationship extraction, graph storage & traversal     | Concept relationships queryable alongside vector retrieval               | Planned         |
| **Phase 7** | **Multimodal Intelligence**    | OCR, scanned documents, image context, table parsing          | Non-text documents extracted and integrated into search index            | Planned         |
| **Phase 8** | **Memory & Agentic Workflows** | Episodic/semantic memory, research planner, verification      | Multi-step research workflows with grounded memory updates               | Planned         |
| **Phase 9** | **Evaluation & Production**    | Benchmarking, security hardening, monitoring, deployment      | Automated RAG evaluation suite, hardened API, production deploy          | Planned         |

---

## Detailed Phase Breakdown

### Phase 0: Project Foundation (Current)

- Monorepo setup using `pnpm` workspaces (`apps/web`, `apps/api`, `apps/worker`, `packages/shared`, `packages/config`).
- Root configuration: TypeScript strict mode, ESLint, Prettier, Vitest.
- `apps/web`: React + Vite + TypeScript + Tailwind CSS initial shell.
- `apps/api`: Node.js + Express + TypeScript skeleton, Zod environment validation, `/api/health` endpoint, centralized error handling, graceful shutdown.
- `apps/worker`: Node.js + TypeScript worker skeleton, structured logging, graceful lifecycle hooks.
- Infrastructure: `docker-compose.yml` with PostgreSQL (pgvector extension) and Redis.
- Documentation: `README.md`, `docs/DEVELOPMENT.md`, `docs/ARCHITECTURE_DECISIONS.md`.

### Phase 1: Authentication & Workspace

- User model and authentication (bcrypt/Argon2 password hashing, secure JWT/session cookies).
- Workspace creation, membership roles, and strict workspace-level data isolation.
- Prisma schema setup and baseline relational migrations.

### Phase 2: Document Ingestion Pipeline

- Document upload API with MIME type validation and file size constraints.
- Secure local/object storage persistence.
- Extraction handlers for PDF, TXT, and Markdown.
- Semantic and structure-aware chunking with metadata preservation (page numbers, section headers).
- BullMQ asynchronous ingestion jobs with retry logic.

### Phase 3: Embeddings & Vector Search

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
