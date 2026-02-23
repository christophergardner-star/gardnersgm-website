# GGM Hub — Email & Payment Flow Audit

> **Date:** 2025-01-20  
> **Scope:** Research-only audit — no files modified  
> **Files analysed:**  
> - `platform/app/email_automation.py` (1,583 lines)  
> - `platform/app/email_provider.py` (620 lines)  
> - `platform/app/database.py` (4,382 lines — email_tracking schema & queries)  
> - `platform/app/config.py` (OWNER_EMAILS, ADMIN_EMAIL)  
> - `platform/app/tabs/finance.py` (748 lines — UI only, no email sends)  
> - `apps-script/Code.gs` (22,344 lines — Stripe, email handlers, payment routing)  
> - `agents/email-lifecycle.js` (208 lines — queues command only, no email sends)  

---

## PART A — EMAIL / NOTIFICATION FLOW

### A1. Email Sender Inventory

#### Hub Python (email_automation.py + email_provider.py)

All Hub emails route through `EmailProvider._send_brevo()` (Brevo SMTP API) with fallback to GAS `send_email` action. Dedup via SQLite `email_tracking` table.

| # | email_type | Method | Trigger | Dedup |
|---|-----------|--------|---------|-------|
| 1 | `day_before_reminder` | `_send_day_before_reminders()` | Auto: schedule scan, jobs tomorrow | REPEATABLE same-day guard |
| 2 | `job_complete` | `_send_completion_emails()` | Auto: `get_completed_jobs_needing_email()` | Lifetime per-email |
| 3 | `invoice_sent` | `_send_invoice_emails()` | Auto: `get_unsent_invoices()` | Lifetime per-email+invoice |
| 4 | `booking_confirmed` | `_send_booking_confirmations()` | Auto: `get_new_bookings_needing_confirmation()` | Lifetime per-email |
| 5 | `follow_up` | `_send_follow_ups()` | Auto: 3 days after completion | Lifetime per-email |
| 6 | `subscription_welcome` | `_send_subscription_welcomes()` | Auto: new subscriptions | Lifetime per-email |
| 7 | `thank_you` | `_send_thank_you_emails()` | Auto: after first job | Lifetime per-email |
| 8 | `aftercare` | `_send_aftercare_emails()` | Auto: `get_jobs_needing_aftercare()` | Lifetime per-email |
| 9 | `re_engagement` | `_send_re_engagement()` | Auto: `get_lapsed_clients()` | Lifetime per-email |
| 10 | `seasonal_tips` | `_send_seasonal_tips()` | Auto: `get_seasonal_tip_recipients()` | Lifetime per-email |
| 11 | `promotional` | `_send_promotional()` | Auto: `get_promotional_recipients()` | Lifetime per-email |
| 12 | `referral` | `_send_referral_requests()` | Auto: `get_referral_candidates()` | Lifetime per-email |
| 13 | `package_upgrade` | `_send_package_upgrades()` | Auto: `get_upgrade_candidates()` | Lifetime per-email |
| 14 | `quote_accepted` | `_send_quote_accepted_emails()` | Auto: `get_quotes_needing_acceptance_email()` | Lifetime per-email |
| 15 | `cancellation` | `_send_cancellation_emails()` | Auto: `get_cancellations_needing_email()` | REPEATABLE same-day guard |
| 16 | `reschedule` | `_send_reschedule_emails()` | Auto: `get_reschedules_needing_email()` | REPEATABLE same-day guard |
| 17 | `payment_received` | `_send_payment_received_emails()` | Auto: `get_paid_invoices_needing_receipt()` (48h window) | Lifetime per-email |
| 18 | `enquiry_received` | `send_enquiry_reply()` | Manual: Hub UI button | Lifetime per-email |
| 19 | `quote_sent` | `send_quote_email()` | Manual: Hub UI button | Lifetime per-email |
| 20 | `newsletter` | `send_newsletter()` | Manual: Hub UI | REPEATABLE same-day guard |
| 21 | `admin_booking_notification` | Internal | Auto: new booking | Lifetime per-email |
| 22 | `admin_payment_notification` | Internal | Auto: payment | REPEATABLE same-day guard |
| 23 | `admin_enquiry_notification` | Internal | Auto: enquiry | Lifetime per-email |
| 24 | `admin_quote_notification` | Internal | Auto: quote | Lifetime per-email |

