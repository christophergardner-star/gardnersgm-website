# GGM Hub — Enterprise Code Audit Report (Agent 1 of 7)

**Audit Scope:** All 15 core Python files in `platform/app/`  
**Auditor:** Agent 1 — Core Backend Audit  
**Date:** 2025-01-XX  
**App Version:** 4.8.0  
**Total Lines Audited:** ~12,500  

---

## Executive Summary

The GGM Hub backend is a functional and feature-rich system powering a gardening/landscaping business.
It handles CRM, invoicing, quoting, email marketing, AI content generation, and multi-node sync.
However, the codebase carries **significant data-integrity and security risks** that must be addressed
before any accounting integration (Xero) and before the system manages real financial data at scale.

| Severity | Count |
|----------|-------|
| **CRITICAL** | 8 |
| **MAJOR** | 14 |
| **MINOR** | 12 |
| **ACCOUNTING** | 7 |

---

## File-by-File Findings

---

### 1. `config.py` — 469 lines

**Purpose:** Environment loading, business constants, service definitions, email lifecycle stages.

#### CRITICAL

*None.*

#### MAJOR

| # | Line(s) | Issue | Detail |
|---|---------|-------|--------|
| M1 | L52–55 | **Hardcoded webhook URL** | The Google Apps Script `SHEETS_WEBHOOK` URL is baked into source. If the GAS deployment changes, every node needs a code push. Should be in `.env`. |
| M2 | L81 | **ADMIN_API_KEY defaults to empty string** | `ADMIN_API_KEY = os.getenv("ADMIN_API_KEY", "")` — if `.env` is missing the key, all admin-protected GAS routes are accessible without authentication. Should fail-closed (refuse to start or disable admin calls). |

#### MINOR

| # | Line(s) | Issue |
|---|---------|-------|
| m1 | L93–96 | Owner email/name hardcoded (`ADMIN_EMAIL`, `ADMIN_NAME`) — fine for a single-owner business but should be in `.env` for portability. |
| m2 | L140–180 | `FUND_ALLOCATION` rates (Tax 20%, NI 6%, etc.) are hardcoded constants — should be loaded from `.env` or a settings table for runtime adjustment. |
| m3 | — | No `LOG_PATH`, `LOG_MAX_BYTES`, `LOG_BACKUP_COUNT` visible in config — likely defined elsewhere but creates implicit coupling. |

---

### 2. `main.py` — 519 lines

**Purpose:** Entry point — logging, DB init, service orchestration, UI launch.

#### CRITICAL

*None.*

#### MAJOR

| # | Line(s) | Issue | Detail |
|---|---------|-------|--------|
| M3 | ~L280–350 | **All services started as daemon threads with no join** | Daemon threads are killed abruptly on process exit. If a sync write or email send is mid-flight, data is silently lost. The `_shutdown()` calls `stop()` on services but daemon threads die before flush completes if the main thread exits quickly. |

#### MINOR

| # | Line(s) | Issue |
|---|---------|-------|
| m4 | ~L90 | PIN screen is hardcoded 4-digit check — no lockout after failed attempts. |
| m5 | ~L400 | Nightly backup at 02:00 runs in a bare thread with no retry if it fails. |

---

### 3. `api.py` — ~160 lines

**Purpose:** HTTP client for the Google Apps Script webhook with retries and redirect following.

#### CRITICAL

| # | Line(s) | Issue | Detail |
|---|---------|-------|--------|
| **C1** | L45–46 | **Admin API key sent as plaintext query parameter** | `query["adminToken"] = config.ADMIN_API_KEY` — on every GET request the admin token is appended to the URL. URLs are logged in browser history, server access logs, proxies, and any intermediate cache. It should be sent as a header or in the POST body only. |

#### MAJOR

| # | Line(s) | Issue | Detail |
|---|---------|-------|--------|
| M4 | L103–108 | **Content-Type: text/plain for JSON POST** | `headers={"Content-Type": "text/plain"}` — the comment says "GAS sometimes needs text/plain" but this breaks any intermediary (CDN, WAF, API gateway) that inspects Content-Type. Also means `request.getJSON()` in GAS won't work if it checks the Content-Type header. |

#### MINOR

