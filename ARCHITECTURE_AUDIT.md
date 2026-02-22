# GGM Hub — Architecture, Workflow & Accounting Integration Audit

**Agent 7 of 7 | Domain: System Architecture, Business Workflows, Accounting Integration Readiness**
**Audit Date:** 2026-02-22
**System Version:** Hub v4.8.0 | Field App v3.1.0 | Mobile v3.1.0
**Auditor Scope:** 3-node architecture, business workflows end-to-end, Xero readiness, data model, compliance, scalability

---

## Executive Summary

The GGM Hub is an impressively ambitious system for a sole-trader operation — a 3-node architecture with 33+ SQLite tables, 22,000 lines of Google Apps Script middleware, 15 AI agents, 4 Telegram bots, Stripe integration (18 webhook events), and Brevo email automation. The system is **operationally functional** but has **structural weaknesses that will block enterprise scaling, accounting integration, and multi-crew expansion**.

**Critical finding:** Google Apps Script as the sole middleware creates a hard ceiling on scalability and represents a single point of failure for the entire data layer. The financial data model lacks the fields and structure required for Xero integration or proper double-entry bookkeeping.

### Scores by Area

| Area | Score | Grade |
|------|-------|-------|
| **Architecture** | 62/100 | C+ |
| **Business Workflows** | 71/100 | B- |
| **Accounting / Xero Readiness** | 28/100 | F |
| **Data Model** | 55/100 | D+ |
| **Compliance** | 64/100 | C+ |
| **Scalability** | 40/100 | D |

---

## 1. Architecture Review

### 1.1 Three-Node Architecture Assessment

| Aspect | Finding | Risk |
|--------|---------|------|
| **PC Hub (Node 1)** | Main server running all background services, AI, email, sync. Desktop app. | **SPOF** — if the PC is off, all automation stops |
| **Laptop (Node 2)** | Developer workstation, pushes code via Git. Mirrors Hub functionality. | Low risk — laptop loss doesn't affect operations |
| **Mobile (Node 3)** | React Native field app via Expo. | Medium risk — depends entirely on GAS availability |

**Assessment:** The architecture is **clever for its constraints** (no direct networking between nodes) but fundamentally fragile. All three nodes depend on Google Apps Script being available, and the PC Hub is a single point of failure for all automation.

### 1.2 Single Points of Failure (SPOFs)

| SPOF | Impact | Severity | Mitigation Exists? |
|------|--------|----------|---------------------|
| **Google Apps Script** | ALL data reads/writes fail across ALL nodes | **CRITICAL** | Partial — Supabase client exists but is optional/incomplete |
| **PC Hub offline** | No email automation, no AI agents, no sync, no Telegram bots | **CRITICAL** | None — headless/cloud variant needed |
| **Google Sheets** | Primary data store. If sheet is corrupted/deleted, all data lost | **HIGH** | No automated backups of the spreadsheet |
| **Single GAS deployment URL** | If redeployment breaks the URL, all nodes lose connectivity simultaneously | **HIGH** | No versioned API or fallback endpoint |
| **GitHub (master branch)** | Forced push or corruption breaks auto-pull on PC Hub | **MEDIUM** | `git reset --hard` documented, but no branch protection |
| **Stripe webhook endpoint** | If GAS goes down, Stripe events are lost (no retry queue on Stripe side beyond 72h) | **MEDIUM** | Stripe retries for 72h, but events could be missed |

### 1.3 GitHub-Based Code Deployment

**Reliability: 7/10**

- Auto-pull every 15 minutes via `updater.py` is simple and effective
- `git reset --hard origin/master` on startup is a nuclear but reliable fallback
- **Risks:**
  - No branch protection — anyone with repo access can force-push to master
  - No CI/CD pipeline — syntax errors can be pushed and break the Hub
  - `auto_push.py` on PC pushes every 15 min — creates merge conflict risk with laptop
  - No automated testing before deployment
- **Recommendation:** Add a pre-push syntax check hook; protect master branch; add a `staging` branch for testing

### 1.4 GAS-as-Middleware Scalability

**Scalability: 4/10**

| GAS Limit | Value | Current Usage | Headroom |
|-----------|-------|---------------|----------|
| Execution time per call | 6 minutes | Most calls < 5 seconds | OK for now |
| Daily URL fetch calls | 20,000/day | Unknown — no monitoring | Unknown |
| Daily script runtime | 90 min/day (free) | Unknown | **Risk** if all agents + sync + webhooks run simultaneously |
| Simultaneous executions | 30 | Webhook handlers + polling = potentially 5-10 concurrent | OK for now |
| Spreadsheet read/write ops | 10M cells/day | 33+ tables being synced every 5 min | **At risk** with 500+ clients |
| Response payload size | 50MB | Large GET responses (get_clients, etc.) | Will hit limits at scale |

**Key concerns:**
- `doPost()` is a **1,400-line switch statement** with 60+ action routes — no modularisation
- `doGet()` is similarly monolithic with 50+ routes
- Google Sheets as a database has no indexing, no transactions, no concurrent write safety (beyond LockService)
- At 500+ clients with 19 sync tables, the 5-minute sync cycle will start hitting GAS execution time limits
- No rate limiting, no request queuing, no circuit breakers

