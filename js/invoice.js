/* ============================================
   Gardners GM — Invoice Generator JS
   Handles: Line items, totals, PDF generation,
   Web3Forms email, Telegram notification,
   localStorage history & auto-numbering
   ============================================ */

document.addEventListener('DOMContentLoaded', () => {

    // ── Config ──
    const TG_BOT_TOKEN = '8261874993:AAHW6752Ofhsrw6qzOSSZWnfmzbBj7G8Z-g';
    const TG_CHAT_ID = '6200151295';
    const WEB3FORMS_KEY = '8f5c40a2-7cfb-4dba-b287-7e4cea717313';
    const STRIPE_WEBHOOK = 'https://script.google.com/macros/s/AKfycbxsikmv8R-c3y4mz093lQ78bpD3xaEBHZNUorW0BmF1D3JxWHCsMAi9UUGRdF60U92uAQ/exec';

    const BUSINESS = {
        name: 'Gardners Ground Maintenance',
        address: 'Roche, Cornwall',
        phone: '01726 432051',
        email: 'info@gardnersgm.co.uk',
        website: 'gardnersgm.co.uk',
        sortCode: '04-00-03',
        account: '39873874',
        accountName: 'Gardners Ground Maintenance'
    };

    // ── Elements ──
    const invoiceNumberEl = document.getElementById('invoiceNumber');
    const invoiceDateEl = document.getElementById('invoiceDate');
    const dueDateEl = document.getElementById('dueDate');
    const poNumberEl = document.getElementById('poNumber');
    const custNameEl = document.getElementById('custName');
    const custEmailEl = document.getElementById('custEmail');
    const custPhoneEl = document.getElementById('custPhone');
    const custPostcodeEl = document.getElementById('custPostcode');
    const custAddressEl = document.getElementById('custAddress');
    let currentJobNumber = '';
    let currentJobPhotos = { before: [], after: [] };
    const lineItemsBody = document.getElementById('lineItemsBody');
    const addItemBtn = document.getElementById('addItemBtn');
    const subtotalDisplay = document.getElementById('subtotalDisplay');
    const discountType = document.getElementById('discountType');
    const discountValue = document.getElementById('discountValue');
    const discountDisplay = document.getElementById('discountDisplay');
    const grandTotalDisplay = document.getElementById('grandTotalDisplay');
    const stripeLinkEl = null; // removed — Stripe creates payment link automatically
    const stripeEnabledEl = document.getElementById('stripeEnabled');
    const invoiceNotesEl = document.getElementById('invoiceNotes');
    const sendBtn = document.getElementById('sendInvoiceBtn');
    const downloadBtn = document.getElementById('downloadPdfBtn');
    const previewBtn = document.getElementById('previewBtn');
    const statusEl = document.getElementById('invoiceStatus');
    const previewEl = document.getElementById('invoicePreview');
    const historyEl = document.getElementById('invoiceHistory');

    // ── Invoice Number (auto-increment from localStorage) ──
    function getNextInvoiceNumber() {
        let counter = parseInt(localStorage.getItem('ggm_invoice_counter') || '0', 10);
        counter++;
        localStorage.setItem('ggm_invoice_counter', counter.toString());
        return 'GGM-' + String(counter).padStart(4, '0');
    }

    function initInvoiceNumber() {
        const num = getNextInvoiceNumber();
        invoiceNumberEl.value = num;
    }

    // ── Dates ──
    function initDates() {
        const today = new Date();
        invoiceDateEl.value = formatDateInput(today);
        const due = new Date(today);
        due.setDate(due.getDate() + 14);
        dueDateEl.value = formatDateInput(due);
    }

    function formatDateInput(d) {
        return d.toISOString().split('T')[0];
    }

    function formatDateDisplay(dateStr) {
        if (!dateStr) return '';
        const d = new Date(dateStr + 'T00:00:00');
        return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
    }

    // ── Pre-fill from URL params ──
    function prefillFromUrl() {
        const p = new URLSearchParams(window.location.search);
        if (p.get('name')) custNameEl.value = p.get('name');
        if (p.get('email')) custEmailEl.value = p.get('email');
        if (p.get('phone')) custPhoneEl.value = p.get('phone');
        if (p.get('postcode')) custPostcodeEl.value = p.get('postcode');
        if (p.get('address')) custAddressEl.value = p.get('address');
        if (p.get('service')) {
            // Pre-fill first line item description
            const firstDesc = lineItemsBody.querySelector('.item-desc');
            if (firstDesc) firstDesc.value = p.get('service');
        }
        if (p.get('amount')) {
            const firstPrice = lineItemsBody.querySelector('.item-price');
            if (firstPrice) {
                firstPrice.value = p.get('amount');
                recalcTotals();
            }
        }
    }

    // ── Service name mapping ──
    const serviceNames = {
        'lawn-cutting': 'Lawn Cutting',
        'hedge-trimming': 'Hedge Trimming',
        'scarifying': 'Scarifying',
        'lawn-treatment': 'Lawn Treatment',
        'garden-clearance': 'Garden Clearance',
        'power-washing': 'Power Washing'
    };

    // ── CLIENT / JOB PICKER ──
    const clientPicker = document.getElementById('clientPicker');
    let allClients = [];

    async function loadClientsForInvoice() {
        try {
            const resp = await fetch(STRIPE_WEBHOOK + '?action=get_clients');
            const result = await resp.json();
            if (result.status === 'success' && result.clients) {
                allClients = result.clients.filter(c => c.name); // skip blank rows
                renderClientPicker();
            } else {
                clientPicker.innerHTML = '<option value="">— Failed to load —</option>';
            }
        } catch (err) {
            clientPicker.innerHTML = '<option value="">— Network error —</option>';
        }
    }

    function renderClientPicker() {
        // Sort: Active first, then by date descending
        const sorted = [...allClients].sort((a, b) => {
            const statusOrder = { 'Active': 0, 'Completed': 1, 'Cancelled': 2, 'Canceled': 2 };
            const sa = statusOrder[a.status] ?? 1;
            const sb = statusOrder[b.status] ?? 1;
            if (sa !== sb) return sa - sb;
            return String(b.timestamp).localeCompare(String(a.timestamp));
        });

        // Group by status
        const groups = {};
        sorted.forEach((c, i) => {
            const status = c.status || 'Unknown';
            if (!groups[status]) groups[status] = [];
            groups[status].push({ ...c, _origIdx: allClients.indexOf(c) });
        });

        let html = '<option value="">— Select a client / job —</option>';
        for (const [status, clients] of Object.entries(groups)) {
            html += `<optgroup label="${status} (${clients.length})">`;
            clients.forEach(c => {
                const svc = serviceNames[c.service] || c.service || 'No service';
                const jobLabel = c.jobNumber ? ` [${c.jobNumber}]` : '';
                const dateLabel = c.date ? ` — ${c.date}` : '';
                const priceLabel = c.price ? ` — £${parseFloat(c.price).toFixed(2)}` : '';
                html += `<option value="${c._origIdx}">${c.name} — ${svc}${jobLabel}${dateLabel}${priceLabel}</option>`;
            });
            html += '</optgroup>';
        }
        clientPicker.innerHTML = html;
    }

    if (clientPicker) {
        clientPicker.addEventListener('change', () => {
            const idx = clientPicker.value;
            if (idx === '') return;
            const c = allClients[parseInt(idx, 10)];
            if (!c) return;

            // Fill customer fields
            custNameEl.value = c.name || '';
            custEmailEl.value = c.email || '';
            custPhoneEl.value = c.phone || '';
            custPostcodeEl.value = c.postcode || '';
            custAddressEl.value = c.address || '';

            // Fill PO / reference with job number
            if (c.jobNumber) {
                poNumberEl.value = c.jobNumber;
                currentJobNumber = c.jobNumber;
                loadJobPhotos(c.jobNumber);
            } else {
                currentJobNumber = '';
                currentJobPhotos = { before: [], after: [] };
            }

            // Clear existing line items and add the service
            lineItemsBody.innerHTML = '';
            itemIdCounter = 0;
            const svcName = serviceNames[c.service] || c.service || '';
            const price = parseFloat(c.price) || 0;
            addLineItem(svcName, 1, price);

            recalcTotals();
            updatePreview();
            updatePhotosPanel();
        });
    }

    // ── JOB PHOTOS ──
    async function loadJobPhotos(jobNumber) {
        if (!jobNumber) return;
        try {
            const resp = await fetch(`${STRIPE_WEBHOOK}?action=get_job_photos&job=${encodeURIComponent(jobNumber)}`);
            const result = await resp.json();
            if (result.status === 'success' && result.photos) {
                currentJobPhotos = result.photos;
                updatePhotosPanel();
                updatePreview();
            }
        } catch(err) {
            console.log('Could not load photos:', err);
        }
    }

    function updatePhotosPanel() {
        const panel = document.getElementById('photosPanel');
        if (!panel) return;
        if (currentJobPhotos.before.length === 0 && currentJobPhotos.after.length === 0) {
            panel.innerHTML = `<div style="color:#999;text-align:center;padding:1rem;">
                <i class="fas fa-camera" style="font-size:1.5rem;"></i>
                <p style="margin:0.5rem 0 0;">No photos yet — send photos to Telegram with caption:<br>
                <code>${currentJobNumber || 'GGM-XXXX'} before</code> or <code>${currentJobNumber || 'GGM-XXXX'} after</code></p>
            </div>`;
            return;
        }
        let html = '';
        if (currentJobPhotos.before.length > 0) {
            html += `<div style="margin-bottom:0.5rem;"><strong>📷 Before (${currentJobPhotos.before.length}):</strong></div>
                <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:1rem;">`;
            currentJobPhotos.before.forEach(p => {
                html += `<a href="${p.url}" target="_blank"><img src="${p.url}" style="width:100px;height:70px;object-fit:cover;border-radius:6px;border:2px solid #ddd;"></a>`;
            });
            html += '</div>';
        }
        if (currentJobPhotos.after.length > 0) {
            html += `<div style="margin-bottom:0.5rem;"><strong>✅ After (${currentJobPhotos.after.length}):</strong></div>
                <div style="display:flex;gap:8px;flex-wrap:wrap;">`;
            currentJobPhotos.after.forEach(p => {
                html += `<a href="${p.url}" target="_blank"><img src="${p.url}" style="width:100px;height:70px;object-fit:cover;border-radius:6px;border:2px solid #2E7D32;"></a>`;
            });
            html += '</div>';
        }
        panel.innerHTML = html;
    }

    // ── LINE ITEMS ──
    let itemIdCounter = 0;

    function addLineItem(desc = '', qty = 1, price = 0) {
        itemIdCounter++;
        const tr = document.createElement('tr');
        tr.className = 'line-item-row';
        tr.dataset.id = itemIdCounter;
        tr.innerHTML = `
            <td><input type="text" class="item-desc" placeholder="e.g. Lawn Mowing" value="${desc}"></td>
            <td><input type="number" class="item-qty" value="${qty}" min="1" step="1"></td>
            <td><input type="number" class="item-price" value="${price}" min="0" step="0.01" placeholder="0.00"></td>
            <td class="item-line-total">£${(qty * price).toFixed(2)}</td>
            <td><button type="button" class="btn-remove-item" title="Remove"><i class="fas fa-trash-alt"></i></button></td>
        `;

        // Events
        tr.querySelector('.item-desc').addEventListener('input', () => { recalcTotals(); updatePreview(); });
        tr.querySelector('.item-qty').addEventListener('input', () => { recalcRow(tr); recalcTotals(); updatePreview(); });
        tr.querySelector('.item-price').addEventListener('input', () => { recalcRow(tr); recalcTotals(); updatePreview(); });
        tr.querySelector('.btn-remove-item').addEventListener('click', () => {
            tr.remove();
            recalcTotals();
            updatePreview();
        });

        lineItemsBody.appendChild(tr);
        recalcTotals();
        updatePreview();
    }

    function recalcRow(tr) {
        const qty = parseFloat(tr.querySelector('.item-qty').value) || 0;
        const price = parseFloat(tr.querySelector('.item-price').value) || 0;
        tr.querySelector('.item-line-total').textContent = '£' + (qty * price).toFixed(2);
    }

    function getLineItems() {
        const items = [];
        lineItemsBody.querySelectorAll('.line-item-row').forEach(tr => {
            const desc = tr.querySelector('.item-desc').value.trim();
            const qty = parseFloat(tr.querySelector('.item-qty').value) || 0;
            const price = parseFloat(tr.querySelector('.item-price').value) || 0;
            if (desc) {
                items.push({ description: desc, qty, price, total: qty * price });
            }
        });
        return items;
    }

    function recalcTotals() {
        const items = getLineItems();
        const subtotal = items.reduce((sum, i) => sum + i.total, 0);

        let discountAmt = 0;
        const discVal = parseFloat(discountValue.value) || 0;
        if (discountType.value === 'percent') {
            discountAmt = subtotal * (discVal / 100);
        } else {
            discountAmt = discVal;
        }
        discountAmt = Math.min(discountAmt, subtotal);
        const grandTotal = subtotal - discountAmt;

        subtotalDisplay.textContent = '£' + subtotal.toFixed(2);
        discountDisplay.textContent = '-£' + discountAmt.toFixed(2);
        grandTotalDisplay.textContent = '£' + grandTotal.toFixed(2);

        return { subtotal, discountAmt, grandTotal, items };
    }

    // Events for discount
    discountType.addEventListener('change', () => { recalcTotals(); updatePreview(); });
    discountValue.addEventListener('input', () => { recalcTotals(); updatePreview(); });

    // Add item button
    addItemBtn.addEventListener('click', () => addLineItem());

    // ── LIVE PREVIEW ──
    function getInvoiceData() {
        const { subtotal, discountAmt, grandTotal, items } = recalcTotals();
        return {
            invoiceNumber: invoiceNumberEl.value,
            invoiceDate: invoiceDateEl.value,
            dueDate: dueDateEl.value,
            poNumber: poNumberEl.value.trim(),
            customer: {
                name: custNameEl.value.trim(),
                email: custEmailEl.value.trim(),
                phone: custPhoneEl.value.trim(),
                postcode: custPostcodeEl.value.trim(),
                address: custAddressEl.value.trim()
            },
            items,
            subtotal,
            discountAmt,
            grandTotal,
            stripeEnabled: stripeEnabledEl ? stripeEnabledEl.checked : true,
            notes: invoiceNotesEl.value.trim()
        };
    }

    function updatePreview() {
        const d = getInvoiceData();
        const itemsHtml = d.items.length > 0
            ? d.items.map(i => `
                <tr>
                    <td>${escHtml(i.description)}</td>
                    <td style="text-align:center;">${i.qty}</td>
                    <td style="text-align:right;">£${i.price.toFixed(2)}</td>
                    <td style="text-align:right;">£${i.total.toFixed(2)}</td>
                </tr>
            `).join('')
            : '<tr><td colspan="4" style="text-align:center;color:#999;padding:1.5rem;">No items added yet</td></tr>';

        previewEl.innerHTML = `
            <div class="preview-invoice">
                <div class="prev-header">
                    <div class="prev-brand">
                        <div class="prev-logo"><i class="fas fa-leaf"></i></div>
                        <div>
                            <div class="prev-company">${BUSINESS.name}</div>
                            <div class="prev-tagline">${BUSINESS.address}</div>
                            <div class="prev-tagline">${BUSINESS.phone} · ${BUSINESS.email}</div>
                        </div>
                    </div>
                    <div class="prev-inv-info">
                        <div class="prev-inv-title">INVOICE</div>
                        <div class="prev-inv-number">${d.invoiceNumber}</div>
                        <div class="prev-inv-date">Issued: ${formatDateDisplay(d.invoiceDate)}</div>
                        <div class="prev-inv-date">Due: ${formatDateDisplay(d.dueDate)}</div>
                        ${d.poNumber ? `<div class="prev-inv-date">Ref: ${escHtml(d.poNumber)}</div>` : ''}
                    </div>
                </div>

                <div class="prev-customer">
                    <div class="prev-customer-label">Bill To:</div>
                    <div class="prev-customer-name">${escHtml(d.customer.name) || '—'}</div>
                    <div class="prev-customer-detail">${escHtml(d.customer.address) || ''}</div>
                    <div class="prev-customer-detail">${escHtml(d.customer.postcode) || ''}</div>
                    <div class="prev-customer-detail">${escHtml(d.customer.email) || ''}</div>
                    <div class="prev-customer-detail">${escHtml(d.customer.phone) || ''}</div>
                </div>

                <table class="prev-table">
                    <thead>
                        <tr>
                            <th>Description</th>
                            <th style="text-align:center;">Qty</th>
                            <th style="text-align:right;">Price</th>
                            <th style="text-align:right;">Total</th>
                        </tr>
                    </thead>
                    <tbody>${itemsHtml}</tbody>
                </table>

                <div class="prev-totals">
                    <div class="prev-totals-row">
                        <span>Subtotal</span>
                        <span>£${d.subtotal.toFixed(2)}</span>
                    </div>
                    ${d.discountAmt > 0 ? `
                    <div class="prev-totals-row prev-discount">
                        <span>Discount</span>
                        <span>-£${d.discountAmt.toFixed(2)}</span>
                    </div>` : ''}
                    <div class="prev-totals-row prev-grand">
                        <span>Total Due</span>
                        <span>£${d.grandTotal.toFixed(2)}</span>
                    </div>
                </div>

                <div class="prev-payment">
                    <div class="prev-payment-title">Payment Details</div>
                    <div class="prev-payment-grid">
                        <div>
                            <strong>Bank Transfer</strong><br>
                            Sort Code: ${BUSINESS.sortCode}<br>
                            Account: ${BUSINESS.account}<br>
                            Name: ${BUSINESS.accountName}
                        </div>
                    </div>
                </div>

                ${d.notes ? `
                <div class="prev-notes">
                    <div class="prev-notes-label">Notes</div>
                    <div>${escHtml(d.notes)}</div>
                </div>` : ''}

                <div class="prev-footer">
                    ${BUSINESS.name} · ${BUSINESS.website} · ${BUSINESS.phone}
                </div>
            </div>
        `;
    }

    function escHtml(str) {
        const div = document.createElement('div');
        div.textContent = str || '';
        return div.innerHTML;
    }

    // Update preview on any input change
    document.querySelectorAll('#custName, #custEmail, #custPhone, #custPostcode, #custAddress, #invoiceDate, #dueDate, #poNumber, #invoiceNotes').forEach(el => {
        el.addEventListener('input', updatePreview);
    });

    // Stripe toggle behaviour
    if (stripeEnabledEl) {
        const bankNote = document.getElementById('bankOnlyNote');
        stripeEnabledEl.addEventListener('change', () => {
            const on = stripeEnabledEl.checked;
            if (bankNote) bankNote.style.display = on ? 'none' : 'block';
            sendBtn.innerHTML = on
                ? '<i class="fab fa-stripe-s"></i> Send Stripe Invoice'
                : '<i class="fas fa-download"></i> Generate & Download PDF';
        });
    }

    // ── PDF GENERATION ──
    function generatePdf(data) {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF('p', 'mm', 'a4');
        const pageW = doc.internal.pageSize.getWidth();
        const green = [46, 125, 50];
        const darkGreen = [27, 94, 32];
        const gray = [102, 102, 102];
        const black = [51, 51, 51];
        let y = 20;

        // ── Header bar ──
        doc.setFillColor(...green);
        doc.rect(0, 0, pageW, 36, 'F');

        // Leaf symbol
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(18);
        doc.setFont('helvetica', 'bold');
        doc.text('Gardners Ground Maintenance', 15, 16);
        doc.setFontSize(9);
        doc.setFont('helvetica', 'normal');
        doc.text(`${BUSINESS.address}  |  ${BUSINESS.phone}  |  ${BUSINESS.email}`, 15, 24);
        doc.text(BUSINESS.website, 15, 30);

        // INVOICE title
        doc.setFontSize(22);
        doc.setFont('helvetica', 'bold');
        doc.text('INVOICE', pageW - 15, 16, { align: 'right' });
        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        doc.text(data.invoiceNumber, pageW - 15, 24, { align: 'right' });

        y = 46;

        // ── Invoice details & customer ──
        doc.setTextColor(...black);
        doc.setFontSize(9);

        // Left: Bill To
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(...green);
        doc.text('Bill To:', 15, y);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(...black);
        y += 6;
        doc.setFontSize(11);
        doc.text(data.customer.name || '—', 15, y);
        y += 5;
        doc.setFontSize(9);
        if (data.customer.address) { doc.text(data.customer.address, 15, y); y += 4.5; }
        if (data.customer.postcode) { doc.text(data.customer.postcode, 15, y); y += 4.5; }
        if (data.customer.email) { doc.text(data.customer.email, 15, y); y += 4.5; }
        if (data.customer.phone) { doc.text(data.customer.phone, 15, y); y += 4.5; }

        // Right: Invoice details
        const rightX = pageW - 60;
        let ry = 46;
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(...green);
        doc.text('Invoice Details:', rightX, ry);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(...black);
        ry += 6;
        doc.setFontSize(9);
        doc.text(`Date: ${formatDateDisplay(data.invoiceDate)}`, rightX, ry); ry += 5;
        doc.text(`Due: ${formatDateDisplay(data.dueDate)}`, rightX, ry); ry += 5;
        if (data.poNumber) { doc.text(`Ref: ${data.poNumber}`, rightX, ry); ry += 5; }

        y = Math.max(y, ry) + 8;

        // ── Line items table ──
        const tableData = data.items.map(i => [
            i.description,
            i.qty.toString(),
            '£' + i.price.toFixed(2),
            '£' + i.total.toFixed(2)
        ]);

        doc.autoTable({
            startY: y,
            head: [['Description', 'Qty', 'Unit Price', 'Total']],
            body: tableData,
            theme: 'grid',
            headStyles: {
                fillColor: green,
                textColor: [255, 255, 255],
                fontStyle: 'bold',
                fontSize: 9.5,
                cellPadding: 4
            },
            bodyStyles: {
                fontSize: 9,
                cellPadding: 3.5,
                textColor: black
            },
            columnStyles: {
                0: { cellWidth: 'auto' },
                1: { cellWidth: 20, halign: 'center' },
                2: { cellWidth: 30, halign: 'right' },
                3: { cellWidth: 30, halign: 'right' }
            },
            alternateRowStyles: { fillColor: [245, 249, 245] },
            margin: { left: 15, right: 15 }
        });

        y = doc.autoTable.previous.finalY + 8;

        // ── Totals ──
        const totalsX = pageW - 75;
        doc.setFontSize(9.5);

        doc.setTextColor(...gray);
        doc.text('Subtotal:', totalsX, y);
        doc.text('£' + data.subtotal.toFixed(2), pageW - 15, y, { align: 'right' });
        y += 6;

        if (data.discountAmt > 0) {
            doc.text('Discount:', totalsX, y);
            doc.text('-£' + data.discountAmt.toFixed(2), pageW - 15, y, { align: 'right' });
            y += 6;
        }

        // Grand total with green background
        doc.setFillColor(...green);
        doc.roundedRect(totalsX - 5, y - 4, pageW - totalsX + 5 - 10, 12, 2, 2, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(11);
        doc.setFont('helvetica', 'bold');
        doc.text('TOTAL DUE:', totalsX, y + 4);
        doc.text('£' + data.grandTotal.toFixed(2), pageW - 15, y + 4, { align: 'right' });
        y += 18;

        // ── Payment Details ──
        doc.setTextColor(...green);
        doc.setFontSize(10);
        doc.setFont('helvetica', 'bold');
        doc.text('Payment Details', 15, y);
        doc.setDrawColor(...green);
        doc.setLineWidth(0.5);
        doc.line(15, y + 2, pageW - 15, y + 2);
        y += 9;

        doc.setTextColor(...black);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        doc.text('Bank Transfer:', 15, y);
        y += 5;
        doc.text(`Sort Code: ${BUSINESS.sortCode}`, 20, y); y += 4.5;
        doc.text(`Account: ${BUSINESS.account}`, 20, y); y += 4.5;
        doc.text(`Name: ${BUSINESS.accountName}`, 20, y); y += 4.5;
        doc.text(`Reference: ${data.invoiceNumber}`, 20, y); y += 7;

        // ── Notes ──
        if (data.notes) {
            y += 2;
            doc.setTextColor(...green);
            doc.setFontSize(10);
            doc.setFont('helvetica', 'bold');
            doc.text('Notes', 15, y);
            doc.line(15, y + 2, pageW - 15, y + 2);
            y += 9;
            doc.setTextColor(...gray);
            doc.setFontSize(9);
            doc.setFont('helvetica', 'normal');
            const lines = doc.splitTextToSize(data.notes, pageW - 30);
            doc.text(lines, 15, y);
            y += lines.length * 4.5;
        }

        // ── Footer ──
        const footY = doc.internal.pageSize.getHeight() - 12;
        doc.setFillColor(245, 249, 245);
        doc.rect(0, footY - 6, pageW, 18, 'F');
        doc.setTextColor(...gray);
        doc.setFontSize(7.5);
        doc.text(`${BUSINESS.name}  ·  ${BUSINESS.website}  ·  ${BUSINESS.phone}  ·  ${BUSINESS.email}`, pageW / 2, footY, { align: 'center' });

        return doc;
    }

    // ── DOWNLOAD PDF ──
    downloadBtn.addEventListener('click', () => {
        const data = getInvoiceData();
        if (!validate(data)) return;
        const doc = generatePdf(data);
        doc.save(`${data.invoiceNumber}.pdf`);
        showStatus('PDF downloaded!', 'success');
    });

    // ── PREVIEW (scroll to preview on mobile) ──
    previewBtn.addEventListener('click', () => {
        updatePreview();
        document.getElementById('previewPanel').scrollIntoView({ behavior: 'smooth' });
    });

    // ── SEND INVOICE ──
    sendBtn.addEventListener('click', async () => {
        const data = getInvoiceData();
        if (!validate(data)) return;

        const useStripe = data.stripeEnabled;

        sendBtn.disabled = true;
        sendBtn.innerHTML = useStripe
            ? '<i class="fas fa-spinner fa-spin"></i> Creating Stripe Invoice...'
            : '<i class="fas fa-spinner fa-spin"></i> Generating PDF...';

        try {
            if (useStripe) {
                // ── Stripe flow: send to Apps Script which creates Stripe invoice ──
                const stripePayload = {
                    action: 'stripe_invoice',
                    invoiceNumber: data.invoiceNumber,
                    jobNumber: currentJobNumber,
                    customer: data.customer,
                    items: data.items.map(i => ({
                        description: i.description,
                        qty: i.qty,
                        unitAmount: Math.round(i.price * 100) // Stripe uses pence
                    })),
                    discountPercent: discountType.value === 'percent' ? (parseFloat(discountValue.value) || 0) : 0,
                    discountFixed: discountType.value === 'fixed' ? Math.round((parseFloat(discountValue.value) || 0) * 100) : 0,
                    notes: data.notes,
                    dueDate: data.dueDate,
                    business: BUSINESS
                };

                const resp = await fetch(STRIPE_WEBHOOK, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(stripePayload),
                    mode: 'no-cors'
                });

                // Google Apps Script with no-cors returns opaque, so we assume success
                // Also send Telegram notification
                await sendTelegramNotification(data, true);

                // Also download PDF for your records
                const doc = generatePdf(data);
                doc.save(`${data.invoiceNumber}.pdf`);

                // Save to history
                saveToHistory(data);

                showStatus(
                    `✅ <strong>Stripe invoice sent!</strong> ${data.customer.name} (${data.customer.email}) will receive a professional Stripe invoice with a secure payment link. PDF also downloaded for your records.`,
                    'success'
                );

            } else {
                // ── Bank-only flow: just generate PDF ──
                const doc = generatePdf(data);
                doc.save(`${data.invoiceNumber}.pdf`);

                await sendTelegramNotification(data, false);
                saveToHistory(data);

                showStatus(
                    `✅ PDF downloaded as <strong>${data.invoiceNumber}.pdf</strong>. Send it to the customer via email or WhatsApp.`,
                    'success'
                );
            }

        } catch (err) {
            console.error('Invoice send error:', err);
            // Fallback — at least download the PDF
            try {
                const doc = generatePdf(data);
                doc.save(`${data.invoiceNumber}.pdf`);
            } catch(e) {}
            showStatus('⚠️ There was an issue sending the Stripe invoice, but the PDF has been downloaded. You can retry or email it manually.', 'warning');
        }

        sendBtn.disabled = false;
        sendBtn.innerHTML = data.stripeEnabled
            ? '<i class="fab fa-stripe-s"></i> Send Stripe Invoice'
            : '<i class="fas fa-download"></i> Generate & Download PDF';
    });

    // ── Build email HTML ──
    function buildEmailHtml(data) {
        const itemRows = data.items.map(i =>
            `<tr>
                <td style="padding:10px 12px;border-bottom:1px solid #eee;">${escHtml(i.description)}</td>
                <td style="padding:10px 12px;border-bottom:1px solid #eee;text-align:center;">${i.qty}</td>
                <td style="padding:10px 12px;border-bottom:1px solid #eee;text-align:right;">£${i.price.toFixed(2)}</td>
                <td style="padding:10px 12px;border-bottom:1px solid #eee;text-align:right;font-weight:600;">£${i.total.toFixed(2)}</td>
            </tr>`
        ).join('');

        let paymentSection = `
            <div style="margin-top:24px;padding:16px;background:#f5f9f5;border-radius:8px;">
                <h3 style="color:#2E7D32;margin:0 0 12px 0;font-size:15px;">Payment Details</h3>
                <p style="margin:4px 0;font-size:13px;"><strong>Bank Transfer:</strong></p>
                <p style="margin:2px 0;font-size:13px;">Sort Code: ${BUSINESS.sortCode}</p>
                <p style="margin:2px 0;font-size:13px;">Account: ${BUSINESS.account}</p>
                <p style="margin:2px 0;font-size:13px;">Name: ${BUSINESS.accountName}</p>
                <p style="margin:2px 0;font-size:13px;">Reference: ${data.invoiceNumber}</p>
            </div>`;

        if (data.stripeLink) {
            paymentSection += `
            <div style="text-align:center;margin-top:20px;">
                <a href="${data.stripeLink}" style="display:inline-block;padding:14px 36px;background:#2E7D32;color:#fff;text-decoration:none;border-radius:50px;font-weight:600;font-size:15px;">
                    💳 Pay Online Now
                </a>
                <p style="font-size:11px;color:#999;margin-top:8px;">Secure payment powered by Stripe</p>
            </div>`;
        }

        return `
        <div style="max-width:600px;margin:0 auto;font-family:Arial,sans-serif;color:#333;">
            <div style="background:#2E7D32;padding:24px;border-radius:12px 12px 0 0;text-align:center;">
                <h1 style="color:#fff;margin:0;font-size:20px;">🌿 ${BUSINESS.name}</h1>
                <p style="color:rgba(255,255,255,0.85);margin:6px 0 0;font-size:13px;">${BUSINESS.address} · ${BUSINESS.phone}</p>
            </div>
            <div style="padding:24px;background:#fff;border:1px solid #e8ede8;border-top:none;">
                <div style="display:flex;justify-content:space-between;margin-bottom:20px;">
                    <div>
                        <p style="margin:0;font-size:13px;color:#666;">Invoice</p>
                        <p style="margin:2px 0;font-weight:700;font-size:17px;">${data.invoiceNumber}</p>
                    </div>
                    <div style="text-align:right;">
                        <p style="margin:0;font-size:13px;color:#666;">Date: ${formatDateDisplay(data.invoiceDate)}</p>
                        <p style="margin:2px 0;font-size:13px;color:#666;">Due: ${formatDateDisplay(data.dueDate)}</p>
                    </div>
                </div>
                <div style="margin-bottom:20px;padding:12px;background:#f5f9f5;border-radius:8px;">
                    <p style="margin:0;font-size:12px;color:#666;">Bill To:</p>
                    <p style="margin:4px 0;font-weight:600;">${escHtml(data.customer.name)}</p>
                    <p style="margin:2px 0;font-size:13px;">${escHtml(data.customer.address)}, ${escHtml(data.customer.postcode)}</p>
                </div>
                <table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
                    <thead>
                        <tr style="background:#2E7D32;color:#fff;">
                            <th style="padding:10px 12px;text-align:left;font-size:13px;">Description</th>
                            <th style="padding:10px 12px;text-align:center;font-size:13px;">Qty</th>
                            <th style="padding:10px 12px;text-align:right;font-size:13px;">Price</th>
                            <th style="padding:10px 12px;text-align:right;font-size:13px;">Total</th>
                        </tr>
                    </thead>
                    <tbody>${itemRows}</tbody>
                </table>
                <div style="text-align:right;margin-top:12px;">
                    <p style="margin:4px 0;font-size:13px;color:#666;">Subtotal: £${data.subtotal.toFixed(2)}</p>
                    ${data.discountAmt > 0 ? `<p style="margin:4px 0;font-size:13px;color:#666;">Discount: -£${data.discountAmt.toFixed(2)}</p>` : ''}
                    <p style="margin:8px 0 0;font-size:20px;font-weight:700;color:#2E7D32;">Total: £${data.grandTotal.toFixed(2)}</p>
                </div>
                ${paymentSection}
                ${data.notes ? `<div style="margin-top:20px;padding:12px;border-left:3px solid #2E7D32;background:#f9f9f9;font-size:13px;color:#666;">${escHtml(data.notes)}</div>` : ''}
            </div>
            <div style="text-align:center;padding:16px;font-size:11px;color:#999;">
                ${BUSINESS.name} · ${BUSINESS.website} · ${BUSINESS.phone} · ${BUSINESS.email}
            </div>
        </div>`;
    }

    // ── Telegram Notification ──
    async function sendTelegramNotification(data, viaStripe) {
        const method = viaStripe ? '💳 Via Stripe (auto-emailed to customer with photos)' : '📄 PDF only (manual send)';
        const photoCount = currentJobPhotos.before.length + currentJobPhotos.after.length;
        const photoLine = photoCount > 0
            ? `📸 *Photos:* ${currentJobPhotos.before.length} before, ${currentJobPhotos.after.length} after\n`
            : '📸 *Photos:* None attached\n';
        const jobLine = currentJobNumber ? `🔖 *Job:* ${currentJobNumber}\n` : '';
        const statusLine = viaStripe ? '⏳ *Status:* Balance Due (awaiting Stripe payment)\n' : '';
        const msg = `📄 *INVOICE SENT*\n\n` +
            `🔢 *Invoice:* ${data.invoiceNumber}\n` +
            jobLine +
            `👤 *To:* ${data.customer.name}\n` +
            `📧 *Email:* ${data.customer.email}\n` +
            `💰 *Amount:* £${data.grandTotal.toFixed(2)}\n` +
            `📅 *Due:* ${formatDateDisplay(data.dueDate)}\n` +
            photoLine +
            statusLine +
            `${method}\n` +
            `\n_Sent from gardnersgm.co.uk invoice generator_`;

        try {
            await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: TG_CHAT_ID,
                    text: msg,
                    parse_mode: 'Markdown',
                    disable_web_page_preview: true
                })
            });
        } catch (e) {
            console.error('Telegram notification failed:', e);
        }
    }

    // ── VALIDATION ──
    function validate(data) {
        const errors = [];
        if (!data.customer.name) errors.push('Customer name is required');
        if (!data.customer.email) errors.push('Customer email is required');
        if (data.items.length === 0) errors.push('Add at least one line item');
        if (data.grandTotal <= 0) errors.push('Invoice total must be greater than £0');

        if (errors.length) {
            showStatus('⚠️ ' + errors.join('. ') + '.', 'error');
            return false;
        }
        return true;
    }

    // ── STATUS MESSAGE ──
    function showStatus(message, type) {
        statusEl.style.display = 'block';
        statusEl.className = 'invoice-status status-' + type;
        statusEl.innerHTML = message;
        statusEl.scrollIntoView({ behavior: 'smooth', block: 'center' });

        if (type === 'success') {
            setTimeout(() => { statusEl.style.display = 'none'; }, 8000);
        }
    }

    // ── HISTORY (localStorage) ──
    function saveToHistory(data) {
        const history = JSON.parse(localStorage.getItem('ggm_invoice_history') || '[]');
        history.unshift({
            invoiceNumber: data.invoiceNumber,
            customer: data.customer.name,
            email: data.customer.email,
            total: data.grandTotal,
            date: data.invoiceDate,
            dueDate: data.dueDate,
            sentAt: new Date().toISOString()
        });
        // Keep last 50
        if (history.length > 50) history.length = 50;
        localStorage.setItem('ggm_invoice_history', JSON.stringify(history));
        renderHistory();
    }

    function renderHistory() {
        const history = JSON.parse(localStorage.getItem('ggm_invoice_history') || '[]');
        if (history.length === 0) {
            historyEl.innerHTML = '<div class="history-empty"><i class="fas fa-inbox"></i> No invoices created yet</div>';
            return;
        }

        historyEl.innerHTML = history.map(h => `
            <div class="history-row">
                <div class="history-number">${h.invoiceNumber}</div>
                <div class="history-customer">${escHtml(h.customer)}</div>
                <div class="history-amount">£${h.total.toFixed(2)}</div>
                <div class="history-date">${formatDateDisplay(h.date)}</div>
                <div class="history-badge">Sent</div>
            </div>
        `).join('');
    }

    // ── INIT ──
    initInvoiceNumber();
    initDates();
    addLineItem(); // Start with one empty row
    prefillFromUrl();
    updatePreview();
    renderHistory();
    loadClientsForInvoice();
});
