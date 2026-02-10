/* ============================================
   Gardners GM — Admin Sidebar Navigation
   Shared across all admin pages.
   Drop-in: just include this script on any admin page.
   ============================================ */

(function() {
    'use strict';

    const NAV_ITEMS = [
        { id: 'dispatch',  icon: 'fa-route',          label: 'Daily Dispatch', href: 'today.html' },
        { id: 'dashboard', icon: 'fa-tachometer-alt', label: 'Dashboard',    href: 'admin.html' },
        { id: 'clients',   icon: 'fa-address-book',   label: 'Clients',      href: 'manager.html' },
        { id: 'jobs',      icon: 'fa-clipboard-list',  label: 'Jobs',         href: 'jobs.html' },
        { id: 'invoices',  icon: 'fa-file-invoice-dollar', label: 'Invoices', href: 'invoice.html' },
        { id: 'payments',  icon: 'fa-credit-card',    label: 'Payments',     href: 'admin.html#payments' },
        { id: 'newsletter', icon: 'fa-newspaper',     label: 'Newsletter',   href: 'admin.html#newsletter' },
        { id: 'profit',    icon: 'fa-chart-pie',      label: 'Profitability', href: 'profitability.html' },
        { id: 'finance',   icon: 'fa-chart-line',     label: 'Finance',      href: 'finance.html' },
        { id: 'blog',      icon: 'fa-pen-fancy',      label: 'Blog',         href: 'blog-editor.html' },
        { id: 'telegram',  icon: 'fa-paper-plane',    label: 'Telegram',     href: 'admin.html#telegram' },
    ];

    // Detect which page we're on
    const currentPage = window.location.pathname.split('/').pop() || 'admin.html';
    const currentHash = window.location.hash;

    function getActiveId() {
        if (currentHash === '#payments') return 'payments';
        if (currentHash === '#telegram') return 'telegram';
        if (currentHash === '#newsletter') return 'newsletter';
        for (const item of NAV_ITEMS) {
            if (item.href.split('#')[0] === currentPage && !item.href.includes('#')) return item.id;
        }
        return 'dashboard';
    }

    function buildSidebar() {
        const activeId = getActiveId();
        const isCollapsed = localStorage.getItem('adm-sidebar-collapsed') === 'true';

        // Sidebar element
        const sidebar = document.createElement('aside');
        sidebar.className = 'adm-sidebar' + (isCollapsed ? ' collapsed' : '');
        sidebar.innerHTML = `
            <div class="adm-sidebar-header">
                <a href="index.html" class="adm-sidebar-logo">
                    <i class="fas fa-leaf"></i>
                    <span>Gardners GM</span>
                </a>
                <button class="adm-sidebar-close" id="admSidebarClose"><i class="fas fa-times"></i></button>
            </div>
            <nav class="adm-sidebar-nav">
                ${NAV_ITEMS.map(item => `
                    <a href="${item.href}" class="adm-nav-item${item.id === activeId ? ' active' : ''}" data-nav="${item.id}" data-tooltip="${item.label}">
                        <i class="fas ${item.icon}"></i>
                        <span>${item.label}</span>
                    </a>
                `).join('')}
            </nav>
            <div class="adm-sidebar-footer">
                <button class="adm-collapse-btn" id="admCollapseBtn" title="Collapse sidebar">
                    <i class="fas fa-chevron-left"></i>
                    <span>Collapse</span>
                </button>
                <div class="adm-sidebar-user">
                    <i class="fas fa-user-circle"></i>
                    <div>
                        <strong>Admin</strong>
                        <small>Gardners GM</small>
                    </div>
                </div>
                <a href="index.html" class="adm-nav-item adm-nav-exit" data-tooltip="View Website">
                    <i class="fas fa-external-link-alt"></i>
                    <span>View Website</span>
                </a>
            </div>
        `;

        // Overlay for mobile
        const overlay = document.createElement('div');
        overlay.className = 'adm-sidebar-overlay';
        overlay.id = 'admOverlay';

        // Top bar for mobile toggle
        const topbar = document.createElement('header');
        topbar.className = 'adm-topbar';
        topbar.innerHTML = `
            <button class="adm-topbar-toggle" id="admSidebarOpen"><i class="fas fa-bars"></i></button>
            <span class="adm-topbar-title">${getPageTitle(activeId)}</span>
            <a href="index.html" class="adm-topbar-site" title="View Website"><i class="fas fa-external-link-alt"></i></a>
        `;

        // Insert
        document.body.classList.add('adm-layout');
        document.body.prepend(sidebar);
        document.body.prepend(overlay);
        document.body.prepend(topbar);

        // Wrap existing content in .adm-main
        const existingHeader = document.querySelector('header.header');
        if (existingHeader) existingHeader.remove(); // Remove old headers

        // Find the main section/content
        const mainContent = document.querySelector('section') || document.querySelector('.container');
        if (mainContent) {
            const wrapper = document.createElement('main');
            wrapper.className = 'adm-main';
            mainContent.parentNode.insertBefore(wrapper, mainContent);
            // Move all remaining sections into wrapper
            const sections = document.querySelectorAll('body > section, body > .container');
            sections.forEach(s => wrapper.appendChild(s));
        }

        // Toggle handlers
        document.getElementById('admSidebarOpen').addEventListener('click', () => {
            sidebar.classList.add('open');
            overlay.classList.add('open');
        });

        document.getElementById('admSidebarClose').addEventListener('click', closeSidebar);
        overlay.addEventListener('click', closeSidebar);

        function closeSidebar() {
            sidebar.classList.remove('open');
            overlay.classList.remove('open');
        }

        // Collapse / Expand toggle (desktop)
        document.getElementById('admCollapseBtn').addEventListener('click', () => {
            sidebar.classList.toggle('collapsed');
            const collapsed = sidebar.classList.contains('collapsed');
            localStorage.setItem('adm-sidebar-collapsed', collapsed);
            // Update main margin via sibling selector or explicit set
            const main = document.querySelector('.adm-main');
            if (main) {
                main.style.marginLeft = collapsed ? '60px' : '240px';
            }
        });

        // Apply correct margin on load if collapsed
        if (isCollapsed) {
            const main = document.querySelector('.adm-main');
            if (main && window.innerWidth > 900) main.style.marginLeft = '60px';
        }

        // Keyboard shortcut: Escape closes sidebar
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') closeSidebar();
        });
    }

    function getPageTitle(id) {
        const item = NAV_ITEMS.find(n => n.id === id);
        return item ? item.label : 'Dashboard';
    }

    // Build on DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', buildSidebar);
    } else {
        buildSidebar();
    }

})();
