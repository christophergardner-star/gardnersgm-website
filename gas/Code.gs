/**
 * ══════════════════════════════════════════════════════════════════════
 * GGM Hub — Google Apps Script (Code.gs)
 * Gardners Ground Maintenance — Central API Backbone
 * ══════════════════════════════════════════════════════════════════════
 *
 * VERSION:  4.0.0
 * UPDATED:  Auto-tracked via git
 *
 * This is the CANONICAL version-controlled source for the GAS web app.
 * All 3 nodes (PC Hub, Laptop Field App, Mobile App) communicate through
 * this single endpoint.
 *
 * ARCHITECTURE:
 *   📱 Mobile App (Node 3)  →  THIS GAS  ←  💻 Laptop Field App (Node 2)
 *                                  ↕
 *                            🖥️ PC Hub (Node 1)
 *                                  ↕
 *                            🌐 Website (booking.js, chatbot, etc.)
 *
 * DEPLOYMENT:
 *   See gas/README.md for deployment instructions.
 *   If using clasp: `npx clasp push` from the gas/ directory.
 *   Otherwise: copy this entire file into the Apps Script editor.
 *
 * NODE ROLES:
 *   pc_hub        — Full read/write, master node, runs agents & sync
 *   field_laptop  — Read + field operations, delegates heavy work to PC
 *   mobile-field  — Limited to job status, photos, location, heartbeat
 *   website       — Public: bookings, enquiries, analytics, blog reads
 *
 * TOTAL ACTIONS: 138+ endpoints across GET and POST
 * ══════════════════════════════════════════════════════════════════════
 */

// ═══════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════

var CONFIG = {
  SPREADSHEET_ID: '',  // Leave blank to use getActiveSpreadsheet()
  STRIPE_SECRET_KEY: PropertiesService.getScriptProperties().getProperty('STRIPE_SECRET_KEY') || '',
  TG_BOT_TOKEN: PropertiesService.getScriptProperties().getProperty('TG_BOT_TOKEN') || '',
  TG_CHAT_ID: PropertiesService.getScriptProperties().getProperty('TG_CHAT_ID') || '',
  VERSION: '4.0.0',
};

// Node role permissions — what each node type is allowed to do
var NODE_ROLES = {
  pc_hub: {
    level: 'master',
    allowed: '*',  // All actions
  },
  field_laptop: {
    level: 'field',
    allowed: '*',  // Full read/write via GAS, delegates heavy processing
  },
  'mobile-field': {
    level: 'worker',
    // Mobile is restricted to these actions:
    allowed: [
      'get_todays_jobs', 'get_schedule', 'get_clients', 'get_client',
      'get_node_status', 'get_mobile_push_tokens', 'get_mobile_activity',
      'node_heartbeat', 'validate_mobile_pin', 'register_push_token',
      'log_mobile_activity', 'mobile_update_job_status', 'mobile_start_job',
      'mobile_complete_job', 'mobile_send_invoice', 'mobile_upload_photo',
    ],
  },
  website: {
    level: 'public',
    // Website is restricted to these actions:
    allowed: [
      'booking_payment', 'booking_deposit', 'booking_pay_later',
      'bespoke_enquiry', 'contact_enquiry', 'check_availability',
      'get_pricing_config', 'get_job_costs', 'get_busy_dates',
      'get_blog_posts', 'get_vacancies', 'get_testimonials', 'get_products',
      'relay_telegram', 'relay_telegram_photo', 'relay_telegram_document',
      'track_pageview', 'chatbot_message', 'get_chat_replies',
      'subscribe_newsletter', 'submit_testimonial', 'submit_complaint',
      'submit_application', 'shop_checkout', 'verify_customer',
      'request_login_link', 'verify_login_token', 'get_customer_portal',
      'update_customer_profile', 'update_email_preferences',
      'cancel_booking', 'cancel_subscription', 'delete_customer_account',
      'get_quote', 'quote_response', 'quote_deposit_payment',
      'stripe_invoice', 'stripe_subscription', 'stripe_webhook',
      'free_visit', 'subscription_request', 'get_subscription_portal',
      'weather_reschedule', 'fetch_blog_image',
    ],
  },
};


// ═══════════════════════════════════════════════════════════════
// SPREADSHEET HELPER
// ═══════════════════════════════════════════════════════════════

function getSpreadsheet() {
  if (CONFIG.SPREADSHEET_ID) {
    return SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  }
  return SpreadsheetApp.getActiveSpreadsheet();
}

function getOrCreateSheet(name, headers) {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    if (headers && headers.length) {
      sheet.appendRow(headers);
      sheet.getRange('1:1').setFontWeight('bold');
    }
  }
  return sheet;
}


// ═══════════════════════════════════════════════════════════════
// RESPONSE HELPERS
// ═══════════════════════════════════════════════════════════════

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function errorResponse(message, code) {
  return jsonResponse({ status: 'error', message: message, code: code || 400 });
}

function successResponse(data) {
  if (typeof data === 'string') {
    return jsonResponse({ status: 'success', message: data });
  }
  data.status = data.status || 'success';
  return data.status ? jsonResponse(data) : jsonResponse({ status: 'success', data: data });
}


// ═══════════════════════════════════════════════════════════════
// NODE ROLE ENFORCEMENT
// ═══════════════════════════════════════════════════════════════

/**
 * Check if a node is allowed to perform an action.
 * Returns true if allowed, false if denied.
 * Unknown nodes default to 'website' (public) permissions.
 */
function isActionAllowed(nodeId, action) {
  // Determine role
  var role = NODE_ROLES['website'];  // default: website/public
  if (nodeId) {
    if (nodeId === 'pc_hub') role = NODE_ROLES['pc_hub'];
    else if (nodeId === 'field_laptop') role = NODE_ROLES['field_laptop'];
    else if (nodeId === 'mobile-field' || nodeId.indexOf('mobile') !== -1) role = NODE_ROLES['mobile-field'];
  }

  if (role.allowed === '*') return true;
  return role.allowed.indexOf(action) !== -1;
}


// ═══════════════════════════════════════════════════════════════
// ACTIVITY LOGGING
// ═══════════════════════════════════════════════════════════════

function logActivity(type, details) {
  try {
    var sheet = getOrCreateSheet('ActivityLog', ['Timestamp', 'Type', 'Details']);
    var now = new Date().toISOString();
    sheet.appendRow([now, type, JSON.stringify(details)]);

    // Trim to last 1000 rows
    var lastRow = sheet.getLastRow();
    if (lastRow > 1001) {
      sheet.deleteRows(2, lastRow - 1001);
    }
  } catch (e) {
    Logger.log('logActivity error: ' + e.message);
  }
}


// ═══════════════════════════════════════════════════════════════
// doGet — ALL GET ENDPOINTS
// ═══════════════════════════════════════════════════════════════

