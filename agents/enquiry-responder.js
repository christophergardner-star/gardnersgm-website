#!/usr/bin/env node
/* ══════════════════════════════════════════════════════
   Gardners GM — Enquiry Auto-Responder
   
   Checks for new customer enquiries (contact form + bespoke)
   and generates professional AI-powered responses using Ollama.
   
   Runs every 30 minutes via the orchestrator or standalone:
     node agents/enquiry-responder.js           → Process new enquiries
     node agents/enquiry-responder.js check      → Just check, no replies
     node agents/enquiry-responder.js test       → Process but don't send
   
   Flow:
     1. Fetch enquiries from Enquiries sheet
     2. Filter out already-responded ones
     3. Generate a personalised, professional reply using Ollama
     4. Send the reply via Apps Script (email)
     5. Mark as responded in the sheet
     6. Report to Telegram
   ══════════════════════════════════════════════════════ */

const path = require('path');
const fs   = require('fs');
const { apiFetch, apiPost, askOllama, sendTelegram, isOllamaRunning,
        createLogger, sanitiseContent, escHtml, todayISO } = require('./lib/shared');

const log = createLogger('enquiry-responder');

// Track which enquiries have been responded to (persisted locally)
const STATE_FILE = path.join(__dirname, '.enquiry-state.json');

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); }
  catch(e) { return { responded: [], lastRun: null }; }
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}


// ══════════════════════════════════════════════
// SERVICE KNOWLEDGE BASE — for accurate replies
// ══════════════════════════════════════════════

const SERVICE_KNOWLEDGE = `
COMPANY: Gardners Ground Maintenance
LOCATION: Based in Roche, Cornwall (PL26 8HN)
COVERAGE: All of Cornwall — from Bude to Penzance, Launceston to Falmouth
PHONE: 01726 432051
EMAIL: enquiries@gardnersgm.co.uk
WEBSITE: gardnersgm.co.uk
OWNER: Chris

SERVICES & STARTING PRICES:
- Lawn Cutting: from £30/visit (includes cutting, edging, strimming, clippings collected)
- Hedge Trimming: from £50/visit (shaping, reduction, removal of clippings)
- Garden Clearance: from £80/visit (overgrown gardens, green waste removal, full tidy)
- Power Washing: from £60/visit (patios, driveways, paths, decking, fencing)
- Lawn Treatment: from £35/visit (feed, weed & moss control, seasonal programme)
- Scarifying & Aeration: from £150 (lawn renovation, dethatching, overseeding)
- One-Off Tidy-Ups: from £50 (general garden maintenance)

SUBSCRIPTION PLANS:
- Available for regular maintenance (weekly, fortnightly, monthly)
- Save vs one-off bookings, no contracts, cancel anytime
- Stripe payments — automatic billing
- Subscribe at gardnersgm.co.uk/subscribe.html

BOOKING:
- Online booking at gardnersgm.co.uk/booking.html
- Quote requests welcome for larger or bespoke jobs
- Free site visits available for complex work

TRAVEL:
- No surcharge within 15 miles of Roche
- 50p per mile beyond 15 miles (noted on quote)

KEY SELLING POINTS:
- Fully insured, professional equipment
- Reliable — same day/time each visit
- Friendly, local, family-run business
- Free quotes, no obligation
- Stripe-secured payments
- 5-star Google reviews
`;


// ══════════════════════════════════════════════
// GENERATE AI REPLY
// ══════════════════════════════════════════════

async function generateReply(enquiry) {
  const { name, email, message, type, service, postcode, phone, budget } = enquiry;

  const prompt = `You are Chris, the owner of Gardners Ground Maintenance — a professional gardening company in Cornwall. A potential customer has just sent an enquiry through your website. Write a helpful, professional reply email.

CUSTOMER ENQUIRY:
Name: ${name || 'Customer'}
Email: ${email || 'Not provided'}
Type: ${type || 'General enquiry'}
${service ? 'Service interested in: ' + service : ''}
${postcode ? 'Location: ' + postcode : ''}
${phone ? 'Phone: ' + phone : ''}
${budget ? 'Budget: ' + budget : ''}

Their message:
"${message || 'No message provided — they submitted a contact form.'}"

YOUR COMPANY KNOWLEDGE:
${SERVICE_KNOWLEDGE}

REPLY RULES:
1. Be warm, professional, and genuinely helpful — you're Chris, a real person, not a robot
2. Address them by their first name
3. If they mentioned a specific service, give them relevant pricing and what's included
4. If they're asking about a specific area/postcode, acknowledge it — you cover all of Cornwall
5. If it's a bespoke/complex job (garden clearances, landscaping, etc.), offer a free site visit
6. For straightforward services (lawn cutting, hedge trimming), suggest booking online or calling
7. End with your phone number (01726 432051) and booking link (gardnersgm.co.uk/booking.html)
8. Keep it 150-250 words — friendly and concise, not essay-length
9. Sign off as "Chris" from "Gardners Ground Maintenance"
10. Do NOT use markdown — write a plain email
11. Do NOT mention AI, automation, or that this was generated
12. British English throughout
13. Only use REAL contact details: 01726 432051, enquiries@gardnersgm.co.uk, gardnersgm.co.uk

Write the reply email now:`;

  let reply = await askOllama(prompt, { temperature: 0.6, maxTokens: 1024 });
  reply = sanitiseContent(reply);

  // Strip any Subject: line the model might have added
  reply = reply.replace(/^Subject:.*\n/i, '').trim();

  return reply;
}


