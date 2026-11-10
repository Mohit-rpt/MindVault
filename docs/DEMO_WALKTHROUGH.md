# MindVault — Presenter Walkthrough Guide

**Target Audience:** Technical Presenters, Solution Architects, Evaluators  
**Estimated Demo Duration:** 10–15 Minutes  
**Prerequisites Required:** Local Docker infrastructure (PostgreSQL + Redis), seeded showcase workspace  
**Primary Interface:** Web Dashboard (`http://localhost:5173`)  
**Demo Account:** `demo@mindvault.local` / `DemoPassword123!`

---

## 1. Demo Overview

### 1.1 What MindVault Is

MindVault is an **AI-powered personal knowledge operating system** built with TypeScript, React, Node.js, PostgreSQL (`pgvector`), and Redis. It transforms disconnected technical documents, specifications, runbooks, and notes into an interconnected, evidence-grounded intelligence platform.

### 1.2 The Problem MindVault Solves

Traditional enterprise document search and naive RAG implementations suffer from fundamental flaws:

1. **Hallucination & Fabrication:** Generic chatbot wrappers synthesize convincing answers without verifiable attribution, confusing external model training priors with authoritative internal knowledge.
2. **Single-Channel Retrieval Blindness:** Vector search alone fails on exact identifiers, function names, and technical codes, while keyword search fails on semantic paraphrasing.
3. **Disjointed Knowledge & Lost Relations:** Documents naturally connect (e.g., an API gateway dispatches to a retrieval service, which queries an index), but flat chunk retrieval treats every excerpt as isolated text.
4. **Tenant Data Leakage:** Multi-tenant systems frequently introduce Insecure Direct Object Reference (IDOR) vulnerabilities where users inadvertently query across workspace boundaries.

### 1.3 Key Architectural Differentiators

- **Three-Way Hybrid Search (RRF $k=60$):** Blends dense vector search (768-dimensional cosine distance via `pgvector` HNSW indexes) and full-text search (PostgreSQL `tsvector` with `ts_rank_cd`), fused using Reciprocal Rank Fusion.
- **Relational GraphRAG:** Extracts entities and directed relationships with verbatim text evidence, enabling recursive multi-hop dependency discovery across documents.
- **Fail-Closed Citation Validation:** Verifies generated bracketed citations (`[S1]`, `[S2]`) against actual retrieved chunks, tagging answers as `GROUNDED`, `PARTIALLY_GROUNDED`, or `INSUFFICIENT_EVIDENCE`.
- **Cryptographic Tenant Isolation:** Enforces workspace scoping directly at the SQL database query level (`WHERE c."workspaceId" = $1`), mathematically preventing cross-tenant leakage.
- **Offline Deterministic Showcase:** Ships with a complete, offline-capable technical corpus, pre-computed unit vectors, and verified multi-turn conversation history.

---

## 2. Prerequisites & System Requirements

### 2.1 Software & Tooling

| Software                    | Required Version            | Verification Command     | Purpose                                        |
| :-------------------------- | :-------------------------- | :----------------------- | :--------------------------------------------- |
| **Node.js**                 | `v20.x` or `v22.x` LTS      | `node -v`                | JavaScript runtime environment                 |
| **pnpm**                    | `v9.x`, `v10.x`, or `v12.x` | `pnpm -v`                | Fast, disk-efficient package manager           |
| **Docker & Docker Compose** | Docker v24+ / Compose v2+   | `docker compose version` | Containers for PostgreSQL (`pgvector`) & Redis |
| **Git**                     | `v2.40+`                    | `git -v`                 | Version control                                |

### 2.2 Infrastructure Services (Mandatory)

- **PostgreSQL 16 + pgvector (`v0.8.7`):** Relational schema, vector cosine similarity indexes, full-text search dictionaries.
- **Redis 7 (Alpine):** High-speed session cache, rate-limiting, and BullMQ asynchronous task queues.

### 2.3 AI Provider Options (One Required for Live Generation)

MindVault is provider-agnostic. You can deliver a full demonstration using any of the following modes:

1. **Local Ollama (Recommended for 100% Local/Private Demo):**
   - Service URL: `http://localhost:11434`
   - Generation Model: `qwen3:0.6b` (or `qwen3:1.7b`)
   - Embedding Model: `nomic-embed-text` (generates 768-dimensional dense vectors)
