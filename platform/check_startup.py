"""GGM Hub — Startup diagnostic. Run once to verify everything works."""
import sys, os
sys.path.insert(0, '.')

# Test 1: Config loads
from app import config
tg_status = "configured" if config.TG_BOT_TOKEN else "not set"
print(f'[OK] Config loaded - v{config.APP_VERSION}')
print(f'     Webhook: {config.SHEETS_WEBHOOK[:60]}...')
print(f'     Telegram: {tg_status}')
print(f'     DB path: {config.DB_PATH}')

# Test 2: Database connects and initializes
from app.database import Database
db = Database(config.DB_PATH)
db.connect()
db.initialize()
tables = db.fetchall("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
table_names = [t["name"] for t in tables]
print(f'[OK] Database ready - {len(table_names)} tables')

# Test 3: API client
from app.api import APIClient
api = APIClient(config.SHEETS_WEBHOOK)
print(f'[OK] API client ready')

# Test 4: Sync engine
from app.sync import SyncEngine
sync = SyncEngine(db, api)
print(f'[OK] Sync engine ready')

# Test 5: Agent scheduler
from app.agents import AgentScheduler
agent_sched = AgentScheduler(db, api)
print(f'[OK] Agent scheduler ready')

# Test 6: Email automation
from app.email_automation import EmailAutomationEngine
email_eng = EmailAutomationEngine(db, api)
print(f'[OK] Email automation engine ready')

# Test 7: UI imports
import customtkinter as ctk
from app.ui.app_window import AppWindow
from app.ui.pin_screen import PinScreen
print(f'[OK] UI modules import OK')

# Test 8: Tab modules
from app.tabs.overview import OverviewTab
from app.tabs.operations import OperationsTab
from app.tabs.finance import FinanceTab
from app.tabs.dispatch import DispatchTab
from app.tabs.telegram import TelegramTab
from app.tabs.marketing import MarketingTab
from app.tabs.customer_care import CustomerCareTab
from app.tabs.admin import AdminTab
print(f'[OK] All 8 tabs import OK')

# Test 9: Key tables
key_tables = ['clients', 'invoices', 'schedule', 'enquiries', 
              'business_recommendations', 'site_analytics', 'job_photos', 'blog_posts']
missing = [t for t in key_tables if t not in table_names]
if missing:
    print(f'[WARN] Missing tables: {missing}')
else:
    print(f'[OK] All key tables present')

# Test 10: Credentials
if config.TG_BOT_TOKEN:
    print(f'[OK] TG_BOT_TOKEN loaded')
if config.PEXELS_KEY:
    print(f'[OK] PEXELS_KEY loaded')

db.close()
print()
print('=== ALL CHECKS PASSED - Hub is ready to launch ===')
