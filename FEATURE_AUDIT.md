# GGM Hub vs HTML Dashboard — Feature Audit

> **Goal:** Make the HTML version redundant by ensuring the desktop Hub replicates all features.
> **Audit Date:** Generated from current codebase analysis.

---

## 1. HTML Features — Complete Inventory

### 1A. Manager Dashboard (`manager.html` + `manager.js`)

| # | Feature | Category |
|---|---------|----------|
| M1 | Live clock in header | UI Chrome |
| M2 | 6-tab layout: Overview, Operations, Finance, Marketing, Customer Care, Admin | Navigation |
| M3 | Data caching with TTL from Google Sheets API | Data Layer |
| M4 | Keyboard shortcuts: Escape (close modal), Ctrl+F (search) | UX |

**Overview Tab:**
| # | Feature |
|---|---------|
| M5 | KPI strip: Today/Week/Month/YTD revenue, Subscribers count, Outstanding amount |
| M6 | Today's Jobs list with clickable job cards |
| M7 | Alerts & Actions panel (unpaid invoices, pending enquiries) |
| M8 | Quick Actions: New Booking, Create Invoice, Refresh Finance, Blog Editor link |
| M9 | Recent Activity feed (last 10 records) |

**Operations Tab:**
| # | Feature |
|---|---------|
| M10 | All Clients sub-tab — full CRM with search, type/status/paid filter dropdowns |
| M11 | Client cards with inline stats bar |
| M12 | XLSX Excel export of filtered clients (SheetJS multi-sheet: master + per-day) |
| M13 | Today's Schedule sub-tab with Open-Meteo weather forecast |
| M14 | Subscriptions sub-tab — table with "Generate Schedule" button |
| M15 | Quotes sub-tab — table view |
| M16 | Client Detail Modal: full edit form (name, email, phone, postcode, address, service, price, date, time, preferred day, type, status, paid, notes) |
| M17 | Client actions: Save, Invoice (opens invoice.html pre-filled), Call (tel: link), Email (mailto: link), Map (Google Maps), Reschedule (with time prompt + alternatives), Cancel (with Stripe sub cancellation) |
| M18 | Day Planner: Day-of-week tabs, route optimization by distance, multi-stop Google Maps link, summary stats (jobs, miles, drive time) |

**Finance Tab:**
| # | Feature |
|---|---------|
| M19 | Dashboard sub-tab KPIs: Revenue YTD, Costs YTD, Profit YTD, Margin %, Safe Pay |
| M20 | Bank allocation breakdown (5 funds with progress bars) |
| M21 | Revenue by service chart |
| M22 | Invoices sub-tab — table with "Create New" link |
| M23 | Business Costs sub-tab — table with category/frequency |
| M24 | Savings Pots sub-tab — progress bars toward targets |

**Marketing Tab:**
| # | Feature |
|---|---------|
| M25 | Social Media sub-tab — compose post with platform selection (Facebook, Instagram, X) |
| M26 | Post type picker (update, promotion, seasonal, contest, before-after) |
| M27 | AI-powered "Generate Post" with platform-specific formatting |
| M28 | Post publishing + recent posts log |
| M29 | Blog sub-tab — table listing blog posts with editor link |
| M30 | Newsletter sub-tab — subscriber stats & subscriber list |
| M31 | Testimonials sub-tab — star ratings display |

**Customer Care Tab:**
| # | Feature |
|---|---------|
| M32 | Enquiries sub-tab — contact & bespoke enquiries table |
| M33 | Complaints sub-tab — table with status management |
| M34 | Email Tracking sub-tab — workflow stages table |

**Admin Tab:**
| # | Feature |
|---|---------|
| M35 | Careers sub-tab — vacancies & applications tables |
| M36 | Shop & Products sub-tab — orders & products tables |
| M37 | Settings sub-tab — pricing config + quick links to other pages |

---

### 1B. Admin Dashboard (`admin.html` + JS files)

