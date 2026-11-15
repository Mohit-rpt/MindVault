<#
.SYNOPSIS
    Starts the MindVault Smart Local Companion.

.DESCRIPTION
    Launches the companion background service. Supports interactive foreground mode
    or windowless background execution.

.PARAMETER Foreground
    Runs the companion interactively in the current terminal window.
#>

[CmdletBinding()]
param(
    [switch]$Foreground
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $RepoRoot

Write-Host "========================================================================" -ForegroundColor Cyan
Write-Host "  MindVault — Start Local Companion" -ForegroundColor Cyan
Write-Host "========================================================================" -ForegroundColor Cyan

# 1. Prevent duplicate instances
$existing = Get-CimInstance Win32_Process | Where-Object {
    $_.CommandLine -match "apps[\\/]companion[\\/](dist|src)"
}

if ($existing) {
    Write-Host "  [ WARN ] Companion is already running (PID: $($existing.ProcessId -join ', '))." -ForegroundColor Yellow
    Write-Host "  To view status, run: .\scripts\status-mindvault-companion.ps1" -ForegroundColor Gray
    Write-Host "  To stop it, run:     .\scripts\stop-mindvault-companion.ps1" -ForegroundColor Gray
    exit 0
}

# 2. Check build bundle
$CompanionDist = Join-Path $RepoRoot "apps\companion\dist\index.js"
if (-not (Test-Path $CompanionDist)) {
    Write-Host "  Building @mindvault/companion bundle..." -ForegroundColor Yellow
    & pnpm --filter @mindvault/companion build
}

# 3. Launch
if ($Foreground) {
    Write-Host "  Starting Companion in FOREGROUND mode..." -ForegroundColor Yellow
    Write-Host "  (Press Ctrl+C to stop)" -ForegroundColor DarkGray
    Write-Host "------------------------------------------------------------------------" -ForegroundColor Gray
    & node $CompanionDist
} else {
    Write-Host "  Starting Companion in BACKGROUND mode..." -ForegroundColor Yellow
    
    $LauncherScript = Join-Path $env:LOCALAPPDATA "MindVault\companion\run-companion-hidden.vbs"
    if (Test-Path $LauncherScript) {
        $wscriptPath = Join-Path $env:SystemRoot "System32\wscript.exe"
        Start-Process -FilePath $wscriptPath -ArgumentList "`"$LauncherScript`""
    } else {
        Start-Process -FilePath "node.exe" -ArgumentList "`"$CompanionDist`"" -WorkingDirectory $RepoRoot.Path -WindowStyle Hidden
    }

    Start-Sleep -Seconds 2

    $newProc = Get-CimInstance Win32_Process | Where-Object {
        $_.CommandLine -match "apps[\\/]companion[\\/]dist"
    }

    if ($newProc) {
        Write-Host "  [ PASS ] Companion started successfully (PID: $($newProc.ProcessId))." -ForegroundColor Green
        Write-Host "  To inspect status, run: .\scripts\status-mindvault-companion.ps1" -ForegroundColor Gray
    } else {
        Write-Host "  [ WARN ] Process started. Verify status using .\scripts\status-mindvault-companion.ps1" -ForegroundColor Yellow
    }
}
Write-Host "========================================================================" -ForegroundColor Cyan
