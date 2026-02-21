#!/usr/bin/env node
/* ══════════════════════════════════════════════════════
   Gardners GM — Business Tactics Agent
   
   Analyses the business plan, current financials, pricing
   config, and market conditions. Uses Ollama to generate
   strategic pricing & promotion recommendations.
   
   Sends recommendations to Telegram for Chris to approve.
   Approved changes are pushed to services.html and git-committed.
   
   Usage:
     node agents/business-tactics.js              → Full analysis + recommendations
     node agents/business-tactics.js check        → Quick pricing health check
     node agents/business-tactics.js apply <id>   → Apply an approved recommendation
     node agents/business-tactics.js history      → Show recommendation history
   
   Schedule: Weekly Monday 08:30 via orchestrator
   ══════════════════════════════════════════════════════ */

const path = require('path');
const fs   = require('fs');
const { execSync } = require('child_process');
const { apiFetch, apiPost, sendTelegram, askOllama, detectBestModel,
        isOllamaRunning, createLogger, escHtml, fmtGBP, todayISO, CONFIG } = require('./lib/shared');

const log = createLogger('business-tactics');

// State file for tracking recommendations
const STATE_FILE = path.join(__dirname, '.business-tactics-state.json');
const BUSINESS_PLAN = path.join(__dirname, '..', 'admin', 'BUSINESS_PLAN.md');
const SERVICES_HTML = path.join(__dirname, '..', 'services.html');
const REPO_ROOT = path.join(__dirname, '..');

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); }
  catch(e) { return { recommendations: [], lastFullRun: '', lastCheck: '', appliedCount: 0 }; }
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}


// ══════════════════════════════════════════════
// DATA GATHERING
// ══════════════════════════════════════════════

async function gatherBusinessData() {
  log('📊 Gathering business data...');
  const data = {};

  // 1. Read business plan
  try {
    data.businessPlan = fs.readFileSync(BUSINESS_PLAN, 'utf8');
    log('  ✅ Business plan loaded (' + data.businessPlan.length + ' chars)');
  } catch(e) {
    log('  ⚠️ Business plan not found: ' + e.message);
    data.businessPlan = '';
  }

  // 2. Fetch pricing config from Google Sheets
  try {
    const pricing = await apiFetch('get_pricing_config');
    data.pricingConfig = pricing.config || [];
    log('  ✅ Pricing config: ' + data.pricingConfig.length + ' services');
  } catch(e) {
    log('  ⚠️ Pricing config fetch failed: ' + e.message);
    data.pricingConfig = [];
  }

  // 3. Fetch financial dashboard data
  try {
    const finance = await apiFetch('get_finance_dashboard');
    data.finance = finance;
    log('  ✅ Finance dashboard loaded');
  } catch(e) {
    log('  ⚠️ Finance data unavailable: ' + e.message);
    data.finance = {};
  }

  // 4. Fetch recent bookings to analyse demand patterns
  try {
    const clients = await apiFetch('get_clients');
    if (clients.status === 'success') {
      data.recentBookings = (clients.clients || []).slice(0, 100);
      log('  ✅ Recent bookings: ' + data.recentBookings.length);
    } else {
      data.recentBookings = [];
    }
  } catch(e) {
    data.recentBookings = [];
  }

  // 5. Read current services.html prices for comparison
  try {
    const servicesHtml = fs.readFileSync(SERVICES_HTML, 'utf8');
    const priceMatches = servicesHtml.match(/£\d+(?:\.\d{2})?/g) || [];
    data.websitePrices = priceMatches;
    log('  ✅ Website prices found: ' + priceMatches.length + ' price points');
  } catch(e) {
    data.websitePrices = [];
  }

  // 6. Get current month/season context
  const now = new Date();
  const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  data.currentMonth = monthNames[now.getMonth()];
  data.currentSeason = getSeason(now.getMonth());
  data.dayOfWeek = now.toLocaleDateString('en-GB', { weekday: 'long' });

  return data;
}

