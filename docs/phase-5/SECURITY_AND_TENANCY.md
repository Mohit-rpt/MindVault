# MindVault — Phase 5: Security Architecture & Multi-Tenant Isolation

---

## 1. Multi-Tenant Scoping Rules

MindVault enforces strict workspace tenancy across every conversation endpoint and database query:

1. **Mandatory Header Verification:**  
   Every request to `/api/conversations` must include:
   - `Authorization: Bearer <valid_jwt>`
   - `X-Workspace-ID: <workspace_id>`
2. **Membership & RBAC Authorization:**  
   The `authorizeWorkspace()` middleware executes before any conversation route handler:
   - Verifies the user is an active member (`OWNER`, `ADMIN`, `MEMBER`) of the specified workspace.
   - Attaches `req.workspaceMember` and `req.workspaceId` to the request object.
3. **Double Scoping on All Queries:**  
   Every query to `chat_sessions` and `chat_messages` includes both `sessionId` AND `workspaceId`:
   ```sql
   SELECT * FROM chat_sessions
   WHERE id = $1 AND workspace_id = $2;
   ```
   If a user in Workspace B attempts to read or mutate a session belonging to Workspace A by forging the `sessionId` in the URL, the query returns `null` or `NotFoundError (404)`.

---

## 2. Insecure Direct Object Reference (IDOR) Protections

| Attack Vector                   | Attempted Action                                                          | MindVault Defense                                                                 |
| ------------------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Cross-Tenant Read               | User in WS B requests `GET /api/conversations/ws_A_session`               | Query filters `workspaceId = WS_B` -> returns 404                                 |
| Cross-Tenant Mutation           | User in WS B sends `PATCH /api/conversations/ws_A_session`                | Query filters `workspaceId = WS_B` -> returns 404                                 |
| Cross-Tenant Message Injection  | User in WS B sends `POST /api/conversations/ws_A_session/messages/stream` | Middleware and repository verify `workspaceId` -> rejected with 404               |
| Cross-Workspace Context Leakage | Follow-up query in WS B refers to concept discussed in WS A               | Context retrieval and session histories are strictly isolated to active workspace |

---

## 3. SQL & Prompt Injection Defenses

- **SQL Injection:**  
  All database operations use Prisma parameterized queries or strict type-safe in-memory maps. No string concatenation of user inputs into SQL statements occurs.
- **Prompt Injection via History:**  
  If a malicious user submits prompt override payloads (`"SYSTEM OVERRIDE: Ignore all previous rules..."`), the input is encapsulated within the `<conversation_history>` / `BEGIN RECENT CONVERSATION HISTORY (UNTRUSTED CONTEXT)` boundary. The system prompt explicitly instructs the LLM to ignore any instructions inside those boundaries.
