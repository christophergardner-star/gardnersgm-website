"""
Configuration loader for GGM Hub.
Reads .env file and exposes settings as module-level constants.
"""

import os
import subprocess
import sys
from pathlib import Path

# ---------------------------------------------------------------------------
# Resolve paths — works whether launched from platform/ or platform/app/
# ---------------------------------------------------------------------------
if getattr(sys, 'frozen', False):
    APP_DIR = Path(sys.executable).parent
else:
    APP_DIR = Path(__file__).resolve().parent

PLATFORM_DIR = APP_DIR.parent
PROJECT_ROOT = PLATFORM_DIR.parent
DATA_DIR = PLATFORM_DIR / "data"
BACKUP_DIR = DATA_DIR / "backups"
DB_PATH = DATA_DIR / "ggm_hub.db"

# Ensure data dirs exist
DATA_DIR.mkdir(parents=True, exist_ok=True)
BACKUP_DIR.mkdir(parents=True, exist_ok=True)

# ---------------------------------------------------------------------------
# Load .env — check platform/.env first, then project root .env
# ---------------------------------------------------------------------------
try:
    from dotenv import load_dotenv
    env_paths = [
        PLATFORM_DIR / ".env",
        PROJECT_ROOT / ".env",
    ]
    for ep in env_paths:
        if ep.exists():
            load_dotenv(ep)
            break
except ImportError:
    pass  # dotenv not installed, rely on system env vars

# ---------------------------------------------------------------------------
# Google Apps Script Webhook
# ---------------------------------------------------------------------------
SHEETS_WEBHOOK = os.getenv(
    "SHEETS_WEBHOOK",
    "https://script.google.com/macros/s/AKfycbxaT1YOoDZtVHP9CztiUutYFqMiOyygDJon5BxCij14CWl91WgdmrYqpbG4KVAlFh5IiQ/exec"
)

# ---------------------------------------------------------------------------
# Telegram
# ---------------------------------------------------------------------------
TG_BOT_TOKEN = os.getenv("TG_BOT_TOKEN", "")
TG_CHAT_ID = os.getenv("TG_CHAT_ID", "")
TG_API_URL = f"https://api.telegram.org/bot{TG_BOT_TOKEN}" if TG_BOT_TOKEN else ""

# ---------------------------------------------------------------------------
# Pexels
# ---------------------------------------------------------------------------
PEXELS_KEY = os.getenv("PEXELS_KEY", "")

# ---------------------------------------------------------------------------
# Stripe
# ---------------------------------------------------------------------------
STRIPE_SECRET_KEY = os.getenv("STRIPE_SECRET_KEY") or os.getenv("STRIPE_KEY", "")

# ---------------------------------------------------------------------------
# Brevo (email delivery)
# ---------------------------------------------------------------------------
BREVO_API_KEY = os.getenv("BREVO_API_KEY", "")
BREVO_SENDER_EMAIL = os.getenv("BREVO_SENDER_EMAIL", "info@gardnersgm.co.uk")
ADMIN_EMAIL = os.getenv("ADMIN_EMAIL", "cgardner37@icloud.com")
ADMIN_NAME = "Chris"

# ---------------------------------------------------------------------------
# Ollama (local AI)
# ---------------------------------------------------------------------------
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "")

# ---------------------------------------------------------------------------
# Sync Settings
# ---------------------------------------------------------------------------
SYNC_INTERVAL_SECONDS = int(os.getenv("SYNC_INTERVAL", "300"))  # 5 minutes
SYNC_TIMEOUT_SECONDS = int(os.getenv("SYNC_TIMEOUT", "30"))

# ---------------------------------------------------------------------------
# Supabase (PostgreSQL — replaces Google Sheets as primary database)
# ---------------------------------------------------------------------------
SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY", "")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "")
USE_SUPABASE = bool(SUPABASE_URL and SUPABASE_SERVICE_KEY)

# ---------------------------------------------------------------------------
# App Metadata
# ---------------------------------------------------------------------------
APP_NAME = "GGM Hub"
APP_TITLE = "GGM Hub — Gardners Ground Maintenance"
APP_VERSION = "4.5.0"
COMPANY_NAME = "Gardners Ground Maintenance"