function getSeason(month) {
  if (month >= 3 && month <= 9) return 'Peak Season (April-October)';
  return 'Off-Season (November-March)';
}


// ══════════════════════════════════════════════
// DEMAND ANALYSIS
// ══════════════════════════════════════════════

function analyseDemand(bookings) {
  if (!bookings || bookings.length === 0) return { summary: 'No booking data available' };

  const serviceCount = {};
  const monthlyRevenue = {};
  const recentWeeks = {};
  const now = new Date();

  for (const b of bookings) {
    // Count services
    const service = (b.service || b.serviceName || '').toLowerCase();
    if (service) {
      serviceCount[service] = (serviceCount[service] || 0) + 1;
    }

    // Monthly revenue
    const date = b.date || b.timestamp || '';
    if (date) {
      try {
        const d = new Date(date);
        const monthKey = d.toISOString().substring(0, 7);
        const price = parseFloat(String(b.price || b.total || '0').replace(/[^0-9.]/g, '')) || 0;
        monthlyRevenue[monthKey] = (monthlyRevenue[monthKey] || 0) + price;

        // Track weeks
        const weekAgo = new Date(now.getTime() - 7 * 86400000);
        const twoWeeksAgo = new Date(now.getTime() - 14 * 86400000);
        if (d >= weekAgo) recentWeeks.thisWeek = (recentWeeks.thisWeek || 0) + 1;
        else if (d >= twoWeeksAgo) recentWeeks.lastWeek = (recentWeeks.lastWeek || 0) + 1;
      } catch(e) {}
    }
  }

  // Top services
  const topServices = Object.entries(serviceCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([s, c]) => `${s}: ${c} bookings`);

  return {
    totalBookings: bookings.length,
    topServices,
    monthlyRevenue,
    recentWeeks,
    summary: `${bookings.length} recent bookings. Top: ${topServices.slice(0, 3).join(', ')}`
  };
}


// ══════════════════════════════════════════════
// OLLAMA ANALYSIS — FULL STRATEGY
// ══════════════════════════════════════════════

