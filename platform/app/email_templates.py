"""
email_templates.py — Rich HTML email template builder for GGM Hub.

Generates branded, service-specific email templates for every lifecycle stage.
Uses service_email_content.py for tips, aftercare, and upsell data.
All templates follow GGM brand guidelines: green (#2d6a4f), warm/professional tone,
British English, Cornwall references.
"""

from datetime import datetime
from . import config
from .service_email_content import (
    get_preparation_tips,
    get_aftercare_tips,
    get_upsell_suggestions,
    get_service_display_name,
    format_tips_html,
    format_upsell_html,
)


# ──────────────────────────────────────────────────────────────────
# Colour constants
# ──────────────────────────────────────────────────────────────────
GREEN = "#2d6a4f"
GREEN_LIGHT = "#52b788"
AMBER = "#f39c12"
RED = "#e74c3c"
BG_LIGHT = "#f0faf4"


# ──────────────────────────────────────────────────────────────────
# CTA Button helper
# ──────────────────────────────────────────────────────────────────
def _cta_button(text: str, url: str, colour: str = GREEN) -> str:
    return f"""
    <p style="text-align:center; margin:24px 0;">
        <a href="{url}" style="background-color:{colour}; color:#ffffff;
           padding:12px 32px; text-decoration:none; border-radius:6px;
           font-size:15px; font-weight:bold; display:inline-block;">
            {text}
        </a>
    </p>"""


def _info_box(content: str, border_colour: str = GREEN) -> str:
    return f"""
    <div style="background:{BG_LIGHT}; border-left:4px solid {border_colour};
                padding:16px 20px; margin:16px 0; border-radius:4px;">
        {content}
    </div>"""


def _section_heading(text: str) -> str:
    return f'<h2 style="color:{GREEN}; font-size:18px; margin:24px 0 8px; border-bottom:2px solid {GREEN_LIGHT}; padding-bottom:6px;">{text}</h2>'


# ══════════════════════════════════════════════════════════════════
# Template Generators
# ══════════════════════════════════════════════════════════════════

def build_enquiry_received(name: str, service: str = "", message: str = "") -> tuple[str, str]:
    """Generate enquiry acknowledgement email. Returns (subject, body_html)."""
    service_name = get_service_display_name(service) if service else "your enquiry"
    subject = f"Thanks for getting in touch, {name}!"
    
    body = f"""
    <p>Hi {name},</p>
    <p>Thanks for contacting Gardners Ground Maintenance! We've received your enquiry
    {f'about <strong>{service_name}</strong> ' if service else ''}and Chris will get back to you
    within 24 hours with a personalised quote.</p>
    """
    
    if message:
        body += _info_box(f'<strong>Your message:</strong><br><em>"{message}"</em>')
    
    body += f"""
    <p>In the meantime, here's what you can expect:</p>
    {format_tips_html([
        "We'll review your requirements and put together a detailed quote",
        "If we need any more details, we'll be in touch",
        "Quotes are usually sent within 24 hours",
        "No obligation — take your time to decide",
    ])}
    
    <p>You can also check out our <a href="https://www.gardnersgm.co.uk/services.html" style="color:{GREEN};">full range of services</a>.</p>
    
    <p>Warm regards,<br><strong>Chris Gardner</strong><br>
    Gardners Ground Maintenance</p>
    """
    return subject, body


def build_quote_sent(name: str, quote_number: str, service: str,
                     total: float, valid_until: str = "",
                     items: str = "[]") -> tuple[str, str]:
    """Generate quote sent email. Returns (subject, body_html)."""
    service_name = get_service_display_name(service)
    subject = f"Your Quote from Gardners GM — {quote_number}"
    
    body = f"""
    <p>Hi {name},</p>
    <p>Thanks for your interest in our {service_name} service! I've put together a
    quote for you below.</p>
    
    {_section_heading(f'Quote {quote_number}')}
    
    {_info_box(f'''
        <strong>Service:</strong> {service_name}<br>
        <strong>Total:</strong> &pound;{total:.2f}<br>
        {f'<strong>Valid until:</strong> {valid_until}' if valid_until else ''}
    ''')}
    
    <p>To view the full quote breakdown and accept it, click below:</p>
    
    {_cta_button('View &amp; Accept Quote', f'https://www.gardnersgm.co.uk/quote-response.html?ref={quote_number}')}
    
    <p>If you have any questions about this quote, just reply to this email
    or give us a call.</p>
    
    <p>Kind regards,<br><strong>Chris Gardner</strong><br>
    Gardners Ground Maintenance</p>
    """
    return subject, body


