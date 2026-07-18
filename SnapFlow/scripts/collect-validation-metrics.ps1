param(
  [string]$OutputPath = "VALIDATION_METRICS_RESULTS.md",
  [string]$AggregatorUrl = "http://127.0.0.1:8080",
  [string[]]$BenchmarkUrls = @("https://example.com", "https://www.iana.org", "https://httpbin.org"),
  [int]$MaxPages = 5,
  [int]$BenchmarkTimeoutSeconds = 900,
  [switch]$RunBenchmark,
  [switch]$RunCoverage,
  [switch]$SkipTests
)

$ErrorActionPreference = "Continue"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$BenchmarkUrls = @(
  $BenchmarkUrls |
    ForEach-Object { [string]$_ -split "," } |
    ForEach-Object { $_.Trim() } |
    Where-Object { $_ }
)
$results = New-Object System.Collections.Generic.List[object]
$sections = New-Object System.Collections.Generic.List[string]

function Escape-MdCell {
  param([object]$Value)
  if ($null -eq $Value) { return "" }
  return (($Value | Out-String).Trim() -replace "\|", "\|") -replace "`r?`n", "<br>"
}

function Add-Section {
  param([string]$Markdown)
  $script:sections.Add($Markdown) | Out-Null
}

function Get-OutputExcerpt {
  param(
    [string]$Output,
    [int]$HeadLines = 35,
    [int]$TailLines = 80
  )
  if (-not $Output) { return "" }
  $lines = $Output -split "`r?`n"
  if ($lines.Count -le ($HeadLines + $TailLines + 5)) {
    return $Output.Trim()
  }
  $head = $lines | Select-Object -First $HeadLines
  $tail = $lines | Select-Object -Last $TailLines
  return (($head + @("... output truncated; see local command/artifacts for full log ...") + $tail) -join "`n").Trim()
}

function Invoke-MetricCommand {
  param(
    [string]$Label,
    [string]$WorkingDirectory,
    [string]$FilePath,
    [string[]]$Arguments = @()
  )

  $oldLocation = Get-Location
  $sw = [Diagnostics.Stopwatch]::StartNew()
  $output = @()
  $exitCode = $null

  try {
    Set-Location $WorkingDirectory
    $output = & $FilePath @Arguments 2>&1
    $exitCode = if ($null -ne $LASTEXITCODE) { $LASTEXITCODE } else { 0 }
  } catch {
    $output = @($_.Exception.Message)
    $exitCode = -1
  } finally {
    $sw.Stop()
    Set-Location $oldLocation
  }

  [pscustomobject]@{
    label = $Label
    command = "$FilePath $($Arguments -join ' ')".Trim()
    cwd = $WorkingDirectory
    exit_code = $exitCode
    elapsed_seconds = [math]::Round($sw.Elapsed.TotalSeconds, 2)
    output = ($output | Out-String).Trim()
  }
}

function Get-PytestCollectedCount {
  param([string]$Output)
  if ($Output -match "([0-9]+)\s+tests?\s+collected") { return [int]$Matches[1] }
  if ($Output -match "collected\s+([0-9]+)\s+items?") { return [int]$Matches[1] }
  return $null
}

function Get-PytestPassedFailed {
  param([string]$Output)
  $passed = $null
  $failed = 0
  $skipped = 0
  if ($Output -match "([0-9]+)\s+passed") { $passed = [int]$Matches[1] }
  if ($Output -match "([0-9]+)\s+failed") { $failed = [int]$Matches[1] }
  if ($Output -match "([0-9]+)\s+skipped") { $skipped = [int]$Matches[1] }
  [pscustomobject]@{ passed = $passed; failed = $failed; skipped = $skipped }
}

function Get-TestSummaryCounts {
  param([string]$Output)
  $passed = $null
  $failed = 0
  $skipped = 0
  $total = $null
  if ($Output -match "([0-9]+)\s+passed") { $passed = [int]$Matches[1] }
  if ($Output -match "([0-9]+)\s+failed") { $failed = [int]$Matches[1] }
  if ($Output -match "([0-9]+)\s+skipped") { $skipped = [int]$Matches[1] }
  if ($null -ne $passed) { $total = $passed + $failed + $skipped }
  [pscustomobject]@{ total = $total; passed = $passed; failed = $failed; skipped = $skipped }
}

