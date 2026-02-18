"""
GGM Hub — Pricing Engine
=========================
Centralised service catalogue with tiered pricing, add-on extras,
travel surcharges, and deposit calculation.  Mirrors the website's
booking.js quoteConfig but adds all hidden/dormant services too.

Prices are stored in **pence** internally (matching GAS / booking.js)
and converted to pounds only for display.
"""

# ──────────────────────────────────────────────────────────────────
# Service Catalogue
# ──────────────────────────────────────────────────────────────────
# Each service has:
#   - display_name : str          — pretty label
#   - active       : bool         — shown on website (vs dormant)
#   - base_price   : int (pence)  — fallback minimum
#   - options       : list[dict]  — tiered pricing selectors
#   - extras        : list[dict]  — bolt-on add-ons
#
# Option dict:
#   { id, label, choices: [{text, value_pence}] }
#
# Extra dict:
#   { id, label, price_pence, checked (default False), multiplier (optional) }
# ──────────────────────────────────────────────────────────────────

SERVICE_CATALOGUE = {
    "lawn-cutting": {
        "display_name": "Lawn Cutting",
        "active": True,
        "base_price": 3000,
        "options": [
            {
                "id": "lawnSize",
                "label": "Lawn Size",
                "choices": [
                    {"text": "Small (up to 50m\u00b2)", "value": 3000},
                    {"text": "Medium (50\u2013150m\u00b2)", "value": 4000},
                    {"text": "Large (150\u2013300m\u00b2)", "value": 5500},
                    {"text": "Extra Large (300m\u00b2+)", "value": 7500},
                ],
            },
            {
                "id": "lawnArea",
                "label": "Areas",
                "choices": [
                    {"text": "Front only", "value": 0},
                    {"text": "Back only", "value": 0},
                    {"text": "Front & Back", "value": 1000},
                ],
            },
        ],
        "extras": [
            {"id": "edging", "label": "Edging & strimming", "price": 500},
            {"id": "clippings", "label": "Clippings collected & removed", "price": 0, "checked": True},
        ],
    },
    "hedge-trimming": {
        "display_name": "Hedge Trimming",
        "active": True,
        "base_price": 4500,
        "options": [
            {
                "id": "hedgeCount",
                "label": "Number of Hedges",
                "choices": [
                    {"text": "1 hedge", "value": 0},
                    {"text": "2 hedges", "value": 2500},
                    {"text": "3 hedges", "value": 4500},
                    {"text": "4+ hedges", "value": 7000},
                ],
            },
            {
                "id": "hedgeSize",
                "label": "Hedge Size",
                "choices": [
                    {"text": "Small (under 2m tall, under 5m long)", "value": 4500},
                    {"text": "Medium (2\u20133m tall, 5\u201315m long)", "value": 8500},
                    {"text": "Large (3m+ tall or 15m+ long)", "value": 15000},
                ],
            },
        ],
        "extras": [
            {"id": "waste", "label": "Waste removal included", "price": 0, "checked": True},
            {"id": "shaping", "label": "Decorative shaping", "price": 2000},
            {"id": "reduction", "label": "Height reduction (heavy cut back)", "price": 3500},
        ],
    },
    "garden-clearance": {
        "display_name": "Garden Clearance",
        "active": True,
        "base_price": 10000,
        "options": [
            {
                "id": "clearLevel",
                "label": "Clearance Level",
                "choices": [
                    {"text": "Light (tidy up, minor overgrowth)", "value": 10000},
                    {"text": "Medium (overgrown beds, some waste)", "value": 18000},
                    {"text": "Heavy (fully overgrown / neglected)", "value": 28000},
                    {"text": "Full property clearance", "value": 42000},
                ],
            },
        ],
        "extras": [
            {"id": "skipHire", "label": "Skip hire (we arrange it)", "price": 22000},
            {"id": "rubbishRemoval", "label": "Rubbish removal (van load)", "price": 7500},
            {"id": "strimming", "label": "Strimming & brush cutting", "price": 2500},
        ],
    },
    "scarifying": {
        "display_name": "Scarifying",
        "active": False,
        "base_price": 7000,
        "options": [
            {
                "id": "scarifySize",
                "label": "Lawn Size",
                "choices": [
                    {"text": "Small (up to 50m\u00b2)", "value": 7000},
                    {"text": "Medium (50\u2013150m\u00b2)", "value": 9500},
                    {"text": "Large (150\u2013300m\u00b2)", "value": 13000},
                    {"text": "Extra Large (300m\u00b2+)", "value": 18000},
                ],
            },
        ],
        "extras": [
            {"id": "scarifyCollect", "label": "Thatch collected & removed", "price": 0, "checked": True},
            {"id": "scarifyOverseed", "label": "Overseeding after scarify", "price": 2500},
        ],
    },
    "lawn-treatment": {
        "display_name": "Lawn Treatment",
        "active": False,
        "base_price": 3500,
        "options": [
            {
                "id": "treatSize",
                "label": "Lawn Size",
                "choices": [
                    {"text": "Small (up to 50m\u00b2)", "value": 3500},
                    {"text": "Medium (50\u2013150m\u00b2)", "value": 5000},
                    {"text": "Large (150\u2013300m\u00b2)", "value": 7500},
                    {"text": "Extra Large (300m\u00b2+)", "value": 10000},
                ],
            },
            {
                "id": "treatType",
                "label": "Treatment Type",
                "choices": [
                    {"text": "Feed & weed", "value": 0},
                    {"text": "Moss treatment", "value": 1000},
                    {"text": "Full programme (feed, weed & moss)", "value": 2000},
                ],
            },
        ],
        "extras": [],
    },
    "power-washing": {
        "display_name": "Power Washing",
        "active": False,
        "base_price": 5000,
        "options": [
            {
                "id": "pwSurface",
                "label": "Surface Type",
                "choices": [
                    {"text": "Patio", "value": 5000},
                    {"text": "Driveway", "value": 7000},
                    {"text": "Decking", "value": 6000},
                    {"text": "Paths / steps", "value": 4000},
                    {"text": "Walls / fencing", "value": 6000},
                ],
            },
            {
                "id": "pwArea",
                "label": "Area Size",
                "choices": [
                    {"text": "Small (up to 15m\u00b2)", "value": 0},
                    {"text": "Medium (15\u201340m\u00b2)", "value": 2500},
                    {"text": "Large (40\u201380m\u00b2)", "value": 5000},
                    {"text": "Extra Large (80m\u00b2+)", "value": 8500},
                ],
            },
        ],
        "extras": [
            {"id": "pwSealant", "label": "Sealant / re-sand after washing", "price": 3500},
            {"id": "pwSecondSurface", "label": "Additional surface (+50%)", "price": 0, "multiplier": 0.5},
        ],
    },
    "veg-patch": {
        "display_name": "Veg Patch Setup",
        "active": False,
        "base_price": 7000,
        "options": [
            {
                "id": "vegSize",
                "label": "Patch Size",
                "choices": [
                    {"text": "Small raised bed (up to 4m\u00b2)", "value": 7000},
                    {"text": "Medium plot (4\u201312m\u00b2)", "value": 10000},
                    {"text": "Large allotment-style (12\u201330m\u00b2)", "value": 15000},
                    {"text": "Extra Large (30m\u00b2+)", "value": 22000},
                ],
            },
            {
                "id": "vegCondition",
                "label": "Current Condition",
                "choices": [
                    {"text": "Bare soil \u2014 ready to prep", "value": 0},
                    {"text": "Overgrown \u2014 needs clearing first", "value": 3500},
                    {"text": "New bed \u2014 turf removal required", "value": 5000},
                ],
            },
        ],
        "extras": [
            {"id": "vegCompost", "label": "Compost & soil improver added", "price": 2500},
            {"id": "vegEdging", "label": "Timber edging / raised bed frame", "price": 4500},
            {"id": "vegMembrane", "label": "Weed membrane laid", "price": 1500},
        ],
    },
    "weeding-treatment": {
        "display_name": "Weeding Treatment",
        "active": False,
        "base_price": 4000,
        "options": [
            {
                "id": "weedArea",
                "label": "Area Size",
                "choices": [
                    {"text": "Small (single border / beds)", "value": 4000},
                    {"text": "Medium (front or back garden)", "value": 6000},
                    {"text": "Large (full garden)", "value": 9000},
                    {"text": "Extra Large (extensive grounds)", "value": 14000},
                ],
            },
            {
                "id": "weedType",
                "label": "Treatment Type",
                "choices": [
                    {"text": "Hand weeding only", "value": 0},
                    {"text": "Spray treatment (selective)", "value": 1500},
                    {"text": "Hand weeding + spray combo", "value": 2500},
                ],
            },
        ],
        "extras": [
            {"id": "weedMulch", "label": "Bark mulch applied after", "price": 3000},
            {"id": "weedMembrane", "label": "Weed membrane under mulch", "price": 1500},
        ],
    },
    "fence-repair": {
        "display_name": "Fence Repair",
        "active": False,
        "base_price": 6500,
        "options": [
            {
                "id": "fenceType",
                "label": "Repair Type",
                "choices": [
                    {"text": "Panel replacement (1 panel)", "value": 6500},
                    {"text": "Panel replacement (2\u20133 panels)", "value": 13000},
                    {"text": "Panel replacement (4+ panels)", "value": 19000},
                    {"text": "Post repair / replacement", "value": 5000},
                    {"text": "Full fence section rebuild", "value": 22000},
                ],
            },
            {
                "id": "fenceHeight",
                "label": "Fence Height",
                "choices": [
                    {"text": "Standard (up to 6ft)", "value": 0},
                    {"text": "Tall (over 6ft)", "value": 2500},
                ],
            },
        ],
        "extras": [
            {"id": "fenceTreat", "label": "Timber treatment / staining", "price": 2000},
            {"id": "fenceWaste", "label": "Old fence removal & disposal", "price": 2500},
            {"id": "fenceGravel", "label": "Gravel board installation", "price": 1500},
        ],
    },
    "emergency-tree": {
        "display_name": "Emergency Tree Work",
        "active": False,
        "base_price": 18000,
        "options": [
            {
                "id": "treeSize",
                "label": "Tree Size",
                "choices": [
                    {"text": "Small tree (under 5m)", "value": 18000},
                    {"text": "Medium tree (5\u201310m)", "value": 35000},
                    {"text": "Large tree (10m+)", "value": 60000},
                ],
            },
            {
                "id": "treeWork",
                "label": "Work Required",
                "choices": [
                    {"text": "Fallen branch removal", "value": 0},
                    {"text": "Storm-damaged crown reduction", "value": 10000},
                    {"text": "Emergency felling (dangerous tree)", "value": 25000},
                    {"text": "Root plate / stump emergency", "value": 17500},
                ],
            },
        ],
        "extras": [
            {"id": "treeLogSplit", "label": "Log splitting & stacking", "price": 6500},
            {"id": "treeWaste", "label": "Full waste removal & chipping", "price": 8500},
            {"id": "treeStump", "label": "Stump grinding", "price": 12000},
        ],
    },
    "drain-clearance": {
        "display_name": "Drain Clearance",
        "active": False,
        "base_price": 4500,
        "options": [
            {
                "id": "drainType",
                "label": "Drain Type",
                "choices": [
                    {"text": "Single blocked drain", "value": 4500},
                    {"text": "Multiple drains (2\u20133)", "value": 7000},
                    {"text": "Full garden drainage run", "value": 11000},
                ],
            },
            {
                "id": "drainCondition",
                "label": "Condition",
                "choices": [
                    {"text": "Partially blocked (slow)", "value": 0},
                    {"text": "Fully blocked (standing water)", "value": 1500},
                    {"text": "Root ingress", "value": 3000},
                ],
            },
        ],
        "extras": [
            {"id": "drainJet", "label": "Pressure jetting", "price": 2500},
            {"id": "drainGuard", "label": "Drain guard installation", "price": 1500},
        ],
    },
    "gutter-cleaning": {
        "display_name": "Gutter Cleaning",
        "active": False,
        "base_price": 4500,
        "options": [
            {
                "id": "gutterLength",
                "label": "Property Size",
                "choices": [
                    {"text": "Small (terraced / 1\u20132 bed)", "value": 4500},
                    {"text": "Medium (semi / 3 bed)", "value": 6500},
                    {"text": "Large (detached / 4+ bed)", "value": 9000},
                ],
            },
            {
                "id": "gutterCondition",
                "label": "Condition",
                "choices": [
                    {"text": "Routine clean (light debris)", "value": 0},
                    {"text": "Heavy build-up / moss", "value": 1500},
                    {"text": "Overflowing / plant growth", "value": 2500},
                ],
            },
        ],
        "extras": [
            {"id": "gutterFlush", "label": "Downpipe flush & check", "price": 1500},
            {"id": "gutterGuard", "label": "Gutter guard installation", "price": 2500},
        ],
    },
}


