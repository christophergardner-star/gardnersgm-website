"""
Quote Detail Modal — view/edit dialog for quotes.
"""

import customtkinter as ctk
from datetime import date, timedelta
from .. import theme
from ... import config


class QuoteModal(ctk.CTkToplevel):
    """Modal window for viewing and editing a quote."""

    def __init__(self, parent, quote_data: dict, db, sync,
                 on_save=None, **kwargs):
        super().__init__(parent, **kwargs)

        self.quote_data = dict(quote_data)
        self.db = db
        self.sync = sync
        self.on_save = on_save
        self._fields = {}

        is_new = not self.quote_data.get("id")
        title = "New Quote" if is_new else f"Quote: {self.quote_data.get('quote_number', '')}"

        self.title(title)
        self.geometry("560x700")
        self.resizable(False, True)
        self.configure(fg_color=theme.BG_DARK)
        self.transient(parent)
        self.grab_set()

        self.update_idletasks()
        px = parent.winfo_rootx() + (parent.winfo_width() - 560) // 2
        py = parent.winfo_rooty() + (parent.winfo_height() - 700) // 2
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

        # ── Pricing ──
        self._section(container, "💰 Pricing")
        price_form = ctk.CTkFrame(container, fg_color=theme.BG_CARD, corner_radius=12)
        price_form.pack(fill="x", padx=16, pady=(0, 8))
        price_form.grid_columnconfigure(1, weight=1)

        price_fields = [
            ("subtotal",         "Subtotal (£)",    "entry"),
            ("discount",         "Discount (£)",    "entry"),
            ("vat",              "VAT (£)",         "entry"),
            ("total",            "Total (£)",       "entry"),
            ("deposit_required", "Deposit (£)",     "entry"),
        ]
        self._build_fields(price_form, price_fields, start_row=0)

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

        # Ensure numeric fields
        for nk in ("subtotal", "discount", "vat", "total", "deposit_required"):
            try:
                self.quote_data[nk] = float(self.quote_data.get(nk, 0) or 0)
            except (ValueError, TypeError):
                self.quote_data[nk] = 0

        self.db.save_quote(self.quote_data)

        self.sync.queue_write("update_quote", {
            "row": self.quote_data.get("sheets_row", ""),
            "quoteNumber": self.quote_data.get("quote_number", ""),
            "clientName": self.quote_data.get("client_name", ""),
            "clientEmail": self.quote_data.get("client_email", ""),
            "clientPhone": self.quote_data.get("client_phone", ""),
            "postcode": self.quote_data.get("postcode", ""),
            "address": self.quote_data.get("address", ""),
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