### 1.5 Node Offline Behaviour

| Scenario | Behaviour | Data Loss Risk |
|----------|-----------|----------------|
| **PC Hub offline** | Mobile + Laptop can still read/write via GAS/Sheets. No emails sent, no AI agents, no sync to SQLite. | Low — data is in Sheets. High — automation stops. |
| **Laptop offline** | No code pushes. PC Hub and Mobile unaffected. | None |
| **Mobile offline** | Offline queue in React Native. Syncs when back online. | Low — if app crashes before sync, unsaved changes lost |
| **GAS down** | ALL nodes dead. No reads, no writes, no commands. | **CRITICAL** — complete system halt |
| **Google Sheets down** | Same as GAS down — all data inaccessible | **CRITICAL** |
| **Internet down (all)** | Hub can still access local SQLite for read-only. No writes sync. | Medium — SQLite has cached data |

---

## 2. Business Workflow Mapping

### 2.1 Complete Workflow: Enquiry → Payment

```
                ┌─────────────────────────────────────────────────────────────┐
                │                    CUSTOMER JOURNEY                         │
                └─────────────────────────────────────────────────────────────┘

  ENQUIRY           QUOTE              BOOKING           JOB              INVOICE          PAYMENT
  ───────           ─────              ───────           ───               ───────          ───────
  Website form  →   Auto or manual  →  Confirmed via  →  Day-before    →  Auto-generated → Stripe
  or phone          quote created       Stripe/manual     reminder email    post-completion   checkout
                    (QUO-YYYYMMDD-NNN)  payment           Job tracked       (GGM-INV-XXXX)    or manual
  Auto-ack email    Email to customer   Calendar event    in field app      Email with         (bank/cash)
  (Brevo)           with accept/decline created           Photos captured   payment link
                    links               Subscription      Signature capture                  Receipt email
  Enquiry stored    Deposit option      or one-off                                           (Brevo)
  in Sheets         (10% default)       handling
                                                          Complete →
  Status: New →     Status: Draft →     Status:           Telegram          Status:          Status:
  Contacted →       Sent → Accepted     Pending →         notification      Unpaid →         Paid
  Quoted →          or Declined         Confirmed →                         Sent →
  Converted                             In Progress →                       Paid/Overdue
                                        Completed
```

### 2.2 Workflow Gap Analysis

| Workflow Stage | Implemented? | Gaps |
|----------------|-------------|------|
| **Enquiry intake** | ✅ Full | Website form, GAS auto-ack, Hub receives via sync |
| **Enquiry → Quote** | ✅ Partial | Hub links enquiry to quote (`enquiry_id`), but no automatic quote generation from enquiry data |
| **Quote creation** | ✅ Full | 7 item categories, surcharges, VAT, deposit calc, send to customer |
| **Quote acceptance** | ✅ Full | Email links, deposit payment via Stripe, quote status tracking |
| **Quote → Booking** | ⚠️ PARTIAL | Accepted quote creates a job, but **no automatic schedule slot allocation** |
| **Booking confirmation** | ✅ Full | Email confirmation, calendar event, Stripe checkout |
| **Day-before reminder** | ✅ Full | Email lifecycle automation (24h before) |
| **Job execution** | ✅ Full | Mobile app: risk assessment → start → photos → complete → signature |
| **Job → Invoice** | ⚠️ PARTIAL | Mobile can send invoice from field. Hub has `INVOICE_AUTO_DELAY_HOURS = 2`. But **no automatic line-item breakdown from job details** |
| **Invoice delivery** | ✅ Full | Email with Stripe payment link |
| **Payment processing** | ✅ Full | Stripe (18 events), bank transfer, cash |
| **Payment receipt** | ✅ Full | Auto-email on Stripe payment |
| **Follow-up** | ✅ Full | 3-day post-job feedback request, re-engagement emails |
| **Recurring jobs** | ⚠️ PARTIAL | Subscription management exists but **schedule generation is manual** ("Generate Schedule" button) |

### 2.3 Identified Workflow Gaps

| # | Gap | Severity | Description |
|---|-----|----------|-------------|
| W1 | **No auto-schedule from quote acceptance** | HIGH | When a customer accepts a quote and pays a deposit, there's no automatic creation of a scheduled job slot. Manual intervention required. |
| W2 | **No job costing / profitability per job** | HIGH | While material costs are tracked in config, there's no per-job costing that includes travel time, materials used, actual hours vs estimated. |
| W3 | **No deposit tracking lifecycle** | MEDIUM | Deposits are recorded (`deposit_amount` field), but there's no workflow for: deposit → balance due → balance invoice → balance paid. The status flow is ad-hoc. |
| W4 | **Subscription schedule generation is manual** | MEDIUM | The "Generate Schedule" button exists, but recurring jobs aren't automatically scheduled week-to-week. If the button isn't pressed, subscriptions don't appear in the schedule. |
| W5 | **No multi-job quoting** | LOW | A quote can have multiple line items but maps to one job. Projects spanning multiple days need multiple separate quotes or manual handling. |
| W6 | **No automatic overdue chase** | MEDIUM | Invoices go "Overdue" via Stripe webhooks, but there's no automated chase sequence (reminder at 7d, 14d, 30d overdue). |
| W7 | **No credit note workflow** | HIGH | If a customer is overcharged or a refund is partial, there's no credit note mechanism. Stripe refunds are tracked, but no corresponding accounting document is generated. |

