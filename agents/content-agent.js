#!/usr/bin/env node
// ============================================================
//  Gardners GM — Automated Content Agent
//  Generates blog posts + newsletters using local Ollama LLM
//  with Pexels stock photos, then publishes via webhook.
//
//  Usage:
//    node agents/content-agent.js blog        → Generate & publish 1 blog post
//    node agents/content-agent.js newsletter   → Generate & send monthly newsletter
//    node agents/content-agent.js both         → Blog post + newsletter
//    node agents/content-agent.js preview      → Generate blog post but save as draft
//    node agents/content-agent.js              → Auto-decide based on schedule
//
//  Requires: Ollama running locally (http://localhost:11434)
// ============================================================

try { require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') }); } catch(e) {}

const WEBHOOK    = process.env.SHEETS_WEBHOOK || '';
const PEXELS_KEY = process.env.PEXELS_KEY || '';
const TG_BOT     = process.env.TG_BOT_TOKEN || '';
const TG_CHAT    = process.env.TG_CHAT_ID || '';
const OLLAMA_BASE = 'http://localhost:11434';
const OLLAMA_URL = OLLAMA_BASE + '/api/generate';
let OLLAMA_MODEL = 'llama3.1';  // default, overridden by auto-detect

// Auto-detect the best installed Ollama model at startup
const MODEL_PREFERENCE = [
  'llama3.1:latest', 'llama3.2:latest', 'llama3.1', 'llama3.2',
  'mistral:latest', 'gemma2:latest', 'qwen2.5:latest',
];

async function detectModel() {
  try {
    const resp = await fetch(OLLAMA_BASE + '/api/tags');
    if (!resp.ok) return;
    const data = await resp.json();
    const available = (data.models || []).map(m => m.name);
    if (!available.length) return;
    for (const pref of MODEL_PREFERENCE) {
      const match = available.find(a => a === pref || a.startsWith(pref.split(':')[0] + ':'));
      if (match) { OLLAMA_MODEL = match; log('🤖 Auto-detected model: ' + match); return; }
    }
    OLLAMA_MODEL = available[0];
    log('🤖 Fallback model: ' + OLLAMA_MODEL);
  } catch(e) { log('⚠️ Model detection failed, using default: ' + OLLAMA_MODEL); }
}

// ============================================================
// SEASONAL CONTENT CALENDAR — 52 weeks of expert topics
// ============================================================

const CONTENT_CALENDAR = {
  1:  { month: 'January',   topics: [
    { title: 'Winter Lawn Care: Protecting Your Grass in the Cold Months', cat: 'seasonal', tags: 'winter lawn care, frost protection, dormant grass, Cornwall gardens' },
    { title: 'Planning Your Garden for the Year Ahead', cat: 'tips', tags: 'garden planning, 2026 garden, seasonal planting, garden goals' },
    { title: 'How to Maintain Garden Tools During Winter', cat: 'tips', tags: 'garden tools, tool maintenance, winter storage, sharp blades' }
  ]},
  2:  { month: 'February', topics: [
    { title: 'Preparing Your Lawn for Spring: February Checklist', cat: 'seasonal', tags: 'spring prep, lawn checklist, February garden, early spring' },
    { title: 'When to Start Scarifying Your Lawn', cat: 'tips', tags: 'scarifying, lawn thatch, moss removal, lawn renovation' },
    { title: 'The Best Time to Trim Hedges in Cornwall', cat: 'tips', tags: 'hedge trimming, Cornwall hedges, hedge maintenance, nesting birds' }
  ]},
  3:  { month: 'March', topics: [
    { title: 'Spring Lawn Revival: Your Complete March Guide', cat: 'seasonal', tags: 'spring lawn care, March garden, first mow, lawn feed' },
    { title: 'Moss Control: Why Your Lawn Has Moss and How to Fix It', cat: 'tips', tags: 'moss control, lawn moss, scarifying, lawn drainage' },
    { title: 'Power Washing Patios After Winter: Tips for a Fresh Look', cat: 'projects', tags: 'power washing, patio cleaning, spring clean, algae removal' }
  ]},
  4:  { month: 'April', topics: [
    { title: 'April Lawn Care: Feeding, Seeding and Weeding', cat: 'seasonal', tags: 'lawn feed, overseeding, weed control, April lawn care' },
    { title: 'How Often Should You Mow Your Lawn?', cat: 'tips', tags: 'mowing frequency, cutting height, lawn mowing tips, grass growth' },
    { title: 'Creating a Low-Maintenance Garden That Still Looks Amazing', cat: 'projects', tags: 'low maintenance garden, easy garden, ground cover, mulching' }
  ]},
  5:  { month: 'May', topics: [
    { title: 'May Garden Blitz: Getting Summer-Ready', cat: 'seasonal', tags: 'May garden, summer prep, lawn care, garden tidy' },
    { title: 'The Science Behind Lawn Treatments: What Your Grass Actually Needs', cat: 'tips', tags: 'lawn treatment, fertiliser, NPK, grass nutrition' },
    { title: 'Dealing With Dandelions and Common Lawn Weeds', cat: 'tips', tags: 'dandelions, lawn weeds, weed killer, organic weed control' }
  ]},
  6:  { month: 'June', topics: [
    { title: 'Summer Lawn Care: How to Keep Grass Green in the Heat', cat: 'seasonal', tags: 'summer lawn care, watering lawn, heat stress, green grass' },
    { title: 'Hedge Trimming Season: Shape Up Your Boundaries', cat: 'tips', tags: 'hedge trimming, summer hedges, topiary, hedge shapes' },
    { title: 'Why Professional Garden Maintenance Saves You Money', cat: 'news', tags: 'professional garden care, garden service, save money, property value' }
  ]},
  7:  { month: 'July', topics: [
    { title: 'July Garden Survival Guide: Beating the Summer Drought', cat: 'seasonal', tags: 'drought gardening, water conservation, summer survival, dry lawn' },
    { title: 'How to Repair Brown Patches on Your Lawn', cat: 'tips', tags: 'brown patches, lawn repair, dry spots, lawn recovery' },
    { title: 'Garden Tidy-Up: Making the Most of Long Summer Evenings', cat: 'projects', tags: 'garden tidy, summer garden, outdoor living, garden makeover' }
  ]},
  8:  { month: 'August', topics: [
    { title: 'Late Summer Lawn Care: Preparing for Autumn', cat: 'seasonal', tags: 'late summer, autumn prep, lawn health, August garden' },
    { title: 'The Best Grass Types for Cornish Gardens', cat: 'tips', tags: 'grass types, Cornwall lawn, coastal garden, fescue, ryegrass' },
    { title: 'Before and After: Amazing Garden Transformations', cat: 'projects', tags: 'garden transformation, before after, garden makeover, curb appeal' }
  ]},
  9:  { month: 'September', topics: [
    { title: 'September: The Most Important Month for Your Lawn', cat: 'seasonal', tags: 'September lawn care, autumn feed, overseeding, aeration' },
    { title: 'Scarifying and Aerating: A Complete Autumn Guide', cat: 'tips', tags: 'scarifying, aeration, lawn renovation, thatch removal' },
    { title: 'How Regular Maintenance Prevents Expensive Garden Rescues', cat: 'news', tags: 'garden maintenance, prevention, regular care, garden rescue' }
  ]},
  10: { month: 'October', topics: [
    { title: 'Autumn Leaf Management: Don\'t Let Fallen Leaves Kill Your Lawn', cat: 'seasonal', tags: 'autumn leaves, leaf removal, leaf mulch, lawn damage' },
    { title: 'Winterising Your Garden: October Task List', cat: 'tips', tags: 'winterise garden, October tasks, frost prep, garden protection' },
    { title: 'Power Washing Before Winter: Protecting Your Hard Surfaces', cat: 'projects', tags: 'power washing, winter prep, driveway cleaning, path safety' }
  ]},
  11: { month: 'November', topics: [
    { title: 'November Garden Care: Wrapping Up for Winter', cat: 'seasonal', tags: 'November garden, winter prep, last mow, garden shutdown' },
    { title: 'Why Autumn Lawn Treatment Gives You the Best Spring Lawn', cat: 'tips', tags: 'autumn lawn treatment, winter feed, spring lawn, root growth' },
    { title: 'The Benefits of a Garden Maintenance Subscription', cat: 'news', tags: 'garden subscription, maintenance plan, regular care, hassle free' }
  ]},
  12: { month: 'December', topics: [
    { title: 'December Garden: What to Do (and What to Leave Alone)', cat: 'seasonal', tags: 'December garden, winter garden, frost, dormant care' },
    { title: 'Gift Ideas for Garden Lovers This Christmas', cat: 'news', tags: 'garden gifts, Christmas gifts, gardener presents, garden tools' },
    { title: 'Year in Review: Looking After Cornish Gardens in 2026', cat: 'news', tags: 'year review, Cornwall gardens, 2026 roundup, garden highlights' }
  ]}
};

// ============================================================
// NEWSLETTER THEMES — Monthly themes for auto-newsletters
// ============================================================

const NEWSLETTER_THEMES = {
  1:  { subject: '🌿 January Garden Update — Winter Protection Tips', theme: 'winter protection, what to do in the garden in January, planning ahead for spring, protecting lawns from frost' },
  2:  { subject: '🌱 February Newsletter — Spring is Coming!', theme: 'spring preparation, early lawn care tasks, when to start mowing, checking garden boundaries' },
  3:  { subject: '🌸 March Garden News — Spring Has Sprung!', theme: 'first mowing of the year, spring feed recommendations, moss treatment timing, hedge trimming season starting' },
  4:  { subject: '🌷 April Update — Your Lawn is Waking Up', theme: 'lawn feeding schedule, weed control starting, mowing height guide, garden tidy services' },
  5:  { subject: '☀️ May Newsletter — Summer Prep Time', theme: 'summer preparation, regular mowing importance, hedge trimming, garden maintenance plans' },
  6:  { subject: '🌻 June Garden Update — Peak Growing Season', theme: 'peak season lawn care, watering in dry weather, keeping edges tidy, outdoor living spaces' },
  7:  { subject: '🌞 July Newsletter — Beating the Summer Heat', theme: 'drought care, raising mowing height, brown patch prevention, garden survival tips' },
  8:  { subject: '🍃 August Update — Late Summer Garden Care', theme: 'end of summer tasks, preparing for autumn renovation, late summer feeding, holiday garden care' },
  9:  { subject: '🍂 September Newsletter — Autumn Renovation Time', theme: 'scarifying, aeration, overseeding, autumn lawn feed, the most important month for lawns' },
  10: { subject: '🍁 October Garden Update — Winterising Your Space', theme: 'leaf clearance, last mowing tips, winter preparation, hard surface cleaning before frost' },
  11: { subject: '❄️ November Newsletter — Tucking Your Garden In', theme: 'final garden tasks, winter lawn treatment, tool maintenance, subscription benefits for next year' },
  12: { subject: '🎄 December Update — Happy Holidays from Gardners GM!', theme: 'year in review, thank you to customers, January booking slots, gift ideas for garden lovers' }
};

// ============================================================
// OLLAMA — Local LLM Interface
// ============================================================

async function askOllama(prompt, temperature = 0.7) {
  log('🤖 Asking Ollama (' + OLLAMA_MODEL + ')...');

  const resp = await fetch(OLLAMA_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      prompt: prompt,
      stream: false,
      options: {
        temperature: temperature,
        num_predict: 2048,
        top_p: 0.9
      }
    })
  });

  if (!resp.ok) throw new Error('Ollama error: ' + resp.status + ' ' + resp.statusText);

  const data = await resp.json();
  return (data.response || '').trim();
}

