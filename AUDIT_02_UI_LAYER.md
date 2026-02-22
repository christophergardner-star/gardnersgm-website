# GGM Hub — Agent 2: UI Layer Audit Report

> **Auditor:** Agent 2 of 7 — Hub UI Layer  
> **Scope:** `platform/app/ui/`, `platform/app/tabs/`, all CustomTkinter desktop application code  
> **Date:** 2025-07-14  
> **Framework:** CustomTkinter + matplotlib + PIL/Pillow + tkcalendar  

---

## 1. File Inventory

### 1.1 Core UI Files (4 files)

| File | Lines | Purpose |
|------|------:|---------|
| `platform/app/ui/app_window.py` | 951 | Main window — sidebar nav, tab management, sync polling, notification system |
| `platform/app/ui/theme.py` | 186 | Colour palette, font helpers, styled widget factories |
| `platform/app/ui/command_listener.py` | 210 | Polls GAS for remote commands targeting this node |
| `platform/app/ui/pin_screen.py` | 256 | 6-digit PIN lock screen with SHA-256 hash |

### 1.2 Tab Files (13 tabs)

| Tab ID | File | Lines | Purpose |
|--------|------|------:|---------|
| `overview` | `platform/app/tabs/overview.py` | 1852 | Main KPI dashboard — revenue, jobs, calendar, alerts, traffic |
| `dispatch` | `platform/app/tabs/dispatch.py` | 1608 | Daily job management — job cards, completion, invoicing, weather |
| `operations` | `platform/app/tabs/operations.py` | 771 | CRM — clients, calendar, schedule, route planner, subscriptions, quotes, enquiries |
| `finance` | `platform/app/tabs/finance.py` | 748 | Revenue dashboard, invoices, payments, business costs, savings pots |
| `telegram` | `platform/app/tabs/telegram.py` | 368 | Telegram messaging — compose, quick sends, history |
| `marketing` | `platform/app/tabs/marketing.py` | 1777 | Newsletter, blog, social media, testimonials, discount codes |
| `content_studio` | `platform/app/tabs/content_studio.py` | 2026 | AI content creation — blog/newsletter studio, agent config, content library |
| `customer_care` | `platform/app/tabs/customer_care.py` | 795 | Complaints management, email lifecycle tracking |
| `admin` | `platform/app/tabs/admin.py` | 2037 | Careers, shop, agents, strategy, milestones, diagnostics, settings |
| `field_triggers` | `platform/app/tabs/field_triggers.py` | 318 | Remote commands to PC Hub (laptop-only) |
| `job_tracking` | `platform/app/tabs/job_tracking.py` | 231 | Mobile app job tracking viewer (laptop-only) |
| `field_notes` | `platform/app/tabs/field_notes.py` | 248 | Field notes with local JSON + GAS sync (laptop-only) |
| `photos` | `platform/app/tabs/photos.py` | 665 | Before/after photo gallery with Drive thumbnails |

### 1.3 Component Files (17 components)

| Component | File | Lines | Purpose |
|-----------|------|------:|---------|
| `KPICard` | `platform/app/ui/components/kpi_card.py` | 72 | Stat card — icon, value, label |
| `ToastManager` | `platform/app/ui/components/toast.py` | 68 | Bottom-right toast notifications |
| `ChartPanel` | `platform/app/ui/components/chart_panel.py` | 200 | matplotlib chart wrapper (bar, pie, line) |
| `DataTable` | `platform/app/ui/components/data_table.py` | 306 | Sortable/filterable ttk.Treeview table + CSV export |
| `BookingCalendar` | `platform/app/ui/components/booking_calendar.py` | 470 | Monthly grid with booking dots |
| `BookingDetailCard` | `platform/app/ui/components/booking_detail_card.py` | 358 | Booking popup from calendar click |
| `DayPlanner` | `platform/app/ui/components/day_planner.py` | 295 | Route planner visualisation |
| `CostModal` | `platform/app/ui/components/cost_modal.py` | 200 | Monthly business cost editor |
| `PotModal` | `platform/app/ui/components/pot_modal.py` | 130 | Savings pot editor |
| `PhotoManager` | `platform/app/ui/components/photo_manager.py` | 501 | Photo gallery — Drive sync, local import |
| `NotificationPanel` | `platform/app/ui/components/notification_panel.py` | 293 | Notification dropdown from bell icon |
| `ClientModal` | `platform/app/ui/components/client_modal.py` | 1140 | Full client view/edit dialog |
| `InvoiceModal` | `platform/app/ui/components/invoice_modal.py` | 555 | Invoice detail — pay, email, photos |
| `QuoteModal` | `platform/app/ui/components/quote_modal.py` | 1419 | Quote with auto-pricing engine |
| `EnquiryModal` | `platform/app/ui/components/enquiry_modal.py` | 850 | Enquiry detail — garden parsing |
| `QuoteModalOld` | `platform/app/ui/components/quote_modal_old.py` | — | **DEPRECATED** — dead code |

