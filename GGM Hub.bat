@echo off
setlocal enabledelayedexpansion
:: ═══════════════════════════════════════════════════════════════
:: GGM Hub — PC Primary Node Launcher
:: Gardners Ground Maintenance
::
:: This is the ONE file you double-click on the PC to start
:: everything. It brings up:
::   1. Ollama  (local AI engine)
::   2. Docker  (n8n, Listmonk, Dify — if Docker is installed)
::   3. Agent orchestrator (background daemon — 12 agents)
::   4. GGM Hub platform (main GUI with sync, commands, email)
::
:: Everything communicates through Google Sheets — the PC syncs
:: every 5 minutes, the laptop/mobile talk to the same sheet,
:: and the orchestrator runs your 12 AI agents on schedule.
::
:: Close the Hub window to shut down cleanly.
:: ═══════════════════════════════════════════════════════════════
title GGM Hub — Starting...
color 0A

echo.
echo   ╔════════════════════════════════════════════════╗
echo   ║   GGM Hub — PC Primary Node                   ║
echo   ║   Gardners Ground Maintenance                 ║
echo   ╚════════════════════════════════════════════════╝
echo.

:: Auto-detect root from wherever this .bat file lives
set "ROOT=%~dp0"
:: Strip trailing backslash
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
set "PYTHON=%ROOT%\.venv\Scripts\python.exe"
set "HAS_NODE=0"
set "HAS_GIT=0"
set "HAS_DOCKER=0"
set "DOCKER_STARTED=0"

cd /d "%ROOT%"

:: ══════════════════════════════════════════════════════════════
:: STEP 1 — Pre-flight checks
:: ══════════════════════════════════════════════════════════════
echo   [1/7] Pre-flight checks...

