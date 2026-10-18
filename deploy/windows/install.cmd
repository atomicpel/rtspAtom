@echo off
rem RTSP Atom: installation / upgrade. Double-click or run: install.cmd [-Port 8080] [-Tls]
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" %*
