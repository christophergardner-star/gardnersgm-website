#!/usr/bin/env node
// ============================================
// Gardners GM — Email Lifecycle Agent
// Runs daily at 07:30 via Windows Task Scheduler
// Triggers the Hub's EmailAutomationEngine via command queue.
// The Hub (PC) owns ALL email sending — no direct GAS lifecycle calls.
//
// Modes:
//   daily     — trigger Hub full lifecycle (all types)
//   seasonal  — trigger Hub lifecycle including seasonal tips
//   report    — fetch email tracking history from GAS
// ============================================

const https = require('https');
const http  = require('http');

try { require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') }); } catch(e) {}

const WEBHOOK = process.env.SHEETS_WEBHOOK || '';
const TG_BOT  = process.env.TG_BOT_TOKEN || '';
const TG_CHAT = process.env.TG_CHAT_ID || '';

// ─── HTTP helpers ───

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    mod.get(url, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchJSON(res.headers.location).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(new Error('Parse error: ' + data.substring(0, 200))); }
      });
    }).on('error', reject);
  });
}

function postJSON(url, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const parsed = new URL(url);
    
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain',
        'Content-Length': Buffer.byteLength(payload)
      }
    };
    
    // Follow redirects recursively (Apps Script returns 302 → GET)
    function followGet(location) {
      return new Promise((res, rej) => {
        const rUrl = new URL(location);
        const rMod = rUrl.protocol === 'https:' ? https : http;
        rMod.get(location, rResp => {
          if (rResp.statusCode >= 300 && rResp.statusCode < 400 && rResp.headers.location) {
            return followGet(rResp.headers.location).then(res).catch(rej);
          }
          let d = '';
          rResp.on('data', c => d += c);
          rResp.on('end', () => {
            try { res(JSON.parse(d)); }
            catch(e) { res({ raw: d.substring(0, 500) }); }
          });
        }).on('error', rej);
      });
    }
    
    const mod = parsed.protocol === 'https:' ? https : http;
    const req = mod.request(options, response => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        return followGet(response.headers.location).then(resolve).catch(reject);
      }
      let d = '';
      response.on('data', c => d += c);
      response.on('end', () => {
        try { resolve(JSON.parse(d)); }
        catch(e) { resolve({ raw: d.substring(0, 500) }); }
      });
    }).on('error', reject);
    req.write(payload);
    req.end();
  });
}

function sendTelegram(text) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      chat_id: TG_CHAT,
      text: text,
      parse_mode: 'HTML'
    });
    const options = {
      hostname: 'api.telegram.org',
      path: `/bot${TG_BOT}/sendMessage`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    };
    const req = https.request(options, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve(d));
    }).on('error', reject);
    req.write(payload);
    req.end();
  });
}

// ─── Format date ───

function fmtDate(d) {
  const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  return days[d.getDay()] + ' ' + d.getDate() + '/' + (d.getMonth()+1) + '/' + d.getFullYear();
}

// ─── Main ───

async function main() {
  const mode = (process.argv[2] || 'daily').toLowerCase();
  const now = new Date();
  
  console.log(`[${now.toISOString()}] Email Lifecycle Agent — mode: ${mode}`);
  
  if (mode === 'report') {
    // Just fetch and display email history
    try {
      const history = await fetchJSON(WEBHOOK + '?action=get_email_history');
      if (history.emails && history.emails.length > 0) {
        const last10 = history.emails.slice(-10);
        let msg = '📧 <b>EMAIL HISTORY (Last 10)</b>\n\n';
        for (const e of last10) {
          const d = e.date ? new Date(e.date) : new Date();
          msg += `📨 <b>${e.type}</b> → ${e.name}\n`;
          msg += `   📋 ${e.service || 'N/A'} | ${fmtDate(d)}\n`;
          msg += `   📝 ${e.subject || ''}\n\n`;
        }
        msg += `📊 Total tracked: ${history.emails.length} emails`;
        await sendTelegram(msg);
        console.log(`Report sent: ${history.emails.length} total emails tracked`);
      } else {
        await sendTelegram('📧 <b>EMAIL HISTORY</b>\n\nNo emails tracked yet.');
        console.log('No email history found');
      }
    } catch(e) {
      console.error('Report failed:', e.message);
    }
    return;
  }
  
  // ─── Daily / Seasonal processing ───
  // Hub owns all email sending. We queue a command so the Hub runs its full lifecycle.
  try {
    const includeSeasonal = mode === 'seasonal';
    
    console.log('Queuing email lifecycle command for Hub...');
    const cmdResult = await postJSON(WEBHOOK, {
      action: 'queue_remote_command',
      command: 'run_email_lifecycle',
      data: JSON.stringify({ includeSeasonal: includeSeasonal }),
      source: 'email_lifecycle_agent',
      target: 'pc_hub'
    });
    
    if (cmdResult.status === 'success') {
      let msg = `📧 <b>EMAIL LIFECYCLE — Command Queued</b>\n`;
      msg += `📅 ${fmtDate(now)}\n\n`;
      msg += `✅ Full lifecycle run queued for Hub.\n`;
      msg += `Mode: <b>${mode}</b>${includeSeasonal ? ' (including seasonal tips)' : ''}\n`;
      msg += `\nThe Hub will process all 15 email types:\n`;
      msg += `📅 Reminders | 🌱 Aftercare | ✅ Completions\n`;
      msg += `📄 Invoices | 🎉 Confirmations | 💬 Follow-ups\n`;
      msg += `👋 Welcomes | 💚 Loyalty | 🌻 Re-engagement\n`;
      msg += `🌸 Seasonal | ✨ Promos | 🎁 Referrals | ⬆️ Upgrades\n`;
      msg += `\n📊 Results will appear in Hub logs.`;
      
      await sendTelegram(msg);
      console.log('Command queued successfully. Hub will process.');
    } else {
      console.log('Queue result:', JSON.stringify(cmdResult));
      await sendTelegram('⚠️ <b>EMAIL LIFECYCLE</b>\n\nFailed to queue command: ' + (cmdResult.message || 'Unknown'));
    }
    
  } catch(e) {
    console.error('Email lifecycle failed:', e.message);
    await sendTelegram('❌ <b>EMAIL LIFECYCLE FAILED</b>\n\n' + e.message);
  }
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
