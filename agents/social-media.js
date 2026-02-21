#!/usr/bin/env node
// ============================================================
//  Gardners GM — Automated Social Media Agent
//  Generates & publishes posts to Facebook, Instagram & X/Twitter
//  using local Ollama LLM + Pexels stock photos.
//
//  Usage:
//    node agents/social-media.js auto          → Auto-decide based on schedule
//    node agents/social-media.js facebook      → Post to Facebook only
//    node agents/social-media.js instagram     → Post to Instagram only
//    node agents/social-media.js twitter       → Post to X/Twitter only
//    node agents/social-media.js all           → Post to all platforms
//    node agents/social-media.js preview       → Generate post but don't publish
//    node agents/social-media.js share-blog    → Share latest blog post
//    node agents/social-media.js promo         → Promotional service post
//
//  Requires:
//    - Ollama running locally (http://localhost:11434)
//    - API tokens set in the config section below
//
//  Setup guide:
//    Facebook/Instagram: See SETUP_FACEBOOK below
//    X/Twitter: See SETUP_TWITTER below
// ============================================================

try { require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') }); } catch(e) {}

// ─── CONFIG ─────────────────────────────────────────────────
// Google Apps Script webhook (same as other agents)
const WEBHOOK    = process.env.SHEETS_WEBHOOK || '';

// Pexels (stock photos — same key as content agent)
const PEXELS_KEY = process.env.PEXELS_KEY || '';

// Telegram notifications
const TG_BOT  = process.env.TG_BOT_TOKEN || '';
const TG_CHAT = process.env.TG_CHAT_ID || '';

// Local LLM
const OLLAMA_URL = 'http://localhost:11434/api/generate';
const OLLAMA_MODEL = 'llama3.2';

// ─── SOCIAL MEDIA API TOKENS ────────────────────────────────
// Fill these in once you've set up each platform (instructions below)

// FACEBOOK + INSTAGRAM (Meta Graph API)
// ┌──────────────────────────────────────────────────────────┐
// │ SETUP_FACEBOOK:                                          │
// │ 1. Go to https://developers.facebook.com                 │
// │ 2. Create a new App → type "Business"                    │
// │ 3. Add "Facebook Login" and "Instagram Graph API"        │
// │ 4. In App Dashboard → Tools → Graph API Explorer:        │
// │    - Select your App                                     │
// │    - Get a Page Access Token with permissions:            │
// │      pages_manage_posts, pages_read_engagement,           │
// │      instagram_basic, instagram_content_publish           │
// │ 5. Exchange for a long-lived token (60-day):             │
// │    GET https://graph.facebook.com/v21.0/oauth/           │
// │    access_token?grant_type=fb_exchange_token&             │
// │    client_id=YOUR_APP_ID&client_secret=YOUR_APP_SECRET&  │
// │    fb_exchange_token=SHORT_LIVED_TOKEN                    │
// │ 6. Get Page ID: GET /me/accounts with that token         │
// │ 7. Get Instagram ID: GET /PAGE_ID?fields=               │
// │    instagram_business_account                             │
// │ 8. Paste values below                                    │
// │                                                          │
// │ TOKEN REFRESH: Tokens last ~60 days. The agent will      │
// │ warn you via Telegram 7 days before expiry.              │
// │ Run: node agents/social-media.js refresh-token           │
// └──────────────────────────────────────────────────────────┘
const FB_PAGE_ACCESS_TOKEN = process.env.FB_PAGE_ACCESS_TOKEN || '';  // Long-lived Page Access Token
const FB_PAGE_ID = process.env.FB_PAGE_ID || '';            // Facebook Page ID
const IG_BUSINESS_ACCOUNT_ID = process.env.IG_BUSINESS_ACCOUNT_ID || ''; // Instagram Business Account ID

// X / TWITTER (v2 API with OAuth 1.0a)
// ┌──────────────────────────────────────────────────────────┐
// │ SETUP_TWITTER:                                           │
// │ 1. Go to https://developer.x.com/en/portal               │
// │ 2. Sign up for Free tier (1,500 tweets/month)            │
// │ 3. Create a Project + App                                │
// │ 4. Under "Keys and Tokens", generate:                    │
// │    - API Key & Secret (Consumer Keys)                    │
// │    - Access Token & Secret (with Read+Write)             │
// │ 5. Paste all 4 values below                              │
// └──────────────────────────────────────────────────────────┘
const TWITTER_API_KEY = process.env.TWITTER_API_KEY || '';       // aka Consumer Key
const TWITTER_API_SECRET = process.env.TWITTER_API_SECRET || '';    // aka Consumer Secret
const TWITTER_ACCESS_TOKEN = process.env.TWITTER_ACCESS_TOKEN || '';  // User Access Token
const TWITTER_ACCESS_SECRET = process.env.TWITTER_ACCESS_SECRET || ''; // User Access Secret

// Token expiry tracking (set when you paste a new FB token)
const FB_TOKEN_SET_DATE = process.env.FB_TOKEN_SET_DATE || '';     // e.g. '2026-02-11' — date you pasted the token
const FB_TOKEN_DAYS = 60;        // Long-lived tokens last ~60 days

// ─── SOCIAL CONTENT CALENDAR ────────────────────────────────
// 7 post types that rotate throughout the week
const POST_TYPES = {
  0: 'tip',        // Sunday    — Gardening tip
  1: 'service',    // Monday    — Service spotlight
  2: 'blog',       // Tuesday   — Share blog post
  3: 'seasonal',   // Wednesday — Seasonal advice
  4: 'testimonial',// Thursday  — Customer testimonial / review
  5: 'promo',      // Friday    — Offer / promotion
  6: 'cornwall'    // Saturday  — Cornwall community / local
};

// Service rotation — cycles through a different service each week
const SERVICE_ROTATION = [
  'lawn-cutting', 'hedge-trimming', 'scarifying', 'lawn-treatment',
  'garden-clearance', 'power-washing', 'veg-patch', 'weeding-treatment',
  'fence-repair', 'drain-clearance', 'gutter-cleaning', 'emergency-tree'
];

const SERVICE_NAMES = {
  'lawn-cutting': 'Lawn Cutting', 'hedge-trimming': 'Hedge Trimming',
  'scarifying': 'Scarifying', 'lawn-treatment': 'Lawn Treatment',
  'garden-clearance': 'Garden Clearance', 'power-washing': 'Power Washing',
  'veg-patch': 'Vegetable Patch Preparation', 'weeding-treatment': 'Weeding Treatment',
  'fence-repair': 'Fence Repair', 'drain-clearance': 'Drain Clearance',
  'gutter-cleaning': 'Gutter Cleaning', 'emergency-tree': 'Emergency Tree Surgery'
};

// Month-specific seasonal topics
const SEASONAL_TOPICS = {
  1:  'winter lawn protection, January garden tasks, frost damage prevention',
  2:  'spring preparation, first signs of growth, when to start mowing',
  3:  'spring lawn revival, moss treatment, first mow of the year',
  4:  'lawn feeding, weed control beginning, mowing frequency',
  5:  'summer preparation, rapid grass growth, garden maintenance',
  6:  'summer lawn care, watering in heat, hedge trimming season',
  7:  'drought survival, raising mowing height, brown patch prevention',
  8:  'late summer care, preparing for autumn renovation, garden tidy',
  9:  'scarifying and aeration, overseeding, autumn feed, lawn renovation',
  10: 'leaf clearance, last mowing, winterising garden, power washing before frost',
  11: 'winter prep, final lawn treatment, putting garden to bed',
  12: 'winter garden beauty, tool maintenance, planning for next year'
};

// Hashtag sets by platform
const HASHTAGS = {
  cornwall: '#Cornwall #Cornish #Kernow #CornwallLife #LoveCornwall',
  gardening: '#Gardening #GardenMaintenance #LawnCare #GardenTips #GreenFingers',
  business: '#GardnersGM #CornwallGardener #ProfessionalGardener #LocalBusiness #SupportLocal',
  seasonal: { 1: '#WinterGarden', 2: '#SpringPrep', 3: '#SpringGardening', 4: '#AprilGarden',
              5: '#SummerReady', 6: '#SummerGarden', 7: '#SummerHeat', 8: '#LateSummer',
              9: '#AutumnGarden', 10: '#WinterPrep', 11: '#WinterReady', 12: '#WinterGarden' }
};

// ─── HELPER: Logger ─────────────────────────────────────────
function log(msg) {
  const ts = new Date().toLocaleTimeString('en-GB');
  console.log('[' + ts + '] ' + msg);
}

// ─── HELPER: Ollama LLM ────────────────────────────────────
async function askOllama(prompt, temperature = 0.75) {
  log('🤖 Asking Ollama (' + OLLAMA_MODEL + ')...');
  const resp = await fetch(OLLAMA_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      prompt,
      stream: false,
      options: { temperature, num_predict: 1024, top_p: 0.9 }
    })
  });
  if (!resp.ok) throw new Error('Ollama error: ' + resp.status);
  const data = await resp.json();
  return (data.response || '').trim();
}

