"""
Enquiry Detail Modal — view/edit dialog for enquiries.
"""

import customtkinter as ctk
import json
import threading
from datetime import date, timedelta
from .. import theme
from ... import config


class EnquiryModal(ctk.CTkToplevel):
    """Modal window for viewing and editing an enquiry."""

    def __init__(self, parent, enquiry_data: dict, db, sync,
                 on_save=None, email_engine=None, **kwargs):
        super().__init__(parent, **kwargs)

        self.enquiry_data = dict(enquiry_data)
        self.db = db
        self.sync = sync
        self.on_save = on_save
        self.email_engine = email_engine
        self._fields = {}

        is_new = not self.enquiry_data.get("id")
        name = self.enquiry_data.get("name", "New Enquiry")
        self.title(f"Enquiry: {name}" if not is_new else "New Enquiry")
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

        self.update_idletasks()
        px = parent.winfo_rootx() + (parent.winfo_width() - 600) // 2
        py = 10
        self.geometry(f"+{max(px,0)}+{max(py,0)}")

        self._build_ui()

    def _build_ui(self):
        # Grid layout: row 0=scrollable content, row 1=separator, row 2=footer
        self.grid_rowconfigure(0, weight=1)
        self.grid_columnconfigure(0, weight=1)

        container = ctk.CTkScrollableFrame(self, fg_color=theme.BG_DARK)
        container.grid(row=0, column=0, sticky="nsew")

        sep = ctk.CTkFrame(self, fg_color=theme.GREEN_PRIMARY, height=2)
        sep.grid(row=1, column=0, sticky="ew")

        self._footer = ctk.CTkFrame(self, fg_color=theme.BG_DARKER)
        self._footer.grid(row=2, column=0, sticky="ew")

        # ── Header ──
        header = ctk.CTkFrame(container, fg_color=theme.BG_CARD, corner_radius=12)
        header.pack(fill="x", padx=16, pady=(16, 8))

        name = self.enquiry_data.get("name", "")
        status = self.enquiry_data.get("status", "New")
        etype = self.enquiry_data.get("type", "General")
        replied = self.enquiry_data.get("replied", "No")

        h_inner = ctk.CTkFrame(header, fg_color="transparent")
        h_inner.pack(fill="x", padx=16, pady=12)

        # Initials
        initials = "".join(w[0].upper() for w in name.split()[:2]) if name else "?"
        ctk.CTkLabel(
            h_inner, text=initials,
            width=44, height=44,
            fg_color=theme.GREEN_PRIMARY, corner_radius=22,
            font=theme.font_bold(18), text_color="white",
        ).pack(side="left", padx=(0, 12))

        info = ctk.CTkFrame(h_inner, fg_color="transparent")
        info.pack(side="left", fill="x", expand=True)

        ctk.CTkLabel(
            info, text=name or "Unknown",
            font=theme.font_bold(16), text_color=theme.TEXT_LIGHT, anchor="w",
        ).pack(fill="x")

        ctk.CTkLabel(
            info, text=f"{etype} — {status}",
            font=theme.font(12), text_color=theme.TEXT_DIM, anchor="w",
        ).pack(fill="x")

        replied_color = theme.GREEN_LIGHT if replied == "Yes" else theme.RED
        ctk.CTkLabel(
            h_inner,
            text=f"{'✅' if replied == 'Yes' else '⏳'} {'Replied' if replied == 'Yes' else 'Awaiting'}",
            font=theme.font_bold(12), text_color=replied_color,
        ).pack(side="right", padx=8)

        # ── Form ──
        form = ctk.CTkFrame(container, fg_color=theme.BG_CARD, corner_radius=12)
        form.pack(fill="x", padx=16, pady=8)
        form.grid_columnconfigure(1, weight=1)

        fields = [
            ("name",           "Name",           "entry"),
            ("email",          "Email",          "entry"),
            ("phone",          "Phone",          "entry"),
            ("address",        "Address",        "entry"),
            ("postcode",       "Postcode",       "entry"),
            ("service",        "Service",        "entry"),
            ("preferred_date", "Preferred Date", "entry"),
            ("preferred_time", "Preferred Time", "entry"),
            ("type",           "Type",           "dropdown", config.ENQUIRY_TYPE_OPTIONS),
            ("status",         "Status",         "dropdown", config.ENQUIRY_STATUS_OPTIONS),
            ("date",           "Date",           "entry"),
            ("replied",        "Replied",        "dropdown", config.REPLIED_OPTIONS),
        ]

        for i, field_def in enumerate(fields):
            key = field_def[0]
            label = field_def[1]
            ftype = field_def[2]
            current = str(self.enquiry_data.get(key, "") or "")

            ctk.CTkLabel(
                form, text=label,
                font=theme.font(12), text_color=theme.TEXT_DIM, anchor="e",
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

        # ── Message ──
        msg_frame = ctk.CTkFrame(container, fg_color=theme.BG_CARD, corner_radius=12)
        msg_frame.pack(fill="x", padx=16, pady=8)

        ctk.CTkLabel(
            msg_frame, text="Message",
            font=theme.font_bold(13), text_color=theme.TEXT_LIGHT, anchor="w",
        ).pack(fill="x", padx=16, pady=(12, 4))

        self.message_box = ctk.CTkTextbox(
            msg_frame, height=80,
            fg_color=theme.BG_INPUT, corner_radius=8, font=theme.font(12),
        )
        self.message_box.pack(fill="x", padx=16, pady=(0, 6))
        self.message_box.insert("1.0", self.enquiry_data.get("message", "") or "")

        ctk.CTkLabel(
            msg_frame, text="Notes",
            font=theme.font_bold(13), text_color=theme.TEXT_LIGHT, anchor="w",
        ).pack(fill="x", padx=16, pady=(4, 4))

        self.notes_box = ctk.CTkTextbox(
            msg_frame, height=60,
            fg_color=theme.BG_INPUT, corner_radius=8, font=theme.font(12),
        )
        self.notes_box.pack(fill="x", padx=16, pady=(0, 12))
        self.notes_box.insert("1.0", self.enquiry_data.get("notes", "") or "")

        # ── Garden Details (from dedicated garden_details field, or parsed from message/notes) ──
        import re as _re
        gd = {}
        # Priority 1: dedicated garden_details JSON field from GAS
        raw_gd = self.enquiry_data.get("garden_details", "") or ""
        if raw_gd:
            try:
                gd = json.loads(raw_gd) if isinstance(raw_gd, str) else raw_gd
            except Exception:
                pass
        # Priority 2: GARDEN_JSON embedded in message or notes
        if not gd:
            for raw_field in ["message", "notes"]:
                raw = self.enquiry_data.get(raw_field, "") or ""
                gj_match = _re.search(r'GARDEN_JSON:(\{.*?\})', raw)
                if gj_match and not gd:
                    try:
                        gd = json.loads(gj_match.group(1))
                    except Exception:
                        pass
        # Priority 3: parse "Garden: Size:Medium, Areas:Both" format from message
        if not gd:
            raw_msg = self.enquiry_data.get("message", "") or ""
            for part in raw_msg.split("|"):
                part = part.strip()
                if part.startswith("Garden:"):
                    garden_str = part.replace("Garden:", "").strip()
                    for kv in garden_str.split(","):
                        kv = kv.strip()
                        if ":" in kv:
                            k, v = kv.split(":", 1)
                            k = k.strip().lower()
                            v = v.strip()
                            if "size" in k:
                                gd["gardenSize_text"] = v
                            elif "area" in k:
                                gd["gardenAreas_text"] = v
                            elif "condition" in k:
                                gd["gardenCondition_text"] = v
                            elif "hedge" in k and "size" in k:
                                gd["hedgeSize_text"] = v
                            elif "hedge" in k:
                                gd["hedgeCount_text"] = v
                            elif "clearance" in k:
                                gd["clearanceLevel_text"] = v
                            elif "waste" in k:
                                gd["wasteRemoval_text"] = v
                            elif "treatment" in k:
                                gd["treatmentType_text"] = v
                            elif "strimming" in k or "work" in k:
                                gd["strimmingType_text"] = v
                            elif "surface" in k:
                                gd["pwSurface_text"] = v
                            elif "fence" in k:
                                gd["fenceType_text"] = v
                            elif "drain" in k:
                                gd["drainType_text"] = v
                            elif "gutter" in k:
                                gd["gutterSize_text"] = v

        if gd:
            gd_frame = ctk.CTkFrame(container, fg_color="#1e3a2f", corner_radius=12)
            gd_frame.pack(fill="x", padx=16, pady=8)

            ctk.CTkLabel(
                gd_frame, text="\U0001f33f Customer's Garden Details",
                font=theme.font_bold(13), text_color=theme.GREEN_LIGHT, anchor="w",
            ).pack(fill="x", padx=16, pady=(12, 6))

            gd_grid = ctk.CTkFrame(gd_frame, fg_color="transparent")
            gd_grid.pack(fill="x", padx=16, pady=(0, 12))
            gd_grid.grid_columnconfigure((0, 1), weight=1)

            gd_items = []
            if gd.get("gardenSize_text") or gd.get("gardenSize"):
                gd_items.append(("\U0001f4d0 Size", gd.get("gardenSize_text", "") or gd.get("gardenSize", "")))
            if gd.get("gardenAreas_text") or gd.get("gardenAreas"):
                gd_items.append(("\U0001f3e0 Areas", gd.get("gardenAreas_text", "") or gd.get("gardenAreas", "")))
            if gd.get("gardenCondition_text") or gd.get("gardenCondition"):
                gd_items.append(("\U0001f331 Condition", gd.get("gardenCondition_text", "") or gd.get("gardenCondition", "")))
            if gd.get("hedgeCount_text") or gd.get("hedgeCount"):
                gd_items.append(("\U0001f333 Hedges", gd.get("hedgeCount_text", "") or gd.get("hedgeCount", "")))
            if gd.get("hedgeSize_text") or gd.get("hedgeSize"):
                gd_items.append(("\U0001f4cf Hedge Size", gd.get("hedgeSize_text", "") or gd.get("hedgeSize", "")))
            if gd.get("clearanceLevel_text") or gd.get("clearanceLevel"):
                gd_items.append(("\U0001f9f9 Clearance", gd.get("clearanceLevel_text", "") or gd.get("clearanceLevel", "")))
            if gd.get("wasteRemoval_text") or gd.get("wasteRemoval"):
                gd_items.append(("\U0001f5d1 Waste", gd.get("wasteRemoval_text", "") or gd.get("wasteRemoval", "")))
            if gd.get("treatmentType_text") or gd.get("treatmentType"):
                gd_items.append(("\U0001f48a Treatment", gd.get("treatmentType_text", "") or gd.get("treatmentType", "")))
            if gd.get("strimmingType_text") or gd.get("strimmingType"):
                gd_items.append(("\U0001f33e Work Type", gd.get("strimmingType_text", "") or gd.get("strimmingType", "")))
            if gd.get("pwSurface_text") or gd.get("pwSurface"):
                gd_items.append(("\U0001f4a7 Surface", gd.get("pwSurface_text", "") or gd.get("pwSurface", "")))
            if gd.get("pwArea_text") or gd.get("pwArea"):
                gd_items.append(("\U0001f4d0 PW Area", gd.get("pwArea_text", "") or gd.get("pwArea", "")))
            if gd.get("weedArea_text") or gd.get("weedArea"):
                gd_items.append(("\U0001f33f Weed Area", gd.get("weedArea_text", "") or gd.get("weedArea", "")))
            if gd.get("weedType_text") or gd.get("weedType"):
                gd_items.append(("\U0001f33f Weed Type", gd.get("weedType_text", "") or gd.get("weedType", "")))
            if gd.get("fenceType_text") or gd.get("fenceType"):
                gd_items.append(("\U0001f6e1 Fence", gd.get("fenceType_text", "") or gd.get("fenceType", "")))
            if gd.get("fenceHeight_text") or gd.get("fenceHeight"):
                gd_items.append(("\U0001f4cf Fence Height", gd.get("fenceHeight_text", "") or gd.get("fenceHeight", "")))
            if gd.get("drainType_text") or gd.get("drainType"):
                gd_items.append(("\U0001f6b0 Drain", gd.get("drainType_text", "") or gd.get("drainType", "")))
            if gd.get("drainCondition_text") or gd.get("drainCondition"):
                gd_items.append(("\U0001f6b0 Drain Condition", gd.get("drainCondition_text", "") or gd.get("drainCondition", "")))
            if gd.get("gutterSize_text") or gd.get("gutterSize"):
                gd_items.append(("\U0001f3e0 Gutter Size", gd.get("gutterSize_text", "") or gd.get("gutterSize", "")))
            if gd.get("gutterCondition_text") or gd.get("gutterCondition"):
                gd_items.append(("\U0001f3e0 Gutter Cond.", gd.get("gutterCondition_text", "") or gd.get("gutterCondition", "")))
            if gd.get("vegSize_text") or gd.get("vegSize"):
                gd_items.append(("\U0001f966 Veg Patch", gd.get("vegSize_text", "") or gd.get("vegSize", "")))
            if gd.get("vegCondition_text") or gd.get("vegCondition"):
                gd_items.append(("\U0001f966 Veg Condition", gd.get("vegCondition_text", "") or gd.get("vegCondition", "")))
            if gd.get("treeSize_text") or gd.get("treeSize"):
                gd_items.append(("\U0001f332 Tree Size", gd.get("treeSize_text", "") or gd.get("treeSize", "")))
            if gd.get("treeWork_text") or gd.get("treeWork"):
                gd_items.append(("\U0001f332 Tree Work", gd.get("treeWork_text", "") or gd.get("treeWork", "")))
            if gd.get("extras_text"):
                gd_items.append(("\u2795 Extras", gd.get("extras_text", "")))

            for idx, (label, value) in enumerate(gd_items):
                r, c = divmod(idx, 2)
                cell = ctk.CTkFrame(gd_grid, fg_color="transparent")
                cell.grid(row=r, column=c, padx=6, pady=3, sticky="w")
                ctk.CTkLabel(cell, text=f"{label}: {(value or '').title()}",
                             font=theme.font_bold(12),
                             text_color=theme.TEXT_LIGHT, anchor="w").pack(anchor="w")

        # ── Customer Photos (from enquiry form upload) ──
        raw_photos = self.enquiry_data.get("photo_urls", "") or ""
        photo_urls = [u.strip() for u in raw_photos.split(",") if u.strip()]
        if photo_urls:
            photo_frame = ctk.CTkFrame(container, fg_color="#1e2a3a", corner_radius=12)
            photo_frame.pack(fill="x", padx=16, pady=8)

            ctk.CTkLabel(
                photo_frame, text="\U0001f4f8 Customer Photos",
                font=theme.font_bold(13), text_color="#60a5fa", anchor="w",
            ).pack(fill="x", padx=16, pady=(12, 6))

            photos_grid = ctk.CTkFrame(photo_frame, fg_color="transparent")
            photos_grid.pack(fill="x", padx=16, pady=(0, 12))

            for idx, url in enumerate(photo_urls):
                ph_row = ctk.CTkFrame(photos_grid, fg_color="#2a2a4a", corner_radius=8)
                ph_row.pack(fill="x", pady=3)

                ctk.CTkLabel(
                    ph_row, text=f"\U0001f4f7 Photo {idx + 1}",
                    font=theme.font_bold(11), text_color=theme.TEXT_LIGHT, anchor="w",
                ).pack(side="left", padx=(12, 8), pady=8)

                ctk.CTkLabel(
                    ph_row, text=url[:60] + ("..." if len(url) > 60 else ""),
                    font=theme.font(10), text_color=theme.TEXT_DIM, anchor="w",
                ).pack(side="left", fill="x", expand=True, padx=4, pady=8)

                def _open_photo(u=url):
                    import webbrowser
                    webbrowser.open(u)

                ctk.CTkButton(
                    ph_row, text="Open", width=60, height=28,
                    fg_color=theme.GREEN_PRIMARY, hover_color=theme.GREEN_DARK,
                    corner_radius=6, font=theme.font(11),
                    command=_open_photo,
                ).pack(side="right", padx=(4, 12), pady=6)

        # ── Discount Code (if applied) ──
        discount = self.enquiry_data.get("discount_code", "") or ""
        if discount:
            disc_frame = ctk.CTkFrame(container, fg_color="#2a2a1a", corner_radius=12)
            disc_frame.pack(fill="x", padx=16, pady=8)
            ctk.CTkLabel(
                disc_frame,
                text=f"\U0001f3f7 Discount Code Applied: {discount}",
                font=theme.font_bold(13), text_color="#f59e0b", anchor="w",
            ).pack(fill="x", padx=16, pady=12)

        # ── Actions (fixed footer — always visible) ──
        row1 = ctk.CTkFrame(self._footer, fg_color="transparent")
        row1.pack(fill="x", padx=16, pady=(8, 2))

        theme.create_accent_button(
            row1, "\U0001f4be Save",
            command=self._save, width=100,
        ).pack(side="left", padx=(0, 6))

        if self.enquiry_data.get("replied") != "Yes":
            theme.create_outline_button(
                row1, "\u2705 Replied",
                command=self._mark_replied, width=100,
            ).pack(side="left", padx=4)

        if self.enquiry_data.get("email") and self.email_engine:
            theme.create_outline_button(
                row1, "\U0001f4e7 Reply Email",
                command=self._send_reply_email, width=120,
            ).pack(side="left", padx=4)

        ctk.CTkButton(
            row1, text="Cancel", width=80,
            fg_color=theme.BG_CARD, hover_color=theme.RED,
            corner_radius=8, font=theme.font(12),
            command=self.destroy,
        ).pack(side="right")

        row2 = ctk.CTkFrame(self._footer, fg_color="transparent")
        row2.pack(fill="x", padx=16, pady=(2, 8))

        theme.create_outline_button(
            row2, "📋 → Quote",
            command=self._convert_to_quote, width=100,
        ).pack(side="left", padx=(0, 4))

        theme.create_outline_button(
            row2, "👤 → Client",
            command=self._convert_to_client, width=100,
        ).pack(side="left", padx=4)

        if self.enquiry_data.get("id"):
            ctk.CTkButton(
                row2, text="🗑️ Delete", width=90,
                fg_color="#7f1d1d", hover_color=theme.RED,
                text_color="#fca5a5", corner_radius=8,
                font=theme.font(12, "bold"),
                command=self._confirm_delete,
            ).pack(side="right")

    def _confirm_delete(self):
        name = self.enquiry_data.get("name", "this enquiry")
        confirm = ctk.CTkToplevel(self)
        confirm.title("Delete Enquiry?")
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
            confirm, text=f"Delete enquiry from \"{name}\"?",
            font=theme.font_bold(15), text_color=theme.TEXT_LIGHT,
        ).pack(pady=(20, 4))
        ctk.CTkLabel(
            confirm, text="This will remove the enquiry from the Hub and Sheets.",
            font=theme.font(12), text_color=theme.TEXT_DIM,
        ).pack(pady=(0, 16))

        btn_row = ctk.CTkFrame(confirm, fg_color="transparent")
        btn_row.pack(pady=8)

        def do_delete():
            eid = self.enquiry_data.get("id")
            row = self.enquiry_data.get("sheets_row", "")
            if eid:
                self.db.delete_enquiry(eid)
            if row:
                self.sync.queue_write("delete_enquiry", {"row": row})
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
        for key, widget in self._fields.items():
            if isinstance(widget, ctk.StringVar):
                self.enquiry_data[key] = widget.get()
            elif isinstance(widget, ctk.CTkEntry):
                self.enquiry_data[key] = widget.get().strip()
        self.enquiry_data["message"] = self.message_box.get("1.0", "end").strip()
        self.enquiry_data["notes"] = self.notes_box.get("1.0", "end").strip()

        self.db.save_enquiry(self.enquiry_data)

        self.sync.queue_write("update_enquiry", {
            "row": self.enquiry_data.get("sheets_row", ""),
            "name": self.enquiry_data.get("name", ""),
            "email": self.enquiry_data.get("email", ""),
            "phone": self.enquiry_data.get("phone", ""),
            "message": self.enquiry_data.get("message", ""),
            "type": self.enquiry_data.get("type", ""),
            "status": self.enquiry_data.get("status", ""),
            "date": self.enquiry_data.get("date", ""),
            "replied": self.enquiry_data.get("replied", ""),
            "notes": self.enquiry_data.get("notes", ""),
        })

        if self.on_save:
            self.on_save()
        self.destroy()

    def _mark_replied(self):
        if "replied" in self._fields:
            self._fields["replied"].set("Yes")
        self.enquiry_data["replied"] = "Yes"
        self.enquiry_data["status"] = "Contacted"
        if "status" in self._fields:
            self._fields["status"].set("Contacted")
        self._save()

    def _convert_to_client(self):
        """Create a new client record from this enquiry."""
        from .client_modal import ClientModal

        client_data = {
            "name": self.enquiry_data.get("name", ""),
            "email": self.enquiry_data.get("email", ""),
            "phone": self.enquiry_data.get("phone", ""),
            "postcode": "",
            "address": "",
            "service": "",
            "price": "",
            "date": "",
            "time": "",
            "preferred_day": "",
            "frequency": "One-Off",
            "type": "One-Off",
            "status": "Pending",
            "paid": "No",
            "notes": f"Converted from enquiry: {self.enquiry_data.get('message', '')}",
        }

        # Mark enquiry as converted
        self.enquiry_data["status"] = "Converted"
        if "status" in self._fields:
            self._fields["status"].set("Converted")
        self._save()

        # Open client modal with pre-filled data
        ClientModal(
            self.master, client_data, self.db, self.sync,
            on_save=None,
        )

    # ------------------------------------------------------------------
    # Email Actions
    # ------------------------------------------------------------------
    def _send_reply_email(self):
        """Send an enquiry reply email via GAS."""
        if not self.email_engine:
            return

        # Save current state first
        self._save_data_from_fields()

        enquiry = dict(self.enquiry_data)
        if not enquiry.get("email"):
            return

        def _do_send():
            try:
                result = self.email_engine.send_enquiry_reply(enquiry)
                if result and result.get("status") == "ok":
                    # Mark as replied
                    self.enquiry_data["replied"] = "Yes"
                    self.enquiry_data["status"] = "Contacted"
                    self.db.save_enquiry(self.enquiry_data)
                    self.after(0, lambda: self._show_email_result(True, "Reply sent successfully"))
                else:
                    msg = result.get("message", "Unknown error") if result else "No response"
                    self.after(0, lambda: self._show_email_result(False, msg))
            except Exception as e:
                self.after(0, lambda: self._show_email_result(False, str(e)))

        threading.Thread(target=_do_send, daemon=True).start()

    def _show_email_result(self, success, message):
        """Show email send result in the modal."""
        try:
            if success:
                # Update replied field in UI
                if "replied" in self._fields:
                    self._fields["replied"].set("Yes")
                if "status" in self._fields:
                    self._fields["status"].set("Contacted")
            # Show toast on parent app if available
            app = self._get_app_window()
            if app and hasattr(app, "show_toast"):
                level = "success" if success else "error"
                app.show_toast(f"📧 {message}", level)
        except Exception:
            pass

    def _get_app_window(self):
        """Walk up the widget tree to find AppWindow."""
        widget = self.master
        while widget:
            if hasattr(widget, "show_toast"):
                return widget
            widget = getattr(widget, "master", None)
        return None

    def _save_data_from_fields(self):
        """Update enquiry_data from current form field values without saving to DB."""
        for key, widget in self._fields.items():
            if isinstance(widget, ctk.StringVar):
                self.enquiry_data[key] = widget.get()
            elif isinstance(widget, ctk.CTkEntry):
                self.enquiry_data[key] = widget.get().strip()
        self.enquiry_data["message"] = self.message_box.get("1.0", "end").strip()
        self.enquiry_data["notes"] = self.notes_box.get("1.0", "end").strip()

    def _convert_to_quote(self):
        """Create a new quote from this enquiry with full details pre-filled."""
        from .quote_modal import QuoteModal
        import re

        msg = self.enquiry_data.get("message", "") or ""
        etype = self.enquiry_data.get("type", "General")

        # Parse service enquiry structured message:
        # "Service Name | Preferred: Date Time | Quote: £XX | Breakdown | Address: ..., Postcode | Notes: ..."
        service_name = etype
        address = ""
        postcode = ""
        indicative_price = ""
        notes_text = "Generated from enquiry"
        garden_details = {}

        if "|" in msg:
            # Structured service enquiry format
            parts = [p.strip() for p in msg.split("|")]
            if parts:
                service_name = parts[0]
            for part in parts:
                if part.startswith("Quote:"):
                    indicative_price = part.replace("Quote:", "").strip()
                elif part.startswith("Address:"):
                    addr_part = part.replace("Address:", "").strip()
                    pc_match = re.search(r'([A-Z]{1,2}\d{1,2}\s?\d[A-Z]{2})\s*$', addr_part, re.I)
                    if pc_match:
                        postcode = pc_match.group(1)
                        address = addr_part[:pc_match.start()].rstrip(", ")
                    else:
                        address = addr_part
                elif part.startswith("Notes:"):
                    notes_text = part.replace("Notes:", "").strip()

            notes_text = f"From enquiry. {msg}"

        # Extract GARDEN_JSON from message or notes
        for raw in [msg, self.enquiry_data.get("notes", "") or ""]:
            gj_match = re.search(r'GARDEN_JSON:(\{.*?\})', raw)
            if gj_match and not garden_details:
                try:
                    garden_details = json.loads(gj_match.group(1))
                except Exception:
                    pass

        # Try to extract a numeric total from indicative price
        subtotal = 0.0
        if indicative_price:
            price_match = re.search(r'[\u00a3]?([\d,.]+)', indicative_price)
            if price_match:
                try:
                    subtotal = float(price_match.group(1).replace(",", ""))
                except ValueError:
                    pass

        # ── Map garden details to pricing engine options ──
        from ...pricing import (
            SERVICE_CATALOGUE, key_from_display_name,
            calculate_service_price, build_line_item_from_config,
        )

        service_key = key_from_display_name(service_name) if service_name else ""
        items = []

        if service_key and service_key in SERVICE_CATALOGUE and garden_details:
            option_values = {}
            extras_selected = []

            size_map = {"small": 0, "medium": 1, "large": 2, "xlarge": 3}
            size_idx = size_map.get(garden_details.get("gardenSize", ""), -1)

            areas_map = {"front": 0, "back": 1, "both": 2}
            areas_idx = areas_map.get(garden_details.get("gardenAreas", ""), -1)

            hedge_count_map = {"1": 0, "2": 1, "3": 2, "4+": 3}
            hedge_count_idx = hedge_count_map.get(garden_details.get("hedgeCount", ""), -1)

            hedge_size_map = {"small": 0, "medium": 1, "large": 2}
            hedge_size_idx = hedge_size_map.get(garden_details.get("hedgeSize", ""), -1)

            clearance_map = {"light": 0, "medium": 1, "heavy": 2, "full": 3}
            clearance_idx = clearance_map.get(garden_details.get("clearanceLevel", ""), -1)

            # Lawn Treatment: treatment type → treatType option
            treat_type_map = {"feedweed": 0, "moss": 1, "full": 2}
            treat_type_idx = treat_type_map.get(garden_details.get("treatmentType", ""), -1)

            # Strimming: work type → strimType option
            strim_type_map = {"light": 0, "brush": 1, "full": 2}
            strim_type_idx = strim_type_map.get(garden_details.get("strimmingType", ""), -1)

            waste_val = garden_details.get("wasteRemoval", "")

            svc = SERVICE_CATALOGUE[service_key]

            for opt in svc["options"]:
                opt_id = opt["id"]
                idx = -1
                if opt_id in ("lawnSize", "scarifySize", "treatSize", "strimArea", "leafArea"):
                    idx = size_idx
                elif opt_id in ("lawnArea",):
                    idx = areas_idx
                elif opt_id == "hedgeCount":
                    idx = hedge_count_idx
                elif opt_id == "hedgeSize":
                    idx = hedge_size_idx
                elif opt_id in ("clearLevel",):
                    idx = clearance_idx
                elif opt_id == "treatType":
                    idx = treat_type_idx
                elif opt_id == "strimType":
                    idx = strim_type_idx
                if 0 <= idx < len(opt["choices"]):
                    option_values[opt_id] = opt["choices"][idx]["value"]
                else:
                    option_values[opt_id] = opt["choices"][0]["value"]

            if waste_val == "yes":
                for ext in svc["extras"]:
                    if "waste" in ext["id"].lower() or "removal" in ext["id"].lower():
                        extras_selected.append(ext["id"])
                    if "clipping" in ext["id"].lower() or "collected" in ext["label"].lower():
                        extras_selected.append(ext["id"])

            for ext in svc["extras"]:
                if ext.get("checked") and ext["id"] not in extras_selected:
                    extras_selected.append(ext["id"])

            item = build_line_item_from_config(service_key, option_values, extras_selected, 1)
            items.append(item)
            subtotal = item.get("unit_price", 0)

            # Enrich notes with garden details
            detail_parts = []
            if garden_details.get("gardenSize_text"):
                detail_parts.append(f"Size: {garden_details['gardenSize_text']}")
            if garden_details.get("gardenAreas_text"):
                detail_parts.append(f"Areas: {garden_details['gardenAreas_text']}")
            if garden_details.get("gardenCondition_text"):
                detail_parts.append(f"Condition: {garden_details['gardenCondition_text']}")
            if garden_details.get("hedgeCount_text"):
                detail_parts.append(f"Hedges: {garden_details['hedgeCount_text']}")
            if garden_details.get("hedgeSize_text"):
                detail_parts.append(f"Hedge size: {garden_details['hedgeSize_text']}")
            if garden_details.get("clearanceLevel_text"):
                detail_parts.append(f"Clearance: {garden_details['clearanceLevel_text']}")
            if garden_details.get("wasteRemoval_text"):
                detail_parts.append(f"Waste: {garden_details['wasteRemoval_text']}")
            if garden_details.get("treatmentType_text"):
                detail_parts.append(f"Treatment: {garden_details['treatmentType_text']}")
            if garden_details.get("strimmingType_text"):
                detail_parts.append(f"Work type: {garden_details['strimmingType_text']}")
            if garden_details.get("pwSurface_text"):
                detail_parts.append(f"Surface: {garden_details['pwSurface_text']}")
            if garden_details.get("pwArea_text"):
                detail_parts.append(f"PW Area: {garden_details['pwArea_text']}")
            if garden_details.get("weedArea_text"):
                detail_parts.append(f"Weed area: {garden_details['weedArea_text']}")
            if garden_details.get("weedType_text"):
                detail_parts.append(f"Weed type: {garden_details['weedType_text']}")
            if garden_details.get("fenceType_text"):
                detail_parts.append(f"Fence type: {garden_details['fenceType_text']}")
            if garden_details.get("fenceHeight_text"):
                detail_parts.append(f"Fence height: {garden_details['fenceHeight_text']}")
            if garden_details.get("drainType_text"):
                detail_parts.append(f"Drain type: {garden_details['drainType_text']}")
            if garden_details.get("drainCondition_text"):
                detail_parts.append(f"Drain condition: {garden_details['drainCondition_text']}")
            if garden_details.get("gutterSize_text"):
                detail_parts.append(f"Gutter size: {garden_details['gutterSize_text']}")
            if garden_details.get("gutterCondition_text"):
                detail_parts.append(f"Gutter condition: {garden_details['gutterCondition_text']}")
            if garden_details.get("vegSize_text"):
                detail_parts.append(f"Veg patch: {garden_details['vegSize_text']}")
            if garden_details.get("vegCondition_text"):
                detail_parts.append(f"Veg condition: {garden_details['vegCondition_text']}")
            if garden_details.get("treeSize_text"):
                detail_parts.append(f"Tree size: {garden_details['treeSize_text']}")
            if garden_details.get("treeWork_text"):
                detail_parts.append(f"Tree work: {garden_details['treeWork_text']}")
            if garden_details.get("extras_text"):
                detail_parts.append(f"Extras: {garden_details['extras_text']}")
            if detail_parts:
                notes_text = "Customer garden info: " + " | ".join(detail_parts) + "\n" + notes_text
        elif service_name:
            items.append({
                "description": service_name,
                "qty": 1,
                "unit_price": subtotal,
                "price": subtotal,
                "total": subtotal,
            })

        quote_data = {
            "client_name": self.enquiry_data.get("name", ""),
            "client_email": self.enquiry_data.get("email", ""),
            "client_phone": self.enquiry_data.get("phone", ""),
            "address": address,
            "postcode": postcode,
            "quote_number": "",
            "job_number": "",
            "enquiry_id": self.enquiry_data.get("id", 0),
            "enquiry_message": msg,
            "status": "Draft",
            "date_created": date.today().isoformat(),
            "valid_until": (date.today() + timedelta(days=30)).isoformat(),
            "items": json.dumps(items),
            "subtotal": subtotal,
            "discount": 0,
            "vat": 0,
            "total": subtotal,
            "deposit_required": 0,
            "notes": notes_text,
            "garden_details": garden_details if garden_details else {},
        }

        # Mark enquiry as quoted
        self.enquiry_data["status"] = "Quoted"
        if "status" in self._fields:
            self._fields["status"].set("Quoted")
        self._save()

        # Link quote number back to enquiry after save
        enquiry_id = self.enquiry_data.get("id", 0)

        def _on_quote_saved():
            """After the quote is saved, link quote_number back to enquiry."""
            try:
                if enquiry_id:
                    # Find the most recent quote for this enquiry
                    q = self.db.fetchone(
                        "SELECT quote_number FROM quotes WHERE enquiry_id = ? ORDER BY id DESC LIMIT 1",
                        (enquiry_id,)
                    )
                    if q and q["quote_number"]:
                        self.db.execute(
                            "UPDATE enquiries SET quote_number = ? WHERE id = ?",
                            (q["quote_number"], enquiry_id)
                        )
                        self.db.commit()
            except Exception:
                pass

        # Open quote modal with pre-filled pricing data
        QuoteModal(
            self.master, quote_data, self.db, self.sync,
            on_save=_on_quote_saved,
            email_engine=self.email_engine,
        )
