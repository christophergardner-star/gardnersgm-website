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
        screen_h = self.winfo_screenheight()
        win_h = min(700, screen_h - 80)
        self.geometry(f"520x{win_h}")
        self.resizable(False, True)
        self.configure(fg_color=theme.BG_DARK)
        self.transient(parent)
        self.grab_set()

        self.update_idletasks()
        px = parent.winfo_rootx() + (parent.winfo_width() - 520) // 2
        py = parent.winfo_rooty() + (parent.winfo_height() - win_h) // 2
        py = min(py, screen_h - win_h - 40)
        self.geometry(f"+{max(px,0)}+{max(py,0)}")

        self._build_ui()

    def _build_ui(self):
        container = ctk.CTkScrollableFrame(self, fg_color=theme.BG_DARK)
        container.pack(fill="both", expand=True)

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
            ("name",    "Name",    "entry"),
            ("email",   "Email",   "entry"),
            ("phone",   "Phone",   "entry"),
            ("type",    "Type",    "dropdown", config.ENQUIRY_TYPE_OPTIONS),
            ("status",  "Status",  "dropdown", config.ENQUIRY_STATUS_OPTIONS),
            ("date",    "Date",    "entry"),
            ("replied", "Replied", "dropdown", config.REPLIED_OPTIONS),
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

        # ── Garden Details (parsed from GARDEN_JSON in message/notes) ──
        import re as _re
        gd = {}
        for raw_field in ["message", "notes"]:
            raw = self.enquiry_data.get(raw_field, "") or ""
            gj_match = _re.search(r'GARDEN_JSON:(\{.*?\})', raw)
            if gj_match and not gd:
                try:
                    gd = json.loads(gj_match.group(1))
                except Exception:
                    pass
        # Also parse "Garden: size:Medium, areas:Both" format from message
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

            for idx, (label, value) in enumerate(gd_items):
                r, c = divmod(idx, 2)
                cell = ctk.CTkFrame(gd_grid, fg_color="transparent")
                cell.grid(row=r, column=c, padx=6, pady=3, sticky="w")
                ctk.CTkLabel(cell, text=f"{label}: {(value or '').title()}",
                             font=theme.font_bold(12),
                             text_color=theme.TEXT_LIGHT, anchor="w").pack(anchor="w")

        # ── Actions ──
        actions = ctk.CTkFrame(container, fg_color="transparent")
        actions.pack(fill="x", padx=16, pady=(8, 16))

        theme.create_accent_button(
            actions, "💾 Save",
            command=self._save, width=120,
        ).pack(side="left", padx=(0, 8))

        if self.enquiry_data.get("replied") != "Yes":
            theme.create_outline_button(
                actions, "✅ Mark Replied",
                command=self._mark_replied, width=130,
            ).pack(side="left", padx=4)

        # Email reply via GAS
        if self.enquiry_data.get("email") and self.email_engine:
            theme.create_outline_button(
                actions, "📧 Send Reply Email",
                command=self._send_reply_email, width=150,
            ).pack(side="left", padx=4)

        # Convert to quote
        theme.create_outline_button(
            actions, "📋 → Quote",
            command=self._convert_to_quote, width=110,
        ).pack(side="left", padx=4)

        # Convert to client
        theme.create_outline_button(
            actions, "👤 → Client",
            command=self._convert_to_client, width=110,
        ).pack(side="left", padx=4)

        ctk.CTkButton(
            actions, text="Cancel", width=80,
            fg_color=theme.BG_CARD, hover_color=theme.RED,
            corner_radius=8, font=theme.font(12),
            command=self.destroy,
        ).pack(side="right")

        # Delete button (only for existing enquiries)
        if self.enquiry_data.get("id"):
            ctk.CTkButton(
                actions, text="🗑️ Delete", width=90,
                fg_color="#7f1d1d", hover_color=theme.RED,
                text_color="#fca5a5", corner_radius=8,
                font=theme.font(12, "bold"),
                command=self._confirm_delete,
            ).pack(side="right", padx=(0, 8))

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

        # Open quote modal with pre-filled pricing data
        QuoteModal(
            self.master, quote_data, self.db, self.sync,
            on_save=None,
            email_engine=self.email_engine,
        )
