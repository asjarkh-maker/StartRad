# Установка сайта «Только да» на Windows-сервер.
# Запускать в PowerShell ОТ АДМИНИСТРАТОРА, из папки проекта:
#   Set-ExecutionPolicy -Scope Process Bypass -Force
#   .\deploy\setup-windows.ps1            # сайт на порту 80: http://IP-адрес/
#   .\deploy\setup-windows.ps1 -Port 3000 # другой порт
#   .\deploy\setup-windows.ps1 -Domain onlyda.ru # домен с HTTPS (Caddy, бесплатный сертификат)
# Домен запоминается в файле domain.txt рядом с проектом: повторный запуск и обновление его сохраняют.
# Повторный запуск безопасен: обновит службу и перезапустит сайт.
param([int]$Port = 80, [string]$Domain = '')
$ErrorActionPreference = 'Stop'

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) { throw 'Запустите PowerShell от имени администратора.' }

$app = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path (Join-Path $app 'server.js'))) { throw "Не найден server.js в $app" }

$domainFile = Join-Path $app 'domain.txt'
if ($Domain) { $Domain.Trim().ToLower() | Set-Content -Encoding ASCII $domainFile }
elseif (Test-Path $domainFile) { $Domain = (Get-Content $domainFile -Raw).Trim().ToLower() }
if ($Domain -and $Domain -notmatch '^[a-z0-9.-]+\.[a-z]{2,}$') { throw "Странный домен: $Domain" }
# с доменом сайт слушает внутренний порт 3000, а наружу 80/443 отдаёт Caddy с HTTPS
$sitePort = if ($Domain) { 3000 } else { $Port }

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
set PORT=$sitePort
set PAYMENT_MODE=dev
"$node" server.js >> server.log 2>&1
"@ | Set-Content -Encoding ASCII $runCmd

Write-Host '==> Брандмауэр'
Get-NetFirewallRule -DisplayName 'TolkoDa' -ErrorAction SilentlyContinue | Remove-NetFirewallRule
$open = if ($Domain) { @(80, 443) } else { @($Port) }
New-NetFirewallRule -DisplayName 'TolkoDa' -Direction Inbound -Action Allow -Protocol TCP -LocalPort $open | Out-Null

Write-Host '==> Автозапуск'
Stop-ScheduledTask -TaskName 'TolkoDa' -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*server.js*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 1
Unregister-ScheduledTask -TaskName 'TolkoDa' -Confirm:$false -ErrorAction SilentlyContinue
$action    = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c `"$runCmd`"" -WorkingDirectory $app
$trigger   = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$settings  = New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName 'TolkoDa' -Action $action -Trigger $trigger -Principal $principal -Settings $settings | Out-Null
Start-ScheduledTask -TaskName 'TolkoDa'

if ($Domain) {
  Write-Host "==> HTTPS для $Domain (Caddy)"
  $caddyDir = Join-Path $app 'caddy'
  New-Item -ItemType Directory -Force $caddyDir | Out-Null
  $caddy = Join-Path $caddyDir 'caddy.exe'
  Stop-ScheduledTask -TaskName 'TolkoDaCaddy' -ErrorAction SilentlyContinue
  Get-Process caddy -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  if (-not (Test-Path $caddy)) {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest 'https://caddyserver.com/api/download?os=windows&arch=amd64' -OutFile $caddy -UseBasicParsing
  }
  @"
$Domain, www.$Domain {
	encode gzip
	reverse_proxy 127.0.0.1:3000
}
"@ | Set-Content -Encoding ASCII (Join-Path $caddyDir 'Caddyfile')
  $cRun = Join-Path $caddyDir 'run-caddy.cmd'
  @"
@echo off
cd /d "$caddyDir"
"$caddy" run --config Caddyfile --adapter caddyfile >> caddy.log 2>&1
"@ | Set-Content -Encoding ASCII $cRun
  Unregister-ScheduledTask -TaskName 'TolkoDaCaddy' -Confirm:$false -ErrorAction SilentlyContinue
  $cAction = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c `"$cRun`"" -WorkingDirectory $caddyDir
  Register-ScheduledTask -TaskName 'TolkoDaCaddy' -Action $cAction -Trigger $trigger -Principal $principal -Settings $settings | Out-Null
  Start-ScheduledTask -TaskName 'TolkoDaCaddy'
}

Write-Host '==> Автообновление (каждые 2 минуты)'
$auto = Join-Path $app 'deploy\autoupdate-windows.ps1'
if ((Test-Path $auto) -and ($app -eq 'C:\tolko-da') -and (Get-ScheduledTask -TaskName 'TolkoDaAutoUpdate' -ErrorAction SilentlyContinue)) {
  # задача уже есть; не трогаем её — обновление может идти прямо из неё
  Write-Host '    Уже включено. Журнал: C:\tolko-da\autoupdate.log'
} elseif ((Test-Path $auto) -and ($app -eq 'C:\tolko-da')) {
  $aAction  = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$auto`""
  $aTrigger = New-ScheduledTaskTrigger -Once -At ((Get-Date).AddMinutes(1)) -RepetitionInterval (New-TimeSpan -Minutes 2) -RepetitionDuration (New-TimeSpan -Days 3650)
  $aSettings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 20) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
  Register-ScheduledTask -TaskName 'TolkoDaAutoUpdate' -Action $aAction -Trigger $aTrigger -Principal $principal -Settings $aSettings | Out-Null
  Write-Host '    Сайт будет сам обновляться с GitHub. Журнал: C:\tolko-da\autoupdate.log'
} else {
  Write-Host '    Пропущено: автообновление работает, когда сайт установлен в C:\tolko-da'
}

Write-Host '==> Проверка'
Start-Sleep -Seconds 4
try {
  $r = Invoke-WebRequest "http://localhost:$sitePort/" -UseBasicParsing -TimeoutSec 10
  Write-Host "Готово. Ответ сайта: HTTP $($r.StatusCode)"
} catch {
  Write-Host "Сайт пока не отвечает. Смотрите журнал: $app\server.log"
}
$ip = try { (Invoke-RestMethod 'https://api.ipify.org' -TimeoutSec 5) } catch { '<IP-адрес сервера>' }
$suffix = if ($Port -eq 80) { '' } else { ":$Port" }
if ($Domain) {
  Write-Host "Откройте: https://$Domain/"
  Write-Host "Сертификат выпускается сам, когда домен указывает на $ip. Журнал: $app\caddy\caddy.log"
} else {
  Write-Host "Откройте: http://$ip$suffix/"
}
