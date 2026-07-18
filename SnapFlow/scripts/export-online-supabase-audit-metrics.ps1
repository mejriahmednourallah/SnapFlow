param(
  [string]$FrontendDir = "Front-Snap",
  [string]$CsvPath = "VALIDATION_SUPABASE_AUDITS.csv",
  [string]$MarkdownPath = "VALIDATION_SUPABASE_AUDITS.md",
  [int]$Limit = 500
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$frontendPath = Join-Path $repoRoot $FrontendDir
$projectRefPath = Join-Path $frontendPath "supabase/.temp/project-ref"
$envPath = Join-Path $frontendPath ".env"

function Read-DotEnvValue {
  param([string]$Path, [string]$Key)
  if (-not (Test-Path $Path)) { return "" }
  $line = Get-Content $Path | Where-Object { $_ -match "^\s*$([regex]::Escape($Key))=" } | Select-Object -Last 1
  if (-not $line) { return "" }
  return (($line -split "=", 2)[1]).Trim().Trim('"').Trim("'")
}

function Get-ServiceRoleKey {
  param([string]$ProjectRef)
  $json = npx supabase projects api-keys --project-ref $ProjectRef -o json
  $keys = $json | ConvertFrom-Json
  $service = $keys | Where-Object { $_.name -eq "service_role" } | Select-Object -First 1
  if (-not $service -or -not $service.api_key) {
    throw "Could not resolve service_role key for Supabase project $ProjectRef."
  }
  return [string]$service.api_key
}

function Escape-Md {
  param([object]$Value)
  if ($null -eq $Value) { return "" }
  return (($Value | Out-String).Trim() -replace "\|", "\|") -replace "`r?`n", " "
}

if (-not (Test-Path $projectRefPath)) {
  throw "Missing Supabase project ref: $projectRefPath"
}

$projectRef = (Get-Content $projectRefPath).Trim()
$supabaseUrl = Read-DotEnvValue $envPath "VITE_SUPABASE_URL"
if (-not $supabaseUrl) {
  $supabaseUrl = "https://$projectRef.supabase.co"
}

$serviceRoleKey = Get-ServiceRoleKey $projectRef
$endpoint = "$supabaseUrl/rest/v1/audits?select=id,status,job_id,created_at,updated_at,report_data&status=eq.completed&report_data=not.is.null&order=updated_at.desc&limit=$Limit"
$headers = @{
  apikey = $serviceRoleKey
  Authorization = "Bearer $serviceRoleKey"
  Accept = "application/json"
}

$rows = Invoke-RestMethod -Method Get -Uri $endpoint -Headers $headers -TimeoutSec 120
if ($null -eq $rows) { $rows = @() }
if ($rows -isnot [System.Array]) { $rows = @($rows) }

$records = foreach ($row in $rows) {
  $report = $row.report_data
  $summary = $report.summary
  $created = [datetimeoffset]$row.created_at
  $updated = [datetimeoffset]$row.updated_at
  $elapsed = [math]::Round(($updated - $created).TotalSeconds, 0)
  $total = $summary.total
  if ($null -eq $total -and $report.kpis) { $total = @($report.kpis).Count }

  [pscustomobject]@{
    audit_id = $row.id
    status = $row.status
    job_id = $row.job_id
    scan_id = $report.scanId
    url = $report.url
    site_name = $report.siteName
    global_score = $report.globalScore
    summary_total = $total
    summary_bugs = $summary.bugs
    summary_recommendations = $summary.recommendations
    summary_compliance = $summary.compliance
    summary_critical = $summary.critical
    summary_high = $summary.high
    summary_medium = $summary.medium
    summary_low = $summary.low
    audit_elapsed_seconds = $elapsed
    created_at = $row.created_at
    updated_at = $row.updated_at
  }
}

$csvFullPath = Join-Path $repoRoot $CsvPath
$mdFullPath = Join-Path $repoRoot $MarkdownPath
$records | Export-Csv -Path $csvFullPath -NoTypeInformation -Encoding UTF8

$count = @($records).Count
$completedWithElapsed = @($records | Where-Object { $_.audit_elapsed_seconds -gt 0 })
$avgElapsed = if ($completedWithElapsed.Count -gt 0) {
  [math]::Round((($completedWithElapsed | Measure-Object audit_elapsed_seconds -Average).Average), 2)
} else { "" }
$maxElapsed = if ($completedWithElapsed.Count -gt 0) {
  ($completedWithElapsed | Measure-Object audit_elapsed_seconds -Maximum).Maximum
} else { "" }

$table = "| Audit | Site | URL | Scan ID | Score | KPIs | Bugs | Reco. | Compliance | Critical | High | Elapsed (s) | Updated |`n"
$table += "|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|"
foreach ($record in @($records | Select-Object -First 30)) {
  $table += "`n| $(Escape-Md $record.audit_id) | $(Escape-Md $record.site_name) | $(Escape-Md $record.url) | $(Escape-Md $record.scan_id) | $(Escape-Md $record.global_score) | $(Escape-Md $record.summary_total) | $(Escape-Md $record.summary_bugs) | $(Escape-Md $record.summary_recommendations) | $(Escape-Md $record.summary_compliance) | $(Escape-Md $record.summary_critical) | $(Escape-Md $record.summary_high) | $(Escape-Md $record.audit_elapsed_seconds) | $(Escape-Md $record.updated_at) |"
}

$markdown = @(
  "# Online Supabase Audit Metrics"
  ""
  "Source: linked Supabase project ``$projectRef``."
  ""
  "This export uses product-level audit metadata from the ``audits`` table. ``audit_elapsed_seconds`` is ``updated_at - created_at``; it is useful for report generation lifecycle timing, but it is not the internal scanner/NLP/KPI phase duration."
  ""
  "| Metric | Value |"
  "|---|---:|"
  "| Completed audits exported | $count |"
  "| Average audit record elapsed seconds | $avgElapsed |"
  "| Maximum audit record elapsed seconds | $maxElapsed |"
  ""
  "## Recent Completed Audits"
  ""
  $table
  ""
  "CSV export: ``$CsvPath``"
) -join "`n"

Set-Content -Path $mdFullPath -Value $markdown -Encoding UTF8

Write-Host "Exported $count online Supabase audit rows."
Write-Host "CSV: $CsvPath"
Write-Host "Markdown: $MarkdownPath"