def build_quote_accepted(name: str, quote_number: str, service: str,
                         job_date: str = "", job_time: str = "") -> tuple[str, str]:
    """Generate quote acceptance confirmation email. Returns (subject, body_html)."""
    service_name = get_service_display_name(service)
    subject = f"Quote Accepted — We're Booked In, {name}!"
    
    prep = get_preparation_tips(service)
    
    body = f"""
    <p>Hi {name},</p>
    <p>Brilliant news! Your quote <strong>{quote_number}</strong> for
    <strong>{service_name}</strong> has been accepted and we've booked you in.</p>
    """
    
    if job_date or job_time:
        date_info = ""
        if job_date:
            date_info += f"<strong>Date:</strong> {job_date}<br>"
        if job_time:
            date_info += f"<strong>Time:</strong> {job_time}<br>"
        date_info += f"<strong>Service:</strong> {service_name}"
        body += _info_box(date_info)
    
    body += """
    <p>You'll receive a reminder email the day before your appointment with
    everything you need to know.</p>
    """
    
    if prep:
        body += _section_heading(prep['title'])
        body += format_tips_html(prep['tips'])
        if prep.get('duration'):
            body += f'<p style="color:#636e72; font-size:13px;"><em>Estimated duration: {prep["duration"]}</em></p>'
    
    body += f"""
    <p>Need to make any changes? You can manage your booking here:</p>
    {_cta_button('Manage Booking', 'https://www.gardnersgm.co.uk/my-account.html')}
    
    <p>Looking forward to it!<br><strong>Chris Gardner</strong><br>
    Gardners Ground Maintenance</p>
    """
    return subject, body


def build_booking_confirmed(name: str, service: str, job_date: str,
                            job_time: str = "", postcode: str = "",
                            address: str = "") -> tuple[str, str]:
    """Generate booking confirmation email. Returns (subject, body_html)."""
    service_name = get_service_display_name(service)
    subject = f"Booking Confirmed — {service_name} on {job_date}"
    
    prep = get_preparation_tips(service)
    
    location_info = ""
    if address:
        location_info = f"<strong>Location:</strong> {address}<br>"
    elif postcode:
        location_info = f"<strong>Area:</strong> {postcode}<br>"
    
    body = f"""
    <p>Hi {name},</p>
    <p>Great news — your booking is confirmed! Here are the details:</p>
    
    {_info_box(f'''
        <strong>Service:</strong> {service_name}<br>
        <strong>Date:</strong> {job_date}<br>
        {f'<strong>Time:</strong> {job_time}<br>' if job_time else ''}
        {location_info}
    ''')}
    """
    
    if prep:
        body += _section_heading(prep['title'])
        body += format_tips_html(prep['tips'])
        if prep.get('duration'):
            body += f'<p style="color:#636e72; font-size:13px;"><em>Estimated duration: {prep["duration"]}</em></p>'
    
    body += f"""
    {_section_heading('What Happens Next')}
    {format_tips_html([
        "You'll receive a reminder email the day before",
        "Chris will arrive at the scheduled time — he'll give you a call if running late",
        "After the job, you'll get a thank-you email and aftercare tips",
        "An invoice will follow with easy online payment options",
    ])}
    
    <p>Need to change anything? Use the link below to manage your booking:</p>
    {_cta_button('Manage Booking', 'https://www.gardnersgm.co.uk/my-account.html')}
    
    <p>See you soon!<br><strong>Chris Gardner</strong><br>
    Gardners Ground Maintenance</p>
    """
    return subject, body


