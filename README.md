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

### Step 4: Run Development Services

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

## 6. Testing & Quality Checks

```bash
# Run unit and integration tests
pnpm test

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

## 7. Current Status: Phase 0 Completed

MindVault is currently in **Phase 0: Project Foundation**. All core skeletons, monorepo workspaces, strict TypeScript configurations, Docker Compose definitions, and health endpoints are verified and operational.

Next Milestone: **Phase 1 — Authentication & Workspace Management**.
