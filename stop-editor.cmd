@echo off
where pwsh.exe >nul 2>nul
if errorlevel 1 (
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0local-server.ps1" -Action Stop
) else (
    pwsh.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0local-server.ps1" -Action Stop
)
if errorlevel 1 pause
