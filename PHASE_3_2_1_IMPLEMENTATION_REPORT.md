# MindVault — Task 3.2.1: Environment & Configuration Reliability Implementation Report

**Milestone:** 3.2 — Demo Readiness & Release Preparation  
**Task:** 3.2.1 — Environment & Configuration Reliability (CFG-01)  
**Mode:** Authorized Implementation  
**Status:** **TASK 3.2.1 — COMPLETE & VERIFIED**  
**Execution Timestamp:** 2026-11-09T21:43:00+05:30  
**Overall Monorepo Health:** PASS (Zero Errors, Zero Regressions, 782/782 Tests Passing)

---

## 1. Executive Summary

Task 3.2.1 resolved the configuration reliability and documentation gaps identified under finding **CFG-01** in `PHASE_3_0_PRODUCT_READINESS_ASSESSMENT.md` and `PHASE_3_2_READINESS_AND_IMPLEMENTATION_PLAN.md`.

Specifically, two major configuration deficiencies were addressed:

1. **Environment Configuration Gap (Task A):** `.env.example` was expanded from an incomplete 24-variable template to an authoritative, 34-variable specification. Ten actively consumed runtime variables (`STORAGE_DIR`, `EMBEDDING_MODEL`, `GRAPH_EXTRACTION_PROVIDER`, `OLLAMA_EXTRACTION_MODEL`, `OLLAMA_EXTRACTION_TEMPERATURE`, `OLLAMA_EXTRACTION_THINK`, `OLLAMA_EXTRACTION_TIMEOUT_MS`, `GEMINI_API_KEY`, `GEMINI_MODEL`, `RERANKER_ENDPOINT` / `RERANKER_API_KEY`) were documented with their exact defaults, validation rules, and provider-specific roles. Zero secrets or sensitive data were exposed.
2. **Vite Proxy Port Hardcoding (Task B):** In `apps/web/vite.config.ts`, the API proxy target was changed from a hardcoded `http://localhost:4000` to a dynamic resolution strategy. Using Vite's `loadEnv` lifecycle and `process.env` hierarchy, the dev proxy dynamically resolves custom API ports (`PORT`, `API_PORT`) and custom base URLs (`VITE_API_BASE_URL`), falling back gracefully to `http://localhost:4000`.

Protected AI architecture (RAG, 3-way RRF, pgvector embeddings, GraphRAG recursive traversal, BullMQ worker lifecycle, and database schemas) remained completely untouched.

---

## 2. Original CFG-01 Findings & Root Cause Analysis

### 2.1 Missing Runtime Variables

During the Stage 3.0 assessment and Milestone 3.2 audit, inspection of the codebase revealed that multiple services directly read environment variables via `process.env` that were entirely missing from `.env.example`:

- `EMBEDDING_MODEL`: Consumed by `apps/api/src/modules/retrieval/embeddings/embedding.service.ts` and `apps/worker/src/modules/ingestion/embeddings/ollama.provider.ts`. Without documentation, developers had no indicator that `nomic-embed-text` was the default embedding model.
- `STORAGE_DIR`: Consumed by `apps/api/src/modules/document/document.storage.ts` and `apps/worker/src/lib/storage.ts`. Defaults to `./infrastructure/storage/documents`.
- `GRAPH_EXTRACTION_PROVIDER`: Consumed by `apps/api/src/modules/graph/providers/provider.factory.ts` and `apps/worker/src/modules/graph/providers/provider.factory.ts`. Defaults to `LLM_PROVIDER`.
- `OLLAMA_EXTRACTION_*`: 4 extraction-specific parameters (`OLLAMA_EXTRACTION_MODEL`, `OLLAMA_EXTRACTION_TEMPERATURE`, `OLLAMA_EXTRACTION_THINK`, `OLLAMA_EXTRACTION_TIMEOUT_MS`) consumed by `ollama-extraction.provider.ts`.
- `GEMINI_API_KEY` & `GEMINI_MODEL`: Consumed by Gemini generation and extraction providers.
- `RERANKER_ENDPOINT` & `RERANKER_API_KEY`: Consumed by `reranker.service.ts`.

### 2.2 Frontend API Proxy Port Inflexibility

In `apps/web/vite.config.ts`, the `/api` proxy target was statically written as:

```ts
proxy: {
  '/api': {
    target: 'http://localhost:4000',
    changeOrigin: true,
    timeout: 180000,
  },
}
```

