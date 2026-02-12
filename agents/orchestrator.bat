@echo off
REM ── Gardners GM — Orchestrator (Central Node) ──
REM Runs all agents at their scheduled times
cd /d D:\gardening

REM Start Ollama if not running
tasklist /FI "IMAGENAME eq ollama.exe" 2>NUL | find /I /N "ollama.exe" >NUL
if %ERRORLEVEL% NEQ 0 (
    start "" "ollama" serve
    timeout /t 10 /nobreak >nul
)

REM Run orchestrator
node agents\orchestrator.js >> agents\orchestrator.log 2>&1
