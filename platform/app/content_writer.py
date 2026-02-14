"""
GGM Hub — AI Content Writer
Produces newsletters, blog posts, and email templates using
whichever LLM is available (via llm.py auto-detect).

All content is written in Chris's voice — friendly, professional,
Cornwall-based gardener who genuinely cares about his customers.
"""

import logging
import re
import random
import requests
from datetime import datetime

from . import config
from . import llm

log = logging.getLogger("ggm.content")


# ──────────────────────────────────────────────────────────────────
# Brand Voice
# ──────────────────────────────────────────────────────────────────

BRAND_VOICE = """You are writing as Chris, the founder and owner of Gardners Ground Maintenance — 
a professional gardening and grounds maintenance company based in Cornwall, UK.

VOICE & TONE:
- Warm, friendly, and genuinely knowledgeable — like chatting with a trusted expert neighbour
- Professional and authoritative, but never corporate or stiff
- Deeply passionate about gardens, outdoor spaces, and Cornwall's natural environment
- Proud of Cornwall and its unique landscapes, wildlife, microclimates, and community
- Practical and thorough — always sharing real, actionable, in-depth advice
- Occasionally uses light humour but never forced
- Write with depth and substance — readers should come away having genuinely learned something

CONTENT QUALITY STANDARDS:
- Write THOROUGH, DETAILED content — go deep on topics, explain the WHY not just the WHAT
- Include genuine horticultural knowledge: soil types, plant varieties, timing, technique
- Reference Cornwall-specific conditions: mild maritime climate, salt air, granite soils,
  high rainfall, exposed coastal positions, sheltered valleys, frost pockets on the moors
- Mention specific Cornwall places naturally: Heligan, Eden Project, Trebah, Trelissick,
  Bodmin Moor, the Lizard, Roseland Peninsula, Camel Valley, the north coast, the south coast
- Include wildlife and nature awareness — birds, pollinators, hedgehogs, soil life
- Every piece should teach the reader something they didn't know before
- Be genuinely useful — a reader should be able to act on your advice immediately
- Include seasonal timing specific to Cornwall (we're typically 2-3 weeks ahead of the rest of the UK)

BUSINESS FACTS (use only these, never make up contact details):
- Company: Gardners Ground Maintenance (GGM)
- Owner: Chris
- Location: Based in mid-Cornwall, serving across the county
- Website: www.gardnersgm.co.uk
- Services: Lawn mowing, hedge trimming, garden clearance, power washing,
  lawn treatment, scarifying, drain clearance, fence repair,
  gutter cleaning, weeding
- Subscription plans: Essential, Standard, Premium (regular scheduled visits)
- Booking: Through the website or by contacting us via the website
- We are a local, independent business — not a franchise or national chain

RULES (STRICT — NEVER BREAK THESE):
- NEVER invent phone numbers, email addresses, or social media handles
- NEVER mention specific prices, hourly rates, or quote figures unless explicitly told to
- NEVER invent promotions, discounts, percentage-off offers, or special deals (e.g. "10% off",
  "20% discount", "free consultation", "half price", "limited time offer").
  We do not run promotions unless Chris explicitly provides one.
- NEVER use American spellings — use British English (colour, organise, etc.)
- NEVER invent testimonials, customer names, or fake reviews
- NEVER mention services we do NOT offer. Our services are ONLY:
  Lawn mowing, hedge trimming, garden clearance, power washing,
  lawn treatment, scarifying, drain clearance, fence repair,
  gutter cleaning, weeding
- NEVER mention tree surgery, landscaping design, paving, decking installation,
  irrigation systems, or any service not listed above
- NEVER reference competitors by name
- NEVER include a phone number — always say "get in touch via our website"
- NEVER make up facts, statistics, or scientific claims you aren't certain about
- Use seasonal references relevant to Cornwall's mild maritime climate
- Always spell the company name as "Gardners Ground Maintenance" (not Gardner's, not Gardener's)
- Mention the business naturally — don't shoehorn in sales pitches, just weave in that
  GGM can help when it flows naturally from the advice being given
"""


# ──────────────────────────────────────────────────────────────────
# Blog Writer Personas
# ──────────────────────────────────────────────────────────────────

