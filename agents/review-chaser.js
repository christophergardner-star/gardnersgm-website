#!/usr/bin/env node
/* ══════════════════════════════════════════════════════
   Gardners GM — Review Chaser Agent
   
   Follows up with customers after job completion to
   request Google reviews and testimonials.
   
   Logic:
   • Finds jobs completed in the last 3-7 days
   • Skips clients who already have a testimonial
   • Skips clients already contacted for review
   • Generates a personalised, friendly follow-up email via Ollama
   • Sends via GAS email system
   • Reports activity to Telegram
   
   Usage:
     node agents/review-chaser.js         → Process review requests
     node agents/review-chaser.js check   → List eligible clients (no emails sent)
     node agents/review-chaser.js test    → Generate email but don't send
   ══════════════════════════════════════════════════════ */

const path = require('path');
const fs   = require('fs');
const { apiFetch, apiPost, sendTelegram, askOllama, isOllamaRunning,
        detectBestModel, createLogger, CONFIG } = require('./lib/shared');

const log = createLogger('review-chaser');

const STATE_FILE = path.join(__dirname, '.review-chaser-state.json');

const GOOGLE_REVIEW_URL = 'https://g.page/r/gardnersgm/review'; // Update with actual Google review link

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); }
  catch(e) { return { contacted: {}, lastRun: '' }; }
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}


// ══════════════════════════════════════════════
// FIND ELIGIBLE CLIENTS
// ══════════════════════════════════════════════

async function getEligibleClients() {
  // Get all clients
  const clientsRaw = await apiFetch('get_clients');
  const clients = Array.isArray(clientsRaw) ? clientsRaw : (clientsRaw.clients || clientsRaw.data || []);
  
  // Get testimonials to exclude clients who already left one
  let testimonialEmails = new Set();
  try {
    const testsRaw = await apiFetch('get_all_testimonials');
    const tests = Array.isArray(testsRaw) ? testsRaw : (testsRaw.testimonials || testsRaw.data || []);
    tests.forEach(t => {
      if (t.email) testimonialEmails.add(t.email.toLowerCase());
    });
  } catch(e) { /* non-critical */ }

  const state = loadState();
  const now = new Date();
  const eligible = [];

  for (const client of clients) {
    // Must be complete
    if ((client.status || '').toLowerCase() !== 'complete') continue;
    
    // Must have email
    if (!client.email || !client.email.includes('@')) continue;
    
    // Must have been completed 3-7 days ago
    const dateStr = client.date || client.preferredDate || '';
    if (!dateStr) continue;
    
    let jobDate;
    try {
      // Try various date formats
      if (dateStr.includes('T')) jobDate = new Date(dateStr);
      else if (dateStr.includes('/')) {
        const parts = dateStr.split('/');
        jobDate = new Date(parts[2], parts[1]-1, parts[0]);
      } else {
        jobDate = new Date(dateStr);
      }
    } catch(e) { continue; }
    
    if (isNaN(jobDate.getTime())) continue;
    
    const daysSince = Math.floor((now - jobDate) / (1000 * 60 * 60 * 24));
    if (daysSince < 3 || daysSince > 7) continue;
    
    // Skip if already has testimonial
    if (testimonialEmails.has(client.email.toLowerCase())) continue;
    
    // Skip if already contacted in last 30 days
    const contactKey = client.email.toLowerCase();
    if (state.contacted[contactKey]) {
      const lastContacted = new Date(state.contacted[contactKey]);
      const daysSinceContact = Math.floor((now - lastContacted) / (1000 * 60 * 60 * 24));
      if (daysSinceContact < 30) continue;
    }
    
    eligible.push({
      name: client.name || 'Customer',
      email: client.email,
      service: client.service || 'garden maintenance',
      date: dateStr,
      daysSince,
    });
  }

  return eligible;
}


// ══════════════════════════════════════════════
// GENERATE REVIEW REQUEST EMAIL
// ══════════════════════════════════════════════

