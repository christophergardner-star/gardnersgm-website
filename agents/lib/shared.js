/* ══════════════════════════════════════════════════════
   Gardners GM — Shared Agent Library
   Common utilities used by all agents:
     • HTTP fetch (follows Google Apps Script redirects)
     • Telegram messaging (auto-splits long messages)
     • Ollama LLM interface (auto-detects best model)
     • File logging with rotation
     • API helpers
   ══════════════════════════════════════════════════════ */

const https = require('https');
const http  = require('http');
const fs    = require('fs');
const path  = require('path');

try { require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') }); } catch(e) {}

// ── Config from .env ──
const CONFIG = {
  WEBHOOK:    process.env.SHEETS_WEBHOOK || '',
  TG_BOT:    process.env.TG_BOT_TOKEN || '',
  TG_CHAT:   process.env.TG_CHAT_ID || '',
  PEXELS_KEY: process.env.PEXELS_KEY || '',
  OLLAMA_URL: process.env.OLLAMA_URL || 'http://localhost:11434',
  OLLAMA_MODEL: process.env.OLLAMA_MODEL || '',  // auto-detect if empty
  // Docker service URLs (via Tailscale or localhost)
  LISTMONK_URL:  process.env.LISTMONK_URL || 'http://localhost:9000',
  LISTMONK_USER: process.env.LISTMONK_USER || 'admin',
  LISTMONK_PASS: process.env.LISTMONK_PASSWORD || '',
  DIFY_URL:      process.env.DIFY_URL || 'http://localhost:3000',
  DIFY_API_KEY:  process.env.DIFY_API_KEY || '',
  N8N_URL:       process.env.N8N_URL || 'http://localhost:5678',
  // Tailscale mesh VPN hostnames
  TAILSCALE_PC:     process.env.TAILSCALE_PC || 'ggm-pc',
  TAILSCALE_LAPTOP: process.env.TAILSCALE_LAPTOP || 'ggm-laptop',
};

// ══════════════════════════════════════════════
// HTTP FETCH — with Apps Script redirect following
// ══════════════════════════════════════════════

function fetchJSON(url, options = {}) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const reqOpts = {
      headers: { 'Accept': 'application/json', 'User-Agent': 'GardnersGM-Agent/2.0', ...options.headers }
    };
    mod.get(url, reqOpts, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchJSON(res.headers.location, options).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(new Error('JSON parse error: ' + data.substring(0, 200))); }
      });
    }).on('error', reject);
  });
}

function postJSON(url, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const parsed = new URL(url);
    const mod = parsed.protocol === 'https:' ? https : http;

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

    const req = mod.request({
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: { 'Content-Type': 'text/plain', 'Content-Length': Buffer.byteLength(payload) }
    }, response => {
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

// Convenience: GET from the Apps Script API
function apiFetch(action) {
  if (!CONFIG.WEBHOOK) throw new Error('SHEETS_WEBHOOK not set in .env');
  return fetchJSON(CONFIG.WEBHOOK + '?action=' + action);
}

// Convenience: POST to the Apps Script API
function apiPost(body) {
  if (!CONFIG.WEBHOOK) throw new Error('SHEETS_WEBHOOK not set in .env');
  return postJSON(CONFIG.WEBHOOK, body);
}


// ══════════════════════════════════════════════
// TELEGRAM — auto-splits long messages
// ══════════════════════════════════════════════

async function sendTelegram(text, parseMode = 'HTML') {
  if (!CONFIG.TG_BOT || !CONFIG.TG_CHAT) {
    console.log('[TG] No bot token or chat ID — skipping Telegram');
    return;
  }

  // Telegram message limit is 4096 chars
  const MAX = 4000;
  const chunks = [];
  if (text.length <= MAX) {
    chunks.push(text);
  } else {
    let remaining = text;
    while (remaining.length > 0) {
      if (remaining.length <= MAX) { chunks.push(remaining); break; }
      let cut = remaining.lastIndexOf('\n', MAX);
      if (cut < 500) cut = MAX;
      chunks.push(remaining.substring(0, cut));
      remaining = remaining.substring(cut);
    }
  }

  for (const chunk of chunks) {
    await _sendTgChunk(chunk, parseMode);
    if (chunks.length > 1) await sleep(500);
  }
}

function _sendTgChunk(text, parseMode) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      chat_id: CONFIG.TG_CHAT,
      text,
      parse_mode: parseMode,
      disable_web_page_preview: true
    });
    const req = https.request({
      hostname: 'api.telegram.org',
      path: `/bot${CONFIG.TG_BOT}/sendMessage`,
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


// ══════════════════════════════════════════════
// OLLAMA — Local LLM with auto-model detection
// ══════════════════════════════════════════════

// Model preference order — bigger = better content, but needs more RAM
// 64GB RAM can comfortably run up to ~30B params in Q4
const MODEL_PREFERENCE = [
  'llama3.1:70b',      // Best quality — needs ~40GB RAM (might be tight)
  'llama3.3:latest',   // Very good 70B-level quality
  'qwen2.5:32b',       // Excellent 32B — ~20GB RAM
  'deepseek-r1:32b',   // Strong reasoning
  'mistral-small:latest', // 22B — great quality/speed balance
  'llama3.1:latest',   // 8B — reliable fallback
  'llama3.2:latest',   // 3B — lightweight, always works on 64GB
  'llama3.2',          // Alt tag
  'mistral:latest',    // 7B fallback
  'gemma2:latest',     // 9B fallback
];

let _detectedModel = null;

async function detectBestModel() {
  if (_detectedModel) return _detectedModel;
  if (CONFIG.OLLAMA_MODEL) { _detectedModel = CONFIG.OLLAMA_MODEL; return _detectedModel; }

  try {
    const resp = await fetchJSON(CONFIG.OLLAMA_URL + '/api/tags');
    const available = (resp.models || []).map(m => m.name);
    console.log('[Ollama] Available models: ' + available.join(', '));

    for (const pref of MODEL_PREFERENCE) {
      if (available.some(a => a === pref || a.startsWith(pref.split(':')[0] + ':'))) {
        _detectedModel = available.find(a => a === pref || a.startsWith(pref.split(':')[0] + ':')) || pref;
        console.log('[Ollama] Selected model: ' + _detectedModel);
        return _detectedModel;
      }
    }

    // Fallback: use whatever's installed
    if (available.length > 0) {
      _detectedModel = available[0];
      console.log('[Ollama] Fallback model: ' + _detectedModel);
      return _detectedModel;
    }

    throw new Error('No models installed');
  } catch(e) {
    console.error('[Ollama] Model detection failed:', e.message);
    _detectedModel = 'llama3.2';
    return _detectedModel;
  }
}

async function askOllama(prompt, options = {}) {
  const model = await detectBestModel();
  const temp = options.temperature ?? 0.7;
  const maxTokens = options.maxTokens ?? 2048;

  const resp = await new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      model,
      prompt,
      stream: false,
      options: { temperature: temp, num_predict: maxTokens, top_p: 0.9 }
    });
    const url = new URL(CONFIG.OLLAMA_URL + '/api/generate');
    const mod = url.protocol === 'https:' ? https : http;
    const req = mod.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d)); }
        catch(e) { reject(new Error('Ollama parse error: ' + d.substring(0, 200))); }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });

  return (resp.response || '').trim();
}

