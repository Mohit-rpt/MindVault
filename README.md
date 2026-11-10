# MindVault

> **AI-Powered Personal Knowledge Operating System**  
> _Transform disconnected documents, technical specifications, and research into an interconnected, evidence-grounded intelligence platform._

---

## 1. Project Overview

MindVault is not a generic chatbot wrapper over uploaded files. It is an **AI-powered personal knowledge operating system** built with TypeScript, React, Node.js, PostgreSQL (`pgvector`), and Redis. It ingests multi-format technical documents, normalizes and embeds them with structural heading awareness, fuses semantic vector and full-text keyword retrieval using **Three-Way Reciprocal Rank Fusion ($k=60$)**, and constructs a verifiable **Knowledge Graph (GraphRAG)** with verbatim textual evidence.

Every synthesized answer is deterministically validated against retrieved source chunks to ensure **intellectual honesty, verifiable citation provenance, and zero hallucinated sources**.

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                                   CORE CAPABILITIES                                     │
├───────────────────────┬─────────────────────────────────────────────────────────────────┤
│ Multi-Format Pipeline │ Ingests PDF, DOCX, TXT, MD asynchronously via BullMQ workers    │
│ Hybrid Ranking & RRF  │ 3-way Reciprocal Rank Fusion: pgvector (768d) + FTS + Graph     │
│ Relational GraphRAG   │ Recursive SQL traversal across entities, relations & evidence   │
│ Grounding & Citations │ Fail-closed bracketed citations ([S1], [S2]) verified in chunks │
│ Bounded Chat Memory   │ Dual-tier memory (sliding turn window + rolling summaries)       │
│ Provider Agnostic     │ Local private Ollama (qwen3) + Cloud Google Gemini (Flash)      │
│ Tenant Isolation      │ Cryptographic workspace scoping enforced at the SQL query level │
│ Tested & Verified     │ 795 tests passing across 68 test files (100% pass rate)         │
└───────────────────────┴─────────────────────────────────────────────────────────────────┘
```

---

## 2. Key Features

- **Asynchronous Ingestion Pipeline:** Offloads heavy document parsing and embedding generation to background BullMQ workers with advisory locking, idempotency guarantees, and monotonic worker fencing.
- **Three-Way Hybrid Search ($k=60$):** Combines 768-dimensional dense vector embeddings (`pgvector` cosine distance) and PostgreSQL full-text search (`tsvector` with `ts_rank_cd`), augmented with entity neighborhood context.
- **GraphRAG Traversal Engine:** Extracts domain entities (technologies, concepts) and directed relationships with verbatim supporting text snippets. Resolves multi-hop dependencies across document boundaries with cycle detection and a 2500ms safety timeout.
- **Fail-Closed Citation Verification:** Analyzes generated LLM output for bracketed citation tags (`[S1]`, `[S2]`), validating each citation against retrieved chunk IDs. Accurately flags outputs as `GROUNDED`, `PARTIALLY_GROUNDED`, `INSUFFICIENT_EVIDENCE`, or `CITATION_INVALID`.
- **Bounded Conversational Memory:** Preserves multi-turn conversational context using a dual-tier architecture: recent conversational turns stay in an active window, while older context is compressed into rolling summaries ($\le 120$ words). Resolves pronouns, ellipticals, and demonstratives via `QueryContextService`.
- **Zero-Trust Multi-Tenancy:** Horizontal workspace isolation enforced directly in SQL predicates (`WHERE c."workspaceId" = $1`), preventing cross-tenant data leakage or IDOR vulnerabilities.
- **Reproducible Demo & Preflight System:** Includes a deterministic database seed system (`pnpm db:seed`), a zero-dependency preflight diagnostic CLI (`pnpm demo:check`), and a comprehensive [Presenter Walkthrough Guide](docs/DEMO_WALKTHROUGH.md).

---

## 3. Architecture Overview

MindVault follows a clean, decoupled monorepo architecture separating the user interface, API gateway, background workers, and persistent data engines.

```mermaid
flowchart TD
    subgraph Client ["Client Layer"]
        Web["Web Frontend (React 18 + Vite)"]
    end

    subgraph API ["API Gateway Layer (Express / Port 4000)"]
        AuthMid["Auth & RBAC Middleware"]
        DocRoutes["Document Routes"]
        RetRoutes["Retrieval Routes"]
        RAGRoutes["RAG & SSE Stream Routes"]
        ConvRoutes["Conversation Routes"]
        GraphRoutes["Knowledge Graph Routes"]
    end

    subgraph Core ["Intelligence & Orchestration"]
        RRF["3-Way Hybrid Fusion (RRF k=60)"]
        GraphRAG["GraphRAG Traversal Engine"]
        ContextAssm["Context Assembler (75/25 Budget)"]
        CitationVal["Bracketed Citation Validator"]
    end

    subgraph WorkerLayer ["Async Background Worker (BullMQ)"]
        IngestWorker["Ingestion Pipeline (PDF/DOCX/TXT/MD)"]
        GraphWorker["Graph Extraction Worker (Advisory Locks)"]
        Reconcile["Graph Reconciliation Service"]
    end

    subgraph Storage ["Infrastructure & Persistence"]
        Postgres[("PostgreSQL 16 + pgvector")]
        RedisDB[("Redis 7 (Queues & Session Cache)")]
        DiskStorage[("Physical File Storage")]
    end

    subgraph Providers ["AI Provider Adapters"]
        OllamaLocal["Local Ollama (qwen3:0.6b / nomic-embed-text)"]
        GeminiCloud["Cloud Google Gemini (gemini-3.5-flash)"]
    end

    Web --> AuthMid
    AuthMid --> DocRoutes & RetRoutes & RAGRoutes & ConvRoutes & GraphRoutes
    DocRoutes --> RedisDB
    DocRoutes --> DiskStorage
    RedisDB --> IngestWorker & GraphWorker
    IngestWorker --> DiskStorage & Postgres
    GraphWorker --> Postgres
    RetRoutes & RAGRoutes & ConvRoutes --> RRF & GraphRAG
    RRF & GraphRAG --> ContextAssm
    ContextAssm --> Providers
    Providers --> CitationVal
    CitationVal --> Web
    RRF --> Postgres
    GraphRAG --> Postgres
