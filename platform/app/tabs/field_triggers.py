"""
Field Triggers Tab — Send commands to PC Hub, run AI agents, view command history.
"""

import customtkinter as ctk
import threading
import json
from datetime import datetime

from ..ui import theme
from .. import config

import logging
log = logging.getLogger("ggm.tabs.triggers")


class FieldTriggersTab(ctk.CTkFrame):
    """Send remote commands to PC Hub and view execution history."""

    def __init__(self, parent, db, sync, api, app_window, **kwargs):
        super().__init__(parent, fg_color=theme.BG_DARK, **kwargs)

        self.db = db
        self.sync = sync
        self.api = api
        self.app = app_window

        self._result_labels = {}

        self.grid_columnconfigure(0, weight=1)
        self.grid_rowconfigure(1, weight=1)

        self._build_header()
        self._build_body()

    # ------------------------------------------------------------------
    # Layout
    # ------------------------------------------------------------------
    def _build_header(self):
        hdr = ctk.CTkFrame(self, fg_color=theme.BG_CARD, height=50, corner_radius=0)
        hdr.grid(row=0, column=0, sticky="ew")
        hdr.grid_columnconfigure(1, weight=1)

        ctk.CTkLabel(
            hdr, text="🖥️  PC Hub Triggers",
            font=theme.font_bold(16), text_color=theme.TEXT_LIGHT,
        ).grid(row=0, column=0, padx=16, pady=12, sticky="w")

        # Refresh history button
        theme.create_outline_button(
            hdr, "↻  Refresh History",
            command=self._load_history,
        ).grid(row=0, column=2, padx=16, pady=8, sticky="e")

    def _build_body(self):
        body = ctk.CTkFrame(self, fg_color=theme.BG_DARK)
        body.grid(row=1, column=0, sticky="nsew", padx=16, pady=(8, 16))
        body.grid_columnconfigure(0, weight=1)
        body.grid_columnconfigure(1, weight=1)
        body.grid_rowconfigure(1, weight=1)

        # Left: trigger buttons
        self._build_triggers_panel(body)

        # Right: command history
        self._build_history_panel(body)

    def _build_triggers_panel(self, parent):
        card = theme.create_card(parent)
        card.grid(row=0, column=0, rowspan=2, sticky="nsew", padx=(0, 8))
        card.grid_columnconfigure(0, weight=1)

        ctk.CTkLabel(
            card, text="⚡ Quick Triggers", font=theme.font_bold(14),
            text_color=theme.TEXT_LIGHT,
        ).pack(fill="x", padx=12, pady=(12, 8))

        scroll = ctk.CTkScrollableFrame(card, fg_color="transparent")
        scroll.pack(fill="both", expand=True, padx=8, pady=(0, 8))
        scroll.grid_columnconfigure(0, weight=1)

        # ── Trigger definitions ──
        triggers = [
            # (command, label, description, colour, data)
            ("generate_blog", "📝 Generate Blog Post",
             "AI writes a blog post draft", theme.GREEN_PRIMARY, None),
            ("generate_newsletter", "📰 Generate Newsletter",
             "AI creates newsletter draft", theme.GREEN_PRIMARY, None),
            ("send_reminders", "⏰ Send Job Reminders",
             "Day-before reminder emails", theme.GREEN_ACCENT, None),
            ("run_email_lifecycle", "📧 Run Email Lifecycle",
             "Process automated email campaigns", theme.GREEN_ACCENT, None),
            ("send_booking_confirmation", "📧 Booking Confirmations",
             "Send confirmations for today's bookings", theme.GREEN_ACCENT, None),
            ("force_sync", "🔄 Force Full Sync",
             "Push/pull all data to Google Sheets", theme.AMBER, None),
        ]

        # ── AI Agent triggers ──
        agents = [
            ("blog_writer",      "📝 Blog Writer Agent"),
            ("review_chaser",    "⭐ Review Chaser Agent"),
            ("morning_planner",  "🌅 Morning Planner Agent"),
            ("evening_summary",  "🌇 Evening Summary Agent"),
            ("social_media",     "📱 Social Media Agent"),
            ("enquiry_responder","💬 Enquiry Responder Agent"),
            ("site_health",      "🏥 Site Health Monitor"),
            ("health_check",     "🔍 System Health Check"),
            ("finance_dashboard","💷 Finance Dashboard Agent"),
            ("business_tactics", "📊 Business Tactics Agent"),
            ("market_intel",     "🌍 Market Intel Agent"),
            ("orchestrator",     "🎯 Orchestrator Agent"),
            ("content_agent",    "✍️ Content Quality Agent"),
            ("email_lifecycle",  "📨 Email Lifecycle Agent"),
        ]

        for cmd, label, desc, colour, data in triggers:
            self._add_trigger_button(scroll, cmd, label, desc, colour, data)

        # Divider
        ctk.CTkFrame(scroll, height=1, fg_color=theme.BG_CARD).pack(
            fill="x", padx=4, pady=(12, 4))
        ctk.CTkLabel(
            scroll, text="🤖  AI Agents", font=theme.font_bold(12),
            text_color=theme.TEXT_DIM,
        ).pack(fill="x", padx=8, pady=(4, 8))

        for agent_id, label in agents:
            self._add_trigger_button(
                scroll, "run_agent", label,
                f"Force {agent_id} agent to run now",
                theme.PURPLE, {"agent_id": agent_id},
            )

    def _add_trigger_button(self, parent, cmd, label, desc, colour, data):
        """Add a single trigger button with description and result label."""
        row = ctk.CTkFrame(parent, fg_color="transparent")
        row.pack(fill="x", pady=3)
        row.grid_columnconfigure(1, weight=1)

        btn = ctk.CTkButton(
            row, text=label, font=theme.font(12, "bold"),
            fg_color=colour, hover_color=theme.GREEN_DARK,
            height=36, corner_radius=8,
            command=lambda: self._fire_trigger(cmd, label, data),
        )
        btn.grid(row=0, column=0, columnspan=2, sticky="ew", padx=4)

        ctk.CTkLabel(
            row, text=desc, font=theme.font(10),
            text_color=theme.TEXT_DIM, anchor="w",
        ).grid(row=1, column=0, padx=8, sticky="w")

        result = ctk.CTkLabel(
            row, text="", font=theme.font(10),
            text_color=theme.TEXT_DIM, anchor="e",
        )
        result.grid(row=1, column=1, padx=8, sticky="e")
        self._result_labels[label] = result

    def _fire_trigger(self, cmd, label, data):
        """Queue a command on the PC Hub and track its result by ID."""
        result_label = self._result_labels.get(label)
        if result_label:
            result_label.configure(text="⏳ Queuing...", text_color=theme.AMBER)

        def _send():
            try:
                payload = {
                    "action": "queue_remote_command",
                    "command": cmd,
                    "data": json.dumps(data or {}),
                    "source": config.NODE_ID,
                    "target": "pc_hub",
                    "created_at": datetime.now().isoformat(),
                }
                resp = self.api.post(action="queue_remote_command", data=payload)
                cmd_id = resp.get("id", "") if isinstance(resp, dict) else ""
                if cmd_id:
                    self.after(0, lambda: result_label.configure(
                        text=f"✅ Queued ({cmd_id[-8:]}) — waiting for PC…",
                        text_color=theme.GREEN_LIGHT))
                    # Poll for result: check every 15s up to 5 minutes
                    self._poll_command_result(result_label, cmd_id, attempts=0)
                else:
                    self.after(0, lambda: result_label.configure(
                        text="✅ Queued — waiting for PC…",
                        text_color=theme.GREEN_LIGHT))
            except Exception as e:
                log.error("Trigger %s failed: %s", cmd, e)
                self.after(0, lambda: result_label.configure(
                    text=f"❌ {str(e)[:60]}", text_color=theme.RED))

        threading.Thread(target=_send, daemon=True).start()

    def _poll_command_result(self, result_label, cmd_id, attempts=0):
        """Poll GAS for the specific command's status by ID."""
        max_attempts = 20   # 20 × 15s = 5 minutes
        poll_ms = 15_000    # 15 seconds between checks

        def _check():
            try:
                resp = self.api.get(action="get_remote_commands",
                                   params={"status": "all", "limit": "10"})
                cmds = resp.get("commands", []) if isinstance(resp, dict) else []
                match = next((c for c in cmds if c.get("id") == cmd_id), None)
                if match:
                    st = match.get("status", "pending").lower()
                    result = match.get("result", "")
                    if st == "completed":
                        self.after(0, lambda: result_label.configure(
                            text=f"✅ {result[:80]}", text_color=theme.GREEN_LIGHT))
                        self.after(500, self._load_history)
                        return
                    elif st == "failed":
                        self.after(0, lambda: result_label.configure(
                            text=f"❌ {result[:80]}", text_color=theme.RED))
                        self.after(500, self._load_history)
                        return
                # Still pending — schedule another check
                if attempts < max_attempts:
                    self.after(poll_ms,
                               lambda: self._poll_command_result(
                                   result_label, cmd_id, attempts + 1))
                else:
                    self.after(0, lambda: result_label.configure(
                        text="⏳ Timed out — check history",
                        text_color=theme.AMBER))
            except Exception as e:
                log.debug("Poll check failed: %s", e)
                if attempts < max_attempts:
                    self.after(poll_ms,
                               lambda: self._poll_command_result(
                                   result_label, cmd_id, attempts + 1))

        threading.Thread(target=_check, daemon=True).start()

    # ------------------------------------------------------------------
    # Command History
    # ------------------------------------------------------------------
    def _build_history_panel(self, parent):
        card = theme.create_card(parent)
        card.grid(row=0, column=1, rowspan=2, sticky="nsew", padx=(8, 0))
        card.grid_columnconfigure(0, weight=1)

        ctk.CTkLabel(
            card, text="📜 Command History", font=theme.font_bold(14),
            text_color=theme.TEXT_LIGHT,
        ).pack(fill="x", padx=12, pady=(12, 8))

        self._history_scroll = ctk.CTkScrollableFrame(card, fg_color="transparent")
        self._history_scroll.pack(fill="both", expand=True, padx=8, pady=(0, 8))

    def _load_history(self):
        """Fetch recent commands from GAS and display them."""
        def _fetch():
            try:
                data = self.api.get(action="get_remote_commands",
                                   params={"status": "all", "limit": "20"})
                cmds = data.get("commands", []) if isinstance(data, dict) else []
            except Exception:
                cmds = []
            self.after(0, lambda: self._render_history(cmds))
        threading.Thread(target=_fetch, daemon=True).start()

    def _render_history(self, commands):
        """Render command history cards."""
        for w in self._history_scroll.winfo_children():
            w.destroy()

        if not commands:
            ctk.CTkLabel(
                self._history_scroll, text="No commands yet",
                font=theme.font(12), text_color=theme.TEXT_DIM,
            ).pack(pady=20)
            return

        for cmd in commands:
            status = cmd.get("status", "pending")
            icon = {"completed": "✅", "failed": "❌", "pending": "⏳"}.get(status, "⚪")
            colour = {
                "completed": theme.GREEN_LIGHT,
                "failed": theme.RED,
                "pending": theme.AMBER,
            }.get(status, theme.TEXT_DIM)

            row = ctk.CTkFrame(self._history_scroll, fg_color=theme.BG_CARD,
                               corner_radius=8, height=60)
            row.pack(fill="x", pady=3, padx=4)
            row.grid_columnconfigure(1, weight=1)
            row.pack_propagate(False)

            ctk.CTkLabel(
                row, text=f"{icon} {cmd.get('command', '?')}",
                font=theme.font(12, "bold"), text_color=colour,
            ).pack(anchor="w", padx=10, pady=(6, 0))

            meta = f"From: {cmd.get('source', '?')}  •  {cmd.get('created_at', '')[:16]}"
            ctk.CTkLabel(
                row, text=meta, font=theme.font(10),
                text_color=theme.TEXT_DIM,
            ).pack(anchor="w", padx=10)

            result_text = cmd.get("result", "")
            if result_text:
                ctk.CTkLabel(
                    row, text=result_text[:100], font=theme.font(10),
                    text_color=theme.TEXT_DIM, wraplength=300,
                ).pack(anchor="w", padx=10, pady=(0, 4))

    # ------------------------------------------------------------------
    # Refresh (called by app_window on tab switch)
    # ------------------------------------------------------------------
    def refresh(self):
        self._load_history()
