"""
Client Detail Modal — full client view/edit dialog.
"""

import customtkinter as ctk
from datetime import date, timedelta
from .. import theme
from ... import config

try:
    from tkcalendar import Calendar as _TkCalendar
    HAS_TKCALENDAR = True
except ImportError:
    HAS_TKCALENDAR = False

# Time slots from 07:00 to 18:00 in 30-min intervals
TIME_SLOTS = [f"{h:02d}:{m:02d}" for h in range(7, 18) for m in (0, 30)] + ["18:00"]


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
        self._original_status = str(client_data.get("status", ""))

        # Window config
        self.title(f"Client: {client_data.get('name', 'New Client')}")
        self.update_idletasks()
        try:
            _, max_h = self.wm_maxsize()
        except Exception:
            max_h = self.winfo_screenheight()
        win_h = min(700, max_h - 60)
        win_h = max(win_h, 400)
        self.geometry(f"600x{win_h}")
        self.resizable(False, True)
        self.configure(fg_color=theme.BG_DARK)
        self.transient(parent)
        self.grab_set()

        # Pin near top so footer is always on-screen
        self.update_idletasks()
        px = parent.winfo_rootx() + (parent.winfo_width() - 600) // 2
        py = 10
        self.geometry(f"+{max(px,0)}+{max(py,0)}")

        self._build_ui()

    # ------------------------------------------------------------------
    # Calendar popup helper
    # ------------------------------------------------------------------
    def _open_calendar(self, entry_widget):
        """Open a calendar popup to select a date."""
        if not HAS_TKCALENDAR:
            return  # Fall back to manual entry

        popup = ctk.CTkToplevel(self)
        popup.title("Select Date")
        popup.geometry("320x320")
        popup.resizable(False, False)
        popup.configure(fg_color=theme.BG_DARK)
        popup.transient(self)
        popup.grab_set()

        # Position near the entry
        popup.update_idletasks()
        x = entry_widget.winfo_rootx()
        y = entry_widget.winfo_rooty() + entry_widget.winfo_height() + 4
        popup.geometry(f"+{x}+{y}")

        # Parse existing date
        current = entry_widget.get().strip()
        try:
            parts = current.split("-")
            year, month, day = int(parts[0]), int(parts[1]), int(parts[2])
        except (ValueError, IndexError):
            today = date.today()
            year, month, day = today.year, today.month, today.day

        cal = _TkCalendar(
            popup, selectmode="day",
            year=year, month=month, day=day,
            background=theme.BG_CARD,
            foreground="white",
            headersbackground=theme.GREEN_PRIMARY,
            headersforeground="white",
            selectbackground=theme.GREEN_LIGHT,
            selectforeground="black",
            normalbackground=theme.BG_DARK,
            normalforeground="white",
            weekendbackground=theme.BG_DARKER,
            weekendforeground="#aaa",
            othermonthbackground=theme.BG_DARKER,
            othermonthforeground="#555",
            bordercolor=theme.GREEN_PRIMARY,
            date_pattern="yyyy-mm-dd",
            font=("Segoe UI", 11),
        )
        cal.pack(padx=10, pady=(10, 5), fill="both", expand=True)

        def select_date():
            entry_widget.delete(0, "end")
            entry_widget.insert(0, cal.get_date())
            popup.destroy()

        theme.create_accent_button(
            popup, "\u2705 Select",
            command=select_date, width=120,
        ).pack(pady=(5, 10))

    # ------------------------------------------------------------------
    # UI build
    # ------------------------------------------------------------------
    def _build_ui(self):
        """Build the modal content."""
        # Grid layout: row 0=scrollable content, row 1=separator, row 2=footer
        self.grid_rowconfigure(0, weight=1)
        self.grid_columnconfigure(0, weight=1)

        container = ctk.CTkScrollableFrame(
            self,
            fg_color=theme.BG_DARK,
        )
        container.grid(row=0, column=0, sticky="nsew")

        sep = ctk.CTkFrame(self, fg_color=theme.GREEN_PRIMARY, height=2)
        sep.grid(row=1, column=0, sticky="ew")

        self._footer = ctk.CTkFrame(self, fg_color=theme.BG_DARKER)
        self._footer.grid(row=2, column=0, sticky="ew")

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

        status_text = f"{self.client_data.get('service', '')} \u2014 {self.client_data.get('status', 'Pending')}"
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

        type_options = config.TYPE_OPTIONS + ["quote-accepted", "Website", "Enquiry"]

        fields = [
            ("name", "Name", "entry"),
            ("email", "Email", "entry"),
            ("phone", "Phone", "entry"),
            ("postcode", "Postcode", "entry"),
            ("address", "Address", "entry"),
            ("service", "Service", "dropdown", config.SERVICES),
            ("price", "Price (\u00a3)", "entry"),
            ("date", "Date", "date_picker"),
            ("time", "Time", "time_picker"),
            ("preferred_day", "Preferred Day", "dropdown", config.DAY_OPTIONS),
            ("frequency", "Frequency", "dropdown", config.FREQUENCY_OPTIONS),
            ("type", "Type", "dropdown", type_options),
            ("status", "Status", "dropdown", config.STATUS_OPTIONS),
            ("paid", "Paid", "dropdown", config.PAID_OPTIONS),
            ("waste_collection", "Waste", "dropdown", config.WASTE_OPTIONS),
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

            if field_type == "date_picker":
                # Date entry with calendar popup button
                date_frame = ctk.CTkFrame(form, fg_color="transparent")
                date_frame.grid(row=i, column=1, padx=(0, 16), pady=4, sticky="ew")
                date_frame.grid_columnconfigure(0, weight=1)

                entry = theme.create_entry(date_frame, width=260)
                entry.insert(0, current_val)
                entry.grid(row=0, column=0, sticky="ew")

                cal_btn = ctk.CTkButton(
                    date_frame, text="\U0001f4c5", width=36, height=32,
                    fg_color=theme.GREEN_ACCENT,
                    hover_color=theme.GREEN_PRIMARY,
                    corner_radius=8,
                    font=theme.font(14),
                    command=lambda e=entry: self._open_calendar(e),
                )
                cal_btn.grid(row=0, column=1, padx=(4, 0))
                self._fields[key] = entry

            elif field_type == "time_picker":
                # Time dropdown with 30-min slots
                var = ctk.StringVar(
                    value=current_val if current_val in TIME_SLOTS
                    else (TIME_SLOTS[0] if not current_val else current_val)
                )
                widget = ctk.CTkOptionMenu(
                    form,
                    variable=var,
                    values=TIME_SLOTS,
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

            elif field_type == "dropdown" and len(field_def) > 3:
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

        # ── Payment / Deposit Info Panel ──
        payment_type = str(self.client_data.get("payment_type", ""))
        deposit_amt = float(self.client_data.get("deposit_amount", 0) or 0)
        paid_status = str(self.client_data.get("paid", ""))
        total_price = float(self.client_data.get("price", 0) or 0)

        # Parse deposit from payment_type if not stored yet
        if deposit_amt <= 0 and payment_type:
            import re
            m = re.search(r"Deposit\s*\(\u00a3([\d.]+)\)", payment_type)
            if m:
                deposit_amt = float(m.group(1))

        is_deposit_job = (
            deposit_amt > 0
            or paid_status in ("Deposit Paid", "Deposit", "Balance Due")
            or "Deposit" in payment_type
        )

        if is_deposit_job:
            if deposit_amt <= 0 and total_price > 0:
                deposit_amt = round(total_price * 0.10, 2)
            outstanding = round(max(total_price - deposit_amt, 0), 2)

            dep_frame = ctk.CTkFrame(container, fg_color="#1a2e1a", corner_radius=12,
                                     border_width=1, border_color=theme.GREEN_PRIMARY)
            dep_frame.pack(fill="x", padx=16, pady=8)

            ctk.CTkLabel(
                dep_frame, text="\U0001f4b3 Payment Breakdown",
                font=theme.font_bold(13), text_color=theme.GREEN_LIGHT, anchor="w",
            ).pack(fill="x", padx=16, pady=(10, 4))

            info_text = (
                f"Total Price:  \u00a3{total_price:.2f}\n"
                f"Deposit Paid:  \u00a3{deposit_amt:.2f}\n"
                f"Outstanding:  \u00a3{outstanding:.2f}"
            )
            if paid_status == "Balance Due":
                info_text += "\n\u26a0\ufe0f  Invoice sent — awaiting payment"
            elif paid_status in ("Deposit Paid", "Deposit"):
                info_text += "\n\u2139\ufe0f  Final invoice due on job completion"

            ctk.CTkLabel(
                dep_frame, text=info_text,
                font=theme.font(12), text_color=theme.TEXT_LIGHT,
                anchor="w", justify="left",
            ).pack(fill="x", padx=16, pady=(0, 10))

            # Store for use in _save() and _create_invoice()
            self._deposit_amount = deposit_amt
            self._outstanding_balance = outstanding
        else:
            self._deposit_amount = 0.0
            self._outstanding_balance = total_price

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
            qbtns, "\U0001f4de Call",
            command=self._call_client, width=90,
        ).pack(side="left", padx=(0, 6))

        theme.create_outline_button(
            qbtns, "\U0001f4e7 Email",
            command=self._email_client, width=90,
        ).pack(side="left", padx=4)

        theme.create_outline_button(
            qbtns, "\U0001f4cd Map",
            command=self._open_map, width=90,
        ).pack(side="left", padx=4)

        theme.create_outline_button(
            qbtns, "\U0001f4f8 Photos",
            command=self._open_photos, width=100,
        ).pack(side="left", padx=4)

        theme.create_outline_button(
            qbtns, "\U0001f9fe Invoice",
            command=self._create_invoice, width=100,
        ).pack(side="left", padx=4)

        # Row 2: Cancel / Reschedule / Refund
        qbtns2 = ctk.CTkFrame(quick_row, fg_color="transparent")
        qbtns2.pack(fill="x", padx=16, pady=(0, 10))

        status = self.client_data.get("status", "")
        paid = self.client_data.get("paid", "")

        if status not in ("Cancelled", "Complete", "Completed"):
            ctk.CTkButton(
                qbtns2, text="\u274c Cancel Booking", width=120, height=28,
                fg_color="transparent", hover_color=theme.RED,
                border_width=1, border_color=theme.RED,
                text_color=theme.RED, corner_radius=6,
                font=theme.font(11),
                command=self._cancel_booking,
            ).pack(side="left", padx=(0, 6))

            ctk.CTkButton(
                qbtns2, text="\U0001f4c5 Reschedule", width=110, height=28,
                fg_color="transparent", hover_color=theme.BG_CARD,
                border_width=1, border_color=theme.AMBER,
                text_color=theme.AMBER, corner_radius=6,
                font=theme.font(11),
                command=self._reschedule_booking,
            ).pack(side="left", padx=4)

        if paid in ("Yes", "Deposit", "Deposit Paid", "Balance Due"):
            ctk.CTkButton(
                qbtns2, text="\U0001f4b8 Refund", width=90, height=28,
                fg_color="transparent", hover_color=theme.RED,
                border_width=1, border_color=theme.AMBER,
                text_color=theme.AMBER, corner_radius=6,
                font=theme.font(11),
                command=self._refund_payment,
            ).pack(side="left", padx=4)

        # ── Action Buttons (fixed footer) ──
        actions = ctk.CTkFrame(self._footer, fg_color="transparent")
        actions.pack(fill="x", padx=16, pady=10)

        theme.create_accent_button(
            actions, "\U0001f4be Save Changes",
            command=self._save,
            width=150,
        ).pack(side="left", padx=(0, 8))

        # ── Confirm Appointment button ──
        # Only show when status is NOT already Confirmed/Completed/In Progress/Cancelled
        if status not in ("Confirmed", "Completed", "In Progress", "Cancelled"):
            ctk.CTkButton(
                actions, text="\u2705 Confirm Appointment", width=170, height=36,
                fg_color=theme.GREEN_PRIMARY,
                hover_color=theme.GREEN_LIGHT,
                text_color="white",
                corner_radius=8,
                font=theme.font(12, "bold"),
                command=self._confirm_appointment,
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
                actions, text="\U0001f5d1\ufe0f Delete", width=90,
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

        # ── Balance warning when completing a deposit-only job ──
        new_status = self.client_data.get("status", "")
        old_status = self._original_status
        deposit = getattr(self, "_deposit_amount", 0)
        outstanding = getattr(self, "_outstanding_balance", 0)

        if (new_status == "Completed" and old_status != "Completed"
                and deposit > 0 and outstanding > 0):
            # Show confirmation with outstanding balance info
            from tkinter import messagebox
            proceed = messagebox.askyesno(
                "Outstanding Balance",
                f"This client paid a deposit of \u00a3{deposit:.2f}.\n\n"
                f"Outstanding balance: \u00a3{outstanding:.2f}\n\n"
                f"Marking as Completed will auto-generate a final\n"
                f"Stripe invoice for \u00a3{outstanding:.2f} and email\n"
                f"it to the customer.\n\n"
                f"Continue?",
                parent=self,
            )
            if not proceed:
                return

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
            "wasteCollection": self.client_data.get("waste_collection", "Not Set"),
        })

        # Callback
        if self.on_save:
            try:
                self.on_save(self.client_data)
            except TypeError:
                self.on_save()

        self.destroy()

    # ------------------------------------------------------------------
    # Confirm Appointment
    # ------------------------------------------------------------------
    def _confirm_appointment(self):
        """Show confirmation dialog and confirm the appointment."""
        # Gather current field values
        data = {}
        for key, widget in self._fields.items():
            if isinstance(widget, ctk.StringVar):
                data[key] = widget.get()
            elif isinstance(widget, ctk.CTkEntry):
                data[key] = widget.get().strip()
        data["notes"] = self.notes_box.get("1.0", "end").strip()
        data["job_number"] = self.client_data.get("job_number", "")
        data["sheets_row"] = self.client_data.get("sheets_row", "")
        data["id"] = self.client_data.get("id")

        name = data.get("name", "Unknown")
        service = data.get("service", "")
        dt = data.get("date", "")
        tm = data.get("time", "")
        price = data.get("price", "")
        address = data.get("address", "")
        postcode = data.get("postcode", "")

        confirm = ctk.CTkToplevel(self)
        confirm.title("Confirm Appointment")
        confirm.geometry("440x340")
        confirm.resizable(False, False)
        confirm.configure(fg_color=theme.BG_DARK)
        confirm.transient(self)
        confirm.grab_set()

        self.update_idletasks()
        cx = self.winfo_rootx() + (self.winfo_width() - 440) // 2
        cy = self.winfo_rooty() + (self.winfo_height() - 340) // 2
        confirm.geometry(f"+{max(cx,0)}+{max(cy,0)}")

        ctk.CTkLabel(
            confirm, text="\u2705 Confirm Appointment?",
            font=theme.font_bold(16), text_color=theme.TEXT_LIGHT,
        ).pack(pady=(16, 8))

        # Summary card
        summary = ctk.CTkFrame(confirm, fg_color=theme.BG_CARD, corner_radius=10)
        summary.pack(fill="x", padx=20, pady=4)

        lines = [
            ("Client", name),
            ("Service", service),
            ("Date", dt),
            ("Time", tm),
            ("Price", f"\u00a3{price}" if price else ""),
            ("Address", f"{address}, {postcode}".strip(", ")),
        ]
        for lbl, val in lines:
            row_f = ctk.CTkFrame(summary, fg_color="transparent")
            row_f.pack(fill="x", padx=12, pady=2)
            ctk.CTkLabel(
                row_f, text=f"{lbl}:", font=theme.font(12),
                text_color=theme.TEXT_DIM, width=70, anchor="e",
            ).pack(side="left")
            ctk.CTkLabel(
                row_f, text=val, font=theme.font(12),
                text_color=theme.TEXT_LIGHT, anchor="w",
            ).pack(side="left", padx=(8, 0))

        ctk.CTkLabel(
            confirm,
            text="This will mark the booking as Confirmed and\nsend a confirmation email to the client.",
            font=theme.font(11), text_color=theme.TEXT_DIM, justify="center",
        ).pack(pady=(8, 4))

        # Feedback label (hidden initially)
        feedback_lbl = ctk.CTkLabel(
            confirm, text="", font=theme.font(12), text_color=theme.GREEN_LIGHT,
        )
        feedback_lbl.pack(pady=(0, 2))

        btn_row = ctk.CTkFrame(confirm, fg_color="transparent")
        btn_row.pack(pady=8)

        def do_confirm():
            import threading

            # Update all fields into client_data
            for key, widget in self._fields.items():
                if isinstance(widget, ctk.StringVar):
                    self.client_data[key] = widget.get()
                elif isinstance(widget, ctk.CTkEntry):
                    self.client_data[key] = widget.get().strip()
            self.client_data["notes"] = self.notes_box.get("1.0", "end").strip()

            # a. Set status to Confirmed
            self.client_data["status"] = "Confirmed"
            if "status" in self._fields and isinstance(self._fields["status"], ctk.StringVar):
                self._fields["status"].set("Confirmed")

            # Ensure price is numeric
            try:
                self.client_data["price"] = float(self.client_data.get("price", 0))
            except (ValueError, TypeError):
                self.client_data["price"] = 0

            # b. Save to SQLite
            self.db.save_client(self.client_data)

            # c. Queue sync to Google Sheets
            self.sync.queue_write("update_client", {
                "row": self.client_data.get("sheets_row", ""),
                "name": self.client_data.get("name", ""),
                "email": self.client_data.get("email", ""),
                "phone": self.client_data.get("phone", ""),
                "postcode": self.client_data.get("postcode", ""),
                "address": self.client_data.get("address", ""),
                "service": self.client_data.get("service", ""),
                "price": self.client_data.get("price", 0),
                "date": self.client_data.get("date", ""),
                "time": self.client_data.get("time", ""),
                "preferredDay": self.client_data.get("preferred_day", ""),
                "frequency": self.client_data.get("frequency", ""),
                "type": self.client_data.get("type", ""),
                "status": "Confirmed",
                "paid": self.client_data.get("paid", ""),
                "notes": self.client_data.get("notes", ""),
                "wasteCollection": self.client_data.get("waste_collection", "Not Set"),
            })

            # d. Send booking confirmation email via GAS (background)
            if self.api:
                def send_confirmation():
                    try:
                        self.api.post("send_booking_confirmation", {
                            "name": self.client_data.get("name", ""),
                            "email": self.client_data.get("email", ""),
                            "service": self.client_data.get("service", ""),
                            "date": self.client_data.get("date", ""),
                            "time": self.client_data.get("time", ""),
                            "price": self.client_data.get("price", ""),
                            "address": self.client_data.get("address", ""),
                            "postcode": self.client_data.get("postcode", ""),
                            "jobNumber": self.client_data.get("job_number", ""),
                            "type": "booking",
                            "paymentType": "pay-later",
                        })
                    except Exception:
                        pass
                threading.Thread(target=send_confirmation, daemon=True).start()

                # e. Send Telegram notification
                msg = (
                    f"\u2705 Booking CONFIRMED: {self.client_data.get('name', '')}\n"
                    f"Service: {self.client_data.get('service', '')}\n"
                    f"Date: {self.client_data.get('date', '')} {self.client_data.get('time', '')}\n"
                    f"Price: \u00a3{self.client_data.get('price', '')}"
                )
                threading.Thread(target=self.api.send_telegram, args=(msg,), daemon=True).start()

            # f. Show success feedback
            feedback_lbl.configure(text="\u2705 Appointment confirmed! Email sent.")

            # g. Close after brief delay and refresh
            def close_and_refresh():
                confirm.destroy()
                if self.on_save:
                    try:
                        self.on_save(self.client_data)
                    except TypeError:
                        self.on_save()
                self.destroy()

            confirm.after(1200, close_and_refresh)

        ctk.CTkButton(
            btn_row, text="\u2705 Confirm", width=130, height=36,
            fg_color=theme.GREEN_PRIMARY, hover_color=theme.GREEN_LIGHT,
            corner_radius=8, font=theme.font(12, "bold"),
            text_color="white",
            command=do_confirm,
        ).pack(side="left", padx=8)

        ctk.CTkButton(
            btn_row, text="Cancel", width=80, height=36,
            fg_color=theme.BG_CARD, hover_color=theme.BG_CARD_HOVER,
            corner_radius=8, font=theme.font(12),
            command=confirm.destroy,
        ).pack(side="left", padx=8)

    # ------------------------------------------------------------------
    # Invoice / Quick actions
    # ------------------------------------------------------------------
    def _create_invoice(self):
        """Create an invoice pre-filled from this client, with deposit deducted if applicable."""
        from .invoice_modal import InvoiceModal

        total_price = float(self.client_data.get("price", 0) or 0)
        deposit = getattr(self, "_deposit_amount", 0)
        invoice_amount = round(max(total_price - deposit, 0), 2) if deposit > 0 else total_price
        notes_parts = [f"Service: {self.client_data.get('service', '')}"]
        if deposit > 0:
            notes_parts.append(f"Deposit \u00a3{deposit:.2f} already paid (deducted)")

        invoice_data = {
            "invoice_number": "",
            "client_name": self.client_data.get("name", ""),
            "client_email": self.client_data.get("email", ""),
            "amount": invoice_amount,
            "status": "Unpaid",
            "issue_date": date.today().isoformat(),
            "due_date": "",
            "paid_date": "",
            "notes": " | ".join(notes_parts),
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

    # ------------------------------------------------------------------
    # Cancel booking
    # ------------------------------------------------------------------
    def _cancel_booking(self):
        """Cancel this booking — update status + notify via GAS."""
        name = self.client_data.get("name", "this booking")
        confirm = ctk.CTkToplevel(self)
        confirm.title("Cancel Booking?")
        confirm.geometry("400x200")
        confirm.resizable(False, False)
        confirm.configure(fg_color=theme.BG_DARK)
        confirm.transient(self)
        confirm.grab_set()

        self.update_idletasks()
        cx = self.winfo_rootx() + (self.winfo_width() - 400) // 2
        cy = self.winfo_rooty() + (self.winfo_height() - 200) // 2
        confirm.geometry(f"+{max(cx,0)}+{max(cy,0)}")

        ctk.CTkLabel(
            confirm, text=f"Cancel booking for {name}?",
            font=theme.font_bold(15), text_color=theme.TEXT_LIGHT,
        ).pack(pady=(16, 4))

        ctk.CTkLabel(
            confirm, text="Reason (optional):",
            font=theme.font(12), text_color=theme.TEXT_DIM,
        ).pack(pady=(4, 2))

        reason_entry = theme.create_entry(confirm, width=340)
        reason_entry.pack(pady=(0, 12))

        btn_row = ctk.CTkFrame(confirm, fg_color="transparent")
        btn_row.pack(pady=8)

        def do_cancel():
            import threading
            reason = reason_entry.get().strip()
            self.client_data["status"] = "Cancelled"
            self.db.save_client(self.client_data)
            self.sync.queue_write("cancel_booking", {
                "row": self.client_data.get("sheets_row", ""),
                "name": self.client_data.get("name", ""),
                "email": self.client_data.get("email", ""),
                "service": self.client_data.get("service", ""),
                "date": self.client_data.get("date", ""),
                "reason": reason,
            })
            if self.api:
                msg = f"\u274c Booking CANCELLED: {name}\nService: {self.client_data.get('service', '')}\nDate: {self.client_data.get('date', '')}"
                if reason:
                    msg += f"\nReason: {reason}"
                threading.Thread(target=self.api.send_telegram, args=(msg,), daemon=True).start()
            confirm.destroy()
            if self.on_save:
                try:
                    self.on_save(self.client_data)
                except TypeError:
                    self.on_save()
            self.destroy()

        ctk.CTkButton(
            btn_row, text="\u274c Cancel Booking", width=130, height=36,
            fg_color=theme.RED, hover_color="#b91c1c",
            corner_radius=8, font=theme.font(12, "bold"),
            command=do_cancel,
        ).pack(side="left", padx=8)

        ctk.CTkButton(
            btn_row, text="Keep", width=80, height=36,
            fg_color=theme.BG_CARD, hover_color=theme.BG_CARD_HOVER,
            corner_radius=8, font=theme.font(12),
            command=confirm.destroy,
        ).pack(side="left", padx=8)

    # ------------------------------------------------------------------
    # Reschedule booking (calendar + time dropdown)
    # ------------------------------------------------------------------
    def _reschedule_booking(self):
        """Reschedule this booking — change date/time."""
        dialog = ctk.CTkToplevel(self)
        dialog.title("Reschedule Booking")
        dialog.geometry("420x280")
        dialog.resizable(False, False)
        dialog.configure(fg_color=theme.BG_DARK)
        dialog.transient(self)
        dialog.grab_set()

        self.update_idletasks()
        cx = self.winfo_rootx() + (self.winfo_width() - 420) // 2
        cy = self.winfo_rooty() + (self.winfo_height() - 280) // 2
        dialog.geometry(f"+{max(cx,0)}+{max(cy,0)}")

        ctk.CTkLabel(
            dialog, text=f"Reschedule: {self.client_data.get('name', '')}",
            font=theme.font_bold(15), text_color=theme.TEXT_LIGHT,
        ).pack(pady=(16, 12))

        form = ctk.CTkFrame(dialog, fg_color=theme.BG_CARD, corner_radius=10)
        form.pack(fill="x", padx=20, pady=4)
        form.grid_columnconfigure(1, weight=1)

        # Date row with calendar button
        ctk.CTkLabel(
            form, text="New Date:", font=theme.font(12), text_color=theme.TEXT_DIM,
        ).grid(row=0, column=0, padx=(12, 8), pady=8, sticky="e")

        date_frame = ctk.CTkFrame(form, fg_color="transparent")
        date_frame.grid(row=0, column=1, padx=(0, 12), pady=8, sticky="ew")
        date_frame.grid_columnconfigure(0, weight=1)

        new_date = theme.create_entry(date_frame, width=180)
        new_date.insert(0, self.client_data.get("date", ""))
        new_date.grid(row=0, column=0, sticky="ew")

        resc_cal_btn = ctk.CTkButton(
            date_frame, text="\U0001f4c5", width=36, height=32,
            fg_color=theme.GREEN_ACCENT,
            hover_color=theme.GREEN_PRIMARY,
            corner_radius=8,
            font=theme.font(14),
            command=lambda: self._open_calendar(new_date),
        )
        resc_cal_btn.grid(row=0, column=1, padx=(4, 0))

        # Time row with dropdown
        ctk.CTkLabel(
            form, text="New Time:", font=theme.font(12), text_color=theme.TEXT_DIM,
        ).grid(row=1, column=0, padx=(12, 8), pady=8, sticky="e")

        current_time = self.client_data.get("time", "")
        time_var = ctk.StringVar(
            value=current_time if current_time in TIME_SLOTS
            else (TIME_SLOTS[0] if not current_time else current_time)
        )
        time_menu = ctk.CTkOptionMenu(
            form,
            variable=time_var,
            values=TIME_SLOTS,
            fg_color=theme.BG_INPUT,
            button_color=theme.GREEN_ACCENT,
            button_hover_color=theme.GREEN_DARK,
            dropdown_fg_color=theme.BG_CARD,
            corner_radius=8,
            height=32,
            font=theme.font(12),
        )
        time_menu.grid(row=1, column=1, padx=(0, 12), pady=8, sticky="ew")

        btn_row = ctk.CTkFrame(dialog, fg_color="transparent")
        btn_row.pack(pady=12)

        def do_reschedule():
            import threading
            old_date = self.client_data.get("date", "")
            self.client_data["date"] = new_date.get().strip()
            self.client_data["time"] = time_var.get()
            self.db.save_client(self.client_data)
            self.sync.queue_write("reschedule_booking", {
                "row": self.client_data.get("sheets_row", ""),
                "name": self.client_data.get("name", ""),
                "email": self.client_data.get("email", ""),
                "service": self.client_data.get("service", ""),
                "oldDate": old_date,
                "newDate": self.client_data["date"],
                "newTime": self.client_data["time"],
            })
            # Update form fields
            if "date" in self._fields:
                w = self._fields["date"]
                if isinstance(w, ctk.CTkEntry):
                    w.delete(0, "end")
                    w.insert(0, self.client_data["date"])
            if "time" in self._fields:
                w = self._fields["time"]
                if isinstance(w, ctk.StringVar):
                    w.set(self.client_data["time"])
                elif isinstance(w, ctk.CTkEntry):
                    w.delete(0, "end")
                    w.insert(0, self.client_data["time"])
            if self.api:
                msg = (
                    f"\U0001f4c5 Booking RESCHEDULED: {self.client_data.get('name', '')}\n"
                    f"{old_date} \u2192 {self.client_data['date']} {self.client_data['time']}\n"
                    f"Service: {self.client_data.get('service', '')}"
                )
                threading.Thread(target=self.api.send_telegram, args=(msg,), daemon=True).start()
            dialog.destroy()

        theme.create_accent_button(
            btn_row, "\U0001f4c5 Reschedule",
            command=do_reschedule, width=120,
        ).pack(side="left", padx=8)

        ctk.CTkButton(
            btn_row, text="Cancel", width=80, height=36,
            fg_color=theme.BG_CARD, hover_color=theme.BG_CARD_HOVER,
            corner_radius=8, font=theme.font(12),
            command=dialog.destroy,
        ).pack(side="left", padx=8)

    # ------------------------------------------------------------------
    # Refund payment
    # ------------------------------------------------------------------
    def _refund_payment(self):
        """Refund payment — update paid status + queue GAS refund."""
        name = self.client_data.get("name", "this client")
        amount = float(self.client_data.get("price", 0) or 0)

        confirm = ctk.CTkToplevel(self)
        confirm.title("Process Refund")
        confirm.geometry("400x220")
        confirm.resizable(False, False)
        confirm.configure(fg_color=theme.BG_DARK)
        confirm.transient(self)
        confirm.grab_set()

        self.update_idletasks()
        cx = self.winfo_rootx() + (self.winfo_width() - 400) // 2
        cy = self.winfo_rooty() + (self.winfo_height() - 220) // 2
        confirm.geometry(f"+{max(cx,0)}+{max(cy,0)}")

        ctk.CTkLabel(
            confirm, text=f"Refund {name}?",
            font=theme.font_bold(15), text_color=theme.TEXT_LIGHT,
        ).pack(pady=(16, 4))
        ctk.CTkLabel(
            confirm, text=f"Amount: \u00a3{amount:,.2f}",
            font=theme.font(14), text_color=theme.AMBER,
        ).pack(pady=(0, 4))

        ctk.CTkLabel(confirm, text="Refund amount (\u00a3):", font=theme.font(12), text_color=theme.TEXT_DIM).pack(pady=(4, 2))
        refund_entry = theme.create_entry(confirm, width=200)
        refund_entry.insert(0, f"{amount:.2f}")
        refund_entry.pack(pady=(0, 12))

        btn_row = ctk.CTkFrame(confirm, fg_color="transparent")
        btn_row.pack(pady=8)

        def do_refund():
            import threading
            try:
                refund_amount = float(refund_entry.get().strip())
            except (ValueError, TypeError):
                return
            self.client_data["paid"] = "Refunded"
            self.db.save_client(self.client_data)
            self.sync.queue_write("refund_payment", {
                "row": self.client_data.get("sheets_row", ""),
                "name": self.client_data.get("name", ""),
                "email": self.client_data.get("email", ""),
                "amount": refund_amount,
                "stripeCustomerId": self.client_data.get("stripe_customer_id", ""),
            })
            # Update the paid dropdown
            if "paid" in self._fields:
                self._fields["paid"].set("Refunded")
            if self.api:
                msg = f"\U0001f4b8 REFUND processed: {name} \u2014 \u00a3{refund_amount:,.2f}\nService: {self.client_data.get('service', '')}"
                threading.Thread(target=self.api.send_telegram, args=(msg,), daemon=True).start()
            confirm.destroy()

        ctk.CTkButton(
            btn_row, text="\U0001f4b8 Process Refund", width=140, height=36,
            fg_color=theme.RED, hover_color="#b91c1c",
            corner_radius=8, font=theme.font(12, "bold"),
            command=do_refund,
        ).pack(side="left", padx=8)

        ctk.CTkButton(
            btn_row, text="Cancel", width=80, height=36,
            fg_color=theme.BG_CARD, hover_color=theme.BG_CARD_HOVER,
            corner_radius=8, font=theme.font(12),
            command=confirm.destroy,
        ).pack(side="left", padx=8)

    # ------------------------------------------------------------------
    # Delete client
    # ------------------------------------------------------------------
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
            name = self.client_data.get("name", "")
            email = self.client_data.get("email", "")
            if cid:
                self.db.delete_client(cid)
            if name:
                self.sync.queue_write("delete_client", {"name": name, "email": email})
            confirm.destroy()
            if self.on_save:
                try:
                    self.on_save()
                except TypeError:
                    self.on_save()
            self.destroy()

        ctk.CTkButton(
            btn_row, text="\U0001f5d1\ufe0f Delete", width=100, height=36,
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
