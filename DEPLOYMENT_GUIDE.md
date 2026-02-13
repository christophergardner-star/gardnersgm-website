# Deployment Guide — Everything Built This Session
## Gardners Ground Maintenance — January 2025

---

## What Was Built

### 1. Website Fixes
- **NaN Bug Fix** (`js/main.js`) — Stats counter on about.html no longer shows NaN
- **Bespoke Section Removed** (`about.html`) — "Bespoke & Custom Jobs" section and its CSS removed

### 2. Business Tactics Agent
- **`agents/business-tactics.js`** — AI-powered weekly strategy agent
  - Analyses your business plan, pricing, and recent jobs
  - Generates 3–5 pricing/promotion recommendations via Ollama
  - Sends recommendations to Telegram for approve/reject
  - When approved: updates pricing in Google Sheets + services.html, commits & pushes
- **`agents/business-tactics.bat`** — Manual run menu (Full Analysis, Quick Check, History)
- **Wired into orchestrator** — Runs every Monday at 08:30

### 3. GGM Hub — Strategy Panel
- New **"📊 Strategy"** sub-tab in Admin panel
  - Business Plan overview with key KPIs (Year 1 target, break-even, profit margin)
  - AI Recommendations list with colour-coded priority/status cards
  - "Run Strategy Analysis" button triggers the business-tactics agent
- Database table: `business_recommendations` (syncs from Google Sheets)

