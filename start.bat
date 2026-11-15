@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js не найден. Сейчас откроется страница загрузки.
  echo Установите версию LTS, затем запустите этот файл снова.
  start "" https://nodejs.org
  pause
  exit /b 1
)
if not exist node_modules (
  echo Устанавливаю зависимости, это один раз...
  call npm install
)
start "" cmd /c "timeout /t 2 >nul & start http://localhost:3000"
echo Сайт запущен: http://localhost:3000  (чтобы остановить, закройте это окно)
node server.js
pause
