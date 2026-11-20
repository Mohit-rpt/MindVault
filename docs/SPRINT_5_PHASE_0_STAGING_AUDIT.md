# MindVault — Sprint 5 Phase 0: Cloud Staging & Deployment Readiness Audit

**Audit Date:** 2026-11-20  
**Repository:** `c:/Users/mohit/OneDrive/Desktop/MindVault`  
**Branch:** `main` (verified clean baseline ahead of origin/main)  
**Execution Mode:** STRICTLY READ-ONLY AUDIT & ARCHITECTURE SPECIFICATION  
**Author:** Antigravity Engineering Agent

---

## Executive Summary

This independent read-only audit establishes the foundational baseline for **Sprint 5: Cloud Staging Validation, End-to-End Testing & Deployment Readiness**.

Before any configuration, containerization, or testing code was authored, the existing monorepo was subjected to direct, empirical verification:
- **Test Suite Baseline:** 92 test files executed, **1,236 passed (100%), 0 failed**, running in 143.21s.
- **Static Typing Baseline:** `pnpm typecheck` executed across all 5 workspaces (`shared`, `api`, `worker`, `companion`, `web`) with **0 errors**.
- **Production Build Baseline:** `pnpm build` executed across all 5 workspaces with **100% success**, including the Vite production bundle (612 kB JS, 28 kB CSS).
- **Deployment Assets:** Dedicated `Dockerfile.worker` is present; `Dockerfile.api`, staging compose topologies, Playwright browser test harness, and GitHub Actions CI pipelines are not yet established.

---

## 1. Current Verified Architecture

The MindVault monorepo currently operates as a pnpm workspace consisting of:

```
MindVault Monorepo
├── packages/
│   ├── config/      # Shared ESLint, Prettier, TypeScript configurations
│   └── shared/      # Shared domain schemas (Zod), Redis utilities, Queue protocols, Storage interfaces
├── apps/
│   ├── api/         # Express 4 REST & Server-Sent Events (SSE) API server
│   ├── worker/      # BullMQ background worker (document chunking, embeddings, KG extraction)
│   ├── companion/   # Windows companion daemon (DPAPI secret storage, supervisor)
│   └── web/         # React 18 + Vite SPA (Tailwind CSS, Lucide icons, SSE streaming client)
├── prisma/          # Prisma schema with PostgreSQL 16 + pgvector (768-dim embeddings)
└── infrastructure/  # Dockerfiles and Postgres init SQL
```

### Component Breakdown
1. **API Server (`apps/api`):**
   - Express 4 runtime running on port 4000 (configurable).
   - Serves REST endpoints for authentication, workspaces, documents, search, conversation sessions, graph exploration, and companion pairing.
   - Streams Gemini 3.5 Flash RAG generation over HTTP Server-Sent Events (`/api/conversations/:id/messages/stream`).
   - Guards upload ingress via streaming byte signature validation, atomic Redis reservation quotas (100 docs, 100MB), and distributed sliding-window rate limiters.
2. **Background Worker (`apps/worker`):**
   - BullMQ 6.7.2 worker process running decoupled from HTTP ingress.
   - Dual-queue routing: consumes isolated workspace queues (`doc-queue-{wsId}-cloud`).
   - Pipelines: Text normalization, recursive token chunking (500 tokens, 100 overlap), Gemini embedding generation (768 dimensions), PostgreSQL vector upsert, and asynchronous Graph extraction.
   - Dual-write safety: Claim-and-intent protocol with generation lease fencing (`FOR NO KEY UPDATE` row locks).
3. **Frontend SPA (`apps/web`):**
   - Single-Page Application built with React 18, Vite, Tailwind CSS.
   - Employs relative API routes (`/api/...`) proxied through Vite in development.
   - Maintains authentication state in `AuthContext` via memory tokens with refresh-token cookies.
