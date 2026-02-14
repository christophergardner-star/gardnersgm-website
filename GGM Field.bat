@echo off
setlocal enabledelayedexpansion
:: ===============================================================
:: GGM Field - Laptop Node Launcher (Node 2)
:: Gardners Ground Maintenance - Lightweight Field Companion
::
:: This is the ONE file you double-click on the LAPTOP.
:: It connects to the same Google Sheets as the PC Hub,
:: letting you view jobs, clients, schedule, finance, and
:: trigger heavy actions (blogs, newsletters, emails) on the PC.
::
:: Architecture:
::   Laptop (this)  -->  Google Sheets  <--  PC Hub (Node 1)
::   Mobile App     -->  Google Sheets  <--  PC Hub (Node 1)
::
:: The laptop does NOT run agents, Docker, or Ollama.
:: It is a lightweight field companion. Node 1 is king.
:: ===============================================================
title GGM Field - Starting...
color 0A

echo.
echo   ====================================================
echo    GGM Field - Laptop Node (Node 2)
echo    Gardners Ground Maintenance
echo   ====================================================
echo.

:: Auto-detect root from wherever this .bat file lives
set "ROOT=%~dp0"
:: Strip trailing backslash
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
set "PYTHON=%ROOT%\.venv\Scripts\python.exe"
set "HAS_GIT=0"
set "HAS_INTERNET=0"
set "SHEETS_OK=0"
set "PC_STATUS=unknown"

cd /d "%ROOT%"

:: ==============================================================
:: STEP 1 - Pre-flight checks
:: ==============================================================
echo   [1/6] Pre-flight checks...

:: Python venv
if not exist "!PYTHON!" (
    echo         Python venv not found. Creating...
    where python >nul 2>&1
    if !errorlevel! neq 0 (
        echo.
        echo         ERROR: Python is not installed.
        echo         Download from: https://www.python.org
        echo         Tick "Add Python to PATH" during install.
        pause
        exit /b 1
    )
    python -m venv "!ROOT!\.venv"
    if !errorlevel! neq 0 (
        echo         ERROR: Failed to create virtual environment.
        pause
        exit /b 1
    )
    echo         Virtual environment created.
)
echo         [OK] Python venv

:: Git
where git >nul 2>&1
if !errorlevel! neq 0 (
    echo         [--] Git not found - auto-update disabled
) else (
    set "HAS_GIT=1"
    echo         [OK] Git
)

:: Internet connectivity
ping -n 1 -w 2000 github.com >nul 2>&1
if !errorlevel! equ 0 (
    set "HAS_INTERNET=1"
    echo         [OK] Internet connection
) else (
    echo         [--] No internet - working offline
)

echo.

:: ==============================================================
:: STEP 2 - Pull latest code from GitHub
:: ==============================================================
echo   [2/6] Checking for updates from GitHub...
if "!HAS_GIT!"=="1" (
    if "!HAS_INTERNET!"=="1" (
        for /f "tokens=*" %%a in ('git rev-parse --short HEAD 2^>nul') do set "OLD_HASH=%%a"

        git fetch origin --quiet >nul 2>&1

        for /f "tokens=*" %%a in ('git rev-list HEAD..origin/master --count 2^>nul') do set "BEHIND=%%a"

        if "!BEHIND!"=="0" (
            echo         Already up to date. [!OLD_HASH!]
        ) else (
            echo         !BEHIND! new commit^(s^) available - pulling...
            git pull --ff-only origin master 2>nul
            if !errorlevel! equ 0 (
                for /f "tokens=*" %%a in ('git rev-parse --short HEAD 2^>nul') do set "NEW_HASH=%%a"
                echo         Updated: !OLD_HASH! --^> !NEW_HASH!
            ) else (
                echo         WARNING: Pull failed - you may have local changes.
            )
        )
    ) else (
        echo         Skipped ^(no internet^).
    )
) else (
    echo         Skipped ^(Git not available^).
)
echo.

:: ==============================================================
:: STEP 3 - Install / check Python dependencies
:: ==============================================================
echo   [3/6] Checking Python dependencies...
"!PYTHON!" -c "import customtkinter; import requests; import dotenv" >nul 2>&1
if !errorlevel! neq 0 (
    echo         Installing dependencies...
    "!PYTHON!" -m pip install --quiet --upgrade pip >nul 2>&1
    if exist "!ROOT!\platform\requirements.txt" (
        "!PYTHON!" -m pip install --quiet -r "!ROOT!\platform\requirements.txt" >nul 2>&1
    ) else (
        "!PYTHON!" -m pip install --quiet customtkinter requests python-dotenv >nul 2>&1
    )
    if !errorlevel! neq 0 (
        echo         WARNING: Some dependencies may have failed.
    ) else (
        echo         Dependencies installed.
    )
) else (
    echo         All dependencies present.
)

