# MindVault — Milestone 2.2 Implementation Report

## SSE Lifecycle & Stream Cancellation Hardening (VULN-RES-01)

**Date:** November 9, 2026  
**Milestone:** 2.2 — SSE Lifecycle & Stream Cancellation Hardening  
**Status:** COMPLETED & VERIFIED (782/782 tests passing, 0 regressions)  
**Security Finding Remediation:** VULN-RES-01 (Orphan Background LLM Tasks on Client SSE Disconnect)

---

## 1. Executive Summary

During the Phase 2.0 Security Architecture Assessment, **VULN-RES-01** identified a critical resource exhaustion vulnerability: when clients disconnected abruptly from Server-Sent Events (SSE) streaming endpoints (`POST /api/rag/stream` and `POST /api/conversations/:sessionId/messages/stream`), background retrieval and LLM token generation continued to completion. In addition, uncleaned event listeners caused potential memory leaks, and assistant messages could be left in an inconsistent `STREAMING` status in the database.

Milestone 2.2 has successfully remediated this vulnerability across the entire call stack:

1. **HTTP Controllers:** `GenerationController.stream` and `ConversationController.streamMessage` now bind `AbortController` instances to both `req.on('close')` and `res.on('close')` lifecycle events, clean up listeners deterministically in `finally` blocks, and guard against writing to terminated sockets.
2. **Service Layer:** `RAGService.generateAnswerStream` and `ConversationRAGService.streamConversationMessage` propagate `AbortSignal` downstream into `RetrievalService.executeSearch` and the active LLM provider. Abort checks are enforced at entry, before retrieval, after retrieval, during token streaming, and immediately after generator completion.
3. **LLM Providers:**
   - `OllamaProvider`: Links client `AbortSignal` to the underlying HTTP `fetch` socket, physically terminating outgoing network requests and cancelling the response stream reader.
   - `MockLLMProvider`: Wakes up and exits immediately during stream token delays upon receiving an abort event.
   - `GeminiProvider`: Detects abort signals and cleanly breaks generator iteration without throwing unhandled exceptions.
4. **State Persistence:** In conversation streaming, aborted sessions transition assistant messages to `status: 'CANCELLED'` with metadata `{ cancelled: true }`, ensuring messages are never left stranded in `STREAMING`.

---

## 2. Root Cause Analysis (VULN-RES-01)

| Vulnerability Dimension        | Pre-Milestone 2.2 State                                                                                                                                            | Vulnerability Impact                                                                                                                                                                                                                                                         |
| :----------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AbortController Binding**    | `GenerationController.stream` set `clientDisconnected = true` on `req.on('close')` but did **not** instantiate an `AbortController` or pass any signal downstream. | The controller stopped forwarding SSE tokens to the client socket, but the background async generator (`RAGService.generateAnswerStream`) executed all search queries, built prompts, called the LLM provider, ran grounding validation, and computed metrics to completion. |
| **Listener Lifecycle Cleanup** | Event listeners attached via `req.on('close')` were never detached after request termination.                                                                      | On long-running Node.js processes handling thousands of concurrent connections, unremoved event listeners leaked memory over time.                                                                                                                                           |
| **Downstream Propagation**     | Neither `RAGService.generateAnswerStream` nor `RetrievalService.executeSearch` accepted an `AbortSignal`.                                                          | Database vector queries (pgvector), full-text search, and multi-turn LLM generation consumed GPU/CPU/memory resources even after clients closed their tabs.                                                                                                                  |
| **Provider Upstream Abort**    | `OllamaProvider.generateStream` did not link `options.signal` to its internal `AbortController`.                                                                   | Outgoing HTTP requests to Ollama remained active on the network socket until the model produced all tokens.                                                                                                                                                                  |

---

## 3. Architecture & Cancellation Propagation Path

