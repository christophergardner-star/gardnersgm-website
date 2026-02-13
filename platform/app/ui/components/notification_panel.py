"""
Notification Panel — dropdown panel showing recent notifications.
Appears when the user clicks the bell icon in the top bar.
"""

import customtkinter as ctk
from datetime import datetime
from .. import theme


class NotificationPanel(ctk.CTkToplevel):
    """
    A dropdown notification panel anchored to the bell icon.
    Shows unread and recent notifications with mark-as-read support.
    """

    def __init__(self, parent, db, on_click=None, **kwargs):
        super().__init__(parent, **kwargs)

        self.db = db
        self._on_click = on_click

        # ── Window setup — borderless dropdown ──
        self.overrideredirect(True)
        self.attributes("-topmost", True)
        self.configure(fg_color=theme.BG_DARKER)
        self.geometry("380x460")

        # Position relative to parent window
        self.update_idletasks()

        self._build_ui()
        self._load_notifications()

        # Close when clicking outside
        self.bind("<FocusOut>", lambda e: self.after(200, self._maybe_close))

    def position_near(self, widget):
        """Position the panel below the given widget."""
        self.update_idletasks()
        x = widget.winfo_rootx() + widget.winfo_width() - 380
        y = widget.winfo_rooty() + widget.winfo_height() + 4
        # Ensure it doesn't go off-screen to the left
        if x < 0:
            x = widget.winfo_rootx()
        self.geometry(f"380x460+{x}+{y}")

    def _build_ui(self):
        """Build the notification panel layout."""
        # Outer border frame
        border = ctk.CTkFrame(self, fg_color=theme.GREEN_PRIMARY, corner_radius=12)
        border.pack(fill="both", expand=True, padx=1, pady=1)

        inner = ctk.CTkFrame(border, fg_color=theme.BG_DARKER, corner_radius=11)
        inner.pack(fill="both", expand=True, padx=1, pady=1)

        # Header
        header = ctk.CTkFrame(inner, fg_color=theme.BG_CARD, corner_radius=0, height=46)
        header.pack(fill="x")
        header.pack_propagate(False)
        header.grid_columnconfigure(0, weight=1)

        ctk.CTkLabel(
            header,
            text="🔔 Notifications",
            font=theme.font_bold(14),
            text_color=theme.TEXT_LIGHT,
            anchor="w",
        ).grid(row=0, column=0, padx=14, pady=10, sticky="w")

        self._unread_label = ctk.CTkLabel(
            header,
            text="",
            font=theme.font(11),
            text_color=theme.GREEN_LIGHT,
        )
        self._unread_label.grid(row=0, column=1, padx=4, pady=10)

        mark_all_btn = ctk.CTkButton(
            header,
            text="Mark all read",
            font=theme.font(11),
            fg_color="transparent",
            hover_color=theme.BG_CARD_HOVER,
            text_color=theme.GREEN_LIGHT,
            width=90, height=28,
            corner_radius=6,
            command=self._mark_all_read,
        )
        mark_all_btn.grid(row=0, column=2, padx=(0, 10), pady=10)

        # Scrollable notification list
        self._list = ctk.CTkScrollableFrame(
            inner,
            fg_color="transparent",
            scrollbar_button_color=theme.BG_CARD,
        )
        self._list.pack(fill="both", expand=True, padx=4, pady=4)
        self._list.grid_columnconfigure(0, weight=1)

        # Empty state
        self._empty_label = ctk.CTkLabel(
            self._list,
            text="No notifications yet",
            font=theme.font(12),
            text_color=theme.TEXT_DIM,
        )

    def _load_notifications(self):
        """Load notifications from the database and render them."""
        # Clear existing
        for w in self._list.winfo_children():
            w.destroy()

        notifications = self.db.get_notifications(limit=30)
        unread = self.db.get_unread_count()

        if unread > 0:
            self._unread_label.configure(text=f"{unread} unread")
        else:
            self._unread_label.configure(text="")

        if not notifications:
            self._empty_label = ctk.CTkLabel(
                self._list,
                text="No notifications yet\n\nNotifications will appear here when\nnew bookings, enquiries, or payments arrive.",
                font=theme.font(12),
                text_color=theme.TEXT_DIM,
                justify="center",
            )
            self._empty_label.pack(pady=40)
            return

        for i, notif in enumerate(notifications):
            self._create_notification_row(notif, i)

    def _create_notification_row(self, notif: dict, index: int):
        """Create a single notification row."""
        is_unread = not notif.get("read", 0)

        row = ctk.CTkFrame(
            self._list,
            fg_color=theme.BG_CARD if is_unread else "transparent",
            corner_radius=8,
            cursor="hand2",
        )
        row.pack(fill="x", pady=2, padx=2)
        row.grid_columnconfigure(1, weight=1)

        # Unread dot
        if is_unread:
            dot = ctk.CTkLabel(
                row, text="●",
                font=theme.font(8),
                text_color=theme.GREEN_LIGHT,
                width=16,
            )
            dot.grid(row=0, column=0, rowspan=2, padx=(8, 2), sticky="w")

        # Icon + title row
        icon = notif.get("icon", "🔔")
        title = notif.get("title", "Notification")
        title_text = f"{icon} {title}"

        title_label = ctk.CTkLabel(
            row,
            text=title_text,
            font=theme.font_bold(12) if is_unread else theme.font(12),
            text_color=theme.TEXT_LIGHT if is_unread else theme.TEXT_DIM,
            anchor="w",
        )
        title_label.grid(
            row=0, column=1, sticky="ew",
            padx=(10 if not is_unread else 2, 8), pady=(8, 0),
        )

        # Message
        message = notif.get("message", "")
        if message:
            msg_label = ctk.CTkLabel(
                row, text=message,
                font=theme.font(11),
                text_color=theme.TEXT_DIM,
                anchor="w",
                wraplength=280,
            )
            msg_label.grid(
                row=1, column=1, sticky="ew",
                padx=(10 if not is_unread else 2, 8), pady=(0, 2),
            )

        # Time
        created = notif.get("created_at", "")
        time_str = self._format_time_ago(created)
        ctk.CTkLabel(
            row, text=time_str,
            font=theme.font(10),
            text_color=theme.TEXT_DIM,
            anchor="e",
        ).grid(row=0, column=2, padx=(4, 10), pady=(8, 0), sticky="ne")

        # Click handler — mark read + callback
        def on_click(event, n=notif):
            if not n.get("read", 0):
                self.db.mark_notification_read(n["id"])
            if self._on_click:
                self._on_click(n)
            self.destroy()

        for widget in [row, title_label]:
            widget.bind("<Button-1>", on_click)
        if message:
            msg_label.bind("<Button-1>", on_click)

    def _format_time_ago(self, iso_str: str) -> str:
        """Format an ISO timestamp as a relative time string."""
        if not iso_str:
            return ""
        try:
            dt = datetime.fromisoformat(iso_str)
            now = datetime.now()
            diff = now - dt

            seconds = int(diff.total_seconds())
            if seconds < 60:
                return "Just now"
            minutes = seconds // 60
            if minutes < 60:
                return f"{minutes}m ago"
            hours = minutes // 60
            if hours < 24:
                return f"{hours}h ago"
            days = hours // 24
            if days == 1:
                return "Yesterday"
            if days < 7:
                return f"{days}d ago"
            return dt.strftime("%d %b")
        except Exception:
            return ""

    def _mark_all_read(self):
        """Mark all notifications as read and refresh."""
        self.db.mark_all_notifications_read()
        self._load_notifications()

    def _maybe_close(self):
        """Close the panel if it lost focus."""
        try:
            if not self.focus_get():
                self.destroy()
        except Exception:
            self.destroy()
