"""
supabase_client.py — Supabase (PostgreSQL) client wrapper for GGM Hub.

Provides typed CRUD methods and Realtime subscription management.
Uses the service_role key for full access (bypasses RLS).
Falls back gracefully if Supabase is not configured.

Usage:
    from app.supabase_client import supa

    # Read
    clients = supa.get_clients()
    quote = supa.get_quote_by_number("Q-0042")

    # Write
    supa.upsert_client({...})
    supa.upsert_quote({...})

    # Realtime (Phase 3)
    supa.subscribe("clients", on_change_callback)
"""

import json
import logging
from datetime import datetime
from typing import Optional

from . import config

log = logging.getLogger("ggm.supabase")

# ---------------------------------------------------------------------------
# Singleton client — initialised lazily on first use
# ---------------------------------------------------------------------------
_client = None


def _get_client():
    """Return the Supabase client, creating it on first call."""
    global _client
    if _client is not None:
        return _client

    if not config.USE_SUPABASE:
        log.info("Supabase not configured — client disabled")
        return None

    try:
        from supabase import create_client
        _client = create_client(config.SUPABASE_URL, config.SUPABASE_SERVICE_KEY)
        log.info("Supabase client initialised: %s", config.SUPABASE_URL)
        return _client
    except Exception as e:
        log.error("Failed to create Supabase client: %s", e)
        return None


def is_available() -> bool:
    """Check if Supabase is configured and reachable."""
    client = _get_client()
    if not client:
        return False
    try:
        client.table("node_heartbeats").select("id").limit(1).execute()
        return True
    except Exception as e:
        log.warning("Supabase connectivity check failed: %s", e)
        return False


# ══════════════════════════════════════════════════════════════
# CLIENTS
# ══════════════════════════════════════════════════════════════

def get_clients(limit: int = 1000) -> list[dict]:
    """Fetch all clients."""
    client = _get_client()
    if not client:
        return []
    try:
        resp = client.table("clients").select("*").limit(limit).execute()
        return resp.data or []
    except Exception as e:
        log.error("get_clients: %s", e)
        return []


def upsert_client(data: dict) -> Optional[dict]:
    """Insert or update a client. Uses email+name as conflict resolution if no id."""
    client = _get_client()
    if not client:
        return None
    try:
        # Remove None values — Supabase doesn't like them
        clean = {k: v for k, v in data.items() if v is not None}
        clean["updated_at"] = datetime.utcnow().isoformat()
        resp = client.table("clients").upsert(clean).execute()
        return resp.data[0] if resp.data else None
    except Exception as e:
        log.error("upsert_client: %s", e)
        return None


# ══════════════════════════════════════════════════════════════
# QUOTES
# ══════════════════════════════════════════════════════════════

def get_quotes(limit: int = 500) -> list[dict]:
    """Fetch all quotes."""
    client = _get_client()
    if not client:
        return []
    try:
        resp = client.table("quotes").select("*").order("created_at", desc=True).limit(limit).execute()
        return resp.data or []
    except Exception as e:
        log.error("get_quotes: %s", e)
        return []


def get_quote_by_number(quote_number: str) -> Optional[dict]:
    """Fetch a single quote by its quote_number."""
    client = _get_client()
    if not client:
        return None
    try:
        resp = client.table("quotes").select("*").eq("quote_number", quote_number).limit(1).execute()
        return resp.data[0] if resp.data else None
    except Exception as e:
        log.error("get_quote_by_number: %s", e)
        return None


def upsert_quote(data: dict) -> Optional[dict]:
    """Insert or update a quote. Uses quote_number as the natural key."""
    client = _get_client()
    if not client:
        return None
    try:
        clean = {k: v for k, v in data.items() if v is not None}
        # Ensure items is JSONB-compatible
        if "items" in clean and isinstance(clean["items"], str):
            try:
                clean["items"] = json.loads(clean["items"])
            except (json.JSONDecodeError, TypeError):
                pass
        clean["updated_at"] = datetime.utcnow().isoformat()
        resp = client.table("quotes").upsert(clean, on_conflict="quote_number").execute()
        return resp.data[0] if resp.data else None
    except Exception as e:
        log.error("upsert_quote: %s", e)
        return None


# ══════════════════════════════════════════════════════════════
# INVOICES
# ══════════════════════════════════════════════════════════════