4. **Data Stores:**
   - **PostgreSQL 16 + pgvector:** Primary relational schema (Users, Workspaces, Documents, Chunks, Embeddings, Entities, Relations, Conversation Messages, Ingestion Receipts).
   - **Redis 7 (Standalone / Dragonfly / Upstash):** BullMQ job queues, distributed rate limiting tokens, quota reservations, lease tracking, and worker heartbeats.
   - **Storage Engine:** S3/Cloudflare R2-compatible object storage via `@aws-sdk/client-s3` with transparent local disk fallback.

---

## 2. Previous Sprint Verification Results

### Sprint 3 Verification (P0 Security & Worker Cloud Decoupling)
- **Production Secret Validation:** Confirmed in `apps/api/src/config/env.ts` and `apps/worker/src/config/env.ts`. Any secret in `KNOWN_INSECURE_SECRETS` or under 32 characters triggers immediate process termination in `production`.
- **HTTP Security Headers (Helmet):** Confirmed in `apps/api/src/app.ts`. Enforces `frameguard: { action: 'deny' }`, `crossOriginResourcePolicy: { policy: 'cross-origin' }`, and HSTS (180 days with preload in production).
- **Sanitized Public Health Probes:** Confirmed in `apps/api/src/routes/health.ts`. Returns `{ status: 'ok', version, timestamp }` publicly; internal worker telemetry is gated behind `INTERNAL_DIAGNOSTICS_TOKEN` bearer authentication.
- **Worker Isolation & Queue Routing:** Confirmed in `apps/worker/src/worker.ts` and `@mindvault/shared`. Local workers cannot connect to remote Redis without `DEV_ALLOW_REMOTE_REDIS=true`, and queue names are strictly divided into `local` and `cloud` prefixes.

### Sprint 4 Verification (Secure Storage & Resource Governance)
- **Document Storage Provider:** Confirmed in `apps/api/src/modules/document/document.storage.ts` and `apps/worker/src/lib/storage.ts`. Zero Base64 document payload storage in PostgreSQL JSONB. Documents are stored under hierarchical keys (`documents/{workspaceId}/{documentId}/{filename}`).
- **Streaming Ingress Protection:** Confirmed in `apps/api/src/modules/document/document.routes.ts`. Pre-upload workspace guard verifies workspace membership and quota reservations before allocating upload memory. File signature sniffing validates PDF (`%PDF-`), DOCX (`PK\x03\x04`), and plain text/markdown.
- **Distributed Redis Rate Limiting:** Confirmed in `apps/api/src/middleware/redisRateLimiter.ts`. Atomic sliding-window rate limiters with fail-closed behavior on sensitive endpoints (auth, upload, chat).
- **Resource Quota Enforcement:** Confirmed in `apps/api/src/services/quota.service.ts`. Enforces max 100 documents, 100MB storage per workspace, and 500 chat messages/day per user.

---

## 3. Existing Deployment Configuration

| Asset | Location | Status | Assessment |
|---|---|---|---|
| Worker Dockerfile | `Dockerfile.worker` | Present (Multi-stage) | Production-ready Alpine container, runs non-root (`node`), uses `dumb-init`, builds shared + worker. |
| API Dockerfile | `Dockerfile.api` | Missing | Needs creation for containerized API deployment. |
| Local Docker Compose | `docker-compose.yml` | Present (Dev only) | Contains `postgres` (pgvector) and `redis` (7-alpine). Does not contain API, Worker, or Local S3/MinIO. |
| Staging Docker Compose | `docker-compose.staging.yml` | Missing | Needs creation to simulate complete staging cloud topology locally. |
| CI/CD Pipeline | `.github/workflows/` | Missing | Directory does not exist. Needs full automated GitHub Actions CI workflow. |
| Staging Deployment Scripts | `scripts/` | Partial | Verification scripts exist (`verify-demo-environment.ts`), but dedicated deployment automation scripts are missing. |

---

## 4. Cloud Architecture Proposal

For an isolated private staging deployment:

```text
                                Internet
                                   │
               ┌───────────────────┴───────────────────┐
               │                                       │
               ▼                                       ▼
    Frontend Staging Host                     API Gateway / Reverse Proxy
   (Cloudflare Pages / SPA)                 (Railway / Render / Fly.io / Nginx)
               │                                       │
               │ HTTPS (/api proxy or direct)          │
               └──────────────────────────────────────►│
                                                       │
                                   ┌───────────────────┴───────────────────┐
                                   │                                       │
                                   ▼                                       ▼
                             MindVault API                       MindVault Cloud Worker
                             Container Service                     Container Service
                             (NODE_ENV=production)                (WORKER_TYPE=cloud)
                                   │                                       │
                                   ├───────────────────┬───────────────────┤
                                   ▼                   ▼                   ▼
                           PostgreSQL (Neon)      Redis (Upstash)      Cloudflare R2
                           (Private Staging DB)  (TLS Private Staging) (Private Staging Bucket)
                                   │                   │                   │
                                   └─────────────┬─────┴───────────────────┘
                                                 ▼
                                            Google Gemini
                                        (Staging API Key/Quota)
```

---

## 5. Frontend Hosting Proposal

### Option A: Cloudflare Pages (Recommended)
- **Rationale:** Global edge CDN, zero cost on free tier, instant preview deployments from Git branches, built-in HTTPS, custom domains.
- **Routing & Proxying:** Can serve the SPA with an `_routes.json` or Cloudflare Pages Functions `/api/*` reverse proxy rule forwarding to the API service. This eliminates cross-origin cookie issues completely by keeping API calls on the same origin.
- **Static Assets:** 612 kB JS bundle decompresses instantly via Brotli/Gzip at edge.

### Option B: Unified Container / Reverse Proxy (Local Staging Simulation)
- **Rationale:** In `docker-compose.staging.yml`, an Nginx 1.25 Alpine reverse proxy serves the built static frontend assets and reverse-proxies `/api/` to the `api` container.
- **Benefit:** 100% fidelity reproduction of cloud CDN + API gateway on developer workstation without external cloud costs.

---

## 6. API Hosting Proposal

### Option A: Railway / Render / Fly.io Container Service
- **Runtime:** Linux x86_64 or ARM64 container running Node.js 22 LTS under non-root user.
- **Requirements:** Minimum 512 MB RAM (1 GB recommended), persistent outbound internet access for Gemini API and Neon/Upstash connectivity.
- **Health Check:** `GET /api/health` responding with 200 OK within 5s.
- **Graceful Shutdown:** Intercepts `SIGTERM` and `SIGINT`, closes HTTP listener, drains existing in-flight connections (5s grace period), disconnects Prisma and Redis clients cleanly.

---

## 7. Worker Hosting Proposal

### Option A: Dedicated Background Worker Container Service
- **Runtime:** Linux container matching `Dockerfile.worker`.
- **Environment:** `NODE_ENV=production`, `WORKER_TYPE=cloud`, `WORKER_CONCURRENCY=2`.
- **Process Isolation:** Worker runs as an independent daemon. It does NOT bind to any public HTTP port.
- **Heartbeat & Telemetry:** Reports node liveness every 30s to Redis key `mindvault:worker:heartbeat:{workerId}`.
- **Safe Queue Drain:** Intercepts `SIGTERM`, invokes `bullWorker.close()` to allow in-flight chunk embeddings and KG extractions to complete cleanly before process exit.

---

## 8. Database Configuration (PostgreSQL + pgvector)

- **Provider:** Neon Serverless PostgreSQL or self-hosted PostgreSQL 16.
- **Extension:** `CREATE EXTENSION IF NOT EXISTS vector;`
- **SSL Requirement:** In production/staging, `DATABASE_URL` must require SSL (`sslmode=require`).
- **Connection Pooling:** In serverless topologies (Neon), API uses pooled connection string (`-pooler`) for HTTP handlers, while Prisma migrations and Worker lease fencing require direct connection (`directUrl`).
- **Isolation:** Staging must use a dedicated database (e.g., `mindvault_staging`), completely separate from any local or production database.

