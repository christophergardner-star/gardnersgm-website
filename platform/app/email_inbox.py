"""
GGM Hub — Email Inbox (IMAP)
Polls the enquiries@gardnersgm.co.uk mailbox via IMAP and stores emails
in the local SQLite database for viewing in the Hub UI.

Runs as a background daemon thread on both PC Hub and Laptop.
"""

import imaplib
import email
import email.header
import email.utils
import logging
import threading
import time
import re
from datetime import datetime, timedelta
from email.message import Message

from . import config

log = logging.getLogger("ggm.email_inbox")


def _decode_header(raw: str) -> str:
    """Decode a MIME-encoded header into a plain string."""
    if not raw:
        return ""
    parts = email.header.decode_header(raw)
    decoded = []
    for data, charset in parts:
        if isinstance(data, bytes):
            decoded.append(data.decode(charset or "utf-8", errors="replace"))
        else:
            decoded.append(str(data))
    return " ".join(decoded).strip()


def _parse_address(raw: str) -> tuple[str, str]:
    """Parse a From/To header into (name, email)."""
    if not raw:
        return ("", "")
    decoded = _decode_header(raw)
    name, addr = email.utils.parseaddr(decoded)
    return (name.strip(), addr.strip().lower())


def _parse_date(raw: str) -> str:
    """Parse an email Date header into ISO format string."""
    if not raw:
        return ""
    try:
        parsed = email.utils.parsedate_to_datetime(raw)
        return parsed.isoformat()
    except Exception:
        return raw


def _get_body(msg: Message) -> tuple[str, str]:
    """Extract plain text and HTML body from an email message.
    Returns (text, html)."""
    text_body = ""
    html_body = ""

    if msg.is_multipart():
        for part in msg.walk():
            content_type = part.get_content_type()
            disposition = str(part.get("Content-Disposition", ""))

            # Skip attachments
            if "attachment" in disposition:
                continue

            try:
                payload = part.get_payload(decode=True)
                if not payload:
                    continue
                charset = part.get_content_charset() or "utf-8"
                decoded = payload.decode(charset, errors="replace")
            except Exception:
                continue

            if content_type == "text/plain" and not text_body:
                text_body = decoded
            elif content_type == "text/html" and not html_body:
                html_body = decoded
    else:
        try:
            payload = msg.get_payload(decode=True)
            if payload:
                charset = msg.get_content_charset() or "utf-8"
                decoded = payload.decode(charset, errors="replace")
                if msg.get_content_type() == "text/html":
                    html_body = decoded
                else:
                    text_body = decoded
        except Exception:
            pass

    return text_body, html_body


def _get_attachments(msg: Message) -> list[dict]:
    """Extract attachment metadata (name, size, content-type)."""
    attachments = []
    if not msg.is_multipart():
        return attachments

    for part in msg.walk():
        disposition = str(part.get("Content-Disposition", ""))
        if "attachment" not in disposition and "inline" not in disposition:
            continue

        filename = part.get_filename()
        if filename:
            filename = _decode_header(filename)
        else:
            # Skip parts without filenames (usually inline text/html)
            ct = part.get_content_type()
            if ct in ("text/plain", "text/html"):
                continue
            filename = f"unnamed.{ct.split('/')[-1]}"

        size = len(part.get_payload(decode=True) or b"")
        attachments.append({
            "name": filename,
            "size": size,
            "content_type": part.get_content_type(),
        })
    return attachments


def _match_client(from_email: str, db) -> str:
    """Try to match the sender email to an existing client."""
    if not from_email:
        return ""
    try:
        row = db.fetchone(
            "SELECT name FROM clients WHERE LOWER(email) = ? LIMIT 1",
            (from_email.lower(),)
        )
        if row:
            return row["name"]

        # Also check enquiries
        row = db.fetchone(
            "SELECT name FROM enquiries WHERE LOWER(email) = ? LIMIT 1",
            (from_email.lower(),)
        )
        if row:
            return row["name"]
    except Exception:
        pass
    return ""


