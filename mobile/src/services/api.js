/**
 * GGM Field App — API Service
 * Communicates with Google Apps Script backend.
 * Handles offline queue for field use.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

// TODO: Replace with your deployed Apps Script URL after redeployment
const API_URL = 'https://script.google.com/macros/s/AKfycbxaT1YOoDZtVHP9CztiUutYFqMiOyygDJon5BxCij14CWl91WgdmrYqpbG4KVAlFh5IiQ/exec';

const OFFLINE_QUEUE_KEY = '@ggm_offline_queue';
const CACHE_PREFIX = '@ggm_cache_';
const CACHE_TTL = 15 * 60 * 1000; // 15 minutes

/**
 * Get cached response for an action
 */
async function getCachedResponse(cacheKey) {
  try {
    const cached = await AsyncStorage.getItem(CACHE_PREFIX + cacheKey);
    if (!cached) return null;
    const { data, timestamp } = JSON.parse(cached);
    // Return cached data even if stale (caller decides freshness)
    return { data, timestamp, stale: Date.now() - timestamp > CACHE_TTL };
  } catch (e) {
    return null;
  }
}

/**
 * Store a response in cache
 */
async function setCachedResponse(cacheKey, data) {
  try {
    await AsyncStorage.setItem(
      CACHE_PREFIX + cacheKey,
      JSON.stringify({ data, timestamp: Date.now() })
    );
  } catch (e) {
    // Cache write failure is non-critical
  }
}

/**
 * Record the last successful sync time
 */
async function recordSync() {
  try {
    await AsyncStorage.setItem('ggm_last_sync', new Date().toISOString());
  } catch (e) {}
}

/**
 * Follow Google Apps Script redirects (302 → 200)
 * GAS always 302-redirects to googleusercontent.com — Android fetch
 * sometimes fails to follow, so we handle it manually.
 */
async function followRedirects(url, options = {}, maxRedirects = 5) {
  let currentUrl = url;
  for (let i = 0; i < maxRedirects; i++) {
    const response = await fetch(currentUrl, { ...options, redirect: 'manual' });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location') || response.headers.get('Location');
      if (location) {
        currentUrl = location;
        // After first redirect, switch to GET (GAS pattern: POST → 302 → GET)
        if (options.method === 'POST') {
          options = { redirect: 'manual' };
        }
        continue;
      }
    }
    // Not a redirect, or no Location header — return as-is
    return response;
  }
  // Exhausted redirects — try one last time with follow
  return fetch(currentUrl, { ...options, redirect: 'follow' });
}

/**
 * GET request to Apps Script with offline cache fallback
 */
export async function apiGet(action, params = {}) {
  const queryString = new URLSearchParams({ action, ...params }).toString();
  const url = `${API_URL}?${queryString}`;
  const cacheKey = `${action}_${JSON.stringify(params)}`;

  try {
    const response = await followRedirects(url);
    const data = await response.json();
    // Cache successful responses
    await setCachedResponse(cacheKey, data);
    await recordSync();
    return data;
  } catch (error) {
    console.warn(`API GET failed (${action}):`, error.message);
    // Try to return cached data
    const cached = await getCachedResponse(cacheKey);
    if (cached) {
      console.log(`📦 Using cached data for ${action} (${cached.stale ? 'stale' : 'fresh'})`);
      return { ...cached.data, _cached: true, _cachedAt: cached.timestamp };
    }
    throw error;
  }
}

/**
 * POST request to Apps Script
 */
export async function apiPost(body) {
  try {
    const response = await followRedirects(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    return data;
  } catch (error) {
    console.warn(`API POST failed (${body.action}):`, error.message);
    // Queue for offline retry
    await queueOfflineAction(body);
    throw error;
  }
}

/**
 * Queue an action for when connectivity returns
 */
async function queueOfflineAction(body) {
  try {
    const existing = await AsyncStorage.getItem(OFFLINE_QUEUE_KEY);
    const queue = existing ? JSON.parse(existing) : [];
    queue.push({
      ...body,
      _queuedAt: new Date().toISOString(),
      _attempts: 0,
    });
    await AsyncStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
    console.log(`📦 Action queued offline: ${body.action}`);
  } catch (e) {
    console.warn('Failed to queue offline action:', e.message);
  }
}

/**
 * Process any queued offline actions
 */
export async function processOfflineQueue() {
  try {
    const existing = await AsyncStorage.getItem(OFFLINE_QUEUE_KEY);
    if (!existing) return 0;

    const queue = JSON.parse(existing);
    if (queue.length === 0) return 0;

    let processed = 0;
    const remaining = [];

    for (const item of queue) {
      try {
        await apiPost(item);
        processed++;
      } catch (e) {
        item._attempts = (item._attempts || 0) + 1;
        if (item._attempts < 5) {
          remaining.push(item);
        }
      }
    }

    await AsyncStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(remaining));
    return processed;
  } catch (e) {
    return 0;
  }
}

// ─── Specific API calls ───

export async function getTodaysJobs() {
  return apiGet('get_todays_jobs');
}

export async function getClients() {
  return apiGet('get_clients');
}

export async function getClientByRef(ref) {
  return apiGet('get_client', { ref });
}

export async function updateJobStatus(jobRef, status, notes = '', locationData = {}) {
  return apiPost({
    action: 'mobile_update_job_status',
    jobRef,
    status,
    notes,
    ...locationData,
  });
}