// ============================================================
// CONTENT SANITISER — Fix hallucinated contact details
// ============================================================

function sanitiseContent(text) {
  // Fix phone numbers — replace any hallucinated UK phone numbers with the real one
  text = text.replace(/\b0\d{3,4}\s?\d{3}\s?\d{3,4}\b/g, '01726 432051');
  text = text.replace(/\b01234\s?567\s?890\b/g, '01726 432051');

  // Fix email — replace any hallucinated gardners/gardener email variants
  text = text.replace(/info@gardners?ground(maintenance|maint)\.co\.uk/gi, 'info@gardnersgm.co.uk');
  text = text.replace(/contact@gardners?ground(maintenance|maint)\.co\.uk/gi, 'info@gardnersgm.co.uk');
  text = text.replace(/hello@gardners?ground(maintenance|maint)\.co\.uk/gi, 'info@gardnersgm.co.uk');
  text = text.replace(/info@gardners?gm(aint|aintenance)?\.co\.uk/gi, 'info@gardnersgm.co.uk');

  // Fix website — replace hallucinated domain variants
  text = text.replace(/gardnersgroundmaintenance\.co\.uk/gi, 'gardnersgm.co.uk');
  text = text.replace(/gardnergroundmaintenance\.co\.uk/gi, 'gardnersgm.co.uk');
  text = text.replace(/www\.gardnersgm\.co\.uk/gi, 'gardnersgm.co.uk');

  // Clean up broken markdown link syntax that shows raw in rendered HTML
  // e.g. [info@gardnersgm.co.uk](mailto:info@gardnersgm.co.uk) → info@gardnersgm.co.uk
  text = text.replace(/\[([^\]]+)\]\(mailto:[^\)]+\)/g, '$1');
  text = text.replace(/\[([^\]]+)\]\(tel:[^\)]+\)/g, '$1');

  return text;
}