async function generateStrategy(data) {
  log('🧠 Generating strategy with Ollama...');

  const model = await detectBestModel();
  if (!model) {
    throw new Error('No Ollama model available');
  }

  const demand = analyseDemand(data.recentBookings);

  // Build pricing summary
  let pricingSummary = 'Current Pricing Config:\n';
  for (const p of data.pricingConfig) {
    pricingSummary += `  ${p.service}: Current min £${p.currentMin}, Recommended min £${p.recommendedMin}, `;
    pricingSummary += `Avg £${p.currentAvg}, Material cost £${p.materialCost}, `;
    pricingSummary += `Break-even £${p.breakEvenPrice}, Status: ${p.status}\n`;
  }

  // Finance summary
  let financeSummary = 'No financial data available';
  if (data.finance && data.finance.summary) {
    const s = data.finance.summary;
    financeSummary = `YTD Revenue: £${s.ytdRevenue || 0}, Monthly: £${s.monthlyRevenue || 0}, `;
    financeSummary += `Jobs this month: ${s.monthlyJobs || 0}, Avg job value: £${s.avgJobValue || 0}`;
  }

  const prompt = `You are a business strategy advisor for Gardners Ground Maintenance, a sole-trader gardening business in Cornwall, UK.

BUSINESS CONTEXT:
- Owner: Chris Gardner, based in Roche, Cornwall PL26
- One-man operation, 3 jobs/day max (Mon-Sat)
- Year 1 revenue target: £41,500 - £52,000
- Break-even: 13 jobs/month (£975/month)
- Target profit margin: 77%
- Annual costs: ~£9,955

CURRENT DATE: ${data.currentMonth} ${new Date().getFullYear()}
CURRENT SEASON: ${data.currentSeason}

${pricingSummary}

CURRENT FINANCIALS:
${financeSummary}

DEMAND ANALYSIS:
${demand.summary}
Recent bookings this week: ${demand.recentWeeks?.thisWeek || 0}
Recent bookings last week: ${demand.recentWeeks?.lastWeek || 0}

WEBSITE PRICES CURRENTLY SHOWING:
${data.websitePrices ? data.websitePrices.slice(0, 20).join(', ') : 'Not available'}

KEY SECTIONS FROM BUSINESS PLAN:
- Services & pricing tiers for lawn cutting, hedge trimming, lawn treatment, scarifying, garden clearance, power washing
- Subscription packages: Essential (£35/visit fortnightly), Standard (£25/visit weekly), Premium (£120/visit monthly)
- Seasonal strategy differs between peak (Apr-Oct) and off-peak (Nov-Mar)
- Growth targets: Year 2 £50-60k, Year 3 £65-80k

Please provide EXACTLY 3-5 actionable recommendations in this JSON format:
{
  "analysis": "2-3 sentence summary of current business health and market position",
  "recommendations": [
    {
      "id": "rec_001",
      "type": "pricing|promotion|seasonal|efficiency|growth",
      "priority": "high|medium|low",
      "title": "Short title (max 60 chars)",
      "description": "What to do and why (2-3 sentences)",
      "action": "Specific change to make",
      "impact": "Expected revenue/profit impact",
      "services_affected": ["Lawn Cutting", "Hedge Trimming"],
      "price_changes": [
        {"service": "Lawn Cutting", "current": 30, "recommended": 35, "reason": "Below market rate"}
      ]
    }
  ],
  "seasonal_focus": "What to push this month specifically",
  "promotion_idea": "One specific seasonal promotion with discount details"
}

Be specific, practical, and based on the Cornwall market. Consider:
- Seasonal demand (what services are most needed right now?)
- Price positioning vs competitors
- Capacity utilisation (are we too busy or too quiet?)
- Upselling opportunities
- CPI/inflation adjustments if prices haven't changed recently

Return ONLY valid JSON, no markdown formatting.`;

  const response = await askOllama(prompt, {
    model,
    temperature: 0.6,
    max_tokens: 2000,
  });

  if (!response) throw new Error('Empty response from Ollama');

  // Parse JSON from response
  let strategy;
  try {
    // Try to extract JSON from the response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      strategy = JSON.parse(jsonMatch[0]);
    } else {
      throw new Error('No JSON found in response');
    }
  } catch(e) {
    log('⚠️ Failed to parse strategy JSON: ' + e.message);
    log('   Raw response (first 500 chars): ' + response.substring(0, 500));
    throw new Error('Failed to parse AI strategy response');
  }

  return strategy;
}


// ══════════════════════════════════════════════
// TELEGRAM APPROVAL FLOW
// ══════════════════════════════════════════════

