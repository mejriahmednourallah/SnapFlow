param([Parameter(Mandatory=$true)][string]$ExportDirectory)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$protected = [IO.File]::ReadAllBytes((Join-Path $ExportDirectory 'migration-key.dpapi'))
$key = [Security.Cryptography.ProtectedData]::Unprotect($protected, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
try {
    $keyText = [Text.Encoding]::ASCII.GetString($key)
    $decoded = [Convert]::FromBase64String($keyText.Replace('-', '+').Replace('_', '/'))
    try {
        if ($decoded.Length -ne 32) { throw 'Unexpected export key format' }
        Set-Clipboard -Value $keyText
        Write-Host 'Export key copied. Paste into the hidden Wetty prompt, then clear the clipboard with Set-Clipboard -Value "".'
    } finally {
        [Array]::Clear($decoded, 0, $decoded.Length)
    }
} finally {
    $keyText = $null
    [Array]::Clear($key, 0, $key.Length)
}
