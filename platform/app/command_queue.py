"""
GGM Hub — Remote Command Queue
Enables the laptop node to trigger heavy actions on the PC node.

How it works:
  1. Laptop writes a command to the GAS webhook (action=queue_remote_command)
  2. PC node polls for pending commands during its sync cycle
  3. PC executes the command (blog, newsletter, email, etc.)
  4. PC marks the command as complete via GAS

Commands are stored in a 'RemoteCommands' sheet in Google Sheets,
making it available to both nodes without direct networking.
"""

import json
import logging
import threading
import time
from datetime import datetime

log = logging.getLogger("ggm.commands")


# ──────────────────────────────────────────────────────────────────
# Command types the laptop can trigger
# ──────────────────────────────────────────────────────────────────
COMMAND_TYPES = {
    "generate_blog":       "Generate a new blog post using AI",
    "generate_newsletter": "Generate and send the monthly newsletter",
    "send_reminders":      "Send day-before reminders for tomorrow's jobs",
    "send_completion":     "Send job completion email for a specific job",
    "send_enquiry_reply":  "Reply to a customer enquiry",
    "send_booking_confirmation": "Send booking confirmation email to client",
    "send_quote_email":    "Send a quote/estimate email to a prospect",
    "run_email_lifecycle": "Run the full email lifecycle engine",
    "force_sync":          "Force an immediate full data sync",
    "run_agent":           "Run a specific AI agent by ID",
    "send_invoice":        "Send an invoice email to a client",
}


