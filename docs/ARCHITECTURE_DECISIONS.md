# MindVault — Architecture Decisions Record (ADR)

This document records the foundational architectural decisions made for MindVault, their context, and their rationale.

---

## ADR-001: Monorepo Architecture with pnpm Workspaces

- **Status:** Accepted
- **Context:** MindVault requires a frontend user interface, a core API gateway, a background processing worker, and shared type definitions/configurations. We needed a repository layout that allows sharing code without prematurely introducing multi-repo deployment overhead.
- **Decision:** Use a modular monorepo managed with `pnpm workspaces`. Packages are separated into `apps/` (`web`, `api`, `worker`) and `packages/` (`shared`, `config`).
- **Consequences:**
  - Centralized dependency management.
  - Strict boundary isolation between frontend and backend.
  - Efficient symlinked package sharing using `workspace:*` protocols.

---

## ADR-002: Modular Monolith vs Microservices

- **Status:** Accepted
- **Context:** Microservice architectures introduce networking latency, distributed state synchronization complexity, and excessive resource consumption, which conflicts with local-first development and an 8 GB RAM target machine.
- **Decision:** Build MindVault as a Modular Monolith. Application services (Workspaces, Documents, Search, Conversations) live inside a unified Node.js API with decoupled background workers running on BullMQ.
- **Consequences:**
  - Fast execution, zero internal network overhead.
  - Smooth refactoring path if individual domains ever need extraction later.

---

## ADR-003: Vector Database Choice — PostgreSQL + pgvector

- **Status:** Accepted
- **Context:** We evaluated dedicated vector databases (Pinecone, Qdrant, Chroma, Milvus) against PostgreSQL with `pgvector`.
- **Decision:** Use PostgreSQL with the `pgvector` extension for both relational data (workspaces, documents, users, citations) and high-dimensional embeddings (HNSW indexes).
- **Consequences:**
  - Relational metadata filtering and vector similarity queries execute in a single ACID transaction.
  - Simplified operational footprint: only one database engine to run, back up, and secure.

---

## ADR-004: Lightweight Development Infrastructure on 8 GB RAM Machine

- **Status:** Accepted
- **Context:** Initial development environment is constrained to an Intel Core i3 with 8 GB RAM running Windows 11. Running heavy full-stack containers concurrently can cause swapping and thrashing.
- **Decision:**
  - Run PostgreSQL and Redis via Docker Compose with explicit memory caps (`512MB` for Postgres, `256MB` for Redis).
  - Run Node.js API, Worker, and Web Vite server natively on the host machine.
  - Provide fallback reporting when Docker daemon is not active.
- **Consequences:**
  - Development machine stays responsive.
  - Fast developer feedback loops.

---

## ADR-005: Strict TypeScript & Runtime Environment Validation with Zod

- **Status:** Accepted
- **Context:** Undetected missing environment variables or type mismatches create silent runtime failures in AI and data pipelines.
- **Decision:** Enforce TypeScript strict mode (`strict: true`, `noImplicitAny: true`) across all apps and packages, and parse environment configurations at boot time using `zod`. Fail-fast on invalid configuration.
- **Consequences:**
  - Compile-time safety.
  - Explicit and immediate diagnostic error messages on startup if configurations are misset.

---

## ADR-006: Evidence-Grounded Citations and Provenance

- **Status:** Accepted
- **Context:** Chatbots frequently hallucinate or generate unverified claims. MindVault's product philosophy requires every answer to be traceable to verifiable evidence.
- **Decision:** The foundational schema and response contracts mandate chunk-level provenance (`documentId`, `versionId`, `chunkId`, `pageNumber`, and `supportingText`). AI generation in Phase 4 must reference these exact source identities.
