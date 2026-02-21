# GGM Hub — Gardners Ground Maintenance

> **A 3-node field operations platform for a gardening & landscaping business in Cornwall, UK.**

[![Website](https://img.shields.io/badge/Website-gardnersgm.co.uk-green)](https://www.gardnersgm.co.uk)
[![Location](https://img.shields.io/badge/Base-Roche%2C%20Cornwall-blue)]()
[![Version Hub](https://img.shields.io/badge/Hub-v4.8.0-blue)]()
[![Version Field](https://img.shields.io/badge/Field%20App-v2.4.0-blue)]()
[![Mobile](https://img.shields.io/badge/Mobile-v2.4.0-orange)]()
[![Stripe](https://img.shields.io/badge/Stripe-18%20webhooks-purple)]()
[![Telegram](https://img.shields.io/badge/Telegram-4%20bots-blue)]()

---

## 🚨 NODE 1 ACTION REQUIRED — Mobile APK Rebuild (2026-02-21)

> **Node 1 Copilot: Execute ALL steps below immediately on pull.**
> **Previous Code.gs redeploy already completed (deployed @160 from laptop via clasp).**

### 1. Rebuild Mobile APK (REQUIRED)

The mobile app has **14 bug fixes** from a full platform audit. These are JS-only changes already in the repo — the phone just needs a fresh APK.

```powershell
# On Node 1 (PC Hub) — run in PowerShell
cd C:\GGM-Hub\mobile
npm install
npx eas login    # username: chrisgardner   password: @Cruxy2025!
npx eas build --platform android --profile preview --non-interactive
```

Once the build completes (~5-10 min on EAS cloud), download the APK from the Expo dashboard and sideload to the phone via USB:
```powershell
# After downloading the .apk from https://expo.dev/accounts/chrisgardner/projects/ggm-field-app/builds
adb install -r <path-to-downloaded.apk>
```

**If EAS is not set up on Node 1, use OTA update instead (faster):**
```powershell
cd C:\GGM-Hub\mobile
npx eas login
npx eas update --branch preview --message "Audit fixes v2.4.1 - GPS, photos, schedule, notifications"
```
Then restart the app on the phone — it will pull the JS bundle update automatically.

### What changed in mobile (commits `56cb7d1` + `ca85882`):

| Severity | File | Fix |
|----------|------|-----|
| **CRITICAL** | `location.js` | GPS coordinates were **silently lost** — mobile sent `en-route_lat` etc. but GAS expected `latitude`/`longitude`. Now sends both key formats. |
| **HIGH** | `heartbeat.js` | Version reported as `2.0.0` instead of `2.4.0` — status bar showed wrong version. Fixed. |
| **MEDIUM** | `api.js` | Sunday schedule bug — `getDay()=0` made Sunday show next week's schedule instead of current week. Fixed. |
| **MEDIUM** | `App.js` | Notification taps were a no-op (just `console.log`). Now navigates to JobDetail screen via `navigationRef`. |
| **MEDIUM** | `SettingsScreen.js` | Status always showed "✅ Connected" even when offline. Now tests real connectivity via heartbeat data. |

### What changed in Hub Python (same commits, auto-pulled):

| Severity | File | Fix |
|----------|------|-----|
| **CRITICAL** | `agents.py` | Blog + newsletter auto-published without review → now saves as Draft with Telegram approval request |
| **CRITICAL** | `sync.py` | `execute_query()`/`execute_update()` methods didn't exist on Database class → fixed to `fetchall()`/`execute()` |
| **CRITICAL** | `email_automation.py` | GDPR opt-out returned False (not opted out) on exception → now fail-closed for marketing emails |
| **HIGH** | `command_queue.py` | 5× `api.post()` calls used wrong keyword-arg signature → all silently failed. Fixed to positional args. |
| **HIGH** | `database.py` | Duplicate `get_recent_bookings` (second definition shadowed first). Removed duplicate. |
| **HIGH** | `overview.py` | `send_telegram()` blocked UI thread on "Mark Complete" → moved to background thread |
| **HIGH** | `app_window.py` | All 12 tab modules re-imported on every tab switch → now cached after first import |
| **HIGH** | `overview.py` | Mobile Node 3 always showed "Offline" — queried `"mobile"` but heartbeat sends `"mobile-field"`. Fixed. |

### What changed in Code.gs (already deployed @160 via clasp):

| Severity | File | Fix |
|----------|------|-----|
| **HIGH** | `Code.gs` | Job photos uploaded to Drive but never notified Telegram. Now sends 📸 notification with Drive link. |

### 2. Verify after rebuild

After installing the new APK / OTA update on the phone:
1. Open GGM Field app → check Settings → Status should show "✅ Connected" or "❌ Offline" (not hardcoded)
2. Check Hub Overview → Network Status → Mobile (Node 3) should show "Online • seen just now"
3. Start a test job → GPS location should now be stored in the "Job Locations" sheet
4. Take a test photo → should appear in Telegram as "📸 Job Photo Uploaded"

**After confirming, delete this section.**

---

## Architecture

| Node | Role | Location | Stack |
|------|------|----------|-------|
| **Node 1 — PC Hub** | Main server. Runs all background services, AI agents, email automation, data sync. | Desktop PC, `C:\GGM-Hub` | Python + CustomTkinter, 14 tabs |
| **Node 2 — Field Laptop** | Developer workstation & field companion. Pushes code via Git. | Laptop, `D:\gardening` | Python + CustomTkinter, 14 tabs |
| **Node 3 — Mobile** | React Native field companion app for on-site job management. | Android Phone | Expo + React Native, 5 screens |

### Communication Flow

```
Laptop ──git push──→ GitHub ──auto-pull (15min)──→ PC Hub
Laptop ──GAS webhook──→ Google Sheets ──polled by──→ PC Hub (CommandQueue 60s)
PC Hub ──GAS webhook──→ Google Sheets ──polled by──→ Laptop (CommandListener 15s)
PC Hub ──GAS webhook──→ Google Sheets (heartbeat, sync, emails, newsletters)
All Nodes ──POST──→ Google Apps Script (Code.gs) ──reads/writes──→ Google Sheets
Mobile ──REST──→ GAS webhook ──→ Google Sheets
Stripe ──webhook──→ GAS (18 event types) ──→ Sheets + MoneyBot Telegram
```

**There is NO direct networking between nodes.** All communication flows through:
1. **GitHub** (code changes)
2. **Google Apps Script webhook** (data sync, commands, heartbeat)

---

## Node Change Log

> **Both Node 1 and Node 2 Copilots: update this section when pushing changes.**
> This is your shared notebook. Check what the other node pushed before you make changes.

### Node 2 (Laptop) Changes

| Date | Version | Commit | Changes |
|------|---------|--------|---------|
| 2026-02-20 | mobile v2.4.0 | `1ceff46` | **🚨 BUILD REQUIRED on Node 1.** (1) Fixed Expo push token `projectId` — was using slug `'ggm-field-app'`, now uses EAS UUID `'d17fe848-6644-4d9e-8745-895ab41ba6d0'`. Push registration silently failed. (2) Enabled OTA updates in `app.json` — `updates.enabled: true`, `runtimeVersion: appVersion`, EAS Update URL set. (3) Version 2.3.0 → 2.4.0. **After this APK build, future JS fixes deploy via `eas update` without rebuild.** |
| 2026-02-20 | agents | `afd4cd8` | **Agent admin auth + mobile push.** (1) `email-lifecycle.js`: Added `authUrl()`/`authBody()` helpers, injected `adminToken` into `get_email_history` GET and `queue_remote_command` POST. (2) `apps-script/Code.gs`: Added `register_push_token` + `log_mobile_activity` POST routes, `get_mobile_push_tokens` GET route, `sendExpoPush()` function (Expo push API), `handleRegisterPushToken()`, `handleGetMobilePushTokens()`, `handleLogMobileActivity()`. (3) `notifyBot()` now also calls `sendExpoPush()` — all 4 bots push to both Telegram AND mobile (best-effort, never blocks Telegram). **Must redeploy Code.gs.** |
| 2026-02-20 | agents | `308b426`+ | **All 5 standalone agents auth-fixed.** `finance-dashboard.js` (3 calls), `content-agent.js` (5 calls), `morning-planner.js` (4 calls), `social-media.js` (2 calls), `email-lifecycle.js` (2 calls) — all now inject `adminToken` via `authUrl()`/`authBody()` helpers. Previously got 404 "Unknown POST action" because GAS admin auth layer rejected unauthenticated requests. |
| 2026-02-20 | hub v4.7.0 | `c4fc670` | **Notification routing fix.** (1) Added `NEW_RECORDS` detection to 8 more sync methods (complaints, vacancies, applications, products, orders, blog_posts, newsletters, agent_runs). (2) Expanded `_handle_new_records` from 2 → 10 table types with correct ntype routing. (3) `_on_notification_click` now routes to correct tabs for all notification types (was sending everything to Customer Care). |
| 2026-02-20 | hub v4.7.0 | `9e6f677` | **5 missing table syncs + auto-refresh.** (1) Added `upsert_complaint`, `upsert_vacancy`, `upsert_application`, `upsert_product`, `upsert_order` to `database.py`. (2) Added `_sync_complaints`, `_sync_vacancies`, `_sync_applications`, `_sync_products`, `_sync_orders` to `sync.py` (total 19 sync tables). (3) Added `on_table_update` to `customer_care`, `admin`, `marketing` tabs. |
| 2026-02-20 | hub v4.7.0 | `df61654` | **Node 1 Master Source of Truth.** (1) Dispatch tab now shows real-time field tracking status on each job card — 🔨 In Progress (with start time), ✅ Field Complete (with duration), 📱 Tracked — cross-references `job_tracking` SQLite table. (2) Overview tab: new **📧 Recent Emails** panel (last 10 sent emails with type icons, timestamps, client names, status) + **📱 Field Activity** panel (today's tracked jobs from mobile app — active count, completed, total time, per-job rows). (3) Job Tracking tab rewired to read from local SQLite instead of API calls (offline-first). (4) All 3 tabs respond to `job_tracking` and `email_tracking` table sync events via `on_table_update`. (5) `database.py`: added `get_job_tracking()`, `get_job_tracking_stats()`, `get_active_field_jobs()`, added `today` count to `get_email_stats()`. |
| 2026-02-20 | hub v4.7.0 | `7a2e243` | **Mobile→Node sync chain fix.** (1) `mobileSendInvoice` in Code.gs now calls `logInvoice()` + `markJobBalanceDue()` after sending — invoices are now visible in Sheets/SQLite on all nodes. (2) Added `get_email_tracking` GAS route + `getEmailTracking()` function (reads Email Tracking sheet, returns up to 500 records). (3) Added `_sync_email_tracking()` and `_sync_job_tracking()` to `sync.py` — both now included in `_full_sync()` (14 tables total). (4) Added `email_tracking` upsert method + `job_tracking` table schema + upsert to `database.py`. |
| 2026-02-20 | mobile v2.3.0 | `e2c43a9` | **Mobile invoice+photo flow fix.** (1) `mobileUploadPhoto` saves photo type as `data.type \|\| 'after'` instead of hardcoded `'field'`. (2) `getJobPhotos` includes 'field' type as 'after' for backward compat. (3) `mobileSendInvoice` builds proper `customer`/`items`/dates structure for `sendInvoiceEmail` (was crashing on wrong data shape). (4) Mobile app now prompts before/after photo type with colour-coded badges (BEFORE blue, AFTER green). (5) v2.3.0 EAS build queued. |
| 2026-02-20 | Code.gs | `2ef1a01` | **Bot notification completeness.** DayBot notified for quotes created/accepted/declined. MoneyBot + DayBot both notified for field invoices. ContentBot notified for all 3 `saveBlogPost` paths (new/update/publish). |
| 2026-02-19 | hub v4.7.0 | `edd81ec` | **Ollama 404 fix.** (1) Set `OLLAMA_MODELS=E:\OllamaModels` as persistent User-level env var. (2) Added `_ensure_ollama_running()` — auto-starts Ollama with E: drive path on Hub launch. (3) Added `_restart_ollama_with_models_dir()` — kills and restarts Ollama when 404 or empty model list detected. (4) `_probe_ollama()` now calls auto-start on detection and retries after restart if no models found. (5) `_generate_ollama()` handles 404 response with restart and single retry. Scheduled blog/newsletter agents now work reliably on boot. |
| 2026-02-19 | hub v4.7.0 | `571e52f` | **Phase 11 — Email flows, bug reporter, quote UX.** (1) Enabled customer acknowledgement emails for service + bespoke enquiries via Brevo — removed `HUB_OWNS_EMAILS` gate, upgraded to branded templates using `getGgmEmailHeader()`/`getGgmEmailFooter()`. (2) Wired `sendPaymentReceivedEmail()` into Stripe webhook handlers (`handleStripeInvoicePaid`, `handlePaymentIntentSucceeded`) — customers now get branded receipt on payment. (3) Fixed newsletter field name mismatch in GAS `sendNewsletter()` — Hub sends `body`/`target`, GAS now accepts both `content`/`body` and `targetTier`/`target`. (4) New `bug_reporter.py` module — background log scanner, error pattern matching, severity classification, deduplication, 0-100 health scoring, Telegram alerts for critical issues. 7 system checks: Log File, Database, GAS Webhook, Brevo, Stripe, Disk Space, Ollama/Llama. (5) New Diagnostics sub-tab in Admin panel — health score, "Run System Check" button, recent issues list, top recurring bugs. (6) Fixed quote modal scroll — window height adapts to screen, footer never off-screen. (7) Added "Customer's Garden Details" card to enquiry modal and quote builder — parses GARDEN_JSON from enquiry data so garden size, areas, condition, hedges, clearance, waste are all visible when building quotes. |
| 2026-02-15 | field v3.5.2 | `0ca27a8` | **Bidirectional command queue**: Added `_start_command_listener()` — polls GAS every 15s for commands targeted at `field_laptop`. 10 command types: ping, force_refresh, show_notification, show_alert, git_pull, clear_cache, switch_tab, force_sync, send_data, update_status. Floating notification UI for incoming PC commands. |
| 2026-02-14 | field v3.5.1 | *pending* | Fixed shop "pendingg" typo, wired blog Publish/Delete buttons, added `_view_ai_tips` method, comprehensive button/endpoint audit |
| 2026-02-13 | field v3.5.0 | `92b3ad5` | Full GAS integration: 17 tabs, 34 new methods, 24 PC triggers. Added complaints, telegram, shop tabs. Job cancel/reschedule/weather/photos. Finance costs/pricing/AI tips. Subscriber management. All 14 AI agents mapped. |
| 2026-02-12 | field v3.4.1 | `c82bb49` | Restored from safe commit, fixed encoding corruption, fixed ytd_rev NameError, modified auto_push.py to exclude field_app.py from PC overwrites |

### Node 1 (PC Hub) Changes

| Date | Version | Commit | Changes |
|------|---------|--------|---------|
| 2026-02-15 | hub v4.1.0 | `0ca27a8` | **ACTION REQUIRED**: `command_queue.py` updated — added `send_to_laptop()` helper + `LAPTOP_COMMAND_TYPES` dict. PC can now send commands to laptop via `send_to_laptop(api, "ping")`. `_process_pending()` already passes `target="pc_hub"` to `get_remote_commands`. See "Node 1 Action Items" below for integration steps. |
| *—* | *hub v4.1.0* | *—* | *(Node 1 Copilot: log your changes here)* |

### Shared / Infrastructure Changes

| Date | Scope | Commit | Changes |
|------|-------|--------|---------|
| 2026-02-20 | Code.gs | `afd4cd8` | **🚨 Must redeploy via Apps Script editor.** (1) Mobile push: `sendExpoPush()` sends to all registered Expo tokens via `exp.host` API. (2) `register_push_token` POST route + `handleRegisterPushToken()` — stores tokens in PushTokens sheet. (3) `get_mobile_push_tokens` GET route. (4) `log_mobile_activity` POST route + `handleLogMobileActivity()` — MobileActivity sheet, capped 500 rows. (5) `notifyBot()` now calls `sendExpoPush()` after Telegram send (best-effort, try/catch). All 4 bots (DayBot, MoneyBot, ContentBot, CoachBot) push to mobile. |
| 2026-02-20 | Agents | `308b426`+`afd4cd8` | **Admin auth for standalone agents.** All 5 agents that bypass `shared.js` now inject `adminToken`: `finance-dashboard.js` (3 calls), `content-agent.js` (5 calls via `authUrl`/`authBody`), `email-lifecycle.js` (2 calls), `morning-planner.js` (4 calls), `social-media.js` (2 calls). Prevents 404 from GAS admin auth layer. |
| 2026-02-20 | Mobile | `1ceff46` | **v2.4.0 — OTA + push fix.** Push token `projectId` fixed (slug → UUID). OTA updates enabled (`runtimeVersion: appVersion`). **Requires APK rebuild on Node 1 — see action item above.** |
| 2026-02-20 | Code.gs | `2ef1a01`+`e2c43a9`+`7a2e243` | **Must redeploy via Apps Script editor.** (1) `mobileSendInvoice` → calls `logInvoice()` + `markJobBalanceDue()` after sending. (2) `mobileUploadPhoto` → saves photo type as `data.type \|\| 'after'`. (3) `getJobPhotos` → backward compat for 'field' type. (4) Added `get_email_tracking` GET route + `getEmailTracking()`. (5) Added `get_bot_messages` GET route + `getBotMessages()`. (6) Bot notifications: DayBot for quotes, MoneyBot for field invoices, ContentBot for blog publish. |
| 2026-02-20 | Sync | `7a2e243` | **New sync paths.** `_full_sync()` now syncs 14 tables (added `email_tracking` + `job_tracking`). Both map from GAS camelCase to SQLite snake_case. |
| 2026-02-20 | Mobile | `e2c43a9` | **v2.3.0** — before/after photo type prompt, colour badges, fixed invoice data structure. EAS build queued. |
| 2026-02-19 | Code.gs | redeployed | **Phase 11 GAS updates** (must redeploy via Apps Script editor): (1) Service enquiry customer ack email always sends (removed `HUB_OWNS_EMAILS` gate). (2) Service enquiry email upgraded to branded template. (3) Bespoke enquiry customer ack email added. (4) Stripe `handleStripeInvoicePaid()` → calls `sendPaymentReceivedEmail()`. (5) Stripe `handlePaymentIntentSucceeded()` → calls `sendPaymentReceivedEmail()`. (6) `sendNewsletter()` normalises `body`/`content` and `target`/`targetTier` field names. |
| 2026-02-15 | Code.gs v106-v107 | deployed | **Telegram bot routing**: Fixed 31 `notifyTelegram()` calls → routed to correct bots (19→MoneyBot, 12→ContentBot). DayBot keeps ~62 calls. **Stripe webhooks**: Expanded from 4 to 20+ event handlers (subscriptions, one-off payments, refunds, disputes). Auto-detection in `doPost` for Stripe events without `?action=` param. **DEPLOYMENT_URL** updated to current deployment. |
| 2026-02-15 | Code.gs v107 | deployed | Added `Target` column to RemoteCommands sheet for bidirectional command routing. `ensureRemoteCommandsSheet()` migrates existing 8-col sheets to 9-col. `getRemoteCommands` accepts `?target=` filter. |
| 2026-02-15 | Stripe | dashboard | Webhook endpoint `we_1T12sWCI9zZxpqlvZZegMY4w` created (v1 classic). 18 events. Signing secret: `whsec_PIkXtaLbXeQQ9xKJANCHFnMqKuKyFtZi`. **Tested 2026-02-15**: mock `invoice.paid` → HTTP 200 `{"received":true}`. |

---

## Key File Ownership

> **CRITICAL: Respect file ownership to avoid merge conflicts.**

| File | Owner | Rule |
|------|-------|------|
| `platform/app/*.py` | **Shared** | Unified Hub code. Both nodes run the same `app.main`. Node-aware via `config.IS_PC` / `config.IS_LAPTOP`. |
| `platform/app/tabs/field_*.py` | **Node 2 (Laptop)** | Field-specific tabs (triggers, notes, tracking). Only shown on laptop. |
| `platform/app/ui/command_listener.py` | **Node 2 (Laptop)** | Laptop command listener. Only starts on laptop. |
| `apps-script/Code.gs` | **Shared** | Must be deployed separately via Apps Script editor. Both nodes may update — coordinate via this README. |
| `agents/*.js` | **Node 1 (PC Hub)** | Node.js automation agents. Node 2 can trigger via command queue. |
| `mobile/` | **Shared** | React Native app. Either node can update. |
| `*.html`, `js/`, `css/` | **Shared** | Website files. Either node can update. |

---

## Project Structure

```
├── README.md                   ← THIS FILE (shared node communication)
├── platform/
│   ├── app/
│   │   ├── config.py           ← All config constants, .env loading, node identity (v4.7.0)
│   │   ├── main.py             ← Hub entry point, node-aware service startup
│   │   ├── database.py         ← SQLite schema (33 tables), CRUD (3,480+ lines, includes job_tracking + email_tracking)
│   │   ├── api.py              ← HTTP client for GAS webhook
│   │   ├── sync.py             ← Background sync engine (Sheets ↔ SQLite, 14 tables)
│   │   ├── command_queue.py    ← Bidirectional command queue (11 PC types + 10 laptop types)
│   │   ├── heartbeat.py        ← Node heartbeat service (every 2 min)
│   │   ├── agents.py           ← AI agent scheduler (PC only)
│   │   ├── email_automation.py ← Lifecycle email engine (PC only)
│   │   ├── content_writer.py   ← AI content generation with brand voice
│   │   ├── llm.py              ← LLM provider auto-detection, Ollama auto-start with E: drive model path
│   │   ├── updater.py          ← Auto-update from GitHub (git fetch/pull on startup)
│   │   ├── auto_push.py        ← Auto git-push every 15 min (PC only)
│   │   ├── bug_reporter.py     ← Background bug finder: log scanner, error aggregation, Telegram alerts (v4.7.0)
│   │   ├── supabase_client.py  ← Supabase (PostgreSQL) client — typed CRUD, realtime-ready, graceful fallback
│   │   ├── email_provider.py   ← Brevo email delivery — retry queue, dedup, daily cap (150/day)
│   │   ├── pricing.py          ← Centralised tiered pricing engine — mirrors booking.js quoteConfig
│   │   ├── photo_storage.py    ← Job photo management (E:\GGM-Photos\jobs)
│   │   ├── distance.py         ← Distance & travel surcharge calculations
│   │   ├── tabs/               ← 11 Hub UI tabs (8 shared + 3 laptop-only)
│   │   │   ├── dispatch.py         ← Daily Dispatch — Chris's operational cockpit + field tracking status (1,610 lines)
│   │   │   ├── customer_care.py   ← Customer care & complaint management
│   │   │   ├── telegram.py        ← Telegram bot messaging tab
│   │   │   ├── field_triggers.py  ← PC Triggers tab (laptop only)
│   │   │   ├── field_notes.py     ← Field Notes tab (laptop only)
│   │   │   └── job_tracking.py    ← Job Tracking tab (laptop only)
│   │   └── ui/
│   │       ├── command_listener.py ← Laptop command listener (polls GAS every 15s)
│   │       ├── pin_screen.py      ← PIN lock screen
│   │       ├── theme.py           ← Theme constants (dark theme, green accents)
│   ├── data/
│   │   ├── ggm_hub.db          ← SQLite database (auto-created)
│   │   ├── ggm_hub.log         ← Application log
│   │   └── photos/             ← Local photo storage (see Photo System below)
│   └── .env                    ← API keys (NOT in git)
├── platform/
│   └── supabase_schema.sql     ← Full Supabase/PostgreSQL schema (33 tables, UUID PKs, indexes, FK constraints)
├── apps-script/
│   └── Code.gs                 ← Google Apps Script middleware (~21,000 lines, redeploy required for session changes)
├── agents/                     ← Node.js automation agents (15 agents)
│   ├── content-agent.js        ← AI blog/content writer
│   ├── morning-planner.js      ← Daily route & job planner
│   ├── email-lifecycle.js      ← Email automation runner
│   ├── finance-dashboard.js    ← Financial reporting
│   ├── social-media.js         ← Social media post generator
│   ├── enquiry-responder.js    ← Auto-respond to enquiries
│   ├── orchestrator.js         ← Master agent coordinator
│   ├── site-health.js          ← Website health monitor
│   ├── review-chaser.js        ← Chase Google reviews
│   ├── business-tactics.js     ← AI business strategy
│   ├── health-check.js         ← System-wide diagnostics
│   ├── evening-summary.js      ← End-of-day summary
│   ├── market-intel.js         ← Market intelligence
│   ├── fix-blog-details.js     ← Blog metadata fixer (utility)
│   └── lib/                    ← Shared agent libraries
├── mobile/                     ← React Native field app (Node 3)
│   ├── App.js                  ← Entry point (4 tabs, PIN lock)
│   └── src/
│       ├── screens/            ← TodayScreen, JobDetail, Schedule, Clients, Settings, PinScreen
│       ├── services/           ← api.js, heartbeat.js, location.js, notifications.js
│       └── theme.js
├── js/                         ← Website frontend JavaScript
├── css/                        ← Website stylesheets
├── *.html                      ← Website pages
├── docker/                     ← Docker configs (Listmonk, n8n)
└── .env                        ← Root env vars (NOT in git)
```

---

## GAS Webhook API

**Endpoint:** `https://script.google.com/macros/s/AKfycbxaT1YOoDZtVHP9CztiUutYFqMiOyygDJon5BxCij14CWl91WgdmrYqpbG4KVAlFh5IiQ/exec`

### GET Actions (used by Field App)

| Action | Returns | Used By |
|--------|---------|---------|
| `get_todays_jobs` | Today's job schedule | Dashboard |
| `get_mobile_activity` | Recent mobile app events | Dashboard |
| `get_job_tracking` | Job time tracking records | Dashboard, Tracking |
| `get_finance_summary` | Revenue, costs, profit summaries | Dashboard |
| `get_enquiries` | Customer enquiries | Dashboard, Enquiries |
| `get_site_analytics` | Website traffic & analytics | Dashboard, Analytics |
| `get_weather` | Cornwall weather data | Dashboard |
| `get_quotes` | Quote list | Dashboard, Quotes |
| `get_invoices` | Invoice list | Dashboard, Finance |
| `get_clients` | Client database | Dashboard, Clients |
| `get_schedule` | Weekly schedule | Schedule |
| `get_remote_commands` | Command queue status (supports `?target=field_laptop` or `?target=pc_hub`) | Triggers, Command Listener |
| `get_node_status` | All node heartbeats | Health |
| `get_field_notes` | Field notes | Notes |
| `get_complaints` | Customer complaints | Complaints |
| `get_telegram_updates` | Telegram messages | Telegram |
| `get_subscribers` | Newsletter subscribers | Marketing |
| `get_all_blog_posts` | Blog post list | Marketing |
| `get_newsletters` | Newsletter archive | Marketing |
| `get_all_testimonials` | Customer testimonials | Marketing |
| `get_products` | Shop product catalogue | Shop |
| `get_orders` | Shop orders | Shop |
| `get_job_photos` | Job photos list & URLs | Today (photos popup) |
| `get_job_costs` | Job cost breakdown | Finance |
| `get_business_recommendations` | AI business tips | Finance (AI Tips) |
| `get_pricing_config` | Service pricing config | Finance |
| `get_email_history` | Email send history | Clients, Enquiries |
| `get_email_tracking` | Email tracking records (up to 500, with sentAt/email/type/status) | Overview, Sync |
| `get_bot_messages` | Telegram messages from all 4 bots | Mobile Bots screen |

### POST Actions (used by Field App)

| Action | Purpose | Used By |
|--------|---------|---------|
| `queue_remote_command` | Send command to PC Hub | Triggers, various |
| `update_remote_command` | Update command status | Command polling |
| `node_heartbeat` | Laptop heartbeat | Auto (every 2 min) |
| `mobile_start_job` | Mark job as started | Today |
| `mobile_update_job_status` | Update job status | Today |
| `mobile_complete_job` | Mark job complete | Today |
| `mobile_send_invoice` | Send invoice from field | Today |
| `mobile_upload_photo` | Upload job photo | Today (photos) |
| `cancel_booking` | Cancel a booking | Today, Bookings |
| `reschedule_booking` | Reschedule a booking | Today |
| `weather_reschedule` | Weather-based reschedule | Today |
| `update_booking_status` | Confirm/cancel booking | Bookings |
| `send_enquiry_reply` | Reply to enquiry directly | Enquiries |
| `resend_quote` | Resend quote email | Quotes |
| `mark_invoice_paid` | Mark invoice as paid | Finance |
| `send_invoice_email` | Resend invoice email | Finance |
| `save_business_costs` | Log a business expense | Finance |
| `subscribe_newsletter` | Subscribe email to newsletter | Clients, Marketing |
| `unsubscribe_newsletter` | Unsubscribe from newsletter | Clients, Marketing |
| `resolve_complaint` | Resolve a complaint | Complaints |
| `update_complaint_notes` | Add note to complaint | Complaints |
| `update_complaint_status` | Change complaint status | Complaints |
| `relay_telegram` | Send Telegram message | Telegram |
| `update_order_status` | Update shop order status | Shop |
| `save_blog_post` | Create/update blog post | Marketing |
| `delete_blog_post` | Delete a blog post | Marketing |
| `save_field_note` | Save a field note | Notes |

### PC Hub Commands (via Command Queue)

| Command | What PC Does | Trigger Source |
|---------|-------------|----------------|
| `generate_blog` | AI writes a blog post draft | Triggers, Marketing |
| `generate_newsletter` | AI creates newsletter draft | Triggers, Marketing |
| `send_reminders` | Day-before reminder emails | Triggers |
| `send_completion` | Job completion thank-you emails | Triggers, Today |
| `send_enquiry_reply` | Reply to enquiry via PC email engine | Triggers, Enquiries |
| `send_booking_confirmation` | Booking confirmation email | Triggers, Bookings |
| `send_quote_email` | Quote email to prospect | Triggers, Bookings |
| `send_invoice` | Invoice email to client | Triggers |
| `run_email_lifecycle` | Full email automation cycle | Triggers |
| `force_sync` | Immediate full data sync | Triggers |
| `run_agent` | Run specific AI agent by ID | Triggers (14 agents) |

### Laptop Commands (via Command Queue — PC → Laptop)

> **NEW (2026-02-15):** The laptop now polls every 15 seconds for commands targeted at `field_laptop`.

| Command | What Laptop Does | Data |
|---------|-----------------|------|
| `ping` | Responds with version + git commit | — |
| `force_refresh` | Clears cache, refreshes active tab | — |
| `show_notification` | Non-blocking popup (auto-dismisses 10s) | `{title, message}` |
| `show_alert` | Blocking alert dialog | `{message}` |
| `git_pull` | Pulls latest code from GitHub | — |
| `clear_cache` | Wipes all cached API data | — |
| `switch_tab` | Navigates to a specific tab | `{tab: "dashboard"}` |
| `force_sync` | Full cache clear + data reload | — |
| `send_data` | Pushes data directly to laptop cache | `{action, payload}` |
| `update_status` | Updates the status bar message | `{message}` |

**Usage from PC Hub:**
```python
from app.command_queue import send_to_laptop
send_to_laptop(api, "ping")
send_to_laptop(api, "show_notification", {"title": "Job Update", "message": "Invoice #247 paid!"})
send_to_laptop(api, "git_pull")
send_to_laptop(api, "force_refresh")
```

---

## Hub UI — Tab Reference (11 tabs: 8 shared + 3 laptop-only)

| # | Tab | Key | Icon | Highlights |
|---|-----|-----|------|------------|
| 1 | Overview | `overview` | 📊 | KPI dashboard, today's jobs, revenue chart, alerts, **📧 Recent Emails panel**, **📱 Field Activity panel** (1,842 lines) |
| 2 | Daily Dispatch | `dispatch` | 🚐 | Chris's operational cockpit — job cards with **field tracking status indicators** (🔨/✅/📱), fund allocation, Telegram alerts, EOD summary (1,610 lines) |
| 3 | Operations | `operations` | 👥 | Client management, schedule, bookings, enquiries, quotes |
| 4 | Finance | `finance` | 💰 | Revenue KPIs, invoices, job costs, pricing config, business costs |
| 5 | Telegram | `telegram` | 📱 | View/send messages via 4 bots |
| 6 | Marketing | `marketing` | 📣 | Blog posts, newsletters, testimonials, subscribers |
| 7 | Customer Care | `customer_care` | 🤝 | Complaints, resolution tracking, customer follow-ups |
| 8 | Admin | `admin` | ⚙️ | 7 sub-tabs: Careers, Shop, Agents, Strategy, Growth, Diagnostics, Settings (1,852 lines) |
| 9 | PC Triggers | `field_triggers` | 🖥️ | *Laptop only.* 24 trigger buttons (11 commands + 14 AI agents), command history |
| 10 | Job Tracking | `job_tracking` | ⏱️ | *Laptop only.* Time tracking, filter by date |
| 11 | Field Notes | `field_notes` | 📝 | *Laptop only.* Create/view field notes |

---

## Photo System

### Current State

Photos flow through the GAS webhook and are referenced by URL. The system supports:

1. **Mobile App Uploads** — `mobile_upload_photo` POST via GAS → stores metadata in Google Sheets `Job Photos` sheet
2. **Online Booking Uploads** — Customers attach photos when booking via the website → stored via GAS
3. **Field App Viewing** — `get_job_photos` GET → displays photos in `_view_job_photos` popup with download/open buttons

### Storage Architecture

```
┌──────────────┐     POST mobile_upload_photo     ┌─────────────────┐
│  Mobile App  │ ─────────────────────────────────→│  Google Apps    │
│  (Node 3)    │     (base64 or URL)               │  Script (GAS)   │
└──────────────┘                                   │                 │
                                                   │  Stores in:     │
┌──────────────┐     Online booking form           │  • Google Drive  │
│  Customer    │ ─────────────────────────────────→│    (originals)  │
│  (Website)   │     (file upload)                 │  • Sheets index │
└──────────────┘                                   └────────┬────────┘
                                                            │
                        GET get_job_photos                   │
┌──────────────┐  ←─────────────────────────────────────────┘
│  Field App   │     (URLs + metadata)
│  (Node 2)    │     Opens via os.startfile()
└──────────────┘

┌──────────────┐     Sync on schedule              ┌─────────────────┐
│  PC Hub      │ ←─────────────────────────────────│  Google Drive   │
│  (Node 1)    │     Downloads to local storage    │  (cloud source) │
│              │                                   └─────────────────┘
│  Stores in:  │
│  platform/   │
│  data/       │
│  photos/     │   ← NEEDS: Internal drive or NAS
│  {jobRef}/   │     for long-term photo archive
│  *.jpg       │
└──────────────┘
```

### TODO: PC Hub Photo Storage (Node 1 Action Required)

> **Node 1 Copilot:** The PC Hub needs to implement the following:

1. **Identify an internal drive** for photo storage (e.g. `D:\GGM-Photos\` or an attached USB/NAS)
2. **Create a photo sync service** in `platform/app/photo_sync.py`:
   - Poll `get_job_photos` periodically (every 5 min or on demand)
   - Download new photos from Google Drive URLs to local storage
   - Organise by job reference: `{PHOTOS_DIR}/{jobRef}/{filename}`
   - Config key `PHOTOS_DIR` already exists in `config.py` → `platform/data/photos/`
   - Consider adding a config override: `PHOTOS_DRIVE` env var for external drive path
3. **Add a photo gallery tab** or section in the Hub UI for browsing archived photos
4. **Backup strategy**: Photos on Google Drive are the master copy; local copies are for fast access and offline use

### Photo Sources

| Source | Method | Format | Destination |
|--------|--------|--------|-------------|
| Mobile App (camera) | `mobile_upload_photo` POST | Base64 JPEG → Google Drive | GAS → Google Drive → Sheets index |
| Online Booking Form | Website file upload | Multipart form → GAS | GAS → Google Drive → Sheets index |
| Field App (laptop) | `mobile_upload_photo` POST | Same as mobile | GAS → Google Drive → Sheets index |

### Photo Metadata (Google Sheets: Job Photos)

| Column | Description |
|--------|-------------|
| `jobNumber` / `jobRef` | Job reference the photo belongs to |
| `filename` | Original filename |
| `url` | Google Drive shareable URL |
| `uploaded_at` | Upload timestamp |
| `uploaded_by` | `mobile`, `website`, `field_app` |
| `type` | `before`, `after`, `issue`, `general` |

---

## Telegram Bots (4 Total)

> **Updated 2026-02-15:** Messages are now routed to the correct bot based on content type.

| Bot | Token Prefix | Purpose | Message Types |
|-----|-------------|---------|---------------|
| **DayBot** | `8261...` | Daily operations | Bookings, weather, morning briefings, job completions, complaints, field notes (~62 calls) |
| **MoneyBot** | `8506...` | Financial alerts | Payments, invoices, deposits, quotes, subscriptions, Stripe events (~19 calls) |
| **ContentBot** | `8529...` | Marketing updates | Blog posts, newsletters, reviews, vacancies, subscriber activity (~12 calls) |
| **CoachBot** | `8394...` | Business coaching | Strategy tips, workflow optimisation (triggered on demand) |

All bots share the same `TG_CHAT_ID: 6200151295`. Routing is via `notifyBot('moneybot', msg)` / `notifyBot('contentbot', msg)` instead of the default `notifyTelegram(msg)` (which goes to DayBot).

---

## Stripe Integration

> **Configured 2026-02-15.**

| Setting | Value |
|---------|-------|
| Webhook Endpoint ID | `we_1T12sWCI9zZxpqlvZZegMY4w` |
| Endpoint URL | `https://script.google.com/macros/s/AKfycbxaT1Y.../exec` |
| API Version | `2025-05-28.basil` |
| Events Listened | 18 |

### Event Handlers

| Event | Handler | What It Does |
|-------|---------|-------------|
| `checkout.session.completed` | `handleStripeCheckout` | Marks booking as paid, triggers confirmation email |
| `checkout.session.expired` | `handleCheckoutExpired` | Logs abandoned checkout, notifies MoneyBot |
| `invoice.paid` | `handleStripeInvoicePaid` | Updates invoice status, marks subscription job paid |
| `invoice.payment_failed` | `handleStripePaymentFailed` | Flags invoice, notifies MoneyBot urgently |
| `invoice.created` | `handleStripeInvoiceCreated` | Logs new invoice in Sheets |
| `invoice.upcoming` | `handleStripeInvoiceUpcoming` | Advance notice of upcoming charge |
| `payment_intent.succeeded` | `handlePaymentIntentSucceeded` | One-off payment confirmed |
| `payment_intent.payment_failed` | `handlePaymentIntentFailed` | One-off payment failed |
| `payment_intent.requires_action` | `handlePaymentIntentRequiresAction` | 3D Secure / customer action needed |
| `customer.subscription.created` | `handleStripeSubCreated` | New subscription logged |
| `customer.subscription.updated` | `handleStripeSubUpdated` | Status changes (past_due, cancel_at_period_end, reactivation) |
| `customer.subscription.deleted` | `handleStripeSubCancelled` | Final cancellation |
| `customer.subscription.paused` | `handleStripeSubPaused` | Subscription paused |
| `customer.subscription.resumed` | `handleStripeSubResumed` | Subscription resumed |
| `customer.subscription.trial_will_end` | `handleStripeSubTrialEnding` | Trial ending in 3 days |
| `charge.refunded` | `handleChargeRefunded` | Full/partial refund processed |
| `charge.dispute.created` | `handleDisputeCreated` | URGENT chargeback alert |
| `charge.dispute.closed` | `handleDisputeClosed` | Dispute resolved |

---

## Email System (Brevo)

> **Active since v4.6.0.** All transactional and marketing emails sent via [Brevo](https://www.brevo.com/).

| Setting | Value |
|---------|-------|
| Provider | Brevo (formerly Sendinblue) |
| API URL | `https://api.brevo.com/v3/smtp/email` |
| Sender | `info@gardnersgm.co.uk` |
| Daily Cap | 150 emails/day |
| Monthly Limit | 5,000 (free tier) |
| Retry Logic | 3 retries with backoff (2s, 4s, 8s) |

### Email Types

| Type | Trigger | Template |
|------|---------|----------|
| Booking confirmation | Stripe checkout completed | Branded HTML with booking details |
| Day-before reminder | 24h before job | Friendly reminder with what-to-expect |
| Completion thank-you | Job marked complete | Review request + rebooking CTA |
| Payment receipt | Stripe payment received | Branded receipt |
| Enquiry acknowledgement | New service/bespoke enquiry | Immediate "we've received your enquiry" |
| Quote email | Quote created in Hub | PDF-style quote with accept/decline links |
| Newsletter | Manual or AI-generated | Branded newsletter to subscriber tiers |

---

## Supabase (PostgreSQL) — Optional Cloud Database

> **Added v4.7.0.** Optional PostgreSQL mirror for real-time features and future web dashboard.

| Setting | Value |
|---------|-------|
| Status | **Optional** — Hub works fine with SQLite only |
| Schema | `platform/supabase_schema.sql` (33 tables, UUID PKs, proper FK constraints) |
| Client | `platform/app/supabase_client.py` (607 lines, typed CRUD, singleton) |
| Sync | Best-effort mirror after each Sheets pull — mirrors clients, invoices, quotes, enquiries, subscribers |
| Auth | Uses `service_role` key (bypasses RLS) |
| Fallback | Graceful — if Supabase not configured, sync silently skips |

To enable, set in `platform/.env`:
```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_KEY=eyJ...
```

---

## LLM System (Ollama + Fallbacks)

> **Updated 2026-02-19.** Ollama auto-starts with `OLLAMA_MODELS=E:\OllamaModels` when the Hub launches.

| Setting | Value |
|---------|-------|
| Active Model | `llama3.1:latest` (4.58 GB) |
| Model Storage | `E:\OllamaModels` (C: drive too small) |
| API | `http://localhost:11434` |
| Detection Priority | Ollama → OpenAI-compatible → OpenAI → Gemini → Templates |
| Context Window | 8,192 tokens |
| Generate Timeout | 600s (10 min) |

### Auto-Recovery

The `llm.py` module handles three failure scenarios:

1. **Ollama not running** — `_ensure_ollama_running()` starts `ollama serve` with `OLLAMA_MODELS=E:\OllamaModels`
2. **Wrong model directory** — If Ollama is running but can't find models (empty `/api/tags`), `_restart_ollama_with_models_dir()` kills and restarts with correct env
3. **404 on generate** — If a generate call returns 404 (model not found), restarts Ollama with correct path and retries once

Set `OLLAMA_MODELS=E:\OllamaModels` as a **persistent User-level environment variable** so Ollama's startup shortcut also uses the right path.

---

## Bug Reporter

> **Added v4.7.0.** Background service that monitors application health.

| Feature | Detail |
|---------|--------|
| Log scanning | Continuous background thread scans `ggm_hub.log` |
| Pattern matching | Database errors, Brevo failures, Stripe errors, sync failures, GAS webhook errors, tab import failures |
| Severity levels | Critical, Error, Warning, Info |
| Deduplication | Groups recurring errors, tracks frequency |
| Health score | 0-100 composite score |
| Alerts | Telegram alerts for critical issues |
| UI | Diagnostics sub-tab in Admin panel — health score, issue list, system check button |

---

## AI Agents (15 Total)

| Agent | File | Purpose | Schedule |
|-------|------|---------|----------|
| Blog Writer | `content-agent.js` | Generate SEO blog posts | Weekly |
| Content Agent | `content-agent.js` | Content quality checks | On demand |
| Morning Planner | `morning-planner.js` | Daily route & job plan | Daily 7:00 AM |
| Evening Summary | `evening-summary.js` | End-of-day report | Daily 6:00 PM |
| Email Lifecycle | `email-lifecycle.js` | Email automation | Every 5 min |
| Review Chaser | `review-chaser.js` | Chase Google reviews | Weekly |
| Social Media | `social-media.js` | Social post generation | 3x/week |
| Enquiry Responder | `enquiry-responder.js` | Auto-respond to leads | On new enquiry |
| Finance Dashboard | `finance-dashboard.js` | Financial reporting | Daily |
| Site Health | `site-health.js` | Website uptime monitor | Every 30 min |
| Health Check | `health-check.js` | System diagnostics | Every hour |
| Business Tactics | `business-tactics.js` | AI strategy tips | Weekly |
| Market Intel | `market-intel.js` | Market analysis | Monthly |
| Orchestrator | `orchestrator.js` | Coordinate all agents | Daily |
| Fix Blog Details | `fix-blog-details.js` | Blog metadata repair | Utility (manual) |

---

## Environment Variables

### Root `.env` (shared)

| Variable | Purpose |
|----------|---------|
| `SHEETS_WEBHOOK` | GAS webhook URL |
| `TG_BOT_TOKEN` | Telegram bot API token |
| `TG_CHAT_ID` | Telegram chat ID |
| `PEXELS_KEY` | Pexels API for stock images |
| `OLLAMA_URL` / `OLLAMA_MODEL` | Local LLM (Ollama) |
| `FB_PAGE_ACCESS_TOKEN` / `FB_PAGE_ID` | Facebook posting |
| `IG_BUSINESS_ACCOUNT_ID` | Instagram posting |
| `TWITTER_*` | Twitter/X API credentials |
| `N8N_URL` / `N8N_USER` / `N8N_PASSWORD` | n8n workflow engine |
| `LISTMONK_*` | Listmonk email marketing |
| `DIFY_*` | Dify AI platform |
| `TAILSCALE_PC` / `TAILSCALE_LAPTOP` | Tailscale VPN IPs |

### Platform `.env` (Hub-specific)

| Variable | Purpose |
|----------|---------|
| `GEMINI_API_KEY` / `GEMINI_MODEL` | Google Gemini LLM |
| `OPENAI_API_KEY` / `OPENAI_BASE_URL` | OpenAI / compatible LLM |
| `OLLAMA_MODELS` | Ollama model storage path (default: `E:\OllamaModels`) — required when models live on a non-C: drive |
| `STRIPE_SECRET_KEY` | Stripe payment processing |
| `BREVO_API_KEY` | Brevo transactional email delivery |
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_KEY` | Supabase (PostgreSQL) — optional cloud database mirror |

---

## Development Workflow

### Node 2 (Laptop) — Making Changes

```bash
# Edit files
# Test syntax
python -c "import py_compile; py_compile.compile('platform/app/config.py', doraise=True)"
# Run locally
cd platform && python -m app.main
# Or use: GGM Field.bat (sets GGM_NODE_ID=field_laptop)
# Push
git add -A && git commit -m "v4.2.x: description" && git push origin master
```

### Node 1 (PC Hub) — Receiving Changes

- Auto-pulls from `origin/master` every 15 minutes via `updater.py`
- Also pulls on startup
- If urgent: restart GGM Hub (desktop shortcut) or send `force_sync` command

### Code.gs Changes

1. Edit `apps-script/Code.gs`
2. Copy to Google Apps Script editor
3. **Manage Deployments → Edit → Deploy** (must redeploy for changes to take effect)
4. Log the change in this README under "Shared / Infrastructure Changes"

### Key Rules

- **Never break the import chain** — test syntax before pushing
- **Never use PowerShell heredoc** to write Python files (corrupts Unicode)
- **Always increment version** when making significant changes
- **Update the Node Change Log** above when pushing
- **Respect file ownership** — see table above

---

## Quick Reference

### Run the Field Hub (Laptop)

```bash
# Option 1: Use the batch file (recommended — sets node identity)
"GGM Field.bat"
# Option 2: Manual
set GGM_NODE_ID=field_laptop
cd D:\gardening\platform
python -m app.main
```

### Run the PC Hub

```bash
cd C:\GGM-Hub\platform
python -m app.main
# Or use the shortcut: "GGM Hub.bat"
```

### Run the Mobile App

```bash
cd mobile
npx expo start --tunnel
# Scan QR code with Expo Go on phone
```

### Send a Command to PC from Laptop

```python
# Use the PC Triggers tab in the Hub, or programmatically:
from app.api import GASClient
api = GASClient()
api.post(action="queue_remote_command", data={
    "command": "generate_blog",
    "source": "field_laptop",
    "target": "pc_hub"
})
```

### Send a Command to Laptop from PC Hub

```python
# In any PC Hub code:
from app.command_queue import send_to_laptop
send_to_laptop(api, "ping")                      # Check laptop is alive
send_to_laptop(api, "show_notification", {        # Push notification
    "title": "Blog Published",
    "message": "Spring Lawn Care Guide is now live!"
})
send_to_laptop(api, "git_pull")                   # Trigger code update
send_to_laptop(api, "force_refresh")              # Refresh laptop UI
```

### Emergency: Reset PC Hub

```bash
# On PC:
cd C:\GGM-Hub
git fetch origin && git reset --hard origin/master
python -m app.main
```

---

## Status & Pending Work

> **Last synced: 2026-02-20.** Both nodes on commit `df61654`.

### Completed

- [x] Bidirectional command queue (`send_to_laptop()` + laptop command listener polling every 15s)
- [x] Stripe webhook live (18 events, endpoint `we_1T12sWCI9zZxpqlvZZegMY4w`)
- [x] Telegram bot routing (DayBot 62 / MoneyBot 19 / ContentBot 12 / CoachBot on-demand)
- [x] Brevo email provider (transactional + marketing, 150/day cap)
- [x] Customer ack emails (service + bespoke enquiries)
- [x] Payment receipt emails (Stripe → Brevo)
- [x] Bug reporter + Diagnostics sub-tab (health score, log scanning, Telegram alerts)
- [x] Ollama auto-start with E: drive model path + 404 recovery
- [x] Supabase client + schema (optional PostgreSQL mirror)
- [x] Centralised pricing engine (`pricing.py`)
- [x] Quote modal garden details + scroll fix
- [x] Photo pipeline (mobile → GAS → Drive → Hub viewing)
- [x] **Mobile invoice+photo flow** — before/after photo tagging, proper invoice email structure with photos attached (v2.3.0)
- [x] **Mobile→Node sync chain** — `mobileSendInvoice` logs to Invoices sheet, `email_tracking` + `job_tracking` sync to SQLite on all nodes (14 tables synced)
- [x] **Bot notification completeness** — DayBot for quotes, MoneyBot for field invoices, ContentBot for blog publish
- [x] **Node 1 master source of truth** — Dispatch shows field tracking status on job cards, Overview shows recent emails + field activity, Job Tracking reads from local SQLite
- [x] **Mobile Bots screen** — view messages from all 4 Telegram bots, company logo icons, PIN change fix

### Pending

- [ ] **Code.gs redeploy required** — All session changes (invoice logging, photo type fix, email_tracking route, bot_messages route, bot notifications). Must redeploy via Apps Script editor.
- [ ] **Mobile v2.3.0 EAS build** — queued, install APK on tablet when ready
- [ ] Site banner system — GAS handlers not yet in upstream Code.gs (`handleGetSiteBanners`, `handleSetSiteBanner`)
- [ ] Supabase realtime subscriptions (Phase 3 — `supabase_client.py` has stubs)
- [ ] PC Hub photo sync service — download from Google Drive to local `E:\GGM-Photos\jobs`
- [ ] Photo gallery tab in Hub UI
- [ ] Finance tab: `get_payments()` still queries clients table not invoices — should use invoices table for payment tracking

---

## Services Offered

Lawn Cutting • Hedge Trimming • Lawn Treatment • Scarifying • Garden Clearance • Power Washing • Drain Clearance • Fence Repair • Gutter Cleaning • Weeding

**Base:** Roche, Cornwall, PL26 8HN | **Website:** [gardnersgm.co.uk](https://www.gardnersgm.co.uk)
