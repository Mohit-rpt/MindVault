# MindVault — Phase 1 Execution Report

## Authentication & Workspace Management

**Project Name:** MindVault  
**Phase:** Phase 1 — Authentication & Workspace Management  
**Status:** Completed & Verified  
**Date:** November 5, 2026  
**Architect:** Senior Full-Stack Software Engineer

---

## 1. Executive Summary

Phase 1 establishes the production-grade authentication and multi-tenant workspace management layer for **MindVault**, an AI-powered personal knowledge operating system. Building atop the verified Phase 0 monorepo foundation, Phase 1 delivers:

1. **Relational Data Foundation:** Complete PostgreSQL schema with Prisma ORM (`User`, `Workspace`, `WorkspaceMember`, `Session`), foreign key constraints, cascade rules, compound uniqueness, and an initial migration.
2. **Cryptographic Security:** Argon2id password hashing (64MB memory cost, 3 iterations, 4 parallelism lanes), cryptographically secure pseudorandom token generation, SHA-256 database hashing for refresh tokens, and signed HttpOnly/SameSite cookies.
3. **Session Lifecycle & Family Token Rotation:** Dual-token mechanism (short-lived JWT access tokens + rotating refresh tokens) with immediate revocation of the previous session upon rotation and automatic session family revocation upon reuse detection (replay attack prevention).
4. **Hierarchical RBAC & Tenant Isolation:** Role-based access control (`OWNER` > `ADMIN` > `MEMBER`) enforced via route middleware (`authorizeWorkspace`), strictly eliminating cross-workspace Insecure Direct Object References (IDOR).
5. **Modern Frontend Experience:** Reactive application shell in `apps/web` featuring login/register flows, an in-memory access token management context (`AuthContext`), automatic HttpOnly cookie refresh bootstrap, a workspace switcher, role-guarded controls, and an active session revocation dashboard.
6. **Automated Quality & Verification:** 25 passing automated tests across 4 test suites, strict TypeScript typechecking (0 errors), clean ESLint audit (0 warnings), and full Prettier format compliance across all workspaces.

---

## 2. Monorepo Directory Tree