#### GAS (Code.gs) — HUB_OWNS_EMAILS Guard Status

`HUB_OWNS_EMAILS = true` (line 42) is the master flag. When true, GAS lifecycle emails should be suppressed.

| GAS Function | Line | Has Guard? | Caller(s) & Their Guard Status |
|-------------|------|-----------|-------------------------------|
| `sendBookingConfirmation()` | 8654 | **NO** | `processBookingPostTasks` (**GUARDED** L5038), `processSubscriptionPostTasks` (**NOT GUARDED** L5122), `send_booking_confirmation` action (**NO GUARD** L1665 — Hub-initiated), `free_visit` action (**NO GUARD** L2441) |
| `sendCompletionEmail()` | 8333 | **YES** (skips unless `_fromHub`) | `send_completion_email` action (Hub uses `_fromHub` bypass) |
| `processEmailLifecycle()` | 10413 | **YES** (skips entirely) | `process_email_lifecycle` action |
| `sendCancellationEmail()` | 4372 | **YES** | `cancel_booking` action |
| `sendRescheduleEmail()` | 4427 | **YES** | `reschedule_booking` action |
| `sendVisitReminder()` | 9849 | **NO** (own dedup: 1-day) | `processEmailLifecycle` (**GUARDED**) — effectively dead |
| `sendAftercareEmail()` | 9894 | **NO** (own dedup: 3-day) | `processEmailLifecycle` (**GUARDED**) — effectively dead |
| `sendPaymentReceivedEmail()` | 14863 | **NO** (own dedup: 7-day) | `mark_invoice_paid` action (**NO GUARD** L1771), `handleStripeInvoicePaid` (**GUARDED** L315) |
| `sendInvoiceEmail()` | 14710 | **NO** | `send_invoice_email` action (Hub-initiated — intentional) |
| `sendEnquiryReply()` | 14946 | **NO** | `send_enquiry_reply` action (Hub-initiated — intentional) |
| `sendQuoteDepositConfirmationEmail()` | 6459 | **NO** | `handleQuoteDepositPayment` (**NO GUARD** L6100) |
| Inline full-payment confirmation | 6289 | **NO** | `handleQuoteFullPayment` (**NO GUARD** L6220) |
| Inline quote-accept confirmation | 5828 | **NO** | `handleQuoteResponse` accept path (**NO GUARD** L5735) |
| `sendSubscriberContractEmail()` | ~5140 | **NO** | `processSubscriptionPostTasks` (**NO GUARD** L5140) |

---

### A2. Duplicate Send Analysis

```
Format: [sender/handler] [email_type] [trigger] [dedup] [status]
```

