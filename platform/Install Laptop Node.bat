@echo off
setlocal enabledelayedexpansion
:: ═══════════════════════════════════════════════════════════════
:: GGM Hub — Laptop Node Installer
:: Copy this single file to your laptop and double-click it.
:: It will download everything it needs and launch the app.
:: ═══════════════════════════════════════════════════════════════
title GGM Hub — Laptop Node Setup
color 0A

echo.
echo   GGM Hub - Laptop Node Setup
echo   ============================
echo.

:: ── Step 1: Check Git ──
where git >nul 2>&1
if !errorlevel! neq 0 (
    echo   ERROR: Git is not installed.
    echo.
    echo   Download from: https://git-scm.com/download/win
    echo   Tick "Add Git to PATH" during install.
    echo   Then run this again.
    echo.
    pause
    exit /b 1
)
echo   [1/4] Git found.

:: ── Step 2: Check Python ──
where python >nul 2>&1
if !errorlevel! neq 0 (
    echo   ERROR: Python is not installed.
    echo.
    echo   Download from: https://www.python.org/downloads/
    echo   Tick "Add Python to PATH" during install.
    echo   Then run this again.
    echo.
    pause
    exit /b 1
)
echo   [2/4] Python found.

:: ── Step 3: Clone or update repo ──
set "INSTALL=%USERPROFILE%\GGM-Hub"

if exist "!INSTALL!\platform\laptop_node.py" (
    echo   [3/4] Repository exists, pulling latest...
    cd /d "!INSTALL!"
    git pull --ff-only origin master >nul 2>&1
) else (
    echo   [3/4] Cloning repository...
    git clone https://github.com/christophergardner-star/gardnersgm-website.git "!INSTALL!"
    if !errorlevel! neq 0 (
        echo.
        echo   ERROR: Clone failed. Check internet connection.
        pause
        exit /b 1
    )
)
echo         Done.

:: ── Step 4: Launch the laptop node app ──
echo   [4/4] Launching Laptop Node...
echo.

cd /d "!INSTALL!"
python platform\laptop_node.py

echo.
pause