# ---------------------------------------------------------------------------
# Node identity — determines which services start and which tabs show
# Set GGM_NODE_ID env var, or auto-detect by hostname.
# Values: "pc_hub" | "field_laptop"
# ---------------------------------------------------------------------------
_PC_HOSTNAMES = {"DESKTOP-GGM", "GGM-PC", "GGM-HUB"}  # add your PC's hostname
_hostname = os.environ.get("COMPUTERNAME", "").upper()
NODE_ID = os.getenv("GGM_NODE_ID",
                     "pc_hub" if _hostname in _PC_HOSTNAMES else "field_laptop")
IS_PC = NODE_ID == "pc_hub"
IS_LAPTOP = NODE_ID == "field_laptop"

def _get_git_commit():
    """Get the short git commit hash of HEAD."""
    try:
        r = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=str(PROJECT_ROOT), capture_output=True, text=True, timeout=5,
        )
        return r.stdout.strip() if r.returncode == 0 else ""
    except Exception:
        return ""

GIT_COMMIT = _get_git_commit()

# ---------------------------------------------------------------------------
# Business Constants (from business plan / Code.gs)
# ---------------------------------------------------------------------------
FUEL_PRICE_PER_LITRE = 1.45
VAN_MPG = 35.0
AVG_TRAVEL_MILES = 12.0
TAX_RATE = 0.20
NI_RATE = 0.06
EMERGENCY_FUND_RATE = 0.05
EQUIPMENT_FUND_RATE = 0.05
OPERATING_FUND_RATE = 0.10

# Business rates (from business plan — +12% Feb 2026)
HOURLY_RATE = 28.00                # was £25, +12%
HALF_DAY_RATE = 112.00             # was £100, +12%
FULL_DAY_RATE = 213.00             # was £190, +12%
WEEKEND_SURCHARGE_RATE = 0.15      # +15% for weekend / urgent
EVENING_SURCHARGE_RATE = 0.10      # +10% for after-hours

FUND_ALLOCATION = {
    "Tax Reserve": TAX_RATE,
    "National Insurance": NI_RATE,
    "Emergency Fund": EMERGENCY_FUND_RATE,
    "Equipment & Vehicle": EQUIPMENT_FUND_RATE,
    "Operating Costs": OPERATING_FUND_RATE,
}

# Personal = remainder after all fund allocations
PERSONAL_RATE = 1.0 - sum(FUND_ALLOCATION.values())  # 0.54

# ---------------------------------------------------------------------------
# Service list (matches website)
# ---------------------------------------------------------------------------
SERVICES = [
    "Lawn Cutting",
    "Hedge Trimming",
    "Lawn Treatment",
    "Scarifying",
    "Garden Clearance",
    "Strimming & Brush Cutting",
    "Leaf Clearance",
    "Power Washing",
    "Drain Clearance",
    "Fence Repair",
    "Gutter Cleaning",
    "Weeding",
]

STATUS_OPTIONS = ["Pending", "Confirmed", "In Progress", "Complete", "Cancelled", "No-Show"]
PAID_OPTIONS = ["No", "Yes", "Deposit", "Refunded"]
TYPE_OPTIONS = ["One-Off", "Subscription"]
FREQUENCY_OPTIONS = ["Weekly", "Fortnightly", "Monthly", "One-Off"]
DAY_OPTIONS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]

WASTE_OPTIONS = ["Not Set", "Brown Bin", "GGM Collects", "No Waste"]

INVOICE_STATUS_OPTIONS = ["Unpaid", "Paid", "Overdue", "Void", "Draft"]
QUOTE_STATUS_OPTIONS = ["Draft", "Sent", "Accepted", "Declined", "Expired"]
ENQUIRY_STATUS_OPTIONS = ["New", "Contacted", "Quoted", "Converted", "Closed"]
ENQUIRY_TYPE_OPTIONS = ["General", "Quote Request", "Complaint", "Callback", "Website"]
REPLIED_OPTIONS = ["No", "Yes"]
COST_FIELDS = ["fuel", "insurance", "tools", "vehicle", "phone_cost", "software", "marketing", "waste_disposal", "treatment_products", "consumables", "other"]

