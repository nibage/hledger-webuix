@echo off
setlocal EnableExtensions DisableDelayedExpansion
cd /d "%~dp0"

rem Runtime choices are written by Settings. System Node.js is the default.
set "NODE_MODE=system"
set "NODE_EXE=node"
if exist "%~dp0data\node-mode.txt" set /p "NODE_MODE="<"%~dp0data\node-mode.txt"
if /i "%NODE_MODE%"=="bundle" (
  if exist "%~dp0data\node\win-x64\active.txt" (
    set /p "NODE_VER="<"%~dp0data\node\win-x64\active.txt"
    call :use_bundle
  )
)
if /i "%NODE_MODE%"=="custom" (
  if exist "%~dp0data\node-path.txt" set /p "NODE_EXE="<"%~dp0data\node-path.txt"
)
if /i "%NODE_EXE%"=="node" (
  where node.exe >nul 2>&1
  if errorlevel 1 goto missing_node
)
"%NODE_EXE%" -e "process.exit(Number(process.versions.node.split('.')[0]) >= 20 ? 0 : 1)" >nul 2>&1
if errorlevel 1 goto outdated_node
if not defined HLEDGER_PORT set "HLEDGER_PORT=8765"

echo Starting hledger-webuix with:
"%NODE_EXE%" --version
echo Local URL: http://127.0.0.1:%HLEDGER_PORT%/
if defined HLEDGER_WORKSPACE echo Workspace override: %HLEDGER_WORKSPACE%
echo The server opens Chrome (or your default browser) once ready.
echo Closing the last application tab requests server shutdown; Ctrl+C stops it immediately.
echo.
if defined HLEDGER_WORKSPACE (
  "%NODE_EXE%" "%~dp0server.js" --workspace "%HLEDGER_WORKSPACE%" --port "%HLEDGER_PORT%" --open --close-on-tab-exit
) else (
  "%NODE_EXE%" "%~dp0server.js" --port "%HLEDGER_PORT%" --open --close-on-tab-exit
)
set "EXITCODE=%ERRORLEVEL%"
if not "%EXITCODE%"=="0" (
  echo Server exited with error %EXITCODE%.
  pause
)
exit /b %EXITCODE%

:use_bundle
if exist "%~dp0data\node\win-x64\%NODE_VER%\node.exe" (
  set "NODE_EXE=%~dp0data\node\win-x64\%NODE_VER%\node.exe"
) else (
  echo Bundled Node.js was selected but is missing. Install it in Settings.
  echo Falling back to system Node.js.
)
exit /b 0

:missing_node
echo please install node.js
echo Install the Windows LTS version: https://nodejs.org/en/download
echo Alternatively install the Node.js bundle with Settings on an existing system Node.js.
pause
exit /b 1

:outdated_node
echo please install node.js version 20 or newer
echo Get the LTS version: https://nodejs.org/en/download
pause
exit /b 1
