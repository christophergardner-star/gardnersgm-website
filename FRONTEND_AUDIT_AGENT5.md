# GGM Hub — Frontend Audit Report (Agent 5 of 7)

**Domain:** Website Frontend — HTML pages, JavaScript, CSS, SEO, Security  
**Date:** 22 February 2026  
**Auditor:** Agent 5 (Enterprise Audit)  
**Status:** COMPLETE

---

## Executive Summary

The GGM website frontend is **surprisingly mature for a startup gardening business**. Strong CSP headers, proper `noindex` on admin pages, good structured data, and a well-built booking flow. However, there are **23 critical/high issues** and **31 medium/low issues** that need addressing for enterprise readiness.

| Severity | Count | Category |
|----------|-------|----------|
| **CRITICAL** | 5 | Security, data exposure, financial |
| **HIGH** | 18 | Bugs, XSS, SEO, accessibility |
| **MEDIUM** | 19 | Performance, UX, consistency |
| **LOW** | 12 | Polish, best practices |

---

## 1. CRITICAL ISSUES

### CRIT-01: Bank Account Details Hardcoded in Client-Side JS
- **File:** `js/invoice.js` lines 20–22
- **Issue:** Sort code `04-00-03`, account number `39873874`, and account name are hardcoded in plain JavaScript accessible to any browser. While this is an admin-auth-gated page, the JS file itself is publicly downloadable at `gardnersgm.co.uk/js/invoice.js`.
- **Risk:** Bank account details exposed to anyone visiting the URL directly. Combined with the business name/address (also in the file), this gives a social engineering vector.
- **Fix:** Move bank details to server-side (GAS) and fetch them only after admin auth is verified. Alternatively, serve admin JS files from a `/admin/` path that returns 403 without auth.

### CRIT-02: Admin PIN Hash Hardcoded in Client-Side JS
- **File:** `js/admin-auth.js` line 177
- **Issue:** The SHA-256 hash of the 4-digit admin PIN (`8f5c5451afb17f9...`) is embedded directly in the client-side JavaScript. A 4-digit PIN has only 10,000 possible combinations — this hash can be brute-forced in milliseconds.
- **Risk:** Anyone can extract the PIN by running a SHA-256 rainbow table attack against digits 0000–9999. This gives full access to the admin dashboard, invoicing, customer data, and financial data.
- **Fix:** Move PIN verification entirely to server-side (GAS). The client should send the PIN/hash to GAS, which responds with a session token. Never include the expected hash in client code.

### CRIT-03: Invoice Counter Stored in localStorage
- **File:** `js/invoice.js` lines 56–62
- **Issue:** Invoice numbering (`GGM-0001`, `GGM-0002` etc.) is auto-incremented from `localStorage`. This means:
  1. Different browsers/devices will generate duplicate invoice numbers
  2. Clearing browser data resets the counter to 0
  3. No collision detection
- **Risk:** Duplicate invoice numbers sent to customers. HMRC compliance requires unique, sequential invoicing for tax purposes.
- **Fix:** Generate invoice numbers server-side (GAS) with an atomic counter stored in Google Sheets.

### CRIT-04: Shop Stripe Payment — No Server-Side Amount Validation
- **File:** `js/shop.js` lines 350–400
- **Issue:** The shop checkout sends `items: [{id, qty}]` to GAS, but the cart total is calculated entirely client-side. If the GAS backend doesn't independently recalculate the payment amount from product prices in the database, a malicious user could modify the cart totals in the browser and pay less.
- **Risk:** Financial loss — customers could manipulate prices.
- **Fix:** Ensure `shop_checkout` GAS handler recalculates totals from the Products sheet, ignoring any client-side total.

