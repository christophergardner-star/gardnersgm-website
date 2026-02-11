/* ===========================================
   BLOG — Public Blog Page
   Gardners Ground Maintenance
   =========================================== */

(function () {
    'use strict';

    const WEBHOOK = 'https://script.google.com/macros/s/AKfycbw1dGK6yNaNO19aetav9Ngq9aqFFUzJfwfG-2y06tFcuqVJe35CCGY0DQrDpoF-vsX-Pg/exec';

    const blogGrid = document.getElementById('blogGrid');
    const blogLoading = document.getElementById('blogLoading');
    const blogEmpty = document.getElementById('blogEmpty');
    const blogModal = document.getElementById('blogModal');

    let allPosts = [];
    let activeCategory = 'all';

    // ─── Load posts on page load ───
    loadPosts();

    // ─── Category filter buttons ───
    document.querySelectorAll('.blog-filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelector('.blog-filter-btn.active').classList.remove('active');
            btn.classList.add('active');
            activeCategory = btn.dataset.cat;
            renderPosts();
        });
    });

    // ─── Modal close ───
    document.getElementById('blogModalClose').addEventListener('click', closeModal);
    blogModal.addEventListener('click', (e) => {
        if (e.target === blogModal) closeModal();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeModal();
    });

    // ─── Load social links from localStorage ───
    const socialLinks = JSON.parse(localStorage.getItem('ggm_social_links') || '{}');
    const socialFb = document.getElementById('socialFb');
    const socialIg = document.getElementById('socialIg');
    const socialX  = document.getElementById('socialX');
    if (socialFb && socialLinks.facebook) socialFb.href = socialLinks.facebook;
    if (socialIg && socialLinks.instagram) socialIg.href = socialLinks.instagram;
    if (socialX  && socialLinks.twitter) socialX.href = socialLinks.twitter;

    // ─── Fetch published posts from Google Sheets ───
    async function loadPosts() {
        try {
            const resp = await fetch(`${WEBHOOK}?action=get_blog_posts`);
            const data = await resp.json();

            blogLoading.style.display = 'none';

            if (data.posts && data.posts.length > 0) {
                allPosts = data.posts.sort((a, b) => new Date(b.date) - new Date(a.date));
                renderPosts();
            } else {
                blogEmpty.style.display = 'block';
            }
        } catch (err) {
            blogLoading.innerHTML = '<i class="fas fa-exclamation-circle"></i><p>Unable to load posts. Please try again later.</p>';
        }
    }

    // ─── Render post cards (all posts, stacked by date) ───
    function renderPosts() {
        const filtered = activeCategory === 'all'
            ? allPosts
            : allPosts.filter(p => p.category === activeCategory);

        if (filtered.length === 0) {
            blogGrid.innerHTML = '<div class="blog-empty-filter"><i class="fas fa-filter"></i><p>No posts in this category yet.</p></div>';
            return;
        }

        blogGrid.innerHTML = filtered.map(post => {
            const catInfo = categoryInfo(post.category);
            const tags = post.tags ? post.tags.split(',').slice(0, 3).map(t => t.trim()) : [];
            const imgHtml = post.imageUrl
                ? `<div class="blog-stack-img" style="background-image:url('${escapeHtml(post.imageUrl)}')"></div>`
                : '';
            return `
            <article class="blog-stack-card fade-in" data-id="${post.id}">
                ${imgHtml}
                <div class="blog-stack-body">
                    <div class="blog-card-top">
                        <span class="blog-tag blog-tag-${post.category}">${catInfo.icon} ${catInfo.label}</span>
                        <span class="blog-card-date"><i class="fas fa-calendar"></i> ${formatDate(post.date)}</span>
                    </div>
                    <h2 class="blog-stack-title">${escapeHtml(post.title)}</h2>
                    <p class="blog-stack-excerpt">${escapeHtml(post.excerpt || post.content.substring(0, 200) + '...')}</p>
                    <div class="blog-card-bottom">
                        <span class="blog-card-meta"><i class="fas fa-clock"></i> ${readTime(post.content)} min read</span>
                        <span class="blog-card-meta"><i class="fas fa-user"></i> ${escapeHtml(post.author || 'Gardners GM')}</span>
                    </div>
                    ${tags.length ? `<div class="blog-card-tags">${tags.map(t => `<span class="blog-card-tag">#${t}</span>`).join('')}</div>` : ''}
                    <button class="btn btn-primary blog-read-btn" style="margin-top:0.75rem;align-self:flex-start;">Read More</button>
                </div>
            </article>`;
        }).join('');

        // Click handlers
        blogGrid.querySelectorAll('.blog-stack-card').forEach(card => {
            card.addEventListener('click', () => openPost(card.dataset.id));
            // Trigger fade-in visibility
            requestAnimationFrame(() => card.classList.add('visible'));
        });
    }

    // ─── Open post in modal ───
    window.openPost = function (id) {
        const post = allPosts.find(p => String(p.id) === String(id));
        if (!post) return;

        // Modal hero image
        const modalHero = document.getElementById('modalHero');
        if (post.imageUrl) {
            modalHero.style.backgroundImage = 'url(' + post.imageUrl + ')';
            modalHero.style.display = 'block';
        } else {
            modalHero.style.display = 'none';
        }

        document.getElementById('modalTitle').textContent = post.title;
        document.getElementById('modalDate').textContent = formatDate(post.date);
        document.getElementById('modalRead').textContent = readTime(post.content);
        document.getElementById('modalAuthor').textContent = post.author || 'Gardners GM';

        const catInfo = categoryInfo(post.category);
        const tags = post.tags ? post.tags.split(',').map(t => t.trim()) : [];
        document.getElementById('modalTags').innerHTML =
            `<span class="blog-tag blog-tag-${post.category}">${catInfo.icon} ${catInfo.label}</span>` +
            tags.map(t => `<span class="blog-modal-tag">#${t}</span>`).join('');

        // Render content with basic markdown
        document.getElementById('modalBody').innerHTML = renderMarkdown(post.content);

        // Share buttons
        document.querySelectorAll('.blog-share-btn').forEach(btn => {
            btn.onclick = () => sharePost(btn.dataset.platform, post);
        });

        blogModal.style.display = 'flex';
        document.body.style.overflow = 'hidden';
    };

    function closeModal() {
        blogModal.style.display = 'none';
        document.body.style.overflow = '';
    }

    function sharePost(platform, post) {
        const url = encodeURIComponent(window.location.href);
        const text = encodeURIComponent(post.title + ' — Gardners Ground Maintenance');
        if (platform === 'facebook') {
            window.open(`https://www.facebook.com/sharer/sharer.php?u=${url}`, '_blank');
        } else if (platform === 'twitter') {
            window.open(`https://twitter.com/intent/tweet?text=${text}&url=${url}`, '_blank');
        } else if (platform === 'copy') {
            navigator.clipboard.writeText(window.location.href).then(() => {
                alert('Link copied to clipboard!');
            });
        }
    }

    // ─── Helpers ───
    function formatDate(dateStr) {
        try {
            const d = new Date(dateStr);
            return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
        } catch { return dateStr; }
    }

    function readTime(text) {
        return Math.max(1, Math.ceil((text || '').split(/\s+/).length / 200));
    }

    function categoryInfo(cat) {
        const map = {
            seasonal: { icon: '<i class="fas fa-sun"></i>', label: 'Seasonal' },
            tips: { icon: '<i class="fas fa-lightbulb"></i>', label: 'Tips & Advice' },
            projects: { icon: '<i class="fas fa-images"></i>', label: 'Projects' },
            news: { icon: '<i class="fas fa-newspaper"></i>', label: 'News' }
        };
        return map[cat] || map.tips;
    }

    function renderMarkdown(text) {
        if (!text) return '';
        
        // Sanitise any hallucinated contact details from AI
        text = text
            .replace(/\b0\d{3,4}\s?\d{3}\s?\d{3,4}\b/g, '01726 432051')
            .replace(/info@gardners?ground(maintenance|maint)\.co\.uk/gi, 'info@gardnersgm.co.uk')
            .replace(/contact@gardners?ground(maintenance|maint)\.co\.uk/gi, 'info@gardnersgm.co.uk')
            .replace(/hello@gardners?ground(maintenance|maint)\.co\.uk/gi, 'info@gardnersgm.co.uk')
            .replace(/gardnersgroundmaintenance\.co\.uk/gi, 'gardnersgm.co.uk');

        // Extract markdown links before HTML escaping
        var links = [];
        text = text.replace(/\[([^\]]+)\]\(([^\)]+)\)/g, function(m, label, url) {
            var idx = links.length;
            links.push({ label: label, url: url });
            return '%%LINK' + idx + '%%';
        });

        text = text
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/^### (.+)$/gm, '<h4>$1</h4>')
            .replace(/^## (.+)$/gm, '<h3>$1</h3>')
            .replace(/^# (.+)$/gm, '<h2>$1</h2>')
            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.+?)\*/g, '<em>$1</em>')
            .replace(/^- (.+)$/gm, '<li>$1</li>')
            .replace(/(<li>.*<\/li>)/gs, '<ul>$1</ul>')
            .replace(/\n{2,}/g, '</p><p>')
            .replace(/\n/g, '<br>')
            .replace(/^/, '<p>')
            .replace(/$/, '</p>');

        // Restore links as proper anchor tags
        links.forEach(function(lk, i) {
            var href = lk.url.replace(/&amp;/g, '&');
            text = text.replace('%%LINK' + i + '%%', '<a href="' + href + '" style="color:var(--primary);font-weight:600;">' + lk.label + '</a>');
        });

        return text;
    }

    function escapeHtml(str) {
        const d = document.createElement('div');
        d.textContent = str || '';
        return d.innerHTML;
    }

})();