// ─── HELPER: Sanitise content ───────────────────────────────
function sanitiseContent(text) {
  text = text.replace(/\b0\d{3,4}\s?\d{3}\s?\d{3,4}\b/g, '01726 432051');
  text = text.replace(/info@gardners?ground(maintenance|maint)\.co\.uk/gi, 'info@gardnersgm.co.uk');
  text = text.replace(/contact@gardners?ground(maintenance|maint)\.co\.uk/gi, 'info@gardnersgm.co.uk');
  text = text.replace(/hello@gardners?ground(maintenance|maint)\.co\.uk/gi, 'info@gardnersgm.co.uk');
  text = text.replace(/info@gardners?gm(aint|aintenance)?\.co\.uk/gi, 'info@gardnersgm.co.uk');
  text = text.replace(/gardnersgroundmaintenance\.co\.uk/gi, 'gardnersgm.co.uk');
  text = text.replace(/gardnergroundmaintenance\.co\.uk/gi, 'gardnersgm.co.uk');
  text = text.replace(/www\.gardnersgm\.co\.uk/gi, 'gardnersgm.co.uk');
  // Remove markdown links
  text = text.replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1');
  return text;
}

// ─── HELPER: Pexels stock photo ─────────────────────────────
async function fetchPexelsImage(query) {
  log('📸 Fetching stock photo: "' + query + '"');
  const queries = [query, query.split(' ').slice(0, 2).join(' ') + ' garden', 'garden Cornwall'];
  for (const q of queries) {
    try {
      const resp = await fetch('https://api.pexels.com/v1/search?query=' + encodeURIComponent(q) + '&per_page=5&orientation=landscape', {
        headers: { 'Authorization': PEXELS_KEY }
      });
      if (resp.status !== 200) continue;
      const data = await resp.json();
      if (data.photos && data.photos.length > 0) {
        // Pick a random photo from top 5
        const pick = data.photos[Math.floor(Math.random() * data.photos.length)];
        log('  ✅ Got photo: ' + pick.src.medium);
        return {
          url: pick.src.large,      // 940px — good for social
          medium: pick.src.medium,   // 350px — preview
          original: pick.src.original,
          alt: pick.alt || q,
          credit: pick.photographer
        };
      }
    } catch (e) { /* try next query */ }
  }
  log('  ⚠️ No photo found, will post without image');
  return null;
}

