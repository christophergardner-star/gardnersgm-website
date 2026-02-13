"""
GGM Hub — Laptop Field App
A lightweight companion for Chris to use when out in the field.

Does NOT run agents, emails, newsletters, or blog posting.
CAN trigger the PC node to do those heavy actions.
Talks directly to GAS webhook for live data.

Features:
  - Today's Jobs: see what's booked for today
  - Schedule: browse upcoming jobs by date
  - Clients: search and view client details
  - Enquiries: view new enquiries and respond (via PC trigger)
  - PC Triggers: queue heavy actions on the main PC node
  - Quick Notes: jot down field notes that sync to the system
"""

import os
import sys
import json
import threading
import subprocess
from datetime import datetime, timedelta
from pathlib import Path

# ── Ensure we can import from the app package ──
SCRIPT_DIR = Path(__file__).resolve().parent
PLATFORM_DIR = SCRIPT_DIR
sys.path.insert(0, str(PLATFORM_DIR))

import customtkinter as ctk
from tkinter import messagebox

# Lightweight API client (talks directly to GAS)
import requests
from urllib.parse import urlencode

# ──────────────────────────────────────────────────────────────────
# Configuration
# ──────────────────────────────────────────────────────────────────
APP_NAME = "GGM Field"
VERSION = "1.0.0"
BRANCH = "master"

# Load webhook URL from .env or fall back to hardcoded
def _load_webhook():
    """Find the webhook URL from .env files or environment."""
    # Try dotenv
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
# Lightweight API helper (no dependency on app.api)
# ──────────────────────────────────────────────────────────────────
_session = requests.Session()
_session.headers["User-Agent"] = f"GGM-Field/{VERSION}"


def api_get(action: str, **params) -> dict:
    """GET request to the GAS webhook."""
    query = {"action": action, **params}
    url = f"{WEBHOOK_URL}?{urlencode(query)}"
    resp = _session.get(url, timeout=20, allow_redirects=True)
    resp.raise_for_status()
    return resp.json()


def api_post(action: str, data: dict = None) -> dict:
    """POST request to the GAS webhook."""
    payload = {"action": action}
    if data:
        payload.update(data)
    resp = _session.post(WEBHOOK_URL, json=payload, timeout=20, allow_redirects=True)
    resp.raise_for_status()
    return resp.json()


def send_pc_command(command: str, data: dict = None):
    """Queue a heavy command for the PC node to execute."""
    return api_post("queue_remote_command", {
        "command": command,
        "data": json.dumps(data or {}),
        "source": "laptop",
        "created_at": datetime.now().isoformat(),
    })


# ──────────────────────────────────────────────────────────────────
# Colour palette (matches GGM Hub dark theme)
# ──────────────────────────────────────────────────────────────────
C_BG       = "#1a1a2e"
C_SIDEBAR  = "#16213e"
C_CARD     = "#1f2940"
C_ACCENT   = "#4ecca3"
C_ACCENT2  = "#3b82f6"
C_TEXT     = "#e8e8e8"
C_MUTED    = "#8899aa"
C_SUCCESS  = "#10b981"
C_WARNING  = "#f59e0b"
C_DANGER   = "#ef4444"


# ──────────────────────────────────────────────────────────────────
# Main Application
# ──────────────────────────────────────────────────────────────────