---

## 3. Accounting / Xero Integration Readiness

### 3.1 Current Financial Data Structures

| Structure | Location | Fields | Xero-Ready? |
|-----------|----------|--------|-------------|
| **Invoices** | SQLite + Sheets | invoice_number, job_number, client_name, client_email, amount (single total), status, stripe_invoice_id, payment_url, issue_date, due_date, paid_date, payment_method, items (JSON), notes | ❌ Missing VAT, account codes, line items with qty/unit price |
| **Quotes** | SQLite + Sheets | quote_number, client_name, items (JSON), subtotal, discount, vat, total, status, deposit_required | ⚠️ Has VAT and line items but no account codes |
| **Business Costs** | SQLite + Sheets | month, fuel, insurance, tools, vehicle, phone, software, marketing, waste, treatments, consumables, other, total | ❌ No account codes, no receipt tracking, no VAT split |
| **Payments** | Via clients table `paid` field + invoices `payment_method` | No dedicated payments table | ❌ **Critical gap** — no proper payment ledger |
| **Savings Pots** | SQLite | name, balance, target | N/A — internal management only |

### 3.2 Missing Fields for Xero Compatibility

#### Invoices — Missing Fields

| Field | Xero Requirement | Current State | Priority |
|-------|-----------------|---------------|----------|
| `tax_amount` | Tax amount per line item and total | ❌ Not tracked | P0 |
| `tax_rate` | VAT rate (20%, 0%, exempt) | ❌ Not tracked | P0 |
| `account_code` | Xero account code (e.g. "200" for Sales) | ❌ Not tracked | P0 |
| `line_items` (structured) | Array of: description, quantity, unit_price, tax_type, account_code | ⚠️ `items` field is JSON but unstructured | P0 |
| `currency` | Currency code (GBP) | ❌ Not tracked (assumed GBP) | P1 |
| `reference` | Customer reference / PO number | ❌ Not tracked | P2 |
| `payment_terms` | Net 7, Net 14, Net 30, Due on receipt | ❌ Not tracked | P1 |
| `due_date` calculation | Auto-calc from payment terms | ⚠️ Field exists but no term-based calculation | P1 |
| `branding_theme_id` | Xero branding template | N/A — set in Xero | P3 |
| `contact_id` | Xero contact UUID | ❌ Not tracked | P0 (for sync) |

#### Credit Notes — Completely Missing

| Requirement | Current State |
|-------------|---------------|
| Credit note number (sequential) | ❌ No credit notes table |
| Linked invoice reference | ❌ No relationship |
| Reason for credit | ❌ Not tracked |
| Credit note line items | ❌ Not tracked |
| Credit note status (Draft/Authorised/Voided) | ❌ Not tracked |

#### Payments — Missing Structure

| Requirement | Current State |
|-------------|---------------|
| Dedicated payments table | ❌ Payment data scattered across `invoices.paid_date`, `clients.paid`, Stripe webhooks |
| Payment allocation (which invoice a payment applies to) | ❌ Not tracked |
| Overpayment handling | ❌ Not possible |
| Partial payment tracking | ⚠️ `deposit_amount` on clients, but no running balance |
| Bank account reference | ❌ Not tracked |
| Payment reconciliation status | ❌ Not tracked |

#### Business Costs / Bills — Missing Structure

| Requirement | Current State |
|-------------|---------------|
| Per-bill tracking (supplier, date, amount, VAT) | ❌ Monthly aggregates only |
| Supplier/vendor management | ❌ No suppliers table |
| Purchase order numbers | ❌ Not tracked |
| Receipt attachment | ❌ Not tracked |
| Account code per expense | ❌ Categories only (fuel, insurance, etc.) |
| VAT reclaimable tracking | ❌ Not tracked |

### 3.3 Chart of Accounts

**Current state: ❌ None.**

The system has no chart of accounts concept. Business costs use category strings ("fuel", "insurance", "tools") rather than numeric account codes. For Xero integration, a mapping is needed:

| GGM Category | Xero Account Code | Xero Account Name |
|-------------|-------------------|-------------------|
| Sales (invoices) | 200 | Sales |
| Fuel | 449 | Motor Vehicle - Fuel |
| Insurance | 461 | Insurance |
| Tools | 429 | General Expenses |
| Vehicle | 449 | Motor Vehicle - Expenses |
| Phone | 489 | Telephone & Internet |
| Software | 463 | IT Software & Subscriptions |
| Marketing | 459 | Marketing |
| Waste disposal | 429 | General Expenses |
| Treatment products | 300 | Purchases - Materials |
| Consumables | 300 | Purchases - Materials |
| Stripe fees | 404 | Bank Fees |