---

## 9. Redis Configuration (BullMQ & Governance)

- **Provider:** Upstash Redis (Serverless TLS) or Redis 7 Cloud instance.
- **TLS Requirement:** In production, `REDIS_URL` must start with `rediss://` (native TLS).
- **Max Memory Policy:** Must be configured with `noeviction` for BullMQ queue integrity. Key evictions cause BullMQ job state corruption. Rate limiting and quota reservation keys use explicit TTLs (60s).
- **Isolation:** Staging requires a dedicated Redis database index (`/1`) or dedicated Upstash database instance.

---

## 10. Object Storage Configuration (Cloudflare R2 / S3)

- **Provider:** Cloudflare R2 (S3-compatible API, zero egress fees).
- **Bucket:** `mindvault-staging-documents` (Private, public access disabled).
- **Credentials:** S3 Access Key ID + Secret Access Key scoped strictly to the staging bucket.
- **Endpoint:** `https://<account-id>.r2.cloudflarestorage.com`.
- **Local Simulation:** MinIO container (`minio/minio:latest`) in `docker-compose.staging.yml`.

---

## 11. Environment Variable Inventory

### Required for API Container
```bash
NODE_ENV=production
PORT=4000
CORS_ORIGIN=https://staging.mindvault.app
DATABASE_URL=postgresql://user:password@staging-db.neon.tech/mindvault_staging?sslmode=require
REDIS_URL=rediss://default:password@staging-redis.upstash.io:6379
JWT_ACCESS_SECRET=<cryptographically-secure-random-min-32-chars>
COOKIE_SECRET=<cryptographically-secure-random-min-32-chars>
STORAGE_PROVIDER=r2
STORAGE_ENDPOINT=https://<account_id>.r2.cloudflarestorage.com
STORAGE_BUCKET=mindvault-staging-documents
STORAGE_REGION=auto
STORAGE_ACCESS_KEY_ID=<r2_access_key>
STORAGE_SECRET_ACCESS_KEY=<r2_secret_key>
GEMINI_API_KEY=<gemini_api_key_with_staging_quota_limit>
GEMINI_MODEL=gemini-3.5-flash
GEMINI_EMBEDDING_MODEL=gemini-embedding-2
INTERNAL_DIAGNOSTICS_TOKEN=<secret-token-for-admin-probes>
```

### Required for Worker Container
```bash
NODE_ENV=production
WORKER_TYPE=cloud
WORKER_CONCURRENCY=2
DATABASE_URL=postgresql://user:password@staging-db.neon.tech/mindvault_staging?sslmode=require
REDIS_URL=rediss://default:password@staging-redis.upstash.io:6379
STORAGE_PROVIDER=r2
STORAGE_ENDPOINT=https://<account_id>.r2.cloudflarestorage.com
STORAGE_BUCKET=mindvault-staging-documents
STORAGE_REGION=auto
STORAGE_ACCESS_KEY_ID=<r2_access_key>
STORAGE_SECRET_ACCESS_KEY=<r2_secret_key>
GEMINI_API_KEY=<gemini_api_key_with_staging_quota_limit>
GEMINI_MODEL=gemini-3.5-flash
GEMINI_EMBEDDING_MODEL=gemini-embedding-2
```

---

## 12. Authentication, CORS & Cookie Considerations