function Get-FrontendDeclaredTests {
  $matches = rg -n "\b(it|test)\s*\(" "$repoRoot/Front-Snap/src" -g "*.test.ts" -g "*.test.tsx" -g "*.spec.ts" -g "*.spec.tsx" 2>$null
  if ($null -eq $matches) { return 0 }
  return ($matches | Measure-Object).Count
}

function Get-GoDeclaredTests {
  param([string]$ServicePath)
  $matches = rg -n "\bfunc\s+(Test|Example)" $ServicePath -g "*_test.go" 2>$null
  if ($null -eq $matches) { return 0 }
  return ($matches | Measure-Object).Count
}

function Try-GetDockerContainer {
  param([string]$Name)
  try {
    $found = docker ps --format "{{.Names}}" 2>$null | Where-Object { $_ -eq $Name }
    return [bool]$found
  } catch {
    return $false
  }
}

function Invoke-SupabaseHistoryQuery {
  if (-not (Try-GetDockerContainer "supabase_db_local-dev")) {
    return "Local Supabase DB container supabase_db_local-dev is not running or Docker is not accessible."
  }

  $sql = @"
SELECT
  id,
  status,
  job_id,
  report_data->>'scanId' AS scan_id,
  report_data->>'url' AS url,
  report_data->>'siteName' AS site_name,
  report_data->'summary' AS summary,
  EXTRACT(EPOCH FROM (updated_at - created_at))::int AS audit_elapsed_seconds,
  created_at,
  updated_at
FROM audits
WHERE status = 'completed'
  AND report_data IS NOT NULL
ORDER BY updated_at DESC;
"@

  try {
    return ($sql | docker exec -i supabase_db_local-dev psql -U postgres -d postgres 2>&1 | Out-String).Trim()
  } catch {
    return "Supabase history query failed: $($_.Exception.Message)"
  }
}

function Invoke-BenchmarkScan {
  param([string]$Url)

  $started = Get-Date
  $scanId = $null
  $status = "not_started"
  $pages = 0
  $nlpDone = 0
  $kpiAvailable = $false
  $errorMessage = ""

  try {
    $body = @{ url = $Url; max_pages = $MaxPages; headless_concurrency = 1 } | ConvertTo-Json -Compress
    $launch = Invoke-RestMethod -Method Post -Uri "$AggregatorUrl/scan" -ContentType "application/json" -Body $body -TimeoutSec 30
    $scanId = $launch.scan_id
    $deadline = (Get-Date).AddSeconds($BenchmarkTimeoutSeconds)

    while ((Get-Date) -lt $deadline) {
      Start-Sleep -Seconds 3
      $state = Invoke-RestMethod -Method Get -Uri "$AggregatorUrl/scan/$scanId/status" -TimeoutSec 30
      $status = [string]$state.status
      if ($null -ne $state.pages_crawled) { $pages = [int]$state.pages_crawled }
      if ($null -ne $state.pages_nlp_done) { $nlpDone = [int]$state.pages_nlp_done }
      if ($status -in @("complete", "failed")) { break }
    }

    if ($status -eq "complete") {
      try {
        $null = Invoke-RestMethod -Method Get -Uri "$AggregatorUrl/scan/$scanId/kpis/top" -TimeoutSec 30
        $kpiAvailable = $true
      } catch {
        $kpiAvailable = $false
      }
    }
  } catch {
    $errorMessage = $_.Exception.Message
    if (-not $status) { $status = "error" }
  }

  $elapsed = [math]::Round(((Get-Date) - $started).TotalSeconds, 2)
  $pps = if ($elapsed -gt 0 -and $pages -gt 0) { [math]::Round($pages / $elapsed, 3) } else { 0 }

  [pscustomobject]@{
    url = $Url
    scan_id = $scanId
    status = $status
    total_elapsed_seconds = $elapsed
    pages_scanned = $pages
    pages_per_second = $pps
    nlp_pages_done = $nlpDone
    kpi_available = $kpiAvailable
    error = $errorMessage
  }
}

