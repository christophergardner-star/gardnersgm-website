// ═══════════════════════════════════════════════
// ADMIN PIN GATE — Gardners Ground Maintenance
// Blocks all admin pages until correct 4-digit PIN
// Uses a fixed overlay that covers EVERYTHING (including sidebar)
// Session persists via sessionStorage (clears on browser close)
// After PIN auth, exchanges hash for API token via GAS
// ═══════════════════════════════════════════════

(function() {
  'use strict';

  var GAS_URL = 'https://script.google.com/macros/s/AKfycbxaT1YOoDZtVHP9CztiUutYFqMiOyygDJon5BxCij14CWl91WgdmrYqpbG4KVAlFh5IiQ/exec';

  // Set a global flag that admin-nav.js checks before building sidebar
  window.__GARDNERS_AUTH = false;

  /**
   * Intercept all fetch() calls to the GAS webhook and inject the admin token.
   * This means existing admin JS files need ZERO changes — the token is auto-injected.
   */
  function setupAdminFetchInterceptor() {
    var originalFetch = window.fetch;
    window.fetch = function(url, options) {
      var urlStr = (typeof url === 'string') ? url : (url && url.url ? url.url : '');
      if (urlStr.indexOf('script.google.com/macros') !== -1) {
        var token = sessionStorage.getItem('ggm_admin_token') || '';
        if (token) {
          if (options && options.body) {
            // POST — inject adminToken into JSON body
            try {
              var body = JSON.parse(options.body);
              body.adminToken = token;
              options = Object.assign({}, options, { body: JSON.stringify(body) });
            } catch(e) { /* not JSON body, skip */ }
          } else {
            // GET — append adminToken as query param
            var sep = urlStr.indexOf('?') !== -1 ? '&' : '?';
            url = urlStr + sep + 'adminToken=' + encodeURIComponent(token);
          }
        }
      }
      return originalFetch.call(this, url, options);
    };
  }

  // If already authenticated AND has a valid admin token, allow everything
  if (sessionStorage.getItem('gardners_admin') === 'authenticated' &&
      sessionStorage.getItem('ggm_admin_token')) {
    window.__GARDNERS_AUTH = true;
    setupAdminFetchInterceptor();
    document.addEventListener('DOMContentLoaded', function() {
      document.body.style.display = '';
    });
    return;
  }

  // Clear partial auth state (e.g. authenticated but no token from previous version)
  sessionStorage.removeItem('gardners_admin');
  sessionStorage.removeItem('ggm_admin_token');

  // SHA-256 hash function (Web Crypto API)
  function sha256(str) {
    var buffer = new TextEncoder().encode(str);
    return crypto.subtle.digest('SHA-256', buffer).then(function(hash) {
      var hexArr = [];
      var view = new DataView(hash);
      for (var i = 0; i < view.byteLength; i++) {
        hexArr.push(('00' + view.getUint8(i).toString(16)).slice(-2));
      }
      return hexArr.join('');
    });
  }

  // Inject styles immediately (before DOM ready) to prevent any flash
  var style = document.createElement('style');
  style.id = 'pinGateStyles';
  style.textContent = ''
    + '#adminPinGate {'
    + '  position:fixed;top:0;left:0;width:100%;height:100%;'
    + '  z-index:2147483647;'
    + '  display:flex;align-items:center;justify-content:center;'
    + '  background:linear-gradient(135deg,#f4f7f4 0%,#e8f5e9 100%);'
    + '  font-family:Poppins,Arial,sans-serif;padding:20px;'
    + '  transition:opacity 0.3s;'
    + '}'
    + '#adminPinGate * { box-sizing:border-box; }'
    + '/* Hide sidebar, topbar, overlay injected by admin-nav until authed */'
    + '.adm-sidebar, .adm-topbar, .adm-sidebar-overlay { display:none !important; }'
    + '.pin-box {'
    + '  width:56px;height:64px;text-align:center;font-size:1.8rem;font-weight:700;'
    + '  border:2px solid #e0e0e0;border-radius:12px;outline:none;font-family:Poppins,monospace;'
    + '  color:#333;transition:border-color 0.2s,box-shadow 0.2s;-webkit-appearance:none;'
    + '}'
    + '.pin-box:focus { border-color:#2E7D32; box-shadow:0 0 0 3px rgba(46,125,50,0.15); }'
    + '.pin-box.error { border-color:#d32f2f; animation:shake 0.4s ease; }'
    + '@keyframes shake {'
    + '  0%,100%{transform:translateX(0)} 20%,60%{transform:translateX(-6px)} 40%,80%{transform:translateX(6px)}'
    + '}'
    + '@media(max-width:400px) { .pin-box { width:48px;height:56px;font-size:1.5rem; } }';
  document.head.appendChild(style);

  // Build and inject the PIN gate as a fixed overlay
  function createGate() {
    // Show body so overlay renders, but overlay covers everything
    document.body.style.display = '';

    var overlay = document.createElement('div');
    overlay.id = 'adminPinGate';
    overlay.innerHTML = ''
      + '<div style="background:#fff;border-radius:16px;box-shadow:0 10px 40px rgba(0,0,0,0.12);padding:40px;max-width:380px;width:100%;text-align:center;">'
      + '  <div style="width:64px;height:64px;background:#e8f5e9;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 20px;">'
      + '    <i class="fas fa-lock" style="font-size:28px;color:#2E7D32;"></i>'
      + '  </div>'
      + '  <h1 style="color:#1a1a1a;font-size:1.4rem;margin:0 0 6px;font-weight:700;">Admin Access</h1>'
      + '  <p style="color:#888;font-size:0.85rem;margin:0 0 28px;">Enter your 4-digit PIN to continue</p>'
      + '  <div id="pinInputRow" style="display:flex;gap:12px;justify-content:center;margin-bottom:20px;">'
      + '    <input type="tel" maxlength="1" class="pin-box" data-idx="0" inputmode="numeric" pattern="[0-9]*" autocomplete="off">'
      + '    <input type="tel" maxlength="1" class="pin-box" data-idx="1" inputmode="numeric" pattern="[0-9]*" autocomplete="off">'
      + '    <input type="tel" maxlength="1" class="pin-box" data-idx="2" inputmode="numeric" pattern="[0-9]*" autocomplete="off">'
      + '    <input type="tel" maxlength="1" class="pin-box" data-idx="3" inputmode="numeric" pattern="[0-9]*" autocomplete="off">'
      + '  </div>'
      + '  <p id="pinError" style="color:#d32f2f;font-size:0.8rem;margin:0 0 16px;min-height:1.2em;"></p>'
      + '  <button id="pinSubmitBtn" style="background:linear-gradient(135deg,#2E7D32,#43A047);color:#fff;border:none;padding:12px 32px;border-radius:8px;font-size:0.95rem;font-weight:600;cursor:pointer;width:100%;font-family:inherit;transition:opacity 0.2s;">'
      + '    <i class="fas fa-arrow-right"></i>&nbsp; Unlock'
      + '  </button>'
      + '  <p style="color:#bbb;font-size:0.7rem;margin:16px 0 0;">'
      + '    <i class="fas fa-leaf" style="color:#ccc;"></i> Gardners Ground Maintenance'
      + '  </p>'
      + '</div>';

    document.body.appendChild(overlay);

    // Wire up PIN boxes
    var boxes = overlay.querySelectorAll('.pin-box');
    boxes[0].focus();

    boxes.forEach(function(box, idx) {
      box.addEventListener('input', function(e) {
        var val = e.target.value.replace(/\D/g, '');
        e.target.value = val;
        if (val && idx < 3) boxes[idx + 1].focus();
        if (idx === 3 && val) attemptUnlock();
        document.getElementById('pinError').textContent = '';
        box.classList.remove('error');
      });
      box.addEventListener('keydown', function(e) {
        if (e.key === 'Backspace' && !e.target.value && idx > 0) {
          boxes[idx - 1].focus();
          boxes[idx - 1].value = '';
        }
        if (e.key === 'Enter') attemptUnlock();
      });
      box.addEventListener('paste', function(e) {
        e.preventDefault();
        var paste = (e.clipboardData || window.clipboardData).getData('text').replace(/\D/g, '').slice(0, 4);
        for (var j = 0; j < paste.length && j < 4; j++) {
          boxes[j].value = paste[j];
        }
        if (paste.length === 4) attemptUnlock();
        else if (paste.length > 0) boxes[Math.min(paste.length, 3)].focus();
      });
    });

    document.getElementById('pinSubmitBtn').addEventListener('click', attemptUnlock);

    function attemptUnlock() {
      var pin = '';
      boxes.forEach(function(b) { pin += b.value; });
      if (pin.length !== 4) {
        showError('Enter all 4 digits');
        return;
      }

      // Disable UI during server validation
      var submitBtn = document.getElementById('pinSubmitBtn');
      if (submitBtn) {
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>&nbsp; Verifying...';
        submitBtn.disabled = true;
      }
      boxes.forEach(function(b) { b.disabled = true; });

      sha256(pin).then(function(hash) {
        // Server-side PIN validation (no client-side hash comparison)
        var loginBody = JSON.stringify({ action: 'admin_login', pinHash: hash });
        fetch(GAS_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain' },
          body: loginBody
        })
        .then(function(r) { return r.json(); })
        .then(function(resp) {
          if (resp.status === 'success' && resp.adminToken) {
            sessionStorage.setItem('ggm_admin_token', resp.adminToken);
            sessionStorage.setItem('gardners_admin', 'authenticated');
            window.__GARDNERS_AUTH = true;
            setupAdminFetchInterceptor();

            // Remove the CSS rule hiding sidebar/topbar
            var gateStyle = document.getElementById('pinGateStyles');
            if (gateStyle) gateStyle.remove();
            // Reveal sidebar and topbar
            document.querySelectorAll('.adm-sidebar, .adm-topbar, .adm-sidebar-overlay').forEach(function(el) {
              el.style.display = '';
            });
            // Fade out and remove PIN overlay
            overlay.style.opacity = '0';
            setTimeout(function() { overlay.remove(); }, 300);
          } else {
            showError(resp.message || 'Incorrect PIN');
            boxes.forEach(function(b) { b.value = ''; b.classList.add('error'); b.disabled = false; });
            boxes[0].focus();
            if (submitBtn) { submitBtn.innerHTML = '<i class="fas fa-lock"></i>&nbsp; Unlock'; submitBtn.disabled = false; }
            setTimeout(function() {
              boxes.forEach(function(b) { b.classList.remove('error'); });
            }, 500);
          }
        })
        .catch(function(err) {
          showError('Connection error — try again');
          boxes.forEach(function(b) { b.disabled = false; });
          if (submitBtn) { submitBtn.innerHTML = '<i class="fas fa-lock"></i>&nbsp; Unlock'; submitBtn.disabled = false; }
        });
      });
    }

    function showError(msg) {
      document.getElementById('pinError').textContent = msg;
    }
  }

  // Wait for DOM then inject gate
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', createGate);
  } else {
    createGate();
  }
})();
