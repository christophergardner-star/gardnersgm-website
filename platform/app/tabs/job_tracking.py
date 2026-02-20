"""
Job Tracking Tab — View mobile app job tracking activity, photos, and time logs.
"""

import customtkinter as ctk
import threading
from datetime import datetime, timedelta

from ..ui import theme
from .. import config

import logging
log = logging.getLogger("ggm.tabs.job_tracking")


class JobTrackingTab(ctk.CTkFrame):
    """View job tracking records from the mobile app — time, photos, notes."""

    def __init__(self, parent, db, sync, api, app_window, **kwargs):
        super().__init__(parent, fg_color=theme.BG_DARK, **kwargs)

        self.db = db
        self.sync = sync
        self.api = api
        self.app = app_window

        self._date_filter = datetime.now().strftime("%Y-%m-%d")

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
        hdr.grid_columnconfigure(3, weight=1)

        ctk.CTkLabel(
            hdr, text="⏱️  Job Tracking",
            font=theme.font_bold(16), text_color=theme.TEXT_LIGHT,
        ).grid(row=0, column=0, padx=16, pady=12, sticky="w")

        # Date filter buttons
        for i, (label, delta) in enumerate([
            ("Today", 0), ("Yesterday", 1), ("All Recent", None)
        ]):
            def _cmd(d=delta):
                if d is not None:
                    self._date_filter = (datetime.now() - timedelta(days=d)).strftime("%Y-%m-%d")
                else:
                    self._date_filter = ""
                self.refresh()

            btn = ctk.CTkButton(
                hdr, text=label, font=theme.font(12),
                fg_color=theme.GREEN_PRIMARY if (delta == 0) else "transparent",
                hover_color=theme.GREEN_DARK,
                text_color="white",
                height=32, width=100, corner_radius=8,
                command=_cmd,
            )
            btn.grid(row=0, column=i + 1, padx=4, pady=10)

        # Refresh
        theme.create_outline_button(
            hdr, "↻  Refresh",
            command=self.refresh,
        ).grid(row=0, column=5, padx=16, pady=8, sticky="e")

    def _build_body(self):
        body = ctk.CTkFrame(self, fg_color=theme.BG_DARK)
        body.grid(row=1, column=0, sticky="nsew", padx=16, pady=(8, 16))
        body.grid_columnconfigure(0, weight=1)
        body.grid_rowconfigure(1, weight=1)

        # ── Summary KPIs ──
        self._kpi_frame = ctk.CTkFrame(body, fg_color="transparent", height=70)
        self._kpi_frame.grid(row=0, column=0, sticky="ew", pady=(0, 8))
        self._kpi_frame.grid_columnconfigure((0, 1, 2, 3), weight=1)

        self._kpi_cards = {}
        for i, (key, label, icon) in enumerate([
            ("completed", "Completed", "✅"),
            ("active", "Active", "🔴"),
            ("total_time", "Total Time", "⏱️"),
            ("photos", "Photos", "📸"),
        ]):
            card = theme.create_card(self._kpi_frame)
            card.grid(row=0, column=i, padx=4, sticky="ew")
            ctk.CTkLabel(
                card, text=f"{icon} {label}", font=theme.font(10),
                text_color=theme.TEXT_DIM,
            ).pack(padx=8, pady=(6, 0))
            val_label = ctk.CTkLabel(
                card, text="—", font=theme.font_bold(18),
                text_color=theme.TEXT_LIGHT,
            )
            val_label.pack(padx=8, pady=(0, 6))
            self._kpi_cards[key] = val_label

        # ── Records list ──
        list_card = theme.create_card(body)
        list_card.grid(row=1, column=0, sticky="nsew")

        ctk.CTkLabel(
            list_card, text="📋 Tracking Records", font=theme.font_bold(13),
            text_color=theme.TEXT_LIGHT,
        ).pack(anchor="w", padx=12, pady=(10, 4))

        self._track_scroll = ctk.CTkScrollableFrame(
            list_card, fg_color="transparent")
        self._track_scroll.pack(fill="both", expand=True, padx=8, pady=(0, 8))

    # ------------------------------------------------------------------
    # Data loading
    # ------------------------------------------------------------------
    def _load_tracking(self):
        """Fetch tracking data from local SQLite (populated by sync engine)."""
        try:
            records = self.db.get_job_tracking(
                date=self._date_filter if self._date_filter else None,
                limit=50,
            )
        except Exception as e:
            log.warning(f"Failed to load tracking from DB: {e}")
            records = []
        self._render_tracking(records)

    def _render_tracking(self, records):
        """Render KPIs and tracking record cards."""
        # ── Update KPIs ──
        completed = sum(1 for r in records
                        if not r.get("is_active") and r.get("end_time"))
        active = sum(1 for r in records if r.get("is_active"))
        total_mins = sum(int(r.get("duration_mins", 0) or 0) for r in records)
        photos = sum(int(r.get("photo_count", 0) or 0) for r in records)

        hours, mins = divmod(total_mins, 60)
        time_str = f"{hours}h {mins}m" if hours else f"{mins}m"

        self._kpi_cards["completed"].configure(text=str(completed))
        self._kpi_cards["active"].configure(
            text=str(active),
            text_color=theme.RED if active else theme.TEXT_LIGHT)
        self._kpi_cards["total_time"].configure(text=time_str)
        self._kpi_cards["photos"].configure(text=str(photos))

        # ── Render cards ──
        for w in self._track_scroll.winfo_children():
            w.destroy()

        if not records:
            ctk.CTkLabel(
                self._track_scroll,
                text="No tracking records for this period",
                font=theme.font(12), text_color=theme.TEXT_DIM,
            ).pack(pady=20)
            return

        for rec in records:
            is_active = bool(rec.get("is_active", 0))
            icon = "🔴" if is_active else "✅"
            job_ref = rec.get("job_ref", "Unknown")
            duration = int(rec.get("duration_mins", 0) or 0)
            photo_count = int(rec.get("photo_count", 0) or 0)
            start_time = rec.get("start_time", "")
            notes = rec.get("notes", "")

            card = ctk.CTkFrame(self._track_scroll, fg_color=theme.BG_CARD,
                                corner_radius=8)
            card.pack(fill="x", pady=3, padx=4)
            card.grid_columnconfigure(1, weight=1)

            # Top row: icon + job ref | duration
            top = ctk.CTkFrame(card, fg_color="transparent")
            top.pack(fill="x", padx=10, pady=(8, 0))
            top.grid_columnconfigure(1, weight=1)

            ctk.CTkLabel(
                top, text=f"{icon} {job_ref}",
                font=theme.font(13, "bold"),
                text_color=theme.RED if is_active else theme.GREEN_LIGHT,
            ).grid(row=0, column=0, sticky="w")

            dur_text = "IN PROGRESS" if is_active else f"{duration} mins"
            dur_col = theme.AMBER if is_active else theme.TEXT_LIGHT
            ctk.CTkLabel(
                top, text=dur_text, font=theme.font(12, "bold"),
                text_color=dur_col,
            ).grid(row=0, column=1, sticky="e")

            # Meta row
            meta_parts = []
            if start_time:
                meta_parts.append(f"Started: {start_time[:16]}")
            if photo_count:
                meta_parts.append(f"📸 {photo_count}")

            if meta_parts:
                ctk.CTkLabel(
                    card, text="  •  ".join(meta_parts),
                    font=theme.font(10), text_color=theme.TEXT_DIM,
                ).pack(anchor="w", padx=10)

            # Notes
            if notes:
                ctk.CTkLabel(
                    card, text=f"📌 {notes}",
                    font=theme.font(11), text_color=theme.TEXT_DIM,
                    wraplength=500, anchor="w", justify="left",
                ).pack(anchor="w", padx=10, pady=(0, 6))
            else:
                # Small bottom padding
                ctk.CTkFrame(card, fg_color="transparent", height=4).pack()

    # ------------------------------------------------------------------
    # Refresh
    # ------------------------------------------------------------------
    def refresh(self):
        self._load_tracking()

    def on_table_update(self, table_name: str):
        """Auto-refresh when sync updates job_tracking or schedule."""
        if table_name in ("job_tracking", "schedule", "job_photos"):
            self.refresh()
