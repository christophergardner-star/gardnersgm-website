"""
Invoice Detail Modal — view/edit dialog for invoices.
"""

import customtkinter as ctk
from datetime import date
from .. import theme
from ... import config


class InvoiceModal(ctk.CTkToplevel):
    """Modal window for viewing and editing an invoice."""

    def __init__(self, parent, invoice_data: dict, db, sync,
                 on_save=None, **kwargs):
        super().__init__(parent, **kwargs)

        self.invoice_data = dict(invoice_data)
        self.db = db
        self.sync = sync
        self.on_save = on_save
        self._fields = {}

        is_new = not self.invoice_data.get("id")
        title = "New Invoice" if is_new else f"Invoice: {self.invoice_data.get('invoice_number', '')}"

        self.title(title)
        self.geometry("560x620")
        self.resizable(False, True)
        self.configure(fg_color=theme.BG_DARK)
        self.transient(parent)
        self.grab_set()

        self.update_idletasks()
        px = parent.winfo_rootx() + (parent.winfo_width() - 560) // 2
        py = parent.winfo_rooty() + (parent.winfo_height() - 620) // 2
        self.geometry(f"+{max(px,0)}+{max(py,0)}")

        self._build_ui()

    def _build_ui(self):
        container = ctk.CTkScrollableFrame(self, fg_color=theme.BG_DARK)
        container.pack(fill="both", expand=True)

        # ── Header ──
        header = ctk.CTkFrame(container, fg_color=theme.BG_CARD, corner_radius=12)
        header.pack(fill="x", padx=16, pady=(16, 8))

        inv_num = self.invoice_data.get("invoice_number", "NEW")
        client = self.invoice_data.get("client_name", "")
        status = self.invoice_data.get("status", "Unpaid")

        h_inner = ctk.CTkFrame(header, fg_color="transparent")
        h_inner.pack(fill="x", padx=16, pady=12)

        ctk.CTkLabel(
            h_inner, text="🧾",
            font=theme.font_bold(28), width=48,
        ).pack(side="left", padx=(0, 12))

        info = ctk.CTkFrame(h_inner, fg_color="transparent")
        info.pack(side="left", fill="x", expand=True)

        ctk.CTkLabel(
            info, text=f"Invoice #{inv_num}" if inv_num != "NEW" else "New Invoice",
            font=theme.font_bold(16), text_color=theme.TEXT_LIGHT, anchor="w",
        ).pack(fill="x")

        ctk.CTkLabel(
            info, text=f"{client} — {status}",
            font=theme.font(12), text_color=theme.TEXT_DIM, anchor="w",
        ).pack(fill="x")

        amount = float(self.invoice_data.get("amount", 0) or 0)
        ctk.CTkLabel(
            h_inner, text=f"£{amount:,.2f}",
            font=theme.font_bold(20),
            text_color=theme.GREEN_LIGHT if status == "Paid" else theme.AMBER,
        ).pack(side="right", padx=8)

        # ── Form ──
        form = ctk.CTkFrame(container, fg_color=theme.BG_CARD, corner_radius=12)
        form.pack(fill="x", padx=16, pady=8)
        form.grid_columnconfigure(1, weight=1)

        fields = [
            ("invoice_number", "Invoice #",   "entry"),
            ("client_name",    "Client Name",  "entry"),
            ("client_email",   "Client Email", "entry"),
            ("amount",         "Amount (£)",   "entry"),
            ("status",         "Status",       "dropdown", config.INVOICE_STATUS_OPTIONS),
            ("issue_date",     "Issue Date",   "entry"),
            ("due_date",       "Due Date",     "entry"),
            ("paid_date",      "Paid Date",    "entry"),
        ]

        for i, field_def in enumerate(fields):
            key = field_def[0]
            label = field_def[1]
            ftype = field_def[2]
            current = str(self.invoice_data.get(key, "") or "")

            ctk.CTkLabel(
                form, text=label,
                font=theme.font(12), text_color=theme.TEXT_DIM,
                anchor="e",
            ).grid(row=i, column=0, padx=(16, 8), pady=4, sticky="e")

            if ftype == "dropdown" and len(field_def) > 3:
                var = ctk.StringVar(value=current)
                ctk.CTkOptionMenu(
                    form, variable=var, values=field_def[3],
                    fg_color=theme.BG_INPUT, button_color=theme.GREEN_ACCENT,
                    button_hover_color=theme.GREEN_DARK,
                    dropdown_fg_color=theme.BG_CARD,
                    corner_radius=8, height=32, font=theme.font(12),
                ).grid(row=i, column=1, padx=(0, 16), pady=4, sticky="ew")
                self._fields[key] = var
            else:
                entry = theme.create_entry(form, width=300)
                entry.insert(0, current)
                entry.grid(row=i, column=1, padx=(0, 16), pady=4, sticky="ew")
                self._fields[key] = entry

        # ── Notes ──
        notes_frame = ctk.CTkFrame(container, fg_color=theme.BG_CARD, corner_radius=12)
        notes_frame.pack(fill="x", padx=16, pady=8)

        ctk.CTkLabel(
            notes_frame, text="Notes",
            font=theme.font_bold(13), text_color=theme.TEXT_LIGHT, anchor="w",
        ).pack(fill="x", padx=16, pady=(12, 4))

        self.notes_box = ctk.CTkTextbox(
            notes_frame, height=70,
            fg_color=theme.BG_INPUT, corner_radius=8, font=theme.font(12),
        )
        self.notes_box.pack(fill="x", padx=16, pady=(0, 12))
        self.notes_box.insert("1.0", self.invoice_data.get("notes", "") or "")

        # ── Actions ──
        actions = ctk.CTkFrame(container, fg_color="transparent")
        actions.pack(fill="x", padx=16, pady=(8, 16))

        theme.create_accent_button(
            actions, "💾 Save Invoice",
            command=self._save, width=150,
        ).pack(side="left", padx=(0, 8))

        if self.invoice_data.get("status") != "Paid":
            theme.create_outline_button(
                actions, "✅ Mark Paid",
                command=self._mark_paid, width=120,
            ).pack(side="left", padx=4)

        theme.create_outline_button(
            actions, "📧 Send Invoice",
            command=self._send_invoice_email, width=120,
        ).pack(side="left", padx=4)

        ctk.CTkButton(
            actions, text="Cancel", width=80,
            fg_color=theme.BG_CARD, hover_color=theme.RED,
            corner_radius=8, font=theme.font(12),
            command=self.destroy,
        ).pack(side="right")

        # Delete button (only for existing invoices)
        if self.invoice_data.get("id"):
            ctk.CTkButton(
                actions, text="🗑️ Delete", width=90,
                fg_color="#7f1d1d", hover_color=theme.RED,
                text_color="#fca5a5", corner_radius=8,
                font=theme.font(12, "bold"),
                command=self._confirm_delete,
            ).pack(side="right", padx=(0, 8))

    def _confirm_delete(self):
        inv_num = self.invoice_data.get("invoice_number", "this invoice")
        confirm = ctk.CTkToplevel(self)
        confirm.title("Delete Invoice?")
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
            confirm, text=f"Delete Invoice #{inv_num}?",
            font=theme.font_bold(15), text_color=theme.TEXT_LIGHT,
        ).pack(pady=(20, 4))
        ctk.CTkLabel(
            confirm, text="This will remove the invoice from the Hub and Sheets.",
            font=theme.font(12), text_color=theme.TEXT_DIM,
        ).pack(pady=(0, 16))

        btn_row = ctk.CTkFrame(confirm, fg_color="transparent")
        btn_row.pack(pady=8)

        def do_delete():
            iid = self.invoice_data.get("id")
            row = self.invoice_data.get("sheets_row", "")
            if iid:
                self.db.delete_invoice(iid)
            if row:
                self.sync.queue_write("delete_invoice", {"row": row})
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

    def _save(self):
        """Save the invoice data back to SQLite + queue sync."""
        for key, widget in self._fields.items():
            if isinstance(widget, ctk.StringVar):
                self.invoice_data[key] = widget.get()
            elif isinstance(widget, ctk.CTkEntry):
                self.invoice_data[key] = widget.get().strip()

        self.invoice_data["notes"] = self.notes_box.get("1.0", "end").strip()

        try:
            self.invoice_data["amount"] = float(self.invoice_data.get("amount", 0) or 0)
        except (ValueError, TypeError):
            self.invoice_data["amount"] = 0

        self.db.save_invoice(self.invoice_data)

        self.sync.queue_write("update_invoice", {
            "row": self.invoice_data.get("sheets_row", ""),
            "invoiceNumber": self.invoice_data.get("invoice_number", ""),
            "clientName": self.invoice_data.get("client_name", ""),
            "clientEmail": self.invoice_data.get("client_email", ""),
            "amount": self.invoice_data.get("amount", 0),
            "status": self.invoice_data.get("status", ""),
            "issueDate": self.invoice_data.get("issue_date", ""),
            "dueDate": self.invoice_data.get("due_date", ""),
            "paidDate": self.invoice_data.get("paid_date", ""),
            "notes": self.invoice_data.get("notes", ""),
        })

        if self.on_save:
            self.on_save()
        self.destroy()

    def _send_invoice_email(self):
        """Send this invoice via email to the client."""
        import threading
        client_email = self.invoice_data.get("client_email", "")
        if not client_email:
            return

        inv_num = self.invoice_data.get("invoice_number", "")
        amount = float(self.invoice_data.get("amount", 0) or 0)

        def send():
            try:
                self.sync.queue_write("send_invoice_email", {
                    "invoiceNumber": inv_num,
                    "clientName": self.invoice_data.get("client_name", ""),
                    "clientEmail": client_email,
                    "amount": amount,
                    "dueDate": self.invoice_data.get("due_date", ""),
                    "items": self.invoice_data.get("notes", ""),
                })
            except Exception:
                pass

        threading.Thread(target=send, daemon=True).start()

    def _mark_paid(self):
        """Quick-mark as paid with today's date."""
        self.invoice_data["status"] = "Paid"
        self.invoice_data["paid_date"] = date.today().isoformat()

        # Update the status dropdown if visible
        if "status" in self._fields:
            self._fields["status"].set("Paid")
        if "paid_date" in self._fields:
            w = self._fields["paid_date"]
            if isinstance(w, ctk.CTkEntry):
                w.delete(0, "end")
                w.insert(0, date.today().isoformat())

        self._save()
