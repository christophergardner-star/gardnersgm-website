"""
KPI Card — a stat display widget with icon, value, label, and optional trend.
"""

import customtkinter as ctk
from .. import theme


class KPICard(ctk.CTkFrame):
    """
    A card displaying a single KPI metric.

    ┌─────────────────┐
    │  📊  £1,920     │
    │  Monthly Revenue│
    └─────────────────┘
    """

    def __init__(self, parent, icon: str = "📊", value: str = "0",
                 label: str = "Metric", color: str = None, **kwargs):
        super().__init__(
            parent,
            fg_color=theme.BG_CARD,
            corner_radius=12,
            **kwargs,
        )

        self._icon = icon
        self._color = color or theme.GREEN_LIGHT

        # Layout
        self.grid_columnconfigure(0, weight=1)

        # Icon + Value row
        value_frame = ctk.CTkFrame(self, fg_color="transparent")
        value_frame.grid(row=0, column=0, padx=16, pady=(14, 2), sticky="w")

        self.icon_label = ctk.CTkLabel(
            value_frame,
            text=icon,
            font=theme.font(20),
        )
        self.icon_label.pack(side="left", padx=(0, 8))

        self.value_label = ctk.CTkLabel(
            value_frame,
            text=value,
            font=theme.font_bold(22),
            text_color=self._color,
        )
        self.value_label.pack(side="left")

        # Label
        self.name_label = ctk.CTkLabel(
            self,
            text=label,
            font=theme.font(12),
            text_color=theme.TEXT_DIM,
            anchor="w",
        )
        self.name_label.grid(row=1, column=0, padx=16, pady=(0, 14), sticky="w")

    def set_value(self, value: str):
        """Update the displayed value."""
        self.value_label.configure(text=value)

    def set_label(self, label: str):
        self.name_label.configure(text=label)

    def set_color(self, color: str):
        self.value_label.configure(text_color=color)