function doGet(e) {
  var action = (e.parameter || {}).action || '';
  var params = e.parameter || {};

  // Optional: enforce node roles on GET
  // var nodeId = params.node_id || '';
  // if (!isActionAllowed(nodeId, action)) {
  //   return errorResponse('Unauthorized: ' + action, 403);
  // }

  try {
    switch (action) {

      // ── Availability & Pricing ──
      case 'check_availability':
        return jsonResponse(handleCheckAvailability(params));
      case 'get_pricing_config':
        return jsonResponse(handleGetPricingConfig());
      case 'get_job_costs':
        return jsonResponse(handleGetJobCosts());
      case 'get_busy_dates':
        return jsonResponse(handleGetBusyDates());

      // ── Clients & Jobs ──
      case 'get_clients':
        return jsonResponse(handleGetClients());
      case 'get_client':
        return jsonResponse(handleGetClient(params));
      case 'get_todays_jobs':
        return jsonResponse(handleGetTodaysJobs());
      case 'get_schedule':
        return jsonResponse(handleGetSchedule(params));
      case 'get_subscription_schedule':
        return jsonResponse(handleGetSubscriptionSchedule(params));
      case 'get_subscriptions':
        return jsonResponse(handleGetSubscriptions());
      case 'get_job_photos':
        return jsonResponse(handleGetJobPhotos(params));
      case 'get_all_job_photos':
        return jsonResponse(handleGetAllJobPhotos());
      case 'get_job_tracking':
        return jsonResponse(handleGetJobTracking(params));

      // ── Finance ──
      case 'get_finance_summary':
        return jsonResponse(handleGetFinanceSummary());
      case 'get_invoices':
        return jsonResponse(handleGetInvoices());
      case 'get_business_costs':
        return jsonResponse(handleGetBusinessCosts());
      case 'get_savings_pots':
        return jsonResponse(handleGetSavingsPots());
      case 'get_alloc_config':
        return jsonResponse(handleGetAllocConfig());

      // ── Quotes ──
      case 'get_quotes':
        return jsonResponse(handleGetQuotes());
      case 'get_quote':
        return jsonResponse(handleGetQuote(params));

      // ── Enquiries ──
      case 'get_enquiries':
        return jsonResponse(handleGetEnquiries());

      // ── Blog & Content ──
      case 'get_blog_posts':
        return jsonResponse(handleGetBlogPosts());
      case 'get_all_blog_posts':
        return jsonResponse(handleGetAllBlogPosts());

      // ── Newsletter & Subscribers ──
      case 'get_subscribers':
        return jsonResponse(handleGetSubscribers());
      case 'get_newsletter_subscribers':
        return jsonResponse(handleGetNewsletterSubscribers());
      case 'get_newsletters':
        return jsonResponse(handleGetNewsletters());

      // ── Testimonials ──
      case 'get_testimonials':
        return jsonResponse(handleGetTestimonials());
      case 'get_all_testimonials':
        return jsonResponse(handleGetAllTestimonials());
      case 'verify_customer':
        return jsonResponse(handleVerifyCustomer(params));

      // ── Careers ──
      case 'get_vacancies':
        return jsonResponse(handleGetVacancies());
      case 'get_all_vacancies':
        return jsonResponse(handleGetAllVacancies());
      case 'get_applications':
        return jsonResponse(handleGetApplications());

      // ── Shop ──
      case 'get_products':
        return jsonResponse(handleGetProducts());
      case 'get_orders':
        return jsonResponse(handleGetOrders());

      // ── Analytics & Monitoring ──
      case 'get_site_analytics':
        return jsonResponse(handleGetSiteAnalytics(params));
      case 'get_weather':
        return jsonResponse(handleGetWeather());
      case 'get_telegram_updates':
        return jsonResponse(handleGetTelegramUpdates(params));
      case 'get_chat_replies':
        return jsonResponse(handleGetChatReplies(params));
      case 'get_business_recommendations':
        return jsonResponse(handleGetBusinessRecommendations());

      // ── Node Communication ──
      case 'get_node_status':
        return jsonResponse(handleGetNodeStatus());
      case 'get_remote_commands':
        return jsonResponse(handleGetRemoteCommands(params));
      case 'get_mobile_push_tokens':
        return jsonResponse(handleGetMobilePushTokens());
      case 'get_mobile_activity':
        return jsonResponse(handleGetMobileActivity(params));

      // ── Customer Portal ──
      case 'get_customer_portal':
        return jsonResponse(handleGetCustomerPortal(params));
      case 'get_subscription_portal':
        return jsonResponse(handleGetSubscriptionPortal(params));

      // ── Email Workflows ──
      case 'get_email_workflow_status':
        return jsonResponse(handleGetEmailWorkflowStatus());
      case 'get_field_notes':
        return jsonResponse(handleGetFieldNotes(params));

      // ── System ──
      case 'health_check':
        return jsonResponse({ status: 'success', version: CONFIG.VERSION, timestamp: new Date().toISOString() });
      case 'sheet_read':
        return jsonResponse(handleSheetRead(params));
      case 'sheet_tabs':
        return jsonResponse(handleSheetTabs());

      // ── Weather Reschedule ──
      case 'weather_reschedule':
        return jsonResponse(handleWeatherReschedule(params));

      default:
        return errorResponse('Unknown GET action: ' + action, 404);
    }
  } catch (err) {
    Logger.log('doGet error (' + action + '): ' + err.message);
    return errorResponse(err.message, 500);
  }
}


// ═══════════════════════════════════════════════════════════════
// doPost — ALL POST ENDPOINTS
// ═══════════════════════════════════════════════════════════════