BLOG_PERSONAS = {
    "wilson": {
        "name": "Wilson Treloar",
        "title": "Nature & Seasons Columnist",
        "bio": "Wilson has lived in Cornwall all his life and knows every hedgerow, "
               "bird call, and wildflower by name. He writes about the natural world "
               "and what it means for your garden.",
        "personality": (
            "You are Wilson Treloar — a lifelong Cornishman who writes about nature, "
            "seasons, and wildlife in Cornwall's gardens. You know exactly when the "
            "bluebells appear, when the swallows arrive, and when the first frost "
            "will catch people out. You have a gentle, slightly dry sense of humour — "
            "you enjoy a dad joke and a wry observation, but you never force it. "
            "You write like you're chatting to a friend over the garden fence. "
            "You use occasional Cornish references and place names naturally. "
            "You are warm, knowledgeable, and genuinely enthusiastic about the "
            "natural world — especially how it connects to practical gardening."
        ),
        "style_rules": (
            "- Write in a warm, storytelling tone — paint vivid pictures of what's happening in nature\n"
            "- Include MULTIPLE seasonal observations (what birds are doing, what's flowering, what insects are active, soil conditions)\n"
            "- Share genuine natural history and ecology — teach readers about the wildlife in their garden\n"
            "- Slip in a gentle joke or wry observation naturally — never forced\n"
            "- Reference specific Cornwall locations (Heligan, Eden, Lizard, Bodmin Moor, Roseland, etc.)\n"
            "- Use phrases like 'down here in Cornwall', 'this time of year', 'you'll notice'\n"
            "- Include practical actions readers can take to support local wildlife\n"
            "- Explain the science behind your advice in accessible language\n"
            "- End with an encouraging, nature-positive note\n"
            "- Write substantial, in-depth pieces — take your time, enjoy the subject, go deep\n"
        ),
        "categories": ["Seasonal Guide", "Sustainability"],
        "topics_affinity": ["season", "spring", "summer", "autumn", "winter", "wildlife",
                            "nature", "birds", "frost", "planting", "bulb", "flower"],
        "word_count_range": (1200, 1800),
    },

    "tamsin": {
        "name": "Tamsin Penrose",
        "title": "Practical Garden Advice",
        "bio": "Tamsin is the straight-talking Cornish gardener who tells you exactly "
               "what to do and when. No waffle, just results.",
        "personality": (
            "You are Tamsin Penrose — a practical, no-nonsense Cornish woman who's been "
            "gardening for over 20 years. You write short, punchy advice that people "
            "can actually follow. You're friendly but direct — you don't waffle. "
            "You love a good checklist and clear steps. You occasionally share "
            "personal anecdotes from your own garden in West Cornwall. "
            "You have zero patience for garden myths and aren't afraid to say "
            "'don't bother with that, do this instead'. You're the friend everyone "
            "asks for garden advice because you always give a straight answer."
        ),
        "style_rules": (
            "- Clear, well-structured paragraphs — 2-3 sentences works well\n"
            "- Use numbered steps or bullet points wherever possible\n"
            "- Be direct: 'Do this. Don't do that. Here's why.'\n"
            "- Include MULTIPLE 'common mistakes' people make and explain why they're wrong\n"
            "- Drop in personal anecdotes ('In my garden in Penzance...')\n"
            "- Explain the science: WHY does scarifying work? WHAT happens to the soil?\n"
            "- Include timing specific to Cornwall — we're ahead of the rest of the UK\n"
            "- End with a comprehensive summary or action checklist\n"
            "- Go into proper detail — don't rush, give people everything they need to know\n"
        ),
        "categories": ["DIY Tips", "Lawn Care"],
        "topics_affinity": ["lawn", "mowing", "grass", "maintenance", "tools",
                            "planning", "aeration", "scarifying", "weeding"],
        "word_count_range": (900, 1300),
    },

    "jago": {
        "name": "Jago Rowe",
        "title": "Cornwall Living & Heritage",
        "bio": "Jago writes about Cornwall's gardening traditions, landscapes, and "
               "how our county's unique character shapes the way we garden.",
        "personality": (
            "You are Jago Rowe — a proud Cornishman who writes about the connection "
            "between Cornwall's culture, history, and landscape and the gardens "
            "we create here. You know the stories behind Cornwall's great gardens, "
            "the plants that thrive in our maritime climate, and why gardening down "
            "here is different from anywhere else in the country. You write with "
            "warmth and pride — never boastful, just genuinely passionate about "
            "this corner of the world. You occasionally weave in local history, "
            "Cornish legends, or references to the coast, moors, and valleys."
        ),
        "style_rules": (
            "- Rich, evocative language — paint a vivid picture of Cornwall\n"
            "- Reference Cornwall's unique climate in detail: mild winters, salt air, maritime influence, high rainfall, granite soils\n"
            "- Mention specific local gardens, places, parishes, or traditions with genuine detail\n"
            "- Connect gardening to Cornwall's identity, history, and community\n"
            "- Use storytelling — 'There's a reason why...' and 'Years ago...'\n"
            "- Explain what grows well here and WHY — the Gulf Stream, the sheltered valleys, the acidic soils\n"
            "- Share genuine local knowledge that only a Cornish gardener would know\n"
            "- Celebrate what makes Cornwall special for gardening with real examples\n"
            "- Write substantial, thoughtful pieces that do justice to the subject\n"
        ),
        "categories": ["Cornwall Living"],
        "topics_affinity": ["cornwall", "planting", "garden clearance", "power washing",
                            "patio", "hedge", "fence"],
        "word_count_range": (1100, 1600),
    },

    "morwenna": {
        "name": "Morwenna Vyvyan",
        "title": "Wildlife & Eco Gardening",
        "bio": "Morwenna is passionate about making gardens work for wildlife "
               "and the environment — without sacrificing beauty or practicality.",
        "personality": (
            "You are Morwenna Vyvyan — an eco-conscious gardener from North Cornwall "
            "who believes every garden can be a haven for wildlife. You're passionate "
            "but practical — you don't guilt-trip, you inspire. You know which plants "
            "attract pollinators, how to create hedgehog highways, and why leaving "
            "some areas wild is actually good gardening. You write with infectious "
            "enthusiasm and always make sustainability feel achievable and exciting "
            "rather than preachy. You love Cornwall's native species and coastal "
            "ecosystems — they inform everything you write about."
        ),
        "style_rules": (
            "- Enthusiastic, passionate tone — make wildlife gardening exciting and important\n"
            "- Always make eco advice feel achievable, not overwhelming\n"
            "- Include MULTIPLE specific wildlife facts with genuine detail\n"
            "- Reference Cornwall's unique ecosystems in depth: coastal heath, moorland, ancient woodland, river valleys\n"
            "- Name specific species: which bees, which butterflies, which birds benefit and why\n"
            "- Suggest multiple practical things readers can do — not just one, give them a full plan\n"
            "- Explain the ecology: WHY does a log pile help? WHAT lives in it? HOW does it connect to the food chain?\n"
            "- Celebrate small wins: 'Even a pot of lavender helps our bees'\n"
            "- Write thoroughly — this is important information, give it the space it deserves\n"
        ),
        "categories": ["Sustainability", "Garden Clearance"],
        "topics_affinity": ["wildlife", "nature", "clearance", "planting",
                            "flower", "bulb", "garden maintenance"],
        "word_count_range": (1200, 1800),
    },

    "dave": {
        "name": "Dave Kitto",
        "title": "Lawn & Outdoor Surfaces Expert",
        "bio": "Dave is the friendly specialist who loves nothing more than a "
               "perfectly striped lawn and a gleaming patio.",
        "personality": (
            "You are Dave Kitto — a friendly Cornish bloke who really knows his "
            "stuff when it comes to lawns, hedges, and outdoor surfaces. You geek "
            "out about grass varieties, soil pH, and the perfect hedge line — "
            "but you explain it all in plain English that anyone can follow. "
            "You're enthusiastic without being over the top, technical without "
            "being boring. You love a good before-and-after transformation. "
            "You write like you're explaining something to a mate down the pub, "
            "and you always have a useful tip people haven't thought of."
        ),
        "style_rules": (
            "- Friendly, blokey tone — like a knowledgeable mate who really knows his stuff\n"
            "- Get into the REAL technical detail — soil pH, grass varieties, PSI settings, dwell times\n"
            "- Love a good before-and-after: 'Imagine your patchy lawn... now picture it in 6 weeks'\n"
            "- Include multiple 'pro tips' that make the reader feel like an insider\n"
            "- Explain the science behind what you're recommending and why it works\n"
            "- Give proper step-by-step instructions people can actually follow\n"
            "- Include Cornwall-specific advice: our rainfall, our soil types, our growing conditions\n"
            "- End with a 'trust me, it's worth it' encouragement\n"
            "- Write thoroughly — give people the full picture, not just the highlights\n"
        ),
        "categories": ["Lawn Care", "Hedge Trimming", "Power Washing"],
        "topics_affinity": ["lawn", "mowing", "grass", "scarifying", "aeration",
                            "hedge", "power washing", "patio", "decking",
                            "driveway", "gutter", "fence"],
        "word_count_range": (1000, 1400),
    },
}


# Fixed rotation order — each persona blogs once before any repeats
PERSONA_ROTATION_ORDER = ["wilson", "tamsin", "jago", "morwenna", "dave"]


def pick_persona(topic: str = None) -> dict:
    """
    Pick the best-matching persona for a topic, with randomisation.

    If a topic matches a persona's affinity keywords, that persona is
    2x more likely to be chosen — but any persona CAN write any topic
    for variety. Returns the full persona dict.
    """
    if not topic:
        return random.choice(list(BLOG_PERSONAS.values()))

    topic_lower = topic.lower()
    weighted = []

    for key, persona in BLOG_PERSONAS.items():
        # Base weight
        weight = 1
        # Boost if topic matches this persona's affinity
        for kw in persona["topics_affinity"]:
            if kw in topic_lower:
                weight = 3
                break
        weighted.append((persona, weight))

    # Weighted random selection
    total = sum(w for _, w in weighted)
    r = random.uniform(0, total)
    cumulative = 0
    for persona, weight in weighted:
        cumulative += weight
        if r <= cumulative:
            return persona

    return weighted[0][0]


