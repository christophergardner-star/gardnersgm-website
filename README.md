# GGM Hub — Gardners Ground Maintenance

> **A 3-node field operations platform for a gardening & landscaping business in Cornwall, UK.**

[![Website](https://img.shields.io/badge/Website-gardnersgm.co.uk-green)](https://www.gardnersgm.co.uk)
[![Location](https://img.shields.io/badge/Base-Roche%2C%20Cornwall-blue)]()
[![Version Hub](https://img.shields.io/badge/Hub-v4.1.0-blue)]()
[![Version Field](https://img.shields.io/badge/Field%20App-v3.5.1-blue)]()
[![Stripe](https://img.shields.io/badge/Stripe-18%20webhooks-purple)]()
[![Telegram](https://img.shields.io/badge/Telegram-4%20bots-blue)]()

---

## Architecture

| Node | Role | Location | Stack |
|------|------|----------|-------|
| **Node 1 — PC Hub** | Main server. Runs all background services, AI agents, email automation, data sync. | Desktop PC, `C:\GGM-Hub` | Python + CustomTkinter, 14 tabs |
| **Node 2 — Field Laptop** | Developer workstation & field companion. Pushes code via Git. | Laptop, `D:\gardening` | Python + CustomTkinter, 17 tabs |
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
| 2026-02-15 | field v3.5.2 | *pending* | **Bidirectional command queue**: Added `_start_command_listener()` — polls GAS every 15s for commands targeted at `field_laptop`. 10 command types: ping, force_refresh, show_notification, show_alert, git_pull, clear_cache, switch_tab, force_sync, send_data, update_status. Floating notification UI for incoming PC commands. |
| 2026-02-14 | field v3.5.1 | *pending* | Fixed shop "pendingg" typo, wired blog Publish/Delete buttons, added `_view_ai_tips` method, comprehensive button/endpoint audit |
| 2026-02-13 | field v3.5.0 | `92b3ad5` | Full GAS integration: 17 tabs, 34 new methods, 24 PC triggers. Added complaints, telegram, shop tabs. Job cancel/reschedule/weather/photos. Finance costs/pricing/AI tips. Subscriber management. All 14 AI agents mapped. |
| 2026-02-12 | field v3.4.1 | `c82bb49` | Restored from safe commit, fixed encoding corruption, fixed ytd_rev NameError, modified auto_push.py to exclude field_app.py from PC overwrites |

### Node 1 (PC Hub) Changes

| Date | Version | Commit | Changes |
|------|---------|--------|---------|
| 2026-02-15 | hub v4.1.0 | *pending* | **ACTION REQUIRED**: `command_queue.py` updated — added `send_to_laptop()` helper + `LAPTOP_COMMAND_TYPES` dict. PC can now send commands to laptop via `send_to_laptop(api, "ping")`. Also: `_process_pending()` should pass `target="pc_hub"` to `get_remote_commands` to filter properly (see below). |
| *—* | *hub v4.1.0* | *—* | *(Node 1 Copilot: log your changes here)* |

### Shared / Infrastructure Changes

| Date | Scope | Commit | Changes |
|------|-------|--------|---------|
| 2026-02-15 | Code.gs v106 | deployed | **Telegram bot routing**: Fixed 31 `notifyTelegram()` calls → routed to correct bots (19→MoneyBot, 12→ContentBot). DayBot keeps ~62 calls. **Stripe webhooks**: Expanded from 4 to 20+ event handlers (subscriptions, one-off payments, refunds, disputes). Auto-detection in `doPost` for Stripe events without `?action=` param. **Bidirectional commands**: Added `Target` column to RemoteCommands sheet, `getRemoteCommands` filters by `?target=`, `queueRemoteCommand` stores target. **DEPLOYMENT_URL** updated to current deployment. |
| 2026-02-15 | Stripe | dashboard | Webhook endpoint `we_1T12sWCI9zZxpqlvZZegMY4w` created (v1 classic). 18 events. Signing secret: `whsec_PIkXtaLbXeQQ9xKJANCHFnMqKuKyFtZi`. |

---

## Key File Ownership

> **CRITICAL: Respect file ownership to avoid merge conflicts.**

| File | Owner | Rule |
|------|-------|------|
| `platform/field_app.py` | **Node 2 (Laptop)** | PC Hub `auto_push.py` runs `git checkout HEAD -- platform/field_app.py` before committing. **Node 1 must NEVER edit this file.** |
| `platform/app/*.py` | **Node 1 (PC Hub)** | All hub backend code. Node 2 should avoid editing unless coordinated. |
| `apps-script/Code.gs` | **Shared** | Must be deployed separately via Apps Script editor. Both nodes may update — coordinate via this README. |
| `agents/*.js` | **Node 1 (PC Hub)** | Node.js automation agents. Node 2 can trigger via command queue. |
| `mobile/` | **Shared** | React Native app. Either node can update. |
| `*.html`, `js/`, `css/` | **Shared** | Website files. Either node can update. |

---

## Project Structure

```
├── README.md                   ← THIS FILE (shared node communication)
├── platform/
│   ├── field_app.py            ← Node 2 Field Hub (v3.5.1, 4022 lines, 167 methods, 17 tabs)
│   ├── app/
│   │   ├── config.py           ← All config constants, .env loading (Hub v4.1.0)
│   │   ├── main.py             ← Hub entry point, startup sequence
│   │   ├── database.py         ← SQLite schema (29+ tables), CRUD
│   │   ├── api.py              ← HTTP client for GAS webhook
│   │   ├── sync.py             ← Background sync engine (Sheets ↔ SQLite)
│   │   ├── command_queue.py    ← Bidirectional command queue (11 PC types + 10 laptop types)
│   │   ├── heartbeat.py        ← Node heartbeat service (every 2 min)
│   │   ├── agents.py           ← AI agent scheduler
│   │   ├── email_automation.py ← Lifecycle email engine (8 email types)
│   │   ├── content_writer.py   ← AI content generation with brand voice
│   │   ├── llm.py              ← LLM provider auto-detection
│   │   ├── updater.py          ← Auto-update from GitHub (git fetch/pull on startup)
│   │   ├── auto_push.py        ← Auto git-push every 15 min (excludes field_app.py)
│   │   ├── tabs/               ← 14 Hub UI tabs
│   │   └── ui/                 ← Theme, components, app_window
│   ├── data/
│   │   ├── ggm_hub.db          ← SQLite database (auto-created)
│   │   ├── ggm_hub.log         ← Application log
│   │   └── photos/             ← Local photo storage (see Photo System below)
│   └── .env                    ← API keys (NOT in git)
├── apps-script/
│   └── Code.gs                 ← Google Apps Script middleware (17,000+ lines)
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

**Endpoint:** `https://script.google.com/macros/s/AKfycbyjUkYuFrpigXi6chj1B4z-xjHsgnnmkcQ_SejJwdqbstbAq-QooLz9G1sQpfl3vGGufQ/exec`

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

## Field App (Node 2) — Tab Reference

| # | Tab | Key | Methods | Features |
|---|-----|-----|---------|----------|
| 1 | Dashboard | `dashboard` | 7 | KPIs, today's jobs, weather, morning brief, quick actions |
| 2 | Today's Jobs | `today` | 9 | Job cards with En Route/Start/Complete/Invoice/Cancel/Reschedule/Weather/Photos |
| 3 | Bookings | `bookings` | 5 | Filter by status, confirm/cancel bookings, send confirmation/quote emails |
| 4 | Schedule | `schedule` | 4 | Day-by-day navigation, job list per day |
| 5 | Job Tracking | `tracking` | 3 | Time tracking, filter by date |
| 6 | Clients | `clients` | 4 | Client list, search, email history, subscribe/unsubscribe |
| 7 | Enquiries | `enquiries` | 5 | Reply Now (direct), PC Reply (queued), email history |
| 8 | Quotes | `quotes` | 3 | Quote list, resend quote emails |
| 9 | Finance | `finance` | 8 | Revenue KPIs, invoices, mark paid, resend, job costs, log costs, pricing config, AI tips |
| 10 | Marketing | `marketing` | 3+4 | Blog posts (publish/delete), newsletters, testimonials, subscriber management, generate triggers |
| 11 | Analytics | `analytics` | 3 | Site traffic, visitor stats, referrers |
| 12 | PC Triggers | `triggers` | 4 | 24 trigger buttons (11 commands + 14 AI agents), command history |
| 13 | Field Notes | `notes` | 3 | Create/view field notes |
| 14 | System Health | `health` | 2 | Node status, connectivity checks, version info |
| 15 | Complaints | `complaints` | 4 | View complaints, resolve, add notes, change status |
| 16 | Telegram | `telegram` | 3 | View messages, send messages via bot |
| 17 | Shop & Orders | `shop` | 3 | Product catalogue, order management, status updates |

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
| `STRIPE_SECRET_KEY` | Stripe payment processing |

---

## Development Workflow

### Node 2 (Laptop) — Making Changes

```bash
# Edit files
# Test syntax
python -c "import py_compile; py_compile.compile('platform/field_app.py', doraise=True)"
# Run locally (optional)
cd platform && python -m app.main
# Push
git add -A && git commit -m "v3.5.1: description" && git push origin master
```

### Node 1 (PC Hub) — Receiving Changes

- Auto-pulls from `origin/master` every 15 minutes via `updater.py`
- Also pulls on startup
- If urgent: restart GGM Hub (desktop shortcut) or send `force_sync` command
- **auto_push.py** excludes `field_app.py` — won't overwrite laptop's version

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

### Run the Field App

```bash
cd D:\gardening\platform
python field_app.py
# Or use the shortcut: "GGM Field.bat"
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
# In field_app.py or standalone script:
from field_app import send_pc_command
send_pc_command("generate_blog")
send_pc_command("run_agent", {"agent_id": "morning_planner"})
send_pc_command("force_sync")
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

## Services Offered

Lawn Cutting • Hedge Trimming • Lawn Treatment • Scarifying • Garden Clearance • Power Washing • Drain Clearance • Fence Repair • Gutter Cleaning • Weeding

**Base:** Roche, Cornwall, PL26 8HN | **Website:** [gardnersgm.co.uk](https://www.gardnersgm.co.uk)