function doPost(e) {
  var data = {};
  try {
    data = JSON.parse(e.postData.contents);
  } catch (err) {
    return errorResponse('Invalid JSON payload', 400);
  }

  var action = data.action || '';
  var nodeId = data.node_id || '';

  // Enforce node role permissions
  if (nodeId && !isActionAllowed(nodeId, action)) {
    logActivity('access_denied', { node_id: nodeId, action: action });
    return errorResponse('Unauthorized: node ' + nodeId + ' cannot perform ' + action, 403);
  }

  try {
    switch (action) {

      // ── Bookings & Payments ──
      case 'booking_payment':
        var result = handleBookingPayment(data);
        // Notify mobile on new booking
        _notifyMobileNewBooking(data);
        return jsonResponse(result);
      case 'booking_deposit':
        var depositResult = handleBookingDeposit(data);
        _notifyMobileNewBooking(data);
        return jsonResponse(depositResult);
      case 'booking_pay_later':
        var payLaterResult = handleBookingPayLater(data);
        _notifyMobileNewBooking(data);
        return jsonResponse(payLaterResult);
      case 'cancel_booking':
        return jsonResponse(handleCancelBooking(data));
      case 'cancel_subscription':
        return jsonResponse(handleCancelSubscription(data));
      case 'reschedule_booking':
        return jsonResponse(handleRescheduleBooking(data));

      // ── Stripe ──
      case 'stripe_invoice':
        return jsonResponse(handleStripeInvoice(data));
      case 'stripe_subscription':
        return jsonResponse(handleStripeSubscription(data));
      case 'stripe_webhook':
        return jsonResponse(handleStripeWebhook(data));
      case 'shop_checkout':
        return jsonResponse(handleShopCheckout(data));
      case 'quote_deposit_payment':
        return jsonResponse(handleQuoteDepositPayment(data));

      // ── Enquiries & Contact ──
      case 'bespoke_enquiry':
        return jsonResponse(handleBespokeEnquiry(data));
      case 'contact_enquiry':
        return jsonResponse(handleContactEnquiry(data));
      case 'subscription_request':
        return jsonResponse(handleSubscriptionRequest(data));
      case 'free_visit':
        return jsonResponse(handleFreeVisit(data));

      // ── Client Management ──
      case 'update_client':
        return jsonResponse(handleUpdateClient(data));
      case 'delete_client':
        return jsonResponse(handleDeleteClient(data));
      case 'update_booking_status':
        return jsonResponse(handleUpdateBookingStatus(data));
      case 'update_status':
        return jsonResponse(handleUpdateStatus(data));

      // ── Quotes ──
      case 'create_quote':
        return jsonResponse(handleCreateQuote(data));
      case 'update_quote':
        return jsonResponse(handleUpdateQuote(data));
      case 'delete_quote':
        return jsonResponse(handleDeleteQuote(data));
      case 'quote_response':
        return jsonResponse(handleQuoteResponse(data));
      case 'resend_quote':
        return jsonResponse(handleResendQuote(data));
      case 'send_quote_email':
        return jsonResponse(handleSendQuoteEmail(data));

      // ── Enquiries ──
      case 'update_enquiry':
        return jsonResponse(handleUpdateEnquiry(data));
      case 'delete_enquiry':
        return jsonResponse(handleDeleteEnquiry(data));
      case 'send_enquiry_reply':
        return jsonResponse(handleSendEnquiryReply(data));

      // ── Invoices ──
      case 'update_invoice':
        return jsonResponse(handleUpdateInvoice(data));
      case 'delete_invoice':
        return jsonResponse(handleDeleteInvoice(data));
      case 'mark_invoice_paid':
        return jsonResponse(handleMarkInvoicePaid(data));
      case 'mark_invoice_void':
        return jsonResponse(handleMarkInvoiceVoid(data));
      case 'send_invoice_email':
        return jsonResponse(handleSendInvoiceEmail(data));

      // ── Finance ──
      case 'save_alloc_config':
        return jsonResponse(handleSaveAllocConfig(data));
      case 'save_business_costs':
        return jsonResponse(handleSaveBusinessCosts(data));
      case 'update_business_cost':
        return jsonResponse(handleUpdateBusinessCost(data));
      case 'update_savings_pot':
        return jsonResponse(handleUpdateSavingsPot(data));

      // ── Blog & Content ──
      case 'save_blog_post':
        return jsonResponse(handleSaveBlogPost(data));
      case 'delete_blog_post':
        return jsonResponse(handleDeleteBlogPost(data));
      case 'fetch_blog_image':
        return jsonResponse(handleFetchBlogImage(data));

      // ── Newsletter ──
      case 'send_newsletter':
        return jsonResponse(handleSendNewsletter(data));
      case 'subscribe_newsletter':
        return jsonResponse(handleSubscribeNewsletter(data));

      // ── Testimonials ──
      case 'submit_testimonial':
        return jsonResponse(handleSubmitTestimonial(data));

      // ── Complaints ──
      case 'submit_complaint':
        return jsonResponse(handleSubmitComplaint(data));
      case 'resolve_complaint':
        return jsonResponse(handleResolveComplaint(data));
      case 'update_complaint_status':
        return jsonResponse(handleUpdateComplaintStatus(data));
      case 'update_complaint_notes':
        return jsonResponse(handleUpdateComplaintNotes(data));

      // ── Careers ──
      case 'post_vacancy':
        return jsonResponse(handlePostVacancy(data));
      case 'delete_vacancy':
        return jsonResponse(handleDeleteVacancy(data));
      case 'submit_application':
        return jsonResponse(handleSubmitApplication(data));
      case 'update_application_status':
        return jsonResponse(handleUpdateApplicationStatus(data));

      // ── Shop ──
      case 'save_product':
        return jsonResponse(handleSaveProduct(data));
      case 'delete_product':
        return jsonResponse(handleDeleteProduct(data));
      case 'update_order_status':
        return jsonResponse(handleUpdateOrderStatus(data));

      // ── Schedule ──
      case 'generate_schedule':
        return jsonResponse(handleGenerateSchedule(data));

      // ── Email Automation ──
      case 'send_completion_email':
        return jsonResponse(handleSendCompletionEmail(data));
      case 'send_booking_confirmation_email':
        return jsonResponse(handleSendBookingConfirmationEmail(data));
      case 'process_email_lifecycle':
        return jsonResponse(handleProcessEmailLifecycle(data));

      // ── Telegram ──
      case 'relay_telegram':
        return jsonResponse(handleRelayTelegram(data));
      case 'relay_telegram_photo':
        return jsonResponse(handleRelayTelegramPhoto(data));
      case 'relay_telegram_document':
        return jsonResponse(handleRelayTelegramDocument(data));
      case 'send_telegram':
        return jsonResponse(handleRelayTelegram(data));  // Alias

      // ── Chatbot ──
      case 'chatbot_message':
        return jsonResponse(handleChatbotMessage(data));

      // ── Analytics ──
      case 'track_pageview':
        return jsonResponse(handleTrackPageview(data));

      // ── Social ──
      case 'log_social_post':
        return jsonResponse(handleLogSocialPost(data));

      // ── Customer Portal ──
      case 'request_login_link':
        return jsonResponse(handleRequestLoginLink(data));
      case 'verify_login_token':
        return jsonResponse(handleVerifyLoginToken(data));
      case 'update_customer_profile':
        return jsonResponse(handleUpdateCustomerProfile(data));
      case 'update_email_preferences':
        return jsonResponse(handleUpdateEmailPreferences(data));
      case 'delete_customer_account':
        return jsonResponse(handleDeleteCustomerAccount(data));

      // ── Node Communication ──
      case 'node_heartbeat':
        return jsonResponse(handleNodeHeartbeat(data));
      case 'queue_remote_command':
        return jsonResponse(handleQueueRemoteCommand(data));
      case 'update_remote_command':
        return jsonResponse(handleUpdateRemoteCommand(data));

      // ── Mobile Node 3 ──
      case 'register_push_token':
        return jsonResponse(handleRegisterPushToken(data));
      case 'validate_mobile_pin':
        return jsonResponse(handleValidateMobilePin(data));
      case 'log_mobile_activity':
        return jsonResponse(handleLogMobileActivity(data));
      case 'mobile_update_job_status':
        storeJobLocation(data.jobRef, data.status, data);
        return jsonResponse(handleMobileUpdateJobStatus(data));
      case 'mobile_start_job':
        storeJobLocation(data.jobRef, 'in-progress', data);
        return jsonResponse(handleMobileStartJob(data));
      case 'mobile_complete_job':
        storeJobLocation(data.jobRef, 'completed', data);
        return jsonResponse(handleMobileCompleteJob(data));
      case 'mobile_send_invoice':
        return jsonResponse(handleMobileSendInvoice(data));
      case 'mobile_upload_photo':
        return jsonResponse(handleMobileUploadPhoto(data));

      // ── Field Notes ──
      case 'save_field_note':
        return jsonResponse(handleSaveFieldNote(data));

      // ── Business Intelligence ──
      case 'save_business_recommendation':
        return jsonResponse(handleSaveBusinessRecommendation(data));

      // ── Sheet Operations ──
      case 'get_services':
        return jsonResponse(handleGetServices());

      default:
        return errorResponse('Unknown POST action: ' + action, 404);
    }
  } catch (err) {
    Logger.log('doPost error (' + action + '): ' + err.message);
    return errorResponse(err.message, 500);
  }
}


// ═══════════════════════════════════════════════════════════════
// PUSH TOKEN REGISTRATION (Mobile Node 3)
// ═══════════════════════════════════════════════════════════════

function handleRegisterPushToken(data) {
  try {
    var sheet = getOrCreateSheet('PushTokens', ['Token', 'Platform', 'Device', 'NodeID', 'RegisteredAt', 'LastSeen']);
    var token = data.token;
    var platform = data.platform || 'unknown';
    var device = data.device || 'Unknown';
    var nodeId = data.node_id || 'mobile-field';
    var now = new Date().toISOString();

    // Check if token already exists
    var tokens = sheet.getDataRange().getValues();
    for (var i = 1; i < tokens.length; i++) {
      if (tokens[i][0] === token) {
        sheet.getRange(i + 1, 6).setValue(now);
        return { status: 'success', message: 'Token updated' };
      }
    }

    sheet.appendRow([token, platform, device, nodeId, now, now]);
    return { status: 'success', message: 'Push token registered' };
  } catch (e) {
    return { status: 'error', message: e.message };
  }
}