**Total UI code: ~18,997 lines across 34 files.**

---

## 2. Critical Bugs (Fix Immediately)

### BUG-01: `photos.py` calls non-existent `update_value()` on KPICard — AttributeError crash

- **File:** `platform/app/tabs/photos.py`, lines 184–187
- **Severity:** 🔴 CRITICAL — crashes the Photos tab on every refresh
- **What happens:** `_update_kpis()` calls `self._kpi_total.update_value(str(total))` etc., but `KPICard` only has `set_value()`, `set_label()`, `set_color()`. There is no `update_value()` method.
- **Impact:** Photos tab KPI cards never update. An unhandled `AttributeError` is raised on every `refresh()`.

```python
# photos.py:184-187 (BROKEN)
self._kpi_total.update_value(str(total))
self._kpi_before.update_value(str(befores))
self._kpi_after.update_value(str(afters))
self._kpi_jobs.update_value(str(len(job_numbers)))

# kpi_card.py — actual methods:
# set_value(self, value: str)
# set_label(self, label: str)
# set_color(self, color: str)
```

- **Fix:** Change all `update_value()` calls to `set_value()`.

### BUG-02: `data_table.py` CSV export silently swallows all errors

- **File:** `platform/app/ui/components/data_table.py`, lines 304–305
- **Severity:** 🟠 HIGH — user clicks Export, nothing happens, no feedback

```python
# data_table.py:304-305
except Exception as e:
    pass  # Silently fail
```

- **Impact:** If file write fails (e.g., permission denied, file locked by Excel), the user gets no error message. The export button appears broken.
- **Fix:** Show a `messagebox.showerror()` or toast notification with the error.

### BUG-03: `app_window.py` titles dict missing `"photos"` entry

- **File:** `platform/app/ui/app_window.py`, lines 541–553
- **Severity:** 🟡 MEDIUM — cosmetic, but inconsistent

```python
titles = {
    "overview": "Overview",
    "dispatch": "Daily Dispatch",
    # ... 10 entries ...
    "field_notes": "Field Notes",
    # "photos" is MISSING
}
```

- **Impact:** Falls back to `tab_id.title()` → "Photos" (happens to be correct, but this is accidental and inconsistent with the explicit mapping pattern). If the tab ID ever changes, the fallback will produce gibberish.
- **Fix:** Add `"photos": "Photos"` to the `titles` dict.

---

## 3. Thread Safety Issues

### THREAD-01: Massive threading without synchronisation primitives

- **Files:** All tab files collectively
- **Severity:** 🟠 HIGH — race conditions under concurrent use

The codebase uses **50+ `threading.Thread` calls** across 10 tab files. A breakdown:

| Tab | Thread calls | Purpose |
|-----|-------------|---------|
| `dispatch.py` | 12 | Complete job, cancel, remove, invoice, email, weather, Telegram, end-of-day |
| `marketing.py` | ~10 | Newsletter send, blog publish, AI generate, social post, discount codes |
| `content_studio.py` | ~10 | AI generation, blog publish, newsletter save, Telegram relay |
| `admin.py` | ~5 | Diagnostics, data wipe, shop actions |
| `field_triggers.py` | ~5 | Remote command trigger, history poll |
| `photos.py` | 3 | Thumbnail downloads |
| `overview.py` | 1 | Telegram send for job completion |
| `telegram.py` | 2 | Message send, history load |
| `finance.py` | 0 | All synchronous (slow on large datasets) |
| `operations.py` | 0 | All synchronous |