| # | Line(s) | Issue |
|---|---------|-------|
| m6 | — | No request rate limiting — a sync loop calling many GAS endpoints in rapid succession could hit Google's quotas. |

---

### 4. `database.py` — 3,745 lines

**Purpose:** SQLite schema, migrations, and all CRUD operations. This is the backbone of the system.

#### CRITICAL

| # | Line(s) | Issue | Detail |
|---|---------|-------|--------|
| **C2** | L1912, L1516, L2149, L2203, L2259, L2312, L2361, L2379 | **Destructive DELETE-then-INSERT sync pattern** | `upsert_enquiries()` (L1912), `upsert_schedule()` (L1516), `upsert_complaints()` (L2149), `upsert_vacancies()` (L2203), `upsert_applications()` (L2259), `upsert_products()` (L2312), `upsert_orders()` (L2361), `upsert_subscribers()` (L2379) all do `DELETE FROM <table>` followed by re-insertion. **Any locally-modified (dirty) rows are destroyed on every sync cycle.** Compare with `upsert_clients()` and `upsert_invoices()` which correctly use `sheets_row` matching — these 8 tables lack that protection. |
| **C3** | L1131, L1922, L1599, L1726, etc. | **Unsanitised column names in dynamic SQL** | `save_client()`, `save_invoice()`, `save_quote()`, `save_enquiry()` all build SQL from `dict.keys()`: `f"UPDATE clients SET {sets} WHERE id = ?"` where `sets` comes from `", ".join(f"{c} = ?" for c in cols)`. Column names are taken directly from the `data` dict keys. If any caller passes a dict with a key like `"id; DROP TABLE clients--"`, it will be injected verbatim into the SQL string. While values are parameterised, **column names are not**. |
| **C4** | L2022–2029 | **SQL injection in `get_analytics_daily()`** | `f"WHERE date >= date('now', '-{days} days')"` — the `days` parameter is interpolated directly into SQL via f-string. If `days` comes from user input (e.g., a UI field), this is exploitable. |
| **C5** | L669, L844 | **`check_same_thread=False` without locking** | The connection is shared across multiple daemon threads (sync, email, agents, UI) with no `threading.Lock` protecting write operations. SQLite's WAL mode handles concurrent reads but concurrent writes from multiple threads via a single connection can corrupt the database or raise `OperationalError: database is locked`. |

#### MAJOR

| # | Line(s) | Issue | Detail |
|---|---------|-------|--------|
| M5 | L390 | **Only 1 foreign key in entire schema** | `FOREIGN KEY (agent_id) REFERENCES agent_schedules(id)` — this is the only FK constraint among 35+ tables. `invoices`, `schedule`, `quotes`, `email_tracking`, `orders` etc. have no referential integrity to `clients`. Orphaned records are inevitable. |
| M6 | L22, L490, L756 | **SCHEMA_VERSION = 1 — never used for migration** | `SCHEMA_VERSION` is declared and inserted into `app_settings` but never checked. There is no migration framework — schema changes require manual SQLite operations on every node. |
| M7 | L857–858 | **`fetchall()` and `fetchone()` bypass `_ensure_connected()`** | `fetchall()` calls `self.conn.execute()` directly instead of `self.execute()`, so if the connection is `None`, it crashes with `AttributeError` instead of reconnecting. |
| M8 | L1912–1923 | **No transaction wrapping on DELETE-then-INSERT** | `upsert_enquiries()` does `DELETE FROM enquiries` then multiple `INSERT` statements, committing only at the end. If the process crashes mid-insert, the table is left empty. Should use `BEGIN IMMEDIATE` ... `COMMIT`. |
| M9 | L670–673 | **`_ensure_connected` reconnect doesn't re-apply `row_factory`** | Wait — actually it does (`self.conn.row_factory = sqlite3.Row` at L846–847 inside `_ensure_connected`). However, the initial `__init__` path (L669–673) sets `row_factory` but `_ensure_connected` at L843–849 also sets it. Actually on re-read both paths set it — this is fine. *Withdrawn.* |

#### MINOR

