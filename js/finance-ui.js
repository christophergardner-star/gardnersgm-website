/* ============================================
   Finance Dashboard UI — js/finance-ui.js
   Fetches from GAS get_finance_summary + get_job_costs
   and populates every section of finance.html
   ============================================ */
(function () {
    'use strict';

    const WEBHOOK = 'https://script.google.com/macros/s/AKfycbx-q2qSeCorIEeXPE9d2MgAZLKEFwFNW9lARLE1yYciH9wJWwvktUTuDVLz_rSCbUhkMg/exec';

    // ─── helpers ───
    const $ = id => document.getElementById(id);
    const gbp = n => '£' + Number(n || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const gbpR = n => '£' + Math.round(Number(n || 0)).toLocaleString('en-GB');
    const pct = n => Math.round(Number(n || 0)) + '%';

    // ─── colour allocation helpers ───
    const ALLOC_COLOURS = [
        '#c62828', '#E65100', '#4527A0', '#1565C0',
        '#2E7D32', '#F9A825', '#6A1B9A', '#00838F', '#AD1457'
    ];

    // ─── LOAD ───
    async function loadDashboard() {
        $('finLoading').style.display = '';
        $('finContent').style.display = 'none';

        try {
            const [summaryRes, costsRes] = await Promise.all([
                fetch(WEBHOOK + '?action=get_finance_summary').then(r => r.json()),
                fetch(WEBHOOK + '?action=get_job_costs').then(r => r.json())
            ]);

            if (summaryRes.status !== 'success') throw new Error('Summary fetch failed');
            if (costsRes.status !== 'success') throw new Error('Job costs fetch failed');

            renderRevenueCards(summaryRes);
            renderPayYourself(summaryRes);
            renderProfitGauge(summaryRes);
            renderSavingsPots(summaryRes);
            renderCostBreakdown(costsRes);
            renderPricingTable(summaryRes);
            renderAllocations(summaryRes);
            renderCornwallMeta(costsRes);

            $('finUpdated').textContent = 'Updated ' + new Date().toLocaleString('en-GB');
            $('finLoading').style.display = 'none';
            $('finContent').style.display = '';
        } catch (err) {
            console.error('Finance dashboard error:', err);
            $('finLoading').innerHTML = '<i class="fas fa-exclamation-triangle" style="color:#c62828"></i> Failed to load financial data. Please try again.';
        }
    }

    // ═══════════════════════════
    //  REVENUE CARDS
    // ═══════════════════════════
    function renderRevenueCards(d) {
        var daily = d.daily || {};
        var weekly = d.weekly || {};
        var monthly = d.monthly || {};
        var ytd = d.ytd || {};

        $('finToday').textContent = gbpR(daily.grossRevenue);
        $('finTodayJobs').textContent = (daily.totalJobs || 0) + ' jobs';

        $('finWeek').textContent = gbpR(weekly.grossRevenue);
        $('finWeekJobs').textContent = (weekly.totalJobs || 0) + ' jobs';

        $('finMonth').textContent = gbpR(monthly.grossRevenue);
        $('finMonthJobs').textContent = (monthly.totalJobs || 0) + ' jobs';

        $('finYTD').textContent = gbpR(ytd.grossRevenue);
        $('finYTDProfit').textContent = gbpR(ytd.netProfit) + ' profit';
    }

    // ═══════════════════════════
    //  PAY YOURSELF
    // ═══════════════════════════
    function renderPayYourself(d) {
        var safe = d.safeToPayYourself || 0;
        var m = d.monthly || {};
        var a = m.allocations || {};

        $('finPayYourself').textContent = gbp(safe);
        $('finPayRev').textContent = gbp(m.grossRevenue);
        $('finPayTax').textContent = '-' + gbp(a.taxPot);
        $('finPayNI').textContent = '-' + gbp(a.niPot);
        $('finPayCosts').textContent = '-' + gbp(a.runningCosts);

        var matsFuelWaste = (a.materials || 0) + (a.fuel || 0) + (a.equipmentFuel || 0) + (a.equipmentWear || 0) + (a.wasteDisposal || 0);
        $('finPayMaterials').textContent = '-' + gbp(matsFuelWaste);
        $('finPayStripe').textContent = '-' + gbp(a.stripeFees);

        // Pot deposits total
        var potTotal = 0;
        (d.potRecommendations || []).forEach(function (p) { potTotal += p.recommendedDeposit || 0; });
        // Subtract tax+NI pots (already shown separately)
        var taxNI = (a.taxPot || 0) + (a.niPot || 0);
        var otherPots = Math.max(0, potTotal - taxNI);
        $('finPayPots').textContent = '-' + gbp(otherPots);

        // Colour the amount
        $('finPayYourself').style.color = safe > 0 ? '#2E7D32' : '#c62828';
    }

    // ═══════════════════════════
    //  PROFIT HEALTH GAUGE
    // ═══════════════════════════
    function renderProfitGauge(d) {
        var m = d.monthly || {};
        var margin = m.profitMargin || 0;
        var health = m.pricingHealth || 'NO DATA';

        // Arc: total length ≈ 157
        var offset = 157 - (Math.min(Math.max(margin, 0), 100) / 100) * 157;
        var arc = $('finGaugeArc');
        if (arc) {
            arc.style.transition = 'stroke-dashoffset 1s ease';
            var colour = margin >= 50 ? '#4CAF50' : margin >= 30 ? '#FFA726' : '#EF5350';
            arc.setAttribute('stroke', colour);
            arc.setAttribute('stroke-dashoffset', offset);
        }
        $('finGaugeValue').textContent = pct(margin);

        // Health badge
        var badge = $('finHealthBadge');
        badge.textContent = health;
        badge.className = 'fin-health-badge';
        if (health === 'HEALTHY') badge.classList.add('fin-health-ok');
        else if (health === 'REVIEW PRICING') badge.classList.add('fin-health-review');
        else if (health === 'WARNING') badge.classList.add('fin-health-warning');
        else if (health === 'CRITICAL') badge.classList.add('fin-health-critical');
        else badge.classList.add('fin-health-nodata');

        // Details
        $('finAvgJob').textContent = gbp(m.avgJobValue);
        $('finSubRev').textContent = gbp(m.subRevenue);
        $('finOneOff').textContent = gbp(m.oneOffRevenue);
    }

    // ═══════════════════════════
    //  SAVINGS POTS
    // ═══════════════════════════
    function renderSavingsPots(d) {
        var pots = d.savingsPots || [];
        var recs = d.potRecommendations || [];
        var container = $('finPots');
        container.innerHTML = '';

        pots.forEach(function (pot, i) {
            var rec = recs[i] || {};
            var pctFunded = pot.pctFunded || 0;
            var barClass = pctFunded >= 80 ? 'fin-pot-bar-green' : pctFunded >= 40 ? 'fin-pot-bar-amber' : 'fin-pot-bar-red';

            var card = document.createElement('div');
            card.className = 'fin-pot';
            card.innerHTML =
                '<div class="fin-pot-header">' +
                    '<span class="fin-pot-name">' + escHtml(pot.name) + '</span>' +
                    '<span class="fin-pot-amount">' + gbp(pot.currentBalance) + '</span>' +
                '</div>' +
                '<div class="fin-pot-bar"><div class="fin-pot-bar-fill ' + barClass + '" style="width:' + Math.min(pctFunded, 100) + '%"></div></div>' +
                '<div class="fin-pot-meta">' +
                    '<span>' + pct(pctFunded) + ' funded</span>' +
                    '<span>Target ' + gbp(pot.targetBalance || pot.monthlyTarget) + '</span>' +
                '</div>' +
                '<div class="fin-pot-deposit">Recommended deposit: <strong>' + gbp(rec.recommendedDeposit) + '/mo</strong></div>';
            container.appendChild(card);
        });

        if (pots.length === 0) {
            container.innerHTML = '<p style="color:#999;font-size:0.9rem;">No savings pots configured yet. They will appear after the first financial run.</p>';
        }
    }

    // ═══════════════════════════
    //  COST BREAKDOWN (per service)
    // ═══════════════════════════
    function renderCostBreakdown(d) {
        var rows = d.breakdown || [];
        var tbody = $('finCostBody');
        tbody.innerHTML = '';

        rows.forEach(function (r) {
            var c = r.costs || {};
            var statusCls = r.status === 'HEALTHY' ? 'fin-status-healthy' : r.status === 'LOW MARGIN' ? 'fin-status-low' : r.status === 'BELOW COST' ? 'fin-status-below' : 'fin-status-notset';
            var marginCls = r.marginAtMin >= 50 ? 'fin-good' : r.marginAtMin >= 25 ? 'fin-warn' : 'fin-bad';

            var tr = document.createElement('tr');
            tr.innerHTML =
                '<td><strong>' + escHtml(r.service) + '</strong><br><small style="color:#999">' + r.jobCount + ' jobs, ~' + r.avgDistance + ' mi</small></td>' +
                '<td class="fin-cost">' + gbp(c.materials) + '</td>' +
                '<td class="fin-cost">' + gbp(c.travelFuel) + '</td>' +
                '<td class="fin-cost">' + gbp(c.equipmentFuel) + '</td>' +
                '<td class="fin-cost">' + gbp(c.equipmentWear) + '</td>' +
                '<td class="fin-cost">' + gbp(c.wasteDisposal) + '</td>' +
                '<td class="fin-cost">' + gbp(c.stripeFee) + '</td>' +
                '<td><strong>' + gbp(c.total) + '</strong></td>' +
                '<td>' + (r.currentMin > 0 ? gbpR(r.currentMin) : '<em style="color:#999">—</em>') + '</td>' +
                '<td class="' + marginCls + '">' + pct(r.marginAtMin) + '</td>' +
                '<td><span class="fin-status-badge ' + statusCls + '">' + r.status + '</span></td>';
            tbody.appendChild(tr);
        });
    }

    // ═══════════════════════════
    //  DYNAMIC PRICING TABLE
    // ═══════════════════════════
    function renderPricingTable(d) {
        var configs = d.pricingConfig || [];
        var tbody = $('finPricingBody');
        tbody.innerHTML = '';

        configs.forEach(function (c) {
            var statusCls = c.status === 'OK' ? 'fin-status-healthy' : c.status === 'REVIEW' ? 'fin-status-low' : 'fin-status-below';
            var statusLabel = c.status === 'OK' ? 'HEALTHY' : c.status;

            var tr = document.createElement('tr');
            tr.innerHTML =
                '<td><strong>' + escHtml(c.service) + '</strong></td>' +
                '<td>' + gbpR(c.currentMin) + '</td>' +
                '<td class="fin-good">' + gbpR(c.recommendedMin) + '</td>' +
                '<td>' + gbp(c.breakEvenPrice) + '</td>' +
                '<td>' + gbpR(c.currentAvg) + '</td>' +
                '<td>' + pct(c.targetMargin * 100) + '</td>' +
                '<td><span class="fin-status-badge ' + statusCls + '">' + statusLabel + '</span></td>';
            tbody.appendChild(tr);
        });
    }

    // ═══════════════════════════
    //  MONTHLY ALLOCATION BARS
    // ═══════════════════════════
    function renderAllocations(d) {
        var m = d.monthly || {};
        var a = m.allocations || {};
        var rev = m.grossRevenue || 1;

        var items = [
            { label: 'Tax Reserve', value: a.taxPot || 0, colour: '#c62828' },
            { label: 'NI Reserve', value: a.niPot || 0, colour: '#E65100' },
            { label: 'Running Costs', value: a.runningCosts || 0, colour: '#4527A0' },
            { label: 'Materials', value: a.materials || 0, colour: '#1565C0' },
            { label: 'Van Fuel', value: a.fuel || 0, colour: '#00838F' },
            { label: 'Equipment Fuel', value: a.equipmentFuel || 0, colour: '#2E7D32' },
            { label: 'Equipment Wear', value: a.equipmentWear || 0, colour: '#6A1B9A' },
            { label: 'Waste Disposal', value: a.wasteDisposal || 0, colour: '#AD1457' },
            { label: 'Payment Fees', value: a.stripeFees || 0, colour: '#F9A825' },
            { label: 'Your Pocket', value: a.yourPocket || 0, colour: '#2E7D32' }
        ];

        var container = $('finAlloc');
        container.innerHTML = '';

        items.forEach(function (item) {
            var widthPct = rev > 0 ? Math.max(1, (item.value / rev) * 100) : 0;
            var row = document.createElement('div');
            row.className = 'fin-alloc-row';
            row.innerHTML =
                '<span class="fin-alloc-label">' + item.label + '</span>' +
                '<div class="fin-alloc-bar"><div class="fin-alloc-fill" style="width:' + widthPct.toFixed(1) + '%;background:' + item.colour + '"></div></div>' +
                '<span class="fin-alloc-val">' + gbp(item.value) + '</span>';
            container.appendChild(row);
        });
    }

    // ═══════════════════════════
    //  CORNWALL META (fuel price etc)
    // ═══════════════════════════
    function renderCornwallMeta(d) {
        var cc = d.cornwallCosts || {};
        if ($('finFuelPrice')) $('finFuelPrice').textContent = '£' + (cc.fuelPricePerLitre || 1.45).toFixed(2);
        if ($('finVanMPG')) $('finVanMPG').textContent = cc.vanMPG || 35;
        if ($('finAvgMiles')) $('finAvgMiles').textContent = cc.avgTravelMiles || 15;
    }

    // ─── Utility ───
    function escHtml(s) {
        var d = document.createElement('div');
        d.textContent = s || '';
        return d.innerHTML;
    }

    // ─── Wiring ───
    document.addEventListener('DOMContentLoaded', function () {
        loadDashboard();
        var btn = $('finRefresh');
        if (btn) btn.addEventListener('click', loadDashboard);
    });

})();