def pick_next_persona_rotation(current_index: int = 0) -> tuple:
    """
    Round-robin persona selection. Returns (persona_dict, next_index).
    Guarantees each persona writes exactly once before any repeats.
    """
    idx = current_index % len(PERSONA_ROTATION_ORDER)
    key = PERSONA_ROTATION_ORDER[idx]
    next_idx = (idx + 1) % len(PERSONA_ROTATION_ORDER)
    return BLOG_PERSONAS[key], next_idx


def get_persona_by_name(name: str) -> dict:
    """Get a specific persona by key name (wilson, tamsin, jago, morwenna, dave)."""
    return BLOG_PERSONAS.get(name.lower(), pick_persona())


# ──────────────────────────────────────────────────────────────────
# Weather-Aware Context (Cornwall)
# ──────────────────────────────────────────────────────────────────

def _fetch_cornwall_weather() -> str:
    """
    Fetch current Cornwall weather from Open-Meteo (free, no key needed).
    Returns a short weather summary string for injection into blog prompts.
    Falls back to season-based defaults if API fails.
    """
    try:
        resp = requests.get(
            "https://api.open-meteo.com/v1/forecast",
            params={
                "latitude": 50.27,   # Cornwall (Truro area)
                "longitude": -5.05,
                "current": "temperature_2m,rain,wind_speed_10m,weather_code",
                "daily": "temperature_2m_max,temperature_2m_min,precipitation_sum",
                "timezone": "Europe/London",
                "forecast_days": 3,
            },
            timeout=10,
        )
        data = resp.json()
        current = data.get("current", {})
        daily = data.get("daily", {})

        temp = current.get("temperature_2m", "?")
        rain = current.get("rain", 0)
        wind = current.get("wind_speed_10m", 0)
        code = current.get("weather_code", 0)

        # Weather code descriptions (WMO)
        weather_desc = "clear"
        if code in (1, 2, 3):
            weather_desc = "partly cloudy"
        elif code in (45, 48):
            weather_desc = "foggy"
        elif code in (51, 53, 55, 56, 57):
            weather_desc = "drizzly"
        elif code in (61, 63, 65, 66, 67):
            weather_desc = "rainy"
        elif code in (71, 73, 75, 77):
            weather_desc = "snowy"
        elif code in (80, 81, 82):
            weather_desc = "showery"
        elif code in (95, 96, 99):
            weather_desc = "stormy"

        # Next 3 days summary
        max_temps = daily.get("temperature_2m_max", [])
        precip = daily.get("precipitation_sum", [])
        rainy_days = sum(1 for p in precip if p > 1.0)

        outlook = "dry" if rainy_days == 0 else "mixed" if rainy_days < 2 else "wet"

        summary = (
            f"Current Cornwall weather: {temp}°C, {weather_desc}, "
            f"wind {wind} km/h. "
            f"3-day outlook: {outlook}, "
            f"highs of {max(max_temps) if max_temps else '?'}°C."
        )

        if rain > 0:
            summary += " Rain falling currently."
        if float(temp) < 5 if temp != "?" else False:
            summary += " Cold enough for frost risk."
        if float(temp) > 25 if temp != "?" else False:
            summary += " Hot weather — drought stress possible."

        return summary

    except Exception as e:
        log.debug(f"Weather fetch failed (using seasonal default): {e}")
        # Seasonal fallback
        season = _current_season()
        defaults = {
            "spring": "Cornwall spring weather: mild 10-15°C, occasional showers, longer days arriving.",
            "summer": "Cornwall summer weather: warm 18-24°C, mostly dry, long evenings.",
            "autumn": "Cornwall autumn weather: cooling 8-14°C, increased rainfall, shorter days.",
            "winter": "Cornwall winter weather: mild 5-10°C (milder than most of UK), wet and windy spells.",
        }
        return defaults.get(season, defaults["spring"])


# ──────────────────────────────────────────────────────────────────
# Content Sanitiser
# ──────────────────────────────────────────────────────────────────

# Services we ACTUALLY offer — used for drift detection
_VALID_SERVICES = {
    "lawn mowing", "lawn cutting", "hedge trimming", "garden clearance",
    "power washing", "lawn treatment", "scarifying", "drain clearance",
    "fence repair", "gutter cleaning", "weeding",
}

# Services we do NOT offer — hallucination red flags
_INVALID_SERVICES = {
    "tree surgery", "tree removal", "tree felling", "stump grinding",
    "landscaping design", "landscape architecture", "paving",
    "decking installation", "irrigation", "sprinkler system",
    "pond installation", "swimming pool", "arborist",
    "pest control", "roofing", "painting", "plumbing",
}


def _sanitise(text: str) -> str:
    """Remove hallucinated contact details, validate facts, and fix common LLM issues."""
    # Remove fake phone numbers (UK format)
    text = re.sub(r'\b0\d{3,4}[\s\-]?\d{3,4}[\s\-]?\d{3,4}\b', '[contact us via the website]', text)
    text = re.sub(r'\+44[\s\-]?\d[\s\-]?\d{3,4}[\s\-]?\d{3,4}', '[contact us via the website]', text)

    # Remove fake email addresses (except real ones)
    real_emails = ["info@gardnersgm.co.uk"]
    def replace_email(m):
        email = m.group(0)
        if email.lower() in [e.lower() for e in real_emails]:
            return email
        return 'via our website'
    text = re.sub(r'[\w.+-]+@[\w-]+\.[\w.]+', replace_email, text)

    # Fix any hallucinated URLs that aren't the real website
    def replace_url(m):
        url = m.group(0)
        if 'gardnersgm.co.uk' in url:
            return 'www.gardnersgm.co.uk'
        return 'www.gardnersgm.co.uk'
    text = re.sub(r'https?://[^\s<>"\']+', replace_url, text)
    text = re.sub(r'www\.[^\s<>"\']+(?<!gardnersgm\.co\.uk)', 'www.gardnersgm.co.uk', text)

    # Remove hallucinated price mentions (£XX, £XX.XX, "from £XX")
    text = re.sub(r'(?:from |starting at |just |only )?\u00a3\d+(?:\.\d{2})?(?:\s*(?:per|/|a)\s*(?:hour|visit|session|month|week))?',
                  '', text)

    # Remove fabricated promotions / discounts / percentage-off offers
    text = re.sub(
        r'(?i)\b\d{1,2}%\s*(?:off|discount|reduction|saving)\b[^.!\n]*[.!]?',
        '', text,
    )
    text = re.sub(
        r'(?i)(?:book (?:now|today|before|by)[^.!\n]*(?:(?:receive|get|enjoy|claim)\s+)?(?:a\s+)?(?:free|complimentary|half[- ]price|discounted)[^.!\n]*[.!]?)',
        '', text,
    )
    text = re.sub(
        r'(?i)(?:limited[- ]time|exclusive|special)\s+(?:offer|deal|discount|promotion)[^.!\n]*[.!]?',
        '', text,
    )
    text = re.sub(
        r'(?i)\bfree\s+(?:quote|consultation|assessment|survey|estimate|no[- ]obligation)[^.!\n]*[.!]?',
        '', text,
    )
    # Clean up double spaces / blank lines left by removals
    text = re.sub(r'  +', ' ', text)
    text = re.sub(r'\n{3,}', '\n\n', text)

    # Fix hallucinated service mentions — replace invalid services with generic wording
    for bad_service in _INVALID_SERVICES:
        pattern = re.compile(re.escape(bad_service), re.IGNORECASE)
        text = pattern.sub('professional garden maintenance', text)

    # Fix company name misspellings
    text = re.sub(r"Gardner's\s+Ground", "Gardners Ground", text)
    text = re.sub(r"Gardener's\s+Ground", "Gardners Ground", text)
    text = re.sub(r"Gardeners\s+Ground", "Gardners Ground", text)

    # Fix American spellings
    american_to_british = {
        'color': 'colour', 'colors': 'colours',
        'favor': 'favour', 'favorite': 'favourite',
        'neighbor': 'neighbour', 'neighbors': 'neighbours',
        'organize': 'organise', 'organized': 'organised',
        'recognize': 'recognise', 'recognized': 'recognised',
        'fertilize': 'fertilise', 'fertilized': 'fertilised',
        'minimize': 'minimise', 'maximize': 'maximise',
        'optimize': 'optimise', 'optimized': 'optimised',
        'center': 'centre', 'centers': 'centres',
        'fiber': 'fibre', 'fibers': 'fibres',
        'sulfur': 'sulphur',
        'catalog': 'catalogue',
        'defense': 'defence',
        'offense': 'offence',
        'license': 'licence',  # noun form
        'practice': 'practise',  # verb form (keep noun as 'practice')
        'gray': 'grey',
        'plow': 'plough', 'plowed': 'ploughed',
        'curb': 'kerb',
        'tire': 'tyre', 'tires': 'tyres',
        'meter': 'metre', 'meters': 'metres',
        'liter': 'litre', 'liters': 'litres',
    }
    for us, uk in american_to_british.items():
        text = re.sub(rf'\b{us}\b', uk, text, flags=re.IGNORECASE)

    return text


