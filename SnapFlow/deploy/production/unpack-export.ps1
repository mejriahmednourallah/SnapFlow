param([Parameter(Mandatory=$true)][string]$ExportDirectory,
      [Parameter(Mandatory=$true)][string]$RuntimeDirectory)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$protected = [IO.File]::ReadAllBytes((Join-Path $ExportDirectory 'migration-key.dpapi'))
$key = [Security.Cryptography.ProtectedData]::Unprotect($protected, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
try {
    [Text.Encoding]::ASCII.GetString($key) | python "$PSScriptRoot/rehearse.py" decrypt --runtime $RuntimeDirectory --export $ExportDirectory
    if ($LASTEXITCODE -ne 0) { throw 'Export decryption failed' }
} finally {
    [Array]::Clear($key, 0, $key.Length)
}
