# MindVault — Sprint 5 Staging Architecture Specification

**Document Version:** 1.0.0  
**Status:** Approved Architectural Design  
**Target Environment:** Private Staging & Reproducible Local Staging Topology  
**Repository:** `c:/Users/mohit/OneDrive/Desktop/MindVault`

---

## 1. Architectural Philosophy & Isolation Principles

MindVault's staging architecture is designed under three foundational principles:
1. **Total Data & State Isolation:** Staging runs against completely dedicated data stores (PostgreSQL database, Redis instance, and Object Storage bucket). Under no circumstances does staging share databases or credentials with production.
2. **Deterministic Parity:** Staging mirrors the exact production container topology, networking contracts, security policies, and unprivileged execution models.
3. **Fail-Safe Worker Decoupling:** Background document ingestion workers running in staging operate strictly as `WORKER_TYPE=cloud`, binding only to staging queue namespaces (`doc-queue-{wsId}-cloud`).

---

## 2. Component Topology

```text
                           [ External Ingress (HTTPS) ]
                                        │
                    ┌───────────────────┴───────────────────┐
                    │                                       │
                    ▼                                       ▼
         [ Frontend SPA (Static) ]              [ API Gateway / Nginx Proxy ]
          - Cloudflare Pages / S3                - Single Origin Proxy (/api/*)
          - HTML5 History fallback               - SSE proxy_buffering off
          - 612 KB bundle gzip/brotli            - Security Headers forwarded
                    │                                       │
                    └───────────────────┬───────────────────┘
                                        │ HTTP /api
                                        ▼
                               [ MindVault API ]
                           - Node.js 22 LTS (Alpine)
                           - Non-root user (node:node)
                           - Express 4 + Helmet + CORS
                           - Streaming SSE Generation
                           - Sliding-window Rate Limiters
                                        │
                     ┌──────────────────┴──────────────────┐
                     │                                     │
                     ▼                                     ▼
          [ PostgreSQL 16 + pgvector ]              [ Redis 7 + TLS ]
          - Isolated `mindvault_staging` DB        - Isolated Staging Redis
          - Row-level lock lease fencing           - BullMQ Queues (cloud)
          - 768-dim vector cosine index            - Sliding-window Tokens
          - SSL enforced (`sslmode=require`)       - Quota Reservations (60s)
                     │                                     │
                     └──────────────────┬──────────────────┘
                                        │
                                        ▼
                             [ MindVault Cloud Worker ]
                           - Dedicated container process
                           - Non-root user (dumb-init PID 1)
                           - WORKER_TYPE=cloud
                           - Dual-write safety claim protocol
                           - Graceful queue drain on SIGTERM
                                        │
                     ┌──────────────────┴──────────────────┐
                     │                                     │
                     ▼                                     ▼
        [ Private Object Storage ]                 [ Google Gemini ]
        - Cloudflare R2 / S3 Bucket               - gemini-3.5-flash (Chat)
        - Private, no public access               - gemini-embedding-2 (768d)
        - Streaming upload/download               - Staging quota throttling
        - Keys: `documents/{ws}/{id}/...`
```

---

## 3. Storage Hierarchy & Network Ingress

### 3.1 Object Storage (Cloudflare R2)
- **Bucket Identification:** `mindvault-staging-documents`
- **Access Pattern:** Zero public access. All document access flows through the API using presigned operations or streaming pass-through via `res.pipe()`.
- **Key Schema:**
  ```text
  documents/
    └── {workspaceId}/
          └── {documentId}/
                └── {sanitizedOriginalFilename}
  ```
- **Lifecycle Policies:** In staging, a 30-day expiration lifecycle rule can be applied to test objects to prevent accumulating testing artifacts.

### 3.2 Network Routing & Single-Origin Strategy
To eliminate browser third-party cookie restrictions and complex CORS preflight latencies:
- **Production/Staging Domain Strategy:**
  - `https://staging.mindvault.com` routes to Frontend static assets.
  - `https://staging.mindvault.com/api/*` routes to the API container.
- **SSE Streaming Route Requirements:**
  - Route `/api/conversations/*/messages/stream` requires:
    ```nginx
    proxy_buffering off;
    proxy_cache off;
    proxy_set_header Connection '';
    proxy_http_version 1.1;
    chunked_transfer_encoding on;
    ```

---

## 4. Environment Configuration Matrix

| Variable | Development | Staging | Production | Description |
|---|---|---|---|---|
| `NODE_ENV` | `development` | `production` | `production` | Execution environment mode |
| `PORT` | `4000` | `4000` | `4000` | API listener port |
| `CORS_ORIGIN` | `http://localhost:5173` | `https://staging.mindvault.com` | `https://mindvault.com` | Allowed browser origin |
| `DATABASE_URL` | Local Postgres | Staging Neon / Cloud DB | Prod Neon / Cloud DB | DB connection string (SSL required in staging/prod) |
| `REDIS_URL` | `redis://localhost:6379` | `rediss://staging-redis...` | `rediss://prod-redis...` | TLS-secured Redis endpoint |
| `STORAGE_PROVIDER` | `local` | `r2` or `s3` | `r2` or `s3` | Storage backend driver |
| `STORAGE_BUCKET` | N/A | `mindvault-staging-documents` | `mindvault-prod-documents` | Private object bucket |
| `WORKER_TYPE` | `all` or `local` | `cloud` | `cloud` | Worker execution role |
| `JWT_ACCESS_SECRET` | Dev secret allowed | ≥32 char random | ≥32 char random | HMAC secret for JWTs |
| `COOKIE_SECRET` | Dev secret allowed | ≥32 char random | ≥32 char random | Signed cookie secret |
| `GEMINI_API_KEY` | Dev key | Staging key | Production key | Google AI Studio / Vertex key |

---

## 5. Security & Isolation Controls

1. **Unprivileged Container Execution:** Both API and Worker run as `USER node` (UID/GID 1000). Neither container has root capabilities, preventing container breakout risks.
2. **Zero Insecure Secrets:** Both services fail to boot if any secret matches development defaults.
3. **Rate Limiting & Anti-Abuse:**
   - Auth endpoints: 10 requests / 15 minutes.
   - Upload endpoints: 20 uploads / hour.
   - Chat generation: 60 requests / minute.
4. **Worker Isolation Fencing:**
   - Staging workers only consume `cloud` queue keys.
   - Local developer machines cannot connect to staging Redis unless explicitly authorized via `DEV_ALLOW_REMOTE_REDIS=true`.