| # | Feature | Category |
|---|---------|----------|
| A1 | 8 stats cards: Total Clients, Subscribers, One-off, Paid, Unpaid, Revenue, Outstanding, Avg Distance | Dashboard |
| A2 | 11 tab panels: Overview, Subscriptions, Payments, Newsletter, Telegram, Email Workflow, Quote Builder, Shop, Finance, Careers, Complaints | Navigation |
| A3 | Hash-based deep linking (#payments, #telegram, #newsletter etc.) | UX |

**Subscriptions Panel:**
| # | Feature |
|---|---------|
| A4 | Active subscribers table (client, package, day, freq, services, location, distance, price, status) |
| A5 | Auto-Generate Schedule button |
| A6 | Send Week to Telegram button |
| A7 | Schedule range selector + upcoming visits timeline |

**Payments Panel:**
| # | Feature |
|---|---------|
| A8 | Full payments table (Job#, Client, Service, Type, Amount, Status, Method {Stripe/Cash/Bank}, Date) |

**Newsletter Panel:**
| # | Feature |
|---|---------|
| A9 | Compose form: subject, HTML content, exclusive paid-sub content, target audience selector |
| A10 | Header image with auto-fetch from API |
| A11 | Preview modal (full HTML email render preview) |
| A12 | Send button with target count confirmation |
| A13 | Template quick-insert buttons (Seasonal Tips, Promotion, Company Update, Garden Guide) |
| A14 | Subscriber stats grid (active, paid, free, unsubscribed, tier breakdown) |
| A15 | Sent newsletter history log |
| A16 | Full subscriber list with tier badges |

**Telegram Panel:**
| # | Feature |
|---|---------|
| A17 | Message send form (free-text) |
| A18 | Quick message buttons (On My Way, Arrived, Completed, Reminder, Payment, Weather) |
| A19 | Message log / history |
| A20 | Bot status info + auto-notification status |

**Email Workflow Panel:**
| # | Feature |
|---|---------|
| A21 | Email stats cards (today/week/month/terms accepted) |
| A22 | Terms acceptance breakdown (Pay Now / Pay Later / Subscription) |
| A23 | Live income vs expenditure dashboard |
| A24 | Recent automated emails table |

**Quote Builder Panel:**
| # | Feature |
|---|---------|
| A25 | Quote stats row (Total, Sent, Accepted, Declined, Pipeline Value) |
| A26 | New Quote button + filter/search + quotes table |
| A27 | Full modal: customer details (link existing client or new entry) |
| A28 | Quote details: title, estimated duration (days/hours), complexity, validity period |
| A29 | 7 categorized line items: Services / Labour / Materials / Equipment / Traffic Management / Waste / Custom |
| A30 | Dozens of preset template buttons with prices per category |
| A31 | Per-item qty, unit (job/each/hour/day/m²/linear m/panel/bag/roll/kg/litre/load/trip), price |
| A32 | Surcharges & adjustments: call-out charge, distance surcharge, urgent/out-of-hours % |
| A33 | Totals: subtotal, surcharges, discount %, VAT 20%, grand total, 10% deposit |
| A34 | Notes & scope of work text area |
| A35 | Actions: Duplicate quote, Save Draft, Send Quote (emails customer) |
| A36 | Resend quote button on table rows |

**Shop Panel:**
| # | Feature |
|---|---------|
| A37 | Product CRUD: name, category, price (in pence), stock, description, image URL, status (active/draft/sold-out) |
| A38 | Products table with inline edit/delete buttons |
| A39 | Orders table with order status management (Processing/Ready/Shipped/Delivered/Cancelled) |
| A40 | Order status update emails customer automatically |

**Finance Panel:**
| # | Feature |
|---|---------|
| A41 | Period selector (monthly/weekly) |
| A42 | Smart Trigger Alerts (VAT threshold, profit margin, savings pot warnings) |
| A43 | 5 Bank Account Allocation cards with purposes & recommended direct debits |
| A44 | Full Money Breakdown table |
| A45 | Allocation Configuration — editable % fields (tax/NI/emergency/equipment/float) |
| A46 | Direct Debits checklist |
| A47 | 12 Growth Milestones & Investment Triggers (Basic Tools £0 → VAT Registration £85k) |

**Careers Panel:**
| # | Feature |
|---|---------|
| A48 | Post vacancy form (title, type, location, salary, description, requirements, closing date, status) |
| A49 | Active vacancies list with edit/delete |
| A50 | Applications list with filters (position/status) |
| A51 | Application detail modal: full info (name, email, phone, postcode, DOB, available from, preferred hours, driving licence, own transport, experience, qualifications, cover message) |
| A52 | Application status management (New/Reviewed/Shortlisted/Interview/Offered/Rejected) |
| A53 | CV download from Google Drive |
| A54 | Email/Call applicant buttons |
| A55 | Admin notes per application |

**Complaints Panel:**
| # | Feature |
|---|---------|
| A56 | Stats row: Total/Open/Investigating/Resolved/Closed |
| A57 | Filters: status/type/severity/search |
| A58 | Complaint cards with severity/status/type badges |
| A59 | Complaint detail modal: full customer info, photos/evidence, resolution display |
| A60 | Resolution system: subscriber resolution (discount tiers / free visit / credit / apology) vs one-off resolution (refund % tiers / free redo / apology) |
| A61 | Auto-email customer with resolution details (opt-in checkbox) |
| A62 | Admin notes per complaint with save |
| A63 | Status update actions (Open → Investigating → Resolved → Closed) |

---

### 1C. Daily Dispatch (`today.html` + `today.js`)

| # | Feature |
|---|---------|
| D1 | Date navigation (prev/next/today buttons) |
| D2 | Day summary bar: Job Count, Total Work Hours, Total Miles, Revenue, Fuel Cost, Net Profit |
| D3 | Fund Allocation bar: Tax Reserve 20%, NI 6%, Fuel (dynamic), Materials (dynamic), Overheads 10%, Emergency 5%, Take-Home Pay (remainder) |
| D4 | Job Cards: numbered, name, job ref, service, time slot + end time calc, duration, distance, address, notes |
| D5 | Phone link + Navigate button (Google Maps) per job |
| D6 | Complete Job button per card → multi-step: mark complete, send Telegram, send thank-you email with review request, update state, re-render |
| D7 | Telegram Morning Briefing: formatted message with all jobs + directions + revenue total |
| D8 | Service duration/material cost constants for all service types |
| D9 | Weather / empty day state handling |
| D10 | Paid/Unpaid badges per job card |

---

### 1D. Shared Navigation (`admin-nav.js`)

| # | Feature |
|---|---------|
| N1 | Collapsible sidebar with 12 nav items across all admin pages |
| N2 | Sidebar state persistence in localStorage |
| N3 | Mobile responsive with overlay |
| N4 | Keyboard shortcut: Escape closes sidebar |

---

## 2. GGM Hub Desktop App — Current Capabilities

### 2A. App Shell (`app_window.py`)

| Feature | Status |
|---------|--------|
| 3-tab sidebar: Overview, Operations, Finance | ✅ |
| Top bar with search + sync indicator + date | ✅ |
| Status bar (last sync time + client count) | ✅ |
| Force Sync button | ✅ |
| Global search → routes to Operations clients table | ✅ |
| Toast notification system | ✅ |
| Sync event polling (500ms) with live UI updates | ✅ |
| Lazy tab creation | ✅ |

### 2B. Overview Tab (`overview.py`)

| Feature | Status |
|---------|--------|
| 6 KPI cards (Today/Week/Month/YTD/Subs/Outstanding) | ✅ |
| Today's Jobs panel with clickable rows → ClientModal | ✅ |
| Mark Complete button per job (updates SQLite, queues sync, sends Telegram) | ✅ |
| Alerts panel (unpaid invoices, pending enquiries) | ✅ |
| Revenue bar chart (last 14 days) | ✅ |
| Quick Actions: Morning Briefing (Telegram), Generate Schedule, Force Sync | ✅ |

### 2C. Operations Tab (`operations.py`)

| Feature | Status |
|---------|--------|
| 7 sub-tabs: All Clients, Calendar, Today, Route Planner, Subscriptions, Quotes, Enquiries | ✅ |
| All Clients DataTable with status + paid filter dropdowns | ✅ |
| Add Client button → ClientModal | ✅ |
| Double-click row → ClientModal (view/edit) | ✅ |
| Calendar with BookingCalendar + BookingDetailCard | ✅ |
| Today's Schedule table | ✅ |
| Route Planner (DayPlanner) — date selector, route optimization, Google Maps link, KPI summary | ✅ |
| Subscriptions table with total monthly revenue | ✅ |
| Quotes table with status filter + QuoteModal (create/edit) | ✅ |
| Enquiries table with status filter + EnquiryModal (create/edit) | ✅ |
| Search results display in clients table | ✅ |

### 2D. Finance Tab (`finance.py`)

| Feature | Status |
|---------|--------|
| 4 sub-tabs: Dashboard, Invoices, Costs, Savings Pots | ✅ |
| Dashboard KPIs: Gross Revenue YTD, Costs YTD, Net Profit, Avg Monthly, Sub Revenue | ✅ |
| Revenue by service pie chart | ✅ |
| Monthly revenue bar chart (last 30 days) | ✅ |
| Fund allocation with progress bars | ✅ |
| Invoices table with status filter + InvoiceModal (create/edit) | ✅ |
| Business Costs by month (header + data rows + grand total) with edit per row | ✅ |
| Add month / edit cost modal (CostModal) | ✅ |
| Savings Pots with balance, target, progress bars, icons | ✅ |
| Add pot / edit pot modal (PotModal) | ✅ |

### 2E. UI Components

| Component | Status |
|-----------|--------|
| ClientModal — full edit form (14 fields + notes), Save, Create Invoice, Photos, View Map | ✅ |
| QuoteModal — view/edit with client details, totals, status | ✅ |
| InvoiceModal — create/edit with client, amount, status, dates | ✅ |
| EnquiryModal — create/edit with status, replied flag | ✅ |
| DayPlanner — route optimization, travel gaps, multi-stop Maps, KPI cards | ✅ |
| BookingCalendar — calendar view of bookings | ✅ |
| BookingDetailCard — booking click → detail view → ClientModal | ✅ |
| DataTable — reusable sortable table with double-click | ✅ |
| ChartPanel — bar/pie charts | ✅ |
| KpiCard — value card with color support | ✅ |
| PhotoManager — client photo management | ✅ |
| ToastManager — notification toasts | ✅ |
| CostModal — cost entry editing | ✅ |
| PotModal — savings pot editing | ✅ |

---

## 3. GAP LIST — Missing from Hub

### 🔴 CRITICAL — Core business operations not possible without these

| # | Gap | HTML Source | Why Critical |
|---|-----|------------|--------------|
| G1 | **Telegram Messaging Panel** — Send free-text messages, quick message buttons (On My Way/Arrived/Completed/Reminder/Payment/Weather), message log, bot status | A17–A20 | Daily field communication with customers. Currently only programmatic sends exist (job complete, briefing). |
| G2 | **Newsletter Compose & Send** — Full compose form with subject, HTML content, exclusive paid content, target audience, header image, template quick-inserts, preview modal, send with confirmation | A9–A16, M30 | Primary marketing/retention channel. No way to send newsletters from Hub. |
| G3 | **Payments Table** — Full payments ledger with method badges (Stripe/Cash/Bank), filterable | A8 | No visibility into payment records from Hub. |
| G4 | **Daily Dispatch View** — Date navigation (prev/next/today), day summary bar (hours/miles/revenue/fuel/net profit), fund allocation bar, detailed job cards with end-time calc, Complete Job multi-step flow (mark complete → Telegram → thank-you email → re-render) | D1–D10 | The Hub has a basic schedule table but lacks the rich daily dispatch page. The "Today" sub-tab in Operations is a table, not the full Daily Dispatch experience. |
| G5 | **Quote Builder (Advanced)** — Full bespoke quote system with 7 item categories, dozens of template buttons with prices, surcharges (call-out/distance/urgent%), discount %, VAT 20%, deposit calc, send to customer email | A25–A36 | Hub has a basic QuoteModal but lacks the advanced categorized line-item builder, template buttons, and surcharge system. |

### 🟠 HIGH — Important features for full business management

| # | Gap | HTML Source | Why High |
|---|-----|------------|----------|
| G6 | **Complaints Management** — Stats, filters (status/type/severity/search), complaint detail modal, resolution system (subscriber discount tiers vs one-off refund %), auto-email customer, admin notes, status workflow | A56–A63, M33 | Customer service gap — no complaint tracking or resolution workflow. |
| G7 | **Careers Management** — Post vacancy form, vacancy list with edit/delete, applications list with filters, application detail modal (full applicant info, CV download, email/call, status management, notes) | A48–A55, M35 | HR management completely missing. |
| G8 | **Shop & Product Management** — Product CRUD (name/category/price/stock/desc/image/status), products table, orders table, order status updates with customer email | A37–A40, M36 | E-commerce management not in Hub. |
| G9 | **Email Workflow Tracking** — Email stats (today/week/month), terms acceptance breakdown (Pay Now/Pay Later/Subscription), live income vs expenditure, recent automated emails table | A21–A24, M34 | No visibility into automated email system performance. |
| G10 | **Social Media Composer** — Platform selection (FB/IG/X), post type picker, AI-powered "Generate Post", publish, recent posts log | M25–M28 | Marketing content creation not available in Hub. |
| G11 | **Subscription Schedule Management** — Auto-generate schedule, send week to Telegram, schedule range selector, upcoming visits timeline | A4–A7 | Hub shows subscription clients but can't manage the weekly schedule generation or Telegram digest. |
| G12 | **Client Reschedule Flow** — Date/time prompt with alternative suggestions | M17 (partial) | Hub has basic client edit but no guided reschedule UX. |
| G13 | **Client Cancel with Stripe** — Cancel subscription client with Stripe API cancellation | M17 (partial) | Hub can change status to Cancelled but doesn't trigger Stripe cancellation. |

### 🟡 MEDIUM — Nice-to-have features for completeness

| # | Gap | HTML Source | Why Medium |
|---|-----|------------|------------|
| G14 | **XLSX Excel Export** — Multi-sheet export (master + per-day sheets) using SheetJS | M12 | Useful for external reporting, but not daily-critical. |
| G15 | **Finance: Growth Milestones** — 12 milestone cards (Basic Tools £0 → VAT Registration £85k) with progress bars | A47 | Motivational/planning feature, not operational. |
| G16 | **Finance: Smart Trigger Alerts** — VAT threshold warning, profit margin check, savings pot check | A42 | Helpful but not blocking day-to-day ops. |
| G17 | **Finance: Bank Account Configuration** — 5 named bank accounts with purpose descriptions, recommended direct debits, editable allocation % | A43–A46 | Hub has fund allocation but not the full bank account + direct debit setup. |
| G18 | **Finance: Direct Debits Checklist** — Categorized checklist of all direct debits | A46 | Tracking tool, not operational. |
| G19 | **Blog Management** — Table listing blog posts with link to blog editor | M29 | Content management, usually done in browser anyway. |
| G20 | **Testimonials Display** — Star ratings from reviews | M31 | Read-only display, low priority. |
| G21 | **Weather Forecast on Schedule** — Open-Meteo API integration showing weather for the day | M13, D9 | Useful context but not essential. |
| G22 | **Recent Activity Feed** — Last 10 records chronological feed | M9 | Nice overview but alerts panel covers urgent items. |
| G23 | **Admin Stats Cards** — 8 top-level stats (Total Clients, Subscribers, One-off, Paid, Unpaid, Revenue, Outstanding, Avg Distance) | A1 | Hub already shows KPIs; this is a slightly different aggregation. |

### 🟢 LOW — Minor UX polish or features available via other means

| # | Gap | HTML Source | Why Low |
|---|-----|------------|---------|
| G24 | **Live Clock in Header** | M1 | Desktop OS already shows the time. |
| G25 | **Collapsible Sidebar** | N1–N4 | Hub sidebar is fixed; collapsibility is less needed in a desktop app with ample space. |
| G26 | **Hash-based Deep Linking** | A3 | Browser-specific; desktop app has sidebar nav. |
| G27 | **Settings Panel** — Pricing config, quick links | M37 | Can be handled via config file or a simple settings dialog. |
| G28 | **Keyboard Shortcut: Ctrl+F** | M4 | Hub already has a global search bar in the top bar. |
| G29 | **Client Phone Call (tel: link)** | M17 | Desktop app can open tel: links but less useful than on mobile. |
| G30 | **Newsletter Template Quick-Insert Buttons** | A13 | Part of G2 (Newsletter), broken out as a sub-feature. |

---

## 4. Priority Summary

| Priority | Count | Gaps |
|----------|-------|------|
| 🔴 Critical | 5 | G1–G5 |
| 🟠 High | 8 | G6–G13 |
| 🟡 Medium | 10 | G14–G23 |
| 🟢 Low | 7 | G24–G30 |
| **Total** | **30** | |

---

## 5. Recommended Implementation Order

### Phase 1 — Critical (makes Hub usable as primary tool)
1. **G4** Daily Dispatch view (new tab or Overview sub-view)
2. **G1** Telegram panel (new tab or Admin sub-tab)
3. **G5** Advanced Quote Builder (enhance existing QuoteModal)
4. **G3** Payments table (add to Finance tab sub-tabs)
5. **G2** Newsletter system (new tab or Marketing sub-tab)

### Phase 2 — High (full business management)
6. **G11** Subscription schedule management (enhance Operations > Subscriptions)
7. **G6** Complaints management (new sub-tab)
8. **G10** Social Media composer (new tab)
9. **G9** Email Workflow tracking (new sub-tab)
10. **G7** Careers management (new sub-tab)
11. **G8** Shop management (new sub-tab)
12. **G12** Client reschedule flow (enhance ClientModal)
13. **G13** Stripe cancellation (enhance ClientModal)

### Phase 3 — Medium & Low (parity & polish)
14. G14–G30 in order of user request

---

## 6. Hub Tabs Required for Full Parity

Current Hub tabs: **Overview | Operations | Finance** (3 tabs)

Recommended expanded sidebar:

```
📊 Overview
📅 Daily Dispatch          ← NEW (G4)
👥 Operations
💰 Finance
📱 Telegram                ← NEW (G1)
📣 Marketing               ← NEW (G2, G10, G19, G20)
🛡️ Customer Care           ← NEW (G6, G9)
💼 Admin                   ← NEW (G7, G8, G11)
⚙️ Settings                ← NEW (G27)
```

This gives 9 sidebar items (vs 3 today), matching the HTML's 6 manager tabs + admin dashboard scope.
