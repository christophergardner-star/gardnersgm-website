/* ============================================
   Gardners GM — Newsletter Signup Component
   Auto-injects signup section before footer
   + handles inline newsletter forms (blog page)
   ============================================ */

(function() {
    'use strict';

    const SHEETS_WEBHOOK = 'https://script.google.com/macros/s/AKfycbzT27eyiZgQYkRBkoghFCPYoXGE_H-qam7IoecKdNYgRwbRmJhepTXapBLXbLskFHclKw/exec';

    // Don't inject on admin pages
    if (document.querySelector('.admin-dashboard') || document.querySelector('[data-admin-page]')) return;

    // Generic newsletter submit handler
    async function handleNewsletterSubmit(form, nameInput, emailInput, btn, msgEl) {
        const name = nameInput.value.trim();
        const email = emailInput.value.trim();
        if (!email) return;

        btn.disabled = true;
        const origHtml = btn.innerHTML;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Subscribing...';
        msgEl.textContent = '';
        msgEl.className = 'nl-signup-msg';

        try {
            const resp = await fetch(SHEETS_WEBHOOK, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain' },
                body: JSON.stringify({
                    action: 'subscribe_newsletter',
                    email: email,
                    name: name,
                    tier: 'free',
                    source: 'website'
                })
            });
            const data = await resp.json();
            msgEl.textContent = data.message || 'Successfully subscribed!';
            msgEl.className = 'nl-signup-msg success';
            form.reset();
        } catch (err) {
            msgEl.textContent = 'Something went wrong. Please try again.';
            msgEl.className = 'nl-signup-msg error';
        }

        btn.disabled = false;
        btn.innerHTML = origHtml;
    }

    document.addEventListener('DOMContentLoaded', () => {

        // ── Auto-inject newsletter section before footer (if no inline one exists) ──
        const footer = document.querySelector('footer.footer');
        if (footer && !document.querySelector('.nl-signup')) {
            const section = document.createElement('section');
            section.className = 'nl-signup';
            section.id = 'newsletter';
            section.innerHTML = `
                <div class="container">
                    <div class="nl-signup-inner">
                        <div class="nl-signup-icon"><i class="fas fa-envelope-open-text"></i></div>
                        <h2>Join Our Newsletter</h2>
                        <p>Get seasonal gardening tips, exclusive subscriber discounts, and garden care guides delivered to your inbox.</p>
                        <form class="nl-signup-form" id="nlSignupForm">
                            <input type="text" name="nlName" placeholder="Your name" id="nlName" required>
                            <input type="email" name="nlEmail" placeholder="Your email" id="nlEmail" required>
                            <button type="submit" id="nlBtn"><i class="fas fa-paper-plane"></i> Subscribe</button>
                        </form>
                        <div class="nl-signup-msg" id="nlMsg"></div>
                        <div class="nl-signup-perks">
                            <span><i class="fas fa-check-circle" style="color:#2E7D32"></i> Monthly tips</span>
                            <span><i class="fas fa-check-circle" style="color:#2E7D32"></i> Seasonal guides</span>
                            <span><i class="fas fa-check-circle" style="color:#2E7D32"></i> Subscriber discounts</span>
                            <span><i class="fas fa-check-circle" style="color:#2E7D32"></i> No spam</span>
                        </div>
                    </div>
                </div>
            `;
            footer.parentNode.insertBefore(section, footer);
        }

        // ── Bind all newsletter forms on the page ──
        const formConfigs = [
            { form: 'nlSignupForm', name: 'nlName', email: 'nlEmail', btn: 'nlBtn', msg: 'nlMsg' },
            { form: 'blogNlForm', name: 'blogNlName', email: 'blogNlEmail', btn: 'blogNlBtn', msg: 'blogNlMsg' }
        ];

        formConfigs.forEach(cfg => {
            const form = document.getElementById(cfg.form);
            if (!form) return;
            form.addEventListener('submit', (e) => {
                e.preventDefault();
                handleNewsletterSubmit(
                    form,
                    document.getElementById(cfg.name),
                    document.getElementById(cfg.email),
                    document.getElementById(cfg.btn),
                    document.getElementById(cfg.msg)
                );
            });
        });
    });
})();