# ──────────────────────────────────────────────────────────────────
# Job Cost Model  (£ — for margin / profitability display)
# ──────────────────────────────────────────────────────────────────
JOB_COSTS = {
    "Lawn Cutting":       {"materials": 1.50, "fuel_litres": 1.5, "equip_wear": 1.50, "waste": 0,     "avg_hours": 1.0},
    "Hedge Trimming":     {"materials": 2.00, "fuel_litres": 0.8, "equip_wear": 1.80, "waste": 5.00,  "avg_hours": 2.5},
    "Lawn Treatment":     {"materials": 12.0, "fuel_litres": 0.3, "equip_wear": 0.50, "waste": 0,     "avg_hours": 1.5},
    "Scarifying":         {"materials": 15.0, "fuel_litres": 2.0, "equip_wear": 3.00, "waste": 3.00,  "avg_hours": 5.0},
    "Garden Clearance":   {"materials": 25.0, "fuel_litres": 2.5, "equip_wear": 2.00, "waste": 35.00, "avg_hours": 6.0},
    "Power Washing":      {"materials": 5.00, "fuel_litres": 3.0, "equip_wear": 1.20, "waste": 0,     "avg_hours": 5.0},
    "Veg Patch Setup":    {"materials": 15.0, "fuel_litres": 1.5, "equip_wear": 1.50, "waste": 5.00,  "avg_hours": 4.0},
    "Weeding Treatment":  {"materials": 3.00, "fuel_litres": 0.3, "equip_wear": 0.30, "waste": 2.00,  "avg_hours": 2.0},
    "Fence Repair":       {"materials": 20.0, "fuel_litres": 0.5, "equip_wear": 2.00, "waste": 10.00, "avg_hours": 3.5},
    "Emergency Tree Work": {"materials": 40.0, "fuel_litres": 4.0, "equip_wear": 8.00, "waste": 40.00, "avg_hours": 5.0},
    "Drain Clearance":    {"materials": 5.00, "fuel_litres": 1.0, "equip_wear": 1.50, "waste": 5.00,  "avg_hours": 2.0},
    "Gutter Cleaning":    {"materials": 2.00, "fuel_litres": 0.5, "equip_wear": 0.80, "waste": 3.00,  "avg_hours": 1.5},
}

