# GGM Field App v3.1.0 — Node 1 Build & Deploy Guide

> **Node 1 (PC Hub) — Execute ALL steps below after git pull.**
> **Date: 21 February 2026**

---

## What Changed

**Mobile app v3.1.0** is a complete enterprise overhaul of the field operations app.

### Summary

| Category | Count | Details |
|----------|-------|---------|
| **New components** | 11 | GGMCard, StatusBadge, KPICard, IconButton, FormField, ChecklistItem, SectionHeader, EmptyState, LoadingOverlay, ConfirmModal, ProgressSteps |
| **New screens** | 9 | RiskAssessment, Signature, ClientDetail, Weather, Quote, Expenses, Notes, Route, More |
| **Rewritten screens** | 7 | Today, JobDetail, Schedule, Clients, Settings, Bots, Pin |
| **New API endpoints** | 12 | Risk assessments, job expenses, client signatures, quotes, weather, field notes, reschedule/cancel |
| **New GAS handlers** | 5 | saveRiskAssessment, getRiskAssessment, saveJobExpense, getJobExpenses, submitClientSignature |
| **New Google Sheets** | 3 | "Risk Assessments", "Job Expenses", "Job Signoffs" (auto-created on first use) |
| **App icon** | Updated | Gardner's GM logo on white background — proper icon, adaptive-icon, splash, favicon |

### Key Fixes

- **test_probe / Unknown removed** from Settings — now filters to known nodes only (`pc-hub`, `laptop-field`, `mobile-field`)
- **Risk assessment gate** — field operatives must complete H&S checklist before starting any job
- **Client signature capture** — digital sign-off on job completion
- **All emoji replaced** with Ionicons throughout the app
- **Professional 4-tab layout**: Today / Schedule / Clients / More

### New Dependencies (auto-installed by `npm install`)

- `expo-av` ~15.0.0 — voice note recording
- `expo-linear-gradient` ~14.0.0 — UI gradients
- `react-native-signature-canvas` ^4.7.2 — client signature capture

---

## Pre-Requisites

| Requirement | Check |
|-------------|-------|
| Node.js 18+ | `node --version` |
| npm 9+ | `npm --version` |
| EAS CLI | `npx eas --version` (or `npm install -g eas-cli`) |
| Git pulled | `cd C:\GGM-Hub && git pull origin master` |
| Internet | Required for EAS cloud build |

---

## Step 1: Pull Latest Code

```powershell
cd C:\GGM-Hub
git fetch origin
git pull origin master
```

Verify the mobile version:
```powershell
(Get-Content C:\GGM-Hub\mobile\package.json | ConvertFrom-Json).version
# Expected: 3.1.0
```

---

## Step 2: Install Dependencies

```powershell
cd C:\GGM-Hub\mobile
npm install
```

This installs the 3 new dependencies (`expo-av`, `expo-linear-gradient`, `react-native-signature-canvas`).

---

## Step 3: Log In to EAS

```powershell
npx eas login
```

| Field | Value |
|-------|-------|
| Username | `chrisgardner` |
| Password | `@Cruxy2025!` |

Verify login:
```powershell
npx eas whoami
# Expected: chrisgardner
```

---

## Step 4: Build the APK

```powershell
cd C:\GGM-Hub\mobile
npx eas build --platform android --profile preview --non-interactive
```

This builds an APK via the EAS cloud (~5–10 minutes). The profile `preview` is configured in `eas.json` to produce a sideloadable `.apk` file.

**Wait for the build to complete.** The terminal will show a URL like:
```
Build details: https://expo.dev/accounts/chrisgardner/projects/ggm-field-app/builds/xxxxxxxx
```

---

## Step 5: Download the APK

Once the build finishes:

1. Open the build URL from the terminal output, **or** go to:
   `https://expo.dev/accounts/chrisgardner/projects/ggm-field-app/builds`
2. Click the latest build (should say **v3.1.0**)
3. Click **Download** to save the `.apk` file

---

## Step 6: Install on the Phone

### Option A: USB Sideload (recommended)

1. Connect the Android phone via USB
2. Enable **USB Debugging** on the phone (Settings → Developer Options → USB Debugging)
3. Run:

```powershell
adb install -r "C:\Users\Chris\Downloads\<filename>.apk"
```

Replace `<filename>` with the actual downloaded APK filename.

### Option B: Transfer & Install

1. Copy the `.apk` to the phone via USB file transfer
2. Open the file on the phone using a file manager
3. Tap **Install** (you may need to allow "Install from unknown sources")

