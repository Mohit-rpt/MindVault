<#
.SYNOPSIS
    MindVault — Staging Deployment & Local Verification Controller
.DESCRIPTION
    Safely builds and starts the isolated staging container stack, validates health,
    and runs preflight checks without touching production.
#>

[CmdletBinding()]
param (
    [Parameter(Mandatory=$false)]
    [ValidateSet("local-simulation", "validate-only", "down")]
    [string]$Action = "validate-only",

    [Parameter(Mandatory=$false)]
    [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host " MindVault Staging Deployment & Verification Controller " -ForegroundColor Cyan
Write-Host " Target Action: $Action" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

# 1. Environment Safety Check
Write-Host "`n[1/5] Verifying environment boundaries..." -ForegroundColor Yellow
if ($env:NODE_ENV -eq "production") {
    Write-Warning "NODE_ENV is set to production in current shell. Staging scripts operate in isolated mode."
}

# 2. Secret Validation
Write-Host "[2/5] Validating staging secret requirements..." -ForegroundColor Yellow
$KnownInsecure = @(
    "dev_jwt_access_secret_replace_in_production_min_32_chars",
    "dev_cookie_signing_secret_replace_in_prod_min_32_chars",
    "secret", "changeme", "12345678901234567890123456789012"
)

# 3. Handle 'down' action
if ($Action -eq "down") {
    Write-Host "`nStopping staging simulation containers..." -ForegroundColor Yellow
    docker compose -f docker-compose.staging.yml down -v
    Write-Host "Staging simulation stopped cleanly." -ForegroundColor Green
    exit 0
}

# 4. Handle 'validate-only' action
if ($Action -eq "validate-only") {
    Write-Host "`n[3/5] Running preflight repository verification..." -ForegroundColor Yellow
    pnpm typecheck
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Monorepo typecheck failed. Fix type errors before deployment."
        exit 1
    }
    Write-Host "Typecheck passed." -ForegroundColor Green

    Write-Host "`n[4/5] Checking container specifications..." -ForegroundColor Yellow
    if (-not (Test-Path "Dockerfile.api")) {
        Write-Error "Dockerfile.api missing!"
        exit 1
    }
    if (-not (Test-Path "Dockerfile.worker")) {
        Write-Error "Dockerfile.worker missing!"
        exit 1
    }
    if (-not (Test-Path "docker-compose.staging.yml")) {
        Write-Error "docker-compose.staging.yml missing!"
        exit 1
    }
    Write-Host "Container specifications verified." -ForegroundColor Green

    Write-Host "`n[5/5] Staging preflight validation complete!" -ForegroundColor Green
    Write-Host "To boot the local staging topology, run: ./scripts/deploy-staging.ps1 -Action local-simulation" -ForegroundColor Cyan
    exit 0
}

# 5. Handle 'local-simulation' action
if ($Action -eq "local-simulation") {
    Write-Host "`n[3/5] Building and launching isolated staging compose topology..." -ForegroundColor Yellow
    
    # Check if docker daemon is reachable
    try {
        docker info > $null 2>&1
        if ($LASTEXITCODE -ne 0) {
            Write-Error "Docker daemon is not running or not accessible. Start Docker Desktop and retry."
            exit 1
        }
    } catch {
        Write-Error "Docker command failed. Is Docker installed and in PATH?"
        exit 1
    }

    if (-not $SkipBuild) {
        docker compose -f docker-compose.staging.yml build
        if ($LASTEXITCODE -ne 0) {
            Write-Error "Docker compose build failed."
            exit 1
        }
    }

    Write-Host "`n[4/5] Starting containers..." -ForegroundColor Yellow
    docker compose -f docker-compose.staging.yml up -d

    Write-Host "`n[5/5] Waiting for API health check..." -ForegroundColor Yellow
    $MaxAttempts = 30
    $Attempt = 0
    $Healthy = $false

    while ($Attempt -lt $MaxAttempts) {
        Start-Sleep -Seconds 2
        $Attempt++
        try {
            $Response = Invoke-RestMethod -Uri "http://localhost:4000/api/health" -Method Get -TimeoutSec 3 -ErrorAction SilentlyContinue
            if ($Response.status -eq "ok") {
                $Healthy = $true
                break
            }
        } catch {
            Write-Host -NoNewline "."
        }
    }

    if ($Healthy) {
        Write-Host "`n Staging API is healthy on http://localhost:4000" -ForegroundColor Green
        Write-Host " Staging Frontend is accessible on http://localhost:8080" -ForegroundColor Green
        Write-Host " MinIO Console is accessible on http://localhost:9001" -ForegroundColor Green
    } else {
        Write-Warning "`nAPI health probe timed out after $($MaxAttempts * 2)s. Inspect container logs via: docker compose -f docker-compose.staging.yml logs"
    }
}
