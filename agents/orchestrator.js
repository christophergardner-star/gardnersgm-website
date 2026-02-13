#!/usr/bin/env node
/* ══════════════════════════════════════════════════════
   Gardners GM — Central Node Orchestrator
   
   The "brain" that coordinates all agents from your always-on PC.
   Runs continuously via Windows Task Scheduler (every 15 mins)
   or as a persistent process.
   
   Schedule:
     06:00  Health check + system status
     06:15  Morning planner — week ahead (Mon-Sat)
     06:45  Morning planner — today's jobs
     07:00  Enquiry responder — check for overnight enquiries
     07:30  Email lifecycle — daily reminders/aftercare
     08:00  Finance dashboard — daily report
     09:00  Social media — auto-post (if scheduled)
     10:00  Content agent — blog/newsletter (on scheduled days)
     12:00  Enquiry responder — midday check
     17:00  Enquiry responder — afternoon check
     18:00  Evening summary — day's activity recap
     20:00  Content agent — evening blog (if draft needed)
   
   Usage:
     node agents/orchestrator.js              → Run due tasks for current time
     node agents/orchestrator.js status       → System status to Telegram
     node agents/orchestrator.js force <agent> → Force-run a specific agent
     node agents/orchestrator.js daemon       → Run as persistent daemon (checks every 15 min)
     node agents/orchestrator.js schedule     → Show today's schedule
   ══════════════════════════════════════════════════════ */

const path = require('path');
const fs   = require('fs');
const { execSync, spawn } = require('child_process');
const { apiFetch, sendTelegram, isOllamaRunning, detectBestModel,
        createLogger, escHtml, fmtGBP, todayISO, CONFIG } = require('./lib/shared');

const log = createLogger('orchestrator');

// State tracking
const STATE_FILE = path.join(__dirname, '.orchestrator-state.json');

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); }
  catch(e) { return { lastRuns: {}, today: '', dailySummary: { jobs: 0, revenue: 0, enquiries: 0, emails: 0, posts: 0 } }; }
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}


// ══════════════════════════════════════════════
// AGENT DEFINITIONS
// ══════════════════════════════════════════════

const AGENTS_DIR = __dirname;

const AGENTS = {
  'health-check': {
    label: '🏥 Health Check',
    script: null, // built-in
    schedule: [{ hour: 6, min: 0 }],
    maxFreqMins: 360, // max once every 6 hours
  },
  'morning-week': {
    label: '📅 Week Planner',
    script: 'morning-planner.js',
    args: ['week'],
    schedule: [{ hour: 6, min: 15 }],
    maxFreqMins: 1440, // once per day
    daysOfWeek: [1,2,3,4,5,6], // Mon-Sat
  },
  'morning-today': {
    label: '☀️ Today Briefing',
    script: 'morning-planner.js',
    args: ['today'],
    schedule: [{ hour: 6, min: 45 }],
    maxFreqMins: 1440,
    daysOfWeek: [1,2,3,4,5,6],
  },
  'enquiry-check': {
    label: '📧 Enquiry Responder',
    script: 'enquiry-responder.js',
    args: [],
    schedule: [{ hour: 7, min: 0 }, { hour: 12, min: 0 }, { hour: 17, min: 0 }],
    maxFreqMins: 120, // at most every 2 hours
    needsOllama: true,
  },
  'email-lifecycle': {
    label: '📨 Email Lifecycle',
    script: 'email-lifecycle.js',
    args: ['daily'],
    schedule: [{ hour: 7, min: 30 }],
    maxFreqMins: 1440,
  },
  'finance-daily': {
    label: '💰 Finance Report',
    script: 'finance-dashboard.js',
    args: ['daily'],
    schedule: [{ hour: 8, min: 0 }],
    maxFreqMins: 1440,
  },
  'social-media': {
    label: '📱 Social Media',
    script: 'social-media.js',
    args: ['auto'],
    schedule: [{ hour: 9, min: 0 }],
    maxFreqMins: 1440,
    needsOllama: true,
  },
  'content-agent': {
    label: '📝 Content Agent',
    script: 'content-agent.js',
    args: ['auto'],
    schedule: [{ hour: 10, min: 0 }],
    maxFreqMins: 1440,
    needsOllama: true,
  },
  'evening-summary': {
    label: '🌙 Evening Summary',
    script: null, // built-in
    schedule: [{ hour: 18, min: 0 }],
    maxFreqMins: 1440,
  },
  'site-health': {
    label: '🏥 Site Health',
    script: 'site-health.js',
    args: ['full'],
    schedule: [{ hour: 7, min: 15 }],
    maxFreqMins: 1440, // once per day
  },
  'review-chaser': {
    label: '⭐ Review Chaser',
    script: 'review-chaser.js',
    args: [],
    schedule: [{ hour: 11, min: 0 }],
    maxFreqMins: 1440,
    needsOllama: true,
  },
  'business-tactics': {
    label: '📊 Business Tactics',
    script: 'business-tactics.js',
    args: [],
    schedule: [{ hour: 8, min: 30 }],
    maxFreqMins: 10080, // once per week
    daysOfWeek: [1], // Monday only
    needsOllama: true,
  },
};


