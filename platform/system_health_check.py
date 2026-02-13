"""
GGM System Health Check — Invoice & Stripe Pipeline Diagnostic
Tests every stage of the invoice flow end-to-end.

Run:  python system_health_check.py
"""
import os, requests, json, time, sys, os

# Load from .env
try:
    from dotenv import load_dotenv
    from pathlib import Path
    for p in [Path(__file__).parent / ".env", Path(__file__).parent.parent / ".env",
              Path(r"C:\GGM-Hub\.env")]:
        if p.exists():
            load_dotenv(p)
            break
except ImportError:
    pass
WEBHOOK = os.getenv(
    "SHEETS_WEBHOOK",
    "https://script.google.com/macros/s/"
    "AKfycbx-q2qSeCorIEeXPE9d2MgAZLKEFwFNW9lARLE1yYciH9wJWwvktUTuDVLz_rSCbUhkMg/exec"
)
STRIPE_KEY = os.getenv("STRIPE_KEY", "")

PASS = "✅"
FAIL = "❌"
WARN = "⚠️"
INFO = "ℹ️"
results = []


def log(status, test, detail=""):
    results.append((status, test, detail))
    sym = {PASS: PASS, FAIL: FAIL, WARN: WARN, INFO: INFO}.get(status, "  ")
    print(f"  {sym} {test}" + (f" — {detail}" if detail else ""))


def test_gas_reachable():
    """Test 1: Can we reach Google Apps Script?"""
    print("\n── 1. Google Apps Script API ──")
    try:
        r = requests.get(f"{WEBHOOK}?action=get_finance_summary", timeout=20)
        if r.status_code == 200:
            data = r.json()
            if data.get("status") == "success":
                log(PASS, "GAS webhook reachable", f"HTTP 200, status=success")
                return True
            else:
                log(WARN, "GAS reachable but unexpected response", json.dumps(data)[:100])
                return True
        else:
            log(FAIL, "GAS returned error", f"HTTP {r.status_code}")
            return False
    except Exception as e:
        log(FAIL, "GAS unreachable", str(e))
        return False


def test_sheets_data():
    """Test 2: Are Google Sheets returning data?"""
    print("\n── 2. Google Sheets Data ──")
    endpoints = {
        "Jobs (get_clients)": ("get_clients", "clients"),
        "Invoices (get_invoices)": ("get_invoices", "invoices"),
        "Today's Jobs": ("get_todays_jobs", "jobs"),
        "Enquiries": ("get_enquiries", "enquiries"),
        "Finance Summary": ("get_finance_summary", None),
    }
    all_ok = True
    sheets_data = {}
    for label, (action, key) in endpoints.items():
        try:
            r = requests.get(f"{WEBHOOK}?action={action}", timeout=20)
            if r.status_code == 200:
                data = r.json()
                if key:
                    items = data.get(key, [])
                    log(PASS, label, f"{len(items)} record(s)")
                    sheets_data[action] = items
                else:
                    log(PASS, label, f"Response OK")
                    sheets_data[action] = data
            else:
                log(FAIL, label, f"HTTP {r.status_code}")
                all_ok = False
        except Exception as e:
            log(FAIL, label, str(e)[:80])
            all_ok = False
    return all_ok, sheets_data


def test_stripe_api():
    """Test 3: Is Stripe API accessible with our key?"""
    print("\n── 3. Stripe API ──")
    try:
        r = requests.get(
            "https://api.stripe.com/v1/balance",
            headers={"Authorization": f"Bearer {STRIPE_KEY}"},
            timeout=15
        )
        if r.status_code == 200:
            bal = r.json()
            available = sum(b["amount"] for b in bal.get("available", []))
            pending = sum(b["amount"] for b in bal.get("pending", []))
            log(PASS, "Stripe API key valid", f"Balance: £{available/100:,.2f} available, £{pending/100:,.2f} pending")
        elif r.status_code == 401:
            log(FAIL, "Stripe API key INVALID", "Authentication failed — key may be revoked")
            return False
        else:
            log(FAIL, "Stripe API error", f"HTTP {r.status_code}: {r.text[:100]}")
            return False
    except Exception as e:
        log(FAIL, "Stripe API unreachable", str(e))
        return False

    # Check recent customers
    try:
        r = requests.get(
            "https://api.stripe.com/v1/customers?limit=5",
            headers={"Authorization": f"Bearer {STRIPE_KEY}"},
            timeout=15
        )
        if r.status_code == 200:
            custs = r.json().get("data", [])
            log(PASS, "Stripe customers accessible", f"{len(custs)} recent customer(s)")
            for c in custs[:3]:
                log(INFO, f"  Customer: {c.get('name', '?')}", c.get("email", ""))
        else:
            log(WARN, "Could not list customers", f"HTTP {r.status_code}")
    except Exception as e:
        log(WARN, "Customer list check failed", str(e)[:80])

    # Check recent invoices on Stripe
    try:
        r = requests.get(
            "https://api.stripe.com/v1/invoices?limit=5",
            headers={"Authorization": f"Bearer {STRIPE_KEY}"},
            timeout=15
        )
        if r.status_code == 200:
            invs = r.json().get("data", [])
            log(PASS, "Stripe invoices accessible", f"{len(invs)} recent invoice(s)")
            for inv in invs[:3]:
                amt = inv.get("amount_due", 0) / 100
                status = inv.get("status", "?")
                email = inv.get("customer_email", "?")
                log(INFO, f"  Invoice: £{amt:.2f} → {status}", email)
        else:
            log(WARN, "Could not list invoices", f"HTTP {r.status_code}")
    except Exception as e:
        log(WARN, "Invoice list check failed", str(e)[:80])

    return True


