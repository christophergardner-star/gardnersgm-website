"""
Command Listener — Polls GAS for commands targeted at the laptop node.
Runs inside the Hub UI when NODE_ID == "field_laptop".
"""

import threading
import json
import subprocess
import logging
from datetime import datetime

from .. import config

log = logging.getLogger("ggm.ui.command_listener")

POLL_INTERVAL_MS = 15_000  # 15 seconds


def start_command_listener(window, api):
    """Start polling for laptop-targeted commands. Call from main.py after UI init."""
    listener = _CommandListener(window, api)
    listener.start()
    # Store reference so it can be stopped on shutdown
    window._command_listener = listener
    log.info("Command listener started (polling every %d ms)", POLL_INTERVAL_MS)


class _CommandListener:
    """Background poller for PC → Laptop commands."""

    def __init__(self, window, api):
        self.window = window
        self.api = api
        self._running = True

    def start(self):
        self.window.after(8_000, self._schedule_poll)

    def stop(self):
        self._running = False

    def _schedule_poll(self):
        if not self._running:
            return
        threading.Thread(target=self._poll, daemon=True).start()

    def _poll(self):
        """Fetch pending commands for this laptop and execute them."""
        if not self._running:
            return
        try:
            resp = self.api.get(
                action="get_remote_commands",
                params={"status": "pending", "target": "field_laptop"},
            )
            commands = resp.get("commands", []) if isinstance(resp, dict) else []
            for cmd in commands:
                self._execute(cmd)
        except Exception as e:
            log.debug(f"Command poll: {e}")

        if self._running:
            try:
                self.window.after(POLL_INTERVAL_MS, self._schedule_poll)
            except Exception:
                pass  # window destroyed

    def _execute(self, cmd):
        """Execute a single command and report result to GAS."""
        cmd_id = cmd.get("id", "")
        cmd_type = cmd.get("command", "")
        raw_data = cmd.get("data", "{}")

        try:
            data = json.loads(raw_data) if isinstance(raw_data, str) else (raw_data or {})
        except (json.JSONDecodeError, TypeError):
            data = {}

        log.info(f"Executing command: {cmd_type} (from {cmd.get('source', '?')})")
        status = "completed"
        result = ""

        try:
            if cmd_type == "ping":
                result = f"pong — v{config.APP_VERSION} ({config.GIT_COMMIT})"

            elif cmd_type == "force_refresh":
                self.window.after(0, self.window.refresh_current_tab)
                result = "UI refreshed"

            elif cmd_type == "show_notification":
                title = data.get("title", "Notification")
                message = data.get("message", "")
                self.window.after(0, lambda: _show_notification(
                    self.window, title, message))
                result = f"Shown: {title}"

            elif cmd_type == "show_alert":
                message = data.get("message", "Alert from PC Hub")
                self.window.after(0, lambda: _show_alert(self.window, message))
                result = "Alert shown"

            elif cmd_type == "git_pull":
                r = subprocess.run(
                    ["git", "pull", "--ff-only", "origin", "master"],
                    cwd=str(config.PROJECT_ROOT),
                    capture_output=True, text=True, timeout=30,
                )
                result = r.stdout.strip() or r.stderr.strip() or "Done"
                if r.returncode != 0:
                    status = "failed"
                    result = f"Exit {r.returncode}: {result}"

            elif cmd_type == "clear_cache":
                # Force sync clears the database cache
                self.window.after(0, lambda: self.window.sync.force_sync())
                result = "Cache cleared, sync triggered"

            elif cmd_type == "switch_tab":
                tab = data.get("tab", "overview")
                self.window.after(0, lambda: self.window._switch_tab(tab))
                result = f"Switched to {tab}"

            elif cmd_type == "force_sync":
                self.window.after(0, lambda: self.window.sync.force_sync())
                result = "Full sync triggered"

            elif cmd_type == "send_data":
                # Store arbitrary data — tabs can pick it up
                self.window._incoming_data = data
                result = f"Data received ({data.get('action', '?')})"

            elif cmd_type == "update_status":
                msg = data.get("message", "")
                self.window.after(0, lambda: self.window.status_label.configure(
                    text=msg))
                result = f"Status updated: {msg}"

            else:
                status = "failed"
                result = f"Unknown command: {cmd_type}"

        except Exception as e:
            status = "failed"
            result = str(e)[:400]
            log.error(f"Command {cmd_type} failed: {e}")

        # Report result back to GAS
        try:
            self.api.post(action="update_remote_command", data={
                "id": cmd_id,
                "status": status,
                "result": result[:500],
                "completed_at": datetime.now().isoformat(),
            })
        except Exception as e:
            log.warning(f"Failed to report command result: {e}")

        log.info(f"Command {cmd_type}: {status} — {result[:80]}")


# ---------------------------------------------------------------------------
# UI Helpers
# ---------------------------------------------------------------------------

def _show_notification(window, title, message):
    """Show a floating notification popup that auto-dismisses."""
    try:
        from ..ui import theme
        import customtkinter as ctk

        notif = ctk.CTkFrame(
            window, fg_color="#1e3a5f", corner_radius=10,
            border_width=1, border_color=theme.GREEN_LIGHT,
        )
        notif.place(relx=1.0, rely=0.0, anchor="ne", x=-20, y=60)

        ctk.CTkLabel(
            notif, text=f"📬 {title}", font=theme.font_bold(13),
            text_color=theme.GREEN_LIGHT,
        ).pack(padx=12, pady=(8, 2), anchor="w")

        if message:
            ctk.CTkLabel(
                notif, text=message, font=theme.font(12),
                text_color=theme.TEXT_LIGHT, wraplength=300,
            ).pack(padx=12, pady=(0, 4), anchor="w")

        ctk.CTkButton(
            notif, text="✕", width=28, height=24,
            fg_color="transparent", hover_color=theme.BG_CARD,
            font=theme.font(12), text_color=theme.TEXT_DIM,
            command=notif.destroy,
        ).place(relx=1.0, y=4, anchor="ne", x=-4)

        # Auto-dismiss after 10 seconds
        window.after(10_000, lambda: notif.destroy() if notif.winfo_exists() else None)

    except Exception as e:
        log.warning(f"Could not show notification: {e}")


def _show_alert(window, message):
    """Show a blocking alert dialog."""
    try:
        from tkinter import messagebox
        messagebox.showwarning("PC Hub Alert", message)
    except Exception:
        log.warning(f"Alert: {message}")