### 4. Android Field App (GGM Field)
- Full React Native + Expo app at `mobile/`
- 5 screens: Today (job list), Job Detail (workflow), Schedule (weekly), Clients (lookup), Settings (PIN)
- Email-style green theme (#2E7D32) matching your customer emails
- Linear job workflow: Scheduled → En Route → In Progress → Completed → Invoiced
- Camera/gallery photo capture on-site
- One-tap directions to job location
- Offline queue — works without signal, syncs when back online
- PIN lock (default: 1234)

---

## Step-by-Step Deployment

### Step 1: Push Website Changes to GitHub

```bash
cd d:\gardening
git add js/main.js about.html
git commit -m "Fix NaN stats counter, remove bespoke section"
git push
```

This deploys automatically via GitHub Pages.

---

### Step 2: Update Code.gs in Google Apps Script

This is the most important step. Your Code.gs has many new endpoints.

1. Open **Google Apps Script**: https://script.google.com
2. Find your **GGM project** (the one with Code.gs)
3. **Replace the entire** `Code.gs` file content:
   - Open `d:\gardening\apps-script\Code.gs` in VS Code
   - Select All (Ctrl+A), Copy (Ctrl+C)
   - Go back to the Apps Script editor
   - Select All in the editor, Paste (Ctrl+V)
4. Click **Save** (Ctrl+S)
5. Click **Deploy** → **New Deployment**
   - Type: **Web app**
   - Description: `v25 — Business tactics + mobile endpoints`
   - Execute as: **Me**
   - Who has access: **Anyone**
6. Click **Deploy**
7. **Copy the new Web App URL** — you'll need it below

#### New Endpoints Added:
| Endpoint | Type | Purpose |
|----------|------|---------|
| `save_business_recommendation` | POST | Save AI strategy recommendations |
| `get_business_recommendations` | GET | Retrieve recommendations for Hub sync |
| `get_todays_jobs` | GET | Mobile app — today's job list |
| `mobile_update_job_status` | POST | Mobile app — update status |
| `mobile_start_job` | POST | Mobile app — start with timestamp |
| `mobile_complete_job` | POST | Mobile app — complete with duration |
| `mobile_send_invoice` | POST | Mobile app — send invoice from field |
| `mobile_upload_photo` | POST | Mobile app — upload job photos |

#### New Sheets Created Automatically:
- **Business Recommendations** — AI strategy recommendation log
- **Job Tracking** — Start/end times and durations from field app

---

### Step 3: Update the API URL (if it changed)

If your deployment URL changed, update it in these files:

1. **`mobile/src/services/api.js`** — Line 10:
   ```javascript
   const API_URL = 'https://script.google.com/macros/s/YOUR_NEW_URL/exec';
   ```

2. **`agents/business-tactics.js`** — Look for `GAS_URL` near the top and update

3. **Hub agents** — If the orchestrator or other agents reference the GAS URL, update them too.
   The URL is typically stored in `agents/lib/shared.js` or individual agent files.

---

### Step 4: Push Agent & Hub Changes to GitHub

```bash
cd d:\gardening
git add agents/business-tactics.js agents/business-tactics.bat agents/orchestrator.js
git add platform/app/database.py platform/app/sync.py platform/app/tabs/admin.py
git commit -m "Add business tactics agent, strategy panel, mobile endpoints"
git push
```

---

### Step 5: Launch the Hub and Test Strategy Panel

```bash
cd d:\gardening\platform
D:\gardening\.venv\Scripts\python.exe app\main.py
```

1. Go to the **Admin** tab
2. Click the **📊 Strategy** sub-tab
3. You should see:
   - Business Plan Overview card with your financial targets
   - 5 KPI cards (Year 1 Target, Break-Even, etc.)
   - "Run Strategy Analysis" button (requires Ollama running)
4. Try clicking **Run Strategy Analysis** (make sure Ollama is running first)

---

### Step 6: Set Up the Mobile App

#### Prerequisites:
- **Node.js** 18+ installed
- **Expo Go** app installed on your Android phone (from Play Store)

#### Install & Run:

```bash
cd d:\gardening\mobile
npm install
npx expo start
```

This will show a QR code in Terminal. Scan it with the **Expo Go** app on your phone.

#### First Launch:
1. Enter PIN: **1234** (you can change this in Settings later)
2. You'll see the **Today** screen with any jobs scheduled for today
3. Tap a job card to enter the workflow:
   - 🚗 Start Driving → 🔨 Arrive & Start → ✅ Complete → 📧 Invoice

#### Change the Default PIN:
Go to **Settings** tab → **Change PIN** section → enter current (1234) and your new PIN.

#### Build an APK (for install without Expo Go):

```bash
cd d:\gardening\mobile
npx eas build --platform android --profile preview
```

This requires an Expo account (free). The APK will be downloadable from your Expo dashboard.

---

### Step 7: Test the Business Tactics Agent Manually

```bash
cd d:\gardening\agents
node business-tactics.js check
```

This runs a quick pricing health check. For a full analysis (requires Ollama):

```bash
node business-tactics.js full
```

Or use the interactive menu:

```bash
business-tactics.bat
```

---

## Quick Reference

| Component | Location | Action |
|-----------|----------|--------|
| Website HTML/JS | `d:\gardening\` | `git push` to deploy |
| Code.gs | `d:\gardening\apps-script\Code.gs` | Paste into Apps Script, new deployment |
| Hub Python | `d:\gardening\platform\` | Run with `python app\main.py` |
| Business Tactics | `d:\gardening\agents\business-tactics.js` | Runs Monday 08:30 via orchestrator |
| Mobile App | `d:\gardening\mobile\` | `npm install` then `npx expo start` |
| Orchestrator | `d:\gardening\agents\orchestrator.js` | `node orchestrator.js` or scheduled runs |

---

## New Files Created This Session

```
agents/business-tactics.js        — AI strategy agent
agents/business-tactics.bat       — Manual run menu

mobile/package.json               — Expo project config
mobile/app.json                   — App metadata & permissions
mobile/babel.config.js            — Transpiler config
mobile/App.js                     — Main app entry with navigation
mobile/src/theme.js               — Email-matching design system
mobile/src/services/api.js        — API service with offline queue
mobile/src/screens/PinScreen.js   — PIN lock screen
mobile/src/screens/TodayScreen.js — Daily job list
mobile/src/screens/JobDetailScreen.js — Job workflow & photos
mobile/src/screens/ScheduleScreen.js  — Weekly schedule view
mobile/src/screens/ClientsScreen.js   — Client lookup & history
mobile/src/screens/SettingsScreen.js  — PIN change, sync, info
```

## Modified Files

```
js/main.js        — NaN bug fix (counter animation guard)
about.html        — Removed bespoke section + CSS
apps-script/Code.gs  — Business recs + mobile endpoints (6 new routes)
agents/orchestrator.js — Added business-tactics agent (Monday 08:30)
platform/app/database.py — business_recommendations table + methods
platform/app/sync.py     — Business recommendations sync
platform/app/tabs/admin.py — Strategy sub-tab with KPIs
```
