"""
Admin Tab — Careers, Shop, Settings, Growth Milestones, Agents.
Replaces admin-careers.html, admin-shop.html, and settings from admin.html.
"""

import customtkinter as ctk
from datetime import date, datetime
import os
import threading
import json

from ..ui import theme
from ..ui.components.kpi_card import KPICard
from ..ui.components.data_table import DataTable
from .. import config


class AdminTab(ctk.CTkFrame):
    """Admin panel with careers, shop, milestones, settings, and agents."""

    def __init__(self, parent, db, sync, api, app_window, **kwargs):
        super().__init__(parent, fg_color=theme.BG_DARK, **kwargs)

        self.db = db
        self.sync = sync
        self.api = api
        self.app = app_window
        self._agent_scheduler = None  # set externally

        self._current_sub = None
        self._sub_buttons = {}
        self._sub_frames = {}

        self.grid_columnconfigure(0, weight=1)
        self.grid_rowconfigure(1, weight=1)

        self._build_sub_tabs()
        self._build_panels()
        self._switch_sub("careers")

    # ------------------------------------------------------------------
    # Sub-Tabs
    # ------------------------------------------------------------------
    def _build_sub_tabs(self):
        tab_bar = ctk.CTkFrame(self, fg_color=theme.BG_CARD, height=44, corner_radius=0)
        tab_bar.grid(row=0, column=0, sticky="ew")
        tab_bar.grid_columnconfigure(10, weight=1)

        tabs = [
            ("careers",    "💼 Careers"),
            ("shop",       "🛒 Shop"),
            ("agents",     "🤖 Agents"),
            ("strategy",   "📊 Strategy"),
            ("milestones", "🎯 Growth"),
            ("settings",   "⚙️ Settings"),
        ]

        for i, (key, text) in enumerate(tabs):
            btn = ctk.CTkButton(
                tab_bar, text=text, font=theme.font(13),
                fg_color="transparent", hover_color=theme.BG_CARD_HOVER,
                text_color=theme.TEXT_DIM, corner_radius=0,
                height=40, width=140,
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
        self._build_careers_panel()
        self._build_shop_panel()
        self._build_agents_panel()
        self._build_strategy_panel()
        self._build_milestones_panel()
        self._build_settings_panel()

    # ------------------------------------------------------------------
    # Careers Panel
    # ------------------------------------------------------------------
    def _build_careers_panel(self):
        frame = ctk.CTkFrame(self, fg_color="transparent")
        self._sub_frames["careers"] = frame

        frame.grid_columnconfigure(0, weight=1)
        frame.grid_rowconfigure(2, weight=1)

        # Action bar
        action_bar = ctk.CTkFrame(frame, fg_color="transparent")
        action_bar.grid(row=0, column=0, sticky="ew", padx=12, pady=(12, 4))
        action_bar.grid_columnconfigure(1, weight=1)

        theme.create_accent_button(
            action_bar, "＋ New Vacancy",
            command=self._add_vacancy, width=130,
        ).grid(row=0, column=0, padx=(0, 8))

        ctk.CTkLabel(
            action_bar, text="💼 Vacancies & Applications",
            font=theme.font_bold(15), text_color=theme.TEXT_LIGHT,
        ).grid(row=0, column=0, sticky="w", padx=(140, 0))

        # Vacancies table
        ctk.CTkLabel(
            frame, text="Open Vacancies", font=theme.font_bold(13),
            text_color=theme.TEXT_DIM, anchor="w",
        ).grid(row=1, column=0, sticky="w", padx=16, pady=(8, 2))

        vac_columns = [
            {"key": "title",       "label": "Position",    "width": 200},
            {"key": "department",  "label": "Department",  "width": 120},
            {"key": "location",    "label": "Location",    "width": 120},
            {"key": "salary",      "label": "Salary",      "width": 100},
            {"key": "status",      "label": "Status",      "width": 90},
            {"key": "posted_date", "label": "Posted",      "width": 100},
        ]

        self.vacancies_table = DataTable(
            frame, columns=vac_columns,
            on_double_click=self._open_vacancy,
        )
        self.vacancies_table.grid(row=2, column=0, sticky="nsew", padx=12, pady=(4, 8))

        # Applications section
        ctk.CTkLabel(
            frame, text="📄 Applications", font=theme.font_bold(13),
            text_color=theme.TEXT_DIM, anchor="w",
        ).grid(row=3, column=0, sticky="w", padx=16, pady=(8, 2))

        app_columns = [
            {"key": "name",       "label": "Name",       "width": 150},
            {"key": "email",      "label": "Email",      "width": 180},
            {"key": "position",   "label": "Position",   "width": 150},
            {"key": "status",     "label": "Status",     "width": 100},
            {"key": "created_at", "label": "Applied",    "width": 100},
        ]

        self.applications_table = DataTable(
            frame, columns=app_columns,
            on_double_click=self._open_application,
        )
        self.applications_table.grid(row=4, column=0, sticky="nsew", padx=12, pady=(4, 12))
        frame.grid_rowconfigure(4, weight=1)

    # ------------------------------------------------------------------
    # Shop Panel
    # ------------------------------------------------------------------
    def _build_shop_panel(self):
        frame = ctk.CTkFrame(self, fg_color="transparent")
        self._sub_frames["shop"] = frame

        frame.grid_columnconfigure(0, weight=1)
        frame.grid_rowconfigure(2, weight=1)

        # Action bar
        action_bar = ctk.CTkFrame(frame, fg_color="transparent")
        action_bar.grid(row=0, column=0, sticky="ew", padx=12, pady=(12, 4))
        action_bar.grid_columnconfigure(1, weight=1)

        theme.create_accent_button(
            action_bar, "＋ New Product",
            command=self._add_product, width=130,
        ).grid(row=0, column=0, padx=(0, 8))

        ctk.CTkLabel(
            action_bar, text="🛒 Products & Orders",
            font=theme.font_bold(15), text_color=theme.TEXT_LIGHT,
        ).grid(row=0, column=0, sticky="w", padx=(140, 0))

        # Products table
        ctk.CTkLabel(
            frame, text="Products", font=theme.font_bold(13),
            text_color=theme.TEXT_DIM, anchor="w",
        ).grid(row=1, column=0, sticky="w", padx=16, pady=(8, 2))

        prod_columns = [
            {"key": "name",         "label": "Product",    "width": 200},
            {"key": "category",     "label": "Category",   "width": 120},
            {"key": "price_display","label": "Price",      "width": 80},
            {"key": "stock",        "label": "Stock",      "width": 70},
            {"key": "status",       "label": "Status",     "width": 90},
        ]

        self.products_table = DataTable(
            frame, columns=prod_columns,
            on_double_click=self._open_product,
        )
        self.products_table.grid(row=2, column=0, sticky="nsew", padx=12, pady=(4, 8))

        # Orders section
        ctk.CTkLabel(
            frame, text="📦 Orders", font=theme.font_bold(13),
            text_color=theme.TEXT_DIM, anchor="w",
        ).grid(row=3, column=0, sticky="w", padx=16, pady=(8, 2))

        order_columns = [
            {"key": "id",             "label": "Order #",   "width": 70},
            {"key": "customer_name",  "label": "Customer",  "width": 150},
            {"key": "product_name",   "label": "Product",   "width": 150},
            {"key": "quantity",       "label": "Qty",       "width": 50},
            {"key": "total_display",  "label": "Total",     "width": 80},
            {"key": "order_status",   "label": "Status",    "width": 100},
            {"key": "date",           "label": "Date",      "width": 100},
        ]

        self.orders_table = DataTable(
            frame, columns=order_columns,
            on_double_click=self._open_order,
        )
        self.orders_table.grid(row=4, column=0, sticky="nsew", padx=12, pady=(4, 12))
        frame.grid_rowconfigure(4, weight=1)

    # ------------------------------------------------------------------
    # Agents Panel
    # ------------------------------------------------------------------
    def _build_agents_panel(self):
        frame = ctk.CTkScrollableFrame(self, fg_color="transparent")
        self._sub_frames["agents"] = frame

        # Header
        header = ctk.CTkFrame(frame, fg_color="transparent")
        header.pack(fill="x", padx=16, pady=(16, 4))
        header.grid_columnconfigure(1, weight=1)

        ctk.CTkLabel(
            header, text="🤖 AI Agent Scheduler",
            font=theme.font_bold(16), text_color=theme.TEXT_LIGHT, anchor="w",
        ).grid(row=0, column=0, sticky="w")

        theme.create_accent_button(
            header, "＋ New Agent",
            command=self._add_agent, width=130,
        ).grid(row=0, column=2, sticky="e")

        # Ollama status
        self._ollama_status = ctk.CTkLabel(
            header, text="", font=theme.font(11), text_color=theme.TEXT_DIM,
        )
        self._ollama_status.grid(row=0, column=1, padx=16, sticky="e")

        ctk.CTkLabel(
            frame, text="Set up agents to automatically write blog posts and newsletters on a schedule.",
            font=theme.font(12), text_color=theme.TEXT_DIM, anchor="w",
        ).pack(fill="x", padx=16, pady=(0, 12))

        # Agent cards container
        self._agents_container = ctk.CTkFrame(frame, fg_color="transparent")
        self._agents_container.pack(fill="x", padx=16, pady=(0, 8))

        # Run history
        history_card = ctk.CTkFrame(frame, fg_color=theme.BG_CARD, corner_radius=12)
        history_card.pack(fill="x", padx=16, pady=(8, 16))

        history_header = ctk.CTkFrame(history_card, fg_color="transparent")
        history_header.pack(fill="x", padx=16, pady=(14, 8))
        history_header.grid_columnconfigure(0, weight=1)

        ctk.CTkLabel(
            history_header, text="📜 Agent Run History",
            font=theme.font_bold(15), text_color=theme.TEXT_LIGHT, anchor="w",
        ).grid(row=0, column=0, sticky="w")

        self._agent_runs_container = ctk.CTkFrame(history_card, fg_color="transparent")
        self._agent_runs_container.pack(fill="x", padx=16, pady=(0, 14))

    def _load_agents(self):
        """Refresh the agents panel with current data."""
        # Check Ollama status
        def check_ollama():
            from ..agents import is_ollama_available
            available = is_ollama_available()
            model = config.OLLAMA_MODEL or "none"
            if available:
                status_text = f"✅ Ollama online  •  Model: {model}"
                color = theme.GREEN_LIGHT
            else:
                status_text = "❌ Ollama offline — agents will fail"
                color = theme.RED
            try:
                self._ollama_status.configure(text=status_text, text_color=color)
            except Exception:
                pass

        threading.Thread(target=check_ollama, daemon=True).start()

        # Load agent schedules
        for w in self._agents_container.winfo_children():
            w.destroy()

        agents = self.db.get_agent_schedules()

        if not agents:
            ctk.CTkLabel(
                self._agents_container,
                text="No agents configured yet. Click '＋ New Agent' to create one.",
                font=theme.font(12), text_color=theme.TEXT_DIM,
            ).pack(pady=16)
        else:
            for agent in agents:
                self._render_agent_card(agent)

        # Load run history
        for w in self._agent_runs_container.winfo_children():
            w.destroy()

        runs = self.db.get_agent_runs(limit=15)
        if not runs:
            ctk.CTkLabel(
                self._agent_runs_container,
                text="No agent runs yet",
                font=theme.font(12), text_color=theme.TEXT_DIM,
            ).pack(pady=8)
        else:
            for run in runs:
                self._render_run_row(run)

    def _render_agent_card(self, agent: dict):
        """Render a single agent card with controls."""
        agent_meta = config.AGENT_TYPES.get(
            agent.get("agent_type", ""),
            {"label": agent.get("agent_type", ""), "icon": "🤖"}
        )
        enabled = bool(agent.get("enabled", 0))

        card = ctk.CTkFrame(
            self._agents_container,
            fg_color=theme.BG_CARD,
            corner_radius=10,
        )
        card.pack(fill="x", pady=4)
        card.grid_columnconfigure(1, weight=1)

        # Status indicator
        color = theme.GREEN_PRIMARY if enabled else theme.TEXT_DIM
        ctk.CTkFrame(card, width=4, fg_color=color, corner_radius=2).grid(
            row=0, column=0, rowspan=2, sticky="ns", padx=(0, 0)
        )

        # Info
        info_frame = ctk.CTkFrame(card, fg_color="transparent")
        info_frame.grid(row=0, column=1, sticky="ew", padx=16, pady=(12, 0))

        ctk.CTkLabel(
            info_frame,
            text=f"{agent_meta.get('icon', '🤖')} {agent.get('name', 'Unnamed Agent')}",
            font=theme.font_bold(14), text_color=theme.TEXT_LIGHT, anchor="w",
        ).pack(side="left")

        badge_text = "  ACTIVE  " if enabled else "  PAUSED  "
        badge_color = theme.GREEN_PRIMARY if enabled else theme.TEXT_DIM
        ctk.CTkLabel(
            info_frame, text=badge_text, fg_color=badge_color,
            text_color="white", corner_radius=6, height=22,
            font=theme.font(9, "bold"),
        ).pack(side="left", padx=12)

        # Schedule info
        schedule_frame = ctk.CTkFrame(card, fg_color="transparent")
        schedule_frame.grid(row=1, column=1, sticky="ew", padx=16, pady=(2, 12))

        schedule_text = (
            f"Type: {agent_meta.get('label', '')}  •  "
            f"Schedule: {agent.get('schedule_type', '')} on {agent.get('schedule_day', '')} at {agent.get('schedule_time', '')}  •  "
            f"Last run: {(agent.get('last_run', '') or 'Never')[:16]}  •  "
            f"Next run: {(agent.get('next_run', '') or 'Not set')[:16]}"
        )
        ctk.CTkLabel(
            schedule_frame, text=schedule_text,
            font=theme.font(11), text_color=theme.TEXT_DIM, anchor="w",
        ).pack(side="left", fill="x", expand=True)

        # Action buttons
        btn_frame = ctk.CTkFrame(card, fg_color="transparent")
        btn_frame.grid(row=0, column=2, rowspan=2, padx=12, pady=12)

        theme.create_accent_button(
            btn_frame, "▶ Run Now",
            command=lambda a=agent: self._run_agent_now(a),
            width=90,
        ).pack(pady=(0, 4))

        toggle_text = "⏸ Pause" if enabled else "▶ Enable"
        theme.create_outline_button(
            btn_frame, toggle_text,
            command=lambda a=agent: self._toggle_agent(a),
            width=90,
        ).pack(pady=(0, 4))

        ctk.CTkButton(
            btn_frame, text="✏️ Edit", width=90, height=28,
            fg_color="transparent", hover_color=theme.BG_CARD_HOVER,
            text_color=theme.TEXT_DIM, font=theme.font(11),
            corner_radius=6,
            command=lambda a=agent: self._open_agent_modal(a),
        ).pack()

    def _render_run_row(self, run: dict):
        """Render a single agent run history row."""
        row = ctk.CTkFrame(self._agent_runs_container, fg_color=theme.BG_INPUT, corner_radius=8)
        row.pack(fill="x", pady=2)
        row.grid_columnconfigure(2, weight=1)

        # Status icon
        status = run.get("status", "")
        status_icons = {"success": "✅", "failed": "❌", "running": "⏳"}
        icon = status_icons.get(status, "❓")

        ctk.CTkLabel(
            row, text=icon, font=theme.font(14), width=30,
        ).grid(row=0, column=0, padx=(8, 4), pady=8)

        # Agent type
        agent_type = run.get("agent_type", "")
        type_label = config.AGENT_TYPES.get(agent_type, {}).get("label", agent_type)
        ctk.CTkLabel(
            row, text=type_label, font=theme.font_bold(12),
            text_color=theme.TEXT_LIGHT, anchor="w", width=160,
        ).grid(row=0, column=1, padx=4, pady=8, sticky="w")

        # Output title / error
        title = run.get("output_title", "") or run.get("error_message", "")
        if len(title) > 60:
            title = title[:60] + "..."
        ctk.CTkLabel(
            row, text=title, font=theme.font(11),
            text_color=theme.TEXT_DIM, anchor="w",
        ).grid(row=0, column=2, padx=4, pady=8, sticky="w")

        # Time
        time_str = (run.get("started_at", "") or "")[:16]
        ctk.CTkLabel(
            row, text=time_str, font=theme.font(11),
            text_color=theme.TEXT_DIM,
        ).grid(row=0, column=3, padx=8, pady=8)

        # View button (if successful)
        if status == "success" and run.get("output_text"):
            ctk.CTkButton(
                row, text="👁️", width=30, height=26,
                fg_color="transparent", hover_color=theme.BG_CARD_HOVER,
                text_color=theme.TEXT_DIM, font=theme.font(14),
                command=lambda r=run: self._view_agent_output(r),
            ).grid(row=0, column=4, padx=(0, 8), pady=8)

    def _add_agent(self):
        self._open_agent_modal({})

    def _open_agent_modal(self, data: dict):
        """Open agent configuration modal."""
        modal = ctk.CTkToplevel(self)
        modal.title("Edit Agent" if data.get("id") else "New Agent")
        modal.geometry("500x500")
        modal.transient(self.winfo_toplevel())
        modal.grab_set()

        modal.update_idletasks()
        x = (modal.winfo_screenwidth() - 500) // 2
        y = (modal.winfo_screenheight() - 500) // 2
        modal.geometry(f"500x500+{x}+{y}")

        scroll = ctk.CTkScrollableFrame(modal, fg_color=theme.BG_DARK)
        scroll.pack(fill="both", expand=True)

        ctk.CTkLabel(
            scroll, text="🤖 Agent Configuration",
            font=theme.font_heading(), text_color=theme.TEXT_LIGHT,
        ).pack(fill="x", padx=20, pady=(20, 16))

        fields = {}

        # Name
        ctk.CTkLabel(scroll, text="Agent Name", font=theme.font(12),
                     text_color=theme.TEXT_DIM, anchor="w").pack(fill="x", padx=20, pady=(8, 2))
        name_entry = theme.create_entry(scroll, placeholder="e.g. Weekly Blog Writer")
        name_entry.insert(0, data.get("name", ""))
        name_entry.pack(fill="x", padx=20, pady=(0, 8))
        fields["name"] = name_entry

        # Agent Type
        ctk.CTkLabel(scroll, text="Agent Type", font=theme.font(12),
                     text_color=theme.TEXT_DIM, anchor="w").pack(fill="x", padx=20, pady=(0, 2))
        type_options = list(config.AGENT_TYPES.keys())
        type_labels = [config.AGENT_TYPES[t]["label"] for t in type_options]
        type_combo = ctk.CTkComboBox(scroll, values=type_labels, width=300, font=theme.font(13))
        current_type = data.get("agent_type", "blog_writer")
        type_combo.set(config.AGENT_TYPES.get(current_type, {}).get("label", type_labels[0]))
        type_combo.pack(fill="x", padx=20, pady=(0, 8))
        fields["agent_type"] = type_combo

        # Schedule Type
        ctk.CTkLabel(scroll, text="Schedule", font=theme.font(12),
                     text_color=theme.TEXT_DIM, anchor="w").pack(fill="x", padx=20, pady=(0, 2))
        schedule_combo = ctk.CTkComboBox(
            scroll, values=config.AGENT_SCHEDULE_TYPES, width=300, font=theme.font(13)
        )
        schedule_combo.set(data.get("schedule_type", "Weekly"))
        schedule_combo.pack(fill="x", padx=20, pady=(0, 8))
        fields["schedule_type"] = schedule_combo

        # Schedule Day
        ctk.CTkLabel(scroll, text="Day", font=theme.font(12),
                     text_color=theme.TEXT_DIM, anchor="w").pack(fill="x", padx=20, pady=(0, 2))
        day_combo = ctk.CTkComboBox(
            scroll, values=config.DAY_OPTIONS, width=300, font=theme.font(13)
        )
        day_combo.set(data.get("schedule_day", "Monday"))
        day_combo.pack(fill="x", padx=20, pady=(0, 8))
        fields["schedule_day"] = day_combo

        # Schedule Time
        ctk.CTkLabel(scroll, text="Time", font=theme.font(12),
                     text_color=theme.TEXT_DIM, anchor="w").pack(fill="x", padx=20, pady=(0, 2))
        time_entry = theme.create_entry(scroll, placeholder="09:00")
        time_entry.insert(0, data.get("schedule_time", "09:00"))
        time_entry.pack(fill="x", padx=20, pady=(0, 8))
        fields["schedule_time"] = time_entry

        # Enabled
        enabled_var = ctk.BooleanVar(value=bool(data.get("enabled", 0)))
        enabled_cb = ctk.CTkCheckBox(
            scroll, text="Enable this agent (will run on schedule)",
            variable=enabled_var, font=theme.font(12),
            text_color=theme.TEXT_LIGHT,
        )
        enabled_cb.pack(fill="x", padx=20, pady=(8, 8))

        # Save
        def save():
            # Reverse-lookup agent type from label
            selected_label = fields["agent_type"].get()
            agent_type_key = "blog_writer"
            for k, v in config.AGENT_TYPES.items():
                if v["label"] == selected_label:
                    agent_type_key = k
                    break

            from ..agents import calculate_next_run

            result = {
                "id": data.get("id"),
                "name": fields["name"].get().strip() or "Unnamed Agent",
                "agent_type": agent_type_key,
                "schedule_type": fields["schedule_type"].get(),
                "schedule_day": fields["schedule_day"].get(),
                "schedule_time": fields["schedule_time"].get().strip() or "09:00",
                "enabled": 1 if enabled_var.get() else 0,
            }

            # Calculate next_run if enabling
            if result["enabled"]:
                result["next_run"] = calculate_next_run(
                    result["schedule_type"],
                    result["schedule_day"],
                    result["schedule_time"],
                )

            self.db.save_agent_schedule(result)
            modal.destroy()
            self.app.show_toast("Agent saved", "success")
            self._refresh_subtab("agents")

        btn_frame = ctk.CTkFrame(scroll, fg_color="transparent")
        btn_frame.pack(fill="x", padx=20, pady=(16, 20))

        theme.create_accent_button(
            btn_frame, "💾 Save Agent", command=save, width=140,
        ).pack(side="left", padx=(0, 8))

        if data.get("id"):
            ctk.CTkButton(
                btn_frame, text="🗑️ Delete", width=80, height=36,
                fg_color=theme.RED, hover_color="#c0392b",
                text_color="white", corner_radius=8,
                command=lambda: self._delete_agent(data["id"], modal),
            ).pack(side="left", padx=(0, 8))

        ctk.CTkButton(
            btn_frame, text="Cancel", width=80, height=36,
            fg_color="transparent", hover_color=theme.BG_CARD_HOVER,
            border_width=1, border_color=theme.TEXT_DIM,
            text_color=theme.TEXT_DIM, corner_radius=8,
            command=modal.destroy,
        ).pack(side="left")

    def _toggle_agent(self, agent: dict):
        """Toggle agent enabled/disabled state."""
        new_enabled = 0 if agent.get("enabled", 0) else 1
        self.db.save_agent_schedule({
            "id": agent["id"],
            "enabled": new_enabled,
        })
        status_text = "enabled" if new_enabled else "paused"
        self.app.show_toast(f"Agent {status_text}", "success")
        self._refresh_subtab("agents")

    def _run_agent_now(self, agent: dict):
        """Trigger immediate agent run in background thread."""
        self.app.show_toast(f"Running {agent.get('name', 'agent')}...", "info")

        def run():
            try:
                if self._agent_scheduler:
                    self._agent_scheduler.run_agent_now(agent["id"])
                else:
                    # Direct execution if scheduler not available
                    from ..agents import generate_blog_post, generate_newsletter
                    agent_type = agent.get("agent_type", "")
                    if agent_type == "blog_writer":
                        result = generate_blog_post()
                        if not result.get("error"):
                            self.db.log_agent_run(
                                agent["id"], agent_type, "success",
                                result["title"], result["content"]
                            )
                        else:
                            self.db.log_agent_run(
                                agent["id"], agent_type, "failed",
                                error_message=result["error"]
                            )
                    elif agent_type == "newsletter_writer":
                        result = generate_newsletter()
                        if not result.get("error"):
                            self.db.log_agent_run(
                                agent["id"], agent_type, "success",
                                result["subject"], result["body"]
                            )
                        else:
                            self.db.log_agent_run(
                                agent["id"], agent_type, "failed",
                                error_message=result["error"]
                            )

                # Refresh UI after run
                try:
                    self.after(500, lambda: self._refresh_subtab("agents"))
                    self.after(600, lambda: self.app.show_toast("Agent run complete!", "success"))
                except Exception:
                    pass
            except Exception as e:
                try:
                    self.after(100, lambda: self.app.show_toast(f"Agent error: {e}", "error"))
                except Exception:
                    pass

        threading.Thread(target=run, daemon=True).start()

    def _delete_agent(self, agent_id: int, modal):
        """Delete an agent and close its modal."""
        self.db.delete_agent_schedule(agent_id)
        modal.destroy()
        self.app.show_toast("Agent deleted", "success")
        self._refresh_subtab("agents")

    def _view_agent_output(self, run: dict):
        """View the full output from an agent run."""
        modal = ctk.CTkToplevel(self)
        modal.title(run.get("output_title", "Agent Output"))
        modal.geometry("700x600")
        modal.transient(self.winfo_toplevel())
        modal.grab_set()

        modal.update_idletasks()
        x = (modal.winfo_screenwidth() - 700) // 2
        y = (modal.winfo_screenheight() - 600) // 2
        modal.geometry(f"700x600+{x}+{y}")

        scroll = ctk.CTkScrollableFrame(modal, fg_color=theme.BG_DARK)
        scroll.pack(fill="both", expand=True)

        agent_type = run.get("agent_type", "")
        type_label = config.AGENT_TYPES.get(agent_type, {}).get("label", agent_type)

        ctk.CTkLabel(
            scroll, text=f"{type_label} Output",
            font=theme.font_heading(), text_color=theme.TEXT_LIGHT,
        ).pack(fill="x", padx=20, pady=(20, 4))

        ctk.CTkLabel(
            scroll, text=run.get("output_title", ""),
            font=theme.font_bold(16), text_color=theme.GREEN_LIGHT,
            anchor="w",
        ).pack(fill="x", padx=20, pady=(0, 8))

        ctk.CTkLabel(
            scroll,
            text=f"Generated: {(run.get('started_at', '') or '')[:16]}  •  Status: {run.get('status', '')}",
            font=theme.font(11), text_color=theme.TEXT_DIM, anchor="w",
        ).pack(fill="x", padx=20, pady=(0, 12))

        # Output text
        text_box = ctk.CTkTextbox(
            scroll, height=350,
            fg_color=theme.BG_INPUT, font=theme.font(13),
            text_color=theme.TEXT_LIGHT, corner_radius=8,
        )
        text_box.pack(fill="x", padx=20, pady=(0, 12))
        text_box.insert("1.0", run.get("output_text", ""))
        text_box.configure(state="disabled")

        # Action buttons
        btn_frame = ctk.CTkFrame(scroll, fg_color="transparent")
        btn_frame.pack(fill="x", padx=20, pady=(0, 20))

        def copy_to_clipboard():
            self.clipboard_clear()
            self.clipboard_append(run.get("output_text", ""))
            self.app.show_toast("Copied to clipboard", "success")

        theme.create_accent_button(
            btn_frame, "📋 Copy", command=copy_to_clipboard, width=100,
        ).pack(side="left", padx=(0, 8))

        # If newsletter, offer to push to newsletter compose
        if agent_type == "newsletter_writer":
            def use_in_newsletter():
                modal.destroy()
                self.app.show_toast("Copied to Newsletter — switch to Marketing tab", "success")
                # Store in settings for marketing tab to pick up
                self.db.set_setting("draft_newsletter_subject", run.get("output_title", ""))
                self.db.set_setting("draft_newsletter_body", run.get("output_text", ""))

            theme.create_outline_button(
                btn_frame, "📨 Use in Newsletter",
                command=use_in_newsletter, width=160,
            ).pack(side="left", padx=(0, 8))

        ctk.CTkButton(
            btn_frame, text="Close", width=80, height=36,
            fg_color="transparent", hover_color=theme.BG_CARD_HOVER,
            border_width=1, border_color=theme.TEXT_DIM,
            text_color=theme.TEXT_DIM, corner_radius=8,
            command=modal.destroy,
        ).pack(side="left")

    # ------------------------------------------------------------------
    # Strategy Panel — Business Plan & AI Recommendations
    # ------------------------------------------------------------------
    def _build_strategy_panel(self):
        frame = ctk.CTkScrollableFrame(self, fg_color="transparent")
        self._sub_frames["strategy"] = frame

        # Header
        header = ctk.CTkFrame(frame, fg_color="transparent")
        header.pack(fill="x", padx=16, pady=(16, 4))
        header.grid_columnconfigure(1, weight=1)

        ctk.CTkLabel(
            header, text="📊 Business Strategy & Pricing Intelligence",
            font=theme.font_bold(16), text_color=theme.TEXT_LIGHT, anchor="w",
        ).grid(row=0, column=0, sticky="w")

        theme.create_accent_button(
            header, "🔄 Run Analysis",
            command=self._run_strategy_analysis, width=140,
        ).grid(row=0, column=2, sticky="e")

        ctk.CTkLabel(
            frame, text="AI-powered strategy from your Business Plan · Pricing recommendations sent to Telegram for approval",
            font=theme.font(12), text_color=theme.TEXT_DIM, anchor="w",
        ).pack(fill="x", padx=16, pady=(0, 12))

        # Business Plan Summary Card
        plan_card = ctk.CTkFrame(frame, fg_color=theme.BG_CARD, corner_radius=12)
        plan_card.pack(fill="x", padx=16, pady=(0, 8))

        ctk.CTkLabel(
            plan_card, text="📋 Business Plan Overview",
            font=theme.font_bold(14), text_color=theme.TEXT_LIGHT, anchor="w",
        ).pack(fill="x", padx=16, pady=(14, 8))

        self._plan_summary_container = ctk.CTkFrame(plan_card, fg_color="transparent")
        self._plan_summary_container.pack(fill="x", padx=16, pady=(0, 14))

        # KPI Cards Row
        kpi_frame = ctk.CTkFrame(frame, fg_color="transparent")
        kpi_frame.pack(fill="x", padx=16, pady=(0, 8))

        self._strategy_kpi_widgets = {}
        kpi_defs = [
            ("target", "🎯 Year 1 Target", "£41,500"),
            ("breakeven", "📊 Break-Even", "13 jobs/mo"),
            ("margin", "💰 Profit Margin", "77%"),
            ("recs_pending", "⏳ Pending Recs", "0"),
            ("recs_applied", "✅ Applied", "0"),
        ]

        for i, (key, label, default_val) in enumerate(kpi_defs):
            card = ctk.CTkFrame(kpi_frame, fg_color=theme.BG_CARD, corner_radius=10, height=70)
            card.pack(side="left", fill="x", expand=True, padx=4)
            card.pack_propagate(False)

            val_label = ctk.CTkLabel(
                card, text=default_val,
                font=theme.font_bold(18), text_color=theme.GREEN_LIGHT,
            )
            val_label.pack(pady=(12, 0))

            ctk.CTkLabel(
                card, text=label,
                font=theme.font(10), text_color=theme.TEXT_DIM,
            ).pack()

            self._strategy_kpi_widgets[key] = val_label

        # AI Recommendations List
        recs_card = ctk.CTkFrame(frame, fg_color=theme.BG_CARD, corner_radius=12)
        recs_card.pack(fill="x", padx=16, pady=(0, 8))

        recs_header = ctk.CTkFrame(recs_card, fg_color="transparent")
        recs_header.pack(fill="x", padx=16, pady=(14, 8))
        recs_header.grid_columnconfigure(0, weight=1)

        ctk.CTkLabel(
            recs_header, text="💡 AI Strategy Recommendations",
            font=theme.font_bold(14), text_color=theme.TEXT_LIGHT, anchor="w",
        ).grid(row=0, column=0, sticky="w")

        self._recs_container = ctk.CTkFrame(recs_card, fg_color="transparent")
        self._recs_container.pack(fill="x", padx=16, pady=(0, 14))

        # Pricing Config Card
        pricing_card = ctk.CTkFrame(frame, fg_color=theme.BG_CARD, corner_radius=12)
        pricing_card.pack(fill="x", padx=16, pady=(0, 16))

        ctk.CTkLabel(
            pricing_card, text="💰 Service Pricing Config",
            font=theme.font_bold(14), text_color=theme.TEXT_LIGHT, anchor="w",
        ).pack(fill="x", padx=16, pady=(14, 8))

        self._pricing_container = ctk.CTkFrame(pricing_card, fg_color="transparent")
        self._pricing_container.pack(fill="x", padx=16, pady=(0, 14))

    def _load_strategy(self):
        """Load strategy data, business plan summary, and recommendations."""
        # Business plan summary (read from file)
        for w in self._plan_summary_container.winfo_children():
            w.destroy()

        plan_file = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(
            os.path.dirname(os.path.abspath(__file__))))), "admin", "BUSINESS_PLAN.md")

        plan_items = []
        try:
            if os.path.exists(plan_file):
                with open(plan_file, "r", encoding="utf-8") as f:
                    content = f.read()
                # Extract key figures
                import re
                rev_match = re.search(r'Year 1 Revenue Target.*?£([\d,]+)', content)
                if rev_match:
                    plan_items.append(("Revenue Target", f"£{rev_match.group(1)}"))
                margin_match = re.search(r'Profit Margin.*?(\d+%)', content)
                if margin_match:
                    plan_items.append(("Profit Margin", margin_match.group(1)))
                breakeven_match = re.search(r'Break-even.*?(\d+ jobs)', content)
                if breakeven_match:
                    plan_items.append(("Break-Even", breakeven_match.group(1)))
                costs_match = re.search(r'Total Running Costs.*?£([\d,]+)', content)
                if costs_match:
                    plan_items.append(("Annual Costs", f"£{costs_match.group(1)}"))
                takehome_match = re.search(r'Monthly Take-Home.*?£([\d,]+)', content)
                if takehome_match:
                    plan_items.append(("Monthly Take-Home", f"£{takehome_match.group(1)}"))
                capacity_match = re.search(r'Maximum Annual Capacity.*?~?(\d+)', content)
                if capacity_match:
                    plan_items.append(("Annual Capacity", f"~{capacity_match.group(1)} jobs"))
            else:
                plan_items.append(("Status", "Business plan not found"))
        except Exception:
            plan_items.append(("Status", "Error reading business plan"))

        for label, value in plan_items:
            row = ctk.CTkFrame(self._plan_summary_container, fg_color="transparent")
            row.pack(fill="x", pady=2)
            row.grid_columnconfigure(1, weight=1)
            ctk.CTkLabel(
                row, text=label, font=theme.font(12),
                text_color=theme.TEXT_DIM, width=140, anchor="w",
            ).grid(row=0, column=0, sticky="w")
            ctk.CTkLabel(
                row, text=value, font=theme.font_bold(12),
                text_color=theme.TEXT_LIGHT, anchor="w",
            ).grid(row=0, column=1, sticky="w", padx=8)

        # Load recommendations from database
        for w in self._recs_container.winfo_children():
            w.destroy()

        try:
            recs = self.db.get_business_recommendations(limit=15)
        except Exception:
            recs = []

        pending_count = sum(1 for r in recs if r.get("status") == "pending")
        applied_count = sum(1 for r in recs if r.get("status") == "applied")

        # Update KPIs
        try:
            self._strategy_kpi_widgets["recs_pending"].configure(text=str(pending_count))
            self._strategy_kpi_widgets["recs_applied"].configure(text=str(applied_count))
        except Exception:
            pass

        if not recs:
            ctk.CTkLabel(
                self._recs_container,
                text="No recommendations yet. Click 'Run Analysis' or wait for the weekly agent run.",
                font=theme.font(12), text_color=theme.TEXT_DIM,
            ).pack(pady=8)
        else:
            for rec in recs:
                self._render_recommendation_card(rec)

        # Pricing config (rendered as mini table)
        for w in self._pricing_container.winfo_children():
            w.destroy()

        try:
            # Try to sync if we have cached pricing from business plan
            pricing_data = self.db.fetchall("""
                SELECT DISTINCT title, description, price_changes
                FROM business_recommendations
                WHERE price_changes != '[]' AND price_changes IS NOT NULL
                ORDER BY date DESC LIMIT 5
            """)
        except Exception:
            pricing_data = []

        if not pricing_data:
            ctk.CTkLabel(
                self._pricing_container,
                text="Run the Business Tactics agent to see pricing recommendations here.",
                font=theme.font(12), text_color=theme.TEXT_DIM,
            ).pack(pady=8)

    def _render_recommendation_card(self, rec: dict):
        """Render a single recommendation card."""
        status = rec.get("status", "pending")
        priority = rec.get("priority", "medium")

        priority_colors = {"high": theme.RED, "medium": theme.AMBER, "low": theme.GREEN_PRIMARY}
        status_colors = {"pending": theme.AMBER, "approved": theme.BLUE, "applied": theme.GREEN_PRIMARY, "rejected": theme.RED}
        status_icons = {"pending": "⏳", "approved": "✅", "applied": "🚀", "rejected": "❌"}

        card = ctk.CTkFrame(self._recs_container, fg_color=theme.BG_INPUT, corner_radius=8)
        card.pack(fill="x", pady=3)
        card.grid_columnconfigure(1, weight=1)

        # Priority indicator
        ctk.CTkFrame(
            card, width=4,
            fg_color=priority_colors.get(priority, theme.AMBER),
            corner_radius=2,
        ).grid(row=0, column=0, rowspan=2, sticky="ns")

        # Title + type
        rec_type = rec.get("type", "")
        type_icons = {"pricing": "💰", "promotion": "🎯", "seasonal": "🌱", "efficiency": "⚡", "growth": "📈"}
        title_text = f"{type_icons.get(rec_type, '📋')} {rec.get('title', 'Untitled')}"

        ctk.CTkLabel(
            card, text=title_text,
            font=theme.font_bold(12), text_color=theme.TEXT_LIGHT, anchor="w",
        ).grid(row=0, column=1, sticky="w", padx=12, pady=(8, 0))

        # Description
        desc = rec.get("description", "")
        if len(desc) > 120:
            desc = desc[:120] + "..."
        ctk.CTkLabel(
            card, text=desc,
            font=theme.font(11), text_color=theme.TEXT_DIM, anchor="w",
        ).grid(row=1, column=1, sticky="w", padx=12, pady=(0, 4))

        # Price changes inline
        price_changes = rec.get("price_changes", [])
        if price_changes:
            changes_text = " · ".join(
                f"{pc.get('service', '')}: £{pc.get('current', 0)}→£{pc.get('recommended', 0)}"
                for pc in price_changes[:3]
            )
            ctk.CTkLabel(
                card, text=f"💰 {changes_text}",
                font=theme.font(10), text_color=theme.GREEN_LIGHT, anchor="w",
            ).grid(row=2, column=1, sticky="w", padx=12, pady=(0, 8))

        # Status badge + date
        info_frame = ctk.CTkFrame(card, fg_color="transparent")
        info_frame.grid(row=0, column=2, rowspan=3, padx=12, pady=8)

        status_text = f" {status_icons.get(status, '❓')} {status.upper()} "
        ctk.CTkLabel(
            info_frame, text=status_text,
            fg_color=status_colors.get(status, theme.TEXT_DIM),
            text_color="white", corner_radius=6, height=22,
            font=theme.font(9, "bold"),
        ).pack(pady=(0, 4))

        date_text = (rec.get("date", "") or "")[:10]
        ctk.CTkLabel(
            info_frame, text=date_text,
            font=theme.font(10), text_color=theme.TEXT_DIM,
        ).pack()

    def _run_strategy_analysis(self):
        """Trigger the business tactics agent from the Hub."""
        self.app.show_toast("Running strategy analysis... check Telegram", "info")

        def run():
            try:
                import subprocess
                agent_path = os.path.join(
                    os.path.dirname(os.path.dirname(os.path.dirname(
                        os.path.dirname(os.path.abspath(__file__))))),
                    "agents", "business-tactics.js"
                )
                result = subprocess.run(
                    ["node", agent_path],
                    capture_output=True, text=True, timeout=120,
                    cwd=os.path.dirname(os.path.dirname(agent_path)),
                )
                if result.returncode == 0:
                    try:
                        self.after(500, lambda: self.app.show_toast("Strategy analysis sent to Telegram!", "success"))
                        self.after(1000, lambda: self._refresh_subtab("strategy"))
                    except Exception:
                        pass
                else:
                    try:
                        self.after(500, lambda: self.app.show_toast("Analysis failed — check agent logs", "error"))
                    except Exception:
                        pass
            except Exception as e:
                try:
                    self.after(100, lambda: self.app.show_toast(f"Strategy error: {e}", "error"))
                except Exception:
                    pass

        threading.Thread(target=run, daemon=True).start()

    # ------------------------------------------------------------------
    # Growth Milestones Panel
    # ------------------------------------------------------------------
    def _build_milestones_panel(self):
        frame = ctk.CTkScrollableFrame(self, fg_color="transparent")
        self._sub_frames["milestones"] = frame

        ctk.CTkLabel(
            frame, text="🎯 Business Growth Milestones",
            font=theme.font_bold(16), text_color=theme.TEXT_LIGHT, anchor="w",
        ).pack(fill="x", padx=16, pady=(16, 4))

        ctk.CTkLabel(
            frame, text="Track your progress towards each business milestone",
            font=theme.font(12), text_color=theme.TEXT_DIM, anchor="w",
        ).pack(fill="x", padx=16, pady=(0, 16))

        self._milestone_container = ctk.CTkFrame(frame, fg_color="transparent")
        self._milestone_container.pack(fill="x", padx=16, pady=(0, 16))

    def _render_milestones(self, current_revenue: float, current_monthly: float):
        for w in self._milestone_container.winfo_children():
            w.destroy()

        for ms in config.GROWTH_MILESTONES:
            rev_target = ms["revenue"]
            monthly_target = ms["monthly"]
            cost = ms["cost"]
            icon = ms["icon"]
            label = ms["label"]

            # Check if unlocked
            unlocked = current_revenue >= rev_target and current_monthly >= monthly_target
            progress = 0
            if rev_target > 0:
                progress = min(current_revenue / rev_target, 1.0)
            else:
                progress = 1.0

            card_bg = theme.BG_CARD if unlocked else theme.BG_INPUT
            card = ctk.CTkFrame(self._milestone_container, fg_color=card_bg, corner_radius=10)
            card.pack(fill="x", pady=4)
            card.grid_columnconfigure(2, weight=1)

            # Icon
            ctk.CTkLabel(
                card, text=icon, font=theme.font(24), width=50,
            ).grid(row=0, column=0, rowspan=2, padx=(12, 8), pady=12)

            # Title
            ctk.CTkLabel(
                card, text=label,
                font=theme.font_bold(14),
                text_color=theme.GREEN_LIGHT if unlocked else theme.TEXT_LIGHT,
                anchor="w",
            ).grid(row=0, column=1, columnspan=2, padx=4, pady=(12, 0), sticky="w")

            # Requirements
            req_text = f"Revenue: £{rev_target:,}  •  Monthly: £{monthly_target:,}/mo  •  Cost: £{cost:,}"
            ctk.CTkLabel(
                card, text=req_text,
                font=theme.font(11), text_color=theme.TEXT_DIM, anchor="w",
            ).grid(row=1, column=1, columnspan=2, padx=4, pady=(0, 4), sticky="w")

            # Progress bar
            if not unlocked and rev_target > 0:
                bar_bg = ctk.CTkFrame(card, height=8, fg_color=theme.BG_DARK, corner_radius=4)
                bar_bg.grid(row=2, column=1, columnspan=2, sticky="ew", padx=4, pady=(0, 12))
                bar = ctk.CTkFrame(bar_bg, height=6, fg_color=theme.GREEN_PRIMARY, corner_radius=3)
                bar.place(relx=0, rely=0.1, relwidth=progress, relheight=0.8)

            # Status badge
            if unlocked:
                badge = ctk.CTkLabel(
                    card, text="  ✅ UNLOCKED  ", fg_color=theme.GREEN_PRIMARY,
                    text_color="white", corner_radius=6, height=24,
                    font=theme.font(10, "bold"),
                )
            else:
                pct = int(progress * 100)
                badge = ctk.CTkLabel(
                    card, text=f"  {pct}%  ", fg_color=theme.AMBER,
                    text_color="white", corner_radius=6, height=24,
                    font=theme.font(10, "bold"),
                )
            badge.grid(row=0, column=3, padx=12, pady=12)

    # ------------------------------------------------------------------
    # Settings Panel
    # ------------------------------------------------------------------
    def _build_settings_panel(self):
        frame = ctk.CTkScrollableFrame(self, fg_color="transparent")
        self._sub_frames["settings"] = frame

        ctk.CTkLabel(
            frame, text="⚙️ Application Settings",
            font=theme.font_bold(16), text_color=theme.TEXT_LIGHT, anchor="w",
        ).pack(fill="x", padx=16, pady=(16, 12))

        # App info
        info_card = ctk.CTkFrame(frame, fg_color=theme.BG_CARD, corner_radius=12)
        info_card.pack(fill="x", padx=16, pady=(0, 8))

        info_items = [
            ("Application", config.APP_NAME),
            ("Version", config.APP_VERSION),
            ("Database", str(config.DB_PATH)),
            ("Photos Dir", str(config.PHOTOS_DIR)),
            ("Webhook", config.SHEETS_WEBHOOK[:60] + "..."),
            ("Sync Interval", f"{config.SYNC_INTERVAL_SECONDS}s"),
            ("Telegram Bot", "Configured" if config.TG_BOT_TOKEN else "Not configured"),
        ]

        for label, value in info_items:
            row = ctk.CTkFrame(info_card, fg_color="transparent")
            row.pack(fill="x", padx=16, pady=4)
            row.grid_columnconfigure(1, weight=1)

            ctk.CTkLabel(
                row, text=label, font=theme.font(12),
                text_color=theme.TEXT_DIM, width=120, anchor="w",
            ).grid(row=0, column=0, sticky="w")

            ctk.CTkLabel(
                row, text=value, font=theme.font(12),
                text_color=theme.TEXT_LIGHT, anchor="w",
            ).grid(row=0, column=1, sticky="w", padx=8)

        # Add top/bottom padding for first/last items
        info_card.winfo_children()[0].pack_configure(pady=(12, 4))
        info_card.winfo_children()[-1].pack_configure(pady=(4, 12))

        # Business constants
        biz_card = ctk.CTkFrame(frame, fg_color=theme.BG_CARD, corner_radius=12)
        biz_card.pack(fill="x", padx=16, pady=(8, 8))

        ctk.CTkLabel(
            biz_card, text="📊 Business Constants",
            font=theme.font_bold(14), text_color=theme.TEXT_LIGHT, anchor="w",
        ).pack(fill="x", padx=16, pady=(14, 8))

        biz_items = [
            ("Tax Rate", f"{config.TAX_RATE * 100:.0f}%"),
            ("NI Rate", f"{config.NI_RATE * 100:.0f}%"),
            ("Emergency Fund", f"{config.EMERGENCY_FUND_RATE * 100:.0f}%"),
            ("Equipment Fund", f"{config.EQUIPMENT_FUND_RATE * 100:.0f}%"),
            ("Operating Costs", f"{config.OPERATING_FUND_RATE * 100:.0f}%"),
            ("Personal Draw", f"{config.PERSONAL_RATE * 100:.0f}%"),
            ("Fuel Rate", f"£{config.FUEL_RATE_PER_MILE}/mile"),
            ("Base Postcode", config.BASE_POSTCODE),
            ("Max Jobs/Day", str(config.MAX_JOBS_PER_DAY)),
        ]

        for label, value in biz_items:
            row = ctk.CTkFrame(biz_card, fg_color="transparent")
            row.pack(fill="x", padx=16, pady=3)
            row.grid_columnconfigure(1, weight=1)

            ctk.CTkLabel(
                row, text=label, font=theme.font(12),
                text_color=theme.TEXT_DIM, width=140, anchor="w",
            ).grid(row=0, column=0, sticky="w")

            ctk.CTkLabel(
                row, text=value, font=theme.font_bold(12),
                text_color=theme.TEXT_LIGHT, anchor="w",
            ).grid(row=0, column=1, sticky="w", padx=8)

        biz_card.winfo_children()[-1].pack_configure(pady=(3, 12))

        # Danger zone
        danger_card = ctk.CTkFrame(frame, fg_color=theme.BG_CARD, corner_radius=12)
        danger_card.pack(fill="x", padx=16, pady=(16, 16))

        ctk.CTkLabel(
            danger_card, text="⚠️ Database Actions",
            font=theme.font_bold(14), text_color=theme.RED, anchor="w",
        ).pack(fill="x", padx=16, pady=(14, 8))

        action_row = ctk.CTkFrame(danger_card, fg_color="transparent")
        action_row.pack(fill="x", padx=16, pady=(0, 14))

        theme.create_outline_button(
            action_row, "📤 Force Full Sync",
            command=self._force_full_sync, width=150,
        ).pack(side="left", padx=4)

        theme.create_outline_button(
            action_row, "💾 Backup Database",
            command=self._backup_db, width=150,
        ).pack(side="left", padx=4)

        ctk.CTkLabel(
            danger_card,
            text=f"Database size: {self._get_db_size()}",
            font=theme.font(11), text_color=theme.TEXT_DIM,
        ).pack(fill="x", padx=16, pady=(0, 14))

    def _get_db_size(self) -> str:
        try:
            size = os.path.getsize(config.DB_PATH)
            if size < 1024:
                return f"{size} bytes"
            elif size < 1024 * 1024:
                return f"{size / 1024:.1f} KB"
            else:
                return f"{size / (1024 * 1024):.1f} MB"
        except Exception:
            return "Unknown"

    # ------------------------------------------------------------------
    # Modals
    # ------------------------------------------------------------------
    def _add_vacancy(self):
        self._open_vacancy_modal({})

    def _open_vacancy(self, values: dict):
        vac_id = values.get("id")
        if vac_id:
            vacancies = self.db.get_vacancies()
            for v in vacancies:
                if v.get("id") == vac_id:
                    self._open_vacancy_modal(v)
                    return

    def _open_vacancy_modal(self, data: dict):
        modal = ctk.CTkToplevel(self)
        modal.title("Vacancy" if data.get("id") else "New Vacancy")
        modal.geometry("500x500")
        modal.transient(self.winfo_toplevel())
        modal.grab_set()

        modal.update_idletasks()
        x = (modal.winfo_screenwidth() - 500) // 2
        y = (modal.winfo_screenheight() - 500) // 2
        modal.geometry(f"500x500+{x}+{y}")

        scroll = ctk.CTkScrollableFrame(modal, fg_color=theme.BG_DARK)
        scroll.pack(fill="both", expand=True)

        ctk.CTkLabel(
            scroll, text="💼 Vacancy Details",
            font=theme.font_heading(), text_color=theme.TEXT_LIGHT,
        ).pack(fill="x", padx=20, pady=(20, 16))

        fields = {}

        def add_field(label, key, options=None):
            ctk.CTkLabel(
                scroll, text=label, font=theme.font(12),
                text_color=theme.TEXT_DIM, anchor="w",
            ).pack(fill="x", padx=20, pady=(8, 2))
            if options:
                w = ctk.CTkComboBox(scroll, values=options, width=300, font=theme.font(13))
                w.set(str(data.get(key, options[0])))
            else:
                w = theme.create_entry(scroll, width=300)
                w.insert(0, str(data.get(key, "")))
            w.pack(fill="x", padx=20, pady=(0, 4))
            fields[key] = w

        add_field("Title", "title")
        add_field("Department", "department")
        add_field("Location", "location")
        add_field("Salary", "salary")
        add_field("Description", "description")
        add_field("Status", "status", config.VACANCY_STATUS_OPTIONS)

        def save():
            result = {"id": data.get("id")}
            for k, w in fields.items():
                result[k] = w.get().strip() if isinstance(w, (ctk.CTkEntry, ctk.CTkComboBox)) else w.get()
            self.db.save_vacancy(result)
            modal.destroy()
            self.app.show_toast("Vacancy saved", "success")
            self._refresh_subtab("careers")

        btn_frame = ctk.CTkFrame(scroll, fg_color="transparent")
        btn_frame.pack(fill="x", padx=20, pady=(16, 20))
        theme.create_accent_button(btn_frame, "💾 Save", command=save, width=120).pack(side="left", padx=(0, 8))
        ctk.CTkButton(btn_frame, text="Cancel", width=80, height=36,
                      fg_color="transparent", hover_color=theme.BG_CARD_HOVER,
                      border_width=1, border_color=theme.TEXT_DIM,
                      text_color=theme.TEXT_DIM, corner_radius=8,
                      command=modal.destroy).pack(side="left")

    def _open_application(self, values: dict):
        app_id = values.get("id")
        if app_id:
            application = self.db.get_application(app_id)
            if application:
                self._open_application_modal(application)

    def _open_application_modal(self, data: dict):
        modal = ctk.CTkToplevel(self)
        modal.title("Application Details")
        modal.geometry("500x450")
        modal.transient(self.winfo_toplevel())
        modal.grab_set()

        modal.update_idletasks()
        x = (modal.winfo_screenwidth() - 500) // 2
        y = (modal.winfo_screenheight() - 500) // 2
        modal.geometry(f"500x450+{x}+{y}")

        scroll = ctk.CTkScrollableFrame(modal, fg_color=theme.BG_DARK)
        scroll.pack(fill="both", expand=True)

        ctk.CTkLabel(
            scroll, text="📄 Application",
            font=theme.font_heading(), text_color=theme.TEXT_LIGHT,
        ).pack(fill="x", padx=20, pady=(20, 16))

        # Read-only info
        info_items = [
            ("Name", data.get("name", "")),
            ("Email", data.get("email", "")),
            ("Phone", data.get("phone", "")),
            ("Position", data.get("position", "")),
            ("Experience", data.get("experience", "")),
            ("Applied", (data.get("created_at", "") or "")[:10]),
        ]

        for label, value in info_items:
            row = ctk.CTkFrame(scroll, fg_color="transparent")
            row.pack(fill="x", padx=20, pady=3)
            row.grid_columnconfigure(1, weight=1)
            ctk.CTkLabel(row, text=label, font=theme.font(12), text_color=theme.TEXT_DIM, width=100, anchor="w").grid(row=0, column=0, sticky="w")
            ctk.CTkLabel(row, text=value, font=theme.font_bold(12), text_color=theme.TEXT_LIGHT, anchor="w").grid(row=0, column=1, sticky="w")

        # Status update
        ctk.CTkLabel(scroll, text="Status", font=theme.font(12), text_color=theme.TEXT_DIM, anchor="w").pack(fill="x", padx=20, pady=(12, 2))
        status_combo = ctk.CTkComboBox(scroll, values=config.APPLICATION_STATUS_OPTIONS, width=200, font=theme.font(13))
        status_combo.set(data.get("status", "New"))
        status_combo.pack(fill="x", padx=20, pady=(0, 8))

        def save():
            data["status"] = status_combo.get()
            self.db.save_application(data)
            modal.destroy()
            self.app.show_toast("Application updated", "success")
            self._refresh_subtab("careers")

        theme.create_accent_button(scroll, "💾 Update Status", command=save, width=140).pack(padx=20, pady=(8, 20), anchor="w")

    def _add_product(self):
        self._open_product_modal({})

    def _open_product(self, values: dict):
        prod_id = values.get("id")
        if prod_id:
            products = self.db.get_products()
            for p in products:
                if p.get("id") == prod_id:
                    self._open_product_modal(p)
                    return

    def _open_product_modal(self, data: dict):
        modal = ctk.CTkToplevel(self)
        modal.title("Product" if data.get("id") else "New Product")
        modal.geometry("500x500")
        modal.transient(self.winfo_toplevel())
        modal.grab_set()

        modal.update_idletasks()
        x = (modal.winfo_screenwidth() - 500) // 2
        y = (modal.winfo_screenheight() - 500) // 2
        modal.geometry(f"500x500+{x}+{y}")

        scroll = ctk.CTkScrollableFrame(modal, fg_color=theme.BG_DARK)
        scroll.pack(fill="both", expand=True)

        ctk.CTkLabel(
            scroll, text="🛒 Product Details",
            font=theme.font_heading(), text_color=theme.TEXT_LIGHT,
        ).pack(fill="x", padx=20, pady=(20, 16))

        fields = {}

        def add_field(label, key, options=None):
            ctk.CTkLabel(scroll, text=label, font=theme.font(12), text_color=theme.TEXT_DIM, anchor="w").pack(fill="x", padx=20, pady=(8, 2))
            if options:
                w = ctk.CTkComboBox(scroll, values=options, width=300, font=theme.font(13))
                w.set(str(data.get(key, options[0])))
            else:
                w = theme.create_entry(scroll, width=300)
                w.insert(0, str(data.get(key, "")))
            w.pack(fill="x", padx=20, pady=(0, 4))
            fields[key] = w

        add_field("Name", "name")
        add_field("Category", "category")
        add_field("Price (pence)", "price_pence")
        add_field("Description", "description")
        add_field("Stock", "stock")
        add_field("Status", "status", config.PRODUCT_STATUS_OPTIONS)

        def save():
            result = {"id": data.get("id")}
            for k, w in fields.items():
                val = w.get().strip() if isinstance(w, (ctk.CTkEntry, ctk.CTkComboBox)) else w.get()
                result[k] = val
            # Convert price_pence to int
            try:
                result["price_pence"] = int(result.get("price_pence", 0) or 0)
            except ValueError:
                result["price_pence"] = 0
            try:
                result["stock"] = int(result.get("stock", 0) or 0)
            except ValueError:
                result["stock"] = 0

            self.db.save_product(result)
            modal.destroy()
            self.app.show_toast("Product saved", "success")
            self._refresh_subtab("shop")

        btn_frame = ctk.CTkFrame(scroll, fg_color="transparent")
        btn_frame.pack(fill="x", padx=20, pady=(16, 20))
        theme.create_accent_button(btn_frame, "💾 Save", command=save, width=120).pack(side="left", padx=(0, 8))
        ctk.CTkButton(btn_frame, text="Cancel", width=80, height=36,
                      fg_color="transparent", hover_color=theme.BG_CARD_HOVER,
                      border_width=1, border_color=theme.TEXT_DIM,
                      text_color=theme.TEXT_DIM, corner_radius=8,
                      command=modal.destroy).pack(side="left")

    def _open_order(self, values: dict):
        """Open order detail — update status."""
        order_id = values.get("id")
        if not order_id:
            return
        orders = self.db.get_orders()
        order = next((o for o in orders if o.get("id") == order_id), None)
        if not order:
            return

        modal = ctk.CTkToplevel(self)
        modal.title(f"Order #{order_id}")
        modal.geometry("400x350")
        modal.transient(self.winfo_toplevel())
        modal.grab_set()

        scroll = ctk.CTkScrollableFrame(modal, fg_color=theme.BG_DARK)
        scroll.pack(fill="both", expand=True)

        for label, value in [
            ("Customer", order.get("customer_name", "")),
            ("Product", order.get("product_name", "")),
            ("Quantity", str(order.get("quantity", 1))),
            ("Total", f"£{int(order.get('total_pence', 0)) / 100:.2f}"),
            ("Date", order.get("date", "")),
        ]:
            row = ctk.CTkFrame(scroll, fg_color="transparent")
            row.pack(fill="x", padx=20, pady=3)
            row.grid_columnconfigure(1, weight=1)
            ctk.CTkLabel(row, text=label, font=theme.font(12), text_color=theme.TEXT_DIM, width=80, anchor="w").grid(row=0, column=0, sticky="w")
            ctk.CTkLabel(row, text=value, font=theme.font_bold(12), text_color=theme.TEXT_LIGHT, anchor="w").grid(row=0, column=1, sticky="w")

        ctk.CTkLabel(scroll, text="Status", font=theme.font(12), text_color=theme.TEXT_DIM, anchor="w").pack(fill="x", padx=20, pady=(12, 2))
        status_combo = ctk.CTkComboBox(scroll, values=config.ORDER_STATUS_OPTIONS, width=200, font=theme.font(13))
        status_combo.set(order.get("order_status", "Processing"))
        status_combo.pack(fill="x", padx=20, pady=(0, 12))

        def save():
            order["order_status"] = status_combo.get()
            self.db.save_order(order)
            modal.destroy()
            self.app.show_toast("Order updated", "success")
            self._refresh_subtab("shop")

        theme.create_accent_button(scroll, "💾 Update", command=save, width=120).pack(padx=20, pady=(8, 20), anchor="w")

    # ------------------------------------------------------------------
    # Actions
    # ------------------------------------------------------------------
    def _force_full_sync(self):
        self.sync.force_sync()
        self.app.show_toast("Full sync started", "info")

    def _backup_db(self):
        import shutil
        backup_name = f"ggm_hub_backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}.db"
        backup_path = config.BACKUP_DIR / backup_name
        try:
            shutil.copy2(config.DB_PATH, backup_path)
            self.app.show_toast(f"Backup saved: {backup_name}", "success")
        except Exception as e:
            self.app.show_toast(f"Backup failed: {e}", "error")

    # ------------------------------------------------------------------
    # Data Loading
    # ------------------------------------------------------------------
    def _refresh_subtab(self, key: str):
        try:
            if key == "careers":
                self._load_careers()
            elif key == "shop":
                self._load_shop()
            elif key == "agents":
                self._load_agents()
            elif key == "strategy":
                self._load_strategy()
            elif key == "milestones":
                self._load_milestones()
        except Exception:
            import traceback
            traceback.print_exc()

    def _load_careers(self):
        vacancies = self.db.get_vacancies()
        rows = []
        for v in vacancies:
            rows.append({
                "id": v.get("id", ""),
                "title": v.get("title", ""),
                "department": v.get("department", ""),
                "location": v.get("location", "Cornwall"),
                "salary": v.get("salary", ""),
                "status": v.get("status", ""),
                "posted_date": (v.get("posted_date", "") or "")[:10],
            })
        self.vacancies_table.set_data(rows)

        applications = self.db.get_applications()
        app_rows = []
        for a in applications:
            app_rows.append({
                "id": a.get("id", ""),
                "name": a.get("name", ""),
                "email": a.get("email", ""),
                "position": a.get("position", ""),
                "status": a.get("status", ""),
                "created_at": (a.get("created_at", "") or "")[:10],
            })
        self.applications_table.set_data(app_rows)

    def _load_shop(self):
        products = self.db.get_products()
        rows = []
        for p in products:
            price_pence = int(p.get("price_pence", 0) or 0)
            rows.append({
                "id": p.get("id", ""),
                "name": p.get("name", ""),
                "category": p.get("category", ""),
                "price_display": f"£{price_pence / 100:.2f}",
                "stock": str(p.get("stock", 0)),
                "status": p.get("status", ""),
            })
        self.products_table.set_data(rows)

        orders = self.db.get_orders()
        order_rows = []
        for o in orders:
            total_pence = int(o.get("total_pence", 0) or 0)
            order_rows.append({
                "id": o.get("id", ""),
                "customer_name": o.get("customer_name", ""),
                "product_name": o.get("product_name", ""),
                "quantity": str(o.get("quantity", 1)),
                "total_display": f"£{total_pence / 100:.2f}",
                "order_status": o.get("order_status", ""),
                "date": (o.get("date", "") or "")[:10],
            })
        self.orders_table.set_data(order_rows)

    def _load_milestones(self):
        try:
            stats = self.db.get_revenue_stats()
            current_revenue = stats.get("ytd", 0)
            current_monthly = stats.get("month", 0)
            self._render_milestones(current_revenue, current_monthly)
        except Exception:
            self._render_milestones(0, 0)

    # ------------------------------------------------------------------
    # Refresh
    # ------------------------------------------------------------------
    def refresh(self):
        if self._current_sub:
            self._refresh_subtab(self._current_sub)