# ---------------------------------------------------------------------------
# Service durations (hours) — from booking.js / Code.gs
# ---------------------------------------------------------------------------
SERVICE_DURATIONS = {
    "Lawn Cutting":      1.0,
    "Hedge Trimming":    3.0,
    "Lawn Treatment":    2.0,
    "Scarifying":        8.0,   # full day
    "Garden Clearance":  8.0,   # full day
    "Strimming & Brush Cutting": 2.5,
    "Leaf Clearance":    2.0,
    "Power Washing":     8.0,   # full day
    "Drain Clearance":   2.0,
    "Fence Repair":      4.0,
    "Gutter Cleaning":   2.0,
    "Weeding":           2.0,
}

# ---------------------------------------------------------------------------
# Location & Driving (ported from distance.js)
# ---------------------------------------------------------------------------
BASE_POSTCODE = "PL26 8HN"          # Roche, Cornwall
BASE_LAT = 50.398264
BASE_LNG = -4.829102

# Cornwall driving speed estimates (mph)
SPEED_RURAL = 22        # narrow lanes, single track
SPEED_MODERATE = 28     # B-roads, village roads
SPEED_A_ROAD = 35       # A30, A38, A39
WINDING_FACTOR = 1.35   # Cornwall roads are rarely straight

# Working day
WORK_START_HOUR = 8     # 08:00
WORK_END_HOUR = 17      # 17:00
MAX_JOBS_PER_DAY = 5

# Photos — dedicated SSD storage on E: drive (2.8TB)
# Falls back to platform/data/photos if E: drive is not available
_PHOTO_DRIVE = Path(os.getenv("GGM_PHOTOS_DIR", r"E:\GGM-Photos\jobs"))
if _PHOTO_DRIVE.drive and Path(_PHOTO_DRIVE.drive + "\\").exists():
    PHOTOS_DIR = _PHOTO_DRIVE
else:
    PHOTOS_DIR = DATA_DIR / "photos"
PHOTOS_DIR.mkdir(parents=True, exist_ok=True)

# Photo storage sub-directories (all on E: drive)
PHOTOS_BEFORE_DIR = PHOTOS_DIR.parent / "before" if "GGM-Photos" in str(PHOTOS_DIR) else PHOTOS_DIR / "before"
PHOTOS_AFTER_DIR = PHOTOS_DIR.parent / "after" if "GGM-Photos" in str(PHOTOS_DIR) else PHOTOS_DIR / "after"
PHOTOS_THUMBNAILS_DIR = PHOTOS_DIR.parent / "thumbnails" if "GGM-Photos" in str(PHOTOS_DIR) else PHOTOS_DIR / "thumbnails"
PHOTOS_UPLOADS_DIR = PHOTOS_DIR.parent / "uploads" if "GGM-Photos" in str(PHOTOS_DIR) else PHOTOS_DIR / "uploads"
for _d in [PHOTOS_BEFORE_DIR, PHOTOS_AFTER_DIR, PHOTOS_THUMBNAILS_DIR, PHOTOS_UPLOADS_DIR]:
    _d.mkdir(parents=True, exist_ok=True)

# ---------------------------------------------------------------------------
# Material costs per service (from today.js)
# ---------------------------------------------------------------------------
SERVICE_MATERIALS = {
    "Lawn Cutting":      1.50,
    "Hedge Trimming":    2.00,
    "Lawn Treatment":   12.00,
    "Scarifying":       15.00,
    "Garden Clearance": 25.00,
    "Strimming & Brush Cutting": 2.00,
    "Leaf Clearance":    1.00,
    "Power Washing":     5.00,
    "Drain Clearance":   3.00,
    "Fence Repair":     10.00,
    "Gutter Cleaning":   2.00,
    "Weeding":           3.00,
}

FUEL_RATE_PER_MILE = 0.45  # HMRC-style mileage rate

