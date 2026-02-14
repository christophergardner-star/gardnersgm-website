# GGM Hub — Google Apps Script Deployment Guide

## Overview

The `Code.gs` file in this directory is the **canonical, version-controlled source** for the Google Apps Script web app that serves as the central API backbone for all GGM Hub nodes.

### Architecture

```
📱 Mobile App (Node 3)  →  Code.gs (GAS)  ←  💻 Laptop Field App (Node 2)
                                ↕
                          🖥️ PC Hub (Node 1)
                                ↕
                          🌐 Website (booking.js, chatbot, etc.)
```

All 3 nodes + the public website communicate through this single GAS endpoint.

---

## Deployment Options

### Option A: Manual Copy/Paste (Simplest)

1. Open the Apps Script editor: https://script.google.com
2. Open your existing GGM project
3. Select all code in `Code.gs` in the editor
4. Replace it with the contents of this file's `Code.gs`
5. Click **Deploy → Manage deployments → New deployment**
6. Choose **Web app** → Execute as **Me** → Access **Anyone**
7. Click **Deploy** and copy the new URL
8. Update the webhook URL in:
   - `platform/app/config.py` (SHEETS_WEBHOOK)
   - `platform/field_app.py` (_load_webhook fallback)
   - `js/booking.js` (SHEETS_WEBHOOK const)

### Option B: Using `clasp` (Recommended for ongoing development)

1. Install clasp: `npm install -g @google/clasp`
2. Login: `clasp login`
3. Clone your existing project OR create `.clasp.json`:

```json
{
  "scriptId": "YOUR_SCRIPT_ID_HERE",
  "rootDir": "./gas"
}
```

4. Push changes: `clasp push`
5. Deploy: `clasp deploy --description "v4.0.0 — Multi-node sync"`

To find your Script ID:
- Open Apps Script editor → Settings (gear icon) → Script ID

---

## Stub Functions

The bottom of `Code.gs` contains **stub functions** that return `{ status: 'success' }`. These represent your existing GAS implementations that already live in the Apps Script editor.

### Migration Strategy

When deploying for the first time:

1. **Keep your existing function implementations** — they contain the real business logic
2. **Replace only the `doGet()` and `doPost()` functions** with the consolidated router from this file
3. **Add the new functions** that don't exist yet:
   - `handleRegisterPushToken()`
   - `handleGetMobilePushTokens()`
   - `handleValidateMobilePin()`
   - `handleLogMobileActivity()`
   - `sendExpoPush()`
   - `storeJobLocation()`
   - `handleNodeHeartbeat()`
   - `handleGetNodeStatus()`
   - `handleQueueRemoteCommand()`
   - `handleGetRemoteCommands()`
   - `handleUpdateRemoteCommand()`
   - `_notifyMobileNewBooking()`
   - `isActionAllowed()` (node role enforcement)
4. **Delete the stub functions** for any handler you've already implemented
5. Redeploy

---

## Node Roles

| Node | Role | Access Level |
|------|------|-------------|
| `pc_hub` | Master | All 138+ actions |
| `field_laptop` | Field | All actions (delegates heavy work via command queue) |
| `mobile-field` | Worker | ~16 actions (jobs, status, photos, heartbeat, PIN) |
| Website | Public | ~40 actions (bookings, blog, testimonials, payments) |

Role enforcement is handled by `isActionAllowed()` in the `doPost()` handler. POST requests from mobile nodes that attempt restricted actions will receive a 403 response.

---

## Script Properties

Set these in Apps Script editor → Settings → Script Properties:

| Property | Description |
|----------|-------------|
| `STRIPE_SECRET_KEY` | Stripe API secret key |
| `TG_BOT_TOKEN` | Telegram bot token |
| `TG_CHAT_ID` | Telegram chat ID for notifications |

---

## Key Features

- **138+ API endpoints** covering all business operations
- **Node role enforcement** — mobile can't delete clients, website can't access admin data
- **Automatic mobile push notifications** on new bookings via Expo Push API
- **Job location tracking** — GPS coordinates stored on status changes
- **Activity logging** — all API calls logged for audit trail
- **Push token management** — mobile devices auto-register for notifications
- **Command queue** — laptop can delegate heavy tasks to PC Hub

---

## Changelog

### v4.0.0
- Consolidated all doGet/doPost routing into single canonical file
- Added node role enforcement (`isActionAllowed`)
- Merged all mobile Node 3 functions (from `GAS_ADDITIONS.js`)
- Added `_notifyMobileNewBooking()` — auto push on new bookings
- Added `storeJobLocation()` — GPS tracking on job status changes
- Version-controlled in `gas/` directory