async function sendForApproval(strategy, state) {
  log('📨 Sending recommendations to Telegram for approval...');

  // Header
  let msg = '📋 <b>BUSINESS TACTICS — Weekly Strategy</b>\n';
  msg += '━━━━━━━━━━━━━━━━━━━━\n';
  msg += `📅 ${new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}\n\n`;

  // Analysis
  if (strategy.analysis) {
    msg += '📊 <b>Analysis:</b> ' + escHtml(strategy.analysis) + '\n\n';
  }

  // Seasonal focus
  if (strategy.seasonal_focus) {
    msg += '🌿 <b>Seasonal Focus:</b> ' + escHtml(strategy.seasonal_focus) + '\n\n';
  }

  // Recommendations
  if (strategy.recommendations && strategy.recommendations.length > 0) {
    msg += '💡 <b>Recommendations:</b>\n\n';

    for (let i = 0; i < strategy.recommendations.length; i++) {
      const rec = strategy.recommendations[i];
      const priorityIcon = rec.priority === 'high' ? '🔴' : rec.priority === 'medium' ? '🟡' : '🟢';
      const typeIcon = { pricing: '💰', promotion: '🎯', seasonal: '🌱', efficiency: '⚡', growth: '📈' }[rec.type] || '📋';

      msg += `${i + 1}. ${priorityIcon} ${typeIcon} <b>${escHtml(rec.title)}</b>\n`;
      msg += `   ${escHtml(rec.description)}\n`;

      if (rec.price_changes && rec.price_changes.length > 0) {
        for (const pc of rec.price_changes) {
          msg += `   💰 ${escHtml(pc.service)}: £${pc.current} → £${pc.recommended} (${escHtml(pc.reason)})\n`;
        }
      }

      if (rec.impact) {
        msg += `   📈 Impact: ${escHtml(rec.impact)}\n`;
      }
      msg += '\n';
    }
  }

  // Promotion idea
  if (strategy.promotion_idea) {
    msg += '🎁 <b>Promotion Idea:</b> ' + escHtml(strategy.promotion_idea) + '\n\n';
  }

  msg += '━━━━━━━━━━━━━━━━━━━━\n';
  msg += '✅ Reply <b>"approve all"</b> to push all changes\n';
  msg += '✅ Reply <b>"approve 1,3"</b> to approve specific items\n';
  msg += '❌ Reply <b>"reject"</b> to dismiss\n';
  msg += '\n🌿 <i>Gardners GM — Business Tactics Agent</i>';

  await sendTelegram(msg);

  // Save recommendations to state for later approval
  const recBatch = {
    id: 'batch_' + Date.now(),
    date: todayISO(),
    strategy,
    status: 'pending',  // pending, approved, rejected, applied
    recommendations: (strategy.recommendations || []).map((r, i) => ({
      ...r,
      id: r.id || `rec_${Date.now()}_${i}`,
      status: 'pending',
    })),
  };

  state.recommendations.unshift(recBatch);
  // Keep only last 20 batches
  if (state.recommendations.length > 20) {
    state.recommendations = state.recommendations.slice(0, 20);
  }
  state.lastFullRun = new Date().toISOString();
  saveState(state);

  log('✅ Recommendations sent to Telegram (' + (strategy.recommendations || []).length + ' items)');
  return recBatch;
}


// ══════════════════════════════════════════════
// APPLY APPROVED CHANGES
// ══════════════════════════════════════════════

async function applyRecommendation(recId) {
  const state = loadState();

  // Find the recommendation
  let foundRec = null;
  let foundBatch = null;
  for (const batch of state.recommendations) {
    for (const rec of batch.recommendations) {
      if (rec.id === recId) {
        foundRec = rec;
        foundBatch = batch;
        break;
      }
    }
    if (foundRec) break;
  }

  if (!foundRec) {
    log('❌ Recommendation not found: ' + recId);
    return;
  }

  log('📦 Applying recommendation: ' + foundRec.title);

  // 1. If it has price changes, update pricing config in Google Sheets
  if (foundRec.price_changes && foundRec.price_changes.length > 0) {
    const updates = foundRec.price_changes.map(pc => ({
      service: pc.service,
      recommendedMin: pc.recommended,
      status: 'Updated by AI',
      notes: `Agent recommendation: ${pc.reason} (${todayISO()})`,
    }));

    try {
      await apiPost({
        action: 'update_pricing_config',
        updates,
      });
      log('  ✅ Pricing config updated in Google Sheets');
    } catch(e) {
      log('  ❌ Failed to update pricing config: ' + e.message);
    }

    // 2. Update services.html with new prices
    try {
      updateServicesHtml(foundRec.price_changes);
      log('  ✅ services.html updated');
    } catch(e) {
      log('  ❌ Failed to update services.html: ' + e.message);
    }

    // 3. Git commit and push
    try {
      gitCommitAndPush(foundRec.title, foundRec.price_changes);
      log('  ✅ Changes committed and pushed to git');
    } catch(e) {
      log('  ⚠️ Git push failed: ' + e.message);
    }
  }

  // Mark as applied
  foundRec.status = 'applied';
  foundRec.appliedAt = new Date().toISOString();
  state.appliedCount = (state.appliedCount || 0) + 1;
  saveState(state);

  // Notify via Telegram
  await sendTelegram(
    '✅ <b>RECOMMENDATION APPLIED</b>\n\n' +
    `📋 ${escHtml(foundRec.title)}\n` +
    (foundRec.price_changes ? foundRec.price_changes.map(pc =>
      `  💰 ${escHtml(pc.service)}: £${pc.current} → £${pc.recommended}`
    ).join('\n') + '\n' : '') +
    '\n🌿 Changes pushed to website.'
  );
}


