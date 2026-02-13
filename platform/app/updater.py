"""
GGM Hub — Auto-Updater
Pulls the latest code from GitHub before the Hub launches.
Enables multi-node workflow: edit on laptop → auto-update on PC.
"""

import subprocess
import logging
import os
import sys

log = logging.getLogger("ggm.updater")

# ── Paths ──
REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))


def _run_git(*args, cwd=None):
    """Run a git command and return (success, stdout, stderr)."""
    cmd = ["git"] + list(args)
    try:
        result = subprocess.run(
            cmd,
            cwd=cwd or REPO_ROOT,
            capture_output=True,
            text=True,
            timeout=30,
        )
        return result.returncode == 0, result.stdout.strip(), result.stderr.strip()
    except FileNotFoundError:
        return False, "", "Git is not installed"
    except subprocess.TimeoutExpired:
        return False, "", "Git command timed out"
    except Exception as e:
        return False, "", str(e)


def check_for_updates():
    """
    Check if the remote has newer commits than local.
    Returns (has_updates: bool, summary: str).
    """
    # Fetch latest from remote (don't merge yet)
    ok, _, err = _run_git("fetch", "origin", "--quiet")
    if not ok:
        return False, f"Could not reach GitHub: {err}"

    # Compare local HEAD with remote
    ok, local_hash, _ = _run_git("rev-parse", "HEAD")
    if not ok:
        return False, "Could not read local commit"

    ok, remote_hash, _ = _run_git("rev-parse", "origin/master")
    if not ok:
        # Try 'main' branch if 'master' doesn't exist
        ok, remote_hash, _ = _run_git("rev-parse", "origin/main")
        if not ok:
            return False, "Could not read remote commit"

    if local_hash == remote_hash:
        return False, "Already up to date"

    # Count how many commits behind
    ok, count, _ = _run_git("rev-list", "--count", f"HEAD..origin/master")
    if not ok:
        ok, count, _ = _run_git("rev-list", "--count", f"HEAD..origin/main")
    count = count if ok else "?"

    return True, f"{count} update(s) available"


def pull_updates():
    """
    Pull latest changes from GitHub.
    Returns (success: bool, message: str, files_changed: list[str]).
    """
    # Stash any local changes (e.g. config tweaks)
    _run_git("stash", "--include-untracked", "--quiet")

    # Pull with fast-forward only to avoid merge conflicts
    ok, out, err = _run_git("pull", "--ff-only", "origin", "master")
    if not ok:
        # Try 'main' branch
        ok, out, err = _run_git("pull", "--ff-only", "origin", "main")

    if not ok:
        # If fast-forward fails, do a hard reset to remote
        log.warning("Fast-forward pull failed, attempting reset...")
        ok2, _, _ = _run_git("reset", "--hard", "origin/master")
        if not ok2:
            ok2, _, _ = _run_git("reset", "--hard", "origin/main")
        if ok2:
            ok = True
            out = "Reset to latest remote version"
        else:
            # Pop stash back if everything failed
            _run_git("stash", "pop", "--quiet")
            return False, f"Update failed: {err}", []

    # Pop stash (re-apply any local changes)
    _run_git("stash", "pop", "--quiet")

    # Get list of changed files
    ok_diff, diff_out, _ = _run_git("diff", "--name-only", "HEAD~1", "HEAD")
    changed = diff_out.split("\n") if ok_diff and diff_out else []

    # Filter to platform files only
    platform_changes = [f for f in changed if f.startswith("platform/")]

    return True, out, platform_changes


def needs_restart(changed_files):
    """Check if any changed files require a Hub restart (i.e. Python code changed)."""
    for f in changed_files:
        if f.endswith(".py"):
            return True
    return False


def auto_update(silent=False):
    """
    Full auto-update flow. Call before Hub launches.
    Returns (updated: bool, needs_restart: bool, message: str).
    """
    log.info("Checking for updates from GitHub...")

    has_updates, summary = check_for_updates()

    if not has_updates:
        if not silent:
            log.info(f"Update check: {summary}")
        return False, False, summary

    log.info(f"Updates found: {summary}")
    log.info("Pulling updates...")

    success, message, changed = pull_updates()

    if not success:
        log.error(f"Update failed: {message}")
        return False, False, f"Update failed: {message}"

    restart = needs_restart(changed)
    change_count = len(changed)
    platform_count = len([f for f in changed if f.startswith("platform/")])

    summary = f"Updated {change_count} file(s)"
    if platform_count > 0:
        summary += f" ({platform_count} Hub file(s))"
    if restart:
        summary += " — restart required"

    log.info(summary)
    for f in changed:
        log.info(f"  Changed: {f}")

    return True, restart, summary


def get_current_version_info():
    """Get the current commit hash and timestamp for display."""
    ok, short_hash, _ = _run_git("rev-parse", "--short", "HEAD")
    ok2, timestamp, _ = _run_git("log", "-1", "--format=%ci")

    info = {}
    if ok:
        info["commit"] = short_hash
    if ok2:
        info["last_updated"] = timestamp

    return info


# ── CLI entry point for testing ──
if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(message)s")

    print("GGM Hub — Update Check")
    print("=" * 40)

    info = get_current_version_info()
    print(f"Current commit: {info.get('commit', 'unknown')}")
    print(f"Last updated:   {info.get('last_updated', 'unknown')}")
    print()

    updated, restart, msg = auto_update()

    if updated:
        print(f"\n✅ {msg}")
        if restart:
            print("⚠️  Hub code changed — please restart the Hub")
    else:
        print(f"\n{msg}")

    input("\nPress Enter to close...")
