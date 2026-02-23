"""
GGM Hub — PDF Invoice Generator
Generates branded PDF invoices using fpdf2.
Saves to E:\\GGM-Invoices on Node 1 (PC Hub), or platform/data/invoices on Node 2.
"""

import json
import logging
import os
from datetime import date, datetime
from pathlib import Path

log = logging.getLogger("ggm.invoice_pdf")

try:
    from fpdf import FPDF
    HAS_FPDF = True
except ImportError:
    HAS_FPDF = False
    FPDF = object  # stub so class definition doesn't crash
    log.warning("fpdf2 not installed — PDF invoice generation unavailable")

from . import config

# ── Brand colours (RGB) ──────────────────────────────────────────
GGM_GREEN       = (45, 106, 79)    # #2d6a4f
GGM_GREEN_LIGHT = (82, 183, 136)   # #52b788
GGM_GREEN_DARK  = (27, 67, 50)     # #1b4332
WHITE           = (255, 255, 255)
LIGHT_GREY      = (245, 245, 245)
MID_GREY        = (180, 180, 180)
DARK_TEXT        = (30, 30, 30)
DIM_TEXT         = (100, 100, 100)

# ── Business details ─────────────────────────────────────────────
COMPANY_NAME = "Gardners Ground Maintenance"
COMPANY_STRAPLINE = "Professional Garden & Landscape Services - Cornwall"
COMPANY_ADDRESS = "Roche, Cornwall PL26 8HN"
COMPANY_PHONE = ""  # Not printed until we have a confirmed business number
COMPANY_EMAIL = "enquiries@gardnersgm.co.uk"
COMPANY_WEB = "www.gardnersgm.co.uk"

# ── Logo path ────────────────────────────────────────────────────
LOGO_PATH = config.APP_DIR.parent / "assets" / "logo.png"


class InvoicePDF(FPDF):
    """Branded GGM invoice PDF."""

    def __init__(self):
        super().__init__(orientation="P", unit="mm", format="A4")
        self.set_auto_page_break(auto=True, margin=25)
        self.set_margins(15, 15, 15)
        self.alias_nb_pages()

    # ── Header (called automatically per page) ───────────────────
    def header(self):
        # Green header bar
        self.set_fill_color(*GGM_GREEN)
        self.rect(0, 0, 210, 42, "F")

        # Logo (if available)
        logo_x = 15
        has_logo = False
        if LOGO_PATH.exists():
            try:
                self.image(str(LOGO_PATH), x=logo_x, y=5, h=32)
                has_logo = True
            except Exception:
                pass

        if not has_logo:
            # Only show text branding when logo is missing
            self.set_font("Helvetica", "B", 16)
            self.set_text_color(*WHITE)
            self.set_xy(15, 10)
            self.cell(0, 8, COMPANY_NAME, ln=False)

            self.set_font("Helvetica", "", 7)
            self.set_xy(15, 19)
            self.cell(0, 5, COMPANY_STRAPLINE, ln=False)

        # Contact info (right side)
        self.set_font("Helvetica", "", 8)
        self.set_xy(120, 10)
        self.cell(0, 4, COMPANY_ADDRESS, ln=True, align="R")
        self.set_x(120)
        self.cell(0, 4, COMPANY_EMAIL, ln=True, align="R")
        self.set_x(120)
        self.cell(0, 4, COMPANY_WEB, ln=True, align="R")
        if COMPANY_PHONE:
            self.set_x(120)
            self.cell(0, 4, COMPANY_PHONE, ln=True, align="R")

        # Thin accent line below header
        self.set_fill_color(*GGM_GREEN_LIGHT)
        self.rect(0, 42, 210, 1.5, "F")
        self.ln(30)

    # ── Footer ────────────────────────────────────────────────────
    def footer(self):
        self.set_y(-20)
        # Thin line
        self.set_draw_color(*MID_GREY)
        self.line(15, self.get_y(), 195, self.get_y())
        self.ln(3)
        self.set_font("Helvetica", "", 7)
        self.set_text_color(*DIM_TEXT)
        self.cell(0, 4, f"{COMPANY_NAME}  |  {COMPANY_ADDRESS}  |  {COMPANY_WEB}", align="C", ln=True)
        self.cell(0, 4, f"Page {self.page_no()}/{{nb}}", align="C")

    # ── Helper: section heading ───────────────────────────────────
    def section_heading(self, text: str):
        self.set_font("Helvetica", "B", 11)
        self.set_text_color(*GGM_GREEN)
        self.cell(0, 8, text, ln=True)
        self.set_draw_color(*GGM_GREEN_LIGHT)
        self.line(self.l_margin, self.get_y(), 195, self.get_y())
        self.ln(3)

    # ── Helper: key-value row ─────────────────────────────────────
    def kv_row(self, label: str, value: str, bold_value: bool = False):
        self.set_font("Helvetica", "", 9)
        self.set_text_color(*DIM_TEXT)
        self.cell(45, 6, label, ln=False)
        self.set_font("Helvetica", "B" if bold_value else "", 9)
        self.set_text_color(*DARK_TEXT)
        self.cell(0, 6, value, ln=True)


