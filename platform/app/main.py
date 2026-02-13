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
    agent_scheduler.start()
    logger.info("Agent scheduler started")

    # ── Start email automation engine ──
    from app.email_automation import EmailAutomationEngine
    email_engine = EmailAutomationEngine(db, api)
    email_engine.start()
    logger.info("Email automation engine started")

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
            window.after(500, lambda: _initial_load(window, sync, logger))

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


def _initial_load(window, sync, logger):
    """Trigger initial sync and tab refresh after UI is ready."""
    try:
        # Force immediate full sync
        sync.force_sync()
        logger.info("Initial sync triggered")

        # Refresh active tab
        window.after(2000, window.refresh_current_tab)
    except Exception as e:
        logger.warning(f"Initial load issue: {e}")


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
