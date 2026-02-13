"""
Data Table - sortable, filterable table built on ttk.Treeview with CustomTkinter styling.
"""

import csv
import io
import customtkinter as ctk
import tkinter as tk
from tkinter import ttk, filedialog
from .. import theme


class DataTable(ctk.CTkFrame):
    """
    A full-featured data table with:
    - Sortable column headers
    - Search/filter bar
    - Row selection with callback
    - CSV export
    - Status badges
    """

    def __init__(self, parent, columns: list[dict], on_select=None,
                 on_double_click=None, show_toolbar: bool = True, **kwargs):
        """
        columns: list of dicts with keys: 'key', 'label', 'width' (optional), 'anchor' (optional)
        Example: [{"key": "name", "label": "Name", "width": 200}, ...]
        """
        super().__init__(parent, fg_color="transparent", **kwargs)

        self.columns = columns
        self.col_keys = [c["key"] for c in columns]
        self.on_select = on_select
        self.on_double_click = on_double_click
        self._data: list[dict] = []
        self._filtered_data: list[dict] = []
        self._sort_column = None
        self._sort_reverse = False

        self.grid_rowconfigure(1, weight=1)
        self.grid_columnconfigure(0, weight=1)

        # -- Toolbar --
        if show_toolbar:
            self._build_toolbar()

        # -- Treeview --
        self._build_table()

    def _build_toolbar(self):
        """Build the search and filter toolbar."""
        toolbar = ctk.CTkFrame(self, fg_color="transparent", height=40)
        toolbar.grid(row=0, column=0, sticky="ew", padx=0, pady=(0, 8))
        toolbar.grid_columnconfigure(0, weight=1)

        # Search
        self.search_var = tk.StringVar()
        self.search_var.trace_add("write", self._on_filter)

        self.search_entry = theme.create_entry(
            toolbar,
            placeholder="\U0001f50d Filter...",
            textvariable=self.search_var,
            width=250,
        )
        self.search_entry.grid(row=0, column=0, sticky="w")

        # Count label
        self.count_label = ctk.CTkLabel(
            toolbar,
            text="0 rows",
            font=theme.font(11),
            text_color=theme.TEXT_DIM,
        )
        self.count_label.grid(row=0, column=1, padx=12)

        # Export button
        export_btn = theme.create_outline_button(
            toolbar, "\U0001f4e4 Export CSV",
            command=self._export_csv,
            width=110,
        )
        export_btn.grid(row=0, column=2, padx=4)

    def _build_table(self):
        """Build the ttk.Treeview table."""
        # Style the treeview for dark theme
        style = ttk.Style()
        style.theme_use("default")

        style.configure("GGM.Treeview", **{
            "background": theme.BG_CARD,
            "foreground": theme.TEXT_LIGHT,
            "fieldbackground": theme.BG_CARD,
            "borderwidth": 0,
            "rowheight": 32,
            "font": ("Segoe UI", 12),
        })
        style.configure("GGM.Treeview.Heading", **{
            "background": theme.BG_DARKER,
            "foreground": theme.TEXT_LIGHT,
            "borderwidth": 0,
            "relief": "flat",
            "font": ("Segoe UI", 11, "bold"),
            "padding": (8, 6),
        })
        style.map("GGM.Treeview", **{
            "background": [("selected", theme.GREEN_PRIMARY)],
            "foreground": [("selected", "white")],
        })
        style.map("GGM.Treeview.Heading", **{
            "background": [("active", theme.BG_CARD)],
        })

        # Container frame for tree + scrollbar
        tree_frame = ctk.CTkFrame(self, fg_color=theme.BG_CARD, corner_radius=10)
        tree_frame.grid(row=1, column=0, sticky="nsew")
        tree_frame.grid_rowconfigure(0, weight=1)
        tree_frame.grid_columnconfigure(0, weight=1)

        # Treeview
        self.tree = ttk.Treeview(
            tree_frame,
            columns=self.col_keys,
            show="headings",
            style="GGM.Treeview",
            selectmode="browse",
        )

        # Configure columns
        for col in self.columns:
            self.tree.heading(
                col["key"],
                text=col["label"],
                command=lambda k=col["key"]: self._sort_by(k),
            )
            self.tree.column(
                col["key"],
                width=col.get("width", 120),
                anchor=col.get("anchor", "w"),
                minwidth=60,
            )

        self.tree.grid(row=0, column=0, sticky="nsew", padx=2, pady=2)

        # Scrollbar
        scrollbar = ctk.CTkScrollbar(tree_frame, command=self.tree.yview)
        scrollbar.grid(row=0, column=1, sticky="ns", padx=(0, 2), pady=2)
        self.tree.configure(yscrollcommand=scrollbar.set)

        # Bindings
        self.tree.bind("<<TreeviewSelect>>", self._on_select)
        self.tree.bind("<Double-1>", self._on_double_click)

    # ------------------------------------------------------------------
    # Data Management
    # ------------------------------------------------------------------
    def set_data(self, data: list[dict]):
        """Set the table data and refresh display."""
        self._data = data
        self._apply_filter()

    def refresh(self):
        """Re-render the table with current data."""
        self._apply_filter()

    def get_selected(self) -> dict | None:
        """Get the currently selected row data (full dict, not just visible cols)."""
        selection = self.tree.selection()
        if selection:
            iid = selection[0]
            # Return the full original row data if available
            if hasattr(self, '_row_data') and iid in self._row_data:
                return self._row_data[iid]
            # Fallback: reconstruct from column values
            item = self.tree.item(iid)
            values = item["values"]
            if values:
                return dict(zip(self.col_keys, values))
        return None

    def get_selected_index(self) -> int | None:
        """Get the index of the selected row in the filtered data."""
        selection = self.tree.selection()
        if selection:
            return self.tree.index(selection[0])
        return None

    # ------------------------------------------------------------------
    # Sorting
    # ------------------------------------------------------------------
    def _sort_by(self, column: str):
        """Sort table by the given column."""
        if self._sort_column == column:
            self._sort_reverse = not self._sort_reverse
        else:
            self._sort_column = column
            self._sort_reverse = False

        # Sort data
        def sort_key(row):
            val = row.get(column, "")
            # Try numeric sort
            try:
                return (0, float(val))
            except (ValueError, TypeError):
                return (1, str(val).lower())

        self._filtered_data.sort(key=sort_key, reverse=self._sort_reverse)
        self._render()

        # Update header indicators
        for col in self.columns:
            arrow = ""
            if col["key"] == column:
                arrow = " \u2193" if self._sort_reverse else " \u2191"
            self.tree.heading(col["key"], text=col["label"] + arrow)

    # ------------------------------------------------------------------
    # Filtering
    # ------------------------------------------------------------------
    def _on_filter(self, *args):
        """Handle filter text changes."""
        self._apply_filter()

    def _apply_filter(self):
        """Apply the search filter and re-render."""
        search = ""
        if hasattr(self, "search_var"):
            search = self.search_var.get().lower().strip()

        if search:
            self._filtered_data = [
                row for row in self._data
                if any(search in str(v).lower() for v in row.values())
            ]
        else:
            self._filtered_data = list(self._data)

        # Re-apply sort if set
        if self._sort_column:
            def sort_key(row):
                val = row.get(self._sort_column, "")
                try:
                    return (0, float(val))
                except (ValueError, TypeError):
                    return (1, str(val).lower())
            self._filtered_data.sort(key=sort_key, reverse=self._sort_reverse)

        self._render()

    def _render(self):
        """Render the filtered data into the treeview."""
        # Clear existing
        self.tree.delete(*self.tree.get_children())
        self._row_data = {}  # Map treeview iid -> full row dict

        # Insert rows
        for row in self._filtered_data:
            values = [row.get(k, "") for k in self.col_keys]
            iid = self.tree.insert("", "end", values=values)
            self._row_data[iid] = row  # Store full row data

        # Update count
        if hasattr(self, "count_label"):
            total = len(self._data)
            shown = len(self._filtered_data)
            if total == shown:
                self.count_label.configure(text=f"{total} rows")
            else:
                self.count_label.configure(text=f"{shown}/{total} rows")

    # ------------------------------------------------------------------
    # Events
    # ------------------------------------------------------------------
    def _on_select(self, event=None):
        if self.on_select:
            data = self.get_selected()
            if data:
                self.on_select(data)

    def _on_double_click(self, event=None):
        if self.on_double_click:
            data = self.get_selected()
            if data:
                self.on_double_click(data)

    # ------------------------------------------------------------------
    # Export
    # ------------------------------------------------------------------
    def _export_csv(self):
        """Export table data to CSV file."""
        filepath = filedialog.asksaveasfilename(
            defaultextension=".csv",
            filetypes=[("CSV files", "*.csv"), ("All files", "*.*")],
            title="Export CSV",
        )
        if filepath:
            try:
                with open(filepath, "w", newline="", encoding="utf-8") as f:
                    writer = csv.DictWriter(f, fieldnames=self.col_keys)
                    writer.writeheader()
                    writer.writerows(self._filtered_data)
            except Exception as e:
                pass  # Silently fail
