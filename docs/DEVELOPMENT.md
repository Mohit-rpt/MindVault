# MindVault — Development Guide

This guide covers local environment setup, architecture workflows, and service execution for MindVault.

---

## 1. Prerequisites

Before developing on MindVault, ensure you have installed:

- **Node.js**: v20+ or v22+ (LTS recommended, checked with `node -v`)
- **pnpm**: v9+ or v10+ (checked with `pnpm -v`, install via `npm install -g pnpm`)
- **Git**: v2.40+ (checked with `git --version`)
- **Docker & Docker Compose** (Optional for local Node services, required for containerized PostgreSQL & Redis):
  - Docker Desktop on Windows 11 with WSL2 backend.

---

## 2. Initial Setup

1. **Clone and enter the repository:**

   ```bash
   cd MindVault
   ```

2. **Configure Environment Variables:**
   Copy `.env.example` to `.env`:

   ```bash
   cp .env.example .env
   # Or in PowerShell:
   Copy-Item .env.example .env
   ```

3. **Install Dependencies:**

   ```bash
   pnpm install
   ```

4. **Build Shared Packages:**
   ```bash
   pnpm --filter @mindvault/shared build
   ```

---

## 3. Infrastructure Management (Docker)

MindVault includes a lightweight `docker-compose.yml` for PostgreSQL (with `pgvector` pre-installed) and Redis.

### Start Containers:

```bash
docker compose up -d
# Or using the pnpm shorthand:
pnpm docker:up
```

### Check Container Health:

```bash
docker compose ps
```

### PostgreSQL Vector Check:

```bash
docker compose exec postgres psql -U mindvault -d mindvault -c "\dx"
```

You should see `vector` listed among the installed extensions.

### Stop Containers:

```bash
docker compose down
# Or:
pnpm docker:down
```

> **Note on 8 GB RAM Machine:**  
> The Docker services are configured with memory limits (`512MB` for PostgreSQL, `256MB` for Redis) to keep system consumption low. If Docker Desktop is not running, all API and web build checks remain completely functional.

---

---

## 4. Database Migrations & Prisma

MindVault uses Prisma ORM with PostgreSQL.

### Generate Prisma Client:

```bash
pnpm db:generate
```

This generates `@prisma/client` typed models and enums based on `prisma/schema.prisma`.

### Apply Migrations to PostgreSQL:

When the PostgreSQL container is active (`pnpm docker:up`):

```bash
pnpm db:migrate
```

To create a new migration after editing `prisma/schema.prisma`:

```bash
pnpm db:migrate:dev --name your_migration_name
```

---

## 5. Running the Development Services

Run services in separate terminal windows or concurrently:

### API Server (`apps/api`)

```bash
pnpm dev:api
```

- Listens on `http://localhost:4000`
- Health check available at `http://localhost:4000/api/health`
- Auth routes mounted at `/api/auth`
- Workspace routes mounted at `/api/workspaces`

### Background Worker (`apps/worker`)

```bash
pnpm dev:worker
```

- Initializes background worker loop with structured logging.

### Web Frontend (`apps/web`)

```bash
pnpm dev:web
```

- Available at `http://localhost:5173`
- Proxies `/api` requests directly to `http://localhost:4000`
- Provides authentication portal, workspace switcher, and tenant dashboard.

---

## 6. Testing & Code Quality

### Run Unit and Integration Tests:

```bash
pnpm test
```

MindVault features a dual-backend repository pattern (`IDatabaseService`):

- `PrismaDatabaseService`: executes against live PostgreSQL.
- `InMemoryDatabaseService`: runs fast, zero-flake, isolated integration tests in CI/local runs without requiring a live PostgreSQL instance.

### Run TypeScript Strict Typechecking:

```bash
pnpm typecheck
```

### Run Linter:

```bash
pnpm lint
```

### Check & Format Code:

```bash
pnpm format:check
pnpm format
```

---

## 7. Authentication Environment Configuration

Ensure your `.env` contains the required Phase 1 cryptographic secrets:

```env
# JWT & Session Secrets
JWT_ACCESS_SECRET="mindvault-dev-access-jwt-secret-key-32-chars-min"
JWT_ACCESS_EXPIRY="15m"
COOKIE_SECRET="mindvault-dev-cookie-secret-key-32-chars-min"
REFRESH_TOKEN_EXPIRY_DAYS="7"
```

---

## 8. Document Ingestion & Local Vector Infrastructure

### Storage Directory:

Original uploaded files are stored safely outside web roots in:
`infrastructure/storage/documents/` (or the path defined by `STORAGE_DIR`).
Storage keys use sanitized, collision-free names: `doc_<timestamp>_<randomHex>.<ext>`.

### Local Vector Embeddings (Ollama):

MindVault standardizes on **768 dimensions** using `nomic-embed-text` (v1.5) with an 8192 token context window. This matches Google Gemini `text-embedding-004` (768 dimensions), allowing zero-migration multi-provider compatibility.

1. **Install Ollama:** [https://ollama.com](https://ollama.com)
2. **Pull the Embedding Model:**
   ```bash
   ollama pull nomic-embed-text
   ```
3. **Verify Ollama is Running:**
   ```bash
   curl http://127.0.0.1:11434/api/tags
   ```
4. **Environment Variables (`.env`):**
   ```env
   OLLAMA_BASE_URL="http://127.0.0.1:11434"
   EMBEDDING_PROVIDER="ollama"
   EMBEDDING_MODEL="nomic-embed-text"
   EMBEDDING_DIMENSION="768"
   STORAGE_DIR="./infrastructure/storage/documents"
   ```

_Note: In automated tests (`NODE_ENV=test`), `MockEmbeddingProvider` generates deterministic, L2 unit-normalized 768-dimensional vectors with zero external service dependencies._

---

## 9. Troubleshooting

- **`pnpm` command not found**: Ensure npm global bin path is in your `PATH` environment variable (`%APPDATA%\npm` on Windows).
- **Docker pipe error (`open //./pipe/dockerDesktopLinuxEngine`)**: Docker Desktop service is stopped. Launch Docker Desktop and wait for WSL2 initialization. In the meantime, all tests run instantaneously with the in-memory repository layer.
- **`ERR_PNPM_IGNORED_BUILDS`**: Native dependencies (`argon2`, `prisma`, `esbuild`, `msgpackr-extract`) are explicitly permitted via `allowBuilds` in `pnpm-workspace.yaml`.
- **Port conflicts (4000 or 5173)**: Modify `PORT` in `.env` or adjust Vite's `server.port` in `apps/web/vite.config.ts`.