// ══════════════════════════════════════════════
// SERVICES.HTML PRICE UPDATER
// ══════════════════════════════════════════════

function updateServicesHtml(priceChanges) {
  if (!fs.existsSync(SERVICES_HTML)) {
    throw new Error('services.html not found');
  }

  let html = fs.readFileSync(SERVICES_HTML, 'utf8');
  let updated = false;

  for (const change of priceChanges) {
    const service = change.service;
    const oldPrice = change.current;
    const newPrice = change.recommended;

    // Look for price in format "£XX" or "From £XX" near the service name
    // This is a targeted replacement — find "£{oldPrice}" near "{service}" 
    const serviceRegex = new RegExp(
      '(' + escapeRegex(service) + '[\\s\\S]{0,200}?)£' + oldPrice + '\\b',
      'i'
    );
    
    if (serviceRegex.test(html)) {
      html = html.replace(serviceRegex, '$1£' + newPrice);
      log(`  📝 Updated ${service}: £${oldPrice} → £${newPrice}`);
      updated = true;
    } else {
      // Try simpler: just update the first occurrence of this price near service name
      log(`  ⚠️ Could not find £${oldPrice} near "${service}" in services.html`);
    }
  }

  if (updated) {
    fs.writeFileSync(SERVICES_HTML, html, 'utf8');
  }

  return updated;
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}


// ══════════════════════════════════════════════
// GIT AUTO-PUSH
// ══════════════════════════════════════════════

function gitCommitAndPush(title, priceChanges) {
  const changesDesc = priceChanges
    .map(pc => `${pc.service}: £${pc.current}→£${pc.recommended}`)
    .join(', ');
  
  const commitMsg = `🤖 Business Tactics: ${title}\n\nPrice updates: ${changesDesc}\n\nAuto-committed by business-tactics agent`;

  try {
    execSync('git add services.html', { cwd: REPO_ROOT, timeout: 10000 });
    execSync(`git commit -m "${commitMsg.replace(/"/g, '\\"')}"`, { cwd: REPO_ROOT, timeout: 10000 });
    execSync('git push', { cwd: REPO_ROOT, timeout: 30000 });
    log('✅ Git push successful');
  } catch(e) {
    log('⚠️ Git operation failed: ' + e.message);
    throw e;
  }
}


// ══════════════════════════════════════════════
// QUICK PRICING HEALTH CHECK
// ══════════════════════════════════════════════

async function quickCheck() {
  log('🔍 Running quick pricing health check...');

  let pricingConfig = [];
  try {
    const pricing = await apiFetch('get_pricing_config');
    pricingConfig = pricing.config || [];
  } catch(e) {
    log('❌ Cannot fetch pricing: ' + e.message);
    return;
  }

  const issues = [];
  const good = [];

  for (const p of pricingConfig) {
    // Check if current min is below break-even
    if (p.breakEvenPrice > 0 && p.currentMin < p.breakEvenPrice) {
      issues.push(`⚠️ ${p.service}: Current min £${p.currentMin} is BELOW break-even £${p.breakEvenPrice}`);
    }

    // Check if recommended is significantly different from current
    if (p.recommendedMin > 0 && Math.abs(p.recommendedMin - p.currentMin) > 5) {
      issues.push(`💰 ${p.service}: Current £${p.currentMin} vs recommended £${p.recommendedMin}`);
    }

    // Check if not updated recently
    if (p.lastUpdated) {
      const daysSince = (Date.now() - new Date(p.lastUpdated).getTime()) / 86400000;
      if (daysSince > 90) {
        issues.push(`📅 ${p.service}: Price not reviewed in ${Math.floor(daysSince)} days`);
      }
    }

    if (p.status === 'OK' || p.status === 'Active') {
      good.push(p.service);
    }
  }

  let msg = '🔍 <b>PRICING HEALTH CHECK</b>\n';
  msg += '━━━━━━━━━━━━━━━━━━━━\n\n';

  if (issues.length > 0) {
    msg += '⚠️ <b>Issues Found:</b>\n';
    issues.forEach(i => { msg += '  ' + i + '\n'; });
    msg += '\n';
  } else {
    msg += '✅ All prices look healthy!\n\n';
  }

  msg += `✅ ${good.length} services with OK status\n`;
  msg += `📊 ${pricingConfig.length} total services tracked\n`;
  msg += '\n🌿 <i>Run full analysis for detailed recommendations</i>';

  await sendTelegram(msg);

  const state = loadState();
  state.lastCheck = new Date().toISOString();
  saveState(state);

  log('✅ Health check complete — ' + issues.length + ' issues found');
}