### CRIT-05: Stripe Publishable Key is Live in Production
- **Files:** `js/shop.js` line 6, `js/subscribe.js` line 11
- **Issue:** `pk_live_51RZrhDCI9zZ...` is the live Stripe publishable key. While publishable keys are _designed_ to be public, having the same key in both shop and subscribe pages means there's no separation between production and testing environments.
- **Risk:** If any test code accidentally uses this key, it could create real charges. The key is also exposed in the Git repository history. **Note: This is lower risk than a secret key — Stripe publishable keys are safe to expose. Reclassify to MEDIUM if GAS validates amounts server-side.**
- **Fix:** Consider environment-based key selection. Ensure no `sk_live` keys appear anywhere in frontend code (confirmed: they don't — good).

---

## 2. HIGH ISSUES

### HIGH-01: Duplicate FAQ Question in Structured Data
- **File:** `index.html` lines 153 and 177
- **Issue:** The FAQ schema has "What gardening services do you offer in Cornwall?" listed **twice** with different answers. Google may flag this as duplicate/spammy structured data and penalise the page.
- **Fix:** Remove the duplicate FAQ entry, keeping the better answer.

### HIGH-02: Homepage Claims "10 Core Services" — Only 3 Active
- **File:** `index.html` line 509
- **Issue:** The stats counter says `data-target="10"` (10 Core Services), but only 3 services are currently offered (lawn cutting, hedge trimming, garden clearance). This is misleading to customers.
- **Fix:** Update to `data-target="3"` or whatever the current active count is.

### HIGH-03: Sitemap Lists Hidden/Disabled Service Pages
- **File:** `sitemap.xml` lines 99–150
- **Issue:** The sitemap includes pages for services that are hidden on the site: `scarifying.html`, `lawn-treatment.html`, `power-washing.html`, `veg-patch.html`, `weeding-treatment.html`, `drain-clearance.html`, `gutter-cleaning.html`, `fence-repair.html`, `emergency-tree.html`. Google will crawl and index these pages even though they're not linked from the main site.
- **Risk:** Users arriving from Google will find pages for services not currently offered, creating confusion and potential complaints.
- **Fix:** Remove hidden service pages from sitemap, or add a clear "Coming Soon" banner on those pages and set `<meta name="robots" content="noindex">`.

### HIGH-04: BreadcrumbList Schema Contains All Pages as Siblings
- **File:** `index.html` lines 227–240
- **Issue:** The BreadcrumbList has positions 1–7 all as top-level siblings (Home, Services, Get a Quote, About, Contact, Blog, Testimonials). BreadcrumbList should represent a hierarchical path, not a flat navigation. Google may show incorrect breadcrumbs.
- **Fix:** Keep only one BreadcrumbList per page showing the actual hierarchy path, e.g., `Home > Services` or `Home > Blog`.

### HIGH-05: Chatbot Bot Messages Rendered as Raw HTML (Stored XSS Risk)
- **File:** `js/chatbot.js` line 1109
- **Issue:** Bot responses use `innerHTML` with trusted HTML (links etc.), which is intentional. However, if the Dify AI chatbot is enabled (`DIFY_API_URL` is set) and returns malicious HTML from the AI response, it would be injected directly into the DOM.
- **Risk:** If the AI backend is compromised, it becomes a stored XSS vector.
- **Fix:** Sanitize bot responses through a whitelist-based HTML sanitizer (allow `<a>`, `<strong>`, `<br>`, `<em>` only). The chatbot already escapes user input correctly (line 1113 uses `textContent`).

### HIGH-06: `manager.html` Redirects to `admin.html` But Still Loads Full Page
- **File:** `manager.html` line 10
- **Issue:** Has `<meta http-equiv="refresh" content="0;url=admin.html">` but also loads the full manager dashboard with all its JS/CSS. The meta refresh only works after the page starts loading, meaning the browser downloads all manager resources before redirecting.
- **Fix:** Either remove manager.html entirely and update all links, or make it a minimal redirect-only page with no heavy assets.

### HIGH-07: `stripe-apps-script.js` Contains Server-Side Code in Public JS
- **File:** `js/stripe-apps-script.js`
- **Issue:** This file contains Google Apps Script server-side code (uses `PropertiesService`, `SpreadsheetApp`, `UrlFetchApp`) but is served as a client-side JS file. While it's labelled as "paste into Apps Script", it's publicly accessible and includes the Stripe secret key retrieval pattern.
- **Risk:** Confusing to developers, and if someone includes this file via `<script>` tag, it will throw errors (no `PropertiesService` in browsers). It also documents the full API routing structure for an attacker.
- **Fix:** Move to `apps-script/` or `docs/` directory. Add to `robots.txt` disallow. Or just remove it from the web root.

### HIGH-08: No Rate Limiting on Form Submissions
- **Files:** Booking form, contact form, newsletter signup, complaints form
- **Issue:** All forms submit to the same GAS webhook without any client-side rate limiting. A bot could submit thousands of fake enquiries, newsletter signups, or complaints.
- **Risk:** Spam flooding, Google Sheets quota exhaustion.
- **Fix:** Add client-side debouncing (already partially done with the honeypot `botcheck` checkbox in booking). Also add server-side rate limiting in GAS (per IP/email).

### HIGH-09: Honeypot Field Not Validated Server-Side
- **File:** `booking.html` line 110
- **Issue:** There's a hidden checkbox `<input type="checkbox" name="botcheck" style="display: none;">` as a bot trap. But there's no evidence this is checked in `js/booking.js` or GAS before processing the submission.
- **Fix:** Verify in booking.js that if `botcheck` is checked (by bots that fill all fields), the form silently "succeeds" without submitting data.

### HIGH-10: Address Lookup Uses Test API Key
- **File:** `js/address-lookup.js` line 13
- **Issue:** `IDEAL_API_KEY = 'ak_test'` — this is a test key that only works with limited test postcodes (like `ID1 1QD`). In production, real customers' postcodes will fail the Ideal Postcodes lookup and fall back to postcodes.io, which only returns area-level data (no street addresses).
- **Risk:** Poor UX — customers can't auto-fill their address. The fallback works but provides a degraded experience.
- **Fix:** Purchase a production Ideal Postcodes key, or clearly indicate in the UI that manual address entry is the primary flow.

### HIGH-11: Cookie Consent Loads Analytics.js Before Consent
- **Files:** `js/cookie-consent.js`, multiple HTML pages
- **Issue:** `analytics.js` is included as a `<script>` tag directly in HTML on several pages (booking.html, shop.html). This means it loads and executes (sending pageview data to GAS) **before** the cookie consent banner is shown. The consent banner controls Google Analytics loading but not the custom analytics.
- **Risk:** GDPR/PECR violation — tracking before consent.
- **Fix:** Either make `analytics.js` conditional on consent, or determine it doesn't count as "tracking" since it collects no PII and uses no cookies (the file header says "no cookies, no fingerprinting, no PII" — but it tracks screen resolution, language, and referrer which some regulators consider tracking).

### HIGH-12: No CSRF Protection on Form Submissions
- **All forms**
- **Issue:** POST requests to the GAS webhook use `Content-Type: text/plain` with JSON body. There's no CSRF token. Any third-party site could submit fake bookings/enquiries by posting to the public GAS URL.
- **Fix:** Add a nonce-based CSRF token generated per session, verified in GAS.

### HIGH-13: `subscribe.html` Still in Sitemap Despite Being Hidden
- **File:** `sitemap.xml` line 55
- **Issue:** `subscribe.html` is listed in the sitemap but subscription links are commented out with `<!-- HIDDEN -->` across the site. The page is probably not functional.
- **Fix:** Remove from sitemap or add noindex.

### HIGH-14: Missing `<main>` Landmark on Admin Pages
- **Files:** `admin.html`, `finance.html`, `invoices.html`
- **Issue:** Admin pages lack a `<main>` element. Screen readers won't be able to navigate to the main content area.
- **Fix:** Wrap the primary content in `<main>`.

### HIGH-15: Footer Social Link — Twitter/X Inconsistency
- **Files:** Various HTML pages
- **Issue:** Index and booking pages use `fa-twitter` icon for the X (Twitter) link, while shop.html uses `fa-x-twitter`. The link goes to `x.com/GmG84409` — the icon should match the current branding.
- **Fix:** Standardise to `fa-x-twitter` across all pages.

### HIGH-16: Blog Posts Rendered with Raw HTML Content
- **File:** `js/blog.js` lines 83–100
- **Issue:** Blog post content from Google Sheets is rendered via `innerHTML`. If an AI agent generates blog content with injected scripts or a GAS vulnerability allows HTML injection, this becomes an XSS vector affecting all visitors.
- **Fix:** Sanitize blog HTML before rendering — strip `<script>`, `onclick`, `onerror` attributes.

### HIGH-17: `onerror` Handlers on Image Tags Could Be Exploited
- **File:** `index.html` (multiple), `services.html` (multiple)
- **Issue:** Images like `<img ... onerror="this.onerror=null;this.src='images/general/about-gardener.jpg';">` use inline `onerror` handlers. While these are self-authored and safe, they require `'unsafe-inline'` in the CSP script-src, which weakens the Content Security Policy.
- **Fix:** Replace inline `onerror` with a global error handler or CSS-based fallback.

### HIGH-18: No `<noscript>` Fallback Anywhere
- **All pages**
- **Issue:** The entire site is non-functional without JavaScript. No `<noscript>` message warns users. Booking form, blog, shop — all require JS.
- **Fix:** Add `<noscript>` with a message and phone number for critical pages (booking, contact).

---

## 3. MEDIUM ISSUES

### MED-01: `unsafe-inline` in Content Security Policy
- **All pages**
- **Issue:** All CSP headers include `'unsafe-inline'` for both `script-src` and `style-src`. This significantly weakens the XSS protection that CSP provides.
- **Fix:** Long-term, move inline scripts to external files and use nonce-based CSP. For styles, `'unsafe-inline'` is often necessary.

### MED-02: No Subresource Integrity (SRI) on CDN Scripts
- **All pages**
- **Issue:** External CDN scripts (Font Awesome, SheetJS, Flatpickr, jsPDF) are loaded without `integrity` attributes. If a CDN is compromised, malicious code could be injected.
- **Fix:** Add SRI hashes: `<script src="..." integrity="sha384-..." crossorigin="anonymous">`.

### MED-03: Hero Image Not Lazy-Loaded (LCP Concern)
- **File:** `index.html` line 284
- **Issue:** Hero background images are set via inline `style="background-image: ..."` which means they can't use `loading="lazy"`. However, since it's the first-paint element, it should be **preloaded** instead.
- **Fix:** Add `<link rel="preload" as="image" href="images/hero/cornwall-coast-hero.jpg">` in `<head>`.

### MED-04: Fonts Not Preloaded
- **All pages**
- **Issue:** `fonts.googleapis.com` uses `<link rel="preconnect">` (good) but the actual font files should also be preloaded for faster text rendering.
- **Fix:** Add `<link rel="preload" as="font" ...>` for the primary Poppins weights used.

### MED-05: No Image Optimisation Strategy
- **All pages**
- **Issue:** Some images use `.jpg`, some `.webp`. No `<picture>` elements with WebP/AVIF fallbacks. No defined max dimensions for uploaded images.
- **Fix:** Convert all images to WebP with JPEG fallback using `<picture>` elements. Set max-width in CSS for all images.

### MED-06: Multiple `main.js` Loads on Single Pages
- **File:** `booking.html`
- **Issue:** `main.js` is loaded once (line 816). `chatbot.js` is also loaded (contributes 1,433 lines of JS). `newsletter.js` auto-injects a section. On a single booking page, the customer loads: main.js + site-banner.js + distance.js + address-lookup.js + booking.js + chatbot.js + newsletter.js + analytics.js + cookie-consent.js = **9 JavaScript files**.
- **Fix:** Bundle related scripts or implement code splitting. At minimum, defer non-critical scripts.

### MED-07: `localStorage` Used for Sensitive Session Data
- **Files:** `js/portal.js` line 22, `js/admin.js` line 19
- **Issue:** Customer portal session tokens stored in `localStorage` are accessible to all JS on the page (including CDN scripts). Admin client data also stored in `localStorage`.
- **Fix:** Use `sessionStorage` for portal tokens (already done for admin PIN), or set HttpOnly cookies via GAS.

### MED-08: Shop "Under Construction" Banner on Live Page
- **File:** `shop.html` line 126
- **Issue:** The shop page shows "Shop launching soon — products being added!" but is listed in the sitemap and linked from nav (hidden via comments in most pages but not all).
- **Fix:** Either launch the shop or remove it from the sitemap and ensure all links are hidden.

### MED-09: Missing Error Boundaries in JS
- **Multiple JS files**
- **Issue:** If one script fails (e.g., `chatbot.js` throws during init), it could block subsequent inline scripts on the same page. Most scripts are wrapped in IIFEs or DOMContentLoaded, which helps, but there's no global error handler.
- **Fix:** Add `window.onerror` handler that logs errors to GAS for monitoring.

### MED-10: Contact Form Missing Bot Protection
- **File:** `contact.html`
- **Issue:** Contact form has no honeypot field like the booking form does.
- **Fix:** Add a hidden honeypot field.

### MED-11: Footer Copyright Not Dynamic
- **All pages**
- **Issue:** Footer says `© 2026 Gardners Ground Maintenance` — hardcoded. Will need manual updates each year.
- **Fix:** Use `new Date().getFullYear()` via JS to auto-update.

### MED-12: No 404 Error Page
- **Workspace**
- **Issue:** No `404.html` found. If hosting on GitHub Pages, the default 404 will show. On a custom server, broken links will show an ugly default error.
- **Fix:** Create a branded 404 page with navigation back to the homepage.

### MED-13: Blog Modal Accessibility — Focus Trap Missing
- **File:** `js/blog.js`
- **Issue:** Blog post modal opens but doesn't trap focus or add `role="dialog"` / `aria-modal="true"`. Users on screen readers or keyboard navigation can tab behind the modal.
- **Fix:** Add proper ARIA attributes and a focus trap.

### MED-14: Admin Dashboard Mobile Usability
- **File:** `admin.html`
- **Issue:** Admin tab bar has 11 tabs in a horizontal scroll. On mobile, many tabs are hidden off-screen with no visual indicator to scroll.
- **Fix:** Add scroll indicators or collapse into a dropdown on mobile.

### MED-15: Time Slot Accessibility
- **File:** `booking.html`
- **Issue:** Time slots are `<div>` elements with click handlers, not `<button>` elements. They're not keyboard-focusable and lack `role="button"` or `tabindex`.
- **Fix:** Convert to `<button>` elements or add `role="button"` + `tabindex="0"` + keyboard event handlers.

### MED-16: Missing `aria-label` on Icon-Only Buttons
- **Files:** Cart drawer close button (`shop.html`), various admin action buttons
- **Issue:** Buttons like `<button class="cart-close" onclick="toggleCart()"><i class="fas fa-times"></i></button>` have no accessible label.
- **Fix:** Add `aria-label="Close cart"` etc.

### MED-17: `document.write` Style Maintenance Mode
- **File:** `js/main.js` lines 18–59
- **Issue:** Maintenance mode replaces the entire `documentElement.innerHTML`, which is destructive and could cause issues with already-parsed scripts.
- **Fix:** Use a DOM overlay instead of replacing the entire document.

### MED-18: CSS File Size — style.css is 4700+ Lines
- **File:** `css/style.css`
- **Issue:** Single monolithic CSS file with 4700+ lines covering all pages. Many styles are page-specific (invoice, admin, booking) but loaded on every page.
- **Fix:** Split into `common.css` + page-specific CSS files. Only load what's needed.

### MED-19: Potential Memory Leak — Chatbot Reply Polling
- **File:** `js/chatbot.js` lines 1143–1155
- **Issue:** Reply polling interval (4s) with a 15-minute timeout. If a user navigates away via an SPA-like flow (they won't on this static site) the interval continues. Minor concern for this architecture.
- **Fix:** Clear intervals on page unload: `window.addEventListener('beforeunload', stopReplyPolling)`.

---

## 4. LOW ISSUES

### LOW-01: Inconsistent `esc()` Function Implementations
- **Multiple JS files**
- **Issue:** 13 separate implementations of HTML escaping functions across different files. Some called `esc()`, some `escapeHtml()`, some `escH()`.
- **Fix:** Create one shared utility file (`js/utils.js`) with a single escape function.

### LOW-02: `console.log` Statements in Production
- **Multiple JS files**
- **Issue:** Numerous `console.log` statements remain (e.g., `[Calendar] Failsafe`, `[Pricing] Dynamic minimums`, `[AddrFailsafe]`).
- **Fix:** Strip or wrap in `if (DEBUG)` guard.

### LOW-03: No `rel="noopener noreferrer"` Consistency
- **Some links**
- **Issue:** External links mostly have `rel="noopener"` but some miss `noreferrer`. This is minor on modern browsers.
- **Fix:** Standardise to `rel="noopener noreferrer"` on all `target="_blank"` links.

### LOW-04: Unused Variable — `lastScroll`
- **File:** `js/main.js` line 101
- **Issue:** `lastScroll` is set but never read.
- **Fix:** Remove.

### LOW-05: Multiple Identical Failsafe Scripts in booking.html
- **File:** `booking.html`
- **Issue:** The page has 4 inline `<script>` blocks as failsafes (calendar init, photo upload, form submit, address lookup). While they provide robustness, they create significant code duplication and maintenance burden.
- **Fix:** Consolidate into a single `booking-failsafe.js` file.

### LOW-06: No Print Stylesheet
- **Public pages**
- **Issue:** No `@media print` styles. Printing the invoice preview or booking confirmation will include nav/footer.
- **Fix:** Add print styles that hide nav, footer, chat widget.

### LOW-07: Version Caching Inconsistent
- **Various pages**
- **Issue:** Some scripts use cache-busting (`booking.js?v=20260220a`, `address-lookup.js?v=20260218d`) but most don't (main.js, chatbot.js, admin.js). This means browser caching will serve stale versions after updates.
- **Fix:** Add version query strings to all JS/CSS files, or implement a build step.

### LOW-08: Google Maps URL in `subscribe.js` Not Used
- **File:** `js/subscribe.js` line 439
- **Issue:** `result.googleMapsUrl` is rendered as a link but link target opens in a new tab with no `rel="noopener"`.
- **Fix:** Add `rel="noopener noreferrer"`.

### LOW-09: Shop Product Image `onerror` Uses String Concatenation
- **File:** `js/shop.js` line 124
- **Issue:** `onerror="this.outerHTML='<div ...>'"` is complex inline JS. Could fail on special characters in product names.
- **Fix:** Use a simpler fallback mechanism.

### LOW-10: `blog-editor.html` Referenced But Not Audited
- **Exists but not in audit scope**
- **Issue:** Blog editor is an admin page that allows creating/editing posts with rich HTML content. Potential for stored XSS if not sanitised.
- **Fix:** Ensure all blog content is sanitised before storage and rendering.

### LOW-11: No Service Worker / PWA Support
- **All pages**
- **Issue:** No service worker for offline support. For a field-based business, the mobile website could benefit from offline booking forms.
- **Fix:** Consider adding a basic service worker for offline fallback.

### LOW-12: No Web Manifest
- **All pages**
- **Issue:** No `manifest.json` / `site.webmanifest` for PWA-like experience on mobile (icon, splash screen, theme colour).
- **Fix:** Add a web manifest for better mobile experience.

---

## 5. FINANCIAL PAGES ASSESSMENT

### Invoice System (`invoice.html` + `js/invoice.js`)
| Feature | Status | Notes |
|---------|--------|-------|
| Invoice creation | ✅ Working | Line items, discounts, notes |
| Auto-numbering | ⚠️ CLIENT-SIDE | localStorage — CRIT-03 |
| Stripe integration | ✅ Working | Toggle for Stripe vs bank transfer |
| PDF generation | ✅ Working | jsPDF with auto-table |
| Client pre-fill | ✅ Working | From bookings data via GAS |
| Bank details display | ⚠️ EXPOSED | CRIT-01 — visible in JS source |
| Invoice history | ⚠️ LOCAL | localStorage only — no cross-device sync |
| Print/download | ✅ Working | PDF download button |

### Invoice Ledger (`invoices.html`)
| Feature | Status | Notes |
|---------|--------|-------|
| Ledger view | ✅ Working | Full tabular view with filters |
| Tax year filtering | ✅ Working | Dropdown for tax year selection |
| Summary cards | ✅ Working | Paid, outstanding, overdue totals |
| Sorting | ✅ Working | Column-based sorting |
| Search | ✅ Working | Text search across fields |
| Auth-gated | ✅ Working | admin-auth.js PIN gate |

### Finance Dashboard (`finance.html` + `js/finance-ui.js`)
| Feature | Status | Notes |
|---------|--------|-------|
| Revenue cards | ✅ Working | Today, week, month, YTD |
| Pay yourself calc | ✅ Working | Tax + NI + costs deduction |
| Profit gauge | ✅ Working | SVG gauge with percentage |
| Savings pots | ✅ Working | Visual pot recommendations |
| Cost breakdown | ✅ Working | Per-service cost analysis |
| Dynamic pricing | ✅ Working | Live minimum price table |
| Auth-gated | ✅ Working | admin-auth.js PIN gate |

**Verdict:** Financial pages are well-built and feature-rich. Main concerns are CRIT-01 (bank details exposure) and CRIT-03 (invoice numbering). Fix these two and the financial system is production-ready.

---

## 6. STRIPE INTEGRATION ASSESSMENT

| Check | Status | Notes |
|-------|--------|-------|
| Publishable key only (no secret in frontend) | ✅ PASS | `pk_live_...` only. Secret is in GAS PropertiesService |
| Payment intents (not charges API) | ✅ PASS | Uses `createPaymentMethod` → server-side processing |
| 3D Secure / SCA support | ✅ PASS | `confirmCardPayment` handles SCA challenges |
| Apple Pay / Google Pay | ✅ PASS | `paymentRequestButton` implemented in shop |
| Client-side amount validation | ⚠️ NEEDS CHECK | CRIT-04 — verify server recalculates |
| PCI compliance | ✅ PASS | Stripe Elements used (no raw card handling) |
| Error handling | ✅ PASS | Stripe errors displayed to user |
| CSP allows Stripe | ✅ PASS | `js.stripe.com`, `api.stripe.com` in CSP |

**Verdict:** Stripe integration is secure and well-implemented. Only concern is CRIT-04 (server-side total validation).

---

## 7. SEO ASSESSMENT

| Check | Status | Notes |
|-------|--------|-------|
| Meta descriptions | ✅ All key pages | Well-written, keyword-rich |
| Open Graph tags | ✅ All pages | Title, desc, image, URL |
| Twitter cards | ✅ All pages | Summary_large_image |
| JSON-LD structured data | ✅ Excellent | LocalBusiness, FAQPage, BreadcrumbList, Service, ContactPage |
| Canonical URLs | ✅ All public pages | Correct canonical links |
| Robots meta | ✅ Correct | Admin: noindex, Public: index,follow |
| Sitemap | ⚠️ Issues | HIGH-03 — includes hidden service pages |
| robots.txt | ✅ Good | Blocks admin pages, has crawl-delay |
| Mobile viewport | ✅ All pages | `width=device-width, initial-scale=1.0` |
| lang attribute | ✅ `en-GB` | Correct for UK business |
| Geo meta tags | ✅ Homepage | Geo coordinates for Cornwall |
| Duplicate FAQ | ⚠️ HIGH-01 | Same question twice in FAQ schema |
| Service count mismatch | ⚠️ HIGH-02 | Says 10 services, only 3 active |

**SEO Score: 8/10** — Excellent foundation with a few fixable issues.

---

## 8. ACCESSIBILITY ASSESSMENT

| Check | Status | Notes |
|-------|--------|-------|
| Image alt text | ✅ Good | All images have descriptive alt text |
| Hamburger aria-label | ✅ Present | `aria-label="Toggle navigation"` |
| Focus styles | ⚠️ Partial | Input focus visible, but not on all interactive elements |
| `<main>` landmark | ⚠️ Missing on admin | HIGH-14 |
| `<noscript>` fallback | ❌ Missing | HIGH-18 |
| Form labels | ✅ Good | All form inputs have labels |
| Time slots keyboard | ⚠️ Not focusable | MED-15 |
| Blog modal focus trap | ⚠️ Missing | MED-13 |
| Icon button labels | ⚠️ Missing some | MED-16 |
| Cookie consent ARIA | ✅ Has `role="dialog"` | Good |
| Skip-to-content link | ❌ Missing | Should add for keyboard users |
| Colour contrast | ✅ Good | Green on white passes WCAG AA |

**Accessibility Score: 6/10** — Good for a small business site, but needs work for enterprise compliance.

---

## 9. MOBILE RESPONSIVENESS

| Check | Status | Notes |
|-------|--------|-------|
| Viewport meta | ✅ All pages | Correct |
| Hamburger menu | ✅ Working | Toggles nav, locks body scroll |
| Responsive grid | ✅ Good | CSS Grid + media queries throughout |
| Touch targets | ✅ Adequate | Buttons have sufficient padding |
| Form usability on mobile | ✅ Good | `inputmode="numeric"` on PIN, `capture="environment"` on photos |
| Admin on mobile | ⚠️ Cramped | 11-tab bar scrolls off-screen |
| Shop on mobile | ✅ Good | Grid collapses to single column |
| Font sizes | ✅ Good | Readable on mobile |
| Media queries | ✅ Comprehensive | 15+ breakpoints in style.css |

**Mobile Score: 8/10** — Public site is excellent, admin needs work.

---

## 10. MISSING PAGES FOR ENTERPRISE

| Page | Priority | Notes |
|------|----------|-------|
| `404.html` | **HIGH** | Custom error page |
| `gallery.html` | MEDIUM | Before/after portfolio of work |
| `faq.html` | MEDIUM | Standalone FAQ page (currently only in schema) |
| Web manifest | MEDIUM | PWA support for mobile |
| `reviews.html` or Google Reviews link | LOW | External review aggregation |
| Cookie policy page | MEDIUM | Separate from privacy policy for GDPR granularity |
| Accessibility statement | LOW | Required for public sector contracts (parish councils) |
| `commercial.html` | LOW | Dedicated commercial/parish council page |

---

## 11. POSITIVE FINDINGS (What's Done Well)

1. **Strong CSP headers** on every page — `object-src 'none'`, `base-uri 'self'`, frame restriction
2. **X-Frame-Options DENY** prevents clickjacking
3. **Referrer policy** `strict-origin-when-cross-origin` on all pages
4. **Admin pages properly noindexed** and blocked in robots.txt
5. **Cookie consent** is GDPR-compliant with accept/reject options
6. **Analytics is privacy-friendly** — no cookies, no fingerprinting, no PII
7. **Excellent structured data** — LocalBusiness, FAQ, Service, BreadcrumbList schemas
8. **Professional visual design** — consistent green theme, Poppins font, card-based layouts
9. **Failsafe patterns** throughout — inline script fallbacks if main JS fails
10. **Proper `loading="lazy"`** on below-fold images
11. **Font Awesome icons** consistently used with good visual hierarchy
12. **Form validation** is thorough — required fields, email regex, phone patterns
13. **Photo upload** with drag-and-drop, size limits, preview — excellent UX
14. **Chatbot** properly escapes user input (textContent) while allowing bot HTML
15. **Newsletter auto-injection** — elegant component that adds itself before footer

---

## PRIORITY FIX ORDER

### Week 1 (Critical Security)
1. **CRIT-02** — Move PIN verification to server-side
2. **CRIT-01** — Remove bank details from client JS
3. **CRIT-03** — Server-side invoice numbering
4. **CRIT-04** — Verify server-side Stripe amount validation

### Week 2 (SEO + Bugs)
5. **HIGH-01** — Fix duplicate FAQ in schema
6. **HIGH-02** — Fix "10 services" claim
7. **HIGH-03** — Remove hidden services from sitemap
8. **HIGH-04** — Fix BreadcrumbList schema
9. **HIGH-07** — Remove stripe-apps-script.js from web root

### Week 3 (Security Hardening)
10. **HIGH-09** — Validate honeypot field
11. **HIGH-11** — Fix analytics consent timing
12. **HIGH-12** — Add CSRF protection
13. **MED-01** — Plan CSP nonce migration
14. **MED-02** — Add SRI to CDN scripts

### Week 4 (UX + Accessibility)
15. **HIGH-18** — Add `<noscript>` fallbacks
16. **MED-12** — Create 404 page
17. **MED-15** — Fix time slot accessibility
18. **MED-16** — Add aria-labels to icon buttons
19. **LOW-07** — Standardise cache busting

---

*End of Agent 5 Audit Report*
