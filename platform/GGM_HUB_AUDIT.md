# GGM Hub — Comprehensive Deep Audit

> **Generated:** 2025  
> **Scope:** Every tab, component, and modal in the GGM Hub CustomTkinter desktop application  
> **Goal:** Identify what's interactive, what's read-only, what's missing, and what's broken

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Overview Tab](#2-overview-tab-overviewpy)
3. [Dispatch Tab](#3-dispatch-tab-dispatchpy)
4. [Operations Tab](#4-operations-tab-operationspy)
5. [Finance Tab](#5-finance-tab-financepy)
6. [Telegram Tab](#6-telegram-tab-telegrampy)
7. [Marketing Tab](#7-marketing-tab-marketingpy)
8. [Customer Care Tab](#8-customer-care-tab-customer_carepy)
9. [Admin Tab](#9-admin-tab-adminpy)
10. [Component Audit](#10-component-audit)
11. [Cross-Cutting Issues](#11-cross-cutting-issues)
12. [Priority Fix List](#12-priority-fix-list)

---

## 1. Executive Summary

### Stats
| Metric | Count |
|---|---|
| Tabs audited | 8 |
| Components audited | 14 |
| Database methods | 80+ |
| DataTables with `on_double_click` | 11 |
| **DataTables WITHOUT `on_double_click` (READ-ONLY)** | **4** |
| Modals with Save | 6 (client, enquiry, invoice, quote, cost, pot) |
| Modals with Delete | 4 (client, enquiry, invoice, quote) |
| `except … pass` (silent swallow) | 10+ across tabs |
| Potential AttributeError bugs | 1 (marketing `_nl_audience`) |

### Critical Findings

1. **4 DataTables are completely read-only** — payments, telegram history, email tracking, testimonials. Users see data but cannot interact with it.
2. **Overview job rows have no click-to-open** — the main dashboard lists today's jobs but you can't double-click to open the client.
3. **Dispatch job cards have no click-to-open** — you can Complete/OnWay/Photos, but not open the full client editor.
4. **Settings constants are not editable** — displayed as labels, not inputs.
5. **Milestones are display-only** — no way to add, edit, or mark milestones.
6. **Testimonials have no CRUD** — only a read-only table with "Pull from Website".
7. **Silent error swallowing** throughout — `except Exception: pass` masks real bugs.

---

## 2. Overview Tab (`overview.py`)

**Purpose:** Main dashboard — first screen the user sees. KPIs, today's jobs, alerts, revenue chart, site traffic, quick actions.

| # | Element | Type | Interactive? | Action | Issue |
|---|---------|------|-------------|--------|-------|
| 1 | KPI: Today's Jobs | `KPICard` | ❌ Read-only | Display only | OK — display widget |
| 2 | KPI: This Week | `KPICard` | ❌ Read-only | Display only | OK |
| 3 | KPI: This Month | `KPICard` | ❌ Read-only | Display only | OK |
| 4 | KPI: Year to Date | `KPICard` | ❌ Read-only | Display only | OK |
| 5 | KPI: Active Subs | `KPICard` | ❌ Read-only | Display only | OK |
| 6 | KPI: Outstanding £ | `KPICard` | ❌ Read-only | Display only | OK |
| 7 | KPI: Site Views (30d) | `KPICard` | ❌ Read-only | Display only | OK |
| 8 | Today's Jobs list | Custom rows | ❌ No click | Each row has ✓ Complete button only | **MISSING CTA** — cannot double-click a job row to open ClientModal |
| 9 | ✓ Complete button (per job) | `CTkButton` | ✅ Click | Marks job complete in DB + syncs to Sheets | OK |
| 10 | Alerts panel | Label list | ❌ Read-only | Displays text alerts | **MISSING CTA** — clicking an alert doesn't navigate anywhere |
| 11 | Revenue chart (14 days) | `ChartPanel` | ❌ Read-only | Bar chart via matplotlib | OK — chart by design |
| 12 | Site Traffic — top pages | Label list | ❌ Read-only | Shows page names + views | OK |
| 13 | Site Traffic — referrers | Label list | ❌ Read-only | Shows referrer sources | OK |
| 14 | Quick Action: Morning Briefing | `CTkButton` | ✅ Click | Generates AI briefing via `build_morning_briefing()` | OK |
| 15 | Quick Action: Generate Schedule | `CTkButton` | ✅ Click | Runs `generate_optimised_schedule()` | OK |
| 16 | Quick Action: Force Sync | `CTkButton` | ✅ Click | Triggers `sync.force_sync()` | OK |

### Issues
| Code | Description |
|------|-------------|
| **MISSING CTA** | Job rows display client name, service, time, postcode — but clicking one does nothing. Should open `ClientModal`. |
| **MISSING CTA** | Alerts (e.g. "5 unpaid invoices") can't be clicked to navigate to the relevant tab/filter. |
| **SILENT ERROR** | `except Exception: pass` at line 624 — swallows analytics load failures silently. |

---

## 3. Dispatch Tab (`dispatch.py`)

**Purpose:** Daily operational hub — manage the day's jobs and field communications.

| # | Element | Type | Interactive? | Action | Issue |
|---|---------|------|-------------|--------|-------|
| 1 | Date navigation: ◀ Prev | `CTkButton` | ✅ Click | Moves to previous day | OK |
| 2 | Date navigation: ▶ Next | `CTkButton` | ✅ Click | Moves to next day | OK |
| 3 | Date navigation: Today | `CTkButton` | ✅ Click | Jumps to today | OK |
| 4 | KPI: Jobs Today | `KPICard` | ❌ Read-only | Display only | OK |
| 5 | KPI: Completed | `KPICard` | ❌ Read-only | Display only | OK |
| 6 | KPI: Revenue Today | `KPICard` | ❌ Read-only | Display only | OK |
| 7 | KPI: Drive Time | `KPICard` | ❌ Read-only | Display only | OK |
| 8 | KPI: Drive Miles | `KPICard` | ❌ Read-only | Display only | OK |
| 9 | Job card (per job) | Custom card | ❌ No click | Shows name, service, time, postcode | **MISSING CTA** — cannot click/double-click a job card to open ClientModal |
| 10 | Job card: ✓ Complete | `CTkButton` | ✅ Click | Marks job done in DB + Sheets | OK |
| 11 | Job card: 📱 On My Way | `CTkButton` | ✅ Click | Sends Telegram to client | OK |
| 12 | Job card: 📸 Photos | `CTkButton` | ✅ Click | Opens `PhotoManager` modal | OK |
| 13 | Fund Allocation display | Labels | ❌ Read-only | Shows fund split (Tax/Reinvest/Savings/Profit) | **READ-ONLY** — no edit capability |
| 14 | Quick Telegram buttons | `CTkButton` ×N | ✅ Click | Send pre-set Telegram messages | OK |
| 15 | Custom Telegram compose | Entry + Send | ✅ Click | Sends custom message via Telegram | OK |
| 16 | Day Summary labels | Labels | ❌ Read-only | Shows hours/revenue/costs summary | OK |
| 17 | End-of-Day Report | `CTkButton` | ✅ Click | Generates AI summary + sends to Telegram | OK |
| 18 | Send Reminders | `CTkButton` | ✅ Click | Sends tomorrow's booking reminders | OK |
| 19 | Check Weather | `CTkButton` | ✅ Click | Fetches and displays weather forecast | OK |

### Issues
| Code | Description |
|------|-------------|
| **MISSING CTA** | Job cards show client info but clicking the card body doesn't open a client editor. Only the ✓/📱/📸 buttons work. Need `<Double-Button-1>` on the card frame → open `ClientModal`. |
| **READ-ONLY** | Fund allocation shows calculated split but user can't adjust percentages from Dispatch (they're defined in `config.py`). Consider linking to Settings. |

---

## 4. Operations Tab (`operations.py`)

**Purpose:** CRM hub — clients, calendar, schedule, route planner, subscriptions, quotes, enquiries. **This is the best-wired tab.**

### Sub-tab: All Clients

| # | Element | Type | Interactive? | Action | Issue |
|---|---------|------|-------------|--------|-------|
| 1 | Status filter | `CTkOptionMenu` | ✅ Select | Filters clients by status | OK |
| 2 | Paid filter | `CTkOptionMenu` | ✅ Select | Filters clients by paid status | OK |
| 3 | ＋ Add Client | `CTkButton` | ✅ Click | Opens blank `ClientModal` | OK |
| 4 | Clients DataTable | `DataTable` | ✅ Double-click | `on_double_click=self._open_client` → opens `ClientModal` | OK ✅ |
| 5 | DataTable search bar | Entry | ✅ Type | Filters rows in real-time | OK |
| 6 | DataTable CSV export | `CTkButton` | ✅ Click | Exports to CSV | OK |

### Sub-tab: Calendar

| # | Element | Type | Interactive? | Action | Issue |
|---|---------|------|-------------|--------|-------|
| 1 | Month navigation | `CTkButton` ×3 | ✅ Click | Prev/Next/Today | OK |
| 2 | Day cells | Calendar grid | ✅ Click | Shows bookings for that day | OK |
| 3 | Booking cards in detail | `BookingDetailCard` | ✅ Click | Edit Client / Map / Call / Photos buttons | OK ✅ |

### Sub-tab: Schedule

| # | Element | Type | Interactive? | Action | Issue |
|---|---------|------|-------------|--------|-------|
| 1 | Schedule DataTable | `DataTable` | ✅ Double-click | `on_double_click=self._open_schedule_client` → opens `ClientModal` | OK ✅ |

### Sub-tab: Route Planner

| # | Element | Type | Interactive? | Action | Issue |
|---|---------|------|-------------|--------|-------|
| 1 | `DayPlanner` component | Full widget | ✅ | Date entry + Plan Route + Open in Maps | OK |
| 2 | Job cards in route | Cards | ✅ Double-click | `on_job_click` handler bound to card + children | OK ✅ |

### Sub-tab: Subscriptions

| # | Element | Type | Interactive? | Action | Issue |
|---|---------|------|-------------|--------|-------|
| 1 | Subscriptions DataTable | `DataTable` | ✅ Double-click | `on_double_click=self._open_client` → opens `ClientModal` | OK ✅ |

### Sub-tab: Quotes

| # | Element | Type | Interactive? | Action | Issue |
|---|---------|------|-------------|--------|-------|
| 1 | Status filter | `CTkOptionMenu` | ✅ Select | Filters by status | OK |
| 2 | ＋ New Quote | `CTkButton` | ✅ Click | Opens blank `QuoteModal` | OK |
| 3 | Quotes DataTable | `DataTable` | ✅ Double-click | `on_double_click=self._open_quote` → opens `QuoteModal` | OK ✅ |

### Sub-tab: Enquiries

| # | Element | Type | Interactive? | Action | Issue |
|---|---------|------|-------------|--------|-------|
| 1 | Status filter | `CTkOptionMenu` | ✅ Select | Filters by status | OK |
| 2 | ＋ Add Enquiry | `CTkButton` | ✅ Click | Opens blank `EnquiryModal` | OK |
| 3 | Enquiries DataTable | `DataTable` | ✅ Double-click | `on_double_click=self._open_enquiry` → opens `EnquiryModal` | OK ✅ |

### Issues
| Code | Description |
|------|-------------|
| — | **None.** This tab is thoroughly wired up. All tables have double-click, all have Add buttons, all open modals. This is the gold standard for the rest of the app. |

---

## 5. Finance Tab (`finance.py`)

**Purpose:** Revenue dashboard, invoices, payments, costs, savings pots.

### Sub-tab: Dashboard

| # | Element | Type | Interactive? | Action | Issue |
|---|---------|------|-------------|--------|-------|
| 1 | KPI: Total Revenue | `KPICard` | ❌ Read-only | Display | OK |
| 2 | KPI: This Month | `KPICard` | ❌ Read-only | Display | OK |
| 3 | KPI: YTD | `KPICard` | ❌ Read-only | Display | OK |
| 4 | KPI: Outstanding | `KPICard` | ❌ Read-only | Display | OK |
| 5 | KPI: Avg Job Value | `KPICard` | ❌ Read-only | Display | OK |
| 6 | Revenue by service chart | `ChartPanel` | ❌ Read-only | Pie chart | OK |
| 7 | Daily revenue chart | `ChartPanel` | ❌ Read-only | Bar chart | OK |
| 8 | Fund allocation display | Labels | ❌ Read-only | Shows tax/reinvest/savings/profit split | OK |

### Sub-tab: Invoices

| # | Element | Type | Interactive? | Action | Issue |
|---|---------|------|-------------|--------|-------|
| 1 | Status filter | `CTkOptionMenu` | ✅ Select | Filters invoices | OK |
| 2 | ＋ New Invoice | `CTkButton` | ✅ Click | Opens blank `InvoiceModal` | OK |
| 3 | Invoices DataTable | `DataTable` | ✅ Double-click | `on_double_click=self._open_invoice` → opens `InvoiceModal` | OK ✅ |

### Sub-tab: Payments

| # | Element | Type | Interactive? | Action | Issue |
|---|---------|------|-------------|--------|-------|
| 1 | Status filter | `CTkOptionMenu` | ✅ Select | Filters payments | OK |
| 2 | Payments DataTable | `DataTable` | ❌ **No double-click** | Rows are completely read-only | **NO DOUBLE-CLICK** |

### Sub-tab: Costs

| # | Element | Type | Interactive? | Action | Issue |
|---|---------|------|-------------|--------|-------|
| 1 | ＋ Add Month | `CTkButton` | ✅ Click | Opens blank `CostModal` | OK |
| 2 | Per-month cost rows | Custom rows | ✅ Edit ✏️ button | Opens `CostModal` with data | OK ✅ |

### Sub-tab: Savings Pots

| # | Element | Type | Interactive? | Action | Issue |
|---|---------|------|-------------|--------|-------|
| 1 | ＋ Add Pot | `CTkButton` | ✅ Click | Opens blank `PotModal` | OK |
| 2 | Pot cards | Custom cards | ✅ Edit button | Opens `PotModal` with data | OK ✅ |

### Issues
| Code | Description |
|------|-------------|
| **NO DOUBLE-CLICK** | `payments_table` has no `on_double_click` handler. Payment rows show method/amount/date but user cannot click to view details, link to invoice, or edit. Payments are fully READ-ONLY. |
| **MISSING CTA** | No "＋ Add Payment" or "Record Payment" button on Payments sub-tab. Manual payment recording requires going through the Invoice modal "Mark Paid" button instead. |

---

## 6. Telegram Tab (`telegram.py`)

**Purpose:** Telegram messaging hub — compose, quick messages, history.

| # | Element | Type | Interactive? | Action | Issue |
|---|---------|------|-------------|--------|-------|
| 1 | Compose text area | `CTkTextbox` | ✅ Type | Type/edit message | OK |
| 2 | Template dropdown | `CTkOptionMenu` | ✅ Select | Inserts message template | OK |
| 3 | Send button | `CTkButton` | ✅ Click | Sends message via Telegram bot API | OK |
| 4 | Clear button | `CTkButton` | ✅ Click | Clears text area | OK |
| 5 | Quick message buttons | `CTkButton` ×N | ✅ Click | One-tap send pre-set messages | OK |
| 6 | History DataTable | `DataTable` | ❌ **No double-click** | Shows sent messages — cannot click to view full text | **NO DOUBLE-CLICK** |

### Issues
| Code | Description |
|------|-------------|
| **NO DOUBLE-CLICK** | `history_table` has no `on_double_click`. Can't view the full message text, resend, or delete a message from history. |
| **MISSING CTA** | No "Resend" or "Delete" actions on history items. |

---

## 7. Marketing Tab (`marketing.py`)

**Purpose:** Newsletter, blog, social media, testimonials.

### Sub-tab: Newsletter

| # | Element | Type | Interactive? | Action | Issue |
|---|---------|------|-------------|--------|-------|
| 1 | Subject line | `CTkEntry` | ✅ Type | Edit subject | OK |
| 2 | Target audience | `CTkOptionMenu` | ✅ Select | All/Active/Subscribers | OK |
| 3 | Template picker | `CTkOptionMenu` | ✅ Select | HTML template selection | OK |
| 4 | Body editor | `CTkTextbox` | ✅ Type | Edit newsletter body | OK |
| 5 | 🤖 AI Generate | `CTkButton` | ✅ Click | Uses LLM to generate content | OK |
| 6 | Preview | `CTkButton` | ✅ Click | Preview newsletter | OK |
| 7 | 📤 Send Newsletter | `CTkButton` | ✅ Click | Sends via email engine | OK |
| 8 | Send history | Labels | ❌ Read-only | Shows past sends | **MISSING CTA** — no resend/view/delete on history |

### Sub-tab: Blog

| # | Element | Type | Interactive? | Action | Issue |
|---|---------|------|-------------|--------|-------|
| 1 | ＋ New Blog Post | `CTkButton` | ✅ Click | Opens blog editor | OK |
| 2 | 🤖 AI Generate | `CTkButton` | ✅ Click | AI blog generation | OK |
| 3 | 🔄 Sync from Website | `CTkButton` | ✅ Click | Pulls posts from website | OK |
| 4 | 📧 Run Email Lifecycle | `CTkButton` | ✅ Click | Triggers email lifecycle agent | OK |
| 5 | Blog post cards | Custom cards | ✅ Buttons | Edit / Publish / Share / Delete per post | OK ✅ |

### Sub-tab: Social Media

| # | Element | Type | Interactive? | Action | Issue |
|---|---------|------|-------------|--------|-------|
| 1 | Platform checkboxes | `CTkCheckBox` ×N | ✅ Check | Select platforms | OK |
| 2 | Content text area | `CTkTextbox` | ✅ Type | Compose post | OK |
| 3 | Hashtag shortcuts | `CTkButton` ×N | ✅ Click | Insert hashtag | OK |
| 4 | 🤖 AI Content Ideas | `CTkButton` | ✅ Click | Generates content ideas | OK |
| 5 | 📱 Post to Telegram | `CTkButton` | ✅ Click | Posts to Telegram channel | OK |
| 6 | 💾 Save Draft | `CTkButton` | ✅ Click | Saves draft post | OK |
| 7 | 📋 Copy | `CTkButton` | ✅ Click | Copies to clipboard | OK |
| 8 | Post history | Labels | ❌ Read-only | Shows past posts | OK |

### Sub-tab: Testimonials

| # | Element | Type | Interactive? | Action | Issue |
|---|---------|------|-------------|--------|-------|
| 1 | 🔄 Pull from Website | `CTkButton` | ✅ Click | Syncs testimonials from website | OK |
| 2 | Testimonials DataTable | `DataTable` | ❌ **No double-click** | Shows testimonials — cannot click to view/edit/delete | **NO DOUBLE-CLICK** |

### Issues
| Code | Description |
|------|-------------|
| **NO DOUBLE-CLICK** | `testimonials_table` has no `on_double_click`. Testimonials are completely read-only. |
| **MISSING CTA** | No "＋ Add Testimonial" button — testimonials can only come from the website pull. |
| **MISSING CTA** | No edit/delete capability for individual testimonials. |
| **DEFENSIVE BUG** | Line 356: `self._nl_audience.get()` is wrapped in `hasattr(self, '_nl_audience')` — this means the widget was never defined, so it always falls through to the `"all"` default. The actual widget is `self._nl_target`. The newsletter AI generation never uses the user's audience selection. |
| **SILENT ERROR** | Line 770: `except Exception: pass` — swallows blog sync failures. |

---

## 8. Customer Care Tab (`customer_care.py`)

**Purpose:** Complaints management and email tracking.

### Sub-tab: Complaints

| # | Element | Type | Interactive? | Action | Issue |
|---|---------|------|-------------|--------|-------|
| 1 | KPI: Open | `KPICard` | ❌ Read-only | Display | OK |
| 2 | KPI: In Progress | `KPICard` | ❌ Read-only | Display | OK |
| 3 | KPI: Resolved | `KPICard` | ❌ Read-only | Display | OK |
| 4 | KPI: Avg Resolution | `KPICard` | ❌ Read-only | Display | OK |
| 5 | Status filter | `CTkOptionMenu` | ✅ Select | Filters complaints | OK |
| 6 | Severity filter | `CTkOptionMenu` | ✅ Select | Filters by severity | OK |
| 7 | ＋ New Complaint | `CTkButton` | ✅ Click | Opens complaint form | OK |
| 8 | Complaints DataTable | `DataTable` | ✅ Double-click | `on_double_click=self._open_complaint` → opens complaint detail | OK ✅ |

### Sub-tab: Email Tracking

| # | Element | Type | Interactive? | Action | Issue |
|---|---------|------|-------------|--------|-------|
| 1 | KPI: Sent Today | `KPICard` | ❌ Read-only | Display | OK |
| 2 | KPI: Opened | `KPICard` | ❌ Read-only | Display | OK |
| 3 | KPI: Failed | `KPICard` | ❌ Read-only | Display | OK |
| 4 | Pipeline overview | Labels | ❌ Read-only | Enquiry→Quote→Book pipeline | OK |
| 5 | Type filter | `CTkOptionMenu` | ✅ Select | Filters email log | OK |
| 6 | ＋ Log Email | `CTkButton` | ✅ Click | Opens email log form | OK |
| 7 | Email tracking DataTable | `DataTable` | ❌ **No double-click** | Shows email records — cannot click to view details | **NO DOUBLE-CLICK** |

### Sub-tab: Newsletter History

| # | Element | Type | Interactive? | Action | Issue |
|---|---------|------|-------------|--------|-------|
| 1 | Newsletter send records | Labels | ❌ Read-only | Shows subject/date/sent count | **READ-ONLY** — no resend or view body |

### Issues
| Code | Description |
|------|-------------|
| **NO DOUBLE-CLICK** | `email_tracking_table` has no `on_double_click`. Users can see email subject/recipient but can't click to view the full email or take actions (resend, mark read, delete). |
| **MISSING CTA** | No delete action for email log entries. |

---

## 9. Admin Tab (`admin.py`)

**Purpose:** Careers, shop, agents, strategy, milestones, settings — the largest file (1636 lines).

### Sub-tab: Careers

| # | Element | Type | Interactive? | Action | Issue |
|---|---------|------|-------------|--------|-------|
| 1 | ＋ New Vacancy | `CTkButton` | ✅ Click | Opens vacancy form modal | OK |
| 2 | Vacancies DataTable | `DataTable` | ✅ Double-click | `on_double_click=self._open_vacancy` → opens vacancy editor | OK ✅ |
| 3 | Applications DataTable | `DataTable` | ✅ Double-click | `on_double_click=self._open_application` → opens application viewer | OK ✅ |

### Sub-tab: Shop

| # | Element | Type | Interactive? | Action | Issue |
|---|---------|------|-------------|--------|-------|
| 1 | ＋ New Product | `CTkButton` | ✅ Click | Opens product form modal | OK |
| 2 | Products DataTable | `DataTable` | ✅ Double-click | `on_double_click=self._open_product` → opens product editor | OK ✅ |
| 3 | Orders DataTable | `DataTable` | ✅ Double-click | `on_double_click=self._open_order` → opens order detail | OK ✅ |

### Sub-tab: Agents

| # | Element | Type | Interactive? | Action | Issue |
|---|---------|------|-------------|--------|-------|
| 1 | Agent cards | Custom cards | ✅ Buttons | Run Now / Pause / Edit per agent | OK |
| 2 | ＋ New Agent | `CTkButton` | ✅ Click | Opens agent config form | OK |
| 3 | Run history rows | Custom rows | ✅ View button | Opens run output detail | OK |

### Sub-tab: Strategy

| # | Element | Type | Interactive? | Action | Issue |
|---|---------|------|-------------|--------|-------|
| 1 | Business plan summary | Labels | ❌ Read-only | Shows plan text | OK |
| 2 | AI Recommendations | Cards | ✅ Partial | Accept / Dismiss / Implement buttons per rec | OK |
| 3 | Pricing config view | Labels | ❌ Read-only | Shows pricing tiers | **READ-ONLY** — should be editable |
| 4 | Run Analysis | `CTkButton` | ✅ Click | Triggers AI business analysis | OK |

### Sub-tab: Milestones

| # | Element | Type | Interactive? | Action | Issue |
|---|---------|------|-------------|--------|-------|
| 1 | Milestone progress cards | Cards | ❌ Read-only | Shows completion %, icon, description | **READ-ONLY** |

### Sub-tab: Settings

| # | Element | Type | Interactive? | Action | Issue |
|---|---------|------|-------------|--------|-------|
| 1 | App Version | Label | ❌ Read-only | Display | OK |
| 2 | Database path | Label | ❌ Read-only | Display | OK |
| 3 | Last sync time | Label | ❌ Read-only | Display | OK |
| 4 | Business name | Label | ❌ Read-only | Display | **READ-ONLY** — should be editable |
| 5 | Tax rate | Label | ❌ Read-only | Display | **READ-ONLY** — should be editable |
| 6 | Fund percentages | Labels | ❌ Read-only | Display | **READ-ONLY** — should be editable |
| 7 | Force Full Sync | `CTkButton` | ✅ Click | Triggers `sync.force_sync()` | OK |
| 8 | Backup Database | `CTkButton` | ✅ Click | Calls `db.backup()` | OK |

### Issues
| Code | Description |
|------|-------------|
| **READ-ONLY** | Settings constants (tax rate, fund splits, business name) are Labels, not Entries. Users cannot edit business configuration from the UI. |
| **READ-ONLY** | Milestones are static cards. No add/edit/mark-complete/delete actions. |
| **READ-ONLY** | Pricing config shows tiers but can't be edited. |
| **SILENT ERRORS** | Multiple `except Exception: pass` blocks (lines 296, 652, 657, 916, 1041, 1046, 1051) — swallow errors in agent runs, strategy analysis, and shop operations. |
| **MISSING CTA** | No "Delete Vacancy" or "Delete Application" available from the modal — only Save. |

---

## 10. Component Audit

### DataTable (`data_table.py`)

| Feature | Status |
|---------|--------|
| Column sorting (click header) | ✅ Working |
| Search/filter (text entry) | ✅ Working |
| CSV export | ✅ Working — **but `except Exception as e: pass` swallows export errors silently** |
| Row selection callback (`on_select`) | ✅ Wired |
| Row double-click callback (`on_double_click`) | ✅ Wired **when provided** — 4 DataTables omit it |
| Column resizing | ❌ Not implemented |
| Multi-select | ❌ Not implemented |
| Inline editing | ❌ Not implemented |
| Pagination | ❌ Not implemented (all rows loaded at once) |

### ClientModal (`client_modal.py`)

| Feature | Status |
|---------|--------|
| All fields editable | ✅ |
| Save → DB + Sheets sync | ✅ |
| Delete (existing records) | ✅ |
| Quick Action: Call | ✅ Opens tel: link |
| Quick Action: Email | ✅ Opens mailto: link |
| Quick Action: Map | ✅ Opens Google Maps |
| Quick Action: Photos | ✅ Opens PhotoManager |
| Quick Action: Invoice | ✅ Opens InvoiceModal |
| Validation | ⚠️ Minimal — no required field checks |

### EnquiryModal (`enquiry_modal.py`)

| Feature | Status |
|---------|--------|
| All fields editable | ✅ |
| Save → DB | ✅ |
| Delete | ✅ |
| Mark Replied | ✅ |
| Send Reply Email | ✅ Via email engine |
| Convert to Quote | ✅ Creates QuoteModal |
| Convert to Client | ✅ Creates ClientModal |
| Validation | ⚠️ Minimal |

### InvoiceModal (`invoice_modal.py`)

| Feature | Status |
|---------|--------|
| All fields editable | ✅ |
| Save → DB + Sheets sync | ✅ |
| Delete | ✅ |
| Mark Paid | ✅ |
| Validation | ⚠️ Minimal |

### QuoteModal (`quote_modal.py`)

| Feature | Status |
|---------|--------|
| All fields editable | ✅ |
| Save → DB + Sheets sync | ✅ |
| Delete | ✅ |
| Accept | ✅ Sets status=accepted |
| Decline | ✅ Sets status=declined |
| Validation | ⚠️ Minimal |

### CostModal (`cost_modal.py`)

| Feature | Status |
|---------|--------|
| All cost fields editable | ✅ |
| Month field editable | ✅ |
| Notes editable | ✅ |
| Save → DB + Sheets sync | ✅ |
| Cancel | ✅ |
| Delete | ❌ **Not implemented** — no way to delete a cost entry |

### PotModal (`pot_modal.py`)

| Feature | Status |
|---------|--------|
| Name/Balance/Target editable | ✅ |
| Save → DB + Sheets sync | ✅ |
| Cancel | ✅ |
| Delete | ❌ **Not implemented** — no way to delete a savings pot |

### BookingCalendar (`booking_calendar.py`)

| Feature | Status |
|---------|--------|
| Month navigation | ✅ |
| Day click → show bookings | ✅ |
| Booking count dots | ✅ |
| Booking card click → callback | ✅ |
| Add booking from calendar | ❌ Not implemented |

### BookingDetailCard (`booking_detail_card.py`)

| Feature | Status |
|---------|--------|
| Display booking info | ✅ |
| Map button | ✅ Opens Google Maps |
| Call button | ✅ Opens tel: |
| Photos button | ✅ Opens PhotoManager |
| Edit Client button | ✅ Opens ClientModal |
| Travel info (distance/time) | ✅ Background fetch |
| Silent error | ⚠️ `except Exception: pass` in `_show_travel_info` |

### DayPlanner (`day_planner.py`)

| Feature | Status |
|---------|--------|
| Date entry + Plan Route | ✅ |
| KPI cards (miles, time, jobs) | ✅ Display |
| Route timeline with travel segments | ✅ |
| Job cards double-click | ✅ When `on_job_click` provided |
| Open in Maps | ✅ Opens Google Maps route URL |
| Warning display | ✅ Shows missing postcodes etc |

### ChartPanel (`chart_panel.py`)

| Feature | Status |
|---------|--------|
| Bar chart | ✅ |
| Pie chart | ✅ |
| Line chart | ✅ |
| Click interaction | ❌ None — display only by design |
| Graceful fallback (no matplotlib) | ✅ Shows "Charts require matplotlib" |

### PhotoManager (`photo_manager.py`)

| Feature | Status |
|---------|--------|
| Add Before photo | ✅ File dialog → resize → save |
| Add After photo | ✅ File dialog → resize → save |
| Thumbnail gallery | ✅ Before/After columns |
| Click thumbnail to open full | ✅ Local photos |
| Delete photo | ✅ Per-photo 🗑️ button |
| Drive photo display | ✅ Cached thumbnails |
| Drive photo click → browser | ✅ |
| Graceful fallback (no PIL) | ✅ Shows filename text |

### Toast (`toast.py`)

| Feature | Status |
|---------|--------|
| Show notification | ✅ |
| Auto-dismiss | ✅ Configurable duration |
| Severity levels (info/success/warning/error) | ✅ |
| Stack multiple toasts | ✅ Offset positioning |

---

## 11. Cross-Cutting Issues

### 🔴 Critical: Read-Only DataTables

These 4 DataTables pull data from Google Sheets/SQLite but offer **zero interactivity**:

| Table | Tab | What user sees | What they can do |
|-------|-----|----------------|------------------|
| `payments_table` | Finance > Payments | Payment method, amount, date, invoice | **Nothing** — can't view, edit, or link to invoice |
| `history_table` | Telegram > History | Sent messages with timestamps | **Nothing** — can't view full text, resend, or delete |
| `email_tracking_table` | Customer Care > Emails | Email subject, recipient, status | **Nothing** — can't view body, resend, or delete |
| `testimonials_table` | Marketing > Testimonials | Customer name, text, rating | **Nothing** — can't view full text, edit, or delete |

### 🔴 Critical: Unclickable Job Displays

| Location | Data shown | What works | What's missing |
|----------|-----------|------------|----------------|
| Overview > Today's Jobs | Name, service, time, postcode | ✓ Complete button | **Double-click to open ClientModal** |
| Dispatch > Job Cards | Name, service, time, postcode, price | ✓ Complete, 📱 On Way, 📸 Photos | **Click/double-click card body to open ClientModal** |

### 🟡 Warning: Silent Error Swallowing

| File | Line(s) | Pattern | Risk |
|------|---------|---------|------|
| `overview.py` | 624 | `except Exception: pass` | Analytics failures invisible |
| `data_table.py` | CSV export | `except Exception as e: pass` | Export failures invisible |
| `admin.py` | 296, 652, 657, 916, 1041, 1046, 1051 | `except Exception: pass` ×7 | Agent/shop/strategy errors invisible |
| `marketing.py` | 770 | `except Exception: pass` | Blog sync failures invisible |
| `booking_detail_card.py` | 312 | `except Exception: pass` | Travel info failures invisible |
| `booking_calendar.py` | 141, 285 | `except Exception: pass` | Calendar rendering errors invisible |
| `photo_manager.py` | 315, 360, 480 | `except Exception: pass` | Photo operations invisible |

**Recommendation:** Replace all `except Exception: pass` with `except Exception as e: log.warning(...)` at minimum, or show a toast notification.

### 🟡 Warning: Missing Delete Buttons

| Modal | Has Save | Has Delete | Impact |
|-------|----------|------------|--------|
| ClientModal | ✅ | ✅ | OK |
| EnquiryModal | ✅ | ✅ | OK |
| InvoiceModal | ✅ | ✅ | OK |
| QuoteModal | ✅ | ✅ | OK |
| CostModal | ✅ | ❌ | Can't delete a cost entry |
| PotModal | ✅ | ❌ | Can't delete a savings pot |
| Vacancy form | ✅ | ❌ | Can't delete a vacancy from modal |
| Application viewer | ✅ | ❌ | Can't delete an application |
| Product form | ✅ | ❌ | Can't delete a product from modal |
| Order detail | ✅ | ❌ | Can't delete an order |
| Complaint form | ✅ | ❌ | Can't delete a complaint from modal |

### 🟡 Warning: Missing Validation

No modal performs required-field validation before saving. Empty records can be created for:
- Clients (nameless client)
- Invoices (no client, no amount)
- Quotes (no client, no amount)
- Enquiries (no name, no message)
- Complaints (no description)
- Vacancies (no title)
- Products (no name, no price)

### 🟢 Note: Defensive Bug

In `marketing.py` line 356:
```python
audience = self._nl_audience.get().lower() if hasattr(self, '_nl_audience') else "all"
```
`self._nl_audience` is never defined. The actual audience widget is `self._nl_target`. This means AI-generated newsletter content **always** uses `"all"` as the audience, ignoring the user's selection.

---

## 12. Priority Fix List

### P0 — Critical (data visible but untouchable)

| # | Fix | Files | Effort |
|---|-----|-------|--------|
| 1 | Add `on_double_click` to `payments_table` → open payment detail or linked InvoiceModal | `finance.py` | Small |
| 2 | Add `on_double_click` to `testimonials_table` → open testimonial view/edit | `marketing.py` | Small |
| 3 | Add `on_double_click` to `email_tracking_table` → open email detail | `customer_care.py` | Small |
| 4 | Add `on_double_click` to `history_table` → open message detail | `telegram.py` | Small |
| 5 | Add click handler to Overview job rows → open ClientModal | `overview.py` | Small |
| 6 | Add click handler to Dispatch job cards → open ClientModal | `dispatch.py` | Small |

### P1 — High (missing expected functionality)

| # | Fix | Files | Effort |
|---|-----|-------|--------|
| 7 | Add Delete buttons to CostModal and PotModal | `cost_modal.py`, `pot_modal.py` | Small |
| 8 | Make Settings editable (tax rate, fund %, business name) | `admin.py` | Medium |
| 9 | Add "＋ Add Testimonial" button + testimonial edit modal | `marketing.py` | Medium |
| 10 | Fix `_nl_audience` bug → use `self._nl_target.get()` | `marketing.py` line 356 | Trivial |
| 11 | Add Delete buttons to vacancy/application/product/order/complaint modals | `admin.py` | Medium |

### P2 — Medium (quality & reliability)

| # | Fix | Files | Effort |
|---|-----|-------|--------|
| 12 | Replace all `except Exception: pass` with proper logging | All files | Medium |
| 13 | Add required-field validation to all modals (at minimum: name fields) | All modal files | Medium |
| 14 | Make Overview alerts clickable → navigate to relevant tab | `overview.py` | Medium |
| 15 | Add "Add booking" from calendar day click | `booking_calendar.py` | Medium |

### P3 — Low (nice-to-have)

| # | Fix | Files | Effort |
|---|-----|-------|--------|
| 16 | Add milestones CRUD (add/edit/mark complete/delete) | `admin.py` | Large |
| 17 | Add pricing config editing in Strategy tab | `admin.py` | Medium |
| 18 | Add Resend/Delete actions on Telegram history | `telegram.py` | Small |
| 19 | Add Resend/View actions on Newsletter history | `marketing.py` | Small |
| 20 | DataTable pagination for large datasets | `data_table.py` | Medium |

---

*End of Audit*
