"""
Social Media Auto-Poster for GGM Hub.
Posts blog content to Facebook Business Page via the Meta Graph API.

Setup:
  1. Create a Facebook App at developers.facebook.com
  2. Get a Page Access Token with 'pages_manage_posts' permission
  3. Set FB_PAGE_ACCESS_TOKEN and FB_PAGE_ID in platform/.env

The token needs to be a long-lived Page Access Token (not a user token).
See: https://developers.facebook.com/docs/pages/publishing
"""

import logging
import requests

from . import config

log = logging.getLogger("ggm.social_poster")

GRAPH_API = "https://graph.facebook.com/v19.0"


def _get_fb_config() -> dict:
    """Return Facebook credentials from config/env, or empty dict if not set."""
    token = getattr(config, "FB_PAGE_ACCESS_TOKEN", "")
    page_id = getattr(config, "FB_PAGE_ID", "")
    if token and page_id:
        return {"token": token, "page_id": page_id}
    return {}


def is_facebook_configured() -> bool:
    """Check if Facebook posting credentials are available."""
    return bool(_get_fb_config())


def post_to_facebook(message: str, link: str = "", image_url: str = "") -> dict:
    """
    Post to the Facebook Business Page.

    Args:
        message:   The post text (required).
        link:      Optional URL to include (e.g. blog post link).
        image_url: Optional image URL. If provided, creates a photo post.

    Returns:
        {"success": True, "post_id": "..."} or {"success": False, "error": "..."}
    """
    fb = _get_fb_config()
    if not fb:
        return {"success": False, "error": "Facebook not configured (set FB_PAGE_ACCESS_TOKEN and FB_PAGE_ID in .env)"}

    page_id = fb["page_id"]
    token = fb["token"]

    try:
        if image_url:
            # Photo post — better engagement
            endpoint = f"{GRAPH_API}/{page_id}/photos"
            payload = {
                "url": image_url,
                "message": message,
                "access_token": token,
            }
        else:
            # Text/link post
            endpoint = f"{GRAPH_API}/{page_id}/feed"
            payload = {
                "message": message,
                "access_token": token,
            }
            if link:
                payload["link"] = link

        resp = requests.post(endpoint, data=payload, timeout=30)
        data = resp.json()

        if resp.status_code == 200 and ("id" in data or "post_id" in data):
            post_id = data.get("id") or data.get("post_id", "")
            log.info(f"Posted to Facebook: {post_id}")
            return {"success": True, "post_id": post_id}
        else:
            error = data.get("error", {}).get("message", str(data))
            log.warning(f"Facebook post failed: {error}")
            return {"success": False, "error": error}

    except Exception as e:
        log.warning(f"Facebook post exception: {e}")
        return {"success": False, "error": str(e)}


def post_blog_to_facebook(title: str, excerpt: str, blog_url: str = "",
                          image_url: str = "", tags: str = "") -> dict:
    """
    Format and post a blog article to Facebook.

    Args:
        title:     Blog post title.
        excerpt:   Short excerpt/summary.
        blog_url:  Full URL to the blog post.
        image_url: Hero image URL.
        tags:      Comma-separated tags (converted to hashtags).

    Returns:
        {"success": True/False, ...}
    """
    # Build hashtags from tags
    hashtags = ""
    if tags:
        tag_list = [t.strip().replace(" ", "") for t in tags.split(",") if t.strip()]
        hashtags = " ".join(f"#{t}" for t in tag_list[:5])
    if not hashtags:
        hashtags = "#CornwallGardening #GardnersGM #GardenMaintenance"

    # Build the Facebook post message
    message = f"{title}\n\n"
    if excerpt:
        message += f"{excerpt}\n\n"
    if blog_url:
        message += f"Read the full article: {blog_url}\n\n"
    message += f"Need help with your garden in Cornwall? Book online at gardnersgm.co.uk or call us! \U0001f33f\n\n"
    message += hashtags

    return post_to_facebook(message=message, link=blog_url, image_url=image_url)