```

### Communication Flow

1. **Document Ingestion:** The client uploads a document to `/api/documents/upload`. The API verifies magic bytes, computes a SHA-256 checksum, saves the file to disk storage, creates a database record, and dispatches a job to BullMQ. The worker extracts text, chunks content with heading awareness, generates embeddings, extracts graph entities, and commits all assets to PostgreSQL.
2. **Retrieval & RAG:** When a user queries `/api/rag/stream` or `/api/conversations/:id/messages/stream`, `QueryContextService` resolves conversational references, executes parallel vector and keyword queries, traverses the knowledge graph, and fuses candidate chunks using Reciprocal Rank Fusion ($k=60$).
3. **Synthesis & Grounding:** `ContextAssembler` allocates tokens (75% narrative floor, 25% graph ceiling), packages the context within strict delimiters (`=== BEGIN UNTRUSTED RETRIEVED CONTEXT ===`), and streams tokens to the client via Server-Sent Events (SSE). The citation validator checks citations before finalizing the stream.

---

## 4. Technology Stack

| Layer                        | Technologies                                                 | Purpose                                                               |
| :--------------------------- | :----------------------------------------------------------- | :-------------------------------------------------------------------- |
| **Frontend Web**             | React 18, TypeScript, Vite, Tailwind CSS, Lucide Icons       | Responsive dashboard with Warm Cream and Dark Graphite themes         |
| **Backend API Gateway**      | Node.js, Express, TypeScript (Strict Mode), Zod              | Validated REST and SSE streaming endpoints                            |
| **Background Worker**        | Node.js, TypeScript, BullMQ 6.6, ioredis 6.0                 | Reliable asynchronous ingestion, graph extraction, and reconciliation |
| **Database & Vector Engine** | PostgreSQL 16, pgvector extension (`v0.8.7`), Prisma 6.2     | Relational schema, 768d dense vector HNSW cosine index, FTS GIN index |
| **Cache & Task Queues**      | Redis 7 (Alpine)                                             | Session storage, rate limiting, and BullMQ task queues                |
| **Local AI Provider**        | Ollama (`qwen3:0.6b`, `nomic-embed-text`)                    | 100% private, local generation and 768-dimensional embeddings         |
| **Cloud AI Provider**        | Google Gemini SDK (`@google/genai`, `gemini-3.5-flash`)      | Optional high-throughput cloud streaming provider                     |
| **Document Extractors**      | `pdf-parse` v2, `mammoth` (DOCX), native text/markdown       | Multi-format text and structure extraction                            |
| **Authentication & Crypto**  | Argon2id (`argon2` v0.41), HMAC-SHA256 JWT, HttpOnly Cookies | Zero-trust session management and token rotation                      |
| **Monorepo & Tooling**       | pnpm Workspaces, Vitest, ESLint, Prettier, Docker Compose    | Code quality, typecheck, linting, and containerization                |

---

## 5. Repository Structure

```
mindvault/
├── apps/
│   ├── web/                     # React 18 + TypeScript + Vite frontend application
│   ├── api/                     # Express + TypeScript core API gateway
│   └── worker/                  # BullMQ background job processing service
├── packages/
│   ├── shared/                  # Common TypeScript interfaces, DTOs, and schemas
│   └── config/                  # Shared tsconfig, ESLint, and Prettier configurations
├── prisma/
│   ├── schema.prisma            # Authoritative database schema definitions
│   ├── migrations/              # Tracked PostgreSQL migration history
│   ├── seed-data.ts             # Deterministic showcase workspace corpus & assets
│   └── seed.ts                  # Idempotent database seed execution script
├── infrastructure/
│   ├── docker/                  # Database container init scripts
│   └── storage/documents/       # Physical storage directory for uploaded files
├── evaluation/
│   ├── corpus/                  # Authoritative evaluation technical corpus (MV-DOC-*.md)
│   └── harness/                 # Benchmark harnesses and quantitative test runners
├── scripts/
│   └── verify-demo-environment.ts # Zero-dependency preflight service readiness CLI
├── tests/                       # Monorepo unit and integration test suites
├── docs/
│   ├── DEMO_WALKTHROUGH.md      # 10–15 minute presenter script & troubleshooting
│   ├── ARCHITECTURE_DECISIONS.md # Architectural Decision Records (ADRs)
│   └── DEVELOPMENT.md           # Developer onboarding guide
├── docker-compose.yml           # PostgreSQL (pgvector) and Redis container definitions
├── .env.example                 # Environment configuration template
├── package.json                 # Monorepo root workspace configuration
└── README.md                    # Project documentation
```

---

## 6. Quick Start & Demonstration Setup

Follow this sequence to set up MindVault in your local environment.

### Prerequisites

- **Node.js:** `v20.x` or `v22.x` LTS (`node -v`)
- **pnpm:** `v9.x`, `v10.x`, or `v12.x` (`npm install -g pnpm`)
- **Docker & Docker Compose:** Docker v24+ / Compose v2+
- **Git:** `v2.40+`

### Step 1: Clone and Install Dependencies

```bash
git clone https://github.com/mohitgoyal/MindVault.git
cd MindVault
pnpm install
```

### Step 2: Configure Environment Variables

```bash
# On Linux / macOS:
cp .env.example .env