# ---------------------------------------------------------------------------
# Telegram quick messages
# ---------------------------------------------------------------------------
TELEGRAM_QUICK_MESSAGES = {
    "On My Way":   "🚐 Hi! I'm on my way to you now. Should be with you shortly!",
    "Arrived":     "👋 Hi! I've arrived and I'm getting started now.",
    "Completed":   "✅ All done! The job is complete. Have a great day!",
    "Reminder":    "📅 Just a friendly reminder about your upcoming appointment.",
    "Payment":     "💰 A gentle reminder that payment is now due. Thank you!",
    "Weather":     "🌧️ Due to weather conditions, we may need to reschedule. I'll keep you posted.",
    "Running Late": "⏰ Running a little behind schedule. Apologies for the delay!",
}

# ---------------------------------------------------------------------------
# Complaint management
# ---------------------------------------------------------------------------
COMPLAINT_STATUS_OPTIONS = ["Open", "Investigating", "Resolved", "Closed"]
COMPLAINT_SEVERITY_OPTIONS = ["Minor", "Moderate", "Major", "Critical"]
COMPLAINT_TYPE_OPTIONS = ["Subscriber", "One-Off"]

RESOLUTION_SUBSCRIBER = [
    ("discount-10", "10% Discount"),
    ("discount-15", "15% Discount"),
    ("discount-20", "20% Discount"),
    ("discount-25", "25% Discount"),
    ("discount-50", "50% Discount"),
    ("free-visit",  "Free Visit"),
    ("credit",      "Account Credit"),
    ("apology",     "Official Apology"),
]

RESOLUTION_ONEOFF = [
    ("refund-10",  "10% Refund"),
    ("refund-25",  "25% Refund"),
    ("refund-50",  "50% Refund"),
    ("refund-75",  "75% Refund"),
    ("refund-100", "100% Refund"),
    ("redo",       "Free Return Visit"),
    ("apology",    "Official Apology"),
]

# ---------------------------------------------------------------------------
# Careers
# ---------------------------------------------------------------------------
APPLICATION_STATUS_OPTIONS = ["New", "Reviewed", "Shortlisted", "Interview", "Offered", "Rejected"]
VACANCY_STATUS_OPTIONS = ["Open", "Draft", "Closed"]

# ---------------------------------------------------------------------------
# Shop
# ---------------------------------------------------------------------------
PRODUCT_STATUS_OPTIONS = ["Active", "Draft", "Sold Out"]
ORDER_STATUS_OPTIONS = ["Processing", "Ready", "Shipped", "Delivered", "Cancelled"]

# ---------------------------------------------------------------------------
# Newsletter
# ---------------------------------------------------------------------------
NEWSLETTER_TARGETS = ["All", "Paid", "Free", "Essential", "Standard", "Premium"]
NEWSLETTER_TEMPLATES = ["Seasonal Tips", "Promotion", "Company Update", "Garden Guide"]

# ---------------------------------------------------------------------------
# Agent System
# ---------------------------------------------------------------------------
AGENT_TYPES = {
    "blog_writer": {
        "label": "📝 Blog Writer",
        "description": "Generates garden/landscaping blog posts for your website",
        "icon": "📝",
    },
    "newsletter_writer": {
        "label": "📨 Newsletter Writer",
        "description": "Drafts newsletters with seasonal tips and company news",
        "icon": "📨",
    },
}

AGENT_SCHEDULE_TYPES = ["Daily", "Weekly", "Fortnightly", "Monthly"]

AGENT_BLOG_TOPICS = [
    "Seasonal lawn care tips for Cornwall",
    "Hedge trimming best practices",
    "Garden clearance and waste removal guide",
    "Power washing tips for driveways and patios",
    "How to maintain a healthy lawn year-round",
    "Fence repair and maintenance guide",
    "Gutter cleaning: why it matters",
    "Scarifying your lawn: when and how",
    "Drain clearance and prevention tips",
    "Weeding strategies for a tidy garden",
    "Preparing your garden for winter",
    "Spring garden preparation checklist",
    "Summer lawn care essentials",
    "Autumn garden maintenance guide",
    "Choosing the right garden service",
    "Benefits of a garden maintenance subscription",
]

