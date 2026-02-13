"""
Client Detail Modal — full client view/edit dialog.
"""

import customtkinter as ctk
from .. import theme
from ... import config


class ClientModal(ctk.CTkToplevel):
    """
    Modal window for viewing and editing a client record.
    Mirrors the manager.html client detail panel.
    """

    def __init__(self, parent, client_data: dict, db, sync, api=None,
                 on_save=None, **kwargs):
        super().__init__(parent, **kwargs)

        self.client_data = dict(client_data)  # Copy
        self.db = db
        self.sync = sync
        self.api = api
        self.on_save = on_save
        self._fields = {}

        # Window config
        self.title(f"Client: {client_data.get('name', 'New Client')}")
        self.geometry("600x720")
        self.resizable(False, True)
        self.transient(parent)
        self.grab_set()

        # Center on parent
        self.update_idletasks()
        px = parent.winfo_rootx() + (parent.winfo_width() - 600) // 2
        py = parent.winfo_rooty() + (parent.winfo_height() - 720) // 2
        self.geometry(f"+{px}+{py}")

        self._build_ui()

    def _build_ui(self):
        """Build the modal content."""
        # Scrollable container
        container = ctk.CTkScrollableFrame(
            self,
            fg_color=theme.BG_DARK,
        )
        container.pack(fill="both", expand=True, padx=0, pady=0)

        # ── Header ──
        header = ctk.CTkFrame(container, fg_color=theme.BG_CARD, corner_radius=12)
        header.pack(fill="x", padx=16, pady=(16, 8))

        name = self.client_data.get("name", "")
        initials = "".join(w[0] for w in name.split()[:2]).upper() if name else "?"

        header_inner = ctk.CTkFrame(header, fg_color="transparent")
        header_inner.pack(fill="x", padx=16, pady=12)

        avatar = ctk.CTkLabel(
            header_inner,
            text=initials,
            width=48, height=48,
            fg_color=theme.GREEN_PRIMARY,
            corner_radius=24,
            font=theme.font_bold(18),
            text_color="white",
        )
        avatar.pack(side="left", padx=(0, 12))

        info_frame = ctk.CTkFrame(header_inner, fg_color="transparent")
        info_frame.pack(side="left", fill="x", expand=True)

        ctk.CTkLabel(
            info_frame, text=name or "New Client",
            font=theme.font_bold(16), text_color=theme.TEXT_LIGHT, anchor="w",
        ).pack(fill="x")

        status_text = f"{self.client_data.get('service', '')} — {self.client_data.get('status', 'Pending')}"
        ctk.CTkLabel(
            info_frame, text=status_text,
            font=theme.font(12), text_color=theme.TEXT_DIM, anchor="w",
        ).pack(fill="x")

        # Job number badge
        jn = self.client_data.get("job_number", "")
        if jn:
            ctk.CTkLabel(
                header_inner, text=f"#{jn}",
                font=theme.font_bold(14), text_color=theme.GREEN_LIGHT,
            ).pack(side="right", padx=8)

        # ── Form Fields ──
        form = ctk.CTkFrame(container, fg_color=theme.BG_CARD, corner_radius=12)
        form.pack(fill="x", padx=16, pady=8)
        form.grid_columnconfigure(1, weight=1)

        fields = [
            ("name", "Name", "entry"),
            ("email", "Email", "entry"),
            ("phone", "Phone", "entry"),
            ("postcode", "Postcode", "entry"),
            ("address", "Address", "entry"),
            ("service", "Service", "dropdown", config.SERVICES),
            ("price", "Price (£)", "entry"),
            ("date", "Date", "entry"),
            ("time", "Time", "entry"),
            ("preferred_day", "Preferred Day", "dropdown", config.DAY_OPTIONS),
            ("frequency", "Frequency", "dropdown", config.FREQUENCY_OPTIONS),
            ("type", "Type", "dropdown", config.TYPE_OPTIONS),
            ("status", "Status", "dropdown", config.STATUS_OPTIONS),
            ("paid", "Paid", "dropdown", config.PAID_OPTIONS),
        ]

        for i, field_def in enumerate(fields):
            key = field_def[0]
            label = field_def[1]
            field_type = field_def[2]
            current_val = str(self.client_data.get(key, ""))

            ctk.CTkLabel(
                form, text=label,
                font=theme.font(12), text_color=theme.TEXT_DIM,
                anchor="e",
            ).grid(row=i, column=0, padx=(16, 8), pady=4, sticky="e")

            if field_type == "dropdown" and len(field_def) > 3:
                options = field_def[3]
                var = ctk.StringVar(value=current_val)
                widget = ctk.CTkOptionMenu(
                    form,
                    variable=var,
                    values=options,
                    fg_color=theme.BG_INPUT,
                    button_color=theme.GREEN_ACCENT,
                    button_hover_color=theme.GREEN_DARK,
                    dropdown_fg_color=theme.BG_CARD,
                    corner_radius=8,
                    height=32,
                    font=theme.font(12),
                )
                widget.grid(row=i, column=1, padx=(0, 16), pady=4, sticky="ew")
                self._fields[key] = var
            else:
                entry = theme.create_entry(form, width=300)
                entry.insert(0, current_val)
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
            notes_frame,
            height=80,
            fg_color=theme.BG_INPUT,
            corner_radius=8,
            font=theme.font(12),
        )
        self.notes_box.pack(fill="x", padx=16, pady=(0, 12))
        self.notes_box.insert("1.0", self.client_data.get("notes", ""))

        # ── Quick Actions (Call / Email / Map) ──
        quick_row = ctk.CTkFrame(container, fg_color=theme.BG_CARD, corner_radius=12)
        quick_row.pack(fill="x", padx=16, pady=8)

        ctk.CTkLabel(
            quick_row, text="Quick Actions",
            font=theme.font_bold(13), text_color=theme.TEXT_LIGHT, anchor="w",
        ).pack(fill="x", padx=16, pady=(10, 6))

        qbtns = ctk.CTkFrame(quick_row, fg_color="transparent")
        qbtns.pack(fill="x", padx=16, pady=(0, 10))

        theme.create_outline_button(
            qbtns, "📞 Call",
            command=self._call_client, width=90,
        ).pack(side="left", padx=(0, 6))

        theme.create_outline_button(
            qbtns, "📧 Email",
            command=self._email_client, width=90,
        ).pack(side="left", padx=4)

        theme.create_outline_button(
            qbtns, "📍 Map",
            command=self._open_map, width=90,
        ).pack(side="left", padx=4)

        theme.create_outline_button(
            qbtns, "📸 Photos",
            command=self._open_photos, width=100,
        ).pack(side="left", padx=4)

        theme.create_outline_button(
            qbtns, "🧾 Invoice",
            command=self._create_invoice, width=100,
        ).pack(side="left", padx=4)

        # ── Action Buttons ──
        actions = ctk.CTkFrame(container, fg_color="transparent")
        actions.pack(fill="x", padx=16, pady=(8, 16))

        theme.create_accent_button(
            actions, "💾 Save Changes",
            command=self._save,
            width=150,
        ).pack(side="left", padx=(0, 8))

        ctk.CTkButton(
            actions, text="Cancel", width=80,
            fg_color=theme.BG_CARD, hover_color=theme.RED,
            corner_radius=8, font=theme.font(12),
            command=self.destroy,
        ).pack(side="right")

        # Delete button (only for existing clients)
        if self.client_data.get("id"):
            ctk.CTkButton(
                actions, text="🗑️ Delete", width=90,
                fg_color="#7f1d1d", hover_color=theme.RED,
                text_color="#fca5a5", corner_radius=8,
                font=theme.font(12, "bold"),
                command=self._confirm_delete,
            ).pack(side="right", padx=(0, 8))

    # ------------------------------------------------------------------
    # Actions
    # ------------------------------------------------------------------
    def _save(self):
        """Save the client data back to SQLite + queue sync."""
        for key, widget in self._fields.items():
            if isinstance(widget, ctk.StringVar):
                self.client_data[key] = widget.get()
            elif isinstance(widget, ctk.CTkEntry):
                self.client_data[key] = widget.get().strip()

        self.client_data["notes"] = self.notes_box.get("1.0", "end").strip()

        # Ensure price is numeric
        try:
            self.client_data["price"] = float(self.client_data.get("price", 0))
        except (ValueError, TypeError):
            self.client_data["price"] = 0

        # Save to SQLite
        client_id = self.db.save_client(self.client_data)

        # Queue sync to Sheets
        self.sync.queue_write("update_client", {
            "row": self.client_data.get("sheets_row", ""),
            "name": self.client_data["name"],
            "email": self.client_data["email"],
            "phone": self.client_data["phone"],
            "postcode": self.client_data["postcode"],
            "address": self.client_data.get("address", ""),
            "service": self.client_data["service"],
            "price": self.client_data["price"],
            "date": self.client_data["date"],
            "time": self.client_data.get("time", ""),
            "preferredDay": self.client_data.get("preferred_day", ""),
            "frequency": self.client_data.get("frequency", ""),
            "type": self.client_data["type"],
            "status": self.client_data["status"],
            "paid": self.client_data["paid"],
            "notes": self.client_data.get("notes", ""),
        })

        # Callback
        if self.on_save:
            try:
                self.on_save(self.client_data)
            except TypeError:
                self.on_save()

        self.destroy()

    def _create_invoice(self):
        """Create an invoice pre-filled from this client."""
        from .invoice_modal import InvoiceModal
        from datetime import date

        invoice_data = {
            "invoice_number": "",
            "client_name": self.client_data.get("name", ""),
            "client_email": self.client_data.get("email", ""),
            "amount": self.client_data.get("price", 0),
            "status": "Unpaid",
            "issue_date": date.today().isoformat(),
            "due_date": "",
            "paid_date": "",
            "notes": f"Service: {self.client_data.get('service', '')}",
        }
        InvoiceModal(
            self, invoice_data, self.db, self.sync,
            on_save=self.on_save,
        )

    def _call_client(self):
        """Open the phone dialer for the client's number."""
        import webbrowser
        phone = self.client_data.get("phone", "")
        if phone:
            webbrowser.open(f"tel:{phone}")

    def _email_client(self):
        """Open the default email client."""
        import webbrowser
        email = self.client_data.get("email", "")
        if email:
            webbrowser.open(f"mailto:{email}")

    def _open_map(self):
        """Open Google Maps for the client's address/postcode."""
        import webbrowser
        address = self.client_data.get("address", "")
        postcode = self.client_data.get("postcode", "")
        query = f"{address} {postcode}".strip() or postcode
        if query:
            webbrowser.open(f"https://www.google.com/maps?q={query}")

    def _open_photos(self):
        """Open the photo manager for this client."""
        from .photo_manager import PhotoManager
        PhotoManager(
            self, self.db,
            client_id=self.client_data.get("id"),
            client_name=self.client_data.get("name", "Unknown"),
            job_date=self.client_data.get("date", ""),
            job_number=self.client_data.get("job_number", ""),
        )

    def _confirm_delete(self):
        """Show confirmation dialog before deleting a client."""
        name = self.client_data.get("name", "this client")
        confirm = ctk.CTkToplevel(self)
        confirm.title("Delete Client?")
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
            confirm, text=f"Delete \"{name}\"?",
            font=theme.font_bold(15), text_color=theme.TEXT_LIGHT,
        ).pack(pady=(20, 4))
        ctk.CTkLabel(
            confirm, text="This will remove the client from the Hub and Sheets.",
            font=theme.font(12), text_color=theme.TEXT_DIM,
        ).pack(pady=(0, 16))

        btn_row = ctk.CTkFrame(confirm, fg_color="transparent")
        btn_row.pack(pady=8)

        def do_delete():
            cid = self.client_data.get("id")
            row = self.client_data.get("sheets_row", "")
            if cid:
                self.db.delete_client(cid)
            if row:
                self.sync.queue_write("delete_client", {"row": row})
            confirm.destroy()
            if self.on_save:
                try:
                    self.on_save()
                except TypeError:
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
