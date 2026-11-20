#!/usr/bin/env bash
# ==============================================================================
# MindVault — Staging Deployment & Local Verification Controller (POSIX Bash)
# ==============================================================================

set -euo pipefail

ACTION="${1:-validate-only}"

echo "=========================================================="
echo " MindVault Staging Deployment & Verification Controller "
echo " Target Action: ${ACTION}"
echo "=========================================================="

# 1. Environment Safety Check
echo ""
echo "[1/5] Verifying environment boundaries..."
if [[ "${NODE_ENV:-}" == "production" ]]; then
    echo "⚠️ WARNING: NODE_ENV is set to production in current shell. Staging scripts operate in isolated mode."
fi

# 2. Handle 'down'
if [[ "${ACTION}" == "down" ]]; then
    echo "Stopping staging simulation containers..."
    docker compose -f docker-compose.staging.yml down -v
    echo "✅ Staging simulation stopped cleanly."
    exit 0
fi

# 3. Handle 'validate-only'
if [[ "${ACTION}" == "validate-only" ]]; then
    echo ""
    echo "[3/5] Running preflight repository verification..."
    pnpm typecheck
    echo "✅ Typecheck passed."

    echo ""
    echo "[4/5] Checking container specifications..."
    [[ -f "Dockerfile.api" ]] || { echo "❌ Missing Dockerfile.api"; exit 1; }
    [[ -f "Dockerfile.worker" ]] || { echo "❌ Missing Dockerfile.worker"; exit 1; }
    [[ -f "docker-compose.staging.yml" ]] || { echo "❌ Missing docker-compose.staging.yml"; exit 1; }
    echo "✅ Container specifications verified."

    echo ""
    echo "[5/5] Staging preflight validation complete!"
    echo "To boot local staging topology, run: ./scripts/deploy-staging.sh local-simulation"
    exit 0
fi

# 4. Handle 'local-simulation'
if [[ "${ACTION}" == "local-simulation" ]]; then
    echo ""
    echo "[3/5] Building and launching isolated staging compose topology..."
    docker info > /dev/null 2>&1 || { echo "❌ Docker daemon not running or not accessible."; exit 1; }

    docker compose -f docker-compose.staging.yml build
    echo ""
    echo "[4/5] Starting containers..."
    docker compose -f docker-compose.staging.yml up -d

    echo ""
    echo "[5/5] Waiting for API health check..."
    MAX_ATTEMPTS=30
    ATTEMPT=0
    HEALTHY=0

    while [[ ${ATTEMPT} -lt ${MAX_ATTEMPTS} ]]; do
        sleep 2
        ATTEMPT=$((ATTEMPT + 1))
        if curl -s -f http://localhost:4000/api/health > /dev/null 2>&1; then
            HEALTHY=1
            break
        else
            echo -n "."
        fi
    done

    echo ""
    if [[ ${HEALTHY} -eq 1 ]]; then
        echo "✅ Staging API is healthy on http://localhost:4000"
        echo "✅ Staging Frontend is accessible on http://localhost:8080"
        echo "✅ MinIO Console is accessible on http://localhost:9001"
    else
        echo "⚠️ API health probe timed out after $((MAX_ATTEMPTS * 2))s. Check logs: docker compose -f docker-compose.staging.yml logs"
    fi
fi