$generatedAt = (Get-Date).ToString("s")
Add-Section "# SnapFlow Validation Metrics Results`n`nGenerated: $generatedAt`n`nSource policy: command output, local Supabase SQL, optional benchmark API polling. Values that cannot be measured are reported as unavailable."

Add-Section "## Environment`n`n| Item | Value |`n|---|---|`n| Repository | $(Escape-MdCell $repoRoot) |`n| GitHub CLI | $(if (Get-Command gh -ErrorAction SilentlyContinue) { 'available' } else { 'not available on PATH' }) |`n| Docker | $(if (Get-Command docker -ErrorAction SilentlyContinue) { 'available' } else { 'not available on PATH' }) |"

$supabaseHistory = Invoke-SupabaseHistoryQuery
Add-Section "## Supabase Historical Audit Evidence`n`nThis query uses product-level audit timestamps. It does not prove internal scanner/NLP/KPI phase durations unless those fields exist in the report payload or audit evidence database.`n`n``````text`n$supabaseHistory`n``````"

if (-not $SkipTests) {
  $testRows = New-Object System.Collections.Generic.List[object]

  $frontendPath = Join-Path $repoRoot "Front-Snap"
  $frontendDeclared = Get-FrontendDeclaredTests
  $frontendRun = Invoke-MetricCommand "Frontend Vitest" $frontendPath "npm" @("test")
  $frontendSummary = Get-TestSummaryCounts $frontendRun.output
  $testRows.Add([pscustomobject]@{
    service = "Frontend"
    command = "npm test"
    collected = if ($null -ne $frontendSummary.total) { $frontendSummary.total } else { $frontendDeclared }
    passed = if ($frontendSummary.skipped -gt 0) { "$($frontendSummary.passed) ($($frontendSummary.skipped) skipped)" } else { $frontendSummary.passed }
    failed = $frontendSummary.failed
    coverage = "not measured"
    elapsed = $frontendRun.elapsed_seconds
    source = "local command"
  }) | Out-Null
  $frontendExcerpt = Get-OutputExcerpt $frontendRun.output
  Add-Section "## Frontend Test Output`n`nExit code: $($frontendRun.exit_code), elapsed seconds: $($frontendRun.elapsed_seconds)`n`n``````text`n$frontendExcerpt`n``````"

  $pythonServices = @(
    @{ name = "Aggregator"; path = "V3-Microservices/v3-aggregator" },
    @{ name = "NLP worker"; path = "V3-Microservices/v3-nlp-worker" },
    @{ name = "Visual regression"; path = "V3-Microservices/v3-visual-regression" },
    @{ name = "Form executor"; path = "V3-Microservices/v3-form-executor" }
  )

  foreach ($svc in $pythonServices) {
    $path = Join-Path $repoRoot $svc.path
    $collect = Invoke-MetricCommand "$($svc.name) collect" $path "python" @("-m", "pytest", "tests", "--collect-only", "-q")
    $run = Invoke-MetricCommand "$($svc.name) tests" $path "python" @("-m", "pytest", "tests", "-q")
    $pf = Get-PytestPassedFailed $run.output
    $testRows.Add([pscustomobject]@{
      service = $svc.name
      command = "python -m pytest tests -q"
      collected = Get-PytestCollectedCount $collect.output
      passed = if ($pf.skipped -gt 0) { "$($pf.passed) ($($pf.skipped) skipped)" } else { $pf.passed }
      failed = $pf.failed
      coverage = "not measured"
      elapsed = $run.elapsed_seconds
      source = "local command"
    }) | Out-Null
  }

  $goServices = @(
    @{ name = "Scanner Go"; path = "V3-Microservices/v3-scanner-go" },
    @{ name = "CLI"; path = "V3-Microservices/v3-cli" }
  )
  foreach ($svc in $goServices) {
    $path = Join-Path $repoRoot $svc.path
    $env:GOCACHE = Join-Path $repoRoot ".tmp-gocache"
    New-Item -ItemType Directory -Force -Path $env:GOCACHE | Out-Null
    $run = Invoke-MetricCommand "$($svc.name) tests" $path "go" @("test", "./...")
    $testRows.Add([pscustomobject]@{
      service = $svc.name
      command = "go test ./..."
      collected = Get-GoDeclaredTests $path
      passed = if ($run.exit_code -eq 0) { "packages passed" } else { "" }
      failed = if ($run.exit_code -eq 0) { 0 } else { "see output" }
      coverage = "not measured"
      elapsed = $run.elapsed_seconds
      source = "local command"
    }) | Out-Null
    $goExcerpt = Get-OutputExcerpt $run.output
    Add-Section "## $($svc.name) Test Output`n`nExit code: $($run.exit_code), elapsed seconds: $($run.elapsed_seconds)`n`n``````text`n$goExcerpt`n``````"
  }

  $table = "| Service | Command | Tests collected | Passed | Failed | Coverage | Execution time (s) | Source |`n|---|---|---:|---:|---:|---|---:|---|"
  foreach ($row in $testRows) {
    $table += "`n| $(Escape-MdCell $row.service) | ``$(Escape-MdCell $row.command)`` | $(Escape-MdCell $row.collected) | $(Escape-MdCell $row.passed) | $(Escape-MdCell $row.failed) | $(Escape-MdCell $row.coverage) | $(Escape-MdCell $row.elapsed) | $(Escape-MdCell $row.source) |"
  }
  Add-Section "## Test Validation Table`n`n$table"
}

