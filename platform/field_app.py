"""
GGM Hub — Laptop Field App  v3.0
A fully interactive field companion that works as Node 2, bridging
the mobile app (Node 3) and the main PC hub (Node 1).

Architecture:
  📱 Mobile App (Node 3)  →  GAS (Google Sheets)  ←  💻 Laptop Field App (Node 2)
                                    ↕
                              🖥️ PC Hub (Node 1)

Node 2 can:
  - Full operational dashboard with KPI cards, revenue, alerts, weather
  - View/manage today's jobs with en-route/start/complete/invoice workflow
  - Unified bookings view — confirm, cancel, trigger emails
  - Full CRM: clients, enquiries, quotes (view, create, resend)
  - Finance overview: invoices, payments, revenue stats, savings pots
  - Marketing: blog posts, newsletters, testimonials
  - Job tracking with time data from mobile app
  - Site analytics: page views, top pages, referrers
  - Trigger heavy PC actions (blogs, newsletters, emails, agents)
  - Field notes synced to the main system
  - Auto-refresh (45s) for live data
  - PC online status indicator
  - Mobile app integration awareness (shared endpoints)

Does NOT run agents, emails, newsletters, or blog posting locally.
All heavy processing is delegated to PC Hub (Node 1) via command queue.
"""

import os
import sys
import json
import time
import threading
import subprocess
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta
from pathlib import Path

# ── Ensure we can import from the app package ──
SCRIPT_DIR = Path(__file__).resolve().parent
PLATFORM_DIR = SCRIPT_DIR
sys.path.insert(0, str(PLATFORM_DIR))

import customtkinter as ctk
from tkinter import messagebox
import requests
from urllib.parse import urlencode

# ──────────────────────────────────────────────────────────────────
# Configuration
# ──────────────────────────────────────────────────────────────────
APP_NAME = "GGM Field"
VERSION = "3.1.0"
BRANCH = "master"
NODE_ID = "field_laptop"
NODE_TYPE = "laptop"

import subprocess


def _get_git_commit():
    """Get short git commit hash."""
    try:
        result = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            capture_output=True, text=True, timeout=5,
            cwd=str(SCRIPT_DIR)
        )
        return result.stdout.strip() if result.returncode == 0 else "unknown"
    except Exception:
        return "unknown"


GIT_COMMIT = _get_git_commit()


def _load_webhook():
    try:
        from dotenv import load_dotenv
        for p in [PLATFORM_DIR / ".env", PLATFORM_DIR.parent / ".env"]:
            if p.exists():
                load_dotenv(p)
                break
    except ImportError:
        pass
    return os.getenv(
        "SHEETS_WEBHOOK",
        "https://script.google.com/macros/s/"
        "AKfycbx-q2qSeCorIEeXPE9d2MgAZLKEFwFNW9lARLE1yYciH9wJWwvktUTuDVLz_rSCbUhkMg/exec"
    )


WEBHOOK_URL = _load_webhook()
STRIPE_KEY = os.getenv("STRIPE_KEY", "")

# ──────────────────────────────────────────────────────────────────
# API helpers
# ──────────────────────────────────────────────────────────────────
_session = requests.Session()
_session.headers["User-Agent"] = f"GGM-Field/{VERSION}"


# ── Response cache: avoids re-fetching data loaded <30s ago ──
_cache = {}       # key -> data
_cache_ts = {}    # key -> timestamp
_POOL = ThreadPoolExecutor(max_workers=6)


def _cache_key(action, params):
    import json as _j
    return f"{action}|{_j.dumps(params, sort_keys=True)}"


def api_get(action: str, _ttl: int = 0, **params) -> dict:
    """GET with optional caching.  _ttl=0 means no cache."""
    key = _cache_key(action, params)
    if _ttl > 0 and key in _cache and (time.time() - _cache_ts.get(key, 0)) < _ttl:
        return _cache[key]
    query = {"action": action, **params}
    url = f"{WEBHOOK_URL}?{urlencode(query)}"
    resp = _session.get(url, timeout=25, allow_redirects=True)
    resp.raise_for_status()
    data = resp.json()
    if _ttl > 0:
        _cache[key] = data
        _cache_ts[key] = time.time()
    return data


def api_get_cached(action: str, ttl: int = 30, **params) -> dict:
    """Convenience: GET with 30-second cache by default."""
    return api_get(action, _ttl=ttl, **params)


def api_post(action: str, data: dict = None) -> dict:
    payload = {"action": action}
    if data:
        payload.update(data)
    resp = _session.post(WEBHOOK_URL, json=payload, timeout=25, allow_redirects=True)
    resp.raise_for_status()
    return resp.json()


def fetch_parallel(*calls):
    """Run multiple api_get_cached calls in parallel.
    Each call is (action, {params}) or (action, {params}, ttl).
    Returns dict of action->result.
    """
    results = {}
    futures = {}
    for call in calls:
        action = call[0]
        params = call[1] if len(call) > 1 else {}
        ttl = call[2] if len(call) > 2 else 30
        futures[_POOL.submit(api_get, action, ttl, **params)] = action
    for fut in as_completed(futures):
        action = futures[fut]
        try:
            results[action] = fut.result()
        except Exception:
            results[action] = {}
    return results


def send_pc_command(command: str, data: dict = None):
    return api_post("queue_remote_command", {
        "command": command,
        "data": json.dumps(data or {}),
        "source": "laptop",
        "target": "pc_hub",
        "created_at": datetime.now().isoformat(),
    })


# ──────────────────────────────────────────────────────────────────
# Colour palette (dark theme matching GGM Hub)
# ──────────────────────────────────────────────────────────────────
C = {
    "bg":       "#1a1a2e",
    "sidebar":  "#16213e",
    "card":     "#1f2940",
    "card_alt": "#253350",
    "accent":   "#4ecca3",
    "accent2":  "#3b82f6",
    "text":     "#e8e8e8",
    "muted":    "#8899aa",
    "success":  "#10b981",
    "warning":  "#f59e0b",
    "danger":   "#ef4444",
    "orange":   "#f97316",
    "purple":   "#a855f7",
    "pink":     "#ec4899",
    "border":   "#2a3a5c",
    "bar":      "#111827",
    "cyan":     "#06b6d4",
}

# ──────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────

def _safe_float(v, default=0.0):
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def _safe_int(v, default=0):
    try:
        return int(v)
    except (TypeError, ValueError):
        return default


def _safe_list(data, key):
    """Extract a list from an API response dict."""
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        return data.get(key, [])
    return []


# ──────────────────────────────────────────────────────────────────
# Main Application
# ──────────────────────────────────────────────────────────────────

