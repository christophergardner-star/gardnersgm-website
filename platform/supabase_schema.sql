-- ============================================================
-- GGM Hub — Supabase Schema Migration
-- Phase 1: Create all tables with proper types, UUIDs, and FKs
-- Run this in the Supabase SQL Editor (Dashboard → SQL Editor)
-- ============================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─────────────────────────────────────────────────────────────
-- Clients / Jobs (core customer + job records)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS clients (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    legacy_sheets_row       INTEGER,
    job_number              TEXT,
    name                    TEXT NOT NULL DEFAULT '',
    email                   TEXT DEFAULT '',
    phone                   TEXT DEFAULT '',
    postcode                TEXT DEFAULT '',
    address                 TEXT DEFAULT '',
    service                 TEXT DEFAULT '',
    price                   NUMERIC(10,2) DEFAULT 0,
    date                    TEXT DEFAULT '',
    time                    TEXT DEFAULT '',
    preferred_day           TEXT DEFAULT '',
    frequency               TEXT DEFAULT 'One-Off',
    type                    TEXT DEFAULT 'One-Off',
    status                  TEXT DEFAULT 'Pending',
    paid                    TEXT DEFAULT 'No',
    stripe_customer_id      TEXT DEFAULT '',
    stripe_subscription_id  TEXT DEFAULT '',
    waste_collection        TEXT DEFAULT 'Not Set',
    notes                   TEXT DEFAULT '',
    created_at              TIMESTAMPTZ DEFAULT now(),
    updated_at              TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_clients_name ON clients(name);
CREATE INDEX IF NOT EXISTS idx_clients_email ON clients(email);
CREATE INDEX IF NOT EXISTS idx_clients_status ON clients(status);
CREATE INDEX IF NOT EXISTS idx_clients_service ON clients(service);

-- ─────────────────────────────────────────────────────────────
-- Schedule (generated visit schedule)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS schedule (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    legacy_sheets_row INTEGER,
    client_id         UUID REFERENCES clients(id) ON DELETE SET NULL,
    client_name       TEXT DEFAULT '',
    service           TEXT DEFAULT '',
    date              TEXT DEFAULT '',
    time              TEXT DEFAULT '',
    postcode          TEXT DEFAULT '',
    address           TEXT DEFAULT '',
    phone             TEXT DEFAULT '',
    status            TEXT DEFAULT 'Scheduled',
    notes             TEXT DEFAULT '',
    created_at        TIMESTAMPTZ DEFAULT now(),
    updated_at        TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_schedule_date ON schedule(date);
CREATE INDEX IF NOT EXISTS idx_schedule_client ON schedule(client_id);

-- ─────────────────────────────────────────────────────────────
-- Invoices
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS invoices (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    legacy_sheets_row INTEGER,
    invoice_number    TEXT UNIQUE,
    job_number        TEXT DEFAULT '',
    client_id         UUID REFERENCES clients(id) ON DELETE SET NULL,
    client_name       TEXT DEFAULT '',
    client_email      TEXT DEFAULT '',
    amount            NUMERIC(10,2) DEFAULT 0,
    status            TEXT DEFAULT 'Unpaid',
    stripe_invoice_id TEXT DEFAULT '',
    payment_url       TEXT DEFAULT '',
    issue_date        TEXT DEFAULT '',
    due_date          TEXT DEFAULT '',
    paid_date         TEXT DEFAULT '',
    payment_method    TEXT DEFAULT '',
    items             JSONB DEFAULT '[]'::jsonb,
    notes             TEXT DEFAULT '',
    created_at        TIMESTAMPTZ DEFAULT now(),
    updated_at        TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_client ON invoices(client_id);
CREATE INDEX IF NOT EXISTS idx_invoices_number ON invoices(invoice_number);

-- ─────────────────────────────────────────────────────────────
-- Quotes
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS quotes (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    legacy_sheets_row INTEGER,
    quote_number      TEXT UNIQUE,
    client_id         UUID REFERENCES clients(id) ON DELETE SET NULL,
    client_name       TEXT DEFAULT '',
    client_email      TEXT DEFAULT '',
    client_phone      TEXT DEFAULT '',
    postcode          TEXT DEFAULT '',
    address           TEXT DEFAULT '',
    service           TEXT DEFAULT '',
    items             JSONB DEFAULT '[]'::jsonb,
    subtotal          NUMERIC(10,2) DEFAULT 0,
    discount          NUMERIC(10,2) DEFAULT 0,
    vat               NUMERIC(10,2) DEFAULT 0,
    total             NUMERIC(10,2) DEFAULT 0,
    status            TEXT DEFAULT 'Draft',
    date_created      TEXT DEFAULT '',
    valid_until       TEXT DEFAULT '',
    deposit_required  NUMERIC(10,2) DEFAULT 0,
    token             TEXT DEFAULT '',
    notes             TEXT DEFAULT '',
    created_at        TIMESTAMPTZ DEFAULT now(),
    updated_at        TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_quotes_status ON quotes(status);
CREATE INDEX IF NOT EXISTS idx_quotes_number ON quotes(quote_number);
CREATE INDEX IF NOT EXISTS idx_quotes_client ON quotes(client_id);

-- ─────────────────────────────────────────────────────────────
-- Enquiries
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS enquiries (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    legacy_sheets_row INTEGER,
    name              TEXT DEFAULT '',
    email             TEXT DEFAULT '',
    phone             TEXT DEFAULT '',
    service           TEXT DEFAULT '',
    message           TEXT DEFAULT '',
    type              TEXT DEFAULT 'General',
    status            TEXT DEFAULT 'New',
    date              TEXT DEFAULT '',
    replied           TEXT DEFAULT 'No',
    garden_details    JSONB DEFAULT '{}'::jsonb,
    notes             TEXT DEFAULT '',
    created_at        TIMESTAMPTZ DEFAULT now(),
    updated_at        TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_enquiries_status ON enquiries(status);
CREATE INDEX IF NOT EXISTS idx_enquiries_date ON enquiries(date);

-- ─────────────────────────────────────────────────────────────
-- Business Costs (monthly expense tracking)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS business_costs (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    legacy_sheets_row   INTEGER,
    month               TEXT DEFAULT '',
    fuel                NUMERIC(10,2) DEFAULT 0,
    insurance           NUMERIC(10,2) DEFAULT 0,
    tools               NUMERIC(10,2) DEFAULT 0,
    vehicle             NUMERIC(10,2) DEFAULT 0,
    phone_cost          NUMERIC(10,2) DEFAULT 0,
    software            NUMERIC(10,2) DEFAULT 0,
    marketing           NUMERIC(10,2) DEFAULT 0,
    waste_disposal      NUMERIC(10,2) DEFAULT 0,
    treatment_products  NUMERIC(10,2) DEFAULT 0,
    consumables         NUMERIC(10,2) DEFAULT 0,
    other               NUMERIC(10,2) DEFAULT 0,
    total               NUMERIC(10,2) DEFAULT 0,
    notes               TEXT DEFAULT '',
    created_at          TIMESTAMPTZ DEFAULT now(),
    updated_at          TIMESTAMPTZ DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────
-- Savings Pots
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS savings_pots (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name        TEXT UNIQUE NOT NULL,
    balance     NUMERIC(10,2) DEFAULT 0,
    target      NUMERIC(10,2) DEFAULT 0,
    updated_at  TIMESTAMPTZ DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────
-- Subscribers (newsletter)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS subscribers (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    legacy_sheets_row INTEGER,
    email             TEXT UNIQUE NOT NULL,
    name              TEXT DEFAULT '',
    date_subscribed   TEXT DEFAULT '',
    status            TEXT DEFAULT 'Active',
    tier              TEXT DEFAULT 'Free',
    created_at        TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_subscribers_email ON subscribers(email);
CREATE INDEX IF NOT EXISTS idx_subscribers_status ON subscribers(status);

-- ─────────────────────────────────────────────────────────────
-- Complaints
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS complaints (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    legacy_sheets_row   INTEGER,
    complaint_ref       TEXT DEFAULT '',
    name                TEXT DEFAULT '',
    email               TEXT DEFAULT '',
    phone               TEXT DEFAULT '',
    job_ref             TEXT DEFAULT '',
    service             TEXT DEFAULT '',
    service_date        TEXT DEFAULT '',
    amount_paid         NUMERIC(10,2) DEFAULT 0,
    complaint_type      TEXT DEFAULT 'One-Off',
    severity            TEXT DEFAULT 'Minor',
    status              TEXT DEFAULT 'Open',
    description         TEXT DEFAULT '',
    desired_resolution  TEXT DEFAULT '',
    resolution_type     TEXT DEFAULT '',
    resolution_notes    TEXT DEFAULT '',
    resolved_date       TEXT DEFAULT '',
    admin_notes         TEXT DEFAULT '',
    created_at          TIMESTAMPTZ DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────
-- Blog Posts
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS blog_posts (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    post_id       TEXT UNIQUE DEFAULT '',
    title         TEXT DEFAULT '',
    category      TEXT DEFAULT '',
    author        TEXT DEFAULT 'Gardners GM',
    excerpt       TEXT DEFAULT '',
    content       TEXT DEFAULT '',
    status        TEXT DEFAULT 'Draft',
    tags          TEXT DEFAULT '',
    social_fb     TEXT DEFAULT '',
    social_ig     TEXT DEFAULT '',
    social_x      TEXT DEFAULT '',
    image_url     TEXT DEFAULT '',
    created_date  TEXT DEFAULT '',
    published_at  TIMESTAMPTZ,
    created_at    TIMESTAMPTZ DEFAULT now(),
    updated_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_blog_status ON blog_posts(status);

-- ─────────────────────────────────────────────────────────────
-- Email Tracking
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS email_tracking (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_name   TEXT DEFAULT '',
    client_email  TEXT DEFAULT '',
    email_type    TEXT DEFAULT '',
    subject       TEXT DEFAULT '',
    status        TEXT DEFAULT 'sent',
    provider      TEXT DEFAULT '',
    error         TEXT DEFAULT '',
    sent_at       TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_type ON email_tracking(email_type);
CREATE INDEX IF NOT EXISTS idx_email_date ON email_tracking(sent_at);

-- ─────────────────────────────────────────────────────────────
-- Node Heartbeats (multi-node health monitoring)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS node_heartbeats (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    node_name   TEXT UNIQUE NOT NULL,
    version     TEXT DEFAULT '',
    status      TEXT DEFAULT 'online',
    ip_address  TEXT DEFAULT '',
    last_seen   TIMESTAMPTZ DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────
-- Remote Commands (inter-node communication)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS remote_commands (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    command     TEXT NOT NULL,
    data        JSONB DEFAULT '{}'::jsonb,
    source      TEXT DEFAULT '',
    target      TEXT DEFAULT '',
    status      TEXT DEFAULT 'pending',
    result      TEXT DEFAULT '',
    created_at  TIMESTAMPTZ DEFAULT now(),
    executed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_commands_status ON remote_commands(status);
CREATE INDEX IF NOT EXISTS idx_commands_target ON remote_commands(target);

-- ─────────────────────────────────────────────────────────────
-- Notifications (in-app)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    node_target TEXT DEFAULT '',
    type        TEXT NOT NULL DEFAULT 'info',
    title       TEXT NOT NULL DEFAULT '',
    message     TEXT DEFAULT '',
    icon        TEXT DEFAULT '🔔',
    client_name TEXT DEFAULT '',
    job_number  TEXT DEFAULT '',
    read        BOOLEAN DEFAULT false,
    created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notif_read ON notifications(read);

-- ─────────────────────────────────────────────────────────────
-- Email Preferences
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS email_preferences (
    id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_email          TEXT UNIQUE NOT NULL,
    client_name           TEXT DEFAULT '',
    marketing_opt_in      BOOLEAN DEFAULT true,
    transactional_opt_in  BOOLEAN DEFAULT true,
    newsletter_opt_in     BOOLEAN DEFAULT true,
    unsubscribed_at       TIMESTAMPTZ,
    updated_at            TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_emailpref_email ON email_preferences(client_email);

-- ─────────────────────────────────────────────────────────────
-- Products (shop)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS products (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name        TEXT DEFAULT '',
    description TEXT DEFAULT '',
    price       INTEGER DEFAULT 0,
    category    TEXT DEFAULT '',
    stock       INTEGER DEFAULT 0,
    image_url   TEXT DEFAULT '',
    status      TEXT DEFAULT 'Active',
    created_at  TIMESTAMPTZ DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────
-- Orders (shop)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS orders (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id     TEXT DEFAULT '',
    date         TEXT DEFAULT '',
    name         TEXT DEFAULT '',
    email        TEXT DEFAULT '',
    items        JSONB DEFAULT '[]'::jsonb,
    total        NUMERIC(10,2) DEFAULT 0,
    order_status TEXT DEFAULT 'Processing',
    created_at   TIMESTAMPTZ DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────
-- Vacancies
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vacancies (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title         TEXT DEFAULT '',
    type          TEXT DEFAULT 'Full-time',
    location      TEXT DEFAULT 'Cornwall',
    salary        TEXT DEFAULT '',
    description   TEXT DEFAULT '',
    requirements  TEXT DEFAULT '',
    closing_date  TEXT DEFAULT '',
    status        TEXT DEFAULT 'Open',
    posted_date   TEXT DEFAULT '',
    created_at    TIMESTAMPTZ DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────
-- Applications (job applications)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS applications (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    vacancy_id      UUID REFERENCES vacancies(id) ON DELETE SET NULL,
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
    created_at      TIMESTAMPTZ DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────
-- Site Analytics (daily page views)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS site_analytics (
    id      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    date    TEXT NOT NULL,
    page    TEXT NOT NULL DEFAULT '/',
    views   INTEGER DEFAULT 0,
    UNIQUE(date, page)
);

CREATE INDEX IF NOT EXISTS idx_analytics_date ON site_analytics(date);

-- ─────────────────────────────────────────────────────────────
-- Business Recommendations
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS business_recommendations (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    rec_id            TEXT DEFAULT '',
    date              TEXT DEFAULT '',
    type              TEXT DEFAULT '',
    priority          TEXT DEFAULT 'medium',
    title             TEXT DEFAULT '',
    description       TEXT DEFAULT '',
    action            TEXT DEFAULT '',
    impact            TEXT DEFAULT '',
    services_affected JSONB DEFAULT '[]'::jsonb,
    price_changes     JSONB DEFAULT '[]'::jsonb,
    status            TEXT DEFAULT 'pending',
    applied_at        TIMESTAMPTZ,
    analysis          TEXT DEFAULT '',
    seasonal_focus    TEXT DEFAULT '',
    promotion_idea    TEXT DEFAULT '',
    created_at        TIMESTAMPTZ DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────
-- Sync Log (audit trail for Hub ↔ Supabase sync)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sync_log (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    table_name        TEXT NOT NULL,
    direction         TEXT NOT NULL DEFAULT 'pull',
    records_affected  INTEGER DEFAULT 0,
    source_node       TEXT DEFAULT '',
    status            TEXT DEFAULT 'success',
    error_message     TEXT DEFAULT '',
    created_at        TIMESTAMPTZ DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────
-- Auto-update updated_at on row changes
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply triggers to tables with updated_at
DROP TRIGGER IF EXISTS trg_clients_updated ON clients;
CREATE TRIGGER trg_clients_updated BEFORE UPDATE ON clients
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
DROP TRIGGER IF EXISTS trg_schedule_updated ON schedule;
CREATE TRIGGER trg_schedule_updated BEFORE UPDATE ON schedule
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
DROP TRIGGER IF EXISTS trg_invoices_updated ON invoices;
CREATE TRIGGER trg_invoices_updated BEFORE UPDATE ON invoices
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
DROP TRIGGER IF EXISTS trg_quotes_updated ON quotes;
CREATE TRIGGER trg_quotes_updated BEFORE UPDATE ON quotes
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
DROP TRIGGER IF EXISTS trg_enquiries_updated ON enquiries;
CREATE TRIGGER trg_enquiries_updated BEFORE UPDATE ON enquiries
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
DROP TRIGGER IF EXISTS trg_blog_updated ON blog_posts;
CREATE TRIGGER trg_blog_updated BEFORE UPDATE ON blog_posts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─────────────────────────────────────────────────────────────
-- Row Level Security (RLS)
-- ─────────────────────────────────────────────────────────────
-- Enable RLS on all tables. service_role key bypasses RLS.
-- anon key gets limited read access to public data only.

ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedule ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE enquiries ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_costs ENABLE ROW LEVEL SECURITY;
ALTER TABLE savings_pots ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscribers ENABLE ROW LEVEL SECURITY;
ALTER TABLE complaints ENABLE ROW LEVEL SECURITY;
ALTER TABLE blog_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_tracking ENABLE ROW LEVEL SECURITY;
ALTER TABLE node_heartbeats ENABLE ROW LEVEL SECURITY;
ALTER TABLE remote_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE vacancies ENABLE ROW LEVEL SECURITY;
ALTER TABLE applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_analytics ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_recommendations ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_log ENABLE ROW LEVEL SECURITY;

-- service_role has full access (bypasses RLS, no policies needed)

-- anon: read published blog posts only
DROP POLICY IF EXISTS "anon_read_published_blogs" ON blog_posts;
CREATE POLICY "anon_read_published_blogs" ON blog_posts
    FOR SELECT TO anon USING (status = 'Published');

-- anon: read active products
DROP POLICY IF EXISTS "anon_read_products" ON products;
CREATE POLICY "anon_read_products" ON products
    FOR SELECT TO anon USING (status = 'Active');

-- anon: read open vacancies
DROP POLICY IF EXISTS "anon_read_vacancies" ON vacancies;
CREATE POLICY "anon_read_vacancies" ON vacancies
    FOR SELECT TO anon USING (status = 'Open');

-- anon: can subscribe (insert only)
DROP POLICY IF EXISTS "anon_subscribe" ON subscribers;
CREATE POLICY "anon_subscribe" ON subscribers
    FOR INSERT TO anon WITH CHECK (true);

-- anon: can submit enquiries
DROP POLICY IF EXISTS "anon_submit_enquiry" ON enquiries;
CREATE POLICY "anon_submit_enquiry" ON enquiries
    FOR INSERT TO anon WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────
-- Enable Realtime on key tables (ignore errors if already added)
-- ─────────────────────────────────────────────────────────────
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE clients; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE quotes; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE invoices; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE enquiries; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE schedule; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE remote_commands; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE notifications; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE node_heartbeats; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
