# Build the shared Python base image for all microservices
# This MUST be built before any microservice images

# Get the script's directory (project root)
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Push-Location $scriptDir

Write-Host "Building snapflow/python-micro-base..." -ForegroundColor Cyan
Write-Host "Working directory: $scriptDir" -ForegroundColor Gray

# Step 1: Copy shared module to build context
Write-Host "Copying shared module to build context..." -ForegroundColor Yellow
$sharedSource = Join-Path $scriptDir "Microservices\shared"
$sharedDest = Join-Path $scriptDir "docker\python-base\shared"

Write-Host "  Source: $sharedSource" -ForegroundColor Gray
Write-Host "  Dest: $sharedDest" -ForegroundColor Gray

# Verify source exists
if (-not (Test-Path $sharedSource)) {
    Write-Host "❌ ERROR: Shared module not found at: $sharedSource" -ForegroundColor Red
    Pop-Location
    exit 1
}

# Clean destination if exists
if (Test-Path $sharedDest) {
    Remove-Item -Recurse -Force $sharedDest
}

# Copy shared module
Copy-Item -Recurse -Force $sharedSource $sharedDest

# Verify copy succeeded
if (-not (Test-Path $sharedDest)) {
    Write-Host "❌ ERROR: Failed to copy shared module to build context" -ForegroundColor Red
    Pop-Location
    exit 1
}

Write-Host "✓ Shared module copied successfully" -ForegroundColor Green

# Step 2: Build the image
Write-Host "Building Docker image..." -ForegroundColor Yellow
$buildContext = Join-Path $scriptDir "docker\python-base"
docker build -t snapflow/python-micro-base:latest $buildContext
$buildResult = $LASTEXITCODE

# Step 3: Clean up (always, even if build fails)
Write-Host "Cleaning up build context..." -ForegroundColor Yellow
if (Test-Path $sharedDest) {
    Remove-Item -Recurse -Force $sharedDest
}

Pop-Location

if ($buildResult -eq 0) {
    Write-Host "✅ Base image built successfully!" -ForegroundColor Green
    Write-Host "All microservices can now inherit from snapflow/python-micro-base" -ForegroundColor Green
    Write-Host ""
    Write-Host "The shared module is now available at /app/shared in all containers." -ForegroundColor Cyan
    Write-Host "Services can use: from shared.db_client import store_audit_result" -ForegroundColor Cyan
    Write-Host "Services can use: from shared.memory_middleware import MemoryProfilingMiddleware" -ForegroundColor Cyan
} else {
    Write-Host "❌ Build failed with exit code $buildResult" -ForegroundColor Red
    exit 1
}