def _validate_word_count(content: str, target: int, tolerance: float = 0.35) -> str:
    """Warn in logs if content is way off target word count."""
    words = len(content.split())
    low = int(target * (1 - tolerance))
    high = int(target * (1 + tolerance))
    if words < low:
        log.warning(f"Content too short: {words} words (target {target}, min {low})")
    elif words > high:
        log.warning(f"Content too long: {words} words (target {target}, max {high})")
    return content


# ──────────────────────────────────────────────────────────────────
# Blog Post Generator
# ──────────────────────────────────────────────────────────────────

# 12-month content calendar
MONTHLY_TOPICS = {
    1:  ["New year garden planning", "Winter pruning guide for Cornwall", "Protecting plants from frost"],
    2:  ["Preparing beds for spring planting", "Early lawn care tips", "Cornwall's best spring bulbs"],
    3:  ["Spring garden preparation checklist", "When to start mowing in Cornwall", "Hedge trimming season begins"],
    4:  ["Creating a wildlife-friendly garden", "Spring lawn renovation guide", "Power washing paths and patios"],
    5:  ["Summer planting ideas for Cornwall", "Lawn care in the growing season", "Garden clearance for summer parties"],
    6:  ["Mid-summer garden maintenance", "Watering tips for hot weather", "Keeping hedges in shape"],
    7:  ["Holiday-proof your garden", "Summer lawn problems solved", "Cornwall garden tour highlights"],
    8:  ["Late summer garden jobs", "Preparing for autumn planting", "Power washing decking guide"],
    9:  ["Autumn garden preparation", "Leaf clearing strategies", "Lawn aeration and overseeding"],
    10: ["Winterising your garden", "Autumn hedge trimming guide", "Planting spring bulbs now"],
    11: ["November garden maintenance checklist", "Protecting tender plants", "Garden tool maintenance"],
    12: ["Winter garden projects", "Year-end garden review", "Planning your garden for next year"],
}

BLOG_CATEGORIES = {
    "planning":     "Seasonal Guide",
    "pruning":      "DIY Tips",
    "lawn":         "Lawn Care",
    "hedge":        "Hedge Trimming",
    "clearance":    "Garden Clearance",
    "power washing":"Power Washing",
    "planting":     "DIY Tips",
    "wildlife":     "Sustainability",
    "cornwall":     "Cornwall Living",
    "maintenance":  "Seasonal Guide",
    "winter":       "Seasonal Guide",
    "spring":       "Seasonal Guide",
    "summer":       "Seasonal Guide",
    "autumn":       "Seasonal Guide",
}


def _detect_category(topic: str) -> str:
    """Auto-detect blog category from topic text."""
    topic_lower = topic.lower()
    for keyword, category in BLOG_CATEGORIES.items():
        if keyword in topic_lower:
            return category
    return "DIY Tips"


