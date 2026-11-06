# MindVault — Security & Multi-Tenancy Architecture

**Phase:** Phase 3 (Retrieval Engine & Hybrid Search)  
**Status:** Verified Security Specifications

---

## 1. Threat Model & Security Objectives

In a multi-tenant personal knowledge operating system, cross-workspace data leakage is a critical vulnerability. If Tenant A can retrieve or infer chunks from Tenant B through vector similarity or keyword queries, the core integrity of the system is compromised.

### Primary Threat Vectors

1. **Cross-Tenant Vector Bleed:** An embedding search retrieves top-N nearest neighbors across the global vector space, filtering tenant access in application memory after retrieval.
2. **Insecure Direct Object Reference (IDOR):** An attacker in Workspace A specifies a `documentId` belonging to Workspace B in the search filter to extract its contents.
3. **Draft / Deleted Document Leakage:** Chunks belonging to documents in `UPLOADED`, `PROCESSING`, `FAILED`, or `DELETING` status are inadvertently exposed before validation or after deletion.
4. **SQL Injection:** Unsanitized user queries or filters alter raw SQL query logic in pgvector or full-text search statements.

---

## 2. Multi-Layer Defense in Depth

```
[Incoming Request]
       │
       ▼
[Layer 1: JWT Authentication] ─────> Validates Bearer token signature & expiration
       │
       ▼
[Layer 2: Workspace Authorization] ─> Validates user membership in database (MEMBER/ADMIN/OWNER)
       │
       ▼
[Layer 3: Zod Parameter Validation] ─> Validates query length, type bounds, filter formats
       │
       ▼
[Layer 4: SQL-Level Parameterized Scoping]
       │
       ├──> WHERE c."workspaceId" = $1
       ├──>   AND d."workspaceId" = $1
       └──>   AND d."status" = 'COMPLETED'
       │
       ▼
[Isolated Results Returned]
```

### 2.1 Layer 1: JWT Authentication (`middleware/authenticate.ts`)

- Every retrieval request requires a signed JWT access token.
- Unauthenticated requests are rejected immediately with `HTTP 401 Unauthorized`.

### 2.2 Layer 2: Workspace Membership Authorization (`middleware/authorizeWorkspace.ts`)

- Client-supplied `workspaceId` values are **never trusted blindly**.
- The server checks the database membership table (`workspace_members`) to verify that the authenticated user (`req.user.id`) holds at least the `MEMBER` role in the target workspace.
- Outsiders are rejected with `HTTP 403 Forbidden`.

### 2.3 Layer 3: Database-Level Isolation (SQL Scoping)

- **CRITICAL INVARIANT:** Isolation is enforced inside PostgreSQL, never in Node.js application memory.
- In both vector search and keyword search, parameterized SQL statements enforce:
  ```sql
  WHERE c."workspaceId" = $1
    AND d."workspaceId" = $1
    AND d."status" = 'COMPLETED'
  ```
- No global nearest-neighbor calculation is ever executed.

### 2.4 Layer 4: IDOR Immunity in Metadata Filters

If a client passes foreign document IDs in `filters.documentIds`:

```sql
AND c."documentId" = ANY($documentIds)
```

Because the query enforces `c."workspaceId" = $1` and `d."workspaceId" = $1`, any document belonging to Workspace B evaluates to FALSE and is omitted from results.

### 2.5 Layer 5: SQL Injection Prevention

- All search queries use tagged template parameterization or positional parameters (`$1, $2, ...`) via Prisma's `$queryRawUnsafe` with explicit parameter arrays.
- Raw strings are treated as literal input parameters, never concatenated into SQL commands.

---

## 3. Automated Security Verification

The automated security test suite in `apps/api/src/modules/retrieval/retrieval.test.ts` executes the following regression tests:

- **Cross-Workspace Isolation Test:** User in Workspace A queries for exact unique phrases from Workspace B; verified 0 leaked chunks.
- **IDOR Defense Test:** User in Workspace A passes foreign document ID in `filters.documentIds`; verified 0 results returned.
- **Unauthenticated Rejection Test:** Verified `HTTP 401` when JWT is omitted.
- **Non-Member Rejection Test:** Verified `HTTP 403` when authenticated user is not a member of the workspace.
- **SQL Injection Payload Test:** Tested `'; DROP TABLE "document_chunks"; -- ' OR 1=1`; verified treated as literal string input without syntax errors or data corruption.
