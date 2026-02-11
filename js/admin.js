/* ============================================
   Gardners Ground Maintenance — Admin Dashboard JS
   Client management, distance tracking,
   day planner, Excel export
   ============================================ */

document.addEventListener('DOMContentLoaded', () => {

    // --- Google Sheets webhook ---
    const SHEETS_WEBHOOK = 'https://script.google.com/macros/s/AKfycbxMOG1s0F2rUG3EBdaJ1R1x1ofkHjyYqxoBaKTZKVnpvr2g_o2NYSySXU6d8EKkdb0ayg/exec';

    // --- Storage key ---
    const STORAGE_KEY = 'ggm_clients';

    // --- Load/Save clients ---
    function loadClients() {
        try {
            return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
        } catch { return []; }
    }

    function saveClients(clients) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(clients));
    }

    let clients = loadClients();

    // --- DOM Elements ---
    const tableBody = document.getElementById('clientTableBody');
    const modal = document.getElementById('clientModal');
    const modalTitle = document.getElementById('modalTitle');
    const form = document.getElementById('clientForm');
    const deleteBtn = document.getElementById('deleteClientBtn');
    const searchInput = document.getElementById('clientSearch');
    const dayPlannerContent = document.getElementById('dayPlannerContent');
    const dayPlannerSummary = document.getElementById('dayPlannerSummary');

    // --- Stats ---
    function updateStats() {
        document.getElementById('statClients').textContent = clients.length;
        document.getElementById('statSubscribers').textContent = clients.filter(c => c.type !== 'one-off').length;
        document.getElementById('statBookings').textContent = clients.length; // Simplified count
        const withDist = clients.filter(c => c.distance);
        if (withDist.length > 0) {
            const avg = withDist.reduce((s, c) => s + c.distance, 0) / withDist.length;
            document.getElementById('statAvgDist').textContent = Math.round(avg * 10) / 10 + ' mi';
        } else {
            document.getElementById('statAvgDist').textContent = '—';
        }
    }

    // --- Render table ---
    let currentSort = { key: 'name', dir: 'asc' };
    let searchTerm = '';

    function renderTable() {
        let filtered = clients;
        if (searchTerm) {
            const q = searchTerm.toLowerCase();
            filtered = clients.filter(c =>
                (c.name || '').toLowerCase().includes(q) ||
                (c.postcode || '').toLowerCase().includes(q) ||
                (c.type || '').toLowerCase().includes(q) ||
                (c.day || '').toLowerCase().includes(q)
            );
        }

        // Sort
        filtered.sort((a, b) => {
            let av = a[currentSort.key] || '';
            let bv = b[currentSort.key] || '';
            if (currentSort.key === 'distance') {
                av = a.distance || 999;
                bv = b.distance || 999;
                return currentSort.dir === 'asc' ? av - bv : bv - av;
            }
            av = String(av).toLowerCase();
            bv = String(bv).toLowerCase();
            if (av < bv) return currentSort.dir === 'asc' ? -1 : 1;
            if (av > bv) return currentSort.dir === 'asc' ? 1 : -1;
            return 0;
        });

        if (filtered.length === 0) {
            tableBody.innerHTML = '<tr class="empty-row"><td colspan="7"><i class="fas fa-info-circle"></i> No clients found</td></tr>';
        } else {
            tableBody.innerHTML = filtered.map(c => {
                const typeLabel = {
                    'one-off': '<span class="badge badge-gray">One-off</span>',
                    'essential': '<span class="badge badge-green">Essential</span>',
                    'standard': '<span class="badge badge-blue">Standard</span>',
                    'premium': '<span class="badge badge-gold">Premium</span>'
                }[c.type] || c.type;

                const dist = c.distance ? `${c.distance} mi` : '—';
                const drive = c.driveMinutes ? DistanceUtil.formatDriveTime(c.driveMinutes) : '—';

                return `<tr data-id="${c.id}">
                    <td><strong>${esc(c.name)}</strong></td>
                    <td>${esc(c.postcode || '')}</td>
                    <td>${typeLabel}</td>
                    <td>${esc(c.day || '—')}</td>
                    <td>${dist}</td>
                    <td>${drive}</td>
                    <td>
                        <button class="btn-icon edit-client" data-id="${c.id}" title="Edit"><i class="fas fa-edit"></i></button>
                        ${c.googleMapsUrl ? `<a href="${c.googleMapsUrl}" target="_blank" class="btn-icon" title="Map"><i class="fas fa-map-marker-alt"></i></a>` : ''}
                    </td>
                </tr>`;
            }).join('');
        }
        updateStats();
    }

    function esc(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    // --- Sort ---
    document.querySelectorAll('.sortable').forEach(th => {
        th.addEventListener('click', () => {
            const key = th.dataset.sort;
            if (currentSort.key === key) {
                currentSort.dir = currentSort.dir === 'asc' ? 'desc' : 'asc';
            } else {
                currentSort = { key, dir: 'asc' };
            }
            renderTable();
        });
    });

    // --- Search ---
    searchInput.addEventListener('input', () => {
        searchTerm = searchInput.value.trim();
        renderTable();
    });

    // --- Modal ---
    function openModal(client = null) {
        form.reset();
        document.getElementById('modalDistance').style.display = 'none';

        if (client) {
            modalTitle.innerHTML = '<i class="fas fa-user-edit"></i> Edit Client';
            document.getElementById('clientId').value = client.id;
            document.getElementById('clientName').value = client.name || '';
            document.getElementById('clientEmail').value = client.email || '';
            document.getElementById('clientPhone').value = client.phone || '';
            document.getElementById('clientPostcode').value = client.postcode || '';
            document.getElementById('clientAddress').value = client.address || '';
            document.getElementById('clientType').value = client.type || 'one-off';
            document.getElementById('clientDay').value = client.day || '';
            document.getElementById('clientNotes').value = client.notes || '';
            deleteBtn.style.display = '';
            if (client.distance) {
                document.getElementById('modalDistText').innerHTML =
                    `<strong>${client.distance} miles</strong> · ~${DistanceUtil.formatDriveTime(client.driveMinutes)} drive`;
                document.getElementById('modalDistance').style.display = 'flex';
            }
        } else {
            modalTitle.innerHTML = '<i class="fas fa-user-plus"></i> Add Client';
            document.getElementById('clientId').value = '';
            deleteBtn.style.display = 'none';
        }
        modal.style.display = 'flex';
    }

    function closeModalFn() { modal.style.display = 'none'; }

    document.getElementById('addClientBtn').addEventListener('click', () => openModal());
    document.getElementById('closeModal').addEventListener('click', closeModalFn);
    modal.addEventListener('click', (e) => { if (e.target === modal) closeModalFn(); });

    // Edit client from table
    tableBody.addEventListener('click', (e) => {
        const btn = e.target.closest('.edit-client');
        if (btn) {
            const client = clients.find(c => c.id === btn.dataset.id);
            if (client) openModal(client);
        }
    });

    // --- Save client ---
    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const id = document.getElementById('clientId').value || `c_${Date.now()}`;
        const postcode = document.getElementById('clientPostcode').value.trim();

        // Get distance
        let distResult = null;
        if (postcode && typeof DistanceUtil !== 'undefined') {
            try { distResult = await DistanceUtil.distanceFromBase(postcode); } catch (e) {}
        }

        const clientData = {
            id,
            name: document.getElementById('clientName').value.trim(),
            email: document.getElementById('clientEmail').value.trim(),
            phone: document.getElementById('clientPhone').value.trim(),
            postcode,
            address: document.getElementById('clientAddress').value.trim(),
            type: document.getElementById('clientType').value,
            day: document.getElementById('clientDay').value,
            notes: document.getElementById('clientNotes').value.trim(),
            distance: distResult ? distResult.drivingMiles : null,
            driveMinutes: distResult ? distResult.driveMinutes : null,
            googleMapsUrl: distResult ? distResult.googleMapsUrl : null,
            updatedAt: new Date().toISOString()
        };

        const existingIndex = clients.findIndex(c => c.id === id);
        if (existingIndex >= 0) {
            clients[existingIndex] = { ...clients[existingIndex], ...clientData };
        } else {
            clientData.createdAt = new Date().toISOString();
            clients.push(clientData);
        }

        saveClients(clients);
        renderTable();
        closeModalFn();
        updateDayPlanner();
    });

    // --- Delete client ---
    deleteBtn.addEventListener('click', () => {
        const id = document.getElementById('clientId').value;
        if (id && confirm('Delete this client?')) {
            clients = clients.filter(c => c.id !== id);
            saveClients(clients);
            renderTable();
            closeModalFn();
            updateDayPlanner();
        }
    });

    // --- Postcode distance in modal ---
    const modalPostcode = document.getElementById('clientPostcode');
    modalPostcode.addEventListener('blur', async () => {
        const pc = modalPostcode.value.trim();
        if (pc.length < 5 || typeof DistanceUtil === 'undefined') return;
        try {
            const result = await DistanceUtil.distanceFromBase(pc);
            if (result) {
                document.getElementById('modalDistText').innerHTML =
                    `<strong>${result.drivingMiles} miles</strong> · ~${DistanceUtil.formatDriveTime(result.driveMinutes)} drive · <a href="${result.googleMapsUrl}" target="_blank" style="color:var(--primary);">Route</a>`;
                document.getElementById('modalDistance').style.display = 'flex';
            }
        } catch (e) {}
    });

    // --- Day Planner ---
    let selectedDay = 'Monday';

    document.querySelectorAll('.day-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.day-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            selectedDay = tab.dataset.day;
            updateDayPlanner();
        });
    });

    function updateDayPlanner() {
        const dayClients = clients
            .filter(c => c.day === selectedDay)
            .sort((a, b) => (a.distance || 999) - (b.distance || 999));

        if (dayClients.length === 0) {
            dayPlannerContent.innerHTML = '<p class="day-planner-empty"><i class="fas fa-inbox"></i> No jobs scheduled for ' + selectedDay + '</p>';
            dayPlannerSummary.style.display = 'none';
            return;
        }

        dayPlannerContent.innerHTML = dayClients.map((c, i) => {
            const typeLabel = { essential: 'Essential', standard: 'Standard', premium: 'Premium', 'one-off': 'One-off' }[c.type] || c.type;
            return `<div class="day-job-card">
                <div class="day-job-num">${i + 1}</div>
                <div class="day-job-info">
                    <strong>${esc(c.name)}</strong>
                    <span class="day-job-detail">${esc(c.address || '')}${c.postcode ? ', ' + esc(c.postcode) : ''}</span>
                    <span class="day-job-detail">${typeLabel} · ${c.distance ? c.distance + ' mi · ~' + DistanceUtil.formatDriveTime(c.driveMinutes) : 'No distance'}</span>
                </div>
                ${c.googleMapsUrl ? `<a href="${c.googleMapsUrl}" target="_blank" class="btn-icon" title="Navigate"><i class="fas fa-directions"></i></a>` : ''}
            </div>`;
        }).join('');

        // Summary
        const totalMiles = dayClients.reduce((s, c) => s + (c.distance || 0), 0);
        const totalDrive = dayClients.reduce((s, c) => s + (c.driveMinutes || 0), 0);
        document.getElementById('dayJobCount').textContent = dayClients.length;
        document.getElementById('dayTotalMiles').textContent = Math.round(totalMiles * 10) / 10;
        document.getElementById('dayTotalDrive').textContent = DistanceUtil.formatDriveTime(totalDrive);

        // Multi-stop route
        const postcodes = dayClients.filter(c => c.postcode).map(c => c.postcode);
        const routeUrl = DistanceUtil.buildRouteUrl(postcodes);
        if (routeUrl) {
            document.getElementById('dayRouteLink').href = routeUrl;
            document.getElementById('dayRouteLink').style.display = '';
        } else {
            document.getElementById('dayRouteLink').style.display = 'none';
        }
        dayPlannerSummary.style.display = 'flex';
    }

    // --- Route Planner button (today's day) ---
    document.getElementById('routePlannerBtn').addEventListener('click', () => {
        const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const today = days[new Date().getDay()];
        const tab = document.querySelector(`.day-tab[data-day="${today}"]`);
        if (tab) {
            tab.click();
            document.querySelector('.admin-day-planner').scrollIntoView({ behavior: 'smooth' });
        }
    });

    // --- Excel Export ---
    document.getElementById('exportExcelBtn').addEventListener('click', () => {
        if (typeof XLSX === 'undefined') {
            alert('Excel library not loaded. Please check your internet connection.');
            return;
        }
        if (clients.length === 0) {
            alert('No clients to export.');
            return;
        }

        const rows = clients.map(c => ({
            'Name': c.name,
            'Email': c.email || '',
            'Phone': c.phone || '',
            'Address': c.address || '',
            'Postcode': c.postcode || '',
            'Type': c.type || '',
            'Preferred Day': c.day || '',
            'Distance (miles)': c.distance || '',
            'Drive Time (min)': c.driveMinutes || '',
            'Notes': c.notes || '',
            'Google Maps': c.googleMapsUrl || '',
            'Added': c.createdAt ? new Date(c.createdAt).toLocaleDateString('en-GB') : '',
            'Updated': c.updatedAt ? new Date(c.updatedAt).toLocaleDateString('en-GB') : ''
        }));

        const ws = XLSX.utils.json_to_sheet(rows);

        // Column widths
        ws['!cols'] = [
            { wch: 20 }, { wch: 25 }, { wch: 15 }, { wch: 35 }, { wch: 10 },
            { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 30 },
            { wch: 50 }, { wch: 12 }, { wch: 12 }
        ];

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Clients');

        // Also add a sheet per day
        const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        days.forEach(day => {
            const dayClients = clients.filter(c => c.day === day).sort((a, b) => (a.distance || 999) - (b.distance || 999));
            if (dayClients.length > 0) {
                const dayRows = dayClients.map((c, i) => ({
                    '#': i + 1,
                    'Name': c.name,
                    'Address': (c.address || '') + ', ' + (c.postcode || ''),
                    'Phone': c.phone || '',
                    'Type': c.type || '',
                    'Distance': c.distance ? c.distance + ' mi' : '',
                    'Drive': c.driveMinutes ? DistanceUtil.formatDriveTime(c.driveMinutes) : '',
                    'Notes': c.notes || ''
                }));
                const dayWs = XLSX.utils.json_to_sheet(dayRows);
                dayWs['!cols'] = [{ wch: 4 }, { wch: 20 }, { wch: 35 }, { wch: 15 }, { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 30 }];
                XLSX.utils.book_append_sheet(wb, dayWs, day);
            }
        });

        const date = new Date().toISOString().slice(0, 10);
        XLSX.writeFile(wb, `GGM-Clients-${date}.xlsx`);
    });

    // --- Initial render ---
    renderTable();
    updateDayPlanner();
});