2. **Google Gemini (Recommended for High-Speed Cloud Demo):**
   - Environment Variable: `GEMINI_API_KEY` configured in `.env`
   - Default Model: `gemini-3.5-flash`
3. **Offline Exploration Mode (Zero External AI Required):**
   - If neither Ollama nor Gemini is available, the pre-seeded showcase workspace can still be fully browsed, searched, and demonstrated with pre-computed unit vectors, complete multi-turn conversation history, and interactive knowledge graph navigation.

### 2.4 Hardware Resource Expectations

- **Memory:** Minimum 4 GB RAM available for Docker containers and Node.js processes (8 GB recommended if running Ollama locally).
- **Disk Space:** ~1.5 GB free disk space for containers and dependencies.

---

## 3. Startup Procedure

Follow these exact steps to launch the MindVault environment:

### Step 1: Configure Environment Variables

If `.env` does not already exist, copy it from the template:

```bash
# On Linux / macOS:
cp .env.example .env

# On Windows PowerShell:
Copy-Item .env.example .env
```

Ensure the database port in `.env` matches your Docker configuration:

- Default `docker-compose.yml` maps port `5432:5432` (or `5433:5432` if port 5432 is occupied on your host).
- Verify `DATABASE_URL` in `.env`:
  ```
  DATABASE_URL=postgresql://mindvault:mindvault_dev_password@localhost:5432/mindvault?schema=public
  ```

### Step 2: Start Infrastructure Containers

Start PostgreSQL and Redis in the background:

```bash
pnpm docker:up
```

_Expected output:_ `Container mindvault-postgres Started`, `Container mindvault-redis Started`.

### Step 3: Run Database Migrations

Apply database schema migrations and generate the Prisma Client:

```bash
pnpm db:generate
pnpm db:migrate
```

_Expected output:_ `All migrations have been successfully applied.`

### Step 4: Seed the Showcase Workspace

Populate the database with the deterministic showcase corpus:

```bash
pnpm db:seed
```

_Expected output:_

```
[Seed] Initializing MindVault Deterministic Showcase Workspace...
[Seed] Showcase user initialized: demo@mindvault.local
[Seed] Synchronizing 6 showcase technical documents...
[Seed] Populated 14 knowledge graph entities...
[Seed] Populated 16 directed relations with verified verbatim evidence...
[Seed] Showcase Workspace initialization completed successfully in ~1300ms.
```

### Step 5: Execute Preflight Health Verification

Run the automated preflight check to confirm service readiness before starting your demo:

```bash
pnpm demo:check
```

_Expected output:_

```
========================================================================
MindVault — Preflight Environment & Service Verification
========================================================================

[1. REQUIRED INFRASTRUCTURE]
  [ PASS ] PostgreSQL Database
         Connected successfully (latency < 300ms)
  [ PASS ] pgvector Extension
         pgvector v0.8.7 active (768-dimensional dense vector support confirmed)
  [ PASS ] Redis Cache & Queue
         Connected and responded to PING

[2. AI PROVIDER READINESS]
  [ PASS ] Ollama Service (or Gemini Provider)
         Online / Verified

[3. DEMO SEED DATA]
  [ PASS ] Showcase Workspace Seed
         Showcase workspace initialized (6 docs, 6 chunks, 14 entities, 16 relations, 2 chat sessions)

========================================================================
RESULT: ENVIRONMENT FULLY READY (Exit Code: 0)
========================================================================
```

### Step 6: Launch Application Services

Open three separate terminal windows and run:

```bash
# Terminal 1 — Backend API Gateway (Port 4000)
pnpm dev:api

# Terminal 2 — Asynchronous Background Worker
pnpm dev:worker

# Terminal 3 — Web Frontend Dashboard (Port 5173)
pnpm dev:web
```

Open your browser to: **`http://localhost:5173`**.

---

## 4. Presenter Walkthrough (10–15 Minutes)

### Phase 1: Authentication & Workspace Tenancy (2 Minutes)

