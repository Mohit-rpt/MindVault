# MindVault — Phase 5: REST & SSE API Reference

**Base URL:** `/api/conversations`  
**Authentication:** Required (`Authorization: Bearer <JWT>`)  
**Workspace Scoping:** Required (`X-Workspace-ID: <workspaceId>`)

---

## 1. Endpoints Overview

| Method   | Endpoint                                        | Description                                    |
| -------- | ----------------------------------------------- | ---------------------------------------------- |
| `POST`   | `/api/conversations`                            | Create a new chat session                      |
| `GET`    | `/api/conversations`                            | List conversation sessions in active workspace |
| `GET`    | `/api/conversations/:sessionId`                 | Get single conversation session by ID          |
| `PATCH`  | `/api/conversations/:sessionId`                 | Update title or lifecycle status (archive)     |
| `DELETE` | `/api/conversations/:sessionId`                 | Soft-delete / remove conversation session      |
| `GET`    | `/api/conversations/:sessionId/messages`        | List paginated messages for a session          |
| `POST`   | `/api/conversations/:sessionId/messages`        | Synchronously append a message to session      |
| `POST`   | `/api/conversations/:sessionId/messages/stream` | Stream RAG assistant answer via SSE            |

---

## 2. Detailed Endpoint Specifications

### 2.1 Create Conversation Session

`POST /api/conversations`

**Request Body (`application/json`):**

```json
{
  "title": "Quantum Computing Notes",
  "initialMessage": "What are qubits?"
}
```

**Response (`201 Created`):**

```json
{
  "success": true,
  "data": {
    "id": "cs_9f81a7b2-3c81-49e0-8fa3-94c33d8c47b1",
    "workspaceId": "ws_1a2b3c",
    "userId": "usr_9901",
    "title": "Quantum Computing Notes",
    "status": "ACTIVE",
    "summary": null,
    "summaryVersion": 0,
    "summarizedThroughSeq": 0,
    "summaryUpdatedAt": null,
    "messageCount": 0,
    "lastMessageAt": "2026-11-06T11:30:00.000Z",
    "createdAt": "2026-11-06T11:30:00.000Z",
    "updatedAt": "2026-11-06T11:30:00.000Z",
    "archivedAt": null
  }
}
```

---

### 2.2 List Conversations

`GET /api/conversations?limit=20&status=ACTIVE&search=quantum`

**Response (`200 OK`):**

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "cs_9f81a7b2-3c81-49e0-8fa3-94c33d8c47b1",
        "workspaceId": "ws_1a2b3c",
        "userId": "usr_9901",
        "title": "Quantum Computing Notes",
        "status": "ACTIVE",
        "summary": "User explored quantum entanglement and error correction.",
        "summaryVersion": 1,
        "messageCount": 6,
        "lastMessageAt": "2026-11-06T11:35:12.000Z",
        "createdAt": "2026-11-06T11:30:00.000Z",
        "updatedAt": "2026-11-06T11:35:12.000Z"
      }
    ],
    "hasMore": false
  }
}
```

---

### 2.3 Update Conversation Session

`PATCH /api/conversations/:sessionId`

**Request Body (`application/json`):**

```json
{
  "title": "Renamed Session Title",
  "status": "ARCHIVED"
}
```

**Response (`200 OK`):**

```json
{
  "success": true,
  "data": {
    "id": "cs_9f81a7b2-3c81-49e0-8fa3-94c33d8c47b1",
    "title": "Renamed Session Title",
    "status": "ARCHIVED",
    "archivedAt": "2026-11-06T11:40:00.000Z"
  }
}
```

---

### 2.4 Delete Conversation Session

`DELETE /api/conversations/:sessionId`

**Response (`200 OK`):**

```json
{
  "success": true,
  "data": {
    "message": "Conversation session deleted successfully"
  }
}
```

---

### 2.5 List Session Messages

`GET /api/conversations/:sessionId/messages?limit=50`

**Response (`200 OK`):**

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "msg_01",
        "sessionId": "cs_9f81a7b2-3c81-49e0-8fa3-94c33d8c47b1",
        "workspaceId": "ws_1a2b3c",
        "role": "USER",
        "content": "What is pgvector?",
        "status": "COMPLETED",
        "sequenceNumber": 1,
        "citations": [],
        "metadata": {},
        "tokenEstimate": 5,
        "createdAt": "2026-11-06T11:30:00.000Z",
        "completedAt": "2026-11-06T11:30:00.000Z"
      },
      {
        "id": "msg_02",
        "sessionId": "cs_9f81a7b2-3c81-49e0-8fa3-94c33d8c47b1",
        "workspaceId": "ws_1a2b3c",
        "role": "ASSISTANT",
        "content": "pgvector is a PostgreSQL extension for vector similarity search [S1].",
        "status": "COMPLETED",
        "sequenceNumber": 2,
        "citations": [
          {
            "citationId": "[S1]",
            "chunkId": "chk_881",
            "documentId": "doc_pg",
            "documentName": "pgvector-guide.pdf",
            "pageRange": "1",
            "section": "Overview",
            "score": 0.88
          }
        ],
        "metadata": {
          "grounding": { "groundingStatus": "GROUNDED", "warnings": [] }
        },
        "tokenEstimate": 15,
        "createdAt": "2026-11-06T11:30:01.000Z",
        "completedAt": "2026-11-06T11:30:03.000Z"
      }
    ]
  }
}
```

---

### 2.6 Stream Conversational Message Answer (SSE)

`POST /api/conversations/:sessionId/messages/stream`

**Headers:**

- `Content-Type: application/json`
- `Accept: text/event-stream`
- `Authorization: Bearer <token>`
- `X-Workspace-ID: <workspaceId>`

**Request Body:**

```json
{
  "content": "And what about its drawbacks?",
  "retrieval": {
    "mode": "hybrid",
    "topK": 5
  },
  "generation": {
    "temperature": 0.2
  }
}
```

**SSE Event Lifecycle Protocol:**

1. `event: start`
   ```json
   { "sessionId": "cs_1", "messageId": "msg_asst_1", "userMessageId": "msg_user_1" }
   ```
2. `event: query_rewrite`
   ```json
   {
     "originalQuery": "And what about its drawbacks?",
     "rewrittenQuery": "What are the drawbacks and limitations of pgvector?",
     "wasRewritten": true
   }
   ```
3. `event: retrieval_complete`
   ```json
   { "chunkCount": 3, "timings": { "retrievalMs": 14 } }
   ```
4. `event: sources`
   ```json
   {
     "sources": [
       { "citationId": "[S1]", "chunkId": "chk_881", "documentName": "pgvector.pdf", "score": 0.88 }
     ]
   }
   ```
5. `event: token` (repeated)
   ```json
   { "text": "While " }
   ```
6. `event: validation`
   ```json
   {
     "grounding": {
       "groundingStatus": "GROUNDED",
       "referencedCitationIds": ["[S1]"],
       "warnings": []
     }
   }
   ```
7. `event: summary_updated` (emitted if message threshold reached)
   ```json
   { "summary": "Discussion covered pgvector benefits and limitations.", "summaryVersion": 1 }
   ```
8. `event: done`
   ```json
   {
     "messageId": "msg_asst_1",
     "totalTokens": 64,
     "metadata": { "generationDurationMs": 280, "totalMs": 310 }
   }
   ```
