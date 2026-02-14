"""
GGM Hub — Main entry point.
Gardners Ground Maintenance business platform.

Launch via:
  python -m app.main      (from platform/)
  python app/main.py      (from platform/)
  launch.bat              (double-click)
"""

import sys
import os
import logging
import time
import threading
from pathlib import Path

# Ensure platform/ is on sys.path so imports resolve
APP_DIR = Path(__file__).resolve().parent
PLATFORM_DIR = APP_DIR.parent
if str(PLATFORM_DIR) not in sys.path:
    sys.path.insert(0, str(PLATFORM_DIR))


def setup_logging():
    """Configure application logging."""
    log_dir = PLATFORM_DIR / "data"
    log_dir.mkdir(parents=True, exist_ok=True)
    log_file = log_dir / "ggm_hub.log"

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
        handlers=[
            logging.FileHandler(log_file, encoding="utf-8"),
            logging.StreamHandler(sys.stdout),
        ],
    )
    # Suppress noisy libraries
    logging.getLogger("urllib3").setLevel(logging.WARNING)
    logging.getLogger("PIL").setLevel(logging.WARNING)
    logging.getLogger("matplotlib").setLevel(logging.WARNING)


def main():
    """Application entry point."""
    setup_logging()
    logger = logging.getLogger("ggm_hub")
    logger.info("=" * 50)
    logger.info("GGM Hub starting...")

    # ── Auto-update from GitHub ──
    try:
        from app.updater import auto_update, get_current_version_info
        updated, restart_needed, update_msg = auto_update(silent=True)
        if updated:
            logger.info(f"Auto-update: {update_msg}")
        version_info = get_current_version_info()
        logger.info(f"Build: {version_info.get('commit', 'unknown')}")
    except Exception as e:
        logger.warning(f"Update check skipped: {e}")
        version_info = {}

    # ── Load configuration ──
    from app import config
    logger.info(f"Data directory: {config.DATA_DIR}")
    logger.info(f"Webhook configured: {'Yes' if config.SHEETS_WEBHOOK else 'No'}")
    logger.info(f"Telegram configured: {'Yes' if config.TG_BOT_TOKEN else 'No'}")

    # ── Initialise database ──
    from app.database import Database
    db = Database(config.DB_PATH)
    db.connect()
    db.initialize()
    logger.info(f"Database ready: {config.DB_PATH}")

    # Run startup backup
    try:
        backup_path = db.backup()
        if backup_path:
            logger.info(f"Backup created: {backup_path}")
    except Exception as e:
        logger.warning(f"Backup failed: {e}")

    # ── Initialise API client ──
    from app.api import APIClient
    api = APIClient(config.SHEETS_WEBHOOK)
    online = api.is_online()
    logger.info(f"Network status: {'Online' if online else 'Offline'}")

    # ── Start sync engine ──
    from app.sync import SyncEngine
    sync = SyncEngine(db, api)
    sync.start()
    logger.info("Sync engine started")

    # ── Start agent scheduler ──
    from app.agents import AgentScheduler
    agent_scheduler = AgentScheduler(db, api)
    _ensure_default_agents(db, logger)
    agent_scheduler.start()
    logger.info("Agent scheduler started")

    # ── Start email provider ──
    from app.email_provider import EmailProvider
    email_provider = EmailProvider(db, api)

    # Health check Brevo on startup
    if email_provider._has_brevo:
        hc = email_provider.health_check()
        if hc["ok"]:
            logger.info(f"Brevo health check OK (credits: {hc.get('credits', '?')})")
        else:
            logger.warning(f"Brevo health check FAILED: {hc['error']}")
    else:
        logger.info("No BREVO_API_KEY — emails will use GAS MailApp only")

    # ── Start email automation engine ──
    from app.email_automation import EmailAutomationEngine
    email_engine = EmailAutomationEngine(db, api, email_provider=email_provider)
    email_engine.start()
    logger.info("Email automation engine started")

    # ── Start photo storage service ──
    from app.photo_storage import PhotoStorageService
    photo_service = PhotoStorageService(db, api)
    stats = photo_service.get_storage_stats()
    logger.info(
        f"Photo storage: {stats['total_photos']} photos, "
        f"{stats['total_size_mb']} MB, "
        f"{stats['drive_free_gb']} GB free on drive"
    )

    # ── Start remote command queue (PC listens for laptop triggers) ──
    from app.command_queue import CommandQueue
    command_queue = CommandQueue(
        api=api, db=db, sync=sync,
        agent_scheduler=agent_scheduler,
        email_engine=email_engine,
    )
    command_queue.start()
    logger.info("Remote command queue started (listening for laptop triggers)")

    # ── Start auto-git-push (pushes code changes to GitHub periodically) ──
    from app.auto_push import AutoPush
    auto_push = AutoPush()
    auto_push.start()
    logger.info("Auto git-push started")

    # ── Start heartbeat service (lets Field App see we're online) ──
    from app.heartbeat import HeartbeatService
    heartbeat = HeartbeatService(api, node_id="pc_hub", node_type="pc")
    heartbeat.start()
    logger.info("Heartbeat service started (node=pc_hub)")

    # ── Startup Health Check ──
    health_results = _startup_health_check(api, db, logger)

    # ── Launch UI ──
    logger.info("Launching UI...")

    try:
        import customtkinter as ctk

        # Theme
        ctk.set_appearance_mode("dark")
        ctk.set_default_color_theme("dark-blue")

        def launch_main_window():
            """Called after PIN is verified — opens the real app."""
            from app.ui.app_window import AppWindow
            window = AppWindow(db=db, sync_engine=sync, api=api,
                               agent_scheduler=agent_scheduler,
                               email_engine=email_engine,
                               heartbeat=heartbeat)
            window.protocol("WM_DELETE_WINDOW",
                            lambda: _shutdown(window, sync, agent_scheduler,
                                              email_engine, command_queue,
                                              auto_push, heartbeat, db, logger))

            # Trigger initial data load once UI is ready
            window.after(500, lambda: _initial_load(window, sync, logger, health_results))

            logger.info("UI ready — entering main loop")
            window.mainloop()

        # ── PIN lock screen ──
        from app.ui.pin_screen import PinScreen
        pin_screen = PinScreen(db=db, on_success=launch_main_window)
        logger.info("PIN screen shown")
        pin_screen.mainloop()

    except ImportError as e:
        logger.error(f"Missing dependency: {e}")
        logger.error("Run: pip install -r requirements.txt")
        _fallback_error(str(e))
    except Exception as e:
        logger.error(f"Fatal error: {e}", exc_info=True)
        _shutdown(None, sync, agent_scheduler, email_engine, command_queue, auto_push, heartbeat, db, logger)
        raise