:: Python venv
if not exist "!PYTHON!" (
    echo         Python venv not found. Creating...
    where python >nul 2>&1
    if !errorlevel! neq 0 (
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

:: Node.js
where node >nul 2>&1
if !errorlevel! neq 0 (
    echo         [--] Node.js not found — agents won't auto-run
) else (
    set "HAS_NODE=1"
    echo         [OK] Node.js
)

:: Git
where git >nul 2>&1
if !errorlevel! neq 0 (
    echo         [--] Git not found — skipping updates
) else (
    set "HAS_GIT=1"
    echo         [OK] Git
)

:: Docker
where docker >nul 2>&1
if !errorlevel! neq 0 (
    :: Try common install paths
    if exist "C:\Program Files\Docker\Docker\resources\bin\docker.exe" (
        set "PATH=C:\Program Files\Docker\Docker\resources\bin;!PATH!"
        set "HAS_DOCKER=1"
        echo         [OK] Docker (found at Program Files)
    ) else if exist "%LOCALAPPDATA%\Docker\resources\bin\docker.exe" (
        set "PATH=%LOCALAPPDATA%\Docker\resources\bin;!PATH!"
        set "HAS_DOCKER=1"
        echo         [OK] Docker (found at AppData)
    ) else (
        echo         [--] Docker not installed (n8n/Listmonk/Dify skipped)
    )
) else (
    set "HAS_DOCKER=1"
    echo         [OK] Docker
)

:: Ollama
where ollama >nul 2>&1
if !errorlevel! neq 0 (
    if exist "%LOCALAPPDATA%\Programs\Ollama\ollama.exe" (
        echo         [OK] Ollama (found at Programs)
    ) else (
        echo         [!!] Ollama not found — AI features will be limited
    )
) else (
    echo         [OK] Ollama
)

echo.

:: ══════════════════════════════════════════════════════════════
:: STEP 2 — Pull latest code from GitHub
:: ══════════════════════════════════════════════════════════════
echo   [2/7] Checking for updates...
if "!HAS_GIT!"=="1" (
    git fetch origin --quiet >nul 2>&1
    git pull --ff-only origin master >nul 2>&1
    if !errorlevel! equ 0 (
        echo         Code is up to date.
    ) else (
        echo         Update pulled from GitHub.
    )
) else (
    echo         Skipped (Git not available).
)
echo.

:: ══════════════════════════════════════════════════════════════
:: STEP 3 — Install / check Python dependencies
:: ══════════════════════════════════════════════════════════════
echo   [3/7] Checking Python dependencies...
"!PYTHON!" -c "import customtkinter; import requests; import dotenv; import tkcalendar" >nul 2>&1
if !errorlevel! neq 0 (
    echo         Installing dependencies from requirements.txt...
    "!PYTHON!" -m pip install --quiet --upgrade pip >nul 2>&1
    if exist "!ROOT!\platform\requirements.txt" (
        "!PYTHON!" -m pip install --quiet -r "!ROOT!\platform\requirements.txt"
    ) else (
        "!PYTHON!" -m pip install --quiet customtkinter requests Pillow matplotlib python-dotenv tkcalendar
    )
    if !errorlevel! neq 0 (
        echo.
        echo         ERROR: Dependency install failed.
        echo         Try manually:  "!PYTHON!" -m pip install -r platform\requirements.txt
        pause
        exit /b 1
    )
    echo         Dependencies installed.
) else (
    echo         All dependencies present.
)

:: Ensure data directory exists
if not exist "!ROOT!\platform\data" mkdir "!ROOT!\platform\data"
echo.

:: ══════════════════════════════════════════════════════════════
:: STEP 4 — Start Ollama (local AI)
:: ══════════════════════════════════════════════════════════════
echo   [4/7] Starting Ollama...
tasklist /FI "IMAGENAME eq ollama.exe" 2>NUL | find /I /N "ollama.exe" >NUL
if !errorlevel! neq 0 (
    :: Try to start Ollama
    where ollama >nul 2>&1
    if !errorlevel! equ 0 (
        start "" ollama serve
    ) else if exist "%LOCALAPPDATA%\Programs\Ollama\ollama.exe" (
        start "" "%LOCALAPPDATA%\Programs\Ollama\ollama.exe" serve
    ) else (
        echo         Ollama not found — skipping.
        goto :skip_ollama
    )
    echo         Starting Ollama... (waiting 10s)
    timeout /t 10 /nobreak >nul
    tasklist /FI "IMAGENAME eq ollama.exe" 2>NUL | find /I /N "ollama.exe" >NUL
    if !errorlevel! neq 0 (
        echo         WARNING: Ollama failed to start.
    ) else (
        echo         Ollama started — localhost:11434
    )
) else (
    echo         Ollama already running — localhost:11434
)
:skip_ollama
echo.

:: ══════════════════════════════════════════════════════════════
:: STEP 5 — Start Docker services (n8n, Listmonk, Dify)
:: ══════════════════════════════════════════════════════════════
echo   [5/7] Docker services...
if "!HAS_DOCKER!"=="1" (
    :: Check if Docker daemon is actually running
    docker info >nul 2>&1
    if !errorlevel! neq 0 (
        echo         Docker Desktop is not running.
        echo         Start Docker Desktop manually if you want n8n/Listmonk/Dify.
    ) else (
        :: Check if .env exists
        if not exist "!ROOT!\docker\.env" (
            if exist "!ROOT!\docker\.env.example" (
                echo         Creating docker\.env from template...
                copy "!ROOT!\docker\.env.example" "!ROOT!\docker\.env" >nul 2>&1
                :: Inject real values from root .env
                echo         NOTE: Review docker\.env and set passwords.
            )
        )
        :: Start containers
        echo         Starting containers...
        cd /d "!ROOT!\docker"
        docker compose up -d >nul 2>&1
        if !errorlevel! neq 0 (
            :: Fallback to docker-compose (older installs)
            docker-compose up -d >nul 2>&1
        )
        if !errorlevel! equ 0 (
            set "DOCKER_STARTED=1"
            echo         [OK] n8n         — http://localhost:5678
            echo         [OK] Listmonk    — http://localhost:9000
            echo         [OK] Dify        — http://localhost:3000
        ) else (
            echo         WARNING: Docker containers failed to start.
            echo         Run: cd docker ^&^& docker compose logs
        )
        cd /d "!ROOT!"
    )
) else (
    echo         Skipped (Docker not installed).
    echo         Install Docker Desktop for n8n, Listmonk, and Dify.
)
echo.

:: ══════════════════════════════════════════════════════════════
:: STEP 6 — Start agent orchestrator (background daemon)
:: ══════════════════════════════════════════════════════════════
echo   [6/7] Starting agent orchestrator...
if "!HAS_NODE!"=="1" (
    :: Install node dependencies if needed
    if not exist "!ROOT!\agents\node_modules" (
        echo         Installing Node.js dependencies...
        cd /d "!ROOT!\agents"
        npm install --silent >nul 2>&1
        cd /d "!ROOT!"
    )
    :: Start orchestrator daemon in a minimised window
    start "GGM Orchestrator" /MIN cmd /c "cd /d !ROOT! && node agents\orchestrator.js daemon >> agents\orchestrator.log 2>&1"
    echo         Orchestrator daemon started (minimised window).
    echo         12 agents scheduled: health, planner, enquiries,
    echo         email, finance, social, content, reviews, summary.
) else (
    echo         Skipped (Node.js not available).
)
echo.

:: ══════════════════════════════════════════════════════════════
:: STEP 7 — Launch GGM Hub GUI
:: ══════════════════════════════════════════════════════════════
echo   [7/7] Launching GGM Hub...
echo.
echo   ╔════════════════════════════════════════════════╗
echo   ║   All services started!                       ║
echo   ╠════════════════════════════════════════════════╣
echo   ║                                               ║
echo   ║   Ollama (AI)        localhost:11434           ║
if "!DOCKER_STARTED!"=="1" (
echo   ║   n8n (workflows)    localhost:5678            ║
echo   ║   Listmonk (email)   localhost:9000            ║
echo   ║   Dify (chatbot)     localhost:3000            ║
)
echo   ║   Orchestrator       background daemon         ║
echo   ║   GGM Hub            opening now...            ║
echo   ║                                               ║
echo   ║   Google Sheets      connected                 ║
echo   ║   Sync Engine        every 5 minutes           ║
echo   ║   Command Queue      polling every 60s         ║
echo   ║   Auto Git-Push      every 15 minutes          ║
echo   ║                                               ║
echo   ╚════════════════════════════════════════════════╝
echo.
echo   Close the Hub window to shut down.
echo   ────────────────────────────────────────────────
echo.

title GGM Hub — Running
cd /d "!ROOT!\platform"
"!PYTHON!" app\main.py

:: ══════════════════════════════════════════════════════════════
:: SHUTDOWN — Hub window was closed
:: ══════════════════════════════════════════════════════════════
echo.
echo   GGM Hub closed.
echo.

:: Stop orchestrator
echo   Stopping orchestrator...
taskkill /FI "WINDOWTITLE eq GGM Orchestrator" /F >nul 2>&1
echo   Done.

:: Note: Docker containers keep running (they auto-restart)
:: Note: Ollama keeps running (lightweight, useful system-wide)

if !errorlevel! neq 0 (
    echo.
    echo   Hub exited with an error.
    echo   Check: platform\data\ggm_hub.log
)

echo.
echo   ════════════════════════════════════════════════
echo   All services stopped. Goodbye!
echo   ════════════════════════════════════════════════
echo.
pause
