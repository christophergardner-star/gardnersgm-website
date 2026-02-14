"""
Cost Edit Modal — edit a single month's business costs.
"""

import customtkinter as ctk
from .. import theme
from ... import config


class CostModal(ctk.CTkToplevel):
    """Modal for editing a single month's business costs."""

    def __init__(self, parent, cost_data: dict, db, sync,
                 on_save=None, **kwargs):
        super().__init__(parent, **kwargs)

        self.cost_data = dict(cost_data)
        self.db = db
        self.sync = sync
        self.on_save = on_save
        self._fields = {}

        month = self.cost_data.get("month", "New Month")
        self.title(f"Costs: {month}")
        self.geometry("420x520")
        self.resizable(False, False)
        self.configure(fg_color=theme.BG_DARK)
        self.transient(parent)
        self.grab_set()

        self.update_idletasks()
        px = parent.winfo_rootx() + (parent.winfo_width() - 420) // 2
        py = parent.winfo_rooty() + (parent.winfo_height() - 520) // 2
        self.geometry(f"+{max(px,0)}+{max(py,0)}")

        self._build_ui()

    def _build_ui(self):
        container = ctk.CTkScrollableFrame(self, fg_color=theme.BG_DARK)
        container.pack(fill="both", expand=True)

        # Header
        header = ctk.CTkFrame(container, fg_color=theme.BG_CARD, corner_radius=12)
        header.pack(fill="x", padx=16, pady=(16, 8))
        h_inner = ctk.CTkFrame(header, fg_color="transparent")
        h_inner.pack(fill="x", padx=16, pady=12)

        ctk.CTkLabel(
            h_inner, text="💸",
            font=theme.font_bold(28), width=48,
        ).pack(side="left", padx=(0, 12))

        month = self.cost_data.get("month", "")
        total = sum(float(self.cost_data.get(f, 0) or 0) for f in config.COST_FIELDS)

        info = ctk.CTkFrame(h_inner, fg_color="transparent")
        info.pack(side="left", fill="x", expand=True)
        ctk.CTkLabel(
            info, text=f"Costs: {month}" if month else "New Cost Entry",
            font=theme.font_bold(16), text_color=theme.TEXT_LIGHT, anchor="w",
        ).pack(fill="x")

        ctk.CTkLabel(
            h_inner, text=f"£{total:,.2f}",
            font=theme.font_bold(20), text_color=theme.AMBER,
        ).pack(side="right", padx=8)

        # Form
        form = ctk.CTkFrame(container, fg_color=theme.BG_CARD, corner_radius=12)
        form.pack(fill="x", padx=16, pady=8)
        form.grid_columnconfigure(1, weight=1)

        # Month field
        ctk.CTkLabel(
            form, text="Month", font=theme.font(12),
            text_color=theme.TEXT_DIM, anchor="e",
        ).grid(row=0, column=0, padx=(16, 8), pady=4, sticky="e")

        month_entry = theme.create_entry(form, width=200)
        month_entry.insert(0, str(self.cost_data.get("month", "") or ""))
        month_entry.grid(row=0, column=1, padx=(0, 16), pady=4, sticky="ew")
        self._fields["month"] = month_entry

        # Cost fields
        display_names = {
            "fuel": "Fuel", "insurance": "Insurance", "tools": "Tools",
            "vehicle": "Vehicle", "phone_cost": "Phone",
            "software": "Software", "marketing": "Marketing",
            "waste_disposal": "Waste Disposal",
            "treatment_products": "Treatment Products",
            "consumables": "Consumables",
            "other": "Other",
        }

        for i, field in enumerate(config.COST_FIELDS):
            label = display_names.get(field, field.title())
            ctk.CTkLabel(
                form, text=f"{label} (£)",
                font=theme.font(12), text_color=theme.TEXT_DIM, anchor="e",
            ).grid(row=i + 1, column=0, padx=(16, 8), pady=4, sticky="e")

            entry = theme.create_entry(form, width=200)
            val = self.cost_data.get(field, 0) or 0
            entry.insert(0, str(float(val)) if val else "0")
            entry.grid(row=i + 1, column=1, padx=(0, 16), pady=4, sticky="ew")
            self._fields[field] = entry

        # Notes
        ctk.CTkLabel(
            form, text="Notes", font=theme.font(12),
            text_color=theme.TEXT_DIM, anchor="e",
        ).grid(row=len(config.COST_FIELDS) + 1, column=0, padx=(16, 8), pady=4, sticky="ne")

        self.notes_box = ctk.CTkTextbox(
            form, height=50, fg_color=theme.BG_INPUT,
            corner_radius=8, font=theme.font(12),
        )
        self.notes_box.grid(row=len(config.COST_FIELDS) + 1, column=1,
                            padx=(0, 16), pady=4, sticky="ew")
        self.notes_box.insert("1.0", self.cost_data.get("notes", "") or "")

        # Actions
        actions = ctk.CTkFrame(container, fg_color="transparent")
        actions.pack(fill="x", padx=16, pady=(8, 16))

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
        self.cost_data["month"] = self._fields["month"].get().strip()
        self.cost_data["notes"] = self.notes_box.get("1.0", "end").strip()

        total = 0
        for field in config.COST_FIELDS:
            try:
                val = float(self._fields[field].get().strip() or 0)
            except (ValueError, TypeError):
                val = 0
            self.cost_data[field] = val
            total += val

        # Map phone_cost field
        if "phone_cost" in self.cost_data and "phone" not in self.cost_data:
            self.cost_data["phone"] = self.cost_data["phone_cost"]

        self.cost_data["total"] = total

        self.db.save_business_cost(self.cost_data)

        self.sync.queue_write("update_business_cost", {
            "row": self.cost_data.get("sheets_row", ""),
            "month": self.cost_data.get("month", ""),
            "fuel": self.cost_data.get("fuel", 0),
            "insurance": self.cost_data.get("insurance", 0),
            "tools": self.cost_data.get("tools", 0),
            "vehicle": self.cost_data.get("vehicle", 0),
            "phone": self.cost_data.get("phone_cost", 0),
            "software": self.cost_data.get("software", 0),
            "marketing": self.cost_data.get("marketing", 0),
            "wasteDisposal": self.cost_data.get("waste_disposal", 0),
            "treatmentProducts": self.cost_data.get("treatment_products", 0),
            "consumables": self.cost_data.get("consumables", 0),
            "other": self.cost_data.get("other", 0),
            "total": total,
            "notes": self.cost_data.get("notes", ""),
        })

        if self.on_save:
            self.on_save()
        self.destroy()