# Travel constants (Cornwall)
FUEL_PRICE_PER_LITRE = 1.45
VAN_MPG = 35
LITRES_PER_GALLON = 4.546
COST_PER_MILE = FUEL_PRICE_PER_LITRE * LITRES_PER_GALLON / VAN_MPG  # ~£0.1884

TRAVEL_FREE_MILES = 15
TRAVEL_SURCHARGE_PENCE_PER_MILE = 50   # 50p per extra mile

# Deposit
DEPOSIT_RATE = 0.10   # 10%

# Minimum charge
DEFAULT_MINIMUM_PENCE = 3000   # £30


# ──────────────────────────────────────────────────────────────────
# Helper functions
# ──────────────────────────────────────────────────────────────────

def pence_to_pounds(pence: int) -> float:
    """Convert pence to pounds."""
    return pence / 100.0


def pounds_to_pence(pounds: float) -> int:
    """Convert pounds to pence."""
    return int(round(pounds * 100))


def get_service_keys(active_only: bool = False) -> list[str]:
    """Return ordered list of service keys."""
    keys = []
    for key, svc in SERVICE_CATALOGUE.items():
        if active_only and not svc["active"]:
            continue
        keys.append(key)
    return keys


def get_service_display_names(active_only: bool = False) -> list[str]:
    """Return ordered list of display names."""
    return [SERVICE_CATALOGUE[k]["display_name"] for k in get_service_keys(active_only)]


