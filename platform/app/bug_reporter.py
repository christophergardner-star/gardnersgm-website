"""
Bug Finder & Reporter — continuous error monitoring for GGM Hub.

Scans the application log for errors/warnings, aggregates them,
detects recurring patterns, and sends Telegram alerts for critical issues.
Also provides an API for the UI to display a diagnostics panel.

Designed to run as a lightweight background thread alongside the Hub.
"""

import logging
import re
import threading
import time
import json
from collections import Counter, defaultdict
from datetime import datetime, timedelta
from pathlib import Path

log = logging.getLogger("ggm.bug_reporter")

# ── Error severity levels ──
SEVERITY_CRITICAL = "critical"
SEVERITY_ERROR = "error"
SEVERITY_WARNING = "warning"
SEVERITY_INFO = "info"

# ── Patterns that indicate real bugs vs noise ──
BUG_PATTERNS = [
    # Critical — things that break core functionality
    (re.compile(r"(?i)(traceback|exception|error).*(?:database|sqlite|db)", re.DOTALL), SEVERITY_CRITICAL, "Database Error"),
    (re.compile(r"(?i)brevo.*(fail|error|HTTP [45]\d\d)"), SEVERITY_CRITICAL, "Email Delivery Failure"),
    (re.compile(r"(?i)stripe.*(fail|error|HTTP [45]\d\d)"), SEVERITY_CRITICAL, "Stripe Payment Error"),
    (re.compile(r"(?i)sync.*(fail|error|timeout)"), SEVERITY_ERROR, "Sync Failure"),
    (re.compile(r"(?i)GAS.*(fail|error|HTTP [45]\d\d)"), SEVERITY_ERROR, "GAS Webhook Error"),
    (re.compile(r"(?i)telegram.*(fail|error)"), SEVERITY_WARNING, "Telegram Alert Failure"),
    # Errors — things that affect specific features
    (re.compile(r"(?i)failed to import tab"), SEVERITY_ERROR, "Tab Import Failure"),
    (re.compile(r"(?i)failed to create tab"), SEVERITY_ERROR, "Tab Creation Failure"),
    (re.compile(r"(?i)email.*(?:fail|error|queue)"), SEVERITY_ERROR, "Email Error"),
    (re.compile(r"(?i)(?:connection|connect).*(?:refuse|timeout|fail)"), SEVERITY_ERROR, "Connection Failure"),
    (re.compile(r"(?i)permission.*denied"), SEVERITY_ERROR, "Permission Error"),
    (re.compile(r"(?i)disk.*(?:full|space)"), SEVERITY_CRITICAL, "Disk Space Issue"),
    # Warnings — things worth tracking
    (re.compile(r"(?i)WARNING"), SEVERITY_WARNING, "Warning"),
    (re.compile(r"(?i)retry|retrying"), SEVERITY_WARNING, "Retry Detected"),
    (re.compile(r"(?i)fallback"), SEVERITY_WARNING, "Fallback Triggered"),
    (re.compile(r"(?i)deprecated"), SEVERITY_INFO, "Deprecation Notice"),
]

# Lines to skip (noise)
IGNORE_PATTERNS = [
    re.compile(r"(?i)urllib3.*connection.*pool"),
    re.compile(r"(?i)PIL.*"),
    re.compile(r"(?i)matplotlib.*"),
    re.compile(r"(?i)DEBUG"),
]


class BugReport:
    """Single bug/error occurrence."""

    def __init__(self, severity: str, category: str, message: str,
                 source: str = "", line_number: int = 0):
        self.severity = severity
        self.category = category
        self.message = message[:500]  # Cap length
        self.source = source
        self.line_number = line_number
        self.first_seen = datetime.now()
        self.last_seen = datetime.now()
        self.count = 1
        self.resolved = False

    def fingerprint(self) -> str:
        """Unique key for deduplication."""
        # Normalize numbers/timestamps out of the message
        normalized = re.sub(r"\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}", "<TIMESTAMP>", self.message)
        normalized = re.sub(r"\b\d{5,}\b", "<ID>", normalized)
        return f"{self.category}::{normalized[:200]}"

    def to_dict(self) -> dict:
        return {
            "severity": self.severity,
            "category": self.category,
            "message": self.message,
            "source": self.source,
            "first_seen": self.first_seen.isoformat(),
            "last_seen": self.last_seen.isoformat(),
            "count": self.count,
            "resolved": self.resolved,
        }