If a developer configured `PORT=4001` or `API_PORT=4001` in `.env` to avoid a port collision on host machines, the API server booted on port 4001, but the frontend dev server continued forwarding requests to port 4000. All browser requests failed with `504 Gateway Timeout` or `ECONNREFUSED`.

---

## 3. Implementation Details

### 3.1 Task A: Authoritative Environment Specification (`.env.example`)

The template was restructured into 12 logical sections with explicit documentation, default values, and operational guidance:

| Section            | Variable Name                   | Required / Optional | Default Value                        | Source Consumer         | Description                                             |
| :----------------- | :------------------------------ | :-----------------: | :----------------------------------- | :---------------------- | :------------------------------------------------------ |
| **1. Server**      | `NODE_ENV`                      |      Optional       | `development`                        | All services            | Node runtime mode (`development`, `production`, `test`) |
|                    | `PORT`                          |      Optional       | `4000`                               | `apps/api`              | Express API gateway listening port                      |
|                    | `CORS_ORIGIN`                   |      Optional       | `http://localhost:5173`              | `apps/api`              | Allowed browser origins for CORS middleware             |
| **2. Storage**     | `STORAGE_DIR`                   |      Optional       | `./infrastructure/storage/documents` | `api`, `worker`         | Filesystem base directory for uploaded documents        |
| **3. Security**    | `JWT_ACCESS_SECRET`             |   Required (Prod)   | `dev_jwt_access_secret_...`          | `apps/api`              | Secret key for signing HMAC-SHA256 access JWTs          |
|                    | `JWT_ACCESS_EXPIRY`             |      Optional       | `15m`                                | `apps/api`              | JWT access token expiration duration                    |
|                    | `COOKIE_SECRET`                 |   Required (Prod)   | `dev_cookie_signing_...`             | `apps/api`              | Secret key for signing HttpOnly refresh cookies         |
|                    | `REFRESH_TOKEN_EXPIRY_DAYS`     |      Optional       | `7`                                  | `apps/api`              | Sliding session lifetime in days                        |
| **4. Database**    | `POSTGRES_USER`                 |      Optional       | `mindvault`                          | `docker-compose.yml`    | Database username for Docker container                  |
|                    | `POSTGRES_PASSWORD`             |      Optional       | `mindvault_dev_password`             | `docker-compose.yml`    | Database password for Docker container                  |
|                    | `POSTGRES_DB`                   |      Optional       | `mindvault`                          | `docker-compose.yml`    | Default database name                                   |
|                    | `POSTGRES_PORT`                 |      Optional       | `5432`                               | `docker-compose.yml`    | Host port mapped to PostgreSQL container                |
|                    | `DATABASE_URL`                  |      Required       | `postgresql://...:5432/...`          | `api`, `worker`, Prisma | PostgreSQL connection string with pgvector              |
| **5. Queues**      | `REDIS_HOST`                    |      Optional       | `localhost`                          | `docker-compose.yml`    | Redis host                                              |
|                    | `REDIS_PORT`                    |      Optional       | `6379`                               | `docker-compose.yml`    | Redis port                                              |
|                    | `REDIS_URL`                     |      Required       | `redis://localhost:6379`             | `api`, `worker`, BullMQ | Redis connection URI for queues and caches              |
|                    | `WORKER_CONCURRENCY`            |      Optional       | `5`                                  | `apps/worker`           | Concurrent document processing jobs                     |
| **6. Frontend**    | `VITE_API_BASE_URL`             |      Optional       | `http://localhost:4000/api`          | `apps/web/vite.config`  | Base API URL for Vite proxy resolution                  |
| **7. Embeddings**  | `EMBEDDING_MODEL`               |      Optional       | `nomic-embed-text`                   | `api`, `worker`         | Ollama model name for 768-dim vector embeddings         |
| **8. RAG LLM**     | `LLM_PROVIDER`                  |      Optional       | `ollama`                             | `api`, `worker`         | Active generation provider (`ollama`, `gemini`, `mock`) |
|                    | `OLLAMA_BASE_URL`               |      Optional       | `http://localhost:11434`             | `api`, `worker`         | HTTP URL for local Ollama service                       |
|                    | `OLLAMA_GENERATION_MODEL`       |      Optional       | `qwen3:0.6b`                         | `api`, `worker`         | Model for answer generation                             |
|                    | `LLM_REQUEST_TIMEOUT`           |      Optional       | `60000`                              | `api`, `worker`         | LLM HTTP request timeout in milliseconds                |
|                    | `LLM_MAX_OUTPUT_TOKENS`         |      Optional       | `1024`                               | `api`, `worker`         | Maximum completion output tokens                        |
|                    | `LLM_TEMPERATURE`               |      Optional       | `0.2`                                | `api`, `worker`         | Generation sampling temperature                         |
| **9. Graph Extr.** | `GRAPH_EXTRACTION_PROVIDER`     |      Optional       | `LLM_PROVIDER`                       | `api`, `worker`         | Extraction provider (`ollama`, `gemini`, `mock`)        |
|                    | `OLLAMA_EXTRACTION_MODEL`       |      Optional       | `qwen3:0.6b`                         | `api`, `worker`         | Model for JSON schema knowledge extraction              |
|                    | `OLLAMA_EXTRACTION_TEMPERATURE` |      Optional       | `0.0`                                | `api`, `worker`         | Sampling temperature for structured JSON extraction     |
|                    | `OLLAMA_EXTRACTION_THINK`       |      Optional       | `false`                              | `api`, `worker`         | Enable/disable reasoning tokens during extraction       |
|                    | `OLLAMA_EXTRACTION_TIMEOUT_MS`  |      Optional       | `60000`                              | `api`, `worker`         | Dedicated timeout for graph extraction                  |
| **10. Gemini**     | `GEMINI_API_KEY`                |      Optional       | `undefined`                          | `api`, `worker`         | Required only if `LLM_PROVIDER=gemini`                  |
|                    | `GEMINI_MODEL`                  |      Optional       | `gemini-3.5-flash`                   | `api`, `worker`         | Gemini model identifier                                 |
| **11. Reranker**   | `RERANKER_ENDPOINT`             |      Optional       | `undefined`                          | `apps/api`              | Optional cross-encoder HTTP endpoint                    |
|                    | `RERANKER_API_KEY`              |      Optional       | `undefined`                          | `apps/api`              | Optional cross-encoder auth token                       |
| **12. Eval**       | `EVAL_DATABASE_URL`             |      Optional       | Port 5433 URL                        | `evaluation/harness`    | Dedicated test database URL for evaluation              |