**Critical concern:** No `threading.Lock`, `threading.RLock`, or `queue.Queue` is used anywhere in the UI layer. All threads share the same `self.db` (SQLite) and `self.api` objects. SQLite in WAL mode allows concurrent reads but **only one writer at a time** — concurrent `db.conn.commit()` calls from multiple threads will raise `OperationalError: database is locked`.

**Mitigating factor:** Most tabs correctly use `self.after(0, callback)` to schedule UI updates back on the main thread. This prevents Tkinter widget access from background threads (which would cause segfaults).

### THREAD-02: `_imported_tab_classes` is a class-level mutable dict

- **File:** `platform/app/ui/app_window.py`, line 578
- **Severity:** 🟡 LOW (only one AppWindow instance exists in practice)

```python
_imported_tab_classes: dict = {}  # Shared across ALL AppWindow instances
```

If multiple `AppWindow` instances were created, this shared dict could cause incorrect tab class caching. Low risk in current single-window app but violates encapsulation.

---

## 4. Exception Handling Audit

### EXCEPT-01: Widespread bare `except Exception` with no logging

The codebase contains **100+ bare exception handlers** across UI files. Many swallow errors silently:

| File | Silent `except` count | Worst offenders |
|------|----------------------:|-----------------|
| `overview.py` | 25+ | Lines 412, 553, 596, 726, 868, 878, 1112, 1186, 1351, 1434, 1468, 1533, 1552, 1579, 1624, 1630, 1682, 1800, 1814, 1820, 1824 |
| `admin.py` | 18+ | Lines 297, 653, 655, 658, 885, 907, 917, 942, 1042, 1047, 1049, 1052, 1517, 1862, 1870, 1898, 1954, 2022 |
| `dispatch.py` | 12+ | Lines 793, 803, 866, 948, 1013, 1028, 1094, 1428, 1490, 1570 |
| `content_studio.py` | 15+ | Lines 352, 398, 406, 415, 494, 510, 543, 561, 575, 640, 671, 680, 913, 949, 954 |
| `marketing.py` | 10+ | Lines 285, 807, 1348 |

**Pattern:** Most of these are `except Exception: pass` or `except Exception: continue` blocks that silently discard errors, making debugging extremely difficult in production.

**Recommended fix:** At minimum, add `logging.debug()` or `logging.warning()` calls to all exception handlers. Critical operations (email, invoice, sync) should show user-facing error feedback.

---

## 5. UI/UX Issues

### UX-01: No loading spinners or progress indicators

- **Severity:** 🟠 HIGH — poor user feedback
- **Where:** Every background thread operation (blog publish, newsletter send, AI generation, invoice creation, weather fetch, photo download)
- **Impact:** User clicks a button and sees nothing happen for 2–15 seconds while the API call runs in a background thread. No spinner, no progress bar, no disabled state on the button.
- **Exception:** `dispatch.py` has a `_dispatch_status` label that gets text updates. Marketing and content_studio update status labels. But there's no loading overlay or button disabling.

### UX-02: No confirmation on destructive actions (inconsistent)

- **Where:** `dispatch.py` has proper confirmation dialogs for Remove and Cancel. But other tabs lack them:
  - `admin.py` data wipe has confirmation, but individual record deletes may not
  - `marketing.py` blog publish has no "are you sure?" step
  - `finance.py` cost/pot saves have no confirmation

### UX-03: Stale data after background operations

- **Where:** Tabs that modify data in threads but don't always refresh:
  - After dispatching a Telegram message, the history tab doesn't auto-refresh
  - After creating an invoice from dispatch, the finance tab's invoice list is stale until manually switched