| # | Line(s) | Issue |
|---|---------|-------|
| m7 | — | No indexes on `schedule.date`, `email_tracking.client_email`, `invoices.client_name`, `invoices.status`, `blog_posts.status` — common query targets. |
| m8 | — | `_normalise_date()` is basic — doesn't handle `DD/MM/YYYY` (the sync module has its own `_safe_date` that does). Duplication of date parsing logic. |
| m9 | — | `backup()` uses `shutil.copy2()` as fallback — this copies a potentially mid-write WAL file, producing a corrupt backup. Should use SQLite's `.backup()` API exclusively (which it does as primary — the fallback is the risk). |

#### ACCOUNTING Gaps

| # | Issue | Detail |
|---|-------|--------|
| A1 | **No tax breakdown fields** | `invoices` table has a single `amount` column with no `subtotal`, `tax_amount`, `tax_rate`, `currency` fields. UK VAT reporting requires line-by-line tax breakdown. |
| A2 | **No line items table** | Invoice line items are stored as a JSON string in `invoices.items`. There is no normalised `invoice_lines` table with `quantity`, `unit_price`, `tax_rate`, `description`. This makes SQL-based financial reporting impossible. |
| A3 | **No Xero integration fields** | Missing: `xero_contact_id`, `xero_invoice_id`, `xero_payment_id` on `invoices` and `clients`. These are required for two-way sync with Xero. |
| A4 | **No audit trail** | There is no `change_log` or `audit_trail` table recording who changed what and when. Financial record mutations are invisible. |
| A5 | **No currency field** | All amounts are implicitly GBP. If the business ever handles multi-currency (refunds from Stripe in different currencies), there is no way to record it. |
| A6 | **Quotes table lacks terms** | No `terms_and_conditions`, `payment_terms`, `deposit_percentage` columns. Quotes are legally binding documents. |
| A7 | **No reconciliation mechanism** | No `bank_transactions` table or Stripe payment ↔ invoice reconciliation table. Payments are recorded as status changes on invoices with no independent verification. |

---

### 5. `sync.py` — 1,595 lines

**Purpose:** Background sync engine — bidirectional data flow between Google Sheets and SQLite.

#### CRITICAL

| # | Line(s) | Issue | Detail |
|---|---------|-------|--------|
| **C6** | Calls to `upsert_enquiries()`, `upsert_schedule()`, etc. | **Sync destroys locally-modified data** | (Consequence of C2 above.) The sync engine calls `db.upsert_enquiries(rows)` which does `DELETE FROM enquiries` — any enquiry that was edited locally but not yet pushed to Sheets is permanently lost. The `upsert_clients()` and `upsert_invoices()` methods correctly use `sheets_row` matching to preserve dirty rows, but 8 other tables do not. |

#### MAJOR

