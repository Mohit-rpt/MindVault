<#
.SYNOPSIS
    Stops the MindVault Smart Local Companion and any supervised background worker.

.DESCRIPTION
    Locates active companion and background worker processes and stops them cleanly.
#>

[CmdletBinding()]
param()

$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Write-Host "========================================================================" -ForegroundColor Cyan
Write-Host "  MindVault — Stop Local Companion" -ForegroundColor Cyan
Write-Host "========================================================================" -ForegroundColor Cyan

# 1. Stop companion processes
$companionProcs = Get-CimInstance Win32_Process | Where-Object {
    $_.CommandLine -match "apps[\\/]companion"
}

if ($companionProcs) {
    foreach ($proc in $companionProcs) {
        Write-Host "  Stopping Companion PID $($proc.ProcessId)..." -ForegroundColor Yellow
        Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue
    }
    Write-Host "  [ PASS ] Companion processes stopped." -ForegroundColor Green
} else {
    Write-Host "  [ INFO ] No running companion process found." -ForegroundColor Gray
}

# 2. Check for orphan worker processes
$workerProcs = Get-CimInstance Win32_Process | Where-Object {
    $_.CommandLine -match "apps[\\/]worker"
}

if ($workerProcs) {
    foreach ($proc in $workerProcs) {
        Write-Host "  Stopping Worker PID $($proc.ProcessId)..." -ForegroundColor Yellow
        Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue
    }
    Write-Host "  [ PASS ] Background worker processes stopped." -ForegroundColor Green
}

Write-Host "========================================================================" -ForegroundColor Cyan
