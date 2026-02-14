"""
SQLite database layer for GGM Hub.
Defines schema, migrations, and CRUD operations.
All data is stored locally for instant access; sync engine handles cloud updates.
"""

import sqlite3
import json
import logging
import shutil
from datetime import datetime, date, timedelta
from pathlib import Path
from typing import Optional

from . import config

log = logging.getLogger("ggm.db")

# ──────────────────────────────────────────────────────────────────
# Schema version — bump this when adding migrations
# ──────────────────────────────────────────────────────────────────
SCHEMA_VERSION = 1

SCHEMA_SQL = """
-- ─── Clients / Jobs (from Jobs sheet) ─────────────────────────
CREATE TABLE IF NOT EXISTS clients (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    sheets_row      INTEGER,
    job_number      TEXT,
    name            TEXT NOT NULL DEFAULT '',
    email           TEXT DEFAULT '',
    phone           TEXT DEFAULT '',
    postcode        TEXT DEFAULT '',
    address         TEXT DEFAULT '',
    service         TEXT DEFAULT '',
    price           REAL DEFAULT 0,
    date            TEXT DEFAULT '',
    time            TEXT DEFAULT '',
    preferred_day   TEXT DEFAULT '',
    frequency       TEXT DEFAULT 'One-Off',
    type            TEXT DEFAULT 'One-Off',
    status          TEXT DEFAULT 'Pending',
    paid            TEXT DEFAULT 'No',
    stripe_customer_id    TEXT DEFAULT '',
    stripe_subscription_id TEXT DEFAULT '',
    notes           TEXT DEFAULT '',
    created_at      TEXT DEFAULT '',
    updated_at      TEXT DEFAULT '',
    dirty           INTEGER DEFAULT 0,
    last_synced     TEXT DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_clients_name ON clients(name);
CREATE INDEX IF NOT EXISTS idx_clients_status ON clients(status);
CREATE INDEX IF NOT EXISTS idx_clients_service ON clients(service);
CREATE INDEX IF NOT EXISTS idx_clients_date ON clients(date);
CREATE INDEX IF NOT EXISTS idx_clients_email ON clients(email);

-- ─── Schedule ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS schedule (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    sheets_row      INTEGER,
    client_name     TEXT DEFAULT '',
    service         TEXT DEFAULT '',
    date            TEXT DEFAULT '',
    time            TEXT DEFAULT '',
    postcode        TEXT DEFAULT '',
    address         TEXT DEFAULT '',
    phone           TEXT DEFAULT '',
    status          TEXT DEFAULT 'Scheduled',
    notes           TEXT DEFAULT '',
    dirty           INTEGER DEFAULT 0,
    last_synced     TEXT DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_schedule_date ON schedule(date);

-- ─── Invoices ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS invoices (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    sheets_row      INTEGER,
    invoice_number  TEXT DEFAULT '',
    job_number      TEXT DEFAULT '',
    client_name     TEXT DEFAULT '',
    client_email    TEXT DEFAULT '',
    amount          REAL DEFAULT 0,
    status          TEXT DEFAULT 'Unpaid',
    stripe_invoice_id TEXT DEFAULT '',
    payment_url     TEXT DEFAULT '',
    issue_date      TEXT DEFAULT '',
    due_date        TEXT DEFAULT '',
    paid_date       TEXT DEFAULT '',
    payment_method  TEXT DEFAULT '',
    items           TEXT DEFAULT '[]',
    notes           TEXT DEFAULT '',
    dirty           INTEGER DEFAULT 0,
    last_synced     TEXT DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_date ON invoices(issue_date);

-- ─── Quotes ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS quotes (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    sheets_row      INTEGER,
    quote_number    TEXT DEFAULT '',
    client_name     TEXT DEFAULT '',
    client_email    TEXT DEFAULT '',
    client_phone    TEXT DEFAULT '',
    postcode        TEXT DEFAULT '',
    address         TEXT DEFAULT '',
    items           TEXT DEFAULT '[]',
    subtotal        REAL DEFAULT 0,
    discount        REAL DEFAULT 0,
    vat             REAL DEFAULT 0,
    total           REAL DEFAULT 0,
    status          TEXT DEFAULT 'Draft',
    date_created    TEXT DEFAULT '',
    valid_until     TEXT DEFAULT '',
    deposit_required REAL DEFAULT 0,
    notes           TEXT DEFAULT '',
    dirty           INTEGER DEFAULT 0,
    last_synced     TEXT DEFAULT ''
);

-- ─── Business Costs ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS business_costs (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    sheets_row      INTEGER,
    month           TEXT DEFAULT '',
    fuel            REAL DEFAULT 0,
    insurance       REAL DEFAULT 0,
    tools           REAL DEFAULT 0,
    vehicle         REAL DEFAULT 0,
    phone_cost      REAL DEFAULT 0,
    software        REAL DEFAULT 0,
    marketing       REAL DEFAULT 0,
    waste_disposal  REAL DEFAULT 0,
    treatment_products REAL DEFAULT 0,
    consumables     REAL DEFAULT 0,
    other           REAL DEFAULT 0,
    total           REAL DEFAULT 0,
    notes           TEXT DEFAULT '',
    dirty           INTEGER DEFAULT 0,
    last_synced     TEXT DEFAULT ''
);

-- ─── Savings Pots ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS savings_pots (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT UNIQUE NOT NULL,
    balance         REAL DEFAULT 0,
    target          REAL DEFAULT 0,
    updated_at      TEXT DEFAULT '',
    dirty           INTEGER DEFAULT 0,
    last_synced     TEXT DEFAULT ''
);

-- ─── Enquiries ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS enquiries (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    sheets_row      INTEGER,
    name            TEXT DEFAULT '',
    email           TEXT DEFAULT '',
    phone           TEXT DEFAULT '',
    message         TEXT DEFAULT '',
    type            TEXT DEFAULT 'General',
    status          TEXT DEFAULT 'New',
    date            TEXT DEFAULT '',
    replied         TEXT DEFAULT 'No',
    notes           TEXT DEFAULT '',
    dirty           INTEGER DEFAULT 0,
    last_synced     TEXT DEFAULT ''
);

-- ─── Subscribers ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS subscribers (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    sheets_row      INTEGER,
    email           TEXT DEFAULT '',
    name            TEXT DEFAULT '',
    date_subscribed TEXT DEFAULT '',
    status          TEXT DEFAULT 'Active',
    tier            TEXT DEFAULT 'Free',
    dirty           INTEGER DEFAULT 0,
    last_synced     TEXT DEFAULT ''
);

-- ─── Complaints ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS complaints (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    sheets_row      INTEGER,
    complaint_ref   TEXT DEFAULT '',
    name            TEXT DEFAULT '',
    email           TEXT DEFAULT '',
    phone           TEXT DEFAULT '',
    job_ref         TEXT DEFAULT '',
    service         TEXT DEFAULT '',
    service_date    TEXT DEFAULT '',
    amount_paid     REAL DEFAULT 0,
    complaint_type  TEXT DEFAULT 'One-Off',
    severity        TEXT DEFAULT 'Minor',
    status          TEXT DEFAULT 'Open',
    description     TEXT DEFAULT '',
    desired_resolution TEXT DEFAULT '',
    resolution_type TEXT DEFAULT '',
    resolution_notes TEXT DEFAULT '',
    resolved_date   TEXT DEFAULT '',
    admin_notes     TEXT DEFAULT '',
    created_at      TEXT DEFAULT '',
    dirty           INTEGER DEFAULT 0,
    last_synced     TEXT DEFAULT ''
);

-- ─── Vacancies ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vacancies (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    title           TEXT DEFAULT '',
    type            TEXT DEFAULT 'Full-time',
    location        TEXT DEFAULT 'Cornwall',
    salary          TEXT DEFAULT '',
    description     TEXT DEFAULT '',
    requirements    TEXT DEFAULT '',
    closing_date    TEXT DEFAULT '',
    status          TEXT DEFAULT 'Open',
    posted_date     TEXT DEFAULT '',
    dirty           INTEGER DEFAULT 0,
    last_synced     TEXT DEFAULT ''
);

-- ─── Applications ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS applications (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    vacancy_id      INTEGER,
    first_name      TEXT DEFAULT '',
    last_name       TEXT DEFAULT '',
    email           TEXT DEFAULT '',
    phone           TEXT DEFAULT '',
    postcode        TEXT DEFAULT '',
    dob             TEXT DEFAULT '',
    position        TEXT DEFAULT '',
    available_from  TEXT DEFAULT '',
    preferred_hours TEXT DEFAULT '',
    driving_licence TEXT DEFAULT '',
    own_transport   TEXT DEFAULT '',
    experience      TEXT DEFAULT '',
    qualifications  TEXT DEFAULT '',
    message         TEXT DEFAULT '',
    cv_file_id      TEXT DEFAULT '',
    cv_file_name    TEXT DEFAULT '',
    status          TEXT DEFAULT 'New',
    notes           TEXT DEFAULT '',
    created_at      TEXT DEFAULT '',
    dirty           INTEGER DEFAULT 0,
    last_synced     TEXT DEFAULT ''
);

-- ─── Products ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS products (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT DEFAULT '',
    description     TEXT DEFAULT '',
    price           INTEGER DEFAULT 0,
    category        TEXT DEFAULT '',
    stock           INTEGER DEFAULT 0,
    image_url       TEXT DEFAULT '',
    status          TEXT DEFAULT 'Active',
    dirty           INTEGER DEFAULT 0,
    last_synced     TEXT DEFAULT ''
);

-- ─── Orders ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS orders (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id        TEXT DEFAULT '',
    date            TEXT DEFAULT '',
    name            TEXT DEFAULT '',
    email           TEXT DEFAULT '',
    items           TEXT DEFAULT '[]',
    total           REAL DEFAULT 0,
    order_status    TEXT DEFAULT 'Processing',
    dirty           INTEGER DEFAULT 0,
    last_synced     TEXT DEFAULT ''
);

-- ─── Newsletter Log ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS newsletter_log (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    subject         TEXT DEFAULT '',
    target          TEXT DEFAULT 'All',
    sent_count      INTEGER DEFAULT 0,
    failed_count    INTEGER DEFAULT 0,
    sent_date       TEXT DEFAULT ''
);

-- ─── Telegram Log ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS telegram_log (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    message         TEXT DEFAULT '',
    sent_at         TEXT DEFAULT '',
    status          TEXT DEFAULT 'sent'
);

-- ─── Financial Dashboard (aggregated metrics) ──────────────────
CREATE TABLE IF NOT EXISTS financial_dashboard (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    metric_key      TEXT UNIQUE NOT NULL,
    metric_value    REAL DEFAULT 0,
    updated_at      TEXT DEFAULT ''
);

-- ─── Sync Log ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sync_log (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    table_name      TEXT NOT NULL,
    direction       TEXT NOT NULL DEFAULT 'pull',
    records_affected INTEGER DEFAULT 0,
    status          TEXT DEFAULT 'success',
    error_message   TEXT DEFAULT '',
    timestamp       TEXT DEFAULT ''
);

-- ─── App Settings ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app_settings (
    key             TEXT PRIMARY KEY,
    value           TEXT DEFAULT ''
);

-- ─── Full-Text Search ──────────────────────────────────────────
CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(
    source_table,
    source_id,
    name,
    email,
    details,
    tokenize = 'porter unicode61'
);

-- ─── Agent Schedules ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS agent_schedules (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_type      TEXT NOT NULL DEFAULT 'blog_writer',
    name            TEXT NOT NULL DEFAULT '',
    schedule_type   TEXT DEFAULT 'weekly',
    schedule_day    TEXT DEFAULT 'Monday',
    schedule_time   TEXT DEFAULT '09:00',
    enabled         INTEGER DEFAULT 0,
    last_run        TEXT DEFAULT '',
    next_run        TEXT DEFAULT '',
    config_json     TEXT DEFAULT '{}',
    created_at      TEXT DEFAULT ''
);

-- ─── Agent Runs ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS agent_runs (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id        INTEGER,
    agent_type      TEXT DEFAULT '',
    status          TEXT DEFAULT 'running',
    output_title    TEXT DEFAULT '',
    output_text     TEXT DEFAULT '',
    started_at      TEXT DEFAULT '',
    finished_at     TEXT DEFAULT '',
    error_message   TEXT DEFAULT '',
    published       INTEGER DEFAULT 0,
    FOREIGN KEY (agent_id) REFERENCES agent_schedules(id)
);

CREATE INDEX IF NOT EXISTS idx_agent_runs_agent ON agent_runs(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_runs_status ON agent_runs(status);

-- ─── Email Tracking ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS email_tracking (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id       INTEGER,
    client_name     TEXT DEFAULT '',
    client_email    TEXT DEFAULT '',
    email_type      TEXT DEFAULT '',
    subject         TEXT DEFAULT '',
    status          TEXT DEFAULT 'sent',
    sent_at         TEXT DEFAULT '',
    template_used   TEXT DEFAULT '',
    notes           TEXT DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_email_tracking_client ON email_tracking(client_id);
CREATE INDEX IF NOT EXISTS idx_email_tracking_type ON email_tracking(email_type);
CREATE INDEX IF NOT EXISTS idx_email_tracking_date ON email_tracking(sent_at);

-- ─── Blog Posts (synced from GAS Blog sheet) ───────────────────
CREATE TABLE IF NOT EXISTS blog_posts (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id         TEXT UNIQUE DEFAULT '',
    title           TEXT DEFAULT '',
    category        TEXT DEFAULT '',
    author          TEXT DEFAULT 'Gardners GM',
    excerpt         TEXT DEFAULT '',
    content         TEXT DEFAULT '',
    status          TEXT DEFAULT 'Draft',
    tags            TEXT DEFAULT '',
    social_fb       TEXT DEFAULT '',
    social_ig       TEXT DEFAULT '',
    social_x        TEXT DEFAULT '',
    image_url       TEXT DEFAULT '',
    created_date    TEXT DEFAULT '',
    updated_at      TEXT DEFAULT '',
    published_at    TEXT DEFAULT '',
    agent_run_id    INTEGER,
    dirty           INTEGER DEFAULT 0,
    last_synced     TEXT DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_blog_posts_status ON blog_posts(status);
CREATE INDEX IF NOT EXISTS idx_blog_posts_date ON blog_posts(created_date);

-- ─── Social Media Posts ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS social_posts (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    platform        TEXT DEFAULT 'All',
    content         TEXT DEFAULT '',
    hashtags        TEXT DEFAULT '',
    image_url       TEXT DEFAULT '',
    status          TEXT DEFAULT 'draft',
    scheduled_for   TEXT DEFAULT '',
    posted_at       TEXT DEFAULT '',
    blog_post_id    TEXT DEFAULT '',
    created_at      TEXT DEFAULT ''
);

-- ─── Email Automation Log ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS email_automation_log (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    trigger_type    TEXT DEFAULT '',
    client_id       INTEGER,
    client_name     TEXT DEFAULT '',
    client_email    TEXT DEFAULT '',
    email_type      TEXT DEFAULT '',
    status          TEXT DEFAULT 'sent',
    gas_response    TEXT DEFAULT '',
    created_at      TEXT DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_email_auto_date ON email_automation_log(created_at);

-- ─── Email Queue (persistent outbox for retry/cap overflow) ────
CREATE TABLE IF NOT EXISTS email_queue (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    to_email        TEXT NOT NULL DEFAULT '',
    to_name         TEXT DEFAULT '',
    subject         TEXT DEFAULT '',
    body_html       TEXT DEFAULT '',
    email_type      TEXT DEFAULT 'general',
    client_id       INTEGER DEFAULT 0,
    client_name     TEXT DEFAULT '',
    status          TEXT DEFAULT 'pending',
    priority        INTEGER DEFAULT 5,
    retry_count     INTEGER DEFAULT 0,
    last_attempt    TEXT DEFAULT '',
    error_message   TEXT DEFAULT '',
    created_at      TEXT DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_email_queue_status ON email_queue(status, priority);

-- ─── Schema Version ────────────────────────────────────────────
INSERT OR IGNORE INTO app_settings (key, value) VALUES ('schema_version', '1');
INSERT OR IGNORE INTO app_settings (key, value) VALUES ('last_full_sync', '');

-- ─── Job Photos ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS job_photos (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id        INTEGER,
    client_name      TEXT DEFAULT '',
    job_number       TEXT DEFAULT '',
    job_date         TEXT DEFAULT '',
    photo_type       TEXT DEFAULT 'before',
    filename         TEXT DEFAULT '',
    drive_url        TEXT DEFAULT '',
    drive_file_id    TEXT DEFAULT '',
    telegram_file_id TEXT DEFAULT '',
    source           TEXT DEFAULT 'local',
    caption          TEXT DEFAULT '',
    created_at       TEXT DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_photos_client ON job_photos(client_id);
CREATE INDEX IF NOT EXISTS idx_photos_date ON job_photos(job_date);

-- ─── Site Analytics (aggregated daily page views) ──────────────
CREATE TABLE IF NOT EXISTS site_analytics (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    date            TEXT NOT NULL,
    page            TEXT NOT NULL DEFAULT '/',
    views           INTEGER DEFAULT 0,
    UNIQUE(date, page)
);

CREATE INDEX IF NOT EXISTS idx_analytics_date ON site_analytics(date);

CREATE TABLE IF NOT EXISTS site_analytics_summary (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    period          TEXT DEFAULT '30 days',
    total_views     INTEGER DEFAULT 0,
    unique_pages    INTEGER DEFAULT 0,
    avg_per_day     INTEGER DEFAULT 0,
    top_pages       TEXT DEFAULT '[]',
    top_referrers   TEXT DEFAULT '[]',
    hourly          TEXT DEFAULT '[]',
    fetched_at      TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS business_recommendations (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    rec_id          TEXT DEFAULT '',
    date            TEXT DEFAULT '',
    type            TEXT DEFAULT '',
    priority        TEXT DEFAULT 'medium',
    title           TEXT DEFAULT '',
    description     TEXT DEFAULT '',
    action          TEXT DEFAULT '',
    impact          TEXT DEFAULT '',
    services_affected TEXT DEFAULT '[]',
    price_changes   TEXT DEFAULT '[]',
    status          TEXT DEFAULT 'pending',
    applied_at      TEXT DEFAULT '',
    analysis        TEXT DEFAULT '',
    seasonal_focus  TEXT DEFAULT '',
    promotion_idea  TEXT DEFAULT '',
    synced_at       TEXT DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_busrec_status ON business_recommendations(status);

-- ─── Notifications ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    type            TEXT NOT NULL DEFAULT 'info',
    title           TEXT NOT NULL DEFAULT '',
    message         TEXT DEFAULT '',
    icon            TEXT DEFAULT '🔔',
    client_name     TEXT DEFAULT '',
    job_number      TEXT DEFAULT '',
    read            INTEGER DEFAULT 0,
    created_at      TEXT DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_notif_read ON notifications(read);
CREATE INDEX IF NOT EXISTS idx_notif_date ON notifications(created_at);
"""


