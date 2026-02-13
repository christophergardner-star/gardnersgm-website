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

        # ── Window setup ──
        self.title("GGM Hub — Gardners Ground Maintenance")
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

        # Date
        today_str = datetime.now().strftime("%a %d %b %Y")
        ctk.CTkLabel(
            top_bar,
            text=today_str,
            font=theme.font(12),
            text_color=theme.TEXT_DIM,
        ).grid(row=0, column=3, padx=(0, 20), pady=12, sticky="e")

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

        # Start periodic badge refresh
        self.after(3000, self._refresh_field_badge)

    # ------------------------------------------------------------------
    # Field App Status Badge
    # ------------------------------------------------------------------
    def _refresh_field_badge(self):
        """Update the Field App status indicator in the status bar."""
        try:
            if self._heartbeat:
                status = self._heartbeat.get_peer_status("field_laptop")
                if status and status.get("status", "").lower() == "online":
                    text = "🟢 Field: Online"
                    color = theme.GREEN_LIGHT
                elif status:
                    text = "🔴 Field: Offline"
                    color = theme.RED
                else:
                    text = "⚪ Field: Unknown"
                    color = theme.TEXT_DIM
                self._field_badge.configure(text=text, text_color=color)
            else:
                self._field_badge.configure(text="⚪ Field: N/A", text_color=theme.TEXT_DIM)
        except Exception:
            pass
        # Refresh every 30 seconds
        self.after(30_000, self._refresh_field_badge)

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
        }
        self.tab_title.configure(text=titles.get(tab_id, tab_id.title()))
        self._current_tab = tab_id

        # Refresh tab data
        if hasattr(frame, "refresh"):
            frame.refresh()

    def _create_tab(self, tab_id: str):
        """Lazily create a tab frame."""
        from ..tabs.overview import OverviewTab
        from ..tabs.dispatch import DispatchTab
        from ..tabs.operations import OperationsTab
        from ..tabs.finance import FinanceTab
        from ..tabs.telegram import TelegramTab
        from ..tabs.marketing import MarketingTab
        from ..tabs.customer_care import CustomerCareTab
        from ..tabs.admin import AdminTab

        tab_classes = {
            "overview": OverviewTab,
            "dispatch": DispatchTab,
            "operations": OperationsTab,
            "finance": FinanceTab,
            "telegram": TelegramTab,
            "marketing": MarketingTab,
            "customer_care": CustomerCareTab,
            "admin": AdminTab,
        }

        cls = tab_classes.get(tab_id)
        if cls:
            tab = cls(self.content_area, self.db, self.sync, self.api, self)
            # Pass agent scheduler to admin tab
            if tab_id == "admin" and self.agent_scheduler:
                tab._agent_scheduler = self.agent_scheduler
            return tab
        else:
            placeholder = ctk.CTkFrame(self.content_area, fg_color=theme.BG_DARK)
            ctk.CTkLabel(
                placeholder, text=f"{tab_id} — Coming Soon",
                font=theme.font_heading(), text_color=theme.TEXT_DIM,
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