// ============================================================
// PEXELS — Stock Photo Fetcher (server-side)
// ============================================================

async function fetchPexelsImage(query) {
  log('📸 Fetching stock photo for: "' + query + '"');

  const tryFetch = async (q, attempt) => {
    try {
      const resp = await fetch('https://api.pexels.com/v1/search?query=' + encodeURIComponent(q) + '&per_page=5&orientation=landscape', {
        headers: { 'Authorization': PEXELS_KEY }
      });
      if (resp.status !== 200) {
        log('  ⚠️ Pexels returned status ' + resp.status + ' (attempt ' + attempt + ')');
        return null;
      }
      const data = await resp.json();
      if (data.photos && data.photos.length > 0) {
        const idx = Math.floor(Math.random() * Math.min(data.photos.length, 5));
        const photo = data.photos[idx];
        return photo.src.landscape || photo.src.large || photo.src.medium || null;
      }
      log('  ⚠️ No photos found for "' + q + '"');
      return null;
    } catch (e) {
      log('  ⚠️ Pexels fetch failed: ' + e.message);
      return null;
    }
  };

  // Try primary query with retry
  let url = await tryFetch(query, 1);
  if (!url) {
    await new Promise(r => setTimeout(r, 1000)); // wait 1s before retry
    url = await tryFetch(query, 2);
  }

  // Fallback: generic garden query
  if (!url) {
    await new Promise(r => setTimeout(r, 1000));
    url = await tryFetch('beautiful garden spring', 3);
  }

  if (url) {
    log('  ✅ Got image: ' + url.substring(0, 80) + '...');
  } else {
    // Hardcoded fallback images — reliable Pexels CDN URLs (no API key needed)
    const FALLBACK_IMAGES_MONTHLY = {
      1:  'https://images.pexels.com/photos/1002703/pexels-photo-1002703.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200',
      2:  'https://images.pexels.com/photos/1301856/pexels-photo-1301856.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200',
      3:  'https://images.pexels.com/photos/462118/pexels-photo-462118.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200',
      4:  'https://images.pexels.com/photos/589/garden-grass-meadow-green.jpg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200',
      5:  'https://images.pexels.com/photos/1072824/pexels-photo-1072824.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200',
      6:  'https://images.pexels.com/photos/1214394/pexels-photo-1214394.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200',
      7:  'https://images.pexels.com/photos/2132227/pexels-photo-2132227.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200',
      8:  'https://images.pexels.com/photos/1084540/pexels-photo-1084540.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200',
      9:  'https://images.pexels.com/photos/1459495/pexels-photo-1459495.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200',
      10: 'https://images.pexels.com/photos/1459505/pexels-photo-1459505.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200',
      11: 'https://images.pexels.com/photos/33109/fall-autumn-red-season.jpg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200',
      12: 'https://images.pexels.com/photos/688660/pexels-photo-688660.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200'
    };

    // Keyword-based fallbacks for blog posts
    const FALLBACK_IMAGES_TOPIC = [
      { keys: ['lawn','grass','mow','mowing','turf','feed'], img: 'https://images.pexels.com/photos/589/garden-grass-meadow-green.jpg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200' },
      { keys: ['hedge','trim','boundary','topiary'], img: 'https://images.pexels.com/photos/1105019/pexels-photo-1105019.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200' },
      { keys: ['autumn','leaf','leaves','fall','october','november'], img: 'https://images.pexels.com/photos/33109/fall-autumn-red-season.jpg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200' },
      { keys: ['winter','frost','cold','december','january','snow'], img: 'https://images.pexels.com/photos/1002703/pexels-photo-1002703.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200' },
      { keys: ['spring','march','april','blossom','bulb'], img: 'https://images.pexels.com/photos/462118/pexels-photo-462118.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200' },
      { keys: ['summer','heat','drought','july','august','sun'], img: 'https://images.pexels.com/photos/2132227/pexels-photo-2132227.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200' },
      { keys: ['patio','path','power wash','driveway','clean'], img: 'https://images.pexels.com/photos/2901212/pexels-photo-2901212.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200' },
      { keys: ['tool','maintenance','equipment','blade'], img: 'https://images.pexels.com/photos/1301856/pexels-photo-1301856.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200' },
      { keys: ['moss','scarif','aerat','thatch','renovation'], img: 'https://images.pexels.com/photos/1459495/pexels-photo-1459495.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200' },
      { keys: ['weed','dandelion','clover'], img: 'https://images.pexels.com/photos/1072824/pexels-photo-1072824.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200' },
      { keys: ['transform','makeover','before','after','project'], img: 'https://images.pexels.com/photos/1214394/pexels-photo-1214394.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200' }
    ];

    // Try to match by query keywords first
    const qLower = query.toLowerCase();
    const topicMatch = FALLBACK_IMAGES_TOPIC.find(t => t.keys.some(k => qLower.includes(k)));
    if (topicMatch) {
      url = topicMatch.img;
      log('  📷 Using topic-matched fallback image');
    } else {
      const month = new Date().getMonth() + 1;
      url = FALLBACK_IMAGES_MONTHLY[month] || FALLBACK_IMAGES_MONTHLY[2];
      log('  📷 Using seasonal fallback image for month ' + month);
    }
  }

  return url || '';
}

