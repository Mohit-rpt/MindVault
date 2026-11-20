# MindVault — Sprint 4: Phase 0 Architecture & Security Audit
## Secure Storage Infrastructure, Upload Protection & Resource Governance

**Sprint Baseline:** Sprint 3 Completion (HEAD on `main`, 88 test files passing, 1,208 tests passing)  
**Execution Mode:** SECURITY-FIRST ENGINEERING + AUDIT + ARCHITECTURE DESIGN (Strictly Read-Only Phase 0)  
**Auditor:** Antigravity Autonomous Security Engineer  
**Audit Target:** Document lifecycle, storage mechanisms, access controls, Redis/BullMQ, Gemini consumption, rate limits, and quotas.

---

## Executive Summary

MindVault has successfully transitioned to an isolated cloud/local worker architecture and eliminated legacy dependencies in Sprints 1–3. However, an exhaustive architectural inspection of the document ingestion pipeline and resource consumption paths reveals three critical vulnerabilities and architectural limitations that prevent safe public cloud deployment:

1. **Storage Hybrid Workaround & Base64 JSONB Bloat:**
   Uploaded files are serialized into Base64 strings and stored inside PostgreSQL `metadata.rawContentBase64` as a hybrid bridge for local workers. Although stripped upon successful chunking, failed documents, backfills, or concurrent uploads bloat database storage. More critically, downloads rely on the API server's local disk; on ephemeral container platforms (e.g., Render, Railway, Kubernetes), container restarts delete local files, resulting in permanent 404 errors for any completed document whose Base64 metadata was stripped.
2. **Unbounded Memory Buffering & Middleware Sequencing:**
   `apps/api/src/modules/document/document.routes.ts` uses `multer.memoryStorage()`, buffering incoming files up to 10MB into Node.js heap memory *before* workspace authorization (`authorizeWorkspace('MEMBER')`) runs. An authenticated attacker can flood the API with multipart payloads targeting any workspace, exhausting heap memory before authorization is evaluated.
3. **Absence of Distributed Rate Limiting & Resource Quotas on Expensive Routes:**
   While `companion.routes.ts` possesses an atomic, Redis-backed Lua rate limiter (`RedisRateLimitStore`), the main API routes (`/api/documents/upload`, `/api/conversations/:sessionId/messages/stream`, `/api/rag/search`) have **zero rate limiting and zero quota enforcement**. Any authenticated user can flood Gemini Flash generation and Gemini 768-dim embeddings, initiating concurrent vector searches and graph extraction jobs without restriction. Furthermore, workspace deletion cascades in PostgreSQL but never deletes storage objects, leaving orphaned files indefinitely.

This document details the complete Phase 0 audit findings and presents the concrete, non-destructive architecture blueprints for Phases 1 through 7.

---

## 1. Verified Current Architecture

The codebase was directly inspected on `main`:
- **Repository Pattern:** pnpm monorepo with workspace packages:
  - `apps/api`: Express 4.21.2 + TypeScript 5.7 REST API.
  - `apps/worker`: Node.js BullMQ worker consuming Redis queues with capability isolation (`cloud` vs `local`).
  - `apps/web`: React 18 + Vite 6 + Tailwind CSS frontend.
  - `apps/companion`: Node.js desktop companion bridge.
  - `packages/shared`: Shared DTOs, schemas, Redis helpers, queue topologies, and embedding policies.
- **Data Stores:**
  - **PostgreSQL (Neon / Local PG):** Schema managed via Prisma 6.4.1. Chunks leverage `pgvector` with 768-dimensional vectors (`vector(768)`) and `tsvector` full-text search.
  - **Redis (Upstash / Local Redis):** BullMQ 5.x queue broker and cache.
- **AI Providers:**
  - Generation: Google Gemini API via `@google/genai` (default: `gemini-2.5-flash` / `gemini-3.5-flash`).
  - Embeddings: Google Gemini API (`gemini-embedding-2` / `text-embedding-004`, 768 dimensions).
- **Test Baseline:** 88 test files passing, 1,208 unit and integration tests passing (`pnpm test` executed cleanly).

