@echo off
:: ═══════════════════════════════════════════════════════════════
:: Launch Field App.bat — Redirects to GGM Field.bat
:: Kept for backward compatibility (old shortcuts may point here)
:: ═══════════════════════════════════════════════════════════════
set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
call "%ROOT%\GGM Field.bat"