def key_from_display_name(display_name: str) -> str | None:
    """Look up the catalogue key from a display name."""
    for key, svc in SERVICE_CATALOGUE.items():
        if svc["display_name"].lower() == display_name.lower():
            return key
    return None


def display_name_from_key(key: str) -> str:
    """Look up the display name from a catalogue key."""
    svc = SERVICE_CATALOGUE.get(key)
    return svc["display_name"] if svc else key


def calculate_service_price(
    service_key: str,
    option_selections: dict[str, int] | None = None,
    extra_selections: list[str] | None = None,
) -> dict:
    """
    Calculate the price for a single service based on selected options/extras.

    Args:
        service_key: e.g. 'lawn-cutting'
        option_selections: {option_id: chosen_value_pence}  e.g. {'lawnSize': 4000, 'lawnArea': 1000}
        extra_selections: list of extra IDs that are ticked  e.g. ['edging', 'clippings']

    Returns:
        {
            'base_total_pence': int,        # sum of option values
            'extras_total_pence': int,      # sum of extras
            'multiplier_extras_pence': int, # % extras
            'total_pence': int,
            'total_pounds': float,
            'breakdown': list[dict],        # [{label, pence}]
        }
    """
    svc = SERVICE_CATALOGUE.get(service_key)
    if not svc:
        return {"base_total_pence": 0, "extras_total_pence": 0,
                "multiplier_extras_pence": 0, "total_pence": 0,
                "total_pounds": 0.0, "breakdown": []}

    option_selections = option_selections or {}
    extra_selections = extra_selections or []
    breakdown = []

    # Sum option values
    base_total = 0
    for opt in svc["options"]:
        val = option_selections.get(opt["id"], opt["choices"][0]["value"])
        # Find the choice text for breakdown
        choice_text = opt["label"]
        for ch in opt["choices"]:
            if ch["value"] == val:
                choice_text = ch["text"]
                break
        base_total += val
        if val > 0:
            breakdown.append({"label": choice_text, "pence": val})

    # Sum flat extras
    extras_total = 0
    multiplier_total = 0
    for ext in svc["extras"]:
        is_selected = ext["id"] in extra_selections
        # Auto-include checked-by-default extras unless explicitly excluded
        if ext.get("checked") and ext["id"] not in extra_selections:
            is_selected = True
        if is_selected:
            if ext.get("multiplier"):
                mult_amount = int(base_total * ext["multiplier"])
                multiplier_total += mult_amount
                breakdown.append({"label": ext["label"], "pence": mult_amount})
            else:
                extras_total += ext["price"]
                if ext["price"] > 0:
                    breakdown.append({"label": ext["label"], "pence": ext["price"]})

    total = base_total + extras_total + multiplier_total

    # Enforce minimum
    min_price = svc.get("base_price", DEFAULT_MINIMUM_PENCE)
    if total < min_price:
        total = min_price

    return {
        "base_total_pence": base_total,
        "extras_total_pence": extras_total,
        "multiplier_extras_pence": multiplier_total,
        "total_pence": total,
        "total_pounds": pence_to_pounds(total),
        "breakdown": breakdown,
    }


