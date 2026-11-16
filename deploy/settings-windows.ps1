# Настройки сайта «Только да» без вопросов в терминале.
# Открывает C:\tolko-da\data\settings.json в Блокноте; после закрытия проверяет файл.
# Сайт подхватывает изменения сам, перезапуск не нужен.
$ErrorActionPreference = 'Stop'
$dir = 'C:\tolko-da\data'
$file = Join-Path $dir 'settings.json'
New-Item -ItemType Directory -Force $dir | Out-Null

if (-not (Test-Path $file)) {
  $template = [ordered]@{
    site = [ordered]@{ url = 'https://onlyda.ru'; email = ''; phone = ''; telegram = ''; metrikaId = '' }
    seller = [ordered]@{ status = ''; name = ''; inn = ''; ogrnip = ''; address = '' }
    price = 490; linkDays = 30
    telegram = [ordered]@{ token = '' }
    yookassa = [ordered]@{ shopId = ''; secretKey = ''; receipt = $false; vatCode = 1 }
  }
  [IO.File]::WriteAllText($file, ($template | ConvertTo-Json -Depth 5), (New-Object Text.UTF8Encoding $false))
}

Write-Host 'Открываю настройки в Блокноте. Впишите значения в кавычки, сохраните (Ctrl+S) и закройте Блокнот.'
Start-Process notepad.exe -ArgumentList "`"$file`"" -Wait

try {
  $s = Get-Content $file -Raw -Encoding UTF8 | ConvertFrom-Json
} catch {
  Write-Host ''
  Write-Host 'В файле ошибка: проверьте кавычки и запятые и запустите ещё раз.' -ForegroundColor Red
  Write-Host $_.Exception.Message
  exit 1
}
icacls $file /inheritance:r /grant:r '*S-1-5-18:F' '*S-1-5-32-544:F' | Out-Null
$yes = 'задан'; $no = 'не задан'
Write-Host ''
Write-Host 'Сохранено. Сайт подхватит настройки сам.' -ForegroundColor Green
Write-Host ("  Адрес сайта:   " + $(if ($s.site.url) { $s.site.url } else { $no }))
Write-Host ("  Токен бота:    " + $(if ($s.telegram.token) { $yes } else { $no }))
Write-Host ("  ЮKassa:        " + $(if ($s.yookassa.shopId -and $s.yookassa.secretKey) { 'ключи заданы' } else { 'тестовый режим' }))
Write-Host ("  Реквизиты:     " + $(if ($s.seller.name -and $s.seller.inn) { $yes } else { $no }))
