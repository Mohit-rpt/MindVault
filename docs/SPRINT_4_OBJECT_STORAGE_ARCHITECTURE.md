# MindVault — Sprint 4: Secure Object Storage Architecture
## Specification, Provider Abstraction & Data Lifecycle Design

**Status:** APPROVED & IMPLEMENTED  
**Date:** 2026-11-20  
**Repository Baseline:** Sprint 4 HEAD on `main`  
**Primary Implementations:**  
- `apps/api/src/modules/document/document.storage.ts`
- `apps/worker/src/lib/storage.ts`
- `packages/shared/src/types.ts`

---

## 1. Context & Motivation

In previous iterations, MindVault stored uploaded document binaries on the local filesystem (`./infrastructure/storage/documents`) and serialized the entire file as a Base64 string in PostgreSQL JSONB (`documents.metadata.rawContentBase64`).

This hybrid bridge was designed for local worker processing, but introduced three critical architectural flaws:
1. **Container Ephemerality Data Loss:** Modern cloud container platforms (Render, Railway, Fly.io, Kubernetes) do not provide persistent local disk across deployments and container restarts. Once the worker completed ingestion and stripped `rawContentBase64` from database metadata, any subsequent user download attempt resulted in a 404 error.
2. **PostgreSQL Bloat:** Base64 encoding inflates file byte sizes by ~33%. Failed uploads or stalled ingestion left multi-megabyte Base64 payloads permanently stored in Neon database rows.
3. **Absence of Tenant Isolation in Storage:** Keys were flat filenames (`doc_{timestamp}_{hex}.ext`) stored in a single flat directory without workspace or document scoping.

---

## 2. Object Storage Provider Abstraction

MindVault abstracts storage access behind the provider-independent `DocumentStorageProvider` contract defined in `@mindvault/shared`:

```typescript
export interface StorageObjectMetadata {
  contentLength: number;
  contentType?: string;
  checksum?: string;
  lastModified?: Date;
}

export interface DocumentStorageProvider {
  save(storageKey: string, buffer: Buffer, metadata?: { contentType?: string }): Promise<void>;
  read(storageKey: string): Promise<Buffer>;
  delete(storageKey: string): Promise<void>;
  exists(storageKey: string): Promise<boolean>;
  getMetadata?(storageKey: string): Promise<StorageObjectMetadata | null>;
  saveStream?(
    storageKey: string,
    stream: NodeJS.ReadableStream,
    metadata?: { contentType?: string; contentLength?: number },
  ): Promise<void>;
  readStream?(storageKey: string): Promise<NodeJS.ReadableStream>;
  deleteMany?(storageKeys: string[]): Promise<void>;
}
```

### Provider Implementations

1. **`S3CompatibleStorageProvider` (`apps/api`) & `WorkerS3StorageProvider` (`apps/worker`):**
   - Implemented via `@aws-sdk/client-s3`.
   - Compatible with **Cloudflare R2**, **AWS S3**, **MinIO**, **Wasabi**, and **Google Cloud Storage (XML API)**.
   - Operates entirely with signed AWS SigV4 requests.
   - Configurable through environment variables without hardcoded credentials.
   - Supports streaming upload (`saveStream`), streaming download (`readStream`), object deletion (`delete`), bulk deletion (`deleteMany`), and metadata inspection (`getMetadata`).
2. **`LocalFileSystemStorageProvider` (`apps/api`) & `WorkerStorageProvider` (`apps/worker`):**
   - Retained for zero-dependency offline local development and unit tests.
   - Strict path traversal defenses: rejects `..`, `\`, null bytes, and absolute paths.
   - Fully implements `readStream`, `saveStream`, `deleteMany`, and `getMetadata`.
3. **`InMemoryStorageProvider`:**
   - In-memory mock implementing the full interface for deterministic, high-speed unit tests.

---

## 3. Storage Key Hierarchy & Tenant Isolation

Storage keys are generated exclusively server-side. User-supplied filenames are **never** used as storage keys.

### Hierarchical Key Format
$$\text{Key} = \text{documents}/\{\text{workspaceId}\}/\{\text{documentId}\}/\text{doc}\_\{\text{timestamp}\}\_\{\text{randomHex16}\}.\{\text{ext}\}$$

**Example:**
`documents/7b189a04-5867-4d92-8072-cb2f6412f8a1/3c2a0491-1123-41ea-bf28-1188192a8331/doc_1763632900000_a3f9e80271b483c92100deff11234a9b.pdf`

### Security Properties
- **Tenant Isolation:** All documents belonging to a workspace reside under `documents/{workspaceId}/...`.
- **Unguessability:** 16 cryptographically secure random bytes provide $2^{128}$ entropy, rendering brute-force enumeration impossible.
- **Path Traversal Immunity:** All segments (`workspaceId`, `documentId`, `extension`) are sanitized against non-alphanumeric characters, and path resolution verifies the path stays bounded within the storage root.
- **Bulk Cleanup Efficiency:** When an admin deletes a workspace, the system uses single-prefix bulk deletion to wipe all associated objects without leaking orphaned files.

---

## 4. Streaming Ingestion & Download Architecture

To protect server heap memory from unbounded spike during concurrent uploads and downloads, MindVault implements streaming end-to-end:

```text
[Client / Browser]
       │
       ▼ (HTTP GET /api/documents/:id/download)
[API: DocumentController.download]
       │
       ├─► 1. authenticate (JWT Session verification)
       ├─► 2. authorizeWorkspace('MEMBER')
       ├─► 3. DocumentService.streamDocument(workspaceId, documentId)
       │         │
       │         ├─► StorageProvider.readStream(doc.storageKey)
       │         └─► (Fallback: Readable.from(metadata.rawContentBase64))
       │
       ▼
   stream.pipe(res)
       │
       ▼ (Direct HTTP Chunked Transfer Encoding to Client)
```

**Heap Memory Impact:** Memory consumption is bounded to small stream chunk buffers (~64KB) rather than holding 10MB to 25MB full file buffers in Node.js V8 heap.

---

## 5. Storage Security & Access Control Policy

1. **Private Buckets by Default:** Storage buckets are configured private. Public object read/write access is strictly disabled.
2. **Authenticated Mediation:** Users never connect directly to storage. All requests pass through the MindVault API service, which verifies:
   - User authentication (`req.user`)
   - Workspace membership (`authorizeWorkspace`)
   - Cross-workspace document boundaries (`doc.workspaceId === workspaceId`)
3. **No Credential Exposure:** AWS/R2 Access Keys, Secret Keys, and bucket endpoints are never exposed in client bundles or public telemetry.

---

## 6. Verification Summary

Storage provider functionality was verified across 11 unit and integration tests in `apps/api/src/modules/document/__tests__/document.storage.test.ts`:
- Hierarchical key generation: **PASSED**
- Path traversal defense: **PASSED**
- Binary save, read, and delete: **PASSED**
- Streaming write and read with backpressure: **PASSED**
- Bulk delete (`deleteMany`): **PASSED**
- S3 client NoSuchKey error mapping: **PASSED**
- In-memory provider stream and metadata: **PASSED**
