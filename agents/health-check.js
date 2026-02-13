#!/usr/bin/env node
/* ══════════════════════════════════════════════════════
   Gardners GM — Standalone Health Check
   
   Extracted from orchestrator.js built-in health check.
   Runs 7 system checks and sends a Telegram report.
   
   Checks:
     1. Ollama status (auto-starts if down)
     2. Internet connectivity
     3. Google Apps Script API
     4. Disk space (D: then C:)
     5. Memory usage
     6. Log file sizes
     7. System uptime
   
   Usage:
     node agents/health-check.js           → Run checks, send Telegram report
     node agents/health-check.js --quiet   → Run checks, only alert on failures
   ══════════════════════════════════════════════════════ */

const path = require('path');
const fs   = require('fs');
const { execSync, spawn } = require('child_process');
const { apiFetch, fetchJSON, sendTelegram, isOllamaRunning, detectBestModel,
        createLogger, CONFIG } = require('./lib/shared');

const log = createLogger('health-check');
const AGENTS_DIR = __dirname;
const QUIET = process.argv.includes('--quiet');

async function runHealthCheck() {
  log('🏥 Running health check...');
  const checks = [];

  // 1. Ollama status
  const ollamaUp = await isOllamaRunning();
  if (ollamaUp) {
    const model = await detectBestModel();
    checks.push({ name: 'Ollama', status: '✅', detail: 'Running — model: ' + model });
  } else {
    checks.push({ name: 'Ollama', status: '❌', detail: 'Not running' });
    // Try to start Ollama
    try {
      log('   Attempting to start Ollama...');
      spawn('ollama', ['serve'], { detached: true, stdio: 'ignore' }).unref();
      await new Promise(r => setTimeout(r, 10000));
      const retryUp = await isOllamaRunning();
      if (retryUp) {
        checks[checks.length - 1] = { name: 'Ollama', status: '✅', detail: 'Started automatically' };
      }
    } catch(e) {
      log('   Could not auto-start Ollama: ' + e.message);
    }
  }

  // 2. Internet connectivity
  try {
    await fetchJSON('https://api.telegram.org/bot' + CONFIG.TG_BOT + '/getMe');
    checks.push({ name: 'Internet', status: '✅', detail: 'Connected' });
  } catch(e) {
    checks.push({ name: 'Internet', status: '❌', detail: 'No connection' });
  }

  // 3. Apps Script API
  try {
    await apiFetch('health_check');
    checks.push({ name: 'Google API', status: '✅', detail: 'Responding' });
  } catch(e) {
    try {
      await apiFetch('get_clients');
      checks.push({ name: 'Google API', status: '✅', detail: 'Responding (via get_clients)' });
    } catch(e2) {
      checks.push({ name: 'Google API', status: '⚠️', detail: 'Error: ' + e2.message.substring(0, 50) });
    }
  }

  // 4. Disk space (Windows)
  try {
    const diskInfo = execSync('wmic logicaldisk where "DeviceID=\'D:\'" get FreeSpace /format:value', { encoding: 'utf8', timeout: 5000 });
    const freeBytes = parseInt((diskInfo.match(/FreeSpace=(\d+)/) || [])[1] || '0');
    const freeGB = (freeBytes / (1024 ** 3)).toFixed(1);
    const status = freeGB > 10 ? '✅' : freeGB > 2 ? '⚠️' : '❌';
    checks.push({ name: 'Disk D:', status, detail: freeGB + ' GB free' });
  } catch(e) {
    try {
      const diskInfo = execSync('wmic logicaldisk where "DeviceID=\'C:\'" get FreeSpace /format:value', { encoding: 'utf8', timeout: 5000 });
      const freeBytes = parseInt((diskInfo.match(/FreeSpace=(\d+)/) || [])[1] || '0');
      const freeGB = (freeBytes / (1024 ** 3)).toFixed(1);
      checks.push({ name: 'Disk C:', status: freeGB > 5 ? '✅' : '⚠️', detail: freeGB + ' GB free' });
    } catch(e2) {}
  }

  // 5. Memory usage
  try {
    const memInfo = execSync('wmic OS get FreePhysicalMemory /format:value', { encoding: 'utf8', timeout: 5000 });
    const freeKB = parseInt((memInfo.match(/FreePhysicalMemory=(\d+)/) || [])[1] || '0');
    const freeGB = (freeKB / (1024 * 1024)).toFixed(1);
    const totalGB = 64;
    const usedGB = (totalGB - parseFloat(freeGB)).toFixed(1);
    checks.push({ name: 'Memory', status: freeGB > 8 ? '✅' : '⚠️', detail: usedGB + '/' + totalGB + ' GB used (' + freeGB + ' GB free)' });
  } catch(e) {}

  // 6. Log file sizes
  try {
    const logFiles = fs.readdirSync(AGENTS_DIR).filter(f => f.endsWith('.log'));
    const totalLogMB = logFiles.reduce((sum, f) => {
      try { return sum + fs.statSync(path.join(AGENTS_DIR, f)).size; } catch(e) { return sum; }
    }, 0) / (1024 * 1024);
    checks.push({ name: 'Logs', status: totalLogMB < 50 ? '✅' : '⚠️', detail: totalLogMB.toFixed(1) + ' MB total (' + logFiles.length + ' files)' });
  } catch(e) {}

  // 7. Uptime
  try {
    const uptimeRaw = execSync('wmic os get LastBootUpTime /format:value', { encoding: 'utf8', timeout: 5000 });
    const bootMatch = uptimeRaw.match(/LastBootUpTime=(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/);
    if (bootMatch) {
      const bootDate = new Date(bootMatch[1] + '-' + bootMatch[2] + '-' + bootMatch[3] + 'T' + bootMatch[4] + ':' + bootMatch[5] + ':' + bootMatch[6]);
      const uptimeHours = ((Date.now() - bootDate.getTime()) / 3600000).toFixed(0);
      const uptimeDays = (uptimeHours / 24).toFixed(1);
      checks.push({ name: 'Uptime', status: uptimeDays > 7 ? '⚠️' : '✅', detail: uptimeDays + ' days (' + uptimeHours + 'h)' + (uptimeDays > 5 ? ' — reboot soon?' : '') });
    }
  } catch(e) {}

  // Docker status (new — check containers are healthy)
  try {
    const dockerPs = execSync('docker ps --format "{{.Names}}\t{{.Status}}" 2>nul', { encoding: 'utf8', timeout: 5000 });
    const ggmContainers = dockerPs.split('\n').filter(l => l.startsWith('ggm-'));
    if (ggmContainers.length > 0) {
      const healthy = ggmContainers.filter(l => l.includes('Up')).length;
      const total = ggmContainers.length;
      checks.push({ name: 'Docker', status: healthy === total ? '✅' : '⚠️', detail: healthy + '/' + total + ' containers up' });
    }
  } catch(e) {
    // Docker not installed or not running — not an error
  }

  return checks;
}

// ── Main ──
(async () => {
  try {
    const checks = await runHealthCheck();

    const hasFailures = checks.some(c => c.status === '❌');
    const hasWarnings = checks.some(c => c.status === '⚠️');

    if (QUIET && !hasFailures && !hasWarnings) {
      log('All checks passed (quiet mode — no Telegram)');
      process.exit(0);
    }

    let msg = '🏥 <b>HEALTH CHECK</b>\n';
    msg += '━━━━━━━━━━━━━━━━━━━━\n\n';
    checks.forEach(c => {
      msg += c.status + ' <b>' + c.name + '</b>: ' + c.detail + '\n';
    });
    msg += '\n';

    if (hasFailures) {
      msg += '⚠️ <i>Action required — see failures above</i>';
    } else if (hasWarnings) {
      msg += '💡 <i>Some warnings — keep an eye on these</i>';
    } else {
      msg += '🌿 <i>All systems healthy</i>';
    }

    await sendTelegram(msg);
    log('Health check complete — ' + checks.length + ' checks, ' +
        checks.filter(c => c.status === '✅').length + ' passed, ' +
        checks.filter(c => c.status === '⚠️').length + ' warnings, ' +
        checks.filter(c => c.status === '❌').length + ' failures');

  } catch(err) {
    log('Health check error: ' + err.message);
    try { await sendTelegram('❌ Health check failed: ' + err.message); } catch(e) {}
    process.exit(1);
  }
})();
