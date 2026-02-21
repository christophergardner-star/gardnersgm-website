"""
service_email_content.py — Centralised email content for all GGM services.

Provides preparation tips, aftercare advice, upsell suggestions and
seasonal context for every active service.  Used by email_automation.py
to build service-specific email templates.
"""

# ---------------------------------------------------------------------------
# Preparation Tips  (sent in booking confirmation + day-before reminder)
# ---------------------------------------------------------------------------
PREPARATION_TIPS: dict[str, dict] = {
    "lawn-cutting": {
        "title": "Getting Ready for Your Lawn Cut",
        "tips": [
            "Please move any garden furniture, toys or obstacles off the lawn",
            "Ensure side gate access is unlocked so we can reach the garden",
            "If there are any areas you'd like us to avoid (flower beds, wildlife patches), let us know",
            "Pets are best kept indoors while we're mowing for their safety",
        ],
        "duration": "30-60 minutes depending on lawn size",
    },
    "hedge-trimming": {
        "title": "Preparing for Your Hedge Trim",
        "tips": [
            "Check there are no bird nests in the hedge — it's illegal to disturb nesting birds (March–August)",
            "Move any bins, garden furniture or vehicles away from the hedge line",
            "Let us know if there are any cables or wires running through the hedge",
            "We'll remove all clippings — no need to prepare bags or bins",
        ],
        "duration": "1-3 hours depending on hedge length and height",
    },
    "garden-clearance": {
        "title": "Before Your Garden Clearance",
        "tips": [
            "Walk through the garden and mark anything you'd like kept (plants, ornaments, etc.)",
            "Let us know if there's anything heavy or structural that needs moving",
            "We can handle green waste, but please flag any items that may need specialist disposal",
            "Ensure access is clear for our team and any equipment we bring",
        ],
        "duration": "Half day to full day depending on scope",
    },
    "scarifying": {
        "title": "Getting Ready for Scarifying",
        "tips": [
            "The lawn should be mowed short (around 25mm) before we arrive",
            "Water the lawn well 2-3 days before if the weather has been dry",
            "Remove any garden furniture or toys from the lawn",
            "Don't worry if the lawn looks rough afterwards — it recovers quickly!",
        ],
        "duration": "1-2 hours depending on lawn size",
    },
    "lawn-treatment": {
        "title": "Before Your Lawn Treatment",
        "tips": [
            "Mow the lawn 2-3 days before the treatment for best absorption",
            "Clear any pet waste from the lawn before we arrive",
            "Keep pets and children off the treated lawn for at least 24 hours afterwards",
            "Avoid watering the lawn for 24-48 hours after treatment (unless it rains naturally)",
        ],
        "duration": "30-60 minutes depending on lawn size",
    },
    "strimming": {
        "title": "Preparing for Your Strimming",
        "tips": [
            "Clear any loose items (cables, hoses, toys) from the areas to be strimmed",
            "Let us know if there are any delicate plants near the edges we should avoid",
            "Ensure access to all areas that need attention — side paths, fence lines, etc.",
            "Mark any sprinkler heads or irrigation lines near the strim zone",
        ],
        "duration": "30 minutes to 2 hours depending on area",
    },
    "leaf-clearance": {
        "title": "Before Your Leaf Clearance",
        "tips": [
            "Move any lightweight garden furniture or ornaments that could be in the way",
            "Let us know if there are any drains or gullies that need clearing too",
            "We'll collect and remove all leaves — green waste disposal is included",
            "Ideally wait for a dry day (we'll let you know if rescheduling would be better)",
        ],
        "duration": "1-3 hours depending on garden size and tree cover",
    },
    "power-washing": {
        "title": "Preparing for Power Washing",
        "tips": [
            "Move any pots, furniture or vehicles from the area being washed",
            "Close windows and doors near the wash area to prevent spray",
            "Point out any cracked or loose slabs/rendering before we start",
            "We'll need access to an outdoor water tap — let us know if there isn't one nearby",
        ],
        "duration": "2-4 hours depending on area size",
    },
}

