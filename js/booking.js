/* ============================================
   Gardners Ground Maintenance — Booking JS
   Handles: Flatpickr calendar, time slots,
   form validation, Web3Forms submission,
   Telegram diary notifications
   ============================================ */

document.addEventListener('DOMContentLoaded', () => {

    // --- Config ---
    const SHEETS_WEBHOOK = 'https://script.google.com/macros/s/AKfycbx-q2qSeCorIEeXPE9d2MgAZLKEFwFNW9lARLE1yYciH9wJWwvktUTuDVLz_rSCbUhkMg/exec';
    const STRIPE_PK = 'pk_live_51RZrhDCI9zZxpqlvcul8rw23LHMQAKCpBRCjg94178nwq22d1y2aJMz92SEvKZlkOeSWLJtK6MGPJcPNSeNnnqvt00EAX9Wgqt';

    // --- Stripe setup (wrapped in try/catch so rest of booking still works if Stripe fails) ---
    let stripe, elements, cardElement;
    let paymentRequest = null;
    let walletPaymentMethodId = null; // Set when user pays via Apple/Google Pay
    try {
        stripe = Stripe(STRIPE_PK);
        elements = stripe.elements();
        cardElement = elements.create('card', {
            style: {
                base: {
                    fontSize: '16px',
                    color: '#333',
                    fontFamily: 'Poppins, sans-serif',
                    '::placeholder': { color: '#aab7c4' }
                },
                invalid: { color: '#e53935' }
            }
        });
        setTimeout(() => {
            const cardMount = document.getElementById('cardElement');
            if (cardMount) cardElement.mount('#cardElement');
        }, 100);

        cardElement.on('change', (ev) => {
            const errEl = document.getElementById('cardErrors');
            if (errEl) errEl.textContent = ev.error ? ev.error.message : '';
        });

        // --- Apple Pay / Google Pay via Payment Request Button ---
        paymentRequest = stripe.paymentRequest({
            country: 'GB',
            currency: 'gbp',
            total: { label: 'Gardners GM Booking', amount: 3000 },
            requestPayerName: true,
            requestPayerEmail: true,
            requestPayerPhone: true
        });

        const prButton = elements.create('paymentRequestButton', { paymentRequest });

        paymentRequest.canMakePayment().then(result => {
            if (result) {
                const container = document.getElementById('walletButtonContainer');
                if (container) container.style.display = 'block';
                prButton.mount('#paymentRequestButton');
            }
        });

        paymentRequest.on('paymentmethod', async (ev) => {
            // User completed Apple Pay / Google Pay — store the paymentMethod and auto-submit
            walletPaymentMethodId = ev.paymentMethod.id;
            ev.complete('success');

            // Auto-fill contact from wallet if fields are empty
            if (ev.payerName && !document.getElementById('name').value) document.getElementById('name').value = ev.payerName;
            if (ev.payerEmail && !document.getElementById('email').value) document.getElementById('email').value = ev.payerEmail;
            if (ev.payerPhone && !document.getElementById('phone').value) document.getElementById('phone').value = ev.payerPhone;

            // Trigger the booking form submit
            const submitBtn = document.getElementById('submitBooking');
            if (submitBtn) submitBtn.click();
        });

    } catch(stripeErr) {
        console.error('[Stripe] Initialisation failed — booking form still usable:', stripeErr);
    }

    // --- Service prices (starting prices in pence) ---
    // £40 minimum call-out applies to all services (matches services.html guarantee)
    const servicePrices = {
        'lawn-cutting':     { amount: 3000, display: '£30' },
        'hedge-trimming':   { amount: 4500, display: '£45' },
        'scarifying':       { amount: 7000, display: '£70' },
        'lawn-treatment':   { amount: 3500, display: '£35' },
        'garden-clearance': { amount: 10000, display: '£100' },
        'power-washing':    { amount: 5000, display: '£50' },
        'veg-patch':        { amount: 7000, display: '£70' },
        'weeding-treatment': { amount: 4000, display: '£40' },
        'fence-repair':     { amount: 6500, display: '£65' },
        'emergency-tree':   { amount: 18000, display: '£180' },
        'drain-clearance':  { amount: 4500, display: '£45' },
        'gutter-cleaning':  { amount: 4500, display: '£45' }
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
        'scarifying': {
            options: [
                { id: 'scarLawnSize', label: 'Lawn Size', type: 'select', choices: [
                    { text: 'Small (up to 50m²)', value: 7000 },
                    { text: 'Medium (50–150m²)', value: 10000 },
                    { text: 'Large (150–300m²)', value: 15000 },
                    { text: 'Extra Large (300m²+)', value: 22000 }
                ]}
            ],
            extras: [
                { id: 'overseed', label: 'Overseeding after scarifying', price: 2500 },
                { id: 'topDress', label: 'Top dressing', price: 3500 },
                { id: 'scarFeed', label: 'Post-scarify lawn feed', price: 1500 }
            ]
        },
        'lawn-treatment': {
            options: [
                { id: 'treatLawnSize', label: 'Lawn Size', type: 'select', choices: [
                    { text: 'Small (up to 50m²)', value: 3500 },
                    { text: 'Medium (50–150m²)', value: 5000 },
                    { text: 'Large (150–300m²)', value: 7500 },
                    { text: 'Extra Large (300m²+)', value: 10000 }
                ]},
                { id: 'treatType', label: 'Treatment', type: 'select', choices: [
                    { text: 'Feed & weed (standard)', value: 0 },
                    { text: 'Moss treatment', value: 1000 },
                    { text: 'Feed, weed & moss combo', value: 2000 },
                    { text: 'Disease treatment', value: 2500 }
                ]}
            ],
            extras: [
                { id: 'soilTest', label: 'Soil pH test', price: 1500 },
                { id: 'aeration', label: 'Aeration (spiking)', price: 2500 }
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
        },
        'power-washing': {
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

        // Update wallet button amount if available
        if (paymentRequest) {
            const payingLater = document.querySelector('input[name="paymentChoice"]:checked')?.value !== 'pay-now';
            const chargeAmt = payingLater ? Math.ceil(total * 0.10) : total;
            paymentRequest.update({ total: { label: 'Gardners GM Booking', amount: chargeAmt } });
        }

        // Update display with animation
        const display = `£${(total / 100).toFixed(total % 100 === 0 ? 0 : 2)}`;
        const totalEl = document.getElementById('quoteTotalAmount');
        if (totalEl) {
            totalEl.textContent = display;
            totalEl.classList.remove('quote-total-pulse');
            void totalEl.offsetWidth; // force reflow
            totalEl.classList.add('quote-total-pulse');
        }
        updateDepositAmount();

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

    // --- Payment option toggle ---
    const paymentRadios = document.querySelectorAll('input[name="paymentChoice"]');
    const cardSection = document.getElementById('cardSection');
    const submitBtn = document.getElementById('submitBtn');

    paymentRadios.forEach(radio => {
        radio.addEventListener('change', () => {
            document.querySelectorAll('.payment-option').forEach(opt => opt.classList.remove('selected'));
            radio.closest('.payment-option').classList.add('selected');
            const depositBanner = document.getElementById('depositBanner');
            if (radio.value === 'pay-now') {
                cardSection.style.display = 'block';
                submitBtn.innerHTML = '<i class="fas fa-lock"></i> Book & Pay Now';
                if (depositBanner) depositBanner.style.display = 'none';
                if (paymentRequest) paymentRequest.update({ total: { label: 'Gardners GM Booking', amount: currentQuoteTotal } });
            } else {
                // Pay-later: show card section for 10% deposit
                cardSection.style.display = 'block';
                submitBtn.innerHTML = '<i class="fas fa-lock"></i> Pay Deposit & Book';
                if (depositBanner) depositBanner.style.display = 'flex';
                updateDepositAmount();
                if (paymentRequest) paymentRequest.update({ total: { label: 'Gardners GM Deposit (10%)', amount: Math.ceil(currentQuoteTotal * 0.10) } });
            }
            // Toggle terms variant
            updateTermsVariant();
        });
    });

    // --- Deposit amount display ---
    function updateDepositAmount() {
        const depositBanner = document.getElementById('depositBanner');
        const depositText = document.getElementById('depositText');
        if (!depositBanner || !depositText) return;
        const total = currentQuoteTotal || 0;
        const deposit = Math.ceil(total * 0.10); // 10% rounded up to nearest penny
        const depositDisplay = '£' + (deposit / 100).toFixed(2);
        const remainingDisplay = '£' + ((total - deposit) / 100).toFixed(2);
        depositText.textContent = `10% booking deposit: ${depositDisplay} (remaining ${remainingDisplay} due after service)`;
    }

    // --- Terms variant toggle based on payment choice + subscription upsell ---
    function updateTermsVariant() {
        const payChoice = document.querySelector('input[name="paymentChoice"]:checked')?.value;
        const subUpsell = document.getElementById('subscriptionUpsell');
        const isSubscription = subUpsell && subUpsell.style.display !== 'none' &&
                               subUpsell.querySelector('input[type="radio"]:checked');
        document.querySelectorAll('.terms-variant').forEach(v => v.style.display = 'none');
        const errEl = document.getElementById('termsError');
        if (errEl) errEl.style.display = 'none';
        if (isSubscription) {
            const el = document.getElementById('termsSubscription');
            if (el) el.style.display = 'block';
        } else if (payChoice === 'pay-later') {
            const el = document.getElementById('termsPayLater');
            if (el) el.style.display = 'block';
        } else {
            const el = document.getElementById('termsPayNow');
            if (el) el.style.display = 'block';
        }
    }
    // Initial terms state
    updateTermsVariant();

    function getActiveTermsCheckbox() {
        const visible = document.querySelector('.terms-variant[style*="block"] input[type="checkbox"]');
        return visible || document.getElementById('termsCheckPayNow');
    }

    function getTermsType() {
        const subUpsell = document.getElementById('subscriptionUpsell');
        const isSubscription = subUpsell && subUpsell.style.display !== 'none' &&
                               subUpsell.querySelector('input[type="radio"]:checked');
        if (isSubscription) return 'subscription';
        const payChoice = document.querySelector('input[name="paymentChoice"]:checked')?.value;
        return payChoice === 'pay-later' ? 'pay-later' : 'pay-now';
    }

    // --- Update pay amount when service changes ---
    function updatePayAmount() {
        const val = serviceSelect ? serviceSelect.value : '';
        const banner = document.getElementById('payAmountBanner');
        const text = document.getElementById('payAmountText');
        const priceLabel = document.getElementById('payNowPrice');
        if (val && servicePrices[val]) {
            const sp = servicePrices[val];
            text.textContent = `Pay ${sp.display} now for ${serviceNames[val]}`;
            if (priceLabel) priceLabel.textContent = `Pay ${sp.display} securely`;
            if (banner) banner.style.display = 'flex';
        } else {
            text.textContent = 'Select a service to see the price';
            if (priceLabel) priceLabel.textContent = 'Secure card payment';
            if (banner) banner.style.display = 'flex';
        }
    }

    // --- Service display names ---
    const serviceNames = {
        'lawn-cutting': 'Lawn Cutting',
        'hedge-trimming': 'Hedge Trimming',
        'scarifying': 'Scarifying',
        'lawn-treatment': 'Lawn Treatment',
        'garden-clearance': 'Garden Clearance',
        'power-washing': 'Power Washing',
        'veg-patch': 'Vegetable Patch Preparation',
        'weeding-treatment': 'Weeding Treatment',
        'fence-repair': 'Fence Repair',
        'emergency-tree': 'Emergency Tree Surgery',
        'drain-clearance': 'Drain Clearance',
        'gutter-cleaning': 'Gutter Cleaning'
    };

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

    // --- Double-booking prevention (capacity-aware) ---
    let checkedSlot = { date: '', time: '', service: '', available: null };
    let daySlotData = {};  // cached slot map from backend

    // ── Service capacity rules (mirrors backend — includes travel buffer) ──
    const serviceRules = {
        'garden-clearance': { fullDay: true,  slots: 9, buffer: 0 },
        'power-washing':    { fullDay: true,  slots: 9, buffer: 0 },
        'scarifying':       { fullDay: true,  slots: 9, buffer: 0 },
        'emergency-tree':   { fullDay: true,  slots: 9, buffer: 0 },
        'veg-patch':        { fullDay: true,  slots: 9, buffer: 0 },
        'hedge-trimming':   { fullDay: false, slots: 3, buffer: 1 },
        'fence-repair':     { fullDay: false, slots: 3, buffer: 1 },
        'lawn-treatment':   { fullDay: false, slots: 2, buffer: 1 },
        'weeding-treatment': { fullDay: false, slots: 2, buffer: 1 },
        'drain-clearance':  { fullDay: false, slots: 1, buffer: 1 },
        'gutter-cleaning':  { fullDay: false, slots: 1, buffer: 1 },
        'lawn-cutting':     { fullDay: false, slots: 1, buffer: 1 },
        'free-quote-visit': { fullDay: false, slots: 1, buffer: 1 }
    };

    // ── Service durations in hours (for calendar events) ──
    const serviceDurations = {
        'lawn-cutting': 1, 'hedge-trimming': 3, 'lawn-treatment': 2,
        'scarifying': 8, 'garden-clearance': 8, 'power-washing': 8,
        'veg-patch': 6, 'weeding-treatment': 2, 'fence-repair': 4, 'emergency-tree': 6,
        'drain-clearance': 2,
        'gutter-cleaning': 2,
        'free-quote-visit': 1
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

    // --- Send booking to Telegram with calendar link ---
    async function sendBookingToTelegram(service, date, time, name, email, phone, address, postcode, paid) {
        const calUrl = buildCalendarUrl(service, date, time, name, address, postcode, phone);
        const serviceName = serviceNames[service] || service;

        // Build invoice pre-fill link
        const invoiceParams = new URLSearchParams({
            name: name,
            email: email,
            phone: phone,
            address: address,
            postcode: postcode,
            service: serviceName
        }).toString();
        const invoiceUrl = `https://gardnersgm.co.uk/invoice.html?${invoiceParams}`;

        const priceInfo = servicePrices[service];
        const quoteDisplay = `£${(currentQuoteTotal / 100).toFixed(currentQuoteTotal % 100 === 0 ? 0 : 2)}`;
        const breakdown = getQuoteBreakdown();
        const paymentLine = paid 
            ? `💳 *Payment:* ✅ PAID ${quoteDisplay} via Stripe` 
            : `💳 *Payment:* ⏳ Quote ${quoteDisplay} — invoice needed`;

        const msg = `�🚨 *NEW CUSTOMER BOOKING* 🚨🚨\n` +
            `━━━━━━━━━━━━━━━━━━━━\n\n` +
            `🌿 *Service:* ${serviceName}\n` +
            `💰 *Quote:* ${quoteDisplay}\n` +
            (breakdown ? `📋 *Details:* ${breakdown}\n` : '') +
            `📆 *Date:* ${date}\n` +
            `🕐 *Time:* ${time}\n\n` +
            `👤 *Customer:* ${name}\n` +
            `📧 *Email:* ${email}\n` +
            `📞 *Phone:* ${phone}\n` +
            `📍 *Address:* ${address}, ${postcode}\n` +
            `🗺 [Get Directions](https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address + ', ' + postcode)})\n\n` +
            `${paymentLine}\n` +
            `🔖 *Job #:* _Auto-assigned in system_\n\n` +
            (calUrl ? `[📲 Add to Google Calendar](${calUrl})\n\n` : '') +
            (!paid ? `[📝 Create Invoice](${invoiceUrl})\n\n` : '') +
            `⚡ _ACTION: Check calendar & confirm_ ⚡`;

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
                const fileName = `booking-${name.replace(/\s+/g, '-').toLowerCase()}.ics`;
                await fetch(SHEETS_WEBHOOK, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        action: 'relay_telegram_document',
                        fileContent: b64,
                        mimeType: 'text/calendar',
                        fileName: fileName,
                        caption: '📎 Tap to add this booking to your calendar'
                    })
                });
            }
        } catch (e) {
            console.error('Telegram booking notification failed:', e);
        }
    }

    // --- Send booking to Google Sheets ---
    async function sendBookingToSheets(service, date, time, name, email, phone, address, postcode) {
        if (!SHEETS_WEBHOOK) return;
        const serviceName = serviceNames[service] || service;

        // Get distance if available (use cached customerDistance if already calculated)
        let distance = customerDistance || '', driveTime = '', mapsUrl = '';
        let travelSurcharge = 0;
        if (typeof DistanceUtil !== 'undefined' && postcode) {
            try {
                const d = await DistanceUtil.distanceFromBase(postcode);
                if (d) {
                    distance = d.drivingMiles;
                    driveTime = d.driveMinutes;
                    mapsUrl = d.googleMapsUrl;
                    // Recalculate surcharge to ensure it matches what was quoted
                    if (d.drivingMiles > 15) {
                        travelSurcharge = Math.round((d.drivingMiles - 15) * 50); // pence
                    }
                }
            } catch (e) { console.warn('[Distance] Final calc failed, using cached:', e); }
        }

        try {
            const saveResp = await fetch(SHEETS_WEBHOOK, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain' },
                body: JSON.stringify({
                    type: 'booking',
                    timestamp: new Date().toISOString(),
                    name, email, phone, address, postcode,
                    service: serviceName,
                    date, time,
                    preferredDay: '',
                    price: `£${(currentQuoteTotal / 100).toFixed(currentQuoteTotal % 100 === 0 ? 0 : 2)}`,
                    distance, driveTime,
                    googleMapsUrl: mapsUrl,
                    travelSurcharge: travelSurcharge > 0 ? `£${(travelSurcharge / 100).toFixed(2)}` : '',
                    notes: document.getElementById('notes') ? document.getElementById('notes').value : '',
                    termsAccepted: true,
                    termsType: getTermsType(),
                    termsTimestamp: new Date().toISOString()
                })
            });
            const saveResult = await saveResp.json();
            if (saveResult.slotConflict) {
                console.warn('Slot conflict at save time:', saveResult.message);
                // The booking was already shown as successful to user via Web3Forms,
                // but the sheet save was blocked — notify via Telegram
            }
        } catch (e) {
            console.error('Sheets webhook failed:', e);
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
        const step4 = document.getElementById('paymentSection');
        const submitSec = document.getElementById('bookingSubmitSection');
        const priceHint = document.getElementById('priceHint');

        if (isBespoke) {
            if (bespokeForm) bespokeForm.style.display = 'block';
            if (quoteBuilder) quoteBuilder.style.display = 'none';
            if (step2) step2.style.display = 'none';
            if (step3) step3.style.display = 'none';
            if (step4) step4.style.display = 'none';
            if (submitSec) submitSec.style.display = 'none';
            if (priceHint) priceHint.textContent = '';
        } else {
            if (bespokeForm) bespokeForm.style.display = 'none';
            if (step2) step2.style.display = '';
            if (step3) step3.style.display = '';
            if (step4) step4.style.display = '';
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

    if (dateInput && typeof flatpickr !== 'undefined') {
        fpInstance = flatpickr(dateInput, {
            minDate: 'today',
            maxDate: new Date().fp_incr(60), // 60 days ahead
            dateFormat: 'l, j F Y',          // e.g. "Monday, 14 March 2026"
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

        // Load busy dates from Sheets
        loadBusyDates();

    } else if (dateInput) {
        // Fallback: native HTML date picker if flatpickr didn't load
        console.warn('[Calendar] Flatpickr not available — using native date picker');
        dateInput.removeAttribute('readonly');
        dateInput.type = 'date';
        const today = new Date();
        dateInput.min = toISO(today);
        const maxD = new Date(today.getTime() + 60 * 24 * 60 * 60 * 1000);
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
            const termsType = getTermsType();
            const termsAccepted = true;

            // --- Double-booking check (always re-check at submit time) ---
            {
                const result = await checkAvailability(date, time, service);
                checkedSlot = { date, time, service, available: result.available };
            }
            if (!checkedSlot.available) {
                const indicator = document.getElementById('availabilityIndicator');
                if (indicator) {
                    indicator.className = 'availability-indicator unavailable';
                    indicator.innerHTML = '<i class="fas fa-times-circle"></i> This slot is already booked — please choose another date or time';
                    indicator.style.display = 'flex';
                    indicator.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
                return;
            }

            // Submit button state
            const submitBtn = document.getElementById('submitBtn');
            const originalText = submitBtn.innerHTML;
            submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...';
            submitBtn.disabled = true;

            // --- Pre-calculate distance before payment ---
            let preDistance = '', preDriveTime = '', preMapsUrl = '';
            if (typeof DistanceUtil !== 'undefined' && postcode) {
                try {
                    const distResult = await DistanceUtil.distanceFromBase(postcode);
                    if (distResult) {
                        preDistance = distResult.drivingMiles;
                        preDriveTime = distResult.driveMinutes;
                        preMapsUrl = distResult.googleMapsUrl;
                    }
                } catch (distErr) { console.warn('Distance calc failed:', distErr); }
            }

            // --- Check payment choice ---
            const payingNow = document.querySelector('input[name="paymentChoice"]:checked')?.value === 'pay-now';
            const payingLater = !payingNow;
            let paymentMethodId = null;

            if (payingNow || payingLater) {
                // Check if wallet payment already provided (Apple Pay / Google Pay)
                if (walletPaymentMethodId) {
                    paymentMethodId = walletPaymentMethodId;
                    walletPaymentMethodId = null; // consume it
                } else {
                    // Guard: if Stripe failed to init, show error
                    if (!stripe || !cardElement) {
                        const errEl = document.getElementById('cardErrors');
                        if (errEl) errEl.textContent = 'Payment system unavailable. Please choose "Pay Later" or refresh the page.';
                        submitBtn.innerHTML = originalText;
                        submitBtn.disabled = false;
                        return;
                    }
                    // Create Stripe PaymentMethod from card
                    try {
                        const { paymentMethod, error } = await stripe.createPaymentMethod({
                            type: 'card',
                            card: cardElement,
                            billing_details: {
                                name: name,
                                email: email,
                                phone: phone,
                                address: { postal_code: postcode, country: 'GB' }
                            }
                        });
                    if (error) {
                        const errEl = document.getElementById('cardErrors');
                        if (errEl) errEl.textContent = error.message;
                        submitBtn.innerHTML = originalText;
                        submitBtn.disabled = false;
                        return;
                    }
                    paymentMethodId = paymentMethod.id;
                } catch (e) {
                    console.error('Stripe card error:', e);
                    const errEl = document.getElementById('cardErrors');
                    if (errEl) errEl.textContent = 'Card processing failed. Please try again.';
                    submitBtn.innerHTML = originalText;
                    submitBtn.disabled = false;
                    return;
                }
                } // end else (card payment — not wallet)

                submitBtn.innerHTML = payingLater 
                    ? '<i class="fas fa-spinner fa-spin"></i> Processing deposit...'
                    : '<i class="fas fa-spinner fa-spin"></i> Processing payment...';

                // Send payment to Apps Script and verify it succeeded
                const serviceName = serviceNames[service] || service;
                const quoteTotal = currentQuoteTotal;
                const depositAmount = payingLater ? Math.ceil(quoteTotal * 0.10) : 0;
                const chargeAmount = payingLater ? depositAmount : quoteTotal;
                const quoteDisplay = `£${(quoteTotal / 100).toFixed(quoteTotal % 100 === 0 ? 0 : 2)}`;

                // Calculate travel surcharge for the payload
                let payloadTravelSurcharge = '';
                if (customerDistance > 15) {
                    const surchargeAmount = Math.round((customerDistance - 15) * 50);
                    payloadTravelSurcharge = `£${(surchargeAmount / 100).toFixed(2)}`;
                }

                let paymentSuccess = false;
                try {
                    const payResp = await fetch(SHEETS_WEBHOOK, {
                        method: 'POST',
                        headers: { 'Content-Type': 'text/plain' },
                        body: JSON.stringify({
                            action: payingLater ? 'booking_deposit' : 'booking_payment',
                            paymentMethodId: paymentMethodId,
                            amount: chargeAmount,
                            totalAmount: quoteTotal,
                            depositAmount: depositAmount,
                            isDeposit: payingLater,
                            serviceName: serviceName,
                            quoteBreakdown: getQuoteBreakdown(),
                            customer: { name, email, phone, address, postcode },
                            date: date,
                            time: time,
                            distance: preDistance,
                            driveTime: preDriveTime,
                            googleMapsUrl: preMapsUrl,
                            travelSurcharge: payloadTravelSurcharge,
                            notes: document.getElementById('notes') ? document.getElementById('notes').value : '',
                            termsAccepted: true,
                            termsType: termsType,
                            termsTimestamp: new Date().toISOString()
                        })
                    });
                    const payResult = await payResp.json();

                    if (payResult.status === 'requires_action' && payResult.clientSecret) {
                        // 3D Secure authentication required
                        submitBtn.innerHTML = '<i class="fas fa-shield-alt fa-spin"></i> Authenticating...';
                        const { error: confirmError, paymentIntent } = await stripe.confirmCardPayment(payResult.clientSecret);
                        if (confirmError) {
                            throw new Error(confirmError.message);
                        }
                        if (paymentIntent.status === 'succeeded') {
                            paymentSuccess = true;
                        } else {
                            throw new Error('Payment not completed. Status: ' + paymentIntent.status);
                        }
                    } else if (payResult.status === 'success' && (payResult.paymentStatus === 'succeeded' || payResult.paymentStatus === 'requires_capture')) {
                        paymentSuccess = true;
                    } else if (payResult.status === 'error') {
                        throw new Error(payResult.message || 'Payment was declined');
                    } else {
                        throw new Error('Unexpected payment status: ' + (payResult.paymentStatus || payResult.status));
                    }
                } catch (e) {
                    console.error('Payment request failed:', e);
                    const errEl = document.getElementById('cardErrors');
                    if (errEl) errEl.textContent = 'Payment failed: ' + (e.message || 'Please try again or choose Pay Later.');
                    submitBtn.innerHTML = originalText;
                    submitBtn.disabled = false;
                    return;
                }
            }

            // Send Telegram notifications (booking data already saved by handleBookingPayment)
            sendBookingToTelegram(service, date, time, name, email, phone, address, postcode, payingNow);
            sendPhotosToTelegram(name);
            // NOTE: Do NOT call sendBookingToSheets here — handleBookingPayment already
            // saved the booking row, confirmation email, calendar event, etc.
            // Calling it again would create a duplicate job.

            // Update success message based on payment
            const successMsg = document.getElementById('successMsg');
            if (successMsg) {
                if (payingNow) {
                    const qd = `£${(currentQuoteTotal / 100).toFixed(currentQuoteTotal % 100 === 0 ? 0 : 2)}`;
                    successMsg.textContent = `Thank you! Your booking is confirmed and your payment of ${qd} has been processed. We'll send a confirmation email shortly.`;
                } else {
                    const dep = `£${(depositAmount / 100).toFixed(2)}`;
                    const rem = `£${((currentQuoteTotal - depositAmount) / 100).toFixed(2)}`;
                    successMsg.textContent = `Thank you! Your ${dep} deposit has been taken and your booking is confirmed. The remaining ${rem} will be invoiced after the service is completed.`;
                }
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
