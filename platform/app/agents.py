"""
Agent Scheduler Engine for GGM Hub.
Manages AI agents that write blogs, newsletters, etc. on a schedule.
Uses local Ollama for content generation — runs entirely on your machine.

Content generation routes through content_writer.py for brand voice,
anti-drift sanitisation, and consistent output formatting.

Workflow:
  1. Agent generates content on schedule
  2. Auto-fetches a matching Pexels stock image
  3. Sends Telegram message with APPROVE / REJECT buttons
  4. Content stays as Draft until approved via Telegram or Hub UI
"""

import json
import logging
import os
import re
import random
import threading
import time
import requests
from datetime import datetime, timedelta

from . import config

log = logging.getLogger("ggm.agents")


# ──────────────────────────────────────────────────────────────────
# Backward-compat LLM helpers
# ──────────────────────────────────────────────────────────────────

def ollama_generate(prompt: str, system: str = "", max_tokens: int = 2000) -> str:
    """Generate text via the best available LLM (auto-detected)."""
    from . import llm
    return llm.generate(prompt, system=system, max_tokens=max_tokens)


def is_ollama_available() -> bool:
    """Check if any LLM is available."""
    from . import llm
    return llm.is_available()


# ──────────────────────────────────────────────────────────────────
# Pexels Stock Image Fetcher
# ──────────────────────────────────────────────────────────────────

# Topic  →  Pexels search terms  (specific queries get better results)
IMAGE_SEARCH_MAP = {
    # Lawn / grass
    "lawn": "green lawn grass garden uk",
    "mowing": "lawn mowing freshly cut grass",
    "grass": "green lawn garden",
    "scarifying": "lawn scarifying rake grass",
    "aeration": "lawn aeration garden",
    "lawn treatment": "lawn care treatment green grass",
    # Hedges
    "hedge": "trimmed hedge garden green",
    "hedges": "trimmed hedge garden green",
    "hedge trimming": "hedge trimming professional garden",
    "pruning": "pruning garden shears hedge",
    # Garden
    "garden clearance": "garden clearance tidy overgrown",
    "clearance": "garden clearance cleanup before after",
    "planting": "planting flowers garden spring",
    "flower": "flowers garden colourful english",
    "bulb": "spring bulbs planting garden uk",
    # Power washing
    "power washing": "power washing patio driveway clean",
    "pressure washing": "pressure washing patio clean",
    "patio": "clean patio garden outdoor uk",
    "driveway": "clean driveway power wash before after",
    "decking": "wooden decking garden clean outdoor",
    # Trees / wildlife / nature
    "wildlife": "garden wildlife birds hedgehog england",
    "birds": "garden birds bird feeder robin uk",
    "nature": "nature garden wildflower meadow cornwall",
    "wildflower": "wildflower meadow garden uk",
    "pollinator": "bee pollinator flowers garden",
    "hedgehog": "hedgehog garden wildlife uk",
    "butterfly": "butterfly garden flowers uk",
    "composting": "compost bin garden eco",
    "sustainability": "sustainable garden wildlife eco",
    # Fences / gutters / drains
    "fence": "wooden garden fence repair",
    "gutter": "gutter cleaning house roof",
    "drain": "drain clearance garden",
    "weeding": "weeding garden tidy flower bed",
    # Seasons
    "spring": "spring garden flowers uk blossoms",
    "summer": "summer garden sunshine english",
    "autumn": "autumn leaves garden uk golden",
    "winter": "winter garden frost uk robin",
    # Cornwall specific
    "cornwall": "cornwall garden landscape coast flowers",
    "coastal": "coastal garden cornwall sea",
    "cornish": "cornish garden cottage flowers coast",
    # General
    "garden maintenance": "garden maintenance tools professional uk",
    "leaf": "autumn leaves garden raking uk",
    "frost": "frost garden winter uk morning",
    "watering": "watering garden hose plants summer",
    "tools": "garden tools shed professional",
    "planning": "garden planning notebook spring",
}