### The Cross-Origin Cookie Challenge
In `apps/api/src/modules/auth/auth.security.ts`:
```typescript
res.cookie(REFRESH_COOKIE_NAME, token, {
  httpOnly: true,
  secure: env.NODE_ENV === 'production',
  sameSite: env.NODE_ENV === 'production' ? 'strict' : 'lax',
  maxAge: maxAgeMs,
  path: '/api/auth',
});
```
- If the frontend is hosted at `https://mindvault-web.pages.dev` and the API is hosted at `https://mindvault-api.railway.app`, `sameSite: 'strict'` will **refuse to send** the refresh token cookie on cross-origin requests.
- Furthermore, modern browsers (Chrome, Safari, Firefox) partition or block third-party cookies unless `SameSite: 'none'` and `Secure: true` are configured.
- **Architectural Solution:**
  1. **Primary recommendation:** Use a single origin via Cloudflare Pages proxy or custom domain routing (e.g. `https://staging.mindvault.com` for web, and `https://staging.mindvault.com/api` routed to API). This preserves `SameSite: 'lax'` or `'strict'`, providing maximum CSRF protection.
  2. **Alternative for decoupled staging domains:** Allow cookie configuration to support `SAME_SITE=none` when `CORS_ORIGIN` is distinct from the API host in staging, while preserving strict security.

---

## 13. Streaming Compatibility (SSE)

- The RAG chat feature (`/api/conversations/:id/messages/stream`) uses HTTP Server-Sent Events.
- **Cloudflare / CDN Buffering Risk:** Proxies and edge CDNs often buffer HTTP chunked transfer responses by default, breaking real-time token streaming.
- **Remediation:**
  - The API already emits `X-Accel-Buffering: no` and `Cache-Control: no-cache, no-transform`.
  - In Nginx / Cloudflare reverse proxy rules, response buffering for `/api/conversations/*/messages/stream` must be explicitly disabled (`proxy_buffering off;`).

---

## 14. Existing CI/CD Status

- Currently, `.github/workflows` does not exist.
- No automated pipeline runs on pull requests or commits to `main`.
- **Target Pipeline Implementation (`.github/workflows/ci.yml`):**
  1. Checkout code with `pnpm/action-setup`.
  2. Setup Node.js 22 with pnpm cache.
  3. Install dependencies (`pnpm install --frozen-lockfile`).
  4. Run Lint and Formatting checks (`pnpm lint`, `pnpm format:check`).
  5. Run Monorepo Typecheck (`pnpm typecheck`).
  6. Run Monorepo Test Suite (`pnpm test`).
  7. Run Production Builds (`pnpm build`).
  8. Run Playwright End-to-End Tests with headless Chromium and mocked AI services.
  9. Upload Playwright traces and test report artifacts on failure.

---

## 15. Deployment Risks & Mitigations

| Risk | Impact | Likelihood | Mitigation |
|---|---|---|---|
| Unintended Local Worker Processing Production Queues | High | Med | Hardened in Sprint 3: Worker defaults `DEV_ALLOW_REMOTE_REDIS=false` and crashes if remote Redis is attempted in dev mode. |
| Object Storage Credential Leakage | Critical | Low | Scoped bucket access keys; credentials passed strictly via environment variables; never logged or committed. |
| Gemini API Quota Exhaustion | High | Med | Staging environment enforces workspace chat limits (500/day), embedding concurrency throttling, and test suites strictly mock Gemini. |
| Cold Start Latency on Serverless Containers | Med | High | Configure health check keep-alives or provision minimum 1 warm instance on staging. |
| Database Connection Starvation | High | Med | Use connection pooling (`pgBouncer` / Neon pooler) for API workers; direct connection reserved for worker and migrations. |

---

## 16. Playwright End-to-End Test Plan

To provide browser-level confidence without paid API consumption, Playwright will run against an automated test fixture architecture:
- **Root Configuration:** `playwright.config.ts` targeting `http://localhost:5173`.
- **Mock Gemini Engine:** API running in test/mock mode (`LLM_PROVIDER=mock`, `EMBEDDING_PROVIDER=mock`) emitting deterministic streaming tokens and 768-dim embeddings.
- **Coverage of 8 Critical Flows:**
  1. **Flow 1: Authentication:** Registration, login, invalid credentials alert, session persistence after reload, clean logout.
  2. **Flow 2: Workspace:** Workspace switching, active workspace context synchronization, unauthorized workspace isolation.
  3. **Flow 3: Document Upload:** Valid PDF, text document, unsupported file rejection, oversized file rejection, magic byte tampering detection.
  4. **Flow 4: Document Ingestion:** Status transitions from queued -> processing -> completed with progress polling.
  5. **Flow 5: RAG Chat:** Multi-turn conversation creation, SSE real-time streaming, citation pill rendering, source panel drawer opening.
  6. **Flow 6: Document Management:** Document table search, download verification, document deletion, workspace isolation.
  7. **Flow 7: Knowledge Graph:** Graph overview load, node inspection, entity detail modal, empty graph state.
  8. **Flow 8: Resource Protection:** Rate limit triggering (429 Too Many Requests), quota limits enforcement.

