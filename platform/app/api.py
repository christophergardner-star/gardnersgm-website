"""
HTTP client for the Google Apps Script webhook.
Handles redirects, retries, and error wrapping.
"""

import json
import time
import logging
import requests
from urllib.parse import urlencode

from . import config

log = logging.getLogger("ggm.api")


class APIError(Exception):
    """Raised when the GAS webhook returns an error."""
    pass


class APIClient:
    """Thin wrapper around requests to call the GAS webhook."""

    def __init__(self, webhook_url: str = None, timeout: int = None):
        self.webhook_url = webhook_url or config.SHEETS_WEBHOOK
        self.timeout = timeout or config.SYNC_TIMEOUT_SECONDS
        self.session = requests.Session()
        self.session.headers.update({
            "User-Agent": f"GGM-Hub/{config.APP_VERSION}",
        })

    # ------------------------------------------------------------------
    # GET — read data from Sheets
    # ------------------------------------------------------------------
    def get(self, action: str, params: dict = None) -> dict:
        """
        Call the webhook with a GET request.
        Returns parsed JSON response.
        """
        query = {"action": action}
        if params:
            query.update(params)

        url = f"{self.webhook_url}?{urlencode(query)}"
        return self._request("GET", url)

    # ------------------------------------------------------------------
    # POST — write data to Sheets
    # ------------------------------------------------------------------
    def post(self, action: str, data: dict = None) -> dict:
        """
        Call the webhook with a POST request.
        Returns parsed JSON response.
        """
        payload = {"action": action}
        if data:
            payload.update(data)

        return self._request("POST", self.webhook_url, json_body=payload)

    # ------------------------------------------------------------------
    # Telegram
    # ------------------------------------------------------------------
    def send_telegram(self, message: str, parse_mode: str = "Markdown") -> bool:
        """Send a message via the Telegram relay in GAS."""
        try:
            self.post("relay_telegram", {
                "text": message,
                "parse_mode": parse_mode,
            })
            return True
        except Exception as e:
            log.warning(f"Telegram send failed: {e}")
            return False

    # ------------------------------------------------------------------
    # Internal request handler with retries
    # ------------------------------------------------------------------
    def _request(self, method: str, url: str, json_body: dict = None,
                 max_retries: int = 3) -> dict:
        """
        Execute HTTP request with retry logic.
        Google Apps Script returns 302 redirects — requests follows them.
        """
        last_error = None

        for attempt in range(max_retries):
            try:
                if method == "GET":
                    resp = self.session.get(
                        url,
                        timeout=self.timeout,
                        allow_redirects=True,
                    )
                else:
                    # GAS sometimes needs Content-Type: text/plain
                    # to avoid CORS preflight issues
                    resp = self.session.post(
                        url,
                        data=json.dumps(json_body) if json_body else None,
                        headers={"Content-Type": "text/plain"},
                        timeout=self.timeout,
                        allow_redirects=True,
                    )

                # Check for HTML error pages (GAS returns HTML on error)
                content_type = resp.headers.get("Content-Type", "")
                if "text/html" in content_type and resp.status_code != 200:
                    raise APIError(f"GAS returned HTML error (status {resp.status_code})")

                # Parse JSON
                try:
                    result = resp.json()
                except (json.JSONDecodeError, ValueError):
                    # Sometimes GAS wraps response, try to extract JSON
                    text = resp.text.strip()
                    if text.startswith("{") or text.startswith("["):
                        result = json.loads(text)
                    else:
                        raise APIError(f"Non-JSON response: {text[:200]}")

                # Check for application-level errors
                if isinstance(result, dict) and result.get("error"):
                    raise APIError(result["error"])

                return result

            except requests.exceptions.Timeout:
                last_error = APIError(f"Request timed out after {self.timeout}s")
                log.warning(f"Timeout on attempt {attempt + 1}/{max_retries}")

            except requests.exceptions.ConnectionError:
                last_error = APIError("No internet connection")
                log.warning(f"Connection error on attempt {attempt + 1}/{max_retries}")

            except APIError:
                raise  # Don't retry application errors

            except Exception as e:
                last_error = APIError(str(e))
                log.warning(f"Request error on attempt {attempt + 1}: {e}")

            # Exponential backoff
            if attempt < max_retries - 1:
                wait = 2 ** attempt
                time.sleep(wait)

        raise last_error or APIError("Request failed after retries")

    # ------------------------------------------------------------------
    # Health check
    # ------------------------------------------------------------------
    def is_online(self) -> bool:
        """Quick check whether the GAS webhook is reachable."""
        try:
            self.get("sheet_tabs")
            return True
        except Exception:
            return False
