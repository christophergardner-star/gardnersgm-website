-- ══════════════════════════════════════════════════════
-- GGM Docker Stack — PostgreSQL Initialisation
-- Creates databases for all services on first run.
-- ══════════════════════════════════════════════════════

-- Listmonk database is created automatically by POSTGRES_DB env var.
-- Dify needs its own database:
CREATE DATABASE dify;
GRANT ALL PRIVILEGES ON DATABASE dify TO listmonk;
