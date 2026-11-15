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
Write-Host "  Local Ollama:  http://127.0.0.1:11434" -ForegroundColor Gray
Write-Host "========================================================================" -ForegroundColor Cyan
Write-Host ""

# 1. Verify Ollama process / endpoint responsiveness
Write-Host "[1/3] Checking Local Ollama Endpoint..." -ForegroundColor Yellow
try {
    $ollamaTest = Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/tags" -Method Get -TimeoutSec 3 -ErrorAction Stop
    $modelNames = $ollamaTest.models | ForEach-Object { $_.name }
    Write-Host "  [ PASS ] Ollama is active. Installed models: $($modelNames -join ', ')" -ForegroundColor Green
} catch {
    Write-Host "  [ FAIL ] Ollama is not responding at http://127.0.0.1:11434" -ForegroundColor Red
    Write-Host "  Action required: Please start Ollama by opening the Ollama application or running 'ollama serve'." -ForegroundColor Yellow
    exit 1
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
if (-not $env:OLLAMA_BASE_URL) {
    $env:OLLAMA_BASE_URL = "http://127.0.0.1:11434"
}

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
