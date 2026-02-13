"""
Booking Detail Card — A lightweight popup showing booking details.
Shown when clicking a booking in the calendar view.
"""

import customtkinter as ctk
import webbrowser

from .. import theme
from .photo_manager import PhotoManager
from ...distance import distance_from_base, format_drive_time


class BookingDetailCard(ctk.CTkToplevel):
    """Read-only detail card for a booking, with option to open full editor."""

    def __init__(self, parent, booking: dict, db=None, sync=None,
                 on_edit=None, **kwargs):
        super().__init__(parent, **kwargs)

        self.booking = booking
        self.db = db
        self.sync = sync
        self.on_edit = on_edit

        # ── Window setup ──
        self.title("Booking Details")
        self.geometry("420x520")
        self.resizable(False, False)
        self.configure(fg_color=theme.BG_DARK)
        self.transient(parent)
        self.grab_set()

        # Centre on parent
        self.update_idletasks()
        px = parent.winfo_rootx() + (parent.winfo_width() - 420) // 2
        py = parent.winfo_rooty() + (parent.winfo_height() - 520) // 2
        self.geometry(f"420x520+{max(px,0)}+{max(py,0)}")

        self._build_ui()
        self.after(100, self.focus_force)

    def _build_ui(self):
        b = self.booking
        name = b.get("name", b.get("client_name", "Unknown"))
        service = b.get("service", "")
        status = b.get("status", "")
        price = float(b.get("price", 0) or 0)
        date_str = b.get("date", "")
        time_str = b.get("time", "")
        postcode = b.get("postcode", "")
        phone = b.get("phone", "")
        email = b.get("email", "")
        btype = b.get("type", "")
        frequency = b.get("frequency", "")
        paid = b.get("paid", "")
        notes = b.get("notes", "")
        is_recurring = b.get("recurring", False)

        # If we have a client_id, pull full details from DB
        client_id = b.get("id")
        if client_id and self.db:
            full = self.db.get_client(client_id)
            if full:
                phone = full.get("phone", phone)
                email = full.get("email", email)
                postcode = full.get("postcode", postcode)
                notes = full.get("notes", notes)
                paid = full.get("paid", paid)
                frequency = full.get("frequency", frequency)
                btype = full.get("type", btype)

        # ── Header ──
        header = ctk.CTkFrame(self, fg_color=theme.GREEN_DARK, corner_radius=0, height=90)
        header.pack(fill="x")
        header.pack_propagate(False)

        # Avatar circle
        initials = "".join(w[0].upper() for w in name.split()[:2]) if name else "?"
        avatar = ctk.CTkLabel(
            header, text=initials,
            font=theme.font_bold(18),
            text_color="white",
            fg_color=theme.GREEN_PRIMARY,
            corner_radius=22,
            width=44, height=44,
        )
        avatar.place(x=20, y=23)

        ctk.CTkLabel(
            header, text=name,
            font=theme.font_bold(17),
            text_color="white",
            anchor="w",
        ).place(x=76, y=20)

        if status:
            badge = theme.create_status_badge(header, status)
            badge.place(x=76, y=52)

        if is_recurring:
            ctk.CTkLabel(
                header, text="🔄 Recurring",
                font=theme.font(11, "bold"),
                text_color=theme.GREEN_PALE,
            ).place(relx=1.0, x=-16, y=56, anchor="e")

        # ── Body ──
        body = ctk.CTkScrollableFrame(self, fg_color="transparent")
        body.pack(fill="both", expand=True, padx=0, pady=0)

        # --- Booking Info Section ---
        self._section(body, "📅 Booking Info")

        info_grid = ctk.CTkFrame(body, fg_color=theme.BG_CARD, corner_radius=10)
        info_grid.pack(fill="x", padx=16, pady=(0, 8))

        from datetime import datetime
        try:
            dt = datetime.strptime(date_str, "%Y-%m-%d")
            pretty_date = dt.strftime("%A, %d %B %Y")
        except Exception:
            pretty_date = date_str or "Not set"

        fields = [
            ("📅 Date", pretty_date),
            ("⏰ Time", time_str or "TBC"),
            ("🔧 Service", service or "—"),
            ("💰 Price", f"£{price:,.2f}" if price else "—"),
            ("📋 Type", btype or "—"),
            ("🔄 Frequency", frequency or "—"),
            ("💳 Paid", paid or "—"),
        ]

        for i, (label, value) in enumerate(fields):
            if value == "—" and label in ("📋 Type", "🔄 Frequency"):
                continue  # Skip empty optional fields

            row = ctk.CTkFrame(info_grid, fg_color="transparent")
            row.pack(fill="x", padx=12, pady=3)
            row.grid_columnconfigure(1, weight=1)

            ctk.CTkLabel(
                row, text=label,
                font=theme.font(12),
                text_color=theme.TEXT_DIM,
                anchor="w", width=100,
            ).grid(row=0, column=0, sticky="w")

            val_color = theme.TEXT_LIGHT
            if label == "💳 Paid":
                val_color = theme.GREEN_LIGHT if value == "Yes" else theme.RED
            elif label == "💰 Price":
                val_color = theme.GREEN_LIGHT

            ctk.CTkLabel(
                row, text=value,
                font=theme.font_bold(12),
                text_color=val_color,
                anchor="w",
            ).grid(row=0, column=1, sticky="w")

        # Add small padding at bottom of card
        ctk.CTkFrame(info_grid, fg_color="transparent", height=6).pack()

        # --- Contact Section ---
        if phone or email or postcode:
            self._section(body, "📞 Contact")
            contact_grid = ctk.CTkFrame(body, fg_color=theme.BG_CARD, corner_radius=10)
            contact_grid.pack(fill="x", padx=16, pady=(0, 8))

            contact_fields = []
            if phone:
                contact_fields.append(("📞 Phone", phone))
            if email:
                contact_fields.append(("✉️ Email", email))
            if postcode:
                contact_fields.append(("📍 Postcode", postcode))

            for label, value in contact_fields:
                row = ctk.CTkFrame(contact_grid, fg_color="transparent")
                row.pack(fill="x", padx=12, pady=3)
                row.grid_columnconfigure(1, weight=1)

                ctk.CTkLabel(
                    row, text=label,
                    font=theme.font(12),
                    text_color=theme.TEXT_DIM,
                    anchor="w", width=100,
                ).grid(row=0, column=0, sticky="w")

                ctk.CTkLabel(
                    row, text=value,
                    font=theme.font_bold(12),
                    text_color=theme.TEXT_LIGHT,
                    anchor="w",
                ).grid(row=0, column=1, sticky="w")

            ctk.CTkFrame(contact_grid, fg_color="transparent", height=6).pack()

        # --- Travel info (async-ish, shown if postcode available) ---
        if postcode:
            self._travel_frame = ctk.CTkFrame(body, fg_color=theme.BG_CARD, corner_radius=10)
            self._section(body, "🚐 Travel")
            self._travel_frame.pack(fill="x", padx=16, pady=(0, 8))
            ctk.CTkLabel(
                self._travel_frame, text="Calculating...",
                font=theme.font(11), text_color=theme.TEXT_DIM,
            ).pack(padx=12, pady=8)
            # Calculate in background
            self.after(100, lambda: self._show_travel_info(postcode))

        # --- Notes ---
        if notes and notes.strip():
            self._section(body, "📝 Notes")
            notes_frame = ctk.CTkFrame(body, fg_color=theme.BG_CARD, corner_radius=10)
            notes_frame.pack(fill="x", padx=16, pady=(0, 8))

            ctk.CTkLabel(
                notes_frame, text=notes,
                font=theme.font(12),
                text_color=theme.TEXT_DIM,
                anchor="nw",
                wraplength=350,
                justify="left",
            ).pack(fill="x", padx=12, pady=8)

        # ── Action Buttons ──
        btn_frame = ctk.CTkFrame(self, fg_color="transparent", height=56)
        btn_frame.pack(fill="x", padx=16, pady=(8, 16))

        if postcode:
            theme.create_outline_button(
                btn_frame, "📍 Map",
                command=lambda: webbrowser.open(
                    f"https://www.google.com/maps/search/{postcode}"
                ),
                width=80,
            ).pack(side="left", padx=(0, 6))

        if phone:
            theme.create_outline_button(
                btn_frame, f"📞 Call",
                command=lambda: webbrowser.open(f"tel:{phone}"),
                width=80,
            ).pack(side="left", padx=(0, 6))

        # Photos button
        theme.create_outline_button(
            btn_frame, "📸 Photos",
            command=lambda: self._open_photos(client_id, name, date_str),
            width=90,
        ).pack(side="left", padx=(0, 6))

        if self.on_edit:
            theme.create_accent_button(
                btn_frame, "✏️ Edit Client",
                command=self._open_editor,
                width=120,
            ).pack(side="right", padx=(6, 0))

        ctk.CTkButton(
            btn_frame, text="Close", width=70, height=34,
            fg_color="transparent",
            hover_color=theme.BG_CARD_HOVER,
            text_color=theme.TEXT_DIM,
            corner_radius=8,
            font=theme.font(12),
            command=self.destroy,
        ).pack(side="right")

    def _section(self, parent, title: str):
        """Add a section header."""
        ctk.CTkLabel(
            parent, text=title,
            font=theme.font_bold(13),
            text_color=theme.TEXT_LIGHT,
            anchor="w",
        ).pack(fill="x", padx=16, pady=(12, 4))

    def _open_editor(self):
        """Close this card and open the full edit modal."""
        self.destroy()
        if self.on_edit:
            self.on_edit(self.booking)

    def _open_photos(self, client_id, client_name, job_date):
        """Open the photo manager for this booking."""
        if self.db:
            job_number = ""
            if client_id:
                full = self.db.get_client(client_id)
                if full:
                    job_number = full.get("job_number", "")
            PhotoManager(
                self, self.db,
                client_id=client_id,
                client_name=client_name or "Unknown",
                job_date=job_date or "",
                job_number=job_number,
            )

    def _show_travel_info(self, postcode: str):
        """Fetch and display travel info from base to this postcode."""
        import threading

        def _fetch():
            try:
                result = distance_from_base(postcode)
                if result and hasattr(self, '_travel_frame') and self._travel_frame.winfo_exists():
                    self.after(0, lambda: self._render_travel(result))
            except Exception:
                pass

        threading.Thread(target=_fetch, daemon=True).start()

    def _render_travel(self, result: dict):
        """Render travel info in the travel frame."""
        if not hasattr(self, '_travel_frame') or not self._travel_frame.winfo_exists():
            return

        for w in self._travel_frame.winfo_children():
            w.destroy()

        miles = result.get("driving_miles", 0)
        mins = result.get("drive_minutes", 0)
        parish = result.get("destination", {}).get("parish", "")

        info_parts = [
            ("🚐 Distance", f"{miles} miles"),
            ("⏱️ Drive Time", format_drive_time(mins)),
        ]
        if parish:
            info_parts.append(("📍 Area", parish))

        for label, value in info_parts:
            row = ctk.CTkFrame(self._travel_frame, fg_color="transparent")
            row.pack(fill="x", padx=12, pady=2)
            row.grid_columnconfigure(1, weight=1)

            ctk.CTkLabel(
                row, text=label,
                font=theme.font(12), text_color=theme.TEXT_DIM,
                anchor="w", width=100,
            ).grid(row=0, column=0, sticky="w")

            # Colour code: green < 20 min, amber 20-40, red > 40
            colour = theme.GREEN_LIGHT if mins <= 20 else (theme.AMBER if mins <= 40 else theme.RED)

            ctk.CTkLabel(
                row, text=value,
                font=theme.font_bold(12),
                text_color=colour if "Drive" in label else theme.TEXT_LIGHT,
                anchor="w",
            ).grid(row=0, column=1, sticky="w")

        ctk.CTkFrame(self._travel_frame, fg_color="transparent", height=6).pack()