class EmailInbox:
    """Background IMAP poller that fetches emails into the local database."""

    def __init__(self, db, poll_interval: int = None):
        self.db = db
        self.poll_interval = poll_interval or config.IMAP_POLL_INTERVAL
        self._running = False
        self._thread = None
        self._imap = None
        self._last_fetch = None  # track last successful fetch
        self._consecutive_errors = 0

    @property
    def is_configured(self) -> bool:
        return bool(config.IMAP_HOST and config.IMAP_USER and config.IMAP_PASSWORD)

    def start(self):
        """Start the background IMAP polling thread."""
        if not self.is_configured:
            log.warning("IMAP not configured — inbox disabled "
                        "(set IMAP_HOST, IMAP_USER, IMAP_PASSWORD in .env)")
            return False

        if self._thread and self._thread.is_alive():
            return True

        self._running = True
        self._thread = threading.Thread(
            target=self._run_loop, daemon=True, name="email-inbox"
        )
        self._thread.start()
        log.info(f"Email inbox started (polling every {self.poll_interval}s) — {config.IMAP_USER}")
        return True

    def stop(self):
        """Stop the IMAP polling thread."""
        self._running = False
        self._disconnect()
        if self._thread:
            self._thread.join(timeout=5)

    def _run_loop(self):
        """Background loop: fetch emails at regular intervals."""
        # Small delay to let the rest of the app start
        time.sleep(8)

        # Initial fetch — get recent emails
        self._fetch_new()

        while self._running:
            time.sleep(self.poll_interval)
            if not self._running:
                break
            try:
                self._fetch_new()
                self._consecutive_errors = 0
            except Exception as e:
                self._consecutive_errors += 1
                log.error(f"IMAP fetch error ({self._consecutive_errors}): {e}")
                self._disconnect()

                # Back off if repeated errors
                if self._consecutive_errors >= 5:
                    log.warning("Too many IMAP errors — backing off 5 min")
                    time.sleep(300)

    def _connect(self) -> imaplib.IMAP4_SSL:
        """Connect to the IMAP server. Reuses existing connection if alive."""
        if self._imap:
            try:
                self._imap.noop()
                return self._imap
            except Exception:
                self._disconnect()

        log.debug(f"Connecting to IMAP: {config.IMAP_HOST}:{config.IMAP_PORT}")
        self._imap = imaplib.IMAP4_SSL(
            config.IMAP_HOST,
            config.IMAP_PORT,
            timeout=30,
        )
        self._imap.login(config.IMAP_USER, config.IMAP_PASSWORD)
        log.debug("IMAP login OK")
        return self._imap

    def _disconnect(self):
        """Safely close the IMAP connection."""
        if self._imap:
            try:
                self._imap.logout()
            except Exception:
                pass
            self._imap = None

    def _fetch_new(self):
        """Fetch new emails from the server since last check."""
        conn = self._connect()
        conn.select("INBOX", readonly=True)

        # Determine search criteria — fetch last 7 days on first run,
        # then only new (UNSEEN or since last fetch)
        if self._last_fetch is None:
            # First run: get last 7 days
            since = (datetime.now() - timedelta(days=7)).strftime("%d-%b-%Y")
            search_criteria = f'(SINCE {since})'
        else:
            # Subsequent runs: get since last fetch
            since = self._last_fetch.strftime("%d-%b-%Y")
            search_criteria = f'(SINCE {since})'

        status, data = conn.search(None, search_criteria)
        if status != "OK":
            log.warning(f"IMAP search failed: {status}")
            return

        msg_nums = data[0].split()
        if not msg_nums:
            log.debug("No new emails")
            self._last_fetch = datetime.now()
            return

        new_count = 0
        for num in msg_nums:
            try:
                # Fetch full message
                status, msg_data = conn.fetch(num, "(RFC822)")
                if status != "OK" or not msg_data or not msg_data[0]:
                    continue

                raw_email = msg_data[0][1]
                msg = email.message_from_bytes(raw_email)

                # Extract message ID
                message_id = msg.get("Message-ID", "").strip()
                if not message_id:
                    # Generate a fallback ID from date + from + subject
                    message_id = f"<gen-{hash(str(msg.get('Date', '')) + str(msg.get('From', '')))}>"

                # Skip if already in database
                if self.db.inbox_message_exists(message_id):
                    continue

                # Parse the email
                from_name, from_email = _parse_address(msg.get("From", ""))
                _, to_email = _parse_address(msg.get("To", ""))
                subject = _decode_header(msg.get("Subject", ""))
                date_received = _parse_date(msg.get("Date", ""))
                text_body, html_body = _get_body(msg)
                attachments = _get_attachments(msg)

                # Try to match sender to a known client
                client_name = _match_client(from_email, self.db)

                # Save to database
                import json
                self.db.save_inbox_email({
                    "message_id": message_id,
                    "from_name": from_name,
                    "from_email": from_email,
                    "to_email": to_email,
                    "subject": subject,
                    "body_text": text_body[:50000],  # cap at 50k chars
                    "body_html": html_body[:100000],
                    "date_received": date_received,
                    "folder": "INBOX",
                    "has_attachments": len(attachments) > 0,
                    "attachment_info": json.dumps(attachments) if attachments else "",
                    "client_name": client_name,
                })
                new_count += 1

            except Exception as e:
                log.debug(f"Error parsing email {num}: {e}")
                continue

        self._last_fetch = datetime.now()
        if new_count > 0:
            log.info(f"Fetched {new_count} new email(s)")

    def fetch_now(self) -> int:
        """Manual fetch — called from UI button. Returns count of new emails."""
        if not self.is_configured:
            return 0
        try:
            before = self.db.get_inbox_stats()["total"]
            self._fetch_new()
            after = self.db.get_inbox_stats()["total"]
            return after - before
        except Exception as e:
            log.error(f"Manual fetch error: {e}")
            return 0

    def delete_from_server(self, message_id: str) -> bool:
        """Delete a single email from the IMAP server by Message-ID."""
        if not self.is_configured or not message_id:
            return False
        try:
            conn = self._connect()
            conn.select("INBOX")  # writable (not readonly)

            # Search for the message by Message-ID header
            safe_id = message_id.replace('"', '\\"')
            status, data = conn.search(None, f'(HEADER Message-ID "{safe_id}")')
            if status != "OK" or not data[0]:
                log.debug(f"Message not found on server: {message_id}")
                return False

            for num in data[0].split():
                conn.store(num, "+FLAGS", "\\Deleted")

            conn.expunge()
            log.info(f"Deleted from IMAP server: {message_id}")
            return True
        except Exception as e:
            log.error(f"IMAP delete error: {e}")
            self._disconnect()
            return False

    def delete_all_from_server(self, message_ids: list[str]) -> int:
        """Delete multiple emails from the IMAP server. Returns count deleted."""
        if not self.is_configured or not message_ids:
            return 0
        deleted = 0
        try:
            conn = self._connect()
            conn.select("INBOX")  # writable

            for mid in message_ids:
                try:
                    safe_id = mid.replace('"', '\\"')
                    status, data = conn.search(None, f'(HEADER Message-ID "{safe_id}")')
                    if status == "OK" and data[0]:
                        for num in data[0].split():
                            conn.store(num, "+FLAGS", "\\Deleted")
                        deleted += 1
                except Exception as e:
                    log.debug(f"Error deleting {mid}: {e}")
                    continue

            if deleted:
                conn.expunge()
            log.info(f"Deleted {deleted}/{len(message_ids)} from IMAP server")
            return deleted
        except Exception as e:
            log.error(f"IMAP bulk delete error: {e}")
            self._disconnect()
            return 0

    def get_status(self) -> dict:
        """Return current inbox status for display."""
        stats = self.db.get_inbox_stats()
        return {
            "configured": self.is_configured,
            "running": self._running,
            "last_fetch": self._last_fetch.isoformat() if self._last_fetch else None,
            "errors": self._consecutive_errors,
            **stats,
        }