// ─── HELPER: Telegram notification ──────────────────────────
async function sendTelegram(msg) {
  try {
    await fetch('https://api.telegram.org/bot' + TG_BOT + '/sendMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TG_CHAT,
        parse_mode: 'Markdown',
        text: msg,
        disable_web_page_preview: true
      })
    });
  } catch (e) {
    log('  ⚠️ Telegram failed: ' + e.message);
  }
}

// ─── HELPER: Check FB token expiry ─────────────────────────
function checkTokenExpiry() {
  if (!FB_TOKEN_SET_DATE) return;
  const set = new Date(FB_TOKEN_SET_DATE);
  const expiry = new Date(set.getTime() + FB_TOKEN_DAYS * 24 * 60 * 60 * 1000);
  const daysLeft = Math.ceil((expiry - new Date()) / (24 * 60 * 60 * 1000));
  if (daysLeft <= 0) {
    log('🚨 Facebook token has EXPIRED! Refresh it now.');
    sendTelegram('🚨 *SOCIAL AGENT — FB TOKEN EXPIRED*\n\nYour Facebook Page token has expired. Posts will fail until you refresh it.\n\nRun: `node agents/social-media.js refresh-token`');
  } else if (daysLeft <= 7) {
    log('⚠️ Facebook token expires in ' + daysLeft + ' days — refresh soon!');
    sendTelegram('⚠️ *SOCIAL AGENT — TOKEN EXPIRING*\n\nFacebook token expires in *' + daysLeft + ' days*.\n\nRefresh: `node agents/social-media.js refresh-token`');
  }
}

// ─── HELPER: Get latest blog post from website ──────────────
async function getLatestBlog() {
  try {
    const resp = await fetch(WEBHOOK + '?action=get_blog_posts');
    const data = await resp.json();
    if (data.posts && data.posts.length > 0) {
      return data.posts[0]; // Most recent
    }
  } catch (e) {
    log('  ⚠️ Could not fetch blog posts: ' + e.message);
  }
  return null;
}

// ─── HELPER: Twitter OAuth 1.0a signature ───────────────────
// Implements OAuth 1.0a HMAC-SHA1 signing for Twitter API v2
const crypto = require('crypto');