---

## Step 7: Verify the Build

After installing v3.1.0 on the phone:

| Check | Expected Result |
|-------|----------------|
| **App icon** | Gardner's GM logo on white background (not solid green) |
| **PIN screen** | Leaf icon (Ionicons), no emoji |
| **Today tab** | Weather banner, KPI cards, job cards with service icons |
| **Schedule tab** | Week navigation with arrow icons, service badges |
| **Clients tab** | Search bar with Ionicons, client cards navigate to detail screen |
| **Settings → Network** | Shows only pc-hub, laptop-field, mobile-field (no test_probe/unknown) |
| **Settings → Force Sync** | Button present, triggers sync |
| **Job → Start Work** | Requires Risk Assessment completion first |
| **Job → Complete** | Client Signature capture available |
| **More tab** | Risk Assessment, Expenses, Notes, Weather, Route, Quote options |

### Node Connectivity Check

From the Hub (Node 1) Overview tab:
- **Node 3 (Mobile)** should show **Online** with a recent heartbeat after opening the app

From the phone Settings screen:
- **PC Hub (Node 1)** should show **Online**
- **Laptop (Node 2)** will show status based on last heartbeat

---

## Step 8: Verify GAS Endpoints

The GAS has been redeployed (@162) with the new endpoints. Quick test:

```powershell
# Test risk assessment endpoint
$url = "https://script.google.com/macros/s/AKfycbxaT1YOoDZtVHP9CztiUutYFqMiOyygDJon5BxCij14CWl91WgdmrYqpbG4KVAlFh5IiQ/exec?action=get_risk_assessment&jobRef=TEST-001"
(Invoke-WebRequest -Uri $url -UseBasicParsing).Content
# Expected: {"success":true,"data":null} (no assessment for TEST-001 yet)

# Test job expenses endpoint
$url2 = "https://script.google.com/macros/s/AKfycbxaT1YOoDZtVHP9CztiUutYFqMiOyygDJon5BxCij14CWl91WgdmrYqpbG4KVAlFh5IiQ/exec?action=get_job_expenses"
(Invoke-WebRequest -Uri $url2 -UseBasicParsing).Content
# Expected: {"success":true,"data":[]} (empty array, no expenses yet)
```

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| `eas: command not found` | `npm install -g eas-cli` |
| `Not logged in` | `npx eas login` with credentials above |
| Build fails on dependencies | Delete `node_modules` and `package-lock.json`, then `npm install` again |
| APK won't install | Uninstall the old version first: `adb uninstall uk.co.gardnersgm.field` then install fresh |
| App crashes on launch | Check for missing native modules — may need `npx expo prebuild --clean` before EAS build |
| Node 3 stays Offline | Open the app, wait 30 seconds for heartbeat, check Hub Overview refresh |
| GAS returns 404 | GAS deployment @162 may not have propagated — wait 5 min and retry |

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| **3.1.0** | 2026-02-21 | Gardner's GM logo app icon (white bg), iOS config, version bump |
| **3.0.0** | 2026-02-21 | Enterprise overhaul: 11 components, 9 new screens, 7 rewrites, risk assessments, signatures, expenses |
| 2.4.0 | 2026-02-20 | Push notification fix, OTA updates enabled |
| 2.3.0 | 2026-02-20 | Photo type prompt, invoice data fix |
| 2.0.0 | 2026-02-15 | Initial 5-screen prototype |

---

## Architecture Reference

```
Phone (Node 3)                    GAS Webhook                     PC Hub (Node 1)
┌──────────────┐                 ┌──────────────┐                ┌──────────────┐
│  GGM Field   │──── REST ──────▶│  Code.gs     │◀── sync ──────│  GGM Hub     │
│  v3.1.0      │                 │  @162        │                │  v4.8.0      │
│              │◀── response ────│              │──── notify ───▶│              │
│  Expo/RN     │                 │  Sheets DB   │                │  Python/CTk  │
└──────────────┘                 └──────────────┘                └──────────────┘
       │                                │                               │
       └──── heartbeat (2min) ──────────┘                               │
                                        └──── heartbeat (2min) ─────────┘

Laptop (Node 2)
┌──────────────┐
│  Dev Machine │── git push ──▶ GitHub ── auto-pull (15min) ──▶ Node 1
│  D:\gardening│
└──────────────┘
```

All nodes communicate exclusively through **Google Apps Script** (data) and **GitHub** (code). No direct networking.
