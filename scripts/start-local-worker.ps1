<#
.SYNOPSIS
    MindVault — Windows 11 Local Background Worker Launcher

.DESCRIPTION
    Automates the startup sequence for running the MindVault background worker
    locally on Windows 11 while consuming jobs from Cloud Upstash Redis and
    processing AI workloads through local Ollama.

.PARAMETER Mode
    Execution mode: 'dev' (hot reload via tsx watch) or 'start' (compiled production bundle). Default: 'dev'.

.PARAMETER Concurrency
    BullMQ worker concurrency. Recommended: 1 for local machines with <= 8 GB RAM. Default: 1.

.PARAMETER SkipPreflight
    Bypass diagnostic preflight verification if already verified.

.EXAMPLE
    .\scripts\start-local-worker.ps1
    .\scripts\start-local-worker.ps1 -Mode dev -Concurrency 1
    .\scripts\start-local-worker.ps1 -Mode start
#>

[CmdletBinding()]
param(
    [ValidateSet('dev', 'start', 'prod')]
    [string]$Mode = 'dev',

    [int]$Concurrency = 1,

    [switch]$SkipPreflight
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $RepoRoot

Write-Host "========================================================================" -ForegroundColor Cyan
Write-Host "  MindVault — Local Windows Background Worker Launcher" -ForegroundColor Cyan
Write-Host "========================================================================" -ForegroundColor Cyan
Write-Host "  Platform:      Windows 11 ($([System.Environment]::OSVersion.VersionString))" -ForegroundColor Gray
Write-Host "  Architecture:  $([System.Environment]::GetEnvironmentVariable('PROCESSOR_ARCHITECTURE'))" -ForegroundColor Gray
Write-Host "  Node Version:  $(node --version)" -ForegroundColor Gray
Write-Host "  Concurrency:   $Concurrency (optimized for local CPU/RAM)" -ForegroundColor Gray
Write-Host "  Target Queues: document-processing, graph-extraction" -ForegroundColor Gray
Write-Host "  AI Provider:   Google Gemini AI (Cloud API)" -ForegroundColor Gray
Write-Host "========================================================================" -ForegroundColor Cyan
Write-Host ""

# 1. Verify Gemini API credentials configured
Write-Host "[1/3] Checking Google Gemini AI Credentials..." -ForegroundColor Yellow
if ([string]::IsNullOrWhiteSpace($env:GEMINI_API_KEY)) {
    # Check if present in .env
    if (Test-Path ".env") {
        $envContent = Get-Content ".env" -Raw
        if ($envContent -match "GEMINI_API_KEY\s*=\s*['""]?([^'""]+)['""]?") {
            $maskedKey = $Matches[1].Substring(0, [Math]::Min(8, $Matches[1].Length)) + "...[REDACTED]"
            Write-Host "  [ PASS ] Gemini API key detected in .env: $maskedKey" -ForegroundColor Green
        } else {
            Write-Host "  [ FAIL ] GEMINI_API_KEY is not configured in environment or .env file." -ForegroundColor Red
            Write-Host "  Action required: Set GEMINI_API_KEY in your .env file or environment before launching." -ForegroundColor Yellow
            exit 1
        }
    } else {
        Write-Host "  [ FAIL ] GEMINI_API_KEY is not configured and .env file was not found." -ForegroundColor Red
        exit 1
    }
} else {
    $maskedKey = $env:GEMINI_API_KEY.Substring(0, [Math]::Min(8, $env:GEMINI_API_KEY.Length)) + "...[REDACTED]"
    Write-Host "  [ PASS ] Gemini API key detected in environment: $maskedKey" -ForegroundColor Green
}

# 2. Run deterministic preflight checks unless explicitly skipped
if (-not $SkipPreflight) {
    Write-Host ""
    Write-Host "[2/3] Executing Preflight Diagnostic Suite..." -ForegroundColor Yellow
    & pnpm worker:preflight
    if ($LASTEXITCODE -ne 0) {
        Write-Host ""
        Write-Host "  [ ERROR ] Preflight checks failed with exit code $LASTEXITCODE." -ForegroundColor Red
        Write-Host "  Please resolve the reported errors above before launching the worker." -ForegroundColor Yellow
        exit $LASTEXITCODE
    }
} else {
    Write-Host ""
    Write-Host "[2/3] Preflight check skipped via -SkipPreflight flag." -ForegroundColor DarkYellow
}

# 3. Configure runtime environment variables for local Windows worker execution
$env:WORKER_CONCURRENCY = "$Concurrency"
$env:LLM_PROVIDER = "gemini"
$env:EMBEDDING_PROVIDER = "gemini"
$env:EMBEDDING_MODEL = "gemini-embedding-2"

Write-Host ""
Write-Host "[3/3] Launching Background Worker in '$Mode' mode..." -ForegroundColor Yellow
Write-Host "  (Press Ctrl+C to initiate graceful shutdown)" -ForegroundColor DarkGray
Write-Host "------------------------------------------------------------------------" -ForegroundColor Gray

try {
    if ($Mode -eq 'dev') {
        & pnpm worker:dev
    } else {
        # Production mode: ensure fresh build if dist is missing
        if (-not (Test-Path "apps/worker/dist/index.js")) {
            Write-Host "  Building worker bundle..." -ForegroundColor Cyan
            & pnpm --filter @mindvault/worker build
        }
        & pnpm worker:start
    }
} finally {
    Write-Host ""
    Write-Host "Worker execution terminated." -ForegroundColor Cyan
}
