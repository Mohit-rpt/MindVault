<#
.SYNOPSIS
    Uninstalls the MindVault Smart Local Companion Windows scheduled task.

.DESCRIPTION
    Deletes the 'MindVaultLocalCompanion' scheduled task from Windows Task Scheduler
    and terminates any active companion background processes.
#>

[CmdletBinding()]
param(
    [switch]$ClearToken
)

$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$TaskName = "MindVaultLocalCompanion"

Write-Host "========================================================================" -ForegroundColor Cyan
Write-Host "  MindVault — Uninstall Local Companion Service" -ForegroundColor Cyan
Write-Host "========================================================================" -ForegroundColor Cyan

# 1. Unregister Scheduled Task
Write-Host "Removing Windows scheduled task '$TaskName'..." -ForegroundColor Yellow
$result = schtasks /Delete /TN $TaskName /F 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Host "  [ PASS ] Scheduled task '$TaskName' removed successfully." -ForegroundColor Green
} else {
    Write-Host "  [ INFO ] Scheduled task '$TaskName' was not found or already removed." -ForegroundColor Gray
}

# 2. Stop running companion processes
Write-Host "Stopping any running companion processes..." -ForegroundColor Yellow
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$CompanionDist = Join-Path $RepoRoot "apps\companion\dist\index.js"

$procs = Get-CimInstance Win32_Process | Where-Object {
    $_.CommandLine -match "apps[\\/]companion"
}

if ($procs) {
    foreach ($proc in $procs) {
        Write-Host "  Terminating process PID $($proc.ProcessId)..." -ForegroundColor Yellow
        Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue
    }
    Write-Host "  [ PASS ] Active companion processes stopped." -ForegroundColor Green
} else {
    Write-Host "  [ INFO ] No active companion processes found." -ForegroundColor Gray
}

# 3. Clear token if requested
if ($ClearToken) {
    $TokenFile = Join-Path $env:LOCALAPPDATA "MindVault\companion\device-token.dat"
    if (Test-Path $TokenFile) {
        Remove-Item -Path $TokenFile -Force -ErrorAction SilentlyContinue
        Write-Host "  [ PASS ] Local device token deleted." -ForegroundColor Green
    }
}

Write-Host "========================================================================" -ForegroundColor Cyan
Write-Host "  MindVault Companion uninstalled cleanly." -ForegroundColor Green
Write-Host "========================================================================" -ForegroundColor Cyan
