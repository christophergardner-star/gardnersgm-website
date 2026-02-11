/* ============================================
   Gardners GM — Payments & Telegram Hub
   Live Stripe payment tracking + Telegram
   notifications panel on admin dashboard.
   ============================================ */

document.addEventListener('DOMContentLoaded', () => {

    const SHEETS_WEBHOOK = 'https://script.google.com/macros/s/AKfycbx-q2qSeCorIEeXPE9d2MgAZLKEFwFNW9lARLE1yYciH9wJWwvktUTuDVLz_rSCbUhkMg/exec';

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
                await fetch(SHEETS_WEBHOOK, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        action: 'relay_telegram',
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
            const resp = await fetch(SHEETS_WEBHOOK + '?action=get_telegram_updates&limit=5&offset=-5');
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
    if (window.location.hash === '#finance') {
        const btn = document.querySelector('[data-admin-tab="panelFinance"]');
        if (btn) btn.click();
    }
    if (window.location.hash === '#careers') {
        const btn = document.querySelector('[data-admin-tab="panelCareers"]');
        if (btn) btn.click();
    }
    if (window.location.hash === '#complaints') {
        const btn = document.querySelector('[data-admin-tab="panelComplaints"]');
        if (btn) btn.click();
    }

    // Check localStorage for tab redirect (from manager.html "Post Jobs" button etc.)
    const storedTab = localStorage.getItem('adminTab');
    if (storedTab) {
        localStorage.removeItem('adminTab');
        const btn = document.querySelector('[data-admin-tab="' + storedTab + '"]');
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


    // ============================================
    // EMAIL WORKFLOW PANEL
    // ============================================
    async function loadEmailWorkflow() {
        try {
            const resp = await fetch(SHEETS_WEBHOOK + '?action=get_email_workflow_status');
            const data = await resp.json();
            if (data.status === 'success' && data.workflow) {
                renderEmailWorkflow(data.workflow);
            }
        } catch (e) {
            console.error('Email workflow load error:', e);
        }
    }

    function renderEmailWorkflow(wf) {
        // Stats cards
        setEl('ewToday', wf.emailStats ? wf.emailStats.today : 0);
        setEl('ewWeek', wf.emailStats ? wf.emailStats.thisWeek : 0);
        setEl('ewMonth', wf.emailStats ? wf.emailStats.thisMonth : 0);
        setEl('ewTermsTotal', wf.termsAccepted ? wf.termsAccepted.total : 0);

        // Terms breakdown
        setEl('ewPayNow', wf.termsAccepted ? wf.termsAccepted.payNow : 0);
        setEl('ewPayLater', wf.termsAccepted ? wf.termsAccepted.payLater : 0);
        setEl('ewSubscription', wf.termsAccepted ? wf.termsAccepted.subscription : 0);

        // Recent emails table
        const tbody = document.getElementById('ewEmailTableBody');
        if (tbody && wf.recentEmails && wf.recentEmails.length > 0) {
            tbody.innerHTML = wf.recentEmails.map(em => {
                const date = new Date(em.date);
                const dateStr = date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' });
                const timeStr = date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
                const typeLabel = formatEmailType(em.type);
                const statusBadge = em.status === 'Sent' 
                    ? '<span class="adm-badge adm-badge-green">Sent</span>'
                    : '<span class="adm-badge adm-badge-amber">' + (em.status || 'Unknown') + '</span>';
                return '<tr>' +
                    '<td>' + dateStr + ' ' + timeStr + '</td>' +
                    '<td><strong>' + (em.name || '—') + '</strong><br><span style="font-size:0.78rem;color:#999;">' + (em.email || '') + '</span></td>' +
                    '<td>' + typeLabel + '</td>' +
                    '<td>' + (em.service || '—') + '</td>' +
                    '<td>' + (em.jobNumber || '—') + '</td>' +
                    '<td>' + statusBadge + '</td>' +
                    '</tr>';
            }).join('');
        } else if (tbody) {
            tbody.innerHTML = '<tr><td colspan="6" class="adm-empty">No emails sent yet</td></tr>';
        }
    }

    function formatEmailType(type) {
        const map = {
            'booking-confirmation': '📋 Booking Confirmation',
            'pay-later-invoice': '📋 Pay Later Invoice',
            'subscriber-contract': '📄 Subscriber Contract',
            'payment-received': '💚 Payment Received',
            'visit-reminder': '📅 Visit Reminder',
            'aftercare': '🌱 Aftercare Tips',
            'follow-up': '⭐ Follow Up',
            'invoice': '🧾 Invoice',
            'completion': '✅ Completion',
            'subscription-confirmation': '🔄 Sub Confirmation'
        };
        return map[type] || type || '📧 Email';
    }

    // Load email workflow + live income when panel is visited
    function loadLiveIncome() {
        // Use already-loaded allClients data for income/expenditure
        const revenue = allClients.reduce((s, c) => s + parsePrice(c.price), 0);
        const paidRevenue = allClients.filter(c => c.paid === 'Yes' || c.paid === 'Auto')
                                       .reduce((s, c) => s + parsePrice(c.price), 0);
        const outstanding = revenue - paidRevenue;

        // Break down by type
        const payNowInc = allClients.filter(c => c.paid === 'Yes' && !isSubscription(c))
                                     .reduce((s, c) => s + parsePrice(c.price), 0);
        const subsInc = allClients.filter(c => isSubscription(c) && (c.paid === 'Yes' || c.paid === 'Auto'))
                                   .reduce((s, c) => s + parsePrice(c.price), 0);
        const payLaterInc = allClients.filter(c => c.paid === 'Yes' && c.paymentMethod === 'Pay Later')
                                       .reduce((s, c) => s + parsePrice(c.price), 0);

        // Get total costs from financial snapshot if available
        let totalCosts = 0;
        const costsEl = document.getElementById('finCosts');
        if (costsEl) {
            totalCosts = parseFloat(costsEl.textContent.replace(/[£,]/g, '')) || 0;
        }
        const netProfit = paidRevenue - totalCosts;

        setEl('ewIncome', '£' + paidRevenue.toFixed(0));
        setEl('ewExpenditure', '£' + totalCosts.toFixed(0));
        setEl('ewNetProfit', '£' + netProfit.toFixed(0));
        setEl('ewIncPayNow', '£' + payNowInc.toFixed(0));
        setEl('ewIncPayLater', '£' + payLaterInc.toFixed(0));
        setEl('ewIncSubs', '£' + subsInc.toFixed(0));
        setEl('ewIncOutstanding', '£' + outstanding.toFixed(0));

        // Colour net profit
        const profEl = document.getElementById('ewNetProfit');
        if (profEl) profEl.style.color = netProfit >= 0 ? '#2E7D32' : '#E53935';

        // Bar chart
        const total = paidRevenue + totalCosts;
        if (total > 0) {
            const incPct = (paidRevenue / total * 100).toFixed(1);
            const expPct = (totalCosts / total * 100).toFixed(1);
            const barInc = document.getElementById('ewBarIncome');
            const barExp = document.getElementById('ewBarExpense');
            if (barInc) barInc.style.width = incPct + '%';
            if (barExp) barExp.style.width = expPct + '%';
        }

        // Show content
        const loading = document.getElementById('ewIncomeLoading');
        const content = document.getElementById('ewIncomeContent');
        if (loading) loading.style.display = 'none';
        if (content) content.style.display = 'block';
    }

    // Hook into tab switching to load email workflow data when tab opens
    document.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-admin-tab="panelEmailWorkflow"]');
        if (btn) {
            loadEmailWorkflow();
            loadLiveIncome();
        }
        const qbBtn = e.target.closest('[data-admin-tab="panelQuoteBuilder"]');
        if (qbBtn) loadQuotes();
    });


    // ============================================
    // QUOTE BUILDER SYSTEM (Advanced Bespoke)
    // ============================================

    let allQuotes = [];
    let qbLineItems = [];  // Each item: { category, description, qty, unit, unitPrice }
    let editingQuoteId = null;

    const QB_CAT_ICONS = {
        service: '<i class="fas fa-leaf" style="color:#1B5E20;"></i>',
        labour: '<i class="fas fa-hard-hat" style="color:#1565C0;"></i>',
        materials: '<i class="fas fa-box-open" style="color:#6A1B9A;"></i>',
        equipment: '<i class="fas fa-truck" style="color:#E65100;"></i>',
        traffic: '<i class="fas fa-road" style="color:#C62828;"></i>',
        waste: '<i class="fas fa-dumpster" style="color:#795548;"></i>',
        custom: '<i class="fas fa-cog" style="color:#455A64;"></i>',
        surcharge: '<i class="fas fa-bolt" style="color:#F57C00;"></i>'
    };

    const QB_UNIT_OPTIONS = ['job','each','hour','day','m²','linear m','panel','bag','roll','kg','litre','load','trip'];

    async function loadQuotes() {
        try {
            const resp = await fetch(SHEETS_WEBHOOK + '?action=get_quotes');
            const data = await resp.json();
            if (data.status === 'success') {
                allQuotes = data.quotes || [];
                renderQuotesTable();
                renderQuoteStats();
                populateCustomerDropdown();
            }
        } catch (e) { console.error('Failed to load quotes:', e); }
    }

    function renderQuoteStats() {
        const total = allQuotes.length;
        const sent = allQuotes.filter(q => q.status === 'Sent').length;
        const accepted = allQuotes.filter(q => q.status === 'Accepted' || q.status === 'Deposit Paid').length;
        const declined = allQuotes.filter(q => q.status === 'Declined').length;
        const value = allQuotes.reduce((s, q) => s + (parseFloat(q.grandTotal) || 0), 0);

        setEl('qbStatTotal', total);
        setEl('qbStatSent', sent);
        setEl('qbStatAccepted', accepted);
        setEl('qbStatDeclined', declined);
        setEl('qbStatValue', '£' + value.toFixed(0));
    }

    function renderQuotesTable() {
        const tbody = document.getElementById('qbQuotesTableBody');
        const search = (document.getElementById('qbSearch')?.value || '').toLowerCase();
        const statusF = document.getElementById('qbFilterStatus')?.value || '';

        let filtered = allQuotes.filter(q => {
            if (statusF && q.status !== statusF) return false;
            if (search) {
                const hay = [q.quoteId, q.name, q.email, q.title].join(' ').toLowerCase();
                if (!hay.includes(search)) return false;
            }
            return true;
        });

        filtered.sort((a, b) => new Date(b.created || 0) - new Date(a.created || 0));

        if (filtered.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:30px;color:#999;">No quotes found</td></tr>';
            return;
        }

        const statusColors = {
            'Draft': '#78909C', 'Sent': '#1565C0', 'Accepted': '#2E7D32',
            'Declined': '#C62828', 'Expired': '#757575', 'Deposit Paid': '#E65100', 'Awaiting Deposit': '#F57C00'
        };

        tbody.innerHTML = filtered.map(q => {
            const col = statusColors[q.status] || '#666';
            const dateStr = q.created ? new Date(q.created).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' }) : '';
            // Count items
            let itemCount = 0;
            try { const li = typeof q.lineItems === 'string' ? JSON.parse(q.lineItems) : q.lineItems; itemCount = Array.isArray(li) ? li.length : 0; } catch(e) {}
            return `<tr style="cursor:pointer;" onclick="window.qbViewQuote('${escH(q.quoteId)}')">
                <td style="padding:10px;font-weight:bold;">${escH(q.quoteId)}</td>
                <td style="padding:10px;">${escH(q.name || '—')}<br><small style="color:#888;">${escH(q.email || '')}</small></td>
                <td style="padding:10px;">${escH(q.title || '—')}<br><small style="color:#999;">${itemCount} item${itemCount !== 1 ? 's' : ''}</small></td>
                <td style="padding:10px;font-weight:bold;">£${parseFloat(q.grandTotal || 0).toFixed(2)}</td>
                <td style="padding:10px;"><span style="background:${col};color:#fff;padding:3px 10px;border-radius:12px;font-size:12px;">${escH(q.status || 'Draft')}</span></td>
                <td style="padding:10px;font-size:13px;">${dateStr}</td>
                <td style="padding:10px;">
                    ${q.status === 'Draft' || q.status === 'Sent' ? `<button onclick="event.stopPropagation();window.qbResend('${escH(q.quoteId)}')" style="background:#1565C0;color:#fff;border:none;padding:5px 12px;border-radius:4px;cursor:pointer;font-size:12px;" title="Send/Resend"><i class="fas fa-paper-plane"></i></button>` : ''}
                </td>
            </tr>`;
        }).join('');
    }

    function escH(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

    function populateCustomerDropdown() {
        const sel = document.getElementById('qbExistingCustomer');
        if (!sel) return;
        sel.innerHTML = '<option value="">-- Link existing customer or type new --</option>';
        const seen = {};
        allClients.forEach(c => {
            if (!c.email || seen[c.email]) return;
            seen[c.email] = true;
            sel.innerHTML += `<option value="${escH(c.email)}" data-name="${escH(c.name || '')}" data-phone="${escH(c.phone || '')}" data-address="${escH(c.address || '')}" data-postcode="${escH(c.postcode || '')}">${escH(c.name || 'Unknown')} — ${escH(c.email)}</option>`;
        });
    }

    // Customer dropdown auto-fill
    document.getElementById('qbExistingCustomer')?.addEventListener('change', function() {
        const opt = this.selectedOptions[0];
        if (!opt || !opt.value) return;
        document.getElementById('qbCustName').value = opt.dataset.name || '';
        document.getElementById('qbCustEmail').value = opt.value;
        document.getElementById('qbCustPhone').value = opt.dataset.phone || '';
        document.getElementById('qbCustAddress').value = opt.dataset.address || '';
        document.getElementById('qbCustPostcode').value = opt.dataset.postcode || '';
    });

    // Filters
    document.getElementById('qbSearch')?.addEventListener('input', renderQuotesTable);
    document.getElementById('qbFilterStatus')?.addEventListener('change', renderQuotesTable);

    // New Quote button
    document.getElementById('qbNewQuoteBtn')?.addEventListener('click', () => openQuoteModal());

    // ── Category toggle panels ──
    document.querySelectorAll('.qb-cat-toggle').forEach(btn => {
        btn.addEventListener('click', () => {
            const cat = btn.dataset.cat;
            if (cat === 'custom') {
                // Directly add a blank custom line
                addLineItem('custom', '', 1, 'job', 0);
                return;
            }
            const panel = document.getElementById('qbCatPanel_' + cat);
            if (!panel) return;
            // Toggle visibility
            const isOpen = panel.style.display !== 'none';
            // Close all panels first
            document.querySelectorAll('.qb-cat-panel').forEach(p => p.style.display = 'none');
            if (!isOpen) panel.style.display = 'block';
        });
    });

    // ── Template buttons ──
    document.querySelectorAll('.qb-template-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const desc = btn.dataset.desc;
            const price = parseFloat(btn.dataset.price) || 0;
            const unit = btn.dataset.unit || 'job';
            const cat = btn.dataset.cat || 'custom';
            addLineItem(cat, desc, 1, unit, price);
        });
    });

    // ── Surcharge checkboxes ──
    document.getElementById('qbCalloutCharge')?.addEventListener('change', function() {
        document.getElementById('qbCalloutAmount').disabled = !this.checked;
        recalcTotals();
    });
    document.getElementById('qbCalloutAmount')?.addEventListener('input', recalcTotals);
    document.getElementById('qbDistanceSurcharge')?.addEventListener('change', function() {
        document.getElementById('qbDistanceAmount').disabled = !this.checked;
        recalcTotals();
    });
    document.getElementById('qbDistanceAmount')?.addEventListener('input', recalcTotals);
    document.getElementById('qbUrgentSurcharge')?.addEventListener('change', function() {
        document.getElementById('qbUrgentPct').disabled = !this.checked;
        recalcTotals();
    });
    document.getElementById('qbUrgentPct')?.addEventListener('change', recalcTotals);

    // Discount & VAT listeners
    document.getElementById('qbDiscountPct')?.addEventListener('input', recalcTotals);
    document.getElementById('qbAddVat')?.addEventListener('change', recalcTotals);

    // Modal close
    document.getElementById('qbModalClose')?.addEventListener('click', () => {
        document.getElementById('qbModal').style.display = 'none';
    });
    document.getElementById('qbModal')?.addEventListener('click', (e) => {
        if (e.target.id === 'qbModal') e.target.style.display = 'none';
    });

    // Save Draft
    document.getElementById('qbSaveDraft')?.addEventListener('click', () => submitQuote(false));
    // Send Quote
    document.getElementById('qbSendQuote')?.addEventListener('click', () => submitQuote(true));
    // Duplicate
    document.getElementById('qbDuplicateQuote')?.addEventListener('click', () => {
        editingQuoteId = null;
        document.getElementById('qbModalTitle').textContent = 'New Quote (Duplicated)';
        document.getElementById('qbDuplicateQuote').style.display = 'none';
    });

    function openQuoteModal(quote) {
        editingQuoteId = null;
        qbLineItems = [];

        // Reset form
        document.getElementById('qbCustName').value = '';
        document.getElementById('qbCustEmail').value = '';
        document.getElementById('qbCustPhone').value = '';
        document.getElementById('qbCustAddress').value = '';
        document.getElementById('qbCustPostcode').value = '';
        document.getElementById('qbTitle').value = '';
        document.getElementById('qbNotes').value = '';
        document.getElementById('qbDiscountPct').value = '0';
        document.getElementById('qbAddVat').checked = false;
        document.getElementById('qbRequireDeposit').checked = true;
        document.getElementById('qbExistingCustomer').value = '';
        document.getElementById('qbModalTitle').textContent = 'New Quote';
        document.getElementById('qbDuplicateQuote').style.display = 'none';
        document.getElementById('qbEstDays').value = '0';
        document.getElementById('qbEstHours').value = '0';
        document.getElementById('qbComplexity').value = 'standard';
        document.getElementById('qbValidDays').value = '30';

        // Reset surcharges
        document.getElementById('qbCalloutCharge').checked = false;
        document.getElementById('qbCalloutAmount').disabled = true;
        document.getElementById('qbCalloutAmount').value = '40';
        document.getElementById('qbDistanceSurcharge').checked = false;
        document.getElementById('qbDistanceAmount').disabled = true;
        document.getElementById('qbDistanceAmount').value = '0';
        document.getElementById('qbUrgentSurcharge').checked = false;
        document.getElementById('qbUrgentPct').disabled = true;
        document.getElementById('qbUrgentPct').value = '50';
        if (document.getElementById('qbIncludeBreakdown')) document.getElementById('qbIncludeBreakdown').checked = true;

        // Close all category panels
        document.querySelectorAll('.qb-cat-panel').forEach(p => p.style.display = 'none');

        if (quote) {
            editingQuoteId = quote.quoteId;
            document.getElementById('qbModalTitle').textContent = 'Edit Quote ' + quote.quoteId;
            document.getElementById('qbDuplicateQuote').style.display = '';
            document.getElementById('qbCustName').value = quote.name || '';
            document.getElementById('qbCustEmail').value = quote.email || '';
            document.getElementById('qbCustPhone').value = quote.phone || '';
            document.getElementById('qbCustAddress').value = quote.address || '';
            document.getElementById('qbCustPostcode').value = quote.postcode || '';
            document.getElementById('qbTitle').value = quote.title || '';
            document.getElementById('qbNotes').value = quote.notes || '';
            document.getElementById('qbDiscountPct').value = quote.discountPct || '0';
            document.getElementById('qbRequireDeposit').checked = quote.depositRequired === 'Yes';

            try {
                const items = typeof quote.lineItems === 'string' ? JSON.parse(quote.lineItems) : quote.lineItems;
                if (Array.isArray(items)) items.forEach(it => {
                    addLineItem(it.category || 'custom', it.description, it.qty || 1, it.unit || 'job', it.unitPrice || 0);
                });
            } catch(e) {}

            if (parseFloat(quote.vatAmt) > 0) document.getElementById('qbAddVat').checked = true;
        }

        renderLineItems();
        recalcTotals();
        document.getElementById('qbModal').style.display = 'block';
    }

    function addLineItem(category, desc, qty, unit, unitPrice) {
        qbLineItems.push({ category: category || 'custom', description: desc || '', qty: qty || 1, unit: unit || 'job', unitPrice: unitPrice || 0 });
        renderLineItems();
        recalcTotals();
    }

    function removeLineItem(idx) {
        qbLineItems.splice(idx, 1);
        renderLineItems();
        recalcTotals();
    }

    function duplicateLineItem(idx) {
        const item = qbLineItems[idx];
        qbLineItems.splice(idx + 1, 0, { ...item });
        renderLineItems();
        recalcTotals();
    }

    function renderLineItems() {
        const tbody = document.getElementById('qbLineItemsBody');

        if (qbLineItems.length === 0) {
            tbody.innerHTML = '<tr id="qbNoItems"><td colspan="7" style="text-align:center;padding:20px;color:#999;">No items yet — click a category above to add items</td></tr>';
            return;
        }

        const unitOpts = QB_UNIT_OPTIONS.map(u => `<option value="${u}">${u}</option>`).join('');

        tbody.innerHTML = qbLineItems.map((item, i) => {
            const total = ((item.qty || 1) * (item.unitPrice || 0)).toFixed(2);
            const icon = QB_CAT_ICONS[item.category] || QB_CAT_ICONS.custom;
            const unitSelect = `<select onchange="window.qbUpdateItem(${i},'unit',this.value)" style="width:100%;padding:6px;border:1px solid #ddd;border-radius:4px;font-size:12px;">${QB_UNIT_OPTIONS.map(u => `<option value="${u}"${u === item.unit ? ' selected' : ''}>${u}</option>`).join('')}</select>`;

            return `<tr>
                <td style="padding:6px 4px;text-align:center;" title="${escH(item.category)}">${icon}</td>
                <td style="padding:6px 4px;"><input type="text" value="${escH(item.description)}" onchange="window.qbUpdateItem(${i},'description',this.value)" placeholder="Item description..." style="width:100%;padding:7px;border:1px solid #ddd;border-radius:4px;font-size:13px;box-sizing:border-box;"></td>
                <td style="padding:6px 4px;"><input type="number" value="${item.qty}" min="0.1" step="0.5" onchange="window.qbUpdateItem(${i},'qty',this.value)" style="width:60px;padding:7px;border:1px solid #ddd;border-radius:4px;text-align:center;font-size:13px;"></td>
                <td style="padding:6px 4px;">${unitSelect}</td>
                <td style="padding:6px 4px;"><input type="number" value="${item.unitPrice}" min="0" step="0.50" onchange="window.qbUpdateItem(${i},'unitPrice',this.value)" style="width:90px;padding:7px;border:1px solid #ddd;border-radius:4px;text-align:right;font-size:13px;"></td>
                <td style="padding:6px 4px;text-align:right;font-weight:bold;font-size:13px;">£${total}</td>
                <td style="padding:6px 4px;text-align:center;white-space:nowrap;">
                    <button onclick="window.qbDuplicateItem(${i})" style="background:#1565C0;color:#fff;border:none;padding:4px 8px;border-radius:4px;cursor:pointer;font-size:11px;margin-right:2px;" title="Duplicate"><i class="fas fa-copy"></i></button>
                    <button onclick="window.qbRemoveItem(${i})" style="background:#C62828;color:#fff;border:none;padding:4px 8px;border-radius:4px;cursor:pointer;font-size:11px;" title="Remove"><i class="fas fa-trash"></i></button>
                </td>
            </tr>`;
        }).join('');
    }

    window.qbUpdateItem = function(idx, field, value) {
        if (field === 'qty') qbLineItems[idx].qty = parseFloat(value) || 1;
        else if (field === 'unitPrice') qbLineItems[idx].unitPrice = parseFloat(value) || 0;
        else qbLineItems[idx][field] = value;
        renderLineItems();
        recalcTotals();
    };

    window.qbRemoveItem = function(idx) { removeLineItem(idx); };
    window.qbDuplicateItem = function(idx) { duplicateLineItem(idx); };

    function getSurcharges() {
        let surcharges = 0;
        if (document.getElementById('qbCalloutCharge')?.checked) {
            surcharges += parseFloat(document.getElementById('qbCalloutAmount')?.value) || 0;
        }
        if (document.getElementById('qbDistanceSurcharge')?.checked) {
            surcharges += parseFloat(document.getElementById('qbDistanceAmount')?.value) || 0;
        }
        return surcharges;
    }

    function getUrgentMultiplier() {
        if (!document.getElementById('qbUrgentSurcharge')?.checked) return 0;
        return (parseFloat(document.getElementById('qbUrgentPct')?.value) || 0) / 100;
    }

    function recalcTotals() {
        const itemsSubtotal = qbLineItems.reduce((s, it) => s + (parseFloat(it.qty) || 1) * (parseFloat(it.unitPrice) || 0), 0);
        const flatSurcharges = getSurcharges();
        const urgentPct = getUrgentMultiplier();
        const urgentAmt = itemsSubtotal * urgentPct;
        const totalSurcharges = flatSurcharges + urgentAmt;
        const subtotalWithSurcharges = itemsSubtotal + totalSurcharges;

        const discPct = parseFloat(document.getElementById('qbDiscountPct')?.value) || 0;
        const discAmt = subtotalWithSurcharges * (discPct / 100);
        const afterDiscount = subtotalWithSurcharges - discAmt;
        const addVat = document.getElementById('qbAddVat')?.checked;
        const vatAmt = addVat ? afterDiscount * 0.20 : 0;
        const grandTotal = afterDiscount + vatAmt;
        const deposit = grandTotal * 0.10;

        setEl('qbSubtotal', '£' + itemsSubtotal.toFixed(2));
        setEl('qbSurchargesAmt', totalSurcharges > 0 ? '+£' + totalSurcharges.toFixed(2) : '£0.00');
        setEl('qbDiscountAmt', '-£' + discAmt.toFixed(2));
        setEl('qbVatAmt', '£' + vatAmt.toFixed(2));
        setEl('qbGrandTotal', '£' + grandTotal.toFixed(2));
        setEl('qbDepositAmt', '£' + deposit.toFixed(2));
    }

    async function submitQuote(sendNow) {
        const name = document.getElementById('qbCustName').value.trim();
        const email = document.getElementById('qbCustEmail').value.trim();
        if (!name || !email) { alert('Customer name and email are required.'); return; }
        if (qbLineItems.length === 0) { alert('Add at least one line item.'); return; }
        if (sendNow && !confirm('Send this quote to ' + name + ' (' + email + ')?')) return;

        const itemsSubtotal = qbLineItems.reduce((s, it) => s + (parseFloat(it.qty) || 1) * (parseFloat(it.unitPrice) || 0), 0);
        const flatSurcharges = getSurcharges();
        const urgentPct = getUrgentMultiplier();
        const urgentAmt = itemsSubtotal * urgentPct;
        const totalSurcharges = flatSurcharges + urgentAmt;
        const subtotal = itemsSubtotal + totalSurcharges;

        const discPct = parseFloat(document.getElementById('qbDiscountPct')?.value) || 0;
        const discAmt = subtotal * (discPct / 100);
        const afterDisc = subtotal - discAmt;
        const addVat = document.getElementById('qbAddVat')?.checked;
        const vatAmt = addVat ? afterDisc * 0.20 : 0;
        const grandTotal = afterDisc + vatAmt;

        // Build full line items array including surcharges as items
        const fullLineItems = [...qbLineItems];
        if (flatSurcharges > 0) {
            const parts = [];
            if (document.getElementById('qbCalloutCharge')?.checked) parts.push('Call-out: £' + (parseFloat(document.getElementById('qbCalloutAmount')?.value) || 0));
            if (document.getElementById('qbDistanceSurcharge')?.checked) parts.push('Distance: £' + (parseFloat(document.getElementById('qbDistanceAmount')?.value) || 0));
            fullLineItems.push({ category: 'surcharge', description: 'Surcharges (' + parts.join(', ') + ')', qty: 1, unit: 'job', unitPrice: flatSurcharges });
        }
        if (urgentAmt > 0) {
            fullLineItems.push({ category: 'surcharge', description: 'Urgent / Out-of-hours surcharge (' + (urgentPct * 100) + '%)', qty: 1, unit: 'job', unitPrice: Math.round(urgentAmt * 100) / 100 });
        }

        const payload = {
            action: editingQuoteId ? 'update_quote' : 'create_quote',
            quoteId: editingQuoteId || undefined,
            name, email,
            phone: document.getElementById('qbCustPhone').value.trim(),
            address: document.getElementById('qbCustAddress').value.trim(),
            postcode: document.getElementById('qbCustPostcode').value.trim(),
            title: document.getElementById('qbTitle').value.trim() || 'Bespoke Quote',
            lineItems: fullLineItems,
            subtotal, discountPct: discPct, discountAmt: discAmt,
            vatAmt, grandTotal,
            depositRequired: document.getElementById('qbRequireDeposit').checked,
            notes: document.getElementById('qbNotes').value.trim(),
            validDays: parseInt(document.getElementById('qbValidDays')?.value) || 30,
            estDays: parseInt(document.getElementById('qbEstDays')?.value) || 0,
            estHours: parseInt(document.getElementById('qbEstHours')?.value) || 0,
            complexity: document.getElementById('qbComplexity')?.value || 'standard',
            sendNow
        };

        const sendBtn = document.getElementById('qbSendQuote');
        const draftBtn = document.getElementById('qbSaveDraft');
        sendBtn.disabled = draftBtn.disabled = true;
        sendBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending...';

        try {
            const resp = await fetch(SHEETS_WEBHOOK, {
                method: 'POST', headers: { 'Content-Type': 'text/plain' },
                body: JSON.stringify(payload)
            });
            const result = await resp.json();
            if (result.status === 'success') {
                document.getElementById('qbModal').style.display = 'none';
                await loadQuotes();
                alert(sendNow ? '✅ Quote ' + (result.quoteId || '') + ' sent to ' + email : '💾 Quote saved as draft');
            } else {
                alert('Error: ' + (result.message || 'Unknown error'));
            }
        } catch (e) {
            alert('Failed to save quote: ' + e.message);
        }

        sendBtn.disabled = draftBtn.disabled = false;
        sendBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Send Quote to Customer';
    }

    window.qbViewQuote = function(quoteId) {
        const q = allQuotes.find(x => x.quoteId === quoteId);
        if (q) openQuoteModal(q);
    };

    window.qbResend = async function(quoteId) {
        if (!confirm('Resend this quote?')) return;
        try {
            const resp = await fetch(SHEETS_WEBHOOK, {
                method: 'POST', headers: { 'Content-Type': 'text/plain' },
                body: JSON.stringify({ action: 'resend_quote', quoteId })
            });
            const result = await resp.json();
            if (result.status === 'success') { alert('✅ Quote resent!'); loadQuotes(); }
            else alert('Error: ' + (result.message || 'Unknown'));
        } catch (e) { alert('Failed: ' + e.message); }
    };

    // Hash support
    if (window.location.hash === '#quote-builder') {
        document.querySelector('[data-admin-tab="panelQuoteBuilder"]')?.click();
    }

});
