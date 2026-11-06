# MindVault

> **AI-Powered Personal Knowledge Operating System**  
> _Transform disconnected documents, notes, and technical knowledge into a searchable, connected, evidence-grounded intelligence system._

---

## 1. Project Overview

MindVault is not just another chatbot interface for uploaded files. It is an AI-powered personal knowledge operating system designed to collect, organize, understand, connect, search, and reason across personal and technical knowledge.

### Core Product Philosophy

1. **Knowledge belongs to the user**: Complete privacy and workspace isolation.
2. **Evidence-grounded**: Every answer is traceable to exact source chunks and citations.
3. **Intellectual honesty**: The system admits when evidence is insufficient.
4. **Provider-agnostic**: Interchangeable adapters for local models (Ollama) and hosted providers.
5. **Asynchronous processing**: Computationally expensive ingestion and embedding tasks run off the request thread.

---

## 2. Technology Stack

| Layer                  | Technologies                                              |
| ---------------------- | --------------------------------------------------------- |
| **Frontend**           | React 18, TypeScript, Vite, Tailwind CSS, Lucide Icons    |
| **Backend API**        | Node.js, Express, TypeScript (Strict Mode), Zod           |
| **Background Worker**  | Node.js, TypeScript, BullMQ (Architecture Ready)          |
| **Database & Vectors** | PostgreSQL 16 + pgvector extension                        |
| **Cache & Queues**     | Redis 7 Alpine                                            |
| **Tooling & Monorepo** | pnpm Workspaces, Vitest, ESLint, Prettier, Docker Compose |

---

## 3. Repository Structure

```
mindvault/
├── apps/
│   ├── web/                     # React + TypeScript + Vite frontend
│   ├── api/                     # Express + TypeScript backend API
│   └── worker/                  # Background job worker
├── packages/
│   ├── shared/                  # Common TypeScript interfaces & schemas
│   └── config/                  # Shared tsconfig, lint, and formatting configs
├── prisma/                      # Database schema and migration specifications
├── infrastructure/
│   └── docker/                  # Database init scripts and container configs
├── tests/                       # Global test setups & integration tests
├── docs/
│   ├── ARCHITECTURE_DECISIONS.md # ADRs recording foundational decisions
│   └── DEVELOPMENT.md           # Step-by-step developer guide
├── ARCHITECTURE_PLANNER.md      # Master architectural blueprint
├── IMPLEMENTATION_ROADMAP.md    # Multi-phase engineering roadmap
├── package.json                 # Monorepo root package configuration
├── pnpm-workspace.yaml          # Workspace definitions
├── docker-compose.yml           # PostgreSQL (pgvector) & Redis services
├── .env.example                 # Environment variables template
└── README.md
```

---

## 4. Prerequisites

- **Node.js**: `v20.x` or `v22.x` LTS
- **pnpm**: `v9.x` or `v10.x` (`npm install -g pnpm`)
- **Git**: `v2.40+`
- **Docker & Docker Compose** (for PostgreSQL + pgvector and Redis)

---

## 5. Quick Start & Installation

### Step 1: Clone and install dependencies

```bash
git clone <repo-url>
cd MindVault
pnpm install
```

### Step 2: Configure environment variables

```bash
# Windows PowerShell:
Copy-Item .env.example .env

# Linux / macOS:
cp .env.example .env
```

### Step 3: Start infrastructure containers (Docker)

```bash
pnpm docker:up
```

### Step 4: Run Database Migrations (Prisma)

```bash
# Generate Prisma Client:
pnpm db:generate

# Apply pending migrations:
pnpm db:migrate
```

### Step 5: Run Development Services

You can run services individually:

```bash
# Terminal 1 — Start the API Gateway (port 4000)
pnpm dev:api

# Terminal 2 — Start the Background Worker
pnpm dev:worker

# Terminal 3 — Start the Web Dashboard (port 5173)
pnpm dev:web
```

---

## 6. Authentication & Workspace API Endpoints (Phase 1)

MindVault enforces strict workspace tenancy isolation and role-based access control (`OWNER` > `ADMIN` > `MEMBER`).

### Authentication Endpoints

| Method   | Route                    | Auth Required | Description                                                          |
| -------- | ------------------------ | ------------- | -------------------------------------------------------------------- |
| `POST`   | `/api/auth/register`     | No            | Registers user, creates initial workspace (`OWNER`), issues tokens   |
| `POST`   | `/api/auth/login`        | No            | Validates credentials via Argon2id, creates session and sets cookies |
| `POST`   | `/api/auth/refresh`      | Cookie        | Rotates refresh token, detects token reuse, issues fresh JWT         |
| `POST`   | `/api/auth/logout`       | Cookie        | Revokes active session and clears auth cookies                       |
| `GET`    | `/api/auth/me`           | Bearer        | Retrieves authenticated user profile and memberships                 |
| `GET`    | `/api/auth/sessions`     | Bearer        | Lists all active and historical sessions for user                    |
| `DELETE` | `/api/auth/sessions/:id` | Bearer        | Revokes a specific session by ID                                     |

### Workspace Management Endpoints