### 3.4 Invoice Numbering

**Current state: ✅ Sequential** — `GGM-INV-0001`, `GGM-INV-0002`, etc.

- Generated by `generateInvoiceNumber()` in Code.gs
- Uses `LockService.getScriptLock()` for thread safety
- Scans existing invoices to find max number
- **Risk:** If two nodes create invoices simultaneously and the lock fails, duplicate numbers could occur
- **Xero compatibility:** Xero accepts custom invoice numbers — this format works

### 3.5 Audit Trail

**Current state: ❌ Inadequate**

| Requirement | Current State |
|-------------|---------------|
| Who changed a record | ❌ No `modified_by` field on any table |
| When a record was changed | ⚠️ `updated_at` on some tables, not all |
| What was changed (before/after) | ❌ No change history / audit log table |
| Financial records immutable after finalisation | ❌ Invoices can be freely edited after being "Paid" |
| Void instead of delete | ⚠️ `Void` status exists for invoices but delete is also possible |

### 3.6 Partial Payments, Deposits, Refunds

| Capability | Current State |
|------------|---------------|
| **Deposits** | ⚠️ Partial — 10% deposit on quotes, tracked via `deposit_amount` and Stripe metadata. But no "balance invoice" auto-generation. |
| **Partial payments** | ❌ No support. An invoice is either Unpaid or Paid. No running balance. |
| **Overpayments** | ❌ Not handled |
| **Refunds** | ⚠️ Stripe `charge.refunded` webhook marks invoice as "Refunded" or "Partial Refund" in Sheets. No credit note generated. |
| **Deposits → Balance invoice** | ❌ No automatic creation of a balance invoice when deposit is received |

---

## 4. Data Model Review

### 4.1 All Tables (from database.py SCHEMA_SQL)

| # | Table | Rows (est.) | Notes |
|---|-------|-------------|-------|
| 1 | `clients` | Primary CRM | Job + client combined (denormalised) |
| 2 | `schedule` | Generated visits | Links to clients by name (not FK) |
| 3 | `invoices` | Financial | Has FK-able `job_number` but no actual FK |
| 4 | `quotes` | Financial | Has `enquiry_id` field but no FK constraint |
| 5 | `business_costs` | Monthly aggregates | No per-transaction detail |
| 6 | `savings_pots` | Internal finance | Simple name/balance/target |
| 7 | `enquiries` | Leads | Links to quotes via `quote_number` (no FK) |
| 8 | `subscribers` | Newsletter | Email + tier |
| 9 | `complaints` | Customer care | Full workflow |
| 10 | `vacancies` | HR | Job postings |
| 11 | `applications` | HR | Has `vacancy_id` but no FK constraint |
| 12 | `products` | Shop | Catalogue |
| 13 | `orders` | Shop | E-commerce |
| 14 | `newsletter_log` | Marketing | Send records |
| 15 | `telegram_log` | Comms | Message log |
| 16 | `financial_dashboard` | Aggregates | Key-value metrics |
| 17 | `sync_log` | System | Sync history |
| 18 | `app_settings` | System | Key-value config |
| 19 | `search_index` | FTS5 virtual | Full-text search |
| 20 | `agent_schedules` | AI | Schedule config |
| 21 | `agent_runs` | AI | Run history (**only FK in schema**: agent_id → agent_schedules) |
| 22 | `email_tracking` | Comms | Email send log |
| 23 | `blog_posts` | Content | Blog content |
| 24 | `social_posts` | Content | Social media |
| 25 | `email_automation_log` | System | Automation log |
| 26 | `email_queue` | System | Outbox for retry |
| 27 | `job_photos` | Media | Photo metadata |
| 28 | `job_tracking` | Field | Time tracking |
| 29 | `site_analytics` | Analytics | Page views |
| 30 | `site_analytics_summary` | Analytics | Aggregates |
| 31 | `business_recommendations` | AI | Strategy tips |
| 32 | `notifications` | System | In-app alerts |
| 33 | `email_preferences` | GDPR | Opt-in/out |
| 34 | `reschedule_log` | Ops | Reschedule history |
| 35 | `cancellation_log` | Ops | Cancellation history |
| 36 | `pending_deletes` | System | Tombstones for sync |

### 4.2 Critical Data Model Issues

#### Issue 1: No Foreign Keys (Except agent_runs)

**Severity: HIGH**

The entire schema has only ONE foreign key constraint: `agent_runs.agent_id → agent_schedules(id)`. All other relationships are via string matching:

| Relationship | Current Link | Proper FK |
|-------------|-------------|-----------|
| schedule → clients | `client_name` (TEXT match) | `client_id INTEGER REFERENCES clients(id)` |
| invoices → clients | `client_name` + `client_email` (TEXT match) | `client_id INTEGER REFERENCES clients(id)` |
| quotes → enquiries | `enquiry_id INTEGER` (no constraint) | `FOREIGN KEY (enquiry_id) REFERENCES enquiries(id)` |
| quotes → clients | `client_name` (TEXT match) | N/A until clients/jobs are separated |
| applications → vacancies | `vacancy_id INTEGER` (no constraint) | `FOREIGN KEY (vacancy_id) REFERENCES vacancies(id)` |
| job_photos → clients | `client_id INTEGER` (no constraint) | `FOREIGN KEY (client_id) REFERENCES clients(id)` |
| email_tracking → clients | `client_id INTEGER` (no constraint) | `FOREIGN KEY (client_id) REFERENCES clients(id)` |

**Impact:** String-matching by `client_name` breaks when a client's name changes; data can become orphaned; no referential integrity.

#### Issue 2: Clients Table is Actually Jobs + Clients Combined

**Severity: HIGH**

The `clients` table contains both customer and job data. A customer who has 5 jobs has 5 rows in `clients`, each with potentially different names/emails/phones. This is the single biggest normalisation flaw:

```
Current:
clients = { name, email, phone, postcode, service, price, date, status, paid, ... }
           ↑ customer fields                    ↑ job fields

Should be:
customers = { id, name, email, phone, postcode, address, ... }
jobs      = { id, customer_id, service, price, date, time, status, paid, ... }
```

**Impact:**
- Can't get a unique customer count easily
- Customer details duplicated across every booking
- Updating a phone number requires updating every row for that customer
- No customer-level history or lifetime value tracking

#### Issue 3: Missing Audit Columns

| Table | Has `created_at`? | Has `updated_at`? |
|-------|-------------------|-------------------|
| clients | ✅ | ✅ |
| schedule | ❌ | ❌ |
| invoices | ❌ (has `issue_date`) | ❌ |
| quotes | ❌ (has `date_created`) | ❌ |
| business_costs | ❌ | ❌ |
| enquiries | ❌ (has `date`) | ❌ |
| subscribers | ❌ (has `date_subscribed`) | ❌ |
| products | ❌ | ❌ |
| orders | ❌ (has `date`) | ❌ |

No table has `created_by` or `updated_by`.

#### Issue 4: Missing Indexes

Most primary lookup patterns are indexed, but several are missing:

| Missing Index | Why Needed |
|---------------|------------|
| `idx_clients_type` on `clients(type)` | Filter by One-Off/Subscription |
| `idx_clients_paid` on `clients(paid)` | Filter unpaid jobs |
| `idx_invoices_client_email` on `invoices(client_email)` | Lookup invoices by customer email |
| `idx_quotes_status` on `quotes(status)` | Filter by draft/sent/accepted |
| `idx_enquiries_status` on `enquiries(status)` | Filter by new/contacted |
| `idx_schedule_status_date` on `schedule(status, date)` | Compound for daily dispatch |
| `idx_complaints_status` on `complaints(status)` | Filter open complaints |

### 4.3 Schema Normalisation Assessment

| Area | Normalisation | Issues |
|------|--------------|--------|
| **Clients/Jobs** | ❌ 1NF violation — denormalised | Customer + Job in one table |
| **Invoices** | ⚠️ Partially normalised | Line items stored as JSON blob, not in a separate table |
| **Quotes** | ⚠️ Partially normalised | Same — items as JSON |
| **Business costs** | ❌ Denormalised | Monthly aggregates, not per-transaction |
| **Schedule** | ✅ OK | Separate from clients, links by name |
| **Blog/Social** | ✅ OK | Properly separated |
| **Email tracking** | ✅ OK | Good structure |

### 4.4 Multi-Crew / Multi-Location Readiness

**Current state: ❌ Not supported**

| Requirement | Current Support |
|-------------|----------------|
| **Crew assignment** | No `crew_id` or `assigned_to` column on schedule/jobs |
| **Multiple vehicles** | No vehicle tracking table |
| **Per-crew scheduling** | Schedule table has no crew/operator field |
| **Multiple depots/locations** | `BASE_POSTCODE` is hardcoded to "PL26 8HN" |
| **Team member tracking** | No staff/employees table |
| **Per-crew revenue** | No way to attribute revenue to a crew |
| **Equipment assignment** | No equipment table |

---

## 5. Compliance Review

### 5.1 GDPR Compliance

| Requirement | Status | Evidence |
|-------------|--------|----------|
| **Privacy Policy** | ✅ | `privacy.html` — comprehensive, references UK GDPR and DPA 2018 |
| **Cookie Consent** | ✅ | `cookie-consent.js` — Accept/Reject, analytics only after consent |
| **Right to Access** | ⚠️ Partial | `get_customer_portal` returns customer data, but no formal SAR (Subject Access Request) export |
| **Right to Erasure** | ✅ | `deleteCustomerAccount()` in Code.gs — anonymises jobs, deletes from subscribers/preferences/schedule/auth |
| **Right to Rectification** | ✅ | Client edit modal, `update_client` GAS action |
| **Data Portability** | ❌ | No export functionality in a machine-readable format (JSON/CSV) |
| **Consent tracking** | ⚠️ Partial | `termsAccepted` + `termsTimestamp` on bookings; `email_preferences` table tracks opt-in/out |
| **Data minimisation** | ⚠️ | System collects DOB for job applications — is this necessary? |
| **Lawful basis documented** | ✅ | Privacy policy lists legal bases per data type |
| **Data retention policy** | ❌ | No automatic data purging. Financial records should be kept 6 years, personal data should have retention limits. |

