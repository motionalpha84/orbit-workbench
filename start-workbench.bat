@echo off
setlocal

set "APP_DIR=%~dp0"
cd /d "%APP_DIR%"

if not defined PORT set "PORT=4173"
if not defined OPEN_BROWSER set "OPEN_BROWSER=1"
set "HOST=127.0.0.1"
set "URL=http://%HOST%:%PORT%"

set "BUNDLED_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if exist "%BUNDLED_NODE%" (
  set "NODE_EXE=%BUNDLED_NODE%"
) else (
  where node >nul 2>nul
  if errorlevel 1 (
    echo [ERROR] Node.js was not found.
    echo Install Node.js, or run this project from the Codex desktop environment.
    echo.
    pause
    exit /b 1
  )
  set "NODE_EXE=node"
)

echo.
echo ECI Orbit Workbench
echo URL: %URL%
echo Press Ctrl+C to stop the server.
echo.

if not "%OPEN_BROWSER%"=="0" (
  start "" /min powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Sleep -Milliseconds 800; Start-Process '%URL%'"
)
"%NODE_EXE%" server.mjs
set "EXIT_CODE=%ERRORLEVEL%"

echo.
if not "%EXIT_CODE%"=="0" (
  echo [ERROR] Server stopped with exit code %EXIT_CODE%.
) else (
  echo Server stopped.
)
pause
exit /b %EXIT_CODE%
