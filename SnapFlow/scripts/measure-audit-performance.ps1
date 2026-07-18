param(
  [string]$AggregatorUrl = "http://127.0.0.1:8080",
  [ValidateSet("Supabase", "Csv", "Manual")]
  [string]$ProjectSource = "Supabase",
  [string]$SupabaseUrl = "",
  [string]$SupabaseServiceRoleKey = "",
  [switch]$UseSupabaseCliKey,
  [string]$FrontendDir = "Front-Snap",
  [string]$CsvPath = "",
  [string]$CsvUrlColumn = "url",
  [string[]]$ManualUrls = @(),
  [int]$Limit = 20,
  [int]$MaxPages = 10,
  [int]$HeadlessConcurrency = 1,
  [int]$PollIntervalSeconds = 3,
  [int]$TimeoutSeconds = 1800,
  [int]$ApiProbeRepeats = 5,
  [string]$OutputCsv = "VALIDATION_AUDIT_PERFORMANCE.csv",
  [string]$OutputMarkdown = "VALIDATION_AUDIT_PERFORMANCE.md",
  [string]$PdfCommand = "",
  [string]$PdfWorkingDirectory = "Front-Snap"
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$AggregatorUrl = $AggregatorUrl.TrimEnd("/")

function Read-DotEnvValue {
  param([string]$Path, [string]$Key)
  if (-not (Test-Path $Path)) { return "" }
  $line = Get-Content $Path | Where-Object { $_ -match "^\s*$([regex]::Escape($Key))=" } | Select-Object -Last 1
  if (-not $line) { return "" }
  return (($line -split "=", 2)[1]).Trim().Trim('"').Trim("'")
}

function Get-ServiceRoleKeyFromCli {
  param([string]$ProjectRef)
  $json = npx supabase projects api-keys --project-ref $ProjectRef -o json
  $keys = $json | ConvertFrom-Json
  $service = $keys | Where-Object { $_.name -eq "service_role" } | Select-Object -First 1
  if (-not $service -or -not $service.api_key) {
    throw "Could not resolve service_role key for Supabase project $ProjectRef."
  }
  return [string]$service.api_key
}

function Test-UrlValue {
  param([string]$Value)
  return $Value -match "^https?://"
}

function Escape-Md {
  param([object]$Value)
  if ($null -eq $Value) { return "" }
  return (($Value | Out-String).Trim() -replace "\|", "\|") -replace "`r?`n", " "
}

function Get-PropertyValue {
  param([object]$Object, [string]$Name)
  if ($null -eq $Object) { return $null }
  if ($Object -is [System.Collections.IDictionary] -and $Object.Contains($Name)) { return $Object[$Name] }
  $prop = $Object.PSObject.Properties[$Name]
  if ($prop) { return $prop.Value }
  return $null
}

function Invoke-TimedRest {
  param(
    [ValidateSet("Get", "Post")]
    [string]$Method,
    [string]$Uri,
    [object]$Body = $null,
    [int]$TimeoutSec = 60
  )
  $sw = [Diagnostics.Stopwatch]::StartNew()
  try {
    if ($Method -eq "Post") {
      $json = $Body | ConvertTo-Json -Compress -Depth 10
      $data = Invoke-RestMethod -Method Post -Uri $Uri -ContentType "application/json" -Body $json -TimeoutSec $TimeoutSec
    } else {
      $data = Invoke-RestMethod -Method Get -Uri $Uri -TimeoutSec $TimeoutSec
    }
    $sw.Stop()
    [pscustomobject]@{ ok = $true; data = $data; elapsed_ms = [math]::Round($sw.Elapsed.TotalMilliseconds, 2); error = "" }
  } catch {
    $sw.Stop()
    [pscustomobject]@{ ok = $false; data = $null; elapsed_ms = [math]::Round($sw.Elapsed.TotalMilliseconds, 2); error = $_.Exception.Message }
  }
}

function Invoke-PdfTiming {
  if (-not $PdfCommand) { return $null }
  $workdir = if ([IO.Path]::IsPathRooted($PdfWorkingDirectory)) { $PdfWorkingDirectory } else { Join-Path $repoRoot $PdfWorkingDirectory }
  $sw = [Diagnostics.Stopwatch]::StartNew()
  $old = Get-Location
  try {
    Set-Location $workdir
    $output = powershell -NoProfile -ExecutionPolicy Bypass -Command $PdfCommand 2>&1
    $exitCode = if ($null -ne $LASTEXITCODE) { $LASTEXITCODE } else { 0 }
    $sw.Stop()
    [pscustomobject]@{
      elapsed_seconds = [math]::Round($sw.Elapsed.TotalSeconds, 2)
      exit_code = $exitCode
      output = (($output | Out-String).Trim() -replace "`r?`n", " ")
    }
  } finally {
    Set-Location $old
  }
}

function Get-ProjectTargets {
  if ($ProjectSource -eq "Manual") {
    return @(
      $ManualUrls |
        ForEach-Object { [string]$_ -split "," } |
        ForEach-Object { $_.Trim() } |
        Where-Object { Test-UrlValue $_ } |
        Select-Object -Unique |
        Select-Object -First $Limit |
        ForEach-Object { [pscustomobject]@{ project_id = ""; site_name = ""; url = $_; source = "manual" } }
    )
  }

  if ($ProjectSource -eq "Csv") {
    if (-not $CsvPath) { throw "CsvPath is required when ProjectSource=Csv." }
    $fullCsvPath = if ([IO.Path]::IsPathRooted($CsvPath)) { $CsvPath } else { Join-Path $repoRoot $CsvPath }
    return @(
      Import-Csv $fullCsvPath |
        Where-Object { $_.$CsvUrlColumn -and (Test-UrlValue $_.$CsvUrlColumn) } |
        Select-Object -First $Limit |
        ForEach-Object {
          [pscustomobject]@{
            project_id = if ($_.id) { $_.id } else { "" }
            site_name = if ($_.site_name) { $_.site_name } else { "" }
            url = $_.$CsvUrlColumn
            source = "csv"
          }
        }
    )
  }

  $frontendPath = Join-Path $repoRoot $FrontendDir
  $projectRefPath = Join-Path $frontendPath "supabase/.temp/project-ref"
  $envPath = Join-Path $frontendPath ".env"
  $projectRef = if (Test-Path $projectRefPath) { (Get-Content $projectRefPath).Trim() } else { "" }

  if (-not $SupabaseUrl) {
    $SupabaseUrl = if ($env:SUPABASE_URL) { $env:SUPABASE_URL } else { Read-DotEnvValue $envPath "VITE_SUPABASE_URL" }
  }
  if (-not $SupabaseUrl -and $projectRef) {
    $SupabaseUrl = "https://$projectRef.supabase.co"
  }
  if (-not $SupabaseUrl) { throw "Supabase URL not found. Provide -SupabaseUrl or set SUPABASE_URL/VITE_SUPABASE_URL." }

  if (-not $SupabaseServiceRoleKey) {
    $SupabaseServiceRoleKey = $env:SUPABASE_SERVICE_ROLE_KEY
  }
  if (-not $SupabaseServiceRoleKey -and $UseSupabaseCliKey) {
    if (-not $projectRef) { throw "Missing project ref for Supabase CLI key lookup." }
    $SupabaseServiceRoleKey = Get-ServiceRoleKeyFromCli $projectRef
  }
  if (-not $SupabaseServiceRoleKey) {
    throw "Supabase service role key is required. Set SUPABASE_SERVICE_ROLE_KEY, pass -SupabaseServiceRoleKey, or use -UseSupabaseCliKey."
  }

  $endpoint = "$($SupabaseUrl.TrimEnd('/'))/rest/v1/projects?select=id,site_name,url&url=not.is.null&limit=$Limit"
  $headers = @{
    apikey = $SupabaseServiceRoleKey
    Authorization = "Bearer $SupabaseServiceRoleKey"
    Accept = "application/json"
  }
  $rows = Invoke-RestMethod -Method Get -Uri $endpoint -Headers $headers -TimeoutSec 120
  if ($null -eq $rows) { return @() }
  if ($rows -isnot [System.Array]) { $rows = @($rows) }
  return @(
    $rows |
      Where-Object { $_.url -and (Test-UrlValue $_.url) } |
      Select-Object -First $Limit |
      ForEach-Object { [pscustomobject]@{ project_id = $_.id; site_name = $_.site_name; url = $_.url; source = "supabase" } }
  )
}

function Invoke-AuditBenchmark {
  param([object]$Target)

  $scanStarted = Get-Date
  $statusHistory = New-Object System.Collections.Generic.List[object]
  $statusTimings = New-Object System.Collections.Generic.List[double]
  $scanId = ""
  $status = "not_started"
  $pages = 0
  $nlpDone = 0
  $errorMessage = ""
  $kpiAvailable = $false
  $resultAvailable = $false
  $resultFetchMs = $null
  $kpisTopMs = $null
  $firstRunningAt = $null
  $firstNlpAt = $null
  $finishedAt = $null
  $telemetry = $null

  $launch = Invoke-TimedRest -Method Post -Uri "$AggregatorUrl/scan" -Body @{
    url = $Target.url
    max_pages = $MaxPages
    headless_concurrency = $HeadlessConcurrency
  } -TimeoutSec 60

  if (-not $launch.ok) {
    return [pscustomobject]@{
      project_id = $Target.project_id
      site_name = $Target.site_name
      url = $Target.url
      source = $Target.source
      scan_id = ""
      status = "launch_failed"
      max_pages = $MaxPages
      launch_ms = $launch.elapsed_ms
      api_status_avg_ms = ""
      api_status_max_ms = ""
      result_fetch_ms = ""
      kpis_top_ms = ""
      total_elapsed_seconds = [math]::Round(((Get-Date) - $scanStarted).TotalSeconds, 2)
      acquisition_proxy_seconds = ""
      nlp_processing_proxy_seconds = ""
      pages_scanned = 0
      pages_per_second = 0
      nlp_pages_done = 0
      nlp_pages_per_second = ""
      kpi_available = $false
      result_available = $false
      telemetry_stop_reason = ""
      telemetry_pre_fetch_ms = ""
      telemetry_domain_analysis_ms = ""
      telemetry_crawl_ms = ""
      telemetry_post_crawl_sync_ms = ""
      telemetry_headless_ms = ""
      telemetry_db_wait_ms = ""
      pdf_generation_seconds = ""
      error = $launch.error
    }
  }

  $scanId = [string]$launch.data.scan_id
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)

  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds $PollIntervalSeconds
    $stateCall = Invoke-TimedRest -Method Get -Uri "$AggregatorUrl/scan/$scanId/status" -TimeoutSec 60
    $statusTimings.Add([double]$stateCall.elapsed_ms) | Out-Null
    if (-not $stateCall.ok) {
      $errorMessage = $stateCall.error
      continue
    }

    $now = Get-Date
    $state = $stateCall.data
    $status = [string](Get-PropertyValue $state "status")
    $pagesValue = Get-PropertyValue $state "pages_crawled"
    $nlpValue = Get-PropertyValue $state "pages_nlp_done"
    if ($null -ne $pagesValue) { $pages = [int]$pagesValue }
    if ($null -ne $nlpValue) { $nlpDone = [int]$nlpValue }
    if ($status -eq "running" -and $null -eq $firstRunningAt) { $firstRunningAt = $now }
    if ($status -eq "nlp_processing" -and $null -eq $firstNlpAt) { $firstNlpAt = $now }

    $statusHistory.Add([pscustomobject]@{
      elapsed_seconds = [math]::Round(($now - $scanStarted).TotalSeconds, 2)
      status = $status
      pages_crawled = $pages
      pages_nlp_done = $nlpDone
      api_ms = $stateCall.elapsed_ms
    }) | Out-Null

    if ($status -in @("complete", "failed")) {
      $finishedAt = $now
      break
    }
  }

  if ($null -eq $finishedAt) {
    $finishedAt = Get-Date
    if ($status -notin @("complete", "failed")) { $status = "timeout" }
  }

  if ($status -eq "complete") {
    $resultCall = Invoke-TimedRest -Method Get -Uri "$AggregatorUrl/scan/$scanId/result" -TimeoutSec 120
    $resultFetchMs = $resultCall.elapsed_ms
    $resultAvailable = $resultCall.ok
    if ($resultCall.ok) {
      $telemetry = Get-PropertyValue $resultCall.data "scan_telemetry"
      $resultPages = Get-PropertyValue $resultCall.data "pages_scanned"
      if ($null -ne $resultPages) { $pages = [int]$resultPages }
    } elseif ($resultCall.error) {
      $errorMessage = $resultCall.error
    }

    $kpisCall = Invoke-TimedRest -Method Get -Uri "$AggregatorUrl/scan/$scanId/kpis/top" -TimeoutSec 120
    $kpisTopMs = $kpisCall.elapsed_ms
    $kpiAvailable = $kpisCall.ok
    if (-not $kpisCall.ok -and $kpisCall.error) { $errorMessage = $kpisCall.error }
  }

  $totalElapsed = [math]::Round(($finishedAt - $scanStarted).TotalSeconds, 2)
  $pagesPerSecond = if ($totalElapsed -gt 0 -and $pages -gt 0) { [math]::Round($pages / $totalElapsed, 4) } else { 0 }
  $nlpProxy = if ($null -ne $firstNlpAt) { [math]::Round(($finishedAt - $firstNlpAt).TotalSeconds, 2) } else { "" }
  $acquisitionProxy = if ($null -ne $firstNlpAt) { [math]::Round(($firstNlpAt - $scanStarted).TotalSeconds, 2) } else { "" }
  $nlpPagesPerSecond = if ($nlpProxy -is [double] -and $nlpProxy -gt 0 -and $nlpDone -gt 0) { [math]::Round($nlpDone / $nlpProxy, 4) } else { "" }
  $statusAvg = if ($statusTimings.Count -gt 0) { [math]::Round((($statusTimings | Measure-Object -Average).Average), 2) } else { "" }
  $statusMax = if ($statusTimings.Count -gt 0) { [math]::Round((($statusTimings | Measure-Object -Maximum).Maximum), 2) } else { "" }
  $phase = if ($telemetry) { Get-PropertyValue $telemetry "phase_timings_ms" } else { $null }
  $pdfTiming = Invoke-PdfTiming

  [pscustomobject]@{
    project_id = $Target.project_id
    site_name = $Target.site_name
    url = $Target.url
    source = $Target.source
    scan_id = $scanId
    status = $status
    max_pages = $MaxPages
    launch_ms = $launch.elapsed_ms
    api_status_avg_ms = $statusAvg
    api_status_max_ms = $statusMax
    result_fetch_ms = $resultFetchMs
    kpis_top_ms = $kpisTopMs
    total_elapsed_seconds = $totalElapsed
    acquisition_proxy_seconds = $acquisitionProxy
    nlp_processing_proxy_seconds = $nlpProxy
    pages_scanned = $pages
    pages_per_second = $pagesPerSecond
    nlp_pages_done = $nlpDone
    nlp_pages_per_second = $nlpPagesPerSecond
    kpi_available = $kpiAvailable
    result_available = $resultAvailable
    telemetry_stop_reason = if ($telemetry) { Get-PropertyValue $telemetry "stop_reason" } else { "" }
    telemetry_pre_fetch_ms = if ($phase) { Get-PropertyValue $phase "pre_fetch" } else { "" }
    telemetry_domain_analysis_ms = if ($phase) { Get-PropertyValue $phase "domain_analysis" } else { "" }
    telemetry_crawl_ms = if ($phase) { Get-PropertyValue $phase "crawl" } else { "" }
    telemetry_post_crawl_sync_ms = if ($phase) { Get-PropertyValue $phase "post_crawl_sync" } else { "" }
    telemetry_headless_ms = if ($phase) { Get-PropertyValue $phase "headless" } else { "" }
    telemetry_db_wait_ms = if ($phase) { Get-PropertyValue $phase "db_wait" } else { "" }
    pdf_generation_seconds = if ($pdfTiming) { $pdfTiming.elapsed_seconds } else { "" }
    error = $errorMessage
  }
}