# Persona-specific image style preferences
PERSONA_IMAGE_BOOST = {
    "wilson": "nature wildlife cornwall seasonal",
    "tamsin": "practical garden tools uk lawn",
    "jago": "cornwall landscape coast garden cottage",
    "morwenna": "wildlife eco garden flowers bees",
    "dave": "lawn stripes patio clean professional",
}


def fetch_pexels_image(topic: str, fallback_query: str = "cornwall garden",
                       persona_key: str = None) -> dict:
    """
    Fetch a relevant stock image from Pexels for a given topic.
    Optionally boosts search with persona-specific style terms.
    Returns: {url, photographer, pexels_url, alt_text} or empty dict on failure.
    """
    api_key = config.PEXELS_KEY
    if not api_key:
        log.warning("PEXELS_KEY not set — skipping image fetch")
        return {}

    # Find the best search query by matching topic keywords
    query = fallback_query
    topic_lower = topic.lower()
    best_score = 0
    for keyword, search_term in IMAGE_SEARCH_MAP.items():
        if keyword in topic_lower:
            # Longer keyword match = more specific = better
            score = len(keyword)
            if score > best_score:
                query = search_term
                best_score = score

    # Add persona-specific boost to search terms
    if persona_key and persona_key in PERSONA_IMAGE_BOOST:
        boost = PERSONA_IMAGE_BOOST[persona_key]
        # Append 1-2 boost words to diversify results per persona
        boost_words = boost.split()
        query += " " + random.choice(boost_words)

    try:
        resp = requests.get(
            "https://api.pexels.com/v1/search",
            headers={"Authorization": api_key},
            params={"query": query, "per_page": 8, "orientation": "landscape"},
            timeout=10,
        )
        resp.raise_for_status()
        photos = resp.json().get("photos", [])

        if not photos:
            # Fallback to generic garden query
            resp = requests.get(
                "https://api.pexels.com/v1/search",
                headers={"Authorization": api_key},
                params={"query": fallback_query, "per_page": 5, "orientation": "landscape"},
                timeout=10,
            )
            resp.raise_for_status()
            photos = resp.json().get("photos", [])

        if not photos:
            return {}

        # Pick a random photo from the top results for variety
        photo = random.choice(photos)

        return {
            "url": photo.get("src", {}).get("large2x") or photo.get("src", {}).get("large", ""),
            "photographer": photo.get("photographer", ""),
            "pexels_url": photo.get("url", ""),
            "alt_text": photo.get("alt", f"Garden scene — {topic}"),
        }
    except Exception as e:
        log.warning(f"Pexels image fetch failed: {e}")
        return {}


# ──────────────────────────────────────────────────────────────────
# Telegram Approval Workflow
# ──────────────────────────────────────────────────────────────────

def send_approval_request(api, content_type: str, title: str, excerpt: str,
                          image_url: str = "", content_id: int = None,
                          author: str = "") -> bool:
    """
    Send a Telegram message asking Chris to approve content.
    Returns True if message was sent successfully.
    
    Content stays as Draft until approved via:
    - The Hub UI (Marketing tab → Publish)
    - Or a reply to this Telegram message (handled by checking pending approvals)
    """
    icon = "📝" if content_type == "blog" else "📨"
    type_label = "Blog Post" if content_type == "blog" else "Newsletter"

    preview = excerpt[:200] if excerpt else title
    image_note = "📸 Stock image attached" if image_url else "⚠️ No image — add one in the Hub"
    author_note = f"\n✍️ Written by: {author}" if author else ""

    msg = (
        f"{icon} *New {type_label} Ready for Approval*\n\n"
        f"*{title}*\n"
        f"{author_note}\n\n"
        f"_{preview}_\n\n"
        f"{image_note}\n\n"
        f"✅ Reply APPROVE to publish\n"
        f"❌ Reply REJECT to discard\n"
        f"✏️ Or review in GGM Hub → Marketing"
    )

    try:
        api.send_telegram(msg)
        log.info(f"Approval request sent for {type_label}: {title}")
        return True
    except Exception as e:
        log.warning(f"Failed to send approval request: {e}")
        return False


