@echo off
setlocal EnableExtensions DisableDelayedExpansion
cd /d "%~dp0"

rem Use portable Node.js from __hledgerui\data when installed; otherwise use PATH.
set "NODE_EXE=node"
if exist "%~dp0data\node\win-x64\active.txt" for /f "usebackq delims=" %%V in ("%~dp0data\node\win-x64\active.txt") do (
  if exist "%~dp0data\node\win-x64\%%V\node.exe" set "NODE_EXE=%~dp0data\node\win-x64\%%V\node.exe"
)
if /i "%NODE_EXE%"=="node" (
  where node.exe >nul 2>&1
  if errorlevel 1 goto missing_node
)
"%NODE_EXE%" -e "process.exit(Number(process.versions.node.split('.')[0]) >= 20 ? 0 : 1)" >nul 2>&1
if errorlevel 1 goto outdated_node

if not defined HLEDGER_WORKSPACE set "HLEDGER_WORKSPACE=%USERPROFILE%\Documents\hledger-finances"
if not defined HLEDGER_PORT set "HLEDGER_PORT=8765"

echo Starting hledger-webuix...
echo Node.js:
"%NODE_EXE%" --version
echo Workspace: %HLEDGER_WORKSPACE%
echo Opening http://127.0.0.1:%HLEDGER_PORT%/ in your default browser after server startup.
echo Keep this window open. Press Ctrl+C to stop the local server.
echo.
"%NODE_EXE%" "%~dp0server.js" --workspace "%HLEDGER_WORKSPACE%" --port "%HLEDGER_PORT%" --open
set "EXITCODE=%ERRORLEVEL%"
if not "%EXITCODE%"=="0" (
  echo.
  echo The server stopped with error %EXITCODE%.
  pause
)
exit /b %EXITCODE%

:missing_node
echo.
echo please install node.js
echo 1. Install Node.js LTS from https://nodejs.org/en/download
echo 2. Choose the Windows installer and keep Add to PATH enabled.
echo 3. Open a new terminal and check node --version.
echo Alternatively, install portable Node.js in data\node\ using the updater.
echo.
pause
exit /b 1

:outdated_node
echo.
echo please install node.js version 20 or newer
echo Download LTS: https://nodejs.org/en/download
echo Open a new terminal after installing it, then start this script again.
echo.
pause
exit /b 1
