"""
Inbox Tab — View and manage emails from enquiries@gardnersgm.co.uk.
Three-panel layout: folder sidebar, email list, reading pane.
"""

import customtkinter as ctk
import threading
import json
import webbrowser
from datetime import datetime

from ..ui import theme
from ..ui.compose_dialog import ComposeDialog
from .. import config


class InboxTab(ctk.CTkFrame):
    """Email inbox with list view and reading pane."""

    def __init__(self, parent, db, sync, api, app_window, **kwargs):
        super().__init__(parent, fg_color=theme.BG_DARK, **kwargs)

        self.db = db
        self.sync = sync
        self.api = api
        self.app = app_window

        self._selected_email_id = None
        self._current_filter = "inbox"   # inbox | unread | starred | archived
        self._search_term = ""
        self._emails = []

        self.grid_columnconfigure(0, weight=0, minsize=160)   # folder sidebar
        self.grid_columnconfigure(1, weight=1, minsize=300)   # email list
        self.grid_columnconfigure(2, weight=2, minsize=400)   # reading pane
        self.grid_rowconfigure(0, weight=1)

        self._build_folder_sidebar()
        self._build_email_list()
        self._build_reading_pane()

    # ------------------------------------------------------------------
    # Folder Sidebar (left)
    # ------------------------------------------------------------------
    def _build_folder_sidebar(self):
        sidebar = ctk.CTkFrame(self, fg_color=theme.BG_DARKER, corner_radius=0)
        sidebar.grid(row=0, column=0, sticky="nsew")
        sidebar.grid_rowconfigure(10, weight=1)

        # Title
        ctk.CTkLabel(
            sidebar, text="  MAILBOX", font=theme.font(10, "bold"),
            text_color=theme.TEXT_DIM, anchor="w",
        ).pack(fill="x", padx=12, pady=(16, 8))

        # Compose button
        self._compose_btn = ctk.CTkButton(
            sidebar, text="  ✏️  Compose", font=theme.font(13, "bold"),
            fg_color=theme.GREEN_PRIMARY, hover_color="#3a7d5f",
            height=38, corner_radius=6,
            command=self._compose_new,
        )
        self._compose_btn.pack(fill="x", padx=10, pady=(4, 12))

        # Separator
        ctk.CTkFrame(sidebar, fg_color=theme.BG_CARD_HOVER, height=1).pack(fill="x", padx=8, pady=(0, 8))

        # Folder buttons
        self._folder_buttons = {}
        folders = [
            ("inbox",    "📥", "Inbox"),
            ("unread",   "🔵", "Unread"),
            ("starred",  "⭐", "Starred"),
            ("archived", "📦", "Archived"),
        ]
        for key, icon, label in folders:
            btn = ctk.CTkButton(
                sidebar, text=f" {icon}  {label}", font=theme.font(13),
                fg_color="transparent", hover_color=theme.BG_CARD_HOVER,
                text_color=theme.TEXT_DIM, corner_radius=6,
                height=36, anchor="w",
                command=lambda k=key: self._switch_folder(k),
            )
            btn.pack(fill="x", padx=8, pady=1)
            self._folder_buttons[key] = btn

        # Unread badge (updated on refresh)
        self._unread_label = ctk.CTkLabel(
            sidebar, text="", font=theme.font(10),
            text_color=theme.TEXT_DIM,
        )
        self._unread_label.pack(fill="x", padx=12, pady=(16, 4))

        # Spacer
        ctk.CTkFrame(sidebar, fg_color="transparent").pack(fill="both", expand=True)

        # Fetch button
        self._fetch_btn = ctk.CTkButton(
            sidebar, text="↻  Check Mail", font=theme.font(12),
            fg_color=theme.GREEN_PRIMARY, hover_color="#3a7d5f",
            height=34, corner_radius=6,
            command=self._manual_fetch,
        )
        self._fetch_btn.pack(fill="x", padx=10, pady=(0, 8))

        # Status label
        self._status_label = ctk.CTkLabel(
            sidebar, text="", font=theme.font(9),
            text_color=theme.TEXT_DIM, wraplength=140,
        )
        self._status_label.pack(fill="x", padx=12, pady=(0, 12))

    def _switch_folder(self, key: str):
        self._current_filter = key
        self._selected_email_id = None
        for k, btn in self._folder_buttons.items():
            if k == key:
                btn.configure(fg_color=theme.GREEN_PRIMARY, text_color=theme.TEXT_LIGHT)
            else:
                btn.configure(fg_color="transparent", text_color=theme.TEXT_DIM)
        self._load_emails()
        self._clear_reading_pane()

    # ------------------------------------------------------------------
    # Email List (centre)
    # ------------------------------------------------------------------
    def _build_email_list(self):
        list_frame = ctk.CTkFrame(self, fg_color=theme.BG_CARD, corner_radius=0)
        list_frame.grid(row=0, column=1, sticky="nsew", padx=(1, 0))
        list_frame.grid_rowconfigure(1, weight=1)
        list_frame.grid_columnconfigure(0, weight=1)

        # Search bar
        search_bar = ctk.CTkFrame(list_frame, fg_color=theme.BG_DARKER, height=44)
        search_bar.grid(row=0, column=0, sticky="ew")
        search_bar.grid_columnconfigure(0, weight=1)

        self._search_entry = ctk.CTkEntry(
            search_bar, placeholder_text="Search emails...",
            font=theme.font(12), height=32,
            fg_color=theme.BG_CARD, border_color=theme.BG_CARD_HOVER,
        )
        self._search_entry.grid(row=0, column=0, padx=8, pady=6, sticky="ew")
        self._search_entry.bind("<Return>", lambda e: self._do_search())

        # Scrollable email list
        self._email_list = ctk.CTkScrollableFrame(
            list_frame, fg_color=theme.BG_CARD,
        )
        self._email_list.grid(row=1, column=0, sticky="nsew")
        self._email_list.grid_columnconfigure(0, weight=1)

        # Email count label
        self._count_label = ctk.CTkLabel(
            list_frame, text="", font=theme.font(10),
            text_color=theme.TEXT_DIM, height=24,
        )
        self._count_label.grid(row=2, column=0, sticky="ew", padx=8)

    def _do_search(self):
        self._search_term = self._search_entry.get().strip()
        self._load_emails()

    def _load_emails(self):
        """Load emails from DB based on current filter."""
        for widget in self._email_list.winfo_children():
            widget.destroy()

        kwargs = {"limit": 200, "search": self._search_term}

        if self._current_filter == "inbox":
            kwargs["folder"] = "INBOX"
        elif self._current_filter == "unread":
            kwargs["unread_only"] = True
        elif self._current_filter == "starred":
            kwargs["starred"] = True
        elif self._current_filter == "archived":
            kwargs["archived"] = True

        self._emails = self.db.get_inbox_emails(**kwargs)

        if not self._emails:
            msg = "No emails" if not self._search_term else "No matching emails"
            ctk.CTkLabel(
                self._email_list, text=msg,
                font=theme.font(13), text_color=theme.TEXT_DIM,
            ).pack(pady=40)
            self._count_label.configure(text="")
            return

        for em in self._emails:
            self._create_email_row(em)

        # Update count
        total = len(self._emails)
        unread = sum(1 for e in self._emails if not e.get("is_read"))
        text = f"{total} email{'s' if total != 1 else ''}"
        if unread:
            text += f"  ({unread} unread)"
        self._count_label.configure(text=text)

    def _create_email_row(self, em: dict):
        """Create a clickable email row in the list."""
        is_read = em.get("is_read", 0)
        is_starred = em.get("is_starred", 0)
        email_id = em.get("id")

        row = ctk.CTkFrame(
            self._email_list,
            fg_color=theme.BG_CARD if is_read else theme.BG_CARD_HOVER,
            corner_radius=4, height=64, cursor="hand2",
        )
        row.pack(fill="x", padx=4, pady=1)
        row.pack_propagate(False)
        row.grid_columnconfigure(1, weight=1)

        # Unread indicator
        indicator_colour = theme.GREEN_LIGHT if not is_read else "transparent"
        ctk.CTkFrame(
            row, width=4, fg_color=indicator_colour, corner_radius=2,
        ).grid(row=0, column=0, rowspan=2, sticky="ns", padx=(4, 6), pady=6)

        # From + date row
        from_name = em.get("from_name") or em.get("from_email", "Unknown")
        font_weight = "bold" if not is_read else "normal"

        top_row = ctk.CTkFrame(row, fg_color="transparent")
        top_row.grid(row=0, column=1, sticky="ew", padx=(0, 8), pady=(6, 0))
        top_row.grid_columnconfigure(0, weight=1)

        from_label = ctk.CTkLabel(
            top_row, text=from_name[:35],
            font=theme.font(12, font_weight),
            text_color=theme.TEXT_LIGHT if not is_read else theme.TEXT_DIM,
            anchor="w",
        )
        from_label.grid(row=0, column=0, sticky="w")

        # Star indicator
        star = "⭐" if is_starred else ""
        # Attachment indicator
        attach = "📎" if em.get("has_attachments") else ""
        # Client match
        client = ""
        if em.get("client_name"):
            client = f"👤"
        indicators = f"{star}{attach}{client}"
        if indicators:
            ctk.CTkLabel(
                top_row, text=indicators, font=theme.font(11),
                anchor="e",
            ).grid(row=0, column=1, sticky="e", padx=(4, 0))

        # Date
        date_str = self._format_date(em.get("date_received", ""))
        ctk.CTkLabel(
            top_row, text=date_str, font=theme.font(10),
            text_color=theme.TEXT_DIM, anchor="e",
        ).grid(row=0, column=2, sticky="e", padx=(8, 0))

        # Subject line
        subject = em.get("subject", "(no subject)")[:60]
        replied = "↩ " if em.get("is_replied") else ""
        ctk.CTkLabel(
            row, text=f"{replied}{subject}",
            font=theme.font(11),
            text_color=theme.TEXT_LIGHT if not is_read else theme.TEXT_DIM,
            anchor="w",
        ).grid(row=1, column=1, sticky="ew", padx=(0, 8), pady=(0, 6))

        # Click handler — bind to all widgets in row
        def on_click(e, eid=email_id):
            self._select_email(eid)

        row.bind("<Button-1>", on_click)
        for child in row.winfo_children():
            child.bind("<Button-1>", on_click)
            for grandchild in child.winfo_children():
                grandchild.bind("<Button-1>", on_click)

    def _format_date(self, iso_str: str) -> str:
        """Format a date string for display in the email list."""
        if not iso_str:
            return ""
        try:
            dt = datetime.fromisoformat(iso_str.replace("Z", "+00:00"))
            now = datetime.now(dt.tzinfo) if dt.tzinfo else datetime.now()
            if dt.date() == now.date():
                return dt.strftime("%H:%M")
            elif (now - dt).days < 7:
                return dt.strftime("%a %H:%M")
            elif dt.year == now.year:
                return dt.strftime("%d %b")
            else:
                return dt.strftime("%d/%m/%y")
        except Exception:
            return iso_str[:10]

    # ------------------------------------------------------------------
    # Reading Pane (right)
    # ------------------------------------------------------------------
    def _build_reading_pane(self):
        self._pane = ctk.CTkFrame(self, fg_color=theme.BG_DARK, corner_radius=0)
        self._pane.grid(row=0, column=2, sticky="nsew", padx=(1, 0))
        self._pane.grid_rowconfigure(1, weight=1)
        self._pane.grid_columnconfigure(0, weight=1)

        # Action bar
        self._action_bar = ctk.CTkFrame(self._pane, fg_color=theme.BG_DARKER, height=44)
        self._action_bar.grid(row=0, column=0, sticky="ew")
        self._action_bar.grid_columnconfigure(10, weight=1)

        actions = [
            ("↩ Reply",    self._reply_email),
            ("⭐ Star",     self._toggle_star),
            ("📦 Archive",  self._archive_email),
            ("🗑 Delete",   self._delete_email),
        ]
        for i, (text, cmd) in enumerate(actions):
            ctk.CTkButton(
                self._action_bar, text=text, font=theme.font(11),
                fg_color="transparent", hover_color=theme.BG_CARD_HOVER,
                text_color=theme.TEXT_DIM, height=32, width=80,
                corner_radius=4, command=cmd,
            ).grid(row=0, column=i, padx=2, pady=6)

        # Reading content area
        self._reading_scroll = ctk.CTkScrollableFrame(
            self._pane, fg_color=theme.BG_DARK,
        )
        self._reading_scroll.grid(row=1, column=0, sticky="nsew")
        self._reading_scroll.grid_columnconfigure(0, weight=1)

        self._clear_reading_pane()

    def _clear_reading_pane(self):
        """Show empty state in reading pane."""
        for widget in self._reading_scroll.winfo_children():
            widget.destroy()

        ctk.CTkLabel(
            self._reading_scroll,
            text="📧\n\nSelect an email to read",
            font=theme.font(14), text_color=theme.TEXT_DIM,
            justify="center",
        ).pack(expand=True, pady=80)

    def _select_email(self, email_id: int):
        """Load and display an email in the reading pane."""
        em = self.db.get_inbox_email_by_id(email_id)
        if not em:
            return

        self._selected_email_id = email_id

        # Mark as read
        if not em.get("is_read"):
            self.db.mark_inbox_read(email_id)
            em["is_read"] = 1
            # Refresh list to update visual state
            self._load_emails()

        # Clear reading pane
        for widget in self._reading_scroll.winfo_children():
            widget.destroy()

        pane = self._reading_scroll

        # Header card
        header = ctk.CTkFrame(pane, fg_color=theme.BG_CARD, corner_radius=8)
        header.pack(fill="x", padx=12, pady=(12, 8))
        header.grid_columnconfigure(0, weight=1)

        # Subject
        subject = em.get("subject", "(no subject)")
        ctk.CTkLabel(
            header, text=subject, font=theme.font_bold(16),
            text_color=theme.TEXT_LIGHT, anchor="w", wraplength=500,
        ).pack(fill="x", padx=16, pady=(12, 4))

        # From line
        from_name = em.get("from_name", "")
        from_email = em.get("from_email", "")
        from_text = f"From: {from_name} <{from_email}>" if from_name else f"From: {from_email}"
        ctk.CTkLabel(
            header, text=from_text, font=theme.font(12),
            text_color=theme.TEXT_DIM, anchor="w",
        ).pack(fill="x", padx=16, pady=0)

        # To line
        to_email = em.get("to_email", config.IMAP_USER)
        ctk.CTkLabel(
            header, text=f"To: {to_email}", font=theme.font(11),
            text_color=theme.TEXT_DIM, anchor="w",
        ).pack(fill="x", padx=16, pady=0)

        # Date
        date_str = em.get("date_received", "")
        try:
            dt = datetime.fromisoformat(date_str.replace("Z", "+00:00"))
            date_display = dt.strftime("%A %d %B %Y at %H:%M")
        except Exception:
            date_display = date_str
        ctk.CTkLabel(
            header, text=date_display, font=theme.font(11),
            text_color=theme.TEXT_DIM, anchor="w",
        ).pack(fill="x", padx=16, pady=(0, 4))

        # Client match badge
        if em.get("client_name"):
            badge = ctk.CTkFrame(header, fg_color=theme.GREEN_PRIMARY, corner_radius=4)
            badge.pack(anchor="w", padx=16, pady=(2, 8))
            ctk.CTkLabel(
                badge, text=f"  👤 {em['client_name']}  ",
                font=theme.font(11, "bold"), text_color=theme.TEXT_LIGHT,
            ).pack()
        else:
            ctk.CTkFrame(header, fg_color="transparent", height=8).pack()

        # Attachments
        if em.get("has_attachments") and em.get("attachment_info"):
            try:
                attachments = json.loads(em["attachment_info"])
                if attachments:
                    att_frame = ctk.CTkFrame(pane, fg_color=theme.BG_CARD, corner_radius=6)
                    att_frame.pack(fill="x", padx=12, pady=(0, 8))

                    ctk.CTkLabel(
                        att_frame, text=f"  📎 {len(attachments)} attachment(s)",
                        font=theme.font(11, "bold"), text_color=theme.TEXT_LIGHT,
                        anchor="w",
                    ).pack(fill="x", padx=12, pady=(8, 4))

                    for att in attachments:
                        name = att.get("name", "unnamed")
                        size = att.get("size", 0)
                        size_str = f"{size / 1024:.1f} KB" if size < 1048576 else f"{size / 1048576:.1f} MB"
                        ctk.CTkLabel(
                            att_frame,
                            text=f"    {name}  ({size_str})",
                            font=theme.font(11), text_color=theme.TEXT_DIM,
                            anchor="w",
                        ).pack(fill="x", padx=12, pady=1)

                    ctk.CTkFrame(att_frame, fg_color="transparent", height=6).pack()
            except Exception:
                pass

        # Email body
        body_frame = ctk.CTkFrame(pane, fg_color=theme.BG_CARD, corner_radius=8)
        body_frame.pack(fill="x", padx=12, pady=(0, 12))

        body_text = em.get("body_text", "").strip()
        if not body_text:
            # Strip HTML tags for plain text fallback
            import re
            html = em.get("body_html", "")
            body_text = re.sub(r"<[^>]+>", " ", html)
            body_text = re.sub(r"\s+", " ", body_text).strip()

        if not body_text:
            body_text = "(empty email)"

        # Truncate for display (very long emails)
        display_text = body_text[:8000]
        if len(body_text) > 8000:
            display_text += "\n\n... (email truncated)"

        body_label = ctk.CTkLabel(
            body_frame, text=display_text,
            font=theme.font(12), text_color=theme.TEXT_LIGHT,
            anchor="nw", justify="left", wraplength=550,
        )
        body_label.pack(fill="x", padx=16, pady=16)

    # ------------------------------------------------------------------
    # Actions
    # ------------------------------------------------------------------
    def _compose_new(self):
        """Open compose dialog for a new email."""
        ComposeDialog(self, db=self.db, app_window=self.app)

    def _reply_email(self):
        """Open compose dialog pre-filled as reply."""
        if not self._selected_email_id:
            return
        em = self.db.get_inbox_email_by_id(self._selected_email_id)
        if not em:
            return

        ComposeDialog(self, db=self.db, app_window=self.app, reply_to_email=em)
        self.db.mark_inbox_replied(self._selected_email_id)

    def _toggle_star(self):
        if not self._selected_email_id:
            return
        em = self.db.get_inbox_email_by_id(self._selected_email_id)
        if not em:
            return
        new_state = not em.get("is_starred", 0)
        self.db.mark_inbox_starred(self._selected_email_id, new_state)
        self._load_emails()
        self._select_email(self._selected_email_id)

    def _archive_email(self):
        if not self._selected_email_id:
            return
        self.db.mark_inbox_archived(self._selected_email_id)
        self._selected_email_id = None
        self._clear_reading_pane()
        self._load_emails()
        if self.app and hasattr(self.app, "toast") and self.app.toast:
            self.app.toast.show("Email archived", "info")

    def _delete_email(self):
        if not self._selected_email_id:
            return
        self.db.delete_inbox_email(self._selected_email_id)
        self._selected_email_id = None
        self._clear_reading_pane()
        self._load_emails()
        if self.app and hasattr(self.app, "toast") and self.app.toast:
            self.app.toast.show("Email deleted", "info")

    def _manual_fetch(self):
        """Fetch new emails on button click."""
        self._fetch_btn.configure(text="Checking...", state="disabled")

        def do_fetch():
            inbox = getattr(self.app, "_email_inbox", None)
            count = 0
            if inbox:
                count = inbox.fetch_now()
            # Update UI on main thread
            self.after(0, lambda: self._on_fetch_done(count))

        threading.Thread(target=do_fetch, daemon=True).start()

    def _on_fetch_done(self, count: int):
        self._fetch_btn.configure(text="↻  Check Mail", state="normal")
        if count > 0:
            if self.app and hasattr(self.app, "toast") and self.app.toast:
                self.app.toast.show(f"{count} new email(s)", "success")
        self._load_emails()
        self._update_status()

    def _update_status(self):
        """Update sidebar status labels."""
        try:
            stats = self.db.get_inbox_stats()
            unread = stats.get("unread", 0)
            today = stats.get("today", 0)

            parts = []
            if unread:
                parts.append(f"{unread} unread")
            if today:
                parts.append(f"{today} today")
            self._unread_label.configure(text="  ".join(parts) if parts else "")

            inbox = getattr(self.app, "_email_inbox", None)
            if inbox and inbox._last_fetch:
                self._status_label.configure(
                    text=f"Last checked: {inbox._last_fetch.strftime('%H:%M')}"
                )
            elif not inbox or not inbox.is_configured:
                self._status_label.configure(
                    text="⚠ IMAP not configured\nSet IMAP_PASSWORD in .env"
                )
        except Exception:
            pass

    # ------------------------------------------------------------------
    # Refresh (called by app_window on tab switch / sync)
    # ------------------------------------------------------------------
    def refresh(self):
        """Called when tab is switched to or after sync."""
        self._switch_folder(self._current_filter)
        self._update_status()
