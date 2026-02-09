/* ============================================
   Gardners Ground Maintenance — Booking JS
   Handles: Flatpickr calendar, time slots,
   form validation, Web3Forms submission,
   Telegram diary notifications
   ============================================ */

document.addEventListener('DOMContentLoaded', () => {

    // --- Telegram Config ---
    const TG_BOT_TOKEN = '8261874993:AAHW6752Ofhsrw6qzOSSZWnfmzbBj7G8Z-g';
    const TG_CHAT_ID = '6200151295';
    const SHEETS_WEBHOOK = 'https://script.google.com/macros/s/AKfycbwH3y3aPED--wm8N8lUXgUsLKad8w6NoXNEgslzHrzYRnN50rs13MVey84G7xvlT8A6/exec';
    const STRIPE_PK = 'pk_live_51RZrhDCI9zZxpqlvcul8rw23LHMQAKCpBRCjg94178nwq22d1y2aJMz92SEvKZlkOeSWLJtK6MGPJcPNSeNnnqvt00EAX9Wgqt';

    // --- Stripe setup ---
    const stripe = Stripe(STRIPE_PK);
    const elements = stripe.elements();
    const cardElement = elements.create('card', {
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

    // --- Service prices (starting prices in pence) ---
    const servicePrices = {
        'lawn-cutting':     { amount: 3000, display: '£30' },
        'hedge-trimming':   { amount: 6000, display: '£60' },
        'scarifying':       { amount: 8000, display: '£80' },
        'lawn-treatment':   { amount: 4500, display: '£45' },
        'garden-clearance': { amount: 10000, display: '£100' },
        'power-washing':    { amount: 6000, display: '£60' }
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
                    const recMin = Math.round((svc.recommendedMin || svc.currentMin || 0) * 100);
                    if (recMin > 0) {
                        dynamicMinimums[key] = recMin;
                        if (servicePrices[key] && recMin > servicePrices[key].amount) {
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
                { id: 'clippings', label: 'Clippings collected & removed', price: 0, checked: true },
                { id: 'stripes', label: 'Striped finish', price: 500 }
            ]
        },
        'hedge-trimming': {
            options: [
                { id: 'hedgeCount', label: 'Number of Hedges', type: 'select', choices: [
                    { text: '1 hedge', value: 0 },
                    { text: '2 hedges', value: 3000 },
                    { text: '3 hedges', value: 5500 },
                    { text: '4+ hedges', value: 8000 }
                ]},
                { id: 'hedgeSize', label: 'Hedge Size', type: 'select', choices: [
                    { text: 'Small (under 2m tall, under 5m long)', value: 6000 },
                    { text: 'Medium (2–3m tall, 5–15m long)', value: 12000 },
                    { text: 'Large (3m+ tall or 15m+ long)', value: 20000 }
                ]}
            ],
            extras: [
                { id: 'waste', label: 'Waste removal included', price: 0, checked: true },
                { id: 'shaping', label: 'Decorative shaping', price: 2000 },
                { id: 'reduction', label: 'Height reduction (heavy cut back)', price: 4000 }
            ]
        },
        'scarifying': {
            options: [
                { id: 'scarLawnSize', label: 'Lawn Size', type: 'select', choices: [
                    { text: 'Small (up to 50m²)', value: 8000 },
                    { text: 'Medium (50–150m²)', value: 12000 },
                    { text: 'Large (150–300m²)', value: 18000 },
                    { text: 'Extra Large (300m²+)', value: 25000 }
                ]}
            ],
            extras: [
                { id: 'overseed', label: 'Overseeding after scarifying', price: 3000 },
                { id: 'topDress', label: 'Top dressing', price: 4000 },
                { id: 'scarFeed', label: 'Post-scarify lawn feed', price: 1500 }
            ]
        },
        'lawn-treatment': {
            options: [
                { id: 'treatLawnSize', label: 'Lawn Size', type: 'select', choices: [
                    { text: 'Small (up to 50m²)', value: 4500 },
                    { text: 'Medium (50–150m²)', value: 6500 },
                    { text: 'Large (150–300m²)', value: 9000 },
                    { text: 'Extra Large (300m²+)', value: 12000 }
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
                { id: 'aeration', label: 'Aeration (spiking)', price: 3000 }
            ]
        },
        'garden-clearance': {
            options: [
                { id: 'clearLevel', label: 'Clearance Level', type: 'select', choices: [
                    { text: 'Light (tidy up, minor overgrowth)', value: 10000 },
                    { text: 'Medium (overgrown beds, some waste)', value: 18000 },
                    { text: 'Heavy (fully overgrown / neglected)', value: 30000 },
                    { text: 'Full property clearance', value: 45000 }
                ]}
            ],
            extras: [
                { id: 'skipHire', label: 'Skip hire (we arrange it)', price: 25000 },
                { id: 'rubbishRemoval', label: 'Rubbish removal (van load)', price: 8000 },
                { id: 'strimming', label: 'Strimming & brush cutting', price: 3000 }
            ]
        },
        'power-washing': {
            options: [
                { id: 'pwSurface', label: 'Surface Type', type: 'select', choices: [
                    { text: 'Patio', value: 6000 },
                    { text: 'Driveway', value: 8000 },
                    { text: 'Decking', value: 7000 },
                    { text: 'Paths / steps', value: 5000 },
                    { text: 'Walls / fencing', value: 7000 }
                ]},
                { id: 'pwArea', label: 'Area Size', type: 'select', choices: [
                    { text: 'Small (up to 15m²)', value: 0 },
                    { text: 'Medium (15–40m²)', value: 3000 },
                    { text: 'Large (40–80m²)', value: 6000 },
                    { text: 'Extra Large (80m²+)', value: 10000 }
                ]}
            ],
            extras: [
                { id: 'pwSealant', label: 'Sealant / re-sand after washing', price: 4000 },
                { id: 'pwSecondSurface', label: 'Additional surface (+50%)', price: 0, multiplier: 0.5 }
            ]
        }
    };

    // Current quote total in pence
    let currentQuoteTotal = 4000; // £40 minimum default

    function renderQuoteBuilder(service) {
        const builder = document.getElementById('quoteBuilder');
        const optionsContainer = document.getElementById('quoteOptions');
        const extrasContainer = document.getElementById('quoteExtras');

        if (!service || !quoteConfig[service]) {
            builder.style.display = 'none';
            currentQuoteTotal = 4000;
            updatePayAmount();
            return;
        }

        const config = quoteConfig[service];
        optionsContainer.innerHTML = '';
        extrasContainer.innerHTML = '';

        // Render select options
        config.options.forEach(opt => {
            const group = document.createElement('div');
            group.className = 'quote-option-group';
            group.innerHTML = `
                <label class="quote-option-label">${opt.label}</label>
                <select class="quote-select" data-quote-option="${opt.id}">
                    ${opt.choices.map((c, i) => `<option value="${c.value}" ${i === 0 ? 'selected' : ''}>${c.text}</option>`).join('')}
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

        builder.style.display = 'block';
        recalcQuote();
    }

    // Track customer distance for pricing
    let customerDistance = 0; // miles one-way

    function recalcQuote() {
        let total = 0;
        // Sum all select option values
        document.querySelectorAll('.quote-select').forEach(sel => {
            total += parseInt(sel.value) || 0;
        });

        // Add checked extras
        let extraFlat = 0;
        let multiplier = 0;
        document.querySelectorAll('[data-quote-extra]').forEach(cb => {
            if (cb.checked) {
                const mult = cb.getAttribute('data-multiplier');
                if (mult) {
                    multiplier += parseFloat(mult);
                } else {
                    extraFlat += parseInt(cb.getAttribute('data-price')) || 0;
                }
            }
        });

        total += extraFlat;
        if (multiplier > 0) total += Math.round(total * multiplier);

        // Distance-based travel surcharge for far-flung Cornwall jobs
        const svc = serviceSelect ? serviceSelect.value : '';
        if (customerDistance > 20) {
            // £1 per extra mile over 20 (Cornwall is big!) — in pence
            const surcharge = Math.round((customerDistance - 20) * 100);
            total += surcharge;
        }

        // Enforce dynamic minimum (from Pricing Config) or fallback £40
        const minPrice = dynamicMinimums[svc] || 4000;
        if (total < minPrice) total = minPrice;

        currentQuoteTotal = total;

        // Update display
        const display = `£${(total / 100).toFixed(total % 100 === 0 ? 0 : 2)}`;
        document.getElementById('quoteTotalAmount').textContent = display;

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
            if (radio.value === 'pay-now') {
                cardSection.style.display = 'block';
                submitBtn.innerHTML = '<i class="fas fa-lock"></i> Book & Pay Now';
            } else {
                cardSection.style.display = 'none';
                submitBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Submit Booking Request';
            }
        });
    });

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
        'power-washing': 'Power Washing'
    };

    // --- Double-booking prevention (capacity-aware) ---
    let checkedSlot = { date: '', time: '', service: '', available: null };
    let daySlotData = {};  // cached slot map from backend

    // ── Service capacity rules (mirrors backend — includes travel buffer) ──
    const serviceRules = {
        'garden-clearance': { fullDay: true,  slots: 9, buffer: 0 },
        'power-washing':    { fullDay: true,  slots: 9, buffer: 0 },
        'scarifying':       { fullDay: true,  slots: 9, buffer: 0 },
        'hedge-trimming':   { fullDay: false, slots: 3, buffer: 1 },
        'lawn-treatment':   { fullDay: false, slots: 2, buffer: 1 },
        'lawn-cutting':     { fullDay: false, slots: 1, buffer: 1 }
    };

    // ── Service durations in hours (for calendar events) ──
    const serviceDurations = {
        'lawn-cutting': 1, 'hedge-trimming': 3, 'lawn-treatment': 2,
        'scarifying': 8, 'garden-clearance': 8, 'power-washing': 8
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
        const date = dateInput ? dateInput.value.trim() : '';
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

        if (!time) {
            if (result.fullDayBooked) {
                indicator.className = 'availability-indicator unavailable';
                indicator.innerHTML = '<i class="fas fa-times-circle"></i> This date is fully booked (full-day job)';
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
            `📍 *Address:* ${address}, ${postcode}\n\n` +
            `${paymentLine}\n` +
            `🔖 *Job #:* _Auto-assigned in system_\n\n` +
            (calUrl ? `[📲 Add to Google Calendar](${calUrl})\n\n` : '') +
            (!paid ? `[📝 Create Invoice](${invoiceUrl})\n\n` : '') +
            `⚡ _ACTION: Check calendar & confirm_ ⚡`;

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

            // Also send .ics file as a document for Apple Calendar
            const icsContent = buildIcsContent(service, date, time, name, address, postcode, phone);
            if (icsContent) {
                const blob = new Blob([icsContent], { type: 'text/calendar' });
                const formData = new FormData();
                formData.append('chat_id', TG_CHAT_ID);
                formData.append('document', blob, `booking-${name.replace(/\s+/g, '-').toLowerCase()}.ics`);
                formData.append('caption', '📎 Tap to add this booking to your calendar');

                await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendDocument`, {
                    method: 'POST',
                    body: formData
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

        // Get distance if available
        let distance = '', driveTime = '', mapsUrl = '';
        if (typeof DistanceUtil !== 'undefined' && postcode) {
            try {
                const d = await DistanceUtil.distanceFromBase(postcode);
                if (d) {
                    distance = d.drivingMiles;
                    driveTime = d.driveMinutes;
                    mapsUrl = d.googleMapsUrl;
                }
            } catch (e) {}
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
                    notes: document.getElementById('notes') ? document.getElementById('notes').value : ''
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
    }
    if (serviceSelect) {
        serviceSelect.addEventListener('change', () => {
            renderQuoteBuilder(serviceSelect.value);
            updatePayAmount();
            // Re-check slot availability for new service type
            timeSlots.forEach(s => s.classList.remove('selected'));
            if (timeInput) timeInput.value = '';
            updateAvailabilityIndicator();
        });
        updatePayAmount();
    }

    // --- Flatpickr Date Picker ---
    const dateInput = document.getElementById('date');
    if (dateInput && typeof flatpickr !== 'undefined') {
        flatpickr(dateInput, {
            minDate: 'today',
            maxDate: new Date().fp_incr(60), // 60 days ahead
            dateFormat: 'l, j F Y',          // e.g. "Monday, 14 March 2026"
            disable: [
                function(date) {
                    return date.getDay() === 0; // Disable Sundays
                }
            ],
            locale: {
                firstDayOfWeek: 1 // Monday
            },
            animate: true,
            onChange: function(selectedDates, dateStr) {
                dateInput.classList.remove('error');
                // Clear selected time slot and refresh availability
                timeSlots.forEach(s => s.classList.remove('selected'));
                if (timeInput) timeInput.value = '';
                updateAvailabilityIndicator();
            }
        });
    }

    // --- Time Slot Selection ---
    const timeSlots = document.querySelectorAll('.time-slot');
    const timeInput = document.getElementById('time');

    timeSlots.forEach(slot => {
        slot.addEventListener('click', () => {
            // Block click on unavailable slots
            if (slot.classList.contains('slot-unavailable')) return;
            timeSlots.forEach(s => s.classList.remove('selected'));
            slot.classList.add('selected');
            if (timeInput) {
                timeInput.value = slot.getAttribute('data-time');
            }
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
            const date = dateInput ? dateInput.value.trim() : '';
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

            // --- Check payment choice ---
            const payingNow = document.querySelector('input[name="paymentChoice"]:checked')?.value === 'pay-now';
            let paymentMethodId = null;

            if (payingNow) {
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

                submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing payment...';

                // Send payment to Apps Script and verify it succeeded
                const serviceName = serviceNames[service] || service;
                const quoteTotal = currentQuoteTotal;
                const quoteDisplay = `£${(quoteTotal / 100).toFixed(quoteTotal % 100 === 0 ? 0 : 2)}`;
                let paymentSuccess = false;
                try {
                    const payResp = await fetch(SHEETS_WEBHOOK, {
                        method: 'POST',
                        headers: { 'Content-Type': 'text/plain' },
                        body: JSON.stringify({
                            action: 'booking_payment',
                            paymentMethodId: paymentMethodId,
                            amount: quoteTotal,
                            serviceName: serviceName,
                            quoteBreakdown: getQuoteBreakdown(),
                            customer: { name, email, phone, address, postcode },
                            date: date,
                            time: time,
                            notes: document.getElementById('notes') ? document.getElementById('notes').value : ''
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

            try {
                const formData = new FormData(bookingForm);
                formData.append('Preferred Time', time);

                const response = await fetch('https://api.web3forms.com/submit', {
                    method: 'POST',
                    body: formData
                });

                const result = await response.json();

                if (result.success) {
                    // Send to Telegram + diary
                    sendBookingToTelegram(service, date, time, name, email, phone, address, postcode, payingNow);
                    sendPhotosToTelegram(name);
                    sendBookingToSheets(service, date, time, name, email, phone, address, postcode);

                    // Update success message based on payment
                    const successMsg = document.getElementById('successMsg');
                    if (successMsg) {
                        if (payingNow) {
                            const qd = `£${(currentQuoteTotal / 100).toFixed(currentQuoteTotal % 100 === 0 ? 0 : 2)}`;
                            successMsg.textContent = `Thank you! Your booking is confirmed and your payment of ${qd} has been processed. We'll send a confirmation email within 24 hours.`;
                        } else {
                            successMsg.textContent = 'Thank you for your booking request. We\'ll review the details and send you an invoice. Confirmation within 24 hours.';
                        }
                    }

                    bookingForm.style.display = 'none';
                    bookingSuccess.style.display = 'block';
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                } else {
                    // Fallback for demo — still notify
                    sendBookingToTelegram(service, date, time, name, email, phone, address, postcode, payingNow);
                    sendPhotosToTelegram(name);
                    sendBookingToSheets(service, date, time, name, email, phone, address, postcode);

                    bookingForm.style.display = 'none';
                    bookingSuccess.style.display = 'block';
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                }
            } catch (error) {
                // Fallback for demo — still notify
                sendBookingToTelegram(service, date, time, name, email, phone, address, postcode, payingNow);
                sendPhotosToTelegram(name);
                sendBookingToSheets(service, date, time, name, email, phone, address, postcode);

                bookingForm.style.display = 'none';
                bookingSuccess.style.display = 'block';
                window.scrollTo({ top: 0, behavior: 'smooth' });
            }

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
                const formData = new FormData();
                formData.append('chat_id', TG_CHAT_ID);
                formData.append('photo', selectedPhotos[i]);
                formData.append('caption', i === 0
                    ? `📸 Photos from ${customerName}'s booking (${i + 1}/${selectedPhotos.length})`
                    : `📸 Photo ${i + 1}/${selectedPhotos.length}`);
                await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendPhoto`, {
                    method: 'POST',
                    body: formData
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
                onSelect: () => {} // distance already auto-checks on postcode blur
            });
        }
        // Auto-calculate distance when postcode is entered — feeds into dynamic pricing
        if (bookPC && typeof DistanceUtil !== 'undefined') {
            bookPC.addEventListener('blur', async () => {
                const pc = bookPC.value.trim();
                if (pc.length >= 5) {
                    try {
                        const d = await DistanceUtil.distanceFromBase(pc);
                        if (d && d.drivingMiles) {
                            customerDistance = d.drivingMiles;
                            recalcQuote(); // retrigger with distance factored in
                        }
                    } catch(e) {}
                }
            });
        }
    }
});
