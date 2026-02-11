/* ============================================
   Gardners Ground Maintenance — Job Manager JS
   Comprehensive job tracking with board/list/calendar views,
   status pipeline, photo upload with before/after comparison,
   lawn progress tracking. Data from Google Sheets,
   photos stored locally via IndexedDB.
   ============================================ */

document.addEventListener('DOMContentLoaded', () => {

    const SHEETS_WEBHOOK = 'https://script.google.com/macros/s/AKfycbxMOG1s0F2rUG3EBdaJ1R1x1ofkHjyYqxoBaKTZKVnpvr2g_o2NYSySXU6d8EKkdb0ayg/exec';
    const TELEGRAM_TOKEN = '8261874993:AAHW6752Ofhsrw6qzOSSZWnfmzbBj7G8Z-g';
    const TELEGRAM_CHAT  = '6200151295';

    let allJobs      = [];
    let filteredJobs  = [];
    let currentJob    = null;
    let currentView   = 'board';
    let calMonth      = new Date().getMonth();
    let calYear       = new Date().getFullYear();
    let db            = null; // IndexedDB for photos

    // ── DOM REFERENCES ──
    const loading      = document.getElementById('jmLoading');
    const boardView    = document.getElementById('jmBoardView');
    const listView     = document.getElementById('jmListView');
    const calendarView = document.getElementById('jmCalendarView');
    const emptyState   = document.getElementById('jmEmpty');
    const modal        = document.getElementById('jmModal');
    const lightbox     = document.getElementById('jmLightbox');


    // ============================================
    // INDEXEDDB — LOCAL-ONLY PHOTO STORAGE
    // ============================================
    function openPhotoDB() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open('GGM_JobPhotos', 2);
            req.onupgradeneeded = (e) => {
                const d = e.target.result;
                if (!d.objectStoreNames.contains('photos')) {
                    const store = d.createObjectStore('photos', { keyPath: 'id', autoIncrement: true });
                    store.createIndex('jobRow', 'jobRow', { unique: false });
                    store.createIndex('type', 'type', { unique: false });
                }
            };
            req.onsuccess = (e) => { db = e.target.result; resolve(db); };
            req.onerror   = (e) => { console.error('IndexedDB error:', e); reject(e); };
        });
    }

    function savePhoto(jobRow, type, dataUrl, caption) {
        return new Promise((resolve, reject) => {
            const tx    = db.transaction('photos', 'readwrite');
            const store = tx.objectStore('photos');
            store.add({ jobRow, type, dataUrl, caption: caption || '', timestamp: new Date().toISOString() });
            tx.oncomplete = () => resolve();
            tx.onerror    = (e) => reject(e);
        });
    }

    function getPhotosForJob(jobRow) {
        return new Promise((resolve, reject) => {
            const tx  = db.transaction('photos', 'readonly');
            const idx = tx.objectStore('photos').index('jobRow');
            const req = idx.getAll(jobRow);
            req.onsuccess = () => resolve(req.result || []);
            req.onerror   = (e) => reject(e);
        });
    }

    function deletePhoto(id) {
        return new Promise((resolve, reject) => {
            const tx = db.transaction('photos', 'readwrite');
            tx.objectStore('photos').delete(id);
            tx.oncomplete = () => resolve();
            tx.onerror    = (e) => reject(e);
        });
    }


    // ============================================
    // LOAD ALL JOBS FROM GOOGLE SHEETS
    // ============================================
    async function loadJobs() {
        showLoading(true);
        try {
            const resp = await fetch(SHEETS_WEBHOOK + '?action=get_clients');
            const data = await resp.json();
            if (data.status === 'success' && data.clients) {
                allJobs = data.clients.map(c => {
                    c.pipeStatus    = normalisePipeStatus(c.status, c.type);
                    c.isSubscription = (c.type || '').toLowerCase().includes('subscription');
                    c.isPaid = c.paid === 'Yes' || c.paid === 'Auto' ||
                               (c.paymentType || '').toLowerCase().includes('stripe');
                    c.isDeposit = c.paid === 'Deposit';
                    // Extract deposit info from notes
                    if (c.isDeposit && c.notes) {
                        const depMatch = (c.notes || '').match(/Deposit.*?\u00a3([\d.]+)/);
                        const remMatch = (c.notes || '').match(/Remaining.*?\u00a3([\d.]+)/);
                        c.depositAmount = depMatch ? depMatch[1] : '';
                        c.remainingBalance = remMatch ? remMatch[1] : '';
                    }
                    return c;
                });
                applyFilters();
                updateStats();
            } else {
                showMsg('Failed to load jobs');
            }
        } catch (e) {
            console.error(e);
            showMsg('Could not connect to Google Sheets');
        }
        showLoading(false);
    }

    function normalisePipeStatus(status, type) {
        const s = (status || '').toLowerCase().trim();
        if (s === 'cancelled' || s === 'canceled')    return 'cancelled';
        if (s === 'completed' || s === 'job completed') return 'completed';
        if (s === 'in progress')                       return 'in-progress';
        if (s === 'confirmed')                         return 'confirmed';
        if (s === 'succeeded')                         return 'confirmed';
        if (s === 'sent')                              return 'new';
        return 'new'; // Active, Pending, active, etc.
    }

    function showLoading(on) {
        loading.style.display       = on ? 'flex' : 'none';
        boardView.style.display     = on ? 'none' : boardView.style.display;
        listView.style.display      = on ? 'none' : listView.style.display;
        calendarView.style.display  = on ? 'none' : calendarView.style.display;
        if (on) emptyState.style.display = 'none';
    }

    function showMsg(msg) {
        emptyState.innerHTML = `<i class="fas fa-exclamation-triangle"></i><p>${msg}</p>`;
        emptyState.style.display = 'flex';
    }


    // ============================================
    // STATS
    // ============================================
    function updateStats() {
        const active = allJobs.filter(j => j.pipeStatus !== 'cancelled');
        document.getElementById('jmStatNew').textContent       = active.filter(j => j.pipeStatus === 'new').length;
        document.getElementById('jmStatConfirmed').textContent  = active.filter(j => j.pipeStatus === 'confirmed').length;
        document.getElementById('jmStatProgress').textContent   = active.filter(j => j.pipeStatus === 'in-progress').length;
        document.getElementById('jmStatDone').textContent       = active.filter(j => j.pipeStatus === 'completed').length;

        const revenue = active.reduce((sum, j) => {
            if (j.isPaid && j.price) {
                const p = parseFloat(String(j.price).replace(/[^0-9.]/g, ''));
                return sum + (isNaN(p) ? 0 : p);
            }
            return sum;
        }, 0);
        document.getElementById('jmStatRevenue').textContent = revenue.toFixed(0);
    }


    // ============================================
    // FILTERS
    // ============================================
    function applyFilters() {
        const q     = (document.getElementById('jmSearch').value || '').toLowerCase().trim();
        const svcF  = document.getElementById('jmFilterService').value.toLowerCase();
        const dateF = document.getElementById('jmFilterDate').value;
        const now   = new Date(); now.setHours(0,0,0,0);

        filteredJobs = allJobs.filter(j => {
            if (j.pipeStatus === 'cancelled') return false;

            // Text search
            if (q) {
                const hay = [j.name, j.email, j.postcode, j.service, j.address, j.phone, j.notes].join(' ').toLowerCase();
                if (!hay.includes(q)) return false;
            }
            // Service filter
            if (svcF && !(j.service || '').toLowerCase().includes(svcF)) return false;

            // Date filter
            if (dateF) {
                const jd = parseJobDate(j.date);
                if (!jd) return dateF !== 'overdue'; // no date → not overdue but also not matching date filters 
                const jDate    = new Date(jd); jDate.setHours(0,0,0,0);
                const tomorrow = new Date(now); tomorrow.setDate(tomorrow.getDate()+1);
                const weekEnd  = new Date(now); weekEnd.setDate(weekEnd.getDate()+7);
                const monthEnd = new Date(now.getFullYear(), now.getMonth()+1, 0);

                if (dateF === 'today'    && jDate.getTime() !== now.getTime()) return false;
                if (dateF === 'tomorrow' && jDate.getTime() !== tomorrow.getTime()) return false;
                if (dateF === 'week'     && (jDate < now || jDate > weekEnd)) return false;
                if (dateF === 'month'    && (jDate < now || jDate > monthEnd)) return false;
                if (dateF === 'overdue'  && (jDate >= now || j.pipeStatus === 'completed')) return false;
            }
            return true;
        });

        // Sort: upcoming dates first, then newest timestamp
        filteredJobs.sort((a, b) => {
            const da = parseJobDate(a.date);
            const db2 = parseJobDate(b.date);
            if (da && db2) return new Date(da) - new Date(db2);
            if (da) return -1;
            if (db2) return 1;
            return new Date(b.timestamp || 0) - new Date(a.timestamp || 0);
        });

        renderCurrentView();
    }

    function parseJobDate(dateStr) {
        if (!dateStr) return null;
        // Handle "Monday, 14 March 2026" — strip day name
        if (typeof dateStr === 'string' && dateStr.includes(',')) {
            const cleaned = dateStr.replace(/^[A-Za-z]+,\s*/, '');
            const d = new Date(cleaned);
            return isNaN(d) ? null : d.toISOString().slice(0,10);
        }
        const d = new Date(dateStr);
        return isNaN(d) ? null : d.toISOString().slice(0,10);
    }

    document.getElementById('jmSearch').addEventListener('input', applyFilters);
    document.getElementById('jmFilterService').addEventListener('change', applyFilters);
    document.getElementById('jmFilterDate').addEventListener('change', applyFilters);
    document.getElementById('jmRefreshBtn').addEventListener('click', loadJobs);


    // ============================================
    // VIEW SWITCHER
    // ============================================
    document.getElementById('jmViewMode').addEventListener('change', (e) => {
        currentView = e.target.value;
        renderCurrentView();
    });

    function renderCurrentView() {
        boardView.style.display    = 'none';
        listView.style.display     = 'none';
        calendarView.style.display = 'none';
        emptyState.style.display   = 'none';

        if (filteredJobs.length === 0) {
            emptyState.innerHTML = '<i class="fas fa-inbox"></i><p>No jobs match your filters</p>';
            emptyState.style.display = 'flex';
            return;
        }
        if (currentView === 'board')    renderBoard();
        else if (currentView === 'list')     renderList();
        else if (currentView === 'calendar') renderCalendar();
    }


    // ============================================
    // BOARD VIEW (KANBAN)
    // ============================================
    function renderBoard() {
        boardView.style.display = 'grid';
        const cols = { new: [], confirmed: [], 'in-progress': [], completed: [] };
        filteredJobs.forEach(j => { if (cols[j.pipeStatus]) cols[j.pipeStatus].push(j); });

        renderColumn('New',       'jmColNew',       'jmColNewCount',       cols['new']);
        renderColumn('Confirmed', 'jmColConfirmed', 'jmColConfirmedCount', cols['confirmed']);
        renderColumn('Progress',  'jmColProgress',  'jmColProgressCount',  cols['in-progress']);
        renderColumn('Done',      'jmColDone',      'jmColDoneCount',      cols['completed']);
    }

    function renderColumn(label, bodyId, countId, jobs) {
        document.getElementById(countId).textContent = jobs.length;
        document.getElementById(bodyId).innerHTML    = jobs.map(renderJobCard).join('');
    }

    function renderJobCard(j) {
        const dateStr = j.date ? formatDateShort(j.date) : '';
        const timeStr = j.time || '';
        const typeTag = j.isSubscription
            ? '<span class="jm-tag jm-tag-sub"><i class="fas fa-sync-alt"></i> Recurring</span>'
            : '<span class="jm-tag jm-tag-oneoff"><i class="fas fa-calendar-check"></i> One-off</span>';
        const paidTag = j.isPaid
            ? '<span class="jm-tag jm-tag-paid"><i class="fas fa-check"></i> Paid</span>'
            : j.isDeposit
                ? '<span class="jm-tag jm-tag-deposit"><i class="fas fa-piggy-bank"></i> Deposit' + (j.depositAmount ? ' £' + j.depositAmount : '') + '</span>'
                : '<span class="jm-tag jm-tag-unpaid"><i class="fas fa-clock"></i> Outstanding</span>';
        const priceStr = j.price ? '£' + String(j.price).replace(/[^0-9.]/g, '') : '';
        const jobNum = j.jobNumber ? `<span class="jm-job-number">${esc(j.jobNumber)}</span>` : '';

        return `
        <div class="jm-card" onclick="window.jmOpenJob(${j.rowIndex})">
            <div class="jm-card-header">
                <strong>${esc(j.name || 'Unknown')}</strong>
                ${priceStr ? `<span class="jm-card-price">${priceStr}</span>` : ''}
            </div>
            ${jobNum ? `<div class="jm-card-job-num">${jobNum}</div>` : ''}
            <div class="jm-card-service"><i class="fas fa-leaf"></i> ${esc(j.service || 'No service')}</div>
            ${dateStr ? `<div class="jm-card-date"><i class="fas fa-calendar"></i> ${dateStr}${timeStr ? ' <i class="fas fa-clock"></i> ' + esc(timeStr) : ''}</div>` : ''}
            <div class="jm-card-meta">
                ${j.postcode ? `<span><i class="fas fa-map-pin"></i> ${esc(j.postcode)}</span>` : ''}
                ${j.phone    ? `<span><i class="fas fa-phone"></i> ${esc(j.phone)}</span>` : ''}
            </div>
            <div class="jm-card-tags">${typeTag}${paidTag}</div>
        </div>`;
    }


    // ============================================
    // LIST VIEW
    // ============================================
    function renderList() {
        listView.style.display = 'block';
        listView.innerHTML = `
        <table class="jm-table">
            <thead>
                <tr>
                    <th>Job #</th><th>Customer</th><th>Service</th><th>Date / Time</th><th>Status</th>
                    <th>Type</th><th>Price</th><th>Payment</th><th>Postcode</th>
                </tr>
            </thead>
            <tbody>
                ${filteredJobs.map(j => `
                <tr class="jm-table-row" onclick="window.jmOpenJob(${j.rowIndex})">
                    <td><span class="jm-job-number">${esc(j.jobNumber || '—')}</span></td>
                    <td><strong>${esc(j.name || '—')}</strong></td>
                    <td>${esc(j.service || '—')}</td>
                    <td>${j.date ? formatDateShort(j.date) : '—'} ${j.time ? esc(j.time) : ''}</td>
                    <td><span class="jm-status-badge jm-status-${j.pipeStatus}">${statusLabel(j.pipeStatus)}</span></td>
                    <td>${j.isSubscription ? '<i class="fas fa-sync-alt"></i> Recurring' : '<i class="fas fa-calendar-check"></i> One-off'}</td>
                    <td>${j.price ? '£' + String(j.price).replace(/[^0-9.]/g,'') : '—'}</td>
                    <td>${j.isPaid ? '<span class="jm-tag jm-tag-paid">Paid</span>' : '<span class="jm-tag jm-tag-unpaid">Unpaid</span>'}</td>
                    <td>${esc(j.postcode || '—')}</td>
                </tr>`).join('')}
            </tbody>
        </table>`;
    }

    function statusLabel(s) {
        return { 'new':'New', 'confirmed':'Confirmed', 'in-progress':'In Progress', 'completed':'Completed', 'cancelled':'Cancelled' }[s] || s;
    }


    // ============================================
    // CALENDAR VIEW
    // ============================================
    function renderCalendar() {
        calendarView.style.display = 'block';
        const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
        document.getElementById('jmCalTitle').textContent = months[calMonth] + ' ' + calYear;

        const grid     = document.getElementById('jmCalGrid');
        const firstDay = new Date(calYear, calMonth, 1).getDay(); // 0=Sun
        const daysIn   = new Date(calYear, calMonth+1, 0).getDate();
        const today    = new Date(); today.setHours(0,0,0,0);

        // Build date → jobs lookup
        const byDate = {};
        filteredJobs.forEach(j => {
            const d = parseJobDate(j.date);
            if (d) { (byDate[d] = byDate[d] || []).push(j); }
        });

        let html = '<div class="jm-cal-days">';
        ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].forEach(d => { html += `<div class="jm-cal-day-label">${d}</div>`; });

        // Offset for Monday-start grid
        const offset = (firstDay + 6) % 7;
        for (let i = 0; i < offset; i++) html += '<div class="jm-cal-cell jm-cal-empty"></div>';

        for (let day = 1; day <= daysIn; day++) {
            const key   = `${calYear}-${String(calMonth+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
            const cDate = new Date(calYear, calMonth, day);
            const isToday = cDate.getTime() === today.getTime();
            const jobs  = byDate[key] || [];

            html += `<div class="jm-cal-cell${isToday ? ' jm-cal-today':''}${jobs.length ? ' jm-cal-has-jobs':''}">`;
            html += `<div class="jm-cal-date">${day}</div>`;
            jobs.slice(0,3).forEach(j => {
                html += `<div class="jm-cal-job jm-cal-job-${j.pipeStatus}" onclick="window.jmOpenJob(${j.rowIndex})">${esc((j.name||'?').split(' ')[0])} — ${esc(j.service||'')}</div>`;
            });
            if (jobs.length > 3) html += `<div class="jm-cal-more">+${jobs.length-3} more</div>`;
            html += '</div>';
        }
        html += '</div>';
        grid.innerHTML = html;
    }

    document.getElementById('jmCalPrev').addEventListener('click', () => { calMonth--; if (calMonth<0){calMonth=11;calYear--;} renderCalendar(); });
    document.getElementById('jmCalNext').addEventListener('click', () => { calMonth++; if (calMonth>11){calMonth=0;calYear++;} renderCalendar(); });
    document.getElementById('jmCalToday').addEventListener('click', () => { const n=new Date();calMonth=n.getMonth();calYear=n.getFullYear();renderCalendar(); });


    // ============================================
    // JOB DETAIL MODAL
    // ============================================
    window.jmOpenJob = async function(rowIndex) {
        const job = allJobs.find(j => j.rowIndex === rowIndex);
        if (!job) return;
        currentJob = job;

        document.getElementById('jmRowIndex').value = rowIndex;
        document.getElementById('jmModalTitle').innerHTML =
            `<i class="fas fa-clipboard-list"></i> ${job.jobNumber ? '<span class="jm-job-number">' + esc(job.jobNumber) + '</span> ' : ''}${esc(job.name || 'Job')} — ${esc(job.service || '')}`;

        // Details
        document.getElementById('jmDetName').textContent    = job.name || '—';
        document.getElementById('jmDetPhone').innerHTML      = job.phone ? `<a href="tel:${job.phone}">${esc(job.phone)}</a>` : '—';
        document.getElementById('jmDetEmail').innerHTML      = job.email ? `<a href="mailto:${job.email}">${esc(job.email)}</a>` : '—';
        document.getElementById('jmDetAddress').textContent  = [job.address, job.postcode].filter(Boolean).join(', ') || '—';
        document.getElementById('jmDetService').textContent  = job.service || '—';
        document.getElementById('jmDetDate').textContent     = job.date ? formatDateLong(job.date) : '—';
        document.getElementById('jmDetTime').textContent     = job.time || '—';
        document.getElementById('jmDetPrice').textContent    = job.price ? '£' + String(job.price).replace(/[^0-9.]/g,'') : '—';

        // Payment info
        let pay = '';
        if (job.isPaid) {
            pay = `<span class="jm-tag jm-tag-paid"><i class="fas fa-check-circle"></i> ${esc(job.paymentType || 'Paid')}</span>`;
        } else if (job.isDeposit) {
            pay = `<span class="jm-tag jm-tag-deposit"><i class="fas fa-piggy-bank"></i> Deposit Paid`
                + (job.depositAmount ? ` (£${esc(job.depositAmount)})` : '') + `</span>`;
            if (job.remainingBalance) {
                pay += ` <span class="jm-tag jm-tag-unpaid"><i class="fas fa-hourglass-half"></i> £${esc(job.remainingBalance)} remaining</span>`;
            }
        } else {
            pay = `<span class="jm-tag jm-tag-unpaid"><i class="fas fa-exclamation-circle"></i> Outstanding</span>`;
        }
        if (job.isSubscription) {
            pay += ` <span class="jm-tag jm-tag-sub"><i class="fas fa-sync-alt"></i> Subscription</span>`;
        }
        document.getElementById('jmDetPayment').innerHTML = pay;

        // Pipeline
        updatePipeline(job.pipeStatus);

        // Notes & checklist
        document.getElementById('jmJobNotes').value = job.notes || '';
        loadChecklist(rowIndex);

        // Quick action buttons
        document.getElementById('jmBtnCall').onclick  = () => { if (job.phone) window.open('tel:' + job.phone); };
        document.getElementById('jmBtnEmail').onclick = () => { if (job.email) window.open('mailto:' + job.email); };
        document.getElementById('jmBtnMap').onclick   = () => {
            if (job.googleMapsUrl) { window.open(job.googleMapsUrl); return; }
            const addr = [job.address, job.postcode].filter(Boolean).join(', ');
            window.open('https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(addr));
        };

        // Photos
        await loadJobPhotos(rowIndex);

        // Start on details tab
        switchTab('details');
        modal.style.display = 'flex';
    };


    // ============================================
    // STATUS PIPELINE
    // ============================================
    const pipeSteps = document.querySelectorAll('.jm-pipe-step');

    function updatePipeline(status) {
        const pipe = ['new','confirmed','in-progress','completed'];
        const idx  = pipe.indexOf(status);
        pipeSteps.forEach((el, i) => {
            el.classList.remove('jm-pipe-active','jm-pipe-done');
            if (i < idx)  el.classList.add('jm-pipe-done');
            if (i === idx) el.classList.add('jm-pipe-active');
        });
    }

    pipeSteps.forEach(el => {
        el.addEventListener('click', async () => {
            if (!currentJob) return;
            const newStatus = el.dataset.status;
            const origHTML  = el.innerHTML;
            el.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';

            const ok = await updateJobStatus(currentJob.rowIndex, newStatus);
            if (ok) {
                currentJob.status     = newStatus;
                currentJob.pipeStatus = normalisePipeStatus(newStatus, currentJob.type);
                updatePipeline(currentJob.pipeStatus);
                applyFilters();
                updateStats();
                if (newStatus === 'Completed') {
                    sendTelegram(`✅ Job completed: ${currentJob.name} — ${currentJob.service}`);
                }
            }
            el.innerHTML = origHTML;
        });
    });

    async function updateJobStatus(rowIndex, status) {
        try {
            const resp = await fetch(SHEETS_WEBHOOK, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain' },
                body: JSON.stringify({ action: 'update_status', rowIndex, status })
            });
            const d = await resp.json();
            return d.status === 'success';
        } catch (e) { console.error('Status update failed:', e); return false; }
    }


    // ============================================
    // TABS
    // ============================================
    function switchTab(name) {
        document.querySelectorAll('.jm-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.jm-tab-content').forEach(c => c.classList.remove('active'));
        document.querySelector(`.jm-tab[data-tab="${name}"]`).classList.add('active');
        document.getElementById('jmTab' + name.charAt(0).toUpperCase() + name.slice(1)).classList.add('active');
    }
    document.querySelectorAll('.jm-tab').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab)));


    // ============================================
    // PHOTO MANAGEMENT
    // ============================================
    async function loadJobPhotos(rowIndex) {
        const photos = await getPhotosForJob(rowIndex);
        const before = photos.filter(p => p.type === 'before');
        const after  = photos.filter(p => p.type === 'after');

        renderPhotoGrid('jmBeforePhotos', before);
        renderPhotoGrid('jmAfterPhotos', after);

        // Comparison section
        const cmpSec = document.getElementById('jmCompareSection');
        if (before.length && after.length) {
            cmpSec.style.display = 'block';
            populateCompareSelects(before, after);
        } else {
            cmpSec.style.display = 'none';
        }

        // Lawn tracker — show for lawn-related services or if multiple photos exist
        const tracker = document.getElementById('jmLawnTracker');
        const isLawn  = currentJob && (currentJob.service || '').toLowerCase().includes('lawn');
        if (isLawn || photos.length > 1) {
            tracker.style.display = 'block';
            renderLawnTimeline(photos);
        } else {
            tracker.style.display = 'none';
        }
    }

    function renderPhotoGrid(containerId, photos) {
        const el = document.getElementById(containerId);
        if (!photos.length) { el.innerHTML = '<p class="jm-no-photos">No photos yet</p>'; return; }
        el.innerHTML = photos.map((p, i) => `
            <div class="jm-photo-thumb" data-id="${p.id}">
                <img src="${p.dataUrl}" alt="${p.type} photo" onclick="window.jmOpenLightbox('${containerId}',${i})">
                <div class="jm-photo-overlay">
                    <span class="jm-photo-date">${new Date(p.timestamp).toLocaleDateString('en-GB')}</span>
                    <button class="jm-photo-delete" onclick="event.stopPropagation();window.jmDeletePhoto(${p.id})" title="Delete"><i class="fas fa-trash"></i></button>
                </div>
            </div>`).join('');
    }

    // File upload handlers
    document.getElementById('jmBeforeUpload').addEventListener('change', (e) => handlePhotoUpload(e, 'before'));
    document.getElementById('jmAfterUpload').addEventListener('change',  (e) => handlePhotoUpload(e, 'after'));

    async function handlePhotoUpload(e, type) {
        if (!currentJob) return;
        const files = Array.from(e.target.files);
        for (const file of files) {
            const raw        = await readFileAsDataUrl(file);
            const compressed = await compressImage(raw, 1200);
            await savePhoto(currentJob.rowIndex, type, compressed, '');
        }
        await loadJobPhotos(currentJob.rowIndex);
        e.target.value = '';
    }

    function readFileAsDataUrl(file) {
        return new Promise((resolve, reject) => {
            const r = new FileReader();
            r.onload = () => resolve(r.result);
            r.onerror = reject;
            r.readAsDataURL(file);
        });
    }

    function compressImage(dataUrl, maxW) {
        return new Promise(resolve => {
            const img = new Image();
            img.onload = () => {
                let w = img.width, h = img.height;
                if (w > maxW) { h = Math.round(h * maxW / w); w = maxW; }
                const c = document.createElement('canvas');
                c.width = w; c.height = h;
                c.getContext('2d').drawImage(img, 0, 0, w, h);
                resolve(c.toDataURL('image/jpeg', 0.8));
            };
            img.src = dataUrl;
        });
    }

    window.jmDeletePhoto = async function(id) {
        if (!confirm('Delete this photo?')) return;
        await deletePhoto(id);
        if (currentJob) await loadJobPhotos(currentJob.rowIndex);
    };


    // ============================================
    // PHOTO LIGHTBOX
    // ============================================
    let lbPhotos = [], lbIdx = 0;

    window.jmOpenLightbox = function(containerId, idx) {
        const imgs = document.getElementById(containerId).querySelectorAll('img');
        lbPhotos = Array.from(imgs).map(i => i.src);
        lbIdx = idx;
        showLB();
        lightbox.style.display = 'flex';
    };

    function showLB() {
        document.getElementById('jmLightboxImg').src = lbPhotos[lbIdx];
        document.getElementById('jmLightboxCaption').textContent = `Photo ${lbIdx+1} of ${lbPhotos.length}`;
    }

    document.getElementById('jmLightboxClose').addEventListener('click', () => lightbox.style.display = 'none');
    document.getElementById('jmLightboxPrev').addEventListener('click', () => { lbIdx = (lbIdx - 1 + lbPhotos.length) % lbPhotos.length; showLB(); });
    document.getElementById('jmLightboxNext').addEventListener('click', () => { lbIdx = (lbIdx + 1) % lbPhotos.length; showLB(); });
    lightbox.addEventListener('click', (e) => { if (e.target === lightbox) lightbox.style.display = 'none'; });


    // ============================================
    // BEFORE/AFTER COMPARISON SLIDER
    // ============================================
    function populateCompareSelects(beforePhotos, afterPhotos) {
        const bSel = document.getElementById('jmCompareBeforeSelect');
        const aSel = document.getElementById('jmCompareAfterSelect');

        bSel.innerHTML = beforePhotos.map((p, i) => `<option value="${i}">Before — ${new Date(p.timestamp).toLocaleDateString('en-GB')}</option>`).join('');
        aSel.innerHTML = afterPhotos.map((p, i) => `<option value="${i}">After — ${new Date(p.timestamp).toLocaleDateString('en-GB')}</option>`).join('');

        function updateCompare() {
            const bi = parseInt(bSel.value), ai = parseInt(aSel.value);
            if (beforePhotos[bi] && afterPhotos[ai]) {
                document.getElementById('jmCompareBefore').style.backgroundImage = `url(${beforePhotos[bi].dataUrl})`;
                document.getElementById('jmCompareAfter').style.backgroundImage  = `url(${afterPhotos[ai].dataUrl})`;
            }
        }
        bSel.addEventListener('change', updateCompare);
        aSel.addEventListener('change', updateCompare);
        updateCompare();
        initCompareSlider();
    }

    function initCompareSlider() {
        const slider   = document.getElementById('jmCompareSlider');
        const handle   = document.getElementById('jmCompareHandle');
        const beforeEl = document.getElementById('jmCompareBefore');
        let dragging   = false;

        function setPos(x) {
            const rect = slider.getBoundingClientRect();
            let pct = ((x - rect.left) / rect.width) * 100;
            pct = Math.max(5, Math.min(95, pct));
            beforeEl.style.width = pct + '%';
            handle.style.left    = pct + '%';
        }

        handle.addEventListener('mousedown',  () => dragging = true);
        handle.addEventListener('touchstart', () => dragging = true);
        document.addEventListener('mousemove', (e) => { if (dragging) setPos(e.clientX); });
        document.addEventListener('touchmove', (e) => { if (dragging) setPos(e.touches[0].clientX); });
        document.addEventListener('mouseup',   () => dragging = false);
        document.addEventListener('touchend',  () => dragging = false);
        slider.addEventListener('click', (e) => setPos(e.clientX));
    }


    // ============================================
    // LAWN PROGRESS TIMELINE
    // ============================================
    function renderLawnTimeline(photos) {
        const el = document.getElementById('jmLawnTimeline');
        const sorted = [...photos].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
        if (!sorted.length) {
            el.innerHTML = '<p class="jm-no-photos">Upload photos to track lawn progress over time</p>';
            return;
        }
        el.innerHTML = sorted.map((p, i) => `
            <div class="jm-timeline-item">
                <div class="jm-timeline-date">
                    <span>${new Date(p.timestamp).toLocaleDateString('en-GB',{day:'numeric',month:'short'})}</span>
                    <small>${p.type === 'before' ? 'Before' : 'After'}</small>
                </div>
                <div class="jm-timeline-img" onclick="window.jmOpenLightbox('jmLawnTimeline',${i})">
                    <img src="${p.dataUrl}" alt="Progress">
                </div>
            </div>`).join('');
    }


    // ============================================
    // SAVE — NOTES, CHECKLIST
    // ============================================
    document.getElementById('jmSaveBtn').addEventListener('click', async () => {
        if (!currentJob) return;
        const btn = document.getElementById('jmSaveBtn');
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
        btn.disabled  = true;

        const notes = document.getElementById('jmJobNotes').value.trim();
        try {
            await fetch(SHEETS_WEBHOOK, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain' },
                body: JSON.stringify({ action: 'update_client', rowIndex: currentJob.rowIndex, notes })
            });
            currentJob.notes = notes;
            saveChecklist(currentJob.rowIndex);
            btn.innerHTML = '<i class="fas fa-check"></i> Saved!';
            setTimeout(() => { btn.innerHTML = '<i class="fas fa-save"></i> Save Changes'; btn.disabled = false; }, 1500);
        } catch (e) {
            btn.innerHTML = '<i class="fas fa-exclamation-triangle"></i> Error';
            btn.disabled  = false;
        }
    });


    // ============================================
    // CHECKLIST — LOCALSTORAGE
    // ============================================
    function saveChecklist(rowIndex) {
        const items = {};
        document.querySelectorAll('#jmChecklist input[type="checkbox"]').forEach(cb => { items[cb.dataset.task] = cb.checked; });
        const all = JSON.parse(localStorage.getItem('ggm_checklists') || '{}');
        all['row_' + rowIndex] = items;
        localStorage.setItem('ggm_checklists', JSON.stringify(all));
    }

    function loadChecklist(rowIndex) {
        const all   = JSON.parse(localStorage.getItem('ggm_checklists') || '{}');
        const items = all['row_' + rowIndex] || {};
        document.querySelectorAll('#jmChecklist input[type="checkbox"]').forEach(cb => { cb.checked = items[cb.dataset.task] || false; });
    }


    // ============================================
    // QUICK ACTIONS
    // ============================================
    document.getElementById('jmInvoiceBtn').addEventListener('click', () => {
        if (!currentJob) return;
        const params = new URLSearchParams({
            name: currentJob.name || '', email: currentJob.email || '', phone: currentJob.phone || '',
            address: currentJob.address || '', postcode: currentJob.postcode || '', service: currentJob.service || ''
        }).toString();
        window.open('invoice.html?' + params);
    });

    document.getElementById('jmCancelJobBtn').addEventListener('click', async () => {
        if (!currentJob || !confirm('Cancel this job? This will update the Google Sheet.')) return;
        await updateJobStatus(currentJob.rowIndex, 'Cancelled');
        currentJob.status = 'Cancelled';
        currentJob.pipeStatus = 'cancelled';
        modal.style.display = 'none';
        applyFilters();
        updateStats();
    });

    document.getElementById('jmShareBtn').addEventListener('click', async () => {
        if (!currentJob) return;
        const photos = await getPhotosForJob(currentJob.rowIndex);
        if (!photos.length) { alert('No photos to share. Upload before & after photos first.'); return; }
        const b = photos.filter(p => p.type === 'before').length;
        const a = photos.filter(p => p.type === 'after').length;
        const text = `${currentJob.name} — ${currentJob.service}\n📸 ${b} before, ${a} after photos\n📍 ${currentJob.postcode || 'Cornwall'}\n✅ Gardners Ground Maintenance`;
        try { await navigator.clipboard.writeText(text); alert('Summary copied to clipboard!'); }
        catch (e) { prompt('Copy this text:', text); }
    });

    // Close modal
    document.getElementById('jmModalClose').addEventListener('click', () => modal.style.display = 'none');
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.style.display = 'none'; });


    // ============================================
    // TELEGRAM
    // ============================================
    async function sendTelegram(msg) {
        try {
            await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: TELEGRAM_CHAT, text: msg, parse_mode: 'HTML' })
            });
        } catch (e) { /* silent */ }
    }


    // ============================================
    // HELPERS
    // ============================================
    function formatDateShort(ds) {
        if (!ds) return '';
        if (typeof ds === 'string' && ds.includes(',')) return ds.replace(/^[A-Za-z]+,\s*/, '');
        try { const d = new Date(ds); return isNaN(d) ? String(ds) : d.toLocaleDateString('en-GB',{day:'numeric',month:'short'}); }
        catch(e) { return String(ds); }
    }

    function formatDateLong(ds) {
        if (!ds) return '';
        if (typeof ds === 'string' && ds.includes(',')) return ds;
        try { const d = new Date(ds); return isNaN(d) ? String(ds) : d.toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long',year:'numeric'}); }
        catch(e) { return String(ds); }
    }

    function esc(str) { const d = document.createElement('div'); d.textContent = str; return d.innerHTML; }

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (lightbox.style.display === 'flex') lightbox.style.display = 'none';
            else if (modal.style.display === 'flex') modal.style.display = 'none';
        }
        if ((e.ctrlKey || e.metaKey) && e.key === 'f' && document.activeElement !== document.getElementById('jmSearch')) {
            e.preventDefault();
            document.getElementById('jmSearch').focus();
        }
    });


    // ============================================
    // INIT + AUTO-REFRESH (every 60s)
    // ============================================
    openPhotoDB().then(loadJobs).catch(() => loadJobs());

    // Auto-refresh jobs every 60 seconds to pick up status changes
    setInterval(() => {
        if (modal.style.display !== 'flex') loadJobs();
    }, 60000);

    // Inject deposit tag CSS
    const depositCSS = document.createElement('style');
    depositCSS.textContent = `.jm-tag-deposit{background:#FFF3E0;color:#E65100;border:1px solid #FFB74D;font-weight:600;}`;
    document.head.appendChild(depositCSS);

});