# ---------------------------------------------------------------------------
# Email Lifecycle Stages
# ---------------------------------------------------------------------------
EMAIL_LIFECYCLE_STAGES = [
    # --- Core journey (enquiry → quote → booking → job → invoice → follow-up) ---
    {"type": "enquiry_received",     "label": "📩 Enquiry Received",       "description": "Auto-reply confirms we received their enquiry",           "color": "blue"},
    {"type": "quote_sent",           "label": "📝 Quote Sent",             "description": "Detailed quote emailed with service breakdown",            "color": "amber"},
    {"type": "quote_accepted",       "label": "🤝 Quote Accepted",         "description": "Confirmation that quote was accepted and job is booked",   "color": "green"},
    {"type": "booking_confirmed",    "label": "✅ Booking Confirmed",       "description": "Confirmation with date, time and what to expect",          "color": "green"},
    {"type": "day_before_reminder",  "label": "📅 Day-Before Reminder",    "description": "Reminder email sent 24h before appointment",               "color": "purple"},
    {"type": "job_complete",         "label": "🏁 Job Complete",            "description": "Thank you email after job finished",                       "color": "green_light"},
    {"type": "aftercare",            "label": "🌱 Aftercare Guide",        "description": "Service-specific tips after job completion",                "color": "green_light"},
    {"type": "invoice_sent",         "label": "💷 Invoice Sent",            "description": "Invoice email with Stripe payment link",                   "color": "amber"},
    {"type": "payment_received",     "label": "💳 Payment Received",       "description": "Payment confirmation and receipt email",                    "color": "green"},
    {"type": "follow_up",           "label": "⭐ Follow-Up",               "description": "Feedback request 3 days after job completion",              "color": "blue"},
    # --- Lifecycle & retention ---
    {"type": "subscription_welcome", "label": "🔄 Subscription Welcome",   "description": "Welcome pack for new recurring-service clients",           "color": "green_accent"},
    {"type": "thank_you",           "label": "💚 Thank You",               "description": "Milestone loyalty thank-you (5th, 10th job etc.)",         "color": "green"},
    {"type": "re_engagement",       "label": "👋 Re-engagement",           "description": "Win-back email for inactive one-off clients (30-90d)",     "color": "amber"},
    {"type": "seasonal_tips",       "label": "🌸 Seasonal Tips",           "description": "Garden tips per season (max once per 60 days)",            "color": "green_light"},
    {"type": "promotional",         "label": "✨ Promotional",              "description": "Service upsell 7-60 days after first job",                 "color": "blue"},
    {"type": "referral",            "label": "🎁 Referral",                "description": "£10-off referral ask 14-90 days after job",                "color": "purple"},
    {"type": "package_upgrade",     "label": "⬆️ Package Upgrade",         "description": "Subscription tier upgrade after 30+ days",                 "color": "green_accent"},
    # --- Cancellation & changes ---
    {"type": "cancellation",        "label": "❌ Cancellation",             "description": "Booking cancellation confirmation",                        "color": "red"},
    {"type": "reschedule",          "label": "📆 Reschedule",              "description": "Booking reschedule confirmation with new date",             "color": "amber"},
]

# Follow-up delay (days after job completion before feedback request)
EMAIL_FOLLOW_UP_DELAY_DAYS = 3
# Loyalty thank-you milestones (number of completed jobs)
EMAIL_LOYALTY_MILESTONES = [5, 10, 20, 50]
# Auto-invoice delay (hours after job completion before auto-creating invoice)
INVOICE_AUTO_DELAY_HOURS = 2
# Aftercare email delay (days after job completion)
AFTERCARE_DELAY_DAYS = 1

EMAIL_TYPE_OPTIONS = [s["type"] for s in EMAIL_LIFECYCLE_STAGES]
EMAIL_TYPE_LABELS = {s["type"]: s["label"] for s in EMAIL_LIFECYCLE_STAGES}

