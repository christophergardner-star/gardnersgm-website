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
- Warm, friendly, and genuine — like chatting with a knowledgeable neighbour
- Professional but never corporate or stiff
- Passionate about gardens and outdoor spaces
- Proud of Cornwall and the local community
- Practical and helpful — always sharing real, actionable advice
- Occasionally uses light humour but never forced

BUSINESS FACTS (use only these, never make up contact details):
- Company: Gardners Ground Maintenance (GGM)
- Owner: Chris
- Location: Cornwall, UK
- Website: www.gardnersgm.co.uk
- Services: Lawn mowing, hedge trimming, garden clearance, power washing,
  leaf clearing, planting, landscaping, general garden maintenance
- Subscription plans: Essential, Standard, Premium (regular visits)
- Booking: Through the website or by contacting us via the website

RULES:
- NEVER invent phone numbers, email addresses, or social media handles
- NEVER mention specific prices unless told to
- NEVER use American spellings — use British English (colour, organise, etc.)
- Keep paragraphs short and scannable
- Use seasonal references relevant to Cornwall's mild maritime climate
"""


# ──────────────────────────────────────────────────────────────────
# Content Sanitiser
# ──────────────────────────────────────────────────────────────────

def _sanitise(text: str) -> str:
    """Remove hallucinated contact details and fix common LLM issues."""
    # Remove fake phone numbers (UK format)
    text = re.sub(r'\b0\d{3,4}[\s\-]?\d{3,4}[\s\-]?\d{3,4}\b', '[contact us via the website]', text)
    text = re.sub(r'\+44[\s\-]?\d[\s\-]?\d{3,4}[\s\-]?\d{3,4}', '[contact us via the website]', text)

    # Remove fake email addresses (except real ones)
    real_emails = []  # add any real emails here
    def replace_email(m):
        email = m.group(0)
        if email in real_emails:
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
    }
    for us, uk in american_to_british.items():
        text = re.sub(rf'\b{us}\b', uk, text, flags=re.IGNORECASE)

    return text


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


def generate_blog_post(topic: str = None, word_count: int = 700) -> dict:
    """
    Generate a professional blog post.
    Returns: {title, content, excerpt, category, tags, social, error}
    """
    now = datetime.now()

    if not topic:
        month_topics = MONTHLY_TOPICS.get(now.month, MONTHLY_TOPICS[1])
        topic = random.choice(month_topics)

    category = _detect_category(topic)

    prompt = f"""Write a blog post about: {topic}

Requirements:
- {word_count - 100} to {word_count + 100} words
- Written for homeowners in Cornwall, UK
- Practical, actionable advice they can use
- Naturally mention that Gardners Ground Maintenance can help with professional services
- Do NOT include a call-to-action at the end asking them to call — instead say "get in touch via our website"

Format your response EXACTLY like this:
TITLE: [compelling, SEO-friendly title — max 70 chars]
EXCERPT: [2-sentence summary for previews — max 160 chars]
TAGS: [comma-separated keywords, 5-8 tags]
SOCIAL: [one short social media post about this article, 1-2 sentences, include a relevant emoji]
---
[blog post content in clean HTML using <h2>, <h3>, <p>, <ul>, <li>, <strong> tags]
[do NOT wrap the whole thing in a container div]
[do NOT include <h1> — the title is shown separately]
"""

    text = llm.generate(prompt, system=BRAND_VOICE, max_tokens=3000)

    if text.startswith("[Error"):
        return {"title": topic, "content": "", "excerpt": "", "category": category,
                "tags": "", "social": "", "error": text}

    # Parse structured output
    result = {
        "title": topic,
        "content": "",
        "excerpt": "",
        "category": category,
        "tags": "",
        "social": "",
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

    return result


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
    include_promotion: bool = True,
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

    promotion_note = ""
    if include_promotion:
        promotion_note = "\nInclude ONE seasonal promotion or special offer (something reasonable and believable)."

    prompt = f"""Write the {month} newsletter.

Theme: "{theme_data['theme']}" — focusing on {theme_data['focus']}
Season: {season} in Cornwall
{audience_note}{promotion_note}{blog_section}

Structure:
1. Warm seasonal greeting (1-2 sentences)
2. 3-4 practical garden tips for this time of year in Cornwall
3. A brief company update or community note
4. {f"The promotion/offer" if include_promotion else "A reminder about subscription services"}
5. Warm sign-off from Chris

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

    text = llm.generate(prompt, system=BRAND_VOICE, max_tokens=3000)

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