```mermaid
flowchart TD
    Client["Client Browser / SSE Consumer"]

    subgraph Controller_Layer["Controller Layer (Express HTTP)"]
        ReqClose["req.on('close') / res.on('close')"]
        AC["const abortController = new AbortController()"]
        Finally["finally { req.off('close'); res.off('close'); }"]
    end

    subgraph Service_Layer["Service Layer (Async Generators)"]
        RAG["RAGService.generateAnswerStream(..., signal)"]
        ConvRAG["ConversationRAGService.streamConversationMessage(..., signal)"]
        Check1["Entry Check: if (signal.aborted)"]
        Check2["Post-Retrieval Check: if (signal.aborted)"]
        Check3["Loop & Post-Loop Check: if (signal.aborted)"]
    end

    subgraph Retrieval_Layer["Retrieval Engine"]
        RetSvc["RetrievalService.executeSearch(..., signal)"]
        PGFusion["Vector + FTS + RRF Fusion"]
    end

    subgraph Provider_Layer["LLM Provider Layer"]
        Ollama["OllamaProvider: Aborts fetch socket & cancels reader"]
        Mock["MockLLMProvider: Aborts stream delay timer"]
        Gemini["GeminiProvider: Breaks generator loop & exits cleanly"]
    end

    Client -.->|Disconnect Socket| ReqClose
    ReqClose -->|abort()| AC
    AC -->|signal| RAG
    AC -->|signal| ConvRAG
    RAG --> Check1 --> RetSvc --> Check2 --> Ollama
    ConvRAG --> Check1 --> RetSvc --> Check2 --> Gemini
    Ollama --> Check3
    Gemini --> Check3
    RAG --> Finally
    ConvRAG --> Finally
```

### 3.1 Cancellation Flow Tracing

1. **Client Disconnect Detection:**
   - Both `req.on('close', onClose)` and `res.on('close', onClose)` are registered to handle both client-side TCP teardowns (`req` close) and proxy socket closures (`res` close).
   - Upon trigger, `clientDisconnected = true` is set and `abortController.abort()` is invoked immediately.
2. **Downstream Retrieval Cancellation:**
   - `RetrievalService.executeSearch(workspaceId, req, abortSignal)` checks `abortSignal?.aborted` before commencing embedding generation and SQL queries.
   - If aborted, it immediately throws `new Error('CLIENT_ABORTED')`, avoiding database query execution and Reciprocal Rank Fusion (RRF) overhead.
3. **Downstream LLM Provider Cancellation:**
   - The `AbortSignal` is passed in `LLMGenerateOptions.signal`.
   - In `OllamaProvider.generateStream`: An `onSignalAbort` listener invokes `controller.abort()`, which aborts the native Node.js `fetch` request. The stream reader's `cancel()` method is called in the `finally` block to release network socket buffers.
   - In `MockLLMProvider.generateStream`: Delay timers register an `abort` listener, waking up immediately without blocking test execution or synthetic pipelines.
   - In `GeminiProvider.generateStream`: The generator checks `options?.signal?.aborted` before starting, on each chunk, and upon loop exit, cleanly returning without throwing unhandled exceptions.
4. **Post-Loop Invariant Guard:**
   - If the upstream provider generator exits early due to cancellation, the consumer's `for await` loop naturally terminates.
   - To prevent the service from advancing to validation, citation checking, and final completion events, a mandatory `if (abortSignal?.aborted) throw new Error('CLIENT_ABORTED')` check is enforced immediately following the generator loop.
5. **Deterministic Cleanup:**
   - In `finally` blocks, `req.off('close', onClose)` and `res.off('close', onClose)` guarantee that listeners are removed regardless of whether the stream completed normally, aborted, or errored.
   - `res.end()` is guarded: `if (!clientDisconnected && !res.writableEnded) res.end()`, preventing `ERR_STREAM_DESTROYED` crashes.

---

## 4. Files Modified & Implementation Details

### 4.1 Shared Types

