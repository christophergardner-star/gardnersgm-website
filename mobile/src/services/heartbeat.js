/**
 * GGM Field App — Heartbeat Service (Node 3)
 * Posts heartbeat to GAS every 2 minutes.
 * Fetches peer node statuses for network awareness.
 */

import { AppState } from 'react-native';
import { apiPost, apiGet } from './api';

const NODE_ID = 'mobile-field';
const NODE_TYPE = 'mobile';
const APP_VERSION = '2.0.0';
const HEARTBEAT_INTERVAL = 120_000; // 2 minutes

let heartbeatTimer = null;
let appStartTime = Date.now();
let latestNodeStatuses = [];
let listeners = [];

/**
 * Send a single heartbeat to GAS
 */
async function sendHeartbeat() {
  try {
    const uptimeSeconds = Math.floor((Date.now() - appStartTime) / 1000);
    await apiPost({
      action: 'node_heartbeat',
      node_id: NODE_ID,
      node_type: NODE_TYPE,
      version: APP_VERSION,
      uptime_seconds: uptimeSeconds,
      platform: 'react-native',
    });
    console.log('💚 Heartbeat sent');
  } catch (err) {
    console.warn('💔 Heartbeat failed:', err.message);
  }
}

/**
 * Fetch statuses of all nodes in the network
 */
export async function fetchNodeStatuses() {
  try {
    const data = await apiGet('get_node_status');
    if (data.status === 'success' && Array.isArray(data.nodes)) {
      latestNodeStatuses = data.nodes;
      notifyListeners();
      return data.nodes;
    }
    return latestNodeStatuses;
  } catch (err) {
    console.warn('Failed to fetch node statuses:', err.message);
    return latestNodeStatuses;
  }
}

/**
 * Subscribe to node status updates
 */
export function onNodeStatusUpdate(callback) {
  listeners.push(callback);
  // Immediately call with current data
  if (latestNodeStatuses.length > 0) {
    callback(latestNodeStatuses);
  }
  return () => {
    listeners = listeners.filter(l => l !== callback);
  };
}

function notifyListeners() {
  listeners.forEach(fn => fn(latestNodeStatuses));
}

/**
 * Start the heartbeat loop.
 * Pauses when app goes to background, resumes on foreground.
 */
export function startHeartbeat() {
  if (heartbeatTimer) return; // Already running

  appStartTime = Date.now();

  // Send immediately
  sendHeartbeat();
  fetchNodeStatuses();

  // Then repeat every 2 minutes
  heartbeatTimer = setInterval(() => {
    sendHeartbeat();
    fetchNodeStatuses();
  }, HEARTBEAT_INTERVAL);

  // Pause/resume on app state changes
  const subscription = AppState.addEventListener('change', (nextState) => {
    if (nextState === 'active') {
      // App came to foreground — send heartbeat + restart timer
      sendHeartbeat();
      fetchNodeStatuses();
      if (!heartbeatTimer) {
        heartbeatTimer = setInterval(() => {
          sendHeartbeat();
          fetchNodeStatuses();
        }, HEARTBEAT_INTERVAL);
      }
    } else if (nextState === 'background') {
      // App went to background — stop timer to save battery
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
    }
  });

  return () => {
    subscription.remove();
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  };
}

/**
 * Stop the heartbeat loop
 */
export function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

/**
 * Get the latest cached node statuses without fetching
 */
export function getCachedNodeStatuses() {
  return latestNodeStatuses;
}

export { APP_VERSION, NODE_ID, NODE_TYPE };