// ══════════════════════════════════════════════
// GENERATE SUBJECT LINE
// ══════════════════════════════════════════════

async function generateSubject(enquiry, reply) {
  const firstName = (enquiry.name || 'there').split(' ')[0];
  const service = enquiry.service || enquiry.type || 'your enquiry';

  const prompt = `Write a short, friendly email subject line (max 60 chars) for a reply from a gardening company called "Gardners Ground Maintenance" to a customer named ${firstName} who enquired about ${service}. 

Rules:
- Professional but warm
- Include the customer's first name if natural
- No emojis
- Just output the subject line, nothing else

Examples:
- "Thanks for your enquiry, Sarah — here's what we can do"
- "Hi Mark — lawn cutting quote from Gardners GM"
- "Your garden clearance enquiry — Gardners GM"`;

  let subject = await askOllama(prompt, { temperature: 0.5, maxTokens: 100 });
  subject = subject.replace(/^["']|["']$/g, '').trim();
  if (subject.length > 80) subject = subject.substring(0, 77) + '...';
  if (!subject) subject = `Your enquiry — Gardners Ground Maintenance`;
  return subject;
}


// ══════════════════════════════════════════════
// MAIN PROCESSOR
// ══════════════════════════════════════════════

async function processEnquiries(mode = 'live') {
  log('═══════════════════════════════════════════');
  log('📧 Gardners GM — Enquiry Auto-Responder');
  log('═══════════════════════════════════════════');
  log('📅 Date: ' + new Date().toLocaleDateString('en-GB'));
  log('📌 Mode: ' + mode);
  log('');

  // Check Ollama
  if (mode !== 'check') {
    const ollamaUp = await isOllamaRunning();
    if (!ollamaUp) {
      log('❌ Ollama is not running — cannot generate replies');
      log('   Start it with: ollama serve');
      await sendTelegram('⚠️ <b>ENQUIRY RESPONDER</b>\n\nOllama is not running. New enquiries cannot be answered automatically.');
      return { processed: 0, error: 'Ollama offline' };
    }
    log('✅ Ollama is running');
  }

  // Fetch enquiries
  log('📥 Fetching enquiries from sheet...');
  let enquiries = [];
  try {
    const data = await apiFetch('get_enquiries');
    if (data.status === 'success') {
      enquiries = data.enquiries || [];
      log('   Found ' + enquiries.length + ' total enquiries');
    } else {
      log('❌ Failed to fetch enquiries: ' + (data.message || 'Unknown'));
      return { processed: 0, error: 'Fetch failed' };
    }
  } catch(e) {
    log('❌ API error: ' + e.message);
    return { processed: 0, error: e.message };
  }

  // Load state — which enquiries have we already responded to?
  const state = loadState();
  const respondedSet = new Set(state.responded);

  // Filter to unresponded enquiries
  const newEnquiries = enquiries.filter(e => {
    // Build a unique ID from timestamp + email (enquiries don't have row IDs)
    const uid = (e.timestamp || e.date || '') + '|' + (e.email || '') + '|' + (e.name || '');
    if (respondedSet.has(uid)) return false;

    // Skip if no email to reply to
    if (!e.email || !e.email.includes('@')) return false;

    // Skip if already marked as responded in the sheet
    if ((e.status || '').toLowerCase() === 'responded') return false;

    // Only process enquiries from last 48 hours (don't spam old ones)
    if (e.timestamp || e.date) {
      const enquiryDate = new Date(e.timestamp || e.date);
      const hoursSince = (Date.now() - enquiryDate.getTime()) / 3600000;
      if (hoursSince > 48) return false;
    }

    return true;
  });

  log('📋 New enquiries to process: ' + newEnquiries.length);

  if (newEnquiries.length === 0) {
    log('✅ No new enquiries — all caught up');
    state.lastRun = new Date().toISOString();
    saveState(state);
    return { processed: 0 };
  }

  if (mode === 'check') {
    log('ℹ️  Check mode — not sending replies');
    await sendTelegram(
      '📧 <b>ENQUIRY CHECK</b>\n\n'
      + newEnquiries.length + ' new enquir' + (newEnquiries.length === 1 ? 'y' : 'ies') + ' waiting:\n\n'
      + newEnquiries.map((e, i) => `${i+1}. <b>${escHtml(e.name || 'Unknown')}</b> — ${escHtml(e.type || 'General')}\n   ${escHtml((e.message || '').substring(0, 80))}`).join('\n\n')
    );
    return { processed: 0, pending: newEnquiries.length };
  }

  // Process each enquiry
  let processed = 0;
  let errors = 0;
  const results = [];

  for (const enquiry of newEnquiries) {
    const uid = (enquiry.timestamp || enquiry.date || '') + '|' + (enquiry.email || '') + '|' + (enquiry.name || '');
    const firstName = (enquiry.name || 'Customer').split(' ')[0];

    log('');
    log('── Processing: ' + (enquiry.name || 'Unknown') + ' (' + (enquiry.type || 'general') + ')');

    try {
      // Generate reply
      log('   🤖 Generating reply...');
      const reply = await generateReply(enquiry);
      if (!reply || reply.length < 50) {
        log('   ⚠️ Reply too short, skipping');
        errors++;
        continue;
      }
      log('   ✅ Generated ' + reply.length + ' chars');

      // Generate subject line
      const subject = await generateSubject(enquiry, reply);
      log('   📋 Subject: ' + subject);

      if (mode === 'test') {
        log('   🧪 Test mode — not sending');
        log('   ─── REPLY PREVIEW ───');
        log('   To: ' + enquiry.email);
        log('   Subject: ' + subject);
        log('   ' + reply.substring(0, 200) + '...');
        results.push({ name: firstName, type: enquiry.type, status: 'preview' });
        processed++;
        continue;
      }

      // Send via Apps Script
      log('   📤 Sending reply via email...');
      const sendResult = await apiPost({
        action: 'send_enquiry_reply',
        email: enquiry.email,
        name: enquiry.name || '',
        subject: subject,
        body: reply,
        enquiryDate: enquiry.timestamp || enquiry.date || '',
        type: enquiry.type || 'General'
      });

      if (sendResult.status === 'success') {
        log('   ✅ Reply sent to ' + enquiry.email);
        state.responded.push(uid);
        processed++;
        results.push({ name: firstName, email: enquiry.email, type: enquiry.type, status: 'sent' });
      } else {
        log('   ❌ Send failed: ' + (sendResult.message || 'Unknown'));
        errors++;
        results.push({ name: firstName, type: enquiry.type, status: 'failed', error: sendResult.message });
      }

    } catch(err) {
      log('   ❌ Error: ' + err.message);
      errors++;
      results.push({ name: firstName, type: enquiry.type, status: 'error', error: err.message });
    }

    // Small delay between replies
    await new Promise(r => setTimeout(r, 2000));
  }

  // Save state
  // Keep only last 500 entries to avoid unbounded growth
  if (state.responded.length > 500) {
    state.responded = state.responded.slice(-500);
  }
  state.lastRun = new Date().toISOString();
  saveState(state);

  // Telegram summary
  log('');
  log('═══════════════════════════════════════════');
  log('✅ Enquiry Responder finished');
  log('   Processed: ' + processed + ' | Errors: ' + errors);
  log('═══════════════════════════════════════════');

  let tgMsg = '📧 <b>ENQUIRY AUTO-RESPONDER</b>\n━━━━━━━━━━━━━━━━━━━━\n\n';

  if (processed > 0) {
    tgMsg += `✅ <b>${processed}</b> repl${processed === 1 ? 'y' : 'ies'} sent:\n\n`;
    results.filter(r => r.status === 'sent' || r.status === 'preview').forEach(r => {
      tgMsg += `  📨 <b>${escHtml(r.name)}</b> — ${escHtml(r.type || 'General')}`;
      if (r.status === 'preview') tgMsg += ' (preview)';
      tgMsg += '\n';
    });
  }

  if (errors > 0) {
    tgMsg += `\n❌ ${errors} error${errors > 1 ? 's' : ''}:\n`;
    results.filter(r => r.status === 'failed' || r.status === 'error').forEach(r => {
      tgMsg += `  ⚠️ ${escHtml(r.name)}: ${escHtml(r.error || 'Unknown')}\n`;
    });
  }

  if (processed === 0 && errors === 0) {
    tgMsg += '📭 No new enquiries to process\n';
  }

  tgMsg += '\n<i>Auto-responded by Enquiry Agent</i>';
  await sendTelegram(tgMsg);

  return { processed, errors };
}


// ══════════════════════════════════════════════
// CLI ENTRY POINT
// ══════════════════════════════════════════════

async function main() {
  const mode = (process.argv[2] || 'live').toLowerCase();
  try {
    await processEnquiries(mode);
  } catch(err) {
    console.error('Fatal error:', err);
    await sendTelegram('❌ <b>ENQUIRY RESPONDER FAILED</b>\n\n' + err.message);
    process.exit(1);
  }
}

// Allow both CLI and require() usage
if (require.main === module) {
  main();
} else {
  module.exports = { processEnquiries };
}
