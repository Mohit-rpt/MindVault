# MindVault — Sprint 5 Deployment & Staging Operations Guide

**Version:** 1.0.0  
**Target Environments:** Local Simulation Staging & Private Cloud Staging  
**Author:** Antigravity Engineering Agent

---

## 1. Overview & Safety Rules

This guide provides step-by-step instructions for operating MindVault staging environments.

> [!CAUTION]
> **Production Boundary:** Under no circumstances should staging scripts or deployment actions connect to production databases, modify production Redis queues, or use production API keys.

---

## 2. Environment Prerequisites

- **Node.js:** 22.x LTS
- **Package Manager:** pnpm 12.16.1 (`corepack enable`)
- **Container Engine:** Docker Engine 24+ & Docker Compose v2 (if running local staging topology)
- **Database:** PostgreSQL 16 with `pgvector` extension
- **Redis:** Redis 7.x (with TLS in cloud staging)

---

## 3. Local Staging Simulation Topology

MindVault includes a 100% isolated, local staging simulation in `docker-compose.staging.yml`:

```bash
# 1. Run staging preflight checks
./scripts/deploy-staging.ps1 -Action validate-only
# On Linux / macOS:
# ./scripts/deploy-staging.sh validate-only

# 2. Build and boot the complete staging stack
./scripts/deploy-staging.ps1 -Action local-simulation
# On Linux / macOS:
# ./scripts/deploy-staging.sh local-simulation

# 3. View container health & logs
docker compose -f docker-compose.staging.yml ps
docker compose -f docker-compose.staging.yml logs -f api

# 4. Stop staging simulation and wipe test volumes
./scripts/deploy-staging.ps1 -Action down
# On Linux / macOS:
# ./scripts/deploy-staging.sh down
```

### Endpoints in Local Simulation
- **Frontend SPA (Nginx):** `http://localhost:8080`
- **Backend API:** `http://localhost:4000` (Direct) / `http://localhost:8080/api` (Proxied)
- **MinIO S3 Console:** `http://localhost:9001` (User: `staging_minio_admin`, Password: `staging_minio_secret_key_1234567890`)
- **Postgres:** `localhost:5433` (DB: `mindvault_staging`)
- **Redis:** `localhost:6380`

---

## 4. Cloud Staging Deployment (Neon, Upstash, R2, Railway)

When deploying to a private cloud staging environment (gated behind explicit approval):

### Step 1: Provision Isolated Cloud Resources
1. **Neon PostgreSQL:**
   - Create a dedicated staging project `mindvault-staging`.
   - Ensure the database has `vector` extension enabled (`CREATE EXTENSION IF NOT EXISTS vector;`).
   - Obtain pooled connection string for API and direct connection string for Worker.
2. **Upstash Redis:**
   - Create a dedicated staging database `mindvault-staging-redis`.
   - Copy connection URI starting with `rediss://`.
3. **Cloudflare R2:**
   - Create bucket `mindvault-staging-documents`.
   - Generate S3 API tokens with scoped read/write access to that bucket only.

### Step 2: Database Migration
Run migrations against the staging database:
```bash
DATABASE_URL="postgresql://...mindvault-staging...sslmode=require" pnpm db:migrate
```

### Step 3: Deploy API Container
Deploy using `Dockerfile.api`:
- **Image:** Built from root context targeting `Dockerfile.api`.
- **Environment:**
  - `NODE_ENV=staging`
  - `PORT=4000`
  - `CORS_ORIGIN=https://staging.mindvault.com`
  - `DATABASE_URL=<neon_staging_url>`
  - `REDIS_URL=<upstash_rediss_url>`
  - `JWT_ACCESS_SECRET=<32_char_staging_secret>`
  - `COOKIE_SECRET=<32_char_staging_secret>`
  - `STORAGE_PROVIDER=r2`
  - `STORAGE_ENDPOINT=https://<account_id>.r2.cloudflarestorage.com`
  - `STORAGE_BUCKET=mindvault-staging-documents`
  - `STORAGE_ACCESS_KEY_ID=<r2_token_id>`
  - `STORAGE_SECRET_ACCESS_KEY=<r2_token_secret>`
  - `GEMINI_API_KEY=<staging_gemini_key>`

### Step 4: Deploy Cloud Worker Container
Deploy using `Dockerfile.worker`:
- **Image:** Built from root context targeting `Dockerfile.worker`.
- **Environment:**
  - `NODE_ENV=staging`
  - `WORKER_TYPE=cloud`
  - `WORKER_CONCURRENCY=2`
  - `DATABASE_URL=<neon_staging_url>`
  - `REDIS_URL=<upstash_rediss_url>`
  - `STORAGE_PROVIDER=r2`
  - `STORAGE_ENDPOINT=https://<account_id>.r2.cloudflarestorage.com`
  - `STORAGE_BUCKET=mindvault-staging-documents`
  - `STORAGE_ACCESS_KEY_ID=<r2_token_id>`
  - `STORAGE_SECRET_ACCESS_KEY=<r2_token_secret>`
  - `GEMINI_API_KEY=<staging_gemini_key>`

### Step 5: Deploy Frontend SPA
Deploy `apps/web/dist` to Cloudflare Pages or Vercel:
- Build command: `pnpm --filter @mindvault/web build`
- Output directory: `apps/web/dist`
- Configure reverse proxy or set `VITE_API_BASE_URL` to staging API gateway.

---

## 5. Verification & Health Check

After deployment, verify the staging environment:
1. Probe API health: `GET https://<staging-api>/api/health` -> Expect `{ status: "ok" }`.
2. Inspect worker heartbeat in Redis: Key `mindvault:worker:heartbeat:*` has fresh TTL.
3. Perform synthetic smoke test: Upload a synthetic text document via web UI and verify status progresses from `QUEUED` -> `PROCESSING` -> `COMPLETED`.
4. Submit a RAG question and observe real-time SSE token streaming and citation pills.

---

## 6. Rollback Procedures

If an issue is detected during staging deployment:
1. **Container Rollback:** In the hosting dashboard (Railway / Render / Fly), roll back the deployment to the previous stable release commit.
2. **Database Rollback:** MindVault database migrations are strictly backward-compatible. If a column was added, it is nullable or has a safe default.
3. **Queue Evacuation:** If a poisoned job blocks staging queues, purge only the staging queue via Redis CLI: `DEL bull:doc-queue-*-cloud:*`. Never target production queue namespaces.
