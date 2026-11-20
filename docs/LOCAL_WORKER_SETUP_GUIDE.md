# MindVault — Local Windows Worker Operational & Setup Guide

**Architecture:** Cloud API + Cloud PostgreSQL (pgvector) + Cloud Upstash Redis (TLS) + Windows Background Worker + Google Gemini Cloud AI  
**Target Host Platform:** Windows 11 (Intel Core i3-1115G4, 8 GB RAM)  
**Worker Concurrency:** `WORKER_CONCURRENCY=1` (Strictly enforced)  
**Status:** **LOCALLY OPERATIONAL & END-TO-END VERIFIED**

---

## 1. System Overview & Architecture

MindVault uses an asynchronous distributed architecture designed for low-cost, high-privacy personal knowledge processing with cloud-native AI:

```
+-------------------------------------------------------------------------------+
|                             CLOUD SERVICES                                    |
|                                                                               |
|  +--------------------+         +------------------------------------------+  |
|  |  Express Cloud API |         | Cloud PostgreSQL 16.15                   |  |
|  |  (Fast HTTP/Auth)  |         | - pgvector 0.8.7 (vector(768) HNSW)      |  |
|  +---------+----------+         | - Relational knowledge graph & sessions  |  |
|            |                    +--------------------+---------------------+  |
|            |                                         ^                        |
|            v (Enqueue Job)                           | (Persist Vectors)      |
|  +--------------------+                              |                        |
|  | Upstash Redis TLS  |                              |                        |
|  | (Queue Transport)  |                              |                        |
|  +---------+----------+                              |                        |
+------------|-----------------------------------------|------------------------+
             | TLS (rediss://)                         |
             v (Consume Job)                           |
+------------------------------------------------------|------------------------+
|                      LOCAL WINDOWS 11 WORKSTATION    |                        |
|                                                      |                        |
|  +---------------------------------------------------+---------------------+  |
|  | MindVault Background Worker / Smart Companion                           |  |
|  | - Document Ingestion Pipeline (Text extract, normalize, chunk)          |  |
|  | - Knowledge Graph Worker (Entity extraction, relation resolution)      |  |
|  | - Single-instance file lock & cooperative 8-second chunk budget        |  |
|  +-------------------------+-----------------------------------------------+  |
|                            | HTTPS (Google Gen AI SDK)                        |
|                            v                                                  |
|  +-------------------------------------------------------------------------+  |
|  | Google Gemini Cloud AI Service                                          |  |
|  | - Embedding:  gemini-embedding-2 (768 dimensions Matryoshka)           |  |
|  | - Extraction: gemini-3.5-flash (Strict JSON Schema extraction)          |  |
|  +-------------------------------------------------------------------------+  |
+-------------------------------------------------------------------------------+
```

---

## 2. Prerequisites & Hardware Requirements