if ($RunCoverage) {
  $coverageNotes = @()
  $coverageNotes += "Frontend coverage requires @vitest/coverage-v8 or equivalent Vitest coverage provider."
  $coverageNotes += "Python coverage requires coverage/pytest-cov. If unavailable, install in the measurement environment and rerun."
  $coverageNotes += "Go coverage is available with go test ./... -coverprofile=coverage.out and go tool cover -func=coverage.out."
  Add-Section "## Coverage Measurement Notes`n`n- $($coverageNotes -join "`n- ")"
} else {
  Add-Section "## Coverage Measurement Notes`n`nCoverage was not run in this pass. Use -RunCoverage after adding/ensuring coverage tools are available. Do not report a percentage until generated by coverage output."
}

if ($RunBenchmark) {
  $benchRows = New-Object System.Collections.Generic.List[object]
  foreach ($url in $BenchmarkUrls) {
    $benchRows.Add((Invoke-BenchmarkScan $url)) | Out-Null
  }

  $benchTable = "| URL | Scan ID | Status | Pages | Total duration (s) | Pages/s | NLP pages done | KPI available | Error |`n|---|---|---|---:|---:|---:|---:|---|---|"
  foreach ($row in $benchRows) {
    $benchTable += "`n| $(Escape-MdCell $row.url) | $(Escape-MdCell $row.scan_id) | $(Escape-MdCell $row.status) | $(Escape-MdCell $row.pages_scanned) | $(Escape-MdCell $row.total_elapsed_seconds) | $(Escape-MdCell $row.pages_per_second) | $(Escape-MdCell $row.nlp_pages_done) | $(Escape-MdCell $row.kpi_available) | $(Escape-MdCell $row.error) |"
  }
  Add-Section "## Controlled Scan Benchmark`n`nBenchmark settings: max_pages=$MaxPages, aggregator=$AggregatorUrl, timeout_seconds=$BenchmarkTimeoutSeconds.`n`n$benchTable"
} else {
  Add-Section "## Controlled Scan Benchmark`n`nBenchmark not run in this pass. Start the audit services and rerun with -RunBenchmark to generate the 3-site timing table."
}

$quality = @"
## Quality And Security Metrics

These commands produce the values needed for the quality/security table:

```bash
cd Front-Snap
npx tsc --noEmit
npm run lint
npm audit --audit-level=high
```

```bash
cd V3-Microservices/v3-scanner-go
govulncheck ./...
```

```bash
cd V3-Microservices
docker compose images
```

Use GitHub Actions artifacts for Trivy filesystem/image/config results when `gh` is available.
"@
Add-Section $quality

$content = ($sections -join "`n`n")
Set-Content -Path (Join-Path $repoRoot $OutputPath) -Value $content -Encoding UTF8
Write-Host "Wrote $OutputPath"