def test_invoice_pipeline(sheets_data):
    """Test 4: Invoice data integrity — do invoices match jobs?"""
    print("\n── 4. Invoice Pipeline Integrity ──")
    invoices = sheets_data.get("get_invoices", [])
    clients = sheets_data.get("get_clients", [])

    if not invoices:
        log(WARN, "No invoices in sheet", "System has never invoiced — try completing a test job")
        return

    # Count by status
    statuses = {}
    for inv in invoices:
        s = str(inv.get("status", "Unknown"))
        statuses[s] = statuses.get(s, 0) + 1
    for s, count in sorted(statuses.items()):
        log(INFO, f"  {s}: {count} invoice(s)")

    # Check for invoices with Stripe ID
    with_stripe = [i for i in invoices if i.get("stripeInvoiceId")]
    without_stripe = [i for i in invoices if not i.get("stripeInvoiceId")]
    log(PASS if with_stripe else WARN,
        f"Invoices with Stripe ID: {len(with_stripe)}",
        f"{len(without_stripe)} without Stripe ID")

    # Check for invoices with payment URLs
    with_url = [i for i in invoices if i.get("paymentUrl")]
    log(PASS if with_url else WARN,
        f"Invoices with payment URL: {len(with_url)}")

    # Check for stale unpaid invoices
    from datetime import datetime, timedelta
    unpaid = [i for i in invoices
              if str(i.get("status", "")).lower() not in ("paid", "void")]
    old_unpaid = []
    for inv in unpaid:
        issued = str(inv.get("dateIssued", ""))
        if issued:
            try:
                issued_dt = datetime.fromisoformat(issued.replace("Z", "+00:00"))
                if (datetime.now(issued_dt.tzinfo) - issued_dt).days > 14:
                    old_unpaid.append(inv)
            except Exception:
                pass

    if old_unpaid:
        log(WARN, f"{len(old_unpaid)} unpaid invoice(s) overdue (>14 days)")
        for inv in old_unpaid[:3]:
            log(INFO, f"  {inv.get('invoiceNumber', '?')}: £{inv.get('amount', '?')}",
                f"{inv.get('clientName', '?')}")
    elif unpaid:
        log(INFO, f"{len(unpaid)} unpaid invoice(s) within payment window")
    else:
        log(PASS, "All invoices paid", "Nothing outstanding")

    # Cross-reference: do invoiced jobs have matching invoice records?
    invoiced_jobs = [c for c in clients
                     if str(c.get("paid", "")).lower() == "balance due"]
    job_nums_with_invoices = {str(i.get("jobNumber", "")) for i in invoices if i.get("jobNumber")}
    orphans = [j for j in invoiced_jobs
               if str(j.get("jobNumber", "")) not in job_nums_with_invoices]
    if orphans:
        log(WARN, f"{len(orphans)} job(s) marked 'Balance Due' with no matching invoice")
        for o in orphans[:3]:
            log(INFO, f"  {o.get('jobNumber', '?')}: {o.get('name', '?')}")
    else:
        log(PASS, "All 'Balance Due' jobs have matching invoices")


def test_stripe_webhook():
    """Test 5: Is the Stripe webhook configured?"""
    print("\n── 5. Stripe Webhook ──")
    try:
        r = requests.get(
            "https://api.stripe.com/v1/webhook_endpoints?limit=10",
            headers={"Authorization": f"Bearer {STRIPE_KEY}"},
            timeout=15
        )
        if r.status_code == 200:
            hooks = r.json().get("data", [])
            if not hooks:
                log(WARN, "No Stripe webhooks configured",
                    "Stripe won't notify GAS when payments come in!")
                log(INFO, "  Create webhook at: https://dashboard.stripe.com/webhooks")
                log(INFO, f"  Point to: {WEBHOOK}?action=stripe_webhook")
                log(INFO, "  Events: invoice.paid, invoice.payment_failed, checkout.session.completed")
                return False
            else:
                for wh in hooks:
                    url = wh.get("url", "")
                    status = wh.get("status", "?")
                    events = wh.get("enabled_events", [])
                    log(PASS if status == "enabled" else WARN,
                        f"Webhook → {url[:60]}...",
                        f"Status: {status}, {len(events)} event(s)")
                    # Check if it points to our GAS
                    if "macros" in url and "exec" in url:
                        log(PASS, "Webhook points to GAS")
                        has_invoice = any("invoice" in e for e in events)
                        if has_invoice:
                            log(PASS, "invoice.paid event enabled")
                        else:
                            log(WARN, "invoice.paid event NOT in webhook — payments won't auto-mark!")
                    else:
                        log(WARN, "Webhook does NOT point to GAS", url[:80])
                return True
        else:
            log(WARN, "Could not check webhooks", f"HTTP {r.status_code}")
            return False
    except Exception as e:
        log(FAIL, "Webhook check failed", str(e)[:80])
        return False


