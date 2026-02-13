# GGM Hub — PC Node (Node 1) Upgrade Prompt

## Context: What You're Working With

This is **GGM Hub** — a multi-node business platform for **Gardners Ground Maintenance** (sole trader, Cornwall). The system runs across 3 nodes:

| Node | App | Location | Version | Role |
|------|-----|----------|---------|------|
| **Node 1 — PC Hub** | `platform/app/` (CustomTkinter) | Desktop PC | `4.0.0` (in `app/config.py`) | Heavy processing: agents, email, sync, blog, newsletter |
| **Node 2 — Field App** | `platform/field_app.py` (CustomTkinter) | Laptop / SSD | `3.1.0` | Field companion: jobs, invoicing, monitoring, triggers |
| **Node 3 — Mobile App** | `mobile/` (React Native) | Phone | `1.0.0` | En route/start/complete jobs, photos |

All 3 nodes communicate via **Google Apps Script** (GAS) — `apps-script/Code.gs` (17,048 lines) — which reads/writes to Google Sheets. There is **no direct network connection** between nodes.

### Architecture Diagram
```
📱 Mobile (Node 3) → GAS (Google Sheets) ← 💻 Field App (Node 2)
                          ↕
                    🖥️ PC Hub (Node 1)
```

### Communication Mechanism
- **Heartbeat**: Both PC Hub and Field App POST to `node_heartbeat` every 2 minutes and GET `get_node_status` to see each other. GAS stores heartbeats in a `NodeHeartbeats` sheet and marks nodes offline if no heartbeat for 5 minutes.
- **Command Queue**: Field App (Laptop) queues commands for PC Hub via `queue_remote_command`. PC Hub polls `get_remote_commands` every 60 seconds and executes them. This is how the laptop triggers heavy processing (blogs, newsletters, emails, agents).
- **Both nodes pull from the same GitHub repo** (`gardnersgm-website`, branch `master`). PC Hub auto-pulls on startup (`app/updater.py`). Field App has a "Pull Updates" button.

---

## What's Already Done (Field App — Node 2)

The Field App has been upgraded to v3.1.0 with these features:
1. ✅ **13 tabs**: Dashboard, Today, Bookings, Schedule, Tracking, Clients, Enquiries, Invoices, Triggers, Notes, Health
2. ✅ **Interactive dashboard**: Clickable KPI cards, job action buttons, unified activity feed (system events + bookings), payment status badges
3. ✅ **Notification bell**: Red badge, popup panel with clickable notifications (unpaid invoices, new enquiries, pending quotes, jobs needing action, PC offline)
4. ✅ **System Health tab**: Tests GAS API, Google Sheets, Stripe API/balance/customers/invoices, webhooks, invoice pipeline integrity, email system, Telegram bots, PC status
5. ✅ **Proper heartbeat**: Sends heartbeat to GAS every 2 minutes via `node_heartbeat`, reads peer statuses via `get_node_status`
6. ✅ **Version tracking**: Shows `v3.1.0 (abc1234)` in sidebar, checks for updates from GitHub, shows "Update available" if behind, shows PC Hub version when online

---

## What the PC Hub (Node 1) Needs — YOUR TASKS

### TASK 1: Enable Heartbeat Service

The `HeartbeatService` class exists in `platform/app/heartbeat.py` but is **never started** in `main.py`. The GAS endpoints (`node_heartbeat`, `get_node_status`) already exist and work. The Field App is already sending heartbeats.

**What to do:**
1. In `platform/app/main.py`, after the command queue starts, add:
   ```python
   from app.heartbeat import HeartbeatService
   heartbeat = HeartbeatService(api=api, node_id="pc_hub", node_type="pc", version=config.APP_VERSION)
   heartbeat.start()
   logger.info("Heartbeat service started")
   ```
2. Pass `heartbeat` to the shutdown function so it calls `heartbeat.stop()` on exit.
3. Pass `heartbeat` to `AppWindow` so the UI can display peer status.

