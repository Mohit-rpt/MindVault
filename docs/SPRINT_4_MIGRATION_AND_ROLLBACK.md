# MindVault — Sprint 4: Migration, Backfill & Rollback Safety
## Resumable Object Storage Backfill & Zero-Downtime Rollback Protocols

**Status:** APPROVED & IMPLEMENTED  
**Date:** 2026-11-20  
**Repository Baseline:** Sprint 4 HEAD on `main`  
**Migration Tool:** `scripts/migrate-documents-to-object-storage.ts`

---

## 1. Migration Philosophy & Non-Destructive Invariants

To guarantee data safety for existing MindVault users and demo workspaces, Sprint 4 establishes strict non-negotiable migration rules:

1. **Zero Data Destruction:** No existing document bytes, vector embeddings, chunks, or database rows are deleted, dropped, or irreversibly modified.
2. **Dual-Read Compatibility:** The application code is backwards-compatible with legacy storage formats. If a document cannot be found in the configured object storage backend, the API and worker automatically fall back to local disk and database Base64 metadata.
3. **Resumable & Idempotent Backfill:** The migration script can be run repeatedly; it skips already-migrated documents and verifies SHA-256 checksums before recording updates.
4. **Independent Legacy Cleanup:** Legacy Base64 strings stored in PostgreSQL `metadata.rawContentBase64` are **not** stripped during this migration. Cleanup will occur only after an independent verification milestone.

---

## 2. Document Storage Inventory & Transition States

| Document Era | Storage Key Format | Physical Storage Location | Database Fallback |
| :--- | :--- | :--- | :--- |
| **Legacy (Pre-Sprint 4)** | `doc_{timestamp}_{hex}.ext` | Local disk (`./infrastructure/storage/documents`) | `metadata.rawContentBase64` in PostgreSQL JSONB |
| **Transitional** | Mixed flat & hierarchical | Local disk or S3/R2 bucket | `metadata.rawContentBase64` preserved |
| **Modern (Sprint 4+)** | `documents/{workspaceId}/{documentId}/doc_{timestamp}_{hex}.ext` | Cloudflare R2 / AWS S3 private bucket | None (direct streaming from object storage) |

---

## 3. Resumable Backfill Utility

MindVault provides an automated, idempotent migration tool at `scripts/migrate-documents-to-object-storage.ts`.

### Execution Modes

```bash
# 1. Preview changes without writing to storage or database
pnpm tsx scripts/migrate-documents-to-object-storage.ts --dry-run

# 2. Execute live migration
pnpm tsx scripts/migrate-documents-to-object-storage.ts
```

### Migration Algorithm & Safety Steps
For each document in PostgreSQL:
1. **Inspection:** Checks if `storageKey` already follows the hierarchical scheme (`documents/{workspaceId}/{documentId}/...`) and exists in the active storage provider. If so, skips.
2. **Source Acquisition:** Reads binary payload from active storage; if absent, reconstructs bytes from `metadata.rawContentBase64`.
3. **Checksum Verification:** Computes the SHA-256 hash of the retrieved buffer and verifies it strictly against `documents.checksum`. If a mismatch is detected, migration of that document aborts immediately to prevent data corruption.
4. **Hierarchical Storage Write:** Generates the target key `documents/{workspaceId}/{documentId}/doc_{timestamp}_{hex}.{ext}` and uploads the buffer to the configured storage provider.
5. **Read-After-Write Verification:** Calls `storage.exists(targetKey)` to confirm the file is durable in the target bucket.
6. **Database Reference Update:** Updates `documents.storageKey` in PostgreSQL. `metadata.rawContentBase64` remains intact as a safety net.

---

## 4. Rollback Procedures

If an infrastructure issue arises with Cloudflare R2, AWS S3, or Redis, the system can be rolled back immediately without database migrations or code reverts:

### 4.1 Reverting to Local Storage
To immediately revert document storage to the local filesystem:
1. In environment configuration (`.env` or platform variables):
   ```bash
   STORAGE_PROVIDER=local
   ```
2. Restart API and Worker services.
3. The application will resume reading and writing to `./infrastructure/storage/documents`. Any legacy documents that were not migrated remain fully accessible.

### 4.2 Reverting Rate Limit Fail-Closed Behavior
If Redis encounters severe latency or network partitions:
1. Set:
   ```bash
   RATE_LIMIT_FAIL_CLOSED=false
   ```
2. The distributed rate limiter immediately degrades to in-memory sliding window counters, keeping user traffic flowing while Redis recovers.

### 4.3 Database Schema Preservation
Sprint 4 required **zero schema migrations** (`prisma/schema.prisma` was preserved). The `Document` model's `storageKey` column accommodates both legacy flat strings and hierarchical path strings. Rollback requires zero database alterations.

---

## 5. Summary of Safety Verifications

- **Backward Compatibility:** Verified in `tests/local-worker-runtime.test.ts` (reconstruction from database Base64 metadata when disk file is absent passes cleanly).
- **Dual-Read Streaming:** Verified in `apps/api/src/modules/document/__tests__/upload.security.test.ts`.
- **Dry-Run Capability:** Verified via `scripts/migrate-documents-to-object-storage.ts --dry-run`.