// ═══════════════════════════════════════════════════════════════
// GET PUSH TOKENS (used by PC Hub for notifications)
// ═══════════════════════════════════════════════════════════════

function handleGetMobilePushTokens() {
  try {
    var ss = getSpreadsheet();
    var sheet = ss.getSheetByName('PushTokens');
    if (!sheet) return { status: 'success', tokens: [] };

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
// PIN VALIDATION (Mobile Node 3)
// ═══════════════════════════════════════════════════════════════

function handleValidateMobilePin(data) {
  try {
    var pin = data.pin;
    var nodeId = data.node_id || 'mobile-field';
    var ss = getSpreadsheet();
    var sheet = ss.getSheetByName('AppConfig');

    var configuredPin = '1234';  // Default
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
    logActivity('pin_validation', { node_id: nodeId, success: valid });
    return { status: 'success', valid: valid };
  } catch (e) {
    return { status: 'error', message: e.message, valid: false };
  }
}


// ═══════════════════════════════════════════════════════════════
// MOBILE ACTIVITY LOGGING
// ═══════════════════════════════════════════════════════════════

function handleLogMobileActivity(data) {
  try {
    var sheet = getOrCreateSheet('MobileActivity', ['Timestamp', 'NodeID', 'ActivityType', 'Details', 'Lat', 'Lng']);
    var timestamp = data.timestamp || new Date().toISOString();
    var nodeId = data.node_id || 'mobile-field';
    var activityType = data.activityType || 'unknown';

    var reserved = ['action', 'node_id', 'timestamp', 'activityType'];
    var details = {};
    for (var key in data) {
      if (reserved.indexOf(key) === -1) {
        details[key] = data[key];
      }
    }

    sheet.appendRow([timestamp, nodeId, activityType, JSON.stringify(details), data.lat || '', data.lng || '']);

    // Trim to last 500 rows
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
// EXPO PUSH NOTIFICATION SENDER
// ═══════════════════════════════════════════════════════════════

/**
 * Send push notification to all registered mobile devices via Expo Push API.
 * Called internally when bookings are created, jobs assigned, etc.
 */
function sendExpoPush(title, body, data) {
  try {
    var tokensResult = handleGetMobilePushTokens();
    if (tokensResult.status !== 'success' || !tokensResult.tokens || tokensResult.tokens.length === 0) {
      Logger.log('No push tokens registered');
      return { status: 'skipped', message: 'No push tokens' };
    }

    var messages = tokensResult.tokens.map(function(t) {
      return {
        to: t.token,
        sound: 'default',
        title: title,
        body: body,
        data: data || {},
        channelId: 'jobs',
      };
    });

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
// LOCATION DATA STORAGE (Mobile GPS tracking)
// ═══════════════════════════════════════════════════════════════

function storeJobLocation(jobRef, status, data) {
  try {
    var latKey = status + '_lat';
    var lngKey = status + '_lng';
    if (!data[latKey] || !data[lngKey]) return;

    var sheet = getOrCreateSheet('JobLocations', ['JobRef', 'Status', 'Latitude', 'Longitude', 'Accuracy', 'Timestamp']);
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
// NODE HEARTBEAT
// ═══════════════════════════════════════════════════════════════

function handleNodeHeartbeat(data) {
  try {
    var sheet = getOrCreateSheet('NodeHeartbeats', ['NodeID', 'NodeType', 'Version', 'Host', 'Uptime', 'Details', 'LastSeen', 'Status']);
    var nodeId = data.node_id || 'unknown';
    var nodeType = data.node_type || 'unknown';
    var now = new Date().toISOString();

    var rows = sheet.getDataRange().getValues();
    for (var i = 1; i < rows.length; i++) {
      if (rows[i][0] === nodeId) {
        // Update existing
        sheet.getRange(i + 1, 3).setValue(data.version || '');
        sheet.getRange(i + 1, 4).setValue(data.host || '');
        sheet.getRange(i + 1, 5).setValue(data.uptime || '');
        sheet.getRange(i + 1, 6).setValue(data.details || '');
        sheet.getRange(i + 1, 7).setValue(now);
        sheet.getRange(i + 1, 8).setValue('online');
        return { status: 'success', message: 'Heartbeat updated' };
      }
    }

    // New node
    sheet.appendRow([nodeId, nodeType, data.version || '', data.host || '', data.uptime || '', data.details || '', now, 'online']);
    return { status: 'success', message: 'Node registered' };
  } catch (e) {
    return { status: 'error', message: e.message };
  }
}

function handleGetNodeStatus() {
  try {
    var ss = getSpreadsheet();
    var sheet = ss.getSheetByName('NodeHeartbeats');
    if (!sheet) return { status: 'success', nodes: [] };

    var rows = sheet.getDataRange().getValues();
    var nodes = [];
    var now = new Date();

    for (var i = 1; i < rows.length; i++) {
      var lastSeen = new Date(rows[i][6]);
      var ageMs = now - lastSeen;
      var ageMins = Math.floor(ageMs / 60000);
      var status = ageMins < 5 ? 'online' : 'offline';
      var ageHuman = ageMins < 1 ? 'just now' : ageMins + 'min ago';

      nodes.push({
        node_id: rows[i][0],
        node_type: rows[i][1],
        version: rows[i][2],
        host: rows[i][3],
        uptime: rows[i][4],
        details: rows[i][5],
        last_seen: rows[i][6],
        status: status,
        age_human: ageHuman,
      });
    }
    return { status: 'success', nodes: nodes };
  } catch (e) {
    return { status: 'error', message: e.message };
  }
}


// ═══════════════════════════════════════════════════════════════
// REMOTE COMMAND QUEUE (Laptop → PC Hub)
// ═══════════════════════════════════════════════════════════════

function handleQueueRemoteCommand(data) {
  try {
    var sheet = getOrCreateSheet('RemoteCommands', ['ID', 'Command', 'Data', 'Source', 'Target', 'Status', 'Result', 'CreatedAt', 'CompletedAt']);
    var id = 'cmd_' + new Date().getTime();
    sheet.appendRow([
      id,
      data.command || '',
      data.data || '{}',
      data.source || 'unknown',
      data.target || 'pc_hub',
      'pending',
      '',
      data.created_at || new Date().toISOString(),
      '',
    ]);
    return { status: 'success', command_id: id };
  } catch (e) {
    return { status: 'error', message: e.message };
  }
}

function handleGetRemoteCommands(params) {
  try {
    var ss = getSpreadsheet();
    var sheet = ss.getSheetByName('RemoteCommands');
    if (!sheet) return { status: 'success', commands: [] };

    var statusFilter = params.status || 'pending';
    var limit = parseInt(params.limit) || 10;
    var rows = sheet.getDataRange().getValues();
    var commands = [];

    for (var i = rows.length - 1; i >= 1 && commands.length < limit; i--) {
      if (rows[i][5] === statusFilter) {
        commands.push({
          id: rows[i][0],
          command: rows[i][1],
          data: rows[i][2],
          source: rows[i][3],
          target: rows[i][4],
          status: rows[i][5],
          result: rows[i][6],
          created_at: rows[i][7],
          completed_at: rows[i][8],
          row: i + 1,
        });
      }
    }
    return { status: 'success', commands: commands };
  } catch (e) {
    return { status: 'error', message: e.message };
  }
}

function handleUpdateRemoteCommand(data) {
  try {
    var ss = getSpreadsheet();
    var sheet = ss.getSheetByName('RemoteCommands');
    if (!sheet) return errorResponse('No commands sheet');

    var rows = sheet.getDataRange().getValues();
    for (var i = 1; i < rows.length; i++) {
      if (rows[i][0] === data.command_id || rows[i][0] === data.id) {
        sheet.getRange(i + 1, 6).setValue(data.status || 'completed');
        sheet.getRange(i + 1, 7).setValue(data.result || '');
        sheet.getRange(i + 1, 9).setValue(data.completed_at || new Date().toISOString());
        return { status: 'success' };
      }
    }
    return errorResponse('Command not found');
  } catch (e) {
    return { status: 'error', message: e.message };
  }
}


// ═══════════════════════════════════════════════════════════════
// TELEGRAM RELAY
// ═══════════════════════════════════════════════════════════════

function handleRelayTelegram(data) {
  try {
    if (!CONFIG.TG_BOT_TOKEN || !CONFIG.TG_CHAT_ID) {
      return { status: 'error', message: 'Telegram not configured' };
    }
    var url = 'https://api.telegram.org/bot' + CONFIG.TG_BOT_TOKEN + '/sendMessage';
    var payload = {
      chat_id: CONFIG.TG_CHAT_ID,
      text: data.text || '',
      parse_mode: data.parse_mode || 'Markdown',
    };
    UrlFetchApp.fetch(url, {
      method: 'POST',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    });
    return { status: 'success' };
  } catch (e) {
    return { status: 'error', message: e.message };
  }
}

function handleRelayTelegramPhoto(data) {
  try {
    if (!CONFIG.TG_BOT_TOKEN || !CONFIG.TG_CHAT_ID) {
      return { status: 'error', message: 'Telegram not configured' };
    }
    // Send photo via Telegram Bot API
    var url = 'https://api.telegram.org/bot' + CONFIG.TG_BOT_TOKEN + '/sendPhoto';
    var boundary = '----FormBoundary' + new Date().getTime();
    var blob = Utilities.newBlob(
      Utilities.base64Decode(data.fileContent),
      data.mimeType || 'image/jpeg',
      data.fileName || 'photo.jpg'
    );

    var options = {
      method: 'POST',
      payload: {
        chat_id: CONFIG.TG_CHAT_ID,
        photo: blob,
        caption: data.caption || '',
      },
      muteHttpExceptions: true,
    };
    UrlFetchApp.fetch(url, options);
    return { status: 'success' };
  } catch (e) {
    return { status: 'error', message: e.message };
  }
}

function handleRelayTelegramDocument(data) {
  try {
    if (!CONFIG.TG_BOT_TOKEN || !CONFIG.TG_CHAT_ID) {
      return { status: 'error', message: 'Telegram not configured' };
    }
    var url = 'https://api.telegram.org/bot' + CONFIG.TG_BOT_TOKEN + '/sendDocument';
    var blob = Utilities.newBlob(
      Utilities.base64Decode(data.fileContent),
      'application/octet-stream',
      data.fileName || 'file'
    );
    var options = {
      method: 'POST',
      payload: {
        chat_id: CONFIG.TG_CHAT_ID,
        document: blob,
        caption: data.caption || '',
      },
      muteHttpExceptions: true,
    };
    UrlFetchApp.fetch(url, options);
    return { status: 'success' };
  } catch (e) {
    return { status: 'error', message: e.message };
  }
}


// ═══════════════════════════════════════════════════════════════
// BOOKING MOBILE NOTIFICATION (auto-notify on new bookings)
// ═══════════════════════════════════════════════════════════════

/**
 * Called after a new booking is created (from website, chatbot, etc.).
 * Sends an Expo push notification to all registered mobile devices so
 * the field worker sees the new job immediately.
 */
function _notifyMobileNewBooking(data) {
  try {
    var serviceName = data.serviceName || data.service || 'Service';
    var date = data.date || 'TBC';
    var customerName = '';
    if (data.customer) {
      customerName = data.customer.name || '';
    }
    var title = '📅 New Booking';
    var body = serviceName + ' — ' + date;
    if (customerName) {
      body = customerName + ': ' + body;
    }
    sendExpoPush(title, body, { screen: 'TodayList', type: 'new_booking' });
  } catch (e) {
    Logger.log('_notifyMobileNewBooking error: ' + e.message);
  }
}


// ═══════════════════════════════════════════════════════════════
// PAGEVIEW TRACKING
// ═══════════════════════════════════════════════════════════════

function handleTrackPageview(data) {
  try {
    var sheet = getOrCreateSheet('PageViews', ['Timestamp', 'Page', 'Referrer', 'UserAgent', 'SessionID']);
    sheet.appendRow([
      new Date().toISOString(),
      data.page || '',
      data.referrer || '',
      data.userAgent || '',
      data.sessionId || '',
    ]);
    // Trim to last 5000 rows
    var lastRow = sheet.getLastRow();
    if (lastRow > 5001) {
      sheet.deleteRows(2, lastRow - 5001);
    }
    return { status: 'success' };
  } catch (e) {
    return { status: 'error', message: e.message };
  }
}


// ═══════════════════════════════════════════════════════════════
// GENERIC SHEET OPERATIONS
// ═══════════════════════════════════════════════════════════════

function handleSheetRead(params) {
  try {
    var ss = getSpreadsheet();
    var sheet = ss.getSheetByName(params.tab || 'Sheet1');
    if (!sheet) return { status: 'error', message: 'Sheet not found: ' + params.tab };
    var range = params.range || 'A:Z';
    var data = sheet.getRange(range).getValues();
    return { status: 'success', data: data };
  } catch (e) {
    return { status: 'error', message: e.message };
  }
}

function handleSheetTabs() {
  try {
    var ss = getSpreadsheet();
    var sheets = ss.getSheets();
    var tabs = sheets.map(function(s) { return s.getName(); });
    return { status: 'success', tabs: tabs };
  } catch (e) {
    return { status: 'error', message: e.message };
  }
}


// ═══════════════════════════════════════════════════════════════
// STUB FUNCTIONS
// ═══════════════════════════════════════════════════════════════
// These functions are stubs representing your existing GAS implementations.
// Replace each stub with your actual code from the current Apps Script editor.
// The doGet/doPost router above is the canonical routing layer.
//
// To migrate:
//   1. Copy this file into Apps Script
//   2. Replace each stub below with the real implementation
//   3. Delete any old doGet/doPost functions (they're consolidated above)
//   4. Deploy as new version
// ═══════════════════════════════════════════════════════════════

// ── Availability & Pricing ──
function handleCheckAvailability(params) { return { status: 'success', available: true }; }
function handleGetPricingConfig() { return { status: 'success', config: {} }; }
function handleGetJobCosts() { return { status: 'success', costs: [] }; }
function handleGetBusyDates() { return { status: 'success', dates: [] }; }

// ── Clients & Jobs ──
function handleGetClients() { return { status: 'success', clients: [] }; }
function handleGetClient(params) { return { status: 'success', client: {} }; }
function handleGetTodaysJobs() { return { status: 'success', jobs: [] }; }
function handleGetSchedule(params) { return { status: 'success', schedule: [] }; }
function handleGetSubscriptionSchedule(params) { return { status: 'success', schedule: [] }; }
function handleGetSubscriptions() { return { status: 'success', subscriptions: [] }; }
function handleGetJobPhotos(params) { return { status: 'success', photos: [] }; }
function handleGetAllJobPhotos() { return { status: 'success', photos: [] }; }
function handleGetJobTracking(params) { return { status: 'success', tracking: [] }; }

// ── Finance ──
function handleGetFinanceSummary() { return { status: 'success', summary: {} }; }
function handleGetInvoices() { return { status: 'success', invoices: [] }; }
function handleGetBusinessCosts() { return { status: 'success', costs: [] }; }
function handleGetSavingsPots() { return { status: 'success', pots: [] }; }
function handleGetAllocConfig() { return { status: 'success', config: {} }; }

// ── Quotes ──
function handleGetQuotes() { return { status: 'success', quotes: [] }; }
function handleGetQuote(params) { return { status: 'success', quote: {} }; }

// ── Enquiries ──
function handleGetEnquiries() { return { status: 'success', enquiries: [] }; }

// ── Blog & Content ──
function handleGetBlogPosts() { return { status: 'success', posts: [] }; }
function handleGetAllBlogPosts() { return { status: 'success', posts: [] }; }

// ── Newsletter & Subscribers ──
function handleGetSubscribers() { return { status: 'success', subscribers: [] }; }
function handleGetNewsletterSubscribers() { return { status: 'success', subscribers: [] }; }
function handleGetNewsletters() { return { status: 'success', newsletters: [] }; }

// ── Testimonials ──
function handleGetTestimonials() { return { status: 'success', testimonials: [] }; }
function handleGetAllTestimonials() { return { status: 'success', testimonials: [] }; }
function handleVerifyCustomer(params) { return { status: 'success', verified: false }; }

// ── Careers ──
function handleGetVacancies() { return { status: 'success', vacancies: [] }; }
function handleGetAllVacancies() { return { status: 'success', vacancies: [] }; }
function handleGetApplications() { return { status: 'success', applications: [] }; }

// ── Shop ──
function handleGetProducts() { return { status: 'success', products: [] }; }
function handleGetOrders() { return { status: 'success', orders: [] }; }

// ── Analytics ──
function handleGetSiteAnalytics(params) { return { status: 'success', analytics: {} }; }
function handleGetWeather() { return { status: 'success', weather: {} }; }
function handleGetTelegramUpdates(params) { return { status: 'success', updates: [] }; }
function handleGetChatReplies(params) { return { status: 'success', replies: [] }; }
function handleGetBusinessRecommendations() { return { status: 'success', recommendations: [] }; }

// ── Customer Portal ──
function handleGetCustomerPortal(params) { return { status: 'success', portal: {} }; }
function handleGetSubscriptionPortal(params) { return { status: 'success', portal: {} }; }

// ── Email Workflows ──
function handleGetEmailWorkflowStatus() { return { status: 'success', workflows: [] }; }
function handleGetFieldNotes(params) { return { status: 'success', notes: [] }; }

// ── Weather Reschedule ──
function handleWeatherReschedule(params) { return { status: 'success' }; }

// ── Mobile Activity ──
function handleGetMobileActivity(params) { return { status: 'success', activity: [] }; }

// ═══════════════════════════════════════════════════════════════
// STRIPE PAYMENT HELPERS
// ═══════════════════════════════════════════════════════════════

/**
 * Call the Stripe REST API.
 * @param {string} endpoint — e.g. '/v1/payment_intents'
 * @param {Object} params  — form-encoded key/value pairs
 * @param {string} method  — 'post' or 'get' (default 'post')
 * @returns {Object} parsed JSON response
 */
function _stripeAPI(endpoint, params, method) {
  var sk = CONFIG.STRIPE_SECRET_KEY;
  if (!sk) throw new Error('STRIPE_SECRET_KEY not configured in Script Properties');

  var url = 'https://api.stripe.com' + endpoint;
  var options = {
    method: method || 'post',
    headers: {
      'Authorization': 'Basic ' + Utilities.base64Encode(sk + ':'),
    },
    muteHttpExceptions: true,
  };

  if (params && (method || 'post') === 'post') {
    // Stripe expects application/x-www-form-urlencoded
    var parts = [];
    _flattenParams(params, '', parts);
    options.contentType = 'application/x-www-form-urlencoded';
    options.payload = parts.join('&');
  } else if (params && method === 'get') {
    var parts = [];
    _flattenParams(params, '', parts);
    url += '?' + parts.join('&');
  }

  var resp = UrlFetchApp.fetch(url, options);
  var body = JSON.parse(resp.getContentText());

  if (body.error) {
    Logger.log('Stripe error: ' + JSON.stringify(body.error));
    throw new Error(body.error.message || 'Stripe API error');
  }

  return body;
}

/** Flatten nested objects for Stripe form encoding: { a: { b: 'c' } } → 'a[b]=c' */
function _flattenParams(obj, prefix, parts) {
  for (var key in obj) {
    if (!obj.hasOwnProperty(key)) continue;
    var fullKey = prefix ? prefix + '[' + key + ']' : key;
    var val = obj[key];
    if (val === null || val === undefined) continue;
    if (typeof val === 'object' && !Array.isArray(val)) {
      _flattenParams(val, fullKey, parts);
    } else {
      parts.push(encodeURIComponent(fullKey) + '=' + encodeURIComponent(val));
    }
  }
}

/**
 * Create a Stripe PaymentIntent, attach the PaymentMethod, and confirm it.
 * Returns the PaymentIntent object.
 *
 * @param {string} paymentMethodId  — pm_xxx from Stripe.js
 * @param {number} amount           — in pence (GBP minor units)
 * @param {string} description      — e.g. "Lawn Cutting — John Smith — 14/02/2026"
 * @param {Object} customer         — { name, email, phone, postcode }
 * @param {Object} metadata         — extra key/values to store on the PI
 * @returns {Object} PaymentIntent
 */
function _createAndConfirmPayment(paymentMethodId, amount, description, customer, metadata) {
  var params = {
    amount: String(amount),
    currency: 'gbp',
    payment_method: paymentMethodId,
    description: description,
    confirm: 'true',
    // Return URL for 3DS redirect (not usually needed for embedded card, but required by API)
    return_url: 'https://www.gardnersgm.co.uk/payment-complete.html',
    // Automatic payment methods (card)
    'automatic_payment_methods[enabled]': 'true',
    'automatic_payment_methods[allow_redirects]': 'never',
  };

  if (customer) {
    if (customer.email) params.receipt_email = customer.email;
  }

  if (metadata) {
    for (var k in metadata) {
      if (metadata.hasOwnProperty(k)) {
        params['metadata[' + k + ']'] = String(metadata[k]).substring(0, 500);
      }
    }
  }

  return _stripeAPI('/v1/payment_intents', params);
}


// ═══════════════════════════════════════════════════════════════
// BOOKING SAVE HELPER
// ═══════════════════════════════════════════════════════════════

/**
 * Save a booking row to the Bookings sheet and the Schedule sheet.
 * Called after successful payment or for pay-later bookings.
 */
function _saveBookingToSheets(data, paymentType, stripePaymentIntentId) {
  var now = new Date().toISOString();
  var cust = data.customer || {};

  // ── Bookings sheet ──
  var bookings = getOrCreateSheet('Bookings', [
    'Timestamp', 'Name', 'Email', 'Phone', 'Address', 'Postcode',
    'Service', 'Date', 'Time', 'Price', 'PaymentType', 'PaymentStatus',
    'StripePaymentIntentID', 'DepositAmount', 'TotalAmount',
    'Distance', 'DriveTime', 'TravelSurcharge', 'Notes',
    'TermsAccepted', 'TermsType', 'TermsTimestamp', 'QuoteBreakdown'
  ]);

  var priceDisplay = data.totalAmount
    ? '£' + (data.totalAmount / 100).toFixed(2)
    : (data.amount ? '£' + (data.amount / 100).toFixed(2) : '');
  var depositDisplay = data.depositAmount
    ? '£' + (data.depositAmount / 100).toFixed(2)
    : '';

  bookings.appendRow([
    now,
    cust.name || '',
    cust.email || '',
    cust.phone || '',
    cust.address || '',
    cust.postcode || '',
    data.serviceName || '',
    data.date || '',
    data.time || '',
    priceDisplay,
    paymentType,                          // 'full_payment', 'deposit', 'pay_later'
    stripePaymentIntentId ? 'paid' : 'pending',
    stripePaymentIntentId || '',
    depositDisplay,
    priceDisplay,
    data.distance || '',
    data.driveTime || '',
    data.travelSurcharge || '',
    data.notes || '',
    data.termsAccepted ? 'Yes' : '',
    data.termsType || '',
    data.termsTimestamp || '',
    typeof data.quoteBreakdown === 'object' ? JSON.stringify(data.quoteBreakdown) : (data.quoteBreakdown || '')
  ]);

  // ── Schedule sheet ──
  var schedule = getOrCreateSheet('Schedule', [
    'Date', 'Time', 'Client', 'Service', 'Postcode', 'Status',
    'Phone', 'Email', 'Price', 'Notes', 'GoogleMapsURL'
  ]);

  schedule.appendRow([
    data.date || '',
    data.time || '',
    cust.name || '',
    data.serviceName || '',
    cust.postcode || '',
    'Confirmed',
    cust.phone || '',
    cust.email || '',
    priceDisplay,
    data.notes || '',
    data.googleMapsUrl || ''
  ]);

  // ── Clients sheet (upsert) ──
  try {
    _upsertClient(cust, data.serviceName, priceDisplay, data.date);
  } catch (e) {
    Logger.log('_upsertClient error: ' + e.message);
  }

  // ── Send confirmation email ──
  try {
    _sendBookingConfirmation(cust, data, paymentType, depositDisplay, priceDisplay);
  } catch (e) {
    Logger.log('Confirmation email error: ' + e.message);
  }

  logActivity('new_booking', {
    customer: cust.name,
    service: data.serviceName,
    date: data.date,
    paymentType: paymentType,
    stripePI: stripePaymentIntentId || 'none'
  });
}

/**
 * Upsert a client into the Clients sheet (add if new, skip if exists by email).
 */
function _upsertClient(cust, service, price, date) {
  if (!cust.email) return;
  var sheet = getOrCreateSheet('Clients', [
    'Name', 'Email', 'Phone', 'Postcode', 'Service', 'Price',
    'Date', 'Status', 'Frequency', 'CreatedAt'
  ]);
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][1] && data[i][1].toString().toLowerCase() === cust.email.toLowerCase()) {
      // Existing client — update last service/date
      sheet.getRange(i + 1, 5).setValue(service || data[i][4]);
      sheet.getRange(i + 1, 6).setValue(price || data[i][5]);
      sheet.getRange(i + 1, 7).setValue(date || data[i][6]);
      return;
    }
  }
  // New client
  sheet.appendRow([
    cust.name || '', cust.email, cust.phone || '', cust.postcode || '',
    service || '', price || '', date || '', 'Active', 'One-off', new Date().toISOString()
  ]);
}

/**
 * Send a booking confirmation email via Gmail.
 */
function _sendBookingConfirmation(cust, data, paymentType, depositDisplay, priceDisplay) {
  if (!cust.email) return;

  var subject = 'Booking Confirmed — Gardners Ground Maintenance';
  var serviceName = data.serviceName || 'your service';
  var dateStr = data.date || 'TBC';
  var timeStr = data.time || '';

  var paymentLine = '';
  if (paymentType === 'full_payment') {
    paymentLine = '<p style="color:#2d6a4f;font-weight:bold;">✅ Payment of ' + priceDisplay + ' received — thank you!</p>';
  } else if (paymentType === 'deposit') {
    paymentLine = '<p style="color:#2d6a4f;font-weight:bold;">✅ Deposit of ' + depositDisplay + ' received. The remainder will be invoiced after completion.</p>';
  } else {
    paymentLine = '<p>Payment will be collected on the day or invoiced after completion.</p>';
  }

  var html = '<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">'
    + '<div style="background:#2d6a4f;padding:20px;border-radius:8px 8px 0 0;text-align:center;">'
    + '<h1 style="color:#fff;margin:0;font-size:22px;">Booking Confirmed ✅</h1></div>'
    + '<div style="background:#f9f9f9;padding:24px;border:1px solid #e0e0e0;border-radius:0 0 8px 8px;">'
    + '<p>Hi ' + (cust.name || 'there') + ',</p>'
    + '<p>Thanks for booking with <strong>Gardners Ground Maintenance</strong>! Here are your details:</p>'
    + '<table style="width:100%;border-collapse:collapse;margin:16px 0;">'
    + '<tr><td style="padding:8px;font-weight:bold;border-bottom:1px solid #e0e0e0;">Service</td><td style="padding:8px;border-bottom:1px solid #e0e0e0;">' + serviceName + '</td></tr>'
    + '<tr><td style="padding:8px;font-weight:bold;border-bottom:1px solid #e0e0e0;">Date</td><td style="padding:8px;border-bottom:1px solid #e0e0e0;">' + dateStr + '</td></tr>'
    + (timeStr ? '<tr><td style="padding:8px;font-weight:bold;border-bottom:1px solid #e0e0e0;">Time</td><td style="padding:8px;border-bottom:1px solid #e0e0e0;">' + timeStr + '</td></tr>' : '')
    + '<tr><td style="padding:8px;font-weight:bold;border-bottom:1px solid #e0e0e0;">Quote</td><td style="padding:8px;border-bottom:1px solid #e0e0e0;">' + priceDisplay + '</td></tr>'
    + '</table>'
    + paymentLine
    + '<p>If you need to make changes, just reply to this email or call us.</p>'
    + '<p style="margin-top:24px;">Cheers,<br><strong>Chris — Gardners Ground Maintenance</strong></p>'
    + '<p style="font-size:12px;color:#888;margin-top:16px;">Roche, Cornwall · <a href="https://www.gardnersgm.co.uk">gardnersgm.co.uk</a></p>'
    + '</div></body></html>';

  MailApp.sendEmail({
    to: cust.email,
    subject: subject,
    htmlBody: html,
    name: 'Gardners Ground Maintenance',
    replyTo: 'christhechef35@gmail.com'
  });
}


// ═══════════════════════════════════════════════════════════════
// BOOKING & PAYMENT HANDLERS (live Stripe integration)
// ═══════════════════════════════════════════════════════════════

/**
 * Full payment at booking time.
 * Called when customer selects "Pay Now" — charges the full quoted amount.
 */
function handleBookingPayment(data) {
  try {
    var amount = parseInt(data.amount) || parseInt(data.totalAmount) || 0;
    if (amount < 100) return { status: 'error', message: 'Invalid payment amount' };

    var cust = data.customer || {};
    var description = (data.serviceName || 'Booking') + ' — ' + (cust.name || 'Customer') + ' — ' + (data.date || '');

    var pi = _createAndConfirmPayment(
      data.paymentMethodId,
      amount,
      description,
      cust,
      {
        type: 'booking_payment',
        service: data.serviceName || '',
        date: data.date || '',
        customer_name: cust.name || '',
        customer_email: cust.email || ''
      }
    );

    // Handle 3D Secure / SCA
    if (pi.status === 'requires_action' || pi.status === 'requires_source_action') {
      return {
        status: 'requires_action',
        clientSecret: pi.client_secret,
        paymentIntentId: pi.id
      };
    }

    if (pi.status === 'succeeded' || pi.status === 'requires_capture') {
      // Payment successful — save booking
      _saveBookingToSheets(data, 'full_payment', pi.id);
      return {
        status: 'success',
        paymentStatus: pi.status,
        paymentIntentId: pi.id
      };
    }

    return { status: 'error', message: 'Payment not completed. Status: ' + pi.status };
  } catch (e) {
    Logger.log('handleBookingPayment error: ' + e.message);
    return { status: 'error', message: e.message };
  }
}

/**
 * 10% deposit payment at booking time.
 * Called when customer selects "Pay Later" — charges 10% deposit.
 */
function handleBookingDeposit(data) {
  try {
    var depositAmount = parseInt(data.depositAmount) || parseInt(data.amount) || 0;
    if (depositAmount < 50) return { status: 'error', message: 'Deposit amount too low' };

    var cust = data.customer || {};
    var totalDisplay = data.totalAmount ? '£' + (data.totalAmount / 100).toFixed(2) : '';
    var description = '10% Deposit — ' + (data.serviceName || 'Booking') + ' — ' + (cust.name || 'Customer') + ' (Total: ' + totalDisplay + ')';

    var pi = _createAndConfirmPayment(
      data.paymentMethodId,
      depositAmount,
      description,
      cust,
      {
        type: 'booking_deposit',
        service: data.serviceName || '',
        date: data.date || '',
        total_amount: String(data.totalAmount || ''),
        deposit_amount: String(depositAmount),
        customer_name: cust.name || '',
        customer_email: cust.email || ''
      }
    );

    // Handle 3D Secure / SCA
    if (pi.status === 'requires_action' || pi.status === 'requires_source_action') {
      return {
        status: 'requires_action',
        clientSecret: pi.client_secret,
        paymentIntentId: pi.id
      };
    }

    if (pi.status === 'succeeded' || pi.status === 'requires_capture') {
      // Deposit successful — save booking
      _saveBookingToSheets(data, 'deposit', pi.id);
      return {
        status: 'success',
        paymentStatus: pi.status,
        paymentIntentId: pi.id
      };
    }

    return { status: 'error', message: 'Deposit not completed. Status: ' + pi.status };
  } catch (e) {
    Logger.log('handleBookingDeposit error: ' + e.message);
    return { status: 'error', message: e.message };
  }
}

/**
 * Pay-later booking — no card charge, just save the booking.
 */
function handleBookingPayLater(data) {
  try {
    _saveBookingToSheets(data, 'pay_later', '');
    return { status: 'success', paymentStatus: 'pay_later' };
  } catch (e) {
    Logger.log('handleBookingPayLater error: ' + e.message);
    return { status: 'error', message: e.message };
  }
}
function handleCancelBooking(data) { return { status: 'success' }; }
function handleCancelSubscription(data) { return { status: 'success' }; }
function handleRescheduleBooking(data) { return { status: 'success' }; }
function handleStripeInvoice(data) { return { status: 'success' }; }
function handleStripeSubscription(data) { return { status: 'success' }; }
function handleStripeWebhook(data) { return { status: 'success' }; }
function handleShopCheckout(data) { return { status: 'success' }; }
function handleQuoteDepositPayment(data) { return { status: 'success' }; }
function handleBespokeEnquiry(data) { return { status: 'success' }; }
function handleContactEnquiry(data) { return { status: 'success' }; }
function handleSubscriptionRequest(data) { return { status: 'success' }; }
function handleFreeVisit(data) { return { status: 'success' }; }
function handleUpdateClient(data) { return { status: 'success' }; }
function handleDeleteClient(data) { return { status: 'success' }; }
function handleUpdateBookingStatus(data) { return { status: 'success' }; }
function handleUpdateStatus(data) { return { status: 'success' }; }
function handleCreateQuote(data) { return { status: 'success' }; }
function handleUpdateQuote(data) { return { status: 'success' }; }
function handleDeleteQuote(data) { return { status: 'success' }; }
function handleQuoteResponse(data) { return { status: 'success' }; }
function handleResendQuote(data) { return { status: 'success' }; }
function handleSendQuoteEmail(data) { return { status: 'success' }; }
function handleUpdateEnquiry(data) { return { status: 'success' }; }
function handleDeleteEnquiry(data) { return { status: 'success' }; }
function handleSendEnquiryReply(data) { return { status: 'success' }; }
function handleUpdateInvoice(data) { return { status: 'success' }; }
function handleDeleteInvoice(data) { return { status: 'success' }; }
function handleMarkInvoicePaid(data) { return { status: 'success' }; }
function handleMarkInvoiceVoid(data) { return { status: 'success' }; }
function handleSendInvoiceEmail(data) { return { status: 'success' }; }
function handleSaveAllocConfig(data) { return { status: 'success' }; }
function handleSaveBusinessCosts(data) { return { status: 'success' }; }
function handleUpdateBusinessCost(data) { return { status: 'success' }; }
function handleUpdateSavingsPot(data) { return { status: 'success' }; }
function handleSaveBlogPost(data) { return { status: 'success' }; }
function handleDeleteBlogPost(data) { return { status: 'success' }; }
function handleFetchBlogImage(data) { return { status: 'success' }; }
function handleSendNewsletter(data) { return { status: 'success' }; }
function handleSubscribeNewsletter(data) { return { status: 'success' }; }
function handleSubmitTestimonial(data) { return { status: 'success' }; }
function handleSubmitComplaint(data) { return { status: 'success' }; }
function handleResolveComplaint(data) { return { status: 'success' }; }
function handleUpdateComplaintStatus(data) { return { status: 'success' }; }
function handleUpdateComplaintNotes(data) { return { status: 'success' }; }
function handlePostVacancy(data) { return { status: 'success' }; }
function handleDeleteVacancy(data) { return { status: 'success' }; }
function handleSubmitApplication(data) { return { status: 'success' }; }
function handleUpdateApplicationStatus(data) { return { status: 'success' }; }
function handleSaveProduct(data) { return { status: 'success' }; }
function handleDeleteProduct(data) { return { status: 'success' }; }
function handleUpdateOrderStatus(data) { return { status: 'success' }; }
function handleGenerateSchedule(data) { return { status: 'success' }; }
function handleSendCompletionEmail(data) { return { status: 'success' }; }
function handleSendBookingConfirmationEmail(data) { return { status: 'success' }; }
function handleProcessEmailLifecycle(data) { return { status: 'success' }; }
function handleChatbotMessage(data) { return { status: 'success' }; }
function handleLogSocialPost(data) { return { status: 'success' }; }
function handleRequestLoginLink(data) { return { status: 'success' }; }
function handleVerifyLoginToken(data) { return { status: 'success' }; }
function handleUpdateCustomerProfile(data) { return { status: 'success' }; }
function handleUpdateEmailPreferences(data) { return { status: 'success' }; }
function handleDeleteCustomerAccount(data) { return { status: 'success' }; }
function handleMobileUpdateJobStatus(data) { return { status: 'success' }; }
function handleMobileStartJob(data) { return { status: 'success' }; }
function handleMobileCompleteJob(data) { return { status: 'success' }; }
function handleMobileSendInvoice(data) { return { status: 'success' }; }
function handleMobileUploadPhoto(data) { return { status: 'success' }; }
function handleSaveFieldNote(data) { return { status: 'success' }; }
function handleSaveBusinessRecommendation(data) { return { status: 'success' }; }
function handleGetServices() { return { status: 'success', services: [] }; }