def _initial_load(window, sync, logger, health_results=None):
    """Trigger initial sync and tab refresh after UI is ready."""
    try:
        # Force immediate full sync
        sync.force_sync()
        logger.info("Initial sync triggered")

        # Show health warnings if any critical checks failed
        if health_results:
            _show_health_warnings(window, health_results, logger)

        # Refresh active tab
        window.after(2000, window.refresh_current_tab)
    except Exception as e:
        logger.warning(f"Initial load issue: {e}")


def _ensure_default_agents(db, logger):
    """Seed default blog + newsletter agents if the schedule table is empty.
    
    Schedules:
      - Blog: Every Wednesday at 09:00 (weekly)
      - Newsletter: 1st Monday of each month at 10:00 (monthly)
    
    Both are ENABLED by default so the system runs fully automated.
    Content is saved as Draft and requires Telegram approval to publish.
    """
    try:
        existing = db.get_agent_schedules()
        if existing:
            return  # Already configured
        from app.agents import calculate_next_run
        from datetime import datetime
        defaults = [
            {
                "agent_type": "blog_writer",
                "name": "Weekly Blog Writer",
                "schedule_type": "Weekly",
                "schedule_day": "Wednesday",
                "schedule_time": "09:00",
                "enabled": 1,  # Auto-enabled — drafts need approval
                "next_run": calculate_next_run("Weekly", "Wednesday", "09:00"),
                "config_json": "{}",
            },
            {
                "agent_type": "newsletter_writer",
                "name": "Monthly Newsletter",
                "schedule_type": "Monthly",
                "schedule_day": "Monday",
                "schedule_time": "10:00",
                "enabled": 1,  # Auto-enabled — drafts need approval
                "next_run": calculate_next_run("Monthly", "Monday", "10:00"),
                "config_json": "{}",
            },
            {
                "agent_type": "workflow_optimiser",
                "name": "Weekly Workflow Optimiser",
                "schedule_type": "Weekly",
                "schedule_day": "Friday",
                "schedule_time": "18:00",
                "enabled": 1,  # Auto-enabled — sends Telegram summary
                "next_run": calculate_next_run("Weekly", "Friday", "18:00"),
                "config_json": "{}",
            },
        ]
        for d in defaults:
            db.save_agent_schedule(d)
            logger.info("Seeded default agent: %s (enabled=%s)", d["name"], d["enabled"])
    except Exception as e:
        logger.warning("Could not seed default agents: %s", e)


