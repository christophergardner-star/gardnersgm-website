"""
GGM Hub — Laptop Node
A lightweight companion app for editing and pushing Hub updates
from your laptop to the main PC node via GitHub.

This is a standalone program — just double-click to run.
No dependencies beyond Python's standard library + customtkinter.
"""

import os
import sys
import subprocess
import threading
import tkinter as tk
from tkinter import messagebox, scrolledtext
from pathlib import Path
from datetime import datetime

# ── Configuration ──
REPO_URL = "https://github.com/christophergardner-star/gardnersgm-website.git"
DEFAULT_INSTALL = Path.home() / "GGM-Hub"
BRANCH = "master"


class LaptopNode:
    """Main application for the GGM Hub Laptop Node."""

    def __init__(self):
        self.root = tk.Tk()
        self.root.title("GGM Hub — Laptop Node")
        self.root.geometry("720x600")
        self.root.configure(bg="#1a1a2e")
        self.root.minsize(600, 500)

        # Center on screen
        self.root.update_idletasks()
        x = (self.root.winfo_screenwidth() - 720) // 2
        y = (self.root.winfo_screenheight() - 600) // 2
        self.root.geometry(f"+{x}+{y}")

        self.repo_path = DEFAULT_INSTALL
        self._setup_complete = False

        self._check_prerequisites()
        self._build_ui()
        self._check_existing_install()

    def _check_prerequisites(self):
        """Verify git and python are available."""
        try:
            subprocess.run(["git", "--version"], capture_output=True, timeout=5)
        except (FileNotFoundError, subprocess.TimeoutExpired):
            messagebox.showerror(
                "Git Required",
                "Git is not installed.\n\n"
                "Download from: https://git-scm.com/download/win\n\n"
                "Install it, then restart this program."
            )
            sys.exit(1)

    def _build_ui(self):
        """Build the main UI."""
        # ── Header ──
        header = tk.Frame(self.root, bg="#16213e", pady=16)
        header.pack(fill="x")

        tk.Label(
            header, text="🌿 GGM Hub — Laptop Node",
            font=("Segoe UI", 18, "bold"), fg="#4ecca3", bg="#16213e",
        ).pack()
        tk.Label(
            header, text="Edit Hub code here → Push to update your PC",
            font=("Segoe UI", 11), fg="#a0a0a0", bg="#16213e",
        ).pack(pady=(4, 0))

        # ── Status bar ──
        self._status_frame = tk.Frame(self.root, bg="#0f3460", pady=8)
        self._status_frame.pack(fill="x")

        self._status = tk.Label(
            self._status_frame, text="Checking setup...",
            font=("Segoe UI", 11), fg="#e0e0e0", bg="#0f3460",
            anchor="w", padx=12,
        )
        self._status.pack(fill="x")

        # ── Main content ──
        content = tk.Frame(self.root, bg="#1a1a2e", padx=20, pady=12)
        content.pack(fill="both", expand=True)

        # Path display
        path_frame = tk.Frame(content, bg="#1a1a2e")
        path_frame.pack(fill="x", pady=(0, 10))

        tk.Label(
            path_frame, text="Repository:", font=("Segoe UI", 10),
            fg="#a0a0a0", bg="#1a1a2e",
        ).pack(side="left")

        self._path_label = tk.Label(
            path_frame, text=str(self.repo_path), font=("Consolas", 10),
            fg="#4ecca3", bg="#1a1a2e",
        )
        self._path_label.pack(side="left", padx=(8, 0))

        # ── Buttons ──
        btn_frame = tk.Frame(content, bg="#1a1a2e")
        btn_frame.pack(fill="x", pady=(0, 10))

        btn_style = {
            "font": ("Segoe UI", 11, "bold"),
            "bg": "#4ecca3", "fg": "#1a1a2e",
            "activebackground": "#3da88a", "activeforeground": "#1a1a2e",
            "bd": 0, "padx": 16, "pady": 8, "cursor": "hand2",
        }

        self._btn_setup = tk.Button(
            btn_frame, text="📥  Clone / Setup", command=self._do_setup, **btn_style,
        )
        self._btn_setup.pack(side="left", padx=(0, 8))

        self._btn_pull = tk.Button(
            btn_frame, text="⬇️  Pull Latest", command=self._do_pull, **btn_style,
        )
        self._btn_pull.pack(side="left", padx=(0, 8))

        self._btn_push = tk.Button(
            btn_frame, text="⬆️  Push Update", command=self._do_push,
            font=("Segoe UI", 11, "bold"),
            bg="#e94560", fg="white",
            activebackground="#c73e54", activeforeground="white",
            bd=0, padx=16, pady=8, cursor="hand2",
        )
        self._btn_push.pack(side="left", padx=(0, 8))

        self._btn_open = tk.Button(
            btn_frame, text="📂  Open in Explorer",
            command=self._open_folder,
            font=("Segoe UI", 10),
            bg="#16213e", fg="#e0e0e0",
            activebackground="#0f3460", activeforeground="white",
            bd=0, padx=12, pady=8, cursor="hand2",
        )
        self._btn_open.pack(side="left", padx=(0, 8))

        self._btn_vscode = tk.Button(
            btn_frame, text="📝 Open in VS Code",
            command=self._open_vscode,
            font=("Segoe UI", 10),
            bg="#16213e", fg="#e0e0e0",
            activebackground="#0f3460", activeforeground="white",
            bd=0, padx=12, pady=8, cursor="hand2",
        )
        self._btn_vscode.pack(side="left")

        # ── Commit message ──
        msg_frame = tk.Frame(content, bg="#1a1a2e")
        msg_frame.pack(fill="x", pady=(0, 8))

        tk.Label(
            msg_frame, text="Commit message:",
            font=("Segoe UI", 10), fg="#a0a0a0", bg="#1a1a2e",
        ).pack(side="left")

        self._commit_msg = tk.Entry(
            msg_frame, font=("Segoe UI", 11),
            bg="#16213e", fg="#e0e0e0", insertbackground="#4ecca3",
            bd=0, relief="flat",
        )
        self._commit_msg.pack(side="left", fill="x", expand=True, padx=(8, 0), ipady=6)
        self._commit_msg.insert(0, "Hub update from laptop")

        # ── Log output ──
        tk.Label(
            content, text="Log:", font=("Segoe UI", 10, "bold"),
            fg="#a0a0a0", bg="#1a1a2e", anchor="w",
        ).pack(fill="x", pady=(8, 2))

        self._log = scrolledtext.ScrolledText(
            content, font=("Consolas", 10),
            bg="#0f0f23", fg="#e0e0e0", insertbackground="#4ecca3",
            bd=0, relief="flat", height=14, wrap="word",
        )
        self._log.pack(fill="both", expand=True)
        self._log.configure(state="disabled")

        # ── Changed files panel ──
        self._changes_frame = tk.Frame(content, bg="#1a1a2e")
        self._changes_frame.pack(fill="x", pady=(8, 0))

        self._changes_label = tk.Label(
            self._changes_frame, text="",
            font=("Segoe UI", 10), fg="#a0a0a0", bg="#1a1a2e",
            anchor="w", justify="left",
        )
        self._changes_label.pack(fill="x")

    def _log_msg(self, text, color=None):
        """Append a message to the log widget."""
        self._log.configure(state="normal")
        timestamp = datetime.now().strftime("%H:%M:%S")
        self._log.insert("end", f"[{timestamp}] {text}\n")
        self._log.see("end")
        self._log.configure(state="disabled")

    def _set_status(self, text, color="#e0e0e0"):
        """Update the status bar."""
        self._status.configure(text=text, fg=color)

    def _run_git(self, *args, cwd=None):
        """Run a git command and return (success, output)."""
        cmd = ["git"] + list(args)
        try:
            result = subprocess.run(
                cmd, cwd=cwd or str(self.repo_path),
                capture_output=True, text=True, timeout=60,
            )
            output = (result.stdout + result.stderr).strip()
            return result.returncode == 0, output
        except Exception as e:
            return False, str(e)

    def _check_existing_install(self):
        """Check if the repo is already cloned."""
        if (self.repo_path / ".git").exists():
            self._setup_complete = True
            self._set_status(f"✅ Repository ready at {self.repo_path}", "#4ecca3")
            self._log_msg("Repository found. Ready to edit and push updates.")
            self._btn_setup.configure(state="disabled")
            self._refresh_changes()
        else:
            self._set_status("📥 Click 'Clone / Setup' to get started", "#e94560")
            self._log_msg("No repository found. Click 'Clone / Setup' to begin.")
            self._btn_pull.configure(state="disabled")
            self._btn_push.configure(state="disabled")

    def _refresh_changes(self):
        """Show which files have changed."""
        if not self._setup_complete:
            return

        def check():
            ok, output = self._run_git("status", "--short")
            if ok and output:
                lines = output.strip().split("\n")
                count = len(lines)
                preview = "\n".join(lines[:8])
                if count > 8:
                    preview += f"\n  ... and {count - 8} more"
                self.root.after(0, lambda: self._changes_label.configure(
                    text=f"📝 {count} changed file(s):\n{preview}",
                    fg="#e94560",
                ))
            else:
                self.root.after(0, lambda: self._changes_label.configure(
                    text="✅ No local changes", fg="#4ecca3",
                ))

        threading.Thread(target=check, daemon=True).start()

    def _do_setup(self):
        """Clone the repository."""
        self._set_status("📥 Cloning repository...", "#f0c040")
        self._log_msg(f"Cloning {REPO_URL} to {self.repo_path}...")

        def clone():
            ok, output = self._run_git(
                "clone", REPO_URL, str(self.repo_path),
                cwd=str(Path.home()),
            )
            self.root.after(0, lambda: self._clone_done(ok, output))

        threading.Thread(target=clone, daemon=True).start()

    def _clone_done(self, ok, output):
        if ok:
            self._setup_complete = True
            self._set_status(f"✅ Repository cloned to {self.repo_path}", "#4ecca3")
            self._log_msg("Clone complete!")
            self._log_msg(output)
            self._btn_setup.configure(state="disabled")
            self._btn_pull.configure(state="normal")
            self._btn_push.configure(state="normal")
            self._refresh_changes()
        else:
            self._set_status("❌ Clone failed", "#e94560")
            self._log_msg(f"Error: {output}")

    def _do_pull(self):
        """Pull latest from GitHub."""
        self._set_status("⬇️ Pulling latest...", "#f0c040")
        self._log_msg("Pulling from GitHub...")

        def pull():
            ok, output = self._run_git("pull", "--ff-only", "origin", BRANCH)
            self.root.after(0, lambda: self._pull_done(ok, output))

        threading.Thread(target=pull, daemon=True).start()

    def _pull_done(self, ok, output):
        if ok:
            self._set_status("✅ Up to date", "#4ecca3")
            self._log_msg(output)
        else:
            self._set_status("⚠️ Pull had issues", "#e94560")
            self._log_msg(f"Pull issue: {output}")
        self._refresh_changes()

    def _do_push(self):
        """Stage, commit, and push changes."""
        msg = self._commit_msg.get().strip()
        if not msg:
            msg = "Hub update from laptop"

        self._set_status("⬆️ Pushing update...", "#f0c040")
        self._log_msg(f"Pushing with message: {msg}")

        def push():
            # Stage all
            ok, out = self._run_git("add", "-A")
            if not ok:
                self.root.after(0, lambda: self._push_done(False, f"Stage failed: {out}"))
                return

            # Check if there's anything to commit
            ok, status = self._run_git("status", "--porcelain")
            if ok and not status.strip():
                self.root.after(0, lambda: self._push_done(True, "Nothing to commit — already up to date"))
                return

            # Commit
            ok, out = self._run_git("commit", "-m", msg)
            if not ok:
                self.root.after(0, lambda: self._push_done(False, f"Commit failed: {out}"))
                return

            # Push
            ok, out = self._run_git("push", "origin", BRANCH)
            self.root.after(0, lambda: self._push_done(ok, out))

        threading.Thread(target=push, daemon=True).start()

    def _push_done(self, ok, output):
        if ok:
            self._set_status("✅ Update pushed — PC will auto-update on next Hub launch", "#4ecca3")
            self._log_msg("Push complete!")
            self._log_msg(output)
        else:
            self._set_status("❌ Push failed", "#e94560")
            self._log_msg(f"Error: {output}")
        self._refresh_changes()

    def _open_folder(self):
        """Open the repo folder in Explorer."""
        path = self.repo_path / "platform"
        if path.exists():
            os.startfile(str(path))
        elif self.repo_path.exists():
            os.startfile(str(self.repo_path))
        else:
            messagebox.showinfo("Not Found", "Clone the repository first.")

    def _open_vscode(self):
        """Open in VS Code."""
        path = str(self.repo_path)
        try:
            subprocess.Popen(["code", path], shell=True)
            self._log_msg(f"Opening VS Code: {path}")
        except Exception:
            messagebox.showinfo(
                "VS Code not found",
                "VS Code doesn't appear to be installed.\n"
                "Download from: https://code.visualstudio.com",
            )

    def run(self):
        self.root.mainloop()


if __name__ == "__main__":
    app = LaptopNode()
    app.run()
