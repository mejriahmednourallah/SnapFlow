<#
Compact Docker's existing WSL data disk after image/cache pruning.
Preserves images, containers and volumes. Requires a Windows administrator.
#>
param(
    [Parameter(Mandatory=$true)][string]$DockerDiskPath,
    [Parameter(Mandatory=$true)][string]$OutputDirectory
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$taskPrincipal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $taskPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Windows administrator rights are required for disk compaction.'
}
$taskDisk = (Resolve-Path -LiteralPath $DockerDiskPath).Path
if ([IO.Path]::GetFileName($taskDisk) -ne 'docker_data.vhdx' -or
    $taskDisk -notlike '*\Docker\wsl\disk\docker_data.vhdx') {
    throw 'Target must be the existing Docker WSL data disk.'
}
$taskOutput = (Resolve-Path -LiteralPath $OutputDirectory).Path
$taskBefore = (Get-Item -LiteralPath $taskDisk).Length
$taskResult = Join-Path $taskOutput 'docker-compaction-result.json'
try {
    & docker desktop stop --timeout 60
    if ($LASTEXITCODE -ne 0) { throw 'Docker Desktop did not stop; disk was not compacted.' }
    $taskRunning = (& wsl --list --running --quiet | Out-String) -replace "`0", ''
    if ($taskRunning -match 'docker-desktop') {
        & wsl --terminate docker-desktop
        if ($LASTEXITCODE -ne 0) { throw 'Docker VM did not stop; disk was not compacted.' }
    }
    # Prove that the selected disk is detached before sending it to DiskPart.
    $taskProbe = [IO.File]::Open($taskDisk, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::None)
    $taskProbe.Dispose()
    $taskCommands = Join-Path $taskOutput 'docker-compaction.diskpart.txt'
    @(('select vdisk file="'+$taskDisk+'"'), 'compact vdisk', 'exit') |
        Set-Content -LiteralPath $taskCommands -Encoding ASCII
    & diskpart /s $taskCommands | Out-File -LiteralPath (Join-Path $taskOutput 'docker-compaction.log')
    if ($LASTEXITCODE -ne 0) { throw 'DiskPart failed; inspect docker-compaction.log.' }
    $taskAfter = (Get-Item -LiteralPath $taskDisk).Length
    @{disk=$taskDisk; before_bytes=$taskBefore; after_bytes=$taskAfter;
      reduced_bytes=($taskBefore-$taskAfter); completed_at=(Get-Date).ToString('o')} |
        ConvertTo-Json | Set-Content -LiteralPath $taskResult -Encoding UTF8
} catch {
    @{disk=$taskDisk; before_bytes=$taskBefore; error=$_.Exception.Message} |
        ConvertTo-Json | Set-Content -LiteralPath $taskResult -Encoding UTF8
    throw
}
