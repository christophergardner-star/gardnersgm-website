/* ============================================
   Gardners GM — Payments & Telegram Hub
   Live Stripe payment tracking + Telegram
   notifications panel on admin dashboard.
   ============================================ */

document.addEventListener('DOMContentLoaded', () => {

    const SHEETS_WEBHOOK = 'https://script.google.com/macros/s/AKfycbxEvk_URObSEcsjWX5NIBoozJvZ47Zl5PTOf2Q3RrwB_t6CRf0od4EfBmOUvaRDPcCZDw/exec';
    const TG_BOT_TOKEN = '8261874993:AAHW6752Ofhsrw6qzOSSZWnfmzbBj7G8Z-g';
    const TG_CHAT_ID   = '6200151295';

    let allClients = [];


    // ============================================
    // LOAD DATA FROM GOOGLE SHEETS
    // ============================================
    async function loadData() {
        try {
            const resp = await fetch(SHEETS_WEBHOOK + '?action=get_clients');
            const data = await resp.json();
            if (data.status === 'success' && data.clients) {
                allClients = data.clients;
                renderPayments();
                renderStats();
                renderRecentActivity();
            }
        } catch (e) {
            console.error('Failed to load data:', e);
        }
    }


    // ============================================
    // DASHBOARD STATS (Enhanced)
    // ============================================
    function renderStats() {
        const total     = allClients.length;
        const subs      = allClients.filter(c => isSubscription(c)).length;
        const bookings  = allClients.filter(c => !isSubscription(c)).length;
        const paid      = allClients.filter(c => c.paid === 'Yes' || c.paid === 'Auto').length;
        const unpaid    = total - paid;
        const revenue   = allClients.reduce((s, c) => s + parsePrice(c.price), 0);
        const outstanding = allClients.filter(c => c.paid !== 'Yes' && c.paid !== 'Auto')
                                       .reduce((s, c) => s + parsePrice(c.price), 0);

        setEl('statClients', total);
        setEl('statSubscribers', subs);
        setEl('statBookings', bookings);
        setEl('statPaid', paid);
        setEl('statUnpaid', unpaid);
        setEl('statRevenue', '£' + revenue.toFixed(0));
        setEl('statOutstanding', '£' + outstanding.toFixed(0));

        const withDist = allClients.filter(c => parseFloat(c.distance));
        if (withDist.length > 0) {
            const avg = withDist.reduce((s, c) => s + parseFloat(c.distance), 0) / withDist.length;
            setEl('statAvgDist', Math.round(avg * 10) / 10 + ' mi');
        }
    }


    // ============================================
    // PAYMENTS TABLE
    // ============================================
    function renderPayments() {
        const container = document.getElementById('paymentsTableBody');
        if (!container) return;

        // Sort by date descending (most recent first)
        const sorted = [...allClients].sort((a, b) => {
            const da = new Date(a.timestamp || a.date || 0);
            const db = new Date(b.timestamp || b.date || 0);
            return db - da;
        });

        if (sorted.length === 0) {
            container.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:2rem; color:#999;"><i class="fas fa-inbox"></i> No payment records yet</td></tr>';
            return;
        }

        container.innerHTML = sorted.map(c => {
            const price     = parsePrice(c.price);
            const isPaid    = c.paid === 'Yes' || c.paid === 'Auto';
            const isSub     = isSubscription(c);
            const paidBadge = isPaid
                ? '<span class="adm-badge adm-badge-green"><i class="fas fa-check-circle"></i> Paid</span>'
                : '<span class="adm-badge adm-badge-red"><i class="fas fa-clock"></i> Unpaid</span>';
            const typeBadge = isSub
                ? '<span class="adm-badge adm-badge-blue"><i class="fas fa-sync-alt"></i> Subscription</span>'
                : '<span class="adm-badge adm-badge-gray"><i class="fas fa-tag"></i> One-off</span>';
            const methodBadge = getPaymentMethodBadge(c.paymentType);
            const dateStr   = formatDate(c.timestamp || c.date);

            return `<tr>
                <td><span class="adm-badge adm-badge-gray" style="font-family:monospace;">${esc(c.jobNumber || '—')}</span></td>
                <td><strong>${esc(c.name || 'Unknown')}</strong></td>
                <td>${esc(c.service || c.type || '—')}</td>
                <td>${typeBadge}</td>
                <td class="adm-price">${price > 0 ? '£' + price.toFixed(2) : '—'}</td>
                <td>${paidBadge}</td>
                <td>${methodBadge}</td>
                <td>${dateStr}</td>
            </tr>`;
        }).join('');
    }


    // ============================================
    // RECENT ACTIVITY FEED
    // ============================================
    function renderRecentActivity() {
        const container = document.getElementById('activityFeed');
        if (!container) return;

        const recent = [...allClients]
            .sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0))
            .slice(0, 8);

        if (recent.length === 0) {
            container.innerHTML = '<p class="adm-empty">No recent activity</p>';
            return;
        }

        container.innerHTML = recent.map(c => {
            const isPaid = c.paid === 'Yes' || c.paid === 'Auto';
            const isSub  = isSubscription(c);
            const icon   = isPaid ? 'fa-check-circle' : 'fa-hourglass-half';
            const color  = isPaid ? '#2E7D32' : '#E65100';
            const action = isSub ? 'Subscription started' : (isPaid ? 'Payment received' : 'Booking received');

            return `<div class="adm-activity-item">
                <div class="adm-activity-icon" style="color:${color}"><i class="fas ${icon}"></i></div>
                <div class="adm-activity-info">
                    <strong>${c.jobNumber ? '<span style="color:#6b7f93; font-family:monospace; font-size:0.75rem;">' + esc(c.jobNumber) + '</span> ' : ''}${esc(c.name || 'Unknown')}</strong>
                    <span>${action} — ${esc(c.service || c.type || '')}</span>
                    <small>${formatDate(c.timestamp)}</small>
                </div>
                <div class="adm-activity-amount">${parsePrice(c.price) > 0 ? '£' + parsePrice(c.price).toFixed(2) : ''}</div>
            </div>`;
        }).join('');
    }


    // ============================================
    // TELEGRAM — QUICK SEND MESSAGE
    // ============================================
    const tgForm = document.getElementById('tgSendForm');
    if (tgForm) {
        tgForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const input = document.getElementById('tgMessage');
            const msg = input.value.trim();
            if (!msg) return;

            const btn = tgForm.querySelector('button[type="submit"]');
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';

            try {
                await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        chat_id: TG_CHAT_ID,
                        text: msg,
                        parse_mode: 'HTML'
                    })
                });
                input.value = '';
                addTgLog('You', msg);
            } catch (err) {
                addTgLog('Error', 'Failed to send: ' + err.message);
            }

            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-paper-plane"></i>';
        });
    }

    // Send a predefined quick message
    window.sendTgQuick = function(type) {
        const messages = {
            'on-way':    '🚗 On my way to your property now!',
            'arrived':   '👋 I\'ve arrived and starting work now.',
            'completed': '✅ Job completed! Your garden is looking great.',
            'reminder':  '📅 Friendly reminder: You have a booking with Gardners GM tomorrow.',
            'payment':   '💳 Payment reminder: You have an outstanding invoice. Please check your email for details.',
            'weather':   '🌧️ Due to weather conditions, we may need to reschedule. I\'ll keep you updated.'
        };
        const msg = messages[type] || '';
        if (msg) {
            document.getElementById('tgMessage').value = msg;
        }
    };

    // Telegram log
    function addTgLog(sender, message) {
        const log = document.getElementById('tgLog');
        if (!log) return;
        const time = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
        const div = document.createElement('div');
        div.className = 'adm-tg-msg ' + (sender === 'You' ? 'adm-tg-sent' : 'adm-tg-received');
        div.innerHTML = `<span class="adm-tg-time">${time}</span> <strong>${esc(sender)}</strong>: ${esc(message)}`;
        log.appendChild(div);
        log.scrollTop = log.scrollHeight;
    }

    // Check for recent Telegram messages (polling)
    async function pollTelegram() {
        try {
            const resp = await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/getUpdates?limit=5&offset=-5`);
            const data = await resp.json();
            if (data.ok && data.result) {
                const log = document.getElementById('tgLog');
                if (!log || log.dataset.loaded === 'true') return;
                log.dataset.loaded = 'true';

                data.result.forEach(update => {
                    if (update.message && update.message.text) {
                        const from = update.message.from.first_name || 'Bot';
                        addTgLog(from, update.message.text);
                    }
                });
            }
        } catch (e) {}
    }


    // ============================================
    // TAB SWITCHING (Payments / Telegram sections)
    // ============================================
    document.querySelectorAll('[data-admin-tab]').forEach(btn => {
        btn.addEventListener('click', () => {
            const target = btn.dataset.adminTab;
            document.querySelectorAll('[data-admin-tab]').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.adm-tab-panel').forEach(p => p.classList.remove('active'));
            btn.classList.add('active');
            const panel = document.getElementById(target);
            if (panel) panel.classList.add('active');
        });
    });

    // Check hash on load for direct panel access
    if (window.location.hash === '#payments') {
        const btn = document.querySelector('[data-admin-tab="panelPayments"]');
        if (btn) btn.click();
    }
    if (window.location.hash === '#telegram') {
        const btn = document.querySelector('[data-admin-tab="panelTelegram"]');
        if (btn) btn.click();
    }
    if (window.location.hash === '#newsletter') {
        const btn = document.querySelector('[data-admin-tab="panelNewsletter"]');
        if (btn) btn.click();
    }


    // ============================================
    // HELPERS
    // ============================================
    function isSubscription(c) {
        const t = (c.type || '').toLowerCase();
        const pt = (c.paymentType || '').toLowerCase();
        return t.includes('subscription') || t.includes('essential') || t.includes('standard') || t.includes('premium') || pt.includes('recurring');
    }

    function parsePrice(val) {
        if (!val) return 0;
        const n = parseFloat(String(val).replace(/[^0-9.\-]/g, ''));
        return isNaN(n) ? 0 : n;
    }

    function formatDate(d) {
        if (!d) return '—';
        try {
            const date = new Date(d);
            if (isNaN(date)) return String(d).substring(0, 10);
            return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
        } catch { return '—'; }
    }

    function getPaymentMethodBadge(type) {
        if (!type) return '<span class="adm-badge adm-badge-gray">—</span>';
        const t = type.toLowerCase();
        if (t.includes('stripe') && t.includes('recurring')) return '<span class="adm-badge adm-badge-purple"><i class="fab fa-stripe-s"></i> Stripe Sub</span>';
        if (t.includes('stripe'))  return '<span class="adm-badge adm-badge-purple"><i class="fab fa-stripe-s"></i> Stripe</span>';
        if (t.includes('cash'))    return '<span class="adm-badge adm-badge-amber"><i class="fas fa-money-bill"></i> Cash</span>';
        if (t.includes('bank'))    return '<span class="adm-badge adm-badge-blue"><i class="fas fa-university"></i> Bank</span>';
        return '<span class="adm-badge adm-badge-gray">' + esc(type) + '</span>';
    }

    function esc(str) {
        if (!str) return '';
        const d = document.createElement('div');
        d.textContent = str;
        return d.innerHTML;
    }

    function setEl(id, val) {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
    }


    // ============================================
    // INIT + AUTO-REFRESH (every 60s)
    // ============================================
    loadData();
    pollTelegram();
    loadFinancialSnapshot();
    loadSubscriptions();
    loadSchedule();

    // Live auto-refresh — poll all data every 60 seconds
    setInterval(() => {
        loadData();
        loadSubscriptions();
        loadSchedule();
        loadFinancialSnapshot();
    }, 60000);


    // ============================================
    // SUBSCRIPTIONS & SCHEDULE PANEL
    // ============================================

    const PACKAGE_INFO = {
        'essential': { label: 'Essential', freq: 'Fortnightly', services: 'Lawn Cutting', color: '#43A047' },
        'standard':  { label: 'Standard',  freq: 'Weekly',      services: 'Lawn Cutting', color: '#1565C0' },
        'premium':   { label: 'Premium',   freq: 'Weekly + Extras', services: 'Lawn Cutting, Hedge Trim (quarterly), Lawn Treatment (quarterly), Scarifying (annual)', color: '#6A1B9A' }
    };

    let allSubscriptions = [];

    async function loadSubscriptions() {
        const body = document.getElementById('subsTableBody');
        if (!body) return;

        try {
            const resp = await fetch(SHEETS_WEBHOOK + '?action=get_subscriptions');
            const data = await resp.json();
            if (data.status === 'success' && data.subscriptions) {
                allSubscriptions = data.subscriptions;
                renderSubscribers();
            }
        } catch(e) {
            console.error('Failed to load subscriptions:', e);
            body.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:2rem;color:#E65100;"><i class="fas fa-exclamation-triangle"></i> Failed to load</td></tr>';
        }
    }

    function renderSubscribers() {
        const body = document.getElementById('subsTableBody');
        if (!body) return;

        if (allSubscriptions.length === 0) {
            body.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:2rem;color:#999;">No active subscribers yet. Subscriptions from the Subscribe page will appear here.</td></tr>';
            return;
        }

        body.innerHTML = allSubscriptions.map(sub => {
            const pkgKey = (sub.package || '').toLowerCase().replace(/\s+/g, '');
            const info = PACKAGE_INFO[pkgKey] || { label: sub.package || 'Custom', freq: 'Custom', services: parseCustomServices(sub.notes), color: '#E65100' };
            const dist = sub.distance ? sub.distance + ' mi' : '—';
            const price = sub.price ? '£' + parsePrice(sub.price).toFixed(2) : '—';
            const statusBadge = sub.status === 'Active' || sub.status === 'active'
                ? '<span class="adm-badge adm-badge-green"><i class="fas fa-check-circle"></i> Active</span>'
                : '<span class="adm-badge adm-badge-gray">' + esc(sub.status) + '</span>';

            return `<tr>
                <td>
                    <strong>${esc(sub.name)}</strong>
                    <br><small style="color:var(--text-light);">${esc(sub.email || '')}</small>
                    ${sub.phone ? '<br><small><a href="tel:' + esc(sub.phone) + '" style="color:var(--primary);">' + esc(sub.phone) + '</a></small>' : ''}
                </td>
                <td><span class="adm-badge" style="background:${info.color}15;color:${info.color};font-weight:700;">${esc(info.label)}</span></td>
                <td><strong>${esc(sub.preferredDay || '—')}</strong></td>
                <td>${esc(info.freq)}</td>
                <td style="font-size:0.82rem;max-width:200px;">${esc(info.services)}</td>
                <td style="font-size:0.82rem;">${esc(sub.postcode || '')}${sub.address ? '<br>' + esc(sub.address.substring(0, 30)) : ''}</td>
                <td>${dist}</td>
                <td class="adm-price">${price}</td>
                <td>${statusBadge}</td>
            </tr>`;
        }).join('');
    }

    function parseCustomServices(notes) {
        if (!notes) return 'Custom';
        var match = String(notes).match(/\[Custom:\s*(.+?)\]/);
        if (match) return match[1];
        return 'Custom';
    }

    // ── Schedule Timeline ──
    async function loadSchedule() {
        const container = document.getElementById('scheduleTimeline');
        const rangeSel = document.getElementById('scheduleRange');
        if (!container) return;

        const days = rangeSel ? rangeSel.value : 14;

        try {
            const resp = await fetch(SHEETS_WEBHOOK + '?action=get_schedule&days=' + days);
            const data = await resp.json();
            if (data.status === 'success') {
                renderScheduleTimeline(data.visits || []);
            }
        } catch(e) {
            container.innerHTML = '<p style="color:#E65100;"><i class="fas fa-exclamation-triangle"></i> Failed to load schedule</p>';
        }
    }

    function renderScheduleTimeline(visits) {
        const container = document.getElementById('scheduleTimeline');
        if (!container) return;

        if (visits.length === 0) {
            container.innerHTML = `<div style="text-align:center;padding:2rem;color:#999;">
                <i class="fas fa-calendar-times" style="font-size:2rem;margin-bottom:0.5rem;display:block;"></i>
                No scheduled visits yet. Click <strong>Auto-Generate Schedule</strong> to create visits from your subscribers.
            </div>`;
            return;
        }

        // Group by date
        const byDate = {};
        visits.forEach(v => {
            if (!byDate[v.visitDate]) byDate[v.visitDate] = [];
            byDate[v.visitDate].push(v);
        });

        const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
        const today = new Date().toISOString().substring(0, 10);

        let html = '<div class="sched-timeline">';

        Object.keys(byDate).sort().forEach(dateStr => {
            const dateObj = new Date(dateStr + 'T12:00:00');
            const dayName = dayNames[dateObj.getDay()];
            const dayLabel = dayName + ' ' + dateObj.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
            const isToday = dateStr === today;
            const dayVisits = byDate[dateStr];

            html += `<div class="sched-day${isToday ? ' sched-today' : ''}">
                <div class="sched-day-header">
                    <span class="sched-day-name">${dayLabel}</span>
                    <span class="sched-day-count">${dayVisits.length} visit${dayVisits.length > 1 ? 's' : ''}</span>
                    ${isToday ? '<span class="adm-badge adm-badge-green" style="font-size:0.7rem;">TODAY</span>' : ''}
                </div>
                <div class="sched-day-jobs">`;

            dayVisits.forEach(v => {
                const statusIcon = v.status === 'Completed' ? 'fa-check-circle' : (v.status === 'Cancelled' ? 'fa-times-circle' : 'fa-clock');
                const statusColor = v.status === 'Completed' ? '#16a34a' : (v.status === 'Cancelled' ? '#ef4444' : 'var(--primary)');
                html += `<div class="sched-visit-card">
                    <div style="display:flex;align-items:center;gap:0.5rem;">
                        <i class="fas ${statusIcon}" style="color:${statusColor};"></i>
                        <strong>${esc(v.service)}</strong>
                        <span style="color:var(--text-light);font-size:0.82rem;">— ${esc(v.name)}</span>
                    </div>
                    <div style="display:flex;gap:1rem;font-size:0.82rem;color:var(--text-light);margin-top:0.25rem;">
                        <span><i class="fas fa-map-pin"></i> ${esc(v.postcode || '')}${v.distance ? ' (' + v.distance + ' mi)' : ''}</span>
                        ${v.phone ? '<span><a href="tel:' + esc(v.phone) + '" style="color:var(--primary);"><i class="fas fa-phone"></i> ' + esc(v.phone) + '</a></span>' : ''}
                        <span class="adm-badge adm-badge-gray" style="font-size:0.7rem;">${esc(v.package || '')}</span>
                    </div>
                </div>`;
            });

            html += '</div></div>';
        });

        html += '</div>';
        container.innerHTML = html;
    }

    // ── Schedule range change ──
    const rangeSelect = document.getElementById('scheduleRange');
    if (rangeSelect) {
        rangeSelect.addEventListener('change', loadSchedule);
    }

    // ── Auto-Generate Schedule button ──
    const btnGen = document.getElementById('btnGenSchedule');
    if (btnGen) {
        btnGen.addEventListener('click', async () => {
            btnGen.disabled = true;
            btnGen.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Generating...';
            try {
                const resp = await fetch(SHEETS_WEBHOOK, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'generate_schedule', weeksAhead: 8 })
                });
                const data = await resp.json();
                if (data.status === 'success') {
                    btnGen.innerHTML = '<i class="fas fa-check"></i> Generated ' + (data.generated || 0) + ' visits!';
                    setTimeout(() => {
                        btnGen.innerHTML = '<i class="fas fa-magic"></i> Auto-Generate Schedule';
                        btnGen.disabled = false;
                    }, 3000);
                    loadSchedule(); // refresh timeline
                }
            } catch(e) {
                btnGen.innerHTML = '<i class="fas fa-exclamation-triangle"></i> Failed';
                setTimeout(() => {
                    btnGen.innerHTML = '<i class="fas fa-magic"></i> Auto-Generate Schedule';
                    btnGen.disabled = false;
                }, 3000);
            }
        });
    }

    // ── Send Digest to Telegram button ──
    const btnDigest = document.getElementById('btnSendDigest');
    if (btnDigest) {
        btnDigest.addEventListener('click', async () => {
            btnDigest.disabled = true;
            btnDigest.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending...';
            try {
                const resp = await fetch(SHEETS_WEBHOOK, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'send_schedule_digest', daysAhead: 7 })
                });
                const data = await resp.json();
                if (data.status === 'success') {
                    btnDigest.innerHTML = '<i class="fas fa-check"></i> Sent ' + (data.visits || 0) + ' visits to Telegram!';
                } else {
                    btnDigest.innerHTML = '<i class="fas fa-exclamation-triangle"></i> Failed';
                }
            } catch(e) {
                btnDigest.innerHTML = '<i class="fas fa-exclamation-triangle"></i> Failed';
            }
            setTimeout(() => {
                btnDigest.innerHTML = '<i class="fas fa-paper-plane"></i> Send Week to Telegram';
                btnDigest.disabled = false;
            }, 4000);
        });
    }


    // ============================================
    // FINANCIAL SNAPSHOT (Overview Panel)
    // ============================================
    const SERVICE_MATERIAL_COSTS = {
        'lawn-cutting':     { cost: 1.50 },
        'hedge-trimming':   { cost: 2.00 },
        'lawn-treatment':   { cost: 12.00 },
        'scarifying':       { cost: 15.00 },
        'garden-clearance': { cost: 25.00 },
        'power-washing':    { cost: 5.00 }
    };

    async function loadFinancialSnapshot() {
        const now = new Date();
        const monthKey = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
        const monthLabel = now.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
        const monthEl = document.getElementById('finMonth');
        if (monthEl) monthEl.textContent = monthLabel;

        try {
            // Fetch business costs + clients in parallel
            const [costsResp, clientsResp] = await Promise.all([
                fetch(SHEETS_WEBHOOK + '?action=get_business_costs').then(r => r.json()),
                allClients.length ? Promise.resolve(null) : fetch(SHEETS_WEBHOOK + '?action=get_clients').then(r => r.json())
            ]);

            // If clients weren't loaded yet, use fetched data
            if (clientsResp && clientsResp.status === 'success' && clientsResp.clients) {
                allClients = clientsResp.clients;
            }

            // Find costs for this month
            let monthCosts = {};
            if (costsResp.status === 'success' && costsResp.costs) {
                monthCosts = costsResp.costs.find(c => c.month === monthKey) || {};
            }

            // Filter this month's jobs
            const thisMonthJobs = allClients.filter(c => {
                const d = c.date || c.timestamp;
                if (!d) return false;
                const jd = new Date(d);
                return jd.getFullYear() === now.getFullYear() && jd.getMonth() === now.getMonth();
            });

            const jobCount = thisMonthJobs.length;
            const revenue = thisMonthJobs.reduce((s, c) => s + parsePrice(c.price), 0);
            const outstanding = thisMonthJobs
                .filter(c => c.paid !== 'Yes' && c.paid !== 'Auto')
                .reduce((s, c) => s + parsePrice(c.price), 0);

            // Calculate fuel costs
            const fuelRate = monthCosts.fuelRate || 0.45;
            const totalFuel = thisMonthJobs.reduce((s, c) => {
                const dist = parseFloat(c.distance) || 5;
                return s + (dist * 2 * fuelRate);
            }, 0);

            // Calculate material costs (per-job)
            const totalMaterials = thisMonthJobs.reduce((s, c) => {
                const svc = (c.service || c.type || '').toLowerCase().replace(/\s+/g, '-');
                const mat = SERVICE_MATERIAL_COSTS[svc];
                return s + (mat ? mat.cost : 0);
            }, 0);

            // Calculate monthly overheads
            const overheadFields = [
                'vehicleInsurance', 'publicLiability', 'equipmentMaint', 'vehicleMaint',
                'marketing', 'natInsurance', 'incomeTax', 'phoneInternet',
                'software', 'accountancy', 'other', 'wasteDisposal',
                'treatmentProducts', 'consumables'
            ];
            const overheadTotal = overheadFields.reduce((s, f) => s + (Number(monthCosts[f]) || 0), 0);

            const totalCosts = totalFuel + totalMaterials + overheadTotal;
            const netProfit = revenue - totalCosts;
            const margin = revenue > 0 ? (netProfit / revenue * 100) : 0;

            // Render
            setEl('finRevenue', '£' + revenue.toFixed(0));
            setEl('finCosts', '£' + totalCosts.toFixed(0));
            setEl('finProfit', '£' + netProfit.toFixed(0));
            setEl('finMargin', margin.toFixed(1) + '%');
            setEl('finFuel', '£' + totalFuel.toFixed(0));
            setEl('finMaterials', '£' + totalMaterials.toFixed(0));
            setEl('finOverheads', '£' + overheadTotal.toFixed(0));
            setEl('finOutstanding', '£' + outstanding.toFixed(0));
            setEl('finJobCount', jobCount);

            // Colour the profit value
            const profitEl = document.getElementById('finProfit');
            if (profitEl) profitEl.style.color = netProfit >= 0 ? '#16a34a' : '#ef4444';
            const marginEl = document.getElementById('finMargin');
            if (marginEl) marginEl.style.color = margin >= 30 ? '#16a34a' : margin >= 15 ? '#f59e0b' : '#ef4444';

            // Profit vs cost bar
            if (revenue > 0) {
                const costPct = Math.min(100, (totalCosts / revenue) * 100);
                const profPct = Math.max(0, 100 - costPct);
                const barCost = document.getElementById('finBarCost');
                const barProfit = document.getElementById('finBarProfit');
                if (barCost) barCost.style.width = costPct.toFixed(1) + '%';
                if (barProfit) barProfit.style.width = profPct.toFixed(1) + '%';
            }

            // Show content, hide loading
            const loading = document.getElementById('finLoading');
            const content = document.getElementById('finContent');
            if (loading) loading.style.display = 'none';
            if (content) content.style.display = 'block';

        } catch (e) {
            console.error('Financial snapshot error:', e);
            const loading = document.getElementById('finLoading');
            if (loading) loading.innerHTML = '<i class="fas fa-exclamation-triangle" style="color:#E65100;"></i> Failed to load financial data';
        }
    }

});
