"""
GGM Hub — Auto Git Push
Periodically commits and pushes local changes to GitHub so the
laptop node can pull down the latest data and code.

Runs as a background daemon thread.
"""

import subprocess
import logging
import os
import threading
import time
from datetime import datetime

log = logging.getLogger("ggm.auto_push")

# Push every 15 minutes
PUSH_INTERVAL = 15 * 60  # seconds

# Root of the git repository (d:\gardening)
# platform/app/auto_push.py → .. → platform/ → .. → d:\gardening
REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


def _run_git(*args):
    """Run a git command in the repo root. Returns (ok, stdout, stderr)."""
    cmd = ["git"] + list(args)
    try:
        result = subprocess.run(
            cmd,
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            timeout=60,
        )
        return result.returncode == 0, result.stdout.strip(), result.stderr.strip()
    except FileNotFoundError:
        return False, "", "Git is not installed"
    except subprocess.TimeoutExpired:
        return False, "", "Git command timed out"
    except Exception as e:
        return False, "", str(e)


def _check_conflict_markers():
    """
    Scan tracked files for unresolved merge conflict markers (<<<<<<< / =======).
    Returns a list of filenames that contain them, or [] if clean.
    """
    try:
        result = subprocess.run(
            ["git", "grep", "-l", "^<<<<<<<"],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            timeout=30,
        )
        if result.returncode == 0 and result.stdout.strip():
            return [f.strip() for f in result.stdout.strip().splitlines() if f.strip()]
    except Exception as e:
        log.warning(f"Conflict marker check failed: {e}")
    return []


def push_now():
    """
    Stage, commit, and push any local changes immediately.
    Returns (success: bool, message: str).
    """
    # Check for changes
    ok, status, _ = _run_git("status", "--porcelain")
    if not ok:
        return False, "Could not check git status"

    if not status:
        return True, "Nothing to push — working tree clean"

    # ── Guard: never commit files with unresolved merge conflict markers ──
    conflict_files = _check_conflict_markers()
    if conflict_files:
        log.error(f"Conflict markers found in {len(conflict_files)} file(s) — "
                  f"skipping auto-push: {conflict_files}")
        return False, f"Conflict markers in: {', '.join(conflict_files)}"

    # Stage all tracked changes (respects .gitignore)
    ok, _, err = _run_git("add", "-A")
    if not ok:
        return False, f"Git add failed: {err}"

    # Commit with timestamp
    ts = datetime.now().strftime("%Y-%m-%d %H:%M")
    msg = f"PC auto-push {ts}"
    ok, _, err = _run_git("commit", "-m", msg)
    if not ok:
        if "nothing to commit" in err.lower():
            return True, "Nothing to commit"
        return False, f"Git commit failed: {err}"

    # Push
    ok, out, err = _run_git("push", "origin", "master")
    if not ok:
        # Try main branch
        ok, out, err = _run_git("push", "origin", "main")

    if ok:
        log.info(f"Auto-push succeeded: {msg}")
        return True, f"Pushed: {msg}"
    else:
        log.warning(f"Auto-push failed: {err}")
        return False, f"Push failed: {err}"


class AutoPush:
    """Background daemon that auto-pushes to GitHub at regular intervals."""

    def __init__(self, interval=PUSH_INTERVAL):
        self.interval = interval
        self._stop_event = threading.Event()
        self._thread = None

    def start(self):
        """Start the auto-push background thread."""
        if self._thread and self._thread.is_alive():
            return
        self._stop_event.clear()
        self._thread = threading.Thread(target=self._run_loop, daemon=True, name="auto-push")
        self._thread.start()
        log.info(f"Auto-push started (every {self.interval // 60}min)")

    def stop(self):
        """Stop the loop and do a final push before exiting."""
        self._stop_event.set()
        if self._thread:
            self._thread.join(timeout=5)

        # Final push on shutdown
        log.info("Final auto-push on shutdown...")
        try:
            ok, msg = push_now()
            log.info(f"Shutdown push: {msg}")
        except Exception as e:
            log.warning(f"Shutdown push error: {e}")

    def _run_loop(self):
        """Background loop: push every interval seconds."""
        # Wait a bit before first push (let startup settle)
        self._stop_event.wait(120)

        while not self._stop_event.is_set():
            try:
                ok, msg = push_now()
                if ok:
                    log.debug(f"Auto-push: {msg}")
                else:
                    log.warning(f"Auto-push issue: {msg}")
            except Exception as e:
                log.error(f"Auto-push error: {e}")

            self._stop_event.wait(self.interval)