async function isOllamaRunning() {
  try {
    await fetchJSON(CONFIG.OLLAMA_URL + '/api/tags');
    return true;
  } catch(e) {
    return false;
  }
}


// ══════════════════════════════════════════════
// LOGGING — file + console with rotation
// ══════════════════════════════════════════════

function createLogger(agentName) {
  const logDir = path.join(__dirname, '..');
  const logFile = path.join(logDir, agentName + '.log');

  // Rotate if over 1MB
  try {
    const stats = fs.statSync(logFile);
    if (stats.size > 1024 * 1024) {
      const archiveName = logFile.replace('.log', '-' + new Date().toISOString().slice(0, 10) + '.log');
      fs.renameSync(logFile, archiveName);
    }
  } catch(e) {} // file doesn't exist yet

  function log(msg) {
    const ts = new Date().toLocaleTimeString('en-GB');
    const line = '[' + ts + '] ' + msg;
    console.log(line);
    try { fs.appendFileSync(logFile, line + '\n'); } catch(e) {}
  }

  return log;
}


// ══════════════════════════════════════════════
// CONTENT SANITISER — Fix hallucinated details
// ══════════════════════════════════════════════

function sanitiseContent(text) {
  // Fix phone numbers
  text = text.replace(/\b0\d{3,4}\s?\d{3}\s?\d{3,4}\b/g, '01726 432051');
  text = text.replace(/\b01234\s?567\s?890\b/g, '01726 432051');
  // Fix emails
  text = text.replace(/info@gardners?ground(maintenance|maint)\.co\.uk/gi, 'info@gardnersgm.co.uk');
  text = text.replace(/contact@gardners?ground(maintenance|maint)\.co\.uk/gi, 'info@gardnersgm.co.uk');
  text = text.replace(/hello@gardners?ground(maintenance|maint)\.co\.uk/gi, 'info@gardnersgm.co.uk');
  text = text.replace(/info@gardners?gm(aint|aintenance)?\.co\.uk/gi, 'info@gardnersgm.co.uk');
  // Fix domains
  text = text.replace(/gardnersgroundmaintenance\.co\.uk/gi, 'gardnersgm.co.uk');
  text = text.replace(/gardnergroundmaintenance\.co\.uk/gi, 'gardnersgm.co.uk');
  text = text.replace(/www\.gardnersgm\.co\.uk/gi, 'gardnersgm.co.uk');
  // Clean markdown link syntax
  text = text.replace(/\[([^\]]+)\]\(mailto:[^\)]+\)/g, '$1');
  text = text.replace(/\[([^\]]+)\]\(tel:[^\)]+\)/g, '$1');
  return text;
}


// ══════════════════════════════════════════════
// UTILITY HELPERS
// ══════════════════════════════════════════════

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function fmtGBP(v) {
  const n = parseFloat(v);
  return isNaN(n) ? '£0.00' : '£' + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function fmtDate(d) {
  const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  return days[d.getDay()] + ' ' + d.getDate() + '/' + (d.getMonth()+1) + '/' + d.getFullYear();
}

function escHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}


// ══════════════════════════════════════════════
// EXPORTS
// ══════════════════════════════════════════════

module.exports = {
  CONFIG,
  fetchJSON,
  postJSON,
  apiFetch,
  apiPost,
  sendTelegram,
  askOllama,
  detectBestModel,
  isOllamaRunning,
  createLogger,
  sanitiseContent,
  sleep,
  fmtGBP,
  fmtDate,
  escHtml,
  todayISO,
  MODEL_PREFERENCE,
};
