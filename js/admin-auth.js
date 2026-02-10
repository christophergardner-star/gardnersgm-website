// ═══════════════════════════════════════════════
// ADMIN PIN GATE — Gardners Ground Maintenance
// Blocks all admin pages until correct 4-digit PIN
// Session persists via sessionStorage (clears on browser close)
// ═══════════════════════════════════════════════

(function() {
  'use strict';

  // SHA-256 hash of the PIN "2383"
  var PIN_HASH = 'a3f8e7b2c1d4e5f6'; // placeholder — replaced below with real hash

  // Check if already authenticated this session
  if (sessionStorage.getItem('gardners_admin') === 'authenticated') {
    document.addEventListener('DOMContentLoaded', function() {
      document.body.style.display = '';
    });
    return;
  }

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

  // Build and inject the PIN gate overlay
  function createGate() {
    var overlay = document.createElement('div');
    overlay.id = 'adminPinGate';
    overlay.innerHTML = ''
      + '<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#f4f7f4 0%,#e8f5e9 100%);font-family:Poppins,Arial,sans-serif;padding:20px;">'
      + '  <div style="background:#fff;border-radius:16px;box-shadow:0 10px 40px rgba(0,0,0,0.12);padding:40px;max-width:380px;width:100%;text-align:center;">'
      + '    <div style="width:64px;height:64px;background:#e8f5e9;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 20px;">'
      + '      <i class="fas fa-lock" style="font-size:28px;color:#2E7D32;"></i>'
      + '    </div>'
      + '    <h1 style="color:#1a1a1a;font-size:1.4rem;margin:0 0 6px;font-weight:700;">Admin Access</h1>'
      + '    <p style="color:#888;font-size:0.85rem;margin:0 0 28px;">Enter your 4-digit PIN to continue</p>'
      + '    <div id="pinInputRow" style="display:flex;gap:12px;justify-content:center;margin-bottom:20px;">'
      + '      <input type="tel" maxlength="1" class="pin-box" data-idx="0" inputmode="numeric" pattern="[0-9]*" autocomplete="off">'
      + '      <input type="tel" maxlength="1" class="pin-box" data-idx="1" inputmode="numeric" pattern="[0-9]*" autocomplete="off">'
      + '      <input type="tel" maxlength="1" class="pin-box" data-idx="2" inputmode="numeric" pattern="[0-9]*" autocomplete="off">'
      + '      <input type="tel" maxlength="1" class="pin-box" data-idx="3" inputmode="numeric" pattern="[0-9]*" autocomplete="off">'
      + '    </div>'
      + '    <p id="pinError" style="color:#d32f2f;font-size:0.8rem;margin:0 0 16px;min-height:1.2em;"></p>'
      + '    <button id="pinSubmitBtn" style="background:linear-gradient(135deg,#2E7D32,#43A047);color:#fff;border:none;padding:12px 32px;border-radius:8px;font-size:0.95rem;font-weight:600;cursor:pointer;width:100%;font-family:inherit;transition:opacity 0.2s;">'
      + '      <i class="fas fa-arrow-right"></i>&nbsp; Unlock'
      + '    </button>'
      + '    <p style="color:#bbb;font-size:0.7rem;margin:16px 0 0;">'
      + '      <i class="fas fa-leaf" style="color:#ccc;"></i> Gardners Ground Maintenance'
      + '    </p>'
      + '  </div>'
      + '</div>';

    // PIN box styles
    var style = document.createElement('style');
    style.textContent = ''
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
      + '#adminPinGate * { box-sizing:border-box; }'
      + '@media(max-width:400px) { .pin-box { width:48px;height:56px;font-size:1.5rem; } }';
    document.head.appendChild(style);
    document.body.appendChild(overlay);
    document.body.style.display = '';
    // But hide the REAL content — everything except our gate
    var children = document.body.children;
    for (var i = 0; i < children.length; i++) {
      if (children[i].id !== 'adminPinGate') {
        children[i].style.display = 'none';
        children[i].setAttribute('data-gated', 'true');
      }
    }

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
      // Handle paste
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
      sha256(pin).then(function(hash) {
        // Hash of "2383"
        if (hash === '8f5c5451afb17f9be7d6de2f539748454bbf770ef31498fcb1a8b91175945a34') {
          // Success — reveal the page
          sessionStorage.setItem('gardners_admin', 'authenticated');
          overlay.style.opacity = '0';
          overlay.style.transition = 'opacity 0.3s';
          setTimeout(function() {
            overlay.remove();
            var gated = document.querySelectorAll('[data-gated]');
            gated.forEach(function(el) {
              el.style.display = '';
              el.removeAttribute('data-gated');
            });
          }, 300);
        } else {
          showError('Incorrect PIN');
          boxes.forEach(function(b) { b.value = ''; b.classList.add('error'); });
          boxes[0].focus();
          setTimeout(function() {
            boxes.forEach(function(b) { b.classList.remove('error'); });
          }, 500);
        }
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
