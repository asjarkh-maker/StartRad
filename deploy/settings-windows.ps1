# Настройки сайта «Только да»: реквизиты, контакты, Метрика, Telegram-бот, ЮKassa.
# Запускать в PowerShell на сервере. Спрашивает по очереди; Enter — оставить как есть.
# Ключи вводятся здесь, на сервере, и сохраняются в C:\tolko-da\data\settings.json.
$ErrorActionPreference = 'Stop'
$dir = 'C:\tolko-da\data'
$file = Join-Path $dir 'settings.json'
New-Item -ItemType Directory -Force $dir | Out-Null
$cur = if (Test-Path $file) { Get-Content $file -Raw -Encoding UTF8 | ConvertFrom-Json } else { [pscustomobject]@{} }

function Get-Cur($path) {
  $o = $cur
  foreach ($k in $path.Split('.')) { if ($null -eq $o) { return '' }; $o = $o.$k }
  if ($null -eq $o) { '' } else { "$o" }
}
function Ask($path, $label, [switch]$Secret) {
  $old = Get-Cur $path
  $shown = if ($Secret -and $old) { '(задан, Enter — оставить)' } elseif ($old) { "[$old]" } else { '' }
  if ($Secret) {
    $sec = Read-Host "$label $shown" -AsSecureString
    $v = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
  } else { $v = Read-Host "$label $shown" }
  if ([string]::IsNullOrWhiteSpace($v)) { $old } else { $v.Trim() }
}

Write-Host '== Сайт и контакты =='
$site = [ordered]@{
  url       = Ask 'site.url' 'Адрес сайта (например https://onlyda.ru)'
  email     = Ask 'site.email' 'Почта поддержки'
  phone     = Ask 'site.phone' 'Телефон (можно пусто)'
  telegram  = Ask 'site.telegram' 'Telegram поддержки, @имя (можно пусто)'
  metrikaId = Ask 'site.metrikaId' 'Номер счётчика Яндекс Метрики (можно пусто)'
}
Write-Host '== Исполнитель (для оферты и политики) =='
$seller = [ordered]@{
  status  = Ask 'seller.status' 'Статус: самозанятый или ИП'
  name    = Ask 'seller.name' 'ФИО полностью'
  inn     = Ask 'seller.inn' 'ИНН'
  ogrnip  = Ask 'seller.ogrnip' 'ОГРНИП (только для ИП)'
  address = Ask 'seller.address' 'Адрес (только для ИП)'
}
Write-Host '== Цена =='
$price = (Ask 'price' 'Цена ссылки, рублей') -replace '\D', ''
if (-not $price) { $price = '490' }
Write-Host '== Telegram-бот (токен от @BotFather) =='
$tg = [ordered]@{ token = Ask 'telegram.token' 'Токен бота' -Secret }
Write-Host '== ЮKassa (личный кабинет → Интеграция → Ключи API) =='
$shop = Ask 'yookassa.shopId' 'shopId'
$key = Ask 'yookassa.secretKey' 'Секретный ключ' -Secret
$rcOld = Get-Cur 'yookassa.receipt'
$rc = Read-Host "Отправлять чеки через ЮKassa (54-ФЗ)? да/нет [$(if ($rcOld -eq 'True') { 'да' } else { 'нет' })]"
$receipt = if ($rc) { $rc.Trim().ToLower() -in @('да', 'y', 'yes', 'д') } else { $rcOld -eq 'True' }

$out = [ordered]@{
  site = $site; seller = $seller; price = [int]$price; linkDays = 30; telegram = $tg
  yookassa = [ordered]@{ shopId = $shop; secretKey = $key; receipt = $receipt; vatCode = 1 }
}
$json = $out | ConvertTo-Json -Depth 5
[IO.File]::WriteAllText($file, $json, (New-Object Text.UTF8Encoding $false))
# файл с ключами — только для администраторов и системы
icacls $file /inheritance:r /grant:r '*S-1-5-18:F' '*S-1-5-32-544:F' | Out-Null  # SYSTEM и группа администраторов (по SID — работает на русской Windows)
Write-Host ''
Write-Host "Сохранено в $file. Сайт подхватит настройки сам, перезапуск не нужен."
if ($shop -and $key) { Write-Host 'Оплата: ЮKassa. В кабинете ЮKassa укажите адрес для уведомлений: <адрес сайта>/api/yookassa' }
else { Write-Host 'Оплата: тестовый режим (ссылка выдаётся бесплатно), пока не заданы ключи ЮKassa.' }