// ══════════════════════════════════════════════
// TASK SCHEDULING LOGIC
// ══════════════════════════════════════════════

function isDue(agentId, state) {
  const agent = AGENTS[agentId];
  const now = new Date();
  const hour = now.getHours();
  const min = now.getMinutes();
  const dow = now.getDay(); // 0=Sun

  // Check day-of-week restriction
  if (agent.daysOfWeek && !agent.daysOfWeek.includes(dow)) return false;

  // Check if any schedule slot matches (within 15 min window)
  const slotMatch = agent.schedule.some(s => {
    const slotMins = s.hour * 60 + s.min;
    const nowMins = hour * 60 + min;
    return nowMins >= slotMins && nowMins < slotMins + 15;
  });
  if (!slotMatch) return false;

  // Check frequency — don't re-run if ran too recently
  const lastRun = state.lastRuns[agentId];
  if (lastRun) {
    const elapsed = (Date.now() - new Date(lastRun).getTime()) / 60000;
    if (elapsed < agent.maxFreqMins) return false;
  }

  return true;
}


// ══════════════════════════════════════════════
// AGENT RUNNER
// ══════════════════════════════════════════════

function runAgent(agentId) {
  return new Promise((resolve, reject) => {
    const agent = AGENTS[agentId];
    const script = path.join(AGENTS_DIR, agent.script);

    if (!fs.existsSync(script)) {
      log('⚠️ Script not found: ' + agent.script);
      resolve({ success: false, error: 'Script not found' });
      return;
    }

    log('▶️  Running: ' + agent.label);
    const startTime = Date.now();

    const child = spawn('node', [script, ...(agent.args || [])], {
      cwd: path.join(AGENTS_DIR, '..'),
      env: process.env,
      stdio: 'pipe',
      timeout: 300000 // 5 min max
    });

    let stdout = '', stderr = '';
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });

    child.on('close', code => {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      if (code === 0) {
        log('✅ ' + agent.label + ' completed in ' + elapsed + 's');
        resolve({ success: true, elapsed, output: stdout.substring(0, 500) });
      } else {
        log('❌ ' + agent.label + ' failed (exit ' + code + ')');
        if (stderr) log('   STDERR: ' + stderr.substring(0, 300));
        resolve({ success: false, elapsed, error: stderr.substring(0, 300), code });
      }
    });

    child.on('error', err => {
      log('❌ ' + agent.label + ' spawn error: ' + err.message);
      resolve({ success: false, error: err.message });
    });
  });
}


// ══════════════════════════════════════════════
// BUILT-IN: HEALTH CHECK
// ══════════════════════════════════════════════

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
    const resp = await require('./lib/shared').fetchJSON('https://api.telegram.org/bot' + CONFIG.TG_BOT + '/getMe');
    checks.push({ name: 'Internet', status: '✅', detail: 'Connected' });
  } catch(e) {
    checks.push({ name: 'Internet', status: '❌', detail: 'No connection' });
  }

  // 3. Apps Script API
  try {
    const resp = await apiFetch('health_check');
    checks.push({ name: 'Google API', status: '✅', detail: 'Responding' });
  } catch(e) {
    // Try a simpler endpoint
    try {
      const resp = await apiFetch('get_clients');
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
    // Try C: drive instead
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
    const totalGB = 64; // Known from user
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

  return checks;
}


// ══════════════════════════════════════════════
// BUILT-IN: EVENING SUMMARY
// ══════════════════════════════════════════════

async function runEveningSummary(state) {
  log('🌙 Generating evening summary...');

  const summary = state.dailySummary || {};
  const runs = Object.entries(state.lastRuns || {})
    .filter(([k, v]) => v && new Date(v).toISOString().slice(0, 10) === todayISO())
    .map(([k, v]) => ({ agent: AGENTS[k]?.label || k, time: new Date(v).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) }));

  // Fetch today's business data for summary
  let todayJobs = 0, todayRevenue = 0;
  try {
    const clients = await apiFetch('get_clients');
    if (clients.status === 'success') {
      const todayStr = todayISO();
      const todayEntries = (clients.clients || []).filter(c => {
        if (!c.date && !c.timestamp) return false;
        try { return new Date(c.date || c.timestamp).toISOString().slice(0, 10) === todayStr; } catch(e) { return false; }
      });
      todayJobs = todayEntries.length;
      todayRevenue = todayEntries.reduce((s, c) => s + (parseFloat(String(c.price || '0').replace(/[^0-9.]/g, '')) || 0), 0);
    }
  } catch(e) {}

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

  msg += '\n🌿 <i>Have a good evening, Chris!</i>';

  await sendTelegram(msg);
  return { success: true };
}