def calculate_travel_surcharge(distance_miles: float) -> dict:
    """
    Calculate travel surcharge for distance beyond TRAVEL_FREE_MILES.

    Returns:
        {'surcharge_pence': int, 'surcharge_pounds': float, 'extra_miles': float}
    """
    if distance_miles <= TRAVEL_FREE_MILES:
        return {"surcharge_pence": 0, "surcharge_pounds": 0.0, "extra_miles": 0}

    extra = distance_miles - TRAVEL_FREE_MILES
    surcharge = int(extra * TRAVEL_SURCHARGE_PENCE_PER_MILE)
    return {
        "surcharge_pence": surcharge,
        "surcharge_pounds": pence_to_pounds(surcharge),
        "extra_miles": extra,
    }


def calculate_deposit(total_pence: int) -> dict:
    """
    Calculate 10% deposit.

    Returns:
        {'deposit_pence': int, 'deposit_pounds': float, 'balance_pence': int, 'balance_pounds': float}
    """
    dep = int(total_pence * DEPOSIT_RATE)
    bal = total_pence - dep
    return {
        "deposit_pence": dep,
        "deposit_pounds": pence_to_pounds(dep),
        "balance_pence": bal,
        "balance_pounds": pence_to_pounds(bal),
    }


def estimate_job_cost(display_name: str) -> dict | None:
    """
    Return estimated job cost breakdown for margin analysis.

    Returns:
        {'total_cost': float, 'materials': float, 'fuel': float, 'equip_wear': float,
         'waste': float, 'travel': float, 'avg_hours': float}
    """
    cost = JOB_COSTS.get(display_name)
    if not cost:
        return None

    fuel_cost = cost["fuel_litres"] * FUEL_PRICE_PER_LITRE
    travel_cost = TRAVEL_FREE_MILES * COST_PER_MILE  # average trip
    total = (cost["materials"] + fuel_cost + cost["equip_wear"]
             + cost["waste"] + travel_cost)

    return {
        "total_cost": round(total, 2),
        "materials": cost["materials"],
        "fuel": round(fuel_cost, 2),
        "equip_wear": cost["equip_wear"],
        "waste": cost["waste"],
        "travel": round(travel_cost, 2),
        "avg_hours": cost["avg_hours"],
    }


