# Tolko da: one-command update on a Windows server (run PowerShell as Administrator).
# Downloads the latest version into C:\tolko-da, keeps data, domain and Caddy, re-runs setup.
# ASCII only on purpose: Windows PowerShell 5.1 misreads UTF-8 when piped through iex.
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$branch = 'feature/constructor'
$dir = 'C:\tolko-da'
$zip = Join-Path $env:TEMP 'tolko-da.zip'
$tmp = Join-Path $env:TEMP 'tolko-da-x'

Write-Host '==> Download'
Invoke-WebRequest "https://github.com/asjarkh-maker/startrad/archive/refs/heads/$branch.zip" -OutFile $zip -UseBasicParsing
Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
Expand-Archive $zip $tmp -Force
$src = (Get-ChildItem $tmp -Directory | Select-Object -First 1).FullName

Write-Host "==> Copy to $dir"
New-Item -ItemType Directory -Force $dir | Out-Null
robocopy $src $dir /MIR /XD data node_modules caddy /XF domain.txt run-server.cmd server.log /NFL /NDL /NJH /NJS | Out-Null
if ($LASTEXITCODE -ge 8) { throw "Copy failed (robocopy code $LASTEXITCODE)" }
$global:LASTEXITCODE = 0

powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $dir 'deploy\setup-windows.ps1')