function New-AverageRow {
  param([object[]]$Rows, [string]$Property)
  $values = @($Rows | ForEach-Object { $_.$Property } | Where-Object { $_ -ne "" -and $null -ne $_ })
  if ($values.Count -eq 0) { return "" }
  return [math]::Round((($values | Measure-Object -Average).Average), 2)
}

$healthProbes = for ($i = 1; $i -le $ApiProbeRepeats; $i++) {
  Invoke-TimedRest -Method Get -Uri "$AggregatorUrl/health" -TimeoutSec 30
}
$healthOk = @($healthProbes | Where-Object { $_.ok }).Count
$healthAvgMs = if ($healthOk -gt 0) { [math]::Round((($healthProbes | Where-Object { $_.ok } | Measure-Object elapsed_ms -Average).Average), 2) } else { "" }

$targets = @(Get-ProjectTargets)
if ($targets.Count -eq 0) { throw "No benchmark project URLs found from source $ProjectSource." }

$results = New-Object System.Collections.Generic.List[object]
foreach ($target in $targets) {
  Write-Host "Benchmarking $($target.url)"
  $results.Add((Invoke-AuditBenchmark $target)) | Out-Null
}

$csvFullPath = Join-Path $repoRoot $OutputCsv
$mdFullPath = Join-Path $repoRoot $OutputMarkdown
$results | Export-Csv -Path $csvFullPath -NoTypeInformation -Encoding UTF8

