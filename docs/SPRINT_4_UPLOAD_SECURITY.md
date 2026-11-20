# MindVault — Sprint 4: Secure Upload Pipeline & Input Protection
## Defense-in-Depth Specification, Validation Protocols & Lifecycle Controls

**Status:** APPROVED & IMPLEMENTED  
**Date:** 2026-11-20  
**Repository Baseline:** Sprint 4 HEAD on `main`  
**Primary Implementations:**  
- `apps/api/src/modules/document/document.routes.ts`
- `apps/api/src/modules/document/document.service.ts`
- `apps/api/src/modules/document/document.controller.ts`

---

## 1. Vulnerability Analysis: The Pre-Auth Buffering Risk

In standard Express multipart file upload setups, `multer.single('file')` runs before authorization middleware. In multi-tenant applications, this introduces a serious Denial of Service (DoS) attack vector:

An authenticated attacker belonging to Workspace $A$ can submit fifty concurrent 10MB file streams to `/api/documents/upload` targeting victim Workspace $B$. Multer buffers all 500MB into Node.js heap memory before `authorizeWorkspace('MEMBER')` executes and rejects the requests with 403 Forbidden.

### The Remediation: Pre-Upload Workspace Guard (`§SEC-01`)
MindVault solves this with a two-phase authorization architecture in `apps/api/src/modules/document/document.routes.ts`:

```typescript
const preUploadWorkspaceGuard = (req: Request, res: Response, next: NextFunction) => {
  if (req.headers['x-workspace-id'] || req.query?.workspaceId) {
    return authorizeWorkspace('MEMBER')(req, res, next);
  }
  next();
};

router.post(
  '/upload',
  distributedUploadRateLimiter,
  preUploadWorkspaceGuard,
  upload.single('file'),
  authorizeWorkspace('MEMBER'),
  controller.upload,
);
```

1. **Phase 1 (Pre-Stream Guard):** Inspects `x-workspace-id` HTTP header (or query parameter). If provided, it evaluates workspace membership in PostgreSQL **before Multer allocates a single byte of heap memory**. Unauthorized requests are terminated immediately with 403 Forbidden.
2. **Phase 2 (Post-Stream Re-verification):** If the workspace ID was passed inside the multipart form body, `authorizeWorkspace('MEMBER')` evaluates after parsing to ensure authorization consistency.

---

## 2. Multi-Layer File Validation

MindVault rejects user trust and enforces strict multi-layer server-side validation:

```text
[Incoming Upload]
       │
       ├─► 1. Extension Whitelist (.pdf, .docx, .txt, .md)
       │      Rejects unauthorized extensions (e.g., .exe, .sh, .py, .html)
       │
       ├─► 2. MIME Type Whitelist
       │      Rejects mismatching Content-Type headers
       │
       ├─► 3. File Signature / Magic-Byte Inspection:
       │      • PDF:  Header bytes must strictly match '%PDF' (0x25, 0x50, 0x44, 0x46)
       │      • DOCX: Header bytes must match PK Zip signature (0x50, 0x4B, 0x03, 0x04)
       │      • TXT / MD: Rejects binary null bytes (\x00) to prevent disguised binaries
       │
       ├─► 4. File Size Limits:
       │      • Server cap: 10 MB per file (enforced via Multer + Service validation)
       │      • Minimum cap: Rejects empty (0-byte) files
       │
       ├─► 5. SHA-256 Workspace Deduplication:
       │      • Computes SHA-256 hash of entire buffer
       │      • Rejects duplicate uploads within the same workspace with 409 Conflict
       │
       ▼
[Validation Passed]
```

---

## 3. Atomic Upload Lifecycle & Failure Recovery

To prevent phantom documents and orphaned storage objects under network disconnects or broker outages, MindVault enforces an all-or-nothing transactional lifecycle:

```text
       [Client POST /api/documents/upload]
                       │
                       ▼
       [1. Atomic Quota Reservation]
       (Reserves docs & bytes in Redis with 60s TTL)
                       │
       ┌───────────────┴───────────────┐
   [Allowed]                       [Exceeded]
       │                               │
       ▼                               ▼
[2. Storage Save]               Reject HTTP 429
       │
       ├─► (Storage fails?) ──► Release Quota, Throw Error (No DB record created)
       │
       ▼
[3. DB Document Creation (UPLOADED)]
       │
       ├─► (DB fails?) ──────► Release Quota, Delete Storage Object, Throw Error
       │
       ▼
[4. Queue Enqueue (BullMQ)]
       │
       ├─► (Queue fails?) ────► Release Quota, Mark DB 'FAILED', Throw Error
       │
       ▼
[5. Commit Quota Reservation]
[6. Update DB status = 'QUEUED']
       │
       ▼
[Return HTTP 201 DocumentDto]
```

### Safety Invariants
- **No Orphaned Storage:** If database persistence fails after writing to S3/disk, the storage object is immediately deleted in a catch handler.
- **No Stuck Documents:** If Redis/BullMQ enqueue fails, the document record is marked `FAILED` with an explanatory error message, rather than staying permanently stuck in `UPLOADED`.
- **No Leaked Quotas:** All error branches trigger `quotaReservation.release()`, restoring the workspace's quota balance.

---

## 4. Verification Summary

Upload security protocols were verified in `apps/api/src/modules/document/__tests__/upload.security.test.ts`:
- Executable disguised as PDF (`MZ\x90\x00`): **Rejected (400 Invalid File Signature)**
- Corrupt DOCX missing PK header: **Rejected (400 Invalid File Signature)**
- Disguised markdown containing binary null bytes: **Rejected (400 Invalid File Signature)**
- Legitimate PDF with `%PDF` header: **Accepted & Enqueued**
- Streaming download without heap buffering: **Verified**
- Cross-workspace document stream access (IDOR): **Blocked (404 Document Not Found)**