**GDPR Risks:**
- Financial records are anonymised during GDPR deletion (`[Deleted]` name, `[deleted@deleted.com]` email), which is correct — keeping the financial record while removing PII
- However, **invoices, quotes, complaints, and email tracking are NOT anonymised** during account deletion — only Jobs sheet is cleaned
- No data retention schedule — personal data could accumulate indefinitely

### 5.2 Financial Record Immutability

**Status: ❌ NOT COMPLIANT**

- Invoices can be freely edited after being marked as "Paid"
- No versioning or change log on financial documents
- Delete actions exist for invoices (`delete_invoice` GAS action)
- Proper approach: Paid/finalised invoices should be read-only; corrections should use credit notes
- The `Void` status exists but isn't enforced — a user can change "Paid" back to "Unpaid"

### 5.3 Email Consent

| Requirement | Status |
|-------------|--------|
| **Marketing opt-in** | ✅ `email_preferences.marketing_opt_in` |
| **Transactional opt-in** | ✅ `email_preferences.transactional_opt_in` |
| **Newsletter opt-in** | ✅ `email_preferences.newsletter_opt_in` |
| **Unsubscribe mechanism** | ✅ `unsubscribe` GAS action, `unsubscribe_newsletter`, website link |
| **Service email unsubscribe** | ✅ `unsubscribe_service` GAS action |
| **Double opt-in** | ❌ No confirmation email for newsletter signup |
| **Consent timestamp** | ⚠️ `date_subscribed` on subscribers, but no explicit consent timestamp |
| **Fail-closed for marketing** | ✅ `email_automation.py` blocks marketing sends on error (GDPR safe) |
| **Owner email filtering** | ✅ `OWNER_EMAILS` set prevents automated emails to business addresses |

---

## 6. Scalability & Expansion Assessment

### 6.1 Current Capacity Limits

| Dimension | Current Capacity | 500 Clients | 1000 Jobs/Year |
|-----------|-----------------|-------------|----------------|
| **SQLite** | Handles millions of rows | ✅ Fine | ✅ Fine |
| **Google Sheets** | ~10M cells, ~5MB per sheet | ⚠️ 500 client rows × 25 cols = manageable | ⚠️ Starts getting slow at 10K+ rows |
| **GAS execution** | 90 min/day free tier | ⚠️ 19-table sync × 500+ records = long sync cycles | ❌ Will hit daily quota |
| **GAS response time** | ~2-8 seconds per call | ⚠️ `get_clients` with 500+ rows = slow | ❌ Unacceptable response times |
| **Brevo email** | 150/day, 5000/month | ⚠️ Tight with day-before reminders + invoices + lifecycle | ❌ Need paid tier |
| **Stripe** | Unlimited | ✅ | ✅ |

### 6.2 Structural Changes for Multi-Crew

| Change | Effort | Priority |
|--------|--------|----------|
| Add `staff` table (id, name, phone, role, hourly_rate, active) | Small | P1 |
| Add `crew_id` / `assigned_to` on `schedule` and `clients` (jobs) | Small | P1 |
| Add `vehicles` table (id, reg, type, mileage, MOT_date, insurance_date) | Small | P2 |
| Add `vehicle_id` on `schedule` | Small | P2 |
| Replace single `BASE_POSTCODE` with `depots` table | Medium | P2 |
| Per-crew route optimisation in dispatch | Medium | P2 |
| Per-crew revenue/KPI tracking | Medium | P2 |
| Multi-user auth on Hub app (currently single-user desktop) | Large | P1 |
| Crew availability/shift management | Large | P3 |

### 6.3 Sub-Contractor Support

**Current state: ❌ Not supported**

Required additions:
- `subcontractors` table (name, company, UTR, insurance_expiry, trades, rate, status)
- CIS (Construction Industry Scheme) deduction tracking if applicable
- Sub-contractor invoice/payment tracking separate from customer invoices
- Sub-contractor assignment on jobs
- Insurance certificate expiry tracking and alerts

---

## 7. Priority-Ordered Recommendations

### Tier 0 — Critical / Business-Blocking (Do Now)

| # | Recommendation | Area | Effort | Impact |
|---|---------------|------|--------|--------|
| **R1** | **Separate Clients from Jobs** — Create a proper `customers` table and refactor `clients` to be `jobs` with a `customer_id` FK. This is the foundation for everything else. | Data Model | LARGE | Unblocks Xero, multi-crew, customer lifetime value, deduplication |
| **R2** | **Add structured invoice line items** — Create `invoice_line_items` table with: invoice_id, description, quantity, unit_price, tax_rate, tax_amount, account_code, line_total | Accounting | MEDIUM | Required for Xero integration |
| **R3** | **Add credit notes table + workflow** — `credit_notes` table mirroring invoices structure, linked by `invoice_id` | Accounting | MEDIUM | Required for proper accounting |
| **R4** | **Financial record immutability** — Prevent editing of Paid/Void invoices. Status transitions should be one-way: Draft → Sent → Paid (or Void). | Compliance | SMALL | Legal requirement for financial records |

