# SEO + Security Audit — February 2026

## Summary

Full SEO and security audit of gardnersgm.co.uk to UK standards (GDPR, PECR).  
Commit: `0c59ba9` | GAS version: v138+

---

## SEO Fixes

| Fix | Scope |
|-----|-------|
| `lang="en-GB"` | All 66 HTML files |
| `og:locale` content="en_GB" | 14 public pages |
| `<meta name="author">` | 14 public pages |
| Twitter card type fix (`summary` → `summary_large_image`) | complaints.html |
| Title separator fix (`\|` → `—`) | areas.html |
| Keyword-stuffed meta tag removed | index.html |
| Duplicate BreadcrumbList removed | index.html |
| AggregateRating schema added | testimonials.html |
| ContactPage schema added | contact.html |
| BreadcrumbList schema added | complaints.html |
| `robots.txt` expanded | Blocks /platform/, /agents/, /admin/, /apps-script/, /gas/, /docker/, /n8n/, /mobile/, /listmonk/, admin JS |
| `sitemap.xml` updated | Added fence-repair.html + emergency-tree.html |

## Security Fixes

| Fix | Severity | Detail |
|-----|----------|--------|
| Content-Security-Policy | Medium | Meta tag on all HTML files |
| X-Frame-Options DENY | Medium | Prevents clickjacking on all pages |
| Referrer-Policy strict-origin-when-cross-origin | Low | On all pages |
| XSS fix in chatbot | High | `addMessage()` uses `textContent` for user input instead of `innerHTML` |
| Admin PIN comment removed | Critical | Plaintext PIN `2383` was visible in admin-auth.js comment |
| cancel.html data leak | Critical | Changed from `get_clients` (exposed ALL client data) to `get_job_for_reschedule` (returns single job only) |
| Cookie consent banner | Medium | UK PECR/GDPR — `js/cookie-consent.js` with Accept/Reject, analytics only after consent |
| GAS API auth layer | Critical | Admin endpoints gated by `ADMIN_API_KEY` — see below |

---

## GAS API Auth Layer

### How it works

1. **Admin PIN gate** — User enters PIN on admin pages (client-side, `admin-auth.js`)
2. **Token exchange** — After PIN verify, JS calls `admin_login` action on GAS, which validates the PIN hash server-side and returns the `ADMIN_API_KEY`
3. **Fetch interceptor** — `admin-auth.js` patches `window.fetch()` to auto-inject `adminToken` into all GAS requests (GET params + POST body)
4. **GAS auth gate** — `doPost()` and `doGet()` check `ADMIN_POST_ACTIONS` / `ADMIN_GET_ACTIONS` arrays, reject requests without valid token

### Protected endpoints

**POST (admin-only):** `create_quote`, `update_quote`, `save_blog_post`, `delete_blog_post`, `send_newsletter`, `cleanup_test_data`, `send_completion_email`, `stripe_invoice`, `mark_invoice_paid`, `relay_telegram`, `process_email_lifecycle`, `run_financial_dashboard`, + more

**GET (admin-only):** `get_clients`, `get_invoices`, `get_business_costs`, `get_subscribers`, `get_newsletters`, `get_complaints`, `get_enquiries`, `get_site_analytics`, `get_remote_commands`, `get_telegram_updates`, `get_payment_flow`, + more

**Public (no token needed):** `get_blog_posts`, `get_testimonials`, `get_products`, `get_vacancies`, `check_availability`, `get_busy_dates`, `get_pricing_config`, `service_enquiry`, `booking_payment`, `subscribe_newsletter`, `track_pageview`

### Files modified

| File | Change |
|------|--------|
| `apps-script/Code.gs` | `validateAdminAuth()`, `handleAdminLogin()`, `ADMIN_POST_ACTIONS`, `ADMIN_GET_ACTIONS` lists, auth gates in `doPost/doGet` |
| `js/admin-auth.js` | Token exchange after PIN, `setupAdminFetchInterceptor()` patches all `fetch()` calls |
| `platform/app/api.py` | Auto-injects `adminToken` into GET params and POST body |
| `platform/app/config.py` | Added `ADMIN_API_KEY` from `.env` |
| `agents/lib/shared.js` | `apiFetch()` and `apiPost()` auto-inject `adminToken` |

---

## Deployment Checklist

After GAS redeployment:

- [x] Set `ADMIN_PIN_HASH` in GAS Script Properties (SHA-256 of the 4-digit PIN)
- [x] Run `setupAdminApiKey()` in Apps Script editor to store the key
- [x] Replace key value with `'DONE'` in Code.gs after running
- [x] Redeploy GAS (Manage Deployments → Edit → New version → Deploy)
- [x] Add `ADMIN_API_KEY=ggm_...` to laptop `.env` files
- [ ] Add `ADMIN_API_KEY=ggm_...` to PC Hub `.env` files (`C:\GGM-Hub\.env` + `C:\GGM-Hub\platform\.env`)

## Verified Working

| Test | Result |
|------|--------|
| `get_clients` without token | `auth_required` — blocked |
| `get_clients` with token | `success` — data returned |
| `get_testimonials` (public) | Data returned — not blocked |

---

## Known Limitations (GitHub Pages architecture)

- **Client-side admin auth** — PIN gate is bypassable via browser DevTools. The GAS API key gate is the real protection layer (data never leaves GAS without the key).
- **No server-side sessions** — Static site can't do real sessions. `sessionStorage` + fetch interceptor is the best we can do.
- **CSRF** — No CSRF tokens possible without a server. The API key acts as a shared secret instead.
- **localStorage data** — Client data cached in localStorage is unencrypted. This is an architectural constraint of static hosting.