# ---------------------------------------------------------------------------
# Aftercare Tips  (sent 1 day after job completion)
# ---------------------------------------------------------------------------
AFTERCARE_TIPS: dict[str, dict] = {
    "lawn-cutting": {
        "title": "Aftercare for Your Freshly Cut Lawn",
        "tips": [
            "Water your lawn lightly if the weather is dry — morning is best",
            "Avoid heavy foot traffic for a day to let the grass recover",
            "Regular cutting (every 1-2 weeks in growing season) keeps it thick and healthy",
            "Consider a feed in spring and autumn for a deeper green colour",
        ],
        "next_service": "For an even healthier lawn, consider a lawn treatment or scarifying service.",
    },
    "hedge-trimming": {
        "title": "Aftercare for Your Trimmed Hedges",
        "tips": [
            "Water the base of the hedge well if the weather is dry",
            "Apply a balanced fertiliser to encourage healthy new growth",
            "Trimming 2-3 times per year keeps hedges dense and tidy",
            "Check for any gaps — these can be filled with new planting in autumn",
        ],
        "next_service": "Regular hedge maintenance keeps your boundaries smart and private all year round.",
    },
    "garden-clearance": {
        "title": "After Your Garden Clearance",
        "tips": [
            "Now is the perfect time to plan new planting or landscaping",
            "Lay fresh mulch to suppress weeds and retain moisture",
            "Consider a regular maintenance plan to keep on top of things",
            "If we've cleared overgrown areas, keep an eye out for wildlife returning — they'll appreciate the new space!",
        ],
        "next_service": "Keep your cleared garden tidy with regular lawn and hedge maintenance.",
    },
    "scarifying": {
        "title": "After Your Lawn Scarifying",
        "tips": [
            "Your lawn may look tired for 2-4 weeks — this is completely normal",
            "Overseed any thin or bare patches within a week for best results",
            "Water regularly (especially if it doesn't rain) to help the lawn recover",
            "Avoid heavy use of the lawn for 3-4 weeks while it recovers",
        ],
        "next_service": "Follow up with a lawn treatment to boost recovery and colour.",
    },
    "lawn-treatment": {
        "title": "After Your Lawn Treatment",
        "tips": [
            "Keep pets and children off the treated area for 24 hours",
            "Don't mow for at least 3-5 days after treatment",
            "Avoid watering for 24-48 hours unless it rains naturally",
            "You should see results within 7-14 days — greener, thicker grass",
        ],
        "next_service": "For the best results, treatments work brilliantly alongside regular mowing.",
    },
    "strimming": {
        "title": "After Your Strimming",
        "tips": [
            "Check edges for any plants that may need a drink after being exposed",
            "Keep on top of edge growth with monthly strimming during the growing season",
            "Consider laying edging strips to reduce the need for frequent strimming",
            "Collect any debris we've loosened from hard-to-reach corners",
        ],
        "next_service": "Combine strimming with regular lawn cutting for a consistently tidy garden.",
    },
    "leaf-clearance": {
        "title": "After Your Leaf Clearance",
        "tips": [
            "Check gutters and drains — leaves can block them even after a clearance",
            "Leaves make excellent compost if you have a compost bin",
            "Bare soil exposed by leaf removal is a good spot for spring bulbs",
            "In heavy leaf-fall areas, a follow-up clearance in 4-6 weeks keeps things tidy",
        ],
        "next_service": "Pair leaf clearance with gutter cleaning for full autumn protection.",
    },
    "power-washing": {
        "title": "After Your Power Wash",
        "tips": [
            "Allow surfaces to dry completely (24-48 hours) before replacing furniture",
            "Consider applying a sealant to patios to protect against future algae and moss",
            "Avoid using bleach or harsh chemicals on freshly washed surfaces",
            "Annual power washing keeps driveways and patios looking their best",
        ],
        "next_service": "Regular power washing prevents build-up and keeps your property looking its best.",
    },
}

# ---------------------------------------------------------------------------
# Upsell / Cross-sell Suggestions  (used in promo emails)
# ---------------------------------------------------------------------------
UPSELL_SUGGESTIONS: dict[str, dict] = {
    "lawn-cutting": {
        "title": "Upgrade Your Lawn Care",
        "services": [
            {"name": "Lawn Treatment",   "reason": "Professional feed & weed for a lush, green lawn"},
            {"name": "Scarifying",        "reason": "Remove thatch and moss for healthier grass growth"},
            {"name": "Strimming",         "reason": "Crisp, clean edges to finish off your lawn perfectly"},
        ],
    },
    "hedge-trimming": {
        "title": "Complete Your Garden Boundaries",
        "services": [
            {"name": "Garden Clearance",  "reason": "Clear overgrown areas behind hedges"},
            {"name": "Strimming",         "reason": "Tidy the base and edges around your hedges"},
        ],
    },
    "garden-clearance": {
        "title": "Keep Your Garden Looking Great",
        "services": [
            {"name": "Lawn Cutting",      "reason": "Regular mowing to maintain your newly cleared space"},
            {"name": "Hedge Trimming",     "reason": "Keep boundaries neat after your clearance"},
            {"name": "Power Washing",      "reason": "Clean hard surfaces uncovered during the clearance"},
        ],
    },
    "scarifying": {
        "title": "The Complete Lawn Package",
        "services": [
            {"name": "Lawn Treatment",   "reason": "Feed and protect your lawn after scarifying"},
            {"name": "Lawn Cutting",      "reason": "Regular mowing to maintain the great results"},
        ],
    },
    "lawn-treatment": {
        "title": "Take Your Lawn to the Next Level",
        "services": [
            {"name": "Scarifying",        "reason": "Remove thatch so treatments absorb better"},
            {"name": "Lawn Cutting",      "reason": "Regular cuts complement treatment results perfectly"},
        ],
    },
    "strimming": {
        "title": "Round Out Your Garden Maintenance",
        "services": [
            {"name": "Lawn Cutting",      "reason": "Complete the look with a professional mow"},
            {"name": "Hedge Trimming",     "reason": "Keep all your garden borders smart and tidy"},
        ],
    },
    "leaf-clearance": {
        "title": "Autumn Garden Protection",
        "services": [
            {"name": "Power Washing",      "reason": "Remove slippery algae from paths and patios"},
            {"name": "Hedge Trimming",     "reason": "Late-season trim before the hedges go dormant"},
        ],
    },
    "power-washing": {
        "title": "The Full Exterior Clean",
        "services": [
            {"name": "Garden Clearance",  "reason": "Tidy up the garden to match your clean surfaces"},
            {"name": "Leaf Clearance",     "reason": "Clear debris that causes algae and moss"},
        ],
    },
}


