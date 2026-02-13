@echo off
setlocal enabledelayedexpansion
:: ═══════════════════════════════════════════════════════════════
:: GGM Hub — PC Installer
:: Gardners Ground Maintenance
::
:: Run this from the SSD (D:\gardening) to install GGM Hub
:: permanently onto your PC's C: drive. After install, you can
:: safely remove the SSD.
::
:: What it does:
::   1. Copies the full project to C:\GGM-Hub
::   2. Creates a Python virtual environment
::   3. Installs all dependencies
::   4. Copies your .env config (API keys, Telegram, etc.)
::   5. Creates a desktop shortcut
::   6. Sets up Git remote for future updates
::
:: After install: double-click "GGM Hub" on your desktop.
:: ═══════════════════════════════════════════════════════════════
title GGM Hub — PC Installer
color 0A

echo.
echo   ╔════════════════════════════════════════════════════╗
echo   ║   GGM Hub — PC Installer                          ║
echo   ║   Gardners Ground Maintenance                     ║
echo   ╠════════════════════════════════════════════════════╣
echo   ║                                                    ║
echo   ║   This will install GGM Hub to your C: drive       ║
echo   ║   so you can remove the SSD afterwards.            ║
echo   ║                                                    ║
echo   ╚════════════════════════════════════════════════════╝
echo.

:: ── Source directory (where this installer is running from) ──
set "SOURCE=%~dp0"
if "%SOURCE:~-1%"=="\" set "SOURCE=%SOURCE:~0,-1%"

:: ── Default install location ──
set "INSTALL=C:\GGM-Hub"

echo   Source:  %SOURCE%
echo   Install: %INSTALL%
echo.
set /p "CONFIRM=  Press Enter to install to %INSTALL% (or type a different path): "
if not "!CONFIRM!"=="" set "INSTALL=!CONFIRM!"

:: ══════════════════════════════════════════════════════════════
:: STEP 1 — Check prerequisites
:: ══════════════════════════════════════════════════════════════
echo.
echo   [1/8] Checking prerequisites...

:: Python
where python >nul 2>&1
if !errorlevel! neq 0 (
    echo.
    echo   ERROR: Python is not installed.
    echo   Download from: https://www.python.org
    echo   IMPORTANT: Tick "Add Python to PATH" during install.
    echo.
    pause
    exit /b 1
)
for /f "delims=" %%v in ('python --version 2^>^&1') do echo         [OK] %%v

:: Git
where git >nul 2>&1
if !errorlevel! neq 0 (
    echo         [!!] Git is not installed — will copy files instead.
    echo              (Install Git later for automatic updates)
    set "HAS_GIT=0"
) else (
    for /f "delims=" %%v in ('git --version 2^>^&1') do echo         [OK] %%v
    set "HAS_GIT=1"
)

