/**
 * GAS ENDPOINT ADDITIONS FOR MOBILE NODE 3
 * ==========================================
 * Add these functions to Code.gs to support the mobile app as a proper Node 3.
 * 
 * New endpoints needed:
 *   POST: register_push_token, validate_mobile_pin, log_mobile_activity
 *   GET:  get_mobile_push_tokens
 * 
 * Existing endpoints already handle: node_heartbeat, get_node_status,
 *   mobile_update_job_status, mobile_start_job, mobile_complete_job, etc.
 *
 * INSTRUCTIONS:
 * 1. Add these functions to Code.gs
 * 2. Add the new action cases to doPost() and doGet() switch statements
 * 3. Redeploy the Apps Script web app
 */

// ═══════════════════════════════════════════════════════════════
// PUSH TOKEN REGISTRATION
// ═══════════════════════════════════════════════════════════════

/**
 * Register an Expo push token for a mobile device.
 * Called when the mobile app starts and obtains a push token.
 * 
 * doPost case: 'register_push_token'
 */
function handleRegisterPushToken(data) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName('PushTokens');
    if (!sheet) {
      sheet = ss.insertSheet('PushTokens');
      sheet.appendRow(['Token', 'Platform', 'Device', 'NodeID', 'RegisteredAt', 'LastSeen']);
      sheet.getRange('1:1').setFontWeight('bold');
    }

    var token = data.token;
    var platform = data.platform || 'unknown';
    var device = data.device || 'Unknown';
    var nodeId = data.node_id || 'mobile-field';
    var now = new Date().toISOString();

    // Check if token already exists
    var tokens = sheet.getDataRange().getValues();
    for (var i = 1; i < tokens.length; i++) {
      if (tokens[i][0] === token) {
        // Update last seen
        sheet.getRange(i + 1, 6).setValue(now);
        return { status: 'success', message: 'Token already registered, updated last seen' };
      }
    }

    // New token
    sheet.appendRow([token, platform, device, nodeId, now, now]);
    
    return { status: 'success', message: 'Push token registered' };
  } catch (e) {
    return { status: 'error', message: e.message };
  }
}

/**
 * Get all registered push tokens (used by PC Hub to send push notifications).
 * 
 * doGet case: 'get_mobile_push_tokens'
 */
function handleGetMobilePushTokens() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName('PushTokens');
    if (!sheet) {
      return { status: 'success', tokens: [] };
    }

    var data = sheet.getDataRange().getValues();
    var tokens = [];
    for (var i = 1; i < data.length; i++) {
      tokens.push({
        token: data[i][0],
        platform: data[i][1],
        device: data[i][2],
        node_id: data[i][3],
        registered_at: data[i][4],
        last_seen: data[i][5],
      });
    }

    return { status: 'success', tokens: tokens };
  } catch (e) {
    return { status: 'error', message: e.message };
  }
}


// ═══════════════════════════════════════════════════════════════
// PIN VALIDATION
// ═══════════════════════════════════════════════════════════════

/**
 * Validate a mobile PIN against a stored value.
 * Falls back to default '1234' if no PIN configured.
 * 
 * doPost case: 'validate_mobile_pin'
 */
function handleValidateMobilePin(data) {
  try {
    var pin = data.pin;
    var nodeId = data.node_id || 'mobile-field';

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName('AppConfig');

    // Look for the mobile PIN in AppConfig sheet
    var configuredPin = '1234'; // Default
    if (sheet) {
      var configData = sheet.getDataRange().getValues();
      for (var i = 1; i < configData.length; i++) {
        if (configData[i][0] === 'mobile_pin') {
          configuredPin = String(configData[i][1]);
          break;
        }
      }
    }

    var valid = pin === configuredPin;

    // Log the attempt
    logActivity('pin_validation', {
      node_id: nodeId,
      success: valid,
      timestamp: new Date().toISOString(),
    });

    return { status: 'success', valid: valid };
  } catch (e) {
    return { status: 'error', message: e.message, valid: false };
  }
}


// ═══════════════════════════════════════════════════════════════
// MOBILE ACTIVITY LOGGING
// ═══════════════════════════════════════════════════════════════

/**
 * Log a mobile activity event for visibility in other nodes.
 * 
 * doPost case: 'log_mobile_activity'
 */
