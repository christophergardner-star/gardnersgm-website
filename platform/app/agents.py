"""
Agent Scheduler Engine for GGM Hub.
Manages AI agents that write blogs, newsletters, etc. on a schedule.
Uses local Ollama for content generation — runs entirely on your machine.
"""

import json
import logging
import threading
import time
import requests
from datetime import datetime, timedelta

from . import config

log = logging.getLogger("ggm.agents")


# ──────────────────────────────────────────────────────────────────
# Content generation via Ollama
# ──────────────────────────────────────────────────────────────────

def ollama_generate(prompt: str, system: str = "", max_tokens: int = 2000) -> str:
    """
    Generate text via the best available LLM (auto-detected).
    Delegates to llm.py — kept here for backward compatibility.
    """
    from . import llm
    return llm.generate(prompt, system=system, max_tokens=max_tokens)


def is_ollama_available() -> bool:
    """Check if any LLM is available (Ollama, OpenAI, Gemini, etc.)."""
    from . import llm
    return llm.is_available()


# ──────────────────────────────────────────────────────────────────
# Blog Writer Agent
# ──────────────────────────────────────────────────────────────────

BLOG_SYSTEM_PROMPT = """You are a content writer for Gardners Ground Maintenance, a professional 
gardening and grounds maintenance company based in Cornwall, UK.

Write engaging, SEO-friendly blog posts aimed at homeowners in Cornwall.
Use a friendly, professional tone. Include practical tips.
The owner's name is Chris.

Format the output as:
TITLE: [blog post title]
---
[blog post content in clean HTML with <h2>, <p>, <ul> tags]
"""


def generate_blog_post(topic: str = None, config_json: str = "{}") -> dict:
    """
    Generate a blog post using Ollama.
    Returns dict with 'title', 'content', 'error'.
    """
    import random
    if not topic:
        topic = random.choice(config.AGENT_BLOG_TOPICS)

    prompt = f"""Write a blog post about: {topic}

The blog should be around 500-800 words, include practical advice,
and be relevant to homeowners in Cornwall.
Include a compelling title and well-structured content with subheadings."""

    text = ollama_generate(prompt, BLOG_SYSTEM_PROMPT)

    if text.startswith("[Error"):
        return {"title": "", "content": "", "error": text}

    # Parse title and content
    title = topic  # fallback
    content = text

    if "TITLE:" in text:
        parts = text.split("---", 1)
        title_line = parts[0].replace("TITLE:", "").strip()
        if title_line:
            title = title_line
        if len(parts) > 1:
            content = parts[1].strip()

    return {"title": title, "content": content, "error": ""}


# ──────────────────────────────────────────────────────────────────
# Newsletter Writer Agent
# ──────────────────────────────────────────────────────────────────

NEWSLETTER_SYSTEM_PROMPT = """You are writing a newsletter for Gardners Ground Maintenance, 
a professional gardening company in Cornwall, UK.

Write warm, engaging newsletters that feel personal — as if Chris (the owner) is writing 
to his valued customers. Include seasonal tips, company updates, and a friendly sign-off.

Format:
SUBJECT: [email subject line]
---
[newsletter body text — plain text, not HTML]
"""


def generate_newsletter(template: str = None, config_json: str = "{}") -> dict:
    """
    Generate a newsletter using Ollama.
    Returns dict with 'subject', 'body', 'error'.
    """
    now = datetime.now()
    months = ["January", "February", "March", "April", "May", "June",
              "July", "August", "September", "October", "November", "December"]
    month_name = months[now.month - 1]
    season = "spring" if now.month in (3, 4, 5) else \
             "summer" if now.month in (6, 7, 8) else \
             "autumn" if now.month in (9, 10, 11) else "winter"

    prompt = f"""Write a monthly newsletter for {month_name}.

It's currently {season} in Cornwall. Include:
1. A seasonal greeting
2. 3-4 garden tips relevant to the current season
3. Any promotions or offers (make one up that's reasonable)
4. A reminder about our subscription service
5. A warm sign-off from Chris

Keep it concise and engaging — around 300-400 words."""

    text = ollama_generate(prompt, NEWSLETTER_SYSTEM_PROMPT)

    if text.startswith("[Error"):
        return {"subject": "", "body": "", "error": text}

    subject = f"🌿 {month_name} Garden Tips from Gardners Ground Maintenance"
    body = text

    if "SUBJECT:" in text:
        parts = text.split("---", 1)
        subj_line = parts[0].replace("SUBJECT:", "").strip()
        if subj_line:
            subject = subj_line
        if len(parts) > 1:
            body = parts[1].strip()

    return {"subject": subject, "body": body, "error": ""}


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
        """Execute a single agent and log the result."""
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
                result = generate_blog_post(config_json=config_json)
                if result.get("error"):
                    self.db.update_agent_run(
                        run_id, "failed", error_message=result["error"]
                    )
                    log.warning(f"Blog agent failed: {result['error']}")
                else:
                    self.db.update_agent_run(
                        run_id, "success",
                        output_title=result["title"],
                        output_text=result["content"],
                    )
                    log.info(f"Blog generated: {result['title']}")

                    # Save as draft blog post for manual review
                    try:
                        self.db.save_blog_post({
                            "title": result["title"],
                            "content": result["content"],
                            "excerpt": result["content"][:200].rstrip() + "...",
                            "category": "seasonal",
                            "author": "Chris",
                            "status": "draft",
                            "tags": "ai-generated",
                            "agent_run_id": run_id,
                        })
                        log.info("Blog saved as draft in blog_posts table")
                    except Exception as be:
                        log.warning(f"Could not save blog draft: {be}")

                    # Notify via Telegram if API is available
                    if self.api:
                        try:
                            self.api.send_telegram(
                                f"📝 *New Blog Draft Generated*\n\n"
                                f"_{result['title']}_\n\n"
                                f"Review & publish in GGM Hub → Marketing"
                            )
                        except Exception:
                            pass

            elif agent_type == "newsletter_writer":
                result = generate_newsletter(config_json=config_json)
                if result.get("error"):
                    self.db.update_agent_run(
                        run_id, "failed", error_message=result["error"]
                    )
                    log.warning(f"Newsletter agent failed: {result['error']}")
                else:
                    self.db.update_agent_run(
                        run_id, "success",
                        output_title=result["subject"],
                        output_text=result["body"],
                    )
                    log.info(f"Newsletter generated: {result['subject']}")

                    if self.api:
                        try:
                            self.api.send_telegram(
                                f"📨 *Newsletter Draft Ready*\n\n"
                                f"_{result['subject']}_\n\n"
                                f"Review and send from GGM Hub → Marketing"
                            )
                        except Exception:
                            pass

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