if not exist "!ROOT!\platform\data" mkdir "!ROOT!\platform\data"
echo.

:: ==============================================================
:: STEP 4 - Test Google Sheets connectivity
:: ==============================================================
echo   [4/6] Testing Google Sheets connection...
"!PYTHON!" -c "import requests; r=requests.get('https://script.google.com/macros/s/AKfycbx-q2qSeCorIEeXPE9d2MgAZLKEFwFNW9lARLE1yYciH9wJWwvktUTuDVLz_rSCbUhkMg/exec?action=ping',timeout=15,allow_redirects=True); exit(0 if r.status_code==200 else 1)" >nul 2>&1
if !errorlevel! equ 0 (
    set "SHEETS_OK=1"
    echo         Google Sheets API - connected
) else (
    echo         Google Sheets API - offline ^(will retry in app^)
)
echo.

:: ==============================================================
:: STEP 5 - Check PC Hub (Node 1) status
:: ==============================================================
echo   [5/6] Checking PC Hub (Node 1) status...
if "!SHEETS_OK!"=="1" (
    "!PYTHON!" -c "import requests,json,sys; r=requests.get('https://script.google.com/macros/s/AKfycbx-q2qSeCorIEeXPE9d2MgAZLKEFwFNW9lARLE1yYciH9wJWwvktUTuDVLz_rSCbUhkMg/exec?action=get_node_status',timeout=15,allow_redirects=True); data=r.json(); nodes=data if isinstance(data,list) else data.get('data',data.get('nodes',[])); pc=[n for n in nodes if 'pc' in str(n.get('node_id','')).lower() or 'hub' in str(n.get('node_id','')).lower()]; sys.exit(0 if pc else 1)" >nul 2>&1
    if !errorlevel! equ 0 (
        set "PC_STATUS=ONLINE"
        echo         PC Hub ^(Node 1^) - ONLINE
    ) else (
        echo         PC Hub ^(Node 1^) - offline or unknown
    )
) else (
    echo         Skipped ^(no Sheets connection^)
)
echo.

:: ==============================================================
:: STEP 6 - Launch GGM Field
:: ==============================================================

set "APP_VER=?.?.?"
for /f "tokens=2 delims==" %%v in ('findstr /c:"VERSION = " "!ROOT!\platform\field_app.py" 2^>nul') do (
    set "APP_VER=%%v"
    set "APP_VER=!APP_VER: =!"
    set "APP_VER=!APP_VER:"=!"
)

echo   [6/6] Launching GGM Field v!APP_VER!...
echo.
echo   ====================================================
echo    GGM Field v!APP_VER! - Ready!
echo   ----------------------------------------------------
echo.
echo    Tabs: Dashboard, Today, Bookings, Schedule,
echo          Tracking, Clients, Enquiries, Quotes,
echo          Finance, Marketing, Analytics,
echo          PC Triggers, Notes, Health
echo.
if "!SHEETS_OK!"=="1" (
echo    Google Sheets     connected
) else (
echo    Google Sheets     offline
)
if "!PC_STATUS!"=="ONLINE" (
echo    PC Hub [Node 1]   ONLINE
) else (
echo    PC Hub [Node 1]   offline
)
echo    Command Queue     polls every 45s
echo    Heartbeat         every 120s
echo    Offline Queue     auto-retry on reconnect
echo.
echo    No local agents - PC Hub handles everything
echo   ====================================================
echo.
echo   Close the app window to shut down.
echo   ----------------------------------------------------
echo.

title GGM Field v!APP_VER! - Running
cd /d "!ROOT!\platform"
"!PYTHON!" field_app.py

:: ==============================================================
:: SHUTDOWN
:: ==============================================================
echo.
if !errorlevel! neq 0 (
    echo   GGM Field exited with an error.
    echo   Check the output above for details.
    echo.
) else (
    echo   GGM Field closed normally.
)
echo   ====================================================
echo   Goodbye!
echo   ====================================================
echo.
pause