function handleLogMobileActivity(data) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName('MobileActivity');
    if (!sheet) {
      sheet = ss.insertSheet('MobileActivity');
      sheet.appendRow(['Timestamp', 'NodeID', 'ActivityType', 'Details', 'Lat', 'Lng']);
      sheet.getRange('1:1').setFontWeight('bold');
    }

    var timestamp = data.timestamp || new Date().toISOString();
    var nodeId = data.node_id || 'mobile-field';
    var activityType = data.activityType || 'unknown';
    
    // Extract details (everything except reserved keys)
    var reserved = ['action', 'node_id', 'timestamp', 'activityType'];
    var details = {};
    for (var key in data) {
      if (reserved.indexOf(key) === -1) {
        details[key] = data[key];
      }
    }

    var lat = data.lat || '';
    var lng = data.lng || '';

    sheet.appendRow([
      timestamp,
      nodeId,
      activityType,
      JSON.stringify(details),
      lat,
      lng,
    ]);

    // Trim to last 500 rows to prevent sheet bloat
    var lastRow = sheet.getLastRow();
    if (lastRow > 501) {
      sheet.deleteRows(2, lastRow - 501);
    }

    return { status: 'success' };
  } catch (e) {
    return { status: 'error', message: e.message };
  }
}


// ═══════════════════════════════════════════════════════════════
// EXPO PUSH NOTIFICATION SENDER (called by PC Hub or GAS triggers)
// ═══════════════════════════════════════════════════════════════

/**
 * Send a push notification to all registered mobile devices via Expo Push API.
 * Can be called from PC Hub via command queue, or from GAS time-based triggers.
 * 
 * Usage: sendExpoPush('New Job Assigned', 'Lawn mowing at TR1 2AB', { screen: 'JobDetail', jobRef: 'J-123' })
 */
function sendExpoPush(title, body, data) {
  try {
    var tokens = handleGetMobilePushTokens();
    if (tokens.status !== 'success' || tokens.tokens.length === 0) {
      Logger.log('No push tokens registered');
      return { status: 'error', message: 'No push tokens' };
    }

    var messages = tokens.tokens.map(function(t) {
      return {
        to: t.token,
        sound: 'default',
        title: title,
        body: body,
        data: data || {},
        channelId: 'jobs',
      };
    });

    // Expo Push API (batch up to 100 messages)
    var response = UrlFetchApp.fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      contentType: 'application/json',
      payload: JSON.stringify(messages),
      muteHttpExceptions: true,
    });

    var result = JSON.parse(response.getContentText());
    Logger.log('Push sent: ' + JSON.stringify(result));
    
    return { status: 'success', result: result };
  } catch (e) {
    Logger.log('Push error: ' + e.message);
    return { status: 'error', message: e.message };
  }
}


// ═══════════════════════════════════════════════════════════════
// LOCATION DATA HANDLING (update existing job handlers)
// ═══════════════════════════════════════════════════════════════

/**
 * MODIFY existing mobile_update_job_status handler to accept location data.
 * The mobile app now sends these additional fields:
 *   en-route_lat, en-route_lng, en-route_accuracy, en-route_location_time
 *   in-progress_lat, in-progress_lng, etc.
 *   completed_lat, completed_lng, etc.
 * 
 * Store these in a 'JobLocations' sheet for route/time analysis.
 */
function storeJobLocation(jobRef, status, data) {
  try {
    // Check if any location data was sent
    var latKey = status + '_lat';
    var lngKey = status + '_lng';
    if (!data[latKey] || !data[lngKey]) return;

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName('JobLocations');
    if (!sheet) {
      sheet = ss.insertSheet('JobLocations');
      sheet.appendRow(['JobRef', 'Status', 'Latitude', 'Longitude', 'Accuracy', 'Timestamp']);
      sheet.getRange('1:1').setFontWeight('bold');
    }

    sheet.appendRow([
      jobRef,
      status,
      data[latKey],
      data[lngKey],
      data[status + '_accuracy'] || '',
      data[status + '_location_time'] || new Date().toISOString(),
    ]);
  } catch (e) {
    Logger.log('Failed to store job location: ' + e.message);
  }
}


// ═══════════════════════════════════════════════════════════════
// doPost / doGet SWITCH ADDITIONS
// ═══════════════════════════════════════════════════════════════

/*
Add to doPost() switch statement:

    case 'register_push_token':
      return jsonResponse(handleRegisterPushToken(data));

    case 'validate_mobile_pin':
      return jsonResponse(handleValidateMobilePin(data));

    case 'log_mobile_activity':
      return jsonResponse(handleLogMobileActivity(data));

Add to doGet() switch statement:

    case 'get_mobile_push_tokens':
      return jsonResponse(handleGetMobilePushTokens());

Add to existing mobile_update_job_status / mobile_start_job / mobile_complete_job handlers:
    
    // After processing the status update:
    storeJobLocation(data.jobRef, statusValue, data);
*/