| # | Sender A (GAS) | Sender B (Hub) | email_type | Trigger | Status |
|---|---------------|---------------|-----------|---------|--------|
| 1 | `handleQuoteResponse` accept (L5828) — inline email, NO guard | `_send_quote_accepted_emails()` — `quote_accepted` | Quote acceptance confirmation | Customer accepts quote on web page | **DUPLICATE_PATH** |
| 2 | `handleQuoteDepositPayment` → `sendQuoteDepositConfirmationEmail()` (L6459), NO guard | `_send_payment_received_emails()` — `payment_received` (if invoice synced) | Deposit payment confirmation | Customer pays deposit via Stripe | **DUPLICATE_PATH** (partial) |
| 3 | `handleQuoteFullPayment` inline email (L6289), NO guard | `_send_payment_received_emails()` — `payment_received` (if invoice synced) | Full payment confirmation | Customer pays in full via Stripe | **DUPLICATE_PATH** |
| 4 | `processSubscriptionPostTasks` → `sendBookingConfirmation()` (L5122), NO guard | `_send_booking_confirmations()` — `booking_confirmed` AND/OR `_send_subscription_welcomes()` — `subscription_welcome` | Subscription booking confirmation | New subscription created | **DUPLICATE_PATH** |
| 5 | `free_visit` action → `sendBookingConfirmation()` (L2441), NO guard | `_send_booking_confirmations()` — `booking_confirmed` | Free visit booking confirmation | Customer books free visit | **DUPLICATE_PATH** |
| 6 | `mark_invoice_paid` action → `sendPaymentReceivedEmail()` (L1785), NO guard | `_send_payment_received_emails()` — `payment_received` | Payment receipt (manual payment) | Admin marks invoice paid | **DUPLICATE_PATH** |
| 7 | `send_booking_confirmation` action → `sendBookingConfirmation()` (L1665), NO guard | Hub calls this as its own send mechanism | Booking confirmation (Hub-initiated) | Hub triggers via GAS | **OK** (intentional) |
| 8 | `send_invoice_email` action → `sendInvoiceEmail()` (L14710), NO guard | Hub calls this as its own send mechanism | Invoice email (Hub-initiated) | Hub triggers via GAS | **OK** (intentional) |
| 9 | `send_enquiry_reply` action → `sendEnquiryReply()` (L14946), NO guard | Hub calls this as its own send mechanism | Enquiry reply (Hub-initiated) | Hub triggers via GAS | **OK** (intentional) |
| 10 | `processBookingPostTasks` → `sendBookingConfirmation()` (L5038), **GUARDED** | `_send_booking_confirmations()` — `booking_confirmed` | Booking confirmation (paid/deposit) | New booking via Stripe | **OK** (guard works) |
| 11 | `handleStripeInvoicePaid` → payment email (L315), **GUARDED** | `_send_payment_received_emails()` — `payment_received` | Stripe invoice payment receipt | Stripe webhook | **OK** (guard works) |

**Summary: 6 confirmed DUPLICATE_PATH scenarios where customers could receive 2 emails for the same event.**

---

### A3. Dedup Key Consistency

#### Hub Dedup (SQLite `email_tracking`)

```python
# REPEATABLE_TYPES — same-day guard only:
{"day_before_reminder", "newsletter", "cancellation", "reschedule", "admin_payment_notification"}

# All other types — lifetime guard (never re-send):
SELECT COUNT(*) FROM email_tracking
WHERE LOWER(client_email) = ? AND email_type IN (?, ?)  -- underscore + hyphen variant
AND status IN ('sent', 'Sent')
```

- Key: `(LOWER(client_email), email_type)` with underscore↔hyphen normalisation
- Scope: SQLite only — does NOT see emails logged by GAS in Google Sheets

#### GAS Dedup (Google Sheets `Email Tracking`)

```javascript
// wasEmailSentRecently(email, type, daysBack)
// Scans Email Tracking sheet columns: [Date, Email, Name, Type, ...]
// Match: LOWER(email) + EXACT(type) within daysBack
```

- Used by only 3 functions: `sendVisitReminder` (1 day), `sendAftercareEmail` (3 days), `sendPaymentReceivedEmail` (7 days)
- All other GAS email functions: **NO dedup at all**
- Key: `(LOWER(email), type)` — case-sensitive type comparison, no normalisation
- Scope: Google Sheets only — does NOT see emails logged by Hub in SQLite

#### Cross-System Gap