def build_day_before_reminder(name: str, service: str, job_date: str,
                              job_time: str = "") -> tuple[str, str]:
    """Generate day-before reminder email. Returns (subject, body_html)."""
    service_name = get_service_display_name(service)
    subject = f"Reminder: {service_name} Tomorrow"
    
    prep = get_preparation_tips(service)
    
    body = f"""
    <p>Hi {name},</p>
    <p>Just a friendly reminder that your <strong>{service_name}</strong>
    appointment is tomorrow, <strong>{job_date}</strong>{f' at <strong>{job_time}</strong>' if job_time else ''}.</p>
    """
    
    if prep:
        body += _section_heading("Quick Preparation Checklist")
        body += format_tips_html(prep['tips'])
    
    body += f"""
    {_info_box('''
        <strong>Please ensure:</strong><br>
        &#8226; Access to the garden is available (side gate unlocked)<br>
        &#8226; Any vehicles are moved from the work area<br>
        &#8226; Pets are kept safely indoors during the visit
    ''', AMBER)}
    
    <p>Need to reschedule? No problem — just reply to this email or
    <a href="https://www.gardnersgm.co.uk/my-account.html" style="color:{GREEN};">
    manage your booking online</a>.</p>
    
    <p>See you tomorrow!<br><strong>Chris Gardner</strong><br>
    Gardners Ground Maintenance</p>
    """
    return subject, body


def build_job_complete(name: str, service: str, job_date: str) -> tuple[str, str]:
    """Generate job completion email. Returns (subject, body_html)."""
    service_name = get_service_display_name(service)
    subject = f"Job Complete — {service_name} Done!"
    
    body = f"""
    <p>Hi {name},</p>
    <p>Just to let you know that your <strong>{service_name}</strong> has been completed today.
    I hope you're happy with the results!</p>
    
    {_info_box(f'''
        <strong>Service:</strong> {service_name}<br>
        <strong>Date:</strong> {job_date}<br>
        <strong>Status:</strong> <span style="color:{GREEN};">&#10003; Complete</span>
    ''')}
    
    <p>Here's what happens next:</p>
    {format_tips_html([
        "You'll receive aftercare tips for your service tomorrow",
        "An invoice will follow shortly with easy payment options",
        "We'd love your feedback — a review link will be in your follow-up email",
    ])}
    
    <p>If you notice anything you'd like adjusted, please don't hesitate to get
    in touch — we want you to be 100% happy.</p>
    
    {_cta_button('Leave a Review', 'https://g.page/gardnersgm/review')}
    
    <p>Thanks for choosing GGM!<br><strong>Chris Gardner</strong><br>
    Gardners Ground Maintenance</p>
    """
    return subject, body


def build_aftercare(name: str, service: str) -> tuple[str, str]:
    """Generate aftercare tips email. Returns (subject, body_html)."""
    service_name = get_service_display_name(service)
    subject = f"Aftercare Tips for Your {service_name}"
    
    aftercare = get_aftercare_tips(service)
    upsell = get_upsell_suggestions(service)
    
    body = f"""
    <p>Hi {name},</p>
    <p>Now that your <strong>{service_name}</strong> is complete, here are some
    tips to help you get the most from the work we've done.</p>
    """
    
    if aftercare:
        body += _section_heading(aftercare['title'])
        body += format_tips_html(aftercare['tips'])
        if aftercare.get('next_service'):
            body += f'<p style="color:{GREEN}; font-style:italic; margin-top:12px;">{aftercare["next_service"]}</p>'
    else:
        body += f"""
        {_section_heading('General Garden Care Tips')}
        {format_tips_html([
            "Water your garden in the morning for best absorption",
            "Keep on top of weeding to prevent competition for nutrients",
            "Regular maintenance prevents small issues becoming big ones",
        ])}
        """
    
    if upsell:
        body += format_upsell_html(upsell)
    
    body += f"""
    <p>Questions about caring for your garden? Just reply to this email.</p>
    
    <p>Happy gardening!<br><strong>Chris Gardner</strong><br>
    Gardners Ground Maintenance</p>
    """
    return subject, body