class FieldApp(ctk.CTk):
    """Lightweight field companion — no heavy services, just data views + PC triggers."""

    TABS = [
        ("today",     "📋  Today's Jobs"),
        ("schedule",  "📅  Schedule"),
        ("clients",   "👤  Clients"),
        ("enquiries", "📩  Enquiries"),
        ("triggers",  "🖥️  PC Triggers"),
        ("notes",     "📝  Quick Notes"),
    ]

    def __init__(self):
        super().__init__()
        self.title(f"🌿 {APP_NAME} — Gardners Ground Maintenance")
        self._configure_window()

        # State
        self._current_tab = None
        self._tab_frames = {}
        self._cached_data = {}

        # Build UI
        self._build_sidebar()
        self._build_content_area()
        self._build_status_bar()

        # Default tab
        self._switch_tab("today")

    # ── Window sizing ──
    def _configure_window(self):
        screen_w = self.winfo_screenwidth()
        screen_h = self.winfo_screenheight()
        w = min(1100, screen_w - 20)
        h = min(750, screen_h - 112)
        x = max(0, (screen_w - w) // 2)
        y = max(0, (screen_h - h) // 2 - 20)
        self.geometry(f"{w}x{h}+{x}+{y}")
        self.minsize(800, 550)

    # ── Sidebar ──
    def _build_sidebar(self):
        sidebar = ctk.CTkFrame(self, width=200, fg_color=C_SIDEBAR, corner_radius=0)
        sidebar.pack(side="left", fill="y")
        sidebar.pack_propagate(False)

        # Logo
        ctk.CTkLabel(
            sidebar, text="🌿 GGM Field", font=("Segoe UI", 18, "bold"),
            text_color=C_ACCENT,
        ).pack(pady=(20, 4))
        ctk.CTkLabel(
            sidebar, text="Lightweight field companion",
            font=("Segoe UI", 10), text_color=C_MUTED,
        ).pack(pady=(0, 16))

        # Nav buttons
        self._nav_buttons = {}
        for key, label in self.TABS:
            btn = ctk.CTkButton(
                sidebar, text=label, anchor="w",
                font=("Segoe UI", 13), height=38,
                fg_color="transparent", hover_color="#283b5b",
                text_color=C_TEXT,
                command=lambda k=key: self._switch_tab(k),
            )
            btn.pack(fill="x", padx=8, pady=2)
            self._nav_buttons[key] = btn

        # Git pull button at bottom
        ctk.CTkFrame(sidebar, height=1, fg_color="#2a3a5c").pack(fill="x", padx=12, pady=(16, 8))
        ctk.CTkButton(
            sidebar, text="🔄  Pull Updates", height=32,
            fg_color="#0f3460", hover_color="#283b5b",
            command=self._git_pull,
        ).pack(fill="x", padx=12, pady=4)

        # Version
        ctk.CTkLabel(
            sidebar, text=f"v{VERSION}", font=("Segoe UI", 9),
            text_color="#556677",
        ).pack(side="bottom", pady=6)

    # ── Content area ──
    def _build_content_area(self):
        self._content = ctk.CTkFrame(self, fg_color=C_BG, corner_radius=0)
        self._content.pack(side="left", fill="both", expand=True)

    # ── Status bar ──
    def _build_status_bar(self):
        bar = ctk.CTkFrame(self, height=28, fg_color="#111827", corner_radius=0)
        bar.pack(side="bottom", fill="x")
        bar.pack_propagate(False)

        self._status_label = ctk.CTkLabel(
            bar, text="Ready", font=("Segoe UI", 10), text_color=C_MUTED, anchor="w",
        )
        self._status_label.pack(side="left", padx=12)

        self._clock_label = ctk.CTkLabel(
            bar, text="", font=("Segoe UI", 10), text_color=C_MUTED,
        )
        self._clock_label.pack(side="right", padx=12)
        self._tick_clock()

    def _tick_clock(self):
        self._clock_label.configure(text=datetime.now().strftime("%H:%M  %a %d %b"))
        self.after(30_000, self._tick_clock)

    def _set_status(self, msg: str):
        self._status_label.configure(text=msg)

    # ── Tab switching ──
    def _switch_tab(self, key: str):
        if self._current_tab == key:
            return
        # Highlight active nav button
        for k, btn in self._nav_buttons.items():
            btn.configure(fg_color=C_ACCENT if k == key else "transparent",
                          text_color="#111" if k == key else C_TEXT)
        # Clear old tab
        for w in self._content.winfo_children():
            w.destroy()
        self._current_tab = key
        # Build new tab
        builder = getattr(self, f"_build_{key}_tab", None)
        if builder:
            builder()

    # ══════════════════════════════════════════════════════════════
    #  TAB : Today's Jobs
    # ══════════════════════════════════════════════════════════════
    def _build_today_tab(self):
        frame = ctk.CTkScrollableFrame(self._content, fg_color=C_BG)
        frame.pack(fill="both", expand=True, padx=16, pady=16)

        today_str = datetime.now().strftime("%A %d %B %Y")
        ctk.CTkLabel(frame, text=f"Today's Jobs — {today_str}",
                      font=("Segoe UI", 20, "bold"), text_color=C_TEXT).pack(anchor="w", pady=(0, 12))

        self._set_status("Loading today's jobs...")
        threading.Thread(target=self._load_today_jobs, args=(frame,), daemon=True).start()

    def _load_today_jobs(self, frame):
        try:
            today = datetime.now().strftime("%Y-%m-%d")
            data = api_get("get_schedule", date=today)
            jobs = data if isinstance(data, list) else data.get("jobs", data.get("schedule", []))
        except Exception as e:
            self.after(0, lambda: self._show_error(frame, f"Could not load jobs: {e}"))
            return

        self.after(0, lambda: self._render_today_jobs(frame, jobs))

    def _render_today_jobs(self, frame, jobs):
        self._set_status(f"{len(jobs)} job(s) today")

        if not jobs:
            ctk.CTkLabel(frame, text="No jobs scheduled for today.",
                          font=("Segoe UI", 14), text_color=C_MUTED).pack(pady=30)
            return

        for i, job in enumerate(jobs):
            card = ctk.CTkFrame(frame, fg_color=C_CARD, corner_radius=8)
            card.pack(fill="x", pady=4)

            # Job header
            top = ctk.CTkFrame(card, fg_color="transparent")
            top.pack(fill="x", padx=12, pady=(10, 4))

            client_name = job.get("client_name") or job.get("name") or job.get("client", "Unknown")
            time_str = job.get("time", job.get("start_time", ""))
            status = job.get("status", "Scheduled")

            status_colors = {
                "Completed": C_SUCCESS, "In Progress": C_WARNING,
                "Cancelled": C_DANGER, "Scheduled": C_ACCENT2,
            }

            ctk.CTkLabel(top, text=f"#{i+1}  {client_name}",
                          font=("Segoe UI", 14, "bold"), text_color=C_TEXT).pack(side="left")

            ctk.CTkLabel(top, text=status,
                          font=("Segoe UI", 11, "bold"),
                          text_color=status_colors.get(status, C_MUTED)).pack(side="right")

            if time_str:
                ctk.CTkLabel(top, text=f"⏰ {time_str}",
                              font=("Segoe UI", 11), text_color=C_ACCENT).pack(side="right", padx=12)

            # Details row
            details = ctk.CTkFrame(card, fg_color="transparent")
            details.pack(fill="x", padx=12, pady=(0, 4))

            service = job.get("service", job.get("service_type", ""))
            address = job.get("address", job.get("postcode", ""))
            if service:
                ctk.CTkLabel(details, text=f"🔧 {service}",
                              font=("Segoe UI", 11), text_color=C_MUTED).pack(side="left", padx=(0, 16))
            if address:
                ctk.CTkLabel(details, text=f"📍 {address}",
                              font=("Segoe UI", 11), text_color=C_MUTED).pack(side="left")

            # Price
            price = job.get("price", job.get("amount", ""))
            if price:
                ctk.CTkLabel(details, text=f"£{price}",
                              font=("Segoe UI", 12, "bold"), text_color=C_SUCCESS).pack(side="right")

            # Notes
            notes = job.get("notes", "")
            if notes:
                ctk.CTkLabel(card, text=f"📌 {notes}", font=("Segoe UI", 10),
                              text_color=C_MUTED, wraplength=600, justify="left"
                              ).pack(anchor="w", padx=12, pady=(0, 8))

            # Actions
            actions = ctk.CTkFrame(card, fg_color="transparent")
            actions.pack(fill="x", padx=12, pady=(0, 8))

            ctk.CTkButton(
                actions, text="✅ Mark Complete", height=28, width=130,
                fg_color=C_SUCCESS, hover_color="#059669", text_color="#fff",
                font=("Segoe UI", 11),
                command=lambda j=job: self._mark_job_complete(j),
            ).pack(side="left", padx=(0, 6))

            ctk.CTkButton(
                actions, text="📧 Send Completion Email", height=28, width=180,
                fg_color=C_ACCENT2, hover_color="#2563eb", text_color="#fff",
                font=("Segoe UI", 11),
                command=lambda j=job: self._trigger_completion_email(j),
            ).pack(side="left")

    def _mark_job_complete(self, job):
        """Mark a job as completed via GAS."""
        try:
            api_post("update_booking_status", {
                "booking_id": job.get("id", job.get("booking_id", "")),
                "status": "Completed",
            })
            self._set_status(f"✅ {job.get('client_name', 'Job')} marked complete")
            # Refresh
            self._switch_tab(None)
            self._current_tab = None
            self._switch_tab("today")
        except Exception as e:
            messagebox.showerror("Error", f"Could not update: {e}")

    def _trigger_completion_email(self, job):
        """Ask PC to send the completion email."""
        try:
            send_pc_command("send_completion", {"job": job})
            self._set_status(f"📧 PC will send completion email for {job.get('client_name', 'job')}")
        except Exception as e:
            messagebox.showerror("Error", f"Could not queue command: {e}")

    # ══════════════════════════════════════════════════════════════
    #  TAB : Schedule
    # ══════════════════════════════════════════════════════════════
    def _build_schedule_tab(self):
        frame = ctk.CTkFrame(self._content, fg_color=C_BG)
        frame.pack(fill="both", expand=True, padx=16, pady=16)

        # Header with date navigation
        header = ctk.CTkFrame(frame, fg_color="transparent")
        header.pack(fill="x", pady=(0, 12))

        ctk.CTkLabel(header, text="Schedule", font=("Segoe UI", 20, "bold"),
                      text_color=C_TEXT).pack(side="left")

        # Date picker (simple: today + next 7 days)
        self._sched_date_offset = 0
        nav = ctk.CTkFrame(header, fg_color="transparent")
        nav.pack(side="right")

        ctk.CTkButton(nav, text="◀ Prev", width=70, height=30,
                       fg_color=C_CARD, hover_color="#2a3a5c",
                       command=lambda: self._schedule_nav(-1)).pack(side="left", padx=2)

        self._sched_date_label = ctk.CTkLabel(nav, text="", font=("Segoe UI", 13, "bold"),
                                               text_color=C_ACCENT)
        self._sched_date_label.pack(side="left", padx=12)

        ctk.CTkButton(nav, text="Next ▶", width=70, height=30,
                       fg_color=C_CARD, hover_color="#2a3a5c",
                       command=lambda: self._schedule_nav(1)).pack(side="left", padx=2)

        ctk.CTkButton(nav, text="Today", width=60, height=30,
                       fg_color=C_ACCENT, hover_color="#3ba88a", text_color="#111",
                       command=lambda: self._schedule_nav(0, reset=True)).pack(side="left", padx=(8, 0))

        # Scrollable jobs area
        self._sched_scroll = ctk.CTkScrollableFrame(frame, fg_color=C_BG)
        self._sched_scroll.pack(fill="both", expand=True)

        self._load_schedule_day()

    def _schedule_nav(self, delta, reset=False):
        if reset:
            self._sched_date_offset = 0
        else:
            self._sched_date_offset += delta
        self._load_schedule_day()

    def _load_schedule_day(self):
        target = datetime.now() + timedelta(days=self._sched_date_offset)
        date_str = target.strftime("%Y-%m-%d")
        display_date = target.strftime("%A %d %b %Y")

        self._sched_date_label.configure(text=display_date)
        for w in self._sched_scroll.winfo_children():
            w.destroy()

        self._set_status(f"Loading schedule for {display_date}...")

        def _load():
            try:
                data = api_get("get_schedule", date=date_str)
                jobs = data if isinstance(data, list) else data.get("jobs", data.get("schedule", []))
            except Exception as e:
                self.after(0, lambda: self._show_error(self._sched_scroll, str(e)))
                return
            self.after(0, lambda: self._render_schedule(jobs, display_date))

        threading.Thread(target=_load, daemon=True).start()

    def _render_schedule(self, jobs, display_date):
        self._set_status(f"{len(jobs)} job(s) on {display_date}")
        for w in self._sched_scroll.winfo_children():
            w.destroy()

        if not jobs:
            ctk.CTkLabel(self._sched_scroll, text="No jobs on this day.",
                          font=("Segoe UI", 13), text_color=C_MUTED).pack(pady=30)
            return

        for job in jobs:
            card = ctk.CTkFrame(self._sched_scroll, fg_color=C_CARD, corner_radius=8)
            card.pack(fill="x", pady=3)

            row = ctk.CTkFrame(card, fg_color="transparent")
            row.pack(fill="x", padx=12, pady=8)

            name = job.get("client_name") or job.get("name", "?")
            time_s = job.get("time", job.get("start_time", ""))
            service = job.get("service", job.get("service_type", ""))
            price = job.get("price", job.get("amount", ""))

            label = f"{name}"
            if time_s:
                label = f"⏰ {time_s}  —  {label}"
            ctk.CTkLabel(row, text=label, font=("Segoe UI", 13, "bold"),
                          text_color=C_TEXT).pack(side="left")

            if price:
                ctk.CTkLabel(row, text=f"£{price}", font=("Segoe UI", 12, "bold"),
                              text_color=C_SUCCESS).pack(side="right")
            if service:
                ctk.CTkLabel(row, text=service, font=("Segoe UI", 11),
                              text_color=C_MUTED).pack(side="right", padx=12)

    # ══════════════════════════════════════════════════════════════
    #  TAB : Clients
    # ══════════════════════════════════════════════════════════════
    def _build_clients_tab(self):
        frame = ctk.CTkFrame(self._content, fg_color=C_BG)
        frame.pack(fill="both", expand=True, padx=16, pady=16)

        # Header + search
        header = ctk.CTkFrame(frame, fg_color="transparent")
        header.pack(fill="x", pady=(0, 12))

        ctk.CTkLabel(header, text="Clients", font=("Segoe UI", 20, "bold"),
                      text_color=C_TEXT).pack(side="left")

        self._client_search = ctk.CTkEntry(
            header, placeholder_text="Search clients...", width=260, height=32,
        )
        self._client_search.pack(side="right")
        self._client_search.bind("<Return>", lambda e: self._search_clients())

        ctk.CTkButton(header, text="🔍", width=36, height=32,
                       fg_color=C_ACCENT, hover_color="#3ba88a", text_color="#111",
                       command=self._search_clients).pack(side="right", padx=(0, 6))

        # Results
        self._client_scroll = ctk.CTkScrollableFrame(frame, fg_color=C_BG)
        self._client_scroll.pack(fill="both", expand=True)

        # Load all clients initially
        self._set_status("Loading clients...")
        threading.Thread(target=self._load_clients, daemon=True).start()

    def _load_clients(self, search_term=""):
        try:
            data = api_get("get_clients")
            clients = data if isinstance(data, list) else data.get("clients", [])
        except Exception as e:
            self.after(0, lambda: self._show_error(self._client_scroll, str(e)))
            return

        if search_term:
            term = search_term.lower()
            clients = [c for c in clients if term in json.dumps(c).lower()]

        self._cached_data["clients"] = clients
        self.after(0, lambda: self._render_clients(clients))

    def _search_clients(self):
        term = self._client_search.get().strip()
        if hasattr(self, '_cached_data') and "clients" in self._cached_data:
            clients = self._cached_data["clients"]
            if term:
                t = term.lower()
                clients = [c for c in clients if t in json.dumps(c).lower()]
            self._render_clients(clients)
        else:
            threading.Thread(target=self._load_clients, args=(term,), daemon=True).start()

    def _render_clients(self, clients):
        for w in self._client_scroll.winfo_children():
            w.destroy()
        self._set_status(f"{len(clients)} client(s)")

        if not clients:
            ctk.CTkLabel(self._client_scroll, text="No clients found.",
                          font=("Segoe UI", 13), text_color=C_MUTED).pack(pady=30)
            return

        for c in clients[:100]:  # limit to 100 for performance
            card = ctk.CTkFrame(self._client_scroll, fg_color=C_CARD, corner_radius=8)
            card.pack(fill="x", pady=2)

            row = ctk.CTkFrame(card, fg_color="transparent")
            row.pack(fill="x", padx=12, pady=8)

            name = c.get("name", c.get("client_name", "Unknown"))
            email = c.get("email", "")
            phone = c.get("phone", c.get("telephone", ""))
            postcode = c.get("postcode", c.get("address", ""))
            is_paying = c.get("is_subscriber") or c.get("paying", False)

            # Badge
            if is_paying:
                ctk.CTkLabel(row, text="⭐", font=("Segoe UI", 14)).pack(side="left", padx=(0, 6))

            ctk.CTkLabel(row, text=name, font=("Segoe UI", 13, "bold"),
                          text_color=C_TEXT).pack(side="left")

            if postcode:
                ctk.CTkLabel(row, text=f"📍 {postcode}", font=("Segoe UI", 11),
                              text_color=C_MUTED).pack(side="right", padx=(8, 0))
            if phone:
                ctk.CTkLabel(row, text=f"📱 {phone}", font=("Segoe UI", 11),
                              text_color=C_MUTED).pack(side="right", padx=(8, 0))
            if email:
                ctk.CTkLabel(row, text=f"✉ {email}", font=("Segoe UI", 11),
                              text_color=C_MUTED).pack(side="right", padx=(8, 0))

    # ══════════════════════════════════════════════════════════════
    #  TAB : Enquiries
    # ══════════════════════════════════════════════════════════════
    def _build_enquiries_tab(self):
        frame = ctk.CTkScrollableFrame(self._content, fg_color=C_BG)
        frame.pack(fill="both", expand=True, padx=16, pady=16)

        ctk.CTkLabel(frame, text="Enquiries", font=("Segoe UI", 20, "bold"),
                      text_color=C_TEXT).pack(anchor="w", pady=(0, 12))

        self._set_status("Loading enquiries...")
        self._enq_frame = frame
        threading.Thread(target=self._load_enquiries, daemon=True).start()

    def _load_enquiries(self):
        try:
            data = api_get("get_enquiries")
            enquiries = data if isinstance(data, list) else data.get("enquiries", [])
        except Exception as e:
            self.after(0, lambda: self._show_error(self._enq_frame, str(e)))
            return
        self.after(0, lambda: self._render_enquiries(enquiries))

    def _render_enquiries(self, enquiries):
        self._set_status(f"{len(enquiries)} enquiry/enquiries")

        if not enquiries:
            ctk.CTkLabel(self._enq_frame, text="No enquiries.",
                          font=("Segoe UI", 13), text_color=C_MUTED).pack(pady=30)
            return

        for enq in enquiries[:30]:
            card = ctk.CTkFrame(self._enq_frame, fg_color=C_CARD, corner_radius=8)
            card.pack(fill="x", pady=4)

            top = ctk.CTkFrame(card, fg_color="transparent")
            top.pack(fill="x", padx=12, pady=(10, 4))

            name = enq.get("name", "Unknown")
            date = enq.get("date", enq.get("created_at", ""))
            status = enq.get("status", "New")
            service = enq.get("service", "")

            ctk.CTkLabel(top, text=name, font=("Segoe UI", 14, "bold"),
                          text_color=C_TEXT).pack(side="left")

            s_color = C_WARNING if status.lower() == "new" else C_SUCCESS
            ctk.CTkLabel(top, text=status, font=("Segoe UI", 11, "bold"),
                          text_color=s_color).pack(side="right")
            if date:
                ctk.CTkLabel(top, text=date, font=("Segoe UI", 10),
                              text_color=C_MUTED).pack(side="right", padx=12)

            detail = ctk.CTkFrame(card, fg_color="transparent")
            detail.pack(fill="x", padx=12, pady=(0, 4))

            if service:
                ctk.CTkLabel(detail, text=f"🔧 {service}", font=("Segoe UI", 11),
                              text_color=C_MUTED).pack(side="left")

            email = enq.get("email", "")
            phone = enq.get("phone", "")
            if email:
                ctk.CTkLabel(detail, text=f"✉ {email}", font=("Segoe UI", 11),
                              text_color=C_MUTED).pack(side="right", padx=(8, 0))
            if phone:
                ctk.CTkLabel(detail, text=f"📱 {phone}", font=("Segoe UI", 11),
                              text_color=C_MUTED).pack(side="right", padx=(8, 0))

            msg = enq.get("message", enq.get("details", ""))
            if msg:
                ctk.CTkLabel(card, text=msg, font=("Segoe UI", 10),
                              text_color=C_MUTED, wraplength=600, justify="left"
                              ).pack(anchor="w", padx=12, pady=(0, 8))

            # Action: trigger PC to reply
            actions = ctk.CTkFrame(card, fg_color="transparent")
            actions.pack(fill="x", padx=12, pady=(0, 8))

            ctk.CTkButton(
                actions, text="📧 Ask PC to Reply", height=28, width=150,
                fg_color=C_ACCENT2, hover_color="#2563eb", text_color="#fff",
                font=("Segoe UI", 11),
                command=lambda e=enq: self._trigger_enquiry_reply(e),
            ).pack(side="left")

    def _trigger_enquiry_reply(self, enquiry):
        try:
            send_pc_command("send_enquiry_reply", {"enquiry": enquiry})
            self._set_status(f"📧 PC will reply to {enquiry.get('name', 'enquiry')}")
        except Exception as e:
            messagebox.showerror("Error", f"Could not queue: {e}")

    # ══════════════════════════════════════════════════════════════
    #  TAB : PC Triggers
    # ══════════════════════════════════════════════════════════════
    def _build_triggers_tab(self):
        frame = ctk.CTkScrollableFrame(self._content, fg_color=C_BG)
        frame.pack(fill="both", expand=True, padx=16, pady=16)

        ctk.CTkLabel(frame, text="Trigger PC Actions", font=("Segoe UI", 20, "bold"),
                      text_color=C_TEXT).pack(anchor="w", pady=(0, 4))
        ctk.CTkLabel(frame, text="Queue heavy actions on the main PC node. "
                      "It will pick them up within 60 seconds.",
                      font=("Segoe UI", 12), text_color=C_MUTED,
                      wraplength=600, justify="left").pack(anchor="w", pady=(0, 16))

        triggers = [
            ("generate_blog",       "📝  Generate Blog Post",
             "AI writes a new blog post and saves as draft", C_ACCENT),
            ("generate_newsletter", "📰  Generate Newsletter",
             "AI creates this month's newsletter draft", C_ACCENT),
            ("send_reminders",      "⏰  Send Job Reminders",
             "Send day-before reminder emails to tomorrow's clients", C_ACCENT2),
            ("run_email_lifecycle",  "📧  Run Email Lifecycle",
             "Process all automated email campaigns + follow-ups", C_ACCENT2),
            ("force_sync",          "🔄  Force Full Sync",
             "Push and pull all data to/from Google Sheets", C_WARNING),
            ("run_agent",           "🤖  Run Blog Agent",
             "Force the blog writer AI agent to run now", C_ACCENT),
        ]

        for cmd, label, desc, color in triggers:
            card = ctk.CTkFrame(frame, fg_color=C_CARD, corner_radius=8)
            card.pack(fill="x", pady=4)

            row = ctk.CTkFrame(card, fg_color="transparent")
            row.pack(fill="x", padx=12, pady=10)

            left = ctk.CTkFrame(row, fg_color="transparent")
            left.pack(side="left", fill="x", expand=True)

            ctk.CTkLabel(left, text=label, font=("Segoe UI", 14, "bold"),
                          text_color=C_TEXT).pack(anchor="w")
            ctk.CTkLabel(left, text=desc, font=("Segoe UI", 11),
                          text_color=C_MUTED).pack(anchor="w")

            def _trigger(c=cmd, l=label):
                data = {}
                if c == "run_agent":
                    data = {"agent_id": "blog_writer"}
                try:
                    send_pc_command(c, data)
                    self._set_status(f"✅ {l} — queued on PC")
                except Exception as e:
                    messagebox.showerror("Error", f"Failed: {e}")

            ctk.CTkButton(
                row, text="Trigger", width=90, height=32,
                fg_color=color, hover_color="#2a3a5c",
                text_color="#111" if color == C_ACCENT else "#fff",
                font=("Segoe UI", 12, "bold"),
                command=_trigger,
            ).pack(side="right")

        # Command history
        ctk.CTkFrame(frame, height=1, fg_color="#2a3a5c").pack(fill="x", pady=16)
        ctk.CTkLabel(frame, text="Recent Commands", font=("Segoe UI", 14, "bold"),
                      text_color=C_TEXT).pack(anchor="w", pady=(0, 8))

        self._cmd_history_frame = ctk.CTkFrame(frame, fg_color="transparent")
        self._cmd_history_frame.pack(fill="x")

        threading.Thread(target=self._load_command_history, daemon=True).start()

    def _load_command_history(self):
        try:
            data = api_get("get_remote_commands", status="all", limit="10")
            cmds = data if isinstance(data, list) else data.get("commands", [])
        except Exception:
            cmds = []
        self.after(0, lambda: self._render_command_history(cmds))

    def _render_command_history(self, cmds):
        for w in self._cmd_history_frame.winfo_children():
            w.destroy()

        if not cmds:
            ctk.CTkLabel(self._cmd_history_frame, text="No command history yet.",
                          font=("Segoe UI", 11), text_color=C_MUTED).pack(pady=8)
            return

        for cmd in cmds:
            row = ctk.CTkFrame(self._cmd_history_frame, fg_color=C_CARD, corner_radius=6)
            row.pack(fill="x", pady=2)

            inner = ctk.CTkFrame(row, fg_color="transparent")
            inner.pack(fill="x", padx=10, pady=6)

            status = cmd.get("status", "?")
            icon = "✅" if status == "completed" else "⏳" if status == "pending" else "❌"
            ctk.CTkLabel(inner, text=f"{icon}  {cmd.get('command', '?')}",
                          font=("Segoe UI", 11, "bold"), text_color=C_TEXT).pack(side="left")

            ts = cmd.get("created_at", "")
            if ts:
                ctk.CTkLabel(inner, text=ts[:16], font=("Segoe UI", 10),
                              text_color=C_MUTED).pack(side="right")
            ctk.CTkLabel(inner, text=status, font=("Segoe UI", 10),
                          text_color=C_SUCCESS if status == "completed" else C_WARNING).pack(side="right", padx=8)

    # ══════════════════════════════════════════════════════════════
    #  TAB : Quick Notes
    # ══════════════════════════════════════════════════════════════
    def _build_notes_tab(self):
        frame = ctk.CTkFrame(self._content, fg_color=C_BG)
        frame.pack(fill="both", expand=True, padx=16, pady=16)

        ctk.CTkLabel(frame, text="Quick Notes", font=("Segoe UI", 20, "bold"),
                      text_color=C_TEXT).pack(anchor="w", pady=(0, 4))
        ctk.CTkLabel(frame, text="Jot down notes in the field. They'll sync to the main system.",
                      font=("Segoe UI", 12), text_color=C_MUTED).pack(anchor="w", pady=(0, 12))

        # Note input
        self._note_input = ctk.CTkTextbox(
            frame, height=120, fg_color=C_CARD, text_color=C_TEXT,
            font=("Segoe UI", 12), border_color=C_ACCENT, border_width=1,
        )
        self._note_input.pack(fill="x", pady=(0, 8))

        # Category selector + save button
        btn_row = ctk.CTkFrame(frame, fg_color="transparent")
        btn_row.pack(fill="x", pady=(0, 16))

        self._note_category = ctk.CTkOptionMenu(
            btn_row, values=["General", "Job Note", "Client Feedback", "Issue", "Idea"],
            width=160, height=32, fg_color=C_CARD,
        )
        self._note_category.pack(side="left")

        ctk.CTkButton(
            btn_row, text="💾  Save Note", height=32, width=120,
            fg_color=C_ACCENT, hover_color="#3ba88a", text_color="#111",
            font=("Segoe UI", 12, "bold"),
            command=self._save_note,
        ).pack(side="right")

        # Saved notes
        ctk.CTkFrame(frame, height=1, fg_color="#2a3a5c").pack(fill="x", pady=8)

        self._notes_scroll = ctk.CTkScrollableFrame(frame, fg_color=C_BG)
        self._notes_scroll.pack(fill="both", expand=True)

        # Load existing notes
        self._load_notes_from_file()

    def _save_note(self):
        text = self._note_input.get("1.0", "end").strip()
        if not text:
            return

        note = {
            "text": text,
            "category": self._note_category.get(),
            "timestamp": datetime.now().isoformat(),
            "date": datetime.now().strftime("%Y-%m-%d %H:%M"),
        }

        # Save locally as JSON
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

        # Also push to GAS
        try:
            api_post("save_field_note", note)
        except Exception:
            pass  # local save is enough

        self._note_input.delete("1.0", "end")
        self._set_status(f"📝 Note saved ({note['category']})")
        self._load_notes_from_file()

    def _load_notes_from_file(self):
        notes_file = PLATFORM_DIR / "data" / "field_notes.json"
        notes = []
        if notes_file.exists():
            try:
                notes = json.loads(notes_file.read_text(encoding="utf-8"))
            except Exception:
                pass

        if not hasattr(self, '_notes_scroll'):
            return

        for w in self._notes_scroll.winfo_children():
            w.destroy()

        if not notes:
            ctk.CTkLabel(self._notes_scroll, text="No notes yet.",
                          font=("Segoe UI", 12), text_color=C_MUTED).pack(pady=20)
            return

        for note in notes[:50]:
            card = ctk.CTkFrame(self._notes_scroll, fg_color=C_CARD, corner_radius=6)
            card.pack(fill="x", pady=2)

            row = ctk.CTkFrame(card, fg_color="transparent")
            row.pack(fill="x", padx=10, pady=(6, 2))

            cat = note.get("category", "General")
            ctk.CTkLabel(row, text=cat, font=("Segoe UI", 10, "bold"),
                          text_color=C_ACCENT).pack(side="left")
            ctk.CTkLabel(row, text=note.get("date", ""), font=("Segoe UI", 10),
                          text_color=C_MUTED).pack(side="right")

            ctk.CTkLabel(card, text=note.get("text", ""), font=("Segoe UI", 11),
                          text_color=C_TEXT, wraplength=600, justify="left"
                          ).pack(anchor="w", padx=10, pady=(0, 8))

    # ══════════════════════════════════════════════════════════════
    #  Utilities
    # ══════════════════════════════════════════════════════════════
    def _show_error(self, parent, msg):
        self._set_status(f"⚠️ Error")
        ctk.CTkLabel(parent, text=f"⚠️ {msg}", font=("Segoe UI", 12),
                      text_color=C_DANGER, wraplength=500).pack(pady=20)

    def _git_pull(self):
        """Pull latest updates from GitHub."""
        self._set_status("Pulling updates...")

        def _do_pull():
            try:
                repo_root = PLATFORM_DIR.parent
                result = subprocess.run(
                    ["git", "pull", "--ff-only", "origin", BRANCH],
                    cwd=str(repo_root), capture_output=True, text=True, timeout=30,
                )
                if result.returncode == 0:
                    msg = result.stdout.strip() or "Up to date"
                    self.after(0, lambda: self._set_status(f"✅ {msg}"))
                else:
                    self.after(0, lambda: self._set_status(f"⚠️ Pull failed: {result.stderr.strip()}"))
            except Exception as e:
                self.after(0, lambda: self._set_status(f"⚠️ Pull error: {e}"))

        threading.Thread(target=_do_pull, daemon=True).start()


# ══════════════════════════════════════════════════════════════════
# Entry point
# ══════════════════════════════════════════════════════════════════

def main():
    ctk.set_appearance_mode("dark")
    ctk.set_default_color_theme("dark-blue")
    app = FieldApp()
    app.mainloop()


if __name__ == "__main__":
    main()
