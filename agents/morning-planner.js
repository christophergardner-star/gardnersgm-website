/* ============================================================
   Gardners GM — Morning Planner Agent
   Automated Telegram briefings:
     06:15 → Week-ahead overview (Mon-Sat)
     06:45 → Today's detailed job sheet
   
   Also handles live change notifications when called with:
     node morning-planner.js change <type> <json>
   
   Usage:
     node morning-planner.js today    → send today's briefing
     node morning-planner.js week     → send rest-of-week
     node morning-planner.js auto     → smart: if before 06:30 send week, else today
   ============================================================ */

const https = require('https');
const http  = require('http');

try { require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') }); } catch(e) {}

// ── Config ──
const WEBHOOK   = process.env.SHEETS_WEBHOOK || '';
const TG_TOKEN  = process.env.TG_BOT_TOKEN || '';
const TG_CHAT   = process.env.TG_CHAT_ID || '';

// ── Service info (mirrors today.js) ──
const SERVICE_INFO = {
  'lawn-cutting':     { hours: 1,   label: 'Lawn Cutting',      icon: '✂️' },
  'hedge-trimming':   { hours: 3,   label: 'Hedge Trimming',    icon: '🌿' },
  'lawn-treatment':   { hours: 2,   label: 'Lawn Treatment',    icon: '💧' },
  'scarifying':       { hours: 8,   label: 'Scarifying',        icon: '🔧' },
  'garden-clearance': { hours: 8,   label: 'Garden Clearance',  icon: '🧹' },
  'power-washing':    { hours: 8,   label: 'Power Washing',     icon: '💦' }
};

// ── Helpers ──
function normaliseService(s) {
  return (s || '').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

function parsePrice(val) {
  if (!val) return 0;
  const n = parseFloat(String(val).replace(/[^0-9.\-]/g, ''));
  return isNaN(n) ? 0 : n;
}

function formatISO(d) {
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
}

function dayName(d) {
  return ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][d.getDay()];
}

function dateLabel(d) {
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return dayName(d) + ' ' + d.getDate() + ' ' + months[d.getMonth()];
}

function calcEndTime(slot, hours) {
  const m = slot.match(/^(\d{2}):(\d{2})/);
  if (!m) return '';
  let h = parseInt(m[1]) + hours;
  if (h > 17) h = 17;
  return String(h).padStart(2, '0') + ':' + m[2];
}

// ── HTTP fetch helpers ──
function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    mod.get(url, { headers: { 'Accept': 'application/json' } }, res => {
      // Follow redirects (Google Apps Script does 302)
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchJSON(res.headers.location).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('JSON parse error: ' + data.substring(0, 200))); }
      });
    }).on('error', reject);
  });
}

