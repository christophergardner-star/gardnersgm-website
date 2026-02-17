/* ══════════════════════════════════════════════════════
   Gardners Ground Maintenance — Manager Dashboard JS
   6-tab command centre with full CRM, finance, marketing,
   customer care and admin panels
   ══════════════════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', () => {

    const API = 'https://script.google.com/macros/s/AKfycbxaT1YOoDZtVHP9CztiUutYFqMiOyygDJon5BxCij14CWl91WgdmrYqpbG4KVAlFh5IiQ/exec';

    let allClients = [];
    let filteredClients = [];

    // Cache loaded data so tabs don't re-fetch constantly
    const cache = {};
    function cached(key, ttlMs, fetcher) {
        if (cache[key] && Date.now() - cache[key].ts < ttlMs) return Promise.resolve(cache[key].data);
        return fetcher().then(d => { cache[key] = { data: d, ts: Date.now() }; return d; });
    }

    // --- DOM helpers ---
    const $ = id => document.getElementById(id);
    const loading = $('mgrLoading');
    const clientList = $('mgrClientList');
    const emptyState = $('mgrEmpty');
    const searchInput = $('mgrSearch');
    const filterType = $('mgrFilterType');
    const filterStatus = $('mgrFilterStatus');
    const filterPaid = $('mgrFilterPaid');
    const modal = $('mgrModal');

    // ============================================
    // LIVE CLOCK
    // ============================================
    function tickClock() {
        const el = $('mgrClock');
        if (el) el.textContent = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    }
    tickClock();
    setInterval(tickClock, 30000);

    // ============================================
    // TAB & SUB-TAB NAVIGATION
    // ============================================
    const tabBtns = document.querySelectorAll('.mgr-tab');
    const panels = document.querySelectorAll('.mgr-panel');

    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const tab = btn.dataset.tab;
            tabBtns.forEach(b => b.classList.remove('active'));
            panels.forEach(p => p.classList.remove('active'));
            btn.classList.add('active');
            const panel = $('panel-' + tab);
            if (panel) panel.classList.add('active');
            onTabActivated(tab);
        });
    });

    document.querySelectorAll('.mgr-subtab').forEach(btn => {
        btn.addEventListener('click', () => {
            const subId = btn.dataset.subtab;
            const parent = btn.closest('.mgr-panel');
            parent.querySelectorAll('.mgr-subtab').forEach(b => b.classList.remove('active'));
            parent.querySelectorAll('.mgr-subpanel').forEach(p => p.classList.remove('active'));
            btn.classList.add('active');
            const sub = $('sub-' + subId);
            if (sub) sub.classList.add('active');
            onSubTabActivated(subId);
        });
    });

    // Track which sections have been loaded
    const loaded = {};

    function onTabActivated(tab) {
        if (tab === 'overview' && !loaded.overview) loadOverview();
        if (tab === 'operations' && !loaded.clients) loadClients();
        if (tab === 'finance' && !loaded.finance) loadFinanceDashboard();
        if (tab === 'marketing' && !loaded.social) { loaded.social = true; }
        if (tab === 'customers' && !loaded.enquiries) loadEnquiries();
        if (tab === 'admin' && !loaded.careers) loadCareers();
    }

    function onSubTabActivated(sub) {
        if (sub === 'ops-clients' && !loaded.clients) loadClients();
        if (sub === 'ops-today' && !loaded.today) loadTodaySchedule();
        if (sub === 'ops-subs' && !loaded.subs) loadSubscriptions();
        if (sub === 'ops-quotes' && !loaded.quotes) loadQuotes();
        if (sub === 'fin-dash' && !loaded.finance) loadFinanceDashboard();
        if (sub === 'fin-invoices' && !loaded.invoices) loadInvoices();
        if (sub === 'fin-costs' && !loaded.costs) loadBusinessCosts();
        if (sub === 'fin-pots' && !loaded.pots) loadSavingsPots();
        if (sub === 'mkt-blog' && !loaded.blog) loadBlogPosts();
        if (sub === 'mkt-newsletter' && !loaded.newsletter) loadNewsletter();
        if (sub === 'mkt-testimonials' && !loaded.testimonials) loadTestimonials();
        if (sub === 'cc-enquiries' && !loaded.enquiries) loadEnquiries();
        if (sub === 'cc-complaints' && !loaded.complaints) loadComplaints();
        if (sub === 'cc-emails' && !loaded.emails) loadEmailTracking();
        if (sub === 'adm-careers' && !loaded.careers) loadCareers();
        if (sub === 'adm-shop' && !loaded.shop) loadShop();
        if (sub === 'adm-settings' && !loaded.pricing) loadPricing();
    }


    // ============================================
    // GENERIC API FETCH
    // ============================================
    async function apiFetch(action) {
        const resp = await fetch(API + '?action=' + action);
        return resp.json();
    }

    function fmtGBP(v) {
        const n = parseFloat(v);
        return isNaN(n) ? '£0.00' : '£' + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }


    // ╔════════════════════════════════════════════╗
    // ║  TAB 1 — OVERVIEW                         ║
    // ╚════════════════════════════════════════════╝

    async function loadOverview() {
        loaded.overview = true;
        // Load clients first (reuse for stats)
        if (!allClients.length) {
            try {
                const data = await apiFetch('get_clients');
                if (data.status === 'success') allClients = data.clients || [];
            } catch(e) {}
        }

        // KPIs
        const now = new Date();
        const todayStr = now.toISOString().slice(0, 10);
        const weekAgo = new Date(now - 7 * 864e5);
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const yearStart = new Date(now.getFullYear(), 0, 1);

        const withTimestamp = allClients.filter(c => c.timestamp);
        const todayCount = withTimestamp.filter(c => c.timestamp.slice(0, 10) === todayStr).length;
        const weekCount = withTimestamp.filter(c => new Date(c.timestamp) >= weekAgo).length;
        const monthCount = withTimestamp.filter(c => new Date(c.timestamp) >= monthStart).length;
        const yearCount = withTimestamp.filter(c => new Date(c.timestamp) >= yearStart).length;
        const subsCount = allClients.filter(c => (c.type || '').includes('subscription') && (c.status || '').toLowerCase() !== 'cancelled').length;
        const unpaidCount = allClients.filter(c => c.paid === 'No' && (c.status || '').toLowerCase() !== 'cancelled').length;

        $('kpiToday').textContent = todayCount;
        $('kpiWeek').textContent = weekCount;
        $('kpiMonth').textContent = monthCount;
        $('kpiYTD').textContent = yearCount;
        $('kpiSubs').textContent = subsCount;
        $('kpiOutstanding').textContent = unpaidCount;

        // Today's jobs
        const todayJobs = allClients.filter(c => {
            if (!c.date) return false;
            try { return new Date(c.date).toISOString().slice(0, 10) === todayStr; } catch(e) { return false; }
        });
        if (todayJobs.length) {
            $('overviewTodayJobs').innerHTML = todayJobs.map(j => `
                <div class="mgr-sched-item">
                    <div>
                        <span class="mgr-sched-name">${esc(j.name)}</span>
                        <span class="mgr-sched-detail">${esc(j.service || '')} — ${esc(j.time || 'TBD')}</span>
                    </div>
                    <span class="mgr-badge ${getStatusClass(j.status)}">${esc(j.status || '')}</span>
                </div>
            `).join('');
        } else {
            $('overviewTodayJobs').innerHTML = '<p class="mgr-muted">No jobs scheduled for today</p>';
        }

        // Alerts
        const alerts = [];
        if (unpaidCount > 0) alerts.push({ color: 'red', text: `${unpaidCount} unpaid booking${unpaidCount > 1 ? 's' : ''} need attention` });
        const pendingQuotes = allClients.filter(c => (c.status || '').toLowerCase() === 'sent' && (c.type || '').includes('invoice')).length;
        if (pendingQuotes > 0) alerts.push({ color: 'amber', text: `${pendingQuotes} outstanding invoice${pendingQuotes > 1 ? 's' : ''}` });
        if (todayJobs.length > 0) alerts.push({ color: 'green', text: `${todayJobs.length} job${todayJobs.length > 1 ? 's' : ''} on today's schedule` });
        if (subsCount > 0) alerts.push({ color: 'blue', text: `${subsCount} active subscription${subsCount > 1 ? 's' : ''} running` });

        $('overviewAlerts').innerHTML = alerts.length
            ? alerts.map(a => `<div class="mgr-alert-item"><span class="mgr-alert-dot ${a.color}"></span>${a.text}</div>`).join('')
            : '<p class="mgr-muted">All clear — no alerts</p>';

        // Recent activity (last 10 records)
        const recent = [...allClients].sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0)).slice(0, 10);
        $('overviewRecent').innerHTML = recent.length
            ? recent.map(r => {
                const d = r.timestamp ? new Date(r.timestamp) : null;
                const ts = d ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '';
                return `<div class="mgr-activity-item"><span class="mgr-activity-time">${ts}</span><span>${esc(r.name || 'Unknown')} — ${esc(r.type || '')} (${esc(r.service || '')})</span></div>`;
            }).join('')
            : '<p class="mgr-muted">No recent activity</p>';
    }


    // ╔════════════════════════════════════════════╗
    // ║  TAB 2 — OPERATIONS: CLIENTS              ║
    // ╚════════════════════════════════════════════╝

    async function loadClients() {
        loaded.clients = true;
        if (loading) loading.style.display = 'flex';
        if (clientList) clientList.style.display = 'none';
        if (emptyState) emptyState.style.display = 'none';

        try {
            const data = await apiFetch('get_clients');
            if (data.status === 'success' && data.clients) {
                allClients = data.clients;
                applyFilters();
                updateStats();
            } else {
                showError('Failed to load clients: ' + (data.message || 'Unknown error'));
            }
        } catch (e) {
            showError('Could not connect to Google Sheets.');
            console.error(e);
        }
        if (loading) loading.style.display = 'none';
    }

    function showError(msg) {
        if (loading) loading.style.display = 'none';
        if (emptyState) {
            emptyState.innerHTML = `<i class="fas fa-exclamation-triangle"></i><p>${msg}</p>`;
            emptyState.style.display = 'flex';
        }
    }

    function updateStats() {
        const el = id => $(id);
        el('statTotal').textContent = allClients.length;
        el('statBookings').textContent = allClients.filter(c => c.type === 'booking' || c.type === 'booking-payment').length;
        el('statSubs').textContent = allClients.filter(c => c.type === 'subscription' || c.type === 'stripe-subscription').length;
        el('statPaid').textContent = allClients.filter(c => c.paid === 'Yes' || c.paid === 'Auto' || c.paymentType === 'Stripe One-Off' || c.paymentType === 'Stripe Recurring').length;
        el('statUnpaid').textContent = allClients.filter(c => c.paid === 'No' && c.status !== 'Cancelled' && c.status !== 'cancelled').length;
    }


    // --- Search & Filter ---
    function applyFilters() {
        const q = (searchInput?.value || '').toLowerCase().trim();
        const typeF = filterType?.value || '';
        const statusF = filterStatus?.value || '';
        const paidF = filterPaid?.value || '';

        filteredClients = allClients.filter(c => {
            if (q) {
                const searchable = [c.name, c.email, c.postcode, c.service, c.address, c.phone, c.notes].join(' ').toLowerCase();
                if (!searchable.includes(q)) return false;
            }
            if (typeF && c.type !== typeF) return false;
            if (statusF && c.status !== statusF) return false;
            if (paidF) {
                if (paidF === 'Yes' && c.paid !== 'Yes' && c.paymentType !== 'Stripe One-Off') return false;
                if (paidF === 'No' && c.paid !== 'No') return false;
                if (paidF === 'Auto' && c.paid !== 'Auto' && c.paymentType !== 'Stripe Recurring') return false;
            }
            return true;
        });
        filteredClients.sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));
        renderClientList();
    }

    if (searchInput) searchInput.addEventListener('input', applyFilters);
    if (filterType) filterType.addEventListener('change', applyFilters);
    if (filterStatus) filterStatus.addEventListener('change', applyFilters);
    if (filterPaid) filterPaid.addEventListener('change', applyFilters);


    // --- Render Client Cards ---
    function renderClientList() {
        if (!clientList) return;
        if (filteredClients.length === 0) {
            clientList.style.display = 'none';
            if (emptyState) { emptyState.innerHTML = '<i class="fas fa-inbox"></i><p>No records match your search</p>'; emptyState.style.display = 'flex'; }
            return;
        }
        if (emptyState) emptyState.style.display = 'none';
        clientList.style.display = 'grid';

        clientList.innerHTML = filteredClients.map(c => {
            const statusClass = getStatusClass(c.status);
            const typeIcon = getTypeIcon(c.type);
            const paidBadge = getPaidBadge(c);
            const dateDisplay = c.date ? formatDate(c.date) : '';
            const timeDisplay = c.time || '';

            return `
                <div class="mgr-card" onclick="window.mgrOpenDetail(${c.rowIndex})">
                    <div class="mgr-card-top">
                        <div class="mgr-card-name">
                            <strong>${esc(c.name || 'Unknown')}</strong>
                            <span class="mgr-card-type">${typeIcon} ${esc(c.type || '')}</span>
                        </div>
                        <div class="mgr-card-badges">
                            <span class="mgr-badge ${statusClass}">${esc(c.status || 'Unknown')}</span>
                            ${paidBadge}
                        </div>
                    </div>
                    <div class="mgr-card-body">
                        <div class="mgr-card-info">
                            ${c.service ? `<span><i class="fas fa-leaf"></i> ${esc(c.service)}</span>` : ''}
                            ${c.price ? `<span><i class="fas fa-pound-sign"></i> ${esc(String(c.price))}</span>` : ''}
                            ${dateDisplay ? `<span><i class="fas fa-calendar"></i> ${dateDisplay}</span>` : ''}
                            ${timeDisplay ? `<span><i class="fas fa-clock"></i> ${esc(timeDisplay)}</span>` : ''}
                        </div>
                        <div class="mgr-card-contact">
                            ${c.phone ? `<span><i class="fas fa-phone"></i> ${esc(c.phone)}</span>` : ''}
                            ${c.email ? `<span><i class="fas fa-envelope"></i> ${esc(c.email)}</span>` : ''}
                            ${c.postcode ? `<span><i class="fas fa-map-pin"></i> ${esc(c.postcode)}</span>` : ''}
                        </div>
                    </div>
                </div>`;
        }).join('');
    }

    function getStatusClass(status) {
        const s = (status || '').toLowerCase();
        if (s === 'active' || s === 'succeeded') return 'mgr-badge-green';
        if (s === 'sent' || s === 'pending') return 'mgr-badge-amber';
        if (s === 'cancelled' || s === 'canceled') return 'mgr-badge-red';
        if (s === 'completed') return 'mgr-badge-blue';
        return 'mgr-badge-gray';
    }
    function getTypeIcon(type) {
        const t = (type || '').toLowerCase();
        if (t.includes('subscription')) return '<i class="fas fa-sync-alt"></i>';
        if (t.includes('invoice')) return '<i class="fas fa-file-invoice"></i>';
        if (t.includes('payment')) return '<i class="fas fa-credit-card"></i>';
        return '<i class="fas fa-calendar-check"></i>';
    }
    function getPaidBadge(c) {
        if (c.paid === 'Yes' || c.paymentType === 'Stripe One-Off') return '<span class="mgr-badge mgr-badge-green"><i class="fas fa-check"></i> Paid</span>';
        if (c.paid === 'Auto' || c.paymentType === 'Stripe Recurring') return '<span class="mgr-badge mgr-badge-blue"><i class="fas fa-sync-alt"></i> Auto</span>';
        if (c.status === 'Sent') return '<span class="mgr-badge mgr-badge-amber"><i class="fas fa-paper-plane"></i> Invoiced</span>';
        return '<span class="mgr-badge mgr-badge-red"><i class="fas fa-times"></i> Unpaid</span>';
    }
    function formatDate(dateStr) {
        if (!dateStr) return '';
        if (dateStr.includes(',')) return dateStr.replace(/^[A-Za-z]+,\s*/, '');
        try { const d = new Date(dateStr); return isNaN(d) ? dateStr : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); } catch(e) { return dateStr; }
    }
    function esc(str) { const d = document.createElement('div'); d.textContent = str; return d.innerHTML; }


    // ╔════════════════════════════════════════════╗
    // ║  CLIENT DETAIL MODAL                      ║
    // ╚════════════════════════════════════════════╝

    window.mgrOpenDetail = function(rowIndex) {
        const client = allClients.find(c => c.rowIndex === rowIndex);
        if (!client) return;

        $('mgrRowIndex').value = rowIndex;
        $('mgrName').value = client.name || '';
        $('mgrEmail').value = client.email || '';
        $('mgrPhone').value = client.phone || '';
        $('mgrPostcode').value = client.postcode || '';
        $('mgrAddress').value = client.address || '';
        $('mgrService').value = client.service || '';
        $('mgrPrice').value = client.price || '';
        $('mgrDate').value = client.date || '';
        $('mgrTime').value = client.time || '';
        $('mgrDay').value = client.preferredDay || '';
        $('mgrType').value = client.type || '';
        $('mgrStatus').value = client.status || 'Active';
        $('mgrPaid').value = client.paid || 'No';
        $('mgrNotes').value = client.notes || '';

        $('mgrRecordTimestamp').innerHTML = `<i class="fas fa-clock"></i> Created: ${client.timestamp ? new Date(client.timestamp).toLocaleString('en-GB') : 'Unknown'}`;
        $('mgrRecordDistance').innerHTML = client.distance ? `<i class="fas fa-route"></i> Distance: ${client.distance} mi, Drive: ${client.driveTime || '?'} min` : '';
        $('mgrRecordPayment').innerHTML = client.paymentType ? `<i class="fas fa-credit-card"></i> Payment: ${client.paymentType}` : '';

        // Quick actions
        $('mgrCallBtn').onclick = () => { if (client.phone) window.open('tel:' + client.phone); };
        $('mgrEmailBtn').onclick = () => { if (client.email) window.open('mailto:' + client.email); };
        $('mgrMapBtn').onclick = () => { window.open('https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent((client.address || '') + ', ' + (client.postcode || ''))); };
        $('mgrInvoiceBtn').onclick = () => {
            const params = new URLSearchParams({
                name: client.name || '', email: client.email || '', phone: client.phone || '',
                address: client.address || '', postcode: client.postcode || '',
                service: client.service || '', job: client.jobNumber || '',
                amount: client.price ? String(parseFloat(String(client.price).replace(/[^0-9.]/g, ''))) : ''
            }).toString();
            window.open('invoice.html?' + params);
        };

        // Cancel
        $('mgrCancelBtn').onclick = async () => {
            const isSub = (client.type || '').toLowerCase().includes('subscription');
            const msg = isSub
                ? 'Cancel this subscription?\n\n• Stripe subscription cancelled\n• Future visits removed\n• Cancellation email sent'
                : 'Cancel this booking?\n\n• Refund processed if paid\n• Cancellation email sent';
            if (!confirm(msg)) return;
            try {
                const resp = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'text/plain' },
                    body: JSON.stringify({ action: isSub ? 'cancel_subscription' : 'cancel_booking', rowIndex, jobNumber: client.jobNumber || '', reason: 'Manager cancellation via CRM' })
                });
                const result = await resp.json();
                if (result.status === 'success') {
                    $('mgrStatus').value = 'Cancelled';
                    const c = allClients.find(x => x.rowIndex === rowIndex);
                    if (c) c.status = 'Cancelled';
                    applyFilters(); updateStats();
                    let summary = '✅ ' + (isSub ? 'Subscription' : 'Booking') + ' cancelled';
                    if (result.refunded) summary += '\n💰 Refund: £' + result.refundAmount;
                    if (result.removedVisits) summary += '\n📅 ' + result.removedVisits + ' visits removed';
                    if (result.stripeCancelled) summary += '\n💳 Stripe subscription cancelled';
                    alert(summary);
                } else { alert('Error: ' + (result.message || 'Unknown error')); }
            } catch(err) { alert('Cancel failed: ' + err.message); }
        };

        // Reschedule
        $('mgrRescheduleBtn').onclick = async () => {
            const newDate = prompt('New date (YYYY-MM-DD):', client.date || '');
            if (!newDate) return;
            const newTime = prompt('New time slot (e.g. 09:00 - 10:00):', client.time || '');
            if (!newTime) return;
            try {
                const resp = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'text/plain' },
                    body: JSON.stringify({ action: 'reschedule_booking', rowIndex, jobNumber: client.jobNumber || '', newDate, newTime })
                });
                const result = await resp.json();
                if (result.status === 'success') {
                    alert('✅ Rescheduled to ' + newDate + ' ' + newTime);
                    const c = allClients.find(x => x.rowIndex === rowIndex);
                    if (c) { c.date = newDate; c.time = newTime; }
                    applyFilters();
                } else if (result.alternatives?.length) {
                    let altMsg = 'Slot unavailable.\n\nSuggested:\n';
                    result.alternatives.forEach((a, i) => { altMsg += (i+1) + ') ' + a.display + '\n'; });
                    alert(altMsg);
                } else { alert('Error: ' + (result.message || 'Unknown error')); }
            } catch(err) { alert('Reschedule failed: ' + err.message); }
        };

        modal.style.display = 'flex';
        $('mgrModalTitle').textContent = client.name || 'Client Details';
    };

    // Close modal
    modal?.addEventListener('click', e => { if (e.target === modal) modal.style.display = 'none'; });


    // --- Save Client ---
    async function updateClient(rowIndex, fields) {
        try {
            const resp = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'text/plain' },
                body: JSON.stringify({ action: 'update_client', rowIndex, ...fields })
            });
            const data = await resp.json();
            return data.status === 'success';
        } catch(e) { console.error('Update failed:', e); return false; }
    }

    $('mgrSaveBtn')?.addEventListener('click', async () => {
        const rowIndex = parseInt($('mgrRowIndex').value);
        if (!rowIndex) return;
        const btn = $('mgrSaveBtn');
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
        btn.disabled = true;

        const fields = {
            name: $('mgrName').value.trim(), email: $('mgrEmail').value.trim(),
            phone: $('mgrPhone').value.trim(), postcode: $('mgrPostcode').value.trim(),
            address: $('mgrAddress').value.trim(), service: $('mgrService').value.trim(),
            price: $('mgrPrice').value.trim(), date: $('mgrDate').value.trim(),
            time: $('mgrTime').value.trim(), preferredDay: $('mgrDay').value,
            status: $('mgrStatus').value, paid: $('mgrPaid').value,
            notes: $('mgrNotes').value.trim()
        };

        if (await updateClient(rowIndex, fields)) {
            const c = allClients.find(x => x.rowIndex === rowIndex);
            if (c) Object.assign(c, fields);
            applyFilters(); updateStats();
            btn.innerHTML = '<i class="fas fa-check"></i> Saved!';
            setTimeout(() => { btn.innerHTML = '<i class="fas fa-save"></i> Save'; btn.disabled = false; }, 1500);
        } else {
            btn.innerHTML = '<i class="fas fa-exclamation-triangle"></i> Failed';
            btn.disabled = false;
        }
    });


    // --- Refresh ---
    $('mgrRefreshBtn')?.addEventListener('click', () => { loaded.clients = false; loadClients(); });


    // --- Export ---
    $('mgrExportBtn')?.addEventListener('click', () => {
        if (typeof XLSX === 'undefined') { alert('Excel library not loaded.'); return; }
        if (!filteredClients.length) { alert('No records to export.'); return; }
        const rows = filteredClients.map(c => ({
            'Date': c.timestamp ? new Date(c.timestamp).toLocaleDateString('en-GB') : '',
            'Type': c.type || '', 'Name': c.name || '', 'Email': c.email || '',
            'Phone': c.phone || '', 'Address': c.address || '', 'Postcode': c.postcode || '',
            'Service': c.service || '', 'Booking Date': c.date || '', 'Time': c.time || '',
            'Preferred Day': c.preferredDay || '', 'Status': c.status || '',
            'Price': c.price || '', 'Distance': c.distance || '',
            'Drive Time': c.driveTime || '', 'Notes': c.notes || '',
            'Paid': c.paid || '', 'Payment Type': c.paymentType || ''
        }));
        const ws = XLSX.utils.json_to_sheet(rows);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Clients');
        XLSX.writeFile(wb, `GGM-Clients-${new Date().toISOString().slice(0,10)}.xlsx`);
    });


    // ╔════════════════════════════════════════════╗
    // ║  OPERATIONS SUB-TABS                      ║
    // ╚════════════════════════════════════════════╝

    async function loadTodaySchedule() {
        loaded.today = true;
        try {
            const data = await apiFetch('get_schedule');
            const r = $('opsTodaySchedule');
            if (data.status === 'success' && data.visits?.length) {
                const todayStr = new Date().toISOString().slice(0, 10);
                const todayVisits = data.visits.filter(v => (v.date || '').slice(0, 10) === todayStr);
                r.innerHTML = todayVisits.length
                    ? todayVisits.map(v => `<div class="mgr-sched-item"><div><span class="mgr-sched-name">${esc(v.clientName || v.name || 'Client')}</span><span class="mgr-sched-detail">${esc(v.service || '')} — ${esc(v.time || 'TBD')} — ${esc(v.postcode || '')}</span></div><span class="mgr-badge ${v.completed ? 'mgr-badge-blue' : 'mgr-badge-green'}">${v.completed ? 'Done' : 'Scheduled'}</span></div>`).join('')
                    : '<p class="mgr-muted">No visits scheduled for today</p>';
            } else { r.innerHTML = '<p class="mgr-muted">No schedule data available</p>'; }
        } catch(e) { $('opsTodaySchedule').innerHTML = '<p class="mgr-muted">Could not load schedule</p>'; }

        // Weather
        try {
            const w = await fetch('https://api.open-meteo.com/v1/forecast?latitude=50.398&longitude=-4.829&daily=temperature_2m_max,precipitation_sum&timezone=Europe/London&forecast_days=3');
            const wd = await w.json();
            if (wd.daily) {
                $('opsWeather').innerHTML = wd.daily.time.map((d, i) => {
                    const day = new Date(d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
                    const rain = wd.daily.precipitation_sum[i];
                    const temp = wd.daily.temperature_2m_max[i];
                    const icon = rain > 2 ? '🌧️' : rain > 0 ? '🌦️' : '☀️';
                    return `<div class="mgr-sched-item"><span>${icon} ${day}</span><span>${temp}°C — ${rain}mm rain</span></div>`;
                }).join('');
            }
        } catch(e) { $('opsWeather').innerHTML = '<p class="mgr-muted">Weather unavailable</p>'; }
    }

    async function loadSubscriptions() {
        loaded.subs = true;
        try {
            const data = await apiFetch('get_subscriptions');
            const r = $('opsSubsList');
            if (data.status === 'success' && data.subscriptions?.length) {
                r.innerHTML = `<table class="mgr-table"><thead><tr><th>Name</th><th>Service</th><th>Frequency</th><th>Day</th><th>Price</th><th>Status</th></tr></thead><tbody>` +
                    data.subscriptions.map(s => `<tr><td>${esc(s.name || '')}</td><td>${esc(s.service || '')}</td><td>${esc(s.frequency || '')}</td><td>${esc(s.preferredDay || '')}</td><td>${esc(s.price ? '£' + s.price : '')}</td><td><span class="mgr-badge ${getStatusClass(s.status)}">${esc(s.status || '')}</span></td></tr>`).join('') +
                    `</tbody></table>`;
            } else { r.innerHTML = '<p class="mgr-muted">No subscriptions found</p>'; }
        } catch(e) { $('opsSubsList').innerHTML = '<p class="mgr-muted">Could not load subscriptions</p>'; }

        // Generate schedule button
        $('genScheduleBtn')?.addEventListener('click', async () => {
            if (!confirm('Generate next period schedule for all active subscriptions?')) return;
            try {
                const resp = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'text/plain' },
                    body: JSON.stringify({ action: 'generate_schedule' })
                });
                const data = await resp.json();
                alert(data.status === 'success' ? '✅ Schedule generated: ' + (data.message || '') : 'Error: ' + (data.message || 'Unknown'));
            } catch(e) { alert('Failed: ' + e.message); }
        });
    }

    async function loadQuotes() {
        loaded.quotes = true;
        try {
            const data = await apiFetch('get_quotes');
            const r = $('opsQuotesList');
            if (data.status === 'success' && data.quotes?.length) {
                r.innerHTML = `<table class="mgr-table"><thead><tr><th>Date</th><th>Name</th><th>Service</th><th>Amount</th><th>Status</th></tr></thead><tbody>` +
                    data.quotes.map(q => `<tr><td class="mono">${esc(q.date || '')}</td><td>${esc(q.name || '')}</td><td>${esc(q.service || '')}</td><td>${q.amount ? fmtGBP(q.amount) : ''}</td><td><span class="mgr-badge ${getStatusClass(q.status)}">${esc(q.status || '')}</span></td></tr>`).join('') +
                    `</tbody></table>`;
            } else { r.innerHTML = '<p class="mgr-muted">No quotes found</p>'; }
        } catch(e) { $('opsQuotesList').innerHTML = '<p class="mgr-muted">Could not load quotes</p>'; }
    }


    // ╔════════════════════════════════════════════╗
    // ║  TAB 3 — FINANCE                          ║
    // ╚════════════════════════════════════════════╝

    async function loadFinanceDashboard() {
        loaded.finance = true;
        try {
            const data = await apiFetch('get_finance_summary');
            if (data.status === 'success') {
                const s = data.summary || data;
                $('finRevenue').textContent = fmtGBP(s.totalRevenue || s.revenue || 0);
                $('finCosts').textContent = fmtGBP(s.totalCosts || s.costs || 0);
                $('finProfit').textContent = fmtGBP(s.netProfit || s.profit || 0);
                const margin = s.totalRevenue ? ((s.netProfit || 0) / (s.totalRevenue || 1) * 100).toFixed(1) + '%' : '—';
                $('finMargin').textContent = margin;
                $('finSafePay').textContent = fmtGBP(s.safeToPay || s.safeToPayYourself || 0);

                // Allocation
                if (s.allocations || s.pots) {
                    const alloc = s.allocations || s.pots || {};
                    $('finAllocation').innerHTML = Object.entries(alloc).map(([k, v]) =>
                        `<div class="mgr-fin-row"><span class="mgr-fin-label">${esc(k)}</span><span class="mgr-fin-val">${fmtGBP(v)}</span></div>`
                    ).join('') || '<p class="mgr-muted">No allocation data</p>';
                }

                // By service
                if (s.byService) {
                    const maxRev = Math.max(...Object.values(s.byService), 1);
                    $('finByService').innerHTML = Object.entries(s.byService).map(([k, v]) =>
                        `<div class="mgr-fin-row"><span class="mgr-fin-label">${esc(k)}</span><div class="mgr-fin-bar-wrap"><div class="mgr-fin-bar" style="width:${(v/maxRev*100).toFixed(0)}%"></div></div><span class="mgr-fin-val">${fmtGBP(v)}</span></div>`
                    ).join('');
                } else {
                    $('finByService').innerHTML = '<p class="mgr-muted">No service breakdown available</p>';
                }
            } else {
                $('finAllocation').innerHTML = '<p class="mgr-muted">Could not load finance data</p>';
            }
        } catch(e) {
            $('finAllocation').innerHTML = '<p class="mgr-muted">Finance data unavailable</p>';
        }
    }

    window.mgrRunFinDashboard = async function() {
        loaded.finance = false;
        $('finRevenue').textContent = '...';
        await loadFinanceDashboard();
    };

    async function loadInvoices() {
        loaded.invoices = true;
        try {
            const data = await apiFetch('get_invoices');
            const r = $('finInvoiceList');
            if (data.status === 'success' && data.invoices?.length) {
                r.innerHTML = `<table class="mgr-table"><thead><tr><th>Date</th><th>Invoice #</th><th>Client</th><th>Amount</th><th>Status</th></tr></thead><tbody>` +
                    data.invoices.slice(0, 50).map(inv => `<tr><td class="mono">${esc(inv.date || '')}</td><td class="mono">${esc(inv.invoiceNumber || inv.number || '')}</td><td>${esc(inv.clientName || inv.name || '')}</td><td>${fmtGBP(inv.amount || 0)}</td><td><span class="mgr-badge ${getStatusClass(inv.status)}">${esc(inv.status || '')}</span></td></tr>`).join('') +
                    `</tbody></table>`;
            } else { r.innerHTML = '<p class="mgr-muted">No invoices found</p>'; }
        } catch(e) { $('finInvoiceList').innerHTML = '<p class="mgr-muted">Could not load invoices</p>'; }
    }

    async function loadBusinessCosts() {
        loaded.costs = true;
        try {
            const data = await apiFetch('get_business_costs');
            const r = $('finCostsList');
            if (data.status === 'success' && data.costs?.length) {
                let total = 0;
                r.innerHTML = `<table class="mgr-table"><thead><tr><th>Item</th><th>Category</th><th>Amount</th><th>Frequency</th></tr></thead><tbody>` +
                    data.costs.map(c => { total += parseFloat(c.amount) || 0; return `<tr><td>${esc(c.item || c.name || '')}</td><td>${esc(c.category || '')}</td><td>${fmtGBP(c.amount || 0)}</td><td>${esc(c.frequency || 'Monthly')}</td></tr>`; }).join('') +
                    `</tbody><tfoot><tr><td colspan="2"><strong>Total</strong></td><td><strong>${fmtGBP(total)}</strong></td><td></td></tr></tfoot></table>`;
            } else { r.innerHTML = '<p class="mgr-muted">No business costs recorded</p>'; }
        } catch(e) { $('finCostsList').innerHTML = '<p class="mgr-muted">Could not load costs</p>'; }
    }

    async function loadSavingsPots() {
        loaded.pots = true;
        try {
            const data = await apiFetch('get_savings_pots');
            const r = $('finPotsList');
            if (data.status === 'success' && data.pots?.length) {
                r.innerHTML = data.pots.map(p =>
                    `<div class="mgr-fin-row"><span class="mgr-fin-label">${esc(p.name || '')}</span><div class="mgr-fin-bar-wrap"><div class="mgr-fin-bar" style="width:${Math.min((p.current / (p.target || 1)) * 100, 100).toFixed(0)}%;background:${p.current >= (p.target || 0) ? '#43A047' : '#1565C0'}"></div></div><span class="mgr-fin-val">${fmtGBP(p.current || 0)} / ${fmtGBP(p.target || 0)}</span></div>`
                ).join('');
            } else { r.innerHTML = '<p class="mgr-muted">No savings pots configured</p>'; }
        } catch(e) { $('finPotsList').innerHTML = '<p class="mgr-muted">Could not load pots</p>'; }
    }


    // ╔════════════════════════════════════════════╗
    // ║  TAB 4 — MARKETING                        ║
    // ╚════════════════════════════════════════════╝

    // --- Social Media ---
    let socialPosts = JSON.parse(localStorage.getItem('socialPosts') || '[]');
    renderSocialLog();

    function showSocialStatus(msg, type) {
        const el = $('socialStatus');
        if (!el) return;
        el.textContent = msg;
        el.className = type === 'success' ? 'mgr-badge mgr-badge-green' : type === 'error' ? 'mgr-badge mgr-badge-red' : 'mgr-badge mgr-badge-blue';
        el.style.display = 'inline-block';
    }

    function getPlatforms() {
        const p = [];
        if ($('socialFB')?.checked) p.push('facebook');
        if ($('socialIG')?.checked) p.push('instagram');
        if ($('socialX')?.checked) p.push('twitter');
        return p;
    }

    function renderSocialLog() {
        const el = $('socialLog');
        if (!el) return;
        if (!socialPosts.length) { el.innerHTML = '<p class="mgr-muted">No posts yet</p>'; return; }
        el.innerHTML = socialPosts.slice(-10).reverse().map(p => {
            const d = new Date(p.timestamp);
            const dateStr = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
            const platformIcons = (p.platforms || []).map(pl => {
                if (pl === 'facebook') return '<i class="fab fa-facebook" style="color:#1877F2;"></i>';
                if (pl === 'instagram') return '<i class="fab fa-instagram" style="color:#E1306C;"></i>';
                if (pl === 'twitter') return '<i class="fab fa-x-twitter"></i>';
                return '';
            }).join(' ');
            const statusIcon = p.success ? '✅' : (p.preview ? '👁️' : '❌');
            const preview = (p.text || '').substring(0, 60) + ((p.text || '').length > 60 ? '...' : '');
            return `<div class="mgr-activity-item"><span>${statusIcon} ${platformIcons}</span><span style="flex:1">${preview}</span><span class="mgr-activity-time">${dateStr}</span></div>`;
        }).join('');
    }

    async function generateSocialPost(postType, customText) {
        if (customText && customText.trim().length > 10) return { text: customText.trim(), generated: false };
        const templates = {
            tip: '🌿 Quick garden tip: February is the perfect time to prepare your lawn for spring. Give it a light rake and check for moss patches.\n\nNeed help? gardnersgm.co.uk',
            service: '🌿 Professional lawn cutting across Cornwall from just £30 — edging, strimming and clippings collected.\n\nBook at gardnersgm.co.uk',
            seasonal: '🌸 Seasonal Checklist:\n✅ Rake debris from lawns\n✅ Check for moss\n✅ Plan spring planting\n✅ Book your first mow\n\ngardnersgm.co.uk',
            testimonial: '⭐⭐⭐⭐⭐ "Fantastic job — the garden looks like a different space!"\n\nBook at gardnersgm.co.uk',
            promo: '🎯 Save 25% with our subscription plans from £30/visit — no contracts!\n\ngardnersgm.co.uk/subscribe',
            cornwall: '🌊 Nothing like a well-kept garden with a Cornish backdrop. What\'s your favourite outdoor space feature? 👇'
        };
        const type = postType === 'auto' ? ['tip', 'service', 'seasonal', 'testimonial', 'promo', 'cornwall'][new Date().getDay() % 6] : postType;
        return { text: templates[type] || templates.tip, generated: true, type };
    }

    $('socialGenerateBtn')?.addEventListener('click', async () => {
        const postType = $('socialPostType')?.value || 'auto';
        const customText = $('socialPostText')?.value || '';
        const platforms = getPlatforms();
        if (!platforms.length) { showSocialStatus('Select at least one platform.', 'error'); return; }

        const btn = $('socialGenerateBtn');
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Generating...';
        showSocialStatus('Generating & posting...', 'info');

        try {
            const result = await generateSocialPost(postType, customText);
            try { await fetch(API, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ action: 'log_social_post', type: postType, text: result.text, platforms, timestamp: new Date().toISOString() }) }); } catch(e) {}
            socialPosts.push({ timestamp: new Date().toISOString(), type: postType, text: result.text, platforms, success: true, preview: false });
            localStorage.setItem('socialPosts', JSON.stringify(socialPosts.slice(-50)));
            renderSocialLog();
            showSocialStatus('✅ Posted to: ' + platforms.join(', '), 'success');
            const ta = $('socialPostText'); if (ta) ta.value = '';
        } catch(err) { showSocialStatus('❌ ' + err.message, 'error'); }

        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-magic"></i> Generate';
    });

    $('socialPreviewBtn')?.addEventListener('click', async () => {
        const postType = $('socialPostType')?.value || 'auto';
        const customText = $('socialPostText')?.value || '';
        try {
            const result = await generateSocialPost(postType, customText);
            const ta = $('socialPostText'); if (ta) ta.value = result.text;
            showSocialStatus('👁️ Preview — edit above then Generate to publish', 'info');
        } catch(err) { showSocialStatus('❌ ' + err.message, 'error'); }
    });


    // --- Blog ---
    async function loadBlogPosts() {
        loaded.blog = true;
        try {
            const data = await apiFetch('get_all_blog_posts');
            const r = $('mktBlogList');
            if (data.status === 'success' && data.posts?.length) {
                r.innerHTML = `<table class="mgr-table"><thead><tr><th>Date</th><th>Title</th><th>Category</th><th>Status</th></tr></thead><tbody>` +
                    data.posts.slice(0, 30).map(p => `<tr><td class="mono">${esc(p.date || '')}</td><td><a href="blog.html#${p.slug || ''}" target="_blank">${esc(p.title || '')}</a></td><td>${esc(p.category || '')}</td><td><span class="mgr-badge ${p.published ? 'mgr-badge-green' : 'mgr-badge-gray'}">${p.published ? 'Published' : 'Draft'}</span></td></tr>`).join('') +
                    `</tbody></table>`;
            } else { r.innerHTML = '<p class="mgr-muted">No blog posts found</p>'; }
        } catch(e) { $('mktBlogList').innerHTML = '<p class="mgr-muted">Could not load blog posts</p>'; }
    }

    // --- Newsletter ---
    async function loadNewsletter() {
        loaded.newsletter = true;
        try {
            const data = await apiFetch('get_subscribers');
            const r = $('mktNewsletterInfo');
            if (data.status === 'success') {
                const subs = data.subscribers || [];
                const active = subs.filter(s => s.status !== 'unsubscribed').length;
                r.innerHTML = `
                    <div class="mgr-stats" style="margin-bottom:1rem;">
                        <div class="mgr-stat"><span>${subs.length}</span> Total</div>
                        <div class="mgr-stat"><span>${active}</span> Active</div>
                        <div class="mgr-stat"><span>${subs.length - active}</span> Unsubscribed</div>
                    </div>
                    <table class="mgr-table"><thead><tr><th>Email</th><th>Name</th><th>Subscribed</th><th>Status</th></tr></thead><tbody>` +
                    subs.slice(0, 30).map(s => `<tr><td>${esc(s.email || '')}</td><td>${esc(s.name || '')}</td><td class="mono">${esc(s.date || '')}</td><td><span class="mgr-badge ${s.status === 'unsubscribed' ? 'mgr-badge-gray' : 'mgr-badge-green'}">${esc(s.status || 'Active')}</span></td></tr>`).join('') +
                    `</tbody></table>`;
            } else { r.innerHTML = '<p class="mgr-muted">Could not load subscribers</p>'; }
        } catch(e) { $('mktNewsletterInfo').innerHTML = '<p class="mgr-muted">Newsletter data unavailable</p>'; }
    }

    // --- Testimonials ---
    async function loadTestimonials() {
        loaded.testimonials = true;
        try {
            const data = await apiFetch('get_all_testimonials');
            const r = $('mktTestimonials');
            if (data.status === 'success' && data.testimonials?.length) {
                r.innerHTML = data.testimonials.map(t =>
                    `<div style="padding:0.6rem 0;border-bottom:1px solid #f0f0f0;">
                        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.3rem;">
                            <strong style="font-size:0.85rem;">${esc(t.name || 'Anonymous')}</strong>
                            <span style="color:#FB8C00;font-size:0.8rem;">${'★'.repeat(parseInt(t.rating) || 5)}</span>
                        </div>
                        <p style="font-size:0.8rem;color:#555;margin:0;">"${esc(t.text || t.review || '')}"</p>
                        <span style="font-size:0.7rem;color:#aaa;">${esc(t.date || '')}</span>
                    </div>`
                ).join('');
            } else { r.innerHTML = '<p class="mgr-muted">No testimonials yet</p>'; }
        } catch(e) { $('mktTestimonials').innerHTML = '<p class="mgr-muted">Could not load testimonials</p>'; }
    }


    // ╔════════════════════════════════════════════╗
    // ║  TAB 5 — CUSTOMER CARE                    ║
    // ╚════════════════════════════════════════════╝

    async function loadEnquiries() {
        loaded.enquiries = true;
        try {
            const data = await apiFetch('get_enquiries');
            const r = $('ccEnquiries');
            if (data.status === 'success' && data.enquiries?.length) {
                r.innerHTML = `<table class="mgr-table"><thead><tr><th>Date</th><th>Type</th><th>Name</th><th>Email</th><th>Message</th></tr></thead><tbody>` +
                    data.enquiries.slice(0, 50).map(e => `<tr><td class="mono">${esc(e.date || e.timestamp || '')}</td><td><span class="mgr-badge ${e.type === 'Contact' ? 'mgr-badge-blue' : 'mgr-badge-green'}">${esc(e.type || 'Bespoke')}</span></td><td>${esc(e.name || '')}</td><td>${esc(e.email || '')}</td><td style="max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(e.message || e.details || '')}</td></tr>`).join('') +
                    `</tbody></table>`;
            } else { r.innerHTML = '<p class="mgr-muted">No enquiries found</p>'; }
        } catch(e) { $('ccEnquiries').innerHTML = '<p class="mgr-muted">Could not load enquiries</p>'; }
    }

    async function loadComplaints() {
        loaded.complaints = true;
        try {
            const data = await apiFetch('get_complaints');
            const r = $('ccComplaints');
            if (data.status === 'success' && data.complaints?.length) {
                r.innerHTML = `<table class="mgr-table"><thead><tr><th>Date</th><th>Name</th><th>Category</th><th>Description</th><th>Status</th></tr></thead><tbody>` +
                    data.complaints.map(c => `<tr><td class="mono">${esc(c.date || '')}</td><td>${esc(c.name || '')}</td><td>${esc(c.category || '')}</td><td style="max-width:250px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(c.description || c.complaint || '')}</td><td><span class="mgr-badge ${getStatusClass(c.status)}">${esc(c.status || 'Open')}</span></td></tr>`).join('') +
                    `</tbody></table>`;
            } else { r.innerHTML = '<p class="mgr-muted">No complaints — great work!</p>'; }
        } catch(e) { $('ccComplaints').innerHTML = '<p class="mgr-muted">Could not load complaints</p>'; }
    }

    async function loadEmailTracking() {
        loaded.emails = true;
        try {
            const data = await apiFetch('get_email_workflow_status');
            const r = $('ccEmails');
            if (data.status === 'success') {
                const workflows = data.workflows || data.emails || [];
                if (workflows.length) {
                    r.innerHTML = `<table class="mgr-table"><thead><tr><th>Client</th><th>Stage</th><th>Last Sent</th><th>Next Action</th></tr></thead><tbody>` +
                        workflows.slice(0, 30).map(w => `<tr><td>${esc(w.clientName || w.name || '')}</td><td>${esc(w.stage || w.currentStage || '')}</td><td class="mono">${esc(w.lastSent || '')}</td><td>${esc(w.nextAction || '')}</td></tr>`).join('') +
                        `</tbody></table>`;
                } else { r.innerHTML = '<p class="mgr-muted">No active email workflows</p>'; }
            } else { r.innerHTML = '<p class="mgr-muted">Email tracking unavailable</p>'; }
        } catch(e) { $('ccEmails').innerHTML = '<p class="mgr-muted">Could not load email data</p>'; }
    }


    // ╔════════════════════════════════════════════╗
    // ║  TAB 6 — ADMIN                            ║
    // ╚════════════════════════════════════════════╝

    async function loadCareers() {
        loaded.careers = true;
        try {
            const [vacData, appData] = await Promise.all([
                apiFetch('get_all_vacancies').catch(() => ({ status: 'error' })),
                apiFetch('get_applications').catch(() => ({ status: 'error' }))
            ]);
            const r = $('admCareers');
            let html = '';
            if (vacData.status === 'success' && vacData.vacancies?.length) {
                html += '<h4 style="font-size:0.78rem;color:#2E7D32;margin-bottom:0.5rem;">Vacancies</h4>';
                html += `<table class="mgr-table"><thead><tr><th>Title</th><th>Location</th><th>Type</th><th>Status</th></tr></thead><tbody>` +
                    vacData.vacancies.map(v => `<tr><td>${esc(v.title || '')}</td><td>${esc(v.location || '')}</td><td>${esc(v.type || '')}</td><td><span class="mgr-badge ${v.active ? 'mgr-badge-green' : 'mgr-badge-gray'}">${v.active ? 'Active' : 'Closed'}</span></td></tr>`).join('') +
                    `</tbody></table>`;
            } else { html += '<p class="mgr-muted">No vacancies posted</p>'; }

            if (appData.status === 'success' && appData.applications?.length) {
                html += '<h4 style="font-size:0.78rem;color:#2E7D32;margin:1rem 0 0.5rem;">Applications</h4>';
                html += `<table class="mgr-table"><thead><tr><th>Date</th><th>Name</th><th>Position</th><th>Email</th></tr></thead><tbody>` +
                    appData.applications.map(a => `<tr><td class="mono">${esc(a.date || '')}</td><td>${esc(a.name || '')}</td><td>${esc(a.position || '')}</td><td>${esc(a.email || '')}</td></tr>`).join('') +
                    `</tbody></table>`;
            } else { html += '<p class="mgr-muted" style="margin-top:0.5rem;">No applications received</p>'; }

            r.innerHTML = html;
        } catch(e) { $('admCareers').innerHTML = '<p class="mgr-muted">Could not load careers data</p>'; }
    }

    async function loadShop() {
        loaded.shop = true;
        try {
            const [ordData, prodData] = await Promise.all([
                apiFetch('get_orders').catch(() => ({ status: 'error' })),
                apiFetch('get_products').catch(() => ({ status: 'error' }))
            ]);
            const r = $('admShop');
            let html = '';
            if (ordData.status === 'success' && ordData.orders?.length) {
                html += '<h4 style="font-size:0.78rem;color:#2E7D32;margin-bottom:0.5rem;">Recent Orders</h4>';
                html += `<table class="mgr-table"><thead><tr><th>Date</th><th>Customer</th><th>Items</th><th>Total</th><th>Status</th></tr></thead><tbody>` +
                    ordData.orders.slice(0, 20).map(o => `<tr><td class="mono">${esc(o.date || '')}</td><td>${esc(o.name || o.customer || '')}</td><td>${esc(o.items || '')}</td><td>${fmtGBP(o.total || 0)}</td><td><span class="mgr-badge ${getStatusClass(o.status)}">${esc(o.status || '')}</span></td></tr>`).join('') +
                    `</tbody></table>`;
            } else { html += '<p class="mgr-muted">No orders yet</p>'; }

            if (prodData.status === 'success' && prodData.products?.length) {
                html += '<h4 style="font-size:0.78rem;color:#2E7D32;margin:1rem 0 0.5rem;">Products</h4>';
                html += `<table class="mgr-table"><thead><tr><th>Product</th><th>Price</th><th>Stock</th><th>Active</th></tr></thead><tbody>` +
                    prodData.products.map(p => `<tr><td>${esc(p.name || '')}</td><td>${fmtGBP(p.price || 0)}</td><td>${esc(String(p.stock ?? ''))}</td><td><span class="mgr-badge ${p.active ? 'mgr-badge-green' : 'mgr-badge-gray'}">${p.active ? 'Yes' : 'No'}</span></td></tr>`).join('') +
                    `</tbody></table>`;
            } else { html += '<p class="mgr-muted" style="margin-top:0.5rem;">No products configured</p>'; }

            r.innerHTML = html;
        } catch(e) { $('admShop').innerHTML = '<p class="mgr-muted">Could not load shop data</p>'; }
    }

    async function loadPricing() {
        loaded.pricing = true;
        try {
            const data = await apiFetch('get_pricing_config');
            const r = $('admPricing');
            if (data.status === 'success' && data.config) {
                const cfg = data.config;
                r.innerHTML = Object.entries(cfg).map(([k, v]) => {
                    if (typeof v === 'object') {
                        return `<div style="margin-bottom:0.75rem;"><strong style="font-size:0.8rem;color:#333;">${esc(k)}</strong>` +
                            Object.entries(v).map(([sk, sv]) => `<div class="mgr-fin-row"><span class="mgr-fin-label">${esc(sk)}</span><span class="mgr-fin-val">${typeof sv === 'number' ? fmtGBP(sv) : esc(String(sv))}</span></div>`).join('') +
                            `</div>`;
                    }
                    return `<div class="mgr-fin-row"><span class="mgr-fin-label">${esc(k)}</span><span class="mgr-fin-val">${typeof v === 'number' ? fmtGBP(v) : esc(String(v))}</span></div>`;
                }).join('');
            } else { r.innerHTML = '<p class="mgr-muted">Pricing config not available</p>'; }
        } catch(e) { $('admPricing').innerHTML = '<p class="mgr-muted">Could not load pricing</p>'; }
    }


    // ╔════════════════════════════════════════════╗
    // ║  KEYBOARD SHORTCUTS                       ║
    // ╚════════════════════════════════════════════╝

    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && modal?.style.display === 'flex') modal.style.display = 'none';
        if ((e.ctrlKey || e.metaKey) && e.key === 'f' && searchInput && document.activeElement !== searchInput) {
            e.preventDefault();
            // Switch to operations > clients tab if not already there
            const opsTab = document.querySelector('[data-tab="operations"]');
            if (opsTab && !opsTab.classList.contains('active')) opsTab.click();
            const clientsSubTab = document.querySelector('[data-subtab="ops-clients"]');
            if (clientsSubTab && !clientsSubTab.classList.contains('active')) clientsSubTab.click();
            searchInput.focus();
        }
    });


    // ╔════════════════════════════════════════════╗
    // ║  INIT — Load overview on startup          ║
    // ╚════════════════════════════════════════════╝

    loadOverview();

});
