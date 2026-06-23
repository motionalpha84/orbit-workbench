@echo off
setlocal

set "APP_DIR=%~dp0"
cd /d "%APP_DIR%"

if not defined PORT set "PORT=4173"
if not defined API_PORT set "API_PORT=26563"
if not defined OPEN_BROWSER set "OPEN_BROWSER=1"
set "HOST=127.0.0.1"
set "URL=http://%HOST%:%PORT%"
rem Default frontend URL: http://127.0.0.1:4173

where npm >nul 2>nul
if errorlevel 1 (
  echo [ERROR] npm was not found.
  echo Install Node.js, or run this project from the Codex desktop environment.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Installing npm dependencies...
  npm install
  if errorlevel 1 (
    echo [ERROR] npm install failed.
    pause
    exit /b 1
  )
)

echo.
echo ECI Orbit Workbench
echo Frontend: %URL%
echo Backend:  http://%HOST%:%API_PORT%
echo Press Ctrl+C to stop both services.
echo.

if not "%OPEN_BROWSER%"=="0" (
  start "" /min powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Sleep -Milliseconds 1200; Start-Process '%URL%'"
)

npm run dev
set "EXIT_CODE=%ERRORLEVEL%"

echo.
if not "%EXIT_CODE%"=="0" (
  echo [ERROR] Workbench stopped with exit code %EXIT_CODE%.
) else (
  echo Workbench stopped.
)
pause
exit /b %EXIT_CODE%
