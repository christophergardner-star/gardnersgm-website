@echo off
title GGM Field - Lite Node 2
color 0A

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

echo.
echo  ===================================
echo    GGM Field - Laptop Lite Node
echo  ===================================
echo.

:: ---- Git pull (skip if no git) ----
where git >nul 2>&1
if %errorlevel%==0 (
    echo  [1/3] Pulling latest updates...
    cd /d "%ROOT%"
    git pull --quiet 2>nul
    if %errorlevel%==0 (
        echo        Done.
    ) else (
        echo        Skipped - offline or no changes.
    )
) else (
    echo  [1/3] Git not found - skipping update.
)

:: ---- Check venv ----
echo  [2/3] Checking Python environment...
if not exist "%ROOT%\.venv\Scripts\python.exe" (
    echo        Creating virtual environment...
    python -m venv "%ROOT%\.venv"
    if not exist "%ROOT%\.venv\Scripts\python.exe" (
        echo.
        echo  ERROR: Python not found. Install Python from python.org
        echo         Make sure to tick "Add Python to PATH"
        pause
        exit /b 1
    )
    echo        Installing dependencies...
    "%ROOT%\.venv\Scripts\python.exe" -m pip install --quiet -r "%ROOT%\platform\requirements.txt"
)
echo        Ready.

:: ---- Create data folder ----
if not exist "%ROOT%\platform\data" mkdir "%ROOT%\platform\data"

:: ---- Launch ----
echo  [3/3] Launching GGM Field...
echo.
echo  ===================================
echo    App is opening - you can close
echo    this window once you see it.
echo  ===================================
echo.

cd /d "%ROOT%"
start "" "%ROOT%\.venv\Scripts\pythonw.exe" "%ROOT%\platform\field_app.py"
timeout /t 3 /nobreak >nul
exit