def build_invoice_sent(name: str, invoice_number: str, amount: float,
                       due_date: str = "", payment_url: str = "",
                       items_json: str = "[]") -> tuple[str, str]:
    """Generate invoice email. Returns (subject, body_html)."""
    subject = f"Invoice {invoice_number} from Gardners GM"
    
    import json
    try:
        items = json.loads(items_json) if isinstance(items_json, str) else items_json
    except (json.JSONDecodeError, TypeError):
        items = []
    
    # Build line items table
    items_html = ""
    if items and isinstance(items, list) and len(items) > 0:
        rows = ""
        for item in items:
            if isinstance(item, dict):
                desc = item.get("description", item.get("service", "Service"))
                qty = item.get("quantity", item.get("qty", 1))
                price = item.get("price", item.get("amount", 0))
                rows += f"""
                <tr>
                    <td style="padding:8px 12px; border-bottom:1px solid #e9ecef;">{desc}</td>
                    <td style="padding:8px 12px; border-bottom:1px solid #e9ecef; text-align:center;">{qty}</td>
                    <td style="padding:8px 12px; border-bottom:1px solid #e9ecef; text-align:right;">&pound;{float(price):.2f}</td>
                </tr>"""
        
        items_html = f"""
        <table style="width:100%; border-collapse:collapse; margin:16px 0;">
            <tr style="background:{BG_LIGHT};">
                <th style="padding:8px 12px; text-align:left; color:{GREEN};">Description</th>
                <th style="padding:8px 12px; text-align:center; color:{GREEN};">Qty</th>
                <th style="padding:8px 12px; text-align:right; color:{GREEN};">Amount</th>
            </tr>
            {rows}
            <tr style="background:{BG_LIGHT}; font-weight:bold;">
                <td colspan="2" style="padding:10px 12px; text-align:right; color:{GREEN};">Total:</td>
                <td style="padding:10px 12px; text-align:right; color:{GREEN};">&pound;{amount:.2f}</td>
            </tr>
        </table>"""
    
    body = f"""
    <p>Hi {name},</p>
    <p>Please find your invoice below. Thank you for choosing Gardners Ground Maintenance!</p>
    
    {_section_heading(f'Invoice {invoice_number}')}
    
    {_info_box(f'''
        <strong>Invoice:</strong> {invoice_number}<br>
        <strong>Amount Due:</strong> &pound;{amount:.2f}<br>
        {f'<strong>Due Date:</strong> {due_date}' if due_date else ''}
    ''')}
    
    {items_html}
    
    {_section_heading('Payment Options')}
    """
    
    if payment_url:
        body += f"""
        <p><strong>Option 1 — Pay Online (card/Apple Pay/Google Pay):</strong></p>
        {_cta_button('Pay Now — Secure Online Payment', payment_url)}
        """
    
    body += f"""
    <p><strong>{'Option 2' if payment_url else 'Option 1'} — Bank Transfer:</strong></p>
    {_info_box('''
        <strong>Account Name:</strong> Gardners Ground Maintenance<br>
        <strong>Sort Code:</strong> 09-01-29<br>
        <strong>Account No:</strong> 27269873<br>
        <strong>Reference:</strong> ''' + invoice_number + '''
    ''')}
    
    <p>If you have any questions about this invoice, just reply to this email.</p>
    
    <p>Thanks,<br><strong>Chris Gardner</strong><br>
    Gardners Ground Maintenance</p>
    """
    return subject, body


def build_payment_received(name: str, invoice_number: str,
                           amount: float, payment_method: str = "") -> tuple[str, str]:
    """Generate payment receipt email. Returns (subject, body_html)."""
    subject = f"Payment Received — Thank You, {name}!"
    
    body = f"""
    <p>Hi {name},</p>
    <p>We've received your payment — thank you!</p>
    
    {_info_box(f'''
        <strong>Invoice:</strong> {invoice_number}<br>
        <strong>Amount Paid:</strong> &pound;{amount:.2f}<br>
        {f'<strong>Method:</strong> {payment_method}<br>' if payment_method else ''}
        <strong>Date:</strong> {datetime.now().strftime("%d %B %Y")}<br>
        <strong>Status:</strong> <span style="color:{GREEN};">&#10003; Paid in Full</span>
    ''')}
    
    <p>This email serves as your receipt. If you need a formal invoice for your
    records, you can view it in your account:</p>
    
    {_cta_button('View My Account', 'https://www.gardnersgm.co.uk/my-account.html')}
    
    <p>It was a pleasure working with you. We'd love to help again in the future!</p>
    
    {_cta_button('Book Another Service', 'https://www.gardnersgm.co.uk/booking.html', GREEN_LIGHT)}
    
    <p>Thanks again,<br><strong>Chris Gardner</strong><br>
    Gardners Ground Maintenance</p>
    """
    return subject, body


