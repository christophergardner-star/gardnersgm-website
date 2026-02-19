/* ============================================
   Gardners Ground Maintenance — Enquiry JS
   Handles: Flatpickr calendar, time slots,
   form validation, enquiry submission
   (No payments — enquiry-only, priced in GGM Hub)
   ============================================ */

document.addEventListener('DOMContentLoaded', () => {

    // --- Config ---
    const SHEETS_WEBHOOK = 'https://script.google.com/macros/s/AKfycbxaT1YOoDZtVHP9CztiUutYFqMiOyygDJon5BxCij14CWl91WgdmrYqpbG4KVAlFh5IiQ/exec';

    // --- Service prices (starting prices in pence) ---
    // Only 3 core services active — others hidden for future expansion
    const servicePrices = {
        'lawn-cutting':     { amount: 3400, display: '£34' },
        'hedge-trimming':   { amount: 5000, display: '£50' },
        'garden-clearance': { amount: 11000, display: '£110' },
        'scarifying':       { amount: 9000, display: '£90' },
        'lawn-treatment':   { amount: 3900, display: '£39' },
        'strimming':        { amount: 4500, display: '£45' },
        'leaf-clearance':   { amount: 3900, display: '£39' }
        /* HIDDEN: Additional services — re-enable as business grows
        ,'power-washing':    { amount: 5500, display: '£55' },
        'veg-patch':        { amount: 8000, display: '£80' },
        'weeding-treatment': { amount: 4500, display: '£45' },
        'fence-repair':     { amount: 7500, display: '£75' },
        'emergency-tree':   { amount: 20000, display: '£200' },
        'drain-clearance':  { amount: 5000, display: '£50' },
        'gutter-cleaning':  { amount: 5000, display: '£50' }
        END HIDDEN */
    };

    // Dynamic pricing — fetch recommended minimums + job cost data from Pricing Config sheet
    let dynamicMinimums = {}; // service-key → minimum in pence
    let jobCostData = {};     // service-key → full cost breakdown
    (async function loadDynamicPricing() {
        try {
            // Fetch pricing config + job costs in parallel
            const [priceRes, costRes] = await Promise.all([
                fetch(SHEETS_WEBHOOK + '?action=get_pricing_config'),
                fetch(SHEETS_WEBHOOK + '?action=get_job_costs')
            ]);
            const priceData = await priceRes.json();
            const costData = await costRes.json();
            
            if (priceData.status === 'success' && priceData.config) {
                for (const svc of priceData.config) {
                    const key = svc.service.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
                    // Use currentMin (the actual live floor price), NOT recommendedMin
                    // recommendedMin is for internal cost analysis only
                    const minVal = svc.currentMin || 0;
                    const recMin = Math.round(minVal * 100);
                    if (recMin > 0 && servicePrices[key]) {
                        dynamicMinimums[key] = recMin;
                        // Only update display if sheet minimum is HIGHER than hardcoded
                        // but never override with recommendedMin (analysis-only value)
                        if (recMin > servicePrices[key].amount) {
                            servicePrices[key].amount = recMin;
                            servicePrices[key].display = '£' + (recMin / 100).toFixed(recMin % 100 === 0 ? 0 : 2);
                        }
                    }
                }
            }
            if (costData.status === 'success' && costData.breakdown) {
                for (const b of costData.breakdown) {
                    jobCostData[b.serviceKey] = b;
                }
            }
            console.log('[Pricing] Dynamic minimums loaded:', Object.keys(dynamicMinimums).length, 'services,', Object.keys(jobCostData).length, 'cost models');
        } catch(e) { console.log('[Pricing] Using default prices (config fetch failed)'); }
    })();

    // ============================================
    // QUOTE BUILDER — per-service options & pricing
    // ============================================
    const quoteConfig = {
        'lawn-cutting': {
            options: [
                { id: 'lawnSize', label: 'Lawn Size', type: 'select', choices: [
                    { text: 'Small (up to 50m²)', value: 3400 },
                    { text: 'Medium (50–150m²)', value: 5000 },
                    { text: 'Large (150–300m²)', value: 7500 },
                    { text: 'Extra Large (300m²+)', value: 10000 }
                ]},
                { id: 'lawnArea', label: 'Areas', type: 'select', choices: [
                    { text: 'Front only', value: 0 },
                    { text: 'Back only', value: 0 },
                    { text: 'Front & Back', value: 1100 }
                ]}
            ],
            extras: [
                { id: 'edging', label: 'Edging & strimming', price: 550 },
                { id: 'clippings', label: 'Clippings collected & removed', price: 0, checked: true }
                // HIDDEN: { id: 'stripes', label: 'Striped finish', price: 550 }
            ]
        },
        'hedge-trimming': {
            options: [
                { id: 'hedgeCount', label: 'Number of Hedges', type: 'select', choices: [
                    { text: '1 hedge', value: 0 },
                    { text: '2 hedges', value: 2800 },
                    { text: '3 hedges', value: 5000 },
                    { text: '4+ hedges', value: 8000 }
                ]},
                { id: 'hedgeSize', label: 'Hedge Size', type: 'select', choices: [
                    { text: 'Small (under 2m tall, under 5m long)', value: 5000 },
                    { text: 'Medium (2–3m tall, 5–15m long)', value: 8000 },
                    { text: 'Large (3m+ tall or 15m+ long)', value: 13500 }
                ]}
            ],
            extras: [
                { id: 'waste', label: 'Waste removal included', price: 0, checked: true },
                { id: 'shaping', label: 'Decorative shaping', price: 2200 },
                { id: 'reduction', label: 'Height reduction (heavy cut back)', price: 3900 }
            ]
        },
        'garden-clearance': {
            options: [
                { id: 'clearLevel', label: 'Clearance Level', type: 'select', choices: [
                    { text: 'Light (tidy up, minor overgrowth)', value: 11000 },
                    { text: 'Medium (overgrown beds, some waste)', value: 20000 },
                    { text: 'Heavy (fully overgrown / neglected)', value: 36000 },
                    { text: 'Full property clearance', value: 50500 }
                ]}
            ],
            extras: [
                { id: 'skipHire', label: 'Skip hire (we arrange it)', price: 24500 },
                { id: 'rubbishRemoval', label: 'Rubbish removal (van load)', price: 8500 },
                { id: 'strimming', label: 'Strimming & brush cutting', price: 2800 }
            ]
        },
        'scarifying': {
            options: [
                { id: 'scarifySize', label: 'Lawn Size', type: 'select', choices: [
                    { text: 'Small (up to 50m²)', value: 9000 },
                    { text: 'Medium (50–150m²)', value: 13500 },
                    { text: 'Large (150–300m²)', value: 20000 },
                    { text: 'Extra Large (300m²+)', value: 28000 }
                ]}
            ],
            extras: [
                { id: 'overseed', label: 'Overseeding after scarifying', price: 4500 },
                { id: 'scarifyWaste', label: 'Thatch & moss removal', price: 0, checked: true }
            ]
        },
        'lawn-treatment': {
            options: [
                { id: 'treatSize', label: 'Lawn Size', type: 'select', choices: [
                    { text: 'Small (up to 50m²)', value: 3900 },
                    { text: 'Medium (50–150m²)', value: 5500 },
                    { text: 'Large (150–300m²)', value: 8500 },
                    { text: 'Extra Large (300m²+)', value: 11000 }
                ]},
                { id: 'treatType', label: 'Treatment Type', type: 'select', choices: [
                    { text: 'Feed only', value: 0 },
                    { text: 'Feed & weed', value: 1100 },
                    { text: 'Feed, weed & moss control', value: 2200 },
                    { text: 'Full programme (4 seasonal visits)', value: 9000 }
                ]}
            ],
            extras: [
                { id: 'treatAerate', label: 'Aeration included', price: 2200 },
                { id: 'treatReport', label: 'Lawn health report', price: 0, checked: true }
            ]
        },
        'strimming': {
            options: [
                { id: 'strimArea', label: 'Area Size', type: 'select', choices: [
                    { text: 'Small (up to 50m²)', value: 4500 },
                    { text: 'Medium (50–200m²)', value: 8000 },
                    { text: 'Large (200–500m²)', value: 13500 },
                    { text: 'Extra Large (500m²+)', value: 22500 }
                ]},
                { id: 'strimType', label: 'Work Type', type: 'select', choices: [
                    { text: 'Light strimming (edges, borders)', value: 0 },
                    { text: 'Brush cutting (rough ground)', value: 1700 },
                    { text: 'Full clearance (strim + brush cut)', value: 3400 }
                ]}
            ],
            extras: [
                { id: 'strimCollect', label: 'Cuttings collected & removed', price: 1700 }
            ]
        },
        'leaf-clearance': {
            options: [
                { id: 'leafArea', label: 'Area Size', type: 'select', choices: [
                    { text: 'Small (front or back only)', value: 3900 },
                    { text: 'Medium (front & back garden)', value: 6000 },
                    { text: 'Large (large garden / driveway)', value: 10000 },
                    { text: 'Extra Large (grounds / car park)', value: 17000 }
                ]}
            ],
            extras: [
                { id: 'leafBag', label: 'Bagged & removed from site', price: 1700 },
                { id: 'leafGutter', label: 'Gutter clear included', price: 2800 },
                { id: 'leafBlow', label: 'Leaf blowing (paths & drives)', price: 0, checked: true }
            ]
        }
        /* HIDDEN: Additional service quote configs — re-enable as business grows
        ,'power-washing': {
            options: [
                { id: 'pwSurface', label: 'Surface Type', type: 'select', choices: [
                    { text: 'Patio', value: 5500 },
                    { text: 'Driveway', value: 8000 },
                    { text: 'Decking', value: 6500 },
                    { text: 'Paths / steps', value: 4500 },
                    { text: 'Walls / fencing', value: 6500 }
                ]},
                { id: 'pwArea', label: 'Area Size', type: 'select', choices: [
                    { text: 'Small (up to 15m²)', value: 0 },
                    { text: 'Medium (15–40m²)', value: 2800 },
                    { text: 'Large (40–80m²)', value: 5500 },
                    { text: 'Extra Large (80m²+)', value: 9500 }
                ]}
            ],
            extras: [
                { id: 'pwSealant', label: 'Sealant / re-sand after washing', price: 3900 },
                { id: 'pwSecondSurface', label: 'Additional surface (+50%)', price: 0, multiplier: 0.5 }
            ]
        },
        'veg-patch': {
            options: [
                { id: 'vegSize', label: 'Patch Size', type: 'select', choices: [
                    { text: 'Small raised bed (up to 4m²)', value: 8000 },
                    { text: 'Medium plot (4–12m²)', value: 11000 },
                    { text: 'Large allotment-style (12–30m²)', value: 17000 },
                    { text: 'Extra Large (30m²+)', value: 24500 }
                ]},
                { id: 'vegCondition', label: 'Current Condition', type: 'select', choices: [
                    { text: 'Bare soil — ready to prep', value: 0 },
                    { text: 'Overgrown — needs clearing first', value: 3900 },
                    { text: 'New bed — turf removal required', value: 5500 }
                ]}
            ],
            extras: [
                { id: 'vegCompost', label: 'Compost & soil improver added', price: 2800 },
                { id: 'vegEdging', label: 'Timber edging / raised bed frame', price: 5000 },
                { id: 'vegMembrane', label: 'Weed membrane laid', price: 1700 }
            ]
        },
        'weeding-treatment': {
            options: [
                { id: 'weedArea', label: 'Area Size', type: 'select', choices: [
                    { text: 'Small (single border / beds)', value: 4500 },
                    { text: 'Medium (front or back garden)', value: 6500 },
                    { text: 'Large (full garden)', value: 10000 },
                    { text: 'Extra Large (extensive grounds)', value: 15500 }
                ]},
                { id: 'weedType', label: 'Treatment Type', type: 'select', choices: [
                    { text: 'Hand weeding only', value: 0 },
                    { text: 'Spray treatment (selective)', value: 1700 },
                    { text: 'Hand weeding + spray combo', value: 2800 }
                ]}
            ],
            extras: [
                { id: 'weedMulch', label: 'Bark mulch applied after', price: 3400 },
                { id: 'weedMembrane', label: 'Weed membrane under mulch', price: 1700 }
            ]
        },
        'fence-repair': {
            options: [
                { id: 'fenceType', label: 'Repair Type', type: 'select', choices: [
                    { text: 'Panel replacement (1 panel)', value: 7500 },
                    { text: 'Panel replacement (2–3 panels)', value: 14500 },
                    { text: 'Panel replacement (4+ panels)', value: 21500 },
                    { text: 'Post repair / replacement', value: 5500 },
                    { text: 'Full fence section rebuild', value: 24500 }
                ]},
                { id: 'fenceHeight', label: 'Fence Height', type: 'select', choices: [
                    { text: 'Standard (up to 6ft)', value: 0 },
                    { text: 'Tall (over 6ft)', value: 2800 }
                ]}
            ],
            extras: [
                { id: 'fenceTreat', label: 'Timber treatment / staining', price: 2200 },
                { id: 'fenceWaste', label: 'Old fence removal & disposal', price: 2800 },
                { id: 'fenceGravel', label: 'Gravel board installation', price: 1700 }
            ]
        },
        'emergency-tree': {
            options: [
                { id: 'treeSize', label: 'Tree Size', type: 'select', choices: [
                    { text: 'Small tree (under 5m)', value: 20000 },
                    { text: 'Medium tree (5–10m)', value: 39000 },
                    { text: 'Large tree (10m+)', value: 67000 }
                ]},
                { id: 'treeWork', label: 'Work Required', type: 'select', choices: [
                    { text: 'Fallen branch removal', value: 0 },
                    { text: 'Storm-damaged crown reduction', value: 11000 },
                    { text: 'Emergency felling (dangerous tree)', value: 28000 },
                    { text: 'Root plate / stump emergency', value: 19500 }
                ]}
            ],
            extras: [
                { id: 'treeLogSplit', label: 'Log splitting & stacking', price: 7500 },
                { id: 'treeWaste', label: 'Full waste removal & chipping', price: 9500 },
                { id: 'treeStump', label: 'Stump grinding', price: 13500 }
            ]
        },
        'drain-clearance': {
            options: [
                { id: 'drainType', label: 'Drain Type', type: 'select', choices: [
                    { text: 'Single blocked drain', value: 5000 },
                    { text: 'Multiple drains (2-3)', value: 8000 },
                    { text: 'Full garden drainage run', value: 12500 }
                ]},
                { id: 'drainCondition', label: 'Condition', type: 'select', choices: [
                    { text: 'Partially blocked (slow)', value: 0 },
                    { text: 'Fully blocked (standing water)', value: 1700 },
                    { text: 'Root ingress', value: 3400 }
                ]}
            ],
            extras: [
                { id: 'drainJet', label: 'Pressure jetting', price: 2800 },
                { id: 'drainGuard', label: 'Drain guard installation', price: 1700 }
            ]
        },
        'gutter-cleaning': {
            options: [
                { id: 'gutterLength', label: 'Property Size', type: 'select', choices: [
                    { text: 'Small (terraced / 1-2 bed)', value: 5000 },
                    { text: 'Medium (semi / 3 bed)', value: 7500 },
                    { text: 'Large (detached / 4+ bed)', value: 10000 }
                ]},
                { id: 'gutterCondition', label: 'Condition', type: 'select', choices: [
                    { text: 'Routine clean (light debris)', value: 0 },
                    { text: 'Heavy build-up / moss', value: 1700 },
                    { text: 'Overflowing / plant growth', value: 2800 }
                ]}
            ],
            extras: [
                { id: 'gutterFlush', label: 'Downpipe flush & check', price: 1700 },
                { id: 'gutterGuard', label: 'Gutter guard installation', price: 2800 }
            ]
        }
        END HIDDEN */
    };

    // Current quote total in pence
    let currentQuoteTotal = 3400; // £30 minimum default

    // Format pence as £ display
    function penceToPounds(pence) {
        if (pence === 0) return 'Included';
        const pounds = pence / 100;
        return '£' + (pence % 100 === 0 ? pounds.toFixed(0) : pounds.toFixed(2));
    }

    function renderQuoteBuilder(service) {
        // DISABLED: Quote builder hidden — Chris builds quotes in GGM Hub
        const builder = document.getElementById('quoteBuilder');
        if (builder) builder.style.display = 'none';
        return;
        /* ORIGINAL renderQuoteBuilder code preserved below for future use
        const builder = document.getElementById('quoteBuilder');
        const optionsContainer = document.getElementById('quoteOptions');
        const extrasContainer = document.getElementById('quoteExtras');

        if (!service || !quoteConfig[service]) {
            builder.style.display = 'none';
            currentQuoteTotal = 3000;
            updatePayAmount();
            return;
        }

        const config = quoteConfig[service];
        optionsContainer.innerHTML = '';
        extrasContainer.innerHTML = '';

        // Emergency-tree special theme
        if (service === 'emergency-tree') {
            builder.classList.add('quote-builder--emergency');
        } else {
            builder.classList.remove('quote-builder--emergency');
        }

        // Render select options — show price in each option text
        config.options.forEach(opt => {
            const group = document.createElement('div');
            group.className = 'quote-option-group';
            group.innerHTML = `
                <label class="quote-option-label">${opt.label}</label>
                <select class="quote-select" data-quote-option="${opt.id}">
                    ${opt.choices.map((c, i) => {
                        const priceTag = c.value === 0 ? ' — Included' : ` — ${penceToPounds(c.value)}`;
                        return `<option value="${c.value}" ${i === 0 ? 'selected' : ''}>${c.text}${priceTag}</option>`;
                    }).join('')}
                </select>
            `;
            optionsContainer.appendChild(group);
            group.querySelector('select').addEventListener('change', recalcQuote);
        });

        // Render extras checkboxes
        if (config.extras && config.extras.length) {
            const title = document.createElement('div');
            title.className = 'quote-extras-title';
            title.innerHTML = '<i class="fas fa-plus-circle"></i> Add-ons';
            extrasContainer.appendChild(title);

            config.extras.forEach(ext => {
                const label = document.createElement('label');
                label.className = 'quote-extra-item';
                const priceText = ext.multiplier ? '' : (ext.price === 0 ? 'Included' : `+£${(ext.price/100).toFixed(0)}`);
                label.innerHTML = `
                    <input type="checkbox" data-quote-extra="${ext.id}" data-price="${ext.price}" ${ext.multiplier ? `data-multiplier="${ext.multiplier}"` : ''} ${ext.checked ? 'checked' : ''}>
                    <span class="quote-extra-text">${ext.label}</span>
                    <span class="quote-extra-price">${priceText}</span>
                `;
                extrasContainer.appendChild(label);
                label.querySelector('input').addEventListener('change', recalcQuote);
            });
        }

        // Add / update the breakdown container
        let breakdownEl = document.getElementById('quoteBreakdownDisplay');
        if (!breakdownEl) {
            breakdownEl = document.createElement('div');
            breakdownEl.id = 'quoteBreakdownDisplay';
            breakdownEl.className = 'quote-breakdown';
            const totalBar = builder.querySelector('.quote-total-bar');
            if (totalBar) totalBar.parentNode.insertBefore(breakdownEl, totalBar);
        }

        // Update the minimum call-out note for this service
        const noteEl = document.getElementById('quoteTotalNote');
        if (noteEl) {
            const minPence = dynamicMinimums[service] || servicePrices[service]?.amount || 3000;
            noteEl.textContent = `${penceToPounds(minPence)} minimum call-out`;
        }

        builder.style.display = 'block';
        recalcQuote();
    }

    // Track customer distance for pricing
    let customerDistance = 0; // miles one-way

    function recalcQuote() {
        let total = 0;
        const breakdownLines = [];

        // Sum all select option values + build breakdown
        document.querySelectorAll('.quote-select').forEach(sel => {
            const val = parseInt(sel.value) || 0;
            total += val;
            const label = sel.closest('.quote-option-group')?.querySelector('.quote-option-label')?.textContent || '';
            const text = sel.options[sel.selectedIndex]?.text?.replace(/\s*—\s*(?:£[\d,.]+|Included)$/, '') || '';
            if (label) {
                breakdownLines.push({ label: `${label}: ${text}`, amount: val });
            }
        });

        // Add checked extras + build breakdown
        let extraFlat = 0;
        let multiplier = 0;
        document.querySelectorAll('[data-quote-extra]').forEach(cb => {
            if (cb.checked) {
                const mult = cb.getAttribute('data-multiplier');
                const extLabel = cb.closest('.quote-extra-item')?.querySelector('.quote-extra-text')?.textContent || 'Add-on';
                if (mult) {
                    multiplier += parseFloat(mult);
                    breakdownLines.push({ label: extLabel, amount: null, note: `+${Math.round(parseFloat(mult)*100)}%` });
                } else {
                    const price = parseInt(cb.getAttribute('data-price')) || 0;
                    extraFlat += price;
                    breakdownLines.push({ label: extLabel, amount: price });
                }
            }
        });

        total += extraFlat;
        if (multiplier > 0) {
            const multAmt = Math.round(total * multiplier);
            total += multAmt;
        }

        // Distance-based travel surcharge for Cornwall (rural county, spread-out clients)
        const svc = serviceSelect ? serviceSelect.value : '';
        let distanceSurcharge = 0;
        if (customerDistance > 15) {
            distanceSurcharge = Math.round((customerDistance - 15) * 50);
            total += distanceSurcharge;
            breakdownLines.push({ label: `Travel surcharge (${Math.round(customerDistance - 15)} extra miles)`, amount: distanceSurcharge });
        }

        // Emergency call-out surcharge (6:30pm – 7:30am = +50%)
        let emergSurcharge = 0;
        if (svc === 'emergency-tree') {
            const timeEl = document.getElementById('time');
            const selectedTime = timeEl ? timeEl.value : '';
            if (selectedTime) {
                const startHour = parseInt(selectedTime.split(':')[0]);
                if (startHour < 8 || startHour >= 18) {
                    emergSurcharge = Math.round(total * 0.5);
                    total += emergSurcharge;
                    breakdownLines.push({ label: '⚠️ After-hours surcharge (50%)', amount: emergSurcharge });
                }
            }
        }

        // Enforce dynamic minimum (from Pricing Config) or fallback £30
        const minPrice = dynamicMinimums[svc] || 3000;
        if (total < minPrice) total = minPrice;

        currentQuoteTotal = total;

        // Update display with animation
        const display = `£${(total / 100).toFixed(total % 100 === 0 ? 0 : 2)}`;
        const totalEl = document.getElementById('quoteTotalAmount');
        if (totalEl) {
            totalEl.textContent = display;
            totalEl.classList.remove('quote-total-pulse');
            void totalEl.offsetWidth; // force reflow
            totalEl.classList.add('quote-total-pulse');
        }

        // Render live breakdown
        const breakdownEl = document.getElementById('quoteBreakdownDisplay');
        if (breakdownEl && breakdownLines.length > 0) {
            let html = '<div class="quote-breakdown-title"><i class="fas fa-receipt"></i> Price Breakdown</div>';
            breakdownLines.forEach(line => {
                const amountText = line.note ? line.note : (line.amount === 0 ? 'Included' : penceToPounds(line.amount));
                const cls = line.amount === 0 ? 'quote-bd-included' : '';
                html += `<div class="quote-breakdown-row ${cls}"><span class="quote-bd-label">${line.label}</span><span class="quote-bd-amount">${amountText}</span></div>`;
            });
            breakdownEl.innerHTML = html;
            breakdownEl.style.display = 'block';
        } else if (breakdownEl) {
            breakdownEl.style.display = 'none';
        }

        // Show cost-aware note if we have job cost data
        const costNote = document.getElementById('quoteCostNote');
        if (costNote && jobCostData[svc]) {
            const jc = jobCostData[svc];
            costNote.innerHTML = `<small style="color:#666;"><i class="fas fa-info-circle"></i> Includes materials, travel fuel, equipment & waste costs for Cornwall</small>`;
            costNote.style.display = 'block';
        } else if (costNote) {
            costNote.style.display = 'none';
        }

        // Update servicePrices with live total
        if (svc && servicePrices[svc]) {
            servicePrices[svc].amount = total;
            servicePrices[svc].display = display;
        }

        updatePayAmount();
    }

    // Build a human-readable breakdown of selected options
    function getQuoteBreakdown() {
        const lines = [];
        document.querySelectorAll('.quote-select').forEach(sel => {
            const label = sel.closest('.quote-option-group')?.querySelector('.quote-option-label')?.textContent || '';
            const text = sel.options[sel.selectedIndex]?.text || '';
            if (label && text) lines.push(`${label}: ${text}`);
        });
        document.querySelectorAll('[data-quote-extra]:checked').forEach(cb => {
            const text = cb.closest('.quote-extra-item')?.querySelector('.quote-extra-text')?.textContent || '';
            if (text) lines.push(`+ ${text}`);
        });
        return lines.join(' | ');
    }

    // --- No payment options — enquiry only ---
    // (Payment section removed — all jobs priced in GGM Hub)

    function getActiveTermsCheckbox() {
        return document.getElementById('termsCheckEnquiry');
    }

    // --- Indicative price display when service changes ---
    function updatePayAmount() {
        // No payment banner needed — quote builder shows indicative pricing
    }

    // --- Service display names ---
    // Only 3 core services active
    const serviceNames = {
        'lawn-cutting': 'Lawn Cutting',
        'hedge-trimming': 'Hedge Trimming',
        'garden-clearance': 'Garden Clearance',
        'scarifying': 'Scarifying',
        'lawn-treatment': 'Lawn Treatment',
        'strimming': 'Strimming & Brush Cutting',
        'leaf-clearance': 'Leaf Clearance'
        /* HIDDEN: Additional services — re-enable as business grows
        ,'power-washing': 'Power Washing',
        'veg-patch': 'Vegetable Patch Preparation',
        'weeding-treatment': 'Weeding Treatment',
        'fence-repair': 'Fence Repair',
        'emergency-tree': 'Emergency Tree Surgery',
        'drain-clearance': 'Drain Clearance',
        'gutter-cleaning': 'Gutter Cleaning'
        END HIDDEN */
    };

    /* HIDDEN: Subscription upsell — re-enable if subscriptions return
    // --- Subscription upsell config ---
    // Only services that have recurring subscription options
    const subscriptionUpsell = {
        'lawn-cutting': {
            savingText: 'Subscribers save up to 25% vs one-off bookings!',
            plans: [
                { name: 'Lawn Care Weekly', price: '£30', period: '/visit', desc: 'Weekly mowing, edging, strimming & clippings', link: 'subscribe.html?package=lawn-care-weekly', popular: true },
                { name: 'Lawn Care Fortnightly', price: '£35', period: '/visit', desc: 'Fortnightly mowing, edging, strimming & clippings', link: 'subscribe.html?package=lawn-care-fortnightly', popular: false },
                { name: 'Garden Maintenance', price: '£140', period: '/month', desc: 'Full garden care — lawn + hedges + treatments', link: 'subscribe.html?package=garden-maintenance', popular: false }
            ]
        },
        'hedge-trimming': {
            savingText: 'The Garden Maintenance plan includes quarterly hedge trimming — save over 20%!',
            plans: [
                { name: 'Garden Maintenance', price: '£140', period: '/month', desc: 'Weekly lawn + quarterly hedges + treatments', link: 'subscribe.html?package=garden-maintenance', popular: true }
            ]
        },
        'lawn-treatment': {
            savingText: 'The Garden Maintenance plan includes 4 lawn treatments per year — included in the price!',
            plans: [
                { name: 'Garden Maintenance', price: '£140', period: '/month', desc: 'Weekly lawn + 4× treatments + hedges + scarifying', link: 'subscribe.html?package=garden-maintenance', popular: true }
            ]
        },
        'scarifying': {
            savingText: 'The Garden Maintenance plan includes annual scarifying at no extra cost!',
            plans: [
                { name: 'Garden Maintenance', price: '£140', period: '/month', desc: 'Weekly lawn + hedges + treatments + scarifying', link: 'subscribe.html?package=garden-maintenance', popular: true }
            ]
        },
        'gutter-cleaning': {
            savingText: 'The Property Care plan includes gutter cleaning twice a year — plus power washing & drains!',
            plans: [
                { name: 'Property Care', price: '£55', period: '/month', desc: 'Gutters 2×/yr + power washing 2×/yr + drain inspection', link: 'subscribe.html?package=property-care', popular: true }
            ]
        },
        'power-washing': {
            savingText: 'The Property Care plan includes power washing twice a year — save vs one-off!',
            plans: [
                { name: 'Property Care', price: '£55', period: '/month', desc: 'Power washing 2×/yr + gutters + drain inspection', link: 'subscribe.html?package=property-care', popular: true }
            ]
        },
        'drain-clearance': {
            savingText: 'The Property Care plan includes annual drain inspection — plus gutters & power washing!',
            plans: [
                { name: 'Property Care', price: '£55', period: '/month', desc: 'Drain inspection + gutters 2×/yr + power washing 2×/yr', link: 'subscribe.html?package=property-care', popular: true }
            ]
        }
    };

    function showSubscriptionUpsell(serviceKey) {
        const upsellEl = document.getElementById('subscriptionUpsell');
        const plansEl = document.getElementById('upsellPlans');
        const savingEl = document.getElementById('upsellSaving');
        if (!upsellEl || !plansEl) return;

        const config = subscriptionUpsell[serviceKey];
        if (!config) {
            upsellEl.style.display = 'none';
            return;
        }

        savingEl.textContent = config.savingText;
        plansEl.innerHTML = config.plans.map(p =>
            `<a href="${p.link}" class="sub-upsell-plan${p.popular ? ' popular' : ''}">
                <div class="sub-upsell-plan-name">${p.name}</div>
                <div class="sub-upsell-plan-price">${p.price}<span>${p.period}</span></div>
                <div class="sub-upsell-plan-desc">${p.desc}</div>
            </a>`
        ).join('');

        upsellEl.style.display = 'block';
    }
    END HIDDEN: Subscription upsell */

    // Stub so calls to showSubscriptionUpsell() don't error
    function showSubscriptionUpsell() { /* subscriptions hidden */ }

    // --- Double-booking prevention (capacity-aware) ---
    let checkedSlot = { date: '', time: '', service: '', available: null };
    let daySlotData = {};  // cached slot map from backend

    // ── Service capacity rules (1 person operation — 1.5hr travel buffer between jobs) ──
    const serviceRules = {
        'garden-clearance': { fullDay: true,  slots: 9, buffer: 0 },
        'hedge-trimming':   { fullDay: false, slots: 3, buffer: 2 },  // 1.5hr = 2 slots buffer
        'lawn-cutting':     { fullDay: false, slots: 1, buffer: 2 }   // 1.5hr = 2 slots buffer
        /* HIDDEN: Additional services — re-enable as business grows
        ,'power-washing':    { fullDay: true,  slots: 9, buffer: 0 },
        'scarifying':       { fullDay: true,  slots: 9, buffer: 0 },
        'emergency-tree':   { fullDay: true,  slots: 9, buffer: 0 },
        'veg-patch':        { fullDay: true,  slots: 9, buffer: 0 },
        'fence-repair':     { fullDay: false, slots: 3, buffer: 2 },
        'lawn-treatment':   { fullDay: false, slots: 2, buffer: 2 },
        'weeding-treatment': { fullDay: false, slots: 2, buffer: 2 },
        'drain-clearance':  { fullDay: false, slots: 1, buffer: 2 },
        'gutter-cleaning':  { fullDay: false, slots: 1, buffer: 2 },
        'free-quote-visit': { fullDay: false, slots: 1, buffer: 2 }
        END HIDDEN */
    };

    // ── Service durations in hours (for calendar events) ──
    // 1.5hr travel buffer is handled by serviceRules, not here
    const serviceDurations = {
        'lawn-cutting': 1, 'hedge-trimming': 3, 'garden-clearance': 8
        /* HIDDEN: Additional services
        ,'scarifying': 8, 'power-washing': 8,
        'veg-patch': 6, 'weeding-treatment': 2, 'fence-repair': 4, 'emergency-tree': 6,
        'lawn-treatment': 2, 'drain-clearance': 2, 'gutter-cleaning': 2,
        'free-quote-visit': 1
        END HIDDEN */
    };

    async function checkAvailability(date, time, service) {
        try {
            let url = SHEETS_WEBHOOK + '?action=check_availability&date=' + encodeURIComponent(date);
            if (time) url += '&time=' + encodeURIComponent(time);
            if (service) url += '&service=' + encodeURIComponent(service);
            const resp = await fetch(url);
            const data = await resp.json();
            if (data.slots) daySlotData = data;
            return data;
        } catch (e) {
            console.warn('Availability check failed:', e);
            return { available: true, slots: {}, dayBookings: [] };
        }
    }

    // ── Grey out unavailable time slots based on selected service + day data ──
    function updateSlotDisplay() {
        const slots = document.querySelectorAll('.time-slot');
        const service = serviceSelect ? serviceSelect.value : '';
        const rule = serviceRules[service] || { fullDay: false, slots: 1, buffer: 1 };
        const slotMap = daySlotData.slots || {};
        const allSlotTimes = [
            '08:00 - 09:00', '09:00 - 10:00', '10:00 - 11:00',
            '11:00 - 12:00', '12:00 - 13:00', '13:00 - 14:00',
            '14:00 - 15:00', '15:00 - 16:00', '16:00 - 17:00'
        ];

        // If full-day booked, disable everything
        if (daySlotData.fullDayBooked) {
            slots.forEach(slot => {
                slot.classList.add('slot-unavailable');
                slot.classList.remove('selected');
                slot.title = 'Full-day job booked';
            });
            return;
        }

        // If requesting a full-day service and any bookings exist
        if (rule.fullDay && daySlotData.totalBookings > 0) {
            slots.forEach(slot => {
                slot.classList.add('slot-unavailable');
                slot.classList.remove('selected');
                slot.title = 'Other jobs already booked — full-day service needs a clear day';
            });
            return;
        }

        // If max 3 jobs per day already reached
        if (daySlotData.totalBookings >= 3) {
            slots.forEach(slot => {
                slot.classList.add('slot-unavailable');
                slot.classList.remove('selected');
                slot.title = 'Max 3 jobs per day reached';
            });
            return;
        }

        slots.forEach(slot => {
            const slotTime = slot.getAttribute('data-time');
            const slotIdx = allSlotTimes.indexOf(slotTime);
            let blocked = false;
            let reason = '';

            // Check if the job itself fits in the remaining day
            if ((slotIdx + rule.slots) > allSlotTimes.length) {
                blocked = true;
                reason = 'Not enough time left in the day';
            }

            // Check if any slots this service needs (job + buffer) are already taken
            if (!blocked) {
                const totalNeeded = Math.min(slotIdx + rule.slots + rule.buffer, allSlotTimes.length);
                for (let s = slotIdx; s < totalNeeded; s++) {
                    const info = slotMap[allSlotTimes[s]];
                    if (info && info.booked) {
                        blocked = true;
                        if (info.isBuffer) {
                            reason = 'Travel buffer — allow time between jobs';
                        } else {
                            reason = info.service ? ('Booked: ' + info.service.replace(/-/g, ' ')) : 'Booked';
                        }
                        break;
                    }
                }
            }

            if (blocked) {
                slot.classList.add('slot-unavailable');
                slot.classList.remove('selected');
                slot.title = reason;
            } else {
                slot.classList.remove('slot-unavailable');
                slot.title = '';
            }
        });
    }

    // Live availability indicator
    async function updateAvailabilityIndicator() {
        const date = dateInput ? (dateInput.dataset.formatted || dateInput.value.trim()) : '';
        const time = timeInput ? timeInput.value : '';
        const service = serviceSelect ? serviceSelect.value : '';
        const indicator = document.getElementById('availabilityIndicator');
        if (!indicator) return;

        if (!date) {
            indicator.style.display = 'none';
            checkedSlot = { date: '', time: '', service: '', available: null };
            return;
        }

        // Fetch day data whenever date or service changes
        indicator.style.display = 'flex';
        indicator.className = 'availability-indicator checking';
        indicator.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Checking availability...';

        const result = await checkAvailability(date, time, service);
        checkedSlot = { date, time, service, available: result.available };

        // Update slot colours
        updateSlotDisplay();

        // Get the rule for the currently selected service
        const rule = serviceRules[service] || { fullDay: false, slots: 1, buffer: 1 };

        if (!time) {
            if (result.fullDayBooked) {
                indicator.className = 'availability-indicator unavailable';
                indicator.innerHTML = '<i class="fas fa-times-circle"></i> This date is fully booked (full-day job)';
            } else if (rule.fullDay && result.totalBookings > 0) {
                // Full-day service needs a clear day
                indicator.className = 'availability-indicator unavailable';
                indicator.innerHTML = '<i class="fas fa-times-circle"></i> This service needs a full day but other jobs are already booked — please pick another date';
            } else if (result.totalBookings >= 3) {
                indicator.className = 'availability-indicator unavailable';
                indicator.innerHTML = '<i class="fas fa-times-circle"></i> This date is fully booked (3 jobs max)';
            } else {
                const remaining = 3 - (result.totalBookings || 0);
                indicator.className = 'availability-indicator available';
                indicator.innerHTML = '<i class="fas fa-check-circle"></i> ' + remaining + ' slot' + (remaining !== 1 ? 's' : '') + ' available on this date — pick a time below';
            }
        } else if (result.available) {
            indicator.className = 'availability-indicator available';
            indicator.innerHTML = '<i class="fas fa-check-circle"></i> This time slot is available';
        } else {
            indicator.className = 'availability-indicator unavailable';
            indicator.innerHTML = '<i class="fas fa-times-circle"></i> ' + (result.reason || 'This slot is not available — please choose another time');
        }
    }

    // --- Parse "Monday, 14 March 2026" into a Date ---
    function parseBookingDate(dateStr) {
        const months = { January:0, February:1, March:2, April:3, May:4, June:5,
                         July:6, August:7, September:8, October:9, November:10, December:11 };
        // Remove day name: "14 March 2026"
        const parts = dateStr.replace(/^[A-Za-z]+,\s*/, '').split(' ');
        if (parts.length === 3) {
            return new Date(parseInt(parts[2]), months[parts[1]], parseInt(parts[0]));
        }
        return null;
    }

    // --- Build Google Calendar URL ---
    function buildCalendarUrl(service, date, time, customerName, address, postcode, phone) {
        const d = parseBookingDate(date);
        if (!d) return null;

        // Parse time "09:00" -> hours, minutes
        const [h, m] = time.split(':').map(Number);
        d.setHours(h, m, 0);

        // Use actual service duration (not hardcoded 1hr)
        const durationHours = serviceDurations[service] || 1;

        // Format as YYYYMMDDTHHMMSS (local time)
        const pad = n => String(n).padStart(2, '0');
        const start = `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
        const endDate = new Date(d.getTime() + durationHours * 60 * 60 * 1000);
        const end = `${endDate.getFullYear()}${pad(endDate.getMonth()+1)}${pad(endDate.getDate())}T${pad(endDate.getHours())}${pad(endDate.getMinutes())}00`;

        const title = encodeURIComponent(`🌿 ${serviceNames[service] || service} — ${customerName}`);
        const details = encodeURIComponent(`Customer: ${customerName}\nPhone: ${phone}\nAddress: ${address}, ${postcode}\nService: ${serviceNames[service] || service}\n\nBooked via gardnersgm.co.uk`);
        const location = encodeURIComponent(`${address}, ${postcode}`);

        return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${start}/${end}&details=${details}&location=${location}`;
    }

    // --- Build .ics content for Apple Calendar ---
    function buildIcsContent(service, date, time, customerName, address, postcode, phone) {
        const d = parseBookingDate(date);
        if (!d) return null;

        const [h, m] = time.split(':').map(Number);
        d.setHours(h, m, 0);

        const durationHours = serviceDurations[service] || 1;

        const pad = n => String(n).padStart(2, '0');
        const fmt = dt => `${dt.getFullYear()}${pad(dt.getMonth()+1)}${pad(dt.getDate())}T${pad(dt.getHours())}${pad(dt.getMinutes())}00`;
        const endDate = new Date(d.getTime() + durationHours * 60 * 60 * 1000);

        return [
            'BEGIN:VCALENDAR',
            'VERSION:2.0',
            'PRODID:-//Gardners GM//Booking//EN',
            'BEGIN:VEVENT',
            `DTSTART:${fmt(d)}`,
            `DTEND:${fmt(endDate)}`,
            `SUMMARY:🌿 ${serviceNames[service] || service} — ${customerName}`,
            `DESCRIPTION:Customer: ${customerName}\\nPhone: ${phone}\\nAddress: ${address}\\, ${postcode}\\nBooked via gardnersgm.co.uk`,
            `LOCATION:${address}\\, ${postcode}`,
            'STATUS:CONFIRMED',
            `UID:${Date.now()}@gardnersgm.co.uk`,
            'END:VEVENT',
            'END:VCALENDAR'
        ].join('\r\n');
    }

    // --- Send enquiry notification to Telegram ---
    async function sendBookingToTelegram(service, date, time, name, email, phone, address, postcode) {
        const calUrl = buildCalendarUrl(service, date, time, name, address, postcode, phone);
        const serviceName = serviceNames[service] || service;

        const quoteDisplay = ''; // Quote builder disabled — Chris builds quotes in GGM Hub
        const breakdown = '';

        // Build garden details summary for Telegram (all fields)
        const gd = collectGardenDetails();
        let gardenSummary = '';
        if (gd.gardenSize_text) gardenSummary += `📐 *Size:* ${gd.gardenSize_text}\n`;
        if (gd.gardenAreas_text) gardenSummary += `🏡 *Areas:* ${gd.gardenAreas_text}\n`;
        if (gd.gardenCondition_text) gardenSummary += `🌱 *Condition:* ${gd.gardenCondition_text}\n`;
        if (gd.hedgeCount_text) gardenSummary += `🌳 *Hedges:* ${gd.hedgeCount_text}\n`;
        if (gd.hedgeSize_text) gardenSummary += `📏 *Hedge Size:* ${gd.hedgeSize_text}\n`;
        if (gd.clearanceLevel_text) gardenSummary += `🧹 *Clearance:* ${gd.clearanceLevel_text}\n`;
        if (gd.wasteRemoval_text) gardenSummary += `🗑 *Waste:* ${gd.wasteRemoval_text}\n`;
        if (gd.treatmentType_text) gardenSummary += `💊 *Treatment:* ${gd.treatmentType_text}\n`;
        if (gd.strimmingType_text) gardenSummary += `⚡ *Work Type:* ${gd.strimmingType_text}\n`;
        if (gd.pwSurface_text) gardenSummary += `🧽 *Surface:* ${gd.pwSurface_text}\n`;
        if (gd.pwArea_text) gardenSummary += `📐 *Area:* ${gd.pwArea_text}\n`;
        if (gd.weedArea_text) gardenSummary += `🌾 *Weed Area:* ${gd.weedArea_text}\n`;
        if (gd.weedType_text) gardenSummary += `🌾 *Weed Type:* ${gd.weedType_text}\n`;
        if (gd.fenceType_text) gardenSummary += `🪵 *Fence Type:* ${gd.fenceType_text}\n`;
        if (gd.fenceHeight_text) gardenSummary += `📏 *Fence Height:* ${gd.fenceHeight_text}\n`;
        if (gd.drainType_text) gardenSummary += `🔧 *Drain Type:* ${gd.drainType_text}\n`;
        if (gd.drainCondition_text) gardenSummary += `🔧 *Drain Condition:* ${gd.drainCondition_text}\n`;
        if (gd.gutterSize_text) gardenSummary += `🏠 *Gutter Size:* ${gd.gutterSize_text}\n`;
        if (gd.gutterCondition_text) gardenSummary += `🏠 *Gutter Condition:* ${gd.gutterCondition_text}\n`;
        if (gd.vegSize_text) gardenSummary += `🥬 *Veg Patch:* ${gd.vegSize_text}\n`;
        if (gd.vegCondition_text) gardenSummary += `🥬 *Veg Condition:* ${gd.vegCondition_text}\n`;
        if (gd.treeSize_text) gardenSummary += `🌲 *Tree Size:* ${gd.treeSize_text}\n`;
        if (gd.treeWork_text) gardenSummary += `🌲 *Tree Work:* ${gd.treeWork_text}\n`;
        if (gd.extras_text) gardenSummary += `✅ *Extras:* ${gd.extras_text}\n`;

        const msg = `📩 *NEW SERVICE ENQUIRY* 📩\n` +
            `━━━━━━━━━━━━━━━━━━━━\n\n` +
            `🌿 *Service:* ${serviceName}\n` +
            `📆 *Preferred Date:* ${date}\n` +
            `🕐 *Preferred Time:* ${time}\n\n` +
            (gardenSummary ? gardenSummary + '\n' : '') +
            `👤 *Customer:* ${name}\n` +
            `📧 *Email:* ${email}\n` +
            `📞 *Phone:* ${phone}\n` +
            `📍 *Address:* ${address}, ${postcode}\n` +
            `🗺 [Get Directions](https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address + ', ' + postcode)})\n\n` +
            `💳 *Payment:* ❌ No payment taken — enquiry only\n` +
            `📝 *Action:* Price this job in GGM Hub → Operations → Enquiries\n\n` +
            (calUrl ? `[📲 Add to Google Calendar](${calUrl})\n\n` : '') +
            `⚡ _Open GGM Hub to price & quote this job_ ⚡`;

        try {
            await fetch(SHEETS_WEBHOOK, {
                method: 'POST',
                mode: 'no-cors',
                headers: { 'Content-Type': 'text/plain' },
                body: JSON.stringify({ action: 'relay_telegram', text: msg, parse_mode: 'Markdown' })
            });

            // Also send .ics file as a document for Apple Calendar
            const icsContent = buildIcsContent(service, date, time, name, address, postcode, phone);
            if (icsContent) {
                const b64 = btoa(icsContent);
                const fileName = `enquiry-${name.replace(/\s+/g, '-').toLowerCase()}.ics`;
                await fetch(SHEETS_WEBHOOK, {
                    method: 'POST',
                    mode: 'no-cors',
                    headers: { 'Content-Type': 'text/plain' },
                    body: JSON.stringify({
                        action: 'relay_telegram_document',
                        fileContent: b64,
                        mimeType: 'text/calendar',
                        fileName: fileName,
                        caption: '📎 Tap to add this enquiry to your calendar'
                    })
                });
            }
        } catch (e) {
            console.error('Telegram enquiry notification failed:', e);
        }
    }

    // --- Send enquiry to Google Sheets ---
    // Fire-and-forget: we can't read the response (no-cors), so we use multiple
    // submission methods to maximise reliability. Success is always assumed.
    function sendEnquiryToSheets(service, date, time, name, email, phone, address, postcode) {
        const serviceName = serviceNames[service] || service;
        let distance = customerDistance || '', driveTime = '', mapsUrl = '';
        if (typeof DistanceUtil !== 'undefined' && postcode) {
            try {
                const d = DistanceUtil.distanceFromBase(postcode);
                if (d && d.then) {
                    d.then(r => { /* async distance — already sent with enquiry */ }).catch(() => {});
                }
            } catch (e) { /* ignore */ }
        }

        const payload = JSON.stringify({
            action: 'service_enquiry',
            name, email, phone, address, postcode,
            service: serviceName,
            date, time,
            indicativeQuote: '',
            quoteBreakdown: '',
            distance, driveTime,
            googleMapsUrl: mapsUrl,
            notes: document.getElementById('notes') ? document.getElementById('notes').value : '',
            gardenDetails: collectGardenDetails(),
            termsAccepted: true,
            termsTimestamp: new Date().toISOString()
        });

        // Method 1: navigator.sendBeacon (most reliable — fire-and-forget, no CORS issues)
        let beaconSent = false;
        try {
            if (navigator.sendBeacon) {
                beaconSent = navigator.sendBeacon(SHEETS_WEBHOOK, new Blob([payload], { type: 'text/plain' }));
                console.log('[Enquiry] sendBeacon:', beaconSent ? 'sent' : 'failed');
            }
        } catch (e) { console.warn('[Enquiry] sendBeacon error:', e); }

        // Method 2: fetch with no-cors (backup)
        if (!beaconSent) {
            try {
                fetch(SHEETS_WEBHOOK, {
                    method: 'POST',
                    mode: 'no-cors',
                    headers: { 'Content-Type': 'text/plain' },
                    body: payload
                }).catch(e => console.warn('[Enquiry] fetch backup failed:', e));
                console.log('[Enquiry] fetch no-cors sent');
            } catch (e) { console.warn('[Enquiry] fetch error:', e); }
        }

        // Method 3: Image pixel GET fallback (last resort — limited payload via URL params)
        try {
            const img = new Image();
            const shortPayload = `action=service_enquiry&name=${encodeURIComponent(name)}&email=${encodeURIComponent(email)}&phone=${encodeURIComponent(phone)}&service=${encodeURIComponent(serviceName)}&date=${encodeURIComponent(date)}&time=${encodeURIComponent(time)}&postcode=${encodeURIComponent(postcode)}&address=${encodeURIComponent(address)}`;
            img.src = SHEETS_WEBHOOK + '?' + shortPayload;
            console.log('[Enquiry] Image pixel fallback sent');
        } catch (e) { /* ignore */ }
    }

    // --- Pre-select service from URL param ---
    const urlParams = new URLSearchParams(window.location.search);
    const preselectedService = urlParams.get('service');
    const serviceSelect = document.getElementById('service');

    if (preselectedService && serviceSelect) {
        serviceSelect.value = preselectedService;
        renderQuoteBuilder(preselectedService);
        updatePayAmount();
        showSubscriptionUpsell(preselectedService);
        toggleEmergencySlots(preselectedService);
        showGardenDetails(preselectedService);
    }
    if (serviceSelect) {
        serviceSelect.addEventListener('change', () => {
            const val = serviceSelect.value;
            toggleBespokeMode(val === 'bespoke');
            if (val !== 'bespoke') {
                renderQuoteBuilder(val);
                updatePayAmount();
                showSubscriptionUpsell(val);
                toggleEmergencySlots(val);
                showGardenDetails(val);
                // Re-check slot availability for new service type
                timeSlots.forEach(s => s.classList.remove('selected'));
                document.querySelectorAll('.emergency-slot').forEach(s => s.classList.remove('selected'));
                if (timeInput) timeInput.value = '';
                updateAvailabilityIndicator();
            }
        });
        updatePayAmount();
        showSubscriptionUpsell(serviceSelect.value);
    }

    // --- Emergency call-out slot logic ---
    function toggleEmergencySlots(serviceKey) {
        const emergBox = document.getElementById('emergencySlots');
        if (!emergBox) return;
        emergBox.style.display = serviceKey === 'emergency-tree' ? 'block' : 'none';
    }

    // --- Garden Details — show/hide service-specific questions ---
    // Extras definitions per service (matching Hub quote builder)
    const serviceExtras = {
        'lawn-cutting': [
            { id: 'extra_edging', label: 'Edging & strimming around borders' },
            { id: 'extra_clippings', label: 'Clippings collected & removed', checked: true }
        ],
        'hedge-trimming': [
            { id: 'extra_waste', label: 'Waste removal (take cuttings away)', checked: true },
            { id: 'extra_shaping', label: 'Decorative shaping' },
            { id: 'extra_reduction', label: 'Height reduction (heavy cut back)' }
        ],
        'garden-clearance': [
            { id: 'extra_skipHire', label: 'Skip hire needed (we can arrange)' },
            { id: 'extra_rubbishRemoval', label: 'Rubbish removal (van load)' },
            { id: 'extra_strimming', label: 'Strimming & brush cutting included' }
        ],
        'scarifying': [
            { id: 'extra_scarifyCollect', label: 'Thatch collected & removed', checked: true },
            { id: 'extra_scarifyOverseed', label: 'Overseeding after scarify' }
        ],
        'lawn-treatment': [],
        'strimming': [
            { id: 'extra_strimCollect', label: 'Cuttings raked & removed' }
        ],
        'leaf-clearance': [
            { id: 'extra_leafBag', label: 'Bagged & removed', checked: true },
            { id: 'extra_leafGutter', label: 'Gutter clear included' },
            { id: 'extra_leafBlow', label: 'Leaf blowing paths & patio' }
        ],
        'power-washing': [
            { id: 'extra_pwSealant', label: 'Sealant/protector after wash' },
            { id: 'extra_pwSecondSurface', label: 'Second surface to clean' }
        ],
        'weeding-treatment': [
            { id: 'extra_weedMulch', label: 'Mulch applied after weeding' },
            { id: 'extra_weedMembrane', label: 'Weed membrane installed' }
        ],
        'fence-repair': [
            { id: 'extra_fenceTreat', label: 'Wood treatment / preservative' },
            { id: 'extra_fenceWaste', label: 'Old fence waste removal' },
            { id: 'extra_fenceGravel', label: 'Gravel board replacement' }
        ],
        'drain-clearance': [
            { id: 'extra_drainJet', label: 'High-pressure jetting' },
            { id: 'extra_drainGuard', label: 'Drain guard fitted' }
        ],
        'gutter-cleaning': [
            { id: 'extra_gutterFlush', label: 'Downpipe flush' },
            { id: 'extra_gutterGuard', label: 'Gutter guard fitted' }
        ],
        'veg-patch': [
            { id: 'extra_vegCompost', label: 'Compost / topsoil supplied' },
            { id: 'extra_vegEdging', label: 'Edging / raised bed border' },
            { id: 'extra_vegMembrane', label: 'Weed membrane installed' }
        ],
        'emergency-tree': [
            { id: 'extra_treeLogSplit', label: 'Log splitting & stacking' },
            { id: 'extra_treeWaste', label: 'Full waste removal' },
            { id: 'extra_treeStump', label: 'Stump grinding required' }
        ]
    };

    function showGardenDetails(serviceKey) {
        const section = document.getElementById('gardenDetailsSection');
        if (!section) return;

        // Hide all sub-groups first
        const groups = [
            'gardenSizeGroup', 'gardenAreasGroup', 'gardenConditionGroup',
            'hedgeCountGroup', 'hedgeSizeGroup', 'clearanceLevelGroup', 'wasteRemovalGroup',
            'treatmentTypeGroup', 'strimmingTypeGroup',
            'pwSurfaceGroup', 'pwAreaGroup',
            'weedAreaGroup', 'weedTypeGroup',
            'fenceTypeGroup', 'fenceHeightGroup',
            'drainTypeGroup', 'drainConditionGroup',
            'gutterSizeGroup', 'gutterConditionGroup',
            'vegSizeGroup', 'vegConditionGroup',
            'treeSizeGroup', 'treeWorkGroup'
        ];
        groups.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = 'none';
        });

        // Hide extras
        const extrasSection = document.getElementById('extrasSection');
        if (extrasSection) extrasSection.style.display = 'none';

        if (!serviceKey || serviceKey === 'bespoke') {
            section.style.display = 'none';
            return;
        }
        section.style.display = 'block';

        // Service-specific field visibility
        const show = id => { const el = document.getElementById(id); if (el) el.style.display = 'block'; };

        switch (serviceKey) {
            case 'lawn-cutting':
                show('gardenSizeGroup');
                show('gardenAreasGroup');
                show('gardenConditionGroup');
                break;
            case 'hedge-trimming':
                show('hedgeCountGroup');
                show('hedgeSizeGroup');
                show('gardenConditionGroup');
                break;
            case 'garden-clearance':
                show('clearanceLevelGroup');
                show('gardenAreasGroup');
                show('wasteRemovalGroup');
                break;
            case 'scarifying':
                show('gardenSizeGroup');
                show('gardenAreasGroup');
                show('gardenConditionGroup');
                break;
            case 'lawn-treatment':
                show('gardenSizeGroup');
                show('gardenAreasGroup');
                show('gardenConditionGroup');
                show('treatmentTypeGroup');
                break;
            case 'strimming':
                show('gardenSizeGroup');
                show('gardenAreasGroup');
                show('gardenConditionGroup');
                show('strimmingTypeGroup');
                break;
            case 'leaf-clearance':
                show('gardenSizeGroup');
                show('gardenAreasGroup');
                break;
            case 'power-washing':
                show('pwSurfaceGroup');
                show('pwAreaGroup');
                break;
            case 'weeding-treatment':
                show('weedAreaGroup');
                show('weedTypeGroup');
                show('gardenConditionGroup');
                break;
            case 'fence-repair':
                show('fenceTypeGroup');
                show('fenceHeightGroup');
                break;
            case 'drain-clearance':
                show('drainTypeGroup');
                show('drainConditionGroup');
                break;
            case 'gutter-cleaning':
                show('gutterSizeGroup');
                show('gutterConditionGroup');
                break;
            case 'veg-patch':
                show('vegSizeGroup');
                show('vegConditionGroup');
                show('gardenAreasGroup');
                break;
            case 'emergency-tree':
                show('treeSizeGroup');
                show('treeWorkGroup');
                break;
            default:
                show('gardenSizeGroup');
                show('gardenAreasGroup');
                show('gardenConditionGroup');
                break;
        }

        // Show extras checkboxes for this service
        const extras = serviceExtras[serviceKey] || [];
        if (extras.length > 0 && extrasSection) {
            const container = document.getElementById('extrasCheckboxes');
            if (container) {
                container.innerHTML = '';
                extras.forEach(extra => {
                    const label = document.createElement('label');
                    label.style.cssText = 'display:flex;align-items:center;gap:8px;padding:8px 12px;background:#f8f9fa;border-radius:6px;cursor:pointer;font-size:0.9rem;color:#444;';
                    const cb = document.createElement('input');
                    cb.type = 'checkbox';
                    cb.id = extra.id;
                    cb.name = extra.id;
                    if (extra.checked) cb.checked = true;
                    cb.style.cssText = 'width:18px;height:18px;accent-color:#2E7D32;';
                    label.appendChild(cb);
                    label.appendChild(document.createTextNode(extra.label));
                    container.appendChild(label);
                });
                extrasSection.style.display = '';
            }
        }
    }

    // Collect garden detail answers into a structured object
    function collectGardenDetails() {
        // Dropdowns
        const dropdowns = [
            'gardenSize', 'gardenAreas', 'gardenCondition',
            'hedgeCount', 'hedgeSize', 'clearanceLevel', 'wasteRemoval',
            'treatmentType', 'strimmingType',
            'pwSurface', 'pwArea',
            'weedArea', 'weedType',
            'fenceType', 'fenceHeight',
            'drainType', 'drainCondition',
            'gutterSize', 'gutterCondition',
            'vegSize', 'vegCondition',
            'treeSize', 'treeWork'
        ];
        const details = {};
        dropdowns.forEach(id => {
            const el = document.getElementById(id);
            if (el && el.value) {
                details[id] = el.value;
                if (el.selectedIndex > 0) {
                    details[id + '_text'] = el.options[el.selectedIndex].text;
                }
            }
        });

        // Extras checkboxes
        const extrasContainer = document.getElementById('extrasCheckboxes');
        if (extrasContainer) {
            const checkboxes = extrasContainer.querySelectorAll('input[type="checkbox"]');
            const extras = [];
            checkboxes.forEach(cb => {
                if (cb.checked) {
                    const label = cb.parentElement ? cb.parentElement.textContent.trim() : cb.id;
                    extras.push(label);
                    details[cb.id] = true;
                }
            });
            if (extras.length > 0) {
                details.extras = extras;
                details.extras_text = extras.join(', ');
            }
        }

        return details;
    }

    // Bind click events on emergency slots
    document.querySelectorAll('.emergency-slot').forEach(slot => {
        slot.addEventListener('click', () => {
            // Deselect all normal + emergency slots
            timeSlots.forEach(s => s.classList.remove('selected'));
            document.querySelectorAll('.emergency-slot').forEach(s => s.classList.remove('selected'));
            slot.classList.add('selected');
            if (timeInput) timeInput.value = slot.getAttribute('data-time');
            recalcQuote(); // recalc with emergency surcharge
        });
    });

    // --- Bespoke Mode Toggle ---
    function toggleBespokeMode(isBespoke) {
        const bespokeForm = document.getElementById('bespokeRequestForm');
        const quoteBuilder = document.getElementById('quoteBuilder');
        const step2 = document.getElementById('bookingStep2');
        const step3 = document.getElementById('bookingStep3');
        const submitSec = document.getElementById('bookingSubmitSection');
        const priceHint = document.getElementById('priceHint');

        if (isBespoke) {
            if (bespokeForm) bespokeForm.style.display = 'block';
            if (quoteBuilder) quoteBuilder.style.display = 'none';
            if (step2) step2.style.display = 'none';
            if (step3) step3.style.display = 'none';
            if (submitSec) submitSec.style.display = 'none';
            if (priceHint) priceHint.textContent = '';
            showGardenDetails(''); // hide garden details in bespoke mode
        } else {
            if (bespokeForm) bespokeForm.style.display = 'none';
            if (step2) step2.style.display = '';
            if (step3) step3.style.display = '';
            if (submitSec) submitSec.style.display = '';
        }
    }

    // --- Bespoke Submit Handler ---
    const bespokeSubmitBtn = document.getElementById('bespokeSubmitBtn');
    if (bespokeSubmitBtn) {
        bespokeSubmitBtn.addEventListener('click', async () => {
            const title = document.getElementById('bespokeTitle')?.value.trim();
            const desc = document.getElementById('bespokeDescription')?.value.trim();
            const name = document.getElementById('bespokeName')?.value.trim();
            const email = document.getElementById('bespokeEmail')?.value.trim();
            const phone = document.getElementById('bespokePhone')?.value.trim();
            const postcode = document.getElementById('bespokePostcode')?.value.trim();
            const address = document.getElementById('bespokeAddress')?.value.trim();

            if (!title || !desc || !name || !email || !phone) {
                alert('Please fill in all required fields (title, description, name, email, phone).');
                return;
            }
            if (!/\S+@\S+\.\S+/.test(email)) {
                alert('Please enter a valid email address.');
                return;
            }

            bespokeSubmitBtn.disabled = true;
            bespokeSubmitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Submitting...';

            try {
                const payload = {
                    action: 'bespoke_enquiry',
                    name, email, phone, postcode, address,
                    description: `[${title}] ${desc}`
                };

                await fetch(SHEETS_WEBHOOK, {
                    method: 'POST',
                    mode: 'no-cors',
                    headers: { 'Content-Type': 'text/plain' },
                    body: JSON.stringify(payload)
                });

                // With no-cors, response is opaque — trust the request was received
                bespokeSubmitBtn.innerHTML = '<i class="fas fa-check"></i> Quote Request Sent!';
                bespokeSubmitBtn.style.background = '#388E3C';

                // Also ping Telegram (fire and forget)
                try {
                    const mapsUrl = postcode ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(postcode)}` : '';
                    const tgMsg = `🔧 *BESPOKE QUOTE REQUEST*\n\n👤 ${name}\n📧 ${email}\n📞 ${phone}\n📍 ${postcode || 'N/A'}${mapsUrl ? `\n🗺 [Get Directions](${mapsUrl})` : ''}\n\n📋 *${title}*\n${desc}`;
                    fetch(SHEETS_WEBHOOK, {
                        method: 'POST',
                        mode: 'no-cors',
                        headers: { 'Content-Type': 'text/plain' },
                        body: JSON.stringify({ action: 'relay_telegram', text: tgMsg, parse_mode: 'Markdown' })
                    });
                } catch(tgErr) { console.warn('Telegram bespoke ping failed:', tgErr); }

                // Reset form after 3 seconds
                setTimeout(() => {
                    document.getElementById('bespokeTitle').value = '';
                    document.getElementById('bespokeDescription').value = '';
                    document.getElementById('bespokeName').value = '';
                    document.getElementById('bespokeEmail').value = '';
                    document.getElementById('bespokePhone').value = '';
                    document.getElementById('bespokePostcode').value = '';
                    document.getElementById('bespokeAddress').value = '';
                    bespokeSubmitBtn.disabled = false;
                    bespokeSubmitBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Request Your Free Quote';
                    bespokeSubmitBtn.style.background = '#1B5E20';
                }, 3000);
            } catch (err) {
                console.error('Bespoke submit error:', err);
                alert('Something went wrong. Please try again or call us directly.');
                bespokeSubmitBtn.disabled = false;
                bespokeSubmitBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Request Your Free Quote';
            }
        });
    }

    // --- Flatpickr Date Picker (connected to Sheets) ---
    const dateInput = document.getElementById('date');
    let fpInstance = null;

    // Fetch busy/fully-booked dates from Google Sheets
    let fullyBookedDates = [];
    let busyDates = [];

    async function loadBusyDates() {
        try {
            const resp = await fetch(SHEETS_WEBHOOK + '?action=get_busy_dates');
            const data = await resp.json();
            if (data.status === 'success') {
                fullyBookedDates = (data.fullyBooked || []).map(d => d); // ISO strings
                busyDates = (data.busyDates || []).map(d => d);
                console.log('[Calendar] Loaded ' + fullyBookedDates.length + ' fully booked + ' + busyDates.length + ' busy dates from Sheets');
                // Refresh flatpickr to apply new disable list
                if (fpInstance) fpInstance.redraw();
            }
        } catch(e) {
            console.log('[Calendar] Busy dates fetch failed — all dates shown as available');
        }
    }

    // Helper: convert flatpickr date to ISO string for comparison
    function toISO(d) {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return y + '-' + m + '-' + day;
    }

    if (dateInput && typeof flatpickr !== 'undefined' && !dateInput._flatpickr) {
        fpInstance = flatpickr(dateInput, {
            minDate: 'today',
            maxDate: new Date().fp_incr(90), // 90 days ahead
            dateFormat: 'l, j F Y',          // e.g. "Monday, 14 March 2026"
            disableMobile: true,             // Always use flatpickr calendar, never native mobile picker
            clickOpens: true,
            allowInput: false,
            disable: [
                function(date) {
                    // Disable Sundays
                    if (date.getDay() === 0) return true;
                    // Disable fully booked dates (from Sheets)
                    if (fullyBookedDates.indexOf(toISO(date)) !== -1) return true;
                    return false;
                }
            ],
            locale: {
                firstDayOfWeek: 1 // Monday
            },
            animate: true,
            onDayCreate: function(dObj, dStr, fp, dayElem) {
                // Mark busy dates with a dot indicator
                const iso = toISO(dayElem.dateObj);
                if (busyDates.indexOf(iso) !== -1) {
                    dayElem.classList.add('busy-date');
                    dayElem.title = 'Limited slots available';
                }
                if (fullyBookedDates.indexOf(iso) !== -1) {
                    dayElem.title = 'Fully booked';
                }
            },
            onChange: function(selectedDates, dateStr) {
                dateInput.classList.remove('error');
                // Clear selected time slot and refresh availability
                timeSlots.forEach(s => s.classList.remove('selected'));
                if (timeInput) timeInput.value = '';
                updateAvailabilityIndicator();
            }
        });

        // Mobile Safari fix: readonly inputs sometimes don't fire click/focus events
        // Add touchend listener as fallback to open the calendar
        dateInput.addEventListener('touchend', function(e) {
            if (fpInstance && !fpInstance.isOpen) {
                e.preventDefault();
                fpInstance.open();
            }
        });

        // Load busy dates from Sheets
        loadBusyDates();

        console.log('[Calendar] Flatpickr initialised successfully');

    } else if (dateInput && dateInput._flatpickr) {
        // Already initialised by inline failsafe — just grab the instance
        fpInstance = dateInput._flatpickr;
        console.log('[Calendar] Flatpickr already initialised by failsafe — reusing instance');
        loadBusyDates();

    } else if (dateInput) {
        // Fallback: native HTML date picker if flatpickr didn't load
        console.warn('[Calendar] Flatpickr not available — using native date picker');
        dateInput.removeAttribute('readonly');
        dateInput.type = 'date';
        const today = new Date();
        dateInput.min = toISO(today);
        const maxD = new Date(today.getTime() + 90 * 24 * 60 * 60 * 1000);
        dateInput.max = toISO(maxD);
        dateInput.addEventListener('change', function() {
            // Convert native date format to human-readable for the rest of the form
            const parts = dateInput.value.split('-');
            if (parts.length === 3) {
                const d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
                const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
                const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
                dateInput.dataset.formatted = days[d.getDay()] + ', ' + d.getDate() + ' ' + months[d.getMonth()] + ' ' + d.getFullYear();
            }
            timeSlots.forEach(s => s.classList.remove('selected'));
            if (timeInput) timeInput.value = '';
            updateAvailabilityIndicator();
        });
    }

    // --- Time Slot Selection ---
    const timeSlots = document.querySelectorAll('#timeSlots .time-slot');
    const timeInput = document.getElementById('time');

    timeSlots.forEach(slot => {
        slot.addEventListener('click', () => {
            // Block click on unavailable slots
            if (slot.classList.contains('slot-unavailable')) return;
            timeSlots.forEach(s => s.classList.remove('selected'));
            document.querySelectorAll('.emergency-slot').forEach(s => s.classList.remove('selected'));
            slot.classList.add('selected');
            if (timeInput) {
                timeInput.value = slot.getAttribute('data-time');
            }
            recalcQuote(); // recalc in case emergency surcharge needs removing
            updateAvailabilityIndicator();
        });
    });

    // --- Form Validation & Submission ---
    const bookingForm = document.getElementById('bookingForm');
    const bookingSuccess = document.getElementById('bookingSuccess');

    if (bookingForm) {
        bookingForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            // Basic validation
            const name = document.getElementById('name').value.trim();
            const email = document.getElementById('email').value.trim();
            const phone = document.getElementById('phone').value.trim();
            const postcode = document.getElementById('postcode').value.trim();
            const address = document.getElementById('address').value.trim();
            const service = serviceSelect ? serviceSelect.value : '';
            // Handle native date fallback (dataset.formatted) vs flatpickr (direct value)
            const date = dateInput ? (dateInput.dataset.formatted || dateInput.value.trim()) : '';
            const time = timeInput ? timeInput.value : '';

            let isValid = true;
            let firstError = null;

            // Check required fields
            const requiredFields = [
                { el: document.getElementById('name'), val: name },
                { el: document.getElementById('email'), val: email },
                { el: document.getElementById('phone'), val: phone },
                { el: document.getElementById('postcode'), val: postcode },
                { el: document.getElementById('address'), val: address },
                { el: serviceSelect, val: service },
                { el: dateInput, val: date }
            ];

            requiredFields.forEach(field => {
                if (!field.val) {
                    field.el.style.borderColor = '#e53935';
                    isValid = false;
                    if (!firstError) firstError = field.el;
                } else {
                    field.el.style.borderColor = '';
                }
            });

            if (!time) {
                isValid = false;
                if (!firstError) firstError = document.getElementById('timeSlots');
            }

            // Email validation
            if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                document.getElementById('email').style.borderColor = '#e53935';
                isValid = false;
            }

            if (!isValid) {
                if (firstError) firstError.scrollIntoView({ behavior: 'smooth', block: 'center' });
                return;
            }

            // --- Terms acceptance validation ---
            const termsCheckbox = getActiveTermsCheckbox();
            if (termsCheckbox && !termsCheckbox.checked) {
                const errEl = document.getElementById('termsError');
                if (errEl) { errEl.style.display = 'block'; }
                document.getElementById('termsBlock').scrollIntoView({ behavior: 'smooth', block: 'center' });
                return;
            }

            // Submit button state
            const submitBtn = document.getElementById('submitBtn');
            const originalText = submitBtn.innerHTML;
            submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Submitting enquiry...';
            submitBtn.disabled = true;

            // --- Submit enquiry (no payment) ---
            // Fire-and-forget: send enquiry data, then ALWAYS show success
            // (matches the working contact form pattern)
            try {
                // Send enquiry to Google Sheets (fire-and-forget, multiple methods)
                sendEnquiryToSheets(service, date, time, name, email, phone, address, postcode);

                // Send Telegram notification + photos (non-critical — fire and forget)
                try {
                    sendBookingToTelegram(service, date, time, name, email, phone, address, postcode);
                    sendPhotosToTelegram(name);
                } catch(tgErr) { console.warn('Telegram notification failed (non-critical):', tgErr); }
            } catch(submitErr) {
                console.error('Enquiry submission error (non-blocking):', submitErr);
            }

            // ALWAYS show success — we can't verify the no-cors request was received,
            // but GAS sends admin email + Telegram as confirmation
            const successMsg = document.getElementById('successMsg');
            if (successMsg) {
                const serviceName = serviceNames[service] || service;
                let dateNote = '';
                if (date) {
                    dateNote = ` We've noted your preferred date of ${date}`;
                    if (time) dateNote += ` at ${time}`;
                    dateNote += '.';
                }
                successMsg.textContent = `Thank you! Your enquiry for ${serviceName} has been received.${dateNote} Chris will review your details and send you a personalised quote shortly — usually within a few hours. No payment is taken until you've accepted the quote.`;
            }

            bookingForm.style.display = 'none';
            bookingSuccess.style.display = 'block';
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });

        // Clear error styling on input focus
        bookingForm.querySelectorAll('input, select, textarea').forEach(input => {
            input.addEventListener('focus', () => {
                input.style.borderColor = '';
            });
        });
    }


    // ============================================
    // PHOTO UPLOAD HANDLER
    // ============================================
    const photoInput = document.getElementById('jobPhotos');
    const photoZone  = document.getElementById('photoUploadZone');
    const photoGrid  = document.getElementById('photoPreviewGrid');
    const photoPlaceholder = document.getElementById('photoPlaceholder');
    const MAX_PHOTOS = 5;
    const MAX_SIZE   = 10 * 1024 * 1024; // 10 MB

    // Use shared array so inline fallback and booking.js work together
    if (!window._bookingPhotos) window._bookingPhotos = [];
    let selectedPhotos = window._bookingPhotos;

    // Only bind listeners if the inline fallback hasn't already done so
    if (photoInput && photoZone && !photoInput.dataset.handlerBound) {
        photoInput.dataset.handlerBound = '1';
        photoInput.addEventListener('change', handlePhotoSelect);

        // Drag-and-drop
        photoZone.addEventListener('dragover',  e => { e.preventDefault(); photoZone.classList.add('dragover'); });
        photoZone.addEventListener('dragleave', () => photoZone.classList.remove('dragover'));
        photoZone.addEventListener('drop', e => {
            e.preventDefault();
            photoZone.classList.remove('dragover');
            if (e.dataTransfer.files) handleFiles(Array.from(e.dataTransfer.files));
        });
        console.log('[PhotoUpload] booking.js handler attached (no inline fallback)');
    } else if (photoInput) {
        console.log('[PhotoUpload] Inline fallback already active — booking.js skipping listener binding');
    }

    function handlePhotoSelect(e) {
        if (e.target.files) handleFiles(Array.from(e.target.files));
    }

    function handleFiles(files) {
        files.forEach(file => {
            if (selectedPhotos.length >= MAX_PHOTOS) return;
            if (!file.type.startsWith('image/')) return;
            if (file.size > MAX_SIZE) {
                alert(`"${file.name}" is too large (max 10MB).`);
                return;
            }
            selectedPhotos.push(file);
        });
        renderPhotoPreviews();
    }

    function renderPhotoPreviews() {
        if (!photoGrid) return;
        photoGrid.innerHTML = '';

        if (selectedPhotos.length === 0) {
            if (photoPlaceholder) photoPlaceholder.style.display = '';
            return;
        }

        if (photoPlaceholder) photoPlaceholder.style.display = 'none';

        selectedPhotos.forEach((file, idx) => {
            const url = URL.createObjectURL(file);
            const div = document.createElement('div');
            div.className = 'photo-preview-item';
            div.innerHTML = `
                <img src="${url}" alt="Photo ${idx + 1}">
                <button type="button" class="photo-preview-remove" data-idx="${idx}" title="Remove">&times;</button>
            `;
            photoGrid.appendChild(div);
        });

        // Count label
        const count = document.createElement('div');
        count.className = 'photo-upload-count';
        count.textContent = `${selectedPhotos.length} / ${MAX_PHOTOS} photos`;
        photoGrid.appendChild(count);

        // Remove handlers
        photoGrid.querySelectorAll('.photo-preview-remove').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const i = parseInt(btn.dataset.idx);
                selectedPhotos.splice(i, 1);
                renderPhotoPreviews();
            });
        });
    }

    // Send photos to Telegram as a media group
    async function sendPhotosToTelegram(customerName) {
        if (!selectedPhotos.length) return;
        try {
            for (let i = 0; i < selectedPhotos.length; i++) {
                const file = selectedPhotos[i];
                const b64 = await new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () => resolve(reader.result.split(',')[1]);
                    reader.onerror = reject;
                    reader.readAsDataURL(file);
                });
                const caption = i === 0
                    ? `📸 Photos from ${customerName}'s enquiry (${i + 1}/${selectedPhotos.length})`
                    : `📸 Photo ${i + 1}/${selectedPhotos.length}`;
                try {
                    await fetch(SHEETS_WEBHOOK, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            action: 'relay_telegram_photo',
                            fileContent: b64,
                            mimeType: file.type,
                            fileName: file.name,
                            caption: caption
                        })
                    });
                } catch (fetchErr) {
                    console.warn('Photo send failed, trying no-cors fallback:', fetchErr);
                    await fetch(SHEETS_WEBHOOK, {
                        method: 'POST',
                        mode: 'no-cors',
                        headers: { 'Content-Type': 'text/plain' },
                        body: JSON.stringify({
                            action: 'relay_telegram_photo',
                            fileContent: b64,
                            mimeType: file.type,
                            fileName: file.name,
                            caption: caption
                        })
                    });
                }
            }
            console.log('[PhotoUpload] All photos sent to Telegram');
        } catch (e) {
            console.error('Failed to send photos to Telegram:', e);
        }
    }

    // ── Address Finder hookup ──
    console.log('[AddressLookup] Hookup starting. AddressLookup defined:', typeof AddressLookup !== 'undefined');
    if (typeof AddressLookup !== 'undefined') {
        const bookPC = document.getElementById('postcode');
        const bookFind = document.getElementById('bookFindAddr');
        const bookDrop = document.getElementById('bookAddrDropdown');
        const bookAddr = document.getElementById('address');
        console.log('[AddressLookup] Elements:', !!bookPC, !!bookFind, !!bookDrop, !!bookAddr);
        if (bookPC && bookFind && bookDrop) {
            AddressLookup.attach({
                postcodeInput: bookPC,
                findBtn: bookFind,
                dropdown: bookDrop,
                addressInput: bookAddr,
                onSelect: () => { calcDistanceFromPostcode(); }
            });
            console.log('[AddressLookup] Attached successfully');
        }
    } else {
        console.error('[AddressLookup] AddressLookup not defined — script may have failed to load');
    }

    // ── Distance-based travel surcharge (independent of AddressLookup) ──
    let distanceCalcTimer = null;
    async function calcDistanceFromPostcode() {
        const bookPC = document.getElementById('postcode');
        if (!bookPC || typeof DistanceUtil === 'undefined') return;
        const pc = bookPC.value.trim();
        if (pc.length < 5) return;
        
        // Show calculating indicator
        const noteEl = document.getElementById('quoteTotalNote');
        const origNote = noteEl ? noteEl.textContent : '';
        if (noteEl) noteEl.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Calculating travel...';
        
        try {
            const d = await DistanceUtil.distanceFromBase(pc);
            if (d && d.drivingMiles) {
                customerDistance = d.drivingMiles;
                recalcQuote(); // retrigger with distance factored in
                if (noteEl) {
                    if (customerDistance > 15) {
                        noteEl.textContent = `📍 ${Math.round(customerDistance)} miles — travel surcharge applies`;
                    } else {
                        noteEl.textContent = `📍 ${Math.round(customerDistance)} miles — no travel surcharge`;
                    }
                }
            }
        } catch(e) {
            console.warn('[Distance] Postcode lookup failed:', e);
            if (noteEl) noteEl.textContent = '⚠️ Could not calculate distance — travel surcharge may apply on arrival';
            // Don't silently fail — keep customerDistance at whatever it was
        }
    }

    // Hook up distance on postcode blur + debounced input
    const distPC = document.getElementById('postcode');
    if (distPC) {
        distPC.addEventListener('blur', () => { calcDistanceFromPostcode(); });
        distPC.addEventListener('input', () => {
            clearTimeout(distanceCalcTimer);
            distanceCalcTimer = setTimeout(() => {
                const pc = distPC.value.trim();
                if (pc.length >= 6) calcDistanceFromPostcode(); // 6+ chars = likely full postcode
            }, 800);
        });
    }
});