def get_invoices(limit: int = 500) -> list[dict]:
    """Fetch all invoices."""
    client = _get_client()
    if not client:
        return []
    try:
        resp = client.table("invoices").select("*").order("created_at", desc=True).limit(limit).execute()
        return resp.data or []
    except Exception as e:
        log.error("get_invoices: %s", e)
        return []


def upsert_invoice(data: dict) -> Optional[dict]:
    """Insert or update an invoice. Uses invoice_number as the natural key."""
    client = _get_client()
    if not client:
        return None
    try:
        clean = {k: v for k, v in data.items() if v is not None}
        if "items" in clean and isinstance(clean["items"], str):
            try:
                clean["items"] = json.loads(clean["items"])
            except (json.JSONDecodeError, TypeError):
                pass
        clean["updated_at"] = datetime.utcnow().isoformat()
        resp = client.table("invoices").upsert(clean, on_conflict="invoice_number").execute()
        return resp.data[0] if resp.data else None
    except Exception as e:
        log.error("upsert_invoice: %s", e)
        return None


# ══════════════════════════════════════════════════════════════
# ENQUIRIES
# ══════════════════════════════════════════════════════════════

def get_enquiries(limit: int = 500) -> list[dict]:
    """Fetch all enquiries."""
    client = _get_client()
    if not client:
        return []
    try:
        resp = client.table("enquiries").select("*").order("created_at", desc=True).limit(limit).execute()
        return resp.data or []
    except Exception as e:
        log.error("get_enquiries: %s", e)
        return []


def upsert_enquiry(data: dict) -> Optional[dict]:
    """Insert or update an enquiry."""
    client = _get_client()
    if not client:
        return None
    try:
        clean = {k: v for k, v in data.items() if v is not None}
        if "garden_details" in clean and isinstance(clean["garden_details"], str):
            try:
                clean["garden_details"] = json.loads(clean["garden_details"])
            except (json.JSONDecodeError, TypeError):
                pass
        clean["updated_at"] = datetime.utcnow().isoformat()
        resp = client.table("enquiries").upsert(clean).execute()
        return resp.data[0] if resp.data else None
    except Exception as e:
        log.error("upsert_enquiry: %s", e)
        return None


# ══════════════════════════════════════════════════════════════
# SCHEDULE
# ══════════════════════════════════════════════════════════════

def get_schedule(date_from: str = "", date_to: str = "", limit: int = 1000) -> list[dict]:
    """Fetch schedule entries, optionally filtered by date range."""
    client = _get_client()
    if not client:
        return []
    try:
        q = client.table("schedule").select("*")
        if date_from:
            q = q.gte("date", date_from)
        if date_to:
            q = q.lte("date", date_to)
        resp = q.order("date").limit(limit).execute()
        return resp.data or []
    except Exception as e:
        log.error("get_schedule: %s", e)
        return []


def upsert_schedule(data: dict) -> Optional[dict]:
    """Insert or update a schedule entry."""
    client = _get_client()
    if not client:
        return None
    try:
        clean = {k: v for k, v in data.items() if v is not None}
        clean["updated_at"] = datetime.utcnow().isoformat()
        resp = client.table("schedule").upsert(clean).execute()
        return resp.data[0] if resp.data else None
    except Exception as e:
        log.error("upsert_schedule: %s", e)
        return None


# ══════════════════════════════════════════════════════════════
# BLOG POSTS
# ══════════════════════════════════════════════════════════════

def get_blog_posts(status: str = "", limit: int = 200) -> list[dict]:
    """Fetch blog posts, optionally filtered by status."""
    client = _get_client()
    if not client:
        return []
    try:
        q = client.table("blog_posts").select("*")
        if status:
            q = q.eq("status", status)
        resp = q.order("created_at", desc=True).limit(limit).execute()
        return resp.data or []
    except Exception as e:
        log.error("get_blog_posts: %s", e)
        return []


def upsert_blog_post(data: dict) -> Optional[dict]:
    """Insert or update a blog post. Uses post_id as the natural key."""
    client = _get_client()
    if not client:
        return None
    try:
        clean = {k: v for k, v in data.items() if v is not None}
        clean["updated_at"] = datetime.utcnow().isoformat()
        resp = client.table("blog_posts").upsert(clean, on_conflict="post_id").execute()
        return resp.data[0] if resp.data else None
    except Exception as e:
        log.error("upsert_blog_post: %s", e)
        return None


