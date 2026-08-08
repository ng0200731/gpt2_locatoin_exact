@echo off
REM Launch the Bag Region Compositor - starts the local proxy and opens the app.
REM Local proxy must run over HTTP so the page can fetch ./local.key on boot.

cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [start] Node.js not found on PATH. Install it from https://nodejs.org/ then re-run.
  pause
  exit /b 1
)

if not exist node_modules (
  echo [start] Installing dependencies first run only...
  call npm install
  if errorlevel 1 (
    echo [start] npm install failed.
    pause
    exit /b 1
  )
)

if not exist local.key (
  echo [start] WARNING: local.key not found. Put your API key sk-... in a file
  echo        named "local.key" in this folder, or paste it manually on the page.
  echo.
)

echo [start] Starting proxy on http://localhost:3001 ...
start "" http://localhost:3001/bag-compositor.html

node proxy.js
