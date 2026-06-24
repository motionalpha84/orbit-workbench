@echo off
setlocal

set "APP_DIR=%~dp0"
cd /d "%APP_DIR%"

if not defined PORT set "PORT=4173"
if not defined API_PORT set "API_PORT=26563"
if not defined OPEN_BROWSER set "OPEN_BROWSER=1"
set "HOST=127.0.0.1"
set "URL=http://%HOST%:%PORT%"
set "BUNDLED_NODE_DIR=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin"
set "BUNDLED_PNPM=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\pnpm.cmd"
for %%I in ("%APP_DIR%..\..") do set "PROJECT_USERPROFILE=%%~fI"
if not exist "%BUNDLED_NODE_DIR%\node.exe" (
  if exist "%PROJECT_USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" (
    set "BUNDLED_NODE_DIR=%PROJECT_USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin"
  )
)
if not exist "%BUNDLED_PNPM%" (
  if exist "%PROJECT_USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\pnpm.cmd" (
    set "BUNDLED_PNPM=%PROJECT_USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\pnpm.cmd"
  )
)
rem Default frontend URL: http://127.0.0.1:4173
rem Equivalent command: npm run dev

where node >nul 2>nul
if errorlevel 1 (
  if exist "%BUNDLED_NODE_DIR%\node.exe" (
    set "PATH=%BUNDLED_NODE_DIR%;%PATH%"
  )
)

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js was not found.
  echo Install Node.js, or run this project from the Codex desktop environment.
  echo.
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  if exist "%BUNDLED_PNPM%" (
    set "PM_EXE=%BUNDLED_PNPM%"
  ) else (
    where pnpm >nul 2>nul
    if errorlevel 1 (
      set "PM_EXE="
    ) else (
      set "PM_EXE=pnpm"
    )
  )
) else (
  set "PM_EXE=npm"
)

if not exist "node_modules" (
  if not defined PM_EXE (
    echo [ERROR] npm or pnpm was not found, and node_modules is missing.
    echo Install Node.js/npm, or install dependencies from the Codex desktop environment first.
    echo.
    pause
    exit /b 1
  )
  echo Installing dependencies...
  "%PM_EXE%" install
  if errorlevel 1 (
    echo [ERROR] Dependency installation failed.
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

if defined PM_EXE (
  "%PM_EXE%" run dev
) else (
  node "node_modules\concurrently\dist\bin\concurrently.js" -k -n frontend,backend -c cyan,green "node server.mjs" "node backend/server.mjs"
)
set "EXIT_CODE=%ERRORLEVEL%"

echo.
if not "%EXIT_CODE%"=="0" (
  echo [ERROR] Workbench stopped with exit code %EXIT_CODE%.
) else (
  echo Workbench stopped.
)
pause
exit /b %EXIT_CODE%
