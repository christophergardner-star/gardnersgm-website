"""
PIN Lock Screen for GGM Hub.
6-digit PIN entry with masked dots, shown before the main app loads.
"""

import customtkinter as ctk
import hashlib
from . import theme


class PinScreen(ctk.CTk):
    """Full-screen PIN entry gate."""

    def __init__(self, db, on_success):
        super().__init__()

        self.db = db
        self.on_success = on_success
        self._pin = ""
        self._dot_labels = []
        self._is_setting_pin = False
        self._new_pin_first = ""  # first entry when setting a new PIN
        self._confirming = False

        # Check if a PIN exists
        stored_hash = self.db.get_setting("pin_hash")
        if not stored_hash:
            self._is_setting_pin = True

        # ── Window ──
        self.title("GGM Hub — Unlock")
        self.geometry("420x520")
        self.resizable(False, False)
        self.configure(fg_color=theme.BG_DARKER)

        # Center on screen
        self.update_idletasks()
        x = (self.winfo_screenwidth() - 420) // 2
        y = (self.winfo_screenheight() - 520) // 2
        self.geometry(f"+{x}+{y}")

        self._build_ui()

        # Capture keyboard input
        self.bind("<Key>", self._on_key)
        self.focus_force()

    def _build_ui(self):
        # ── Logo ──
        ctk.CTkLabel(
            self, text="🌿",
            font=ctk.CTkFont(size=48),
            text_color=theme.GREEN_LIGHT,
        ).pack(pady=(30, 4))

        ctk.CTkLabel(
            self, text="GGM Hub",
            font=ctk.CTkFont(family="Segoe UI", size=24, weight="bold"),
            text_color=theme.TEXT_LIGHT,
        ).pack(pady=(0, 4))

        # ── Instruction ──
        if self._is_setting_pin:
            instruction = "Set your 6-digit PIN"
        else:
            instruction = "Enter PIN to unlock"

        self._instruction_label = ctk.CTkLabel(
            self, text=instruction,
            font=ctk.CTkFont(family="Segoe UI", size=14),
            text_color=theme.TEXT_DIM,
        )
        self._instruction_label.pack(pady=(0, 20))

        # ── PIN dots ──
        dots_frame = ctk.CTkFrame(self, fg_color="transparent")
        dots_frame.pack(pady=(0, 24))

        for i in range(6):
            dot = ctk.CTkLabel(
                dots_frame,
                text="○",
                font=ctk.CTkFont(size=28),
                text_color=theme.TEXT_DIM,
                width=36,
            )
            dot.grid(row=0, column=i, padx=6)
            self._dot_labels.append(dot)

        # ── Status message ──
        self._status_label = ctk.CTkLabel(
            self, text="",
            font=ctk.CTkFont(family="Segoe UI", size=12),
            text_color=theme.RED,
            height=24,
        )
        self._status_label.pack(pady=(0, 12))

        # ── Numpad ──
        pad_frame = ctk.CTkFrame(self, fg_color="transparent")
        pad_frame.pack(pady=(0, 20))

        buttons = [
            ["1", "2", "3"],
            ["4", "5", "6"],
            ["7", "8", "9"],
            ["⌫", "0", "→"],
        ]

        for r, row in enumerate(buttons):
            for c, label in enumerate(row):
                if label == "⌫":
                    cmd = self._backspace
                    fg = theme.BG_CARD
                    hover = theme.RED
                    text_col = theme.AMBER
                elif label == "→":
                    cmd = self._submit
                    fg = theme.GREEN_PRIMARY
                    hover = theme.GREEN_DARK
                    text_col = "white"
                else:
                    cmd = lambda d=label: self._add_digit(d)
                    fg = theme.BG_CARD
                    hover = theme.BG_CARD_HOVER
                    text_col = theme.TEXT_LIGHT

                ctk.CTkButton(
                    pad_frame,
                    text=label,
                    width=80, height=56,
                    fg_color=fg,
                    hover_color=hover,
                    text_color=text_col,
                    font=ctk.CTkFont(family="Segoe UI", size=20, weight="bold"),
                    corner_radius=12,
                    command=cmd,
                ).grid(row=r, column=c, padx=6, pady=6)

    # ------------------------------------------------------------------
    # Input handling
    # ------------------------------------------------------------------
    def _on_key(self, event):
        """Handle keyboard input."""
        if event.char and event.char.isdigit():
            self._add_digit(event.char)
        elif event.keysym == "BackSpace":
            self._backspace()
        elif event.keysym == "Return":
            self._submit()

    def _add_digit(self, digit: str):
        if len(self._pin) >= 6:
            return
        self._pin += digit
        self._update_dots()
        self._status_label.configure(text="")

        # Auto-submit on 6 digits
        if len(self._pin) == 6:
            self.after(150, self._submit)

    def _backspace(self):
        if self._pin:
            self._pin = self._pin[:-1]
            self._update_dots()

    def _update_dots(self):
        for i, dot in enumerate(self._dot_labels):
            if i < len(self._pin):
                dot.configure(text="●", text_color=theme.GREEN_LIGHT)
            else:
                dot.configure(text="○", text_color=theme.TEXT_DIM)

    # ------------------------------------------------------------------
    # Submit / verify
    # ------------------------------------------------------------------
    def _submit(self):
        if len(self._pin) != 6:
            self._status_label.configure(text="Enter all 6 digits")
            return

        if self._is_setting_pin:
            self._handle_set_pin()
        else:
            self._handle_verify_pin()

    def _handle_set_pin(self):
        """Set a new PIN (requires double entry)."""
        if not self._confirming:
            # First entry — store and ask to confirm
            self._new_pin_first = self._pin
            self._confirming = True
            self._pin = ""
            self._update_dots()
            self._instruction_label.configure(text="Confirm your PIN")
            self._status_label.configure(text="", text_color=theme.TEXT_DIM)
        else:
            # Second entry — check match
            if self._pin == self._new_pin_first:
                # PINs match — save hash
                pin_hash = hashlib.sha256(self._pin.encode()).hexdigest()
                self.db.set_setting("pin_hash", pin_hash)
                self._unlock()
            else:
                # Mismatch — start over
                self._confirming = False
                self._new_pin_first = ""
                self._pin = ""
                self._update_dots()
                self._instruction_label.configure(text="Set your 6-digit PIN")
                self._status_label.configure(text="PINs didn't match — try again", text_color=theme.RED)

    def _handle_verify_pin(self):
        """Verify entered PIN against stored hash."""
        entered_hash = hashlib.sha256(self._pin.encode()).hexdigest()
        stored_hash = self.db.get_setting("pin_hash")

        if entered_hash == stored_hash:
            self._unlock()
        else:
            self._pin = ""
            self._update_dots()
            self._status_label.configure(text="Incorrect PIN", text_color=theme.RED)
            # Shake animation
            self._shake(0)

    def _shake(self, count):
        """Quick shake animation on wrong PIN."""
        if count >= 6:
            return
        offset = 8 if count % 2 == 0 else -8
        x = (self.winfo_screenwidth() - 420) // 2 + offset
        y = self.winfo_rooty()
        self.geometry(f"+{x}+{y}")
        self.after(50, lambda: self._shake(count + 1))

    def _unlock(self):
        """PIN verified — close lock screen and launch main app."""
        self.destroy()
        self.on_success()
