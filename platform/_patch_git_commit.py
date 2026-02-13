"""Patch field_app.py: Add missing GIT_COMMIT, NODE_ID, NODE_TYPE constants."""
import sys

FILE = r"D:\gardening\platform\field_app.py"

with open(FILE, "r", encoding="utf-8") as f:
    code = f.read()

old = 'APP_NAME = "GGM Field"\nVERSION = "3.0.1"\nBRANCH = "master"\n\n\ndef _load_webhook():'

new = '''APP_NAME = "GGM Field"
VERSION = "3.1.0"
BRANCH = "master"
NODE_ID = "field_laptop"
NODE_TYPE = "laptop"

import subprocess


def _get_git_commit():
    """Get short git commit hash."""
    try:
        result = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            capture_output=True, text=True, timeout=5,
            cwd=str(SCRIPT_DIR)
        )
        return result.stdout.strip() if result.returncode == 0 else "unknown"
    except Exception:
        return "unknown"


GIT_COMMIT = _get_git_commit()


def _load_webhook():'''

if old in code:
    code = code.replace(old, new, 1)
    with open(FILE, "w", encoding="utf-8") as f:
        f.write(code)
    print("PATCHED OK")
else:
    idx = code.find('VERSION = "3.')
    if idx == -1:
        idx = code.find("VERSION")
    print(f"OLD STRING NOT FOUND. Context around VERSION (pos {idx}):")
    print(repr(code[max(0,idx-30):idx+150]))
