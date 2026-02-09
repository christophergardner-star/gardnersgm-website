/* ============================================
   Gardners GM – Lawn Expert Chatbot
   FAQ + Telegram forwarding for unanswered Qs
   ============================================ */

const ChatBot = (() => {
    // ── Config ──
    const TELEGRAM_BOT_TOKEN = '8261874993:AAHW6752Ofhsrw6qzOSSZWnfmzbBj7G8Z-g';
    const TELEGRAM_CHAT_ID = '6200151295';
    const BOT_NAME = 'Gardners GM Lawn Expert';
    const BOT_AVATAR = '🌿';

    // ── FAQ Knowledge Base ──
    const faqs = [
        {
            keywords: ['price', 'cost', 'how much', 'pricing', 'charge', 'rate', 'expensive', 'cheap', 'afford', 'quote'],
            answer: `Our pricing starts from just <strong>£30 for lawn mowing</strong>. Here's a quick guide:<br><br>
                🌿 <strong>Lawn Mowing</strong> – From £30<br>
                🌳 <strong>Hedge Trimming</strong> – From £60<br>
                🍂 <strong>Garden Clearance</strong> – From £100<br>
                💧 <strong>Power Washing</strong> – From £60<br>
                🌺 <strong>Planting & Borders</strong> – From £45<br>
                🏡 <strong>Full Garden Maintenance</strong> – From £100<br><br>
                We also offer packages: <strong>Essential (£35/visit)</strong>, <strong>Standard (£25/visit)</strong>, or <strong>Premium (£120/month)</strong>. Minimum call-out is £40.<br><br>
                <a href="services.html" style="color:#2E7D32;font-weight:600;">View full pricing →</a>`
        },
        {
            keywords: ['book', 'booking', 'appointment', 'schedule', 'reserve', 'available', 'availability'],
            answer: `Booking is easy! Just head to our <a href="booking.html" style="color:#2E7D32;font-weight:600;">booking page</a> and:<br><br>
                1️⃣ Choose your service<br>
                2️⃣ Pick a date & time<br>
                3️⃣ Fill in your details<br><br>
                We'll confirm your booking within 24 hours. No payment needed upfront!`
        },
        {
            keywords: ['mow', 'mowing', 'lawn cut', 'grass cut', 'cutting grass', 'lawn mow'],
            answer: `We recommend mowing your lawn <strong>once a week</strong> during the growing season (March–October) and <strong>every 2-3 weeks</strong> in autumn/winter.<br><br>
                🌿 <strong>Ideal cutting height:</strong> 2.5–4cm in summer, slightly higher in winter<br>
                🌿 <strong>Golden rule:</strong> Never cut more than ⅓ of the grass blade at once<br>
                🌿 <strong>Best time:</strong> Mid-morning when dew has dried<br><br>
                Our lawn mowing service starts from <strong>£30</strong>. <a href="booking.html?service=lawn-mowing" style="color:#2E7D32;font-weight:600;">Book now →</a>`
        },
        {
            keywords: ['weed', 'weeds', 'weedkiller', 'dandelion', 'clover', 'moss'],
            answer: `Weeds and moss are common problems in Cornwall's damp climate! Here's what we suggest:<br><br>
                🌱 <strong>For weeds:</strong> Regular mowing at the right height crowds out weeds naturally. Spot-treat stubborn ones with a selective weedkiller in spring/autumn.<br>
                🍀 <strong>For moss:</strong> Improve drainage, reduce shade where possible, and scarify in autumn. Apply a moss killer in early spring.<br>
                🌿 <strong>Prevention:</strong> A healthy, well-fed lawn is the best defence!<br><br>
                We can assess your lawn and recommend treatment. <a href="contact.html" style="color:#2E7D32;font-weight:600;">Get in touch →</a>`
        },
        {
            keywords: ['feed', 'fertilise', 'fertilize', 'fertiliser', 'fertilizer', 'lawn feed', 'nutrition'],
            answer: `Feeding your lawn is essential for a lush, green result:<br><br>
                🌸 <strong>Spring (March-April):</strong> High-nitrogen feed to kickstart growth<br>
                ☀️ <strong>Summer (June-July):</strong> Balanced feed to sustain health<br>
                🍂 <strong>Autumn (Sept-Oct):</strong> Potassium-rich feed to toughen roots for winter<br><br>
                Apply on a damp (not waterlogged) day, and water in if no rain is forecast. Avoid feeding during drought or frost.`
        },
        {
            keywords: ['scarify', 'scarification', 'thatch', 'aerate', 'aeration', 'spike'],
            answer: `Great questions! These are key lawn care tasks:<br><br>
                🔧 <strong>Scarification:</strong> Removes thatch (dead grass build-up). Best done in <strong>September–October</strong>. Your lawn will look rough for 2-3 weeks but will bounce back stronger.<br><br>
                🔧 <strong>Aeration:</strong> Poke holes in the soil to improve drainage and root growth. Do this in <strong>autumn or spring</strong>, especially on heavy clay soils common in parts of Cornwall.<br><br>
                Both services are available as one-offs or part of our maintenance packages.`
        },
        {
            keywords: ['hedge', 'hedges', 'trim', 'trimming', 'hedge cutting', 'privet', 'laurel', 'leylandii'],
            answer: `Hedge trimming keeps your garden looking sharp! Key points:<br><br>
                ✂️ <strong>Best time to trim:</strong> Late spring (May-June) and late summer (Aug-Sept)<br>
                ✂️ <strong>Evergreens (laurel, privet):</strong> Trim 2-3 times per year<br>
                ✂️ <strong>Leylandii:</strong> Must trim regularly — they grow fast!<br>
                ⚠️ <strong>Note:</strong> Avoid trimming hedges March–August if birds are nesting (it's actually illegal to disturb nesting birds)<br><br>
                Our hedge trimming starts from <strong>£60</strong>. <a href="booking.html?service=hedge-trimming" style="color:#2E7D32;font-weight:600;">Book now →</a>`
        },
        {
            keywords: ['area', 'location', 'cornwall', 'where', 'cover', 'travel', 'service area', 'near me'],
            answer: `We're based in <strong>Cornwall</strong> and cover a wide area across the county, including Truro, Falmouth, Newquay, Penzance, St Austell, Bodmin, and surrounding villages.<br><br>
                📍 If you're unsure whether we cover your area, just pop your postcode into the <a href="booking.html" style="color:#2E7D32;font-weight:600;">booking form</a> or <a href="contact.html" style="color:#2E7D32;font-weight:600;">contact us</a> and we'll let you know!`
        },
        {
            keywords: ['contact', 'phone', 'call', 'email', 'reach', 'get in touch', 'speak'],
            answer: `You can reach us anytime:<br><br>
                📞 <strong>Phone:</strong> <a href="tel:01726432051" style="color:#2E7D32;">01726 432051</a><br>
                📧 <strong>Email:</strong> <a href="mailto:info@gardnersgm.co.uk" style="color:#2E7D32;">info@gardnersgm.co.uk</a><br>
                🌐 <strong>Online:</strong> Use our <a href="contact.html" style="color:#2E7D32;font-weight:600;">contact form</a><br><br>
                We typically respond within a few hours during working days!`
        },
        {
            keywords: ['when', 'season', 'time of year', 'winter', 'summer', 'spring', 'autumn', 'best time'],
            answer: `Timing is everything in gardening! Here's a seasonal guide:<br><br>
                🌸 <strong>Spring:</strong> Feed lawn, first mow, weed treatment, plant borders<br>
                ☀️ <strong>Summer:</strong> Regular mowing, watering, hedge trimming, enjoy the garden!<br>
                🍂 <strong>Autumn:</strong> Scarify, aerate, autumn feed, leaf clearance, plant bulbs<br>
                ❄️ <strong>Winter:</strong> Tidy borders, prune shrubs, plan for spring<br><br>
                We offer year-round maintenance packages. <a href="services.html" style="color:#2E7D32;font-weight:600;">See our services →</a>`
        },
        {
            keywords: ['new lawn', 'seed', 'turf', 'lay turf', 'reseed', 'bare patch', 'new grass', 'overseeding'],
            answer: `Starting a new lawn? Here's the breakdown:<br><br>
                🌱 <strong>Turf:</strong> Instant results, best laid in autumn or spring. Water daily for the first 2 weeks — avoid walking on it for 3 weeks.<br>
                🌱 <strong>Seed:</strong> Cheaper option, sow in April-May or September. Keep moist and expect germination in 7-21 days.<br>
                🔧 <strong>Bare patches:</strong> Rake, seed, and keep watered — best done in autumn.<br><br>
                We can help with lawn renovation. <a href="contact.html" style="color:#2E7D32;font-weight:600;">Get a quote →</a>`
        },
        {
            keywords: ['rain', 'wet', 'waterlogged', 'drainage', 'puddle', 'flood', 'soggy'],
            answer: `Cornwall gets plenty of rain! If your lawn is waterlogged:<br><br>
                💧 <strong>Short term:</strong> Avoid walking on it — compaction makes it worse<br>
                💧 <strong>Medium term:</strong> Aerate with a garden fork or hollow-tine aerator<br>
                💧 <strong>Long term:</strong> Improve drainage by top-dressing with sand, installing a French drain, or re-grading the slope<br><br>
                Poor drainage is one of the most common issues we deal with. <a href="contact.html" style="color:#2E7D32;font-weight:600;">Let us take a look →</a>`
        },
        {
            keywords: ['garden clearance', 'clear', 'overgrown', 'rubbish', 'waste', 'tidy', 'cleanup', 'clean up'],
            answer: `Got an overgrown or neglected garden? We can transform it!<br><br>
                🧹 Our garden clearance service includes:<br>
                • Removing overgrowth, weeds, and brambles<br>
                • Cutting back shrubs and trees<br>
                • Clearing rubbish and green waste<br>
                • Tidying borders and paths<br><br>
                Prices start from <strong>£100</strong> depending on size. <a href="booking.html?service=garden-clearance" style="color:#2E7D32;font-weight:600;">Book a clearance →</a>`
        },
        {
            keywords: ['power wash', 'pressure wash', 'jet wash', 'driveway clean', 'patio clean', 'decking clean', 'power washing', 'pressure washing'],
            answer: `We offer professional power washing for all outdoor surfaces:<br><br>
                💧 <strong>Patios</strong> – From £60<br>
                💧 <strong>Driveways</strong> – From £80<br>
                💧 <strong>Decking</strong> – From £70<br>
                💧 <strong>Full property</strong> – From £150+<br><br>
                We remove dirt, algae, moss, and grime to restore surfaces to like-new condition. Great for block paving, concrete, natural stone, and timber decking.<br><br>
                <a href="booking.html?service=power-washing" style="color:#2E7D32;font-weight:600;">Book power washing →</a>`
        },
        {
            keywords: ['hello', 'hi', 'hey', 'good morning', 'good afternoon', 'hiya', 'alright'],
            answer: `Hello! 👋 I'm the Gardners GM Lawn Expert. I can help with questions about:<br><br>
                🌿 Lawn care & mowing tips<br>
                💰 Pricing & packages<br>
                📅 Booking & availability<br>
                🌳 Hedge trimming<br>
                🍂 Garden clearance<br>
                � Power washing<br>
                �🐛 Weeds, moss & lawn problems<br><br>
                Just type your question, or if I can't help, I'll pass your message to Chris who'll get back to you!`
        },
        {
            keywords: ['thank', 'thanks', 'cheers', 'ta', 'appreciate'],
            answer: `You're welcome! 😊 If you need anything else, just ask. We're always happy to help with your garden!<br><br>
                Ready to book? <a href="booking.html" style="color:#2E7D32;font-weight:600;">Book online →</a>`
        },
        {
            keywords: ['subscription', 'subscribe', 'package', 'plan', 'maintenance plan', 'recurring', 'regular service', 'essentials', 'standard plan', 'premium plan'],
            answer: `We offer three maintenance packages to keep your garden looking great year-round:<br><br>
                🌿 <strong>Essential</strong> — £35/visit (fortnightly)<br>
                ⭐ <strong>Standard</strong> — £25/visit (weekly) <em>Most popular!</em><br>
                👑 <strong>Premium</strong> — £120/month (complete garden care)<br><br>
                All packages are <strong>cancel anytime — no contract, no notice period</strong>. We reduce visits in winter automatically.<br><br>
                <a href="subscribe.html" style="color:#2E7D32;font-weight:600;">Subscribe to a package →</a>`
        },
        {
            keywords: ['cancel', 'cancellation', 'stop subscription', 'end subscription', 'cancel plan', 'notice period'],
            answer: `You can <strong>cancel your subscription at any time</strong> with absolutely no notice period and no cancellation fee.<br><br>
                Simply contact us by phone, email, or through this chat, and we'll cancel it immediately. No questions asked!<br><br>
                📞 <a href="tel:01726432051" style="color:#2E7D32;">01726 432051</a><br>
                📧 <a href="mailto:info@gardnersgm.co.uk" style="color:#2E7D32;">info@gardnersgm.co.uk</a>`
        },
        {
            keywords: ['terms', 'conditions', 'privacy', 'legal', 'gdpr', 'data', 'agreement'],
            answer: `You can find all our legal documents here:<br><br>
                📋 <a href="terms.html" style="color:#2E7D32;font-weight:600;">Terms of Service & Privacy Policy →</a><br>
                📦 <a href="subscription-terms.html" style="color:#2E7D32;font-weight:600;">Subscription Agreement →</a><br><br>
                We take your privacy seriously and comply with UK GDPR. We never sell or share your data.`
        }
    ];

    // ── Match FAQ ──
    function findAnswer(userMessage) {
        const msg = userMessage.toLowerCase().trim();
        let bestMatch = null;
        let bestScore = 0;

        for (const faq of faqs) {
            let score = 0;
            for (const keyword of faq.keywords) {
                if (msg.includes(keyword)) {
                    score += keyword.split(' ').length; // multi-word matches score higher
                }
            }
            if (score > bestScore) {
                bestScore = score;
                bestMatch = faq;
            }
        }

        return bestScore > 0 ? bestMatch.answer : null;
    }

    // ── Send to Telegram (returns message_id for reply tracking) ──
    async function sendToTelegram(userName, userMessage) {
        const text = `🌿 *New website chat message*\n\n👤 *From:* ${userName || 'Website Visitor'}\n💬 *Message:* ${userMessage}\n\n↩️ _Swipe left on this message and tap reply — your response will appear live in the customer's chat on the website._`;
        
        try {
            const resp = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: TELEGRAM_CHAT_ID,
                    text: text,
                    parse_mode: 'Markdown'
                })
            });
            const data = await resp.json();
            return data.ok ? data.result.message_id : null;
        } catch (e) {
            console.error('Telegram send failed:', e);
            return null;
        }
    }

    // ── Build Widget ──
    function init() {
        // Create widget HTML
        const widget = document.createElement('div');
        widget.id = 'chatbot-widget';
        widget.innerHTML = `
            <button id="chatbot-toggle" aria-label="Open chat">
                <span class="chatbot-toggle-icon">${BOT_AVATAR}</span>
                <span class="chatbot-toggle-close">&times;</span>
                <span class="chatbot-pulse"></span>
            </button>
            <div id="chatbot-window">
                <div class="chatbot-header">
                    <div class="chatbot-header-info">
                        <span class="chatbot-avatar">${BOT_AVATAR}</span>
                        <div>
                            <div class="chatbot-name">${BOT_NAME}</div>
                            <div class="chatbot-status">Online — Ask me anything!</div>
                        </div>
                    </div>
                    <button id="chatbot-close" aria-label="Close chat">&times;</button>
                </div>
                <div id="chatbot-messages">
                    <div class="chat-msg bot">
                        <span class="chat-msg-avatar">${BOT_AVATAR}</span>
                        <div class="chat-msg-bubble">
                            Hi there! 👋 I'm the <strong>Gardners GM Lawn Expert</strong>.<br><br>
                            Ask me about lawn care, pricing, bookings, or anything garden-related. If I can't answer, I'll forward your question to Chris!
                        </div>
                    </div>
                </div>
                <div id="chatbot-input-area">
                    <input type="text" id="chatbot-input" placeholder="Type your question..." autocomplete="off" />
                    <button id="chatbot-send" aria-label="Send message">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                    </button>
                </div>
            </div>
        `;

        document.body.appendChild(widget);

        // Elements
        const toggle = document.getElementById('chatbot-toggle');
        const window_ = document.getElementById('chatbot-window');
        const closeBtn = document.getElementById('chatbot-close');
        const input = document.getElementById('chatbot-input');
        const sendBtn = document.getElementById('chatbot-send');
        const messages = document.getElementById('chatbot-messages');

        let isOpen = false;

        function toggleChat() {
            isOpen = !isOpen;
            widget.classList.toggle('open', isOpen);
            if (isOpen) {
                widget.classList.remove('has-notification');
                input.focus();
                messages.scrollTop = messages.scrollHeight;
            }
        }

        toggle.addEventListener('click', toggleChat);
        closeBtn.addEventListener('click', toggleChat);

        function addMessage(text, sender) {
            const div = document.createElement('div');
            div.className = `chat-msg ${sender}`;
            if (sender === 'bot') {
                div.innerHTML = `<span class="chat-msg-avatar">${BOT_AVATAR}</span><div class="chat-msg-bubble">${text}</div>`;
            } else {
                div.innerHTML = `<div class="chat-msg-bubble">${text}</div>`;
            }
            messages.appendChild(div);
            messages.scrollTop = messages.scrollHeight;
        }

        function showTyping() {
            const div = document.createElement('div');
            div.className = 'chat-msg bot typing-indicator';
            div.innerHTML = `<span class="chat-msg-avatar">${BOT_AVATAR}</span><div class="chat-msg-bubble"><span class="dot"></span><span class="dot"></span><span class="dot"></span></div>`;
            messages.appendChild(div);
            messages.scrollTop = messages.scrollHeight;
            return div;
        }

        // ── Telegram Reply Polling ──
        const sentMsgIds = [];
        let replyPoll = null;
        let pollTimer = null;
        let pollOffset = -1;
        let pollReady = false;

        function escapeHtml(str) {
            const d = document.createElement('div');
            d.textContent = str || '';
            return d.innerHTML;
        }

        async function startReplyPolling() {
            if (replyPoll) return;

            // Step 1: Remove any webhook that blocks getUpdates
            try { await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/deleteWebhook`); } catch(e) {}

            // Step 2: Get the current offset so we only see NEW updates
            try {
                const r = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates?offset=-1&limit=1&timeout=0`);
                const d = await r.json();
                if (d.ok && d.result.length) {
                    pollOffset = d.result[d.result.length - 1].update_id + 1;
                } else {
                    pollOffset = 0;
                }
            } catch(e) { pollOffset = 0; }

            pollReady = true;
            replyPoll = setInterval(pollForReplies, 4000);
            resetPollTimeout();
        }

        function resetPollTimeout() {
            if (pollTimer) clearTimeout(pollTimer);
            pollTimer = setTimeout(stopReplyPolling, 900000); // 15 min
        }

        function stopReplyPolling() {
            if (replyPoll) { clearInterval(replyPoll); replyPoll = null; }
            if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
            pollReady = false;
        }

        async function pollForReplies() {
            if (!pollReady) return;
            try {
                const resp = await fetch(
                    `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates?offset=${pollOffset}&timeout=0`
                );
                const data = await resp.json();
                if (!data.ok || !data.result.length) return;

                for (const upd of data.result) {
                    // Always advance offset so we don't re-process
                    pollOffset = upd.update_id + 1;

                    const m = upd.message;
                    if (!m || !m.text || !m.reply_to_message) continue;
                    if (!sentMsgIds.includes(m.reply_to_message.message_id)) continue;

                    // Chris replied!
                    addMessage(
                        `<span class="admin-reply-label"><i class="fas fa-user-shield"></i> Chris</span> ${escapeHtml(m.text)}`,
                        'bot'
                    );

                    // Notification badge if chat is closed
                    if (!isOpen) {
                        widget.classList.add('has-notification');
                    }
                }
            } catch (e) {
                console.error('Reply poll error:', e);
            }
        }

        async function handleSend() {
            const msg = input.value.trim();
            if (!msg) return;

            addMessage(msg, 'user');
            input.value = '';

            const typing = showTyping();

            // Simulate thinking delay
            await new Promise(r => setTimeout(r, 800 + Math.random() * 700));

            const faqAnswer = findAnswer(msg);

            typing.remove();

            if (faqAnswer) {
                addMessage(faqAnswer, 'bot');
            } else {
                // Forward to Telegram & start listening for reply
                const sentMsgId = await sendToTelegram(null, msg);
                if (sentMsgId) {
                    sentMsgIds.push(sentMsgId);
                    await startReplyPolling();
                    resetPollTimeout();
                    addMessage(
                        `I've forwarded your question to <strong>Chris</strong> — he'll reply right here! 📩<br><br>
                        <span style="font-size:0.85em;color:#888;"><i class="fas fa-circle-notch fa-spin" style="margin-right:4px;"></i> This chat is live — Chris's reply will appear below automatically.</span>`,
                        'bot'
                    );
                } else {
                    addMessage(
                        `Sorry, I couldn't send your message right now. Please contact us directly:<br><br>
                        📞 <a href="tel:01726432051" style="color:#2E7D32;">01726 432051</a><br>
                        📧 <a href="mailto:info@gardnersgm.co.uk" style="color:#2E7D32;">info@gardnersgm.co.uk</a>`,
                        'bot'
                    );
                }
            }
        }

        sendBtn.addEventListener('click', handleSend);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') handleSend();
        });
    }

    return { init };
})();

// Auto-init when DOM is ready
document.addEventListener('DOMContentLoaded', ChatBot.init);
