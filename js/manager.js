/* ============================================
   Gardners Ground Maintenance — Client Manager JS
   Full CRM: reads from Google Sheets, 
   edits/updates rows, search, filter, export
   ============================================ */

document.addEventListener('DOMContentLoaded', () => {

    const SHEETS_WEBHOOK = 'https://script.google.com/macros/s/AKfycby7iwkJhOZm2nFmmX5l6hOWN2fkSUxFzQ43fhcDqJ6zTQA1f1j49pLkU5M8lCYGRPnHMQ/exec';

    let allClients = [];
    let filteredClients = [];

    // --- DOM ---
    const loading = document.getElementById('mgrLoading');
    const clientList = document.getElementById('mgrClientList');
    const emptyState = document.getElementById('mgrEmpty');
    const searchInput = document.getElementById('mgrSearch');
    const filterType = document.getElementById('mgrFilterType');
    const filterStatus = document.getElementById('mgrFilterStatus');
    const filterPaid = document.getElementById('mgrFilterPaid');
    const modal = document.getElementById('mgrModal');


    // ============================================
    // LOAD CLIENTS FROM GOOGLE SHEETS
    // ============================================

    async function loadClients() {
        loading.style.display = 'flex';
        clientList.style.display = 'none';
        emptyState.style.display = 'none';

        try {
            const resp = await fetch(SHEETS_WEBHOOK + '?action=get_clients');
            const data = await resp.json();

            if (data.status === 'success' && data.clients) {
                allClients = data.clients;
                applyFilters();
                updateStats();
            } else {
                showError('Failed to load clients: ' + (data.message || 'Unknown error'));
            }
        } catch (e) {
            showError('Could not connect to Google Sheets. Make sure the Apps Script is deployed.');
            console.error(e);
        }

        loading.style.display = 'none';
    }

    function showError(msg) {
        loading.style.display = 'none';
        emptyState.innerHTML = `<i class="fas fa-exclamation-triangle"></i><p>${msg}</p>`;
        emptyState.style.display = 'flex';
    }


    // ============================================
    // STATS
    // ============================================

    function updateStats() {
        document.getElementById('mgrStatTotal').textContent = allClients.length;
        document.getElementById('mgrStatBookings').textContent = allClients.filter(c => 
            c.type === 'booking' || c.type === 'booking-payment'
        ).length;
        document.getElementById('mgrStatSubs').textContent = allClients.filter(c =>
            c.type === 'subscription' || c.type === 'stripe-subscription'
        ).length;
        document.getElementById('mgrStatPaid').textContent = allClients.filter(c =>
            c.paid === 'Yes' || c.paid === 'Auto' || c.paymentType === 'Stripe One-Off' || c.paymentType === 'Stripe Recurring'
        ).length;
        document.getElementById('mgrStatUnpaid').textContent = allClients.filter(c =>
            c.paid === 'No' && c.status !== 'Cancelled' && c.status !== 'cancelled'
        ).length;
    }


    // ============================================
    // SEARCH & FILTER
    // ============================================

    function applyFilters() {
        const q = (searchInput.value || '').toLowerCase().trim();
        const typeF = filterType.value;
        const statusF = filterStatus.value;
        const paidF = filterPaid.value;

        filteredClients = allClients.filter(c => {
            // Search
            if (q) {
                const searchable = [c.name, c.email, c.postcode, c.service, c.address, c.phone, c.notes].join(' ').toLowerCase();
                if (!searchable.includes(q)) return false;
            }
            // Type filter
            if (typeF && c.type !== typeF) return false;
            // Status filter
            if (statusF && c.status !== statusF) return false;
            // Paid filter
            if (paidF) {
                if (paidF === 'Yes' && c.paid !== 'Yes' && c.paymentType !== 'Stripe One-Off') return false;
                if (paidF === 'No' && c.paid !== 'No') return false;
                if (paidF === 'Auto' && c.paid !== 'Auto' && c.paymentType !== 'Stripe Recurring') return false;
            }
            return true;
        });

        // Sort: newest first
        filteredClients.sort((a, b) => {
            const da = new Date(a.timestamp || 0);
            const db = new Date(b.timestamp || 0);
            return db - da;
        });

        renderClientList();
    }

    searchInput.addEventListener('input', applyFilters);
    filterType.addEventListener('change', applyFilters);
    filterStatus.addEventListener('change', applyFilters);
    filterPaid.addEventListener('change', applyFilters);


    // ============================================
    // RENDER CLIENT CARDS
    // ============================================

    function renderClientList() {
        if (filteredClients.length === 0) {
            clientList.style.display = 'none';
            emptyState.innerHTML = '<i class="fas fa-inbox"></i><p>No records match your search</p>';
            emptyState.style.display = 'flex';
            return;
        }

        emptyState.style.display = 'none';
        clientList.style.display = 'grid';

        clientList.innerHTML = filteredClients.map(c => {
            const statusClass = getStatusClass(c.status);
            const typeIcon = getTypeIcon(c.type);
            const paidBadge = getPaidBadge(c);
            const dateDisplay = c.date ? formatDate(c.date) : '';
            const timeDisplay = c.time || '';

            return `
                <div class="mgr-card" data-row="${c.rowIndex}" onclick="window.mgrOpenDetail(${c.rowIndex})">
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
                </div>
            `;
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
        if (c.paid === 'Yes' || c.paymentType === 'Stripe One-Off') {
            return '<span class="mgr-badge mgr-badge-green"><i class="fas fa-check"></i> Paid</span>';
        }
        if (c.paid === 'Auto' || c.paymentType === 'Stripe Recurring') {
            return '<span class="mgr-badge mgr-badge-blue"><i class="fas fa-sync-alt"></i> Auto</span>';
        }
        if (c.status === 'Sent') {
            return '<span class="mgr-badge mgr-badge-amber"><i class="fas fa-paper-plane"></i> Invoiced</span>';
        }
        return '<span class="mgr-badge mgr-badge-red"><i class="fas fa-times"></i> Unpaid</span>';
    }

    function formatDate(dateStr) {
        if (!dateStr) return '';
        // If it's already formatted like "Monday, 14 March 2026", shorten it
        if (dateStr.includes(',')) {
            return dateStr.replace(/^[A-Za-z]+,\s*/, '');
        }
        // ISO format
        try {
            const d = new Date(dateStr);
            if (isNaN(d)) return dateStr;
            return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
        } catch (e) { return dateStr; }
    }

    function esc(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }


    // ============================================
    // DETAIL MODAL
    // ============================================

    window.mgrOpenDetail = function(rowIndex) {
        const client = allClients.find(c => c.rowIndex === rowIndex);
        if (!client) return;

        document.getElementById('mgrRowIndex').value = rowIndex;
        document.getElementById('mgrName').value = client.name || '';
        document.getElementById('mgrEmail').value = client.email || '';
        document.getElementById('mgrPhone').value = client.phone || '';
        document.getElementById('mgrPostcode').value = client.postcode || '';
        document.getElementById('mgrAddress').value = client.address || '';
        document.getElementById('mgrService').value = client.service || '';
        document.getElementById('mgrPrice').value = client.price || '';
        document.getElementById('mgrDate').value = client.date || '';
        document.getElementById('mgrTime').value = client.time || '';
        document.getElementById('mgrDay').value = client.preferredDay || '';
        document.getElementById('mgrType').value = client.type || '';
        document.getElementById('mgrStatus').value = client.status || 'Active';
        document.getElementById('mgrPaid').value = client.paid || 'No';
        document.getElementById('mgrNotes').value = client.notes || '';

        // Record info
        document.getElementById('mgrRecordTimestamp').innerHTML = 
            `<i class="fas fa-clock"></i> Created: ${client.timestamp ? new Date(client.timestamp).toLocaleString('en-GB') : 'Unknown'}`;
        document.getElementById('mgrRecordDistance').innerHTML = 
            client.distance ? `<i class="fas fa-route"></i> Distance: ${client.distance} mi, Drive: ${client.driveTime || '?'} min` : '';
        document.getElementById('mgrRecordPayment').innerHTML = 
            client.paymentType ? `<i class="fas fa-credit-card"></i> Payment: ${client.paymentType}` : '';

        // Quick action buttons
        document.getElementById('mgrCallBtn').onclick = () => {
            if (client.phone) window.open('tel:' + client.phone);
        };
        document.getElementById('mgrEmailBtn').onclick = () => {
            if (client.email) window.open('mailto:' + client.email);
        };
        document.getElementById('mgrMapBtn').onclick = () => {
            const addr = (client.address || '') + ', ' + (client.postcode || '');
            window.open('https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(addr));
        };
        document.getElementById('mgrInvoiceBtn').onclick = () => {
            const params = new URLSearchParams({
                name: client.name || '',
                email: client.email || '',
                phone: client.phone || '',
                address: client.address || '',
                postcode: client.postcode || '',
                service: client.service || ''
            }).toString();
            window.open('invoice.html?' + params);
        };
        document.getElementById('mgrCancelBtn').onclick = async () => {
            const isSub = (client.type || '').toLowerCase().includes('subscription');
            const msg = isSub
              ? 'Cancel this subscription?\n\n• Stripe subscription will be cancelled\n• All future visits removed\n• Cancellation email sent to customer'
              : 'Cancel this booking?\n\n• Stripe refund will be processed (if paid)\n• Cancellation email sent to customer\n• Google Calendar event removed';
            if (!confirm(msg)) return;
            try {
                const action = isSub ? 'cancel_subscription' : 'cancel_booking';
                const resp = await fetch(SHEETS_WEBHOOK, {
                    method: 'POST',
                    headers: { 'Content-Type': 'text/plain' },
                    body: JSON.stringify({
                        action: action,
                        rowIndex: rowIndex,
                        jobNumber: client.jobNumber || '',
                        reason: 'Manager cancellation via CRM'
                    })
                });
                const result = await resp.json();
                if (result.status === 'success') {
                    document.getElementById('mgrStatus').value = 'Cancelled';
                    const c = allClients.find(x => x.rowIndex === rowIndex);
                    if (c) c.status = 'Cancelled';
                    applyFilters();
                    updateStats();
                    let summary = '✅ ' + (isSub ? 'Subscription' : 'Booking') + ' cancelled';
                    if (result.refunded) summary += '\n💰 Refund: £' + result.refundAmount;
                    if (result.removedVisits) summary += '\n📅 ' + result.removedVisits + ' visits removed';
                    if (result.stripeCancelled) summary += '\n💳 Stripe subscription cancelled';
                    alert(summary);
                } else {
                    alert('Error: ' + (result.message || 'Unknown error'));
                }
            } catch(err) {
                alert('Cancel failed: ' + err.message);
            }
        };

        document.getElementById('mgrRescheduleBtn').onclick = async () => {
            const newDate = prompt('New date (YYYY-MM-DD):', client.date || '');
            if (!newDate) return;
            const newTime = prompt('New time slot (e.g. 09:00 - 10:00):', client.time || '');
            if (!newTime) return;
            try {
                const resp = await fetch(SHEETS_WEBHOOK, {
                    method: 'POST',
                    headers: { 'Content-Type': 'text/plain' },
                    body: JSON.stringify({
                        action: 'reschedule_booking',
                        rowIndex: rowIndex,
                        jobNumber: client.jobNumber || '',
                        newDate: newDate,
                        newTime: newTime
                    })
                });
                const result = await resp.json();
                if (result.status === 'success') {
                    alert('✅ Booking rescheduled to ' + newDate + ' ' + newTime);
                    const c = allClients.find(x => x.rowIndex === rowIndex);
                    if (c) { c.date = newDate; c.time = newTime; }
                    applyFilters();
                } else if (result.alternatives && result.alternatives.length) {
                    let altMsg = 'Slot not available: ' + (result.message || '') + '\n\nSuggested alternatives:\n';
                    result.alternatives.forEach((a, i) => { altMsg += (i+1) + ') ' + a.display + '\n'; });
                    alert(altMsg);
                } else {
                    alert('Error: ' + (result.message || 'Unknown error'));
                }
            } catch(err) {
                alert('Reschedule failed: ' + err.message);
            }
        };

        modal.style.display = 'flex';
        document.getElementById('mgrModalTitle').innerHTML = `<i class="fas fa-user"></i> ${esc(client.name || 'Client Details')}`;
    };

    // Close modal
    document.getElementById('mgrModalClose').addEventListener('click', () => { modal.style.display = 'none'; });
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.style.display = 'none'; });


    // ============================================
    // SAVE / UPDATE CLIENT
    // ============================================

    async function updateClient(rowIndex, fields) {
        try {
            const resp = await fetch(SHEETS_WEBHOOK, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain' },
                body: JSON.stringify({
                    action: 'update_client',
                    rowIndex: rowIndex,
                    ...fields
                })
            });
            const data = await resp.json();
            return data.status === 'success';
        } catch (e) {
            console.error('Update failed:', e);
            return false;
        }
    }

    document.getElementById('mgrSaveBtn').addEventListener('click', async () => {
        const rowIndex = parseInt(document.getElementById('mgrRowIndex').value);
        if (!rowIndex) return;

        const btn = document.getElementById('mgrSaveBtn');
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
        btn.disabled = true;

        const fields = {
            name: document.getElementById('mgrName').value.trim(),
            email: document.getElementById('mgrEmail').value.trim(),
            phone: document.getElementById('mgrPhone').value.trim(),
            postcode: document.getElementById('mgrPostcode').value.trim(),
            address: document.getElementById('mgrAddress').value.trim(),
            service: document.getElementById('mgrService').value.trim(),
            price: document.getElementById('mgrPrice').value.trim(),
            date: document.getElementById('mgrDate').value.trim(),
            time: document.getElementById('mgrTime').value.trim(),
            preferredDay: document.getElementById('mgrDay').value,
            status: document.getElementById('mgrStatus').value,
            paid: document.getElementById('mgrPaid').value,
            notes: document.getElementById('mgrNotes').value.trim()
        };

        const success = await updateClient(rowIndex, fields);

        if (success) {
            // Update local data
            const c = allClients.find(x => x.rowIndex === rowIndex);
            if (c) Object.assign(c, fields);
            applyFilters();
            updateStats();

            btn.innerHTML = '<i class="fas fa-check"></i> Saved!';
            setTimeout(() => {
                btn.innerHTML = '<i class="fas fa-save"></i> Save Changes';
                btn.disabled = false;
            }, 1500);
        } else {
            btn.innerHTML = '<i class="fas fa-exclamation-triangle"></i> Failed — retry';
            btn.disabled = false;
        }
    });


    // ============================================
    // REFRESH
    // ============================================

    document.getElementById('mgrRefreshBtn').addEventListener('click', () => {
        loadClients();
    });


    // ============================================
    // EXCEL EXPORT
    // ============================================

    document.getElementById('mgrExportBtn').addEventListener('click', () => {
        if (typeof XLSX === 'undefined') {
            alert('Excel library not loaded.');
            return;
        }
        if (filteredClients.length === 0) {
            alert('No records to export.');
            return;
        }

        const rows = filteredClients.map(c => ({
            'Date': c.timestamp ? new Date(c.timestamp).toLocaleDateString('en-GB') : '',
            'Type': c.type || '',
            'Name': c.name || '',
            'Email': c.email || '',
            'Phone': c.phone || '',
            'Address': c.address || '',
            'Postcode': c.postcode || '',
            'Service': c.service || '',
            'Booking Date': c.date || '',
            'Time': c.time || '',
            'Preferred Day': c.preferredDay || '',
            'Status': c.status || '',
            'Price': c.price || '',
            'Distance': c.distance || '',
            'Drive Time': c.driveTime || '',
            'Notes': c.notes || '',
            'Paid': c.paid || '',
            'Payment Type': c.paymentType || ''
        }));

        const ws = XLSX.utils.json_to_sheet(rows);
        ws['!cols'] = [
            { wch: 12 }, { wch: 16 }, { wch: 20 }, { wch: 25 }, { wch: 15 },
            { wch: 30 }, { wch: 10 }, { wch: 20 }, { wch: 20 }, { wch: 12 },
            { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 10 },
            { wch: 30 }, { wch: 8 }, { wch: 15 }
        ];

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Clients');

        const date = new Date().toISOString().slice(0, 10);
        XLSX.writeFile(wb, `GGM-Clients-${date}.xlsx`);
    });


    // ============================================
    // KEYBOARD SHORTCUTS
    // ============================================

    document.addEventListener('keydown', (e) => {
        // Escape closes modal
        if (e.key === 'Escape' && modal.style.display === 'flex') {
            modal.style.display = 'none';
        }
        // Ctrl+F focuses search
        if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
            // Don't override if already in search
            if (document.activeElement !== searchInput) {
                e.preventDefault();
                searchInput.focus();
            }
        }
    });


    // ============================================
    // INIT
    // ============================================

    loadClients();

});
