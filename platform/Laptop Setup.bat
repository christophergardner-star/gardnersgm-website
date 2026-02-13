@echo off
setlocal enabledelayedexpansion
:: ═══════════════════════════════════════════════════════════════
:: GGM Hub — Laptop Node Setup
:: Run this ONCE on your laptop to set it up as a development node.
:: After this, use "GGM Push Update.bat" to push changes to the PC.
:: ═══════════════════════════════════════════════════════════════
title GGM Hub — Laptop Setup
color 0A

echo.
echo   GGM Hub - Laptop Node Setup
echo   ============================
echo.

:: ── Check Git ──
where git >nul 2>&1
if !errorlevel! neq 0 (
    echo   ERROR: Git is not installed.
    echo   Download from: https://git-scm.com/download/win
    echo.
    pause
    exit /b 1
)
echo   [1/4] Git found.

:: ── Choose install location ──
set "INSTALL=C:\GGM-Hub"
echo.
echo   The Hub code will be cloned to: !INSTALL!
echo   (This is just the code — your live database stays on the PC)
echo.
set /p "CONFIRM=Press Enter to continue or type a different path: "
if not "!CONFIRM!"=="" set "INSTALL=!CONFIRM!"

:: ── Clone repo ──
if exist "!INSTALL!\platform\app\main.py" (
    echo.
    echo   [2/4] Repository already cloned. Pulling latest...
    cd /d "!INSTALL!"
    git pull --ff-only origin master
) else (
    echo.
    echo   [2/4] Cloning repository from GitHub...
    git clone https://github.com/christophergardner-star/gardnersgm-website.git "!INSTALL!"
    if !errorlevel! neq 0 (
        echo   ERROR: Clone failed. Check your internet connection.
        pause
        exit /b 1
    )
)

cd /d "!INSTALL!"

:: ── Set up Python venv ──
echo.
echo   [3/4] Setting up Python environment...
if not exist "!INSTALL!\.venv\Scripts\python.exe" (
    python -m venv "!INSTALL!\.venv"
    if !errorlevel! neq 0 (
        echo   ERROR: Failed to create venv. Is Python installed?
        pause
        exit /b 1
    )
)
"!INSTALL!\.venv\Scripts\python.exe" -m pip install --quiet --upgrade pip >nul 2>&1
"!INSTALL!\.venv\Scripts\python.exe" -m pip install --quiet -r "!INSTALL!\platform\requirements.txt"
echo   Python environment ready.

:: ── Create push script ──
echo.
echo   [4/4] Creating push script...

(
echo @echo off
echo setlocal enabledelayedexpansion
echo title GGM Hub — Push Update
echo color 0A
echo echo.
echo echo   GGM Hub - Push Update to PC
echo echo   =============================
echo echo.
echo cd /d "!INSTALL!"
echo echo   Staging changes...
echo git add -A
echo echo.
echo set /p "MSG=  Describe what you changed: "
echo if "^^!MSG^^!"=="" set "MSG=Hub update"
echo echo.
echo echo   Committing...
echo git commit -m "^^!MSG^^!"
echo echo.
echo echo   Pushing to GitHub...
echo git push origin master
echo if ^^!errorlevel^^! equ 0 (
echo     echo.
echo     echo   Done! Your PC will pick up the changes next time the Hub starts.
echo     echo   Or restart the Hub on your PC to update immediately.
echo ^) else (
echo     echo.
echo     echo   Push failed — check your connection or GitHub access.
echo ^)
echo echo.
echo pause
) > "!INSTALL!\GGM Push Update.bat"

echo.
echo   ═══════════════════════════════════════════════
echo   SETUP COMPLETE
echo   ═══════════════════════════════════════════════
echo.
echo   Your laptop is now a GGM Hub development node.
echo.
echo   HOW IT WORKS:
echo   1. Edit Hub files in: !INSTALL!\platform\
echo   2. Double-click "GGM Push Update.bat" to push
echo   3. Your PC will auto-update next Hub launch
echo.
echo   You can also open the folder in VS Code:
echo     code "!INSTALL!"
echo.
pause