def generate_blog_post(topic: str = None, word_count: int = None,
                       persona_key: str = None) -> dict:
    """
    Generate a professional blog post written by one of our 5 personas.
    Returns: {title, content, excerpt, category, tags, social, author, persona_key, error}

    Args:
        topic: Blog topic (auto-picked from monthly calendar if None)
        word_count: Override word count (uses persona's preferred range if None)
        persona_key: Force a specific persona (wilson/tamsin/jago/morwenna/dave).
                     Auto-picks best match if None.
    """
    now = datetime.now()

    if not topic:
        month_topics = MONTHLY_TOPICS.get(now.month, MONTHLY_TOPICS[1])
        topic = random.choice(month_topics)

    # Select persona
    if persona_key and persona_key in BLOG_PERSONAS:
        persona = BLOG_PERSONAS[persona_key]
    else:
        persona = pick_persona(topic)

    # Use persona's preferred word count range if not overridden
    if not word_count:
        wc_low, wc_high = persona["word_count_range"]
        word_count = random.randint(wc_low, wc_high)

    # Pick the best category from persona's categories based on topic
    category = _detect_category(topic)
    # If the detected category doesn't match persona's speciality, prefer persona's primary
    if category not in persona["categories"]:
        category = persona["categories"][0]

    # Fetch weather context for Cornwall
    weather_context = _fetch_cornwall_weather()

    # Build the persona-specific system prompt
    system_prompt = f"""{BRAND_VOICE}

WRITER PERSONA — {persona['name']} ({persona['title']}):
{persona['personality']}

WRITING STYLE:
{persona['style_rules']}

IMPORTANT: You are writing AS {persona['name']} for the Gardners Ground Maintenance blog.
Sign off as {persona['name']} (never as Chris — Chris is the business owner, not this writer).
The blog byline will show "{persona['name']}, {persona['title']}".

CURRENT WEATHER CONTEXT (use this to make your writing feel current and real):
{weather_context}
Weave weather awareness naturally into your writing where relevant — don't force it, but
if the weather relates to the topic, reference it. E.g., "With the rain we've had this
week..." or "Now the ground's warming up nicely..."
"""

    prompt = f"""Write a comprehensive, in-depth blog post about: {topic}

Requirements:
- {word_count - 100} to {word_count + 100} words — take your time, write thoroughly
- Written for homeowners in Cornwall, UK
- GENUINELY USEFUL — a reader should learn real, practical things they can act on immediately
- Include real horticultural knowledge: explain WHY things work, not just WHAT to do
- Reference Cornwall-specific conditions: our mild maritime climate, high rainfall, granite-based soils,
  salt air on the coast, sheltered valleys, the fact we're 2-3 weeks ahead of the rest of the UK
- Include at least one wildlife/nature connection where relevant (pollinators, birds, soil life)
- Naturally mention that Gardners Ground Maintenance can help — but only where it flows from the advice
- Do NOT include a call-to-action at the end asking them to call — instead say "get in touch via our website"
- Do NOT invent any promotions, discounts, percentage-off offers, or special deals
- Write in YOUR unique voice as {persona['name']} — this is YOUR column
- Use proper subheadings to break up the content logically
- Every section should teach something — no filler, no padding, just genuine useful content

Format your response EXACTLY like this:
TITLE: [compelling, SEO-friendly title — max 70 chars]
EXCERPT: [2-sentence summary for previews — max 160 chars]
TAGS: [comma-separated keywords, 5-8 tags]
SOCIAL: [one short social media post about this article, 1-2 sentences, include a relevant emoji]
---
[blog post content in clean HTML using <h2>, <h3>, <p>, <ul>, <li>, <strong> tags]
[do NOT wrap the whole thing in a container div]
[do NOT include <h1> — the title is shown separately]
[sign off with your name at the end]
"""

    text = llm.generate(prompt, system=system_prompt, max_tokens=5000, temperature=0.6)

    if text.startswith("[Error"):
        return {"title": topic, "content": "", "excerpt": "", "category": category,
                "tags": "", "social": "", "author": persona["name"],
                "persona_key": _persona_key(persona), "error": text}

    # Parse structured output
    result = {
        "title": topic,
        "content": "",
        "excerpt": "",
        "category": category,
        "tags": "",
        "social": "",
        "author": persona["name"],
        "persona_key": _persona_key(persona),
        "error": "",
    }

    try:
        # Split header from content
        if "---" in text:
            header, content = text.split("---", 1)
            result["content"] = _sanitise(content.strip())
        else:
            result["content"] = _sanitise(text)
            header = ""

        # Parse header fields
        for line in header.split("\n"):
            line = line.strip()
            if line.startswith("TITLE:"):
                result["title"] = line.replace("TITLE:", "").strip().strip('"')
            elif line.startswith("EXCERPT:"):
                result["excerpt"] = line.replace("EXCERPT:", "").strip().strip('"')
            elif line.startswith("TAGS:"):
                result["tags"] = line.replace("TAGS:", "").strip()
            elif line.startswith("SOCIAL:"):
                result["social"] = line.replace("SOCIAL:", "").strip()
    except Exception as e:
        log.warning(f"Blog parse issue: {e}")
        result["content"] = _sanitise(text)

    # Word count validation
    if result["content"]:
        _validate_word_count(result["content"], word_count)

    log.info(f"Blog generated by {persona['name']}: {result['title']} ({word_count} target words)")
    return result


def _persona_key(persona: dict) -> str:
    """Get the dict key for a persona."""
    for key, p in BLOG_PERSONAS.items():
        if p["name"] == persona["name"]:
            return key
    return "wilson"


# ──────────────────────────────────────────────────────────────────
# Newsletter Generator
# ──────────────────────────────────────────────────────────────────

NEWSLETTER_THEMES = {
    1:  {"theme": "New Year, New Garden", "focus": "planning and fresh starts"},
    2:  {"theme": "Spring Is Coming", "focus": "early preparation and soil care"},
    3:  {"theme": "Spring Into Action", "focus": "spring planting and lawn revival"},
    4:  {"theme": "Garden Growth Season", "focus": "growing season tips and wildlife"},
    5:  {"theme": "Summer Ready Gardens", "focus": "summer preparation and outdoor living"},
    6:  {"theme": "Midsummer Magic", "focus": "peak season care and enjoying your garden"},
    7:  {"theme": "Holiday Garden Care", "focus": "keeping gardens healthy while away"},
    8:  {"theme": "Late Summer Love", "focus": "late summer maintenance and autumn prep"},
    9:  {"theme": "Autumn Begins", "focus": "autumn cleanup and lawn renovation"},
    10: {"theme": "Golden October", "focus": "leaf clearing, planting bulbs, winterising"},
    11: {"theme": "Winter Prep", "focus": "protecting plants and winter projects"},
    12: {"theme": "Year in Review", "focus": "seasonal wrap-up and looking ahead"},
}


def generate_newsletter(
    audience: str = "all",
    include_promotion: bool = False,
    recent_posts: list = None,
) -> dict:
    """
    Generate a monthly newsletter.
    Returns: {subject, body_html, body_text, error}
    """
    now = datetime.now()
    month_names = ["January", "February", "March", "April", "May", "June",
                   "July", "August", "September", "October", "November", "December"]
    month = month_names[now.month - 1]
    theme_data = NEWSLETTER_THEMES.get(now.month, NEWSLETTER_THEMES[1])
    season = _current_season()

    blog_section = ""
    if recent_posts:
        titles = [p.get("title", "") for p in recent_posts[:3] if p.get("title")]
        if titles:
            blog_section = f"\nRecent blog posts to reference (link to www.gardnersgm.co.uk/blog):\n" + \
                           "\n".join(f"- {t}" for t in titles)

    audience_note = ""
    if audience == "paid":
        audience_note = "\nThis is for PAID subscribers — include an exclusive tip or insider advice."
    elif audience == "free":
        audience_note = "\nThis is for FREE subscribers — gently mention the benefits of upgrading."

    promotion_note = "\nDo NOT invent any promotions, discounts, percentage-off offers, or special deals. We never run unsolicited promotions."
    if include_promotion:
        promotion_note = "\nChris has approved a promotion for this newsletter — include it naturally."

    # Fetch live weather for Cornwall to make the newsletter feel current
    weather_context = _fetch_cornwall_weather()

    prompt = f"""Write the {month} newsletter for Gardners Ground Maintenance.

Theme: "{theme_data['theme']}" — focusing on {theme_data['focus']}
Season: {season} in Cornwall
Current weather: {weather_context}
{audience_note}{promotion_note}{blog_section}

Use the current weather to make your greeting and tips feel timely and real.
E.g., "After the wet week we've just had..." or "With temperatures climbing..."

IMPORTANT: Write a SUBSTANTIAL, genuinely useful newsletter that readers will value.
Every tip should include enough detail that someone could actually follow it.
Explain the WHY behind your advice, not just the WHAT.
Reference Cornwall-specific conditions where relevant.

Structure:
1. Warm seasonal greeting referencing current conditions (2-3 sentences, make it feel personal and local)
2. 4-6 detailed, practical garden tips for this time of year in Cornwall — include real horticultural
   knowledge, timing, technique, and explain why each tip matters
3. A nature/wildlife corner — what's happening in Cornwall's natural world right now,
   what wildlife to look out for, and one thing readers can do to help local nature
4. A brief company update or community note from Chris
5. {f"The approved promotion Chris provided" if include_promotion else "A gentle reminder that we offer regular maintenance subscriptions (do NOT invent discounts or offers)"}
6. Warm, personal sign-off from Chris

Format your response EXACTLY like this:
SUBJECT: [engaging email subject line with one emoji at the start]
---HTML---
[newsletter body in clean HTML — use <h2>, <p>, <ul>, <li>, <strong>]
[use inline styles for email compatibility: font-family: Georgia, serif; color: #2d3436; line-height: 1.6]
[include a green accent colour #27ae60 for headings]
[keep it scannable — short paragraphs, bullet points where appropriate]
---TEXT---
[plain text version of the same newsletter — no HTML tags]
"""

    text = llm.generate(prompt, system=BRAND_VOICE, max_tokens=5000, temperature=0.5)

    if text.startswith("[Error"):
        return {"subject": "", "body_html": "", "body_text": "", "error": text}

    result = {
        "subject": f"🌿 {month} Garden Update — Gardners Ground Maintenance",
        "body_html": "",
        "body_text": "",
        "error": "",
    }

    try:
        # Parse subject
        if "SUBJECT:" in text:
            subj_match = re.search(r'SUBJECT:\s*(.+)', text)
            if subj_match:
                result["subject"] = subj_match.group(1).strip().strip('"')

        # Parse HTML body
        if "---HTML---" in text and "---TEXT---" in text:
            html_part = text.split("---HTML---", 1)[1].split("---TEXT---", 1)[0].strip()
            text_part = text.split("---TEXT---", 1)[1].strip()
            result["body_html"] = _sanitise(html_part)
            result["body_text"] = _sanitise(text_part)
        elif "---" in text:
            body = text.split("---", 1)[1].strip()
            result["body_html"] = _sanitise(body)
            result["body_text"] = _sanitise(_strip_html(body))
        else:
            result["body_html"] = _sanitise(text)
            result["body_text"] = _sanitise(_strip_html(text))
    except Exception as e:
        log.warning(f"Newsletter parse issue: {e}")
        result["body_text"] = _sanitise(text)

    return result