// ══════════════════════════════════════════════
// SHOW RECOMMENDATION HISTORY
// ══════════════════════════════════════════════

function showHistory() {
  const state = loadState();

  console.log('');
  console.log('  ═══════════════════════════════════════');
  console.log('  📋 BUSINESS TACTICS — Recommendation History');
  console.log('  ═══════════════════════════════════════');
  console.log('');
  console.log('  Last full run:  ' + (state.lastFullRun || 'Never'));
  console.log('  Last check:     ' + (state.lastCheck || 'Never'));
  console.log('  Applied total:  ' + (state.appliedCount || 0));
  console.log('');

  if (state.recommendations.length === 0) {
    console.log('  No recommendations yet. Run: node agents/business-tactics.js');
    console.log('');
    return;
  }

  for (const batch of state.recommendations.slice(0, 5)) {
    console.log('  ─── ' + batch.date + ' (' + batch.status + ') ───');
    for (const rec of batch.recommendations) {
      const icon = rec.status === 'applied' ? '✅' : rec.status === 'rejected' ? '❌' : '⏳';
      console.log('    ' + icon + ' [' + (rec.priority || '?') + '] ' + (rec.title || 'Untitled'));
    }
    console.log('');
  }
}


// ══════════════════════════════════════════════
// MAIN
// ══════════════════════════════════════════════

async function main() {
  const args = process.argv.slice(2);
  const command = (args[0] || 'full').toLowerCase();

  log('═══════════════════════════════════════════');
  log('📋 Gardners GM — Business Tactics Agent');
  log('═══════════════════════════════════════════');
  log('📅 ' + new Date().toLocaleString('en-GB'));
  log('📌 Command: ' + command);

  if (command === 'history') {
    showHistory();
    return;
  }

  if (command === 'check') {
    await quickCheck();
    return;
  }

  if (command === 'apply') {
    const recId = args[1];
    if (!recId) {
      console.log('Usage: node agents/business-tactics.js apply <recommendation_id>');
      return;
    }
    await applyRecommendation(recId);
    return;
  }

  // Full analysis
  log('');
  log('🔄 Starting full business strategy analysis...');

  // Check Ollama is available
  if (!await isOllamaRunning()) {
    log('❌ Ollama is not running — cannot generate strategy');
    await sendTelegram('⚠️ <b>BUSINESS TACTICS</b>\n\nOllama is not running. Cannot generate strategy. Please start Ollama and try again.');
    process.exit(1);
  }

  try {
    // 1. Gather all data
    const data = await gatherBusinessData();

    // 2. Generate strategy with Ollama
    const strategy = await generateStrategy(data);

    // 3. Send to Telegram for approval
    const state = loadState();
    await sendForApproval(strategy, state);

    log('');
    log('✅ Business Tactics Agent complete');
    log('   Recommendations sent to Telegram for approval');

  } catch(err) {
    log('❌ Error: ' + err.message);
    await sendTelegram('❌ <b>BUSINESS TACTICS ERROR</b>\n\n' + escHtml(err.message));
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
