"""
Photos Tab — Before & After photo gallery for all jobs.
Browse, filter, and manage photos from all sources:
mobile app, website forms, Telegram DayBot, and local imports.
"""

import customtkinter as ctk
import logging
import threading
import webbrowser
import os
from datetime import datetime, date
from pathlib import Path
from typing import Optional

from ..ui import theme
from ..ui.components.kpi_card import KPICard
from .. import config

_log = logging.getLogger("ggm.photos_tab")

try:
    from PIL import Image, ImageTk
    HAS_PIL = True
except ImportError:
    HAS_PIL = False

CACHE_DIR = config.DATA_DIR / "photo_cache"
THUMB_SIZE = (220, 165)


class PhotosTab(ctk.CTkScrollableFrame):
    """Photo gallery — browse all before/after photos across all jobs."""

    def __init__(self, parent, db, sync, api, app_window, **kwargs):
        super().__init__(parent, fg_color=theme.BG_DARK, **kwargs)

        self.db = db
        self.sync = sync
        self.api = api
        self.app = app_window

        self._thumb_refs = []       # prevent GC of Tk images
        self._all_photos = []       # current loaded set
        self._filter_type = "all"   # all | before | after
        self._filter_source = "all" # all | drive | local | mobile
        self._search_text = ""
        self._current_page = 0
        self._page_size = 30

        CACHE_DIR.mkdir(parents=True, exist_ok=True)

        self._build_ui()
        self.after(300, self.refresh)

    # ==================================================================
    # UI Build
    # ==================================================================
    def _build_ui(self):
        # ── Header + KPIs ──
        header = ctk.CTkFrame(self, fg_color="transparent")
        header.pack(fill="x", padx=16, pady=(16, 8))

        ctk.CTkLabel(
            header, text="📸  Photo Gallery",
            font=theme.font_heading(), text_color=theme.TEXT_LIGHT,
        ).pack(side="left")

        # Refresh button
        theme.create_outline_button(
            header, "↻  Refresh",
            command=self.refresh, width=100,
        ).pack(side="right", padx=(8, 0))

        # ── KPI row ──
        kpi_frame = ctk.CTkFrame(self, fg_color="transparent")
        kpi_frame.pack(fill="x", padx=16, pady=(0, 12))
        for i in range(4):
            kpi_frame.grid_columnconfigure(i, weight=1)

        self._kpi_total = KPICard(kpi_frame, label="Total Photos", value="0", icon="📸")
        self._kpi_total.grid(row=0, column=0, padx=4, pady=4, sticky="ew")

        self._kpi_before = KPICard(kpi_frame, label="Before", value="0", icon="📷")
        self._kpi_before.grid(row=0, column=1, padx=4, pady=4, sticky="ew")

        self._kpi_after = KPICard(kpi_frame, label="After", value="0", icon="✅")
        self._kpi_after.grid(row=0, column=2, padx=4, pady=4, sticky="ew")

        self._kpi_jobs = KPICard(kpi_frame, label="Jobs with Photos", value="0", icon="📋")
        self._kpi_jobs.grid(row=0, column=3, padx=4, pady=4, sticky="ew")

        # ── Filter bar ──
        filter_frame = ctk.CTkFrame(self, fg_color=theme.BG_CARD, corner_radius=10)
        filter_frame.pack(fill="x", padx=16, pady=(0, 12))

        inner = ctk.CTkFrame(filter_frame, fg_color="transparent")
        inner.pack(fill="x", padx=12, pady=10)

        # Search
        ctk.CTkLabel(
            inner, text="🔍", font=theme.font(14),
        ).pack(side="left", padx=(0, 4))

        self._search_entry = theme.create_entry(
            inner, placeholder="Search client, job number...", width=220,
        )
        self._search_entry.pack(side="left", padx=(0, 12))
        self._search_entry.bind("<Return>", lambda e: self._apply_filters())

        # Type filter
        ctk.CTkLabel(
            inner, text="Type:", font=theme.font(12),
            text_color=theme.TEXT_DIM,
        ).pack(side="left", padx=(8, 4))

        self._type_var = ctk.StringVar(value="all")
        self._type_menu = ctk.CTkSegmentedButton(
            inner,
            values=["all", "before", "after"],
            variable=self._type_var,
            command=lambda v: self._apply_filters(),
            font=theme.font(11),
            height=30,
        )
        self._type_menu.pack(side="left", padx=(0, 12))

        # Source filter
        ctk.CTkLabel(
            inner, text="Source:", font=theme.font(12),
            text_color=theme.TEXT_DIM,
        ).pack(side="left", padx=(8, 4))

        self._source_var = ctk.StringVar(value="all")
        self._source_menu = ctk.CTkSegmentedButton(
            inner,
            values=["all", "drive", "local", "mobile"],
            variable=self._source_var,
            command=lambda v: self._apply_filters(),
            font=theme.font(11),
            height=30,
        )
        self._source_menu.pack(side="left", padx=(0, 12))

        # ── Gallery container ──
        self._gallery = ctk.CTkFrame(self, fg_color="transparent")
        self._gallery.pack(fill="both", expand=True, padx=16, pady=(0, 8))

        # ── Pagination ──
        self._page_frame = ctk.CTkFrame(self, fg_color="transparent")
        self._page_frame.pack(fill="x", padx=16, pady=(0, 16))

    # ==================================================================
    # Data Loading
    # ==================================================================
    def refresh(self):
        """Load all photos from the database."""
        try:
            self._all_photos = self.db.fetchall(
                """SELECT * FROM job_photos
                   ORDER BY created_at DESC, job_number ASC"""
            )
        except Exception as e:
            _log.error("Failed to load photos: %s", e)
            self._all_photos = []

        self._update_kpis()
        self._current_page = 0
        self._apply_filters()

    def on_table_update(self, table_name: str):
        """React to sync events."""
        if table_name in ("job_photos", "clients"):
            self.refresh()

    def _update_kpis(self):
        """Update the KPI cards."""
        all_p = self._all_photos
        total = len(all_p)
        befores = sum(1 for p in all_p if p.get("photo_type") == "before")
        afters = sum(1 for p in all_p if p.get("photo_type") == "after")
        job_numbers = {p.get("job_number", "") for p in all_p if p.get("job_number")}

        self._kpi_total.update_value(str(total))
        self._kpi_before.update_value(str(befores))
        self._kpi_after.update_value(str(afters))
        self._kpi_jobs.update_value(str(len(job_numbers)))

    # ==================================================================
    # Filtering
    # ==================================================================
    def _apply_filters(self):
        """Apply current filters and render the gallery."""
        self._filter_type = self._type_var.get()
        self._filter_source = self._source_var.get()
        self._search_text = self._search_entry.get().strip().lower()

        filtered = self._all_photos

        # Type filter
        if self._filter_type != "all":
            filtered = [p for p in filtered
                        if p.get("photo_type", "").lower() == self._filter_type]

        # Source filter
        if self._filter_source != "all":
            filtered = [p for p in filtered
                        if p.get("source", "local").lower() == self._filter_source]

        # Text search
        if self._search_text:
            q = self._search_text
            filtered = [
                p for p in filtered
                if q in (p.get("client_name", "") or "").lower()
                or q in (p.get("job_number", "") or "").lower()
                or q in (p.get("caption", "") or "").lower()
                or q in (p.get("filename", "") or "").lower()
            ]

        self._filtered_photos = filtered
        self._current_page = 0
        self._render_gallery()

    # ==================================================================
    # Gallery Rendering
    # ==================================================================
    def _render_gallery(self):
        """Render the current page of photos in a grid."""
        # Clear gallery
        for w in self._gallery.winfo_children():
            w.destroy()
        for w in self._page_frame.winfo_children():
            w.destroy()
        self._thumb_refs.clear()

        photos = self._filtered_photos
        total = len(photos)

        if total == 0:
            empty = ctk.CTkFrame(self._gallery, fg_color=theme.BG_CARD, corner_radius=12)
            empty.pack(fill="x", pady=40, padx=40)
            ctk.CTkLabel(
                empty,
                text=(
                    "📷  No photos found\n\n"
                    "Photos arrive from:\n"
                    "• Mobile app — take before/after pics on site\n"
                    "• Website bookings — customers upload with enquiries\n"
                    "• Telegram DayBot — send with caption like 'GGM-0042 before'\n"
                    "• Hub — import from file via Dispatch tab 📸 button"
                ),
                font=theme.font(14), text_color=theme.TEXT_DIM,
                justify="center",
            ).pack(pady=30, padx=20)
            return

        # Pagination
        start = self._current_page * self._page_size
        end = min(start + self._page_size, total)
        page_photos = photos[start:end]

        # Count summary
        ctk.CTkLabel(
            self._gallery,
            text=f"Showing {start + 1}–{end} of {total} photos",
            font=theme.font(11), text_color=theme.TEXT_DIM,
        ).pack(anchor="w", pady=(0, 8))

        # Group by job number for better browsing
        grouped = {}
        for p in page_photos:
            jn = p.get("job_number", "") or "No Job Number"
            if jn not in grouped:
                grouped[jn] = {"client_name": p.get("client_name", "Unknown"),
                               "photos": []}
            grouped[jn]["photos"].append(p)

        for job_num, data in grouped.items():
            self._render_job_group(job_num, data["client_name"], data["photos"])

        # Pagination controls
        total_pages = max(1, (total + self._page_size - 1) // self._page_size)
        if total_pages > 1:
            self._render_pagination(total_pages)

    def _render_job_group(self, job_number: str, client_name: str, photos: list):
        """Render a collapsible job group with its photos."""
        group = ctk.CTkFrame(self._gallery, fg_color=theme.BG_CARD, corner_radius=10)
        group.pack(fill="x", pady=(0, 12))

        # ── Group header ──
        gh = ctk.CTkFrame(group, fg_color=theme.GREEN_DARK, corner_radius=10,
                          height=44)
        gh.pack(fill="x")
        gh.pack_propagate(False)

        befores = [p for p in photos if p.get("photo_type") == "before"]
        afters = [p for p in photos if p.get("photo_type") == "after"]

        ctk.CTkLabel(
            gh, text=f"  📋  {job_number}  —  {client_name}",
            font=theme.font_bold(13), text_color="white",
            anchor="w",
        ).pack(side="left", padx=8, fill="x", expand=True)

        # Photo count badges
        badge_frame = ctk.CTkFrame(gh, fg_color="transparent")
        badge_frame.pack(side="right", padx=8)

        if befores:
            ctk.CTkLabel(
                badge_frame, text=f"📷 {len(befores)} before",
                font=theme.font(10, "bold"), text_color=theme.AMBER,
                fg_color=theme.BG_DARK, corner_radius=4, width=80, height=22,
            ).pack(side="left", padx=2)

        if afters:
            ctk.CTkLabel(
                badge_frame, text=f"✅ {len(afters)} after",
                font=theme.font(10, "bold"), text_color=theme.GREEN_LIGHT,
                fg_color=theme.BG_DARK, corner_radius=4, width=80, height=22,
            ).pack(side="left", padx=2)

        # Open PhotoManager for this job
        open_btn = ctk.CTkButton(
            badge_frame, text="Open 📸", width=70, height=24,
            fg_color=theme.GREEN_PRIMARY, hover_color=theme.GREEN_ACCENT,
            corner_radius=6, font=theme.font(10, "bold"),
            command=lambda jn=job_number, cn=client_name, ps=photos:
                self._open_photo_manager(jn, cn, ps),
        )
        open_btn.pack(side="left", padx=(8, 0))

        # ── Side-by-side before / after ──
        body = ctk.CTkFrame(group, fg_color="transparent")
        body.pack(fill="x", padx=8, pady=8)
        body.grid_columnconfigure(0, weight=1)
        body.grid_columnconfigure(1, weight=1)

        # Before column
        if befores:
            bcol = ctk.CTkFrame(body, fg_color=theme.BG_INPUT, corner_radius=8)
            bcol.grid(row=0, column=0, sticky="nsew", padx=(0, 4))

            ctk.CTkLabel(
                bcol, text="📷  BEFORE",
                font=theme.font_bold(11), text_color=theme.AMBER,
            ).pack(anchor="w", padx=8, pady=(8, 4))

            for photo in befores[:4]:  # max 4 preview per type
                self._render_thumbnail(bcol, photo)

            if len(befores) > 4:
                ctk.CTkLabel(
                    bcol, text=f"+{len(befores) - 4} more",
                    font=theme.font(10), text_color=theme.TEXT_DIM,
                ).pack(pady=(0, 6))

        else:
            bcol = ctk.CTkFrame(body, fg_color=theme.BG_INPUT, corner_radius=8)
            bcol.grid(row=0, column=0, sticky="nsew", padx=(0, 4))
            ctk.CTkLabel(
                bcol, text="📷  BEFORE\nNo photos",
                font=theme.font(11), text_color=theme.TEXT_DIM,
                justify="center",
            ).pack(pady=20)

        # After column
        if afters:
            acol = ctk.CTkFrame(body, fg_color=theme.BG_INPUT, corner_radius=8)
            acol.grid(row=0, column=1, sticky="nsew", padx=(4, 0))

            ctk.CTkLabel(
                acol, text="✅  AFTER",
                font=theme.font_bold(11), text_color=theme.GREEN_LIGHT,
            ).pack(anchor="w", padx=8, pady=(8, 4))

            for photo in afters[:4]:
                self._render_thumbnail(acol, photo)

            if len(afters) > 4:
                ctk.CTkLabel(
                    acol, text=f"+{len(afters) - 4} more",
                    font=theme.font(10), text_color=theme.TEXT_DIM,
                ).pack(pady=(0, 6))

        else:
            acol = ctk.CTkFrame(body, fg_color=theme.BG_INPUT, corner_radius=8)
            acol.grid(row=0, column=1, sticky="nsew", padx=(4, 0))
            ctk.CTkLabel(
                acol, text="✅  AFTER\nNo photos",
                font=theme.font(11), text_color=theme.TEXT_DIM,
                justify="center",
            ).pack(pady=20)

    def _render_thumbnail(self, parent, photo: dict):
        """Render a single photo thumbnail card."""
        card = ctk.CTkFrame(parent, fg_color=theme.BG_CARD_HOVER, corner_radius=6)
        card.pack(fill="x", padx=6, pady=3)

        source = photo.get("source", "local")
        drive_url = photo.get("drive_url", "")
        file_id = photo.get("drive_file_id", "")
        filename = photo.get("filename", "")

        # Info row: source badge + caption/filename
        info_row = ctk.CTkFrame(card, fg_color="transparent")
        info_row.pack(fill="x", padx=6, pady=(4, 2))

        # Source badge
        source_icons = {"drive": "☁️ Drive", "local": "📁 Local",
                        "mobile": "📱 Mobile", "telegram": "💬 TG"}
        source_colours = {"drive": "#42A5F5", "local": theme.TEXT_DIM,
                          "mobile": theme.GREEN_LIGHT, "telegram": "#29B6F6"}
        badge_text = source_icons.get(source, f"📷 {source}")
        badge_colour = source_colours.get(source, theme.TEXT_DIM)

        ctk.CTkLabel(
            info_row, text=badge_text,
            font=theme.font(9), text_color=badge_colour,
        ).pack(side="left")

        # Caption or filename
        caption = photo.get("caption", "") or filename or ""
        if len(caption) > 35:
            caption = caption[:32] + "..."
        ctk.CTkLabel(
            info_row, text=caption,
            font=theme.font(10), text_color=theme.TEXT_DIM,
        ).pack(side="left", padx=(6, 0))

        # Date
        created = photo.get("created_at", "")
        try:
            dt = datetime.fromisoformat(created)
            time_str = dt.strftime("%d %b %Y %H:%M")
        except Exception:
            time_str = ""

        if time_str:
            ctk.CTkLabel(
                info_row, text=time_str,
                font=theme.font(9), text_color=theme.TEXT_DIM,
            ).pack(side="right")

        # Thumbnail image
        if source == "drive" and file_id:
            cached = CACHE_DIR / f"{file_id}.jpg"
            if cached.exists() and HAS_PIL:
                self._load_cached_thumbnail(card, cached, drive_url)
            elif HAS_PIL:
                placeholder = ctk.CTkLabel(
                    card, text="⏳ Loading thumbnail...",
                    font=theme.font(10), text_color=theme.TEXT_DIM,
                    height=50,
                )
                placeholder.pack(padx=6, pady=4)
                threading.Thread(
                    target=self._bg_download_thumb,
                    args=(file_id, drive_url, card, placeholder),
                    daemon=True,
                ).start()
            else:
                self._render_text_link(card, drive_url, caption or "View photo")
        elif source in ("local", ""):
            self._load_local_thumbnail(card, photo)
        else:
            # Mobile/telegram without file_id — show link
            if drive_url:
                self._render_text_link(card, drive_url, caption or "View photo")
            else:
                ctk.CTkLabel(
                    card, text=f"📷 {filename}",
                    font=theme.font(10), text_color=theme.TEXT_DIM,
                ).pack(padx=6, pady=4)

        # Action buttons
        action_row = ctk.CTkFrame(card, fg_color="transparent")
        action_row.pack(fill="x", padx=6, pady=(2, 4))

        if drive_url:
            ctk.CTkButton(
                action_row, text="🔗 View Full", width=80, height=22,
                fg_color="#1976D2", hover_color="#1565C0",
                corner_radius=4, font=theme.font(9),
                command=lambda u=drive_url: webbrowser.open(u),
            ).pack(side="left", padx=(0, 4))

    def _load_cached_thumbnail(self, parent, cache_path: Path, drive_url: str):
        """Load a cached Drive thumbnail."""
        try:
            img = Image.open(str(cache_path))
            img.thumbnail(THUMB_SIZE, Image.LANCZOS)
            tk_img = ImageTk.PhotoImage(img)
            self._thumb_refs.append(tk_img)

            lbl = ctk.CTkLabel(parent, text="", image=tk_img)
            lbl.pack(padx=6, pady=4)
            if drive_url:
                lbl.bind("<Button-1>", lambda e, u=drive_url: webbrowser.open(u))
        except Exception as e:
            _log.debug("Cached thumb load failed: %s", e)

    def _load_local_thumbnail(self, parent, photo: dict):
        """Load a local photo thumbnail."""
        filename = photo.get("filename", "")
        cid = str(photo.get("client_id", "unknown"))
        job_ref = photo.get("job_number", "") or photo.get("job_date", "")

        filepath = config.PHOTOS_DIR / cid / job_ref / filename
        if not filepath.exists():
            filepath = config.PHOTOS_DIR / cid / filename

        if HAS_PIL and filepath.exists():
            try:
                img = Image.open(str(filepath))
                img.thumbnail(THUMB_SIZE, Image.LANCZOS)
                tk_img = ImageTk.PhotoImage(img)
                self._thumb_refs.append(tk_img)

                lbl = ctk.CTkLabel(parent, text="", image=tk_img)
                lbl.pack(padx=6, pady=4)
                lbl.bind("<Button-1>",
                         lambda e, p=str(filepath): self._open_local(p))
            except Exception as e:
                _log.debug("Local thumb failed: %s", e)
                ctk.CTkLabel(
                    parent, text=f"📷 {filename}",
                    font=theme.font(10), text_color=theme.TEXT_DIM,
                ).pack(padx=6, pady=4)
        else:
            ctk.CTkLabel(
                parent, text=f"📷 {filename}",
                font=theme.font(10), text_color=theme.TEXT_DIM,
            ).pack(padx=6, pady=4)

    def _render_text_link(self, parent, url: str, text: str):
        """Render a clickable text link to view the photo."""
        btn = ctk.CTkButton(
            parent, text=f"🔗 {text}", width=200, height=28,
            fg_color=theme.BG_INPUT, hover_color=theme.BG_CARD_HOVER,
            corner_radius=4, font=theme.font(11),
            text_color="#42A5F5",
            command=lambda: webbrowser.open(url),
        )
        btn.pack(padx=6, pady=4)

    def _bg_download_thumb(self, file_id, drive_url, card, placeholder):
        """Background download of a Drive thumbnail."""
        try:
            import urllib.request

            cache_path = CACHE_DIR / f"{file_id}.jpg"
            thumb_url = f"https://drive.google.com/thumbnail?id={file_id}&sz=w400"

            req = urllib.request.Request(thumb_url, headers={
                "User-Agent": "Mozilla/5.0 GGM-Hub/4.2"
            })
            with urllib.request.urlopen(req, timeout=10) as resp:
                with open(str(cache_path), "wb") as f:
                    f.write(resp.read())

            if HAS_PIL and self.winfo_exists():
                img = Image.open(str(cache_path))
                img.thumbnail(THUMB_SIZE, Image.LANCZOS)
                img.save(str(cache_path), "JPEG", quality=85)
                tk_img = ImageTk.PhotoImage(img)
                self._thumb_refs.append(tk_img)

                def update():
                    if placeholder.winfo_exists():
                        placeholder.configure(image=tk_img, text="")
                        if drive_url:
                            placeholder.bind("<Button-1>",
                                             lambda e: webbrowser.open(drive_url))

                self.after(0, update)

        except Exception as e:
            _log.debug("Thumb download failed %s: %s", file_id, e)
            if self.winfo_exists():
                self.after(0, lambda: (
                    placeholder.configure(text="📷 Photo (click View)")
                    if placeholder.winfo_exists() else None
                ))

    # ==================================================================
    # Pagination
    # ==================================================================
    def _render_pagination(self, total_pages: int):
        """Render pagination controls."""
        inner = ctk.CTkFrame(self._page_frame, fg_color="transparent")
        inner.pack(pady=8)

        if self._current_page > 0:
            ctk.CTkButton(
                inner, text="← Prev", width=80, height=30,
                fg_color=theme.GREEN_PRIMARY, hover_color=theme.GREEN_DARK,
                corner_radius=6, font=theme.font(11),
                command=self._prev_page,
            ).pack(side="left", padx=4)

        ctk.CTkLabel(
            inner,
            text=f"Page {self._current_page + 1} of {total_pages}",
            font=theme.font(12), text_color=theme.TEXT_DIM,
        ).pack(side="left", padx=16)

        if self._current_page < total_pages - 1:
            ctk.CTkButton(
                inner, text="Next →", width=80, height=30,
                fg_color=theme.GREEN_PRIMARY, hover_color=theme.GREEN_DARK,
                corner_radius=6, font=theme.font(11),
                command=self._next_page,
            ).pack(side="left", padx=4)

    def _prev_page(self):
        if self._current_page > 0:
            self._current_page -= 1
            self._render_gallery()

    def _next_page(self):
        total = len(self._filtered_photos)
        total_pages = max(1, (total + self._page_size - 1) // self._page_size)
        if self._current_page < total_pages - 1:
            self._current_page += 1
            self._render_gallery()

    # ==================================================================
    # Actions
    # ==================================================================
    def _open_photo_manager(self, job_number: str, client_name: str, photos: list = None):
        """Open the existing PhotoManager modal for a specific job."""
        try:
            from ..ui.components.photo_manager import PhotoManager

            # Try to find client_id from photos or DB
            client_id = None
            try:
                client = self.db.fetchone(
                    "SELECT id FROM clients WHERE name = ?", (client_name,)
                )
                if client:
                    client_id = client["id"]
            except Exception:
                pass

            PhotoManager(
                self.app,
                db=self.db,
                client_id=client_id,
                client_name=client_name,
                job_number=job_number,
            )
        except Exception as e:
            _log.error("Failed to open PhotoManager: %s", e)

    def _open_local(self, filepath: str):
        """Open a local photo with the system viewer."""
        try:
            os.startfile(filepath)
        except Exception:
            webbrowser.open(filepath)