class BugReporter:
    """
    Background bug finder — monitors the log file, aggregates errors,
    alerts on critical issues, and provides a diagnostics API.
    """

    SCAN_INTERVAL = 120  # seconds between log scans
    MAX_BUGS = 200       # max tracked unique bugs
    ALERT_COOLDOWN = 3600  # min seconds between Telegram alerts for same bug

    def __init__(self, db=None, api=None, log_path: Path = None):
        from . import config
        self.db = db
        self.api = api
        self.log_path = log_path or (config.DATA_DIR / "ggm_hub.log")
        self._bugs: dict[str, BugReport] = {}   # fingerprint → BugReport
        self._alert_times: dict[str, float] = {}  # fingerprint → last alert timestamp
        self._last_scan_pos = 0   # file read position
        self._lock = threading.Lock()
        self._running = False
        self._thread = None
        self._startup_checks_done = False
        log.info("BugReporter initialised (log: %s)", self.log_path)

    # ── Public API ──

    def start(self):
        """Start background scanning thread."""
        if self._running:
            return
        self._running = True
        self._thread = threading.Thread(target=self._run_loop, daemon=True, name="bug-reporter")
        self._thread.start()
        log.info("BugReporter background scanner started")

    def stop(self):
        """Stop background scanning."""
        self._running = False

    def get_summary(self) -> dict:
        """Return current bug summary for UI display."""
        with self._lock:
            bugs = list(self._bugs.values())

        active = [b for b in bugs if not b.resolved]
        by_severity = Counter(b.severity for b in active)
        recent = sorted(active, key=lambda b: b.last_seen, reverse=True)[:20]

        return {
            "total_active": len(active),
            "total_resolved": len(bugs) - len(active),
            "critical": by_severity.get(SEVERITY_CRITICAL, 0),
            "errors": by_severity.get(SEVERITY_ERROR, 0),
            "warnings": by_severity.get(SEVERITY_WARNING, 0),
            "recent": [b.to_dict() for b in recent],
            "top_recurring": [
                b.to_dict() for b in
                sorted(active, key=lambda b: b.count, reverse=True)[:10]
            ],
            "last_scan": datetime.now().isoformat(),
            "health_score": self._calculate_health_score(active),
        }

    def get_health_score(self) -> int:
        """0-100 health score. 100 = no issues."""
        with self._lock:
            active = [b for b in self._bugs.values() if not b.resolved]
        return self._calculate_health_score(active)

    def run_system_check(self) -> list[dict]:
        """Run comprehensive system diagnostics. Returns list of check results."""
        checks = []
        checks.append(self._check_log_file())
        checks.append(self._check_database())
        checks.append(self._check_gas_webhook())
        checks.append(self._check_brevo())
        checks.append(self._check_stripe())
        checks.append(self._check_disk_space())
        checks.append(self._check_ollama())
        return checks

    def resolve_bug(self, fingerprint: str):
        """Mark a bug as resolved."""
        with self._lock:
            if fingerprint in self._bugs:
                self._bugs[fingerprint].resolved = True

    def clear_resolved(self):
        """Remove all resolved bugs from memory."""
        with self._lock:
            self._bugs = {k: v for k, v in self._bugs.items() if not v.resolved}

    # ── Background Loop ──

    def _run_loop(self):
        """Main background loop — scan log + periodic system checks."""
        # Initial system check
        time.sleep(10)  # Let app finish startup
        try:
            self._run_system_checks_and_report()
        except Exception as e:
            log.error("Startup system check failed: %s", e)

        while self._running:
            try:
                self._scan_log()
            except Exception as e:
                log.error("BugReporter scan error: %s", e)
            time.sleep(self.SCAN_INTERVAL)

    def _scan_log(self):
        """Read new lines from the log file and classify them."""
        if not self.log_path.exists():
            return

        try:
            file_size = self.log_path.stat().st_size
            # If file has been rotated/truncated, reset position
            if file_size < self._last_scan_pos:
                self._last_scan_pos = 0

            with open(self.log_path, "r", encoding="utf-8", errors="replace") as f:
                f.seek(self._last_scan_pos)
                new_lines = f.readlines()
                self._last_scan_pos = f.tell()
        except Exception as e:
            log.error("Failed to read log file: %s", e)
            return

        for line in new_lines:
            line = line.strip()
            if not line or len(line) < 10:
                continue

            # Skip noise
            if any(p.search(line) for p in IGNORE_PATTERNS):
                continue

            # Classify against bug patterns
            for pattern, severity, category in BUG_PATTERNS:
                if pattern.search(line):
                    self._record_bug(severity, category, line)
                    break

    def _record_bug(self, severity: str, category: str, message: str,
                    source: str = "log"):
        """Record or update a bug."""
        bug = BugReport(severity, category, message, source)
        fp = bug.fingerprint()

        with self._lock:
            if fp in self._bugs:
                existing = self._bugs[fp]
                existing.last_seen = datetime.now()
                existing.count += 1
                # Un-resolve if it recurs
                if existing.resolved:
                    existing.resolved = False
            else:
                self._bugs[fp] = bug
                # Trim if too many
                if len(self._bugs) > self.MAX_BUGS:
                    oldest_key = min(
                        self._bugs,
                        key=lambda k: self._bugs[k].last_seen
                    )
                    del self._bugs[oldest_key]

        # Alert via Telegram for critical issues
        if severity == SEVERITY_CRITICAL:
            self._send_alert(fp, bug)

    def _send_alert(self, fingerprint: str, bug: BugReport):
        """Send Telegram alert (with cooldown to avoid spam)."""
        now = time.time()
        last_alert = self._alert_times.get(fingerprint, 0)
        if now - last_alert < self.ALERT_COOLDOWN:
            return

        self._alert_times[fingerprint] = now

        try:
            from . import config
            if not config.TG_BOT_TOKEN or not config.TG_CHAT_ID:
                return
            import urllib.request
            # Use plain text — bug messages contain special chars that break Markdown
            divider = "\u2501" * 20
            text = (
                f"\U0001f6a8 BUG DETECTED\n"
                f"{divider}\n"
                f"\U0001f534 {bug.category}\n"
                f"\U0001f4cb {bug.message[:300]}\n"
                f"\U0001f504 Occurrences: {bug.count}\n"
                f"\u231a First: {bug.first_seen.strftime('%H:%M')}"
            )
            payload = json.dumps({
                "chat_id": config.TG_CHAT_ID,
                "text": text,
            }).encode()
            req = urllib.request.Request(
                f"{config.TG_API_URL}/sendMessage",
                data=payload,
                headers={"Content-Type": "application/json"}
            )
            urllib.request.urlopen(req, timeout=10)
        except Exception as e:
            log.error("BugReporter Telegram alert failed: %s", e)

    # ── System Checks ──

    def _run_system_checks_and_report(self):
        """Run all system checks and record any failures as bugs."""
        checks = self.run_system_check()
        for check in checks:
            if check["status"] == "fail":
                self._record_bug(
                    SEVERITY_ERROR, check["name"],
                    check.get("detail", check["name"] + " check failed"),
                    source="system_check"
                )
            elif check["status"] == "warn":
                self._record_bug(
                    SEVERITY_WARNING, check["name"],
                    check.get("detail", check["name"] + " check warning"),
                    source="system_check"
                )

    def _check_log_file(self) -> dict:
        """Check log file size and recent error rate."""
        try:
            if not self.log_path.exists():
                return {"name": "Log File", "status": "warn", "detail": "Log file not found"}
            size_mb = self.log_path.stat().st_size / (1024 * 1024)
            if size_mb > 50:
                return {"name": "Log File", "status": "warn",
                        "detail": f"Log file is {size_mb:.1f}MB — consider rotating"}
            return {"name": "Log File", "status": "pass",
                    "detail": f"{size_mb:.1f}MB"}
        except Exception as e:
            return {"name": "Log File", "status": "fail", "detail": str(e)}

    def _check_database(self) -> dict:
        """Check database connectivity and basic integrity."""
        try:
            if not self.db:
                return {"name": "Database", "status": "warn", "detail": "No DB reference"}
            count = self.db.get_client_count() if hasattr(self.db, "get_client_count") else -1
            if count < 0:
                return {"name": "Database", "status": "warn", "detail": "Could not query clients"}
            return {"name": "Database", "status": "pass",
                    "detail": f"{count} clients in database"}
        except Exception as e:
            return {"name": "Database", "status": "fail",
                    "detail": f"DB error: {str(e)[:200]}"}

    def _check_gas_webhook(self) -> dict:
        """Check GAS webhook is reachable."""
        try:
            from . import config
            import urllib.request
            url = config.SHEETS_WEBHOOK + "?action=ping"
            req = urllib.request.Request(url, method="GET")
            resp = urllib.request.urlopen(req, timeout=15)
            if resp.status == 200:
                return {"name": "GAS Webhook", "status": "pass", "detail": "Reachable"}
            return {"name": "GAS Webhook", "status": "warn",
                    "detail": f"HTTP {resp.status}"}
        except Exception as e:
            return {"name": "GAS Webhook", "status": "fail",
                    "detail": f"Unreachable: {str(e)[:200]}"}

    def _check_brevo(self) -> dict:
        """Check Brevo API connectivity."""
        try:
            from . import config
            if not config.BREVO_API_KEY:
                return {"name": "Brevo Email", "status": "warn", "detail": "No API key configured"}
            import urllib.request
            req = urllib.request.Request(
                "https://api.brevo.com/v3/account",
                headers={"api-key": config.BREVO_API_KEY, "Accept": "application/json"}
            )
            resp = urllib.request.urlopen(req, timeout=10)
            data = json.loads(resp.read())
            credits = data.get("plan", [{}])
            return {"name": "Brevo Email", "status": "pass",
                    "detail": f"Connected — {data.get('email', 'ok')}"}
        except Exception as e:
            return {"name": "Brevo Email", "status": "fail",
                    "detail": f"API error: {str(e)[:200]}"}

    def _check_stripe(self) -> dict:
        """Check Stripe API key validity."""
        try:
            from . import config
            if not config.STRIPE_SECRET_KEY:
                return {"name": "Stripe", "status": "warn", "detail": "No API key configured"}
            import urllib.request
            req = urllib.request.Request(
                "https://api.stripe.com/v1/balance",
                headers={"Authorization": f"Bearer {config.STRIPE_SECRET_KEY}"}
            )
            resp = urllib.request.urlopen(req, timeout=10)
            if resp.status == 200:
                data = json.loads(resp.read())
                available = sum(b.get("amount", 0) for b in data.get("available", []))
                return {"name": "Stripe", "status": "pass",
                        "detail": f"Connected — balance: \u00a3{available / 100:.2f}"}
            return {"name": "Stripe", "status": "warn",
                    "detail": f"HTTP {resp.status}"}
        except Exception as e:
            return {"name": "Stripe", "status": "fail",
                    "detail": f"API error: {str(e)[:200]}"}

    def _check_disk_space(self) -> dict:
        """Check available disk space."""
        try:
            import shutil
            total, used, free = shutil.disk_usage(self.log_path.parent)
            free_gb = free / (1024 ** 3)
            pct_free = (free / total) * 100
            if pct_free < 5:
                return {"name": "Disk Space", "status": "fail",
                        "detail": f"Only {free_gb:.1f}GB free ({pct_free:.0f}%)"}
            if pct_free < 15:
                return {"name": "Disk Space", "status": "warn",
                        "detail": f"{free_gb:.1f}GB free ({pct_free:.0f}%)"}
            return {"name": "Disk Space", "status": "pass",
                    "detail": f"{free_gb:.1f}GB free ({pct_free:.0f}%)"}
        except Exception as e:
            return {"name": "Disk Space", "status": "fail", "detail": str(e)}

    def _check_ollama(self) -> dict:
        """Check if Ollama/Llama is available for content generation."""
        try:
            from . import config
            import urllib.request
            req = urllib.request.Request(f"{config.OLLAMA_URL}/api/tags")
            resp = urllib.request.urlopen(req, timeout=5)
            data = json.loads(resp.read())
            models = [m.get("name", "") for m in data.get("models", [])]
            llama_models = [m for m in models if "llama" in m.lower()]
            if llama_models:
                return {"name": "Ollama/Llama", "status": "pass",
                        "detail": f"Running — {', '.join(llama_models[:3])}"}
            elif models:
                return {"name": "Ollama/Llama", "status": "pass",
                        "detail": f"Running — {', '.join(models[:3])} (no Llama)"}
            return {"name": "Ollama/Llama", "status": "warn",
                    "detail": "Running but no models loaded"}
        except Exception:
            return {"name": "Ollama/Llama", "status": "warn",
                    "detail": "Not running (content will use Gemini fallback)"}

    # ── Scoring ──

    @staticmethod
    def _calculate_health_score(active_bugs: list) -> int:
        """Calculate 0-100 health score from active bugs."""
        if not active_bugs:
            return 100
        score = 100
        for bug in active_bugs:
            if bug.severity == SEVERITY_CRITICAL:
                score -= 25
            elif bug.severity == SEVERITY_ERROR:
                score -= 10
            elif bug.severity == SEVERITY_WARNING:
                score -= 2
            # Extra penalty for recurring bugs
            if bug.count > 5:
                score -= 5
        return max(0, min(100, score))