# ──────────────────────────────────────────────────────────────────
# Scheduler
# ──────────────────────────────────────────────────────────────────

def calculate_next_run(schedule_type: str, schedule_day: str,
                       schedule_time: str, from_time: datetime = None) -> str:
    """
    Calculate the next run time for a schedule.
    Returns ISO format datetime string.
    """
    if not from_time:
        from_time = datetime.now()

    # Parse the time
    try:
        hour, minute = map(int, schedule_time.split(":"))
    except (ValueError, AttributeError):
        hour, minute = 9, 0

    day_map = {
        "monday": 0, "tuesday": 1, "wednesday": 2, "thursday": 3,
        "friday": 4, "saturday": 5, "sunday": 6,
    }

    if schedule_type.lower() == "daily":
        # Next occurrence of the specified time
        next_dt = from_time.replace(hour=hour, minute=minute, second=0, microsecond=0)
        if next_dt <= from_time:
            next_dt += timedelta(days=1)
        return next_dt.isoformat()

    elif schedule_type.lower() in ("weekly", "fortnightly"):
        target_day = day_map.get(schedule_day.lower(), 0)
        days_ahead = (target_day - from_time.weekday()) % 7
        if days_ahead == 0:
            # Same day — check if time has passed
            candidate = from_time.replace(hour=hour, minute=minute, second=0, microsecond=0)
            if candidate <= from_time:
                days_ahead = 7
        next_dt = (from_time + timedelta(days=days_ahead)).replace(
            hour=hour, minute=minute, second=0, microsecond=0
        )
        if schedule_type.lower() == "fortnightly" and days_ahead < 7:
            # If it's within this week, push to next fortnight
            pass  # keep as-is for first run, subsequent runs add 14 days
        return next_dt.isoformat()

    elif schedule_type.lower() == "monthly":
        # First occurrence of the target day next month
        target_day_num = day_map.get(schedule_day.lower(), 0)
        next_month = from_time.replace(day=1) + timedelta(days=32)
        next_month = next_month.replace(day=1)
        # Find first target weekday in next month
        days_ahead = (target_day_num - next_month.weekday()) % 7
        next_dt = (next_month + timedelta(days=days_ahead)).replace(
            hour=hour, minute=minute, second=0, microsecond=0
        )
        return next_dt.isoformat()

    # Fallback: tomorrow
    return (from_time + timedelta(days=1)).replace(
        hour=hour, minute=minute, second=0, microsecond=0
    ).isoformat()


