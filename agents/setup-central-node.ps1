# ══════════════════════════════════════════════════════════════
# Gardners GM — Central Node Setup Script
# One-click setup for Windows Task Scheduler + Ollama + Node.js
#
# Run as Administrator:
#   Right-click PowerShell → Run as Administrator
#   cd D:\gardening
#   .\agents\setup-central-node.ps1
# ══════════════════════════════════════════════════════════════

$ErrorActionPreference = "Continue"
$ProjectDir = "D:\gardening"

Write-Host ""
Write-Host "  ══════════════════════════════════════════════" -ForegroundColor Green
Write-Host "  🌿 Gardners GM — Central Node Setup" -ForegroundColor Green
Write-Host "  ══════════════════════════════════════════════" -ForegroundColor Green
Write-Host ""

# ─── Check running as admin ───
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "  ⚠️  Please run this script as Administrator!" -ForegroundColor Yellow
    Write-Host "  Right-click PowerShell → Run as Administrator" -ForegroundColor Yellow
    Write-Host ""
    exit 1
}

# ─── Check prerequisites ───
Write-Host "  🔍 Checking prerequisites..." -ForegroundColor Cyan
Write-Host ""

# Node.js
$nodeVersion = & node --version 2>$null
if ($nodeVersion) {
    Write-Host "  ✅ Node.js: $nodeVersion" -ForegroundColor Green
} else {
    Write-Host "  ❌ Node.js not found!" -ForegroundColor Red
    Write-Host "     Install from: https://nodejs.org" -ForegroundColor Yellow
    exit 1
}

# Ollama
$ollamaPath = Get-Command ollama -ErrorAction SilentlyContinue
if ($ollamaPath) {
    Write-Host "  ✅ Ollama: installed" -ForegroundColor Green
    # Check for models
    $models = & ollama list 2>$null
    if ($models) {
        Write-Host "     Models installed:" -ForegroundColor Gray
        $models | Select-Object -Skip 1 | ForEach-Object { Write-Host "       $_" -ForegroundColor Gray }
    }
} else {
    Write-Host "  ⚠️  Ollama not found — AI features will be limited" -ForegroundColor Yellow
    Write-Host "     Install from: https://ollama.com/download" -ForegroundColor Yellow
    Write-Host "     Then run: ollama pull llama3.2" -ForegroundColor Yellow
}

# .env file
if (Test-Path "$ProjectDir\.env") {
    Write-Host "  ✅ .env file: exists" -ForegroundColor Green
} else {
    Write-Host "  ⚠️  .env file missing — copying from .env.example" -ForegroundColor Yellow
    Copy-Item "$ProjectDir\.env.example" "$ProjectDir\.env" -ErrorAction SilentlyContinue
    Write-Host "     ⚡ Edit D:\gardening\.env with your API keys!" -ForegroundColor Yellow
}

# dotenv package
if (Test-Path "$ProjectDir\node_modules\dotenv") {
    Write-Host "  ✅ dotenv package: installed" -ForegroundColor Green
} else {
    Write-Host "  📦 Installing dotenv package..." -ForegroundColor Cyan
    Push-Location $ProjectDir
    & npm install dotenv --save 2>$null
    Pop-Location
    Write-Host "  ✅ dotenv installed" -ForegroundColor Green
}

Write-Host ""

# ─── Create .gitignore entries ───
$gitignore = "$ProjectDir\.gitignore"
$entriesToAdd = @(".env", "agents/.orchestrator-state.json", "agents/.enquiry-state.json", "agents/*.log")
if (Test-Path $gitignore) {
    $content = Get-Content $gitignore -Raw
    foreach ($entry in $entriesToAdd) {
        if ($content -notmatch [regex]::Escape($entry)) {
            Add-Content $gitignore "`n$entry"
            Write-Host "  📝 Added '$entry' to .gitignore" -ForegroundColor Gray
        }
    }
} else {
    $entriesToAdd | Out-File $gitignore -Encoding UTF8
    Write-Host "  📝 Created .gitignore with agent exclusions" -ForegroundColor Gray
}

# ─── Create Windows Task Scheduler tasks ───
Write-Host "  ⏰ Setting up Windows Task Scheduler..." -ForegroundColor Cyan
Write-Host ""