### Tier 1 — High Priority (Next Sprint)

| # | Recommendation | Area | Effort | Impact |
|---|---------------|------|--------|--------|
| **R5** | **Add payments table** — Dedicated payments ledger: payment_id, invoice_id, amount, method, date, reference, bank_account, reconciled | Accounting | MEDIUM | Required for Xero, payment tracking |
| **R6** | **Add tax tracking** — `tax_amount`, `tax_rate` on invoices and invoice line items. Business costs need `vat_amount`, `vat_reclaimable` | Accounting | SMALL | Required for VAT return preparation |
| **R7** | **Add chart of accounts mapping** — `account_codes` table or config mapping GGM categories to Xero account codes | Accounting | SMALL | Required for Xero sync |
| **R8** | **Add payment terms** — `payment_terms` field on invoices (Net 7, Net 14, Net 30, Due on receipt). Auto-calculate `due_date`. | Accounting | SMALL | Required for Xero, improves cash flow tracking |
| **R9** | **Add audit trail** — `audit_log` table: table_name, record_id, action (create/update/delete), changed_by, old_values (JSON), new_values (JSON), timestamp | Compliance | MEDIUM | Required for accounting compliance |
| **R10** | **Add foreign key constraints** — At minimum on invoices→clients, quotes→enquiries, schedule→clients, applications→vacancies | Data Model | SMALL | Data integrity |
| **R11** | **Google Sheets backup** — Automated daily backup of the master spreadsheet (GAS time-driven trigger → copy to backup folder) | Architecture | SMALL | Protect against data loss |
| **R12** | **Automatic overdue invoice chasing** — Email sequence at 7, 14, 30 days overdue | Workflow | MEDIUM | Cash flow improvement |

### Tier 2 — Medium Priority (Next Month)

| # | Recommendation | Area | Effort | Impact |
|---|---------------|------|--------|--------|
| **R13** | **Migrate primary data store away from Google Sheets** — Move to Supabase (already partially implemented) or a proper PostgreSQL instance. Keep GAS as API gateway only. | Architecture | LARGE | Removes the biggest scalability bottleneck |
| **R14** | **GDPR deletion completeness** — Extend `deleteCustomerAccount()` to also anonymise invoices, quotes, complaints, and email_tracking tables | Compliance | SMALL | Legal requirement |
| **R15** | **Add data retention policy** — Marketing data: 3 years after last interaction. Financial data: 6 years (HMRC). Personal data in non-financial tables: 2 years after last service. | Compliance | SMALL | GDPR compliance |
| **R16** | **Multi-crew fields** — Add `staff`, `vehicles` tables. Add `assigned_to`, `vehicle_id` on schedule. | Scalability | MEDIUM | Enables business expansion |
| **R17** | **Partial payment tracking** — Track running balance per invoice (total - deposits - payments). Support multiple payments against one invoice. | Accounting | MEDIUM | Real-world billing flexibility |
| **R18** | **Per-transaction business costs** — Replace monthly aggregate `business_costs` with individual expense records (date, amount, VAT, receipt, category, account_code) | Accounting | MEDIUM | Required for proper bookkeeping |
| **R19** | **Missing indexes** — Add compound indexes on high-frequency queries (schedule date+status, invoices client_email, quotes status) | Data Model | SMALL | Performance |
| **R20** | **Double opt-in for newsletters** — Send confirmation email before activating subscription | Compliance | SMALL | Best practice for email marketing |

### Tier 3 — Future / Nice-to-Have

| # | Recommendation | Area | Effort | Impact |
|---|---------------|------|--------|--------|
| **R21** | **Xero API integration** — Two-way sync: push invoices/payments → Xero, pull bank transactions ← Xero | Accounting | LARGE | Eliminates double-entry, real-time accounts |
| **R22** | **Move PC Hub to cloud** — Run the Hub as a cloud service (e.g. Railway, Render, or a VPS) to eliminate the PC as a SPOF | Architecture | LARGE | Eliminates biggest SPOF |
| **R23** | **CI/CD pipeline** — GitHub Actions: syntax check → test → deploy | Architecture | MEDIUM | Prevents broken deployments |
| **R24** | **Sub-contractor management** — Subcontractors table, CIS tracking, sub-contractor invoicing | Scalability | LARGE | Enables outsourcing capacity |
| **R25** | **API versioning** — Version the GAS API so breaking changes don't crash all nodes simultaneously | Architecture | MEDIUM | Safer deployments |
| **R26** | **Data export / SAR tool** — One-click export of all customer data in JSON/CSV format for GDPR SARs | Compliance | SMALL | Legal requirement if requested |
| **R27** | **Deposit → Balance invoice automation** — When deposit is received, auto-create a "Balance Due" invoice for the remaining amount | Workflow | MEDIUM | Smoother cashflow |

