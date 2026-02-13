"""
Day Planner Component — Visualises an optimised route for a day's jobs.
Shows travel time between stops, total drive time/miles, and a Google Maps link.
"""

import customtkinter as ctk
import webbrowser
from datetime import date

from .. import theme
from ...distance import (
    plan_day_route, format_drive_time, distance_from_base,
)
from ... import config


class DayPlanner(ctk.CTkFrame):
    """
    A visual day planner that shows jobs in optimal route order
    with travel-time gaps and KPI summary cards.
    """

    def __init__(self, parent, db, on_job_click=None, **kwargs):
        super().__init__(parent, fg_color="transparent", **kwargs)
        self.db = db
        self.on_job_click = on_job_click
        self._plan = None
        self._target_date = date.today().isoformat()

        self.grid_columnconfigure(0, weight=1)
        self.grid_rowconfigure(1, weight=1)

        self._build_header()
        self._build_body()
        self.plan_date(self._target_date)

    # ─────────────────────────────────────────────────────────
    # Header
    # ─────────────────────────────────────────────────────────
    def _build_header(self):
        hdr = ctk.CTkFrame(self, fg_color=theme.BG_CARD, corner_radius=10, height=50)
        hdr.grid(row=0, column=0, sticky="ew", padx=0, pady=(0, 8))
        hdr.grid_columnconfigure(2, weight=1)

        ctk.CTkLabel(
            hdr, text="🗺️ Route Planner",
            font=theme.font_bold(16), text_color=theme.TEXT_LIGHT,
        ).grid(row=0, column=0, padx=12, pady=10, sticky="w")

        # Date selector
        self.date_entry = ctk.CTkEntry(
            hdr, width=120, font=theme.font(12),
            fg_color=theme.BG_INPUT, border_color=theme.GREEN_ACCENT,
            corner_radius=6, height=32,
        )
        self.date_entry.insert(0, self._target_date)
        self.date_entry.grid(row=0, column=1, padx=4, pady=10)

        theme.create_accent_button(
            hdr, "Plan Route", width=100,
            command=self._on_plan_click,
        ).grid(row=0, column=2, padx=4, pady=10, sticky="w")

        # Right-side buttons
        btn_right = ctk.CTkFrame(hdr, fg_color="transparent")
        btn_right.grid(row=0, column=3, padx=8, pady=10, sticky="e")

        self.maps_btn = theme.create_outline_button(
            btn_right, "🗺️ Open in Maps", width=140,
            command=self._open_maps,
        )
        self.maps_btn.pack(side="right", padx=4)

    # ─────────────────────────────────────────────────────────
    # Body
    # ─────────────────────────────────────────────────────────
    def _build_body(self):
        self.body = ctk.CTkScrollableFrame(
            self, fg_color="transparent",
        )
        self.body.grid(row=1, column=0, sticky="nsew", padx=0, pady=0)
        self.body.grid_columnconfigure(0, weight=1)

    def _on_plan_click(self):
        val = self.date_entry.get().strip()
        if val:
            self._target_date = val
        self.plan_date(self._target_date)

    def plan_date(self, target_date: str):
        """Load jobs for a date and plan the optimal route."""
        self._target_date = target_date
        jobs = self.db.get_todays_jobs(target_date)
        self._plan = plan_day_route(jobs)
        self._render()

    def _render(self):
        """Render the planned route."""
        # Clear body
        for w in self.body.winfo_children():
            w.destroy()

        plan = self._plan
        if not plan or not plan["route"]:
            self._render_empty()
            return

        # ── KPI cards row ──
        kpi_row = ctk.CTkFrame(self.body, fg_color="transparent")
        kpi_row.grid(row=0, column=0, sticky="ew", padx=4, pady=(4, 8))
        for i in range(5):
            kpi_row.grid_columnconfigure(i, weight=1)

        kpis = [
            ("🚐", f"{plan['total_drive_miles']} mi", "Driving"),
            ("⏱️", format_drive_time(plan["total_drive_minutes"]), "Travel Time"),
            ("🔧", f"{plan['total_work_hours']}h", "Work Time"),
            ("📅", f"{plan['total_day_hours']}h", "Total Day"),
            ("📍", f"{len(plan['route'])} jobs", "Stops"),
        ]

        for i, (icon, value, label) in enumerate(kpis):
            card = ctk.CTkFrame(kpi_row, fg_color=theme.BG_CARD, corner_radius=10, height=70)
            card.grid(row=0, column=i, sticky="ew", padx=4, pady=2)
            card.grid_propagate(False)
            card.grid_columnconfigure(0, weight=1)

            ctk.CTkLabel(card, text=icon, font=theme.font(18)).grid(row=0, column=0, pady=(8, 0))
            ctk.CTkLabel(
                card, text=value,
                font=theme.font_bold(14), text_color=theme.GREEN_LIGHT,
            ).grid(row=1, column=0, pady=0)
            ctk.CTkLabel(
                card, text=label,
                font=theme.font(10), text_color=theme.TEXT_DIM,
            ).grid(row=2, column=0, pady=(0, 6))

        # ── Warnings ──
        if plan["warnings"]:
            warn_frame = ctk.CTkFrame(self.body, fg_color="#3d2020", corner_radius=8)
            warn_frame.grid(row=1, column=0, sticky="ew", padx=8, pady=(0, 8))
            for w in plan["warnings"]:
                ctk.CTkLabel(
                    warn_frame, text=f"⚠️ {w}",
                    font=theme.font(12), text_color="#ff9999",
                    anchor="w",
                ).pack(fill="x", padx=12, pady=3)

        # ── Route timeline ──
        # Start: base
        self._render_base_marker(2, "🏠 Start — Home Base", f"{config.BASE_POSTCODE}  •  {plan['start_time']}")

        row_idx = 3
        for i, job in enumerate(plan["route"]):
            # Travel segment
            if job["travel_minutes"] > 0:
                self._render_travel_segment(row_idx, job)
                row_idx += 1

            # Job card
            self._render_job_card(row_idx, i + 1, job)
            row_idx += 1

        # End: return home
        self._render_travel_segment(row_idx, {
            "travel_minutes": self._calc_return_travel(),
            "travel_miles": 0,  # already counted in totals
        }, is_return=True)
        row_idx += 1
        self._render_base_marker(row_idx, "🏠 Finish — Home Base", f"{config.BASE_POSTCODE}  •  {plan['end_time']}")

    def _render_empty(self):
        empty = ctk.CTkFrame(self.body, fg_color=theme.BG_CARD, corner_radius=12)
        empty.grid(row=0, column=0, sticky="ew", padx=40, pady=40)
        ctk.CTkLabel(
            empty, text="📅",
            font=theme.font(40),
        ).pack(pady=(30, 8))
        ctk.CTkLabel(
            empty, text="No jobs scheduled for this date",
            font=theme.font(15), text_color=theme.TEXT_DIM,
        ).pack(pady=(0, 30))

    def _render_base_marker(self, row: int, title: str, subtitle: str):
        card = ctk.CTkFrame(self.body, fg_color=theme.GREEN_DARK, corner_radius=10, height=50)
        card.grid(row=row, column=0, sticky="ew", padx=30, pady=2)
        card.grid_propagate(False)
        card.grid_columnconfigure(1, weight=1)

        ctk.CTkLabel(
            card, text=title,
            font=theme.font_bold(13), text_color="white",
        ).grid(row=0, column=0, padx=12, pady=(8, 0), sticky="w")
        ctk.CTkLabel(
            card, text=subtitle,
            font=theme.font(11), text_color=theme.GREEN_PALE,
        ).grid(row=1, column=0, padx=12, pady=(0, 6), sticky="w")

    def _render_travel_segment(self, row: int, job: dict, is_return: bool = False):
        mins = job.get("travel_minutes", 0)
        miles = job.get("travel_miles", 0)

        seg = ctk.CTkFrame(self.body, fg_color="transparent", height=30)
        seg.grid(row=row, column=0, sticky="ew", padx=50, pady=0)
        seg.grid_columnconfigure(0, weight=1)

        # Vertical line + travel time
        label = "Return home" if is_return else f"🚐  {format_drive_time(mins)}"
        if miles > 0:
            label += f"  •  {miles} mi"

        # Colour: green < 15 min, amber 15-30, red > 30
        colour = theme.GREEN_LIGHT if mins <= 15 else (theme.AMBER if mins <= 30 else theme.RED)

        ctk.CTkLabel(
            seg, text=f"   │   {label}",
            font=theme.font(11), text_color=colour,
            anchor="w",
        ).grid(row=0, column=0, sticky="w")

    def _render_job_card(self, row: int, stop_num: int, job: dict):
        card = ctk.CTkFrame(self.body, fg_color=theme.BG_CARD, corner_radius=10)
        card.grid(row=row, column=0, sticky="ew", padx=16, pady=3)
        card.grid_columnconfigure(2, weight=1)

        # Stop number circle
        circle = ctk.CTkLabel(
            card, text=str(stop_num),
            font=theme.font_bold(14), text_color="white",
            fg_color=theme.GREEN_PRIMARY,
            corner_radius=16, width=32, height=32,
        )
        circle.grid(row=0, column=0, rowspan=2, padx=(12, 8), pady=10)

        # Job info
        name = job.get("name", "")
        service = job.get("service", "")
        postcode = job.get("postcode", "")
        parish = job.get("parish", "")
        duration = job.get("duration_hours", 0)
        price = float(job.get("price", 0) or 0)
        planned = f"{job.get('planned_start', '')} – {job.get('planned_end', '')}"

        title_text = f"{name}"
        if service:
            title_text += f"  •  {service}"

        ctk.CTkLabel(
            card, text=title_text,
            font=theme.font_bold(13), text_color=theme.TEXT_LIGHT,
            anchor="w",
        ).grid(row=0, column=1, columnspan=2, padx=4, pady=(10, 0), sticky="w")

        # Subtitle line
        parts = []
        if planned:
            parts.append(f"⏰ {planned}")
        parts.append(f"⏱️ {duration}h")
        if postcode:
            parts.append(f"📍 {postcode}")
        if parish:
            parts.append(parish)
        if price:
            parts.append(f"💰 £{price:,.0f}")

        ctk.CTkLabel(
            card, text="  •  ".join(parts),
            font=theme.font(11), text_color=theme.TEXT_DIM,
            anchor="w",
        ).grid(row=1, column=1, columnspan=2, padx=4, pady=(0, 10), sticky="w")

        # Click to view client
        if self.on_job_click and job.get("id"):
            card.bind("<Double-Button-1>", lambda e, j=job: self.on_job_click(j))
            for child in card.winfo_children():
                child.bind("<Double-Button-1>", lambda e, j=job: self.on_job_click(j))

    def _calc_return_travel(self) -> int:
        """Estimate return trip time from last job to base."""
        plan = self._plan
        if not plan or not plan["route"]:
            return 0
        # Rough: total_drive includes outbound legs; return = total - sum of legs
        total = plan["total_drive_minutes"]
        outbound = sum(j["travel_minutes"] for j in plan["route"])
        return max(total - outbound, 0)

    def _open_maps(self):
        """Open the planned route in Google Maps."""
        if self._plan and self._plan.get("route_url"):
            webbrowser.open(self._plan["route_url"])

    def refresh(self):
        self.plan_date(self._target_date)
