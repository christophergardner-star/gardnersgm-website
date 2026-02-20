"""
Content Studio Tab — Full AI content creation, customisation, and scheduling.

Chris can:
  - Write / multi-prompt blog posts and newsletters with full control
  - Set word count, tone, persona, topic, audience
  - Upload images for hero/inline use
  - Preview, edit, and publish content
  - Configure agent schedules and generation rules
  - Pull fresh testimonials from the website
  - Target new business verticals (hotels, commercial, residential)
"""

import customtkinter as ctk
import logging
import threading
import json
import os
import re
import webbrowser
from datetime import datetime
from tkinter import filedialog, messagebox

from ..ui import theme
from ..ui.components.kpi_card import KPICard
from .. import config
from .. import llm

log = logging.getLogger("ggm.content_studio")


class ContentStudioTab(ctk.CTkFrame):
    """Content Studio — advanced AI content creation and agent management."""

    def __init__(self, parent, db, sync, api, app_window, **kwargs):
        super().__init__(parent, fg_color=theme.BG_DARK, **kwargs)

        self.db = db
        self.sync = sync
        self.api = api
        self.app = app_window
        self._agent_scheduler = None

        self._current_sub = None
        self._sub_buttons = {}
        self._sub_frames = {}
        self._kpi_cards = {}

        # Content state
        self._selected_image_path = None
        self._generated_content = {}
        self._generation_thread = None

        self.grid_columnconfigure(0, weight=1)
        self.grid_rowconfigure(1, weight=1)

        self._build_sub_tabs()
        self._build_panels()
        self._switch_sub("blog_studio")

    # ------------------------------------------------------------------
    # Sub-Tabs
    # ------------------------------------------------------------------
    def _build_sub_tabs(self):
        tab_bar = ctk.CTkFrame(self, fg_color=theme.BG_CARD, height=44, corner_radius=0)
        tab_bar.grid(row=0, column=0, sticky="ew")
        tab_bar.grid_columnconfigure(10, weight=1)

        tabs = [
            ("blog_studio",       "📝 Blog Studio"),
            ("newsletter_studio", "📨 Newsletter Studio"),
            ("agent_config",      "🤖 Agent Config"),
            ("content_library",   "📚 Content Library"),
        ]

        for i, (key, text) in enumerate(tabs):
            btn = ctk.CTkButton(
                tab_bar, text=text, font=theme.font(13),
                fg_color="transparent", hover_color=theme.BG_CARD_HOVER,
                text_color=theme.TEXT_DIM, corner_radius=0,
                height=40, width=180,
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
        self._build_blog_studio()
        self._build_newsletter_studio()
        self._build_agent_config()
        self._build_content_library()

    def _refresh_subtab(self, key: str):
        try:
            if key == "blog_studio":
                self._refresh_blog_studio()
            elif key == "newsletter_studio":
                self._refresh_newsletter_studio()
            elif key == "agent_config":
                self._refresh_agent_config()
            elif key == "content_library":
                self._refresh_content_library()
        except Exception as e:
            log.warning(f"Content Studio refresh error ({key}): {e}")

    def refresh(self):
        if self._current_sub:
            self._refresh_subtab(self._current_sub)

    # ==================================================================
    # BLOG STUDIO
    # ==================================================================
    def _build_blog_studio(self):
        frame = ctk.CTkScrollableFrame(self, fg_color="transparent")
        self._sub_frames["blog_studio"] = frame

        # ── Header ──
        header = ctk.CTkFrame(frame, fg_color="transparent")
        header.pack(fill="x", padx=16, pady=(16, 8))
        header.grid_columnconfigure(1, weight=1)

        ctk.CTkLabel(
            header, text="📝 Blog Studio",
            font=theme.font_bold(18), text_color=theme.TEXT_LIGHT, anchor="w",
        ).grid(row=0, column=0, sticky="w")

        self._blog_llm_status = ctk.CTkLabel(
            header, text="", font=theme.font(11), text_color=theme.TEXT_DIM,
        )
        self._blog_llm_status.grid(row=0, column=1, sticky="e", padx=16)

        ctk.CTkLabel(
            frame,
            text="Create blog posts with full control over topic, persona, length, images, and tone. "
                 "Multi-prompt the AI until you're happy, then publish.",
            font=theme.font(12), text_color=theme.TEXT_DIM, anchor="w",
            wraplength=800,
        ).pack(fill="x", padx=16, pady=(0, 12))

        # ── Configuration Card ──
        config_card = ctk.CTkFrame(frame, fg_color=theme.BG_CARD, corner_radius=12)
        config_card.pack(fill="x", padx=16, pady=(0, 8))

        ctk.CTkLabel(
            config_card, text="🎛️ Content Settings",
            font=theme.font_bold(14), text_color=theme.TEXT_LIGHT, anchor="w",
        ).pack(fill="x", padx=16, pady=(14, 8))

        # Row 1: Topic + Persona
        row1 = ctk.CTkFrame(config_card, fg_color="transparent")
        row1.pack(fill="x", padx=16, pady=(0, 6))
        row1.grid_columnconfigure(1, weight=1)

        ctk.CTkLabel(row1, text="Topic:", font=theme.font(12),
                     text_color=theme.TEXT_DIM).grid(row=0, column=0, padx=(0, 8), sticky="w")
        self._blog_topic = theme.create_entry(row1, placeholder="e.g. Spring lawn care tips for Cornwall gardens")
        self._blog_topic.grid(row=0, column=1, sticky="ew", padx=(0, 16))

        ctk.CTkLabel(row1, text="Persona:", font=theme.font(12),
                     text_color=theme.TEXT_DIM).grid(row=0, column=2, padx=(0, 8), sticky="w")
        persona_options = ["Auto (best match)", "Wilson Treloar", "Tamsin Penrose",
                           "Jago Rowe", "Morwenna Vyvyan", "Dave Kitto"]
        self._blog_persona = ctk.CTkComboBox(row1, values=persona_options,
                                              width=180, font=theme.font(12))
        self._blog_persona.set("Auto (best match)")
        self._blog_persona.grid(row=0, column=3, sticky="e")

        # Row 2: Word count + Target audience + Category
        row2 = ctk.CTkFrame(config_card, fg_color="transparent")
        row2.pack(fill="x", padx=16, pady=(0, 6))

        ctk.CTkLabel(row2, text="Words:", font=theme.font(12),
                     text_color=theme.TEXT_DIM).pack(side="left", padx=(0, 8))
        self._blog_words = ctk.CTkComboBox(
            row2, values=["600", "800", "1000", "1200", "1500", "2000"],
            width=100, font=theme.font(12),
        )
        self._blog_words.set("1000")
        self._blog_words.pack(side="left", padx=(0, 16))

        ctk.CTkLabel(row2, text="Audience:", font=theme.font(12),
                     text_color=theme.TEXT_DIM).pack(side="left", padx=(0, 8))
        self._blog_audience = ctk.CTkComboBox(
            row2, values=["Residential homeowners", "Hotels & hospitality",
                          "Commercial property", "Letting agents", "All audiences"],
            width=200, font=theme.font(12),
        )
        self._blog_audience.set("Residential homeowners")
        self._blog_audience.pack(side="left", padx=(0, 16))

        ctk.CTkLabel(row2, text="Category:", font=theme.font(12),
                     text_color=theme.TEXT_DIM).pack(side="left", padx=(0, 8))
        self._blog_category = ctk.CTkComboBox(
            row2, values=["Auto-detect", "Lawn Care", "Seasonal Guide", "Cornwall Life",
                          "DIY Tips", "Wildlife", "Commercial", "Business Tips"],
            width=160, font=theme.font(12),
        )
        self._blog_category.set("Auto-detect")
        self._blog_category.pack(side="left")

        # Row 3: Extra prompt / instructions
        ctk.CTkLabel(
            config_card, text="Extra Instructions (optional — guide the AI further):",
            font=theme.font(12), text_color=theme.TEXT_DIM, anchor="w",
        ).pack(fill="x", padx=16, pady=(4, 2))

        self._blog_extra = ctk.CTkTextbox(
            config_card, height=60, fg_color=theme.BG_INPUT,
            font=theme.font(12), text_color=theme.TEXT_LIGHT, corner_radius=8,
        )
        self._blog_extra.pack(fill="x", padx=16, pady=(0, 8))

        # Row 3b: Include discount code checkbox
        self._blog_discount_var = ctk.BooleanVar(value=False)
        ctk.CTkCheckBox(
            config_card, text="🏷️ Include active discount code",
            variable=self._blog_discount_var,
            fg_color=theme.GREEN_PRIMARY, hover_color=theme.GREEN_DARK,
            font=theme.font(12), text_color=theme.TEXT_DIM,
        ).pack(fill="x", padx=16, pady=(0, 8))

        # Row 4: Image upload
        img_row = ctk.CTkFrame(config_card, fg_color="transparent")
        img_row.pack(fill="x", padx=16, pady=(0, 14))

        theme.create_outline_button(
            img_row, "📷 Upload Image",
            command=self._upload_blog_image, width=140,
        ).pack(side="left", padx=(0, 12))

        self._blog_img_label = ctk.CTkLabel(
            img_row, text="No image selected (Pexels will auto-fetch)",
            font=theme.font(11), text_color=theme.TEXT_DIM,
        )
        self._blog_img_label.pack(side="left")

        theme.create_outline_button(
            img_row, "🔍 Search Pexels",
            command=self._search_pexels_blog, width=130,
        ).pack(side="right")

        # ── Action Buttons ──
        action_row = ctk.CTkFrame(frame, fg_color="transparent")
        action_row.pack(fill="x", padx=16, pady=(0, 8))

        self._blog_generate_btn = theme.create_accent_button(
            action_row, "🤖 Generate Blog Post",
            command=self._generate_blog, width=200,
        )
        self._blog_generate_btn.pack(side="left", padx=(0, 8))

        theme.create_outline_button(
            action_row, "🔄 Regenerate",
            command=self._regenerate_blog, width=120,
        ).pack(side="left", padx=(0, 8))

        theme.create_accent_button(
            action_row, "📤 Publish",
            command=self._publish_blog, width=100,
        ).pack(side="left", padx=(0, 8))

        theme.create_outline_button(
            action_row, "💾 Save Draft",
            command=self._save_blog_draft, width=100,
        ).pack(side="left", padx=(0, 8))

        self._blog_status = ctk.CTkLabel(
            action_row, text="", font=theme.font(12), text_color=theme.TEXT_DIM,
        )
        self._blog_status.pack(side="left", padx=16)

        # ── Preview/Output Area ──
        preview_card = ctk.CTkFrame(frame, fg_color=theme.BG_CARD, corner_radius=12)
        preview_card.pack(fill="x", padx=16, pady=(0, 8))

        ctk.CTkLabel(
            preview_card, text="📄 Generated Content",
            font=theme.font_bold(14), text_color=theme.TEXT_LIGHT, anchor="w",
        ).pack(fill="x", padx=16, pady=(14, 4))

        # Title field
        title_row = ctk.CTkFrame(preview_card, fg_color="transparent")
        title_row.pack(fill="x", padx=16, pady=(0, 4))
        title_row.grid_columnconfigure(1, weight=1)

        ctk.CTkLabel(title_row, text="Title:", font=theme.font_bold(12),
                     text_color=theme.TEXT_DIM).grid(row=0, column=0, padx=(0, 8), sticky="w")
        self._blog_title_entry = theme.create_entry(title_row, placeholder="Blog title will appear here...")
        self._blog_title_entry.grid(row=0, column=1, sticky="ew")

        # Excerpt
        excerpt_row = ctk.CTkFrame(preview_card, fg_color="transparent")
        excerpt_row.pack(fill="x", padx=16, pady=(0, 4))
        excerpt_row.grid_columnconfigure(1, weight=1)

        ctk.CTkLabel(excerpt_row, text="Excerpt:", font=theme.font_bold(12),
                     text_color=theme.TEXT_DIM).grid(row=0, column=0, padx=(0, 8), sticky="w")
        self._blog_excerpt_entry = theme.create_entry(excerpt_row, placeholder="Short summary...")
        self._blog_excerpt_entry.grid(row=0, column=1, sticky="ew")

        # Content editor
        self._blog_content = ctk.CTkTextbox(
            preview_card, height=400, fg_color=theme.BG_INPUT,
            font=theme.font(13), text_color=theme.TEXT_LIGHT, corner_radius=8,
        )
        self._blog_content.pack(fill="x", padx=16, pady=(4, 8))

        # Tags + social
        tags_row = ctk.CTkFrame(preview_card, fg_color="transparent")
        tags_row.pack(fill="x", padx=16, pady=(0, 14))
        tags_row.grid_columnconfigure(1, weight=1)
        tags_row.grid_columnconfigure(3, weight=1)

        ctk.CTkLabel(tags_row, text="Tags:", font=theme.font(12),
                     text_color=theme.TEXT_DIM).grid(row=0, column=0, padx=(0, 8))
        self._blog_tags_entry = theme.create_entry(tags_row, placeholder="comma,separated,tags")
        self._blog_tags_entry.grid(row=0, column=1, sticky="ew", padx=(0, 16))

        ctk.CTkLabel(tags_row, text="Social:", font=theme.font(12),
                     text_color=theme.TEXT_DIM).grid(row=0, column=2, padx=(0, 8))
        self._blog_social_entry = theme.create_entry(tags_row, placeholder="Social media teaser...")
        self._blog_social_entry.grid(row=0, column=3, sticky="ew")

    def _refresh_blog_studio(self):
        """Refresh LLM status."""
        def check():
            status = llm.get_status()
            if status["available"]:
                txt = f"✅ {status['provider']}  •  {status['model']}"
                col = theme.GREEN_LIGHT
            else:
                txt = "⚠️ No LLM available"
                col = theme.RED
            try:
                self._blog_llm_status.configure(text=txt, text_color=col)
            except Exception:
                pass
        threading.Thread(target=check, daemon=True).start()

    def _upload_blog_image(self):
        """Open file dialog to upload a hero image."""
        path = filedialog.askopenfilename(
            title="Select Blog Hero Image",
            filetypes=[
                ("Images", "*.jpg *.jpeg *.png *.webp *.avif"),
                ("All files", "*.*"),
            ],
        )
        if path:
            self._selected_image_path = path
            name = os.path.basename(path)
            self._blog_img_label.configure(
                text=f"📷 {name}", text_color=theme.GREEN_LIGHT,
            )

    def _search_pexels_blog(self):
        """Search Pexels for a stock image based on the topic."""
        topic = self._blog_topic.get().strip()
        if not topic:
            messagebox.showwarning("No Topic", "Enter a topic first to search for images.")
            return

        self._blog_status.configure(text="🔍 Searching Pexels...", text_color=theme.AMBER)

        def do_search():
            try:
                from ..agents import fetch_pexels_image
                result = fetch_pexels_image(topic)
                url = result.get("url", "")
                photographer = result.get("photographer", "")
                if url:
                    self._selected_image_path = url  # Store URL as image path
                    try:
                        self._blog_img_label.configure(
                            text=f"📷 Pexels: {photographer} — {url[:60]}...",
                            text_color=theme.GREEN_LIGHT,
                        )
                        self._blog_status.configure(
                            text=f"✅ Image found: {photographer}",
                            text_color=theme.GREEN_LIGHT,
                        )
                    except Exception:
                        pass
                else:
                    try:
                        self._blog_status.configure(
                            text="⚠️ No Pexels image found",
                            text_color=theme.AMBER,
                        )
                    except Exception:
                        pass
            except Exception as e:
                log.warning(f"Pexels search error: {e}")
                try:
                    self._blog_status.configure(
                        text=f"❌ Pexels error: {e}",
                        text_color=theme.RED,
                    )
                except Exception:
                    pass

        threading.Thread(target=do_search, daemon=True).start()

    def _generate_blog(self):
        """Generate a blog post with the configured settings."""
        topic = self._blog_topic.get().strip()
        if not topic:
            messagebox.showwarning("No Topic", "Please enter a blog topic.")
            return

        self._blog_generate_btn.configure(state="disabled")
        self._blog_status.configure(text="🤖 Generating blog post...", text_color=theme.AMBER)

        # Gather settings
        persona_text = self._blog_persona.get()
        persona_map = {
            "Wilson Treloar": "wilson", "Tamsin Penrose": "tamsin",
            "Jago Rowe": "jago", "Morwenna Vyvyan": "morwenna",
            "Dave Kitto": "dave",
        }
        persona_key = persona_map.get(persona_text, None)

        try:
            word_count = int(self._blog_words.get())
        except (ValueError, TypeError):
            word_count = 1000

        audience = self._blog_audience.get()
        category = self._blog_category.get()
        extra = self._blog_extra.get("1.0", "end").strip()
        include_discount = self._blog_discount_var.get()

        def do_generate():
            try:
                from ..content_writer import generate_blog_post
                # Build an enhanced topic string with extra context
                enhanced_topic = topic
                if audience and audience != "Residential homeowners":
                    enhanced_topic += f"\n\nTARGET AUDIENCE: {audience} — tailor the advice, "
                    enhanced_topic += "examples, and language specifically for this audience. "
                    if "hotel" in audience.lower() or "hospitality" in audience.lower():
                        enhanced_topic += ("Think about hotel grounds, first impressions for guests, "
                                           "kerb appeal for B&Bs, holiday lets with gardens, etc.")
                    elif "commercial" in audience.lower():
                        enhanced_topic += ("Think about business parks, office grounds, retail frontage, "
                                           "car park landscaping, commercial property kerb appeal.")
                    elif "letting" in audience.lower():
                        enhanced_topic += ("Think about low-maintenance gardens for rental properties, "
                                           "tenant-proof landscaping, property value through garden care.")

                if extra:
                    enhanced_topic += f"\n\nADDITIONAL INSTRUCTIONS FROM CHRIS: {extra}"

                # Inject active discount codes if requested
                if include_discount:
                    try:
                        codes_data = self.api.get("get_discount_codes")
                        codes = codes_data if isinstance(codes_data, list) else codes_data.get("codes", [])
                        active_codes = [c for c in codes
                                        if str(c.get("active", "")).lower() in ("true", "yes", "1")]
                        if active_codes:
                            enhanced_topic += "\n\nACTIVE DISCOUNT CODE TO INCLUDE IN THIS POST:\n"
                            for c in active_codes:
                                code = c.get("code", "")
                                pct = c.get("discountPercent", 0)
                                fixed = c.get("discountFixed", 0)
                                desc = c.get("description", "")
                                expires = c.get("expiresAt", "")
                                amount = f"{pct}% off" if pct else (f"\u00a3{fixed} off" if fixed else "discount")
                                exp_text = f" (expires {expires[:10]})" if expires else ""
                                enhanced_topic += f"- Code: {code} \u2014 {amount}{exp_text}"
                                if desc:
                                    enhanced_topic += f" \u2014 {desc}"
                                enhanced_topic += "\n"
                            enhanced_topic += ("Mention this offer naturally within the blog post. "
                                               "Tell readers to enter the code on the booking form at "
                                               "www.gardnersgm.co.uk/booking to claim their discount.\n")
                    except Exception:
                        pass

                result = generate_blog_post(
                    topic=enhanced_topic,
                    word_count=word_count,
                    persona_key=persona_key,
                )

                if result.get("error"):
                    try:
                        self._blog_status.configure(
                            text=f"❌ {result['error'][:80]}",
                            text_color=theme.RED,
                        )
                        self._blog_generate_btn.configure(state="normal")
                    except Exception:
                        pass
                    return

                # Override category if user selected one
                if category and category != "Auto-detect":
                    result["category"] = category

                self._generated_content = result

                # Populate the preview fields
                try:
                    self._blog_title_entry.delete(0, "end")
                    self._blog_title_entry.insert(0, result.get("title", ""))

                    self._blog_excerpt_entry.delete(0, "end")
                    self._blog_excerpt_entry.insert(0, result.get("excerpt", ""))

                    self._blog_content.delete("1.0", "end")
                    self._blog_content.insert("1.0", result.get("content", ""))

                    self._blog_tags_entry.delete(0, "end")
                    self._blog_tags_entry.insert(0, result.get("tags", ""))

                    self._blog_social_entry.delete(0, "end")
                    self._blog_social_entry.insert(0, result.get("social", ""))

                    author = result.get("author", "Chris")
                    self._blog_status.configure(
                        text=f"✅ Generated by {author} — {word_count} word target",
                        text_color=theme.GREEN_LIGHT,
                    )
                    self._blog_generate_btn.configure(state="normal")
                except Exception:
                    pass
            except Exception as e:
                log.error(f"Blog generation error: {e}")
                try:
                    self._blog_status.configure(
                        text=f"❌ Error: {e}",
                        text_color=theme.RED,
                    )
                    self._blog_generate_btn.configure(state="normal")
                except Exception:
                    pass

        self._generation_thread = threading.Thread(target=do_generate, daemon=True)
        self._generation_thread.start()

    def _regenerate_blog(self):
        """Regenerate with same settings (acts as multi-prompt)."""
        self._generate_blog()

    def _publish_blog(self):
        """Publish the blog post to the website."""
        title = self._blog_title_entry.get().strip()
        content = self._blog_content.get("1.0", "end").strip()
        if not title or not content:
            messagebox.showwarning("No Content", "Generate or write content first.")
            return

        excerpt = self._blog_excerpt_entry.get().strip()
        tags = self._blog_tags_entry.get().strip()
        category = self._blog_category.get()
        if category == "Auto-detect":
            category = self._generated_content.get("category", "DIY Tips")
        author = self._generated_content.get("author", "Chris")
        image_url = self._selected_image_path or ""

        def do_publish():
            try:
                blog_data = {
                    "title": title,
                    "content": content,
                    "excerpt": excerpt or content[:200].rstrip() + "...",
                    "category": category,
                    "author": author,
                    "status": "Published",
                    "tags": tags,
                    "image_url": image_url,
                }
                self.db.save_blog_post(blog_data)

                # Push to website via GAS
                try:
                    self.api.post("save_blog_post", {
                        "title": title,
                        "content": content,
                        "excerpt": excerpt or content[:200].rstrip() + "...",
                        "category": category,
                        "author": author,
                        "status": "Published",
                        "tags": tags,
                        "imageUrl": image_url,
                    })
                except Exception as e:
                    log.warning(f"GAS push failed: {e}")

                # Auto-post to Facebook
                try:
                    from ..social_poster import post_blog_to_facebook, is_facebook_configured
                    if is_facebook_configured():
                        slug = re.sub(r'[^a-z0-9 ]', '', title.lower()).strip().replace("  ", " ").replace(" ", "-")[:60]
                        blog_url = f"https://www.gardnersgm.co.uk/blog.html#{slug}"
                        post_blog_to_facebook(
                            title=title, excerpt=excerpt,
                            blog_url=blog_url, image_url=image_url, tags=tags,
                        )
                except Exception:
                    pass

                self.db.add_notification(
                    ntype="content",
                    title=f"✏️ Blog Published: {title}",
                    message=f"Written by {author} via Content Studio.",
                    icon="✏️",
                )

                try:
                    self._blog_status.configure(
                        text=f"✅ Published: {title[:50]}",
                        text_color=theme.GREEN_LIGHT,
                    )
                except Exception:
                    pass
            except Exception as e:
                log.error(f"Blog publish error: {e}")
                try:
                    self._blog_status.configure(
                        text=f"❌ Publish error: {e}",
                        text_color=theme.RED,
                    )
                except Exception:
                    pass

        threading.Thread(target=do_publish, daemon=True).start()

    def _save_blog_draft(self):
        """Save as draft without publishing."""
        title = self._blog_title_entry.get().strip()
        content = self._blog_content.get("1.0", "end").strip()
        if not title or not content:
            messagebox.showwarning("No Content", "Generate or write content first.")
            return

        excerpt = self._blog_excerpt_entry.get().strip()
        tags = self._blog_tags_entry.get().strip()
        category = self._blog_category.get()
        if category == "Auto-detect":
            category = self._generated_content.get("category", "DIY Tips")
        author = self._generated_content.get("author", "Chris")
        image_url = self._selected_image_path or ""

        blog_data = {
            "title": title,
            "content": content,
            "excerpt": excerpt or content[:200].rstrip() + "...",
            "category": category,
            "author": author,
            "status": "Draft",
            "tags": tags,
            "image_url": image_url,
        }
        self.db.save_blog_post(blog_data)
        self._blog_status.configure(
            text=f"💾 Draft saved: {title[:50]}",
            text_color=theme.GREEN_LIGHT,
        )

    # ==================================================================
    # NEWSLETTER STUDIO
    # ==================================================================
    def _build_newsletter_studio(self):
        frame = ctk.CTkScrollableFrame(self, fg_color="transparent")
        self._sub_frames["newsletter_studio"] = frame

        # Header
        header = ctk.CTkFrame(frame, fg_color="transparent")
        header.pack(fill="x", padx=16, pady=(16, 8))
        header.grid_columnconfigure(1, weight=1)

        ctk.CTkLabel(
            header, text="📨 Newsletter Studio",
            font=theme.font_bold(18), text_color=theme.TEXT_LIGHT, anchor="w",
        ).grid(row=0, column=0, sticky="w")

        self._nl_llm_status = ctk.CTkLabel(
            header, text="", font=theme.font(11), text_color=theme.TEXT_DIM,
        )
        self._nl_llm_status.grid(row=0, column=1, sticky="e", padx=16)

        ctk.CTkLabel(
            frame,
            text="Create professional newsletters written as Chris, founder of GGM. "
                 "Set the theme, audience, talking points, and images. Refine until perfect.",
            font=theme.font(12), text_color=theme.TEXT_DIM, anchor="w",
            wraplength=800,
        ).pack(fill="x", padx=16, pady=(0, 12))

        # ── Settings Card ──
        config_card = ctk.CTkFrame(frame, fg_color=theme.BG_CARD, corner_radius=12)
        config_card.pack(fill="x", padx=16, pady=(0, 8))

        ctk.CTkLabel(
            config_card, text="🎛️ Newsletter Settings",
            font=theme.font_bold(14), text_color=theme.TEXT_LIGHT, anchor="w",
        ).pack(fill="x", padx=16, pady=(14, 8))

        # Row 1: Theme + Audience
        row1 = ctk.CTkFrame(config_card, fg_color="transparent")
        row1.pack(fill="x", padx=16, pady=(0, 6))
        row1.grid_columnconfigure(1, weight=1)

        ctk.CTkLabel(row1, text="Theme:", font=theme.font(12),
                     text_color=theme.TEXT_DIM).grid(row=0, column=0, padx=(0, 8), sticky="w")
        self._nl_theme = theme.create_entry(
            row1, placeholder="e.g. Spring prep, hotel grounds care, February garden update",
        )
        self._nl_theme.grid(row=0, column=1, sticky="ew", padx=(0, 16))

        ctk.CTkLabel(row1, text="Audience:", font=theme.font(12),
                     text_color=theme.TEXT_DIM).grid(row=0, column=2, padx=(0, 8), sticky="w")
        self._nl_audience = ctk.CTkComboBox(
            row1, values=["All subscribers", "Paid subscribers", "Free subscribers",
                          "Hotels & hospitality", "Commercial leads", "Residential only"],
            width=180, font=theme.font(12),
        )
        self._nl_audience.set("All subscribers")
        self._nl_audience.grid(row=0, column=3, sticky="e")

        # Row 2: Length + Include promo + Pull testimonials
        row2 = ctk.CTkFrame(config_card, fg_color="transparent")
        row2.pack(fill="x", padx=16, pady=(0, 6))

        ctk.CTkLabel(row2, text="Length:", font=theme.font(12),
                     text_color=theme.TEXT_DIM).pack(side="left", padx=(0, 8))
        self._nl_length = ctk.CTkComboBox(
            row2, values=["Short (300 words)", "Medium (500 words)", "Long (800 words)",
                          "Detailed (1200 words)"],
            width=180, font=theme.font(12),
        )
        self._nl_length.set("Medium (500 words)")
        self._nl_length.pack(side="left", padx=(0, 16))

        self._nl_promo_var = ctk.BooleanVar(value=False)
        ctk.CTkCheckBox(
            row2, text="Include promotion", variable=self._nl_promo_var,
            font=theme.font(12), text_color=theme.TEXT_DIM,
            fg_color=theme.GREEN_PRIMARY, hover_color=theme.GREEN_DARK,
        ).pack(side="left", padx=(0, 16))

        self._nl_testimonials_var = ctk.BooleanVar(value=False)
        ctk.CTkCheckBox(
            row2, text="Include testimonials", variable=self._nl_testimonials_var,
            font=theme.font(12), text_color=theme.TEXT_DIM,
            fg_color=theme.GREEN_PRIMARY, hover_color=theme.GREEN_DARK,
        ).pack(side="left", padx=(0, 16))

        self._nl_leads_var = ctk.BooleanVar(value=False)
        ctk.CTkCheckBox(
            row2, text="Business leads focus", variable=self._nl_leads_var,
            font=theme.font(12), text_color=theme.TEXT_DIM,
            fg_color=theme.GREEN_PRIMARY, hover_color=theme.GREEN_DARK,
        ).pack(side="left")

        # Row 3: Talking points
        ctk.CTkLabel(
            config_card, text="Talking Points (what you want covered — be specific):",
            font=theme.font(12), text_color=theme.TEXT_DIM, anchor="w",
        ).pack(fill="x", padx=16, pady=(4, 2))

        self._nl_talking_points = ctk.CTkTextbox(
            config_card, height=80, fg_color=theme.BG_INPUT,
            font=theme.font(12), text_color=theme.TEXT_LIGHT, corner_radius=8,
        )
        self._nl_talking_points.pack(fill="x", padx=16, pady=(0, 8))

        # Row 4: Image upload
        img_row = ctk.CTkFrame(config_card, fg_color="transparent")
        img_row.pack(fill="x", padx=16, pady=(0, 14))

        theme.create_outline_button(
            img_row, "📷 Upload Image",
            command=self._upload_nl_image, width=140,
        ).pack(side="left", padx=(0, 12))

        self._nl_img_label = ctk.CTkLabel(
            img_row, text="No image selected (Pexels will auto-fetch)",
            font=theme.font(11), text_color=theme.TEXT_DIM,
        )
        self._nl_img_label.pack(side="left")

        theme.create_outline_button(
            img_row, "🔍 Search Pexels",
            command=self._search_pexels_nl, width=130,
        ).pack(side="right")

        # ── Action Buttons ──
        action_row = ctk.CTkFrame(frame, fg_color="transparent")
        action_row.pack(fill="x", padx=16, pady=(0, 8))

        self._nl_generate_btn = theme.create_accent_button(
            action_row, "🤖 Generate Newsletter",
            command=self._generate_newsletter, width=200,
        )
        self._nl_generate_btn.pack(side="left", padx=(0, 8))

        theme.create_outline_button(
            action_row, "🔄 Regenerate",
            command=self._generate_newsletter, width=120,
        ).pack(side="left", padx=(0, 8))

        theme.create_accent_button(
            action_row, "📤 Send to Subscribers",
            command=self._send_newsletter, width=180,
        ).pack(side="left", padx=(0, 8))

        theme.create_outline_button(
            action_row, "💾 Save Draft",
            command=self._save_nl_draft, width=100,
        ).pack(side="left", padx=(0, 8))

        self._nl_status = ctk.CTkLabel(
            action_row, text="", font=theme.font(12), text_color=theme.TEXT_DIM,
        )
        self._nl_status.pack(side="left", padx=16)

        # ── Preview/Output ──
        preview_card = ctk.CTkFrame(frame, fg_color=theme.BG_CARD, corner_radius=12)
        preview_card.pack(fill="x", padx=16, pady=(0, 8))

        ctk.CTkLabel(
            preview_card, text="📄 Newsletter Preview",
            font=theme.font_bold(14), text_color=theme.TEXT_LIGHT, anchor="w",
        ).pack(fill="x", padx=16, pady=(14, 4))

        # Subject line
        subj_row = ctk.CTkFrame(preview_card, fg_color="transparent")
        subj_row.pack(fill="x", padx=16, pady=(0, 4))
        subj_row.grid_columnconfigure(1, weight=1)

        ctk.CTkLabel(subj_row, text="Subject:", font=theme.font_bold(12),
                     text_color=theme.TEXT_DIM).grid(row=0, column=0, padx=(0, 8), sticky="w")
        self._nl_subject_entry = theme.create_entry(subj_row, placeholder="Newsletter subject line...")
        self._nl_subject_entry.grid(row=0, column=1, sticky="ew")

        # Content editor
        self._nl_content = ctk.CTkTextbox(
            preview_card, height=400, fg_color=theme.BG_INPUT,
            font=theme.font(13), text_color=theme.TEXT_LIGHT, corner_radius=8,
        )
        self._nl_content.pack(fill="x", padx=16, pady=(4, 14))

    def _refresh_newsletter_studio(self):
        """Refresh LLM status."""
        def check():
            status = llm.get_status()
            if status["available"]:
                txt = f"✅ {status['provider']}  •  {status['model']}"
                col = theme.GREEN_LIGHT
            else:
                txt = "⚠️ No LLM available"
                col = theme.RED
            try:
                self._nl_llm_status.configure(text=txt, text_color=col)
            except Exception:
                pass
        threading.Thread(target=check, daemon=True).start()

    def _upload_nl_image(self):
        path = filedialog.askopenfilename(
            title="Select Newsletter Hero Image",
            filetypes=[("Images", "*.jpg *.jpeg *.png *.webp *.avif"), ("All", "*.*")],
        )
        if path:
            self._nl_selected_image = path
            self._nl_img_label.configure(
                text=f"📷 {os.path.basename(path)}", text_color=theme.GREEN_LIGHT,
            )

    def _search_pexels_nl(self):
        theme_text = self._nl_theme.get().strip()
        if not theme_text:
            messagebox.showwarning("No Theme", "Enter a theme first.")
            return

        self._nl_status.configure(text="🔍 Searching Pexels...", text_color=theme.AMBER)

        def do_search():
            try:
                from ..agents import fetch_pexels_image
                result = fetch_pexels_image(theme_text)
                url = result.get("url", "")
                if url:
                    self._nl_selected_image = url
                    try:
                        self._nl_img_label.configure(
                            text=f"📷 Pexels: {result.get('photographer', '')} — {url[:60]}...",
                            text_color=theme.GREEN_LIGHT,
                        )
                        self._nl_status.configure(text="✅ Image found", text_color=theme.GREEN_LIGHT)
                    except Exception:
                        pass
                else:
                    try:
                        self._nl_status.configure(text="⚠️ No image found", text_color=theme.AMBER)
                    except Exception:
                        pass
            except Exception as e:
                try:
                    self._nl_status.configure(text=f"❌ {e}", text_color=theme.RED)
                except Exception:
                    pass

        threading.Thread(target=do_search, daemon=True).start()

    def _generate_newsletter(self):
        """Generate a newsletter with the configured settings."""
        self._nl_generate_btn.configure(state="disabled")
        self._nl_status.configure(text="🤖 Generating newsletter...", text_color=theme.AMBER)

        theme_text = self._nl_theme.get().strip()
        audience_text = self._nl_audience.get()
        length_text = self._nl_length.get()
        talking_points = self._nl_talking_points.get("1.0", "end").strip()
        include_promo = self._nl_promo_var.get()
        include_testimonials = self._nl_testimonials_var.get()
        leads_focus = self._nl_leads_var.get()

        # Parse word count from length option
        length_map = {"Short": 300, "Medium": 500, "Long": 800, "Detailed": 1200}
        word_target = 500
        for key, val in length_map.items():
            if key in length_text:
                word_target = val
                break

        # Map audience
        audience_map = {
            "All subscribers": "all", "Paid subscribers": "paid",
            "Free subscribers": "free",
        }
        audience = audience_map.get(audience_text, "all")

        def do_generate():
            try:
                from ..content_writer import BRAND_VOICE, _fetch_cornwall_weather, _sanitise, _current_season, NEWSLETTER_THEMES

                now = datetime.now()
                month_names = ["January", "February", "March", "April", "May", "June",
                               "July", "August", "September", "October", "November", "December"]
                month = month_names[now.month - 1]
                theme_data = NEWSLETTER_THEMES.get(now.month, NEWSLETTER_THEMES[1])
                season = _current_season()
                weather = _fetch_cornwall_weather()

                # Get recent blog posts for cross-promotion
                blog_section = ""
                try:
                    posts = self.db.get_blog_posts(limit=5)
                    if posts:
                        titles = [p.get("title", "") for p in posts if p.get("title")][:3]
                        if titles:
                            blog_section = ("\nRecent blog posts to mention (link to www.gardnersgm.co.uk/blog):\n"
                                            + "\n".join(f"- {t}" for t in titles))
                except Exception:
                    pass

                # Get testimonials if requested
                testimonial_section = ""
                if include_testimonials:
                    try:
                        testimonials = self.db.get_testimonials(limit=3)
                        if testimonials:
                            testimonial_section = "\nRecent customer testimonials to include:\n"
                            for t in testimonials:
                                name = t.get("customer_name", "A customer")
                                text = t.get("text", t.get("content", ""))[:200]
                                testimonial_section += f'- "{text}" — {name}\n'
                    except Exception:
                        pass

                # Business leads section
                leads_section = ""
                if leads_focus:
                    leads_section = (
                        "\nBUSINESS FOCUS: This newsletter should also appeal to commercial clients. "
                        "Include a section about our services for hotels, B&Bs, holiday lets, and "
                        "commercial properties in Cornwall. Mention grounds maintenance contracts, "
                        "first impressions for guests, kerb appeal for businesses."
                    )

                audience_note = ""
                if audience == "paid":
                    audience_note = "\nThis is for PAID subscribers — include exclusive insider tips."
                elif audience == "free":
                    audience_note = "\nThis is for FREE subscribers — gently encourage them to upgrade."
                elif "hotel" in audience_text.lower():
                    audience_note = "\nThis is specifically for HOTEL & HOSPITALITY contacts."
                elif "commercial" in audience_text.lower():
                    audience_note = "\nThis is specifically for COMMERCIAL PROPERTY contacts."

                custom_theme = theme_text or theme_data["theme"]
                custom_focus = theme_text or theme_data["focus"]

                # Fetch active discount codes if promo is enabled
                discount_section = ""
                if include_promo:
                    try:
                        codes_data = self.api.get("get_discount_codes")
                        codes = codes_data if isinstance(codes_data, list) else codes_data.get("codes", [])
                        active_codes = [c for c in codes
                                        if str(c.get("active", "")).lower() in ("true", "yes", "1")]
                        if active_codes:
                            discount_section = "\n\nACTIVE DISCOUNT CODES (mention these naturally in the newsletter):\n"
                            for c in active_codes:
                                code = c.get("code", "")
                                pct = c.get("discountPercent", 0)
                                fixed = c.get("discountFixed", 0)
                                desc = c.get("description", "")
                                expires = c.get("expiresAt", "")
                                amount = f"{pct}% off" if pct else (f"\u00a3{fixed} off" if fixed else "discount")
                                exp_text = f" (expires {expires[:10]})" if expires else ""
                                discount_section += f"- Code: {code} — {amount}{exp_text}"
                                if desc:
                                    discount_section += f" — {desc}"
                                discount_section += "\n"
                            discount_section += ("Tell readers to enter the code on the booking form at "
                                                 "www.gardnersgm.co.uk/booking to claim their discount.\n")
                    except Exception:
                        pass

                promo_note = ("\nDo NOT invent any promotions, discounts, or special deals."
                              if not include_promo else
                              "\nChris has approved a promotion for this newsletter — include it naturally."
                              + discount_section)

                talking_section = ""
                if talking_points:
                    talking_section = f"\n\nSPECIFIC TALKING POINTS FROM CHRIS (cover all of these):\n{talking_points}"

                system_prompt = f"""{BRAND_VOICE}

You are writing this newsletter AS Chris, the founder of Gardners Ground Maintenance.
This is YOUR newsletter to YOUR customers. Write with genuine expertise, warmth, and
personality. You've been doing this for years and you know Cornwall's gardens intimately.

CRITICAL: This must sound like a REAL PERSON wrote it — not an AI template.
- Reference specific things happening RIGHT NOW in Cornwall
- Share genuine observations from your actual work this week/month
- Give advice that shows deep practical knowledge
- Be opinionated — tell people what works and what doesn't
- Include specific plant names, techniques, timing
- The reader should feel like they're getting advice from a trusted expert neighbour
"""

                prompt = f"""Write the {month} newsletter for Gardners Ground Maintenance.

Theme: "{custom_theme}" — focusing on {custom_focus}
Season: {season} in Cornwall
Current weather: {weather}
Target length: approximately {word_target} words
{audience_note}{promo_note}{blog_section}{testimonial_section}{leads_section}{talking_section}

IMPORTANT CONTENT RULES:
- Write as Chris, the founder — first person, from the garden, boots still muddy
- Every tip must be FACTUAL and SPECIFIC — include plant names, timing, technique
- Reference Cornwall specifically: maritime climate, mild winters, high rainfall, granite soil
- Include what's actually happening in Cornwall right now (wildlife, seasons, weather)
- NEVER invent phone numbers, email addresses, prices, or promotional offers
- Sign off warmly as Chris

STRUCTURE (mandatory):
1. Personal greeting referencing what you've actually been doing in gardens this {season}
   and what the weather's been like — make it feel REAL and CURRENT (3-4 sentences)
2. {max(3, word_target // 150)} detailed, practical garden tips — each with a bold heading,
   real horticultural detail, and an explanation of WHY it matters
3. Nature & wildlife corner — what's happening in Cornwall's natural world right now,
   specific species to look for, one thing readers can do to support local wildlife
{f'4. Customer testimonials section with real quotes' if include_testimonials else ''}
{f'5. Business & commercial section for hotels/B&Bs/commercial properties' if leads_focus else ''}
6. Brief company update from Chris (what projects you've been working on, new equipment, etc.)
7. Warm, personal sign-off from Chris — mention the website www.gardnersgm.co.uk

FORMAT:
SUBJECT: [engaging subject line with one emoji, specific to this month's content]
---HTML---
[newsletter in clean HTML with inline styles for email compatibility]
[use font-family: Georgia, serif; color: #2d3436; line-height: 1.7]
[green accent #27ae60 for headings]
[short paragraphs, bold key points, scannable layout]
---TEXT---
[plain text version]
"""

                text = llm.generate(prompt, system=system_prompt, max_tokens=6000, temperature=0.5)

                if text.startswith("[Error"):
                    try:
                        self._nl_status.configure(text=f"❌ {text[:80]}", text_color=theme.RED)
                        self._nl_generate_btn.configure(state="normal")
                    except Exception:
                        pass
                    return

                # Parse the result
                subject = f"🌿 {month} Garden Update — Gardners Ground Maintenance"
                body_html = ""
                body_text = ""

                if "SUBJECT:" in text:
                    import re as _re
                    m = _re.search(r'SUBJECT:\s*(.+)', text)
                    if m:
                        subject = m.group(1).strip().strip('"')

                if "---HTML---" in text and "---TEXT---" in text:
                    body_html = _sanitise(text.split("---HTML---", 1)[1].split("---TEXT---", 1)[0].strip())
                    body_text = _sanitise(text.split("---TEXT---", 1)[1].strip())
                elif "---" in text:
                    body = text.split("---", 1)[1].strip()
                    body_html = _sanitise(body)
                else:
                    body_html = _sanitise(text)

                self._nl_generated = {
                    "subject": subject,
                    "body_html": body_html,
                    "body_text": body_text or body_html,
                }

                try:
                    self._nl_subject_entry.delete(0, "end")
                    self._nl_subject_entry.insert(0, subject)

                    self._nl_content.delete("1.0", "end")
                    # Show HTML for editing — user can modify before sending
                    self._nl_content.insert("1.0", body_html or body_text)

                    self._nl_status.configure(
                        text=f"✅ Newsletter generated — {word_target} word target",
                        text_color=theme.GREEN_LIGHT,
                    )
                    self._nl_generate_btn.configure(state="normal")
                except Exception:
                    pass

            except Exception as e:
                log.error(f"Newsletter generation error: {e}")
                try:
                    self._nl_status.configure(text=f"❌ Error: {e}", text_color=theme.RED)
                    self._nl_generate_btn.configure(state="normal")
                except Exception:
                    pass

        threading.Thread(target=do_generate, daemon=True).start()

    def _send_newsletter(self):
        """Send the newsletter to subscribers via GAS."""
        subject = self._nl_subject_entry.get().strip()
        content = self._nl_content.get("1.0", "end").strip()
        if not subject or not content:
            messagebox.showwarning("No Content", "Generate or write a newsletter first.")
            return

        if not messagebox.askyesno("Send Newsletter?",
                                    f"Send '{subject}' to subscribers?\n\nThis cannot be undone."):
            return

        self._nl_status.configure(text="📤 Sending...", text_color=theme.AMBER)

        image_url = getattr(self, "_nl_selected_image", "") or ""

        def do_send():
            try:
                send_html = content
                # Inject hero image if available
                if image_url:
                    hero_block = (
                        f'<div style="text-align:center;margin-bottom:20px;">'
                        f'<img src="{image_url}" alt="Newsletter" '
                        f'style="max-width:100%;border-radius:8px;"/></div>'
                    )
                    send_html = hero_block + send_html

                self.api.post("send_newsletter", {
                    "subject": subject,
                    "htmlBody": send_html,
                    "textBody": getattr(self, "_nl_generated", {}).get("body_text", content),
                    "imageUrl": image_url,
                })

                # Store for records
                self.db.set_setting("last_newsletter_subject", subject)
                self.db.set_setting("last_newsletter_sent", datetime.now().isoformat())

                self.db.add_notification(
                    ntype="content",
                    title=f"📨 Newsletter Sent: {subject}",
                    message="Sent via Content Studio.",
                    icon="📨",
                )

                try:
                    self._nl_status.configure(
                        text="✅ Newsletter sent to all subscribers!",
                        text_color=theme.GREEN_LIGHT,
                    )
                except Exception:
                    pass
            except Exception as e:
                log.error(f"Newsletter send error: {e}")
                try:
                    self._nl_status.configure(text=f"❌ Send error: {e}", text_color=theme.RED)
                except Exception:
                    pass

        threading.Thread(target=do_send, daemon=True).start()

    def _save_nl_draft(self):
        subject = self._nl_subject_entry.get().strip()
        content = self._nl_content.get("1.0", "end").strip()
        if not subject or not content:
            messagebox.showwarning("No Content", "Generate or write a newsletter first.")
            return
        self.db.set_setting("draft_newsletter_subject", subject)
        self.db.set_setting("draft_newsletter_html", content)
        self.db.set_setting("draft_newsletter_image", getattr(self, "_nl_selected_image", "") or "")
        self._nl_status.configure(text="💾 Draft saved", text_color=theme.GREEN_LIGHT)

    # ==================================================================
    # AGENT CONFIG
    # ==================================================================
    def _build_agent_config(self):
        frame = ctk.CTkScrollableFrame(self, fg_color="transparent")
        self._sub_frames["agent_config"] = frame

        # Header
        header = ctk.CTkFrame(frame, fg_color="transparent")
        header.pack(fill="x", padx=16, pady=(16, 8))
        header.grid_columnconfigure(1, weight=1)

        ctk.CTkLabel(
            header, text="🤖 Agent Configuration",
            font=theme.font_bold(18), text_color=theme.TEXT_LIGHT, anchor="w",
        ).grid(row=0, column=0, sticky="w")

        self._agent_llm_status = ctk.CTkLabel(
            header, text="", font=theme.font(11), text_color=theme.TEXT_DIM,
        )
        self._agent_llm_status.grid(row=0, column=1, sticky="e", padx=16)

        theme.create_accent_button(
            header, "＋ New Agent",
            command=self._add_new_agent, width=130,
        ).grid(row=0, column=2, sticky="e")

        ctk.CTkLabel(
            frame,
            text="Configure AI agents for automated content generation. "
                 "Set schedules, personas, topics, word counts, audiences, and more.",
            font=theme.font(12), text_color=theme.TEXT_DIM, anchor="w",
            wraplength=800,
        ).pack(fill="x", padx=16, pady=(0, 12))

        # Agent cards container
        self._agent_cards_container = ctk.CTkFrame(frame, fg_color="transparent")
        self._agent_cards_container.pack(fill="x", padx=16, pady=(0, 8))

        # Run history
        history_card = ctk.CTkFrame(frame, fg_color=theme.BG_CARD, corner_radius=12)
        history_card.pack(fill="x", padx=16, pady=(8, 16))

        ctk.CTkLabel(
            history_card, text="📜 Recent Agent Runs",
            font=theme.font_bold(14), text_color=theme.TEXT_LIGHT, anchor="w",
        ).pack(fill="x", padx=16, pady=(14, 8))

        self._agent_runs_container = ctk.CTkFrame(history_card, fg_color="transparent")
        self._agent_runs_container.pack(fill="x", padx=16, pady=(0, 14))

    def _refresh_agent_config(self):
        """Load agents and run history."""
        # LLM status
        def check():
            status = llm.get_status()
            if status["available"]:
                txt = f"✅ {status['provider']}  •  {status['model']}"
                col = theme.GREEN_LIGHT
            else:
                txt = "⚠️ No LLM available"
                col = theme.RED
            try:
                self._agent_llm_status.configure(text=txt, text_color=col)
            except Exception:
                pass
        threading.Thread(target=check, daemon=True).start()

        # Load agent cards
        for w in self._agent_cards_container.winfo_children():
            w.destroy()

        agents = self.db.get_agent_schedules()
        if not agents:
            ctk.CTkLabel(
                self._agent_cards_container,
                text="No agents configured. Click '＋ New Agent' to create one.",
                font=theme.font(12), text_color=theme.TEXT_DIM,
            ).pack(pady=16)
        else:
            for agent in agents:
                self._render_agent_config_card(agent)

        # Load run history
        for w in self._agent_runs_container.winfo_children():
            w.destroy()

        runs = self.db.get_agent_runs(limit=20)
        if not runs:
            ctk.CTkLabel(
                self._agent_runs_container,
                text="No agent runs yet",
                font=theme.font(12), text_color=theme.TEXT_DIM,
            ).pack(pady=8)
        else:
            for run in runs:
                self._render_run_row(run)

    def _render_agent_config_card(self, agent: dict):
        """Render a detailed agent configuration card."""
        agent_meta = config.AGENT_TYPES.get(
            agent.get("agent_type", ""),
            {"label": agent.get("agent_type", ""), "icon": "🤖"},
        )
        enabled = bool(agent.get("enabled", 0))

        card = ctk.CTkFrame(
            self._agent_cards_container,
            fg_color=theme.BG_CARD, corner_radius=10,
        )
        card.pack(fill="x", pady=4)
        card.grid_columnconfigure(1, weight=1)

        # Status bar
        color = theme.GREEN_PRIMARY if enabled else theme.TEXT_DIM
        ctk.CTkFrame(card, width=4, fg_color=color, corner_radius=2).grid(
            row=0, column=0, rowspan=3, sticky="ns",
        )

        # Name + badge
        info_frame = ctk.CTkFrame(card, fg_color="transparent")
        info_frame.grid(row=0, column=1, sticky="ew", padx=16, pady=(12, 0))

        ctk.CTkLabel(
            info_frame,
            text=f"{agent_meta.get('icon', '🤖')} {agent.get('name', 'Unnamed')}",
            font=theme.font_bold(14), text_color=theme.TEXT_LIGHT, anchor="w",
        ).pack(side="left")

        badge_text = "  ACTIVE  " if enabled else "  PAUSED  "
        badge_color = theme.GREEN_PRIMARY if enabled else theme.TEXT_DIM
        ctk.CTkLabel(
            info_frame, text=badge_text, fg_color=badge_color,
            text_color="white", corner_radius=6, height=22,
            font=theme.font(9, "bold"),
        ).pack(side="left", padx=12)

        # Schedule info
        schedule_text = (
            f"Type: {agent_meta.get('label', '')}  •  "
            f"Schedule: {agent.get('schedule_type', '')} on {agent.get('schedule_day', '')} "
            f"at {agent.get('schedule_time', '')}  •  "
            f"Last: {(agent.get('last_run', '') or 'Never')[:16]}  •  "
            f"Next: {(agent.get('next_run', '') or 'Not set')[:16]}"
        )
        ctk.CTkLabel(
            card, text=schedule_text,
            font=theme.font(11), text_color=theme.TEXT_DIM, anchor="w",
        ).grid(row=1, column=1, sticky="ew", padx=16, pady=(2, 0))

        # Config summary (if any)
        config_json = agent.get("config_json", "{}")
        try:
            cfg = json.loads(config_json) if config_json else {}
        except Exception:
            cfg = {}
        if cfg:
            cfg_parts = []
            if cfg.get("audience"):
                cfg_parts.append(f"Audience: {cfg['audience']}")
            if cfg.get("word_count"):
                cfg_parts.append(f"Words: {cfg['word_count']}")
            if cfg.get("persona"):
                cfg_parts.append(f"Persona: {cfg['persona']}")
            if cfg_parts:
                ctk.CTkLabel(
                    card, text="  •  ".join(cfg_parts),
                    font=theme.font(10), text_color=theme.BLUE, anchor="w",
                ).grid(row=2, column=1, sticky="ew", padx=16, pady=(0, 4))

        # Buttons
        btn_frame = ctk.CTkFrame(card, fg_color="transparent")
        btn_frame.grid(row=0, column=2, rowspan=3, padx=12, pady=12)

        theme.create_accent_button(
            btn_frame, "▶ Run Now",
            command=lambda a=agent: self._run_agent(a),
            width=100,
        ).pack(pady=(0, 4))

        toggle_text = "⏸ Pause" if enabled else "▶ Enable"
        theme.create_outline_button(
            btn_frame, toggle_text,
            command=lambda a=agent: self._toggle_agent(a),
            width=100,
        ).pack(pady=(0, 4))

        ctk.CTkButton(
            btn_frame, text="⚙️ Configure", width=100, height=28,
            fg_color="transparent", hover_color=theme.BG_CARD_HOVER,
            text_color=theme.TEXT_DIM, font=theme.font(11),
            corner_radius=6,
            command=lambda a=agent: self._open_agent_config_modal(a),
        ).pack(pady=(0, 4))

        ctk.CTkButton(
            btn_frame, text="🗑️ Delete", width=100, height=28,
            fg_color="transparent", hover_color="#3a1a1a",
            text_color=theme.RED, font=theme.font(11),
            corner_radius=6,
            command=lambda a=agent: self._delete_agent(a),
        ).pack()

    def _render_run_row(self, run: dict):
        """Render a single agent run history row."""
        row = ctk.CTkFrame(self._agent_runs_container, fg_color=theme.BG_INPUT, corner_radius=8)
        row.pack(fill="x", pady=2)
        row.grid_columnconfigure(2, weight=1)

        status = run.get("status", "")
        icons = {"success": "✅", "failed": "❌", "running": "⏳"}
        ctk.CTkLabel(
            row, text=icons.get(status, "❓"), font=theme.font(14), width=30,
        ).grid(row=0, column=0, padx=(8, 4), pady=8)

        agent_type = run.get("agent_type", "")
        type_label = config.AGENT_TYPES.get(agent_type, {}).get("label", agent_type)
        ctk.CTkLabel(
            row, text=type_label, font=theme.font_bold(12),
            text_color=theme.TEXT_LIGHT, anchor="w", width=160,
        ).grid(row=0, column=1, padx=4, pady=8, sticky="w")

        title = run.get("output_title", "") or run.get("error_message", "")
        if len(title) > 60:
            title = title[:60] + "..."
        ctk.CTkLabel(
            row, text=title, font=theme.font(11),
            text_color=theme.TEXT_DIM, anchor="w",
        ).grid(row=0, column=2, padx=4, pady=8, sticky="w")

        time_str = (run.get("started_at", "") or "")[:16]
        ctk.CTkLabel(
            row, text=time_str, font=theme.font(11),
            text_color=theme.TEXT_DIM,
        ).grid(row=0, column=3, padx=8, pady=8)

        if status == "success" and run.get("output_text"):
            ctk.CTkButton(
                row, text="👁️", width=30, height=26,
                fg_color="transparent", hover_color=theme.BG_CARD_HOVER,
                text_color=theme.TEXT_DIM, font=theme.font(14),
                command=lambda r=run: self._view_run_output(r),
            ).grid(row=0, column=4, padx=(0, 8), pady=8)

    def _run_agent(self, agent: dict):
        """Run an agent now."""
        agent_id = agent.get("id")
        if not agent_id:
            return

        self._nl_status if hasattr(self, "_nl_status") else None

        def do_run():
            try:
                scheduler = getattr(self, "_agent_scheduler", None)
                if scheduler:
                    scheduler.run_agent_now(agent_id)
                else:
                    # Fallback: import and run directly
                    from ..agents import AgentScheduler
                    temp = AgentScheduler(self.db, self.api)
                    temp.run_agent_now(agent_id)

                try:
                    self._refresh_agent_config()
                except Exception:
                    pass
            except Exception as e:
                log.error(f"Run agent error: {e}")

        threading.Thread(target=do_run, daemon=True).start()
        messagebox.showinfo("Running", f"Agent '{agent.get('name', '')}' is running...")

    def _toggle_agent(self, agent: dict):
        """Toggle agent enabled/disabled."""
        agent_id = agent.get("id")
        new_state = 0 if agent.get("enabled", 0) else 1
        self.db.execute(
            "UPDATE agent_schedules SET enabled = ? WHERE id = ?",
            (new_state, agent_id),
        )
        self.db.commit()
        self._refresh_agent_config()

    def _delete_agent(self, agent: dict):
        if not messagebox.askyesno("Delete Agent?",
                                    f"Delete '{agent.get('name', '')}'?\nThis cannot be undone."):
            return
        self.db.execute("DELETE FROM agent_schedules WHERE id = ?", (agent.get("id"),))
        self.db.commit()
        self._refresh_agent_config()

    def _add_new_agent(self):
        self._open_agent_config_modal({})

    def _open_agent_config_modal(self, data: dict):
        """Full agent configuration modal with content customisation."""
        modal = ctk.CTkToplevel(self)
        modal.title("Configure Agent" if data.get("id") else "New Agent")
        modal.geometry("600x700")
        modal.transient(self.winfo_toplevel())
        modal.grab_set()

        modal.update_idletasks()
        x = (modal.winfo_screenwidth() - 600) // 2
        y = (modal.winfo_screenheight() - 700) // 2
        modal.geometry(f"600x700+{x}+{y}")

        scroll = ctk.CTkScrollableFrame(modal, fg_color=theme.BG_DARK)
        scroll.pack(fill="both", expand=True)

        ctk.CTkLabel(
            scroll, text="🤖 Agent Configuration",
            font=theme.font_heading(), text_color=theme.TEXT_LIGHT,
        ).pack(fill="x", padx=20, pady=(20, 16))

        # Parse existing config
        try:
            cfg = json.loads(data.get("config_json", "{}") or "{}")
        except Exception:
            cfg = {}

        fields = {}

        # ── Basic ──
        ctk.CTkLabel(scroll, text="Agent Name", font=theme.font(12),
                     text_color=theme.TEXT_DIM, anchor="w").pack(fill="x", padx=20, pady=(8, 2))
        name_entry = theme.create_entry(scroll, placeholder="e.g. Weekly Blog Writer")
        name_entry.insert(0, data.get("name", ""))
        name_entry.pack(fill="x", padx=20, pady=(0, 8))
        fields["name"] = name_entry

        ctk.CTkLabel(scroll, text="Agent Type", font=theme.font(12),
                     text_color=theme.TEXT_DIM, anchor="w").pack(fill="x", padx=20, pady=(0, 2))
        type_options = list(config.AGENT_TYPES.keys())
        type_labels = [config.AGENT_TYPES[t]["label"] for t in type_options]
        type_combo = ctk.CTkComboBox(scroll, values=type_labels, width=300, font=theme.font(13))
        current_type = data.get("agent_type", "")
        if current_type and current_type in config.AGENT_TYPES:
            type_combo.set(config.AGENT_TYPES[current_type]["label"])
        type_combo.pack(fill="x", padx=20, pady=(0, 8))
        fields["type"] = type_combo

        # ── Schedule ──
        ctk.CTkLabel(scroll, text="── Schedule ──", font=theme.font_bold(13),
                     text_color=theme.GREEN_LIGHT, anchor="w").pack(fill="x", padx=20, pady=(12, 4))

        sched_row = ctk.CTkFrame(scroll, fg_color="transparent")
        sched_row.pack(fill="x", padx=20, pady=(0, 8))

        ctk.CTkLabel(sched_row, text="Frequency:", font=theme.font(12),
                     text_color=theme.TEXT_DIM).pack(side="left", padx=(0, 8))
        freq_combo = ctk.CTkComboBox(
            sched_row, values=["daily", "weekly", "fortnightly", "monthly"],
            width=130, font=theme.font(12),
        )
        freq_combo.set(data.get("schedule_type", "weekly"))
        freq_combo.pack(side="left", padx=(0, 16))
        fields["freq"] = freq_combo

        ctk.CTkLabel(sched_row, text="Day:", font=theme.font(12),
                     text_color=theme.TEXT_DIM).pack(side="left", padx=(0, 8))
        day_combo = ctk.CTkComboBox(
            sched_row,
            values=["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
            width=130, font=theme.font(12),
        )
        day_combo.set(data.get("schedule_day", "Monday"))
        day_combo.pack(side="left", padx=(0, 16))
        fields["day"] = day_combo

        ctk.CTkLabel(sched_row, text="Time:", font=theme.font(12),
                     text_color=theme.TEXT_DIM).pack(side="left", padx=(0, 8))
        time_entry = theme.create_entry(scroll if False else sched_row, placeholder="09:00")
        time_entry.configure(width=80)
        time_entry.insert(0, data.get("schedule_time", "09:00"))
        time_entry.pack(side="left")
        fields["time"] = time_entry

        enabled_var = ctk.BooleanVar(value=bool(data.get("enabled", 1)))
        ctk.CTkCheckBox(
            scroll, text="Agent enabled", variable=enabled_var,
            font=theme.font(12), text_color=theme.TEXT_DIM,
            fg_color=theme.GREEN_PRIMARY, hover_color=theme.GREEN_DARK,
        ).pack(fill="x", padx=20, pady=(4, 8))
        fields["enabled"] = enabled_var

        # ── Content Customisation ──
        ctk.CTkLabel(scroll, text="── Content Settings ──", font=theme.font_bold(13),
                     text_color=theme.GREEN_LIGHT, anchor="w").pack(fill="x", padx=20, pady=(12, 4))

        ctk.CTkLabel(scroll, text="Default Persona (blog agents):", font=theme.font(12),
                     text_color=theme.TEXT_DIM, anchor="w").pack(fill="x", padx=20, pady=(0, 2))
        persona_combo = ctk.CTkComboBox(
            scroll, values=["Auto-rotate", "Wilson Treloar", "Tamsin Penrose",
                            "Jago Rowe", "Morwenna Vyvyan", "Dave Kitto"],
            width=300, font=theme.font(12),
        )
        persona_combo.set(cfg.get("persona", "Auto-rotate"))
        persona_combo.pack(fill="x", padx=20, pady=(0, 8))
        fields["persona"] = persona_combo

        ctk.CTkLabel(scroll, text="Target Audience:", font=theme.font(12),
                     text_color=theme.TEXT_DIM, anchor="w").pack(fill="x", padx=20, pady=(0, 2))
        aud_combo = ctk.CTkComboBox(
            scroll, values=["Residential homeowners", "Hotels & hospitality",
                            "Commercial property", "Letting agents", "All audiences"],
            width=300, font=theme.font(12),
        )
        aud_combo.set(cfg.get("audience", "Residential homeowners"))
        aud_combo.pack(fill="x", padx=20, pady=(0, 8))
        fields["audience"] = aud_combo

        ctk.CTkLabel(scroll, text="Word Count Target:", font=theme.font(12),
                     text_color=theme.TEXT_DIM, anchor="w").pack(fill="x", padx=20, pady=(0, 2))
        wc_combo = ctk.CTkComboBox(
            scroll, values=["600", "800", "1000", "1200", "1500", "2000"],
            width=300, font=theme.font(12),
        )
        wc_combo.set(str(cfg.get("word_count", "1000")))
        wc_combo.pack(fill="x", padx=20, pady=(0, 8))
        fields["word_count"] = wc_combo

        ctk.CTkLabel(scroll, text="Custom Topics (one per line, agent picks randomly):", font=theme.font(12),
                     text_color=theme.TEXT_DIM, anchor="w").pack(fill="x", padx=20, pady=(0, 2))
        topics_box = ctk.CTkTextbox(
            scroll, height=80, fg_color=theme.BG_INPUT,
            font=theme.font(12), text_color=theme.TEXT_LIGHT, corner_radius=8,
        )
        if cfg.get("topics"):
            topics_box.insert("1.0", "\n".join(cfg["topics"]))
        topics_box.pack(fill="x", padx=20, pady=(0, 8))
        fields["topics"] = topics_box

        ctk.CTkLabel(scroll, text="Standing Instructions (always included in prompts):", font=theme.font(12),
                     text_color=theme.TEXT_DIM, anchor="w").pack(fill="x", padx=20, pady=(0, 2))
        instructions_box = ctk.CTkTextbox(
            scroll, height=80, fg_color=theme.BG_INPUT,
            font=theme.font(12), text_color=theme.TEXT_LIGHT, corner_radius=8,
        )
        if cfg.get("instructions"):
            instructions_box.insert("1.0", cfg["instructions"])
        instructions_box.pack(fill="x", padx=20, pady=(0, 8))
        fields["instructions"] = instructions_box

        pull_testimonials_var = ctk.BooleanVar(value=cfg.get("pull_testimonials", False))
        ctk.CTkCheckBox(
            scroll, text="Pull fresh testimonials from website", variable=pull_testimonials_var,
            font=theme.font(12), text_color=theme.TEXT_DIM,
            fg_color=theme.GREEN_PRIMARY, hover_color=theme.GREEN_DARK,
        ).pack(fill="x", padx=20, pady=(4, 4))
        fields["pull_testimonials"] = pull_testimonials_var

        leads_var = ctk.BooleanVar(value=cfg.get("business_leads", False))
        ctk.CTkCheckBox(
            scroll, text="Include commercial/hotel business leads focus", variable=leads_var,
            font=theme.font(12), text_color=theme.TEXT_DIM,
            fg_color=theme.GREEN_PRIMARY, hover_color=theme.GREEN_DARK,
        ).pack(fill="x", padx=20, pady=(0, 12))
        fields["business_leads"] = leads_var

        # ── Save Button ──
        def save():
            # Resolve agent type from label
            type_label_sel = fields["type"].get()
            agent_type = ""
            for k, v in config.AGENT_TYPES.items():
                if v["label"] == type_label_sel:
                    agent_type = k
                    break
            if not agent_type:
                agent_type = type_label_sel.lower().replace(" ", "_")

            topics_text = fields["topics"].get("1.0", "end").strip()
            topic_list = [t.strip() for t in topics_text.split("\n") if t.strip()] if topics_text else []

            new_cfg = {
                "persona": fields["persona"].get(),
                "audience": fields["audience"].get(),
                "word_count": int(fields["word_count"].get() or 1000),
                "topics": topic_list,
                "instructions": fields["instructions"].get("1.0", "end").strip(),
                "pull_testimonials": fields["pull_testimonials"].get(),
                "business_leads": fields["business_leads"].get(),
            }

            if data.get("id"):
                # Update existing
                self.db.execute(
                    """UPDATE agent_schedules SET name=?, agent_type=?,
                       schedule_type=?, schedule_day=?, schedule_time=?,
                       enabled=?, config_json=? WHERE id=?""",
                    (
                        fields["name"].get().strip(),
                        agent_type,
                        fields["freq"].get(),
                        fields["day"].get(),
                        fields["time"].get().strip(),
                        1 if fields["enabled"].get() else 0,
                        json.dumps(new_cfg),
                        data["id"],
                    ),
                )
            else:
                # Insert new
                self.db.execute(
                    """INSERT INTO agent_schedules
                       (name, agent_type, schedule_type, schedule_day,
                        schedule_time, enabled, config_json)
                       VALUES (?, ?, ?, ?, ?, ?, ?)""",
                    (
                        fields["name"].get().strip() or "New Agent",
                        agent_type,
                        fields["freq"].get(),
                        fields["day"].get(),
                        fields["time"].get().strip() or "09:00",
                        1 if fields["enabled"].get() else 0,
                        json.dumps(new_cfg),
                    ),
                )
            self.db.commit()
            modal.destroy()
            self._refresh_agent_config()

        theme.create_accent_button(
            scroll, "💾 Save Configuration",
            command=save, width=200,
        ).pack(pady=(8, 20))

    def _view_run_output(self, run: dict):
        """Show agent run output in a modal."""
        modal = ctk.CTkToplevel(self)
        modal.title(run.get("output_title", "Agent Output"))
        modal.geometry("700x500")
        modal.transient(self.winfo_toplevel())

        textbox = ctk.CTkTextbox(
            modal, fg_color=theme.BG_INPUT,
            font=theme.font(13), text_color=theme.TEXT_LIGHT,
        )
        textbox.pack(fill="both", expand=True, padx=16, pady=16)
        textbox.insert("1.0", run.get("output_text", "No output"))

    # ==================================================================
    # CONTENT LIBRARY
    # ==================================================================
    def _build_content_library(self):
        frame = ctk.CTkScrollableFrame(self, fg_color="transparent")
        self._sub_frames["content_library"] = frame

        # Header
        header = ctk.CTkFrame(frame, fg_color="transparent")
        header.pack(fill="x", padx=16, pady=(16, 8))
        header.grid_columnconfigure(1, weight=1)

        ctk.CTkLabel(
            header, text="📚 Content Library",
            font=theme.font_bold(18), text_color=theme.TEXT_LIGHT, anchor="w",
        ).grid(row=0, column=0, sticky="w")

        # Filter buttons
        filter_row = ctk.CTkFrame(header, fg_color="transparent")
        filter_row.grid(row=0, column=1, sticky="e")

        self._lib_filter = "all"
        for text, key in [("All", "all"), ("Published", "Published"), ("Drafts", "Draft")]:
            ctk.CTkButton(
                filter_row, text=text, font=theme.font(11),
                fg_color=theme.GREEN_PRIMARY if key == "all" else "transparent",
                hover_color=theme.BG_CARD_HOVER,
                text_color=theme.TEXT_LIGHT, width=80, height=28,
                corner_radius=6,
                command=lambda k=key: self._filter_library(k),
            ).pack(side="left", padx=2)

        self._library_container = ctk.CTkFrame(frame, fg_color="transparent")
        self._library_container.pack(fill="x", padx=16, pady=(8, 16))

    def _filter_library(self, status: str):
        self._lib_filter = status
        self._refresh_content_library()

    def _refresh_content_library(self):
        """Load blog posts and newsletter history."""
        for w in self._library_container.winfo_children():
            w.destroy()

        try:
            posts = self.db.get_blog_posts(limit=50)
        except Exception:
            posts = []

        if self._lib_filter != "all":
            posts = [p for p in posts if p.get("status", "") == self._lib_filter]

        if not posts:
            ctk.CTkLabel(
                self._library_container,
                text="No content found",
                font=theme.font(12), text_color=theme.TEXT_DIM,
            ).pack(pady=16)
            return

        for post in posts:
            self._render_library_row(post)

    def _render_library_row(self, post: dict):
        """Render a content library entry."""
        row = ctk.CTkFrame(self._library_container, fg_color=theme.BG_CARD, corner_radius=8)
        row.pack(fill="x", pady=3)
        row.grid_columnconfigure(1, weight=1)

        # Status indicator
        status = post.get("status", "Draft")
        status_color = theme.GREEN_PRIMARY if status == "Published" else theme.AMBER
        ctk.CTkFrame(row, width=4, fg_color=status_color, corner_radius=2).grid(
            row=0, column=0, rowspan=2, sticky="ns",
        )

        # Title
        ctk.CTkLabel(
            row, text=post.get("title", "Untitled"),
            font=theme.font_bold(13), text_color=theme.TEXT_LIGHT, anchor="w",
        ).grid(row=0, column=1, sticky="ew", padx=12, pady=(8, 0))

        # Meta
        meta_parts = []
        if post.get("author"):
            meta_parts.append(f"✍️ {post['author']}")
        if post.get("category"):
            meta_parts.append(f"📂 {post['category']}")
        if post.get("created_at"):
            meta_parts.append(f"📅 {post['created_at'][:10]}")
        meta_parts.append(f"📊 {status}")

        ctk.CTkLabel(
            row, text="  •  ".join(meta_parts),
            font=theme.font(11), text_color=theme.TEXT_DIM, anchor="w",
        ).grid(row=1, column=1, sticky="ew", padx=12, pady=(0, 8))

        # Actions
        btn_frame = ctk.CTkFrame(row, fg_color="transparent")
        btn_frame.grid(row=0, column=2, rowspan=2, padx=12, pady=8)

        if status == "Draft":
            ctk.CTkButton(
                btn_frame, text="📤 Publish", width=80, height=26,
                fg_color=theme.GREEN_PRIMARY, hover_color=theme.GREEN_DARK,
                text_color="white", font=theme.font(11), corner_radius=6,
                command=lambda p=post: self._quick_publish(p),
            ).pack(side="left", padx=2)

        ctk.CTkButton(
            btn_frame, text="✏️ Edit", width=60, height=26,
            fg_color="transparent", hover_color=theme.BG_CARD_HOVER,
            text_color=theme.TEXT_DIM, font=theme.font(11), corner_radius=6,
            command=lambda p=post: self._edit_in_studio(p),
        ).pack(side="left", padx=2)

        ctk.CTkButton(
            btn_frame, text="🗑️", width=30, height=26,
            fg_color="transparent", hover_color="#3a1a1a",
            text_color=theme.RED, font=theme.font(11), corner_radius=6,
            command=lambda p=post: self._delete_content(p),
        ).pack(side="left", padx=2)

    def _quick_publish(self, post: dict):
        """Publish a draft post."""
        post_id = post.get("id")
        if not post_id:
            return
        self.db.execute(
            "UPDATE blog_posts SET status = 'Published' WHERE id = ?",
            (post_id,),
        )
        self.db.commit()
        # Push to GAS
        try:
            self.api.post("save_blog_post", {
                "title": post.get("title", ""),
                "content": post.get("content", ""),
                "excerpt": post.get("excerpt", ""),
                "category": post.get("category", ""),
                "author": post.get("author", "Chris"),
                "status": "Published",
                "tags": post.get("tags", ""),
                "imageUrl": post.get("image_url", ""),
            })
        except Exception:
            pass
        self._refresh_content_library()

    def _edit_in_studio(self, post: dict):
        """Load a post into the blog studio for editing."""
        self._switch_sub("blog_studio")
        try:
            self._blog_topic.delete(0, "end")
            self._blog_topic.insert(0, post.get("title", ""))

            self._blog_title_entry.delete(0, "end")
            self._blog_title_entry.insert(0, post.get("title", ""))

            self._blog_excerpt_entry.delete(0, "end")
            self._blog_excerpt_entry.insert(0, post.get("excerpt", ""))

            self._blog_content.delete("1.0", "end")
            self._blog_content.insert("1.0", post.get("content", ""))

            self._blog_tags_entry.delete(0, "end")
            self._blog_tags_entry.insert(0, post.get("tags", ""))

            self._generated_content = post
            self._blog_status.configure(
                text=f"📝 Editing: {post.get('title', '')[:50]}",
                text_color=theme.BLUE,
            )
        except Exception as e:
            log.warning(f"Edit load error: {e}")

    def _delete_content(self, post: dict):
        if not messagebox.askyesno("Delete?",
                                    f"Delete '{post.get('title', '')}'?\nThis cannot be undone."):
            return
        self.db.execute("DELETE FROM blog_posts WHERE id = ?", (post.get("id"),))
        self.db.commit()
        self._refresh_content_library()

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------
    def on_table_update(self, table_name: str):
        if table_name in ("blog_posts", "agent_schedules", "agent_runs"):
            if self._current_sub:
                self._refresh_subtab(self._current_sub)