# On Windows PowerShell:
Copy-Item .env.example .env
```

_Note on Database Ports:_ `docker-compose.yml` maps PostgreSQL to port `5432` (or port `5433` if 5432 is in use). Ensure `DATABASE_URL` in `.env` matches your mapped port:

```ini
DATABASE_URL=postgresql://mindvault:mindvault_dev_password@localhost:5432/mindvault?schema=public
```

### Step 3: Start Infrastructure Containers

```bash
pnpm docker:up
```

_Expected output:_ Containers `mindvault-postgres` and `mindvault-redis` are healthy.

### Step 4: Run Database Migrations

```bash
pnpm db:generate
pnpm db:migrate
```

_Expected output:_ `All migrations have been successfully applied.`

### Step 5: Seed the Showcase Workspace

Populate the database with the deterministic technical corpus (6 documents, unit vectors, 14 entities, 16 relations, and 2 chat sessions):

```bash
pnpm db:seed
```

_Expected output:_ `Showcase Workspace initialization completed successfully in ~1300ms.`

### Step 6: Verify Environment Readiness (Preflight CLI)

Run the automated preflight diagnostic utility to verify connectivity before starting:

```bash
pnpm demo:check
```

_Expected output:_

```
========================================================================
MindVault — Preflight Environment & Service Verification
========================================================================

