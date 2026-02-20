@echo off
REM ═══════════════════════════════════════════════════════════════
REM  GGM Hub — Server Node Setup
REM  Run as Administrator on Node 1 (PC Hub)
REM
REM  This script:
REM    1. Installs NSSM (Non-Sucking Service Manager) via winget
REM    2. Registers GGM Hub as a Windows Service (auto-start)
REM    3. Creates a watchdog scheduled task (every 5 min)
REM    4. Starts the service
REM ═══════════════════════════════════════════════════════════════

echo.
echo ╔═══════════════════════════════════════════╗
echo ║   GGM Hub — Server Node Setup             ║
echo ║   Run this as Administrator                ║
echo ╚═══════════════════════════════════════════╝
echo.

REM ── Check admin ──
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo ERROR: This script must be run as Administrator.
    echo Right-click and select "Run as administrator".
    pause
    exit /b 1
)

REM ── Detect Python ──
set "PYTHON_EXE="
where python >nul 2>&1 && set "PYTHON_EXE=python"
if not defined PYTHON_EXE (
    echo ERROR: Python not found on PATH.
    echo Install Python 3.11+ from https://python.org
    pause
    exit /b 1
)
echo [OK] Python found: %PYTHON_EXE%

REM ── Detect GGM Hub paths ──
set "HUB_DIR=C:\GGM-Hub\platform"
if not exist "%HUB_DIR%\app\main.py" (
    set "HUB_DIR=%~dp0"
    if not exist "%HUB_DIR%app\main.py" (
        echo ERROR: Cannot find platform\app\main.py
        echo Expected at C:\GGM-Hub\platform or script directory.
        pause
        exit /b 1
    )
)
echo [OK] Hub directory: %HUB_DIR%

REM ── Step 1: Install NSSM ──
echo.
echo [1/4] Installing NSSM...
where nssm >nul 2>&1
if %errorLevel% neq 0 (
    echo Installing NSSM via winget...
    winget install nssm --accept-source-agreements --accept-package-agreements
    if %errorLevel% neq 0 (
        echo WARNING: winget install failed. Trying chocolatey...
        choco install nssm -y 2>nul
        if %errorLevel% neq 0 (
            echo.
            echo NSSM could not be installed automatically.
            echo Download manually from: https://nssm.cc/download
            echo Extract nssm.exe to C:\Windows\System32\
            pause
            exit /b 1
        )
    )
) else (
    echo [OK] NSSM already installed
)

REM ── Step 2: Remove existing service if present ──
echo.
echo [2/4] Configuring GGMHub service...
nssm status GGMHub >nul 2>&1
if %errorLevel% equ 0 (
    echo Stopping existing service...
    nssm stop GGMHub >nul 2>&1
    timeout /t 3 /nobreak >nul
    nssm remove GGMHub confirm >nul 2>&1
    echo Removed old service definition
)

REM ── Step 3: Install as Windows Service ──
echo Installing GGMHub as Windows Service...

REM Find the full python path
for /f "tokens=*" %%p in ('where python') do set "PYTHON_FULL=%%p"

nssm install GGMHub "%PYTHON_FULL%" "-m app.main"
nssm set GGMHub AppDirectory "%HUB_DIR%"
nssm set GGMHub AppStdout "%HUB_DIR%\data\service_stdout.log"
nssm set GGMHub AppStderr "%HUB_DIR%\data\service_stderr.log"
nssm set GGMHub AppStdoutCreationDisposition 4
nssm set GGMHub AppStderrCreationDisposition 4
nssm set GGMHub AppRotateFiles 1
nssm set GGMHub AppRotateBytes 5242880
nssm set GGMHub AppRestartDelay 5000
nssm set GGMHub AppExit Default Restart
nssm set GGMHub Description "Gardners Ground Maintenance Hub Server — business automation platform"
nssm set GGMHub DisplayName "GGM Hub"
nssm set GGMHub Start SERVICE_AUTO_START
nssm set GGMHub ObjectName LocalSystem

echo [OK] Service installed

REM ── Step 4: Register watchdog scheduled task ──
echo.
echo [3/4] Registering watchdog scheduled task...

schtasks /delete /tn "GGM Hub Watchdog" /f >nul 2>&1
schtasks /create ^
    /tn "GGM Hub Watchdog" ^
    /tr "\"%PYTHON_FULL%\" \"%HUB_DIR%\watchdog.py\"" ^
    /sc minute /mo 5 ^
    /ru SYSTEM ^
    /rl HIGHEST ^
    /f

if %errorLevel% equ 0 (
    echo [OK] Watchdog task created (runs every 5 minutes)
) else (
    echo WARNING: Could not create scheduled task. You can add it manually.
    echo   Task Scheduler ^> Create Basic Task ^> "GGM Hub Watchdog"
    echo   Trigger: Every 5 minutes
    echo   Action: python "%HUB_DIR%\watchdog.py"
)

REM ── Step 5: Start the service ──
echo.
echo [4/4] Starting GGM Hub service...
nssm start GGMHub

timeout /t 3 /nobreak >nul
nssm status GGMHub

echo.
echo ═══════════════════════════════════════════════════════════
echo  SETUP COMPLETE
echo.
echo  Service:   GGMHub (auto-starts on boot, auto-restarts on crash)
echo  Watchdog:  Every 5 min via Task Scheduler
echo  Logs:      %HUB_DIR%\data\service_stdout.log
echo  DB Backup: Nightly at 02:00 to %HUB_DIR%\data\backups\
echo.
echo  Manage with:
echo    nssm start GGMHub       - Start the service
echo    nssm stop GGMHub        - Stop the service
echo    nssm restart GGMHub     - Restart the service
echo    nssm status GGMHub      - Check service status
echo    nssm edit GGMHub        - Edit service config (GUI)
echo    sc query GGMHub         - Windows service status
echo ═══════════════════════════════════════════════════════════
echo.
pause
