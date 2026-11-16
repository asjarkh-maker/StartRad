# Tolko da: update on a Windows server (run PowerShell as Administrator).
# Downloads the given (or latest) version into C:\tolko-da, keeps data, domain and Caddy, re-runs setup.
# ASCII only on purpose: Windows PowerShell 5.1 misreads UTF-8 when piped through iex.
param([string]$Sha = '')
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$repo = 'asjarkh-maker/startrad'
$branch = 'feature/constructor'
$dir = 'C:\tolko-da'
$zip = Join-Path $env:TEMP 'tolko-da.zip'
$tmp = Join-Path $env:TEMP 'tolko-da-x'

$headers = @{ 'User-Agent' = 'tolko-da-updater'; 'Accept' = 'application/vnd.github.sha' }
$tokenFile = Join-Path $dir 'data\github-token.txt'
if (Test-Path $tokenFile) { $headers['Authorization'] = 'Bearer ' + (Get-Content $tokenFile -Raw).Trim() }
if (-not $Sha) {
  $Sha = (Invoke-WebRequest "https://api.github.com/repos/$repo/commits/$branch" -Headers $headers -UseBasicParsing).Content.Trim()
}
if ($Sha -notmatch '^[0-9a-f]{40}$') { throw "Unexpected version id: $Sha" }

Write-Host "==> Download $Sha"
$zh = @{ 'User-Agent' = 'tolko-da-updater' }
if ($headers.ContainsKey('Authorization')) {
  $zh['Authorization'] = $headers['Authorization']
  Invoke-WebRequest "https://api.github.com/repos/$repo/zipball/$Sha" -Headers $zh -OutFile $zip -UseBasicParsing
} else {
  Invoke-WebRequest "https://github.com/$repo/archive/$Sha.zip" -Headers $zh -OutFile $zip -UseBasicParsing
}
Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
Expand-Archive $zip $tmp -Force
$src = (Get-ChildItem $tmp -Directory | Select-Object -First 1).FullName
if (-not (Test-Path (Join-Path $src 'server.js'))) { throw 'Downloaded archive has no server.js' }

Write-Host "==> Copy to $dir"
New-Item -ItemType Directory -Force $dir | Out-Null
robocopy $src $dir /MIR /XD data node_modules caddy /XF domain.txt run-server.cmd server.log .deployed-sha autoupdate.log autoupdate.lock /NFL /NDL /NJH /NJS | Out-Null
if ($LASTEXITCODE -ge 8) { throw "Copy failed (robocopy code $LASTEXITCODE)" }
$global:LASTEXITCODE = 0

powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $dir 'deploy\setup-windows.ps1')
if ($LASTEXITCODE -ne 0) { throw "Setup failed (code $LASTEXITCODE)" }
Set-Content -Path (Join-Path $dir '.deployed-sha') -Value $Sha -Encoding ASCII
Write-Host "==> Deployed $Sha"