| Issue | Detail | Severity |
|-------|--------|----------|
| **Separate databases** | GAS logs to Sheets, Hub logs to SQLite. Neither checks the other. | **HIGH** |
| **Type name mismatch** | GAS: `'Booking Confirmation'`, `'visit-reminder'`, `'completion'`. Hub: `'booking_confirmed'`, `'day_before_reminder'`, `'job_complete'`. Even if synced, dedup wouldn't match. | **HIGH** |
| **Sync direction** | Hub `upsert_email_tracking()` (database.py L2843) syncs FROM Sheets TO SQLite, but using the GAS type names — Hub dedup checks Hub type names. | **MEDIUM** |
| **trackEmail bug** | `trackEmail()` (L15941) writes `type` into both the Type column AND the Subject column (column 7 = `type` instead of actual subject). Data quality issue. | **LOW** |

---

### A4. Owner Email Exclusion

#### Hub (email_automation.py L163-180)

```python
_MARKETING_TYPES = frozenset({
    "seasonal_tips", "promotional", "newsletter", "win_back",
    "referral_program", "review_request", "anniversary",
    "loyalty_offer", "seasonal_offer", "reactivation",
    "re_engagement", "referral", "package_upgrade",
})

def _is_opted_out(self, email, email_type):
    if email.lower() in {e.lower() for e in config.OWNER_EMAILS}:
        if email_type in self._MARKETING_TYPES:
            return True  # Block marketing to owner
```

**config.OWNER_EMAILS** (config.py):
```python
OWNER_EMAILS = {"cgardner37@icloud.com", "christhechef35@gmail.com", "info@gardnersgm.co.uk", "info@gardnersgm.co.uk"}
```

| Issue | Detail | Severity |
|-------|--------|----------|
| **`enquiries@gardnersgm.co.uk` MISSING** | This is the `replyTo` address on every outbound email. If it appears as a client email, marketing emails will be sent to it. | **MEDIUM** |
| **`info@gardnersgm.co.uk` duplicated** | Appears twice in the set literal. Harmless (set deduplicates) but sloppy. | **LOW** |
| **Transactional emails NOT blocked** | Owner emails can still receive `booking_confirmed`, `payment_received`, `invoice_sent`, etc. — intentional (owner may book own services for testing). | **INFO** |
| **GAS has NO owner exclusion** | No equivalent check in Code.gs. If GAS sends (bypass or duplicate path), owner gets all emails. | **LOW** (GAS lifecycle is gated by HUB_OWNS_EMAILS) |

---

### A5. Complete email_type Value Inventory

#### Hub Types (logged to SQLite email_tracking.email_type)

| email_type | Category |
|-----------|----------|
| `day_before_reminder` | Transactional (repeatable) |
| `job_complete` | Transactional |
| `invoice_sent` | Transactional |
| `booking_confirmed` | Transactional |
| `follow_up` | Lifecycle |
| `subscription_welcome` | Lifecycle |
| `thank_you` | Lifecycle |
| `aftercare` | Lifecycle |
| `re_engagement` | Marketing |
| `seasonal_tips` | Marketing |
| `promotional` | Marketing |
| `referral` | Marketing |
| `package_upgrade` | Marketing |
| `quote_accepted` | Transactional |
| `cancellation` | Transactional (repeatable) |
| `reschedule` | Transactional (repeatable) |
| `payment_received` | Transactional |
| `enquiry_received` | Transactional |
| `quote_sent` | Transactional |
| `newsletter` | Marketing (repeatable) |
| `newsletter_preview` | Admin |
| `admin_booking_notification` | Admin |
| `admin_payment_notification` | Admin (repeatable) |
| `admin_enquiry_notification` | Admin |
| `admin_quote_notification` | Admin |

#### GAS Types (logged to Sheets Email Tracking via logEmailSent/trackEmail)

| Type String | Logged By |
|------------|----------|
| `'Booking Confirmation'` | `trackEmail()` in processBookingPostTasks, free_visit |
| `'Subscription Confirmation'` | `trackEmail()` in processSubscriptionPostTasks |
| `'Subscriber Contract'` | `trackEmail()` in processSubscriptionPostTasks |
| `'visit-reminder'` | `logEmailSent()` in sendVisitReminder |
| `'aftercare'` | `logEmailSent()` in sendAftercareEmail |
| `'payment_received'` | `logEmailSent()` in sendPaymentReceivedEmail |
| `'completion'` | `logEmailSent()` in sendCompletionEmail (assumed) |
| Various ad-hoc strings | Other GAS emails don't consistently log types |

