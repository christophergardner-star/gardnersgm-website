/* ============================================
   Gardners Ground Maintenance — Address Finder
   Postcode lookup using Ideal Postcodes API
   Returns full street-level addresses from postcode
   Fallback to postcodes.io (free) if no API key or credits exhausted
   ============================================ */

const AddressLookup = (() => {

    // Ideal Postcodes API key — get yours at https://ideal-postcodes.co.uk
    // 'ak_test' works with limited test postcodes only (e.g. ID1 1QD)
    const IDEAL_API_KEY = 'ak_test';

    // ── Primary: Ideal Postcodes (returns real street addresses) ──
    async function lookupIdeal(postcode) {
        const clean = postcode.replace(/\s+/g, '').toUpperCase();
        if (clean.length < 5) return { ok: false, addresses: [], error: 'Postcode too short' };

        try {
            const resp = await fetch(
                `https://api.ideal-postcodes.co.uk/v1/postcodes/${encodeURIComponent(clean)}?api_key=${IDEAL_API_KEY}`
            );

            if (resp.status === 404) {
                const errData = await resp.json().catch(() => ({}));
                const suggestions = (errData.suggestions || []).join(', ');
                return {
                    ok: false, addresses: [],
                    error: suggestions
                        ? `Postcode not found. Did you mean: ${suggestions}?`
                        : 'Postcode not found — please check and try again'
                };
            }

            if (resp.status === 402) {
                // No credits or key issue — fall back to free lookup
                console.warn('[AddressLookup] Ideal Postcodes credit issue, falling back to postcodes.io');
                return lookupFree(postcode);
            }

            if (!resp.ok) return { ok: false, addresses: [], error: 'Lookup failed — please type your address manually' };

            const data = await resp.json();
            const results = data.result || [];

            if (!results.length) return { ok: false, addresses: [], error: 'No addresses found for this postcode' };

            const addresses = results.map(r => ({
                line1: r.line_1 || '',
                line2: r.line_2 || '',
                line3: r.line_3 || '',
                town: r.post_town || '',
                county: r.county || '',
                postcode: r.postcode || clean,
                // Clean display string for dropdown
                display: [r.line_1, r.line_2, r.line_3, r.post_town].filter(Boolean).join(', '),
                // Full address for form submission
                full: [r.line_1, r.line_2, r.line_3, r.post_town, r.county].filter(Boolean).join(', ')
            }));

            return { ok: true, addresses, postcode: results[0].postcode || clean };
        } catch (e) {
            console.error('[AddressLookup] Ideal Postcodes error:', e);
            return lookupFree(postcode);
        }
    }

    // ── Fallback: postcodes.io (free, no API key, area-level only) ──
    async function lookupFree(postcode) {
        const clean = postcode.replace(/\s+/g, '').toUpperCase();
        if (clean.length < 5) return { ok: false, addresses: [], error: 'Postcode too short' };

        try {
            const resp = await fetch(`https://api.postcodes.io/postcodes/${clean}`);
            if (resp.status === 404) return { ok: false, addresses: [], error: 'Postcode not found — please check and try again' };
            if (!resp.ok) return { ok: false, addresses: [], error: 'Lookup failed' };

            const data = await resp.json();
            const r = data.result || {};

            const address = {
                line1: '', line2: '', line3: '',
                town: r.admin_district || r.parliamentary_constituency || '',
                county: r.admin_county || r.region || '',
                postcode: r.postcode || clean,
                display: '',
                full: [r.admin_district, r.admin_county || r.region, r.postcode].filter(Boolean).join(', ')
            };

            return { ok: true, addresses: [address], postcode: r.postcode || clean, freeMode: true };
        } catch (e) {
            console.error('[AddressLookup] postcodes.io error:', e);
            return { ok: false, addresses: [], error: 'Network error — please type your address manually' };
        }
    }

    // ── Main lookup ──
    async function findByPostcode(postcode) {
        if (IDEAL_API_KEY && IDEAL_API_KEY !== '') return lookupIdeal(postcode);
        return lookupFree(postcode);
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
            findBtn.innerHTML = '<i class="fas fa-search"></i> Find Address';

            if (!result.ok) {
                dropdown.innerHTML = `<div class="al-no-results"><i class="fas fa-exclamation-circle"></i> ${result.error}</div>`;
                dropdown.style.display = 'block';
                if (addressInput) { addressInput.readOnly = false; addressInput.focus(); }
                return;
            }

            if (postcodeInput) postcodeInput.value = result.postcode;

            // Free mode fallback: no street addresses, prompt manual entry
            if (result.freeMode || (result.addresses.length === 1 && !result.addresses[0].line1)) {
                const addr = result.addresses[0];
                dropdown.innerHTML = `<div class="al-hint">
                    <i class="fas fa-check-circle" style="color:#2E7D32"></i> 
                    <strong>${result.postcode}</strong> — ${addr.town}${addr.county ? ', ' + addr.county : ''}
                </div>
                <div class="al-hint" style="margin-top:0;border-radius:0 0 10px 10px;border-top:none;">
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
                return;
            }

            // Full address mode: show selectable dropdown list
            const count = result.addresses.length;
            let html = `<div class="al-hint">
                <i class="fas fa-check-circle" style="color:#2E7D32"></i> 
                <strong>${result.postcode}</strong> — ${count} address${count !== 1 ? 'es' : ''} found. Select yours below:
            </div>`;

            result.addresses.forEach((addr, i) => {
                html += `<div class="al-option" data-idx="${i}" tabindex="0">${addr.display}</div>`;
            });

            // Manual entry option at the bottom
            html += `<div class="al-option al-manual" data-idx="-1" tabindex="0">
                <i class="fas fa-pencil-alt"></i> My address isn't listed — type manually
            </div>`;

            dropdown.innerHTML = html;
            dropdown.style.display = 'block';

            // Handle address selection
            dropdown.querySelectorAll('.al-option').forEach(opt => {
                const selectHandler = () => {
                    const idx = parseInt(opt.dataset.idx);
                    dropdown.querySelectorAll('.al-option').forEach(o => o.classList.remove('al-selected'));
                    opt.classList.add('al-selected');

                    if (idx === -1) {
                        // Manual entry
                        if (addressInput) {
                            addressInput.value = '';
                            addressInput.readOnly = false;
                            addressInput.placeholder = 'Type your full address';
                            addressInput.focus();
                        }
                    } else {
                        const addr = result.addresses[idx];
                        if (addressInput) {
                            addressInput.value = addr.display;
                            addressInput.readOnly = false;
                        }
                        if (typeof onSelect === 'function') onSelect(addr);
                    }
                };

                opt.addEventListener('click', selectHandler);
                opt.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectHandler(); }
                });
            });
        });

        postcodeInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); findBtn.click(); }
        });
    }

    return { findByPostcode, attach };
})();