def build_line_item_from_config(
    service_key: str,
    option_selections: dict[str, int],
    extra_selections: list[str],
    qty: int = 1,
) -> dict:
    """
    Build a quote line-item dict ready to add to the items JSON.

    Returns:
        {
            'description': str,   # e.g. "Lawn Cutting — Medium (50–150m²), Front & Back + Edging"
            'qty': int,
            'unit_price': float,  # pounds
            'price': float,       # unit_price * qty
            'total': float,       # same as price
            'service_key': str,
            'options': dict,      # raw option selections
            'extras': list,       # selected extra ids
        }
    """
    svc = SERVICE_CATALOGUE.get(service_key)
    if not svc:
        return {}

    calc = calculate_service_price(service_key, option_selections, extra_selections)

    # Build a descriptive string
    parts = [svc["display_name"]]
    detail_parts = []
    for opt in svc["options"]:
        val = option_selections.get(opt["id"], opt["choices"][0]["value"])
        for ch in opt["choices"]:
            if ch["value"] == val:
                detail_parts.append(ch["text"])
                break
    if detail_parts:
        parts.append(" \u2014 " + ", ".join(detail_parts))

    # Add selected extras to description
    extra_labels = []
    for ext in svc["extras"]:
        if ext["id"] in extra_selections and ext["price"] > 0:
            extra_labels.append(ext["label"])
    if extra_labels:
        parts.append(" + " + ", ".join(extra_labels))

    description = "".join(parts)
    unit_price = calc["total_pounds"]

    return {
        "description": description,
        "qty": qty,
        "unit_price": unit_price,
        "price": round(unit_price * qty, 2),
        "total": round(unit_price * qty, 2),
        "service_key": service_key,
        "options": option_selections,
        "extras": extra_selections,
    }
