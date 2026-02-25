/* ============================================
   Gardners Ground Maintenance — Main JavaScript
   Handles: navigation, scroll effects, animations
   ============================================ */

/* ── MAINTENANCE MODE ── Set to false to remove the overlay ── */
const MAINTENANCE_MODE = true;

if (MAINTENANCE_MODE) {
    // Skip overlay on admin/internal pages
    const page = window.location.pathname.split('/').pop() || '';
    const adminPages = ['admin.html','manager.html','invoice.html','invoices.html',
        'profitability.html','blog-editor.html','finance.html','cancel.html',
        'payment-complete.html','my-account.html','quote-response.html'];
    if (!adminPages.includes(page)) {
        document.documentElement.innerHTML = `
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Under Construction — Gardners Ground Maintenance</title>
            <link rel="icon" type="image/svg+xml" href="/images/favicon.svg">
            <style>
                * { margin:0; padding:0; box-sizing:border-box; }
                body { min-height:100vh; display:flex; align-items:center; justify-content:center;
                    background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
                    font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; color:#e0e0e0; }
                .maintenance { text-align:center; padding:3rem 2rem; max-width:600px; }
                .maintenance h1 { font-size:2.5rem; color:#52b788; margin-bottom:0.5rem; }
                .maintenance .icon { font-size:4rem; margin-bottom:1.5rem; }
                .maintenance p { font-size:1.15rem; line-height:1.7; color:#a0b0c0; margin-bottom:1rem; }
                .maintenance .highlight { color:#52b788; font-weight:600; }
                .maintenance .contact { margin-top:2rem; padding:1.5rem; background:rgba(255,255,255,0.05);
                    border-radius:12px; border:1px solid rgba(82,183,136,0.2); }
                .maintenance .contact a { color:#52b788; text-decoration:none; }
                .maintenance .contact a:hover { text-decoration:underline; }
                .maintenance .badge { display:inline-block; margin-top:1.5rem; padding:0.4rem 1rem;
                    background:rgba(82,183,136,0.15); border:1px solid rgba(82,183,136,0.3);
                    border-radius:20px; font-size:0.85rem; color:#52b788; }
            </style>
        </head>
        <body>
            <div class="maintenance">
                <img src="/images/favicon.svg" alt="Gardners GM" style="width:80px;height:80px;margin-bottom:1.5rem;">
                <h1>We're Sprucing Things Up</h1>
                <p>Our website is currently <span class="highlight">under construction</span> as we make some exciting improvements.</p>
                <p>We'll be back soon with a fresh new look — just like a freshly cut lawn!</p>
                <div class="badge">Gardners Ground Maintenance — Cornwall</div>
            </div>
        </body>`;
    }
}

document.addEventListener('DOMContentLoaded', () => {

    // --- Mobile Navigation Toggle ---
    const hamburger = document.querySelector('.hamburger');
    const navLinks = document.querySelector('.nav-links');

    if (hamburger && navLinks) {
        hamburger.addEventListener('click', () => {
            hamburger.classList.toggle('active');
            navLinks.classList.toggle('open');
            document.body.style.overflow = navLinks.classList.contains('open') ? 'hidden' : '';
        });

        // Close menu when clicking a link
        navLinks.querySelectorAll('a').forEach(link => {
            link.addEventListener('click', () => {
                hamburger.classList.remove('active');
                navLinks.classList.remove('open');
                document.body.style.overflow = '';
            });
        });
    }

    // --- Active Nav Link ---
    const currentPage = window.location.pathname.split('/').pop() || 'index.html';
    document.querySelectorAll('.nav-links a:not(.nav-cta)').forEach(link => {
        const href = link.getAttribute('href');
        if (href === currentPage || (currentPage === '' && href === 'index.html')) {
            link.classList.add('active');
        }
    });

    // --- Header Scroll Effect ---
    const header = document.querySelector('.header');
    let lastScroll = 0;

    window.addEventListener('scroll', () => {
        const currentScroll = window.pageYOffset;

        if (currentScroll > 50) {
            header.style.boxShadow = '0 2px 20px rgba(0,0,0,0.12)';
        } else {
            header.style.boxShadow = '0 1px 10px rgba(0,0,0,0.08)';
        }

        lastScroll = currentScroll;
    });

    // --- Fade In Animations on Scroll ---
    const fadeElements = document.querySelectorAll('.fade-in');

    if (fadeElements.length > 0) {
        const observerOptions = {
            threshold: 0.01,
            rootMargin: '0px 0px -20px 0px'
        };

        const fadeObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('visible');
                    fadeObserver.unobserve(entry.target);
                }
            });
        }, observerOptions);

        fadeElements.forEach(el => fadeObserver.observe(el));
    }

    // --- Smooth Scroll for anchor links ---
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            const targetId = this.getAttribute('href');
            if (targetId === '#') return;

            const target = document.querySelector(targetId);
            if (target) {
                e.preventDefault();
                target.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start'
                });
            }
        });
    });

    // --- Counter Animation for Stats ---
    const statNumbers = document.querySelectorAll('.stat-number');
    if (statNumbers.length > 0) {
        const counterObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    // Skip elements without data-target (they show static text)
                    if (!entry.target.hasAttribute('data-target')) {
                        counterObserver.unobserve(entry.target);
                        return;
                    }
                    const target = parseInt(entry.target.getAttribute('data-target'));
                    const suffix = entry.target.getAttribute('data-suffix') || '';
                    animateCounter(entry.target, target, suffix);
                    counterObserver.unobserve(entry.target);
                }
            });
        }, { threshold: 0.5 });

        statNumbers.forEach(el => counterObserver.observe(el));
    }

    function animateCounter(element, target, suffix) {
        let current = 0;
        const increment = target / 60;
        const timer = setInterval(() => {
            current += increment;
            if (current >= target) {
                current = target;
                clearInterval(timer);
            }
            element.textContent = Math.floor(current) + suffix;
        }, 25);
    }

});