function percentEncode(str) {
  return encodeURIComponent(str).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

function generateOAuthSignature(method, url, params, consumerSecret, tokenSecret) {
  const sortedParams = Object.keys(params).sort().map(k => percentEncode(k) + '=' + percentEncode(params[k])).join('&');
  const baseString = method.toUpperCase() + '&' + percentEncode(url) + '&' + percentEncode(sortedParams);
  const signingKey = percentEncode(consumerSecret) + '&' + percentEncode(tokenSecret);
  return crypto.createHmac('sha1', signingKey).update(baseString).digest('base64');
}

function buildOAuthHeader(method, url, extraParams = {}) {
  const oauthParams = {
    oauth_consumer_key: TWITTER_API_KEY,
    oauth_nonce: crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: TWITTER_ACCESS_TOKEN,
    oauth_version: '1.0'
  };

  const allParams = { ...oauthParams, ...extraParams };
  oauthParams.oauth_signature = generateOAuthSignature(method, url, allParams, TWITTER_API_SECRET, TWITTER_ACCESS_SECRET);

  const header = 'OAuth ' + Object.keys(oauthParams).sort().map(k =>
    percentEncode(k) + '="' + percentEncode(oauthParams[k]) + '"'
  ).join(', ');

  return header;
}

// ============================================================
// CONTENT GENERATORS — One for each post type
// ============================================================

async function generateTipPost() {
  const month = new Date().getMonth() + 1;
  const topic = SEASONAL_TOPICS[month];
  const prompt = `You are the social media manager for "Gardners Ground Maintenance", a professional garden company in Roche, Cornwall, UK.

Write a short, engaging gardening tip post for Facebook/Instagram. 
Current month: ${new Date().toLocaleDateString('en-GB', { month: 'long' })}
Seasonal context: ${topic}

Rules:
- 2-4 short paragraphs, max 200 words total
- Start with an attention-grabbing line (use an emoji)
- Include one actionable tip readers can use right now
- Mention Cornwall's climate if relevant
- Friendly, expert tone — like a knowledgeable neighbour
- End with a soft CTA like "Need a hand? We're here to help" or similar
- Do NOT use hashtags (we add those separately)
- Do NOT include "Gardners Ground Maintenance" in the text — that's the page name
- Do NOT include phone numbers or email
- Use British English

Write the post now:`;

  return sanitiseContent(await askOllama(prompt));
}

async function generateServicePost(serviceKey) {
  const serviceName = SERVICE_NAMES[serviceKey] || serviceKey;
  const prompt = `You are the social media manager for "Gardners Ground Maintenance", a professional garden company in Roche, Cornwall, UK.

Write a short, engaging Facebook/Instagram post spotlighting this service: "${serviceName}"

Rules:
- 2-3 short paragraphs, max 180 words
- Highlight the benefit to the customer, not just what you do
- Include what's typically included in the service
- Mention pricing starts from (use "from £" pricing — keep it vague like "from just £30")
- Friendly, professional tone
- End with a clear CTA — "Book online at gardnersgm.co.uk" or "Link in bio"
- Do NOT use hashtags
- Do NOT include phone numbers or email
- Use British English

Write the post now:`;

  return sanitiseContent(await askOllama(prompt));
}

async function generateBlogSharePost(blog) {
  if (!blog) return null;
  const prompt = `You are the social media manager for "Gardners Ground Maintenance", a professional garden company in Roche, Cornwall.

Write a short social media post to share this blog article:
Title: "${blog.title}"
Excerpt: "${(blog.excerpt || '').substring(0, 200)}"

Rules:
- 2-3 lines max, compelling and conversational
- Tease the content — make people want to click through
- End with: "Read the full article on our blog → gardnersgm.co.uk/blog"
- Do NOT use hashtags
- Use British English

Write the post now:`;

  return sanitiseContent(await askOllama(prompt, 0.6));
}

async function generateSeasonalPost() {
  const month = new Date().getMonth() + 1;
  const topic = SEASONAL_TOPICS[month];
  const prompt = `You are the social media manager for "Gardners Ground Maintenance", a professional garden company in Roche, Cornwall.

Write a seasonal gardening advice post.
Month: ${new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}
Topics: ${topic}

Rules:
- 3-5 bullet points of seasonal tasks for this month
- Start with "🌿 ${new Date().toLocaleDateString('en-GB', { month: 'long' })} Garden Checklist" or similar
- Each bullet is 1 sentence, actionable
- End with "Need help ticking these off? We've got you covered 💪"
- Max 200 words
- Do NOT use hashtags
- Use British English

Write the post now:`;

  return sanitiseContent(await askOllama(prompt, 0.65));
}

async function generateTestimonialPost() {
  // Try to fetch real testimonials from the site
  let testimonial = null;
  try {
    const resp = await fetch(WEBHOOK + '?action=get_testimonials');
    const data = await resp.json();
    if (data.testimonials && data.testimonials.length > 0) {
      // Pick a random one
      testimonial = data.testimonials[Math.floor(Math.random() * data.testimonials.length)];
    }
  } catch (e) { /* generate one */ }

  if (testimonial && testimonial.text) {
    return `⭐⭐⭐⭐⭐\n\n"${testimonial.text}"\n\n— ${testimonial.name || 'Happy Customer'}, ${testimonial.location || 'Cornwall'}\n\nThank you for the kind words! We love what we do and it means the world when our customers notice 🌿\n\nBook your garden service at gardnersgm.co.uk`;
  }

  // Fallback: generate a generic "we love our reviews" post
  const prompt = `Write a short social media post (3-4 lines) for a gardening company called Gardners Ground Maintenance in Cornwall, encouraging customers to leave reviews. 
Be warm and genuine. Mention Google reviews. End with the website gardnersgm.co.uk. No hashtags. British English.`;
  return sanitiseContent(await askOllama(prompt, 0.7));
}

async function generatePromoPost() {
  const month = new Date().getMonth() + 1;
  const monthName = new Date().toLocaleDateString('en-GB', { month: 'long' });
  const prompt = `You are the social media manager for "Gardners Ground Maintenance", a professional garden company in Roche, Cornwall.

Write a promotional social media post for ${monthName}. Choose one of these angles:
- Subscription plans save 25% vs one-off bookings
- Free quote visits available
- New customer special
- Seasonal service bundle

Rules:
- Max 150 words, punchy and compelling
- Include a clear offer or value proposition
- Create urgency without being pushy
- CTA: "Book at gardnersgm.co.uk" or "DM us for details"
- Do NOT use hashtags or phone numbers
- Use British English

Write the post now:`;

  return sanitiseContent(await askOllama(prompt, 0.7));
}

async function generateCornwallPost() {
  const prompt = `You are the social media manager for "Gardners Ground Maintenance", based in Roche, Cornwall.

Write a short, community-focused social media post. Choose one of these themes:
- Appreciation for Cornwall's beauty / Cornish gardens
- Supporting local businesses
- Weather & how it affects gardens in Cornwall
- A fun garden fact or myth buster
- Asking followers a question (e.g. "What's your favourite thing about your garden?")

Rules:
- 2-3 lines, casual and friendly
- Make it feel local and genuine, not corporate
- Encourage comments/engagement with a question
- Do NOT use hashtags, phone numbers, or email
- Use British English

Write the post now:`;

  return sanitiseContent(await askOllama(prompt, 0.8));
}

// ============================================================
// PLATFORM PUBLISHERS
// ============================================================

async function postToFacebook(text, imageUrl) {
  if (!FB_PAGE_ACCESS_TOKEN || !FB_PAGE_ID) {
    log('⚠️ Facebook not configured — skipping');
    return { success: false, reason: 'not-configured' };
  }

  try {
    let endpoint, body;

    if (imageUrl) {
      // Photo post (higher engagement)
      endpoint = `https://graph.facebook.com/v21.0/${FB_PAGE_ID}/photos`;
      body = new URLSearchParams({
        url: imageUrl,
        message: text,
        access_token: FB_PAGE_ACCESS_TOKEN
      });
    } else {
      // Text-only post
      endpoint = `https://graph.facebook.com/v21.0/${FB_PAGE_ID}/feed`;
      body = new URLSearchParams({
        message: text,
        access_token: FB_PAGE_ACCESS_TOKEN
      });
    }

    const resp = await fetch(endpoint, { method: 'POST', body });
    const data = await resp.json();

    if (data.id || data.post_id) {
      log('  ✅ Facebook posted! ID: ' + (data.id || data.post_id));
      return { success: true, id: data.id || data.post_id };
    } else {
      log('  ❌ Facebook error: ' + JSON.stringify(data.error || data));
      return { success: false, error: data.error?.message || 'Unknown error' };
    }
  } catch (e) {
    log('  ❌ Facebook failed: ' + e.message);
    return { success: false, error: e.message };
  }
}

async function postToInstagram(text, imageUrl) {
  if (!FB_PAGE_ACCESS_TOKEN || !IG_BUSINESS_ACCOUNT_ID) {
    log('⚠️ Instagram not configured — skipping');
    return { success: false, reason: 'not-configured' };
  }

  if (!imageUrl) {
    log('  ⚠️ Instagram requires an image — skipping this post');
    return { success: false, reason: 'no-image' };
  }

  try {
    // Step 1: Create media container
    const createResp = await fetch(`https://graph.facebook.com/v21.0/${IG_BUSINESS_ACCOUNT_ID}/media`, {
      method: 'POST',
      body: new URLSearchParams({
        image_url: imageUrl,
        caption: text,
        access_token: FB_PAGE_ACCESS_TOKEN
      })
    });
    const createData = await createResp.json();

    if (!createData.id) {
      log('  ❌ Instagram container failed: ' + JSON.stringify(createData.error || createData));
      return { success: false, error: createData.error?.message || 'Container creation failed' };
    }

    // Step 2: Wait for processing (Instagram needs time to fetch the image)
    log('  ⏳ Waiting for Instagram to process image...');
    await new Promise(r => setTimeout(r, 10000)); // 10 seconds

    // Step 3: Publish
    const publishResp = await fetch(`https://graph.facebook.com/v21.0/${IG_BUSINESS_ACCOUNT_ID}/media_publish`, {
      method: 'POST',
      body: new URLSearchParams({
        creation_id: createData.id,
        access_token: FB_PAGE_ACCESS_TOKEN
      })
    });
    const publishData = await publishResp.json();

    if (publishData.id) {
      log('  ✅ Instagram posted! ID: ' + publishData.id);
      return { success: true, id: publishData.id };
    } else {
      log('  ❌ Instagram publish failed: ' + JSON.stringify(publishData.error || publishData));
      return { success: false, error: publishData.error?.message || 'Publish failed' };
    }
  } catch (e) {
    log('  ❌ Instagram failed: ' + e.message);
    return { success: false, error: e.message };
  }
}

async function postToTwitter(text) {
  if (!TWITTER_API_KEY || !TWITTER_ACCESS_TOKEN) {
    log('⚠️ Twitter/X not configured — skipping');
    return { success: false, reason: 'not-configured' };
  }

  try {
    // Truncate to 280 chars (Twitter limit)
    let tweet = text;
    if (tweet.length > 280) {
      tweet = tweet.substring(0, 277) + '...';
    }

    const url = 'https://api.x.com/2/tweets';
    const body = JSON.stringify({ text: tweet });
    const authHeader = buildOAuthHeader('POST', url);

    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json'
      },
      body
    });

    const data = await resp.json();

    if (data.data && data.data.id) {
      log('  ✅ Twitter posted! ID: ' + data.data.id);
      return { success: true, id: data.data.id };
    } else {
      log('  ❌ Twitter error: ' + JSON.stringify(data));
      return { success: false, error: data.detail || data.title || 'Unknown error' };
    }
  } catch (e) {
    log('  ❌ Twitter failed: ' + e.message);
    return { success: false, error: e.message };
  }
}

