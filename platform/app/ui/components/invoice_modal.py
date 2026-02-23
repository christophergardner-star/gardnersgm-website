"""
Invoice Detail Modal — view/edit dialog for invoices.
Includes before/after photo gallery linked by job number.
"""

import customtkinter as ctk
import threading
import webbrowser
import logging
from datetime import date
from pathlib import Path
from .. import theme
from ... import config

_log = logging.getLogger("ggm.invoice_modal")

try:
    from PIL import Image, ImageTk
    HAS_PIL = True
except ImportError:
    HAS_PIL = False

CACHE_DIR = config.DATA_DIR / "photo_cache"
THUMB_SIZE = (160, 120)


class InvoiceModal(ctk.CTkToplevel):
    """Modal window for viewing and editing an invoice."""

    def __init__(self, parent, invoice_data: dict, db, sync,
                 on_save=None, **kwargs):
        super().__init__(parent, **kwargs)

        self.invoice_data = dict(invoice_data)
        self.db = db
        self.sync = sync
        self.on_save = on_save
        self._fields = {}

        is_new = not self.invoice_data.get("id")
        title = "New Invoice" if is_new else f"Invoice: {self.invoice_data.get('invoice_number', '')}"

        self.title(title)
        self.update_idletasks()
        try:
            _, max_h = self.wm_maxsize()
        except Exception:
            max_h = self.winfo_screenheight()
        win_h = min(620, max_h - 60)
        win_h = max(win_h, 400)
        self.geometry(f"560x{win_h}")
        self.resizable(False, True)
        self.configure(fg_color=theme.BG_DARK)
        self.transient(parent)
        self.grab_set()

        self.update_idletasks()
        px = parent.winfo_rootx() + (parent.winfo_width() - 560) // 2
        py = 10
        self.geometry(f"+{max(px,0)}+{max(py,0)}")

        self._build_ui()

    def _build_ui(self):
        # Grid layout: row 0=scrollable content, row 1=separator, row 2=footer
        self.grid_rowconfigure(0, weight=1)
        self.grid_columnconfigure(0, weight=1)

        container = ctk.CTkScrollableFrame(self, fg_color=theme.BG_DARK)
        container.grid(row=0, column=0, sticky="nsew")

        sep = ctk.CTkFrame(self, fg_color=theme.GREEN_PRIMARY, height=2)
        sep.grid(row=1, column=0, sticky="ew")

        self._footer = ctk.CTkFrame(self, fg_color=theme.BG_DARKER)
        self._footer.grid(row=2, column=0, sticky="ew")

        # ── Header ──
        header = ctk.CTkFrame(container, fg_color=theme.BG_CARD, corner_radius=12)
        header.pack(fill="x", padx=16, pady=(16, 8))

        inv_num = self.invoice_data.get("invoice_number", "NEW")
        client = self.invoice_data.get("client_name", "")
        status = self.invoice_data.get("status", "Unpaid")

        h_inner = ctk.CTkFrame(header, fg_color="transparent")
        h_inner.pack(fill="x", padx=16, pady=12)

        ctk.CTkLabel(
            h_inner, text="🧾",
            font=theme.font_bold(28), width=48,
        ).pack(side="left", padx=(0, 12))

        info = ctk.CTkFrame(h_inner, fg_color="transparent")
        info.pack(side="left", fill="x", expand=True)

        ctk.CTkLabel(
            info, text=f"Invoice #{inv_num}" if inv_num != "NEW" else "New Invoice",
            font=theme.font_bold(16), text_color=theme.TEXT_LIGHT, anchor="w",
        ).pack(fill="x")

        ctk.CTkLabel(
            info, text=f"{client} — {status}",
            font=theme.font(12), text_color=theme.TEXT_DIM, anchor="w",
        ).pack(fill="x")

        amount = float(self.invoice_data.get("amount", 0) or 0)
        ctk.CTkLabel(
            h_inner, text=f"£{amount:,.2f}",
            font=theme.font_bold(20),
            text_color=theme.GREEN_LIGHT if status == "Paid" else theme.AMBER,
        ).pack(side="right", padx=8)

        # ── Form ──
        form = ctk.CTkFrame(container, fg_color=theme.BG_CARD, corner_radius=12)
        form.pack(fill="x", padx=16, pady=8)
        form.grid_columnconfigure(1, weight=1)

        fields = [
            ("invoice_number", "Invoice #",   "entry"),
            ("client_name",    "Client Name",  "entry"),
            ("client_email",   "Client Email", "entry"),
            ("amount",         "Amount (£)",   "entry"),
            ("status",         "Status",       "dropdown", config.INVOICE_STATUS_OPTIONS),
            ("issue_date",     "Issue Date",   "entry"),
            ("due_date",       "Due Date",     "entry"),
            ("paid_date",      "Paid Date",    "entry"),
        ]

        for i, field_def in enumerate(fields):
            key = field_def[0]
            label = field_def[1]
            ftype = field_def[2]
            current = str(self.invoice_data.get(key, "") or "")

            ctk.CTkLabel(
                form, text=label,
                font=theme.font(12), text_color=theme.TEXT_DIM,
                anchor="e",
            ).grid(row=i, column=0, padx=(16, 8), pady=4, sticky="e")

            if ftype == "dropdown" and len(field_def) > 3:
                var = ctk.StringVar(value=current)
                ctk.CTkOptionMenu(
                    form, variable=var, values=field_def[3],
                    fg_color=theme.BG_INPUT, button_color=theme.GREEN_ACCENT,
                    button_hover_color=theme.GREEN_DARK,
                    dropdown_fg_color=theme.BG_CARD,
                    corner_radius=8, height=32, font=theme.font(12),
                ).grid(row=i, column=1, padx=(0, 16), pady=4, sticky="ew")
                self._fields[key] = var
            else:
                entry = theme.create_entry(form, width=300)
                entry.insert(0, current)
                entry.grid(row=i, column=1, padx=(0, 16), pady=4, sticky="ew")
                self._fields[key] = entry

        # ── Notes ──
        notes_frame = ctk.CTkFrame(container, fg_color=theme.BG_CARD, corner_radius=12)
        notes_frame.pack(fill="x", padx=16, pady=8)

        ctk.CTkLabel(
            notes_frame, text="Notes",
            font=theme.font_bold(13), text_color=theme.TEXT_LIGHT, anchor="w",
        ).pack(fill="x", padx=16, pady=(12, 4))

        self.notes_box = ctk.CTkTextbox(
            notes_frame, height=70,
            fg_color=theme.BG_INPUT, corner_radius=8, font=theme.font(12),
        )
        self.notes_box.pack(fill="x", padx=16, pady=(0, 12))
        self.notes_box.insert("1.0", self.invoice_data.get("notes", "") or "")

        # ── Photos section (linked by job_number) ──
        self._thumb_refs = []
        self._photos_container = container
        self._build_photos_section(container)

        # ── Actions (fixed footer) ──
        actions = ctk.CTkFrame(self._footer, fg_color="transparent")
        actions.pack(fill="x", padx=16, pady=10)

        theme.create_accent_button(
            actions, "💾 Save Invoice",
            command=self._save, width=130,
        ).pack(side="left", padx=(0, 6))

        if self.invoice_data.get("status") != "Paid":
            theme.create_outline_button(
                actions, "✅ Mark Paid",
                command=self._mark_paid, width=100,
            ).pack(side="left", padx=4)

        theme.create_outline_button(
            actions, "📧 Send",
            command=self._send_invoice_email, width=90,
        ).pack(side="left", padx=4)

        # PDF buttons
        pdf_path = self.invoice_data.get("pdf_path", "")
        if pdf_path and Path(pdf_path).exists():
            theme.create_outline_button(
                actions, "📄 View PDF",
                command=self._view_pdf, width=100,
            ).pack(side="left", padx=4)
        theme.create_outline_button(
            actions, "📄 Save PDF",
            command=self._save_pdf, width=100,
        ).pack(side="left", padx=4)

        # Status feedback label
        self._send_status = ctk.CTkLabel(
            self._footer, text="",
            font=theme.font_bold(12), text_color=theme.TEXT_DIM,
            anchor="w",
        )
        self._send_status.pack(fill="x", padx=16, pady=(0, 6))

        ctk.CTkButton(
            actions, text="Cancel", width=80,
            fg_color=theme.BG_CARD, hover_color=theme.RED,
            corner_radius=8, font=theme.font(12),
            command=self.destroy,
        ).pack(side="right")

        if self.invoice_data.get("id"):
            ctk.CTkButton(
                actions, text="🗑️ Delete", width=90,
                fg_color="#7f1d1d", hover_color=theme.RED,
                text_color="#fca5a5", corner_radius=8,
                font=theme.font(12, "bold"),
                command=self._confirm_delete,
            ).pack(side="right", padx=(0, 8))

    # ------------------------------------------------------------------
    # Photos Section
    # ------------------------------------------------------------------
    def _build_photos_section(self, container):
        """Build the before/after photo gallery for this invoice's job."""
        job_number = self.invoice_data.get("job_number", "")
        client_name = self.invoice_data.get("client_name", "")

        photos_frame = ctk.CTkFrame(container, fg_color=theme.BG_CARD, corner_radius=12)
        photos_frame.pack(fill="x", padx=16, pady=8)

        # Header row
        hdr = ctk.CTkFrame(photos_frame, fg_color="transparent")
        hdr.pack(fill="x", padx=16, pady=(12, 4))

        ctk.CTkLabel(
            hdr, text="📸  Job Photos",
            font=theme.font_bold(13), text_color=theme.TEXT_LIGHT,
            anchor="w",
        ).pack(side="left")

        if job_number:
            ctk.CTkLabel(
                hdr, text=f"#{job_number}",
                font=theme.font(11), text_color=theme.TEXT_DIM,
            ).pack(side="left", padx=(8, 0))

        # Open full PhotoManager button
        theme.create_outline_button(
            hdr, "📸 Manage Photos",
            command=lambda: self._open_photo_manager(job_number, client_name),
            width=130,
        ).pack(side="right")

        # Load photos
        photos = []
        if job_number:
            try:
                photos = self.db.get_all_photos_for_display(
                    job_number=job_number,
                )
            except Exception as e:
                _log.warning("Failed to load invoice photos: %s", e)

        if not photos:
            ctk.CTkLabel(
                photos_frame,
                text="No photos for this job yet.\nSend from mobile app or Telegram.",
                font=theme.font(11), text_color=theme.TEXT_DIM,
                justify="center",
            ).pack(pady=(4, 16))
            return

        befores = [p for p in photos if p.get("photo_type") == "before"]
        afters = [p for p in photos if p.get("photo_type") == "after"]

        # Summary
        ctk.CTkLabel(
            photos_frame,
            text=f"📷 {len(befores)} before  •  ✅ {len(afters)} after",
            font=theme.font(11), text_color=theme.TEXT_DIM,
        ).pack(fill="x", padx=16, pady=(0, 4))

        # Side-by-side columns
        cols = ctk.CTkFrame(photos_frame, fg_color="transparent")
        cols.pack(fill="x", padx=12, pady=(0, 12))
        cols.grid_columnconfigure(0, weight=1)
        cols.grid_columnconfigure(1, weight=1)

        # Before column
        bcol = ctk.CTkFrame(cols, fg_color=theme.BG_INPUT, corner_radius=8)
        bcol.grid(row=0, column=0, sticky="nsew", padx=(0, 4))

        ctk.CTkLabel(
            bcol, text="📷 BEFORE",
            font=theme.font_bold(11), text_color=theme.AMBER,
        ).pack(anchor="w", padx=8, pady=(8, 4))

        if befores:
            for p in befores[:3]:
                self._render_invoice_thumb(bcol, p)
            if len(befores) > 3:
                ctk.CTkLabel(
                    bcol, text=f"+{len(befores) - 3} more",
                    font=theme.font(10), text_color=theme.TEXT_DIM,
                ).pack(pady=(0, 6))
        else:
            ctk.CTkLabel(
                bcol, text="No before photos",
                font=theme.font(10), text_color=theme.TEXT_DIM,
            ).pack(pady=12)

        # After column
        acol = ctk.CTkFrame(cols, fg_color=theme.BG_INPUT, corner_radius=8)
        acol.grid(row=0, column=1, sticky="nsew", padx=(4, 0))

        ctk.CTkLabel(
            acol, text="✅ AFTER",
            font=theme.font_bold(11), text_color=theme.GREEN_LIGHT,
        ).pack(anchor="w", padx=8, pady=(8, 4))

        if afters:
            for p in afters[:3]:
                self._render_invoice_thumb(acol, p)
            if len(afters) > 3:
                ctk.CTkLabel(
                    acol, text=f"+{len(afters) - 3} more",
                    font=theme.font(10), text_color=theme.TEXT_DIM,
                ).pack(pady=(0, 6))
        else:
            ctk.CTkLabel(
                acol, text="No after photos",
                font=theme.font(10), text_color=theme.TEXT_DIM,
            ).pack(pady=12)

    def _render_invoice_thumb(self, parent, photo: dict):
        """Render a single photo thumbnail inside the invoice modal."""
        source = photo.get("source", "local")
        drive_url = photo.get("drive_url", "")
        file_id = photo.get("drive_file_id", "")
        filename = photo.get("filename", "")

        card = ctk.CTkFrame(parent, fg_color=theme.BG_CARD_HOVER, corner_radius=6)
        card.pack(fill="x", padx=6, pady=3)

        CACHE_DIR.mkdir(parents=True, exist_ok=True)

        if source == "drive" and file_id:
            cached = CACHE_DIR / f"{file_id}.jpg"
            if cached.exists() and HAS_PIL:
                try:
                    img = Image.open(str(cached))
                    img.thumbnail(THUMB_SIZE, Image.LANCZOS)
                    tk_img = ImageTk.PhotoImage(img)
                    self._thumb_refs.append(tk_img)
                    lbl = ctk.CTkLabel(card, text="", image=tk_img)
                    lbl.pack(padx=4, pady=4)
                    if drive_url:
                        lbl.bind("<Button-1>", lambda e, u=drive_url: webbrowser.open(u))
                except Exception:
                    self._render_photo_link(card, drive_url, filename)
            elif drive_url:
                self._render_photo_link(card, drive_url, filename)
            else:
                ctk.CTkLabel(
                    card, text=f"📷 {filename}",
                    font=theme.font(10), text_color=theme.TEXT_DIM,
                ).pack(padx=6, pady=4)
        else:
            # Local file
            cid = str(photo.get("client_id", "unknown"))
            job_ref = photo.get("job_number", "") or photo.get("job_date", "")
            filepath = config.PHOTOS_DIR / cid / job_ref / filename
            if not filepath.exists():
                filepath = config.PHOTOS_DIR / cid / filename

            if HAS_PIL and filepath.exists():
                try:
                    img = Image.open(str(filepath))
                    img.thumbnail(THUMB_SIZE, Image.LANCZOS)
                    tk_img = ImageTk.PhotoImage(img)
                    self._thumb_refs.append(tk_img)
                    lbl = ctk.CTkLabel(card, text="", image=tk_img)
                    lbl.pack(padx=4, pady=4)
                    import os
                    lbl.bind("<Button-1>", lambda e, p=str(filepath): os.startfile(p))
                except Exception:
                    ctk.CTkLabel(
                        card, text=f"📷 {filename}",
                        font=theme.font(10), text_color=theme.TEXT_DIM,
                    ).pack(padx=6, pady=4)
            else:
                ctk.CTkLabel(
                    card, text=f"📷 {filename}",
                    font=theme.font(10), text_color=theme.TEXT_DIM,
                ).pack(padx=6, pady=4)

    def _render_photo_link(self, parent, url: str, filename: str):
        """Render a clickable link for a Drive photo."""
        ctk.CTkButton(
            parent, text=f"🔗 {filename or 'View Photo'}",
            width=160, height=24,
            fg_color=theme.BG_INPUT, hover_color="#1976D2",
            corner_radius=4, font=theme.font(10),
            text_color="#42A5F5",
            command=lambda: webbrowser.open(url),
        ).pack(padx=6, pady=4)

    def _open_photo_manager(self, job_number: str, client_name: str):
        """Open the full PhotoManager modal for this job."""
        try:
            from .photo_manager import PhotoManager

            client_id = None
            try:
                client = self.db.fetchone(
                    "SELECT id FROM clients WHERE name = ?", (client_name,)
                )
                if client:
                    client_id = client["id"]
            except Exception:
                pass

            PhotoManager(
                self,
                db=self.db,
                client_id=client_id,
                client_name=client_name,
                job_number=job_number,
            )
        except Exception as e:
            _log.error("Failed to open PhotoManager: %s", e)

    def _save_pdf(self):
        """Generate a PDF invoice and save to disk, then upload to Drive."""
        import threading

        def generate():
            try:
                from ...invoice_pdf import generate_invoice_pdf, upload_pdf_to_drive
                filepath = generate_invoice_pdf(self.invoice_data)
                if filepath:
                    # Store pdf_path in database
                    inv_id = self.invoice_data.get("id")
                    if inv_id:
                        try:
                            self.db.conn.execute(
                                "UPDATE invoices SET pdf_path = ? WHERE id = ?",
                                (filepath, inv_id),
                            )
                            self.db.conn.commit()
                        except Exception:
                            pass
                    self.invoice_data["pdf_path"] = filepath
                    _log.info("PDF saved: %s", filepath)

                    # Upload to Google Drive for cross-node access
                    try:
                        drive_url = upload_pdf_to_drive(filepath, self.invoice_data)
                        if drive_url:
                            _log.info("PDF uploaded to Drive: %s", drive_url)
                    except Exception as e:
                        _log.warning("Drive upload skipped: %s", e)

                    # Open the PDF after saving
                    try:
                        import os as _os
                        _os.startfile(filepath)
                    except Exception:
                        pass
                else:
                    _log.error("PDF generation returned empty path")
            except Exception as e:
                _log.error("PDF generation failed: %s", e)

        threading.Thread(target=generate, daemon=True).start()

    def _view_pdf(self):
        """Open the existing PDF invoice."""
        pdf_path = self.invoice_data.get("pdf_path", "")
        if pdf_path and Path(pdf_path).exists():
            try:
                import os as _os
                _os.startfile(pdf_path)
            except Exception as e:
                _log.error("Failed to open PDF: %s", e)
                webbrowser.open(pdf_path)
        else:
            _log.warning("PDF not found: %s", pdf_path)

    def _confirm_delete(self):
        inv_num = self.invoice_data.get("invoice_number", "this invoice")
        confirm = ctk.CTkToplevel(self)
        confirm.title("Delete Invoice?")
        confirm.geometry("360x160")
        confirm.resizable(False, False)
        confirm.configure(fg_color=theme.BG_DARK)
        confirm.transient(self)
        confirm.grab_set()

        self.update_idletasks()
        cx = self.winfo_rootx() + (self.winfo_width() - 360) // 2
        cy = self.winfo_rooty() + (self.winfo_height() - 160) // 2
        confirm.geometry(f"+{max(cx,0)}+{max(cy,0)}")

        ctk.CTkLabel(
            confirm, text=f"Delete Invoice #{inv_num}?",
            font=theme.font_bold(15), text_color=theme.TEXT_LIGHT,
        ).pack(pady=(20, 4))
        ctk.CTkLabel(
            confirm, text="This will remove the invoice from the Hub and Sheets.",
            font=theme.font(12), text_color=theme.TEXT_DIM,
        ).pack(pady=(0, 16))

        btn_row = ctk.CTkFrame(confirm, fg_color="transparent")
        btn_row.pack(pady=8)

        def do_delete():
            iid = self.invoice_data.get("id")
            row = self.invoice_data.get("sheets_row", "")
            if iid:
                self.db.delete_invoice(iid)
            if row:
                self.sync.queue_write("delete_invoice", {"row": row})
            confirm.destroy()
            if self.on_save:
                self.on_save()
            self.destroy()

        ctk.CTkButton(
            btn_row, text="🗑️ Delete", width=100, height=36,
            fg_color=theme.RED, hover_color="#b91c1c",
            corner_radius=8, font=theme.font(12, "bold"),
            command=do_delete,
        ).pack(side="left", padx=8)

        ctk.CTkButton(
            btn_row, text="Cancel", width=80, height=36,
            fg_color=theme.BG_CARD, hover_color=theme.BG_CARD_HOVER,
            corner_radius=8, font=theme.font(12),
            command=confirm.destroy,
        ).pack(side="left", padx=8)

    def _save(self):
        """Save the invoice data back to SQLite + queue sync."""
        for key, widget in self._fields.items():
            if isinstance(widget, ctk.StringVar):
                self.invoice_data[key] = widget.get()
            elif isinstance(widget, ctk.CTkEntry):
                self.invoice_data[key] = widget.get().strip()

        self.invoice_data["notes"] = self.notes_box.get("1.0", "end").strip()

        try:
            self.invoice_data["amount"] = float(self.invoice_data.get("amount", 0) or 0)
        except (ValueError, TypeError):
            self.invoice_data["amount"] = 0

        self.db.save_invoice(self.invoice_data)

        self.sync.queue_write("update_invoice", {
            "row": self.invoice_data.get("sheets_row", ""),
            "invoiceNumber": self.invoice_data.get("invoice_number", ""),
            "clientName": self.invoice_data.get("client_name", ""),
            "clientEmail": self.invoice_data.get("client_email", ""),
            "amount": self.invoice_data.get("amount", 0),
            "status": self.invoice_data.get("status", ""),
            "issueDate": self.invoice_data.get("issue_date", ""),
            "dueDate": self.invoice_data.get("due_date", ""),
            "paidDate": self.invoice_data.get("paid_date", ""),
            "notes": self.invoice_data.get("notes", ""),
        })

        if self.on_save:
            self.on_save()
        self.destroy()

    def _set_send_status(self, text: str, colour: str = None):
        """Update the send status label (must be called from main thread)."""
        try:
            if hasattr(self, '_send_status') and self._send_status.winfo_exists():
                self._send_status.configure(
                    text=text,
                    text_color=colour or theme.TEXT_DIM,
                )
        except Exception:
            pass

    def _send_invoice_email(self):
        """Send this invoice via email to the client."""
        import threading
        client_email = self.invoice_data.get("client_email", "")
        if not client_email:
            self._set_send_status("❌ No client email — cannot send", theme.RED)
            _log.warning("Cannot send invoice — no client email")
            return

        if not config.ADMIN_API_KEY:
            self._set_send_status("❌ ADMIN_API_KEY not set in .env — cannot send", theme.RED)
            _log.error("Cannot send invoice — ADMIN_API_KEY not configured")
            return

        inv_num = self.invoice_data.get("invoice_number", "")
        amount = float(self.invoice_data.get("amount", 0) or 0)
        client_name = self.invoice_data.get("client_name", "")
        notes = self.invoice_data.get("notes", "")

        self._set_send_status(f"📧 Sending invoice to {client_email}...", theme.AMBER)

        # Build payload matching the GAS sendInvoiceEmail() expected shape
        payload = {
            "invoiceNumber": inv_num,
            "customer": {
                "name": client_name,
                "email": client_email,
            },
            "items": [
                {
                    "description": self.invoice_data.get("service", "") or notes or "Services rendered",
                    "qty": 1,
                    "price": amount,
                }
            ],
            "grandTotal": amount,
            "subtotal": amount,
            "invoiceDate": self.invoice_data.get("issue_date", ""),
            "dueDate": self.invoice_data.get("due_date", ""),
        }

        # Check if a deposit note exists and calculate discount
        if notes:
            import re
            deposit_match = re.search(r'[Dd]eposit\s*[£]?([\d.]+)', notes)
            if deposit_match:
                deposit = float(deposit_match.group(1))
                payload["discountAmt"] = deposit
                payload["discountLabel"] = f"Deposit £{deposit:.2f} already paid"
                payload["grandTotal"] = amount  # amount is already the outstanding balance

        def send():
            try:
                result = self.sync.api.post("send_invoice_email", payload)
                status = result.get("status", "")
                if status == "success":
                    _log.info(f"Invoice {inv_num} sent to {client_email}")
                    def _on_success():
                        self._set_send_status(
                            f"✅ Invoice {inv_num} sent to {client_email}",
                            theme.GREEN_LIGHT,
                        )
                        # Update status to Sent if currently Unpaid/Draft
                        cur_status = self.invoice_data.get("status", "")
                        if cur_status in ("Unpaid", "Draft", ""):
                            self.invoice_data["status"] = "Sent"
                            if "status" in self._fields:
                                self._fields["status"].set("Sent")
                            self.db.save_invoice(self.invoice_data)
                    self.after(0, _on_success)
                else:
                    error_msg = result.get("error", "Unknown error")
                    _log.error(f"Invoice send returned: {result}")
                    self.after(0, lambda: self._set_send_status(
                        f"❌ Send failed: {error_msg}", theme.RED,
                    ))
            except Exception as e:
                _log.error(f"Failed to send invoice {inv_num}: {e}")
                err = str(e)
                self.after(0, lambda: self._set_send_status(
                    f"❌ Send failed: {err}", theme.RED,
                ))

        threading.Thread(target=send, daemon=True).start()

    def _mark_paid(self):
        """Quick-mark as paid with today's date."""
        self.invoice_data["status"] = "Paid"
        self.invoice_data["paid_date"] = date.today().isoformat()

        # Update the status dropdown if visible
        if "status" in self._fields:
            self._fields["status"].set("Paid")
        if "paid_date" in self._fields:
            w = self._fields["paid_date"]
            if isinstance(w, ctk.CTkEntry):
                w.delete(0, "end")
                w.insert(0, date.today().isoformat())

        self._save()
