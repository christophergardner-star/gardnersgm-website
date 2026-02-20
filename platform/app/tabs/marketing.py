"""
Marketing Tab — Newsletter, Blog Management, Social Media, Testimonials.
Full content & marketing hub for Gardners Ground Maintenance.
"""

import customtkinter as ctk
import logging
import threading
import json
from datetime import datetime

from ..ui import theme
from ..ui.components.kpi_card import KPICard
from ..ui.components.data_table import DataTable
from .. import config
from .. import llm

log = logging.getLogger("ggm.marketing")


class MarketingTab(ctk.CTkFrame):
    """Marketing hub with newsletter, blog management, social media, and testimonials."""

    def __init__(self, parent, db, sync, api, app_window, **kwargs):
        super().__init__(parent, fg_color=theme.BG_DARK, **kwargs)

        self.db = db
        self.sync = sync
        self.api = api
        self.app = app_window

        self._current_sub = None
        self._sub_buttons = {}
        self._sub_frames = {}
        self._kpi_cards = {}

        self.grid_columnconfigure(0, weight=1)
        self.grid_rowconfigure(1, weight=1)

        self._build_sub_tabs()
        self._build_panels()
        self._switch_sub("newsletter")

    # ------------------------------------------------------------------
    # Sub-Tabs
    # ------------------------------------------------------------------
    def _build_sub_tabs(self):
        tab_bar = ctk.CTkFrame(self, fg_color=theme.BG_CARD, height=44, corner_radius=0)
        tab_bar.grid(row=0, column=0, sticky="ew")
        tab_bar.grid_columnconfigure(10, weight=1)

        tabs = [
            ("newsletter", "📨 Newsletter"),
            ("blog",       "📝 Blog"),
            ("social",     "📱 Social Media"),
            ("testimonials", "⭐ Testimonials"),
            ("discounts",  "🏷️ Discount Codes"),
        ]

        for i, (key, text) in enumerate(tabs):
            btn = ctk.CTkButton(
                tab_bar, text=text, font=theme.font(13),
                fg_color="transparent", hover_color=theme.BG_CARD_HOVER,
                text_color=theme.TEXT_DIM, corner_radius=0,
                height=40, width=160,
                command=lambda k=key: self._switch_sub(k),
            )
            btn.grid(row=0, column=i, padx=1)
            self._sub_buttons[key] = btn

    def _switch_sub(self, key: str):
        if self._current_sub == key:
            return
        for k, btn in self._sub_buttons.items():
            if k == key:
                btn.configure(fg_color=theme.GREEN_PRIMARY, text_color=theme.TEXT_LIGHT)
            else:
                btn.configure(fg_color="transparent", text_color=theme.TEXT_DIM)
        for k, frame in self._sub_frames.items():
            if k == key:
                frame.grid(row=1, column=0, sticky="nsew")
            else:
                frame.grid_forget()
        self._current_sub = key
        self._refresh_subtab(key)

    def _build_panels(self):
        self._build_newsletter_panel()
        self._build_blog_panel()
        self._build_social_panel()
        self._build_testimonials_panel()
        self._build_discounts_panel()

    # ------------------------------------------------------------------
    # Newsletter Panel
    # ------------------------------------------------------------------
    def _build_newsletter_panel(self):
        frame = ctk.CTkScrollableFrame(self, fg_color="transparent")
        self._sub_frames["newsletter"] = frame

        # Subscriber Stats
        stats_frame = ctk.CTkFrame(frame, fg_color="transparent")
        stats_frame.pack(fill="x", padx=16, pady=(16, 8))
        for i in range(5):
            stats_frame.grid_columnconfigure(i, weight=1)

        stat_kpis = [
            ("nl_total",  "📊", "0", "Total"),
            ("nl_active", "✅", "0", "Active"),
            ("nl_paid",   "💎", "0", "Paid"),
            ("nl_free",   "🆓", "0", "Free"),
            ("nl_unsub",  "❌", "0", "Unsubscribed"),
        ]
        for i, (key, icon, default, label) in enumerate(stat_kpis):
            card = KPICard(stats_frame, icon=icon, value=default, label=label)
            card.grid(row=0, column=i, padx=6, pady=4, sticky="nsew")
            self._kpi_cards[key] = card

        # Compose card
        compose_card = ctk.CTkFrame(frame, fg_color=theme.BG_CARD, corner_radius=12)
        compose_card.pack(fill="x", padx=16, pady=(8, 8))

        ctk.CTkLabel(
            compose_card, text="✍️ Compose Newsletter",
            font=theme.font_bold(16), text_color=theme.TEXT_LIGHT, anchor="w",
        ).pack(fill="x", padx=16, pady=(16, 8))

        # Subject
        ctk.CTkLabel(
            compose_card, text="Subject", font=theme.font(12),
            text_color=theme.TEXT_DIM, anchor="w",
        ).pack(fill="x", padx=16, pady=(8, 2))

        self._nl_subject = theme.create_entry(compose_card, placeholder="Newsletter subject line...")
        self._nl_subject.pack(fill="x", padx=16, pady=(0, 8))

        # Target audience
        target_frame = ctk.CTkFrame(compose_card, fg_color="transparent")
        target_frame.pack(fill="x", padx=16, pady=(0, 8))

        ctk.CTkLabel(
            target_frame, text="Target:", font=theme.font(12),
            text_color=theme.TEXT_DIM,
        ).pack(side="left", padx=(0, 8))

        self._nl_target = ctk.CTkComboBox(
            target_frame, values=config.NEWSLETTER_TARGETS,
            width=140, font=theme.font(12),
        )
        self._nl_target.set("All")
        self._nl_target.pack(side="left", padx=(0, 16))

        ctk.CTkLabel(
            target_frame, text="Template:", font=theme.font(12),
            text_color=theme.TEXT_DIM,
        ).pack(side="left", padx=(0, 8))

        self._nl_template = ctk.CTkComboBox(
            target_frame, values=["Custom"] + config.NEWSLETTER_TEMPLATES,
            width=160, font=theme.font(12),
            command=self._apply_template,
        )
        self._nl_template.set("Custom")
        self._nl_template.pack(side="left")

        # Body
        ctk.CTkLabel(
            compose_card, text="Content", font=theme.font(12),
            text_color=theme.TEXT_DIM, anchor="w",
        ).pack(fill="x", padx=16, pady=(0, 2))

        self._nl_body = ctk.CTkTextbox(
            compose_card, height=200,
            fg_color=theme.BG_INPUT, font=theme.font(13),
            text_color=theme.TEXT_LIGHT, corner_radius=8,
        )
        self._nl_body.pack(fill="x", padx=16, pady=(0, 8))

        # Actions
        action_row = ctk.CTkFrame(compose_card, fg_color="transparent")
        action_row.pack(fill="x", padx=16, pady=(0, 16))

        theme.create_accent_button(
            action_row, "📤 Send Newsletter",
            command=self._send_newsletter, width=160,
        ).pack(side="left", padx=(0, 8))

        theme.create_outline_button(
            action_row, "👁️ Preview",
            command=self._preview_newsletter, width=100,
        ).pack(side="left", padx=(0, 8))

        theme.create_outline_button(
            action_row, "🤖 AI Generate",
            command=self._ai_generate_newsletter, width=130,
        ).pack(side="left", padx=(0, 8))

        self._nl_status = ctk.CTkLabel(
            action_row, text="", font=theme.font(12),
            text_color=theme.TEXT_DIM,
        )
        self._nl_status.pack(side="left", padx=16)

        # History
        history_card = ctk.CTkFrame(frame, fg_color=theme.BG_CARD, corner_radius=12)
        history_card.pack(fill="x", padx=16, pady=(8, 16))

        ctk.CTkLabel(
            history_card, text="📜 Send History",
            font=theme.font_bold(15), text_color=theme.TEXT_LIGHT, anchor="w",
        ).pack(fill="x", padx=16, pady=(14, 8))

        self._nl_history_container = ctk.CTkFrame(history_card, fg_color="transparent")
        self._nl_history_container.pack(fill="x", padx=16, pady=(0, 14))

    def _apply_template(self, template_name: str):
        if template_name == "Custom":
            return
        templates = {
            "Seasonal Tips": (
                "🌿 Seasonal Garden Tips\n\n"
                "Hi there,\n\n"
                "Here are this month's top gardening tips for Cornwall:\n\n"
                "1. \n2. \n3. \n\n"
                "Happy gardening!\n"
                "Chris — Gardners Ground Maintenance"
            ),
            "Promotion": (
                "🎉 Special Offer\n\n"
                "Hi there,\n\n"
                "We're running a special offer this month:\n\n"
                "[Details here]\n\n"
                "Book now to take advantage!\n"
                "Chris — Gardners Ground Maintenance"
            ),
            "Company Update": (
                "📢 Company Update\n\n"
                "Hi there,\n\n"
                "Quick update from Gardners Ground Maintenance:\n\n"
                "[Update here]\n\n"
                "Thanks for your continued support!\n"
                "Chris"
            ),
            "Garden Guide": (
                "🌱 Garden Guide\n\n"
                "Hi there,\n\n"
                "This month's garden guide covers:\n\n"
                "[Guide content]\n\n"
                "Need help? Get in touch!\n"
                "Chris — Gardners Ground Maintenance"
            ),
        }
        content = templates.get(template_name, "")
        self._nl_body.delete("1.0", "end")
        self._nl_body.insert("1.0", content)
        self._nl_subject.delete(0, "end")
        self._nl_subject.insert(0, template_name)

    def _send_newsletter(self):
        subject = self._nl_subject.get().strip()
        body = self._nl_body.get("1.0", "end").strip()
        target = self._nl_target.get()

        if not subject or not body:
            self.app.show_toast("Subject and content required", "warning")
            return

        self._nl_status.configure(text="Sending...", text_color=theme.AMBER)

        def send():
            try:
                # Wrap plain text in branded HTML template
                from ..content_writer import wrap_newsletter_html
                # Convert plain text body to basic HTML paragraphs
                body_html = body
                if "<" not in body:
                    # Plain text — convert to HTML paragraphs
                    paragraphs = body.split("\n\n")
                    body_html = "".join(f"<p>{p.strip()}</p>" for p in paragraphs if p.strip())

                # Check for a draft hero image (auto-fetched by agent scheduler)
                nl_image_url = ""
                try:
                    nl_image_url = self.db.get_setting("draft_newsletter_image") or ""
                except Exception:
                    pass
                branded_html = wrap_newsletter_html(body_html, subject, image_url=nl_image_url)

                result = self.api.post("send_newsletter", {
                    "subject": subject,
                    "body": branded_html,
                    "target": target,
                })
                sent = result.get("sent", 0) if isinstance(result, dict) else 0
                failed = result.get("failed", 0) if isinstance(result, dict) else 0

                self.db.log_newsletter(subject, target, sent, failed)

                self.after(0, lambda: self._on_newsletter_sent(sent, failed))
            except Exception as e:
                self.after(0, lambda: self._on_newsletter_error(str(e)))

        threading.Thread(target=send, daemon=True).start()

    def _on_newsletter_sent(self, sent: int, failed: int):
        self._nl_status.configure(
            text=f"✅ Sent to {sent} subscribers ({failed} failed)",
            text_color=theme.GREEN_LIGHT,
        )
        self.app.show_toast(f"Newsletter sent to {sent} subscribers", "success")
        self._refresh_subtab("newsletter")

    def _on_newsletter_error(self, error: str):
        self._nl_status.configure(text=f"❌ {error}", text_color=theme.RED)
        self.app.show_toast("Newsletter send failed", "error")

    def _preview_newsletter(self):
        subject = self._nl_subject.get().strip()
        body = self._nl_body.get("1.0", "end").strip()

        preview = ctk.CTkToplevel(self)
        preview.title("Newsletter Preview")
        preview.geometry("500x500")
        preview.transient(self.winfo_toplevel())

        scroll = ctk.CTkScrollableFrame(preview, fg_color=theme.BG_DARK)
        scroll.pack(fill="both", expand=True)

        ctk.CTkLabel(
            scroll, text=subject or "No Subject",
            font=theme.font_bold(18), text_color=theme.TEXT_LIGHT,
        ).pack(fill="x", padx=20, pady=(20, 8))

        ctk.CTkLabel(
            scroll, text=f"Target: {self._nl_target.get()}",
            font=theme.font(11), text_color=theme.TEXT_DIM,
        ).pack(fill="x", padx=20, pady=(0, 12))

        ctk.CTkTextbox(
            scroll, height=350,
            fg_color=theme.BG_CARD, font=theme.font(13),
            text_color=theme.TEXT_LIGHT,
        ).pack(fill="x", padx=20, pady=(0, 20))

        # Insert body into last widget
        text_widget = scroll.winfo_children()[-1]
        text_widget.insert("1.0", body or "No content")
        text_widget.configure(state="disabled")

    def _ai_generate_newsletter(self):
        """Generate newsletter content using the best available LLM."""
        status = llm.get_status()
        if status["available"]:
            self._nl_status.configure(
                text=f"🤖 Generating with {status['label']}...", text_color=theme.AMBER)
        else:
            self._nl_status.configure(
                text="⚠️ No AI available — using template", text_color=theme.AMBER)

        # Check for draft from agent output first
        draft_subject = self.db.get_setting("draft_newsletter_subject", "")
        draft_body = self.db.get_setting("draft_newsletter_body", "")

        if draft_subject and draft_body:
            self._nl_subject.delete(0, "end")
            self._nl_subject.insert(0, draft_subject)
            self._nl_body.delete("1.0", "end")
            self._nl_body.insert("1.0", draft_body)
            self._nl_status.configure(text="✅ Loaded AI draft", text_color=theme.GREEN_LIGHT)
            # Clear the draft
            self.db.set_setting("draft_newsletter_subject", "")
            self.db.set_setting("draft_newsletter_body", "")
            return

        def generate():
            try:
                from ..content_writer import generate_newsletter
                audience = self._nl_audience.get().lower() if hasattr(self, '_nl_audience') else "all"
                result = generate_newsletter(audience=audience)

                if result.get("error"):
                    self.after(0, lambda: self._nl_status.configure(
                        text=f"❌ {result['error']}", text_color=theme.RED
                    ))
                    return

                body = result.get("body_text") or result.get("body_html", "")

                def apply():
                    self._nl_subject.delete(0, "end")
                    self._nl_subject.insert(0, result["subject"])
                    self._nl_body.delete("1.0", "end")
                    self._nl_body.insert("1.0", body)
                    provider = llm.get_status()
                    self._nl_status.configure(
                        text=f"✅ Generated with {provider['label']} — review before sending",
                        text_color=theme.GREEN_LIGHT,
                    )

                self.after(0, apply)

            except Exception as e:
                self.after(0, lambda: self._nl_status.configure(
                    text=f"❌ {e}", text_color=theme.RED
                ))

        threading.Thread(target=generate, daemon=True).start()

    # ------------------------------------------------------------------
    # Blog Management Panel
    # ------------------------------------------------------------------
    def _build_blog_panel(self):
        frame = ctk.CTkScrollableFrame(self, fg_color="transparent")
        self._sub_frames["blog"] = frame

        # Blog KPIs
        kpi_frame = ctk.CTkFrame(frame, fg_color="transparent")
        kpi_frame.pack(fill="x", padx=16, pady=(16, 8))
        for i in range(4):
            kpi_frame.grid_columnconfigure(i, weight=1)

        blog_kpis = [
            ("blog_total",     "📝", "0", "Total Posts"),
            ("blog_published", "🌐", "0", "Published"),
            ("blog_draft",     "📋", "0", "Drafts"),
            ("blog_agent",     "🤖", "0", "AI Generated"),
        ]
        for i, (key, icon, default, label) in enumerate(blog_kpis):
            card = KPICard(kpi_frame, icon=icon, value=default, label=label)
            card.grid(row=0, column=i, padx=6, pady=4, sticky="nsew")
            self._kpi_cards[key] = card

        # Actions bar
        action_bar = ctk.CTkFrame(frame, fg_color=theme.BG_CARD, corner_radius=12)
        action_bar.pack(fill="x", padx=16, pady=(8, 8))

        inner = ctk.CTkFrame(action_bar, fg_color="transparent")
        inner.pack(fill="x", padx=16, pady=12)

        theme.create_accent_button(
            inner, "➕ New Blog Post",
            command=self._new_blog_post, width=150,
        ).pack(side="left", padx=(0, 8))

        theme.create_outline_button(
            inner, "🤖 AI Generate Post",
            command=self._ai_generate_blog, width=160,
        ).pack(side="left", padx=(0, 8))

        theme.create_outline_button(
            inner, "↻ Sync from Website",
            command=self._sync_blog_posts, width=160,
        ).pack(side="left", padx=(0, 8))

        theme.create_outline_button(
            inner, "📤 Run Email Lifecycle",
            command=self._run_lifecycle, width=170,
        ).pack(side="left", padx=(0, 8))

        self._blog_status = ctk.CTkLabel(
            inner, text="", font=theme.font(12), text_color=theme.TEXT_DIM,
        )
        self._blog_status.pack(side="left", padx=16)

        # Blog filter
        filter_frame = ctk.CTkFrame(frame, fg_color="transparent")
        filter_frame.pack(fill="x", padx=16, pady=(0, 8))

        ctk.CTkLabel(
            filter_frame, text="Filter:", font=theme.font(12), text_color=theme.TEXT_DIM,
        ).pack(side="left", padx=(0, 8))

        self._blog_filter = ctk.CTkComboBox(
            filter_frame, values=["All"] + config.BLOG_STATUS_OPTIONS,
            width=120, font=theme.font(12),
            command=lambda _: self._load_blog_posts(),
        )
        self._blog_filter.set("All")
        self._blog_filter.pack(side="left")

        # Blog posts container
        self._blog_container = ctk.CTkFrame(frame, fg_color="transparent")
        self._blog_container.pack(fill="x", padx=16, pady=(0, 16))

    def _load_blog_posts(self):
        """Load and render blog posts."""
        for w in self._blog_container.winfo_children():
            w.destroy()

        status_filter = self._blog_filter.get()
        status = None if status_filter == "All" else status_filter
        posts = self.db.get_blog_posts(status=status)

        # Update KPIs
        stats = self.db.get_blog_stats()
        self._kpi_cards["blog_total"].set_value(str(stats.get("total", 0)))
        self._kpi_cards["blog_published"].set_value(str(stats.get("published", 0)))
        self._kpi_cards["blog_draft"].set_value(str(stats.get("drafts", 0)))

        # Count agent-generated
        agent_count = len(self.db.fetchall(
            "SELECT id FROM blog_posts WHERE agent_run_id IS NOT NULL AND agent_run_id > 0"
        ))
        self._kpi_cards["blog_agent"].set_value(str(agent_count))

        if not posts:
            ctk.CTkLabel(
                self._blog_container,
                text="No blog posts yet. Create one or generate with AI!",
                font=theme.font(13), text_color=theme.TEXT_DIM,
            ).pack(pady=20)
            return

        for post in posts:
            self._render_blog_card(post)

    def _render_blog_card(self, post: dict):
        """Render a single blog post card."""
        card = ctk.CTkFrame(self._blog_container, fg_color=theme.BG_CARD, corner_radius=10)
        card.pack(fill="x", pady=4)
        card.grid_columnconfigure(1, weight=1)

        # Status indicator
        status = post.get("status", "Draft")
        status_color = theme.GREEN_PRIMARY if status == "Published" else theme.AMBER if status == "Draft" else theme.TEXT_DIM
        ctk.CTkLabel(
            card, text="●", font=theme.font(16),
            text_color=status_color, width=30,
        ).grid(row=0, column=0, padx=(12, 4), pady=12, rowspan=2)

        # Title + category
        title = post.get("title", "Untitled")
        ctk.CTkLabel(
            card, text=title, font=theme.font_bold(14),
            text_color=theme.TEXT_LIGHT, anchor="w",
        ).grid(row=0, column=1, padx=4, pady=(12, 0), sticky="w")

        category = post.get("category", "")
        date_str = (post.get("created_date", "") or "")[:10]
        meta = f"{status}  •  {category}  •  {date_str}" if category else f"{status}  •  {date_str}"
        ctk.CTkLabel(
            card, text=meta, font=theme.font(11),
            text_color=theme.TEXT_DIM, anchor="w",
        ).grid(row=1, column=1, padx=4, pady=(0, 12), sticky="w")

        # Excerpt
        excerpt = (post.get("excerpt", "") or "")[:100]
        if excerpt:
            ctk.CTkLabel(
                card, text=excerpt, font=theme.font(11),
                text_color=theme.TEXT_DIM, anchor="w", wraplength=500,
            ).grid(row=2, column=1, padx=4, pady=(0, 8), sticky="w")

        # Action buttons
        btn_frame = ctk.CTkFrame(card, fg_color="transparent")
        btn_frame.grid(row=0, column=2, rowspan=3, padx=12, pady=12)

        ctk.CTkButton(
            btn_frame, text="✏️ Edit", width=70, height=28,
            fg_color="transparent", hover_color=theme.BG_CARD_HOVER,
            border_width=1, border_color=theme.GREEN_PRIMARY,
            text_color=theme.GREEN_LIGHT, corner_radius=6, font=theme.font(11),
            command=lambda p=post: self._edit_blog_post(p),
        ).pack(pady=2)

        if status == "Draft":
            ctk.CTkButton(
                btn_frame, text="🌐 Publish", width=70, height=28,
                fg_color=theme.GREEN_PRIMARY, hover_color=theme.GREEN_DARK,
                corner_radius=6, font=theme.font(11, "bold"),
                command=lambda p=post: self._publish_blog_post(p),
            ).pack(pady=2)
        else:
            ctk.CTkButton(
                btn_frame, text="📱 Share", width=70, height=28,
                fg_color=theme.BLUE, hover_color="#1565C0",
                corner_radius=6, font=theme.font(11),
                command=lambda p=post: self._share_blog_post(p),
            ).pack(pady=2)

        ctk.CTkButton(
            btn_frame, text="🗑️", width=40, height=28,
            fg_color="transparent", hover_color=theme.RED,
            text_color=theme.RED, corner_radius=6, font=theme.font(11),
            command=lambda p=post: self._delete_blog_post_confirm(p),
        ).pack(pady=2)

    def _new_blog_post(self):
        """Open editor for a new blog post."""
        self._open_blog_editor({})

    def _edit_blog_post(self, post: dict):
        """Open editor for an existing blog post."""
        self._open_blog_editor(post)

    def _open_blog_editor(self, post: dict):
        """Open the blog post editor modal."""
        editor = ctk.CTkToplevel(self)
        editor.title("Edit Blog Post" if post.get("id") else "New Blog Post")
        editor.geometry("700x650")
        editor.transient(self.winfo_toplevel())
        editor.grab_set()

        scroll = ctk.CTkScrollableFrame(editor, fg_color=theme.BG_DARK)
        scroll.pack(fill="both", expand=True)

        # Title
        ctk.CTkLabel(scroll, text="Title", font=theme.font_bold(13), text_color=theme.TEXT_LIGHT,
                      anchor="w").pack(fill="x", padx=20, pady=(16, 4))
        title_entry = theme.create_entry(scroll, placeholder="Blog post title...")
        title_entry.pack(fill="x", padx=20)
        if post.get("title"):
            title_entry.insert(0, post["title"])

        # Category
        cat_frame = ctk.CTkFrame(scroll, fg_color="transparent")
        cat_frame.pack(fill="x", padx=20, pady=(8, 0))

        ctk.CTkLabel(cat_frame, text="Category:", font=theme.font(12),
                      text_color=theme.TEXT_DIM).pack(side="left", padx=(0, 8))
        cat_combo = ctk.CTkComboBox(cat_frame, values=config.BLOG_CATEGORIES,
                                     width=200, font=theme.font(12))
        cat_combo.set(post.get("category", "Lawn Care"))
        cat_combo.pack(side="left", padx=(0, 16))

        ctk.CTkLabel(cat_frame, text="Status:", font=theme.font(12),
                      text_color=theme.TEXT_DIM).pack(side="left", padx=(0, 8))
        status_combo = ctk.CTkComboBox(cat_frame, values=config.BLOG_STATUS_OPTIONS,
                                        width=120, font=theme.font(12))
        status_combo.set(post.get("status", "Draft"))
        status_combo.pack(side="left")

        # Excerpt
        ctk.CTkLabel(scroll, text="Excerpt", font=theme.font_bold(13), text_color=theme.TEXT_LIGHT,
                      anchor="w").pack(fill="x", padx=20, pady=(8, 4))
        excerpt_entry = theme.create_entry(scroll, placeholder="Short summary for previews...")
        excerpt_entry.pack(fill="x", padx=20)
        if post.get("excerpt"):
            excerpt_entry.insert(0, post["excerpt"])

        # Tags
        ctk.CTkLabel(scroll, text="Tags (comma separated)", font=theme.font_bold(13),
                      text_color=theme.TEXT_LIGHT, anchor="w").pack(fill="x", padx=20, pady=(8, 4))
        tags_entry = theme.create_entry(scroll, placeholder="lawn care, cornwall, tips...")
        tags_entry.pack(fill="x", padx=20)
        if post.get("tags"):
            tags_entry.insert(0, post["tags"])

        # Content
        ctk.CTkLabel(scroll, text="Content (HTML)", font=theme.font_bold(13),
                      text_color=theme.TEXT_LIGHT, anchor="w").pack(fill="x", padx=20, pady=(8, 4))
        content_box = ctk.CTkTextbox(scroll, height=250, fg_color=theme.BG_INPUT,
                                      font=theme.font(12), text_color=theme.TEXT_LIGHT,
                                      corner_radius=8)
        content_box.pack(fill="x", padx=20)
        if post.get("content"):
            content_box.insert("1.0", post["content"])

        # Image URL
        ctk.CTkLabel(scroll, text="Image URL (optional — auto-fetched if blank)",
                      font=theme.font(12), text_color=theme.TEXT_DIM,
                      anchor="w").pack(fill="x", padx=20, pady=(8, 4))
        image_entry = theme.create_entry(scroll, placeholder="https://...")
        image_entry.pack(fill="x", padx=20)
        if post.get("image_url"):
            image_entry.insert(0, post["image_url"])

        # Save button
        def save():
            data = {
                "title": title_entry.get().strip(),
                "category": cat_combo.get(),
                "status": status_combo.get(),
                "excerpt": excerpt_entry.get().strip(),
                "tags": tags_entry.get().strip(),
                "content": content_box.get("1.0", "end").strip(),
                "image_url": image_entry.get().strip(),
            }
            if not data["title"]:
                self.app.show_toast("Title is required", "warning")
                return

            if post.get("id"):
                data["id"] = post["id"]

            # Save locally
            blog_id = self.db.save_blog_post(data)
            self.app.show_toast("Blog post saved", "success")
            editor.destroy()
            self._load_blog_posts()

        btn_row = ctk.CTkFrame(scroll, fg_color="transparent")
        btn_row.pack(fill="x", padx=20, pady=(12, 20))

        theme.create_accent_button(btn_row, "💾 Save", command=save, width=120).pack(side="left", padx=(0, 8))
        theme.create_outline_button(btn_row, "Cancel", command=editor.destroy, width=90).pack(side="left")

    def _publish_blog_post(self, post: dict):
        """Publish a blog post to the website via GAS.
        Auto-fetches a stock image if none is set."""
        self._blog_status.configure(text="Publishing...", text_color=theme.AMBER)

        def publish():
            try:
                image_url = post.get("image_url", "")

                # Auto-fetch a matching stock image if none provided
                if not image_url:
                    try:
                        from ..agents import fetch_pexels_image
                        image_data = fetch_pexels_image(post.get("title", "garden"))
                        image_url = image_data.get("url", "")
                        if image_url:
                            # Update local record with the image
                            post["image_url"] = image_url
                            self.db.save_blog_post(post)
                    except Exception as img_err:
                        log.warning(f"Image fetch failed: {img_err}")

                # Save to GAS
                result = self.api.post("save_blog_post", {
                    "id": post.get("post_id", ""),
                    "title": post.get("title", ""),
                    "category": post.get("category", ""),
                    "excerpt": post.get("excerpt", ""),
                    "content": post.get("content", ""),
                    "status": "published",
                    "tags": post.get("tags", ""),
                    "imageUrl": post.get("image_url", ""),
                })

                # Update local
                post_data = dict(post)
                post_data["status"] = "Published"
                post_data["published_at"] = datetime.now().isoformat()
                if isinstance(result, dict) and result.get("id"):
                    post_data["post_id"] = result["id"]
                self.db.save_blog_post(post_data)

                self.after(0, lambda: (
                    self._blog_status.configure(text="✅ Published!", text_color=theme.GREEN_LIGHT),
                    self.app.show_toast("Blog post published to website", "success"),
                    self._load_blog_posts(),
                ))
            except Exception as e:
                self.after(0, lambda: (
                    self._blog_status.configure(text=f"❌ {e}", text_color=theme.RED),
                    self.app.show_toast(f"Publish failed: {e}", "error"),
                ))

        threading.Thread(target=publish, daemon=True).start()

    def _share_blog_post(self, post: dict):
        """Share a published blog post to Telegram for social media."""
        title = post.get("title", "")
        excerpt = post.get("excerpt", title)
        msg = (
            f"📝 *New Blog Post*\n\n"
            f"*{title}*\n\n"
            f"{excerpt}\n\n"
            f"🔗 Read more: gardnersgroundmaintenance.co.uk/blog.html\n\n"
            f"#gardening #cornwall #gardenersgroundmaintenance"
        )

        def send():
            self.api.send_telegram(msg)
            # Save as social post
            self.db.save_social_post({
                "platform": "All",
                "content": msg,
                "hashtags": "#gardening #cornwall",
                "status": "posted",
                "posted_at": datetime.now().isoformat(),
                "blog_post_id": post.get("post_id", ""),
            })
            self.after(0, lambda: self.app.show_toast("Blog shared to Telegram", "success"))

        threading.Thread(target=send, daemon=True).start()

    def _delete_blog_post_confirm(self, post: dict):
        """Delete a blog post with confirmation."""
        confirm = ctk.CTkToplevel(self)
        confirm.title("Delete Post?")
        confirm.geometry("400x150")
        confirm.transient(self.winfo_toplevel())
        confirm.grab_set()

        ctk.CTkLabel(
            confirm, text=f"Delete \"{post.get('title', 'Untitled')}\"?",
            font=theme.font_bold(14), text_color=theme.TEXT_LIGHT,
        ).pack(pady=(20, 8))

        ctk.CTkLabel(
            confirm, text="This cannot be undone.",
            font=theme.font(12), text_color=theme.RED,
        ).pack(pady=(0, 16))

        btn_row = ctk.CTkFrame(confirm, fg_color="transparent")
        btn_row.pack()

        def do_delete():
            self.db.delete_blog_post(post["id"])
            # Also delete from GAS if published
            if post.get("status") == "Published" and post.get("post_id"):
                try:
                    self.api.post("delete_blog_post", {"id": post["post_id"]})
                except Exception:
                    pass
            confirm.destroy()
            self.app.show_toast("Blog post deleted", "success")
            self._load_blog_posts()

        theme.create_accent_button(btn_row, "🗑️ Delete", command=do_delete, width=100).pack(side="left", padx=4)
        theme.create_outline_button(btn_row, "Cancel", command=confirm.destroy, width=80).pack(side="left", padx=4)

    def _ai_generate_blog(self):
        """Generate a blog post using AI."""
        self._blog_status.configure(text="🤖 Generating blog post...", text_color=theme.AMBER)

        # Check for agent-generated drafts first
        runs = self.db.get_agent_runs()
        unpublished = [r for r in runs if r.get("agent_type") == "blog_writer"
                       and r.get("status") == "success" and not r.get("published")]

        if unpublished:
            run = unpublished[0]
            post_data = {
                "title": run.get("output_title", "AI Generated Post"),
                "content": run.get("output_text", ""),
                "category": "Lawn Care",
                "status": "Draft",
                "agent_run_id": run["id"],
                "author": "AI / Gardners GM",
            }
            blog_id = self.db.save_blog_post(post_data)
            self.db.update_agent_run(run["id"], "success",
                                      output_title=run.get("output_title", ""),
                                      output_text=run.get("output_text", ""),
                                      published=1)
            self._blog_status.configure(text="✅ Draft imported from AI agent", text_color=theme.GREEN_LIGHT)
            self.app.show_toast("AI draft imported — edit and publish", "success")
            self._load_blog_posts()
            return

        # Generate fresh via best available LLM
        def generate():
            try:
                from ..content_writer import generate_blog_post
                result = generate_blog_post()
                if result.get("error"):
                    self.after(0, lambda: self._blog_status.configure(
                        text=f"❌ {result['error']}", text_color=theme.RED))
                    return

                author = result.get("author", "Chris")
                post_data = {
                    "title": result["title"],
                    "content": result["content"],
                    "category": result.get("category", "Lawn Care"),
                    "excerpt": result.get("excerpt", ""),
                    "tags": result.get("tags", ""),
                    "status": "Draft",
                    "author": author,
                }
                self.db.save_blog_post(post_data)
                provider = llm.get_status()
                self.after(0, lambda: (
                    self._blog_status.configure(
                        text=f"✅ Generated by {author} ({provider['label']}) — saved as draft",
                        text_color=theme.GREEN_LIGHT),
                    self.app.show_toast("AI blog post created — review and edit", "success"),
                    self._load_blog_posts(),
                ))
            except Exception as e:
                self.after(0, lambda: self._blog_status.configure(
                    text=f"❌ {e}", text_color=theme.RED))

        threading.Thread(target=generate, daemon=True).start()

    def _sync_blog_posts(self):
        """Pull blog posts from GAS Blog sheet."""
        self._blog_status.configure(text="Syncing...", text_color=theme.AMBER)

        def sync():
            try:
                result = self.api.get("get_all_blog_posts")
                posts = []
                if isinstance(result, dict):
                    posts = result.get("data", result.get("posts", []))
                elif isinstance(result, list):
                    posts = result

                if posts:
                    mapped = []
                    for p in posts:
                        mapped.append({
                            "post_id": str(p.get("id", p.get("ID", ""))),
                            "title": p.get("title", p.get("Title", "")),
                            "category": p.get("category", p.get("Category", "")),
                            "author": p.get("author", p.get("Author", "Gardners GM")),
                            "excerpt": p.get("excerpt", p.get("Excerpt", "")),
                            "content": p.get("content", p.get("Content", "")),
                            "status": (p.get("status", p.get("Status", "Draft")) or "Draft").capitalize(),
                            "tags": p.get("tags", p.get("Tags", "")),
                            "image_url": p.get("imageUrl", p.get("ImageUrl", "")),
                            "created_date": p.get("date", p.get("Date", "")),
                        })
                    self.db.upsert_blog_posts(mapped)

                self.after(0, lambda: (
                    self._blog_status.configure(text=f"✅ Synced {len(posts)} posts", text_color=theme.GREEN_LIGHT),
                    self._load_blog_posts(),
                ))
            except Exception as e:
                self.after(0, lambda: self._blog_status.configure(
                    text=f"❌ {e}", text_color=theme.RED))

        threading.Thread(target=sync, daemon=True).start()

    def _run_lifecycle(self):
        """Trigger the full email lifecycle processing via GAS."""
        self._blog_status.configure(text="Running lifecycle...", text_color=theme.AMBER)

        def run():
            try:
                email_engine = getattr(self.app, '_email_engine', None)
                if email_engine:
                    result = email_engine.run_full_lifecycle()
                else:
                    result = self.api.post("process_email_lifecycle", {})
                    result = {"success": True, "result": result}

                if result.get("success"):
                    gas_result = result.get("result", {})
                    msg = "✅ Lifecycle complete"
                    if isinstance(gas_result, dict):
                        details = []
                        for k, v in gas_result.items():
                            if isinstance(v, int) and v > 0 and k not in ("errors",):
                                details.append(f"{k}: {v}")
                        if details:
                            msg += f" — {', '.join(details)}"
                    self.after(0, lambda: (
                        self._blog_status.configure(text=msg, text_color=theme.GREEN_LIGHT),
                        self.app.show_toast("Email lifecycle processing complete", "success"),
                    ))
                else:
                    self.after(0, lambda: self._blog_status.configure(
                        text=f"❌ {result.get('error', 'Failed')}", text_color=theme.RED))

            except Exception as e:
                self.after(0, lambda: self._blog_status.configure(
                    text=f"❌ {e}", text_color=theme.RED))

        threading.Thread(target=run, daemon=True).start()

    # ------------------------------------------------------------------
    # Social Media Panel (Enhanced)
    # ------------------------------------------------------------------
    def _build_social_panel(self):
        frame = ctk.CTkScrollableFrame(self, fg_color="transparent")
        self._sub_frames["social"] = frame

        # Social KPIs
        social_kpi_frame = ctk.CTkFrame(frame, fg_color="transparent")
        social_kpi_frame.pack(fill="x", padx=16, pady=(16, 8))
        for i in range(3):
            social_kpi_frame.grid_columnconfigure(i, weight=1)

        social_kpis = [
            ("social_total", "📱", "0", "Total Posts"),
            ("social_week",  "📅", "0", "This Week"),
            ("social_draft", "📋", "0", "Drafts"),
        ]
        for i, (key, icon, default, label) in enumerate(social_kpis):
            card = KPICard(social_kpi_frame, icon=icon, value=default, label=label)
            card.grid(row=0, column=i, padx=6, pady=4, sticky="nsew")
            self._kpi_cards[key] = card

        # Post composer
        card = ctk.CTkFrame(frame, fg_color=theme.BG_CARD, corner_radius=12)
        card.pack(fill="x", padx=16, pady=(8, 8))

        ctk.CTkLabel(
            card, text="✍️ New Social Post", font=theme.font_bold(14),
            text_color=theme.TEXT_LIGHT, anchor="w",
        ).pack(fill="x", padx=16, pady=(14, 8))

        # Platform selection
        plat_frame = ctk.CTkFrame(card, fg_color="transparent")
        plat_frame.pack(fill="x", padx=16, pady=(0, 8))

        ctk.CTkLabel(
            plat_frame, text="Platform:", font=theme.font(12),
            text_color=theme.TEXT_DIM,
        ).pack(side="left", padx=(0, 8))

        platform_labels = [p["label"] for p in config.SOCIAL_PLATFORMS] + ["All"]
        self._social_platform = ctk.CTkComboBox(
            plat_frame, values=platform_labels,
            width=160, font=theme.font(12),
            command=self._on_platform_change,
        )
        self._social_platform.set("All")
        self._social_platform.pack(side="left", padx=(0, 16))

        self._char_limit_label = ctk.CTkLabel(
            plat_frame, text="", font=theme.font(10), text_color=theme.TEXT_DIM,
        )
        self._char_limit_label.pack(side="left")

        # Post body
        self._social_body = ctk.CTkTextbox(
            card, height=150,
            fg_color=theme.BG_INPUT, font=theme.font(13),
            text_color=theme.TEXT_LIGHT, corner_radius=8,
        )
        self._social_body.pack(fill="x", padx=16, pady=(0, 4))
        self._social_body.bind("<KeyRelease>", self._update_char_count)

        # Char count
        self._social_chars = ctk.CTkLabel(
            card, text="0 chars", font=theme.font(10),
            text_color=theme.TEXT_DIM, anchor="e",
        )
        self._social_chars.pack(fill="x", padx=16, pady=(0, 4))

        # Hashtag shortcuts
        hash_frame = ctk.CTkFrame(card, fg_color="transparent")
        hash_frame.pack(fill="x", padx=12, pady=(0, 4))

        ctk.CTkLabel(hash_frame, text="Hashtags:", font=theme.font(11),
                      text_color=theme.TEXT_DIM).pack(side="left", padx=(4, 4))

        for name, tags in config.HASHTAG_SETS.items():
            theme.create_outline_button(
                hash_frame, f"#{name}",
                command=lambda t=tags: self._add_hashtags(t), width=80,
            ).pack(side="left", padx=2, pady=2)

        # Quick content ideas
        ideas_frame = ctk.CTkFrame(card, fg_color="transparent")
        ideas_frame.pack(fill="x", padx=12, pady=(4, 8))

        ctk.CTkLabel(ideas_frame, text="Quick:", font=theme.font(11),
                      text_color=theme.TEXT_DIM).pack(side="left", padx=(4, 4))

        ideas = [
            ("Before/After", "🌿 Check out this amazing transformation! Before ➡️ After\n\n#gardening #cornwall #gardenersgroundmaintenance"),
            ("Seasonal", "🍂 Now is the perfect time to get your garden ready for the season!\n\nBook your appointment today.\n\n#cornwall #gardening"),
            ("Tip", "💡 Garden Tip of the Day:\n\n[Tip here]\n\n#gardeningtips #cornwall"),
            ("Promotion", "🎉 Special offer!\n\n[Details]\n\nBook now: gardnersgroundmaintenance.co.uk\n\n#offer #gardening"),
        ]

        for name, content in ideas:
            theme.create_outline_button(
                ideas_frame, name,
                command=lambda c=content: self._set_social_content(c),
                width=90,
            ).pack(side="left", padx=2, pady=2)

        # AI suggestion
        theme.create_outline_button(
            ideas_frame, "🤖 AI",
            command=self._ai_social_post, width=60,
        ).pack(side="left", padx=2, pady=2)

        # Post actions
        action_row = ctk.CTkFrame(card, fg_color="transparent")
        action_row.pack(fill="x", padx=16, pady=(0, 16))

        theme.create_accent_button(
            action_row, "📤 Post to Telegram",
            command=self._post_social, width=170,
        ).pack(side="left", padx=(0, 8))

        theme.create_outline_button(
            action_row, "💾 Save Draft",
            command=self._save_social_draft, width=110,
        ).pack(side="left", padx=(0, 8))

        theme.create_outline_button(
            action_row, "📋 Copy",
            command=self._copy_social, width=80,
        ).pack(side="left")

        self._social_status = ctk.CTkLabel(
            action_row, text="", font=theme.font(12), text_color=theme.TEXT_DIM,
        )
        self._social_status.pack(side="left", padx=16)

        # Post history
        history_card = ctk.CTkFrame(frame, fg_color=theme.BG_CARD, corner_radius=12)
        history_card.pack(fill="x", padx=16, pady=(8, 16))

        ctk.CTkLabel(
            history_card, text="📜 Post History", font=theme.font_bold(15),
            text_color=theme.TEXT_LIGHT, anchor="w",
        ).pack(fill="x", padx=16, pady=(14, 8))

        self._social_history_container = ctk.CTkFrame(history_card, fg_color="transparent")
        self._social_history_container.pack(fill="x", padx=16, pady=(0, 14))

    def _on_platform_change(self, platform_name: str):
        """Update char limit label when platform changes."""
        for p in config.SOCIAL_PLATFORMS:
            if p["label"] == platform_name:
                self._char_limit_label.configure(text=f"Limit: {p['char_limit']} chars")
                return
        self._char_limit_label.configure(text="")

    def _update_char_count(self, event=None):
        content = self._social_body.get("1.0", "end").strip()
        count = len(content)
        self._social_chars.configure(text=f"{count} chars")
        # Check against platform limit
        platform = self._social_platform.get()
        for p in config.SOCIAL_PLATFORMS:
            if p["label"] == platform:
                if count > p["char_limit"]:
                    self._social_chars.configure(text_color=theme.RED)
                else:
                    self._social_chars.configure(text_color=theme.TEXT_DIM)
                return

    def _add_hashtags(self, tags: str):
        """Append hashtags to the social post body."""
        current = self._social_body.get("1.0", "end").strip()
        if current and not current.endswith("\n"):
            current += "\n\n"
        self._social_body.delete("1.0", "end")
        self._social_body.insert("1.0", current + tags)

    def _set_social_content(self, content: str):
        self._social_body.delete("1.0", "end")
        self._social_body.insert("1.0", content)

    def _ai_social_post(self):
        """Generate a social media post using AI."""
        self._social_status.configure(text="🤖 Generating...", text_color=theme.AMBER)

        def generate():
            try:
                from ..agents import ollama_generate
                platform = self._social_platform.get()
                prompt = (
                    f"Write a short, engaging social media post for {platform} "
                    f"for Gardners Ground Maintenance, a gardening company in Cornwall, UK. "
                    f"Keep it punchy, include relevant emojis, and add 3-5 relevant hashtags. "
                    f"Maximum 200 words."
                )
                result = ollama_generate(prompt)
                if result.startswith("[Error"):
                    self.after(0, lambda: self._social_status.configure(
                        text=f"❌ {result}", text_color=theme.RED))
                    return
                self.after(0, lambda: (
                    self._set_social_content(result),
                    self._social_status.configure(text="✅ AI post generated", text_color=theme.GREEN_LIGHT),
                ))
            except Exception as e:
                self.after(0, lambda: self._social_status.configure(
                    text=f"❌ {e}", text_color=theme.RED))

        threading.Thread(target=generate, daemon=True).start()

    def _post_social(self):
        content = self._social_body.get("1.0", "end").strip()
        if not content:
            self.app.show_toast("Write a post first", "warning")
            return

        platform = self._social_platform.get()
        msg = f"📱 *Social Media Post ({platform})*\n\n{content}"

        def send():
            self.api.send_telegram(msg)
            self.db.log_telegram(msg, "sent")
            self.db.save_social_post({
                "platform": platform,
                "content": content,
                "status": "posted",
                "posted_at": datetime.now().isoformat(),
            })
            self.after(0, lambda: (
                self.app.show_toast(f"Post sent to Telegram for {platform}", "success"),
                self._load_social_history(),
            ))

        threading.Thread(target=send, daemon=True).start()

    def _save_social_draft(self):
        content = self._social_body.get("1.0", "end").strip()
        if not content:
            self.app.show_toast("Write a post first", "warning")
            return
        platform = self._social_platform.get()
        self.db.save_social_post({
            "platform": platform,
            "content": content,
            "status": "draft",
        })
        self.app.show_toast("Draft saved", "success")
        self._load_social_history()

    def _copy_social(self):
        content = self._social_body.get("1.0", "end").strip()
        if content:
            self.clipboard_clear()
            self.clipboard_append(content)
            self.app.show_toast("Copied to clipboard", "success")

    def _load_social_history(self):
        """Load and render social post history."""
        for w in self._social_history_container.winfo_children():
            w.destroy()

        posts = self.db.get_social_posts(limit=15)

        # Update KPIs
        all_posts = self.db.get_social_posts(limit=1000)
        self._kpi_cards["social_total"].set_value(str(len(all_posts)))
        from datetime import timedelta
        week_ago = (datetime.now() - timedelta(days=7)).isoformat()
        week_count = sum(1 for p in all_posts if (p.get("created_at", "") or "") >= week_ago)
        self._kpi_cards["social_week"].set_value(str(week_count))
        draft_count = sum(1 for p in all_posts if p.get("status") == "draft")
        self._kpi_cards["social_draft"].set_value(str(draft_count))

        if not posts:
            ctk.CTkLabel(
                self._social_history_container,
                text="No social posts yet", font=theme.font(12), text_color=theme.TEXT_DIM,
            ).pack(pady=8)
            return

        for post in posts:
            row = ctk.CTkFrame(self._social_history_container, fg_color=theme.BG_INPUT, corner_radius=8)
            row.pack(fill="x", pady=3)
            row.grid_columnconfigure(1, weight=1)

            status = post.get("status", "draft")
            icon = "✅" if status == "posted" else "📋"
            platform = post.get("platform", "All")

            ctk.CTkLabel(
                row, text=f"{icon} {platform}",
                font=theme.font_bold(11), text_color=theme.TEXT_LIGHT, width=120, anchor="w",
            ).grid(row=0, column=0, padx=12, pady=8, sticky="w")

            content_preview = (post.get("content", "") or "")[:80]
            ctk.CTkLabel(
                row, text=content_preview, font=theme.font(11),
                text_color=theme.TEXT_DIM, anchor="w",
            ).grid(row=0, column=1, padx=4, pady=8, sticky="w")

            date_str = (post.get("posted_at") or post.get("created_at") or "")[:16]
            ctk.CTkLabel(
                row, text=date_str, font=theme.font(10),
                text_color=theme.TEXT_DIM,
            ).grid(row=0, column=2, padx=12, pady=8)

            # Reuse draft button
            if status == "draft":
                ctk.CTkButton(
                    row, text="Use", width=50, height=24,
                    fg_color=theme.GREEN_PRIMARY, hover_color=theme.GREEN_DARK,
                    corner_radius=4, font=theme.font(10),
                    command=lambda p=post: self._load_draft(p),
                ).grid(row=0, column=3, padx=(0, 12), pady=8)

    def _load_draft(self, post: dict):
        """Load a draft social post into the composer."""
        self._social_body.delete("1.0", "end")
        self._social_body.insert("1.0", post.get("content", ""))
        self._social_platform.set(post.get("platform", "All"))

    # ------------------------------------------------------------------
    # Testimonials Panel
    # ------------------------------------------------------------------
    def _build_testimonials_panel(self):
        frame = ctk.CTkFrame(self, fg_color="transparent")
        self._sub_frames["testimonials"] = frame

        frame.grid_columnconfigure(0, weight=1)
        frame.grid_rowconfigure(1, weight=1)

        header = ctk.CTkFrame(frame, fg_color="transparent")
        header.grid(row=0, column=0, sticky="ew", padx=12, pady=(12, 4))

        ctk.CTkLabel(
            header, text="⭐ Testimonials",
            font=theme.font_bold(15), text_color=theme.TEXT_LIGHT, anchor="w",
        ).pack(side="left")

        theme.create_accent_button(
            header, "↻ Pull from Website",
            command=self._pull_testimonials, width=160,
        ).pack(side="right")

        columns = [
            {"key": "name",   "label": "Client",       "width": 150},
            {"key": "rating", "label": "Rating",       "width": 80},
            {"key": "text",   "label": "Testimonial",  "width": 400},
            {"key": "date",   "label": "Date",         "width": 100},
        ]

        self.testimonials_table = DataTable(
            frame, columns=columns,
            on_double_click=self._view_testimonial,
        )
        self.testimonials_table.grid(row=1, column=0, sticky="nsew", padx=12, pady=(4, 12))

    def _pull_testimonials(self):
        """Pull testimonials from GAS."""
        try:
            result = self.api.post("get_testimonials", {})
            if isinstance(result, dict) and result.get("data"):
                self.app.show_toast(f"Loaded {len(result['data'])} testimonials", "success")
                self._render_testimonials(result["data"])
            else:
                self.app.show_toast("No testimonials found", "info")
        except Exception as e:
            self.app.show_toast(f"Failed: {e}", "error")

    def _render_testimonials(self, data: list):
        rows = []
        for t in data:
            rows.append({
                "name": t.get("name", ""),
                "rating": "⭐" * int(t.get("rating", 5)),
                "text": (t.get("text", t.get("review", "")) or "")[:80],
                "date": t.get("date", ""),
            })
        self.testimonials_table.set_data(rows)

    # ------------------------------------------------------------------
    # Data Loading
    # ------------------------------------------------------------------
    def _refresh_subtab(self, key: str):
        try:
            if key == "newsletter":
                self._load_newsletter_stats()
            elif key == "blog":
                self._load_blog_posts()
            elif key == "social":
                self._load_social_history()
        except Exception:
            import traceback
            traceback.print_exc()

    def _load_newsletter_stats(self):
        stats = self.db.get_subscriber_stats()
        self._kpi_cards["nl_total"].set_value(str(stats.get("total", 0)))
        self._kpi_cards["nl_active"].set_value(str(stats.get("active", 0)))
        self._kpi_cards["nl_paid"].set_value(str(stats.get("paid", 0)))
        self._kpi_cards["nl_free"].set_value(str(stats.get("free", 0)))
        self._kpi_cards["nl_unsub"].set_value(str(stats.get("unsubscribed", 0)))

        # History
        self._load_newsletter_history()

    def _load_newsletter_history(self):
        for w in self._nl_history_container.winfo_children():
            w.destroy()

        logs = self.db.get_newsletter_log(limit=10)
        if not logs:
            ctk.CTkLabel(
                self._nl_history_container,
                text="No newsletters sent yet",
                font=theme.font(12), text_color=theme.TEXT_DIM,
            ).pack(pady=8)
            return

        for log in logs:
            row = ctk.CTkFrame(self._nl_history_container, fg_color=theme.BG_INPUT, corner_radius=8)
            row.pack(fill="x", pady=3)
            row.grid_columnconfigure(1, weight=1)

            ctk.CTkLabel(
                row, text=log.get("subject", ""),
                font=theme.font_bold(12), text_color=theme.TEXT_LIGHT, anchor="w",
            ).grid(row=0, column=0, padx=12, pady=8, sticky="w")

            info = f"To: {log.get('target', 'All')}  •  ✅ {log.get('sent_count', 0)}  •  ❌ {log.get('failed_count', 0)}"
            ctk.CTkLabel(
                row, text=info,
                font=theme.font(11), text_color=theme.TEXT_DIM, anchor="w",
            ).grid(row=0, column=1, padx=8, pady=8, sticky="w")

            ctk.CTkLabel(
                row, text=(log.get("sent_date", "") or "")[:10],
                font=theme.font(11), text_color=theme.TEXT_DIM,
            ).grid(row=0, column=2, padx=12, pady=8)

    # ------------------------------------------------------------------
    # Refresh
    # ------------------------------------------------------------------
    def refresh(self):
        if self._current_sub:
            self._refresh_subtab(self._current_sub)

    def on_table_update(self, table_name: str):
        """Auto-refresh when sync updates relevant tables."""
        if table_name in ("blog_posts", "subscribers", "newsletters", "clients"):
            if self._current_sub:
                self._refresh_subtab(self._current_sub)

    def _view_testimonial(self, values: dict):
        """Double-click a testimonial row — show full text + actions."""
        import customtkinter as ctk
        from ..ui import theme

        popup = ctk.CTkToplevel(self)
        popup.title(f"Testimonial from {values.get('name', 'Unknown')}")
        popup.geometry("500x320")
        popup.configure(fg_color=theme.BG_DARK)
        popup.transient(self)
        popup.grab_set()

        self.update_idletasks()
        px = self.winfo_rootx() + 100
        py = self.winfo_rooty() + 80
        popup.geometry(f"+{max(px,0)}+{max(py,0)}")

        ctk.CTkLabel(
            popup, text=f"⭐ {values.get('name', 'Unknown')}  —  {values.get('rating', '')}",
            font=theme.font_bold(15), text_color=theme.TEXT_LIGHT,
        ).pack(padx=16, pady=(16, 4), anchor="w")

        ctk.CTkLabel(
            popup, text=values.get('date', ''),
            font=theme.font(11), text_color=theme.TEXT_DIM,
        ).pack(padx=16, pady=(0, 8), anchor="w")

        textbox = ctk.CTkTextbox(
            popup, fg_color=theme.BG_INPUT, corner_radius=8, font=theme.font(12),
        )
        textbox.pack(fill="both", expand=True, padx=16, pady=(0, 8))
        textbox.insert("1.0", values.get('text', ''))
        textbox.configure(state="disabled")

        btn_row = ctk.CTkFrame(popup, fg_color="transparent")
        btn_row.pack(fill="x", padx=16, pady=(0, 12))

        full_text = values.get('text', '')
        ctk.CTkButton(
            btn_row, text="📋 Copy", width=90,
            fg_color=theme.GREEN_PRIMARY, hover_color=theme.GREEN_DARK,
            corner_radius=8, font=theme.font(12),
            command=lambda: (self.clipboard_clear(), self.clipboard_append(full_text),
                            popup.title("Copied!")),
        ).pack(side="left", padx=(0, 8))

        ctk.CTkButton(
            btn_row, text="Close", width=80,
            fg_color=theme.BG_CARD, hover_color=theme.RED,
            corner_radius=8, font=theme.font(12),
            command=popup.destroy,
        ).pack(side="right")

    # ------------------------------------------------------------------
    # Discount Codes Panel
    # ------------------------------------------------------------------
    def _build_discounts_panel(self):
        frame = ctk.CTkScrollableFrame(self, fg_color="transparent")
        self._sub_frames["discounts"] = frame

        # Header
        header = ctk.CTkFrame(frame, fg_color="transparent")
        header.pack(fill="x", padx=16, pady=(16, 8))

        ctk.CTkLabel(
            header, text="\U0001f3f7\ufe0f Discount Codes",
            font=theme.font_bold(18), text_color=theme.TEXT_LIGHT, anchor="w",
        ).pack(side="left")

        theme.create_accent_button(
            header, "+ New Code",
            command=self._new_discount_code, width=120,
        ).pack(side="right", padx=(8, 0))

        ctk.CTkButton(
            header, text="\U0001f504 Refresh", width=90,
            fg_color=theme.BG_CARD, hover_color=theme.GREEN_DARK,
            corner_radius=8, font=theme.font(12),
            command=self._load_discount_codes,
        ).pack(side="right")

        # Info
        ctk.CTkLabel(
            frame,
            text="Create discount codes to share in newsletters and blog posts. Customers enter them on the booking form.",
            font=theme.font(12), text_color=theme.TEXT_DIM,
            wraplength=700, anchor="w",
        ).pack(fill="x", padx=16, pady=(0, 12))

        # Codes list container
        self._codes_list_frame = ctk.CTkFrame(frame, fg_color="transparent")
        self._codes_list_frame.pack(fill="x", padx=16, pady=(0, 16))

        self._load_discount_codes()

    def _load_discount_codes(self):
        """Fetch discount codes from GAS and render them."""
        for w in self._codes_list_frame.winfo_children():
            w.destroy()

        def do_fetch():
            try:
                data = self.api.get("get_discount_codes")
                codes = data if isinstance(data, list) else data.get("codes", [])
                self.after(0, lambda: self._render_discount_codes(codes))
            except Exception as e:
                self.after(0, lambda: ctk.CTkLabel(
                    self._codes_list_frame,
                    text=f"\u274c Failed to load codes: {e}",
                    font=theme.font(12), text_color=theme.RED,
                ).pack(fill="x", pady=8))

        # Loading indicator
        ctk.CTkLabel(
            self._codes_list_frame, text="\u23f3 Loading discount codes...",
            font=theme.font(12), text_color=theme.TEXT_DIM,
        ).pack(fill="x", pady=16)

        import threading
        threading.Thread(target=do_fetch, daemon=True).start()

    def _render_discount_codes(self, codes: list):
        """Render a list of discount code cards."""
        for w in self._codes_list_frame.winfo_children():
            w.destroy()

        if not codes:
            ctk.CTkLabel(
                self._codes_list_frame,
                text="No discount codes yet. Click '+ New Code' to create one.",
                font=theme.font(13), text_color=theme.TEXT_DIM,
            ).pack(fill="x", pady=24)
            return

        for code_data in codes:
            card = ctk.CTkFrame(self._codes_list_frame, fg_color=theme.BG_CARD, corner_radius=10)
            card.pack(fill="x", pady=4)

            inner = ctk.CTkFrame(card, fg_color="transparent")
            inner.pack(fill="x", padx=16, pady=12)

            is_active = code_data.get("active", True)
            code_str = code_data.get("code", "")
            desc = code_data.get("description", "")
            pct = code_data.get("discountPercent", 0)
            fixed = code_data.get("discountFixed", 0)
            uses = code_data.get("usedCount", 0)
            max_uses = code_data.get("maxUses", 0)
            expires = code_data.get("expiresAt", "")
            source = code_data.get("source", "")

            # Status dot
            dot_color = theme.GREEN_LIGHT if is_active else theme.RED
            ctk.CTkLabel(
                inner, text="\u25cf", font=theme.font(16), text_color=dot_color,
            ).pack(side="left", padx=(0, 8))

            # Code name
            ctk.CTkLabel(
                inner, text=code_str,
                font=theme.font_bold(15), text_color=theme.TEXT_LIGHT,
            ).pack(side="left", padx=(0, 12))

            # Discount amount
            discount_text = f"{pct}% off" if pct else (f"\u00a3{fixed} off" if fixed else "")
            ctk.CTkLabel(
                inner, text=discount_text,
                font=theme.font_bold(13), text_color=theme.GREEN_LIGHT,
            ).pack(side="left", padx=(0, 12))

            # Uses
            uses_text = f"{uses}/{max_uses} uses" if max_uses else f"{uses} uses"
            ctk.CTkLabel(
                inner, text=uses_text,
                font=theme.font(11), text_color=theme.TEXT_DIM,
            ).pack(side="left", padx=(0, 12))

            # Source badge
            if source:
                ctk.CTkLabel(
                    inner, text=source,
                    font=theme.font(10), text_color=theme.TEXT_DIM,
                    fg_color=theme.BG_INPUT, corner_radius=4,
                ).pack(side="left", padx=(0, 8))

            # Expiry
            if expires:
                ctk.CTkLabel(
                    inner, text=f"Expires: {expires[:10]}",
                    font=theme.font(10), text_color=theme.AMBER,
                ).pack(side="left", padx=(0, 8))

            # Description on second line if exists
            if desc:
                ctk.CTkLabel(
                    card, text=desc,
                    font=theme.font(11), text_color=theme.TEXT_DIM, anchor="w",
                ).pack(fill="x", padx=16, pady=(0, 8))

            # Action buttons
            btn_frame = ctk.CTkFrame(inner, fg_color="transparent")
            btn_frame.pack(side="right")

            toggle_text = "\u23f8 Deactivate" if is_active else "\u25b6 Activate"
            toggle_color = theme.AMBER if is_active else theme.GREEN_PRIMARY
            ctk.CTkButton(
                btn_frame, text=toggle_text, width=100, height=28,
                fg_color=toggle_color, hover_color=theme.GREEN_DARK,
                corner_radius=6, font=theme.font(11),
                command=lambda c=code_str: self._toggle_discount(c),
            ).pack(side="left", padx=4)

            ctk.CTkButton(
                btn_frame, text="\U0001f5d1", width=32, height=28,
                fg_color="#7f1d1d", hover_color=theme.RED,
                text_color="#fca5a5", corner_radius=6,
                font=theme.font(12),
                command=lambda c=code_str: self._delete_discount(c),
            ).pack(side="left", padx=2)

    def _new_discount_code(self):
        """Open a dialog to create a new discount code."""
        dialog = ctk.CTkToplevel(self)
        dialog.title("New Discount Code")
        dialog.geometry("450x520")
        dialog.resizable(False, False)
        dialog.configure(fg_color=theme.BG_DARK)
        dialog.transient(self)
        dialog.grab_set()

        self.update_idletasks()
        px = self.winfo_rootx() + (self.winfo_width() - 450) // 2
        py = self.winfo_rooty() + 50
        dialog.geometry(f"+{max(px, 0)}+{max(py, 0)}")

        ctk.CTkLabel(
            dialog, text="\U0001f3f7\ufe0f Create Discount Code",
            font=theme.font_bold(16), text_color=theme.TEXT_LIGHT,
        ).pack(fill="x", padx=16, pady=(16, 12))

        form = ctk.CTkFrame(dialog, fg_color=theme.BG_CARD, corner_radius=12)
        form.pack(fill="x", padx=16, pady=4)
        form.grid_columnconfigure(1, weight=1)

        # Code
        ctk.CTkLabel(form, text="Code", font=theme.font(12), text_color=theme.TEXT_DIM).grid(
            row=0, column=0, padx=(16, 8), pady=8, sticky="e")
        code_entry = theme.create_entry(form, "e.g. SPRING10")
        code_entry.grid(row=0, column=1, padx=(0, 16), pady=8, sticky="ew")

        # Description
        ctk.CTkLabel(form, text="Description", font=theme.font(12), text_color=theme.TEXT_DIM).grid(
            row=1, column=0, padx=(16, 8), pady=8, sticky="e")
        desc_entry = theme.create_entry(form, "e.g. Spring newsletter 10% off")
        desc_entry.grid(row=1, column=1, padx=(0, 16), pady=8, sticky="ew")

        # Discount %
        ctk.CTkLabel(form, text="Discount %", font=theme.font(12), text_color=theme.TEXT_DIM).grid(
            row=2, column=0, padx=(16, 8), pady=8, sticky="e")
        pct_entry = theme.create_entry(form, "e.g. 10")
        pct_entry.grid(row=2, column=1, padx=(0, 16), pady=8, sticky="ew")

        # Discount fixed
        ctk.CTkLabel(form, text="Fixed \u00a3 off", font=theme.font(12), text_color=theme.TEXT_DIM).grid(
            row=3, column=0, padx=(16, 8), pady=8, sticky="e")
        fixed_entry = theme.create_entry(form, "e.g. 5 (use % OR fixed, not both)")
        fixed_entry.grid(row=3, column=1, padx=(0, 16), pady=8, sticky="ew")

        # Max uses
        ctk.CTkLabel(form, text="Max Uses", font=theme.font(12), text_color=theme.TEXT_DIM).grid(
            row=4, column=0, padx=(16, 8), pady=8, sticky="e")
        max_entry = theme.create_entry(form, "0 = unlimited")
        max_entry.grid(row=4, column=1, padx=(0, 16), pady=8, sticky="ew")

        # Expires
        ctk.CTkLabel(form, text="Expires", font=theme.font(12), text_color=theme.TEXT_DIM).grid(
            row=5, column=0, padx=(16, 8), pady=8, sticky="e")
        exp_entry = theme.create_entry(form, "YYYY-MM-DD (blank = no expiry)")
        exp_entry.grid(row=5, column=1, padx=(0, 16), pady=8, sticky="ew")

        # Source (for tracking)
        ctk.CTkLabel(form, text="Source", font=theme.font(12), text_color=theme.TEXT_DIM).grid(
            row=6, column=0, padx=(16, 8), pady=8, sticky="e")
        source_var = ctk.StringVar(value="newsletter")
        ctk.CTkOptionMenu(
            form, variable=source_var, values=["newsletter", "blog", "social", "manual"],
            fg_color=theme.BG_INPUT, button_color=theme.GREEN_PRIMARY,
            button_hover_color=theme.GREEN_DARK,
            dropdown_fg_color=theme.BG_CARD,
            corner_radius=8, height=32, font=theme.font(12),
        ).grid(row=6, column=1, padx=(0, 16), pady=8, sticky="ew")

        status_label = ctk.CTkLabel(
            dialog, text="", font=theme.font(12),
        )
        status_label.pack(fill="x", padx=16, pady=4)

        def do_create():
            code = code_entry.get().strip().upper()
            if not code:
                status_label.configure(text="\u274c Code is required", text_color=theme.RED)
                return

            status_label.configure(text="\u23f3 Creating...", text_color=theme.TEXT_DIM)

            def _create():
                try:
                    result = self.api.post("save_discount_code", {
                        "code": code,
                        "description": desc_entry.get().strip(),
                        "discountPercent": pct_entry.get().strip() or "0",
                        "discountFixed": fixed_entry.get().strip() or "0",
                        "maxUses": max_entry.get().strip() or "0",
                        "expiresAt": exp_entry.get().strip(),
                        "source": source_var.get(),
                    })
                    msg = result.get("message", "Created") if isinstance(result, dict) else "Created"
                    self.after(0, lambda: status_label.configure(
                        text=f"\u2705 {msg}", text_color=theme.GREEN_LIGHT))
                    self.after(500, lambda: (dialog.destroy(), self._load_discount_codes()))
                except Exception as e:
                    self.after(0, lambda: status_label.configure(
                        text=f"\u274c {e}", text_color=theme.RED))

            import threading
            threading.Thread(target=_create, daemon=True).start()

        btn_row = ctk.CTkFrame(dialog, fg_color="transparent")
        btn_row.pack(fill="x", padx=16, pady=(8, 16))

        theme.create_accent_button(
            btn_row, "\u2705 Create Code",
            command=do_create, width=140,
        ).pack(side="left")

        ctk.CTkButton(
            btn_row, text="Cancel", width=80,
            fg_color=theme.BG_CARD, hover_color=theme.RED,
            corner_radius=8, font=theme.font(12),
            command=dialog.destroy,
        ).pack(side="right")

    def _toggle_discount(self, code: str):
        """Toggle a discount code active/inactive."""
        import threading

        def _do():
            try:
                self.api.post("toggle_discount_code", {"code": code})
                self.after(0, self._load_discount_codes)
            except Exception as e:
                log.error(f"Toggle discount failed: {e}")

        threading.Thread(target=_do, daemon=True).start()

    def _delete_discount(self, code: str):
        """Delete a discount code after confirmation."""
        import threading

        def _do():
            try:
                self.api.post("delete_discount_code", {"code": code})
                self.after(0, self._load_discount_codes)
            except Exception as e:
                log.error(f"Delete discount failed: {e}")

        threading.Thread(target=_do, daemon=True).start()
