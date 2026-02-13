#!/usr/bin/env node
/* ══════════════════════════════════════════════════════
   Gardners GM — Standalone Evening Summary
   
   Extracted from orchestrator.js built-in evening summary.
   Collects today's business data and agent activity,
   sends a formatted daily recap to Telegram.
   
   Data collected:
     • Today's jobs and revenue (from Google Sheets)
     • Agent activity (from orchestrator state)
     • Tomorrow's job preview
   
   Usage:
     node agents/evening-summary.js
   ══════════════════════════════════════════════════════ */

const path = require('path');
const fs   = require('fs');
const { apiFetch, sendTelegram, fmtGBP, todayISO, createLogger } = require('./lib/shared');

const log = createLogger('evening-summary');

// Agent labels — must match orchestrator.js AGENTS definitions
const AGENT_LABELS = {
  'health-check':     '🏥 Health Check',
  'morning-week':     '📅 Week Planner',
  'morning-today':    '☀️ Today Briefing',
  'enquiry-check':    '📧 Enquiry Responder',
  'email-lifecycle':  '📨 Email Lifecycle',
  'finance-daily':    '💰 Finance Report',
  'social-media':     '📱 Social Media',
  'content-agent':    '📝 Content Agent',
  'evening-summary':  '🌙 Evening Summary',
  'site-health':      '🏥 Site Health',
  'review-chaser':    '⭐ Review Chaser',
  'business-tactics': '📊 Business Tactics',
  'market-intel':     '🔍 Market Intel',
};

// Load orchestrator state to see which agents ran today
function loadOrchestratorState() {
  const stateFile = path.join(__dirname, '.orchestrator-state.json');
  try { return JSON.parse(fs.readFileSync(stateFile, 'utf8')); }
  catch(e) { return { lastRuns: {}, dailySummary: {} }; }
}

async function runEveningSummary() {
  log('🌙 Generating evening summary...');

  const state = loadOrchestratorState();
  const today = todayISO();

  // Which agents ran today?
  const runs = Object.entries(state.lastRuns || {})
    .filter(([k, v]) => v && new Date(v).toISOString().slice(0, 10) === today)
    .map(([k, v]) => ({
      agent: AGENT_LABELS[k] || k,
      time: new Date(v).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
    }));

  // Fetch today's business data
  let todayJobs = 0, todayRevenue = 0;
  try {
    const clients = await apiFetch('get_clients');
    if (clients.status === 'success') {
      const todayEntries = (clients.clients || []).filter(c => {
        if (!c.date && !c.timestamp) return false;
        try { return new Date(c.date || c.timestamp).toISOString().slice(0, 10) === today; } catch(e) { return false; }
      });
      todayJobs = todayEntries.length;
      todayRevenue = todayEntries.reduce((s, c) => s + (parseFloat(String(c.price || '0').replace(/[^0-9.]/g, '')) || 0), 0);
    }
  } catch(e) {
    log('Could not fetch today\'s business data: ' + e.message);
  }

  // Build message
  let msg = '🌙 <b>EVENING SUMMARY — ' + new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }) + '</b>\n';
  msg += '━━━━━━━━━━━━━━━━━━━━\n\n';

  // Business
  msg += '📊 <b>Today\'s Business</b>\n';
  msg += '  🗂 Jobs: <b>' + todayJobs + '</b>\n';
  msg += '  💰 Revenue: <b>' + fmtGBP(todayRevenue) + '</b>\n\n';

  // Agent runs
  msg += '🤖 <b>Agent Activity</b>\n';
  if (runs.length) {
    runs.forEach(r => { msg += '  ✅ ' + r.agent + ' at ' + r.time + '\n'; });
  } else {
    msg += '  <i>No agents ran today</i>\n';
  }
  msg += '\n';

  // Tomorrow preview
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (tomorrow.getDay() !== 0) { // Not Sunday
    try {
      const clients = await apiFetch('get_clients');
      if (clients.status === 'success') {
        const tomorrowStr = tomorrow.toISOString().slice(0, 10);
        const tomorrowJobs = (clients.clients || []).filter(c => {
          try { return new Date(c.date).toISOString().slice(0, 10) === tomorrowStr; } catch(e) { return false; }
        });
        msg += '📅 <b>Tomorrow</b>: ' + (tomorrowJobs.length || 'No') + ' job' + (tomorrowJobs.length !== 1 ? 's' : '') + ' scheduled\n';
      }
    } catch(e) {}
  } else {
    msg += '📅 <b>Tomorrow</b>: Sunday — day off! ☀️\n';
  }

  // Docker status (if running)
  try {
    const { execSync } = require('child_process');
    const dockerPs = execSync('docker ps --format "{{.Names}}: {{.Status}}" --filter "name=ggm-" 2>nul', { encoding: 'utf8', timeout: 5000 }).trim();
    if (dockerPs) {
      msg += '\n🐳 <b>Docker Services</b>\n';
      dockerPs.split('\n').forEach(line => {
        const up = line.includes('Up');
        msg += '  ' + (up ? '✅' : '❌') + ' ' + line.trim() + '\n';
      });
    }
  } catch(e) {
    // Docker not available — skip
  }

  msg += '\n🌿 <i>Have a good evening, Chris!</i>';

  await sendTelegram(msg);
  log('Evening summary sent');
  return { success: true };
}

// ── Main ──
(async () => {
  try {
    await runEveningSummary();
  } catch(err) {
    log('Evening summary error: ' + err.message);
    try { await sendTelegram('❌ Evening summary failed: ' + err.message); } catch(e) {}
    process.exit(1);
  }
})();
