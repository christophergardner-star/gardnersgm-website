"""
GGM Hub — Email Provider
Reliable email delivery via Brevo (sole provider). Queues on failure.
Includes retry logic, duplicate prevention, delivery tracking, and daily caps.
"""

import json
import logging
import time
import re
from datetime import datetime, date
from typing import Optional

from . import config

log = logging.getLogger("ggm.email_provider")


# ──────────────────────────────────────────────────────────────────
# Constants
# ──────────────────────────────────────────────────────────────────

BREVO_API_URL = "https://api.brevo.com/v3/smtp/email"
FROM_NAME = "Gardners Ground Maintenance"
FROM_EMAIL = "info@gardnersgm.co.uk"
REPLY_TO = "enquiries@gardnersgm.co.uk"
MAX_RETRIES = 3
RETRY_BACKOFF = [2, 4, 8]  # seconds between retries
DAILY_CAP = 150  # aligned with config.EMAIL_DAILY_CAP (Brevo 5000/month)
NEWSLETTER_SPACING = 0.5  # seconds between newsletter sends


# ──────────────────────────────────────────────────────────────────
# Branded HTML Wrapper
# ──────────────────────────────────────────────────────────────────

def _wrap_branded_html(body_html: str, subject: str = "") -> str:
    """Wrap email body in the GGM professional branded template with logo."""
    logo_url = "https://raw.githubusercontent.com/christophergardner-star/gardnersgm-website/master/images/logo.png"
    return f"""<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0; padding:0; background-color:#f0f2f5; font-family:Georgia, 'Times New Roman', serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f0f2f5;">
<tr><td align="center" style="padding:24px 0;">
<table width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff; border-radius:12px; overflow:hidden; box-shadow:0 4px 20px rgba(0,0,0,0.08);">
  <!-- Logo + Header -->
  <tr><td style="background: linear-gradient(135deg, #2d6a4f 0%, #1b4332 100%); padding:28px 32px; text-align:center;">
    <img src="{logo_url}" alt="GGM" width="80" height="80"
         style="border-radius:50%; border:3px solid rgba(255,255,255,0.3); margin-bottom:12px; display:block; margin-left:auto; margin-right:auto;">
    <h1 style="margin:0; color:#ffffff; font-size:22px; font-weight:bold; letter-spacing:0.5px;">
      Gardners Ground Maintenance
    </h1>
    <p style="margin:6px 0 0; color:#a7d7c5; font-size:13px; font-style:italic;">Professional Garden Care in Cornwall</p>
  </td></tr>
  <!-- Body -->
  <tr><td style="padding:32px 32px 24px; color:#2d3436; font-size:15px; line-height:1.7;">
    {body_html}
  </td></tr>
  <!-- Personal sign-off -->
  <tr><td style="padding:0 32px 24px;">
    <table width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #e9ecef; padding-top:16px;">
    <tr>
      <td style="padding-top:16px;">
        <p style="margin:0; font-size:13px; color:#636e72; line-height:1.6;">
          <strong style="color:#2d6a4f;">Chris Gardner</strong><br>
          Owner &amp; Lead Gardener<br>
          <a href="tel:01726432051" style="color:#2d6a4f; text-decoration:none;">01726 432051</a><br>
          <a href="mailto:enquiries@gardnersgm.co.uk" style="color:#2d6a4f; text-decoration:none;">enquiries@gardnersgm.co.uk</a>
        </p>
      </td>
    </tr>
    </table>
  </td></tr>
  <!-- Footer -->
  <tr><td style="background-color:#f8f9fa; padding:20px 32px; border-top:1px solid #e9ecef;">
    <p style="margin:0 0 8px; font-size:12px; color:#636e72; text-align:center;">
      Gardners Ground Maintenance &middot; Roche, Cornwall PL26 8HN<br>
      <a href="https://www.gardnersgm.co.uk" style="color:#2d6a4f; text-decoration:none; font-weight:bold;">www.gardnersgm.co.uk</a>
    </p>
    <p style="margin:0; font-size:11px; color:#b2bec3; text-align:center;">
      You received this because you're a valued customer or subscriber.
      <a href="https://www.gardnersgm.co.uk/subscribe?action=unsubscribe" style="color:#b2bec3;">Unsubscribe</a>
    </p>
  </td></tr>
</table>
</td></tr></table>
</body></html>"""


