"""
Daily Dispatch Tab — The operational heart for Chris's working day.
Replaces today.html with full job management, fund allocation,
Telegram notifications, and end-of-day summary.
"""

import customtkinter as ctk
from datetime import date, datetime, timedelta
import threading

from ..ui import theme
from ..ui.components.kpi_card import KPICard
from ..ui.components.data_table import DataTable
from .. import config


class DispatchTab(ctk.CTkScrollableFrame):
    """Daily Dispatch — manage today's jobs, complete work, track earnings."""

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

    # ------------------------------------------------------------------
    # UI Construction
    # ------------------------------------------------------------------
    def _build_ui(self):
        self.grid_columnconfigure(0, weight=1)

        # ── Date Navigation ──
        self._build_date_nav()

        # ── KPI Row ──
        self._build_kpis()

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

        completed = sum(1 for j in jobs if j.get("status") == "Complete")
        self._jobs_count_label.configure(
            text=f"{completed}/{len(jobs)} complete"
        )

        for i, job in enumerate(jobs):
            card = self._create_job_card(job, i + 1)
            card.pack(fill="x", padx=4, pady=4)
            self._job_cards.append(card)

    def _create_job_card(self, job: dict, num: int) -> ctk.CTkFrame:
        is_complete = job.get("status") == "Complete"
        bg = theme.BG_CARD_HOVER if is_complete else theme.BG_INPUT

        card = ctk.CTkFrame(self._jobs_container, fg_color=bg, corner_radius=10)
        card.grid_columnconfigure(2, weight=1)

        # Number badge
        ctk.CTkLabel(
            card, text=str(num), width=32, height=32,
            fg_color=theme.GREEN_PRIMARY if not is_complete else theme.TEXT_DIM,
            text_color="white", corner_radius=16,
            font=theme.font_bold(13),
        ).grid(row=0, column=0, padx=(12, 8), pady=12, rowspan=2)

        # Client name
        name = job.get("client_name", job.get("name", "Unknown"))
        ctk.CTkLabel(
            card, text=name,
            font=theme.font_bold(14),
            text_color=theme.TEXT_LIGHT if not is_complete else theme.TEXT_DIM,
            anchor="w",
        ).grid(row=0, column=1, columnspan=2, padx=4, pady=(12, 0), sticky="w")

        # Service + time + price
        service = job.get("service", "")
        time_str = job.get("time", "TBC")
        price = float(job.get("price", 0) or 0)
        duration = config.SERVICE_DURATIONS.get(service, 1.0)
        materials = config.SERVICE_MATERIALS.get(service, 0)

        details = f"{time_str}  •  {service}  •  £{price:,.0f}  •  ~{duration}h"
        ctk.CTkLabel(
            card, text=details,
            font=theme.font(11), text_color=theme.TEXT_DIM,
            anchor="w",
        ).grid(row=1, column=1, columnspan=2, padx=4, pady=(0, 4), sticky="w")

        # Postcode + address
        postcode = job.get("postcode", "")
        address = job.get("address", "")
        loc = f"📍 {postcode}" + (f"  {address}" if address else "")
        if loc.strip() != "📍":
            ctk.CTkLabel(
                card, text=loc,
                font=theme.font(10), text_color=theme.TEXT_DIM,
                anchor="w",
            ).grid(row=2, column=1, columnspan=2, padx=4, pady=(0, 8), sticky="w")

        # Status badge
        status = job.get("status", "Pending")
        badge = theme.create_status_badge(card, status)
        badge.grid(row=0, column=3, padx=8, pady=(12, 4))

        # Action buttons
        btn_frame = ctk.CTkFrame(card, fg_color="transparent")
        btn_frame.grid(row=1, column=3, rowspan=2, padx=8, pady=(0, 8))

        if not is_complete:
            ctk.CTkButton(
                btn_frame, text="✓ Complete", width=90, height=28,
                fg_color=theme.GREEN_PRIMARY, hover_color=theme.GREEN_DARK,
                corner_radius=6, font=theme.font(11, "bold"),
                command=lambda j=job: self._complete_job(j),
            ).pack(pady=2)

            ctk.CTkButton(
                btn_frame, text="📱 On Way", width=90, height=28,
                fg_color="transparent", hover_color=theme.BG_CARD,
                border_width=1, border_color=theme.BLUE,
                text_color=theme.BLUE, corner_radius=6,
                font=theme.font(11),
                command=lambda j=job: self._send_on_way(j),
            ).pack(pady=2)

        # Photos button (always shown — works for both complete and pending)
        jn = job.get("job_number", "")
        photo_count = self._photo_counts.get(jn, 0) if hasattr(self, '_photo_counts') else 0
        photo_text = f"📸 {photo_count}" if photo_count else "📸"
        ctk.CTkButton(
            btn_frame, text=photo_text, width=90, height=28,
            fg_color="transparent", hover_color=theme.BG_CARD,
            border_width=1, border_color=theme.AMBER,
            text_color=theme.AMBER, corner_radius=6,
            font=theme.font(11),
            command=lambda j=job: self._open_job_photos(j),
        ).pack(pady=2)

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
        completed = sum(1 for j in jobs if j.get("status") == "Complete")
        total_rev = sum(float(j.get("price", 0) or 0) for j in jobs)
        completed_rev = sum(
            float(j.get("price", 0) or 0)
            for j in jobs if j.get("status") == "Complete"
        )
        total_materials = sum(
            config.SERVICE_MATERIALS.get(j.get("service", ""), 0) for j in jobs
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
    # Actions
    # ------------------------------------------------------------------
    def _complete_job(self, job: dict):
        """Mark a job as complete, send notifications, and trigger completion email."""
        client_id = job.get("id")
        if client_id:
            client = self.db.get_client(client_id)
            if client:
                client["status"] = "Complete"
                self.db.save_client(client)

        # Queue sync
        self.sync.queue_write("update_status", {
            "row": job.get("sheets_row", ""),
            "status": "Complete",
            "name": job.get("client_name", job.get("name", "")),
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
            client = self.db.get_client(client_id)
            email = client.get("email", "") if client else ""

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
        completed = sum(1 for j in jobs if j.get("status") == "Complete")
        revenue = sum(
            float(j.get("price", 0) or 0)
            for j in jobs if j.get("status") == "Complete"
        )
        materials = sum(
            config.SERVICE_MATERIALS.get(j.get("service", ""), 0)
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
        """Get jobs for the selected date."""
        date_str = self._current_date.isoformat()
        day_name = self._current_date.strftime("%A")

        # Get from clients table — jobs matching date or preferred_day
        all_clients = self.db.get_clients()
        jobs = []
        for c in all_clients:
            client_date = c.get("date", "")
            client_day = c.get("preferred_day", "")

            # Match exact date
            if client_date == date_str:
                jobs.append(c)
            # For subscriptions, match day of week
            elif (c.get("type") == "Subscription" and
                  c.get("status") not in ("Cancelled", "Complete") and
                  client_day == day_name):
                jobs.append(c)

        # Sort by time
        jobs.sort(key=lambda j: j.get("time", "99:99"))
        return jobs

    # ------------------------------------------------------------------
    # Refresh
    # ------------------------------------------------------------------
    def refresh(self):
        try:
            jobs = self._get_jobs_for_date()

            # Preload photo counts for all today's jobs
            job_numbers = [j.get("job_number", "") for j in jobs if j.get("job_number")]
            self._photo_counts = self.db.get_photo_counts(job_numbers) if job_numbers else {}

            # KPIs
            total_rev = sum(float(j.get("price", 0) or 0) for j in jobs)
            completed_rev = sum(
                float(j.get("price", 0) or 0)
                for j in jobs if j.get("status") == "Complete"
            )
            materials = sum(
                config.SERVICE_MATERIALS.get(j.get("service", ""), 0)
                for j in jobs
            )
            fuel_est = len(jobs) * config.AVG_TRAVEL_MILES * config.FUEL_RATE_PER_MILE

            self._kpi_cards["jobs"].set_value(str(len(jobs)))
            self._kpi_cards["revenue"].set_value(f"£{total_rev:,.0f}")
            self._kpi_cards["materials"].set_value(f"£{materials:,.2f}")
            self._kpi_cards["fuel"].set_value(f"£{fuel_est:,.2f}")
            self._kpi_cards["profit"].set_value(f"£{completed_rev - materials - fuel_est:,.2f}")

            # Jobs
            self._render_jobs(jobs)

            # Fund allocation (on completed revenue)
            self._render_fund_allocation(completed_rev)

            # Summary
            self._render_summary(jobs)

        except Exception as e:
            import traceback
            traceback.print_exc()

    def _open_job_photos(self, job: dict):
        """Open photo manager for this job."""
        from ..ui.components.photo_manager import PhotoManager
        PhotoManager(
            self, self.db,
            client_id=job.get("id"),
            client_name=job.get("client_name", job.get("name", "")),
            job_date=job.get("date", ""),
            job_number=job.get("job_number", ""),
        )

    def on_table_update(self, table_name: str):
        if table_name in ("clients", "schedule", "job_photos"):
            self.refresh()