class AgentScheduler:
    """
    Background scheduler that checks for due agents and runs them.
    Runs in a daemon thread — stops when the app closes.
    """

    def __init__(self, db, api=None):
        self.db = db
        self.api = api
        self._running = False
        self._thread = None
        self._check_interval = 60  # seconds

    def start(self):
        """Start the scheduler daemon thread."""
        if self._running:
            return
        self._running = True
        self._thread = threading.Thread(target=self._run_loop, daemon=True)
        self._thread.start()
        log.info("Agent scheduler started")

    def stop(self):
        """Signal the scheduler to stop."""
        self._running = False
        log.info("Agent scheduler stopped")

    def _run_loop(self):
        """Main loop — check for due agents every interval."""
        while self._running:
            try:
                self._check_and_run()
            except Exception as e:
                log.error(f"Agent scheduler error: {e}")
            # Sleep in small chunks so we can stop quickly
            for _ in range(self._check_interval):
                if not self._running:
                    break
                time.sleep(1)

    def _check_and_run(self):
        """Check all enabled agents and run any that are due."""
        agents = self.db.get_agent_schedules(enabled_only=True)
        now = datetime.now()

        for agent in agents:
            next_run = agent.get("next_run", "")
            if not next_run:
                # First time — calculate and set next_run
                next_run = calculate_next_run(
                    agent.get("schedule_type", "weekly"),
                    agent.get("schedule_day", "Monday"),
                    agent.get("schedule_time", "09:00"),
                )
                self.db.update_agent_next_run(agent["id"], next_run)
                continue

            try:
                next_dt = datetime.fromisoformat(next_run)
            except (ValueError, TypeError):
                continue

            if now >= next_dt:
                # This agent is due — run it
                self._execute_agent(agent)

                # Calculate next run
                new_next = calculate_next_run(
                    agent.get("schedule_type", "weekly"),
                    agent.get("schedule_day", "Monday"),
                    agent.get("schedule_time", "09:00"),
                    from_time=now,
                )
                self.db.update_agent_next_run(
                    agent["id"], new_next, last_run=now.isoformat()
                )

    def _execute_agent(self, agent: dict):
        """Execute a single agent via content_writer and log the result.
        
        Workflow:
          1. Generate content via content_writer.py (brand voice + sanitisation)
             — Blog posts use rotating writer personas
          2. Auto-fetch matching Pexels stock image (persona-aware)
          3. Save as Draft
          4. Send Telegram approval request to Chris
        """
        agent_type = agent.get("agent_type", "")
        agent_id = agent["id"]
        config_json = agent.get("config_json", "{}")

        log.info(f"Running agent: {agent.get('name', '')} (type={agent_type})")

        # Create a "running" log entry
        run_id = self.db.log_agent_run(
            agent_id, agent_type, "running"
        )

        try:
            if agent_type == "blog_writer":
                # Use content_writer with round-robin persona rotation
                from .content_writer import generate_blog_post as cw_blog
                from .content_writer import pick_next_persona_rotation

                # Get current rotation index from DB
                try:
                    rotation_idx = int(self.db.get_setting("blog_persona_index", "0"))
                except (ValueError, TypeError):
                    rotation_idx = 0

                persona, next_idx = pick_next_persona_rotation(rotation_idx)
                persona_key = None
                # Find persona key
                from .content_writer import BLOG_PERSONAS
                for k, v in BLOG_PERSONAS.items():
                    if v["name"] == persona["name"]:
                        persona_key = k
                        break

                log.info(f"Rotation: persona={persona['name']} (index {rotation_idx} → {next_idx})")
                result = cw_blog(persona_key=persona_key)  # uses assigned persona

                if result.get("error"):
                    self.db.update_agent_run(
                        run_id, "failed", error_message=result["error"]
                    )
                    log.warning(f"Blog agent failed: {result['error']}")
                else:
                    persona_key = result.get("persona_key", "")
                    author = result.get("author", "Chris")

                    self.db.update_agent_run(
                        run_id, "success",
                        output_title=result["title"],
                        output_text=result["content"],
                    )
                    log.info(f"Blog generated by {author}: {result['title']}")

                    # Auto-fetch a matching stock image (persona-aware)
                    image_data = fetch_pexels_image(
                        result["title"], persona_key=persona_key
                    )
                    image_url = image_data.get("url", "")
                    if image_url:
                        photographer = image_data.get("photographer", "")
                        log.info(f"Stock image fetched: {image_url} (by {photographer})")

                    # Save as draft blog post for approval
                    try:
                        self.db.save_blog_post({
                            "title": result["title"],
                            "content": result["content"],
                            "excerpt": result.get("excerpt", result["content"][:200].rstrip() + "..."),
                            "category": result.get("category", "Seasonal Guide"),
                            "author": author,
                            "status": "Draft",
                            "tags": result.get("tags", "ai-generated"),
                            "image_url": image_url,
                            "agent_run_id": run_id,
                        })
                        log.info(f"Blog by {author} saved as Draft — awaiting approval")

                        # Create a notification for the Overview dashboard
                        self.db.add_notification(
                            ntype="content",
                            title=f"\u270d\ufe0f Blog Draft Ready: {result['title']}",
                            message=f"Written by {author}. Review and publish in Marketing tab.",
                            icon="\u270d\ufe0f",
                        )
                    except Exception as be:
                        log.warning(f"Could not save blog draft: {be}")

                    # Advance the rotation index for next time
                    self.db.set_setting("blog_persona_index", str(next_idx))
                    log.info(f"Persona rotation advanced to index {next_idx}")

                    # Send Telegram approval request
                    if self.api:
                        send_approval_request(
                            self.api, "blog", result["title"],
                            result.get("excerpt", ""),
                            image_url=image_url,
                            author=author,
                        )

            elif agent_type == "newsletter_writer":
                # Use content_writer for proper brand voice + HTML output
                from .content_writer import generate_newsletter as cw_newsletter
                result = cw_newsletter()

                if result.get("error"):
                    self.db.update_agent_run(
                        run_id, "failed", error_message=result["error"]
                    )
                    log.warning(f"Newsletter agent failed: {result['error']}")
                else:
                    body_html = result.get("body_html", "")
                    body_text = result.get("body_text", body_html)

                    self.db.update_agent_run(
                        run_id, "success",
                        output_title=result["subject"],
                        output_text=body_text,
                    )
                    log.info(f"Newsletter generated: {result['subject']}")

                    # Auto-fetch a seasonal hero image for the newsletter
                    from .content_writer import _current_season
                    season = _current_season()
                    nl_image = fetch_pexels_image(
                        f"{season} cornwall garden",
                        fallback_query="cornwall garden flowers",
                    )
                    nl_image_url = nl_image.get("url", "")
                    if nl_image_url:
                        log.info(f"Newsletter hero image fetched: {nl_image_url}")

                    # Store draft for review in Hub UI
                    try:
                        self.db.set_setting("draft_newsletter_subject", result["subject"])
                        self.db.set_setting("draft_newsletter_body", body_text)
                        self.db.set_setting("draft_newsletter_html", body_html)
                        if nl_image_url:
                            self.db.set_setting("draft_newsletter_image", nl_image_url)
                        log.info("Newsletter saved as draft — awaiting approval")

                        # Create a notification for the Overview dashboard
                        self.db.add_notification(
                            ntype="content",
                            title=f"\U0001f4e8 Newsletter Draft Ready: {result['subject']}",
                            message="Review and send in Marketing tab.",
                            icon="\U0001f4e8",
                        )
                    except Exception as ne:
                        log.warning(f"Could not save newsletter draft: {ne}")

                    # Send Telegram approval request
                    if self.api:
                        send_approval_request(
                            self.api, "newsletter", result["subject"],
                            body_text[:200] if body_text else "",
                            image_url=nl_image_url,
                        )

            elif agent_type == "workflow_optimiser":
                # Workflow optimisation — analyses patterns across all nodes
                from .workflow_optimiser import WorkflowOptimiser
                optimiser = WorkflowOptimiser(self.db, self.api)
                result = optimiser.run(config_json)

                if result.get("report"):
                    self.db.update_agent_run(
                        run_id, "success",
                        output_title=result.get("title", "Workflow Report"),
                        output_text=result["report"],
                    )
                    log.info(f"Workflow optimiser completed: {result.get('insight_count', 0)} insights")
                else:
                    self.db.update_agent_run(
                        run_id, "failed",
                        error_message="No report generated",
                    )

            else:
                self.db.update_agent_run(
                    run_id, "failed",
                    error_message=f"Unknown agent type: {agent_type}"
                )

        except Exception as e:
            self.db.update_agent_run(
                run_id, "failed", error_message=str(e)
            )
            log.error(f"Agent execution error: {e}")

    def run_agent_now(self, agent_id: int) -> int:
        """
        Manually trigger an agent run. Returns the run_id.
        Called from the UI for the "Run Now" button.
        """
        agent = self.db.get_agent_schedule(agent_id)
        if not agent:
            return -1

        self._execute_agent(agent)

        # Update last_run
        now = datetime.now()
        new_next = calculate_next_run(
            agent.get("schedule_type", "weekly"),
            agent.get("schedule_day", "Monday"),
            agent.get("schedule_time", "09:00"),
            from_time=now,
        )
        self.db.update_agent_next_run(
            agent_id, new_next, last_run=now.isoformat()
        )
        return agent_id