```
MindVault/
├── apps/
│   ├── api/
│   │   ├── src/
│   │   │   ├── config/
│   │   │   │   └── env.ts                      # Zod-validated environment schema (JWT, cookies)
│   │   │   ├── lib/
│   │   │   │   ├── db.ts                       # IDatabaseService abstraction (Prisma & InMemory)
│   │   │   │   └── prisma.ts                   # Singleton PrismaClient instance
│   │   │   ├── middleware/
│   │   │   │   ├── authenticate.ts             # JWT Bearer token claim verification (req.user)
│   │   │   │   ├── authorizeWorkspace.ts       # Tenant membership & RBAC validator (req.workspaceMember)
│   │   │   │   ├── csrfProtection.ts           # Origin/Referer header validator
│   │   │   │   ├── errorHandler.ts             # Centralized RFC 7807 problem handler
│   │   │   │   ├── rateLimiter.ts              # IP-based endpoint brute-force protection
│   │   │   │   └── requestLogger.ts            # Structured request logger
│   │   │   ├── modules/
│   │   │   │   ├── auth/
│   │   │   │   │   ├── auth.controller.ts      # HTTP request handlers for /api/auth
│   │   │   │   │   ├── auth.routes.ts          # Express router with rate limiting & CSRF guards
│   │   │   │   │   ├── auth.security.ts        # Argon2id, JWT, SHA-256, and cookie utilities
│   │   │   │   │   ├── auth.service.ts         # User registration, login, rotation, revocation
│   │   │   │   │   └── auth.test.ts            # 14 integration tests for auth lifecycle & reuse
│   │   │   │   └── workspace/
│   │   │   │       ├── workspace.controller.ts # Handlers for workspace CRUD & membership
│   │   │   │       ├── workspace.routes.ts     # Routes protected by authenticate & authorizeWorkspace
│   │   │   │       ├── workspace.service.ts    # Workspace creation, RBAC checks, deletion
│   │   │   │       └── workspace.test.ts       # 8 integration tests for RBAC & cross-tenant IDOR
│   │   │   ├── routes/
│   │   │   │   ├── health.ts                   # Health probe with resilient DB timeout race
│   │   │   │   └── health.test.ts              # Health endpoint tests
│   │   │   ├── types/
│   │   │   │   └── express.d.ts                # Express Request extensions (user, workspaceMember)
│   │   │   ├── app.ts                          # Express application assembly
│   │   │   └── index.ts                        # Server entry point & graceful shutdown
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── web/
│   │   ├── src/
│   │   │   ├── components/
│   │   │   │   ├── auth/
│   │   │   │   │   ├── LoginForm.tsx           # Email/password login with error alerts
│   │   │   │   │   └── RegisterForm.tsx        # Registration with workspace naming
│   │   │   │   ├── dashboard/
│   │   │   │   │   └── WorkspaceDashboard.tsx  # Tabs: Overview, Members, Sessions, Settings
│   │   │   │   ├── workspace/
│   │   │   │   │   ├── CreateWorkspaceModal.tsx# Modal for spinning up new isolated workspaces
│   │   │   │   │   └── WorkspaceSelector.tsx   # Workspace switcher dropdown with role tags
│   │   │   │   ├── Layout.tsx                  # Base page layout
│   │   │   │   └── Navbar.tsx                  # Top-level navigation with user & workspace pill
│   │   │   ├── context/
│   │   │   │   └── AuthContext.tsx             # Auth state provider, cookie refresh, in-memory token
│   │   │   ├── App.tsx                         # Root app router (Portal vs Authenticated Shell)
│   │   │   └── main.tsx                        # React DOM mounting
│   │   ├── package.json
│   │   └── vite.config.ts
│   └── worker/
│       ├── src/
│       │   ├── worker.ts                       # Worker service lifecycle
│       │   └── worker.test.ts                  # Worker lifecycle tests
│       ├── package.json
│       └── tsconfig.json
├── packages/
│   ├── shared/
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   └── types.ts                        # Zod schemas, DTOs, Enums, ApiResponse contracts
│   │   └── package.json
│   └── config/
├── prisma/
│   ├── schema.prisma                           # Canonical PostgreSQL relational schema
│   └── migrations/
│       └── 20261105000000_init_auth_workspaces/
│           └── migration.sql                   # Committed initial migration
├── docs/
│   ├── ARCHITECTURE_DECISIONS.md               # ADR-007 (Argon2id/Tokens), ADR-008 (RBAC/IDOR)
│   ├── DEVELOPMENT.md                          # Development & migration workflow guide
│   └── PHASE_1_EXECUTION_REPORT.md             # This document
├── ARCHITECTURE_PLANNER.md
├── IMPLEMENTATION_ROADMAP.md
├── docker-compose.yml
├── package.json
├── pnpm-workspace.yaml
└── README.md
```

---

## 3. Database Architecture (Prisma & PostgreSQL)

The relational schema implements clean normalization, cascade deletion behaviors, and compound indexes:

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

enum WorkspaceRole {
  OWNER
  ADMIN
  MEMBER
}

model User {
  id               String            @id @default(uuid())
  name             String
  email            String            @unique
  passwordHash     String
  createdAt        DateTime          @default(now())
  updatedAt        DateTime          @updatedAt
  memberships      WorkspaceMember[]
  sessions         Session[]

  @@map("users")
}

model Workspace {
  id          String            @id @default(uuid())
  name        String
  slug        String            @unique
  createdAt   DateTime          @default(now())
  updatedAt   DateTime          @updatedAt
  members     WorkspaceMember[]

  @@map("workspaces")
}