|  Step   | Presenter Action                                                           | Expected UI Behavior                                                             | Suggested Spoken Explanation                                                                                                                                                   | Technical Concept Demonstrated                                   |
| :-----: | :------------------------------------------------------------------------- | :------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------- |
| **1.1** | Open `http://localhost:5173`.                                              | Displays the login portal with email and password fields.                        | "MindVault protects knowledge assets behind zero-trust authentication. We will sign into the showcase account."                                                                | Warm Cream / Dark Graphite Design, Public vs. Protected Routing. |
| **1.2** | Enter `demo@mindvault.local` and `DemoPassword123!`. Click **Sign In**.    | Instant login, transitions to main workspace layout.                             | "Authentication uses Argon2id password hashing with short-lived JWT access tokens and rotating refresh tokens stored in HttpOnly cookies."                                     | Secure credential verification, session lifecycle management.    |
| **1.3** | Point to the top of the sidebar showing `MindVault Architecture Showcase`. | Displays workspace title, slug (`demo-showcase`), and user role badge (`OWNER`). | "Every document, chunk, vector embedding, and graph relation is strictly scoped to this workspace. MindVault prevents tenant data leakage directly at the database SQL level." | Multi-tenant isolation and role-based access control (RBAC).     |

---

### Phase 2: Document Library & Storage Synchronization (3 Minutes)

|  Step   | Presenter Action                                                                                    | Expected UI Behavior                                                                                        | Suggested Spoken Explanation                                                                                                                                                     | Technical Concept Demonstrated                                       |
| :-----: | :-------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------- |
| **2.1** | Click **Knowledge Documents** in the left sidebar.                                                  | Navigates to the Document Library displaying 6 seeded documents (`MV-DOC-01` through `MV-DOC-06`).          | "Here we see our technical corpus. These 6 architectural specifications represent a distributed cloud platform."                                                                 | Document library management, asynchronous ingestion status tracking. |
| **2.2** | Point to the status badges showing `Completed` (green).                                             | All 6 cards show `Completed`, 1 chunk each, and file sizes (~1.1 KB to ~2.1 KB).                            | "Ingestion runs asynchronously off the request thread using BullMQ workers. Documents are normalized to Unicode NFC, chunked with heading awareness, and indexed into pgvector." | Background worker architecture and chunking pipeline.                |
| **2.3** | Click the card for **`MV-DOC-01.md`** (_Distributed Cloud Storage and Sharding Architecture Spec_). | Opens the `DocumentDetails` modal displaying metadata, chunk count, file size, MIME type, and SHA-256 hash. | "MindVault retains complete metadata provenance for every document, including structural heading hierarchies and deduplication hashes."                                          | Document metadata inspection and provenance.                         |
| **2.4** | Click **Download File** inside the modal.                                                           | Browser downloads `MV-DOC-01.md` to your local machine.                                                     | "Uploaded files are synchronized to isolated physical storage outside the web root, with strict path traversal protections."                                                     | Secure binary file streaming and storage management.                 |
| **2.5** | Close the modal. Type `Benchmark` into the document search bar.                                     | Instantly filters the grid to show only `MV-DOC-06.md`. Clear the search bar.                               | "Presenters can search and filter their document library by title, filename, or ingestion processing state."                                                                     | Client-side reactive filtering and pagination.                       |

---

### Phase 3: Evidence-Grounded Conversational Assistant (4 Minutes)

|  Step   | Presenter Action                                                                                                                               | Expected UI Behavior                                                                                                         | Suggested Spoken Explanation                                                                                                                                                                                           | Technical Concept Demonstrated                                          |
| :-----: | :--------------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------- |
| **3.1** | Click **AI Chat Assistant** in the sidebar.                                                                                                    | Opens the conversational timeline. Sidebar lists 2 pre-seeded conversation threads.                                          | "The Knowledge Assistant provides multi-turn, grounded conversations over indexed workspace documents."                                                                                                                | Bounded conversational memory and thread persistence.                   |
| **3.2** | Select the conversation: **`API Gateway to Storage Pipeline Architecture`**.                                                                   | Loads a 4-message conversation showing user queries and assistant responses with bracketed citations `[S1]`, `[S2]`, `[S3]`. | "Notice these bracketed citations. Unlike naive chatbots, MindVault strictly ties every claim to verified source chunks."                                                                                              | Bracketed citation system (`[S1]`, `[S2]`) and grounding verification.  |
| **3.3** | Click on citation **`[S1]`** in the first assistant message.                                                                                   | The **Sources Drawer** opens on the right side, highlighting `[S1]`.                                                         | "Clicking a citation opens the verified source chunk. The presenter can see the exact document (`MV-DOC-04.md`), chunk index, similarity score, and the verbatim text excerpt."                                        | Evidence inspection, source attribution, and verification.              |
| **3.4** | Select the second conversation: **`Regional Latency Benchmarks & SLA Compliance`**.                                                            | Loads benchmark Q&A comparing AWS regions against the 150ms p99 SLA.                                                         | "Let's inspect an empirical benchmark query. The assistant compares us-east-1 (112ms), us-west-2 (126ms), and eu-west-1 (138ms), citing exact figures from `MV-DOC-06.md`."                                            | Multi-document synthesis and numerical precision.                       |
| **3.5** | _(If live Ollama/Gemini is online)_ Click **New Conversation** (or press `⌘K`). Ask: _"What role is authorized to rotate tenant master keys?"_ | Assistant streams tokens in real time, emits bracketed citation `[S1]`, and displays badge `GROUNDED`.                       | "Watch the streaming response: tokens stream via Server-Sent Events with periodic heartbeat comments to keep intermediate proxies alive. The citation validator validates bracketed tags before the stream finalizes." | SSE token streaming, AbortController cancellation, real-time grounding. |