---

## 2. Complete Document Ingestion Lifecycle

Tracing the end-to-end document lifecycle from frontend submission to RAG retrieval:

```text
[Frontend: DocumentLibrary.tsx]
   │ (User selects .pdf, .docx, .txt, .md file <= 10MB)
   ▼
[HTTP POST /api/documents/upload]
   │
   ├─► 1. authenticate (verifies JWT session cookie / Bearer token)
   │
   ├─► 2. upload.single('file') [Multer memoryStorage]
   │      ⚠️ Entire file buffered into Buffer in Node.js V8 heap
   │
   ├─► 3. authorizeWorkspace('MEMBER')
   │      ⚠️ Reads req.body.workspaceId (extracted by Multer)
   │      Checks user workspace membership in PostgreSQL
   │
   ├─► 4. DocumentController.upload
   │      Extracts file buffer, mimetype, originalname
   │
   ├─► 5. DocumentService.uploadDocument
   │      a. File extension validation (.pdf, .docx, .txt, .md)
   │      b. File size cap (10MB)
   │      c. Magic byte validation (PDF: %PDF, DOCX: PK\x03\x04, TXT: null byte check)
   │      d. SHA-256 checksum computation
   │      e. Duplicate checksum check in workspace (rejects 409)
   │      f. Storage key generation: doc_${timestamp}_${randomHex}.${ext}
   │      g. LocalFileSystemStorageProvider.save(storageKey, buffer)
   │         Writes to ./infrastructure/storage/documents/<storageKey>
   │      h. Prisma Document creation:
   │         status = 'UPLOADED', sizeBytes, checksum, storageKey
   │         metadata = { rawContentBase64: buffer.toString('base64'), uploadedBy }
   │      i. BullMQDocumentQueue.enqueue:
   │         Sends { documentId, workspaceId, capability: 'cloud' } to queue
   │      j. Update status = 'QUEUED'
   │
   ▼ [Redis / BullMQ Queue: doc-processing-{workspaceId}-{capability}]
   │
[Worker: apps/worker/src/worker.ts]
   │
   ├─► 1. Capability & Tenant Check:
   │      Verifies worker type (cloud vs local) and authorized workspace
   │
   ├─► 2. DocumentIngestionPipeline.processDocument:
   │      a. Update status = 'PROCESSING', processingStage = 'EXTRACTING'
   │      b. Read raw buffer:
   │         if (storage.exists(storageKey)) -> read from disk
   │         else if (metadata.rawContentBase64) -> reconstruct from DB base64
   │      c. extractDocument (pdf-parse / mammoth / text extractor)
   │      d. normalizeText
   │      e. chunkDocument (recursive token chunking with overlap)
   │      f. Update status = 'PROCESSING', processingStage = 'EMBEDDING'
   │      g. EmbeddingProvider.generateEmbeddings (batches of 32 chunks via Gemini)
   │      h. Update status = 'PROCESSING', processingStage = 'STORING'
   │      i. Bulk insert into document_chunks (content, embedding vector(768), tokenCount)
   │      j. Strip metadata.rawContentBase64 from PostgreSQL document record
   │      k. Update status = 'COMPLETED', processingStage = 'COMPLETED'
   │      l. Record pendingDispatch intent for knowledge graph extraction
   │      m. Enqueue graph extraction job to BullMQ
   │
   ▼
[RAG Retrieval: apps/api/src/modules/retrieval]
   User queries conversation -> Hybrid Search (pgvector cosine + tsvector text) -> Context Assembler -> Gemini Generation
```

---

## 3. Current Storage Map

