"""
Overview Tab — KPI dashboard, today's jobs, alerts, revenue chart.
The first screen the user sees on launch.
"""

import customtkinter as ctk
from datetime import datetime, date, timedelta

from ..ui import theme
from ..ui.components.kpi_card import KPICard
from ..ui.components.chart_panel import ChartPanel
from ..ui.components.client_modal import ClientModal


class OverviewTab(ctk.CTkScrollableFrame):
    """Main overview dashboard tab."""

    def __init__(self, parent, db, sync, api, app_window, **kwargs):
        super().__init__(parent, fg_color=theme.BG_DARK, **kwargs)

        self.db = db
        self.sync = sync
        self.api = api
        self.app = app_window

        self._kpi_cards = {}
        self._job_widgets = []

        self._build_ui()

    def _build_ui(self):
        """Build the overview layout."""
        self.grid_columnconfigure(0, weight=1)

        # ── KPI Row ──
        self._build_kpi_section()

        # ── Two columns: Today's Jobs | Alerts + Chart ──
        main_row = ctk.CTkFrame(self, fg_color="transparent")
        main_row.pack(fill="both", expand=True, padx=16, pady=(0, 16))
        main_row.grid_columnconfigure(0, weight=3)
        main_row.grid_columnconfigure(1, weight=2)
        main_row.grid_rowconfigure(0, weight=1)

        # Left: Today's Jobs
        self._build_todays_jobs(main_row)

        # Right: Alerts + Chart
        right_col = ctk.CTkFrame(main_row, fg_color="transparent")
        right_col.grid(row=0, column=1, sticky="nsew", padx=(8, 0))
        right_col.grid_rowconfigure(1, weight=1)
        right_col.grid_columnconfigure(0, weight=1)

        self._build_alerts(right_col)
        self._build_revenue_chart(right_col)

        # ── New Bookings Panel ──
        self._build_new_bookings()

        # ── Site Traffic Panel ──
        self._build_site_traffic()

        # ── Quick Actions ──
        self._build_quick_actions()

    # ------------------------------------------------------------------
    # KPI Section
    # ------------------------------------------------------------------
    def _build_kpi_section(self):
        """Build the row of KPI cards."""
        kpi_frame = ctk.CTkFrame(self, fg_color="transparent")
        kpi_frame.pack(fill="x", padx=16, pady=(16, 8))

        for i in range(7):
            kpi_frame.grid_columnconfigure(i, weight=1)

        kpis = [
            ("today",       "📅", "£0",  "Today"),
            ("week",        "📆", "£0",  "This Week"),
            ("month",       "📊", "£0",  "This Month"),
            ("ytd",         "📈", "£0",  "Year to Date"),
            ("subs",        "🔄", "0",   "Subscriptions"),
            ("outstanding", "🧾", "£0",  "Outstanding"),
            ("site_views",  "🌐", "0",   "Site Views (30d)"),
        ]

        for i, (key, icon, default, label) in enumerate(kpis):
            card = KPICard(kpi_frame, icon=icon, value=default, label=label)
            card.grid(row=0, column=i, sticky="nsew", padx=4, pady=4)
            self._kpi_cards[key] = card

    # ------------------------------------------------------------------
    # Today's Jobs
    # ------------------------------------------------------------------
    def _build_todays_jobs(self, parent):
        """Build the today's jobs panel."""
        jobs_card = ctk.CTkFrame(parent, fg_color=theme.BG_CARD, corner_radius=12)
        jobs_card.grid(row=0, column=0, sticky="nsew", padx=(0, 8))
        jobs_card.grid_columnconfigure(0, weight=1)
        jobs_card.grid_rowconfigure(1, weight=1)

        # Header
        header = ctk.CTkFrame(jobs_card, fg_color="transparent")
        header.grid(row=0, column=0, sticky="ew", padx=16, pady=(14, 8))
        header.grid_columnconfigure(0, weight=1)

        today_str = date.today().strftime("%A, %d %B")
        ctk.CTkLabel(
            header,
            text=f"📋 Today's Jobs — {today_str}",
            font=theme.font_bold(15),
            text_color=theme.TEXT_LIGHT,
            anchor="w",
        ).grid(row=0, column=0, sticky="w")

        self.job_count_label = ctk.CTkLabel(
            header,
            text="0 jobs",
            font=theme.font(12),
            text_color=theme.TEXT_DIM,
        )
        self.job_count_label.grid(row=0, column=1, sticky="e")

        # Jobs list (scrollable)
        self.jobs_container = ctk.CTkScrollableFrame(
            jobs_card,
            fg_color="transparent",
        )
        self.jobs_container.grid(row=1, column=0, sticky="nsew", padx=8, pady=(0, 8))
        self.jobs_container.grid_columnconfigure(0, weight=1)

        # Placeholder
        self.no_jobs_label = ctk.CTkLabel(
            self.jobs_container,
            text="No jobs scheduled for today",
            font=theme.font(13),
            text_color=theme.TEXT_DIM,
        )
        self.no_jobs_label.grid(row=0, column=0, pady=40)

    def _render_jobs(self, jobs: list[dict]):
        """Render today's job list."""
        # Clear existing
        for w in self._job_widgets:
            w.destroy()
        self._job_widgets.clear()

        if not jobs:
            self.no_jobs_label.grid(row=0, column=0, pady=40)
            self.job_count_label.configure(text="0 jobs")
            return

        self.no_jobs_label.grid_forget()
        self.job_count_label.configure(text=f"{len(jobs)} jobs")

        total_revenue = 0
        for i, job in enumerate(jobs):
            row = self._create_job_row(job, i)
            row.grid(row=i, column=0, sticky="ew", padx=4, pady=3)
            self._job_widgets.append(row)
            total_revenue += float(job.get("price", 0) or 0)

        # Revenue footer
        footer = ctk.CTkFrame(self.jobs_container, fg_color="transparent")
        footer.grid(row=len(jobs), column=0, sticky="ew", padx=4, pady=(8, 4))
        footer.grid_columnconfigure(0, weight=1)

        ctk.CTkLabel(
            footer,
            text=f"Potential revenue: £{total_revenue:,.2f}",
            font=theme.font_bold(12),
            text_color=theme.GREEN_LIGHT,
            anchor="e",
        ).grid(row=0, column=0, sticky="e")
        self._job_widgets.append(footer)

    def _create_job_row(self, job: dict, index: int) -> ctk.CTkFrame:
        """Create a single job row widget."""
        row = ctk.CTkFrame(
            self.jobs_container,
            fg_color=theme.BG_DARKER if index % 2 == 0 else theme.BG_CARD_HOVER,
            corner_radius=8,
            height=44,
        )
        row.grid_columnconfigure(2, weight=1)

        # Time
        time_str = job.get("time", "")
        ctk.CTkLabel(
            row, text=time_str or "—",
            font=theme.font_mono(12),
            text_color=theme.GREEN_LIGHT,
            width=55,
        ).grid(row=0, column=0, padx=(12, 8), pady=8, sticky="w")

        # Client name (clickable)
        name = job.get("client_name", job.get("name", ""))
        name_label = ctk.CTkLabel(
            row, text=name,
            font=theme.font(13), text_color=theme.TEXT_LIGHT,
            anchor="w", cursor="hand2",
        )
        name_label.grid(row=0, column=1, padx=4, pady=8, sticky="w")
        name_label.bind("<Button-1>", lambda e, j=job: self._open_job_client(j))
        name_label.bind("<Enter>", lambda e, lbl=name_label: lbl.configure(text_color=theme.GREEN_LIGHT))
        name_label.bind("<Leave>", lambda e, lbl=name_label: lbl.configure(text_color=theme.TEXT_LIGHT))

        # Service
        service = job.get("service", "")
        ctk.CTkLabel(
            row, text=service,
            font=theme.font(11), text_color=theme.TEXT_DIM,
            anchor="w",
        ).grid(row=0, column=2, padx=4, pady=8, sticky="w")

        # Price
        price = float(job.get("price", 0) or 0)
        if price:
            ctk.CTkLabel(
                row, text=f"£{price:,.0f}",
                font=theme.font_bold(12), text_color=theme.GREEN_LIGHT,
                width=60,
            ).grid(row=0, column=3, padx=4, pady=8)

        # Status badge
        status = job.get("status", "Scheduled")
        badge = theme.create_status_badge(row, status)
        badge.grid(row=0, column=4, padx=(4, 8), pady=8)

        # Mark complete button
        if status not in ("Complete", "Cancelled"):
            complete_btn = ctk.CTkButton(
                row, text="✓", width=32, height=28,
                fg_color=theme.GREEN_PRIMARY,
                hover_color=theme.GREEN_DARK,
                corner_radius=6,
                font=theme.font(14, "bold"),
                command=lambda j=job: self._mark_complete(j),
            )
            complete_btn.grid(row=0, column=5, padx=(4, 12), pady=8)

        return row

    def _mark_complete(self, job: dict):
        """Mark a job as complete."""
        # Update in SQLite
        if job.get("source") == "client" or "id" in job:
            client = self.db.get_client(job["id"])
            if client:
                client["status"] = "Complete"
                self.db.save_client(client)

        # Queue sync
        self.sync.queue_write("update_status", {
            "row": job.get("sheets_row", ""),
            "status": "Complete",
            "name": job.get("client_name", job.get("name", "")),
        })

        # Send Telegram
        name = job.get("client_name", job.get("name", ""))
        service = job.get("service", "")
        self.api.send_telegram(f"✅ *Job Complete*\n👤 {name}\n🔧 {service}")

        # Refresh
        self.app.show_toast(f"Marked {name} as complete", "success")
        self.refresh()

    def _open_job_client(self, job: dict):
        """Open the client detail modal for a job row."""
        from ..ui.components.client_modal import ClientModal
        client_id = job.get("id")
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

    # ------------------------------------------------------------------
    # New Bookings
    # ------------------------------------------------------------------
    def _build_new_bookings(self):
        """Build the new bookings panel showing recent bookings."""
        bookings_card = ctk.CTkFrame(self, fg_color=theme.BG_CARD, corner_radius=12)
        bookings_card.pack(fill="x", padx=16, pady=(0, 8))
        bookings_card.grid_columnconfigure(0, weight=1)

        # Header row
        header = ctk.CTkFrame(bookings_card, fg_color="transparent")
        header.pack(fill="x", padx=16, pady=(14, 8))
        header.grid_columnconfigure(0, weight=1)

        ctk.CTkLabel(
            header,
            text="🆕 New Bookings",
            font=theme.font_bold(15),
            text_color=theme.TEXT_LIGHT,
            anchor="w",
        ).grid(row=0, column=0, sticky="w")

        self._bookings_count_label = ctk.CTkLabel(
            header,
            text="Last 7 days",
            font=theme.font(11),
            text_color=theme.TEXT_DIM,
        )
        self._bookings_count_label.grid(row=0, column=1, sticky="e")

        # Bookings container
        self._bookings_container = ctk.CTkFrame(bookings_card, fg_color="transparent")
        self._bookings_container.pack(fill="x", padx=8, pady=(0, 12))
        self._bookings_container.grid_columnconfigure(0, weight=1)

        # Column headers
        col_header = ctk.CTkFrame(self._bookings_container, fg_color="transparent")
        col_header.pack(fill="x", padx=4, pady=(0, 4))
        col_header.grid_columnconfigure(2, weight=1)

        for i, (text, w) in enumerate([
            ("Date", 85), ("Client", 0), ("Service", 140), ("Price", 65), ("Status", 80),
        ]):
            ctk.CTkLabel(
                col_header, text=text,
                font=theme.font(10, "bold"),
                text_color=theme.TEXT_DIM,
                width=w if w else None,
                anchor="w",
            ).grid(row=0, column=i, sticky="w", padx=4)

        # Placeholder
        self._no_bookings_label = ctk.CTkLabel(
            self._bookings_container,
            text="No new bookings this week",
            font=theme.font(12),
            text_color=theme.TEXT_DIM,
        )
        self._no_bookings_label.pack(pady=16)

    def _render_new_bookings(self):
        """Render the new bookings list from the database."""
        bookings = self.db.get_recent_bookings(days=7, limit=10)

        # Clear previous rows (keep column header)
        children = self._bookings_container.winfo_children()
        for w in children:
            # Skip the column header frame and keep it
            if w == children[0] and isinstance(w, ctk.CTkFrame):
                continue
            w.destroy()

        if not bookings:
            self._no_bookings_label = ctk.CTkLabel(
                self._bookings_container,
                text="No new bookings this week",
                font=theme.font(12),
                text_color=theme.TEXT_DIM,
            )
            self._no_bookings_label.pack(pady=16)
            self._bookings_count_label.configure(text="0 bookings · Last 7 days")
            return

        self._bookings_count_label.configure(
            text=f"{len(bookings)} booking{'s' if len(bookings) != 1 else ''} · Last 7 days"
        )

        for i, booking in enumerate(bookings):
            row = ctk.CTkFrame(
                self._bookings_container,
                fg_color=theme.BG_DARKER if i % 2 == 0 else theme.BG_CARD_HOVER,
                corner_radius=8,
                height=40,
            )
            row.pack(fill="x", padx=4, pady=2)
            row.grid_columnconfigure(2, weight=1)

            # Date
            created = booking.get("created_at", "")
            try:
                dt = datetime.fromisoformat(created)
                date_str = dt.strftime("%d %b")
                time_str = dt.strftime("%H:%M")
                date_display = f"{date_str} {time_str}"
            except Exception:
                date_display = created[:10] if created else "—"

            ctk.CTkLabel(
                row, text=date_display,
                font=theme.font_mono(11),
                text_color=theme.GREEN_LIGHT,
                width=85, anchor="w",
            ).grid(row=0, column=0, padx=(10, 4), pady=6, sticky="w")

            # Client name (clickable)
            name = booking.get("name", booking.get("client_name", "Unknown"))
            name_label = ctk.CTkLabel(
                row, text=name,
                font=theme.font(12),
                text_color=theme.TEXT_LIGHT,
                anchor="w", cursor="hand2",
            )
            name_label.grid(row=0, column=1, padx=4, pady=6, sticky="w")
            name_label.bind("<Button-1>", lambda e, b=booking: self._open_booking_client(b))
            name_label.bind("<Enter>", lambda e, lbl=name_label: lbl.configure(text_color=theme.GREEN_LIGHT))
            name_label.bind("<Leave>", lambda e, lbl=name_label: lbl.configure(text_color=theme.TEXT_LIGHT))

            # Service
            service = booking.get("service", "")
            ctk.CTkLabel(
                row, text=service,
                font=theme.font(11),
                text_color=theme.TEXT_DIM,
                width=140, anchor="w",
            ).grid(row=0, column=2, padx=4, pady=6, sticky="w")

            # Price
            price = float(booking.get("price", 0) or 0)
            ctk.CTkLabel(
                row, text=f"£{price:,.0f}" if price else "—",
                font=theme.font_bold(11),
                text_color=theme.GREEN_LIGHT if price else theme.TEXT_DIM,
                width=65, anchor="e",
            ).grid(row=0, column=3, padx=4, pady=6)

            # Status badge
            status = booking.get("status", "New")
            badge = theme.create_status_badge(row, status)
            badge.grid(row=0, column=4, padx=(4, 10), pady=6)

            # Highlight new bookings (created today) with a green left accent
            try:
                if dt.date() == date.today():
                    accent = ctk.CTkFrame(row, fg_color=theme.GREEN_LIGHT, width=3)
                    accent.grid(row=0, column=0, sticky="nsw", padx=0, pady=3)
                    accent.lift()
            except Exception:
                pass

    def _open_booking_client(self, booking: dict):
        """Open client modal for a booking entry."""
        client_id = booking.get("id")
        if client_id:
            client = self.db.get_client(client_id)
            if client:
                ClientModal(
                    self, client, self.db, self.sync,
                    on_save=lambda: self.refresh(),
                )
                return
        # Fallback: search by name
        name = booking.get("name", booking.get("client_name", ""))
        if name:
            clients = self.db.get_clients(search=name)
            if clients:
                ClientModal(
                    self, clients[0], self.db, self.sync,
                    on_save=lambda: self.refresh(),
                )

    # ------------------------------------------------------------------
    # Alerts
    # ------------------------------------------------------------------
    def _build_alerts(self, parent):
        """Build the alerts panel."""
        alerts_card = ctk.CTkFrame(parent, fg_color=theme.BG_CARD, corner_radius=12)
        alerts_card.grid(row=0, column=0, sticky="new", padx=0, pady=(0, 8))
        alerts_card.grid_columnconfigure(0, weight=1)

        ctk.CTkLabel(
            alerts_card,
            text="⚡ Alerts",
            font=theme.font_bold(15),
            text_color=theme.TEXT_LIGHT,
            anchor="w",
        ).pack(fill="x", padx=16, pady=(14, 8))

        self.alerts_container = ctk.CTkFrame(alerts_card, fg_color="transparent")
        self.alerts_container.pack(fill="x", padx=12, pady=(0, 12))

        self._no_alerts = ctk.CTkLabel(
            self.alerts_container,
            text="All clear — no alerts",
            font=theme.font(12),
            text_color=theme.TEXT_DIM,
        )
        self._no_alerts.pack(pady=12)

    def _render_alerts(self, stats: dict):
        """Render alert items based on current stats."""
        # Clear
        for w in self.alerts_container.winfo_children():
            w.destroy()

        alerts = []

        outstanding = stats.get("outstanding_invoices", 0)
        if outstanding > 0:
            amount = stats.get("outstanding_amount", 0)
            alerts.append((
                f"🧾 {outstanding} unpaid invoice{'s' if outstanding > 1 else ''} (£{amount:,.0f})",
                theme.RED,
            ))

        pending = stats.get("pending_enquiries", 0)
        if pending > 0:
            alerts.append((
                f"📩 {pending} pending enquir{'ies' if pending > 1 else 'y'}",
                theme.AMBER,
            ))

        if not alerts:
            ctk.CTkLabel(
                self.alerts_container,
                text="✅ All clear — no alerts",
                font=theme.font(12),
                text_color=theme.GREEN_LIGHT,
            ).pack(pady=12)
        else:
            for text, color in alerts:
                ctk.CTkLabel(
                    self.alerts_container,
                    text=text,
                    font=theme.font(12),
                    text_color=color,
                    anchor="w",
                ).pack(fill="x", padx=8, pady=3)

    # ------------------------------------------------------------------
    # Revenue Chart
    # ------------------------------------------------------------------
    def _build_revenue_chart(self, parent):
        """Build the revenue chart panel."""
        self.chart = ChartPanel(parent, width=400, height=250)
        self.chart.grid(row=1, column=0, sticky="nsew", padx=0, pady=(0, 0))

    def _render_chart(self):
        """Render the revenue bar chart."""
        daily = self.db.get_daily_revenue(14)

        if daily:
            labels = []
            values = []
            for d in daily:
                try:
                    dt = datetime.strptime(d["date"], "%Y-%m-%d")
                    labels.append(dt.strftime("%d/%m"))
                except Exception:
                    labels.append(d["date"][:5])
                values.append(d["revenue"])

            self.chart.bar_chart(
                labels, values,
                title="Revenue — Last 14 Days",
                ylabel="£",
            )
        else:
            self.chart.bar_chart(
                ["No data"], [0],
                title="Revenue — Last 14 Days",
            )

    # ------------------------------------------------------------------
    # Site Traffic Panel
    # ------------------------------------------------------------------
    def _build_site_traffic(self):
        """Build the site traffic analytics panel."""
        traffic_card = ctk.CTkFrame(self, fg_color=theme.BG_CARD, corner_radius=12)
        traffic_card.pack(fill="x", padx=16, pady=(0, 8))
        traffic_card.grid_columnconfigure(0, weight=1)
        traffic_card.grid_columnconfigure(1, weight=1)

        # Header
        ctk.CTkLabel(
            traffic_card,
            text="🌐 Website Traffic — Last 30 Days",
            font=theme.font_bold(15),
            text_color=theme.TEXT_LIGHT,
            anchor="w",
        ).grid(row=0, column=0, columnspan=2, sticky="w", padx=16, pady=(14, 8))

        # Left: Top Pages
        pages_frame = ctk.CTkFrame(traffic_card, fg_color=theme.BG_DARKER, corner_radius=8)
        pages_frame.grid(row=1, column=0, sticky="nsew", padx=(16, 8), pady=(0, 14))
        pages_frame.grid_columnconfigure(0, weight=1)

        ctk.CTkLabel(
            pages_frame, text="📄 Top Pages",
            font=theme.font_bold(12), text_color=theme.TEXT_LIGHT, anchor="w",
        ).pack(fill="x", padx=12, pady=(10, 4))

        self._top_pages_container = ctk.CTkFrame(pages_frame, fg_color="transparent")
        self._top_pages_container.pack(fill="x", padx=8, pady=(0, 10))

        self._no_traffic_label = ctk.CTkLabel(
            self._top_pages_container,
            text="No traffic data yet — deploy Code.gs to start tracking",
            font=theme.font(11), text_color=theme.TEXT_DIM,
        )
        self._no_traffic_label.pack(pady=8)

        # Right: Referrers + Stats
        stats_frame = ctk.CTkFrame(traffic_card, fg_color=theme.BG_DARKER, corner_radius=8)
        stats_frame.grid(row=1, column=1, sticky="nsew", padx=(8, 16), pady=(0, 14))
        stats_frame.grid_columnconfigure(0, weight=1)

        ctk.CTkLabel(
            stats_frame, text="🔗 Top Referrers",
            font=theme.font_bold(12), text_color=theme.TEXT_LIGHT, anchor="w",
        ).pack(fill="x", padx=12, pady=(10, 4))

        self._referrers_container = ctk.CTkFrame(stats_frame, fg_color="transparent")
        self._referrers_container.pack(fill="x", padx=8, pady=(0, 4))

        # Traffic stats row
        self._traffic_stats = ctk.CTkLabel(
            stats_frame, text="",
            font=theme.font(11), text_color=theme.TEXT_DIM, anchor="w",
        )
        self._traffic_stats.pack(fill="x", padx=12, pady=(4, 10))

    def _render_site_traffic(self, analytics: dict):
        """Render the site traffic data."""
        total = analytics.get("total_views", analytics.get("totalViews", 0))
        avg = analytics.get("avg_per_day", analytics.get("avgPerDay", 0))
        pages_count = analytics.get("unique_pages", analytics.get("uniquePages", 0))

        # Update KPI
        self._kpi_cards["site_views"].set_value(f"{total:,}")

        # Clear containers
        for w in self._top_pages_container.winfo_children():
            w.destroy()
        for w in self._referrers_container.winfo_children():
            w.destroy()

        if total == 0:
            ctk.CTkLabel(
                self._top_pages_container,
                text="No traffic data yet",
                font=theme.font(11), text_color=theme.TEXT_DIM,
            ).pack(pady=8)
            self._traffic_stats.configure(text="")
            return

        # Top pages list
        top_pages = analytics.get("topPages", analytics.get("top_pages", []))
        if isinstance(top_pages, str):
            import json as _json
            try:
                top_pages = _json.loads(top_pages)
            except Exception:
                top_pages = []

        for i, p in enumerate(top_pages[:8]):
            page_name = p.get("page", "/")
            # Friendly page names
            friendly = {
                "/": "Home", "/index": "Home", "/about": "About",
                "/services": "Services", "/booking": "Book Online",
                "/contact": "Contact", "/blog": "Blog",
                "/testimonials": "Reviews", "/shop": "Shop",
                "/careers": "Careers", "/subscribe": "Subscribe",
                "/areas": "Service Areas",
            }
            display = friendly.get(page_name, page_name.lstrip("/").replace("-", " ").title())
            views = p.get("views", 0)

            row = ctk.CTkFrame(self._top_pages_container, fg_color="transparent", height=22)
            row.pack(fill="x", pady=1)
            row.grid_columnconfigure(0, weight=1)

            ctk.CTkLabel(
                row, text=display,
                font=theme.font(11), text_color=theme.TEXT_LIGHT, anchor="w",
            ).grid(row=0, column=0, sticky="w")
            ctk.CTkLabel(
                row, text=f"{views:,}",
                font=theme.font_mono(11), text_color=theme.GREEN_LIGHT, anchor="e",
            ).grid(row=0, column=1, sticky="e", padx=(8, 0))

        # Top referrers
        top_refs = analytics.get("topReferrers", analytics.get("top_referrers", []))
        if isinstance(top_refs, str):
            import json as _json
            try:
                top_refs = _json.loads(top_refs)
            except Exception:
                top_refs = []

        if not top_refs:
            ctk.CTkLabel(
                self._referrers_container,
                text="All direct traffic",
                font=theme.font(11), text_color=theme.TEXT_DIM,
            ).pack(pady=4)
        else:
            for ref in top_refs[:6]:
                ref_name = ref.get("referrer", "?")
                views = ref.get("views", 0)

                row = ctk.CTkFrame(self._referrers_container, fg_color="transparent", height=22)
                row.pack(fill="x", pady=1)
                row.grid_columnconfigure(0, weight=1)

                ctk.CTkLabel(
                    row, text=ref_name,
                    font=theme.font(11), text_color=theme.TEXT_LIGHT, anchor="w",
                ).grid(row=0, column=0, sticky="w")
                ctk.CTkLabel(
                    row, text=f"{views:,}",
                    font=theme.font_mono(11), text_color=theme.GREEN_LIGHT, anchor="e",
                ).grid(row=0, column=1, sticky="e", padx=(8, 0))

        # Stats summary
        self._traffic_stats.configure(
            text=f"📊 {total:,} views  •  {avg}/day avg  •  {pages_count} pages"
        )

    # ------------------------------------------------------------------
    # Quick Actions
    # ------------------------------------------------------------------
    def _build_quick_actions(self):
        """Build the quick actions bar."""
        actions_frame = ctk.CTkFrame(self, fg_color=theme.BG_CARD, corner_radius=12)
        actions_frame.pack(fill="x", padx=16, pady=(0, 16))

        ctk.CTkLabel(
            actions_frame,
            text="⚡ Quick Actions",
            font=theme.font_bold(13),
            text_color=theme.TEXT_LIGHT,
            anchor="w",
        ).pack(fill="x", padx=16, pady=(12, 8))

        btn_row = ctk.CTkFrame(actions_frame, fg_color="transparent")
        btn_row.pack(fill="x", padx=12, pady=(0, 12))

        actions = [
            ("📋 Morning Briefing", self._send_briefing),
            ("📅 Generate Schedule", self._generate_schedule),
            ("↻ Force Sync", self._force_sync),
        ]

        for text, cmd in actions:
            theme.create_outline_button(
                btn_row, text, command=cmd, width=160,
            ).pack(side="left", padx=4)

    def _send_briefing(self):
        """Send morning briefing to Telegram."""
        try:
            jobs = self.db.get_todays_jobs()
            stats = self.db.get_revenue_stats()

            msg = f"☀️ *Morning Briefing — {date.today().strftime('%A %d %b')}*\n\n"
            msg += f"📊 *Today's Revenue Target:* £{sum(float(j.get('price', 0) or 0) for j in jobs):,.0f}\n"
            msg += f"📅 *Jobs Scheduled:* {len(jobs)}\n"
            msg += f"📈 *MTD Revenue:* £{stats['month']:,.0f}\n"
            msg += f"📈 *YTD Revenue:* £{stats['ytd']:,.0f}\n\n"

            if jobs:
                msg += "*Today's Schedule:*\n"
                for j in jobs:
                    t = j.get("time", "TBC")
                    n = j.get("client_name", j.get("name", "?"))
                    s = j.get("service", "")
                    msg += f"  {t} — {n} ({s})\n"

            self.api.send_telegram(msg)
            self.app.show_toast("Briefing sent to Telegram", "success")
        except Exception as e:
            self.app.show_toast(f"Failed: {e}", "error")

    def _generate_schedule(self):
        """Trigger schedule generation via GAS."""
        try:
            self.api.post("generate_schedule", {})
            self.app.show_toast("Schedule generation triggered", "success")
        except Exception as e:
            self.app.show_toast(f"Failed: {e}", "error")

    def _force_sync(self):
        self.sync.force_sync()
        self.app.show_toast("Sync started", "info")

    # ------------------------------------------------------------------
    # Refresh
    # ------------------------------------------------------------------
    def refresh(self):
        """Refresh all overview data from SQLite."""
        try:
            # KPIs
            stats = self.db.get_revenue_stats()
            self._kpi_cards["today"].set_value(f"£{stats['today']:,.0f}")
            self._kpi_cards["week"].set_value(f"£{stats['week']:,.0f}")
            self._kpi_cards["month"].set_value(f"£{stats['month']:,.0f}")
            self._kpi_cards["ytd"].set_value(f"£{stats['ytd']:,.0f}")
            self._kpi_cards["subs"].set_value(str(stats["active_subs"]))
            self._kpi_cards["outstanding"].set_value(f"£{stats['outstanding_amount']:,.0f}")

            # Color outstanding in red if > 0
            if stats["outstanding_amount"] > 0:
                self._kpi_cards["outstanding"].set_color(theme.RED)
            else:
                self._kpi_cards["outstanding"].set_color(theme.GREEN_LIGHT)

            # Today's jobs
            jobs = self.db.get_todays_jobs()
            self._render_jobs(jobs)

            # Alerts
            self._render_alerts(stats)

            # New bookings
            self._render_new_bookings()

            # Chart
            self._render_chart()

            # Site traffic
            try:
                analytics = self.db.get_analytics_summary()
                self._render_site_traffic(analytics)
            except Exception:
                pass  # Analytics table may not exist yet

        except Exception as e:
            import traceback
            traceback.print_exc()

    def on_table_update(self, table_name: str):
        """Called when a specific table is updated by sync."""
        if table_name in ("clients", "schedule", "invoices", "site_analytics"):
            self.refresh()
