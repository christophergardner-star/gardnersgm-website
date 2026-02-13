@echo off
setlocal enabledelayedexpansion
:: ═══════════════════════════════════════════════════════════════
:: GGM Hub — Internal Platform Launcher
:: Launches just the Hub GUI (no Ollama, Docker, or orchestrator).
:: For the full PC startup, use "GGM Hub.bat" in the root folder.
:: ═══════════════════════════════════════════════════════════════
title GGM Hub — Gardners Ground Maintenance
cd /d "%~dp0"

:: Try local embedded Python first, then project venv, then system Python
if exist "python\python.exe" (
    set "PY=python\python.exe"
) else if exist "..\.venv\Scripts\python.exe" (
    set "PY=..\.venv\Scripts\python.exe"
) else (
    set "PY=python"
)

:: Ensure data directory
if not exist "data" mkdir data

echo.
echo  GGM Hub — Starting platform GUI...
echo  (For full startup with Ollama + agents, use GGM Hub.bat)
echo.

"!PY!" app\main.py %*

if !errorlevel! neq 0 (
    echo.
    echo [ERROR] GGM Hub failed to start.
    echo   - Check Python is installed
    echo   - Run: pip install -r requirements.txt
    echo   - Check data\ggm_hub.log for details
    pause
)