**Type Name Mismatch Table:**

| Concept | Hub Type | GAS Type | Match? |
|---------|---------|---------|--------|
| Booking confirmation | `booking_confirmed` | `Booking Confirmation` | **NO** |
| Day-before reminder | `day_before_reminder` | `visit-reminder` | **NO** |
| Job completion | `job_complete` | `completion` | **NO** |
| Subscription welcome | `subscription_welcome` | `Subscription Confirmation` | **NO** |
| Payment receipt | `payment_received` | `payment_received` | **YES** |
| Aftercare | `aftercare` | `aftercare` | **YES** |

---

### A6. Dead / Unreachable Code

| Code | Location | Reason | Status |
|------|---------|--------|--------|
| `sendVisitReminder()` body | Code.gs L9849 | Only called from `processEmailLifecycle()` which is fully skipped when `HUB_OWNS_EMAILS=true`. Function itself has no guard. | **DEAD_CODE** (while flag is true) |
| `sendAftercareEmail()` body | Code.gs L9894 | Same — only callable path is gated. | **DEAD_CODE** (while flag is true) |
| `processEmailLifecycle()` body after guard | Code.gs L10413-10900+ | Entire lifecycle engine (~500 lines) is skipped. | **DEAD_CODE** (while flag is true) |
| `sendCancellationEmail()` body | Code.gs L4372 | Guarded. | **DEAD_CODE** (while flag is true) |
| `sendRescheduleEmail()` body | Code.gs L4427 | Guarded. | **DEAD_CODE** (while flag is true) |
| GAS email template helpers | Various | `getGgmEmailHeader()`, aftercare content, etc. still used by unguarded paths (quote emails, payment emails) | **ALIVE** — shared by unguarded paths |

---

## PART B — PAYMENT / INVOICE FLOW

### B1. Scenario 1: Quote → Accept → Deposit → Balance Invoice → Paid

```
Format: [scenario] [step] [handler] [columns_updated] [status]
```

| Step | Handler | Sheet | Column Updates | Emails | Status |
|------|---------|-------|---------------|--------|--------|
| 1. Customer accepts quote (deposit required) | `handleQuoteResponse` (L5657) | Quotes | Col Q→"Awaiting Deposit", Col T→now, Col X→jobNumber | ✉ Customer confirmation (inline, **NO guard**), ✉ Admin email to cgardner37 | **BUG: DUPLICATE_PATH** — Hub also sends `quote_accepted` |
| | | Jobs | New row: Col L="Awaiting Deposit", Col R="No", Col S="Quote" | | |
| | | Schedule | New row: Status="Awaiting Deposit" | | |
| 2. Customer pays deposit | `handleQuoteDepositPayment` (L5953) | Quotes | Col Q→"Deposit Paid" | ✉ `sendQuoteDepositConfirmationEmail()` (**NO guard**) | **BUG: DUPLICATE_PATH** — Hub may send `payment_received` if invoice synced |
| | `markJobDepositPaid()` (L5896) | Jobs | Col L→"Confirmed", Col R→"Deposit Paid", Col S→"Stripe Deposit (£X)", Col Q notes updated | ✉ Telegram moneybot | |
| | | Schedule | Status→"Confirmed" | | |
| 3. Work done; admin marks complete | Hub lifecycle / admin UI | Jobs | Col L→"Completed" (via status progression or admin) | ✉ Hub `job_complete` email | **OK** |
| 4. Admin creates & sends invoice | Hub → GAS `send_invoice_email` | Invoices | New row: Status="Sent" | ✉ Hub `invoice_sent` via GAS (intentional) | **OK** |
| 5a. Customer pays via Stripe | `handleStripeInvoicePaid` (L251) | Invoices | Status→"Paid", DatePaid=now, PaymentMethod="Stripe" | ✉ Payment email **GUARDED** | **OK** |
| | `markJobAsPaid()` | Jobs | Col R→"Yes", Col S→"Stripe", Col L→"Completed" | ✉ Hub `payment_received` | **OK** |
| 5b. Admin marks paid manually | `mark_invoice_paid` action (L1771) | Invoices | Status→"Paid" (via `updateInvoiceByNumber`) | ✉ `sendPaymentReceivedEmail()` (**NO guard**) | **BUG: DUPLICATE_PATH** — Hub also sends `payment_received` |
| | `markJobAsPaid()` | Jobs | Col R→"Yes", Col S→"Bank Transfer", Col L→"Completed" | ✉ Hub `payment_received` = 2nd email | |

