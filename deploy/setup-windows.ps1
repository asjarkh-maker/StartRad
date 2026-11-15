# Установка сайта «Только да» на Windows-сервер.
# Запускать в PowerShell ОТ АДМИНИСТРАТОРА, из папки проекта:
#   Set-ExecutionPolicy -Scope Process Bypass -Force
#   .\deploy\setup-windows.ps1            # сайт на порту 80: http://IP-адрес/
#   .\deploy\setup-windows.ps1 -Port 3000 # другой порт
# Повторный запуск безопасен: обновит службу и перезапустит сайт.
param([int]$Port = 80)
$ErrorActionPreference = 'Stop'

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) { throw 'Запустите PowerShell от имени администратора.' }

$app = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path (Join-Path $app 'server.js'))) { throw "Не найден server.js в $app" }

function Refresh-Path {
  $env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
}

Write-Host '==> Node.js'
Refresh-Path
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    throw 'Установите Node.js LTS вручную с https://nodejs.org и запустите скрипт снова.'
  }
  winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
  Refresh-Path
}
$node = (Get-Command node).Source
Write-Host "    $node"

Write-Host '==> Зависимости'
Set-Location $app
npm ci --omit=dev
if ($LASTEXITCODE -ne 0) { throw 'npm ci не удался' }
New-Item -ItemType Directory -Force (Join-Path $app 'data') | Out-Null

Write-Host '==> Файл запуска'
$runCmd = Join-Path $app 'run-server.cmd'
@"
@echo off
cd /d "$app"
set PORT=$Port
set PAYMENT_MODE=dev
"$node" server.js >> server.log 2>&1
"@ | Set-Content -Encoding ASCII $runCmd

Write-Host '==> Брандмауэр'
Get-NetFirewallRule -DisplayName 'TolkoDa' -ErrorAction SilentlyContinue | Remove-NetFirewallRule
New-NetFirewallRule -DisplayName 'TolkoDa' -Direction Inbound -Action Allow -Protocol TCP -LocalPort $Port | Out-Null

Write-Host '==> Автозапуск'
Stop-ScheduledTask -TaskName 'TolkoDa' -ErrorAction SilentlyContinue
Get-Process node -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $node -and $_.CommandLine -like '*server.js*' } | Stop-Process -Force -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName 'TolkoDa' -Confirm:$false -ErrorAction SilentlyContinue
$action    = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c `"$runCmd`"" -WorkingDirectory $app
$trigger   = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$settings  = New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName 'TolkoDa' -Action $action -Trigger $trigger -Principal $principal -Settings $settings | Out-Null
Start-ScheduledTask -TaskName 'TolkoDa'

Write-Host '==> Проверка'
Start-Sleep -Seconds 4
try {
  $r = Invoke-WebRequest "http://localhost:$Port/" -UseBasicParsing -TimeoutSec 10
  Write-Host "Готово. Ответ сайта: HTTP $($r.StatusCode)"
} catch {
  Write-Host "Сайт пока не отвечает. Смотрите журнал: $app\server.log"
}
$ip = try { (Invoke-RestMethod 'https://api.ipify.org' -TimeoutSec 5) } catch { '<IP-адрес сервера>' }
$suffix = if ($Port -eq 80) { '' } else { ":$Port" }
Write-Host "Откройте: http://$ip$suffix/"
