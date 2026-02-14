"""
Photo Manager — Before & After photo gallery with Drive sync.
Displays both local photos and Google Drive photos synced from the Job Photos sheet.
Thumbnails from Drive are cached locally for fast repeat viewing.
"""

import customtkinter as ctk
import shutil
import os
import uuid
import logging
import threading
from datetime import date, datetime
from pathlib import Path
from tkinter import filedialog
from typing import Optional

from .. import theme
from ... import config

log = logging.getLogger("ggm.photos")

try:
    from PIL import Image, ImageTk
    HAS_PIL = True
except ImportError:
    HAS_PIL = False

CACHE_DIR = config.DATA_DIR / "photo_cache"


class PhotoManager(ctk.CTkToplevel):
    """
    Photo manager modal for a booking/client.
    Shows before/after gallery from local files and Google Drive (synced).
    """

    THUMB_SIZE = (180, 135)

    def __init__(self, parent, db, client_id: int = None,
                 client_name: str = "", job_date: str = "",
                 job_number: str = "", **kwargs):
        super().__init__(parent, **kwargs)

        self.db = db
        self.client_id = client_id
        self.client_name = client_name
        self.job_date = job_date or date.today().isoformat()
        self.job_number = job_number

        # ── Window setup ──
        title_parts = [f"📸 Photos — {client_name}"]
        if job_number:
            title_parts.append(f"({job_number})")
        self.title(" ".join(title_parts))
        self.geometry("720x620")
        self.resizable(True, True)
        self.configure(fg_color=theme.BG_DARK)
        self.transient(parent)
        self.grab_set()

        self.update_idletasks()
        px = parent.winfo_rootx() + (parent.winfo_width() - 720) // 2
        py = parent.winfo_rooty() + (parent.winfo_height() - 620) // 2
        self.geometry(f"720x620+{max(px, 0)}+{max(py, 0)}")

        CACHE_DIR.mkdir(parents=True, exist_ok=True)

        self._thumb_refs = []  # keep references to prevent GC
        self._build_ui()
        self.after(100, self.focus_force)

    # ------------------------------------------------------------------
    # UI
    # ------------------------------------------------------------------
    def _build_ui(self):
        # ── Header ──
        header = ctk.CTkFrame(self, fg_color=theme.GREEN_DARK, corner_radius=0, height=60)
        header.pack(fill="x")
        header.pack_propagate(False)

        ctk.CTkLabel(
            header, text=f"📸  {self.client_name}",
            font=theme.font_bold(16), text_color="white",
        ).pack(side="left", padx=16, pady=12)

        right_parts = []
        if self.job_number:
            right_parts.append(f"#{self.job_number}")
        right_parts.append(f"📅 {self.job_date}")

        ctk.CTkLabel(
            header, text="  ".join(right_parts),
            font=theme.font(12), text_color=theme.GREEN_PALE,
        ).pack(side="right", padx=16, pady=12)

        # ── Action bar ──
        action_bar = ctk.CTkFrame(self, fg_color="transparent", height=48)
        action_bar.pack(fill="x", padx=16, pady=8)

        theme.create_accent_button(
            action_bar, "📷 Add Before Photo",
            command=lambda: self._add_photo("before"), width=160,
        ).pack(side="left", padx=(0, 8))

        theme.create_accent_button(
            action_bar, "📷 Add After Photo",
            command=lambda: self._add_photo("after"), width=160,
        ).pack(side="left", padx=(0, 8))

        # ── Gallery body ──
        self.gallery = ctk.CTkScrollableFrame(self, fg_color="transparent")
        self.gallery.pack(fill="both", expand=True, padx=0, pady=0)

        # ── Close button ──
        btn_frame = ctk.CTkFrame(self, fg_color="transparent", height=50)
        btn_frame.pack(fill="x", padx=16, pady=(0, 12))

        ctk.CTkButton(
            btn_frame, text="Close", width=80, height=34,
            fg_color="transparent", hover_color=theme.BG_CARD_HOVER,
            text_color=theme.TEXT_DIM, corner_radius=8,
            font=theme.font(12), command=self.destroy,
        ).pack(side="right")

        self._load_photos()

    # ------------------------------------------------------------------
    # Local Photo Import
    # ------------------------------------------------------------------
    def _add_photo(self, photo_type: str):
        """Open file dialog and import a photo."""
        filetypes = [
            ("Images", "*.jpg *.jpeg *.png *.bmp *.webp *.avif"),
            ("All files", "*.*"),
        ]
        paths = filedialog.askopenfilenames(
            title=f"Select {photo_type.title()} Photo(s)",
            filetypes=filetypes,
            parent=self,
        )

        if not paths:
            return

        for src_path in paths:
            try:
                src = Path(src_path)
                ext = src.suffix.lower() or ".jpg"
                uid = uuid.uuid4().hex[:8]
                ts = datetime.now().strftime("%Y%m%d_%H%M%S")
                filename = f"{photo_type}_{ts}_{uid}{ext}"

                # Organise by client_id/job_ref/
                job_ref = self.job_number or self.job_date or "unsorted"
                client_dir = config.PHOTOS_DIR / str(self.client_id or "unknown") / job_ref
                client_dir.mkdir(parents=True, exist_ok=True)
                dest = client_dir / filename

                if HAS_PIL and ext in (".jpg", ".jpeg", ".png", ".bmp", ".webp"):
                    img = Image.open(str(src))
                    max_w = 1920
                    if img.width > max_w:
                        ratio = max_w / img.width
                        new_h = int(img.height * ratio)
                        img = img.resize((max_w, new_h), Image.LANCZOS)
                    img.save(str(dest), quality=85)
                else:
                    shutil.copy2(str(src), str(dest))

                self.db.save_photo(
                    client_id=self.client_id or 0,
                    client_name=self.client_name,
                    job_date=self.job_date,
                    photo_type=photo_type,
                    filename=filename,
                )
                log.info(f"Photo saved: {filename}")

            except Exception as e:
                log.error(f"Failed to save photo: {e}")

        self._load_photos()

    # ------------------------------------------------------------------
    # Photo Loading & Gallery
    # ------------------------------------------------------------------
    def _load_photos(self):
        """Load and display all photos (local + Drive)."""
        for w in self.gallery.winfo_children():
            w.destroy()
        self._thumb_refs.clear()

        all_photos = self.db.get_all_photos_for_display(
            client_id=self.client_id,
            job_number=self.job_number,
        )

        if not all_photos:
            ctk.CTkLabel(
                self.gallery,
                text=(
                    "📷  No photos yet\n\n"
                    "Add local photos with the buttons above,\n"
                    "or send photos to DayBot on Telegram\n"
                    "with a caption like: GGM-0042 before"
                ),
                font=theme.font(14), text_color=theme.TEXT_DIM,
                justify="center",
            ).pack(pady=60)
            return

        # Split into before/after
        befores = [p for p in all_photos if p.get("photo_type") == "before"]
        afters = [p for p in all_photos if p.get("photo_type") == "after"]

        # Summary bar
        ctk.CTkLabel(
            self.gallery,
            text=f"📷 {len(befores)} before  •  {len(afters)} after  •  {len(all_photos)} total",
            font=theme.font(12), text_color=theme.TEXT_DIM,
        ).pack(fill="x", padx=16, pady=(8, 4))

        # Side-by-side layout
        row_frame = ctk.CTkFrame(self.gallery, fg_color="transparent")
        row_frame.pack(fill="both", expand=True, padx=16, pady=4)
        row_frame.grid_columnconfigure(0, weight=1)
        row_frame.grid_columnconfigure(1, weight=1)

        # Before column
        before_col = ctk.CTkFrame(row_frame, fg_color=theme.BG_CARD, corner_radius=10)
        before_col.grid(row=0, column=0, sticky="nsew", padx=(0, 4), pady=2)

        ctk.CTkLabel(
            before_col, text="📷 BEFORE",
            font=theme.font_bold(13), text_color=theme.AMBER,
        ).pack(fill="x", padx=8, pady=(10, 6))

        self._render_photo_list(before_col, befores)

        # After column
        after_col = ctk.CTkFrame(row_frame, fg_color=theme.BG_CARD, corner_radius=10)
        after_col.grid(row=0, column=1, sticky="nsew", padx=(4, 0), pady=2)

        ctk.CTkLabel(
            after_col, text="📷 AFTER",
            font=theme.font_bold(13), text_color=theme.GREEN_LIGHT,
        ).pack(fill="x", padx=8, pady=(10, 6))

        self._render_photo_list(after_col, afters)

    def _render_photo_list(self, parent, photos: list):
        """Render a list of photos — local or Drive."""
        if not photos:
            ctk.CTkLabel(
                parent, text="No photos",
                font=theme.font(11), text_color=theme.TEXT_DIM,
            ).pack(pady=16)
            return

        for photo in photos:
            source = photo.get("source", "local")
            frame = ctk.CTkFrame(parent, fg_color=theme.BG_INPUT, corner_radius=8)
            frame.pack(fill="x", padx=8, pady=4)

            if source == "drive":
                self._render_drive_photo(frame, photo)
            else:
                self._render_local_photo(frame, photo)

    # ------------------------------------------------------------------
    # Local Photo Rendering
    # ------------------------------------------------------------------
    def _render_local_photo(self, frame, photo):
        """Render a locally stored photo with thumbnail."""
        filename = photo.get("filename", "")
        cid = str(photo.get("client_id", "unknown"))
        job_ref = photo.get("job_number", "") or photo.get("job_date", "")

        # Try job_ref subfolder first, then flat client folder (legacy)
        filepath = config.PHOTOS_DIR / cid / job_ref / filename
        if not filepath.exists():
            filepath = config.PHOTOS_DIR / cid / filename

        # Source badge
        ctk.CTkLabel(
            frame, text="📁 Local",
            font=theme.font(9), text_color=theme.TEXT_DIM,
        ).pack(anchor="e", padx=8, pady=(4, 0))

        # Thumbnail
        if HAS_PIL and filepath.exists():
            try:
                img = Image.open(str(filepath))
                img.thumbnail(self.THUMB_SIZE, Image.LANCZOS)
                tk_img = ImageTk.PhotoImage(img)
                self._thumb_refs.append(tk_img)

                img_label = ctk.CTkLabel(frame, text="", image=tk_img)
                img_label.pack(padx=6, pady=4)
                img_label.bind("<Button-1>", lambda e, p=str(filepath): self._open_full(p))
            except Exception as e:
                log.warning(f"Thumbnail load failed: {e}")
                ctk.CTkLabel(
                    frame, text=f"📷 {filename}",
                    font=theme.font(11), text_color=theme.TEXT_DIM,
                ).pack(padx=8, pady=8)
        else:
            ctk.CTkLabel(
                frame, text=f"📷 {filename}",
                font=theme.font(11), text_color=theme.TEXT_DIM,
            ).pack(padx=8, pady=8)

        # Bottom: time + delete
        bottom = ctk.CTkFrame(frame, fg_color="transparent")
        bottom.pack(fill="x", padx=6, pady=(0, 6))

        created = photo.get("created_at", "")
        try:
            dt = datetime.fromisoformat(created)
            time_str = dt.strftime("%d %b %H:%M")
        except Exception:
            time_str = ""

        ctk.CTkLabel(
            bottom, text=time_str,
            font=theme.font(10), text_color=theme.TEXT_DIM,
        ).pack(side="left")

        ctk.CTkButton(
            bottom, text="🗑️", width=28, height=24,
            fg_color="transparent", hover_color=theme.RED,
            text_color=theme.TEXT_DIM, font=theme.font(12),
            command=lambda pid=photo["id"], fn=filename, cid=photo.get("client_id"):
                self._delete_photo(pid, fn, cid),
        ).pack(side="right")

    # ------------------------------------------------------------------
    # Drive Photo Rendering
    # ------------------------------------------------------------------
    def _render_drive_photo(self, frame, photo):
        """Render a Drive-synced photo with cached thumbnails."""
        file_id = photo.get("drive_file_id", "")
        drive_url = photo.get("drive_url", "")
        caption = photo.get("caption", "")

        # Source badge
        ctk.CTkLabel(
            frame, text="☁️ Drive",
            font=theme.font(9), text_color="#42A5F5",
        ).pack(anchor="e", padx=8, pady=(4, 0))

        # Check for cached thumbnail
        cached = CACHE_DIR / f"{file_id}.jpg" if file_id else None

        if cached and cached.exists() and HAS_PIL:
            # Load cached thumbnail
            try:
                img = Image.open(str(cached))
                img.thumbnail(self.THUMB_SIZE, Image.LANCZOS)
                tk_img = ImageTk.PhotoImage(img)
                self._thumb_refs.append(tk_img)

                img_label = ctk.CTkLabel(frame, text="", image=tk_img)
                img_label.pack(padx=6, pady=4)
                img_label.bind("<Button-1>", lambda e, u=drive_url: self._open_drive(u))
            except Exception:
                self._render_drive_placeholder(frame, drive_url, caption)
        elif file_id and HAS_PIL:
            # Show placeholder and start background download
            placeholder = ctk.CTkLabel(
                frame, text="⏳ Loading...",
                font=theme.font(11), text_color=theme.TEXT_DIM,
                height=60,
            )
            placeholder.pack(padx=8, pady=8)

            threading.Thread(
                target=self._download_and_display,
                args=(file_id, drive_url, frame, placeholder),
                daemon=True,
            ).start()
        else:
            self._render_drive_placeholder(frame, drive_url, caption)

        # Bottom: caption + date + view button
        bottom = ctk.CTkFrame(frame, fg_color="transparent")
        bottom.pack(fill="x", padx=6, pady=(0, 6))

        uploaded = photo.get("created_at", "")
        label_parts = []
        if caption:
            label_parts.append(caption[:30])
        if uploaded:
            label_parts.append(str(uploaded)[:16])

        ctk.CTkLabel(
            bottom, text="  •  ".join(label_parts) if label_parts else "",
            font=theme.font(10), text_color=theme.TEXT_DIM,
        ).pack(side="left")

        if drive_url:
            ctk.CTkButton(
                bottom, text="🔗 View", width=60, height=24,
                fg_color="#1976D2", hover_color="#1565C0",
                corner_radius=4, font=theme.font(10),
                command=lambda u=drive_url: self._open_drive(u),
            ).pack(side="right")

    def _render_drive_placeholder(self, frame, drive_url, caption):
        """Simple placeholder card for a Drive photo when PIL not available."""
        card = ctk.CTkFrame(frame, fg_color=theme.BG_CARD_HOVER, corner_radius=6, height=60)
        card.pack(fill="x", padx=6, pady=6)
        card.pack_propagate(False)

        ctk.CTkLabel(
            card, text=f"☁️  {caption or 'Drive Photo'}",
            font=theme.font(12), text_color=theme.TEXT_LIGHT,
        ).pack(side="left", padx=12, pady=8)

        if drive_url:
            ctk.CTkButton(
                card, text="Open →", width=60, height=26,
                fg_color="#1976D2", hover_color="#1565C0",
                corner_radius=4, font=theme.font(10),
                command=lambda: self._open_drive(drive_url),
            ).pack(side="right", padx=8)

    def _download_and_display(self, file_id, drive_url, frame, placeholder):
        """Download thumbnail from Drive in background, cache it, and update UI."""
        try:
            import urllib.request

            cache_path = CACHE_DIR / f"{file_id}.jpg"
            thumb_url = f"https://drive.google.com/thumbnail?id={file_id}&sz=w400"

            req = urllib.request.Request(thumb_url, headers={
                "User-Agent": "Mozilla/5.0 GGM-Hub/3.0"
            })
            with urllib.request.urlopen(req, timeout=10) as resp:
                with open(str(cache_path), "wb") as f:
                    f.write(resp.read())

            if HAS_PIL and self.winfo_exists():
                img = Image.open(str(cache_path))
                img.thumbnail(self.THUMB_SIZE, Image.LANCZOS)
                img.save(str(cache_path), "JPEG", quality=85)
                tk_img = ImageTk.PhotoImage(img)
                self._thumb_refs.append(tk_img)

                def update_ui():
                    if placeholder.winfo_exists():
                        placeholder.configure(image=tk_img, text="")
                        placeholder.configure(height=self.THUMB_SIZE[1])
                        placeholder.bind("<Button-1>",
                                         lambda e, u=drive_url: self._open_drive(u))

                self.after(0, update_ui)

        except Exception as e:
            log.debug(f"Thumb download failed for {file_id}: {e}")
            if self.winfo_exists():
                self.after(0, lambda: (
                    placeholder.configure(text="📷 Click 'View' to see photo")
                    if placeholder.winfo_exists() else None
                ))

    # ------------------------------------------------------------------
    # Actions
    # ------------------------------------------------------------------
    def _delete_photo(self, photo_id: int, filename: str, client_id):
        """Delete a local photo file and its DB record."""
        try:
            cid = str(client_id or "unknown")
            job_ref = self.job_ref or "general"
            # Try job_ref subfolder first, then flat legacy folder
            filepath = config.PHOTOS_DIR / cid / job_ref / filename
            if not filepath.exists():
                filepath = config.PHOTOS_DIR / cid / filename
            if filepath.exists():
                filepath.unlink()
        except Exception as e:
            log.warning(f"Could not delete file: {e}")

        self.db.delete_photo(photo_id)
        self._load_photos()

    def _open_full(self, filepath: str):
        """Open the full-size local photo with the system viewer."""
        try:
            os.startfile(filepath)
        except Exception:
            import webbrowser
            webbrowser.open(filepath)

    def _open_drive(self, url: str):
        """Open a Drive photo URL in the browser."""
        import webbrowser
        if url:
            webbrowser.open(url)
