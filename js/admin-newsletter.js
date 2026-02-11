/* ============================================
   Gardners GM — Admin Newsletter Manager
   Compose, preview, send newsletters + 
   subscriber stats and history.
   ============================================ */

document.addEventListener('DOMContentLoaded', () => {

    const SHEETS_WEBHOOK = 'https://script.google.com/macros/s/AKfycbzFPVDEu1rKfwe6JKEO5jbdLYjsS80afgo23Vfr8zHoIULoPfRQfFyfZvZeHLCAoiUHTg/exec';
    
    let subscribers = [];
    let newsletters = [];

    // ============================================
    // NEWSLETTER HEADER IMAGE
    // ============================================

    const nlFetchImageBtn = document.getElementById('nlFetchImageBtn');
    const nlHeaderImageInput = document.getElementById('nlHeaderImage');
    const nlImagePreview = document.getElementById('nlImagePreview');
    const nlImagePreviewImg = document.getElementById('nlImagePreviewImg');

    function showNlImagePreview(url) {
        if (nlImagePreview && nlImagePreviewImg && url) {
            nlImagePreviewImg.src = url;
            nlImagePreview.style.display = 'block';
        }
    }

    function hideNlImagePreview() {
        if (nlImagePreview) nlImagePreview.style.display = 'none';
    }

    if (nlHeaderImageInput) {
        nlHeaderImageInput.addEventListener('input', function() {
            const url = this.value.trim();
            if (url) showNlImagePreview(url); else hideNlImagePreview();
        });
    }

    if (nlFetchImageBtn) {
        nlFetchImageBtn.addEventListener('click', async () => {
            const subject = (document.getElementById('nlSubject') || {}).value || '';
            const content = (document.getElementById('nlContent') || {}).value || '';
            const query = subject || content.substring(0, 80) || 'gardening lawn care';

            nlFetchImageBtn.disabled = true;
            nlFetchImageBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Searching...';

            try {
                const resp = await fetch(SHEETS_WEBHOOK, {
                    method: 'POST',
                    headers: { 'Content-Type': 'text/plain' },
                    body: JSON.stringify({
                        action: 'fetch_blog_image',
                        title: query,
                        category: 'gardening',
                        tags: ''
                    })
                });
                const data = await resp.json();
                if (data.status === 'success' && data.imageUrl) {
                    nlHeaderImageInput.value = data.imageUrl;
                    showNlImagePreview(data.imageUrl);
                } else {
                    alert('No image found. Try adding a subject first, or paste a URL manually.');
                }
            } catch (err) {
                alert('Failed to fetch image. Please try again.');
            }

            nlFetchImageBtn.disabled = false;
            nlFetchImageBtn.innerHTML = '<i class="fas fa-search"></i> Fetch Image';
        });
    }

    // ============================================
    // LOAD SUBSCRIBER DATA
    // ============================================

    async function loadSubscribers() {
        try {
            const resp = await fetch(SHEETS_WEBHOOK + '?action=get_subscribers');
            const data = await resp.json();
            if (data.status === 'success') {
                subscribers = data.subscribers || [];
                renderSubStats();
                renderSubList();
            }
        } catch (e) {
            document.getElementById('nlSubStats').innerHTML = '<p style="color:#c62828;">Failed to load</p>';
        }
    }

    async function loadNewsletters() {
        try {
            const resp = await fetch(SHEETS_WEBHOOK + '?action=get_newsletters');
            const data = await resp.json();
            if (data.status === 'success') {
                newsletters = data.newsletters || [];
                renderHistory();
            }
        } catch (e) {
            document.getElementById('nlHistory').innerHTML = '<p style="color:#c62828;">Failed to load</p>';
        }
    }


    // ============================================
    // RENDER SUBSCRIBER STATS
    // ============================================

    function renderSubStats() {
        const el = document.getElementById('nlSubStats');
        if (!el) return;

        const active = subscribers.filter(s => s.status === 'active');
        const free = active.filter(s => s.tier === 'free');
        const paid = active.filter(s => s.tier !== 'free');
        const unsub = subscribers.filter(s => s.status === 'unsubscribed');

        el.innerHTML = `
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem;">
                <div style="background:#E8F5E9;border-radius:8px;padding:12px;text-align:center;">
                    <div style="font-size:1.5rem;font-weight:700;color:#2E7D32;">${active.length}</div>
                    <div style="font-size:0.75rem;color:#666;">Active</div>
                </div>
                <div style="background:#E3F2FD;border-radius:8px;padding:12px;text-align:center;">
                    <div style="font-size:1.5rem;font-weight:700;color:#1565C0;">${paid.length}</div>
                    <div style="font-size:0.75rem;color:#666;">Paid Plans</div>
                </div>
                <div style="background:#FFF8E1;border-radius:8px;padding:12px;text-align:center;">
                    <div style="font-size:1.5rem;font-weight:700;color:#F57F17;">${free.length}</div>
                    <div style="font-size:0.75rem;color:#666;">Free</div>
                </div>
                <div style="background:#FAFAFA;border-radius:8px;padding:12px;text-align:center;">
                    <div style="font-size:1.5rem;font-weight:700;color:#999;">${unsub.length}</div>
                    <div style="font-size:0.75rem;color:#666;">Unsubscribed</div>
                </div>
            </div>
            <div style="margin-top:0.75rem;font-size:0.78rem;color:#999;">
                <strong>Tier breakdown:</strong>
                ${paid.filter(s => s.tier === 'essential').length} Essential, 
                ${paid.filter(s => s.tier === 'standard').length} Standard, 
                ${paid.filter(s => s.tier === 'premium').length} Premium
            </div>
        `;
    }


    // ============================================
    // RENDER SUBSCRIBER LIST
    // ============================================

    function renderSubList() {
        const el = document.getElementById('nlSubList');
        if (!el) return;

        const active = subscribers.filter(s => s.status === 'active')
            .sort((a, b) => (b.date || '').localeCompare(a.date || ''));

        if (active.length === 0) {
            el.innerHTML = '<p class="adm-empty">No subscribers yet</p>';
            return;
        }

        const tierColors = {
            essential: '#1565C0',
            standard: '#F57F17',
            premium: '#9C27B0',
            free: '#999'
        };

        el.innerHTML = active.map(s => {
            const tierCol = tierColors[s.tier] || '#999';
            const tierLabel = s.tier === 'free' ? 'Free' : (s.tier.charAt(0).toUpperCase() + s.tier.slice(1));
            const dateStr = s.date ? new Date(s.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '';
            return `<div style="display:flex;align-items:center;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f0f0f0;font-size:0.82rem;">
                <div>
                    <div style="font-weight:600;color:#333;">${s.name || s.email}</div>
                    <div style="color:#999;font-size:0.75rem;">${s.email}</div>
                </div>
                <div style="text-align:right;">
                    <span style="display:inline-block;background:${tierCol};color:#fff;padding:2px 8px;border-radius:10px;font-size:0.7rem;font-weight:600;">${tierLabel}</span>
                    <div style="color:#bbb;font-size:0.7rem;margin-top:2px;">${dateStr}</div>
                </div>
            </div>`;
        }).join('');
    }


    // ============================================
    // RENDER NEWSLETTER HISTORY
    // ============================================

    function renderHistory() {
        const el = document.getElementById('nlHistory');
        if (!el) return;

        if (newsletters.length === 0) {
            el.innerHTML = '<p class="adm-empty">No newsletters sent yet</p>';
            return;
        }

        // Show most recent first
        const sorted = [...newsletters].reverse();

        el.innerHTML = sorted.map(n => {
            const dateStr = n.date ? new Date(n.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
            const targetLabel = n.target === 'all' ? 'All' : n.target.charAt(0).toUpperCase() + n.target.slice(1);
            return `<div style="padding:8px 0;border-bottom:1px solid #f0f0f0;">
                <div style="display:flex;justify-content:space-between;align-items:start;">
                    <div style="font-weight:600;font-size:0.85rem;color:#333;">${n.subject || 'Untitled'}</div>
                    <span style="font-size:0.72rem;color:#999;white-space:nowrap;margin-left:8px;">${dateStr}</span>
                </div>
                <div style="font-size:0.75rem;color:#888;margin-top:3px;">
                    <span style="color:#2E7D32;">✓ ${n.sent} sent</span>
                    ${n.failed > 0 ? `<span style="color:#c62828;margin-left:8px;">✗ ${n.failed} failed</span>` : ''}
                    <span style="margin-left:8px;">→ ${targetLabel}</span>
                </div>
            </div>`;
        }).join('');
    }


    // ============================================
    // COMPOSE & SEND NEWSLETTER
    // ============================================

    const composeForm = document.getElementById('nlComposeForm');
    if (composeForm) {
        composeForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const subject = document.getElementById('nlSubject').value.trim();
            const content = document.getElementById('nlContent').value.trim();
            const exclusive = document.getElementById('nlExclusive').value.trim();
            const target = document.getElementById('nlTarget').value;
            const sendBtn = document.getElementById('nlSendBtn');
            const msgEl = document.getElementById('nlSendMsg');

            if (!subject || !content) {
                msgEl.innerHTML = '<span style="color:#c62828;">Please fill in subject and content.</span>';
                return;
            }

            // Count how many will receive
            const active = subscribers.filter(s => s.status === 'active');
            let targetCount = 0;
            if (target === 'all') targetCount = active.length;
            else if (target === 'paid') targetCount = active.filter(s => s.tier !== 'free').length;
            else if (target === 'free') targetCount = active.filter(s => s.tier === 'free').length;
            else targetCount = active.filter(s => s.tier === target).length;

            if (!confirm(`Send this newsletter to ${targetCount} subscriber(s)?\n\nSubject: ${subject}\nTarget: ${target}`)) return;

            sendBtn.disabled = true;
            sendBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending...';
            msgEl.innerHTML = '';

            try {
                const resp = await fetch(SHEETS_WEBHOOK, {
                    method: 'POST',
                    headers: { 'Content-Type': 'text/plain' },
                    body: JSON.stringify({
                        action: 'send_newsletter',
                        subject: subject,
                        content: content,
                        exclusiveContent: exclusive,
                        targetTier: target,
                        headerImage: (document.getElementById('nlHeaderImage') || {}).value || ''
                    })
                });

                const data = await resp.json();
                if (data.status === 'success') {
                    msgEl.innerHTML = `<span style="color:#2E7D32;">✅ Newsletter sent! ${data.sent} delivered${data.failed > 0 ? ', ' + data.failed + ' failed' : ''}.</span>`;
                    composeForm.reset();
                    // Reload history
                    loadNewsletters();
                } else {
                    msgEl.innerHTML = `<span style="color:#c62828;">❌ ${data.message || 'Failed to send'}</span>`;
                }
            } catch (err) {
                msgEl.innerHTML = '<span style="color:#c62828;">❌ Network error. Please try again.</span>';
            }

            sendBtn.disabled = false;
            sendBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Send Newsletter';
        });
    }


    // ============================================
    // PREVIEW NEWSLETTER
    // ============================================

    const previewBtn = document.getElementById('nlPreviewBtn');
    const previewModal = document.getElementById('nlPreviewModal');
    const previewClose = document.getElementById('nlPreviewClose');
    const previewBody = document.getElementById('nlPreviewBody');

    if (previewBtn) {
        previewBtn.addEventListener('click', () => {
            const subject = document.getElementById('nlSubject').value.trim() || 'Newsletter Preview';
            const content = document.getElementById('nlContent').value.trim() || '<p>No content yet...</p>';
            const exclusive = document.getElementById('nlExclusive').value.trim();
            const headerImg = (document.getElementById('nlHeaderImage') || {}).value || '';

            const headerImgBlock = headerImg
                ? `<div style="width:100%;max-height:300px;overflow:hidden;">
                    <img src="${headerImg}" alt="Newsletter" style="width:100%;height:auto;display:block;">
                   </div>`
                : '';

            const exclusiveBlock = exclusive 
                ? `<div style="background:linear-gradient(135deg,#FFF8E1,#FFECB3);border:2px solid #FFD700;border-radius:8px;padding:20px;margin:20px 0;">
                    <h3 style="color:#F57F17;margin:0 0 10px;">⭐ Exclusive Subscriber Content</h3>
                    <div style="color:#555;line-height:1.8;font-size:14px;">${exclusive}</div>
                   </div>`
                : '';

            const html = `
                <div style="max-width:600px;margin:0 auto;background:#ffffff;">
                    <div style="background:linear-gradient(135deg,#2E7D32,#4CAF50);padding:30px;text-align:center;">
                        <h1 style="color:#fff;margin:0;font-size:22px;">🌿 Gardners Ground Maintenance</h1>
                        <p style="color:rgba(255,255,255,0.9);margin:6px 0 0;font-size:13px;">Newsletter</p>
                    </div>
                    ${headerImgBlock}
                    <div style="padding:30px;">
                        <h2 style="color:#2E7D32;margin:0 0 15px;">Hi [Subscriber Name]!</h2>
                        <div style="color:#333;line-height:1.8;font-size:15px;">${content}</div>
                        ${exclusiveBlock}
                        <div style="text-align:center;margin:25px 0;">
                            <a href="#" style="display:inline-block;background:#2E7D32;color:#fff;padding:12px 30px;border-radius:6px;text-decoration:none;font-weight:600;">Book a Service</a>
                        </div>
                    </div>
                    <div style="background:#333;padding:20px;text-align:center;">
                        <p style="color:#aaa;font-size:12px;margin:0 0 5px;">Gardners Ground Maintenance | Roche, Cornwall PL26 8HN</p>
                        <p style="color:#888;font-size:11px;margin:0 0 5px;">📞 01726 432051 | ✉️ info@gardnersgm.co.uk</p>
                        <a href="#" style="color:#888;font-size:11px;">Unsubscribe</a>
                    </div>
                </div>
            `;

            previewBody.innerHTML = html;
            previewModal.style.display = 'flex';
        });
    }

    if (previewClose) {
        previewClose.addEventListener('click', () => {
            previewModal.style.display = 'none';
        });
    }

    if (previewModal) {
        previewModal.addEventListener('click', (e) => {
            if (e.target === previewModal) previewModal.style.display = 'none';
        });
    }


    // ============================================
    // TEMPLATE QUICK-INSERT BUTTONS
    // ============================================

    // Add quick template buttons to the compose area (after content textarea)
    const contentTextarea = document.getElementById('nlContent');
    if (contentTextarea) {
        const templatesDiv = document.createElement('div');
        templatesDiv.style.cssText = 'display:flex;gap:0.5rem;flex-wrap:wrap;margin-top:0.5rem;margin-bottom:0.5rem;';
        templatesDiv.innerHTML = `
            <button type="button" class="nl-tpl-btn" data-tpl="seasonal" style="font-size:0.75rem;padding:4px 10px;border:1px solid #ddd;border-radius:6px;background:#fff;cursor:pointer;font-family:'Poppins',sans-serif;">🌸 Seasonal Tips</button>
            <button type="button" class="nl-tpl-btn" data-tpl="promo" style="font-size:0.75rem;padding:4px 10px;border:1px solid #ddd;border-radius:6px;background:#fff;cursor:pointer;font-family:'Poppins',sans-serif;">💰 Promotion</button>
            <button type="button" class="nl-tpl-btn" data-tpl="update" style="font-size:0.75rem;padding:4px 10px;border:1px solid #ddd;border-radius:6px;background:#fff;cursor:pointer;font-family:'Poppins',sans-serif;">📢 Company Update</button>
            <button type="button" class="nl-tpl-btn" data-tpl="guide" style="font-size:0.75rem;padding:4px 10px;border:1px solid #ddd;border-radius:6px;background:#fff;cursor:pointer;font-family:'Poppins',sans-serif;">📖 Garden Guide</button>
        `;
        contentTextarea.parentNode.insertBefore(templatesDiv, contentTextarea.nextSibling);

        const templates = {
            seasonal: `<h3>🌿 Seasonal Garden Care Tips</h3>
<p>With the season changing, here are our top tips to keep your garden looking fantastic:</p>
<ul>
<li><strong>Lawns:</strong> Now is the perfect time to...</li>
<li><strong>Hedges:</strong> Keep on top of growth by...</li>
<li><strong>Borders:</strong> Clear out and prepare for...</li>
</ul>
<p>Need a hand? We're here to help with all your garden maintenance needs.</p>`,
            promo: `<h3>🎉 Special Offer This Month!</h3>
<p>We're offering <strong>10% off</strong> all one-off bookings made before the end of the month.</p>
<p>Whether it's a garden clearance, hedge trim, or lawn treatment — now's the time to book!</p>
<p>Use code <strong>GARDEN10</strong> when booking online, or just mention this newsletter when you call.</p>`,
            update: `<h3>📢 News from Gardners Ground Maintenance</h3>
<p>We've had a busy month! Here's what's been happening:</p>
<ul>
<li>New equipment upgrades for better results</li>
<li>Expanded service area across Cornwall</li>
<li>New subscription plans available</li>
</ul>
<p>Thank you for your continued support — we love looking after your gardens!</p>`,
            guide: `<h3>📖 Garden Maintenance Guide</h3>
<p>This month's focus: <strong>[Topic]</strong></p>
<p><strong>Step 1:</strong> Start by...</p>
<p><strong>Step 2:</strong> Next, you'll want to...</p>
<p><strong>Step 3:</strong> Finally, maintain by...</p>
<p><strong>Pro tip:</strong> For the best results, consider...</p>
<p>Need professional help? Book a service and let us handle the hard work!</p>`
        };

        templatesDiv.querySelectorAll('.nl-tpl-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const tpl = templates[btn.dataset.tpl];
                if (tpl) {
                    contentTextarea.value = tpl;
                    contentTextarea.focus();
                }
            });
        });
    }


    // ============================================
    // INIT
    // ============================================

    // Load data when Newsletter tab is shown
    const tabBtns = document.querySelectorAll('[data-admin-tab]');
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            if (btn.dataset.adminTab === 'panelNewsletter') {
                loadSubscribers();
                loadNewsletters();
            }
        });
    });

    // Also load if we arrive at the page with #newsletter hash
    if (window.location.hash === '#newsletter') {
        loadSubscribers();
        loadNewsletters();
    }
});
