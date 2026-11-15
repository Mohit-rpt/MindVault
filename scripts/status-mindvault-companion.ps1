<#
.SYNOPSIS
    Reports status of the MindVault Smart Local Companion and Background Worker.

.DESCRIPTION
    Inspects Windows Scheduled Task state, local process execution, paired device
    credentials, and cloud queue availability.
#>

[CmdletBinding()]
param()

$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$TaskName = "MindVaultLocalCompanion"

Write-Host "========================================================================" -ForegroundColor Cyan
Write-Host "  MindVault — Local Companion & Worker Diagnostic Status" -ForegroundColor Cyan
Write-Host "========================================================================" -ForegroundColor Cyan

# 1. Scheduled Task Status
Write-Host "[1/4] Windows Scheduled Task ($TaskName):" -ForegroundColor Yellow
$taskQuery = schtasks /Query /TN $TaskName /FO LIST 2>&1
if ($LASTEXITCODE -eq 0) {
    $statusLine = ($taskQuery | Select-String "Status:").ToString().Trim()
    $nextRun = ($taskQuery | Select-String "Next Run Time:").ToString().Trim()
    Write-Host "  [ PASS ] Installed" -ForegroundColor Green
    Write-Host "  $statusLine" -ForegroundColor Gray
    Write-Host "  $nextRun" -ForegroundColor Gray
} else {
    Write-Host "  [ INFO ] Not installed as scheduled task." -ForegroundColor Gray
    Write-Host "  To install: .\scripts\install-mindvault-companion.ps1" -ForegroundColor DarkGray
}

# 2. Local Process State
Write-Host ""
Write-Host "[2/4] Active Process Execution:" -ForegroundColor Yellow

$companionProcs = Get-CimInstance Win32_Process | Where-Object {
    $_.CommandLine -match "apps[\\/]companion"
}

if ($companionProcs) {
    foreach ($p in $companionProcs) {
        $memMb = [Math]::Round($p.WorkingSetSize / 1MB, 1)
        Write-Host "  [ ONLINE ] Companion is RUNNING (PID: $($p.ProcessId), Memory: ${memMb} MB)" -ForegroundColor Green
    }
} else {
    Write-Host "  [ OFFLINE ] Companion is not running." -ForegroundColor Gray
}

$workerProcs = Get-CimInstance Win32_Process | Where-Object {
    $_.CommandLine -match "apps[\\/]worker"
}

if ($workerProcs) {
    foreach ($p in $workerProcs) {
        $memMb = [Math]::Round($p.WorkingSetSize / 1MB, 1)
        Write-Host "  [ ONLINE ] Worker is RUNNING (PID: $($p.ProcessId), Memory: ${memMb} MB)" -ForegroundColor Green
    }
} else {
    Write-Host "  [ STANDBY ] Background worker is OFF (waiting for pending jobs)." -ForegroundColor DarkYellow
}

# 3. Local Token & Device Pairing State
Write-Host ""
Write-Host "[3/4] Device Pairing & Credential Store:" -ForegroundColor Yellow
$CompanionDist = Join-Path $RepoRoot "apps\companion\dist\index.js"
if (Test-Path $CompanionDist) {
    & node $CompanionDist --status
} else {
    Write-Host "  Companion bundle not compiled yet. Run 'pnpm --filter @mindvault/companion build'." -ForegroundColor Gray
}

# 4. Cloud Observability Endpoints
Write-Host ""
Write-Host "[4/4] Cloud API Observability Probes:" -ForegroundColor Yellow
$apiUrl = "http://localhost:3000"
if ($env:CLOUD_API_URL) { $apiUrl = $env:CLOUD_API_URL }

try {
    $compHealth = Invoke-RestMethod -Uri "$apiUrl/api/health/companion" -Method Get -TimeoutSec 2 -ErrorAction Stop
    Write-Host "  API /health/companion -> Status: $($compHealth.status)" -ForegroundColor Green
} catch {
    Write-Host "  API /health/companion -> Unreachable at $apiUrl (API may be offline or on cloud host)" -ForegroundColor Gray
}

try {
    $workHealth = Invoke-RestMethod -Uri "$apiUrl/api/health/worker" -Method Get -TimeoutSec 2 -ErrorAction Stop
    Write-Host "  API /health/worker    -> Status: $($workHealth.status)" -ForegroundColor Green
} catch {
    Write-Host "  API /health/worker    -> Unreachable at $apiUrl" -ForegroundColor Gray
}

Write-Host "========================================================================" -ForegroundColor Cyan
