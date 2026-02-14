"""
Email Automation Engine for GGM Hub.
Full 9-stage lifecycle: enquiry, quote, booking, reminder, completion,
invoice (Stripe), follow-up, subscription welcome, loyalty thank-you.
Routes all emails through EmailProvider (Brevo primary, GAS fallback).
"""

import json
import logging
import threading
import time
from datetime import datetime, date, timedelta

from . import config

log = logging.getLogger("ggm.email_auto")


class EmailAutomationEngine:
    """
    Background engine that automatically triggers all 9 lifecycle emails.

    Stages:
    1. Enquiry Received     — auto-reply on new enquiry
    2. Quote Sent           — emailed when quote status changes to Sent
    3. Booking Confirmed    — sent when a booking is confirmed
    4. Day-Before Reminder  — 24h reminder (5-7pm)
    5. Job Complete         — thank-you after job marked complete
    6. Invoice Sent         — invoice email with Stripe payment link
    7. Follow-Up            — feedback request 3 days after completion
    8. Subscription Welcome — welcome pack for new recurring clients
    9. Thank You            — loyalty milestone (5th, 10th, 20th job)
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

        # Day-before reminders: 5pm-7pm
        if 17 <= hour <= 19:
            sent = self._send_day_before_reminders(max_send=min(remaining, 15))
            remaining -= sent

        # Completion emails: working hours
        if 8 <= hour <= 20 and remaining > 0:
            sent = self._send_completion_emails(max_send=min(remaining, 10))
            remaining -= sent

        # Invoice emails: working hours
        if 8 <= hour <= 20 and remaining > 0:
            sent = self._send_invoice_emails(max_send=min(remaining, 10))
            remaining -= sent

        # Booking confirmations: working hours
        if 8 <= hour <= 20 and remaining > 0:
            sent = self._send_booking_confirmations(max_send=min(remaining, 10))
            remaining -= sent

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
                # Look up email from clients table
                clients = self.db.get_clients(search=name)
                if clients:
                    email = clients[0].get("email", "")

            if not email:
                continue

            client_id = job.get("id", 0)
            subject = f"Reminder: {service} tomorrow at {time_str}"

            # Build reminder body HTML
            body_html = f"""
            <h2 style="color:#2d6a4f; margin-bottom:16px;">Appointment Reminder</h2>
            <p>Hi {name},</p>
            <p>Just a friendly reminder that we'll be with you <strong>tomorrow</strong>
            for your <strong>{service}</strong> appointment{f' at <strong>{time_str}</strong>' if time_str != 'TBC' else ''}.</p>
            <p>If you need to reschedule or have any questions, just reply to this email
            or visit <a href="https://www.gardnersgm.co.uk" style="color:#2d6a4f;">our website</a>.</p>
            <p>See you tomorrow!<br><strong>Chris</strong><br>Gardners Ground Maintenance</p>
            """

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
            job_number = job.get("job_number", "")

            if not email:
                continue

            client_id = job.get("id", 0)
            subject = f"Job Complete: {service}"

            # Build completion email body
            body_html = f"""
            <h2 style="color:#2d6a4f; margin-bottom:16px;">Job Complete ✅</h2>
            <p>Hi {name},</p>
            <p>Great news — your <strong>{service}</strong> has been completed
            {f' (Job #{job_number})' if job_number else ''}.</p>
            <p>We hope you're pleased with the results! If there's anything at all
            you'd like us to adjust or if you have any questions, please don't
            hesitate to get in touch.</p>
            <p>If you'd like to leave a review, we'd really appreciate it:
            <a href="https://www.gardnersgm.co.uk/testimonials" style="color:#2d6a4f;">Leave a review</a></p>
            <p>Thank you for choosing us.<br><strong>Chris</strong><br>Gardners Ground Maintenance</p>
            """

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
                        "service": service, "jobNumber": job_number,
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

            if not email:
                continue

            # Parse invoice items for the line-item breakdown
            try:
                items = json.loads(items_json) if items_json else []
            except Exception:
                items = []

            items_html = ""
            if items:
                rows = ""
                for item in items:
                    desc = item.get("description", item.get("service", "Service"))
                    qty = item.get("quantity", 1)
                    price = item.get("price", item.get("amount", 0))
                    rows += f"""<tr>
                        <td style="padding:8px 12px; border-bottom:1px solid #e9ecef;">{desc}</td>
                        <td style="padding:8px 12px; border-bottom:1px solid #e9ecef; text-align:center;">{qty}</td>
                        <td style="padding:8px 12px; border-bottom:1px solid #e9ecef; text-align:right;">&pound;{price:,.2f}</td>
                    </tr>"""
                items_html = f"""
                <table width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0; border:1px solid #e9ecef; border-radius:6px;">
                    <tr style="background-color:#f8f9fa;">
                        <th style="padding:10px 12px; text-align:left; font-size:13px;">Description</th>
                        <th style="padding:10px 12px; text-align:center; font-size:13px;">Qty</th>
                        <th style="padding:10px 12px; text-align:right; font-size:13px;">Amount</th>
                    </tr>
                    {rows}
                    <tr style="background-color:#2d6a4f;">
                        <td colspan="2" style="padding:10px 12px; color:#fff; font-weight:bold;">Total</td>
                        <td style="padding:10px 12px; color:#fff; font-weight:bold; text-align:right;">&pound;{amount:,.2f}</td>
                    </tr>
                </table>"""

            # Build the Stripe payment button
            pay_button = ""
            if payment_url:
                pay_button = f"""
                <div style="text-align:center; margin:24px 0;">
                    <a href="{payment_url}" style="display:inline-block; background-color:#2d6a4f;
                    color:#ffffff; padding:14px 32px; text-decoration:none; border-radius:8px;
                    font-weight:bold; font-size:16px; letter-spacing:0.5px;">
                        Pay &pound;{amount:,.2f} Now
                    </a>
                    <p style="margin:8px 0 0; font-size:12px; color:#636e72;">
                        Secure payment via Stripe. Card payments accepted.
                    </p>
                </div>"""
            elif stripe_id:
                # Construct Stripe invoice URL from invoice ID
                stripe_url = f"https://invoice.stripe.com/i/{stripe_id}"
                pay_button = f"""
                <div style="text-align:center; margin:24px 0;">
                    <a href="{stripe_url}" style="display:inline-block; background-color:#2d6a4f;
                    color:#ffffff; padding:14px 32px; text-decoration:none; border-radius:8px;
                    font-weight:bold; font-size:16px; letter-spacing:0.5px;">
                        Pay &pound;{amount:,.2f} Now
                    </a>
                    <p style="margin:8px 0 0; font-size:12px; color:#636e72;">
                        Secure payment via Stripe. Card payments accepted.
                    </p>
                </div>"""

            due_text = f" by <strong>{due_date}</strong>" if due_date else ""

            subject = f"Invoice {inv_number} — \u00a3{amount:,.2f}"
            body_html = f"""
            <h2 style="color:#2d6a4f; margin-bottom:16px;">Invoice {inv_number}</h2>
            <p>Hi {name},</p>
            <p>Please find your invoice below for recent work carried out by
            Gardners Ground Maintenance.</p>
            {items_html}
            <p><strong>Total due{due_text}: &pound;{amount:,.2f}</strong></p>
            {pay_button}
            <p>If you'd prefer to pay by bank transfer, please use these details:</p>
            <div style="background-color:#f8f9fa; padding:12px 16px; border-radius:6px; margin:12px 0;">
                <p style="margin:4px 0; font-size:13px;"><strong>Account:</strong> Gardners Ground Maintenance</p>
                <p style="margin:4px 0; font-size:13px;"><strong>Sort Code:</strong> Please contact us</p>
                <p style="margin:4px 0; font-size:13px;"><strong>Reference:</strong> {inv_number}</p>
            </div>
            <p>If you have any questions about this invoice, just reply to this email.</p>
            <p>Thanks,<br><strong>Chris</strong><br>Gardners Ground Maintenance</p>
            """

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

            if not email:
                continue

            subject = f"Booking Confirmed: {service}"
            body_html = f"""
            <h2 style="color:#2d6a4f; margin-bottom:16px;">Booking Confirmed \u2705</h2>
            <p>Hi {name},</p>
            <p>Great news \u2014 your booking has been confirmed! Here are the details:</p>
            <div style="background-color:#f8f9fa; padding:16px; border-radius:8px; border-left:4px solid #2d6a4f; margin:16px 0;">
                <p style="margin:6px 0;"><strong>Service:</strong> {service}</p>
                <p style="margin:6px 0;"><strong>Date:</strong> {job_date}</p>
                <p style="margin:6px 0;"><strong>Time:</strong> {time_str}</p>
                {f'<p style="margin:6px 0;"><strong>Location:</strong> {address}</p>' if address else ''}
            </div>
            <h3 style="color:#2d6a4f; margin-top:20px;">What to Expect</h3>
            <ul style="color:#636e72; line-height:1.8;">
                <li>We'll arrive within the scheduled time window</li>
                <li>You don't need to be at home \u2014 just make sure we have access</li>
                <li>We'll send a reminder the day before</li>
                <li>We'll message you once the job is complete</li>
            </ul>
            <p>If you need to reschedule or have any questions, just reply to this email
            or call us.</p>
            <p>Looking forward to it!<br><strong>Chris</strong><br>Gardners Ground Maintenance</p>
            """

            try:
                result = self._send_via_provider(
                    email, name, subject, body_html,
                    "booking_confirmed", b.get("id", 0), name,
                )
                if result:
                    sent += 1
                    log.info(f"Booking confirmation sent to {name}")
                    self._notify_listeners("booking_confirmed", {"name": name, "service": service})
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

            if not email:
                continue

            subject = f"How was your {service}?"
            body_html = f"""
            <h2 style="color:#2d6a4f; margin-bottom:16px;">How Did We Do? \u2b50</h2>
            <p>Hi {name},</p>
            <p>It's been a few days since we completed your <strong>{service}</strong>,
            and we just wanted to check in \u2014 are you happy with the results?</p>
            <p>Your feedback helps us improve and means the world to a small
            Cornish business like ours.</p>
            <div style="text-align:center; margin:24px 0;">
                <a href="https://www.gardnersgm.co.uk/testimonials" style="display:inline-block;
                background-color:#2d6a4f; color:#ffffff; padding:12px 28px; text-decoration:none;
                border-radius:8px; font-weight:bold; font-size:15px;">
                    Leave a Review
                </a>
            </div>
            <p>If there's anything we could have done better, please let us know \u2014
            just reply to this email. We take all feedback seriously.</p>
            <p>Thank you for your support!<br><strong>Chris</strong><br>Gardners Ground Maintenance</p>
            """

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

            if not email:
                continue

            subject = f"Welcome to Your {frequency} {service} Plan"
            body_html = f"""
            <h2 style="color:#2d6a4f; margin-bottom:16px;">Welcome to the GGM Family! \ud83c\udf3f</h2>
            <p>Hi {name},</p>
            <p>Thank you for choosing a <strong>{frequency.lower()}</strong> plan for your
            <strong>{service}</strong>. We're thrilled to have you on board!</p>
            <h3 style="color:#2d6a4f;">What Your Plan Includes</h3>
            <ul style="color:#636e72; line-height:1.8;">
                <li>{frequency} <strong>{service}</strong> visits</li>
                <li>Priority scheduling \u2014 you're always booked first</li>
                <li>Seasonal advice tailored to your garden</li>
                <li>No contracts \u2014 cancel any time with just a message</li>
            </ul>
            <h3 style="color:#2d6a4f;">How It Works</h3>
            <ol style="color:#636e72; line-height:1.8;">
                <li>We'll schedule your visits automatically</li>
                <li>You'll get a reminder the day before each visit</li>
                <li>After each visit, you'll receive a completion summary</li>
                <li>Invoicing is handled automatically</li>
            </ol>
            <p>If you ever need to adjust your schedule, add services, or have
            any questions at all, just reply to this email.</p>
            <p>Welcome aboard!<br><strong>Chris</strong><br>Gardners Ground Maintenance</p>
            """

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

            if not email:
                continue

            ordinal = self._ordinal(count)
            subject = f"Thank You, {name}! \ud83c\udf1f {ordinal} Job Together"
            body_html = f"""
            <h2 style="color:#2d6a4f; margin-bottom:16px;">A Big Thank You! \ud83d\udc9a</h2>
            <p>Hi {name},</p>
            <p>We've just realised something special \u2014 we've now completed your
            <strong>{ordinal} job</strong> together!</p>
            <p>That's a proper milestone, and we wanted to take a moment to say
            <strong>thank you</strong>. Your continued trust in Gardners Ground
            Maintenance means everything to us as a small Cornish business.</p>
            <p>We genuinely love looking after your garden, and we're grateful
            you keep choosing us.</p>
            <p>Here's to many more! If there's ever anything we can do to make
            your experience even better, you know where to find us.</p>
            <p>With heartfelt thanks,<br><strong>Chris</strong><br>Gardners Ground Maintenance</p>
            """

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
                subject = f"Reminder: {service} on {target_date} at {time_str}"
                body_html = f"""
                <h2 style="color:#2d6a4f; margin-bottom:16px;">Appointment Reminder</h2>
                <p>Hi {name},</p>
                <p>A friendly reminder about your upcoming <strong>{service}</strong>
                appointment on <strong>{target_date}</strong>{f' at <strong>{time_str}</strong>' if time_str != 'TBC' else ''}.</p>
                <p>If you need to reschedule, just reply to this email or
                visit <a href="https://www.gardnersgm.co.uk" style="color:#2d6a4f;">our website</a>.</p>
                <p>See you soon!<br><strong>Chris</strong><br>Gardners Ground Maintenance</p>
                """

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

        subject = f"Job Complete: {service}"
        body_html = f"""
        <h2 style="color:#2d6a4f; margin-bottom:16px;">Job Complete \u2705</h2>
        <p>Hi {name},</p>
        <p>Your <strong>{service}</strong> has been completed
        {f' (Job #{job_number})' if job_number else ''}.</p>
        <p>We hope you're pleased with the results! Any questions at all,
        just get in touch.</p>
        <p>If you'd like to leave a review:
        <a href="https://www.gardnersgm.co.uk/testimonials" style="color:#2d6a4f;">Leave a review</a></p>
        <p>Thanks for choosing us.<br><strong>Chris</strong><br>Gardners Ground Maintenance</p>
        """

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

        subject = "Re: Your Enquiry"
        body_html = f"""
        <h2 style="color:#2d6a4f; margin-bottom:16px;">Thanks for Getting in Touch</h2>
        <p>Hi {name},</p>
        <p>Thank you for your enquiry. We've received your message and will
        get back to you as soon as possible, usually within 24 hours.</p>
        <p>In the meantime, you can browse our
        <a href="https://www.gardnersgm.co.uk/services" style="color:#2d6a4f;">services</a>
        or <a href="https://www.gardnersgm.co.uk/booking" style="color:#2d6a4f;">book online</a>.</p>
        <p>Cheers,<br><strong>Chris</strong><br>Gardners Ground Maintenance</p>
        """

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

            return {"success": True, "message": f"Reply sent to {name}"}

        except Exception as e:
            return {"success": False, "error": str(e)}

    def run_full_lifecycle(self, include_seasonal: bool = False) -> dict:
        """Trigger the full GAS email lifecycle processing."""
        try:
            result = self.api.post("process_email_lifecycle", {
                "includeSeasonal": include_seasonal,
            })

            # Log the run
            if isinstance(result, dict):
                total_sent = sum(
                    result.get(k, 0) for k in result
                    if isinstance(result.get(k), int) and k != "errors"
                )
                self.db.log_email_automation(
                    trigger_type="full_lifecycle",
                    client_id=0,
                    client_name="ALL",
                    client_email="",
                    email_type="lifecycle_batch",
                    status="sent",
                    gas_response=json.dumps(result),
                )

            return {"success": True, "result": result}

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

        if not email:
            return {"success": False, "error": "No email address on invoice"}

        pay_link = payment_url
        if not pay_link and stripe_id:
            pay_link = f"https://invoice.stripe.com/i/{stripe_id}"

        pay_button = ""
        if pay_link:
            pay_button = f"""
            <div style="text-align:center; margin:24px 0;">
                <a href="{pay_link}" style="display:inline-block; background-color:#2d6a4f;
                color:#ffffff; padding:14px 32px; text-decoration:none; border-radius:8px;
                font-weight:bold; font-size:16px;">&pound;{amount:,.2f} &mdash; Pay Now</a>
                <p style="margin:8px 0 0; font-size:12px; color:#636e72;">Secure payment via Stripe</p>
            </div>"""

        subject = f"Invoice {inv_number} \u2014 \u00a3{amount:,.2f}"
        body_html = f"""
        <h2 style="color:#2d6a4f; margin-bottom:16px;">Invoice {inv_number}</h2>
        <p>Hi {name},</p>
        <p>Please find your invoice for <strong>&pound;{amount:,.2f}</strong>.</p>
        {pay_button}
        <p>Any questions, just reply to this email.</p>
        <p>Thanks,<br><strong>Chris</strong><br>Gardners Ground Maintenance</p>
        """

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
        """Send a quote to a client by email."""
        name = quote.get("client_name", "")
        email = quote.get("client_email", "")
        total = quote.get("total", 0)
        quote_number = quote.get("quote_number", "")
        valid_until = quote.get("valid_until", "")
        items_json = quote.get("items", "[]")

        if not email:
            return {"success": False, "error": "No email address on quote"}

        # Parse items
        try:
            items = json.loads(items_json) if items_json else []
        except Exception:
            items = []

        items_html = ""
        if items:
            rows = ""
            for item in items:
                desc = item.get("description", item.get("service", "Service"))
                price = item.get("price", item.get("amount", 0))
                rows += f"""<tr>
                    <td style="padding:8px 12px; border-bottom:1px solid #e9ecef;">{desc}</td>
                    <td style="padding:8px 12px; border-bottom:1px solid #e9ecef; text-align:right;">&pound;{price:,.2f}</td>
                </tr>"""
            items_html = f"""
            <table width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0; border:1px solid #e9ecef; border-radius:6px;">
                <tr style="background-color:#f8f9fa;">
                    <th style="padding:10px 12px; text-align:left; font-size:13px;">Service</th>
                    <th style="padding:10px 12px; text-align:right; font-size:13px;">Price</th>
                </tr>
                {rows}
                <tr style="background-color:#2d6a4f;">
                    <td style="padding:10px 12px; color:#fff; font-weight:bold;">Total</td>
                    <td style="padding:10px 12px; color:#fff; font-weight:bold; text-align:right;">&pound;{total:,.2f}</td>
                </tr>
            </table>"""

        validity = f"<p>This quote is valid until <strong>{valid_until}</strong>.</p>" if valid_until else ""

        subject = f"Your Quote from Gardners Ground Maintenance \u2014 \u00a3{total:,.2f}"
        body_html = f"""
        <h2 style="color:#2d6a4f; margin-bottom:16px;">Your Quote {quote_number}</h2>
        <p>Hi {name},</p>
        <p>Thank you for your enquiry. We've put together a quote for you:</p>
        {items_html}
        {validity}
        <div style="text-align:center; margin:24px 0;">
            <a href="https://www.gardnersgm.co.uk/quote-response?q={quote_number}"
            style="display:inline-block; background-color:#2d6a4f; color:#ffffff;
            padding:12px 28px; text-decoration:none; border-radius:8px;
            font-weight:bold; font-size:15px;">Accept Quote</a>
            <p style="margin:8px 0 0; font-size:12px; color:#636e72;">
                Or reply to this email to discuss changes
            </p>
        </div>
        <p>If you have any questions or would like to adjust the scope,
        just reply to this email \u2014 we're happy to help.</p>
        <p>Best wishes,<br><strong>Chris</strong><br>Gardners Ground Maintenance</p>
        """

        try:
            if self.provider:
                result = self.provider.send(
                    to_email=email, to_name=name,
                    subject=subject, body_html=body_html,
                    email_type="quote_sent",
                    client_name=name,
                    skip_duplicate_check=True,
                )
                if result["success"]:
                    return {"success": True, "message": f"Quote emailed to {name}"}
                else:
                    return {"success": False, "error": result["error"]}
            else:
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

        status = {
            "running": self._running,
            "emails_today": today_count,
            "daily_cap": self._daily_cap,
            "pending_reminders": pending_reminders,
            "pending_completions": pending_completions,
            "pending_invoices": pending_invoices,
            "pending_follow_ups": pending_follow_ups,
            "check_interval": self._check_interval,
            "provider": "brevo+gas" if self.provider and self.provider._has_brevo else "gas",
            "lifecycle_stages": 9,
        }

        # Add delivery stats from provider
        if self.provider:
            try:
                status["delivery_stats"] = self.provider.get_delivery_stats()
            except Exception:
                pass

        return status
