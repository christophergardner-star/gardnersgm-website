"""
Booking Calendar — Monthly calendar view with booking dots and day detail panel.
"""

import customtkinter as ctk
import calendar
from datetime import date, datetime, timedelta

from .. import theme


class BookingCalendar(ctk.CTkFrame):
    """
    A monthly calendar that shows bookings. Left side is the calendar grid,
    right side shows the detail list for the selected day.
    """

    def __init__(self, parent, db, on_booking_click=None, **kwargs):
        super().__init__(parent, fg_color="transparent", **kwargs)

        self.db = db
        self.on_booking_click = on_booking_click

        self._current_year = date.today().year
        self._current_month = date.today().month
        self._selected_date: str | None = None
        self._day_cells: dict[str, ctk.CTkFrame] = {}
        self._booking_counts: dict[str, int] = {}

        self.grid_columnconfigure(0, weight=3)
        self.grid_columnconfigure(1, weight=2)
        self.grid_rowconfigure(0, weight=1)

        self._build_calendar_side()
        self._build_detail_side()
        self._render_month()

    # ------------------------------------------------------------------
    # Calendar grid (left)
    # ------------------------------------------------------------------
    def _build_calendar_side(self):
        self.cal_frame = ctk.CTkFrame(self, fg_color=theme.BG_CARD, corner_radius=12)
        self.cal_frame.grid(row=0, column=0, sticky="nsew", padx=(0, 8))
        self.cal_frame.grid_rowconfigure(2, weight=1)
        self.cal_frame.grid_columnconfigure(0, weight=1)

        # Header with nav
        header = ctk.CTkFrame(self.cal_frame, fg_color="transparent")
        header.grid(row=0, column=0, sticky="ew", padx=12, pady=(12, 4))
        header.grid_columnconfigure(1, weight=1)

        self.prev_btn = ctk.CTkButton(
            header, text="◀", width=36, height=32,
            fg_color="transparent", hover_color=theme.BG_CARD_HOVER,
            text_color=theme.TEXT_LIGHT, font=theme.font(16),
            command=self._prev_month,
        )
        self.prev_btn.grid(row=0, column=0)

        self.month_label = ctk.CTkLabel(
            header, text="",
            font=theme.font_bold(16), text_color=theme.TEXT_LIGHT,
        )
        self.month_label.grid(row=0, column=1)

        self.next_btn = ctk.CTkButton(
            header, text="▶", width=36, height=32,
            fg_color="transparent", hover_color=theme.BG_CARD_HOVER,
            text_color=theme.TEXT_LIGHT, font=theme.font(16),
            command=self._next_month,
        )
        self.next_btn.grid(row=0, column=2)

        today_btn = ctk.CTkButton(
            header, text="Today", width=60, height=28,
            fg_color=theme.GREEN_PRIMARY, hover_color=theme.GREEN_DARK,
            font=theme.font(11, "bold"), corner_radius=6,
            command=self._go_today,
        )
        today_btn.grid(row=0, column=3, padx=(8, 0))

        # Day-of-week headers
        dow_frame = ctk.CTkFrame(self.cal_frame, fg_color="transparent")
        dow_frame.grid(row=1, column=0, sticky="ew", padx=8, pady=(4, 0))
        days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
        for i, d in enumerate(days):
            dow_frame.grid_columnconfigure(i, weight=1)
            color = theme.RED if i >= 5 else theme.TEXT_DIM
            ctk.CTkLabel(
                dow_frame, text=d, font=theme.font_bold(11),
                text_color=color,
            ).grid(row=0, column=i, pady=4)

        # Day grid container
        self.grid_container = ctk.CTkFrame(self.cal_frame, fg_color="transparent")
        self.grid_container.grid(row=2, column=0, sticky="nsew", padx=8, pady=(0, 8))
        for i in range(7):
            self.grid_container.grid_columnconfigure(i, weight=1)

    def _render_month(self):
        """Render the calendar grid for the current month."""
        # Clear old cells
        for w in self.grid_container.winfo_children():
            w.destroy()
        self._day_cells.clear()

        # Update header
        month_name = calendar.month_name[self._current_month]
        self.month_label.configure(text=f"{month_name} {self._current_year}")

        # Get booking counts
        self._booking_counts = self.db.get_dates_with_bookings(
            self._current_year, self._current_month
        )

        # Build grid
        cal = calendar.Calendar(firstweekday=0)  # Monday first
        weeks = cal.monthdayscalendar(self._current_year, self._current_month)

        today = date.today()

        for row_idx, week in enumerate(weeks):
            self.grid_container.grid_rowconfigure(row_idx, weight=1)
            for col_idx, day_num in enumerate(week):
                cell = self._create_day_cell(
                    row_idx, col_idx, day_num, today
                )
                cell.grid(row=row_idx, column=col_idx, padx=2, pady=2, sticky="nsew")

        # Auto-select today if in current month
        if today.year == self._current_year and today.month == self._current_month:
            self._select_date(today.isoformat())
        elif self._selected_date:
            # Keep selection if still in month
            try:
                sel = datetime.strptime(self._selected_date, "%Y-%m-%d").date()
                if sel.year == self._current_year and sel.month == self._current_month:
                    self._select_date(self._selected_date)
                else:
                    self._select_date(None)
            except Exception:
                self._select_date(None)
        else:
            self._select_date(None)

    def _create_day_cell(self, row: int, col: int, day_num: int,
                         today: date) -> ctk.CTkFrame:
        """Create a single day cell in the calendar grid."""
        is_empty = day_num == 0

        cell = ctk.CTkFrame(
            self.grid_container,
            fg_color=theme.BG_DARKER if not is_empty else "transparent",
            corner_radius=8,
            height=58,
        )

        if is_empty:
            return cell

        date_str = f"{self._current_year}-{self._current_month:02d}-{day_num:02d}"
        self._day_cells[date_str] = cell

        is_today = (today.year == self._current_year and
                    today.month == self._current_month and
                    today.day == day_num)
        is_weekend = col >= 5
        booking_count = self._booking_counts.get(date_str, 0)

        # Day number
        day_color = theme.GREEN_LIGHT if is_today else (
            theme.RED if is_weekend else theme.TEXT_LIGHT
        )
        day_label = ctk.CTkLabel(
            cell, text=str(day_num),
            font=theme.font_bold(13) if is_today else theme.font(13),
            text_color=day_color,
            anchor="nw",
        )
        day_label.place(x=8, y=4)

        # Today indicator
        if is_today:
            cell.configure(border_width=2, border_color=theme.GREEN_PRIMARY)

        # Booking dot/count
        if booking_count > 0:
            dot_color = theme.GREEN_LIGHT if booking_count <= 2 else (
                theme.AMBER if booking_count <= 4 else theme.RED
            )
            dot = ctk.CTkLabel(
                cell,
                text=f"● {booking_count}" if booking_count > 1 else "●",
                font=theme.font(10, "bold"),
                text_color=dot_color,
                anchor="se",
            )
            dot.place(relx=1.0, rely=1.0, x=-8, y=-4, anchor="se")

        # Click handler
        cell.bind("<Button-1>", lambda e, d=date_str: self._select_date(d))
        day_label.bind("<Button-1>", lambda e, d=date_str: self._select_date(d))
        if booking_count > 0:
            dot.bind("<Button-1>", lambda e, d=date_str: self._select_date(d))

        # Hover effect
        def on_enter(e, c=cell):
            if c.cget("fg_color") != theme.GREEN_DARK:
                c.configure(fg_color=theme.BG_CARD_HOVER)

        def on_leave(e, c=cell, d=date_str):
            if d != self._selected_date:
                c.configure(fg_color=theme.BG_DARKER)

        cell.bind("<Enter>", on_enter)
        cell.bind("<Leave>", on_leave)

        return cell

    def _select_date(self, date_str: str | None):
        """Select a date and show its bookings in the detail panel."""
        # Deselect old
        if self._selected_date and self._selected_date in self._day_cells:
            self._day_cells[self._selected_date].configure(
                fg_color=theme.BG_DARKER
            )

        self._selected_date = date_str

        # Highlight new
        if date_str and date_str in self._day_cells:
            self._day_cells[date_str].configure(fg_color=theme.GREEN_DARK)

        # Update detail panel
        self._render_detail(date_str)

    # ------------------------------------------------------------------
    # Detail panel (right)
    # ------------------------------------------------------------------
    def _build_detail_side(self):
        self.detail_frame = ctk.CTkFrame(self, fg_color=theme.BG_CARD, corner_radius=12)
        self.detail_frame.grid(row=0, column=1, sticky="nsew", padx=(8, 0))
        self.detail_frame.grid_columnconfigure(0, weight=1)
        self.detail_frame.grid_rowconfigure(1, weight=1)

        self.detail_header = ctk.CTkLabel(
            self.detail_frame,
            text="Select a day",
            font=theme.font_bold(14),
            text_color=theme.TEXT_LIGHT,
            anchor="w",
        )
        self.detail_header.grid(row=0, column=0, sticky="ew", padx=16, pady=(14, 8))

        self.detail_list = ctk.CTkScrollableFrame(
            self.detail_frame, fg_color="transparent",
        )
        self.detail_list.grid(row=1, column=0, sticky="nsew", padx=8, pady=(0, 8))
        self.detail_list.grid_columnconfigure(0, weight=1)

        # Summary
        self.detail_summary = ctk.CTkLabel(
            self.detail_frame,
            text="",
            font=theme.font(11),
            text_color=theme.TEXT_DIM,
            anchor="w",
        )
        self.detail_summary.grid(row=2, column=0, sticky="ew", padx=16, pady=(0, 12))

    def _render_detail(self, date_str: str | None):
        """Render the booking detail for a selected date."""
        # Clear
        for w in self.detail_list.winfo_children():
            w.destroy()

        if not date_str:
            self.detail_header.configure(text="Select a day")
            self.detail_summary.configure(text="")
            return

        try:
            dt = datetime.strptime(date_str, "%Y-%m-%d")
            header_text = dt.strftime("%A, %d %B %Y")
        except Exception:
            header_text = date_str

        # Get bookings for this date
        bookings_by_date = self.db.get_bookings_in_range(date_str, date_str)
        bookings = bookings_by_date.get(date_str, [])

        count = len(bookings)
        self.detail_header.configure(
            text=f"📅 {header_text}  ({count} booking{'s' if count != 1 else ''})"
        )

        if not bookings:
            ctk.CTkLabel(
                self.detail_list,
                text="No bookings for this day",
                font=theme.font(12),
                text_color=theme.TEXT_DIM,
            ).grid(row=0, column=0, pady=30)
            self.detail_summary.configure(text="")
            return

        total_revenue = 0.0
        for i, b in enumerate(bookings):
            card = self._create_booking_card(b, i)
            card.grid(row=i, column=0, sticky="ew", padx=4, pady=3)
            total_revenue += float(b.get("price", 0) or 0)

        self.detail_summary.configure(
            text=f"💰 Total: £{total_revenue:,.0f}  •  {count} booking{'s' if count != 1 else ''}"
        )

    def _create_booking_card(self, booking: dict, index: int) -> ctk.CTkFrame:
        """Create a single booking card in the detail panel."""
        card = ctk.CTkFrame(
            self.detail_list,
            fg_color=theme.BG_DARKER if index % 2 == 0 else theme.BG_CARD_HOVER,
            corner_radius=8,
        )
        card.grid_columnconfigure(0, weight=1)

        # Top row: time + name
        top = ctk.CTkFrame(card, fg_color="transparent")
        top.grid(row=0, column=0, sticky="ew", padx=10, pady=(8, 2))
        top.grid_columnconfigure(1, weight=1)

        time_str = booking.get("time", "")
        ctk.CTkLabel(
            top, text=time_str or "TBC",
            font=theme.font_mono(11),
            text_color=theme.GREEN_LIGHT,
            width=50,
        ).grid(row=0, column=0, sticky="w")

        name = booking.get("name", booking.get("client_name", ""))
        ctk.CTkLabel(
            top, text=name,
            font=theme.font_bold(12),
            text_color=theme.TEXT_LIGHT,
            anchor="w",
        ).grid(row=0, column=1, sticky="w", padx=(8, 0))

        # Status badge
        status = booking.get("status", "")
        if status:
            badge = theme.create_status_badge(top, status)
            badge.grid(row=0, column=2, padx=(4, 0))

        # Bottom row: service + price
        bottom = ctk.CTkFrame(card, fg_color="transparent")
        bottom.grid(row=1, column=0, sticky="ew", padx=10, pady=(0, 8))
        bottom.grid_columnconfigure(0, weight=1)

        service = booking.get("service", "")
        ctk.CTkLabel(
            bottom, text=f"🔧 {service}" if service else "",
            font=theme.font(11),
            text_color=theme.TEXT_DIM,
            anchor="w",
        ).grid(row=0, column=0, sticky="w")

        price = float(booking.get("price", 0) or 0)
        if price:
            ctk.CTkLabel(
                bottom, text=f"£{price:,.0f}",
                font=theme.font_bold(11),
                text_color=theme.GREEN_LIGHT,
            ).grid(row=0, column=1, sticky="e")

        # Click to open client
        if self.on_booking_click:
            card.bind("<Button-1>", lambda e, b=booking: self.on_booking_click(b))
            for child in card.winfo_children():
                child.bind("<Button-1>", lambda e, b=booking: self.on_booking_click(b))
                for sub in child.winfo_children():
                    sub.bind("<Button-1>", lambda e, b=booking: self.on_booking_click(b))

        return card

    # ------------------------------------------------------------------
    # Navigation
    # ------------------------------------------------------------------
    def _prev_month(self):
        if self._current_month == 1:
            self._current_month = 12
            self._current_year -= 1
        else:
            self._current_month -= 1
        self._selected_date = None
        self._render_month()

    def _next_month(self):
        if self._current_month == 12:
            self._current_month = 1
            self._current_year += 1
        else:
            self._current_month += 1
        self._selected_date = None
        self._render_month()

    def _go_today(self):
        today = date.today()
        self._current_year = today.year
        self._current_month = today.month
        self._render_month()

    # ------------------------------------------------------------------
    # Refresh
    # ------------------------------------------------------------------
    def refresh(self):
        """Refresh the calendar data."""
        self._render_month()