$successful = @($results | Where-Object { $_.status -eq "complete" })
$summary = [pscustomobject]@{
  generated_at = (Get-Date).ToString("s")
  source = $ProjectSource
  target_count = $targets.Count
  completed_count = $successful.Count
  failed_or_timeout_count = $results.Count - $successful.Count
  max_pages = $MaxPages
  health_probe_ok = "$healthOk/$ApiProbeRepeats"
  avg_health_response_ms = $healthAvgMs
  avg_audit_duration_seconds = New-AverageRow $successful "total_elapsed_seconds"
  avg_pages_scanned = New-AverageRow $successful "pages_scanned"
  avg_pages_per_second = New-AverageRow $successful "pages_per_second"
  avg_nlp_processing_proxy_seconds = New-AverageRow $successful "nlp_processing_proxy_seconds"
  avg_result_fetch_ms = New-AverageRow $successful "result_fetch_ms"
  avg_kpis_top_ms = New-AverageRow $successful "kpis_top_ms"
  avg_pdf_generation_seconds = New-AverageRow $successful "pdf_generation_seconds"
}

$table = "| Site | URL | Status | Pages | Duration (s) | Pages/s | NLP proxy (s) | Result API (ms) | KPI API (ms) | PDF (s) | Scan ID |`n"
$table += "|---|---|---|---:|---:|---:|---:|---:|---:|---:|---|"
foreach ($row in $results) {
  $table += "`n| $(Escape-Md $row.site_name) | $(Escape-Md $row.url) | $(Escape-Md $row.status) | $(Escape-Md $row.pages_scanned) | $(Escape-Md $row.total_elapsed_seconds) | $(Escape-Md $row.pages_per_second) | $(Escape-Md $row.nlp_processing_proxy_seconds) | $(Escape-Md $row.result_fetch_ms) | $(Escape-Md $row.kpis_top_ms) | $(Escape-Md $row.pdf_generation_seconds) | $(Escape-Md $row.scan_id) |"
}

$summaryTable = "| Metric | Value |`n|---|---:|"
foreach ($prop in $summary.PSObject.Properties) {
  $summaryTable += "`n| $(Escape-Md $prop.Name) | $(Escape-Md $prop.Value) |"
}

$markdown = @(
  "# SnapFlow Audit Performance Benchmark"
  ""
  "This file is generated from real API calls against ``$AggregatorUrl`` and project URLs from ``$ProjectSource``."
  ""
  "Important: ``nlp_processing_proxy_seconds`` is measured from the first observed ``nlp_processing`` status until terminal status. It is a polling-based proxy, not a database-internal per-page NLP timer. Internal scanner phase timings are exported in the CSV when ``scan_telemetry.phase_timings_ms`` is present."
  ""
  "PDF timing is included only when ``-PdfCommand`` is provided. Otherwise the column is intentionally empty."
  ""
  "## Summary"
  ""
  $summaryTable
  ""
  "## Per-Project Results"
  ""
  $table
  ""
  "CSV export: ``$OutputCsv``"
) -join "`n"

Set-Content -Path $mdFullPath -Value $markdown -Encoding UTF8
Write-Host "Wrote $OutputCsv"
Write-Host "Wrote $OutputMarkdown"