# ══════════════════════════════════════════════════════════════
# SUBSCRIBERS
# ══════════════════════════════════════════════════════════════

def get_subscribers(limit: int = 1000) -> list[dict]:
    """Fetch all subscribers."""
    client = _get_client()
    if not client:
        return []
    try:
        resp = client.table("subscribers").select("*").limit(limit).execute()
        return resp.data or []
    except Exception as e:
        log.error("get_subscribers: %s", e)
        return []


def upsert_subscriber(data: dict) -> Optional[dict]:
    """Insert or update a subscriber. Uses email as the natural key."""
    client = _get_client()
    if not client:
        return None
    try:
        clean = {k: v for k, v in data.items() if v is not None}
        resp = client.table("subscribers").upsert(clean, on_conflict="email").execute()
        return resp.data[0] if resp.data else None
    except Exception as e:
        log.error("upsert_subscriber: %s", e)
        return None


# ══════════════════════════════════════════════════════════════
# BUSINESS COSTS
# ══════════════════════════════════════════════════════════════

def get_business_costs(limit: int = 100) -> list[dict]:
    """Fetch all business cost records."""
    client = _get_client()
    if not client:
        return []
    try:
        resp = client.table("business_costs").select("*").order("month", desc=True).limit(limit).execute()
        return resp.data or []
    except Exception as e:
        log.error("get_business_costs: %s", e)
        return []


def upsert_business_cost(data: dict) -> Optional[dict]:
    """Insert or update a business cost record."""
    client = _get_client()
    if not client:
        return None
    try:
        clean = {k: v for k, v in data.items() if v is not None}
        clean["updated_at"] = datetime.utcnow().isoformat()
        resp = client.table("business_costs").upsert(clean).execute()
        return resp.data[0] if resp.data else None
    except Exception as e:
        log.error("upsert_business_cost: %s", e)
        return None


# ══════════════════════════════════════════════════════════════
# EMAIL TRACKING
# ══════════════════════════════════════════════════════════════

def log_email(client_name: str, client_email: str, email_type: str,
              subject: str, status: str = "sent", provider: str = "",
              error: str = "") -> Optional[dict]:
    """Log a sent email to Supabase."""
    client = _get_client()
    if not client:
        return None
    try:
        resp = client.table("email_tracking").insert({
            "client_name": client_name,
            "client_email": client_email,
            "email_type": email_type,
            "subject": subject,
            "status": status,
            "provider": provider,
            "error": error,
            "sent_at": datetime.utcnow().isoformat(),
        }).execute()
        return resp.data[0] if resp.data else None
    except Exception as e:
        log.error("log_email: %s", e)
        return None


# ══════════════════════════════════════════════════════════════
# NODE HEARTBEATS
# ══════════════════════════════════════════════════════════════

def heartbeat(node_name: str, version: str = "", status: str = "online",
              ip_address: str = "") -> Optional[dict]:
    """Update or insert a node heartbeat."""
    client = _get_client()
    if not client:
        return None
    try:
        resp = client.table("node_heartbeats").upsert({
            "node_name": node_name,
            "version": version,
            "status": status,
            "ip_address": ip_address,
            "last_seen": datetime.utcnow().isoformat(),
        }, on_conflict="node_name").execute()
        return resp.data[0] if resp.data else None
    except Exception as e:
        log.error("heartbeat: %s", e)
        return None


def get_node_status() -> list[dict]:
    """Get all node heartbeats."""
    client = _get_client()
    if not client:
        return []
    try:
        resp = client.table("node_heartbeats").select("*").execute()
        return resp.data or []
    except Exception as e:
        log.error("get_node_status: %s", e)
        return []


# ══════════════════════════════════════════════════════════════
# REMOTE COMMANDS
# ══════════════════════════════════════════════════════════════

def queue_command(command: str, data: dict = None, source: str = "",
                  target: str = "") -> Optional[dict]:
    """Queue a remote command for another node."""
    client = _get_client()
    if not client:
        return None
    try:
        resp = client.table("remote_commands").insert({
            "command": command,
            "data": data or {},
            "source": source,
            "target": target,
            "status": "pending",
        }).execute()
        return resp.data[0] if resp.data else None
    except Exception as e:
        log.error("queue_command: %s", e)
        return None