---

### Phase 4: Deep Vault Search & Hybrid Retrieval (3 Minutes)

|  Step   | Presenter Action                                                                                    | Expected UI Behavior                                                                                     | Suggested Spoken Explanation                                                                                                                                                           | Technical Concept Demonstrated                    |
| :-----: | :-------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------ |
| **4.1** | Click **Deep Vault Search** in the left sidebar.                                                    | Navigates to the Knowledge Retrieval interface with query input and mode selector buttons.               | "Let's examine how MindVault retrieves relevant chunks before the LLM generates an answer."                                                                                            | Search interface and retrieval channel selection. |
| **4.2** | Point out the three retrieval modes: **Hybrid Search**, **Semantic Vector**, and **Keyword (FTS)**. | Active mode defaults to **Hybrid Search**.                                                               | "MindVault offers three search modes: pure vector semantic search, PostgreSQL full-text keyword search, and hybrid fusion."                                                            | Multi-channel retrieval architecture.             |
| **4.3** | Enter the query: `replication lag SLA threshold` and press Enter.                                   | Displays ranked search result cards showing document title, excerpt snippet, rank, and similarity score. | "In Hybrid mode, MindVault executes dense vector search using pgvector and keyword search using PostgreSQL tsvector in parallel, fusing results with Reciprocal Rank Fusion ($k=60$)." | Reciprocal Rank Fusion (RRF) and hybrid ranking.  |
| **4.4** | Switch mode to **Keyword (FTS)** and click Search.                                                  | Results refresh using PostgreSQL's `ts_rank_cd` ranking algorithm.                                       | "Notice how keyword search excels on exact technical terms like 'SLA' and 'threshold'. Combining both channels eliminates retrieval blind spots."                                      | PostgreSQL Full-Text Search (tsvector / tsquery). |

---

### Phase 5: Interactive Knowledge Graph Explorer (3 Minutes)

|  Step   | Presenter Action                                                                                                        | Expected UI Behavior                                                                                                                                      | Suggested Spoken Explanation                                                                                                                                       | Technical Concept Demonstrated                              |
| :-----: | :---------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------- |
| **5.1** | Click **Knowledge Graph** in the left sidebar.                                                                          | Opens the Knowledge Graph Explorer showing 14 entities, 16 relations, and an interactive canvas.                                                          | "This is MindVault's GraphRAG engine. Beyond flat document chunks, technical systems have deep relational dependencies."                                           | Knowledge Graph topology and entity extraction.             |
| **5.2** | Point to the entity nodes on the canvas (e.g., `API Gateway`, `RAGService`, `RetrievalService`, `Vector Search Index`). | Canvas renders nodes with colored badges indicating entity type (`TECHNOLOGY`, `CONCEPT`).                                                                | "Entities were automatically extracted from the corpus, complete with canonical names, normalized aliases, and entity types."                                      | Entity normalization and type classification.               |
| **5.3** | Click on the **`API Gateway`** node.                                                                                    | The **Entity Details Drawer** opens on the right side, showing aliases (`gateway`, `api router`), connectivity degree, and linked document chunks.        | "Clicking any entity reveals its synonym aliases, its connection degree, and all chunks where it is mentioned."                                                    | Entity neighborhood discovery and chunk mention linking.    |
| **5.4** | Click on the directed edge between **`API Gateway`** and **`RAGService`**.                                              | The **Relation Evidence Drawer** opens, showing relation type `DISPATCHES_TO`, weight 1.0, confidence 0.95, and the verbatim excerpt from `MV-DOC-04.md`. | "Every relationship in MindVault carries verifiable evidence: the exact supporting document and verbatim sentence that proved the relationship exists."            | Verifiable relationship evidence and extraction provenance. |
| **5.5** | Toggle depth filter between **Depth 1** and **Depth 2**.                                                                | Canvas expands to show secondary neighbors (multi-hop traversal).                                                                                         | "During retrieval, GraphRAG traverses these multi-hop connections up to a 2500ms safety timeout, surfacing indirect dependencies that vector search alone misses." | Multi-hop recursive graph traversal and timeout protection. |

