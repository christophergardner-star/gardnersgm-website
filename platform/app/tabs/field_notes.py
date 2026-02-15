"""
Field Notes Tab — Create and view field notes with GAS sync.
"""

import customtkinter as ctk
import threading
import json
from datetime import datetime
from pathlib import Path

from ..ui import theme
from .. import config

import logging
log = logging.getLogger("ggm.tabs.field_notes")

NOTE_CATEGORIES = ["General", "Job Note", "Client Feedback", "Issue", "Idea"]
NOTES_FILE = Path(config.DATA_DIR) / "field_notes.json"


class FieldNotesTab(ctk.CTkFrame):
    """Create and browse field notes with offline-first local + GAS sync."""

    def __init__(self, parent, db, sync, api, app_window, **kwargs):
        super().__init__(parent, fg_color=theme.BG_DARK, **kwargs)

        self.db = db
        self.sync = sync
        self.api = api
        self.app = app_window

        self.grid_columnconfigure(0, weight=1)
        self.grid_rowconfigure(1, weight=1)

        self._build_header()
        self._build_body()

    # ------------------------------------------------------------------
    # Layout
    # ------------------------------------------------------------------
    def _build_header(self):
        hdr = ctk.CTkFrame(self, fg_color=theme.BG_CARD, height=50, corner_radius=0)
        hdr.grid(row=0, column=0, sticky="ew")
        hdr.grid_columnconfigure(1, weight=1)

        ctk.CTkLabel(
            hdr, text="📝  Field Notes",
            font=theme.font_bold(16), text_color=theme.TEXT_LIGHT,
        ).grid(row=0, column=0, padx=16, pady=12, sticky="w")

        theme.create_outline_button(
            hdr, "↻  Refresh",
            command=self.refresh,
        ).grid(row=0, column=2, padx=16, pady=8, sticky="e")

    def _build_body(self):
        body = ctk.CTkFrame(self, fg_color=theme.BG_DARK)
        body.grid(row=1, column=0, sticky="nsew", padx=16, pady=(8, 16))
        body.grid_columnconfigure(0, weight=1)
        body.grid_rowconfigure(1, weight=1)

        # ── Compose panel ──
        compose = theme.create_card(body)
        compose.grid(row=0, column=0, sticky="ew", pady=(0, 8))

        ctk.CTkLabel(
            compose, text="✍️ New Note", font=theme.font_bold(13),
            text_color=theme.TEXT_LIGHT,
        ).pack(anchor="w", padx=12, pady=(10, 4))

        # Category + text input side by side
        input_row = ctk.CTkFrame(compose, fg_color="transparent")
        input_row.pack(fill="x", padx=12, pady=(0, 8))
        input_row.grid_columnconfigure(1, weight=1)

        # Category
        ctk.CTkLabel(
            input_row, text="Category:", font=theme.font(12),
            text_color=theme.TEXT_DIM,
        ).grid(row=0, column=0, padx=(0, 8), sticky="w")

        self._cat_var = ctk.StringVar(value="General")
        self._category = ctk.CTkOptionMenu(
            input_row, variable=self._cat_var,
            values=NOTE_CATEGORIES,
            fg_color=theme.BG_INPUT,
            button_color=theme.GREEN_PRIMARY,
            button_hover_color=theme.GREEN_DARK,
            font=theme.font(12),
            width=160,
        )
        self._category.grid(row=0, column=0, padx=(70, 8), sticky="w")

        # Save button
        theme.create_accent_button(
            input_row, "💾 Save Note",
            command=self._save_note,
        ).grid(row=0, column=2, padx=(8, 0), sticky="e")

        # Text area
        self._note_input = ctk.CTkTextbox(
            compose, height=80,
            fg_color=theme.BG_INPUT,
            text_color=theme.TEXT_LIGHT,
            font=theme.font(13),
            corner_radius=8,
        )
        self._note_input.pack(fill="x", padx=12, pady=(0, 12))

        # ── Notes list ──
        list_card = theme.create_card(body)
        list_card.grid(row=1, column=0, sticky="nsew")

        ctk.CTkLabel(
            list_card, text="📋 Recent Notes", font=theme.font_bold(13),
            text_color=theme.TEXT_LIGHT,
        ).pack(anchor="w", padx=12, pady=(10, 4))

        self._notes_scroll = ctk.CTkScrollableFrame(
            list_card, fg_color="transparent")
        self._notes_scroll.pack(fill="both", expand=True, padx=8, pady=(0, 8))

    # ------------------------------------------------------------------
    # Save
    # ------------------------------------------------------------------
    def _save_note(self):
        text = self._note_input.get("1.0", "end").strip()
        if not text:
            if self.app:
                self.app.show_toast("Note is empty", "warning")
            return

        note = {
            "text": text,
            "category": self._cat_var.get(),
            "timestamp": datetime.now().isoformat(),
            "date": datetime.now().strftime("%Y-%m-%d %H:%M"),
        }

        # 1. Save to local JSON (offline-first)
        self._save_local(note)

        # 2. Push to GAS
        def _push():
            try:
                self.api.post(action="save_field_note", data=note)
            except Exception as e:
                log.warning(f"Failed to push note to GAS: {e}")
            # Refresh from GAS
            self._load_from_gas()

        threading.Thread(target=_push, daemon=True).start()

        self._note_input.delete("1.0", "end")
        if self.app:
            self.app.show_toast(f"📝 Note saved ({note['category']})", "success")

    def _save_local(self, note):
        """Save note to local JSON file."""
        try:
            NOTES_FILE.parent.mkdir(parents=True, exist_ok=True)
            notes = []
            if NOTES_FILE.exists():
                try:
                    notes = json.loads(NOTES_FILE.read_text(encoding="utf-8"))
                except Exception:
                    pass
            notes.insert(0, note)
            notes = notes[:200]  # cap at 200 notes
            NOTES_FILE.write_text(json.dumps(notes, indent=2), encoding="utf-8")
        except Exception as e:
            log.error(f"Failed to save note locally: {e}")

    # ------------------------------------------------------------------
    # Load
    # ------------------------------------------------------------------
    def _load_from_gas(self):
        """Fetch notes from GAS (or fall back to local file)."""
        def _fetch():
            notes = []
            try:
                data = self.api.get(action="get_field_notes",
                                   params={"limit": "50"})
                notes = data.get("notes", []) if isinstance(data, dict) else []
            except Exception:
                # Fallback to local
                if NOTES_FILE.exists():
                    try:
                        notes = json.loads(NOTES_FILE.read_text(encoding="utf-8"))
                    except Exception:
                        pass
            self.after(0, lambda: self._render_notes(notes))
        threading.Thread(target=_fetch, daemon=True).start()

    def _render_notes(self, notes):
        """Render note cards."""
        for w in self._notes_scroll.winfo_children():
            w.destroy()

        if not notes:
            ctk.CTkLabel(
                self._notes_scroll, text="No notes yet — write one above!",
                font=theme.font(12), text_color=theme.TEXT_DIM,
            ).pack(pady=20)
            return

        cat_colours = {
            "General": theme.TEXT_LIGHT,
            "Job Note": theme.GREEN_LIGHT,
            "Client Feedback": theme.BLUE,
            "Issue": theme.RED,
            "Idea": theme.PURPLE,
        }

        for note in notes:
            card = ctk.CTkFrame(self._notes_scroll, fg_color=theme.BG_CARD,
                                corner_radius=8)
            card.pack(fill="x", pady=3, padx=4)

            top = ctk.CTkFrame(card, fg_color="transparent")
            top.pack(fill="x", padx=10, pady=(8, 0))
            top.grid_columnconfigure(1, weight=1)

            cat = note.get("category", "General")
            cat_col = cat_colours.get(cat, theme.TEXT_DIM)
            ctk.CTkLabel(
                top, text=cat, font=theme.font(11, "bold"),
                text_color=cat_col,
            ).grid(row=0, column=0, sticky="w")

            ts = note.get("date", note.get("timestamp", "")[:16])
            ctk.CTkLabel(
                top, text=ts, font=theme.font(10),
                text_color=theme.TEXT_DIM,
            ).grid(row=0, column=1, sticky="e")

            ctk.CTkLabel(
                card, text=note.get("text", ""),
                font=theme.font(12), text_color=theme.TEXT_LIGHT,
                wraplength=600, anchor="w", justify="left",
            ).pack(fill="x", padx=10, pady=(4, 8))

    # ------------------------------------------------------------------
    # Refresh (called by app_window on tab switch)
    # ------------------------------------------------------------------
    def refresh(self):
        self._load_from_gas()
