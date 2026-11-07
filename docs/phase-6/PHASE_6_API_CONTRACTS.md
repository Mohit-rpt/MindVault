# MindVault — Phase 6: REST API Contracts & Endpoint Specifications

**Document Version:** 1.0.0  
**Status:** API Specification (Planning Only)  
**Target Module:** `apps/api/src/modules/graph/`  
**Shared Contracts:** `packages/shared/src/schemas/graph.schema.ts`  
**Authors:** Senior Full-Stack Engineer, API Architect  
**Date:** November 2026

---

## 1. REST Endpoint Summary

All graph endpoints require standard authentication (`Authorization: Bearer <token>`) and tenant scoping (`x-workspace-id: <workspaceId>`).

| Method | Endpoint                               | Description                                              | Role Required              |
| ------ | -------------------------------------- | -------------------------------------------------------- | -------------------------- |
| `GET`  | `/api/graph/entities`                  | List and search canonical entities with pagination       | `MEMBER`, `ADMIN`, `OWNER` |
| `GET`  | `/api/graph/entities/:id`              | Get entity detail with aliases, descriptions, and degree | `MEMBER`, `ADMIN`, `OWNER` |
| `GET`  | `/api/graph/entities/:id/neighborhood` | Fetch connected subgraph for interactive visualization   | `MEMBER`, `ADMIN`, `OWNER` |
| `GET`  | `/api/graph/relations`                 | List relationships with type and endpoint filters        | `MEMBER`, `ADMIN`, `OWNER` |
| `GET`  | `/api/graph/relations/:id/evidence`    | Fetch verbatim chunk evidence supporting a relation      | `MEMBER`, `ADMIN`, `OWNER` |
| `POST` | `/api/graph/paths`                     | Find multi-hop paths connecting two entities             | `MEMBER`, `ADMIN`, `OWNER` |
| `POST` | `/api/graph/reindex/:documentId`       | Re-trigger asynchronous graph extraction for a document  | `ADMIN`, `OWNER`           |

---

## 2. Endpoint Specifications

### 2.1 `GET /api/graph/entities`

Lists canonical entities in the active workspace with filtering and pagination.

#### Query Parameters:

- `page` (optional integer, default `1`)
- `limit` (optional integer, min `1`, max `100`, default `20`)
- `type` (optional enum: `TECHNOLOGY`, `CONCEPT`, `PERSON`, `ORGANIZATION`, `PRODUCT`, `LOCATION`, `OTHER`)
- `search` (optional string, fuzzy prefix search on `canonicalName`)
- `sortBy` (optional: `name` | `degree` | `createdAt`, default `name`)

