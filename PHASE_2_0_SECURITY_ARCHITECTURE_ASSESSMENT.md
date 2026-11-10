# MindVault — Phase 2.0: Security Architecture Assessment

**Assessment Mode:** STRICT READ-ONLY AUDIT  
**Implementation Authorization:** NOT GRANTED  
**Date:** 2026-11-09  
**Auditor:** Antigravity Autonomous Agent  
**Repository:** `MindVault` (`c:\Users\mohit\OneDrive\Desktop\MindVault`)

---

## 1. Executive Summary & Assessment Scope

MindVault's core architecture spans multi-tenant ingestion, pgvector embedding storage, full-text lexical search, reciprocal rank fusion (RRF), knowledge graph extraction, and conversational RAG.

This assessment evaluates MindVault's security posture across **7 core architectural pillars** to identify practical vulnerabilities, verify existing defense-in-depth mechanisms, and formulate a targeted remediation contract prior to Stage 2 implementation:

1. **Authentication and Session Security:** Password hashing, token lifecycles, refresh token storage, session revocation, token reuse detection, and CSRF protection.
2. **Workspace Membership and Tenant Isolation:** Multi-tenancy boundaries, role hierarchy, authorization middleware, and workspace resolution mechanics.
3. **Document Access Authorization:** Document upload, retrieval, download, status tracking, and deletion across workspace tenants.
4. **Chat and Conversation Access Authorization:** Session creation, conversational history retrieval, metadata mutation, and streaming message isolation.
5. **Graph Retrieval and Graph Evidence Isolation:** Graph traversal, neighborhood subgraphs, directed paths, relation evidence, and SQL query scoping.
6. **API Endpoint Authorization:** Route middleware coverage, parameter binding, SSE connection management, and input validation.
7. **Background Worker Authorization & Workspace Propagation:** Ingestion pipelines, BullMQ job payloads, database row locking, and cooperative worker lifecycles.

### Audit Summary Matrix

| Security Pillar                     | Verification Status             | Risk Level | Primary Findings                                                                                   |
| :---------------------------------- | :------------------------------ | :--------- | :------------------------------------------------------------------------------------------------- |
| **1. Authentication & Sessions**    | Verified Strong                 | Low        | Argon2id, rotating SHA-256 hashed refresh tokens, token reuse revocation, CSRF headers.            |
| **2. Workspace & Tenant Isolation** | Partially Protected             | **High**   | Status code discrepancy oracle enables cross-workspace document existence enumeration.             |
| **3. Document Access**              | Verified Strong (Service Level) | Medium     | Service layer enforces `doc.workspaceId === workspaceId`; middleware resolution desynchronized.    |
| **4. Chat & Conversations**         | Verified Strong                 | Low        | Dual-check on every endpoint: `workspaceId` tenancy isolation AND `session.userId === userId`.     |
| **5. Graph Retrieval & Evidence**   | Verified Strong                 | Low        | CTE queries enforce `workspace_id = ${workspaceId}` at every anchor, join, and lateral step.       |
| **6. API Endpoint Authorization**   | Partially Protected             | Medium     | Missing `AbortSignal` propagation in `POST /api/rag/stream` on client SSE disconnect.              |
| **7. Background Workers**           | Verified Strong                 | Low        | Ingestion pipeline and graph worker enforce compound `workspaceId_id` and transactional row locks. |

---

## 2. Comprehensive Security Architecture Review across 7 Pillars

### 2.1 Pillar 1: Authentication and Session Security

- **Password Security (`apps/api/src/modules/auth/auth.security.ts`):** Passwords are hashed using Argon2id with OWASP-aligned parameters (`memoryCost: 19456` [19 MiB], `timeCost: 2`, `parallelism: 1`).
- **Access Tokens:** Signed with HMAC-SHA256 (`JWT_ACCESS_SECRET`), short-lived (`15m`), verified via Express middleware [`authenticate.ts`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/middleware/authenticate.ts).
- **Refresh Token Storage & Rotation:** Raw refresh tokens are 40-byte cryptographically secure random hex strings (`crypto.randomBytes(40)`). Only SHA-256 hashes (`hashRefreshToken`) are stored in the database `sessions` table.
- **Token Reuse Detection (`apps/api/src/modules/auth/auth.service.ts#L186-L196`):** If an expired or already-revoked refresh token is presented, the system immediately revokes **all** active sessions for the user (`revokeAllUserSessions`), mitigating token theft.
- **Cookie Security:** Refresh tokens are dispatched via `HttpOnly`, `SameSite: Strict` (production), `Secure` (production) cookies scoped exclusively to `path: '/api/auth'`.
- **CSRF Protection (`apps/api/src/middleware/csrfProtection.ts`):** Cookie-authenticated mutation endpoints (`/refresh`, `/logout`) require either matching `Origin`/`Referer` headers against `CORS_ORIGIN` or the presence of anti-CSRF custom headers (`X-Requested-With` or `X-CSRF-Token`).
- **Rate Limiting:** Express rate limiting is enforced on sensitive endpoints (`/api/auth/register`, `/api/auth/login`).