| Requirement          | Specification                     | Verification Command                            |
| :------------------- | :-------------------------------- | :---------------------------------------------- |
| **Operating System** | Windows 11 (x64)                  | `[System.Environment]::OSVersion.VersionString` |
| **Node.js**          | v24.22.3 (or >= 20.0.0)           | `node --version`                                |
| **Package Manager**  | pnpm v12.16.1 (or >= 9.0.0)       | `pnpm --version`                                |
| **Cloud AI**         | Google Gemini Developer API Key   | Obtained from [Google AI Studio](https://aistudio.google.com/) |
| **Hardware**         | Intel Core i3 / Ryzen 3, 8 GB RAM | Tested on i3-1115G4 (4 cores @ 3.00 GHz)        |

---

## 3. Environment Variable Configuration (`.env`)

```ini
# =============================================================================
# PostgreSQL Database & pgvector
# =============================================================================
DATABASE_URL="postgresql://mindvault:[PASSWORD]@localhost:5433/mindvault?schema=public"

# =============================================================================
# Redis Queue Configuration
# =============================================================================
# Local Development (Default): Point to local Docker Redis instance
REDIS_URL="redis://localhost:6379"

# Remote Redis Guard (§P0):
# If connecting a development worker to remote Upstash Redis, you MUST explicitly
# set DEV_ALLOW_REMOTE_REDIS=true. Otherwise, startup fails closed to prevent
# accidental consumption of production user workloads from your local workstation.
# DEV_ALLOW_REMOTE_REDIS=true

# =============================================================================
# Worker Runtime & Hardware Profile (8 GB RAM Constraint)
# =============================================================================
WORKER_CONCURRENCY=1
# For local companion / dev work, use WORKER_TYPE=local to isolate from cloud queues.
# Production cloud workers run with WORKER_TYPE=cloud via Dockerfile.worker.
WORKER_TYPE=local
WORKER_SHUTDOWN_TIMEOUT_MS=60000

# =============================================================================
# Google Gemini Cloud AI
# =============================================================================
LLM_PROVIDER="gemini"
EMBEDDING_PROVIDER="gemini"
GEMINI_API_KEY="your_gemini_api_key_here"
GEMINI_MODEL="gemini-3.5-flash"
GEMINI_EMBEDDING_MODEL="gemini-embedding-2"
EMBEDDING_MODEL="gemini-embedding-2"
LLM_REQUEST_TIMEOUT=60000
LLM_MAX_OUTPUT_TOKENS=1024
LLM_TEMPERATURE=0.2

# =============================================================================
# Storage Directory
# =============================================================================
STORAGE_DIR="./infrastructure/storage/documents"
```

> [!IMPORTANT]
> **Production Cloud Deployments:** For instructions on deploying the containerized cloud worker service to Render, Railway, or VPS, see [`docs/CLOUD_WORKER_DEPLOYMENT_GUIDE.md`](./CLOUD_WORKER_DEPLOYMENT_GUIDE.md).

---

## 4. Operational Startup Commands

### Step 1: Run Preflight Diagnostic

Always verify dependencies and database extensions before starting the worker:

```powershell
pnpm worker:preflight
```

_Expected Output:_

```text
[ PASS ] .env structure verified without duplicate keys
[ PASS ] Valid Upstash Redis TLS URL
[ PASS ] Worker concurrency configured: 1
[ PASS ] Redis connection established
[ PASS ] PostgreSQL connected successfully
[ PASS ] pgvector extension active (version: 0.8.7)
[ PASS ] Gemini API Key configured: AIza...7890 (length 39)
[ PASS ] Target models: generation='gemini-3.5-flash', embedding='gemini-embedding-2' (768-D)
[ PASS ] Storage directory accessible
RESULT: LOCAL WORKER PREFLIGHT PASSED
```

### Step 2: Launch the Worker

#### Option A: Direct Local Worker Execution (Recommended for Demos & Development)

```powershell
.\scripts\start-local-worker.ps1
# or via pnpm:
pnpm worker:dev
```

#### Option B: Smart Companion with Idle Power-Saving & Auto-Wake

```powershell
# 1. Pair the Windows device (one-time interactive setup):
pnpm companion:dev --pair

# 2. Check pairing and queue status:
pnpm companion:dev --status

# 3. Launch companion daemon:
pnpm companion:dev
```

### Step 3: Run the API and Web Frontend

In separate terminal windows:

```powershell
# Terminal 2: API
pnpm dev:api

# Terminal 3: Web UI
pnpm dev:web
```

---

## 5. Graceful Shutdown & Failure Recovery

### Clean Shutdown

Press `Ctrl+C` in the worker terminal.
The graceful shutdown protocol initiates a two-phase coordinated drain:

1. **Queue Pause:** Pauses polling on BullMQ queues so no new jobs are picked up.
2. **Cooperative Chunk Completion Budget:** In-flight LLM calls receive an 8-second budget to finish their current chunk.
3. **Dual Lease Preservation:** If the budget expires, the worker updates PostgreSQL state to `QUEUED` and moves the job back to the BullMQ wait list via `moveToWait` without incrementing `attemptsMade`.
4. **Leader Lock Release:** Closes Redis lease locks and terminates cleanly.

### Hard Stop Script

If an orphaned worker or companion process needs to be stopped:

```powershell
.\scripts\stop-mindvault-companion.ps1
```

---

## 6. Real End-to-End Verification

To verify that the complete pipeline (API Producer → Upstash Redis → BullMQ → Local Worker → PostgreSQL vector chunks) functions without manual intervention:

```powershell
pnpm test:e2e:worker
```

_Expected Result:_

```text
RESULT: REAL END-TO-END INTEGRATION FULLY VERIFIED
API (Producer) → Upstash Redis → BullMQ → Worker → PostgreSQL: SUCCESS
```
