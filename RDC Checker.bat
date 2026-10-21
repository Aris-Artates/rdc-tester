@echo off
title RDC Checker
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Install the LTS version from https://nodejs.org and run this again.
  pause
  exit /b 1
)

if not exist node_modules (
  echo First run: installing packages...
  call npm install --no-audit --no-fund || goto :fail
)
if not exist "%LOCALAPPDATA%\ms-playwright\chromium-1140" (
  echo First run: downloading the test browser ^(one time, about 150 MB^)...
  call npx playwright install chromium || goto :fail
)
if not exist .env (
  copy /y .env.example .env >nul
  echo Created .env from .env.example - fill it in on the Settings tab.
)

echo Starting the RDC Checker. Keep this window open while you use it; close it to stop.
node src\ui\server.js
pause
exit /b 0

:fail
echo Setup failed. See the messages above.
pause
exit /b 1