**Bugs in Scenario 1:**
- Step 1: Customer receives 2 acceptance emails (GAS inline + Hub `quote_accepted`)
- Step 2: Customer may receive 2 deposit confirmations (GAS `sendQuoteDepositConfirmationEmail` + Hub `payment_received`)
- Step 5b: Customer receives 2 payment receipts (`sendPaymentReceivedEmail` from GAS + `payment_received` from Hub)

---

### B2. Scenario 2: Quote → Accept (no deposit) → Full Payment

| Step | Handler | Sheet | Column Updates | Emails | Status |
|------|---------|-------|---------------|--------|--------|
| 1. Customer accepts quote | `handleQuoteResponse` (L5735) | Quotes | Col Q→"Accepted", Col T→now, Col X→jobNumber | ✉ Customer confirmation (inline, **NO guard**), ✉ Admin email | **BUG: DUPLICATE_PATH** |
| | | Jobs | New row: Col L="Confirmed", Col R="No", Col S="Quote" | | |
| | | Schedule | New row: Status="Confirmed" | | |
| | | Calendar | Event created | | |
| 2. Customer pays in full | `handleQuoteFullPayment` (L6151) | Quotes | Col Q→"Paid in Full" | ✉ Inline confirmation (**NO guard**), ✉ Admin email | **BUG: DUPLICATE_PATH** |
| | | Jobs | Col L="Confirmed", Col R="Yes", notes updated | | |
| | | Schedule | Date confirmed, notes updated | | |
| | | Calendar | Event created | | |

**Bugs in Scenario 2:**
- Step 1: 2 acceptance emails (same as Scenario 1)
- Step 2: GAS sends inline payment confirmation. Hub `_send_payment_received_emails()` may also fire if invoice record synced with "Paid" status.

---

### B3. Scenario 3: Direct Booking → Payment → Invoice

| Step | Handler | Sheet | Column Updates | Emails | Status |
|------|---------|-------|---------------|--------|--------|
| 1a. Customer pays in full | `handleBookingPayment` (L4745) | Jobs | New row: Col L="Confirmed", Col R="Yes", Col S="Stripe One-Off" | Deferred to `processBookingPostTasks` | **OK** |
| 1b. Customer pays deposit | `handleBookingDeposit` (L4888) | Jobs | New row: Col L="Confirmed", Col R="Deposit Paid", Col S="Stripe Deposit (£X)" | Deferred to `processBookingPostTasks` | **OK** |
| 2. Post-task trigger fires | `processBookingPostTasks` (L5023) | — | — | ✉ `sendBookingConfirmation` (**GUARDED**), ✉ Telegram | **OK** |
| 3. Work done; admin marks complete | Hub lifecycle | Jobs | Col L→"Completed" | ✉ Hub `job_complete` | **OK** |
| 4. Admin sends invoice | Hub → GAS `send_invoice_email` | Invoices | New row, Status="Sent" | ✉ Hub `invoice_sent` via GAS | **OK** |
| 5. Payment received | Same as Scenario 1 Step 5a/5b | | | | See above |

