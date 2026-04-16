param(
    [switch]$NoCacheBuild,
    [switch]$Pull,
    [switch]$RebuildBase
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$baseDir = Join-Path $scriptDir "docker\python-base"

$fastapiDockerfile = Join-Path $baseDir "Dockerfile.fastapi"
$heavyDockerfile = Join-Path $baseDir "Dockerfile.heavy"
$fastapiTag = "snapflow/v3-python-fastapi-base:latest"
$heavyTag = "snapflow/v3-python-heavy-base:latest"

if (-not (Test-Path $fastapiDockerfile) -or -not (Test-Path $heavyDockerfile)) {
    throw "Missing V3 base Dockerfiles under $baseDir"
}

$commonBuildFlags = @()
if ($NoCacheBuild) { $commonBuildFlags += "--no-cache" }

# IMPORTANT:
# - `--pull` is safe for Docker Hub public base (Dockerfile.fastapi).
# - Do not pass `--pull` to Dockerfile.heavy because it depends on a local
#   parent image (`snapflow/v3-python-fastapi-base:latest`).
$fastapiBuildFlags = @($commonBuildFlags)
$heavyBuildFlags = @($commonBuildFlags)
if ($Pull) { $fastapiBuildFlags += "--pull" }

function Test-V3ImageExists {
    param([Parameter(Mandatory = $true)][string]$Tag)

    & docker image inspect $Tag *> $null
    return ($LASTEXITCODE -eq 0)
}

function Invoke-V3BaseBuild {
    param(
        [Parameter(Mandatory = $true)][string]$Dockerfile,
        [Parameter(Mandatory = $true)][string]$Tag,
        [string[]]$BuildFlags = @()
    )

    Write-Host "Building $Tag" -ForegroundColor Yellow
    $args = @("build") + $BuildFlags + @("-f", $Dockerfile, "-t", $Tag, $baseDir)
    & docker @args
    if ($LASTEXITCODE -ne 0) {
        throw "Docker build failed for $Tag"
    }
}

$buildFastapi = $RebuildBase -or -not (Test-V3ImageExists -Tag $fastapiTag)
$buildHeavy = $RebuildBase -or -not (Test-V3ImageExists -Tag $heavyTag)

if (-not $buildFastapi -and -not $buildHeavy) {
    Write-Host "V3 base images already exist. Reusing cached images." -ForegroundColor Cyan
    Write-Host "Use -RebuildBase to force rebuilding both base images." -ForegroundColor Cyan
    return
}

if ($buildFastapi) {
    Invoke-V3BaseBuild -Dockerfile $fastapiDockerfile -Tag $fastapiTag -BuildFlags $fastapiBuildFlags
} else {
    Write-Host "Reusing existing $fastapiTag" -ForegroundColor Cyan
}

if (-not (Test-V3ImageExists -Tag $fastapiTag)) {
    throw "Required local base image missing: $fastapiTag"
}

if ($buildHeavy) {
    Invoke-V3BaseBuild -Dockerfile $heavyDockerfile -Tag $heavyTag -BuildFlags $heavyBuildFlags
} else {
    Write-Host "Reusing existing $heavyTag" -ForegroundColor Cyan
}

Write-Host "V3 Python base images are ready." -ForegroundColor Green
