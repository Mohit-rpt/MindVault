# MindVault — Local Windows Worker Operational & Setup Guide

**Architecture:** Cloud API + Cloud PostgreSQL (pgvector) + Cloud Upstash Redis (TLS) + Local Windows Worker & Ollama  
**Target Host Platform:** Windows 11 (Intel Core i3-1115G4, 8 GB RAM)  
**Worker Concurrency:** `WORKER_CONCURRENCY=1` (Strictly enforced)  
**Status:** **LOCALLY OPERATIONAL & END-TO-END VERIFIED**

---

## 1. System Overview & Architecture

MindVault uses a hybrid cloud-to-local distributed architecture designed for low-cost, high-privacy personal knowledge processing:

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
|                            | Local HTTP (:11434)                              |
|                            v                                                  |
|  +-------------------------------------------------------------------------+  |
|  | Local Ollama Service                                                    |  |
|  | - Embedding:  nomic-embed-text (768 dimensions)                         |  |
|  | - Generation: qwen3:0.6b (or qwen3:1.7b)                                |  |
|  +-------------------------------------------------------------------------+  |
+-------------------------------------------------------------------------------+
```

---

## 2. Prerequisites & Hardware Requirements

| Requirement          | Specification                     | Verification Command                                |
| :------------------- | :-------------------------------- | :-------------------------------------------------- |
| **Operating System** | Windows 11 (x64)                  | `[System.Environment]::OSVersion.VersionString`     |
| **Node.js**          | v24.22.3 (or >= 20.0.0)           | `node --version`                                    |
| **Package Manager**  | pnpm v12.16.1 (or >= 9.0.0)       | `pnpm --version`                                    |
| **Local Inference**  | Ollama for Windows                | `Invoke-RestMethod http://127.0.0.1:11434/api/tags` |
| **Required Models**  | `nomic-embed-text`, `qwen3:0.6b`  | `ollama list`                                       |
| **Hardware**         | Intel Core i3 / Ryzen 3, 8 GB RAM | Tested on i3-1115G4 (4 cores @ 3.00 GHz)            |

### Installing Required Models

```powershell
ollama pull nomic-embed-text
ollama pull qwen3:0.6b
```

---

## 3. Environment Variable Configuration (`.env`)

```ini
# =============================================================================
# PostgreSQL Database & pgvector
# =============================================================================
DATABASE_URL="postgresql://mindvault:[PASSWORD]@localhost:5433/mindvault?schema=public"

# =============================================================================
# Upstash Redis Queue (Must start with rediss:// for production TLS)
# =============================================================================
REDIS_URL="rediss://default:[TOKEN]@your-db-id.upstash.io:6379"

# =============================================================================
# Worker Runtime & Hardware Profile (8 GB RAM Constraint)
# =============================================================================
WORKER_CONCURRENCY=1
WORKER_TYPE=all
WORKER_SHUTDOWN_TIMEOUT_MS=60000

# =============================================================================
# Local AI Inference (Ollama)
# =============================================================================
OLLAMA_BASE_URL="http://localhost:11434"
EMBEDDING_MODEL="nomic-embed-text"
OLLAMA_GENERATION_MODEL="qwen3:0.6b"
LLM_REQUEST_TIMEOUT=60000
LLM_MAX_OUTPUT_TOKENS=1024
LLM_TEMPERATURE=0.2

# =============================================================================
# Storage Directory
# =============================================================================
STORAGE_DIR="./infrastructure/storage/documents"
```

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
[ PASS ] Ollama online at http://localhost:11434
[ PASS ] Embedding model 'nomic-embed-text' installed
[ PASS ] Generation model 'qwen3:0.6b' installed
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
