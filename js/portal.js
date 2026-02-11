/* ============================================
   Customer Portal JS — js/portal.js
   Magic link auth + account management
   ============================================ */
(function () {
    'use strict';

    const WEBHOOK = 'https://script.google.com/macros/s/AKfycbz2njLqF9oS8SclrBbtQCgKBBC77gLdzi-I9-YaCmXCc_2upPjdYn_epQj2ASsnpAfXvg/exec';

    // ─── helpers ───
    const $ = id => document.getElementById(id);
    const gbp = n => '£' + Number(n || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    // ─── Session ───
    function getSession() {
        try {
            const s = JSON.parse(localStorage.getItem('ggm_session') || 'null');
            if (s && new Date(s.expiresAt) > new Date()) return s;
        } catch (e) {}
        localStorage.removeItem('ggm_session');
        return null;
    }
    function setSession(data) {
        localStorage.setItem('ggm_session', JSON.stringify(data));
    }
    function clearSession() {
        localStorage.removeItem('ggm_session');
    }

    // ─── Show/hide views ───
    function showLogin() {
        $('loginView').style.display = '';
        $('portalView').style.display = 'none';
    }
    function showPortal() {
        $('loginView').style.display = 'none';
        $('portalView').style.display = '';
    }

    function showMsg(id, text, type) {
        const el = $(id);
        if (!el) return;
        el.textContent = text;
        el.className = 'portal-msg portal-msg-' + type;
        el.style.display = '';
    }
    function hideMsg(id) {
        const el = $(id);
        if (el) el.style.display = 'none';
    }

    // ─── Date formatting ───
    function fmtDate(iso) {
        if (!iso) return '—';
        const d = new Date(iso);
        return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
    }

    // ───────────────────────────────────
    //  INIT
    // ───────────────────────────────────
    document.addEventListener('DOMContentLoaded', function () {
        // Check for magic link token in URL
        const params = new URLSearchParams(window.location.search);
        const token = params.get('token');
        const email = params.get('email');

        if (token && email) {
            verifyMagicLink(token, email);
            return;
        }

        // Check existing session
        const session = getSession();
        if (session) {
            loadPortal(session);
        } else {
            showLogin();
        }

        wireEvents();
    });

    // ───────────────────────────────────
    //  MAGIC LINK VERIFY
    // ───────────────────────────────────
    async function verifyMagicLink(token, email) {
        $('loginView').style.display = '';
        showMsg('loginMsg', 'Verifying your login link...', 'info');

        try {
            const res = await fetch(WEBHOOK, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain' },
                body: JSON.stringify({ action: 'verify_login_token', token: token, email: email })
            }).then(r => r.json());

            if (res.status === 'success') {
                setSession({
                    sessionToken: res.sessionToken,
                    email: res.email,
                    expiresAt: res.expiresAt
                });
                // Clean URL
                window.history.replaceState({}, '', 'my-account.html');
                loadPortal(getSession());
            } else {
                showMsg('loginMsg', res.message || 'Login failed. Please request a new link.', 'error');
            }
        } catch (err) {
            showMsg('loginMsg', 'Something went wrong. Please try again.', 'error');
        }
    }

    // ───────────────────────────────────
    //  REQUEST LOGIN LINK
    // ───────────────────────────────────
    function wireEvents() {
        // Login form
        $('loginForm').addEventListener('submit', async function (e) {
            e.preventDefault();
            const email = $('loginEmail').value.trim().toLowerCase();
            if (!email) return;

            const btn = $('loginBtn');
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending...';
            hideMsg('loginMsg');

            try {
                const res = await fetch(WEBHOOK, {
                    method: 'POST',
                    headers: { 'Content-Type': 'text/plain' },
                    body: JSON.stringify({ action: 'request_login_link', email: email })
                }).then(r => r.json());

                showMsg('loginMsg', 'Check your email! We\'ve sent a secure login link to ' + email + '. It expires in 30 minutes.', 'success');
            } catch (err) {
                showMsg('loginMsg', 'Could not send login link. Please try again.', 'error');
            }

            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-paper-plane"></i> Send Login Link';
        });

        // Logout
        $('logoutBtn').addEventListener('click', function () {
            clearSession();
            showLogin();
        });

        // Tabs
        document.querySelectorAll('.portal-tab').forEach(function (tab) {
            tab.addEventListener('click', function () {
                document.querySelectorAll('.portal-tab').forEach(t => t.classList.remove('active'));
                this.classList.add('active');
                const target = this.dataset.tab;
                ['overview', 'bookings', 'subscription', 'preferences', 'profile', 'account'].forEach(function (t) {
                    var panel = $('tab-' + t);
                    if (panel) panel.style.display = t === target ? '' : 'none';
                });
            });
        });

        // Save preferences
        $('savePrefBtn').addEventListener('click', savePreferences);

        // Save profile
        $('saveProfileBtn').addEventListener('click', saveProfile);

        // Cancel subscription
        $('cancelSubBtn').addEventListener('click', async function () {
            var reason = $('cancelReason').value || 'No reason given';
            if (!confirm('Are you sure you want to cancel your subscription? This cannot be undone and all future visits will be removed.')) return;

            var session = getSession();
            if (!session) { showLogin(); return; }

            var btn = $('cancelSubBtn');
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Cancelling...';
            hideMsg('cancelSubMsg');

            try {
                var subRow = btn.dataset.rowIndex;
                var res = await fetch(WEBHOOK, {
                    method: 'POST',
                    headers: { 'Content-Type': 'text/plain' },
                    body: JSON.stringify({
                        action: 'cancel_subscription',
                        sessionToken: session.sessionToken,
                        rowIndex: parseInt(subRow),
                        reason: reason
                    })
                }).then(function (r) { return r.json(); });

                if (res.status === 'success') {
                    showMsg('cancelSubMsg', 'Your subscription has been cancelled. You will receive a confirmation email shortly.', 'success');
                    // Refresh the portal data
                    setTimeout(function () { loadPortal(getSession()); }, 2000);
                } else {
                    showMsg('cancelSubMsg', res.message || 'Could not cancel. Please call us on 01726 432051.', 'error');
                }
            } catch (err) {
                showMsg('cancelSubMsg', 'Something went wrong. Please call us on 01726 432051 to cancel.', 'error');
            }

            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-ban"></i> Cancel My Subscription';
        });

        // Delete account
        $('deleteAccountBtn').addEventListener('click', function () {
            $('deleteModal').style.display = '';
        });
        $('deleteCancelBtn').addEventListener('click', function () {
            $('deleteModal').style.display = 'none';
            $('deleteConfirm').value = '';
        });
        $('deleteConfirmBtn').addEventListener('click', deleteAccount);
    }

    // ───────────────────────────────────
    //  LOAD PORTAL DATA
    // ───────────────────────────────────
    async function loadPortal(session) {
        showPortal();

        try {
            const res = await fetch(WEBHOOK + '?action=get_customer_portal&session=' + encodeURIComponent(session.sessionToken))
                .then(r => r.json());

            if (res.status === 'auth_required') {
                clearSession();
                showLogin();
                showMsg('loginMsg', 'Your session has expired. Please log in again.', 'info');
                return;
            }

            if (res.status !== 'success') throw new Error(res.message);

            renderPortal(res);
        } catch (err) {
            console.error('Portal load error:', err);
            showMsg('loginMsg', 'Could not load account data.', 'error');
        }
    }

    function renderPortal(data) {
        var p = data.profile || {};
        var upcoming = data.upcomingVisits || [];
        var bookings = data.bookings || [];
        var prefs = data.preferences || {};
        var nl = data.newsletter || {};

        // Header
        $('portalName').textContent = p.name || 'Customer';
        $('portalEmail').textContent = p.email || '';

        // Overview cards
        $('ovUpcoming').textContent = upcoming.length;
        $('ovBookings').textContent = bookings.length;
        $('ovNewsletter').textContent = nl.subscribed ? 'Subscribed' : 'Not subscribed';

        // Next visit
        if (upcoming.length > 0) {
            var next = upcoming[0];
            $('nextVisitCard').style.display = '';
            $('nextDate').textContent = fmtDate(next.date);
            $('nextService').textContent = next.service || next.package || '';
            $('nextStatus').textContent = next.status || 'Scheduled';
        }

        // Bookings tab
        renderBookingList('upcomingList', upcoming, true);
        renderBookingList('pastList', bookings.filter(function (b) {
            return b.status && b.status.toLowerCase() !== 'active';
        }), false);

        // Subscription tab
        renderSubscription(bookings, upcoming);

        // Preferences tab
        $('prefReminders').checked = prefs.reminders !== false;
        $('prefAftercare').checked = prefs.aftercare !== false;
        $('prefFollowUps').checked = prefs.followUps !== false;
        $('prefSeasonal').checked = prefs.seasonal !== false;
        $('prefNewsletter').checked = nl.subscribed === true;

        // Profile tab
        $('profName').value = p.name || '';
        $('profPhone').value = p.phone || '';
        $('profAddress').value = p.address || '';
        $('profPostcode').value = p.postcode || '';
        $('profEmail').value = p.email || '';
    }

    function renderSubscription(bookings, visits) {
        // Find active subscription from bookings
        var activeSub = null;
        for (var i = 0; i < bookings.length; i++) {
            var type = (bookings[i].type || '').toLowerCase();
            var status = (bookings[i].status || '').toLowerCase();
            if ((type.indexOf('subscription') >= 0) && status !== 'cancelled' && status !== 'completed') {
                activeSub = bookings[i];
                break;
            }
        }

        if (activeSub) {
            $('subNone').style.display = 'none';
            $('subActive').style.display = '';
            $('subPlan').textContent = activeSub.service || activeSub.type || '—';
            $('subPrice').textContent = activeSub.price ? '£' + activeSub.price : '—';
            $('subStartDate').textContent = fmtDate(activeSub.date);
            $('subDay').textContent = activeSub.preferredDay || '—';
            $('subJobRef').textContent = activeSub.jobNumber || '—';
            $('subStatusBadge').textContent = activeSub.status || 'Active';

            // Store rowIndex for cancel
            $('cancelSubBtn').dataset.rowIndex = activeSub.rowIndex || '';

            // Show upcoming visits for this subscription
            var subVisits = visits.filter(function (v) {
                return new Date(v.date) >= new Date();
            });
            renderBookingList('subVisitsList', subVisits, true);
        } else {
            $('subNone').style.display = '';
            $('subActive').style.display = 'none';
        }
    }

    function renderBookingList(containerId, items, isUpcoming) {
        var container = $(containerId);
        if (!items || items.length === 0) {
            container.innerHTML = '<p class="portal-empty">' + (isUpcoming ? 'No upcoming visits.' : 'No past bookings.') + '</p>';
            return;
        }
        container.innerHTML = '';
        items.forEach(function (item) {
            var statusClass = 'portal-badge-grey';
            var status = (item.status || '').toLowerCase();
            if (status === 'scheduled' || status === 'active') statusClass = 'portal-badge-green';
            else if (status === 'completed') statusClass = 'portal-badge-blue';
            else if (status === 'cancelled') statusClass = 'portal-badge-red';

            var div = document.createElement('div');
            div.className = 'portal-booking-item';
            div.innerHTML =
                '<div>' +
                    '<span class="portal-booking-service">' + escHtml(item.service || item.package || '') + '</span><br>' +
                    '<span class="portal-booking-date">' + fmtDate(item.date) + (item.time ? ' at ' + escHtml(item.time) : '') + '</span>' +
                '</div>' +
                '<div class="portal-booking-meta">' +
                    (item.price ? '<span class="portal-booking-price">' + escHtml(item.price) + '</span>' : '') +
                    '<span class="portal-badge ' + statusClass + '">' + escHtml(item.status || item.package || '') + '</span>' +
                    (item.jobNumber ? '<span style="font-size:0.75rem;color:#999;">' + escHtml(item.jobNumber) + '</span>' : '') +
                '</div>';
            container.appendChild(div);
        });
    }

    // ───────────────────────────────────
    //  SAVE PREFERENCES
    // ───────────────────────────────────
    async function savePreferences() {
        var session = getSession();
        if (!session) { showLogin(); return; }

        var btn = $('savePrefBtn');
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
        hideMsg('prefMsg');

        try {
            var res = await fetch(WEBHOOK, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain' },
                body: JSON.stringify({
                    action: 'update_email_preferences',
                    sessionToken: session.sessionToken,
                    preferences: {
                        reminders: $('prefReminders').checked,
                        aftercare: $('prefAftercare').checked,
                        followUps: $('prefFollowUps').checked,
                        seasonal: $('prefSeasonal').checked
                    },
                    newsletter: $('prefNewsletter').checked
                })
            }).then(r => r.json());

            if (res.status === 'auth_required') {
                clearSession(); showLogin();
                showMsg('loginMsg', 'Session expired. Please log in again.', 'info');
                return;
            }

            showMsg('prefMsg', 'Preferences saved successfully!', 'success');
        } catch (err) {
            showMsg('prefMsg', 'Could not save preferences. Please try again.', 'error');
        }

        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-save"></i> Save Preferences';
    }

    // ───────────────────────────────────
    //  SAVE PROFILE
    // ───────────────────────────────────
    async function saveProfile() {
        var session = getSession();
        if (!session) { showLogin(); return; }

        var btn = $('saveProfileBtn');
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
        hideMsg('profileMsg');

        try {
            var res = await fetch(WEBHOOK, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain' },
                body: JSON.stringify({
                    action: 'update_customer_profile',
                    sessionToken: session.sessionToken,
                    name: $('profName').value.trim(),
                    phone: $('profPhone').value.trim(),
                    address: $('profAddress').value.trim(),
                    postcode: $('profPostcode').value.trim()
                })
            }).then(r => r.json());

            if (res.status === 'auth_required') {
                clearSession(); showLogin();
                showMsg('loginMsg', 'Session expired. Please log in again.', 'info');
                return;
            }

            showMsg('profileMsg', 'Profile updated (' + (res.rowsUpdated || 0) + ' records).', 'success');
            // Update header
            $('portalName').textContent = $('profName').value || 'Customer';
        } catch (err) {
            showMsg('profileMsg', 'Could not update profile. Please try again.', 'error');
        }

        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-save"></i> Save Changes';
    }

    // ───────────────────────────────────
    //  DELETE ACCOUNT
    // ───────────────────────────────────
    async function deleteAccount() {
        var session = getSession();
        if (!session) { showLogin(); return; }

        var confirm = $('deleteConfirm').value.trim();
        if (confirm !== 'DELETE MY ACCOUNT') {
            showMsg('deleteMsg', 'Please type DELETE MY ACCOUNT exactly.', 'error');
            return;
        }

        var btn = $('deleteConfirmBtn');
        btn.disabled = true;
        btn.textContent = 'Deleting...';
        hideMsg('deleteMsg');

        try {
            var res = await fetch(WEBHOOK, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain' },
                body: JSON.stringify({
                    action: 'delete_customer_account',
                    sessionToken: session.sessionToken,
                    confirmation: confirm
                })
            }).then(r => r.json());

            if (res.status === 'success') {
                clearSession();
                $('deleteModal').style.display = 'none';
                showLogin();
                showMsg('loginMsg', 'Your account has been deleted. All personal data has been removed.', 'success');
            } else {
                showMsg('deleteMsg', res.message || 'Could not delete account.', 'error');
            }
        } catch (err) {
            showMsg('deleteMsg', 'Something went wrong. Please try again.', 'error');
        }

        btn.disabled = false;
        btn.textContent = 'Delete Forever';
    }

    // ─── Utility ───
    function escHtml(s) {
        var d = document.createElement('div');
        d.textContent = s || '';
        return d.innerHTML;
    }

})();
