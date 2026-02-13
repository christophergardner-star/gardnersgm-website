"""
Savings Pot Edit Modal — edit a savings pot balance/target.
"""

import customtkinter as ctk
from .. import theme


class PotModal(ctk.CTkToplevel):
    """Modal for editing a savings pot."""

    def __init__(self, parent, pot_data: dict, db, sync,
                 on_save=None, **kwargs):
        super().__init__(parent, **kwargs)

        self.pot_data = dict(pot_data)
        self.db = db
        self.sync = sync
        self.on_save = on_save
        self._fields = {}

        name = self.pot_data.get("name", "New Pot")
        self.title(f"Savings Pot: {name}")
        self.geometry("400x340")
        self.resizable(False, False)
        self.configure(fg_color=theme.BG_DARK)
        self.transient(parent)
        self.grab_set()

        self.update_idletasks()
        px = parent.winfo_rootx() + (parent.winfo_width() - 400) // 2
        py = parent.winfo_rooty() + (parent.winfo_height() - 340) // 2
        self.geometry(f"+{max(px,0)}+{max(py,0)}")

        self._build_ui()

    def _build_ui(self):
        container = ctk.CTkFrame(self, fg_color=theme.BG_DARK)
        container.pack(fill="both", expand=True)

        # Header
        header = ctk.CTkFrame(container, fg_color=theme.BG_CARD, corner_radius=12)
        header.pack(fill="x", padx=16, pady=(16, 8))
        h_inner = ctk.CTkFrame(header, fg_color="transparent")
        h_inner.pack(fill="x", padx=16, pady=12)

        name = self.pot_data.get("name", "")
        balance = float(self.pot_data.get("balance", 0) or 0)

        ctk.CTkLabel(
            h_inner, text="🏦",
            font=theme.font_bold(28), width=48,
        ).pack(side="left", padx=(0, 12))

        ctk.CTkLabel(
            h_inner, text=name or "New Pot",
            font=theme.font_bold(16), text_color=theme.TEXT_LIGHT,
        ).pack(side="left")

        ctk.CTkLabel(
            h_inner, text=f"£{balance:,.2f}",
            font=theme.font_bold(20), text_color=theme.GREEN_LIGHT,
        ).pack(side="right", padx=8)

        # Form
        form = ctk.CTkFrame(container, fg_color=theme.BG_CARD, corner_radius=12)
        form.pack(fill="x", padx=16, pady=8)
        form.grid_columnconfigure(1, weight=1)

        fields = [
            ("name",    "Pot Name"),
            ("balance", "Balance (£)"),
            ("target",  "Target (£)"),
        ]

        for i, (key, label) in enumerate(fields):
            ctk.CTkLabel(
                form, text=label,
                font=theme.font(12), text_color=theme.TEXT_DIM, anchor="e",
            ).grid(row=i, column=0, padx=(16, 8), pady=6, sticky="e")

            entry = theme.create_entry(form, width=200)
            val = self.pot_data.get(key, "")
            entry.insert(0, str(val) if val else "")
            entry.grid(row=i, column=1, padx=(0, 16), pady=6, sticky="ew")
            self._fields[key] = entry

        # Actions
        actions = ctk.CTkFrame(container, fg_color="transparent")
        actions.pack(fill="x", padx=16, pady=(12, 16))

        theme.create_accent_button(
            actions, "💾 Save", command=self._save, width=120,
        ).pack(side="left", padx=(0, 8))

        ctk.CTkButton(
            actions, text="Cancel", width=80,
            fg_color=theme.BG_CARD, hover_color=theme.RED,
            corner_radius=8, font=theme.font(12),
            command=self.destroy,
        ).pack(side="right")

    def _save(self):
        self.pot_data["name"] = self._fields["name"].get().strip()

        for nk in ("balance", "target"):
            try:
                self.pot_data[nk] = float(self._fields[nk].get().strip() or 0)
            except (ValueError, TypeError):
                self.pot_data[nk] = 0

        self.db.save_savings_pot(self.pot_data)

        self.sync.queue_write("update_savings_pot", {
            "name": self.pot_data.get("name", ""),
            "balance": self.pot_data.get("balance", 0),
            "target": self.pot_data.get("target", 0),
        })

        if self.on_save:
            self.on_save()
        self.destroy()