# ---------------------------------------------------------------------------
# Blog Post Management
# ---------------------------------------------------------------------------
BLOG_STATUS_OPTIONS = ["Draft", "Published", "Archived"]
BLOG_CATEGORIES = [
    "Lawn Care", "Hedge Trimming", "Garden Clearance", "Power Washing",
    "Seasonal Guide", "DIY Tips", "Company News", "Customer Stories",
    "Cornwall Living", "Sustainability",
]

# ---------------------------------------------------------------------------
# Social Media Platforms
# ---------------------------------------------------------------------------
SOCIAL_PLATFORMS = [
    {"key": "facebook",  "label": "Facebook",         "icon": "📘", "char_limit": 2000},
    {"key": "instagram", "label": "Instagram",        "icon": "📸", "char_limit": 2200},
    {"key": "google",    "label": "Google Business",  "icon": "🏢", "char_limit": 1500},
    {"key": "x",         "label": "X (Twitter)",      "icon": "🐦", "char_limit": 280},
]

HASHTAG_SETS = {
    "general":  "#gardening #cornwall #gardenersgroundmaintenance #gardencare #cornwalllife",
    "lawn":     "#lawncare #lawn #mowing #healthylawn #greengrass #cornwall",
    "hedge":    "#hedgetrimming #hedges #gardenmaintenance #cornwall",
    "seasonal": "#springgarden #summergarden #autumngarden #wintergarden #cornwall",
    "tips":     "#gardeningtips #gardenhacks #diygarden #cornwall",
}

# ---------------------------------------------------------------------------
# Email Automation Settings
# ---------------------------------------------------------------------------
EMAIL_AUTO_CHECK_INTERVAL = 300  # seconds between automation checks (5 mins)
EMAIL_DAILY_CAP = 150  # max automated emails per day (Brevo: 5000/month ≈ 166/day)
EMAIL_REMINDER_HOURS_BEFORE = 24  # send reminder this many hours before job

# ---------------------------------------------------------------------------
# Growth Milestones (from admin-finance.js)
# ---------------------------------------------------------------------------
GROWTH_MILESTONES = [
    {"id": "tools-basic",  "label": "Buy Basic Tools",               "revenue": 0,     "monthly": 0,     "cost": 1500,  "icon": "🔧"},
    {"id": "insurance",    "label": "Get Public Liability Insurance", "revenue": 500,   "monthly": 200,   "cost": 1500,  "icon": "🛡️"},
    {"id": "van-purchase", "label": "Buy/Upgrade Van",               "revenue": 8000,  "monthly": 1500,  "cost": 8000,  "icon": "🚐"},
    {"id": "tools-pro",    "label": "Buy Professional Tools",        "revenue": 15000, "monthly": 2500,  "cost": 3000,  "icon": "⚡"},
    {"id": "trailer",      "label": "Buy Equipment Trailer",         "revenue": 20000, "monthly": 3000,  "cost": 2500,  "icon": "🚛"},
    {"id": "hire-first",   "label": "Hire First Employee",           "revenue": 30000, "monthly": 4000,  "cost": 18000, "icon": "👷"},
    {"id": "ride-on",      "label": "Buy Ride-On Mower",             "revenue": 40000, "monthly": 5000,  "cost": 5000,  "icon": "🚜"},
    {"id": "second-van",   "label": "Buy Second Van",                "revenue": 50000, "monthly": 6000,  "cost": 10000, "icon": "🚐"},
    {"id": "hire-second",  "label": "Hire Second Employee",          "revenue": 60000, "monthly": 7000,  "cost": 22000, "icon": "👷"},
    {"id": "premises",     "label": "Rent Workshop/Storage",         "revenue": 80000, "monthly": 8000,  "cost": 6000,  "icon": "🏗️"},
    {"id": "vat-register", "label": "Register for VAT",              "revenue": 85000, "monthly": 7500,  "cost": 0,     "icon": "📋"},
    {"id": "software",     "label": "Invest in Business Software",   "revenue": 10000, "monthly": 1500,  "cost": 500,   "icon": "💻"},
]
