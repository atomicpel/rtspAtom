@echo off
rem RTSP Atom admin utility: rtspatom-admin help
setlocal
net session >nul 2>&1
if errorlevel 1 (
  "%~dp0node\node.exe" "%~dp0app\server\cli.js" need-admin
  exit /b 1
)
if not defined RTSPATOM_CONFIG set "RTSPATOM_CONFIG=%ProgramData%\RTSPAtom\config.json"
"%~dp0node\node.exe" --disable-warning=ExperimentalWarning "%~dp0app\server\cli.js" %*
exit /b %errorlevel%