def build_follow_up(name: str, service: str, job_date: str) -> tuple[str, str]:
    """Generate follow-up / review request email. Returns (subject, body_html)."""
    service_name = get_service_display_name(service)
    subject = f"How Was Your {service_name}?"
    
    body = f"""
    <p>Hi {name},</p>
    <p>It's been a few days since your <strong>{service_name}</strong> on {job_date},
    and I wanted to check in — how's everything looking?</p>
    
    <p>Your feedback helps us improve and helps other customers in Cornwall find
    quality garden care. If you have a moment, we'd really appreciate a quick review:</p>
    
    {_cta_button('Leave a Google Review', 'https://g.page/gardnersgm/review')}
    
    <p>Even a couple of sentences makes a huge difference!</p>
    
    {_info_box('''
        <strong>Not happy with anything?</strong> Please let us know directly —
        reply to this email and we'll put it right. Your satisfaction is our priority.
    ''', AMBER)}
    
    <p>Thanks for choosing GGM, {name}. We hope to see you again soon!</p>
    
    {_cta_button('Book Your Next Service', 'https://www.gardnersgm.co.uk/booking.html', GREEN_LIGHT)}
    
    <p>Best wishes,<br><strong>Chris Gardner</strong><br>
    Gardners Ground Maintenance</p>
    """
    return subject, body


def build_cancellation(name: str, service: str, job_date: str,
                       reason: str = "") -> tuple[str, str]:
    """Generate cancellation confirmation email. Returns (subject, body_html)."""
    service_name = get_service_display_name(service)
    subject = f"Booking Cancelled — {service_name} on {job_date}"
    
    body = f"""
    <p>Hi {name},</p>
    <p>This is to confirm that your <strong>{service_name}</strong> booking on
    <strong>{job_date}</strong> has been cancelled.</p>
    
    {_info_box(f'''
        <strong>Service:</strong> {service_name}<br>
        <strong>Original Date:</strong> {job_date}<br>
        <strong>Status:</strong> <span style="color:{RED};">Cancelled</span>
        {f'<br><strong>Reason:</strong> {reason}' if reason else ''}
    ''')}
    
    <p>If this was a mistake or you'd like to rebook, we'd be happy to help:</p>
    
    {_cta_button('Rebook a Service', 'https://www.gardnersgm.co.uk/booking.html')}
    
    <p>We hope to work with you again in the future. No hard feelings!</p>
    
    <p>Best wishes,<br><strong>Chris Gardner</strong><br>
    Gardners Ground Maintenance</p>
    """
    return subject, body


def build_reschedule(name: str, service: str, old_date: str,
                     new_date: str, new_time: str = "",
                     reason: str = "") -> tuple[str, str]:
    """Generate reschedule confirmation email. Returns (subject, body_html)."""
    service_name = get_service_display_name(service)
    subject = f"Booking Rescheduled — {service_name} Now on {new_date}"
    
    prep = get_preparation_tips(service)
    
    body = f"""
    <p>Hi {name},</p>
    <p>Your <strong>{service_name}</strong> booking has been rescheduled.
    Here are your updated details:</p>
    
    {_info_box(f'''
        <strong>Service:</strong> {service_name}<br>
        <span style="color:{RED}; text-decoration:line-through;">Original Date: {old_date}</span><br>
        <strong>New Date:</strong> <span style="color:{GREEN};">{new_date}</span><br>
        {f'<strong>Time:</strong> {new_time}<br>' if new_time else ''}
        {f'<strong>Reason:</strong> {reason}' if reason else ''}
    ''')}
    
    <p>You'll receive a reminder the day before your new appointment.</p>
    """
    
    if prep:
        body += _section_heading("Preparation Reminder")
        body += format_tips_html(prep['tips'][:3])  # Just top 3 for brevity
    
    body += f"""
    <p>Need to make further changes? Just reply to this email or manage online:</p>
    {_cta_button('Manage Booking', 'https://www.gardnersgm.co.uk/my-account.html')}
    
    <p>See you on {new_date}!<br><strong>Chris Gardner</strong><br>
    Gardners Ground Maintenance</p>
    """
    return subject, body