#### Response Body (`200 OK`):

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "ent_9f8b2c41-89a1-4321-9988-123456789abc",
        "canonicalName": "PostgreSQL",
        "normalizedName": "postgresql",
        "entityType": "TECHNOLOGY",
        "description": "An open-source object-relational database management system.",
        "aliases": ["Postgres", "pg16"],
        "degree": 14,
        "createdAt": "2026-11-05T12:00:00.000Z",
        "updatedAt": "2026-11-06T15:30:00.000Z"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "totalItems": 142,
      "totalPages": 8
    }
  }
}
```

---

### 2.2 `GET /api/graph/entities/:id/neighborhood`

Retrieves a subgraph centered at the specified entity, optimized for `@xyflow/react` graph rendering.

#### Query Parameters:

- `depth` (optional integer, min `1`, max `3`, default `1`)
- `limit` (optional integer, min `5`, max `100`, default `30`)

#### Response Body (`200 OK`):

```json
{
  "success": true,
  "data": {
    "centerEntityId": "ent_9f8b2c41-89a1-4321-9988-123456789abc",
    "nodes": [
      {
        "id": "ent_9f8b2c41-89a1-4321-9988-123456789abc",
        "label": "PostgreSQL",
        "entityType": "TECHNOLOGY",
        "description": "An open-source object-relational database system.",
        "degree": 14,
        "depth": 0
      },
      {
        "id": "ent_1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d",
        "label": "HNSW",
        "entityType": "CONCEPT",
        "description": "Hierarchical Navigable Small World vector indexing algorithm.",
        "degree": 5,
        "depth": 1
      }
    ],
    "edges": [
      {
        "id": "rel_44332211-00aa-bbcc-ddee-ff9988776655",
        "source": "ent_9f8b2c41-89a1-4321-9988-123456789abc",
        "target": "ent_1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d",
        "label": "IMPLEMENTS",
        "description": "PostgreSQL implements HNSW vector indexing via the pgvector extension.",
        "weight": 1.0,
        "confidence": 0.95,
        "evidenceCount": 2
      }
    ]
  }
}
```

---

### 2.3 `GET /api/graph/relations/:id/evidence`

Retrieves the verbatim chunk evidence passages supporting an asserted relationship.

#### Response Body (`200 OK`):

```json
{
  "success": true,
  "data": {
    "relationId": "rel_44332211-00aa-bbcc-ddee-ff9988776655",
    "sourceEntity": {
      "id": "ent_9f8b2c41-89a1-4321-9988-123456789abc",
      "name": "PostgreSQL"
    },
    "targetEntity": {
      "id": "ent_1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d",
      "name": "HNSW"
    },
    "relationType": "IMPLEMENTS",
    "evidence": [
      {
        "id": "evid_1234-5678-90ab-cdef",
        "documentId": "doc_a1b2c3d4-e5f6-7890",
        "documentName": "Vector_Search_in_Postgres.pdf",
        "chunkId": "chk_9876-5432-10fe-dcba",
        "chunkIndex": 4,
        "pageNumber": 7,
        "evidenceText": "PostgreSQL implements HNSW indexing via the pgvector extension, achieving sub-10ms approximate nearest neighbor search over millions of vectors.",
        "confidence": 0.96,
        "createdAt": "2026-11-06T10:15:00.000Z"
      }
    ]
  }
}
```

---

### 2.4 `POST /api/graph/paths`

Calculates relationship paths connecting two entities across multiple documents.

#### Request Body:

```json
{
  "sourceEntityId": "ent_ml_01",
  "targetEntityId": "ent_ir_02",
  "maxDepth": 3,
  "limit": 5
}
```

#### Response Body (`200 OK`):

```json
{
  "success": true,
  "data": {
    "sourceEntityId": "ent_ml_01",
    "targetEntityId": "ent_ir_02",
    "pathsFound": 1,
    "paths": [
      {
        "depth": 3,
        "pathEntities": [
          { "id": "ent_ml_01", "name": "Machine Learning" },
          { "id": "ent_nn_03", "name": "Neural Networks" },
          { "id": "ent_dl_04", "name": "Deep Learning" },
          { "id": "ent_ir_02", "name": "Image Recognition" }
        ],
        "pathRelations": [
          { "id": "rel_01", "type": "USES" },
          { "id": "rel_02", "type": "FUNDAMENTAL_TO" },
          { "id": "rel_03", "type": "USED_FOR" }
        ]
      }
    ]
  }
}
```

---

## 3. Shared Zod Request Validation Schemas

Defined in `packages/shared/src/schemas/graph.schema.ts`:

```typescript
import { z } from 'zod';

export const EntityTypeSchema = z.enum([
  'TECHNOLOGY',
  'CONCEPT',
  'PERSON',
  'ORGANIZATION',
  'PRODUCT',
  'LOCATION',
  'OTHER',
]);

export const ListEntitiesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  type: EntityTypeSchema.optional(),
  search: z.string().trim().max(100).optional(),
  sortBy: z.enum(['name', 'degree', 'createdAt']).default('name'),
});

export const GraphNeighborhoodQuerySchema = z.object({
  depth: z.coerce.number().int().min(1).max(3).default(1),
  limit: z.coerce.number().int().min(5).max(100).default(30),
});

export const PathFinderRequestSchema = z.object({
  sourceEntityId: z.string().uuid(),
  targetEntityId: z.string().uuid(),
  maxDepth: z.coerce.number().int().min(1).max(4).default(3),
  limit: z.coerce.number().int().min(1).max(10).default(5),
});
```

---

## 4. Error Code Taxonomy

| HTTP Code | Error Code                | Description                                                              |
| --------- | ------------------------- | ------------------------------------------------------------------------ |
| `400`     | `INVALID_GRAPH_QUERY`     | Malformed parameters (e.g., `depth > 3` or invalid UUID)                 |
| `403`     | `FORBIDDEN_WORKSPACE`     | Target entity belongs to a different workspace (tenant isolation breach) |
| `404`     | `ENTITY_NOT_FOUND`        | Specified entity ID does not exist in the active workspace               |
| `404`     | `RELATION_NOT_FOUND`      | Specified relationship ID does not exist in the active workspace         |
| `409`     | `REINDEX_IN_PROGRESS`     | Graph extraction is already running for the specified document           |
| `504`     | `GRAPH_TRAVERSAL_TIMEOUT` | Recursive CTE exceeded the 2500ms safety timeout                         |
