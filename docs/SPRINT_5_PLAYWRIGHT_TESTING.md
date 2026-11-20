# MindVault — Sprint 5: Playwright End-to-End Testing Specification & Results

## 1. Executive Summary

As part of Sprint 5, MindVault has established an automated, deterministic browser-level test suite using Playwright. This suite validates end-to-end user workflows, client-side routing, responsive UI components, Server-Sent Events (SSE) streaming, file ingress validation, and workspace security boundaries in real Chromium browser sessions.

To ensure rapid, reliable, and cost-free CI/CD execution without consuming production or paid Gemini API quotas, all backend API and SSE interactions are intercepted and fulfilled with deterministic fixtures.

---

## 2. Test Architecture & Configuration

- **Framework**: `@playwright/test` (v1.50+)
- **Target Engine**: Chromium (Desktop Chrome viewport: 1280x720)
- **Local Dev Server Integration**: Automatically launches `@mindvault/web` on port 5173 (`reuseExistingServer: !process.env.CI`)
- **Worker Configuration**: Local runs configured with 2 workers for stability; CI configured with 1 worker
- **Action Timeout**: 10,000ms
- **Expect Timeout**: 5,000ms
- **Failure Artifacts**: Retains traces (`trace.zip`), screenshots, and video recordings on test failures

---

## 3. Test Fixture Strategy (`tests/e2e/fixtures/mock-api.ts`)

The fixture layer intercepts all network traffic matching `/api/**` at the browser level:

1. **Authentication State**:
   - Mocks `/api/auth/sessions` with `SESSION_ID_MOCK`, user identity (`admin@mindvault.local`), and active workspace association.
   - Provides clean unauthenticated state or pre-authenticated state based on test setup options.
2. **Deterministic Workspace Boundary**:
   - Delivers workspace context (`Engineering Knowledge Base`, ID `ws-e2e-test-1`, role `ADMIN`).
   - Supports workspace switching and mock creation.
3. **SSE Streaming Emulation**:
   - Intercepts `/api/conversations/*/messages/stream` and emulates the exact event sequence delivered by the NestJS backend:
     - `event: connected` (handshake)
     - `event: thinking` (internal chain of thought)
     - `event: token` (content token chunking)
     - `event: citation` (citations metadata array)
     - `event: done` (stream completion with total tokens and latency)
4. **Ingestion & Status Progression**:
   - Delivers documents across all 4 lifecycle states: `READY`, `PROCESSING`, `QUEUED`, `FAILED`.
   - Supports upload progress simulation and document deletion.
5. **Rate Limiting & Quotas**:
   - Configurable mock options `rateLimitUpload: true` (simulates HTTP 429) and `quotaExceeded: true` (simulates HTTP 403 quota error) to verify UI governance feedback.
6. **Network Resiliency Catch-All**:
   - All unmatched `/api/**` calls return HTTP 200 `{ success: true, data: [] }` preventing client hangs or network timeouts.

---

## 4. Critical Browser Flow Coverage (8 Flows, 25 Tests)

| Flow # | Test Suite | Description | Tests | Status |
| :--- | :--- | :--- | :--- | :--- |
| **Flow 1** | `tests/e2e/auth.spec.ts` | **Authentication & Session Lifecycle**<br>Login screen rendering, invalid credential error banners, successful credential login, session reload persistence, and clean sign-out. | 5 | **PASS** |
| **Flow 2** | `tests/e2e/workspace.spec.ts` | **Workspace Management & Boundary Isolation**<br>Active workspace rendering with role badges, workspace selector dropdown, workspace switching, and workspace creation modal validation. | 3 | **PASS** |
| **Flow 3** | `tests/e2e/upload.spec.ts` | **Document Upload Ingress & Signature Protection**<br>Navigation to document view, upload dropzone revelation, valid PDF attachment and success toast, unsupported file type (`.exe`) rejection, and oversized payload rejection. | 4 | **PASS** |
| **Flow 4** | `tests/e2e/ingestion.spec.ts` | **Document Ingestion & Status Progression**<br>Rendering of all 4 status badges (Ready, Processing, Queued, Failed), and status tab filtering (All, Ready, In Progress, Failed). | 2 | **PASS** |
| **Flow 5** | `tests/e2e/chat.spec.ts` | **RAG Chat & Server-Sent Events (SSE) Streaming**<br>Composer rendering and prompt submission, token-by-token stream assembly, citation pill rendering with source drawer opening, and empty state suggestion prompt cards. | 3 | **PASS** |
| **Flow 6** | `tests/e2e/documents.spec.ts` | **Document Management & Search**<br>Document table with filenames and formatted byte sizes, instant search input filtering, file download trigger, and confirmation-gated document deletion. | 4 | **PASS** |
| **Flow 7** | `tests/e2e/graph.spec.ts` | **Knowledge Graph Navigation & Exploration**<br>Graph view navigation, entity and relationship summary cards, interactive graph canvas rendering, and loading error handling with retry trigger. | 2 | **PASS** |
| **Flow 8** | `tests/e2e/governance.spec.ts` | **Resource Governance, Rate Limiting & Quotas**<br>Document upload rate limit rejection (HTTP 429) with UI error feedback, and workspace document quota exhaustion (HTTP 403) with upgrade/quota banner. | 2 | **PASS** |

**Total E2E Test Count**: 25 tests  
**Pass Rate**: 100% (25/25)  
**Execution Time**: ~22-45 seconds (depending on worker concurrency)

---

## 5. Security & Isolation Guarantees

1. **Zero Gemini Quota Usage**: Automated browser tests execute without consuming live Gemini tokens or hitting Google GenAI API rate limits.
2. **Zero Production Mutation**: Automated tests operate strictly on ephemeral mock data in the browser memory; no data is written to Neon PostgreSQL or Upstash Redis.
3. **Zero Secrets in Test Code**: Tests contain only dummy test credentials (`admin@mindvault.local` / `Password123!`), with zero production or staging secrets.
