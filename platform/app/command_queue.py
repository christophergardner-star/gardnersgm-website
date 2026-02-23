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
# Command types — PC Hub receives from laptop
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

# ──────────────────────────────────────────────────────────────────
# Command types — Laptop receives from PC Hub
# ──────────────────────────────────────────────────────────────────
LAPTOP_COMMAND_TYPES = {
    "ping":              "Check if laptop is online — responds with pong + version",
    "force_refresh":     "Clear cache and refresh the active tab",
    "show_notification": "Show a popup notification on the laptop",
    "show_alert":        "Show a blocking alert dialog on the laptop",
    "git_pull":          "Trigger a git pull to get latest code",
    "clear_cache":       "Clear all cached API data",
    "switch_tab":        "Switch to a specific tab",
    "force_sync":        "Full cache clear + refresh",
    "send_data":         "Push data directly into laptop cache",
    "update_status":     "Update the laptop status bar message",
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
        self._processed_ids = set()  # dedup guard
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
            resp = self.api.get(action="get_remote_commands",
                               params={"status": "pending", "target": "pc_hub"})
            commands = resp if isinstance(resp, list) else resp.get("commands", [])
        except Exception as e:
            log.debug(f"No pending commands (or endpoint not ready): {e}")
            return

        for cmd in commands:
            cmd_id = cmd.get("id", "")
            cmd_type = cmd.get("command", "")
            cmd_data = cmd.get("data", "{}")
            source = cmd.get("source", "laptop")

            # Dedup guard — skip commands we've already processed this session
            if cmd_id in self._processed_ids:
                log.debug(f"Skipping already-processed command: {cmd_id} ({cmd_type})")
                continue
            self._processed_ids.add(cmd_id)

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
                self._notify_telegram(cmd_type, "completed", result, source)
            except Exception as e:
                self._mark_complete(cmd_id, "failed", str(e))
                log.error(f"Command {cmd_type} failed: {e}")
                self._notify_telegram(cmd_type, "failed", str(e), source)

    def _execute(self, cmd_type: str, data: dict) -> str:
        """Execute a single command. Returns result message."""

        if cmd_type == "generate_blog":
            from .content_writer import generate_blog_post
            from .agents import fetch_pexels_image, send_approval_request
            topic = data.get("topic")
            persona_key = data.get("persona")  # optional: force a persona
            result = generate_blog_post(topic=topic, persona_key=persona_key)
            if result.get("error"):
                raise Exception(result["error"])

            author = result.get("author", "Chris")
            p_key = result.get("persona_key", "")

            # Auto-fetch matching stock image (persona-aware)
            image_data = fetch_pexels_image(result["title"], persona_key=p_key)
            image_url = image_data.get("url", "")

            # Save as draft
            self.db.save_blog_post({
                "title": result["title"],
                "content": result["content"],
                "category": result.get("category", "Lawn Care"),
                "excerpt": result.get("excerpt", ""),
                "tags": result.get("tags", ""),
                "image_url": image_url,
                "status": "Draft",
                "author": author,
            })
            # Push to website as draft
            try:
                self.api.post("save_blog_post", {
                    "title": result["title"],
                    "content": result["content"],
                    "category": result.get("category", ""),
                    "imageUrl": image_url,
                    "status": "Draft",
                })
            except Exception:
                pass

            # Send Telegram approval request
            send_approval_request(
                self.api, "blog", result["title"],
                result.get("excerpt", ""), image_url=image_url,
                author=author,
            )
            return f"Blog draft by {author}: {result['title']}"

        elif cmd_type == "generate_newsletter":
            from .content_writer import generate_newsletter, _current_season
            from .agents import fetch_pexels_image, send_approval_request
            audience = data.get("audience", "all")
            result = generate_newsletter(audience=audience)
            if result.get("error"):
                raise Exception(result["error"])
            body_html = result.get("body_html", "")
            body_text = result.get("body_text", body_html)

            # Auto-fetch seasonal hero image for newsletter
            season = _current_season()
            nl_image = fetch_pexels_image(
                f"{season} cornwall garden",
                fallback_query="cornwall garden flowers",
            )
            nl_image_url = nl_image.get("url", "")

            # Store as draft for review
            self.db.set_setting("draft_newsletter_subject", result["subject"])
            self.db.set_setting("draft_newsletter_body", body_text)
            self.db.set_setting("draft_newsletter_html", body_html)
            if nl_image_url:
                self.db.set_setting("draft_newsletter_image", nl_image_url)

            # Send Telegram approval request
            send_approval_request(
                self.api, "newsletter", result["subject"],
                body_text[:200] if body_text else "",
                image_url=nl_image_url,
            )
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
                    self.api.post("send_booking_confirmation", booking)
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
                    self.api.post("send_enquiry_reply", enquiry)
                    return f"Quote sent via GAS"
                except Exception:
                    pass
            return "No enquiry data or email engine not available"

        elif cmd_type == "run_email_lifecycle":
            if self.email_engine:
                inc_seasonal = data.get("include_seasonal", False) or data.get("includeSeasonal", False)
                result = self.email_engine.run_full_lifecycle(
                    include_seasonal=inc_seasonal
                )
                total = result.get("total_sent", 0) if isinstance(result, dict) else 0
                return f"Email lifecycle complete — {total} emails sent"
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
                self.api.post("send_invoice_email", {"invoice_id": invoice_id})
                return f"Invoice {invoice_id} sent"
            return "No invoice ID"

        elif cmd_type == "post_to_facebook":
            from .social_poster import post_blog_to_facebook, is_facebook_configured
            if not is_facebook_configured():
                return "Facebook not configured (set FB_PAGE_ACCESS_TOKEN and FB_PAGE_ID in .env)"

            title = data.get("title", "")
            excerpt = data.get("excerpt", "")
            image_url = data.get("image_url", "")
            tags = data.get("tags", "")
            blog_url = data.get("blog_url", "")

            # If no title given, find the latest published blog post
            if not title:
                try:
                    row = self.db.conn.execute(
                        "SELECT title, image_url, tags FROM blog_posts "
                        "WHERE status = 'Published' ORDER BY created_at DESC LIMIT 1"
                    ).fetchone()
                    if row:
                        title = row[0] or ""
                        image_url = image_url or (row[1] or "")
                        tags = tags or (row[2] or "")
                except Exception:
                    pass
            if not title:
                return "No blog post to share — publish one first"

            # Build URL from title
            if not blog_url:
                slug = "".join(c if c.isalnum() or c == " " else "" for c in title.lower())
                slug = slug.strip().replace("  ", " ").replace(" ", "-")[:60]
                blog_url = f"https://www.gardnersgm.co.uk/blog.html#{slug}"

            result = post_blog_to_facebook(
                title=title, excerpt=excerpt,
                blog_url=blog_url, image_url=image_url, tags=tags,
            )
            if result.get("success"):
                return f"Posted to Facebook: {result.get('post_id', '')}"
            return f"Facebook post failed: {result.get('error', 'Unknown error')}"

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

    def _notify_telegram(self, cmd_type: str, status: str, result: str, source: str):
        """Send a Telegram notification about command execution result."""
        try:
            icon = "✅" if status == "completed" else "❌"
            msg = (
                f"{icon} *PC Hub Command {status.title()}*\n"
                f"Command: `{cmd_type}`\n"
                f"Source: {source}\n"
                f"Result: {result[:200]}"
            )
            self.api.post("relay_telegram", {
                "text": msg,
                "parse_mode": "Markdown",
            })
        except Exception as e:
            log.debug(f"Telegram notification skipped: {e}")


# ──────────────────────────────────────────────────────────────────
# Client-side — send commands between nodes
# ──────────────────────────────────────────────────────────────────

def send_command(api, command: str, data: dict = None, source: str = "laptop",
                 target: str = "pc_hub") -> dict:
    """
    Send a command to a target node via GAS.
    Returns the response dict.
    """
    try:
        resp = api.post(
            action="queue_remote_command",
            data={
                "command": command,
                "data": json.dumps(data or {}),
                "source": source,
                "target": target,
                "created_at": datetime.now().isoformat(),
            },
        )
        return {"success": True, "message": f"Command '{command}' queued", "response": resp}
    except Exception as e:
        return {"success": False, "message": str(e)}


def send_to_laptop(api, command: str, data: dict = None) -> dict:
    """
    Send a command FROM PC Hub TO the laptop (Node 2).
    The laptop polls every 15 seconds and executes immediately.

    Supported commands:
      - ping               → Laptop responds with pong + version
      - force_refresh      → Clear cache and refresh active tab
      - show_notification  → Show a popup: data={title, message}
      - show_alert         → Show a blocking alert: data={message}
      - git_pull           → Trigger git pull on laptop
      - clear_cache        → Clear all cached API data
      - switch_tab         → Switch to a tab: data={tab: "dashboard"}
      - force_sync         → Full cache clear + refresh
      - send_data          → Push data to cache: data={action, payload}
      - update_status      → Update status bar: data={message}
    """
    return send_command(
        api, command, data,
        source="pc_hub", target="field_laptop"
    )
