/* ============================================
   Gardners Ground Maintenance — Address Finder
   Postcode → address dropdown using getAddress.io
   Free tier: 20 lookups/day (plenty for a small biz)
   Sign up: https://getaddress.io  →  get your API key
   ============================================ */

const AddressLookup = (() => {

    // ── Replace with your getAddress.io API key ──
    // Sign up free at https://getaddress.io (20 lookups/day)
    const API_KEY = 'dxFruigWUkq3GobVNHdDLQ42656';

    // ── Lookup addresses for a postcode ──
    async function findByPostcode(postcode) {
        const clean = postcode.replace(/\s+/g, '').toUpperCase();
        if (clean.length < 5) return { ok: false, addresses: [], error: 'Postcode too short' };

        try {
            const resp = await fetch(
                `https://api.getaddress.io/find/${clean}?api-key=${API_KEY}&expand=true`
            );

            if (resp.status === 401) return { ok: false, addresses: [], error: 'Invalid API key — update address-lookup.js' };
            if (resp.status === 404) return { ok: false, addresses: [], error: 'Postcode not found' };
            if (resp.status === 429) return { ok: false, addresses: [], error: 'Daily limit reached — try again tomorrow' };
            if (!resp.ok) return { ok: false, addresses: [], error: 'Lookup failed' };

            const data = await resp.json();
            const addresses = (data.addresses || []).map(a => ({
                line1: [a.line_1, a.line_2].filter(Boolean).join(', '),
                line2: [a.line_3, a.line_4].filter(Boolean).join(', '),
                town: a.town_or_city || '',
                county: a.county || '',
                postcode: data.postcode || clean,
                full: [a.line_1, a.line_2, a.line_3, a.town_or_city, a.county, data.postcode]
                    .filter(Boolean).join(', ')
            }));

            return { ok: true, addresses, postcode: data.postcode || clean };
        } catch (e) {
            console.error('Address lookup error:', e);
            return { ok: false, addresses: [], error: 'Network error' };
        }
    }

    // ── Attach postcode finder to a form ──
    // opts: { postcodeInput, findBtn, dropdown, addressInput, onSelect }
    function attach(opts) {
        const { postcodeInput, findBtn, dropdown, addressInput, onSelect } = opts;
        if (!postcodeInput || !findBtn || !dropdown) return;

        let addresses = [];

        findBtn.addEventListener('click', async () => {
            const pc = postcodeInput.value.trim();
            if (!pc) { postcodeInput.focus(); return; }

            findBtn.disabled = true;
            findBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
            dropdown.innerHTML = '';
            dropdown.style.display = 'none';

            const result = await findByPostcode(pc);
            findBtn.disabled = false;
            findBtn.innerHTML = '<i class="fas fa-search"></i> Find';

            if (!result.ok || result.addresses.length === 0) {
                dropdown.innerHTML = `<div class="al-no-results">${result.error || 'No addresses found'} — type manually below</div>`;
                dropdown.style.display = 'block';
                if (addressInput) { addressInput.readOnly = false; addressInput.focus(); }
                return;
            }

            addresses = result.addresses;
            dropdown.innerHTML = `<div class="al-hint">${addresses.length} addresses found — select yours:</div>`;
            addresses.forEach((addr, i) => {
                const opt = document.createElement('div');
                opt.className = 'al-option';
                opt.textContent = addr.full;
                opt.dataset.index = i;
                opt.addEventListener('click', () => {
                    if (addressInput) {
                        addressInput.value = addr.line1 + (addr.line2 ? ', ' + addr.line2 : '') + ', ' + addr.town;
                        addressInput.readOnly = false;
                    }
                    dropdown.style.display = 'none';
                    // Highlight selected
                    dropdown.querySelectorAll('.al-option').forEach(o => o.classList.remove('al-selected'));
                    opt.classList.add('al-selected');
                    if (typeof onSelect === 'function') onSelect(addr);
                });
                dropdown.appendChild(opt);
            });
            // "Not listed" fallback
            const manual = document.createElement('div');
            manual.className = 'al-option al-manual';
            manual.innerHTML = '<i class="fas fa-pencil-alt"></i> My address isn\'t listed — type manually';
            manual.addEventListener('click', () => {
                dropdown.style.display = 'none';
                if (addressInput) { addressInput.value = ''; addressInput.readOnly = false; addressInput.focus(); }
            });
            dropdown.appendChild(manual);
            dropdown.style.display = 'block';
        });

        // Also trigger on Enter in postcode field
        postcodeInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); findBtn.click(); }
        });
    }

    return { findByPostcode, attach };
})();
