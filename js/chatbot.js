/* ============================================
   Gardners GM – Garden Assistant Chatbot
   Full business knowledge, booking flow,
   FAQ + Telegram forwarding for unanswered Qs
   ============================================ */

const ChatBot = (() => {
    // ── Config ──
    const SHEETS_WEBHOOK = 'https://script.google.com/macros/s/AKfycbyjUkYuFrpigXi6chj1B4z-xjHsgnnmkcQ_SejJwdqbstbAq-QooLz9G1sQpfl3vGGufQ/exec';
    const BOT_NAME = 'Gardners GM Assistant';
    const BOT_AVATAR = '🌿';

    // ── Dify AI Chatbot (self-hosted via Docker) ──
    // Set these after running Dify setup — see docker/dify-setup.md
    const DIFY_API_URL = ''; // e.g. 'http://ggm-pc:5001/v1/chat-messages' or 'http://localhost:5001/v1/chat-messages'
    const DIFY_API_KEY = ''; // e.g. 'app-xxxxxxxxxxxxxxxx' — get from Dify dashboard
    let difyConversationId = null; // Maintains conversation context across messages

    // ── FAQ Knowledge Base ──
    const faqs = [
        {
            keywords: ['price', 'cost', 'how much', 'pricing', 'charge', 'rate', 'expensive', 'cheap', 'afford', 'quote', 'minimum'],
            answer: `Here's our current pricing (all prices include everything — no hidden costs):<br><br>
                🌿 <strong>Lawn Cutting</strong> — From £30<br>
                ✂️ <strong>Hedge Trimming</strong> — From £45<br>
                🧹 <strong>Garden Clearance</strong> — From £100<br><br>
                <strong>£30 minimum call-out</strong> applies to all services. Final quotes depend on garden size, condition and access.<br><br>
                <a href="services.html" style="color:#2E7D32;font-weight:600;">View full pricing →</a> · <a href="booking.html" style="color:#2E7D32;font-weight:600;">Get a free quote →</a>`
        },
        {
            keywords: ['book', 'booking', 'appointment', 'schedule', 'reserve', 'available', 'availability', 'book now'],
            answer: `Getting a quote is easy! You have two options:<br><br>
                <strong>1️⃣ Online (quickest):</strong> Head to our <a href="booking.html" style="color:#2E7D32;font-weight:600;">enquiry form</a> — choose your service, pick a preferred date, and we'll get back to you with a quote.<br><br>
                <strong>2️⃣ Right here:</strong> I can help you get started! Just type <strong>"I'd like a quote"</strong> and I'll walk you through it.<br><br>
                We'll respond with a personalised quote within 24 hours.`
        },
        {
            keywords: ['mow', 'mowing', 'lawn cut', 'grass cut', 'cutting grass', 'lawn mow', 'lawn cutting'],
            answer: `Our lawn cutting service starts from <strong>£30</strong>. We provide:<br><br>
                🌿 Professional mowing with clean, striped finish<br>
                🌿 Edging & strimming available (+£5)<br>
                🌿 Clippings collected as standard<br>
                🌿 All lawn sizes — small (up to 50m²) to extra large (300m²+)<br><br>
                <strong>Lawn care tips:</strong><br>
                • Mow weekly March–October, fortnightly in winter<br>
                • Ideal height: 2.5–4cm in summer, slightly higher in winter<br>
                • Never cut more than ⅓ of the blade at once<br>
                • Best time: mid-morning when dew has dried<br><br>
                <a href="booking.html?service=lawn-cutting" style="color:#2E7D32;font-weight:600;">Book lawn cutting →</a>`
        },
        {
            keywords: ['hedge', 'hedges', 'trim', 'trimming', 'hedge cutting', 'privet', 'laurel', 'leylandii'],
            answer: `Our hedge trimming service starts from <strong>£45</strong>. We handle:<br><br>
                ✂️ Single hedges to full property boundaries<br>
                ✂️ Small, medium & large hedges<br>
                ✂️ Decorative shaping (+£20)<br>
                ✂️ Height reduction / heavy cut back (+£40)<br>
                ✂️ All waste removed as standard<br><br>
                <strong>Tips:</strong> Best trimmed in late spring (May–June) and late summer (Aug–Sept). ⚠️ Avoid March–August if birds are nesting (it's illegal to disturb them).<br><br>
                <a href="booking.html?service=hedge-trimming" style="color:#2E7D32;font-weight:600;">Book hedge trimming →</a>`
        },
        /* HIDDEN: Scarifying — not currently offered
        {
            keywords: ['scarify', 'scarification', 'thatch', 'aerate', 'aeration', 'spike'],
            answer: `Our scarifying service starts from <strong>£70</strong>. It includes:<br><br>
                🔧 <strong>Scarification:</strong> Removes moss, thatch & dead material. Best done September–October. Your lawn looks rough for 2–3 weeks, then bounces back stronger.<br>
                🌱 <strong>Optional add-ons:</strong> Overseeding (+£30), top dressing (+£40), post-scarify feed (+£15)<br><br>
                🔧 <strong>Aeration:</strong> Improves drainage and root growth. Best in autumn or spring, especially on Cornwall's heavy clay soils.<br><br>
                Available as one-offs or included in our <strong>Garden Maintenance plan</strong> (£140/month).<br><br>
                <a href="booking.html?service=scarifying" style="color:#2E7D32;font-weight:600;">Book scarifying →</a>`
        },
        END HIDDEN: Scarifying */
        /* HIDDEN: Lawn Treatment — not currently offered
        {
            keywords: ['treatment', 'feed', 'fertilise', 'fertilize', 'fertiliser', 'fertilizer', 'lawn feed', 'weed', 'weeds', 'weedkiller', 'dandelion', 'clover', 'moss', 'lawn treatment'],
            answer: `Our lawn treatment service starts from <strong>£35</strong>. Options include:<br><br>
                🌱 Feed & weed (standard)<br>
                🍀 Moss treatment (+£10)<br>
                🌿 Feed, weed & moss combo (+£20)<br>
                🔬 Disease treatment (+£25)<br>
                📊 Soil pH test (+£15)<br>
                🔧 Aeration / spiking (+£30)<br><br>
                <strong>Seasonal feeding guide:</strong><br>
                🌸 Spring: high-nitrogen feed<br>
                ☀️ Summer: balanced feed<br>
                🍂 Autumn: potassium-rich feed for winter prep<br><br>
                <a href="booking.html?service=lawn-treatment" style="color:#2E7D32;font-weight:600;">Book lawn treatment →</a>`
        },
        END HIDDEN: Lawn Treatment */
        {
            keywords: ['garden clearance', 'clear', 'overgrown', 'rubbish', 'waste', 'tidy', 'cleanup', 'clean up', 'clearance', 'neglected'],
            answer: `Our garden clearance service starts from <strong>£100</strong>. We offer:<br><br>
                🧹 <strong>Light tidy up</strong> — From £100<br>
                🧹 <strong>Medium</strong> (overgrown beds, some waste) — From £200<br>
                🧹 <strong>Heavy</strong> (fully overgrown/neglected) — From £320<br>
                🧹 <strong>Full property clearance</strong> — From £480<br><br>
                <strong>Optional:</strong> Skip hire (+£250), rubbish removal van load (+£80), strimming & brush cutting (+£30)<br><br>
                Perfect for moving into a new property, estate maintenance, or reclaiming neglected gardens.<br><br>
                <a href="booking.html?service=garden-clearance" style="color:#2E7D32;font-weight:600;">Book clearance →</a>`
        },
        /* HIDDEN: Power Washing — not currently offered
        {
            keywords: ['power wash', 'pressure wash', 'jet wash', 'driveway clean', 'patio clean', 'decking clean', 'power washing', 'pressure washing'],
            answer: `Our power washing service starts from <strong>£50</strong>:<br><br>
                💧 <strong>Paths / steps</strong> — From £40<br>
                💧 <strong>Patio</strong> — From £50<br>
                💧 <strong>Decking</strong> — From £70<br>
                💧 <strong>Driveway</strong> — From £80<br>
                💧 <strong>Walls / fencing</strong> — From £70<br><br>
                <strong>Add-ons:</strong> Sealant / re-sand (+£40), additional surface (+50%)<br>
                Price varies by area size — small (up to 15m²) to extra large (80m²+).<br><br>
                We remove dirt, algae, moss, and grime to restore surfaces to like-new condition.<br><br>
                <a href="booking.html?service=power-washing" style="color:#2E7D32;font-weight:600;">Book power washing →</a>`
        },
        END HIDDEN: Power Washing */
        /* HIDDEN: Veg Patch — not currently offered
        {
            keywords: ['vegetable', 'veg patch', 'veg', 'allotment', 'raised bed', 'grow vegetables', 'veggie', 'patch preparation', 'vegetable patch'],
            answer: `Our <strong>Vegetable Patch Preparation</strong> service starts from <strong>£70</strong>:<br><br>
                🥕 <strong>Small patch</strong> (up to 10m²) — From £70<br>
                🥕 <strong>Medium patch</strong> (10–25m²) — From £120<br>
                🥕 <strong>Large patch</strong> (25m²+) — From £180<br><br>
                <strong>What's included:</strong><br>
                ✅ Ground clearance & weed removal<br>
                ✅ Soil turning & conditioning<br>
                ✅ Levelling & bed shaping<br><br>
                <strong>Optional extras:</strong> Raised bed construction (+£60), soil/compost supply (+£40), planting guidance (+£20)<br><br>
                Perfect for starting your own veg garden — we prepare the ground so you can grow! 🌱<br><br>
                <a href="booking.html?service=veg-patch" style="color:#2E7D32;font-weight:600;">Book veg patch prep →</a>`
        },
        END HIDDEN: Veg Patch */
        /* HIDDEN: Weeding Treatment — not currently offered
        {
            keywords: ['weed', 'weeding', 'herbicide', 'weed treatment', 'weed killer', 'mulch', 'border weeding', 'overrun', 'overgrown weeds'],
            answer: `Our <strong>Weeding Treatment</strong> service starts from <strong>£40</strong>:<br><br>
                🌿 <strong>Small area</strong> (up to 15m²) — From £40<br>
                🌿 <strong>Medium area</strong> (15–30m²) — From £80<br>
                🌿 <strong>Large area</strong> (30m²+) — From £120<br><br>
                <strong>Treatment types:</strong><br>
                🧤 <strong>Manual weeding</strong> — Hand-pulled, root and all<br>
                💧 <strong>Chemical treatment</strong> — Targeted herbicide application<br>
                🌾 <strong>Mulch & suppress</strong> — Weed membrane + bark mulch<br><br>
                <strong>Optional extras:</strong> Border re-edging (+£25), mulch top-up (+£30)<br><br>
                We'll get your beds and borders weed-free and keep them that way! 💪<br><br>
                <a href="booking.html?service=weeding-treatment" style="color:#2E7D32;font-weight:600;">Book weeding treatment →</a>`
        },
        END HIDDEN: Weeding Treatment */
        /* HIDDEN: Fence Repair — not currently offered
        {
            keywords: ['fence', 'fencing', 'panel', 'fence post', 'fence repair', 'storm damage fence', 'boundary', 'broken fence', 'fence panel'],
            answer: `Our <strong>Fence Repair</strong> service starts from <strong>£75</strong>:<br><br>
                🔨 <strong>Panel replacement</strong> — From £75 per panel<br>
                🔨 <strong>Post repair/replacement</strong> — From £90<br>
                🔨 <strong>Full section rebuild</strong> — From £150<br><br>
                <strong>We handle:</strong><br>
                ✅ Storm-damaged panels & posts<br>
                ✅ Rotten post replacement<br>
                ✅ Leaning fence straightening<br>
                ✅ New gravel boards<br><br>
                <strong>Optional extras:</strong> Concrete post upgrade (+£40), fence treatment/stain (+£35), trellis addition (+£30)<br><br>
                Cornwall weather can be tough on fences — we'll have yours secure and standing straight! 🏠<br><br>
                <a href="booking.html?service=fence-repair" style="color:#2E7D32;font-weight:600;">Book fence repair →</a>`
        },
        END HIDDEN: Fence Repair */
        /* HIDDEN: Emergency Tree Surgery — not currently qualified
        {
            keywords: ['emergency', 'tree surgery', 'fallen tree', 'dangerous tree', 'storm tree', 'fallen branch', 'call out', 'after hours', 'urgent', 'emergency tree', 'tree emergency', 'out of hours'],
            answer: `Our <strong>🚨 Emergency Tree Surgery</strong> service starts from <strong>£150</strong>:<br><br>
                🌳 <strong>Small tree/branch</strong> — From £150<br>
                🌳 <strong>Medium tree</strong> — From £250<br>
                🌳 <strong>Large tree</strong> — From £400<br><br>
                <strong>Emergency call-outs available 6:30 PM – 7:30 AM</strong> (a <strong>50% surcharge</strong> applies for out-of-hours work).<br><br>
                <strong>We handle:</strong><br>
                ⚡ Fallen trees blocking roads/driveways<br>
                ⚡ Dangerous overhanging branches<br>
                ⚡ Storm-damaged trees<br>
                ⚡ Root removal & stump grinding<br><br>
                <strong>Optional extras:</strong> Root removal (+£80), stump grinding (+£60), log splitting & stacking (+£40)<br><br>
                <strong>Available 24/7 for emergencies</strong> — call <a href="tel:01726432051" style="color:#e53935;font-weight:600;">01726 432051</a> for immediate help.<br><br>
                <a href="booking.html?service=emergency-tree" style="color:#e53935;font-weight:600;">Book emergency tree surgery →</a>`
        },
        END HIDDEN: Emergency Tree Surgery */
        {
            keywords: ['bespoke', 'custom', 'custom job', 'landscaping', 'turfing', 'decking', 'pond', 'tree planting', 'something else', 'other work', 'special request', 'not listed', 'different job'],
            answer: `We love <strong>bespoke projects</strong>! If it's outdoors, we can probably help. 🛠️<br><br>
                <strong>Popular custom jobs:</strong><br>
                🏡 Garden landscaping & design<br>
                🌱 Turfing & lawn creation<br>
                🪵 Decking installation<br>
                🐟 Pond clearing & maintenance<br>
                🌳 Tree planting & care<br>
                🏘️ Holiday let garden packages<br>
                🏢 Commercial grounds maintenance<br><br>
                <strong>How to get a quote:</strong><br>
                Just type <strong>"bespoke"</strong> here and I'll collect your details — or call us on <a href="tel:01726432051" style="color:#2E7D32;">01726 432051</a>.<br><br>
                We'll email you a personalised quote within 24 hours! 📧`
        },
        /* HIDDEN: Drain Clearance — not currently offered
        {
            keywords: ['drain', 'blocked drain', 'drain clearance', 'drainage', 'slow drain', 'standing water', 'garden drain', 'root ingress', 'unblock'],
            answer: `Our <strong>Drain Clearance</strong> service starts from <strong>£45</strong>:<br><br>
                💧 <strong>Single blocked drain</strong> — From £45<br>
                💧 <strong>Multiple drains (2–3)</strong> — From £75<br>
                💧 <strong>Full garden drainage run</strong> — From £120<br><br>
                <strong>We handle:</strong><br>
                ✅ Partially blocked / slow-flowing drains<br>
                ✅ Fully blocked drains with standing water<br>
                ✅ Root ingress into drain pipes<br>
                ✅ Pressure jetting (+£25)<br><br>
                ⚠️ <strong>Domestic garden drains only</strong> — we don't cover industrial or main sewer lines.<br><br>
                <a href="booking.html?service=drain-clearance" style="color:#2E7D32;font-weight:600;">Book drain clearance →</a>`
        },
        END HIDDEN: Drain Clearance */
        /* HIDDEN: Gutter Cleaning — not currently offered
        {
            keywords: ['gutter', 'gutter cleaning', 'gutters', 'blocked gutter', 'gutter clearance', 'downpipe', 'overflowing gutter'],
            answer: `Our <strong>Gutter Cleaning</strong> service starts from <strong>£45</strong>:<br><br>
                🏠 <strong>Small property (1-2 bed)</strong> — From £45<br>
                🏠 <strong>Medium property (3 bed)</strong> — From £75<br>
                🏠 <strong>Large property (4+ bed)</strong> — From £100<br><br>
                <strong>We handle:</strong><br>
                ✅ Leaf and debris removal from all gutters<br>
                ✅ Heavy moss and plant growth clearance<br>
                ✅ Downpipe flushing and checking (+£15)<br>
                ✅ Gutter guard installation (+£30)<br><br>
                <a href="booking.html?service=gutter-cleaning" style="color:#2E7D32;font-weight:600;">Book gutter cleaning →</a>`
        },
        END HIDDEN: Gutter Cleaning */
        /* HIDDEN: Traffic Management — not currently qualified
        {
            keywords: ['traffic management', 'road closure', 'streetworks', 'tm plan', 'road works', 'traffic control', 'highway', 'council permit'],
            answer: `For <strong>big jobs requiring road traffic management</strong>, we can plan and accommodate this as part of our service. 🚧<br><br>
                <strong>This includes:</strong><br>
                🚦 Traffic management plans<br>
                📋 Streetworks permit applications<br>
                🚜 Equipment hire coordination<br>
                👷 Chapter 8 operative attendance<br><br>
                These are bespoke projects, so please <strong>get in touch</strong> for a competitive quote with full details of the work required.<br><br>
                Type <strong>"bespoke"</strong> to describe the job, or call <a href="tel:01726432051" style="color:#2E7D32;">01726 432051</a> to discuss.`
        },
        END HIDDEN: Traffic Management */
        {
            keywords: ['hello', 'hi', 'hey', 'good morning', 'good afternoon', 'hiya', 'alright'],
            answer: `Hello! 👋 I'm the <strong>Gardners GM Assistant</strong>. I can help with:<br><br>
                🌿 Service info & pricing<br>
                📅 Quotes — I can <strong>help you get started</strong> right here<br>
                ✂️ Lawn cutting, hedge trimming & garden clearance<br>
                🏢 About us, areas we cover & contact details<br><br>
                Just type your question, or say <strong>"I'd like a quote"</strong> to get started!`
        },
        {
            keywords: ['thank', 'thanks', 'cheers', 'ta', 'appreciate'],
            answer: `You're welcome! 😊 If you need anything else, just ask. We're always happy to help with your garden!<br><br>
                Ready to book? <a href="booking.html" style="color:#2E7D32;font-weight:600;">Book online →</a> or type <strong>"book"</strong> and I'll help you here.`
        },
        /* HIDDEN: Subscriptions — not currently offered
        {
            keywords: ['subscription', 'subscribe', 'package', 'plan', 'maintenance plan', 'recurring', 'regular service', 'lawn care plan', 'garden maintenance plan', 'property care plan', 'packages', 'just mowing', 'full garden care'],
            answer: `We offer three subscription plans — <strong>no contracts, cancel anytime</strong>:<br><br>
                ✂️ <strong>Just Mowing</strong> — From £30/visit<br>
                &nbsp;&nbsp;&nbsp;Weekly (£30) or fortnightly (£35) — your grass cut, edging & strimming. Keep clippings for compost &amp; save £5/visit!<br><br>
                🏡 <strong>Full Garden Care</strong> — £140/month <em>(Best value!)</em><br>
                &nbsp;&nbsp;&nbsp;Weekly lawn + quarterly hedges + 4× lawn treatments + annual scarifying + monthly weeding<br><br>
                🏠 <strong>Property Care</strong> — £55/month<br>
                &nbsp;&nbsp;&nbsp;Gutter cleaning 2×/yr + power washing 2×/yr + drain inspection + photo reports<br><br>
                🔧 <strong>Build Your Own</strong> — Pick services & frequency, 10% bundle discount<br><br>
                🤝 <strong>All plans include a free intro visit</strong> — Chris meets you, walks round the garden &amp; discusses your needs before any paid work starts.<br><br>
                Not sure? <a href="subscribe.html#freeQuote" style="color:#2E7D32;font-weight:600;">Book a free quote visit →</a> | <a href="subscribe.html" style="color:#2E7D32;font-weight:600;">View plans →</a>`
        },
        END HIDDEN: Subscriptions */
        {
            keywords: ['cancel', 'cancellation', 'stop subscription', 'end subscription', 'cancel plan', 'notice period'],
            answer: `You can <strong>cancel at any time</strong> — absolutely no notice period, no cancellation fee, no questions asked.<br><br>
                To cancel a subscription, just contact us:<br>
                📞 <a href="tel:01726432051" style="color:#2E7D32;">01726 432051</a><br>
                📧 <a href="mailto:info@gardnersgm.co.uk" style="color:#2E7D32;">info@gardnersgm.co.uk</a><br><br>
                To cancel a <strong>one-off booking</strong>: 24+ hours' notice = no charge. Less than 24 hours may incur a fee.`
        },
        {
            keywords: ['terms', 'conditions', 'privacy', 'legal', 'gdpr', 'data', 'agreement'],
            answer: `You can find all our legal documents here:<br><br>
                📋 <a href="terms.html" style="color:#2E7D32;font-weight:600;">Terms of Service →</a><br>
                🔒 <a href="privacy.html" style="color:#2E7D32;font-weight:600;">Privacy Policy →</a><br>
                📦 <a href="subscription-terms.html" style="color:#2E7D32;font-weight:600;">Subscription Agreement →</a><br><br>
                Key points: We're UK GDPR compliant, fully insured, we never sell your data, and all prices are transparent with no hidden costs.`
        },
        {
            keywords: ['area', 'location', 'cornwall', 'where', 'cover', 'travel', 'service area', 'near me', 'truro', 'falmouth', 'newquay', 'penzance', 'st austell', 'bodmin', 'bude', 'st ives', 'redruth', 'camborne', 'launceston', 'liskeard', 'wadebridge', 'padstow', 'helston', 'saltash', 'looe', 'fowey'],
            answer: `We're based in <strong>Roche, Cornwall</strong> and serve <strong>all areas of Cornwall</strong> including:<br><br>
                📍 Truro, Falmouth, Newquay, Penzance, St Ives, St Austell, Bodmin, Bude, Camborne, Redruth, Launceston, Liskeard, Wadebridge, Padstow, Helston, Saltash, Looe, Fowey & all surrounding villages<br><br>
                A gentle travel surcharge of <strong>50p/mile over 15 miles</strong> applies — most mid-Cornwall jobs have zero surcharge.<br><br>
                Pop your postcode into our <a href="booking.html" style="color:#2E7D32;font-weight:600;">booking form</a> and we'll calculate your quote automatically!`
        },
        {
            keywords: ['contact', 'phone', 'call', 'email', 'reach', 'get in touch', 'speak'],
            answer: `You can reach us anytime:<br><br>
                📞 <strong>Phone:</strong> <a href="tel:01726432051" style="color:#2E7D32;">01726 432051</a><br>
                📧 <strong>Email:</strong> <a href="mailto:info@gardnersgm.co.uk" style="color:#2E7D32;">info@gardnersgm.co.uk</a><br>
                🌐 <strong>Contact form:</strong> <a href="contact.html" style="color:#2E7D32;font-weight:600;">Online form →</a><br>
                💬 <strong>Chat:</strong> Right here! I can forward your message to Chris.<br><br>
                <strong>Hours:</strong> Mon–Fri 8am–6pm, Sat 9am–4pm, Sun closed<br>
                We typically respond within a few hours!`
        },
        {
            keywords: ['about', 'who', 'chris', 'owner', 'team', 'experience', 'company', 'business', 'gardners'],
            answer: `<strong>Gardners Ground Maintenance</strong> is run by <strong>Chris Gardner</strong> — a sole trader with over <strong>10 years' experience</strong> in professional garden care.<br><br>
                🏆 500+ happy customers across Cornwall<br>
                🛡️ Fully insured (public liability)<br>
                🌿 Eco-conscious — sustainable practices, responsible waste disposal<br>
                💰 Fair, transparent pricing with no hidden costs<br>
                ⏰ Reliable & punctual — we turn up when we say we will<br><br>
                Based in <strong>Roche, Cornwall PL26 8HN</strong>, serving the whole county.<br><br>
                <a href="about.html" style="color:#2E7D32;font-weight:600;">Read more about us →</a>`
        },
        {
            keywords: ['pay', 'payment', 'card', 'bank transfer', 'invoice', 'stripe', 'how to pay'],
            answer: `We offer flexible payment options:<br><br>
                💳 <strong>Pay online</strong> — Secure card payment via Stripe when you book<br>
                📄 <strong>Pay later</strong> — We'll invoice you after the job, payment due within 14 days<br>
                🏦 <strong>Bank transfer</strong> — Sort: 04-00-03, Account: 39873874<br><br>
                Subscriptions are billed automatically via Stripe. All prices include everything — we're not VAT registered so no VAT is added.`
        },
        {
            keywords: ['when', 'season', 'time of year', 'winter', 'summer', 'spring', 'autumn', 'best time'],
            answer: `Timing is everything in gardening! Here's a seasonal guide for Cornwall:<br><br>
                🌸 <strong>Spring:</strong> First mow, feed lawn, weed treatment, plant borders<br>
                ☀️ <strong>Summer:</strong> Regular mowing, watering, hedge trimming<br>
                🍂 <strong>Autumn:</strong> Scarify, aerate, autumn feed, leaf clearance<br>
                ❄️ <strong>Winter:</strong> Tidy borders, prune shrubs, monthly mowing<br><br>
                Our subscription packages automatically adjust visit frequency by season. <a href="services.html#packages" style="color:#2E7D32;font-weight:600;">See packages →</a>`
        },
        {
            keywords: ['new lawn', 'seed', 'turf', 'lay turf', 'reseed', 'bare patch', 'new grass', 'overseeding'],
            answer: `Starting a new lawn? Here's the breakdown:<br><br>
                🌱 <strong>Turf:</strong> Instant results, best laid in autumn or spring. Water daily for 2 weeks, avoid walking on it for 3 weeks.<br>
                🌱 <strong>Seed:</strong> Cheaper option, sow in April–May or September. Germination in 7–21 days.<br>
                🔧 <strong>Bare patches:</strong> Rake, seed, keep watered — best done in autumn.<br><br>
                Our scarifying service (from £80) includes optional overseeding (+£30). <a href="contact.html" style="color:#2E7D32;font-weight:600;">Get a quote →</a>`
        },
        {
            keywords: ['rain', 'wet', 'waterlogged', 'drainage', 'puddle', 'flood', 'soggy'],
            answer: `Cornwall gets plenty of rain! If your lawn is waterlogged:<br><br>
                💧 <strong>Short term:</strong> Avoid walking on it — compaction makes it worse<br>
                💧 <strong>Medium term:</strong> Aerate with a garden fork or hollow-tine aerator<br>
                💧 <strong>Long term:</strong> Top-dress with sand, install French drain, or re-grade the slope<br><br>
                We deal with drainage issues regularly across Cornwall. <a href="contact.html" style="color:#2E7D32;font-weight:600;">Let us take a look →</a>`
        },
        {
            keywords: ['insurance', 'insured', 'liability', 'damage', 'guarantee', 'quality'],
            answer: `Yes — we're <strong>fully insured</strong> with public liability insurance. You're completely covered.<br><br>
                🛡️ Public liability insurance<br>
                ✅ Quality guarantee — if you're not happy, contact us within 48 hours for a free re-visit<br>
                💼 Over 10 years' experience<br>
                🌟 100% satisfaction rate with 500+ customers<br><br>
                Your property is in safe hands!`
        },
        {
            keywords: ['free quote', 'estimate', 'no obligation', 'assessment'],
            answer: `Absolutely! We offer <strong>free, no-obligation quotes</strong> for all our services.<br><br>
                Get a quote three ways:<br>
                1️⃣ Use our <a href="booking.html" style="color:#2E7D32;font-weight:600;">online quote builder</a> — instant pricing<br>
                2️⃣ <a href="contact.html" style="color:#2E7D32;font-weight:600;">Send us details</a> — we'll reply within a few hours<br>
                3️⃣ Call us on <a href="tel:01726432051" style="color:#2E7D32;">01726 432051</a><br><br>
                Or describe what you need right here and I'll give you a ballpark!`
        },
        {
            keywords: ['weather', 'rain cancel', 'bad weather', 'postpone', 'reschedule'],
            answer: `We're in Cornwall — we're used to a bit of rain! 🌧️<br><br>
                However, some jobs can't be done safely in heavy rain or storms. If we need to postpone:<br>
                • <strong>One-off bookings:</strong> We'll reschedule at no extra cost<br>
                • <strong>Subscriptions:</strong> You won't be charged for skipped visits<br>
                • <strong>Premium:</strong> Missed visits are rescheduled or credited<br><br>
                We'll always let you know as soon as possible if weather affects your booking.`
        },
        {
            keywords: ['career', 'careers', 'job', 'jobs', 'hiring', 'vacancy', 'vacancies', 'work for you', 'apply', 'employment', 'position', 'recruit'],
            answer: `We're always looking for great people to join the team! 🌿<br><br>
                Check our <a href="careers.html" style="color:#2E7D32;font-weight:600;">Careers page</a> for current openings. You can apply online — just upload your CV and fill in the form.<br><br>
                Even if there are no vacancies listed, you can send a <strong>speculative application</strong> and we'll keep you on file.<br><br>
                📞 Or call us on <a href="tel:01726432051" style="color:#2E7D32;">01726 432051</a> for a chat.`
        },
        {
            keywords: ['parish', 'council', 'commercial', 'contract', 'quote match', 'beat quote', 'price match'],
            answer: `Yes! We take on contracts for <strong>parish councils</strong> and commercial clients — no job too big or small. 🏛️<br><br>
                Use our <a href="booking.html" style="color:#2E7D32;font-weight:600;">advanced booking system</a> or <a href="booking.html#quote-builder" style="color:#2E7D32;font-weight:600;">smart quote builder</a> to get a competitive price.<br><br>
                <strong>Got a quote you want matched or beaten?</strong> <a href="contact.html" style="color:#2E7D32;font-weight:600;">Get in touch</a> — we'll do our best to beat any like-for-like quote!`
        },
        {
            keywords: ['complaint', 'complaints', 'complain', 'unhappy', 'not happy', 'poor service', 'bad job', 'refund', 'resolution', 'dissatisfied', 'issue', 'problem with service'],
            answer: `We're sorry to hear something wasn't right — we take all complaints seriously. 😔<br><br>
                Visit our <a href="complaints.html" style="color:#2E7D32;font-weight:600;">Complaints page</a> to submit your complaint. Here's what you can expect:<br><br>
                • <strong>Single jobs:</strong> A percentage refund if approved by management<br>
                • <strong>Subscribers:</strong> A discount on your next visit if approved<br><br>
                All complaints are reviewed within <strong>48 hours</strong> by management. You'll receive email updates as your case progresses.<br><br>
                📞 Need to speak to someone urgently? Call <a href="tel:01726432051" style="color:#2E7D32;">01726 432051</a>.`
        },
        {
            keywords: ['area', 'areas', 'cover', 'location', 'where', 'cornwall', 'town', 'towns', 'truro', 'newquay', 'bodmin', 'falmouth', 'penzance', 'st austell', 'do you come to', 'your area', 'come to my area', 'near me'],
            answer: `We cover the <strong>whole of Cornwall</strong> from our base in Roche! 🗺️<br><br>
                This includes: <strong>Truro, St Austell, Newquay, Bodmin, Falmouth, Penzance, Redruth, Camborne, Helston, Launceston, Liskeard, Bude, Wadebridge, Padstow, Saltash, Looe, Fowey, St Ives, Hayle, Perranporth</strong> and 50+ more towns and villages.<br><br>
                Check our <a href="areas.html" style="color:#2E7D32;font-weight:600;">Areas We Cover</a> page for the full list.<br><br>
                No corner of Cornwall is too far! 📞 <a href="tel:01726432051" style="color:#2E7D32;">01726 432051</a>`
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

    // ══════════════════════════════════════════
    // BOOKING CONVERSATION FLOW
    // ══════════════════════════════════════════
    const SERVICES = {
        '1':  { key: 'lawn-cutting',      name: 'Lawn Cutting',               price: '£30' },
        '2':  { key: 'hedge-trimming',     name: 'Hedge Trimming',             price: '£45' },
        '3':  { key: 'scarifying',         name: 'Scarifying',                 price: '£70' },
        '4':  { key: 'lawn-treatment',     name: 'Lawn Treatment',             price: '£35' },
        '5':  { key: 'garden-clearance',   name: 'Garden Clearance',           price: '£100' },
        '6':  { key: 'power-washing',      name: 'Power Washing',              price: '£50' },
        '7':  { key: 'veg-patch',          name: 'Vegetable Patch Preparation', price: '£70' },
        '8':  { key: 'weeding-treatment',  name: 'Weeding Treatment',          price: '£40' },
        // HIDDEN: '9':  { key: 'fence-repair',       name: 'Fence Repair',               price: '£65' },
        // HIDDEN: '10': { key: 'emergency-tree',     name: 'Emergency Tree Surgery',     price: '£200' },
        '9': { key: 'drain-clearance',     name: 'Drain Clearance',            price: '£45' },
        '10': { key: 'gutter-cleaning',     name: 'Gutter Cleaning',            price: '£45' }
    };

    // Booking state: null = not booking, otherwise { step, data }
    let bookingState = null;

    // Bespoke enquiry state: null = not active, otherwise { step, data }
    let bespokeState = null;

    // Subscription portal state: null = not active, otherwise { step, data }
    let subscriptionState = null;

    function isBespokeTrigger(msg) {
        const lower = msg.toLowerCase().trim();
        return lower === 'bespoke' || lower.includes('bespoke work') || lower.includes('custom job') ||
               lower.includes('something else') || lower.includes('not on the list') ||
               lower.includes('custom work') || lower.includes('bespoke job') ||
               lower.includes('landscaping') || lower.includes('turfing') ||
               lower.includes('decking') || lower.includes('pond') || lower.includes('tree planting');
               // HIDDEN: traffic management, streetworks, road closure, tm plan triggers removed
    }

    function handleBespokeStep(msg) {
        const input = msg.trim();
        const step = bespokeState.step;

        if (input.toLowerCase() === 'cancel' || input.toLowerCase() === 'stop' || input.toLowerCase() === 'quit') {
            bespokeState = null;
            return `No problem — enquiry cancelled. Feel free to ask anything else! 😊`;
        }

        // Step 1: Description of work
        if (step === 'description') {
            if (input.length < 10) {
                return `Please give us a bit more detail about the work you need — the more you tell us, the more accurate our quote will be.<br><br><em>e.g. "I need 20m of old fencing replaced with new 6ft panels" or "Overgrown back garden needs landscaping"</em>`;
            }
            bespokeState.data.description = input;
            bespokeState.step = 'name';
            return `Got it — thanks for the details! 📝<br><br>👤 What's your <strong>full name</strong>?`;
        }

        // Step 2: Name
        if (step === 'name') {
            if (input.length < 2) {
                return `Please enter your full name so we can address you properly.`;
            }
            bespokeState.data.name = input;
            bespokeState.step = 'phone';
            return `Thanks, <strong>${input}</strong>! 📞 What's your <strong>phone number</strong>? (So we can call to discuss the job)`;
        }

        // Step 3: Phone
        if (step === 'phone') {
            const cleaned = input.replace(/[\s\-()]/g, '');
            if (!/^(\+44|0)\d{9,10}$/.test(cleaned)) {
                return `That doesn't look right. Please enter a valid UK phone number (e.g. <em>07700 900123</em> or <em>01726 432051</em>).`;
            }
            bespokeState.data.phone = input;
            bespokeState.step = 'email';
            return `Great! 📧 And your <strong>email address</strong>? (We'll send the quote here)`;
        }

        // Step 4: Email
        if (step === 'email') {
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input)) {
                return `That doesn't look like a valid email. Please try again (e.g. <em>name@example.com</em>).`;
            }
            bespokeState.data.email = input;
            bespokeState.step = 'confirm';
            const d = bespokeState.data;
            return `Perfect! Here's a summary of your enquiry:<br><br>
                📝 <strong>Work:</strong> ${d.description}<br>
                👤 <strong>Name:</strong> ${d.name}<br>
                📞 <strong>Phone:</strong> ${d.phone}<br>
                📧 <strong>Email:</strong> ${d.email}<br><br>
                Does this look right? Type <strong>"yes"</strong> to submit or <strong>"no"</strong> to start again.`;
        }

        // Step 5: Confirm
        if (step === 'confirm') {
            if (input.toLowerCase().startsWith('y')) {
                submitBespokeEnquiry(bespokeState.data);
                bespokeState = null;
                return `✅ <strong>Enquiry submitted!</strong><br><br>
                    We've emailed your request to our team and a <strong>personalised quote</strong> is being prepared for you. Chris will review your request and you'll receive your quote via email within <strong>24 hours</strong>.<br><br>
                    For urgent enquiries, you can also call us on <a href="tel:01726432051" style="color:#2E7D32;font-weight:600;">01726 432051</a>. Thanks! 🌿`;
            } else {
                bespokeState = { step: 'description', data: {} };
                return `No problem — let's start again. 📝 Please <strong>describe the work</strong> you need done:`;
            }
        }

        return `Something went wrong. Type <strong>"bespoke"</strong> to try again.`;
    }

    async function submitBespokeEnquiry(data) {
        try {
            await fetch(SHEETS_WEBHOOK, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain' },
                body: JSON.stringify({
                    action: 'bespoke_enquiry',
                    name: data.name,
                    email: data.email,
                    phone: data.phone,
                    description: data.description
                })
            });
        } catch(e) {
            console.error('Bespoke enquiry submission failed:', e);
            // Fallback: relay via Apps Script
            try {
                await sendToTelegram(data.name, `BESPOKE ENQUIRY: ${data.description} | Phone: ${data.phone} | Email: ${data.email}`);
            } catch(tgErr) { console.error('Telegram relay fallback failed:', tgErr); }
        }
    }

    function isBookingTrigger(msg) {
        const lower = msg.toLowerCase().trim();
        return lower.includes("i'd like to book") || lower.includes("i want to book") ||
               lower.includes("make a booking") || lower.includes("start a booking") ||
               lower.includes("book a") || lower.includes("book please") ||
               (lower === 'book') || lower.includes("can i book");
    }

    // ══════════════════════════════════════════
    // SUBSCRIPTION PORTAL FLOW
    // ══════════════════════════════════════════
    function isSubscriptionCodeTrigger(msg) {
        const lower = msg.toLowerCase().trim();
        if (/^ggm-\d{4}$/i.test(lower)) return true;
        if (lower === 'my subscription' || lower === 'manage subscription' ||
            lower === 'subscription code' || lower === 'manage my subscription' ||
            lower === 'subscription portal' || lower === 'my visits' ||
            lower === 'next visit' || lower === 'skip visit') return true;
        return false;
    }

    function extractJobNumber(msg) {
        const match = msg.match(/GGM-\d{4}/i);
        return match ? match[0].toUpperCase() : null;
    }

    async function fetchSubscriptionPortal(jobNumber) {
        try {
            const resp = await fetch(`${SHEETS_WEBHOOK}?action=get_subscription_portal&jobNumber=${encodeURIComponent(jobNumber)}`);
            return await resp.json();
        } catch(e) {
            console.error('Subscription portal fetch failed:', e);
            return { status: 'error', message: 'Unable to load subscription details. Please try again.' };
        }
    }

    async function submitSubscriptionRequest(jobNumber, requestType, details) {
        try {
            const resp = await fetch(SHEETS_WEBHOOK, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain' },
                body: JSON.stringify({
                    action: 'subscription_request',
                    jobNumber: jobNumber,
                    requestType: requestType,
                    details: details
                })
            });
            return await resp.json();
        } catch(e) {
            console.error('Subscription request failed:', e);
            return { status: 'error', message: 'Request failed. Please try again.' };
        }
    }

    function handleSubscriptionStep(msg) {
        const input = msg.trim();
        const step = subscriptionState.step;

        if (input.toLowerCase() === 'cancel' || input.toLowerCase() === 'exit' || input.toLowerCase() === 'quit') {
            subscriptionState = null;
            return { text: `No problem — subscription portal closed. Feel free to ask anything else! 😊`, done: true };
        }

        if (input.toLowerCase() === 'menu' && step !== 'lookup' && step !== 'enter_code') {
            subscriptionState.step = 'menu';
            const s = subscriptionState.data.subscription;
            const nv = subscriptionState.data.nextVisit;
            return { text: buildSubscriptionMenu(s, nv), done: true };
        }

        // Step: enter_code — user needs to provide GGM-XXXX
        if (step === 'enter_code') {
            const code = extractJobNumber(input);
            if (!code) {
                return { text: `That doesn't look like a valid code. Please enter your subscription code in the format <strong>GGM-XXXX</strong> (e.g. GGM-0042).<br><br><em>You can find this in your subscription confirmation email.</em>`, done: true };
            }
            subscriptionState.data.jobNumber = code;
            subscriptionState.step = 'lookup';
            return { text: null, done: false }; // Signal to do async lookup
        }

        // Step: menu — user picks an option
        if (step === 'menu') {
            const choice = input.toLowerCase();
            if (choice === '1' || choice.includes('change') && choice.includes('day')) {
                subscriptionState.step = 'change_day';
                return { text: `📅 What day would you like your visits changed to?<br><br>Please type a day of the week (e.g. <em>Monday</em>, <em>Wednesday</em>, <em>Friday</em>).`, done: true };
            }
            if (choice === '2' || choice.includes('add') && choice.includes('service') || choice.includes('extra')) {
                subscriptionState.step = 'add_service';
                return { text: `🔧 What would you like added to your next visit?<br><br><em>e.g. "Hedge trimming along the back fence", "Edge the borders", "Apply moss treatment"</em>`, done: true };
            }
            if (choice === '3' || choice.includes('note') || choice.includes('message')) {
                subscriptionState.step = 'add_note';
                return { text: `📝 What would you like Chris to know for your next visit?<br><br><em>e.g. "Gate code is 4523", "Dog will be in the garden", "Please avoid the flower bed on the left"</em>`, done: true };
            }
            if (choice === '4' || choice.includes('skip')) {
                const nv = subscriptionState.data.nextVisit;
                if (!nv) {
                    return { text: `⚠️ No upcoming visit found to skip. Type <strong>menu</strong> to go back.`, done: true };
                }
                subscriptionState.step = 'confirm_skip';
                return { text: `⏭️ Are you sure you want to skip your next visit on <strong>${nv.date}</strong>?<br><br>Type <strong>yes</strong> to confirm or <strong>no</strong> to go back.`, done: true };
            }
            if (choice === '5' || choice.includes('chat') || choice.includes('speak') || choice.includes('talk')) {
                subscriptionState.step = 'live_chat';
                return { text: `💬 <strong>Live Chat with Chris</strong><br><br>Type your message and I'll send it straight to Chris. He'll reply right here!<br><br><em>Type "menu" to go back to your subscription options.</em>`, done: true };
            }
            return { text: `Please type a number <strong>1–5</strong> or describe what you'd like to do:<br><br>1️⃣ Change preferred day<br>2️⃣ Request extra service<br>3️⃣ Leave a note<br>4️⃣ Skip next visit<br>5️⃣ Chat with Chris`, done: true };
        }

        // Step: change_day — user provides a day
        if (step === 'change_day') {
            const days = ['monday','tuesday','wednesday','thursday','friday','saturday'];
            const dayLower = input.toLowerCase();
            const matchedDay = days.find(d => dayLower.includes(d));
            if (!matchedDay) {
                return { text: `Please enter a day of the week (Monday to Saturday). We don't work Sundays.`, done: true };
            }
            const dayFormatted = matchedDay.charAt(0).toUpperCase() + matchedDay.slice(1);
            subscriptionState.step = 'submitting';
            subscriptionState.data.pendingRequest = { type: 'change_day', details: dayFormatted };
            return { text: null, done: false }; // Signal async submit
        }

        // Step: add_service — user describes service
        if (step === 'add_service') {
            if (input.length < 5) {
                return { text: `Please describe in a bit more detail what you'd like added to your next visit.`, done: true };
            }
            subscriptionState.step = 'submitting';
            subscriptionState.data.pendingRequest = { type: 'add_service', details: input };
            return { text: null, done: false };
        }

        // Step: add_note — user leaves note
        if (step === 'add_note') {
            if (input.length < 3) {
                return { text: `Please type your note — even a short one is fine!`, done: true };
            }
            subscriptionState.step = 'submitting';
            subscriptionState.data.pendingRequest = { type: 'add_note', details: input };
            return { text: null, done: false };
        }

        // Step: confirm_skip
        if (step === 'confirm_skip') {
            if (input.toLowerCase().startsWith('y')) {
                subscriptionState.step = 'submitting';
                subscriptionState.data.pendingRequest = { type: 'skip_visit', details: 'Customer requested via chatbot' };
                return { text: null, done: false };
            }
            subscriptionState.step = 'menu';
            const s = subscriptionState.data.subscription;
            const nv = subscriptionState.data.nextVisit;
            return { text: `No problem — visit kept as planned! 👍<br><br>` + buildSubscriptionMenu(s, nv), done: true };
        }

        // Step: live_chat — send message to Chris
        if (step === 'live_chat') {
            subscriptionState.data.pendingChat = input;
            return { text: null, done: false }; // Signal async chat relay
        }

        return { text: `Something went wrong. Type <strong>menu</strong> to see your options or <strong>cancel</strong> to exit.`, done: true };
    }

    function buildSubscriptionMenu(sub, nextVisit) {
        let html = `<div style="background:#f0f7f0;border-radius:12px;padding:16px;margin:4px 0;">`;
        html += `<div style="font-weight:700;color:#2E7D32;font-size:1.05em;margin-bottom:8px;">📦 ${sub.package}</div>`;
        html += `<div style="font-size:0.9em;color:#555;margin-bottom:4px;">📍 ${sub.address}</div>`;
        if (sub.preferredDay) html += `<div style="font-size:0.9em;color:#555;margin-bottom:4px;">📅 Preferred day: ${sub.preferredDay}</div>`;
        if (nextVisit) {
            html += `<div style="margin-top:10px;padding:10px;background:#fff;border-radius:8px;border-left:3px solid #2E7D32;">`;
            html += `<strong>Next visit:</strong> ${nextVisit.date}`;
            if (nextVisit.service) html += `<br><span style="font-size:0.9em;color:#666;">${nextVisit.service}</span>`;
            if (nextVisit.notes) html += `<br><span style="font-size:0.85em;color:#888;">📝 ${nextVisit.notes}</span>`;
            html += `</div>`;
        } else {
            html += `<div style="margin-top:10px;font-size:0.9em;color:#888;">No upcoming visits scheduled yet.</div>`;
        }
        html += `</div>`;
        html += `<br>What would you like to do?<br><br>`;
        html += `1️⃣ <strong>Change preferred day</strong><br>`;
        html += `2️⃣ <strong>Request extra service</strong> for next visit<br>`;
        html += `3️⃣ <strong>Leave a note</strong> for Chris<br>`;
        html += `4️⃣ <strong>Skip next visit</strong><br>`;
        html += `5️⃣ <strong>Chat with Chris</strong><br><br>`;
        html += `<em>Type a number or describe what you need. Type "cancel" to exit.</em>`;
        return html;
    }


    function handleBookingStep(msg) {
        const input = msg.trim();
        const step = bookingState.step;

        if (input.toLowerCase() === 'cancel' || input.toLowerCase() === 'stop' || input.toLowerCase() === 'quit') {
            bookingState = null;
            return `No problem — booking cancelled. If you change your mind, just say <strong>"book"</strong> anytime! 😊`;
        }

        // Step 1: Choose service
        if (step === 'service') {
            const choice = SERVICES[input];
            // Also accept service names typed out
            if (!choice) {
                const lower = input.toLowerCase();
                for (const [num, svc] of Object.entries(SERVICES)) {
                    if (lower.includes(svc.name.toLowerCase()) || lower.includes(svc.key)) {
                        bookingState.data.service = svc;
                        bookingState.step = 'date';
                        return `Great — <strong>${svc.name}</strong> (from ${svc.price}) selected! ✅<br><br>
                            📅 What <strong>date</strong> would you like? (e.g. <em>next Monday</em>, <em>15th March</em>, <em>2026-03-15</em>)`;
                    }
                }
                return `Please pick a number <strong>1–10</strong>, or type the service name:<br><br>
                    1️⃣ Lawn Cutting (from £30)<br>2️⃣ Hedge Trimming (from £45)<br>3️⃣ Scarifying (from £70)<br>4️⃣ Lawn Treatment (from £35)<br>5️⃣ Garden Clearance (from £100)<br>6️⃣ Power Washing (from £50)<br>7️⃣ Veg Patch Prep (from £70)<br>8️⃣ Weeding Treatment (from £40)<br>9️⃣ Drain Clearance (from £45)<br>🔟 Gutter Cleaning (from £45)<br><br>
                    <em>Type "cancel" to stop. Need something else? Type <strong>"bespoke"</strong>.</em>`;
            }
            bookingState.data.service = choice;
            bookingState.step = 'date';
            return `Great — <strong>${choice.name}</strong> (from ${choice.price}) selected! ✅<br><br>
                📅 What <strong>date</strong> would you like? (e.g. <em>next Monday</em>, <em>15th March</em>, <em>2026-03-15</em>)`;
        }

        // Step 2: Date
        if (step === 'date') {
            const parsed = parseLooseDate(input);
            if (!parsed) {
                return `I couldn't understand that date. Please try again — for example:<br>
                    • <em>next Tuesday</em><br>• <em>22nd February</em><br>• <em>2026-03-01</em>`;
            }
            bookingState.data.date = parsed;
            bookingState.step = 'time';
            return `📅 <strong>${parsed}</strong> — got it!<br><br>
                🕐 What <strong>time</strong> works best? We're available <strong>8am – 5pm</strong> Mon–Sat.<br>
                (e.g. <em>10am</em>, <em>2pm</em>, <em>morning</em>, <em>afternoon</em>)`;
        }

        // Step 3: Time
        if (step === 'time') {
            const time = parseLooseTime(input);
            if (!time) {
                return `Please enter a time between <strong>8am and 5pm</strong> — e.g. <em>9am</em>, <em>14:00</em>, <em>morning</em>, <em>afternoon</em>.`;
            }
            bookingState.data.time = time;
            bookingState.step = 'name';
            return `🕐 <strong>${time}</strong> — perfect!<br><br>
                👤 What's your <strong>full name</strong>?`;
        }

        // Step 4: Name
        if (step === 'name') {
            if (input.length < 2) return `Please enter your full name (first and last).`;
            bookingState.data.name = input;
            bookingState.step = 'email';
            return `Thanks, <strong>${input}</strong>! 👋<br><br>
                📧 What's your <strong>email address</strong>?`;
        }

        // Step 5: Email
        if (step === 'email') {
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input)) {
                return `That doesn't look like a valid email. Please try again (e.g. <em>name@example.com</em>).`;
            }
            bookingState.data.email = input;
            bookingState.step = 'phone';
            return `📧 <strong>${input}</strong> — got it!<br><br>
                📞 What's your <strong>phone number</strong>?`;
        }

        // Step 6: Phone
        if (step === 'phone') {
            const cleanPhone = input.replace(/[\s\-\(\)]/g, '');
            if (!/^(\+44|0)\d{9,10}$/.test(cleanPhone)) {
                return `Please enter a valid UK phone number (e.g. <em>07700 900000</em> or <em>01726 432051</em>).`;
            }
            bookingState.data.phone = input;
            bookingState.step = 'postcode';
            return `📞 <strong>${input}</strong> — noted!<br><br>
                📍 What's your <strong>postcode</strong>? (We serve all of Cornwall)`;
        }

        // Step 7: Postcode
        if (step === 'postcode') {
            const pc = input.toUpperCase().replace(/\s+/g, ' ').trim();
            if (!/^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i.test(pc)) {
                return `That doesn't look like a valid UK postcode. Please try again (e.g. <em>PL26 8HN</em>).`;
            }
            bookingState.data.postcode = pc;
            bookingState.step = 'notes';
            return `📍 <strong>${pc}</strong> — great!<br><br>
                📝 Any <strong>notes or special requests</strong>? (e.g. "back garden only", "gate code 1234")<br><br>
                Type <strong>"none"</strong> if nothing to add.`;
        }

        // Step 8: Notes → Confirm
        if (step === 'notes') {
            bookingState.data.notes = (input.toLowerCase() === 'none' || input.toLowerCase() === 'no') ? '' : input;
            bookingState.step = 'confirm';
            const d = bookingState.data;
            return `Perfect! Here's your booking summary:<br><br>
                🌿 <strong>Service:</strong> ${d.service.name}<br>
                📅 <strong>Date:</strong> ${d.date}<br>
                🕐 <strong>Time:</strong> ${d.time}<br>
                👤 <strong>Name:</strong> ${d.name}<br>
                📧 <strong>Email:</strong> ${d.email}<br>
                📞 <strong>Phone:</strong> ${d.phone}<br>
                📍 <strong>Postcode:</strong> ${d.postcode}<br>
                ${d.notes ? '📝 <strong>Notes:</strong> ' + d.notes + '<br>' : ''}
                <br>Type <strong>"confirm"</strong> to submit, or <strong>"cancel"</strong> to start over.`;
        }

        // Step 9: Confirm & Submit
        if (step === 'confirm') {
            if (input.toLowerCase() === 'confirm' || input.toLowerCase() === 'yes' || input.toLowerCase() === 'submit') {
                const d = bookingState.data;
                bookingState = null;
                submitChatBooking(d);
                return `✅ <strong>Booking submitted!</strong><br><br>
                    We'll confirm your ${d.service.name} appointment by email within 24 hours.<br><br>
                    📧 Confirmation will be sent to <strong>${d.email}</strong><br>
                    📞 We may call <strong>${d.phone}</strong> to confirm details<br><br>
                    Payment can be made on the day or via invoice after the job. Thank you! 🌿`;
            }
            return `Type <strong>"confirm"</strong> to submit the booking, or <strong>"cancel"</strong> to start over.`;
        }

        return null;
    }

    // ── Submit booking to Google Sheets + Telegram ──
    async function submitChatBooking(data) {
        try {
            // Submit to Google Sheets via webhook
            await fetch(SHEETS_WEBHOOK, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    action: 'booking_pay_later',
                    serviceName: data.service.name,
                    date: data.date,
                    time: data.time,
                    'customer.name': data.name,
                    'customer.email': data.email,
                    'customer.phone': data.phone,
                    'customer.postcode': data.postcode,
                    'customer.address': '',
                    notes: data.notes || '',
                    amount: '0',
                    quoteBreakdown: 'Booked via website chatbot',
                    paymentChoice: 'pay-later'
                })
            });
        } catch (e) { console.error('Chat booking sheet submit failed:', e); }

        // Notify via Telegram relay
        try {
            await sendToTelegram(data.name, `CHATBOT BOOKING: ${data.service.name} on ${data.date} at ${data.time} | ${data.postcode} | ${data.phone}${data.notes ? ' | Notes: ' + data.notes : ''}`);
        } catch (e) { console.error('Chat booking TG notify failed:', e); }
    }

    // ── Loose date parser ──
    function parseLooseDate(input) {
        const lower = input.toLowerCase().trim();
        const now = new Date();
        const days = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];

        // "today" / "tomorrow"
        if (lower === 'today') return formatDate(now);
        if (lower === 'tomorrow') { const d = new Date(now); d.setDate(d.getDate() + 1); return formatDate(d); }

        // "next monday" etc
        const nextMatch = lower.match(/next\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/);
        if (nextMatch) {
            const target = days.indexOf(nextMatch[1]);
            const d = new Date(now);
            let diff = target - d.getDay();
            if (diff <= 0) diff += 7;
            d.setDate(d.getDate() + diff);
            return formatDate(d);
        }

        // "this monday" etc
        const thisMatch = lower.match(/this\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/);
        if (thisMatch) {
            const target = days.indexOf(thisMatch[1]);
            const d = new Date(now);
            let diff = target - d.getDay();
            if (diff < 0) diff += 7;
            d.setDate(d.getDate() + diff);
            return formatDate(d);
        }

        // "15th March", "March 15", "15 March 2026"
        const dateRegex = /(\d{1,2})(?:st|nd|rd|th)?\s+(january|february|march|april|may|june|july|august|september|october|november|december)(?:\s+(\d{4}))?/;
        const dateMatch = lower.match(dateRegex);
        if (dateMatch) {
            const months = ['january','february','march','april','may','june','july','august','september','october','november','december'];
            const day = parseInt(dateMatch[1]);
            const month = months.indexOf(dateMatch[2]);
            const year = dateMatch[3] ? parseInt(dateMatch[3]) : now.getFullYear();
            const d = new Date(year, month, day);
            if (d < now) d.setFullYear(d.getFullYear() + 1);
            return formatDate(d);
        }

        // "March 15th" format
        const dateRegex2 = /(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s+(\d{4}))?/;
        const dateMatch2 = lower.match(dateRegex2);
        if (dateMatch2) {
            const months = ['january','february','march','april','may','june','july','august','september','october','november','december'];
            const month = months.indexOf(dateMatch2[1]);
            const day = parseInt(dateMatch2[2]);
            const year = dateMatch2[3] ? parseInt(dateMatch2[3]) : now.getFullYear();
            const d = new Date(year, month, day);
            if (d < now) d.setFullYear(d.getFullYear() + 1);
            return formatDate(d);
        }

        // ISO format "2026-03-15"
        const isoMatch = lower.match(/(\d{4})-(\d{2})-(\d{2})/);
        if (isoMatch) {
            return formatDate(new Date(parseInt(isoMatch[1]), parseInt(isoMatch[2]) - 1, parseInt(isoMatch[3])));
        }

        // DD/MM/YYYY or DD-MM-YYYY
        const ukMatch = lower.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
        if (ukMatch) {
            return formatDate(new Date(parseInt(ukMatch[3]), parseInt(ukMatch[2]) - 1, parseInt(ukMatch[1])));
        }

        return null;
    }

    function formatDate(d) {
        const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
        const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
        return `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
    }

    // ── Loose time parser ──
    function parseLooseTime(input) {
        const lower = input.toLowerCase().trim();
        if (lower === 'morning' || lower === 'am') return '9:00 AM';
        if (lower === 'afternoon' || lower === 'pm') return '1:00 PM';
        if (lower === 'midday' || lower === 'noon' || lower === '12') return '12:00 PM';

        // "10am", "2pm", "10:30am", "14:00"
        const match = lower.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
        if (match) {
            let hour = parseInt(match[1]);
            const mins = match[2] ? parseInt(match[2]) : 0;
            const ampm = match[3];
            if (ampm === 'pm' && hour < 12) hour += 12;
            if (ampm === 'am' && hour === 12) hour = 0;
            if (!ampm && hour < 8) hour += 12; // assume PM for "2" → 14:00
            if (hour < 8 || hour > 17) return null;
            const suffix = hour >= 12 ? 'PM' : 'AM';
            const displayHour = hour > 12 ? hour - 12 : (hour === 0 ? 12 : hour);
            return `${displayHour}:${String(mins).padStart(2, '0')} ${suffix}`;
        }
        return null;
    }

    // ── Send to Telegram via Apps Script relay (no deleteWebhook!) ──
    async function sendToTelegram(userName, userMessage) {
        try {
            const resp = await fetch(SHEETS_WEBHOOK, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain' },
                body: JSON.stringify({
                    action: 'chatbot_message',
                    visitorName: userName || 'Website Visitor',
                    message: userMessage
                })
            });
            const data = await resp.json();
            return (data.status === 'success' && data.messageId) ? data.messageId : null;
        } catch (e) {
            console.error('Telegram relay failed:', e);
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
                            Hi there! 👋 I'm the <strong>Gardners GM Assistant</strong>.<br><br>
                            I can help with pricing, bookings, subscriptions, lawn care tips, and anything about our services across Cornwall. I can even <strong>start a booking</strong> for you right here!<br><br>
                            📦 <strong>Subscriber?</strong> Enter your code (e.g. GGM-0042) to manage your visits.<br><br>
                            Just ask 😊
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

        // ── Sheet-Based Reply Polling (no webhook conflict) ──
        const sentMsgIds = [];
        let replyPoll = null;
        let pollTimer = null;

        function escapeHtml(str) {
            const d = document.createElement('div');
            d.textContent = str || '';
            return d.innerHTML;
        }

        function startReplyPolling() {
            if (replyPoll) return;
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
        }

        async function pollForReplies() {
            for (const msgId of sentMsgIds) {
                try {
                    const resp = await fetch(
                        `${SHEETS_WEBHOOK}?action=get_chat_replies&messageId=${encodeURIComponent(msgId)}`
                    );
                    const data = await resp.json();
                    if (data.status !== 'success' || !data.replies || !data.replies.length) continue;

                    for (const reply of data.replies) {
                        addMessage(
                            `<span class="admin-reply-label"><i class="fas fa-user-shield"></i> Chris</span> ${escapeHtml(reply.text)}`,
                            'bot'
                        );
                        if (!isOpen) {
                            widget.classList.add('has-notification');
                        }
                    }
                } catch (e) {
                    console.error('Reply poll error:', e);
                }
            }
        }

        async function handleSend() {
            const msg = input.value.trim();
            if (!msg) return;

            addMessage(msg, 'user');
            input.value = '';

            const typing = showTyping();

            // Simulate thinking delay
            await new Promise(r => setTimeout(r, 600 + Math.random() * 500));

            typing.remove();

            // 0) If we're in a subscription flow, handle that first
            if (subscriptionState) {
                const result = handleSubscriptionStep(msg);
                if (result.text) {
                    addMessage(result.text, 'bot');
                    return;
                }
                // Async operations needed
                if (subscriptionState.step === 'lookup') {
                    const lookupTyping = showTyping();
                    const portal = await fetchSubscriptionPortal(subscriptionState.data.jobNumber);
                    lookupTyping.remove();

                    if (portal.status === 'success') {
                        subscriptionState.data.subscription = portal.subscription;
                        subscriptionState.data.nextVisit = portal.nextVisit;
                        subscriptionState.data.upcomingVisits = portal.upcomingVisits;
                        subscriptionState.step = 'menu';
                        addMessage(
                            `✅ <strong>Subscription found!</strong> Welcome back, <strong>${portal.subscription.name}</strong>!<br><br>`
                            + buildSubscriptionMenu(portal.subscription, portal.nextVisit),
                            'bot'
                        );
                    } else {
                        subscriptionState = null;
                        addMessage(
                            `❌ ${portal.message || 'Subscription not found.'}<br><br>Please check your code and try again, or contact us on <a href="tel:01726432051" style="color:#2E7D32;">01726 432051</a>.`,
                            'bot'
                        );
                    }
                    return;
                }
                if (subscriptionState.step === 'submitting' && subscriptionState.data.pendingRequest) {
                    const subTyping = showTyping();
                    const req = subscriptionState.data.pendingRequest;
                    const result = await submitSubscriptionRequest(
                        subscriptionState.data.jobNumber, req.type, req.details
                    );
                    subTyping.remove();
                    subscriptionState.data.pendingRequest = null;
                    subscriptionState.step = 'menu';
                    const s = subscriptionState.data.subscription;
                    const nv = subscriptionState.data.nextVisit;
                    addMessage(
                        `${result.message || '✅ Request submitted!'}<br><br>` + buildSubscriptionMenu(s, nv),
                        'bot'
                    );
                    return;
                }
                if (subscriptionState.step === 'live_chat' && subscriptionState.data.pendingChat) {
                    const chatMsg = subscriptionState.data.pendingChat;
                    subscriptionState.data.pendingChat = null;
                    const subName = subscriptionState.data.subscription ? subscriptionState.data.subscription.name : 'Subscriber';
                    const sentMsgId = await sendToTelegram(subName + ' (' + subscriptionState.data.jobNumber + ')', chatMsg);
                    if (sentMsgId) {
                        sentMsgIds.push(sentMsgId);
                        startReplyPolling();
                        resetPollTimeout();
                        addMessage(
                            `📩 Message sent to Chris! He'll reply right here.<br><br><span style="font-size:0.85em;color:#888;"><i class="fas fa-circle-notch fa-spin" style="margin-right:4px;"></i> Waiting for reply... Type "menu" to go back to options.</span>`,
                            'bot'
                        );
                    } else {
                        addMessage(
                            `Sorry, couldn't send your message right now. Please call <a href="tel:01726432051" style="color:#2E7D32;">01726 432051</a>.`,
                            'bot'
                        );
                    }
                    return;
                }
                return;
            }

            // 1) If we're in a bespoke enquiry flow, handle that first
            if (bespokeState) {
                const response = handleBespokeStep(msg);
                if (response) { addMessage(response, 'bot'); return; }
            }

            // 2) If we're in a booking flow, handle that
            if (bookingState) {
                const response = handleBookingStep(msg);
                if (response) { addMessage(response, 'bot'); return; }
            }

            // 3) Check for subscription code (GGM-XXXX) or subscription triggers
            if (isSubscriptionCodeTrigger(msg)) {
                const code = extractJobNumber(msg);
                if (code) {
                    subscriptionState = { step: 'lookup', data: { jobNumber: code } };
                    const lookupTyping = showTyping();
                    const portal = await fetchSubscriptionPortal(code);
                    lookupTyping.remove();

                    if (portal.status === 'success') {
                        subscriptionState.data.subscription = portal.subscription;
                        subscriptionState.data.nextVisit = portal.nextVisit;
                        subscriptionState.data.upcomingVisits = portal.upcomingVisits;
                        subscriptionState.step = 'menu';
                        addMessage(
                            `✅ <strong>Subscription found!</strong> Welcome back, <strong>${portal.subscription.name}</strong>!<br><br>`
                            + buildSubscriptionMenu(portal.subscription, portal.nextVisit),
                            'bot'
                        );
                    } else {
                        subscriptionState = null;
                        addMessage(
                            `❌ ${portal.message || 'Subscription not found.'}<br><br>Please check your code and try again, or contact us on <a href="tel:01726432051" style="color:#2E7D32;">01726 432051</a>.`,
                            'bot'
                        );
                    }
                } else {
                    subscriptionState = { step: 'enter_code', data: {} };
                    addMessage(
                        `📦 <strong>Subscription Portal</strong><br><br>Please enter your subscription code (e.g. <strong>GGM-0042</strong>).<br><br><em>You can find this in your subscription confirmation email or visit summary emails.</em><br><br><em>Type "cancel" to exit.</em>`,
                        'bot'
                    );
                }
                return;
            }

            // 5) Check if user wants bespoke work
            if (isBespokeTrigger(msg)) {
                bespokeState = { step: 'description', data: {} };
                addMessage(
                    `🔧 <strong>Bespoke Work Enquiry</strong><br><br>
                    No problem — we handle all kinds of outdoor jobs! Please <strong>describe the work</strong> you need done in as much detail as possible.<br><br>
                    <em>e.g. "I need 30m of new fencing installed" or "My back garden needs landscaping from scratch"</em><br><br>
                    <em>Type "cancel" anytime to stop.</em>`,
                    'bot'
                );
                return;
            }

            // 6) Check if user wants to start a booking
            if (isBookingTrigger(msg)) {
                bookingState = { step: 'service', data: {} };
                addMessage(
                    `Let's get you booked in! 📅<br><br>Which service do you need?<br><br>
                    1️⃣ Lawn Cutting (from £30)<br>
                    2️⃣ Hedge Trimming (from £45)<br>
                    3️⃣ Scarifying (from £70)<br>
                    4️⃣ Lawn Treatment (from £35)<br>
                    5️⃣ Garden Clearance (from £100)<br>
                    6️⃣ Power Washing (from £50)<br>
                    7️⃣ Veg Patch Prep (from £70)<br>
                    8️⃣ Weeding Treatment (from £40)<br>
                    9️⃣ Drain Clearance (from £45)<br>
                    🔟 Gutter Cleaning (from £45)<br><br>
                    <em>Type a number or the service name. Type "cancel" anytime to stop.</em><br>
                    <em>Need something bespoke? Type <strong>"bespoke"</strong>.</em>`,
                    'bot'
                );
                return;
            }

            // 7) Try FAQ match
            const faqAnswer = findAnswer(msg);
            if (faqAnswer) {
                addMessage(faqAnswer, 'bot');
                return;
            }

            // 7.5) Try Dify AI (self-hosted LLM with business knowledge)
            if (DIFY_API_URL && DIFY_API_KEY) {
                try {
                    const difyResp = await fetch(DIFY_API_URL, {
                        method: 'POST',
                        headers: {
                            'Authorization': 'Bearer ' + DIFY_API_KEY,
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({
                            inputs: {},
                            query: msg,
                            user: 'website-visitor-' + (sessionStorage.getItem('ggm-visitor-id') || Math.random().toString(36).slice(2, 10)),
                            response_mode: 'blocking',
                            conversation_id: difyConversationId || '',
                        }),
                    });

                    if (difyResp.ok) {
                        const difyData = await difyResp.json();
                        const aiAnswer = (difyData.answer || '').trim();

                        // Store conversation ID for context continuity
                        if (difyData.conversation_id) {
                            difyConversationId = difyData.conversation_id;
                        }

                        // Only use AI answer if it's meaningful (not empty/generic)
                        if (aiAnswer && aiAnswer.length > 20) {
                            addMessage(
                                aiAnswer.replace(/\n/g, '<br>') +
                                '<br><br><span style="font-size:0.8em;color:#888;">🤖 <i>AI-assisted answer — <a href="tel:01726432051" style="color:#2E7D32;">call us</a> for specific queries</i></span>',
                                'bot'
                            );
                            return;
                        }
                    }
                } catch (difyErr) {
                    // Dify unavailable — fall through to Telegram
                    console.warn('Dify AI unavailable:', difyErr.message);
                }
            }

            // 8) No match — forward to Telegram for Chris to answer
            const sentMsgId = await sendToTelegram(null, msg);
            if (sentMsgId) {
                sentMsgIds.push(sentMsgId);
                startReplyPolling();
                resetPollTimeout();
                addMessage(
                    `Good question! I've forwarded that to <strong>Chris</strong> — he'll reply right here! 📩<br><br>
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

        sendBtn.addEventListener('click', handleSend);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') handleSend();
        });
    }

    return { init };
})();

// Auto-init when DOM is ready
document.addEventListener('DOMContentLoaded', ChatBot.init);