def generate_invoice_pdf(invoice_data: dict, save_dir: str = None) -> str:
    """
    Generate a branded PDF invoice and save it to disk.

    Args:
        invoice_data: Dict with invoice fields (from database row or modal).
        save_dir: Override directory. Defaults to config.INVOICE_PDF_DIR.

    Returns:
        Absolute path to the generated PDF file, or "" on failure.
    """
    if not HAS_FPDF:
        log.error("fpdf2 not installed — cannot generate PDF")
        return ""

    inv_num = invoice_data.get("invoice_number", "DRAFT")
    client_name = invoice_data.get("client_name", "")
    client_email = invoice_data.get("client_email", "")
    amount = float(invoice_data.get("amount", 0) or 0)
    status = invoice_data.get("status", "Unpaid")
    issue_date = invoice_data.get("issue_date", "") or date.today().isoformat()
    due_date = invoice_data.get("due_date", "")
    paid_date = invoice_data.get("paid_date", "")
    payment_method = invoice_data.get("payment_method", "")
    payment_url = invoice_data.get("payment_url", "")
    notes = invoice_data.get("notes", "")
    items_raw = invoice_data.get("items", "[]")
    job_number = invoice_data.get("job_number", "")

    # VAT fields
    subtotal = float(invoice_data.get("subtotal", 0) or 0)
    vat_rate = float(invoice_data.get("vat_rate", 0) or 0)
    vat_amount = float(invoice_data.get("vat_amount", 0) or 0)

    # Parse line items
    line_items = []
    if isinstance(items_raw, str):
        try:
            line_items = json.loads(items_raw) if items_raw else []
        except (json.JSONDecodeError, TypeError):
            line_items = []
    elif isinstance(items_raw, list):
        line_items = items_raw

    # ── Build PDF ─────────────────────────────────────────────────
    pdf = InvoicePDF()
    pdf.add_page()

    # ── INVOICE title + number ────────────────────────────────────
    pdf.set_font("Helvetica", "B", 22)
    pdf.set_text_color(*DARK_TEXT)
    pdf.cell(100, 12, "INVOICE", ln=False)

    # Invoice # (right-aligned, green)
    pdf.set_font("Helvetica", "B", 14)
    pdf.set_text_color(*GGM_GREEN)
    pdf.cell(0, 12, f"#{inv_num}", ln=True, align="R")
    pdf.ln(4)

    # ── Invoice details (left) + Client details (right) ──────────
    y_start = pdf.get_y()

    # Left column — invoice metadata
    pdf.section_heading("Invoice Details")
    pdf.kv_row("Invoice Number:", inv_num, bold_value=True)
    if job_number:
        pdf.kv_row("Job Number:", job_number)
    pdf.kv_row("Issue Date:", _format_date(issue_date))
    if due_date:
        pdf.kv_row("Due Date:", _format_date(due_date))
    pdf.kv_row("Status:", status, bold_value=True)
    if paid_date:
        pdf.kv_row("Paid Date:", _format_date(paid_date))
    if payment_method:
        pdf.kv_row("Payment Method:", payment_method)

    y_after_left = pdf.get_y()

    # Right column — client details
    pdf.set_xy(115, y_start)
    pdf.set_font("Helvetica", "B", 11)
    pdf.set_text_color(*GGM_GREEN)
    pdf.cell(0, 8, "Bill To", ln=True)
    pdf.set_draw_color(*GGM_GREEN_LIGHT)
    pdf.line(115, pdf.get_y(), 195, pdf.get_y())
    pdf.ln(3)

    pdf.set_x(115)
    pdf.set_font("Helvetica", "B", 10)
    pdf.set_text_color(*DARK_TEXT)
    pdf.cell(0, 6, client_name, ln=True)

    if client_email:
        pdf.set_x(115)
        pdf.set_font("Helvetica", "", 9)
        pdf.set_text_color(*DIM_TEXT)
        pdf.cell(0, 5, client_email, ln=True)

    # Move below whichever column is taller
    pdf.set_y(max(y_after_left, pdf.get_y()) + 8)

    # ── Line items table ──────────────────────────────────────────
    if line_items:
        pdf.section_heading("Items")

        # Table header
        col_widths = [85, 20, 30, 30]  # description, qty, unit price, total
        headers = ["Description", "Qty", "Unit Price", "Total"]

        pdf.set_font("Helvetica", "B", 9)
        pdf.set_fill_color(*GGM_GREEN)
        pdf.set_text_color(*WHITE)
        for i, (header, w) in enumerate(zip(headers, col_widths)):
            align = "L" if i == 0 else "R"
            pdf.cell(w, 7, header, border=0, fill=True, align=align)
        pdf.ln()

        # Table rows
        pdf.set_text_color(*DARK_TEXT)
        for idx, item in enumerate(line_items):
            bg = LIGHT_GREY if idx % 2 == 0 else WHITE
            pdf.set_fill_color(*bg)

            desc = str(item.get("description", item.get("service", "")))
            qty = float(item.get("quantity", item.get("qty", 1)) or 1)
            unit = float(item.get("unit_price", item.get("unitPrice", item.get("price", 0))) or 0)
            line_total = float(item.get("total", qty * unit) or (qty * unit))

            pdf.set_font("Helvetica", "", 9)
            pdf.cell(col_widths[0], 6, desc[:55], border=0, fill=True)
            pdf.cell(col_widths[1], 6, f"{qty:g}", border=0, fill=True, align="R")
            pdf.cell(col_widths[2], 6, f"\u00a3{unit:,.2f}", border=0, fill=True, align="R")
            pdf.set_font("Helvetica", "B", 9)
            pdf.cell(col_widths[3], 6, f"\u00a3{line_total:,.2f}", border=0, fill=True, align="R")
            pdf.ln()

        pdf.ln(2)

    # ── Totals box ────────────────────────────────────────────────
    totals_x = 115
    pdf.set_x(totals_x)

    # Subtotal
    if subtotal > 0:
        pdf.set_font("Helvetica", "", 9)
        pdf.set_text_color(*DIM_TEXT)
        pdf.cell(45, 6, "Subtotal:", align="R")
        pdf.set_text_color(*DARK_TEXT)
        pdf.cell(30, 6, f"\u00a3{subtotal:,.2f}", align="R", ln=True)
        pdf.set_x(totals_x)

    # VAT
    if vat_amount > 0:
        pdf.set_font("Helvetica", "", 9)
        pdf.set_text_color(*DIM_TEXT)
        pdf.cell(45, 6, f"VAT ({vat_rate:g}%):", align="R")
        pdf.set_text_color(*DARK_TEXT)
        pdf.cell(30, 6, f"\u00a3{vat_amount:,.2f}", align="R", ln=True)
        pdf.set_x(totals_x)

    # Total (bold, green background)
    pdf.set_fill_color(*GGM_GREEN)
    pdf.set_font("Helvetica", "B", 12)
    pdf.set_text_color(*WHITE)
    pdf.cell(45, 9, "TOTAL:", align="R", fill=True)
    pdf.cell(30, 9, f"\u00a3{amount:,.2f}", align="R", fill=True, ln=True)
    pdf.ln(4)

    # Status badge
    pdf.set_x(totals_x)
    if status == "Paid":
        pdf.set_fill_color(39, 174, 96)
        badge_text = "PAID"
    elif status == "Overdue":
        pdf.set_fill_color(231, 76, 60)
        badge_text = "OVERDUE"
    elif status == "Void":
        pdf.set_fill_color(149, 165, 166)
        badge_text = "VOID"
    else:
        pdf.set_fill_color(243, 156, 18)
        badge_text = "UNPAID"

    pdf.set_font("Helvetica", "B", 10)
    pdf.set_text_color(*WHITE)
    badge_w = pdf.get_string_width(badge_text) + 16
    pdf.cell(badge_w, 8, f"  {badge_text}  ", fill=True, align="C", ln=True)
    pdf.ln(6)

    # ── Payment link ──────────────────────────────────────────────
    if payment_url and status not in ("Paid", "Void"):
        pdf.set_x(15)
        pdf.section_heading("Payment")
        pdf.set_font("Helvetica", "", 9)
        pdf.set_text_color(*DIM_TEXT)
        pdf.cell(0, 5, "Pay online securely via Stripe:", ln=True)
        pdf.set_font("Helvetica", "U", 9)
        pdf.set_text_color(25, 118, 210)
        # Truncate long URLs for display
        display_url = payment_url if len(payment_url) < 80 else payment_url[:77] + "..."
        pdf.cell(0, 5, display_url, link=payment_url, ln=True)
        pdf.ln(4)

    # ── Notes ─────────────────────────────────────────────────────
    if notes:
        pdf.set_x(15)
        pdf.section_heading("Notes")
        pdf.set_font("Helvetica", "", 9)
        pdf.set_text_color(*DARK_TEXT)
        pdf.multi_cell(0, 5, notes)
        pdf.ln(4)

    # ── Thank you ─────────────────────────────────────────────────
    pdf.ln(6)
    pdf.set_font("Helvetica", "I", 10)
    pdf.set_text_color(*GGM_GREEN)
    pdf.cell(0, 6, "Thank you for choosing Gardners Ground Maintenance!", align="C", ln=True)
    pdf.set_font("Helvetica", "", 8)
    pdf.set_text_color(*DIM_TEXT)
    pdf.cell(0, 5, "We appreciate your business and look forward to keeping your garden beautiful.", align="C")

    # ── Save ──────────────────────────────────────────────────────
    if save_dir is None:
        save_dir = str(config.INVOICE_PDF_DIR)

    save_path = Path(save_dir)
    save_path.mkdir(parents=True, exist_ok=True)

    # Filename: INV-0042.pdf or DRAFT-2025-01-15.pdf
    if inv_num and inv_num != "DRAFT":
        filename = f"{inv_num}.pdf"
    else:
        filename = f"DRAFT-{issue_date}.pdf"

    filepath = save_path / filename

    try:
        pdf.output(str(filepath))
        log.info(f"PDF invoice saved: {filepath}")
        return str(filepath)
    except Exception as e:
        log.error(f"Failed to save PDF invoice: {e}")
        return ""