export async function startJob(jobRef, data = {}) {
  return apiPost({
    action: 'mobile_start_job',
    jobRef,
    startTime: new Date().toISOString(),
    ...data,
  });
}

export async function completeJob(jobRef, data = {}) {
  return apiPost({
    action: 'mobile_complete_job',
    jobRef,
    endTime: new Date().toISOString(),
    ...data,
  });
}

export async function sendInvoice(jobRef, data = {}) {
  return apiPost({
    action: 'mobile_send_invoice',
    jobRef,
    ...data,
  });
}

export async function uploadJobPhoto(jobRef, data = {}) {
  return apiPost({
    action: 'mobile_upload_photo',
    jobRef,
    ...data,
  });
}

export async function getSchedule(weekOffset = 0) {
  // Build Monday–Sunday date range for the target week
  var now = new Date();
  var monday = new Date(now);
  // getDay() returns 0 for Sunday — treat it as 7 so we get last Monday, not next Monday
  var dayOfWeek = now.getDay() || 7;
  monday.setDate(now.getDate() - dayOfWeek + 1 + (weekOffset * 7));
  var sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);

  function fmt(d) {
    return d.getFullYear() + '-' +
      ('0' + (d.getMonth() + 1)).slice(-2) + '-' +
      ('0' + d.getDate()).slice(-2);
  }

  try {
    var data = await apiGet('get_schedule_range', {
      startDate: fmt(monday),
      endDate: fmt(sunday),
    });
    if (data.status === 'success') return data;
    return { status: 'success', visits: [] };
  } catch (e) {
    // Fallback: call per-day if range endpoint unavailable
    var visits = [];
    for (var d = 0; d < 7; d++) {
      var day = new Date(monday);
      day.setDate(monday.getDate() + d);
      try {
        var dayData = await apiGet('get_schedule', { date: fmt(day) });
        if (dayData.status === 'success' && dayData.jobs) {
          dayData.jobs.forEach(function (job) {
            visits.push({ ...job, visitDate: fmt(day) });
          });
        }
      } catch (ex) { /* skip */ }
    }
    return { status: 'success', visits: visits };
  }
}

/**
 * Log a mobile activity event (visible in Field App + PC Hub dashboards)
 */
export async function logMobileActivity(activityType, details = {}) {
  return apiPost({
    action: 'log_mobile_activity',
    activityType,
    node_id: 'mobile-field',
    timestamp: new Date().toISOString(),
    ...details,
  });
}

/**
 * Get recent mobile activity log
 */
export async function getMobileActivity(limit = 20) {
  return apiGet('get_mobile_activity', { limit: String(limit) });
}

/**
 * Get recent messages from all Telegram bots
 */
export async function getBotMessages(limit = 30) {
  return apiGet('get_bot_messages', { limit: String(limit) });
}

// ─── v3.0 New Endpoints ───

/**
 * Save a risk assessment for a job
 */
export async function saveRiskAssessment(jobRef, data = {}) {
  return apiPost({
    action: 'save_risk_assessment',
    jobRef,
    node_id: 'mobile-field',
    timestamp: new Date().toISOString(),
    ...data,
  });
}

/**
 * Get risk assessment for a job
 */
export async function getRiskAssessment(jobRef) {
  return apiGet('get_risk_assessment', { jobRef });
}

/**
 * Save a job expense
 */
export async function saveJobExpense(data = {}) {
  return apiPost({
    action: 'save_job_expense',
    node_id: 'mobile-field',
    timestamp: new Date().toISOString(),
    ...data,
  });
}

/**
 * Get job expenses with optional filters
 */
export async function getJobExpenses(params = {}) {
  return apiGet('get_job_expenses', params);
}

/**
 * Submit client signature for job signoff
 */
export async function submitClientSignature(jobRef, data = {}) {
  return apiPost({
    action: 'submit_client_signature',
    jobRef,
    node_id: 'mobile-field',
    timestamp: new Date().toISOString(),
    ...data,
  });
}

/**
 * Create a quote from the field
 */
export async function createQuote(data = {}) {
  return apiPost({
    action: 'create_quote',
    node_id: 'mobile-field',
    timestamp: new Date().toISOString(),
    ...data,
  });
}

/**
 * Get quotes with optional filters
 */
export async function getQuotes(params = {}) {
  return apiGet('get_quotes', params);
}

/**
 * Get weather forecast (proxied through GAS)
 */
export async function getWeather(postcode = 'PL26') {
  return apiGet('get_weather', { postcode });
}

/**
 * Save a field note (text or voice)
 */
export async function saveFieldNote(data = {}) {
  return apiPost({
    action: 'save_field_note',
    node_id: 'mobile-field',
    timestamp: new Date().toISOString(),
    ...data,
  });
}

/**
 * Get field notes
 */
export async function getFieldNotes(params = {}) {
  return apiGet('get_field_notes', params);
}

/**
 * Reschedule a booking
 */
export async function rescheduleBooking(jobRef, data = {}) {
  return apiPost({
    action: 'reschedule_booking',
    jobRef,
    ...data,
  });
}

/**
 * Cancel a booking
 */
export async function cancelBooking(jobRef, data = {}) {
  return apiPost({
    action: 'cancel_booking',
    jobRef,
    ...data,
  });
}