class Database:
    """SQLite database manager with CRUD operations."""

    def __init__(self, db_path: Path = None):
        self.db_path = db_path or config.DB_PATH
        self.conn: Optional[sqlite3.Connection] = None

    # ------------------------------------------------------------------
    # Connection lifecycle
    # ------------------------------------------------------------------
    def connect(self):
        """Open the database connection and apply settings."""
        self.conn = sqlite3.connect(
            str(self.db_path),
            timeout=10,
            check_same_thread=False,
        )
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA journal_mode=WAL")
        self.conn.execute("PRAGMA foreign_keys=ON")
        self.conn.execute("PRAGMA busy_timeout=5000")
        log.info(f"Database opened: {self.db_path}")

    def close(self):
        """Close the database connection."""
        if self.conn:
            self.conn.close()
            self.conn = None
            log.info("Database closed")

    def initialize(self):
        """Create tables and run migrations."""
        self.conn.executescript(SCHEMA_SQL)
        self.conn.commit()

        # ── Migrations — add columns to existing tables ──
        migrations = [
            ("invoices", "job_number", "TEXT DEFAULT ''"),
            ("invoices", "stripe_invoice_id", "TEXT DEFAULT ''"),
            ("invoices", "payment_url", "TEXT DEFAULT ''"),
            ("invoices", "payment_method", "TEXT DEFAULT ''"),
            ("job_photos", "job_number", "TEXT DEFAULT ''"),
            ("job_photos", "drive_url", "TEXT DEFAULT ''"),
            ("job_photos", "drive_file_id", "TEXT DEFAULT ''"),
            ("job_photos", "telegram_file_id", "TEXT DEFAULT ''"),
            ("job_photos", "source", "TEXT DEFAULT 'local'"),
            ("subscribers", "tier", "TEXT DEFAULT 'Free'"),
            ("business_costs", "waste_disposal", "REAL DEFAULT 0"),
            ("business_costs", "treatment_products", "REAL DEFAULT 0"),
            ("business_costs", "consumables", "REAL DEFAULT 0"),
        ]
        for table, col, col_type in migrations:
            try:
                self.conn.execute(f"ALTER TABLE {table} ADD COLUMN {col} {col_type}")
                log.info(f"Migration: added {table}.{col}")
            except Exception:
                pass  # Column already exists

        # Create indices that depend on migrated columns
        for idx_sql in [
            "CREATE INDEX IF NOT EXISTS idx_invoices_job ON invoices(job_number)",
            "CREATE INDEX IF NOT EXISTS idx_photos_job ON job_photos(job_number)",
        ]:
            try:
                self.conn.execute(idx_sql)
            except Exception:
                pass
        self.conn.commit()

        log.info(f"Database schema initialized (v{SCHEMA_VERSION})")

    # ------------------------------------------------------------------
    # Backup
    # ------------------------------------------------------------------
    def backup(self):
        """Create a daily backup of the database."""
        today = date.today().isoformat()
        backup_path = config.BACKUP_DIR / f"ggm_hub_{today}.db"
        if not backup_path.exists():
            shutil.copy2(str(self.db_path), str(backup_path))
            log.info(f"Backup created: {backup_path.name}")
            # Keep only last 7 backups
            backups = sorted(config.BACKUP_DIR.glob("ggm_hub_*.db"))
            for old in backups[:-7]:
                old.unlink()
                log.info(f"Old backup removed: {old.name}")

    # ------------------------------------------------------------------
    # Generic CRUD helpers
    # ------------------------------------------------------------------
    def execute(self, sql: str, params: tuple = ()) -> sqlite3.Cursor:
        return self.conn.execute(sql, params)

    def fetchall(self, sql: str, params: tuple = ()) -> list[dict]:
        cursor = self.conn.execute(sql, params)
        return [dict(row) for row in cursor.fetchall()]

    def fetchone(self, sql: str, params: tuple = ()) -> Optional[dict]:
        cursor = self.conn.execute(sql, params)
        row = cursor.fetchone()
        return dict(row) if row else None

    def commit(self):
        self.conn.commit()

    # ------------------------------------------------------------------
    # Clients
    # ------------------------------------------------------------------
    # ------------------------------------------------------------------
    # Notifications
    # ------------------------------------------------------------------
    def add_notification(self, ntype: str, title: str, message: str = "",
                         icon: str = "🔔", client_name: str = "",
                         job_number: str = "") -> int:
        """Add a notification. Returns the new notification id."""
        cursor = self.execute(
            """INSERT INTO notifications (type, title, message, icon, client_name,
               job_number, read, created_at)
               VALUES (?, ?, ?, ?, ?, ?, 0, ?)""",
            (ntype, title, message, icon, client_name, job_number,
             datetime.now().isoformat())
        )
        self.commit()
        return cursor.lastrowid

    def get_notifications(self, unread_only: bool = False,
                          limit: int = 50) -> list[dict]:
        """Get notifications, newest first."""
        sql = "SELECT * FROM notifications"
        params = []
        if unread_only:
            sql += " WHERE read = 0"
        sql += " ORDER BY created_at DESC"
        if limit:
            sql += " LIMIT ?"
            params.append(limit)
        return self.fetchall(sql, tuple(params))

    def get_unread_count(self) -> int:
        row = self.fetchone("SELECT COUNT(*) as c FROM notifications WHERE read = 0")
        return row["c"] if row else 0

    def mark_notification_read(self, notification_id: int):
        self.execute("UPDATE notifications SET read = 1 WHERE id = ?",
                     (notification_id,))
        self.commit()

    def mark_all_notifications_read(self):
        self.execute("UPDATE notifications SET read = 1 WHERE read = 0")
        self.commit()

    def get_recent_bookings(self, days: int = 7, limit: int = 20) -> list[dict]:
        """Get bookings created in the last N days, newest first."""
        cutoff = (date.today() - timedelta(days=days)).isoformat()
        return self.fetchall(
            """SELECT * FROM clients
               WHERE created_at >= ? AND type IN ('One-Off', 'booking', 'Booking', '')
               ORDER BY created_at DESC LIMIT ?""",
            (cutoff, limit)
        )

    # ------------------------------------------------------------------
    # Clients
    # ------------------------------------------------------------------
    def get_clients(self, status: str = None, service: str = None,
                    search: str = None, limit: int = None,
                    paid: str = None, client_type: str = None) -> list[dict]:
        """Get clients with optional filtering."""
        sql = "SELECT * FROM clients WHERE 1=1"
        params = []

        if status:
            sql += " AND status = ?"
            params.append(status)
        if service:
            sql += " AND service = ?"
            params.append(service)
        if paid:
            sql += " AND paid = ?"
            params.append(paid)
        if client_type:
            sql += " AND type = ?"
            params.append(client_type)
        if search:
            sql += " AND (name LIKE ? OR email LIKE ? OR postcode LIKE ? OR phone LIKE ?)"
            pattern = f"%{search}%"
            params.extend([pattern, pattern, pattern, pattern])

        sql += " ORDER BY date DESC, time ASC"

        if limit:
            sql += " LIMIT ?"
            params.append(limit)

        return self.fetchall(sql, tuple(params))

    def get_recent_bookings(self, days: int = 7, limit: int = 20) -> list:
        """Get bookings created in the last N days, newest first."""
        cutoff = (date.today() - timedelta(days=days)).isoformat()
        return self.fetchall(
            """SELECT * FROM clients
               WHERE created_at >= ? AND created_at != ''
               ORDER BY created_at DESC LIMIT ?""",
            (cutoff, limit)
        )

    def get_bookings_in_range(self, start_date: str, end_date: str) -> dict:
        """Get all bookings (one-off + recurring subscriptions + schedule) within a date range.
        Returns dict of date_str -> list[booking_dict].
        """
        by_date = {}

        # 1. One-off clients with an actual date in range
        client_bookings = self.fetchall(
            """SELECT id, name, service, date, time, status, price, postcode, type, paid,
                       frequency, preferred_day
               FROM clients
               WHERE date >= ? AND date <= ? AND date != ''
               ORDER BY date ASC, time ASC""",
            (start_date, end_date)
        )
        for b in client_bookings:
            d = self._normalise_date(b.get("date", ""))
            if d:
                entry = dict(b)
                entry["date"] = d
                by_date.setdefault(d, []).append(entry)

        # 2. Recurring subscriptions — generate dates from preferred_day + frequency
        subs = self.fetchall(
            """SELECT id, name, service, time, status, price, postcode, type, paid,
                       frequency, preferred_day, date
               FROM clients
               WHERE type IN ('Subscription', 'subscription')
                 AND status NOT IN ('Cancelled', 'Complete')
                 AND preferred_day != ''"""
        )
        recurring = self._generate_recurring_dates(subs, start_date, end_date)
        for d, entries in recurring.items():
            by_date.setdefault(d, []).extend(entries)

        # 3. Schedule table entries
        schedule_bookings = self.fetchall(
            """SELECT id, client_name as name, service, date, time, status, 'schedule' as source
               FROM schedule
               WHERE date >= ? AND date <= ?
               ORDER BY date ASC, time ASC""",
            (start_date, end_date)
        )
        for s in schedule_bookings:
            d = self._normalise_date(s.get("date", ""))
            if d:
                entry = dict(s)
                entry["date"] = d
                by_date.setdefault(d, []).append(entry)

        # Sort each day's entries by time
        for d in by_date:
            by_date[d].sort(key=lambda x: x.get("time", "99:99"))

        return by_date

    def _generate_recurring_dates(self, subs: list[dict],
                                  start_date: str, end_date: str) -> dict:
        """Generate calendar entries for recurring subscriptions within a date range."""
        from datetime import timedelta

        day_map = {
            "monday": 0, "tuesday": 1, "wednesday": 2, "thursday": 3,
            "friday": 4, "saturday": 5, "sunday": 6,
            "mon": 0, "tue": 1, "wed": 2, "thu": 3,
            "fri": 4, "sat": 5, "sun": 6,
        }

        freq_weeks = {
            "weekly": 1, "fortnightly": 2, "bi-weekly": 2,
            "monthly": 4, "4-weekly": 4, "one-off": 0,
        }

        try:
            range_start = date.fromisoformat(start_date)
            range_end = date.fromisoformat(end_date)
        except (ValueError, TypeError):
            return {}

        by_date = {}

        for sub in subs:
            pref_day = str(sub.get("preferred_day", "")).strip().lower()
            freq = str(sub.get("frequency", "weekly")).strip().lower()
            target_weekday = day_map.get(pref_day)

            if target_weekday is None:
                continue

            interval = freq_weeks.get(freq, 1)
            if interval == 0:
                continue  # One-off, skip

            # Find first occurrence of the preferred weekday on or after range_start
            current = range_start
            days_ahead = (target_weekday - current.weekday()) % 7
            current = current + timedelta(days=days_ahead)

            while current <= range_end:
                d = current.isoformat()
                # Avoid duplicating if this client already has a one-off booking on this date
                entry = {
                    "id": sub["id"],
                    "name": sub.get("name", ""),
                    "service": sub.get("service", ""),
                    "date": d,
                    "time": sub.get("time", ""),
                    "status": sub.get("status", "Active"),
                    "price": sub.get("price", 0),
                    "postcode": sub.get("postcode", ""),
                    "type": "Subscription",
                    "recurring": True,
                }
                by_date.setdefault(d, []).append(entry)
                current += timedelta(weeks=interval)

        return by_date

    @staticmethod
    def _normalise_date(val: str) -> str:
        """Normalise a date string to YYYY-MM-DD."""
        if not val:
            return ""
        val = str(val).strip()
        if "T" in val:
            val = val.split("T")[0]
        if len(val) == 10 and val[4] == "-" and val[7] == "-":
            return val
        return val

    def get_client(self, client_id: int) -> Optional[dict]:
        return self.fetchone("SELECT * FROM clients WHERE id = ?", (client_id,))

    def get_dates_with_bookings(self, year: int, month: int) -> dict:
        """Get a dict of date_str → booking_count for a given month.
        Includes one-off bookings AND recurring subscription entries.
        """
        import calendar as _cal
        start = f"{year}-{month:02d}-01"
        last_day = _cal.monthrange(year, month)[1]
        end = f"{year}-{month:02d}-{last_day:02d}"

        # Use the full booking range method which handles recurring entries
        all_bookings = self.get_bookings_in_range(start, end)
        return {d: len(entries) for d, entries in all_bookings.items()}

    def save_client(self, data: dict) -> int:
        """Insert or update a client. Returns the row id."""
        data["dirty"] = 1
        data["updated_at"] = datetime.now().isoformat()

        if data.get("id"):
            cols = [k for k in data if k != "id"]
            sets = ", ".join(f"{c} = ?" for c in cols)
            vals = [data[c] for c in cols] + [data["id"]]
            self.execute(f"UPDATE clients SET {sets} WHERE id = ?", tuple(vals))
            self.commit()
            return data["id"]
        else:
            cols = [k for k in data if k != "id"]
            placeholders = ", ".join("?" for _ in cols)
            vals = [data[c] for c in cols]
            cursor = self.execute(
                f"INSERT INTO clients ({', '.join(cols)}) VALUES ({placeholders})",
                tuple(vals)
            )
            self.commit()
            return cursor.lastrowid

    def upsert_clients(self, rows: list[dict]):
        """Bulk upsert clients from Sheets sync. Does NOT mark dirty."""
        now = datetime.now().isoformat()
        for row in rows:
            existing = self.fetchone(
                "SELECT id FROM clients WHERE sheets_row = ?",
                (row.get("sheets_row", 0),)
            )
            row["last_synced"] = now
            row["dirty"] = 0

            if existing:
                cols = [k for k in row if k not in ("id",)]
                sets = ", ".join(f"{c} = ?" for c in cols)
                vals = [row[c] for c in cols] + [existing["id"]]
                self.execute(f"UPDATE clients SET {sets} WHERE id = ?", tuple(vals))
            else:
                cols = list(row.keys())
                placeholders = ", ".join("?" for _ in cols)
                vals = [row[c] for c in cols]
                self.execute(
                    f"INSERT INTO clients ({', '.join(cols)}) VALUES ({placeholders})",
                    tuple(vals)
                )
        self.commit()

    def get_dirty_clients(self) -> list[dict]:
        """Get clients that have been modified locally but not synced."""
        return self.fetchall("SELECT * FROM clients WHERE dirty = 1")

    def mark_clients_synced(self, ids: list[int]):
        """Mark clients as synced after pushing to Sheets."""
        if ids:
            placeholders = ", ".join("?" for _ in ids)
            self.execute(
                f"UPDATE clients SET dirty = 0, last_synced = ? WHERE id IN ({placeholders})",
                (datetime.now().isoformat(), *ids)
            )
            self.commit()

    def delete_client(self, client_id: int):
        """Delete a client record from SQLite."""
        self.execute("DELETE FROM clients WHERE id = ?", (client_id,))
        self.execute("DELETE FROM job_photos WHERE client_id = ?", (client_id,))
        self.commit()

    # ------------------------------------------------------------------
    # Today's jobs
    # ------------------------------------------------------------------
    def get_todays_jobs(self, target_date: str = None) -> list[dict]:
        """Get jobs scheduled for a specific date (default: today).
        Includes one-off bookings, schedule entries, AND recurring subscriptions
        matched by day-of-week.
        """
        if not target_date:
            target_date = date.today().isoformat()

        # Parse target date to get day name
        try:
            from datetime import datetime as _dt
            dt = _dt.strptime(target_date, "%Y-%m-%d")
            day_name = dt.strftime("%A")
        except Exception:
            day_name = ""

        # Check schedule table first (subscription visits)
        schedule_jobs = self.fetchall(
            "SELECT *, 'schedule' as source FROM schedule WHERE date = ? ORDER BY time ASC",
            (target_date,)
        )

        # Also check clients with matching date (one-off bookings)
        client_jobs = self.fetchall(
            """SELECT *, 'client' as source FROM clients
               WHERE date = ? AND LOWER(status) NOT IN ('cancelled', 'completed', 'complete')
               ORDER BY time ASC""",
            (target_date,)
        )

        # Recurring subscriptions: match by preferred_day
        sub_jobs = []
        if day_name:
            sub_jobs = self.fetchall(
                """SELECT *, 'subscription' as source FROM clients
                   WHERE type = 'Subscription'
                     AND LOWER(status) NOT IN ('cancelled', 'completed', 'complete')
                     AND preferred_day = ?
                   ORDER BY time ASC""",
                (day_name,)
            )

        # Merge and deduplicate (prefer schedule > client > subscription)
        seen_names = set()
        combined = []

        # Schedule entries first
        for j in schedule_jobs:
            n = j.get("client_name", "")
            seen_names.add(n.lower())
            combined.append(j)

        # One-off clients
        for cj in client_jobs:
            n = cj.get("name", "")
            if n.lower() not in seen_names:
                seen_names.add(n.lower())
                combined.append({
                    "id": cj["id"],
                    "client_name": cj["name"],
                    "name": cj["name"],
                    "service": cj["service"],
                    "date": cj["date"],
                    "time": cj["time"],
                    "postcode": cj["postcode"],
                    "address": cj.get("address", ""),
                    "phone": cj["phone"],
                    "email": cj.get("email", ""),
                    "status": cj["status"],
                    "notes": cj.get("notes", ""),
                    "source": "client",
                    "price": cj.get("price", 0),
                    "job_number": cj.get("job_number", ""),
                    "type": cj.get("type", ""),
                    "paid": cj.get("paid", ""),
                })

        # Recurring subscriptions
        for sj in sub_jobs:
            n = sj.get("name", "")
            if n.lower() not in seen_names:
                seen_names.add(n.lower())
                combined.append({
                    "id": sj["id"],
                    "client_name": sj["name"],
                    "name": sj["name"],
                    "service": sj["service"],
                    "date": target_date,
                    "time": sj["time"],
                    "postcode": sj["postcode"],
                    "address": sj.get("address", ""),
                    "phone": sj["phone"],
                    "email": sj.get("email", ""),
                    "status": sj["status"],
                    "notes": sj.get("notes", ""),
                    "source": "subscription",
                    "price": sj.get("price", 0),
                    "job_number": sj.get("job_number", ""),
                    "type": sj.get("type", ""),
                    "paid": sj.get("paid", ""),
                    "frequency": sj.get("frequency", ""),
                    "preferred_day": sj.get("preferred_day", ""),
                })

        combined.sort(key=lambda j: j.get("time", "99:99"))
        return combined

    # ------------------------------------------------------------------
    # Schedule
    # ------------------------------------------------------------------
    def upsert_schedule(self, rows: list[dict]):
        """Bulk upsert schedule entries from Sheets."""
        now = datetime.now().isoformat()
        # Clear and reload (schedule changes wholesale)
        self.execute("DELETE FROM schedule")
        for row in rows:
            row["last_synced"] = now
            row["dirty"] = 0
            cols = list(row.keys())
            placeholders = ", ".join("?" for _ in cols)
            vals = [row[c] for c in cols]
            self.execute(
                f"INSERT INTO schedule ({', '.join(cols)}) VALUES ({placeholders})",
                tuple(vals)
            )
        self.commit()

    # ------------------------------------------------------------------
    # Invoices
    # ------------------------------------------------------------------
    def get_invoices(self, status: str = None) -> list[dict]:
        sql = "SELECT * FROM invoices WHERE 1=1"
        params = []
        if status:
            sql += " AND status = ?"
            params.append(status)
        sql += " ORDER BY issue_date DESC"
        return self.fetchall(sql, tuple(params))

    def upsert_invoices(self, rows: list[dict]):
        now = datetime.now().isoformat()
        for row in rows:
            existing = self.fetchone(
                "SELECT id FROM invoices WHERE invoice_number = ?",
                (row.get("invoice_number", ""),)
            )
            row["last_synced"] = now
            row["dirty"] = 0
            if existing:
                cols = [k for k in row if k not in ("id",)]
                sets = ", ".join(f"{c} = ?" for c in cols)
                vals = [row[c] for c in cols] + [existing["id"]]
                self.execute(f"UPDATE invoices SET {sets} WHERE id = ?", tuple(vals))
            else:
                cols = list(row.keys())
                placeholders = ", ".join("?" for _ in cols)
                vals = [row[c] for c in cols]
                self.execute(
                    f"INSERT INTO invoices ({', '.join(cols)}) VALUES ({placeholders})",
                    tuple(vals)
                )
        self.commit()

    def save_invoice(self, data: dict) -> int:
        data["dirty"] = 1
        if data.get("id"):
            cols = [k for k in data if k != "id"]
            sets = ", ".join(f"{c} = ?" for c in cols)
            vals = [data[c] for c in cols] + [data["id"]]
            self.execute(f"UPDATE invoices SET {sets} WHERE id = ?", tuple(vals))
            self.commit()
            return data["id"]
        else:
            cols = [k for k in data if k != "id"]
            placeholders = ", ".join("?" for _ in cols)
            vals = [data[c] for c in cols]
            cursor = self.execute(
                f"INSERT INTO invoices ({', '.join(cols)}) VALUES ({placeholders})",
                tuple(vals)
            )
            self.commit()
            return cursor.lastrowid

    def get_invoice(self, invoice_id: int) -> Optional[dict]:
        return self.fetchone("SELECT * FROM invoices WHERE id = ?", (invoice_id,))

    def get_dirty_invoices(self) -> list[dict]:
        return self.fetchall("SELECT * FROM invoices WHERE dirty = 1")

    def mark_invoices_synced(self, ids: list[int]):
        if ids:
            placeholders = ", ".join("?" for _ in ids)
            self.execute(
                f"UPDATE invoices SET dirty = 0, last_synced = ? WHERE id IN ({placeholders})",
                (datetime.now().isoformat(), *ids)
            )
            self.commit()

    def delete_invoice(self, invoice_id: int):
        """Delete an invoice record from SQLite."""
        self.execute("DELETE FROM invoices WHERE id = ?", (invoice_id,))
        self.commit()

    # ------------------------------------------------------------------
    # Quotes
    # ------------------------------------------------------------------
    def get_quotes(self, status: str = None) -> list[dict]:
        sql = "SELECT * FROM quotes WHERE 1=1"
        params = []
        if status:
            sql += " AND status = ?"
            params.append(status)
        sql += " ORDER BY date_created DESC"
        return self.fetchall(sql, tuple(params))

    def upsert_quotes(self, rows: list[dict]):
        now = datetime.now().isoformat()
        for row in rows:
            existing = self.fetchone(
                "SELECT id FROM quotes WHERE quote_number = ?",
                (row.get("quote_number", ""),)
            )
            row["last_synced"] = now
            row["dirty"] = 0
            if existing:
                cols = [k for k in row if k not in ("id",)]
                sets = ", ".join(f"{c} = ?" for c in cols)
                vals = [row[c] for c in cols] + [existing["id"]]
                self.execute(f"UPDATE quotes SET {sets} WHERE id = ?", tuple(vals))
            else:
                cols = list(row.keys())
                placeholders = ", ".join("?" for _ in cols)
                vals = [row[c] for c in cols]
                self.execute(
                    f"INSERT INTO quotes ({', '.join(cols)}) VALUES ({placeholders})",
                    tuple(vals)
                )
        self.commit()

    def save_quote(self, data: dict) -> int:
        """Insert or update a quote. Returns the row id."""
        data["dirty"] = 1
        if data.get("id"):
            cols = [k for k in data if k != "id"]
            sets = ", ".join(f"{c} = ?" for c in cols)
            vals = [data[c] for c in cols] + [data["id"]]
            self.execute(f"UPDATE quotes SET {sets} WHERE id = ?", tuple(vals))
            self.commit()
            return data["id"]
        else:
            cols = [k for k in data if k != "id"]
            placeholders = ", ".join("?" for _ in cols)
            vals = [data[c] for c in cols]
            cursor = self.execute(
                f"INSERT INTO quotes ({', '.join(cols)}) VALUES ({placeholders})",
                tuple(vals)
            )
            self.commit()
            return cursor.lastrowid

    def get_quote(self, quote_id: int) -> Optional[dict]:
        return self.fetchone("SELECT * FROM quotes WHERE id = ?", (quote_id,))

    def get_dirty_quotes(self) -> list[dict]:
        return self.fetchall("SELECT * FROM quotes WHERE dirty = 1")

    def mark_quotes_synced(self, ids: list[int]):
        if ids:
            placeholders = ", ".join("?" for _ in ids)
            self.execute(
                f"UPDATE quotes SET dirty = 0, last_synced = ? WHERE id IN ({placeholders})",
                (datetime.now().isoformat(), *ids)
            )
            self.commit()

    def delete_quote(self, quote_id: int):
        """Delete a quote record from SQLite."""
        self.execute("DELETE FROM quotes WHERE id = ?", (quote_id,))
        self.commit()

    # ------------------------------------------------------------------
    # Business Costs
    # ------------------------------------------------------------------
    def get_business_costs(self) -> list[dict]:
        return self.fetchall("SELECT * FROM business_costs ORDER BY month DESC")

    def upsert_business_costs(self, rows: list[dict]):
        now = datetime.now().isoformat()
        for row in rows:
            existing = self.fetchone(
                "SELECT id FROM business_costs WHERE month = ?",
                (row.get("month", ""),)
            )
            row["last_synced"] = now
            row["dirty"] = 0
            if existing:
                cols = [k for k in row if k not in ("id",)]
                sets = ", ".join(f"{c} = ?" for c in cols)
                vals = [row[c] for c in cols] + [existing["id"]]
                self.execute(f"UPDATE business_costs SET {sets} WHERE id = ?", tuple(vals))
            else:
                cols = list(row.keys())
                placeholders = ", ".join("?" for _ in cols)
                vals = [row[c] for c in cols]
                self.execute(
                    f"INSERT INTO business_costs ({', '.join(cols)}) VALUES ({placeholders})",
                    tuple(vals)
                )
        self.commit()

    def save_business_cost(self, data: dict) -> int:
        """Insert or update a business cost row."""
        data["dirty"] = 1
        if data.get("id"):
            cols = [k for k in data if k != "id"]
            sets = ", ".join(f"{c} = ?" for c in cols)
            vals = [data[c] for c in cols] + [data["id"]]
            self.execute(f"UPDATE business_costs SET {sets} WHERE id = ?", tuple(vals))
            self.commit()
            return data["id"]
        else:
            cols = [k for k in data if k != "id"]
            placeholders = ", ".join("?" for _ in cols)
            vals = [data[c] for c in cols]
            cursor = self.execute(
                f"INSERT INTO business_costs ({', '.join(cols)}) VALUES ({placeholders})",
                tuple(vals)
            )
            self.commit()
            return cursor.lastrowid

    def get_dirty_costs(self) -> list[dict]:
        return self.fetchall("SELECT * FROM business_costs WHERE dirty = 1")

    def mark_costs_synced(self, ids: list[int]):
        if ids:
            placeholders = ", ".join("?" for _ in ids)
            self.execute(
                f"UPDATE business_costs SET dirty = 0, last_synced = ? WHERE id IN ({placeholders})",
                (datetime.now().isoformat(), *ids)
            )
            self.commit()

    # ------------------------------------------------------------------
    # Savings Pots
    # ------------------------------------------------------------------
    def get_savings_pots(self) -> list[dict]:
        return self.fetchall("SELECT * FROM savings_pots ORDER BY name")

    def upsert_savings_pots(self, rows: list[dict]):
        now = datetime.now().isoformat()
        for row in rows:
            existing = self.fetchone(
                "SELECT id FROM savings_pots WHERE name = ?",
                (row.get("name", ""),)
            )
            row["last_synced"] = now
            row["dirty"] = 0
            if existing:
                self.execute(
                    "UPDATE savings_pots SET balance=?, target=?, updated_at=?, dirty=0, last_synced=? WHERE id=?",
                    (row.get("balance", 0), row.get("target", 0), now, now, existing["id"])
                )
            else:
                self.execute(
                    "INSERT INTO savings_pots (name, balance, target, updated_at, dirty, last_synced) VALUES (?,?,?,?,0,?)",
                    (row["name"], row.get("balance", 0), row.get("target", 0), now, now)
                )
        self.commit()

    def save_savings_pot(self, data: dict) -> int:
        """Insert or update a savings pot."""
        data["dirty"] = 1
        data["updated_at"] = datetime.now().isoformat()
        if data.get("id"):
            self.execute(
                "UPDATE savings_pots SET name=?, balance=?, target=?, updated_at=?, dirty=1 WHERE id=?",
                (data["name"], float(data.get("balance", 0) or 0),
                 float(data.get("target", 0) or 0), data["updated_at"], data["id"])
            )
            self.commit()
            return data["id"]
        else:
            cursor = self.execute(
                "INSERT INTO savings_pots (name, balance, target, updated_at, dirty) VALUES (?,?,?,?,1)",
                (data["name"], float(data.get("balance", 0) or 0),
                 float(data.get("target", 0) or 0), data["updated_at"])
            )
            self.commit()
            return cursor.lastrowid

    def get_dirty_pots(self) -> list[dict]:
        return self.fetchall("SELECT * FROM savings_pots WHERE dirty = 1")

    def mark_pots_synced(self, ids: list[int]):
        if ids:
            placeholders = ", ".join("?" for _ in ids)
            self.execute(
                f"UPDATE savings_pots SET dirty = 0, last_synced = ? WHERE id IN ({placeholders})",
                (datetime.now().isoformat(), *ids)
            )
            self.commit()

    # ------------------------------------------------------------------
    # Enquiries
    # ------------------------------------------------------------------
    def get_enquiries(self, status: str = None) -> list[dict]:
        sql = "SELECT * FROM enquiries WHERE 1=1"
        params = []
        if status:
            sql += " AND status = ?"
            params.append(status)
        sql += " ORDER BY date DESC"
        return self.fetchall(sql, tuple(params))

    def upsert_enquiries(self, rows: list[dict]):
        now = datetime.now().isoformat()
        self.execute("DELETE FROM enquiries")
        for row in rows:
            row["last_synced"] = now
            row["dirty"] = 0
            cols = list(row.keys())
            placeholders = ", ".join("?" for _ in cols)
            vals = [row[c] for c in cols]
            self.execute(
                f"INSERT INTO enquiries ({', '.join(cols)}) VALUES ({placeholders})",
                tuple(vals)
            )
        self.commit()

    def save_enquiry(self, data: dict) -> int:
        """Insert or update an enquiry."""
        data["dirty"] = 1
        if data.get("id"):
            cols = [k for k in data if k != "id"]
            sets = ", ".join(f"{c} = ?" for c in cols)
            vals = [data[c] for c in cols] + [data["id"]]
            self.execute(f"UPDATE enquiries SET {sets} WHERE id = ?", tuple(vals))
            self.commit()
            return data["id"]
        else:
            cols = [k for k in data if k != "id"]
            placeholders = ", ".join("?" for _ in cols)
            vals = [data[c] for c in cols]
            cursor = self.execute(
                f"INSERT INTO enquiries ({', '.join(cols)}) VALUES ({placeholders})",
                tuple(vals)
            )
            self.commit()
            return cursor.lastrowid

    def get_enquiry(self, enquiry_id: int) -> Optional[dict]:
        return self.fetchone("SELECT * FROM enquiries WHERE id = ?", (enquiry_id,))

    def get_dirty_enquiries(self) -> list[dict]:
        return self.fetchall("SELECT * FROM enquiries WHERE dirty = 1")

    def mark_enquiries_synced(self, ids: list[int]):
        if ids:
            placeholders = ", ".join("?" for _ in ids)
            self.execute(
                f"UPDATE enquiries SET dirty = 0, last_synced = ? WHERE id IN ({placeholders})",
                (datetime.now().isoformat(), *ids)
            )
            self.commit()

    def delete_enquiry(self, enquiry_id: int):
        """Delete an enquiry record from SQLite."""
        self.execute("DELETE FROM enquiries WHERE id = ?", (enquiry_id,))
        self.commit()

    # ------------------------------------------------------------------
    # Site Analytics
    # ------------------------------------------------------------------
    def upsert_site_analytics(self, daily_data: list[dict]):
        """Upsert daily page view counts from GAS analytics."""
        for row in daily_data:
            self.execute("""
                INSERT INTO site_analytics (date, page, views)
                VALUES (?, ?, ?)
                ON CONFLICT(date, page)
                DO UPDATE SET views = excluded.views
            """, (row["date"], row.get("page", "/"), row.get("views", 0)))
        self.commit()

    def save_analytics_summary(self, summary: dict):
        """Store the latest analytics summary from GAS."""
        # Clear old summaries and store latest
        self.execute("DELETE FROM site_analytics_summary")
        self.execute("""
            INSERT INTO site_analytics_summary
                (period, total_views, unique_pages, avg_per_day,
                 top_pages, top_referrers, hourly, fetched_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            summary.get("period", "30 days"),
            summary.get("totalViews", 0),
            summary.get("uniquePages", 0),
            summary.get("avgPerDay", 0),
            json.dumps(summary.get("topPages", [])),
            json.dumps(summary.get("topReferrers", [])),
            json.dumps(summary.get("hourly", [])),
            datetime.now().isoformat(),
        ))
        self.commit()

    def get_analytics_summary(self) -> dict:
        """Get the latest analytics summary."""
        row = self.fetchone("SELECT * FROM site_analytics_summary ORDER BY id DESC LIMIT 1")
        if not row:
            return {"totalViews": 0, "uniquePages": 0, "avgPerDay": 0,
                    "topPages": [], "topReferrers": [], "hourly": [], "daily": []}
        result = dict(row)
        result["topPages"] = json.loads(result.get("top_pages", "[]"))
        result["topReferrers"] = json.loads(result.get("top_referrers", "[]"))
        result["hourly"] = json.loads(result.get("hourly", "[]"))
        # Get daily data from site_analytics table
        daily = self.fetchall("""
            SELECT date, SUM(views) as views
            FROM site_analytics
            WHERE date >= date('now', '-30 days')
            GROUP BY date
            ORDER BY date
        """)
        result["daily"] = [{"date": d["date"], "views": d["views"]} for d in daily]
        return result

    def get_analytics_daily(self, days: int = 30) -> list[dict]:
        """Get daily page view totals."""
        return self.fetchall(f"""
            SELECT date, SUM(views) as views
            FROM site_analytics
            WHERE date >= date('now', '-{days} days')
            GROUP BY date
            ORDER BY date
        """)

    # ------------------------------------------------------------------
    # Business Recommendations
    # ------------------------------------------------------------------
    def save_business_recommendations(self, recs: list[dict]):
        """Save a batch of business recommendations from sync."""
        for rec in recs:
            # Check if already exists by rec_id
            existing = self.fetchone(
                "SELECT id FROM business_recommendations WHERE rec_id = ?",
                (rec.get("id", ""),)
            )
            if existing:
                self.execute("""
                    UPDATE business_recommendations
                    SET status = ?, applied_at = ?, synced_at = ?
                    WHERE rec_id = ?
                """, (
                    rec.get("status", "pending"),
                    rec.get("applied_at", ""),
                    datetime.now().isoformat(),
                    rec.get("id", ""),
                ))
            else:
                self.execute("""
                    INSERT INTO business_recommendations
                    (rec_id, date, type, priority, title, description, action,
                     impact, services_affected, price_changes, status, applied_at,
                     analysis, seasonal_focus, promotion_idea, synced_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    rec.get("id", ""),
                    rec.get("date", ""),
                    rec.get("type", ""),
                    rec.get("priority", "medium"),
                    rec.get("title", ""),
                    rec.get("description", ""),
                    rec.get("action", ""),
                    rec.get("impact", ""),
                    json.dumps(rec.get("services_affected", [])),
                    json.dumps(rec.get("price_changes", [])),
                    rec.get("status", "pending"),
                    rec.get("applied_at", ""),
                    rec.get("analysis", ""),
                    rec.get("seasonal_focus", ""),
                    rec.get("promotion_idea", ""),
                    datetime.now().isoformat(),
                ))
        self.commit()

    def get_business_recommendations(self, status: str = None, limit: int = 30) -> list[dict]:
        """Get business recommendations, optionally filtered by status."""
        sql = "SELECT * FROM business_recommendations WHERE 1=1"
        params = []
        if status:
            sql += " AND status = ?"
            params.append(status)
        sql += " ORDER BY date DESC, id DESC LIMIT ?"
        params.append(limit)
        rows = self.fetchall(sql, tuple(params))
        results = []
        for row in rows:
            r = dict(row)
            r["services_affected"] = json.loads(r.get("services_affected", "[]"))
            r["price_changes"] = json.loads(r.get("price_changes", "[]"))
            results.append(r)
        return results

    def update_recommendation_status(self, rec_id: str, status: str):
        """Update a recommendation's status."""
        self.execute(
            "UPDATE business_recommendations SET status = ? WHERE rec_id = ?",
            (status, rec_id)
        )
        self.commit()

    # ------------------------------------------------------------------
    # Complaints
    # ------------------------------------------------------------------
    def get_complaints(self, status: str = None, severity: str = None) -> list[dict]:
        sql = "SELECT * FROM complaints WHERE 1=1"
        params = []
        if status:
            sql += " AND status = ?"
            params.append(status)
        if severity:
            sql += " AND severity = ?"
            params.append(severity)
        sql += " ORDER BY CASE status WHEN 'Open' THEN 1 WHEN 'Investigating' THEN 2 WHEN 'Resolved' THEN 3 ELSE 4 END, created_at DESC"
        return self.fetchall(sql, tuple(params))

    def save_complaint(self, data: dict) -> int:
        data["dirty"] = 1
        if data.get("id"):
            cols = [k for k in data if k != "id"]
            sets = ", ".join(f"{c} = ?" for c in cols)
            vals = [data[c] for c in cols] + [data["id"]]
            self.execute(f"UPDATE complaints SET {sets} WHERE id = ?", tuple(vals))
            self.commit()
            return data["id"]
        else:
            data.setdefault("created_at", datetime.now().isoformat())
            cols = [k for k in data if k != "id"]
            placeholders = ", ".join("?" for _ in cols)
            vals = [data[c] for c in cols]
            cursor = self.execute(
                f"INSERT INTO complaints ({', '.join(cols)}) VALUES ({placeholders})",
                tuple(vals)
            )
            self.commit()
            return cursor.lastrowid

    def get_complaint(self, complaint_id: int) -> Optional[dict]:
        return self.fetchone("SELECT * FROM complaints WHERE id = ?", (complaint_id,))

    # ------------------------------------------------------------------
    # Vacancies
    # ------------------------------------------------------------------
    def get_vacancies(self, status: str = None) -> list[dict]:
        sql = "SELECT * FROM vacancies WHERE 1=1"
        params = []
        if status:
            sql += " AND status = ?"
            params.append(status)
        sql += " ORDER BY posted_date DESC"
        return self.fetchall(sql, tuple(params))

    def save_vacancy(self, data: dict) -> int:
        data["dirty"] = 1
        if data.get("id"):
            cols = [k for k in data if k != "id"]
            sets = ", ".join(f"{c} = ?" for c in cols)
            vals = [data[c] for c in cols] + [data["id"]]
            self.execute(f"UPDATE vacancies SET {sets} WHERE id = ?", tuple(vals))
            self.commit()
            return data["id"]
        else:
            data.setdefault("posted_date", datetime.now().isoformat()[:10])
            cols = [k for k in data if k != "id"]
            placeholders = ", ".join("?" for _ in cols)
            vals = [data[c] for c in cols]
            cursor = self.execute(
                f"INSERT INTO vacancies ({', '.join(cols)}) VALUES ({placeholders})",
                tuple(vals)
            )
            self.commit()
            return cursor.lastrowid

    def delete_vacancy(self, vacancy_id: int):
        self.execute("DELETE FROM vacancies WHERE id = ?", (vacancy_id,))
        self.commit()

    # ------------------------------------------------------------------
    # Applications
    # ------------------------------------------------------------------
    def get_applications(self, status: str = None, position: str = None) -> list[dict]:
        sql = "SELECT * FROM applications WHERE 1=1"
        params = []
        if status:
            sql += " AND status = ?"
            params.append(status)
        if position:
            sql += " AND position = ?"
            params.append(position)
        sql += " ORDER BY created_at DESC"
        return self.fetchall(sql, tuple(params))

    def save_application(self, data: dict) -> int:
        data["dirty"] = 1
        if data.get("id"):
            cols = [k for k in data if k != "id"]
            sets = ", ".join(f"{c} = ?" for c in cols)
            vals = [data[c] for c in cols] + [data["id"]]
            self.execute(f"UPDATE applications SET {sets} WHERE id = ?", tuple(vals))
            self.commit()
            return data["id"]
        else:
            data.setdefault("created_at", datetime.now().isoformat())
            cols = [k for k in data if k != "id"]
            placeholders = ", ".join("?" for _ in cols)
            vals = [data[c] for c in cols]
            cursor = self.execute(
                f"INSERT INTO applications ({', '.join(cols)}) VALUES ({placeholders})",
                tuple(vals)
            )
            self.commit()
            return cursor.lastrowid

    def get_application(self, app_id: int) -> Optional[dict]:
        return self.fetchone("SELECT * FROM applications WHERE id = ?", (app_id,))

    # ------------------------------------------------------------------
    # Products
    # ------------------------------------------------------------------
    def get_products(self, status: str = None) -> list[dict]:
        sql = "SELECT * FROM products WHERE 1=1"
        params = []
        if status:
            sql += " AND status = ?"
            params.append(status)
        sql += " ORDER BY name ASC"
        return self.fetchall(sql, tuple(params))

    def save_product(self, data: dict) -> int:
        data["dirty"] = 1
        if data.get("id"):
            cols = [k for k in data if k != "id"]
            sets = ", ".join(f"{c} = ?" for c in cols)
            vals = [data[c] for c in cols] + [data["id"]]
            self.execute(f"UPDATE products SET {sets} WHERE id = ?", tuple(vals))
            self.commit()
            return data["id"]
        else:
            cols = [k for k in data if k != "id"]
            placeholders = ", ".join("?" for _ in cols)
            vals = [data[c] for c in cols]
            cursor = self.execute(
                f"INSERT INTO products ({', '.join(cols)}) VALUES ({placeholders})",
                tuple(vals)
            )
            self.commit()
            return cursor.lastrowid

    def delete_product(self, product_id: int):
        self.execute("DELETE FROM products WHERE id = ?", (product_id,))
        self.commit()

    # ------------------------------------------------------------------
    # Orders
    # ------------------------------------------------------------------
    def get_orders(self, status: str = None) -> list[dict]:
        sql = "SELECT * FROM orders WHERE 1=1"
        params = []
        if status:
            sql += " AND order_status = ?"
            params.append(status)
        sql += " ORDER BY date DESC"
        return self.fetchall(sql, tuple(params))

    def save_order(self, data: dict) -> int:
        data["dirty"] = 1
        if data.get("id"):
            cols = [k for k in data if k != "id"]
            sets = ", ".join(f"{c} = ?" for c in cols)
            vals = [data[c] for c in cols] + [data["id"]]
            self.execute(f"UPDATE orders SET {sets} WHERE id = ?", tuple(vals))
            self.commit()
            return data["id"]
        else:
            cols = [k for k in data if k != "id"]
            placeholders = ", ".join("?" for _ in cols)
            vals = [data[c] for c in cols]
            cursor = self.execute(
                f"INSERT INTO orders ({', '.join(cols)}) VALUES ({placeholders})",
                tuple(vals)
            )
            self.commit()
            return cursor.lastrowid

    # ------------------------------------------------------------------
    def upsert_subscribers(self, rows: list[dict]):
        """Bulk upsert subscribers from sync."""
        now = datetime.now().isoformat()
        self.execute("DELETE FROM subscribers")
        for row in rows:
            row["last_synced"] = now
            row["dirty"] = 0
            cols = list(row.keys())
            placeholders = ", ".join("?" for _ in cols)
            col_names = ", ".join(cols)
            vals = [row[c] for c in cols]
            self.execute(
                f"INSERT INTO subscribers ({col_names}) VALUES ({placeholders})",
                tuple(vals)
            )
        self.commit()

    # Subscribers (extended)
    # ------------------------------------------------------------------
    def get_subscribers(self, status: str = None, tier: str = None) -> list[dict]:
        sql = "SELECT * FROM subscribers WHERE 1=1"
        params = []
        if status:
            sql += " AND status = ?"
            params.append(status)
        if tier:
            sql += " AND tier = ?"
            params.append(tier)
        sql += " ORDER BY date_subscribed DESC"
        return self.fetchall(sql, tuple(params))

    def get_subscriber_stats(self) -> dict:
        total = self.fetchone("SELECT COUNT(*) as c FROM subscribers")["c"]
        active = self.fetchone("SELECT COUNT(*) as c FROM subscribers WHERE status = 'Active'")["c"]
        paid = self.fetchone("SELECT COUNT(*) as c FROM subscribers WHERE tier != 'Free' AND status = 'Active'")["c"]
        free = self.fetchone("SELECT COUNT(*) as c FROM subscribers WHERE tier = 'Free' AND status = 'Active'")["c"]
        unsub = self.fetchone("SELECT COUNT(*) as c FROM subscribers WHERE status = 'Unsubscribed'")["c"]
        return {"total": total, "active": active, "paid": paid, "free": free, "unsubscribed": unsub}

    # ------------------------------------------------------------------
    # Telegram Log
    # ------------------------------------------------------------------
    def log_telegram(self, message: str, status: str = "sent"):
        self.execute(
            "INSERT INTO telegram_log (message, sent_at, status) VALUES (?, ?, ?)",
            (message, datetime.now().isoformat(), status)
        )
        self.commit()

    def get_telegram_log(self, limit: int = 50) -> list[dict]:
        return self.fetchall(
            "SELECT * FROM telegram_log ORDER BY sent_at DESC LIMIT ?",
            (limit,)
        )

    # ------------------------------------------------------------------
    # Newsletter Log
    # ------------------------------------------------------------------
    def log_newsletter(self, subject: str, target: str, sent: int, failed: int):
        self.execute(
            "INSERT INTO newsletter_log (subject, target, sent_count, failed_count, sent_date) VALUES (?, ?, ?, ?, ?)",
            (subject, target, sent, failed, datetime.now().isoformat())
        )
        self.commit()

    def get_newsletter_log(self, limit: int = 20) -> list[dict]:
        return self.fetchall(
            "SELECT * FROM newsletter_log ORDER BY sent_date DESC LIMIT ?",
            (limit,)
        )

    # ------------------------------------------------------------------
    # Payments (computed from clients + invoices)
    # ------------------------------------------------------------------
    def get_payments(self, status: str = None) -> list[dict]:
        """Get all payments from clients table for the payments view."""
        sql = """SELECT id, job_number, name as client_name, service, type, price as amount,
                        paid as status, date,
                        CASE WHEN stripe_customer_id != '' THEN 'Stripe'
                             ELSE 'Cash/Bank' END as method
                 FROM clients WHERE price > 0"""
        params = []
        if status and status != "All":
            sql += " AND paid = ?"
            params.append(status)
        sql += " ORDER BY date DESC"
        return self.fetchall(sql, tuple(params))

    # ------------------------------------------------------------------
    # Job Photos
    # ------------------------------------------------------------------
    def save_photo(self, client_id: int, client_name: str, job_date: str,
                   photo_type: str, filename: str, caption: str = "") -> int:
        """Save a photo record. Returns the photo id."""
        cursor = self.execute(
            """INSERT INTO job_photos (client_id, client_name, job_date, photo_type,
               filename, caption, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (client_id, client_name, job_date, photo_type, filename, caption,
             datetime.now().isoformat())
        )
        self.commit()
        return cursor.lastrowid

    def get_photos(self, client_id: int = None, job_date: str = None,
                   photo_type: str = None) -> list[dict]:
        """Get photos with optional filters."""
        sql = "SELECT * FROM job_photos WHERE 1=1"
        params = []
        if client_id:
            sql += " AND client_id = ?"
            params.append(client_id)
        if job_date:
            sql += " AND job_date = ?"
            params.append(job_date)
        if photo_type:
            sql += " AND photo_type = ?"
            params.append(photo_type)
        sql += " ORDER BY created_at DESC"
        return self.fetchall(sql, tuple(params))

    def delete_photo(self, photo_id: int):
        """Delete a photo record."""
        self.execute("DELETE FROM job_photos WHERE id = ?", (photo_id,))
        self.commit()

    def get_photos_for_client(self, client_id: int) -> list[dict]:
        """Get all photos for a client, grouped by date."""
        return self.fetchall(
            "SELECT * FROM job_photos WHERE client_id = ? ORDER BY job_date DESC, photo_type ASC",
            (client_id,)
        )

    def get_all_photos_for_display(self, client_id: int = None,
                                   job_number: str = "") -> list[dict]:
        """Get all photos for a client/job, combining local and Drive sources."""
        conditions = []
        params = []
        if client_id and client_id > 0:
            conditions.append("client_id = ?")
            params.append(client_id)
        if job_number:
            conditions.append("job_number = ?")
            params.append(job_number)
        if not conditions:
            return []
        where = " OR ".join(conditions)
        return self.fetchall(
            f"SELECT * FROM job_photos WHERE ({where}) ORDER BY photo_type, created_at",
            tuple(params),
        )

    def upsert_job_photos(self, rows: list[dict]):
        """Upsert job photos from Sheets sync. Keyed on job_number + drive_file_id."""
        for row in rows:
            jn = row.get("job_number", "")
            fid = row.get("drive_file_id", "")
            if not jn or not fid:
                continue
            existing = self.fetchone(
                "SELECT id FROM job_photos WHERE job_number = ? AND drive_file_id = ?",
                (jn, fid),
            )
            if existing:
                self.execute(
                    """UPDATE job_photos SET photo_type=?, drive_url=?, caption=?,
                       telegram_file_id=?, created_at=? WHERE id=?""",
                    (row.get("photo_type", "before"), row.get("drive_url", ""),
                     row.get("caption", ""), row.get("telegram_file_id", ""),
                     row.get("created_at", ""), existing["id"]),
                )
            else:
                self.execute(
                    """INSERT INTO job_photos
                       (job_number, client_name, job_date, photo_type, filename,
                        drive_url, drive_file_id, telegram_file_id, source, caption, created_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (jn, row.get("client_name", ""), row.get("job_date", ""),
                     row.get("photo_type", "before"), "",
                     row.get("drive_url", ""), fid,
                     row.get("telegram_file_id", ""), "drive",
                     row.get("caption", ""), row.get("created_at", "")),
                )
        self.commit()

    def get_photo_counts(self, job_numbers: list[str]) -> dict[str, int]:
        """Get photo counts for multiple job numbers at once."""
        if not job_numbers:
            return {}
        placeholders = ",".join("?" * len(job_numbers))
        rows = self.fetchall(
            f"SELECT job_number, COUNT(*) as cnt FROM job_photos "
            f"WHERE job_number IN ({placeholders}) AND job_number != '' "
            f"GROUP BY job_number",
            tuple(job_numbers),
        )
        return {r["job_number"]: r["cnt"] for r in rows}

    # ------------------------------------------------------------------
    # Financial Dashboard Metrics
    # ------------------------------------------------------------------
    def set_metric(self, key: str, value: float):
        now = datetime.now().isoformat()
        self.execute(
            "INSERT OR REPLACE INTO financial_dashboard (metric_key, metric_value, updated_at) VALUES (?, ?, ?)",
            (key, value, now)
        )
        self.commit()

    def get_metric(self, key: str) -> float:
        row = self.fetchone("SELECT metric_value FROM financial_dashboard WHERE metric_key = ?", (key,))
        return row["metric_value"] if row else 0.0

    def get_all_metrics(self) -> dict:
        rows = self.fetchall("SELECT metric_key, metric_value FROM financial_dashboard")
        return {r["metric_key"]: r["metric_value"] for r in rows}

    # ------------------------------------------------------------------
    # App Settings
    # ------------------------------------------------------------------
    def get_setting(self, key: str, default: str = "") -> str:
        row = self.fetchone("SELECT value FROM app_settings WHERE key = ?", (key,))
        return row["value"] if row else default

    def set_setting(self, key: str, value: str):
        self.execute(
            "INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)",
            (key, value)
        )
        self.commit()

    # ------------------------------------------------------------------
    # Sync Log
    # ------------------------------------------------------------------
    def log_sync(self, table_name: str, direction: str, records: int,
                 status: str = "success", error: str = ""):
        self.execute(
            """INSERT INTO sync_log (table_name, direction, records_affected,
               status, error_message, timestamp) VALUES (?, ?, ?, ?, ?, ?)""",
            (table_name, direction, records, status, error, datetime.now().isoformat())
        )
        self.commit()

    def get_last_sync(self, table_name: str = None) -> Optional[str]:
        if table_name:
            row = self.fetchone(
                "SELECT timestamp FROM sync_log WHERE table_name = ? AND status = 'success' ORDER BY timestamp DESC LIMIT 1",
                (table_name,)
            )
        else:
            row = self.fetchone(
                "SELECT timestamp FROM sync_log WHERE status = 'success' ORDER BY timestamp DESC LIMIT 1"
            )
        return row["timestamp"] if row else None

    # ------------------------------------------------------------------
    # Search
    # ------------------------------------------------------------------
    def rebuild_search_index(self):
        """Rebuild the FTS5 search index from all tables."""
        self.execute("DELETE FROM search_index")

        # Index clients
        clients = self.fetchall("SELECT id, name, email, service, postcode, notes FROM clients")
        for c in clients:
            self.execute(
                "INSERT INTO search_index (source_table, source_id, name, email, details) VALUES (?, ?, ?, ?, ?)",
                ("clients", str(c["id"]), c["name"], c["email"],
                 f"{c['service']} {c['postcode']} {c['notes']}")
            )

        # Index invoices
        invoices = self.fetchall("SELECT id, invoice_number, client_name, client_email FROM invoices")
        for inv in invoices:
            self.execute(
                "INSERT INTO search_index (source_table, source_id, name, email, details) VALUES (?, ?, ?, ?, ?)",
                ("invoices", str(inv["id"]), inv["client_name"], inv["client_email"], inv["invoice_number"])
            )

        self.commit()
        log.info(f"Search index rebuilt: {len(clients)} clients, {len(invoices)} invoices")

    def search(self, query: str, limit: int = 50) -> list[dict]:
        """Full-text search across all indexed data."""
        if not query or len(query) < 2:
            return []
        try:
            # Add wildcard for prefix matching
            fts_query = f"{query}*"
            return self.fetchall(
                """SELECT source_table, source_id, name, email,
                   highlight(search_index, 2, '**', '**') as name_hl,
                   rank
                   FROM search_index WHERE search_index MATCH ?
                   ORDER BY rank LIMIT ?""",
                (fts_query, limit)
            )
        except Exception as e:
            log.warning(f"Search failed: {e}")
            return []

    # ------------------------------------------------------------------
    # Statistics (computed from local data)
    # ------------------------------------------------------------------
    def get_revenue_stats(self) -> dict:
        """Calculate revenue statistics matching GAS logic.

        GAS counts ALL non-cancelled jobs with price > 0,
        regardless of payment status. YTD uses UK tax year
        starting 6 April.
        """
        today_d = date.today()
        today = today_d.isoformat()
        month_start = f"{today_d.year}-{today_d.month:02d}-01"

        # ISO week start (Monday)
        week_start = (today_d - timedelta(days=today_d.weekday())).isoformat()

        # UK tax year starts 6 April
        if today_d >= date(today_d.year, 4, 6):
            ytd_start = f"{today_d.year}-04-06"
        else:
            ytd_start = f"{today_d.year - 1}-04-06"

        def sum_revenue(where: str, params: tuple = ()) -> float:
            """Sum price for all non-cancelled jobs with price > 0."""
            row = self.fetchone(
                f"SELECT COALESCE(SUM(price), 0) as total FROM clients "
                f"WHERE LOWER(status) != 'cancelled' AND price > 0 AND {where}",
                params
            )
            return row["total"] if row else 0.0

        # Active subscriptions: type contains 'subscription' (case-insensitive)
        active_subs = self.fetchone(
            "SELECT COUNT(*) as c FROM clients "
            "WHERE LOWER(type) LIKE '%subscription%' "
            "AND LOWER(status) IN ('active', 'confirmed', 'in progress', 'in-progress', 'scheduled')"
        )["c"]

        # Outstanding invoices: Unpaid, Sent, Overdue, Balance Due
        outstanding_invoices = self.fetchone(
            "SELECT COUNT(*) as c FROM invoices "
            "WHERE LOWER(status) IN ('unpaid', 'sent', 'overdue', 'balance due')"
        )["c"]
        outstanding_amount = self.fetchone(
            "SELECT COALESCE(SUM(amount), 0) as total FROM invoices "
            "WHERE LOWER(status) IN ('unpaid', 'sent', 'overdue', 'balance due')"
        )["total"]

        pending_enquiries = self.fetchone(
            "SELECT COUNT(*) as c FROM enquiries "
            "WHERE LOWER(status) IN ('new', 'pending')"
        )["c"]

        return {
            "today": sum_revenue("date = ?", (today,)),
            "week": sum_revenue("date >= ?", (week_start,)),
            "month": sum_revenue("date >= ?", (month_start,)),
            "ytd": sum_revenue("date >= ?", (ytd_start,)),
            "total_clients": self.fetchone("SELECT COUNT(*) as c FROM clients")["c"],
            "active_subs": active_subs,
            "outstanding_invoices": outstanding_invoices,
            "outstanding_amount": outstanding_amount,
            "pending_enquiries": pending_enquiries,
        }

    def get_revenue_by_service(self) -> list[dict]:
        """Revenue breakdown by service type."""
        return self.fetchall(
            """SELECT service, COUNT(*) as jobs, COALESCE(SUM(price), 0) as revenue
               FROM clients WHERE LOWER(status) != 'cancelled' AND price > 0
               GROUP BY service ORDER BY revenue DESC"""
        )

    def get_daily_revenue(self, days: int = 14) -> list[dict]:
        """Daily revenue for the last N days."""
        start = (date.today() - timedelta(days=days)).isoformat()
        return self.fetchall(
            """SELECT date, COUNT(*) as jobs, COALESCE(SUM(price), 0) as revenue
               FROM clients WHERE LOWER(status) != 'cancelled' AND price > 0
               AND date >= ? GROUP BY date ORDER BY date ASC""",
            (start,)
        )

    def get_status_counts(self) -> dict:
        """Count clients by status."""
        rows = self.fetchall(
            "SELECT status, COUNT(*) as count FROM clients GROUP BY status"
        )
        return {r["status"]: r["count"] for r in rows}

    # ------------------------------------------------------------------
    # Agent Schedules
    # ------------------------------------------------------------------
    def get_agent_schedules(self, enabled_only: bool = False) -> list[dict]:
        sql = "SELECT * FROM agent_schedules WHERE 1=1"
        params = []
        if enabled_only:
            sql += " AND enabled = 1"
        sql += " ORDER BY created_at DESC"
        return self.fetchall(sql, tuple(params))

    def get_agent_schedule(self, agent_id: int) -> Optional[dict]:
        return self.fetchone("SELECT * FROM agent_schedules WHERE id = ?", (agent_id,))

    def save_agent_schedule(self, data: dict) -> int:
        if data.get("id"):
            cols = [k for k in data if k != "id"]
            sets = ", ".join(f"{c} = ?" for c in cols)
            vals = [data[c] for c in cols] + [data["id"]]
            self.execute(f"UPDATE agent_schedules SET {sets} WHERE id = ?", tuple(vals))
            self.commit()
            return data["id"]
        else:
            data.setdefault("created_at", datetime.now().isoformat())
            cols = [k for k in data if k != "id"]
            placeholders = ", ".join("?" for _ in cols)
            vals = [data[c] for c in cols]
            cursor = self.execute(
                f"INSERT INTO agent_schedules ({', '.join(cols)}) VALUES ({placeholders})",
                tuple(vals)
            )
            self.commit()
            return cursor.lastrowid

    def delete_agent_schedule(self, agent_id: int):
        self.execute("DELETE FROM agent_runs WHERE agent_id = ?", (agent_id,))
        self.execute("DELETE FROM agent_schedules WHERE id = ?", (agent_id,))
        self.commit()

    def update_agent_next_run(self, agent_id: int, next_run: str, last_run: str = None):
        if last_run:
            self.execute(
                "UPDATE agent_schedules SET next_run = ?, last_run = ? WHERE id = ?",
                (next_run, last_run, agent_id)
            )
        else:
            self.execute(
                "UPDATE agent_schedules SET next_run = ? WHERE id = ?",
                (next_run, agent_id)
            )
        self.commit()

    # ------------------------------------------------------------------
    # Agent Runs
    # ------------------------------------------------------------------
    def log_agent_run(self, agent_id: int, agent_type: str, status: str,
                      output_title: str = "", output_text: str = "",
                      error_message: str = "") -> int:
        now = datetime.now().isoformat()
        cursor = self.execute(
            """INSERT INTO agent_runs (agent_id, agent_type, status, output_title,
               output_text, started_at, finished_at, error_message)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (agent_id, agent_type, status, output_title, output_text,
             now, now if status != "running" else "", error_message)
        )
        self.commit()
        return cursor.lastrowid

    def update_agent_run(self, run_id: int, status: str, output_title: str = "",
                         output_text: str = "", error_message: str = "",
                         published: int = 0):
        self.execute(
            """UPDATE agent_runs SET status = ?, output_title = ?, output_text = ?,
               finished_at = ?, error_message = ?, published = ?
               WHERE id = ?""",
            (status, output_title, output_text, datetime.now().isoformat(),
             error_message, published, run_id)
        )
        self.commit()

    def get_agent_runs(self, agent_id: int = None, limit: int = 50) -> list[dict]:
        sql = "SELECT * FROM agent_runs WHERE 1=1"
        params = []
        if agent_id:
            sql += " AND agent_id = ?"
            params.append(agent_id)
        sql += " ORDER BY started_at DESC LIMIT ?"
        params.append(limit)
        return self.fetchall(sql, tuple(params))

    def get_agent_run(self, run_id: int) -> Optional[dict]:
        return self.fetchone("SELECT * FROM agent_runs WHERE id = ?", (run_id,))

    # ------------------------------------------------------------------
    # Email Tracking
    # ------------------------------------------------------------------
    def log_email(self, client_id: int, client_name: str, client_email: str,
                  email_type: str, subject: str, status: str = "sent",
                  template_used: str = "", notes: str = "") -> int:
        cursor = self.execute(
            """INSERT INTO email_tracking (client_id, client_name, client_email,
               email_type, subject, status, sent_at, template_used, notes)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (client_id, client_name, client_email, email_type, subject,
             status, datetime.now().isoformat(), template_used, notes)
        )
        self.commit()
        return cursor.lastrowid

    def get_email_tracking(self, client_id: int = None, email_type: str = None,
                           limit: int = 100) -> list[dict]:
        sql = "SELECT * FROM email_tracking WHERE 1=1"
        params = []
        if client_id:
            sql += " AND client_id = ?"
            params.append(client_id)
        if email_type:
            sql += " AND email_type = ?"
            params.append(email_type)
        sql += " ORDER BY sent_at DESC LIMIT ?"
        params.append(limit)
        return self.fetchall(sql, tuple(params))

    def get_email_stats(self) -> dict:
        total = self.fetchone("SELECT COUNT(*) as c FROM email_tracking")["c"]
        by_type = self.fetchall(
            "SELECT email_type, COUNT(*) as count FROM email_tracking GROUP BY email_type ORDER BY count DESC"
        )
        recent = self.fetchone(
            "SELECT sent_at FROM email_tracking ORDER BY sent_at DESC LIMIT 1"
        )
        clients_emailed = self.fetchone(
            "SELECT COUNT(DISTINCT client_id) as c FROM email_tracking"
        )["c"]
        return {
            "total": total,
            "by_type": {r["email_type"]: r["count"] for r in by_type},
            "last_sent": recent["sent_at"] if recent else "Never",
            "clients_reached": clients_emailed,
        }

    # ------------------------------------------------------------------
    # Blog Posts
    # ------------------------------------------------------------------
    def get_blog_posts(self, status: str = None) -> list[dict]:
        sql = "SELECT * FROM blog_posts WHERE 1=1"
        params = []
        if status:
            sql += " AND status = ?"
            params.append(status)
        sql += " ORDER BY created_date DESC"
        return self.fetchall(sql, tuple(params))

    def get_blog_post(self, blog_id: int = None, post_id: str = None) -> Optional[dict]:
        if blog_id:
            return self.fetchone("SELECT * FROM blog_posts WHERE id = ?", (blog_id,))
        if post_id:
            return self.fetchone("SELECT * FROM blog_posts WHERE post_id = ?", (post_id,))
        return None

    def save_blog_post(self, data: dict) -> int:
        data["dirty"] = 1
        data["updated_at"] = datetime.now().isoformat()
        if data.get("id"):
            cols = [k for k in data if k != "id"]
            sets = ", ".join(f"{c} = ?" for c in cols)
            vals = [data[c] for c in cols] + [data["id"]]
            self.execute(f"UPDATE blog_posts SET {sets} WHERE id = ?", tuple(vals))
            self.commit()
            return data["id"]
        else:
            data.setdefault("created_date", datetime.now().isoformat()[:10])
            data.setdefault("post_id", f"post_{int(datetime.now().timestamp())}")
            cols = [k for k in data if k != "id"]
            placeholders = ", ".join("?" for _ in cols)
            vals = [data[c] for c in cols]
            cursor = self.execute(
                f"INSERT INTO blog_posts ({', '.join(cols)}) VALUES ({placeholders})",
                tuple(vals)
            )
            self.commit()
            return cursor.lastrowid

    def delete_blog_post(self, blog_id: int):
        self.execute("DELETE FROM blog_posts WHERE id = ?", (blog_id,))
        self.commit()

    def upsert_blog_posts(self, rows: list[dict]):
        """Bulk upsert blog posts from GAS sync."""
        now = datetime.now().isoformat()
        for row in rows:
            existing = self.fetchone(
                "SELECT id FROM blog_posts WHERE post_id = ?",
                (row.get("post_id", row.get("id", "")),)
            )
            row["last_synced"] = now
            row["dirty"] = 0
            if existing:
                cols = [k for k in row if k not in ("id",)]
                sets = ", ".join(f"{c} = ?" for c in cols)
                vals = [row[c] for c in cols] + [existing["id"]]
                self.execute(f"UPDATE blog_posts SET {sets} WHERE id = ?", tuple(vals))
            else:
                if "post_id" not in row and "id" in row:
                    row["post_id"] = str(row.pop("id"))
                cols = [k for k in row if k != "id"]
                placeholders = ", ".join("?" for _ in cols)
                vals = [row[c] for c in cols]
                self.execute(
                    f"INSERT INTO blog_posts ({', '.join(cols)}) VALUES ({placeholders})",
                    tuple(vals)
                )
        self.commit()

    def get_blog_stats(self) -> dict:
        total = self.fetchone("SELECT COUNT(*) as c FROM blog_posts")["c"]
        published = self.fetchone("SELECT COUNT(*) as c FROM blog_posts WHERE status = 'Published'")["c"]
        drafts = self.fetchone("SELECT COUNT(*) as c FROM blog_posts WHERE status = 'Draft'")["c"]
        return {"total": total, "published": published, "drafts": drafts}

    # ------------------------------------------------------------------
    # Social Media Posts
    # ------------------------------------------------------------------
    def save_social_post(self, data: dict) -> int:
        data.setdefault("created_at", datetime.now().isoformat())
        if data.get("id"):
            cols = [k for k in data if k != "id"]
            sets = ", ".join(f"{c} = ?" for c in cols)
            vals = [data[c] for c in cols] + [data["id"]]
            self.execute(f"UPDATE social_posts SET {sets} WHERE id = ?", tuple(vals))
            self.commit()
            return data["id"]
        else:
            cols = [k for k in data if k != "id"]
            placeholders = ", ".join("?" for _ in cols)
            vals = [data[c] for c in cols]
            cursor = self.execute(
                f"INSERT INTO social_posts ({', '.join(cols)}) VALUES ({placeholders})",
                tuple(vals)
            )
            self.commit()
            return cursor.lastrowid

    def get_social_posts(self, status: str = None, limit: int = 50) -> list[dict]:
        sql = "SELECT * FROM social_posts WHERE 1=1"
        params = []
        if status:
            sql += " AND status = ?"
            params.append(status)
        sql += " ORDER BY created_at DESC LIMIT ?"
        params.append(limit)
        return self.fetchall(sql, tuple(params))

    # ------------------------------------------------------------------
    # Email Automation Log
    # ------------------------------------------------------------------
    def log_email_automation(self, trigger_type: str, client_id: int, client_name: str,
                              client_email: str, email_type: str, status: str = "sent",
                              gas_response: str = "") -> int:
        cursor = self.execute(
            """INSERT INTO email_automation_log (trigger_type, client_id, client_name,
               client_email, email_type, status, gas_response, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (trigger_type, client_id, client_name, client_email, email_type,
             status, gas_response, datetime.now().isoformat())
        )
        self.commit()
        return cursor.lastrowid

    def get_email_automation_log(self, limit: int = 100) -> list[dict]:
        return self.fetchall(
            "SELECT * FROM email_automation_log ORDER BY created_at DESC LIMIT ?",
            (limit,)
        )

    def get_todays_auto_email_count(self) -> int:
        today = date.today().isoformat()
        row = self.fetchone(
            "SELECT COUNT(*) as c FROM email_automation_log WHERE created_at >= ?",
            (today,)
        )
        return row["c"] if row else 0

    def get_jobs_needing_reminder(self, target_date: str) -> list[dict]:
        """Get confirmed jobs for a target date that haven't had a reminder sent."""
        jobs = self.get_todays_jobs(target_date)
        reminded = self.fetchall(
            """SELECT DISTINCT client_name FROM email_automation_log
               WHERE email_type = 'day_before_reminder'
               AND created_at >= date(?, '-1 day')""",
            (target_date,)
        )
        reminded_names = {r["client_name"] for r in reminded}
        return [j for j in jobs if j.get("client_name", j.get("name", "")) not in reminded_names
                and j.get("status") not in ("Cancelled", "Complete")]

    def get_completed_jobs_needing_email(self, target_date: str) -> list[dict]:
        """Get jobs completed today that haven't had a completion email sent."""
        jobs = self.fetchall(
            """SELECT * FROM clients
               WHERE date = ? AND status = 'Complete'
               ORDER BY time ASC""",
            (target_date,)
        )
        emailed = self.fetchall(
            """SELECT DISTINCT client_name FROM email_tracking
               WHERE email_type = 'job_complete' AND sent_at >= ?""",
            (target_date,)
        )
        emailed_names = {r["client_name"] for r in emailed}
        return [j for j in jobs if j.get("name", "") not in emailed_names]

    # ------------------------------------------------------------------
    # New Lifecycle Queries
    # ------------------------------------------------------------------
    def get_unsent_invoices(self) -> list[dict]:
        """Get invoices that haven't had an invoice email sent yet."""
        invoices = self.fetchall(
            """SELECT * FROM invoices
               WHERE status = 'Unpaid' AND client_email != ''
               AND issue_date != ''
               ORDER BY issue_date DESC"""
        )
        emailed = self.fetchall(
            """SELECT DISTINCT client_email, notes FROM email_tracking
               WHERE email_type = 'invoice_sent' AND status = 'sent'"""
        )
        # Build set of "email|invoice_number" to detect duplicates
        emailed_keys = set()
        for e in emailed:
            notes = e.get("notes", "")
            email = e.get("client_email", "")
            emailed_keys.add(f"{email}|{notes}")

        return [inv for inv in invoices
                if f"{inv.get('client_email','')}|{inv.get('invoice_number','')}"
                not in emailed_keys]

    def get_jobs_needing_follow_up(self, days_ago: int = 3) -> list[dict]:
        """Get completed jobs from X days ago that haven't had a follow-up."""
        target = (date.today() - timedelta(days=days_ago)).isoformat()
        jobs = self.fetchall(
            """SELECT * FROM clients
               WHERE date = ? AND status = 'Complete' AND email != ''
               ORDER BY name ASC""",
            (target,)
        )
        emailed = self.fetchall(
            """SELECT DISTINCT client_email FROM email_tracking
               WHERE email_type = 'follow_up' AND status = 'sent'
               AND sent_at >= ?""",
            (target,)
        )
        emailed_emails = {r["client_email"] for r in emailed}
        return [j for j in jobs if j.get("email", "") not in emailed_emails]

    def get_new_bookings_needing_confirmation(self) -> list[dict]:
        """Get bookings confirmed today that haven't had a confirmation email."""
        today = date.today().isoformat()
        # Clients with status 'Confirmed' updated today
        clients = self.fetchall(
            """SELECT * FROM clients
               WHERE status = 'Confirmed' AND email != ''
               AND (updated_at >= ? OR created_at >= ?)
               ORDER BY name ASC""",
            (today, today)
        )
        emailed = self.fetchall(
            """SELECT DISTINCT client_email FROM email_tracking
               WHERE email_type = 'booking_confirmed' AND status = 'sent'
               AND sent_at >= ?""",
            (today,)
        )
        emailed_emails = {r["client_email"] for r in emailed}
        return [c for c in clients if c.get("email", "") not in emailed_emails]

    def get_new_subscription_clients(self) -> list[dict]:
        """Get clients with recurring frequency added today that haven't had a welcome."""
        today = date.today().isoformat()
        clients = self.fetchall(
            """SELECT * FROM clients
               WHERE frequency NOT IN ('One-Off', '')
               AND email != ''
               AND (created_at >= ? OR updated_at >= ?)
               ORDER BY name ASC""",
            (today, today)
        )
        emailed = self.fetchall(
            """SELECT DISTINCT client_email FROM email_tracking
               WHERE email_type = 'subscription_welcome' AND status = 'sent'"""
        )
        emailed_emails = {r["client_email"] for r in emailed}
        return [c for c in clients if c.get("email", "") not in emailed_emails]

    def get_clients_at_loyalty_milestone(self, milestones: list[int] = None) -> list[dict]:
        """Get clients who have just reached a loyalty milestone (5, 10, 20, 50 jobs)."""
        if milestones is None:
            milestones = [5, 10, 20, 50]
        clients = self.fetchall(
            """SELECT name, email, COUNT(*) as job_count
               FROM clients
               WHERE status = 'Complete' AND email != ''
               GROUP BY email
               HAVING job_count IN ({})
               ORDER BY job_count DESC""".format(",".join("?" * len(milestones))),
            tuple(milestones)
        )
        emailed = self.fetchall(
            """SELECT DISTINCT client_email, notes FROM email_tracking
               WHERE email_type = 'thank_you' AND status = 'sent'"""
        )
        # Track which milestones have been thanked per email
        thanked = {}
        for e in emailed:
            em = e.get("client_email", "")
            n = e.get("notes", "")
            if em not in thanked:
                thanked[em] = set()
            thanked[em].add(n)

        results = []
        for c in clients:
            email = c.get("email", "")
            count = c.get("job_count", 0)
            milestone_key = f"milestone_{count}"
            if email not in thanked or milestone_key not in thanked.get(email, set()):
                results.append(c)
        return results
