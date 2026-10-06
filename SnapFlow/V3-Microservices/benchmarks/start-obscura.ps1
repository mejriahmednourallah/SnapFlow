$ErrorActionPreference = 'Stop'
$tokenBytes = New-Object byte[] 32
$generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$generator.GetBytes($tokenBytes)
$generator.Dispose()
$benchmarkToken = ([BitConverter]::ToString($tokenBytes)).Replace('-', '').ToLowerInvariant()
$envPath = Join-Path $PSScriptRoot 'obscura.env'
@("OBSCURA_CDP_TOKEN=$benchmarkToken", 'OBSCURA_ALLOW_PRIVATE_NETWORK=1') | Set-Content -LiteralPath $envPath -Encoding ASCII
docker run -d --name snapflow-obscura-auth-benchmark -p 127.0.0.1:9222:9222 --env-file $envPath h4ckf0r0day/obscura@sha256:475def3ddf1ec513b3d1bc36e8ad15f0d192538cb15f814c77215aa70c418ca2
if ($LASTEXITCODE -ne 0) { throw 'Obscura benchmark container failed to start' }