| Location | Path / Representation | Content | Lifecycle / Retention | Risk / Vulnerability |
| :--- | :--- | :--- | :--- | :--- |
| **API Server Heap** | `req.file.buffer` | Raw file buffer (up to 10MB) | Destroyed on GC after HTTP response finishes | Unbounded heap spike if multiple users upload concurrently. |
| **API Server Disk** | `./infrastructure/storage/documents/doc_{timestamp}_{hex}.ext` | Raw file binary | Kept until `DocumentService.deleteDocument` is called | **Ephemeral Loss:** Render/container restarts wipe local disk. Stored files are lost. |
| **PostgreSQL JSONB** | `documents.metadata -> rawContentBase64` | Base64-encoded file string | Stored on upload; stripped on ingestion completion | 33% byte inflation in DB; remains indefinitely if ingestion fails or aborts. |
| **PostgreSQL Chunks** | `document_chunks.content` | Extracted text chunk | Permanent until document or workspace is deleted | Safe, searchable. |
| **PostgreSQL Vectors** | `document_chunks.embedding` | 768-dim `vector(768)` | Permanent until document deletion | Safe. |
| **Redis / BullMQ** | Job data: `{ documentId, workspaceId, capability }` | Metadata only (NO raw bytes) | Removed on completion (`removeOnComplete: true`) | Verified clean: No raw bytes ever enter Redis. |
| **Worker Disk** | Local worker cache `./infrastructure/storage/documents` | Raw file binary | Non-blocking cache | Local-only path. |

---

## 4. Audit of Current Access Security

| Check Item | Current State | Verification Evidence & File Reference | Status |
| :--- | :--- | :--- | :--- |
| **Authentication on Upload** | Enforced | `apps/api/src/modules/document/document.routes.ts#L21`: `router.use(authenticate)` | Verified Safe |
| **Workspace Membership Check** | Enforced (Ordering Defect) | `document.routes.ts#L24`: `upload.single('file')` executes *before* `authorizeWorkspace('MEMBER')` | **Vulnerable to Pre-Auth Memory Exhaustion** |
| **Cross-Workspace IDOR (Download)** | Enforced | `document.service.ts#L234`: `if (!doc \|\| doc.workspaceId !== workspaceId) throw 404` | Verified Safe |
| **Cross-Workspace IDOR (Delete)** | Enforced | `document.service.ts#L211`: `if (!doc \|\| doc.workspaceId !== workspaceId) throw 404` | Verified Safe |
| **Role-Based Authorization (Delete)** | Enforced | `document.routes.ts#L39`: `authorizeWorkspace('ADMIN')` | Verified Safe |
| **Storage Key Guessability** | Non-Guessable | `document.storage.ts#L103`: 16 cryptographically random bytes (`crypto.randomBytes(16)`) | Cryptographically Safe (128-bit entropy) |
| **Path Traversal Defense** | Enforced | `document.storage.ts#L38-45`: Rejects `..`, `\`, null bytes, absolute paths | Verified Safe |
| **Workspace Deletion Cascade** | Defective | `workspace.service.ts#L101`: Deletes DB records, cleans Redis queues, **never deletes storage files** | **Orphaned Storage Leak** |
| **Signed URLs** | Not Implemented | Downloads streamed via API buffer (`res.send(buffer)`) | Memory inefficient, but no signed URL leaks. |

---

## 5. Existing Limits and Enforcement Points

| Limit Category | Configured Value | Enforcement Point | Verified Enforcement Mechanism |
| :--- | :--- | :--- | :--- |
| **Max Upload File Size** | 10 MB (`10 * 1024 * 1024`) | `document.routes.ts#L11` & `document.service.ts#L6` | Multer options + `validateFileSize(file.size)` |
| **Allowed File Extensions** | `.pdf`, `.docx`, `.txt`, `.md` | `document.service.ts#L61` | Extension whitelist check |
| **File Signature (Magic Bytes)** | PDF (`%PDF`), DOCX (`PK\x03\x04`), TXT (<=2 null bytes) | `document.service.ts#L256-294` | Header byte buffer inspection |
| **Rate Limiter (Auth)** | 30 requests / 15 min | `apps/api/src/middleware/rateLimiter.ts#L9` | `express-rate-limit` using in-memory store (bypassed on multi-instance) |
| **Rate Limiter (Uploads)** | **NONE** | None | **Missing** |
| **Rate Limiter (RAG / Chat)**| **NONE** | None | **Missing** |
| **Workspace Document Quota** | **NONE** | None | **Missing** |
| **Workspace Storage Quota**  | **NONE** | None | **Missing** |
| **Worker Concurrency** | 5 (configurable) | `apps/worker/src/worker.ts#L331` | BullMQ worker concurrency setting |
| **Embedding Batch Size** | 32 chunks | `apps/worker/src/modules/ingestion/pipeline.ts` | Batched chunk requests |