def test_email_sending():
    """Test 6: Can GAS send emails? (checks the email quota)"""
    print("\n── 6. Email Capability ──")
    try:
        r = requests.get(f"{WEBHOOK}?action=get_email_workflow_status", timeout=20)
        if r.status_code == 200:
            data = r.json()
            wf = data.get("workflow", data)
            log(PASS, "Email workflow endpoint responding")
            if isinstance(wf, dict):
                for k, v in list(wf.items())[:5]:
                    log(INFO, f"  {k}: {v}")
        else:
            log(WARN, "Email workflow check returned non-200", f"HTTP {r.status_code}")
    except Exception as e:
        log(WARN, "Email workflow check failed", str(e)[:80])


def test_telegram():
    """Test 7: Is Telegram notification working?"""
    print("\n── 7. Telegram Bot ──")
    TG_TOKEN = os.getenv("TG_BOT_TOKEN", "")
    TG_CHAT = os.getenv("TG_CHAT_ID", "")
    try:
        r = requests.get(f"https://api.telegram.org/bot{TG_TOKEN}/getMe", timeout=10)
        if r.status_code == 200:
            bot = r.json().get("result", {})
            log(PASS, f"DayBot online", f"@{bot.get('username', '?')}")
        else:
            log(FAIL, "DayBot not responding", f"HTTP {r.status_code}")
    except Exception as e:
        log(FAIL, "Telegram check failed", str(e)[:80])

    # Test MoneyBot too
    MB_TOKEN = os.getenv("TG_MONEY_TOKEN", "")
    try:
        r = requests.get(f"https://api.telegram.org/bot{MB_TOKEN}/getMe", timeout=10)
        if r.status_code == 200:
            bot = r.json().get("result", {})
            log(PASS, f"MoneyBot online", f"@{bot.get('username', '?')} (payment notifications)")
        else:
            log(WARN, "MoneyBot not responding", f"HTTP {r.status_code}")
    except Exception as e:
        log(WARN, "MoneyBot check failed", str(e)[:80])


# ═══════════════════════════════════════════════════
#  MAIN
# ═══════════════════════════════════════════════════
def main():
    print("=" * 62)
    print("  GGM SYSTEM HEALTH CHECK — Invoice & Stripe Pipeline")
    print("=" * 62)

    # Run all tests
    gas_ok = test_gas_reachable()
    if gas_ok:
        sheets_ok, sheets_data = test_sheets_data()
    else:
        sheets_ok, sheets_data = False, {}
        print("\n  ⏭️  Skipping sheet tests — GAS unreachable")

    stripe_ok = test_stripe_api()
    if gas_ok:
        test_invoice_pipeline(sheets_data)
    test_stripe_webhook()
    if gas_ok:
        test_email_sending()
    test_telegram()

    # Summary
    print("\n" + "=" * 62)
    passes = sum(1 for s, _, _ in results if s == PASS)
    fails = sum(1 for s, _, _ in results if s == FAIL)
    warns = sum(1 for s, _, _ in results if s == WARN)
    print(f"  RESULTS: {passes} passed, {warns} warnings, {fails} failures")

    if fails > 0:
        print(f"\n  🔴 CRITICAL ISSUES:")
        for s, t, d in results:
            if s == FAIL:
                print(f"     {FAIL} {t}: {d}")

    if warns > 0:
        print(f"\n  🟡 WARNINGS:")
        for s, t, d in results:
            if s == WARN:
                print(f"     {WARN} {t}: {d}")

    if fails == 0 and warns == 0:
        print(f"\n  🟢 ALL SYSTEMS OPERATIONAL")

    print("=" * 62)

    # Pipeline diagram
    print("\n  INVOICE PIPELINE FLOW:")
    print("  ┌─────────┐    ┌──────────┐    ┌────────────┐    ┌──────────┐")
    print("  │ Job Done │ →  │ Auto-Inv │ →  │ Stripe Inv │ →  │ Email    │")
    print("  │ (status) │    │ Created  │    │ Created    │    │ Sent     │")
    print("  └─────────┘    └──────────┘    └────────────┘    └──────────┘")
    print("       ↓                                                 ↓")
    print("  ┌─────────┐    ┌──────────┐    ┌────────────┐    ┌──────────┐")
    print("  │ Jobs     │    │ Invoices │    │ Stripe     │    │ Customer │")
    print("  │ Sheet    │    │ Sheet    │    │ Dashboard  │    │ Pays     │")
    print("  └─────────┘    └──────────┘    └────────────┘    └──────────┘")
    print("                                      ↓")
    print("                                ┌────────────┐    ┌──────────┐")
    print("                                │ Webhook    │ →  │ Auto     │")
    print("                                │ Fires      │    │ Mark Paid│")
    print("                                └────────────┘    └──────────┘")
    print()


if __name__ == "__main__":
    main()
