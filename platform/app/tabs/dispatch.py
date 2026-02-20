"""
Daily Dispatch Tab — The operational heart for Chris's working day.
Replaces today.html with full job management, fund allocation,
Telegram notifications, and end-of-day summary.
"""

import customtkinter as ctk
from datetime import date, datetime, timedelta
import threading
import webbrowser
import urllib.parse
import logging

from ..ui import theme
from ..ui.components.kpi_card import KPICard
from ..ui.components.data_table import DataTable
from .. import config

_log = logging.getLogger("ggm.dispatch")


class DispatchTab(ctk.CTkScrollableFrame):
    """Daily Dispatch — manage today's jobs, complete work, track earnings."""

    # Case-insensitive lookup for service material costs
    _materials_lower = {k.lower(): v for k, v in config.SERVICE_MATERIALS.items()}

    def __init__(self, parent, db, sync, api, app_window, **kwargs):
        super().__init__(parent, fg_color=theme.BG_DARK, **kwargs)

        self.db = db
        self.sync = sync
        self.api = api
        self.app = app_window

        self._current_date = date.today()
        self._kpi_cards = {}
        self._job_cards = []

        self._build_ui()

    def _safe(self, fn, *args):
        """Wrap a button callback so exceptions show as toasts instead of silent failures."""
        try:
            fn(*args)
        except Exception as e:
            fn_name = getattr(fn, '__name__', str(fn))
            _log.exception(f"Action error in {fn_name}: {e}")
            self.app.show_toast(f"Error: {e}", "error")

    # ------------------------------------------------------------------
    # UI Construction
    # ------------------------------------------------------------------
    def _build_ui(self):
        self.grid_columnconfigure(0, weight=1)

        # ── Date Navigation ──
        self._build_date_nav()

        # ── KPI Row ──
        self._build_kpis()

        # ── Conflict Warning Banner (hidden by default) ──
        self._conflict_banner = ctk.CTkFrame(self, fg_color="#3d2a1f", corner_radius=10)
        self._conflict_banner.pack(fill="x", padx=16, pady=(0, 4))
        self._conflict_banner.pack_forget()

        self._conflict_banner_inner = ctk.CTkFrame(self._conflict_banner, fg_color="transparent")
        self._conflict_banner_inner.pack(fill="x", padx=16, pady=10)

        self._conflict_icon = ctk.CTkLabel(
            self._conflict_banner_inner, text="⚠️",
            font=theme.font(16), width=30,
        )
        self._conflict_icon.pack(side="left")

        self._conflict_label = ctk.CTkLabel(
            self._conflict_banner_inner,
            text="",
            font=theme.font(12),
            text_color=theme.AMBER,
            anchor="w",
            wraplength=700,
        )
        self._conflict_label.pack(side="left", fill="x", expand=True, padx=(8, 0))

        self._conflict_resolve_btn = ctk.CTkButton(
            self._conflict_banner_inner,
            text="Suggest Best Date",
            width=130, height=30,
            fg_color=theme.AMBER, hover_color="#d68910",
            text_color=theme.BG_DARK, corner_radius=6,
            font=theme.font(11, "bold"),
            command=self._show_best_date_suggestions,
        )
        self._conflict_resolve_btn.pack(side="right", padx=(8, 0))

        # ── Job Cards ──
        self._build_jobs_section()

        # ── Fund Allocation ──
        self._build_fund_allocation()

        # ── Quick Telegram ──
        self._build_telegram_quick()

        # ── Day Summary ──
        self._build_day_summary()

    def _build_date_nav(self):
        nav = ctk.CTkFrame(self, fg_color=theme.BG_CARD, corner_radius=12)
        nav.pack(fill="x", padx=16, pady=(16, 8))

        inner = ctk.CTkFrame(nav, fg_color="transparent")
        inner.pack(padx=16, pady=12)

        ctk.CTkButton(
            inner, text="◄", width=36, height=36,
            fg_color=theme.GREEN_PRIMARY, hover_color=theme.GREEN_DARK,
            corner_radius=8, font=theme.font_bold(16),
            command=self._prev_day,
        ).pack(side="left", padx=(0, 12))

        self._date_label = ctk.CTkLabel(
            inner,
            text=self._current_date.strftime("%A, %d %B %Y"),
            font=theme.font_bold(18),
            text_color=theme.TEXT_LIGHT,
        )
        self._date_label.pack(side="left", padx=12)

        self._today_badge = ctk.CTkLabel(
            inner, text="TODAY", fg_color=theme.GREEN_PRIMARY,
            text_color="white", corner_radius=6, height=24,
            font=theme.font(10, "bold"), width=50,
        )
        self._today_badge.pack(side="left", padx=8)

        ctk.CTkButton(
            inner, text="►", width=36, height=36,
            fg_color=theme.GREEN_PRIMARY, hover_color=theme.GREEN_DARK,
            corner_radius=8, font=theme.font_bold(16),
            command=self._next_day,
        ).pack(side="left", padx=(12, 0))

        ctk.CTkButton(
            inner, text="Today", width=70, height=32,
            fg_color="transparent", hover_color=theme.BG_CARD_HOVER,
            border_width=1, border_color=theme.GREEN_PRIMARY,
            text_color=theme.GREEN_LIGHT, corner_radius=8,
            font=theme.font(12),
            command=self._go_today,
        ).pack(side="left", padx=(20, 0))

    def _build_kpis(self):
        kpi_frame = ctk.CTkFrame(self, fg_color="transparent")
        kpi_frame.pack(fill="x", padx=16, pady=(8, 8))
        for i in range(5):
            kpi_frame.grid_columnconfigure(i, weight=1)

        kpis = [
            ("jobs",      "📋", "0",   "Jobs Today"),
            ("revenue",   "💰", "£0",  "Revenue"),
            ("materials", "🧰", "£0",  "Materials"),
            ("fuel",      "⛽", "£0",  "Fuel Est."),
            ("profit",    "📈", "£0",  "Net Profit"),
        ]

        for i, (key, icon, default, label) in enumerate(kpis):
            card = KPICard(kpi_frame, icon=icon, value=default, label=label)
            card.grid(row=0, column=i, padx=6, pady=4, sticky="nsew")
            self._kpi_cards[key] = card

    def _build_jobs_section(self):
        section = ctk.CTkFrame(self, fg_color=theme.BG_CARD, corner_radius=12)
        section.pack(fill="x", padx=16, pady=(8, 8))

        header = ctk.CTkFrame(section, fg_color="transparent")
        header.pack(fill="x", padx=16, pady=(14, 8))
        header.grid_columnconfigure(1, weight=1)

        ctk.CTkLabel(
            header, text="📋 Today's Jobs",
            font=theme.font_bold(16), text_color=theme.TEXT_LIGHT,
            anchor="w",
        ).grid(row=0, column=0, sticky="w")

        self._jobs_count_label = ctk.CTkLabel(
            header, text="", font=theme.font(12),
            text_color=theme.TEXT_DIM,
        )
        self._jobs_count_label.grid(row=0, column=1, sticky="e")

        self._jobs_container = ctk.CTkFrame(section, fg_color="transparent")
        self._jobs_container.pack(fill="x", padx=12, pady=(0, 12))

        self._no_jobs_label = ctk.CTkLabel(
            self._jobs_container,
            text="No jobs scheduled for this date",
            font=theme.font(13), text_color=theme.TEXT_DIM,
        )
        self._no_jobs_label.pack(pady=20)

    def _build_fund_allocation(self):
        section = ctk.CTkFrame(self, fg_color=theme.BG_CARD, corner_radius=12)
        section.pack(fill="x", padx=16, pady=(8, 8))

        ctk.CTkLabel(
            section, text="🏦 Fund Allocation",
            font=theme.font_bold(15), text_color=theme.TEXT_LIGHT,
            anchor="w",
        ).pack(fill="x", padx=16, pady=(14, 8))

        self._fund_container = ctk.CTkFrame(section, fg_color="transparent")
        self._fund_container.pack(fill="x", padx=16, pady=(0, 14))

    def _build_telegram_quick(self):
        section = ctk.CTkFrame(self, fg_color=theme.BG_CARD, corner_radius=12)
        section.pack(fill="x", padx=16, pady=(8, 8))

        ctk.CTkLabel(
            section, text="📱 Quick Telegram",
            font=theme.font_bold(15), text_color=theme.TEXT_LIGHT,
            anchor="w",
        ).pack(fill="x", padx=16, pady=(14, 6))

        btn_row = ctk.CTkFrame(section, fg_color="transparent")
        btn_row.pack(fill="x", padx=12, pady=(0, 12))

        for label, msg in config.TELEGRAM_QUICK_MESSAGES.items():
            theme.create_outline_button(
                btn_row, label,
                command=lambda m=msg, l=label: self._send_quick_telegram(m, l),
                width=130,
            ).pack(side="left", padx=4, pady=4)

    def _build_day_summary(self):
        section = ctk.CTkFrame(self, fg_color=theme.BG_CARD, corner_radius=12)
        section.pack(fill="x", padx=16, pady=(8, 8))

        ctk.CTkLabel(
            section, text="📊 Day Summary",
            font=theme.font_bold(15), text_color=theme.TEXT_LIGHT,
            anchor="w",
        ).pack(fill="x", padx=16, pady=(14, 8))

        self._summary_container = ctk.CTkFrame(section, fg_color="transparent")
        self._summary_container.pack(fill="x", padx=16, pady=(0, 14))

        # Action buttons row
        btn_section = ctk.CTkFrame(section, fg_color="transparent")
        btn_section.pack(fill="x", padx=16, pady=(0, 14))

        theme.create_accent_button(
            btn_section, "📤 Send End-of-Day Report",
            command=self._send_day_report, width=220,
        ).pack(side="left", padx=(0, 8))

        theme.create_outline_button(
            btn_section, "📧 Send Reminders (Tomorrow)",
            command=self._send_reminders_tomorrow, width=230,
        ).pack(side="left", padx=(0, 8))

        theme.create_outline_button(
            btn_section, "🌤️ Check Weather",
            command=self._check_weather, width=160,
        ).pack(side="left", padx=(0, 8))

        self._dispatch_status = ctk.CTkLabel(
            btn_section, text="", font=theme.font(12), text_color=theme.TEXT_DIM,
        )
        self._dispatch_status.pack(side="left", padx=16)

        # Weather card (hidden until fetched)
        self._weather_section = ctk.CTkFrame(self, fg_color=theme.BG_CARD, corner_radius=12)
        # Don't pack yet — only shown after weather check

    # ------------------------------------------------------------------
    # Date Navigation
    # ------------------------------------------------------------------
    def _prev_day(self):
        self._current_date -= timedelta(days=1)
        self._update_date_display()
        self.refresh()

    def _next_day(self):
        self._current_date += timedelta(days=1)
        self._update_date_display()
        self.refresh()

    def _go_today(self):
        self._current_date = date.today()
        self._update_date_display()
        self.refresh()

    def _update_date_display(self):
        self._date_label.configure(
            text=self._current_date.strftime("%A, %d %B %Y")
        )
        if self._current_date == date.today():
            self._today_badge.configure(fg_color=theme.GREEN_PRIMARY, text="TODAY")
        else:
            diff = (self._current_date - date.today()).days
            if diff > 0:
                self._today_badge.configure(fg_color=theme.BLUE, text=f"+{diff}d")
            else:
                self._today_badge.configure(fg_color=theme.AMBER, text=f"{diff}d")

    # ------------------------------------------------------------------
    # Job Card Rendering
    # ------------------------------------------------------------------
    def _render_jobs(self, jobs: list):
        for w in self._jobs_container.winfo_children():
            w.destroy()
        self._job_cards.clear()

        if not jobs:
            ctk.CTkLabel(
                self._jobs_container,
                text="No jobs scheduled for this date",
                font=theme.font(13), text_color=theme.TEXT_DIM,
            ).pack(pady=20)
            self._jobs_count_label.configure(text="0 jobs")
            return

        completed = sum(1 for j in jobs if j.get("status") in ("Complete", "Completed"))
        self._jobs_count_label.configure(
            text=f"{completed}/{len(jobs)} complete"
        )

        for i, job in enumerate(jobs):
            card = self._create_job_card(job, i + 1)
            card.pack(fill="x", padx=4, pady=4)
            self._job_cards.append(card)

    def _create_job_card(self, job: dict, num: int) -> ctk.CTkFrame:
        is_complete = job.get("status") in ("Complete", "Completed")
        bg = theme.BG_CARD_HOVER if is_complete else theme.BG_INPUT

        card = ctk.CTkFrame(self._jobs_container, fg_color=bg, corner_radius=10)
        card.grid_columnconfigure(1, weight=1)

        # ── Left: Number badge ──
        ctk.CTkLabel(
            card, text=str(num), width=32, height=32,
            fg_color=theme.GREEN_PRIMARY if not is_complete else theme.TEXT_DIM,
            text_color="white", corner_radius=16,
            font=theme.font_bold(13),
        ).grid(row=0, column=0, padx=(12, 8), pady=(12, 4), rowspan=1)

        # ── Middle: Job info ──
        info_frame = ctk.CTkFrame(card, fg_color="transparent")
        info_frame.grid(row=0, column=1, sticky="ew", padx=4, pady=(10, 0))
        info_frame.grid_columnconfigure(0, weight=1)

        # Client name (clickable)
        name = job.get("client_name", job.get("name", "Unknown"))
        name_color = theme.TEXT_LIGHT if not is_complete else theme.TEXT_DIM
        name_label = ctk.CTkLabel(
            info_frame, text=name,
            font=theme.font_bold(14), text_color=name_color,
            anchor="w", cursor="hand2",
        )
        name_label.grid(row=0, column=0, sticky="w")
        name_label.bind("<Button-1>", lambda e, j=job: self._open_job_client(j))
        name_label.bind("<Enter>", lambda e, lbl=name_label: lbl.configure(text_color=theme.GREEN_LIGHT))
        name_label.bind("<Leave>", lambda e, lbl=name_label, c=name_color: lbl.configure(text_color=c))

        # Service + time + price + materials
        service = job.get("service", "")
        time_str = job.get("time", "TBC")
        price = float(job.get("price", 0) or 0)
        duration = config.SERVICE_DURATIONS.get(service, 1.0)
        materials = self._materials_lower.get(service.lower(), 0)

        details = f"{time_str}  •  {service}  •  £{price:,.0f}  •  ~{duration}h  •  🧰£{materials:.2f}"
        ctk.CTkLabel(
            info_frame, text=details,
            font=theme.font(11), text_color=theme.TEXT_DIM, anchor="w",
        ).grid(row=1, column=0, sticky="w", pady=(0, 2))

        # Contact info row
        phone = job.get("phone", "")
        email = job.get("email", "")
        contact_parts = []
        if phone:
            contact_parts.append(f"📞 {phone}")
        if email:
            contact_parts.append(f"📧 {email}")
        if contact_parts:
            ctk.CTkLabel(
                info_frame, text="  •  ".join(contact_parts),
                font=theme.font(10), text_color=theme.TEXT_DIM, anchor="w",
            ).grid(row=2, column=0, sticky="w")

        # Postcode + address
        postcode = job.get("postcode", "")
        address = job.get("address", "")
        loc = f"📍 {postcode}" + (f"  {address}" if address else "")
        if loc.strip() != "📍":
            loc_label = ctk.CTkLabel(
                info_frame, text=loc,
                font=theme.font(10), text_color=theme.BLUE, anchor="w",
                cursor="hand2",
            )
            loc_label.grid(row=3, column=0, sticky="w", pady=(0, 4))
            loc_label.bind("<Button-1>", lambda e, pc=postcode, addr=address: self._open_directions(pc, addr))

        # ── Right: Status badge ──
        status = job.get("status", "Pending")
        badge = theme.create_status_badge(card, status)
        badge.grid(row=0, column=2, padx=(4, 12), pady=(12, 4), sticky="ne")

        # ── Field Tracking Status (from mobile app) ──
        jn_track = job.get("job_number", "")
        field_data = self._field_tracking.get(jn_track) if hasattr(self, '_field_tracking') else None
        if field_data:
            is_active = field_data.get("is_active", 0)
            duration = field_data.get("duration_mins", 0)
            start_time = field_data.get("start_time", "")
            end_time = field_data.get("end_time", "")

            if is_active:
                # Currently being worked on
                start_short = start_time[11:16] if len(start_time) > 16 else start_time
                ft_text = f"🔨 In Progress  (started {start_short})"
                ft_colour = theme.AMBER
            elif end_time:
                # Completed in the field
                dur_str = f"{duration}m" if duration else ""
                ft_text = f"✅ Field Complete  {dur_str}"
                ft_colour = theme.GREEN_LIGHT
            else:
                ft_text = "📱 Tracked"
                ft_colour = theme.BLUE

            ft_label = ctk.CTkLabel(
                card, text=ft_text,
                font=theme.font(10, "bold"), text_color=ft_colour,
                anchor="ne",
            )
            ft_label.grid(row=0, column=2, padx=(4, 12), pady=(36, 0), sticky="ne")

        # ── Quick Actions Bar (row 1, spans full width) ──
        actions_frame = ctk.CTkFrame(card, fg_color="transparent")
        actions_frame.grid(row=1, column=0, columnspan=3, sticky="ew", padx=12, pady=(4, 10))

        # Row 1: Primary actions
        if not is_complete:
            ctk.CTkButton(
                actions_frame, text="✅ Complete", width=90, height=28,
                fg_color=theme.GREEN_PRIMARY, hover_color=theme.GREEN_DARK,
                corner_radius=6, font=theme.font(11, "bold"),
                command=lambda j=job: self._safe(self._complete_job, j),
            ).pack(side="left", padx=2, pady=2)

            ctk.CTkButton(
                actions_frame, text="📱 On Way", width=80, height=28,
                fg_color="transparent", hover_color=theme.BG_CARD,
                border_width=1, border_color=theme.BLUE,
                text_color=theme.BLUE, corner_radius=6,
                font=theme.font(11),
                command=lambda j=job: self._safe(self._send_on_way, j),
            ).pack(side="left", padx=2, pady=2)

        # Directions
        if postcode:
            ctk.CTkButton(
                actions_frame, text="🗺️ Directions", width=95, height=28,
                fg_color="transparent", hover_color=theme.BG_CARD,
                border_width=1, border_color=theme.GREEN_ACCENT,
                text_color=theme.GREEN_LIGHT, corner_radius=6,
                font=theme.font(11),
                command=lambda pc=postcode, addr=address: self._safe(self._open_directions, pc, addr),
            ).pack(side="left", padx=2, pady=2)

            ctk.CTkButton(
                actions_frame, text="📲 Send Nav", width=90, height=28,
                fg_color="transparent", hover_color=theme.BG_CARD,
                border_width=1, border_color=theme.GREEN_ACCENT,
                text_color=theme.GREEN_LIGHT, corner_radius=6,
                font=theme.font(11),
                command=lambda j=job: self._safe(self._send_directions_telegram, j),
            ).pack(side="left", padx=2, pady=2)

        # Invoice
        ctk.CTkButton(
            actions_frame, text="🧾 Invoice", width=80, height=28,
            fg_color="transparent", hover_color=theme.BG_CARD,
            border_width=1, border_color=theme.AMBER,
            text_color=theme.AMBER, corner_radius=6,
            font=theme.font(11),
            command=lambda j=job: self._safe(self._create_invoice_for_job, j),
        ).pack(side="left", padx=2, pady=2)

        # Photos
        jn = job.get("job_number", "")
        photo_count = self._photo_counts.get(jn, 0) if hasattr(self, '_photo_counts') else 0
        photo_text = f"📸 {photo_count}" if photo_count else "📸"
        ctk.CTkButton(
            actions_frame, text=photo_text, width=60, height=28,
            fg_color="transparent", hover_color=theme.BG_CARD,
            border_width=1, border_color=theme.AMBER,
            text_color=theme.AMBER, corner_radius=6,
            font=theme.font(11),
            command=lambda j=job: self._safe(self._open_job_photos, j),
        ).pack(side="left", padx=2, pady=2)

        # View booking
        ctk.CTkButton(
            actions_frame, text="📋 Booking", width=80, height=28,
            fg_color="transparent", hover_color=theme.BG_CARD,
            border_width=1, border_color=theme.PURPLE,
            text_color=theme.PURPLE, corner_radius=6,
            font=theme.font(11),
            command=lambda j=job: self._safe(self._view_booking_details, j),
        ).pack(side="left", padx=2, pady=2)

        # Cancel booking
        if not is_complete:
            ctk.CTkButton(
                actions_frame, text="❌ Cancel", width=75, height=28,
                fg_color="transparent", hover_color=theme.RED,
                border_width=1, border_color=theme.RED,
                text_color=theme.RED, corner_radius=6,
                font=theme.font(11),
                command=lambda j=job: self._safe(self._cancel_job, j),
            ).pack(side="left", padx=2, pady=2)

        # Remove from schedule (for stale/test entries)
        if job.get("source") == "schedule":
            ctk.CTkButton(
                actions_frame, text="\U0001f5d1 Remove", width=80, height=28,
                fg_color="transparent", hover_color=theme.RED,
                border_width=1, border_color="#7f1d1d",
                text_color="#fca5a5", corner_radius=6,
                font=theme.font(11),
                command=lambda j=job: self._safe(self._remove_schedule_entry, j),
            ).pack(side="left", padx=2, pady=2)

            ctk.CTkButton(
                actions_frame, text="📅 Reschedule", width=90, height=28,
                fg_color="transparent", hover_color=theme.BG_CARD,
                border_width=1, border_color=theme.AMBER,
                text_color=theme.AMBER, corner_radius=6,
                font=theme.font(11),
                command=lambda j=job: self._safe(self._reschedule_job, j),
            ).pack(side="left", padx=2, pady=2)

        # Call
        if phone:
            ctk.CTkButton(
                actions_frame, text="📞 Call", width=65, height=28,
                fg_color="transparent", hover_color=theme.BG_CARD,
                border_width=1, border_color=theme.BLUE,
                text_color=theme.BLUE, corner_radius=6,
                font=theme.font(11),
                command=lambda p=phone: self._safe(lambda: webbrowser.open(f"tel:{p}")),
            ).pack(side="left", padx=2, pady=2)

        return card

    # ------------------------------------------------------------------
    # Fund Allocation Rendering
    # ------------------------------------------------------------------
    def _render_fund_allocation(self, total_revenue: float):
        for w in self._fund_container.winfo_children():
            w.destroy()

        if total_revenue <= 0:
            ctk.CTkLabel(
                self._fund_container,
                text="Complete jobs to see fund allocation",
                font=theme.font(12), text_color=theme.TEXT_DIM,
            ).pack(pady=8)
            return

        # Fund bars
        for fund_name, rate in config.FUND_ALLOCATION.items():
            amount = total_revenue * rate
            row = ctk.CTkFrame(self._fund_container, fg_color="transparent")
            row.pack(fill="x", pady=2)
            row.grid_columnconfigure(1, weight=1)

            ctk.CTkLabel(
                row, text=fund_name, font=theme.font(12),
                text_color=theme.TEXT_LIGHT, width=150, anchor="w",
            ).grid(row=0, column=0, padx=(0, 8))

            bar_bg = ctk.CTkFrame(row, height=20, fg_color=theme.BG_INPUT, corner_radius=4)
            bar_bg.grid(row=0, column=1, sticky="ew", padx=4)
            bar_bg.grid_columnconfigure(0, weight=1)

            pct = rate * 100
            bar = ctk.CTkFrame(bar_bg, height=18, fg_color=theme.GREEN_PRIMARY, corner_radius=3)
            bar.place(relx=0, rely=0.05, relwidth=min(pct / 30, 1.0), relheight=0.9)

            ctk.CTkLabel(
                row, text=f"£{amount:,.2f} ({pct:.0f}%)",
                font=theme.font_bold(11), text_color=theme.GREEN_LIGHT,
                width=110, anchor="e",
            ).grid(row=0, column=2, padx=(8, 0))

        # Personal
        personal = total_revenue * config.PERSONAL_RATE
        row = ctk.CTkFrame(self._fund_container, fg_color="transparent")
        row.pack(fill="x", pady=(6, 2))
        row.grid_columnconfigure(1, weight=1)

        ctk.CTkLabel(
            row, text="💰 Personal", font=theme.font_bold(13),
            text_color=theme.GREEN_LIGHT, width=150, anchor="w",
        ).grid(row=0, column=0, padx=(0, 8))

        ctk.CTkLabel(
            row, text=f"£{personal:,.2f} ({config.PERSONAL_RATE * 100:.0f}%)",
            font=theme.font_bold(13), text_color=theme.GREEN_LIGHT,
            anchor="e",
        ).grid(row=0, column=2, padx=(8, 0))

    # ------------------------------------------------------------------
    # Day Summary Rendering
    # ------------------------------------------------------------------
    def _render_summary(self, jobs: list):
        for w in self._summary_container.winfo_children():
            w.destroy()

        total_jobs = len(jobs)
        completed = sum(1 for j in jobs if j.get("status") in ("Complete", "Completed"))
        total_rev = sum(float(j.get("price", 0) or 0) for j in jobs)
        completed_rev = sum(
            float(j.get("price", 0) or 0)
            for j in jobs if j.get("status") in ("Complete", "Completed")
        )
        total_materials = sum(
            self._materials_lower.get((j.get("service", "") or "").lower(), 0) for j in jobs
        )

        items = [
            ("Jobs", f"{completed}/{total_jobs} complete"),
            ("Revenue", f"£{total_rev:,.0f} target  •  £{completed_rev:,.0f} earned"),
            ("Materials", f"£{total_materials:,.2f} estimated"),
            ("Net Estimate", f"£{completed_rev - total_materials:,.2f}"),
        ]

        for label, value in items:
            row = ctk.CTkFrame(self._summary_container, fg_color="transparent")
            row.pack(fill="x", pady=2)
            row.grid_columnconfigure(1, weight=1)

            ctk.CTkLabel(
                row, text=label, font=theme.font(12),
                text_color=theme.TEXT_DIM, anchor="w",
            ).grid(row=0, column=0, sticky="w")

            ctk.CTkLabel(
                row, text=value, font=theme.font_bold(12),
                text_color=theme.TEXT_LIGHT, anchor="e",
            ).grid(row=0, column=1, sticky="e")

    # ------------------------------------------------------------------
    # Quick Actions
    # ------------------------------------------------------------------
    def _open_directions(self, postcode: str, address: str = ""):
        """Open Google Maps directions from base to postcode."""
        dest = f"{address}, {postcode}" if address else postcode
        url = f"https://www.google.com/maps/dir/{urllib.parse.quote(config.BASE_POSTCODE)}/{urllib.parse.quote(dest)}"
        webbrowser.open(url)

    def _send_directions_telegram(self, job: dict):
        """Send a Google Maps directions link to Telegram."""
        name = job.get("client_name", job.get("name", ""))
        postcode = job.get("postcode", "")
        address = job.get("address", "")
        dest = f"{address}, {postcode}" if address else postcode
        maps_url = f"https://www.google.com/maps/dir/{urllib.parse.quote(config.BASE_POSTCODE)}/{urllib.parse.quote(dest)}"
        msg = (
            f"🗺️ *Directions*\n"
            f"👤 {name}\n"
            f"📍 {dest}\n"
            f"[Open in Maps]({maps_url})"
        )
        threading.Thread(target=self.api.send_telegram, args=(msg,), daemon=True).start()
        self.db.log_telegram(msg)
        self.app.show_toast(f"Directions sent for {name}", "success")

    def _create_invoice_for_job(self, job: dict):
        """Create and open an invoice for this job."""
        from ..ui.components.invoice_modal import InvoiceModal

        name = job.get("client_name", job.get("name", ""))
        email = job.get("email", "")
        service = job.get("service", "")
        price = float(job.get("price", 0) or 0)
        jn = job.get("job_number", "")

        # Try to get email from client record if missing
        if not email:
            client_id = job.get("client_id", job.get("id"))
            if client_id:
                client = self.db.get_client(client_id)
                email = client.get("email", "") if client else ""

        # Check if invoice already exists for this job
        existing = None
        if jn:
            invoices = self.db.get_invoices()
            for inv in invoices:
                if inv.get("job_number") == jn:
                    existing = inv
                    break

        if existing:
            InvoiceModal(
                self, existing, self.db, self.sync,
                on_save=lambda: self.refresh(),
            )
            return

        # Create new invoice
        inv_data = {
            "invoice_number": f"INV-{jn}" if jn else "",
            "client_name": name,
            "client_email": email,
            "job_number": jn,
            "amount": price,
            "status": "Unpaid",
            "issue_date": date.today().isoformat(),
            "due_date": (date.today() + timedelta(days=14)).isoformat(),
            "paid_date": "",
            "notes": f"{service} — {self._current_date.strftime('%d %b %Y')}",
        }

        InvoiceModal(
            self, inv_data, self.db, self.sync,
            on_save=lambda: self.refresh(),
        )

    def _view_booking_details(self, job: dict):
        """Open full client record / booking form in a modal."""
        from ..ui.components.client_modal import ClientModal
        client_id = job.get("client_id", job.get("id"))
        name = job.get("client_name", job.get("name", ""))
        client = None
        if client_id:
            client = self.db.get_client(client_id)
        if not client and name:
            clients = self.db.get_clients(search=name)
            client = clients[0] if clients else None
        if client:
            ClientModal(
                self, client, self.db, self.sync,
                on_save=lambda: self.refresh(),
            )
        else:
            self.app.show_toast(f"No booking record found for {name}", "warning")

    def _remove_schedule_entry(self, job: dict):
        """Remove a schedule-sourced entry from Google Sheets and local DB."""
        name = job.get("client_name", job.get("name", ""))
        job_date = job.get("date", "")
        service = job.get("service", "")

        confirm = ctk.CTkToplevel(self)
        confirm.title("Remove Schedule Entry")
        confirm.geometry("420x200")
        confirm.attributes("-topmost", True)
        confirm.configure(fg_color=theme.BG_DARK)

        ctk.CTkLabel(
            confirm,
            text=f"Remove schedule entry for {name}?",
            font=theme.font(14, "bold"),
            text_color=theme.RED,
        ).pack(pady=(16, 4))
        ctk.CTkLabel(
            confirm,
            text=f"{service}  •  {job_date}\nThis deletes the row from Google Sheets.",
            font=theme.font(11),
            text_color=theme.TEXT_DIM,
        ).pack(pady=(0, 12))

        def do_remove():
            confirm.destroy()
            # Delete from Google Sheets via GAS
            def _bg():
                try:
                    resp = self.api.post("delete_schedule_entry", {
                        "clientName": name,
                        "date": job_date,
                    })
                    ok = resp.get("success") if resp else False
                except Exception:
                    ok = False

                # Always remove from local DB so it disappears immediately
                try:
                    self.db.conn.execute(
                        "DELETE FROM schedule WHERE client_name = ? AND date = ?",
                        (name, job_date),
                    )
                    self.db.conn.commit()
                except Exception:
                    pass

                status = "success" if ok else "warning"
                gas_msg = "removed from Sheets" if ok else "Sheets delete pending (redeploy GAS?)"
                self.after(0, lambda: self.app.show_toast(
                    f"Removed {name} — {gas_msg}", status
                ))
                self.after(0, self.refresh)

            threading.Thread(target=_bg, daemon=True).start()

        btn_row = ctk.CTkFrame(confirm, fg_color="transparent")
        btn_row.pack(pady=12)
        ctk.CTkButton(
            btn_row, text="🗑 Remove", width=120, height=36,
            fg_color=theme.RED, hover_color="#c0392b",
            corner_radius=8, font=theme.font(12, "bold"),
            command=do_remove,
        ).pack(side="left", padx=8)
        ctk.CTkButton(
            btn_row, text="Go Back", width=100, height=36,
            fg_color=theme.BG_CARD, hover_color=theme.BG_CARD_HOVER,
            corner_radius=8, font=theme.font(12),
            command=confirm.destroy,
        ).pack(side="left", padx=8)

    def _cancel_job(self, job: dict):
        """Cancel a scheduled job with confirmation."""
        name = job.get("client_name", job.get("name", ""))
        confirm = ctk.CTkToplevel(self)
        confirm.title("Cancel Job")
        confirm.geometry("400x220")
        confirm.attributes("-topmost", True)
        confirm.configure(fg_color=theme.BG_DARK)

        ctk.CTkLabel(confirm, text=f"Cancel job for {name}?",
                      font=theme.font(14, "bold"), text_color=theme.RED).pack(pady=(16, 8))

        reason_var = ctk.StringVar(value="")
        ctk.CTkLabel(confirm, text="Reason (optional):", font=theme.font(12)).pack(anchor="w", padx=16)
        reason_entry = ctk.CTkEntry(confirm, textvariable=reason_var, width=360,
                                     fg_color=theme.BG_CARD, border_color=theme.BORDER)
        reason_entry.pack(padx=16, pady=4)

        def do_cancel():
            client_id = job.get("client_id", job.get("id"))
            if client_id:
                client = self.db.get_client(client_id)
                if client:
                    client["status"] = "Cancelled"
                    client["notes"] = (client.get("notes", "") or "") + f"\nCancelled: {reason_var.get()}"
                    self.db.save_client(client)

            # Update local schedule entry too
            schedule_id = job.get("schedule_id")
            if schedule_id:
                try:
                    self.db.conn.execute(
                        "UPDATE schedule SET status = 'Cancelled' WHERE id = ?",
                        (schedule_id,),
                    )
                    self.db.conn.commit()
                except Exception:
                    pass

            self.sync.queue_write("cancel_booking", {
                "name": name,
                "reason": reason_var.get(),
                "date": job.get("date", ""),
            })

            msg = f"❌ *Job Cancelled*\n👤 {name}\n📅 {job.get('date', '')}\n📝 {reason_var.get() or 'No reason given'}"
            threading.Thread(target=self.api.send_telegram, args=(msg,), daemon=True).start()
            self.db.log_telegram(msg)

            confirm.destroy()
            self.app.show_toast(f"Cancelled job for {name}", "warning")
            self.refresh()

        btn_row = ctk.CTkFrame(confirm, fg_color="transparent")
        btn_row.pack(pady=16)
        ctk.CTkButton(btn_row, text="Cancel Job", width=120, height=36,
                       fg_color=theme.RED, hover_color="#c0392b",
                       corner_radius=8, font=theme.font(12, "bold"),
                       command=do_cancel).pack(side="left", padx=8)
        ctk.CTkButton(btn_row, text="Go Back", width=100, height=36,
                       fg_color=theme.BG_CARD, hover_color=theme.BG_CARD_HOVER,
                       corner_radius=8, font=theme.font(12),
                       command=confirm.destroy).pack(side="left", padx=8)

    def _reschedule_job(self, job: dict):
        """Reschedule a job to a new date/time with conflict checking."""
        name = job.get("client_name", job.get("name", ""))
        confirm = ctk.CTkToplevel(self)
        confirm.title("Reschedule Job")
        confirm.geometry("480x440")
        confirm.attributes("-topmost", True)
        confirm.configure(fg_color=theme.BG_DARK)

        ctk.CTkLabel(confirm, text=f"Reschedule {name}",
                      font=theme.font(14, "bold"), text_color=theme.AMBER).pack(pady=(16, 8))

        form = ctk.CTkFrame(confirm, fg_color="transparent")
        form.pack(padx=16, fill="x")

        ctk.CTkLabel(form, text="New Date (YYYY-MM-DD):", font=theme.font(12)).grid(row=0, column=0, sticky="w", pady=4)
        new_date = ctk.CTkEntry(form, width=200, fg_color=theme.BG_CARD, border_color=theme.BORDER)
        new_date.grid(row=0, column=1, padx=8, pady=4)
        new_date.insert(0, job.get("date", ""))

        ctk.CTkLabel(form, text="New Time:", font=theme.font(12)).grid(row=1, column=0, sticky="w", pady=4)
        new_time = ctk.CTkEntry(form, width=200, fg_color=theme.BG_CARD, border_color=theme.BORDER)
        new_time.grid(row=1, column=1, padx=8, pady=4)
        new_time.insert(0, job.get("time", ""))

        # Conflict warning area
        conflict_frame = ctk.CTkFrame(confirm, fg_color="transparent")
        conflict_frame.pack(fill="x", padx=16, pady=(4, 0))
        conflict_label = ctk.CTkLabel(
            conflict_frame, text="", font=theme.font(11),
            text_color=theme.AMBER, wraplength=420, anchor="w",
        )
        conflict_label.pack(fill="x")

        def check_date_conflicts(*_args):
            """Live-check conflicts as the user types a date."""
            nd = new_date.get().strip()
            if len(nd) != 10:
                conflict_label.configure(text="")
                return
            try:
                conflicts = self.db.check_schedule_conflicts(nd, exclude_client=name)
                if conflicts["has_conflict"]:
                    parts = []
                    if conflicts["is_overbooked"]:
                        parts.append(f"⚠️ Day has {conflicts['job_count']}/{conflicts['max_jobs']} jobs")
                    for c in conflicts["time_clashes"]:
                        parts.append(f"⚠️ Clashes with {c['job1']} at {c['job1_time']}")
                    conflict_label.configure(text="\n".join(parts), text_color=theme.AMBER)
                else:
                    conflict_label.configure(
                        text=f"✅ {conflicts['job_count']}/{conflicts['max_jobs']} jobs — space available",
                        text_color=theme.GREEN_LIGHT,
                    )
            except Exception:
                conflict_label.configure(text="")

        new_date.bind("<KeyRelease>", check_date_conflicts)

        # Best date suggestions
        ctk.CTkLabel(
            confirm, text="💡 Suggested dates:",
            font=theme.font(11, "bold"), text_color=theme.TEXT_DIM,
        ).pack(anchor="w", padx=16, pady=(8, 4))

        suggest_frame = ctk.CTkFrame(confirm, fg_color="transparent")
        suggest_frame.pack(fill="x", padx=16)

        suggestions = self.db.suggest_best_dates(days_ahead=14)
        for s in suggestions[:3]:
            slot_color = theme.GREEN_LIGHT if s["available_slots"] >= 3 else theme.AMBER
            btn = ctk.CTkButton(
                suggest_frame,
                text=f"{s['display']}  ({s['available_slots']} slots)",
                width=140, height=28,
                fg_color=theme.BG_CARD, hover_color=theme.BG_CARD_HOVER,
                border_width=1, border_color=slot_color,
                text_color=slot_color, corner_radius=6,
                font=theme.font(11),
                command=lambda d=s["date"]: (
                    new_date.delete(0, "end"), new_date.insert(0, d),
                    check_date_conflicts(),
                ),
            )
            btn.pack(side="left", padx=4, pady=2)

        def do_reschedule():
            nd = new_date.get().strip()
            nt = new_time.get().strip()
            if not nd:
                self.app.show_toast("Please enter a new date", "warning")
                return

            # Final conflict check with confirmation
            conflicts = self.db.check_schedule_conflicts(nd, exclude_client=name)
            if conflicts["is_overbooked"]:
                if not self._confirm_overbook(conflicts):
                    return

            client_id = job.get("client_id", job.get("id"))
            old_date = job.get("date", "")
            if client_id:
                client = self.db.get_client(client_id)
                if client:
                    client["date"] = nd
                    if nt:
                        client["time"] = nt
                    client["status"] = "Scheduled"
                    self.db.save_client(client)

            # Update local schedule entry too
            schedule_id = job.get("schedule_id")
            if schedule_id:
                try:
                    self.db.conn.execute(
                        "UPDATE schedule SET date = ?, time = COALESCE(NULLIF(?, ''), time), status = 'Scheduled' WHERE id = ?",
                        (nd, nt, schedule_id),
                    )
                    self.db.conn.commit()
                except Exception:
                    pass

            # Log reschedule
            try:
                self.db.execute(
                    """INSERT INTO reschedule_log
                       (client_name, client_email, service, old_date, old_time,
                        new_date, new_time, reason, notified, created_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)""",
                    (name, job.get("email", ""), job.get("service", ""),
                     old_date, job.get("time", ""), nd, nt, "Manual reschedule",
                     datetime.now().isoformat())
                )
                self.db.commit()
            except Exception:
                pass

            self.sync.queue_write("reschedule_booking", {
                "name": name,
                "new_date": nd,
                "new_time": nt,
                "old_date": old_date,
            })

            msg = f"📅 *Job Rescheduled*\n👤 {name}\n📅 {old_date} → {nd} {nt}"
            threading.Thread(target=self.api.send_telegram, args=(msg,), daemon=True).start()
            self.db.log_telegram(msg)

            confirm.destroy()
            self.app.show_toast(f"Rescheduled {name} to {nd}", "success")
            self.refresh()

        btn_row = ctk.CTkFrame(confirm, fg_color="transparent")
        btn_row.pack(pady=12)
        ctk.CTkButton(btn_row, text="Reschedule", width=120, height=36,
                       fg_color=theme.AMBER, hover_color="#d68910",
                       text_color=theme.BG_DARK, corner_radius=8,
                       font=theme.font(12, "bold"),
                       command=do_reschedule).pack(side="left", padx=8)
        ctk.CTkButton(btn_row, text="Cancel", width=100, height=36,
                       fg_color=theme.BG_CARD, hover_color=theme.BG_CARD_HOVER,
                       corner_radius=8, font=theme.font(12),
                       command=confirm.destroy).pack(side="left", padx=8)

    def _confirm_overbook(self, conflicts: dict) -> bool:
        """Show a blocking confirmation dialog for overbooking. Returns True if user confirms."""
        import tkinter.messagebox as mb
        return mb.askyesno(
            "Overbooked Day",
            f"This day already has {conflicts['job_count']}/{conflicts['max_jobs']} jobs.\n\n"
            "Are you sure you want to schedule anyway?",
            icon="warning",
        )

    # ------------------------------------------------------------------
    # Actions
    # ------------------------------------------------------------------
    def _complete_job(self, job: dict):
        """Mark a job as complete, send notifications, and trigger completion email + invoice."""
        # Use enriched client_id (from get_todays_jobs) or fall back to id
        client_id = job.get("client_id", job.get("id"))
        name = job.get("client_name", job.get("name", ""))

        # Update client record if we have a valid client ID
        client = None
        if client_id:
            client = self.db.get_client(client_id)
            if client:
                client["status"] = "Completed"
                self.db.save_client(client)

        # Also update the local schedule entry if this is schedule-sourced
        schedule_id = job.get("schedule_id")
        if schedule_id:
            try:
                self.db.conn.execute(
                    "UPDATE schedule SET status = 'Completed' WHERE id = ?",
                    (schedule_id,),
                )
                self.db.conn.commit()
            except Exception:
                pass

        # Queue sync to update the Jobs sheet row status
        sheets_row = job.get("sheets_row", "")
        self.sync.queue_write("update_status", {
            "rowIndex": sheets_row,
            "status": "Completed",
            "name": name,
        })

        # Telegram notification
        name = job.get("client_name", job.get("name", ""))
        service = job.get("service", "")
        price = float(job.get("price", 0) or 0)
        msg = (
            f"✅ *Job Complete*\n"
            f"👤 {name}\n"
            f"🔧 {service}\n"
            f"💰 £{price:,.0f}"
        )
        threading.Thread(target=self.api.send_telegram, args=(msg,), daemon=True).start()
        self.db.log_telegram(msg)

        # Auto-send completion email if client has email
        email = job.get("email", "")
        if not email and client_id:
            c = self.db.get_client(client_id) if not client else client
            email = c.get("email", "") if c else ""

        if email:
            def send_completion():
                try:
                    email_engine = getattr(self.app, '_email_engine', None)
                    if email_engine:
                        result = email_engine.send_completion_email_for_job(job)
                        if result.get("success"):
                            self.after(0, lambda: self._dispatch_status.configure(
                                text=f"📧 Completion email sent to {name}",
                                text_color=theme.GREEN_LIGHT,
                            ))
                    else:
                        self.api.post("send_completion_email", {
                            "name": name, "email": email, "service": service,
                            "jobNumber": job.get("job_number", ""),
                        })
                        self.db.log_email(
                            client_id=client_id or 0, client_name=name,
                            client_email=email, email_type="job_complete",
                            subject=f"Job Complete: {service}", status="sent",
                        )
                except Exception as e:
                    import logging
                    logging.getLogger("ggm.dispatch").warning(f"Completion email failed: {e}")

            threading.Thread(target=send_completion, daemon=True).start()

        # ── Auto-create and send the final invoice ──
        def auto_invoice():
            try:
                jn = job.get("job_number", "")
                # Check if an invoice already exists for this job
                existing_inv = None
                if jn:
                    for inv in self.db.get_invoices():
                        if inv.get("job_number") == jn:
                            existing_inv = inv
                            break

                if not existing_inv:
                    inv_data = {
                        "invoice_number": f"INV-{jn}" if jn else f"INV-{name[:3].upper()}-{date.today().strftime('%Y%m%d')}",
                        "client_name": name,
                        "client_email": email,
                        "job_number": jn,
                        "amount": price,
                        "status": "Unpaid",
                        "issue_date": date.today().isoformat(),
                        "due_date": (date.today() + timedelta(days=14)).isoformat(),
                        "paid_date": "",
                        "notes": f"{service} — {date.today().strftime('%d %b %Y')}",
                    }
                    self.db.save_invoice(inv_data)
                    self.sync.queue_write("update_invoice", {
                        "row": "",
                        "invoiceNumber": inv_data["invoice_number"],
                        "clientName": name,
                        "clientEmail": email,
                        "amount": price,
                        "status": "Unpaid",
                        "issueDate": inv_data["issue_date"],
                        "dueDate": inv_data["due_date"],
                        "paidDate": "",
                        "notes": inv_data["notes"],
                    })
                    existing_inv = inv_data

                # Send the invoice email via the email engine
                if email and existing_inv:
                    email_engine = getattr(self.app, '_email_engine', None)
                    if email_engine:
                        result = email_engine.send_invoice_email(existing_inv)
                        if result.get("success"):
                            self.after(0, lambda: self._dispatch_status.configure(
                                text=f"🧾 Invoice sent to {name}",
                                text_color=theme.GREEN_LIGHT,
                            ))
                            inv_num = existing_inv.get("invoice_number", "")
                            inv_msg = (
                                f"🧾 *Invoice Sent*\n"
                                f"👤 {name}\n"
                                f"📄 {inv_num}\n"
                                f"💰 £{price:,.2f}\n"
                                f"📧 Sent to {email}"
                            )
                            self.api.send_telegram(inv_msg)
                    else:
                        # Fallback: queue via GAS
                        self.sync.queue_write("send_invoice_email", {
                            "invoiceNumber": existing_inv.get("invoice_number", ""),
                            "clientName": name,
                            "clientEmail": email,
                            "amount": price,
                            "dueDate": existing_inv.get("due_date", ""),
                            "items": existing_inv.get("notes", ""),
                        })
            except Exception as e:
                import logging
                logging.getLogger("ggm.dispatch").warning(f"Auto-invoice failed: {e}")

        threading.Thread(target=auto_invoice, daemon=True).start()

        self.app.show_toast(f"Marked {name} as complete", "success")
        self.refresh()

    def _send_on_way(self, job: dict):
        name = job.get("client_name", job.get("name", ""))
        msg = f"🚐 *On My Way*\nHeading to {name} now!"
        threading.Thread(target=self.api.send_telegram, args=(msg,), daemon=True).start()
        self.db.log_telegram(msg)
        self.app.show_toast(f"Sent 'On My Way' for {name}", "success")

    def _send_quick_telegram(self, message: str, label: str):
        threading.Thread(target=self.api.send_telegram, args=(message,), daemon=True).start()
        self.db.log_telegram(message)
        self.app.show_toast(f"Sent: {label}", "success")

    def _send_day_report(self):
        """Send end-of-day summary to Telegram."""
        jobs = self._get_jobs_for_date()
        total = len(jobs)
        completed = sum(1 for j in jobs if j.get("status") in ("Complete", "Completed"))
        revenue = sum(
            float(j.get("price", 0) or 0)
            for j in jobs if j.get("status") in ("Complete", "Completed")
        )
        materials = sum(
            self._materials_lower.get((j.get("service", "") or "").lower(), 0)
            for j in jobs
        )

        msg = (
            f"📊 *End of Day Report — {self._current_date.strftime('%A %d %b')}*\n\n"
            f"📋 Jobs: {completed}/{total} complete\n"
            f"💰 Revenue: £{revenue:,.0f}\n"
            f"🧰 Materials: £{materials:,.2f}\n"
            f"📈 Net: £{revenue - materials:,.2f}\n\n"
        )

        for fund, rate in config.FUND_ALLOCATION.items():
            msg += f"  {fund}: £{revenue * rate:,.2f}\n"
        msg += f"  Personal: £{revenue * config.PERSONAL_RATE:,.2f}\n"

        threading.Thread(target=self.api.send_telegram, args=(msg,), daemon=True).start()
        self.db.log_telegram(msg)
        self.app.show_toast("Day report sent to Telegram", "success")

    def _send_reminders_tomorrow(self):
        """Send day-before reminders for tomorrow's jobs."""
        tomorrow = (self._current_date + timedelta(days=1)).isoformat()
        self._dispatch_status.configure(text="📧 Sending reminders...", text_color=theme.AMBER)

        def send():
            try:
                email_engine = getattr(self.app, '_email_engine', None)
                if email_engine:
                    results = email_engine.send_reminder_for_date(tomorrow)
                else:
                    # Fallback: call GAS directly
                    result = self.api.post("process_email_lifecycle", {
                        "types": ["day_before_reminder"],
                        "targetDate": tomorrow,
                    })
                    results = {
                        "sent": result.get("reminders", 0) if isinstance(result, dict) else 0,
                        "failed": 0, "skipped": 0,
                    }

                sent = results.get("sent", 0)
                failed = results.get("failed", 0)
                skipped = results.get("skipped", 0)

                status_msg = f"✅ {sent} reminders sent"
                if failed:
                    status_msg += f", {failed} failed"
                if skipped:
                    status_msg += f", {skipped} skipped"

                # Telegram notification
                tg_msg = (
                    f"📧 *Reminders Sent*\n\n"
                    f"For: {tomorrow}\n"
                    f"✅ Sent: {sent}\n"
                )
                if results.get("details"):
                    tg_msg += "\n" + "\n".join(results["details"][:10])
                self.api.send_telegram(tg_msg)

                self.after(0, lambda: (
                    self._dispatch_status.configure(text=status_msg, text_color=theme.GREEN_LIGHT),
                    self.app.show_toast(f"{sent} reminders sent for tomorrow", "success"),
                ))
            except Exception as e:
                self.after(0, lambda: (
                    self._dispatch_status.configure(text=f"❌ {e}", text_color=theme.RED),
                    self.app.show_toast(f"Reminder send failed: {e}", "error"),
                ))

        threading.Thread(target=send, daemon=True).start()

    def _check_weather(self):
        """Check weather forecast for the current date."""
        self._dispatch_status.configure(text="🌤️ Checking weather...", text_color=theme.AMBER)

        def fetch():
            try:
                result = self.api.get("get_weather")
                self.after(0, lambda: self._render_weather(result))
            except Exception as e:
                self.after(0, lambda: (
                    self._dispatch_status.configure(text=f"⚠️ Weather unavailable", text_color=theme.AMBER),
                ))

        threading.Thread(target=fetch, daemon=True).start()

    def _render_weather(self, data):
        """Render weather data into the weather section."""
        # Clear and show weather section
        for w in self._weather_section.winfo_children():
            w.destroy()

        self._weather_section.pack(fill="x", padx=16, pady=(8, 8))

        ctk.CTkLabel(
            self._weather_section, text="🌤️ Weather Forecast",
            font=theme.font_bold(15), text_color=theme.TEXT_LIGHT, anchor="w",
        ).pack(fill="x", padx=16, pady=(14, 8))

        if isinstance(data, dict):
            forecast = data.get("forecast", data.get("data", []))
            if isinstance(forecast, list):
                row_frame = ctk.CTkFrame(self._weather_section, fg_color="transparent")
                row_frame.pack(fill="x", padx=16, pady=(0, 14))

                for i, day in enumerate(forecast[:5]):
                    day_card = ctk.CTkFrame(row_frame, fg_color=theme.BG_INPUT, corner_radius=8)
                    day_card.pack(side="left", padx=4, pady=4, expand=True, fill="x")

                    day_name = day.get("day", day.get("date", f"Day {i+1}"))
                    temp = day.get("temp", day.get("temperature", ""))
                    desc = day.get("description", day.get("conditions", ""))
                    rain = day.get("rain", day.get("precipitation", ""))

                    ctk.CTkLabel(
                        day_card, text=str(day_name)[:3],
                        font=theme.font_bold(12), text_color=theme.TEXT_LIGHT,
                    ).pack(pady=(8, 2))

                    if temp:
                        ctk.CTkLabel(
                            day_card, text=f"{temp}°C" if isinstance(temp, (int, float)) else str(temp),
                            font=theme.font(11), text_color=theme.GREEN_LIGHT,
                        ).pack(pady=1)

                    if desc:
                        ctk.CTkLabel(
                            day_card, text=str(desc)[:15],
                            font=theme.font(10), text_color=theme.TEXT_DIM, wraplength=80,
                        ).pack(pady=(1, 8))
            else:
                ctk.CTkLabel(
                    self._weather_section, text=str(data)[:200],
                    font=theme.font(12), text_color=theme.TEXT_DIM,
                ).pack(fill="x", padx=16, pady=(0, 14))
        else:
            ctk.CTkLabel(
                self._weather_section, text="Weather data unavailable",
                font=theme.font(12), text_color=theme.TEXT_DIM,
            ).pack(fill="x", padx=16, pady=(0, 14))

        self._dispatch_status.configure(text="🌤️ Weather loaded", text_color=theme.GREEN_LIGHT)

    # ------------------------------------------------------------------
    # Data Loading
    # ------------------------------------------------------------------
    def _get_jobs_for_date(self) -> list:
        """Get jobs for the selected date.
        Uses the unified get_todays_jobs() method which merges schedule,
        one-off bookings, and recurring subscriptions with deduplication.
        """
        date_str = self._current_date.isoformat()
        return self.db.get_todays_jobs(target_date=date_str)

    # ------------------------------------------------------------------
    # Refresh
    # ------------------------------------------------------------------
    def refresh(self):
        try:
            jobs = self._get_jobs_for_date()

            # Preload photo counts for all today's jobs
            job_numbers = [j.get("job_number", "") for j in jobs if j.get("job_number")]
            self._photo_counts = self.db.get_photo_counts(job_numbers) if job_numbers else {}

            # Preload field tracking data for today's jobs
            try:
                self._field_tracking = {}
                tracking = self.db.get_job_tracking(
                    date=self._current_date.strftime("%Y-%m-%d"), limit=100
                )
                for t in tracking:
                    ref = t.get("job_ref", "")
                    if ref:
                        self._field_tracking[ref] = t
            except Exception:
                self._field_tracking = {}

            # KPIs
            total_rev = sum(float(j.get("price", 0) or 0) for j in jobs)
            completed_rev = sum(
                float(j.get("price", 0) or 0)
                for j in jobs if j.get("status") in ("Complete", "Completed")
            )
            materials = sum(
                self._materials_lower.get((j.get("service", "") or "").lower(), 0)
                for j in jobs
            )
            fuel_est = len(jobs) * config.AVG_TRAVEL_MILES * config.FUEL_RATE_PER_MILE

            self._kpi_cards["jobs"].set_value(str(len(jobs)))
            self._kpi_cards["revenue"].set_value(f"£{total_rev:,.0f}")
            self._kpi_cards["materials"].set_value(f"£{materials:,.2f}")
            self._kpi_cards["fuel"].set_value(f"£{fuel_est:,.2f}")
            self._kpi_cards["profit"].set_value(f"£{completed_rev - materials - fuel_est:,.2f}")

            # Conflict detection
            self._check_and_show_conflicts(jobs)

            # Jobs
            self._render_jobs(jobs)

            # Fund allocation (on completed revenue)
            self._render_fund_allocation(completed_rev)

            # Summary
            self._render_summary(jobs)

        except Exception as e:
            import traceback
            traceback.print_exc()

    def _check_and_show_conflicts(self, jobs: list):
        """Check for scheduling conflicts and show/hide the warning banner."""
        date_str = self._current_date.isoformat()
        conflicts = self.db.check_schedule_conflicts(date_str)

        if not conflicts["has_conflict"]:
            self._conflict_banner.pack_forget()
            return

        warnings = []
        if conflicts["is_overbooked"]:
            warnings.append(
                f"Day is overbooked: {conflicts['job_count']}/{conflicts['max_jobs']} jobs"
            )
        for clash in conflicts["time_clashes"]:
            warnings.append(
                f"Time clash: {clash['job1']} ({clash['job1_time']}) and "
                f"{clash['job2']} ({clash['job2_time']}) — {clash['gap_minutes']}min gap"
            )

        self._conflict_label.configure(text="  |  ".join(warnings))
        # Show the banner (insert after KPIs)
        try:
            self._conflict_banner.pack(fill="x", padx=16, pady=(0, 4),
                                        after=self._conflict_banner.master.winfo_children()[1])
        except Exception:
            self._conflict_banner.pack(fill="x", padx=16, pady=(0, 4))

    def _show_best_date_suggestions(self):
        """Show a popup with the best available dates for rescheduling."""
        suggestions = self.db.suggest_best_dates(days_ahead=14)

        popup = ctk.CTkToplevel(self)
        popup.title("Best Available Dates")
        popup.geometry("420x360")
        popup.attributes("-topmost", True)
        popup.configure(fg_color=theme.BG_DARK)
        popup.transient(self)

        ctk.CTkLabel(
            popup, text="📅 Suggested Reschedule Dates",
            font=theme.font_bold(15), text_color=theme.TEXT_LIGHT,
        ).pack(pady=(16, 12))

        ctk.CTkLabel(
            popup, text="Dates with the most availability:",
            font=theme.font(12), text_color=theme.TEXT_DIM,
        ).pack(pady=(0, 8))

        if not suggestions:
            ctk.CTkLabel(
                popup, text="No available dates found in the next 14 days.\nConsider extending your working week.",
                font=theme.font(12), text_color=theme.AMBER,
            ).pack(pady=20)
        else:
            for s in suggestions:
                row = ctk.CTkFrame(popup, fg_color=theme.BG_CARD, corner_radius=8)
                row.pack(fill="x", padx=16, pady=3)

                # Availability indicator
                slots = s["available_slots"]
                if slots >= 3:
                    color = theme.GREEN_LIGHT
                    icon = "🟢"
                elif slots >= 2:
                    color = theme.AMBER
                    icon = "🟡"
                else:
                    color = theme.RED
                    icon = "🔴"

                ctk.CTkLabel(
                    row, text=f"{icon} {s['display']}",
                    font=theme.font_bold(13), text_color=theme.TEXT_LIGHT,
                    anchor="w",
                ).pack(side="left", padx=(12, 8), pady=10)

                ctk.CTkLabel(
                    row,
                    text=f"{s['job_count']}/{s['max_jobs']} jobs · {slots} slots free",
                    font=theme.font(11), text_color=color,
                ).pack(side="left", padx=4, pady=10)

                ctk.CTkButton(
                    row, text="Go →", width=60, height=26,
                    fg_color=theme.GREEN_PRIMARY, hover_color=theme.GREEN_DARK,
                    corner_radius=6, font=theme.font(11, "bold"),
                    command=lambda d=s["date"], p=popup: self._jump_to_date(d, p),
                ).pack(side="right", padx=12, pady=8)

        ctk.CTkButton(
            popup, text="Close", width=100, height=32,
            fg_color=theme.BG_CARD, hover_color=theme.BG_CARD_HOVER,
            corner_radius=8, font=theme.font(12),
            command=popup.destroy,
        ).pack(pady=(12, 16))

    def _jump_to_date(self, date_str: str, popup=None):
        """Navigate the dispatch view to a specific date."""
        try:
            self._current_date = date.fromisoformat(date_str)
            self._update_date_display()
            self.refresh()
            if popup:
                popup.destroy()
        except Exception:
            pass

    def _open_job_photos(self, job: dict):
        """Open photo manager for this job."""
        from ..ui.components.photo_manager import PhotoManager
        PhotoManager(
            self, self.db,
            client_id=job.get("client_id", job.get("id")),
            client_name=job.get("client_name", job.get("name", "")),
            job_date=job.get("date", ""),
            job_number=job.get("job_number", ""),
        )

    def _open_job_client(self, job: dict):
        """Open the client detail modal for a dispatch job card."""
        from ..ui.components.client_modal import ClientModal
        client_id = job.get("client_id", job.get("id"))
        name = job.get("client_name", job.get("name", ""))
        if client_id:
            client = self.db.get_client(client_id)
            if client:
                ClientModal(
                    self, client, self.db, self.sync,
                    on_save=lambda: self.refresh(),
                )
                return
        # Fallback: search by name
        clients = self.db.get_clients(search=name)
        if clients:
            ClientModal(
                self, clients[0], self.db, self.sync,
                on_save=lambda: self.refresh(),
            )

    def on_table_update(self, table_name: str):
        if table_name in ("clients", "schedule", "job_photos", "job_tracking"):
            self.refresh()
