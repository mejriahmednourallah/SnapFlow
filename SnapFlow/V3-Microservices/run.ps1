<#
.SYNOPSIS
    SnapFlow V3 Stack Launcher
.DESCRIPTION
    Builds and runs the V3 scanning stack using Docker Compose.
.PARAMETER NoCacheBuild
    Rebuilds service images without Docker cache. Does not rebuild base images by itself.
.PARAMETER Down
    If set, tears down the stack and removes volumes before starting
.PARAMETER RebuildBase
    Explicitly rebuilds shared Python base images. Combine with -NoCacheBuild for a cacheless base rebuild.
.EXAMPLE
    .\run.ps1 -NoCacheBuild
.EXAMPLE
    .\run.ps1 -RebuildBase -NoCacheBuild
#>

param(
    [switch]$NoCacheBuild,
    [switch]$Down,
    [switch]$RebuildBase
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Push-Location $scriptDir

$totalSteps = if ($Down) { 4 } else { 3 }
$step = 1

# ─── Banner ───────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "   SnapFlow V3 Backend Launcher           " -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  No-Cache Build:     $NoCacheBuild"        -ForegroundColor White
Write-Host "  Rebuild Base:       $RebuildBase"         -ForegroundColor White
Write-Host "==========================================`n" -ForegroundColor Cyan

# ─── Tear Down (optional) ─────────────────────────────────────────────────────
if ($Down) {
    Write-Host "`n[$step/$totalSteps] Tearing down existing stack..." -ForegroundColor Yellow
    docker compose down --volumes --remove-orphans
    Write-Host "Stack torn down." -ForegroundColor Green
    $step++
}

# ─── Build V3 Base Images ───────────────────────────────────────────────────
Write-Host "`n[$step/$totalSteps] Building V3 Python base images..." -ForegroundColor Yellow
$baseBuildScript = Join-Path $scriptDir "BUILD_V3_BASE_IMAGES.ps1"
$baseArgs = @()
if ($RebuildBase) {
    $baseArgs += "-RebuildBase"
    if ($NoCacheBuild) {
        $baseArgs += "-NoCacheBuild"
        $baseArgs += "-Pull"
    }
}
& $baseBuildScript @baseArgs

if ($LASTEXITCODE -ne 0) {
    Write-Error "V3 base image build failed."
    Pop-Location
    exit 1
}

Write-Host "Base image build complete." -ForegroundColor Green
$step++

# ─── Build ────────────────────────────────────────────────────────────────────
Write-Host "`n[$step/$totalSteps] Building Docker images..." -ForegroundColor Yellow
if ($NoCacheBuild) {
    # Do not pass --pull here: service Dockerfiles depend on local snapflow
    # base images and --pull forces Docker Hub lookups for local-only tags.
    Write-Host "Command: docker compose build --progress=plain --no-cache" -ForegroundColor DarkGray
    docker compose build --progress=plain --no-cache
} else {
    Write-Host "Command: docker compose build --progress=plain" -ForegroundColor DarkGray
    docker compose build --progress=plain
}

if ($LASTEXITCODE -ne 0) {
    Write-Error "Docker build failed. Check the errors above."
    exit 1
}
Write-Host "Build complete." -ForegroundColor Green
$step++

# ─── Start DB + Workers ──────────────────────────────────────────────────────
Write-Host "`n[$step/$totalSteps] Starting full backend stack..." -ForegroundColor Yellow
docker compose up -d

Write-Host "`n✅ Backend Stack is running!" -ForegroundColor Green
Write-Host "   Aggregator API: http://localhost:8080" -ForegroundColor Cyan
Write-Host ""
Write-Host "To test via Postman:" -ForegroundColor White
Write-Host "1. POST http://localhost:8080/scan" -ForegroundColor DarkGray
Write-Host "   { `"url`": `"https://www.auchan.sn`", `"max_pages`": 150 }"
Write-Host "   (This returns a `"scan_id`")"
Write-Host ""
Write-Host "2. GET http://localhost:8080/scan/<scan_id>/status" -ForegroundColor DarkGray
Write-Host "   (Poll this until status is `"complete`")"
Write-Host ""
Write-Host "3. GET http://localhost:8080/scan/<scan_id>/result" -ForegroundColor DarkGray
Write-Host "   (Gets the final JSON output)"
Write-Host ""
Write-Host "(Or use POST http://localhost:8080/scan/sync to block until done)" -ForegroundColor Magenta
Write-Host ""
Write-Host "To stop the stack later: docker compose down" -ForegroundColor Yellow

Pop-Location