def _format_date(d: str) -> str:
    """Format ISO date to human-readable UK format."""
    if not d:
        return ""
    try:
        dt = datetime.fromisoformat(d)
        return dt.strftime("%d %B %Y")
    except (ValueError, TypeError):
        return d


def upload_pdf_to_drive(filepath: str, invoice_data: dict) -> str:
    """
    Upload a PDF invoice to Google Drive via GAS webhook.
    Returns the Drive URL on success, or "" on failure.
    """
    import base64
    import json as _json
    import urllib.request

    try:
        with open(filepath, "rb") as f:
            pdf_bytes = f.read()
        b64 = base64.b64encode(pdf_bytes).decode("ascii")

        payload = _json.dumps({
            "action": "upload_invoice_pdf",
            "invoiceNumber": invoice_data.get("invoice_number", "DRAFT"),
            "clientName": invoice_data.get("client_name", ""),
            "pdfBase64": b64,
            "adminToken": config.ADMIN_API_KEY,
        })

        req = urllib.request.Request(
            config.SHEETS_WEBHOOK,
            data=payload.encode("utf-8"),
            headers={"Content-Type": "text/plain"},
        )
        resp = urllib.request.urlopen(req, timeout=30)
        result = _json.loads(resp.read().decode("utf-8"))

        if result.get("status") == "ok":
            drive_url = result.get("driveUrl", "")
            log.info("PDF uploaded to Drive: %s", drive_url)
            return drive_url
        else:
            log.error("Drive upload failed: %s", result.get("message", ""))
            return ""
    except Exception as e:
        log.error("Drive upload error: %s", e)
        return ""