# ──────────────────────────────────────────────────────────────────
# Email Template Generator
# ──────────────────────────────────────────────────────────────────

EMAIL_TEMPLATES = {
    "enquiry_received": {
        "subject": "Thanks for your enquiry — Gardners Ground Maintenance",
        "system_extra": "This is an auto-reply to a new enquiry. Be warm and reassuring.",
        "prompt_template": """Write a confirmation email for a customer enquiry.

Customer name: {customer_name}
Service enquired about: {service}
{extra_context}

The email should:
- Thank them warmly for getting in touch
- Confirm we've received their enquiry
- Say Chris will personally review it and get back within 24 hours
- Briefly mention we're a trusted Cornwall-based company
- Keep it short — 100-150 words max
""",
    },

    "quote_sent": {
        "subject": "Your Quote from Gardners Ground Maintenance",
        "system_extra": "This accompanies a formal quote. Be professional but friendly.",
        "prompt_template": """Write a cover email to accompany a quote.

Customer name: {customer_name}
Service: {service}
Quote amount: {quote_amount}
{extra_context}

The email should:
- Reference the quote attached/included
- Briefly explain what's included
- Mention our reliability and quality
- Say we're happy to answer any questions
- Include a gentle prompt to book
- 120-180 words max
""",
    },

    "booking_confirmed": {
        "subject": "Booking Confirmed ✅ — Gardners Ground Maintenance",
        "system_extra": "This confirms a booking. Be clear and reassuring.",
        "prompt_template": """Write a booking confirmation email.

Customer name: {customer_name}
Service: {service}
Date: {date}
Time: {time}
{extra_context}

The email should:
- Confirm the booking details clearly
- Mention what they should expect on the day
- Say we'll send a reminder the day before
- Ask them to let us know if anything changes
- Sign off warmly from Chris
- 100-150 words max
""",
    },

    "day_before_reminder": {
        "subject": "Reminder: We're visiting tomorrow 🌿",
        "system_extra": "This is a friendly day-before reminder. Keep it short and practical.",
        "prompt_template": """Write a day-before reminder email.

Customer name: {customer_name}
Service: {service}
Date: {date}
Time: {time}
{extra_context}

The email should:
- Remind them of tomorrow's appointment
- Mention the service and approximate time
- Ask them to ensure access (gate unlocked, car moved, etc.)
- Be brief and friendly — 60-100 words max
""",
    },

    "job_complete": {
        "subject": "Job Complete — Thank you! 🏁",
        "system_extra": "This follows a completed job. Be warm and appreciative.",
        "prompt_template": """Write a job completion email.

Customer name: {customer_name}
Service completed: {service}
{extra_context}

The email should:
- Thank them for choosing GGM
- Mention the work is complete and hope they're happy with the result
- Mention the invoice is attached/included if applicable
- Encourage them to leave a review or get in touch with feedback
- Mention our subscription plans if they're not already a subscriber
- Sign off warmly — 100-150 words max
""",
    },

    "follow_up": {
        "subject": "How's your garden looking? ⭐",
        "system_extra": "This is a follow-up a few days after service. Be genuine and caring.",
        "prompt_template": """Write a follow-up email sent a few days after a completed job.

Customer name: {customer_name}
Service: {service}
{extra_context}

The email should:
- Check in on how their garden is looking
- Ask if they're happy with the work
- Gently ask if they'd leave a review (mention Google reviews)
- Mention we'd love to help again in the future
- Keep it genuine, not pushy — 80-120 words max
""",
    },

    "subscription_welcome": {
        "subject": "Welcome to your garden subscription! 🌱",
        "system_extra": "This welcomes a new subscription customer. Be enthusiastic.",
        "prompt_template": """Write a welcome email for a new subscription customer.

Customer name: {customer_name}
Plan: {plan}
{extra_context}

The email should:
- Welcome them warmly to the GGM family
- Confirm their subscription plan
- Explain what happens next (first visit scheduling)
- Mention the benefits of regular maintenance
- Make them feel they've made a great decision
- Sign off warmly — 120-160 words max
""",
    },

    "thank_you": {
        "subject": "Thank you for being a valued customer 💚",
        "system_extra": "This is for loyal customers. Be genuinely grateful.",
        "prompt_template": """Write a thank-you email for a loyal customer.

Customer name: {customer_name}
{extra_context}

The email should:
- Express genuine gratitude for their continued custom
- Mention how much we value long-term relationships
- Maybe share a seasonal tip relevant to right now
- Mention they're always welcome to get in touch
- Keep it heartfelt but concise — 80-120 words max
""",
    },
}


