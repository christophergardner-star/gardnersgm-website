"""
Chart Panel — matplotlib charts embedded in CustomTkinter frames.
"""

import customtkinter as ctk
from .. import theme

try:
    import matplotlib
    matplotlib.use("Agg")
    from matplotlib.figure import Figure
    from matplotlib.backends.backend_tkagg import FigureCanvasTkAgg
    HAS_MATPLOTLIB = True
except ImportError:
    HAS_MATPLOTLIB = False


class ChartPanel(ctk.CTkFrame):
    """
    Embeds a matplotlib chart in a CustomTkinter frame.
    Supports bar charts, pie charts, and line charts.
    """

    def __init__(self, parent, width: int = 500, height: int = 300, **kwargs):
        super().__init__(
            parent,
            fg_color=theme.BG_CARD,
            corner_radius=12,
            **kwargs,
        )

        self._width = width
        self._height = height
        self.fig = None
        self.ax = None
        self.canvas = None

        if HAS_MATPLOTLIB:
            self._init_chart()
        else:
            ctk.CTkLabel(
                self, text="Charts require matplotlib",
                font=theme.font(12), text_color=theme.TEXT_DIM,
            ).pack(expand=True)

    def _init_chart(self):
        """Initialize the matplotlib figure and canvas."""
        dpi = 100
        self.fig = Figure(
            figsize=(self._width / dpi, self._height / dpi),
            dpi=dpi,
            facecolor=theme.BG_CARD,
        )
        self.ax = self.fig.add_subplot(111)
        self._style_axes(self.ax)

        self.canvas = FigureCanvasTkAgg(self.fig, master=self)
        self.canvas.get_tk_widget().pack(fill="both", expand=True, padx=8, pady=8)

    def _style_axes(self, ax):
        """Apply dark theme styling to axes."""
        ax.set_facecolor(theme.BG_CARD)
        ax.tick_params(colors=theme.TEXT_DIM, labelsize=9)
        ax.spines["top"].set_visible(False)
        ax.spines["right"].set_visible(False)
        ax.spines["left"].set_color(theme.TEXT_DIM)
        ax.spines["bottom"].set_color(theme.TEXT_DIM)
        ax.yaxis.label.set_color(theme.TEXT_DIM)
        ax.xaxis.label.set_color(theme.TEXT_DIM)
        ax.title.set_color(theme.TEXT_LIGHT)

    def bar_chart(self, labels: list[str], values: list[float],
                  title: str = "", ylabel: str = "", color: str = None):
        """Draw a bar chart."""
        if not HAS_MATPLOTLIB or not self.ax:
            return

        self.ax.clear()
        self._style_axes(self.ax)

        bar_color = color or theme.GREEN_PRIMARY
        bars = self.ax.bar(labels, values, color=bar_color, width=0.6, zorder=3)

        # Value labels on top of bars
        for bar, val in zip(bars, values):
            if val > 0:
                self.ax.text(
                    bar.get_x() + bar.get_width() / 2, bar.get_height() + max(values) * 0.02,
                    f"£{val:,.0f}" if "£" in ylabel or "revenue" in title.lower() else f"{val:,.0f}",
                    ha="center", va="bottom", fontsize=8,
                    color=theme.TEXT_LIGHT, fontweight="bold",
                )

        if title:
            self.ax.set_title(title, fontsize=13, fontweight="bold", pad=12)
        if ylabel:
            self.ax.set_ylabel(ylabel, fontsize=10)

        self.ax.grid(axis="y", alpha=0.15, color=theme.TEXT_DIM, zorder=0)
        self.ax.set_axisbelow(True)

        # Rotate labels if many
        if len(labels) > 6:
            self.ax.tick_params(axis="x", rotation=45)

        self.fig.tight_layout()
        self.canvas.draw()

    def pie_chart(self, labels: list[str], values: list[float],
                  title: str = "", colors: list[str] = None):
        """Draw a pie chart."""
        if not HAS_MATPLOTLIB or not self.ax:
            return

        self.ax.clear()
        self._style_axes(self.ax)

        if not colors:
            colors = [
                theme.GREEN_PRIMARY, theme.GREEN_LIGHT, theme.GREEN_ACCENT,
                theme.BLUE, theme.AMBER, theme.PURPLE, theme.RED,
                theme.GREEN_DARK, "#4ec6ca", "#f97316",
            ]

        # Filter out zero values
        filtered = [(l, v, c) for l, v, c in zip(labels, values, colors[:len(values)]) if v > 0]
        if not filtered:
            self.ax.text(0.5, 0.5, "No data", ha="center", va="center",
                         fontsize=14, color=theme.TEXT_DIM, transform=self.ax.transAxes)
            self.canvas.draw()
            return

        labels_f, values_f, colors_f = zip(*filtered)

        wedges, texts, autotexts = self.ax.pie(
            values_f,
            labels=labels_f,
            colors=colors_f,
            autopct="%1.0f%%",
            startangle=90,
            textprops={"fontsize": 9, "color": theme.TEXT_LIGHT},
            pctdistance=0.75,
        )

        for t in autotexts:
            t.set_fontsize(8)
            t.set_fontweight("bold")

        if title:
            self.ax.set_title(title, fontsize=13, fontweight="bold", pad=12,
                              color=theme.TEXT_LIGHT)

        self.fig.tight_layout()
        self.canvas.draw()

    def line_chart(self, x_data: list, y_data: list, title: str = "",
                   xlabel: str = "", ylabel: str = "", color: str = None):
        """Draw a line chart."""
        if not HAS_MATPLOTLIB or not self.ax:
            return

        self.ax.clear()
        self._style_axes(self.ax)

        line_color = color or theme.GREEN_LIGHT
        self.ax.plot(x_data, y_data, color=line_color, linewidth=2, marker="o",
                     markersize=5, markerfacecolor="white", markeredgecolor=line_color, zorder=3)
        self.ax.fill_between(x_data, y_data, alpha=0.15, color=line_color, zorder=2)

        if title:
            self.ax.set_title(title, fontsize=13, fontweight="bold", pad=12)
        if xlabel:
            self.ax.set_xlabel(xlabel, fontsize=10)
        if ylabel:
            self.ax.set_ylabel(ylabel, fontsize=10)

        self.ax.grid(axis="y", alpha=0.15, color=theme.TEXT_DIM, zorder=0)
        self.ax.set_axisbelow(True)

        if len(x_data) > 6:
            self.ax.tick_params(axis="x", rotation=45)

        self.fig.tight_layout()
        self.canvas.draw()

    def clear(self):
        """Clear the chart."""
        if self.ax:
            self.ax.clear()
            self._style_axes(self.ax)
            self.canvas.draw()
