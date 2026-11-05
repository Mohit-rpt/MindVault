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

---

## ADR-007: Argon2id Password Hashing and Rotating Refresh Token Family Lifecycle

- **Status:** Accepted
- **Context:** Storing plaintext or weakly hashed passwords (MD5, SHA, plain bcrypt without memory hardness) leaves systems vulnerable to GPU cracking. Storing unhashed refresh tokens in databases leaves them vulnerable to token theft if database read access is compromised. Refresh tokens kept in browser `localStorage` are vulnerable to XSS exfiltration.
- **Decision:**
  - Hash all passwords using **Argon2id** (memory cost 64 MB, 3 iterations, 4 parallelism lanes).
  - Issue short-lived JWT access tokens (15m expiry) kept exclusively in memory.
  - Issue rotating refresh tokens stored in database strictly as **SHA-256 hashes**.
  - Refresh tokens are transmitted exclusively in `HttpOnly`, `SameSite=Strict`, `Secure` cookies.
  - Implement **Token Family Revocation upon Reuse**: When a refresh token is presented, the previous session is marked revoked and a new session is issued. If a client attempts to present an already revoked refresh token (replay attack), the system detects token reuse and immediately revokes all active sessions for that user family.
- **Consequences:**
  - High resistance against offline brute-force and GPU cracking.
  - Zero exposure of refresh tokens to browser JavaScript (XSS mitigation).
  - Immediate mitigation of compromised refresh token chains via family revocation.

---

## ADR-008: Workspace Tenancy Isolation & Role-Based Access Control (RBAC)

- **Status:** Accepted
- **Context:** Multi-tenant systems are vulnerable to Insecure Direct Object References (IDOR) if queries filter solely on record IDs without asserting tenant membership. MindVault requires strict data isolation between user workspaces.
- **Decision:**
  - Enforce explicit workspace membership verification via an `authorizeWorkspace(minimumRole)` middleware on every tenant-scoped endpoint.
  - Implement a hierarchical 3-tier role system: `OWNER` (rank 3) > `ADMIN` (rank 2) > `MEMBER` (rank 1).
  - Data queries in the repository layer and future vector search must filter on `workspaceId` as a mandatory compound key.
  - Registration automatically creates an isolated primary workspace with the user as `OWNER`.
  - Non-members attempting to access workspace resources receive generic `403 Forbidden` responses without leaking tenant existence.
- **Consequences:**
  - Complete multi-tenant isolation at both route middleware and database query layers.
  - Elimination of cross-tenant IDOR attack vectors.
  - Clear, extensible permission model for future multi-user collaboration.