---

## 6. Vulnerability and Abuse Scenarios

### Scenario A: Ephemeral Cloud Storage Data Loss
- **Vector:** MindVault API is deployed to a container cloud provider (e.g. Render, Railway, fly.io) without persistent volume mounts.
- **Impact:** An uploaded document is saved to local disk (`./infrastructure/storage/documents`) and enqueued. The worker ingests it and deletes `rawContentBase64` from PostgreSQL. Later, the API container restarts. The local file is lost. Any user clicking "Download" receives a 404 error, even though all vector chunks exist.

### Scenario B: Pre-Authorization Memory Exhaustion via Multer
- **Vector:** In `document.routes.ts`, `upload.single('file')` precedes `authorizeWorkspace('MEMBER')`.
- **Impact:** An authenticated user who is not a member of Workspace $W$ uploads fifty concurrent 10MB files to `/api/documents/upload` with body `workspaceId: W`. Multer allocates 500MB of RAM in Node.js heap buffers before `authorizeWorkspace` runs and returns 403 Forbidden. This can crash the Node process via Out Of Memory (OOM).

### Scenario C: Gemini API Quota Exhaustion & Cost Explosion
- **Vector:** No rate limit or concurrency throttle exists on `/api/conversations/:sessionId/messages/stream` or `/api/documents/upload`.
- **Impact:** A malicious or buggy frontend script can trigger thousands of streaming chat queries or upload hundreds of documents concurrently. The worker issues hundreds of Gemini embedding batches (`gemini-embedding-2`) and Gemini generation calls (`gemini-2.5-flash`), triggering HTTP 429 quota exhaustion and massive API costs.

### Scenario D: Storage Flooding / Disk Exhaustion
- **Vector:** No workspace storage quota exists.
- **Impact:** A single tenant can upload 10,000 documents of 10MB each (100GB), filling the disk or exhausting object storage budgets, without ever triggering a limit.

### Scenario E: Orphaned Storage Objects on Workspace Deletion
- **Vector:** When an admin calls `DELETE /api/workspaces/:id`, `workspace.service.ts` deletes the workspace via Prisma, cascading document DB rows.
- **Impact:** `this.storage.delete(doc.storageKey)` is never invoked. The physical storage objects remain in disk/bucket storage indefinitely, causing unmonitored storage growth.

---

## 7. Existing Code That Can Be Reused

1. **`RedisRateLimitStore` (`apps/api/src/modules/companion/companion.routes.ts#L18-109`):**
   Already implements:
   - Distributed atomic rate limiting via Redis Lua script (`incr` + `pexpire` + `pttl`).
   - Configurable `failClosed` behavior for security-critical endpoints.
   - Graceful in-memory fallback for non-critical endpoints when Redis is offline.
   - Expiration and TTL management.
   *Action:* Refactor this into a shared API middleware at `apps/api/src/middleware/redisRateLimiter.ts` so it can be mounted across auth, uploads, RAG, and chat.
2. **`parseRedisUrl` & `isLocalRedis` (`packages/shared/src/redis.ts`):**
   Robust, production-tested connection options parser supporting TLS, credentials, and producer/consumer roles.
3. **`DocumentStorageProvider` interface (`packages/shared/src/types.ts#L229`):**
   Clean base contract already used by API and worker pipelines. Needs expansion to support streaming and metadata queries.
4. **`validateMagicBytes` (`apps/api/src/modules/document/document.service.ts#L256`):**
   High-quality signature validation for PDF, DOCX, and TXT/MD files.

---

## 8. Proposed Object Storage Architecture (Phase 1)

### 8.1 Provider Abstraction
Expand the `DocumentStorageProvider` contract in `@mindvault/shared`:

```typescript
export interface StorageObjectMetadata {
  contentLength: number;
  contentType: string;
  checksum?: string;
  lastModified?: Date;
}

export interface DocumentStorageProvider {
  save(storageKey: string, buffer: Buffer, metadata?: { contentType?: string }): Promise<void>;
  saveStream(storageKey: string, stream: NodeJS.ReadableStream, metadata?: { contentType?: string }): Promise<void>;
  read(storageKey: string): Promise<Buffer>;
  readStream(storageKey: string): Promise<NodeJS.ReadableStream>;
  delete(storageKey: string): Promise<void>;
  deleteMany(storageKeys: string[]): Promise<void>;
  exists(storageKey: string): Promise<boolean>;
  getMetadata(storageKey: string): Promise<StorageObjectMetadata | null>;
}
```

### 8.2 Provider Implementations
1. **`S3CompatibleStorageProvider`:**
   - Supports Cloudflare R2, AWS S3, MinIO, Wasabi.
   - Implemented using `@aws-sdk/client-s3` (thin, standard, audited client) with configurable `STORAGE_ENDPOINT`, `STORAGE_BUCKET`, `STORAGE_REGION`, `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY`.
   - Streaming download via `GetObjectCommand` -> `response.Body as Readable`.
   - Default bucket is private; zero public object URLs.
2. **`LocalFileSystemStorageProvider`:**
   - Retained for local offline development.
   - Enhanced with `readStream` (`fs.createReadStream`) and `saveStream` (`fs.createWriteStream`).
3. **`StorageProviderFactory`:**
   - If `STORAGE_PROVIDER === 's3' || STORAGE_PROVIDER === 'r2'`, instantiates `S3CompatibleStorageProvider`.
   - Else defaults to `LocalFileSystemStorageProvider`.

### 8.3 Storage Key Design
Storage keys must be hierarchical, workspace-isolated, non-guessable, and path-traversal immune:

$$\text{Key} = \text{documents}/\{\text{workspaceId}\}/\{\text{documentId}\}/\text{doc}\_\{\text{timestamp}\}\_\{\text{randomHex16}\}.\{\text{ext}\}$$

*Benefits:*
- Enforces strict tenant partitioning within the storage bucket.
- Allows single-prefix bulk cleanup during workspace deletion (`documents/{workspaceId}/...`).
- Cryptographically unguessable ($2^{128}$ entropy).

### 8.4 Eliminating PostgreSQL Base64 JSONB
Once object storage is configured:
- `rawContentBase64` is removed from `DocumentService.uploadDocument`.
- Worker directly reads from the shared S3/R2 storage provider via `storage.readStream(doc.storageKey)`.
- For backward compatibility during migration, the worker and API will gracefully fall back to `doc.metadata.rawContentBase64` only if the object does not exist in `storage`.

---

## 9. Proposed Rate-Limit Architecture (Phase 3)

Promote `RedisRateLimitStore` from `companion.routes.ts` into a unified middleware:

### 9.1 Endpoint Rate-Limit Policies

| Route Pattern | Scope / Dimension | Window | Max Hits | Fail Policy | Purpose |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `POST /api/auth/login` | IP + Username | 15 min | 10 | Fail-Closed | Brute force defense |
| `POST /api/auth/register` | IP | 60 min | 5 | Fail-Closed | Registration spam prevention |
| `POST /api/documents/upload` | User + Workspace | 1 min | 10 | Fail-Closed | Upload burst defense |
| `POST /api/documents/upload` | Workspace | 1 hour | 100 | Fail-Closed | Workspace daily upload pacing |
| `POST /api/conversations/:id/messages/stream` | User | 1 min | 20 | Fail-Closed | Gemini chat flood prevention |
| `POST /api/rag/search` | User | 1 min | 30 | Fail-Closed | Vector search flood prevention |
| `POST /api/companion/*` | Device / User | 1 min | 60 | Fail-Closed | Companion telemetry pacing |