model WorkspaceMember {
  id          String        @id @default(uuid())
  userId      String
  workspaceId String
  role        WorkspaceRole @default(MEMBER)
  joinedAt    DateTime      @default(now())
  user        User          @relation(fields: [userId], references: [id], onDelete: Cascade)
  workspace   Workspace     @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  @@unique([userId, workspaceId])
  @@index([userId])
  @@index([workspaceId])
  @@map("workspace_members")
}

model Session {
  id               String    @id @default(uuid())
  userId           String
  refreshTokenHash String    @unique
  expiresAt        DateTime
  revokedAt        DateTime?
  createdAt        DateTime  @default(now())
  user             User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@index([refreshTokenHash])
  @@map("sessions")
}
```

### Relational Properties:

- **`User.email`**: Indexed with unique constraint; normalized to lowercase before lookup or insert.
- **`WorkspaceMember`**: Compound unique constraint on `(userId, workspaceId)` preventing duplicate membership rows.
- **`Session.refreshTokenHash`**: Unique indexed column storing the SHA-256 digest of the issued refresh token.
- **Cascade Deletion**: Deleting a User or Workspace automatically cascades to all associated memberships and sessions without orphaned rows.

---

## 4. Security Architecture

### 4.1 Argon2id Password Hashing

Password management strictly employs the state-of-the-art **Argon2id** algorithm, offering optimal resistance against side-channel and GPU-based dictionary attacks:

- **Algorithm:** `argon2id` (v19)
- **Memory Cost:** 64 MB (`memoryCost: 65536`)
- **Time Cost:** 3 iterations (`timeCost: 3`)
- **Parallelism:** 4 threads (`parallelism: 4`)

### 4.2 Dual-Token Architecture & Rotation Algorithm

Authentication uses a dual-token paradigm:

1. **Access Token (JWT):**
   - Lifespan: 15 minutes (`JWT_ACCESS_EXPIRY="15m"`).
   - Claims: `{ sub: userId, email: user.email }`.
   - Storage: Kept exclusively in memory in the client browser (`AuthContext`). Never written to `localStorage` or `sessionStorage` (preventing XSS theft).
2. **Refresh Token:**
   - Lifespan: 7 days (`REFRESH_TOKEN_EXPIRY_DAYS="7"`).
   - Generation: Cryptographically secure 40-byte hex string via `crypto.randomBytes(40)`.
   - Storage in DB: Never stored in plaintext. Transformed via `crypto.createHash('sha256').update(token).digest('hex')`.
   - Storage in Browser: Sent via an `HttpOnly`, `SameSite=Strict`, `Secure` (in production) cookie (`refreshToken`).

### 4.3 Refresh Token Reuse Detection & Family Revocation

To eliminate replay attacks from leaked refresh tokens:

1. When a client calls `POST /api/auth/refresh`, the server hashes the provided token and looks up the session.
2. If the session is found and is **already marked revoked** (`revokedAt !== null`), this indicates that a previously rotated token was presented again (token reuse).
3. The server immediately revokes **all active sessions** belonging to that user family (`revokeAllUserSessions`), terminating the attacker's and victim's active sessions, and responds with `401 Unauthorized (TOKEN_REUSE_DETECTED)`.
4. If valid and unrevoked, the server atomically revokes the current session record, issues a brand-new session record with a new refresh token, and returns a fresh JWT access token.

```mermaid
sequenceDiagram
    autonumber
    actor Client
    participant API as Auth API Gateway
    participant DB as PostgreSQL / DB Layer

    Client->>API: POST /api/auth/refresh (Cookie: refreshToken)
    API->>API: Hash token (SHA-256)
    API->>DB: Find session by refreshTokenHash
    alt Token not found
        API-->>Client: 401 Unauthorized (INVALID_REFRESH_TOKEN)
    else Session already revoked (revokedAt != null)
        Note over API,DB: Token reuse detected! Potential breach!
        API->>DB: Revoke ALL active sessions for this user
        API-->>Client: 401 Unauthorized (TOKEN_REUSE_DETECTED)
    else Session valid (active & unrevoked)
        API->>DB: Mark current session revoked (revokedAt = now)
        API->>API: Generate new refreshToken & access JWT
        API->>DB: Insert new Session record
        API-->>Client: Set-Cookie: new refreshToken; Body: { accessToken }
    end