// ============================================================
// CONTENT FORMATTER — Adapt text per platform
// ============================================================

function formatForPlatform(baseText, platform) {
  const month = new Date().getMonth() + 1;
  const seasonTag = HASHTAGS.seasonal[month] || '';

  switch (platform) {
    case 'facebook':
      // Facebook: full text + minimal hashtags (3-5)
      return baseText + '\n\n' + [HASHTAGS.business.split(' ')[0], HASHTAGS.cornwall.split(' ')[0], seasonTag].filter(Boolean).join(' ');

    case 'instagram':
      // Instagram: full text + lots of hashtags (15-20) separated by line breaks
      return baseText + '\n\n.\n.\n.\n' + [HASHTAGS.gardening, HASHTAGS.cornwall, HASHTAGS.business, seasonTag].join(' ');

    case 'twitter':
      // Twitter: shortened text + 2-3 hashtags, max 280 chars
      const tags = ' ' + [HASHTAGS.business.split(' ')[0], seasonTag].filter(Boolean).join(' ');
      const maxText = 280 - tags.length;
      let tweet = baseText.length > maxText ? baseText.substring(0, maxText - 3) + '...' : baseText;
      return tweet + tags;

    default:
      return baseText;
  }
}

// ============================================================
// MAIN POST ORCHESTRATOR
// ============================================================

