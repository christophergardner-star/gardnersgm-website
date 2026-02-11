// ============================================
// ADMIN — Financial Command Centre
// Milestones, Bank Allocation, Weekly/Monthly Breakdown
// ============================================
(function() {
    const GAS = 'https://script.google.com/macros/s/AKfycbzFPVDEu1rKfwe6JKEO5jbdLYjsS80afgo23Vfr8zHoIULoPfRQfFyfZvZeHLCAoiUHTg/exec';

    let financeData = null;
    let allocConfig = null;

    // ── Milestone Definitions ──
    const MILESTONES = [
        { id: 'tools-basic',    label: 'Buy Basic Tools',         revenueThreshold: 0,     monthlyThreshold: 0,     icon: 'fa-wrench',     color: '#4CAF50', description: 'Mower, strimmer, hedge trimmer, hand tools — essentials to start trading', estimatedCost: 1500 },
        { id: 'insurance',      label: 'Get Public Liability Insurance', revenueThreshold: 500,   monthlyThreshold: 200,   icon: 'fa-shield-alt',  color: '#1565C0', description: '£2M PL insurance + vehicle insurance — must have before regular work', estimatedCost: 1500 },
        { id: 'van-purchase',   label: 'Buy/Upgrade Van',         revenueThreshold: 8000,  monthlyThreshold: 1500,  icon: 'fa-truck',      color: '#E65100', description: 'Reliable van for equipment transport. Consider used LWB transit or similar', estimatedCost: 8000 },
        { id: 'tools-pro',      label: 'Buy Professional Tools',  revenueThreshold: 15000, monthlyThreshold: 2500,  icon: 'fa-cogs',       color: '#7B1FA2', description: 'Pro mower, scarifier, power washer, chainsaw, blower — upgrade from basic', estimatedCost: 3000 },
        { id: 'hire-first',     label: 'Hire First Employee',     revenueThreshold: 30000, monthlyThreshold: 4000,  icon: 'fa-user-plus',  color: '#00838F', description: 'Part-time groundskeeper. Revenue should sustain wages + NI + pension before hiring', estimatedCost: 18000 },
        { id: 'trailer',        label: 'Buy Equipment Trailer',   revenueThreshold: 20000, monthlyThreshold: 3000,  icon: 'fa-trailer',    color: '#558B2F', description: 'Enclosed trailer for larger jobs, ride-on mower transport', estimatedCost: 2500 },
        { id: 'software',       label: 'Invest in Business Software', revenueThreshold: 10000, monthlyThreshold: 1500,  icon: 'fa-laptop',     color: '#6A1B9A', description: 'Accounting software (FreeAgent/Xero), CRM upgrade, fleet tracking', estimatedCost: 500 },
        { id: 'second-van',     label: 'Buy Second Van',          revenueThreshold: 50000, monthlyThreshold: 6000,  icon: 'fa-shuttle-van', color: '#D84315', description: 'Second vehicle for crew/employee. Run two teams simultaneously', estimatedCost: 10000 },
        { id: 'hire-second',    label: 'Hire Second Employee',    revenueThreshold: 60000, monthlyThreshold: 7000,  icon: 'fa-users',      color: '#00695C', description: 'Full team of 3. Can run two crews or tackle large commercial contracts', estimatedCost: 22000 },
        { id: 'premises',       label: 'Rent Workshop/Storage',   revenueThreshold: 80000, monthlyThreshold: 8000,  icon: 'fa-warehouse',  color: '#37474F', description: 'Equipment storage, workshop space, office. Professional premises', estimatedCost: 6000 },
        { id: 'vat-register',   label: 'Register for VAT',        revenueThreshold: 85000, monthlyThreshold: 7500,  icon: 'fa-file-invoice-dollar', color: '#C62828', description: 'MANDATORY when turnover hits £90k threshold. Plan ahead!', estimatedCost: 0 },
        { id: 'ride-on',        label: 'Buy Ride-On Mower',       revenueThreshold: 40000, monthlyThreshold: 5000,  icon: 'fa-tractor',    color: '#2E7D32', description: 'For large gardens, commercial contracts, parish council work', estimatedCost: 5000 }
    ];

    // ── Bank Account Definitions ──
    const BANK_ACCOUNTS = [
        { id: 'business-current', name: 'Business Current Account',   icon: 'fa-university',   color: '#1565C0', purpose: 'Main income account — all revenue lands here. Pay business expenses, invoices, fuel, materials from this account.', directDebits: ['Vehicle Insurance', 'Public Liability Insurance', 'Phone Contract', 'Accounting Software', 'Fuel Card (if applicable)'] },
        { id: 'tax-reserve',      name: 'Tax Reserve Account',        icon: 'fa-landmark',     color: '#C62828', purpose: 'Ring-fenced for HMRC. Income Tax + National Insurance. DO NOT touch this money — it belongs to HMRC.', directDebits: ['Self Assessment Payment (Jan & Jul)'] },
        { id: 'savings-emergency', name: 'Emergency Fund',             icon: 'fa-piggy-bank',   color: '#E65100', purpose: 'Rainy day fund. 3 months of operating costs. Only use in genuine emergencies (van breakdown, injury, equipment failure).', directDebits: [] },
        { id: 'equipment-fund',    name: 'Equipment & Vehicle Fund',   icon: 'fa-tools',        color: '#2E7D32', purpose: 'For planned equipment purchases, van maintenance, tool upgrades, trailer. Budget for replacements before they break.', directDebits: ['Equipment Finance (if applicable)', 'Van Loan/HP (if applicable)'] },
        { id: 'personal',          name: 'Personal Account',           icon: 'fa-user',         color: '#7B1FA2', purpose: 'YOUR pay. Transfer the "safe to take" amount weekly/monthly. This is your wages — treat it separately from business money.', directDebits: ['Rent/Mortgage', 'Council Tax', 'Utilities', 'Phone Personal', 'Subscriptions'] }
    ];

    // ── Allocation Rules (% of revenue breakdown) ──
    const DEFAULT_ALLOCATIONS = {
        taxReserve: 20,      // 20% to tax reserve
        niReserve: 6,        // 6% to NI reserve
        emergencyFund: 5,    // 5% to emergency
        equipmentFund: 5,    // 5% to equipment
        operatingFloat: 10,  // 10% stays in business current
        materials: 0,        // calculated from actual costs
        fuel: 0,             // calculated from actual costs
        personalPay: 0       // remainder after all deductions
    };

    // ── Init on tab activation ──
    function init() {
        const panel = document.getElementById('panelFinance');
        if (!panel) return;

        const observer = new MutationObserver(() => {
            if (panel.style.display !== 'none' && !panel.classList.contains('loaded')) {
                panel.classList.add('loaded');
                loadFinanceData();
            }
        });
        observer.observe(panel, { attributes: true, attributeFilter: ['style', 'class'] });

        // Also check if already visible
        if (panel.classList.contains('active')) {
            panel.classList.add('loaded');
            loadFinanceData();
        }

        // Button handlers
        document.getElementById('btnRefreshFinance')?.addEventListener('click', loadFinanceData);
        document.getElementById('btnSaveAllocConfig')?.addEventListener('click', saveAllocConfig);
        document.getElementById('allocPeriod')?.addEventListener('change', () => { if (financeData) renderAll(); });
    }

    // ── Load Finance Data ──
    async function loadFinanceData() {
        const loading = document.getElementById('financeLoading');
        const content = document.getElementById('financeContent');
        if (loading) loading.style.display = 'block';
        if (content) content.style.display = 'none';

        try {
            const [summaryRes, configRes] = await Promise.all([
                fetch(`${GAS}?action=get_finance_summary`).then(r => r.json()),
                fetch(`${GAS}?action=get_alloc_config`).then(r => r.json()).catch(() => ({ status: 'error' }))
            ]);

            if (summaryRes.status === 'success') {
                financeData = summaryRes;
            }

            if (configRes.status === 'success' && configRes.config) {
                allocConfig = configRes.config;
                // Populate form fields
                Object.keys(allocConfig).forEach(k => {
                    const el = document.getElementById('alloc_' + k);
                    if (el) el.value = allocConfig[k];
                });
            } else {
                allocConfig = { ...DEFAULT_ALLOCATIONS };
            }

            renderAll();
        } catch(err) {
            console.error('Finance load error:', err);
            document.getElementById('financeLoading').innerHTML = '<p style="color:#C62828;"><i class="fas fa-exclamation-triangle"></i> Failed to load financial data. Check connection.</p>';
        }
    }

    // ── Render Everything ──
    function renderAll() {
        const loading = document.getElementById('financeLoading');
        const content = document.getElementById('financeContent');
        if (loading) loading.style.display = 'none';
        if (content) content.style.display = 'block';

        if (!financeData) return;

        renderMilestones();
        renderBankAllocation();
        renderMoneyBreakdown();
        renderDirectDebits();
        renderTriggerAlerts();
    }

    // ── Get period data ──
    function getPeriodData() {
        if (!financeData) return null;
        const period = document.getElementById('allocPeriod')?.value || 'monthly';
        if (period === 'weekly') return financeData.weekly;
        return financeData.monthly;
    }

    // ── RENDER: Milestone Triggers ──
    function renderMilestones() {
        const container = document.getElementById('milestonesList');
        if (!container) return;

        const ytd = financeData.ytd;
        const monthly = financeData.monthly;
        const ytdRevenue = ytd?.grossRevenue || 0;
        const monthlyRevenue = monthly?.grossRevenue || 0;

        // Sort milestones by threshold
        const sorted = [...MILESTONES].sort((a, b) => a.revenueThreshold - b.revenueThreshold);

        let html = '';
        sorted.forEach(ms => {
            const ytdMet = ytdRevenue >= ms.revenueThreshold;
            const monthlyMet = monthlyRevenue >= ms.monthlyThreshold;
            const bothMet = ytdMet && monthlyMet;
            const eitherMet = ytdMet || monthlyMet;

            let statusClass = 'ms-locked';
            let statusIcon = 'fa-lock';
            let statusText = 'Not Yet';
            let progressPct = 0;

            if (bothMet) {
                statusClass = 'ms-ready';
                statusIcon = 'fa-check-circle';
                statusText = '✅ READY — Revenue supports this';
                progressPct = 100;
            } else if (eitherMet) {
                statusClass = 'ms-approaching';
                statusIcon = 'fa-clock';
                statusText = '⏳ Approaching — nearly there';
                progressPct = 75;
            } else {
                const revPct = ms.revenueThreshold > 0 ? Math.min(100, (ytdRevenue / ms.revenueThreshold) * 100) : 100;
                const monPct = ms.monthlyThreshold > 0 ? Math.min(100, (monthlyRevenue / ms.monthlyThreshold) * 100) : 100;
                progressPct = Math.round((revPct + monPct) / 2);
                if (progressPct >= 50) {
                    statusClass = 'ms-halfway';
                    statusIcon = 'fa-chart-line';
                    statusText = `${progressPct}% — building towards this`;
                }
            }

            html += `
                <div class="ms-card ${statusClass}">
                    <div class="ms-icon" style="background:${ms.color}20;color:${ms.color};"><i class="fas ${ms.icon}"></i></div>
                    <div class="ms-body">
                        <div class="ms-header">
                            <h4>${ms.label}</h4>
                            <span class="ms-badge ${statusClass}"><i class="fas ${statusIcon}"></i> ${statusText}</span>
                        </div>
                        <p class="ms-desc">${ms.description}</p>
                        <div class="ms-meta">
                            <span><i class="fas fa-pound-sign"></i> Est. Cost: <strong>£${ms.estimatedCost.toLocaleString()}</strong></span>
                            <span><i class="fas fa-chart-bar"></i> YTD Target: <strong>£${ms.revenueThreshold.toLocaleString()}</strong></span>
                            <span><i class="fas fa-calendar"></i> Monthly Target: <strong>£${ms.monthlyThreshold.toLocaleString()}/mo</strong></span>
                        </div>
                        <div class="ms-progress-bar">
                            <div class="ms-progress-fill" style="width:${progressPct}%;background:${ms.color};"></div>
                        </div>
                    </div>
                </div>
            `;
        });

        container.innerHTML = html;
    }

    // ── RENDER: Bank Account Allocation ──
    function renderBankAllocation() {
        const container = document.getElementById('bankAllocationGrid');
        if (!container) return;

        const pd = getPeriodData();
        if (!pd) return;

        const revenue = pd.grossRevenue || 0;
        const config = allocConfig || DEFAULT_ALLOCATIONS;

        // Calculate amounts
        const taxAmount = Math.round(revenue * (config.taxReserve / 100) * 100) / 100;
        const niAmount = Math.round(revenue * (config.niReserve / 100) * 100) / 100;
        const emergencyAmount = Math.round(revenue * (config.emergencyFund / 100) * 100) / 100;
        const equipmentAmount = Math.round(revenue * (config.equipmentFund / 100) * 100) / 100;
        const operatingAmount = Math.round(revenue * (config.operatingFloat / 100) * 100) / 100;
        const materialsCost = pd.materialCosts || 0;
        const fuelCost = pd.fuelEstimate || 0;
        const stripeFees = pd.stripeFees || 0;
        const totalDeductions = taxAmount + niAmount + emergencyAmount + equipmentAmount + operatingAmount + materialsCost + fuelCost + stripeFees;
        const personalPay = Math.max(0, revenue - totalDeductions);

        const allocations = [
            { account: BANK_ACCOUNTS[0], amount: operatingAmount + materialsCost + fuelCost + stripeFees, label: 'Business Current', detail: `Float £${operatingAmount.toFixed(2)} + Materials £${materialsCost.toFixed(2)} + Fuel £${fuelCost.toFixed(2)} + Stripe £${stripeFees.toFixed(2)}` },
            { account: BANK_ACCOUNTS[1], amount: taxAmount + niAmount, label: 'Tax Reserve', detail: `Income Tax £${taxAmount.toFixed(2)} (${config.taxReserve}%) + NI £${niAmount.toFixed(2)} (${config.niReserve}%)` },
            { account: BANK_ACCOUNTS[2], amount: emergencyAmount, label: 'Emergency Fund', detail: `${config.emergencyFund}% of revenue` },
            { account: BANK_ACCOUNTS[3], amount: equipmentAmount, label: 'Equipment Fund', detail: `${config.equipmentFund}% of revenue` },
            { account: BANK_ACCOUNTS[4], amount: personalPay, label: 'Personal Pay', detail: `Revenue minus all business deductions` }
        ];

        // Period label
        const periodLabel = (document.getElementById('allocPeriod')?.value || 'monthly') === 'weekly' ? 'This Week' : 'This Month';
        document.getElementById('allocPeriodLabel').textContent = periodLabel;
        document.getElementById('allocTotalRevenue').textContent = '£' + revenue.toFixed(2);

        let html = '';
        allocations.forEach(a => {
            const pct = revenue > 0 ? ((a.amount / revenue) * 100).toFixed(1) : 0;
            html += `
                <div class="bank-card">
                    <div class="bank-card-header" style="border-left:4px solid ${a.account.color};">
                        <div class="bank-icon" style="background:${a.account.color}20;color:${a.account.color};"><i class="fas ${a.account.icon}"></i></div>
                        <div>
                            <h4>${a.account.name}</h4>
                            <p class="bank-purpose">${a.account.purpose}</p>
                        </div>
                    </div>
                    <div class="bank-amount">
                        <span class="bank-figure">£${a.amount.toFixed(2)}</span>
                        <span class="bank-pct">${pct}%</span>
                    </div>
                    <div class="bank-detail">${a.detail}</div>
                    <div class="bank-bar"><div class="bank-bar-fill" style="width:${Math.min(100,pct)}%;background:${a.account.color};"></div></div>
                </div>
            `;
        });

        container.innerHTML = html;
    }

    // ── RENDER: Money Breakdown Table ──
    function renderMoneyBreakdown() {
        const tbody = document.getElementById('moneyBreakdownBody');
        if (!tbody) return;

        const pd = getPeriodData();
        if (!pd) return;

        const revenue = pd.grossRevenue || 0;
        const config = allocConfig || DEFAULT_ALLOCATIONS;

        const lines = [
            { label: 'Gross Revenue', amount: revenue, type: 'income', account: 'Business Current' },
            { label: 'divider' },
            { label: 'Income Tax Reserve (' + config.taxReserve + '%)', amount: -(revenue * config.taxReserve / 100), type: 'deduction', account: 'Tax Reserve Account' },
            { label: 'National Insurance Reserve (' + config.niReserve + '%)', amount: -(revenue * config.niReserve / 100), type: 'deduction', account: 'Tax Reserve Account' },
            { label: 'Emergency Fund (' + config.emergencyFund + '%)', amount: -(revenue * config.emergencyFund / 100), type: 'deduction', account: 'Emergency Fund' },
            { label: 'Equipment Fund (' + config.equipmentFund + '%)', amount: -(revenue * config.equipmentFund / 100), type: 'deduction', account: 'Equipment & Vehicle Fund' },
            { label: 'Operating Float (' + config.operatingFloat + '%)', amount: -(revenue * config.operatingFloat / 100), type: 'deduction', account: 'Business Current Account' },
            { label: 'divider' },
            { label: 'Material Costs', amount: -(pd.materialCosts || 0), type: 'cost', account: 'Business Current Account' },
            { label: 'Fuel Costs', amount: -(pd.fuelEstimate || 0), type: 'cost', account: 'Business Current Account' },
            { label: 'Stripe Processing Fees', amount: -(pd.stripeFees || 0), type: 'cost', account: 'Business Current Account' },
            { label: 'Running Costs (Insurance, Phone, etc.)', amount: -(pd.runningCosts || 0), type: 'cost', account: 'Business Current Account' },
            { label: 'divider' }
        ];

        const totalDeductions = lines.filter(l => l.type === 'deduction' || l.type === 'cost').reduce((s,l) => s + Math.abs(l.amount), 0);
        lines.push({ label: 'YOUR PAY — Safe to Transfer', amount: Math.max(0, revenue - totalDeductions), type: 'pay', account: 'Personal Account' });

        let html = '';
        lines.forEach(l => {
            if (l.label === 'divider') {
                html += '<tr class="mb-divider"><td colspan="4"></td></tr>';
                return;
            }
            const cls = l.type === 'income' ? 'mb-income' : l.type === 'pay' ? 'mb-pay' : 'mb-deduction';
            const sign = l.amount >= 0 ? '+' : '';
            html += `<tr class="${cls}">
                <td>${l.label}</td>
                <td class="mb-amount">${sign}£${Math.abs(l.amount).toFixed(2)}</td>
                <td><span class="mb-account">${l.account}</span></td>
                <td>${l.type === 'income' ? '<i class="fas fa-arrow-down" style="color:#2E7D32;"></i> Incoming' : l.type === 'pay' ? '<i class="fas fa-arrow-right" style="color:#7B1FA2;"></i> Transfer' : '<i class="fas fa-arrow-up" style="color:#C62828;"></i> Set aside'}</td>
            </tr>`;
        });

        tbody.innerHTML = html;
    }

    // ── RENDER: Direct Debits Checklist ──
    function renderDirectDebits() {
        const container = document.getElementById('directDebitsList');
        if (!container) return;

        let html = '';
        BANK_ACCOUNTS.forEach(acct => {
            if (acct.directDebits.length === 0) return;
            html += `<div class="dd-account">
                <h4 style="color:${acct.color};"><i class="fas ${acct.icon}"></i> ${acct.name}</h4>
                <ul class="dd-list">
                    ${acct.directDebits.map(dd => `<li><i class="fas fa-check-circle" style="color:${acct.color};"></i> ${dd}</li>`).join('')}
                </ul>
            </div>`;
        });

        container.innerHTML = html;
    }

    // ── RENDER: Smart Trigger Alerts ──
    function renderTriggerAlerts() {
        const container = document.getElementById('triggerAlerts');
        if (!container) return;

        const ytd = financeData.ytd;
        const monthly = financeData.monthly;
        const ytdRevenue = ytd?.grossRevenue || 0;
        const monthlyRevenue = monthly?.grossRevenue || 0;

        const alerts = [];

        // Check milestones
        MILESTONES.forEach(ms => {
            const ytdMet = ytdRevenue >= ms.revenueThreshold;
            const monthlyMet = monthlyRevenue >= ms.monthlyThreshold;
            if (ytdMet && monthlyMet) {
                alerts.push({ type: 'success', icon: ms.icon, color: ms.color, text: `<strong>${ms.label}</strong> — Revenue supports this investment (£${ms.estimatedCost.toLocaleString()})`, priority: 1 });
            } else if (ytdMet || monthlyMet) {
                alerts.push({ type: 'warning', icon: ms.icon, color: '#E65100', text: `<strong>${ms.label}</strong> — Getting close! ${ytdMet ? 'YTD target met' : 'Monthly target met'}, keep going`, priority: 2 });
            }
        });

        // VAT threshold warning
        if (ytdRevenue > 75000) {
            const pct = ((ytdRevenue / 90000) * 100).toFixed(0);
            alerts.push({ type: 'danger', icon: 'fa-exclamation-triangle', color: '#C62828', text: `<strong>⚠️ VAT Threshold Alert!</strong> YTD revenue £${ytdRevenue.toLocaleString()} is ${pct}% towards the £90k VAT registration threshold`, priority: 0 });
        }

        // Profit margin check
        const margin = monthly?.profitMargin || 0;
        if (margin < 30) {
            alerts.push({ type: 'danger', icon: 'fa-chart-line', color: '#C62828', text: `<strong>Low Profit Margin:</strong> ${margin.toFixed(1)}% this month — review pricing or reduce costs`, priority: 0 });
        } else if (margin > 70) {
            alerts.push({ type: 'success', icon: 'fa-chart-line', color: '#2E7D32', text: `<strong>Excellent Margin:</strong> ${margin.toFixed(1)}% this month — healthy and sustainable`, priority: 3 });
        }

        // Savings pot check
        if (financeData.savingsPots) {
            financeData.savingsPots.forEach(pot => {
                if (pot.targetBalance > 0 && pot.currentBalance >= pot.targetBalance) {
                    alerts.push({ type: 'success', icon: 'fa-piggy-bank', color: '#2E7D32', text: `<strong>${pot.name}</strong> target reached (£${pot.currentBalance.toFixed(2)} / £${pot.targetBalance.toFixed(2)})`, priority: 3 });
                }
            });
        }

        // Sort by priority
        alerts.sort((a, b) => a.priority - b.priority);

        if (alerts.length === 0) {
            container.innerHTML = '<p style="color:#999;text-align:center;padding:1rem;"><i class="fas fa-info-circle"></i> No active triggers. Keep growing!</p>';
            return;
        }

        container.innerHTML = alerts.map(a =>
            `<div class="trigger-alert trigger-${a.type}">
                <i class="fas ${a.icon}" style="color:${a.color};font-size:1.2rem;min-width:24px;"></i>
                <span>${a.text}</span>
            </div>`
        ).join('');
    }

    // ── Save allocation config ──
    async function saveAllocConfig() {
        const btn = document.getElementById('btnSaveAllocConfig');
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';

        const config = {};
        ['taxReserve', 'niReserve', 'emergencyFund', 'equipmentFund', 'operatingFloat'].forEach(k => {
            const el = document.getElementById('alloc_' + k);
            config[k] = parseFloat(el?.value) || DEFAULT_ALLOCATIONS[k];
        });

        try {
            const res = await fetch(GAS, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain' },
                body: JSON.stringify({ action: 'save_alloc_config', ...config })
            });
            const json = await res.json();
            if (json.status === 'success') {
                allocConfig = config;
                renderAll();
                btn.innerHTML = '<i class="fas fa-check"></i> Saved!';
                setTimeout(() => { btn.innerHTML = '<i class="fas fa-save"></i> Save Configuration'; btn.disabled = false; }, 2000);
            }
        } catch(e) {
            btn.innerHTML = '<i class="fas fa-times"></i> Error';
            setTimeout(() => { btn.innerHTML = '<i class="fas fa-save"></i> Save Configuration'; btn.disabled = false; }, 2000);
        }
    }

    // ── Boot ──
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
