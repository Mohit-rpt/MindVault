# MindVault — Cloud Worker Deployment & Decoupling Guide

**Sprint:** Product Completion Sprint 3  
**Status:** **PRODUCTION DEPLOYMENT CONTRACT & CONTAINER RUNBOOK**  
**Component:** `@mindvault/worker` (Dockerized Background Service)  
**Target Environments:** Render (Background Worker), Railway, Fly.io, or VPS (Docker)

---

## 1. Architectural Model & Worker Decoupling

Following Sprint 3 P0 remediation, MindVault strictly isolates background processing between cloud and local developer environments:

```
+-------------------------------------------------------------------------------------------------+
|                                    PRODUCTION CLOUD ARCHITECTURE                                |
|                                                                                                 |
|   +-----------------------+              +-----------------------+                              |
|   |   Vercel Frontend     |              |     Render Web API    |                              |
|   |   (React 18 SPA)      | ------------>|   (Express + Helmet)  |                              |
|   +-----------------------+  HTTPS / API +-----------+-----------+                              |
|                                                      |                                          |
|                       +------------------------------+---------------------------+              |
|                       | (Cloud Enqueue)                                          |              |
|                       v                                                          v              |
|           +-----------------------+                                  +-----------------------+  |
|           |   Upstash Redis TLS   |                                  |   Neon PostgreSQL     |  |
|           |   (BullMQ Queues)     |                                  |   (pgvector 768)      |  |
|           +-----------+-----------+                                  +-----------+-----------+  |
|                       |                                                          ^              |
|                       v (Consume Cloud Jobs)                                     |              |
|           +----------------------------------------------------------------------+              |
|           |                   RENDER BACKGROUND WORKER SERVICE                   |              |
|           |                 (Dockerfile.worker / Multi-Stage Alpine)             |              |
|           |  - Document Ingestion Pipeline (Text extract, normalize, chunk)      |              |
|           |  - Gemini Embeddings 2 (768d Matryoshka vectors)                     |              |
|           |  - Knowledge Graph Extraction (Gemini 3.5 Flash JSON Schema)         |              |
|           |  - Startup & Periodic Reconciliation Engine                          |              |
|           |  - Graceful Shutdown Handling (dumb-init + SIGTERM drain)            |              |
|           +----------------------------------------------------------------------+              |
+-------------------------------------------------------------------------------------------------+

                      || ISOLATION FIREWALL (LOCAL WORKER SAFETY GUARD)
                      \/
+-------------------------------------------------------------------------------------------------+
|                                 DEVELOPER LOCAL WORKSTATION                                     |
|                                                                                                 |
|   - pnpm dev:worker ONLY connects to localhost / 127.0.0.1 Redis by default.                     |
|   - Startup BLOCKED if configured with remote Upstash Redis without DEV_ALLOW_REMOTE_REDIS=true. |
|   - WORKER_TYPE=local only processes local-capability companion jobs, never cloud queues.       |
|   - Zero customer documents or production background jobs can reach the developer's laptop.     |
+-------------------------------------------------------------------------------------------------+
```

---

## 2. Docker Container Specifications

The worker container is defined in [`Dockerfile.worker`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/Dockerfile.worker) (and mirrored at `infrastructure/docker/Dockerfile.worker`):

| Property | Value | Security / Operational Rationale |
| :--- | :--- | :--- |
| **Base Image** | `node:22-alpine` | Minimal surface area (<250MB image size) |
| **Dependencies** | `openssl`, `libc6-compat`, `dumb-init` | Native Prisma query engine runtime + signal routing |
| **User** | `node` (UID 1000) | Strictly non-root execution |
| **Process Manager** | `dumb-init` (PID 1) | Forwards `SIGTERM`/`SIGINT` to Node and reaps zombies |
| **Lifecycle** | Bounded 60s graceful shutdown | Drains current in-flight BullMQ job without truncation |
| **Worker Mode** | `WORKER_TYPE=cloud` | Processes strictly cloud queues (`document-processing:<ws>:cloud`) |

---

## 3. Environment Variables Reference

Configure the following environment variables in your cloud provider's dashboard:

### Mandatory Production Variables
| Variable | Example Value | Description |
| :--- | :--- | :--- |
| `NODE_ENV` | `production` | Enables strict production validation and disables dev fallbacks |
| `REDIS_URL` | `rediss://default:token@cool-lion-1234.upstash.io:6379` | **Must use `rediss://`** (native TLS). Plain `redis://` is rejected |
| `DATABASE_URL` | `postgresql://user:pw@ep-xyz.neon.tech/neondb?sslmode=require` | Connection string to cloud Neon PostgreSQL database |
| `GEMINI_API_KEY` | `AIzaSyD...` | Production Google Gemini API key with embedding & generation access |
| `WORKER_TYPE` | `cloud` | Configures worker to process cloud queues |