### 9.2 Redis Failure Behavior
- **Fail-Closed on High-Cost Routes:** Uploads, streaming chat, and auth fail with `503 Service Unavailable` if Redis is down, preventing unmonitored abuse during infrastructure degradation.
- **Response Format:**
  ```json
  {
    "success": false,
    "error": {
      "code": "RATE_LIMIT_EXCEEDED",
      "message": "Too many requests. Please wait 45 seconds before trying again."
    },
    "meta": {
      "retryAfter": 45,
      "timestamp": "2026-11-20T10:00:00.000Z"
    }
  }
  ```

---

## 10. Proposed Quota Architecture (Phase 4)

### 10.1 Quota Specification

| Resource Dimension | Free / Standard Workspace Limit | Enforcement Level | Concurrency Safety Mechanism |
| :--- | :--- | :--- | :--- |
| **Max File Size** | 10 MB per file | Upload endpoint | HTTP content-length + Multer stream limit |
| **Max Documents** | 100 documents per workspace | Pre-upload check | Atomic DB reservation or Redis lock |
| **Max Storage Bytes** | 100 MB per workspace | Pre-upload check | Atomic byte reservation in PostgreSQL |
| **Max Monthly AI Chat Queries** | 500 queries / user / day | Streaming route | Redis sliding counter |
| **Concurrent Ingestion Jobs** | 2 jobs / workspace | Queue worker | BullMQ concurrency controls |

### 10.2 Atomic Concurrency Reservation
To prevent concurrent upload races that bypass limits (Check-Then-Act vulnerability):
1. **Pre-flight Check & Reservation:**
   Before persisting file to storage, the API starts a PostgreSQL transaction:
   ```sql
   SELECT COUNT(*), COALESCE(SUM(size_bytes), 0)
   FROM documents
   WHERE workspace_id = $1 AND status != 'FAILED'
   FOR UPDATE;
   ```
2. If `currentBytes + newFileBytes > MAX_STORAGE_BYTES` or `currentCount + 1 > MAX_DOCS`, reject with `429 Quota Exceeded`.
3. If allowed, write document record with status `UPLOADED`. The transaction commits, securing the reservation before queueing.
4. If upload fails or file validation fails, the reservation is rolled back or marked `FAILED` immediately.

---

## 11. Migration Strategy (Phase 5)

### 11.1 Non-Destructive Principles
- **Zero Data Loss:** Existing documents in local disk or PostgreSQL JSONB must remain readable and downloadable.
- **Dual-Read Compatibility:** The download service and worker pipeline will attempt reading from:
  1. Primary configured `DocumentStorageProvider` (S3 / R2).
  2. Legacy local disk (`LocalFileSystemStorageProvider`).
  3. Legacy database fallback (`doc.metadata.rawContentBase64`).
- **Resumable Backfill Utility:**
  Provide an idempotent script (`scripts/migrate-documents-to-object-storage.ts`):
  - Iterates through documents where `storageKey` is in the legacy format or content resides in `metadata.rawContentBase64`.
  - Streams file to S3/R2 storage under the new hierarchical key `documents/{workspaceId}/{documentId}/{key}`.
  - Verifies SHA-256 checksum matches `documents.checksum`.
  - Updates `documents.storageKey`.
  - Leaves `metadata.rawContentBase64` untouched until explicitly verified.

---

## 12. Rollback Strategy

1. **Storage Provider Reversion:**
   Setting `STORAGE_PROVIDER=local` in the environment immediately reverts the application to `LocalFileSystemStorageProvider`.
2. **Rate Limit Bypass / Fallback:**
   Setting `RATE_LIMIT_FAIL_CLOSED=false` transitions rate limiting to graceful in-memory degradation if Redis encounters issues.
3. **Database Safety:**
   No destructive column drops or irreversible schema mutations will be performed in Sprint 4. The `Document` model schema is preserved.

---

## 13. Testing Strategy (Phase 6)

1. **Unit Tests:**
   - Storage provider interface & mock tests (saving, streaming, reading, deleting, error handling).
   - Redis rate limiter tests (sliding window, atomic Lua script, retry-after header calculation, fail-closed handling).
   - Atomic quota reservation tests (concurrency races, threshold limits, rollback on failure).
   - Magic byte & file signature validator tests.