async function createAndPublishPost(postType, platforms) {
  log('');
  log('━━━ Generating ' + postType + ' post ━━━');

  let baseText = '';
  let imageQuery = 'garden Cornwall landscape';

  // Generate content based on post type
  switch (postType) {
    case 'tip':
      baseText = await generateTipPost();
      imageQuery = SEASONAL_TOPICS[new Date().getMonth() + 1].split(',')[0] + ' garden';
      break;

    case 'service': {
      const weekNum = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 1)) / (7 * 24 * 60 * 60 * 1000));
      const serviceKey = SERVICE_ROTATION[weekNum % SERVICE_ROTATION.length];
      baseText = await generateServicePost(serviceKey);
      imageQuery = SERVICE_NAMES[serviceKey] + ' garden';
      break;
    }

    case 'blog': {
      const blog = await getLatestBlog();
      if (blog) {
        baseText = await generateBlogSharePost(blog);
        imageQuery = (blog.title || 'garden').substring(0, 40);
      } else {
        log('  No blog posts found — falling back to tip');
        baseText = await generateTipPost();
      }
      break;
    }

    case 'seasonal':
      baseText = await generateSeasonalPost();
      imageQuery = SEASONAL_TOPICS[new Date().getMonth() + 1].split(',')[0] + ' garden';
      break;

    case 'testimonial':
      baseText = await generateTestimonialPost();
      imageQuery = 'beautiful garden lawn Cornwall';
      break;

    case 'promo':
      baseText = await generatePromoPost();
      imageQuery = 'professional gardener working';
      break;

    case 'cornwall':
      baseText = await generateCornwallPost();
      imageQuery = 'Cornwall landscape coast garden';
      break;

    default:
      throw new Error('Unknown post type: ' + postType);
  }

  if (!baseText || baseText.length < 20) {
    throw new Error('Generated content too short (' + (baseText || '').length + ' chars)');
  }

  log('  📝 Generated ' + baseText.length + ' chars');

  // Fetch an image
  const image = await fetchPexelsImage(imageQuery);

  // Publish to each platform
  const results = {};

  for (const platform of platforms) {
    log('  📤 Publishing to ' + platform + '...');
    const formatted = formatForPlatform(baseText, platform);

    switch (platform) {
      case 'facebook':
        results.facebook = await postToFacebook(formatted, image?.url);
        break;
      case 'instagram':
        results.instagram = await postToInstagram(formatted, image?.url);
        break;
      case 'twitter':
        results.twitter = await postToTwitter(formatted);
        break;
    }
  }

  return { postType, baseText, image, results };
}

