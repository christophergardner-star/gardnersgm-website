/* ============================================
   Gardners Ground Maintenance — Enquiry JS
   Handles: Flatpickr calendar, time slots,
   form validation, enquiry submission
   (No payments — enquiry-only, priced in GGM Hub)
   ============================================ */

document.addEventListener('DOMContentLoaded', () => {

    // --- Config ---
    const SHEETS_WEBHOOK = 'https://script.google.com/macros/s/AKfycbyjUkYuFrpigXi6chj1B4z-xjHsgnnmkcQ_SejJwdqbstbAq-QooLz9G1sQpfl3vGGufQ/exec';

    // --- Service prices (starting prices in pence) ---
    // Only 3 core services active — others hidden for future expansion
    const servicePrices = {
        'lawn-cutting':     { amount: 3000, display: '£30' },
        'hedge-trimming':   { amount: 4500, display: '£45' },
        'garden-clearance': { amount: 10000, display: '£100' }
        /* HIDDEN: Additional services — re-enable as business grows
        ,'scarifying':       { amount: 7000, display: '£70' },
        'lawn-treatment':   { amount: 3500, display: '£35' },
        'power-washing':    { amount: 5000, display: '£50' },
        'veg-patch':        { amount: 7000, display: '£70' },
        'weeding-treatment': { amount: 4000, display: '£40' },
        'fence-repair':     { amount: 6500, display: '£65' },
        'emergency-tree':   { amount: 18000, display: '£180' },
        'drain-clearance':  { amount: 4500, display: '£45' },
        'gutter-cleaning':  { amount: 4500, display: '£45' }
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
                    { text: 'Small (up to 50m²)', value: 3000 },
                    { text: 'Medium (50–150m²)', value: 4000 },
                    { text: 'Large (150–300m²)', value: 5500 },
                    { text: 'Extra Large (300m²+)', value: 7500 }
                ]},
                { id: 'lawnArea', label: 'Areas', type: 'select', choices: [
                    { text: 'Front only', value: 0 },
                    { text: 'Back only', value: 0 },
                    { text: 'Front & Back', value: 1000 }
                ]}
            ],
            extras: [
                { id: 'edging', label: 'Edging & strimming', price: 500 },
                { id: 'clippings', label: 'Clippings collected & removed', price: 0, checked: true }
                // HIDDEN: { id: 'stripes', label: 'Striped finish', price: 500 }
            ]
        },
        'hedge-trimming': {
            options: [
                { id: 'hedgeCount', label: 'Number of Hedges', type: 'select', choices: [
                    { text: '1 hedge', value: 0 },
                    { text: '2 hedges', value: 2500 },
                    { text: '3 hedges', value: 4500 },
                    { text: '4+ hedges', value: 7000 }
                ]},
                { id: 'hedgeSize', label: 'Hedge Size', type: 'select', choices: [
                    { text: 'Small (under 2m tall, under 5m long)', value: 4500 },
                    { text: 'Medium (2–3m tall, 5–15m long)', value: 8500 },
                    { text: 'Large (3m+ tall or 15m+ long)', value: 15000 }
                ]}
            ],
            extras: [
                { id: 'waste', label: 'Waste removal included', price: 0, checked: true },
                { id: 'shaping', label: 'Decorative shaping', price: 2000 },
                { id: 'reduction', label: 'Height reduction (heavy cut back)', price: 3500 }
            ]
        },
        'garden-clearance': {
            options: [
                { id: 'clearLevel', label: 'Clearance Level', type: 'select', choices: [
                    { text: 'Light (tidy up, minor overgrowth)', value: 10000 },
                    { text: 'Medium (overgrown beds, some waste)', value: 18000 },
                    { text: 'Heavy (fully overgrown / neglected)', value: 28000 },
                    { text: 'Full property clearance', value: 42000 }
                ]}
            ],
            extras: [
                { id: 'skipHire', label: 'Skip hire (we arrange it)', price: 22000 },
                { id: 'rubbishRemoval', label: 'Rubbish removal (van load)', price: 7500 },
                { id: 'strimming', label: 'Strimming & brush cutting', price: 2500 }
            ]
        }
        /* HIDDEN: Additional service quote configs — re-enable as business grows
        ,'power-washing': {
            options: [
                { id: 'pwSurface', label: 'Surface Type', type: 'select', choices: [
                    { text: 'Patio', value: 5000 },
                    { text: 'Driveway', value: 7000 },
                    { text: 'Decking', value: 6000 },
                    { text: 'Paths / steps', value: 4000 },
                    { text: 'Walls / fencing', value: 6000 }
                ]},
                { id: 'pwArea', label: 'Area Size', type: 'select', choices: [
                    { text: 'Small (up to 15m²)', value: 0 },
                    { text: 'Medium (15–40m²)', value: 2500 },
                    { text: 'Large (40–80m²)', value: 5000 },
                    { text: 'Extra Large (80m²+)', value: 8500 }
                ]}
            ],
            extras: [
                { id: 'pwSealant', label: 'Sealant / re-sand after washing', price: 3500 },
                { id: 'pwSecondSurface', label: 'Additional surface (+50%)', price: 0, multiplier: 0.5 }
            ]
        },
        'veg-patch': {
            options: [
                { id: 'vegSize', label: 'Patch Size', type: 'select', choices: [
                    { text: 'Small raised bed (up to 4m²)', value: 7000 },
                    { text: 'Medium plot (4–12m²)', value: 10000 },
                    { text: 'Large allotment-style (12–30m²)', value: 15000 },
                    { text: 'Extra Large (30m²+)', value: 22000 }
                ]},
                { id: 'vegCondition', label: 'Current Condition', type: 'select', choices: [
                    { text: 'Bare soil — ready to prep', value: 0 },
                    { text: 'Overgrown — needs clearing first', value: 3500 },
                    { text: 'New bed — turf removal required', value: 5000 }
                ]}
            ],
            extras: [
                { id: 'vegCompost', label: 'Compost & soil improver added', price: 2500 },
                { id: 'vegEdging', label: 'Timber edging / raised bed frame', price: 4500 },
                { id: 'vegMembrane', label: 'Weed membrane laid', price: 1500 }
            ]
        },
        'weeding-treatment': {
            options: [
                { id: 'weedArea', label: 'Area Size', type: 'select', choices: [
                    { text: 'Small (single border / beds)', value: 4000 },
                    { text: 'Medium (front or back garden)', value: 6000 },
                    { text: 'Large (full garden)', value: 9000 },
                    { text: 'Extra Large (extensive grounds)', value: 14000 }
                ]},
                { id: 'weedType', label: 'Treatment Type', type: 'select', choices: [
                    { text: 'Hand weeding only', value: 0 },
                    { text: 'Spray treatment (selective)', value: 1500 },
                    { text: 'Hand weeding + spray combo', value: 2500 }
                ]}
            ],
            extras: [
                { id: 'weedMulch', label: 'Bark mulch applied after', price: 3000 },
                { id: 'weedMembrane', label: 'Weed membrane under mulch', price: 1500 }
            ]
        },
        'fence-repair': {
            options: [
                { id: 'fenceType', label: 'Repair Type', type: 'select', choices: [
                    { text: 'Panel replacement (1 panel)', value: 6500 },
                    { text: 'Panel replacement (2–3 panels)', value: 13000 },
                    { text: 'Panel replacement (4+ panels)', value: 19000 },
                    { text: 'Post repair / replacement', value: 5000 },
                    { text: 'Full fence section rebuild', value: 22000 }
                ]},
                { id: 'fenceHeight', label: 'Fence Height', type: 'select', choices: [
                    { text: 'Standard (up to 6ft)', value: 0 },
                    { text: 'Tall (over 6ft)', value: 2500 }
                ]}
            ],
            extras: [
                { id: 'fenceTreat', label: 'Timber treatment / staining', price: 2000 },
                { id: 'fenceWaste', label: 'Old fence removal & disposal', price: 2500 },
                { id: 'fenceGravel', label: 'Gravel board installation', price: 1500 }
            ]
        },
        'emergency-tree': {
            options: [
                { id: 'treeSize', label: 'Tree Size', type: 'select', choices: [
                    { text: 'Small tree (under 5m)', value: 18000 },
                    { text: 'Medium tree (5–10m)', value: 35000 },
                    { text: 'Large tree (10m+)', value: 60000 }
                ]},
                { id: 'treeWork', label: 'Work Required', type: 'select', choices: [
                    { text: 'Fallen branch removal', value: 0 },
                    { text: 'Storm-damaged crown reduction', value: 10000 },
                    { text: 'Emergency felling (dangerous tree)', value: 25000 },
                    { text: 'Root plate / stump emergency', value: 17500 }
                ]}
            ],
            extras: [
                { id: 'treeLogSplit', label: 'Log splitting & stacking', price: 6500 },
                { id: 'treeWaste', label: 'Full waste removal & chipping', price: 8500 },
                { id: 'treeStump', label: 'Stump grinding', price: 12000 }
            ]
        },
        'drain-clearance': {
            options: [
                { id: 'drainType', label: 'Drain Type', type: 'select', choices: [
                    { text: 'Single blocked drain', value: 4500 },
                    { text: 'Multiple drains (2-3)', value: 7000 },
                    { text: 'Full garden drainage run', value: 11000 }
                ]},
                { id: 'drainCondition', label: 'Condition', type: 'select', choices: [
                    { text: 'Partially blocked (slow)', value: 0 },
                    { text: 'Fully blocked (standing water)', value: 1500 },
                    { text: 'Root ingress', value: 3000 }
                ]}
            ],
            extras: [
                { id: 'drainJet', label: 'Pressure jetting', price: 2500 },
                { id: 'drainGuard', label: 'Drain guard installation', price: 1500 }
            ]
        },
        'gutter-cleaning': {
            options: [
                { id: 'gutterLength', label: 'Property Size', type: 'select', choices: [
                    { text: 'Small (terraced / 1-2 bed)', value: 4500 },
                    { text: 'Medium (semi / 3 bed)', value: 6500 },
                    { text: 'Large (detached / 4+ bed)', value: 9000 }
                ]},
                { id: 'gutterCondition', label: 'Condition', type: 'select', choices: [
                    { text: 'Routine clean (light debris)', value: 0 },
                    { text: 'Heavy build-up / moss', value: 1500 },
                    { text: 'Overflowing / plant growth', value: 2500 }
                ]}
            ],
            extras: [
                { id: 'gutterFlush', label: 'Downpipe flush & check', price: 1500 },
                { id: 'gutterGuard', label: 'Gutter guard installation', price: 2500 }
            ]
        }
        END HIDDEN */
    };

    // Current quote total in pence
    let currentQuoteTotal = 3000; // £30 minimum default

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
        'garden-clearance': 'Garden Clearance'
        /* HIDDEN: Additional services — re-enable as business grows
        ,'scarifying': 'Scarifying',
        'lawn-treatment': 'Lawn Treatment',
        'power-washing': 'Power Washing',
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

        const msg = `📩 *NEW SERVICE ENQUIRY* 📩\n` +
            `━━━━━━━━━━━━━━━━━━━━\n\n` +
            `🌿 *Service:* ${serviceName}\n` +
            `📆 *Preferred Date:* ${date}\n` +
            `🕐 *Preferred Time:* ${time}\n\n` +
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
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'relay_telegram', text: msg, parse_mode: 'Markdown' })
            });

            // Also send .ics file as a document for Apple Calendar
            const icsContent = buildIcsContent(service, date, time, name, address, postcode, phone);
            if (icsContent) {
                const b64 = btoa(icsContent);
                const fileName = `enquiry-${name.replace(/\s+/g, '-').toLowerCase()}.ics`;
                await fetch(SHEETS_WEBHOOK, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
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
    async function sendEnquiryToSheets(service, date, time, name, email, phone, address, postcode) {
        if (!SHEETS_WEBHOOK) return;
        const serviceName = serviceNames[service] || service;

        // Get distance if available
        let distance = customerDistance || '', driveTime = '', mapsUrl = '';
        if (typeof DistanceUtil !== 'undefined' && postcode) {
            try {
                const d = await DistanceUtil.distanceFromBase(postcode);
                if (d) {
                    distance = d.drivingMiles;
                    driveTime = d.driveMinutes;
                    mapsUrl = d.googleMapsUrl;
                }
            } catch (e) { console.warn('[Distance] Final calc failed:', e); }
        }

        try {
            await fetch(SHEETS_WEBHOOK, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain' },
                body: JSON.stringify({
                    action: 'service_enquiry',
                    name, email, phone, address, postcode,
                    service: serviceName,
                    date, time,
                    indicativeQuote: '',
                    quoteBreakdown: '',
                    distance, driveTime,
                    googleMapsUrl: mapsUrl,
                    notes: document.getElementById('notes') ? document.getElementById('notes').value : '',
                    termsAccepted: true,
                    termsTimestamp: new Date().toISOString()
                })
            });
        } catch (e) {
            console.error('Enquiry submission failed:', e);
        }
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

                const resp = await fetch(SHEETS_WEBHOOK, {
                    method: 'POST',
                    body: JSON.stringify(payload)
                });
                const data = await resp.json();

                if (data.status === 'success' || data.result === 'success') {
                    bespokeSubmitBtn.innerHTML = '<i class="fas fa-check"></i> Quote Request Sent!';
                    bespokeSubmitBtn.style.background = '#388E3C';

                    // Also ping Telegram
                    try {
                        const mapsUrl = postcode ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(postcode)}` : '';
                        const tgMsg = `🔧 *BESPOKE QUOTE REQUEST*\n\n👤 ${name}\n📧 ${email}\n📞 ${phone}\n📍 ${postcode || 'N/A'}${mapsUrl ? `\n🗺 [Get Directions](${mapsUrl})` : ''}\n\n📋 *${title}*\n${desc}`;
                        await fetch(SHEETS_WEBHOOK, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
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
                } else {
                    throw new Error(data.message || 'Submission failed');
                }
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
            try {
                // Send enquiry to Sheets + Telegram + send photos
                await sendEnquiryToSheets(service, date, time, name, email, phone, address, postcode);
                sendBookingToTelegram(service, date, time, name, email, phone, address, postcode);
                sendPhotosToTelegram(name);
            } catch(bgErr) { console.warn('Background task error:', bgErr); }

            // Show success message
            const successMsg = document.getElementById('successMsg');
            if (successMsg) {
                const serviceName = serviceNames[service] || service;
                successMsg.textContent = `Thank you! We've received your enquiry for ${serviceName}. Chris will review your request and get back to you with a personalised quote, usually within 24 hours.`;
            }

            bookingForm.style.display = 'none';
            bookingSuccess.style.display = 'block';
            window.scrollTo({ top: 0, behavior: 'smooth' });

            submitBtn.innerHTML = originalText;
            submitBtn.disabled = false;
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
    let selectedPhotos = []; // array of File objects

    if (photoInput && photoZone) {
        photoInput.addEventListener('change', handlePhotoSelect);

        // Drag-and-drop
        photoZone.addEventListener('dragover',  e => { e.preventDefault(); photoZone.classList.add('dragover'); });
        photoZone.addEventListener('dragleave', () => photoZone.classList.remove('dragover'));
        photoZone.addEventListener('drop', e => {
            e.preventDefault();
            photoZone.classList.remove('dragover');
            if (e.dataTransfer.files) handleFiles(Array.from(e.dataTransfer.files));
        });
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
                    ? `📸 Photos from ${customerName}'s booking (${i + 1}/${selectedPhotos.length})`
                    : `📸 Photo ${i + 1}/${selectedPhotos.length}`;
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
            }
        } catch (e) {
            console.error('Failed to send photos to Telegram:', e);
        }
    }

    // ── Address Finder hookup ──
    if (typeof AddressLookup !== 'undefined') {
        const bookPC = document.getElementById('postcode');
        const bookFind = document.getElementById('bookFindAddr');
        const bookDrop = document.getElementById('bookAddrDropdown');
        const bookAddr = document.getElementById('address');
        if (bookPC && bookFind && bookDrop) {
            AddressLookup.attach({
                postcodeInput: bookPC,
                findBtn: bookFind,
                dropdown: bookDrop,
                addressInput: bookAddr,
                onSelect: () => { calcDistanceFromPostcode(); } // recalc distance when address selected
            });
        }
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