[1. REQUIRED INFRASTRUCTURE]
  [ PASS ] PostgreSQL Database (latency < 300ms)
  [ PASS ] pgvector Extension (pgvector v0.8.7 active)
  [ PASS ] Redis Cache & Queue (responded to PING)

[2. AI PROVIDER READINESS]
  [ PASS ] Ollama Service (or Gemini Provider online)

[3. DEMO SEED DATA]
  [ PASS ] Showcase Workspace Seed (ws_demo_showcase_001 initialized)

========================================================================
RESULT: ENVIRONMENT FULLY READY (Exit Code: 0)
========================================================================
```

### Step 7: Start Development Services

Open three terminal windows and launch each service:

```bash
# Terminal 1 — Backend Express API (Port 4000)
pnpm dev:api

# Terminal 2 — Asynchronous Background Worker
pnpm dev:worker

# Terminal 3 — React Web Frontend (Port 5173)
pnpm dev:web
```

Open your browser to: **`http://localhost:5173`**.

### Demonstration Credentials

Sign in with the isolated showcase account:

- **Email:** `demo@mindvault.local`
- **Password:** `DemoPassword123!`

> [!NOTE]  
> These credentials access the isolated showcase workspace (`ws_demo_showcase_001`). For a guided 10–15 minute demonstration walkthrough with spoken scripts and test questions, see [`docs/DEMO_WALKTHROUGH.md`](docs/DEMO_WALKTHROUGH.md).

---

## 7. AI Provider Configuration

MindVault supports interchangeable local and cloud LLM providers:

### Local Ollama (Default Local Mode)

Provides 100% private, local inference without external API keys.