| Step | Handler | Sheet | Column Updates | Emails | Status |
|------|---------|-------|---------------|--------|--------|
| ALT: Free visit booking | `free_visit` action (L2390) | Jobs | New row: Col L="Enquiry"/"Confirmed", Col R="No" | ✉ `sendBookingConfirmation` (**NO guard**) | **BUG: DUPLICATE_PATH** — Hub also sends `booking_confirmed` |

**Bug in Scenario 3:**
- Free-visit bookings get 2 confirmation emails (GAS direct + Hub lifecycle)
- Paid bookings: HUB_OWNS_EMAILS guard is properly checked — **OK**

---

### B4. Scenario 4: Subscription

| Step | Handler | Sheet | Column Updates | Emails | Status |
|------|---------|-------|---------------|--------|--------|
| 1. Customer subscribes | `handleStripeSubscription` (L6498) | Jobs | New row: Col L="Active", Col R="Yes", Col S="Stripe Subscription" | Deferred to `processSubscriptionPostTasks` | |
| 2. Post-task trigger fires | `processSubscriptionPostTasks` (L5108) | — | — | ✉ `sendBookingConfirmation` (**NO guard** — BUG), ✉ `sendSubscriberContractEmail` (**NO guard**), ✉ Newsletter auto-subscribe, ✉ Telegram | **BUG: DUPLICATE_PATH** |
| 3. Hub lifecycle detects new subscription | Hub `_send_booking_confirmations()` and/or `_send_subscription_welcomes()` | — | — | ✉ `booking_confirmed` and/or `subscription_welcome` | |
| 4. Recurring invoice paid | `handleStripeInvoicePaid` (L251) | Invoices | Status→"Paid" | ✉ Payment email **GUARDED** | **OK** |
| | | Jobs | Col R→"Yes", Col S→"Stripe" | ✉ Hub `payment_received` | **OK** |

**Bugs in Scenario 4:**
- Step 2+3: Customer receives up to 3 emails — GAS booking confirmation + GAS contract + Hub subscription_welcome/booking_confirmed
- `processSubscriptionPostTasks` is the ONLY booking post-task handler that is **missing** the `HUB_OWNS_EMAILS` guard

---

### B5. Payment Status Column Reference

**Jobs Sheet Columns:**

| Column | Index | Field | Values |
|--------|-------|-------|--------|
| L | 12 | Status | `Enquiry`, `Awaiting Deposit`, `Confirmed`, `Scheduled`, `In Progress`, `Completed`, `Invoiced`, `Cancelled` |
| R | 18 | Paid | `No`, `Yes`, `Deposit Paid`, `Balance Due` |
| S | 19 | Payment Type | `Quote`, `Stripe One-Off`, `Stripe Deposit (£X)`, `Stripe`, `Stripe Subscription`, `Bank Transfer`, `Cash` |

**Invoices Sheet Key Columns:**

| Column | Field | Values |
|--------|-------|--------|
| Status (Col F) | Status | `Draft`, `Sent`, `Paid`, `Void`, `Overdue` |
| Date Paid (Col K) | DatePaid | ISO timestamp |
| Payment Method (Col L) | PaymentMethod | `Stripe`, `Bank Transfer`, `Cash` |

**Quotes Sheet Key Columns:**

| Column | Index | Field | Values |
|--------|-------|-------|--------|
| Q | 17 | Status | `Draft`, `Sent`, `Awaiting Deposit`, `Accepted`, `Deposit Paid`, `Paid in Full`, `Declined`, `Expired` |

---

## CONSOLIDATED BUG LIST

### Critical (duplicate customer emails)