def generate_email(
    template_type: str,
    customer_name: str = "there",
    service: str = "",
    date: str = "",
    time: str = "",
    quote_amount: str = "",
    plan: str = "",
    extra_context: str = "",
) -> dict:
    """
    Generate a polished email from a template type.
    Returns: {subject, body_html, body_text, error}
    """
    template = EMAIL_TEMPLATES.get(template_type)
    if not template:
        return {"subject": "", "body_html": "", "body_text": "",
                "error": f"Unknown template: {template_type}"}

    # If no LLM is available, return a solid static template
    if not llm.is_available():
        return _static_email_fallback(template_type, customer_name, service, date, time)

    prompt = template["prompt_template"].format(
        customer_name=customer_name or "there",
        service=service or "garden maintenance",
        date=date or "to be confirmed",
        time=time or "to be confirmed",
        quote_amount=quote_amount or "",
        plan=plan or "",
        extra_context=extra_context or "",
    )

    prompt += """

Format your response EXACTLY like this:
SUBJECT: [email subject line]
---
[email body in clean HTML — use inline styles for email compatibility]
[use font-family: Arial, sans-serif; colour accents in #27ae60 (green)]
[sign off from Chris, Gardners Ground Maintenance]
"""

    system = BRAND_VOICE + "\n\n" + template.get("system_extra", "")
    text = llm.generate(prompt, system=system, max_tokens=1000)

    if text.startswith("[Error"):
        return _static_email_fallback(template_type, customer_name, service, date, time)

    result = {
        "subject": template["subject"],
        "body_html": "",
        "body_text": "",
        "error": "",
    }

    try:
        if "SUBJECT:" in text:
            subj_match = re.search(r'SUBJECT:\s*(.+)', text)
            if subj_match:
                result["subject"] = subj_match.group(1).strip().strip('"')

        if "---" in text:
            body = text.split("---", 1)[1].strip()
        else:
            body = text

        result["body_html"] = _sanitise(body)
        result["body_text"] = _sanitise(_strip_html(body))
    except Exception as e:
        log.warning(f"Email parse issue: {e}")
        result["body_text"] = _sanitise(text)

    return result


def get_all_email_templates(customer_name: str = "Sarah") -> list[dict]:
    """Generate preview of all email templates. Returns list of dicts."""
    results = []
    for template_type in EMAIL_TEMPLATES:
        result = generate_email(
            template_type=template_type,
            customer_name=customer_name,
            service="lawn mowing and hedge trimming",
            date="Monday 15th March",
            time="9:00 AM",
            quote_amount="£85",
            plan="Standard",
        )
        result["type"] = template_type
        result["label"] = config.EMAIL_TYPE_LABELS.get(template_type, template_type)
        results.append(result)
    return results


# ──────────────────────────────────────────────────────────────────
# Static Fallback Templates (no AI needed)
# ──────────────────────────────────────────────────────────────────

def _static_email_fallback(
    template_type: str, name: str, service: str, date: str, time: str
) -> dict:
    """Rock-solid static templates used when no LLM is available."""

    name = name or "there"
    service = service or "your garden maintenance"
    date = date or "the scheduled date"
    time = time or "the agreed time"

    templates = {
        "enquiry_received": {
            "subject": "Thanks for your enquiry — Gardners Ground Maintenance",
            "body": f"""<p style="font-family: Arial, sans-serif; colour: #2d3436; line-height: 1.6;">Hi {name},</p>

<p style="font-family: Arial, sans-serif; colour: #2d3436; line-height: 1.6;">Thank you so much for getting in touch with Gardners Ground Maintenance. I've received your enquiry about <strong>{service}</strong> and I'll personally review it and get back to you within 24 hours.</p>

<p style="font-family: Arial, sans-serif; colour: #2d3436; line-height: 1.6;">We're a trusted, local gardening company here in Cornwall, and we take great pride in looking after our customers' outdoor spaces.</p>

<p style="font-family: Arial, sans-serif; colour: #2d3436; line-height: 1.6;">If you have any questions in the meantime, just reply to this email.</p>

<p style="font-family: Arial, sans-serif; colour: #27ae60; line-height: 1.6;">Cheers,<br><strong>Chris</strong><br>Gardners Ground Maintenance</p>""",
        },

        "quote_sent": {
            "subject": "Your Quote from Gardners Ground Maintenance",
            "body": f"""<p style="font-family: Arial, sans-serif; colour: #2d3436; line-height: 1.6;">Hi {name},</p>

<p style="font-family: Arial, sans-serif; colour: #2d3436; line-height: 1.6;">Thanks for considering Gardners Ground Maintenance for your <strong>{service}</strong>. Please find your quote attached.</p>

<p style="font-family: Arial, sans-serif; colour: #2d3436; line-height: 1.6;">The quote covers everything we discussed, and there are no hidden costs. We always aim to deliver quality work that you'll be delighted with.</p>

<p style="font-family: Arial, sans-serif; colour: #2d3436; line-height: 1.6;">If you'd like to go ahead or have any questions at all, just get in touch — I'm happy to help.</p>

<p style="font-family: Arial, sans-serif; colour: #27ae60; line-height: 1.6;">Best wishes,<br><strong>Chris</strong><br>Gardners Ground Maintenance</p>""",
        },

        "booking_confirmed": {
            "subject": "Booking Confirmed ✅ — Gardners Ground Maintenance",
            "body": f"""<p style="font-family: Arial, sans-serif; colour: #2d3436; line-height: 1.6;">Hi {name},</p>

<p style="font-family: Arial, sans-serif; colour: #2d3436; line-height: 1.6;">Great news — your booking is confirmed! Here are the details:</p>

<ul style="font-family: Arial, sans-serif; colour: #2d3436; line-height: 1.8;">
<li><strong>Service:</strong> {service}</li>
<li><strong>Date:</strong> {date}</li>
<li><strong>Time:</strong> {time}</li>
</ul>

<p style="font-family: Arial, sans-serif; colour: #2d3436; line-height: 1.6;">I'll send you a reminder the day before. If anything changes or you need to reschedule, just let me know.</p>

<p style="font-family: Arial, sans-serif; colour: #27ae60; line-height: 1.6;">Looking forward to it!<br><strong>Chris</strong><br>Gardners Ground Maintenance</p>""",
        },

        "day_before_reminder": {
            "subject": "Reminder: We're visiting tomorrow 🌿",
            "body": f"""<p style="font-family: Arial, sans-serif; colour: #2d3436; line-height: 1.6;">Hi {name},</p>

<p style="font-family: Arial, sans-serif; colour: #2d3436; line-height: 1.6;">Just a quick reminder that I'll be round tomorrow ({date}) at {time} for your <strong>{service}</strong>.</p>

<p style="font-family: Arial, sans-serif; colour: #2d3436; line-height: 1.6;">If you could make sure any gates are unlocked and there's access to the areas we'll be working on, that would be brilliant.</p>

<p style="font-family: Arial, sans-serif; colour: #27ae60; line-height: 1.6;">See you tomorrow!<br><strong>Chris</strong></p>""",
        },

        "job_complete": {
            "subject": "Job Complete — Thank you! 🏁",
            "body": f"""<p style="font-family: Arial, sans-serif; colour: #2d3436; line-height: 1.6;">Hi {name},</p>

<p style="font-family: Arial, sans-serif; colour: #2d3436; line-height: 1.6;">Just to let you know, your <strong>{service}</strong> is all done! I hope you're happy with how everything looks.</p>

<p style="font-family: Arial, sans-serif; colour: #2d3436; line-height: 1.6;">Your invoice is attached. If you have any questions about the work or would like to book in again, just get in touch via our website.</p>

<p style="font-family: Arial, sans-serif; colour: #2d3436; line-height: 1.6;">If you have a moment, a Google review would mean the world to a small business like ours. 🙏</p>

<p style="font-family: Arial, sans-serif; colour: #27ae60; line-height: 1.6;">Thanks again,<br><strong>Chris</strong><br>Gardners Ground Maintenance</p>""",
        },

        "follow_up": {
            "subject": "How's your garden looking? ⭐",
            "body": f"""<p style="font-family: Arial, sans-serif; colour: #2d3436; line-height: 1.6;">Hi {name},</p>

<p style="font-family: Arial, sans-serif; colour: #2d3436; line-height: 1.6;">Hope you're well! I just wanted to check in and see how your garden is looking after the {service} we did recently.</p>

<p style="font-family: Arial, sans-serif; colour: #2d3436; line-height: 1.6;">If you're happy with the work, I'd really appreciate a quick Google review — it makes such a difference for a local business.</p>

<p style="font-family: Arial, sans-serif; colour: #2d3436; line-height: 1.6;">We're always here if you need us again. Have a great week!</p>

<p style="font-family: Arial, sans-serif; colour: #27ae60; line-height: 1.6;">Cheers,<br><strong>Chris</strong><br>Gardners Ground Maintenance</p>""",
        },

        "subscription_welcome": {
            "subject": "Welcome to your garden subscription! 🌱",
            "body": f"""<p style="font-family: Arial, sans-serif; colour: #2d3436; line-height: 1.6;">Hi {name},</p>

<p style="font-family: Arial, sans-serif; colour: #2d3436; line-height: 1.6;">Welcome to the Gardners Ground Maintenance family! You've made a brilliant decision — regular maintenance is the best thing you can do for your garden.</p>

<p style="font-family: Arial, sans-serif; colour: #2d3436; line-height: 1.6;">I'll be in touch shortly to schedule your first visit. From there, you won't need to worry about a thing — your garden will always be in great shape.</p>

<p style="font-family: Arial, sans-serif; colour: #2d3436; line-height: 1.6;">If you have any questions about your plan, just give me a shout.</p>

<p style="font-family: Arial, sans-serif; colour: #27ae60; line-height: 1.6;">Welcome aboard!<br><strong>Chris</strong><br>Gardners Ground Maintenance</p>""",
        },

        "thank_you": {
            "subject": "Thank you for being a valued customer 💚",
            "body": f"""<p style="font-family: Arial, sans-serif; colour: #2d3436; line-height: 1.6;">Hi {name},</p>

<p style="font-family: Arial, sans-serif; colour: #2d3436; line-height: 1.6;">I just wanted to take a moment to say a genuine thank you for trusting Gardners Ground Maintenance with your garden. It means the world to me.</p>

<p style="font-family: Arial, sans-serif; colour: #2d3436; line-height: 1.6;">Building long-term relationships with customers like you is what this business is all about. Your garden is always in safe hands with us.</p>

<p style="font-family: Arial, sans-serif; colour: #2d3436; line-height: 1.6;">Here's to many more seasons of a beautiful garden! 🌿</p>

<p style="font-family: Arial, sans-serif; colour: #27ae60; line-height: 1.6;">With thanks,<br><strong>Chris</strong><br>Gardners Ground Maintenance</p>""",
        },
    }

    t = templates.get(template_type, templates["enquiry_received"])
    return {
        "subject": t["subject"],
        "body_html": t["body"],
        "body_text": _strip_html(t["body"]),
        "error": "",
    }


