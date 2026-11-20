# MindVault — Sprint 4: Distributed Rate Limiting & Resource Governance
## Architecture Specification, Atomic Lua Protocols & Cost Guardrails

**Status:** APPROVED & IMPLEMENTED  
**Date:** 2026-11-20  
**Repository Baseline:** Sprint 4 HEAD on `main`  
**Primary Implementations:**  
- `apps/api/src/middleware/redisRateLimiter.ts`
- `apps/api/src/services/quota.service.ts`
- `apps/api/src/modules/conversations/conversation.routes.ts`
- `apps/api/src/modules/document/document.routes.ts`

---

## 1. Problem Statement: Distributed Rate Limiting & AI Protection

In multi-instance cloud deployments (e.g., Render replicas, Kubernetes pods), default in-memory rate limiters (`MemoryStore`) track counters inside individual Node.js processes. An attacker distributing requests across instances effectively multiplies their rate limit by the replica count.

Furthermore, generative AI applications face high asymmetry in request costs:
- An unthrottled streaming chat route (`/api/conversations/:id/messages/stream`) triggers expensive Gemini 2.5 Flash generations and vector search embeddings.
- An unthrottled upload endpoint triggers batch embedding operations (`gemini-embedding-2`) and knowledge graph extraction jobs.

Rate limiting alone is insufficient: a slow drip of 1 request every 10 seconds can still upload 8,640 documents per day, consuming gigabytes of storage and thousands of dollars in AI API costs. MindVault implements a dual layer: **Distributed Rate Limiting (Pacing)** + **Resource Quotas (Capacity Caps)**.

---

## 2. Distributed Redis Rate Limiting Architecture

MindVault promotes the atomic Redis rate limiter to `apps/api/src/middleware/redisRateLimiter.ts`:

### 2.1 Atomic Redis Lua Script
To prevent race conditions between read and write under concurrent load, increment and TTL initialization are executed in a single atomic Lua script:

```lua
local current = redis.call('incr', KEYS[1])
if current == 1 then
  redis.call('pexpire', KEYS[1], ARGV[1])
end
local ttl = redis.call('pttl', KEYS[1])
return { current, ttl }
```

### 2.2 Endpoint Rate Limiting Policies

| Protected Route | Key Dimension | Window | Max Hits | Fail Policy | Purpose |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `POST /api/auth/login` | `ip:email` | 15 min | 15 | **Fail-Closed** | Brute force defense |
| `POST /api/auth/register` | `ip` | 15 min | 15 | **Fail-Closed** | Registration spam |
| `POST /api/documents/upload` | `user_or_ip:workspace` | 1 min | 10 | **Fail-Closed** | Upload burst pacing |
| `POST /api/conversations/:id/messages/stream` | `user_or_ip` | 1 min | 20 | **Fail-Closed** | Gemini generation pacing |
| `POST /api/rag/search` | `user_or_ip` | 1 min | 30 | Fail-Open | Vector search pacing |
| `POST /api/companion/*` | `device:user` | 1 min | 60 | **Fail-Closed** | Companion telemetry |

### 2.3 Fail-Closed vs. Fail-Open Behavior
- **Expensive / Security Routes (Fail-Closed):** If Redis becomes unreachable, `/upload`, `/auth`, and streaming `/chat` reject incoming traffic with `503 Service Unavailable`, preventing unlimited, unmetered AI consumption during an infrastructure outage.
- **Non-Critical Routes (Fail-Open):** Search falls back gracefully to in-memory sliding windows if Redis is unavailable.
- **Standardized Response:** Returns `429 Too Many Requests` with RFC 7231 `Retry-After: <seconds>` headers.

---

## 3. Quota Service & Resource Governance

The `QuotaService` (`apps/api/src/services/quota.service.ts`) governs total capacity per tenant and user:

### 3.1 Configurable Quota Thresholds

```text
WORKSPACE_MAX_DOCUMENTS = 100 documents
WORKSPACE_MAX_STORAGE_BYTES = 104,857,600 bytes (100 MB)
MAX_FILE_SIZE_BYTES = 10,485,760 bytes (10 MB)
USER_MAX_CHAT_MESSAGES_PER_DAY = 500 messages / user / day
```

### 3.2 Concurrency-Safe Atomic Reservations
Under concurrent uploads, simple check-then-act logic (`if count < max then insert`) suffers from race conditions where two simultaneous uploads both pass the check and exceed the quota.

MindVault eliminates this race using a **dual-layer atomic reservation protocol**:
1. Queries committed storage usage from PostgreSQL (`prisma.document.aggregate`).
2. Reads pending in-flight reservations from Redis keys:
   `mindvault:quota:reserve:docs:{workspaceId}`
   `mindvault:quota:reserve:bytes:{workspaceId}`
3. If `committed + inFlight + newUpload <= limit`:
   Atomically increments Redis reservation keys with a **60-second self-expiring TTL**.
4. When upload finishes:
   - On success: Commits the reservation (clears Redis reservation as DB row is now committed).
   - On failure: Releases the Redis reservation immediately.
   - On crash: 60-second TTL automatically expires, preventing reservation leaks!

---

## 4. Gemini Consumption Guardrails

MindVault protects Google Gemini API quotas through four independent mechanisms:
1. **Chat Rate Limiting:** 20 streaming messages per minute per user.
2. **Daily Chat Quotas:** 500 streaming messages per user per day via Redis sliding counter (`mindvault:quota:chat:{userId}:{date}`).
3. **Batch Embedding Pacing:** Embeddings are generated in bounded batches of 32 chunks (`gemini-embedding-2`), respecting TPM and RPM quotas.
4. **Graph Extraction Worker Leases:** Worker lease fencing (§Phase 6.4.5) ensures knowledge graph extraction runs only once per document version, preventing duplicate model calls.

---

## 5. Verification Summary

Rate limiting and quota controls were verified in unit and integration test suites:
- Atomic Lua script increment & TTL calculation: **PASSED**
- Fail-closed 503 error handling on Redis outage: **PASSED**
- Fail-open in-memory degradation for search: **PASSED**
- Standardized `Retry-After` response headers: **PASSED**
- Single file size rejection (>10MB): **PASSED**
- Workspace document count rejection (>100 docs): **PASSED**
- Workspace storage bytes rejection (>100MB): **PASSED**
- Concurrency reservation tracking under in-flight load: **PASSED**
- User daily chat message quota rejection (>500/day): **PASSED**
