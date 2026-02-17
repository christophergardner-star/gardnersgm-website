"""
Operations Tab — CRM client list, schedule, subscriptions, quotes.
The core day-to-day management screen.
"""

import customtkinter as ctk
from datetime import date

from ..ui import theme
from ..ui.components.data_table import DataTable
from ..ui.components.client_modal import ClientModal
from ..ui.components.booking_calendar import BookingCalendar
from ..ui.components.booking_detail_card import BookingDetailCard
from ..ui.components.quote_modal import QuoteModal
from ..ui.components.enquiry_modal import EnquiryModal
from ..ui.components.day_planner import DayPlanner


class OperationsTab(ctk.CTkFrame):
    """Operations tab with sub-tab navigation."""

    def __init__(self, parent, db, sync, api, app_window, **kwargs):
        super().__init__(parent, fg_color=theme.BG_DARK, **kwargs)

        self.db = db
        self.sync = sync
        self.api = api
        self.app = app_window

        self._current_sub = None
        self._sub_buttons = {}
        self._sub_frames = {}

        self.grid_columnconfigure(0, weight=1)
        self.grid_rowconfigure(1, weight=1)

        self._build_sub_tabs()
        self._build_panels()
        self._switch_sub("clients")

    # ------------------------------------------------------------------
    # Sub-Tab Navigation
    # ------------------------------------------------------------------
    def _build_sub_tabs(self):
        """Build the sub-tab navigation row."""
        tab_bar = ctk.CTkFrame(self, fg_color=theme.BG_CARD, height=44, corner_radius=0)
        tab_bar.grid(row=0, column=0, sticky="ew")
        tab_bar.grid_columnconfigure(10, weight=1)

        tabs = [
            ("clients", "👥 All Clients"),
            ("calendar", "📆 Calendar"),
            ("schedule", "📅 Today"),
            ("planner", "🗺️ Route Planner"),
            ("subscriptions", "🔄 Subscriptions"),
            ("quotes", "📝 Quotes"),
            ("enquiries", "📨 Enquiries"),
        ]

        for i, (key, text) in enumerate(tabs):
            btn = ctk.CTkButton(
                tab_bar,
                text=text,
                font=theme.font(13),
                fg_color="transparent",
                hover_color=theme.BG_CARD_HOVER,
                text_color=theme.TEXT_DIM,
                corner_radius=0,
                height=40,
                width=140,
                command=lambda k=key: self._switch_sub(k),
            )
            btn.grid(row=0, column=i, padx=1)
            self._sub_buttons[key] = btn

    def _switch_sub(self, key: str):
        """Switch to a sub-tab."""
        if self._current_sub == key:
            return

        # Update button styles
        for k, btn in self._sub_buttons.items():
            if k == key:
                btn.configure(
                    fg_color=theme.GREEN_PRIMARY,
                    text_color=theme.TEXT_LIGHT,
                )
            else:
                btn.configure(
                    fg_color="transparent",
                    text_color=theme.TEXT_DIM,
                )

        # Show the right frame
        for k, frame in self._sub_frames.items():
            if k == key:
                frame.grid(row=1, column=0, sticky="nsew", padx=0, pady=0)
            else:
                frame.grid_forget()

        self._current_sub = key

        # Refresh data for the new sub-tab
        self._refresh_subtab(key)

    # ------------------------------------------------------------------
    # Build Panels
    # ------------------------------------------------------------------
    def _build_panels(self):
        """Build all sub-tab panels."""
        self._build_clients_panel()
        self._build_calendar_panel()
        self._build_schedule_panel()
        self._build_planner_panel()
        self._build_subscriptions_panel()
        self._build_quotes_panel()
        self._build_enquiries_panel()

    def _build_calendar_panel(self):
        """Build the booking calendar panel."""
        frame = ctk.CTkFrame(self, fg_color="transparent")
        self._sub_frames["calendar"] = frame

        frame.grid_columnconfigure(0, weight=1)
        frame.grid_rowconfigure(0, weight=1)

        self.booking_calendar = BookingCalendar(
            frame, self.db,
            on_booking_click=self._open_calendar_booking,
        )
        self.booking_calendar.grid(row=0, column=0, sticky="nsew", padx=12, pady=12)

    def _open_calendar_booking(self, booking: dict):
        """Open a detail card from a calendar booking click."""
        BookingDetailCard(
            self, booking, db=self.db, sync=self.sync,
            on_edit=self._edit_calendar_client,
        )

    def _edit_calendar_client(self, booking: dict):
        """Open full client editor from the detail card 'Edit' button."""
        client_id = booking.get("id")
        name = booking.get("name", booking.get("client_name", ""))
        client = None
        if client_id:
            client = self.db.get_client(client_id)
        if not client and name:
            clients = self.db.get_clients(search=name)
            client = clients[0] if clients else None
        if client:
            ClientModal(
                self, client, self.db, self.sync,
                on_save=lambda: self._refresh_subtab(self._current_sub),
            )

    def _refresh_calendar(self):
        """Refresh the calendar view."""
        if hasattr(self, "booking_calendar"):
            self.booking_calendar.refresh()

    def _build_clients_panel(self):
        """Build the clients CRM panel."""
        frame = ctk.CTkFrame(self, fg_color="transparent")
        self._sub_frames["clients"] = frame

        frame.grid_columnconfigure(0, weight=1)
        frame.grid_rowconfigure(1, weight=1)

        # Action bar
        action_bar = ctk.CTkFrame(frame, fg_color="transparent", height=48)
        action_bar.grid(row=0, column=0, sticky="ew", padx=12, pady=(12, 4))
        action_bar.grid_columnconfigure(1, weight=1)

        theme.create_accent_button(
            action_bar, "＋ Add Client",
            command=self._add_client, width=130,
        ).grid(row=0, column=0, padx=(0, 8))

        # Filter dropdowns
        filter_frame = ctk.CTkFrame(action_bar, fg_color="transparent")
        filter_frame.grid(row=0, column=1, sticky="e")

        ctk.CTkLabel(
            filter_frame, text="Status:", font=theme.font(11),
            text_color=theme.TEXT_DIM,
        ).pack(side="left", padx=(0, 4))

        self.client_status_filter = ctk.CTkComboBox(
            filter_frame,
            values=["All", "Pending", "Confirmed", "In Progress", "Complete", "Cancelled"],
            width=120,
            font=theme.font(11),
            command=lambda _: self._refresh_subtab("clients"),
        )
        self.client_status_filter.set("All")
        self.client_status_filter.pack(side="left", padx=4)

        ctk.CTkLabel(
            filter_frame, text="Paid:", font=theme.font(11),
            text_color=theme.TEXT_DIM,
        ).pack(side="left", padx=(12, 4))

        self.client_paid_filter = ctk.CTkComboBox(
            filter_frame,
            values=["All", "Yes", "No", "Deposit", "Refunded"],
            width=100,
            font=theme.font(11),
            command=lambda _: self._refresh_subtab("clients"),
        )
        self.client_paid_filter.set("All")
        self.client_paid_filter.pack(side="left", padx=4)

        # Clients table
        columns = [
            {"key": "job_number",    "label": "Job #",      "width": 70},
            {"key": "name",          "label": "Client",    "width": 160},
            {"key": "service",       "label": "Service",   "width": 130},
            {"key": "price",         "label": "Price",      "width": 70},
            {"key": "date",          "label": "Date",       "width": 90},
            {"key": "preferred_day", "label": "Day",        "width": 70},
            {"key": "frequency",     "label": "Frequency",  "width": 85},
            {"key": "type",          "label": "Type",       "width": 80},
            {"key": "status",        "label": "Status",     "width": 85},
            {"key": "paid",          "label": "Paid",       "width": 65},
            {"key": "postcode",      "label": "Postcode",   "width": 75},
        ]

        self.clients_table = DataTable(
            frame,
            columns=columns,
            on_double_click=self._open_client,
            on_select=None,
        )
        self.clients_table.grid(row=1, column=0, sticky="nsew", padx=12, pady=(4, 12))

    def _build_schedule_panel(self):
        """Build the today's schedule panel."""
        frame = ctk.CTkFrame(self, fg_color="transparent")
        self._sub_frames["schedule"] = frame

        frame.grid_columnconfigure(0, weight=1)
        frame.grid_rowconfigure(1, weight=1)

        # Header
        header = ctk.CTkFrame(frame, fg_color="transparent")
        header.grid(row=0, column=0, sticky="ew", padx=12, pady=(12, 4))

        today_str = date.today().strftime("%A, %d %B %Y")
        ctk.CTkLabel(
            header,
            text=f"📅 Schedule for {today_str}",
            font=theme.font_bold(15),
            text_color=theme.TEXT_LIGHT,
            anchor="w",
        ).pack(side="left")

        columns = [
            {"key": "time",      "label": "Time",      "width": 80},
            {"key": "name",      "label": "Client",    "width": 180},
            {"key": "service",   "label": "Service",   "width": 150},
            {"key": "price",     "label": "Price",      "width": 80},
            {"key": "status",    "label": "Status",     "width": 90},
            {"key": "address",   "label": "Address",   "width": 200},
            {"key": "postcode",  "label": "Postcode",   "width": 80},
            {"key": "phone",     "label": "Phone",     "width": 110},
        ]

        self.schedule_table = DataTable(
            frame,
            columns=columns,
            on_double_click=self._open_schedule_client,
        )
        self.schedule_table.grid(row=1, column=0, sticky="nsew", padx=12, pady=(4, 12))

    def _build_planner_panel(self):
        """Build the route planner panel."""
        frame = ctk.CTkFrame(self, fg_color="transparent")
        self._sub_frames["planner"] = frame

        frame.grid_columnconfigure(0, weight=1)
        frame.grid_rowconfigure(0, weight=1)

        self.day_planner = DayPlanner(
            frame, self.db,
            on_job_click=self._open_schedule_client,
        )
        self.day_planner.grid(row=0, column=0, sticky="nsew", padx=12, pady=12)

    def _build_subscriptions_panel(self):
        """Build the subscriptions panel."""
        frame = ctk.CTkFrame(self, fg_color="transparent")
        self._sub_frames["subscriptions"] = frame

        frame.grid_columnconfigure(0, weight=1)
        frame.grid_rowconfigure(1, weight=1)

        # Header with stats
        header = ctk.CTkFrame(frame, fg_color="transparent")
        header.grid(row=0, column=0, sticky="ew", padx=12, pady=(12, 4))
        header.grid_columnconfigure(1, weight=1)

        ctk.CTkLabel(
            header,
            text="🔄 Active Subscriptions",
            font=theme.font_bold(15),
            text_color=theme.TEXT_LIGHT,
            anchor="w",
        ).grid(row=0, column=0, sticky="w")

        self.subs_total_label = ctk.CTkLabel(
            header,
            text="Total Monthly: £0",
            font=theme.font_bold(13),
            text_color=theme.GREEN_LIGHT,
        )
        self.subs_total_label.grid(row=0, column=1, sticky="e", padx=8)

        columns = [
            {"key": "job_number",    "label": "Job #",      "width": 70},
            {"key": "name",          "label": "Client",    "width": 160},
            {"key": "service",       "label": "Service",   "width": 130},
            {"key": "price",         "label": "Price",      "width": 70},
            {"key": "preferred_day", "label": "Day",        "width": 80},
            {"key": "frequency",     "label": "Freq.",      "width": 80},
            {"key": "status",        "label": "Status",     "width": 90},
            {"key": "paid",          "label": "Paid",       "width": 65},
            {"key": "phone",         "label": "Phone",     "width": 110},
            {"key": "postcode",      "label": "Postcode",   "width": 80},
        ]

        self.subs_table = DataTable(
            frame,
            columns=columns,
            on_double_click=self._open_client,
        )
        self.subs_table.grid(row=1, column=0, sticky="nsew", padx=12, pady=(4, 12))

    def _build_quotes_panel(self):
        """Build the quotes panel."""
        frame = ctk.CTkFrame(self, fg_color="transparent")
        self._sub_frames["quotes"] = frame

        frame.grid_columnconfigure(0, weight=1)
        frame.grid_rowconfigure(1, weight=1)

        # Action bar
        action_bar = ctk.CTkFrame(frame, fg_color="transparent")
        action_bar.grid(row=0, column=0, sticky="ew", padx=12, pady=(12, 4))
        action_bar.grid_columnconfigure(1, weight=1)

        theme.create_accent_button(
            action_bar, "＋ New Quote",
            command=self._add_quote, width=120,
        ).grid(row=0, column=0, sticky="w", padx=(0, 8))

        ctk.CTkLabel(
            action_bar,
            text="📝 Quotes",
            font=theme.font_bold(15),
            text_color=theme.TEXT_LIGHT,
        ).grid(row=0, column=0, sticky="w", padx=(130, 0))

        # Status filter
        filter_frame = ctk.CTkFrame(action_bar, fg_color="transparent")
        filter_frame.grid(row=0, column=1, sticky="e")

        ctk.CTkLabel(
            filter_frame, text="Status:", font=theme.font(11),
            text_color=theme.TEXT_DIM,
        ).pack(side="left", padx=(0, 4))

        self.quote_status_filter = ctk.CTkComboBox(
            filter_frame,
            values=["All", "Draft", "Sent", "Accepted", "Declined", "Expired"],
            width=120, font=theme.font(11),
            command=lambda _: self._refresh_subtab("quotes"),
        )
        self.quote_status_filter.set("All")
        self.quote_status_filter.pack(side="left", padx=4)

        columns = [
            {"key": "quote_number", "label": "Quote #",     "width": 80},
            {"key": "client_name",  "label": "Client",     "width": 160},
            {"key": "total",        "label": "Total",       "width": 90},
            {"key": "status",       "label": "Status",      "width": 90},
            {"key": "date",         "label": "Date",        "width": 90},
            {"key": "valid_until",  "label": "Valid Until", "width": 90},
        ]

        self.quotes_table = DataTable(
            frame,
            columns=columns,
            on_double_click=self._open_quote,
        )
        self.quotes_table.grid(row=1, column=0, sticky="nsew", padx=12, pady=(4, 12))

    def _build_enquiries_panel(self):
        """Build the enquiries panel."""
        frame = ctk.CTkFrame(self, fg_color="transparent")
        self._sub_frames["enquiries"] = frame

        frame.grid_columnconfigure(0, weight=1)
        frame.grid_rowconfigure(1, weight=1)

        # Action bar
        action_bar = ctk.CTkFrame(frame, fg_color="transparent")
        action_bar.grid(row=0, column=0, sticky="ew", padx=12, pady=(12, 4))
        action_bar.grid_columnconfigure(1, weight=1)

        theme.create_accent_button(
            action_bar, "＋ Add Enquiry",
            command=self._add_enquiry, width=130,
        ).grid(row=0, column=0, sticky="w", padx=(0, 8))

        ctk.CTkLabel(
            action_bar,
            text="📨 Enquiries",
            font=theme.font_bold(15),
            text_color=theme.TEXT_LIGHT,
        ).grid(row=0, column=0, sticky="w", padx=(140, 0))

        # Status filter
        filter_frame = ctk.CTkFrame(action_bar, fg_color="transparent")
        filter_frame.grid(row=0, column=1, sticky="e")

        ctk.CTkLabel(
            filter_frame, text="Status:", font=theme.font(11),
            text_color=theme.TEXT_DIM,
        ).pack(side="left", padx=(0, 4))

        self.enquiry_status_filter = ctk.CTkComboBox(
            filter_frame,
            values=["All", "New", "Contacted", "Quoted", "Converted", "Closed"],
            width=120, font=theme.font(11),
            command=lambda _: self._refresh_subtab("enquiries"),
        )
        self.enquiry_status_filter.set("All")
        self.enquiry_status_filter.pack(side="left", padx=4)

        columns = [
            {"key": "name",    "label": "Name",      "width": 160},
            {"key": "email",   "label": "Email",     "width": 180},
            {"key": "phone",   "label": "Phone",     "width": 120},
            {"key": "type",    "label": "Type",      "width": 100},
            {"key": "status",  "label": "Status",    "width": 90},
            {"key": "date",    "label": "Date",      "width": 100},
            {"key": "replied", "label": "Replied",   "width": 70},
        ]

        self.enquiries_table = DataTable(
            frame,
            columns=columns,
            on_double_click=self._open_enquiry,
        )
        self.enquiries_table.grid(row=1, column=0, sticky="nsew", padx=12, pady=(4, 12))

    # ------------------------------------------------------------------
    # Data Loading
    # ------------------------------------------------------------------
    def _refresh_subtab(self, key: str):
        """Refresh data for a sub-tab."""
        try:
            if key == "clients":
                self._load_clients()
            elif key == "calendar":
                self._refresh_calendar()
            elif key == "schedule":
                self._load_schedule()
            elif key == "planner":
                if hasattr(self, "day_planner"):
                    self.day_planner.refresh()
            elif key == "subscriptions":
                self._load_subscriptions()
            elif key == "quotes":
                self._load_quotes()
            elif key == "enquiries":
                self._load_enquiries()
        except Exception as e:
            import traceback
            traceback.print_exc()

    def _load_clients(self):
        """Load clients into the table."""
        status_val = self.client_status_filter.get()
        paid_val = self.client_paid_filter.get()

        status = status_val if status_val != "All" else None
        paid = paid_val if paid_val != "All" else None

        clients = self.db.get_clients(status=status, paid=paid)

        rows = []
        for c in clients:
            rows.append({
                "id": c.get("id", ""),
                "job_number": c.get("job_number", ""),
                "name": c.get("name", ""),
                "service": c.get("service", ""),
                "price": f"£{float(c.get('price', 0) or 0):,.0f}",
                "date": c.get("date", ""),
                "preferred_day": c.get("preferred_day", ""),
                "frequency": c.get("frequency", ""),
                "type": c.get("type", ""),
                "status": c.get("status", ""),
                "paid": c.get("paid", ""),
                "postcode": c.get("postcode", ""),
            })

        self.clients_table.set_data(rows)

    def _load_schedule(self):
        """Load today's jobs into the schedule table."""
        jobs = self.db.get_todays_jobs()

        rows = []
        for j in jobs:
            rows.append({
                "id": j.get("id", ""),
                "time": j.get("time", ""),
                "name": j.get("client_name", j.get("name", "")),
                "service": j.get("service", ""),
                "price": f"£{float(j.get('price', 0) or 0):,.0f}",
                "status": j.get("status", ""),
                "address": j.get("address", ""),
                "postcode": j.get("postcode", ""),
                "phone": j.get("phone", ""),
            })

        self.schedule_table.set_data(rows)

    def _load_subscriptions(self):
        """Load subscription clients."""
        clients = self.db.get_clients(client_type="Subscription")

        rows = []
        total = 0.0
        for c in clients:
            price = float(c.get("price", 0) or 0)
            total += price
            rows.append({
                "id": c.get("id", ""),
                "job_number": c.get("job_number", ""),
                "name": c.get("name", ""),
                "service": c.get("service", ""),
                "price": f"£{price:,.0f}",
                "preferred_day": c.get("preferred_day", ""),
                "frequency": c.get("frequency", ""),
                "status": c.get("status", ""),
                "paid": c.get("paid", ""),
                "phone": c.get("phone", ""),
                "postcode": c.get("postcode", ""),
            })

        self.subs_table.set_data(rows)
        self.subs_total_label.configure(text=f"Total Monthly: £{total:,.0f}  •  {len(rows)} clients")

    def _load_quotes(self):
        """Load quotes."""
        status_val = self.quote_status_filter.get()
        status = status_val if status_val != "All" else None
        quotes = self.db.get_quotes(status=status)

        rows = []
        for q in quotes:
            rows.append({
                "id": q.get("id", ""),
                "quote_number": q.get("quote_number", ""),
                "client_name": q.get("client_name", ""),
                "total": f"£{float(q.get('total', 0) or 0):,.0f}",
                "status": q.get("status", ""),
                "date": q.get("date_created", q.get("date", "")),
                "valid_until": q.get("valid_until", ""),
            })

        self.quotes_table.set_data(rows)

    def _load_enquiries(self):
        """Load enquiries."""
        status_val = self.enquiry_status_filter.get()
        status = status_val if status_val != "All" else None
        enquiries = self.db.get_enquiries(status=status)

        rows = []
        for e in enquiries:
            rows.append({
                "id": e.get("id", ""),
                "name": e.get("name", ""),
                "email": e.get("email", ""),
                "phone": e.get("phone", ""),
                "type": e.get("type", ""),
                "status": e.get("status", ""),
                "date": e.get("date", ""),
                "replied": e.get("replied", ""),
            })

        self.enquiries_table.set_data(rows)

    # ------------------------------------------------------------------
    # Actions
    # ------------------------------------------------------------------
    def _open_client(self, values: dict):
        """Open a client detail modal."""
        client_id = values.get("id")
        if client_id:
            client = self.db.get_client(client_id)
            if client:
                ClientModal(
                    self, client, self.db, self.sync,
                    on_save=lambda: self._refresh_subtab(self._current_sub),
                )

    def _open_schedule_client(self, values: dict):
        """Open client from schedule row."""
        name = values.get("name", "")
        # Find client by name match
        clients = self.db.get_clients(search=name)
        if clients:
            ClientModal(
                self, clients[0], self.db, self.sync,
                on_save=lambda: self._refresh_subtab(self._current_sub),
            )

    def _add_client(self):
        """Open an empty client modal for creating a new client."""
        empty = {
            "name": "",
            "email": "",
            "phone": "",
            "postcode": "",
            "address": "",
            "service": "",
            "price": "",
            "date": "",
            "time": "",
            "preferred_day": "",
            "frequency": "",
            "type": "One-Off",
            "status": "Pending",
            "paid": "No",
            "notes": "",
        }
        ClientModal(
            self, empty, self.db, self.sync,
            on_save=lambda: self._refresh_subtab("clients"),
        )

    def _open_quote(self, values: dict):
        """Open a quote detail modal on double-click."""
        quote_id = values.get("id")
        if quote_id:
            quote = self.db.get_quote(quote_id)
            if quote:
                email_engine = getattr(self.app, '_email_engine', None)
                QuoteModal(
                    self, quote, self.db, self.sync,
                    on_save=lambda: self._refresh_subtab("quotes"),
                    email_engine=email_engine,
                )

    def _add_quote(self):
        """Open empty quote modal."""
        from datetime import timedelta
        empty = {
            "quote_number": "",
            "client_name": "",
            "client_email": "",
            "client_phone": "",
            "postcode": "",
            "address": "",
            "subtotal": 0,
            "discount": 0,
            "vat": 0,
            "total": 0,
            "status": "Draft",
            "date_created": date.today().isoformat(),
            "valid_until": (date.today() + timedelta(days=30)).isoformat(),
            "deposit_required": 0,
            "notes": "",
        }
        email_engine = getattr(self.app, '_email_engine', None)
        QuoteModal(
            self, empty, self.db, self.sync,
            on_save=lambda: self._refresh_subtab("quotes"),
            email_engine=email_engine,
        )

    def _open_enquiry(self, values: dict):
        """Open an enquiry detail modal on double-click."""
        enq_id = values.get("id")
        if enq_id:
            enq = self.db.get_enquiry(enq_id)
            if enq:
                email_engine = getattr(self.app, '_email_engine', None)
                EnquiryModal(
                    self, enq, self.db, self.sync,
                    on_save=lambda: self._refresh_subtab("enquiries"),
                    email_engine=email_engine,
                )

    def _add_enquiry(self):
        """Open empty enquiry modal."""
        empty = {
            "name": "",
            "email": "",
            "phone": "",
            "message": "",
            "type": "General",
            "status": "New",
            "date": date.today().isoformat(),
            "replied": "No",
            "notes": "",
        }
        email_engine = getattr(self.app, '_email_engine', None)
        EnquiryModal(
            self, empty, self.db, self.sync,
            on_save=lambda: self._refresh_subtab("enquiries"),
            email_engine=email_engine,
        )

    # ------------------------------------------------------------------
    # Search
    # ------------------------------------------------------------------
    def show_search_results(self, results: list[dict]):
        """Display search results in the clients table."""
        self._switch_sub("clients")

        rows = []
        for r in results:
            rows.append({
                "id": r.get("id", ""),
                "job_number": r.get("job_number", ""),
                "name": r.get("name", ""),
                "service": r.get("service", ""),
                "price": f"£{float(r.get('price', 0) or 0):,.0f}",
                "date": r.get("date", ""),
                "preferred_day": r.get("preferred_day", ""),
                "frequency": r.get("frequency", ""),
                "type": r.get("type", ""),
                "status": r.get("status", ""),
                "paid": r.get("paid", ""),
                "postcode": r.get("postcode", ""),
            })

        self.clients_table.set_data(rows)

    # ------------------------------------------------------------------
    # Refresh
    # ------------------------------------------------------------------
    def refresh(self):
        """Refresh the currently active sub-tab."""
        if self._current_sub:
            self._refresh_subtab(self._current_sub)

    def on_table_update(self, table_name: str):
        """Called when sync updates a specific table."""
        if table_name == "clients" and self._current_sub in ("clients", "subscriptions", "calendar", "planner"):
            self._refresh_subtab(self._current_sub)
        elif table_name == "schedule" and self._current_sub in ("schedule", "calendar", "planner"):
            self._refresh_subtab(self._current_sub)
        elif table_name == "quotes" and self._current_sub == "quotes":
            self._refresh_subtab("quotes")
        elif table_name == "enquiries" and self._current_sub == "enquiries":
            self._refresh_subtab("enquiries")
