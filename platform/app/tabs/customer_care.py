"""
Customer Care Tab — Complaints management and email workflow tracking.
Replicates the admin-complaints.html functionality.
"""

import customtkinter as ctk
from datetime import date, datetime

from ..ui import theme
from ..ui.components.kpi_card import KPICard
from ..ui.components.data_table import DataTable
from .. import config


class CustomerCareTab(ctk.CTkFrame):
    """Customer care with complaints management and resolution workflow."""

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
        self._switch_sub("complaints")

    # ------------------------------------------------------------------
    # Sub-Tabs
    # ------------------------------------------------------------------
    def _build_sub_tabs(self):
        tab_bar = ctk.CTkFrame(self, fg_color=theme.BG_CARD, height=44, corner_radius=0)
        tab_bar.grid(row=0, column=0, sticky="ew")
        tab_bar.grid_columnconfigure(10, weight=1)

        tabs = [
            ("complaints", "📋 Complaints"),
            ("emails",     "📧 Email Tracking"),
        ]

        for i, (key, text) in enumerate(tabs):
            btn = ctk.CTkButton(
                tab_bar, text=text, font=theme.font(13),
                fg_color="transparent", hover_color=theme.BG_CARD_HOVER,
                text_color=theme.TEXT_DIM, corner_radius=0,
                height=40, width=160,
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
        self._build_complaints_panel()
        self._build_emails_panel()

    # ------------------------------------------------------------------
    # Complaints Panel
    # ------------------------------------------------------------------
    def _build_complaints_panel(self):
        frame = ctk.CTkFrame(self, fg_color="transparent")
        self._sub_frames["complaints"] = frame

        frame.grid_columnconfigure(0, weight=1)
        frame.grid_rowconfigure(2, weight=1)

        # KPI Row
        kpi_frame = ctk.CTkFrame(frame, fg_color="transparent")
        kpi_frame.grid(row=0, column=0, sticky="ew", padx=12, pady=(12, 4))
        for i in range(4):
            kpi_frame.grid_columnconfigure(i, weight=1)

        kpis = [
            ("total",    "📋", "0", "Total"),
            ("open",     "🔴", "0", "Open"),
            ("invest",   "🔍", "0", "Investigating"),
            ("resolved", "✅", "0", "Resolved"),
        ]
        for i, (key, icon, default, label) in enumerate(kpis):
            card = KPICard(kpi_frame, icon=icon, value=default, label=label)
            card.grid(row=0, column=i, padx=6, pady=4, sticky="nsew")
            self._kpi_cards[key] = card

        # Action bar
        action_bar = ctk.CTkFrame(frame, fg_color="transparent")
        action_bar.grid(row=1, column=0, sticky="ew", padx=12, pady=(4, 4))
        action_bar.grid_columnconfigure(1, weight=1)

        theme.create_accent_button(
            action_bar, "＋ New Complaint",
            command=self._add_complaint, width=140,
        ).grid(row=0, column=0, padx=(0, 8))

        # Filters
        filter_frame = ctk.CTkFrame(action_bar, fg_color="transparent")
        filter_frame.grid(row=0, column=1, sticky="e")

        ctk.CTkLabel(filter_frame, text="Status:", font=theme.font(11),
                     text_color=theme.TEXT_DIM).pack(side="left", padx=(0, 4))
        self._complaint_status_filter = ctk.CTkComboBox(
            filter_frame,
            values=["All"] + config.COMPLAINT_STATUS_OPTIONS,
            width=120, font=theme.font(11),
            command=lambda _: self._refresh_subtab("complaints"),
        )
        self._complaint_status_filter.set("All")
        self._complaint_status_filter.pack(side="left", padx=4)

        ctk.CTkLabel(filter_frame, text="Severity:", font=theme.font(11),
                     text_color=theme.TEXT_DIM).pack(side="left", padx=(12, 4))
        self._complaint_severity_filter = ctk.CTkComboBox(
            filter_frame,
            values=["All"] + config.COMPLAINT_SEVERITY_OPTIONS,
            width=120, font=theme.font(11),
            command=lambda _: self._refresh_subtab("complaints"),
        )
        self._complaint_severity_filter.set("All")
        self._complaint_severity_filter.pack(side="left", padx=4)

        # Table
        columns = [
            {"key": "complaint_ref", "label": "Ref",        "width": 80},
            {"key": "client_name",   "label": "Client",     "width": 150},
            {"key": "client_type",   "label": "Type",       "width": 90},
            {"key": "service",       "label": "Service",    "width": 120},
            {"key": "severity",      "label": "Severity",   "width": 90},
            {"key": "description",   "label": "Description","width": 250},
            {"key": "status",        "label": "Status",     "width": 100},
            {"key": "created_at",    "label": "Date",       "width": 100},
        ]

        self.complaints_table = DataTable(
            frame, columns=columns,
            on_double_click=self._open_complaint,
        )
        self.complaints_table.grid(row=2, column=0, sticky="nsew", padx=12, pady=(4, 12))

    # ------------------------------------------------------------------
    # Email Tracking Panel
    # ------------------------------------------------------------------
    def _build_emails_panel(self):
        frame = ctk.CTkScrollableFrame(self, fg_color="transparent")
        self._sub_frames["emails"] = frame

        # Header
        header = ctk.CTkFrame(frame, fg_color="transparent")
        header.pack(fill="x", padx=16, pady=(16, 4))
        header.grid_columnconfigure(1, weight=1)

        ctk.CTkLabel(
            header, text="📧 Email Lifecycle Tracking",
            font=theme.font_bold(16), text_color=theme.TEXT_LIGHT, anchor="w",
        ).grid(row=0, column=0, sticky="w")

        theme.create_accent_button(
            header, "＋ Log Email",
            command=self._log_email_modal, width=120,
        ).grid(row=0, column=2, sticky="e")

        ctk.CTkLabel(
            frame, text="Track every automated email sent to clients through their journey.",
            font=theme.font(12), text_color=theme.TEXT_DIM, anchor="w",
        ).pack(fill="x", padx=16, pady=(0, 12))

        # KPI row for email stats
        email_kpi_frame = ctk.CTkFrame(frame, fg_color="transparent")
        email_kpi_frame.pack(fill="x", padx=16, pady=(0, 12))
        for i in range(4):
            email_kpi_frame.grid_columnconfigure(i, weight=1)

        email_kpis = [
            ("em_total",    "📧", "0", "Emails Sent"),
            ("em_clients",  "👥", "0", "Clients Reached"),
            ("em_recent",   "🕐", "-", "Last Sent"),
            ("em_top_type", "📊", "-", "Top Type"),
        ]
        for i, (key, icon, default, label) in enumerate(email_kpis):
            card = KPICard(email_kpi_frame, icon=icon, value=default, label=label)
            card.grid(row=0, column=i, padx=6, pady=4, sticky="nsew")
            self._kpi_cards[key] = card

        # Pipeline overview card — shows counts per stage
        pipeline_card = ctk.CTkFrame(frame, fg_color=theme.BG_CARD, corner_radius=12)
        pipeline_card.pack(fill="x", padx=16, pady=(0, 8))

        ctk.CTkLabel(
            pipeline_card, text="📊 Email Pipeline Overview",
            font=theme.font_bold(15), text_color=theme.TEXT_LIGHT, anchor="w",
        ).pack(fill="x", padx=16, pady=(14, 8))

        self._pipeline_container = ctk.CTkFrame(pipeline_card, fg_color="transparent")
        self._pipeline_container.pack(fill="x", padx=16, pady=(0, 14))

        # Filter bar
        filter_card = ctk.CTkFrame(frame, fg_color=theme.BG_CARD, corner_radius=12)
        filter_card.pack(fill="x", padx=16, pady=(8, 4))

        filter_inner = ctk.CTkFrame(filter_card, fg_color="transparent")
        filter_inner.pack(fill="x", padx=16, pady=10)

        ctk.CTkLabel(filter_inner, text="Filter:", font=theme.font(11),
                     text_color=theme.TEXT_DIM).pack(side="left", padx=(0, 8))

        self._email_type_filter = ctk.CTkComboBox(
            filter_inner,
            values=["All Types"] + [s["label"] for s in config.EMAIL_LIFECYCLE_STAGES],
            width=200, font=theme.font(11),
            command=lambda _: self._refresh_subtab("emails"),
        )
        self._email_type_filter.set("All Types")
        self._email_type_filter.pack(side="left", padx=(0, 12))

        ctk.CTkLabel(filter_inner, text="Client:", font=theme.font(11),
                     text_color=theme.TEXT_DIM).pack(side="left", padx=(0, 8))

        self._email_client_filter = ctk.CTkComboBox(
            filter_inner,
            values=["All Clients"],
            width=180, font=theme.font(11),
            command=lambda _: self._refresh_subtab("emails"),
        )
        self._email_client_filter.set("All Clients")
        self._email_client_filter.pack(side="left", padx=(0, 12))

        # Email history table
        email_table_card = ctk.CTkFrame(frame, fg_color=theme.BG_CARD, corner_radius=12)
        email_table_card.pack(fill="x", padx=16, pady=(4, 8))
        email_table_card.grid_columnconfigure(0, weight=1)
        email_table_card.grid_rowconfigure(1, weight=1)

        ctk.CTkLabel(
            email_table_card, text="📬 Email Log",
            font=theme.font_bold(15), text_color=theme.TEXT_LIGHT, anchor="w",
        ).grid(row=0, column=0, padx=16, pady=(14, 8), sticky="w")

        email_columns = [
            {"key": "sent_at_display", "label": "Date",    "width": 120},
            {"key": "client_name",     "label": "Client",  "width": 150},
            {"key": "email_type_label","label": "Type",    "width": 170},
            {"key": "subject",         "label": "Subject", "width": 250},
            {"key": "status",          "label": "Status",  "width": 80},
        ]

        self.email_tracking_table = DataTable(
            email_table_card, columns=email_columns,
            on_double_click=self._view_email_detail,
        )
        self.email_tracking_table.grid(row=1, column=0, sticky="nsew", padx=12, pady=(4, 12))

        # Newsletter log section
        nl_card = ctk.CTkFrame(frame, fg_color=theme.BG_CARD, corner_radius=12)
        nl_card.pack(fill="x", padx=16, pady=(8, 16))

        ctk.CTkLabel(
            nl_card, text="📨 Newsletter Send History",
            font=theme.font_bold(15), text_color=theme.TEXT_LIGHT, anchor="w",
        ).pack(fill="x", padx=16, pady=(14, 8))

        self._newsletter_container = ctk.CTkFrame(nl_card, fg_color="transparent")
        self._newsletter_container.pack(fill="x", padx=16, pady=(0, 14))

    def _log_email_modal(self):
        """Open modal to manually log an email sent outside the system."""
        modal = ctk.CTkToplevel(self)
        modal.title("Log Email")
        modal.geometry("500x550")
        modal.transient(self.winfo_toplevel())
        modal.grab_set()

        modal.update_idletasks()
        x = (modal.winfo_screenwidth() - 500) // 2
        y = (modal.winfo_screenheight() - 550) // 2
        modal.geometry(f"500x550+{x}+{y}")

        scroll = ctk.CTkScrollableFrame(modal, fg_color=theme.BG_DARK)
        scroll.pack(fill="both", expand=True)

        ctk.CTkLabel(
            scroll, text="📧 Log Email Sent",
            font=theme.font_heading(), text_color=theme.TEXT_LIGHT,
        ).pack(fill="x", padx=20, pady=(20, 16))

        fields = {}

        # Client name
        ctk.CTkLabel(scroll, text="Client Name", font=theme.font(12),
                     text_color=theme.TEXT_DIM, anchor="w").pack(fill="x", padx=20, pady=(8, 2))
        name_entry = theme.create_entry(scroll, placeholder="Client name")
        name_entry.pack(fill="x", padx=20, pady=(0, 8))
        fields["client_name"] = name_entry

        # Client email
        ctk.CTkLabel(scroll, text="Client Email", font=theme.font(12),
                     text_color=theme.TEXT_DIM, anchor="w").pack(fill="x", padx=20, pady=(0, 2))
        email_entry = theme.create_entry(scroll, placeholder="client@email.com")
        email_entry.pack(fill="x", padx=20, pady=(0, 8))
        fields["client_email"] = email_entry

        # Email type
        ctk.CTkLabel(scroll, text="Email Type", font=theme.font(12),
                     text_color=theme.TEXT_DIM, anchor="w").pack(fill="x", padx=20, pady=(0, 2))
        type_combo = ctk.CTkComboBox(
            scroll,
            values=[s["label"] for s in config.EMAIL_LIFECYCLE_STAGES],
            width=300, font=theme.font(13),
        )
        type_combo.set(config.EMAIL_LIFECYCLE_STAGES[0]["label"])
        type_combo.pack(fill="x", padx=20, pady=(0, 8))
        fields["email_type"] = type_combo

        # Subject
        ctk.CTkLabel(scroll, text="Subject", font=theme.font(12),
                     text_color=theme.TEXT_DIM, anchor="w").pack(fill="x", padx=20, pady=(0, 2))
        subject_entry = theme.create_entry(scroll, placeholder="Email subject line")
        subject_entry.pack(fill="x", padx=20, pady=(0, 8))
        fields["subject"] = subject_entry

        # Status
        ctk.CTkLabel(scroll, text="Status", font=theme.font(12),
                     text_color=theme.TEXT_DIM, anchor="w").pack(fill="x", padx=20, pady=(0, 2))
        status_combo = ctk.CTkComboBox(
            scroll, values=["sent", "failed", "pending"],
            width=300, font=theme.font(13),
        )
        status_combo.set("sent")
        status_combo.pack(fill="x", padx=20, pady=(0, 8))
        fields["status"] = status_combo

        # Notes
        ctk.CTkLabel(scroll, text="Notes", font=theme.font(12),
                     text_color=theme.TEXT_DIM, anchor="w").pack(fill="x", padx=20, pady=(0, 2))
        notes_text = ctk.CTkTextbox(
            scroll, height=60,
            fg_color=theme.BG_INPUT, font=theme.font(13),
            text_color=theme.TEXT_LIGHT, corner_radius=8,
        )
        notes_text.pack(fill="x", padx=20, pady=(0, 8))
        fields["notes"] = notes_text

        def save():
            # Reverse-lookup email type from label
            selected_label = fields["email_type"].get()
            email_type_key = ""
            for stage in config.EMAIL_LIFECYCLE_STAGES:
                if stage["label"] == selected_label:
                    email_type_key = stage["type"]
                    break

            # Try to find client_id from name
            client_name = fields["client_name"].get().strip()
            client_id = 0
            if client_name:
                clients = self.db.get_clients(search=client_name, limit=1)
                if clients:
                    client_id = clients[0].get("id", 0)

            self.db.log_email(
                client_id=client_id,
                client_name=client_name,
                client_email=fields["client_email"].get().strip(),
                email_type=email_type_key,
                subject=fields["subject"].get().strip(),
                status=fields["status"].get(),
                notes=fields["notes"].get("1.0", "end").strip(),
            )

            modal.destroy()
            self.app.show_toast("Email logged", "success")
            self._refresh_subtab("emails")

        btn_frame = ctk.CTkFrame(scroll, fg_color="transparent")
        btn_frame.pack(fill="x", padx=20, pady=(16, 20))

        theme.create_accent_button(
            btn_frame, "💾 Log Email", command=save, width=140,
        ).pack(side="left", padx=(0, 8))

        ctk.CTkButton(
            btn_frame, text="Cancel", width=80, height=36,
            fg_color="transparent", hover_color=theme.BG_CARD_HOVER,
            border_width=1, border_color=theme.TEXT_DIM,
            text_color=theme.TEXT_DIM, corner_radius=8,
            command=modal.destroy,
        ).pack(side="left")

    # ------------------------------------------------------------------
    # Complaint Modal (inline)
    # ------------------------------------------------------------------
    def _add_complaint(self):
        self._open_complaint_modal({})

    def _open_complaint(self, values: dict):
        complaint_id = values.get("id")
        if complaint_id:
            complaint = self.db.get_complaint(complaint_id)
            if complaint:
                self._open_complaint_modal(complaint)

    def _open_complaint_modal(self, data: dict):
        """Open complaint editor as a Toplevel window."""
        modal = ctk.CTkToplevel(self)
        modal.title("Complaint" if data.get("id") else "New Complaint")
        modal.geometry("600x700")
        modal.transient(self.winfo_toplevel())
        modal.grab_set()

        # Center
        modal.update_idletasks()
        x = (modal.winfo_screenwidth() - 600) // 2
        y = (modal.winfo_screenheight() - 700) // 2
        modal.geometry(f"600x700+{x}+{y}")

        scroll = ctk.CTkScrollableFrame(modal, fg_color=theme.BG_DARK)
        scroll.pack(fill="both", expand=True)

        ctk.CTkLabel(
            scroll,
            text="📋 Complaint Details",
            font=theme.font_heading(), text_color=theme.TEXT_LIGHT,
        ).pack(fill="x", padx=20, pady=(20, 16))

        fields = {}

        def add_field(label: str, key: str, options=None, height=None):
            ctk.CTkLabel(
                scroll, text=label, font=theme.font(12),
                text_color=theme.TEXT_DIM, anchor="w",
            ).pack(fill="x", padx=20, pady=(8, 2))

            if options:
                widget = ctk.CTkComboBox(
                    scroll, values=options, width=300,
                    font=theme.font(13),
                )
                widget.set(str(data.get(key, options[0])))
                widget.pack(fill="x", padx=20, pady=(0, 4))
            elif height:
                widget = ctk.CTkTextbox(
                    scroll, height=height,
                    fg_color=theme.BG_INPUT, font=theme.font(13),
                    text_color=theme.TEXT_LIGHT, corner_radius=8,
                )
                widget.insert("1.0", str(data.get(key, "")))
                widget.pack(fill="x", padx=20, pady=(0, 4))
            else:
                widget = theme.create_entry(scroll, width=300)
                widget.insert(0, str(data.get(key, "")))
                widget.pack(fill="x", padx=20, pady=(0, 4))

            fields[key] = widget

        add_field("Complaint Reference", "complaint_ref")
        add_field("Client Name", "client_name")
        add_field("Client Type", "client_type", config.COMPLAINT_TYPE_OPTIONS)
        add_field("Service", "service", config.SERVICES)
        add_field("Severity", "severity", config.COMPLAINT_SEVERITY_OPTIONS)
        add_field("Status", "status", config.COMPLAINT_STATUS_OPTIONS)
        add_field("Description", "description", height=80)

        # Resolution section
        client_type = data.get("client_type", "Subscriber")
        resolutions = config.RESOLUTION_SUBSCRIBER if client_type == "Subscriber" else config.RESOLUTION_ONEOFF
        res_options = [r[1] for r in resolutions]
        add_field("Resolution", "resolution", ["None"] + res_options)
        add_field("Resolution Details", "resolution_details", height=60)
        add_field("Admin Notes", "admin_notes", height=60)

        # Save button
        def save():
            result = {"id": data.get("id")}
            for key, widget in fields.items():
                if isinstance(widget, ctk.CTkTextbox):
                    result[key] = widget.get("1.0", "end").strip()
                elif isinstance(widget, ctk.CTkComboBox):
                    result[key] = widget.get()
                else:
                    result[key] = widget.get().strip()

            if not result.get("complaint_ref"):
                # Auto-generate ref
                result["complaint_ref"] = f"CMP-{datetime.now().strftime('%Y%m%d%H%M')}"

            self.db.save_complaint(result)
            modal.destroy()
            self.app.show_toast("Complaint saved", "success")
            self._refresh_subtab("complaints")

        btn_frame = ctk.CTkFrame(scroll, fg_color="transparent")
        btn_frame.pack(fill="x", padx=20, pady=(16, 20))

        theme.create_accent_button(
            btn_frame, "💾 Save Complaint",
            command=save, width=160,
        ).pack(side="left", padx=(0, 8))

        ctk.CTkButton(
            btn_frame, text="Cancel", width=80, height=36,
            fg_color="transparent", hover_color=theme.BG_CARD_HOVER,
            border_width=1, border_color=theme.TEXT_DIM,
            text_color=theme.TEXT_DIM, corner_radius=8,
            command=modal.destroy,
        ).pack(side="left")

    # ------------------------------------------------------------------
    # Data
    # ------------------------------------------------------------------
    def _refresh_subtab(self, key: str):
        try:
            if key == "complaints":
                self._load_complaints()
            elif key == "emails":
                self._load_email_tracking()
                self._load_newsletters()
        except Exception:
            import traceback
            traceback.print_exc()

    def _load_complaints(self):
        status_val = self._complaint_status_filter.get()
        severity_val = self._complaint_severity_filter.get()

        status = status_val if status_val != "All" else None
        severity = severity_val if severity_val != "All" else None

        complaints = self.db.get_complaints(status=status, severity=severity)

        # KPIs
        all_complaints = self.db.get_complaints()
        self._kpi_cards["total"].set_value(str(len(all_complaints)))
        self._kpi_cards["open"].set_value(
            str(sum(1 for c in all_complaints if c.get("status") == "Open"))
        )
        self._kpi_cards["invest"].set_value(
            str(sum(1 for c in all_complaints if c.get("status") == "Investigating"))
        )
        self._kpi_cards["resolved"].set_value(
            str(sum(1 for c in all_complaints if c.get("status") == "Resolved"))
        )

        # Table
        rows = []
        for c in complaints:
            rows.append({
                "id": c.get("id", ""),
                "complaint_ref": c.get("complaint_ref", ""),
                "client_name": c.get("client_name", ""),
                "client_type": c.get("client_type", ""),
                "service": c.get("service", ""),
                "severity": c.get("severity", ""),
                "description": (c.get("description", "") or "")[:60],
                "status": c.get("status", ""),
                "created_at": (c.get("created_at", "") or "")[:10],
            })

        self.complaints_table.set_data(rows)

    def _load_email_tracking(self):
        """Load real email tracking data into KPIs, pipeline, and table."""
        # Email stats KPIs
        stats = self.db.get_email_stats()
        self._kpi_cards["em_total"].set_value(str(stats.get("total", 0)))
        self._kpi_cards["em_clients"].set_value(str(stats.get("clients_reached", 0)))

        last_sent = stats.get("last_sent", "Never")
        if last_sent and last_sent != "Never":
            last_sent = last_sent[:10]
        self._kpi_cards["em_recent"].set_value(last_sent)

        by_type = stats.get("by_type", {})
        if by_type:
            top = max(by_type, key=by_type.get)
            top_label = config.EMAIL_TYPE_LABELS.get(top, top)
            self._kpi_cards["em_top_type"].set_value(top_label[:18])
        else:
            self._kpi_cards["em_top_type"].set_value("—")

        # Pipeline overview — show count per stage
        for w in self._pipeline_container.winfo_children():
            w.destroy()

        color_map = {
            "blue": theme.BLUE, "amber": theme.AMBER, "green": theme.GREEN_PRIMARY,
            "purple": theme.PURPLE, "green_light": theme.GREEN_LIGHT,
            "green_accent": theme.GREEN_ACCENT,
        }

        for stage in config.EMAIL_LIFECYCLE_STAGES:
            count = by_type.get(stage["type"], 0)
            stage_color = color_map.get(stage.get("color", "blue"), theme.BLUE)

            row = ctk.CTkFrame(self._pipeline_container, fg_color=theme.BG_INPUT, corner_radius=8)
            row.pack(fill="x", pady=2)
            row.grid_columnconfigure(1, weight=1)

            ctk.CTkFrame(row, width=4, fg_color=stage_color, corner_radius=2).grid(
                row=0, column=0, sticky="ns"
            )

            ctk.CTkLabel(
                row, text=stage["label"], font=theme.font_bold(12),
                text_color=theme.TEXT_LIGHT, anchor="w",
            ).grid(row=0, column=1, padx=12, pady=8, sticky="w")

            ctk.CTkLabel(
                row, text=stage["description"], font=theme.font(10),
                text_color=theme.TEXT_DIM, anchor="w",
            ).grid(row=0, column=2, padx=8, pady=8, sticky="w")

            ctk.CTkLabel(
                row, text=str(count), font=theme.font_bold(14),
                text_color=stage_color if count > 0 else theme.TEXT_DIM,
                width=50,
            ).grid(row=0, column=3, padx=12, pady=8)

        # Update client filter dropdown
        all_emails = self.db.get_email_tracking()
        unique_clients = sorted(set(
            e.get("client_name", "") for e in all_emails if e.get("client_name")
        ))
        self._email_client_filter.configure(values=["All Clients"] + unique_clients)

        # Apply filters for the table
        type_filter = self._email_type_filter.get()
        client_filter = self._email_client_filter.get()

        email_type = None
        if type_filter != "All Types":
            for stage in config.EMAIL_LIFECYCLE_STAGES:
                if stage["label"] == type_filter:
                    email_type = stage["type"]
                    break

        client_id = None
        if client_filter != "All Clients":
            # Find client_id from name
            for e in all_emails:
                if e.get("client_name") == client_filter:
                    client_id = e.get("client_id")
                    break

        filtered = self.db.get_email_tracking(client_id=client_id, email_type=email_type)

        # Populate table
        rows = []
        for e in filtered:
            etype = e.get("email_type", "")
            rows.append({
                "id": e.get("id", ""),
                "sent_at_display": (e.get("sent_at", "") or "")[:16],
                "client_name": e.get("client_name", ""),
                "email_type_label": config.EMAIL_TYPE_LABELS.get(etype, etype),
                "subject": (e.get("subject", "") or "")[:50],
                "status": e.get("status", ""),
            })

        self.email_tracking_table.set_data(rows)

    def _load_newsletters(self):
        for w in self._newsletter_container.winfo_children():
            w.destroy()

        logs = self.db.get_newsletter_log(limit=10)
        if not logs:
            ctk.CTkLabel(
                self._newsletter_container,
                text="No newsletters sent yet",
                font=theme.font(12), text_color=theme.TEXT_DIM,
            ).pack(pady=8)
            return

        for log in logs:
            row = ctk.CTkFrame(self._newsletter_container, fg_color=theme.BG_INPUT, corner_radius=8)
            row.pack(fill="x", pady=3)
            row.grid_columnconfigure(1, weight=1)

            ctk.CTkLabel(
                row, text=log.get("subject", ""),
                font=theme.font_bold(12), text_color=theme.TEXT_LIGHT,
                anchor="w",
            ).grid(row=0, column=0, padx=12, pady=8, sticky="w")

            ctk.CTkLabel(
                row, text=f"To: {log.get('target', 'All')}  •  ✅ {log.get('sent_count', 0)} sent  •  ❌ {log.get('failed_count', 0)} failed",
                font=theme.font(11), text_color=theme.TEXT_DIM,
                anchor="w",
            ).grid(row=0, column=1, padx=8, pady=8, sticky="w")

            ctk.CTkLabel(
                row, text=(log.get("sent_date", "") or "")[:10],
                font=theme.font(11), text_color=theme.TEXT_DIM,
            ).grid(row=0, column=2, padx=12, pady=8)

    # ------------------------------------------------------------------
    # Refresh
    # ------------------------------------------------------------------
    def refresh(self):
        if self._current_sub:
            self._refresh_subtab(self._current_sub)

    def on_table_update(self, table_name: str):
        """Auto-refresh when sync updates relevant tables."""
        if table_name in ("complaints", "email_tracking", "enquiries", "clients"):
            if self._current_sub:
                self._refresh_subtab(self._current_sub)

    def _view_email_detail(self, values: dict):
        """Double-click an email tracking row — show detail popup."""
        import customtkinter as ctk
        from ..ui import theme

        popup = ctk.CTkToplevel(self)
        popup.title(f"Email Detail")
        popup.geometry("500x300")
        popup.configure(fg_color=theme.BG_DARK)
        popup.transient(self)
        popup.grab_set()

        self.update_idletasks()
        px = self.winfo_rootx() + 100
        py = self.winfo_rooty() + 80
        popup.geometry(f"+{max(px,0)}+{max(py,0)}")

        details = [
            ("📅 Date", values.get("sent_at_display", "")),
            ("👤 Client", values.get("client_name", "")),
            ("📨 Type", values.get("email_type_label", "")),
            ("📝 Subject", values.get("subject", "")),
            ("Status", values.get("status", "")),
        ]

        for label, val in details:
            row = ctk.CTkFrame(popup, fg_color="transparent")
            row.pack(fill="x", padx=16, pady=4)
            ctk.CTkLabel(
                row, text=label, font=theme.font_bold(12),
                text_color=theme.TEXT_DIM, width=100, anchor="e",
            ).pack(side="left", padx=(0, 8))
            ctk.CTkLabel(
                row, text=val, font=theme.font(12),
                text_color=theme.TEXT_LIGHT, anchor="w",
            ).pack(side="left", fill="x", expand=True)

        btn_row = ctk.CTkFrame(popup, fg_color="transparent")
        btn_row.pack(fill="x", padx=16, pady=(16, 12))

        # Open client if name matches
        client_name = values.get("client_name", "")
        if client_name:
            def _open_client():
                from ..ui.components.client_modal import ClientModal
                clients = self.db.get_clients(search=client_name)
                if clients:
                    ClientModal(
                        popup, clients[0], self.db, self.sync,
                        on_save=lambda: self._refresh_subtab("emails"),
                    )
            ctk.CTkButton(
                btn_row, text="👤 Open Client", width=120,
                fg_color=theme.GREEN_PRIMARY, hover_color=theme.GREEN_DARK,
                corner_radius=8, font=theme.font(12),
                command=_open_client,
            ).pack(side="left", padx=(0, 8))

        ctk.CTkButton(
            btn_row, text="Close", width=80,
            fg_color=theme.BG_CARD, hover_color=theme.RED,
            corner_radius=8, font=theme.font(12),
            command=popup.destroy,
        ).pack(side="right")
