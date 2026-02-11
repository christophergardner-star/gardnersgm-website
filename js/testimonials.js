/* ===========================================
   TESTIMONIALS - Verified Customer Reviews
   Gardners Ground Maintenance
   =========================================== */

(function () {
    'use strict';

    const WEBHOOK = 'https://script.google.com/macros/s/AKfycbxyajcat0Ujymdwky9aWHqomcjqcV5yWAbOBt9T5ZIR-9sENUYrlg1heEE9qcNj0XAbnA/exec';
    const TELEGRAM_TOKEN = '8261874993:AAHW6752Ofhsrw6qzOSSZWnfmzbBj7G8Z-g';
    const TELEGRAM_CHAT = '6200151295';

    let verifiedEmail = '';
    let selectedRating = 0;

    // ─── DOM Elements ───
    const verifyStep = document.getElementById('reviewVerifyStep');
    const formStep = document.getElementById('reviewFormStep');
    const successStep = document.getElementById('reviewSuccessStep');
    const verifyBtn = document.getElementById('reviewVerifyBtn');
    const submitBtn = document.getElementById('reviewSubmitBtn');
    const verifyMsg = document.getElementById('reviewVerifyMsg');
    const emailInput = document.getElementById('reviewEmail');
    const starPicker = document.getElementById('reviewStarPicker');
    const ratingInput = document.getElementById('reviewRating');
    const reviewText = document.getElementById('reviewText');
    const charCount = document.getElementById('reviewCharCount');
    const reviewsSection = document.getElementById('customerReviewsSection');
    const reviewsGrid = document.getElementById('customerReviewsGrid');

    // ─── Load Approved Reviews on Page Load ───
    loadApprovedReviews();

    // ─── Star Picker ───
    const stars = starPicker.querySelectorAll('i');

    stars.forEach(star => {
        star.addEventListener('mouseenter', () => {
            const val = parseInt(star.dataset.star);
            highlightStars(val);
        });
        star.addEventListener('click', () => {
            selectedRating = parseInt(star.dataset.star);
            ratingInput.value = selectedRating;
            highlightStars(selectedRating);
        });
    });

    starPicker.addEventListener('mouseleave', () => {
        highlightStars(selectedRating);
    });

    function highlightStars(count) {
        stars.forEach(s => {
            const v = parseInt(s.dataset.star);
            s.className = v <= count ? 'fas fa-star' : 'far fa-star';
        });
    }

    // ─── Character Counter ───
    reviewText.addEventListener('input', () => {
        charCount.textContent = reviewText.value.length;
    });

    // ─── Verify Customer ───
    verifyBtn.addEventListener('click', async () => {
        const email = emailInput.value.trim().toLowerCase();
        if (!email || !email.includes('@')) {
            showVerifyMsg('Please enter a valid email address.', 'error');
            return;
        }

        verifyBtn.disabled = true;
        verifyBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Checking...';
        showVerifyMsg('', '');

        try {
            const url = `${WEBHOOK}?action=verify_customer&email=${encodeURIComponent(email)}`;
            const resp = await fetch(url);
            const data = await resp.json();

            if (data.verified) {
                verifiedEmail = email;
                document.getElementById('reviewVerifiedName').textContent = data.name || 'Customer';
                document.getElementById('reviewName').value = data.name || '';
                document.getElementById('reviewLocation').value = data.location || '';
                document.getElementById('reviewService').value = data.service || '';
                
                verifyStep.style.display = 'none';
                formStep.style.display = 'block';
                formStep.scrollIntoView({ behavior: 'smooth', block: 'start' });
            } else {
                showVerifyMsg("We couldn't find that email in our records. Only customers who have booked with us can leave a review. Please use the email you booked with.", 'error');
            }
        } catch (err) {
            showVerifyMsg('Something went wrong. Please try again.', 'error');
        }

        verifyBtn.disabled = false;
        verifyBtn.innerHTML = '<i class="fas fa-check-circle"></i> Verify';
    });

    // Enter key on email input
    emailInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') verifyBtn.click();
    });

    function showVerifyMsg(msg, type) {
        verifyMsg.textContent = msg;
        verifyMsg.style.display = msg ? 'block' : 'none';
        verifyMsg.className = 'review-verify-msg ' + (type === 'error' ? 'review-msg-error' : 'review-msg-success');
    }

    // ─── Submit Review ───
    submitBtn.addEventListener('click', async () => {
        const name = document.getElementById('reviewName').value.trim();
        const location = document.getElementById('reviewLocation').value.trim();
        const service = document.getElementById('reviewService').value.trim();
        const text = reviewText.value.trim();

        if (!selectedRating) {
            alert('Please select a star rating.');
            return;
        }
        if (!name) {
            alert('Please enter your name.');
            return;
        }
        if (text.length < 10) {
            alert('Please write at least 10 characters for your review.');
            return;
        }

        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Submitting...';

        const payload = {
            action: 'submit_testimonial',
            email: verifiedEmail,
            name: name,
            location: location,
            service: service,
            rating: selectedRating,
            review: text
        };

        try {
            const resp = await fetch(WEBHOOK, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain' },
                body: JSON.stringify(payload)
            });
            const data = await resp.json();

            if (data.success) {
                formStep.style.display = 'none';
                successStep.style.display = 'block';
                successStep.scrollIntoView({ behavior: 'smooth', block: 'center' });

                // Telegram notification to admin
                sendTelegramNotification(name, location, service, selectedRating, text);
            } else {
                alert(data.error || 'Something went wrong. Please try again.');
                submitBtn.disabled = false;
                submitBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Submit Review';
            }
        } catch (err) {
            alert('Failed to submit. Please try again.');
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Submit Review';
        }
    });

    // ─── Telegram Notification ───
    function sendTelegramNotification(name, location, service, rating, text) {
        const starStr = '⭐'.repeat(rating);
        const msg = `📝 *New Testimonial Submitted*\n\n` +
            `👤 *Name:* ${name}\n` +
            `📍 *Location:* ${location || 'N/A'}\n` +
            `🔧 *Service:* ${service || 'N/A'}\n` +
            `${starStr} (${rating}/5)\n\n` +
            `"${text}"\n\n` +
            `⏳ _Pending your approval in the Testimonials sheet._`;

        fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: TELEGRAM_CHAT,
                text: msg,
                parse_mode: 'Markdown'
            })
        }).catch(() => {});
    }

    // ─── Load Approved Reviews ───
    async function loadApprovedReviews() {
        try {
            const url = `${WEBHOOK}?action=get_testimonials`;
            const resp = await fetch(url);
            const data = await resp.json();

            if (data.testimonials && data.testimonials.length > 0) {
                reviewsSection.style.display = 'block';
                reviewsGrid.innerHTML = '';

                data.testimonials.forEach(t => {
                    const initials = t.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
                    const starsHtml = Array.from({ length: 5 }, (_, i) =>
                        `<i class="fas fa-star"${i >= t.rating ? ' style="opacity:0.3;"' : ''}></i>`
                    ).join('');

                    const card = document.createElement('div');
                    card.className = 'testimonial-card fade-in';
                    card.innerHTML = `
                        <div class="testimonial-stars">${starsHtml}</div>
                        <p class="testimonial-text">"${escapeHtml(t.review)}"</p>
                        ${t.service ? `<p class="testimonial-service"><i class="fas fa-leaf"></i> ${escapeHtml(t.service)}</p>` : ''}
                        <div class="testimonial-author">
                            <div class="testimonial-avatar">${initials}</div>
                            <div>
                                <strong>${escapeHtml(t.name)}</strong>
                                ${t.location ? `<span class="testimonial-location">${escapeHtml(t.location)}</span>` : ''}
                                <span class="testimonial-badge"><i class="fas fa-check-circle"></i> Verified Customer</span>
                            </div>
                        </div>`;
                    reviewsGrid.appendChild(card);
                });
            }
        } catch (err) {
            // Silently fail — hardcoded testimonials still show
        }
    }

    function escapeHtml(str) {
        const d = document.createElement('div');
        d.textContent = str;
        return d.innerHTML;
    }

})();
