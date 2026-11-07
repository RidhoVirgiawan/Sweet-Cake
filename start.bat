@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js tidak ditemukan.
  echo Install Node.js dari https://nodejs.org lalu jalankan file ini lagi.
  pause
  exit /b 1
)

echo ==================================================
echo   Toko Kue Manis Senja
echo   Website : http://127.0.0.1:3000
echo   Tekan Ctrl+C di jendela ini untuk berhenti.
echo ==================================================
echo.

start "" /min powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 2; Start-Process 'http://127.0.0.1:3000'"

node server\server.js

echo.
echo Server berhenti.
pause