---

## 5. Showcase Dataset Reference

The showcase workspace is populated with 6 authoritative specifications:

```
┌────────────────────────────────────────────────────────────────────────┐
│                        SHOWCASE CORPUS OVERVIEW                        │
├──────────────┬─────────────────────────────────────────────────────────┤
│ MV-DOC-01.md │ Distributed Cloud Storage and Sharding Architecture Spec│
│ MV-DOC-02.md │ Enterprise Zero-Trust Security & Identity Governance    │
│ MV-DOC-03.md │ Production Operations Runbook: Incidents & DR           │
│ MV-DOC-04.md │ API Gateway Routing & Server-Sent Events Protocol Spec  │
│ MV-DOC-05.md │ Infrastructure Configuration Reference: Directives      │
│ MV-DOC-06.md │ MindVault Infrastructure Benchmark Report (Q3-2026)     │
└──────────────┴─────────────────────────────────────────────────────────┘
```

### 5.1 Document Catalog & Grounded Test Questions

#### 1. `MV-DOC-01.md` — Distributed Cloud Storage and Sharding Architecture Spec

- **Core Topics:** Storage topology, consistent hashing, 256 virtual nodes per physical shard, replication across availability zones, Incident Health Daemon monitoring replication lag (<200ms threshold), Tenant Master Key decryption gating.
- **Suggested Question:** _"How does MindVault handle data sharding and monitor replication lag across storage nodes?"_
- **Expected Sources:** `MV-DOC-01.md` (chunk 0).
- **Key Facts in Answer:** 256 virtual nodes per shard, Incident Health Daemon monitors replication lag with a 200ms alert threshold, master key revocation immediately halts chunk decryption.

#### 2. `MV-DOC-02.md` — Enterprise Zero-Trust Security and Identity Governance Policy

- **Core Topics:** Write-through session caching, Redis session store failover to PostgreSQL session backup table, Tenant Master Key rotation requiring `Security Incident Officer` role (Tier-1 on-call cannot rotate), RBAC role model (`OWNER`, `ADMIN`, `MEMBER`), 15m JWT TTL.
- **Suggested Question:** _"What happens if the Redis session cache fails during authentication, and who can rotate master keys?"_
- **Expected Sources:** `MV-DOC-02.md` (chunk 0).
- **Key Facts in Answer:** Redis outage triggers automatic failover to the PostgreSQL session backup table; master key rotation requires the `Security Incident Officer` role.

#### 3. `MV-DOC-03.md` — Production Operations Runbook: Incident Management & Disaster Recovery

- **Core Topics:** P1 incident response procedures, failover protocols, DocumentQueue handling async ingestion, status `COMPLETED` triggering NotificationService WebSocket and scheduling GraphExtractionTask, RTO (<15 min) and RPO (<1 min).
- **Suggested Question:** _"What are the RTO and RPO disaster recovery targets for P1 service outages?"_
- **Expected Sources:** `MV-DOC-03.md` (chunk 0).
- **Key Facts in Answer:** Recovery Time Objective (RTO) is under 15 minutes; Recovery Point Objective (RPO) is under 1 minute.

#### 4. `MV-DOC-04.md` — API Gateway Routing and Server-Sent Events Protocol Specification

- **Core Topics:** Gateway routing rules, dispatching `POST /api/rag/stream` to RAGService, ContextAssembler token budgeting (75% narrative floor and 25% graph ceiling), SSE comment heartbeats (`: ping` every 15s) to prevent intermediate proxy timeout, client abort handling.
- **Suggested Question:** _"How does the API Gateway keep Server-Sent Events connections alive through intermediate proxies?"_
- **Expected Sources:** `MV-DOC-04.md` (chunk 0).
- **Key Facts in Answer:** Dispatches `: ping` comment heartbeats every 15 seconds to prevent intermediate proxy disconnects; emits structured lifecycle events (`start -> retrieval_complete -> sources -> token* -> validation -> done`).