// ══════════════════════════════════════════════
// STATUS COMMAND
// ══════════════════════════════════════════════

async function sendStatus() {
  const state = loadState();
  const checks = await runHealthCheck();

  let msg = '🖥️ <b>CENTRAL NODE STATUS</b>\n';
  msg += '━━━━━━━━━━━━━━━━━━━━\n\n';

  msg += '🏥 <b>System Health</b>\n';
  checks.forEach(c => { msg += '  ' + c.status + ' ' + c.name + ': ' + c.detail + '\n'; });
  msg += '\n';

  msg += '⏰ <b>Agent Last Runs</b>\n';
  for (const [id, agent] of Object.entries(AGENTS)) {
    const lastRun = state.lastRuns[id];
    if (lastRun) {
      const d = new Date(lastRun);
      const ago = ((Date.now() - d.getTime()) / 3600000).toFixed(1);
      msg += '  ' + agent.label + ': ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) + ' (' + ago + 'h ago)\n';
    } else {
      msg += '  ' + agent.label + ': <i>Never run</i>\n';
    }
  }
  msg += '\n';

  // Next scheduled
  const now = new Date();
  const nowMins = now.getHours() * 60 + now.getMinutes();
  let nextAgent = null, nextTime = 1440;
  for (const [id, agent] of Object.entries(AGENTS)) {
    for (const s of agent.schedule) {
      const sMins = s.hour * 60 + s.min;
      if (sMins > nowMins && sMins < nextTime) {
        nextTime = sMins;
        nextAgent = agent;
      }
    }
  }
  if (nextAgent) {
    msg += '⏭️ Next: <b>' + nextAgent.label + '</b> at ' + String(Math.floor(nextTime / 60)).padStart(2, '0') + ':' + String(nextTime % 60).padStart(2, '0') + '\n';
  } else {
    msg += '⏭️ Next: <i>Tomorrow 06:00</i>\n';
  }

  msg += '\n🌿 <i>Gardners GM Central Node</i>';
  await sendTelegram(msg);
}


// ══════════════════════════════════════════════
// SHOW SCHEDULE
// ══════════════════════════════════════════════

function showSchedule() {
  const now = new Date();
  const dow = now.getDay();

  console.log('');
  console.log('  ═══════════════════════════════════════');
  console.log('  📅 DAILY SCHEDULE — ' + now.toLocaleDateString('en-GB', { weekday: 'long' }));
  console.log('  ═══════════════════════════════════════');
  console.log('');

  const slots = [];
  for (const [id, agent] of Object.entries(AGENTS)) {
    if (agent.daysOfWeek && !agent.daysOfWeek.includes(dow)) continue;
    for (const s of agent.schedule) {
      slots.push({ hour: s.hour, min: s.min, label: agent.label, id });
    }
  }

  slots.sort((a, b) => (a.hour * 60 + a.min) - (b.hour * 60 + b.min));

  const nowMins = now.getHours() * 60 + now.getMinutes();
  slots.forEach(s => {
    const sMins = s.hour * 60 + s.min;
    const time = String(s.hour).padStart(2, '0') + ':' + String(s.min).padStart(2, '0');
    const marker = (sMins <= nowMins) ? ' ✅' : (sMins <= nowMins + 15 ? ' 🔄' : '');
    console.log('  ' + time + '  ' + s.label + marker);
  });

  console.log('');
  console.log('  Total: ' + slots.length + ' tasks today');
  console.log('');
}


// ══════════════════════════════════════════════
// ENSURE OLLAMA IS RUNNING
// ══════════════════════════════════════════════