// ============================================================
// AUTO SCHEDULER — Decides what to post today
// ============================================================

function autoDecidePost() {
  const dayOfWeek = new Date().getDay();
  return POST_TYPES[dayOfWeek] || 'tip';
}

function getDefaultPlatforms() {
  const platforms = [];
  if (FB_PAGE_ACCESS_TOKEN && FB_PAGE_ID) platforms.push('facebook');
  if (FB_PAGE_ACCESS_TOKEN && IG_BUSINESS_ACCOUNT_ID) platforms.push('instagram');
  if (TWITTER_API_KEY && TWITTER_ACCESS_TOKEN) platforms.push('twitter');
  return platforms;
}

// ============================================================
// TOKEN REFRESH GUIDE
// ============================================================

function showRefreshGuide() {
  console.log(`
  ╔══════════════════════════════════════════════════════════╗
  ║         FACEBOOK TOKEN REFRESH GUIDE                    ║
  ╠══════════════════════════════════════════════════════════╣
  ║                                                          ║
  ║  1. Go to: https://developers.facebook.com/tools/explorer ║
  ║  2. Select your App and Page                             ║
  ║  3. Click "Generate Access Token"                        ║
  ║  4. Grant the required permissions                       ║
  ║  5. Copy the SHORT-LIVED token                           ║
  ║                                                          ║
  ║  6. Exchange for LONG-LIVED token:                       ║
  ║     Open this URL (replace YOUR_APP_ID etc):             ║
  ║                                                          ║
  ║     https://graph.facebook.com/v21.0/oauth/access_token  ║
  ║     ?grant_type=fb_exchange_token                        ║
  ║     &client_id=YOUR_APP_ID                               ║
  ║     &client_secret=YOUR_APP_SECRET                       ║
  ║     &fb_exchange_token=SHORT_LIVED_TOKEN                 ║
  ║                                                          ║
  ║  7. Copy the new long-lived token                        ║
  ║  8. Paste into FB_PAGE_ACCESS_TOKEN in                   ║
  ║     agents/social-media.js                               ║
  ║  9. Update FB_TOKEN_SET_DATE to today's date             ║
  ║                                                          ║
  ╚══════════════════════════════════════════════════════════╝
  `);
}

// ============================================================
// MAIN
// ============================================================

