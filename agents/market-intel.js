#!/usr/bin/env node
/* ══════════════════════════════════════════════════════
   Gardners GM — Market Intelligence Agent (Node wrapper)
   
   Spawns the Python market_intel.py scraper, captures
   output, and sends a summary to Telegram.
   
   Schedule: Sunday 22:00 (weekly) via n8n or orchestrator
   
   Usage:
     node agents/market-intel.js              → Full scrape + report
     node agents/market-intel.js --weather    → Weather only
   ══════════════════════════════════════════════════════ */

const path = require('path');
const { spawn } = require('child_process');
const { sendTelegram, createLogger } = require('./lib/shared');

const log = createLogger('market-intel');

// Path to the Python script
const PYTHON_SCRIPT = path.join(__dirname, '..', 'platform', 'app', 'market_intel.py');
const PYTHON_EXE = path.join(__dirname, '..', '.venv', 'Scripts', 'python.exe');

async function run() {
  log('🔍 Starting market intelligence scan...');

  const args = [PYTHON_SCRIPT, ...process.argv.slice(2)];
  
  return new Promise((resolve, reject) => {
    const proc = spawn(PYTHON_EXE, args, {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env },
      timeout: 600000, // 10 min timeout
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', d => { stdout += d.toString(); });
    proc.stderr.on('data', d => { stderr += d.toString(); });

    proc.on('close', async (code) => {
      if (code === 0) {
        log('Market intel scan complete');
        log(stdout);

        // Send summary to Telegram
        let msg = '🔍 <b>MARKET INTELLIGENCE</b>\n';
        msg += '━━━━━━━━━━━━━━━━━━━━\n\n';
        
        // Parse stdout for key metrics
        const lines = stdout.trim().split('\n');
        lines.forEach(line => {
          if (line.includes('Good working days')) {
            msg += '🌤️ ' + line.trim() + '\n';
          } else if (line.includes('Competitor sources')) {
            msg += '🔍 ' + line.trim() + '\n';
          } else if (line.includes('report generated')) {
            msg += '📄 ' + line.trim() + '\n';
          }
        });
        
        msg += '\n🌿 <i>Full report saved — check platform/data/market_intel/</i>';
        
        try { await sendTelegram(msg); } catch(e) { log('Telegram send failed: ' + e.message); }
        resolve();
      } else {
        const errMsg = `Market intel failed (exit ${code}): ${stderr.substring(0, 500)}`;
        log(errMsg);
        try { await sendTelegram('❌ ' + errMsg); } catch(e) {}
        reject(new Error(errMsg));
      }
    });

    proc.on('error', (err) => {
      log('Failed to start market intel: ' + err.message);
      reject(err);
    });
  });
}

// ── Main ──
run().catch(err => {
  log('Fatal error: ' + err.message);
  process.exit(1);
});
