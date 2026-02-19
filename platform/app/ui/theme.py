"""
CustomTkinter theme for GGM Hub.
Green colour scheme matching the Gardners website.
"""

import customtkinter as ctk

# ──────────────────────────────────────────────────────────────────
# Colour Palette
# ──────────────────────────────────────────────────────────────────
# Primary greens (from website CSS)
GREEN_PRIMARY = "#2d6a4f"
GREEN_DARK    = "#1b4332"
GREEN_LIGHT   = "#52b788"
GREEN_ACCENT  = "#40916c"
GREEN_PALE    = "#d8f3dc"

# Neutrals
BG_DARK       = "#1a1a2e"
BG_DARKER     = "#16162a"
BG_SIDEBAR    = "#0f0f23"
BG_CARD       = "#222240"
BG_CARD_HOVER = "#2a2a4a"
BG_INPUT      = "#2d2d50"

BG_LIGHT      = "#f8f9fa"
BG_LIGHT_CARD = "#ffffff"
BG_LIGHT_SB   = "#e9ecef"

TEXT_LIGHT     = "#e8e8e8"
TEXT_DIM       = "#aaaacc"
TEXT_DARK      = "#1a1a2e"
TEXT_DARK_DIM  = "#666688"

# Status colours
RED            = "#e74c3c"
AMBER          = "#f39c12"
BLUE           = "#3498db"
PURPLE         = "#9b59b6"

# ──────────────────────────────────────────────────────────────────
# Configure CustomTkinter
# ──────────────────────────────────────────────────────────────────

def apply_theme():
    """Apply the Gardners dark theme globally."""
    ctk.set_appearance_mode("dark")
    ctk.set_default_color_theme("green")


# ──────────────────────────────────────────────────────────────────
# Font helpers
# ──────────────────────────────────────────────────────────────────

def font(size: int = 13, weight: str = "normal") -> ctk.CTkFont:
    return ctk.CTkFont(family="Segoe UI", size=size, weight=weight)

def font_bold(size: int = 13) -> ctk.CTkFont:
    return ctk.CTkFont(family="Segoe UI", size=size, weight="bold")

def font_heading() -> ctk.CTkFont:
    return ctk.CTkFont(family="Segoe UI", size=20, weight="bold")

def font_subheading() -> ctk.CTkFont:
    return ctk.CTkFont(family="Segoe UI", size=15, weight="bold")

def font_small() -> ctk.CTkFont:
    return ctk.CTkFont(family="Segoe UI", size=11)

def font_mono(size: int = 12) -> ctk.CTkFont:
    return ctk.CTkFont(family="Consolas", size=size)


# ──────────────────────────────────────────────────────────────────
# Styled widget factories
# ──────────────────────────────────────────────────────────────────

def create_card(parent, **kwargs) -> ctk.CTkFrame:
    """Create a card-style frame with rounded corners."""
    return ctk.CTkFrame(
        parent,
        fg_color=BG_CARD,
        corner_radius=12,
        **kwargs
    )

def create_sidebar_button(parent, text: str, icon: str = "",
                           command=None, **kwargs) -> ctk.CTkButton:
    """Create a sidebar navigation button."""
    display = f"  {icon}  {text}" if icon else f"  {text}"
    return ctk.CTkButton(
        parent,
        text=display,
        anchor="w",
        height=42,
        corner_radius=8,
        fg_color="transparent",
        hover_color=BG_CARD,
        text_color=TEXT_DIM,
        font=font(14),
        command=command,
        **kwargs
    )

def create_accent_button(parent, text: str, command=None, **kwargs) -> ctk.CTkButton:
    """Create a green accent button."""
    return ctk.CTkButton(
        parent,
        text=text,
        fg_color=GREEN_PRIMARY,
        hover_color=GREEN_DARK,
        corner_radius=8,
        height=36,
        font=font(13, "bold"),
        command=command,
        **kwargs
    )

def create_outline_button(parent, text: str, command=None, **kwargs) -> ctk.CTkButton:
    """Create an outline-style button."""
    return ctk.CTkButton(
        parent,
        text=text,
        fg_color="transparent",
        hover_color=BG_CARD,
        border_width=1,
        border_color=GREEN_PRIMARY,
        text_color=GREEN_LIGHT,
        corner_radius=8,
        height=34,
        font=font(12),
        command=command,
        **kwargs
    )

def create_entry(parent, placeholder: str = "", **kwargs) -> ctk.CTkEntry:
    """Create a styled text entry."""
    return ctk.CTkEntry(
        parent,
        placeholder_text=placeholder,
        fg_color=BG_INPUT,
        border_color=GREEN_ACCENT,
        corner_radius=8,
        height=36,
        font=font(13),
        **kwargs
    )

def create_status_badge(parent, status: str) -> ctk.CTkLabel:
    """Create a coloured status badge label."""
    colour_map = {
        "Complete": GREEN_PRIMARY,
        "Completed": GREEN_PRIMARY,
        "Confirmed": GREEN_LIGHT,
        "In Progress": BLUE,
        "Pending": AMBER,
        "Cancelled": RED,
        "No-Show": PURPLE,
        "Paid": GREEN_PRIMARY,
        "Unpaid": RED,
        "Overdue": RED,
        "Void": TEXT_DIM,
        "Deposit": AMBER,
        "Draft": TEXT_DIM,
        "Sent": BLUE,
        "Accepted": GREEN_PRIMARY,
        "Declined": RED,
        "New": AMBER,
        "Replied": GREEN_PRIMARY,
        "Yes": GREEN_PRIMARY,
        "No": RED,
        "Refunded": PURPLE,
    }
    bg = colour_map.get(status, TEXT_DIM)

    return ctk.CTkLabel(
        parent,
        text=f"  {status}  ",
        fg_color=bg,
        text_color="white",
        corner_radius=6,
        height=24,
        font=font(11, "bold"),
    )
