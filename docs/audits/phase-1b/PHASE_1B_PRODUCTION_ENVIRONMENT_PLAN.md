# MindVault — Production Environment Plan
## Environment Variables, Quota Management & Cost Analysis for Gemini Architecture

**Document Version:** 1.0.0  
**Status:** PROPOSED SPECIFICATION (Strictly Read-Only)  
**Date:** November 16, 2026  

---

## 1. Updated Environment Variable Inventories

> [!IMPORTANT]
> In accordance with strict security policies, **variable names only** are listed. No secrets, credentials, passwords, or actual URLs are printed.

### 1.1 Render Backend API (`apps/api`)

| Variable Name | Status | Classification | Purpose & Configuration |
| :--- | :---: | :---: | :--- |
| `NODE_ENV` | Retained | Standard | Set to `production`. |
| `PORT` | Retained | Dynamic | Dynamically assigned by Render (e.g. `10000`). |
| `CORS_ORIGIN` | Retained | Security | Production Vercel domain URL (`https://<app>.vercel.app`). |
| `DATABASE_URL` | Retained | Persistence | Neon PostgreSQL pooled connection (`-pooler` with `sslmode=require&pgbouncer=true`). |
| `DIRECT_URL` | Retained | Persistence | Neon PostgreSQL direct compute connection (port 5432, for migrations). |
| `REDIS_URL` | Retained | Broker | Upstash Redis connection string (`rediss://...:6379`). |
| `JWT_ACCESS_SECRET` | Retained | Security | Secret string ($\ge 32$ chars). |
| `JWT_ACCESS_EXPIRY` | Retained | Security | Default: `15m`. |
| `COOKIE_SECRET` | Retained | Security | Secret string ($\ge 32$ chars). |
| `REFRESH_TOKEN_EXPIRY_DAYS` | Retained | Security | Default: `7`. |
| `LLM_PROVIDER` | **Updated** | AI Engine | Updated default: `gemini` (previously `ollama`). |
| `GEMINI_API_KEY` | **Promoted** | AI Engine | **Mandatory** production API key for Google Gemini API. |
| `GEMINI_MODEL` | Retained | AI Engine | Generation model name (default: `gemini-2.5-flash` or `gemini-3.5-flash`). |
| `GEMINI_EMBEDDING_MODEL` | **New** | AI Engine | Embedding model name (default: `gemini-embedding-001`). |
| `GEMINI_EMBEDDING_DIMENSION`| **New** | AI Engine | Standardized dimension: `768`. |
| `LLM_REQUEST_TIMEOUT` | Retained | Reliability | Generation timeout in ms (default: `60000`). |
| `LLM_MAX_OUTPUT_TOKENS` | Retained | Reliability | Max output tokens (default: `1024`). |
| `LLM_TEMPERATURE` | Retained | AI Engine | Temperature (default: `0.2`). |
| `OLLAMA_BASE_URL` | **Obsolete** | Deprecated | **To be removed.** No longer needed on Render. |
| `OLLAMA_GENERATION_MODEL` | **Obsolete** | Deprecated | **To be removed.** |

---

### 1.2 Local Windows Background Worker (`apps/worker`)

| Variable Name | Status | Classification | Purpose & Configuration |
| :--- | :---: | :---: | :--- |
| `NODE_ENV` | Retained | Standard | Set to `production` or `development`. |
| `DATABASE_URL` | Retained | Persistence | Neon PostgreSQL connection string. |
| `REDIS_URL` | Retained | Broker | Upstash Redis connection string (`rediss://...:6379`). |
| `WORKER_CONCURRENCY` | Retained | Concurrency | Number of concurrent BullMQ jobs (default: `1`; can be raised to `2-3` on Gemini). |
| `STORAGE_DIR` | Retained | Filesystem | Local disk cache directory (`./infrastructure/storage/documents`). |
| `LLM_PROVIDER` | **Updated** | AI Engine | Updated default: `gemini`. |
| `GEMINI_API_KEY` | **Promoted** | AI Engine | **Mandatory** production API key for Google Gemini API. |
| `GEMINI_MODEL` | Retained | AI Engine | Extraction model name (`gemini-2.5-flash`). |
| `GEMINI_EMBEDDING_MODEL` | **New** | AI Engine | Embedding model name (`gemini-embedding-001`). |
| `EMBEDDING_MODEL` | Retained | AI Engine | Set to `gemini-embedding-001`. |
| `OLLAMA_BASE_URL` | **Obsolete** | Deprecated | **To be removed.** |
| `OLLAMA_GENERATION_MODEL` | **Obsolete** | Deprecated | **To be removed.** |
| `OLLAMA_EXTRACTION_MODEL` | **Obsolete** | Deprecated | **To be removed.** |
| `OLLAMA_EXTRACTION_THINK` | **Obsolete** | Deprecated | **To be removed.** |
| `OLLAMA_EXTRACTION_TEMPERATURE`| **Obsolete** | Deprecated | **To be removed.** |
| `OLLAMA_EXTRACTION_TIMEOUT_MS`| **Obsolete** | Deprecated | **To be removed.** |

---

### 1.3 Vercel Web Frontend (`apps/web`)

| Variable Name | Status | Purpose & Configuration |
| :--- | :---: | :--- |
| `VITE_API_BASE_URL` | Retained | Set to `/api` when using Vercel reverse-proxy rewrites (`vercel.json`), or explicit Render origin. |

---

## 2. API Quotas, Rate Limits & Cost Projections

### 2.1 Google Gemini Developer API Quotas

| Metric | Free Tier (Aistudio) | Pay-As-You-Go Tier (Recommended) |
| :--- | :--- | :--- |
| **`gemini-embedding-001` RPM** | 15 Requests / Min | 1,500 – 3,000 Requests / Min |
| **`gemini-embedding-001` RPD** | 1,500 Requests / Day | Unlimited (Pay-per-use) |
| **`gemini-2.5-flash` RPM** | 15 Requests / Min | 1,000 – 2,000 Requests / Min |
| **`gemini-2.5-flash` TPM** | 1 Million Tokens / Min | 4 Million Tokens / Min |
| **`gemini-2.5-flash` RPD** | 1,500 Requests / Day | Unlimited (Pay-per-use) |

### 2.2 Cost Analysis

* **`gemini-embedding-001` Pricing:**
  * Free on Google AI Studio Free Tier (subject to 15 RPM).
  * Pay-as-you-go: $\approx \$0.00002$ per 1,000 characters ($\approx \$0.08$ per 1 Million tokens).
  * *Re-embedding 10,000 chunks ($\approx 5\text{M}$ tokens) costs less than $\$0.40$ USD.*
* **`gemini-2.5-flash` Pricing:**
  * Free on Google AI Studio Free Tier (subject to 15 RPM).
  * Pay-as-you-go: $\approx \$0.075$ per 1M input tokens, $\$0.30$ per 1M output tokens.
  * *1,000 conversational RAG queries cost $\approx \$0.15$ USD.*
