"""
Quote Detail Modal — view/edit dialog for quotes with line-item builder.
"""

import customtkinter as ctk
import json
from datetime import date, timedelta
from .. import theme
from ... import config


class QuoteModal(ctk.CTkToplevel):
    """Modal window for viewing and editing a quote."""

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
        self.geometry("680x820")
        self.resizable(False, True)
        self.configure(fg_color=theme.BG_DARK)
        self.transient(parent)
        self.grab_set()

        self.update_idletasks()
        px = parent.winfo_rootx() + (parent.winfo_width() - 680) // 2
        py = parent.winfo_rooty() + (parent.winfo_height() - 820) // 2
        self.geometry(f"+{max(px,0)}+{max(py,0)}")

        self._build_ui()

    def _build_ui(self):
        container = ctk.CTkScrollableFrame(self, fg_color=theme.BG_DARK)
        container.pack(fill="both", expand=True)

        # ── Header ──
        header = ctk.CTkFrame(container, fg_color=theme.BG_CARD, corner_radius=12)
        header.pack(fill="x", padx=16, pady=(16, 8))

        q_num = self.quote_data.get("quote_number", "NEW")
        client = self.quote_data.get("client_name", "")
        status = self.quote_data.get("status", "Draft")

        h_inner = ctk.CTkFrame(header, fg_color="transparent")
        h_inner.pack(fill="x", padx=16, pady=12)

        ctk.CTkLabel(
            h_inner, text="📝",
            font=theme.font_bold(28), width=48,
        ).pack(side="left", padx=(0, 12))

        info = ctk.CTkFrame(h_inner, fg_color="transparent")
        info.pack(side="left", fill="x", expand=True)

        ctk.CTkLabel(
            info, text=f"Quote #{q_num}" if q_num != "NEW" else "New Quote",
            font=theme.font_bold(16), text_color=theme.TEXT_LIGHT, anchor="w",
        ).pack(fill="x")

        ctk.CTkLabel(
            info, text=f"{client} — {status}",
            font=theme.font(12), text_color=theme.TEXT_DIM, anchor="w",
        ).pack(fill="x")

        total = float(self.quote_data.get("total", 0) or 0)
        ctk.CTkLabel(
            h_inner, text=f"£{total:,.2f}",
            font=theme.font_bold(20),
            text_color=theme.GREEN_LIGHT if status == "Accepted" else theme.TEXT_LIGHT,
        ).pack(side="right", padx=8)

        # ── Client Details ──
        self._section(container, "👤 Client Details")
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

        # ── Quote Details ──
        self._section(container, "📋 Quote Details")
        quote_form = ctk.CTkFrame(container, fg_color=theme.BG_CARD, corner_radius=12)
        quote_form.pack(fill="x", padx=16, pady=(0, 8))
        quote_form.grid_columnconfigure(1, weight=1)

        quote_fields = [
            ("quote_number",     "Quote #",    "entry"),
            ("status",           "Status",     "dropdown", config.QUOTE_STATUS_OPTIONS),
            ("date_created",     "Date Created", "entry"),
            ("valid_until",      "Valid Until",  "entry"),
        ]
        self._build_fields(quote_form, quote_fields, start_row=0)

        # ── Line Items ──
        self._section(container, "📦 Quote Items")
        items_card = ctk.CTkFrame(container, fg_color=theme.BG_CARD, corner_radius=12)
        items_card.pack(fill="x", padx=16, pady=(0, 8))
        items_card.grid_columnconfigure(0, weight=1)

        # Column headers
        col_header = ctk.CTkFrame(items_card, fg_color="transparent")
        col_header.pack(fill="x", padx=12, pady=(10, 4))
        col_header.grid_columnconfigure(0, weight=1)

        for ci, (text, w) in enumerate([
            ("Description", 0), ("Qty", 50), ("Unit Price (£)", 100), ("Line Total", 80), ("", 30),
        ]):
            lbl_kw = {"text": text, "font": theme.font(10, "bold"), "text_color": theme.TEXT_DIM, "anchor": "w"}
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
            # Start with one empty row
            self._add_item_row({})

        # Add item button
        add_btn_row = ctk.CTkFrame(items_card, fg_color="transparent")
        add_btn_row.pack(fill="x", padx=12, pady=(4, 6))

        ctk.CTkButton(
            add_btn_row, text="➕ Add Item", width=110, height=28,
            fg_color="transparent", hover_color=theme.BG_CARD_HOVER,
            border_width=1, border_color=theme.GREEN_LIGHT,
            text_color=theme.GREEN_LIGHT, corner_radius=6,
            font=theme.font(11, "bold"),
            command=lambda: self._add_item_row({}),
        ).pack(side="left")

        # Service quick-add dropdown
        ctk.CTkButton(
            add_btn_row, text="🔧 Add Service", width=110, height=28,
            fg_color="transparent", hover_color=theme.BG_CARD_HOVER,
            border_width=1, border_color=theme.AMBER,
            text_color=theme.AMBER, corner_radius=6,
            font=theme.font(11, "bold"),
            command=self._show_service_picker,
        ).pack(side="left", padx=8)

        # Totals section
        totals_frame = ctk.CTkFrame(items_card, fg_color=theme.BG_DARKER, corner_radius=8)
        totals_frame.pack(fill="x", padx=12, pady=(4, 12))
        totals_frame.grid_columnconfigure(0, weight=1)

        # Subtotal
        st_row = ctk.CTkFrame(totals_frame, fg_color="transparent")
        st_row.pack(fill="x", padx=12, pady=(8, 2))
        st_row.grid_columnconfigure(0, weight=1)
        ctk.CTkLabel(st_row, text="Subtotal:", font=theme.font(12), text_color=theme.TEXT_DIM, anchor="e").grid(row=0, column=0, sticky="e", padx=(0, 8))
        self._subtotal_label = ctk.CTkLabel(st_row, text="£0.00", font=theme.font_bold(13), text_color=theme.TEXT_LIGHT, width=90, anchor="e")
        self._subtotal_label.grid(row=0, column=1, sticky="e")

        # Discount
        disc_row = ctk.CTkFrame(totals_frame, fg_color="transparent")
        disc_row.pack(fill="x", padx=12, pady=2)
        disc_row.grid_columnconfigure(0, weight=1)
        ctk.CTkLabel(disc_row, text="Discount (£):", font=theme.font(12), text_color=theme.TEXT_DIM, anchor="e").grid(row=0, column=0, sticky="e", padx=(0, 8))
        self._discount_entry = theme.create_entry(disc_row, width=90)
        self._discount_entry.insert(0, str(self.quote_data.get("discount", 0) or 0))
        self._discount_entry.grid(row=0, column=1, sticky="e")
        self._discount_entry.bind("<KeyRelease>", lambda e: self._recalc_totals())

        # VAT
        vat_row = ctk.CTkFrame(totals_frame, fg_color="transparent")
        vat_row.pack(fill="x", padx=12, pady=2)
        vat_row.grid_columnconfigure(0, weight=1)
        ctk.CTkLabel(vat_row, text="VAT (£):", font=theme.font(12), text_color=theme.TEXT_DIM, anchor="e").grid(row=0, column=0, sticky="e", padx=(0, 8))
        self._vat_entry = theme.create_entry(vat_row, width=90)
        self._vat_entry.insert(0, str(self.quote_data.get("vat", 0) or 0))
        self._vat_entry.grid(row=0, column=1, sticky="e")
        self._vat_entry.bind("<KeyRelease>", lambda e: self._recalc_totals())

        # Total
        total_row = ctk.CTkFrame(totals_frame, fg_color="transparent")
        total_row.pack(fill="x", padx=12, pady=(2, 4))
        total_row.grid_columnconfigure(0, weight=1)
        ctk.CTkLabel(total_row, text="Total:", font=theme.font_bold(14), text_color=theme.GREEN_LIGHT, anchor="e").grid(row=0, column=0, sticky="e", padx=(0, 8))
        self._total_label = ctk.CTkLabel(total_row, text="£0.00", font=theme.font_bold(16), text_color=theme.GREEN_LIGHT, width=90, anchor="e")
        self._total_label.grid(row=0, column=1, sticky="e")

        # Deposit
        dep_row = ctk.CTkFrame(totals_frame, fg_color="transparent")
        dep_row.pack(fill="x", padx=12, pady=(2, 8))
        dep_row.grid_columnconfigure(0, weight=1)
        ctk.CTkLabel(dep_row, text="Deposit (£):", font=theme.font(12), text_color=theme.TEXT_DIM, anchor="e").grid(row=0, column=0, sticky="e", padx=(0, 8))
        self._deposit_entry = theme.create_entry(dep_row, width=90)
        self._deposit_entry.insert(0, str(self.quote_data.get("deposit_required", 0) or 0))
        self._deposit_entry.grid(row=0, column=1, sticky="e")

        # Recalculate initial totals
        self._recalc_totals()

        # ── Notes ──
        notes_frame = ctk.CTkFrame(container, fg_color=theme.BG_CARD, corner_radius=12)
        notes_frame.pack(fill="x", padx=16, pady=8)

        ctk.CTkLabel(
            notes_frame, text="Notes / Items Description",
            font=theme.font_bold(13), text_color=theme.TEXT_LIGHT, anchor="w",
        ).pack(fill="x", padx=16, pady=(12, 4))

        self.notes_box = ctk.CTkTextbox(
            notes_frame, height=80,
            fg_color=theme.BG_INPUT, corner_radius=8, font=theme.font(12),
        )
        self.notes_box.pack(fill="x", padx=16, pady=(0, 12))
        self.notes_box.insert("1.0", self.quote_data.get("notes", "") or "")

        # ── Actions ──
        actions = ctk.CTkFrame(container, fg_color="transparent")
        actions.pack(fill="x", padx=16, pady=(8, 16))

        theme.create_accent_button(
            actions, "💾 Save Quote",
            command=self._save, width=140,
        ).pack(side="left", padx=(0, 8))

        # Send Quote email button — only when email_engine available
        # and quote is in a sendable state
        if self.email_engine and self.quote_data.get("status") in (
            "Draft", "Sent", None, ""
        ):
            self._send_btn = ctk.CTkButton(
                actions, text="📧 Send Quote", width=130,
                fg_color="#1d4ed8", hover_color="#2563eb",
                corner_radius=8, font=theme.font(12, "bold"),
                command=self._send_quote,
            )
            self._send_btn.pack(side="left", padx=4)

        if self.quote_data.get("status") not in ("Accepted", "Declined"):
            theme.create_outline_button(
                actions, "✅ Accept",
                command=self._mark_accepted, width=100,
            ).pack(side="left", padx=4)

            theme.create_outline_button(
                actions, "❌ Decline",
                command=self._mark_declined, width=100,
            ).pack(side="left", padx=4)

        ctk.CTkButton(
            actions, text="Cancel", width=80,
            fg_color=theme.BG_CARD, hover_color=theme.RED,
            corner_radius=8, font=theme.font(12),
            command=self.destroy,
        ).pack(side="right")

        # Delete button (only for existing quotes)
        if self.quote_data.get("id"):
            ctk.CTkButton(
                actions, text="🗑️ Delete", width=90,
                fg_color="#7f1d1d", hover_color=theme.RED,
                text_color="#fca5a5", corner_radius=8,
                font=theme.font(12, "bold"),
                command=self._confirm_delete,
            ).pack(side="right", padx=(0, 8))

    def _add_item_row(self, item: dict):
        """Add a line-item row to the items builder."""
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

        # Unit price
        price_entry = theme.create_entry(row_frame, width=100)
        price_entry.insert(0, str(item.get("unit_price", item.get("price", item.get("amount", "")))))
        price_entry.grid(row=0, column=2, padx=4, pady=2)

        # Line total (computed label)
        line_total_label = ctk.CTkLabel(
            row_frame, text="£0.00",
            font=theme.font_bold(12), text_color=theme.GREEN_LIGHT,
            width=80, anchor="e",
        )
        line_total_label.grid(row=0, column=3, padx=4, pady=2, sticky="e")

        # Delete button
        del_btn = ctk.CTkButton(
            row_frame, text="✕", width=28, height=28,
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

        # Bind recalc on key release
        qty_entry.bind("<KeyRelease>", lambda e: self._recalc_totals())
        price_entry.bind("<KeyRelease>", lambda e: self._recalc_totals())

        # Calculate initial line total
        self._recalc_totals()

    def _remove_item_row(self, row_frame):
        """Remove a line-item row."""
        self._item_rows = [r for r in self._item_rows if r["frame"] != row_frame]
        row_frame.destroy()
        self._recalc_totals()

    def _recalc_totals(self):
        """Recalculate subtotal, discount, VAT, total from line items."""
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
            row["line_total"].configure(text=f"£{line_total:,.2f}")
            subtotal += line_total

        self._subtotal_label.configure(text=f"£{subtotal:,.2f}")

        try:
            discount = float(self._discount_entry.get() or 0)
        except ValueError:
            discount = 0
        try:
            vat = float(self._vat_entry.get() or 0)
        except ValueError:
            vat = 0

        total = subtotal - discount + vat
        self._total_label.configure(text=f"£{total:,.2f}")

    def _show_service_picker(self):
        """Show a dropdown to pick a standard GGM service."""
        picker = ctk.CTkToplevel(self)
        picker.title("Add Service")
        picker.geometry("320x420")
        picker.resizable(False, False)
        picker.configure(fg_color=theme.BG_DARK)
        picker.transient(self)
        picker.grab_set()

        self.update_idletasks()
        px = self.winfo_rootx() + (self.winfo_width() - 320) // 2
        py = self.winfo_rooty() + 100
        picker.geometry(f"+{max(px,0)}+{max(py,0)}")

        ctk.CTkLabel(
            picker, text="Select a Service",
            font=theme.font_bold(14), text_color=theme.TEXT_LIGHT,
        ).pack(pady=(16, 12))

        services_frame = ctk.CTkScrollableFrame(picker, fg_color="transparent")
        services_frame.pack(fill="both", expand=True, padx=12, pady=(0, 12))

        for service in config.SERVICES:
            ctk.CTkButton(
                services_frame, text=f"🔧 {service}",
                fg_color=theme.BG_CARD, hover_color=theme.BG_CARD_HOVER,
                text_color=theme.TEXT_LIGHT, corner_radius=8,
                font=theme.font(12), anchor="w", height=36,
                command=lambda s=service, p=picker: self._pick_service(s, p),
            ).pack(fill="x", pady=2)

    def _pick_service(self, service_name: str, picker):
        """Add a service line item and close the picker."""
        picker.destroy()
        self._add_item_row({"description": service_name, "qty": 1, "unit_price": ""})

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
            quote_number = self.quote_data.get("quote_number", "")
            if qid:
                self.db.delete_quote(qid)
            if quote_number:
                self.sync.queue_write("delete_quote", {"quote_id": quote_number})
            confirm.destroy()
            if self.on_save:
                self.on_save()
            self.destroy()

        ctk.CTkButton(
            btn_row, text="🗑️ Delete", width=100, height=36,
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

    def _save(self):
        for key, widget in self._fields.items():
            if isinstance(widget, ctk.StringVar):
                self.quote_data[key] = widget.get()
            elif isinstance(widget, ctk.CTkEntry):
                self.quote_data[key] = widget.get().strip()

        self.quote_data["notes"] = self.notes_box.get("1.0", "end").strip()

        # Collect line items
        items = self._collect_items()
        self.quote_data["items"] = json.dumps(items)

        # Calculate totals from items
        subtotal = sum(i.get("total", 0) for i in items)
        try:
            discount = float(self._discount_entry.get() or 0)
        except ValueError:
            discount = 0
        try:
            vat = float(self._vat_entry.get() or 0)
        except ValueError:
            vat = 0
        try:
            deposit = float(self._deposit_entry.get() or 0)
        except ValueError:
            deposit = 0

        self.quote_data["subtotal"] = subtotal
        self.quote_data["discount"] = discount
        self.quote_data["vat"] = vat
        self.quote_data["total"] = subtotal - discount + vat
        self.quote_data["deposit_required"] = deposit

        self.db.save_quote(self.quote_data)

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
            "vat": self.quote_data.get("vat", 0),
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
        """Save the quote, then email it to the client."""
        # Collect latest field values first
        for key, widget in self._fields.items():
            if isinstance(widget, ctk.StringVar):
                self.quote_data[key] = widget.get()
            elif isinstance(widget, ctk.CTkEntry):
                self.quote_data[key] = widget.get().strip()
        self.quote_data["notes"] = self.notes_box.get("1.0", "end").strip()

        # Collect line items
        items = self._collect_items()
        self.quote_data["items"] = json.dumps(items)

        email = self.quote_data.get("client_email", "").strip()
        if not email:
            self._show_send_feedback(False, "No email address — add one before sending.")
            return

        if not items:
            self._show_send_feedback(False, "Add at least one item to the quote before sending.")
            return

        # Disable button while sending
        if hasattr(self, "_send_btn"):
            self._send_btn.configure(state="disabled", text="Sending…")

        # Calculate totals from items
        subtotal = sum(i.get("total", 0) for i in items)
        try:
            discount = float(self._discount_entry.get() or 0)
        except ValueError:
            discount = 0
        try:
            vat = float(self._vat_entry.get() or 0)
        except ValueError:
            vat = 0
        try:
            deposit = float(self._deposit_entry.get() or 0)
        except ValueError:
            deposit = 0

        self.quote_data["subtotal"] = subtotal
        self.quote_data["discount"] = discount
        self.quote_data["vat"] = vat
        self.quote_data["total"] = subtotal - discount + vat
        self.quote_data["deposit_required"] = deposit

        self.db.save_quote(self.quote_data)

        # Send the email
        result = self.email_engine.send_quote_email(self.quote_data)

        if result.get("success"):
            # Update status to Sent
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
                self._send_btn.configure(state="normal", text="📧 Send Quote")

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
        icon = "✅" if success else "⚠️"

        ctk.CTkLabel(
            popup, text=f"{icon}  {message}",
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
