/* ════════════════════════════════════════════════
   Cookie Consent Banner — UK PECR / GDPR Compliance
   Gardners Ground Maintenance
   ════════════════════════════════════════════════ */

(function () {
  'use strict';

  // If already consented, load analytics silently
  var consent = localStorage.getItem('ggm_cookie_consent');
  if (consent === 'accepted') {
    loadAnalytics();
    return;
  }
  if (consent === 'rejected') {
    return; // Respect the refusal
  }

  // Build the banner
  var banner = document.createElement('div');
  banner.id = 'cookieConsent';
  banner.setAttribute('role', 'dialog');
  banner.setAttribute('aria-label', 'Cookie consent');
  banner.innerHTML = ''
    + '<div style="max-width:960px;margin:0 auto;display:flex;align-items:center;gap:16px;flex-wrap:wrap;">'
    + '  <div style="flex:1;min-width:240px;">'
    + '    <strong style="font-size:0.95rem;">🍪 We value your privacy</strong>'
    + '    <p style="margin:6px 0 0;font-size:0.82rem;color:#555;line-height:1.5;">'
    + '      We use essential cookies to make our site work. With your consent, we also use analytics cookies to understand how you use our site so we can improve it. '
    + '      <a href="/privacy.html" style="color:#2E7D32;text-decoration:underline;">Privacy Policy</a>'
    + '    </p>'
    + '  </div>'
    + '  <div style="display:flex;gap:10px;flex-shrink:0;">'
    + '    <button id="cookieReject" style="background:#fff;color:#333;border:1px solid #ccc;padding:10px 20px;border-radius:8px;font-size:0.85rem;cursor:pointer;font-family:inherit;font-weight:500;transition:background 0.2s;">Reject All</button>'
    + '    <button id="cookieAccept" style="background:linear-gradient(135deg,#2E7D32,#43A047);color:#fff;border:none;padding:10px 20px;border-radius:8px;font-size:0.85rem;cursor:pointer;font-family:inherit;font-weight:600;transition:opacity 0.2s;">Accept All</button>'
    + '  </div>'
    + '</div>';

  // Styling
  banner.style.cssText = ''
    + 'position:fixed;bottom:0;left:0;width:100%;z-index:999999;'
    + 'background:#fff;border-top:1px solid #e0e0e0;'
    + 'box-shadow:0 -4px 20px rgba(0,0,0,0.1);'
    + 'padding:16px 24px;font-family:Poppins,Arial,sans-serif;'
    + 'transition:transform 0.3s ease;';

  // Inject after DOM ready
  function inject() {
    document.body.appendChild(banner);

    document.getElementById('cookieAccept').addEventListener('click', function () {
      localStorage.setItem('ggm_cookie_consent', 'accepted');
      loadAnalytics();
      dismiss();
    });

    document.getElementById('cookieReject').addEventListener('click', function () {
      localStorage.setItem('ggm_cookie_consent', 'rejected');
      dismiss();
    });
  }

  function dismiss() {
    banner.style.transform = 'translateY(100%)';
    setTimeout(function () { banner.remove(); }, 400);
  }

  function loadAnalytics() {
    // Only load Google Analytics after consent
    if (typeof window.loadGoogleAnalytics === 'function') {
      window.loadGoogleAnalytics();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inject);
  } else {
    inject();
  }
})();
