# Обновление сайта «Только да» на Windows-сервере одной командой.
# Запускать в PowerShell ОТ АДМИНИСТРАТОРА. Скачивает свежую версию с GitHub в C:\tolko-da,
# сохраняет данные (папка data) и перезапускает сайт.
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$branch = 'feature/constructor'
$dir = 'C:\tolko-da'
$zip = Join-Path $env:TEMP 'tolko-da.zip'
$tmp = Join-Path $env:TEMP 'tolko-da-x'

Write-Host '==> Скачиваю новую версию'
Invoke-WebRequest "https://github.com/asjarkh-maker/startrad/archive/refs/heads/$branch.zip" -OutFile $zip -UseBasicParsing
Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
Expand-Archive $zip $tmp -Force
$src = (Get-ChildItem $tmp -Directory | Select-Object -First 1).FullName

Write-Host "==> Копирую в $dir"
New-Item -ItemType Directory -Force $dir | Out-Null
robocopy $src $dir /MIR /XD data node_modules caddy /XF domain.txt run-server.cmd server.log /NFL /NDL /NJH /NJS | Out-Null
if ($LASTEXITCODE -ge 8) { throw "Не удалось скопировать файлы (robocopy: $LASTEXITCODE)" }

powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $dir 'deploy\setup-windows.ps1')