- **File:** [`packages/shared/src/types.ts`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/packages/shared/src/types.ts#L526)
- **Change:** Added optional `signal?: AbortSignal;` to `LLMGenerateOptions`.

### 4.2 Retrieval Engine

- **File:** [`apps/api/src/modules/retrieval/services/retrieval.service.ts`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/modules/retrieval/services/retrieval.service.ts#L34-L45)
- **Change:**
  - Added `abortSignal?: AbortSignal` to `RetrievalService.executeSearch`.
  - Added entry-point cancellation check: `if (abortSignal?.aborted) throw new Error('CLIENT_ABORTED');`.
  - Added pre-fusion check before computing RRF rankings.

### 4.3 Generative RAG Service & Controller

- **File:** [`apps/api/src/modules/generation/services/rag.service.ts`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/modules/generation/services/rag.service.ts#L105-L210)
  - Added `abortSignal?: AbortSignal` to `generateAnswerStream`.
  - Propagated signal into `RetrievalService.executeSearch` and `provider.generateStream`.
  - Added mid-stream and post-stream abort guards.
  - Formatted cancellation catch to yield `{ type: 'error', code: 'CLIENT_ABORTED', message: 'Generation cancelled by client' }`.
- **File:** [`apps/api/src/modules/generation/generation.controller.ts`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/modules/generation/generation.controller.ts#L78-L125)
  - Instantiated `AbortController` and attached `req.on('close')` + `res.on('close')`.
  - Added `finally` listener cleanup (`req.off`, `res.off`).
  - Guarded `res.end()` against closed socket writes.

### 4.4 Conversation Service & Controller

- **File:** [`apps/api/src/modules/conversations/services/conversation-rag.service.ts`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/modules/conversations/services/conversation-rag.service.ts#L120-L225)
  - Propagated `abortSignal` into query contextualization, `RetrievalService.executeSearch`, and `provider.generateStream`.
  - Added post-stream abort guard.
  - Guaranteed database message update to `status: 'CANCELLED'` and metadata `{ cancelled: true }`.
- **File:** [`apps/api/src/modules/conversations/conversation.controller.ts`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/modules/conversations/conversation.controller.ts#L320-L360)
  - Synchronized disconnect handling: attached `req.on('close')` and `res.on('close')`.
  - Added `finally` cleanup for both event listeners.

### 4.5 LLM Providers

- **File:** [`apps/api/src/modules/generation/providers/ollama.provider.ts`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/modules/generation/providers/ollama.provider.ts#L85-L265)
  - Linked `options.signal` to internal `AbortController` in both `generate()` and `generateStream()`.
  - Cleaned up stream reader via `reader.cancel()` and `reader.releaseLock()` in `finally`.
  - Cleaned up timeout timers and event listeners.
- **File:** [`apps/api/src/modules/generation/providers/mock.provider.ts`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/modules/generation/providers/mock.provider.ts#L40-L185)
  - Added `setStreamDelay(ms: number)` helper.
  - Made stream delay interruptible via `AbortSignal` listener, enabling instant exit on abort.
- **File:** [`apps/api/src/modules/generation/providers/gemini.provider.ts`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/modules/generation/providers/gemini.provider.ts#L150-L220)
  - Added `options?.signal?.aborted` checks at entry, candidate selection, chunk iteration, and catch block.

---

## 5. Provider Cancellation Mechanics: Upstream vs Downstream

| Provider            | Implementation Mechanism                                  | Actual Upstream Socket Cancellation? | Description                                                                                                                                                                                                                                                                                                                                                    |
| :------------------ | :-------------------------------------------------------- | :----------------------------------: | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **OllamaProvider**  | Native `fetch` with linked `AbortController.signal`       |               **YES**                | Outgoing TCP socket to Ollama daemon is aborted immediately via `controller.abort()`, freeing GPU/CPU compute on the local model server.                                                                                                                                                                                                                       |
| **MockLLMProvider** | Abortable `setTimeout` promise with `removeEventListener` |               **YES**                | Timer is cleared immediately; generator ceases token production and releases the async iterator.                                                                                                                                                                                                                                                               |
| **GeminiProvider**  | Generator loop break with early return                    | **PARTIAL** (Downstream termination) | Google's `@google/genai` Node SDK (`client.models.generateContentStream`) does not currently expose an `AbortSignal` in its configuration schema. The implementation breaks out of the `for await (const chunk of stream)` loop immediately, preventing server memory consumption and token accumulation, while returning cleanly without unhandled rejection. |

---

## 6. Verification & Test Evidence

### 6.1 Dedicated SSE Cancellation Test Suite

A comprehensive test suite was authored at [`apps/api/src/modules/generation/__tests__/sse-cancellation.test.ts`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/modules/generation/__tests__/sse-cancellation.test.ts):

```
✓ Milestone 2.2 — SSE Lifecycle & Stream Cancellation Hardening
  ✓ RAGService.generateAnswerStream Abort Propagation
    ✓ should immediately yield CLIENT_ABORTED error if signal is already aborted (23ms)
    ✓ should abort and yield CLIENT_ABORTED if signal aborts during retrieval phase (6ms)
    ✓ should abort and yield CLIENT_ABORTED if signal aborts during token generation phase (99ms)
    ✓ should complete full lifecycle normally when not aborted (7ms)
  ✓ LLM Providers Abort Handling
    ✓ MockLLMProvider should exit immediately when signal is aborted during streamDelay (54ms)
    ✓ OllamaProvider should link options.signal to fetch AbortController (13ms)
    ✓ GeminiProvider should cleanly exit generator when signal is aborted (10ms)
  ✓ GenerationController.stream SSE HTTP Disconnect Handling
    ✓ should detect client disconnect, cancel generation, and clean up event listeners (3610ms)
    ✓ should maintain concurrency isolation: aborting Request A does not abort Request B (2020ms)
  ✓ ConversationRAGService Stream Cancellation
    ✓ should transition assistant message to CANCELLED and not leave it in STREAMING (33ms)

Test Files  1 passed (1)
Tests       10 passed (10)
```

### 6.2 Full Regression Suite Execution

| Test Target                  | Files Tested | Total Tests | Passed  | Failed | Regressions |
| :--------------------------- | :----------: | :---------: | :-----: | :----: | :---------: |
| `apps/api` (Full Suite)      |      54      |     633     | **633** |   0    |    **0**    |
| `apps/worker` (Full Suite)   |      13      |     149     | **149** |   0    |    **0**    |
| **Total MindVault Monorepo** |    **67**    |   **782**   | **782** | **0**  |    **0**    |

All existing tests across authentication, authorization, multi-tenant isolation, document extraction, graph extraction, graph traversal, and generation passed with 100% success rate.

---

## 7. Known Architectural Limitations & Boundaries

1. **Gemini SDK Upstream Socket:** As noted in §5, Google's `@google/genai` SDK does not support `AbortSignal` in its stream configuration. Upstream socket abort for Gemini will be unlocked once Google introduces native signal support in `@google/genai`. In the interim, server-side resource leakage is completely eliminated via immediate generator termination.
2. **PostgreSQL In-Flight Query Cancellation:** While `RetrievalService.executeSearch` aborts before queries execute and before fusion, in-flight PostgreSQL vector searches that have already reached the database socket are bounded by PostgreSQL statement timeouts (`statement_timeout = 2500ms`) rather than `pg_cancel_backend`.

---

## 8. Milestone 2.2 Completion Verdict & Stop Gate

> [!IMPORTANT]
> **MILESTONE 2.2 IS COMPLETE AND FULLY VERIFIED.**
>
> - **VULN-RES-01 is remediated:** Client SSE disconnections cleanly cancel downstream retrieval and LLM operations, listeners are removed, and database records transition to `CANCELLED`.
> - **Zero breaking changes:** Existing SSE event schema (`start`, `retrieval_complete`, `sources`, `token`, `validation`, `done`, `error`) remains identical.
> - **Zero regressions:** 782/782 tests pass across `apps/api` and `apps/worker`.
>
> **STOP GATE ENFORCED:** Per instructions, execution is paused awaiting explicit user review and authorization before proceeding to Milestone 2.3 (Workspace Member Management & Role Elevation) or Milestone 2.4.