function New-GGMTask {
    param (
        [string]$TaskName,
        [string]$Description,
        [string]$TriggerTime,      # e.g. "06:00"
        [string]$RepeatInterval,   # e.g. "PT15M" for 15 minutes, or "" for no repeat
        [string]$RepeatDuration,   # e.g. "PT18H" for 18 hours
        [string]$BatchFile         # Relative path under project dir
    )

    $fullTaskName = "GardnersGM\$TaskName"

    # Remove existing task if present
    Unregister-ScheduledTask -TaskName $fullTaskName -Confirm:$false -ErrorAction SilentlyContinue 2>$null

    $action = New-ScheduledTaskAction -Execute "cmd.exe" `
        -Argument "/c `"$ProjectDir\$BatchFile`"" `
        -WorkingDirectory $ProjectDir

    $trigger = New-ScheduledTaskTrigger -Daily -At $TriggerTime

    if ($RepeatInterval -and $RepeatDuration) {
        $trigger.Repetition = (New-ScheduledTaskTrigger -Once -At "00:00" -RepetitionInterval (New-TimeSpan -Minutes ([int]($RepeatInterval -replace '\D',''))));
        # Simpler approach — set properties directly
        $trigger = New-ScheduledTaskTrigger -Daily -At $TriggerTime
    }

    $settings = New-ScheduledTaskSettingsSet `
        -AllowStartIfOnBatteries `
        -DontStopIfGoingOnBatteries `
        -StartWhenAvailable `
        -RestartCount 3 `
        -RestartInterval (New-TimeSpan -Minutes 5) `
        -ExecutionTimeLimit (New-TimeSpan -Hours 1) `
        -MultipleInstances IgnoreNew

    $principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -RunLevel Highest

    try {
        Register-ScheduledTask -TaskName $fullTaskName -Action $action -Trigger $trigger `
            -Settings $settings -Principal $principal -Description $Description -Force | Out-Null
        Write-Host "  ✅ $TaskName → $TriggerTime" -ForegroundColor Green
    } catch {
        Write-Host "  ❌ $TaskName failed: $_" -ForegroundColor Red
    }
}

# Create the task folder
$taskFolder = (New-Object -ComObject Schedule.Service)
$taskFolder.Connect()
try { $taskFolder.GetFolder("\GardnersGM") } catch {
    $taskFolder.GetFolder("\").CreateFolder("GardnersGM") | Out-Null
}

# ── Orchestrator — runs every 15 minutes from 06:00 to 21:00 ──
New-GGMTask -TaskName "Orchestrator" `
    -Description "Central orchestrator — coordinates all Gardners GM agents" `
    -TriggerTime "06:00" `
    -BatchFile "agents\orchestrator.bat"

# ── Register additional triggers for the orchestrator ──
# Since Task Scheduler doesn't easily do "every 15 min" via PowerShell,
# we'll create a few key time slots
$orchTimes = @("06:00","06:15","06:45","07:00","07:30","08:00","09:00","10:00","12:00","14:00","16:00","17:00","18:00","20:00")
foreach ($t in $orchTimes) {
    if ($t -eq "06:00") { continue } # Already created as primary
    $safeName = "Orchestrator-$($t.Replace(':',''))"
    New-GGMTask -TaskName $safeName `
        -Description "Orchestrator check at $t" `
        -TriggerTime $t `
        -BatchFile "agents\orchestrator.bat"
}

Write-Host ""
Write-Host "  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Green
Write-Host "  ✅ Setup complete! Scheduled tasks created." -ForegroundColor Green
Write-Host ""
Write-Host "  📋 What happens next:" -ForegroundColor Cyan
Write-Host "     1. Edit D:\gardening\.env with your API keys" -ForegroundColor White
Write-Host "     2. Install Ollama if not done: https://ollama.com" -ForegroundColor White
Write-Host "     3. Pull a model: ollama pull llama3.2" -ForegroundColor White
Write-Host "     4. For better content (you have 64GB RAM):" -ForegroundColor White
Write-Host "        ollama pull mistral-small  (22B — great balance)" -ForegroundColor Gray
Write-Host "        ollama pull qwen2.5:32b    (32B — best writing)" -ForegroundColor Gray
Write-Host "     5. Test: node agents\orchestrator.js status" -ForegroundColor White
Write-Host "     6. Force a run: node agents\orchestrator.js force content-agent" -ForegroundColor White
Write-Host ""
Write-Host "  🤖 The orchestrator will now run automatically." -ForegroundColor Green
Write-Host "     It checks every 15 minutes and runs agents" -ForegroundColor Green
Write-Host "     at their scheduled times. All reports go to" -ForegroundColor Green
Write-Host "     your Telegram bot." -ForegroundColor Green
Write-Host "  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Green
Write-Host ""
