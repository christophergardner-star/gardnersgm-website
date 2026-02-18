"""
Main application window for GGM Hub.
Sidebar navigation + content area + status bar.
"""

import customtkinter as ctk
import logging
from datetime import datetime

from . import theme
from .components.toast import ToastManager
from .. import config

log = logging.getLogger("ggm.ui")


class AppWindow(ctk.CTk):
    """Main GGM Hub application window."""

    def __init__(self, db, sync_engine, api, agent_scheduler=None, email_engine=None, heartbeat=None):
        super().__init__()

        self.db = db
        self.sync = sync_engine
        self.api = api
        self.agent_scheduler = agent_scheduler
        self._email_engine = email_engine
        self._heartbeat = heartbeat
        self.toast = None
        self._current_tab = None
        self._tab_frames = {}
        self._nav_buttons = {}
        self._first_sync_done = False

        # ── Window setup ──
        node_label = "Field" if config.IS_LAPTOP else "Hub"
        self.title(f"GGM {node_label} — Gardners Ground Maintenance")
        self.minsize(1100, 700)

        # Size to fit the screen (leave room for taskbar)
        self.update_idletasks()
        screen_w = self.winfo_screenwidth()
        screen_h = self.winfo_screenheight()
        taskbar_reserve = 80          # pixels kept clear for Windows taskbar
        title_bar = 32                # approx. title-bar height

        w = min(1400, screen_w - 20)  # 10 px margin each side
        h = min(850, screen_h - taskbar_reserve - title_bar)

        x = max(0, (screen_w - w) // 2)
        y = max(0, (screen_h - taskbar_reserve - h) // 2)
        self.geometry(f"{w}x{h}+{x}+{y}")

        # Allow maximise but show the window in normal state first
        self.state("normal")

        # ── Build layout ──
        self._build_ui()

        # ── Toast system ──
        self.toast = ToastManager(self)

        # ── Sync event polling ──
        self._poll_sync_events()

        # ── Show overview on start ──
        self.after(100, lambda: self._switch_tab("overview"))

    # ------------------------------------------------------------------
    # UI Construction
    # ------------------------------------------------------------------
    def _build_ui(self):
        """Build the main window layout."""
        # Root grid: sidebar | content
        self.grid_rowconfigure(0, weight=1)
        self.grid_columnconfigure(1, weight=1)

        # ── Sidebar ──
        self.sidebar = ctk.CTkFrame(
            self,
            width=220,
            fg_color=theme.BG_SIDEBAR,
            corner_radius=0,
        )
        self.sidebar.grid(row=0, column=0, sticky="nsw")
        self.sidebar.grid_propagate(False)
        self._build_sidebar()

        # ── Right panel (top bar + content + status bar) ──
        self.right_panel = ctk.CTkFrame(self, fg_color=theme.BG_DARK, corner_radius=0)
        self.right_panel.grid(row=0, column=1, sticky="nsew")
        self.right_panel.grid_rowconfigure(1, weight=1)
        self.right_panel.grid_columnconfigure(0, weight=1)

        # Top bar
        self._build_top_bar()

        # Content area
        self.content_area = ctk.CTkFrame(
            self.right_panel,
            fg_color=theme.BG_DARK,
            corner_radius=0,
        )
        self.content_area.grid(row=1, column=0, sticky="nsew", padx=0, pady=0)
        self.content_area.grid_rowconfigure(0, weight=1)
        self.content_area.grid_columnconfigure(0, weight=1)

        # Status bar
        self._build_status_bar()

    def _build_sidebar(self):
        """Build the left sidebar with logo + navigation."""
        # ── Logo area ──
        logo_frame = ctk.CTkFrame(self.sidebar, fg_color="transparent", height=70)
        logo_frame.pack(fill="x", padx=16, pady=(20, 10))
        logo_frame.pack_propagate(False)

        ctk.CTkLabel(
            logo_frame,
            text="🌿 GGM Hub",
            font=theme.font_bold(20),
            text_color=theme.GREEN_LIGHT,
            anchor="w",
        ).pack(fill="x")

        ctk.CTkLabel(
            logo_frame,
            text="Business Platform",
            font=theme.font_small(),
            text_color=theme.TEXT_DIM,
            anchor="w",
        ).pack(fill="x")

        # ── Divider ──
        ctk.CTkFrame(
            self.sidebar, height=1, fg_color=theme.BG_CARD
        ).pack(fill="x", padx=16, pady=(5, 15))

        # ── Nav label ──
        ctk.CTkLabel(
            self.sidebar,
            text="  MAIN MENU",
            font=theme.font(10, "bold"),
            text_color=theme.TEXT_DIM,
            anchor="w",
        ).pack(fill="x", padx=16, pady=(0, 5))

        # ── Navigation buttons ──
        nav_items = [
            ("overview",      "📊", "Overview"),
            ("dispatch",      "🚐", "Daily Dispatch"),
            ("operations",    "👥", "Operations"),
            ("finance",       "💰", "Finance"),
            ("telegram",      "📱", "Telegram"),
            ("marketing",     "📣", "Marketing"),
            ("customer_care", "🤝", "Customer Care"),
            ("admin",         "⚙️", "Admin"),
        ]

        # Field-specific tabs (shown on laptop, hidden on PC)
        if config.IS_LAPTOP:
            nav_items.extend([
                ("field_triggers", "🖥️", "PC Triggers"),
                ("job_tracking",   "⏱️", "Job Tracking"),
                ("field_notes",    "📝", "Field Notes"),
            ])

        for tab_id, icon, label in nav_items:
            btn = theme.create_sidebar_button(
                self.sidebar, label, icon,
                command=lambda t=tab_id: self._switch_tab(t),
            )
            btn.pack(fill="x", padx=12, pady=2)
            self._nav_buttons[tab_id] = btn

        # ── Spacer ──
        ctk.CTkFrame(self.sidebar, fg_color="transparent").pack(fill="both", expand=True)

        # ── Bottom actions ──
        ctk.CTkFrame(
            self.sidebar, height=1, fg_color=theme.BG_CARD
        ).pack(fill="x", padx=16, pady=(5, 10))

        # Sync button
        self.sync_btn = theme.create_outline_button(
            self.sidebar, "↻  Force Sync",
            command=self._force_sync,
        )
        self.sync_btn.pack(fill="x", padx=16, pady=(0, 5))

        # Version
        ctk.CTkLabel(
            self.sidebar,
            text=f"v{config.APP_VERSION}",
            font=theme.font(10),
            text_color=theme.TEXT_DIM,
        ).pack(pady=(0, 12))

    def _build_top_bar(self):
        """Build the top bar with search and sync status."""
        top_bar = ctk.CTkFrame(
            self.right_panel,
            height=56,
            fg_color=theme.BG_DARKER,
            corner_radius=0,
        )
        top_bar.grid(row=0, column=0, sticky="new")
        top_bar.grid_propagate(False)
        top_bar.grid_columnconfigure(1, weight=1)

        # Tab title
        self.tab_title = ctk.CTkLabel(
            top_bar,
            text="Overview",
            font=theme.font_bold(18),
            text_color=theme.TEXT_LIGHT,
        )
        self.tab_title.grid(row=0, column=0, padx=20, pady=12, sticky="w")

        # Search bar
        self.search_entry = theme.create_entry(
            top_bar,
            placeholder="Search clients, invoices...",
            width=300,
        )
        self.search_entry.grid(row=0, column=1, padx=20, pady=12)
        self.search_entry.bind("<Return>", self._on_search)

        # Sync status indicator
        self.sync_indicator = ctk.CTkLabel(
            top_bar,
            text="● Syncing...",
            font=theme.font(12),
            text_color=theme.AMBER,
        )
        self.sync_indicator.grid(row=0, column=2, padx=20, pady=12, sticky="e")

        # Notification bell
        self._notification_panel = None
        self._bell_frame = ctk.CTkFrame(top_bar, fg_color="transparent", width=44, height=40)
        self._bell_frame.grid(row=0, column=3, padx=(4, 4), pady=12, sticky="e")
        self._bell_frame.grid_propagate(False)

        self._bell_btn = ctk.CTkButton(
            self._bell_frame,
            text="🔔",
            width=38, height=34,
            fg_color="transparent",
            hover_color=theme.BG_CARD,
            corner_radius=8,
            font=theme.font(18),
            command=self._toggle_notifications,
        )
        self._bell_btn.place(x=0, y=0, relwidth=1, relheight=1)

        # Unread badge (red dot with count)
        self._badge_label = ctk.CTkLabel(
            self._bell_frame,
            text="",
            font=ctk.CTkFont(family="Segoe UI", size=9, weight="bold"),
            fg_color=theme.RED,
            text_color="white",
            corner_radius=8,
            width=18, height=18,
        )
        # Initially hidden — shown when there are unread notifications
        self._badge_label.place_forget()

        # Date
        today_str = datetime.now().strftime("%a %d %b %Y")
        ctk.CTkLabel(
            top_bar,
            text=today_str,
            font=theme.font(12),
            text_color=theme.TEXT_DIM,
        ).grid(row=0, column=4, padx=(0, 20), pady=12, sticky="e")

        # Start badge refresh cycle
        self.after(2000, self._refresh_notification_badge)

    def _build_status_bar(self):
        """Build the bottom status bar."""
        status_bar = ctk.CTkFrame(
            self.right_panel,
            height=28,
            fg_color=theme.BG_DARKER,
            corner_radius=0,
        )
        status_bar.grid(row=2, column=0, sticky="sew")
        status_bar.grid_propagate(False)
        status_bar.grid_columnconfigure(1, weight=1)

        self.status_label = ctk.CTkLabel(
            status_bar,
            text="Starting up...",
            font=theme.font(11),
            text_color=theme.TEXT_DIM,
            anchor="w",
        )
        self.status_label.grid(row=0, column=0, padx=12, sticky="w")

        self.db_label = ctk.CTkLabel(
            status_bar,
            text="",
            font=theme.font(11),
            text_color=theme.TEXT_DIM,
            anchor="e",
        )
        self.db_label.grid(row=0, column=2, padx=12, sticky="e")

        # Build / commit label
        try:
            from app.updater import get_current_version_info
            info = get_current_version_info()
            build_text = f"Build: {info.get('commit', '?')}"
        except Exception:
            build_text = ""
        self.build_label = ctk.CTkLabel(
            status_bar,
            text=build_text,
            font=theme.font(10),
            text_color=theme.TEXT_DIM,
            anchor="e",
        )
        self.build_label.grid(row=0, column=1, padx=4, sticky="e")

        # Field App status badge
        self._field_badge = ctk.CTkLabel(
            status_bar,
            text="⚪ Field: Checking...",
            font=theme.font(10, "bold"),
            text_color=theme.TEXT_DIM,
            anchor="e",
        )
        self._field_badge.grid(row=0, column=3, padx=(8, 12), sticky="e")

        # Version mismatch warning label (hidden by default)
        self._version_warn = ctk.CTkLabel(
            status_bar,
            text="",
            font=theme.font(10, "bold"),
            text_color=theme.AMBER,
            anchor="e",
        )
        self._version_warn.grid(row=0, column=4, padx=(4, 12), sticky="e")

        # Start periodic badge refresh
        self.after(3000, self._refresh_field_badge)

    # ------------------------------------------------------------------
    # Field App Status Badge
    # ------------------------------------------------------------------
    def _refresh_field_badge(self):
        """Update the Field/PC status indicator in the status bar."""
        try:
            if self._heartbeat:
                # On laptop, watch the PC Hub; on PC, watch the laptop
                peer = "pc_hub" if config.IS_LAPTOP else "field_laptop"
                peer_label = "PC Hub" if config.IS_LAPTOP else "Field"
                status = self._heartbeat.get_peer_status(peer)
                if status and status.get("status", "").lower() == "online":
                    text = f"🟢 {peer_label}: Online"
                    color = theme.GREEN_LIGHT
                elif status:
                    text = f"🔴 {peer_label}: Offline"
                    color = theme.RED
                else:
                    text = f"⚪ {peer_label}: Unknown"
                    color = theme.TEXT_DIM
                self._field_badge.configure(text=text, text_color=color)

                # Version mismatch check
                vm = self._heartbeat.check_version_mismatch()
                if vm and not vm.get("aligned") and vm.get("mismatches"):
                    m = vm["mismatches"][0]
                    warn = f"⚠ {m['node_id']}: v{m['peer_version']} (this: v{m['local_version']})"
                    self._version_warn.configure(text=warn, text_color=theme.AMBER)
                else:
                    self._version_warn.configure(text="", text_color=theme.AMBER)
            else:
                self._field_badge.configure(text="⚪ Peer: N/A", text_color=theme.TEXT_DIM)
        except Exception:
            pass
        # Refresh every 30 seconds
        self.after(30_000, self._refresh_field_badge)

    # ------------------------------------------------------------------
    # Notifications
    # ------------------------------------------------------------------
    def _refresh_notification_badge(self):
        """Update the bell badge with the current unread count."""
        try:
            count = self.db.get_unread_count()
            if count > 0:
                display = str(count) if count < 100 else "99+"
                self._badge_label.configure(text=display)
                self._badge_label.place(relx=1.0, y=0, anchor="ne")
            else:
                self._badge_label.place_forget()
        except Exception:
            pass
        self.after(15_000, self._refresh_notification_badge)

    def _toggle_notifications(self):
        """Open or close the notification panel."""
        # Close if already open
        if self._notification_panel and self._notification_panel.winfo_exists():
            self._notification_panel.destroy()
            self._notification_panel = None
            return

        from .components.notification_panel import NotificationPanel
        self._notification_panel = NotificationPanel(
            self, self.db,
            on_click=self._on_notification_click,
        )
        self._notification_panel.position_near(self._bell_frame)
        self._notification_panel.focus_set()
        # Refresh badge after viewing
        self.after(500, self._refresh_notification_badge)

    def _on_notification_click(self, notification: dict):
        """Handle clicking a notification — navigate to relevant view."""
        ntype = notification.get("type", "")
        client_name = notification.get("client_name", "")
        job_number = notification.get("job_number", "")

        # Try to open the client
        if client_name:
            clients = self.db.get_clients(search=client_name)
            if clients:
                from .components.client_modal import ClientModal
                ClientModal(
                    self, clients[0], self.db, self.sync,
                    on_save=lambda: self.refresh_current_tab(),
                )
                return

        # Fallback: switch to relevant tab
        tab_map = {
            "booking": "operations",
            "enquiry": "customer_care",
            "payment": "finance",
            "subscription": "operations",
        }
        target = tab_map.get(ntype, "overview")
        self._switch_tab(target)

        # Refresh badge
        self._refresh_notification_badge()

    # ------------------------------------------------------------------
    # Tab Switching
    # ------------------------------------------------------------------
    def _switch_tab(self, tab_id: str):
        """Switch the visible tab in the content area."""
        if tab_id == self._current_tab:
            return

        # Update nav button styles
        for tid, btn in self._nav_buttons.items():
            if tid == tab_id:
                btn.configure(
                    fg_color=theme.GREEN_PRIMARY,
                    text_color="white",
                )
            else:
                btn.configure(
                    fg_color="transparent",
                    text_color=theme.TEXT_DIM,
                )

        # Hide current tab
        if self._current_tab and self._current_tab in self._tab_frames:
            self._tab_frames[self._current_tab].grid_forget()

        # Show / create new tab
        if tab_id not in self._tab_frames:
            self._tab_frames[tab_id] = self._create_tab(tab_id)

        frame = self._tab_frames[tab_id]
        frame.grid(row=0, column=0, sticky="nsew")

        # Update title
        titles = {
            "overview": "Overview",
            "dispatch": "Daily Dispatch",
            "operations": "Operations",
            "finance": "Finance",
            "telegram": "Telegram",
            "marketing": "Marketing",
            "customer_care": "Customer Care",
            "admin": "Admin",
            "field_triggers": "PC Triggers",
            "job_tracking": "Job Tracking",
            "field_notes": "Field Notes",
        }
        self.tab_title.configure(text=titles.get(tab_id, tab_id.title()))
        self._current_tab = tab_id

        # Refresh tab data
        if hasattr(frame, "refresh"):
            frame.refresh()

    def _create_tab(self, tab_id: str):
        """Lazily create a tab frame — each import isolated so one bad
        module never blanks the entire app."""
        tab_imports = [
            ("overview",        "OverviewTab",       "..tabs.overview"),
            ("dispatch",        "DispatchTab",       "..tabs.dispatch"),
            ("operations",      "OperationsTab",     "..tabs.operations"),
            ("finance",         "FinanceTab",        "..tabs.finance"),
            ("telegram",        "TelegramTab",       "..tabs.telegram"),
            ("marketing",       "MarketingTab",      "..tabs.marketing"),
            ("customer_care",   "CustomerCareTab",   "..tabs.customer_care"),
            ("admin",           "AdminTab",          "..tabs.admin"),
            ("field_triggers",  "FieldTriggersTab",  "..tabs.field_triggers"),
            ("job_tracking",    "JobTrackingTab",    "..tabs.job_tracking"),
            ("field_notes",     "FieldNotesTab",     "..tabs.field_notes"),
        ]

        tab_classes: dict = {}
        for tid, cls_name, mod_path in tab_imports:
            try:
                import importlib
                mod = importlib.import_module(mod_path, package=__package__)
                tab_classes[tid] = getattr(mod, cls_name)
            except Exception as exc:
                log.error("Failed to import tab '%s': %s", tid, exc)

        cls = tab_classes.get(tab_id)
        if cls:
            try:
                tab = cls(self.content_area, self.db, self.sync, self.api, self)
                # Pass agent scheduler to admin tab
                if tab_id == "admin" and self.agent_scheduler:
                    tab._agent_scheduler = self.agent_scheduler
                return tab
            except Exception as exc:
                log.error("Failed to create tab '%s': %s", tab_id, exc)

        # Fallback error / coming-soon placeholder
        placeholder = ctk.CTkFrame(self.content_area, fg_color=theme.BG_DARK)
        msg = (f"⚠  {tab_id} failed to load — check logs"
               if tab_id in {t[0] for t in tab_imports}
               else f"{tab_id} — Coming Soon")
        colour = theme.RED if tab_id in {t[0] for t in tab_imports} else theme.TEXT_DIM
        ctk.CTkLabel(
            placeholder, text=msg,
            font=theme.font_heading(), text_color=colour,
        ).pack(expand=True)
        return placeholder

    # ------------------------------------------------------------------
    # Sync Event Handling
    # ------------------------------------------------------------------
    def _poll_sync_events(self):
        """Poll the sync engine's event queue and update the UI."""
        events = self.sync.get_events()
        for event_type, data in events:
            self._handle_sync_event(event_type, data)

        # Update status bar
        self._update_status_bar()

        # Poll again in 500ms
        self.after(500, self._poll_sync_events)

    def _handle_sync_event(self, event_type: str, data):
        """Handle a single sync event."""
        from ..sync import SyncEvent

        if event_type == SyncEvent.SYNC_STARTED:
            self.sync_indicator.configure(text="● Syncing...", text_color=theme.AMBER)

        elif event_type == SyncEvent.SYNC_COMPLETE:
            self.sync_indicator.configure(text="● Synced", text_color=theme.GREEN_LIGHT)
            # Refresh current tab
            if self._current_tab and self._current_tab in self._tab_frames:
                frame = self._tab_frames[self._current_tab]
                if hasattr(frame, "refresh"):
                    frame.refresh()

        elif event_type == SyncEvent.SYNC_ERROR:
            self.sync_indicator.configure(text="● Offline", text_color=theme.RED)
            if self.toast:
                self.toast.show(f"Sync: {data}", "warning")

        elif event_type == SyncEvent.ONLINE_STATUS:
            if data:
                self.sync_indicator.configure(text="● Online", text_color=theme.GREEN_LIGHT)
            else:
                self.sync_indicator.configure(text="● Offline", text_color=theme.RED)

        elif event_type == SyncEvent.TABLE_UPDATED:
            # Refresh the relevant tab
            if self._current_tab and self._current_tab in self._tab_frames:
                frame = self._tab_frames[self._current_tab]
                if hasattr(frame, "on_table_update"):
                    frame.on_table_update(data)

        elif event_type == SyncEvent.WRITE_SYNCED:
            if self.toast:
                self.toast.show(f"Saved to cloud", "success")

        elif event_type == SyncEvent.NEW_RECORDS:
            self._handle_new_records(data)

    def _handle_new_records(self, data):
        """Create notifications for newly discovered records after sync."""
        if not isinstance(data, tuple) or len(data) != 2:
            return
        table_name, new_items = data
        if not new_items:
            return

        # Skip first sync (initial load) — only notify after first full sync
        if not self._first_sync_done:
            self._first_sync_done = True
            return

        if table_name == "clients":
            for item in new_items[:5]:  # Cap at 5 notifications per sync
                name = item.get("name", "Unknown")
                service = item.get("service", "")
                price = float(item.get("price", 0) or 0)
                msg = f"{service}"
                if price:
                    msg += f" — £{price:,.0f}"
                self.db.add_notification(
                    ntype="booking",
                    title=f"New Booking: {name}",
                    message=msg,
                    icon="🆕",
                    client_name=name,
                    job_number=item.get("job_number", ""),
                )
            if len(new_items) > 5:
                self.db.add_notification(
                    ntype="booking",
                    title=f"... and {len(new_items) - 5} more new bookings",
                    message="",
                    icon="📋",
                )
            # Show toast
            if len(new_items) == 1:
                name = new_items[0].get("name", "?")
                self.toast.show(f"🆕 New booking: {name}", "success")
            else:
                self.toast.show(f"🆕 {len(new_items)} new bookings received", "success")
            self._refresh_notification_badge()

        elif table_name == "enquiries":
            for item in new_items[:5]:
                name = item.get("name", "Unknown")
                msg_text = (item.get("message", "") or "")[:80]
                self.db.add_notification(
                    ntype="enquiry",
                    title=f"New Enquiry: {name}",
                    message=msg_text,
                    icon="📩",
                    client_name=name,
                )
            if len(new_items) == 1:
                name = new_items[0].get("name", "?")
                self.toast.show(f"📩 New enquiry from {name}", "info")
            elif len(new_items) > 1:
                self.toast.show(f"📩 {len(new_items)} new enquiries", "info")
            self._refresh_notification_badge()

    def _update_status_bar(self):
        """Update the status bar with current state."""
        last_sync = self.sync.last_sync_time
        if last_sync:
            try:
                dt = datetime.fromisoformat(last_sync)
                time_str = dt.strftime("%H:%M:%S")
                self.status_label.configure(text=f"Last sync: {time_str}")
            except Exception:
                self.status_label.configure(text=f"Last sync: {last_sync[:19]}")
        else:
            self.status_label.configure(text="Not yet synced")

        # Client count
        try:
            count = self.db.fetchone("SELECT COUNT(*) as c FROM clients")
            if count:
                self.db_label.configure(text=f"SQLite: {count['c']} clients")
        except Exception:
            pass

    # ------------------------------------------------------------------
    # Actions
    # ------------------------------------------------------------------
    def _force_sync(self):
        """Force an immediate sync."""
        self.sync_indicator.configure(text="● Syncing...", text_color=theme.AMBER)
        self.sync.force_sync()
        if self.toast:
            self.toast.show("Sync started...", "info")

    def _on_search(self, event=None):
        """Handle search submission."""
        query = self.search_entry.get().strip()
        if query:
            results = self.db.search(query)
            # If results exist, switch to operations tab and show results
            if results:
                self._switch_tab("operations")
                frame = self._tab_frames.get("operations")
                if frame and hasattr(frame, "show_search_results"):
                    frame.show_search_results(results)
            else:
                if self.toast:
                    self.toast.show(f"No results for '{query}'", "info")

    # ------------------------------------------------------------------
    # Public helpers for tabs
    # ------------------------------------------------------------------
    def show_toast(self, message: str, level: str = "info"):
        if self.toast:
            self.toast.show(message, level)

    def refresh_current_tab(self):
        if self._current_tab and self._current_tab in self._tab_frames:
            frame = self._tab_frames[self._current_tab]
            if hasattr(frame, "refresh"):
                frame.refresh()
