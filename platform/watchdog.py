"""
GGM Hub Watchdog — Standalone health monitor.

Checks if GGM Hub is alive via heartbeat timestamp in Google Sheets.
If the PC Hub heartbeat is stale (> STALE_MINUTES), restarts the NSSM service.

Run via Windows Task Scheduler every 5 minutes:
  python C:\GGM-Hub\platform\watchdog.py

Or run continuously (sleeps between checks):
  python C:\GGM-Hub\platform\watchdog.py --loop
"""

import json
import subprocess
import sys
import time
import urllib.request
from datetime import datetime

# ── Config ──
GAS_URL = (
    "https://script.google.com/macros/s/"
    "AKfycbxaT1YOoDZtVHP9CztiUutYFqMiOyygDJon5BxCij14CWl91WgdmrYqpbG4KVAlFh5IiQ/exec"
)
SERVICE_NAME = "GGMHub"
STALE_MINUTES = 10            # consider unhealthy after this many minutes
CHECK_INTERVAL = 300          # seconds between checks in --loop mode
MAX_RESTARTS_PER_HOUR = 3    # circuit breaker — avoid restart loops

_restart_times: list[float] = []


def _log(msg: str):
    """Simple timestamped print."""
    print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] {msg}", flush=True)


def _restart_service():
    """Restart the GGMHub NSSM service with circuit breaker."""
    global _restart_times
    now = time.time()
    _restart_times = [t for t in _restart_times if now - t < 3600]

    if len(_restart_times) >= MAX_RESTARTS_PER_HOUR:
        _log(f"CIRCUIT BREAKER: Already restarted {len(_restart_times)}x in the last hour. Skipping.")
        return False

    _log(f"Restarting {SERVICE_NAME} service...")
    try:
        result = subprocess.run(
            ["nssm", "restart", SERVICE_NAME],
            capture_output=True, text=True, timeout=60,
        )
        if result.returncode == 0:
            _restart_times.append(now)
            _log(f"Service restarted OK")
            return True
        else:
            _log(f"NSSM restart failed (exit {result.returncode}): {result.stderr.strip()}")
            # Fallback: try net stop/start
            subprocess.run(["net", "stop", SERVICE_NAME], timeout=30, capture_output=True)
            time.sleep(3)
            subprocess.run(["net", "start", SERVICE_NAME], timeout=30, capture_output=True)
            _restart_times.append(now)
            _log("Service restarted via net stop/start fallback")
            return True
    except FileNotFoundError:
        _log("NSSM not found — is it installed and on PATH?")
        return False
    except Exception as e:
        _log(f"Restart error: {e}")
        return False


def check_health() -> bool:
    """Check PC Hub heartbeat via GAS. Returns True if healthy."""
    try:
        url = f"{GAS_URL}?action=get_node_status"
        req = urllib.request.Request(url, method="GET")
        req.add_header("User-Agent", "GGM-Watchdog/1.0")

        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))

        nodes = data if isinstance(data, list) else data.get("nodes", data.get("data", []))

        for node in nodes:
            nid = node.get("node_id", node.get("nodeId", ""))
            if nid == "pc_hub":
                last_str = node.get("last_heartbeat", node.get("lastHeartbeat", ""))
                if not last_str:
                    _log("PC Hub found but no heartbeat timestamp")
                    return False

                # Parse ISO timestamp
                last = datetime.fromisoformat(last_str.replace("Z", "+00:00").replace("Z", ""))
                age_min = (datetime.now() - last.replace(tzinfo=None)).total_seconds() / 60

                if age_min > STALE_MINUTES:
                    _log(f"PC Hub heartbeat STALE: {age_min:.1f} min old (threshold {STALE_MINUTES} min)")
                    return False
                else:
                    _log(f"PC Hub alive: heartbeat {age_min:.1f} min ago")
                    return True

        _log("PC Hub node not found in status response")
        return False

    except urllib.error.URLError as e:
        _log(f"Cannot reach GAS webhook: {e.reason}")
        # Network down — don't restart (might just be internet)
        return True  # assume healthy when we can't check
    except Exception as e:
        _log(f"Health check error: {e}")
        return True  # assume healthy on unexpected errors


def run_once():
    """Single health check + restart if needed."""
    healthy = check_health()
    if not healthy:
        _restart_service()
    return healthy


def run_loop():
    """Continuous monitoring loop."""
    _log(f"Watchdog started (check every {CHECK_INTERVAL}s, stale after {STALE_MINUTES} min)")
    while True:
        try:
            run_once()
        except KeyboardInterrupt:
            _log("Watchdog stopped (Ctrl+C)")
            break
        except Exception as e:
            _log(f"Unexpected error: {e}")
        time.sleep(CHECK_INTERVAL)


if __name__ == "__main__":
    if "--loop" in sys.argv:
        run_loop()
    else:
        run_once()