| # | Line(s) | Issue | Detail |
|---|---------|-------|--------|
| M10 | L1100–1200 | **Supabase mirror does individual upserts in a loop** | `_mirror_to_supabase()` iterates through up to 2000 clients, 2000 invoices, etc., doing one HTTP call per record. This will timeout or hit rate limits on Supabase. Should batch upserts. |
| M11 | L1240–1260 | **Write queue re-enqueues failed writes infinitely** | `_process_writes()` limits to 3 attempts via `_sync_attempts`, but if the queue processing crashes before incrementing the counter, the item is silently dropped from the queue (it was already `get_nowait()`'d). No dead letter queue or persistent retry log. |

#### MINOR

| # | Line(s) | Issue |
|---|---------|-------|
| m10 | L720–750 | `_download_drive_photos()` uses `urllib.request.urlretrieve()` which doesn't handle Google Drive's virus scan redirect for large files. |

---

### 6. `email_automation.py` — 1,582 lines

**Purpose:** 19-stage email lifecycle engine with daily caps, opt-out checking, GDPR compliance.

#### CRITICAL

*None.* The email automation has good GDPR safeguards (opt-out checking, marketing classification, owner-email blocking).

#### MAJOR

| # | Line(s) | Issue | Detail |
|---|---------|-------|--------|
| M12 | ~L1090–1100 | **`_send_via_provider()` GAS fallback always logs "sent"** | When the Brevo provider is unavailable and the GAS fallback is used, the code does `self.api.post("send_email", ...)` and then unconditionally logs `success = True`. If the GAS call throws an exception, it propagates — but if GAS returns an error *in the response body* (not an exception), it's silently treated as success. |

#### MINOR

| # | Line(s) | Issue |
|---|---------|-------|
| m11 | ~L1100 | `build_day_before_reminder()` in the manual trigger path calls `tpl.build_day_before_reminder(... time_str=time_str, postcode=postcode)` but the template function signature is `build_day_before_reminder(name, service, job_date, job_time)` — potential `TypeError` from unexpected keyword argument. |

---

### 7. `email_provider.py` — 620 lines

**Purpose:** Brevo email delivery with queue, retry, duplicate prevention, branded HTML wrapper.

#### CRITICAL

*None.*

#### MAJOR

| # | Line(s) | Issue | Detail |
|---|---------|-------|--------|
| M13 | ~L60–100 | **Hardcoded phone number in branded HTML template** | `"01726 432051"` is embedded in the HTML footer. If the number changes, it requires a code release. Should come from `config.py`. |

#### MINOR

| # | Line(s) | Issue |
|---|---------|-------|
| m12 | ~L530 | `get_delivery_stats()` does `__import__("datetime")` inline — wasteful; `datetime` is already imported at module level. |
| m13 | ~L480 | `_is_duplicate()` status check uses `IN ('sent', 'Sent')` — inconsistent casing suggests the status field isn't normalised at write time. |

---

### 8. `email_templates.py` — 799 lines

**Purpose:** HTML email template builders for all 19 lifecycle stages.

#### CRITICAL

*None.*

#### MAJOR

*None.*

#### MINOR

| # | Line(s) | Issue |
|---|---------|-------|
| m14 | ~L500 | `build_invoice_sent()` hardcodes bank account details (sort code, account number) in HTML. These should be in `config.py`. |

#### ACCOUNTING Gap

| # | Issue | Detail |
|---|-------|--------|
| A8 | **Invoice email has no VAT breakdown** | `build_invoice_sent()` shows a total amount but no VAT line. UK businesses above the VAT threshold must show VAT separately on invoices. |

---

### 9. `llm.py` — 508 lines

**Purpose:** LLM auto-detection (Ollama → OpenAI-compatible → Gemini → template fallback).

#### CRITICAL

| # | Line(s) | Issue | Detail |
|---|---------|-------|--------|
| **C7** | L88–92 | **`taskkill /F /IM ollama.exe` kills ALL Ollama processes system-wide** | `_restart_ollama_with_models_dir()` runs `taskkill /F /IM ollama.exe` (Windows) or `pkill -f ollama` (Linux). This kills ALL Ollama instances on the machine, including any serving other applications. Should target only the process the Hub started. |

#### MAJOR

| # | Line(s) | Issue | Detail |
|---|---------|-------|--------|
| M14 | ~L477 | **Gemini API key exposed in URL query param** | The Gemini API call uses `f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"` — the API key is in the URL, which means it appears in server logs, proxy logs, and any error reporting that captures URLs. Should be sent as a header (`x-goog-api-key`). |

#### MINOR

| # | Line(s) | Issue |
|---|---------|-------|
| m15 | ~L130–160 | Auto-detection probes `localhost:1234`, `localhost:5000`, `localhost:8080` — these are common ports for unrelated services (Flask dev server, Webpack, etc.). Could accidentally connect to a non-LLM service. |

---

### 10. `content_writer.py` — 1,524 lines

**Purpose:** AI blog/newsletter generation with brand voice, 5 writer personas, content sanitisation.

#### CRITICAL

*None.* The content sanitisation (`_sanitise()`) is thorough — removes hallucinated phone numbers, fake emails, fake URLs, fake prices, American spellings.

#### MAJOR

*None.*

#### MINOR

| # | Line(s) | Issue |
|---|---------|-------|
| m16 | ~L530 | `_sanitise()` replaces ALL URLs with `www.gardnersgm.co.uk` including valid external URLs to Pexels, RSPB, Eden Project, etc. that might be legitimately referenced in blog content. |
| m17 | ~L458 | American-to-British spelling replacements use `re.sub(rf'\b{us}\b', uk, ...)` which is case-insensitive by default — this could incorrectly change proper nouns (e.g., "Gray" as a surname → "Grey"). |

---

### 11. `agents.py` — 795 lines

**Purpose:** Agent scheduler — runs blog/newsletter agents on schedule, Pexels image fetching, Telegram approval.

#### CRITICAL

*None.*

#### MAJOR

| # | Line(s) | Issue | Detail |
|---|---------|-------|--------|
| M15 | L590–624 | **Blog: sends approval request AND "Auto-Published" Telegram message** | The blog agent sends a `send_approval_request()` Telegram message asking Chris to approve, then *also* sends a "📝 Blog Auto-Published" notification (L614). The blog was saved as `status="Draft"` (L579), not published. The Telegram message is misleading — Chris will think it's live when it isn't. |
| M16 | L708, L730 | **Newsletter: notification says "Auto-Sent" before send may have succeeded** | The notification at L708 says "Auto-sent to all subscribers" and the Telegram at L730 says "Newsletter Auto-Sent". But the actual send happens before this — if it fails, the code falls through to a catch block that saves as draft (L714). However, the Telegram at L730 fires regardless of success/failure because it's outside the try block. |

#### MINOR

| # | Line(s) | Issue |
|---|---------|-------|
| m18 | ~L396 | `calculate_next_run()` fortnightly logic has a TODO comment — the logic adds 14 days but doesn't account for timezone edge cases. |

---

### 12. `command_queue.py` — 426 lines

**Purpose:** Remote command queue — laptop triggers actions on PC Hub via GAS webhook.

#### CRITICAL

*None.*

#### MAJOR

| # | Line(s) | Issue | Detail |
|---|---------|-------|--------|
| M17 | ~L305–340 | **`post_to_facebook` command uses raw `self.db.conn.execute()` in command handler** | The Facebook posting command (L307) does `self.db.conn.execute("SELECT ... FROM blog_posts ...")` with `.fetchone()` — this bypasses the `_ensure_connected()` safety net and uses tuple indexing (`row[0]`, `row[1]`) instead of dict access, which will break if columns are reordered. |

#### MINOR

| # | Line(s) | Issue |
|---|---------|-------|
| m19 | — | Command types are not validated against an allowlist — any string is accepted as `cmd_type`. An attacker with access to GAS could queue arbitrary commands. |

---

### 13. `heartbeat.py` — 202 lines

**Purpose:** Periodic heartbeat POST to GAS every 2 minutes, peer status caching, version mismatch detection.

#### CRITICAL

*None.*

#### MAJOR

*None.*

#### MINOR

| # | Line(s) | Issue |
|---|---------|-------|
| m20 | — | Stale threshold is 5 minutes but heartbeat interval is 2 minutes — only 1 missed heartbeat before the peer is marked stale. Should be at least 3× the interval (6 min). |

---

### 14. `updater.py` — ~170 lines

**Purpose:** Auto-updater — git fetch + hard reset from GitHub.

#### CRITICAL

| # | Line(s) | Issue | Detail |
|---|---------|-------|--------|
| **C8** | L97, L102 | **`git reset --hard` + `git clean -fd` destroys all local state** | `_run_git("reset", "--hard", f"origin/{branch}")` followed by `_run_git("clean", "-fd")` — this permanently deletes any local file changes *and* removes untracked files. If the `.env` file or `ggm_hub.db` database is not in `.gitignore`, they are silently destroyed on every auto-update. There is no backup before the destructive operation. **Should stash local changes or at minimum backup `.env` and `data/` before reset.** |

#### MAJOR

*None.*

#### MINOR

| # | Line(s) | Issue |
|---|---------|-------|
| m21 | — | No integrity check after update — the new code is loaded without syntax verification. A broken push could take down the PC Hub. |

---

### 15. `auto_push.py` — ~170 lines

**Purpose:** Auto git push every 15 minutes from PC Hub.

#### CRITICAL

*None.*

#### MAJOR

| # | Line(s) | Issue | Detail |
|---|---------|-------|--------|
| M18 | ~L80 | **`git add -A` stages everything including secrets** | If `.gitignore` is incomplete (missing `.env`, `data/*.db`, API keys, local config), `git add -A` will push secrets to GitHub. Should use an explicit file list or at minimum validate `.gitignore` on startup. |

#### MINOR

| # | Line(s) | Issue |
|---|---------|-------|
| m22 | — | Conflict marker detection (`<<<<<<<`) is good but only checks tracked files — doesn't prevent pushing if a merge produced conflicts in untracked files. |

---

## Cross-Cutting Concerns

### Thread Safety

The application runs 6+ background daemon threads (sync, email automation, agents, heartbeat, command queue, auto-push) all sharing a single `Database` instance with `check_same_thread=False`. There is **no `threading.Lock`** around write operations. While SQLite's WAL mode allows concurrent reads, concurrent writes through a single connection are undefined behaviour. This is a ticking time bomb.

**Recommendation:** Add a `threading.RLock` to the `Database` class, acquired in `execute()` and `commit()`.

### Error Handling

Most modules use broad `except Exception: pass` blocks, especially in sync and email code. While this prevents crashes, it silently swallows real errors. Failed email sends, sync writes, and Supabase mirrors all log warnings but take no corrective action.

**Recommendation:** Implement a dead-letter queue for failed operations and surface them in the dashboard.

### GDPR Compliance

The email automation module has **good** GDPR safeguards:
- Opt-out checking before every send via `email_preferences` table
- Marketing vs. transactional email classification
- Owner email address blocking (won't email Chris as if he's a customer)
- Hour-gated sending windows (8am–8pm only)
- Daily cap (150 emails)
- Duplicate detection (lifetime for marketing, daily for transactional)

**Gap:** No data retention/deletion mechanism — there is no way to purge all data for a client who invokes their GDPR "right to be forgotten" in a single operation.

### Xero Integration Readiness Score: 2/10

The system is **not ready** for Xero integration. Missing:

1. No normalised line items table (invoices store JSON blobs)
2. No tax/VAT breakdown fields
3. No Xero contact/invoice/payment ID fields
4. No audit trail
5. No reconciliation table
6. No currency field
7. No payment method normalisation (free-text field)
8. Quotes lack terms, conditions, and deposit tracking is informal

---

## Priority Fix Order

### Immediate (Data Loss / Security Risk)

1. **C2/C6** — Replace destructive `DELETE FROM` sync with `sheets_row`-based upsert (like `upsert_clients()`)
2. **C5** — Add `threading.RLock` to Database class
3. **C8** — Backup `.env` and `data/` before `git reset --hard` in updater
4. **C1** — Move admin API key from query params to POST body/headers
5. **C3** — Validate column names against a whitelist in `save_*()` methods

### Short-Term (Correctness)

6. **M15/M16** — Fix misleading Telegram notifications in agents.py
7. **M7** — Route `fetchall()`/`fetchone()` through `_ensure_connected()`
8. **C4** — Parameterise `days` in `get_analytics_daily()`
9. **C7** — Track Ollama PID and kill only the specific process
10. **M14** — Send Gemini API key as header, not URL param

### Medium-Term (Accounting Prep)

11. **A1-A7** — Add `invoice_lines`, tax fields, Xero ID columns, audit trail table
12. **M6** — Implement a proper schema migration framework
13. **M5** — Add foreign key constraints on key relationships

---

## Summary Statistics

| File | Lines | Critical | Major | Minor | Acct |
|------|-------|----------|-------|-------|------|
| config.py | 469 | 0 | 2 | 3 | 0 |
| main.py | 519 | 0 | 1 | 2 | 0 |
| api.py | 160 | 1 | 1 | 1 | 0 |
| database.py | 3,745 | 4 | 4 | 3 | 7 |
| sync.py | 1,595 | 1 | 2 | 1 | 0 |
| email_automation.py | 1,582 | 0 | 1 | 1 | 0 |
| email_provider.py | 620 | 0 | 1 | 2 | 0 |
| email_templates.py | 799 | 0 | 0 | 1 | 1* |
| llm.py | 508 | 1 | 1 | 1 | 0 |
| content_writer.py | 1,524 | 0 | 0 | 2 | 0 |
| agents.py | 795 | 0 | 2 | 1 | 0 |
| command_queue.py | 426 | 0 | 1 | 1 | 0 |
| heartbeat.py | 202 | 0 | 0 | 1 | 0 |
| updater.py | 170 | 1 | 0 | 1 | 0 |
| auto_push.py | 170 | 0 | 1 | 1 | 0 |
| **TOTAL** | **~12,500** | **8** | **14** | **12** | **8** |

*A8 counted under email_templates.py

---

*End of Agent 1 Audit Report*