**Files to edit:** `platform/app/main.py`

---

### TASK 2: Show Version + Peer Status in PC Hub UI

The PC Hub UI needs to show:
- Its own version (`4.0.0`) + git commit hash
- Field App (Node 2) status: online/offline, their version, last heartbeat age
- Whether an update is available from GitHub

**What to do:**
1. In `platform/app/ui/app_window.py`, add a status bar or sidebar section showing:
   - `🖥️ PC Hub v4.0.0 (abc1234)` — own version
   - `💻 Field App v3.1.0 — Online (25s ago)` or `💻 Field App — Offline`
   - `📱 Mobile v1.0.0 — Online` (if mobile sends heartbeats)
   - `⬇️ Update available (def5678)` if behind GitHub remote
2. Use the `HeartbeatService.get_peer_status()` method to get Field App status
3. Refresh this display every 30 seconds

**Expected `get_node_status` response format from GAS:**
```json
{
  "status": "success",
  "nodes": [
    {
      "node_id": "field_laptop",
      "node_type": "laptop",
      "version": "3.1.0",
      "last_heartbeat": "2026-02-13T21:00:00.000Z",
      "host": "LAPTOP-XYZ",
      "status": "online",
      "uptime": "2h 15m",
      "details": "Field App v3.1.0 (abc1234)",
      "age_seconds": 25,
      "age_human": "25s ago"
    }
  ]
}
```

**Files to edit:** `platform/app/ui/app_window.py`, possibly `platform/app/tabs/overview.py`

---

### TASK 3: Sync Version Tracking

Create a unified version check so both nodes know what version the other is running and what's latest.

**What to do:**
1. In `platform/app/config.py`, add a `GIT_COMMIT` constant:
   ```python
   import subprocess
   def _get_git_commit():
       try:
           r = subprocess.run(["git", "rev-parse", "--short", "HEAD"],
                              cwd=str(PROJECT_ROOT), capture_output=True, text=True, timeout=5)
           return r.stdout.strip() if r.returncode == 0 else ""
       except: return ""
   GIT_COMMIT = _get_git_commit()
   ```
2. The heartbeat already sends `version` — update it to also send `GIT_COMMIT` in the `details` field
3. In the Overview tab, show a "Network" section with all node statuses and versions

**Files to edit:** `platform/app/config.py`

---

### TASK 4: Bidirectional Command Queue (PC → Laptop)

Currently commands only flow **Laptop → PC**. The PC Hub needs to be able to send commands to the Field App too.

**What to do:**
1. In `platform/field_app.py`, note the Field App already has a `_tab_triggers` that sends commands TO the PC. Mirror this: the Field App should poll for commands targeted at it.
   - Actually, this is already partially handled — the `get_remote_commands` endpoint can filter by `target`. But neither the GAS endpoint nor the command queue currently supports a `target` field.

2. **In GAS (`apps-script/Code.gs`)**, update the `RemoteCommands` sheet structure to add a `target` column:
   - Current columns: `id, command, data, source, status, created_at, completed_at, result`
   - New: add `target` column (values: `pc_hub`, `field_laptop`, `mobile`)
   - Update `queueRemoteCommand()` to accept `target` param (default: `pc_hub`)
   - Update `getRemoteCommands()` to filter by `target` param
   - Update `updateRemoteCommand()` to work with target filtering

3. **In `platform/app/command_queue.py`**, update `_process_pending()`:
   ```python
   resp = self.api.get(action="get_remote_commands",
                       params={"status": "pending", "target": "pc_hub"})
   ```

4. **In `platform/field_app.py`**, add polling for laptop-targeted commands:
   - The Field App already has `_start_auto_refresh()` running every 45 seconds
   - Add a check within that cycle for `get_remote_commands?status=pending&target=field_laptop`
   - Supported laptop commands: `force_refresh`, `show_notification`, `navigate_to_tab`

