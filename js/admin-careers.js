/* ============================================
   Gardners Ground Maintenance — Admin Careers JS
   Manage vacancies, review applications
   ============================================ */

document.addEventListener('DOMContentLoaded', () => {

    const GAS = 'https://script.google.com/macros/s/AKfycbwlPTDcEQzKG-1yEFjE7AyrL6fpzIQsf0xCnJDeOFB0u7tU8q2EjzH6PRpnEeHjaVg_/exec';

    // --- DOM ---
    const vacForm = document.getElementById('vacancyForm');
    const vacSubmitBtn = document.getElementById('vacSubmitBtn');
    const vacClearBtn = document.getElementById('vacClearBtn');
    const vacRefreshBtn = document.getElementById('vacRefreshBtn');
    const vacLoading = document.getElementById('vacLoading');
    const vacList = document.getElementById('vacList');
    const vacEmpty = document.getElementById('vacEmpty');

    const appRefreshBtn = document.getElementById('appRefreshBtn');
    const appFilterPosition = document.getElementById('appFilterPosition');
    const appFilterStatus = document.getElementById('appFilterStatus');
    const appLoading = document.getElementById('appLoading');
    const appList = document.getElementById('appList');
    const appEmpty = document.getElementById('appEmpty');

    const appModal = document.getElementById('appModal');
    const appModalClose = document.getElementById('appModalClose');
    const appModalBody = document.getElementById('appModalBody');
    const appModalTitle = document.getElementById('appModalTitle');
    const appStatusSelect = document.getElementById('appStatusSelect');
    const appUpdateStatusBtn = document.getElementById('appUpdateStatusBtn');
    const appDownloadCVBtn = document.getElementById('appDownloadCVBtn');
    const appEmailBtn = document.getElementById('appEmailBtn');
    const appCallBtn = document.getElementById('appCallBtn');

    let allVacancies = [];
    let allApplications = [];
    let currentApp = null;
    let editingVacancyId = null;


    // ============================================
    // VACANCIES
    // ============================================

    async function loadVacancies() {
        vacLoading.style.display = 'block';
        vacList.style.display = 'none';
        vacEmpty.style.display = 'none';

        try {
            const resp = await fetch(GAS + '?action=get_all_vacancies');
            const data = await resp.json();

            if (data.status === 'success' && data.vacancies) {
                allVacancies = data.vacancies;
                renderVacancies();
                updatePositionFilter();
            } else {
                vacEmpty.style.display = 'block';
            }
        } catch (e) {
            console.error('Load vacancies failed:', e);
            vacEmpty.style.display = 'block';
        }

        vacLoading.style.display = 'none';
    }

    function renderVacancies() {
        if (allVacancies.length === 0) {
            vacList.style.display = 'none';
            vacEmpty.style.display = 'block';
            return;
        }

        vacEmpty.style.display = 'none';
        vacList.style.display = 'block';

        vacList.innerHTML = allVacancies.map(v => {
            const statusColor = v.status === 'Open' ? '#2E7D32' : v.status === 'Draft' ? '#FF8F00' : '#e53935';
            const posted = v.postedDate ? new Date(v.postedDate).toLocaleDateString('en-GB') : '—';

            return `
                <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 16px;border:1px solid #eee;border-radius:10px;margin-bottom:8px;background:#fafafa;">
                    <div>
                        <strong>${esc(v.title)}</strong>
                        <span style="display:inline-block;padding:2px 10px;border-radius:12px;font-size:11px;font-weight:600;color:#fff;background:${statusColor};margin-left:8px;">${esc(v.status)}</span>
                        <div style="font-size:13px;color:#666;margin-top:4px;">
                            ${v.type} · ${v.location || 'Cornwall'} ${v.salary ? ' · ' + v.salary : ''} · Posted ${posted}
                        </div>
                    </div>
                    <div style="display:flex;gap:6px;">
                        <button class="btn btn-sm btn-outline-green" onclick="window.editVacancy('${v.id}')"><i class="fas fa-edit"></i></button>
                        <button class="btn btn-sm" style="background:#e53935;color:#fff;" onclick="window.removeVacancy('${v.id}','${esc(v.title)}')"><i class="fas fa-trash"></i></button>
                    </div>
                </div>
            `;
        }).join('');
    }

    // Post vacancy
    vacForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const title = document.getElementById('vacTitle').value.trim();
        const description = document.getElementById('vacDescription').value.trim();
        if (!title || !description) {
            alert('Title and description are required.');
            return;
        }

        vacSubmitBtn.disabled = true;
        vacSubmitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Posting...';

        const payload = {
            action: 'post_vacancy',
            title: title,
            type: document.getElementById('vacType').value,
            location: document.getElementById('vacLocation').value.trim(),
            salary: document.getElementById('vacSalary').value.trim(),
            description: description,
            requirements: document.getElementById('vacRequirements').value.trim(),
            closingDate: document.getElementById('vacClosingDate').value,
            status: document.getElementById('vacStatus').value
        };

        if (editingVacancyId) {
            payload.vacancyId = editingVacancyId;
        }

        try {
            const resp = await fetch(GAS, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain' },
                body: JSON.stringify(payload)
            });
            const result = await resp.json();

            if (result.status === 'success') {
                vacForm.reset();
                document.getElementById('vacLocation').value = 'Cornwall';
                editingVacancyId = null;
                vacSubmitBtn.innerHTML = '<i class="fas fa-check"></i> Posted!';
                setTimeout(() => {
                    vacSubmitBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Post Vacancy';
                    vacSubmitBtn.disabled = false;
                }, 1500);
                loadVacancies();
            } else {
                alert('Error: ' + (result.message || 'Unknown'));
                vacSubmitBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Post Vacancy';
                vacSubmitBtn.disabled = false;
            }
        } catch (err) {
            alert('Failed to post vacancy: ' + err.message);
            vacSubmitBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Post Vacancy';
            vacSubmitBtn.disabled = false;
        }
    });

    // Edit vacancy
    window.editVacancy = function(id) {
        const v = allVacancies.find(x => x.id === id);
        if (!v) return;

        editingVacancyId = id;
        document.getElementById('vacTitle').value = v.title || '';
        document.getElementById('vacType').value = v.type || 'Full-time';
        document.getElementById('vacLocation').value = v.location || 'Cornwall';
        document.getElementById('vacSalary').value = v.salary || '';
        document.getElementById('vacDescription').value = v.description || '';
        document.getElementById('vacRequirements').value = v.requirements || '';
        document.getElementById('vacClosingDate').value = v.closingDate ? v.closingDate.split('T')[0] : '';
        document.getElementById('vacStatus').value = v.status || 'Open';

        vacSubmitBtn.innerHTML = '<i class="fas fa-save"></i> Update Vacancy';
        document.getElementById('vacTitle').scrollIntoView({ behavior: 'smooth' });
    };

    // Delete vacancy
    window.removeVacancy = async function(id, title) {
        if (!confirm('Delete vacancy "' + title + '"?')) return;

        try {
            const resp = await fetch(GAS, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain' },
                body: JSON.stringify({ action: 'delete_vacancy', vacancyId: id })
            });
            const result = await resp.json();
            if (result.status === 'success') {
                loadVacancies();
            } else {
                alert('Error: ' + (result.message || 'Unknown'));
            }
        } catch (err) {
            alert('Delete failed: ' + err.message);
        }
    };

    // Clear form
    vacClearBtn.addEventListener('click', () => {
        vacForm.reset();
        document.getElementById('vacLocation').value = 'Cornwall';
        editingVacancyId = null;
        vacSubmitBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Post Vacancy';
    });

    vacRefreshBtn.addEventListener('click', loadVacancies);


    // ============================================
    // APPLICATIONS
    // ============================================

    async function loadApplications() {
        appLoading.style.display = 'block';
        appList.style.display = 'none';
        appEmpty.style.display = 'none';

        try {
            const resp = await fetch(GAS + '?action=get_applications');
            const data = await resp.json();

            if (data.status === 'success' && data.applications) {
                allApplications = data.applications;
                renderApplications();
            } else {
                appEmpty.style.display = 'block';
            }
        } catch (e) {
            console.error('Load applications failed:', e);
            appEmpty.style.display = 'block';
        }

        appLoading.style.display = 'none';
    }

    function renderApplications() {
        const posFilter = appFilterPosition.value;
        const statusFilter = appFilterStatus.value;

        let filtered = allApplications.filter(a => {
            if (posFilter && a.position !== posFilter) return false;
            if (statusFilter && a.status !== statusFilter) return false;
            return true;
        });

        // Newest first
        filtered.sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));

        if (filtered.length === 0) {
            appList.style.display = 'none';
            appEmpty.style.display = 'block';
            return;
        }

        appEmpty.style.display = 'none';
        appList.style.display = 'block';

        appList.innerHTML = filtered.map(a => {
            const name = ((a.firstName || '') + ' ' + (a.lastName || '')).trim();
            const date = a.timestamp ? new Date(a.timestamp).toLocaleDateString('en-GB') : '—';
            const statusColors = {
                'New': '#1565C0', 'Reviewed': '#FF8F00', 'Shortlisted': '#2E7D32',
                'Interview': '#7B1FA2', 'Offered': '#00838F', 'Rejected': '#e53935'
            };
            const sc = statusColors[a.status] || '#999';

            return `
                <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 16px;border:1px solid #eee;border-radius:10px;margin-bottom:8px;background:#fafafa;cursor:pointer;" onclick="window.openApplication('${a.id}')">
                    <div>
                        <strong>${esc(name)}</strong>
                        <span style="display:inline-block;padding:2px 10px;border-radius:12px;font-size:11px;font-weight:600;color:#fff;background:${sc};margin-left:8px;">${esc(a.status || 'New')}</span>
                        <div style="font-size:13px;color:#666;margin-top:4px;">
                            ${esc(a.position)} · ${esc(a.postcode || '—')} · Applied ${date}
                            ${a.cvFileId ? ' · <i class="fas fa-paperclip" style="color:#2E7D32;"></i> CV' : ''}
                        </div>
                    </div>
                    <i class="fas fa-chevron-right" style="color:#ccc;"></i>
                </div>
            `;
        }).join('');
    }

    function updatePositionFilter() {
        const positions = [...new Set(allVacancies.map(v => v.title))];
        const specPositions = [...new Set(allApplications.map(a => a.position))];
        const allPositions = [...new Set([...positions, ...specPositions])];

        // Keep first option
        appFilterPosition.innerHTML = '<option value="">All Positions</option>';
        allPositions.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p;
            opt.textContent = p;
            appFilterPosition.appendChild(opt);
        });
    }

    appFilterPosition.addEventListener('change', renderApplications);
    appFilterStatus.addEventListener('change', renderApplications);
    appRefreshBtn.addEventListener('click', loadApplications);

    // Open application detail modal
    window.openApplication = function(id) {
        const app = allApplications.find(a => a.id === id);
        if (!app) return;
        currentApp = app;

        const name = ((app.firstName || '') + ' ' + (app.lastName || '')).trim();
        appModalTitle.innerHTML = '<i class="fas fa-user"></i> ' + esc(name);
        appStatusSelect.value = app.status || 'New';

        appModalBody.innerHTML = `
            <div style="display:grid;gap:1rem;">
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
                    <div><label style="font-weight:600;font-size:13px;color:#666;">Position</label><p style="margin:4px 0;">${esc(app.position)}</p></div>
                    <div><label style="font-weight:600;font-size:13px;color:#666;">Applied</label><p style="margin:4px 0;">${app.timestamp ? new Date(app.timestamp).toLocaleString('en-GB') : '—'}</p></div>
                </div>
                <hr style="border:none;border-top:1px solid #eee;">
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
                    <div><label style="font-weight:600;font-size:13px;color:#666;">Email</label><p style="margin:4px 0;"><a href="mailto:${esc(app.email)}">${esc(app.email)}</a></p></div>
                    <div><label style="font-weight:600;font-size:13px;color:#666;">Phone</label><p style="margin:4px 0;"><a href="tel:${esc(app.phone)}">${esc(app.phone)}</a></p></div>
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
                    <div><label style="font-weight:600;font-size:13px;color:#666;">Postcode</label><p style="margin:4px 0;">${esc(app.postcode)}</p></div>
                    <div><label style="font-weight:600;font-size:13px;color:#666;">Date of Birth</label><p style="margin:4px 0;">${app.dob || '—'}</p></div>
                </div>
                <hr style="border:none;border-top:1px solid #eee;">
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
                    <div><label style="font-weight:600;font-size:13px;color:#666;">Available From</label><p style="margin:4px 0;">${app.availableFrom || '—'}</p></div>
                    <div><label style="font-weight:600;font-size:13px;color:#666;">Preferred Hours</label><p style="margin:4px 0;">${esc(app.preferredHours || '—')}</p></div>
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
                    <div><label style="font-weight:600;font-size:13px;color:#666;">Driving Licence</label><p style="margin:4px 0;">${esc(app.drivingLicence || '—')}</p></div>
                    <div><label style="font-weight:600;font-size:13px;color:#666;">Own Transport</label><p style="margin:4px 0;">${esc(app.ownTransport || '—')}</p></div>
                </div>
                ${app.experience ? `<div><label style="font-weight:600;font-size:13px;color:#666;">Experience</label><p style="margin:4px 0;white-space:pre-wrap;">${esc(app.experience)}</p></div>` : ''}
                ${app.qualifications ? `<div><label style="font-weight:600;font-size:13px;color:#666;">Qualifications</label><p style="margin:4px 0;white-space:pre-wrap;">${esc(app.qualifications)}</p></div>` : ''}
                ${app.message ? `<div><label style="font-weight:600;font-size:13px;color:#666;">Cover Message</label><p style="margin:4px 0;white-space:pre-wrap;">${esc(app.message)}</p></div>` : ''}
                ${app.cvFileId ? `<div style="padding:10px;background:#E8F5E9;border-radius:8px;margin-top:4px;"><i class="fas fa-paperclip" style="color:#2E7D32;"></i> CV uploaded: <strong>${esc(app.cvFileName || 'File')}</strong></div>` : '<div style="padding:10px;background:#FFF3E0;border-radius:8px;margin-top:4px;"><i class="fas fa-info-circle" style="color:#FF8F00;"></i> No CV uploaded</div>'}
                <div>
                    <label style="font-weight:600;font-size:13px;color:#666;">Admin Notes</label>
                    <textarea id="appNotesTA" rows="2" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:8px;font-size:14px;margin-top:4px;" placeholder="Internal notes about this candidate...">${esc(app.notes || '')}</textarea>
                </div>
            </div>
        `;

        // Wire up buttons
        appDownloadCVBtn.style.display = app.cvFileId ? 'inline-flex' : 'none';
        appDownloadCVBtn.onclick = () => {
            if (app.cvFileId) window.open('https://drive.google.com/file/d/' + app.cvFileId + '/view', '_blank');
        };
        appEmailBtn.onclick = () => {
            if (app.email) window.open('mailto:' + app.email);
        };
        appCallBtn.onclick = () => {
            if (app.phone) window.open('tel:' + app.phone);
        };

        appModal.style.display = 'flex';
    };

    // Update application status
    appUpdateStatusBtn.addEventListener('click', async () => {
        if (!currentApp) return;

        appUpdateStatusBtn.disabled = true;
        appUpdateStatusBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';

        const notes = document.getElementById('appNotesTA') ? document.getElementById('appNotesTA').value : '';

        try {
            const resp = await fetch(GAS, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain' },
                body: JSON.stringify({
                    action: 'update_application_status',
                    applicationId: currentApp.id,
                    status: appStatusSelect.value,
                    notes: notes
                })
            });
            const result = await resp.json();

            if (result.status === 'success') {
                currentApp.status = appStatusSelect.value;
                currentApp.notes = notes;
                renderApplications();
                appUpdateStatusBtn.innerHTML = '<i class="fas fa-check"></i> Saved!';
                setTimeout(() => {
                    appUpdateStatusBtn.innerHTML = '<i class="fas fa-save"></i> Update Status';
                    appUpdateStatusBtn.disabled = false;
                }, 1500);
            } else {
                alert('Error: ' + (result.message || 'Unknown'));
                appUpdateStatusBtn.innerHTML = '<i class="fas fa-save"></i> Update Status';
                appUpdateStatusBtn.disabled = false;
            }
        } catch (err) {
            alert('Update failed: ' + err.message);
            appUpdateStatusBtn.innerHTML = '<i class="fas fa-save"></i> Update Status';
            appUpdateStatusBtn.disabled = false;
        }
    });

    // Close modal
    appModalClose.addEventListener('click', () => { appModal.style.display = 'none'; currentApp = null; });
    appModal.addEventListener('click', (e) => { if (e.target === appModal) { appModal.style.display = 'none'; currentApp = null; } });

    function esc(str) {
        const div = document.createElement('div');
        div.textContent = str || '';
        return div.innerHTML;
    }


    // ============================================
    // INIT — Load when Careers tab opens
    // ============================================

    let careersLoaded = false;

    // Watch for tab switches (uses existing admin tab system in admin-hub.js)
    const observer = new MutationObserver(() => {
        const panel = document.getElementById('panelCareers');
        if (panel && panel.classList.contains('active') && !careersLoaded) {
            careersLoaded = true;
            loadVacancies();
            loadApplications();
        }
    });

    const panel = document.getElementById('panelCareers');
    if (panel) {
        observer.observe(panel, { attributes: true, attributeFilter: ['class'] });
    }

    // Also handle if user navigates directly to careers tab
    if (panel && panel.classList.contains('active')) {
        loadVacancies();
        loadApplications();
        careersLoaded = true;
    }
});
