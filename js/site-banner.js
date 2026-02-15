/* ============================================
   GGM Site Banner — Scrolling Announcement System
   ============================================
   Fetches active banners from GAS every 60s.
   Renders a scrolling marquee bar at the top of every page.
   Types: info (blue), warning (amber), error (red),
          maintenance (orange), payment (purple), booking (teal)
   ============================================ */

(function () {
    'use strict';

    const GAS_URL = 'https://script.google.com/macros/s/AKfycbyjUkYuFrpigXi6chj1B4z-xjHsgnnmkcQ_SejJwdqbstbAq-QooLz9G1sQpfl3vGGufQ/exec';
    const POLL_INTERVAL = 60000; // 60 seconds
    const CACHE_KEY = 'ggm_banners';
    const CACHE_TTL = 55000; // 55s cache (always slightly less than poll)

    // Type → colour config
    const TYPE_STYLES = {
        info:        { bg: '#1a73e8', icon: 'ℹ️' },
        warning:     { bg: '#f59e0b', icon: '⚠️' },
        error:       { bg: '#dc2626', icon: '🔴' },
        maintenance: { bg: '#ea580c', icon: '🔧' },
        payment:     { bg: '#7c3aed', icon: '💳' },
        booking:     { bg: '#0d9488', icon: '📅' },
    };

    let bannerContainer = null;
    let lastBannerHash = '';

    // ── Create the banner DOM ──
    function createBannerContainer() {
        if (document.getElementById('ggm-site-banner')) {
            bannerContainer = document.getElementById('ggm-site-banner');
            return;
        }

        bannerContainer = document.createElement('div');
        bannerContainer.id = 'ggm-site-banner';
        bannerContainer.setAttribute('role', 'alert');
        bannerContainer.setAttribute('aria-live', 'polite');

        // Insert before everything else in the body
        document.body.insertBefore(bannerContainer, document.body.firstChild);
    }

    // ── Render banners ──
    function renderBanners(banners) {
        if (!bannerContainer) createBannerContainer();

        // Quick hash to avoid unnecessary DOM thrashing
        const hash = JSON.stringify(banners.map(b => b.ID + b.Message));
        if (hash === lastBannerHash) return;
        lastBannerHash = hash;

        if (!banners.length) {
            bannerContainer.style.display = 'none';
            bannerContainer.innerHTML = '';
            document.body.classList.remove('has-site-banner');
            return;
        }

        // Use highest priority banner's type for the bar colour
        const primary = banners[0];
        const style = TYPE_STYLES[primary.Type] || TYPE_STYLES.info;

        // Build scrolling content — all messages joined
        const messages = banners.map(b => {
            const s = TYPE_STYLES[b.Type] || TYPE_STYLES.info;
            let text = s.icon + '  ' + b.Message;
            if (b.Link && b.LinkText) {
                text += '  <a href="' + escapeHtml(b.Link) + '" class="ggm-banner-link">' + escapeHtml(b.LinkText) + '</a>';
            }
            return text;
        });

        // Duplicate messages for seamless loop
        const scrollContent = messages.join('    ·    ');

        bannerContainer.style.display = 'block';
        bannerContainer.style.background = style.bg;
        bannerContainer.innerHTML = `
            <div class="ggm-banner-track">
                <div class="ggm-banner-scroll">
                    <span class="ggm-banner-text">${scrollContent}</span>
                    <span class="ggm-banner-text">${scrollContent}</span>
                </div>
            </div>
            <button class="ggm-banner-close" aria-label="Dismiss banner" title="Dismiss">&times;</button>
        `;

        // Adjust speed based on content length
        const textLen = messages.join('').length;
        const duration = Math.max(15, Math.min(60, textLen * 0.3));
        const scrollEl = bannerContainer.querySelector('.ggm-banner-scroll');
        if (scrollEl) scrollEl.style.animationDuration = duration + 's';

        // Close button
        const closeBtn = bannerContainer.querySelector('.ggm-banner-close');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                bannerContainer.style.display = 'none';
                document.body.classList.remove('has-site-banner');
                // Don't poll again for 5 minutes after manual dismiss
                sessionStorage.setItem('ggm_banner_dismissed', Date.now().toString());
            });
        }

        document.body.classList.add('has-site-banner');
    }

    // ── Fetch banners ──
    async function fetchBanners() {
        // Respect manual dismiss for 5 minutes
        const dismissed = sessionStorage.getItem('ggm_banner_dismissed');
        if (dismissed && Date.now() - parseInt(dismissed) < 300000) return;

        try {
            // Check cache first
            const cached = sessionStorage.getItem(CACHE_KEY);
            if (cached) {
                const { data, ts } = JSON.parse(cached);
                if (Date.now() - ts < CACHE_TTL) {
                    renderBanners(data);
                    return;
                }
            }

            const resp = await fetch(GAS_URL + '?action=get_site_banners', {
                method: 'GET',
                cache: 'no-store',
            });
            const json = await resp.json();
            if (json.status === 'success' && Array.isArray(json.banners)) {
                // Cache the result
                sessionStorage.setItem(CACHE_KEY, JSON.stringify({
                    data: json.banners,
                    ts: Date.now(),
                }));
                renderBanners(json.banners);
            }
        } catch (err) {
            // Silently fail — don't break the website if banner fetch fails
            console.log('[Banner] Fetch failed:', err.message);
        }
    }

    // ── Escape HTML ──
    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    // ── Initialise ──
    function init() {
        createBannerContainer();
        fetchBanners();
        setInterval(fetchBanners, POLL_INTERVAL);
    }

    // Run on DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