1. Install and start [Ollama](https://ollama.ai).
2. Pull the required models:
   ```bash
   # Primary RAG generation model
   ollama pull qwen3:0.6b

   # Dense embedding model (768 dimensions)
   ollama pull nomic-embed-text
   ```
3. Set in `.env`:
   ```ini
   LLM_PROVIDER=ollama
   OLLAMA_BASE_URL=http://localhost:11434
   OLLAMA_GENERATION_MODEL=qwen3:0.6b
   EMBEDDING_MODEL=nomic-embed-text
   ```

### Google Gemini (Cloud Streaming Mode)

Provides low-latency, high-throughput responses using Google's `@google/genai` SDK.

1. Obtain a Gemini API key from Google AI Studio.
2. Set in `.env`:
   ```ini
   LLM_PROVIDER=gemini
   GEMINI_API_KEY=your_gemini_api_key_here
   GEMINI_MODEL=gemini-3.5-flash
   ```

### Offline Demonstration Mode (Zero External AI)

If neither Ollama nor Gemini is running, MindVault remains **100% demonstrable in offline mode**. The pre-seeded showcase workspace contains pre-computed unit vectors, complete multi-turn conversation history with bracketed citations, and full knowledge graph topology. Presenters can explore the Document Library, Deep Search, Citation Panels, and Knowledge Graph without an active LLM.

---

## 8. Application Features & User Journey

MindVault features four primary application views:

```
┌──────────────────┬─────────────────────────────────────────────────────────────────┐
│ View             │ User Capabilities                                               │
├──────────────────┼─────────────────────────────────────────────────────────────────┤
│ AI Chat          │ Multi-turn conversation, streaming SSE tokens, interactive      │
│ Assistant        │ citations [S1], source inspection drawer, topic continuity      │
├──────────────────┼─────────────────────────────────────────────────────────────────┤
│ Knowledge        │ Multi-format file upload, async ingestion progress polling,     │
│ Documents        │ document details modal, metadata inspection, file download      │
├──────────────────┼─────────────────────────────────────────────────────────────────┤
│ Deep Vault       │ Direct search querying: Hybrid (RRF k=60), Semantic (pgvector), │
│ Search           │ or Keyword (FTS). Metadata filters and score breakdowns         │
├──────────────────┼─────────────────────────────────────────────────────────────────┤
│ Knowledge        │ Interactive HTML5 canvas rendering entities and directed edges, │
│ Graph            │ degree sizing, entity drawers, verbatim relation evidence       │
└──────────────────┴─────────────────────────────────────────────────────────────────┘
```

---

## 9. API Reference Catalog

All endpoints require authentication (Bearer token or cookie) and workspace authorization unless noted.

### Authentication & Sessions (`/api/auth`)

| Method   | Endpoint                 |  Auth  | Description                                                      |
| :------- | :----------------------- | :----: | :--------------------------------------------------------------- |
| `POST`   | `/api/auth/register`     |   No   | Registers user, creates initial workspace (`OWNER`), issues JWTs |
| `POST`   | `/api/auth/login`        |   No   | Validates Argon2id password, sets HttpOnly refresh cookie        |
| `POST`   | `/api/auth/refresh`      | Cookie | Rotates refresh token, detects token replay, issues fresh JWT    |
| `POST`   | `/api/auth/logout`       | Cookie | Revokes active session and clears auth cookies                   |
| `GET`    | `/api/auth/me`           | Bearer | Returns authenticated profile and workspace memberships          |
| `GET`    | `/api/auth/sessions`     | Bearer | Lists all active and historical sessions for user                |
| `DELETE` | `/api/auth/sessions/:id` | Bearer | Revokes a specific session by ID                                 |

### Workspaces (`/api/workspaces`)

| Method   | Endpoint              |   Role   | Description                                            |
| :------- | :-------------------- | :------: | :----------------------------------------------------- |
| `POST`   | `/api/workspaces`     |   Auth   | Creates a new workspace; creator designated as `OWNER` |
| `GET`    | `/api/workspaces`     |   Auth   | Lists all workspaces the authenticated user belongs to |
| `GET`    | `/api/workspaces/:id` | `MEMBER` | Retrieves workspace metadata and member roster         |
| `PATCH`  | `/api/workspaces/:id` | `ADMIN`  | Updates workspace configuration (name, settings)       |
| `DELETE` | `/api/workspaces/:id` | `OWNER`  | Deletes workspace and cascades all tenant data         |

### Document Library (`/api/documents`)

| Method   | Endpoint                      |   Role   | Description                                                        |
| :------- | :---------------------------- | :------: | :----------------------------------------------------------------- |
| `POST`   | `/api/documents/upload`       | `MEMBER` | Multipart upload (`.pdf`, `.docx`, `.txt`, `.md`), enqueues job    |
| `GET`    | `/api/documents`              | `MEMBER` | Lists workspace documents with pagination, search, status filter   |
| `GET`    | `/api/documents/:id`          | `MEMBER` | Retrieves document metadata, chunk count, and ingestion status     |
| `GET`    | `/api/documents/:id/status`   | `MEMBER` | Polls asynchronous processing state (`QUEUED`, `PROCESSING`)       |
| `GET`    | `/api/documents/:id/download` | `MEMBER` | Streams and downloads original file buffer with attachment headers |
| `DELETE` | `/api/documents/:id`          | `ADMIN`  | Cascades deletion of document, chunks, and physical storage        |

### Hybrid Retrieval (`/api/retrieval`)

| Method | Endpoint                |   Role   | Description                                                        |
| :----- | :---------------------- | :------: | :----------------------------------------------------------------- |
| `POST` | `/api/retrieval/search` | `MEMBER` | Multi-tenant hybrid search (vector + FTS + RRF $k=60$) with scores |

### Generative RAG (`/api/rag`)

| Method | Endpoint          |   Role   | Description                                                      |
| :----- | :---------------- | :------: | :--------------------------------------------------------------- |
| `POST` | `/api/rag/answer` | `MEMBER` | Synchronous grounded Q&A with validated citations and score      |
| `POST` | `/api/rag/stream` | `MEMBER` | SSE streaming answers with lifecycle events and disconnect abort |

### Conversational RAG (`/api/conversations`)

| Method   | Endpoint                                 |   Role   | Description                                                        |
| :------- | :--------------------------------------- | :------: | :----------------------------------------------------------------- |
| `POST`   | `/api/conversations`                     | `MEMBER` | Creates a new conversation session                                 |
| `GET`    | `/api/conversations`                     | `MEMBER` | Lists user conversations in workspace with pagination              |
| `GET`    | `/api/conversations/:id`                 | `MEMBER` | Retrieves conversation metadata and summary                        |
| `PATCH`  | `/api/conversations/:id`                 | `MEMBER` | Renames conversation title or updates status                       |
| `POST`   | `/api/conversations/:id/archive`         | `MEMBER` | Archives a conversation thread                                     |
| `DELETE` | `/api/conversations/:id`                 | `MEMBER` | Soft-deletes a conversation thread                                 |
| `GET`    | `/api/conversations/:id/messages`        | `MEMBER` | Retrieves conversation message history with citations              |
| `POST`   | `/api/conversations/:id/messages/stream` | `MEMBER` | SSE streaming multi-turn chat with bounded memory & abort handling |

### Knowledge Graph & GraphRAG (`/api/graph`)

| Method | Endpoint                               |   Role   | Description                                                 |
| :----- | :------------------------------------- | :------: | :---------------------------------------------------------- |
| `GET`  | `/api/graph/overview`                  | `MEMBER` | Workspace graph statistics and top connected hub entities   |
| `GET`  | `/api/graph/entities`                  | `MEMBER` | Searchable, paginated entity directory with type filters    |
| `GET`  | `/api/graph/entities/:id`              | `MEMBER` | Deep entity details, degree, aliases, and document mentions |
| `GET`  | `/api/graph/entities/:id/neighborhood` | `MEMBER` | Bounded subgraph centered at entity with configurable depth |
| `GET`  | `/api/graph/relations/:id/evidence`    | `MEMBER` | Verbatim supporting text snippets and document references   |
| `POST` | `/api/graph/paths`                     | `MEMBER` | Directed multi-hop path discovery between two entities      |

---

## 10. Knowledge Graph & GraphRAG

Traditional RAG flattens documents into isolated chunks. MindVault's GraphRAG engine models knowledge relationally:

1. **Entity Extraction & Normalization:** During document processing, entities (technologies, concepts, services) and directed relations are extracted. The `EntityNormalizer` handles case-folding, acronym expansion, and canonical alias unification.
2. **Verbatim Text Evidence:** Every relationship record (`GraphRelation`) links to a `RelationEvidence` record preserving the exact, unmodified sentence from the document that verified the relationship.
3. **Recursive SQL Traversal:** Graph traversal uses recursive Common Table Expressions (CTEs) in PostgreSQL to discover multi-hop paths up to depth $N$. Cycles are detected using visited-path arrays, and execution is bounded by `GRAPH_TIMEOUT_MS=2500`.
4. **Relational Context Assembly:** When querying the assistant, graph-discovered relationships augment vector-retrieved text chunks, allowing the LLM to understand dependencies that span multiple documents.

---

## 11. Evaluation & Empirical Benchmark Results

MindVault includes automated quantitative evaluation harnesses covering information retrieval, generative grounding, conversational memory, and knowledge graph traversal.

> [!NOTE]  
> These benchmarks are executed against the project's internal golden evaluation dataset (`evaluation/corpus/MV-DOC-*.md`) using isolated in-memory test databases and deterministic mock providers. They measure architectural precision and algorithm correctness, not third-party cloud service SLAs.

| Benchmark Evaluation                | Harness Script               | Metric                               |         Result         | Benchmark Context                                                                   |
| :---------------------------------- | :--------------------------- | :----------------------------------- | :--------------------: | :---------------------------------------------------------------------------------- |
| **Hybrid Retrieval (RRF $k=60$)**   | `pnpm retrieval:evaluate`    | Mean Reciprocal Rank (MRR)<br>nDCG@3 | **0.767**<br>**0.783** | Evaluated across 30 multi-turn technical queries combining pgvector and tsvector    |
| **Keyword Search (PostgreSQL FTS)** | `pnpm retrieval:evaluate`    | Mean Reciprocal Rank (MRR)           |       **1.000**        | Exact technical identifier match rate using `ts_rank_cd`                            |
| **Semantic Search (pgvector)**      | `pnpm retrieval:evaluate`    | Mean Reciprocal Rank (MRR)           |       **0.517**        | Dense vector similarity over conceptual paraphrases                                 |
| **Citation Validity Rate**          | `pnpm rag:evaluate`          | Valid Citation %                     |       **100.0%**       | Zero fabricated or unknown citation identifiers detected                            |
| **Insufficient Evidence Refusal**   | `pnpm rag:evaluate`          | Refusal Accuracy %                   |       **100.0%**       | Correctly refuses to hallucinate when evidence is absent                            |
| **Prompt Injection Containment**    | `pnpm rag:evaluate`          | Containment Rate %                   |       **100.0%**       | Adversarial instructions isolated via structural delimiters                         |
| **Conversational Memory & Context** | `pnpm conversation:evaluate` | Passed Scenarios                     |   **15 / 15 (100%)**   | Evaluates pronoun resolution, ellipticals, memory, and abort recovery in 251ms      |
| **Knowledge Graph Traversal**       | `pnpm graph:evaluate`        | Path Recall & Evidence %             |   **15 / 15 (100%)**   | Evaluates multi-hop path recall, entity resolution, and evidence provenance in 22ms |
| **Monorepo Test Suite**             | `pnpm test`                  | Total Tests Passing                  |  **795 / 795 (100%)**  | Comprehensive unit, integration, and security tests across 68 test files            |

### Running Evaluation Benchmarks

```bash
# Run Information Retrieval benchmark (Precision@K, Recall@K, MRR, nDCG@K)
pnpm retrieval:evaluate

# Run Generative RAG grounding benchmark (Citations, refusal, prompt injection)
pnpm rag:evaluate

# Run Conversational RAG 15-scenario benchmark (Pronouns, memory, recovery)
pnpm conversation:evaluate

# Run Knowledge Graph & GraphRAG benchmark (Multi-hop recall, evidence coverage)
pnpm graph:evaluate
```

---

## 12. Security & Privacy Architecture

MindVault implements defense-in-depth principles across authentication, database access, background workers, and streaming lifecycles:

- **Password Hashing:** Argon2id with 64MB memory cost, 3 iterations, and 4 threads via `argon2`.
- **Session Security:** Short-lived JWT access tokens (15m expiry) and rotating refresh tokens (7d expiry). Refresh tokens are stored strictly in `HttpOnly`, `SameSite=Strict` cookies; only SHA-256 hashes are persisted in PostgreSQL.
- **Token Replay Protection:** Attempting to replay an already-rotated refresh token triggers automatic family revocation, terminating all active sessions for that account.
- **Cryptographic Tenant Isolation:** Every database query filters by `workspaceId` at the SQL level (`WHERE c."workspaceId" = $1`). Programmatic testing verifies zero cross-workspace data leakage.
- **Uniform 404 Anti-Enumeration:** Requests targeting resources belonging to another workspace return a uniform `404 Not Found` response rather than `403 Forbidden`, preventing resource ID enumeration.
- **Stream Lifecycle & Abort Propagation:** Disconnecting client SSE connections triggers `AbortController` signal propagation through retrieval and generation service layers, canceling active operations immediately.
- **Prompt Injection Defense:** Retrieved document chunks are encapsulated in strict structural delimiters (`=== BEGIN UNTRUSTED RETRIEVED CONTEXT ===`), preventing document text from hijacking system instructions.
- **Storage Sanitization:** Files are stored outside web roots using cryptographically generated keys with strict path traversal defenses. Binary magic byte inspection prevents spoofed uploads.
- **Secret Redaction:** Diagnostic tools and loggers redact API keys, database credentials, and session tokens (`[Configured (53 characters)]`), preventing credential leakage in logs or terminal output.

---

## 13. Presenter Walkthrough Guide

MindVault includes a comprehensive, verified presenter guide for live evaluations, technical interviews, and architecture reviews.

- **Guide Location:** [`docs/DEMO_WALKTHROUGH.md`](docs/DEMO_WALKTHROUGH.md)
- **Duration:** 10–15 Minutes
- **Walkthrough Structure:**
  1. _Phase 1 (2 mins):_ Authentication, session lifecycle, and workspace tenancy.
  2. _Phase 2 (3 mins):_ Document library, asynchronous status polling, metadata inspection, and download.
  3. _Phase 3 (4 mins):_ Evidence-grounded conversational Q&A, bracketed citations `[S1]`, and source drawer inspection.
  4. _Phase 4 (3 mins):_ Deep Vault Search with Hybrid RRF ($k=60$), semantic vector, and keyword modes.
  5. _Phase 5 (3 mins):_ Interactive Knowledge Graph Explorer, entity drawer, and relation evidence inspection.
- **Troubleshooting:** Quick-reference remediation matrix for Docker, PostgreSQL, Redis, Ollama, and port conflicts.

---

## 14. Development & Quality Commands

```bash
# Run all 795 unit, integration, and security tests across monorepo
pnpm test

# Run preflight environment & service readiness verification CLI
pnpm demo:check

# Seed showcase workspace with deterministic technical corpus
pnpm db:seed

# Run strict TypeScript typecheck across all workspace packages
pnpm typecheck

# Run ESLint static analysis across monorepo
pnpm lint

# Check Prettier code formatting
pnpm format:check

# Auto-format codebase
pnpm format

# Build all packages for production
pnpm build
```

---

## 15. Project Status & Completed Milestones

```
[x] Phase 0: Project Foundation — Monorepo, Docker Compose, TypeScript Strict Mode, Express API, Worker, React Web.
[x] Phase 1: Authentication & Workspace Management — Argon2id Auth, Session Lifecycle, Token Rotation, Workspace RBAC & Isolation.
[x] Phase 2: Document Ingestion Pipeline — Multipart upload, magic byte validation, BullMQ async worker, multi-format extraction, Unicode NFC normalization, heading chunking, 768d pgvector HNSW index.
[x] Phase 3: Retrieval Engine & Hybrid Search — Unicode NFKC query normalization, pgvector cosine search, PostgreSQL FTS GIN index, Reciprocal Rank Fusion (k=60), stable citations [S1], [S2].
[x] Phase 4: Generative RAG Engine — Evidence-grounded generation, Ollama/Gemini adapters, prompt injection containment, bracketed citation validator, SSE streaming API.
[x] Phase 5: Conversational RAG & Memory — Persistent chat threads, dual-tier bounded memory (sliding turns + rolling summary), pronoun/elliptical resolution (QueryContextService), disconnect abort handling.
[x] Phase 6: Knowledge Graph & GraphRAG — Entity/relation extraction, entity normalization, verbatim text evidence, recursive CTE multi-hop traversal (GRAPH_TIMEOUT_MS=2500), interactive HTML5 canvas explorer.
[x] Stage 1: Real-World RAG Evaluation — Comprehensive quantitative evaluation against golden technical corpus.
[x] Stage 2: Security Architecture Hardening — Uniform 404 anti-enumeration (VULN-AUTHZ-01/02), SSE disconnect cancellation (VULN-RES-01).
[x] Milestone 3.1: Build & Tooling Reliability — Zero TypeScript errors, zero ESLint errors, 100% Prettier compliance.
[x] Milestone 3.2: Demo Readiness & Release Preparation — Deterministic seed system (pnpm db:seed), preflight verification CLI (pnpm demo:check), presenter walkthrough guide (docs/DEMO_WALKTHROUGH.md).
[x] Milestone 3.3: Documentation Alignment — Modernized, verified README.md reflecting current project reality.
```

---

## 16. Known Scope & Boundaries

To preserve presentation integrity, understand what is implemented versus what is deferred:

- **Local Showcase Scope:** The seeded demo account (`demo@mindvault.local`) and password (`DemoPassword123!`) are exclusively for local demonstrations. Seeded embeddings (`mock-embed-768`) are deterministic unit vectors generated via SHA-256 for offline reproducibility; they are not trained semantic models.
- **Bundle Chunk Size:** Vite emits a non-blocking chunk warning during production build (`dist/assets/index-*.js` is ~678 kB). This is harmless for local use and can be optimized with dynamic `import()` in future polish passes.
- **Live Graph Extraction:** Live extraction of newly uploaded files requires an active Ollama instance (`qwen3:0.6b`) or Gemini API key. The showcase workspace ships with pre-extracted graph topology so live extraction is not required for demonstrations.

---

## 17. Contributing

Contributions are welcome. Please follow these principles:

1. Ensure all code changes maintain TypeScript strict mode.
2. Run `pnpm test` to ensure zero regressions across the 795 existing tests.
3. Run `pnpm typecheck`, `pnpm lint`, and `pnpm format:check` before submitting pull requests.

---

## 18. License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.
