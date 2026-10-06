param(
    [switch]$NoCacheBuild,
    [switch]$Pull,
    [switch]$RebuildBase,
    [switch]$CpuOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$baseDir = Join-Path $scriptDir "docker\python-base"

$fastapiDockerfile = Join-Path $baseDir "Dockerfile.fastapi"
$heavyDockerfile = Join-Path $baseDir "Dockerfile.heavy"
$nlpDockerfile = Join-Path $baseDir "Dockerfile.nlp"
$browserDockerfile = Join-Path $baseDir "Dockerfile.browser"
$fastapiTag = "snapflow/v3-python-fastapi-base:latest"
$heavyTag = "snapflow/v3-python-heavy-base:latest"
$nlpTag = "snapflow/v3-python-nlp-base:latest"
$browserTag = "snapflow/v3-python-browser-base:latest"

if (-not (Test-Path $fastapiDockerfile) -or -not (Test-Path $heavyDockerfile) -or
    -not (Test-Path $nlpDockerfile) -or -not (Test-Path $browserDockerfile)) {
    throw "Missing V3 base Dockerfiles under $baseDir"
}

$commonBuildFlags = @()
if ($NoCacheBuild) { $commonBuildFlags += "--no-cache" }

# IMPORTANT:
# - `--pull` is safe for Docker Hub public base (Dockerfile.fastapi).
# - Do not pass `--pull` to child bases: NLP/browser use the local fastapi
#   parent and visual/GPU uses the local browser parent.
$fastapiBuildFlags = @($commonBuildFlags)
$heavyBuildFlags = @($commonBuildFlags)
if ($Pull) { $fastapiBuildFlags += "--pull" }

function Test-V3ImageExists {
    param([Parameter(Mandatory = $true)][string]$Tag)

    Write-Host "Inspecting Docker image: $Tag" -ForegroundColor DarkGray
    & docker image inspect $Tag *> $null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "Image exists: $Tag" -ForegroundColor Cyan
        return $true
    }
    Write-Host "Image missing: $Tag" -ForegroundColor Yellow
    return $false
}

function Invoke-V3BaseBuild {
    param(
        [Parameter(Mandatory = $true)][string]$Dockerfile,
        [Parameter(Mandatory = $true)][string]$Tag,
        [string[]]$BuildFlags = @()
    )

    Write-Host "Building $Tag" -ForegroundColor Yellow
    Write-Host "Context: $baseDir" -ForegroundColor DarkGray
    Write-Host "Dockerfile: $Dockerfile" -ForegroundColor DarkGray
    Write-Host "Extra build flags: $($BuildFlags -join ' ')" -ForegroundColor DarkGray
    $args = @("build", "--progress=plain") + $BuildFlags + @("-f", $Dockerfile, "-t", $Tag, $baseDir)
    Write-Host "Command: docker $($args -join ' ')" -ForegroundColor DarkGray
    & docker @args
    if ($LASTEXITCODE -ne 0) {
        throw "Docker build failed for $Tag"
    }
}

Write-Host "Checking V3 base images..." -ForegroundColor Cyan
Write-Host "Flags: rebuild_base=$RebuildBase no_cache=$NoCacheBuild pull=$Pull" -ForegroundColor DarkGray

$buildFastapi = $RebuildBase -or -not (Test-V3ImageExists -Tag $fastapiTag)
$buildHeavy = -not $CpuOnly -and ($RebuildBase -or -not (Test-V3ImageExists -Tag $heavyTag))
$buildNlp = $RebuildBase -or -not (Test-V3ImageExists -Tag $nlpTag)
$buildBrowser = $RebuildBase -or -not (Test-V3ImageExists -Tag $browserTag)

if (-not $RebuildBase) {
    if ($buildFastapi) {
        Write-Host "Plan: build missing $fastapiTag" -ForegroundColor Yellow
    } else {
        Write-Host "Plan: reuse existing $fastapiTag" -ForegroundColor Cyan
    }
    if ($CpuOnly) {
        Write-Host "Plan: skip visual/GPU base (-CpuOnly)." -ForegroundColor Cyan
    } elseif ($buildHeavy) {
        Write-Host "Plan: build missing $heavyTag" -ForegroundColor Yellow
    } else {
        Write-Host "Plan: reuse existing $heavyTag" -ForegroundColor Cyan
    }
} else {
    Write-Host "Plan: rebuild all selected base images; cpu_only=$CpuOnly." -ForegroundColor Yellow
}

if (-not $buildFastapi -and -not $buildHeavy -and -not $buildNlp -and -not $buildBrowser) {
    Write-Host "V3 base images already exist. Reusing cached images." -ForegroundColor Cyan
    Write-Host "Use -RebuildBase to rebuild them; combine with -NoCacheBuild for a cacheless base rebuild." -ForegroundColor Cyan
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

if ($buildNlp) {
    Invoke-V3BaseBuild -Dockerfile $nlpDockerfile -Tag $nlpTag -BuildFlags $commonBuildFlags
}
if ($buildBrowser) {
    Invoke-V3BaseBuild -Dockerfile $browserDockerfile -Tag $browserTag -BuildFlags $commonBuildFlags
}

if ($CpuOnly) {
    Write-Host "Visual/GPU base skipped; NLP and browser CPU bases are ready." -ForegroundColor Green
} elseif ($buildHeavy) {
    Invoke-V3BaseBuild -Dockerfile $heavyDockerfile -Tag $heavyTag -BuildFlags $heavyBuildFlags
} else {
    Write-Host "Reusing existing $heavyTag" -ForegroundColor Cyan
}

Write-Host "V3 Python base images are ready." -ForegroundColor Green