| # | Bug | Location | Impact | Fix Sketch |
|---|-----|---------|--------|-----------|
| **C1** | `processSubscriptionPostTasks` calls `sendBookingConfirmation()` without `HUB_OWNS_EMAILS` guard | Code.gs L5122 | Subscription customers get 2–3 confirmation emails | Add `if (!HUB_OWNS_EMAILS) { ... }` around the sendBookingConfirmation call |
| **C2** | `handleQuoteResponse` accept path sends inline customer confirmation without guard | Code.gs L5828 | Quote-accepting customers get 2 confirmation emails | Add `if (!HUB_OWNS_EMAILS) { ... }` around the email block |
| **C3** | `handleQuoteFullPayment` sends inline payment confirmation without guard | Code.gs L6289 | Full-payment customers get 2 receipt emails | Add guard |
| **C4** | `handleQuoteDepositPayment` calls `sendQuoteDepositConfirmationEmail()` without guard | Code.gs L6100 | Deposit-paying customers get 2 confirmations | Add guard |
| **C5** | `mark_invoice_paid` action calls `sendPaymentReceivedEmail()` without guard | Code.gs L1785 | Manually-marked-paid invoices generate 2 receipt emails | Add guard |
| **C6** | `free_visit` action calls `sendBookingConfirmation()` without guard | Code.gs L2441 | Free-visit customers get 2 booking confirmations | Add guard |

### Medium

| # | Bug | Location | Impact | Fix Sketch |
|---|-----|---------|--------|-----------|
| **M1** | `enquiries@gardnersgm.co.uk` missing from `OWNER_EMAILS` | config.py L93-100 | Marketing emails could be sent to the business reply-to address | Add to set |
| **M2** | Email type name mismatch between Hub and GAS | System-wide | Synced email records from Sheets won't match Hub dedup queries. E.g. GAS logs `'Booking Confirmation'` but Hub checks for `'booking_confirmed'` | Normalise type names, or add mapping in `upsert_email_tracking()` |
| **M3** | Two separate dedup systems (SQLite vs Sheets) don't cross-reference | System-wide | Even if only one system sends, the other doesn't know and may re-send on restart/resync | Hub sync should translate GAS types → Hub types when ingesting email_tracking |

### Low

| # | Bug | Location | Impact | Fix Sketch |
|---|-----|---------|--------|-----------|
| **L1** | `info@gardnersgm.co.uk` duplicated in OWNER_EMAILS set literal | config.py L93-100 | No runtime impact (set deduplicates), but code smell | Remove duplicate |
| **L2** | `trackEmail()` writes `type` into Subject column instead of actual subject | Code.gs L15941 | Email Tracking sheet has wrong data in Subject column | Pass `subject` parameter |
| **L3** | ~500 lines of GAS lifecycle email code is dead while `HUB_OWNS_EMAILS=true` | Code.gs L10413+ | Code bloat, maintenance burden | Consider removing or clearly marking as deprecated |

---

## APPENDIX: Call Flow Diagrams

### Email Ownership Decision Tree

```
Customer event occurs
  │
  ├── Event handled by GAS directly (quote/deposit/free-visit)?
  │     │
  │     ├── Has HUB_OWNS_EMAILS guard? ─── YES → email suppressed → Hub sends later ✓
  │     │
  │     └── NO guard? ─── GAS sends immediately
  │           │
  │           └── Hub lifecycle also detects event → sends again ✗ DUPLICATE
  │
  └── Event handled by GAS via deferred trigger (booking/subscription)?
        │
        ├── processBookingPostTasks → GUARDED ✓
        │
        └── processSubscriptionPostTasks → NOT GUARDED ✗ DUPLICATE
```

### Payment Receipt Email Decision Tree

```
Invoice marked paid
  │
  ├── Via Stripe webhook (handleStripeInvoicePaid)
  │     └── sendPaymentReceivedEmail: GUARDED → Hub sends ✓
  │
  ├── Via mark_invoice_paid admin action
  │     └── sendPaymentReceivedEmail: NOT GUARDED → GAS sends
  │           └── Hub lifecycle also detects paid invoice → sends again ✗ DUPLICATE
  │
  └── Via quote full payment (handleQuoteFullPayment)
        └── Inline confirmation: NOT GUARDED → GAS sends
              └── Hub lifecycle may also detect → sends again ✗ DUPLICATE
```

---

*End of audit. No files were modified.*
