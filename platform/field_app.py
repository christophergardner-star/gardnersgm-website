"""
GGM Hub — Laptop Field App  v2.1
A lightweight companion that works alongside the mobile app and
communicates all info back to the main PC node server.

Architecture:
  Mobile App  →  GAS (Google Sheets)  ←  Laptop Field App
                       ↕
                  PC Node (main server)

The laptop can:
  - See live mobile activity (job starts, completions, photos, time tracking)
  - View today's jobs with live status (same data source as mobile)
  - Browse schedule, clients, enquiries, invoices
  - Manage job tracking data coming from the mobile app
  - Trigger heavy PC actions (blogs, newsletters, emails)
  - Write field notes that sync to the main system
  - Pull/push git updates
  - View and manage bookings (confirm, cancel, trigger emails)
  - Auto-refresh active tabs for live data
  - Monitor PC node online status

Does NOT run agents, emails, newsletters, or blog posting locally.
"""

import os
import sys
import json
import threading
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
VERSION = "2.1.0"
BRANCH = "master"
import subprocess


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

# ──────────────────────────────────────────────────────────────────
# Lightweight API helper
# ──────────────────────────────────────────────────────────────────
_session = requests.Session()
_session.headers["User-Agent"] = f"GGM-Field/{VERSION}"


def api_get(action: str, **params) -> dict:
    query = {"action": action, **params}
    url = f"{WEBHOOK_URL}?{urlencode(query)}"
    resp = _session.get(url, timeout=25, allow_redirects=True)
    resp.raise_for_status()
    return resp.json()


def api_post(action: str, data: dict = None) -> dict:
    payload = {"action": action}
    if data:
        payload.update(data)
    resp = _session.post(WEBHOOK_URL, json=payload, timeout=25, allow_redirects=True)
    resp.raise_for_status()
    return resp.json()