async function main() {
  const args = process.argv.slice(2);
  const command = (args[0] || 'auto').toLowerCase();

  log('═══════════════════════════════════════════');
  log('📱 Gardners GM Social Media Agent');
  log('═══════════════════════════════════════════');
  log('📅 Date: ' + new Date().toLocaleDateString('en-GB'));
  log('🤖 Model: ' + OLLAMA_MODEL);
  log('📌 Mode: ' + command);

  // Check token expiry
  checkTokenExpiry();

  // Special commands
  if (command === 'refresh-token') {
    showRefreshGuide();
    return;
  }

  // Check Ollama
  try {
    const check = await fetch('http://localhost:11434/api/tags');
    if (!check.ok) throw new Error('Not running');
    log('✅ Ollama is running');
  } catch (e) {
    log('❌ Ollama is not running! Start it with: ollama serve');
    process.exit(1);
  }

  // Determine what to post and where
  let postType, platforms;

  switch (command) {
    case 'auto':
      postType = autoDecidePost();
      platforms = getDefaultPlatforms();
      if (platforms.length === 0) {
        log('');
        log('⚠️  No social platforms configured yet!');
        log('   Edit agents/social-media.js and add your API tokens.');
        log('   See the setup guides at the top of the file.');
        log('');
        log('   Running in PREVIEW mode instead...');
        platforms = ['preview'];
      }
      break;
    case 'facebook':
      postType = autoDecidePost();
      platforms = ['facebook'];
      break;
    case 'instagram':
      postType = autoDecidePost();
      platforms = ['instagram'];
      break;
    case 'twitter':
      postType = autoDecidePost();
      platforms = ['twitter'];
      break;
    case 'all':
      postType = autoDecidePost();
      platforms = ['facebook', 'instagram', 'twitter'];
      break;
    case 'preview':
      postType = autoDecidePost();
      platforms = ['preview'];
      break;
    case 'share-blog':
      postType = 'blog';
      platforms = getDefaultPlatforms().length > 0 ? getDefaultPlatforms() : ['preview'];
      break;
    case 'promo':
      postType = 'promo';
      platforms = getDefaultPlatforms().length > 0 ? getDefaultPlatforms() : ['preview'];
      break;
    default:
      // Check if it's a post type name
      if (Object.values(POST_TYPES).includes(command)) {
        postType = command;
        platforms = getDefaultPlatforms().length > 0 ? getDefaultPlatforms() : ['preview'];
      } else {
        log('Unknown command: ' + command);
        log('Usage: node agents/social-media.js [auto|facebook|instagram|twitter|all|preview|share-blog|promo]');
        process.exit(1);
      }
  }

  const dayName = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date().getDay()];
  log('📋 Post type: ' + postType + ' (' + dayName + ')');
  log('🎯 Platforms: ' + (platforms.includes('preview') ? 'Preview only' : platforms.join(', ')));
  log('');

  try {
    if (platforms.includes('preview')) {
      // Preview mode — generate but don't publish
      log('━━━ PREVIEW MODE ━━━');
      const baseText = await (async () => {
        switch (postType) {
          case 'tip': return generateTipPost();
          case 'service': {
            const wk = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 1)) / (7 * 24 * 60 * 60 * 1000));
            return generateServicePost(SERVICE_ROTATION[wk % SERVICE_ROTATION.length]);
          }
          case 'blog': {
            const b = await getLatestBlog();
            return b ? generateBlogSharePost(b) : generateTipPost();
          }
          case 'seasonal': return generateSeasonalPost();
          case 'testimonial': return generateTestimonialPost();
          case 'promo': return generatePromoPost();
          case 'cornwall': return generateCornwallPost();
          default: return generateTipPost();
        }
      })();

      log('');
      log('┌─ FACEBOOK VERSION: ─────────────────────');
      console.log(formatForPlatform(baseText, 'facebook'));
      log('├─ INSTAGRAM VERSION: ────────────────────');
      console.log(formatForPlatform(baseText, 'instagram'));
      log('├─ TWITTER VERSION: ──────────────────────');
      console.log(formatForPlatform(baseText, 'twitter'));
      log('└─────────────────────────────────────────');

      await sendTelegram(
        '📱 *SOCIAL MEDIA — Preview*\n'
        + '━━━━━━━━━━━━━━━━━━━━\n\n'
        + '📋 Type: ' + postType + '\n'
        + '📅 ' + dayName + '\n\n'
        + baseText.substring(0, 500)
        + (baseText.length > 500 ? '...' : '')
        + '\n\n_Preview only — no platforms configured yet_'
      );
    } else {
      // Publish for real
      const result = await createAndPublishPost(postType, platforms);

      // Build Telegram summary
      let tgMsg = '📱 *SOCIAL MEDIA POSTED*\n'
        + '━━━━━━━━━━━━━━━━━━━━\n\n'
        + '📋 *Type:* ' + postType + '\n'
        + '📅 *Day:* ' + dayName + '\n'
        + '📸 *Image:* ' + (result.image ? '✅ ' + result.image.credit : '❌ None') + '\n\n';

      for (const [platform, res] of Object.entries(result.results)) {
        const icon = platform === 'facebook' ? '📘' : platform === 'instagram' ? '📸' : '🐦';
        if (res.success) {
          tgMsg += `${icon} *${platform}:* ✅ Posted (ID: ${res.id})\n`;
        } else if (res.reason === 'not-configured') {
          tgMsg += `${icon} *${platform}:* ⏭ Not configured\n`;
        } else {
          tgMsg += `${icon} *${platform}:* ❌ ${res.error || res.reason}\n`;
        }
      }

      tgMsg += '\n📝 *Preview:*\n' + result.baseText.substring(0, 300) + (result.baseText.length > 300 ? '...' : '');

      await sendTelegram(tgMsg);
    }

    log('');
    log('═══════════════════════════════════════════');
    log('✅ Social Media Agent finished');
    log('═══════════════════════════════════════════');

  } catch (err) {
    log('❌ Error: ' + err.message);
    await sendTelegram('❌ *SOCIAL MEDIA AGENT FAILED*\n\n' + err.message);
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