2. **Integration Tests:**
   - Multipart streaming upload with simulated network cancellation.
   - Multi-instance simulated rate-limit enforcement across 2 mock API replicas.
   - S3/R2 mock integration tests utilizing `@aws-sdk/client-s3` mock or local server.
   - Workspace deletion verifying cascade deletion of physical storage objects.
3. **Adversarial Security Tests:**
   - Attempting upload without workspace membership before body parsing.
   - Uploading a disguised executable with `.pdf` extension (magic byte rejection).
   - Firing 50 concurrent chat requests to verify rate-limit rejection.
   - Attempting cross-workspace document download.

---

## 14. Identified Risks & Mitigations

| Risk | Likelihood | Impact | Concrete Mitigation |
| :--- | :--- | :--- | :--- |
| **S3 SDK Dependency Bloat** | Low | Low | Use modular `@aws-sdk/client-s3` instead of the legacy monolithic `aws-sdk`. |
| **Worker Inability to Reach S3** | Medium | High | Environment validation during worker preflight; verify bucket accessibility at startup. |
| **Concurrent Upload Quota Race** | Medium | Medium | Atomic `SELECT ... FOR UPDATE` or Redis Lua reservation before storage write. |
| **Multer Streaming Memory Leaks** | Low | High | Enforce strict `limits.fileSize` and ensure file stream errors cleanly clean up temp files. |
| **Redis Outage Blocking Chat** | Low | High | Structured `503 Service Unavailable` with informative retry-after headers rather than silent crash. |

---

## 15. Exact Files Likely to Change

### Packages & Config
- `packages/shared/src/types.ts` (Storage interface expansion, quota types)
- `packages/shared/src/index.ts`
- `apps/api/package.json` (add `@aws-sdk/client-s3`)
- `apps/worker/package.json` (add `@aws-sdk/client-s3`)
- `.env.example` (add `STORAGE_PROVIDER`, `STORAGE_ENDPOINT`, `STORAGE_BUCKET`, etc.)

### API Modules
- `apps/api/src/modules/document/document.routes.ts` (reorder auth/workspace middleware before upload stream)
- `apps/api/src/modules/document/document.service.ts` (integrate storage provider, streaming download, quota checks)
- `apps/api/src/modules/document/document.storage.ts` (S3/R2 provider + local streaming)
- `apps/api/src/middleware/redisRateLimiter.ts` (promoted shared Redis rate limiter)
- `apps/api/src/modules/conversations/conversation.routes.ts` (mount chat rate limiter)
- `apps/api/src/modules/workspace/workspace.service.ts` (clean storage objects on workspace deletion)
- `apps/api/src/services/quota.service.ts` (new atomic workspace quota service)

### Worker Modules
- `apps/worker/src/lib/storage.ts` (support S3/R2 provider)
- `apps/worker/src/modules/ingestion/pipeline.ts` (stream direct from object storage, eliminate base64 reliance)

### Documentation & Scripts
- `docs/SPRINT_4_OBJECT_STORAGE_ARCHITECTURE.md`
- `docs/SPRINT_4_UPLOAD_SECURITY.md`
- `docs/SPRINT_4_RATE_LIMITS_AND_QUOTAS.md`
- `docs/SPRINT_4_MIGRATION_AND_ROLLBACK.md`
- `docs/SPRINT_4_ADVERSARIAL_TEST_REPORT.md`
- `docs/SPRINT_4_COMPLETION_REPORT.md`
- `scripts/migrate-documents-to-object-storage.ts`

---

## 16. Explicitly Excluded Work

To ensure stability, the following are strictly excluded from Sprint 4:
- No public production deployments.
- No live database drops or destructive column removals.
- No deletion of legacy `rawContentBase64` metadata for existing documents.
- No billing, Stripe, subscription, or payment systems.
- No replacement of PostgreSQL, pgvector, Redis, or BullMQ.
- No rewrites of RAG, GraphRAG, or Gemini embedding models.
- No major frontend UI redesigns.

---

**Phase 0 Status:** COMPLETED & VERIFIED. Architecture audit established. Ready for Phase 1 implementation.