**Files to edit:**
- `apps-script/Code.gs` (lines 16609-16700: `queueRemoteCommand`, `getRemoteCommands`, `updateRemoteCommand`)
- `platform/app/command_queue.py`
- `platform/field_app.py` (optional — the Field App side can be done separately)

---

### TASK 5: Overview Tab — Network Status Panel

Add a "Network" panel to the PC Hub's Overview tab showing all nodes.

**What to do:**
1. In `platform/app/tabs/overview.py`, add a section with:
   ```
   ┌─────────────────────────────────────────────────┐
   │  🌐 Network Status                              │
   ├─────────────────────────────────────────────────┤
   │  🖥️  PC Hub      v4.0.0 (abc1234)  🟢 Online   │
   │  💻  Field App   v3.1.0 (def5678)  🟢 25s ago   │
   │  📱  Mobile App  v1.0.0            🔴 Offline   │
   ├─────────────────────────────────────────────────┤
   │  Git: master @ abc1234  │  ⬇️ 2 updates pending │
   └─────────────────────────────────────────────────┘
   ```
2. Use `self.heartbeat.get_peer_status()` for live data
3. Use `updater.check_for_updates()` for update info
4. Auto-refresh every 30 seconds

**Files to edit:** `platform/app/tabs/overview.py`

---

### TASK 6: Remote Command Feedback

When the PC Hub executes a command from the laptop, the Field App has no way to see the result other than checking the command status. Improve this:

**What to do:**
1. After the PC finishes a command, send a Telegram notification to the DayBot:
   ```
   ✅ PC Hub completed: generate_blog
   Result: Blog draft created: "10 Lawn Care Tips for Spring"
   ```
2. The command result is already written to the RemoteCommands sheet (`result` column) — the Field App can read it. Add a "Command History" section to the Field App's Triggers tab showing recent command results.

**Files to edit:**
- `platform/app/command_queue.py` (add Telegram notification after command execution)
- Optional: `platform/field_app.py` `_tab_triggers()` section

---

### TASK 7: Startup Health Check

When the PC Hub starts, run a quick health check and log/display results.

**What to do:**
1. After all services start in `main.py`, run a diagnostics check:
   - GAS webhook reachable? ✅/❌
   - Stripe API key valid? ✅/❌
   - Telegram bot responding? ✅/❌
   - Database healthy? ✅/❌
   - Last sync timestamp?
   - Git status (clean/dirty, commits behind)?
2. Log results and show a brief status toast in the UI
3. If any critical check fails, show a warning banner in the Overview tab

**Files to edit:** `platform/app/main.py`, `platform/app/tabs/overview.py`

---

## Key Files Reference

### PC Hub (Node 1) — `platform/app/`
| File | Purpose | Key Classes/Functions |
|------|---------|----------------------|
| `main.py` | Entry point, service orchestration | `main()`, `_shutdown()` |
| `config.py` | Configuration (.env loader) | `APP_VERSION="4.0.0"`, `SHEETS_WEBHOOK` |
| `api.py` | HTTP client for GAS | `APIClient.get()`, `APIClient.post()` |
| `heartbeat.py` | Node heartbeat (NOT STARTED) | `HeartbeatService.start()`, `.get_peer_status()` |
| `command_queue.py` | Remote command executor | `CommandQueue._process_pending()`, `COMMAND_TYPES` |
| `updater.py` | Auto-update from GitHub | `auto_update()`, `check_for_updates()` |
| `sync.py` | Bidirectional Sheets↔SQLite sync | `SyncEngine.start()`, `.force_sync()` |
| `database.py` | SQLite local DB | `Database` class |
| `ui/app_window.py` | Main window, tab management | `AppWindow` class |
| `ui/pin_screen.py` | PIN lock screen | `PinScreen` class |
| `tabs/overview.py` | Dashboard/overview tab | Main KPI display |
| `tabs/dispatch.py` | Job dispatch | Today's jobs management |
| `tabs/operations.py` | Operations management | Bookings, schedule |
| `tabs/finance.py` | Finance tab | Invoices, payments, revenue |
| `tabs/telegram.py` | Telegram integration | Bot messaging |
| `tabs/marketing.py` | Marketing tab | Blog, newsletter |
| `tabs/customer_care.py` | CRM tab | Clients, enquiries |
| `tabs/admin.py` | Admin/settings tab | System config |

