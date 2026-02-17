/* ============================================
   Gardners Ground Maintenance — Lightweight Analytics
   Privacy-friendly page view tracking via GAS webhook.
   No cookies, no fingerprinting, no PII stored.
   ============================================ */

(function() {
  'use strict';

  var WEBHOOK = 'https://script.google.com/macros/s/AKfycbxaT1YOoDZtVHP9CztiUutYFqMiOyygDJon5BxCij14CWl91WgdmrYqpbG4KVAlFh5IiQ/exec';

  // Debounce — only send once per page load
  var sent = false;

  function trackPageView() {
    if (sent) return;
    sent = true;

    var data = {
      action: 'track_pageview',
      page:   location.pathname.replace(/\/$/, '') || '/',
      title:  document.title || '',
      ref:    document.referrer || '',
      sw:     screen.width,
      sh:     screen.height,
      lang:   navigator.language || '',
      ts:     new Date().toISOString()
    };

    // Use sendBeacon for reliability (fires even on page unload)
    if (navigator.sendBeacon) {
      navigator.sendBeacon(WEBHOOK, JSON.stringify(data));
    } else {
      // Fallback: image pixel
      var params = Object.keys(data).map(function(k) {
        return encodeURIComponent(k) + '=' + encodeURIComponent(data[k]);
      }).join('&');
      new Image().src = WEBHOOK + '?' + params;
    }
  }

  // Track when page is visible (avoids counting preloaded tabs)
  if (document.visibilityState === 'visible') {
    trackPageView();
  } else {
    document.addEventListener('visibilitychange', function() {
      if (document.visibilityState === 'visible') trackPageView();
    }, { once: true });
  }

})();
