"""
GGM Hub — Photo Storage Service
Manages before/after job photos on the dedicated E: drive SSD.

Directory structure on E:\\GGM-Photos:
    jobs/
        {client_id}/
            {job_ref}/
                before_20260214_143022_a1b2c3d4.jpg
                after_20260214_160530_e5f6g7h8.jpg
    thumbnails/
        {client_id}/
            {job_ref}/
                thumb_before_20260214_143022_a1b2c3d4.jpg
    uploads/         — staging area for incoming photos
    archive/         — old/completed job photos (optional cleanup)
"""

import logging
import os
import shutil
import uuid
from datetime import datetime
from pathlib import Path
from typing import Optional

from . import config

log = logging.getLogger("ggm.photos")

# Thumbnail size
THUMB_MAX_WIDTH = 400
THUMB_MAX_HEIGHT = 300
THUMB_QUALITY = 80

# Max photo dimensions (resize on import to save space)
MAX_PHOTO_WIDTH = 2400
MAX_PHOTO_QUALITY = 85

# Allowed extensions
ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".webp", ".avif", ".heic"}

try:
    from PIL import Image
    HAS_PIL = True
except ImportError:
    HAS_PIL = False
    log.warning("Pillow not installed — photos will not be resized or thumbnailed")


class PhotoStorageService:
    """
    Manages photo storage, organisation, thumbnailing, and cleanup.
    All photos are stored on the dedicated SSD (E:\\GGM-Photos by default).
    """

    def __init__(self, db, api=None):
        self.db = db
        self.api = api
        self.photos_dir = config.PHOTOS_DIR
        self.thumbs_dir = config.PHOTOS_THUMBNAILS_DIR
        self.uploads_dir = config.PHOTOS_UPLOADS_DIR

        log.info(f"Photo storage: {self.photos_dir}")
        log.info(f"Thumbnails:    {self.thumbs_dir}")

        # Report drive space
        self._log_drive_space()

    def _log_drive_space(self):
        """Log available space on the photos drive."""
        try:
            drive = str(self.photos_dir)[:3]  # e.g. "E:\"
            usage = shutil.disk_usage(drive)
            free_gb = usage.free / (1024 ** 3)
            total_gb = usage.total / (1024 ** 3)
            log.info(f"Photo drive {drive} — {free_gb:.1f} GB free / {total_gb:.1f} GB total")
        except Exception as e:
            log.warning(f"Could not check drive space: {e}")

    # ------------------------------------------------------------------
    # Photo Import
    # ------------------------------------------------------------------

    def import_photo(
        self,
        source_path: str,
        client_id: int,
        client_name: str,
        job_date: str,
        photo_type: str = "before",
        job_number: str = "",
        caption: str = "",
    ) -> Optional[dict]:
        """
        Import a photo from source_path into the organised storage.
        Resizes if too large, generates a thumbnail, saves to DB.

        Returns dict with photo info or None on failure.
        """
        src = Path(source_path)
        if not src.exists():
            log.error(f"Photo source not found: {source_path}")
            return None

        ext = src.suffix.lower()
        if ext not in ALLOWED_EXTENSIONS:
            log.warning(f"Unsupported photo format: {ext}")
            return None

        # Generate unique filename
        uid = uuid.uuid4().hex[:8]
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"{photo_type}_{ts}_{uid}{ext if ext != '.heic' else '.jpg'}"

        # Build destination path: jobs/{client_id}/{job_ref}/
        job_ref = job_number or job_date or "unsorted"
        dest_dir = self.photos_dir / str(client_id) / job_ref
        dest_dir.mkdir(parents=True, exist_ok=True)
        dest = dest_dir / filename

        try:
            if HAS_PIL and ext in {".jpg", ".jpeg", ".png", ".bmp", ".webp", ".heic"}:
                img = Image.open(str(src))

                # Auto-orient using EXIF data
                try:
                    from PIL import ImageOps
                    img = ImageOps.exif_transpose(img)
                except Exception:
                    pass

                # Convert HEIC to JPEG
                if ext == ".heic":
                    img = img.convert("RGB")

                # Resize if too large
                if img.width > MAX_PHOTO_WIDTH:
                    ratio = MAX_PHOTO_WIDTH / img.width
                    new_h = int(img.height * ratio)
                    img = img.resize((MAX_PHOTO_WIDTH, new_h), Image.LANCZOS)
                    log.info(f"Resized {src.name}: {img.width}x{img.height}")

                # Save optimised
                save_format = "JPEG" if ext in {".jpg", ".jpeg", ".heic"} else None
                img.save(str(dest), format=save_format, quality=MAX_PHOTO_QUALITY, optimize=True)
            else:
                shutil.copy2(str(src), str(dest))

            file_size = dest.stat().st_size

            # Generate thumbnail
            thumb_path = self._generate_thumbnail(dest, client_id, job_ref)

            # Save to database
            photo_id = self.db.save_photo(
                client_id=client_id,
                client_name=client_name,
                job_date=job_date,
                photo_type=photo_type,
                filename=filename,
                caption=caption,
            )

            # Update job_number if present
            if job_number and photo_id:
                try:
                    self.db.execute(
                        "UPDATE job_photos SET job_number = ? WHERE id = ?",
                        (job_number, photo_id),
                    )
                except Exception:
                    pass

            log.info(
                f"Photo imported: {filename} "
                f"({file_size / 1024:.0f} KB) "
                f"→ {dest_dir}"
            )

            return {
                "id": photo_id,
                "filename": filename,
                "path": str(dest),
                "thumbnail": str(thumb_path) if thumb_path else None,
                "photo_type": photo_type,
                "size_bytes": file_size,
                "client_id": client_id,
                "job_number": job_number,
            }

        except Exception as e:
            log.error(f"Failed to import photo {src.name}: {e}")
            # Clean up partial file
            if dest.exists():
                dest.unlink()
            return None

    # ------------------------------------------------------------------
    # Import from base64 (mobile uploads)
    # ------------------------------------------------------------------

    def import_from_base64(
        self,
        base64_data: str,
        client_id: int,
        client_name: str,
        job_date: str,
        photo_type: str = "before",
        job_number: str = "",
        caption: str = "",
        original_filename: str = "",
    ) -> Optional[dict]:
        """
        Import a photo from base64-encoded data directly to E: drive storage.
        Used for mobile app uploads that arrive via the sync pipeline.
        """
        import base64
        import tempfile

        try:
            # Decode base64 to a temp file, then import via normal pipeline
            photo_bytes = base64.b64decode(base64_data)
            ext = ".jpg"
            if original_filename:
                ext = Path(original_filename).suffix.lower() or ".jpg"

            with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
                tmp.write(photo_bytes)
                tmp_path = tmp.name

            result = self.import_photo(
                source_path=tmp_path,
                client_id=client_id,
                client_name=client_name,
                job_date=job_date,
                photo_type=photo_type,
                job_number=job_number,
                caption=caption,
            )

            # Clean up temp file
            try:
                Path(tmp_path).unlink()
            except Exception:
                pass

            return result

        except Exception as e:
            log.error(f"Failed to import base64 photo: {e}")
            return None

    # ------------------------------------------------------------------
    # Thumbnails
    # ------------------------------------------------------------------

    def _generate_thumbnail(self, source: Path, client_id: int, job_ref: str) -> Optional[Path]:
        """Generate a thumbnail for a photo."""
        if not HAS_PIL:
            return None

        try:
            thumb_dir = self.thumbs_dir / str(client_id) / job_ref
            thumb_dir.mkdir(parents=True, exist_ok=True)
            thumb_path = thumb_dir / f"thumb_{source.stem}.jpg"

            img = Image.open(str(source))
            img.thumbnail((THUMB_MAX_WIDTH, THUMB_MAX_HEIGHT), Image.LANCZOS)

            # Always save thumbnails as JPEG
            if img.mode in ("RGBA", "P"):
                img = img.convert("RGB")

            img.save(str(thumb_path), "JPEG", quality=THUMB_QUALITY, optimize=True)
            return thumb_path

        except Exception as e:
            log.warning(f"Thumbnail generation failed: {e}")
            return None

    def get_thumbnail_path(self, client_id: int, job_ref: str, filename: str) -> Optional[Path]:
        """Get the path to a photo's thumbnail if it exists."""
        stem = Path(filename).stem
        thumb = self.thumbs_dir / str(client_id) / job_ref / f"thumb_{stem}.jpg"
        return thumb if thumb.exists() else None

    def regenerate_thumbnails(self, client_id: int = None) -> int:
        """Regenerate thumbnails for all photos (or for a specific client)."""
        count = 0
        search_dir = self.photos_dir / str(client_id) if client_id else self.photos_dir

        if not search_dir.exists():
            return 0

        for photo_file in search_dir.rglob("*"):
            if photo_file.suffix.lower() in ALLOWED_EXTENSIONS and not photo_file.name.startswith("thumb_"):
                # Derive client_id and job_ref from path
                parts = photo_file.relative_to(self.photos_dir).parts
                if len(parts) >= 2:
                    cid = parts[0]
                    jref = parts[1]
                    result = self._generate_thumbnail(photo_file, cid, jref)
                    if result:
                        count += 1

        log.info(f"Regenerated {count} thumbnails")
        return count

    # ------------------------------------------------------------------
    # Photo Retrieval
    # ------------------------------------------------------------------

    def get_job_photos(self, client_id: int, job_ref: str = None) -> list:
        """
        Get all photos for a client/job, combining DB records with filesystem.
        Returns list of dicts with path, thumbnail, type, etc.
        """
        photos = self.db.get_all_photos_for_display(
            client_id=client_id,
            job_number=job_ref,
        )

        # Enrich with filesystem paths and thumbnails
        for photo in photos:
            filename = photo.get("filename", "")
            job_number = photo.get("job_number", "") or photo.get("job_date", "")
            cid = str(photo.get("client_id", client_id))

            # Full photo path
            full_path = self.photos_dir / cid / job_number / filename
            if not full_path.exists():
                # Try direct client folder (old structure)
                full_path = self.photos_dir / cid / filename

            photo["full_path"] = str(full_path) if full_path.exists() else None

            # Thumbnail path
            thumb = self.get_thumbnail_path(cid, job_number, filename)
            photo["thumbnail_path"] = str(thumb) if thumb else None

        return photos

    def get_before_after_pairs(self, client_id: int, job_ref: str) -> dict:
        """
        Get before/after photo pairs for a specific job.
        Returns { 'before': [...], 'after': [...], 'other': [...] }
        """
        photos = self.get_job_photos(client_id, job_ref)
        result = {"before": [], "after": [], "other": []}

        for p in photos:
            ptype = p.get("photo_type", "other")
            if ptype in result:
                result[ptype].append(p)
            else:
                result["other"].append(p)

        return result

    # ------------------------------------------------------------------
    # Cleanup & Maintenance
    # ------------------------------------------------------------------

    def get_storage_stats(self) -> dict:
        """Get storage statistics for the photo drive."""
        stats = {
            "photos_dir": str(self.photos_dir),
            "total_photos": 0,
            "total_size_mb": 0,
            "total_thumbnails": 0,
            "clients_with_photos": 0,
            "drive_free_gb": 0,
            "drive_total_gb": 0,
        }

        try:
            # Count photos
            if self.photos_dir.exists():
                photo_files = list(self.photos_dir.rglob("*"))
                photo_files = [f for f in photo_files if f.is_file() and f.suffix.lower() in ALLOWED_EXTENSIONS]
                stats["total_photos"] = len(photo_files)
                stats["total_size_mb"] = round(sum(f.stat().st_size for f in photo_files) / (1024 * 1024), 1)

                # Count unique client dirs
                client_dirs = set()
                for f in photo_files:
                    rel = f.relative_to(self.photos_dir)
                    if len(rel.parts) >= 1:
                        client_dirs.add(rel.parts[0])
                stats["clients_with_photos"] = len(client_dirs)

            # Count thumbnails
            if self.thumbs_dir.exists():
                thumb_files = list(self.thumbs_dir.rglob("*.jpg"))
                stats["total_thumbnails"] = len(thumb_files)

            # Drive space
            drive = str(self.photos_dir)[:3]
            usage = shutil.disk_usage(drive)
            stats["drive_free_gb"] = round(usage.free / (1024 ** 3), 1)
            stats["drive_total_gb"] = round(usage.total / (1024 ** 3), 1)

        except Exception as e:
            log.error(f"Storage stats error: {e}")

        return stats

    def cleanup_orphaned_files(self, dry_run: bool = True) -> list:
        """
        Find photo files on disk that have no matching DB record.
        If dry_run=False, deletes them.
        """
        orphans = []

        if not self.photos_dir.exists():
            return orphans

        # Get all DB filenames
        try:
            rows = self.db.fetch_all("SELECT filename FROM job_photos")
            db_filenames = {r["filename"] for r in rows}
        except Exception:
            db_filenames = set()

        # Scan filesystem
        for photo_file in self.photos_dir.rglob("*"):
            if photo_file.is_file() and photo_file.suffix.lower() in ALLOWED_EXTENSIONS:
                if photo_file.name not in db_filenames:
                    orphans.append(str(photo_file))
                    if not dry_run:
                        try:
                            photo_file.unlink()
                            log.info(f"Deleted orphan: {photo_file}")
                        except Exception as e:
                            log.warning(f"Could not delete orphan {photo_file}: {e}")

        if orphans:
            log.info(f"Found {len(orphans)} orphaned photo files {'(dry run)' if dry_run else '(deleted)'}")

        return orphans

    def archive_old_photos(self, days_old: int = 365, dry_run: bool = True) -> list:
        """
        Move photos older than `days_old` to the archive folder.
        """
        from datetime import timedelta

        archive_dir = self.photos_dir.parent / "archive"
        archive_dir.mkdir(parents=True, exist_ok=True)
        cutoff = datetime.now() - timedelta(days=days_old)
        archived = []

        try:
            rows = self.db.fetch_all(
                "SELECT id, client_id, job_number, job_date, filename FROM job_photos WHERE job_date < ?",
                (cutoff.strftime("%Y-%m-%d"),),
            )
        except Exception:
            rows = []

        for row in rows:
            cid = str(row["client_id"])
            jref = row.get("job_number") or row.get("job_date", "")
            filename = row["filename"]
            src = self.photos_dir / cid / jref / filename

            if src.exists():
                dest_dir = archive_dir / cid / jref
                dest_dir.mkdir(parents=True, exist_ok=True)
                dest = dest_dir / filename
                archived.append(str(src))

                if not dry_run:
                    shutil.move(str(src), str(dest))
                    log.info(f"Archived: {src} → {dest}")

        if archived:
            log.info(f"{'Would archive' if dry_run else 'Archived'} {len(archived)} old photos")

        return archived

    # ------------------------------------------------------------------
    # Process Uploads
    # ------------------------------------------------------------------

    def process_uploads(self) -> int:
        """
        Process photos dropped into the uploads/ staging folder.
        Expects filenames like: {client_id}_before_description.jpg
        or just moves them to an 'unsorted' folder.
        Returns count of processed photos.
        """
        if not self.uploads_dir.exists():
            return 0

        count = 0
        for f in self.uploads_dir.iterdir():
            if not f.is_file() or f.suffix.lower() not in ALLOWED_EXTENSIONS:
                continue

            # Try to parse filename: {client_id}_{type}_{rest}.ext
            parts = f.stem.split("_", 2)
            if len(parts) >= 2 and parts[0].isdigit():
                client_id = int(parts[0])
                photo_type = parts[1] if parts[1] in ("before", "after") else "before"
                caption = parts[2] if len(parts) > 2 else ""

                result = self.import_photo(
                    source_path=str(f),
                    client_id=client_id,
                    client_name="",  # Will be looked up later
                    job_date=datetime.now().strftime("%Y-%m-%d"),
                    photo_type=photo_type,
                    caption=caption,
                )

                if result:
                    f.unlink()  # Remove from uploads after successful import
                    count += 1
            else:
                # Move to unsorted
                unsorted = self.photos_dir / "unsorted"
                unsorted.mkdir(parents=True, exist_ok=True)
                shutil.move(str(f), str(unsorted / f.name))
                count += 1

        if count:
            log.info(f"Processed {count} uploads")

        return count
