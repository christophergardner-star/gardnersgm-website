#!/usr/bin/env node
/* ══════════════════════════════════════════════════════
   Gardners GM — Site Health Monitor Agent
   
   Checks website health automatically:
   • All public pages load with 200 status
   • SSL certificate is valid  
   • Sitemap.xml is accessible
   • Response times are acceptable
   • Key elements present (title, meta description)
   
   Sends a Telegram report with any issues found.
   
   Usage:
     node agents/site-health.js          → Full health check
     node agents/site-health.js quick    → Quick check (homepage + key pages only)
   ══════════════════════════════════════════════════════ */

const { apiFetch, sendTelegram, createLogger, CONFIG } = require('./lib/shared');
const https = require('https');
const http  = require('http');

const log = createLogger('site-health');

const SITE_URL = 'https://gardnersgm.co.uk';

// All public pages to check
const ALL_PAGES = [
  { path: '/',                    name: 'Home' },
  { path: '/about.html',         name: 'About' },
  { path: '/services.html',      name: 'Services' },
  { path: '/booking.html',       name: 'Booking' },
  { path: '/contact.html',       name: 'Contact' },
  { path: '/blog.html',          name: 'Blog' },
  { path: '/testimonials.html',  name: 'Testimonials' },
  { path: '/shop.html',          name: 'Shop' },
  { path: '/careers.html',       name: 'Careers' },
  { path: '/areas.html',         name: 'Service Areas' },
  { path: '/subscribe.html',     name: 'Subscribe' },
  { path: '/terms.html',         name: 'Terms' },
  { path: '/privacy.html',       name: 'Privacy' },
  { path: '/my-account.html',    name: 'My Account' },
  { path: '/sitemap.xml',        name: 'Sitemap' },
  { path: '/robots.txt',         name: 'Robots.txt' },
];

const QUICK_PAGES = ALL_PAGES.filter(p => 
  ['/', '/services.html', '/booking.html', '/contact.html', '/blog.html', '/sitemap.xml'].includes(p.path)
);


// ══════════════════════════════════════════════
// HTTP CHECK — fetch a page and report status
// ══════════════════════════════════════════════

function checkPage(url) {
  return new Promise((resolve) => {
    const start = Date.now();
    const mod = url.startsWith('https') ? https : http;
    
    const req = mod.get(url, { 
      timeout: 15000,
      headers: { 'User-Agent': 'GardnersGM-HealthCheck/1.0' }
    }, (res) => {
      const elapsed = Date.now() - start;
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        resolve({
          url,
          status: res.statusCode,
          time: elapsed,
          size: body.length,
          hasTitle: /<title>/i.test(body),
          hasMetaDesc: /meta\s+name="description"/i.test(body),
          hasAnalytics: /analytics\.js/i.test(body),
          ok: res.statusCode >= 200 && res.statusCode < 400,
        });
      });
    });
    
    req.on('error', (err) => {
      resolve({
        url,
        status: 0,
        time: Date.now() - start,
        size: 0,
        error: err.message,
        ok: false,
      });
    });
    
    req.on('timeout', () => {
      req.destroy();
      resolve({
        url,
        status: 0,
        time: 15000,
        size: 0,
        error: 'Timeout (15s)',
        ok: false,
      });
    });
  });
}


// ══════════════════════════════════════════════
// SSL CHECK — verify certificate validity
// ══════════════════════════════════════════════

function checkSSL(hostname) {
  return new Promise((resolve) => {
    const req = https.get({ hostname, port: 443, path: '/', method: 'HEAD' }, (res) => {
      const cert = res.socket.getPeerCertificate();
      if (cert && cert.valid_to) {
        const expiry = new Date(cert.valid_to);
        const daysLeft = Math.floor((expiry - new Date()) / (1000 * 60 * 60 * 24));
        resolve({
          valid: true,
          issuer: cert.issuer ? cert.issuer.O : 'Unknown',
          expiry: cert.valid_to,
          daysLeft,
          warning: daysLeft < 14,
        });
      } else {
        resolve({ valid: false, error: 'No certificate found' });
      }
      req.destroy();
    });
    req.on('error', (err) => {
      resolve({ valid: false, error: err.message });
    });
    req.setTimeout(10000, () => {
      req.destroy();
      resolve({ valid: false, error: 'SSL check timeout' });
    });
  });
}