### 2.2 Pillar 2: Workspace Membership and Tenant Isolation

- **Role Hierarchy (`apps/api/src/middleware/authorizeWorkspace.ts#L5-L9`):**
  - `OWNER` (Rank 3): Workspace destruction, billing, administrative control.
  - `ADMIN` (Rank 2): Document deletion, workspace settings updates.
  - `MEMBER` (Rank 1): Document upload, search, retrieval, chat, graph exploration.
- **Multi-Tenant Identification:** Workspace identity is passed via URL parameter (`:workspaceId`), HTTP header (`X-Workspace-ID`), query parameter (`?workspaceId`), or body (`workspaceId`).
- **Database Schema Multi-Tenancy (`prisma/schema.prisma`):**
  - Workspaces partition all primary models: `documents`, `document_chunks`, `chat_sessions`, `chat_messages`, `graph_entities`, `graph_relations`, `chunk_entity_mentions`, `relation_evidence`.
  - Compound unique keys enforce tenancy at the database engine level:
    - `Document`: `@@unique([workspaceId, id])`
    - `DocumentChunk`: `@@unique([workspaceId, id])`, `@@unique([workspaceId, documentId, id])`
    - `GraphEntity`: `@@unique([workspaceId, id])`, `@@unique([workspaceId, normalizedName])`
    - `GraphRelation`: `@@unique([workspaceId, id])`, `@@unique([workspaceId, sourceEntityId, targetEntityId, relationType])`
    - `RelationEvidence`: `@@unique([workspaceId, relationId, chunkId])`

### 2.3 Pillar 3: Document Access Authorization

- **Service Layer Defense-in-Depth (`apps/api/src/modules/document/document.service.ts#L177-L181`):**
  `getDocumentById`, `downloadDocument`, `deleteDocument`, and `getDocumentStatus` all perform strict validation:
  ```typescript
  const doc = await this.db.findDocumentById(documentId);
  if (!doc || doc.workspaceId !== workspaceId) {
    throw new AppError(404, 'DOCUMENT_NOT_FOUND', 'Document not found');
  }
  ```
- **Cross-Workspace Data Leakage:** Prevented at the service layer; foreign documents return `404` when requested with the caller's authorized workspace.
- **File System / Storage Isolation:** Physical file keys in `InMemoryStorageProvider` or S3/MinIO are generated with random UUIDs or workspace prefixes, avoiding user-controlled path traversal.

### 2.4 Pillar 4: Chat and Conversation Access Authorization

- **Dual-Layer Tenancy & Ownership (`apps/api/src/modules/conversations/conversation.controller.ts`):**
  Every conversation route (`GET /:sessionId`, `GET /:sessionId/messages`, `PATCH /:sessionId`, `POST /:sessionId/archive`, `DELETE /:sessionId`, `POST /:sessionId/messages/stream`) applies two explicit checks:
  1. `ConversationRepository.findSessionById(sessionId, workspaceId)` — confirms the conversation belongs to the caller's workspace.
  2. `if (session.userId !== userId) throw new AppError(403, 'FORBIDDEN', ...)` — confirms the conversation belongs to the authenticated user.
- **Prompt Injection & Context Injection:** Conversational context assembly sanitizes message inputs through Zod validation schemas (`SendConversationMessageRequestSchema`).

### 2.5 Pillar 5: Graph Retrieval and Evidence Isolation