async function generateReviewEmail(client, model) {
  const prompt = `Write a short, friendly follow-up email from Chris at Gardners Ground Maintenance (Cornwall gardening company).

The customer's name is ${client.name}. We completed ${client.service} for them ${client.daysSince} days ago.

The email should:
- Thank them warmly for choosing us
- Ask how the garden is looking
- Politely ask if they'd leave a quick Google review (include this link: ${GOOGLE_REVIEW_URL})
- Mention they can also leave a testimonial on our website at gardnersgm.co.uk/testimonials.html
- Be brief (4-6 sentences max), warm and professional
- Sign off as "Chris" from "Gardners Ground Maintenance"
- Do NOT use any placeholder text or brackets
- Do NOT include a subject line — just the body text

Write ONLY the email body text, nothing else.`;

  try {
    const body = await ollamaGenerate(prompt, model);
    return body.trim();
  } catch(e) {
    // Fallback template if Ollama unavailable
    return `Hi ${client.name},

Thank you for choosing Gardners Ground Maintenance for your recent ${client.service}! I hope you're happy with how everything turned out.

If you have a moment, we'd really appreciate a quick Google review — it helps other Cornwall homeowners find us: ${GOOGLE_REVIEW_URL}

You can also share your experience on our testimonials page at gardnersgm.co.uk/testimonials.html

Thanks again, and don't hesitate to get in touch if you need anything!

Best wishes,
Chris
Gardners Ground Maintenance`;
  }
}


// ══════════════════════════════════════════════
// SEND REVIEW REQUEST
// ══════════════════════════════════════════════

async function sendReviewEmail(client, emailBody) {
  const result = await apiPost({
    action: 'send_enquiry_reply',
    email: client.email,
    name: client.name,
    subject: `How's the garden looking, ${client.name}? 🌿`,
    body: emailBody,
    replyType: 'review_request'
  });
  return result;
}


// ══════════════════════════════════════════════
// MAIN
// ══════════════════════════════════════════════

async function run(mode = 'live') {
  log.info(`Review chaser starting (mode: ${mode})...`);
  
  const eligible = await getEligibleClients();
  
  if (eligible.length === 0) {
    log.info('No eligible clients for review requests');
    if (mode === 'check') {
      await sendTelegram('⭐ *Review Chaser*\nNo eligible clients for review requests today.');
    }
    return;
  }

  log.info(`Found ${eligible.length} eligible client(s)`);

  if (mode === 'check') {
    let msg = `⭐ *Review Chaser — Eligible Clients*\n\n`;
    eligible.forEach(c => {
      msg += `👤 ${c.name}\n`;
      msg += `   📧 ${c.email}\n`;
      msg += `   🔧 ${c.service} (${c.daysSince} days ago)\n\n`;
    });
    await sendTelegram(msg);
    return;
  }

  // Detect AI model
  let model = CONFIG.OLLAMA_MODEL;
  if (!model && await isOllamaRunning()) {
    model = await detectBestModel();
  }

  const state = loadState();
  let sent = 0;
  let failed = 0;

  for (const client of eligible) {
    try {
      const emailBody = await generateReviewEmail(client, model);
      
      if (mode === 'test') {
        log.info(`[TEST] Would send to ${client.name} (${client.email}):`);
        log.info(emailBody);
        let msg = `⭐ *Review Chaser — Test*\n\n`;
        msg += `👤 *${client.name}*\n📧 ${client.email}\n🔧 ${client.service}\n\n`;
        msg += `*Email Preview:*\n${emailBody}`;
        await sendTelegram(msg);
        continue;
      }

      // Live mode — send the email
      await sendReviewEmail(client, emailBody);
      
      // Track in state
      state.contacted[client.email.toLowerCase()] = new Date().toISOString();
      sent++;
      
      log.info(`Review request sent to ${client.name} (${client.email})`);
      
      // Small delay between sends
      await new Promise(r => setTimeout(r, 2000));
      
    } catch(err) {
      log.error(`Failed to send to ${client.name}: ${err.message}`);
      failed++;
    }
  }

  state.lastRun = new Date().toISOString();
  saveState(state);

  // Telegram summary
  let msg = `⭐ *Review Chaser Report*\n\n`;
  msg += `📧 Sent: ${sent}\n`;
  if (failed > 0) msg += `❌ Failed: ${failed}\n`;
  msg += `👥 Eligible: ${eligible.length}\n\n`;
  
  if (sent > 0) {
    msg += `*Contacted:*\n`;
    eligible.slice(0, sent).forEach(c => {
      msg += `  • ${c.name} (${c.service})\n`;
    });
  }

  await sendTelegram(msg);
  log.info(`Review chaser complete: ${sent} sent, ${failed} failed`);
}


// ══════════════════════════════════════════════
// CLI ENTRY
// ══════════════════════════════════════════════

const mode = process.argv[2] || 'live';
run(mode).catch(err => {
  log.error('Review chaser failed:', err);
  process.exit(1);
});