class FieldApp(ctk.CTk):
    """Fully interactive field companion — Node 2 in the GGM network."""

    TABS = [
        ("dashboard",  "📊  Dashboard"),
        ("today",      "📋  Today's Jobs"),
        ("bookings",   "📅  Bookings"),
        ("schedule",   "📆  Schedule"),
        ("tracking",   "⏱️  Job Tracking"),
        ("clients",    "👤  Clients"),
        ("enquiries",  "📩  Enquiries"),
        ("quotes",     "💬  Quotes"),
        ("finance",    "💷  Finance"),
        ("marketing",  "📢  Marketing"),
        ("analytics",  "🌐  Site Analytics"),
        ("triggers",   "🖥️  PC Triggers"),
        ("notes",      "📝  Field Notes"),
        ("health",     "🏥  System Health"),
    ]

    AUTO_REFRESH_MS = 45_000

    def __init__(self):
        super().__init__()
        self.title(f"🌿 {APP_NAME} v{VERSION} — Gardners Ground Maintenance")
        self._configure_window()
        self._current_tab = None
        self._tab_frames = {}
        self._cached = {}
        self._auto_refresh_id = None
        self._pc_online = False
        self._last_pc_check = ""
        self._notif_items = []
        self._notif_unread = 0
        self._notif_popup = None

        self._build_status_bar()
        self._build_sidebar()
        self._build_content_area()
        self._switch_tab("dashboard")
        self._start_auto_refresh()

    def _configure_window(self):
        sw = self.winfo_screenwidth()
        sh = self.winfo_screenheight()
        w = min(1280, sw - 20)
        h = min(850, sh - 80)
        x = max(0, (sw - w) // 2)
        y = max(0, (sh - h) // 2 - 20)
        self.geometry(f"{w}x{h}+{x}+{y}")
        self.minsize(960, 640)

    # ════════════════════════════════════════════════════════════
    #  LAYOUT
    # ════════════════════════════════════════════════════════════

    def _build_sidebar(self):
        sb = ctk.CTkFrame(self, width=210, fg_color=C["sidebar"], corner_radius=0)
        sb.pack(side="left", fill="y")
        sb.pack_propagate(False)

        hdr = ctk.CTkFrame(sb, fg_color="transparent")
        hdr.pack(fill="x", padx=10, pady=(14, 1))
        ctk.CTkLabel(hdr, text="🌿 GGM Field", font=("Segoe UI", 18, "bold"),
                     text_color=C["accent"]).pack(side="left")
        # Notification bell
        self._bell_frame = ctk.CTkFrame(hdr, fg_color="transparent", width=36, height=36)
        self._bell_frame.pack(side="right", padx=(4, 0))
        self._bell_frame.pack_propagate(False)
        self._bell_btn = ctk.CTkButton(self._bell_frame, text="🔔", width=32, height=32,
                                        fg_color="transparent", hover_color=C["card_alt"],
                                        font=("Segoe UI", 16), cursor="hand2",
                                        command=self._toggle_notifications)
        self._bell_btn.pack()
        self._bell_badge = ctk.CTkLabel(self._bell_frame, text="", width=18, height=18,
                                         fg_color=C["danger"], corner_radius=9,
                                         font=("Segoe UI", 9, "bold"), text_color="#fff")
        self._bell_badge.place(relx=0.65, rely=0.0)
        self._bell_badge.place_forget()  # Hidden until notifications exist
        ctk.CTkLabel(sb, text="Node 2 — Field Hub", font=("Segoe UI", 10),
                     text_color=C["muted"]).pack(pady=(0, 10))

        self._nav = {}
        for key, label in self.TABS:
            btn = ctk.CTkButton(
                sb, text=label, anchor="w", font=("Segoe UI", 11), height=32,
                fg_color="transparent", hover_color="#283b5b",
                text_color=C["text"],
                command=lambda k=key: self._switch_tab(k),
            )
            btn.pack(fill="x", padx=5, pady=1)
            self._nav[key] = btn

        # Bottom area
        ctk.CTkFrame(sb, height=1, fg_color=C["border"]).pack(fill="x", padx=10, pady=(8, 4))

        self._pc_label = ctk.CTkLabel(sb, text="⏳ Checking PC...", font=("Segoe UI", 9),
                                       text_color=C["muted"])
        self._pc_label.pack(fill="x", padx=10, pady=(0, 3))

        self._mobile_label = ctk.CTkLabel(sb, text="📱 Mobile: Shared API", font=("Segoe UI", 9),
                                           text_color=C["muted"])
        self._mobile_label.pack(fill="x", padx=10, pady=(0, 4))

        self._check_pc_online()

        ctk.CTkButton(sb, text="🔄 Refresh", height=26, font=("Segoe UI", 10),
                       fg_color="#0f3460", hover_color="#283b5b",
                       command=self._manual_refresh).pack(fill="x", padx=10, pady=2)
        ctk.CTkButton(sb, text="⬇️ Pull Updates", height=26, font=("Segoe UI", 10),
                       fg_color="#0f3460", hover_color="#283b5b",
                       command=self._git_pull).pack(fill="x", padx=10, pady=2)
        self._version_label = ctk.CTkLabel(sb, text=f"v{VERSION} ({GIT_COMMIT})",
                                          font=("Segoe UI", 8), text_color="#445566")
        self._version_label.pack(side="bottom", pady=3)
        # Check for updates in background
        self._threaded(self._check_for_updates)

    def _toggle_notifications(self):
        """Toggle the notification popup panel."""
        if self._notif_popup and self._notif_popup.winfo_exists():
            self._notif_popup.destroy()
            self._notif_popup = None
            return

        # Create popup
        popup = ctk.CTkToplevel(self)
        popup.overrideredirect(True)
        popup.configure(fg_color=C["card"])

        # Position near the bell
        bx = self._bell_frame.winfo_rootx()
        by = self._bell_frame.winfo_rooty() + 38
        popup.geometry(f"340x420+{bx - 120}+{by}")
        popup.attributes("-topmost", True)

        self._notif_popup = popup

        # Header
        hdr = ctk.CTkFrame(popup, fg_color=C["sidebar"], corner_radius=0, height=40)
        hdr.pack(fill="x")
        hdr.pack_propagate(False)
        ctk.CTkLabel(hdr, text="🔔 Notifications", font=("Segoe UI", 13, "bold"),
                     text_color=C["text"]).pack(side="left", padx=12, pady=6)
        if self._notif_items:
            ctk.CTkButton(hdr, text="Clear all", width=70, height=24,
                           fg_color="transparent", hover_color=C["card_alt"],
                           font=("Segoe UI", 9), text_color=C["muted"],
                           command=self._clear_notifications).pack(side="right", padx=8)
        ctk.CTkButton(hdr, text="✕", width=28, height=28,
                       fg_color="transparent", hover_color=C["danger"],
                       font=("Segoe UI", 12), text_color=C["muted"],
                       command=lambda: [popup.destroy(), setattr(self, '_notif_popup', None)]).pack(side="right")

        # Content area
        scroll = ctk.CTkScrollableFrame(popup, fg_color=C["card"])
        scroll.pack(fill="both", expand=True, padx=2, pady=2)

        if not self._notif_items:
            ctk.CTkLabel(scroll, text="No notifications", font=("Segoe UI", 12),
                         text_color=C["muted"]).pack(pady=40)
        else:
            for n in self._notif_items:
                nrow = ctk.CTkFrame(scroll, fg_color=C["card_alt"], corner_radius=6)
                nrow.pack(fill="x", pady=2, padx=2)
                nrow.configure(cursor="hand2")

                inner = ctk.CTkFrame(nrow, fg_color="transparent")
                inner.pack(fill="x", padx=10, pady=6)

                icon_lbl = ctk.CTkLabel(inner, text=n.get("icon", "🔔"),
                             font=("Segoe UI", 14), width=24)
                icon_lbl.pack(side="left", padx=(0, 6))

                text_frame = ctk.CTkFrame(inner, fg_color="transparent")
                text_frame.pack(side="left", fill="x", expand=True)

                title_lbl = ctk.CTkLabel(text_frame, text=n.get("title", ""),
                             font=("Segoe UI", 10, "bold"),
                             text_color=n.get("color", C["text"]),
                             anchor="w")
                title_lbl.pack(anchor="w")

                if n.get("detail"):
                    ctk.CTkLabel(text_frame, text=n["detail"],
                                 font=("Segoe UI", 9),
                                 text_color=C["muted"], anchor="w").pack(anchor="w")

                ts = n.get("time", "")
                if ts:
                    ctk.CTkLabel(inner, text=ts, font=("Segoe UI", 8),
                                 text_color=C["muted"]).pack(side="right")

                # Click to navigate
                target = n.get("target")
                if target:
                    for w in (nrow, inner, icon_lbl, title_lbl):
                        w.bind("<Button-1>", lambda e, t=target: [
                            popup.destroy(),
                            setattr(self, '_notif_popup', None),
                            self._switch_tab(t)])
                        w.bind("<Enter>", lambda e, r=nrow: r.configure(fg_color=C["sidebar"]))
                        w.bind("<Leave>", lambda e, r=nrow: r.configure(fg_color=C["card_alt"]))

        # Mark all as read
        self._notif_unread = 0
        self._update_bell_badge()

        # Close on click elsewhere (after brief delay to avoid immediate close)
        popup.after(300, lambda: popup.bind("<FocusOut>", lambda e: None))

    def _update_bell_badge(self):
        """Update the bell badge count."""
        if self._notif_unread > 0:
            self._bell_badge.configure(text=str(min(self._notif_unread, 99)))
            self._bell_badge.place(relx=0.65, rely=0.0)
        else:
            self._bell_badge.place_forget()

    def _clear_notifications(self):
        """Clear all notifications."""
        self._notif_items.clear()
        self._notif_unread = 0
        self._update_bell_badge()
        if self._notif_popup and self._notif_popup.winfo_exists():
            self._notif_popup.destroy()
            self._notif_popup = None

    def _push_notifications(self, jobs, enquiries, quotes, invoices, finance):
        """Build notification items from live data — called during dashboard render."""
        now = datetime.now().strftime("%H:%M")
        items = []

        # Unpaid invoices
        unpaid = [inv for inv in invoices
                  if str(inv.get("status", inv.get("paid", ""))).lower()
                  not in ("paid", "yes", "true", "void")]
        if unpaid:
            outstanding = sum(_safe_float(i.get("amount", i.get("total", 0))) for i in unpaid)
            items.append({
                "icon": "🧾", "title": f"{len(unpaid)} unpaid invoice(s)",
                "detail": f"£{outstanding:,.0f} outstanding",
                "color": C["danger"], "target": "finance", "time": now,
                "priority": 1
            })

        # New enquiries
        new_enq = [e for e in enquiries if e.get("status", "New").lower() == "new"]
        if new_enq:
            latest = new_enq[0].get("name", new_enq[0].get("Name", ""))
            items.append({
                "icon": "📩", "title": f"{len(new_enq)} new enquir{'ies' if len(new_enq) > 1 else 'y'}",
                "detail": f"Latest: {latest}" if latest else None,
                "color": C["warning"], "target": "enquiries", "time": now,
                "priority": 2
            })

        # Pending quotes
        pending_q = [q for q in quotes
                     if q.get("status", "").lower() in ("pending", "sent", "new", "")]
        if pending_q:
            items.append({
                "icon": "💬", "title": f"{len(pending_q)} pending quote(s)",
                "detail": "Review and follow up",
                "color": C["warning"], "target": "quotes", "time": now,
                "priority": 3
            })

        # Today's jobs needing action
        active_jobs = [j for j in jobs
                       if j.get("status", "").lower() not in ("completed", "complete", "invoiced", "cancelled")]
        if active_jobs:
            items.append({
                "icon": "📋", "title": f"{len(active_jobs)} job(s) need action today",
                "detail": ", ".join(j.get("clientName", j.get("name", ""))[:15] for j in active_jobs[:3]),
                "color": C["accent2"], "target": "today", "time": now,
                "priority": 4
            })

        # Completed but not invoiced
        done_no_inv = [j for j in jobs
                       if j.get("status", "").lower() in ("completed", "complete")
                       and j.get("status", "").lower() != "invoiced"]
        if done_no_inv:
            items.append({
                "icon": "✅", "title": f"{len(done_no_inv)} completed — awaiting invoice",
                "detail": ", ".join(j.get("clientName", j.get("name", ""))[:15] for j in done_no_inv[:3]),
                "color": C["success"], "target": "today", "time": now,
                "priority": 2
            })

        # PC offline warning
        if not self._pc_online:
            items.append({
                "icon": "🔴", "title": "PC Hub (Node 1) offline",
                "detail": "Commands will queue until PC comes online",
                "color": C["danger"], "target": "triggers", "time": now,
                "priority": 1
            })

        # Sort by priority
        items.sort(key=lambda x: x.get("priority", 99))

        # Only update if items changed (avoid badge flicker)
        old_titles = {n["title"] for n in self._notif_items}
        new_titles = {n["title"] for n in items}
        new_count = len(new_titles - old_titles)

        self._notif_items = items
        if new_count > 0 or self._notif_unread == 0:
            self._notif_unread = len(items)
        self._update_bell_badge()

    def _build_content_area(self):
        self._content = ctk.CTkFrame(self, fg_color=C["bg"], corner_radius=0)
        self._content.pack(fill="both", expand=True)

    def _build_status_bar(self):
        bar = ctk.CTkFrame(self, height=24, fg_color=C["bar"], corner_radius=0)
        bar.pack(side="bottom", fill="x")
        bar.pack_propagate(False)
        self._status = ctk.CTkLabel(bar, text="Ready", font=("Segoe UI", 9),
                                     text_color=C["muted"], anchor="w")
        self._status.pack(side="left", padx=10)
        self._clock = ctk.CTkLabel(bar, text="", font=("Segoe UI", 9),
                                    text_color=C["muted"])
        self._clock.pack(side="right", padx=10)
        self._tick()

    def _tick(self):
        self._clock.configure(text=datetime.now().strftime("%H:%M  %a %d %b"))
        self.after(30_000, self._tick)

    # ════════════════════════════════════════════════════════════
    #  CORE METHODS
    # ════════════════════════════════════════════════════════════

    def _start_auto_refresh(self):
        def _do():
            tab = self._current_tab
            if tab in ("dashboard", "today", "bookings", "tracking"):
                self._current_tab = None
                self._switch_tab(tab)
            # Poll for laptop-targeted commands
            self._poll_laptop_commands()
            self._auto_refresh_id = self.after(self.AUTO_REFRESH_MS, _do)
        self._auto_refresh_id = self.after(self.AUTO_REFRESH_MS, _do)

    def _poll_laptop_commands(self):
        """Poll for remote commands targeted at the field laptop."""
        def _poll():
            try:
                resp = api_get("get_remote_commands",
                               {"status": "pending", "target": "field_laptop"})
                commands = resp if isinstance(resp, list) else _safe_list(resp, "commands")
                for cmd in commands:
                    cmd_id = cmd.get("id", "")
                    cmd_type = cmd.get("command", "")
                    try:
                        result = self._execute_laptop_command(cmd_type, cmd)
                        api_post("update_remote_command", {
                            "id": cmd_id,
                            "status": "completed",
                            "result": str(result)[:500],
                            "completed_at": datetime.now().isoformat(),
                        })
                    except Exception as e:
                        api_post("update_remote_command", {
                            "id": cmd_id,
                            "status": "failed",
                            "result": str(e)[:500],
                            "completed_at": datetime.now().isoformat(),
                        })
            except Exception:
                pass
        self._threaded(_poll)

    def _execute_laptop_command(self, cmd_type, cmd):
        """Execute a command targeted at the field laptop."""
        if cmd_type == "force_refresh":
            self.after(0, lambda: self._switch_tab(self._current_tab or "dashboard"))
            return "Refreshed"
        elif cmd_type == "show_notification":
            data = cmd.get("data", "{}")
            if isinstance(data, str):
                import json as _json
                data = _json.loads(data) if data else {}
            msg = data.get("message", "Notification from PC Hub")
            self.after(0, lambda: self._show_toast(msg))
            return f"Notification shown: {msg}"
        elif cmd_type == "navigate_to_tab":
            data = cmd.get("data", "{}")
            if isinstance(data, str):
                import json as _json
                data = _json.loads(data) if data else {}
            tab = data.get("tab", "dashboard")
            self.after(0, lambda: self._switch_tab(tab))
            return f"Navigated to {tab}"
        else:
            return f"Unknown laptop command: {cmd_type}"

    def _check_pc_online(self):
        """Check node statuses via GAS heartbeat system + send our own heartbeat."""
        def _check():
            # Send our heartbeat
            try:
                import socket
                api_post("node_heartbeat", {
                    "node_id": NODE_ID,
                    "node_type": NODE_TYPE,
                    "version": VERSION,
                    "host": socket.gethostname(),
                    "uptime": "",
                    "details": f"Field App v{VERSION} ({GIT_COMMIT})",
                })
            except Exception:
                pass

            # Fetch all node statuses
            try:
                data = api_get("get_node_status")
                nodes = _safe_list(data, "nodes")
                self._node_statuses = nodes

                # Find PC Hub
                pc_node = None
                for n in nodes:
                    if n.get("node_type") == "pc" or n.get("node_id") == "pc_hub":
                        pc_node = n
                        break

                if pc_node and pc_node.get("status") == "online":
                    self._pc_online = True
                    age = pc_node.get("age_human", "")
                    self._last_pc_check = age
                    self._pc_version = pc_node.get("version", "?")
                else:
                    self._pc_online = False
                    self._pc_version = pc_node.get("version", "?") if pc_node else "?"
            except Exception:
                self._pc_online = False
            self.after(0, self._update_pc_indicator)

        self._threaded(_check)
        # Re-check every 2 minutes (heartbeat interval)
        self.after(120_000, self._check_pc_online)

    def _update_pc_indicator(self):
        if self._pc_online:
            ver = getattr(self, "_pc_version", "?")
            age = self._last_pc_check
            txt = f"🟢 PC Hub v{ver} ({age})" if age else f"🟢 PC Hub v{ver}"
            self._pc_label.configure(text=txt, text_color=C["success"])
        else:
            ver = getattr(self, "_pc_version", "?")
            txt = f"🔴 PC Hub v{ver} — Offline" if ver != "?" else "🔴 PC Hub Offline"
            self._pc_label.configure(text=txt, text_color=C["danger"])
        # Update version line
        if hasattr(self, "_version_label"):
            remote = getattr(self, "_latest_remote_commit", "")
            local = GIT_COMMIT
            if remote and remote != local:
                self._version_label.configure(
                    text=f"v{VERSION} ({local}) • Update available ({remote})",
                    text_color=C["warning"])
            else:
                self._version_label.configure(
                    text=f"v{VERSION} ({local})",
                    text_color="#445566")

    def _check_for_updates(self):
        """Check if there are newer commits on origin."""
        try:
            remote = _get_latest_remote_commit()
            self._latest_remote_commit = remote
            self.after(0, self._update_pc_indicator)  # triggers version label update
        except Exception:
            pass


    def _set_status(self, msg):
        self._status.configure(text=msg)

    def _switch_tab(self, key):
        if key is None:
            self._current_tab = None
            return
        if self._current_tab == key:
            return
        for k, btn in self._nav.items():
            btn.configure(fg_color=C["accent"] if k == key else "transparent",
                          text_color="#111" if k == key else C["text"])
        for w in self._content.winfo_children():
            w.destroy()
        self._current_tab = key
        builder = getattr(self, f"_tab_{key}", None)
        if builder:
            builder()

    def _manual_refresh(self):
        _cache.clear()
        _cache_ts.clear()
        tab = self._current_tab
        self._current_tab = None
        self._switch_tab(tab)
        self._check_pc_online()
        self._set_status("🔄 Refreshed (cache cleared)")

    def _threaded(self, fn, *args):
        threading.Thread(target=fn, args=args, daemon=True).start()

    def _error_card(self, parent, msg):
        self._set_status("⚠️ Error")
        ctk.CTkLabel(parent, text=f"⚠️ {msg}", font=("Segoe UI", 12),
                     text_color=C["danger"], wraplength=500).pack(pady=20)

    def _section(self, parent, title, subtitle=None):
        ctk.CTkLabel(parent, text=title, font=("Segoe UI", 18, "bold"),
                     text_color=C["text"]).pack(anchor="w", pady=(0, 2))
        if subtitle:
            ctk.CTkLabel(parent, text=subtitle, font=("Segoe UI", 10),
                         text_color=C["muted"]).pack(anchor="w", pady=(0, 8))

    def _kpi_card(self, parent, icon, value, label, color=None, command=None):
        """Create a clickable KPI card widget."""
        card = ctk.CTkFrame(parent, fg_color=C["card"], corner_radius=8, height=72)
        card.pack(side="left", padx=3, expand=True, fill="x")
        card.pack_propagate(False)
        val_lbl = ctk.CTkLabel(card, text=str(value), font=("Segoe UI", 20, "bold"),
                     text_color=color or C["accent"])
        val_lbl.pack(pady=(8, 0))
        txt_lbl = ctk.CTkLabel(card, text=f"{icon} {label}", font=("Segoe UI", 9),
                     text_color=C["muted"])
        txt_lbl.pack()
        if command:
            card.configure(cursor="hand2")
            for w in (card, val_lbl, txt_lbl):
                w.bind("<Button-1>", lambda e, c=command: c())
                w.bind("<Enter>", lambda e, c=card: c.configure(fg_color=C["card_alt"]))
                w.bind("<Leave>", lambda e, c=card: c.configure(fg_color=C["card"]))
        return card

    # ════════════════════════════════════════════════════════════
    #  TAB: Dashboard — Full Ops Overview
    # ════════════════════════════════════════════════════════════
    def _tab_dashboard(self):
        frame = ctk.CTkScrollableFrame(self._content, fg_color=C["bg"])
        frame.pack(fill="both", expand=True, padx=12, pady=12)

        # Header with node status
        hdr = ctk.CTkFrame(frame, fg_color="transparent")
        hdr.pack(fill="x", pady=(0, 8))
        ctk.CTkLabel(hdr, text=f"Operations Dashboard — {datetime.now().strftime('%A %d %B %Y')}",
                     font=("Segoe UI", 18, "bold"), text_color=C["text"]).pack(side="left")
        nodes = ctk.CTkFrame(hdr, fg_color=C["card"], corner_radius=6)
        nodes.pack(side="right")
        pc_color = C["success"] if self._pc_online else C["danger"]
        ctk.CTkLabel(nodes, text="🖥️ PC", font=("Segoe UI", 9, "bold"),
                     text_color=pc_color).pack(side="left", padx=(8, 4), pady=4)
        ctk.CTkLabel(nodes, text="💻 Laptop", font=("Segoe UI", 9, "bold"),
                     text_color=C["success"]).pack(side="left", padx=4, pady=4)
        ctk.CTkLabel(nodes, text="📱 Mobile", font=("Segoe UI", 9, "bold"),
                     text_color=C["cyan"]).pack(side="left", padx=(4, 8), pady=4)

        # KPI row placeholder
        self._dash_kpi = ctk.CTkFrame(frame, fg_color="transparent")
        self._dash_kpi.pack(fill="x", pady=(0, 8))

        # Two-column area: Today's Jobs | Alerts + Weather
        cols = ctk.CTkFrame(frame, fg_color="transparent")
        cols.pack(fill="x", pady=(0, 8))

        self._dash_jobs = ctk.CTkFrame(cols, fg_color=C["card"], corner_radius=8)
        self._dash_jobs.pack(side="left", fill="both", expand=True, padx=(0, 4))

        right = ctk.CTkFrame(cols, fg_color="transparent", width=320)
        right.pack(side="right", fill="y", padx=(4, 0))
        right.pack_propagate(False)

        self._dash_alerts = ctk.CTkFrame(right, fg_color=C["card"], corner_radius=8)
        self._dash_alerts.pack(fill="x", pady=(0, 4))

        self._dash_weather = ctk.CTkFrame(right, fg_color=C["card"], corner_radius=8)
        self._dash_weather.pack(fill="x", pady=(4, 0))

        # Activity feed
        act_hdr = ctk.CTkFrame(frame, fg_color="transparent")
        act_hdr.pack(fill="x", pady=(8, 4))
        ctk.CTkLabel(act_hdr, text="📡 Recent Activity", font=("Segoe UI", 14, "bold"),
                     text_color=C["text"]).pack(side="left")
        # Filter buttons added during render
        self._dash_feed_filters = ctk.CTkFrame(act_hdr, fg_color="transparent")
        self._dash_feed_filters.pack(side="right")
        self._dash_feed = ctk.CTkFrame(frame, fg_color="transparent")
        self._dash_feed.pack(fill="both", expand=True)

        # Quick actions bar
        self._dash_actions = ctk.CTkFrame(frame, fg_color=C["card"], corner_radius=8)
        self._dash_actions.pack(fill="x", pady=(8, 0))

        self._set_status("Loading dashboard...")
        self._threaded(self._load_dashboard)

    def _load_dashboard(self):
        # Fetch ALL dashboard data in parallel — ~3x faster than sequential
        raw = fetch_parallel(
            ("get_todays_jobs", {}, 30),
            ("get_mobile_activity", {"limit": "30"}, 30),
            ("get_job_tracking", {"date": datetime.now().strftime("%Y-%m-%d")}, 30),
            ("get_finance_summary", {}, 30),
            ("get_enquiries", {}, 30),
            ("get_site_analytics", {}, 60),
            ("get_weather", {}, 120),
            ("get_quotes", {}, 30),
            ("get_invoices", {}, 30),
            ("get_clients", {}, 30),
        )
        jobs = _safe_list(raw.get("get_todays_jobs", {}), "jobs")
        events = _safe_list(raw.get("get_mobile_activity", {}), "events")
        tracking = _safe_list(raw.get("get_job_tracking", {}), "records")
        finance = raw.get("get_finance_summary", {})
        enquiries = _safe_list(raw.get("get_enquiries", {}), "enquiries")
        analytics = raw.get("get_site_analytics", {})
        weather = raw.get("get_weather", {})
        quotes = _safe_list(raw.get("get_quotes", {}), "quotes")
        invoices = _safe_list(raw.get("get_invoices", {}), "invoices")
        clients = _safe_list(raw.get("get_clients", {}), "clients")

        # Build unified activity feed: merge system events + recent bookings
        unified = list(events)  # start with system events
        for c in clients:
            ts_raw = str(c.get("timestamp", ""))
            if not ts_raw:
                continue
            name = c.get("name", "Unknown")
            svc = c.get("service", "")
            jn = c.get("jobNumber", "")
            status = str(c.get("status", "Pending"))
            paid = str(c.get("paid", "")).lower() in ("yes", "paid", "true")
            price = c.get("price", "")
            bk_type = c.get("type", "booking")

            # Determine icon and title based on status
            sl = status.lower()
            if sl in ("completed", "job completed"):
                icon, title = "✅", f"Job completed: {name}"
            elif sl in ("in-progress", "in progress"):
                icon, title = "🔧", f"Job in progress: {name}"
            elif sl == "cancelled":
                icon, title = "❌", f"Booking cancelled: {name}"
            elif sl == "invoiced":
                icon, title = "🧾", f"Invoice sent: {name}"
            else:
                icon, title = "📋", f"New booking: {name}"

            detail_parts = []
            if svc:
                detail_parts.append(svc)
            if price:
                detail_parts.append(f"£{price}")
            if paid:
                detail_parts.append("💚 Paid")
            elif sl in ("completed", "job completed", "invoiced"):
                detail_parts.append("🔴 Unpaid")
            if jn:
                detail_parts.append(f"#{jn}")

            unified.append({
                "icon": icon,
                "title": title,
                "timestamp": ts_raw,
                "source": "booking",
                "status": status.lower(),
                "detail": " · ".join(detail_parts),
                "_sort_ts": ts_raw,
                "_is_booking": True,
            })

        # Sort unified feed by timestamp (newest first)
        def _sort_key(e):
            t = str(e.get("timestamp", e.get("_sort_ts", "")))
            return t
        unified.sort(key=_sort_key, reverse=True)

        # Build payment lookup from clients for today's jobs
        paid_lookup = {}
        for c in clients:
            jn = str(c.get("jobNumber", ""))
            if jn:
                paid_lookup[jn] = str(c.get("paid", "")).lower() in ("yes", "paid", "true")

        self.after(0, lambda: self._render_dashboard(
            jobs, unified, tracking, finance, enquiries, analytics, weather, quotes, invoices,
            paid_lookup=paid_lookup))

    def _render_dashboard(self, jobs, events, tracking, finance, enquiries,
                          analytics, weather, quotes, invoices, paid_lookup=None):
        # ── KPI Row ──
        for w in self._dash_kpi.winfo_children():
            w.destroy()

        completed = sum(1 for j in jobs if j.get("status", "").lower() in ("completed", "complete"))
        in_progress = sum(1 for j in jobs if j.get("status", "").lower() in ("in-progress", "in progress"))
        active_tracks = sum(1 for t in tracking if t.get("isActive"))

        today_rev = sum(_safe_float(j.get("price", 0)) for j in jobs
                        if j.get("status", "").lower() in ("completed", "complete"))
        total_potential = sum(_safe_float(j.get("price", 0)) for j in jobs)

        month_rev = _safe_float(finance.get("month_revenue", finance.get("monthRevenue", 0)))
        ytd_rev = _safe_float(finance.get("ytd_revenue", finance.get("ytdRevenue", 0)))
        outstanding = _safe_float(finance.get("outstanding", finance.get("outstanding_amount", 0)))

        unpaid_count = sum(1 for inv in invoices
                          if str(inv.get("status", inv.get("paid", ""))).lower()
                          not in ("paid", "yes", "true", "void"))
        pending_enq = sum(1 for e in enquiries if e.get("status", "New").lower() == "new")
        pending_quotes = sum(1 for q in quotes if q.get("status", "").lower() in ("pending", "sent", "new", ""))

        site_views = _safe_int(analytics.get("total_views", analytics.get("totalViews", 0)))

        self._kpi_card(self._dash_kpi, "📋", str(len(jobs)), "Today's Jobs", C["accent2"],
                       command=lambda: self._switch_tab("today"))
        self._kpi_card(self._dash_kpi, "✅", str(completed), "Completed", C["success"],
                       command=lambda: self._switch_tab("today"))
        self._kpi_card(self._dash_kpi, "💷", f"£{today_rev:,.0f}", "Today Rev", C["success"],
                       command=lambda: self._switch_tab("finance"))
        self._kpi_card(self._dash_kpi, "📊", f"£{month_rev:,.0f}", "Month Rev", C["accent"],
                       command=lambda: self._switch_tab("finance"))
        self._kpi_card(self._dash_kpi, "📈", f"£{ytd_rev:,.0f}", "YTD Rev", C["accent"],
                       command=lambda: self._switch_tab("finance"))
        self._kpi_card(self._dash_kpi, "🧾", f"£{outstanding:,.0f}", "Outstanding",
                       C["danger"] if outstanding > 0 else C["success"],
                       command=lambda: self._switch_tab("finance"))
        self._kpi_card(self._dash_kpi, "🌐", f"{site_views:,}", "Site Views", C["cyan"],
                       command=lambda: self._switch_tab("analytics"))

        # ── Today's Jobs (compact) ──
        for w in self._dash_jobs.winfo_children():
            w.destroy()

        hdr_jobs = ctk.CTkFrame(self._dash_jobs, fg_color="transparent")
        hdr_jobs.pack(fill="x", padx=10, pady=(8, 4))
        ctk.CTkLabel(hdr_jobs, text=f"📋 Today — {len(jobs)} Jobs (£{total_potential:,.0f} potential)",
                     font=("Segoe UI", 13, "bold"),
                     text_color=C["text"]).pack(side="left")
        ctk.CTkButton(hdr_jobs, text="🔄", height=24, width=24,
                       fg_color="transparent", hover_color=C["card_alt"],
                       font=("Segoe UI", 12),
                       command=lambda: [self.__dict__.__setitem__('_current_tab', None), self._switch_tab("dashboard")]).pack(side="right")

        if not jobs:
            ctk.CTkLabel(self._dash_jobs, text="No jobs today",
                         font=("Segoe UI", 11), text_color=C["muted"]).pack(pady=10)
            ctk.CTkButton(self._dash_jobs, text="➕ New Booking", height=28, width=120,
                          fg_color=C["accent"], hover_color="#2563eb",
                          font=("Segoe UI", 10),
                          command=lambda: self._switch_tab("bookings")).pack(pady=(0,8))
        else:
            for j in jobs[:8]:
                row = ctk.CTkFrame(self._dash_jobs, fg_color=C["card_alt"], corner_radius=4)
                row.pack(fill="x", padx=6, pady=2)
                inner = ctk.CTkFrame(row, fg_color="transparent")
                inner.pack(fill="x", padx=8, pady=4)
                name = j.get("clientName") or j.get("name", "?")
                time_s = j.get("time", "")
                st = j.get("status", "scheduled")
                ref = j.get("ref") or j.get("jobNumber", "")
                price = _safe_float(j.get("price", 0))
                s_colors = {"completed": C["success"], "in-progress": C["warning"],
                            "en-route": C["accent2"], "scheduled": C["muted"]}
                lbl = f"⏰ {time_s}  {name}" if time_s else name
                ctk.CTkLabel(inner, text=lbl, font=("Segoe UI", 11),
                             text_color=C["text"]).pack(side="left")
                if price:
                    ctk.CTkLabel(inner, text=f"£{price:,.0f}", font=("Segoe UI", 10, "bold"),
                                 text_color=C["success"]).pack(side="right")
                # Payment status badge
                is_paid = (paid_lookup or {}).get(ref, False) if ref else False
                if st.lower() in ("completed", "complete", "invoiced"):
                    pay_text = "Paid" if is_paid else "Unpaid"
                    pay_clr = C["success"] if is_paid else C["danger"]
                    ctk.CTkLabel(inner, text=pay_text, font=("Segoe UI", 8, "bold"),
                                 text_color=pay_clr, fg_color=C["card"],
                                 corner_radius=3, width=44).pack(side="right", padx=3)
                ctk.CTkLabel(inner, text=st.title(), font=("Segoe UI", 9),
                             text_color=s_colors.get(st.lower(), C["muted"])).pack(side="right", padx=6)
                # Action buttons row
                acts = ctk.CTkFrame(row, fg_color="transparent")
                acts.pack(fill="x", padx=8, pady=(0, 4))
                sl = st.lower()
                if sl not in ("completed", "complete", "invoiced"):
                    if sl not in ("in-progress", "in progress", "en-route"):
                        ctk.CTkButton(acts, text="🚗 En Route", height=22, width=80,
                                       fg_color=C["accent2"], hover_color="#2563eb",
                                       font=("Segoe UI", 9),
                                       command=lambda r=ref: self._en_route_job(r)).pack(side="left", padx=(0,3))
                    if sl not in ("in-progress", "in progress"):
                        ctk.CTkButton(acts, text="▶ Start", height=22, width=65,
                                       fg_color=C["warning"], hover_color="#d97706", text_color="#111",
                                       font=("Segoe UI", 9),
                                       command=lambda r=ref: self._en_route_then_start(r)).pack(side="left", padx=(0,3))
                    ctk.CTkButton(acts, text="✅ Done", height=22, width=65,
                                   fg_color=C["success"], hover_color="#059669",
                                   font=("Segoe UI", 9),
                                   command=lambda r=ref: self._complete_job(r)).pack(side="left", padx=(0,3))
                if sl in ("completed", "complete"):
                    ctk.CTkButton(acts, text="💷 Invoice", height=22, width=75,
                                   fg_color=C["purple"], hover_color="#9333ea",
                                   font=("Segoe UI", 9),
                                   command=lambda j2=j: self._send_invoice_from_field(j2)).pack(side="left", padx=(0,3))
                maps_url = j.get("googleMapsUrl", "")
                if maps_url:
                    ctk.CTkButton(acts, text="🗺️", height=22, width=30,
                                   fg_color=C["card"], hover_color="#2a3a5c",
                                   command=lambda u=maps_url: os.startfile(u)).pack(side="right")
            if len(jobs) > 8:
                ctk.CTkLabel(self._dash_jobs, text=f"+ {len(jobs)-8} more...",
                             font=("Segoe UI", 9), text_color=C["muted"]).pack(pady=2)
        # View all button
        ctk.CTkButton(self._dash_jobs, text="View All Jobs →", height=26, width=130,
                       fg_color=C["accent"], hover_color="#2563eb",
                       font=("Segoe UI", 10, "bold"),
                       command=lambda: self._switch_tab("today")).pack(pady=(4,8))

        # ── Alerts ──
        for w in self._dash_alerts.winfo_children():
            w.destroy()
        ctk.CTkLabel(self._dash_alerts, text="🔔 Alerts", font=("Segoe UI", 13, "bold"),
                     text_color=C["text"]).pack(anchor="w", padx=10, pady=(8, 4))

        alerts = []
        if in_progress > 0:
            alerts.append((f"🔨 {in_progress} job(s) in progress →", C["warning"], "today"))
        if active_tracks > 0:
            alerts.append((f"⏱️ {active_tracks} active timer(s) →", C["orange"], "tracking"))
        if unpaid_count > 0:
            alerts.append((f"🧾 {unpaid_count} unpaid invoice(s) (£{outstanding:,.0f}) →", C["danger"], "finance"))
        if pending_enq > 0:
            alerts.append((f"📩 {pending_enq} new enquir{'ies' if pending_enq > 1 else 'y'} →", C["warning"], "enquiries"))
        if pending_quotes > 0:
            alerts.append((f"💬 {pending_quotes} pending quote(s) →", C["warning"], "quotes"))
        if not self._pc_online:
            alerts.append(("🔴 PC Hub (Node 1) is offline", C["danger"], "triggers"))

        if not alerts:
            ctk.CTkLabel(self._dash_alerts, text="✅ All clear — no alerts",
                         font=("Segoe UI", 11), text_color=C["success"]).pack(padx=10, pady=6)
        else:
            for text, color, target in alerts:
                abtn = ctk.CTkButton(self._dash_alerts, text=text, font=("Segoe UI", 10),
                                      text_color=color, fg_color="transparent",
                                      hover_color=C["card_alt"], anchor="w", height=24,
                                      cursor="hand2",
                                      command=lambda t=target: self._switch_tab(t))
                abtn.pack(fill="x", padx=6, pady=1)
        # Padding at bottom
        ctk.CTkFrame(self._dash_alerts, height=6, fg_color="transparent").pack()

        # ── Weather ──
        for w in self._dash_weather.winfo_children():
            w.destroy()
        ctk.CTkLabel(self._dash_weather, text="🌤️ Weather", font=("Segoe UI", 13, "bold"),
                     text_color=C["text"]).pack(anchor="w", padx=10, pady=(8, 4))
        if weather and isinstance(weather, dict):
            temp = weather.get("temperature", weather.get("temp", "?"))
            cond = weather.get("condition", weather.get("description", ""))
            wind = weather.get("wind", weather.get("windSpeed", ""))
            rain = weather.get("rain_chance", weather.get("rainChance", ""))
            w_text = f"🌡️ {temp}°C  {cond}"
            if wind:
                w_text += f"  💨 {wind}"
            if rain:
                w_text += f"  🌧️ {rain}% rain"
            w_lbl = ctk.CTkLabel(self._dash_weather, text=w_text, font=("Segoe UI", 11),
                         text_color=C["text"], wraplength=300)
            w_lbl.pack(anchor="w", padx=10, pady=(0, 4))
            # Outdoor work advice
            try:
                t = float(weather.get("temperature", weather.get("temp", 0)))
                rc = float(weather.get("rain_chance", weather.get("rainChance", 0)))
                if rc > 60:
                    advice = "🌧️ High rain chance — consider rescheduling outdoor work"
                    adv_clr = C["danger"]
                elif rc > 30:
                    advice = "🌦️ Moderate rain risk — have wet weather gear ready"
                    adv_clr = C["warning"]
                elif t > 28:
                    advice = "☀️ Hot — schedule breaks, stay hydrated"
                    adv_clr = C["warning"]
                elif t < 3:
                    advice = "❄️ Near freezing — check for frost/ice on site"
                    adv_clr = C["cyan"]
                else:
                    advice = "✅ Good conditions for outdoor work"
                    adv_clr = C["success"]
                ctk.CTkLabel(self._dash_weather, text=advice, font=("Segoe UI", 9),
                             text_color=adv_clr).pack(anchor="w", padx=10, pady=(0, 6))
            except (ValueError, TypeError):
                pass
        else:
            ctk.CTkLabel(self._dash_weather, text="No weather data",
                         font=("Segoe UI", 10), text_color=C["muted"]).pack(padx=10, pady=6)

        # ── Activity Feed ──
        for w in self._dash_feed.winfo_children():
            w.destroy()
        if not events:
            ctk.CTkLabel(self._dash_feed, text="No recent activity",
                         font=("Segoe UI", 11), text_color=C["muted"]).pack(pady=8)
        else:
            for ev in events[:30]:
                is_booking = ev.get("_is_booking", False)
                row = ctk.CTkFrame(self._dash_feed, fg_color=C["card"], corner_radius=4)
                row.pack(fill="x", pady=1)
                row.configure(cursor="hand2")
                inner = ctk.CTkFrame(row, fg_color="transparent")
                inner.pack(fill="x", padx=8, pady=4)
                icon = ev.get("icon", "•")
                title = ev.get("title", "")
                ts = ev.get("timestamp", "")[:16]
                source = ev.get("source", "")
                status = ev.get("status", "")

                # Status colour mapping
                if is_booking:
                    st_map = {"completed": C["success"], "job completed": C["success"],
                              "in-progress": C["warning"], "in progress": C["warning"],
                              "pending": C["accent2"], "invoiced": C["purple"],
                              "cancelled": C["danger"]}
                    st_color = st_map.get(status, C["accent2"])
                else:
                    st_color = C["success"] if status == "completed" else C["warning"] if status == "running" else C["muted"]

                title_lbl = ctk.CTkLabel(inner, text=f"{icon}  {title}", font=("Segoe UI", 10),
                             text_color=C["text"])
                title_lbl.pack(side="left")

                src_colors = {"mobile": C["orange"], "laptop": C["accent2"],
                              "pc": C["purple"], "booking": C["cyan"]}
                if status:
                    ctk.CTkLabel(inner, text=f"● {status.title()}", font=("Segoe UI", 8, "bold"),
                                 text_color=st_color).pack(side="right", padx=(4, 0))
                if source:
                    ctk.CTkLabel(inner, text=source, font=("Segoe UI", 8, "bold"),
                                 text_color=src_colors.get(source, C["muted"])).pack(side="right", padx=(4, 0))
                if ts:
                    ctk.CTkLabel(inner, text=ts, font=("Segoe UI", 8),
                                 text_color=C["muted"]).pack(side="right")
                detail = ev.get("detail", "")
                if detail:
                    ctk.CTkLabel(row, text=detail, font=("Segoe UI", 9),
                                 text_color=C["muted"], wraplength=600).pack(anchor="w", padx=8, pady=(0, 2))
                # Click — bookings navigate to relevant tab, system events show detail popup
                if is_booking:
                    for w2 in (row, inner, title_lbl):
                        w2.bind("<Button-1>", lambda e, s=status: self._switch_tab(
                            "finance" if s in ("invoiced", "completed", "job completed") else "today"))
                        w2.bind("<Enter>", lambda e, r=row: r.configure(fg_color=C["card_alt"]))
                        w2.bind("<Leave>", lambda e, r=row: r.configure(fg_color=C["card"]))
                else:
                    for w2 in (row, inner, title_lbl):
                        w2.bind("<Button-1>", lambda e, ev2=ev: self._show_event_detail(ev2))
                        w2.bind("<Enter>", lambda e, r=row: r.configure(fg_color=C["card_alt"]))
                        w2.bind("<Leave>", lambda e, r=row: r.configure(fg_color=C["card"]))

        # ── Quick Actions ──
        for w in self._dash_actions.winfo_children():
            w.destroy()
        ctk.CTkLabel(self._dash_actions, text="⚡ Quick Actions", font=("Segoe UI", 12, "bold"),
                     text_color=C["text"]).pack(anchor="w", padx=10, pady=(6, 4))
        btn_row = ctk.CTkFrame(self._dash_actions, fg_color="transparent")
        btn_row.pack(fill="x", padx=8, pady=(0, 8))

        row1 = [
            ("📋 Morning Brief", lambda: self._quick_briefing(), C["accent"]),
            ("⏰ Reminders", lambda: self._fire_trigger("send_reminders"), C["warning"]),
            ("📧 Email Lifecycle", lambda: self._fire_trigger("run_email_lifecycle"), C["accent2"]),
            ("🔄 Force Sync", lambda: self._fire_trigger("force_sync"), C["card_alt"]),
            ("📝 Blog Post", lambda: self._fire_trigger("generate_blog"), C["card_alt"]),
        ]
        for text, cmd, clr in row1:
            ctk.CTkButton(btn_row, text=text, height=30, width=130,
                           fg_color=clr, hover_color="#2a3a5c",
                           font=("Segoe UI", 10, "bold"), command=cmd).pack(side="left", padx=2)
        # Second row of navigation shortcuts
        btn_row2 = ctk.CTkFrame(self._dash_actions, fg_color="transparent")
        btn_row2.pack(fill="x", padx=8, pady=(0, 8))
        nav_shortcuts = [
            ("📋 Today", "today"), ("📅 Bookings", "bookings"), ("💰 Finance", "finance"),
            ("📩 Enquiries", "enquiries"), ("💬 Quotes", "quotes"),
            ("👥 Clients", "clients"), ("📊 Analytics", "analytics"),
        ]
        for text, tab in nav_shortcuts:
            ctk.CTkButton(btn_row2, text=text, height=26, width=100,
                           fg_color=C["card_alt"], hover_color=C["accent"],
                           font=("Segoe UI", 9),
                           command=lambda t=tab: self._switch_tab(t)).pack(side="left", padx=2)

        self._set_status(f"Dashboard: {len(jobs)} jobs, £{total_potential:,.0f} potential, {len(events)} events")

        # Push notifications from live data
        self._push_notifications(jobs, enquiries, quotes, invoices, finance)

    def _quick_briefing(self):
        """Send morning briefing via PC command queue."""
        try:
            send_pc_command("send_reminders", {"type": "morning_briefing"})
            self._set_status("📋 Morning briefing queued on PC")
        except Exception as e:
            messagebox.showerror("Error", str(e))

    def _fire_trigger(self, cmd, data=None):
        """Quick-fire a PC trigger."""
        try:
            send_pc_command(cmd, data or {})
            self._set_status(f"✅ {cmd} queued on PC")
        except Exception as e:
            messagebox.showerror("Error", str(e))

    def _en_route_then_start(self, ref):
        """En route shortcut from dashboard — starts the job."""
        try:
            api_post("mobile_start_job", {"jobRef": ref, "startTime": datetime.now().isoformat()})
            self._set_status(f"▶ Started {ref}")
            self._current_tab = None; self._switch_tab("dashboard")
        except Exception as e:
            messagebox.showerror("Error", str(e))

    def _show_event_detail(self, ev):
        """Show a popup with full event details."""
        win = ctk.CTkToplevel(self)
        win.title("Event Detail")
        win.geometry("480x360")
        win.configure(fg_color=C["bg"])
        win.attributes("-topmost", True)
        win.after(200, lambda: win.attributes("-topmost", False))

        ctk.CTkLabel(win, text=f"{ev.get('icon', '•')}  {ev.get('title', '')}",
                     font=("Segoe UI", 16, "bold"), text_color=C["text"]).pack(padx=16, pady=(16, 8))

        fields = [
            ("Status", ev.get("status", "—")),
            ("Source", ev.get("source", "—")),
            ("Timestamp", ev.get("timestamp", "—")),
            ("Detail", ev.get("detail", "—")),
            ("Command", ev.get("command", ev.get("action", "—"))),
            ("Result", ev.get("result", "—")),
            ("Duration", ev.get("duration", "—")),
        ]
        for label, val in fields:
            if val and val != "—":
                row = ctk.CTkFrame(win, fg_color="transparent")
                row.pack(fill="x", padx=16, pady=1)
                ctk.CTkLabel(row, text=f"{label}:", font=("Segoe UI", 10, "bold"),
                             text_color=C["muted"], width=80, anchor="w").pack(side="left")
                ctk.CTkLabel(row, text=str(val), font=("Segoe UI", 10),
                             text_color=C["text"], wraplength=350).pack(side="left", fill="x")

        ctk.CTkButton(win, text="Close", height=30, width=100,
                       fg_color=C["accent"], command=win.destroy).pack(pady=16)

    # ════════════════════════════════════════════════════════════
    #  TAB: Today's Jobs
    # ════════════════════════════════════════════════════════════
    def _tab_today(self):
        frame = ctk.CTkScrollableFrame(self._content, fg_color=C["bg"])
        frame.pack(fill="both", expand=True, padx=12, pady=12)
        self._section(frame, f"Today's Jobs — {datetime.now().strftime('%A %d %B %Y')}",
                      "Live data shared with mobile app. Status syncs across all nodes.")
        self._today_frame = frame
        self._set_status("Loading today's jobs...")
        self._threaded(self._load_today)

    def _load_today(self):
        try:
            data = api_get_cached("get_todays_jobs")
            jobs = _safe_list(data, "jobs")
        except Exception as e:
            self.after(0, lambda: self._error_card(self._today_frame, str(e)))
            return
        self.after(0, lambda: self._render_today(jobs))

    def _render_today(self, jobs):
        self._set_status(f"{len(jobs)} job(s) today")
        if not jobs:
            ctk.CTkLabel(self._today_frame, text="No jobs scheduled for today.",
                         font=("Segoe UI", 13), text_color=C["muted"]).pack(pady=30)
            return

        total = sum(_safe_float(j.get("price", 0)) for j in jobs)
        ctk.CTkLabel(self._today_frame, text=f"Potential revenue: £{total:,.2f}",
                     font=("Segoe UI", 11, "bold"), text_color=C["success"]).pack(anchor="e", pady=(0, 6))

        for i, job in enumerate(jobs):
            self._render_job_card(self._today_frame, job, i)

    def _render_job_card(self, parent, job, idx):
        """Render a full interactive job card with all action buttons."""
        card = ctk.CTkFrame(parent, fg_color=C["card"], corner_radius=8)
        card.pack(fill="x", pady=3)

        top = ctk.CTkFrame(card, fg_color="transparent")
        top.pack(fill="x", padx=10, pady=(8, 3))

        name = job.get("clientName") or job.get("name", "Unknown")
        time_s = job.get("time", "")
        status = job.get("status", "scheduled")
        ref = job.get("ref") or job.get("jobNumber", "")

        s_colors = {"completed": C["success"], "in-progress": C["warning"],
                    "invoiced": C["purple"], "cancelled": C["danger"],
                    "scheduled": C["accent2"], "en-route": C["accent2"]}

        ctk.CTkLabel(top, text=f"#{idx+1}  {name}",
                     font=("Segoe UI", 13, "bold"), text_color=C["text"]).pack(side="left")
        ctk.CTkLabel(top, text=status.title(), font=("Segoe UI", 10, "bold"),
                     text_color=s_colors.get(status.lower(), C["muted"])).pack(side="right")
        if time_s:
            ctk.CTkLabel(top, text=f"⏰ {time_s}", font=("Segoe UI", 10),
                         text_color=C["accent"]).pack(side="right", padx=8)

        det = ctk.CTkFrame(card, fg_color="transparent")
        det.pack(fill="x", padx=10, pady=(0, 3))
        service = job.get("service") or job.get("serviceName", "")
        address = job.get("address", "")
        postcode = job.get("postcode", "")
        loc = f"{address}, {postcode}" if address and postcode else address or postcode
        if service:
            ctk.CTkLabel(det, text=f"🔧 {service}", font=("Segoe UI", 10),
                         text_color=C["muted"]).pack(side="left", padx=(0, 12))
        if loc:
            ctk.CTkLabel(det, text=f"📍 {loc}", font=("Segoe UI", 10),
                         text_color=C["muted"]).pack(side="left")
        price = _safe_float(job.get("price", 0))
        if price:
            ctk.CTkLabel(det, text=f"£{price:,.2f}", font=("Segoe UI", 11, "bold"),
                         text_color=C["success"]).pack(side="right")
        if ref:
            ctk.CTkLabel(det, text=ref, font=("Segoe UI", 8),
                         text_color=C["muted"]).pack(side="right", padx=8)

        notes = job.get("notes", "")
        if notes:
            ctk.CTkLabel(card, text=f"📌 {notes}", font=("Segoe UI", 9),
                         text_color=C["muted"], wraplength=600).pack(anchor="w", padx=10, pady=(0, 4))

        # Action buttons
        actions = ctk.CTkFrame(card, fg_color="transparent")
        actions.pack(fill="x", padx=10, pady=(0, 6))
        st = status.lower()

        if st not in ("completed", "complete", "invoiced"):
            if st not in ("in-progress", "in progress", "en-route"):
                ctk.CTkButton(actions, text="🚗 En Route", height=26, width=90,
                               fg_color=C["accent2"], hover_color="#2563eb",
                               font=("Segoe UI", 10),
                               command=lambda r=ref: self._en_route_job(r)).pack(side="left", padx=(0, 4))
            if st not in ("in-progress", "in progress"):
                ctk.CTkButton(actions, text="▶ Start", height=26, width=80,
                               fg_color=C["warning"], hover_color="#d97706", text_color="#111",
                               font=("Segoe UI", 10),
                               command=lambda r=ref: self._start_job(r)).pack(side="left", padx=(0, 4))
            ctk.CTkButton(actions, text="✅ Complete", height=26, width=90,
                           fg_color=C["success"], hover_color="#059669",
                           font=("Segoe UI", 10),
                           command=lambda r=ref: self._complete_job(r)).pack(side="left", padx=(0, 4))

        if st in ("completed", "complete"):
            ctk.CTkButton(actions, text="📧 Completion Email", height=26, width=140,
                           fg_color=C["accent2"], hover_color="#2563eb",
                           font=("Segoe UI", 10),
                           command=lambda j=job: self._trigger_completion_email(j)).pack(side="left", padx=(0, 4))
            ctk.CTkButton(actions, text="💷 Invoice", height=26, width=90,
                           fg_color=C["purple"], hover_color="#9333ea",
                           font=("Segoe UI", 10),
                           command=lambda j=job: self._send_invoice_from_field(j)).pack(side="left")

        maps_url = job.get("googleMapsUrl", "")
        if maps_url:
            ctk.CTkButton(actions, text="🗺️", height=26, width=36,
                           fg_color=C["card_alt"], hover_color="#2a3a5c",
                           command=lambda u=maps_url: os.startfile(u)).pack(side="right")

    def _en_route_job(self, ref):
        try:
            api_post("mobile_update_job_status", {"jobRef": ref, "status": "en-route",
                      "notes": f"En route from laptop {datetime.now().strftime('%H:%M')}"})
            self._set_status(f"🚗 En route → {ref}")
            self._current_tab = None; self._switch_tab("today")
        except Exception as e:
            messagebox.showerror("Error", str(e))

    def _start_job(self, ref):
        try:
            api_post("mobile_start_job", {"jobRef": ref, "startTime": datetime.now().isoformat()})
            self._set_status(f"▶ Started {ref}")
            self._current_tab = None; self._switch_tab("today")
        except Exception as e:
            messagebox.showerror("Error", str(e))

    def _complete_job(self, ref):
        try:
            api_post("mobile_complete_job", {"jobRef": ref, "endTime": datetime.now().isoformat()})
            self._set_status(f"✅ Completed {ref}")
            self._current_tab = None; self._switch_tab("today")
        except Exception as e:
            messagebox.showerror("Error", str(e))

    def _trigger_completion_email(self, job):
        try:
            send_pc_command("send_completion", {"job": job})
            self._set_status(f"📧 Completion email queued for {job.get('clientName', '')}")
        except Exception as e:
            messagebox.showerror("Error", str(e))

    def _send_invoice_from_field(self, job):
        try:
            api_post("mobile_send_invoice", {
                "jobRef": job.get("ref") or job.get("jobNumber", ""),
                "clientName": job.get("clientName") or job.get("name", ""),
                "clientEmail": job.get("clientEmail") or job.get("email", ""),
                "service": job.get("service") or job.get("serviceName", ""),
                "amount": job.get("price") or job.get("total", ""),
            })
            self._set_status(f"💷 Invoice sent for {job.get('clientName', '')}")
            self._current_tab = None; self._switch_tab("today")
        except Exception as e:
            messagebox.showerror("Error", str(e))

    # ════════════════════════════════════════════════════════════
    #  TAB: Bookings
    # ════════════════════════════════════════════════════════════
    def _tab_bookings(self):
        frame = ctk.CTkScrollableFrame(self._content, fg_color=C["bg"])
        frame.pack(fill="both", expand=True, padx=12, pady=12)
        self._section(frame, "Bookings", "Unified view — today + schedule + enquiries")

        filt = ctk.CTkFrame(frame, fg_color="transparent")
        filt.pack(fill="x", pady=(0, 8))
        self._booking_filter = "all"
        for label, fval, col in [("All", "all", C["accent"]), ("New", "new", C["warning"]),
                                  ("Confirmed", "confirmed", C["success"]),
                                  ("Completed", "completed", C["purple"])]:
            ctk.CTkButton(filt, text=label, width=75, height=26,
                           fg_color=col if fval == "all" else C["card"],
                           text_color="#111" if fval == "all" else C["text"],
                           font=("Segoe UI", 10),
                           command=lambda f=fval: self._load_bookings_filtered(f)).pack(side="left", padx=2)

        self._bookings_frame = ctk.CTkFrame(frame, fg_color="transparent")
        self._bookings_frame.pack(fill="both", expand=True)
        self._threaded(self._load_bookings)

    def _load_bookings_filtered(self, fval):
        self._booking_filter = fval
        for w in self._bookings_frame.winfo_children():
            w.destroy()
        self._threaded(self._load_bookings)

    def _load_bookings(self):
        # Fetch all 3 sources in parallel
        raw = fetch_parallel(
            ("get_todays_jobs", {}, 30),
            ("get_enquiries", {}, 30),
            ("get_schedule", {"days": "14"}, 30),
        )
        jobs = _safe_list(raw.get("get_todays_jobs", {}), "jobs")
        enqs = _safe_list(raw.get("get_enquiries", {}), "enquiries")
        sd = raw.get("get_schedule", {})
        upcoming = sd.get("jobs", sd.get("visits", [])) if isinstance(sd, dict) else (sd if isinstance(sd, list) else [])

        bookings, seen = [], set()
        for j in jobs:
            ref = j.get("ref") or j.get("jobNumber", "")
            if ref and ref not in seen:
                seen.add(ref); j["_source"] = "today"; bookings.append(j)
        for u in upcoming:
            ref = u.get("jobNumber") or u.get("ref", "")
            if ref and ref not in seen:
                seen.add(ref); u["_source"] = "schedule"; bookings.append(u)
        for e in enqs:
            ref = e.get("id") or e.get("name", "") + e.get("date", "")
            if ref not in seen:
                seen.add(ref); e["_source"] = "enquiry"; e.setdefault("status", "New"); bookings.append(e)

        filt = self._booking_filter
        if filt != "all":
            bookings = [b for b in bookings if filt.lower() in b.get("status", "new").lower()]

        self.after(0, lambda: self._render_bookings(bookings))

    def _render_bookings(self, bookings):
        for w in self._bookings_frame.winfo_children():
            w.destroy()
        self._set_status(f"{len(bookings)} booking(s)")
        if not bookings:
            ctk.CTkLabel(self._bookings_frame, text="No bookings matching filter.",
                         font=("Segoe UI", 12), text_color=C["muted"]).pack(pady=30)
            return

        for b in bookings[:50]:
            card = ctk.CTkFrame(self._bookings_frame, fg_color=C["card"], corner_radius=8)
            card.pack(fill="x", pady=2)
            top = ctk.CTkFrame(card, fg_color="transparent")
            top.pack(fill="x", padx=10, pady=(6, 2))
            name = b.get("clientName") or b.get("name") or b.get("client_name", "?")
            status = b.get("status", "New")
            source = b.get("_source", "")
            s_colors = {"new": C["warning"], "confirmed": C["success"], "completed": C["purple"],
                        "scheduled": C["accent2"], "cancelled": C["danger"]}
            ctk.CTkLabel(top, text=name, font=("Segoe UI", 12, "bold"),
                         text_color=C["text"]).pack(side="left")
            ctk.CTkLabel(top, text=status.title(), font=("Segoe UI", 10, "bold"),
                         text_color=s_colors.get(status.lower(), C["muted"])).pack(side="right")
            src_labels = {"today": "📋", "schedule": "📅", "enquiry": "📩"}
            ctk.CTkLabel(top, text=src_labels.get(source, ""), font=("Segoe UI", 9),
                         text_color=C["muted"]).pack(side="right", padx=4)

            det = ctk.CTkFrame(card, fg_color="transparent")
            det.pack(fill="x", padx=10, pady=(0, 2))
            date_s = b.get("date", b.get("visitDate", ""))
            service = b.get("service") or b.get("serviceName", "")
            email = b.get("email") or b.get("clientEmail", "")
            if date_s:
                ctk.CTkLabel(det, text=f"📅 {date_s}", font=("Segoe UI", 10),
                             text_color=C["accent"]).pack(side="left", padx=(0, 8))
            if service:
                ctk.CTkLabel(det, text=f"🔧 {service}", font=("Segoe UI", 10),
                             text_color=C["muted"]).pack(side="left")
            price = b.get("price") or b.get("total") or b.get("amount", "")
            if price and str(price) != "0":
                ctk.CTkLabel(det, text=f"£{price}", font=("Segoe UI", 10, "bold"),
                             text_color=C["success"]).pack(side="right")

            actions = ctk.CTkFrame(card, fg_color="transparent")
            actions.pack(fill="x", padx=10, pady=(0, 6))
            st = status.lower()
            if st in ("new", "pending", ""):
                ctk.CTkButton(actions, text="✅ Confirm", height=24, width=90,
                               fg_color=C["success"], font=("Segoe UI", 9),
                               command=lambda bk=b: self._confirm_booking(bk)).pack(side="left", padx=(0, 4))
                ctk.CTkButton(actions, text="📧 Confirmation Email", height=24, width=150,
                               fg_color=C["accent2"], font=("Segoe UI", 9),
                               command=lambda bk=b: self._send_booking_confirmation(bk)).pack(side="left", padx=(0, 4))
            if st in ("confirmed", "scheduled") and source == "enquiry":
                ctk.CTkButton(actions, text="📧 Quote", height=24, width=80,
                               fg_color=C["accent"], text_color="#111", font=("Segoe UI", 9),
                               command=lambda bk=b: self._send_quote_email(bk)).pack(side="left")
            if st not in ("completed", "complete", "invoiced", "cancelled"):
                ctk.CTkButton(actions, text="❌", height=24, width=36,
                               fg_color=C["danger"], font=("Segoe UI", 9),
                               command=lambda bk=b: self._cancel_booking(bk)).pack(side="right")

    def _confirm_booking(self, bk):
        try:
            api_post("update_booking_status", {"jobRef": bk.get("ref") or bk.get("jobNumber", ""),
                      "status": "confirmed"})
            self._set_status(f"✅ Confirmed: {bk.get('clientName', bk.get('name', ''))}")
            self._load_bookings_filtered(self._booking_filter)
        except Exception as e:
            messagebox.showerror("Error", str(e))

    def _send_booking_confirmation(self, bk):
        try:
            send_pc_command("send_booking_confirmation", {"booking": bk})
            self._set_status("📧 Confirmation queued on PC")
        except Exception as e:
            messagebox.showerror("Error", str(e))

    def _send_quote_email(self, bk):
        try:
            send_pc_command("send_quote_email", {"enquiry": bk})
            self._set_status("📧 Quote email queued on PC")
        except Exception as e:
            messagebox.showerror("Error", str(e))

    def _cancel_booking(self, bk):
        if not messagebox.askyesno("Cancel", f"Cancel {bk.get('clientName', bk.get('name', ''))}?"):
            return
        try:
            api_post("update_booking_status", {"jobRef": bk.get("ref") or bk.get("jobNumber", ""),
                                                "status": "cancelled"})
            self._set_status("❌ Booking cancelled")
            self._load_bookings_filtered(self._booking_filter)
        except Exception as e:
            messagebox.showerror("Error", str(e))

    # ════════════════════════════════════════════════════════════
    #  TAB: Schedule
    # ════════════════════════════════════════════════════════════
    def _tab_schedule(self):
        frame = ctk.CTkFrame(self._content, fg_color=C["bg"])
        frame.pack(fill="both", expand=True, padx=12, pady=12)
        header = ctk.CTkFrame(frame, fg_color="transparent")
        header.pack(fill="x", pady=(0, 8))
        ctk.CTkLabel(header, text="Schedule", font=("Segoe UI", 18, "bold"),
                     text_color=C["text"]).pack(side="left")
        self._sched_offset = 0
        nav = ctk.CTkFrame(header, fg_color="transparent")
        nav.pack(side="right")
        ctk.CTkButton(nav, text="◀", width=36, height=28, fg_color=C["card"],
                       command=lambda: self._sched_nav(-1)).pack(side="left", padx=2)
        self._sched_label = ctk.CTkLabel(nav, text="", font=("Segoe UI", 12, "bold"),
                                          text_color=C["accent"])
        self._sched_label.pack(side="left", padx=8)
        ctk.CTkButton(nav, text="▶", width=36, height=28, fg_color=C["card"],
                       command=lambda: self._sched_nav(1)).pack(side="left", padx=2)
        ctk.CTkButton(nav, text="Today", width=50, height=28,
                       fg_color=C["accent"], text_color="#111",
                       command=lambda: self._sched_nav(0, True)).pack(side="left", padx=(4, 0))

        self._sched_scroll = ctk.CTkScrollableFrame(frame, fg_color=C["bg"])
        self._sched_scroll.pack(fill="both", expand=True)
        self._load_sched_day()

    def _sched_nav(self, delta, reset=False):
        self._sched_offset = 0 if reset else self._sched_offset + delta
        self._load_sched_day()

    def _load_sched_day(self):
        target = datetime.now() + timedelta(days=self._sched_offset)
        ds = target.strftime("%Y-%m-%d")
        display = target.strftime("%A %d %b %Y")
        self._sched_label.configure(text=display)
        for w in self._sched_scroll.winfo_children():
            w.destroy()
        def _load():
            try:
                data = api_get("get_schedule", date=ds)
                jobs = _safe_list(data, "jobs") or _safe_list(data, "visits")
            except Exception as e:
                self.after(0, lambda: self._error_card(self._sched_scroll, str(e)))
                return
            self.after(0, lambda: self._render_sched(jobs, display))
        self._threaded(_load)

    def _render_sched(self, jobs, display):
        self._set_status(f"{len(jobs)} job(s) on {display}")
        for w in self._sched_scroll.winfo_children():
            w.destroy()
        if not jobs:
            ctk.CTkLabel(self._sched_scroll, text="No jobs on this day.",
                         font=("Segoe UI", 12), text_color=C["muted"]).pack(pady=30)
            return
        for job in jobs:
            card = ctk.CTkFrame(self._sched_scroll, fg_color=C["card"], corner_radius=6)
            card.pack(fill="x", pady=2)
            row = ctk.CTkFrame(card, fg_color="transparent")
            row.pack(fill="x", padx=10, pady=6)
            name = job.get("client_name") or job.get("name") or job.get("clientName", "?")
            time_s = job.get("time", job.get("start_time", ""))
            lbl = f"⏰ {time_s}  —  {name}" if time_s else name
            ctk.CTkLabel(row, text=lbl, font=("Segoe UI", 12, "bold"),
                         text_color=C["text"]).pack(side="left")
            price = _safe_float(job.get("price", job.get("amount", 0)))
            if price:
                ctk.CTkLabel(row, text=f"£{price:,.0f}", font=("Segoe UI", 11, "bold"),
                             text_color=C["success"]).pack(side="right")
            service = job.get("service") or job.get("service_type") or job.get("serviceName", "")
            if service:
                ctk.CTkLabel(row, text=service, font=("Segoe UI", 10),
                             text_color=C["muted"]).pack(side="right", padx=8)

    # ════════════════════════════════════════════════════════════
    #  TAB: Job Tracking
    # ════════════════════════════════════════════════════════════
    def _tab_tracking(self):
        frame = ctk.CTkFrame(self._content, fg_color=C["bg"])
        frame.pack(fill="both", expand=True, padx=12, pady=12)
        self._section(frame, "Job Tracking", "Time tracking from mobile app — durations, photos")
        filt = ctk.CTkFrame(frame, fg_color="transparent")
        filt.pack(fill="x", pady=(0, 8))
        for lbl, df in [("Today", datetime.now().strftime("%Y-%m-%d")),
                         ("Yesterday", (datetime.now()-timedelta(1)).strftime("%Y-%m-%d")),
                         ("All", "")]:
            ctk.CTkButton(filt, text=lbl, width=65, height=26, fg_color=C["card"],
                           font=("Segoe UI", 10),
                           command=lambda d=df: self._load_tracking(d)).pack(side="left", padx=2)
        self._track_scroll = ctk.CTkScrollableFrame(frame, fg_color=C["bg"])
        self._track_scroll.pack(fill="both", expand=True)
        self._load_tracking(datetime.now().strftime("%Y-%m-%d"))

    def _load_tracking(self, date_filter=""):
        for w in self._track_scroll.winfo_children():
            w.destroy()
        def _load():
            try:
                params = {"limit": "50"}
                if date_filter:
                    params["date"] = date_filter
                records = _safe_list(api_get("get_job_tracking", **params), "records")
            except Exception as e:
                self.after(0, lambda: self._error_card(self._track_scroll, str(e)))
                return
            self.after(0, lambda: self._render_tracking(records))
        self._threaded(_load)

    def _render_tracking(self, records):
        self._set_status(f"{len(records)} tracking record(s)")
        if not records:
            ctk.CTkLabel(self._track_scroll, text="No tracking records.",
                         font=("Segoe UI", 12), text_color=C["muted"]).pack(pady=30)
            return
        total_mins = sum(_safe_float(r.get("durationMins", 0)) for r in records)
        hrs, mins = int(total_mins // 60), int(total_mins % 60)
        summary = ctk.CTkFrame(self._track_scroll, fg_color=C["card"], corner_radius=8)
        summary.pack(fill="x", pady=(0, 8))
        si = ctk.CTkFrame(summary, fg_color="transparent")
        si.pack(fill="x", padx=10, pady=8)
        for lbl, val, col in [("Records", str(len(records)), C["accent2"]),
                               ("Total Time", f"{hrs}h {mins}m", C["accent"]),
                               ("Active", str(sum(1 for r in records if r.get("isActive"))), C["warning"]),
                               ("Photos", str(sum(_safe_int(r.get("photoCount", 0)) for r in records)), C["cyan"])]:
            f = ctk.CTkFrame(si, fg_color="transparent")
            f.pack(side="left", expand=True)
            ctk.CTkLabel(f, text=val, font=("Segoe UI", 16, "bold"), text_color=col).pack()
            ctk.CTkLabel(f, text=lbl, font=("Segoe UI", 9), text_color=C["muted"]).pack()

        for rec in records:
            card = ctk.CTkFrame(self._track_scroll, fg_color=C["card"], corner_radius=4)
            card.pack(fill="x", pady=1)
            row = ctk.CTkFrame(card, fg_color="transparent")
            row.pack(fill="x", padx=10, pady=5)
            ref = rec.get("jobRef", "?")
            active = rec.get("isActive", False)
            dur = rec.get("durationMins")
            icon = "🔴" if active else "✅"
            ctk.CTkLabel(row, text=f"{icon} {ref}", font=("Segoe UI", 11, "bold"),
                         text_color=C["text"]).pack(side="left")
            if active:
                ctk.CTkLabel(row, text="ACTIVE", font=("Segoe UI", 9, "bold"),
                             text_color=C["warning"]).pack(side="right")
            elif dur:
                ctk.CTkLabel(row, text=f"{int(dur)}m", font=("Segoe UI", 10, "bold"),
                             text_color=C["success"]).pack(side="right")

    # ════════════════════════════════════════════════════════════
    #  TAB: Clients
    # ════════════════════════════════════════════════════════════
    def _tab_clients(self):
        frame = ctk.CTkFrame(self._content, fg_color=C["bg"])
        frame.pack(fill="both", expand=True, padx=12, pady=12)
        header = ctk.CTkFrame(frame, fg_color="transparent")
        header.pack(fill="x", pady=(0, 8))
        ctk.CTkLabel(header, text="Clients", font=("Segoe UI", 18, "bold"),
                     text_color=C["text"]).pack(side="left")
        self._cli_search = ctk.CTkEntry(header, placeholder_text="Search...", width=220, height=28)
        self._cli_search.pack(side="right")
        self._cli_search.bind("<Return>", lambda e: self._filter_clients())
        ctk.CTkButton(header, text="🔍", width=32, height=28, fg_color=C["accent"],
                       text_color="#111", command=self._filter_clients).pack(side="right", padx=(0, 4))
        self._cli_scroll = ctk.CTkScrollableFrame(frame, fg_color=C["bg"])
        self._cli_scroll.pack(fill="both", expand=True)
        self._threaded(self._load_clients)

    def _load_clients(self):
        try:
            clients = _safe_list(api_get_cached("get_clients", ttl=60), "clients")
        except Exception as e:
            self.after(0, lambda: self._error_card(self._cli_scroll, str(e)))
            return
        self._cached["clients"] = clients
        self.after(0, lambda: self._render_clients(clients))

    def _filter_clients(self):
        term = self._cli_search.get().strip().lower()
        clients = self._cached.get("clients", [])
        if term:
            clients = [c for c in clients if term in json.dumps(c).lower()]
        self._render_clients(clients)

    def _render_clients(self, clients):
        for w in self._cli_scroll.winfo_children():
            w.destroy()
        self._set_status(f"{len(clients)} client(s)")
        if not clients:
            ctk.CTkLabel(self._cli_scroll, text="No clients found.",
                         font=("Segoe UI", 12), text_color=C["muted"]).pack(pady=30)
            return
        for c in clients[:100]:
            card = ctk.CTkFrame(self._cli_scroll, fg_color=C["card"], corner_radius=4)
            card.pack(fill="x", pady=1)
            row = ctk.CTkFrame(card, fg_color="transparent")
            row.pack(fill="x", padx=10, pady=5)
            name = c.get("name", c.get("client_name", "?"))
            ctk.CTkLabel(row, text=name, font=("Segoe UI", 11, "bold"),
                         text_color=C["text"]).pack(side="left")
            for field, icon in [("postcode", "📍"), ("phone", "📱"), ("email", "✉")]:
                val = c.get(field, c.get("telephone" if field == "phone" else field, ""))
                if val:
                    ctk.CTkLabel(row, text=f"{icon} {val}", font=("Segoe UI", 9),
                                 text_color=C["muted"]).pack(side="right", padx=(4, 0))

    # ════════════════════════════════════════════════════════════
    #  TAB: Enquiries
    # ════════════════════════════════════════════════════════════
    def _tab_enquiries(self):
        frame = ctk.CTkScrollableFrame(self._content, fg_color=C["bg"])
        frame.pack(fill="both", expand=True, padx=12, pady=12)
        self._section(frame, "Enquiries", "Website enquiries — trigger PC to reply")
        self._enq_frame = frame
        self._threaded(self._load_enquiries)

    def _load_enquiries(self):
        try:
            enqs = _safe_list(api_get_cached("get_enquiries"), "enquiries")
        except Exception as e:
            self.after(0, lambda: self._error_card(self._enq_frame, str(e)))
            return
        self.after(0, lambda: self._render_enquiries(enqs))

    def _render_enquiries(self, enqs):
        self._set_status(f"{len(enqs)} enquir{'ies' if len(enqs) != 1 else 'y'}")
        if not enqs:
            ctk.CTkLabel(self._enq_frame, text="No enquiries.",
                         font=("Segoe UI", 12), text_color=C["muted"]).pack(pady=30)
            return
        for enq in enqs[:30]:
            card = ctk.CTkFrame(self._enq_frame, fg_color=C["card"], corner_radius=6)
            card.pack(fill="x", pady=2)
            top = ctk.CTkFrame(card, fg_color="transparent")
            top.pack(fill="x", padx=10, pady=(6, 2))
            name = enq.get("name", "?")
            status = enq.get("status", "New")
            ctk.CTkLabel(top, text=name, font=("Segoe UI", 12, "bold"),
                         text_color=C["text"]).pack(side="left")
            s_c = C["warning"] if status.lower() == "new" else C["success"]
            ctk.CTkLabel(top, text=status, font=("Segoe UI", 10, "bold"),
                         text_color=s_c).pack(side="right")
            date_s = enq.get("date", enq.get("created_at", ""))
            if date_s:
                ctk.CTkLabel(top, text=date_s, font=("Segoe UI", 9),
                             text_color=C["muted"]).pack(side="right", padx=8)
            det = ctk.CTkFrame(card, fg_color="transparent")
            det.pack(fill="x", padx=10, pady=(0, 2))
            for field, icon in [("service", "🔧"), ("email", "✉"), ("phone", "📱")]:
                val = enq.get(field, "")
                if val:
                    ctk.CTkLabel(det, text=f"{icon} {val}", font=("Segoe UI", 9),
                                 text_color=C["muted"]).pack(side="left" if field == "service" else "right", padx=(0, 6))
            msg = enq.get("message", enq.get("details", ""))
            if msg:
                ctk.CTkLabel(card, text=msg, font=("Segoe UI", 9), text_color=C["muted"],
                             wraplength=600).pack(anchor="w", padx=10, pady=(0, 4))
            ctk.CTkButton(card, text="📧 Ask PC to Reply", height=24, width=140,
                           fg_color=C["accent2"], font=("Segoe UI", 9),
                           command=lambda e=enq: self._trigger_reply(e)).pack(anchor="w", padx=10, pady=(0, 6))

    def _trigger_reply(self, enq):
        try:
            send_pc_command("send_enquiry_reply", {"enquiry": enq})
            self._set_status(f"📧 Reply queued for {enq.get('name', '')}")
        except Exception as e:
            messagebox.showerror("Error", str(e))

    # ════════════════════════════════════════════════════════════
    #  TAB: Quotes
    # ════════════════════════════════════════════════════════════
    def _tab_quotes(self):
        frame = ctk.CTkScrollableFrame(self._content, fg_color=C["bg"])
        frame.pack(fill="both", expand=True, padx=12, pady=12)
        self._section(frame, "Quotes", "View and manage customer quotes")
        self._quotes_frame = frame
        self._threaded(self._load_quotes)

    def _load_quotes(self):
        try:
            quotes = _safe_list(api_get_cached("get_quotes"), "quotes")
        except Exception as e:
            self.after(0, lambda: self._error_card(self._quotes_frame, str(e)))
            return
        self.after(0, lambda: self._render_quotes(quotes))

    def _render_quotes(self, quotes):
        self._set_status(f"{len(quotes)} quote(s)")
        if not quotes:
            ctk.CTkLabel(self._quotes_frame, text="No quotes found.",
                         font=("Segoe UI", 12), text_color=C["muted"]).pack(pady=30)
            return

        for q in quotes[:40]:
            card = ctk.CTkFrame(self._quotes_frame, fg_color=C["card"], corner_radius=6)
            card.pack(fill="x", pady=2)
            top = ctk.CTkFrame(card, fg_color="transparent")
            top.pack(fill="x", padx=10, pady=(6, 2))
            name = q.get("name", q.get("client_name", "?"))
            status = q.get("status", "Pending")
            amount = _safe_float(q.get("amount", q.get("total", q.get("price", 0))))
            ref = q.get("quoteNumber", q.get("quote_number", q.get("id", "")))

            ctk.CTkLabel(top, text=f"#{ref}  {name}" if ref else name,
                         font=("Segoe UI", 12, "bold"), text_color=C["text"]).pack(side="left")

            s_colors = {"pending": C["warning"], "sent": C["accent2"], "accepted": C["success"],
                        "declined": C["danger"], "expired": C["muted"]}
            ctk.CTkLabel(top, text=status.title(), font=("Segoe UI", 10, "bold"),
                         text_color=s_colors.get(status.lower(), C["muted"])).pack(side="right")
            if amount:
                ctk.CTkLabel(top, text=f"£{amount:,.2f}", font=("Segoe UI", 11, "bold"),
                             text_color=C["success"]).pack(side="right", padx=8)

            det = ctk.CTkFrame(card, fg_color="transparent")
            det.pack(fill="x", padx=10, pady=(0, 2))
            service = q.get("service", q.get("service_type", ""))
            email = q.get("email", "")
            date_s = q.get("date", q.get("created", ""))
            if service:
                ctk.CTkLabel(det, text=f"🔧 {service}", font=("Segoe UI", 9),
                             text_color=C["muted"]).pack(side="left")
            if date_s:
                ctk.CTkLabel(det, text=f"📅 {str(date_s)[:10]}", font=("Segoe UI", 9),
                             text_color=C["muted"]).pack(side="right")
            if email:
                ctk.CTkLabel(det, text=f"✉ {email}", font=("Segoe UI", 9),
                             text_color=C["muted"]).pack(side="right", padx=(0, 8))

            desc = q.get("description", q.get("details", q.get("notes", "")))
            if desc:
                ctk.CTkLabel(card, text=desc, font=("Segoe UI", 9), text_color=C["muted"],
                             wraplength=600).pack(anchor="w", padx=10, pady=(0, 4))

            acts = ctk.CTkFrame(card, fg_color="transparent")
            acts.pack(fill="x", padx=10, pady=(0, 6))
            if status.lower() in ("pending", "sent", "new", ""):
                ctk.CTkButton(acts, text="📧 Resend Quote", height=24, width=120,
                               fg_color=C["accent2"], font=("Segoe UI", 9),
                               command=lambda qid=ref: self._resend_quote(qid)).pack(side="left", padx=(0, 4))

    def _resend_quote(self, quote_ref):
        try:
            api_post("resend_quote", {"quoteNumber": quote_ref})
            self._set_status(f"📧 Quote {quote_ref} resent")
        except Exception as e:
            messagebox.showerror("Error", str(e))

    # ════════════════════════════════════════════════════════════
    #  TAB: Finance
    # ════════════════════════════════════════════════════════════
    def _tab_finance(self):
        frame = ctk.CTkScrollableFrame(self._content, fg_color=C["bg"])
        frame.pack(fill="both", expand=True, padx=12, pady=12)
        self._section(frame, "Finance Overview", "Revenue, invoices, savings pots")
        self._finance_kpi = ctk.CTkFrame(frame, fg_color="transparent")
        self._finance_kpi.pack(fill="x", pady=(0, 8))
        self._finance_invoices = ctk.CTkFrame(frame, fg_color="transparent")
        self._finance_invoices.pack(fill="both", expand=True)
        self._finance_pots = ctk.CTkFrame(frame, fg_color="transparent")
        self._finance_pots.pack(fill="x")
        self._threaded(self._load_finance)

    def _load_finance(self):
        # Fetch all 3 finance sources in parallel
        raw = fetch_parallel(
            ("get_finance_summary", {}, 30),
            ("get_invoices", {}, 30),
            ("get_savings_pots", {}, 60),
        )
        finance = raw.get("get_finance_summary", {})
        invoices = _safe_list(raw.get("get_invoices", {}), "invoices")
        pots = raw.get("get_savings_pots", {})
        self.after(0, lambda: self._render_finance(finance, invoices, pots))

    def _render_finance(self, finance, invoices, pots):
        # KPI row
        for w in self._finance_kpi.winfo_children():
            w.destroy()
        month_rev = _safe_float(finance.get("month_revenue", finance.get("monthRevenue", 0)))
        ytd_rev = _safe_float(finance.get("ytd_revenue", finance.get("ytdRevenue", 0)))
        outstanding = _safe_float(finance.get("outstanding", finance.get("outstanding_amount", 0)))
        paid_count = sum(1 for inv in invoices if str(inv.get("status", inv.get("paid", ""))).lower() in ("paid", "yes", "true"))
        unpaid_count = len(invoices) - paid_count

        self._kpi_card(self._finance_kpi, "📊", f"£{month_rev:,.0f}", "Month Rev", C["accent"])
        self._kpi_card(self._finance_kpi, "📈", f"£{ytd_rev:,.0f}", "YTD Rev", C["accent"])
        self._kpi_card(self._finance_kpi, "🧾", f"£{outstanding:,.0f}", "Outstanding",
                       C["danger"] if outstanding > 0 else C["success"])
        self._kpi_card(self._finance_kpi, "✅", str(paid_count), "Paid", C["success"])
        self._kpi_card(self._finance_kpi, "⏳", str(unpaid_count), "Unpaid", C["warning"])

        # Invoices list
        for w in self._finance_invoices.winfo_children():
            w.destroy()
        ctk.CTkLabel(self._finance_invoices, text=f"📄 Invoices ({len(invoices)})",
                     font=("Segoe UI", 14, "bold"), text_color=C["text"]).pack(anchor="w", pady=(8, 4))
        for inv in invoices[:40]:
            card = ctk.CTkFrame(self._finance_invoices, fg_color=C["card"], corner_radius=4)
            card.pack(fill="x", pady=1)
            row = ctk.CTkFrame(card, fg_color="transparent")
            row.pack(fill="x", padx=10, pady=5)
            inv_num = inv.get("invoiceNumber") or inv.get("invoice_number") or inv.get("id", "?")
            name = inv.get("name") or inv.get("client_name") or inv.get("clientName", "?")
            amount = _safe_float(inv.get("amount", inv.get("total", inv.get("price", 0))))
            status = str(inv.get("status", inv.get("paid", "")))
            date_s = inv.get("date") or inv.get("created", "")

            ctk.CTkLabel(row, text=f"#{inv_num}  {name}", font=("Segoe UI", 11, "bold"),
                         text_color=C["text"]).pack(side="left")
            if amount:
                ctk.CTkLabel(row, text=f"£{amount:,.2f}", font=("Segoe UI", 10, "bold"),
                             text_color=C["success"]).pack(side="right")
            paid = status.lower() in ("paid", "yes", "true")
            ctk.CTkLabel(row, text="Paid" if paid else status or "Unpaid",
                         font=("Segoe UI", 9, "bold"),
                         text_color=C["success"] if paid else C["warning"]).pack(side="right", padx=6)
            if date_s:
                ctk.CTkLabel(row, text=str(date_s)[:10], font=("Segoe UI", 8),
                             text_color=C["muted"]).pack(side="right", padx=4)

            # Action buttons for unpaid invoices
            if not paid:
                acts = ctk.CTkFrame(card, fg_color="transparent")
                acts.pack(fill="x", padx=10, pady=(0, 4))
                ctk.CTkButton(acts, text="✅ Mark Paid", height=22, width=90,
                               fg_color=C["success"], font=("Segoe UI", 9),
                               command=lambda n=inv_num: self._mark_paid(n)).pack(side="left", padx=(0, 4))
                ctk.CTkButton(acts, text="📧 Resend", height=22, width=80,
                               fg_color=C["accent2"], font=("Segoe UI", 9),
                               command=lambda i=inv: self._resend_invoice(i)).pack(side="left")

        # Savings pots
        for w in self._finance_pots.winfo_children():
            w.destroy()
        if pots and isinstance(pots, dict):
            pot_list = pots.get("pots", [])
            if pot_list:
                ctk.CTkLabel(self._finance_pots, text="🏦 Savings Pots",
                             font=("Segoe UI", 14, "bold"), text_color=C["text"]).pack(anchor="w", pady=(10, 4))
                for p in pot_list:
                    row = ctk.CTkFrame(self._finance_pots, fg_color=C["card"], corner_radius=4)
                    row.pack(fill="x", pady=1)
                    inner = ctk.CTkFrame(row, fg_color="transparent")
                    inner.pack(fill="x", padx=10, pady=5)
                    pname = p.get("name", "?")
                    pbal = _safe_float(p.get("balance", p.get("amount", 0)))
                    ctk.CTkLabel(inner, text=pname, font=("Segoe UI", 11),
                                 text_color=C["text"]).pack(side="left")
                    ctk.CTkLabel(inner, text=f"£{pbal:,.2f}", font=("Segoe UI", 11, "bold"),
                                 text_color=C["accent"]).pack(side="right")

        self._set_status(f"Finance: £{month_rev:,.0f} month, {len(invoices)} invoices")

    def _mark_paid(self, inv_num):
        try:
            api_post("mark_invoice_paid", {"invoiceNumber": inv_num})
            self._set_status(f"✅ Invoice #{inv_num} marked paid")
            self._current_tab = None; self._switch_tab("finance")
        except Exception as e:
            messagebox.showerror("Error", str(e))

    def _resend_invoice(self, inv):
        try:
            api_post("send_invoice_email", inv)
            self._set_status(f"📧 Invoice resent")
        except Exception as e:
            messagebox.showerror("Error", str(e))

    # ════════════════════════════════════════════════════════════
    #  TAB: Marketing
    # ════════════════════════════════════════════════════════════
    def _tab_marketing(self):
        frame = ctk.CTkScrollableFrame(self._content, fg_color=C["bg"])
        frame.pack(fill="both", expand=True, padx=12, pady=12)
        self._section(frame, "Marketing", "Blog posts, newsletters, testimonials")
        self._mkt_frame = frame
        self._threaded(self._load_marketing)

    def _load_marketing(self):
        # Fetch all 3 marketing sources in parallel
        raw = fetch_parallel(
            ("get_all_blog_posts", {}, 60),
            ("get_newsletters", {}, 60),
            ("get_all_testimonials", {}, 60),
        )
        blogs = _safe_list(raw.get("get_all_blog_posts", {}), "posts")
        newsletters = _safe_list(raw.get("get_newsletters", {}), "newsletters")
        testimonials = _safe_list(raw.get("get_all_testimonials", {}), "testimonials")
        self.after(0, lambda: self._render_marketing(blogs, newsletters, testimonials))

    def _render_marketing(self, blogs, newsletters, testimonials):
        # Blog posts
        ctk.CTkLabel(self._mkt_frame, text=f"📝 Blog Posts ({len(blogs)})",
                     font=("Segoe UI", 14, "bold"), text_color=C["text"]).pack(anchor="w", pady=(8, 4))
        if not blogs:
            ctk.CTkLabel(self._mkt_frame, text="No blog posts.", font=("Segoe UI", 11),
                         text_color=C["muted"]).pack(anchor="w", pady=4)
        else:
            for b in blogs[:10]:
                card = ctk.CTkFrame(self._mkt_frame, fg_color=C["card"], corner_radius=4)
                card.pack(fill="x", pady=1)
                row = ctk.CTkFrame(card, fg_color="transparent")
                row.pack(fill="x", padx=10, pady=5)
                title = b.get("title", "?")
                status = b.get("status", "draft")
                date_s = b.get("date", b.get("published", ""))
                ctk.CTkLabel(row, text=title, font=("Segoe UI", 11, "bold"),
                             text_color=C["text"]).pack(side="left")
                ctk.CTkLabel(row, text=status.title(), font=("Segoe UI", 9, "bold"),
                             text_color=C["success"] if status.lower() == "published" else C["warning"]).pack(side="right")
                if date_s:
                    ctk.CTkLabel(row, text=str(date_s)[:10], font=("Segoe UI", 8),
                                 text_color=C["muted"]).pack(side="right", padx=6)

        # Quick trigger buttons
        btn_row = ctk.CTkFrame(self._mkt_frame, fg_color="transparent")
        btn_row.pack(fill="x", pady=(4, 12))
        ctk.CTkButton(btn_row, text="📝 Generate Blog Post", height=28, width=160,
                       fg_color=C["accent"], text_color="#111", font=("Segoe UI", 10),
                       command=lambda: self._fire_trigger("generate_blog")).pack(side="left", padx=(0, 4))
        ctk.CTkButton(btn_row, text="📰 Generate Newsletter", height=28, width=160,
                       fg_color=C["accent"], text_color="#111", font=("Segoe UI", 10),
                       command=lambda: self._fire_trigger("generate_newsletter")).pack(side="left")

        # Newsletters
        ctk.CTkLabel(self._mkt_frame, text=f"📰 Newsletters ({len(newsletters)})",
                     font=("Segoe UI", 14, "bold"), text_color=C["text"]).pack(anchor="w", pady=(8, 4))
        for nl in newsletters[:5]:
            card = ctk.CTkFrame(self._mkt_frame, fg_color=C["card"], corner_radius=4)
            card.pack(fill="x", pady=1)
            row = ctk.CTkFrame(card, fg_color="transparent")
            row.pack(fill="x", padx=10, pady=5)
            subj = nl.get("subject", nl.get("title", "Newsletter"))
            date_s = nl.get("date", nl.get("sent", ""))
            ctk.CTkLabel(row, text=subj, font=("Segoe UI", 11, "bold"),
                         text_color=C["text"]).pack(side="left")
            if date_s:
                ctk.CTkLabel(row, text=str(date_s)[:10], font=("Segoe UI", 9),
                             text_color=C["muted"]).pack(side="right")

        # Testimonials
        ctk.CTkLabel(self._mkt_frame, text=f"⭐ Testimonials ({len(testimonials)})",
                     font=("Segoe UI", 14, "bold"), text_color=C["text"]).pack(anchor="w", pady=(10, 4))
        pending = [t for t in testimonials if t.get("status", "").lower() in ("pending", "new", "")]
        approved = [t for t in testimonials if t.get("status", "").lower() == "approved"]
        ctk.CTkLabel(self._mkt_frame, text=f"✅ {len(approved)} approved  |  ⏳ {len(pending)} pending",
                     font=("Segoe UI", 11), text_color=C["muted"]).pack(anchor="w")
        for t in testimonials[:8]:
            card = ctk.CTkFrame(self._mkt_frame, fg_color=C["card"], corner_radius=4)
            card.pack(fill="x", pady=1)
            row = ctk.CTkFrame(card, fg_color="transparent")
            row.pack(fill="x", padx=10, pady=5)
            name = t.get("name", "?")
            text = t.get("text", t.get("review", ""))
            rating = t.get("rating", "")
            ctk.CTkLabel(row, text=f"{name} {'⭐' * _safe_int(rating)}", font=("Segoe UI", 11, "bold"),
                         text_color=C["text"]).pack(side="left")
            st = t.get("status", "")
            if st:
                ctk.CTkLabel(row, text=st.title(), font=("Segoe UI", 9, "bold"),
                             text_color=C["success"] if st.lower() == "approved" else C["warning"]).pack(side="right")
            if text:
                ctk.CTkLabel(card, text=f'"{text[:120]}..."' if len(text) > 120 else f'"{text}"',
                             font=("Segoe UI", 9), text_color=C["muted"],
                             wraplength=600).pack(anchor="w", padx=10, pady=(0, 4))

        self._set_status(f"Marketing: {len(blogs)} posts, {len(newsletters)} newsletters, {len(testimonials)} reviews")

    # ════════════════════════════════════════════════════════════
    #  TAB: Site Analytics
    # ════════════════════════════════════════════════════════════
    def _tab_analytics(self):
        frame = ctk.CTkScrollableFrame(self._content, fg_color=C["bg"])
        frame.pack(fill="both", expand=True, padx=12, pady=12)
        self._section(frame, "Site Analytics", "Website traffic — last 30 days")
        self._analytics_kpi = ctk.CTkFrame(frame, fg_color="transparent")
        self._analytics_kpi.pack(fill="x", pady=(0, 8))
        self._analytics_pages = ctk.CTkFrame(frame, fg_color="transparent")
        self._analytics_pages.pack(fill="x")
        self._analytics_refs = ctk.CTkFrame(frame, fg_color="transparent")
        self._analytics_refs.pack(fill="x")
        self._threaded(self._load_analytics)

    def _load_analytics(self):
        try:
            data = api_get_cached("get_site_analytics", ttl=60)
        except Exception as e:
            self.after(0, lambda: self._error_card(self._analytics_kpi, str(e)))
            return
        self.after(0, lambda: self._render_analytics(data))

    def _render_analytics(self, data):
        if not isinstance(data, dict):
            data = {}
        total = _safe_int(data.get("total_views", data.get("totalViews", 0)))
        avg = _safe_int(data.get("avg_per_day", data.get("avgPerDay", 0)))
        unique = _safe_int(data.get("unique_pages", data.get("uniquePages", 0)))

        for w in self._analytics_kpi.winfo_children():
            w.destroy()
        self._kpi_card(self._analytics_kpi, "🌐", f"{total:,}", "Total Views", C["cyan"])
        self._kpi_card(self._analytics_kpi, "📊", str(avg), "Avg/Day", C["accent"])
        self._kpi_card(self._analytics_kpi, "📄", str(unique), "Unique Pages", C["accent2"])

        # Top pages
        for w in self._analytics_pages.winfo_children():
            w.destroy()
        ctk.CTkLabel(self._analytics_pages, text="📄 Top Pages",
                     font=("Segoe UI", 14, "bold"), text_color=C["text"]).pack(anchor="w", pady=(8, 4))
        top_pages = data.get("topPages", data.get("top_pages", []))
        if isinstance(top_pages, str):
            try:
                top_pages = json.loads(top_pages)
            except Exception:
                top_pages = []
        friendly = {"/": "Home", "/index": "Home", "/about": "About", "/services": "Services",
                    "/booking": "Book Online", "/contact": "Contact", "/blog": "Blog",
                    "/testimonials": "Reviews", "/shop": "Shop", "/subscribe": "Subscribe"}
        for p in (top_pages if isinstance(top_pages, list) else [])[:10]:
            page = p.get("page", "/")
            views = _safe_int(p.get("views", 0))
            display = friendly.get(page, page.lstrip("/").replace("-", " ").title() or "Home")
            row = ctk.CTkFrame(self._analytics_pages, fg_color=C["card"], corner_radius=4)
            row.pack(fill="x", pady=1)
            inner = ctk.CTkFrame(row, fg_color="transparent")
            inner.pack(fill="x", padx=10, pady=4)
            ctk.CTkLabel(inner, text=display, font=("Segoe UI", 11),
                         text_color=C["text"]).pack(side="left")
            ctk.CTkLabel(inner, text=f"{views:,}", font=("Segoe UI", 11, "bold"),
                         text_color=C["cyan"]).pack(side="right")

        # Top referrers
        for w in self._analytics_refs.winfo_children():
            w.destroy()
        ctk.CTkLabel(self._analytics_refs, text="🔗 Top Referrers",
                     font=("Segoe UI", 14, "bold"), text_color=C["text"]).pack(anchor="w", pady=(10, 4))
        top_refs = data.get("topReferrers", data.get("top_referrers", []))
        if isinstance(top_refs, str):
            try:
                top_refs = json.loads(top_refs)
            except Exception:
                top_refs = []
        if not top_refs:
            ctk.CTkLabel(self._analytics_refs, text="All direct traffic",
                         font=("Segoe UI", 11), text_color=C["muted"]).pack(anchor="w")
        else:
            for ref in (top_refs if isinstance(top_refs, list) else [])[:8]:
                row = ctk.CTkFrame(self._analytics_refs, fg_color=C["card"], corner_radius=4)
                row.pack(fill="x", pady=1)
                inner = ctk.CTkFrame(row, fg_color="transparent")
                inner.pack(fill="x", padx=10, pady=4)
                ctk.CTkLabel(inner, text=ref.get("referrer", "?"), font=("Segoe UI", 11),
                             text_color=C["text"]).pack(side="left")
                ctk.CTkLabel(inner, text=f"{_safe_int(ref.get('views', 0)):,}",
                             font=("Segoe UI", 11, "bold"), text_color=C["cyan"]).pack(side="right")

        self._set_status(f"Analytics: {total:,} views, {avg}/day avg")

    # ════════════════════════════════════════════════════════════
    #  TAB: PC Triggers
    # ════════════════════════════════════════════════════════════
    def _tab_triggers(self):
        frame = ctk.CTkScrollableFrame(self._content, fg_color=C["bg"])
        frame.pack(fill="both", expand=True, padx=12, pady=12)
        self._section(frame, "PC Triggers", "Queue heavy jobs on PC Node 1. Picked up within 60s.")

        triggers = [
            ("generate_blog",              "📝 Generate Blog Post",      "AI writes a blog post draft",            C["accent"]),
            ("generate_newsletter",        "📰 Generate Newsletter",     "AI creates newsletter draft",             C["accent"]),
            ("send_reminders",             "⏰ Job Reminders",           "Day-before reminders to clients",         C["accent2"]),
            ("run_email_lifecycle",         "📧 Email Lifecycle",         "Process all email campaigns",             C["accent2"]),
            ("send_booking_confirmation",  "📧 Booking Confirmations",   "Confirmation emails for bookings",        C["accent2"]),
            ("force_sync",                 "🔄 Force Sync",              "Full data sync with Google Sheets",       C["warning"]),
            ("run_agent",                  "🤖 Blog Agent",              "Force blog writer agent to run",          C["purple"]),
            ("run_agent",                  "🤖 Review Chaser",           "Chase clients for Google reviews",        C["purple"]),
            ("run_agent",                  "🤖 Social Media Post",       "Generate & post to social media",         C["purple"]),
        ]

        for cmd, label, desc, color in triggers:
            card = ctk.CTkFrame(frame, fg_color=C["card"], corner_radius=6)
            card.pack(fill="x", pady=2)
            row = ctk.CTkFrame(card, fg_color="transparent")
            row.pack(fill="x", padx=10, pady=8)
            left = ctk.CTkFrame(row, fg_color="transparent")
            left.pack(side="left", fill="x", expand=True)
            ctk.CTkLabel(left, text=label, font=("Segoe UI", 12, "bold"),
                         text_color=C["text"]).pack(anchor="w")
            ctk.CTkLabel(left, text=desc, font=("Segoe UI", 9),
                         text_color=C["muted"]).pack(anchor="w")
            result_lbl = ctk.CTkLabel(left, text="", font=("Segoe UI", 9),
                                       text_color=C["success"])
            result_lbl.pack(anchor="w")

            agent_map = {"🤖 Blog Agent": "blog_writer", "🤖 Review Chaser": "review_chaser",
                         "🤖 Social Media Post": "social_media"}

            def _fire(c=cmd, l=label, rl=result_lbl):
                d = {"agent_id": agent_map.get(l, "blog_writer")} if c == "run_agent" else {}
                try:
                    send_pc_command(c, d)
                    rl.configure(text="⏳ Queued — PC picks up in ~60s", text_color=C["warning"])
                    self._set_status(f"✅ {l} queued")
                    self.after(70_000, lambda: self._check_trigger_result(rl))
                except Exception as e:
                    rl.configure(text=f"❌ {e}", text_color=C["danger"])

            ctk.CTkButton(row, text="Trigger", width=70, height=28,
                           fg_color=color, hover_color="#2a3a5c",
                           text_color="#111" if color in (C["accent"], C["warning"]) else "#fff",
                           font=("Segoe UI", 11, "bold"), command=_fire).pack(side="right")

        # Command history
        ctk.CTkFrame(frame, height=1, fg_color=C["border"]).pack(fill="x", pady=10)
        ctk.CTkLabel(frame, text="📜 Recent Commands", font=("Segoe UI", 13, "bold"),
                     text_color=C["text"]).pack(anchor="w", pady=(0, 4))
        self._cmd_frame = ctk.CTkFrame(frame, fg_color="transparent")
        self._cmd_frame.pack(fill="x")
        self._threaded(self._load_cmd_history)

    def _load_cmd_history(self):
        try:
            cmds = _safe_list(api_get("get_remote_commands", status="all", limit="15"), "commands")
        except Exception:
            cmds = []
        self.after(0, lambda: self._render_cmd_history(cmds))

    def _render_cmd_history(self, cmds):
        for w in self._cmd_frame.winfo_children():
            w.destroy()
        if not cmds:
            ctk.CTkLabel(self._cmd_frame, text="No commands yet.",
                         font=("Segoe UI", 10), text_color=C["muted"]).pack(pady=4)
            return
        for cmd in cmds:
            row = ctk.CTkFrame(self._cmd_frame, fg_color=C["card"], corner_radius=4)
            row.pack(fill="x", pady=1)
            inner = ctk.CTkFrame(row, fg_color="transparent")
            inner.pack(fill="x", padx=8, pady=4)
            st = cmd.get("status", "?")
            icon = "✅" if st == "completed" else "⏳" if st == "pending" else "❌"
            ctk.CTkLabel(inner, text=f"{icon} {cmd.get('command', '?')}", font=("Segoe UI", 10, "bold"),
                         text_color=C["text"]).pack(side="left")
            ts = cmd.get("created_at", "")[:16]
            if ts:
                ctk.CTkLabel(inner, text=ts, font=("Segoe UI", 8),
                             text_color=C["muted"]).pack(side="right")
            src = cmd.get("source", "")
            if src:
                src_c = {"mobile": C["orange"], "laptop": C["accent2"]}.get(src, C["muted"])
                ctk.CTkLabel(inner, text=src, font=("Segoe UI", 8, "bold"),
                             text_color=src_c).pack(side="right", padx=4)
            result_text = cmd.get("result", "")
            if result_text and st in ("completed", "failed"):
                ctk.CTkLabel(row, text=f"→ {result_text[:100]}", font=("Segoe UI", 9),
                             text_color=C["success"] if st == "completed" else C["danger"],
                             wraplength=600).pack(anchor="w", padx=8, pady=(0, 3))

    def _check_trigger_result(self, rl):
        def _check():
            try:
                cmds = _safe_list(api_get("get_remote_commands", status="all", limit="3"), "commands")
                if cmds:
                    latest = cmds[0]
                    st = latest.get("status", "")
                    result = latest.get("result", "")
                    if st == "completed":
                        self.after(0, lambda: rl.configure(text=f"✅ {result[:80]}", text_color=C["success"]))
                    elif st == "failed":
                        self.after(0, lambda: rl.configure(text=f"❌ {result[:80]}", text_color=C["danger"]))
                    else:
                        self.after(0, lambda: rl.configure(text="⏳ Still processing...", text_color=C["warning"]))
            except Exception:
                pass
        self._threaded(_check)

    # ════════════════════════════════════════════════════════════
    #  TAB: Field Notes
    # ════════════════════════════════════════════════════════════
    def _tab_notes(self):
        frame = ctk.CTkFrame(self._content, fg_color=C["bg"])
        frame.pack(fill="both", expand=True, padx=12, pady=12)
        self._section(frame, "Field Notes", "Saved locally + synced to the main system")

        self._note_input = ctk.CTkTextbox(frame, height=80, fg_color=C["card"], text_color=C["text"],
                                           font=("Segoe UI", 11), border_color=C["accent"], border_width=1)
        self._note_input.pack(fill="x", pady=(0, 4))
        btn_row = ctk.CTkFrame(frame, fg_color="transparent")
        btn_row.pack(fill="x", pady=(0, 8))
        self._note_cat = ctk.CTkOptionMenu(btn_row, values=["General", "Job Note", "Client Feedback", "Issue", "Idea"],
                                            width=140, height=28, fg_color=C["card"])
        self._note_cat.pack(side="left")
        ctk.CTkButton(btn_row, text="💾 Save", height=28, width=80,
                       fg_color=C["accent"], text_color="#111", font=("Segoe UI", 10, "bold"),
                       command=self._save_note).pack(side="right")

        ctk.CTkFrame(frame, height=1, fg_color=C["border"]).pack(fill="x", pady=4)
        self._notes_scroll = ctk.CTkScrollableFrame(frame, fg_color=C["bg"])
        self._notes_scroll.pack(fill="both", expand=True)
        self._threaded(self._load_notes)

    def _save_note(self):
        text = self._note_input.get("1.0", "end").strip()
        if not text:
            return
        note = {"text": text, "category": self._note_cat.get(),
                "timestamp": datetime.now().isoformat(),
                "date": datetime.now().strftime("%Y-%m-%d %H:%M")}
        notes_file = PLATFORM_DIR / "data" / "field_notes.json"
        notes_file.parent.mkdir(parents=True, exist_ok=True)
        notes = []
        if notes_file.exists():
            try:
                notes = json.loads(notes_file.read_text(encoding="utf-8"))
            except Exception:
                pass
        notes.insert(0, note)
        notes_file.write_text(json.dumps(notes[:200], indent=2), encoding="utf-8")
        try:
            api_post("save_field_note", note)
        except Exception:
            pass
        self._note_input.delete("1.0", "end")
        self._set_status(f"📝 Note saved ({note['category']})")
        self._threaded(self._load_notes)

    def _load_notes(self):
        notes = []
        try:
            notes = _safe_list(api_get("get_field_notes", limit="50"), "notes")
        except Exception:
            f = PLATFORM_DIR / "data" / "field_notes.json"
            if f.exists():
                try:
                    notes = json.loads(f.read_text(encoding="utf-8"))
                except Exception:
                    pass
        self.after(0, lambda: self._render_notes(notes))

    def _render_notes(self, notes):
        if not hasattr(self, "_notes_scroll"):
            return
        for w in self._notes_scroll.winfo_children():
            w.destroy()
        if not notes:
            ctk.CTkLabel(self._notes_scroll, text="No notes yet.",
                         font=("Segoe UI", 11), text_color=C["muted"]).pack(pady=12)
            return
        for n in notes[:50]:
            card = ctk.CTkFrame(self._notes_scroll, fg_color=C["card"], corner_radius=4)
            card.pack(fill="x", pady=1)
            row = ctk.CTkFrame(card, fg_color="transparent")
            row.pack(fill="x", padx=10, pady=(4, 1))
            ctk.CTkLabel(row, text=n.get("category", "General"), font=("Segoe UI", 9, "bold"),
                         text_color=C["accent"]).pack(side="left")
            ctk.CTkLabel(row, text=n.get("date", n.get("timestamp", ""))[:16],
                         font=("Segoe UI", 8), text_color=C["muted"]).pack(side="right")
            ctk.CTkLabel(card, text=n.get("text", ""), font=("Segoe UI", 10),
                         text_color=C["text"], wraplength=600).pack(anchor="w", padx=10, pady=(0, 4))


    # ════════════════════════════════════════════════════════════
    #  TAB: System Health
    # ════════════════════════════════════════════════════════════
    def _tab_health(self):
        frame = ctk.CTkFrame(self._content, fg_color=C["bg"])
        frame.pack(fill="both", expand=True, padx=12, pady=12)
        self._section(frame, "System Health", "Invoice pipeline, Stripe, webhooks, email, Telegram")

        btn_row = ctk.CTkFrame(frame, fg_color="transparent")
        btn_row.pack(fill="x", pady=(0, 8))
        ctk.CTkButton(btn_row, text="🔍 Run Health Check", height=32, width=180,
                       fg_color=C["accent"], text_color="#111", font=("Segoe UI", 11, "bold"),
                       command=lambda: self._threaded(self._run_health_check)).pack(side="left")
        self._health_status_label = ctk.CTkLabel(btn_row, text="", font=("Segoe UI", 10),
                                                  text_color=C["muted"])
        self._health_status_label.pack(side="left", padx=12)

        self._health_scroll = ctk.CTkScrollableFrame(frame, fg_color=C["bg"])
        self._health_scroll.pack(fill="both", expand=True)

        # Auto-run on tab open
        self._threaded(self._run_health_check)

    def _run_health_check(self):
        """Run all health checks and display results in the health tab."""
        self.after(0, lambda: self._health_status_label.configure(text="⏳ Running checks..."))
        checks = []

        # ── 1. GAS API ──
        try:
            r = requests.get(f"{WEBHOOK_URL}?action=get_finance_summary", timeout=20)
            if r.status_code == 200 and r.json().get("status") == "success":
                checks.append(("✅", "Google Apps Script API", "Webhook reachable, responding correctly"))
            else:
                checks.append(("❌", "Google Apps Script API", f"HTTP {r.status_code} — unexpected response"))
        except Exception as e:
            checks.append(("❌", "Google Apps Script API", f"Unreachable: {e}"))

        # ── 2. Google Sheets Data ──
        sheet_endpoints = {
            "Jobs": "get_clients",
            "Invoices": "get_invoices",
            "Today's Jobs": "get_todays_jobs",
        }
        for label, action in sheet_endpoints.items():
            try:
                r = requests.get(f"{WEBHOOK_URL}?action={action}", timeout=20)
                if r.status_code == 200:
                    data = r.json()
                    items = data.get("clients", data.get("invoices", data.get("jobs", [])))
                    checks.append(("✅", f"Sheets: {label}", f"{len(items)} record(s)"))
                else:
                    checks.append(("❌", f"Sheets: {label}", f"HTTP {r.status_code}"))
            except Exception as e:
                checks.append(("❌", f"Sheets: {label}", str(e)[:60]))

        # ── 3. Stripe API ──
        try:
            r = requests.get("https://api.stripe.com/v1/balance",
                             headers={"Authorization": f"Bearer {STRIPE_KEY}"}, timeout=15)
            if r.status_code == 200:
                bal = r.json()
                avail = sum(b["amount"] for b in bal.get("available", [])) / 100
                pending = sum(b["amount"] for b in bal.get("pending", [])) / 100
                checks.append(("✅", "Stripe API", f"Key valid — £{avail:,.2f} available, £{pending:,.2f} pending"))
            elif r.status_code == 401:
                checks.append(("❌", "Stripe API", "Key INVALID — authentication failed"))
            else:
                checks.append(("❌", "Stripe API", f"HTTP {r.status_code}"))
        except Exception as e:
            checks.append(("❌", "Stripe API", str(e)[:60]))

        # ── 4. Stripe Customers ──
        try:
            r = requests.get("https://api.stripe.com/v1/customers?limit=5",
                             headers={"Authorization": f"Bearer {STRIPE_KEY}"}, timeout=15)
            if r.status_code == 200:
                custs = r.json().get("data", [])
                checks.append(("✅", "Stripe Customers", f"{len(custs)} recent customer(s)"))
            else:
                checks.append(("⚠️", "Stripe Customers", f"HTTP {r.status_code}"))
        except Exception as e:
            checks.append(("⚠️", "Stripe Customers", str(e)[:60]))

        # ── 5. Stripe Invoices ──
        try:
            r = requests.get("https://api.stripe.com/v1/invoices?limit=10",
                             headers={"Authorization": f"Bearer {STRIPE_KEY}"}, timeout=15)
            if r.status_code == 200:
                invs = r.json().get("data", [])
                open_count = sum(1 for i in invs if i.get("status") == "open")
                paid_count = sum(1 for i in invs if i.get("status") == "paid")
                checks.append(("✅", "Stripe Invoices", f"{len(invs)} recent — {open_count} open, {paid_count} paid"))
                for inv in invs[:3]:
                    amt = inv.get("amount_due", 0) / 100
                    st = inv.get("status", "?")
                    em = inv.get("customer_email", "?")
                    checks.append(("ℹ️", f"  └ £{amt:.2f} ({st})", em))
            else:
                checks.append(("⚠️", "Stripe Invoices", f"HTTP {r.status_code}"))
        except Exception as e:
            checks.append(("⚠️", "Stripe Invoices", str(e)[:60]))

        # ── 6. Stripe Webhooks ──
        try:
            r = requests.get("https://api.stripe.com/v1/webhook_endpoints?limit=10",
                             headers={"Authorization": f"Bearer {STRIPE_KEY}"}, timeout=15)
            if r.status_code == 200:
                hooks = r.json().get("data", [])
                if not hooks:
                    checks.append(("⚠️", "Stripe Webhooks", "No webhooks configured — payments won't auto-mark!"))
                else:
                    for wh in hooks:
                        url = wh.get("url", "")[:60]
                        status = wh.get("status", "?")
                        events = wh.get("enabled_events", [])
                        has_inv = any("invoice" in e for e in events)
                        icon = "✅" if status == "enabled" and has_inv else "⚠️"
                        checks.append((icon, f"Webhook: {status}", f"{len(events)} events → {url}..."))
                        if has_inv:
                            checks.append(("✅", "  └ invoice.paid enabled", "Auto-mark payments active"))
            else:
                checks.append(("⚠️", "Stripe Webhooks", f"HTTP {r.status_code}"))
        except Exception as e:
            checks.append(("⚠️", "Stripe Webhooks", str(e)[:60]))

        # ── 7. Invoice Pipeline Integrity ──
        try:
            r = requests.get(f"{WEBHOOK_URL}?action=get_invoices", timeout=20)
            if r.status_code == 200:
                invoices = r.json().get("invoices", [])
                if invoices:
                    with_stripe = sum(1 for i in invoices if i.get("stripeInvoiceId"))
                    with_url = sum(1 for i in invoices if i.get("paymentUrl"))
                    statuses = {}
                    for inv in invoices:
                        s = str(inv.get("status", "Unknown"))
                        statuses[s] = statuses.get(s, 0) + 1
                    status_str = ", ".join(f"{s}: {c}" for s, c in sorted(statuses.items()))
                    checks.append(("✅", "Invoice Pipeline", f"{len(invoices)} invoices — {status_str}"))
                    checks.append(("✅" if with_stripe else "⚠️",
                                   f"  └ Stripe-linked: {with_stripe}/{len(invoices)}",
                                   f"Payment URLs: {with_url}"))
                else:
                    checks.append(("⚠️", "Invoice Pipeline", "No invoices yet — complete a job to test"))
        except Exception as e:
            checks.append(("⚠️", "Invoice Pipeline", str(e)[:60]))

        # ── 8. Email System ──
        try:
            r = requests.get(f"{WEBHOOK_URL}?action=get_email_workflow_status", timeout=20)
            if r.status_code == 200:
                data = r.json()
                stats = data.get("emailStats", {})
                today = stats.get("today", "?")
                week = stats.get("thisWeek", "?")
                month = stats.get("thisMonth", "?")
                checks.append(("✅", "Email System", f"Today: {today}, This week: {week}, This month: {month}"))
            else:
                checks.append(("⚠️", "Email System", f"HTTP {r.status_code}"))
        except Exception as e:
            checks.append(("⚠️", "Email System", str(e)[:60]))

        # ── 9. Telegram Bots ──
        tg_bots = [
            ("DayBot", os.getenv("TG_BOT_TOKEN", "")),
            ("MoneyBot", os.getenv("TG_MONEY_TOKEN", "")),
        ]
        for name, token in tg_bots:
            try:
                r = requests.get(f"https://api.telegram.org/bot{token}/getMe", timeout=10)
                if r.status_code == 200:
                    uname = r.json().get("result", {}).get("username", "?")
                    checks.append(("✅", f"Telegram: {name}", f"@{uname} online"))
                else:
                    checks.append(("❌", f"Telegram: {name}", f"HTTP {r.status_code}"))
            except Exception as e:
                checks.append(("❌", f"Telegram: {name}", str(e)[:60]))

        # ── 10. PC Hub Online ──
        checks.append(("✅" if self._pc_online else "⚠️",
                       "PC Hub (Node 1)", "Online" if self._pc_online else "Offline"))

        # Render results
        self.after(0, lambda: self._render_health(checks))

    def _render_health(self, checks):
        """Render health check results in the scrollable frame."""
        if not hasattr(self, "_health_scroll"):
            return
        for w in self._health_scroll.winfo_children():
            w.destroy()

        passes = sum(1 for s, _, _ in checks if s == "✅")
        fails = sum(1 for s, _, _ in checks if s == "❌")
        warns = sum(1 for s, _, _ in checks if s == "⚠️")
        infos = sum(1 for s, _, _ in checks if s == "ℹ️")
        total = passes + fails + warns

        # Summary banner
        if fails > 0:
            banner_text = f"🔴  {fails} FAILURE(S)  —  {passes} passed, {warns} warnings"
            banner_color = C["danger"]
        elif warns > 0:
            banner_text = f"🟡  {warns} WARNING(S)  —  {passes} passed"
            banner_color = C["warning"]
        else:
            banner_text = f"🟢  ALL {passes} CHECKS PASSED"
            banner_color = C["success"]

        banner = ctk.CTkFrame(self._health_scroll, fg_color=banner_color, corner_radius=8, height=44)
        banner.pack(fill="x", pady=(0, 8))
        banner.pack_propagate(False)
        ctk.CTkLabel(banner, text=banner_text, font=("Segoe UI", 14, "bold"),
                     text_color="#111" if banner_color == C["warning"] else "#fff").pack(expand=True)

        self._health_status_label.configure(
            text=f"Last check: {datetime.now().strftime('%H:%M:%S')} — {passes}✅ {warns}⚠️ {fails}❌")

        # Pipeline flow diagram
        flow_card = ctk.CTkFrame(self._health_scroll, fg_color=C["card"], corner_radius=6)
        flow_card.pack(fill="x", pady=(0, 8))
        ctk.CTkLabel(flow_card, text="Invoice Pipeline Flow", font=("Segoe UI", 11, "bold"),
                     text_color=C["accent"]).pack(anchor="w", padx=10, pady=(6, 2))
        flow_text = (
            "Job Completed → Auto-Invoice Created → Stripe Invoice → Email Sent → Customer Pays\n"
            "                                                    ↓\n"
            "                              Stripe Webhook → Auto-Mark Paid → Job Sheet Updated"
        )
        ctk.CTkLabel(flow_card, text=flow_text,
                     font=("Consolas", 9), text_color=C["muted"],
                     justify="left").pack(anchor="w", padx=10, pady=(0, 6))

        # Individual check results
        for status, title, detail in checks:
            color_map = {"✅": C["success"], "❌": C["danger"], "⚠️": C["warning"], "ℹ️": C["muted"]}
            dot_color = color_map.get(status, C["muted"])

            row = ctk.CTkFrame(self._health_scroll, fg_color=C["card"], corner_radius=4, height=36)
            row.pack(fill="x", pady=1)
            row.pack_propagate(False)

            inner = ctk.CTkFrame(row, fg_color="transparent")
            inner.pack(fill="both", expand=True, padx=10, pady=4)

            ctk.CTkLabel(inner, text=status, font=("Segoe UI", 12), width=24).pack(side="left")
            ctk.CTkLabel(inner, text=title, font=("Segoe UI", 10, "bold"),
                         text_color=C["text"]).pack(side="left", padx=(4, 8))
            if detail:
                ctk.CTkLabel(inner, text=detail, font=("Segoe UI", 9),
                             text_color=C["muted"]).pack(side="left", expand=True, anchor="w")


    # ════════════════════════════════════════════════════════════
    #  UTILITIES
    # ════════════════════════════════════════════════════════════
    def _git_pull(self):
        self._set_status("Pulling updates...")
        def _do():
            try:
                repo = PLATFORM_DIR.parent
                r = subprocess.run(["git", "pull", "--ff-only", "origin", BRANCH],
                                   cwd=str(repo), capture_output=True, text=True, timeout=30)
                msg = r.stdout.strip() or "Up to date" if r.returncode == 0 else r.stderr.strip()
                icon = "✅" if r.returncode == 0 else "⚠️"
                self.after(0, lambda: self._set_status(f"{icon} {msg}"))
            except Exception as e:
                self.after(0, lambda: self._set_status(f"⚠️ {e}"))
        self._threaded(_do)


# ══════════════════════════════════════════════════════════════
# Entry point
# ══════════════════════════════════════════════════════════════
def main():
    ctk.set_appearance_mode("dark")
    ctk.set_default_color_theme("dark-blue")
    app = FieldApp()
    app.mainloop()


if __name__ == "__main__":
    main()
