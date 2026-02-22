"""
Email Automation Engine for GGM Hub.
Full 19-stage lifecycle: enquiry, quote, quote-accepted, booking, reminder,
completion, aftercare, invoice, payment-received, follow-up,
subscription welcome, loyalty thank-you, re-engagement, seasonal tips,
promotional, referral, package upgrade, cancellation, reschedule.
Hub owns ALL emails — GAS is transport-only.
Routes all emails through EmailProvider (Brevo primary, GAS fallback).
"""

import json
import logging
import threading
import time
from datetime import datetime, date, timedelta

from . import config
from . import email_templates as tpl
from .service_email_content import (
    get_aftercare_tips as _get_aftercare,
    get_upsell_suggestions as _get_upsell,
    get_service_display_name,
    _normalise_service_key,
)

log = logging.getLogger("ggm.email_auto")


# ──────────────────────────────────────────────────────────────────
# Seasonal tips (still used by _send_seasonal_tips for tip data)
# Service-specific aftercare + upsell content moved to
# service_email_content.py — templates in email_templates.py
# ──────────────────────────────────────────────────────────────────

SEASONAL_TIPS = {
    "spring": {
        "icon": "\U0001f338",
        "title": "Spring Garden Guide",
        "tips": [
            "Now\u2019s the time to start regular mowing \u2014 set your mower higher for the first cuts.",
            "Apply a spring lawn feed to kick-start growth after winter.",
            "Edge your borders for a sharp, professional look.",
            "Prune any winter-damaged branches from shrubs before new growth.",
        ],
    },
    "summer": {
        "icon": "\u2600\ufe0f",
        "title": "Summer Garden Guide",
        "tips": [
            "Water lawns deeply but less frequently \u2014 early morning is best.",
            "Raise mowing height in hot weather to reduce stress on grass.",
            "Deadhead flowers to encourage more blooms throughout the season.",
            "Keep on top of weeds \u2014 they compete for water in dry spells.",
        ],
    },
    "autumn": {
        "icon": "\U0001f342",
        "title": "Autumn Garden Prep",
        "tips": [
            "Now is the best time for scarifying and overseeding your lawn.",
            "Apply an autumn lawn feed (high potassium) to strengthen roots for winter.",
            "Clear fallen leaves regularly to prevent damage to your lawn.",
            "Plant spring bulbs now for a colourful display next year.",
        ],
    },
    "winter": {
        "icon": "\u2744\ufe0f",
        "title": "Winter Garden Care",
        "tips": [
            "Avoid walking on frosty or waterlogged lawns \u2014 it damages grass.",
            "This is a good time to plan any major garden projects for spring.",
            "Check fences and structures for storm damage.",
            "Keep bird feeders topped up \u2014 they help with pest control in spring.",
        ],
    },
}


def _get_current_season() -> str:
    """Return current season based on month."""
    month = datetime.now().month
    if month in (3, 4, 5):
        return "spring"
    elif month in (6, 7, 8):
        return "summer"
    elif month in (9, 10, 11):
        return "autumn"
    return "winter"


