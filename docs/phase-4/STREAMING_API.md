# MindVault — Phase 4 Streaming API & SSE Protocol

**Date:** 2026-11-06  
**Status:** Implemented & Verified  
**Scope:** Server-Sent Events (SSE) Specification, Event Types, Backpressure, and Disconnection Handling

---

## 1. Streaming Protocol Overview

MindVault implements real-time token streaming using standard HTTP Server-Sent Events (SSE) on the endpoint:

```http
POST /api/rag/stream
Content-Type: application/json
Authorization: Bearer <jwt_access_token>
```

### Request Headers & Response Initialization

Upon receiving a valid request, [`GenerationController`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/modules/generation/generation.controller.ts) sets standard streaming headers:

```http
HTTP/1.1 200 OK
Content-Type: text/event-stream
Cache-Control: no-cache, no-transform
Connection: keep-alive
X-Accel-Buffering: no
```

---

## 2. Event Taxonomy

The streaming connection emits four distinct event types serialized as standard SSE frames:

### 2.1 `event: metadata`

Emitted immediately after hybrid retrieval completes, providing sources and token estimates before the first generation token is emitted:

```text
event: metadata
data: {"sources":[{"citationId":"[S1]","documentName":"api_guide.pdf","pageRange":"p. 3","snippet":"..."}],"retrievalMs":12,"tokenEstimate":420}

```

### 2.2 `event: token`

Emitted for every generated token or word chunk from the LLM stream:

```text
event: token
data: {"text":"MindVault "}

event: token
data: {"text":"enforces "}

event: token
data: {"text":"workspace "}

event: token
data: {"text":"isolation. "}

```

### 2.3 `event: done`

Emitted when generation is complete and citations and grounding have been validated:

```text
event: done
data: {"answer":"MindVault enforces workspace isolation [S1].","validCitations":[{"citationId":"[S1]","documentName":"api_guide.pdf"}],"unknownCitations":[],"grounding":{"status":"GROUNDED","score":1.0,"warnings":[]},"telemetry":{"retrievalMs":12,"generationMs":340,"totalMs":352,"tokensGenerated":8,"provider":"ollama","model":"qwen3:0.6b"}}

```

### 2.4 `event: error`

Emitted if an unhandled exception or abort occurs during retrieval or generation:

```text
event: error
data: {"code":"LLM_ERROR","message":"Upstream model execution failed"}

```

---

## 3. Disconnection & Cancellation Handling

To prevent orphaned model executions on the Ollama runtime when a user navigates away or closes their browser:

1. **`req.on('close')` Listener:** The controller registers a close listener on the incoming HTTP request.
2. **`AbortController` Propagation:** When the client disconnects before completion, an internal `AbortController` triggers `abort()`, propagating an `AbortSignal` through `RAGService` to `OllamaProvider`.
3. **Upstream Abort:** `fetch()` to `http://localhost:11434/api/generate` is aborted immediately, halting GPU/CPU inference on the local host.
