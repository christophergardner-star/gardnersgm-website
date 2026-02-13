@echo off
setlocal enabledelayedexpansion
:: ═══════════════════════════════════════════════════════════════
:: GGM Field — Laptop Node Launcher
:: Gardners Ground Maintenance — Lightweight Field Companion
::
:: This is the ONE file you double-click on the LAPTOP.
:: It connects to the same Google Sheets as the PC node,
:: letting you view jobs, clients, schedule, and trigger
:: heavy actions (blogs, newsletters, emails) on the PC.
::
:: Architecture:
::   Laptop (this)  →  Google Sheets  ←  PC Node (GGM Hub.bat)
::   Mobile App     →  Google Sheets  ←  PC Node
::
:: The laptop does NOT run agents, Docker, or Ollama.
:: It's a lightweight field companion.
:: ═══════════════════════════════════════════════════════════════
title GGM Field — Starting...
color 0A

echo.
echo   ╔════════════════════════════════════════════════╗
echo   ║   GGM Field — Laptop Node                     ║
echo   ║   Gardners Ground Maintenance                 ║
echo   ╚════════════════════════════════════════════════╝
echo.

:: Auto-detect root from wherever this .bat file lives
set "ROOT=%~dp0"
:: Strip trailing backslash
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
set "PYTHON=%ROOT%\.venv\Scripts\python.exe"

:: ── Check Python venv exists ──
if not exist "!PYTHON!" (
    echo   [!!] Python virtual environment not found.
    echo       Creating it now...
    echo.
    where python >nul 2>&1
    if !errorlevel! neq 0 (
        echo   ERROR: Python is not installed.
        echo   Download from: https://www.python.org
        echo   Tick "Add Python to PATH" during install.
        pause
        exit /b 1
    )
    python -m venv "!ROOT!\.venv"
    if !errorlevel! neq 0 (
        echo   ERROR: Failed to create virtual environment.
        pause
        exit /b 1
    )
    echo   Virtual environment created.
    echo.
)

:: ── Step 1: Pull latest code from GitHub ──
echo   [1/5] Checking for updates...
where git >nul 2>&1
if !errorlevel! equ 0 (
    cd /d "!ROOT!"
    git fetch origin --quiet >nul 2>&1
    git pull --ff-only origin master >nul 2>&1
    if !errorlevel! equ 0 (
        echo         Code is up to date.
    ) else (
        echo         Update pulled from GitHub.
    )
) else (
    echo         Git not found — skipping update check.
)
echo.

:: ── Step 2: Check dependencies ──
echo   [2/5] Checking dependencies...
"!PYTHON!" -c "import customtkinter; import requests; import dotenv" >nul 2>&1
if !errorlevel! neq 0 (
    echo         Installing dependencies...
    "!PYTHON!" -m pip install --quiet --upgrade pip >nul 2>&1
    "!PYTHON!" -m pip install --quiet customtkinter requests python-dotenv >nul 2>&1
    if !errorlevel! neq 0 (
        echo         WARNING: Some dependencies may have failed.
    ) else (
        echo         Dependencies installed.
    )
) else (
    echo         All dependencies present.
)
echo.

:: ── Step 3: Ensure data directory ──
echo   [3/5] Preparing workspace...
if not exist "!ROOT!\platform\data" mkdir "!ROOT!\platform\data"
echo         Data directory ready.
echo.

:: ── Step 4: Test Google Sheets connectivity ──
echo   [4/5] Testing Google Sheets connection...
"!PYTHON!" -c "import requests; r = requests.get('https://script.google.com/macros/s/AKfycbx-q2qSeCorIEeXPE9d2MgAZLKEFwFNW9lARLE1yYciH9wJWwvktUTuDVLz_rSCbUhkMg/exec?action=ping', timeout=15, allow_redirects=True); print('OK' if r.status_code == 200 else 'WARN')" >nul 2>&1
if !errorlevel! equ 0 (
    echo         Google Sheets API — connected
) else (
    echo         Google Sheets API — connection failed (will retry in app)
)
echo.

:: ── Step 5: Launch field app ──
echo   [5/5] Opening GGM Field...
echo.
echo   ╔════════════════════════════════════════════════╗
echo   ║   Ready!                                      ║
echo   ╠════════════════════════════════════════════════╣
echo   ║                                               ║
echo   ║   Tabs: Dashboard, Today's Jobs, Schedule,    ║
echo   ║         Job Tracking, Clients, Enquiries,     ║
echo   ║         Invoices, PC Triggers, Field Notes    ║
echo   ║                                               ║
echo   ║   Google Sheets    connected                  ║
echo   ║   PC Triggers      via RemoteCommands sheet   ║
echo   ║   No local agents  (PC handles everything)    ║
echo   ║                                               ║
echo   ╚════════════════════════════════════════════════╝
echo.
echo   Close the app window to shut down.
echo   ────────────────────────────────────────────────
echo.

title GGM Field — Running
cd /d "!ROOT!\platform"
"!PYTHON!" field_app.py

echo.
if !errorlevel! neq 0 (
    echo   GGM Field exited with an error.
    echo   Check the output above for details.
) else (
    echo   GGM Field closed normally.
)
echo.
pause
