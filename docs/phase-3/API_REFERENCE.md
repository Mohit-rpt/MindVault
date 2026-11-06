# MindVault — Phase 3 API Reference

**Service:** MindVault Core API (`@mindvault/api`)  
**Base URL:** `/api/retrieval`  
**Authentication:** Bearer JWT in `Authorization` header  
**Tenancy Context:** `X-Workspace-ID` header, route query, or request body

---

## 1. Endpoints Overview

| Method | Endpoint                | Description                                           | Required Role |
| :----- | :---------------------- | :---------------------------------------------------- | :------------ |
| `POST` | `/api/retrieval/search` | Execute hybrid, semantic, or keyword knowledge search | `MEMBER`      |

---

## 2. `POST /api/retrieval/search`

Executes multi-tenant evidence search across indexed document chunks within the authorized workspace.

### 2.1 Request Headers

```http
Authorization: Bearer <JWT_ACCESS_TOKEN>
X-Workspace-ID: <WORKSPACE_UUID>
Content-Type: application/json
```

### 2.2 Request Body Specification

| Field              | Type    | Required | Default    | Description                                  | Constraints                           |
| :----------------- | :------ | :------- | :--------- | :------------------------------------------- | :------------------------------------ |
| `query`            | string  | **Yes**  | —          | Search query string                          | 1–1000 characters                     |
| `mode`             | string  | No       | `'hybrid'` | Retrieval strategy                           | `'hybrid'`, `'semantic'`, `'keyword'` |
| `topK`             | integer | No       | `10`       | Number of ranked results                     | 1 to 50                               |
| `includeContext`   | boolean | No       | `true`     | Whether to assemble structured context block | `true` or `false`                     |
| `maxContextTokens` | integer | No       | `3000`     | Maximum token budget for assembled context   | 100 to 16,000                         |
| `enableReranking`  | boolean | No       | `false`    | Request cross-encoder reranking              | `true` or `false`                     |
| `filters`          | object  | No       | —          | Metadata-based retrieval filters             | See below                             |

#### Filters Object (`filters`)

| Field         | Type     | Description                                              | Constraints                |
| :------------ | :------- | :------------------------------------------------------- | :------------------------- |
| `documentIds` | string[] | Restrict search to specific document UUIDs               | Array of non-empty strings |
| `fileTypes`   | string[] | Restrict search by file extension (e.g. `['pdf', 'md']`) | Array of strings           |
| `pageStart`   | integer  | Match chunks on or after this page number                | Positive integer           |
| `pageEnd`     | integer  | Match chunks on or before this page number               | Must be $\ge$ `pageStart`  |

### 2.3 Example Request

```json
{
  "query": "How does backpropagation compute gradients in neural networks?",
  "mode": "hybrid",
  "topK": 5,
  "includeContext": true,
  "maxContextTokens": 2000,
  "filters": {
    "fileTypes": ["pdf"],
    "pageStart": 1,
    "pageEnd": 20
  }
}
```

### 2.4 Example Response

```json
{
  "success": true,
  "data": {
    "query": "How does backpropagation compute gradients in neural networks?",
    "mode": "hybrid",
    "results": [
      {
        "chunkId": "chk_c0192e4a",
        "documentId": "doc_9281aef1",
        "documentName": "deep_learning_handbook.pdf",
        "content": "Backpropagation computes the gradient of the loss function with respect to the weights of the neural network using the chain rule of calculus...",
        "chunkIndex": 3,
        "rank": 1,
        "score": 0.0325,
        "retrievalSources": ["semantic", "keyword"],
        "citationId": "[S1]",
        "pageStart": 12,
        "pageEnd": 13,
        "tokenCount": 85,
        "metadata": {
          "heading": "Backpropagation and Calculus"
        }
      }
    ],
    "context": {
      "content": "--- SOURCE [S1] | Document: deep_learning_handbook.pdf (Chunk: 4) | Page: pp. 12-13 | Section: \"Backpropagation and Calculus\" ---\nBackpropagation computes the gradient of the loss function with respect to the weights of the neural network using the chain rule of calculus...",
      "tokenEstimate": 105,
      "sources": [
        {
          "citationId": "[S1]",
          "documentId": "doc_9281aef1",
          "documentName": "deep_learning_handbook.pdf",
          "chunkId": "chk_c0192e4a",
          "chunkIndex": 3,
          "pageNumber": 12,
          "pageRange": "pp. 12-13",
          "section": "Backpropagation and Calculus",
          "content": "Backpropagation computes the gradient...",
          "rank": 1,
          "score": 0.0325,
          "retrievalSources": ["semantic", "keyword"]
        }
      ]
    },
    "metadata": {
      "semanticSearchUsed": true,
      "keywordSearchUsed": true,
      "rerankingApplied": false,
      "totalResults": 1,
      "query": "How does backpropagation compute gradients in neural networks?",
      "normalizedQuery": "How does backpropagation compute gradients in neural networks?",
      "timings": {
        "queryProcessingMs": 0.42,
        "embeddingGenerationMs": 12.35,
        "semanticSearchMs": 3.81,
        "keywordSearchMs": 1.94,
        "fusionMs": 0.28,
        "rerankingMs": 0.05,
        "contextAssemblyMs": 0.32,
        "totalMs": 19.17
      }
    }
  },
  "meta": {
    "timestamp": "2026-11-06T10:14:00.000Z",
    "workspaceId": "ws_alpha_123"
  }
}
```

---

## 3. Error Codes & Handling

| HTTP Status | Error Code                 | Description                                                               |
| :---------- | :------------------------- | :------------------------------------------------------------------------ |
| `400`       | `VALIDATION_ERROR`         | Malformed request parameters (e.g. empty query, `pageStart > pageEnd`)    |
| `400`       | `MISSING_WORKSPACE_ID`     | `X-Workspace-ID` header or parameter missing from request                 |
| `401`       | `UNAUTHORIZED`             | Missing, expired, or invalid JWT access token                             |
| `403`       | `FORBIDDEN`                | Authenticated user is not an authorized member of the requested workspace |
| `500`       | `EMBEDDING_PROVIDER_ERROR` | Ollama or embedding provider failed to generate a valid vector            |
