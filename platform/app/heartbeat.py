"""
Heartbeat system for GGM Hub / Field App.

Sends periodic heartbeats to the Google Apps Script webhook so that
Hub and Field can see each other's online/offline status. Also provides
a query method to check the status of other nodes.

Usage (Hub):
    hb = HeartbeatService(api, node_id="pc_hub", node_type="pc")
    hb.start()

Usage (Field):
    hb = HeartbeatService(api, node_id="field_laptop", node_type="laptop")
    hb.start()
"""

import socket
import threading
import time
import logging
from datetime import datetime
from typing import Optional

from .api import APIClient
from . import config

log = logging.getLogger("ggm.heartbeat")


class HeartbeatService:
    """
    Background service that sends a heartbeat POST to GAS every N seconds
    and caches the latest status of all other nodes.
    """

    SEND_INTERVAL = 120          # seconds between heartbeat POSTs (2 min)
    STATUS_STALE_AFTER = 300     # seconds before a node is considered offline (5 min)

    def __init__(
        self,
        api: APIClient,
        node_id: str = "pc_hub",
        node_type: str = "pc",
        version: str = None,
    ):
        self.api = api
        self.node_id = node_id
        self.node_type = node_type
        self.version = version or config.APP_VERSION
        self._running = False
        self._thread: Optional[threading.Thread] = None
        self._start_time = None

        # Cached status of all nodes (refreshed on every heartbeat)
        self._nodes: list[dict] = []
        self._nodes_lock = threading.Lock()

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def start(self):
        """Start the heartbeat background thread."""
        if self._running:
            return
        self._running = True
        self._start_time = time.time()
        self._thread = threading.Thread(
            target=self._run_loop, daemon=True, name=f"Heartbeat-{self.node_id}"
        )
        self._thread.start()
        log.info(f"Heartbeat service started (node={self.node_id}, interval={self.SEND_INTERVAL}s)")

    def stop(self):
        """Stop the heartbeat background thread."""
        self._running = False
        if self._thread:
            self._thread.join(timeout=5)
        log.info("Heartbeat service stopped")

    def get_peer_status(self, peer_node_id: str = None) -> dict | None:
        """
        Return the cached status of a specific peer node.
        If peer_node_id is None, returns all nodes.

        Returns dict like:
            {"node_id": "field_laptop", "status": "online", "last_heartbeat": "...", ...}
        """
        with self._nodes_lock:
            if peer_node_id is None:
                return list(self._nodes)
            for node in self._nodes:
                if node.get("node_id") == peer_node_id:
                    return dict(node)
        return None

    def is_peer_online(self, peer_node_id: str) -> bool:
        """Quick check whether a peer node is currently online."""
        status = self.get_peer_status(peer_node_id)
        if not status:
            return False
        return status.get("status", "").lower() == "online"

    def check_version_mismatch(self) -> dict | None:
        """
        Compare this node's version against peer nodes.
        Returns dict with mismatch details or None if all aligned.
        """
        with self._nodes_lock:
            peers = [n for n in self._nodes if n.get("node_id") != self.node_id]

        if not peers:
            return None

        mismatches = []
        for peer in peers:
            peer_ver = peer.get("version", "")
            if peer_ver and peer_ver != self.version:
                mismatches.append({
                    "node_id": peer.get("node_id"),
                    "node_type": peer.get("node_type", ""),
                    "peer_version": peer_ver,
                    "local_version": self.version,
                    "status": peer.get("status", "unknown"),
                })

        if mismatches:
            return {"aligned": False, "mismatches": mismatches}
        return {"aligned": True, "mismatches": []}

    @property
    def uptime_seconds(self) -> int:
        """Seconds since this heartbeat service started."""
        if not self._start_time:
            return 0
        return int(time.time() - self._start_time)

    @property
    def uptime_str(self) -> str:
        """Human-readable uptime string (e.g. '2h 15m')."""
        secs = self.uptime_seconds
        hours, remainder = divmod(secs, 3600)
        mins, _ = divmod(remainder, 60)
        if hours > 0:
            return f"{hours}h {mins}m"
        return f"{mins}m"

    # ------------------------------------------------------------------
    # Background loop
    # ------------------------------------------------------------------

    def _run_loop(self):
        """Main heartbeat loop — send beat, fetch peer statuses, sleep."""
        # Send first heartbeat immediately
        self._send_heartbeat()
        self._fetch_node_statuses()

        while self._running:
            time.sleep(self.SEND_INTERVAL)
            if not self._running:
                break
            self._send_heartbeat()
            self._fetch_node_statuses()

    def _send_heartbeat(self):
        """POST a heartbeat to GAS."""
        try:
            hostname = socket.gethostname()
            self.api.post("node_heartbeat", {
                "node_id": self.node_id,
                "node_type": self.node_type,
                "version": self.version,
                "host": hostname,
                "uptime": self.uptime_str,
                "details": f"{config.APP_NAME} v{self.version} ({config.GIT_COMMIT or '?'})",
            })
            log.debug(f"Heartbeat sent (node={self.node_id}, uptime={self.uptime_str})")
        except Exception as e:
            log.warning(f"Heartbeat send failed: {e}")

    def _fetch_node_statuses(self):
        """GET the status of all nodes from GAS and cache locally."""
        try:
            result = self.api.get("get_node_status")
            nodes = result.get("nodes", []) if isinstance(result, dict) else []
            with self._nodes_lock:
                self._nodes = nodes
            log.debug(f"Node statuses refreshed: {len(nodes)} node(s)")
        except Exception as e:
            log.warning(f"Failed to fetch node statuses: {e}")
