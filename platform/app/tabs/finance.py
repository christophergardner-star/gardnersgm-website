"""
Finance Tab — Revenue dashboard, invoices, business costs, savings pots.
Replaces the old HTML finance page with real-time local data.
"""

import customtkinter as ctk
from datetime import date, datetime

from ..ui import theme
from ..ui.components.kpi_card import KPICard
from ..ui.components.data_table import DataTable
from ..ui.components.chart_panel import ChartPanel
from ..ui.components.invoice_modal import InvoiceModal
from ..ui.components.cost_modal import CostModal
from ..ui.components.pot_modal import PotModal
from .. import config


class FinanceTab(ctk.CTkFrame):
    """Finance tab with sub-tab navigation."""

    def __init__(self, parent, db, sync, api, app_window, **kwargs):
        super().__init__(parent, fg_color=theme.BG_DARK, **kwargs)

        self.db = db
        self.sync = sync
        self.api = api
        self.app = app_window

        self._current_sub = None
        self._sub_buttons = {}
        self._sub_frames = {}
        self._kpi_cards = {}

        self.grid_columnconfigure(0, weight=1)
        self.grid_rowconfigure(1, weight=1)

        self._build_sub_tabs()
        self._build_panels()
        self._switch_sub("dashboard")

    # ------------------------------------------------------------------
    # Sub-Tab Navigation
    # ------------------------------------------------------------------
    def _build_sub_tabs(self):
        tab_bar = ctk.CTkFrame(self, fg_color=theme.BG_CARD, height=44, corner_radius=0)
        tab_bar.grid(row=0, column=0, sticky="ew")
        tab_bar.grid_columnconfigure(10, weight=1)

        tabs = [
            ("dashboard",  "📊 Dashboard"),
            ("invoices",   "🧾 Invoices"),
            ("payments",   "💳 Payments"),
            ("costs",      "💸 Costs"),
            ("pots",       "🏦 Savings Pots"),
        ]

        for i, (key, text) in enumerate(tabs):
            btn = ctk.CTkButton(
                tab_bar, text=text, font=theme.font(13),
                fg_color="transparent", hover_color=theme.BG_CARD_HOVER,
                text_color=theme.TEXT_DIM, corner_radius=0,
                height=40, width=140,
                command=lambda k=key: self._switch_sub(k),
            )
            btn.grid(row=0, column=i, padx=1)
            self._sub_buttons[key] = btn

    def _switch_sub(self, key: str):
        if self._current_sub == key:
            return

        for k, btn in self._sub_buttons.items():
            if k == key:
                btn.configure(fg_color=theme.GREEN_PRIMARY, text_color=theme.TEXT_LIGHT)
            else:
                btn.configure(fg_color="transparent", text_color=theme.TEXT_DIM)

        for k, frame in self._sub_frames.items():
            if k == key:
                frame.grid(row=1, column=0, sticky="nsew")
            else:
                frame.grid_forget()

        self._current_sub = key
        self._refresh_subtab(key)

    def _build_panels(self):
        self._build_dashboard_panel()
        self._build_invoices_panel()
        self._build_payments_panel()
        self._build_costs_panel()
        self._build_pots_panel()

    # ------------------------------------------------------------------
    # Dashboard
    # ------------------------------------------------------------------
    def _build_dashboard_panel(self):
        frame = ctk.CTkScrollableFrame(self, fg_color="transparent")
        self._sub_frames["dashboard"] = frame

        # KPI Row
        kpi_frame = ctk.CTkFrame(frame, fg_color="transparent")
        kpi_frame.pack(fill="x", padx=16, pady=(16, 8))
        for i in range(5):
            kpi_frame.grid_columnconfigure(i, weight=1)

        kpis = [
            ("gross_revenue", "💰", "£0", "Gross Revenue (YTD)"),
            ("costs_ytd",     "💸", "£0", "Costs (YTD)"),
            ("net_profit",    "📈", "£0", "Net Profit (YTD)"),
            ("monthly_avg",   "📊", "£0", "Avg Monthly Revenue"),
            ("sub_revenue",   "🔄", "£0", "Subscription Revenue"),
        ]

        for i, (key, icon, default, label) in enumerate(kpis):
            card = KPICard(kpi_frame, icon=icon, value=default, label=label)
            card.grid(row=0, column=i, sticky="nsew", padx=4, pady=4)
            self._kpi_cards[key] = card

        # Charts row
        charts_row = ctk.CTkFrame(frame, fg_color="transparent")
        charts_row.pack(fill="both", expand=True, padx=16, pady=8)
        charts_row.grid_columnconfigure(0, weight=1)
        charts_row.grid_columnconfigure(1, weight=1)

        self.revenue_chart = ChartPanel(charts_row, width=500, height=280)
        self.revenue_chart.grid(row=0, column=0, sticky="nsew", padx=(0, 8))

        self.service_chart = ChartPanel(charts_row, width=400, height=280)
        self.service_chart.grid(row=0, column=1, sticky="nsew", padx=(8, 0))

        # Fund allocation
        alloc_card = ctk.CTkFrame(frame, fg_color=theme.BG_CARD, corner_radius=12)
        alloc_card.pack(fill="x", padx=16, pady=(8, 16))
        alloc_card.grid_columnconfigure(0, weight=1)

        ctk.CTkLabel(
            alloc_card,
            text="💼 Fund Allocation (from Revenue)",
            font=theme.font_bold(14),
            text_color=theme.TEXT_LIGHT,
            anchor="w",
        ).pack(fill="x", padx=16, pady=(12, 8))

        self.alloc_container = ctk.CTkFrame(alloc_card, fg_color="transparent")
        self.alloc_container.pack(fill="x", padx=16, pady=(0, 16))

    def _render_dashboard(self):
        """Render the finance dashboard."""
        stats = self.db.get_revenue_stats()
        ytd = stats.get("ytd", 0)

        # Get total costs
        costs = self.db.get_business_costs()
        total_costs = sum(
            float(c.get("fuel", 0) or 0) + float(c.get("insurance", 0) or 0) +
            float(c.get("tools", 0) or 0) + float(c.get("vehicle", 0) or 0) +
            float(c.get("phone", 0) or 0) + float(c.get("software", 0) or 0) +
            float(c.get("other", 0) or 0)
            for c in costs
        )

        net = ytd - total_costs
        months_elapsed = max(1, date.today().month)
        monthly_avg = ytd / months_elapsed
        sub_revenue = stats.get("subscription_revenue", 0)

        self._kpi_cards["gross_revenue"].set_value(f"£{ytd:,.0f}")
        self._kpi_cards["costs_ytd"].set_value(f"£{total_costs:,.0f}")
        self._kpi_cards["net_profit"].set_value(f"£{net:,.0f}")
        self._kpi_cards["net_profit"].set_color(
            theme.GREEN_LIGHT if net >= 0 else theme.RED
        )
        self._kpi_cards["monthly_avg"].set_value(f"£{monthly_avg:,.0f}")
        self._kpi_cards["sub_revenue"].set_value(f"£{sub_revenue:,.0f}")

        # Revenue by service chart (pie)
        service_data = self.db.get_revenue_by_service()
        if service_data:
            labels = [s["service"] for s in service_data]
            values = [s["revenue"] for s in service_data]
            self.service_chart.pie_chart(labels, values, title="Revenue by Service")
        else:
            self.service_chart.pie_chart(["No data"], [1], title="Revenue by Service")

        # Monthly revenue chart (bar)
        daily = self.db.get_daily_revenue(30)
        if daily:
            # Aggregate into month if enough data, otherwise show daily
            labels = []
            values = []
            for d in daily:
                try:
                    dt = datetime.strptime(d["date"], "%Y-%m-%d")
                    labels.append(dt.strftime("%d/%m"))
                except Exception:
                    labels.append(d["date"][:5])
                values.append(d["revenue"])
            self.revenue_chart.bar_chart(labels, values, title="Revenue — Last 30 Days", ylabel="£")
        else:
            self.revenue_chart.bar_chart(["No data"], [0], title="Revenue — Last 30 Days")

        # Fund allocation
        self._render_fund_allocation(ytd)

    def _render_fund_allocation(self, gross: float):
        """Show the breakdown of how revenue should be allocated."""
        for w in self.alloc_container.winfo_children():
            w.destroy()

        allocations = config.FUND_ALLOCATION

        for i, (name, rate) in enumerate(allocations.items()):
            amount = gross * rate

            row = ctk.CTkFrame(self.alloc_container, fg_color="transparent")
            row.pack(fill="x", pady=2)
            row.grid_columnconfigure(1, weight=1)

            ctk.CTkLabel(
                row, text=name.replace("_", " ").title(),
                font=theme.font(12), text_color=theme.TEXT_DIM,
                anchor="w", width=130,
            ).grid(row=0, column=0, sticky="w")

            # Progress bar
            bar = ctk.CTkProgressBar(
                row, width=200, height=14,
                corner_radius=7,
                fg_color=theme.BG_DARKER,
                progress_color=theme.GREEN_PRIMARY,
            )
            bar.set(rate)
            bar.grid(row=0, column=1, sticky="ew", padx=8)

            ctk.CTkLabel(
                row, text=f"{rate*100:.0f}%",
                font=theme.font(11), text_color=theme.TEXT_DIM, width=40,
            ).grid(row=0, column=2)

            ctk.CTkLabel(
                row, text=f"£{amount:,.0f}",
                font=theme.font_bold(12), text_color=theme.GREEN_LIGHT, width=80,
            ).grid(row=0, column=3, sticky="e")

    # ------------------------------------------------------------------
    # Invoices
    # ------------------------------------------------------------------
    def _build_invoices_panel(self):
        frame = ctk.CTkFrame(self, fg_color="transparent")
        self._sub_frames["invoices"] = frame

        frame.grid_columnconfigure(0, weight=1)
        frame.grid_rowconfigure(1, weight=1)

        # Action bar
        action_bar = ctk.CTkFrame(frame, fg_color="transparent")
        action_bar.grid(row=0, column=0, sticky="ew", padx=12, pady=(12, 4))
        action_bar.grid_columnconfigure(1, weight=1)

        theme.create_accent_button(
            action_bar, "＋ New Invoice",
            command=self._add_invoice, width=130,
        ).grid(row=0, column=0, sticky="w", padx=(0, 8))

        ctk.CTkLabel(
            action_bar, text="🧾 Invoices",
            font=theme.font_bold(15), text_color=theme.TEXT_LIGHT,
        ).grid(row=0, column=0, sticky="w", padx=(140, 0))

        # Status filter
        filter_frame = ctk.CTkFrame(action_bar, fg_color="transparent")
        filter_frame.grid(row=0, column=1, sticky="e")

        ctk.CTkLabel(
            filter_frame, text="Status:", font=theme.font(11),
            text_color=theme.TEXT_DIM,
        ).pack(side="left", padx=(0, 4))

        self.invoice_status_filter = ctk.CTkComboBox(
            filter_frame,
            values=["All", "Unpaid", "Paid", "Overdue", "Void"],
            width=120, font=theme.font(11),
            command=lambda _: self._refresh_subtab("invoices"),
        )
        self.invoice_status_filter.set("All")
        self.invoice_status_filter.pack(side="left", padx=4)

        columns = [
            {"key": "invoice_number", "label": "Invoice #",  "width": 100},
            {"key": "client_name",    "label": "Client",     "width": 180},
            {"key": "amount",         "label": "Amount",      "width": 90},
            {"key": "status",         "label": "Status",      "width": 90},
            {"key": "date",           "label": "Issue Date",  "width": 100},
            {"key": "due_date",       "label": "Due Date",    "width": 100},
        ]

        self.invoices_table = DataTable(
            frame, columns=columns,
            on_double_click=self._open_invoice,
        )
        self.invoices_table.grid(row=1, column=0, sticky="nsew", padx=12, pady=(4, 12))

    def _render_invoices(self):
        status_val = self.invoice_status_filter.get()
        status = status_val if status_val != "All" else None

        invoices = self.db.get_invoices(status=status)

        rows = []
        for inv in invoices:
            rows.append({
                "id": inv.get("id", ""),
                "invoice_number": inv.get("invoice_number", ""),
                "client_name": inv.get("client_name", ""),
                "amount": f"£{float(inv.get('amount', 0) or 0):,.2f}",
                "status": inv.get("status", ""),
                "date": inv.get("date", ""),
                "due_date": inv.get("due_date", ""),
            })

        self.invoices_table.set_data(rows)

    # ------------------------------------------------------------------
    # Payments
    # ------------------------------------------------------------------
    def _build_payments_panel(self):
        frame = ctk.CTkFrame(self, fg_color="transparent")
        self._sub_frames["payments"] = frame

        frame.grid_columnconfigure(0, weight=1)
        frame.grid_rowconfigure(1, weight=1)

        # Action bar with filter
        action_bar = ctk.CTkFrame(frame, fg_color="transparent")
        action_bar.grid(row=0, column=0, sticky="ew", padx=12, pady=(12, 4))
        action_bar.grid_columnconfigure(1, weight=1)

        ctk.CTkLabel(
            action_bar, text="💳 Payment Tracking",
            font=theme.font_bold(15), text_color=theme.TEXT_LIGHT,
        ).grid(row=0, column=0, sticky="w")

        filter_frame = ctk.CTkFrame(action_bar, fg_color="transparent")
        filter_frame.grid(row=0, column=1, sticky="e")

        ctk.CTkLabel(
            filter_frame, text="Status:", font=theme.font(11),
            text_color=theme.TEXT_DIM,
        ).pack(side="left", padx=(0, 4))

        self.payment_status_filter = ctk.CTkComboBox(
            filter_frame,
            values=["All", "Yes", "No", "Deposit", "Refunded"],
            width=120, font=theme.font(11),
            command=lambda _: self._refresh_subtab("payments"),
        )
        self.payment_status_filter.set("All")
        self.payment_status_filter.pack(side="left", padx=4)

        columns = [
            {"key": "job_number",   "label": "Job #",     "width": 70},
            {"key": "client_name",  "label": "Client",    "width": 160},
            {"key": "service",      "label": "Service",   "width": 130},
            {"key": "type",         "label": "Type",      "width": 80},
            {"key": "amount",       "label": "Amount",    "width": 80},
            {"key": "status",       "label": "Paid",      "width": 70},
            {"key": "method",       "label": "Method",    "width": 90},
            {"key": "date",         "label": "Date",      "width": 100},
        ]

        self.payments_table = DataTable(
            frame, columns=columns,
        )
        self.payments_table.grid(row=1, column=0, sticky="nsew", padx=12, pady=(4, 12))

    def _render_payments(self):
        status_val = self.payment_status_filter.get()
        payments = self.db.get_payments(status=status_val)

        rows = []
        for p in payments:
            rows.append({
                "id": p.get("id", ""),
                "job_number": p.get("job_number", ""),
                "client_name": p.get("client_name", ""),
                "service": p.get("service", ""),
                "type": p.get("type", ""),
                "amount": f"£{float(p.get('amount', 0) or 0):,.0f}",
                "status": p.get("status", ""),
                "method": p.get("method", ""),
                "date": p.get("date", ""),
            })

        self.payments_table.set_data(rows)

    # ------------------------------------------------------------------
    # Business Costs
    # ------------------------------------------------------------------
    def _build_costs_panel(self):
        frame = ctk.CTkScrollableFrame(self, fg_color="transparent")
        self._sub_frames["costs"] = frame

        costs_header = ctk.CTkFrame(frame, fg_color="transparent")
        costs_header.pack(fill="x", padx=16, pady=(16, 8))

        ctk.CTkLabel(
            costs_header, text="💸 Business Costs by Month",
            font=theme.font_bold(15), text_color=theme.TEXT_LIGHT,
            anchor="w",
        ).pack(side="left")

        theme.create_accent_button(
            costs_header, "＋ Add Month",
            command=self._add_cost, width=120,
        ).pack(side="right")

        self.costs_container = ctk.CTkFrame(frame, fg_color="transparent")
        self.costs_container.pack(fill="x", padx=16, pady=(0, 16))

    def _render_costs(self):
        costs = self.db.get_business_costs()

        for w in self.costs_container.winfo_children():
            w.destroy()

        if not costs:
            ctk.CTkLabel(
                self.costs_container,
                text="No cost data yet — costs will sync from Google Sheets",
                font=theme.font(12), text_color=theme.TEXT_DIM,
            ).pack(pady=20)
            return

        cost_fields = ["fuel", "insurance", "tools", "vehicle", "phone_cost", "software", "other"]

        # Header row
        header = ctk.CTkFrame(self.costs_container, fg_color=theme.BG_CARD, corner_radius=8)
        header.pack(fill="x", pady=(0, 4))
        header.grid_columnconfigure(0, weight=1)

        labels = ["Month", "Fuel", "Insurance", "Tools", "Vehicle", "Phone", "Software", "Other", "Total", ""]
        for i, label in enumerate(labels):
            ctk.CTkLabel(
                header, text=label,
                font=theme.font_bold(11), text_color=theme.TEXT_LIGHT,
                width=70 if i < len(labels) - 1 else 50, anchor="center",
            ).grid(row=0, column=i, padx=2, pady=8)

        # Data rows
        grand_total = 0
        for idx, c in enumerate(costs):
            row_frame = ctk.CTkFrame(
                self.costs_container,
                fg_color=theme.BG_DARKER if idx % 2 == 0 else theme.BG_CARD_HOVER,
                corner_radius=6,
                cursor="hand2",
            )
            row_frame.pack(fill="x", pady=1)

            ctk.CTkLabel(
                row_frame, text=c.get("month", ""),
                font=theme.font(11), text_color=theme.TEXT_LIGHT,
                width=70, anchor="center",
            ).grid(row=0, column=0, padx=2, pady=6)

            row_total = 0.0
            for j, field in enumerate(cost_fields):
                val = float(c.get(field, 0) or 0)
                row_total += val
                color = theme.RED if val > 0 else theme.TEXT_DIM
                ctk.CTkLabel(
                    row_frame, text=f"£{val:,.0f}" if val else "—",
                    font=theme.font(11), text_color=color,
                    width=70, anchor="center",
                ).grid(row=0, column=j + 1, padx=2, pady=6)

            grand_total += row_total
            ctk.CTkLabel(
                row_frame, text=f"£{row_total:,.0f}",
                font=theme.font_bold(11), text_color=theme.AMBER,
                width=70, anchor="center",
            ).grid(row=0, column=len(cost_fields) + 1, padx=2, pady=6)

            # Edit button per row
            edit_btn = ctk.CTkButton(
                row_frame, text="✏️", width=40, height=26,
                fg_color="transparent", hover_color=theme.GREEN_DARK,
                corner_radius=6, font=theme.font(11),
                command=lambda cost=c: self._edit_cost(cost),
            )
            edit_btn.grid(row=0, column=len(cost_fields) + 2, padx=2, pady=4)

        # Grand total
        total_row = ctk.CTkFrame(self.costs_container, fg_color=theme.BG_CARD, corner_radius=8)
        total_row.pack(fill="x", pady=(8, 0))

        ctk.CTkLabel(
            total_row, text=f"Grand Total: £{grand_total:,.0f}",
            font=theme.font_bold(13), text_color=theme.AMBER,
            anchor="e",
        ).pack(fill="x", padx=16, pady=10)

    # ------------------------------------------------------------------
    # Savings Pots
    # ------------------------------------------------------------------
    def _build_pots_panel(self):
        frame = ctk.CTkScrollableFrame(self, fg_color="transparent")
        self._sub_frames["pots"] = frame

        pots_header = ctk.CTkFrame(frame, fg_color="transparent")
        pots_header.pack(fill="x", padx=16, pady=(16, 8))

        ctk.CTkLabel(
            pots_header, text="🏦 Savings Pots",
            font=theme.font_bold(15), text_color=theme.TEXT_LIGHT,
            anchor="w",
        ).pack(side="left")

        theme.create_accent_button(
            pots_header, "＋ Add Pot",
            command=self._add_pot, width=100,
        ).pack(side="right")

        self.pots_container = ctk.CTkFrame(frame, fg_color="transparent")
        self.pots_container.pack(fill="x", padx=16, pady=(0, 16))

    def _render_pots(self):
        pots = self.db.get_savings_pots()

        for w in self.pots_container.winfo_children():
            w.destroy()

        if not pots:
            ctk.CTkLabel(
                self.pots_container,
                text="No savings pots configured yet",
                font=theme.font(12), text_color=theme.TEXT_DIM,
            ).pack(pady=20)
            return

        for p in pots:
            self._render_pot_card(p)

    def _render_pot_card(self, pot: dict):
        """Render a single savings pot card."""
        card = ctk.CTkFrame(self.pots_container, fg_color=theme.BG_CARD, corner_radius=12)
        card.pack(fill="x", pady=4)
        card.grid_columnconfigure(1, weight=1)

        name = pot.get("name", "Unnamed")
        balance = float(pot.get("balance", 0) or 0)
        target = float(pot.get("target", 0) or 0)
        updated = pot.get("updated_at", "")

        # Icon & name
        icon = "🏦"
        if "tax" in name.lower():
            icon = "📋"
        elif "ni" in name.lower() or "national" in name.lower():
            icon = "🏛️"
        elif "emergency" in name.lower():
            icon = "🚨"
        elif "equip" in name.lower():
            icon = "🔧"
        elif "personal" in name.lower():
            icon = "💶"

        ctk.CTkLabel(
            card, text=f"{icon}  {name}",
            font=theme.font_bold(14), text_color=theme.TEXT_LIGHT,
            anchor="w",
        ).grid(row=0, column=0, columnspan=2, padx=16, pady=(12, 4), sticky="w")

        # Balance
        ctk.CTkLabel(
            card, text=f"£{balance:,.2f}",
            font=theme.font_bold(24), text_color=theme.GREEN_LIGHT,
            anchor="w",
        ).grid(row=1, column=0, padx=16, pady=(0, 4), sticky="w")

        # Target & progress
        if target > 0:
            pct = min(balance / target, 1.0)

            progress_frame = ctk.CTkFrame(card, fg_color="transparent")
            progress_frame.grid(row=2, column=0, columnspan=2, sticky="ew", padx=16, pady=(0, 8))
            progress_frame.grid_columnconfigure(0, weight=1)

            bar = ctk.CTkProgressBar(
                progress_frame, height=10, corner_radius=5,
                fg_color=theme.BG_DARKER,
                progress_color=theme.GREEN_PRIMARY if pct < 1.0 else theme.GREEN_LIGHT,
            )
            bar.set(pct)
            bar.grid(row=0, column=0, sticky="ew", padx=(0, 8))

            ctk.CTkLabel(
                progress_frame,
                text=f"{pct*100:.0f}% of £{target:,.0f}",
                font=theme.font(11), text_color=theme.TEXT_DIM,
            ).grid(row=0, column=1)

        if updated:
            ctk.CTkLabel(
                card, text=f"Updated: {updated}",
                font=theme.font(10), text_color=theme.TEXT_DIM,
                anchor="w",
            ).grid(row=3, column=0, padx=16, pady=(0, 10), sticky="w")

        # Edit button
        theme.create_outline_button(
            card, "✏️ Edit",
            command=lambda p=pot: self._edit_pot(p),
            width=70,
        ).grid(row=0, column=1, rowspan=2, padx=16, pady=12, sticky="ne")

    # ------------------------------------------------------------------
    # Actions
    # ------------------------------------------------------------------
    def _open_invoice(self, values: dict):
        """Open invoice detail modal on double-click."""
        inv_id = values.get("id")
        if inv_id:
            inv = self.db.get_invoice(inv_id)
            if inv:
                InvoiceModal(
                    self, inv, self.db, self.sync,
                    on_save=lambda: self._refresh_subtab("invoices"),
                )

    def _add_invoice(self):
        """Open empty invoice modal."""
        empty = {
            "invoice_number": "",
            "client_name": "",
            "client_email": "",
            "amount": 0,
            "status": "Unpaid",
            "issue_date": date.today().isoformat(),
            "due_date": "",
            "paid_date": "",
            "notes": "",
        }
        InvoiceModal(
            self, empty, self.db, self.sync,
            on_save=lambda: self._refresh_subtab("invoices"),
        )

    def _edit_cost(self, cost_data: dict):
        """Open cost edit modal."""
        CostModal(
            self, cost_data, self.db, self.sync,
            on_save=lambda: self._refresh_subtab("costs"),
        )

    def _add_cost(self):
        """Open empty cost modal for a new month."""
        empty = {"month": "", "notes": ""}
        for f in config.COST_FIELDS:
            empty[f] = 0
        CostModal(
            self, empty, self.db, self.sync,
            on_save=lambda: self._refresh_subtab("costs"),
        )

    def _edit_pot(self, pot_data: dict):
        """Open pot edit modal."""
        PotModal(
            self, pot_data, self.db, self.sync,
            on_save=lambda: self._refresh_subtab("pots"),
        )

    def _add_pot(self):
        """Open empty pot modal."""
        PotModal(
            self, {"name": "", "balance": 0, "target": 0},
            self.db, self.sync,
            on_save=lambda: self._refresh_subtab("pots"),
        )

    # ------------------------------------------------------------------
    # Refresh
    # ------------------------------------------------------------------
    def _refresh_subtab(self, key: str):
        try:
            if key == "dashboard":
                self._render_dashboard()
            elif key == "invoices":
                self._render_invoices()
            elif key == "payments":
                self._render_payments()
            elif key == "costs":
                self._render_costs()
            elif key == "pots":
                self._render_pots()
        except Exception as e:
            import traceback
            traceback.print_exc()

    def refresh(self):
        if self._current_sub:
            self._refresh_subtab(self._current_sub)

    def on_table_update(self, table_name: str):
        if table_name in ("invoices", "clients", "business_costs", "savings_pots"):
            self.refresh()
