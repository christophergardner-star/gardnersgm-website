/* ============================================
   Gardners Ground Maintenance — Subscribe JS
   Package signup, visit scheduling,
   Telegram + Web3Forms + Google Sheets
   ============================================ */

document.addEventListener('DOMContentLoaded', () => {

    // --- Config ---
    const TG_BOT_TOKEN = '8261874993:AAHW6752Ofhsrw6qzOSSZWnfmzbBj7G8Z-g';
    const TG_CHAT_ID = '6200151295';
    const WEB3FORMS_KEY = '8f5c40a2-7cfb-4dba-b287-7e4cea717313';
    const SHEETS_WEBHOOK = 'https://script.google.com/macros/s/AKfycbwEOP-SnZ8DQ9JDOxK9RDcGAHmeikY-snRrOk1ykqJzdxGvGq9qgfaLixTsSG4WWMIDNA/exec';
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
    // Mount after DOM ready
    setTimeout(() => {
        const cardMount = document.getElementById('cardElement');
        if (cardMount) cardElement.mount('#cardElement');
    }, 100);

    cardElement.on('change', (ev) => {
        const errEl = document.getElementById('cardErrors');
        if (errEl) errEl.textContent = ev.error ? ev.error.message : '';
    });

    // --- Package info (prices ex-VAT, VAT added at checkout) ---
    const packages = {
        'lawn-care-weekly': {
            name: 'Lawn Care (Weekly)',
            price: '£30/visit',
            priceExVat: 30,
            billing: 'per-visit',
            frequency: 'weekly',
            intervalWeeks: 1,
            winterIntervalWeeks: 2,
            description: 'Weekly lawn mowing, edging & strimming'
        },
        'lawn-care-fortnightly': {
            name: 'Lawn Care (Fortnightly)',
            price: '£35/visit',
            priceExVat: 35,
            billing: 'per-visit',
            frequency: 'fortnightly',
            intervalWeeks: 2,
            winterIntervalWeeks: 4,
            description: 'Fortnightly lawn mowing, edging & strimming'
        },
        'garden-maintenance': {
            name: 'Garden Maintenance',
            price: '£140/month',
            priceExVat: 140,
            billing: 'monthly',
            frequency: 'weekly',
            intervalWeeks: 1,
            winterIntervalWeeks: 2,
            description: 'Complete garden care — lawn, hedges, treatments & more'
        },
        'property-care': {
            name: 'Property Care',
            price: '£55/month',
            priceExVat: 55,
            billing: 'monthly',
            frequency: 'quarterly',
            intervalWeeks: 13,
            winterIntervalWeeks: 13,
            description: 'Gutters, power washing, drains & exterior maintenance'
        },
        custom: {
            name: 'Custom',
            price: '£0/month',
            priceExVat: 0,
            billing: 'monthly',
            frequency: 'mixed',
            intervalWeeks: 1,
            winterIntervalWeeks: 2,
            description: 'Build Your Own Package',
            services: []
        }
    };

    let selectedPackage = null;
    let scheduledVisits = [];

    // --- DOM Elements ---
    const packageCards = document.getElementById('packageCards');
    const formWrapper = document.getElementById('subscribeFormWrapper');
    const form = document.getElementById('subscribeForm');
    const successDiv = document.getElementById('subscribeSuccess');
    const selectedBanner = document.getElementById('selectedBanner');
    const selectedPackageName = document.getElementById('selectedPackageName');
    const selectedPackagePrice = document.getElementById('selectedPackagePrice');
    const changeBtn = document.getElementById('changePackageBtn');
    const packageInput = document.getElementById('packageType');
    const billingTerms = document.getElementById('billingTerms');
    const schedulePreview = document.getElementById('schedulePreview');
    const visitDatesList = document.getElementById('visitDates');
    const distanceInfo = document.getElementById('distanceInfo');
    const distanceText = document.getElementById('distanceText');

    // --- Pre-select from URL ---
    const urlParams = new URLSearchParams(window.location.search);
    const preselected = urlParams.get('package');

    // --- Package selection ---
    document.querySelectorAll('.select-package-btn').forEach(btn => {
        btn.addEventListener('click', () => selectPackage(btn.dataset.package));
    });

    function selectPackage(pkg) {
        if (!packages[pkg]) return;
        selectedPackage = pkg;
        const info = packages[pkg];

        // Hide BYO section along with package cards
        const byoSection = document.querySelector('.byo-section');
        if (byoSection) byoSection.style.display = 'none';

        // Update UI
        packageCards.style.display = 'none';
        formWrapper.style.display = 'block';

        if (pkg === 'custom') {
            // Build custom description from selected services
            const details = getByoSelectedServices();
            const monthlyFinal = getByoMonthlyFinal(); // inc VAT
            const monthlyExVat = monthlyFinal / (1 + 0.20);
            selectedPackageName.textContent = 'Custom Package';
            selectedPackagePrice.textContent = `£${monthlyFinal.toFixed(2)}/month inc. VAT`;
            packageInput.value = 'custom';
            billingTerms.textContent = `Billed monthly (£${monthlyExVat.toFixed(2)} + £${(monthlyFinal - monthlyExVat).toFixed(2)} VAT = £${monthlyFinal.toFixed(2)}/month)`;
            const chargeText = document.getElementById('chargeAmountText');
            if (chargeText) chargeText.textContent = `£${monthlyFinal.toFixed(2)}/month automatically (inc. VAT)`;
            // Store services into package for submission
            packages.custom.price = `£${monthlyFinal.toFixed(2)}/month`;
            packages.custom.services = details;
        } else {
            selectedPackageName.textContent = info.name + ' Plan';
            selectedPackagePrice.textContent = info.price;
            packageInput.value = pkg;

            if (info.billing === 'monthly') {
                billingTerms.textContent = `Billed monthly (${info.price} — no VAT, sole trader)`;
            } else {
                billingTerms.textContent = `Charged per visit (${info.price} — no VAT, sole trader)`;
            }

            const chargeText = document.getElementById('chargeAmountText');
            if (chargeText) {
                chargeText.textContent = info.billing === 'monthly'
                    ? `${info.price} automatically`
                    : `${info.price} after each visit`;
            }
        }

        formWrapper.scrollIntoView({ behavior: 'smooth', block: 'start' });
        updateSchedulePreview();
    }

    // Change package
    changeBtn.addEventListener('click', () => {
        packageCards.style.display = '';
        formWrapper.style.display = 'none';
        selectedPackage = null;
        schedulePreview.style.display = 'none';
        // Re-show BYO section
        const byoSection = document.querySelector('.byo-section');
        if (byoSection) byoSection.style.display = '';
    });

    // Auto-select from URL
    if (preselected && packages[preselected]) {
        setTimeout(() => selectPackage(preselected), 300);
    }

    // --- Flatpickr for start date ---
    const startDateInput = document.getElementById('startDate');
    if (startDateInput && typeof flatpickr !== 'undefined') {
        flatpickr(startDateInput, {
            minDate: 'today',
            maxDate: new Date().fp_incr(90),
            dateFormat: 'l, j F Y',
            disable: [date => date.getDay() === 0], // No Sundays
            locale: { firstDayOfWeek: 1 },
            animate: true,
            onChange: () => updateSchedulePreview()
        });
    }

    // --- Preferred day change ---
    const preferredDay = document.getElementById('preferredDay');
    preferredDay.addEventListener('change', updateSchedulePreview);

    // --- Generate next 4 visit dates ---
    function updateSchedulePreview() {
        const day = preferredDay.value;
        const startStr = startDateInput.value;
        if (!day || !startStr || !selectedPackage) {
            schedulePreview.style.display = 'none';
            return;
        }

        const pkg = packages[selectedPackage];
        const startDate = parseDateStr(startStr);
        if (!startDate) return;

        // Find first occurrence of preferred day on or after start date
        const dayIndex = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'].indexOf(day);
        let firstVisit = new Date(startDate);
        while (firstVisit.getDay() !== dayIndex) {
            firstVisit.setDate(firstVisit.getDate() + 1);
        }

        // Generate 4 visits
        scheduledVisits = [];
        let current = new Date(firstVisit);
        for (let i = 0; i < 4; i++) {
            scheduledVisits.push(new Date(current));
            // Check if winter (Nov-Feb)
            const month = current.getMonth();
            const isWinter = (month >= 10 || month <= 1);
            const interval = isWinter ? pkg.winterIntervalWeeks : pkg.intervalWeeks;
            current.setDate(current.getDate() + interval * 7);
        }

        // Display
        visitDatesList.innerHTML = scheduledVisits.map((d, i) => {
            const dateStr = d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
            return `<li><i class="fas fa-calendar-day" style="color: var(--primary);"></i> Visit ${i + 1}: <strong>${dateStr}</strong></li>`;
        }).join('');
        schedulePreview.style.display = 'block';
    }

    function parseDateStr(str) {
        const months = { January:0, February:1, March:2, April:3, May:4, June:5,
                         July:6, August:7, September:8, October:9, November:10, December:11 };
        const parts = str.replace(/^[A-Za-z]+,\s*/, '').split(' ');
        if (parts.length === 3) {
            return new Date(parseInt(parts[2]), months[parts[1]], parseInt(parts[0]));
        }
        return null;
    }

    // --- Postcode distance check ---
    const postcodeInput = document.getElementById('subPostcode');
    let distanceDebounce;
    postcodeInput.addEventListener('blur', checkDistance);
    postcodeInput.addEventListener('input', () => {
        clearTimeout(distanceDebounce);
        distanceDebounce = setTimeout(checkDistance, 1000);
    });

    async function checkDistance() {
        const pc = postcodeInput.value.trim();
        if (pc.length < 5 || typeof DistanceUtil === 'undefined') return;

        try {
            const result = await DistanceUtil.distanceFromBase(pc);
            if (result) {
                distanceText.innerHTML = `<strong>${result.drivingMiles} miles</strong> from base · ~${DistanceUtil.formatDriveTime(result.driveMinutes)} drive · <a href="${result.googleMapsUrl}" target="_blank" style="color: var(--primary);">View route</a>`;
                distanceInfo.style.display = 'flex';
            } else {
                distanceInfo.style.display = 'none';
            }
        } catch (e) {
            distanceInfo.style.display = 'none';
        }
    }

    // --- Form submission ---
    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const name = document.getElementById('subName').value.trim();
        const email = document.getElementById('subEmail').value.trim();
        const phone = document.getElementById('subPhone').value.trim();
        const postcode = document.getElementById('subPostcode').value.trim();
        const address = document.getElementById('subAddress').value.trim();
        const notes = document.getElementById('subNotes').value.trim();
        const day = preferredDay.value;
        const startDate = startDateInput.value;
        const agreed = document.getElementById('agreeTerms').checked;

        // Validation
        if (!name || !email || !phone || !postcode || !address || !day || !startDate || !agreed) {
            alert('Please fill in all required fields and agree to the terms.');
            return;
        }

        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            alert('Please enter a valid email address.');
            return;
        }

        const btn = document.getElementById('subscribeBtn');
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Setting up payment...';
        btn.disabled = true;

        const pkg = packages[selectedPackage];
        const visitDatesStr = scheduledVisits.map(d =>
            d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
        ).join('\n');

        // Get distance info
        let distInfo = null;
        if (typeof DistanceUtil !== 'undefined') {
            try { distInfo = await DistanceUtil.distanceFromBase(postcode); } catch (e) {}
        }

        // --- Stripe: Create payment method from card ---
        let paymentMethodId = null;
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
                btn.innerHTML = '<i class="fas fa-leaf"></i> Subscribe & Pay';
                btn.disabled = false;
                return;
            }
            paymentMethodId = paymentMethod.id;
        } catch (e) {
            console.error('Stripe card error:', e);
            const errEl = document.getElementById('cardErrors');
            if (errEl) errEl.textContent = 'Card processing failed. Please try again.';
            btn.innerHTML = '<i class="fas fa-leaf"></i> Subscribe & Pay';
            btn.disabled = false;
            return;
        }

        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Creating subscription...';

        // --- Build custom services description ---
        let customServicesDesc = '';
        if (selectedPackage === 'custom') {
            customServicesDesc = packages.custom.services.map(s =>
                `${s.service} (${s.frequency}) — £${s.monthlyAvg.toFixed(2)}/mo`
            ).join(', ');
        }

        // --- Send to Apps Script to create Stripe subscription ---
        try {
            const payload = {
                action: 'stripe_subscription',
                paymentMethodId: paymentMethodId,
                customer: { name, email, phone, address, postcode },
                package: selectedPackage,
                packageName: pkg.name + (customServicesDesc ? ': ' + customServicesDesc : ''),
                price: pkg.price,
                billing: pkg.billing,
                preferredDay: day,
                startDate: startDate,
                notes: notes + (customServicesDesc ? '\n[Custom: ' + customServicesDesc + ']' : ''),
                visits: scheduledVisits.map(d => d.toISOString()),
                distance: distInfo ? distInfo.drivingMiles : '',
                driveTime: distInfo ? distInfo.driveMinutes : '',
                googleMapsUrl: distInfo ? distInfo.googleMapsUrl : ''
            };
            if (selectedPackage === 'custom') {
                payload.customServices = packages.custom.services;
                payload.customMonthly = getByoMonthlyFinal();
            }
            await fetch(SHEETS_WEBHOOK, {
                method: 'POST',
                mode: 'no-cors',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
        } catch (e) { console.error('Stripe subscription request failed:', e); }

        // 1. Send to Web3Forms
        try {
            const formData = new FormData();
            formData.append('access_key', WEB3FORMS_KEY);
            formData.append('subject', `New ${pkg.name} Subscription — Gardners GM`);
            formData.append('from_name', 'Website Subscription');
            formData.append('Package', `${pkg.name} (${pkg.price})`);
            formData.append('Preferred Day', day);
            formData.append('Start Date', startDate);
            formData.append('Name', name);
            formData.append('Email', email);
            formData.append('Phone', phone);
            formData.append('Postcode', postcode);
            formData.append('Address', address);
            formData.append('Notes', notes);
            formData.append('Scheduled Visits', visitDatesStr);
            formData.append('Payment', 'Stripe recurring - card on file');
            if (distInfo) {
                formData.append('Distance', `${distInfo.drivingMiles} miles (~${DistanceUtil.formatDriveTime(distInfo.driveMinutes)})`);
            }

            await fetch('https://api.web3forms.com/submit', { method: 'POST', body: formData });
        } catch (e) { console.error('Web3Forms failed:', e); }

        // 2. Send to Telegram
        try {
            await sendSubscriptionTelegram(pkg, name, email, phone, address, postcode, day, startDate, notes, distInfo);
        } catch (e) { console.error('Telegram failed:', e); }

        // Show success
        formWrapper.style.display = 'none';
        successDiv.style.display = 'block';
        window.scrollTo({ top: 0, behavior: 'smooth' });

        btn.innerHTML = '<i class="fas fa-leaf"></i> Start My Subscription';
        btn.disabled = false;
    });

    // --- Telegram notification ---
    async function sendSubscriptionTelegram(pkg, name, email, phone, address, postcode, day, startDate, notes, distInfo) {
        const visitLines = scheduledVisits.map((d, i) =>
            `  ${i + 1}. ${d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}`
        ).join('\n');

        // Build Google Calendar URL for first visit
        const calUrls = scheduledVisits.map(d => {
            const pad = n => String(n).padStart(2, '0');
            const start = `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}T090000`;
            const endD = new Date(d.getTime() + 60 * 60 * 1000);
            const end = `${endD.getFullYear()}${pad(endD.getMonth()+1)}${pad(endD.getDate())}T100000`;
            const title = encodeURIComponent(`🌿 ${pkg.name} Sub — ${name}`);
            const details = encodeURIComponent(`${pkg.name} Package subscription\nCustomer: ${name}\nPhone: ${phone}\nAddress: ${address}, ${postcode}`);
            const loc = encodeURIComponent(`${address}, ${postcode}`);
            return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${start}/${end}&details=${details}&location=${loc}`;
        });

        let distLine = '';
        if (distInfo) {
            distLine = `\n📏 *Distance:* ${distInfo.drivingMiles} miles (~${DistanceUtil.formatDriveTime(distInfo.driveMinutes)} drive)\n🗺 [View Route](${distInfo.googleMapsUrl})`;
        }

        const calLinks = calUrls.map((url, i) =>
            `[📲 Add Visit ${i + 1} to Calendar](${url})`
        ).join('\n');

        const msg = `🌿 *NEW SUBSCRIPTION*\n\n` +
            `📦 *Package:* ${pkg.name} (${pkg.price})\n` +
            `📅 *Preferred Day:* ${day}\n` +
            `🗓 *Start Date:* ${startDate}\n\n` +
            `👤 *Customer:* ${name}\n` +
            `📧 *Email:* ${email}\n` +
            `📞 *Phone:* ${phone}\n` +
            `📍 *Address:* ${address}, ${postcode}\n` +
            distLine + `\n\n` +
            `📋 *First 4 Visits:*\n${visitLines}\n\n` +
            calLinks + `\n\n` +
            (notes ? `📝 *Notes:* ${notes}\n\n` : '') +
            `_Subscribed via gardnersgm.co.uk_`;

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

        // Send .ics with ALL scheduled visits
        if (scheduledVisits.length > 0) {
            const pad = n => String(n).padStart(2, '0');
            const fmt = dt => `${dt.getFullYear()}${pad(dt.getMonth()+1)}${pad(dt.getDate())}T${pad(dt.getHours())}${pad(dt.getMinutes())}00`;

            const vevents = scheduledVisits.map((visit, i) => {
                const start = new Date(visit); start.setHours(9, 0, 0);
                const endD = new Date(start.getTime() + 60 * 60 * 1000);
                return [
                    'BEGIN:VEVENT',
                    `DTSTART:${fmt(start)}`, `DTEND:${fmt(endD)}`,
                    `SUMMARY:🌿 ${pkg.name} Sub — ${name} (Visit ${i + 1})`,
                    `DESCRIPTION:${pkg.name} Package — Visit ${i + 1} of ${scheduledVisits.length}\\nCustomer: ${name}\\nPhone: ${phone}\\nAddress: ${address}\\, ${postcode}`,
                    `LOCATION:${address}\\, ${postcode}`,
                    'STATUS:CONFIRMED',
                    `UID:sub-${Date.now()}-v${i + 1}@gardnersgm.co.uk`,
                    'END:VEVENT'
                ].join('\r\n');
            });

            const ics = [
                'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Gardners GM//Subscription//EN',
                ...vevents,
                'END:VCALENDAR'
            ].join('\r\n');

            const blob = new Blob([ics], { type: 'text/calendar' });
            const fd = new FormData();
            fd.append('chat_id', TG_CHAT_ID);
            fd.append('document', blob, `subscription-${name.replace(/\s+/g, '-').toLowerCase()}-all-visits.ics`);
            fd.append('caption', `📎 All ${scheduledVisits.length} visits — tap to add to calendar`);

            await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendDocument`, { method: 'POST', body: fd });
        }
    }

    /* ============================================
       Build Your Own Package — Interactive Logic
       ============================================ */
    const FREQ_MONTHS = {
        weekly:      4.33,   // visits per month
        fortnightly: 2.17,
        monthly:     1,
        '6weekly':   0.67,
        quarterly:   0.33,
        biannual:    0.167,
        annual:      0.083
    };

    const BYO_DISCOUNT = 0.10; // 10% bundle discount
    const VAT_RATE = 0.20;       // 20% UK VAT

    // Track distance from postcode for fuel calc
    let byoDistanceMiles = 0;
    const FUEL_RATE_PER_MILE = 0.45; // £/mile

    function initByoBuilder() {
        const checks = document.querySelectorAll('.byo-check');
        if (!checks.length) return;

        checks.forEach(cb => {
            const freqSel = document.querySelector(`.byo-freq[data-for="${cb.id}"]`);
            cb.addEventListener('change', () => {
                if (freqSel) freqSel.disabled = !cb.checked;
                recalcByo();
            });
            if (freqSel) {
                freqSel.addEventListener('change', recalcByo);
            }
        });
    }

    function recalcByo() {
        const checks = document.querySelectorAll('.byo-check');
        let totalMonthly = 0;
        let totalOneoff = 0;
        let anyChecked = false;
        let totalVisitsPerMonth = 0;

        checks.forEach(cb => {
            const costEl = document.querySelector(`.byo-line-cost[data-for="${cb.id}"]`);
            const freqSel = document.querySelector(`.byo-freq[data-for="${cb.id}"]`);

            if (cb.checked && freqSel) {
                anyChecked = true;
                const opt = freqSel.options[freqSel.selectedIndex];
                const pricePerVisit = parseFloat(opt.dataset.price) || 0;
                const freq = freqSel.value;
                const visitsPerMonth = FREQ_MONTHS[freq] || 1;
                const monthlyAvg = pricePerVisit * visitsPerMonth;
                totalMonthly += monthlyAvg;
                totalVisitsPerMonth += visitsPerMonth;
                // One-off total (without discount, for savings calc): use base price
                const basePrice = parseFloat(cb.dataset.base) || pricePerVisit;
                totalOneoff += basePrice * visitsPerMonth;
                if (costEl) {
                    costEl.textContent = `£${monthlyAvg.toFixed(2)}/mo`;
                    costEl.classList.add('active');
                }
            } else {
                if (costEl) {
                    costEl.textContent = '—';
                    costEl.classList.remove('active');
                }
            }
        });

        const totalsEl = document.getElementById('byoTotals');
        if (!anyChecked) {
            if (totalsEl) totalsEl.style.display = 'none';
            return;
        }

        const discount = totalMonthly * BYO_DISCOUNT;
        const afterDiscount = totalMonthly - discount;
        const vat = afterDiscount * VAT_RATE;
        const grandTotal = afterDiscount + vat;
        const annual = grandTotal * 12;
        const annualOneoff = totalOneoff * 1.2 * 12; // inc VAT for comparison
        const saving = annualOneoff - annual;

        document.getElementById('byoMonthly').textContent = `£${totalMonthly.toFixed(2)}`;
        document.getElementById('byoDiscount').textContent = `−£${discount.toFixed(2)}`;
        document.getElementById('byoFinal').textContent = `£${afterDiscount.toFixed(2)}`;

        const vatEl = document.getElementById('byoVat');
        if (vatEl) vatEl.textContent = `£${vat.toFixed(2)}`;
        const grandEl = document.getElementById('byoGrandTotal');
        if (grandEl) grandEl.textContent = `£${grandTotal.toFixed(2)}`;

        document.getElementById('byoAnnual').textContent = `£${annual.toFixed(0)}/year`;
        document.getElementById('byoSaving').textContent = `£${saving > 0 ? saving.toFixed(0) : 0}/year`;

        // Fuel estimate from distance
        const fuelEl = document.getElementById('byoFuelEst');
        if (fuelEl) {
            if (byoDistanceMiles > 0) {
                const roundTripMiles = byoDistanceMiles * 2;
                const fuelPerVisit = roundTripMiles * FUEL_RATE_PER_MILE;
                const fuelMonthly = fuelPerVisit * totalVisitsPerMonth;
                fuelEl.innerHTML = `£${fuelPerVisit.toFixed(2)}/visit · <strong>£${fuelMonthly.toFixed(2)}/mo</strong> (${byoDistanceMiles} mi × 2 × £${FUEL_RATE_PER_MILE}/mi)`;
            } else {
                fuelEl.textContent = 'Enter postcode for estimate';
            }
        }

        if (totalsEl) totalsEl.style.display = 'block';
    }

    function getByoSelectedServices() {
        const services = [];
        document.querySelectorAll('.byo-check:checked').forEach(cb => {
            const freqSel = document.querySelector(`.byo-freq[data-for="${cb.id}"]`);
            if (!freqSel) return;
            const opt = freqSel.options[freqSel.selectedIndex];
            const pricePerVisit = parseFloat(opt.dataset.price) || 0;
            const freq = freqSel.value;
            const visitsPerMonth = FREQ_MONTHS[freq] || 1;
            services.push({
                service: cb.dataset.service,
                frequency: freq,
                pricePerVisit,
                visitsPerMonth,
                monthlyAvg: pricePerVisit * visitsPerMonth
            });
        });
        return services;
    }

    function getByoMonthlyFinal() {
        const services = getByoSelectedServices();
        const total = services.reduce((s, svc) => s + svc.monthlyAvg, 0);
        const afterDiscount = total * (1 - BYO_DISCOUNT);
        return afterDiscount * (1 + VAT_RATE); // inc VAT
    }

    // ── Address Finder hookup ──
    if (typeof AddressLookup !== 'undefined') {
        // Subscribe page
        const subPC = document.getElementById('subPostcode');
        const subFind = document.getElementById('subFindAddr');
        const subDrop = document.getElementById('subAddrDropdown');
        const subAddr = document.getElementById('subAddress');
        if (subPC && subFind && subDrop) {
            AddressLookup.attach({
                postcodeInput: subPC,
                findBtn: subFind,
                dropdown: subDrop,
                addressInput: subAddr,
                onSelect: (addr) => {
                    // Auto-trigger distance check after address selected
                    checkDistance();
                }
            });
        }
    }

    // ── Update BYO fuel estimate when distance changes ──
    const origCheckDistance = checkDistance;
    const _origPostcodeBlur = postcodeInput.onblur; // preserve existing
    postcodeInput.addEventListener('blur', async () => {
        // After distance check, update BYO fuel if builder is active
        setTimeout(updateByoFuelFromDistance, 1500);
    });

    async function updateByoFuelFromDistance() {
        const pc = postcodeInput.value.trim();
        if (pc.length < 5 || typeof DistanceUtil === 'undefined') return;
        try {
            const result = await DistanceUtil.distanceFromBase(pc);
            if (result) {
                byoDistanceMiles = result.drivingMiles;
                recalcByo(); // re-render with fuel line
            }
        } catch(e) {}
    }

    // Initialise BYO builder
    initByoBuilder();

    // ═══════════════════════════════════════════
    //  FREE QUOTE VISIT FORM HANDLER
    // ═══════════════════════════════════════════
    const freeVisitForm = document.getElementById('freeVisitForm');
    if (freeVisitForm) {
        // Flatpickr for preferred date
        const fvDateInput = document.getElementById('fvDate');
        if (fvDateInput && typeof flatpickr !== 'undefined') {
            flatpickr(fvDateInput, {
                minDate: 'today',
                maxDate: new Date().fp_incr(60),
                dateFormat: 'l, j F Y',
                disable: [date => date.getDay() === 0],
                locale: { firstDayOfWeek: 1 },
                animate: true,
                onChange: () => checkFreeVisitAvailability()
            });
        }

        // Check availability when time changes
        const fvTimeSelect = document.getElementById('fvTime');
        if (fvTimeSelect) fvTimeSelect.addEventListener('change', checkFreeVisitAvailability);

        // Availability checker
        async function checkFreeVisitAvailability() {
            const dateVal = document.getElementById('fvDate').value;
            const timeVal = document.getElementById('fvTime').value;
            const availDiv = document.getElementById('fvAvailability');
            if (!dateVal || !timeVal || !availDiv) return;

            // Convert flatpickr date to ISO
            const dp = document.getElementById('fvDate')._flatpickr;
            if (!dp || !dp.selectedDates[0]) return;
            const isoDate = dp.selectedDates[0].toISOString().split('T')[0];

            availDiv.style.display = 'block';
            availDiv.style.background = '#FFF8E1';
            availDiv.style.border = '1px solid #FFE082';
            availDiv.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Checking availability...';

            try {
                const resp = await fetch(SHEETS_WEBHOOK + '?action=check_availability&date=' + encodeURIComponent(isoDate) + '&time=' + encodeURIComponent(timeVal) + '&service=free-quote-visit');
                const data = await resp.json();
                if (data.available) {
                    availDiv.style.background = '#E8F5E9';
                    availDiv.style.border = '1px solid #C8E6C9';
                    availDiv.innerHTML = '<i class="fas fa-check-circle" style="color:#4CAF50;"></i> <strong>Available!</strong> This time slot is free.';
                } else {
                    availDiv.style.background = '#FFEBEE';
                    availDiv.style.border = '1px solid #FFCDD2';
                    availDiv.innerHTML = '<i class="fas fa-times-circle" style="color:#E53935;"></i> <strong>Not available</strong> — ' + (data.reason || 'this slot is already booked') + '. Please choose a different date or time.';
                }
            } catch {
                availDiv.style.display = 'none';
            }
        }

        // Address lookup
        const fvLookupBtn = document.getElementById('fvLookupBtn');
        const fvPostcode = document.getElementById('fvPostcode');
        const fvAddressSelect = document.getElementById('fvAddressSelect');
        const fvAddress = document.getElementById('fvAddress');

        if (fvLookupBtn) {
            fvLookupBtn.addEventListener('click', async () => {
                const pc = fvPostcode.value.trim().replace(/\s+/g, '');
                if (pc.length < 5) { alert('Please enter a valid postcode'); return; }
                fvLookupBtn.disabled = true;
                fvLookupBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
                try {
                    const res = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(pc)}`);
                    const data = await res.json();
                    if (data.status === 200 && data.result) {
                        const r = data.result;
                        const addr = `${r.admin_ward}, ${r.admin_district}, ${r.postcode}`;
                        fvAddress.value = addr;
                        fvAddressSelect.style.display = 'none';
                    } else {
                        alert('Postcode not found — please enter your address manually.');
                    }
                } catch {
                    alert('Lookup failed — please enter your address manually.');
                } finally {
                    fvLookupBtn.disabled = false;
                    fvLookupBtn.innerHTML = '<i class="fas fa-search"></i> Find Address';
                }
            });
        }

        // Form submission
        freeVisitForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = document.getElementById('fvSubmitBtn');
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Booking your visit...';

            // Convert flatpickr date to ISO for backend
            const dp = document.getElementById('fvDate')._flatpickr;
            const isoDate = (dp && dp.selectedDates[0]) ? dp.selectedDates[0].toISOString().split('T')[0] : document.getElementById('fvDate').value;
            const displayDate = document.getElementById('fvDate').value;

            const formData = {
                action: 'free_visit',
                name: document.getElementById('fvName').value.trim(),
                phone: document.getElementById('fvPhone').value.trim(),
                email: document.getElementById('fvEmail').value.trim(),
                postcode: document.getElementById('fvPostcode').value.trim(),
                address: document.getElementById('fvAddress').value.trim(),
                preferredDate: isoDate,
                preferredDateDisplay: displayDate,
                preferredTime: document.getElementById('fvTime').value,
                gardenSize: document.getElementById('fvGardenSize').value,
                notes: document.getElementById('fvNotes').value.trim()
            };

            try {
                // 1. Google Sheets via GAS (this now creates a Jobs row + checks availability)
                const gasResp = await fetch(SHEETS_WEBHOOK, {
                    method: 'POST',
                    headers: { 'Content-Type': 'text/plain' },
                    body: JSON.stringify(formData)
                });
                const gasResult = await gasResp.json();

                if (gasResult.status === 'error' && gasResult.slotConflict) {
                    alert('Sorry, that time slot is already booked. Please choose a different date or time.');
                    btn.disabled = false;
                    btn.innerHTML = '<i class="fas fa-calendar-check"></i> Book My Free Visit';
                    return;
                }

                // 2. Telegram notification
                const fvMapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(formData.address + ', ' + formData.postcode)}`;
                const tgMsg = `🏡 *FREE QUOTE VISIT BOOKED*\n\n` +
                    `👤 ${formData.name}\n📞 ${formData.phone}\n📧 ${formData.email}\n` +
                    `📍 ${formData.address} (${formData.postcode})\n` +
                    `🗺 [Get Directions](${fvMapsUrl})\n` +
                    `📅 ${displayDate} — ${formData.preferredTime}\n` +
                    `📐 Garden size: ${formData.gardenSize || 'Not specified'}\n` +
                    `📝 Notes: ${formData.notes || 'None'}\n` +
                    `🎫 Job: ${gasResult.jobNumber || 'N/A'}\n\n` +
                    `⚠️ _This is booked into your calendar — 1hr slot blocked._`;

                await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ chat_id: TG_CHAT_ID, text: tgMsg, parse_mode: 'Markdown' })
                });

                // 3. Web3Forms confirmation copy
                const w3formData = new FormData();
                w3formData.append('access_key', WEB3FORMS_KEY);
                w3formData.append('subject', 'Free Quote Visit Booked — ' + formData.name);
                w3formData.append('from_name', 'Website — Free Visit');
                w3formData.append('name', formData.name);
                w3formData.append('email', formData.email);
                w3formData.append('phone', formData.phone);
                w3formData.append('address', formData.address);
                w3formData.append('postcode', formData.postcode);
                w3formData.append('preferred_date', displayDate);
                w3formData.append('preferred_time', formData.preferredTime);
                w3formData.append('garden_size', formData.gardenSize || 'Not specified');
                w3formData.append('notes', formData.notes || 'None');
                await fetch('https://api.web3forms.com/submit', { method: 'POST', body: w3formData });

                // Show success
                freeVisitForm.style.display = 'none';
                document.getElementById('freeVisitSuccess').style.display = 'block';

            } catch (err) {
                console.error('Free visit form error:', err);
                alert('Something went wrong — please call us on 07960 906498 to book your visit.');
                btn.disabled = false;
                btn.innerHTML = '<i class="fas fa-calendar-check"></i> Book My Free Visit';
            }
        });
    }

});