// ============================================================
// BLOG POST GENERATOR
// ============================================================

async function generateBlogPost(mode = 'published') {
  const month = new Date().getMonth() + 1;
  const monthData = CONTENT_CALENDAR[month];
  if (!monthData) throw new Error('No content calendar for month ' + month);

  // Check which topics have already been published this month
  log('📋 Fetching existing blog posts...');
  const existingResp = await fetch(WEBHOOK + '?action=get_all_blog_posts');
  const existingData = await existingResp.json();
  const existingTitles = (existingData.posts || []).map(p => p.title?.toLowerCase() || '');

  // Find an unused topic
  let topic = null;
  for (const t of monthData.topics) {
    if (!existingTitles.some(et => et.includes(t.title.toLowerCase().substring(0, 30)))) {
      topic = t;
      break;
    }
  }

  if (!topic) {
    log('✅ All ' + monthData.month + ' topics already published. Nothing to do.');
    return null;
  }

  log('📝 Generating: "' + topic.title + '"');

  // Generate the full article with Ollama — founder's voice, factual, no AI smell
  const blogPrompt = `You are Chris, the founder of Gardners Ground Maintenance — a hands-on gardening and grounds company based in Roche, Cornwall. You're writing a blog post for your website. You actually do this work every day with your team across Cornwall.

TITLE: ${topic.title}
CATEGORY: ${topic.cat}
MONTH: ${monthData.month}

YOUR VOICE:
- You're a real person who gets muddy boots and drives a van around Cornwall
- Write like you're chatting to a customer over a cuppa, not writing an essay
- Share things you've actually seen on jobs — "we had a customer in Truro last month whose lawn was 90% moss" type observations
- Drop in specifics about Cornwall — the clay soil around Bodmin, salt air near the coast, how the mild winters mean grass never fully stops growing
- Use short paragraphs. Mix in a one-liner paragraph now and then for pacing
- It's OK to say "honestly" or "to be fair" or "the truth is" — real people do
- Disagree with common myths if relevant — "I see this advice online all the time and it drives me mad"
- Occasional dry humour is fine — you're Cornish, not corporate

FACTUAL RULES (NON-NEGOTIABLE):
- Every claim must be horticulturally accurate. If you're not sure, don't say it
- Use real measurements, real timings, real product types (e.g. "a 25-5-5 spring feed", "cut to 35mm")
- Don't generalise — be specific. Not "water your lawn" but "give it 25mm of water once a week if we get a dry spell"
- Cornwall's climate: USDA zone 9, mild wet winters (rarely below -3°C), warm summers (rarely above 28°C), heavy clay in mid-Cornwall, lighter sandy soils near the coast, high rainfall (1200mm+/year)
- Only factual contact details: Phone 01726 432051, Email info@gardnersgm.co.uk, Website gardnersgm.co.uk

FORMATTING:
- 600-900 words
- Use ## for subheadings (3-5 of them)
- **Bold** key terms, bullet lists where it makes sense
- Do NOT include the title (it's handled separately)
- Do NOT start with "In this article" or end with "In conclusion"
- Do NOT use markdown link syntax — just mention names/numbers naturally
- End with a natural sign-off that mentions your company — not a hard sell, just something like "If you'd rather we took care of it, give us a ring on 01726 432051"
- British English throughout

IMPORTANT: At the end, on a new line, write IMAGE_HINTS: followed by 3 comma-separated short phrases describing photos that would suit different sections of this post (e.g. "mossy lawn close-up, garden rake on grass, green striped lawn"). These must relate to the actual content you wrote.

Write the blog post now:`;

  let content = await askOllama(blogPrompt, 0.7);

  if (!content || content.length < 200) {
    throw new Error('Generated content too short (' + content.length + ' chars)');
  }

  // Sanitise — fix any hallucinated contact details
  content = sanitiseContent(content);

  log('  ✅ Generated ' + content.length + ' chars of content');

  // Extract image hints from the content and fetch inline images
  let imageHints = [];
  const hintsMatch = content.match(/IMAGE_HINTS:\s*(.+)/i);
  if (hintsMatch) {
    imageHints = hintsMatch[1].split(',').map(h => h.trim()).filter(Boolean).slice(0, 3);
    content = content.replace(/IMAGE_HINTS:.+/i, '').trim();
    log('  📸 Image hints: ' + imageHints.join(', '));
  }

  // Fetch inline images for the blog post body
  let inlineImages = [];
  for (let i = 0; i < Math.min(imageHints.length, 2); i++) {
    const inImg = await fetchPexelsImage(imageHints[i] + ' garden');
    if (inImg) inlineImages.push({ url: inImg, alt: imageHints[i] });
  }

  // Insert inline images after the 2nd and 4th subheading if we have them
  if (inlineImages.length > 0) {
    let headingCount = 0;
    const lines = content.split('\n');
    const newLines = [];
    let imgIdx = 0;
    for (const line of lines) {
      newLines.push(line);
      if (line.startsWith('## ') && imgIdx < inlineImages.length) {
        headingCount++;
        if (headingCount === 2 || headingCount === 4) {
          newLines.push('');
          newLines.push('![' + inlineImages[imgIdx].alt + '](' + inlineImages[imgIdx].url + ')');
          newLines.push('');
          imgIdx++;
        }
      }
    }
    content = newLines.join('\n');
    log('  📸 Inserted ' + imgIdx + ' inline images');
  }

  // Generate excerpt
  const excerptPrompt = `Write a compelling 1-2 sentence excerpt (max 160 characters) for this blog post titled "${topic.title}". It should make someone want to read the full article. Write it like Chris the founder would say it — natural, not salesy. Just output the excerpt, nothing else.`;
  const excerpt = await askOllama(excerptPrompt, 0.5);

  // Generate social media snippets
  const socialPrompt = `You're Chris from Gardners Ground Maintenance in Cornwall. Write social media posts promoting this blog: "${topic.title}". Sound human — short, punchy, like a real tradesman sharing knowledge, not a marketing agency. Output EXACTLY in this format:

FB: [Facebook post, 2-3 sentences max, like you're posting between jobs. Use one emoji max]
IG: [Instagram caption, casual and helpful, include 5 relevant hashtags at the end]
X: [Tweet, under 280 characters, punchy and real, 1-2 hashtags]`;

  const socialRaw = sanitiseContent(await askOllama(socialPrompt, 0.6));
  const socialFb = (socialRaw.match(/FB:\s*(.+?)(?=\nIG:|$)/s) || [])[1]?.trim() || '';
  const socialIg = (socialRaw.match(/IG:\s*(.+?)(?=\nX:|$)/s) || [])[1]?.trim() || '';
  const socialX  = (socialRaw.match(/X:\s*(.+?)$/s) || [])[1]?.trim() || '';

  // Fetch a stock photo — extract 2-3 key words for better results
  const keywords = topic.title.replace(/[^a-zA-Z\s]/g, '').split(/\s+/).filter(w => 
    w.length > 3 && !['your','this','that','with','from','what','when','how','the','for','and','complete','guide'].includes(w.toLowerCase())
  ).slice(0, 3).join(' ');
  const photoQuery = keywords + ' garden';
  const imageUrl = await fetchPexelsImage(photoQuery);

  // Publish via webhook
  const payload = {
    action: 'save_blog_post',
    id: '',
    title: topic.title,
    category: topic.cat,
    author: 'Gardners GM',
    excerpt: (excerpt || '').substring(0, 200).replace(/"/g, "'"),
    content: content,
    tags: topic.tags,
    imageUrl: imageUrl,
    status: mode,
    socialFb: socialFb,
    socialIg: socialIg,
    socialX: socialX
  };

  log('📤 Publishing to webhook (' + mode + ')...');
  const pubResp = await fetch(WEBHOOK, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const pubData = await pubResp.json();
  if (pubData.status === 'success' || pubData.success === true) {
    log('  ✅ Blog post ' + mode + ': "' + topic.title + '"');

    // Notify Telegram — evening reading block
    await sendTelegram(
      '📖 *FRESH BLOG POST* 📖\n'
      + '━━━━━━━━━━━━━━━━━━━━\n\n'
      + '📌 *' + topic.title + '*\n'
      + '📂 ' + topic.cat + '\n'
      + '📏 ' + content.length + ' words\n'
      + '📸 Image: ' + (imageUrl ? 'Yes' : 'No') + '\n'
      + '📊 Status: ' + mode + '\n\n'
      + '👉 [Read it on the blog](https://gardnersgm.co.uk/blog.html)\n\n'
      + '_Generated by Content Agent using ' + OLLAMA_MODEL + '_'
    );

    return { title: topic.title, status: mode, imageUrl };
  } else {
    throw new Error('Publish failed: ' + JSON.stringify(pubData));
  }
}

// ============================================================
// NEWSLETTER GENERATOR
// ============================================================

async function generateNewsletter() {
  const month = new Date().getMonth() + 1;
  const theme = NEWSLETTER_THEMES[month];
  if (!theme) throw new Error('No newsletter theme for month ' + month);

  // Check if newsletter already sent this month
  log('📬 Checking newsletter history...');
  const histResp = await fetch(WEBHOOK + '?action=get_newsletters');
  const histData = await histResp.json();
  const newsletters = histData.newsletters || [];
  const thisMonth = new Date().toISOString().substring(0, 7); // "2026-02"
  const alreadySent = newsletters.some(n =>
    String(n.date || '').substring(0, 7) === thisMonth
  );

  if (alreadySent) {
    log('✅ Newsletter already sent this month. Skipping.');
    return null;
  }

  // Build history context from previous newsletters to avoid repetition
  const recentNewsletters = newsletters.slice(-6).reverse();
  let historyContext = '';
  if (recentNewsletters.length > 0) {
    const historyLines = ['PREVIOUS NEWSLETTERS (avoid repeating these topics and tips):'];
    for (const nl of recentNewsletters) {
      historyLines.push('• ' + String(nl.date || '').substring(0, 10) + ' — "' + (nl.subject || '') + '"');
      if (nl.topicsCovered) historyLines.push('  Topics: ' + nl.topicsCovered);
      if (nl.preview) historyLines.push('  Summary: ' + String(nl.preview).substring(0, 200));
      if (nl.blogTitlesSuggested) historyLines.push('  Blog titles suggested: ' + nl.blogTitlesSuggested);
    }
    historyLines.push('');
    historyLines.push('IMPORTANT: Generate FRESH content. Do NOT repeat tips, topics or advice from the newsletters above. Find new angles, different seasonal tasks, or fresh perspectives.');
    historyContext = historyLines.join('\n');
    log('📜 Loaded ' + recentNewsletters.length + ' previous newsletters for context');
  }

  // Get all existing blog titles to recommend and to avoid re-suggesting
  const blogResp2 = await fetch(WEBHOOK + '?action=get_blog_posts');
  const blogData2 = await blogResp2.json();
  const allBlogTitles = (blogData2.posts || []).filter(p => p.status === 'published').map(p => p.title);
  const prevSuggested = recentNewsletters.map(n => n.blogTitlesSuggested).filter(Boolean).join(', ');

  log('📰 Generating newsletter: "' + theme.subject + '"');

  // Get recent blog posts to reference
  const recentPosts = (blogData2.posts || []).filter(p => p.status === 'published').slice(0, 3);
  const blogLinks = recentPosts.map(p =>
    '<li style="margin-bottom:8px;"><strong style="color:#1B5E20;">' + escHtml(p.title || '') + '</strong><br/><span style="color:#666;font-size:13px;">' + escHtml((p.excerpt || '').substring(0, 100)) + '…</span></li>'
  ).join('');

  // Generate main newsletter content — founder's voice, company news, factual
  const nlPrompt = `You are Chris, the founder of Gardners Ground Maintenance, writing your monthly email newsletter to customers and subscribers. You're based in Roche, Cornwall and you work across the whole county.

MONTH: ${NEWSLETTER_THEMES[month].subject}
THEME: ${theme.theme}

${historyContext ? historyContext + '\n\n' : ''}Write the newsletter body content in HTML format.

YOUR VOICE:
- Write like you're emailing a mate who happens to also be a customer
- Open with a quick personal update — what the team's been up to, a funny thing that happened on a job, how busy it's been, weather gripes, anything real
- This is YOUR newsletter — you're Chris, a real bloke who runs a gardening company. Not a faceless brand
- Short paragraphs. Conversational. The odd "to be honest" or "I'll be straight with you" is fine
- Dry humour welcome — you're Cornish

CONTENT STRUCTURE:
- 400-600 words
- Start with a quick "what we've been up to" company update (2-3 sentences — new equipment, areas you've been working in, team news, job highlights)
- Then 2-3 genuinely useful seasonal garden tips — these MUST be factually accurate horticultural advice with specific measurements/timings
- These tips MUST be different from previous newsletters listed above
- Reference Cornwall's specific climate: mild wet winters, clay soils inland, coastal salt, grass never fully stops growing
- End with a natural mention of bookings/subscriptions — not a hard sell
- Contact: 01726 432051, info@gardnersgm.co.uk, gardnersgm.co.uk — ONLY these, invent nothing

FORMATTING:
- Use <h3> for section headings, <p> for paragraphs, <ul>/<li> for tips
- No <html>, <head>, <body>, or <style> tags — just the content HTML
- No header/footer — added automatically
- British English throughout

IMPORTANT: At the end, on a new line, write IMAGE_HINTS: followed by 2 comma-separated short phrases describing photos that would match the tips above (e.g. "frosty lawn morning, garden fork in soil").

Write the newsletter HTML content now:`;

  let mainContent = sanitiseContent(await askOllama(nlPrompt, 0.7));

  if (!mainContent || mainContent.length < 150) {
    throw new Error('Newsletter content too short');
  }

  // Extract image hints from newsletter and fetch inline images
  let nlImageHints = [];
  const nlHintsMatch = mainContent.match(/IMAGE_HINTS:\s*(.+)/i);
  if (nlHintsMatch) {
    nlImageHints = nlHintsMatch[1].split(',').map(h => h.trim().replace(/<[^>]+>/g, '')).filter(Boolean).slice(0, 2);
    mainContent = mainContent.replace(/IMAGE_HINTS:.+/i, '').trim();
    log('  📸 Newsletter image hints: ' + nlImageHints.join(', '));
  }

  // Fetch and insert inline images into the newsletter HTML
  if (nlImageHints.length > 0) {
    let nlInlineImages = [];
    for (const hint of nlImageHints) {
      const imgUrl = await fetchPexelsImage(hint);
      if (imgUrl) nlInlineImages.push({ url: imgUrl, alt: hint });
    }

    // Insert images after the first and second <h3> tags
    if (nlInlineImages.length > 0) {
      let h3Count = 0;
      let imgInserted = 0;
      mainContent = mainContent.replace(/<\/h3>/gi, (match) => {
        h3Count++;
        if ((h3Count === 1 || h3Count === 2) && imgInserted < nlInlineImages.length) {
          const img = nlInlineImages[imgInserted];
          imgInserted++;
          return match + '\n<div style="margin:16px 0;text-align:center;"><img src="' + img.url + '" alt="' + escHtml(img.alt) + '" style="max-width:100%;height:auto;border-radius:8px;" /></div>';
        }
        return match;
      });
      log('  📸 Inserted ' + imgInserted + ' inline images into newsletter');
    }
  }

  log('  ✅ Generated ' + mainContent.length + ' chars');

  // Generate exclusive content for paid subscribers — also history-aware
  const exclusivePrompt = `You're Chris from Gardners GM. Write a short exclusive pro tip (100-150 words) in HTML for your paid subscribers — the ones on maintenance plans. This month's theme: ${theme.theme}.

This should feel like insider knowledge from a tradesman — something you wouldn't put on the free blog. A specific technique, product recommendation (real products), timing trick, or common mistake you see homeowners making. Use <p> tags. One focused tip only. Be specific — real measurements, real timings. If mentioning contact details: 01726 432051 and info@gardnersgm.co.uk only.
${historyContext ? '\nIMPORTANT: This tip must be DIFFERENT from any exclusive content in previous newsletters.' : ''}`;

  const exclusiveContent = sanitiseContent(await askOllama(exclusivePrompt, 0.6));

  // Extract key topics from generated content for future tracking
  let topicsSummary = '';
  try {
    const topicPrompt = `Read this newsletter content and list the 3-5 main topics/tips covered, as a comma-separated list (no HTML, no numbering, just a plain comma-separated list):\n\n${mainContent}`;
    topicsSummary = sanitiseContent(await askOllama(topicPrompt, 0.2)).replace(/<[^>]+>/g, '').trim();
    log('  📝 Topics: ' + topicsSummary);
  } catch(te) { log('  ⚠️ Topic extraction failed: ' + te.message); }

  // Generate blog title suggestions for future blog posts
  let suggestedBlogTitles = '';
  try {
    let blogSuggestPrompt = `Based on this month's newsletter theme "${theme.theme}", suggest 3 blog post titles that would complement this newsletter. The blog is for a garden maintenance company in Cornwall, UK.

Requirements:
- Titles should be specific, engaging, and SEO-friendly
- Each should go deeper into a topic briefly touched in the newsletter
- Write titles that a homeowner would search for on Google
- Return ONLY the 3 titles, one per line, no numbering or bullets`;

    if (allBlogTitles.length > 0) {
      blogSuggestPrompt += '\n\nDo NOT suggest these titles (they already exist):\n' + allBlogTitles.map(t => '• ' + t).join('\n');
    }
    if (prevSuggested) {
      blogSuggestPrompt += '\n\nAlso avoid re-suggesting these previously suggested titles: ' + prevSuggested;
    }

    suggestedBlogTitles = sanitiseContent(await askOllama(blogSuggestPrompt, 0.8)).replace(/<[^>]+>/g, '').trim();
    log('  💡 Suggested blog titles: ' + suggestedBlogTitles);
  } catch(bte) { log('  ⚠️ Blog suggestion failed: ' + bte.message); }

  // Build the full content with styled Recommended Reading section
  let fullContent = mainContent;
  if (blogLinks) {
    fullContent += '\n<div style="background:#F1F8E9;border-left:4px solid #2E7D32;border-radius:6px;padding:16px 20px;margin:24px 0;">'
      + '<h3 style="color:#2E7D32;margin:0 0 12px 0;">📖 Recommended Reading</h3>'
      + '<p style="color:#555;font-size:14px;margin:0 0 12px 0;">Handpicked articles from our blog that complement this month\'s tips:</p>'
      + '<ul style="margin:0;padding-left:20px;">' + blogLinks + '</ul>'
      + '<p style="margin:12px 0 0 0;"><a href="https://gardnersgm.co.uk/blog.html" style="color:#2E7D32;font-weight:600;text-decoration:none;">Browse all articles →</a></p></div>';
  }

  // Fetch a header image
  const headerImage = await fetchPexelsImage(theme.theme.split(',')[0] + ' garden');

  // Send via webhook — now includes topic tracking and blog suggestions
  const payload = {
    action: 'send_newsletter',
    subject: theme.subject,
    content: fullContent,
    exclusiveContent: exclusiveContent || '',
    targetTier: 'all',
    headerImage: headerImage,
    topicsCovered: topicsSummary,
    blogTitlesSuggested: suggestedBlogTitles
  };

  log('📤 Sending newsletter to all subscribers...');
  const sendResp = await fetch(WEBHOOK, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const sendData = await sendResp.json();
  if (sendData.status === 'success' || sendData.success === true) {
    log('  ✅ Newsletter sent! ' + sendData.sent + ' delivered, ' + sendData.failed + ' failed');

    let telegramMsg = '📬 *NEWSLETTER SENT*\n'
      + '━━━━━━━━━━━━━━━━━━━━\n\n'
      + '📋 *' + theme.subject + '*\n'
      + '✅ Delivered: ' + sendData.sent + '\n'
      + (sendData.failed > 0 ? '❌ Failed: ' + sendData.failed + '\n' : '')
      + '⭐ Exclusive content: Yes\n'
      + '📸 Header image: ' + (headerImage ? 'Yes' : 'No') + '\n';

    if (topicsSummary) {
      telegramMsg += '\n📝 *Topics covered:*\n' + topicsSummary + '\n';
    }
    if (suggestedBlogTitles) {
      telegramMsg += '\n💡 *Suggested blog titles:*\n' + suggestedBlogTitles + '\n';
    }
    telegramMsg += '\n_Generated by Content Agent using ' + OLLAMA_MODEL + ' — content history tracked_';

    await sendTelegram(telegramMsg);

    return { subject: theme.subject, sent: sendData.sent, failed: sendData.failed };
  } else {
    throw new Error('Newsletter send failed: ' + JSON.stringify(sendData));
  }
}

// ============================================================
// TELEGRAM HELPER
// ============================================================

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
    log('  ⚠️ Telegram notification failed: ' + e.message);
  }
}

// ============================================================
// HTML HELPER
// ============================================================

function escHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ============================================================
// LOGGER
// ============================================================

function log(msg) {
  const ts = new Date().toLocaleTimeString('en-GB');
  console.log('[' + ts + '] ' + msg);
}

// ============================================================
// AUTO-SCHEDULER — Decides what to run based on the date
// ============================================================

function autoDecide() {
  const now = new Date();
  const day = now.getDate();
  const tasks = [];

  // Blog: publish on the 1st, 11th, and 21st of each month
  if (day === 1 || day === 11 || day === 21) {
    tasks.push('blog');
  }

  // Newsletter: send on the 15th of each month
  if (day === 15) {
    tasks.push('newsletter');
  }

  // If today isn't a scheduled day, just do a blog post
  if (tasks.length === 0) {
    log('ℹ️  No scheduled tasks for today (day ' + day + ').');
    log('   Blog publishes on: 1st, 11th, 21st');
    log('   Newsletter sends on: 15th');
    log('   Use "node agents/content-agent.js blog" to force a post.');
    return tasks;
  }

  return tasks;
}

// ============================================================
// MAIN
// ============================================================

async function main() {
  const args = process.argv.slice(2);
  const command = (args[0] || 'auto').toLowerCase();

  log('═══════════════════════════════════════════');
  log('🌿 Gardners GM Content Agent');
  log('═══════════════════════════════════════════');
  log('📅 Date: ' + new Date().toLocaleDateString('en-GB'));

  // Verify Ollama is running
  try {
    const check = await fetch('http://localhost:11434/api/tags');
    if (!check.ok) throw new Error('Not running');
    log('✅ Ollama is running');
  } catch (e) {
    log('❌ Ollama is not running! Start it with: ollama serve');
    log('   Then try again.');
    process.exit(1);
  }

  // Auto-detect installed model before generating
  await detectModel();
  log('🤖 Model: ' + OLLAMA_MODEL);
  log('📌 Mode: ' + command);
  log('');

  let tasks = [];

  switch (command) {
    case 'blog':
      tasks = ['blog'];
      break;
    case 'newsletter':
      tasks = ['newsletter'];
      break;
    case 'both':
      tasks = ['blog', 'newsletter'];
      break;
    case 'preview':
      tasks = ['preview'];
      break;
    case 'auto':
      tasks = autoDecide();
      break;
    default:
      log('Unknown command: ' + command);
      log('Usage: node agents/content-agent.js [blog|newsletter|both|preview|auto]');
      process.exit(1);
  }

  if (tasks.length === 0) {
    process.exit(0);
  }

  let blogResult = null;
  let nlResult = null;

  for (const task of tasks) {
    log('');
    log('─── ' + task.toUpperCase() + ' ───');

    try {
      if (task === 'blog') {
        blogResult = await generateBlogPost('published');
      } else if (task === 'preview') {
        blogResult = await generateBlogPost('draft');
      } else if (task === 'newsletter') {
        nlResult = await generateNewsletter();
      }
    } catch (err) {
      log('❌ Error in ' + task + ': ' + err.message);
      await sendTelegram('⚠️ *CONTENT AGENT ERROR*\n\nTask: ' + task + '\nError: ' + err.message);
    }
  }

  log('');
  log('═══════════════════════════════════════════');
  log('✅ Content Agent finished');
  if (blogResult) log('   📝 Blog: "' + blogResult.title + '" (' + blogResult.status + ')');
  if (nlResult) log('   📬 Newsletter: ' + nlResult.sent + ' sent');
  log('═══════════════════════════════════════════');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
