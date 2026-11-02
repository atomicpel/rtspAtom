@echo off
rem RTSP Atom: uninstall. Keeps data unless run as: uninstall.cmd -Purge
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0uninstall.ps1" %*