# ---------------------------------------------------------------------------
# Helper Functions
# ---------------------------------------------------------------------------

def _normalise_service_key(service: str) -> str:
    """Convert any service name variant to a normalised key."""
    if not service:
        return ""
    key = service.lower().strip()
    key = key.replace(" ", "-").replace("_", "-")
    # Handle common variants
    aliases = {
        "lawn-mowing": "lawn-cutting",
        "mowing": "lawn-cutting",
        "hedges": "hedge-trimming",
        "hedge-cutting": "hedge-trimming",
        "clearance": "garden-clearance",
        "patio-cleaning": "power-washing",
        "jet-washing": "power-washing",
        "pressure-washing": "power-washing",
        "leaf-removal": "leaf-clearance",
        "leaves": "leaf-clearance",
        "weed-treatment": "lawn-treatment",
        "feed-and-weed": "lawn-treatment",
        "edging": "strimming",
        "edge-trimming": "strimming",
    }
    return aliases.get(key, key)


def get_preparation_tips(service: str) -> dict | None:
    """Return preparation tips dict for a service, or None if not found."""
    key = _normalise_service_key(service)
    return PREPARATION_TIPS.get(key)


def get_aftercare_tips(service: str) -> dict | None:
    """Return aftercare tips dict for a service, or None if not found."""
    key = _normalise_service_key(service)
    return AFTERCARE_TIPS.get(key)


def get_upsell_suggestions(service: str) -> dict | None:
    """Return upsell suggestions dict for a service, or None if not found."""
    key = _normalise_service_key(service)
    return UPSELL_SUGGESTIONS.get(key)


def get_service_display_name(service: str) -> str:
    """Convert service key to display name (e.g. 'lawn-cutting' -> 'Lawn Cutting')."""
    key = _normalise_service_key(service)
    return key.replace("-", " ").title() if key else service


def format_tips_html(tips: list[str], colour: str = "#2d6a4f") -> str:
    """Format a list of tips as styled HTML list items."""
    items = ""
    for tip in tips:
        items += f"""
        <li style="margin-bottom:8px; padding-left:8px; line-height:1.5;">
            <span style="color:{colour}; font-weight:bold; margin-right:6px;">&#10003;</span>
            {tip}
        </li>"""
    return f'<ul style="list-style:none; padding:0; margin:12px 0;">{items}</ul>'


def format_upsell_html(suggestions: dict) -> str:
    """Format upsell suggestions as styled HTML cards."""
    if not suggestions:
        return ""
    cards = ""
    for svc in suggestions.get("services", []):
        cards += f"""
        <div style="background:#f0faf4; border-left:4px solid #2d6a4f;
                    padding:12px 16px; margin:8px 0; border-radius:4px;">
            <strong style="color:#2d6a4f;">{svc['name']}</strong><br>
            <span style="color:#555; font-size:14px;">{svc['reason']}</span>
        </div>"""
    return f"""
    <div style="margin:20px 0;">
        <h3 style="color:#2d6a4f; margin-bottom:8px;">{suggestions.get('title', 'Other Services You Might Like')}</h3>
        {cards}
        <p style="margin-top:12px;">
            <a href="https://gardnersgm.co.uk/booking.html"
               style="background:#2d6a4f; color:white; padding:10px 24px;
                      text-decoration:none; border-radius:6px; display:inline-block;">
                Book a Service
            </a>
        </p>
    </div>"""