---

## 17. Exact Files Expected to Change / Be Created

### New Files
1. `Dockerfile.api` — Production multi-stage Dockerfile for the Express API.
2. `docker-compose.staging.yml` — Full staging stack simulation (API, Cloud Worker, Redis, PostgreSQL, MinIO/Local S3, Nginx).
3. `infrastructure/docker/nginx.staging.conf` — Reverse proxy configuration for single-origin routing & SSE streaming.
4. `.github/workflows/ci.yml` — Complete GitHub Actions CI automation workflow.
5. `playwright.config.ts` — Playwright test configuration.
6. `tests/e2e/auth.spec.ts` — Flow 1 browser test.
7. `tests/e2e/workspace.spec.ts` — Flow 2 browser test.
8. `tests/e2e/upload.spec.ts` — Flow 3 browser test.
9. `tests/e2e/ingestion.spec.ts` — Flow 4 browser test.
10. `tests/e2e/chat.spec.ts` — Flow 5 browser test.
11. `tests/e2e/documents.spec.ts` — Flow 6 browser test.
12. `tests/e2e/graph.spec.ts` — Flow 7 browser test.
13. `tests/e2e/governance.spec.ts` — Flow 8 browser test.
14. `tests/e2e/fixtures/mock-server.ts` — Deterministic test server harness.
15. `scripts/deploy-staging.ps1` & `scripts/deploy-staging.sh` — Controlled staging deployment scripts with safety confirmations.
16. Documentation files in `docs/` (`SPRINT_5_STAGING_ARCHITECTURE.md`, `SPRINT_5_DEPLOYMENT_GUIDE.md`, etc.).

### Modified Files
1. `package.json` — Add Playwright test scripts (`test:e2e`, `test:e2e:ui`).
2. `apps/api/src/config/env.ts` — Support staging cookie configurations if cross-domain staging is used.
3. `apps/web/vite.config.ts` — Enhanced staging base URL handling.

---

## 18. External Services Required for Staging

1. **PostgreSQL Database:** Neon Serverless PostgreSQL staging project (isolated branch or database).
2. **Redis Service:** Upstash Serverless Redis staging database (TLS enabled).
3. **Object Storage:** Cloudflare R2 staging bucket (`mindvault-staging-documents`).
4. **Google Gemini:** API Key with controlled quota allocation.
5. **Container Compute:** Railway / Render / Fly.io private staging environment (2 services: API + Worker).
6. **Frontend Host:** Cloudflare Pages private project.

---

## 19. Explicit Approval Checkpoints

In strict compliance with Safety Rules §0:
- **Checkpoint 1 (Current):** Phase 0 Audit & Architecture Plan review.
- **Checkpoint 2:** Dockerfiles, CI workflows, and Playwright local test suites implemented and verified locally.
- **Checkpoint 3 (MANDATORY GATE):** Stop before creating any external cloud service, connecting live cloud credentials, running remote migrations, or deploying to the internet. Explicit user consent is required before any cloud deployment command is triggered.

---

## 20. Remaining Blockers & Next Actions

1. **Current Blocker:** Awaiting completion of Phase 0 audit review.
2. **Next Action:** Upon review, proceed to **Phase 1 (Staging Environment Design)** and **Phase 2 (Deployment Configuration & Containerization)** to build `Dockerfile.api`, `docker-compose.staging.yml`, and staging validation automation.