def _startup_health_check(api, db, logger):
    """Run startup diagnostics. Returns dict of {check_name: (ok, detail)}."""
    results = {}

    # 1. GAS Webhook reachable?
    try:
        ok = api.is_online()
        results["GAS Webhook"] = (ok, "Reachable" if ok else "Unreachable")
    except Exception as e:
        results["GAS Webhook"] = (False, str(e))

    # 2. Stripe API key present?
    from app import config
    stripe_key = getattr(config, "STRIPE_SECRET_KEY", None) or os.environ.get("STRIPE_SECRET_KEY") or os.environ.get("STRIPE_KEY")
    if stripe_key and len(stripe_key) > 10:
        results["Stripe API Key"] = (True, "Configured")
    else:
        results["Stripe API Key"] = (False, "Not configured")

    # 3. Telegram bot responding?
    tg_token = getattr(config, "TG_BOT_TOKEN", None)
    tg_chat = getattr(config, "TG_CHAT_ID", None)
    if tg_token and tg_chat:
        try:
            import urllib.request
            req = urllib.request.Request(
                f"https://api.telegram.org/bot{tg_token}/getMe",
                method="GET",
            )
            with urllib.request.urlopen(req, timeout=5) as resp:
                if resp.status == 200:
                    results["Telegram Bot"] = (True, "Responding")
                else:
                    results["Telegram Bot"] = (False, f"HTTP {resp.status}")
        except Exception as e:
            results["Telegram Bot"] = (False, str(e)[:60])
    else:
        results["Telegram Bot"] = (False, "Token/Chat ID not configured")

    # 4. Database healthy?
    try:
        count = db.execute("SELECT COUNT(*) FROM clients").fetchone()[0]
        results["Database"] = (True, f"Healthy ({count} clients)")
    except Exception as e:
        results["Database"] = (False, str(e)[:60])

    # 5. Last sync timestamp?
    try:
        row = db.execute(
            "SELECT MAX(synced_at) FROM sync_log"
        ).fetchone()
        last_sync = row[0] if row and row[0] else "Never"
        results["Last Sync"] = (True, str(last_sync))
    except Exception:
        results["Last Sync"] = (True, "No sync log table yet")

    # 6. Git status?
    try:
        from app.updater import get_current_version_info, check_for_updates
        info = get_current_version_info()
        commit = info.get("commit", "?")
        has_updates, summary = check_for_updates()
        if has_updates:
            results["Git Status"] = (True, f"{commit} — {summary}")
        else:
            results["Git Status"] = (True, f"{commit} — up to date")
    except Exception as e:
        results["Git Status"] = (True, f"Could not check: {e}")

    # Log all results
    logger.info("─── Startup Health Check ───")
    for name, (ok, detail) in results.items():
        icon = "✅" if ok else "❌"
        logger.info(f"  {icon} {name}: {detail}")
    logger.info("────────────────────────────")

    return results


def _show_health_warnings(window, results, logger):
    """Show a toast notification for any failed health checks."""
    failures = [(name, detail) for name, (ok, detail) in results.items() if not ok]
    if not failures:
        return

    # Store failures on the window so overview can show a banner
    window._health_warnings = failures

    # Show toast for critical failures
    critical = [n for n, _ in failures if n in ("GAS Webhook", "Database")]
    if critical:
        msg = "⚠ Startup issues: " + ", ".join(critical)
        try:
            window.show_toast(msg, duration=8000)
        except Exception:
            logger.warning(msg)


def _shutdown(window, sync, agent_scheduler, email_engine, command_queue, auto_push, heartbeat, db, logger):
    """Graceful shutdown — stop all services, final push, close DB, exit."""
    logger.info("Shutting down...")

    try:
        heartbeat.stop()
        logger.info("Heartbeat service stopped")
    except Exception:
        pass

    try:
        email_engine.stop()
        logger.info("Email automation engine stopped")
    except Exception:
        pass

    try:
        command_queue.stop()
        logger.info("Remote command queue stopped")
    except Exception:
        pass

    try:
        agent_scheduler.stop()
        logger.info("Agent scheduler stopped")
    except Exception:
        pass

    try:
        sync.stop()
        logger.info("Sync engine stopped")
    except Exception:
        pass

    try:
        auto_push.stop()   # does a final git push
        logger.info("Auto-push stopped (final push done)")
    except Exception:
        pass

    try:
        db.close()
        logger.info("Database closed")
    except Exception:
        pass

    if window:
        try:
            window.destroy()
        except Exception:
            pass

    logger.info("GGM Hub shut down cleanly")


def _fallback_error(message: str):
    """Show an error dialog if customtkinter isn't available."""
    try:
        import tkinter as tk
        from tkinter import messagebox
        root = tk.Tk()
        root.withdraw()
        messagebox.showerror(
            "GGM Hub — Missing Dependencies",
            f"A required package is missing:\n\n{message}\n\n"
            "Please run:\n  pip install -r requirements.txt\n\n"
            "Or double-click setup.bat to install everything.",
        )
        root.destroy()
    except Exception:
        print(f"\n❌ FATAL: {message}")
        print("Run: pip install -r requirements.txt")
        input("\nPress Enter to exit...")


if __name__ == "__main__":
    main()