:: Node.js
where node >nul 2>&1
if !errorlevel! neq 0 (
    echo         [--] Node.js not installed (agents won't auto-run)
    echo              Get it from: https://nodejs.org
) else (
    for /f "delims=" %%v in ('node --version 2^>^&1') do echo         [OK] Node.js %%v
)

echo.

:: ══════════════════════════════════════════════════════════════
:: STEP 2 — Clone or copy project to install location
:: ══════════════════════════════════════════════════════════════
echo   [2/8] Installing to !INSTALL!...

if exist "!INSTALL!\platform\app\main.py" (
    echo         Previous install found.
    echo.
    set /p "OVERWRITE=  Overwrite? (Y/n): "
    if /i "!OVERWRITE!"=="n" (
        echo   Cancelled.
        pause
        exit /b 0
    )
)

if "!HAS_GIT!"=="1" (
    if exist "!INSTALL!\.git" (
        :: Already a git repo — just pull
        echo         Updating existing install...
        cd /d "!INSTALL!"
        git pull --ff-only origin master >nul 2>&1
        echo         Updated from GitHub.
    ) else (
        :: Fresh clone
        echo         Cloning from GitHub...
        git clone https://github.com/christophergardner-star/gardnersgm-website.git "!INSTALL!" 2>nul
        if !errorlevel! neq 0 (
            echo         Clone failed — falling back to full file copy...
            goto :file_copy
        )
        echo         Cloned successfully.
    )
    :: Git clone won't include gitignored files (agents/, .bat, .env, apps-script/)
    :: Copy these critical files from the SSD
    echo         Copying server-side files (agents, scripts, config)...
    if exist "!SOURCE!\agents" (
        robocopy "!SOURCE!\agents" "!INSTALL!\agents" /E /XD "node_modules" /NFL /NDL /NJH /NJS /NP >nul
    )
    if exist "!SOURCE!\apps-script" (
        robocopy "!SOURCE!\apps-script" "!INSTALL!\apps-script" /E /NFL /NDL /NJH /NJS /NP >nul
    )
    :: Copy all .bat launchers
    for %%f in ("!SOURCE!\*.bat") do copy "%%f" "!INSTALL!\" >nul 2>&1
    :: Copy platform .bat files
    if exist "!SOURCE!\platform\launch.bat" copy "!SOURCE!\platform\launch.bat" "!INSTALL!\platform\" >nul 2>&1
    if exist "!SOURCE!\platform\Laptop Setup.bat" copy "!SOURCE!\platform\Laptop Setup.bat" "!INSTALL!\platform\" >nul 2>&1
    if exist "!SOURCE!\platform\Install Laptop Node.bat" copy "!SOURCE!\platform\Install Laptop Node.bat" "!INSTALL!\platform\" >nul 2>&1
    echo         Server-side files copied.
) else (
    :file_copy
    echo         Copying all files from SSD...
    :: Use robocopy for fast, reliable copying
    :: /E = subdirs including empty, /XD = exclude dirs, /NFL /NDL /NJH /NJS = quiet
    robocopy "!SOURCE!" "!INSTALL!" /E /XD ".venv" "node_modules" ".git" "__pycache__" /NFL /NDL /NJH /NJS /NP >nul
    echo         Files copied.
)
echo.

:: ══════════════════════════════════════════════════════════════
:: STEP 3 — Create Python virtual environment
:: ══════════════════════════════════════════════════════════════
echo   [3/8] Setting up Python environment...
if not exist "!INSTALL!\.venv\Scripts\python.exe" (
    python -m venv "!INSTALL!\.venv"
    if !errorlevel! neq 0 (
        echo         ERROR: Failed to create virtual environment.
        pause
        exit /b 1
    )
    echo         Virtual environment created.
) else (
    echo         Virtual environment already exists.
)
set "PY=!INSTALL!\.venv\Scripts\python.exe"
echo.

:: ══════════════════════════════════════════════════════════════
:: STEP 4 — Install Python dependencies
:: ══════════════════════════════════════════════════════════════
echo   [4/8] Installing Python dependencies...
"!PY!" -m pip install --quiet --upgrade pip >nul 2>&1
if exist "!INSTALL!\platform\requirements.txt" (
    "!PY!" -m pip install --quiet -r "!INSTALL!\platform\requirements.txt"
) else (
    "!PY!" -m pip install --quiet customtkinter requests Pillow matplotlib python-dotenv tkcalendar
)
if !errorlevel! neq 0 (
    echo         WARNING: Some dependencies may have failed.
    echo         You can retry: "!PY!" -m pip install -r "!INSTALL!\platform\requirements.txt"
) else (
    echo         All dependencies installed.
)
echo.

:: ══════════════════════════════════════════════════════════════
:: STEP 5 — Copy .env configuration
:: ══════════════════════════════════════════════════════════════
echo   [5/8] Setting up configuration...

:: Copy root .env from SSD if it exists (has real API keys)
if exist "!SOURCE!\.env" (
    if not exist "!INSTALL!\.env" (
        copy "!SOURCE!\.env" "!INSTALL!\.env" >nul
        echo         Copied .env with your API keys.
    ) else (
        echo         .env already exists — keeping current config.
    )
) else if exist "!INSTALL!\.env.example" (
    if not exist "!INSTALL!\.env" (
        copy "!INSTALL!\.env.example" "!INSTALL!\.env" >nul
        echo         Created .env from template — edit it with your API keys.
    )
)

:: Copy docker .env if docker dir exists
if exist "!INSTALL!\docker" (
    if not exist "!INSTALL!\docker\.env" (
        if exist "!INSTALL!\docker\.env.example" (
            copy "!INSTALL!\docker\.env.example" "!INSTALL!\docker\.env" >nul
            echo         Created docker\.env from template.
        )
    )
    :: Update AGENTS_PATH and PLATFORM_PATH in docker .env
    if exist "!INSTALL!\docker\.env" (
        :: Convert backslashes to forward slashes for Docker
        set "DOCKER_INSTALL=!INSTALL:\=/!"
        powershell -NoLogo -NoProfile -Command "(Get-Content '!INSTALL!\docker\.env') -replace 'AGENTS_PATH=.*', 'AGENTS_PATH=!DOCKER_INSTALL!/agents' -replace 'PLATFORM_PATH=.*', 'PLATFORM_PATH=!DOCKER_INSTALL!/platform' | Set-Content '!INSTALL!\docker\.env'"
        echo         Docker paths updated for !INSTALL!
    )
)

:: Create data directories
if not exist "!INSTALL!\platform\data" mkdir "!INSTALL!\platform\data"
if not exist "!INSTALL!\platform\data\backups" mkdir "!INSTALL!\platform\data\backups"
echo.

:: ══════════════════════════════════════════════════════════════
:: STEP 6 — Install Node.js dependencies (for agents)
:: ══════════════════════════════════════════════════════════════
echo   [6/8] Installing Node.js dependencies...
where node >nul 2>&1
if !errorlevel! equ 0 (
    if exist "!INSTALL!\agents\package.json" (
        cd /d "!INSTALL!\agents"
        npm install --silent >nul 2>&1
        echo         Node modules installed.
        cd /d "!INSTALL!"
    ) else (
        echo         No package.json found — skipping.
    )
) else (
    echo         Skipped (Node.js not installed).
)
echo.

:: ══════════════════════════════════════════════════════════════
:: STEP 7 — Create Desktop Shortcut
:: ══════════════════════════════════════════════════════════════
echo   [7/8] Creating desktop shortcut...

set "DESKTOP=%USERPROFILE%\Desktop"
set "SHORTCUT=%DESKTOP%\GGM Hub.lnk"

:: Use PowerShell to create a proper .lnk shortcut
powershell -NoLogo -NoProfile -Command ^
    "$ws = New-Object -ComObject WScript.Shell; ^
     $sc = $ws.CreateShortcut('%SHORTCUT%'); ^
     $sc.TargetPath = '!INSTALL!\GGM Hub.bat'; ^
     $sc.WorkingDirectory = '!INSTALL!'; ^
     $sc.Description = 'GGM Hub - Gardners Ground Maintenance'; ^
     $sc.Save()" >nul 2>&1

if exist "!SHORTCUT!" (
    echo         Desktop shortcut created: GGM Hub
) else (
    echo         Could not create shortcut — launch from: !INSTALL!\GGM Hub.bat
)

:: Also create Field shortcut
set "FIELD_SHORTCUT=%DESKTOP%\GGM Field.lnk"
powershell -NoLogo -NoProfile -Command ^
    "$ws = New-Object -ComObject WScript.Shell; ^
     $sc = $ws.CreateShortcut('%FIELD_SHORTCUT%'); ^
     $sc.TargetPath = '!INSTALL!\GGM Field.bat'; ^
     $sc.WorkingDirectory = '!INSTALL!'; ^
     $sc.Description = 'GGM Field - Laptop Companion'; ^
     $sc.Save()" >nul 2>&1

if exist "!FIELD_SHORTCUT!" (
    echo         Desktop shortcut created: GGM Field
)
echo.

:: ══════════════════════════════════════════════════════════════
:: STEP 8 — Verify installation
:: ══════════════════════════════════════════════════════════════
echo   [8/8] Verifying installation...

set "ALL_OK=1"

:: Check critical files
if exist "!INSTALL!\platform\app\main.py" (
    echo         [OK] Platform code
) else (
    echo         [!!] Platform code MISSING
    set "ALL_OK=0"
)

if exist "!INSTALL!\.venv\Scripts\python.exe" (
    echo         [OK] Python environment
) else (
    echo         [!!] Python environment MISSING
    set "ALL_OK=0"
)

"!PY!" -c "import customtkinter; import requests; import dotenv" >nul 2>&1
if !errorlevel! equ 0 (
    echo         [OK] Python dependencies
) else (
    echo         [!!] Python dependencies INCOMPLETE
    set "ALL_OK=0"
)

if exist "!INSTALL!\.env" (
    echo         [OK] Configuration (.env)
) else (
    echo         [!!] Configuration MISSING — create .env
    set "ALL_OK=0"
)

if exist "!INSTALL!\GGM Hub.bat" (
    echo         [OK] Launcher
) else (
    echo         [!!] Launcher MISSING
    set "ALL_OK=0"
)

if exist "!INSTALL!\agents\orchestrator.js" (
    echo         [OK] Agent orchestrator
) else (
    echo         [--] Agent orchestrator (agents may be gitignored — manual copy needed)
)

echo.

:: ══════════════════════════════════════════════════════════════
:: DONE
:: ══════════════════════════════════════════════════════════════
echo.
if "!ALL_OK!"=="1" (
    echo   ╔════════════════════════════════════════════════════╗
    echo   ║   INSTALLATION COMPLETE!                           ║
    echo   ╠════════════════════════════════════════════════════╣
    echo   ║                                                    ║
    echo   ║   Installed to: !INSTALL!
    echo   ║                                                    ║
    echo   ║   You can now safely remove the SSD.               ║
    echo   ║                                                    ║
    echo   ║   To start:                                        ║
    echo   ║     - Double-click "GGM Hub" on your desktop       ║
    echo   ║     - Or run: !INSTALL!\GGM Hub.bat
    echo   ║                                                    ║
    echo   ║   It will auto-update from GitHub on each launch.  ║
    echo   ║                                                    ║
    echo   ╚════════════════════════════════════════════════════╝
) else (
    echo   ╔════════════════════════════════════════════════════╗
    echo   ║   INSTALL FINISHED WITH WARNINGS                   ║
    echo   ╠════════════════════════════════════════════════════╣
    echo   ║                                                    ║
    echo   ║   Some checks failed — see above for details.      ║
    echo   ║   The Hub may still work. Try launching it.        ║
    echo   ║                                                    ║
    echo   ╚════════════════════════════════════════════════════╝
)

echo.
echo   ────────────────────────────────────────────────────
echo   NOTE: Agents (in agents/ folder) are git-ignored.
echo   If they weren't cloned, they were copied from the SSD.
echo   Future updates come from GitHub via "git pull".
echo   ────────────────────────────────────────────────────
echo.
set /p "LAUNCH=  Launch GGM Hub now? (Y/n): "
if /i not "!LAUNCH!"=="n" (
    cd /d "!INSTALL!"
    start "" "!INSTALL!\GGM Hub.bat"
)
echo.
pause
