"""
Email Automation Engine for GGM Hub.
Handles lifecycle emails: reminders, completion emails, follow-ups, and more.
Triggers emails through GAS webhook and logs everything locally.
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
    Background engine that automatically triggers lifecycle emails.
    Works hand-in-hand with the GAS processEmailLifecycle action.

    Capabilities:
    - Send day-before reminders for tomorrow's jobs
    - Send completion emails after jobs are marked complete
    - Send enquiry auto-replies
    - Trigger full GAS email lifecycle processing
    - Log all automated emails locally
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

        # Only run specific checks at certain times
        now = datetime.now()
        hour = now.hour

        # Day-before reminders: check at 5pm-7pm (send for tomorrow)
        if 17 <= hour <= 19:
            sent = self._send_day_before_reminders(max_send=min(remaining, 15))
            remaining -= sent

        # Completion emails: check throughout working hours
        if 8 <= hour <= 20 and remaining > 0:
            sent = self._send_completion_emails(max_send=min(remaining, 10))
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

    # ------------------------------------------------------------------
    # Status
    # ------------------------------------------------------------------
    def get_status(self) -> dict:
        """Get current automation status including delivery stats."""
        today_count = self.db.get_todays_auto_email_count()
        tomorrow = (date.today() + timedelta(days=1)).isoformat()
        pending_reminders = len(self.db.get_jobs_needing_reminder(tomorrow))
        pending_completions = len(self.db.get_completed_jobs_needing_email(date.today().isoformat()))

        status = {
            "running": self._running,
            "emails_today": today_count,
            "daily_cap": self._daily_cap,
            "pending_reminders": pending_reminders,
            "pending_completions": pending_completions,
            "check_interval": self._check_interval,
            "provider": "brevo+gas" if self.provider and self.provider._has_brevo else "gas",
        }

        # Add delivery stats from provider
        if self.provider:
            try:
                status["delivery_stats"] = self.provider.get_delivery_stats()
            except Exception:
                pass

        return status
