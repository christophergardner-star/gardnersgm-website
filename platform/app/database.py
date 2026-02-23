"""
SQLite database layer for GGM Hub.
Defines schema, migrations, and CRUD operations.
All data is stored locally for instant access; sync engine handles cloud updates.
"""

import sqlite3
import json
import logging
import shutil
import threading
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
    payment_type    TEXT DEFAULT '',
    deposit_amount  REAL DEFAULT 0,
    stripe_customer_id    TEXT DEFAULT '',
    stripe_subscription_id TEXT DEFAULT '',
    waste_collection TEXT DEFAULT 'Not Set',
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

-- ─── Schedule (aligned with GAS Schedule sheet columns) ────────
CREATE TABLE IF NOT EXISTS schedule (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    sheets_row      INTEGER,
    client_name     TEXT DEFAULT '',
    email           TEXT DEFAULT '',
    phone           TEXT DEFAULT '',
    address         TEXT DEFAULT '',
    postcode        TEXT DEFAULT '',
    service         TEXT DEFAULT '',
    package         TEXT DEFAULT '',
    date            TEXT DEFAULT '',
    time            TEXT DEFAULT '',
    preferred_day   TEXT DEFAULT '',
    status          TEXT DEFAULT 'Scheduled',
    parent_job      TEXT DEFAULT '',
    distance        TEXT DEFAULT '',
    drive_time      TEXT DEFAULT '',
    google_maps     TEXT DEFAULT '',
    notes           TEXT DEFAULT '',
    created_by      TEXT DEFAULT '',
    dirty           INTEGER DEFAULT 0,
    last_synced     TEXT DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_schedule_date ON schedule(date);
CREATE INDEX IF NOT EXISTS idx_schedule_client ON schedule(client_name);
CREATE INDEX IF NOT EXISTS idx_schedule_status ON schedule(status);

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
    job_number      TEXT DEFAULT '',
    enquiry_id      INTEGER DEFAULT 0,
    enquiry_message TEXT DEFAULT '',
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
    photo_urls      TEXT DEFAULT '',
    discount_code   TEXT DEFAULT '',
    garden_details  TEXT DEFAULT '',
    address         TEXT DEFAULT '',
    postcode        TEXT DEFAULT '',
    preferred_date  TEXT DEFAULT '',
    preferred_time  TEXT DEFAULT '',
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

-- ─── Job Tracking (field app time tracking, synced from Sheets) ─
CREATE TABLE IF NOT EXISTS job_tracking (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    job_ref          TEXT NOT NULL DEFAULT '',
    start_time       TEXT DEFAULT '',
    end_time         TEXT DEFAULT '',
    duration_mins    REAL DEFAULT 0,
    notes            TEXT DEFAULT '',
    photo_count      INTEGER DEFAULT 0,
    is_active        INTEGER DEFAULT 0,
    UNIQUE(job_ref, start_time)
);

CREATE INDEX IF NOT EXISTS idx_job_tracking_ref ON job_tracking(job_ref);
CREATE INDEX IF NOT EXISTS idx_job_tracking_start ON job_tracking(start_time);

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

-- ─── Email Preferences (synced from GAS) ───────────────────────
CREATE TABLE IF NOT EXISTS email_preferences (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    client_email    TEXT UNIQUE NOT NULL,
    client_name     TEXT DEFAULT '',
    marketing_opt_in INTEGER DEFAULT 1,
    transactional_opt_in INTEGER DEFAULT 1,
    newsletter_opt_in INTEGER DEFAULT 1,
    unsubscribed_at TEXT DEFAULT '',
    updated_at      TEXT DEFAULT '',
    dirty           INTEGER DEFAULT 0,
    last_synced     TEXT DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_emailpref_email ON email_preferences(client_email);

-- ─── Reschedule Log ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reschedule_log (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    client_name     TEXT DEFAULT '',
    client_email    TEXT DEFAULT '',
    service         TEXT DEFAULT '',
    old_date        TEXT DEFAULT '',
    old_time        TEXT DEFAULT '',
    new_date        TEXT DEFAULT '',
    new_time        TEXT DEFAULT '',
    reason          TEXT DEFAULT '',
    notified        INTEGER DEFAULT 0,
    created_at      TEXT DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_resched_date ON reschedule_log(created_at);

-- ─── Cancellation Log ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cancellation_log (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    client_name     TEXT DEFAULT '',
    client_email    TEXT DEFAULT '',
    service         TEXT DEFAULT '',
    job_date        TEXT DEFAULT '',
    reason          TEXT DEFAULT '',
    notified        INTEGER DEFAULT 0,
    created_at      TEXT DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_cancel_date ON cancellation_log(created_at);

-- ─── Pending Deletes (tombstone registry) ──────────────────────
-- Tracks records deleted locally so the sync engine won't re-create
-- them from Sheets before the GAS delete has been confirmed.
CREATE TABLE IF NOT EXISTS pending_deletes (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    table_name      TEXT NOT NULL,
    record_key      TEXT NOT NULL,
    deleted_at      TEXT NOT NULL,
    synced          INTEGER DEFAULT 0,
    UNIQUE(table_name, record_key)
);

CREATE INDEX IF NOT EXISTS idx_pending_deletes_lookup
    ON pending_deletes(table_name, record_key);

-- ═══════════════════════════════════════════════════════════════
-- Accounting & Xero Integration Tables (v5.0.0)
-- ═══════════════════════════════════════════════════════════════

-- ─── Invoice Line Items (structured for Xero) ─────────────────
CREATE TABLE IF NOT EXISTS invoice_line_items (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id      INTEGER NOT NULL,
    description     TEXT NOT NULL DEFAULT '',
    quantity        REAL DEFAULT 1,
    unit_price      REAL DEFAULT 0,
    discount_pct    REAL DEFAULT 0,
    tax_rate        REAL DEFAULT 20.0,
    tax_amount      REAL DEFAULT 0,
    line_total      REAL DEFAULT 0,
    account_code    TEXT DEFAULT '200',
    item_code       TEXT DEFAULT '',
    created_at      TEXT DEFAULT '',
    FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_line_items_invoice ON invoice_line_items(invoice_id);

-- ─── Payments (separate from invoices for proper reconciliation) ─
CREATE TABLE IF NOT EXISTS payments (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    payment_ref     TEXT UNIQUE,
    invoice_id      INTEGER,
    invoice_number  TEXT DEFAULT '',
    client_name     TEXT DEFAULT '',
    client_email    TEXT DEFAULT '',
    amount          REAL NOT NULL DEFAULT 0,
    currency        TEXT DEFAULT 'GBP',
    payment_method  TEXT DEFAULT '',
    payment_date    TEXT DEFAULT '',
    stripe_payment_id TEXT DEFAULT '',
    bank_ref        TEXT DEFAULT '',
    is_deposit      INTEGER DEFAULT 0,
    notes           TEXT DEFAULT '',
    xero_payment_id TEXT DEFAULT '',
    reconciled      INTEGER DEFAULT 0,
    created_at      TEXT DEFAULT '',
    FOREIGN KEY (invoice_id) REFERENCES invoices(id)
);

CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_payments_date ON payments(payment_date);
CREATE INDEX IF NOT EXISTS idx_payments_reconciled ON payments(reconciled);

-- ─── Credit Notes ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS credit_notes (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    credit_note_number TEXT UNIQUE,
    invoice_id      INTEGER,
    invoice_number  TEXT DEFAULT '',
    client_name     TEXT DEFAULT '',
    client_email    TEXT DEFAULT '',
    amount          REAL NOT NULL DEFAULT 0,
    reason          TEXT DEFAULT '',
    status          TEXT DEFAULT 'Draft',
    issue_date      TEXT DEFAULT '',
    xero_credit_id  TEXT DEFAULT '',
    notes           TEXT DEFAULT '',
    created_at      TEXT DEFAULT '',
    FOREIGN KEY (invoice_id) REFERENCES invoices(id)
);

CREATE INDEX IF NOT EXISTS idx_credit_notes_invoice ON credit_notes(invoice_id);

-- ─── Tax Periods (VAT tracking for Making Tax Digital) ─────────
CREATE TABLE IF NOT EXISTS tax_periods (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    period_start    TEXT NOT NULL,
    period_end      TEXT NOT NULL,
    total_sales     REAL DEFAULT 0,
    total_vat_collected REAL DEFAULT 0,
    total_expenses  REAL DEFAULT 0,
    total_vat_paid  REAL DEFAULT 0,
    net_vat         REAL DEFAULT 0,
    status          TEXT DEFAULT 'Open',
    submitted_at    TEXT DEFAULT '',
    xero_return_id  TEXT DEFAULT '',
    notes           TEXT DEFAULT ''
);

-- ─── Xero Sync Mapping ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS xero_sync (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    local_table     TEXT NOT NULL,
    local_id        INTEGER NOT NULL,
    xero_id         TEXT NOT NULL DEFAULT '',
    xero_type       TEXT DEFAULT '',
    last_synced     TEXT DEFAULT '',
    sync_status     TEXT DEFAULT 'pending',
    error_message   TEXT DEFAULT '',
    UNIQUE(local_table, local_id)
);

CREATE INDEX IF NOT EXISTS idx_xero_sync_status ON xero_sync(sync_status);

-- ─── Audit Trail (immutable financial record changes) ──────────
CREATE TABLE IF NOT EXISTS audit_trail (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    table_name      TEXT NOT NULL,
    record_id       INTEGER NOT NULL,
    action          TEXT NOT NULL,
    field_name      TEXT DEFAULT '',
    old_value       TEXT DEFAULT '',
    new_value       TEXT DEFAULT '',
    changed_by      TEXT DEFAULT 'system',
    changed_at      TEXT NOT NULL,
    ip_address      TEXT DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_audit_trail_table ON audit_trail(table_name, record_id);
CREATE INDEX IF NOT EXISTS idx_audit_trail_date ON audit_trail(changed_at);

-- ─── Expense Categories (chart of accounts mapping) ────────────
CREATE TABLE IF NOT EXISTS expense_categories (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT UNIQUE NOT NULL,
    xero_account_code TEXT DEFAULT '',
    tax_deductible  INTEGER DEFAULT 1,
    parent_category TEXT DEFAULT '',
    description     TEXT DEFAULT ''
);

-- ─── Email Inbox (inbound IMAP emails) ─────────────────────────
CREATE TABLE IF NOT EXISTS inbox (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id      TEXT UNIQUE NOT NULL,
    from_name       TEXT DEFAULT '',
    from_email      TEXT DEFAULT '',
    to_email        TEXT DEFAULT '',
    subject         TEXT DEFAULT '',
    body_text       TEXT DEFAULT '',
    body_html       TEXT DEFAULT '',
    date_received   TEXT DEFAULT '',
    is_read         INTEGER DEFAULT 0,
    is_starred      INTEGER DEFAULT 0,
    is_archived     INTEGER DEFAULT 0,
    is_replied      INTEGER DEFAULT 0,
    folder          TEXT DEFAULT 'INBOX',
    has_attachments INTEGER DEFAULT 0,
    attachment_info TEXT DEFAULT '',
    labels          TEXT DEFAULT '',
    client_name     TEXT DEFAULT '',
    fetched_at      TEXT DEFAULT '',
    is_deleted      INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_inbox_date ON inbox(date_received);
CREATE INDEX IF NOT EXISTS idx_inbox_from ON inbox(from_email);
CREATE INDEX IF NOT EXISTS idx_inbox_read ON inbox(is_read);
CREATE INDEX IF NOT EXISTS idx_inbox_msgid ON inbox(message_id);
"""


class Database:
    """SQLite database manager with CRUD operations.

    Thread-safe: all execute/commit operations are protected by an RLock
    to prevent concurrent access from UI, sync, email, and agent threads.
    """

    def __init__(self, db_path: Path = None):
        self.db_path = db_path or config.DB_PATH
        self.conn: Optional[sqlite3.Connection] = None
        self._lock = threading.RLock()

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
            ("clients", "waste_collection", "TEXT DEFAULT 'Not Set'"),
            ("business_costs", "waste_disposal", "REAL DEFAULT 0"),
            ("business_costs", "treatment_products", "REAL DEFAULT 0"),
            ("business_costs", "consumables", "REAL DEFAULT 0"),
            ("email_tracking", "provider", "TEXT DEFAULT ''"),
            ("email_tracking", "message_id", "TEXT DEFAULT ''"),
            # Schedule table alignment with GAS Schedule sheet (v4.6.0)
            ("schedule", "email", "TEXT DEFAULT ''"),
            ("schedule", "package", "TEXT DEFAULT ''"),
            ("schedule", "preferred_day", "TEXT DEFAULT ''"),
            ("schedule", "parent_job", "TEXT DEFAULT ''"),
            ("schedule", "distance", "TEXT DEFAULT ''"),
            ("schedule", "drive_time", "TEXT DEFAULT ''"),
            ("schedule", "google_maps", "TEXT DEFAULT ''"),
            ("schedule", "created_by", "TEXT DEFAULT ''"),
            # Enquiry photos & discount codes (v4.3.0)
            ("enquiries", "photo_urls", "TEXT DEFAULT ''"),
            ("enquiries", "discount_code", "TEXT DEFAULT ''"),
            # Enquiry garden details + location (v4.8.0)
            ("enquiries", "garden_details", "TEXT DEFAULT ''"),
            ("enquiries", "address", "TEXT DEFAULT ''"),
            ("enquiries", "postcode", "TEXT DEFAULT ''"),
            ("enquiries", "preferred_date", "TEXT DEFAULT ''"),
            ("enquiries", "preferred_time", "TEXT DEFAULT ''"),
            # Quote ↔ Job ↔ Enquiry linkage (v4.9.0)
            ("quotes", "job_number", "TEXT DEFAULT ''"),
            ("quotes", "enquiry_id", "INTEGER DEFAULT 0"),
            ("quotes", "enquiry_message", "TEXT DEFAULT ''"),
            ("clients", "quote_number", "TEXT DEFAULT ''"),
            ("enquiries", "quote_number", "TEXT DEFAULT ''"),
            # Deposit/payment tracking (v4.9.1)
            ("clients", "payment_type", "TEXT DEFAULT ''"),
            ("clients", "deposit_amount", "REAL DEFAULT 0"),
            # Xero/accounting readiness (v5.0.0)
            ("invoices", "subtotal", "REAL DEFAULT 0"),
            ("invoices", "vat_rate", "REAL DEFAULT 20.0"),
            ("invoices", "vat_amount", "REAL DEFAULT 0"),
            ("invoices", "currency", "TEXT DEFAULT 'GBP'"),
            ("invoices", "xero_invoice_id", "TEXT DEFAULT ''"),
            ("invoices", "payment_terms", "TEXT DEFAULT 'DueOnReceipt'"),
            ("invoices", "reference", "TEXT DEFAULT ''"),
            ("invoices", "is_finalised", "INTEGER DEFAULT 0"),
            ("business_costs", "category", "TEXT DEFAULT ''"),
            ("business_costs", "xero_account_code", "TEXT DEFAULT ''"),
            ("business_costs", "receipt_url", "TEXT DEFAULT ''"),
            ("business_costs", "vat_amount", "REAL DEFAULT 0"),
            # Inbox soft-delete (v5.0.1)
            ("inbox", "is_deleted", "INTEGER DEFAULT 0"),
            # PDF invoice storage (v5.0.2)
            ("invoices", "pdf_path", "TEXT DEFAULT ''"),
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
            "CREATE INDEX IF NOT EXISTS idx_quotes_job ON quotes(job_number)",
            "CREATE INDEX IF NOT EXISTS idx_quotes_enquiry ON quotes(enquiry_id)",
            "CREATE INDEX IF NOT EXISTS idx_clients_quote ON clients(quote_number)",
        ]:
            try:
                self.conn.execute(idx_sql)
            except Exception:
                pass
        self.conn.commit()

        log.info(f"Database schema initialized (v{SCHEMA_VERSION})")

        # Seed default data
        self.seed_expense_categories()

    # ------------------------------------------------------------------
    # Pending Deletes — tombstone registry
    # ------------------------------------------------------------------
    def register_pending_delete(self, table_name: str, record_key: str):
        """Register a record as pending deletion so sync won't re-create it."""
        now = datetime.now().isoformat()
        try:
            self.execute(
                "INSERT OR REPLACE INTO pending_deletes (table_name, record_key, deleted_at, synced) "
                "VALUES (?, ?, ?, 0)",
                (table_name, record_key, now),
            )
            self.commit()
            log.info(f"Registered pending delete: {table_name}/{record_key}")
        except Exception as e:
            log.error(f"Failed to register pending delete: {e}")

    def is_pending_delete(self, table_name: str, record_key: str) -> bool:
        """Check if a record is pending deletion (should not be re-created by sync)."""
        row = self.fetchone(
            "SELECT id FROM pending_deletes WHERE table_name = ? AND record_key = ?",
            (table_name, record_key),
        )
        return row is not None

    def get_pending_deletes(self, table_name: str) -> set:
        """Get all record keys pending deletion for a given table."""
        rows = self.fetchall(
            "SELECT record_key FROM pending_deletes WHERE table_name = ?",
            (table_name,),
        )
        return {r["record_key"] for r in rows}

    def clear_pending_delete(self, table_name: str, record_key: str):
        """Remove a pending delete after the GAS delete has been confirmed."""
        self.execute(
            "DELETE FROM pending_deletes WHERE table_name = ? AND record_key = ?",
            (table_name, record_key),
        )
        self.commit()
        log.info(f"Cleared pending delete: {table_name}/{record_key}")

    def purge_old_pending_deletes(self, max_age_hours: int = 48):
        """Remove pending deletes older than max_age_hours (safety valve)."""
        cutoff = (datetime.now() - timedelta(hours=max_age_hours)).isoformat()
        deleted = self.execute(
            "DELETE FROM pending_deletes WHERE deleted_at < ?", (cutoff,)
        )
        if deleted.rowcount:
            self.commit()
            log.info(f"Purged {deleted.rowcount} stale pending deletes")

    # ------------------------------------------------------------------
    # Backup
    # ------------------------------------------------------------------
    def backup(self, keep: int = 7):
        """Create a daily backup of the database. Returns backup path or None."""
        today = date.today().isoformat()
        backup_path = config.BACKUP_DIR / f"ggm_hub_{today}.db"
        if not backup_path.exists():
            # Use SQLite online backup API for crash-safe copy
            try:
                dst = sqlite3.connect(str(backup_path))
                self._ensure_connected()
                self.conn.backup(dst)
                dst.close()
            except Exception:
                # Fallback to file copy if backup API unavailable
                shutil.copy2(str(self.db_path), str(backup_path))
            log.info(f"Backup created: {backup_path.name}")
            # Prune old backups
            backups = sorted(config.BACKUP_DIR.glob("ggm_hub_*.db"))
            for old in backups[:-keep]:
                old.unlink()
                log.info(f"Old backup removed: {old.name}")
            return str(backup_path)
        return None

    # ------------------------------------------------------------------
    # Generic CRUD helpers
    # ------------------------------------------------------------------
    def _ensure_connected(self):
        """Auto-reconnect if the database connection was lost."""
        if self.conn is None:
            log.warning("Database connection lost — reconnecting...")
            self.conn = sqlite3.connect(
                str(self.db_path), timeout=30, check_same_thread=False,
            )
            self.conn.row_factory = sqlite3.Row
            self.conn.execute("PRAGMA journal_mode=WAL")
            self.conn.execute("PRAGMA busy_timeout=5000")
            self.conn.execute("PRAGMA synchronous=NORMAL")
            self.conn.execute("PRAGMA foreign_keys=ON")
            log.info("Database reconnected: %s", self.db_path)

    def execute(self, sql: str, params: tuple = ()) -> sqlite3.Cursor:
        with self._lock:
            self._ensure_connected()
            return self.conn.execute(sql, params)

    def fetchall(self, sql: str, params: tuple = ()) -> list[dict]:
        with self._lock:
            self._ensure_connected()
            cursor = self.conn.execute(sql, params)
            return [dict(row) for row in cursor.fetchall()]

    def fetchone(self, sql: str, params: tuple = ()) -> Optional[dict]:
        with self._lock:
            self._ensure_connected()
            cursor = self.conn.execute(sql, params)
            row = cursor.fetchone()
            return dict(row) if row else None

    def commit(self):
        with self._lock:
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

    def delete_notification(self, notification_id: int):
        """Delete a single notification by ID."""
        self.execute("DELETE FROM notifications WHERE id = ?",
                     (notification_id,))
        self.commit()

    def clear_all_notifications(self):
        """Delete all notifications."""
        self.execute("DELETE FROM notifications")
        self.commit()

    def get_recent_bookings(self, days: int = 7, limit: int = 20) -> list[dict]:
        """Get bookings created in the last N days, newest first."""
        cutoff = (date.today() - timedelta(days=days)).isoformat()
        return self.fetchall(
            """SELECT * FROM clients
               WHERE created_at >= ? AND created_at != ''
               ORDER BY created_at DESC LIMIT ?""",
            (cutoff, limit)
        )

    # ------------------------------------------------------------------
    # Clients
    # ------------------------------------------------------------------
    def get_client_count(self) -> int:
        """Get total number of clients in the database."""
        row = self.fetchone("SELECT COUNT(*) as c FROM clients")
        return row["c"] if row else 0

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
                 AND status NOT IN ('Cancelled', 'Complete', 'Completed')
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
        """Bulk upsert clients from Sheets sync. Does NOT mark dirty.
        After upserting, deletes any local rows whose sheets_row is
        NOT in the fresh pull (i.e. removed from Sheets).
        Skips records that are in pending_deletes to prevent resurrection."""
        # Safety: refuse to process suspiciously small responses that could
        # indicate a GAS error, preventing accidental bulk deletion.
        existing_count = (self.fetchone("SELECT COUNT(*) as c FROM clients WHERE sheets_row > 0") or {}).get("c", 0)
        if existing_count > 10 and len(rows) < existing_count * 0.5:
            log.warning(
                "Sync safety: clients response has %d rows but DB has %d — "
                "skipping stale-row cleanup (possible API error)",
                len(rows), existing_count,
            )
            # Still upsert the rows we got, but skip the DELETE pass
            self._upsert_client_rows(rows)
            return

        now = datetime.now().isoformat()
        synced_sheet_rows = set()
        pending = self.get_pending_deletes("clients")
        for row in rows:
            sr = row.get("sheets_row", 0)
            synced_sheet_rows.add(sr)
            # Skip records pending deletion — use job_number or name as key
            jn = row.get("job_number", "")
            cname = row.get("name", "")
            if (jn and jn in pending) or (cname and cname in pending):
                log.debug(f"Skipping client {jn or cname} — pending delete")
                continue
            existing = self.fetchone(
                "SELECT id FROM clients WHERE sheets_row = ?",
                (sr,)
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

        # Remove stale clients no longer in Sheets (skip locally-dirty rows)
        if synced_sheet_rows:
            placeholders = ", ".join("?" for _ in synced_sheet_rows)
            deleted = self.execute(
                f"DELETE FROM clients WHERE sheets_row > 0 AND dirty = 0"
                f" AND sheets_row NOT IN ({placeholders})",
                tuple(synced_sheet_rows),
            )
            if deleted.rowcount:
                log.info("Removed %d stale client rows not in Sheets", deleted.rowcount)
        self.commit()

    def _upsert_client_rows(self, rows: list[dict]):
        """Upsert client rows without the stale-row deletion pass (safety fallback)."""
        now = datetime.now().isoformat()
        pending = self.get_pending_deletes("clients")
        for row in rows:
            jn = row.get("job_number", "")
            cname = row.get("name", "")
            if (jn and jn in pending) or (cname and cname in pending):
                continue
            sr = row.get("sheets_row", 0)
            existing = self.fetchone("SELECT id FROM clients WHERE sheets_row = ?", (sr,))
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
        """Delete a client record from SQLite and register as pending delete."""
        row = self.fetchone("SELECT job_number, name FROM clients WHERE id = ?", (client_id,))
        if row:
            if row["job_number"]:
                self.register_pending_delete("clients", row["job_number"])
            if row["name"]:
                self.register_pending_delete("clients", row["name"])
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

        # Schedule entries first — enrich with client record data
        for j in schedule_jobs:
            n = j.get("client_name", "")
            seen_names.add(n.lower())
            # Store the schedule table's own ID separately
            j["schedule_id"] = j.get("id")
            # Look up the matching client record by name to get price,
            # email, job_number, etc. that the schedule table lacks.
            if n:
                client_rec = self.fetchone(
                    "SELECT * FROM clients WHERE LOWER(name) = LOWER(?) LIMIT 1", (n,)
                )
                if client_rec:
                    j["client_id"] = client_rec.get("id")
                    # Merge fields the schedule table doesn't have
                    if not j.get("email"):
                        j["email"] = client_rec.get("email", "")
                    if not j.get("phone"):
                        j["phone"] = client_rec.get("phone", "")
                    j["price"] = client_rec.get("price", 0)
                    j["job_number"] = client_rec.get("job_number", "")
                    j["paid"] = client_rec.get("paid", "")
                    j["deposit_amount"] = client_rec.get("deposit_amount", 0)
                    j["type"] = client_rec.get("type", "")
                    j["frequency"] = client_rec.get("frequency", "")
                    j["sheets_row"] = client_rec.get("sheets_row", j.get("sheets_row", ""))
                    j["waste_collection"] = client_rec.get("waste_collection", "Not Set")
                    j["stripe_customer_id"] = client_rec.get("stripe_customer_id", "")
                else:
                    j["waste_collection"] = "Not Set"
            else:
                j["waste_collection"] = "Not Set"
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
                    "deposit_amount": cj.get("deposit_amount", 0),
                    "waste_collection": cj.get("waste_collection", "Not Set"),
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
                    "deposit_amount": sj.get("deposit_amount", 0),
                    "frequency": sj.get("frequency", ""),
                    "preferred_day": sj.get("preferred_day", ""),
                    "waste_collection": sj.get("waste_collection", "Not Set"),
                })

        combined.sort(key=lambda j: j.get("time", "99:99"))
        return combined

    # ------------------------------------------------------------------
    # Scheduling Conflict Detection
    # ------------------------------------------------------------------
    def get_jobs_count_for_date(self, target_date: str) -> int:
        """Count all jobs (clients + schedule + recurring subs) for a date."""
        return len(self.get_todays_jobs(target_date))

    def check_schedule_conflicts(self, target_date: str,
                                  exclude_client: str = "") -> dict:
        """Check if a date has scheduling conflicts.

        Returns:
            {
                'has_conflict': bool,
                'job_count': int,
                'max_jobs': int,
                'jobs': list[dict],          # existing jobs on that date
                'is_overbooked': bool,        # exceeds MAX_JOBS_PER_DAY
                'time_clashes': list[dict],   # overlapping time-slot pairs
            }
        """
        jobs = self.get_todays_jobs(target_date)
        if exclude_client:
            jobs = [j for j in jobs
                    if (j.get("client_name", j.get("name", ""))).lower()
                    != exclude_client.lower()]

        max_jobs = getattr(config, "MAX_JOBS_PER_DAY", 5)
        is_overbooked = len(jobs) >= max_jobs

        # Detect time-slot overlaps (assumes ~1hr per job minimum)
        time_clashes = []
        for i, j1 in enumerate(jobs):
            t1 = self._parse_time(j1.get("time", ""))
            if t1 is None:
                continue
            for j2 in jobs[i + 1:]:
                t2 = self._parse_time(j2.get("time", ""))
                if t2 is None:
                    continue
                gap_minutes = abs((t1[0] * 60 + t1[1]) - (t2[0] * 60 + t2[1]))
                if gap_minutes < 60:  # Less than 1hr apart = clash
                    time_clashes.append({
                        "job1": j1.get("client_name", j1.get("name", "")),
                        "job1_time": j1.get("time", ""),
                        "job2": j2.get("client_name", j2.get("name", "")),
                        "job2_time": j2.get("time", ""),
                        "gap_minutes": gap_minutes,
                    })

        return {
            "has_conflict": is_overbooked or bool(time_clashes),
            "job_count": len(jobs),
            "max_jobs": max_jobs,
            "jobs": jobs,
            "is_overbooked": is_overbooked,
            "time_clashes": time_clashes,
        }

    def suggest_best_dates(self, days_ahead: int = 14,
                           preferred_day: str = "",
                           exclude_weekends: bool = True) -> list[dict]:
        """Suggest the best available dates for scheduling a new job.

        Returns list of {date, day_name, job_count, max_jobs, available_slots}
        sorted by availability (fewest existing jobs first).
        """
        max_jobs = getattr(config, "MAX_JOBS_PER_DAY", 5)
        candidates = []
        today = date.today()

        for i in range(1, days_ahead + 1):
            candidate = today + timedelta(days=i)
            day_name = candidate.strftime("%A")

            # Skip weekends if preferred
            if exclude_weekends and candidate.weekday() >= 5:
                continue

            # If preferred day set, only show matching days
            if preferred_day and day_name.lower() != preferred_day.lower():
                continue

            date_str = candidate.isoformat()
            job_count = self.get_jobs_count_for_date(date_str)

            if job_count < max_jobs:
                candidates.append({
                    "date": date_str,
                    "day_name": day_name,
                    "display": candidate.strftime("%a %d %b"),
                    "job_count": job_count,
                    "max_jobs": max_jobs,
                    "available_slots": max_jobs - job_count,
                })

        # Sort by fewest existing jobs (most availability first)
        candidates.sort(key=lambda c: c["job_count"])
        return candidates[:5]  # Return top 5 suggestions

    def get_upcoming_confirmed(self, days: int = 7) -> list[dict]:
        """Get confirmed/scheduled bookings for the next N days.
        Combines clients table and schedule table entries.
        """
        today = date.today()
        end = (today + timedelta(days=days)).isoformat()
        today_str = today.isoformat()

        # One-off confirmed from clients
        client_confirmed = self.fetchall(
            """SELECT id, name as client_name, email, phone, postcode, address,
                      service, price, date, time, status, type, job_number,
                      'client' as source
               FROM clients
               WHERE date >= ? AND date <= ?
                 AND LOWER(status) IN ('confirmed', 'scheduled', 'pending', 'booked',
                                        'awaiting deposit', 'active')
               ORDER BY date ASC, time ASC""",
            (today_str, end)
        )

        # Schedule table confirmed
        sched_confirmed = self.fetchall(
            """SELECT id, client_name, email, phone, postcode, address,
                      service, '' as price, date, time, status, 'Schedule' as type,
                      parent_job as job_number, 'schedule' as source
               FROM schedule
               WHERE date >= ? AND date <= ?
                 AND LOWER(status) IN ('scheduled', 'pending', 'confirmed',
                                        'awaiting deposit')
               ORDER BY date ASC, time ASC""",
            (today_str, end)
        )

        combined = [dict(r) for r in client_confirmed] + [dict(r) for r in sched_confirmed]
        combined.sort(key=lambda j: (j.get("date", ""), j.get("time", "99:99")))
        return combined

    @staticmethod
    def _parse_time(time_str: str):
        """Parse a time string like '09:00' or '14:30' into (hour, minute) tuple."""
        if not time_str:
            return None
        try:
            parts = time_str.replace(".", ":").split(":")
            return (int(parts[0]), int(parts[1]) if len(parts) > 1 else 0)
        except (ValueError, IndexError):
            return None

    # ------------------------------------------------------------------
    # Schedule
    # ------------------------------------------------------------------
    def upsert_schedule(self, rows: list[dict]):
        """Bulk upsert schedule entries from Sheets."""
        if not rows:
            return  # Safety: never wipe table on empty response
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
        """Bulk upsert invoices. Removes stale local invoices not in Sheets.
        Skips records that are in pending_deletes to prevent resurrection."""
        now = datetime.now().isoformat()
        synced_numbers = set()
        pending = self.get_pending_deletes("invoices")
        for row in rows:
            inv_num = row.get("invoice_number", "")
            if inv_num:
                synced_numbers.add(inv_num)
            # Skip records pending deletion
            if inv_num in pending:
                log.debug(f"Skipping invoice {inv_num} — pending delete")
                continue
            existing = self.fetchone(
                "SELECT id FROM invoices WHERE invoice_number = ?",
                (inv_num,)
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

        # Remove stale invoices no longer in Sheets (skip locally-dirty rows)
        if synced_numbers:
            placeholders = ", ".join("?" for _ in synced_numbers)
            deleted = self.execute(
                f"DELETE FROM invoices WHERE dirty = 0"
                f" AND invoice_number != ''"
                f" AND invoice_number NOT IN ({placeholders})",
                tuple(synced_numbers),
            )
            if deleted.rowcount:
                log.info("Removed %d stale invoices not in Sheets", deleted.rowcount)
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
        """Delete an invoice record from SQLite and register as pending delete."""
        row = self.fetchone("SELECT invoice_number FROM invoices WHERE id = ?", (invoice_id,))
        if row and row["invoice_number"]:
            self.register_pending_delete("invoices", row["invoice_number"])
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
        """Bulk upsert quotes. Removes stale local quotes not in Sheets.
        Skips records that are in pending_deletes to prevent resurrection."""
        now = datetime.now().isoformat()
        synced_numbers = set()
        pending = self.get_pending_deletes("quotes")
        for row in rows:
            qn = row.get("quote_number", "")
            if qn:
                synced_numbers.add(qn)
            # Skip records pending deletion — don't resurrect them
            if qn in pending:
                log.debug(f"Skipping quote {qn} — pending delete")
                continue
            existing = self.fetchone(
                "SELECT id FROM quotes WHERE quote_number = ?",
                (qn,)
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

        # Remove stale quotes no longer in Sheets (skip locally-dirty rows)
        if synced_numbers:
            placeholders = ", ".join("?" for _ in synced_numbers)
            deleted = self.execute(
                f"DELETE FROM quotes WHERE dirty = 0"
                f" AND quote_number != ''"
                f" AND quote_number NOT IN ({placeholders})",
                tuple(synced_numbers),
            )
            if deleted.rowcount:
                log.info("Removed %d stale quotes not in Sheets", deleted.rowcount)
        self.commit()

    def generate_quote_number(self) -> str:
        """Generate the next sequential quote number: QUO-YYYYMMDD-NNN."""
        today = datetime.now().strftime("%Y%m%d")
        prefix = f"QUO-{today}-"
        row = self.fetchone(
            "SELECT quote_number FROM quotes WHERE quote_number LIKE ? ORDER BY quote_number DESC LIMIT 1",
            (f"{prefix}%",),
        )
        if row and row["quote_number"]:
            try:
                last_seq = int(row["quote_number"].split("-")[-1])
            except (ValueError, IndexError):
                last_seq = 0
            return f"{prefix}{last_seq + 1:03d}"
        return f"{prefix}001"

    _QUOTE_COLUMNS = {
        "id", "sheets_row", "quote_number", "job_number", "enquiry_id",
        "enquiry_message", "client_name", "client_email",
        "client_phone", "postcode", "address", "items", "subtotal",
        "discount", "vat", "total", "status", "date_created", "valid_until",
        "deposit_required", "notes", "dirty", "last_synced",
    }

    def save_quote(self, data: dict) -> int:
        """Insert or update a quote. Returns the row id."""
        data["dirty"] = 1
        if data.get("id"):
            cols = [k for k in data if k != "id" and k in self._QUOTE_COLUMNS]
            sets = ", ".join(f"{c} = ?" for c in cols)
            vals = [data[c] for c in cols] + [data["id"]]
            self.execute(f"UPDATE quotes SET {sets} WHERE id = ?", tuple(vals))
            self.commit()
            return data["id"]
        else:
            cols = [k for k in data if k != "id" and k in self._QUOTE_COLUMNS]
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
        """Delete a quote record from SQLite and register as pending delete."""
        row = self.fetchone("SELECT quote_number FROM quotes WHERE id = ?", (quote_id,))
        if row and row["quote_number"]:
            self.register_pending_delete("quotes", row["quote_number"])
        self.execute("DELETE FROM quotes WHERE id = ?", (quote_id,))
        self.commit()

    # ------------------------------------------------------------------
    # Business Costs
    # ------------------------------------------------------------------
    def get_business_costs(self) -> list[dict]:
        return self.fetchall("SELECT * FROM business_costs ORDER BY month DESC")

    def upsert_business_costs(self, rows: list[dict]):
        """Bulk upsert business costs. Removes stale months not in Sheets."""
        now = datetime.now().isoformat()
        synced_months = set()
        for row in rows:
            month = row.get("month", "")
            if month:
                synced_months.add(month)
            existing = self.fetchone(
                "SELECT id FROM business_costs WHERE month = ?",
                (month,)
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

        # Remove stale cost months no longer in Sheets
        if synced_months:
            placeholders = ", ".join("?" for _ in synced_months)
            deleted = self.execute(
                f"DELETE FROM business_costs WHERE dirty = 0"
                f" AND month != ''"
                f" AND month NOT IN ({placeholders})",
                tuple(synced_months),
            )
            if deleted.rowcount:
                log.info("Removed %d stale business_costs rows not in Sheets", deleted.rowcount)
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
        if not rows:
            return  # Safety: never wipe table on empty response
        now = datetime.now().isoformat()
        # Preserve dirty rows (local edits not yet pushed)
        dirty_rows = self.fetchall("SELECT * FROM enquiries WHERE dirty = 1")
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
        # Restore dirty rows that were destroyed by the DELETE
        for dr in dirty_rows:
            cols = [k for k in dr.keys() if k != "id"]
            placeholders = ", ".join("?" for _ in cols)
            vals = [dr[c] for c in cols]
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

    def upsert_complaints(self, rows: list[dict]):
        """Bulk upsert complaints from sync."""
        if not rows:
            return  # Safety: never wipe table on empty response
        now = datetime.now().isoformat()
        self.execute("DELETE FROM complaints")
        for row in rows:
            row["last_synced"] = now
            row["dirty"] = 0
            cols = list(row.keys())
            placeholders = ", ".join("?" for _ in cols)
            col_names = ", ".join(cols)
            vals = [row[c] for c in cols]
            self.execute(
                f"INSERT INTO complaints ({col_names}) VALUES ({placeholders})",
                tuple(vals)
            )
        self.commit()

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

    def upsert_vacancies(self, rows: list[dict]):
        """Bulk upsert vacancies from sync."""
        if not rows:
            return  # Safety: never wipe table on empty response
        now = datetime.now().isoformat()
        self.execute("DELETE FROM vacancies")
        for row in rows:
            row["last_synced"] = now
            row["dirty"] = 0
            cols = list(row.keys())
            placeholders = ", ".join("?" for _ in cols)
            col_names = ", ".join(cols)
            vals = [row[c] for c in cols]
            self.execute(
                f"INSERT INTO vacancies ({col_names}) VALUES ({placeholders})",
                tuple(vals)
            )
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

    def upsert_applications(self, rows: list[dict]):
        """Bulk upsert applications from sync."""
        if not rows:
            return  # Safety: never wipe table on empty response
        now = datetime.now().isoformat()
        self.execute("DELETE FROM applications")
        for row in rows:
            row["last_synced"] = now
            row["dirty"] = 0
            cols = list(row.keys())
            placeholders = ", ".join("?" for _ in cols)
            col_names = ", ".join(cols)
            vals = [row[c] for c in cols]
            self.execute(
                f"INSERT INTO applications ({col_names}) VALUES ({placeholders})",
                tuple(vals)
            )
        self.commit()

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

    def upsert_products(self, rows: list[dict]):
        """Bulk upsert products from sync."""
        if not rows:
            return  # Safety: never wipe table on empty response
        now = datetime.now().isoformat()
        self.execute("DELETE FROM products")
        for row in rows:
            row["last_synced"] = now
            row["dirty"] = 0
            cols = list(row.keys())
            placeholders = ", ".join("?" for _ in cols)
            col_names = ", ".join(cols)
            vals = [row[c] for c in cols]
            self.execute(
                f"INSERT INTO products ({col_names}) VALUES ({placeholders})",
                tuple(vals)
            )
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

    def upsert_orders(self, rows: list[dict]):
        """Bulk upsert orders from sync."""
        if not rows:
            return  # Safety: never wipe table on empty response
        now = datetime.now().isoformat()
        self.execute("DELETE FROM orders")
        for row in rows:
            row["last_synced"] = now
            row["dirty"] = 0
            cols = list(row.keys())
            placeholders = ", ".join("?" for _ in cols)
            col_names = ", ".join(cols)
            vals = [row[c] for c in cols]
            self.execute(
                f"INSERT INTO orders ({col_names}) VALUES ({placeholders})",
                tuple(vals)
            )
        self.commit()

    # ------------------------------------------------------------------
    def upsert_subscribers(self, rows: list[dict]):
        """Bulk upsert subscribers from sync."""
        if not rows:
            return  # Safety: never wipe table on empty response
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
        """Upsert job photos from Sheets sync. Keyed on job_number + drive_file_id.
        Also removes stale photos no longer in the Sheets data."""
        synced_keys = set()
        for row in rows:
            jn = row.get("job_number", "")
            fid = row.get("drive_file_id", "")
            if not jn or not fid:
                continue
            synced_keys.add(f"{jn}|{fid}")
            existing = self.fetchone(
                "SELECT id FROM job_photos WHERE job_number = ? AND drive_file_id = ?",
                (jn, fid),
            )
            if existing:
                self.execute(
                    """UPDATE job_photos SET photo_type=?, drive_url=?, caption=?,
                       telegram_file_id=?, filename=?, client_id=?, client_name=?,
                       source=?, created_at=? WHERE id=?""",
                    (row.get("photo_type", "before"), row.get("drive_url", ""),
                     row.get("caption", ""), row.get("telegram_file_id", ""),
                     row.get("filename", ""), row.get("client_id", ""),
                     row.get("client_name", ""), row.get("source", "drive"),
                     row.get("created_at", ""), existing["id"]),
                )
            else:
                self.execute(
                    """INSERT INTO job_photos
                       (job_number, client_id, client_name, job_date, photo_type, filename,
                        drive_url, drive_file_id, telegram_file_id, source, caption, created_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (jn, row.get("client_id", ""), row.get("client_name", ""),
                     row.get("job_date", ""),
                     row.get("photo_type", "before"), row.get("filename", ""),
                     row.get("drive_url", ""), fid,
                     row.get("telegram_file_id", ""), row.get("source", "drive"),
                     row.get("caption", ""), row.get("created_at", "")),
                )
        # Remove stale job photos no longer in Sheets
        if synced_keys:
            all_local = self.fetchall(
                "SELECT id, job_number, drive_file_id FROM job_photos WHERE drive_file_id != ''"
            )
            stale_ids = [
                r["id"] for r in all_local
                if f"{r['job_number']}|{r['drive_file_id']}" not in synced_keys
            ]
            if stale_ids:
                placeholders = ", ".join("?" for _ in stale_ids)
                self.execute(
                    f"DELETE FROM job_photos WHERE id IN ({placeholders})",
                    tuple(stale_ids),
                )
                log.info("Removed %d stale job photos not in Sheets", len(stale_ids))
        self.commit()

    def upsert_job_tracking(self, rows: list[dict]):
        """Upsert job tracking records from Sheets sync. Keyed on job_ref + start_time."""
        for row in rows:
            ref = row.get("job_ref", "")
            start = row.get("start_time", "")
            if not ref or not start:
                continue
            existing = self.fetchone(
                "SELECT id FROM job_tracking WHERE job_ref = ? AND start_time = ?",
                (ref, start),
            )
            if existing:
                self.execute(
                    """UPDATE job_tracking SET end_time=?, duration_mins=?, notes=?,
                       photo_count=?, is_active=? WHERE id=?""",
                    (row.get("end_time", ""), row.get("duration_mins", 0),
                     row.get("notes", ""), row.get("photo_count", 0),
                     row.get("is_active", 0), existing["id"]),
                )
            else:
                self.execute(
                    """INSERT INTO job_tracking
                       (job_ref, start_time, end_time, duration_mins, notes, photo_count, is_active)
                       VALUES (?, ?, ?, ?, ?, ?, ?)""",
                    (ref, start, row.get("end_time", ""),
                     row.get("duration_mins", 0), row.get("notes", ""),
                     row.get("photo_count", 0), row.get("is_active", 0)),
                )
        self.commit()

    def upsert_email_tracking(self, rows: list[dict]):
        """Upsert email tracking records from Sheets sync. Keyed on sent_at + client_email + email_type."""
        for row in rows:
            sent = row.get("sent_at", "")
            email = row.get("client_email", "")
            etype = row.get("email_type", "")
            if not sent or not email:
                continue
            # Case-insensitive match + match both underscore/hyphenated variant
            alt_etype = etype.replace("_", "-") if "_" in etype else etype.replace("-", "_")
            existing = self.fetchone(
                """SELECT id FROM email_tracking
                   WHERE sent_at = ? AND LOWER(client_email) = ?
                   AND email_type IN (?, ?)""",
                (sent, email.lower(), etype, alt_etype),
            )
            if existing:
                self.execute(
                    """UPDATE email_tracking SET client_name=?, subject=?, status=?,
                       notes=? WHERE id=?""",
                    (row.get("client_name", ""), row.get("subject", ""),
                     row.get("status", "sent"), row.get("notes", ""),
                     existing["id"]),
                )
            else:
                self.execute(
                    """INSERT INTO email_tracking
                       (client_name, client_email, email_type, subject, status, sent_at, notes)
                       VALUES (?, ?, ?, ?, ?, ?, ?)""",
                    (row.get("client_name", ""), email, etype,
                     row.get("subject", ""), row.get("status", "sent"),
                     sent, row.get("notes", "")),
                )
        self.commit()

    def get_job_tracking(self, date: str = None, limit: int = 50) -> list[dict]:
        """Get job tracking records from local SQLite. Optionally filter by date."""
        sql = "SELECT * FROM job_tracking WHERE 1=1"
        params = []
        if date:
            sql += " AND start_time LIKE ?"
            params.append(f"{date}%")
        sql += " ORDER BY start_time DESC LIMIT ?"
        params.append(limit)
        return self.fetchall(sql, tuple(params))

    def get_job_tracking_stats(self) -> dict:
        """Get aggregate job tracking stats for dashboard display."""
        today = datetime.now().strftime("%Y-%m-%d")
        total = self.fetchone("SELECT COUNT(*) as c FROM job_tracking")["c"]
        completed = self.fetchone(
            "SELECT COUNT(*) as c FROM job_tracking WHERE end_time != '' AND end_time IS NOT NULL"
        )["c"]
        active = self.fetchone(
            "SELECT COUNT(*) as c FROM job_tracking WHERE is_active = 1"
        )["c"]
        today_count = self.fetchone(
            "SELECT COUNT(*) as c FROM job_tracking WHERE start_time LIKE ?",
            (f"{today}%",)
        )["c"]
        today_completed = self.fetchone(
            "SELECT COUNT(*) as c FROM job_tracking WHERE start_time LIKE ? AND end_time != '' AND end_time IS NOT NULL",
            (f"{today}%",)
        )["c"]
        avg_duration = self.fetchone(
            "SELECT AVG(duration_mins) as avg FROM job_tracking WHERE duration_mins > 0"
        )["avg"] or 0
        total_time_today = self.fetchone(
            "SELECT SUM(duration_mins) as total FROM job_tracking WHERE start_time LIKE ? AND duration_mins > 0",
            (f"{today}%",)
        )["total"] or 0
        return {
            "total": total,
            "completed": completed,
            "active": active,
            "today_count": today_count,
            "today_completed": today_completed,
            "avg_duration_mins": round(avg_duration, 1),
            "total_time_today_mins": round(total_time_today, 1),
        }

    def get_active_field_jobs(self) -> list[dict]:
        """Get currently active jobs being worked in the field (for dispatch/overview)."""
        return self.fetchall(
            "SELECT * FROM job_tracking WHERE is_active = 1 ORDER BY start_time DESC"
        )

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
                  template_used: str = "", notes: str = "",
                  provider: str = "", message_id: str = "") -> int:
        cursor = self.execute(
            """INSERT INTO email_tracking (client_id, client_name, client_email,
               email_type, subject, status, sent_at, template_used, provider,
               message_id, notes)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (client_id, client_name, client_email, email_type, subject,
             status, datetime.now().isoformat(), template_used, provider,
             message_id, notes)
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
        today_count = self.fetchone(
            "SELECT COUNT(*) as c FROM email_tracking WHERE DATE(sent_at) = DATE('now')"
        )["c"]
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
            "today": today_count,
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
        """Bulk upsert blog posts from GAS sync. Removes stale posts not in Sheets."""
        now = datetime.now().isoformat()
        synced_post_ids = set()
        for row in rows:
            pid = row.get("post_id", row.get("id", ""))
            if pid:
                synced_post_ids.add(str(pid))
            existing = self.fetchone(
                "SELECT id FROM blog_posts WHERE post_id = ?",
                (pid,)
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

        # Remove stale blog posts no longer in Sheets (skip locally-dirty rows)
        if synced_post_ids:
            placeholders = ", ".join("?" for _ in synced_post_ids)
            deleted = self.execute(
                f"DELETE FROM blog_posts WHERE dirty = 0"
                f" AND post_id != ''"
                f" AND post_id NOT IN ({placeholders})",
                tuple(synced_post_ids),
            )
            if deleted.rowcount:
                log.info("Removed %d stale blog posts not in Sheets", deleted.rowcount)
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
                and j.get("status") not in ("Cancelled", "Complete", "Completed")]

    def get_completed_jobs_needing_email(self, target_date: str) -> list[dict]:
        """Get jobs completed today that haven't had a completion email sent."""
        jobs = self.fetchall(
            """SELECT * FROM clients
               WHERE date = ? AND status IN ('Complete', 'Completed')
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
               WHERE date = ? AND status IN ('Complete', 'Completed') AND email != ''
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
               WHERE status IN ('Complete', 'Completed') AND email != ''
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

    # ------------------------------------------------------------------
    # Aftercare Queries (completed today, not yet sent aftercare)
    # ------------------------------------------------------------------
    def get_jobs_needing_aftercare(self, target_date: str) -> list[dict]:
        """Get jobs completed on target_date that haven't had an aftercare email."""
        jobs = self.fetchall(
            """SELECT * FROM clients
               WHERE date = ? AND status IN ('Complete', 'Completed') AND email != ''
               ORDER BY time ASC""",
            (target_date,)
        )
        emailed = self.fetchall(
            """SELECT DISTINCT client_email FROM email_tracking
               WHERE email_type = 'aftercare' AND status = 'sent'
               AND sent_at >= ?""",
            (target_date,)
        )
        emailed_emails = {r["client_email"] for r in emailed}
        return [j for j in jobs if j.get("email", "") not in emailed_emails]

    # ------------------------------------------------------------------
    # Re-engagement Queries (30-90 days idle, one-off clients)
    # ------------------------------------------------------------------
    def get_clients_needing_reengagement(self, min_days: int = 30,
                                          max_days: int = 90) -> list[dict]:
        """Get one-off clients whose last completed job was 30-90 days ago."""
        cutoff_start = (date.today() - timedelta(days=max_days)).isoformat()
        cutoff_end = (date.today() - timedelta(days=min_days)).isoformat()
        clients = self.fetchall(
            """SELECT name, email, service, MAX(date) as last_date,
                      COUNT(*) as job_count
               FROM clients
               WHERE status IN ('Complete', 'Completed') AND email != ''
               AND frequency IN ('One-Off', '')
               GROUP BY email
               HAVING last_date >= ? AND last_date <= ?
               ORDER BY last_date ASC""",
            (cutoff_start, cutoff_end)
        )
        emailed = self.fetchall(
            """SELECT DISTINCT LOWER(client_email) as client_email FROM email_tracking
               WHERE email_type IN ('re_engagement', 're-engagement')
               AND status IN ('sent', 'Sent')
               AND sent_at >= ?""",
            (cutoff_start,)
        )
        emailed_emails = {r["client_email"] for r in emailed}
        return [c for c in clients if c.get("email", "").lower() not in emailed_emails]

    # ------------------------------------------------------------------
    # Promotional Queries (7-60 days after first completed job)
    # ------------------------------------------------------------------
    def get_clients_needing_promo(self, min_days: int = 7,
                                   max_days: int = 60) -> list[dict]:
        """Get clients whose first completed job was 7-60 days ago."""
        cutoff_start = (date.today() - timedelta(days=max_days)).isoformat()
        cutoff_end = (date.today() - timedelta(days=min_days)).isoformat()
        clients = self.fetchall(
            """SELECT name, email, service, MIN(date) as first_date
               FROM clients
               WHERE status IN ('Complete', 'Completed') AND email != ''
               GROUP BY email
               HAVING first_date >= ? AND first_date <= ?
               ORDER BY first_date ASC""",
            (cutoff_start, cutoff_end)
        )
        emailed = self.fetchall(
            """SELECT DISTINCT LOWER(client_email) as client_email FROM email_tracking
               WHERE email_type = 'promotional' AND status IN ('sent', 'Sent')
               AND sent_at >= ?""",
            (cutoff_start,)
        )
        emailed_emails = {r["client_email"] for r in emailed}
        return [c for c in clients if c.get("email", "").lower() not in emailed_emails]

    # ------------------------------------------------------------------
    # Referral Queries (14-90 days after completed job)
    # ------------------------------------------------------------------
    def get_clients_needing_referral(self, min_days: int = 14,
                                      max_days: int = 90) -> list[dict]:
        """Get clients whose completed job was 14-90 days ago, not yet sent referral."""
        cutoff_start = (date.today() - timedelta(days=max_days)).isoformat()
        cutoff_end = (date.today() - timedelta(days=min_days)).isoformat()
        clients = self.fetchall(
            """SELECT name, email, service, MAX(date) as last_date
               FROM clients
               WHERE status IN ('Complete', 'Completed') AND email != ''
               GROUP BY email
               HAVING last_date >= ? AND last_date <= ?
               ORDER BY last_date ASC""",
            (cutoff_start, cutoff_end)
        )
        emailed = self.fetchall(
            """SELECT DISTINCT LOWER(client_email) as client_email FROM email_tracking
               WHERE email_type = 'referral' AND status IN ('sent', 'Sent')
               AND sent_at >= ?""",
            (cutoff_start,)
        )
        emailed_emails = {r["client_email"] for r in emailed}
        return [c for c in clients if c.get("email", "").lower() not in emailed_emails]

    # ------------------------------------------------------------------
    # Package Upgrade Queries (subscribers 30+ days into plan)
    # ------------------------------------------------------------------
    def get_subscribers_needing_upgrade(self, min_days: int = 30) -> list[dict]:
        """Get subscription clients who've been active 30+ days, not yet sent upgrade."""
        cutoff = (date.today() - timedelta(days=min_days)).isoformat()
        clients = self.fetchall(
            """SELECT name, email, service, frequency, MIN(date) as start_date
               FROM clients
               WHERE status NOT IN ('Cancelled', '')
               AND email != ''
               AND frequency NOT IN ('One-Off', '')
               GROUP BY email
               HAVING start_date <= ?
               ORDER BY start_date ASC""",
            (cutoff,)
        )
        emailed = self.fetchall(
            """SELECT DISTINCT LOWER(client_email) as client_email FROM email_tracking
               WHERE email_type IN ('package_upgrade', 'package-upgrade')
               AND status IN ('sent', 'Sent')
               AND sent_at >= ?""",
            ((date.today() - timedelta(days=60)).isoformat(),)
        )
        emailed_emails = {r["client_email"] for r in emailed}
        return [c for c in clients if c.get("email", "").lower() not in emailed_emails]

    # ------------------------------------------------------------------
    # Seasonal Tips Queries (all active clients, max once per 60 days)
    # ------------------------------------------------------------------
    def get_clients_needing_seasonal_tips(self, max_results: int = 20) -> list[dict]:
        """Get active clients who haven't received seasonal tips in 60 days."""
        cutoff = (date.today() - timedelta(days=60)).isoformat()
        clients = self.fetchall(
            """SELECT DISTINCT name, email, service
               FROM clients
               WHERE status NOT IN ('Cancelled', '')
               AND email != ''
               AND email NOT LIKE '%test@test%'
               AND email NOT LIKE '%example.com%'
               AND name != ''
               ORDER BY name ASC"""
        )
        emailed = self.fetchall(
            """SELECT DISTINCT LOWER(client_email) as client_email FROM email_tracking
               WHERE email_type IN ('seasonal_tips', 'seasonal-tips')
               AND status IN ('sent', 'Sent')
               AND sent_at >= ?""",
            (cutoff,)
        )
        emailed_emails = {r["client_email"] for r in emailed}
        result = [c for c in clients if c.get("email", "").lower() not in emailed_emails]
        return result[:max_results]

    # ------------------------------------------------------------------
    # Quote Accepted — quotes accepted but no confirmation email yet
    # ------------------------------------------------------------------
    def get_quotes_needing_acceptance_email(self) -> list[dict]:
        """Get accepted quotes that haven't had a quote_accepted email sent."""
        quotes = self.fetchall(
            """SELECT * FROM quotes
               WHERE status = 'Accepted' AND client_email != ''
               ORDER BY date_created DESC"""
        )
        emailed = self.fetchall(
            """SELECT DISTINCT client_email, notes FROM email_tracking
               WHERE email_type = 'quote_accepted' AND status = 'sent'"""
        )
        emailed_keys = set()
        for e in emailed:
            emailed_keys.add(f"{e.get('client_email', '')}|{e.get('notes', '')}")
        return [q for q in quotes
                if f"{q.get('client_email','')}|{q.get('quote_number','')}"
                not in emailed_keys]

    # ------------------------------------------------------------------
    # Cancellations — cancelled jobs needing notification email
    # ------------------------------------------------------------------
    def get_cancellations_needing_email(self) -> list[dict]:
        """Get cancellation log entries not yet emailed."""
        return self.fetchall(
            """SELECT * FROM cancellation_log
               WHERE notified = 0 AND client_email != ''
               ORDER BY created_at DESC"""
        )

    def save_cancellation_log(self, client_name: str, client_email: str,
                               service: str, job_date: str, reason: str = "") -> int:
        """Insert a cancellation log entry."""
        return self.execute(
            """INSERT INTO cancellation_log
               (client_name, client_email, service, job_date, reason, notified, created_at)
               VALUES (?, ?, ?, ?, ?, 0, ?)""",
            (client_name, client_email, service, job_date, reason,
             datetime.now().isoformat())
        )

    def mark_cancellation_notified(self, cancel_id: int):
        """Mark a cancellation as email-notified."""
        self.execute(
            "UPDATE cancellation_log SET notified = 1 WHERE id = ?",
            (cancel_id,)
        )

    # ------------------------------------------------------------------
    # Reschedules — rescheduled jobs needing notification email
    # ------------------------------------------------------------------
    def get_reschedules_needing_email(self) -> list[dict]:
        """Get reschedule log entries not yet emailed."""
        return self.fetchall(
            """SELECT * FROM reschedule_log
               WHERE notified = 0 AND client_email != ''
               ORDER BY created_at DESC"""
        )

    def save_reschedule_log(self, client_name: str, client_email: str,
                             service: str, old_date: str, old_time: str,
                             new_date: str, new_time: str,
                             reason: str = "") -> int:
        """Insert a reschedule log entry."""
        return self.execute(
            """INSERT INTO reschedule_log
               (client_name, client_email, service, old_date, old_time,
                new_date, new_time, reason, notified, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)""",
            (client_name, client_email, service, old_date, old_time,
             new_date, new_time, reason, datetime.now().isoformat())
        )

    def mark_reschedule_notified(self, resched_id: int):
        """Mark a reschedule as email-notified."""
        self.execute(
            "UPDATE reschedule_log SET notified = 1 WHERE id = ?",
            (resched_id,)
        )

    # ------------------------------------------------------------------
    # Payment Received — paid invoices needing receipt email
    # ------------------------------------------------------------------
    def get_paid_invoices_needing_receipt(self) -> list[dict]:
        """Get invoices marked Paid that haven't had a payment_received email.

        Safety: only considers invoices paid within the last 48 hours to
        prevent re-sending receipts after a data wipe + re-sync from Sheets.
        """
        from datetime import datetime, timedelta
        cutoff = (datetime.now() - timedelta(hours=48)).strftime("%Y-%m-%d")

        invoices = self.fetchall(
            """SELECT * FROM invoices
               WHERE status = 'Paid' AND client_email != ''
               AND paid_date != '' AND paid_date >= ?
               ORDER BY paid_date DESC""",
            (cutoff,)
        )
        emailed = self.fetchall(
            """SELECT DISTINCT client_email, notes FROM email_tracking
               WHERE email_type IN ('payment_received', 'payment-received')
               AND status IN ('sent', 'Sent')"""
        )
        emailed_keys = set()
        for e in emailed:
            raw_notes = e.get("notes", "")
            email_addr = e.get("client_email", "")
            # Match both Hub format "invoice:X" and GAS-synced format "X"
            emailed_keys.add(f"{email_addr}|{raw_notes}")
            emailed_keys.add(f"{email_addr}|invoice:{raw_notes}")
        return [inv for inv in invoices
                if f"{inv.get('client_email','')}|invoice:{inv.get('invoice_number','')}"
                not in emailed_keys]

    # ------------------------------------------------------------------
    # Auto-invoice — completed jobs needing invoice creation
    # ------------------------------------------------------------------
    def get_completed_jobs_needing_invoice(self, delay_hours: int = 2) -> list[dict]:
        """Get completed jobs with no invoice, completed at least delay_hours ago."""
        cutoff = (datetime.now() - timedelta(hours=delay_hours)).isoformat()
        jobs = self.fetchall(
            """SELECT * FROM clients
               WHERE status IN ('Complete', 'Completed') AND email != ''
               AND price > 0
               AND updated_at <= ?
               ORDER BY date DESC""",
            (cutoff,)
        )
        # Exclude jobs that already have an invoice
        invoiced = self.fetchall(
            """SELECT DISTINCT client_name, notes FROM invoices
               WHERE client_name != ''"""
        )
        invoiced_keys = set()
        for inv in invoiced:
            invoiced_keys.add(f"{inv.get('client_name', '')}|{inv.get('notes', '')}")

        # Also check by job_number
        invoiced_jobs = self.fetchall(
            """SELECT DISTINCT job_number FROM invoices
               WHERE job_number != ''"""
        )
        invoiced_job_numbers = {inv.get("job_number", "") for inv in invoiced_jobs}

        result = []
        for job in jobs:
            job_num = job.get("job_number", "")
            if job_num and job_num in invoiced_job_numbers:
                continue
            result.append(job)
        return result

    # ------------------------------------------------------------------
    # Email Preferences — opt-out checking
    # ------------------------------------------------------------------
    def get_email_preference(self, email: str) -> dict | None:
        """Get email preferences for a client. Returns None if no record."""
        return self.fetchone(
            "SELECT * FROM email_preferences WHERE client_email = ?",
            (email,)
        )

    def save_email_preference(self, email: str, name: str = "",
                               marketing: bool = True,
                               transactional: bool = True,
                               newsletter: bool = True):
        """Upsert email preferences for a client."""
        self.execute(
            """INSERT INTO email_preferences
               (client_email, client_name, marketing_opt_in,
                transactional_opt_in, newsletter_opt_in, updated_at)
               VALUES (?, ?, ?, ?, ?, ?)
               ON CONFLICT(client_email) DO UPDATE SET
                   client_name = excluded.client_name,
                   marketing_opt_in = excluded.marketing_opt_in,
                   transactional_opt_in = excluded.transactional_opt_in,
                   newsletter_opt_in = excluded.newsletter_opt_in,
                   updated_at = excluded.updated_at""",
            (email, name, int(marketing), int(transactional),
             int(newsletter), datetime.now().isoformat())
        )

    def is_email_opted_out(self, email: str, email_type: str = "marketing") -> bool:
        """Check if a client has opted out of a specific email category.
        
        Transactional emails (booking confirm, invoice, etc.) use 'transactional'.
        Marketing emails (promo, referral, seasonal tips) use 'marketing'.
        Newsletters use 'newsletter'.
        """
        pref = self.get_email_preference(email)
        if not pref:
            return False  # No record = opt-in by default
        
        # Map email types to preference columns
        category_map = {
            # Transactional — always send unless explicitly opted out
            "enquiry_received": "transactional",
            "quote_sent": "transactional",
            "quote_accepted": "transactional",
            "booking_confirmed": "transactional",
            "day_before_reminder": "transactional",
            "job_complete": "transactional",
            "aftercare": "transactional",
            "invoice_sent": "transactional",
            "payment_received": "transactional",
            "cancellation": "transactional",
            "reschedule": "transactional",
            "subscription_welcome": "transactional",
            # Marketing — respect opt-out
            "follow_up": "marketing",
            "thank_you": "marketing",
            "re_engagement": "marketing",
            "seasonal_tips": "marketing",
            "promotional": "marketing",
            "referral": "marketing",
            "package_upgrade": "marketing",
            # Newsletter
            "newsletter": "newsletter",
        }
        category = category_map.get(email_type, email_type)
        
        if category == "transactional":
            return not bool(pref.get("transactional_opt_in", 1))
        elif category == "newsletter":
            return not bool(pref.get("newsletter_opt_in", 1))
        else:
            return not bool(pref.get("marketing_opt_in", 1))

    # ══════════════════════════════════════════════════════════════
    # Accounting & Xero Integration Methods (v5.0.0)
    # ══════════════════════════════════════════════════════════════

    # ------------------------------------------------------------------
    # Invoice Line Items
    # ------------------------------------------------------------------
    def add_invoice_line_item(self, invoice_id: int, description: str,
                               quantity: float = 1, unit_price: float = 0,
                               tax_rate: float = 20.0, account_code: str = "200",
                               discount_pct: float = 0, item_code: str = "") -> int:
        """Add a line item to an invoice. Returns the new line item ID."""
        net = quantity * unit_price * (1 - discount_pct / 100)
        tax = net * (tax_rate / 100)
        line_total = net + tax
        cursor = self.execute(
            """INSERT INTO invoice_line_items
               (invoice_id, description, quantity, unit_price, discount_pct,
                tax_rate, tax_amount, line_total, account_code, item_code, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (invoice_id, description, quantity, unit_price, discount_pct,
             tax_rate, round(tax, 2), round(line_total, 2), account_code,
             item_code, datetime.now().isoformat()),
        )
        self.commit()
        return cursor.lastrowid

    def get_invoice_line_items(self, invoice_id: int) -> list[dict]:
        """Get all line items for an invoice."""
        return self.fetchall(
            "SELECT * FROM invoice_line_items WHERE invoice_id = ? ORDER BY id",
            (invoice_id,),
        )

    def delete_invoice_line_items(self, invoice_id: int):
        """Delete all line items for an invoice (for rebuild)."""
        self.execute("DELETE FROM invoice_line_items WHERE invoice_id = ?", (invoice_id,))
        self.commit()

    def recalculate_invoice_totals(self, invoice_id: int):
        """Recalculate invoice subtotal, VAT, and total from line items."""
        items = self.get_invoice_line_items(invoice_id)
        subtotal = sum(i["quantity"] * i["unit_price"] * (1 - i["discount_pct"] / 100)
                       for i in items)
        vat = sum(i["tax_amount"] for i in items)
        total = subtotal + vat
        self.execute(
            """UPDATE invoices SET subtotal = ?, vat_amount = ?, amount = ?
               WHERE id = ?""",
            (round(subtotal, 2), round(vat, 2), round(total, 2), invoice_id),
        )
        self.commit()

    # ------------------------------------------------------------------
    # Payments
    # ------------------------------------------------------------------
    def record_payment(self, invoice_id: int = None, invoice_number: str = "",
                       client_name: str = "", client_email: str = "",
                       amount: float = 0, payment_method: str = "",
                       stripe_payment_id: str = "", bank_ref: str = "",
                       is_deposit: bool = False, notes: str = "") -> int:
        """Record a payment against an invoice. Returns payment ID."""
        import uuid
        ref = f"PAY-{datetime.now().strftime('%Y%m%d')}-{uuid.uuid4().hex[:6].upper()}"
        cursor = self.execute(
            """INSERT INTO payments
               (payment_ref, invoice_id, invoice_number, client_name, client_email,
                amount, currency, payment_method, payment_date, stripe_payment_id,
                bank_ref, is_deposit, notes, created_at)
               VALUES (?, ?, ?, ?, ?, ?, 'GBP', ?, ?, ?, ?, ?, ?, ?)""",
            (ref, invoice_id, invoice_number, client_name, client_email,
             amount, payment_method, datetime.now().isoformat(),
             stripe_payment_id, bank_ref, 1 if is_deposit else 0,
             notes, datetime.now().isoformat()),
        )
        self.commit()

        # Log to audit trail
        self.log_audit("payments", cursor.lastrowid, "create",
                       new_value=f"£{amount:.2f} via {payment_method}")
        return cursor.lastrowid

    def get_payments_for_invoice(self, invoice_id: int) -> list[dict]:
        """Get all payments against an invoice."""
        return self.fetchall(
            "SELECT * FROM payments WHERE invoice_id = ? ORDER BY payment_date",
            (invoice_id,),
        )

    def get_invoice_balance(self, invoice_id: int) -> float:
        """Calculate remaining balance on an invoice."""
        invoice = self.fetchone("SELECT amount FROM invoices WHERE id = ?", (invoice_id,))
        if not invoice:
            return 0
        payments = self.fetchone(
            "SELECT COALESCE(SUM(amount), 0) as paid FROM payments WHERE invoice_id = ?",
            (invoice_id,),
        )
        return round(invoice["amount"] - (payments["paid"] if payments else 0), 2)

    # ------------------------------------------------------------------
    # Credit Notes
    # ------------------------------------------------------------------
    def create_credit_note(self, invoice_id: int, amount: float,
                           reason: str = "", notes: str = "") -> int:
        """Create a credit note against an invoice. Returns credit note ID."""
        invoice = self.fetchone("SELECT * FROM invoices WHERE id = ?", (invoice_id,))
        if not invoice:
            raise ValueError(f"Invoice {invoice_id} not found")

        # Generate sequential credit note number
        last = self.fetchone(
            "SELECT credit_note_number FROM credit_notes ORDER BY id DESC LIMIT 1"
        )
        if last and last["credit_note_number"]:
            num = int(last["credit_note_number"].replace("CN-", "")) + 1
        else:
            num = 1
        cn_number = f"CN-{num:04d}"

        cursor = self.execute(
            """INSERT INTO credit_notes
               (credit_note_number, invoice_id, invoice_number, client_name,
                client_email, amount, reason, status, issue_date, notes, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, 'Draft', ?, ?, ?)""",
            (cn_number, invoice_id, invoice.get("invoice_number", ""),
             invoice.get("client_name", ""), invoice.get("client_email", ""),
             amount, reason, datetime.now().isoformat(), notes,
             datetime.now().isoformat()),
        )
        self.commit()
        self.log_audit("credit_notes", cursor.lastrowid, "create",
                       new_value=f"£{amount:.2f} against {invoice.get('invoice_number', '')}")
        return cursor.lastrowid

    # ------------------------------------------------------------------
    # Audit Trail
    # ------------------------------------------------------------------
    def log_audit(self, table_name: str, record_id: int, action: str,
                  field_name: str = "", old_value: str = "",
                  new_value: str = "", changed_by: str = "system"):
        """Record an immutable audit trail entry."""
        try:
            self.execute(
                """INSERT INTO audit_trail
                   (table_name, record_id, action, field_name, old_value,
                    new_value, changed_by, changed_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (table_name, record_id, action, field_name, str(old_value),
                 str(new_value), changed_by, datetime.now().isoformat()),
            )
            self.commit()
        except Exception as e:
            log.warning(f"Audit log failed: {e}")

    def get_audit_trail(self, table_name: str = None, record_id: int = None,
                        limit: int = 100) -> list[dict]:
        """Query audit trail with optional filters."""
        sql = "SELECT * FROM audit_trail WHERE 1=1"
        params = []
        if table_name:
            sql += " AND table_name = ?"
            params.append(table_name)
        if record_id is not None:
            sql += " AND record_id = ?"
            params.append(record_id)
        sql += " ORDER BY changed_at DESC LIMIT ?"
        params.append(limit)
        return self.fetchall(sql, tuple(params))

    # ------------------------------------------------------------------
    # Tax / VAT
    # ------------------------------------------------------------------
    def get_vat_summary(self, period_start: str, period_end: str) -> dict:
        """Get VAT summary for a tax period (for Making Tax Digital)."""
        # Sales VAT from invoices (include all non-cancelled invoices)
        sales = self.fetchone(
            """SELECT COALESCE(SUM(vat_amount), 0) as vat_collected,
                      COALESCE(SUM(subtotal), 0) as total_sales
               FROM invoices
               WHERE issue_date >= ? AND issue_date <= ?
               AND status != 'Cancelled'""",
            (period_start, period_end),
        )
        # Expense VAT from business costs
        expenses = self.fetchone(
            """SELECT COALESCE(SUM(vat_amount), 0) as vat_paid,
                      COALESCE(SUM(total), 0) as total_expenses
               FROM business_costs
               WHERE month >= ? AND month <= ?""",
            (period_start[:7], period_end[:7]),
        )
        vat_collected = sales["vat_collected"] if sales else 0
        vat_paid = expenses["vat_paid"] if expenses else 0
        return {
            "period_start": period_start,
            "period_end": period_end,
            "total_sales": sales["total_sales"] if sales else 0,
            "vat_collected": round(vat_collected, 2),
            "total_expenses": expenses["total_expenses"] if expenses else 0,
            "vat_paid": round(vat_paid, 2),
            "net_vat": round(vat_collected - vat_paid, 2),
        }

    # ------------------------------------------------------------------
    # Xero Sync Mapping
    # ------------------------------------------------------------------
    def set_xero_mapping(self, local_table: str, local_id: int,
                         xero_id: str, xero_type: str = ""):
        """Map a local record to a Xero entity."""
        self.execute(
            """INSERT OR REPLACE INTO xero_sync
               (local_table, local_id, xero_id, xero_type, last_synced, sync_status)
               VALUES (?, ?, ?, ?, ?, 'synced')""",
            (local_table, local_id, xero_id, xero_type, datetime.now().isoformat()),
        )
        self.commit()

    def get_xero_id(self, local_table: str, local_id: int) -> Optional[str]:
        """Get the Xero ID for a local record, or None if not yet synced."""
        row = self.fetchone(
            "SELECT xero_id FROM xero_sync WHERE local_table = ? AND local_id = ?",
            (local_table, local_id),
        )
        return row["xero_id"] if row else None

    def get_unsynced_to_xero(self, local_table: str) -> list[dict]:
        """Get records that haven't been synced to Xero yet."""
        return self.fetchall(
            f"""SELECT t.* FROM {local_table} t
                LEFT JOIN xero_sync x ON x.local_table = ? AND x.local_id = t.id
                WHERE x.id IS NULL OR x.sync_status = 'pending'""",
            (local_table,),
        )

    # ------------------------------------------------------------------
    # Expense Categories (Chart of Accounts)
    # ------------------------------------------------------------------
    def get_expense_categories(self) -> list[dict]:
        """Get all expense categories with Xero account mappings."""
        return self.fetchall("SELECT * FROM expense_categories ORDER BY name")

    def seed_expense_categories(self):
        """Seed default expense categories if empty."""
        existing = self.fetchone("SELECT COUNT(*) as c FROM expense_categories")
        if existing and existing["c"] > 0:
            return
        defaults = [
            ("Fuel", "304", 1, "", "Vehicle fuel costs"),
            ("Insurance", "460", 1, "", "Business insurance premiums"),
            ("Tools & Equipment", "429", 1, "", "Tools, machinery, PPE"),
            ("Vehicle Running Costs", "304", 1, "", "MOT, tax, repairs, tyres"),
            ("Phone & Internet", "449", 1, "", "Mobile phone and broadband"),
            ("Software & Subscriptions", "463", 1, "", "Business software costs"),
            ("Marketing & Advertising", "408", 1, "", "Website, flyers, ads"),
            ("Waste Disposal", "300", 1, "", "Green waste and skip hire"),
            ("Treatment Products", "300", 1, "", "Fertiliser, weedkiller, etc."),
            ("Consumables", "300", 1, "", "Strimmer line, fuel mix, etc."),
            ("Subcontractor Costs", "310", 1, "", "Subcontractor labour"),
            ("Training & CPD", "418", 1, "", "Qualifications and courses"),
            ("Accountancy Fees", "412", 1, "", "Accountant fees"),
            ("Bank Charges", "404", 1, "", "Bank fees and card charges"),
            ("Protective Clothing", "429", 1, "", "PPE and workwear"),
        ]
        for name, code, deductible, parent, desc in defaults:
            self.execute(
                """INSERT OR IGNORE INTO expense_categories
                   (name, xero_account_code, tax_deductible, parent_category, description)
                   VALUES (?, ?, ?, ?, ?)""",
                (name, code, deductible, parent, desc),
            )
        self.commit()
        log.info("Seeded %d expense categories", len(defaults))

    # ------------------------------------------------------------------
    # Inbox (IMAP emails)
    # ------------------------------------------------------------------
    def get_inbox_emails(self, folder: str = "INBOX", unread_only: bool = False,
                         archived: bool = False, starred: bool = False,
                         search: str = "", limit: int = 100) -> list[dict]:
        """Get inbox emails with optional filters."""
        sql = "SELECT * FROM inbox WHERE is_deleted = 0"
        params = []

        if unread_only:
            sql += " AND is_read = 0"
        if starred:
            sql += " AND is_starred = 1"
        if archived:
            sql += " AND is_archived = 1"
        else:
            sql += " AND is_archived = 0"
        if folder:
            sql += " AND folder = ?"
            params.append(folder)
        if search:
            sql += " AND (subject LIKE ? OR from_name LIKE ? OR from_email LIKE ? OR body_text LIKE ?)"
            term = f"%{search}%"
            params.extend([term, term, term, term])

        sql += " ORDER BY date_received DESC"
        if limit:
            sql += " LIMIT ?"
            params.append(limit)
        return self.fetchall(sql, tuple(params))

    def get_inbox_email_by_id(self, email_id: int) -> dict | None:
        """Get a single inbox email by ID."""
        return self.fetchone("SELECT * FROM inbox WHERE id = ?", (email_id,))

    def inbox_message_exists(self, message_id: str) -> bool:
        """Check if a message has already been fetched."""
        row = self.fetchone("SELECT 1 FROM inbox WHERE message_id = ?", (message_id,))
        return row is not None

    def save_inbox_email(self, data: dict) -> int:
        """Save a new inbox email. Returns row ID (0 if duplicate)."""
        msg_id = data.get("message_id", "")
        if not msg_id:
            return 0
        if self.inbox_message_exists(msg_id):
            return 0
        cursor = self.execute(
            """INSERT INTO inbox
               (message_id, from_name, from_email, to_email, subject,
                body_text, body_html, date_received, is_read, folder,
                has_attachments, attachment_info, client_name, fetched_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)""",
            (msg_id,
             data.get("from_name", ""),
             data.get("from_email", ""),
             data.get("to_email", ""),
             data.get("subject", ""),
             data.get("body_text", ""),
             data.get("body_html", ""),
             data.get("date_received", ""),
             data.get("folder", "INBOX"),
             1 if data.get("has_attachments") else 0,
             data.get("attachment_info", ""),
             data.get("client_name", ""),
             datetime.now().isoformat()),
        )
        self.commit()
        return cursor.lastrowid

    def mark_inbox_read(self, email_id: int, read: bool = True):
        self.execute("UPDATE inbox SET is_read = ? WHERE id = ?", (1 if read else 0, email_id))
        self.commit()

    def mark_inbox_starred(self, email_id: int, starred: bool = True):
        self.execute("UPDATE inbox SET is_starred = ? WHERE id = ?", (1 if starred else 0, email_id))
        self.commit()

    def mark_inbox_archived(self, email_id: int, archived: bool = True):
        self.execute("UPDATE inbox SET is_archived = ? WHERE id = ?", (1 if archived else 0, email_id))
        self.commit()

    def mark_inbox_replied(self, email_id: int):
        self.execute("UPDATE inbox SET is_replied = 1 WHERE id = ?", (email_id,))
        self.commit()

    def delete_inbox_email(self, email_id: int):
        """Soft-delete an email (keeps row so IMAP dedup still works)."""
        self.execute("UPDATE inbox SET is_deleted = 1 WHERE id = ?", (email_id,))
        self.commit()

    def delete_all_inbox_emails(self, folder: str = "INBOX"):
        """Soft-delete all non-archived emails in a folder."""
        self.execute(
            "UPDATE inbox SET is_deleted = 1 WHERE folder = ? AND is_archived = 0 AND is_deleted = 0",
            (folder,)
        )
        self.commit()

    def get_inbox_message_ids(self, folder: str = "INBOX", deleted_only: bool = False) -> list[str]:
        """Get message_ids for IMAP server operations."""
        if deleted_only:
            rows = self.fetchall(
                "SELECT message_id FROM inbox WHERE folder = ? AND is_deleted = 1",
                (folder,)
            )
        else:
            rows = self.fetchall(
                "SELECT message_id FROM inbox WHERE folder = ? AND is_deleted = 0",
                (folder,)
            )
        return [r["message_id"] for r in rows]

    def get_inbox_unread_count(self) -> int:
        row = self.fetchone("SELECT COUNT(*) as c FROM inbox WHERE is_read = 0 AND is_archived = 0 AND is_deleted = 0")
        return row["c"] if row else 0

    def get_inbox_stats(self) -> dict:
        """Quick inbox statistics."""
        total = self.fetchone("SELECT COUNT(*) as c FROM inbox WHERE is_archived = 0 AND is_deleted = 0")
        unread = self.fetchone("SELECT COUNT(*) as c FROM inbox WHERE is_read = 0 AND is_archived = 0 AND is_deleted = 0")
        starred = self.fetchone("SELECT COUNT(*) as c FROM inbox WHERE is_starred = 1 AND is_archived = 0 AND is_deleted = 0")
        today_count = self.fetchone(
            "SELECT COUNT(*) as c FROM inbox WHERE date_received >= date('now') AND is_archived = 0 AND is_deleted = 0"
        )
        return {
            "total": total["c"] if total else 0,
            "unread": unread["c"] if unread else 0,
            "starred": starred["c"] if starred else 0,
            "today": today_count["c"] if today_count else 0,
        }
