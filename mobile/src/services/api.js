/**
 * GGM Field App — API Service
 * Communicates with Google Apps Script backend.
 * Handles offline queue for field use.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

// TODO: Replace with your deployed Apps Script URL after redeployment
const API_URL = 'https://script.google.com/macros/s/AKfycbx-q2qSeCorIEeXPE9d2MgAZLKEFwFNW9lARLE1yYciH9wJWwvktUTuDVLz_rSCbUhkMg/exec';

const OFFLINE_QUEUE_KEY = '@ggm_offline_queue';

/**
 * Follow Google Apps Script redirects (302 → 200)
 */
async function followRedirects(url, options = {}) {
  const response = await fetch(url, { ...options, redirect: 'follow' });
  return response;
}

/**
 * GET request to Apps Script
 */
export async function apiGet(action, params = {}) {
  const queryString = new URLSearchParams({ action, ...params }).toString();
  const url = `${API_URL}?${queryString}`;

  try {
    const response = await followRedirects(url);
    const data = await response.json();
    return data;
  } catch (error) {
    console.warn(`API GET failed (${action}):`, error.message);
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

export async function updateJobStatus(jobRef, status, notes = '') {
  return apiPost({
    action: 'mobile_update_job_status',
    jobRef,
    status,
    notes,
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
  var days = 7;
  if (weekOffset > 0) days = (weekOffset + 1) * 7;
  return apiGet('get_schedule', { days: String(days) });
}
