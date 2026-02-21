#!/usr/bin/env node
// ============================================
// Gardners GM — Finance Dashboard Agent
// Runs daily at 08:00 via Windows Task Scheduler
// 
// 1. Fetches UK CPI/inflation data from ONS
// 2. Runs financial dashboard calculations via GAS
// 3. Calculates break-even prices with inflation
// 4. Updates pricing config with recommendations
// 5. Sends full Telegram financial report
//
// Modes:
//   daily    — full financial report + pricing check
//   weekly   — deeper analysis with weekly summary
//   pricing  — pricing-only review + recommendations
//   report   — quick Telegram summary (no updates)
// ============================================

const https = require('https');
const http  = require('http');

try { require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') }); } catch(e) {}

const WEBHOOK = process.env.SHEETS_WEBHOOK || '';
const TG_BOT  = process.env.TG_BOT_TOKEN || '';
const TG_CHAT = process.env.TG_CHAT_ID || '';

// UK ONS CPI API endpoint (CPIH Annual Rate - series L55O)
const ONS_CPI_URL = 'https://www.ons.gov.uk/economy/inflationandpriceindices/timeseries/l55o/mm23/data';

// ─── HTTP helpers ───

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    mod.get(url, { headers: { 'User-Agent': 'GardnersGM-Finance/1.0' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchJSON(res.headers.location).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(new Error('Parse error: ' + data.substring(0, 300))); }
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
      headers: { 'Content-Type': 'text/plain', 'Content-Length': Buffer.byteLength(payload) }
    };

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
    const payload = JSON.stringify({ chat_id: TG_CHAT, text, parse_mode: 'HTML' });
    const options = {
      hostname: 'api.telegram.org', path: `/bot${TG_BOT}/sendMessage`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
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

// ─── UK Inflation fetcher ───

async function getUKInflation() {
  try {
    console.log('Fetching UK CPI data from ONS...');
    const data = await fetchJSON(ONS_CPI_URL);
    
    // ONS returns { months: [ { year, month, value, date, ... } ] }
    if (data && data.months && data.months.length > 0) {
      // Get most recent months
      const recent = data.months.slice(-6).reverse();
      const latest = recent[0];
      const cpiRate = parseFloat(latest.value) || 0;
      const prevYear = recent.find(m => 
        parseInt(m.year) === parseInt(latest.year) - 1 && m.month === latest.month
      );
      
      console.log(`UK CPI (CPIH): ${cpiRate}% — ${latest.date || latest.year + ' ' + latest.month}`);
      
      return {
        rate: cpiRate,
        date: latest.date || `${latest.year} ${latest.month}`,
        year: latest.year,
        month: latest.month,
        trend: recent.slice(0, 3).map(m => ({ date: m.date || `${m.year} ${m.month}`, rate: parseFloat(m.value) || 0 }))
      };
    }
    
    console.log('ONS data format unexpected, using fallback rate');
    return { rate: 3.0, date: 'Fallback', trend: [] };
  } catch(e) {
    console.log('ONS fetch failed, using fallback CPI rate:', e.message);
    return { rate: 3.0, date: 'Fallback (fetch failed)', trend: [] };
  }
}

// ─── Calculate pricing recommendations ───

function calculatePricingRecommendations(pricingConfig, cpi, monthlyData) {
  const recommendations = [];
  const inflationMultiplier = 1 + (cpi.rate / 100);
  
  // Running cost per job (monthly costs / monthly jobs, or estimate)
  const jobsPerMonth = monthlyData.totalJobs || 40; // fallback
  const overheadPerJob = monthlyData.totalMonthlyCosts / Math.max(jobsPerMonth, 1);
  
  for (const svc of pricingConfig) {
    const materialCost = svc.materialCost || 3;
    const targetMargin = (svc.targetMargin || 70) / 100;
    const fuelPerJob = 5; // average £5 fuel per job
    
    // Break-even = (materials + fuel + overhead allocation) / (1 - stripe %)
    const totalCostPerJob = materialCost + fuelPerJob + overheadPerJob;
    const breakEven = Math.ceil(totalCostPerJob / (1 - 0.014)); // Stripe 1.4%
    
    // Recommended minimum with target margin
    const recommendedMin = Math.ceil(totalCostPerJob / (1 - targetMargin));
    
    // Inflation-adjusted recommended minimum
    const inflationAdjusted = Math.ceil(recommendedMin * inflationMultiplier);
    
    // Status check
    let status = 'OK';
    const currentMin = svc.currentMin || 0;
    if (currentMin > 0 && currentMin < breakEven) {
      status = 'BELOW BREAK-EVEN';
    } else if (currentMin > 0 && currentMin < recommendedMin) {
      status = 'BELOW TARGET MARGIN';
    } else if (currentMin > 0 && inflationAdjusted > currentMin * 1.05) {
      status = 'INFLATION REVIEW';
    }
    
    recommendations.push({
      service: svc.service,
      currentMin: currentMin,
      breakEvenPrice: breakEven,
      recommendedMin: Math.max(recommendedMin, currentMin), // never recommend lower
      inflationAdjusted: inflationAdjusted,
      status: status,
      cpiRate: cpi.rate,
      inflationAdj: Math.round((inflationMultiplier - 1) * 100 * 10) / 10,
      notes: status === 'OK' 
        ? `Healthy margin at current pricing` 
        : status === 'INFLATION REVIEW'
          ? `CPI ${cpi.rate}% suggests £${inflationAdjusted} min (currently £${currentMin})`
          : `Cost analysis suggests min £${recommendedMin} (currently £${currentMin})`
    });
  }
  
  return recommendations;
}

// ─── Format currency ───
function fmtGBP(n) { return '£' + (Math.round(n * 100) / 100).toFixed(2); }
function fmtGBPr(n) { return '£' + Math.round(n); }

// ─── Format date ───
function fmtDate(d) {
  const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  return days[d.getDay()] + ' ' + d.getDate() + '/' + (d.getMonth()+1) + '/' + d.getFullYear();
}

// ─── Build allocation bar (visual) ───
function allocationBar(label, amount, total) {
  const pct = total > 0 ? Math.round((amount / total) * 100) : 0;
  const filled = Math.round(pct / 10);
  const bar = '\u2588'.repeat(filled) + '\u2591'.repeat(10 - filled);
  return `${label}: ${bar} ${pct}% (${fmtGBPr(amount)})`;
}

// ─── Main ───

async function main() {
  const mode = (process.argv[2] || 'daily').toLowerCase();
  const now = new Date();
  
  console.log(`[${now.toISOString()}] Finance Dashboard Agent — mode: ${mode}`);
  
  // Step 1: Get UK inflation data
  const cpi = await getUKInflation();
  
  // Step 2: Run financial dashboard on GAS
  console.log('Running financial calculations...');
  const dashboard = await postJSON(WEBHOOK, { action: 'run_financial_dashboard' });
  
  if (!dashboard || dashboard.status !== 'success') {
    const errMsg = '❌ <b>FINANCE DASHBOARD FAILED</b>\n\n' + (dashboard?.raw || dashboard?.message || 'Unknown error');
    await sendTelegram(errMsg);
    console.error('Dashboard failed:', JSON.stringify(dashboard).substring(0, 300));
    return;
  }
  
  const { daily, weekly, monthly, ytd } = dashboard;
  
  // Step 3: Get current pricing config
  console.log('Fetching pricing config...');
  const pricingResult = await fetchJSON(WEBHOOK + '?action=get_pricing_config');
  const pricingConfig = (pricingResult && pricingResult.config) || [];
  
  // Step 4: Calculate pricing recommendations
  const recommendations = calculatePricingRecommendations(pricingConfig, cpi, monthly);
  
  // Step 5: Update pricing config on sheet (if not report-only mode)
  if (mode !== 'report') {
    const updates = recommendations.map(r => ({
      service: r.service,
      recommendedMin: r.recommendedMin,
      breakEvenPrice: r.breakEvenPrice,
      status: r.status,
      cpiRate: r.cpiRate,
      inflationAdj: r.inflationAdj,
      notes: r.notes
    }));
    
    console.log('Updating pricing config...');
    await postJSON(WEBHOOK, { action: 'update_pricing_config', updates });
  }
  
  // Step 6: Build Telegram report
  let msg = '';
  
  if (mode === 'daily' || mode === 'report') {
    // ─── Daily financial report ───
    msg += `💰 <b>FINANCE DASHBOARD — ${fmtDate(now)}</b>\n\n`;
    
    // Today
    msg += `📅 <b>TODAY</b>\n`;
    msg += `  Revenue: <b>${fmtGBPr(daily.grossRevenue)}</b> (${daily.totalJobs} jobs)\n`;
    if (daily.totalJobs > 0) {
      msg += `  Avg job: ${fmtGBPr(daily.avgJobValue)} | Margin: ${daily.profitMargin}%\n`;
    }
    msg += `\n`;
    
    // This week
    msg += `📊 <b>THIS WEEK</b>\n`;
    msg += `  Revenue: <b>${fmtGBPr(weekly.grossRevenue)}</b> (${weekly.totalJobs} jobs)\n`;
    msg += `  Subs: ${fmtGBPr(weekly.subRevenue)} | One-offs: ${fmtGBPr(weekly.oneOffRevenue)}\n`;
    if (weekly.totalJobs > 0) {
      msg += `  Avg job: ${fmtGBPr(weekly.avgJobValue)} | Margin: ${weekly.profitMargin}%\n`;
    }
    msg += `\n`;
    
    // This month
    msg += `📆 <b>THIS MONTH</b>\n`;
    msg += `  Revenue: <b>${fmtGBPr(monthly.grossRevenue)}</b> (${monthly.totalJobs} jobs)\n`;
    msg += `  Subs: ${fmtGBPr(monthly.subRevenue)} | One-offs: ${fmtGBPr(monthly.oneOffRevenue)}\n`;
    if (monthly.totalJobs > 0) {
      msg += `  Avg job: ${fmtGBPr(monthly.avgJobValue)} | Margin: ${monthly.profitMargin}%\n`;
    }
    msg += `\n`;
    
    // Money allocation (where to put the monthly takings)
    if (monthly.grossRevenue > 0) {
      const a = monthly.allocations;
      msg += `💼 <b>MONEY ALLOCATION (This Month)</b>\n`;
      msg += `  🏛️ Tax reserve: <b>${fmtGBP(a.taxPot)}</b>\n`;
      msg += `  🏥 NI reserve: <b>${fmtGBP(a.niPot)}</b>\n`;
      msg += `  🔧 Running costs: <b>${fmtGBP(a.runningCosts)}</b>\n`;
      msg += `  🧴 Materials: <b>${fmtGBP(a.materials)}</b>\n`;
      msg += `  ⛽ Fuel: <b>${fmtGBP(a.fuel)}</b>\n`;
      msg += `  💳 Stripe fees: <b>${fmtGBP(a.stripeFees)}</b>\n`;
      msg += `  ━━━━━━━━━━━━━━━\n`;
      msg += `  💚 <b>YOUR POCKET: ${fmtGBP(a.yourPocket)}</b>\n`;
      msg += `\n`;
    }
    
    // YTD
    msg += `📈 <b>TAX YEAR TO DATE</b>\n`;
    msg += `  Revenue: <b>${fmtGBPr(ytd.grossRevenue)}</b>\n`;
    msg += `  Costs: ${fmtGBPr(ytd.allocatedCosts + ytd.materialCosts + ytd.fuelEstimate + ytd.stripeFees)}\n`;
    msg += `  Profit: <b>${fmtGBPr(ytd.netProfit)}</b> (${ytd.profitMargin}%)\n`;
    msg += `  Projected annual: ${fmtGBPr(ytd.annualisedRevenue)}\n`;
    msg += `  Est. tax bill: ~${fmtGBPr(ytd.annualisedTax)} + NI ~${fmtGBPr(ytd.annualisedNI)}\n`;
    msg += `\n`;
    
    // CPI / Inflation
    msg += `📉 <b>UK INFLATION (CPIH)</b>\n`;
    msg += `  Rate: <b>${cpi.rate}%</b> (${cpi.date})\n`;
    if (cpi.trend && cpi.trend.length > 0) {
      msg += `  Trend: ${cpi.trend.map(t => `${t.rate}%`).join(' → ')}\n`;
    }
    msg += `\n`;
    
    // Pricing health
    const warnings = recommendations.filter(r => r.status !== 'OK');
    if (warnings.length > 0) {
      msg += `⚠️ <b>PRICING ALERTS</b>\n`;
      for (const w of warnings) {
        msg += `  ${w.status === 'BELOW BREAK-EVEN' ? '🔴' : w.status === 'BELOW TARGET MARGIN' ? '🟠' : '🟡'} ${w.service}: ${w.status}\n`;
        msg += `     ${w.notes}\n`;
      }
    } else {
      msg += `✅ <b>PRICING: All services healthy</b>\n`;
    }
    
    // ─── PAY YOURSELF — clear safe withdrawal ───
    msg += `\n━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `💷 <b>SAFE TO PAY YOURSELF</b>\n\n`;
    
    // Use monthly data: revenue minus ALL business obligations
    const mRev = monthly.grossRevenue || 0;
    const mAlloc = monthly.allocations || {};
    const totalBusinessCosts = (mAlloc.taxPot || 0) + (mAlloc.niPot || 0) + (mAlloc.runningCosts || 0) + (mAlloc.materials || 0) + (mAlloc.fuel || 0) + (mAlloc.stripeFees || 0);
    const safeToTake = Math.max(0, mRev - totalBusinessCosts);
    
    // Emergency buffer: keep 10% of revenue as float
    const emergencyBuffer = Math.round(mRev * 0.10);
    const reallySafe = Math.max(0, safeToTake - emergencyBuffer);
    
    if (mRev <= 0) {
      msg += `  No revenue this month yet\n`;
    } else {
      msg += `  Revenue this month: ${fmtGBP(mRev)}\n`;
      msg += `  Business obligations: -${fmtGBP(totalBusinessCosts)}\n`;
      msg += `  Emergency float (10%): -${fmtGBP(emergencyBuffer)}\n`;
      msg += `  ━━━━━━━━━━━━━━━\n`;
      msg += `  💰 <b>TAKE HOME: ${fmtGBP(reallySafe)}</b>\n`;
      if (reallySafe < 200) {
        msg += `  ⚠️ <i>Tight month — business comes first</i>\n`;
      } else if (reallySafe > 1000) {
        msg += `  ✅ <i>Healthy — transfer when ready</i>\n`;
      } else {
        msg += `  👍 <i>OK to transfer — keep float in account</i>\n`;
      }
    }
    msg += `━━━━━━━━━━━━━━━━━━━━\n\n`;
    
    // Health indicator
    msg += `🏥 Overall: <b>${monthly.pricingHealth}</b>`;
    
  } else if (mode === 'weekly') {
    // ─── Weekly deep dive ───
    msg += `📊 <b>WEEKLY FINANCE REVIEW — ${fmtDate(now)}</b>\n\n`;
    
    msg += `💰 <b>WEEK SUMMARY</b>\n`;
    msg += `  Gross: <b>${fmtGBPr(weekly.grossRevenue)}</b>\n`;
    msg += `  Jobs: ${weekly.totalJobs} (avg ${fmtGBPr(weekly.avgJobValue)})\n`;
    msg += `  Subs: ${fmtGBPr(weekly.subRevenue)} | One-offs: ${fmtGBPr(weekly.oneOffRevenue)}\n\n`;
    
    // Service breakdown
    if (weekly.serviceBreakdown && Object.keys(weekly.serviceBreakdown).length > 0) {
      msg += `📋 <b>BY SERVICE</b>\n`;
      for (const [svc, data] of Object.entries(weekly.serviceBreakdown)) {
        msg += `  ${svc}: ${data.jobs} jobs × ${fmtGBPr(data.avgPrice)} avg = <b>${fmtGBPr(data.revenue)}</b>\n`;
      }
      msg += `\n`;
    }
    
    // Allocation
    if (weekly.grossRevenue > 0) {
      const a = weekly.allocations;
      const total = weekly.grossRevenue;
      msg += `📊 <b>WEEKLY ALLOCATION</b>\n`;
      msg += `  ${allocationBar('🏛️ Tax', a.taxPot, total)}\n`;
      msg += `  ${allocationBar('🏥 NI', a.niPot, total)}\n`;
      msg += `  ${allocationBar('🔧 Costs', a.runningCosts, total)}\n`;
      msg += `  ${allocationBar('⛽ Fuel+Mat', a.fuel + a.materials, total)}\n`;
      msg += `  ${allocationBar('💚 Pocket', a.yourPocket, total)}\n`;
      msg += `\n`;
    }
    
    // Monthly context
    msg += `📆 <b>MONTH SO FAR</b>\n`;
    msg += `  Revenue: ${fmtGBPr(monthly.grossRevenue)} | Jobs: ${monthly.totalJobs}\n`;
    msg += `  Profit: ${fmtGBPr(monthly.netProfit)} (${monthly.profitMargin}%)\n\n`;
    
    // Full pricing table  
    msg += `💷 <b>PRICING REVIEW</b>\n`;
    msg += `  CPI: ${cpi.rate}%\n\n`;
    for (const r of recommendations) {
      const icon = r.status === 'OK' ? '✅' : r.status === 'INFLATION REVIEW' ? '🟡' : '🔴';
      msg += `  ${icon} <b>${r.service}</b>\n`;
      msg += `     Min: £${r.currentMin} | B/E: £${r.breakEvenPrice} | Rec: £${r.recommendedMin}\n`;
      if (r.status !== 'OK') msg += `     ⚠️ ${r.notes}\n`;
    }
    
  } else if (mode === 'pricing') {
    // ─── Pricing-only review ───
    msg += `💷 <b>PRICING REVIEW — ${fmtDate(now)}</b>\n\n`;
    msg += `📉 UK CPI: <b>${cpi.rate}%</b> (${cpi.date})\n\n`;
    
    for (const r of recommendations) {
      const icon = r.status === 'OK' ? '✅' : r.status === 'INFLATION REVIEW' ? '🟡' : r.status === 'BELOW TARGET MARGIN' ? '🟠' : '🔴';
      msg += `${icon} <b>${r.service}</b>\n`;
      msg += `  Current min: £${r.currentMin}\n`;
      msg += `  Break-even: £${r.breakEvenPrice}\n`;
      msg += `  Recommended: £${r.recommendedMin}\n`;
      msg += `  Inflation-adj: £${r.inflationAdjusted}\n`;
      if (r.status !== 'OK') msg += `  ⚠️ ${r.notes}\n`;
      msg += `\n`;
    }
    
    const issues = recommendations.filter(r => r.status !== 'OK');
    msg += issues.length > 0 
      ? `⚠️ <b>${issues.length} service(s) need price review</b>`
      : `✅ <b>All prices healthy at current inflation</b>`;
  }
  
  // Send to Telegram (split if too long)
  if (msg.length > 4000) {
    const mid = msg.lastIndexOf('\n', 2000);
    await sendTelegram(msg.substring(0, mid));
    await new Promise(r => setTimeout(r, 500));
    await sendTelegram(msg.substring(mid));
  } else {
    await sendTelegram(msg);
  }
  
  console.log('Finance report sent to Telegram');
  console.log(`Summary: Revenue today=${fmtGBPr(daily.grossRevenue)}, week=${fmtGBPr(weekly.grossRevenue)}, month=${fmtGBPr(monthly.grossRevenue)}, YTD=${fmtGBPr(ytd.grossRevenue)}`);
  console.log(`CPI: ${cpi.rate}% | Pricing alerts: ${recommendations.filter(r => r.status !== 'OK').length}`);
}

main().catch(e => {
  console.error('Fatal:', e);
  sendTelegram('❌ <b>FINANCE AGENT FAILED</b>\n\n' + e.message).then(() => process.exit(1));
});