def build_subscription_welcome(name: str, service: str,
                               frequency: str) -> tuple[str, str]:
    """Generate subscription welcome email. Returns (subject, body_html)."""
    service_name = get_service_display_name(service)
    subject = f"Welcome to Your {service_name} Subscription!"
    
    body = f"""
    <p>Hi {name},</p>
    <p>Welcome aboard! You're now set up for regular <strong>{service_name}</strong>
    on a <strong>{frequency}</strong> basis.</p>
    
    {_section_heading('What You Get')}
    {format_tips_html([
        f"Regular {service_name.lower()} at your preferred frequency",
        "Priority booking — you're always scheduled first",
        "Consistent pricing with no surprise increases",
        "Aftercare tips after every visit",
        "Easy online account management",
    ])}
    
    {_info_box(f'''
        <strong>Service:</strong> {service_name}<br>
        <strong>Frequency:</strong> {frequency}<br>
        <strong>Account:</strong> <a href="https://www.gardnersgm.co.uk/my-account.html" style="color:{GREEN};">Manage online</a>
    ''')}
    
    <p>If you ever need to skip a visit, reschedule, or adjust your plan, just
    let us know — we're flexible.</p>
    
    {_cta_button('View My Account', 'https://www.gardnersgm.co.uk/my-account.html')}
    
    <p>Thanks for subscribing, {name}!<br><strong>Chris Gardner</strong><br>
    Gardners Ground Maintenance</p>
    """
    return subject, body


def build_loyalty_thank_you(name: str, milestone: int) -> tuple[str, str]:
    """Generate loyalty milestone email. Returns (subject, body_html)."""
    ordinal = _ordinal(milestone)
    subject = f"Thank You for Your {ordinal} Job, {name}!"
    
    # Milestone-specific rewards
    rewards = {
        5:  "10% off your next booking",
        10: "15% off your next booking",
        20: "a free add-on service of your choice",
        50: "a complimentary garden health check",
    }
    reward = rewards.get(milestone, "a special thank-you discount")
    
    body = f"""
    <p>Hi {name},</p>
    <p>Wow — that's <strong>{milestone} jobs</strong> with Gardners Ground Maintenance!
    You're one of our most valued customers and we really appreciate your loyalty.</p>
    
    {_info_box(f'''
        <span style="font-size:24px;">🎉</span><br>
        <strong>As a thank you, you'll receive {reward}!</strong><br>
        Just mention this email when you book your next service.
    ''')}
    
    <p>Customers like you are the reason we love what we do. Thank you for trusting
    us with your garden, {name}.</p>
    
    {_cta_button('Book Your Next Service', 'https://www.gardnersgm.co.uk/booking.html', GREEN_LIGHT)}
    
    <p>With gratitude,<br><strong>Chris Gardner</strong><br>
    Gardners Ground Maintenance</p>
    """
    return subject, body


def build_reengagement(name: str, service: str, last_date: str) -> tuple[str, str]:
    """Generate re-engagement email. Returns (subject, body_html)."""
    service_name = get_service_display_name(service)
    subject = f"We Miss You, {name}! Time for Some Garden TLC?"
    
    body = f"""
    <p>Hi {name},</p>
    <p>It's been a little while since your last <strong>{service_name}</strong>
    on {last_date}, and we just wanted to check in.</p>
    
    <p>Gardens don't wait, and Cornwall's weather means things can get overgrown
    quickly! If your garden could use some attention, we'd love to help again.</p>
    
    {_info_box('''
        <span style="font-size:18px;">🌿</span>
        <strong>Welcome Back Offer:</strong> Book within 7 days and receive
        <strong>10% off</strong> your next service. Just mention this email!
    ''')}
    
    {_cta_button('Book a Service', 'https://www.gardnersgm.co.uk/booking.html')}
    
    <p>Or if you'd prefer regular maintenance so things never get out of hand,
    ask about our subscription plans — they're great value.</p>
    
    <p>Hope to hear from you!<br><strong>Chris Gardner</strong><br>
    Gardners Ground Maintenance</p>
    """
    return subject, body


def build_seasonal_tips(name: str, season: str, tips: list[str]) -> tuple[str, str]:
    """Generate seasonal tips email. Returns (subject, body_html)."""
    season_emojis = {"spring": "🌸", "summer": "☀️", "autumn": "🍂", "winter": "❄️"}
    emoji = season_emojis.get(season.lower(), "🌿")
    subject = f"{emoji} {season.title()} Garden Tips from Gardners GM"
    
    body = f"""
    <p>Hi {name},</p>
    <p>{season.title()} is here in Cornwall, and there's plenty to do in the garden!
    Here are our top tips for this time of year:</p>
    
    {_section_heading(f'{emoji} {season.title()} Garden Tips')}
    {format_tips_html(tips)}
    
    <p>Need a hand with any of these? We offer a full range of garden services
    to keep your outdoor space looking its best all year round.</p>
    
    {_cta_button('View Our Services', 'https://www.gardnersgm.co.uk/services.html')}
    
    <p>Happy gardening!<br><strong>Chris Gardner</strong><br>
    Gardners Ground Maintenance</p>
    """
    return subject, body