```

---

## 5. Authorization & Multi-Tenancy (RBAC & IDOR Defenses)

### 5.1 Role Hierarchy

Workspace permissions are governed by a 3-tier hierarchy:
$$\text{OWNER (Rank 3)} > \text{ADMIN (Rank 2)} > \text{MEMBER (Rank 1)}$$

```typescript
const ROLE_HIERARCHY: Record<WorkspaceRole, number> = {
  OWNER: 3,
  ADMIN: 2,
  MEMBER: 1,
};
```

### 5.2 Middleware Enforcement

Any route accessing tenant-scoped data is guarded by `authorizeWorkspace(minRole)`:

1. Extracts `workspaceId` from route parameters (`:id` or `:workspaceId`) or header (`x-workspace-id`).
2. Queries the membership table for `(userId, workspaceId)`.
3. If no membership exists, returns `403 Forbidden` (`FORBIDDEN_WORKSPACE_ACCESS`), concealing whether the workspace ID exists to unauthorized callers.
4. Checks `ROLE_HIERARCHY[member.role] >= ROLE_HIERARCHY[requiredRole]`. If insufficient, returns `403 Forbidden` (`INSUFFICIENT_PERMISSIONS`).
5. Attaches `req.workspaceMember` to the Express Request for downstream controller use.

### 5.3 Insecure Direct Object Reference (IDOR) Defenses

- Accessing `/api/workspaces/:id` as User B when the workspace belongs to User A immediately yields `403 Forbidden`.
- Modifications (`PATCH /api/workspaces/:id`) require minimum role `ADMIN`.
- Deletions (`DELETE /api/workspaces/:id`) strictly require role `OWNER`.

---

## 6. API Route Contracts

### 6.1 Authentication Endpoints (`/api/auth`)

| Method   | Path            | Auth Required | Input Payload                               | Success Response                   | Status |
| -------- | --------------- | ------------- | ------------------------------------------- | ---------------------------------- | ------ |
| `POST`   | `/register`     | None          | `{ name, email, password, workspaceName? }` | `{ user, workspace, accessToken }` | `201`  |
| `POST`   | `/login`        | None          | `{ email, password }`                       | `{ user, accessToken }`            | `200`  |
| `POST`   | `/refresh`      | Cookie        | `refreshToken` cookie                       | `{ accessToken }`                  | `200`  |
| `POST`   | `/logout`       | Cookie        | `refreshToken` cookie                       | `{ message }`                      | `200`  |
| `GET`    | `/me`           | Bearer JWT    | None                                        | `{ user, memberships }`            | `200`  |
| `GET`    | `/sessions`     | Bearer JWT    | None                                        | `SessionDto[]`                     | `200`  |
| `DELETE` | `/sessions/:id` | Bearer JWT    | Route param `:id`                           | `{ message }`                      | `200`  |

### 6.2 Workspace Endpoints (`/api/workspaces`)

| Method   | Path   | Auth Required | Min Role    | Input Payload | Success Response | Status |
| -------- | ------ | ------------- | ----------- | ------------- | ---------------- | ------ |
| `POST`   | `/`    | Bearer JWT    | None (Auth) | `{ name }`    | `WorkspaceDto`   | `201`  |
| `GET`    | `/`    | Bearer JWT    | None (Auth) | None          | `WorkspaceDto[]` | `200`  |
| `GET`    | `/:id` | Bearer JWT    | `MEMBER`    | Route param   | `WorkspaceDto`   | `200`  |
| `PATCH`  | `/:id` | Bearer JWT    | `ADMIN`     | `{ name }`    | `WorkspaceDto`   | `200`  |
| `DELETE` | `/:id` | Bearer JWT    | `OWNER`     | Route param   | `{ message }`    | `200`  |

---

## 7. Frontend Architecture (`apps/web`)

### 7.1 State Management & In-Memory Tokens (`AuthContext.tsx`)

- On application mount, `AuthContext` makes a silent `POST /api/auth/refresh` request. If a valid HttpOnly cookie exists, the session is seamlessly restored without saving sensitive credentials to `localStorage`.
- The access token is maintained strictly in React component state. An interceptor attaches `Authorization: Bearer <accessToken>` to authenticated API requests.

### 7.2 Component Architecture

- **`App.tsx`**: Conditional router displaying the Authentication Portal when unauthenticated, and transitioning to the Workspace Shell when logged in.
- **`Navbar.tsx`**: Displays the active user name, an interactive `WorkspaceSelector` dropdown, a "Create Workspace" trigger, and the logout action.
- **`WorkspaceSelector.tsx`**: Renders all workspaces the user belongs to, tagging each with their explicit role (`OWNER`, `ADMIN`, `MEMBER`).
- **`WorkspaceDashboard.tsx`**: Comprehensive tenant dashboard organized into 4 functional tabs:
  1. _Overview_: Workspace ID, tenant isolation guarantees, and Phase 2 document pipeline preview.
  2. _Members_: Tabular list of workspace members, email addresses, roles, and join dates.
  3. _Security & Sessions_: Live inventory of user sessions with indicators for the current device and real-time revocation triggers.
  4. _Settings_: Workspace configuration form (guarded to `ADMIN` and `OWNER` roles).

---

## 8. Test Suite Results & Coverage

All 25 automated tests pass deterministically:

```
Test Files  4 passed (4)
     Tests  25 passed (25)
  Duration  5.57s