#### 5. `MV-DOC-05.md` — Infrastructure Configuration Reference: Environment Directives

- **Core Topics:** Database connection pooling (`DB_POOL_MAX=20` per API instance), Redis cache configuration (`REDIS_MAX_MEMORY=2GB`, `allkeys-lru`), Graph traversal timeout (`GRAPH_TIMEOUT_MS=2500` to prevent cyclic loops).
- **Suggested Question:** _"What are the maximum database connection pool size and the graph traversal timeout limits?"_
- **Expected Sources:** `MV-DOC-05.md` (chunk 0).
- **Key Facts in Answer:** `DB_POOL_MAX=20` max concurrent connections; `GRAPH_TIMEOUT_MS=2500` bounds multi-hop graph queries.

#### 6. `MV-DOC-06.md` — MindVault Infrastructure Benchmark Report (Q3-2026)

- **Core Topics:** Operational SLA mandating p99 retrieval latency < 150ms. Compliant regions: `us-east-1` (112ms, 850 QPS, highest throughput), `us-west-2` (126ms, 720 QPS), and `eu-west-1` (138ms, 610 QPS, lowest cost at $0.012 per 10k queries). Non-compliant regions: `ap-southeast-1` (168ms) and `sa-east-1` (210ms).
- **Suggested Question:** _"Which AWS regions meet MindVault's operational retrieval latency SLA, and which region is the most cost-efficient?"_
- **Expected Sources:** `MV-DOC-06.md` (chunk 0), `MV-DOC-03.md` (chunk 0).
- **Key Facts in Answer:** `us-east-1`, `us-west-2`, and `eu-west-1` all meet the 150ms SLA; `eu-west-1` has the lowest cost ($0.012/10k queries); `ap-southeast-1` and `sa-east-1` violate the SLA.

---

## 6. AI Provider Behavior & Graceful Degradation

Understanding how MindVault behaves across different AI configurations ensures smooth demonstrations:

### 6.1 Ollama Provider (`LLM_PROVIDER=ollama`)

- **When Online with Required Models:** Generates responses locally with streaming tokens. Zero data leaves the presenter's machine. Latency is typically 2–5 seconds depending on hardware.
- **When Ollama is Offline:** If a user submits a new prompt in chat, the API returns a structured 503 error (`Ollama service unreachable`).
  - _Demo Impact:_ Pre-seeded chat sessions, document library, search, and knowledge graph remain **100% operational**. You can deliver the entire walkthrough using the pre-seeded conversation threads.
- **When Model is Missing:** If Ollama runs but `qwen3:0.6b` is not pulled, the API logs a model missing error.
  - _Remediation:_ Run `ollama pull qwen3:0.6b` and `ollama pull nomic-embed-text`.

### 6.2 Google Gemini Provider (`LLM_PROVIDER=gemini`)

- **When Configured with Valid Key:** Fast, high-throughput cloud streaming responses using `gemini-3.5-flash`.
- **When Key is Missing or Invalid:** The preflight check (`pnpm demo:check`) will flag `FAIL` if `LLM_PROVIDER=gemini`. API requests will fail fast with `401 Unauthorized` or `500 Configuration Error`.
  - _Remediation:_ Set `GEMINI_API_KEY=your_key` in `.env`, or switch `LLM_PROVIDER=ollama`.

### 6.3 Offline Showcase Mode (No Active LLM)

- If external AI connectivity is restricted or unavailable during a conference or live demo, **do not attempt live prompt generation**.
- Navigate through:
  1. The Document Library and Document Details modals.
  2. The pre-seeded conversation sessions with full bracketed citations and source panels.
  3. The Knowledge Search interface with Hybrid RRF and keyword modes.
  4. The interactive Knowledge Graph Explorer with entity and relation evidence drawers.

---

## 7. Troubleshooting & Fast Recovery

