<#
.SYNOPSIS
    Installs the MindVault Smart Local Companion as a Windows Task Scheduler job.

.DESCRIPTION
    Registers a user-level scheduled task that automatically launches the MindVault
    Local Companion upon Windows logon without opening an interactive PowerShell window.
    Does not require Administrator privileges.

.PARAMETER NodePath
    Custom path to node.exe (defaults to system node from PATH).

.EXAMPLE
    .\scripts\install-mindvault-companion.ps1
#>

[CmdletBinding()]
param(
    [string]$NodePath
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$TaskName = "MindVaultLocalCompanion"

Write-Host "========================================================================" -ForegroundColor Cyan
Write-Host "  MindVault — Install Local Companion Task Scheduler Service" -ForegroundColor Cyan
Write-Host "========================================================================" -ForegroundColor Cyan

# 1. Resolve node.exe
if (-not $NodePath) {
    $nodeCmd = Get-Command node -ErrorAction SilentlyContinue
    if (-not $nodeCmd) {
        Write-Host "  [ FAIL ] Node.js executable not found in PATH." -ForegroundColor Red
        Write-Host "  Please install Node.js v20+ or specify -NodePath." -ForegroundColor Yellow
        exit 1
    }
    $NodePath = $nodeCmd.Source
}
Write-Host "  Node Executable: $NodePath" -ForegroundColor Gray

# 2. Ensure companion is compiled
$CompanionDist = Join-Path $RepoRoot "apps\companion\dist\index.js"
if (-not (Test-Path $CompanionDist)) {
    Write-Host "  Building @mindvault/companion bundle..." -ForegroundColor Yellow
    Push-Location $RepoRoot
    try {
        & pnpm --filter @mindvault/companion build
    } finally {
        Pop-Location
    }
}
Write-Host "  Companion Bundle: $CompanionDist" -ForegroundColor Gray

# 3. Create silent launcher script (VBScript launcher for 100% windowless background execution)
$LauncherDir = Join-Path $env:LOCALAPPDATA "MindVault\companion"
if (-not (Test-Path $LauncherDir)) {
    New-Item -ItemType Directory -Path $LauncherDir -Force | Out-Null
}
$LauncherScript = Join-Path $LauncherDir "run-companion-hidden.vbs"

$vbsContent = @"
Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "$($RepoRoot.Path.Replace('\', '\\'))"
WshShell.Run """$($NodePath.Replace('\', '\\'))"" ""$($CompanionDist.Replace('\', '\\'))""", 0, False
"@

Set-Content -Path $LauncherScript -Value $vbsContent -Encoding ASCII
Write-Host "  Silent Runner:   $LauncherScript" -ForegroundColor Gray

# 4. Register Scheduled Task with Windows Task Scheduler
Write-Host ""
Write-Host "Registering logon task '$TaskName' for user '$env:USERNAME'..." -ForegroundColor Yellow

$wscriptPath = Join-Path $env:SystemRoot "System32\wscript.exe"
$action = """$wscriptPath"" ""$LauncherScript"""

# Use schtasks for current user context (no Admin elevation needed)
$schtasksCmd = "schtasks /Create /TN `"$TaskName`" /TR `"$action`" /SC ONLOGON /F"
Invoke-Expression $schtasksCmd

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "========================================================================" -ForegroundColor Cyan
    Write-Host "  INSTALLATION SUCCESSFUL" -ForegroundColor Green
    Write-Host "========================================================================" -ForegroundColor Cyan
    Write-Host "  Task '$TaskName' has been registered." -ForegroundColor White
    Write-Host "  It will start automatically each time you log into Windows." -ForegroundColor Gray
    Write-Host ""
    Write-Host "To test or run immediately:" -ForegroundColor Yellow
    Write-Host "  .\scripts\start-mindvault-companion.ps1" -ForegroundColor White
    Write-Host "To inspect status:" -ForegroundColor Yellow
    Write-Host "  .\scripts\status-mindvault-companion.ps1" -ForegroundColor White
    Write-Host "========================================================================" -ForegroundColor Cyan
} else {
    Write-Host "  [ FAIL ] Failed to register scheduled task (Exit code: $LASTEXITCODE)." -ForegroundColor Red
    exit $LASTEXITCODE
}
