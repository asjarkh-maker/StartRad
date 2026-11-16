# Только да

Онлайн-приглашение на свидание, где ответ — только «да». Кнопка «Нет» убегает.

## Как это работает

1. Создатель собирает приглашение в пошаговом редакторе `/create`: имя, тема, способ открытия (конверт или кнопка), вопрос с фото и стикером, поведение кнопок «Нет» и «Да», экран после «Да», выбор даты и времени, до трёх вопросов с вариантами, финал. Справа — живое превью в телефоне.
2. Страница владельца `/m/<секретный ключ>`: превью, оплата и ссылка для отправки (работает 30 дней), статистика, ответ, правка, подключение Telegram-бота.
3. Получатель открывает `/i/<ссылка>`: конверт, вопрос с убегающей кнопкой «Нет», дата, выбор вариантов, финал.

Публичные страницы: главная, `/dlya-devushki`, `/dlya-parnya`, `/14-fevralya`, `/godovshchina`, `/kak-priglasit-na-svidanie`, `/contacts`, `/payment`, `/oferta`, `/privacy`, `/consent`, а также `/sitemap.xml` и `/robots.txt`.

В тексте приглашения можно использовать подстановки `{имя}`, `{дата}`, `{выбор}`.

## Настройки

Всё настраивается в `data/settings.json` (пример — `settings.example.json`); файл перечитывается сам, перезапуск не нужен. На Windows-сервере удобнее запустить `deploy\settings-windows.ps1` — он откроет файл настроек в Блокноте и после сохранения проверит его:

```powershell
$f="$env:TEMP\tolko-settings.ps1"; iwr https://raw.githubusercontent.com/asjarkh-maker/startrad/feature/constructor/deploy/settings-windows.ps1 -OutFile $f -UseBasicParsing; powershell -ExecutionPolicy Bypass -File $f
```

Обновление сайта на Windows-сервере:

```powershell
$f="$env:TEMP\tolko-update.ps1"; iwr https://raw.githubusercontent.com/asjarkh-maker/startrad/feature/constructor/deploy/update-windows.ps1 -OutFile $f -UseBasicParsing; powershell -ExecutionPolicy Bypass -File $f
```

- **Реквизиты** (`seller`) подставляются в оферту, политику и согласие. Незаполненные поля подсвечены на страницах. Тексты документов — шаблон: проверьте их с юристом.
- **Яндекс Метрика** — `site.metrikaId`.
- **Telegram-бот** — `telegram.token` от @BotFather. Бот работает без вебхука (long polling) и присылает владельцу уведомления об открытии и ответе.
- **ЮKassa** — `yookassa.shopId` и `yookassa.secretKey`. Пока ключей нет, оплата в тестовом режиме (ссылка выдаётся бесплатно). Статус платежа всегда проверяется запросом к API ЮKassa; адрес для уведомлений в кабинете ЮKassa — `https://<домен>/api/yookassa`. Чеки 54-ФЗ — `yookassa.receipt: true`.

Анимированные стикеры — [Noto Emoji Animation](https://googlefonts.github.io/noto-emoji-animation/) (CC BY 4.0), плеер — lottie-web (MIT).

### Автообновление на Windows-сервере

После первой установки или обновления командой выше на сервере появляется задача `TolkoDaAutoUpdate`. Раз в 2 минуты она спрашивает у GitHub номер последней версии ветки `feature/constructor` и, если он новый, сама скачивает её и перезапускает сайт (данные, настройки и домен сохраняются). Журнал — `C:\tolko-da\autoupdate.log`.

Без токена GitHub разрешает 60 запросов в час, поэтому интервал — 2 минуты. Для приватного репозитория положите токен GitHub только на чтение в `C:\tolko-da\data\github-token.txt`.

## Запуск

На Windows: установите [Node.js](https://nodejs.org) (LTS) и дважды щёлкните `start.bat` — сайт откроется на http://localhost:3000.

Из командной строки:

```bash
npm install
npm start          # http://localhost:3000
```

Переменные окружения:

| Переменная     | По умолчанию | Что делает |
|----------------|--------------|------------|
| `PORT`         | `3000`       | порт сервера |
| `PRICE_RUB`    | из настроек  | цена ссылки, ₽ |
| `PAYMENT_MODE` | авто         | `yookassa`, если заданы ключи, иначе `dev` (ссылка сразу, без денег); `off` — всё бесплатно |

Данные хранятся в `data/invites.json`, фото — в `data/uploads/` (в git не попадают).


## Админка

`https://<домен>/admin` — вход по паролю. Здесь задаются токен бота, ключи ЮKassa, контакты, реквизиты, Метрика и цена; всё сохраняется в `data/settings.json` на сервере. Ключи обратно на страницу не выводятся. Первоначальный пароль хранится в `admin.json` только как хеш scrypt; после смены в админке новый хеш лежит в `data/settings.json`.

Открытые данные (контакты, реквизиты) можно также держать в `site.config.json` в репозитории; значения из админки важнее. Секреты в репозиторий не кладутся.

## Установка на сервер (Ubuntu/Debian)

```bash
bash deploy/setup-ubuntu.sh                       # по IP-адресу
bash deploy/setup-ubuntu.sh example.ru me@mail.ru # домен + HTTPS
```

Скрипт ставит Node.js и nginx, запускает сайт как службу `tolko-da` и сам стартует после перезагрузки.

## Установка на Windows-сервер

В PowerShell от администратора, из папки проекта:

```powershell
Set-ExecutionPolicy -Scope Process Bypass -Force
.\deploy\setup-windows.ps1
```

Скрипт ставит Node.js (через winget), открывает порт в брандмауэре и создаёт задачу `TolkoDa`, которая запускает сайт при старте сервера. Сайт будет на порту 80; другой порт задаётся параметром `-Port`.