- **Raw SQL Isolation (`apps/api/src/modules/graph/repositories/sql/recursive-traversal.sql.ts` & `graph-retrieval.sql.ts`):**
  - Recursive CTE queries for entity neighborhood traversal and directed path discovery enforce `workspace_id = ${workspaceId}` at the initial anchor node query, recursive join step, and relationship join step.
  - Relation evidence queries in `GraphRepository.findEvidenceByRelationId` require `WHERE workspace_id = $1 AND relation_id = $2`.
- **Entity Resolution (`apps/api/src/modules/graph/repositories/graph.repository.ts`):**
  - Exact match: `WHERE workspace_id = $1 AND normalized_name = $2`
  - Alias match: `WHERE workspace_id = $1 AND normalized_alias = $2`
  - Cross-workspace entity blending is structurally impossible under PostgreSQL constraints.

### 2.6 Pillar 6: API Endpoint Authorization

- **Router Security:** Every router under `apps/api/src/` attaches `authenticate` and `authorizeWorkspace` middleware.
- **Streaming Endpoints (`POST /api/rag/stream` vs `POST /api/conversations/:sessionId/messages/stream`):**
  - `ConversationController.streamMessage` uses an `AbortController` linked to `req.on('close')`, properly aborting downstream streaming tasks.
  - `GenerationController.stream` sets a local flag on `req.on('close')` but fails to pass an `AbortSignal` to `RAGService.generateAnswerStream`, leaving upstream background LLM queries running.

### 2.7 Pillar 7: Background Worker Authorization & Context Propagation

- **BullMQ Queue Payloads (`ProcessDocumentJobPayload`, `GraphExtractionJobPayload`):**
  - Payloads always carry `{ documentId, workspaceId }`.
- **Worker Tenant Validation (`apps/worker/src/modules/ingestion/pipeline.ts#L44-L48`):**
  - `if (doc.workspaceId !== workspaceId) throw new Error('Workspace mismatch...')`.
- **Graph Extraction Concurrency Fencing (`apps/worker/src/modules/graph/worker/graph-extraction.worker.ts#L203-L210`):**
  - Acquires transactional `FOR NO KEY UPDATE` lock using composite key:
    `WHERE id = ${documentId} AND "workspaceId" = ${workspaceId}`.

---

## 3. Verified Existing Security Controls & Protections

MindVault already possesses several robust, production-grade security protections that **must NOT be broken or refactored**:

1. **Argon2id Password Storage:** Complies with current OWASP standards with high memory cost (19 MiB).
2. **Refresh Token Rotation with Theft Detection:** Single-use refresh tokens stored as SHA-256 hashes; automatic revocation of all user sessions upon reuse detection.
3. **Database Schema Multi-Tenancy:** PostgreSQL foreign keys and Prisma compound unique constraints (`[workspaceId, id]`) prevent accidental cross-tenant relational joins.
4. **Graph SQL Isolation:** Recursive CTE traversal and neighbor exploration strictly enforce `workspace_id` parameters at all join depths.
5. **Conversational Ownership Isolation:** User sessions cannot be viewed, archived, or deleted by other users even within the same workspace.
6. **Worker Lease Fencing:** BullMQ workers verify document tenancy and lock rows under composite workspace/document keys.

---

## 4. Identified Security Vulnerabilities (Risk Matrix)

```
+-----------------------------------------------------------------------------------------+
|                                    RISK MATRIX                                          |
+-------------+---------------------------------------------------------------------------+
| CRITICAL    | None                                                                      |
+-------------+---------------------------------------------------------------------------+
| HIGH        | VULN-AUTHZ-01: Cross-Workspace Resource Existence Oracle (IDOR Enumeration)   |
+-------------+---------------------------------------------------------------------------+
| MEDIUM      | VULN-RES-01: Orphan Background LLM Tasks on Client SSE Disconnect         |
|             | VULN-AUTHZ-02: Header vs Parameter Workspace Context Desynchronization    |
+-------------+---------------------------------------------------------------------------+
| LOW         | VULN-API-01: Missing Workspace Member Management API Endpoints            |
|             | VULN-TEST-01: Permissive Multi-Status Assertions in Existing Tests        |
+-------------+---------------------------------------------------------------------------+
```

---

### 4.1 VULN-AUTHZ-01: Cross-Workspace Document Existence Enumeration Oracle

