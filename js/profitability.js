/* ============================================
   Gardners Ground Maintenance — Profitability Tracker JS
   Business P&L: monthly overheads, per-job profitability,
   fuel costs from distance, overhead allocation, outstanding
   payments. Data from Google Sheets "Business Costs" tab.
   ============================================ */

document.addEventListener('DOMContentLoaded', () => {

    const SHEETS_WEBHOOK = 'https://script.google.com/macros/s/AKfycbxsikmv8R-c3y4mz093lQ78bpD3xaEBHZNUorW0BmF1D3JxWHCsMAi9UUGRdF60U92uAQ/exec';

    let allJobs     = [];
    let costData    = [];  // rows from Business Costs sheet
    let selectedMonth = '';

    // Overhead field IDs mapped to sheet columns
    const OVERHEAD_FIELDS = [
        { id: 'pfVehicleInsurance', label: 'Vehicle Insurance',        icon: 'fa-car',              color: '#1565C0' },
        { id: 'pfPublicLiability',  label: 'Public Liability',         icon: 'fa-shield-alt',       color: '#0277BD' },
        { id: 'pfEquipmentMaint',   label: 'Equipment Maintenance',    icon: 'fa-wrench',           color: '#00838F' },
        { id: 'pfVehicleMaint',     label: 'Vehicle Maintenance',      icon: 'fa-oil-can',          color: '#00695C' },
        { id: 'pfFuelRate',         label: 'Fuel Rate/Mile',           icon: 'fa-gas-pump',         color: '#E65100' },
        { id: 'pfMarketing',        label: 'Marketing',                icon: 'fa-bullhorn',         color: '#AD1457' },
        { id: 'pfNatInsurance',     label: 'National Insurance',       icon: 'fa-landmark',         color: '#4527A0' },
        { id: 'pfIncomeTax',        label: 'Income Tax Reserve',       icon: 'fa-file-invoice-dollar', color: '#283593' },
        { id: 'pfPhoneInternet',    label: 'Phone / Internet',         icon: 'fa-phone',            color: '#558B2F' },
        { id: 'pfSoftware',         label: 'Software / Subscriptions', icon: 'fa-laptop',           color: '#F57F17' },
        { id: 'pfAccountancy',      label: 'Accountancy',              icon: 'fa-calculator',       color: '#6D4C41' },
        { id: 'pfWasteDisposal',    label: 'Waste Disposal / Tips',    icon: 'fa-trash',            color: '#4E342E' },
        { id: 'pfTreatmentProducts',label: 'Treatment Products',       icon: 'fa-flask',            color: '#1B5E20' },
        { id: 'pfConsumables',      label: 'Consumables & Supplies',   icon: 'fa-box-open',         color: '#BF360C' },
        { id: 'pfOther',            label: 'Other Costs',              icon: 'fa-ellipsis-h',       color: '#757575' }
    ];

    // Per-service material/supply cost estimates (£ per job)
    // These represent the average product cost you incur for each service type
    const SERVICE_MATERIAL_COSTS = {
        'lawn cutting':      { cost: 1.50, label: 'Fuel/oil/blades' },
        'lawn-cutting':      { cost: 1.50, label: 'Fuel/oil/blades' },
        'hedge trimming':    { cost: 2.00, label: 'Fuel/blades/bags' },
        'hedge-trimming':    { cost: 2.00, label: 'Fuel/blades/bags' },
        'lawn treatment':    { cost: 12.00, label: 'Feed/weed/moss killer' },
        'lawn-treatment':    { cost: 12.00, label: 'Feed/weed/moss killer' },
        'scarifying':        { cost: 15.00, label: 'Seed/top dressing/feed' },
        'garden clearance':  { cost: 25.00, label: 'Waste disposal/skip' },
        'garden-clearance':  { cost: 25.00, label: 'Waste disposal/skip' },
        'power washing':     { cost: 5.00, label: 'Fuel/sealant/sand' },
        'power-washing':     { cost: 5.00, label: 'Fuel/sealant/sand' }
    };

    // Equipment fuel cost per job (litres × £1.45/litre) — matches Code.gs CORNWALL_COSTS
    const EQUIPMENT_FUEL_COSTS = {
        'lawn cutting': 2.18, 'lawn-cutting': 2.18,           // 1.5L × £1.45
        'hedge trimming': 1.16, 'hedge-trimming': 1.16,       // 0.8L × £1.45
        'lawn treatment': 0.44, 'lawn-treatment': 0.44,       // 0.3L × £1.45
        'scarifying': 2.90,                                     // 2.0L × £1.45
        'garden clearance': 3.63, 'garden-clearance': 3.63,   // 2.5L × £1.45
        'power washing': 4.35, 'power-washing': 4.35           // 3.0L × £1.45
    };

    // Equipment wear/maintenance cost per job (£) — blades, parts, servicing
    const EQUIPMENT_WEAR_COSTS = {
        'lawn cutting': 1.50, 'lawn-cutting': 1.50,
        'hedge trimming': 1.80, 'hedge-trimming': 1.80,
        'lawn treatment': 0.50, 'lawn-treatment': 0.50,
        'scarifying': 3.00,
        'garden clearance': 2.00, 'garden-clearance': 2.00,
        'power washing': 1.20, 'power-washing': 1.20
    };

    // Waste disposal cost per job (£)
    const WASTE_DISPOSAL_COSTS = {
        'lawn cutting': 0, 'lawn-cutting': 0,
        'hedge trimming': 5.00, 'hedge-trimming': 5.00,
        'lawn treatment': 0, 'lawn-treatment': 0,
        'scarifying': 3.00,
        'garden clearance': 35.00, 'garden-clearance': 35.00,
        'power washing': 0, 'power-washing': 0
    };


    // ============================================
    // MONTH SELECTOR
    // ============================================
    function populateMonthSelect() {
        const sel = document.getElementById('pfMonthSelect');
        const now = new Date();
        sel.innerHTML = '';
        // Show current month + 11 previous months
        for (let i = 0; i < 12; i++) {
            const d  = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const val = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
            const label = d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
            sel.innerHTML += `<option value="${val}"${i === 0 ? ' selected' : ''}>${label}</option>`;
        }
        selectedMonth = sel.value;
        sel.addEventListener('change', () => { selectedMonth = sel.value; loadOverheadsForMonth(); recalculate(); });
    }


    // ============================================
    // LOAD DATA
    // ============================================
    async function loadAll() {
        await Promise.all([loadJobs(), loadCosts()]);
        loadOverheadsForMonth();
        recalculate();
    }

    async function loadJobs() {
        try {
            const resp = await fetch(SHEETS_WEBHOOK + '?action=get_clients');
            const data = await resp.json();
            if (data.status === 'success' && data.clients) {
                allJobs = data.clients.map(c => {
                    c.isSubscription = (c.type || '').toLowerCase().includes('subscription');
                    c.isPaid = c.paid === 'Yes' || c.paid === 'Auto' ||
                               (c.paymentType || '').toLowerCase().includes('stripe');
                    c.priceNum = parsePrice(c.price);
                    c.distNum  = parseDistance(c.distance);
                    c.monthKey = getMonthKey(c.date || c.timestamp);
                    return c;
                });
            }
        } catch (e) { console.error('Failed to load jobs:', e); }
    }

    async function loadCosts() {
        try {
            const resp = await fetch(SHEETS_WEBHOOK + '?action=get_business_costs');
            const data = await resp.json();
            if (data.status === 'success') {
                costData = data.costs || [];
            }
        } catch (e) {
            console.error('Failed to load business costs:', e);
            costData = [];
        }
    }


    // ============================================
    // OVERHEAD FORM — LOAD / SAVE
    // ============================================
    function loadOverheadsForMonth() {
        const row = costData.find(r => r.month === selectedMonth);
        if (row) {
            document.getElementById('pfVehicleInsurance').value = row.vehicleInsurance || '';
            document.getElementById('pfPublicLiability').value  = row.publicLiability || '';
            document.getElementById('pfEquipmentMaint').value   = row.equipmentMaint || '';
            document.getElementById('pfVehicleMaint').value     = row.vehicleMaint || '';
            document.getElementById('pfFuelRate').value          = row.fuelRate || '0.45';
            document.getElementById('pfMarketing').value         = row.marketing || '';
            document.getElementById('pfNatInsurance').value      = row.natInsurance || '';
            document.getElementById('pfIncomeTax').value         = row.incomeTax || '';
            document.getElementById('pfPhoneInternet').value     = row.phoneInternet || '';
            document.getElementById('pfSoftware').value          = row.software || '';
            document.getElementById('pfAccountancy').value       = row.accountancy || '';
            document.getElementById('pfWasteDisposal').value     = row.wasteDisposal || '';
            document.getElementById('pfTreatmentProducts').value = row.treatmentProducts || '';
            document.getElementById('pfConsumables').value       = row.consumables || '';
            document.getElementById('pfOther').value             = row.other || '';
        } else {
            // Default: keep fuel rate, clear rest
            OVERHEAD_FIELDS.forEach(f => {
                const el = document.getElementById(f.id);
                if (f.id !== 'pfFuelRate') el.value = '';
            });
        }
        updateOverheadTotal();
    }

    function getOverheadValues() {
        return {
            month:            selectedMonth,
            vehicleInsurance: pv('pfVehicleInsurance'),
            publicLiability:  pv('pfPublicLiability'),
            equipmentMaint:   pv('pfEquipmentMaint'),
            vehicleMaint:     pv('pfVehicleMaint'),
            fuelRate:         pv('pfFuelRate') || 0.45,
            marketing:        pv('pfMarketing'),
            natInsurance:     pv('pfNatInsurance'),
            incomeTax:        pv('pfIncomeTax'),
            phoneInternet:    pv('pfPhoneInternet'),
            software:         pv('pfSoftware'),
            accountancy:      pv('pfAccountancy'),
            wasteDisposal:    pv('pfWasteDisposal'),
            treatmentProducts:pv('pfTreatmentProducts'),
            consumables:      pv('pfConsumables'),
            other:            pv('pfOther')
        };
    }

    function pv(id) { return parseFloat(document.getElementById(id).value) || 0; }

    function getMonthlyOverheadTotal(vals) {
        return (vals.vehicleInsurance || 0) + (vals.publicLiability || 0) +
               (vals.equipmentMaint || 0) + (vals.vehicleMaint || 0) +
               (vals.marketing || 0) + (vals.natInsurance || 0) +
               (vals.incomeTax || 0) + (vals.phoneInternet || 0) +
               (vals.software || 0) + (vals.accountancy || 0) +
               (vals.wasteDisposal || 0) + (vals.treatmentProducts || 0) +
               (vals.consumables || 0) + (vals.other || 0);
    }

    function updateOverheadTotal() {
        const vals = getOverheadValues();
        const total = getMonthlyOverheadTotal(vals);
        document.getElementById('pfOverheadTotal').textContent = '£' + total.toFixed(2);
    }

    // Live update overhead total as user types
    OVERHEAD_FIELDS.forEach(f => {
        document.getElementById(f.id).addEventListener('input', () => { updateOverheadTotal(); recalculate(); });
    });

    // Save overheads
    document.getElementById('pfSaveOverheads').addEventListener('click', async () => {
        const btn  = document.getElementById('pfSaveOverheads');
        const vals = getOverheadValues();
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
        btn.disabled  = true;

        try {
            await fetch(SHEETS_WEBHOOK, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain' },
                body: JSON.stringify({ action: 'save_business_costs', ...vals })
            });
            // Update local cache
            const idx = costData.findIndex(r => r.month === selectedMonth);
            if (idx >= 0) costData[idx] = vals;
            else costData.push(vals);

            btn.innerHTML = '<i class="fas fa-check"></i> Saved!';
            setTimeout(() => { btn.innerHTML = '<i class="fas fa-save"></i> Save Overheads'; btn.disabled = false; }, 1500);
        } catch (e) {
            btn.innerHTML = '<i class="fas fa-exclamation-triangle"></i> Error';
            btn.disabled  = false;
        }
    });


    // ============================================
    // CALCULATIONS
    // ============================================
    function recalculate() {
        const vals        = getOverheadValues();
        const fuelRate    = vals.fuelRate || 0.45;
        const overheadTot = getMonthlyOverheadTotal(vals);

        // Filter jobs for selected month (non-cancelled)
        const monthJobs = allJobs.filter(j => {
            if (!j.monthKey) return false;
            const s = (j.status || '').toLowerCase();
            if (s === 'cancelled' || s === 'canceled') return false;
            return j.monthKey === selectedMonth;
        });

        const jobCount    = monthJobs.length;
        const overheadPer = jobCount > 0 ? overheadTot / jobCount : 0;

        let totalRevenue  = 0;
        let totalFuel     = 0;
        let totalMaterials = 0;
        let totalProfit   = 0;

        const jobRows = monthJobs.map(j => {
            const revenue    = j.priceNum || 0;
            const fuelCost   = (j.distNum || 0) * 2 * fuelRate; // round trip van fuel
            // Per-job material cost based on service type
            const svcKey     = (j.service || '').toLowerCase().trim();
            const matInfo    = SERVICE_MATERIAL_COSTS[svcKey] || { cost: 0, label: '—' };
            const materialCost = matInfo.cost;
            // Equipment fuel, wear, and waste disposal (matches Code.gs CORNWALL_COSTS)
            const equipFuel    = EQUIPMENT_FUEL_COSTS[svcKey] || 0;
            const equipWear    = EQUIPMENT_WEAR_COSTS[svcKey] || 0;
            const wasteDisp    = WASTE_DISPOSAL_COSTS[svcKey] || 0;
            const totalCost  = fuelCost + materialCost + equipFuel + equipWear + wasteDisp + overheadPer;
            const netProfit  = revenue - totalCost;
            const margin     = revenue > 0 ? (netProfit / revenue * 100) : 0;

            totalRevenue += revenue;
            totalFuel    += fuelCost;
            totalMaterials += materialCost + equipFuel + equipWear + wasteDisp;
            totalProfit  += netProfit;

            return { ...j, revenue, fuelCost, materialCost, materialLabel: matInfo.label, equipFuel, equipWear, wasteDisp, overheadPer, totalCost, netProfit, margin };
        });

        const totalCosts  = totalFuel + totalMaterials + overheadTot;
        const profitMargin = totalRevenue > 0 ? (totalProfit / totalRevenue * 100) : 0;
        const avgProfit    = jobCount > 0 ? totalProfit / jobCount : 0;

        // Update dashboard
        document.getElementById('pfTotalRevenue').textContent  = '£' + totalRevenue.toFixed(2);
        document.getElementById('pfTotalCosts').textContent    = '£' + totalCosts.toFixed(2);
        document.getElementById('pfNetProfit').textContent     = '£' + totalProfit.toFixed(2);
        document.getElementById('pfProfitMargin').textContent  = profitMargin.toFixed(1) + '%';
        document.getElementById('pfJobCount').textContent      = jobCount;
        document.getElementById('pfAvgProfit').textContent     = '£' + avgProfit.toFixed(2);

        // Color profit based on positive/negative
        const profitEl = document.getElementById('pfNetProfit');
        profitEl.style.color = totalProfit >= 0 ? '#2E7D32' : '#e53935';
        const marginEl = document.getElementById('pfProfitMargin');
        marginEl.style.color = profitMargin >= 0 ? '#2E7D32' : '#e53935';

        // Revenue vs Costs gauge
        updateGauge(totalRevenue, totalCosts, totalProfit);

        // Cost breakdown bars
        renderCostBars(vals, totalFuel, totalMaterials, overheadTot);

        // Per-job table
        renderJobTable(jobRows, totalRevenue, totalFuel, totalMaterials, overheadTot, totalProfit);

        // Outstanding payments
        renderOutstanding();
    }


    // ============================================
    // REVENUE VS COSTS GAUGE
    // ============================================
    function updateGauge(revenue, costs, profit) {
        const max = Math.max(revenue, costs, 1);
        document.getElementById('pfGaugeRevenue').style.width = (revenue / max * 100) + '%';
        document.getElementById('pfGaugeCosts').style.width   = (costs / max * 100) + '%';
        document.getElementById('pfGaugeRevLabel').textContent  = '£' + revenue.toFixed(2);
        document.getElementById('pfGaugeCostLabel').textContent = '£' + costs.toFixed(2);
        document.getElementById('pfGaugeProfLabel').textContent = '£' + profit.toFixed(2);
    }


    // ============================================
    // COST BREAKDOWN BARS
    // ============================================
    function renderCostBars(vals, totalFuel, totalMaterials, overheadTot) {
        const container = document.getElementById('pfCostBars');
        const items = [
            { label: 'Fuel (all jobs)',         value: totalFuel,             color: '#E65100' },
            { label: 'Materials (per-job)',     value: totalMaterials,        color: '#1B5E20' },
            { label: 'Waste Disposal / Tips',   value: vals.wasteDisposal,    color: '#4E342E' },
            { label: 'Treatment Products',      value: vals.treatmentProducts, color: '#33691E' },
            { label: 'Consumables & Supplies',  value: vals.consumables,      color: '#BF360C' },
            { label: 'Vehicle Insurance',       value: vals.vehicleInsurance, color: '#1565C0' },
            { label: 'Public Liability',        value: vals.publicLiability,  color: '#0277BD' },
            { label: 'Equipment Maintenance',   value: vals.equipmentMaint,   color: '#00838F' },
            { label: 'Vehicle Maintenance',     value: vals.vehicleMaint,     color: '#00695C' },
            { label: 'Marketing',               value: vals.marketing,        color: '#AD1457' },
            { label: 'National Insurance',      value: vals.natInsurance,     color: '#4527A0' },
            { label: 'Income Tax Reserve',      value: vals.incomeTax,        color: '#283593' },
            { label: 'Phone / Internet',        value: vals.phoneInternet,    color: '#558B2F' },
            { label: 'Software / Subs',         value: vals.software,         color: '#F57F17' },
            { label: 'Accountancy',             value: vals.accountancy,      color: '#6D4C41' },
            { label: 'Other',                   value: vals.other,            color: '#757575' }
        ].filter(i => i.value > 0);

        const maxVal = Math.max(...items.map(i => i.value), 1);

        container.innerHTML = items.map(i => `
            <div class="pf-bar-row">
                <span class="pf-bar-label">${i.label}</span>
                <div class="pf-bar-track">
                    <div class="pf-bar-fill" style="width:${(i.value/maxVal*100).toFixed(1)}%;background:${i.color}"></div>
                </div>
                <span class="pf-bar-value">£${i.value.toFixed(2)}</span>
            </div>`).join('') || '<p style="color:#999;text-align:center;padding:2rem;">Set your monthly overheads above</p>';
    }


    // ============================================
    // PER-JOB PROFITABILITY TABLE
    // ============================================
    function renderJobTable(jobRows, totalRev, totalFuel, totalMaterials, overheadTot, totalProf) {
        const tbody = document.getElementById('pfJobTableBody');
        const tfoot = document.getElementById('pfJobTableFoot');

        if (!jobRows.length) {
            tbody.innerHTML = '<tr><td colspan="11" style="text-align:center;color:#999;padding:2rem;">No jobs found for this month</td></tr>';
            tfoot.innerHTML = '';
            return;
        }

        // Sort by profit margin (lowest first to highlight problems)
        jobRows.sort((a, b) => a.margin - b.margin);

        tbody.innerHTML = jobRows.map(j => {
            const profitClass = j.netProfit >= 0 ? 'pf-profit-pos' : 'pf-profit-neg';
            const dateStr = j.date ? formatDateShort(j.date) : '—';
            const jobCostsBreakdown = `Materials: £${j.materialCost.toFixed(2)}\nEquip fuel: £${j.equipFuel.toFixed(2)}\nEquip wear: £${j.equipWear.toFixed(2)}\nWaste: £${j.wasteDisp.toFixed(2)}`;
            return `
            <tr class="pf-table-row ${profitClass}">
                <td><strong>${esc(j.name || '—')}</strong></td>
                <td>${esc(j.service || '—')}</td>
                <td>${dateStr}</td>
                <td>${j.isSubscription ? '<i class="fas fa-sync-alt"></i> Sub' : '<i class="fas fa-calendar-check"></i> One-off'}</td>
                <td>£${j.revenue.toFixed(2)}</td>
                <td>£${j.fuelCost.toFixed(2)}</td>
                <td title="${jobCostsBreakdown}">£${(j.materialCost + j.equipFuel + j.equipWear + j.wasteDisp).toFixed(2)}</td>
                <td>£${j.overheadPer.toFixed(2)}</td>
                <td>£${j.totalCost.toFixed(2)}</td>
                <td class="${profitClass}"><strong>£${j.netProfit.toFixed(2)}</strong></td>
                <td class="${profitClass}">${j.margin.toFixed(1)}%</td>
            </tr>`;
        }).join('');

        const totalCosts = totalFuel + totalMaterials + overheadTot;
        const margin = totalRev > 0 ? (totalProf / totalRev * 100) : 0;
        tfoot.innerHTML = `
            <tr class="pf-table-totals">
                <td colspan="4"><strong>TOTALS</strong></td>
                <td><strong>£${totalRev.toFixed(2)}</strong></td>
                <td><strong>£${totalFuel.toFixed(2)}</strong></td>
                <td><strong>£${totalMaterials.toFixed(2)}</strong></td>
                <td><strong>£${overheadTot.toFixed(2)}</strong></td>
                <td><strong>£${totalCosts.toFixed(2)}</strong></td>
                <td class="${totalProf >= 0 ? 'pf-profit-pos':'pf-profit-neg'}"><strong>£${totalProf.toFixed(2)}</strong></td>
                <td class="${margin >= 0 ? 'pf-profit-pos':'pf-profit-neg'}"><strong>${margin.toFixed(1)}%</strong></td>
            </tr>`;
    }


    // ============================================
    // OUTSTANDING PAYMENTS
    // ============================================
    function renderOutstanding() {
        const tbody = document.getElementById('pfOutstandingBody');
        const unpaid = allJobs.filter(j => {
            const s = (j.status || '').toLowerCase();
            return !j.isPaid && j.priceNum > 0 && s !== 'cancelled' && s !== 'canceled';
        });

        if (!unpaid.length) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#999;padding:2rem;">No outstanding payments! All caught up.</td></tr>';
            document.getElementById('pfOutstandingTotal').textContent = '£0.00';
            return;
        }

        let total = 0;
        tbody.innerHTML = unpaid.map(j => {
            total += j.priceNum;
            return `
            <tr class="pf-table-row">
                <td><strong>${esc(j.name || '—')}</strong></td>
                <td>${esc(j.service || '—')}</td>
                <td>${j.date ? formatDateShort(j.date) : '—'}</td>
                <td class="pf-profit-neg"><strong>£${j.priceNum.toFixed(2)}</strong></td>
                <td><span class="jm-tag jm-tag-unpaid"><i class="fas fa-clock"></i> ${esc(j.status || 'Unpaid')}</span></td>
                <td><a href="invoice.html?name=${encodeURIComponent(j.name||'')}&email=${encodeURIComponent(j.email||'')}&service=${encodeURIComponent(j.service||'')}" class="btn btn-sm btn-outline-green"><i class="fas fa-file-invoice-pound"></i> Invoice</a></td>
            </tr>`;
        }).join('');

        document.getElementById('pfOutstandingTotal').textContent = '£' + total.toFixed(2);
    }


    // ============================================
    // HELPERS
    // ============================================
    function parsePrice(p) {
        if (!p) return 0;
        const n = parseFloat(String(p).replace(/[^0-9.]/g, ''));
        return isNaN(n) ? 0 : n;
    }

    function parseDistance(d) {
        if (!d) return 0;
        // Handle "12.3 miles", "12.3 mi", or just "12.3"
        const n = parseFloat(String(d).replace(/[^0-9.]/g, ''));
        return isNaN(n) ? 0 : n;
    }

    function getMonthKey(dateStr) {
        if (!dateStr) return null;
        // Handle "Monday, 14 March 2026" format
        if (typeof dateStr === 'string' && dateStr.includes(',')) {
            const cleaned = dateStr.replace(/^[A-Za-z]+,\s*/, '');
            const d = new Date(cleaned);
            if (!isNaN(d)) return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
        }
        const d = new Date(dateStr);
        if (!isNaN(d)) return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
        return null;
    }

    function formatDateShort(ds) {
        if (!ds) return '';
        if (typeof ds === 'string' && ds.includes(',')) return ds.replace(/^[A-Za-z]+,\s*/, '');
        try { const d = new Date(ds); return isNaN(d) ? String(ds) : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); }
        catch (e) { return String(ds); }
    }

    function esc(str) { const d = document.createElement('div'); d.textContent = str; return d.innerHTML; }


    // ============================================
    // SERVICE COST COVERAGE ANALYSIS
    // ============================================
    const SERVICE_PRICING = {
        'lawn-cutting':     { price: 30,  hours: 1, materials: 1.50 },
        'hedge-trimming':   { price: 60,  hours: 3, materials: 2.00 },
        'lawn-treatment':   { price: 45,  hours: 2, materials: 12.00 },
        'scarifying':       { price: 80,  hours: 8, materials: 15.00 },
        'garden-clearance': { price: 100, hours: 8, materials: 25.00 },
        'power-washing':    { price: 60,  hours: 8, materials: 5.00 }
    };

    const SERVICE_LABELS = {
        'lawn-cutting': 'Lawn Cutting',
        'hedge-trimming': 'Hedge Trimming',
        'lawn-treatment': 'Lawn Treatment',
        'scarifying': 'Scarifying & Aeration',
        'garden-clearance': 'Garden Clearance',
        'power-washing': 'Power Washing'
    };

    function renderCostCoverage(avgDistanceMiles) {
        const body = document.getElementById('pfCoverageBody');
        const summary = document.getElementById('pfCoverageSummary');
        if (!body) return;

        // Constants
        const fuelRatePerMile = 0.45;                           // £/mile
        const avgDist = avgDistanceMiles || 8;                   // default 8 miles if no data
        const avgFuelPerJob = avgDist * 2 * fuelRatePerMile;    // round trip
        const taxNiRate = 0.26;            // 20% income tax + 6% NI
        const overheadRate = 0.10;         // 10% of revenue for overheads
        const emergencyRate = 0.05;        // 5% emergency fund
        const vatRate = 0.20;              // 20% VAT

        let html = '';
        let allHealthy = true;
        let lowestMargin = 100;
        let lowestService = '';

        Object.keys(SERVICE_PRICING).forEach(key => {
            const svc = SERVICE_PRICING[key];
            const priceExVat = svc.price;
            const vat = priceExVat * vatRate;
            const priceIncVat = priceExVat + vat;
            const materials = svc.materials;
            const fuel = avgFuelPerJob;
            const taxNi = priceExVat * taxNiRate;
            const overhead = priceExVat * overheadRate;
            const emergency = priceExVat * emergencyRate;
            const totalCost = materials + fuel + taxNi + overhead + emergency;
            const takeHome = priceExVat - totalCost;
            const margin = priceExVat > 0 ? (takeHome / priceExVat * 100) : 0;

            if (margin < lowestMargin) {
                lowestMargin = margin;
                lowestService = SERVICE_LABELS[key];
            }

            let statusBadge, statusColor;
            if (margin >= 40) {
                statusBadge = '✅ Healthy';
                statusColor = '#16a34a';
            } else if (margin >= 25) {
                statusBadge = '⚠️ OK';
                statusColor = '#f59e0b';
            } else {
                statusBadge = '🔴 Low';
                statusColor = '#ef4444';
                allHealthy = false;
            }

            html += `<tr>
                <td><strong>${SERVICE_LABELS[key]}</strong></td>
                <td>£${priceExVat.toFixed(2)}<br><small style="color:var(--text-light)">+£${vat.toFixed(2)} VAT</small></td>
                <td>${svc.hours}h</td>
                <td>£${materials.toFixed(2)}</td>
                <td>£${fuel.toFixed(2)}<br><small style="color:var(--text-light)">${avgDist}mi×2</small></td>
                <td>£${taxNi.toFixed(2)}</td>
                <td>£${(overhead + emergency).toFixed(2)}</td>
                <td><strong>£${totalCost.toFixed(2)}</strong></td>
                <td style="color:${margin >= 25 ? '#16a34a' : '#ef4444'};font-weight:700;">£${takeHome.toFixed(2)}</td>
                <td style="font-weight:700;color:${statusColor}">${margin.toFixed(0)}%</td>
                <td><span style="font-size:0.82rem;color:${statusColor};font-weight:600;">${statusBadge}</span></td>
            </tr>`;
        });

        body.innerHTML = html;

        // Summary
        if (summary) {
            const fuelNote = `Fuel calculated from avg distance <strong>${avgDist} miles</strong> (round trip ${(avgDist*2).toFixed(1)} mi × £${fuelRatePerMile}/mi = £${avgFuelPerJob.toFixed(2)}).`;
            if (allHealthy) {
                summary.innerHTML = `<strong style="color:#16a34a;"><i class="fas fa-check-circle"></i> All services cover costs.</strong> 
                    Lowest margin is <strong>${lowestService}</strong> at ${lowestMargin.toFixed(0)}%. 
                    Pricing includes provisions for Tax (20%), NI (6%), fuel, materials, overheads (10%), and emergency fund (5%). 
                    VAT (20%) is charged on top — collected and remitted separately.
                    ${fuelNote}
                    Remainder becomes take-home pay.`;
            } else {
                summary.innerHTML = `<strong style="color:#ef4444;"><i class="fas fa-exclamation-triangle"></i> Some services have thin margins.</strong> 
                    <strong>${lowestService}</strong> has only ${lowestMargin.toFixed(0)}% margin. 
                    ${fuelNote}
                    Consider raising prices or reducing material costs for flagged services.`;
            }
        }
    }


    // ── Compute avg distance from real job data ──
    async function loadAvgDistance() {
        try {
            const resp = await fetch(SHEETS_WEBHOOK + '?action=sheet_read&tab=Jobs&range=N2:N100');
            const data = await resp.json();
            if (data.status === 'success' && data.values) {
                const distances = data.values
                    .map(row => parseFloat(row[0]))
                    .filter(d => !isNaN(d) && d > 0);
                if (distances.length > 0) {
                    const avg = distances.reduce((a, b) => a + b, 0) / distances.length;
                    return Math.round(avg * 10) / 10;
                }
            }
        } catch(e) { console.error('Avg distance load error:', e); }
        return 8; // default 8 miles
    }


    // ============================================
    // INIT
    // ============================================
    document.getElementById('pfRefreshBtn').addEventListener('click', loadAll);
    populateMonthSelect();
    loadAll();

    // Load avg distance then render cost coverage
    loadAvgDistance().then(avgDist => renderCostCoverage(avgDist));

});