function sendTelegram(text, parseMode = 'HTML') {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      chat_id: TG_CHAT,
      text,
      parse_mode: parseMode,
      disable_web_page_preview: true
    });
    const req = https.request({
      hostname: 'api.telegram.org',
      path: `/bot${TG_TOKEN}/sendMessage`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve(d));
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// ── Data loaders ──
async function loadAllJobs() {
  const resp = await fetchJSON(WEBHOOK + '?action=get_clients');
  return (resp.clients || []).filter(c => {
    const status = (c.status || '').toLowerCase();
    return status !== 'cancelled' && status !== 'canceled';
  });
}

async function loadScheduleVisits() {
  try {
    const resp = await fetchJSON(WEBHOOK + '?action=get_schedule');
    if (resp.status === 'success' && resp.schedule) return resp.schedule;
  } catch (e) {}
  return [];
}

function getJobsForDate(allJobs, scheduleVisits, dateStr) {
  const jobs = [];

  // Bookings from Jobs sheet
  allJobs.forEach(c => {
    const d = c.date || c.timestamp;
    if (!d) return;
    const jd = new Date(d);
    if (formatISO(jd) === dateStr) {
      const svc = normaliseService(c.service || c.type);
      const info = SERVICE_INFO[svc] || { hours: 1, label: c.service || 'Job', icon: '📋' };
      jobs.push({
        name: c.name || 'Unknown',
        service: info.label,
        icon: info.icon,
        time: c.time || 'TBC',
        endTime: calcEndTime(c.time || '', info.hours),
        hours: info.hours,
        address: (c.address || '') + (c.postcode ? ', ' + c.postcode : ''),
        postcode: c.postcode || '',
        distance: c.distance || '',
        phone: c.phone || '',
        price: parsePrice(c.price),
        jobNumber: c.jobNumber || '',
        notes: c.notes || '',
        source: 'booking',
        mapsUrl: c.googleMapsUrl || ''
      });
    }
  });

  // Subscription visits from Schedule sheet
  scheduleVisits.forEach(v => {
    const vDate = v.date instanceof Date ? formatISO(v.date) : String(v.date || '').substring(0, 10);
    if (vDate !== dateStr) return;
    const status = (v.status || '').toLowerCase();
    if (status === 'cancelled' || status === 'completed' || status === 'skipped') return;
    const svc = normaliseService(v.service || 'lawn-cutting');
    const info = SERVICE_INFO[svc] || { hours: 1, label: v.service || 'Service Visit', icon: '🌿' };
    jobs.push({
      name: (v.name || 'Subscriber') + ' (sub)',
      service: info.label,
      icon: info.icon,
      time: 'TBC',
      endTime: '',
      hours: info.hours,
      address: (v.address || '') + (v.postcode ? ', ' + v.postcode : ''),
      postcode: v.postcode || '',
      distance: v.distance || '',
      phone: v.phone || '',
      price: 0,
      jobNumber: v.parentJob || '',
      notes: v.notes || '',
      source: 'subscription',
      mapsUrl: ''
    });
  });

  // Sort by time
  jobs.sort((a, b) => (a.time || '99:99').localeCompare(b.time || '99:99'));
  return jobs;
}

// ══════════════════════════════════════════════
// TODAY'S BRIEFING — detailed job-by-job
// ══════════════════════════════════════════════
async function sendTodayBriefing() {
  console.log('📋 Loading today\'s jobs...');
  const [allJobs, schedVisits] = await Promise.all([loadAllJobs(), loadScheduleVisits()]);
  const today = new Date();
  const dateStr = formatISO(today);
  const jobs = getJobsForDate(allJobs, schedVisits, dateStr);

  // Fetch weather forecast
  let weatherBlock = '';
  try {
    const weatherResp = await fetchJSON(WEBHOOK + '?action=get_weather');
    if (weatherResp.status === 'success' && weatherResp.forecast && weatherResp.forecast.daily) {
      const todayFc = weatherResp.forecast.daily.find(d => d.dateISO === dateStr);
      if (todayFc) {
        const sev = todayFc.severity || {};
        const weatherIcon = sev.shouldCancel ? '⛈️' : sev.isAdvisory ? '🌦️' : todayFc.rainChance > 50 ? '🌧️' : '☀️';
        weatherBlock = `\n${weatherIcon} <b>Weather</b>: ${todayFc.description || 'N/A'}\n`;
        weatherBlock += `   🌡️ ${todayFc.tempMax}°C / ${todayFc.tempMin}°C`;
        weatherBlock += `  💨 ${todayFc.windSpeed}mph`;
        if (todayFc.windGust > 30) weatherBlock += ` (gusts ${todayFc.windGust}mph)`;
        weatherBlock += `  🌧️ ${todayFc.rainChance}%`;
        if (todayFc.rainMM > 0) weatherBlock += ` (${todayFc.rainMM}mm)`;
        weatherBlock += `\n`;
        if (sev.shouldCancel) {
          weatherBlock += `   🔴 <b>WARNING:</b> ${sev.reasons.join('; ')}\n`;
          weatherBlock += `   <i>Auto-cancel may trigger at 6pm for tomorrow's jobs</i>\n`;
        } else if (sev.isAdvisory) {
          weatherBlock += `   🟡 <b>Advisory:</b> ${sev.reasons.join('; ')}\n`;
        }
      }
    }
  } catch(e) { console.log('Weather fetch failed: ' + e.message); }

  if (jobs.length === 0) {
    let msg = `☀️ <b>Good Morning!</b>\n\n📅 ${dateLabel(today)}\n`;
    if (weatherBlock) msg += weatherBlock;
    msg += `\n🎉 <i>No jobs today — enjoy the day off!</i>\n\n🌿 Gardners Ground Maintenance`;
    await sendTelegram(msg);
    console.log('✅ Sent: no jobs today');
    return;
  }

  let totalRev = 0, totalHours = 0, totalMiles = 0;
  let msg = `☀️ <b>MORNING BRIEFING — ${dateLabel(today)}</b>\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━\n`;
  if (weatherBlock) msg += weatherBlock + `━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `🗂 <b>${jobs.length} job${jobs.length > 1 ? 's' : ''}</b> today\n\n`;

  jobs.forEach((j, i) => {
    totalRev += j.price;
    totalHours += j.hours;
    totalMiles += (parseFloat(j.distance) || 0) * 2;

    msg += `<b>${i + 1}. ${j.name}</b>`;
    if (j.jobNumber) msg += ` <code>${j.jobNumber}</code>`;
    msg += `\n`;
    msg += `   ${j.icon} ${j.service}\n`;
    msg += `   🕐 ${j.time}${j.endTime ? ' → ' + j.endTime : ''} (~${j.hours}h)\n`;
    if (j.address) msg += `   📍 ${j.address}\n`;
    if (j.distance) msg += `   🚗 ${j.distance} miles\n`;
    if (j.price > 0) msg += `   💷 £${j.price.toFixed(0)}\n`;
    if (j.phone) msg += `   📞 ${j.phone}\n`;
    if (j.notes) msg += `   📝 ${j.notes}\n`;
    msg += `\n`;
  });

  msg += `━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `💰 Revenue: <b>£${totalRev.toFixed(0)}</b>\n`;
  msg += `⏱ Est. hours: <b>${totalHours}h</b>\n`;
  if (totalMiles > 0) msg += `🚗 Est. miles: <b>${Math.round(totalMiles)}</b>\n`;
  msg += `\n☀️ Have a great day, Chris!`;

  await sendTelegram(msg);
  console.log(`✅ Sent today's briefing: ${jobs.length} jobs, £${totalRev.toFixed(0)}`);
}

// ══════════════════════════════════════════════
// WEEK-AHEAD — overview for rest of the week
// ══════════════════════════════════════════════
async function sendWeekAhead() {
  console.log('📅 Loading week-ahead overview...');
  const [allJobs, schedVisits] = await Promise.all([loadAllJobs(), loadScheduleVisits()]);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Fetch weather forecast for the week
  let weatherDaily = {};
  try {
    const weatherResp = await fetchJSON(WEBHOOK + '?action=get_weather');
    if (weatherResp.status === 'success' && weatherResp.forecast && weatherResp.forecast.daily) {
      weatherResp.forecast.daily.forEach(d => { weatherDaily[d.dateISO] = d; });
    }
  } catch(e) { console.log('Weather fetch failed: ' + e.message); }

  // Build 7 days from today (including today)
  let msg = `📅 <b>WEEK PLANNER — ${dateLabel(today)} onwards</b>\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━\n\n`;

  let totalJobs = 0, totalRev = 0, freeDays = 0;

  for (let d = 0; d < 7; d++) {
    const dt = new Date(today.getTime() + d * 86400000);
    if (dt.getDay() === 0) continue; // Skip Sundays
    const dateStr = formatISO(dt);
    const jobs = getJobsForDate(allJobs, schedVisits, dateStr);
    const isToday = d === 0;

    if (jobs.length === 0) {
      const wf = weatherDaily[dateStr];
      const wIcon = wf ? (wf.severity && wf.severity.shouldCancel ? '⛈️' : wf.rainChance > 50 ? '🌧️' : '☀️') : '';
      msg += `📅 <b>${dateLabel(dt)}</b>${isToday ? ' (TODAY)' : ''} ${wIcon}\n`;
      msg += `   <i>— No jobs scheduled</i>\n\n`;
      freeDays++;
      continue;
    }

    totalJobs += jobs.length;
    const dayRev = jobs.reduce((s, j) => s + j.price, 0);
    const dayHours = jobs.reduce((s, j) => s + j.hours, 0);
    totalRev += dayRev;

    const wf = weatherDaily[dateStr];
    const wIcon = wf ? (wf.severity && wf.severity.shouldCancel ? '⛈️' : wf.rainChance > 50 ? '🌧️' : '☀️') : '';
    let wWarn = '';
    if (wf && wf.severity && wf.severity.shouldCancel) wWarn = ` 🔴`;
    msg += `📅 <b>${dateLabel(dt)}</b>${isToday ? ' (TODAY)' : ''} ${wIcon}${wWarn} — ${jobs.length} job${jobs.length > 1 ? 's' : ''} (~${dayHours}h)\n`;
    jobs.forEach(j => {
      msg += `   ${j.icon} ${j.service} — ${j.name}`;
      if (j.time !== 'TBC') msg += ` [${j.time}]`;
      if (j.price > 0) msg += ` £${j.price.toFixed(0)}`;
      msg += `\n`;
    });
    msg += `\n`;
  }

  msg += `━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `📊 <b>Week Summary</b>\n`;
  msg += `   🗂 ${totalJobs} jobs across ${6 - freeDays} working days\n`;
  msg += `   💰 Est. revenue: <b>£${totalRev.toFixed(0)}</b>\n`;
  if (freeDays > 0) msg += `   🎯 ${freeDays} free day${freeDays > 1 ? 's' : ''} — room for new bookings!\n`;
  msg += `\n🌿 <i>Gardners Ground Maintenance</i>`;

  await sendTelegram(msg);
  console.log(`✅ Sent week planner: ${totalJobs} jobs, £${totalRev.toFixed(0)}`);
}

// ══════════════════════════════════════════════
// MAIN
// ══════════════════════════════════════════════
async function main() {
  const mode = (process.argv[2] || 'auto').toLowerCase();

  try {
    if (mode === 'today') {
      await sendTodayBriefing();
    } else if (mode === 'week') {
      await sendWeekAhead();
    } else if (mode === 'auto') {
      // Smart: 06:15 = week, 06:45 = today
      const hour = new Date().getHours();
      const min = new Date().getMinutes();
      if (hour < 6 || (hour === 6 && min < 30)) {
        await sendWeekAhead();
      } else {
        await sendTodayBriefing();
      }
    } else {
      console.log('Usage: node morning-planner.js [today|week|auto]');
    }
  } catch (err) {
    console.error('❌ Error:', err.message);
    try {
      await sendTelegram(`⚠️ <b>Morning Planner Error</b>\n\n${err.message}`);
    } catch (e) {}
    process.exit(1);
  }
}

main();