| Method   | Route                 | Minimum Role  | Description                                            |
| -------- | --------------------- | ------------- | ------------------------------------------------------ |
| `POST`   | `/api/workspaces`     | Authenticated | Creates a new workspace; creator designated as `OWNER` |
| `GET`    | `/api/workspaces`     | Authenticated | Lists all workspaces the authenticated user belongs to |
| `GET`    | `/api/workspaces/:id` | `MEMBER`      | Retrieves workspace details and member roster          |
| `PATCH`  | `/api/workspaces/:id` | `ADMIN`       | Updates workspace configuration (e.g. name)            |
| `DELETE` | `/api/workspaces/:id` | `OWNER`       | Deletes workspace and cascades tenant data             |

### Document Management & Ingestion Endpoints (Phase 2)

| Method   | Route                         | Minimum Role | Description                                                                |
| -------- | ----------------------------- | ------------ | -------------------------------------------------------------------------- |
| `POST`   | `/api/documents/upload`       | `MEMBER`     | Multipart upload (`.pdf`, `.docx`, `.txt`, `.md`), enqueues processing job |
| `GET`    | `/api/documents`              | `MEMBER`     | Lists documents in workspace with pagination, search, and status filter    |
| `GET`    | `/api/documents/:id`          | `MEMBER`     | Retrieves document metadata, page count, and chunk counts                  |
| `GET`    | `/api/documents/:id/status`   | `MEMBER`     | Polls asynchronous ingestion status and active processing stage            |
| `GET`    | `/api/documents/:id/download` | `MEMBER`     | Streams and downloads original file buffer with attachment headers         |
| `DELETE` | `/api/documents/:id`          | `ADMIN`      | Cascades deletion of document, vector chunks, and physical storage file    |

### Retrieval Engine & Hybrid Search Endpoints (Phase 3)

| Method | Route                   | Minimum Role | Description                                                                |
| ------ | ----------------------- | ------------ | -------------------------------------------------------------------------- |
| `POST` | `/api/retrieval/search` | `MEMBER`     | Multi-tenant hybrid search (vector + FTS + RRF k=60), context, & citations |

---

## 7. Security Architecture

- **Password Hashing:** Argon2id with memory cost 64MB (65536 KB), 3 iterations, and 4 threads.
- **Session Tokens:** Short-lived JWT access tokens (15m expiry) and rotating refresh tokens (7d expiry).
- **Storage:** Refresh tokens are never stored in plaintext — only SHA-256 hashes are persisted in PostgreSQL.
- **Cookie Security:** Refresh tokens are transmitted exclusively in `HttpOnly`, `SameSite=Strict` cookies. Access tokens stay in client memory.
- **Token Reuse Detection:** Attempting to replay an already rotated refresh token triggers automatic family revocation, terminating all sessions for that account immediately.
- **Tenant Isolation:** Every route handling tenant data requires `authorizeWorkspace(minimumRole)`, strictly preventing IDOR vulnerabilities across tenants.
- **Database-Level SQL Scoping:** Vector similarity and full-text search queries strictly enforce workspace scoping directly inside SQL (`WHERE c."workspaceId" = $1 AND d."status" = 'COMPLETED'`), never in application memory.
- **Storage & Magic Byte Defenses:** Files are stored outside web roots using cryptographically generated keys with strict path traversal defenses. Binary null byte inspection and file header validation prevent spoofed uploads.

---

## 8. Testing & Quality Checks

```bash
# Run unit, integration, and security tests (124 tests across monorepo)
pnpm test

# Run offline retrieval evaluation benchmark (Precision@K, Recall@K, MRR, nDCG@K)
pnpm retrieval:evaluate

# Run strict TypeScript typecheck across all workspaces
pnpm typecheck

# Run linter
pnpm lint

# Check formatting
pnpm format:check

# Auto-format codebase
pnpm format
```

---

## 9. Current Status: Phase 3 Completed

- [x] **Phase 0: Project Foundation** — Monorepo, Docker Compose, TypeScript Strict Mode, Express API, Worker, React Web, Centralized Error Handling.
- [x] **Phase 1: Authentication & Workspace Management** — Prisma Schema & Migrations, Argon2id Auth, Session Lifecycle, Token Rotation & Reuse Detection, Workspace RBAC & Isolation, Full React Auth Shell.
- [x] **Phase 2: Document Ingestion Pipeline & Vector Knowledge Storage** — Multipart file upload, magic byte validation, SHA-256 deduplication, BullMQ async worker, multi-format extraction (PDF, DOCX, TXT, MD), Unicode NFC normalization, structure-aware chunking (700 target / 120 overlap), 768-dim vector embeddings (`nomic-embed-text` / pgvector), HNSW cosine index, Document Library frontend with live status polling.
- [x] **Phase 3: Retrieval Engine, Hybrid Search & Retrieval Intelligence** — Unicode NFKC query normalization, 768-dim vector query embedding, pgvector cosine search, PostgreSQL Full-Text Search with GIN index, Reciprocal Rank Fusion ($k=60$), pluggable reranker abstraction with fallback, metadata filtering, context assembly with token budgeting, stable source citations (`[S1]`, `[S2]`), React search interface, offline IR evaluation framework (`pnpm retrieval:evaluate`).
- [ ] **Phase 4: Basic RAG Chat** (Next Milestone)