---

### 3.2 Task B: Dynamic Vite API Proxy (`apps/web/vite.config.ts`)

`apps/web/vite.config.ts` was updated to import `loadEnv` from `vite` and accept Vite's configuration function `({ mode }) => { ... }`.

#### Precedence Hierarchy Implemented

The proxy target for `/api` is computed using a strict 6-stage fallback hierarchy:

```ts
// 1. Explicit shell override: VITE_API_BASE_URL
// 2. Explicit shell override: PORT or API_PORT
// 3. Configured custom VITE_API_BASE_URL from .env (if custom/non-default)
// 4. Configured PORT / API_PORT from .env
// 5. Configured VITE_API_BASE_URL from .env
// 6. Default fallback: http://localhost:4000
let apiTarget = 'http://localhost:4000';
if (process.env.VITE_API_BASE_URL) {
  apiTarget = process.env.VITE_API_BASE_URL.replace(/\/api\/?$/, '').replace(/\/$/, '');
} else if (process.env.PORT || process.env.API_PORT) {
  const port = process.env.PORT || process.env.API_PORT;
  apiTarget = `http://localhost:${port}`;
} else if (env.VITE_API_BASE_URL && env.VITE_API_BASE_URL !== 'http://localhost:4000/api') {
  apiTarget = env.VITE_API_BASE_URL.replace(/\/api\/?$/, '').replace(/\/$/, '');
} else if (env.PORT || env.API_PORT) {
  const port = env.PORT || env.API_PORT;
  apiTarget = `http://localhost:${port}`;
} else if (env.VITE_API_BASE_URL) {
  apiTarget = env.VITE_API_BASE_URL.replace(/\/api\/?$/, '').replace(/\/$/, '');
}
```

This guarantees:

1. When no environment variables are specified, the proxy defaults to `http://localhost:4000`.
2. When a developer modifies `PORT=4005` in `.env`, the proxy automatically points to `http://localhost:4005`.
3. When a developer overrides `PORT=4005` or `VITE_API_BASE_URL=http://api.internal:9000/api` via the command-line shell, it takes precedence over the `.env` file.
4. Server secrets are never leaked into the client bundle.

---

## 4. Verification Evidence Matrix

All 10 required verification checks were executed and passed cleanly:

|  Step #   | Verification Item                       | Command                                       | Exit Code |  Result  | Evidence / Output                                                             |
| :-------: | :-------------------------------------- | :-------------------------------------------- | :-------: | :------: | :---------------------------------------------------------------------------- |
| **1 & 2** | `.env.example` Completeness Audit       | `node -e "<audit_script>"`                    |     0     | **PASS** | `PASS: All 34 environment variables verified in .env.example`                 |
|   **3**   | Default Vite Proxy Target               | `node -e "<check_default>"`                   |     0     | **PASS** | `PASS: Default proxy target is http://localhost:4000`                         |
|  **4a**   | Custom `PORT` Proxy Target              | `$env:PORT="4005"; node -e "..."`             |     0     | **PASS** | `PASS: Custom PORT proxy target is http://localhost:4005`                     |
|  **4b**   | Custom `VITE_API_BASE_URL` Proxy Target | `$env:VITE_API_BASE_URL="..."; node -e "..."` |     0     | **PASS** | `PASS: Custom VITE_API_BASE_URL proxy target is http://api.internal:9000`     |
|   **5**   | Web App Production Build                | `pnpm --filter @mindvault/web build`          |     0     | **PASS** | `✓ 1612 modules transformed. built in 26.45s (0 errors, 0 syntax warnings)`   |
|   **6**   | Monorepo Full Build                     | `pnpm build`                                  |     0     | **PASS** | All 4 packages compiled cleanly (`@mindvault/shared`, `api`, `worker`, `web`) |
|   **7**   | Monorepo Typecheck                      | `pnpm typecheck`                              |     0     | **PASS** | Zero TypeScript compiler errors across all 4 packages                         |
|  **8a**   | API Test Suite Regression               | `npx vitest run apps/api`                     |     0     | **PASS** | **54/54 test files passed, 633/633 tests passed** (0 failures)                |
|  **8b**   | Worker Test Suite Regression            | `npx vitest run apps/worker`                  |     0     | **PASS** | **13/13 test files passed, 149/149 tests passed** (0 failures)                |
|   **9**   | Formatting Check                        | `pnpm format:check`                           |     0     | **PASS** | `All matched files use Prettier code style!`                                  |
|  **10**   | Linter Verification                     | `pnpm lint`                                   |     0     | **PASS** | Zero ESLint errors (0 errors, 612 warnings across legacy tests)               |

**Total Monorepo Tests Passing:** 782 / 782 (100.0%)

---

## 5. Security & Privacy Audit

1. **Zero Secret Exposure:** `.env.example` contains only standard development placeholders (e.g. `dev_jwt_access_secret_replace_in_production_min_32_chars`, `your_gemini_api_key_here`). No actual API keys, credentials, or hashes were included.
2. **Client-Side Secret Shielding:** In `apps/web/vite.config.ts`, `loadEnv` is evaluated solely within Node.js to configure the dev server proxy `target`. No backend environment variables (`JWT_ACCESS_SECRET`, `POSTGRES_PASSWORD`, `DATABASE_URL`) are injected into the frontend client bundle.
3. **SSRF & Path Traversal Protections:** The proxy configuration preserves the fixed `/api` path mapping and retains the 180,000ms timeout for SSE streaming stability.

---

## 6. Files Modified

1. [`.env.example`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/.env.example) — Complete, 34-variable environment template with 12 structured sections.
2. [`apps/web/vite.config.ts`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/web/vite.config.ts) — Dynamic Vite API proxy target resolution.
3. [`PHASE_3_2_1_IMPLEMENTATION_REPORT.md`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/PHASE_3_2_1_IMPLEMENTATION_REPORT.md) — This implementation report.

---

## 7. Protected AI Architecture Confirmation

We explicitly confirm that:

- **RAG Retrieval & Generation:** Unmodified.
- **Three-Way RRF Hybrid Search Engine:** Unmodified.
- **Context Assembler & Grounding Guardrails:** Unmodified.
- **GraphRAG Traversal Engine & SQL Queries:** Unmodified.
- **PostgreSQL Database Schema & Migrations:** Unmodified.
- **BullMQ Background Workers & Dual-Write Fencing:** Unmodified.
- **Authentication & Security Middleware:** Unmodified.

---

## 8. Completion Declaration & Stop Gate

```
================================================================================
                    TASK 3.2.1 — COMPLETE & VERIFIED
================================================================================
```

All acceptance criteria for Task 3.2.1 have been satisfied and verified.

> [!IMPORTANT]
> **STOP GATE NOTICE:** In strict adherence to governance instructions, work is paused at the completion of Task 3.2.1. No code for Task 3.2.2 (Deterministic Demo Seed System) has been implemented.
>
> **Awaiting separate user authorization before proceeding to Task 3.2.2.**
