/* ============================================
   Gardners Ground Maintenance — Address Finder
   Postcode lookup using postcodes.io (free, no API key)
   Validates postcode + auto-fills town/county
   ============================================ */

const AddressLookup = (() => {

    // ── Lookup postcode details ──
    async function findByPostcode(postcode) {
        const clean = postcode.replace(/\s+/g, '').toUpperCase();
        if (clean.length < 5) return { ok: false, addresses: [], error: 'Postcode too short' };

        try {
            const resp = await fetch(`https://api.postcodes.io/postcodes/${clean}`);

            if (resp.status === 404) return { ok: false, addresses: [], error: 'Postcode not found — please check and try again' };
            if (!resp.ok) return { ok: false, addresses: [], error: 'Lookup failed' };

            const data = await resp.json();
            const r = data.result || {};

            // Build address entry with town/county from the postcode
            const address = {
                line1: '',
                line2: '',
                town: r.admin_district || r.parliamentary_constituency || '',
                county: r.admin_county || r.region || '',
                postcode: r.postcode || clean,
                parish: r.parish || '',
                full: [r.admin_district, r.admin_county || r.region, r.postcode].filter(Boolean).join(', ')
            };

            return { ok: true, addresses: [address], postcode: r.postcode || clean, location: r };
        } catch (e) {
            console.error('Address lookup error:', e);
            return { ok: false, addresses: [], error: 'Network error — please type your address manually' };
        }
    }

    // ── Attach postcode finder to a form ──
    // opts: { postcodeInput, findBtn, dropdown, addressInput, onSelect }
    function attach(opts) {
        const { postcodeInput, findBtn, dropdown, addressInput, onSelect } = opts;
        if (!postcodeInput || !findBtn || !dropdown) return;

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

            if (!result.ok) {
                dropdown.innerHTML = `<div class="al-no-results">${result.error}</div>`;
                dropdown.style.display = 'block';
                if (addressInput) { addressInput.readOnly = false; addressInput.focus(); }
                return;
            }

            const addr = result.addresses[0];
            if (postcodeInput) postcodeInput.value = result.postcode;

            // Show confirmation with town/county and prompt for street address
            dropdown.innerHTML = `<div class="al-hint">
                <i class="fas fa-check-circle" style="color:#2E7D32"></i> 
                <strong>${result.postcode}</strong> — ${addr.town}${addr.county ? ', ' + addr.county : ''}${addr.parish ? ' (' + addr.parish + ')' : ''}
            </div>
            <div class="al-hint" style="margin-top:6px;font-size:13px;color:#666;">
                <i class="fas fa-pencil-alt"></i> Please type your house number and street below
            </div>`;
            dropdown.style.display = 'block';

            if (addressInput) {
                addressInput.readOnly = false;
                addressInput.value = '';
                addressInput.placeholder = 'e.g. 12 High Street, ' + addr.town;
                addressInput.focus();
            }

            if (typeof onSelect === 'function') onSelect(addr);
        });

        postcodeInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); findBtn.click(); }
        });
    }

    return { findByPostcode, attach };
})();
