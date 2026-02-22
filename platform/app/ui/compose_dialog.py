"""
Compose Email Dialog — Send personal emails via SMTP (enquiries@gardnersgm.co.uk).
Uses Fasthosts SMTP (smtp.livemail.co.uk:465 SSL) for direct sending,
separate from the Brevo automated email pipeline.
"""

import customtkinter as ctk
import smtplib
import threading
import logging
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.utils import formataddr, formatdate

from ..ui import theme
from .. import config

log = logging.getLogger("ggm.compose")


class ComposeDialog(ctk.CTkToplevel):
    """Modal compose email dialog."""

    def __init__(self, parent, db=None, app_window=None,
                 reply_to_email: dict = None, **kwargs):
        super().__init__(parent, **kwargs)

        self.db = db
        self.app = app_window
        self._sending = False

        # Window setup
        self.title("Compose Email")
        self.geometry("680x620")
        self.minsize(500, 450)
        self.configure(fg_color=theme.BG_DARK)
        self.transient(parent.winfo_toplevel())
        self.grab_set()

        # Centre on screen
        self.update_idletasks()
        x = (self.winfo_screenwidth() // 2) - 340
        y = (self.winfo_screenheight() // 2) - 310
        self.geometry(f"+{x}+{y}")

        self._build_ui()

        # Pre-fill if replying
        if reply_to_email:
            self._prefill_reply(reply_to_email)

        self.after(100, lambda: self._to_entry.focus_set())

    def _build_ui(self):
        # From label
        from_frame = ctk.CTkFrame(self, fg_color=theme.BG_DARKER, height=40)
        from_frame.pack(fill="x", padx=0, pady=0)
        from_email = config.SMTP_USER or config.IMAP_USER or "enquiries@gardnersgm.co.uk"

        ctk.CTkLabel(
            from_frame, text=f"  From:  {from_email}",
            font=theme.font(12), text_color=theme.TEXT_DIM, anchor="w",
        ).pack(fill="x", padx=12, pady=8)

        # To field
        to_frame = ctk.CTkFrame(self, fg_color="transparent", height=38)
        to_frame.pack(fill="x", padx=12, pady=(8, 2))
        to_frame.grid_columnconfigure(1, weight=1)

        ctk.CTkLabel(
            to_frame, text="To:", font=theme.font(12),
            text_color=theme.TEXT_DIM, width=50,
        ).grid(row=0, column=0, sticky="w")

        self._to_entry = ctk.CTkEntry(
            to_frame, font=theme.font(12), height=32,
            fg_color=theme.BG_CARD, border_color=theme.BG_CARD_HOVER,
            placeholder_text="recipient@example.com",
        )
        self._to_entry.grid(row=0, column=1, sticky="ew", padx=(4, 0))

        # Subject field
        subj_frame = ctk.CTkFrame(self, fg_color="transparent", height=38)
        subj_frame.pack(fill="x", padx=12, pady=2)
        subj_frame.grid_columnconfigure(1, weight=1)

        ctk.CTkLabel(
            subj_frame, text="Subject:", font=theme.font(12),
            text_color=theme.TEXT_DIM, width=50,
        ).grid(row=0, column=0, sticky="w")

        self._subject_entry = ctk.CTkEntry(
            subj_frame, font=theme.font(12), height=32,
            fg_color=theme.BG_CARD, border_color=theme.BG_CARD_HOVER,
            placeholder_text="Email subject",
        )
        self._subject_entry.grid(row=0, column=1, sticky="ew", padx=(4, 0))

        # Separator
        ctk.CTkFrame(self, fg_color=theme.BG_CARD_HOVER, height=1).pack(fill="x", padx=12, pady=6)

        # Body (textbox)
        self._body_text = ctk.CTkTextbox(
            self, font=theme.font(12), height=320,
            fg_color=theme.BG_CARD, text_color=theme.TEXT_LIGHT,
            border_color=theme.BG_CARD_HOVER, border_width=1,
            corner_radius=6, wrap="word",
        )
        self._body_text.pack(fill="both", expand=True, padx=12, pady=(0, 8))

        # Signature
        sig = (
            "\n\n--\n"
            "Chris Gardner\n"
            "Gardners Ground Maintenance\n"
            "01726 432051\n"
            "enquiries@gardnersgm.co.uk\n"
            "www.gardnersgm.co.uk"
        )
        self._body_text.insert("end", sig)
        self._body_text.mark_set("insert", "1.0")

        # Bottom bar
        bottom = ctk.CTkFrame(self, fg_color=theme.BG_DARKER, height=50)
        bottom.pack(fill="x", padx=0, pady=0)

        self._status_label = ctk.CTkLabel(
            bottom, text="", font=theme.font(11),
            text_color=theme.TEXT_DIM,
        )
        self._status_label.pack(side="left", padx=16)

        # Cancel button
        ctk.CTkButton(
            bottom, text="Cancel", font=theme.font(12),
            fg_color="transparent", hover_color=theme.BG_CARD_HOVER,
            text_color=theme.TEXT_DIM, height=34, width=80,
            corner_radius=6, command=self.destroy,
        ).pack(side="right", padx=(0, 8), pady=8)

        # Send button
        self._send_btn = ctk.CTkButton(
            bottom, text="  ✉  Send  ", font=theme.font(13, "bold"),
            fg_color=theme.GREEN_PRIMARY, hover_color="#3a7d5f",
            height=36, corner_radius=6,
            command=self._send_email,
        )
        self._send_btn.pack(side="right", padx=(0, 4), pady=8)

    def _prefill_reply(self, em: dict):
        """Pre-fill fields for replying to an email."""
        from_email = em.get("from_email", "")
        subject = em.get("subject", "")

        self._to_entry.insert(0, from_email)

        if not subject.lower().startswith("re:"):
            subject = f"Re: {subject}"
        self._subject_entry.insert(0, subject)

        # Quote original
        date_str = em.get("date_received", "")
        from_name = em.get("from_name", from_email)
        body = em.get("body_text", "").strip()
        if not body:
            import re
            html = em.get("body_html", "")
            body = re.sub(r"<[^>]+>", " ", html)
            body = re.sub(r"\s+", " ", body).strip()

        quoted = "\n".join(f"> {line}" for line in body.splitlines()[:50])
        quote_header = f"\n\nOn {date_str}, {from_name} wrote:\n{quoted}"

        # Insert quoted text before signature
        current = self._body_text.get("1.0", "end").strip()
        sig_idx = current.find("\n--\n")
        if sig_idx >= 0:
            before_sig = current[:sig_idx]
            sig_part = current[sig_idx:]
            self._body_text.delete("1.0", "end")
            self._body_text.insert("1.0", before_sig + quote_header + sig_part)
        else:
            self._body_text.insert("1.0", quote_header + "\n\n")

        self._body_text.mark_set("insert", "1.0")

    def _send_email(self):
        """Send the email via SMTP."""
        if self._sending:
            return

        to_addr = self._to_entry.get().strip()
        subject = self._subject_entry.get().strip()
        body = self._body_text.get("1.0", "end").strip()

        # Validation
        if not to_addr or "@" not in to_addr:
            self._status_label.configure(text="Enter a valid email address", text_color=theme.RED)
            return
        if not subject:
            self._status_label.configure(text="Enter a subject", text_color=theme.RED)
            return
        if not body:
            self._status_label.configure(text="Enter a message", text_color=theme.RED)
            return

        # Check SMTP config
        smtp_host = config.SMTP_HOST
        smtp_user = config.SMTP_USER or config.IMAP_USER
        smtp_pass = config.SMTP_PASSWORD or config.IMAP_PASSWORD

        if not smtp_host or not smtp_user or not smtp_pass:
            self._status_label.configure(
                text="SMTP not configured — set SMTP_HOST in .env",
                text_color=theme.RED,
            )
            return

        self._sending = True
        self._send_btn.configure(text="Sending...", state="disabled")
        self._status_label.configure(text="Connecting to mail server...", text_color=theme.TEXT_DIM)

        def do_send():
            try:
                msg = MIMEMultipart("alternative")
                msg["From"] = formataddr(("Gardners Ground Maintenance", smtp_user))
                msg["To"] = to_addr
                msg["Subject"] = subject
                msg["Date"] = formatdate(localtime=True)
                msg["Reply-To"] = smtp_user

                # Plain text body
                msg.attach(MIMEText(body, "plain", "utf-8"))

                # Send via SMTP SSL
                with smtplib.SMTP_SSL(smtp_host, config.SMTP_PORT, timeout=30) as server:
                    server.login(smtp_user, smtp_pass)
                    server.send_message(msg)

                log.info(f"Email sent to {to_addr}: {subject}")
                self.after(0, lambda: self._on_send_success(to_addr))

            except smtplib.SMTPAuthenticationError:
                log.error(f"SMTP auth failed for {smtp_user}")
                self.after(0, lambda: self._on_send_error("Authentication failed — check SMTP password"))
            except smtplib.SMTPException as e:
                log.error(f"SMTP error sending to {to_addr}: {e}")
                self.after(0, lambda: self._on_send_error(f"SMTP error: {e}"))
            except Exception as e:
                log.error(f"Failed to send to {to_addr}: {e}")
                self.after(0, lambda: self._on_send_error(str(e)))

        threading.Thread(target=do_send, daemon=True).start()

    def _on_send_success(self, to_addr: str):
        self._sending = False
        if self.app and hasattr(self.app, "toast") and self.app.toast:
            self.app.toast.show(f"Email sent to {to_addr}", "success")
        self.destroy()

    def _on_send_error(self, error: str):
        self._sending = False
        self._send_btn.configure(text="  ✉  Send  ", state="normal")
        self._status_label.configure(text=error, text_color=theme.RED)
