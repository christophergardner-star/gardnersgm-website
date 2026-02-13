"""
Toast notification system — non-intrusive popup messages.
"""

import customtkinter as ctk
from .. import theme


class ToastManager:
    """Manages toast notifications anchored to the bottom-right of the window."""

    def __init__(self, parent: ctk.CTk):
        self.parent = parent
        self._toasts: list[ctk.CTkFrame] = []

    def show(self, message: str, level: str = "info", duration: int = 3000):
        """
        Show a toast notification.
        level: 'info', 'success', 'warning', 'error'
        """
        colors = {
            "info": theme.BLUE,
            "success": theme.GREEN_PRIMARY,
            "warning": theme.AMBER,
            "error": theme.RED,
        }
        icons = {
            "info": "ℹ️",
            "success": "✅",
            "warning": "⚠️",
            "error": "❌",
        }

        bg = colors.get(level, theme.BLUE)
        icon = icons.get(level, "")

        toast = ctk.CTkFrame(
            self.parent,
            fg_color=bg,
            corner_radius=10,
            height=40,
        )

        ctk.CTkLabel(
            toast,
            text=f"  {icon}  {message}  ",
            font=theme.font(12, "bold"),
            text_color="white",
        ).pack(padx=8, pady=8)

        # Position
        offset = len(self._toasts) * 50
        toast.place(relx=1.0, rely=1.0, x=-20, y=-(40 + offset), anchor="se")
        self._toasts.append(toast)

        # Auto-remove after duration
        self.parent.after(duration, lambda: self._remove(toast))

    def _remove(self, toast: ctk.CTkFrame):
        """Remove a toast from the screen."""
        try:
            toast.place_forget()
            toast.destroy()
            if toast in self._toasts:
                self._toasts.remove(toast)
        except Exception:
            pass