def build_promotional(name: str, service: str) -> tuple[str, str]:
    """Generate promotional / upsell email. Returns (subject, body_html)."""
    service_name = get_service_display_name(service)
    upsell = get_upsell_suggestions(service)
    
    subject = f"Complete Your Garden Care, {name}"
    
    body = f"""
    <p>Hi {name},</p>
    <p>We hope you enjoyed your recent <strong>{service_name}</strong> with us!
    Did you know we offer other services that pair perfectly with it?</p>
    """
    
    if upsell:
        body += format_upsell_html(upsell)
    else:
        body += f"""
        <p>Check out our full range of professional garden services — from lawn care
        to garden clearance, we've got you covered.</p>
        {_cta_button('View All Services', 'https://www.gardnersgm.co.uk/services.html')}
        """
    
    body += f"""
    <p>As a valued customer, you'll always get our best rates. Just get in touch
    or book online!</p>
    
    <p>Best wishes,<br><strong>Chris Gardner</strong><br>
    Gardners Ground Maintenance</p>
    """
    return subject, body


def build_referral(name: str) -> tuple[str, str]:
    """Generate referral request email. Returns (subject, body_html)."""
    subject = f"Know Someone Who Needs a Gardener, {name}?"
    
    body = f"""
    <p>Hi {name},</p>
    <p>Thanks again for choosing Gardners Ground Maintenance. We love working in
    Cornwall and growing through word of mouth!</p>
    
    {_info_box('''
        <span style="font-size:24px;">🎁</span><br>
        <strong>Refer a friend and you both get &pound;10 off!</strong><br>
        Just ask your friend to mention your name when they book.
    ''')}
    
    <p>Whether it's a neighbour, family member, or colleague — if they need
    garden help in Cornwall, we'd love to hear from them.</p>
    
    {_cta_button('Share Our Website', 'https://www.gardnersgm.co.uk')}
    
    <p>Thanks for spreading the word!<br><strong>Chris Gardner</strong><br>
    Gardners Ground Maintenance</p>
    """
    return subject, body


def build_package_upgrade(name: str, current_service: str,
                          current_frequency: str) -> tuple[str, str]:
    """Generate package upgrade email. Returns (subject, body_html)."""
    service_name = get_service_display_name(current_service)
    subject = f"Upgrade Your {service_name} Plan, {name}"
    
    body = f"""
    <p>Hi {name},</p>
    <p>You've been enjoying your <strong>{current_frequency} {service_name}</strong>
    plan for a while now — great choice!</p>
    
    <p>Did you know you could save even more with a bundled package? Many of our
    customers combine services for better value and a more complete garden care
    routine.</p>
    
    {_section_heading('Popular Bundles')}
    
    {_info_box('''
        <strong>🌿 Lawn & Edges Bundle</strong><br>
        Lawn cutting + strimming — save 10% vs booking separately
    ''')}
    
    {_info_box('''
        <strong>🏡 Full Garden Care</strong><br>
        Lawn cutting + hedge trimming + seasonal clearance — save 15%
    ''')}
    
    {_info_box('''
        <strong>✨ Premium Package</strong><br>
        All services at priority scheduling with quarterly treatments — save 20%
    ''')}
    
    <p>Interested? Just reply to this email or give us a call to discuss the
    best option for your garden.</p>
    
    {_cta_button('Get in Touch', 'https://www.gardnersgm.co.uk/contact.html')}
    
    <p>Best wishes,<br><strong>Chris Gardner</strong><br>
    Gardners Ground Maintenance</p>
    """
    return subject, body


# ──────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────

def _ordinal(n: int) -> str:
    """Convert integer to ordinal string (1st, 2nd, 3rd, etc.)."""
    if 11 <= (n % 100) <= 13:
        suffix = "th"
    else:
        suffix = {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")
    return f"{n}{suffix}"
