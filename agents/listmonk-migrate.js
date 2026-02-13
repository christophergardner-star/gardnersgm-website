#!/usr/bin/env node
/* ══════════════════════════════════════════════════════
   Gardners GM — Listmonk Subscriber Migration
   
   One-time script to migrate existing subscribers from
   Google Sheets to self-hosted Listmonk.
   
   Steps:
     1. Creates mailing lists (basic, premium, professional)
     2. Fetches all subscribers from Google Sheets via GAS
     3. Imports them into Listmonk with tier attributes
     4. Reports results to Telegram
   
   Usage:
     node agents/listmonk-migrate.js              → Full migration
     node agents/listmonk-migrate.js --dry-run     → Preview only
   
   Prerequisites:
     - Listmonk running at LISTMONK_URL (docker-compose up)
     - Run initial Listmonk setup first:
       docker-compose run --rm listmonk ./listmonk --install
   ══════════════════════════════════════════════════════ */

const { apiFetch, sendTelegram, createLogger, CONFIG } = require('./lib/shared');
const { addSubscriber, createList, getLists, isListmonkRunning } = require('./lib/listmonk');

const log = createLogger('listmonk-migrate');
const DRY_RUN = process.argv.includes('--dry-run');

// Subscriber tiers → Listmonk lists
const TIER_LISTS = {
  basic:        'GGM Basic',
  premium:      'GGM Premium',
  professional: 'GGM Professional',
  general:      'GGM Newsletter',
};

async function migrate() {
  log('📧 Starting Listmonk subscriber migration' + (DRY_RUN ? ' (DRY RUN)' : '') + '...');

  // 1. Check Listmonk is running
  if (!DRY_RUN) {
    const running = await isListmonkRunning();
    if (!running) {
      throw new Error('Listmonk is not running. Start it with: cd docker && docker-compose up -d listmonk');
    }
    log('✅ Listmonk is running');
  }

  // 2. Create lists (skip if they already exist)
  const listIds = {};
  if (!DRY_RUN) {
    const existingLists = await getLists();
    const existingNames = (existingLists.data?.results || []).map(l => l.name);

    for (const [tier, listName] of Object.entries(TIER_LISTS)) {
      if (existingNames.includes(listName)) {
        const existing = existingLists.data.results.find(l => l.name === listName);
        listIds[tier] = existing.id;
        log(`  List "${listName}" already exists (ID: ${existing.id})`);
      } else {
        const newList = await createList(listName, 'private', 'single');
        listIds[tier] = newList.data.id;
        log(`  Created list "${listName}" (ID: ${newList.data.id})`);
      }
    }
  }

  // 3. Fetch subscribers from Google Sheets
  let subscribers = [];
  try {
    // Try newsletter-specific endpoint first
    const resp = await apiFetch('get_newsletter_subscribers');
    if (resp.status === 'success' && resp.subscribers) {
      subscribers = resp.subscribers;
    }
  } catch(e) {
    log('get_newsletter_subscribers not available, trying get_subscribers...');
    try {
      const resp = await apiFetch('get_subscribers');
      if (resp.status === 'success' && resp.subscribers) {
        subscribers = resp.subscribers;
      }
    } catch(e2) {
      log('Neither endpoint available — will try extracting from clients...');
      try {
        const resp = await apiFetch('get_clients');
        if (resp.status === 'success') {
          // Extract unique emails from client data
          const seen = new Set();
          subscribers = (resp.clients || [])
            .filter(c => c.email && !seen.has(c.email.toLowerCase()) && seen.add(c.email.toLowerCase()))
            .map(c => ({
              email: c.email,
              name: c.name || c.clientName || '',
              tier: c.tier || c.subscriptionTier || 'general',
              postcode: c.postcode || '',
              phone: c.phone || '',
            }));
        }
      } catch(e3) {
        throw new Error('Could not fetch subscribers from any GAS endpoint');
      }
    }
  }

  log(`Found ${subscribers.length} subscribers to migrate`);

  if (DRY_RUN) {
    log('DRY RUN — would import:');
    const byTier = {};
    subscribers.forEach(s => {
      const tier = s.tier || 'general';
      byTier[tier] = (byTier[tier] || 0) + 1;
    });
    Object.entries(byTier).forEach(([tier, count]) => {
      log(`  ${TIER_LISTS[tier] || tier}: ${count} subscribers`);
    });

    let msg = '📧 <b>LISTMONK MIGRATION — DRY RUN</b>\n\n';
    msg += `Total subscribers: <b>${subscribers.length}</b>\n`;
    Object.entries(byTier).forEach(([tier, count]) => {
      msg += `  • ${TIER_LISTS[tier] || tier}: ${count}\n`;
    });
    msg += '\nRun without --dry-run to import.';
    await sendTelegram(msg);
    return;
  }

  // 4. Import subscribers into Listmonk
  let imported = 0, skipped = 0, failed = 0;
  const errors = [];

  for (const sub of subscribers) {
    try {
      const tier = (sub.tier || 'general').toLowerCase();
      const targetListId = listIds[tier] || listIds.general;
      
      await addSubscriber(
        sub.email,
        sub.name || sub.email.split('@')[0],
        targetListId ? [targetListId] : [],
        {
          tier: tier,
          postcode: sub.postcode || '',
          phone: sub.phone || '',
          migratedFrom: 'google-sheets',
          migratedAt: new Date().toISOString(),
        }
      );
      imported++;
      
      if (imported % 25 === 0) {
        log(`  Progress: ${imported}/${subscribers.length} imported...`);
      }
    } catch(e) {
      if (e.message.includes('already exists') || e.message.includes('duplicate')) {
        skipped++;
      } else {
        failed++;
        if (errors.length < 10) errors.push(`${sub.email}: ${e.message}`);
      }
    }
  }

  // 5. Report results
  log(`Migration complete: ${imported} imported, ${skipped} already existed, ${failed} failed`);

  let msg = '📧 <b>LISTMONK MIGRATION COMPLETE</b>\n';
  msg += '━━━━━━━━━━━━━━━━━━━━\n\n';
  msg += `✅ Imported: <b>${imported}</b>\n`;
  msg += `⏭ Already existed: <b>${skipped}</b>\n`;
  if (failed > 0) {
    msg += `❌ Failed: <b>${failed}</b>\n`;
    if (errors.length) {
      msg += '\n<b>Errors:</b>\n';
      errors.forEach(e => msg += `  • ${e}\n`);
    }
  }
  msg += `\n📊 Total processed: <b>${subscribers.length}</b>`;
  msg += '\n\n🌿 <i>Listmonk is now your email engine!</i>';

  await sendTelegram(msg);
}

// ── Main ──
(async () => {
  try {
    await migrate();
  } catch(err) {
    log('Migration error: ' + err.message);
    try { await sendTelegram('❌ Listmonk migration failed: ' + err.message); } catch(e) {}
    process.exit(1);
  }
})();