| Symptom                                                    | Probable Cause                                         | Actionable Remediation Command                                                                                              |
| :--------------------------------------------------------- | :----------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------- |
| **`pnpm demo:check` fails: PostgreSQL Connection refused** | PostgreSQL container is stopped or port is blocked     | Run `docker compose up -d postgres`<br>Verify status with `docker compose ps`                                               |
| **`pgvector Extension: Cannot verify`**                    | The pgvector extension is not registered in PostgreSQL | Run `docker compose exec postgres psql -U mindvault -d mindvault -c "CREATE EXTENSION IF NOT EXISTS vector;"`               |
| **`Redis: Connection refused`**                            | Redis container is stopped                             | Run `docker compose up -d redis`<br>Verify with `docker compose exec redis redis-cli ping`                                  |
| **`Showcase Workspace Seed: Not found`**                   | The database has not been seeded                       | Run `pnpm db:seed`                                                                                                          |
| **`pnpm dev:api` fails: `EADDRINUSE: port 4000`**          | Another process is holding port 4000                   | Find process: `netstat -ano \| findstr :4000`<br>Kill process: `taskkill /PID <PID> /F` (Windows) or `kill -9 <PID>` (Unix) |
| **`pnpm dev:web` shows network error connecting to API**   | Backend API is not running or port mismatch            | Confirm `pnpm dev:api` is running on port 4000.<br>Verify `VITE_API_BASE_URL=http://localhost:4000/api` in `.env`           |
| **`Ollama Service: Offline`**                              | Ollama daemon is not running                           | Start Ollama: `ollama serve`<br>Test URL in browser: `http://localhost:11434`                                               |
| **Ollama Model Missing**                                   | `qwen3:0.6b` or `nomic-embed-text` not pulled          | Run `ollama pull qwen3:0.6b`<br>Run `ollama pull nomic-embed-text`                                                          |
| **Database Port 5432 Conflict**                            | Local PostgreSQL instance already bound to 5432        | In `docker-compose.yml`, keep port mapped to `5433:5432`.<br>Update `DATABASE_URL` in `.env` to use port `5433`             |

---

## 8. Demo Safety & Reset Guidelines

1. **Local Showcase Only:** The demo account (`demo@mindvault.local`) and password (`DemoPassword123!`) are exclusively intended for local demonstrations. Never deploy these credentials to production.
2. **Synthetic Embedding Characteristics:** The pre-seeded vectors in the showcase workspace were generated via deterministic SHA-256 L2-normalized unit vectors (`mock-embed-768`). They satisfy `pgvector` HNSW index constraints without external API calls, but they are synthetic demonstration vectors, not production semantic models.
3. **Workspace Isolation:** All seeded demo data is stamped with `workspaceId: "ws_demo_showcase_001"`. It will never bleed into or affect personal user workspaces.
4. **Idempotent Re-Seeding:** If demo data is inadvertently altered or deleted during exploration, simply re-run:
   ```bash
   pnpm db:seed
   ```
   The seed script is strictly idempotent: it uses safe `upsert` transactions and will restore all 6 documents, 14 entities, 16 relations, and 2 sessions cleanly without duplicate records.
5. **Avoid Destructive Resets:** Do **not** run `prisma migrate reset`, `DROP DATABASE`, or manual SQL `TRUNCATE` commands as routine troubleshooting. Always rely on `pnpm db:seed` and `pnpm demo:check`.

---

## 9. Known Product Scope & Boundaries

To preserve presentation integrity, understand what is implemented versus what is deferred:

- **Implemented & Demonstrable:**
  - Multi-tenant authentication, session management, and RBAC (`OWNER`, `ADMIN`, `MEMBER`).
  - Asynchronous multi-format document ingestion (PDF, DOCX, TXT, MD) with live status polling.
  - Three-way hybrid search (vector cosine + tsvector keyword + RRF $k=60$).
  - Bounded conversational RAG with Server-Sent Events (SSE) streaming and heartbeat ping comments.
  - Fail-closed bracketed citation validation (`[S1]`, `[S2]`) with interactive source inspection drawers.
  - Interactive knowledge graph overview, entity directory, neighborhood visualization, and relation evidence drawers.
- **Demo-Only Seeded Features:**
  - The 6 technical specifications and their 16 cross-document relations are pre-seeded to ensure zero latency and zero dependency on live external LLM graph extraction during presentations.
- **Optional Integrations:**
  - Cross-Encoder reranker HTTP endpoint (falls back gracefully to No-Op reranker when unconfigured).
  - Google Gemini cloud API (optional alternative to local Ollama).
- **Presenter Advice:** Avoid deleting documents from the showcase workspace during a live demonstration. If a document is deleted, re-run `pnpm db:seed` to restore the complete showcase corpus.
