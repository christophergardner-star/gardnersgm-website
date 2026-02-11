(function() {
    'use strict';

    const GAS = 'https://script.google.com/macros/s/AKfycbzT27eyiZgQYkRBkoghFCPYoXGE_H-qam7IoecKdNYgRwbRmJhepTXapBLXbLskFHclKw/exec';

    // ── DOM Elements ──
    const listEl = document.getElementById('complaintsList');
    const filterStatus = document.getElementById('filterComplaintStatus');
    const filterType = document.getElementById('filterComplaintType');
    const filterSeverity = document.getElementById('filterComplaintSeverity');
    const searchInput = document.getElementById('searchComplaints');
    const refreshBtn = document.getElementById('refreshComplaints');
    const statsEl = document.getElementById('complaintsStats');

    // Detail modal elements
    const modal = document.getElementById('complaintDetailModal');
    const modalBody = document.getElementById('complaintDetailBody');
    const closeModalBtn = document.getElementById('closeComplaintModal');

    if (!listEl) return;

    let allComplaints = [];

    // ── Load complaints ──
    async function loadComplaints() {
        listEl.innerHTML = '<div class="adm-loading"><i class="fas fa-spinner fa-spin"></i> Loading complaints...</div>';
        try {
            const res = await fetch(GAS + '?action=get_complaints');
            const data = await res.json();
            allComplaints = data.complaints || [];
            updateStats();
            renderComplaints();
        } catch(err) {
            listEl.innerHTML = '<div class="adm-error">Failed to load complaints: ' + err.message + '</div>';
        }
    }

    // ── Stats ──
    function updateStats() {
        const total = allComplaints.length;
        const open = allComplaints.filter(c => c.status === 'open').length;
        const investigating = allComplaints.filter(c => c.status === 'investigating').length;
        const resolved = allComplaints.filter(c => c.status === 'resolved').length;
        const closed = allComplaints.filter(c => c.status === 'closed').length;

        statsEl.innerHTML = `
            <div class="stat-card"><span class="stat-num">${total}</span><span class="stat-label">Total</span></div>
            <div class="stat-card open"><span class="stat-num">${open}</span><span class="stat-label">Open</span></div>
            <div class="stat-card investigating"><span class="stat-num">${investigating}</span><span class="stat-label">Investigating</span></div>
            <div class="stat-card resolved"><span class="stat-num">${resolved}</span><span class="stat-label">Resolved</span></div>
            <div class="stat-card closed"><span class="stat-num">${closed}</span><span class="stat-label">Closed</span></div>
        `;
    }

    // ── Filter + Render ──
    function getFiltered() {
        let list = [...allComplaints];
        const status = filterStatus?.value;
        const type = filterType?.value;
        const severity = filterSeverity?.value;
        const search = searchInput?.value?.toLowerCase().trim();

        if (status) list = list.filter(c => c.status === status);
        if (type) list = list.filter(c => c.complaintType === type);
        if (severity) list = list.filter(c => c.severity === severity);
        if (search) list = list.filter(c =>
            (c.name || '').toLowerCase().includes(search) ||
            (c.email || '').toLowerCase().includes(search) ||
            (c.complaintRef || '').toLowerCase().includes(search) ||
            (c.jobRef || '').toLowerCase().includes(search) ||
            (c.description || '').toLowerCase().includes(search)
        );

        return list.sort((a, b) => {
            const priority = { critical: 0, major: 1, moderate: 2, minor: 3 };
            const statusPri = { open: 0, investigating: 1, resolved: 2, closed: 3 };
            if (statusPri[a.status] !== statusPri[b.status]) return statusPri[a.status] - statusPri[b.status];
            return (priority[a.severity] || 9) - (priority[b.severity] || 9);
        });
    }

    function renderComplaints() {
        const list = getFiltered();
        if (!list.length) {
            listEl.innerHTML = '<div class="adm-empty">No complaints found matching your filters.</div>';
            return;
        }

        const severityBadge = s => {
            const colors = { minor: '#4CAF50', moderate: '#FF9800', major: '#F44336', critical: '#9C27B0' };
            return `<span class="severity-badge" style="background:${colors[s] || '#999'}">${(s || 'unknown').toUpperCase()}</span>`;
        };

        const statusBadge = s => {
            const colors = { open: '#F44336', investigating: '#FF9800', resolved: '#4CAF50', closed: '#9E9E9E' };
            return `<span class="status-badge" style="background:${colors[s] || '#999'}">${(s || 'unknown').toUpperCase()}</span>`;
        };

        const typeBadge = t => t === 'subscriber'
            ? '<span class="type-badge subscriber"><i class="fas fa-sync-alt"></i> Subscriber</span>'
            : '<span class="type-badge single"><i class="fas fa-receipt"></i> One-Off</span>';

        listEl.innerHTML = list.map(c => `
            <div class="complaint-card ${c.status}" data-id="${c.complaintRef}">
                <div class="complaint-card-header">
                    <div class="complaint-card-badges">
                        ${typeBadge(c.complaintType)}
                        ${severityBadge(c.severity)}
                        ${statusBadge(c.status)}
                    </div>
                    <span class="complaint-ref">${c.complaintRef || '—'}</span>
                </div>
                <div class="complaint-card-body">
                    <div class="complaint-meta">
                        <span><i class="fas fa-user"></i> ${c.name || 'Unknown'}</span>
                        <span><i class="fas fa-tools"></i> ${c.service || '—'}</span>
                        <span><i class="fas fa-calendar"></i> ${c.serviceDate || '—'}</span>
                        ${c.amountPaid ? '<span><i class="fas fa-pound-sign"></i> £' + c.amountPaid + '</span>' : ''}
                    </div>
                    <p class="complaint-desc">${(c.description || '').substring(0, 120)}${(c.description || '').length > 120 ? '...' : ''}</p>
                </div>
                <div class="complaint-card-actions">
                    <button class="btn-sm btn-view" onclick="viewComplaint('${c.complaintRef}')"><i class="fas fa-eye"></i> View</button>
                    ${c.status !== 'resolved' && c.status !== 'closed' ? `<button class="btn-sm btn-resolve" onclick="resolveComplaint('${c.complaintRef}')"><i class="fas fa-check"></i> Resolve</button>` : ''}
                </div>
            </div>
        `).join('');
    }

    // ── View complaint detail ──
    window.viewComplaint = function(ref) {
        const c = allComplaints.find(x => x.complaintRef === ref);
        if (!c) return;

        const photosHtml = c.photoLinks && c.photoLinks.length
            ? `<div class="detail-photos">${c.photoLinks.map(url => `<a href="${url}" target="_blank"><img src="${url}" alt="Evidence"></a>`).join('')}</div>`
            : '<p style="color:#999;">No photos submitted</p>';

        const resolutionHtml = c.resolution
            ? `<div class="resolution-result">
                <h4><i class="fas fa-check-circle" style="color:#4CAF50;"></i> Resolution Applied</h4>
                <p><strong>Type:</strong> ${c.resolutionType || '—'}</p>
                <p><strong>Amount/Discount:</strong> ${c.resolutionValue || '—'}</p>
                <p><strong>Notes:</strong> ${c.resolutionNotes || '—'}</p>
                <p><strong>Resolved by:</strong> Management on ${c.resolvedDate || '—'}</p>
               </div>`
            : '';

        modalBody.innerHTML = `
            <div class="complaint-detail">
                <div class="detail-header">
                    <h3>${c.complaintRef}</h3>
                    <div>
                        <span class="type-badge ${c.complaintType}">${c.complaintType === 'subscriber' ? '<i class="fas fa-sync-alt"></i> Subscriber' : '<i class="fas fa-receipt"></i> One-Off'}</span>
                        <span class="severity-badge" style="background:${{minor:'#4CAF50',moderate:'#FF9800',major:'#F44336',critical:'#9C27B0'}[c.severity] || '#999'}">${(c.severity || '').toUpperCase()}</span>
                        <span class="status-badge" style="background:${{open:'#F44336',investigating:'#FF9800',resolved:'#4CAF50',closed:'#9E9E9E'}[c.status] || '#999'}">${(c.status || '').toUpperCase()}</span>
                    </div>
                </div>

                <div class="detail-grid">
                    <div class="detail-item"><label>Customer</label><span>${c.name || '—'}</span></div>
                    <div class="detail-item"><label>Email</label><span><a href="mailto:${c.email}">${c.email || '—'}</a></span></div>
                    <div class="detail-item"><label>Phone</label><span>${c.phone ? '<a href="tel:' + c.phone + '">' + c.phone + '</a>' : '—'}</span></div>
                    <div class="detail-item"><label>Job Reference</label><span>${c.jobRef || '—'}</span></div>
                    <div class="detail-item"><label>Service</label><span>${c.service || '—'}</span></div>
                    <div class="detail-item"><label>Service Date</label><span>${c.serviceDate || '—'}</span></div>
                    <div class="detail-item"><label>Amount Paid</label><span>${c.amountPaid ? '£' + c.amountPaid : '—'}</span></div>
                    <div class="detail-item"><label>Desired Resolution</label><span>${c.desiredResolution || '—'}</span></div>
                    ${c.complaintType === 'subscriber' ? `
                        <div class="detail-item"><label>Package</label><span>${c.package || '—'}</span></div>
                        <div class="detail-item"><label>Subscription ID</label><span>${c.subscriptionId || '—'}</span></div>
                    ` : ''}
                </div>

                <div class="detail-description">
                    <h4>Description</h4>
                    <p>${(c.description || '').replace(/\n/g, '<br>')}</p>
                </div>

                <div class="detail-section">
                    <h4>Photos / Evidence</h4>
                    ${photosHtml}
                </div>

                ${resolutionHtml}

                <div class="detail-section">
                    <h4>Admin Notes</h4>
                    <textarea id="adminComplaintNotes" rows="3" placeholder="Add internal notes...">${c.adminNotes || ''}</textarea>
                    <button class="btn btn-sm" onclick="saveComplaintNotes('${c.complaintRef}')"><i class="fas fa-save"></i> Save Notes</button>
                </div>

                <div class="detail-actions">
                    <h4>Update Status</h4>
                    <div class="action-btns">
                        <button class="btn-action investigating" onclick="updateComplaintStatus('${c.complaintRef}', 'investigating')"><i class="fas fa-search"></i> Investigating</button>
                        <button class="btn-action resolve" onclick="resolveComplaint('${c.complaintRef}')"><i class="fas fa-check"></i> Resolve</button>
                        <button class="btn-action close" onclick="updateComplaintStatus('${c.complaintRef}', 'closed')"><i class="fas fa-times"></i> Close</button>
                    </div>
                </div>
            </div>
        `;
        modal.style.display = 'flex';
    };

    // ── Resolve complaint (shows resolution form) ──
    window.resolveComplaint = function(ref) {
        const c = allComplaints.find(x => x.complaintRef === ref);
        if (!c) return;

        const isSubscriber = c.complaintType === 'subscriber';
        const amountPaid = parseFloat(c.amountPaid) || 0;

        let resolutionOptions = '';
        if (isSubscriber) {
            resolutionOptions = `
                <div class="resolution-form">
                    <h3><i class="fas fa-sync-alt"></i> Subscriber Resolution</h3>
                    <p>Customer: <strong>${c.name}</strong> | Package: <strong>${c.package || 'N/A'}</strong></p>
                    <div class="form-group">
                        <label>Resolution Type</label>
                        <select id="resolveType">
                            <option value="discount-10">10% discount on next visit</option>
                            <option value="discount-15">15% discount on next visit</option>
                            <option value="discount-20">20% discount on next visit</option>
                            <option value="discount-25">25% discount on next visit</option>
                            <option value="discount-30">30% discount on next visit</option>
                            <option value="discount-50">50% discount on next visit</option>
                            <option value="free-visit">Free return visit</option>
                            <option value="credit">Account credit</option>
                            <option value="apology">Formal apology only</option>
                        </select>
                    </div>
                    <div class="form-group" id="creditAmountGroup" style="display:none;">
                        <label>Credit Amount (£)</label>
                        <input type="number" id="resolveCreditAmount" min="0" step="0.01" placeholder="e.g. 15.00">
                    </div>
                    <div class="form-group">
                        <label>Resolution Notes</label>
                        <textarea id="resolveNotes" rows="3" placeholder="Explain the resolution decision..."></textarea>
                    </div>
                    <div class="form-group consent-check">
                        <label><input type="checkbox" id="resolveNotify" checked> Email customer with resolution details</label>
                    </div>
                    <button class="btn btn-primary" onclick="submitResolution('${ref}')"><i class="fas fa-check"></i> Approve & Apply Resolution</button>
                </div>
            `;
        } else {
            resolutionOptions = `
                <div class="resolution-form">
                    <h3><i class="fas fa-receipt"></i> One-Off Job Resolution</h3>
                    <p>Customer: <strong>${c.name}</strong> | Amount Paid: <strong>£${amountPaid.toFixed(2)}</strong></p>
                    <div class="form-group">
                        <label>Refund Percentage</label>
                        <select id="resolveType" onchange="updateRefundPreview(${amountPaid})">
                            <option value="refund-10">10% refund (£${(amountPaid * 0.10).toFixed(2)})</option>
                            <option value="refund-15">15% refund (£${(amountPaid * 0.15).toFixed(2)})</option>
                            <option value="refund-20">20% refund (£${(amountPaid * 0.20).toFixed(2)})</option>
                            <option value="refund-25" selected>25% refund (£${(amountPaid * 0.25).toFixed(2)})</option>
                            <option value="refund-30">30% refund (£${(amountPaid * 0.30).toFixed(2)})</option>
                            <option value="refund-50">50% refund (£${(amountPaid * 0.50).toFixed(2)})</option>
                            <option value="refund-75">75% refund (£${(amountPaid * 0.75).toFixed(2)})</option>
                            <option value="refund-100">100% full refund (£${amountPaid.toFixed(2)})</option>
                            <option value="redo">Free redo / return visit (no refund)</option>
                            <option value="apology">Formal apology only (no refund)</option>
                        </select>
                    </div>
                    <div class="refund-preview" id="refundPreview">
                        <strong>Refund amount: £${(amountPaid * 0.25).toFixed(2)}</strong>
                    </div>
                    <div class="form-group">
                        <label>Resolution Notes</label>
                        <textarea id="resolveNotes" rows="3" placeholder="Explain the resolution decision..."></textarea>
                    </div>
                    <div class="form-group consent-check">
                        <label><input type="checkbox" id="resolveNotify" checked> Email customer with resolution details</label>
                    </div>
                    <button class="btn btn-primary" onclick="submitResolution('${ref}')"><i class="fas fa-check"></i> Approve & Apply Resolution</button>
                </div>
            `;
        }

        modalBody.innerHTML = resolutionOptions;
        modal.style.display = 'flex';

        // Show/hide credit amount for subscriber credit option
        const resolveTypeEl = document.getElementById('resolveType');
        if (resolveTypeEl && isSubscriber) {
            resolveTypeEl.addEventListener('change', () => {
                const creditGroup = document.getElementById('creditAmountGroup');
                if (creditGroup) creditGroup.style.display = resolveTypeEl.value === 'credit' ? 'block' : 'none';
            });
        }
    };

    window.updateRefundPreview = function(amountPaid) {
        const type = document.getElementById('resolveType').value;
        const preview = document.getElementById('refundPreview');
        if (!preview) return;
        const match = type.match(/refund-(\d+)/);
        if (match) {
            const pct = parseInt(match[1]);
            preview.innerHTML = `<strong>Refund amount: £${(amountPaid * pct / 100).toFixed(2)} (${pct}%)</strong>`;
        } else if (type === 'redo') {
            preview.innerHTML = '<strong>Return visit — no monetary refund</strong>';
        } else {
            preview.innerHTML = '<strong>No refund</strong>';
        }
    };

    // ── Submit resolution ──
    window.submitResolution = async function(ref) {
        const resolveType = document.getElementById('resolveType').value;
        const resolveNotes = document.getElementById('resolveNotes').value.trim();
        const notifyCustomer = document.getElementById('resolveNotify')?.checked;
        const creditAmount = document.getElementById('resolveCreditAmount')?.value || '';

        if (!resolveNotes) {
            alert('Please add resolution notes explaining the decision.');
            return;
        }

        try {
            const res = await fetch(GAS, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify({
                    action: 'resolve_complaint',
                    complaintRef: ref,
                    resolutionType: resolveType,
                    resolutionNotes: resolveNotes,
                    notifyCustomer: notifyCustomer,
                    creditAmount: creditAmount
                })
            });
            const result = await res.json();
            if (result.status === 'success') {
                alert('Resolution applied successfully!');
                modal.style.display = 'none';
                loadComplaints();
            } else {
                alert('Error: ' + (result.message || 'Failed to apply resolution'));
            }
        } catch(err) {
            alert('Network error: ' + err.message);
        }
    };

    // ── Update status ──
    window.updateComplaintStatus = async function(ref, newStatus) {
        try {
            const res = await fetch(GAS, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify({
                    action: 'update_complaint_status',
                    complaintRef: ref,
                    status: newStatus
                })
            });
            const result = await res.json();
            if (result.status === 'success') {
                modal.style.display = 'none';
                loadComplaints();
            } else {
                alert('Error: ' + (result.message || 'Failed'));
            }
        } catch(err) {
            alert('Network error: ' + err.message);
        }
    };

    // ── Save notes ──
    window.saveComplaintNotes = async function(ref) {
        const notes = document.getElementById('adminComplaintNotes')?.value || '';
        try {
            await fetch(GAS, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify({
                    action: 'update_complaint_notes',
                    complaintRef: ref,
                    notes: notes
                })
            });
            alert('Notes saved!');
        } catch(err) {
            alert('Error saving notes: ' + err.message);
        }
    };

    // ── Close modal ──
    if (closeModalBtn) closeModalBtn.addEventListener('click', () => modal.style.display = 'none');
    if (modal) modal.addEventListener('click', e => { if (e.target === modal) modal.style.display = 'none'; });

    // ── Filters ──
    [filterStatus, filterType, filterSeverity].forEach(el => {
        if (el) el.addEventListener('change', renderComplaints);
    });
    if (searchInput) searchInput.addEventListener('input', renderComplaints);
    if (refreshBtn) refreshBtn.addEventListener('click', loadComplaints);

    // ── Init ──
    loadComplaints();

})();