def send_pc_command(command: str, data: dict = None):
    return api_post("queue_remote_command", {
        "command": command,
        "data": json.dumps(data or {}),
        "source": "laptop",
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
}


# ──────────────────────────────────────────────────────────────────
# Main Application
# ──────────────────────────────────────────────────────────────────

class FieldApp(ctk.CTk):
    """Lightweight field companion — works alongside mobile app,
    manages data flow to the main PC node."""

    TABS = [
        ("dashboard",  "📊  Dashboard"),
        ("today",      "📋  Today's Jobs"),
        ("bookings",   "📅  Bookings"),
        ("schedule",   "📆  Schedule"),
        ("tracking",   "⏱️  Job Tracking"),
        ("clients",    "👤  Clients"),
        ("enquiries",  "📩  Enquiries"),
        ("invoices",   "💷  Invoices"),
        ("triggers",   "🖥️  PC Triggers"),
        ("notes",      "📝  Field Notes"),
    ]

    AUTO_REFRESH_MS = 45_000  # auto-refresh active tabs every 45 seconds

    def __init__(self):
        super().__init__()
        self.title(f"🌿 {APP_NAME} — Gardners Ground Maintenance")
        self._configure_window()
        self._current_tab = None
        self._tab_frames = {}
        self._cached = {}
        self._auto_refresh_id = None
        self._pc_online = False
        self._last_pc_check = ""

        self._build_sidebar()
        self._build_content_area()
        self._build_status_bar()
        self._switch_tab("dashboard")
        self._start_auto_refresh()

    def _configure_window(self):
        sw = self.winfo_screenwidth()
        sh = self.winfo_screenheight()
        w = min(1200, sw - 20)
        h = min(800, sh - 112)
        x = max(0, (sw - w) // 2)
        y = max(0, (sh - h) // 2 - 20)
        self.geometry(f"{w}x{h}+{x}+{y}")
        self.minsize(900, 600)

    # ════════════════════════════════════════════════════════════
    #  LAYOUT
    # ════════════════════════════════════════════════════════════

    def _build_sidebar(self):
        sb = ctk.CTkFrame(self, width=210, fg_color=C["sidebar"], corner_radius=0)
        sb.pack(side="left", fill="y")
        sb.pack_propagate(False)

        ctk.CTkLabel(sb, text="🌿 GGM Field", font=("Segoe UI", 18, "bold"),
                     text_color=C["accent"]).pack(pady=(18, 2))
        ctk.CTkLabel(sb, text="Mobile + Laptop + PC", font=("Segoe UI", 10),
                     text_color=C["muted"]).pack(pady=(0, 14))

        self._nav = {}
        for key, label in self.TABS:
            btn = ctk.CTkButton(
                sb, text=label, anchor="w", font=("Segoe UI", 12), height=36,
                fg_color="transparent", hover_color="#283b5b",
                text_color=C["text"],
                command=lambda k=key: self._switch_tab(k),
            )
            btn.pack(fill="x", padx=6, pady=1)
            self._nav[key] = btn

        # Bottom controls
        ctk.CTkFrame(sb, height=1, fg_color=C["border"]).pack(fill="x", padx=10, pady=(14, 6))

        # PC online status indicator
        self._pc_label = ctk.CTkLabel(sb, text="⏳ Checking PC...", font=("Segoe UI", 10),
                                       text_color=C["muted"])
        self._pc_label.pack(fill="x", padx=10, pady=(0, 4))
        self._check_pc_online()

        ctk.CTkButton(sb, text="🔄 Refresh", height=30,
                       fg_color="#0f3460", hover_color="#283b5b",
                       command=self._manual_refresh).pack(fill="x", padx=10, pady=3)
        ctk.CTkButton(sb, text="⬇️ Pull Updates", height=30,
                       fg_color="#0f3460", hover_color="#283b5b",
                       command=self._git_pull).pack(fill="x", padx=10, pady=3)
        ctk.CTkLabel(sb, text=f"v{VERSION}", font=("Segoe UI", 9),
                     text_color="#556677").pack(side="bottom", pady=4)

    def _build_content_area(self):
        self._content = ctk.CTkFrame(self, fg_color=C["bg"], corner_radius=0)
        self._content.pack(side="left", fill="both", expand=True)

    def _build_status_bar(self):
        bar = ctk.CTkFrame(self, height=26, fg_color=C["bar"], corner_radius=0)
        bar.pack(side="bottom", fill="x")
        bar.pack_propagate(False)
        self._status = ctk.CTkLabel(bar, text="Ready", font=("Segoe UI", 10),
                                     text_color=C["muted"], anchor="w")
        self._status.pack(side="left", padx=10)
        self._clock = ctk.CTkLabel(bar, text="", font=("Segoe UI", 10),
                                    text_color=C["muted"])
        self._clock.pack(side="right", padx=10)
        self._tick()

    def _tick(self):
        self._clock.configure(text=datetime.now().strftime("%H:%M  %a %d %b"))
        self.after(30_000, self._tick)

    def _start_auto_refresh(self):
        """Auto-refresh dashboard/today/bookings/tracking tabs every 45s."""
        def _do_refresh():
            tab = self._current_tab
            if tab in ("dashboard", "today", "bookings", "tracking"):
                self._current_tab = None
                self._switch_tab(tab)
            self._auto_refresh_id = self.after(self.AUTO_REFRESH_MS, _do_refresh)
        self._auto_refresh_id = self.after(self.AUTO_REFRESH_MS, _do_refresh)

    def _check_pc_online(self):
        """Check if the PC node is processing commands (last completed < 5 min)."""
        def _check():
            try:
                data = api_get("get_remote_commands", status="all", limit="5")
                cmds = data.get("commands", []) if isinstance(data, dict) else []
                for cmd in cmds:
                    if cmd.get("status") == "completed" and cmd.get("completed_at"):
                        self._last_pc_check = cmd["completed_at"][:16]
                        self._pc_online = True
                        self.after(0, lambda: self._update_pc_indicator())
                        return
                self._pc_online = len(cmds) > 0
                self.after(0, lambda: self._update_pc_indicator())
            except Exception:
                self._pc_online = False
                self.after(0, lambda: self._update_pc_indicator())
        self._threaded(_check)

    def _update_pc_indicator(self):
        if hasattr(self, "_pc_label"):
            if self._pc_online:
                self._pc_label.configure(
                    text=f"🟢 PC Online ({self._last_pc_check})" if self._last_pc_check
                    else "🟢 PC Connected",
                    text_color=C["success"])
            else:
                self._pc_label.configure(text="🔴 PC Offline", text_color=C["danger"])

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
        """Force refresh the current tab and check PC status."""
        tab = self._current_tab
        self._current_tab = None
        self._switch_tab(tab)
        self._check_pc_online()
        self._set_status("🔄 Refreshed")

    def _threaded(self, fn, *args):
        threading.Thread(target=fn, args=args, daemon=True).start()

    def _error_card(self, parent, msg):
        self._set_status("⚠️ Error")
        ctk.CTkLabel(parent, text=f"⚠️ {msg}", font=("Segoe UI", 12),
                     text_color=C["danger"], wraplength=500).pack(pady=20)

    # ════════════════════════════════════════════════════════════
    #  HELPER: Section header
    # ════════════════════════════════════════════════════════════
    def _section(self, parent, title, subtitle=None):
        ctk.CTkLabel(parent, text=title, font=("Segoe UI", 20, "bold"),
                     text_color=C["text"]).pack(anchor="w", pady=(0, 2))
        if subtitle:
            ctk.CTkLabel(parent, text=subtitle, font=("Segoe UI", 11),
                         text_color=C["muted"]).pack(anchor="w", pady=(0, 10))

    # ════════════════════════════════════════════════════════════
    #  TAB: Dashboard — Live activity across mobile + laptop + PC
    # ════════════════════════════════════════════════════════════
    def _tab_dashboard(self):
        frame = ctk.CTkScrollableFrame(self._content, fg_color=C["bg"])
        frame.pack(fill="both", expand=True, padx=14, pady=14)
        self._section(frame, "Dashboard",
                      "Live feed — mobile app activity, PC commands, field notes")

        self._dash_stats = ctk.CTkFrame(frame, fg_color="transparent")
        self._dash_stats.pack(fill="x", pady=(0, 12))

        self._dash_feed = ctk.CTkFrame(frame, fg_color="transparent")
        self._dash_feed.pack(fill="both", expand=True)

        self._set_status("Loading dashboard...")
        self._threaded(self._load_dashboard, frame)

    def _load_dashboard(self, frame):
        try:
            today_data = api_get("get_todays_jobs")
            jobs = today_data.get("jobs", []) if isinstance(today_data, dict) else today_data
        except Exception:
            jobs = []

        try:
            activity = api_get("get_mobile_activity", limit="40")
            events = activity.get("events", []) if isinstance(activity, dict) else []
        except Exception:
            events = []

        try:
            tracking = api_get("get_job_tracking", date=datetime.now().strftime("%Y-%m-%d"))
            records = tracking.get("records", []) if isinstance(tracking, dict) else []
        except Exception:
            records = []

        self.after(0, lambda: self._render_dashboard(jobs, events, records))

    def _render_dashboard(self, jobs, events, tracking):
        for w in self._dash_stats.winfo_children():
            w.destroy()

        completed = sum(1 for j in jobs if j.get("status", "").lower() in ("completed", "complete"))
        in_progress = sum(1 for j in jobs if j.get("status", "").lower() in ("in-progress", "in progress"))
        active_tracks = sum(1 for t in tracking if t.get("isActive"))

        stats = [
            ("📋 Today's Jobs", str(len(jobs)), C["accent2"]),
            ("✅ Completed", str(completed), C["success"]),
            ("🔨 In Progress", str(in_progress), C["warning"]),
            ("⏱️ Active Timers", str(active_tracks), C["orange"]),
        ]

        for label, val, color in stats:
            card = ctk.CTkFrame(self._dash_stats, fg_color=C["card"], corner_radius=8,
                                width=160, height=70)
            card.pack(side="left", padx=4, expand=True, fill="x")
            card.pack_propagate(False)
            ctk.CTkLabel(card, text=val, font=("Segoe UI", 24, "bold"),
                         text_color=color).pack(pady=(10, 0))
            ctk.CTkLabel(card, text=label, font=("Segoe UI", 10),
                         text_color=C["muted"]).pack()

        for w in self._dash_feed.winfo_children():
            w.destroy()

        ctk.CTkLabel(self._dash_feed, text="Recent Activity",
                     font=("Segoe UI", 14, "bold"),
                     text_color=C["text"]).pack(anchor="w", pady=(8, 6))

        if not events:
            ctk.CTkLabel(self._dash_feed, text="No activity yet.",
                         font=("Segoe UI", 12), text_color=C["muted"]).pack(pady=12)
        else:
            for ev in events[:25]:
                row = ctk.CTkFrame(self._dash_feed, fg_color=C["card"], corner_radius=6)
                row.pack(fill="x", pady=1)
                inner = ctk.CTkFrame(row, fg_color="transparent")
                inner.pack(fill="x", padx=10, pady=6)

                icon = ev.get("icon", "•")
                title = ev.get("title", "")
                detail = ev.get("detail", "")
                ts = ev.get("timestamp", "")[:16]
                source = ev.get("source", "")

                ctk.CTkLabel(inner, text=f"{icon}  {title}",
                             font=("Segoe UI", 11, "bold"),
                             text_color=C["text"]).pack(side="left")

                src_colors = {"mobile": C["orange"], "laptop": C["accent2"], "pc": C["purple"]}
                if source:
                    ctk.CTkLabel(inner, text=source, font=("Segoe UI", 9, "bold"),
                                 text_color=src_colors.get(source, C["muted"])).pack(side="right", padx=(6, 0))
                if ts:
                    ctk.CTkLabel(inner, text=ts, font=("Segoe UI", 9),
                                 text_color=C["muted"]).pack(side="right")

                if detail:
                    ctk.CTkLabel(row, text=detail, font=("Segoe UI", 10),
                                 text_color=C["muted"], wraplength=600,
                                 justify="left").pack(anchor="w", padx=10, pady=(0, 4))

        self._set_status(f"Dashboard: {len(jobs)} jobs today, {len(events)} recent events")

    # ════════════════════════════════════════════════════════════
    #  TAB: Today's Jobs (uses same endpoint as mobile app)
    # ════════════════════════════════════════════════════════════
    def _tab_today(self):
        frame = ctk.CTkScrollableFrame(self._content, fg_color=C["bg"])
        frame.pack(fill="both", expand=True, padx=14, pady=14)
        today_str = datetime.now().strftime("%A %d %B %Y")
        self._section(frame, f"Today's Jobs — {today_str}",
                      "Same live data as the mobile app. Status updates from mobile appear here.")
        self._today_frame = frame
        self._set_status("Loading today's jobs...")
        self._threaded(self._load_today)

    def _load_today(self):
        try:
            data = api_get("get_todays_jobs")
            jobs = data.get("jobs", []) if isinstance(data, dict) else (data if isinstance(data, list) else [])
        except Exception as e:
            self.after(0, lambda: self._error_card(self._today_frame, str(e)))
            return
        self.after(0, lambda: self._render_today(jobs))

    def _render_today(self, jobs):
        self._set_status(f"{len(jobs)} job(s) today")
        if not jobs:
            ctk.CTkLabel(self._today_frame, text="No jobs scheduled for today.",
                         font=("Segoe UI", 14), text_color=C["muted"]).pack(pady=30)
            return

        for i, job in enumerate(jobs):
            card = ctk.CTkFrame(self._today_frame, fg_color=C["card"], corner_radius=8)
            card.pack(fill="x", pady=4)

            top = ctk.CTkFrame(card, fg_color="transparent")
            top.pack(fill="x", padx=12, pady=(10, 4))

            name = job.get("clientName") or job.get("name", "Unknown")
            time_s = job.get("time", "")
            status = job.get("status", "scheduled")
            source = job.get("source", "booking")
            ref = job.get("ref") or job.get("jobNumber", "")

            s_colors = {"completed": C["success"], "in-progress": C["warning"],
                        "invoiced": C["purple"], "cancelled": C["danger"],
                        "scheduled": C["accent2"], "active": C["warning"],
                        "en-route": C["accent2"]}

            ctk.CTkLabel(top, text=f"#{i+1}  {name}",
                         font=("Segoe UI", 14, "bold"), text_color=C["text"]).pack(side="left")

            ctk.CTkLabel(top, text=status.title(),
                         font=("Segoe UI", 11, "bold"),
                         text_color=s_colors.get(status.lower(), C["muted"])).pack(side="right")

            src_label = "📱 Mobile" if source == "mobile" else ("📅 Schedule" if source == "schedule" else "📋 Booking")
            ctk.CTkLabel(top, text=src_label, font=("Segoe UI", 9),
                         text_color=C["muted"]).pack(side="right", padx=8)

            if time_s:
                ctk.CTkLabel(top, text=f"⏰ {time_s}", font=("Segoe UI", 11),
                             text_color=C["accent"]).pack(side="right", padx=8)

            det = ctk.CTkFrame(card, fg_color="transparent")
            det.pack(fill="x", padx=12, pady=(0, 4))

            service = job.get("service") or job.get("serviceName", "")
            address = job.get("address", "")
            postcode = job.get("postcode", "")
            loc = f"{address}, {postcode}" if address and postcode else address or postcode
            if service:
                ctk.CTkLabel(det, text=f"🔧 {service}", font=("Segoe UI", 11),
                             text_color=C["muted"]).pack(side="left", padx=(0, 14))
            if loc:
                ctk.CTkLabel(det, text=f"📍 {loc}", font=("Segoe UI", 11),
                             text_color=C["muted"]).pack(side="left")

            price = job.get("price") or job.get("total", "")
            if price and str(price) != "0":
                ctk.CTkLabel(det, text=f"£{price}", font=("Segoe UI", 12, "bold"),
                             text_color=C["success"]).pack(side="right")

            if ref:
                ctk.CTkLabel(det, text=ref, font=("Segoe UI", 9),
                             text_color=C["muted"]).pack(side="right", padx=8)

            notes = job.get("notes", "")
            if notes:
                ctk.CTkLabel(card, text=f"📌 {notes}", font=("Segoe UI", 10),
                             text_color=C["muted"], wraplength=600,
                             justify="left").pack(anchor="w", padx=12, pady=(0, 6))

            # Action buttons
            actions = ctk.CTkFrame(card, fg_color="transparent")
            actions.pack(fill="x", padx=12, pady=(0, 8))

            cur_status = status.lower()
            if cur_status not in ("completed", "complete", "invoiced"):
                if cur_status not in ("in-progress", "in progress", "en-route", "en route"):
                    ctk.CTkButton(
                        actions, text="🚗 En Route", height=28, width=100,
                        fg_color=C["accent2"], hover_color="#2563eb", text_color="#fff",
                        font=("Segoe UI", 11),
                        command=lambda r=ref: self._en_route_job(r),
                    ).pack(side="left", padx=(0, 6))

                if cur_status not in ("in-progress", "in progress"):
                    ctk.CTkButton(
                        actions, text="▶ Start Job", height=28, width=110,
                        fg_color=C["warning"], hover_color="#d97706", text_color="#111",
                        font=("Segoe UI", 11),
                        command=lambda r=ref: self._start_job(r),
                    ).pack(side="left", padx=(0, 6))

                ctk.CTkButton(
                    actions, text="✅ Complete", height=28, width=110,
                    fg_color=C["success"], hover_color="#059669", text_color="#fff",
                    font=("Segoe UI", 11),
                    command=lambda r=ref: self._complete_job(r),
                ).pack(side="left", padx=(0, 6))

            if cur_status in ("completed", "complete"):
                ctk.CTkButton(
                    actions, text="📧 Completion Email", height=28, width=160,
                    fg_color=C["accent2"], hover_color="#2563eb", text_color="#fff",
                    font=("Segoe UI", 11),
                    command=lambda j=job: self._trigger_completion_email(j),
                ).pack(side="left", padx=(0, 6))

                ctk.CTkButton(
                    actions, text="💷 Send Invoice", height=28, width=130,
                    fg_color=C["purple"], hover_color="#9333ea", text_color="#fff",
                    font=("Segoe UI", 11),
                    command=lambda j=job: self._send_invoice_from_field(j),
                ).pack(side="left")

            maps_url = job.get("googleMapsUrl", "")
            if maps_url:
                ctk.CTkButton(
                    actions, text="🗺️ Map", height=28, width=70,
                    fg_color=C["card_alt"], hover_color="#2a3a5c",
                    font=("Segoe UI", 10),
                    command=lambda u=maps_url: os.startfile(u),
                ).pack(side="right")

    def _en_route_job(self, ref):
        try:
            api_post("mobile_update_job_status", {
                "jobRef": ref,
                "status": "en-route",
                "notes": f"En route from laptop at {datetime.now().strftime('%H:%M')}",
            })
            self._set_status(f"🚗 En route to job {ref}")
            self._refresh_today()
        except Exception as e:
            messagebox.showerror("Error", str(e))

    def _start_job(self, ref):
        try:
            api_post("mobile_start_job", {"jobRef": ref, "startTime": datetime.now().isoformat()})
            self._set_status(f"▶ Job {ref} started")
            self._refresh_today()
        except Exception as e:
            messagebox.showerror("Error", str(e))

    def _complete_job(self, ref):
        try:
            api_post("mobile_complete_job", {"jobRef": ref, "endTime": datetime.now().isoformat()})
            self._set_status(f"✅ Job {ref} completed")
            self._refresh_today()
        except Exception as e:
            messagebox.showerror("Error", str(e))

    def _trigger_completion_email(self, job):
        try:
            send_pc_command("send_completion", {"job": job})
            self._set_status(f"📧 PC will send completion email for {job.get('clientName', 'job')}")
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
            self._set_status(f"💷 Invoice sent for {job.get('clientName', 'job')}")
            self._refresh_today()
        except Exception as e:
            messagebox.showerror("Error", str(e))

    def _refresh_today(self):
        self._current_tab = None
        self._switch_tab("today")

    # ════════════════════════════════════════════════════════════
    #  TAB: Bookings — Website bookings, confirm/cancel, emails
    # ════════════════════════════════════════════════════════════
    def _tab_bookings(self):
        frame = ctk.CTkScrollableFrame(self._content, fg_color=C["bg"])
        frame.pack(fill="both", expand=True, padx=14, pady=14)
        self._section(frame, "Bookings",
                      "Website enquiries & bookings — confirm, reject, or trigger emails")

        # Filter buttons
        filt = ctk.CTkFrame(frame, fg_color="transparent")
        filt.pack(fill="x", pady=(0, 10))
        self._booking_filter = "all"
        for label, fval, col in [("All", "all", C["accent"]),
                                  ("New", "new", C["warning"]),
                                  ("Confirmed", "confirmed", C["success"]),
                                  ("Completed", "completed", C["purple"])]:
            ctk.CTkButton(filt, text=label, width=80, height=28,
                           fg_color=col if fval == "all" else C["card"],
                           text_color="#111" if fval == "all" else C["text"],
                           command=lambda f=fval: self._load_bookings_filtered(f)
                           ).pack(side="left", padx=2)

        self._bookings_frame = ctk.CTkFrame(frame, fg_color="transparent")
        self._bookings_frame.pack(fill="both", expand=True)
        self._set_status("Loading bookings...")
        self._threaded(self._load_bookings)

    def _load_bookings_filtered(self, filter_val):
        self._booking_filter = filter_val
        for w in self._bookings_frame.winfo_children():
            w.destroy()
        self._threaded(self._load_bookings)

    def _load_bookings(self):
        try:
            data = api_get("get_todays_jobs")
            jobs = data.get("jobs", []) if isinstance(data, dict) else (data if isinstance(data, list) else [])
        except Exception:
            jobs = []

        try:
            enq_data = api_get("get_enquiries")
            enqs = enq_data.get("enquiries", []) if isinstance(enq_data, dict) else (enq_data if isinstance(enq_data, list) else [])
        except Exception:
            enqs = []

        try:
            sched_data = api_get("get_schedule", days="14")
            upcoming = sched_data.get("jobs", sched_data.get("visits", [])) if isinstance(sched_data, dict) else (sched_data if isinstance(sched_data, list) else [])
        except Exception:
            upcoming = []

        # Merge into a unified booking list
        bookings = []
        seen = set()

        for j in jobs:
            ref = j.get("ref") or j.get("jobNumber", "")
            if ref and ref not in seen:
                seen.add(ref)
                j["_source"] = "today"
                bookings.append(j)

        for u in upcoming:
            ref = u.get("jobNumber") or u.get("ref", "")
            if ref and ref not in seen:
                seen.add(ref)
                u["_source"] = "schedule"
                bookings.append(u)

        for e in enqs:
            ref = e.get("id") or e.get("name", "") + e.get("date", "")
            if ref not in seen:
                seen.add(ref)
                e["_source"] = "enquiry"
                e["status"] = e.get("status", "New")
                bookings.append(e)

        # Apply filter
        filt = self._booking_filter
        if filt != "all":
            bookings = [b for b in bookings
                        if filt.lower() in (b.get("status", "new")).lower()]

        self.after(0, lambda: self._render_bookings(bookings))

    def _render_bookings(self, bookings):
        for w in self._bookings_frame.winfo_children():
            w.destroy()
        self._set_status(f"{len(bookings)} booking(s)")

        if not bookings:
            ctk.CTkLabel(self._bookings_frame, text="No bookings matching filter.",
                         font=("Segoe UI", 13), text_color=C["muted"]).pack(pady=30)
            return

        for b in bookings[:50]:
            card = ctk.CTkFrame(self._bookings_frame, fg_color=C["card"], corner_radius=8)
            card.pack(fill="x", pady=3)

            top = ctk.CTkFrame(card, fg_color="transparent")
            top.pack(fill="x", padx=12, pady=(8, 2))

            name = b.get("clientName") or b.get("name") or b.get("client_name", "Unknown")
            status = b.get("status", "New")
            date = b.get("date", b.get("visitDate", ""))
            source = b.get("_source", "")

            ctk.CTkLabel(top, text=name, font=("Segoe UI", 14, "bold"),
                         text_color=C["text"]).pack(side="left")

            s_colors = {"new": C["warning"], "confirmed": C["success"],
                        "completed": C["purple"], "scheduled": C["accent2"],
                        "cancelled": C["danger"], "in-progress": C["orange"]}
            ctk.CTkLabel(top, text=status.title(),
                         font=("Segoe UI", 11, "bold"),
                         text_color=s_colors.get(status.lower(), C["muted"])).pack(side="right")

            src_labels = {"today": "📋 Today", "schedule": "📅 Schedule", "enquiry": "📩 Enquiry"}
            ctk.CTkLabel(top, text=src_labels.get(source, ""),
                         font=("Segoe UI", 9), text_color=C["muted"]).pack(side="right", padx=8)

            det = ctk.CTkFrame(card, fg_color="transparent")
            det.pack(fill="x", padx=12, pady=(0, 2))

            service = b.get("service") or b.get("serviceName") or b.get("service_type", "")
            email = b.get("email") or b.get("clientEmail", "")
            phone = b.get("phone") or b.get("telephone", "")

            if date:
                ctk.CTkLabel(det, text=f"📅 {date}", font=("Segoe UI", 11),
                             text_color=C["accent"]).pack(side="left", padx=(0, 12))
            if service:
                ctk.CTkLabel(det, text=f"🔧 {service}", font=("Segoe UI", 11),
                             text_color=C["muted"]).pack(side="left", padx=(0, 12))
            price = b.get("price") or b.get("total") or b.get("amount", "")
            if price and str(price) != "0":
                ctk.CTkLabel(det, text=f"£{price}", font=("Segoe UI", 12, "bold"),
                             text_color=C["success"]).pack(side="right")
            if email:
                ctk.CTkLabel(det, text=f"✉ {email}", font=("Segoe UI", 10),
                             text_color=C["muted"]).pack(side="right", padx=(0, 8))

            msg = b.get("message") or b.get("details") or b.get("notes", "")
            if msg:
                ctk.CTkLabel(card, text=f"📌 {msg}", font=("Segoe UI", 10),
                             text_color=C["muted"], wraplength=600,
                             justify="left").pack(anchor="w", padx=12, pady=(0, 4))

            # Action buttons
            actions = ctk.CTkFrame(card, fg_color="transparent")
            actions.pack(fill="x", padx=12, pady=(0, 8))

            st = status.lower()
            if st in ("new", "pending", ""):
                ctk.CTkButton(actions, text="✅ Confirm Booking", height=28, width=140,
                               fg_color=C["success"], hover_color="#059669", text_color="#fff",
                               font=("Segoe UI", 11),
                               command=lambda bk=b: self._confirm_booking(bk)).pack(side="left", padx=(0, 6))
                ctk.CTkButton(actions, text="📧 Send Confirmation Email", height=28, width=200,
                               fg_color=C["accent2"], hover_color="#2563eb", text_color="#fff",
                               font=("Segoe UI", 11),
                               command=lambda bk=b: self._send_booking_confirmation(bk)).pack(side="left", padx=(0, 6))

            if st in ("confirmed", "scheduled") and source == "enquiry":
                ctk.CTkButton(actions, text="📧 Send Quote", height=28, width=120,
                               fg_color=C["accent"], hover_color="#3d9e80", text_color="#111",
                               font=("Segoe UI", 11),
                               command=lambda bk=b: self._send_quote_email(bk)).pack(side="left", padx=(0, 6))

            if st not in ("completed", "complete", "invoiced", "cancelled"):
                ctk.CTkButton(actions, text="❌ Cancel", height=28, width=80,
                               fg_color=C["danger"], hover_color="#dc2626", text_color="#fff",
                               font=("Segoe UI", 10),
                               command=lambda bk=b: self._cancel_booking(bk)).pack(side="right")

    def _confirm_booking(self, booking):
        ref = booking.get("ref") or booking.get("jobNumber", "")
        try:
            api_post("update_booking_status", {
                "jobRef": ref,
                "status": "confirmed",
                "notes": f"Confirmed from Field App at {datetime.now().strftime('%H:%M %d/%m')}",
            })
            self._set_status(f"✅ Booking confirmed: {booking.get('clientName', booking.get('name', ''))}")
            self._load_bookings_filtered(self._booking_filter)
        except Exception as e:
            messagebox.showerror("Error", str(e))

    def _send_booking_confirmation(self, booking):
        try:
            send_pc_command("send_booking_confirmation", {"booking": booking})
            self._set_status(f"📧 PC will send confirmation to {booking.get('name', booking.get('clientName', ''))}")
        except Exception as e:
            messagebox.showerror("Error", str(e))

    def _send_quote_email(self, booking):
        try:
            send_pc_command("send_quote_email", {"enquiry": booking})
            self._set_status(f"📧 PC will send quote to {booking.get('name', booking.get('clientName', ''))}")
        except Exception as e:
            messagebox.showerror("Error", str(e))

    def _cancel_booking(self, booking):
        ref = booking.get("ref") or booking.get("jobNumber", "")
        if not messagebox.askyesno("Cancel Booking",
                                    f"Cancel booking for {booking.get('clientName', booking.get('name', ''))}?"):
            return
        try:
            api_post("update_booking_status", {
                "jobRef": ref,
                "status": "cancelled",
                "notes": f"Cancelled from Field App at {datetime.now().strftime('%H:%M %d/%m')}",
            })
            self._set_status("❌ Booking cancelled")
            self._load_bookings_filtered(self._booking_filter)
        except Exception as e:
            messagebox.showerror("Error", str(e))

    # ════════════════════════════════════════════════════════════
    #  TAB: Schedule
    # ════════════════════════════════════════════════════════════
    def _tab_schedule(self):
        frame = ctk.CTkFrame(self._content, fg_color=C["bg"])
        frame.pack(fill="both", expand=True, padx=14, pady=14)

        header = ctk.CTkFrame(frame, fg_color="transparent")
        header.pack(fill="x", pady=(0, 10))
        ctk.CTkLabel(header, text="Schedule", font=("Segoe UI", 20, "bold"),
                     text_color=C["text"]).pack(side="left")

        self._sched_offset = 0
        nav = ctk.CTkFrame(header, fg_color="transparent")
        nav.pack(side="right")
        ctk.CTkButton(nav, text="◀", width=40, height=30, fg_color=C["card"],
                       command=lambda: self._sched_nav(-1)).pack(side="left", padx=2)
        self._sched_label = ctk.CTkLabel(nav, text="", font=("Segoe UI", 13, "bold"),
                                          text_color=C["accent"])
        self._sched_label.pack(side="left", padx=10)
        ctk.CTkButton(nav, text="▶", width=40, height=30, fg_color=C["card"],
                       command=lambda: self._sched_nav(1)).pack(side="left", padx=2)
        ctk.CTkButton(nav, text="Today", width=55, height=30,
                       fg_color=C["accent"], text_color="#111",
                       command=lambda: self._sched_nav(0, True)).pack(side="left", padx=(6, 0))

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
        self._set_status(f"Loading {display}...")

        def _load():
            try:
                data = api_get("get_schedule", date=ds)
                jobs = data.get("jobs", []) if isinstance(data, dict) else (data if isinstance(data, list) else [])
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
                         font=("Segoe UI", 13), text_color=C["muted"]).pack(pady=30)
            return
        for job in jobs:
            card = ctk.CTkFrame(self._sched_scroll, fg_color=C["card"], corner_radius=8)
            card.pack(fill="x", pady=3)
            row = ctk.CTkFrame(card, fg_color="transparent")
            row.pack(fill="x", padx=12, pady=8)
            name = job.get("client_name") or job.get("name") or job.get("clientName", "?")
            time_s = job.get("time", job.get("start_time", ""))
            lbl = f"⏰ {time_s}  —  {name}" if time_s else name
            ctk.CTkLabel(row, text=lbl, font=("Segoe UI", 13, "bold"),
                         text_color=C["text"]).pack(side="left")
            price = job.get("price") or job.get("amount", "")
            if price and str(price) != "0":
                ctk.CTkLabel(row, text=f"£{price}", font=("Segoe UI", 12, "bold"),
                             text_color=C["success"]).pack(side="right")
            service = job.get("service") or job.get("service_type") or job.get("serviceName", "")
            if service:
                ctk.CTkLabel(row, text=service, font=("Segoe UI", 11),
                             text_color=C["muted"]).pack(side="right", padx=12)
            status = job.get("status", "")
            if status:
                s_c = C["success"] if "complet" in status.lower() else C["warning"] if "progress" in status.lower() else C["muted"]
                ctk.CTkLabel(row, text=status.title(), font=("Segoe UI", 10, "bold"),
                             text_color=s_c).pack(side="right", padx=8)

    # ════════════════════════════════════════════════════════════
    #  TAB: Job Tracking — Time data from mobile app
    # ════════════════════════════════════════════════════════════
    def _tab_tracking(self):
        frame = ctk.CTkFrame(self._content, fg_color=C["bg"])
        frame.pack(fill="both", expand=True, padx=14, pady=14)
        self._section(frame, "Job Tracking",
                      "Time tracking data from the mobile app — start/end times, durations, photos")

        filt = ctk.CTkFrame(frame, fg_color="transparent")
        filt.pack(fill="x", pady=(0, 10))
        ctk.CTkButton(filt, text="Today", width=60, height=28,
                       fg_color=C["accent"], text_color="#111",
                       command=lambda: self._load_tracking(datetime.now().strftime("%Y-%m-%d"))
                       ).pack(side="left", padx=(0, 4))
        ctk.CTkButton(filt, text="Yesterday", width=75, height=28,
                       fg_color=C["card"], text_color=C["text"],
                       command=lambda: self._load_tracking(
                           (datetime.now() - timedelta(days=1)).strftime("%Y-%m-%d"))
                       ).pack(side="left", padx=(0, 4))
        ctk.CTkButton(filt, text="All Recent", width=80, height=28,
                       fg_color=C["card"], text_color=C["text"],
                       command=lambda: self._load_tracking("")
                       ).pack(side="left")

        self._track_scroll = ctk.CTkScrollableFrame(frame, fg_color=C["bg"])
        self._track_scroll.pack(fill="both", expand=True)
        self._load_tracking(datetime.now().strftime("%Y-%m-%d"))

    def _load_tracking(self, date_filter=""):
        for w in self._track_scroll.winfo_children():
            w.destroy()
        self._set_status("Loading job tracking...")

        def _load():
            try:
                params = {"limit": "50"}
                if date_filter:
                    params["date"] = date_filter
                data = api_get("get_job_tracking", **params)
                records = data.get("records", []) if isinstance(data, dict) else []
            except Exception as e:
                self.after(0, lambda: self._error_card(self._track_scroll, str(e)))
                return
            self.after(0, lambda: self._render_tracking(records, date_filter))

        self._threaded(_load)

    def _render_tracking(self, records, date_filter):
        label = f"for {date_filter}" if date_filter else "(recent)"
        self._set_status(f"{len(records)} tracking record(s) {label}")

        if not records:
            ctk.CTkLabel(self._track_scroll, text="No tracking records found.",
                         font=("Segoe UI", 13), text_color=C["muted"]).pack(pady=30)
            return

        total_mins = sum(r.get("durationMins") or 0 for r in records if r.get("durationMins"))
        completed = sum(1 for r in records if not r.get("isActive") and r.get("endTime"))
        active = sum(1 for r in records if r.get("isActive"))
        total_photos = sum(r.get("photoCount", 0) for r in records)

        summary = ctk.CTkFrame(self._track_scroll, fg_color=C["card"], corner_radius=8)
        summary.pack(fill="x", pady=(0, 10))
        s_inner = ctk.CTkFrame(summary, fg_color="transparent")
        s_inner.pack(fill="x", padx=12, pady=10)

        hrs = total_mins // 60
        mins = int(total_mins % 60)
        for lbl, val, col in [
            ("Completed", str(completed), C["success"]),
            ("Active", str(active), C["warning"]),
            ("Total Time", f"{hrs}h {mins}m", C["accent"]),
            ("Photos", str(total_photos), C["accent2"]),
        ]:
            f = ctk.CTkFrame(s_inner, fg_color="transparent")
            f.pack(side="left", expand=True)
            ctk.CTkLabel(f, text=val, font=("Segoe UI", 18, "bold"),
                         text_color=col).pack()
            ctk.CTkLabel(f, text=lbl, font=("Segoe UI", 10),
                         text_color=C["muted"]).pack()

        for rec in records:
            card = ctk.CTkFrame(self._track_scroll, fg_color=C["card"], corner_radius=6)
            card.pack(fill="x", pady=2)
            row = ctk.CTkFrame(card, fg_color="transparent")
            row.pack(fill="x", padx=12, pady=8)

            ref = rec.get("jobRef", "?")
            is_active = rec.get("isActive", False)
            dur = rec.get("durationMins")

            icon = "🔴" if is_active else "✅"
            ctk.CTkLabel(row, text=f"{icon}  {ref}",
                         font=("Segoe UI", 13, "bold"),
                         text_color=C["text"]).pack(side="left")

            if is_active:
                ctk.CTkLabel(row, text="IN PROGRESS", font=("Segoe UI", 10, "bold"),
                             text_color=C["warning"]).pack(side="right")
            elif dur:
                ctk.CTkLabel(row, text=f"{int(dur)} mins", font=("Segoe UI", 11, "bold"),
                             text_color=C["success"]).pack(side="right")

            photos = rec.get("photoCount", 0)
            if photos:
                ctk.CTkLabel(row, text=f"📸 {photos}", font=("Segoe UI", 10),
                             text_color=C["muted"]).pack(side="right", padx=8)

            start = rec.get("startTime", "")[:16]
            if start:
                ctk.CTkLabel(row, text=f"Start: {start}", font=("Segoe UI", 10),
                             text_color=C["muted"]).pack(side="right", padx=8)

            notes = rec.get("notes", "")
            if notes:
                ctk.CTkLabel(card, text=f"📌 {notes}", font=("Segoe UI", 10),
                             text_color=C["muted"], wraplength=600,
                             justify="left").pack(anchor="w", padx=12, pady=(0, 6))

    # ════════════════════════════════════════════════════════════
    #  TAB: Clients
    # ════════════════════════════════════════════════════════════
    def _tab_clients(self):
        frame = ctk.CTkFrame(self._content, fg_color=C["bg"])
        frame.pack(fill="both", expand=True, padx=14, pady=14)

        header = ctk.CTkFrame(frame, fg_color="transparent")
        header.pack(fill="x", pady=(0, 10))
        ctk.CTkLabel(header, text="Clients", font=("Segoe UI", 20, "bold"),
                     text_color=C["text"]).pack(side="left")

        self._cli_search = ctk.CTkEntry(header, placeholder_text="Search clients...",
                                         width=250, height=32)
        self._cli_search.pack(side="right")
        self._cli_search.bind("<Return>", lambda e: self._filter_clients())
        ctk.CTkButton(header, text="🔍", width=36, height=32,
                       fg_color=C["accent"], text_color="#111",
                       command=self._filter_clients).pack(side="right", padx=(0, 6))

        self._cli_scroll = ctk.CTkScrollableFrame(frame, fg_color=C["bg"])
        self._cli_scroll.pack(fill="both", expand=True)
        self._set_status("Loading clients...")
        self._threaded(self._load_clients)

    def _load_clients(self):
        try:
            data = api_get("get_clients")
            clients = data.get("clients", []) if isinstance(data, dict) else (data if isinstance(data, list) else [])
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
                         font=("Segoe UI", 13), text_color=C["muted"]).pack(pady=30)
            return
        for c in clients[:100]:
            card = ctk.CTkFrame(self._cli_scroll, fg_color=C["card"], corner_radius=6)
            card.pack(fill="x", pady=2)
            row = ctk.CTkFrame(card, fg_color="transparent")
            row.pack(fill="x", padx=12, pady=7)
            name = c.get("name", c.get("client_name", "Unknown"))
            email = c.get("email", "")
            phone = c.get("phone", c.get("telephone", ""))
            postcode = c.get("postcode", "")
            ctk.CTkLabel(row, text=name, font=("Segoe UI", 13, "bold"),
                         text_color=C["text"]).pack(side="left")
            if postcode:
                ctk.CTkLabel(row, text=f"📍 {postcode}", font=("Segoe UI", 10),
                             text_color=C["muted"]).pack(side="right", padx=(6, 0))
            if phone:
                ctk.CTkLabel(row, text=f"📱 {phone}", font=("Segoe UI", 10),
                             text_color=C["muted"]).pack(side="right", padx=(6, 0))
            if email:
                ctk.CTkLabel(row, text=f"✉ {email}", font=("Segoe UI", 10),
                             text_color=C["muted"]).pack(side="right", padx=(6, 0))

    # ════════════════════════════════════════════════════════════
    #  TAB: Enquiries
    # ════════════════════════════════════════════════════════════
    def _tab_enquiries(self):
        frame = ctk.CTkScrollableFrame(self._content, fg_color=C["bg"])
        frame.pack(fill="both", expand=True, padx=14, pady=14)
        self._section(frame, "Enquiries", "New enquiries from the website — trigger PC to reply")
        self._enq_frame = frame
        self._set_status("Loading enquiries...")
        self._threaded(self._load_enquiries)

    def _load_enquiries(self):
        try:
            data = api_get("get_enquiries")
            enqs = data.get("enquiries", []) if isinstance(data, dict) else (data if isinstance(data, list) else [])
        except Exception as e:
            self.after(0, lambda: self._error_card(self._enq_frame, str(e)))
            return
        self.after(0, lambda: self._render_enquiries(enqs))

    def _render_enquiries(self, enqs):
        self._set_status(f"{len(enqs)} enquiry/enquiries")
        if not enqs:
            ctk.CTkLabel(self._enq_frame, text="No enquiries.",
                         font=("Segoe UI", 13), text_color=C["muted"]).pack(pady=30)
            return
        for enq in enqs[:30]:
            card = ctk.CTkFrame(self._enq_frame, fg_color=C["card"], corner_radius=8)
            card.pack(fill="x", pady=4)
            top = ctk.CTkFrame(card, fg_color="transparent")
            top.pack(fill="x", padx=12, pady=(10, 4))
            name = enq.get("name", "Unknown")
            status = enq.get("status", "New")
            date = enq.get("date", enq.get("created_at", ""))
            ctk.CTkLabel(top, text=name, font=("Segoe UI", 14, "bold"),
                         text_color=C["text"]).pack(side="left")
            s_c = C["warning"] if status.lower() == "new" else C["success"]
            ctk.CTkLabel(top, text=status, font=("Segoe UI", 11, "bold"),
                         text_color=s_c).pack(side="right")
            if date:
                ctk.CTkLabel(top, text=date, font=("Segoe UI", 10),
                             text_color=C["muted"]).pack(side="right", padx=10)

            det = ctk.CTkFrame(card, fg_color="transparent")
            det.pack(fill="x", padx=12, pady=(0, 4))
            service = enq.get("service", "")
            email = enq.get("email", "")
            phone = enq.get("phone", "")
            if service:
                ctk.CTkLabel(det, text=f"🔧 {service}", font=("Segoe UI", 11),
                             text_color=C["muted"]).pack(side="left")
            if email:
                ctk.CTkLabel(det, text=f"✉ {email}", font=("Segoe UI", 11),
                             text_color=C["muted"]).pack(side="right", padx=(6, 0))
            if phone:
                ctk.CTkLabel(det, text=f"📱 {phone}", font=("Segoe UI", 11),
                             text_color=C["muted"]).pack(side="right", padx=(6, 0))

            msg = enq.get("message", enq.get("details", ""))
            if msg:
                ctk.CTkLabel(card, text=msg, font=("Segoe UI", 10),
                             text_color=C["muted"], wraplength=600,
                             justify="left").pack(anchor="w", padx=12, pady=(0, 6))

            ctk.CTkButton(
                card, text="📧 Ask PC to Reply", height=28, width=150,
                fg_color=C["accent2"], hover_color="#2563eb", text_color="#fff",
                font=("Segoe UI", 11),
                command=lambda e=enq: self._trigger_reply(e),
            ).pack(anchor="w", padx=12, pady=(0, 8))

    def _trigger_reply(self, enq):
        try:
            send_pc_command("send_enquiry_reply", {"enquiry": enq})
            self._set_status(f"📧 PC will reply to {enq.get('name', '')}")
        except Exception as e:
            messagebox.showerror("Error", str(e))

    # ════════════════════════════════════════════════════════════
    #  TAB: Invoices
    # ════════════════════════════════════════════════════════════
    def _tab_invoices(self):
        frame = ctk.CTkScrollableFrame(self._content, fg_color=C["bg"])
        frame.pack(fill="both", expand=True, padx=14, pady=14)
        self._section(frame, "Invoices",
                      "All invoices — includes those sent from the mobile app")
        self._inv_frame = frame
        self._set_status("Loading invoices...")
        self._threaded(self._load_invoices)

    def _load_invoices(self):
        try:
            data = api_get("get_invoices")
            invs = data.get("invoices", []) if isinstance(data, dict) else (data if isinstance(data, list) else [])
        except Exception as e:
            self.after(0, lambda: self._error_card(self._inv_frame, str(e)))
            return
        self.after(0, lambda: self._render_invoices(invs))

    def _render_invoices(self, invs):
        self._set_status(f"{len(invs)} invoice(s)")
        if not invs:
            ctk.CTkLabel(self._inv_frame, text="No invoices found.",
                         font=("Segoe UI", 13), text_color=C["muted"]).pack(pady=30)
            return

        for inv in invs[:50]:
            card = ctk.CTkFrame(self._inv_frame, fg_color=C["card"], corner_radius=6)
            card.pack(fill="x", pady=2)
            row = ctk.CTkFrame(card, fg_color="transparent")
            row.pack(fill="x", padx=12, pady=8)

            inv_num = inv.get("invoiceNumber") or inv.get("invoice_number") or inv.get("id", "?")
            name = inv.get("name") or inv.get("client_name") or inv.get("clientName", "?")
            amount = inv.get("amount") or inv.get("total") or inv.get("price", "")
            status = inv.get("status", inv.get("paid", ""))
            date = inv.get("date") or inv.get("created", inv.get("timestamp", ""))

            ctk.CTkLabel(row, text=f"#{inv_num}  {name}",
                         font=("Segoe UI", 13, "bold"),
                         text_color=C["text"]).pack(side="left")

            if amount:
                ctk.CTkLabel(row, text=f"£{amount}", font=("Segoe UI", 12, "bold"),
                             text_color=C["success"]).pack(side="right")

            if status:
                paid = str(status).lower() in ("paid", "yes", "true")
                ctk.CTkLabel(row, text="Paid" if paid else str(status),
                             font=("Segoe UI", 10, "bold"),
                             text_color=C["success"] if paid else C["warning"]
                             ).pack(side="right", padx=8)

            if date:
                ctk.CTkLabel(row, text=str(date)[:10], font=("Segoe UI", 10),
                             text_color=C["muted"]).pack(side="right", padx=8)

    # ════════════════════════════════════════════════════════════
    #  TAB: PC Triggers
    # ════════════════════════════════════════════════════════════
    def _tab_triggers(self):
        frame = ctk.CTkScrollableFrame(self._content, fg_color=C["bg"])
        frame.pack(fill="both", expand=True, padx=14, pady=14)
        self._section(frame, "Trigger PC Actions",
                      "Queue heavy jobs on the main PC. It picks them up within 60 seconds.")

        triggers = [
            ("generate_blog",       "📝 Generate Blog Post",
             "AI writes a new blog post and saves as draft", C["accent"]),
            ("generate_newsletter", "📰 Generate Newsletter",
             "AI creates this month's newsletter draft", C["accent"]),
            ("send_reminders",      "⏰ Send Job Reminders",
             "Send day-before reminder emails to tomorrow's clients", C["accent2"]),
            ("run_email_lifecycle", "📧 Run Email Lifecycle",
             "Process all automated email campaigns + follow-ups", C["accent2"]),
            ("send_booking_confirmation", "📧 Send Booking Confirmations",
             "Trigger confirmation emails for today's bookings", C["accent2"]),
            ("force_sync",         "🔄 Force Full Sync",
             "Push and pull all data to/from Google Sheets", C["warning"]),
            ("run_agent",          "🤖 Run Blog Agent",
             "Force the blog writer AI agent to run now", C["purple"]),
            ("run_agent",          "🤖 Run Review Chaser",
             "Chase recent clients for Google reviews", C["purple"]),
        ]

        for i, (cmd, label, desc, color) in enumerate(triggers):
            card = ctk.CTkFrame(frame, fg_color=C["card"], corner_radius=8)
            card.pack(fill="x", pady=4)
            row = ctk.CTkFrame(card, fg_color="transparent")
            row.pack(fill="x", padx=12, pady=10)
            left = ctk.CTkFrame(row, fg_color="transparent")
            left.pack(side="left", fill="x", expand=True)
            ctk.CTkLabel(left, text=label, font=("Segoe UI", 14, "bold"),
                         text_color=C["text"]).pack(anchor="w")
            ctk.CTkLabel(left, text=desc, font=("Segoe UI", 11),
                         text_color=C["muted"]).pack(anchor="w")

            result_lbl = ctk.CTkLabel(left, text="", font=("Segoe UI", 10),
                                       text_color=C["success"])
            result_lbl.pack(anchor="w")

            def _fire(c=cmd, l=label, rl=result_lbl, idx=i):
                agent_map = {
                    "🤖 Run Blog Agent": "blog_writer",
                    "🤖 Run Review Chaser": "review_chaser",
                }
                if c == "run_agent":
                    d = {"agent_id": agent_map.get(l, "blog_writer")}
                else:
                    d = {}
                try:
                    resp = send_pc_command(c, d)
                    rl.configure(text="⏳ Queued — PC will process within 60s",
                                 text_color=C["warning"])
                    self._set_status(f"✅ {l} — queued on PC")
                    self.after(70_000, lambda: self._check_trigger_result(rl))
                except Exception as e:
                    rl.configure(text=f"❌ Failed: {e}", text_color=C["danger"])
                    messagebox.showerror("Error", str(e))

            ctk.CTkButton(
                row, text="Trigger", width=80, height=30,
                fg_color=color, hover_color="#2a3a5c",
                text_color="#111" if color in (C["accent"], C["warning"]) else "#fff",
                font=("Segoe UI", 12, "bold"), command=_fire,
            ).pack(side="right")

        ctk.CTkFrame(frame, height=1, fg_color=C["border"]).pack(fill="x", pady=14)
        ctk.CTkLabel(frame, text="Recent Commands", font=("Segoe UI", 14, "bold"),
                     text_color=C["text"]).pack(anchor="w", pady=(0, 6))
        self._cmd_frame = ctk.CTkFrame(frame, fg_color="transparent")
        self._cmd_frame.pack(fill="x")
        self._threaded(self._load_cmd_history)

    def _load_cmd_history(self):
        try:
            data = api_get("get_remote_commands", status="all", limit="15")
            cmds = data.get("commands", []) if isinstance(data, dict) else []
        except Exception:
            cmds = []
        self.after(0, lambda: self._render_cmd_history(cmds))

    def _render_cmd_history(self, cmds):
        for w in self._cmd_frame.winfo_children():
            w.destroy()
        if not cmds:
            ctk.CTkLabel(self._cmd_frame, text="No command history yet.",
                         font=("Segoe UI", 11), text_color=C["muted"]).pack(pady=6)
            return
        for cmd in cmds:
            row = ctk.CTkFrame(self._cmd_frame, fg_color=C["card"], corner_radius=6)
            row.pack(fill="x", pady=1)
            inner = ctk.CTkFrame(row, fg_color="transparent")
            inner.pack(fill="x", padx=10, pady=5)
            st = cmd.get("status", "?")
            icon = "✅" if st == "completed" else "⏳" if st == "pending" else "❌"
            ctk.CTkLabel(inner, text=f"{icon} {cmd.get('command', '?')}",
                         font=("Segoe UI", 11, "bold"),
                         text_color=C["text"]).pack(side="left")
            ts = cmd.get("created_at", "")[:16]
            if ts:
                ctk.CTkLabel(inner, text=ts, font=("Segoe UI", 9),
                             text_color=C["muted"]).pack(side="right")
            src = cmd.get("source", "")
            if src:
                ctk.CTkLabel(inner, text=src, font=("Segoe UI", 9, "bold"),
                             text_color=C["orange"] if src == "mobile" else C["accent2"]
                             ).pack(side="right", padx=6)
            ctk.CTkLabel(inner, text=st, font=("Segoe UI", 9),
                         text_color=C["success"] if st == "completed" else C["warning"]
                         ).pack(side="right", padx=6)

            result_text = cmd.get("result", "")
            if result_text and st in ("completed", "failed"):
                ctk.CTkLabel(row, text=f"→ {result_text}", font=("Segoe UI", 10),
                             text_color=C["success"] if st == "completed" else C["danger"],
                             wraplength=600, justify="left").pack(anchor="w", padx=10, pady=(0, 4))

    def _check_trigger_result(self, result_label):
        """Check the most recent command result for trigger feedback."""
        def _check():
            try:
                data = api_get("get_remote_commands", status="all", limit="3")
                cmds = data.get("commands", []) if isinstance(data, dict) else []
                if cmds:
                    latest = cmds[0]
                    st = latest.get("status", "")
                    result = latest.get("result", "")
                    if st == "completed":
                        self.after(0, lambda: result_label.configure(
                            text=f"✅ Done: {result[:80]}", text_color=C["success"]))
                    elif st == "failed":
                        self.after(0, lambda: result_label.configure(
                            text=f"❌ Failed: {result[:80]}", text_color=C["danger"]))
                    else:
                        self.after(0, lambda: result_label.configure(
                            text="⏳ Still processing...", text_color=C["warning"]))
            except Exception:
                pass
        self._threaded(_check)

    # ════════════════════════════════════════════════════════════
    #  TAB: Field Notes (synced to GAS, reads back from GAS)
    # ════════════════════════════════════════════════════════════
    def _tab_notes(self):
        frame = ctk.CTkFrame(self._content, fg_color=C["bg"])
        frame.pack(fill="both", expand=True, padx=14, pady=14)
        self._section(frame, "Field Notes",
                      "Jot notes in the field. Saved locally + synced to the main system.")

        self._note_input = ctk.CTkTextbox(
            frame, height=100, fg_color=C["card"], text_color=C["text"],
            font=("Segoe UI", 12), border_color=C["accent"], border_width=1)
        self._note_input.pack(fill="x", pady=(0, 6))

        btn_row = ctk.CTkFrame(frame, fg_color="transparent")
        btn_row.pack(fill="x", pady=(0, 12))
        self._note_cat = ctk.CTkOptionMenu(
            btn_row, values=["General", "Job Note", "Client Feedback", "Issue", "Idea"],
            width=150, height=30, fg_color=C["card"])
        self._note_cat.pack(side="left")
        ctk.CTkButton(btn_row, text="💾 Save Note", height=30, width=110,
                       fg_color=C["accent"], text_color="#111",
                       font=("Segoe UI", 12, "bold"),
                       command=self._save_note).pack(side="right")

        ctk.CTkFrame(frame, height=1, fg_color=C["border"]).pack(fill="x", pady=6)

        self._notes_scroll = ctk.CTkScrollableFrame(frame, fg_color=C["bg"])
        self._notes_scroll.pack(fill="both", expand=True)

        self._threaded(self._load_notes_from_gas)

    def _save_note(self):
        text = self._note_input.get("1.0", "end").strip()
        if not text:
            return
        note = {
            "text": text,
            "category": self._note_cat.get(),
            "timestamp": datetime.now().isoformat(),
            "date": datetime.now().strftime("%Y-%m-%d %H:%M"),
        }
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
        self._threaded(self._load_notes_from_gas)

    def _load_notes_from_gas(self):
        notes = []
        try:
            data = api_get("get_field_notes", limit="50")
            notes = data.get("notes", []) if isinstance(data, dict) else []
        except Exception:
            notes_file = PLATFORM_DIR / "data" / "field_notes.json"
            if notes_file.exists():
                try:
                    notes = json.loads(notes_file.read_text(encoding="utf-8"))
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
                         font=("Segoe UI", 12), text_color=C["muted"]).pack(pady=16)
            return
        for n in notes[:50]:
            card = ctk.CTkFrame(self._notes_scroll, fg_color=C["card"], corner_radius=6)
            card.pack(fill="x", pady=2)
            row = ctk.CTkFrame(card, fg_color="transparent")
            row.pack(fill="x", padx=10, pady=(6, 2))
            ctk.CTkLabel(row, text=n.get("category", "General"),
                         font=("Segoe UI", 10, "bold"),
                         text_color=C["accent"]).pack(side="left")
            ctk.CTkLabel(row, text=n.get("date", n.get("timestamp", ""))[:16],
                         font=("Segoe UI", 10),
                         text_color=C["muted"]).pack(side="right")
            ctk.CTkLabel(card, text=n.get("text", ""), font=("Segoe UI", 11),
                         text_color=C["text"], wraplength=600,
                         justify="left").pack(anchor="w", padx=10, pady=(0, 6))

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