async function ensureOllama() {
  if (await isOllamaRunning()) return true;

  log('🔄 Ollama not running — attempting start...');
  try {
    spawn('ollama', ['serve'], { detached: true, stdio: 'ignore' }).unref();
    // Wait up to 30 seconds for it to start
    for (let i = 0; i < 6; i++) {
      await new Promise(r => setTimeout(r, 5000));
      if (await isOllamaRunning()) {
        log('✅ Ollama started successfully');
        return true;
      }
    }
    log('❌ Ollama failed to start within 30 seconds');
    return false;
  } catch(e) {
    log('❌ Could not start Ollama: ' + e.message);
    return false;
  }
}


// ══════════════════════════════════════════════
// MAIN — RUN DUE TASKS
// ══════════════════════════════════════════════

async function main() {
  const args = process.argv.slice(2);
  const command = (args[0] || 'run').toLowerCase();

  log('═══════════════════════════════════════════');
  log('🧠 Gardners GM — Central Node Orchestrator');
  log('═══════════════════════════════════════════');
  log('📅 ' + new Date().toLocaleString('en-GB'));
  log('📌 Command: ' + command);
  log('');

  if (command === 'schedule') {
    showSchedule();
    return;
  }

  if (command === 'status') {
    await sendStatus();
    return;
  }

  if (command === 'force') {
    const agentId = args[1];
    if (!agentId || !AGENTS[agentId]) {
      console.log('Available agents: ' + Object.keys(AGENTS).join(', '));
      return;
    }
    const agent = AGENTS[agentId];
    if (!agent.script) {
      console.log('Built-in agent — cannot force from CLI');
      return;
    }
    if (agent.needsOllama) await ensureOllama();
    const result = await runAgent(agentId);
    console.log('Result:', result);
    return;
  }

  if (command === 'daemon') {
    log('🔁 Starting daemon mode — checking every 15 minutes');
    log('   Press Ctrl+C to stop');
    log('');
    await runDueTasks();
    setInterval(() => runDueTasks(), 15 * 60 * 1000);
    return; // Keep alive
  }

  // Default: run due tasks
  await runDueTasks();
}

async function runDueTasks() {
  const state = loadState();

  // Reset daily summary if new day
  if (state.today !== todayISO()) {
    state.today = todayISO();
    state.dailySummary = { jobs: 0, revenue: 0, enquiries: 0, emails: 0, posts: 0 };
    saveState(state);
  }

  // Find due tasks
  const dueTasks = Object.keys(AGENTS).filter(id => isDue(id, state));

  if (dueTasks.length === 0) {
    log('😴 No tasks due at ' + new Date().toLocaleTimeString('en-GB'));
    return;
  }

  log('📋 Due tasks: ' + dueTasks.map(id => AGENTS[id].label).join(', '));
  log('');

  // Check if any task needs Ollama
  const needsOllama = dueTasks.some(id => AGENTS[id].needsOllama);
  if (needsOllama) {
    await ensureOllama();
  }

  // Run each due task sequentially
  for (const agentId of dueTasks) {
    const agent = AGENTS[agentId];

    try {
      let result;

      if (agentId === 'health-check') {
        const checks = await runHealthCheck();
        // Only send to Telegram if there are issues
        const issues = checks.filter(c => c.status !== '✅');
        if (issues.length > 0) {
          let msg = '🏥 <b>HEALTH CHECK — Issues Found</b>\n\n';
          checks.forEach(c => { msg += c.status + ' ' + c.name + ': ' + c.detail + '\n'; });
          await sendTelegram(msg);
        }
        result = { success: true };
        log('✅ Health check: ' + checks.filter(c => c.status === '✅').length + '/' + checks.length + ' OK');

      } else if (agentId === 'evening-summary') {
        result = await runEveningSummary(state);

      } else {
        result = await runAgent(agentId);
      }

      if (result.success) {
        state.lastRuns[agentId] = new Date().toISOString();
        saveState(state);
      }

    } catch(err) {
      log('❌ ' + agent.label + ' error: ' + err.message);
      await sendTelegram('⚠️ <b>ORCHESTRATOR ERROR</b>\n\n' + agent.label + ': ' + escHtml(err.message));
    }
  }

  log('');
  log('✅ Orchestrator cycle complete');
}


// ══════════════════════════════════════════════
// ENTRY POINT
// ══════════════════════════════════════════════

main().catch(err => {
  console.error('Fatal:', err);
  sendTelegram('❌ <b>ORCHESTRATOR FATAL</b>\n\n' + err.message).then(() => process.exit(1));
});