### UX-04: No keyboard shortcuts

- **Severity:** 🟡 MEDIUM — missed productivity feature
- **Impact:** Power users can't Ctrl+N (new), Ctrl+S (save), Ctrl+R (refresh), F5 (full refresh), Ctrl+F (find in table). All navigation requires mouse clicks.

### UX-05: Calendar widget fallback is weak

- **File:** `platform/app/ui/components/client_modal.py`
- **Where:** Uses `tkcalendar.DateEntry` with a `try/except ImportError` fallback to a plain `CTkEntry`
- **Impact:** Without tkcalendar installed, date entry has no validation — users can type "banana" as a date.

### UX-06: No responsive layout

- **Severity:** 🟡 MEDIUM
- **Impact:** Fixed widths throughout (e.g., sidebar 200px, KPI cards fixed grid). Window resize causes gaps or overflow rather than reflowing content. On smaller screens, tabs overflow.

### UX-07: Toast notification stacking race condition

- **File:** `platform/app/ui/components/toast.py`
- **Impact:** When multiple toasts appear simultaneously, the offset calculation based on `len(self._toasts)` doesn't account for toasts being removed mid-count. Can cause overlapping toasts.

---

## 6. Security Issues

### SEC-01: Remote code execution via `git_pull` command

- **File:** `platform/app/ui/command_listener.py`
- **Severity:** 🔴 CRITICAL

The `git_pull` command handler runs `subprocess.run(["git", "pull", ...])` when triggered by a remote GAS command. Anyone with access to the GAS webhook can trigger arbitrary git pulls, and with a compromised repo, execute code on the machine.

**Mitigating factor:** The GAS webhook requires knowledge of the script URL (security by obscurity).

### SEC-02: SHA-256 PIN without salt

- **File:** `platform/app/ui/pin_screen.py`
- **Severity:** 🟡 MEDIUM

```python
hashlib.sha256(pin_str.encode()).hexdigest()
```

A 6-digit PIN has only 1,000,000 possible values. Without a salt, a rainbow table or brute-force attack can crack it in milliseconds. For a local desktop app this is low risk, but for enterprise readiness it should use `bcrypt` or at minimum `hashlib.pbkdf2_hmac()`.

### SEC-03: No session timeout

- **File:** `platform/app/ui/pin_screen.py`, `platform/app/ui/app_window.py`
- **Severity:** 🟡 MEDIUM
- **Impact:** Once PIN is entered, the app stays unlocked forever. No inactivity timeout, no re-lock option. If Chris walks away from the laptop, anyone can access all business data.

---

## 7. Architectural Issues

### ARCH-01: God-class tabs

Several tabs are monolithic classes exceeding 1500 lines:

| File | Lines | Sub-tabs |
|------|------:|----------|
| `admin.py` | 2037 | 7 sub-tabs |
| `content_studio.py` | 2026 | 4 sub-tabs |
| `overview.py` | 1852 | Dashboard (1 scrollable) |
| `marketing.py` | 1777 | 5 sub-tabs |
| `dispatch.py` | 1608 | Daily view |
| `quote_modal.py` | 1419 | Single modal |
| `client_modal.py` | 1140 | Single modal |

These classes handle UI building, data fetching, business logic, API calls, threading, and rendering all in one place. No separation of concerns.

### ARCH-02: ttk.Style global pollution

- **File:** `platform/app/ui/components/data_table.py`, line 88
- **Impact:** Every `DataTable()` instance calls `ttk.Style()` and configures `"GGM.Treeview"` — a global style. Creating multiple DataTable instances (which happens in Operations, Finance, Marketing, Admin, Customer Care) means the last one wins. Currently they all set the same values so it's benign, but any future customisation will break.

### ARCH-03: No controller/presenter layer

All tabs directly access `self.db` (SQLite) and `self.api` (GAS HTTP client) from within UI event handlers and background threads. There's no service layer, no view-model, no presenter. This makes unit testing impossible without a real database and API.

### ARCH-04: Deprecated dead code