### GAS Endpoints for Cross-Node Communication
| Action | Method | Purpose |
|--------|--------|---------|
| `node_heartbeat` | POST | Send heartbeat (node_id, version, host, uptime) |
| `get_node_status` | GET | Get all node statuses (online/offline, age) |
| `queue_remote_command` | POST | Laptop queues command for PC |
| `get_remote_commands` | GET | PC polls for pending commands |
| `update_remote_command` | POST | PC marks command done/failed |

### Heartbeat Data Stored in Google Sheets (`NodeHeartbeats` sheet)
| Column | Content |
|--------|---------|
| A | node_id (e.g., `pc_hub`, `field_laptop`) |
| B | node_type (e.g., `pc`, `laptop`) |
| C | version (e.g., `4.0.0`) |
| D | last_heartbeat (ISO timestamp) |
| E | host (hostname) |
| F | status (`online`/`offline`) |
| G | uptime (e.g., `2h 15m`) |
| H | details (freeform, e.g., `Field App v3.1.0 (abc1234)`) |

### Remote Command Types
| Command | Description | Triggered From |
|---------|-------------|---------------|
| `generate_blog` | AI blog post creation | Laptop Triggers tab |
| `generate_newsletter` | Monthly newsletter | Laptop Triggers tab |
| `send_reminders` | Day-before job reminders | Laptop Triggers tab |
| `send_completion` | Job completion email | Laptop Today tab |
| `send_enquiry_reply` | Reply to enquiry | Laptop Enquiries tab |
| `send_booking_confirmation` | Booking confirmation | Laptop Bookings tab |
| `send_quote_email` | Send quote to prospect | Laptop Quotes tab |
| `run_email_lifecycle` | Full email engine run | Laptop Triggers tab |
| `force_sync` | Immediate full data sync | Laptop Triggers tab |
| `run_agent` | Run specific AI agent | Laptop Triggers tab |
| `send_invoice` | Send invoice email | Laptop invoices |

---

## Environment Variables (`.env` at project root or platform/)
```
TG_BOT_TOKEN=<telegram_bot_token>
TG_CHAT_ID=<telegram_chat_id>
TG_MONEY_TOKEN=<money_bot_token>
SHEETS_WEBHOOK=<google_apps_script_url>
STRIPE_KEY=<stripe_api_key>
PEXELS_KEY=<pexels_api_key>
OLLAMA_URL=http://localhost:11434
```

---

## Priority Order

1. **TASK 1** — Enable heartbeat (5 min, critical)
2. **TASK 3** — Git commit in config (2 min, easy)
3. **TASK 5** — Network status panel in Overview (20 min)
4. **TASK 2** — Version display in sidebar/status bar (10 min)
5. **TASK 7** — Startup health check (15 min)
6. **TASK 6** — Command feedback via Telegram (10 min)
7. **TASK 4** — Bidirectional command queue (30 min, needs GAS changes)

## Important Notes

- **DO NOT hardcode API keys or tokens** — always use `os.getenv()` from `.env`
- The PC Hub uses `app/api.py`'s `APIClient` for all HTTP calls — don't use `requests` directly
- The `HeartbeatService` in `heartbeat.py` is complete and tested — just needs to be started
- The GAS endpoints for heartbeat (`node_heartbeat`, `get_node_status`) already exist and work (Code.gs lines 16764-16857)
- After making changes, the PC Hub auto-pushes to GitHub via `auto_push.py`, and the Field App can pull updates
- Version should be bumped to `4.1.0` in `config.py` after these changes