- **Severity:** **HIGH**
- **CWE:** CWE-200 (Exposure of Sensitive Information to an Unauthorized Actor), CWE-639 (Authorization Bypass Through User-Controlled Key / IDOR).
- **Location:** [`apps/api/src/middleware/authorizeWorkspace.ts#L31-L43`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/middleware/authorizeWorkspace.ts#L31-L43) and [`#L64`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/middleware/authorizeWorkspace.ts#L64).
- **Mechanism:**
  When a client issues a request to `GET /api/documents/:id` **without** providing an explicit `x-workspace-id` header or `?workspaceId` query parameter:
  1. The middleware executes:
     ```typescript
     } else if (req.baseUrl.includes('documents') && req.params.id) {
       const doc = await dbService.findDocumentById(req.params.id);
       if (doc) {
         workspaceId = doc.workspaceId;
       } else {
         res.status(404).json({ error: { code: 'DOCUMENT_NOT_FOUND' } });
         return;
       }
     }
     ```
  2. If `:id` is a real document ID belonging to **another workspace** (where the caller is not a member):
     - `workspaceId` is set to the victim workspace's ID.
     - `dbService.getWorkspaceMember(workspaceId, req.user.id)` returns `null`.
     - Middleware returns **`403 WORKSPACE_ACCESS_DENIED`**.
  3. If `:id` is a randomly generated UUID that does **not** exist in the system:
     - `doc` is `null`.
     - Middleware returns **`404 DOCUMENT_NOT_FOUND`**.
- **Impact:**
  An authenticated attacker with a basic account in any workspace can probe arbitrary document IDs across the entire multi-tenant database. The status code discrepancy (`403` vs `404`) acts as an information oracle confirming the existence of private documents belonging to foreign companies/tenants.
- **Remediation:**
  Do not dynamically resolve `workspaceId` across all tenants when none was supplied by the caller. Either require `workspaceId` up front or return a uniform `404 DOCUMENT_NOT_FOUND` whenever a user lacks access to the document's workspace, eliminating the status code oracle.

---

### 4.2 VULN-RES-01: Orphan Background LLM Tasks on Client SSE Disconnect

- **Severity:** **MEDIUM**
- **CWE:** CWE-400 (Uncontrolled Resource Consumption), CWE-770 (Allocation of Resources Without Limits or Throttling).
- **Location:** [`apps/api/src/modules/generation/generation.controller.ts#L87-L97`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/modules/generation/generation.controller.ts#L87-L97).
- **Mechanism:**
  In `GenerationController.stream` (`POST /api/rag/stream`):
  ```typescript
  let clientDisconnected = false;
  req.on('close', () => {
    clientDisconnected = true;
  });

  const eventStream = RAGService.generateAnswerStream(workspaceId, parseResult.data);

  for await (const event of eventStream) {
    if (clientDisconnected) break;
    // ...
  }
  ```
  Unlike `ConversationController.streamMessage`, `GenerationController.stream` does not create an `AbortController` and does not pass an `AbortSignal` into `RAGService.generateAnswerStream`.
- **Impact:**
  When a user closes their browser or cancels a query, the async generator continues running upstream retrieval and remote LLM generation (Gemini or Ollama) until completion. An attacker or client can flood the server with streaming requests and immediately terminate TCP connections, rapidly exhausting external Gemini API rate limits (Free/Paid Tier 429) and server CPU/memory.
- **Remediation:**
  Create an `AbortController` in `GenerationController.stream`, invoke `abortController.abort()` on `req.on('close')`, and pass `abortController.signal` through `RAGService.generateAnswerStream` to terminate upstream retrieval and provider network requests immediately.

---

### 4.3 VULN-AUTHZ-02: Header vs Parameter Workspace Context Desynchronization

- **Severity:** **MEDIUM**
- **CWE:** CWE-287 (Improper Authentication), CWE-639 (Authorization Bypass).
- **Location:** [`apps/api/src/middleware/authorizeWorkspace.ts#L22-L26`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/middleware/authorizeWorkspace.ts#L22-L26) and [`apps/api/src/modules/document/document.controller.ts#L78-L81`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/modules/document/document.controller.ts#L78-L81).
- **Mechanism:**
  `authorizeWorkspace` checks `req.headers['x-workspace-id']` first. If an attacker passes their own workspace in `x-workspace-id` while supplying a foreign document ID in `req.params.id`:
  - `authorizeWorkspace` verifies the caller is a member of the header workspace and attaches `req.workspaceMember = { workspaceId: attackerWorkspaceId, ... }`.
  - The middleware passes.
  - In `DocumentController.getById`, the controller reads `workspaceId = req.query.workspaceId || req.headers['x-workspace-id']`.
  - While `documentService.getDocumentById` defends against leakage by checking `doc.workspaceId !== workspaceId` (returning 404), this creates an architectural inconsistency: the middleware authorized workspace A, while the URL path points to an entity in workspace B.
- **Remediation:**
  Standardize workspace resolution across controllers and middleware. In controllers, always bind to `req.workspaceMember.workspaceId` established by the middleware rather than independently re-reading headers or query strings.

---

### 4.4 VULN-API-01: Missing Workspace Member Management API Endpoints

- **Severity:** **LOW**
- **CWE:** CWE-285 (Improper Authorization).
- **Location:** [`apps/api/src/modules/workspace/workspace.routes.ts`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/modules/workspace/workspace.routes.ts).
- **Mechanism:**
  The Prisma schema defines `WorkspaceMember` with roles `OWNER`, `ADMIN`, `MEMBER`. The `authorizeWorkspace` middleware checks member roles. However, `workspace.routes.ts` only exposes:
  - `POST /api/workspaces`
  - `GET /api/workspaces`
  - `GET /api/workspaces/:id`
  - `PATCH /api/workspaces/:id`
  - `DELETE /api/workspaces/:id`
    There are zero REST endpoints to invite a member, list members, update a member's role, or remove a member from a workspace.
- **Impact:**
  RBAC cannot be managed via the API. Multi-user collaboration requires direct database intervention.
- **Remediation:**
  Expose minimal member management endpoints (`GET /api/workspaces/:id/members`, `POST /api/workspaces/:id/members`, `PATCH /api/workspaces/:id/members/:userId`, `DELETE /api/workspaces/:id/members/:userId`) protected by `ADMIN` or `OWNER` authorization.

---

### 4.5 VULN-TEST-01: Permissive Multi-Status Assertions in Existing Tests

- **Severity:** **LOW**
- **CWE:** CWE-1077 (Floating / Ambiguous Security Assertion).
- **Location:** [`apps/api/src/modules/document/document.test.ts#L346`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/modules/document/document.test.ts#L346) and [`#L399`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/modules/document/document.test.ts#L399).
- **Mechanism:**
  Existing IDOR integration tests assert:
  ```typescript
  expect([403, 404]).toContain(res.status);
  ```
- **Impact:**
  Allowing either 403 or 404 masks the status code existence oracle. If a code change alters the response from 404 to 403 (leaking existence), the test still passes.
- **Remediation:**
  Replace permissive `[403, 404]` checks with strict assertions enforcing unified `404 DOCUMENT_NOT_FOUND` across all cross-workspace access attempts.

---

## 5. Missing Security Tests

The test suite lacks automated verification for several critical security boundaries:

1. **Cross-Workspace Document Existence Enumeration Test:**
   - Verify that querying a foreign document ID without `x-workspace-id` returns identical status code (`404`) and identical error schema (`DOCUMENT_NOT_FOUND`) as querying a non-existent document ID.
2. **Cross-Workspace Header Manipulation Test:**
   - Verify that supplying `X-Workspace-ID: <own-workspace>` with `GET /api/documents/<foreign-document-id>` returns `404 DOCUMENT_NOT_FOUND`.
3. **SSE Connection Abort Propagation Test:**
   - Verify that client disconnect on `POST /api/rag/stream` triggers `AbortSignal` and terminates the underlying LLM generator without unhandled rejections or dangling promises.
4. **Workspace Role-Based Access Control (RBAC) Tests:**
   - Verify that `MEMBER` cannot delete documents (returns `403 INSUFFICIENT_PERMISSIONS`).
   - Verify that `ADMIN` cannot delete the workspace (requires `OWNER`).
   - Verify that a member cannot promote themselves to `ADMIN` or `OWNER`.
5. **Graph Traversal Cross-Tenant Boundary Test:**
   - Verify that entity neighborhood and path discovery endpoints return empty or 404 results when supplied with entity IDs belonging to foreign workspaces.

---

## 6. Recommended Minimal Remediation Plan

To address the identified gaps without introducing enterprise bloat or unnecessary complexity, the following minimal fixes are recommended:

### Fix 1: Eliminate the Document Existence Oracle in `authorizeWorkspace.ts`

- In `apps/api/src/middleware/authorizeWorkspace.ts`, remove the global cross-workspace document lookup:
  ```typescript
  // Replace current lookup with workspace-bound validation:
  if (!workspaceId) {
    res.status(400).json({
      success: false,
      error: {
        code: 'MISSING_WORKSPACE_ID',
        message: 'A valid workspaceId is required via header, query, or parameter',
      },
      meta: { timestamp: new Date().toISOString() },
    });
    return;
  }
  ```
- If document routes require parameter-level resolution, ensure the document is fetched **only** in the context of the caller's authorized workspace. If not found or belonging to another workspace, return a uniform `404 DOCUMENT_NOT_FOUND`.

### Fix 2: Propagate `AbortSignal` in `GenerationController.stream`

- In `apps/api/src/modules/generation/generation.controller.ts`:
  - Instantiate `const abortController = new AbortController()`.
  - In `req.on('close')`, call `abortController.abort()`.
  - Pass `abortController.signal` into `RAGService.generateAnswerStream(workspaceId, parseResult.data, abortController.signal)`.
  - Update `RAGService.generateAnswerStream` and underlying provider methods to pass `signal` to `fetch` / SDK streaming calls.

### Fix 3: Standardize Workspace Identity Binding in Controllers

- In `apps/api/src/modules/document/document.controller.ts`:
  - Use `const workspaceId = req.workspaceMember?.workspaceId;` rather than falling back to unvalidated query or header values.

### Fix 4: Tighten Test Assertions

- In `apps/api/src/modules/document/document.test.ts`:
  - Replace `expect([403, 404]).toContain(res.status)` with `expect(res.status).toBe(404)`.
  - Add explicit anti-enumeration test cases.

---

## 7. Stage 2 Implementation Milestones & Acceptance Criteria

When authorized by the user, Stage 2 implementation will proceed through the following milestones:

```
+-----------------------------------------------------------------------------------------+
|                              STAGE 2 IMPLEMENTATION ROADMAP                             |
+-----------------------------------------------------------------------------------------+
| Milestone 2.1: Tenant Isolation & Anti-Enumeration Hardening                            |
| Milestone 2.2: SSE Lifecycle & Stream Cancellation Hardening                            |
| Milestone 2.3: Workspace Member Lifecycle & RBAC Management (Optional/Scoped)           |
| Milestone 2.4: Comprehensive Security Test Suite & Regression Verification              |
+-----------------------------------------------------------------------------------------+
```

### Milestone 2.1: Tenant Isolation & Anti-Enumeration Hardening

- **Scope:** `authorizeWorkspace.ts`, `document.controller.ts`, `document.service.ts`.
- **Acceptance Criteria:**
  - Zero status code differentiation between foreign document IDs and non-existent IDs.
  - Mandatory workspace context required for document operations.
  - Controllers consume `req.workspaceMember.workspaceId` directly from verified middleware.

### Milestone 2.2: SSE Lifecycle & Stream Cancellation Hardening

- **Scope:** `generation.controller.ts`, `rag.service.ts`, `llm.provider.ts`.
- **Acceptance Criteria:**
  - Client disconnection aborts active LLM generation stream within 500ms.
  - No orphaned background tasks or token leakage on closed SSE connections.

### Milestone 2.3: Workspace Member Lifecycle & RBAC Management

- **Scope:** `workspace.routes.ts`, `workspace.controller.ts`, `workspace.service.ts`.
- **Acceptance Criteria:**
  - Endpoints added for member listing, invitation, and removal.
  - Strict role checks: `OWNER` controls membership, `ADMIN` manages content, `MEMBER` consumes.

### Milestone 2.4: Comprehensive Security Test Suite

- **Scope:** `apps/api/src/modules/document/document.test.ts`, new `apps/api/src/security/tenant-isolation.spec.ts`.
- **Acceptance Criteria:**
  - 100% pass rate on IDOR, enumeration, and role boundary test suites.
  - Zero regression across existing RAG evaluation and test suites.

---

## 8. Stop Gate and Authorization Request

> [!IMPORTANT]
> **COMPLETION GATE ENFORCED:**  
> This security architecture assessment has been completed in **STRICT READ-ONLY AUDIT MODE**.  
> Zero production files, migrations, or dependencies have been modified.
>
> **Implementation Authorization:** Awaiting explicit user direction before commencing Stage 2 implementation.