// ══════════════════════════════════════════════
// MAIN — Run health check
// ══════════════════════════════════════════════

async function runHealthCheck(mode = 'full') {
  log.info(`Starting site health check (${mode})...`);
  
  const pages = mode === 'quick' ? QUICK_PAGES : ALL_PAGES;
  const results = [];
  const issues = [];

  // 1. Check all pages
  for (const page of pages) {
    const result = await checkPage(SITE_URL + page.path);
    result.name = page.name;
    results.push(result);
    
    if (!result.ok) {
      issues.push(`❌ ${page.name} — ${result.error || `HTTP ${result.status}`}`);
    } else if (result.time > 5000) {
      issues.push(`🐌 ${page.name} — slow (${(result.time/1000).toFixed(1)}s)`);
    }
    
    // Check HTML pages have required elements
    if (result.ok && page.path.endsWith('.html')) {
      if (!result.hasTitle) issues.push(`⚠️ ${page.name} — missing <title>`);
      if (!result.hasMetaDesc) issues.push(`⚠️ ${page.name} — missing meta description`);
    }
  }

  // 2. Check SSL
  const ssl = await checkSSL('gardnersgm.co.uk');
  if (!ssl.valid) {
    issues.push(`🔒 SSL Error: ${ssl.error}`);
  } else if (ssl.warning) {
    issues.push(`⚠️ SSL expires in ${ssl.daysLeft} days!`);
  }

  // 3. Build report
  const okCount = results.filter(r => r.ok).length;
  const failCount = results.filter(r => !r.ok).length;
  const avgTime = Math.round(results.reduce((s, r) => s + r.time, 0) / results.length);
  const trackCount = results.filter(r => r.hasAnalytics).length;

  let msg = `🏥 *Site Health Report*\n\n`;
  msg += `🌐 ${SITE_URL}\n`;
  msg += `📅 ${new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}\n\n`;
  
  if (issues.length === 0) {
    msg += `✅ *All ${okCount} pages healthy*\n`;
  } else {
    msg += `📊 *${okCount}/${results.length} pages OK*`;
    if (failCount > 0) msg += `, *${failCount} failed*`;
    msg += `\n\n`;
    msg += `*Issues Found:*\n`;
    issues.forEach(i => msg += `  ${i}\n`);
  }

  msg += `\n⚡ Avg response: ${avgTime}ms\n`;

  if (ssl.valid) {
    msg += `🔒 SSL: Valid (${ssl.daysLeft} days left)\n`;
  }
  
  msg += `📊 Analytics tracker: ${trackCount}/${results.filter(r => r.ok && r.url.includes('.html')).length + 1} pages\n`;

  // Page breakdown (only for full mode)
  if (mode === 'full') {
    msg += `\n*Page Times:*\n`;
    results
      .filter(r => r.ok)
      .sort((a, b) => b.time - a.time)
      .forEach(r => {
        const icon = r.time < 1000 ? '🟢' : r.time < 3000 ? '🟡' : '🔴';
        msg += `  ${icon} ${r.name}: ${r.time}ms\n`;
      });
  }

  log.info(`Health check complete: ${okCount}/${results.length} OK, ${issues.length} issues`);
  
  // Send to Telegram
  await sendTelegram(msg);
  
  // Also log to GAS for record-keeping (non-critical)
  try {
    // Note: relay_telegram is a public POST endpoint, no adminToken needed
    const { postJSON } = require('./lib/shared');
  } catch(e) { /* non-critical */ }
  
  return { ok: issues.length === 0, issues, results };
}


// ══════════════════════════════════════════════
// CLI ENTRY
// ══════════════════════════════════════════════

const mode = process.argv[2] || 'full';
runHealthCheck(mode)
  .then(result => {
    process.exit(result.ok ? 0 : 1);
  })
  .catch(err => {
    log.error('Health check failed:', err);
    process.exit(1);
  });