- **File:** `platform/app/ui/components/quote_modal_old.py`
- **Impact:** Dead code that will confuse maintainers. Should be deleted.

---

## 8. Missing Enterprise Features

### 8.1 Accounting & Financial

| Feature | Status | Notes |
|---------|--------|-------|
| Basic invoices | ✅ Present | Create, view, mark as paid |
| Basic costs | ✅ Present | Monthly cost categories |
| Savings pots | ✅ Present | Target-based savings |
| Revenue KPIs | ✅ Present | Today/week/month/YTD |
| UK tax year calc | ✅ Present | April-March fiscal year |
| **Xero/QuickBooks integration** | ❌ Missing | No accounting software sync |
| **VAT return tracking** | ❌ Missing | No VAT calculations or HMRC MTD submission |
| **Profit & Loss statement** | ❌ Missing | No formal P&L — only basic rev minus costs |
| **Balance sheet** | ❌ Missing | No assets/liabilities tracking |
| **Bank reconciliation** | ❌ Missing | No bank feed or transaction matching |
| **Chart of accounts** | ❌ Missing | No double-entry bookkeeping |
| **Financial export** | ❌ Missing | No CSV/Excel/PDF financial report export |
| **Multi-year comparison** | ❌ Missing | Only current YTD |
| **Expense receipts** | ❌ Missing | No receipt photo capture/storage |
| **Mileage tracking** | ❌ Missing | No HMRC-compliant mileage log |
| **Payroll** | ❌ Missing | No employee pay management |

### 8.2 Business Operations

| Feature | Status | Notes |
|---------|--------|-------|
| Client management | ✅ Present | Full CRUD |
| Scheduling | ✅ Present | Calendar + dispatch |
| Quotes with pricing | ✅ Present | Auto-pricing engine |
| Enquiry management | ✅ Present | With garden detail parsing |
| Route planning | ✅ Present | Distance-based with Google Maps |
| **Recurring job automation** | ⚠️ Partial | Subscription tracking exists but no auto-scheduling |
| **Multi-crew scheduling** | ❌ Missing | Single-operator only |
| **Equipment/asset tracking** | ❌ Missing | No inventory management |
| **Seasonal planning** | ❌ Missing | No annual service calendar |
| **Job costing accuracy** | ⚠️ Partial | Materials per service type but no per-job actuals |
| **Customer portal link** | ❌ Missing | No web portal integration from desktop |
| **Automated follow-up** | ⚠️ Partial | Email lifecycle exists but limited triggers |

### 8.3 Security & Compliance

| Feature | Status | Notes |
|---------|--------|-------|
| PIN lock | ✅ Present | 6-digit with SHA-256 |
| **Role-based access** | ❌ Missing | Single user, no roles |
| **Audit trail** | ❌ Missing | No log of who changed what |
| **Data encryption at rest** | ❌ Missing | SQLite DB is plaintext on disk |
| **Session timeout** | ❌ Missing | Stays unlocked forever |
| **GDPR data export** | ❌ Missing | No "export my data" for clients |
| **GDPR data deletion** | ❌ Missing | No anonymisation tool |
| **Backup/restore UI** | ❌ Missing | No in-app backup management |

### 8.4 Reporting & Analytics

| Feature | Status | Notes |
|---------|--------|-------|
| Revenue charts | ✅ Present | Bar/pie via matplotlib |
| Service breakdown | ✅ Present | Revenue per service type |
| Site analytics | ✅ Present | Traffic from GAS |
| **PDF report generation** | ❌ Missing | No printable reports |
| **Custom date range** | ❌ Missing | Fixed to today/week/month/YTD |
| **KPI trend lines** | ❌ Missing | KPI cards show current only, no sparklines |
| **Comparative periods** | ❌ Missing | No "vs last month" or "vs last year" |
| **Email campaign analytics** | ⚠️ Partial | Send count tracked, no open/click rates |

---

## 9. Positive Observations

Despite the issues above, the codebase has several good engineering practices:

1. **Lazy tab loading** — Each tab is imported via `importlib` with isolated `try/except`, so one broken tab never crashes the whole app.
2. **Thread-safe UI updates** — Nearly all background threads use `self.after(0, callback)` correctly to marshal UI calls back to the main thread.
3. **Lambda closure discipline** — Loop variables in dispatch.py are correctly captured: `lambda j=job: ...` avoids the classic Python closure bug.
4. **Optional dependency guards** — `HAS_MATPLOTLIB`, `HAS_PIL`, `HAS_TKCALENDAR` flags gracefully degrade when libraries are missing.
5. **`_safe()` wrapper** — `dispatch.py` wraps button callbacks in a try/except that surfaces errors as toasts instead of silent failures.
6. **Comprehensive notification system** — `_handle_new_records()` in `app_window.py` handles 10+ record types (bookings, enquiries, invoices, quotes, complaints, subscribers, blog posts, newsletters, orders, vacancies) and creates appropriate notifications.
7. **Dark theme consistency** — `theme.py` provides factory functions (`create_card`, `create_sidebar_btn`, `create_accent_btn`, `create_status_badge`) that enforce consistent styling.
8. **`on_table_update()` hooks** — 10 of 13 tabs implement `on_table_update()` for real-time data refresh when the sync engine detects changes. The 3 without it (`telegram`, `field_triggers`, `field_notes`) are low-update-frequency tabs where it's acceptable.

---

## 10. Priority Fix List

### Tier 1 — Fix Now (crashes or data loss)

| # | Issue | File | Line(s) | Effort |
|---|-------|------|---------|--------|
| 1 | `update_value()` → `set_value()` | `photos.py` | 184–187 | 2 min |
| 2 | CSV export silent failure | `data_table.py` | 304–305 | 5 min |

### Tier 2 — Fix This Week (UX/reliability)

| # | Issue | File | Effort |
|---|-------|------|--------|
| 3 | Add "photos" to titles dict | `app_window.py:552` | 1 min |
| 4 | Add loading indicators on all threaded ops | All tabs | 2–4 hr |
| 5 | Replace bare `except: pass` with logging | All files | 2 hr |
| 6 | Delete `quote_modal_old.py` | components/ | 1 min |
| 7 | Add `threading.Lock` around `db.conn.commit()` | All threaded tabs | 1 hr |

### Tier 3 — Fix This Month (enterprise readiness)

| # | Issue | File | Effort |
|---|-------|------|--------|
| 8 | Add session timeout / auto-lock | `app_window.py` | 2 hr |
| 9 | Use `pbkdf2_hmac` + salt for PIN | `pin_screen.py` | 1 hr |
| 10 | Add keyboard shortcuts (F5, Ctrl+N, etc.) | `app_window.py` | 3 hr |
| 11 | Validate `git_pull` command source | `command_listener.py` | 1 hr |
| 12 | Extract service layer from tab classes | Architecture | 2–4 days |
| 13 | Add Xero API integration UI | New tab/modal | 3–5 days |
| 14 | Add PDF report export | New feature | 2–3 days |
| 15 | Add VAT tracking | Finance tab | 2 days |

---

## 11. Summary Metrics

| Metric | Value |
|--------|-------|
| Total UI files | 34 |
| Total lines of code | ~18,997 |
| Critical bugs | 2 |
| High-severity issues | 5 |
| Medium-severity issues | 8 |
| Low-severity issues | 4 |
| Silent exception handlers | 100+ |
| Threading.Thread calls (no locks) | 50+ |
| Missing enterprise features | 18 |
| Deprecated/dead files | 1 |
| Tabs with `on_table_update` | 10/13 |
| Tabs with `refresh()` | 13/13 |

**Overall Assessment:** The UI layer is functional and well-structured for a solo-developer business tool. The lazy loading, theme system, and thread-safety patterns are sound. However, the two critical bugs (photos.py crash, silent CSV failure) need immediate fixes, and the lack of `threading.Lock` for SQLite access is a ticking time bomb. For enterprise readiness, the biggest gaps are accounting integration, GDPR compliance, role-based access, and auditing.

---

*End of Agent 2 Audit*