### Performance & Resource Configuration
| Variable | Default | Recommended Production Value | Notes |
| :--- | :--- | :--- | :--- |
| `WORKER_CONCURRENCY` | `1` | `1` (Free/Starter) or `2` (Standard) | Prevents memory exhaustion on 512MB RAM instances |
| `GEMINI_MODEL` | `gemini-3.5-flash` | `gemini-3.5-flash` | LLM used for structured Knowledge Graph extraction |
| `GEMINI_EMBEDDING_MODEL` | `gemini-embedding-2` | `gemini-embedding-2` | Target embedding model (768 dimensions) |
| `GEMINI_EMBEDDING_RPM_LIMIT` | `300` | `300` | Rate limiter window for Gemini embedding API |
| `LLM_REQUEST_TIMEOUT` | `60000` | `60000` | 60-second timeout for inference calls |

---

## 4. Step-by-Step Deployment on Render

### Step 1: Create a Background Worker Service
1. Log in to [Render Dashboard](https://dashboard.render.com/).
2. Click **New +** -> **Background Worker**.
3. Connect your MindVault GitHub repository.

### Step 2: Configure Service Settings
- **Name:** `mindvault-worker`
- **Region:** Same region as your Neon database and Render API (e.g., `Oregon (US West)` or `Frankfurt (EU Central)`).
- **Branch:** `main`
- **Environment:** `Docker`
- **Dockerfile Path:** `Dockerfile.worker`
- **Docker Build Context Directory:** `.` (Repository root)
- **Instance Type:** `Starter` ($7/mo) or free tier compatible. 512 MB RAM / 0.5 CPU is sufficient for `WORKER_CONCURRENCY=1`.

### Step 3: Add Environment Variables
In the **Environment** tab, add all mandatory variables:
- `NODE_ENV` = `production`
- `REDIS_URL` = `<your-upstash-redis-url-with-rediss://>`
- `DATABASE_URL` = `<your-neon-database-url>`
- `GEMINI_API_KEY` = `<your-google-gemini-api-key>`
- `WORKER_TYPE` = `cloud`
- `WORKER_CONCURRENCY` = `1`

### Step 4: Deploy & Verify Logs
Click **Create Background Worker**. Monitor deployment logs. You should observe:
```
[WorkerRoot] 🚀 MindVault background worker initialized {"concurrency":1,"redisUrl":"rediss://...","environment":"production"}
[WorkerRoot] ✅ Google Gemini configured (API key present, target models: gemini-3.5-flash, gemini-embedding-2)
[WorkerRoot] Executing startup graph reconciliation...
[WorkerRoot] Startup graph reconciliation completed {"scannedCount":0,"finalizedCount":0}
[MINDVAULT_WORKER_READY] Worker runtime initialized and ready
```

---

## 5. Verification & Observability

### 5.1 Heartbeat Health Probe
The cloud worker continuously publishes heartbeat telemetry to Upstash Redis (`mindvault:worker:heartbeat`) every 30 seconds.

Verify worker status via the Express API:
```bash
# Public query (sanitized, zero physical host leakage)
curl https://api.mindvault.example.com/api/health/worker

# Response:
{
  "status": "online",
  "lastHeartbeatAt": "2026-11-20T14:45:00.000Z",
  "concurrency": 1,
  "environment": "production"
}
```

To view internal diagnostics:
```bash
curl -H "x-diagnostics-token: <INTERNAL_DIAGNOSTICS_TOKEN>" https://api.mindvault.example.com/api/health/worker
```

### 5.2 Processing Verification
1. Upload a document via the MindVault frontend.
2. In Render worker logs, observe:
   - `[DocumentIngestionPipeline] Starting ingestion for document doc_...`
   - `[DocumentIngestionPipeline] Successfully completed ingestion: X chunks embedded`
   - `[GraphExtractionWorker] Document doc_... extraction completed with status COMPLETED`
3. Document transitions from `QUEUED` -> `PROCESSING` -> `COMPLETED` on the dashboard.

---

## 6. Local Developer Safety Verification

Developers can run local tests without risk:
```bash
# Safe local run against Docker Redis
pnpm dev:worker

# If .env contains remote Upstash Redis, startup is automatically blocked:
# ❌ Invalid worker environment configuration:
#   - REDIS_URL: CRITICAL SECURITY GUARD: Worker in development mode attempted to connect to remote/cloud Redis...
```
