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

    def __init__(self, db, api):
        self.db = db
        self.api = api
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

            try:
                # Call GAS to send the reminder
                result = self.api.post("process_email_lifecycle", {
                    "types": ["day_before_reminder"],
                    "targetDate": tomorrow,
                    "clientFilter": name,
                })

                # Log locally
                client_id = job.get("id", 0)
                self.db.log_email(
                    client_id=client_id,
                    client_name=name,
                    client_email=email,
                    email_type="day_before_reminder",
                    subject=f"Reminder: {service} tomorrow at {time_str}",
                    status="sent",
                    template_used="lifecycle_reminder",
                    notes=f"Auto-sent for {tomorrow}",
                )
                self.db.log_email_automation(
                    trigger_type="scheduled",
                    client_id=client_id,
                    client_name=name,
                    client_email=email,
                    email_type="day_before_reminder",
                    status="sent",
                    gas_response=json.dumps(result) if isinstance(result, dict) else str(result),
                )

                sent += 1
                log.info(f"Reminder sent to {name} for {tomorrow}")
                self._notify_listeners("reminder_sent", {"name": name, "date": tomorrow})

            except Exception as e:
                log.warning(f"Failed to send reminder to {name}: {e}")
                self.db.log_email_automation(
                    trigger_type="scheduled",
                    client_id=job.get("id", 0),
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

            try:
                result = self.api.post("send_completion_email", {
                    "name": name,
                    "email": email,
                    "service": service,
                    "jobNumber": job_number,
                })

                self.db.log_email(
                    client_id=job.get("id", 0),
                    client_name=name,
                    client_email=email,
                    email_type="job_complete",
                    subject=f"Job Complete: {service}",
                    status="sent",
                    template_used="completion_email",
                    notes=f"Auto-sent after completion",
                )
                self.db.log_email_automation(
                    trigger_type="job_complete",
                    client_id=job.get("id", 0),
                    client_name=name,
                    client_email=email,
                    email_type="job_complete",
                    status="sent",
                    gas_response=json.dumps(result) if isinstance(result, dict) else str(result),
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
                self.api.post("process_email_lifecycle", {
                    "types": ["day_before_reminder"],
                    "targetDate": target_date,
                    "clientFilter": name,
                })

                self.db.log_email(
                    client_id=job.get("id", 0),
                    client_name=name,
                    client_email=email,
                    email_type="day_before_reminder",
                    subject=f"Reminder: {service} on {target_date} at {time_str}",
                    status="sent",
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

        try:
            result = self.api.post("send_completion_email", {
                "name": name,
                "email": email,
                "service": service,
                "jobNumber": job_number,
            })

            self.db.log_email(
                client_id=job.get("id", 0),
                client_name=name,
                client_email=email,
                email_type="job_complete",
                subject=f"Job Complete: {service}",
                status="sent",
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

        try:
            result = self.api.post("send_enquiry_reply", {
                "name": name,
                "email": email,
                "message": message,
            })

            self.db.log_email(
                client_id=0,
                client_name=name,
                client_email=email,
                email_type="enquiry_received",
                subject=f"Re: Your Enquiry",
                status="sent",
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
        """Get current automation status."""
        today_count = self.db.get_todays_auto_email_count()
        tomorrow = (date.today() + timedelta(days=1)).isoformat()
        pending_reminders = len(self.db.get_jobs_needing_reminder(tomorrow))
        pending_completions = len(self.db.get_completed_jobs_needing_email(date.today().isoformat()))

        return {
            "running": self._running,
            "emails_today": today_count,
            "daily_cap": self._daily_cap,
            "pending_reminders": pending_reminders,
            "pending_completions": pending_completions,
            "check_interval": self._check_interval,
        }
