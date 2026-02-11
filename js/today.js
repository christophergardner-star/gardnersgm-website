/* ============================================
   Gardners GM — Daily Dispatch + Fund Allocator
   Morning briefing: today's jobs, route, costs,
   revenue allocation, job completion flow.
   ============================================ */

document.addEventListener('DOMContentLoaded', () => {

    const SHEETS_WEBHOOK = 'https://script.google.com/macros/s/AKfycbxMOG1s0F2rUG3EBdaJ1R1x1ofkHjyYqxoBaKTZKVnpvr2g_o2NYSySXU6d8EKkdb0ayg/exec';
    const TG_BOT_TOKEN   = '8261874993:AAHW6752Ofhsrw6qzOSSZWnfmzbBj7G8Z-g';
    const TG_CHAT_ID     = '6200151295';

    let allClients = [];
    let businessCosts = {};
    let currentDate = new Date();
    currentDate.setHours(0,0,0,0);


    // ── Service duration (hours) & material costs ──
    const SERVICE_INFO = {
        'lawn-cutting':     { hours: 1,   material: 1.50,  label: 'Lawn Cutting' },
        'hedge-trimming':   { hours: 3,   material: 2.00,  label: 'Hedge Trimming' },
        'lawn-treatment':   { hours: 2,   material: 12.00, label: 'Lawn Treatment' },
        'scarifying':       { hours: 8,   material: 15.00, label: 'Scarifying' },
        'garden-clearance': { hours: 8,   material: 25.00, label: 'Garden Clearance' },
        'power-washing':    { hours: 8,   material: 5.00,  label: 'Power Washing' },
        'free-quote-visit': { hours: 1,   material: 0,     label: 'Free Quote Visit' }
    };

    // ── Fund allocation percentages ──
    const FUND_ALLOCATION = [
        { id: 'tax',        label: 'Income Tax Reserve',    pct: 0.20, icon: 'fa-landmark',     color: '#283593' },
        { id: 'ni',         label: 'National Insurance',    pct: 0.06, icon: 'fa-id-card',      color: '#4527A0' },
        { id: 'fuel',       label: 'Fuel Fund',             pct: 0,    icon: 'fa-gas-pump',     color: '#E65100', dynamic: true },
        { id: 'materials',  label: 'Materials Fund',        pct: 0,    icon: 'fa-leaf',         color: '#1B5E20', dynamic: true },
        { id: 'overheads',  label: 'Overheads Reserve',     pct: 0.10, icon: 'fa-building',     color: '#00838F' },
        { id: 'emergency',  label: 'Emergency Fund',        pct: 0.05, icon: 'fa-shield-alt',   color: '#BF360C' },
        { id: 'takehome',   label: 'Take-Home Pay',         pct: 0,    icon: 'fa-wallet',       color: '#2E7D32', remainder: true }
    ];


    // ============================================
    // DATA LOADING
    // ============================================
    async function loadData() {
        try {
            const [clientsResp, costsResp] = await Promise.all([
                fetch(SHEETS_WEBHOOK + '?action=get_clients').then(r => r.json()),
                fetch(SHEETS_WEBHOOK + '?action=get_business_costs').then(r => r.json())
            ]);

            if (clientsResp.status === 'success') allClients = clientsResp.clients || [];
            if (costsResp.status === 'success' && costsResp.costs) {
                const now = new Date();
                const mk = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
                businessCosts = costsResp.costs.find(c => c.month === mk) || {};
            }

            renderDay();
        } catch (e) {
            console.error('Load failed:', e);
        }
    }


    // ============================================
    // DATE NAVIGATION
    // ============================================
    document.getElementById('ddPrev').addEventListener('click', () => { currentDate.setDate(currentDate.getDate() - 1); renderDay(); });
    document.getElementById('ddNext').addEventListener('click', () => { currentDate.setDate(currentDate.getDate() + 1); renderDay(); });
    document.getElementById('ddToday').addEventListener('click', () => { currentDate = new Date(); currentDate.setHours(0,0,0,0); renderDay(); });


    // ============================================
    // RENDER THE DAY
    // ============================================
    function renderDay() {
        // Date header
        const opts = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
        document.getElementById('ddDate').textContent = currentDate.toLocaleDateString('en-GB', opts);

        // Filter jobs for this date
        const dateStr = formatISO(currentDate);
        const dayJobs = allClients.filter(c => {
            const d = c.date || c.timestamp;
            if (!d) return false;
            const jd = new Date(d);
            const jdStr = formatISO(jd);
            const status = (c.status || '').toLowerCase();
            return jdStr === dateStr && status !== 'cancelled' && status !== 'canceled';
        });

        // Sort by time slot
        dayJobs.sort((a, b) => (a.time || '99:99').localeCompare(b.time || '99:99'));

        const container = document.getElementById('ddJobs');
        const emptyEl   = document.getElementById('ddEmpty');
        const summaryEl = document.getElementById('ddSummary');
        const fundsBar  = document.getElementById('ddFundsBar');
        const briefBtn  = document.getElementById('ddSendBriefing');

        if (dayJobs.length === 0) {
            container.innerHTML = '';
            emptyEl.style.display = 'block';
            summaryEl.style.display = 'none';
            fundsBar.style.display = 'none';
            briefBtn.style.display = 'none';
            return;
        }

        emptyEl.style.display = 'none';
        summaryEl.style.display = 'flex';
        fundsBar.style.display = 'block';
        briefBtn.style.display = 'inline-flex';

        // Calculate totals
        const fuelRate = businessCosts.fuelRate || 0.45;
        let totalMiles = 0, totalHours = 0, totalRevenue = 0, totalFuel = 0, totalMaterials = 0;

        dayJobs.forEach(j => {
            const svc = normaliseService(j.service || j.type);
            const info = SERVICE_INFO[svc] || { hours: 1, material: 0 };
            const dist = parseFloat(j.distance) || 5;
            const price = parsePrice(j.price);

            totalMiles += dist * 2;
            totalHours += info.hours;
            totalRevenue += price;
            totalFuel += dist * 2 * fuelRate;
            totalMaterials += info.material;
        });

        const totalCosts = totalFuel + totalMaterials;
        const net = totalRevenue - totalCosts;

        // Summary bar
        setEl('ddJobCount', dayJobs.length);
        setEl('ddTotalTime', totalHours + 'h');
        setEl('ddTotalMiles', Math.round(totalMiles));
        setEl('ddTotalRev', '£' + totalRevenue.toFixed(0));
        setEl('ddFuelCost', '£' + totalFuel.toFixed(0));
        const netEl = document.getElementById('ddNetProfit');
        netEl.textContent = '£' + net.toFixed(0);
        netEl.style.color = net >= 0 ? '#16a34a' : '#ef4444';

        // Fund allocation
        renderFundAllocation(totalRevenue, totalFuel, totalMaterials);

        // Job cards
        container.innerHTML = dayJobs.map((j, idx) => {
            const svc = normaliseService(j.service || j.type);
            const info = SERVICE_INFO[svc] || { hours: 1, material: 0, label: j.service };
            const dist = parseFloat(j.distance) || 0;
            const price = parsePrice(j.price);
            const isCompleted = (j.status || '').toLowerCase() === 'completed';
            const isPaid = j.paid === 'Yes' || j.paid === 'Auto';
            const mapsUrl = j.googleMapsUrl || '';
            const timeSlot = j.time || 'TBC';
            const endTime = calcEndTime(timeSlot, info.hours);

            return `
            <div class="dd-job-card ${isCompleted ? 'dd-job-done' : ''}" data-idx="${idx}">
                <div class="dd-job-number">${idx + 1}</div>
                <div class="dd-job-main">
                    <div class="dd-job-header">
                        <div>
                            <h3 class="dd-job-name">${esc(j.name || 'Unknown')}</h3>
                            <span class="dd-job-ref">${esc(j.jobNumber || '')}</span>
                        </div>
                        <div class="dd-job-price">${price > 0 ? '£' + price.toFixed(0) : '<span style="color:#E65100;">No price set</span>'}</div>
                    </div>
                    <div class="dd-job-details">
                        <div class="dd-job-detail"><i class="fas fa-cut" style="color:#2E7D32;"></i> ${esc(info.label)}</div>
                        <div class="dd-job-detail"><i class="fas fa-clock" style="color:#1565C0;"></i> ${esc(timeSlot)}${endTime ? ' → ' + endTime : ''}</div>
                        <div class="dd-job-detail"><i class="fas fa-hourglass-half" style="color:#6A1B9A;"></i> ~${info.hours}h</div>
                        ${dist > 0 ? `<div class="dd-job-detail"><i class="fas fa-route" style="color:#E65100;"></i> ${dist.toFixed(1)} miles</div>` : ''}
                    </div>
                    <div class="dd-job-address">
                        <i class="fas fa-map-marker-alt" style="color:#d32f2f;"></i>
                        ${esc(j.address || '')}${j.postcode ? ', ' + esc(j.postcode) : ''}
                    </div>
                    ${j.notes ? `<div class="dd-job-notes"><i class="fas fa-sticky-note"></i> ${esc(j.notes)}</div>` : ''}
                    ${j.phone ? `<div class="dd-job-phone"><a href="tel:${j.phone}"><i class="fas fa-phone"></i> ${esc(j.phone)}</a></div>` : ''}
                    <div class="dd-job-actions">
                        ${mapsUrl ? `<a href="${esc(mapsUrl)}" target="_blank" class="btn btn-primary btn-sm"><i class="fas fa-map-marked-alt"></i> Navigate</a>` : ''}
                        ${!isCompleted ? `<button class="btn btn-outline-green btn-sm dd-complete-btn" data-row="${j.rowIndex}" data-name="${esc(j.name)}" data-service="${esc(j.service)}" data-email="${esc(j.email || '')}" data-price="${price}"><i class="fas fa-check-circle"></i> Complete Job</button>` : `<span class="dd-badge-done"><i class="fas fa-check-circle"></i> Completed</span>`}
                        ${!isPaid && price > 0 ? `<span class="dd-badge-unpaid"><i class="fas fa-exclamation-triangle"></i> Unpaid</span>` : ''}
                        ${isPaid ? `<span class="dd-badge-paid"><i class="fas fa-pound-sign"></i> Paid</span>` : ''}
                    </div>
                </div>
            </div>`;
        }).join('');

        // Attach complete handlers
        container.querySelectorAll('.dd-complete-btn').forEach(btn => {
            btn.addEventListener('click', () => completeJob(btn));
        });
    }


    // ============================================
    // FUND ALLOCATION
    // ============================================
    function renderFundAllocation(revenue, fuel, materials) {
        const grid = document.getElementById('ddFundsGrid');
        if (revenue <= 0) { grid.innerHTML = '<p style="color:#999;">No revenue to allocate</p>'; return; }

        let allocated = 0;
        const items = FUND_ALLOCATION.map(f => {
            let amount;
            if (f.dynamic && f.id === 'fuel')      { amount = fuel; }
            else if (f.dynamic && f.id === 'materials') { amount = materials; }
            else if (f.remainder) { amount = 0; } // calculated last
            else { amount = revenue * f.pct; }
            allocated += amount;
            return { ...f, amount };
        });

        // Remainder goes to take-home
        const takeHome = items.find(i => i.remainder);
        if (takeHome) {
            takeHome.amount = Math.max(0, revenue - allocated);
        }

        grid.innerHTML = items.map(f => {
            const pct = revenue > 0 ? (f.amount / revenue * 100) : 0;
            return `
            <div class="dd-fund-item">
                <div class="dd-fund-icon" style="color:${f.color};"><i class="fas ${f.icon}"></i></div>
                <div class="dd-fund-info">
                    <div class="dd-fund-label">${f.label}</div>
                    <div class="dd-fund-amount">£${f.amount.toFixed(2)}</div>
                </div>
                <div class="dd-fund-pct" style="color:${f.color};">${pct.toFixed(0)}%</div>
                <div class="dd-fund-bar-track">
                    <div class="dd-fund-bar-fill" style="width:${Math.min(100, pct)}%;background:${f.color};"></div>
                </div>
            </div>`;
        }).join('');
    }


    // ============================================
    // JOB COMPLETION FLOW
    // ============================================
    async function completeJob(btn) {
        const row     = btn.dataset.row;
        const name    = btn.dataset.name;
        const service = btn.dataset.service;
        const email   = btn.dataset.email;
        const price   = parseFloat(btn.dataset.price) || 0;

        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Completing...';

        try {
            // 1) Mark as Completed in Google Sheets
            await fetch(SHEETS_WEBHOOK, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain' },
                body: JSON.stringify({ action: 'update_status', rowIndex: parseInt(row), status: 'Completed' })
            });

            // 2) Send Telegram notification
            await sendTelegram(`✅ Job completed: ${name} — ${service}${price > 0 ? ' (£' + price.toFixed(0) + ')' : ''}`);

            // 3) Send thank-you email with review request (if email exists)
            if (email) {
                await fetch(SHEETS_WEBHOOK, {
                    method: 'POST',
                    headers: { 'Content-Type': 'text/plain' },
                    body: JSON.stringify({
                        action: 'send_completion_email',
                        email: email,
                        name: name,
                        service: service
                    })
                });
            }

            // 4) Update local state
            const client = allClients.find(c => c.rowIndex == row);
            if (client) client.status = 'Completed';

            // 5) Re-render
            renderDay();

        } catch (e) {
            console.error('Complete job failed:', e);
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-check-circle"></i> Complete Job';
        }
    }


    // ============================================
    // TELEGRAM MORNING BRIEFING
    // ============================================
    document.getElementById('ddSendBriefing').addEventListener('click', async function() {
        const btn = this;
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending...';

        const dateStr = formatISO(currentDate);
        const dayJobs = allClients.filter(c => {
            const d = c.date || c.timestamp;
            if (!d) return false;
            const jd = new Date(d);
            const status = (c.status || '').toLowerCase();
            return formatISO(jd) === dateStr && status !== 'cancelled' && status !== 'canceled';
        }).sort((a, b) => (a.time || '').localeCompare(b.time || ''));

        if (dayJobs.length === 0) {
            btn.innerHTML = '<i class="fas fa-check"></i> No jobs to send';
            setTimeout(() => { btn.disabled = false; btn.innerHTML = '<i class="fas fa-paper-plane"></i> Send Morning Briefing to Telegram'; }, 2000);
            return;
        }

        const dateLabel = currentDate.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
        let msg = `📋 <b>Daily Dispatch — ${dateLabel}</b>\n`;
        msg += `━━━━━━━━━━━━━━━━━━━━━\n`;
        msg += `🗂 ${dayJobs.length} job${dayJobs.length > 1 ? 's' : ''} today\n\n`;

        dayJobs.forEach((j, i) => {
            const svc = normaliseService(j.service || j.type);
            const info = SERVICE_INFO[svc] || { hours: 1, label: j.service };
            const price = parsePrice(j.price);
            msg += `<b>${i + 1}. ${j.name}</b>\n`;
            msg += `   ✂️ ${info.label}\n`;
            msg += `   🕐 ${j.time || 'TBC'} (~${info.hours}h)\n`;
            msg += `   📍 ${j.address || ''}${j.postcode ? ', ' + j.postcode : ''}\n`;
            const mapsAddr = (j.address || '') + (j.postcode ? ', ' + j.postcode : '');
            if (mapsAddr) msg += `   🗺 <a href="https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(mapsAddr)}">Get Directions</a>\n`;
            if (price > 0) msg += `   💷 £${price.toFixed(0)}\n`;
            if (j.notes) msg += `   📝 ${j.notes}\n`;
            msg += '\n';
        });

        const totalRev = dayJobs.reduce((s, c) => s + parsePrice(c.price), 0);
        msg += `━━━━━━━━━━━━━━━━━━━━━\n`;
        msg += `💰 Day total: <b>£${totalRev.toFixed(0)}</b>\n`;
        msg += `\n☀️ Have a great day!`;

        const ok = await sendTelegram(msg);
        btn.innerHTML = ok ? '<i class="fas fa-check"></i> Sent!' : '<i class="fas fa-times"></i> Failed';
        setTimeout(() => { btn.disabled = false; btn.innerHTML = '<i class="fas fa-paper-plane"></i> Send Morning Briefing to Telegram'; }, 3000);
    });


    // ============================================
    // HELPERS
    // ============================================
    async function sendTelegram(text) {
        try {
            await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: TG_CHAT_ID, text, parse_mode: 'HTML' })
            });
            return true;
        } catch (e) { console.error('Telegram failed:', e); return false; }
    }

    function normaliseService(s) {
        return (s || '').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    }

    function parsePrice(val) {
        if (!val) return 0;
        const n = parseFloat(String(val).replace(/[^0-9.\-]/g, ''));
        return isNaN(n) ? 0 : n;
    }

    function formatISO(d) {
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }

    function calcEndTime(slot, hours) {
        const match = slot.match(/^(\d{2}):(\d{2})/);
        if (!match) return '';
        let h = parseInt(match[1]) + hours;
        const m = match[2];
        if (h > 17) h = 17;
        return String(h).padStart(2, '0') + ':' + m;
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
    // INIT
    // ============================================
    loadData();

});
