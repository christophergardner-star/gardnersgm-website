"""
Quote Detail Modal — enhanced version with auto-pricing service configurator.

Features:
- Full service catalogue picker with tiered options (garden size, hedge count, etc.)
- Add-on extras with checkboxes
- Auto-calculated line prices from pricing engine
- Travel surcharge calculation
- Auto 10% deposit
- Discount % and flat amount support
- Not-VAT-registered notice
"""

import customtkinter as ctk
import json
import logging
import threading
from datetime import date, timedelta
from .. import theme
from ... import config
from ...pricing import (
    SERVICE_CATALOGUE, get_service_keys, display_name_from_key,
    key_from_display_name, calculate_service_price, calculate_travel_surcharge,
    calculate_deposit, pence_to_pounds, build_line_item_from_config,
    estimate_job_cost, DEPOSIT_RATE,
)


class QuoteModal(ctk.CTkToplevel):
    """Modal window for viewing and editing a quote with auto-pricing."""

    def __init__(self, parent, quote_data: dict, db, sync,
                 on_save=None, email_engine=None, **kwargs):
        super().__init__(parent, **kwargs)

        self.quote_data = dict(quote_data)
        self.db = db
        self.sync = sync
        self.on_save = on_save
        self.email_engine = email_engine
        self._fields = {}

        is_new = not self.quote_data.get("id")
        title = "New Quote" if is_new else f"Quote: {self.quote_data.get('quote_number', '')}"

        self.title(title)
        # ── Size to fit usable screen area (respect taskbar + DPI scaling) ──
        self.update_idletasks()
        # wm_maxsize() respects the working area (excludes taskbar) on Windows
        try:
            _, max_h = self.wm_maxsize()
        except Exception:
            max_h = self.winfo_screenheight()
        # Conservative cap: leave 60px breathing room below taskbar, cap at 800
        win_h = min(800, max_h - 60)
        win_h = max(win_h, 500)   # floor
        self.geometry(f"750x{win_h}")
        self.resizable(False, True)
        self.configure(fg_color=theme.BG_DARK)
        self.transient(parent)
        self.grab_set()

        self.update_idletasks()
        px = parent.winfo_rootx() + (parent.winfo_width() - 750) // 2
        py = 10   # pin near top so the footer is always on-screen
        self.geometry(f"+{max(px,0)}+{max(py,0)}")

        self._build_ui()

    # ──────────────────────────────────────────────────────────────
    # UI Construction
    # ──────────────────────────────────────────────────────────────

    def _build_ui(self):
        # Grid layout guarantees the footer is always visible at the bottom
        self.grid_rowconfigure(0, weight=1)
        self.grid_columnconfigure(0, weight=1)

        container = ctk.CTkScrollableFrame(self, fg_color=theme.BG_DARK)
        container.grid(row=0, column=0, sticky="nsew")

        sep = ctk.CTkFrame(self, fg_color=theme.GREEN_PRIMARY, height=2)
        sep.grid(row=1, column=0, sticky="ew")

        self._footer = ctk.CTkFrame(self, fg_color=theme.BG_DARKER)
        self._footer.grid(row=2, column=0, sticky="ew")

        # ── Header ──
        self._build_header(container)

        # ── Client Details ──
        self._section(container, "Client Details")
        client_form = ctk.CTkFrame(container, fg_color=theme.BG_CARD, corner_radius=12)
        client_form.pack(fill="x", padx=16, pady=(0, 8))
        client_form.grid_columnconfigure(1, weight=1)

        client_fields = [
            ("client_name",  "Name",     "entry"),
            ("client_email", "Email",    "entry"),
            ("client_phone", "Phone",    "entry"),
            ("postcode",     "Postcode", "entry"),
            ("address",      "Address",  "entry"),
        ]
        self._build_fields(client_form, client_fields, start_row=0)

        # ── Customer's Garden Info (if available from enquiry) ──
        gd = self.quote_data.get("garden_details", {})
        if gd:
            self._section(container, "🌿 Customer's Garden Info")
            gd_card = ctk.CTkFrame(container, fg_color="#1e3a2f", corner_radius=12)
            gd_card.pack(fill="x", padx=16, pady=(0, 8))
            gd_card.grid_columnconfigure((0, 1, 2), weight=1)

            gd_items = []
            if gd.get("gardenSize_text") or gd.get("gardenSize"):
                gd_items.append(("📐 Size", gd.get("gardenSize_text", "") or gd.get("gardenSize", "")))
            if gd.get("gardenAreas_text") or gd.get("gardenAreas"):
                gd_items.append(("🏠 Areas", gd.get("gardenAreas_text", "") or gd.get("gardenAreas", "")))
            if gd.get("gardenCondition_text") or gd.get("gardenCondition"):
                gd_items.append(("🌱 Condition", gd.get("gardenCondition_text", "") or gd.get("gardenCondition", "")))
            if gd.get("hedgeCount_text") or gd.get("hedgeCount"):
                gd_items.append(("🌳 Hedge Count", gd.get("hedgeCount_text", "") or gd.get("hedgeCount", "")))
            if gd.get("hedgeSize_text") or gd.get("hedgeSize"):
                gd_items.append(("📏 Hedge Size", gd.get("hedgeSize_text", "") or gd.get("hedgeSize", "")))
            if gd.get("clearanceLevel_text") or gd.get("clearanceLevel"):
                gd_items.append(("🧹 Clearance", gd.get("clearanceLevel_text", "") or gd.get("clearanceLevel", "")))
            if gd.get("wasteRemoval_text") or gd.get("wasteRemoval"):
                gd_items.append(("🗑️ Waste Removal", gd.get("wasteRemoval_text", "") or gd.get("wasteRemoval", "")))

            for idx, (label, value) in enumerate(gd_items):
                r, c = divmod(idx, 3)
                cell = ctk.CTkFrame(gd_card, fg_color="transparent")
                cell.grid(row=r, column=c, padx=10, pady=6, sticky="w")
                ctk.CTkLabel(cell, text=label, font=theme.font(10),
                             text_color=theme.TEXT_DIM, anchor="w").pack(anchor="w")
                ctk.CTkLabel(cell, text=value.title() if value else "—",
                             font=theme.font_bold(13),
                             text_color=theme.GREEN_LIGHT, anchor="w").pack(anchor="w")

            if not gd_items:
                ctk.CTkLabel(gd_card, text="No garden details provided",
                             font=theme.font(11), text_color=theme.TEXT_DIM).pack(padx=12, pady=8)

        # ── Quote Details ──
        self._section(container, "Quote Details")
        quote_form = ctk.CTkFrame(container, fg_color=theme.BG_CARD, corner_radius=12)
        quote_form.pack(fill="x", padx=16, pady=(0, 8))
        quote_form.grid_columnconfigure(1, weight=1)

        quote_fields = [
            ("quote_number", "Quote #",      "entry"),
            ("status",       "Status",       "dropdown", config.QUOTE_STATUS_OPTIONS),
            ("date_created", "Date Created", "entry"),
            ("valid_until",  "Valid Until",  "entry"),
        ]
        self._build_fields(quote_form, quote_fields, start_row=0)

        # ── Service Catalogue ──
        self._section(container, "Add a Service")
        svc_card = ctk.CTkFrame(container, fg_color=theme.BG_CARD, corner_radius=12)
        svc_card.pack(fill="x", padx=16, pady=(0, 8))

        # Active services as prominent button grid
        svc_grid = ctk.CTkFrame(svc_card, fg_color="transparent")
        svc_grid.pack(fill="x", padx=12, pady=(12, 4))

        active_keys = get_service_keys(active_only=True)
        cols = min(len(active_keys), 3)
        for c in range(cols):
            svc_grid.grid_columnconfigure(c, weight=1)

        for idx, key in enumerate(active_keys):
            svc = SERVICE_CATALOGUE[key]
            r, c = divmod(idx, cols)
            base_txt = f"from \u00a3{svc['base_price'] / 100:.0f}"
            ctk.CTkButton(
                svc_grid, text=f"{svc['display_name']}\n{base_txt}",
                fg_color=theme.GREEN_PRIMARY, hover_color=theme.GREEN_DARK,
                text_color="white", corner_radius=10,
                font=theme.font_bold(12), height=52,
                command=lambda k=key: self._open_service_options(k, None),
            ).grid(row=r, column=c, padx=4, pady=4, sticky="ew")

        # Secondary buttons row
        extra_btn_row = ctk.CTkFrame(svc_card, fg_color="transparent")
        extra_btn_row.pack(fill="x", padx=12, pady=(2, 10))

        ctk.CTkButton(
            extra_btn_row, text="More Services...", width=120, height=28,
            fg_color="transparent", hover_color=theme.BG_CARD_HOVER,
            border_width=1, border_color=theme.TEXT_DIM,
            text_color=theme.TEXT_DIM, corner_radius=6,
            font=theme.font(11),
            command=self._show_service_configurator,
        ).pack(side="left")

        ctk.CTkButton(
            extra_btn_row, text="+ Custom Item", width=110, height=28,
            fg_color="transparent", hover_color=theme.BG_CARD_HOVER,
            border_width=1, border_color=theme.GREEN_LIGHT,
            text_color=theme.GREEN_LIGHT, corner_radius=6,
            font=theme.font(11),
            command=lambda: self._add_item_row({}),
        ).pack(side="left", padx=8)

        # ── Line Items ──
        self._section(container, "Quote Items")
        items_card = ctk.CTkFrame(container, fg_color=theme.BG_CARD, corner_radius=12)
        items_card.pack(fill="x", padx=16, pady=(0, 8))
        items_card.grid_columnconfigure(0, weight=1)

        # Column headers
        col_header = ctk.CTkFrame(items_card, fg_color="transparent")
        col_header.pack(fill="x", padx=12, pady=(10, 4))
        col_header.grid_columnconfigure(0, weight=1)

        for ci, (text, w) in enumerate([
            ("Description", 0), ("Qty", 50), ("Unit Price", 90), ("Line Total", 80), ("", 30),
        ]):
            lbl_kw = {"text": text, "font": theme.font(10, "bold"),
                       "text_color": theme.TEXT_DIM, "anchor": "w"}
            if w:
                lbl_kw["width"] = w
            ctk.CTkLabel(col_header, **lbl_kw).grid(row=0, column=ci, sticky="w", padx=4)

        # Scrollable items container
        self._items_container = ctk.CTkFrame(items_card, fg_color="transparent")
        self._items_container.pack(fill="x", padx=8, pady=(0, 4))
        self._items_container.grid_columnconfigure(0, weight=1)

        self._item_rows = []

        # Load existing items
        items_json = self.quote_data.get("items", "[]")
        try:
            existing_items = json.loads(items_json) if items_json else []
        except Exception:
            existing_items = []

        if existing_items:
            for item in existing_items:
                self._add_item_row(item)
        else:
            # Empty-state hint
            self._empty_hint = ctk.CTkLabel(
                self._items_container,
                text="\u2191  Select a service above to start building your quote",
                font=theme.font(12), text_color=theme.TEXT_DIM,
            )
            self._empty_hint.pack(pady=16)

        # ── Totals ──
        self._build_totals(items_card)

        # ── Notes ──
        notes_frame = ctk.CTkFrame(container, fg_color=theme.BG_CARD, corner_radius=12)
        notes_frame.pack(fill="x", padx=16, pady=8)

        ctk.CTkLabel(
            notes_frame, text="Notes / Additional Info",
            font=theme.font_bold(13), text_color=theme.TEXT_LIGHT, anchor="w",
        ).pack(fill="x", padx=16, pady=(12, 4))

        self.notes_box = ctk.CTkTextbox(
            notes_frame, height=80,
            fg_color=theme.BG_INPUT, corner_radius=8, font=theme.font(12),
        )
        self.notes_box.pack(fill="x", padx=16, pady=(0, 12))
        self.notes_box.insert("1.0", self.quote_data.get("notes", "") or "")

        # ── Actions (in fixed footer) ──
        self._build_actions(self._footer)

        # Initial totals
        self._recalc_totals()

    def _build_header(self, container):
        """Build the quote header with number, client, status, total."""
        header = ctk.CTkFrame(container, fg_color=theme.BG_CARD, corner_radius=12)
        header.pack(fill="x", padx=16, pady=(16, 8))

        q_num = self.quote_data.get("quote_number", "NEW")
        client = self.quote_data.get("client_name", "")
        status = self.quote_data.get("status", "Draft")

        h_inner = ctk.CTkFrame(header, fg_color="transparent")
        h_inner.pack(fill="x", padx=16, pady=12)

        info = ctk.CTkFrame(h_inner, fg_color="transparent")
        info.pack(side="left", fill="x", expand=True)

        ctk.CTkLabel(
            info, text=f"Quote #{q_num}" if q_num != "NEW" else "New Quote",
            font=theme.font_bold(16), text_color=theme.TEXT_LIGHT, anchor="w",
        ).pack(fill="x")

        ctk.CTkLabel(
            info, text=f"{client} {'(' + status + ')' if status else ''}".strip(),
            font=theme.font(12), text_color=theme.TEXT_DIM, anchor="w",
        ).pack(fill="x")

        total = float(self.quote_data.get("total", 0) or 0)
        colour = theme.GREEN_LIGHT if status == "Accepted" else theme.TEXT_LIGHT
        ctk.CTkLabel(
            h_inner, text=f"\u00a3{total:,.2f}",
            font=theme.font_bold(20), text_color=colour,
        ).pack(side="right", padx=8)

    def _build_totals(self, parent):
        """Build the totals section with subtotal, discount, travel, deposit."""
        totals_frame = ctk.CTkFrame(parent, fg_color=theme.BG_DARKER, corner_radius=8)
        totals_frame.pack(fill="x", padx=12, pady=(4, 12))
        totals_frame.grid_columnconfigure(0, weight=1)

        # Subtotal
        self._subtotal_label = self._totals_row(totals_frame, "Subtotal:", bold=False, pad_top=8)

        # Discount %
        disc_pct_row = ctk.CTkFrame(totals_frame, fg_color="transparent")
        disc_pct_row.pack(fill="x", padx=12, pady=2)
        disc_pct_row.grid_columnconfigure(0, weight=1)
        ctk.CTkLabel(disc_pct_row, text="Discount %:", font=theme.font(12),
                     text_color=theme.TEXT_DIM, anchor="e").grid(row=0, column=0, sticky="e", padx=(0, 8))
        self._discount_pct_entry = theme.create_entry(disc_pct_row, width=60)
        self._discount_pct_entry.insert(0, str(self.quote_data.get("discount_pct", 0) or 0))
        self._discount_pct_entry.grid(row=0, column=1, sticky="e")
        self._discount_pct_entry.bind("<KeyRelease>", lambda e: self._recalc_totals())

        # Discount flat
        disc_flat_row = ctk.CTkFrame(totals_frame, fg_color="transparent")
        disc_flat_row.pack(fill="x", padx=12, pady=2)
        disc_flat_row.grid_columnconfigure(0, weight=1)
        ctk.CTkLabel(disc_flat_row, text="Discount \u00a3:", font=theme.font(12),
                     text_color=theme.TEXT_DIM, anchor="e").grid(row=0, column=0, sticky="e", padx=(0, 8))
        self._discount_flat_entry = theme.create_entry(disc_flat_row, width=60)
        self._discount_flat_entry.insert(0, str(self.quote_data.get("discount", 0) or 0))
        self._discount_flat_entry.grid(row=0, column=1, sticky="e")
        self._discount_flat_entry.bind("<KeyRelease>", lambda e: self._recalc_totals())

        # Discount amount (computed)
        self._discount_label = self._totals_row(totals_frame, "Discount:", bold=False,
                                                colour=theme.RED)

        # Travel surcharge
        travel_row = ctk.CTkFrame(totals_frame, fg_color="transparent")
        travel_row.pack(fill="x", padx=12, pady=2)
        travel_row.grid_columnconfigure(0, weight=1)
        ctk.CTkLabel(travel_row, text="Travel miles:", font=theme.font(12),
                     text_color=theme.TEXT_DIM, anchor="e").grid(row=0, column=0, sticky="e", padx=(0, 8))
        self._travel_entry = theme.create_entry(travel_row, width=60)
        self._travel_entry.insert(0, str(self.quote_data.get("travel_miles", 0) or 0))
        self._travel_entry.grid(row=0, column=1, sticky="e")
        self._travel_entry.bind("<KeyRelease>", lambda e: self._recalc_totals())

        self._travel_label = self._totals_row(totals_frame, "Travel surcharge:", bold=False)

        # VAT notice
        vat_notice = ctk.CTkFrame(totals_frame, fg_color="transparent")
        vat_notice.pack(fill="x", padx=12, pady=2)
        ctk.CTkLabel(vat_notice, text="Not VAT registered \u2014 prices are final",
                     font=theme.font(10), text_color=theme.TEXT_DIM, anchor="e",
                     ).pack(side="right")

        # Separator
        sep = ctk.CTkFrame(totals_frame, fg_color=theme.BG_CARD, height=1)
        sep.pack(fill="x", padx=12, pady=4)

        # Total
        self._total_label = self._totals_row(totals_frame, "Total:", bold=True,
                                             colour=theme.GREEN_LIGHT, font_size=16)

        # Deposit (auto-calculated, editable)
        dep_row = ctk.CTkFrame(totals_frame, fg_color="transparent")
        dep_row.pack(fill="x", padx=12, pady=(2, 4))
        dep_row.grid_columnconfigure(0, weight=1)

        self._auto_deposit_var = ctk.BooleanVar(value=True)
        ctk.CTkCheckBox(
            dep_row, text="Auto 10% deposit",
            variable=self._auto_deposit_var,
            font=theme.font(10), text_color=theme.TEXT_DIM,
            fg_color=theme.GREEN_PRIMARY, hover_color=theme.GREEN_DARK,
            corner_radius=4, height=20, width=20,
            command=self._recalc_totals,
        ).grid(row=0, column=0, sticky="e", padx=(0, 8))

        self._deposit_entry = theme.create_entry(dep_row, width=80)
        self._deposit_entry.insert(0, str(self.quote_data.get("deposit_required", 0) or 0))
        self._deposit_entry.grid(row=0, column=1, sticky="e")
        self._deposit_entry.bind("<KeyRelease>", lambda e: self._on_deposit_edit())

        # Balance label
        self._balance_label = self._totals_row(totals_frame, "Balance due:", bold=False,
                                               pad_bottom=8)

    def _totals_row(self, parent, label_text, bold=False, colour=None,
                    font_size=13, pad_top=2, pad_bottom=2):
        """Create a totals display row and return the value label."""
        row = ctk.CTkFrame(parent, fg_color="transparent")
        row.pack(fill="x", padx=12, pady=(pad_top, pad_bottom))
        row.grid_columnconfigure(0, weight=1)

        text_colour = colour or theme.TEXT_DIM
        f = theme.font_bold(font_size) if bold else theme.font(font_size - 1)
        fv = theme.font_bold(font_size) if bold else theme.font_bold(font_size - 1)

        ctk.CTkLabel(row, text=label_text, font=f,
                     text_color=text_colour, anchor="e").grid(
            row=0, column=0, sticky="e", padx=(0, 8))

        val_label = ctk.CTkLabel(row, text="\u00a30.00", font=fv,
                                 text_color=colour or theme.TEXT_LIGHT,
                                 width=90, anchor="e")
        val_label.grid(row=0, column=1, sticky="e")
        return val_label

    def _build_actions(self, container):
        """Build the action buttons row (fixed footer)."""
        actions = ctk.CTkFrame(container, fg_color="transparent")
        actions.pack(fill="x", padx=16, pady=10, expand=True)

        theme.create_accent_button(
            actions, "Save Quote",
            command=self._save, width=130,
        ).pack(side="left", padx=(0, 8))

        if self.quote_data.get("status") in ("Draft", "Sent", None, ""):
            self._send_btn = ctk.CTkButton(
                actions, text="Send Quote", width=120,
                fg_color="#1d4ed8", hover_color="#2563eb",
                corner_radius=8, font=theme.font(12, "bold"),
                command=self._send_quote,
            )
            self._send_btn.pack(side="left", padx=4)

        if self.quote_data.get("status") not in ("Accepted", "Declined"):
            theme.create_outline_button(
                actions, "Accept",
                command=self._mark_accepted, width=90,
            ).pack(side="left", padx=4)

            theme.create_outline_button(
                actions, "Decline",
                command=self._mark_declined, width=90,
            ).pack(side="left", padx=4)

        ctk.CTkButton(
            actions, text="Cancel", width=80,
            fg_color=theme.BG_CARD, hover_color=theme.RED,
            corner_radius=8, font=theme.font(12),
            command=self.destroy,
        ).pack(side="right")

        if self.quote_data.get("id"):
            ctk.CTkButton(
                actions, text="Delete", width=80,
                fg_color="#7f1d1d", hover_color=theme.RED,
                text_color="#fca5a5", corner_radius=8,
                font=theme.font(12, "bold"),
                command=self._confirm_delete,
            ).pack(side="right", padx=(0, 8))

    # ──────────────────────────────────────────────────────────────
    # Line Items
    # ──────────────────────────────────────────────────────────────

    def _add_item_row(self, item: dict):
        """Add a line-item row to the items builder."""
        # Remove empty-state hint if present
        if hasattr(self, '_empty_hint') and self._empty_hint.winfo_exists():
            self._empty_hint.destroy()

        row_frame = ctk.CTkFrame(self._items_container, fg_color="transparent")
        row_frame.pack(fill="x", pady=2)
        row_frame.grid_columnconfigure(0, weight=1)

        # Description
        desc_entry = theme.create_entry(row_frame, width=200)
        desc_entry.insert(0, item.get("description", item.get("service", "")))
        desc_entry.grid(row=0, column=0, padx=4, pady=2, sticky="ew")

        # Qty
        qty_entry = theme.create_entry(row_frame, width=50)
        qty_entry.insert(0, str(item.get("qty", 1)))
        qty_entry.grid(row=0, column=1, padx=4, pady=2)

        # Unit price (pounds)
        price_entry = theme.create_entry(row_frame, width=90)
        up = item.get("unit_price", item.get("price", item.get("amount", "")))
        price_entry.insert(0, str(up) if up else "")
        price_entry.grid(row=0, column=2, padx=4, pady=2)

        # Line total label
        line_total_label = ctk.CTkLabel(
            row_frame, text="\u00a30.00",
            font=theme.font_bold(12), text_color=theme.GREEN_LIGHT,
            width=80, anchor="e",
        )
        line_total_label.grid(row=0, column=3, padx=4, pady=2, sticky="e")

        # Delete button
        del_btn = ctk.CTkButton(
            row_frame, text="\u2715", width=28, height=28,
            fg_color="transparent", hover_color=theme.RED,
            text_color=theme.TEXT_DIM, corner_radius=6,
            font=theme.font(12, "bold"),
            command=lambda rf=row_frame: self._remove_item_row(rf),
        )
        del_btn.grid(row=0, column=4, padx=(2, 4), pady=2)

        row_data = {
            "frame": row_frame,
            "desc": desc_entry,
            "qty": qty_entry,
            "price": price_entry,
            "line_total": line_total_label,
        }
        self._item_rows.append(row_data)

        qty_entry.bind("<KeyRelease>", lambda e: self._recalc_totals())
        price_entry.bind("<KeyRelease>", lambda e: self._recalc_totals())

        self._recalc_totals()

    def _remove_item_row(self, row_frame):
        """Remove a line-item row."""
        self._item_rows = [r for r in self._item_rows if r["frame"] != row_frame]
        row_frame.destroy()
        self._recalc_totals()

    # ──────────────────────────────────────────────────────────────
    # Service Configurator
    # ──────────────────────────────────────────────────────────────

    def _show_service_configurator(self):
        """Open the full-featured service picker with tiers and extras."""
        picker = ctk.CTkToplevel(self)
        picker.title("Add Service")
        picker.geometry("480x600")
        picker.resizable(False, True)
        picker.configure(fg_color=theme.BG_DARK)
        picker.transient(self)
        picker.grab_set()

        self.update_idletasks()
        px = self.winfo_rootx() + (self.winfo_width() - 480) // 2
        py = self.winfo_rooty() + 60
        picker.geometry(f"+{max(px,0)}+{max(py,0)}")

        ctk.CTkLabel(
            picker, text="Select a Service",
            font=theme.font_bold(15), text_color=theme.TEXT_LIGHT,
        ).pack(pady=(16, 8))

        services_frame = ctk.CTkScrollableFrame(picker, fg_color="transparent")
        services_frame.pack(fill="both", expand=True, padx=12, pady=(0, 12))

        # Active services header
        ctk.CTkLabel(
            services_frame, text="Active Services",
            font=theme.font_bold(11), text_color=theme.GREEN_LIGHT, anchor="w",
        ).pack(fill="x", pady=(4, 2))

        for key in get_service_keys(active_only=True):
            svc = SERVICE_CATALOGUE[key]
            base_txt = f"\u00a3{svc['base_price'] / 100:.0f}+"
            ctk.CTkButton(
                services_frame, text=f"  {svc['display_name']}   {base_txt}",
                fg_color=theme.BG_CARD, hover_color=theme.BG_CARD_HOVER,
                text_color=theme.TEXT_LIGHT, corner_radius=8,
                font=theme.font(12), anchor="w", height=36,
                command=lambda k=key, p=picker: self._open_service_options(k, p),
            ).pack(fill="x", pady=2)

        # Dormant/additional services
        dormant = [k for k in get_service_keys() if not SERVICE_CATALOGUE[k]["active"]]
        if dormant:
            ctk.CTkLabel(
                services_frame, text="Additional Services",
                font=theme.font_bold(11), text_color=theme.AMBER, anchor="w",
            ).pack(fill="x", pady=(12, 2))

            for key in dormant:
                svc = SERVICE_CATALOGUE[key]
                base_txt = f"\u00a3{svc['base_price'] / 100:.0f}+"
                ctk.CTkButton(
                    services_frame, text=f"  {svc['display_name']}   {base_txt}",
                    fg_color=theme.BG_CARD, hover_color=theme.BG_CARD_HOVER,
                    text_color=theme.TEXT_LIGHT, corner_radius=8,
                    font=theme.font(12), anchor="w", height=36,
                    command=lambda k=key, p=picker: self._open_service_options(k, p),
                ).pack(fill="x", pady=2)

    def _open_service_options(self, service_key: str, parent_picker):
        """Open the options/extras configurator for a chosen service."""
        if parent_picker:
            parent_picker.destroy()

        svc = SERVICE_CATALOGUE[service_key]
        cfg_win = ctk.CTkToplevel(self)
        cfg_win.title(f"Configure: {svc['display_name']}")
        cfg_win.geometry("500x620")
        cfg_win.resizable(False, True)
        cfg_win.configure(fg_color=theme.BG_DARK)
        cfg_win.transient(self)
        cfg_win.grab_set()

        self.update_idletasks()
        px = self.winfo_rootx() + (self.winfo_width() - 500) // 2
        py = self.winfo_rooty() + 40
        cfg_win.geometry(f"+{max(px,0)}+{max(py,0)}")

        scroll = ctk.CTkScrollableFrame(cfg_win, fg_color=theme.BG_DARK)
        scroll.pack(fill="both", expand=True)

        # Service name header
        ctk.CTkLabel(
            scroll, text=svc["display_name"],
            font=theme.font_bold(16), text_color=theme.GREEN_LIGHT,
        ).pack(pady=(16, 4))

        ctk.CTkLabel(
            scroll, text=f"Base from \u00a3{svc['base_price'] / 100:.0f}",
            font=theme.font(11), text_color=theme.TEXT_DIM,
        ).pack(pady=(0, 12))

        # ── Options (radio buttons) ──
        option_vars = {}
        extra_vars = {}

        for opt in svc["options"]:
            opt_frame = ctk.CTkFrame(scroll, fg_color=theme.BG_CARD, corner_radius=10)
            opt_frame.pack(fill="x", padx=16, pady=4)

            ctk.CTkLabel(
                opt_frame, text=opt["label"],
                font=theme.font_bold(12), text_color=theme.TEXT_LIGHT, anchor="w",
            ).pack(fill="x", padx=12, pady=(10, 4))

            choice_var = ctk.IntVar(value=opt["choices"][0]["value"])
            option_vars[opt["id"]] = choice_var

            for ch in opt["choices"]:
                price_txt = f"\u00a3{ch['value'] / 100:.0f}" if ch["value"] > 0 else "included"
                ctk.CTkRadioButton(
                    opt_frame, text=f"{ch['text']}  ({price_txt})",
                    variable=choice_var, value=ch["value"],
                    font=theme.font(11), text_color=theme.TEXT_LIGHT,
                    fg_color=theme.GREEN_PRIMARY, hover_color=theme.GREEN_DARK,
                    border_color=theme.TEXT_DIM,
                    command=lambda: self._update_config_preview(
                        service_key, option_vars, extra_vars, preview_label
                    ),
                ).pack(fill="x", padx=16, pady=2)

            ctk.CTkFrame(opt_frame, fg_color="transparent", height=6).pack()

        # ── Extras (checkboxes) ──
        if svc["extras"]:
            extras_frame = ctk.CTkFrame(scroll, fg_color=theme.BG_CARD, corner_radius=10)
            extras_frame.pack(fill="x", padx=16, pady=(8, 4))

            ctk.CTkLabel(
                extras_frame, text="Add-ons",
                font=theme.font_bold(12), text_color=theme.TEXT_LIGHT, anchor="w",
            ).pack(fill="x", padx=12, pady=(10, 4))

            for ext in svc["extras"]:
                var = ctk.BooleanVar(value=ext.get("checked", False))
                extra_vars[ext["id"]] = var

                price_txt = ""
                if ext.get("multiplier"):
                    price_txt = f"(+{int(ext['multiplier'] * 100)}%)"
                elif ext["price"] > 0:
                    price_txt = f"(+\u00a3{ext['price'] / 100:.0f})"
                else:
                    price_txt = "(included)"

                ctk.CTkCheckBox(
                    extras_frame, text=f"{ext['label']}  {price_txt}",
                    variable=var,
                    font=theme.font(11), text_color=theme.TEXT_LIGHT,
                    fg_color=theme.GREEN_PRIMARY, hover_color=theme.GREEN_DARK,
                    corner_radius=4,
                    command=lambda: self._update_config_preview(
                        service_key, option_vars, extra_vars, preview_label
                    ),
                ).pack(fill="x", padx=16, pady=2)

            ctk.CTkFrame(extras_frame, fg_color="transparent", height=6).pack()

        # ── Quantity ──
        qty_frame = ctk.CTkFrame(scroll, fg_color=theme.BG_CARD, corner_radius=10)
        qty_frame.pack(fill="x", padx=16, pady=(8, 4))
        qty_inner = ctk.CTkFrame(qty_frame, fg_color="transparent")
        qty_inner.pack(fill="x", padx=12, pady=10)

        ctk.CTkLabel(
            qty_inner, text="Quantity:",
            font=theme.font_bold(12), text_color=theme.TEXT_LIGHT,
        ).pack(side="left")

        qty_entry = theme.create_entry(qty_inner, width=60)
        qty_entry.insert(0, "1")
        qty_entry.pack(side="right")

        # ── Price Preview ──
        preview_frame = ctk.CTkFrame(scroll, fg_color=theme.BG_DARKER, corner_radius=10)
        preview_frame.pack(fill="x", padx=16, pady=(8, 4))

        preview_label = ctk.CTkLabel(
            preview_frame, text="",
            font=theme.font_bold(14), text_color=theme.GREEN_LIGHT,
        )
        preview_label.pack(pady=12)

        self._update_config_preview(service_key, option_vars, extra_vars, preview_label)

        # ── Margin info ──
        display_name = svc["display_name"]
        cost_info = estimate_job_cost(display_name)
        if cost_info:
            margin_frame = ctk.CTkFrame(scroll, fg_color="transparent")
            margin_frame.pack(fill="x", padx=16, pady=(4, 4))
            ctk.CTkLabel(
                margin_frame,
                text=f"Est. job cost: \u00a3{cost_info['total_cost']:.2f}  |  Avg {cost_info['avg_hours']:.1f}hrs",
                font=theme.font(10), text_color=theme.TEXT_DIM, anchor="w",
            ).pack(fill="x")

        # ── Add to Quote button ──
        ctk.CTkButton(
            scroll, text="Add to Quote", width=200, height=40,
            fg_color=theme.GREEN_PRIMARY, hover_color=theme.GREEN_DARK,
            corner_radius=8, font=theme.font_bold(14),
            command=lambda: self._add_configured_service(
                service_key, option_vars, extra_vars, qty_entry, cfg_win
            ),
        ).pack(pady=(12, 20))

    def _update_config_preview(self, service_key, option_vars, extra_vars, preview_label):
        """Update the live price preview in the service configurator."""
        options = {oid: var.get() for oid, var in option_vars.items()}
        extras = [eid for eid, var in extra_vars.items() if var.get()]
        calc = calculate_service_price(service_key, options, extras)
        preview_label.configure(text=f"Price: \u00a3{calc['total_pounds']:.2f}")

    def _add_configured_service(self, service_key, option_vars, extra_vars,
                                qty_entry, cfg_win):
        """Build a line item from the configurator and add it."""
        options = {oid: var.get() for oid, var in option_vars.items()}
        extras = [eid for eid, var in extra_vars.items() if var.get()]

        try:
            qty = max(1, int(qty_entry.get() or 1))
        except ValueError:
            qty = 1

        item = build_line_item_from_config(service_key, options, extras, qty)
        cfg_win.destroy()
        self._add_item_row(item)

    # ──────────────────────────────────────────────────────────────
    # Totals Calculation
    # ──────────────────────────────────────────────────────────────

    def _recalc_totals(self):
        """Recalculate all totals from line items, discounts, travel, deposit."""
        subtotal = 0.0
        for row in self._item_rows:
            try:
                qty = float(row["qty"].get() or 0)
            except ValueError:
                qty = 0
            try:
                price = float(row["price"].get() or 0)
            except ValueError:
                price = 0
            line_total = qty * price
            row["line_total"].configure(text=f"\u00a3{line_total:,.2f}")
            subtotal += line_total

        self._subtotal_label.configure(text=f"\u00a3{subtotal:,.2f}")

        # Discount
        try:
            disc_pct = float(self._discount_pct_entry.get() or 0)
        except ValueError:
            disc_pct = 0
        try:
            disc_flat = float(self._discount_flat_entry.get() or 0)
        except ValueError:
            disc_flat = 0

        discount_amount = (subtotal * disc_pct / 100.0) + disc_flat
        self._discount_label.configure(
            text=f"-\u00a3{discount_amount:,.2f}" if discount_amount > 0 else "\u00a30.00"
        )

        # Travel surcharge
        try:
            travel_miles = float(self._travel_entry.get() or 0)
        except ValueError:
            travel_miles = 0

        travel = calculate_travel_surcharge(travel_miles)
        travel_pounds = travel["surcharge_pounds"]
        if travel_pounds > 0:
            self._travel_label.configure(
                text=f"+\u00a3{travel_pounds:,.2f} ({travel['extra_miles']:.0f} extra mi)"
            )
        else:
            self._travel_label.configure(text="\u00a30.00 (first 15mi free)")

        # Total
        total = subtotal - discount_amount + travel_pounds
        if total < 0:
            total = 0
        self._total_label.configure(text=f"\u00a3{total:,.2f}")

        # Deposit
        if self._auto_deposit_var.get():
            dep = calculate_deposit(int(total * 100))
            self._deposit_entry.delete(0, "end")
            self._deposit_entry.insert(0, f"{dep['deposit_pounds']:.2f}")

        try:
            deposit_val = float(self._deposit_entry.get() or 0)
        except ValueError:
            deposit_val = 0

        balance = total - deposit_val
        self._balance_label.configure(text=f"\u00a3{balance:,.2f}")

    def _on_deposit_edit(self):
        """When user manually edits deposit, turn off auto-calculation."""
        self._auto_deposit_var.set(False)
        self._recalc_totals()

    # ──────────────────────────────────────────────────────────────
    # Helpers
    # ──────────────────────────────────────────────────────────────

    def _section(self, parent, title: str):
        ctk.CTkLabel(
            parent, text=title,
            font=theme.font_bold(13), text_color=theme.TEXT_LIGHT, anchor="w",
        ).pack(fill="x", padx=16, pady=(12, 4))

    def _build_fields(self, form, fields, start_row=0):
        for i, field_def in enumerate(fields):
            key = field_def[0]
            label = field_def[1]
            ftype = field_def[2]
            current = str(self.quote_data.get(key, "") or "")

            ctk.CTkLabel(
                form, text=label,
                font=theme.font(12), text_color=theme.TEXT_DIM, anchor="e",
            ).grid(row=start_row + i, column=0, padx=(16, 8), pady=4, sticky="e")

            if ftype == "dropdown" and len(field_def) > 3:
                var = ctk.StringVar(value=current)
                ctk.CTkOptionMenu(
                    form, variable=var, values=field_def[3],
                    fg_color=theme.BG_INPUT, button_color=theme.GREEN_ACCENT,
                    button_hover_color=theme.GREEN_DARK,
                    dropdown_fg_color=theme.BG_CARD,
                    corner_radius=8, height=32, font=theme.font(12),
                ).grid(row=start_row + i, column=1, padx=(0, 16), pady=4, sticky="ew")
                self._fields[key] = var
            else:
                entry = theme.create_entry(form, width=300)
                entry.insert(0, current)
                entry.grid(row=start_row + i, column=1, padx=(0, 16), pady=4, sticky="ew")
                self._fields[key] = entry

    def _collect_items(self) -> list[dict]:
        """Collect all line items from the builder."""
        items = []
        for row in self._item_rows:
            desc = row["desc"].get().strip()
            if not desc:
                continue
            try:
                qty = float(row["qty"].get() or 1)
            except ValueError:
                qty = 1
            try:
                unit_price = float(row["price"].get() or 0)
            except ValueError:
                unit_price = 0
            items.append({
                "description": desc,
                "qty": qty,
                "unit_price": unit_price,
                "price": unit_price * qty,
                "total": unit_price * qty,
            })
        return items

    # ──────────────────────────────────────────────────────────────
    # Save / Send / Status
    # ──────────────────────────────────────────────────────────────

    def _ensure_quote_number(self):
        """Auto-generate a quote number if the field is empty."""
        qn = self.quote_data.get("quote_number", "").strip()
        if not qn:
            qn = self.db.generate_quote_number()
            self.quote_data["quote_number"] = qn
            if "quote_number" in self._fields:
                widget = self._fields["quote_number"]
                if isinstance(widget, ctk.CTkEntry):
                    widget.delete(0, "end")
                    widget.insert(0, qn)
                elif isinstance(widget, ctk.StringVar):
                    widget.set(qn)
        return qn

    def _save(self):
        for key, widget in self._fields.items():
            if isinstance(widget, ctk.StringVar):
                self.quote_data[key] = widget.get()
            elif isinstance(widget, ctk.CTkEntry):
                self.quote_data[key] = widget.get().strip()

        self.quote_data["notes"] = self.notes_box.get("1.0", "end").strip()

        items = self._collect_items()
        self.quote_data["items"] = json.dumps(items)

        # Auto-generate quote number if still empty
        self._ensure_quote_number()

        subtotal = sum(i.get("total", 0) for i in items)

        try:
            disc_pct = float(self._discount_pct_entry.get() or 0)
        except ValueError:
            disc_pct = 0
        try:
            disc_flat = float(self._discount_flat_entry.get() or 0)
        except ValueError:
            disc_flat = 0

        discount_amount = (subtotal * disc_pct / 100.0) + disc_flat

        try:
            travel_miles = float(self._travel_entry.get() or 0)
        except ValueError:
            travel_miles = 0
        travel = calculate_travel_surcharge(travel_miles)

        try:
            deposit = float(self._deposit_entry.get() or 0)
        except ValueError:
            deposit = 0

        total = subtotal - discount_amount + travel["surcharge_pounds"]
        if total < 0:
            total = 0

        self.quote_data["subtotal"] = round(subtotal, 2)
        self.quote_data["discount"] = round(discount_amount, 2)
        self.quote_data["vat"] = 0
        self.quote_data["total"] = round(total, 2)
        self.quote_data["deposit_required"] = round(deposit, 2)

        # Auto-generate quote number if empty
        self._ensure_quote_number()

        row_id = self.db.save_quote(self.quote_data)
        if not self.quote_data.get("id"):
            self.quote_data["id"] = row_id

        self.sync.queue_write("update_quote", {
            "row": self.quote_data.get("sheets_row", ""),
            "quoteNumber": self.quote_data.get("quote_number", ""),
            "clientName": self.quote_data.get("client_name", ""),
            "clientEmail": self.quote_data.get("client_email", ""),
            "clientPhone": self.quote_data.get("client_phone", ""),
            "postcode": self.quote_data.get("postcode", ""),
            "address": self.quote_data.get("address", ""),
            "items": self.quote_data.get("items", "[]"),
            "subtotal": self.quote_data.get("subtotal", 0),
            "discount": self.quote_data.get("discount", 0),
            "vat": 0,
            "total": self.quote_data.get("total", 0),
            "status": self.quote_data.get("status", ""),
            "dateCreated": self.quote_data.get("date_created", ""),
            "validUntil": self.quote_data.get("valid_until", ""),
            "depositRequired": self.quote_data.get("deposit_required", 0),
            "notes": self.quote_data.get("notes", ""),
        })

        if self.on_save:
            self.on_save()
        self.destroy()

    def _mark_accepted(self):
        if "status" in self._fields:
            self._fields["status"].set("Accepted")
        self.quote_data["status"] = "Accepted"
        self._save()

    def _mark_declined(self):
        if "status" in self._fields:
            self._fields["status"].set("Declined")
        self.quote_data["status"] = "Declined"
        self._save()

    def _send_quote(self):
        """Save the quote, then email it to the client (non-blocking)."""
        log = logging.getLogger("ggm.quote_modal")

        for key, widget in self._fields.items():
            if isinstance(widget, ctk.StringVar):
                self.quote_data[key] = widget.get()
            elif isinstance(widget, ctk.CTkEntry):
                self.quote_data[key] = widget.get().strip()

        self.quote_data["notes"] = self.notes_box.get("1.0", "end").strip()

        items = self._collect_items()
        self.quote_data["items"] = json.dumps(items)

        email = self.quote_data.get("client_email", "").strip()
        if not email:
            self._show_send_feedback(False, "No email address \u2014 add one before sending.")
            return

        if not items:
            self._show_send_feedback(False, "Add at least one item to the quote before sending.")
            return

        if hasattr(self, "_send_btn"):
            self._send_btn.configure(state="disabled", text="Sending...")

        subtotal = sum(i.get("total", 0) for i in items)
        try:
            disc_pct = float(self._discount_pct_entry.get() or 0)
        except ValueError:
            disc_pct = 0
        try:
            disc_flat = float(self._discount_flat_entry.get() or 0)
        except ValueError:
            disc_flat = 0

        discount_amount = (subtotal * disc_pct / 100.0) + disc_flat

        try:
            travel_miles = float(self._travel_entry.get() or 0)
        except ValueError:
            travel_miles = 0
        travel = calculate_travel_surcharge(travel_miles)

        try:
            deposit = float(self._deposit_entry.get() or 0)
        except ValueError:
            deposit = 0

        total = subtotal - discount_amount + travel["surcharge_pounds"]
        if total < 0:
            total = 0

        self.quote_data["subtotal"] = round(subtotal, 2)
        self.quote_data["discount"] = round(discount_amount, 2)
        self.quote_data["vat"] = 0
        self.quote_data["total"] = round(total, 2)
        self.quote_data["deposit_required"] = round(deposit, 2)

        # Auto-generate quote number if empty
        self._ensure_quote_number()

        # Derive service name from first item for email template
        if not self.quote_data.get("service") and items:
            self.quote_data["service"] = items[0].get("description", "")

        row_id = self.db.save_quote(self.quote_data)
        if not self.quote_data.get("id"):
            self.quote_data["id"] = row_id

        # Run the HTTP send in a background thread so the UI stays responsive
        def _do_send():
            try:
                if self.email_engine:
                    result = self.email_engine.send_quote_email(self.quote_data)
                else:
                    result = self._send_quote_via_gas()
            except Exception as e:
                log.error(f"Quote send thread error: {e}")
                result = {"success": False, "error": str(e)}
            # Schedule UI update back on main thread
            try:
                self.after(0, lambda r=result: self._handle_send_result(r))
            except Exception:
                pass  # modal may have been closed

        threading.Thread(target=_do_send, daemon=True, name="QuoteSend").start()

    def _handle_send_result(self, result: dict):
        """Handle the quote send result on the main UI thread."""
        if result.get("success"):
            self.quote_data["status"] = "Sent"
            if "status" in self._fields:
                self._fields["status"].set("Sent")
            self.db.save_quote(self.quote_data)
            self.sync.queue_write("update_quote", {
                "row": self.quote_data.get("sheets_row", ""),
                "quoteNumber": self.quote_data.get("quote_number", ""),
                "status": "Sent",
            })
            self._show_send_feedback(True, result.get("message", "Quote sent!"))
        else:
            self._show_send_feedback(False, result.get("error", "Send failed"))
            if hasattr(self, "_send_btn"):
                self._send_btn.configure(state="normal", text="Send Quote")

    def _send_quote_via_gas(self) -> dict:
        """Send the quote email via GAS create_quote action.
        
        Uses the GAS create_quote endpoint which:
        1. Generates a unique token for secure accept/decline links
        2. Saves the quote to Sheets
        3. Sends a rich HTML email with proper ?token= links
        4. Dual-writes to Supabase
        """
        import urllib.request
        import urllib.error

        log = logging.getLogger("ggm.quote_modal")

        quote_number = self.quote_data.get("quote_number", "")
        email = self.quote_data.get("client_email", "")
        name = self.quote_data.get("client_name", "")
        items = self._collect_items()
        items_json = json.dumps(items) if isinstance(items, list) else items

        try:
            payload = json.dumps({
                "action": "create_quote",
                "name": name,
                "email": email,
                "phone": self.quote_data.get("client_phone", ""),
                "address": self.quote_data.get("address", ""),
                "postcode": self.quote_data.get("postcode", ""),
                "title": self.quote_data.get("service", "Custom Quote"),
                "lineItems": items_json,
                "subtotal": float(self.quote_data.get("subtotal", 0)),
                "discountPct": float(self.quote_data.get("discount_pct", 0)),
                "discountAmt": float(self.quote_data.get("discount", 0)),
                "vatAmt": 0,
                "grandTotal": float(self.quote_data.get("total", 0)),
                "depositRequired": bool(self.quote_data.get("deposit_required")),
                "validDays": 30,
                "notes": self.quote_data.get("notes", ""),
                "sendNow": True,
            })

            log.info(f"Sending quote {quote_number} to {email} via GAS create_quote...")
            url = config.SHEETS_WEBHOOK
            req = urllib.request.Request(
                url,
                data=payload.encode("utf-8"),
                headers={"Content-Type": "text/plain"},
            )
            resp = urllib.request.urlopen(req, timeout=45)
            body = resp.read().decode()
            log.info(f"GAS create_quote response: {body[:500]}")
            result_data = json.loads(body)

            if result_data.get("status") == "success":
                gas_quote_id = result_data.get("quoteId", quote_number)
                gas_token = result_data.get("token", "")

                # Update local DB with the GAS-assigned quote ID and token
                if gas_quote_id and gas_quote_id != quote_number:
                    self.quote_data["quote_number"] = gas_quote_id
                if gas_token:
                    self.quote_data["token"] = gas_token

                # Log email in local tracking
                try:
                    self.db.log_email(
                        client_id=0, client_name=name,
                        client_email=email, email_type="quote_sent",
                        subject=f"Your Quote from Gardners GM — {gas_quote_id}",
                        status="sent",
                        template_used="gas_create_quote",
                        notes=gas_quote_id,
                    )
                except Exception:
                    pass  # Non-critical
                return {"success": True, "message": f"Quote {gas_quote_id} emailed to {name}"}
            else:
                return {
                    "success": False,
                    "error": result_data.get("error", "GAS create_quote failed"),
                }
        except Exception as e:
            log.error(f"GAS create_quote failed: {e}")
            return {"success": False, "error": f"GAS create_quote failed: {e}"}

    def _show_send_feedback(self, success: bool, message: str):
        """Show a brief feedback popup after send attempt."""
        popup = ctk.CTkToplevel(self)
        popup.title("Quote Sent" if success else "Send Failed")
        popup.geometry("360x140")
        popup.resizable(False, False)
        popup.configure(fg_color=theme.BG_DARK)
        popup.transient(self)
        popup.grab_set()

        self.update_idletasks()
        px = self.winfo_rootx() + (self.winfo_width() - 360) // 2
        py = self.winfo_rooty() + (self.winfo_height() - 140) // 2
        popup.geometry(f"+{max(px,0)}+{max(py,0)}")

        colour = theme.GREEN_LIGHT if success else theme.RED

        ctk.CTkLabel(
            popup, text=message,
            font=theme.font_bold(14), text_color=colour,
            wraplength=320,
        ).pack(pady=(24, 12))

        def close():
            popup.destroy()
            if success:
                if self.on_save:
                    self.on_save()
                self.destroy()

        ctk.CTkButton(
            popup, text="OK", width=80, height=32,
            fg_color=theme.GREEN_PRIMARY if success else theme.BG_CARD,
            hover_color=theme.GREEN_DARK if success else theme.BG_CARD_HOVER,
            corner_radius=8, font=theme.font(12),
            command=close,
        ).pack()

    def _confirm_delete(self):
        q_num = self.quote_data.get("quote_number", "this quote")
        confirm = ctk.CTkToplevel(self)
        confirm.title("Delete Quote?")
        confirm.geometry("360x160")
        confirm.resizable(False, False)
        confirm.configure(fg_color=theme.BG_DARK)
        confirm.transient(self)
        confirm.grab_set()

        self.update_idletasks()
        cx = self.winfo_rootx() + (self.winfo_width() - 360) // 2
        cy = self.winfo_rooty() + (self.winfo_height() - 160) // 2
        confirm.geometry(f"+{max(cx,0)}+{max(cy,0)}")

        ctk.CTkLabel(
            confirm, text=f"Delete Quote #{q_num}?",
            font=theme.font_bold(15), text_color=theme.TEXT_LIGHT,
        ).pack(pady=(20, 4))
        ctk.CTkLabel(
            confirm, text="This will remove the quote from the Hub and Sheets.",
            font=theme.font(12), text_color=theme.TEXT_DIM,
        ).pack(pady=(0, 16))

        btn_row = ctk.CTkFrame(confirm, fg_color="transparent")
        btn_row.pack(pady=8)

        def do_delete():
            qid = self.quote_data.get("id")
            row = self.quote_data.get("sheets_row", "")
            if qid:
                self.db.delete_quote(qid)
            if row:
                self.sync.queue_write("delete_quote", {"row": row})
            confirm.destroy()
            if self.on_save:
                self.on_save()
            self.destroy()

        ctk.CTkButton(
            btn_row, text="Delete", width=100, height=36,
            fg_color=theme.RED, hover_color="#b91c1c",
            corner_radius=8, font=theme.font(12, "bold"),
            command=do_delete,
        ).pack(side="left", padx=8)

        ctk.CTkButton(
            btn_row, text="Cancel", width=80, height=36,
            fg_color=theme.BG_CARD, hover_color=theme.BG_CARD_HOVER,
            corner_radius=8, font=theme.font(12),
            command=confirm.destroy,
        ).pack(side="left", padx=8)