# ──────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────

def _current_season() -> str:
    month = datetime.now().month
    if month in (3, 4, 5):
        return "spring"
    if month in (6, 7, 8):
        return "summer"
    if month in (9, 10, 11):
        return "autumn"
    return "winter"


def _strip_html(html: str) -> str:
    """Quick and dirty HTML tag removal for plain text versions."""
    text = re.sub(r'<br\s*/?>', '\n', html)
    text = re.sub(r'<li[^>]*>', '• ', text)
    text = re.sub(r'</li>', '\n', text)
    text = re.sub(r'</(p|h[1-6]|ul|ol|div)>', '\n\n', text)
    text = re.sub(r'<[^>]+>', '', text)
    text = re.sub(r'\n{3,}', '\n\n', text)
    return text.strip()


# ──────────────────────────────────────────────────────────────────
# Branded Newsletter HTML Wrapper
# ──────────────────────────────────────────────────────────────────

def wrap_newsletter_html(body_html: str, subject: str = "", image_url: str = "") -> str:
    """Wrap newsletter body in the branded GGM email template.
    
    Matches the Listmonk base-layout.html branding:
    - Green gradient header with GGM logo
    - Clean content area with proper typography
    - Branded footer with socials, address, unsubscribe
    
    Args:
        body_html: The newsletter content as HTML
        subject: Email subject (used as header heading)
        image_url: Optional hero image URL (e.g., from Pexels)
    
    Returns:
        Complete branded HTML email string
    """
    year = datetime.now().year

    hero_section = ""
    if image_url:
        hero_section = f'''
    <div style="text-align:center; padding:0;">
      <img src="{image_url}" alt="Garden scene" style="width:100%; max-height:280px; object-fit:cover; display:block;" />
    </div>'''

    return f'''<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0; padding:0; background:#f4f7f4; font-family:'Segoe UI', Arial, sans-serif;">
<div style="max-width:600px; margin:0 auto; background:#ffffff;">

  <!-- Header -->
  <div style="background:linear-gradient(135deg, #2d5016 0%, #4a7c28 100%); padding:30px 24px; text-align:center;">
    <h1 style="color:#ffffff; margin:10px 0 0; font-size:20px; font-weight:600;">🌿 Gardners Ground Maintenance</h1>
    <p style="color:#c8e6b0; margin:4px 0 0; font-size:13px;">Professional Garden Care in Cornwall</p>
  </div>

  {hero_section}

  <!-- Content -->
  <div style="padding:32px 24px; color:#333; line-height:1.6; font-size:15px;">
    {body_html}

    <hr style="border:none; border-top:1px solid #e8e8e8; margin:24px 0;" />

    <p style="text-align:center;">
      <a href="https://gardnersgm.co.uk/booking" style="display:inline-block; background:#4a7c28; color:#fff; padding:12px 28px; border-radius:6px; text-decoration:none; font-weight:600;">Book a Service</a>
    </p>

    <p>Happy gardening! 🌿</p>
    <p><strong>Chris</strong><br>Gardners Ground Maintenance</p>
  </div>

  <!-- Footer -->
  <div style="background:#2d5016; padding:24px; text-align:center; color:#c8e6b0; font-size:12px;">
    <div style="margin:12px 0;">
      <a href="https://facebook.com/gardnersgm" style="color:#a8d88a; text-decoration:underline; margin:0 6px;">Facebook</a> &bull;
      <a href="https://instagram.com/gardnersgm" style="color:#a8d88a; text-decoration:underline; margin:0 6px;">Instagram</a>
    </div>
    <p style="margin:8px 0;">
      Gardners Ground Maintenance<br>
      Cornwall, UK<br>
      🌐 <a href="https://gardnersgm.co.uk" style="color:#a8d88a;">www.gardnersgm.co.uk</a>
    </p>
    <p style="color:#8aaa70; margin-top:8px;">
      &copy; {year} Gardners Ground Maintenance. All rights reserved.
    </p>
  </div>

</div>
</body>
</html>'''
