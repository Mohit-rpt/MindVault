# MindVault — Phase 5 Repository Audit & Pre-Flight Verification

**Date:** 2026-11-06  
**Auditor:** Lead Systems & AI Engineer  
**Objective:** Architectural pre-flight verification for Phase 5: Conversational RAG, Persistent Chat Sessions & Conversation Memory  
**Baseline Git Commit:** `b4ac568` (`feat(phase-4): implement grounded RAG generation and streaming`)

---

## 1. Audit Inquiries & Architectural Findings

### 1.1 Where Current Single-Question RAG Requests Are Handled

- **Endpoints:**
  - `POST /api/rag/answer` (non-streaming batch answering)
  - `POST /api/rag/stream` (SSE token streaming)
- **Controller:** [`GenerationController`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/modules/generation/generation.controller.ts) mounted at `/api/rag` in [`apps/api/src/app.ts`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/app.ts#L88).
- **Service Layer:** [`RAGService.generateAnswer()`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/modules/generation/services/rag.service.ts#L31) and [`RAGService.generateAnswerStream()`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/modules/generation/services/rag.service.ts#L104).
- **Characteristics:** Completely stateless. Each question initiates isolated retrieval and generation passes without retaining prior dialogue turns or conversation context.

### 1.2 How the Frontend Currently Consumes SSE

- In [`KnowledgeAssistant.tsx`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/web/src/components/assistant/KnowledgeAssistant.tsx#L67), the client executes a `fetch` request to `/api/rag/stream` using an `AbortController`.
- The response body is read via `ReadableStreamDefaultReader<Uint8Array>`, decoded with `TextDecoder('utf-8')`, and buffered across TCP packet chunks.
- Events are split on `\n\n` boundaries, parsing `event: <name>` and `data: <json>`. Handled events:
  - `start`: records stream timing
  - `retrieval_complete`: timing telemetry
  - `sources`: sets source drawers
  - `token`: appends text tokens to answer state
  - `validation`: updates grounding status badge
  - `done`: finalizes timing metadata
  - `error`: displays toast/alert
- **Extensibility:** The parser cleanly supports adding `user_message`, `assistant_message_created`, and persistent `messageId` attributes without breaking stream processing.

### 1.3 How Sources and Citations Are Represented

- Structured types defined in [`packages/shared/src/types.ts`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/packages/shared/src/types.ts#L337):
  - `ContextSourceItem`: `citationId` (`[S1]`), `documentId`, `documentName`, `chunkId`, `chunkIndex`, `pageNumber`, `pageRange`, `section`, `content`, `score`, `retrievalSources`.
  - `GroundingValidationResult`: `status` (`GROUNDED`, `PARTIALLY_GROUNDED`, `INSUFFICIENT_EVIDENCE`, `CITATION_INVALID`), `validCitationIds`, `unknownCitationIds`, `warnings`.
- These rich data structures can be persisted directly as JSON in PostgreSQL `ChatMessage.citations` and `ChatMessage.metadata`.

### 1.4 How Generation Context Is Constructed

- Context is assembled by [`ContextAssembler.assembleContext()`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/modules/retrieval/context/context.assembler.ts).
- Assembled chunks are formatted with source headers:
  ```text
  --- SOURCE [S1] | Document: api_spec.pdf (Chunk: 3) | Page: p. 4 ---
  <chunk content>
  ```
- In [`RAGPromptBuilder.buildPrompt()`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/modules/generation/prompts/rag.prompt.ts), this context is wrapped in untrusted boundaries (`=== BEGIN UNTRUSTED RETRIEVED CONTEXT ===` ... `=== END UNTRUSTED RETRIEVED CONTEXT ===`).
- In Phase 5, conversational history and summaries must be injected in separate, clearly demarcated sections so the model distinguishes past conversational context from factual document evidence.

### 1.5 How Workspace Authorization Is Enforced

- Authentication is handled by [`authenticateToken`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/middleware/auth.ts), attaching `req.user = { id, email, name }`.
- Workspace membership and RBAC are enforced by [`authorizeWorkspace(minimumRole)`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/middleware/authorizeWorkspace.ts), checking `workspace_members` and attaching `req.workspaceMember` and `req.workspace`.
- For conversation endpoints, all session and message queries must be scoped to `workspaceId` and `userId` directly in SQL / Prisma clauses.

### 1.6 Database Schema & Persistence Opportunities

- Existing models in [`prisma/schema.prisma`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/prisma/schema.prisma): `User`, `Workspace`, `WorkspaceMember`, `Session`, `Document`, `DocumentChunk`.
- New models required:
  - `ChatSession`: Represents a persistent conversation container belonging to a `Workspace` and `User`. Stores title, status (`ACTIVE`, `ARCHIVED`), rolling summary, summary metadata (`summaryVersion`, `summarizedThroughSeq`), and message counts.
  - `ChatMessage`: Represents individual turns (`USER`, `ASSISTANT`, `SYSTEM`) with sequence ordering (`sequenceNumber`), content, generation status (`PENDING`, `STREAMING`, `COMPLETED`, `FAILED`, `CANCELLED`), token estimates, citations JSON, and execution metadata JSON.

### 1.7 Streaming Support for Persistent Message IDs

- Currently, `/api/rag/stream` emits a transient `requestId: rag_<uuid>`.
- In Phase 5, `POST /api/conversations/:sessionId/messages/stream` will create the user `ChatMessage` (persisted immediately) and a pending assistant `ChatMessage` (persisted as `PENDING`/`STREAMING`).
- The stream will emit:
  1. `start`: `{ sessionId, userMessageId, assistantMessageId, sequenceNumber }`
  2. `user_message`: `{ id, content, sequenceNumber, createdAt }`
  3. `retrieval_complete` & `sources`: retrieved document context
  4. `token`: streaming answer text
  5. `validation`: citation verification results
  6. `done`: final completed message with duration and metadata
- If client disconnects or an error occurs, the assistant message is marked `CANCELLED` or `FAILED`, ensuring no orphaned streaming records remain.

---

## 2. Pre-Flight Architecture Blueprint for Phase 5

```
                  ┌──────────────────────────────────────────┐
                  │    React Frontend: KnowledgeAssistant    │
                  │  (ConversationSidebar + ChatTimeline)    │
                  └────────────────────┬─────────────────────┘
                                       │ HTTP REST / SSE Stream
                                       ▼
                  ┌──────────────────────────────────────────┐
                  │      Express Gateway: /api/conversations  │
                  │       authenticateToken & authorize      │
                  └────────────────────┬─────────────────────┘
                                       │
                ┌──────────────────────┴──────────────────────┐
                ▼                                             ▼
  ┌───────────────────────────┐                 ┌───────────────────────────┐
  │   ConversationController  │                 │  ConversationRAGService   │
  │ - Create / List / Rename  │                 │ - Contextual Query Engine │
  │ - Archive / Delete / Hist │                 │ - Fresh Hybrid Retrieval  │
  └─────────────┬─────────────┘                 │ - Conversational Prompt   │
                │                               │ - Provider Stream Exec    │
                ▼                               │ - Rolling Summary Manager │
  ┌───────────────────────────┐                 └─────────────┬─────────────┘
  │  ConversationRepository   │                               │
  │ - Prisma PostgreSQL       │◄──────────────────────────────┘
  │ - chat_sessions           │
  │ - chat_messages           │
  └───────────────────────────┘
```

---

## 3. Implementation Sequence & Plan

1. **Prisma Migration:** Add `ChatSession`, `ChatMessage`, `ChatSessionStatus`, `ChatMessageRole`, `ChatMessageStatus` with foreign keys, indexes, and unique sequence constraints.
2. **Shared Contracts:** Update `@mindvault/shared` with conversation DTOs, schemas, and streaming event interfaces. Rebuild package.
3. **Conversations Data Layer:** Build `conversation.repository.ts` and `conversation.service.ts` with strict workspace/user scoping.
4. **Contextual Query Processing:** Implement `QueryContextService` to resolve pronouns and conversational references for follow-up questions.
5. **Rolling Summary Service:** Implement `SummaryService` to maintain compact conversation summaries when threshold is reached.
6. **Conversational Prompt Builder:** Create `conversational.prompt.ts` with distinct, untrusted demarcation for history and summaries.
7. **Conversational RAG Orchestration & SSE:** Implement `ConversationRAGService` and stream endpoint with disconnect cleanup.
8. **REST Controller & Routes:** Expose `/api/conversations` CRUD and mount in `app.ts`.
9. **Frontend Experience:** Upgrade `KnowledgeAssistant` to a full conversation workspace with sidebar, session switcher, timeline, message cards, and source drawers.
10. **Automated Testing Suite:** Unit tests, integration tests, and multi-tenant security verification tests.
11. **Offline Evaluation Benchmark:** Create `docs/phase-5/EVALUATION.md` and benchmark script.
12. **Complete Documentation Suite:** 10 markdown documents in `docs/phase-5/`.
13. **Quality Gates & Commit:** Typecheck, lint, test, format, build, commit.