class EmailAutomationEngine:
    """
    Background engine that automatically triggers all lifecycle emails.

    Stages (19 total):
     1. Enquiry Received     — auto-reply on new enquiry
     2. Quote Sent           — emailed when quote is created/sent
     3. Quote Accepted       — confirmation when customer accepts quote
     4. Booking Confirmed    — sent when a booking is confirmed
     5. Day-Before Reminder  — 24h reminder (5-7pm)
     6. Job Complete         — thank-you after job marked complete
     7. Aftercare            — service-specific tips 1 day after completion
     8. Invoice Sent         — invoice email with Stripe payment link
     9. Payment Received     — payment confirmation/receipt
    10. Follow-Up            — feedback request 3 days after completion
    11. Subscription Welcome — welcome pack for new recurring clients
    12. Thank You            — loyalty milestone (5th, 10th, 20th job)
    13. Re-engagement        — win-back for inactive one-off clients (30-90d)
    14. Seasonal Tips        — garden tips per season (max 1 per 60 days)
    15. Promotional          — service upsell 7-60 days after first job
    16. Referral             — £10-off referral ask 14-90 days after job
    17. Package Upgrade      — subscription tier upgrade after 30+ days
    18. Cancellation         — booking cancellation confirmation
    19. Reschedule           — booking reschedule confirmation
    """

    def __init__(self, db, api, email_provider=None):
        self.db = db
        self.api = api
        self.provider = email_provider  # EmailProvider instance
        self._running = False
        self._thread = None
        self._check_interval = config.EMAIL_AUTO_CHECK_INTERVAL
        self._daily_cap = config.EMAIL_DAILY_CAP
        self._listeners = []  # callbacks for UI update

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------
    def start(self):
        """Start the email automation daemon."""
        if self._running:
            return
        self._running = True
        self._thread = threading.Thread(target=self._run_loop, daemon=True, name="EmailAuto")
        self._thread.start()
        log.info("Email automation engine started")

    def stop(self):
        """Stop the automation engine."""
        self._running = False
        log.info("Email automation engine stopped")

    def add_listener(self, callback):
        """Register a callback for when emails are sent."""
        self._listeners.append(callback)

    def _notify_listeners(self, event_type: str, data: dict):
        for cb in self._listeners:
            try:
                cb(event_type, data)
            except Exception:
                pass

    # Marketing email types that must never be sent to the business owner
    _MARKETING_TYPES = frozenset({
        "seasonal_tips", "promotional", "newsletter", "win_back",
        "referral_program", "review_request", "anniversary",
        "loyalty_offer", "seasonal_offer", "reactivation",
        "re_engagement", "referral", "package_upgrade",
    })

    def _is_opted_out(self, email: str, email_type: str) -> bool:
        """Check if client has opted out of this email category.
        Fail-closed for marketing types (GDPR safe), fail-open for transactional.
        Always blocks marketing emails to business owner addresses."""
        # NEVER send marketing/lifecycle to the business owner
        if email and email.lower() in {e.lower() for e in config.OWNER_EMAILS}:
            if email_type in self._MARKETING_TYPES:
                log.info(f"Blocked {email_type} to owner email {email}")
                return True
        try:
            return self.db.is_email_opted_out(email, email_type)
        except Exception:
            if email_type in self._MARKETING_TYPES:
                log.warning(f"Opt-out check failed for {email}/{email_type} — blocking (GDPR fail-closed)")
                return True  # Block marketing sends on error (GDPR safe)
            return False  # Allow transactional (receipts, confirmations) on error

    # ------------------------------------------------------------------
    # Main Loop
    # ------------------------------------------------------------------
    def _run_loop(self):
        """Main loop — checks for automation triggers periodically."""
        # Wait a bit for initial sync to complete
        time.sleep(30)

        while self._running:
            try:
                self._check_automation_triggers()
            except Exception as e:
                log.error(f"Email automation error: {e}")
            # Sleep in small chunks
            for _ in range(self._check_interval):
                if not self._running:
                    break
                time.sleep(1)

    def _check_automation_triggers(self):
        """Check all automation triggers and send emails as needed."""
        today_count = self.db.get_todays_auto_email_count()
        if today_count >= self._daily_cap:
            log.info(f"Daily email cap reached ({today_count}/{self._daily_cap})")
            return

        remaining = self._daily_cap - today_count

        now = datetime.now()
        hour = now.hour

        # --- Core journey (high priority, run anytime 8-20) ---

        # Quote accepted confirmations: immediate
        if 8 <= hour <= 20 and remaining > 0:
            sent = self._send_quote_accepted_emails(max_send=min(remaining, 10))
            remaining -= sent

        # Booking confirmations: working hours
        if 8 <= hour <= 20 and remaining > 0:
            sent = self._send_booking_confirmations(max_send=min(remaining, 10))
            remaining -= sent

        # Day-before reminders: 5pm-7pm
        if 17 <= hour <= 19:
            sent = self._send_day_before_reminders(max_send=min(remaining, 15))
            remaining -= sent

        # Completion emails: working hours
        if 8 <= hour <= 20 and remaining > 0:
            sent = self._send_completion_emails(max_send=min(remaining, 10))
            remaining -= sent

        # Aftercare emails: day after completion (service-specific tips)
        if 8 <= hour <= 20 and remaining > 0:
            sent = self._send_aftercare_emails(max_send=min(remaining, 10))
            remaining -= sent

        # Invoice emails: working hours
        if 8 <= hour <= 20 and remaining > 0:
            sent = self._send_invoice_emails(max_send=min(remaining, 10))
            remaining -= sent

        # Payment received confirmations: working hours
        if 8 <= hour <= 20 and remaining > 0:
            sent = self._send_payment_received_emails(max_send=min(remaining, 10))
            remaining -= sent

        # Cancellation confirmations: immediate
        if 8 <= hour <= 20 and remaining > 0:
            sent = self._send_cancellation_emails(max_send=min(remaining, 10))
            remaining -= sent

        # Reschedule confirmations: immediate
        if 8 <= hour <= 20 and remaining > 0:
            sent = self._send_reschedule_emails(max_send=min(remaining, 10))
            remaining -= sent

        # --- Engagement & retention ---

        # Follow-up requests: morning (so they see it during the day)
        if 9 <= hour <= 11 and remaining > 0:
            sent = self._send_follow_ups(max_send=min(remaining, 10))
            remaining -= sent

        # Subscription welcome emails: working hours
        if 8 <= hour <= 18 and remaining > 0:
            sent = self._send_subscription_welcomes(max_send=min(remaining, 5))
            remaining -= sent

        # Loyalty thank-you emails: morning
        if 9 <= hour <= 12 and remaining > 0:
            sent = self._send_loyalty_thank_yous(max_send=min(remaining, 5))
            remaining -= sent

        # Re-engagement: morning — win back inactive one-off clients
        if 9 <= hour <= 11 and remaining > 0:
            sent = self._send_reengagement_emails(max_send=min(remaining, 5))
            remaining -= sent

        # Seasonal tips: late morning
        if 10 <= hour <= 12 and remaining > 0:
            sent = self._send_seasonal_tips(max_send=min(remaining, 5))
            remaining -= sent

        # Promotional upsells: afternoon
        if 13 <= hour <= 16 and remaining > 0:
            sent = self._send_promotional_emails(max_send=min(remaining, 5))
            remaining -= sent

        # Referral asks: afternoon
        if 14 <= hour <= 17 and remaining > 0:
            sent = self._send_referral_emails(max_send=min(remaining, 5))
            remaining -= sent

        # Package upgrade: morning
        if 10 <= hour <= 12 and remaining > 0:
            sent = self._send_package_upgrade_emails(max_send=min(remaining, 3))
            remaining -= sent

        # Process any queued emails (from cap overflow or failed retries)
        if remaining > 0 and self.provider:
            try:
                self.provider.process_queue(max_send=min(remaining, 10))
            except Exception as e:
                log.warning(f"Queue processing error: {e}")

        log.debug(f"Email automation check complete. Remaining capacity: {remaining}")

    # ------------------------------------------------------------------
    # Day-Before Reminders
    # ------------------------------------------------------------------
    def _send_day_before_reminders(self, max_send: int = 15) -> int:
        """Send reminders for tomorrow's jobs."""
        tomorrow = (date.today() + timedelta(days=1)).isoformat()
        jobs = self.db.get_jobs_needing_reminder(tomorrow)

        sent = 0
        for job in jobs[:max_send]:
            name = job.get("client_name", job.get("name", ""))
            email = job.get("email", "")
            service = job.get("service", "")
            time_str = job.get("time", "TBC")

            if not email:
                clients = self.db.get_clients(search=name)
                if clients:
                    email = clients[0].get("email", "")

            if not email or self._is_opted_out(email, "day_before_reminder"):
                continue

            client_id = job.get("id", 0)
            subject, body_html = tpl.build_day_before_reminder(
                name=name, service=service,
                job_date=tomorrow, job_time=time_str,
            )

            try:
                if self.provider:
                    result = self.provider.send(
                        to_email=email,
                        to_name=name,
                        subject=subject,
                        body_html=body_html,
                        email_type="day_before_reminder",
                        client_id=client_id,
                        client_name=name,
                    )
                    success = result["success"]
                else:
                    # Legacy GAS-only path
                    self.api.post("process_email_lifecycle", {
                        "types": ["day_before_reminder"],
                        "targetDate": tomorrow,
                        "clientFilter": name,
                    })
                    self.db.log_email(
                        client_id=client_id, client_name=name,
                        client_email=email, email_type="day_before_reminder",
                        subject=subject, status="sent",
                        template_used="lifecycle_reminder",
                        notes=f"Auto-sent for {tomorrow}",
                    )
                    success = True

                if success:
                    self.db.log_email_automation(
                        trigger_type="scheduled", client_id=client_id,
                        client_name=name, client_email=email,
                        email_type="day_before_reminder", status="sent",
                    )
                    sent += 1
                    log.info(f"Reminder sent to {name} for {tomorrow}")
                    self._notify_listeners("reminder_sent", {"name": name, "date": tomorrow})

            except Exception as e:
                log.warning(f"Failed to send reminder to {name}: {e}")
                self.db.log_email_automation(
                    trigger_type="scheduled",
                    client_id=client_id,
                    client_name=name,
                    client_email=email,
                    email_type="day_before_reminder",
                    status="failed",
                    gas_response=str(e),
                )

        return sent

    # ------------------------------------------------------------------
    # Completion Emails
    # ------------------------------------------------------------------
    def _send_completion_emails(self, max_send: int = 10) -> int:
        """Send completion/thank-you emails for jobs completed today."""
        today = date.today().isoformat()
        jobs = self.db.get_completed_jobs_needing_email(today)

        sent = 0
        for job in jobs[:max_send]:
            name = job.get("name", "")
            email = job.get("email", "")
            service = job.get("service", "")

            if not email or self._is_opted_out(email, "job_complete"):
                continue

            client_id = job.get("id", 0)
            subject, body_html = tpl.build_job_complete(
                name=name, service=service, job_date=today,
            )

            try:
                if self.provider:
                    result = self.provider.send(
                        to_email=email,
                        to_name=name,
                        subject=subject,
                        body_html=body_html,
                        email_type="job_complete",
                        client_id=client_id,
                        client_name=name,
                    )
                    success = result["success"]
                else:
                    self.api.post("send_completion_email", {
                        "name": name, "email": email,
                        "service": service, "jobNumber": job.get("job_number", ""),
                    })
                    self.db.log_email(
                        client_id=client_id, client_name=name,
                        client_email=email, email_type="job_complete",
                        subject=subject, status="sent",
                        template_used="completion_email",
                        notes="Auto-sent after completion",
                    )
                    success = True

                if success:
                    self.db.log_email_automation(
                        trigger_type="job_complete", client_id=client_id,
                        client_name=name, client_email=email,
                        email_type="job_complete", status="sent",
                    )
                    sent += 1
                    log.info(f"Completion email sent to {name}")
                    self._notify_listeners("completion_sent", {"name": name, "service": service})

            except Exception as e:
                log.warning(f"Failed to send completion email to {name}: {e}")

        return sent

    # ------------------------------------------------------------------
    # Invoice Emails (with Stripe payment link)
    # ------------------------------------------------------------------
    def _send_invoice_emails(self, max_send: int = 10) -> int:
        """Send invoice emails for unpaid invoices that haven't been emailed yet."""
        invoices = self.db.get_unsent_invoices()

        sent = 0
        for inv in invoices[:max_send]:
            name = inv.get("client_name", "")
            email = inv.get("client_email", "")
            amount = inv.get("amount", 0)
            inv_number = inv.get("invoice_number", "")
            payment_url = inv.get("payment_url", "")
            stripe_id = inv.get("stripe_invoice_id", "")
            due_date = inv.get("due_date", "")
            items_json = inv.get("items", "[]")

            if not email or self._is_opted_out(email, "invoice_sent"):
                continue

            # Build payment URL from stripe ID if needed
            if not payment_url and stripe_id:
                payment_url = f"https://invoice.stripe.com/i/{stripe_id}"

            subject, body_html = tpl.build_invoice_sent(
                name=name, invoice_number=inv_number,
                amount=amount, due_date=due_date,
                payment_url=payment_url, items_json=items_json,
            )

            try:
                result = self._send_via_provider(
                    email, name, subject, body_html,
                    "invoice_sent", inv.get("id", 0), name,
                    notes=inv_number,
                )
                if result:
                    sent += 1
                    log.info(f"Invoice email sent to {name}: {inv_number}")
                    self._notify_listeners("invoice_sent", {"name": name, "invoice": inv_number})
            except Exception as e:
                log.warning(f"Failed to send invoice to {name}: {e}")

        return sent

    # ------------------------------------------------------------------
    # Booking Confirmations
    # ------------------------------------------------------------------
    def _send_booking_confirmations(self, max_send: int = 10) -> int:
        """Send confirmation emails for newly confirmed bookings."""
        bookings = self.db.get_new_bookings_needing_confirmation()

        sent = 0
        for b in bookings[:max_send]:
            name = b.get("name", "")
            email = b.get("email", "")
            service = b.get("service", "")
            job_date = b.get("date", "")
            time_str = b.get("time", "TBC")
            address = b.get("address", "")
            postcode = b.get("postcode", "")

            if not email or self._is_opted_out(email, "booking_confirmed"):
                continue

            subject, body_html = tpl.build_booking_confirmed(
                name=name, service=service, job_date=job_date,
                job_time=time_str, postcode=postcode, address=address,
            )

            try:
                result = self._send_via_provider(
                    email, name, subject, body_html,
                    "booking_confirmed", b.get("id", 0), name,
                )
                if result:
                    sent += 1
                    log.info(f"Booking confirmation sent to {name}")
                    self._notify_listeners("booking_confirmed", {"name": name, "service": service})

                    # ── Notify Chris of new booking ──
                    try:
                        chris_subj = f"New Booking: {service} — {name}"
                        chris_html = (
                            f"<p><strong>New booking confirmed</strong></p>"
                            f"<p><strong>Client:</strong> {name}<br>"
                            f"<strong>Service:</strong> {service}<br>"
                            f"<strong>Date:</strong> {job_date}<br>"
                            f"<strong>Time:</strong> {time_str}<br>"
                            f"<strong>Postcode:</strong> {postcode}<br>"
                            f"<strong>Email:</strong> {email}</p>"
                        )
                        self._send_via_provider(
                            config.ADMIN_EMAIL, config.ADMIN_NAME,
                            chris_subj, chris_html,
                            "admin_booking_notification", 0, "Admin",
                            notes=f"booking:{name}",
                        )
                    except Exception:
                        pass  # Non-critical
            except Exception as e:
                log.warning(f"Failed to send booking confirmation to {name}: {e}")

        return sent

    # ------------------------------------------------------------------
    # Follow-Up (Feedback Request) — 3 days after completion
    # ------------------------------------------------------------------
    def _send_follow_ups(self, max_send: int = 10) -> int:
        """Send feedback requests for jobs completed 3 days ago."""
        delay = getattr(config, "EMAIL_FOLLOW_UP_DELAY_DAYS", 3)
        jobs = self.db.get_jobs_needing_follow_up(days_ago=delay)

        sent = 0
        for job in jobs[:max_send]:
            name = job.get("name", "")
            email = job.get("email", "")
            service = job.get("service", "")
            job_date = job.get("date", "")

            if not email or self._is_opted_out(email, "follow_up"):
                continue

            subject, body_html = tpl.build_follow_up(
                name=name, service=service, job_date=job_date,
            )

            try:
                result = self._send_via_provider(
                    email, name, subject, body_html,
                    "follow_up", job.get("id", 0), name,
                )
                if result:
                    sent += 1
                    log.info(f"Follow-up sent to {name}")
            except Exception as e:
                log.warning(f"Failed to send follow-up to {name}: {e}")

        return sent

    # ------------------------------------------------------------------
    # Subscription Welcome
    # ------------------------------------------------------------------
    def _send_subscription_welcomes(self, max_send: int = 5) -> int:
        """Send welcome emails to new recurring-service clients."""
        clients = self.db.get_new_subscription_clients()

        sent = 0
        for c in clients[:max_send]:
            name = c.get("name", "")
            email = c.get("email", "")
            service = c.get("service", "")
            frequency = c.get("frequency", "Regular")

            if not email or self._is_opted_out(email, "subscription_welcome"):
                continue

            subject, body_html = tpl.build_subscription_welcome(
                name=name, service=service, frequency=frequency,
            )

            try:
                result = self._send_via_provider(
                    email, name, subject, body_html,
                    "subscription_welcome", c.get("id", 0), name,
                )
                if result:
                    sent += 1
                    log.info(f"Subscription welcome sent to {name}")
            except Exception as e:
                log.warning(f"Failed to send subscription welcome to {name}: {e}")

        return sent

    # ------------------------------------------------------------------
    # Loyalty Thank You (milestone emails)
    # ------------------------------------------------------------------
    def _send_loyalty_thank_yous(self, max_send: int = 5) -> int:
        """Send thank-you emails to clients hitting loyalty milestones."""
        milestones = getattr(config, "EMAIL_LOYALTY_MILESTONES", [5, 10, 20, 50])
        clients = self.db.get_clients_at_loyalty_milestone(milestones)

        sent = 0
        for c in clients[:max_send]:
            name = c.get("name", "")
            email = c.get("email", "")
            count = c.get("job_count", 0)

            if not email or self._is_opted_out(email, "thank_you"):
                continue

            subject, body_html = tpl.build_loyalty_thank_you(
                name=name, milestone=count,
            )

            try:
                result = self._send_via_provider(
                    email, name, subject, body_html,
                    "thank_you", 0, name,
                    notes=f"milestone_{count}",
                )
                if result:
                    sent += 1
                    log.info(f"Loyalty thank-you sent to {name} ({count} jobs)")
            except Exception as e:
                log.warning(f"Failed to send loyalty thank-you to {name}: {e}")

        return sent

    # ------------------------------------------------------------------
    # Aftercare (service-specific tips, same day as completion)
    # ------------------------------------------------------------------
    def _send_aftercare_emails(self, max_send: int = 10) -> int:
        """Send aftercare tips for jobs completed yesterday (1-day delay)."""
        yesterday = (date.today() - timedelta(days=getattr(config, "AFTERCARE_DELAY_DAYS", 1))).isoformat()
        jobs = self.db.get_jobs_needing_aftercare(yesterday)

        sent = 0
        for job in jobs[:max_send]:
            name = job.get("name", "")
            email = job.get("email", "")
            service = job.get("service", "")

            if not email or self._is_opted_out(email, "aftercare"):
                continue

            subject, body_html = tpl.build_aftercare(name=name, service=service)
            svc_key = _normalise_service_key(service)

            try:
                result = self._send_via_provider(
                    email, name, subject, body_html,
                    "aftercare", job.get("id", 0), name,
                    notes=f"service:{svc_key}",
                )
                if result:
                    sent += 1
                    log.info(f"Aftercare email sent to {name} ({service})")
                    self._notify_listeners("aftercare_sent", {"name": name, "service": service})
            except Exception as e:
                log.warning(f"Failed to send aftercare to {name}: {e}")

        return sent

    # ------------------------------------------------------------------
    # Re-engagement (30-90 days idle, one-off clients)
    # ------------------------------------------------------------------
    def _send_reengagement_emails(self, max_send: int = 5) -> int:
        """Send win-back emails to inactive one-off clients."""
        clients = self.db.get_clients_needing_reengagement()

        sent = 0
        for c in clients[:max_send]:
            name = c.get("name", "")
            email = c.get("email", "")
            service = c.get("service", "")
            last_date = c.get("last_date", c.get("date", ""))

            if not email or self._is_opted_out(email, "re_engagement"):
                continue

            subject, body_html = tpl.build_reengagement(
                name=name, service=service, last_date=last_date,
            )

            try:
                result = self._send_via_provider(
                    email, name, subject, body_html,
                    "re_engagement", 0, name,
                )
                if result:
                    sent += 1
                    log.info(f"Re-engagement email sent to {name}")
            except Exception as e:
                log.warning(f"Failed to send re-engagement to {name}: {e}")

        return sent

    # ------------------------------------------------------------------
    # Seasonal Tips (garden advice per season, max once per 60 days)
    # ------------------------------------------------------------------
    def _send_seasonal_tips(self, max_send: int = 5) -> int:
        """Send seasonal garden tips to active clients."""
        clients = self.db.get_clients_needing_seasonal_tips(max_results=max_send)

        season = _get_current_season()
        tips_data = SEASONAL_TIPS.get(season, {})
        if not tips_data:
            return 0

        sent = 0
        for c in clients[:max_send]:
            name = c.get("name", "")
            email = c.get("email", "")

            if not email or self._is_opted_out(email, "seasonal_tips"):
                continue

            subject, body_html = tpl.build_seasonal_tips(
                name=name, season=season, tips=tips_data["tips"],
            )

            try:
                result = self._send_via_provider(
                    email, name, subject, body_html,
                    "seasonal_tips", 0, name,
                )
                if result:
                    sent += 1
                    log.info(f"Seasonal tips sent to {name}")
            except Exception as e:
                log.warning(f"Failed to send seasonal tips to {name}: {e}")

        return sent

    # ------------------------------------------------------------------
    # Promotional Upsells (7-60 days after first completed job)
    # ------------------------------------------------------------------
    def _send_promotional_emails(self, max_send: int = 5) -> int:
        """Send service upsell emails to recent clients."""
        clients = self.db.get_clients_needing_promo()

        sent = 0
        for c in clients[:max_send]:
            name = c.get("name", "")
            email = c.get("email", "")
            service = c.get("service", "")

            if not email or self._is_opted_out(email, "promotional"):
                continue

            subject, body_html = tpl.build_promotional(name=name, service=service)

            try:
                result = self._send_via_provider(
                    email, name, subject, body_html,
                    "promotional", 0, name,
                )
                if result:
                    sent += 1
                    log.info(f"Promotional email sent to {name}")
            except Exception as e:
                log.warning(f"Failed to send promo to {name}: {e}")

        return sent

    # ------------------------------------------------------------------
    # Referral (14-90 days after job completion)
    # ------------------------------------------------------------------
    def _send_referral_emails(self, max_send: int = 5) -> int:
        """Send referral programme emails to recent clients."""
        clients = self.db.get_clients_needing_referral()

        sent = 0
        for c in clients[:max_send]:
            name = c.get("name", "")
            email = c.get("email", "")

            if not email or self._is_opted_out(email, "referral"):
                continue

            subject, body_html = tpl.build_referral(name=name)

            try:
                result = self._send_via_provider(
                    email, name, subject, body_html,
                    "referral", 0, name,
                )
                if result:
                    sent += 1
                    log.info(f"Referral email sent to {name}")
            except Exception as e:
                log.warning(f"Failed to send referral to {name}: {e}")

        return sent

    # ------------------------------------------------------------------
    # Package Upgrade (subscribers 30+ days in, suggest next tier)
    # ------------------------------------------------------------------
    def _send_package_upgrade_emails(self, max_send: int = 3) -> int:
        """Send subscription upgrade suggestions to long-term subscribers."""
        clients = self.db.get_subscribers_needing_upgrade()

        sent = 0
        for c in clients[:max_send]:
            name = c.get("name", "")
            email = c.get("email", "")
            service = c.get("service", "")
            frequency = c.get("frequency", "")

            if not email or self._is_opted_out(email, "package_upgrade"):
                continue

            subject, body_html = tpl.build_package_upgrade(
                name=name, current_service=service, current_frequency=frequency,
            )

            try:
                result = self._send_via_provider(
                    email, name, subject, body_html,
                    "package_upgrade", 0, name,
                )
                if result:
                    sent += 1
                    log.info(f"Package upgrade email sent to {name}")
            except Exception as e:
                log.warning(f"Failed to send upgrade to {name}: {e}")

        return sent

    # ------------------------------------------------------------------
    # Quote Accepted (auto-send when quote status changes to Accepted)
    # ------------------------------------------------------------------
    def _send_quote_accepted_emails(self, max_send: int = 10) -> int:
        """Send confirmation emails for newly accepted quotes."""
        quotes = self.db.get_quotes_needing_acceptance_email()

        sent = 0
        for q in quotes[:max_send]:
            name = q.get("client_name", "")
            email = q.get("client_email", "")
            service = q.get("service", "")
            total = q.get("total", 0)
            quote_number = q.get("quote_number", "")

            if not email or self._is_opted_out(email, "quote_accepted"):
                continue

            subject, body_html = tpl.build_quote_accepted(
                name=name, quote_number=quote_number,
                service=service,
            )

            try:
                result = self._send_via_provider(
                    email, name, subject, body_html,
                    "quote_accepted", q.get("id", 0), name,
                    notes=f"quote:{quote_number}",
                )
                if result:
                    sent += 1
                    log.info(f"Quote accepted email sent to {name} ({quote_number})")
                    self._notify_listeners("quote_accepted_sent", {
                        "name": name, "quote_number": quote_number,
                    })
            except Exception as e:
                log.warning(f"Failed to send quote accepted to {name}: {e}")

        return sent

    # ------------------------------------------------------------------
    # Cancellation (auto-send when job is cancelled)
    # ------------------------------------------------------------------
    def _send_cancellation_emails(self, max_send: int = 10) -> int:
        """Send cancellation confirmation emails."""
        cancellations = self.db.get_cancellations_needing_email()

        sent = 0
        for c in cancellations[:max_send]:
            name = c.get("client_name", "")
            email = c.get("client_email", "")
            service = c.get("service", "")
            job_date = c.get("job_date", "")
            reason = c.get("reason", "")
            cancel_id = c.get("id", 0)

            if not email or self._is_opted_out(email, "cancellation"):
                self.db.mark_cancellation_notified(cancel_id)
                continue

            subject, body_html = tpl.build_cancellation(
                name=name, service=service,
                job_date=job_date, reason=reason,
            )

            try:
                result = self._send_via_provider(
                    email, name, subject, body_html,
                    "cancellation", 0, name,
                    notes=f"date:{job_date}",
                )
                if result:
                    sent += 1
                    self.db.mark_cancellation_notified(cancel_id)
                    log.info(f"Cancellation email sent to {name}")
            except Exception as e:
                log.warning(f"Failed to send cancellation to {name}: {e}")

        return sent

    # ------------------------------------------------------------------
    # Reschedule (auto-send when job is rescheduled)
    # ------------------------------------------------------------------
    def _send_reschedule_emails(self, max_send: int = 10) -> int:
        """Send reschedule confirmation emails."""
        reschedules = self.db.get_reschedules_needing_email()

        sent = 0
        for r in reschedules[:max_send]:
            name = r.get("client_name", "")
            email = r.get("client_email", "")
            service = r.get("service", "")
            old_date = r.get("old_date", "")
            new_date = r.get("new_date", "")
            new_time = r.get("new_time", "")
            reason = r.get("reason", "")
            resched_id = r.get("id", 0)

            if not email or self._is_opted_out(email, "reschedule"):
                self.db.mark_reschedule_notified(resched_id)
                continue

            subject, body_html = tpl.build_reschedule(
                name=name, service=service,
                old_date=old_date, new_date=new_date,
                new_time=new_time, reason=reason,
            )

            try:
                result = self._send_via_provider(
                    email, name, subject, body_html,
                    "reschedule", 0, name,
                    notes=f"old:{old_date} new:{new_date}",
                )
                if result:
                    sent += 1
                    self.db.mark_reschedule_notified(resched_id)
                    log.info(f"Reschedule email sent to {name} ({old_date} → {new_date})")
            except Exception as e:
                log.warning(f"Failed to send reschedule to {name}: {e}")

        return sent

    # ------------------------------------------------------------------
    # Payment Received (auto-send receipt when invoice marked paid)
    # ------------------------------------------------------------------
    def _send_payment_received_emails(self, max_send: int = 10) -> int:
        """Send payment receipt emails for newly paid invoices."""
        invoices = self.db.get_paid_invoices_needing_receipt()

        sent = 0
        for inv in invoices[:max_send]:
            name = inv.get("client_name", "")
            email = inv.get("client_email", "")
            amount = inv.get("amount", 0)
            inv_number = inv.get("invoice_number", "")

            if not email or self._is_opted_out(email, "payment_received"):
                continue

            subject, body_html = tpl.build_payment_received(
                name=name, invoice_number=inv_number, amount=amount,
            )

            try:
                result = self._send_via_provider(
                    email, name, subject, body_html,
                    "payment_received", inv.get("id", 0), name,
                    notes=f"invoice:{inv_number}",
                )
                if result:
                    sent += 1
                    log.info(f"Payment receipt sent to {name} ({inv_number})")

                    # ── Notify Chris that an invoice was paid ──
                    try:
                        chris_subject = f"Invoice Paid: {inv_number} — \u00a3{float(amount):.2f} from {name}"
                        chris_html = (
                            f"<p><strong>Invoice {inv_number}</strong> has been paid.</p>"
                            f"<p><strong>Client:</strong> {name}<br>"
                            f"<strong>Amount:</strong> \u00a3{float(amount):.2f}<br>"
                            f"<strong>Email:</strong> {email}</p>"
                            f"<p>Receipt has been sent to the client automatically.</p>"
                        )
                        self._send_via_provider(
                            config.ADMIN_EMAIL, config.ADMIN_NAME,
                            chris_subject, chris_html,
                            "admin_payment_notification", 0, "Admin",
                            notes=f"invoice_paid:{inv_number}",
                        )
                    except Exception:
                        pass  # Non-critical — Telegram still fires
            except Exception as e:
                log.warning(f"Failed to send payment receipt to {name}: {e}")

        return sent

    # ------------------------------------------------------------------
    # Helper: send via provider with fallback
    # ------------------------------------------------------------------
    def _send_via_provider(self, email, name, subject, body_html,
                           email_type, client_id=0, client_name="",
                           notes="") -> bool:
        """Route an email send through the provider or GAS fallback. Returns success bool."""
        if self.provider:
            result = self.provider.send(
                to_email=email, to_name=name,
                subject=subject, body_html=body_html,
                email_type=email_type,
                client_id=client_id, client_name=client_name,
                notes=notes,
            )
            success = result["success"]
        else:
            self.api.post("send_email", {
                "to": email, "name": name,
                "subject": subject, "htmlBody": body_html,
                "emailType": email_type,
            })
            self.db.log_email(
                client_id=client_id, client_name=client_name,
                client_email=email, email_type=email_type,
                subject=subject, status="sent",
                template_used=email_type,
                notes=notes,
            )
            success = True

        if success:
            self.db.log_email_automation(
                trigger_type="scheduled", client_id=client_id,
                client_name=client_name, client_email=email,
                email_type=email_type, status="sent",
            )

        return success

    @staticmethod
    def _ordinal(n: int) -> str:
        """Convert number to ordinal string (1st, 2nd, 3rd, etc.)."""
        if 11 <= (n % 100) <= 13:
            suffix = "th"
        else:
            suffix = {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")
        return f"{n}{suffix}"

    # ------------------------------------------------------------------
    # Manual Triggers (called from UI)
    # ------------------------------------------------------------------
    def send_reminder_for_date(self, target_date: str) -> dict:
        """Manually trigger reminders for a specific date. Returns results."""
        jobs = self.db.get_jobs_needing_reminder(target_date)

        results = {"sent": 0, "failed": 0, "skipped": 0, "details": []}

        for job in jobs:
            name = job.get("client_name", job.get("name", ""))
            email = job.get("email", "")
            service = job.get("service", "")
            time_str = job.get("time", "TBC")

            if not email:
                # Try to look up email
                clients = self.db.get_clients(search=name)
                if clients:
                    email = clients[0].get("email", "")

            if not email:
                results["skipped"] += 1
                results["details"].append(f"⚠️ {name} — no email address")
                continue

            try:
                postcode = job.get("postcode", "")
                subject, body_html = tpl.build_day_before_reminder(
                    name=name, service=service, job_date=target_date,
                    time_str=time_str, postcode=postcode,
                )

                if self.provider:
                    result = self.provider.send(
                        to_email=email, to_name=name,
                        subject=subject, body_html=body_html,
                        email_type="day_before_reminder",
                        client_id=job.get("id", 0), client_name=name,
                        skip_duplicate_check=True,  # manual trigger
                    )
                    if not result["success"]:
                        raise Exception(result["error"])
                else:
                    self.api.post("process_email_lifecycle", {
                        "types": ["day_before_reminder"],
                        "targetDate": target_date,
                        "clientFilter": name,
                    })
                    self.db.log_email(
                        client_id=job.get("id", 0), client_name=name,
                        client_email=email, email_type="day_before_reminder",
                        subject=subject, status="sent",
                        template_used="lifecycle_reminder",
                        notes=f"Manual trigger for {target_date}",
                    )

                self.db.log_email_automation(
                    trigger_type="manual",
                    client_id=job.get("id", 0),
                    client_name=name,
                    client_email=email,
                    email_type="day_before_reminder",
                    status="sent",
                )

                results["sent"] += 1
                results["details"].append(f"✅ {name} — reminder sent")

            except Exception as e:
                results["failed"] += 1
                results["details"].append(f"❌ {name} — {e}")

        return results

    def send_completion_email_for_job(self, job: dict) -> dict:
        """Send a completion email for a specific job. Returns result."""
        name = job.get("name", job.get("client_name", ""))
        email = job.get("email", job.get("client_email", ""))
        service = job.get("service", "")
        job_number = job.get("job_number", "")

        if not email:
            return {"success": False, "error": "No email address"}

        job_date = job.get("date", "")
        subject, body_html = tpl.build_job_complete(
            name=name, service=service, job_date=job_date,
        )

        try:
            if self.provider:
                result = self.provider.send(
                    to_email=email, to_name=name,
                    subject=subject, body_html=body_html,
                    email_type="job_complete",
                    client_id=job.get("id", 0), client_name=name,
                )
                if result["success"]:
                    return {"success": True, "message": f"Completion email sent to {name} via {result['provider']}"}
                else:
                    return {"success": False, "error": result["error"]}
            else:
                self.api.post("send_completion_email", {
                    "name": name, "email": email,
                    "service": service, "jobNumber": job_number,
                })
                self.db.log_email(
                    client_id=job.get("id", 0), client_name=name,
                    client_email=email, email_type="job_complete",
                    subject=subject, status="sent",
                    template_used="completion_email",
                )
                return {"success": True, "message": f"Completion email sent to {name}"}

        except Exception as e:
            return {"success": False, "error": str(e)}

    def send_enquiry_reply(self, enquiry: dict) -> dict:
        """Send a reply to an enquiry. Returns result."""
        name = enquiry.get("name", "")
        email = enquiry.get("email", "")
        message = enquiry.get("message", "")

        if not email:
            return {"success": False, "error": "No email address"}

        service = enquiry.get("service", "")
        subject, body_html = tpl.build_enquiry_received(
            name=name, service=service, message=message,
        )

        try:
            if self.provider:
                result = self.provider.send(
                    to_email=email, to_name=name,
                    subject=subject, body_html=body_html,
                    email_type="enquiry_received",
                    client_name=name,
                )
            else:
                self.api.post("send_enquiry_reply", {
                    "name": name, "email": email, "message": message,
                })
                self.db.log_email(
                    client_id=0, client_name=name,
                    client_email=email, email_type="enquiry_received",
                    subject=subject, status="sent",
                    template_used="enquiry_reply",
                )

            # Update enquiry status
            if enquiry.get("id"):
                self.db.save_enquiry({
                    "id": enquiry["id"],
                    "status": "Contacted",
                    "replied": "Yes",
                })

            # ── Notify Chris of new enquiry ──
            try:
                excerpt = (message[:120] + "...") if len(message) > 120 else message
                chris_subj = f"New Enquiry: {service or 'General'} — {name}"
                chris_html = (
                    f"<p><strong>New enquiry received</strong></p>"
                    f"<p><strong>Client:</strong> {name}<br>"
                    f"<strong>Email:</strong> {email}<br>"
                    f"<strong>Service:</strong> {service or 'Not specified'}<br>"
                    f"<strong>Message:</strong> {excerpt}</p>"
                    f"<p>An auto-reply has been sent to the client.</p>"
                )
                self._send_via_provider(
                    config.ADMIN_EMAIL, config.ADMIN_NAME,
                    chris_subj, chris_html,
                    "admin_enquiry_notification", 0, "Admin",
                    notes=f"enquiry:{name}",
                )
            except Exception:
                pass  # Non-critical

            return {"success": True, "message": f"Reply sent to {name}"}

        except Exception as e:
            return {"success": False, "error": str(e)}

    def run_full_lifecycle(self, include_seasonal: bool = False) -> dict:
        """Run the full 19-stage email lifecycle locally (Hub owns all emails)."""
        try:
            results = {
                "quote_accepted": 0, "reminders": 0, "aftercare": 0,
                "completions": 0, "invoices": 0, "payment_received": 0,
                "confirmations": 0, "follow_ups": 0, "welcomes": 0,
                "loyalty": 0, "reengagement": 0, "seasonal": 0,
                "promotional": 0, "referral": 0, "upgrade": 0,
                "cancellations": 0, "reschedules": 0, "errors": [],
            }

            # Core journey — highest priority
            results["quote_accepted"] = self._send_quote_accepted_emails(max_send=10)
            results["confirmations"] = self._send_booking_confirmations(max_send=10)
            results["reminders"] = self._send_day_before_reminders(max_send=15)
            results["completions"] = self._send_completion_emails(max_send=10)
            results["aftercare"] = self._send_aftercare_emails(max_send=10)
            results["invoices"] = self._send_invoice_emails(max_send=10)
            results["payment_received"] = self._send_payment_received_emails(max_send=10)
            results["follow_ups"] = self._send_follow_ups(max_send=10)

            # Cancellation & reschedule
            results["cancellations"] = self._send_cancellation_emails(max_send=10)
            results["reschedules"] = self._send_reschedule_emails(max_send=10)

            # Engagement & retention
            results["welcomes"] = self._send_subscription_welcomes(max_send=5)
            results["loyalty"] = self._send_loyalty_thank_yous(max_send=5)
            results["reengagement"] = self._send_reengagement_emails(max_send=5)

            if include_seasonal:
                results["seasonal"] = self._send_seasonal_tips(max_send=10)

            results["promotional"] = self._send_promotional_emails(max_send=5)
            results["referral"] = self._send_referral_emails(max_send=5)
            results["upgrade"] = self._send_package_upgrade_emails(max_send=3)

            total_sent = sum(v for v in results.values() if isinstance(v, int))

            self.db.log_email_automation(
                trigger_type="full_lifecycle",
                client_id=0,
                client_name="ALL",
                client_email="",
                email_type="lifecycle_batch",
                status="sent",
                gas_response=json.dumps(results),
            )

            return {"success": True, "result": results, "total_sent": total_sent}

        except Exception as e:
            return {"success": False, "error": str(e)}

    def send_invoice_email(self, invoice: dict) -> dict:
        """Manually send an invoice email for a specific invoice."""
        name = invoice.get("client_name", "")
        email = invoice.get("client_email", "")
        amount = invoice.get("amount", 0)
        inv_number = invoice.get("invoice_number", "")
        payment_url = invoice.get("payment_url", "")
        stripe_id = invoice.get("stripe_invoice_id", "")
        service = invoice.get("service", "")

        if not email:
            return {"success": False, "error": "No email address on invoice"}

        pay_link = payment_url
        if not pay_link and stripe_id:
            pay_link = f"https://invoice.stripe.com/i/{stripe_id}"

        # Parse items from invoice
        items_json = invoice.get("items", "[]")
        try:
            items = json.loads(items_json) if items_json else []
        except Exception:
            items = [{"description": service or "Service", "amount": amount}]

        subject, body_html = tpl.build_invoice_sent(
            name=name, invoice_number=inv_number, amount=amount,
            items_json=json.dumps(items) if isinstance(items, list) else items_json,
            payment_url=pay_link,
        )

        try:
            if self.provider:
                result = self.provider.send(
                    to_email=email, to_name=name,
                    subject=subject, body_html=body_html,
                    email_type="invoice_sent",
                    client_id=invoice.get("id", 0), client_name=name,
                    skip_duplicate_check=True,
                )
                if result["success"]:
                    return {"success": True, "message": f"Invoice emailed to {name} via {result['provider']}"}
                else:
                    return {"success": False, "error": result["error"]}
            else:
                self.api.post("send_email", {
                    "to": email, "name": name,
                    "subject": subject, "htmlBody": body_html,
                    "emailType": "invoice_sent",
                })
                self.db.log_email(
                    client_id=invoice.get("id", 0), client_name=name,
                    client_email=email, email_type="invoice_sent",
                    subject=subject, status="sent",
                    template_used="invoice_email",
                    notes=inv_number,
                )
                return {"success": True, "message": f"Invoice emailed to {name}"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def send_quote_email(self, quote: dict) -> dict:
        """Send a quote to a client by email.
        
        Flow:
        1. Call GAS create_quote (sendNow=False) to save quote and get a token
        2. Build email with proper ?token= accept/decline link
        3. Send via Brevo (or GAS fallback)
        """
        name = quote.get("client_name", "")
        email = quote.get("client_email", "")
        total = quote.get("total", 0)
        quote_number = quote.get("quote_number", "")
        valid_until = quote.get("valid_until", "")
        items_json = quote.get("items", "[]")
        service = quote.get("service", "")

        if not email:
            return {"success": False, "error": "No email address on quote"}

        # Parse items
        try:
            items = json.loads(items_json) if items_json else []
        except Exception:
            items = []

        # ── Step 1: Create quote in GAS to get token ──
        token = ""
        gas_quote_id = quote_number
        try:
            gas_result = self.api.post("create_quote", {
                "name": name,
                "email": email,
                "phone": quote.get("client_phone", ""),
                "address": quote.get("address", ""),
                "postcode": quote.get("postcode", ""),
                "title": service or "Custom Quote",
                "lineItems": items_json,
                "subtotal": float(quote.get("subtotal", total)),
                "discountPct": float(quote.get("discount_pct", 0)),
                "discountAmt": float(quote.get("discount", 0)),
                "vatAmt": 0,
                "grandTotal": float(total),
                "depositRequired": bool(quote.get("deposit_required")),
                "validDays": 30,
                "notes": quote.get("notes", ""),
                "sendNow": False,  # We'll send via Brevo ourselves
            })
            if isinstance(gas_result, dict) and gas_result.get("status") == "success":
                token = gas_result.get("token", "")
                gas_quote_id = gas_result.get("quoteId", quote_number)
                log.info("GAS create_quote OK — ID=%s, token=%s...", gas_quote_id, token[:8] if token else "none")
            else:
                log.warning("GAS create_quote returned: %s", gas_result)
        except Exception as e:
            log.warning("GAS create_quote failed: %s — sending without token", e)

        # ── Step 2: Build email with correct link ──
        subject, body_html = tpl.build_quote_sent(
            name=name, quote_number=gas_quote_id, service=service,
            items=items, total=total, valid_until=valid_until,
            token=token,
        )

        try:
            provider_ok = False
            if self.provider:
                result = self.provider.send(
                    to_email=email, to_name=name,
                    subject=subject, body_html=body_html,
                    email_type="quote_sent",
                    client_name=name,
                    skip_duplicate_check=True,
                )
                if result["success"]:
                    provider_ok = True
                else:
                    log.warning("Brevo send_quote failed: %s — trying GAS fallback", result.get("error"))

            # GAS fallback: provider absent or provider failed
            if not provider_ok:
                self.api.post("send_email", {
                    "to": email, "name": name,
                    "subject": subject, "htmlBody": body_html,
                    "emailType": "quote_sent",
                })

            self.db.log_email(
                client_id=0, client_name=name,
                client_email=email, email_type="quote_sent",
                subject=subject, status="sent",
                template_used="quote_email",
                notes=quote_number,
            )

            # ── Notify Chris of quote sent ──
            try:
                chris_subj = f"Quote Sent: {quote_number} — \u00a3{float(total):.2f} to {name}"
                chris_html = (
                    f"<p><strong>Quote sent to client</strong></p>"
                    f"<p><strong>Client:</strong> {name}<br>"
                    f"<strong>Email:</strong> {email}<br>"
                    f"<strong>Quote:</strong> {quote_number}<br>"
                    f"<strong>Service:</strong> {service}<br>"
                    f"<strong>Total:</strong> \u00a3{float(total):.2f}<br>"
                    f"<strong>Valid Until:</strong> {valid_until or 'N/A'}</p>"
                )
                self._send_via_provider(
                    config.ADMIN_EMAIL, config.ADMIN_NAME,
                    chris_subj, chris_html,
                    "admin_quote_notification", 0, "Admin",
                    notes=f"quote_sent:{quote_number}",
                )
            except Exception:
                pass  # Non-critical

            return {"success": True, "message": f"Quote emailed to {name}"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    # ------------------------------------------------------------------
    # Status
    # ------------------------------------------------------------------
    def get_status(self) -> dict:
        """Get current automation status including delivery stats."""
        today_count = self.db.get_todays_auto_email_count()
        tomorrow = (date.today() + timedelta(days=1)).isoformat()
        pending_reminders = len(self.db.get_jobs_needing_reminder(tomorrow))
        pending_completions = len(self.db.get_completed_jobs_needing_email(date.today().isoformat()))
        pending_aftercare = len(self.db.get_jobs_needing_aftercare(date.today().isoformat()))

        # Additional counts
        try:
            pending_invoices = len(self.db.get_unsent_invoices())
        except Exception:
            pending_invoices = 0
        try:
            delay = getattr(config, "EMAIL_FOLLOW_UP_DELAY_DAYS", 3)
            pending_follow_ups = len(self.db.get_jobs_needing_follow_up(delay))
        except Exception:
            pending_follow_ups = 0
        try:
            pending_reengagement = len(self.db.get_clients_needing_reengagement())
        except Exception:
            pending_reengagement = 0
        try:
            pending_promo = len(self.db.get_clients_needing_promo())
        except Exception:
            pending_promo = 0
        try:
            pending_quote_accepted = len(self.db.get_quotes_needing_acceptance_email())
        except Exception:
            pending_quote_accepted = 0
        try:
            pending_cancellations = len(self.db.get_cancellations_needing_email())
        except Exception:
            pending_cancellations = 0
        try:
            pending_reschedules = len(self.db.get_reschedules_needing_email())
        except Exception:
            pending_reschedules = 0
        try:
            pending_receipts = len(self.db.get_paid_invoices_needing_receipt())
        except Exception:
            pending_receipts = 0

        status = {
            "running": self._running,
            "emails_today": today_count,
            "daily_cap": self._daily_cap,
            "pending_reminders": pending_reminders,
            "pending_completions": pending_completions,
            "pending_aftercare": pending_aftercare,
            "pending_invoices": pending_invoices,
            "pending_follow_ups": pending_follow_ups,
            "pending_reengagement": pending_reengagement,
            "pending_promo": pending_promo,
            "pending_quote_accepted": pending_quote_accepted,
            "pending_cancellations": pending_cancellations,
            "pending_reschedules": pending_reschedules,
            "pending_receipts": pending_receipts,
            "check_interval": self._check_interval,
            "provider": "brevo+gas" if self.provider and self.provider._has_brevo else "gas",
            "lifecycle_stages": 19,
        }

        # Add delivery stats from provider
        if self.provider:
            try:
                status["delivery_stats"] = self.provider.get_delivery_stats()
            except Exception:
                pass

        return status
