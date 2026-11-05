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

## 4. Running the Development Services

Run services in separate terminal windows or concurrently:

### API Server (`apps/api`)

```bash
pnpm dev:api
```

- Listens on `http://localhost:4000`
- Health check available at `http://localhost:4000/api/health`

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

---

## 5. Testing & Code Quality

### Run Unit and Integration Tests:

```bash
pnpm test
```

### Run TypeScript Strict Typechecking:

```bash
pnpm typecheck
```

### Run Linter:

```bash
pnpm lint
```

### Format Code:

```bash
pnpm format
```

---

## 6. Troubleshooting

- **`pnpm` command not found**: Ensure npm global bin path is in your `PATH` environment variable (`%APPDATA%\npm` on Windows).
- **Docker pipe error (`open //./pipe/dockerDesktopLinuxEngine`)**: Docker Desktop service is stopped. Launch Docker Desktop and wait for WSL2 initialization.
- **Port conflicts (4000 or 5173)**: Modify `PORT` in `.env` or adjust Vite's `server.port` in `apps/web/vite.config.ts`.
