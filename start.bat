@echo off
setlocal EnableExtensions DisableDelayedExpansion
cd /d "%~dp0"

set "NODE_EXE=node"
if exist "%~dp0runtime\node\win-x64\active.txt" for /f "usebackq delims=" %%V in ("%~dp0runtime\node\win-x64\active.txt") do (
  if exist "%~dp0runtime\node\win-x64\%%V\node.exe" set "NODE_EXE=%~dp0runtime\node\win-x64\%%V\node.exe"
)
if /i "%NODE_EXE%"=="node" (
  where node.exe >nul 2>&1
  if errorlevel 1 goto missing_node
)
"%NODE_EXE%" -e "process.exit(Number(process.versions.node.split('.')[0]) >= 20 ? 0 : 1)" >nul 2>&1
if errorlevel 1 goto outdated_node

if not defined HLEDGER_WORKSPACE set "HLEDGER_WORKSPACE=%USERPROFILE%\Documents\hledger-finances"

echo Starting hledger-webuix...
echo Node.js:
"%NODE_EXE%" --version
echo Workspace: %HLEDGER_WORKSPACE%
echo The browser opens automatically after the server starts.
echo Keep this window open while using the app. Press Ctrl+C to stop.
echo.
"%NODE_EXE%" "%~dp0server.js" --workspace "%HLEDGER_WORKSPACE%" --open
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
echo 1. Visit https://nodejs.org/en/download
echo 2. Download and install the Windows LTS .msi package.
echo 3. Keep "Add to PATH" enabled, then open a NEW terminal.
echo 4. Check "node --version" and double-click start.bat again.
echo.
pause
exit /b 1

:outdated_node
echo.
echo please install node.js 20 or newer (LTS recommended)
echo Download: https://nodejs.org/en/download
echo Update Node.js, open a new terminal, then run start.bat again.
echo.
pause
exit /b 1