---

## 8. Xero Integration Roadmap

### Phase 1: Data Structure Alignment (R1, R2, R5, R6, R7)

```
Current:  clients (jobs+customers) → invoices (flat amount) → payments (scattered)
Target:   customers → jobs → invoices → invoice_line_items → payments → credit_notes
                                                    ↓
                                             account_codes
                                             tax_rates
```

### Phase 2: Xero Contact Sync
- Create Xero contacts from GGM customers
- Map `xero_contact_id` on customers table
- Two-way name/email/phone sync

### Phase 3: Invoice Push
- Push finalised invoices to Xero with proper line items, tax, account codes
- Map `xero_invoice_id` on invoices table
- Sync payment status back from Xero

### Phase 4: Payment Reconciliation
- Pull bank transactions from Xero
- Auto-match Stripe payments to invoices
- Reconcile bank transfers and cash payments

### Phase 5: Expense Tracking
- Push business costs to Xero as bills/spend money transactions
- Map receipt attachments

### Estimated Effort
- Phase 1: 3-5 days (data model changes)
- Phase 2: 2-3 days (Xero API integration)
- Phase 3: 3-5 days (invoice sync)
- Phase 4: 2-3 days (payment matching)
- Phase 5: 2-3 days (expense sync)
- **Total: 12-19 development days**

---

## 9. Architecture Diagram — Current vs Target

### Current State

```
┌─────────────┐    git push     ┌──────────┐   auto-pull    ┌─────────────┐
│  Laptop     │ ──────────────→ │  GitHub   │ ────────────→  │  PC Hub     │
│  (Node 2)   │                 │  (master) │                │  (Node 1)   │
│  SQLite     │                 └──────────┘                 │  SQLite     │
│  CustomTk   │                                              │  CustomTk   │
│  14 tabs    │                                              │  14 tabs    │
└──────┬──────┘                                              │  15 agents  │
       │           ┌──────────────────────┐                  │  Brevo      │
       │           │  Google Apps Script   │                  │  Ollama     │
       ├──────────→│  (Code.gs — 22K lines)│←────────────────┤  4 TG bots  │
       │   REST    │  Single deployment    │    REST          └──────┬──────┘
       │           │  22,137 lines         │                         │
       │           └──────────┬────────────┘                         │
       │                      │                                      │
       │                      ▼                                      │
       │           ┌──────────────────────┐                          │
       │           │  Google Sheets       │                          │
       │           │  (1 spreadsheet)     │←─────── Stripe webhooks  │
       │           │  Source of truth     │                          │
       │           └──────────────────────┘                          │
       │                      ↑                                      │
       │           ┌──────────┴───────────┐                          │
       │           │  Mobile App          │                          │
       │           │  (Node 3, Expo)      │                          │
       │           │  React Native        │                          │
       │           │  16 screens          │                          │
       │           └──────────────────────┘                          │
       │                                                             │
       │     ┌────────────────┐   optional mirror                    │
       └────→│  Supabase      │←─────────────────────────────────────┘
             │  (PostgreSQL)  │
             └────────────────┘
```

### Target State (Enterprise-Ready)

```
┌─────────────┐    ┌──────────┐    ┌─────────────┐
│  Laptop     │    │  GitHub   │    │  Cloud Hub  │ ← Remove PC as SPOF
│  (Node 2)   │    │  CI/CD    │    │  (Railway)  │
│  Dev only   │───→│  Tests    │───→│  PostgreSQL │
└─────────────┘    └──────────┘    │  15 agents  │
                                    │  Brevo/Email│
┌─────────────┐                    │  Ollama/LLM │
│  Mobile     │                    └──────┬──────┘
│  (Node 3)   │───→ REST API ←──── GAS   │
└─────────────┘                    ↑      │
                                   │      ▼
┌─────────────┐               ┌────┴──────────┐
│  Website    │──────────────→│  Supabase     │
│  (GH Pages) │               │  (Primary DB) │
└─────────────┘               └──────┬────────┘
                                     │
                              ┌──────┴────────┐
                              │  Xero         │
                              │  (Accounting) │
                              └───────────────┘
```

---

## 10. Summary of Key Metrics

| Metric | Value |
|--------|-------|
| Total SQLite tables | 36 |
| Total GAS code lines | 22,137 |
| Total doPost routes | ~60 |
| Total doGet routes | ~50 |
| Sync tables | 19 |
| Foreign key constraints | 1 (agent_runs → agent_schedules) |
| Tables missing `created_at` | 12 |
| Tables missing `updated_at` | 15 |
| Xero-required fields missing | 14+ |
| SPOFs identified | 6 |
| GDPR gaps | 4 |
| Priority R0 recommendations | 4 |
| Priority R1 recommendations | 8 |
| Priority R2 recommendations | 8 |
| Priority R3 recommendations | 7 |
| **Total recommendations** | **27** |
| Est. dev days for Xero readiness | 12-19 |

---

*End of Architecture Audit — Agent 7 of 7*
