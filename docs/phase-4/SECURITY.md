# MindVault — Phase 4 Security, Tenancy & Threat Modeling

**Date:** 2026-11-06  
**Status:** Implemented & Verified  
**Scope:** Tenant Isolation, Insecure Direct Object References (IDOR), Prompt Injection, and Leakage Defense

---

## 1. Multi-Tenant Workspace Boundary Enforcement

MindVault is built for multi-tenant environments where organizations and users store proprietary knowledge. Security is maintained through hard database-level isolation rather than application-level filtering:

### 1.1 SQL-Level Tenant Isolation

Every retrieval query executed by the RAG pipeline enforces tenant isolation directly in SQL:

```sql
SELECT c.id, c.content, c."documentId", d."workspaceId", ...
FROM "DocumentChunk" c
JOIN "Document" d ON c."documentId" = d.id
WHERE d."workspaceId" = $1
  AND (c.embedding <=> $2) < $3
ORDER BY c.embedding <=> $2
LIMIT $4;
```

It is mathematically and logically impossible for an authorized user in Workspace A to retrieve or prompt an LLM with chunks residing in Workspace B, because PostgreSQL discards foreign rows prior to similarity calculation and ranking.

### 1.2 IDOR Prevention on Document Filters

When a user provides a `filters.documentIds` parameter:

- The system does not trust the client-provided UUIDs.
- The SQL query joins against `Document` and enforces `d."workspaceId" = $1`.
- Any document ID belonging to another workspace evaluates to false in the `WHERE` clause, yielding zero results and raising no exceptions.

---

## 2. Prompt Injection Defense

Prompt injection occurs when untrusted documents contain adversarial instructions intended to override model constraints (e.g., revealing system prompts, executing unauthorized commands, or exfiltrating data).

### Defense Mechanisms in MindVault

1. **Delimited Context Framing:**
   All document chunks are enclosed within explicit untrusted context tags:
   ```text
   === BEGIN UNTRUSTED RETRIEVED CONTEXT ===
   [S1] ...
   === END UNTRUSTED RETRIEVED CONTEXT ===
   ```
2. **System Instruction Precedence:**
   The model is instructed in rule 5 of the system prompt to treat all enclosed context as passive document text.
3. **Structured Response Contracts:**
   The client expects structured answers with valid source keys. Unformatted exfiltration text fails citation validation.

---

## 3. Secret Management & Provider Security

- **No Secrets in Client Bundles:** Frontend code communicates exclusively with the Express API gateway (`/api/rag/*`). No LLM API keys or Ollama URLs are exposed to the browser.
- **Provider Local Binding:** By default, Ollama is bound to `127.0.0.1:11434`, accessible only from internal backend processes.
- **Environment Validation:** All environment variables are strictly validated on startup via Zod in [`apps/api/src/config/env.ts`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/config/env.ts).