```

### Breakdown of Test Cases:

1. **Authentication Module (`auth.test.ts` — 14 tests):**
   - Registration validation (name, email normalization, password constraints).
   - Automatic workspace creation with `OWNER` role on registration.
   - Prevention of duplicate account registration.
   - Login credential verification via Argon2id.
   - Non-revealing error responses for non-existent users or incorrect passwords.
   - Refresh token rotation issuing a new token and revoking the old session.
   - Token reuse detection revoking the entire user session family.
   - Token revocation on logout and cookie clearing.
   - Profile retrieval via `/api/auth/me`.
   - Session listing with current-session detection.
   - Individual session revocation via `/api/auth/sessions/:id`.
   - Access token rejection on malformed or expired JWTs.

2. **Workspace & Isolation Module (`workspace.test.ts` — 8 tests):**
   - Workspace creation with auto-assigned `OWNER` status.
   - Workspace listing scoped to the authenticated caller.
   - Role-Based Access Control: `MEMBER` read allowed, update/delete denied (`403`).
   - Role-Based Access Control: `ADMIN` update allowed, delete denied (`403`).
   - Role-Based Access Control: `OWNER` read, update, and delete permitted.
   - **Cross-Workspace IDOR Defense**: User B cannot read User A's workspace (`403`).
   - **Cross-Workspace IDOR Defense**: User B cannot update User A's workspace (`403`).
   - **Cross-Workspace IDOR Defense**: User B cannot delete User A's workspace (`403`).

3. **Infrastructure & Health (`health.test.ts` — 2 tests):**
   - Operational health probe reporting process metrics, uptime, and memory usage.
   - Graceful resilience during database probe timeouts.

4. **Background Worker (`worker.test.ts` — 1 test):**
   - Clean startup, queue initialization logging, and graceful shutdown signal handling.

---

## 9. Verification Scorecard

| Check Script        | Target              | Result                           | Status   |
| :------------------ | :------------------ | :------------------------------- | :------- |
| `pnpm lint`         | All packages        | 0 errors, 0 warnings             | **PASS** |
| `pnpm format:check` | All packages & docs | All files match Prettier format  | **PASS** |
| `pnpm typecheck`    | Strict TypeScript   | 0 errors across 4 projects       | **PASS** |
| `pnpm test`         | Vitest Test Suite   | 25 / 25 passing (100%)           | **PASS** |
| `pnpm build`        | Production Bundle   | Built in 16.46s with zero errors | **PASS** |

---

## 10. Architectural Trade-offs & Decisions

1. **Dual-Backend Repository Abstraction (`IDatabaseService`):**
   - _Trade-off:_ Introducing an abstraction layer slightly increases initial code volume.
   - _Rationale:_ Decoupling database queries into `PrismaDatabaseService` (for production/Docker) and `InMemoryDatabaseService` (for tests) enables instant, zero-flake CI test runs without requiring a continuous Docker daemon on resource-constrained host machines.
2. **Family Revocation vs In-Place Token Updates:**
   - _Trade-off:_ In-place updates conserve session table rows.
   - _Rationale:_ In-place updates cannot detect when an attacker presents a stolen, expired token. Maintaining revoked records (`revokedAt !== null`) allows unambiguous detection of token replay attacks, triggering immediate family revocation to protect the user.
3. **In-Memory Access Tokens vs LocalStorage:**
   - _Trade-off:_ Page reloads require a brief async handshake to `/api/auth/refresh`.
   - _Rationale:_ Storing JWTs in `localStorage` exposes them to XSS vulnerabilities. Holding access tokens in memory and using HttpOnly cookies for refresh tokens represents modern web security best practice.

---

## 11. Environmental & Resource Optimization (8 GB RAM Host)

- **Memory Optimization:** By testing against the in-memory repository layer, developer feedback loops run in under 6 seconds without Docker memory spikes.
- **Native Dependency Build Flags:** Configured `allowBuilds` in `pnpm-workspace.yaml` for `argon2`, `prisma`, and `esbuild` to eliminate pnpm build restrictions cleanly.
- **Process Isolation:** The frontend, API, and worker processes can execute independently or simultaneously without resource exhaustion.

---

## 12. Technical Debt & Scope Adherence

- **Strict Phase Boundary Respected:** No Phase 2+ features were introduced (no file upload handlers, no chunking logic, no vector embeddings, no Ollama/OpenAI integrations, no chat interfaces).
- **Future Enhancements for Phase 2:**
  - Hooking workspace membership checks into multipart file ingestion streams.
  - Adding invitation links/tokens for workspace member onboarding.

---

## 13. Preparation for Phase 2: Document Ingestion Pipeline

With Phase 1 complete, the platform is prepared for Phase 2:

- Workspace models and isolation middleware are ready to accept document ownership foreign keys (`workspaceId`).
- The frontend dashboard includes placeholder views for document uploads and status tracking.
- BullMQ worker skeletons are initialized to receive ingestion jobs.

---

## 14. Phase 1 Verification Checklist

- [x] Complete database schema with `User`, `Workspace`, `WorkspaceMember`, and `Session`.
- [x] Prisma migration generated and committed (`20261105000000_init_auth_workspaces`).
- [x] Argon2id password hashing implemented and verified.
- [x] Short-lived JWT access tokens + rotating refresh tokens.
- [x] SHA-256 hashed refresh tokens in database.
- [x] HttpOnly, SameSite cookies for refresh tokens.
- [x] Refresh token reuse detection with full session family revocation.
- [x] Session revocation endpoints (`DELETE /api/auth/sessions/:id`).
- [x] Role-Based Access Control (`OWNER`, `ADMIN`, `MEMBER`) enforced via middleware.
- [x] Complete cross-workspace IDOR protection verified via integration tests.
- [x] Frontend authentication shell with Login, Register, Workspace switcher, and Session manager.
- [x] Zero tokens stored in `localStorage`.
- [x] Full test suite (25/25 passing).
- [x] Full linting (0 warnings), Prettier formatting (100%), and strict typechecking (0 errors).
- [x] Documentation updated (`README.md`, `DEVELOPMENT.md`, `ARCHITECTURE_DECISIONS.md`, `IMPLEMENTATION_ROADMAP.md`).