def get_pending_commands(target: str) -> list[dict]:
    """Get pending commands for a specific node."""
    client = _get_client()
    if not client:
        return []
    try:
        resp = (client.table("remote_commands")
                .select("*")
                .eq("target", target)
                .eq("status", "pending")
                .order("created_at")
                .execute())
        return resp.data or []
    except Exception as e:
        log.error("get_pending_commands: %s", e)
        return []


def update_command(command_id: str, status: str, result: str = "") -> Optional[dict]:
    """Update a command's status after execution."""
    client = _get_client()
    if not client:
        return None
    try:
        resp = (client.table("remote_commands")
                .update({
                    "status": status,
                    "result": result,
                    "executed_at": datetime.utcnow().isoformat(),
                })
                .eq("id", command_id)
                .execute())
        return resp.data[0] if resp.data else None
    except Exception as e:
        log.error("update_command: %s", e)
        return None


# ══════════════════════════════════════════════════════════════
# NOTIFICATIONS
# ══════════════════════════════════════════════════════════════

def add_notification(title: str, message: str, notif_type: str = "info",
                     icon: str = "🔔", node_target: str = "",
                     client_name: str = "", job_number: str = "") -> Optional[dict]:
    """Create an in-app notification."""
    client = _get_client()
    if not client:
        return None
    try:
        resp = client.table("notifications").insert({
            "type": notif_type,
            "title": title,
            "message": message,
            "icon": icon,
            "node_target": node_target,
            "client_name": client_name,
            "job_number": job_number,
        }).execute()
        return resp.data[0] if resp.data else None
    except Exception as e:
        log.error("add_notification: %s", e)
        return None


# ══════════════════════════════════════════════════════════════
# GENERIC TABLE ACCESS
# ══════════════════════════════════════════════════════════════

def get_table(table_name: str, limit: int = 1000, **filters) -> list[dict]:
    """Generic table read with optional filters."""
    client = _get_client()
    if not client:
        return []
    try:
        q = client.table(table_name).select("*")
        for key, value in filters.items():
            q = q.eq(key, value)
        resp = q.limit(limit).execute()
        return resp.data or []
    except Exception as e:
        log.error("get_table(%s): %s", table_name, e)
        return []


def upsert_row(table_name: str, data: dict, on_conflict: str = "") -> Optional[dict]:
    """Generic upsert to any table."""
    client = _get_client()
    if not client:
        return None
    try:
        clean = {k: v for k, v in data.items() if v is not None}
        if on_conflict:
            resp = client.table(table_name).upsert(clean, on_conflict=on_conflict).execute()
        else:
            resp = client.table(table_name).upsert(clean).execute()
        return resp.data[0] if resp.data else None
    except Exception as e:
        log.error("upsert_row(%s): %s", table_name, e)
        return None


def insert_row(table_name: str, data: dict) -> Optional[dict]:
    """Insert a single row into any table."""
    client = _get_client()
    if not client:
        return None
    try:
        clean = {k: v for k, v in data.items() if v is not None}
        resp = client.table(table_name).insert(clean).execute()
        return resp.data[0] if resp.data else None
    except Exception as e:
        log.error("insert_row(%s): %s", table_name, e)
        return None


# ══════════════════════════════════════════════════════════════
# SYNC LOG
# ══════════════════════════════════════════════════════════════

def log_sync(table_name: str, direction: str, records: int,
             source_node: str = "", status: str = "success",
             error: str = "") -> None:
    """Log a sync operation to the sync_log table."""
    client = _get_client()
    if not client:
        return
    try:
        client.table("sync_log").insert({
            "table_name": table_name,
            "direction": direction,
            "records_affected": records,
            "source_node": source_node,
            "status": status,
            "error_message": error,
        }).execute()
    except Exception as e:
        log.error("log_sync: %s", e)


# ══════════════════════════════════════════════════════════════
# MODULE-LEVEL CONVENIENCE
# ══════════════════════════════════════════════════════════════

# Lazy singleton — import and use: from app.supabase_client import supa
class _SupabaseProxy:
    """Proxy that forwards attribute access to module-level functions."""
    def __getattr__(self, name):
        if name in globals():
            return globals()[name]
        raise AttributeError(f"supabase_client has no function '{name}'")


supa = _SupabaseProxy()