class CommandQueue:
    """
    Manages the remote command queue.
    Used by the PC node to poll and execute commands.
    """

    def __init__(self, api, db, sync=None, agent_scheduler=None,
                 email_engine=None, content_writer=None):
        self.api = api
        self.db = db
        self.sync = sync
        self.agent_scheduler = agent_scheduler
        self.email_engine = email_engine
        self._running = False
        self._thread = None
        self._poll_interval = 60  # check every 60 seconds

    def start(self):
        """Start polling for remote commands (PC node only)."""
        self._running = True
        self._thread = threading.Thread(
            target=self._poll_loop, daemon=True, name="CommandQueue"
        )
        self._thread.start()
        log.info("Remote command queue started (polling every %ds)", self._poll_interval)

    def stop(self):
        """Stop polling."""
        self._running = False
        if self._thread:
            self._thread.join(timeout=5)
        log.info("Remote command queue stopped")

    def _poll_loop(self):
        """Background loop — polls GAS for pending commands."""
        time.sleep(10)  # let other services start first
        while self._running:
            try:
                self._process_pending()
            except Exception as e:
                log.error(f"Command queue error: {e}")
            time.sleep(self._poll_interval)

    def _process_pending(self):
        """Fetch and execute any pending commands."""
        try:
            resp = self.api.get(action="get_remote_commands", params={"status": "pending"})
            commands = resp if isinstance(resp, list) else resp.get("commands", [])
        except Exception as e:
            log.debug(f"No pending commands (or endpoint not ready): {e}")
            return

        for cmd in commands:
            cmd_id = cmd.get("id", "")
            cmd_type = cmd.get("command", "")
            cmd_data = cmd.get("data", "{}")
            source = cmd.get("source", "laptop")

            log.info(f"Executing remote command: {cmd_type} (from {source})")

            try:
                if isinstance(cmd_data, str):
                    cmd_data = json.loads(cmd_data) if cmd_data else {}
            except json.JSONDecodeError:
                cmd_data = {}

            try:
                result = self._execute(cmd_type, cmd_data)
                self._mark_complete(cmd_id, "completed", result)
                log.info(f"Command {cmd_type} completed: {result}")
            except Exception as e:
                self._mark_complete(cmd_id, "failed", str(e))
                log.error(f"Command {cmd_type} failed: {e}")

    def _execute(self, cmd_type: str, data: dict) -> str:
        """Execute a single command. Returns result message."""

        if cmd_type == "generate_blog":
            from .content_writer import generate_blog_post
            topic = data.get("topic")
            result = generate_blog_post(topic=topic)
            if result.get("error"):
                raise Exception(result["error"])
            # Save as draft
            self.db.save_blog_post({
                "title": result["title"],
                "content": result["content"],
                "category": result.get("category", "Lawn Care"),
                "excerpt": result.get("excerpt", ""),
                "tags": result.get("tags", ""),
                "status": "Draft",
                "author": "AI / Gardners GM",
            })
            # Push to website
            try:
                self.api.post(action="save_blog_post", **{
                    "title": result["title"],
                    "content": result["content"],
                    "category": result.get("category", ""),
                    "status": "Draft",
                })
            except Exception:
                pass
            return f"Blog draft created: {result['title']}"

        elif cmd_type == "generate_newsletter":
            from .content_writer import generate_newsletter
            audience = data.get("audience", "all")
            result = generate_newsletter(audience=audience)
            if result.get("error"):
                raise Exception(result["error"])
            # Store as draft for review
            self.db.set_setting("draft_newsletter_subject", result["subject"])
            self.db.set_setting("draft_newsletter_body",
                                result.get("body_text") or result.get("body_html", ""))
            return f"Newsletter drafted: {result['subject']}"

        elif cmd_type == "send_reminders":
            if self.email_engine:
                target = data.get("date")
                if target:
                    count = self.email_engine.send_reminder_for_date(target)
                else:
                    count = self.email_engine.send_reminder_for_date(
                        (datetime.now().strftime("%Y-%m-%d"))
                    )
                return f"Sent {count} reminder(s)"
            return "Email engine not available"

        elif cmd_type == "send_completion":
            job_data = data.get("job", {})
            if self.email_engine and job_data:
                self.email_engine.send_completion_email_for_job(job_data)
                return f"Completion email sent for {job_data.get('name', 'job')}"
            return "No job data or email engine not available"

        elif cmd_type == "send_enquiry_reply":
            enquiry = data.get("enquiry", {})
            if self.email_engine and enquiry:
                self.email_engine.send_enquiry_reply(enquiry)
                return f"Enquiry reply sent to {enquiry.get('name', 'customer')}"
            return "No enquiry data or email engine not available"

        elif cmd_type == "send_booking_confirmation":
            booking = data.get("booking", {})
            if self.email_engine and booking:
                self.email_engine.send_booking_confirmation(booking)
                return f"Booking confirmation sent to {booking.get('name', booking.get('clientName', 'client'))}"
            # Fallback: try via GAS directly
            if booking:
                try:
                    self.api.post(action="send_booking_confirmation_email", **booking)
                    return f"Booking confirmation sent via GAS"
                except Exception:
                    pass
            return "No booking data or email engine not available"

        elif cmd_type == "send_quote_email":
            enquiry = data.get("enquiry", {})
            if self.email_engine and enquiry:
                self.email_engine.send_quote_email(enquiry)
                return f"Quote sent to {enquiry.get('name', enquiry.get('clientName', 'client'))}"
            # Fallback: try via GAS
            if enquiry:
                try:
                    self.api.post(action="send_quote_email", **enquiry)
                    return f"Quote sent via GAS"
                except Exception:
                    pass
            return "No enquiry data or email engine not available"

        elif cmd_type == "run_email_lifecycle":
            if self.email_engine:
                self.email_engine.run_full_lifecycle(
                    include_seasonal=data.get("include_seasonal", False)
                )
                return "Email lifecycle run triggered"
            return "Email engine not available"

        elif cmd_type == "force_sync":
            if self.sync:
                self.sync.force_sync()
                return "Full sync triggered"
            return "Sync engine not available"

        elif cmd_type == "run_agent":
            agent_id = data.get("agent_id")
            if self.agent_scheduler and agent_id:
                self.agent_scheduler.run_agent_now(agent_id)
                return f"Agent {agent_id} triggered"
            return "No agent ID or scheduler not available"

        elif cmd_type == "send_invoice":
            invoice_id = data.get("invoice_id")
            if invoice_id:
                self.api.post(action="send_invoice_email", invoice_id=invoice_id)
                return f"Invoice {invoice_id} sent"
            return "No invoice ID"

        else:
            return f"Unknown command: {cmd_type}"

    def _mark_complete(self, cmd_id: str, status: str, result: str):
        """Mark a command as complete/failed in GAS."""
        try:
            self.api.post(
                action="update_remote_command",
                data={
                    "id": cmd_id,
                    "status": status,
                    "result": result[:500],
                    "completed_at": datetime.now().isoformat(),
                },
            )
        except Exception as e:
            log.warning(f"Could not update command status: {e}")


# ──────────────────────────────────────────────────────────────────
# Client-side (laptop) — send commands
# ──────────────────────────────────────────────────────────────────

def send_command(api, command: str, data: dict = None, source: str = "laptop") -> dict:
    """
    Send a command to the PC node via GAS.
    Returns the response dict.
    """
    try:
        resp = api.post(
            action="queue_remote_command",
            data={
                "command": command,
                "data": json.dumps(data or {}),
                "source": source,
                "created_at": datetime.now().isoformat(),
            },
        )
        return {"success": True, "message": f"Command '{command}' queued", "response": resp}
    except Exception as e:
        return {"success": False, "message": str(e)}
