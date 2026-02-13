"""
Telegram Tab — Send messages, view history, quick buttons.
Full Telegram management panel replacing the HTML manager's send feature.
"""

import customtkinter as ctk
import threading
from datetime import datetime

from ..ui import theme
from ..ui.components.data_table import DataTable
from .. import config


class TelegramTab(ctk.CTkFrame):
    """Telegram messaging panel with compose, quick messages, and history."""

    def __init__(self, parent, db, sync, api, app_window, **kwargs):
        super().__init__(parent, fg_color=theme.BG_DARK, **kwargs)

        self.db = db
        self.sync = sync
        self.api = api
        self.app = app_window

        self._current_sub = None
        self._sub_buttons = {}
        self._sub_frames = {}

        self.grid_columnconfigure(0, weight=1)
        self.grid_rowconfigure(1, weight=1)

        self._build_sub_tabs()
        self._build_panels()
        self._switch_sub("compose")

    # ------------------------------------------------------------------
    # Sub-Tabs
    # ------------------------------------------------------------------
    def _build_sub_tabs(self):
        tab_bar = ctk.CTkFrame(self, fg_color=theme.BG_CARD, height=44, corner_radius=0)
        tab_bar.grid(row=0, column=0, sticky="ew")
        tab_bar.grid_columnconfigure(10, weight=1)

        tabs = [
            ("compose", "✍️ Compose"),
            ("quick",   "⚡ Quick Messages"),
            ("history", "📜 History"),
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
        if key == "history":
            self._load_history()

    def _build_panels(self):
        self._build_compose_panel()
        self._build_quick_panel()
        self._build_history_panel()

    # ------------------------------------------------------------------
    # Compose Panel
    # ------------------------------------------------------------------
    def _build_compose_panel(self):
        frame = ctk.CTkScrollableFrame(self, fg_color="transparent")
        self._sub_frames["compose"] = frame

        # Compose card
        card = ctk.CTkFrame(frame, fg_color=theme.BG_CARD, corner_radius=12)
        card.pack(fill="x", padx=16, pady=16)

        ctk.CTkLabel(
            card, text="📱 Send Telegram Message",
            font=theme.font_bold(16), text_color=theme.TEXT_LIGHT,
            anchor="w",
        ).pack(fill="x", padx=16, pady=(16, 8))

        ctk.CTkLabel(
            card, text="Messages are sent to your Telegram channel via the bot.",
            font=theme.font(12), text_color=theme.TEXT_DIM,
            anchor="w",
        ).pack(fill="x", padx=16, pady=(0, 12))

        # Message text area
        self._compose_text = ctk.CTkTextbox(
            card, height=200,
            fg_color=theme.BG_INPUT, font=theme.font(13),
            text_color=theme.TEXT_LIGHT, corner_radius=8,
        )
        self._compose_text.pack(fill="x", padx=16, pady=(0, 8))

        # Formatting hints
        ctk.CTkLabel(
            card,
            text="Markdown: *bold*  _italic_  `code`  [link](url)",
            font=theme.font(10), text_color=theme.TEXT_DIM,
            anchor="w",
        ).pack(fill="x", padx=16, pady=(0, 8))

        # Send button
        btn_row = ctk.CTkFrame(card, fg_color="transparent")
        btn_row.pack(fill="x", padx=16, pady=(0, 16))

        theme.create_accent_button(
            btn_row, "📤 Send Message",
            command=self._send_compose, width=160,
        ).pack(side="left", padx=(0, 8))

        ctk.CTkButton(
            btn_row, text="Clear", width=80, height=36,
            fg_color="transparent", hover_color=theme.BG_CARD_HOVER,
            border_width=1, border_color=theme.RED,
            text_color=theme.RED, corner_radius=8,
            font=theme.font(12),
            command=lambda: self._compose_text.delete("1.0", "end"),
        ).pack(side="left")

        self._send_status = ctk.CTkLabel(
            btn_row, text="", font=theme.font(12),
            text_color=theme.GREEN_LIGHT,
        )
        self._send_status.pack(side="left", padx=16)

        # Template insertion
        template_card = ctk.CTkFrame(frame, fg_color=theme.BG_CARD, corner_radius=12)
        template_card.pack(fill="x", padx=16, pady=(0, 16))

        ctk.CTkLabel(
            template_card, text="📋 Insert Template",
            font=theme.font_bold(14), text_color=theme.TEXT_LIGHT,
            anchor="w",
        ).pack(fill="x", padx=16, pady=(14, 8))

        template_btns = ctk.CTkFrame(template_card, fg_color="transparent")
        template_btns.pack(fill="x", padx=12, pady=(0, 12))

        templates = {
            "Morning Brief": "☀️ *Morning Briefing*\n\nToday's schedule:\n\n",
            "Job Update": "📋 *Job Update*\n\n👤 Client: \n🔧 Service: \n📍 Location: \n",
            "End of Day": "📊 *End of Day Report*\n\n📋 Jobs completed: \n💰 Revenue: \n",
            "Weather Alert": "🌧️ *Weather Update*\n\nDue to weather conditions...",
        }

        for name, tmpl in templates.items():
            theme.create_outline_button(
                template_btns, name,
                command=lambda t=tmpl: self._insert_template(t),
                width=140,
            ).pack(side="left", padx=4, pady=4)

    def _insert_template(self, template: str):
        self._compose_text.delete("1.0", "end")
        self._compose_text.insert("1.0", template)

    def _send_compose(self):
        message = self._compose_text.get("1.0", "end").strip()
        if not message:
            self.app.show_toast("Write a message first", "warning")
            return

        self._send_status.configure(text="Sending...", text_color=theme.AMBER)

        def send():
            success = self.api.send_telegram(message)
            self.after(0, lambda: self._on_sent(success, message))

        threading.Thread(target=send, daemon=True).start()

    def _on_sent(self, success: bool, message: str):
        if success:
            self.db.log_telegram(message, "sent")
            self._send_status.configure(text="✅ Sent!", text_color=theme.GREEN_LIGHT)
            self._compose_text.delete("1.0", "end")
            self.app.show_toast("Message sent to Telegram", "success")
        else:
            self.db.log_telegram(message, "failed")
            self._send_status.configure(text="❌ Failed", text_color=theme.RED)
            self.app.show_toast("Failed to send message", "error")

    # ------------------------------------------------------------------
    # Quick Messages Panel
    # ------------------------------------------------------------------
    def _build_quick_panel(self):
        frame = ctk.CTkScrollableFrame(self, fg_color="transparent")
        self._sub_frames["quick"] = frame

        ctk.CTkLabel(
            frame, text="⚡ Quick Messages",
            font=theme.font_bold(16), text_color=theme.TEXT_LIGHT,
            anchor="w",
        ).pack(fill="x", padx=16, pady=(16, 4))

        ctk.CTkLabel(
            frame, text="One-tap messages for common situations",
            font=theme.font(12), text_color=theme.TEXT_DIM,
            anchor="w",
        ).pack(fill="x", padx=16, pady=(0, 12))

        for label, message in config.TELEGRAM_QUICK_MESSAGES.items():
            card = ctk.CTkFrame(frame, fg_color=theme.BG_CARD, corner_radius=10)
            card.pack(fill="x", padx=16, pady=4)
            card.grid_columnconfigure(1, weight=1)

            ctk.CTkLabel(
                card, text=label,
                font=theme.font_bold(14), text_color=theme.TEXT_LIGHT,
                anchor="w",
            ).grid(row=0, column=0, padx=16, pady=(12, 2), sticky="w")

            ctk.CTkLabel(
                card, text=message,
                font=theme.font(11), text_color=theme.TEXT_DIM,
                anchor="w", wraplength=500,
            ).grid(row=1, column=0, columnspan=2, padx=16, pady=(0, 12), sticky="w")

            theme.create_accent_button(
                card, "Send",
                command=lambda m=message, l=label: self._send_quick(m, l),
                width=80,
            ).grid(row=0, column=2, padx=16, pady=12)

    def _send_quick(self, message: str, label: str):
        def send():
            success = self.api.send_telegram(message)
            if success:
                self.db.log_telegram(message, "sent")
                self.after(0, lambda: self.app.show_toast(f"Sent: {label}", "success"))
            else:
                self.db.log_telegram(message, "failed")
                self.after(0, lambda: self.app.show_toast(f"Failed: {label}", "error"))

        threading.Thread(target=send, daemon=True).start()

    # ------------------------------------------------------------------
    # History Panel
    # ------------------------------------------------------------------
    def _build_history_panel(self):
        frame = ctk.CTkFrame(self, fg_color="transparent")
        self._sub_frames["history"] = frame

        frame.grid_columnconfigure(0, weight=1)
        frame.grid_rowconfigure(1, weight=1)

        header = ctk.CTkFrame(frame, fg_color="transparent")
        header.grid(row=0, column=0, sticky="ew", padx=12, pady=(12, 4))

        ctk.CTkLabel(
            header, text="📜 Message History",
            font=theme.font_bold(15), text_color=theme.TEXT_LIGHT,
            anchor="w",
        ).pack(side="left")

        columns = [
            {"key": "sent_at",  "label": "Date/Time",  "width": 160},
            {"key": "message",  "label": "Message",     "width": 500},
            {"key": "status",   "label": "Status",      "width": 80},
        ]

        self.history_table = DataTable(
            frame, columns=columns,
            on_double_click=self._view_history_message,
        )
        self.history_table.grid(row=1, column=0, sticky="nsew", padx=12, pady=(4, 12))

    def _load_history(self):
        logs = self.db.get_telegram_log(limit=100)
        rows = []
        for log in logs:
            msg = log.get("message", "")
            # Truncate for display
            if len(msg) > 80:
                msg = msg[:77] + "..."
            rows.append({
                "sent_at": log.get("sent_at", "")[:19].replace("T", " "),
                "message": msg.replace("\n", " "),
                "status": log.get("status", ""),
            })
        self.history_table.set_data(rows)

    # ------------------------------------------------------------------
    # Refresh
    # ------------------------------------------------------------------
    def refresh(self):
        if self._current_sub == "history":
            self._load_history()

    def _view_history_message(self, values: dict):
        """Double-click a telegram history row — show full message in a popup."""
        import customtkinter as ctk
        from ..ui import theme

        msg_text = values.get("message", "")
        sent_at = values.get("sent_at", "")

        # Fetch full message from DB log
        logs = self.db.get_telegram_log(limit=200)
        full_msg = msg_text
        for log in logs:
            ts = log.get("sent_at", "")[:19].replace("T", " ")
            if ts == sent_at:
                full_msg = log.get("message", msg_text)
                break

        popup = ctk.CTkToplevel(self)
        popup.title(f"Telegram Message — {sent_at}")
        popup.geometry("500x350")
        popup.configure(fg_color=theme.BG_DARK)
        popup.transient(self)
        popup.grab_set()

        self.update_idletasks()
        px = self.winfo_rootx() + 100
        py = self.winfo_rooty() + 80
        popup.geometry(f"+{max(px,0)}+{max(py,0)}")

        ctk.CTkLabel(
            popup, text=f"📨 Sent: {sent_at}",
            font=theme.font_bold(13), text_color=theme.TEXT_LIGHT,
        ).pack(padx=16, pady=(16, 8), anchor="w")

        textbox = ctk.CTkTextbox(
            popup, fg_color=theme.BG_INPUT, corner_radius=8, font=theme.font(12),
        )
        textbox.pack(fill="both", expand=True, padx=16, pady=(0, 8))
        textbox.insert("1.0", full_msg)
        textbox.configure(state="disabled")

        btn_row = ctk.CTkFrame(popup, fg_color="transparent")
        btn_row.pack(fill="x", padx=16, pady=(0, 12))

        ctk.CTkButton(
            btn_row, text="📋 Copy", width=90,
            fg_color=theme.GREEN_PRIMARY, hover_color=theme.GREEN_DARK,
            corner_radius=8, font=theme.font(12),
            command=lambda: (self.clipboard_clear(), self.clipboard_append(full_msg),
                            popup.title("Copied!")),
        ).pack(side="left", padx=(0, 8))

        ctk.CTkButton(
            btn_row, text="Close", width=80,
            fg_color=theme.BG_CARD, hover_color=theme.RED,
            corner_radius=8, font=theme.font(12),
            command=popup.destroy,
        ).pack(side="right")