# ──────────────────────────────────────────────────────────────────
# Email Provider
# ──────────────────────────────────────────────────────────────────

class EmailProvider:
    """
    Manages email delivery exclusively via Brevo.
    Failed emails are queued for retry — no GAS MailApp fallback.

    Usage:
        provider = EmailProvider(db, api)
        result = provider.send(
            to_email="john@example.com",
            to_name="John Smith",
            subject="Your appointment tomorrow",
            body_html="<p>Hi John...</p>",
            email_type="day_before_reminder",
            client_id=42,
        )
    """

    def __init__(self, db, api):
        self.db = db
        self.api = api  # GAS API client (data sync only, NOT email)
        self._brevo_key = getattr(config, "BREVO_API_KEY", "") or ""
        self._has_brevo = bool(self._brevo_key)

        if self._has_brevo:
            log.info("Email provider: Brevo (sole provider)")
        else:
            log.warning("Email provider: NO BREVO KEY — all emails will be queued. Add BREVO_API_KEY to .env")

    @property
    def provider_name(self) -> str:
        return "brevo" if self._has_brevo else "gas"

    # ------------------------------------------------------------------
    # Core Send
    # ------------------------------------------------------------------
    def send(
        self,
        to_email: str,
        to_name: str,
        subject: str,
        body_html: str,
        email_type: str = "general",
        client_id: int = 0,
        client_name: str = "",
        wrap_branded: bool = True,
        skip_duplicate_check: bool = False,
        notes: str = "",
        _from_queue: bool = False,
    ) -> dict:
        """
        Send a single email with retry and fallback.

        Returns: {success: bool, provider: str, message_id: str, error: str}
        """
        # Validate inputs
        if not to_email or not self._is_valid_email(to_email):
            return {"success": False, "provider": "", "message_id": "",
                    "error": f"Invalid email: {to_email}"}

        if not client_name:
            client_name = to_name

        # Duplicate check
        if not skip_duplicate_check:
            if self._is_duplicate(to_email, email_type):
                log.info(f"Skipping duplicate {email_type} to {to_email}")
                return {"success": True, "provider": "skipped",
                        "message_id": "", "error": "duplicate"}

        # Daily cap check
        if self._over_daily_cap():
            log.warning("Daily email cap reached — email queued")
            self._queue_email(to_email, to_name, subject, body_html,
                              email_type, client_id, client_name)
            return {"success": False, "provider": "queued",
                    "message_id": "", "error": "Daily cap reached"}

        # Wrap in branded template
        if wrap_branded:
            body_html = _wrap_branded_html(body_html, subject)

        # Send via Brevo (sole provider) — queue on failure
        result = {"success": False, "provider": "", "message_id": "", "error": ""}

        if self._has_brevo:
            result = self._send_brevo(to_email, to_name, subject, body_html)

        if not result["success"]:
            # Queue for retry ONLY if this isn't already a queue retry
            if not _from_queue:
                self._queue_email(to_email, to_name, subject, body_html,
                                  email_type, client_id, client_name)
            if not result["error"]:
                result["error"] = "Brevo unavailable — email queued for retry"
            log.warning("Email %s: %s to %s — %s",
                        "queued for retry" if not _from_queue else "FAILED (queue retry)",
                        email_type, to_email, result["error"])

        # Log the result
        status = "sent" if result["success"] else "failed"
        log_notes = notes if notes else result.get("error", "")
        self.db.log_email(
            client_id=client_id,
            client_name=client_name,
            client_email=to_email,
            email_type=email_type,
            subject=subject,
            status=status,
            template_used=result["provider"],
            provider=result.get("provider", ""),
            message_id=result.get("message_id", ""),
            notes=log_notes,
        )

        if result["success"]:
            log.info(f"Email sent via {result['provider']}: {email_type} to {to_email}")
        else:
            log.warning(f"Email FAILED: {email_type} to {to_email} — {result['error']}")
            # Add notification for failed emails
            try:
                self.db.add_notification(
                    ntype="email_failed",
                    title=f"Email failed: {subject[:50]}",
                    message=f"To: {to_email}. Error: {result['error'][:100]}",
                    icon="\u26a0\ufe0f",
                )
            except Exception:
                pass

        return result

    # ------------------------------------------------------------------
    # Newsletter Bulk Send
    # ------------------------------------------------------------------
    def send_newsletter(
        self,
        subject: str,
        body_html: str,
        subscribers: list[dict],
        preview_to: str = FROM_EMAIL,
    ) -> dict:
        """
        Send a newsletter to all active subscribers.

        1. Sends preview to Chris first
        2. Then sends to all subscribers with spacing

        Returns: {sent: int, failed: int, skipped: int, preview_sent: bool}
        """
        results = {"sent": 0, "failed": 0, "skipped": 0, "preview_sent": False}

        # Step 1: Send preview to Chris
        if preview_to:
            preview = self.send(
                to_email=preview_to,
                to_name="Chris (Preview)",
                subject=f"[PREVIEW] {subject}",
                body_html=body_html,
                email_type="newsletter_preview",
                skip_duplicate_check=True,
            )
            results["preview_sent"] = preview["success"]
            if preview["success"]:
                log.info(f"Newsletter preview sent to {preview_to}")
            else:
                log.warning(f"Preview failed: {preview['error']}")

        # Step 2: Send to subscribers
        for sub in subscribers:
            email = sub.get("email", "")
            name = sub.get("name", "Subscriber")
            status = sub.get("status", "active")

            if status != "active" or not email:
                results["skipped"] += 1
                continue

            result = self.send(
                to_email=email,
                to_name=name,
                subject=subject,
                body_html=body_html,
                email_type="newsletter",
                client_name=name,
                skip_duplicate_check=True,  # newsletters are OK to resend
            )

            if result["success"]:
                results["sent"] += 1
            else:
                results["failed"] += 1

            # Spacing to avoid rate limits
            time.sleep(NEWSLETTER_SPACING)

        log.info(f"Newsletter complete: {results['sent']} sent, "
                 f"{results['failed']} failed, {results['skipped']} skipped")

        return results

    # ------------------------------------------------------------------
    # Send Preview Only
    # ------------------------------------------------------------------
    def send_preview(self, subject: str, body_html: str,
                     preview_to: str = FROM_EMAIL) -> dict:
        """Send a preview email to Chris for review before bulk send."""
        return self.send(
            to_email=preview_to,
            to_name="Chris (Preview)",
            subject=f"[PREVIEW] {subject}",
            body_html=body_html,
            email_type="newsletter_preview",
            skip_duplicate_check=True,
        )

    # ------------------------------------------------------------------
    # Brevo SMTP API
    # ------------------------------------------------------------------
    def _send_brevo(self, to_email: str, to_name: str,
                    subject: str, body_html: str) -> dict:
        """Send via Brevo SMTP API with retries."""
        import requests

        # Validate required fields — Brevo returns 400 missing_parameter if empty
        if not subject or not subject.strip():
            return {"success": False, "provider": "brevo", "message_id": "",
                    "error": "Empty subject — cannot send via Brevo"}
        if not body_html or not body_html.strip():
            return {"success": False, "provider": "brevo", "message_id": "",
                    "error": "Empty body — cannot send via Brevo"}

        # Brevo requires a non-empty name in the "to" field
        if not to_name or not to_name.strip():
            to_name = to_email.split("@")[0].replace(".", " ").title()

        payload = {
            "sender": {"name": FROM_NAME, "email": FROM_EMAIL},
            "to": [{"email": to_email, "name": to_name}],
            "replyTo": {"email": REPLY_TO, "name": FROM_NAME},
            "subject": subject,
            "htmlContent": body_html,
        }

        headers = {
            "accept": "application/json",
            "content-type": "application/json",
            "api-key": self._brevo_key,
        }

        for attempt in range(MAX_RETRIES):
            try:
                resp = requests.post(
                    BREVO_API_URL, json=payload, headers=headers, timeout=30
                )

                if resp.status_code in (200, 201):
                    data = resp.json()
                    message_id = data.get("messageId", "")
                    return {"success": True, "provider": "brevo",
                            "message_id": message_id, "error": ""}

                error = f"Brevo HTTP {resp.status_code}: {resp.text[:200]}"
                log.warning(f"Brevo attempt {attempt + 1} failed: {error}")

            except Exception as e:
                error = str(e)
                log.warning(f"Brevo attempt {attempt + 1} error: {e}")

            # Backoff before retry
            if attempt < MAX_RETRIES - 1:
                time.sleep(RETRY_BACKOFF[attempt])

        return {"success": False, "provider": "brevo", "message_id": "", "error": error}

    # ------------------------------------------------------------------
    # GAS Fallback
    # ------------------------------------------------------------------
    def _send_gas(self, to_email: str, to_name: str, subject: str,
                  body_html: str, email_type: str, client_name: str) -> dict:
        """Send via GAS MailApp as fallback."""
        if not self.api:
            return {"success": False, "provider": "gas",
                    "message_id": "", "error": "No GAS API configured"}

        for attempt in range(MAX_RETRIES):
            try:
                result = self.api.post("send_email", {
                    "to": to_email,
                    "name": to_name or client_name,
                    "subject": subject,
                    "htmlBody": body_html,
                    "emailType": email_type,
                })

                if isinstance(result, dict) and result.get("error"):
                    error = result["error"]
                    log.warning(f"GAS attempt {attempt + 1} failed: {error}")
                else:
                    return {"success": True, "provider": "gas",
                            "message_id": "", "error": ""}

            except Exception as e:
                error = str(e)
                log.warning(f"GAS attempt {attempt + 1} error: {e}")

            if attempt < MAX_RETRIES - 1:
                time.sleep(RETRY_BACKOFF[attempt])

        return {"success": False, "provider": "gas", "message_id": "", "error": error}

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------
    def _is_valid_email(self, email: str) -> bool:
        """Basic email format validation."""
        return bool(re.match(r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$', email))

    # Email types that are allowed to repeat (scheduled reminders & newsletters)
    _REPEATABLE_TYPES = frozenset({
        "day_before_reminder", "newsletter", "cancellation", "reschedule",
        "admin_payment_notification",
    })

    def _is_duplicate(self, to_email: str, email_type: str) -> bool:
        """Check if this email type was already sent to this recipient.

        Repeatable types (reminders, newsletters): blocked only if already
        sent *today* — they're designed to send on a schedule.

        All other types (marketing, lifecycle, transactional one-offs):
        blocked if *ever* sent successfully — prevents repeat promotional,
        seasonal-tips, referral, follow-up, etc. from re-firing after their
        DB query time-window rolls forward.
        """
        # Also match the GAS hyphenated variant (e.g. payment_received / payment-received)
        alt_type = email_type.replace("_", "-")
        email_lower = to_email.lower() if to_email else ""
        try:
            if email_type in self._REPEATABLE_TYPES:
                # Same-day guard only
                today = date.today().isoformat()
                row = self.db.fetchone(
                    """SELECT COUNT(*) as c FROM email_tracking
                       WHERE LOWER(client_email) = ? AND email_type IN (?, ?)
                       AND sent_at >= ? AND status IN ('sent', 'Sent')""",
                    (email_lower, email_type, alt_type, today)
                )
            else:
                # Lifetime guard — never send the same type twice to one person
                row = self.db.fetchone(
                    """SELECT COUNT(*) as c FROM email_tracking
                       WHERE LOWER(client_email) = ? AND email_type IN (?, ?)
                       AND status IN ('sent', 'Sent')""",
                    (email_lower, email_type, alt_type)
                )
            return row["c"] > 0 if row else False
        except Exception:
            return False

    def _over_daily_cap(self) -> bool:
        """Check if we've hit the daily email cap."""
        try:
            count = self.db.get_todays_auto_email_count()
            return count >= DAILY_CAP
        except Exception:
            return False

    def _queue_email(self, to_email: str, to_name: str, subject: str,
                     body_html: str, email_type: str, client_id: int,
                     client_name: str):
        """Queue an email for later delivery (when cap resets)."""
        try:
            self.db.execute(
                """INSERT INTO email_queue (to_email, to_name, subject, body_html,
                   email_type, client_id, client_name, status, created_at, priority)
                   VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, 5)""",
                (to_email, to_name, subject, body_html, email_type,
                 client_id, client_name, datetime.now().isoformat())
            )
            self.db.commit()
            log.info(f"Email queued: {email_type} to {to_email}")
        except Exception as e:
            log.warning(f"Failed to queue email: {e}")

    def process_queue(self, max_send: int = 20):
        """Process pending queued emails. Called from the automation loop."""
        if self._over_daily_cap():
            return

        try:
            pending = self.db.fetchall(
                """SELECT * FROM email_queue
                   WHERE status = 'pending'
                   ORDER BY priority ASC, created_at ASC
                   LIMIT ?""",
                (max_send,)
            )
        except Exception:
            return

        for item in pending:
            retries = item.get("retry_count", 0)

            # Give up after 5 retries
            if retries >= 5:
                try:
                    self.db.execute(
                        """UPDATE email_queue SET status = 'abandoned',
                           last_attempt = ? WHERE id = ?""",
                        (datetime.now().isoformat(), item["id"])
                    )
                    self.db.commit()
                    log.warning("Email queue item %s abandoned after %d retries: %s to %s",
                                item["id"], retries, item["email_type"], item["to_email"])
                except Exception:
                    pass
                continue

            result = self.send(
                to_email=item["to_email"],
                to_name=item["to_name"],
                subject=item["subject"],
                body_html=item["body_html"],
                email_type=item["email_type"],
                client_id=item.get("client_id", 0),
                client_name=item.get("client_name", ""),
                wrap_branded=False,  # already wrapped when queued
                skip_duplicate_check=True,
                _from_queue=True,
            )

            status = "sent" if result["success"] else "pending"
            retries += 1

            try:
                self.db.execute(
                    """UPDATE email_queue SET status = ?, retry_count = ?,
                       last_attempt = ? WHERE id = ?""",
                    (status, retries, datetime.now().isoformat(), item["id"])
                )
                self.db.commit()
            except Exception:
                pass

    # ------------------------------------------------------------------
    # Delivery Stats
    # ------------------------------------------------------------------
    def get_delivery_stats(self, days: int = 7) -> dict:
        """Get email delivery statistics for the overview dashboard."""
        try:
            cutoff = (date.today() - __import__("datetime").timedelta(days=days)).isoformat()

            total = self.db.fetchone(
                "SELECT COUNT(*) as c FROM email_tracking WHERE sent_at >= ?",
                (cutoff,)
            )
            sent_ok = self.db.fetchone(
                "SELECT COUNT(*) as c FROM email_tracking WHERE sent_at >= ? AND LOWER(status) = 'sent'",
                (cutoff,)
            )
            failed = self.db.fetchone(
                "SELECT COUNT(*) as c FROM email_tracking WHERE sent_at >= ? AND LOWER(status) = 'failed'",
                (cutoff,)
            )

            total_count = total["c"] if total else 0
            sent_count = sent_ok["c"] if sent_ok else 0
            failed_count = failed["c"] if failed else 0

            delivery_rate = (sent_count / total_count * 100) if total_count > 0 else 100.0

            # Today's count
            today = date.today().isoformat()
            today_row = self.db.fetchone(
                "SELECT COUNT(*) as c FROM email_tracking WHERE sent_at >= ?",
                (today,)
            )
            today_failed = self.db.fetchone(
                "SELECT COUNT(*) as c FROM email_tracking WHERE sent_at >= ? AND LOWER(status) = 'failed'",
                (today,)
            )

            return {
                "total_7d": total_count,
                "sent_7d": sent_count,
                "failed_7d": failed_count,
                "delivery_rate": round(delivery_rate, 1),
                "today_sent": today_row["c"] if today_row else 0,
                "today_failed": today_failed["c"] if today_failed else 0,
                "provider": self.provider_name,
                "daily_cap": DAILY_CAP,
            }
        except Exception as e:
            log.warning(f"Failed to get delivery stats: {e}")
            return {
                "total_7d": 0, "sent_7d": 0, "failed_7d": 0,
                "delivery_rate": 100.0, "today_sent": 0, "today_failed": 0,
                "provider": self.provider_name, "daily_cap": DAILY_CAP,
            }

    def health_check(self) -> dict:
        """Check email provider health. Returns {ok: bool, provider: str, error: str}."""
        if self._has_brevo:
            try:
                import requests
                resp = requests.get(
                    "https://api.brevo.com/v3/account",
                    headers={"api-key": self._brevo_key},
                    timeout=10,
                )
                if resp.status_code == 200:
                    data = resp.json()
                    plan = data.get("plan", [{}])
                    credits_left = plan[0].get("credits", "unknown") if plan else "unknown"
                    return {"ok": True, "provider": "brevo",
                            "error": "", "credits": credits_left}
                else:
                    return {"ok": False, "provider": "brevo",
                            "error": f"HTTP {resp.status_code}"}
            except Exception as e:
                return {"ok": False, "provider": "brevo", "error": str(e)}
        else:
            # GAS is always "ok" — we can't health-check it easily
            return {"ok": True, "provider": "gas", "error": "",
                    "credits": "unlimited (GAS daily limit applies)"}
