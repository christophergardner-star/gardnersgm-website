"""
Sync engine for GGM Hub.
Runs in a background thread, pulling data from Google Sheets into SQLite
and pushing local changes back. Provides offline-first operation.
"""

import queue
import threading
import time
import logging
from datetime import datetime
from typing import Callable, Optional

from .api import APIClient, APIError
from .database import Database
from . import config

log = logging.getLogger("ggm.sync")


class SyncEvent:
    """Events emitted by the sync engine for the UI to consume."""
    SYNC_STARTED = "sync_started"
    SYNC_PROGRESS = "sync_progress"        # (table_name, count)
    SYNC_COMPLETE = "sync_complete"
    SYNC_ERROR = "sync_error"              # (error_message)
    TABLE_UPDATED = "table_updated"        # (table_name)
    WRITE_SYNCED = "write_synced"          # (action)
    ONLINE_STATUS = "online_status"        # (bool)
    NEW_RECORDS = "new_records"            # (table_name, new_items_list)


class SyncEngine:
    """
    Background sync engine.

    - On startup: full pull from Google Sheets → SQLite
    - On local change: queues a push to Sheets
    - Every N minutes: incremental sync
    - Emits events to a queue that the UI polls
    """

    def __init__(self, db: Database, api: APIClient):
        self.db = db
        self.api = api
        self.event_queue: queue.Queue = queue.Queue()
        self.write_queue: queue.Queue = queue.Queue()
        self._running = False
        self._thread: Optional[threading.Thread] = None
        self._online = False
        self._last_full_sync: Optional[str] = None
        self._sync_lock = threading.Lock()

    # ------------------------------------------------------------------
    # Public interface
    # ------------------------------------------------------------------
    def start(self):
        """Start the background sync thread."""
        self._running = True
        self._thread = threading.Thread(target=self._run_loop, daemon=True, name="SyncEngine")
        self._thread.start()
        log.info("Sync engine started")

    def stop(self):
        """Stop the sync thread."""
        self._running = False
        if self._thread:
            self._thread.join(timeout=5)
        log.info("Sync engine stopped")

    def queue_write(self, action: str, data: dict):
        """Queue a write operation to be pushed to Sheets."""
        self.write_queue.put((action, data))
        log.debug(f"Queued write: {action}")

    def force_sync(self):
        """Trigger an immediate full sync (called from UI)."""
        threading.Thread(target=self._full_sync, daemon=True, name="ForceSync").start()

    @property
    def is_online(self) -> bool:
        return self._online

    @property
    def last_sync_time(self) -> Optional[str]:
        return self._last_full_sync

    def get_events(self) -> list[tuple]:
        """Drain the event queue. Called by the UI on a timer."""
        events = []
        while not self.event_queue.empty():
            try:
                events.append(self.event_queue.get_nowait())
            except queue.Empty:
                break
        return events

    # ------------------------------------------------------------------
    # Background loop
    # ------------------------------------------------------------------
    def _run_loop(self):
        """Main background loop."""
        # Initial full sync
        self._full_sync()

        # Then loop: process writes + periodic sync
        sync_counter = 0
        while self._running:
            # Process pending writes
            self._process_writes()

            # Every N seconds, do an incremental sync
            sync_counter += 1
            if sync_counter >= config.SYNC_INTERVAL_SECONDS:
                self._full_sync()
                sync_counter = 0

            time.sleep(1)

    # ------------------------------------------------------------------
    # Full sync (pull all data from Sheets)
    # ------------------------------------------------------------------
    def _full_sync(self):
        """Pull all data from Google Sheets into SQLite."""
        if not self._sync_lock.acquire(blocking=False):
            return  # Already syncing

        try:
            self._emit(SyncEvent.SYNC_STARTED, None)
            log.info("Starting full sync...")

            # Check connectivity
            try:
                self.api.get("sheet_tabs")
                self._online = True
                self._emit(SyncEvent.ONLINE_STATUS, True)
            except Exception:
                self._online = False
                self._emit(SyncEvent.ONLINE_STATUS, False)
                self._emit(SyncEvent.SYNC_ERROR, "No internet connection — working offline")
                log.warning("Offline — skipping sync")
                return

            # Sync each data source
            self._sync_clients()
            self._sync_invoices()
            self._sync_quotes()
            self._sync_schedule()
            self._sync_enquiries()
            self._sync_savings_pots()
            self._sync_business_costs()
            self._sync_blog_posts()
            self._sync_job_photos()
            self._sync_site_analytics()
            self._sync_business_recommendations()
            self._sync_subscribers()

            # Rebuild search index
            self.db.rebuild_search_index()

            # Record sync time
            now = datetime.now().isoformat()
            self._last_full_sync = now
            self.db.set_setting("last_full_sync", now)

            self._emit(SyncEvent.SYNC_COMPLETE, None)
            log.info("Full sync complete")

        except Exception as e:
            self._emit(SyncEvent.SYNC_ERROR, str(e))
            log.error(f"Sync error: {e}")

        finally:
            self._sync_lock.release()

    # ------------------------------------------------------------------
    # Individual table sync methods
    # ------------------------------------------------------------------
    def _sync_clients(self):
        """Pull clients from Sheets 'get_clients' action."""
        try:
            self._emit(SyncEvent.SYNC_PROGRESS, ("clients", 0))

            # Snapshot existing client names before sync for new-record detection
            existing = set()
            try:
                for c in self.db.fetchall("SELECT name FROM clients"):
                    if c.get("name"):
                        existing.add(c["name"].strip().lower())
            except Exception:
                pass

            data = self.api.get("get_clients")

            # The response format depends on Code.gs implementation
            # Usually: { clients: [...] } or just [...]
            clients_raw = data if isinstance(data, list) else data.get("clients", data.get("data", []))

            if not isinstance(clients_raw, list):
                log.warning(f"Unexpected clients response type: {type(clients_raw)}")
                return

            rows = []
            for i, c in enumerate(clients_raw):
                rows.append(self._map_client_from_sheets(c, i + 2))  # row 2+ (header is row 1)

            self.db.upsert_clients(rows)
            self.db.log_sync("clients", "pull", len(rows))
            self._emit(SyncEvent.SYNC_PROGRESS, ("clients", len(rows)))
            self._emit(SyncEvent.TABLE_UPDATED, "clients")

            # Detect new bookings/clients that weren't in the DB before
            new_items = []
            for r in rows:
                name = (r.get("name") or "").strip().lower()
                if name and name not in existing:
                    new_items.append(r)
            if new_items:
                self._emit(SyncEvent.NEW_RECORDS, ("clients", new_items))

            log.info(f"Synced {len(rows)} clients")

        except Exception as e:
            self.db.log_sync("clients", "pull", 0, "error", str(e))
            log.error(f"Client sync failed: {e}")

    def _sync_invoices(self):
        try:
            self._emit(SyncEvent.SYNC_PROGRESS, ("invoices", 0))
            data = self.api.get("get_invoices")
            invoices_raw = data if isinstance(data, list) else data.get("invoices", data.get("data", []))

            if not isinstance(invoices_raw, list):
                return

            rows = []
            for i, inv in enumerate(invoices_raw):
                rows.append(self._map_invoice_from_sheets(inv, i + 2))

            self.db.upsert_invoices(rows)
            self.db.log_sync("invoices", "pull", len(rows))
            self._emit(SyncEvent.TABLE_UPDATED, "invoices")
            log.info(f"Synced {len(rows)} invoices")

        except Exception as e:
            self.db.log_sync("invoices", "pull", 0, "error", str(e))
            log.error(f"Invoice sync failed: {e}")

    def _sync_quotes(self):
        try:
            self._emit(SyncEvent.SYNC_PROGRESS, ("quotes", 0))
            data = self.api.get("get_quotes")
            quotes_raw = data if isinstance(data, list) else data.get("quotes", data.get("data", []))

            if not isinstance(quotes_raw, list):
                return

            rows = []
            for i, q in enumerate(quotes_raw):
                rows.append(self._map_quote_from_sheets(q, i + 2))

            self.db.upsert_quotes(rows)
            self.db.log_sync("quotes", "pull", len(rows))
            self._emit(SyncEvent.TABLE_UPDATED, "quotes")
            log.info(f"Synced {len(rows)} quotes")

        except Exception as e:
            self.db.log_sync("quotes", "pull", 0, "error", str(e))
            log.error(f"Quote sync failed: {e}")

    def _sync_schedule(self):
        try:
            self._emit(SyncEvent.SYNC_PROGRESS, ("schedule", 0))
            # Use get_subscription_schedule which reads from the Schedule sheet
            # (get_schedule requires a date param and only returns Jobs for that date)
            data = self.api.get("get_subscription_schedule", {"days": "365"})
            schedule_raw = data if isinstance(data, list) else data.get(
                "visits", data.get("schedule", data.get("data", []))
            )

            if not isinstance(schedule_raw, list):
                return

            rows = []
            for i, s in enumerate(schedule_raw):
                rows.append({
                    "sheets_row": s.get("rowIndex", i + 2),
                    "client_name": str(s.get("name", s.get("clientName", s.get("client", "")))),
                    "service": str(s.get("service", "")),
                    "date": str(s.get("visitDate", s.get("date", ""))),
                    "time": str(s.get("time", "")),
                    "postcode": str(s.get("postcode", "")),
                    "address": str(s.get("address", "")),
                    "phone": str(s.get("phone", "")),
                    "status": str(s.get("status", "Scheduled")),
                    "notes": str(s.get("notes", "")),
                })

            self.db.upsert_schedule(rows)
            self.db.log_sync("schedule", "pull", len(rows))
            self._emit(SyncEvent.TABLE_UPDATED, "schedule")
            log.info(f"Synced {len(rows)} schedule entries")

        except Exception as e:
            self.db.log_sync("schedule", "pull", 0, "error", str(e))
            log.error(f"Schedule sync failed: {e}")

    def _sync_enquiries(self):
        try:
            # Snapshot existing enquiry names for new-record detection
            existing_enquiries = set()
            try:
                for eq in self.db.fetchall("SELECT name, date FROM enquiries"):
                    key = f"{(eq.get('name') or '').strip().lower()}|{eq.get('date', '')}"
                    existing_enquiries.add(key)
            except Exception:
                pass

            data = self.api.get("get_enquiries")
            enquiries_raw = data if isinstance(data, list) else data.get("enquiries", data.get("data", []))

            if not isinstance(enquiries_raw, list):
                return

            rows = []
            for i, e in enumerate(enquiries_raw):
                rows.append({
                    "sheets_row": i + 2,
                    "name": str(e.get("name", "")),
                    "email": str(e.get("email", "")),
                    "phone": str(e.get("phone", "")),
                    "message": str(e.get("message", e.get("description", e.get("enquiry", "")))),
                    "type": str(e.get("type", "General")),
                    "status": str(e.get("status", "New")),
                    "date": str(e.get("date", e.get("timestamp", ""))),
                    "replied": str(e.get("replied", "No")),
                    "notes": str(e.get("notes", "")),
                })

            self.db.upsert_enquiries(rows)
            self.db.log_sync("enquiries", "pull", len(rows))
            self._emit(SyncEvent.TABLE_UPDATED, "enquiries")

            # Detect new enquiries
            new_enquiries = []
            for r in rows:
                key = f"{(r.get('name') or '').strip().lower()}|{r.get('date', '')}"
                if key not in existing_enquiries:
                    new_enquiries.append(r)
            if new_enquiries:
                self._emit(SyncEvent.NEW_RECORDS, ("enquiries", new_enquiries))

        except Exception as e:
            self.db.log_sync("enquiries", "pull", 0, "error", str(e))
            log.error(f"Enquiry sync failed: {e}")

    def _sync_savings_pots(self):
        try:
            data = self.api.get("get_savings_pots")
            pots_raw = data if isinstance(data, list) else data.get("pots", data.get("data", []))

            if not isinstance(pots_raw, list):
                return

            rows = []
            for p in pots_raw:
                rows.append({
                    "name": str(p.get("name", p.get("pot", ""))),
                    "balance": self._safe_float(p.get("currentBalance", p.get("balance", 0))),
                    "target": self._safe_float(p.get("targetBalance", p.get("target", 0))),
                })

            self.db.upsert_savings_pots(rows)
            self.db.log_sync("savings_pots", "pull", len(rows))
            self._emit(SyncEvent.TABLE_UPDATED, "savings_pots")

        except Exception as e:
            self.db.log_sync("savings_pots", "pull", 0, "error", str(e))
            log.error(f"Savings pots sync failed: {e}")

    def _sync_business_costs(self):
        try:
            data = self.api.get("get_business_costs")
            costs_raw = data if isinstance(data, list) else data.get("costs", data.get("data", []))

            if not isinstance(costs_raw, list):
                return

            rows = []
            for i, c in enumerate(costs_raw):
                # Map GAS granular cost fields to Hub categories
                insurance = self._safe_float(c.get("insurance", 0)) or (
                    self._safe_float(c.get("vehicleInsurance", 0)) +
                    self._safe_float(c.get("publicLiability", 0))
                )
                vehicle = self._safe_float(c.get("vehicle", 0)) or self._safe_float(c.get("vehicleMaint", 0))
                tools = self._safe_float(c.get("tools", 0)) or self._safe_float(c.get("equipmentMaint", 0))
                fuel = self._safe_float(c.get("fuel", 0)) or self._safe_float(c.get("fuelRate", 0))
                phone = self._safe_float(c.get("phone", c.get("phone_cost", 0))) or self._safe_float(c.get("phoneInternet", 0))
                # Material-related costs — now stored in their own columns
                waste_disposal = self._safe_float(c.get("wasteDisposal", 0))
                treatment_products = self._safe_float(c.get("treatmentProducts", 0))
                consumables = self._safe_float(c.get("consumables", 0))
                other_val = self._safe_float(c.get("other", 0)) + (
                    self._safe_float(c.get("accountancy", 0)) +
                    self._safe_float(c.get("natInsurance", 0)) +
                    self._safe_float(c.get("incomeTax", 0))
                )
                rows.append({
                    "sheets_row": i + 2,
                    "month": str(c.get("month", "")),
                    "fuel": fuel,
                    "insurance": insurance,
                    "tools": tools,
                    "vehicle": vehicle,
                    "phone_cost": phone,
                    "software": self._safe_float(c.get("software", 0)),
                    "marketing": self._safe_float(c.get("marketing", 0)),
                    "waste_disposal": waste_disposal,
                    "treatment_products": treatment_products,
                    "consumables": consumables,
                    "other": other_val,
                    "total": self._safe_float(c.get("total", 0)),
                    "notes": str(c.get("notes", "")),
                })

            self.db.upsert_business_costs(rows)
            self.db.log_sync("business_costs", "pull", len(rows))
            self._emit(SyncEvent.TABLE_UPDATED, "business_costs")

        except Exception as e:
            self.db.log_sync("business_costs", "pull", 0, "error", str(e))
            log.error(f"Business costs sync failed: {e}")

    def _sync_blog_posts(self):
        """Pull blog posts from GAS and upsert into local DB."""
        try:
            data = self.api.get("get_all_blog_posts")
            posts_raw = data if isinstance(data, list) else data.get("posts", data.get("data", []))

            if not isinstance(posts_raw, list):
                return

            rows = []
            for p in posts_raw:
                rows.append({
                    "post_id": str(p.get("id", p.get("post_id", ""))),
                    "title": str(p.get("title", "")),
                    "category": str(p.get("category", "General")),
                    "author": str(p.get("author", "Chris")),
                    "excerpt": str(p.get("excerpt", "")),
                    "content": str(p.get("content", "")),
                    "status": str(p.get("status", "Draft")),
                    "tags": str(p.get("tags", "")),
                    "social_fb": str(p.get("social_fb", p.get("socialFb", ""))),
                    "social_ig": str(p.get("social_ig", p.get("socialIg", ""))),
                    "social_x": str(p.get("social_x", p.get("socialX", ""))),
                    "image_url": str(p.get("image_url", p.get("imageUrl", p.get("image", "")))),
                    "created_date": str(p.get("created_date", p.get("createdDate", p.get("date", "")))),
                    "published_at": str(p.get("published_at", p.get("publishedAt", ""))),
                })

            if rows:
                self.db.upsert_blog_posts(rows)
                self.db.log_sync("blog_posts", "pull", len(rows))
                self._emit(SyncEvent.TABLE_UPDATED, "blog_posts")
                log.info(f"Synced {len(rows)} blog posts")

        except Exception as e:
            self.db.log_sync("blog_posts", "pull", 0, "error", str(e))
            log.error(f"Blog posts sync failed: {e}")

    def _sync_job_photos(self):
        """Pull job photos metadata from the Job Photos sheet and
        download any new photos from Google Drive to the local E: drive."""
        try:
            data = self.api.get("get_all_job_photos")
            photos_raw = data if isinstance(data, list) else data.get("photos", data.get("data", []))

            if not isinstance(photos_raw, list):
                return

            rows = []
            for p in photos_raw:
                rows.append({
                    "job_number": str(p.get("jobNumber", "")),
                    "photo_type": str(p.get("type", "before")),
                    "drive_url": str(p.get("photoUrl", "")),
                    "drive_file_id": str(p.get("fileId", "")),
                    "telegram_file_id": str(p.get("telegramFileId", "")),
                    "filename": str(p.get("filename", "")),
                    "client_id": str(p.get("clientId", "")),
                    "client_name": str(p.get("clientName", "")),
                    "caption": str(p.get("caption", "")),
                    "created_at": str(p.get("uploaded", "")),
                    "source": str(p.get("source", "mobile")),
                })

            if rows:
                self.db.upsert_job_photos(rows)
                self.db.log_sync("job_photos", "pull", len(rows))
                self._emit(SyncEvent.TABLE_UPDATED, "job_photos")
                log.info(f"Synced {len(rows)} job photos metadata")

            # Download new photos from Google Drive to local E: storage
            self._download_drive_photos(rows)

        except Exception as e:
            self.db.log_sync("job_photos", "pull", 0, "error", str(e))
            log.error(f"Job photos sync failed: {e}")

    def _download_drive_photos(self, photos: list):
        """Download photo files from Google Drive to the local photos dir.
        Skips any photos that already exist locally."""
        import urllib.request
        from pathlib import Path

        photos_dir = config.PHOTOS_DIR
        if not photos_dir.exists():
            try:
                photos_dir.mkdir(parents=True, exist_ok=True)
            except Exception as e:
                log.warning(f"Cannot create photos dir {photos_dir}: {e}")
                return

        downloaded = 0
        for p in photos:
            drive_url = p.get("drive_url", "")
            file_id = p.get("drive_file_id", "")
            filename = p.get("filename", "")
            job_ref = p.get("job_number", "") or "unsorted"
            client_id = p.get("client_id", "") or "0"

            if not file_id or not filename:
                continue

            # Build local path: E:\GGM-Photos\jobs\{client_id}\{job_ref}\filename
            dest_dir = photos_dir / str(client_id) / job_ref
            dest_file = dest_dir / filename

            if dest_file.exists():
                continue  # Already downloaded

            try:
                dest_dir.mkdir(parents=True, exist_ok=True)
                url = f"https://drive.google.com/uc?id={file_id}&export=download"
                log.info(f"Downloading photo: {filename} → {dest_dir}")
                urllib.request.urlretrieve(url, str(dest_file))
                downloaded += 1

                # Generate thumbnail if photo_storage is available
                self._generate_photo_thumbnail(dest_file, client_id, job_ref)

            except Exception as e:
                log.warning(f"Failed to download photo {filename}: {e}")
                # Clean up partial download
                if dest_file.exists():
                    try:
                        dest_file.unlink()
                    except Exception:
                        pass

        if downloaded:
            log.info(f"Downloaded {downloaded} new photos from Google Drive to {photos_dir}")

    def _generate_photo_thumbnail(self, photo_path, client_id: str, job_ref: str):
        """Generate a thumbnail for a downloaded photo."""
        try:
            from PIL import Image
            thumb_dir = config.PHOTOS_THUMBNAILS_DIR / str(client_id) / job_ref
            thumb_dir.mkdir(parents=True, exist_ok=True)
            thumb_path = thumb_dir / f"thumb_{photo_path.stem}.jpg"

            img = Image.open(str(photo_path))
            img.thumbnail((400, 300), Image.LANCZOS)
            if img.mode in ("RGBA", "P"):
                img = img.convert("RGB")
            img.save(str(thumb_path), "JPEG", quality=80, optimize=True)
        except ImportError:
            pass  # Pillow not installed
        except Exception as e:
            log.debug(f"Thumbnail generation failed for {photo_path.name}: {e}")

    def _sync_site_analytics(self):
        """Pull site analytics summary from GAS."""
        try:
            data = self.api.get("get_site_analytics", {"days": "30"})
            if isinstance(data, dict) and data.get("status") == "success":
                # Store daily breakdown
                daily = data.get("daily", [])
                if daily:
                    self.db.upsert_site_analytics(daily)

                # Store full summary
                self.db.save_analytics_summary(data)
                self.db.log_sync("site_analytics", "pull", len(daily))
                self._emit(SyncEvent.TABLE_UPDATED, "site_analytics")
                log.info(f"Synced site analytics: {data.get('totalViews', 0)} views over {len(daily)} days")
        except Exception as e:
            self.db.log_sync("site_analytics", "pull", 0, "error", str(e))
            log.error(f"Site analytics sync failed: {e}")

    def _sync_business_recommendations(self):
        """Pull business recommendations from GAS."""
        try:
            data = self.api.get("get_business_recommendations", {"limit": "50"})
            if isinstance(data, dict) and data.get("status") == "success":
                recs = data.get("recommendations", [])
                if recs:
                    self.db.save_business_recommendations(recs)
                self.db.log_sync("business_recommendations", "pull", len(recs))
                self._emit(SyncEvent.TABLE_UPDATED, "business_recommendations")
                log.info(f"Synced business recommendations: {len(recs)}")
        except Exception as e:
            self.db.log_sync("business_recommendations", "pull", 0, "error", str(e))
            log.error(f"Business recommendations sync failed: {e}")

    def _sync_subscribers(self):
        """Pull newsletter subscribers from GAS."""
        try:
            data = self.api.get("get_subscribers")
            subs_raw = data if isinstance(data, list) else data.get("subscribers", data.get("data", []))

            if not isinstance(subs_raw, list):
                return

            rows = []
            for i, s in enumerate(subs_raw):
                rows.append({
                    "sheets_row": i + 2,
                    "email": str(s.get("email", "")),
                    "name": str(s.get("name", "")),
                    "date_subscribed": self._safe_date(s.get("date", s.get("date_subscribed", ""))),
                    "status": str(s.get("status", "Active")),
                    "tier": str(s.get("tier", s.get("source", "Free"))),
                })

            self.db.upsert_subscribers(rows)
            self.db.log_sync("subscribers", "pull", len(rows))
            self._emit(SyncEvent.TABLE_UPDATED, "subscribers")
            log.info(f"Synced {len(rows)} subscribers")

        except Exception as e:
            self.db.log_sync("subscribers", "pull", 0, "error", str(e))
            log.error(f"Subscriber sync failed: {e}")

    # ------------------------------------------------------------------
    # Push local changes to Sheets
    # ------------------------------------------------------------------
    def _process_writes(self):
        """Process any queued write operations."""
        while not self.write_queue.empty():
            try:
                action, data = self.write_queue.get_nowait()
                try:
                    self.api.post(action, data)
                    self._emit(SyncEvent.WRITE_SYNCED, action)
                    log.info(f"Write synced: {action}")
                except Exception as e:
                    # Re-queue for retry (with attempt limit)
                    attempts = data.get("_sync_attempts", 0) + 1
                    if attempts < 3:
                        data["_sync_attempts"] = attempts
                        self.write_queue.put((action, data))
                        log.warning(f"Write retry ({attempts}/3): {action} - {e}")
                    else:
                        log.error(f"Write failed after 3 attempts: {action} - {e}")
                        self._emit(SyncEvent.SYNC_ERROR, f"Failed to sync: {action}")
            except queue.Empty:
                break

        # Also push dirty records from SQLite
        self._push_dirty_clients()
        self._push_dirty_invoices()
        self._push_dirty_quotes()
        self._push_dirty_enquiries()

    def _push_dirty_clients(self):
        """Push locally-modified clients back to Sheets."""
        dirty = self.db.get_dirty_clients()
        if not dirty:
            return

        for client in dirty:
            try:
                if client.get("sheets_row"):
                    # Update existing row
                    self.api.post("update_client", {
                        "row": client["sheets_row"],
                        "name": client["name"],
                        "email": client["email"],
                        "phone": client["phone"],
                        "postcode": client["postcode"],
                        "address": client.get("address", ""),
                        "service": client["service"],
                        "price": client["price"],
                        "date": client["date"],
                        "time": client.get("time", ""),
                        "preferredDay": client.get("preferred_day", ""),
                        "frequency": client.get("frequency", ""),
                        "type": client["type"],
                        "status": client["status"],
                        "paid": client["paid"],
                        "notes": client.get("notes", ""),
                    })
                    self.db.mark_clients_synced([client["id"]])
                    log.info(f"Pushed client update: {client['name']}")
            except Exception as e:
                log.error(f"Failed to push client {client['name']}: {e}")

    def _push_dirty_invoices(self):
        """Push locally-modified invoices back to Sheets."""
        dirty = self.db.get_dirty_invoices()
        if not dirty:
            return
        for inv in dirty:
            try:
                self.api.post("update_invoice", {
                    "row": inv.get("sheets_row", ""),
                    "invoiceNumber": inv.get("invoice_number", ""),
                    "clientName": inv.get("client_name", ""),
                    "clientEmail": inv.get("client_email", ""),
                    "amount": inv.get("amount", 0),
                    "status": inv.get("status", ""),
                    "issueDate": inv.get("issue_date", ""),
                    "dueDate": inv.get("due_date", ""),
                    "paidDate": inv.get("paid_date", ""),
                    "notes": inv.get("notes", ""),
                })
                self.db.mark_invoices_synced([inv["id"]])
                log.info(f"Pushed invoice update: {inv.get('invoice_number', '')}")
            except Exception as e:
                log.error(f"Failed to push invoice {inv.get('invoice_number', '')}: {e}")

    def _push_dirty_quotes(self):
        """Push locally-modified quotes back to Sheets."""
        dirty = self.db.get_dirty_quotes()
        if not dirty:
            return
        for q in dirty:
            try:
                self.api.post("update_quote", {
                    "row": q.get("sheets_row", ""),
                    "quoteNumber": q.get("quote_number", ""),
                    "clientName": q.get("client_name", ""),
                    "clientEmail": q.get("client_email", ""),
                    "clientPhone": q.get("client_phone", ""),
                    "postcode": q.get("postcode", ""),
                    "address": q.get("address", ""),
                    "subtotal": q.get("subtotal", 0),
                    "discount": q.get("discount", 0),
                    "vat": q.get("vat", 0),
                    "total": q.get("total", 0),
                    "status": q.get("status", ""),
                    "dateCreated": q.get("date_created", ""),
                    "validUntil": q.get("valid_until", ""),
                    "depositRequired": q.get("deposit_required", 0),
                    "notes": q.get("notes", ""),
                })
                self.db.mark_quotes_synced([q["id"]])
                log.info(f"Pushed quote update: {q.get('quote_number', '')}")
            except Exception as e:
                log.error(f"Failed to push quote {q.get('quote_number', '')}: {e}")

    def _push_dirty_enquiries(self):
        """Push locally-modified enquiries back to Sheets."""
        dirty = self.db.get_dirty_enquiries()
        if not dirty:
            return
        for enq in dirty:
            try:
                self.api.post("update_enquiry", {
                    "row": enq.get("sheets_row", ""),
                    "name": enq.get("name", ""),
                    "email": enq.get("email", ""),
                    "phone": enq.get("phone", ""),
                    "message": enq.get("message", ""),
                    "type": enq.get("type", ""),
                    "status": enq.get("status", ""),
                    "date": enq.get("date", ""),
                    "replied": enq.get("replied", ""),
                    "notes": enq.get("notes", ""),
                })
                self.db.mark_enquiries_synced([enq["id"]])
                log.info(f"Pushed enquiry update: {enq.get('name', '')}")
            except Exception as e:
                log.error(f"Failed to push enquiry {enq.get('name', '')}: {e}")

    # ------------------------------------------------------------------
    # Data mapping helpers (Sheets → SQLite)
    # ------------------------------------------------------------------
    @staticmethod
    def _safe_float(val, default=0.0):
        """Safely convert a value to float, handling strings like 'Yes'."""
        if val is None or val == "":
            return default
        try:
            return float(val)
        except (ValueError, TypeError):
            return default

    @staticmethod
    def _safe_date(val) -> str:
        """Normalize a date value to YYYY-MM-DD format.

        Handles:
          - '2026-02-12T00:00:00.000Z'  (ISO from Sheets)
          - '2026-02-12T00:00:00'        (ISO without Z)
          - '12/02/2026'                 (DD/MM/YYYY UK)
          - '02/12/2026'                 (MM/DD/YYYY US)
          - '2026-02-12'                 (already correct)
          - ''                           (empty)
        """
        if not val or val == "None":
            return ""
        val = str(val).strip()
        # ISO timestamp — just take the date part
        if "T" in val:
            val = val.split("T")[0]
        # Already YYYY-MM-DD?
        if len(val) == 10 and val[4] == "-" and val[7] == "-":
            return val
        # Try DD/MM/YYYY or MM/DD/YYYY
        for fmt in ("%d/%m/%Y", "%m/%d/%Y", "%Y/%m/%d"):
            try:
                from datetime import datetime as _dt
                return _dt.strptime(val, fmt).strftime("%Y-%m-%d")
            except ValueError:
                continue
        # Last resort — return as-is
        return val

    def _map_client_from_sheets(self, c: dict, row_idx: int) -> dict:
        """Map a client record from Sheets format to SQLite format."""
        return {
            "sheets_row": row_idx,
            "job_number": str(c.get("jobNumber", c.get("job_number", c.get("Job Number", "")))),
            "name": str(c.get("name", c.get("Name", ""))),
            "email": str(c.get("email", c.get("Email", ""))),
            "phone": str(c.get("phone", c.get("Phone", ""))),
            "postcode": str(c.get("postcode", c.get("Postcode", ""))),
            "address": str(c.get("address", c.get("Address", ""))),
            "service": str(c.get("service", c.get("Service", ""))),
            "price": self._safe_float(c.get("price", c.get("Price", 0))),
            "date": self._safe_date(c.get("date", c.get("Date", c.get("preferredDate", "")))),
            "time": str(c.get("time", c.get("Time", ""))),
            "preferred_day": str(c.get("preferredDay", c.get("preferred_day", c.get("Preferred Day", "")))),
            "frequency": str(c.get("frequency", c.get("Frequency", "One-Off"))),
            "type": str(c.get("type", c.get("Type", "One-Off"))),
            "status": str(c.get("status", c.get("Status", "Pending"))),
            "paid": str(c.get("paid", c.get("Paid", "No"))),
            "stripe_customer_id": str(c.get("stripeCustomerId", c.get("stripe_customer_id", ""))),
            "stripe_subscription_id": str(c.get("stripeSubscriptionId", c.get("stripe_subscription_id", ""))),
            "notes": str(c.get("notes", c.get("Notes", ""))),
            "created_at": self._safe_date(c.get("timestamp", c.get("created_at", c.get("Timestamp", "")))),
        }

    def _map_invoice_from_sheets(self, inv: dict, row_idx: int) -> dict:
        """Map an invoice record from Sheets format to SQLite format."""
        return {
            "sheets_row": row_idx,
            "invoice_number": str(inv.get("invoiceNumber", inv.get("invoice_number", inv.get("number", "")))),
            "job_number": str(inv.get("jobNumber", inv.get("job_number", ""))),
            "client_name": str(inv.get("clientName", inv.get("client_name", inv.get("name", "")))),
            "client_email": str(inv.get("clientEmail", inv.get("client_email", inv.get("email", "")))),
            "amount": self._safe_float(inv.get("amount", inv.get("total", 0))),
            "status": str(inv.get("status", "Unpaid")),
            "stripe_invoice_id": str(inv.get("stripeInvoiceId", inv.get("stripe_invoice_id", ""))),
            "payment_url": str(inv.get("paymentUrl", inv.get("payment_url", ""))),
            "issue_date": self._safe_date(inv.get("dateIssued", inv.get("date", inv.get("issueDate", inv.get("issue_date", ""))))),
            "due_date": self._safe_date(inv.get("dueDate", inv.get("due_date", ""))),
            "paid_date": self._safe_date(inv.get("datePaid", inv.get("paidDate", inv.get("paid_date", "")))),
            "payment_method": str(inv.get("paymentMethod", inv.get("payment_method", ""))),
            "items": str(inv.get("items", "[]")),
            "notes": str(inv.get("notes", "")),
        }

    def _map_quote_from_sheets(self, q: dict, row_idx: int) -> dict:
        """Map a quote record from Sheets format to SQLite format."""
        return {
            "sheets_row": row_idx,
            "quote_number": str(q.get("quoteId", q.get("quoteNumber", q.get("quote_number", q.get("number", ""))))),
            "client_name": str(q.get("clientName", q.get("client_name", q.get("name", "")))),
            "client_email": str(q.get("clientEmail", q.get("client_email", q.get("email", "")))),
            "client_phone": str(q.get("clientPhone", q.get("phone", ""))),
            "postcode": str(q.get("postcode", "")),
            "address": str(q.get("address", "")),
            "items": str(q.get("items", "[]")),
            "subtotal": self._safe_float(q.get("subtotal", 0)),
            "discount": self._safe_float(q.get("discount", q.get("discountPct", q.get("discountAmt", 0)))),
            "vat": self._safe_float(q.get("vat", q.get("vatAmt", 0))),
            "total": self._safe_float(q.get("total", q.get("grandTotal", 0))),
            "status": str(q.get("status", "Draft")),
            "date_created": self._safe_date(q.get("created", q.get("dateCreated", q.get("date", "")))),
            "valid_until": self._safe_date(q.get("expiryDate", q.get("validUntil", q.get("valid_until", "")))),
            "deposit_required": self._safe_float(q.get("depositAmount", q.get("depositRequired", q.get("deposit", 0)))),
            "notes": str(q.get("notes", "")),
        }

    # ------------------------------------------------------------------
    # Event emitter
    # ------------------------------------------------------------------
    def _emit(self, event_type: str, data):
        """Put an event on the queue for the UI to consume."""
        self.event_queue.put((event_type, data))
