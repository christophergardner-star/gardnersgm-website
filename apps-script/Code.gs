// ── SECRETS: Loaded from Script Properties (Project Settings > Script Properties) ──
// Run setupSecrets() once in the Apps Script editor to configure, then delete the values from the function.

// ============================================
// SETUP: Run this ONCE in the Apps Script editor to store secrets
// After running, delete the real values and replace with 'DONE' so
// they aren't sitting in the code. Then redeploy.
// ============================================
function setupSecrets() {
  var props = PropertiesService.getScriptProperties();
  props.setProperties({
    'STRIPE_SECRET_KEY':     'DONE',
    'STRIPE_WEBHOOK_SECRET': 'DONE',
    'TG_BOT_TOKEN':          'DONE',
    'TG_CHAT_ID':            'DONE',
    'ADMIN_API_KEY':         'DONE',
    'GEMINI_API_KEY':        'DONE',
    'PEXELS_API_KEY':        'DONE',
    'MONEYBOT_TOKEN':        'DONE',
    'CONTENTBOT_TOKEN':      'DONE',
    'COACHBOT_TOKEN':        'DONE',
    'BREVO_API_KEY':         'DONE',
    'SUPABASE_URL':          'DONE',
    'SUPABASE_SERVICE_KEY':  'DONE'
  });
  Logger.log('✅ All secrets stored — includes 4 bot tokens + Brevo email + Supabase.');
}


// ============================================
// MASTER SPREADSHEET ID (single source of truth)
// ============================================
var SPREADSHEET_ID = '1_Y7yHIpAvv_VNBhTrwNOQaBMAGa3UlVW_FKlf56ouHk';

// ============================================
// HUB EMAIL OWNERSHIP FLAG
// When true, Hub owns lifecycle emails — GAS skips auto-sends for:
//   enquiry auto-reply, booking confirmation, cancellation, reschedule
// GAS still acts as transport when Hub requests a send via POST action.
// Set to false to revert to GAS sending these independently.
// ============================================
var HUB_OWNS_EMAILS = true;

// ============================================
// STRIPE — API Helpers
// ============================================

/**
 * Make an authenticated request to the Stripe API.
 * @param {string} endpoint - e.g. '/v1/customers'
 * @param {string} method - 'get', 'post', 'delete'
 * @param {Object} [params] - key-value pairs (form-encoded)
 * @returns {Object} parsed JSON response
 */
function stripeRequest(endpoint, method, params) {
  var key = PropertiesService.getScriptProperties().getProperty('STRIPE_SECRET_KEY');
  if (!key) throw new Error('STRIPE_SECRET_KEY not set — run setupSecrets()');
  var options = {
    method: method || 'get',
    headers: { 'Authorization': 'Bearer ' + key },
    muteHttpExceptions: true
  };
  if (params && (method === 'post' || method === 'delete')) {
    options.payload = params;
  }
  var response = UrlFetchApp.fetch('https://api.stripe.com' + endpoint, options);
  var code = response.getResponseCode();
  var body = JSON.parse(response.getContentText());
  if (code >= 400) {
    Logger.log('Stripe API error (' + code + '): ' + JSON.stringify(body));
    throw new Error('Stripe ' + code + ': ' + ((body.error && body.error.message) || JSON.stringify(body)));
  }
  return body;
}

/**
 * Find or create a Stripe customer by email.
 */
function findOrCreateCustomer(email, name, phone, address, postcode) {
  // Search for existing customer
  var search = stripeRequest('/v1/customers?email=' + encodeURIComponent(email) + '&limit=1', 'get');
  if (search.data && search.data.length > 0) {
    return search.data[0];
  }
  // Create new customer
  var params = {
    'email': email,
    'name': name || '',
    'phone': phone || ''
  };
  if (address) params['address[line1]'] = address;
  if (postcode) params['address[postal_code]'] = postcode;
  params['address[country]'] = 'GB';
  return stripeRequest('/v1/customers', 'post', params);
}

/**
 * Create a Stripe Checkout Session for one-off payments.
 */
function createStripeCheckoutSession(params) {
  return stripeRequest('/v1/checkout/sessions', 'post', params);
}

/**
 * Verify Stripe webhook signature.
 */
function verifyStripeSignature(payload, sigHeader, secret) {
  if (!secret) return true; // Skip verification if no secret set
  try {
    var parts = {};
    sigHeader.split(',').forEach(function(item) {
      var kv = item.split('=');
      parts[kv[0].trim()] = kv[1];
    });
    var timestamp = parts['t'];
    var expectedSig = parts['v1'];
    var signedPayload = timestamp + '.' + payload;
    var hmac = Utilities.computeHmacSha256Signature(signedPayload, secret);
    var hexHmac = hmac.map(function(b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('');
    return hexHmac === expectedSig;
  } catch (e) {
    Logger.log('Stripe signature verification error: ' + e);
    return false;
  }
}


// ============================================
// STRIPE — Webhook Handler
// ============================================

function handleStripeWebhook(e) {
  var body = JSON.parse(e.postData.contents);
  var event = body;
  
  Logger.log('Stripe webhook: ' + event.type + ' (' + event.id + ')');
  
  try {
    switch (event.type) {
      // ── Invoice events ──
      case 'invoice.paid':
        handleStripeInvoicePaid(event.data.object);
        break;
      case 'invoice.payment_failed':
        handleStripeInvoiceFailed(event.data.object);
        break;
      case 'invoice.created':
        handleStripeInvoiceCreated(event.data.object);
        break;
      case 'invoice.finalized':
        Logger.log('Invoice finalized: ' + event.data.object.id);
        break;
      case 'invoice.upcoming':
        handleStripeInvoiceUpcoming(event.data.object);
        break;

      // ── Checkout events ──
      case 'checkout.session.completed':
        handleCheckoutComplete(event.data.object);
        break;
      case 'checkout.session.expired':
        handleCheckoutExpired(event.data.object);
        break;

      // ── Payment intent events (one-off bookings) ──
      case 'payment_intent.succeeded':
        handlePaymentIntentSucceeded(event.data.object);
        break;
      case 'payment_intent.payment_failed':
        handlePaymentIntentFailed(event.data.object);
        break;
      case 'payment_intent.requires_action':
        handlePaymentIntentRequiresAction(event.data.object);
        break;

      // ── Subscription lifecycle events ──
      case 'customer.subscription.created':
        handleStripeSubCreated(event.data.object);
        break;
      case 'customer.subscription.updated':
        handleStripeSubUpdated(event.data.object);
        break;
      case 'customer.subscription.deleted':
        handleStripeSubCancelled(event.data.object);
        break;
      case 'customer.subscription.paused':
        handleStripeSubPaused(event.data.object);
        break;
      case 'customer.subscription.resumed':
        handleStripeSubResumed(event.data.object);
        break;
      case 'customer.subscription.trial_will_end':
        handleStripeSubTrialEnding(event.data.object);
        break;

      // ── Charge events (refunds, disputes) ──
      case 'charge.succeeded':
        Logger.log('Charge succeeded: ' + event.data.object.id + ' — £' + (event.data.object.amount / 100).toFixed(2));
        break;
      case 'charge.refunded':
        handleChargeRefunded(event.data.object);
        break;
      case 'charge.dispute.created':
        handleDisputeCreated(event.data.object);
        break;
      case 'charge.dispute.closed':
        handleDisputeClosed(event.data.object);
        break;

      default:
        Logger.log('Unhandled Stripe event: ' + event.type);
        notifyBot('moneybot', '⚙️ *Stripe Event*\n\n📋 ' + event.type + '\n🆔 ' + event.id + '\n\n_No handler — logged only_');
    }
  } catch (err) {
    Logger.log('Stripe webhook error: ' + err);
    notifyBot('moneybot', '❌ *Stripe Webhook Error*\n\n📋 Event: ' + event.type + '\n🆔 ' + event.id + '\n❌ ' + err.message);
  }
  
  return ContentService.createTextOutput(JSON.stringify({ received: true })).setMimeType(ContentService.MimeType.JSON);
}

function handleStripeInvoicePaid(invoice) {
  var custEmail = invoice.customer_email || '';
  var amount = '£' + (invoice.amount_paid / 100).toFixed(2);
  var invoiceUrl = invoice.hosted_invoice_url || '';
  var now = new Date().toISOString();
  
  // Use the canonical updateInvoiceStatus() which properly calls markJobAsPaid()
  // This sets: Invoices → Status "Paid", Date Paid, Payment Method "Stripe"
  //            Jobs    → Col R "Yes", Col S "Stripe", Col L "Completed"
  var updated = false;
  try {
    if (invoice.id) {
      updated = updateInvoiceStatus(invoice.id, 'Paid', now, 'Stripe');
    }
  } catch(e) { Logger.log('updateInvoiceStatus error: ' + e); }
  
  // Fallback: if Stripe invoice ID wasn't found in Invoices sheet,
  // try matching by email + "Sent" status
  if (!updated && custEmail) {
    try {
      var invSheet = SpreadsheetApp.openById('1_Y7yHIpAvv_VNBhTrwNOQaBMAGa3UlVW_FKlf56ouHk').getSheetByName('Invoices');
      if (invSheet) {
        var invData = invSheet.getDataRange().getValues();
        for (var r = invData.length - 1; r >= 0; r--) {
          if (String(invData[r][3]).toLowerCase() === custEmail.toLowerCase() && 
              String(invData[r][5]) === 'Sent') {
            invSheet.getRange(r + 1, 6).setValue('Paid');
            invSheet.getRange(r + 1, 11).setValue(now);
            invSheet.getRange(r + 1, 12).setValue('Stripe');
            // Also mark the linked job as paid via the canonical function
            var jobNum = String(invData[r][1]);
            if (jobNum) {
              markJobAsPaid(jobNum, 'Stripe');
            }
            updated = true;
            break;
          }
        }
      }
    } catch(e) { Logger.log('Invoice paid fallback update: ' + e); }
  }
  
  // Last resort: if no invoice record matched, find the job directly by email
  if (!updated && custEmail) {
    try {
      var sheet = SpreadsheetApp.openById('1_Y7yHIpAvv_VNBhTrwNOQaBMAGa3UlVW_FKlf56ouHk').getSheetByName('Jobs');
      var data = sheet.getDataRange().getValues();
      for (var r = data.length - 1; r >= 0; r--) {
        if (String(data[r][3]).toLowerCase() === custEmail.toLowerCase() && 
            (String(data[r][11]).toLowerCase() === 'invoiced' || String(data[r][17]) === 'Balance Due')) {
          sheet.getRange(r + 1, 18).setValue('Yes');        // Col R = Paid
          sheet.getRange(r + 1, 19).setValue('Stripe');     // Col S = Payment Type
          sheet.getRange(r + 1, 12).setValue('Completed');  // Col L = Status
          break;
        }
      }
    } catch(e) { Logger.log('Invoice paid direct job update: ' + e); }
  }
  
  notifyBot('moneybot', '💰 *Invoice Paid!*\n━━━━━━━━━━━━━━━━━━━━\n💵 ' + amount + '\n📧 ' + custEmail + '\n🆔 ' + invoice.id);

  // Send payment confirmation email to customer
  if (custEmail) {
    try {
      var jobNum = '';
      var service = '';
      var custName = '';
      // Look up job details from Invoices sheet
      try {
        var invSheet2 = SpreadsheetApp.openById('1_Y7yHIpAvv_VNBhTrwNOQaBMAGa3UlVW_FKlf56ouHk').getSheetByName('Invoices');
        if (invSheet2) {
          var invData2 = invSheet2.getDataRange().getValues();
          for (var r2 = invData2.length - 1; r2 >= 0; r2--) {
            if (invoice.id && String(invData2[r2][6] || '').indexOf(invoice.id) >= 0) {
              jobNum = String(invData2[r2][1] || '');
              custName = String(invData2[r2][2] || '');
              service = String(invData2[r2][9] || '');
              break;
            }
          }
        }
      } catch(lookupErr) { Logger.log('Invoice paid lookup error: ' + lookupErr); }
      sendPaymentReceivedEmail({
        email: custEmail,
        name: custName || custEmail,
        amount: (invoice.amount_paid / 100).toFixed(2),
        service: service,
        jobNumber: jobNum,
        paymentMethod: 'Stripe'
      });
    } catch(emailErr) { Logger.log('Payment received email error: ' + emailErr); }
  }
}

function handleStripeInvoiceFailed(invoice) {
  var custEmail = invoice.customer_email || '';
  var amount = '£' + (invoice.amount_due / 100).toFixed(2);
  
  // Update Invoices sheet status to Overdue
  try {
    var invSheet = SpreadsheetApp.openById('1_Y7yHIpAvv_VNBhTrwNOQaBMAGa3UlVW_FKlf56ouHk').getSheetByName('Invoices');
    if (invSheet) {
      var invData = invSheet.getDataRange().getValues();
      for (var r = invData.length - 1; r >= 0; r--) {
        if ((invoice.id && String(invData[r][6]).indexOf(invoice.id) >= 0) ||
            (custEmail && String(invData[r][3]).toLowerCase() === custEmail.toLowerCase() && String(invData[r][5]) === 'Sent')) {
          invSheet.getRange(r + 1, 6).setValue('Overdue');
          break;
        }
      }
    }
  } catch(e) { Logger.log('Invoice failed sheet update: ' + e); }
  
  notifyBot('moneybot', '❌ *Payment Failed*\n━━━━━━━━━━━━━━━━━━━━\n💵 ' + amount + '\n📧 ' + custEmail + '\n🆔 ' + invoice.id + '\n\n⚠️ _Contact customer about failed payment_');
}

function handleCheckoutComplete(session) {
  var custEmail = session.customer_email || session.customer_details?.email || '';
  var amount = session.amount_total ? '£' + (session.amount_total / 100).toFixed(2) : '';
  var metadata = session.metadata || {};
  
  if (metadata.type === 'shop_order') {
    // Update order status
    try {
      var ordSheet = SpreadsheetApp.openById('1_Y7yHIpAvv_VNBhTrwNOQaBMAGa3UlVW_FKlf56ouHk').getSheetByName('Orders');
      if (ordSheet) {
        var ordData = ordSheet.getDataRange().getValues();
        for (var r = ordData.length - 1; r >= 0; r--) {
          if (String(ordData[r][0]) === metadata.order_id) {
            ordSheet.getRange(r + 1, 12).setValue('paid');
            ordSheet.getRange(r + 1, 13).setValue(session.payment_intent || '');
            break;
          }
        }
      }
    } catch(e) {}
    notifyBot('moneybot', '🛒 *Shop Order Paid!*\n💵 ' + amount + '\n📧 ' + custEmail + '\n🔖 ' + (metadata.order_id || ''));
  } else if (metadata.type === 'quote_deposit') {
    notifyBot('moneybot', '💰 *Quote Deposit Paid!*\n💵 ' + amount + '\n📧 ' + custEmail + '\n🔖 Quote: ' + (metadata.quote_id || ''));
  } else {
    notifyBot('moneybot', '💰 *Checkout Complete!*\n💵 ' + amount + '\n📧 ' + custEmail);
  }
}

function handleStripeSubCancelled(subscription) {
  var custId = subscription.customer || '';
  var custEmail = '';
  try {
    var cust = stripeRequest('/v1/customers/' + custId, 'get');
    custEmail = cust.email || '';
  } catch(e) {}
  
  // Update Jobs sheet — find subscription jobs and mark cancelled
  try {
    var sheet = SpreadsheetApp.openById('1_Y7yHIpAvv_VNBhTrwNOQaBMAGa3UlVW_FKlf56ouHk').getSheetByName('Jobs');
    if (sheet && custEmail) {
      var data = sheet.getDataRange().getValues();
      for (var r = data.length - 1; r >= 0; r--) {
        if (String(data[r][3]).toLowerCase() === custEmail.toLowerCase() &&
            String(data[r][1]).toLowerCase() === 'subscription' &&
            String(data[r][18]).indexOf(subscription.id) >= 0) {
          sheet.getRange(r + 1, 12).setValue('Cancelled');  // Col L = Status
          break;
        }
      }
    }
  } catch(e) { Logger.log('Sub cancelled sheet update: ' + e); }
  
  notifyBot('moneybot', '🔴 *Subscription Cancelled*\n📧 ' + (custEmail || custId) + '\n🆔 ' + subscription.id);
}


// ============================================
// STRIPE — Subscription Lifecycle Handlers
// ============================================

/**
 * Helper: look up Stripe customer email from customer ID
 */
function getStripeCustomerEmail_(custId) {
  if (!custId) return '';
  try {
    var cust = stripeRequest('/v1/customers/' + custId, 'get');
    return cust.email || '';
  } catch(e) { return ''; }
}

/**
 * Helper: find a subscription job row by Stripe subscription ID
 * Returns { rowIndex (1-based), row (array) } or null
 */
function findSubJobByStripeId_(subId) {
  if (!subId) return null;
  try {
    var sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName('Jobs');
    if (!sheet) return null;
    var data = sheet.getDataRange().getValues();
    for (var r = data.length - 1; r >= 0; r--) {
      if (String(data[r][1]).toLowerCase() === 'subscription' &&
          String(data[r][18]).indexOf(subId) >= 0) {
        return { rowIndex: r + 1, row: data[r], sheet: sheet };
      }
    }
  } catch(e) { Logger.log('findSubJobByStripeId_ error: ' + e); }
  return null;
}

function handleStripeSubCreated(subscription) {
  var custEmail = getStripeCustomerEmail_(subscription.customer);
  var status = subscription.status || 'unknown';
  var amount = subscription.items && subscription.items.data && subscription.items.data[0]
    ? '£' + (subscription.items.data[0].price.unit_amount / 100).toFixed(2)
    : '';
  var interval = subscription.items && subscription.items.data && subscription.items.data[0]
    ? subscription.items.data[0].price.recurring.interval
    : '';

  Logger.log('Stripe subscription created: ' + subscription.id + ' for ' + custEmail);

  notifyBot('moneybot', '🆕 *Subscription Created*\n━━━━━━━━━━━━━━━━━━━━\n📧 ' + (custEmail || subscription.customer) +
    '\n💰 ' + amount + '/' + interval +
    '\n📊 Status: ' + status +
    '\n🆔 ' + subscription.id);
}

function handleStripeSubUpdated(subscription) {
  var custEmail = getStripeCustomerEmail_(subscription.customer);
  var status = subscription.status || 'unknown';
  var cancelAt = subscription.cancel_at_period_end;
  var amount = subscription.items && subscription.items.data && subscription.items.data[0]
    ? '£' + (subscription.items.data[0].price.unit_amount / 100).toFixed(2)
    : '';
  var interval = subscription.items && subscription.items.data && subscription.items.data[0]
    ? subscription.items.data[0].price.recurring.interval
    : '';

  Logger.log('Stripe subscription updated: ' + subscription.id + ' status=' + status);

  // Update Jobs sheet status based on subscription status
  var match = findSubJobByStripeId_(subscription.id);
  if (match) {
    try {
      if (status === 'past_due') {
        match.sheet.getRange(match.rowIndex, 12).setValue('Payment Overdue');
        notifyBot('moneybot', '⚠️ *Subscription PAST DUE*\n━━━━━━━━━━━━━━━━━━━━\n📧 ' + custEmail +
          '\n💰 ' + amount + '/' + interval +
          '\n🔖 ' + String(match.row[19] || '') +
          '\n\n⚡ _Payment failed — follow up with customer_');
        return;
      } else if (status === 'unpaid') {
        match.sheet.getRange(match.rowIndex, 12).setValue('Unpaid');
        notifyBot('moneybot', '🚨 *Subscription UNPAID*\n━━━━━━━━━━━━━━━━━━━━\n📧 ' + custEmail +
          '\n💰 ' + amount + '/' + interval +
          '\n🔖 ' + String(match.row[19] || '') +
          '\n\n⚡ _All retry attempts failed — contact customer urgently_');
        return;
      } else if (status === 'active' && String(match.row[11]).toLowerCase() !== 'completed') {
        // Reactivated or payment recovered
        var prevStatus = String(match.row[11]).toLowerCase();
        if (prevStatus === 'payment overdue' || prevStatus === 'unpaid' || prevStatus === 'paused') {
          match.sheet.getRange(match.rowIndex, 12).setValue('Active');
          notifyBot('moneybot', '✅ *Subscription Reactivated*\n━━━━━━━━━━━━━━━━━━━━\n📧 ' + custEmail +
            '\n💰 ' + amount + '/' + interval +
            '\n🔖 ' + String(match.row[19] || '') +
            '\n\n_Payment recovered — subscription active again_');
          return;
        }
      }
    } catch(e) { Logger.log('Sub updated sheet error: ' + e); }
  }

  // Generic update notification
  var updateMsg = '🔄 *Subscription Updated*\n━━━━━━━━━━━━━━━━━━━━\n📧 ' + (custEmail || subscription.customer) +
    '\n💰 ' + amount + '/' + interval +
    '\n📊 Status: ' + status;
  if (cancelAt) updateMsg += '\n⏳ *Cancels at period end*';
  updateMsg += '\n🆔 ' + subscription.id;
  notifyBot('moneybot', updateMsg);
}

function handleStripeSubPaused(subscription) {
  var custEmail = getStripeCustomerEmail_(subscription.customer);

  // Update Jobs sheet
  var match = findSubJobByStripeId_(subscription.id);
  if (match) {
    try {
      match.sheet.getRange(match.rowIndex, 12).setValue('Paused');
    } catch(e) { Logger.log('Sub paused sheet error: ' + e); }
  }

  notifyBot('moneybot', '⏸️ *Subscription Paused*\n━━━━━━━━━━━━━━━━━━━━\n📧 ' + (custEmail || subscription.customer) +
    '\n🆔 ' + subscription.id +
    '\n\n_No payments will be collected until resumed_');
}

function handleStripeSubResumed(subscription) {
  var custEmail = getStripeCustomerEmail_(subscription.customer);

  // Update Jobs sheet
  var match = findSubJobByStripeId_(subscription.id);
  if (match) {
    try {
      match.sheet.getRange(match.rowIndex, 12).setValue('Active');
    } catch(e) { Logger.log('Sub resumed sheet error: ' + e); }
  }

  notifyBot('moneybot', '▶️ *Subscription Resumed*\n━━━━━━━━━━━━━━━━━━━━\n📧 ' + (custEmail || subscription.customer) +
    '\n🆔 ' + subscription.id +
    '\n\n_Payments will resume on next billing date_');
}

function handleStripeSubTrialEnding(subscription) {
  var custEmail = getStripeCustomerEmail_(subscription.customer);
  var trialEnd = subscription.trial_end
    ? new Date(subscription.trial_end * 1000).toLocaleDateString('en-GB')
    : 'unknown';

  notifyBot('moneybot', '⏰ *Trial Ending Soon*\n━━━━━━━━━━━━━━━━━━━━\n📧 ' + (custEmail || subscription.customer) +
    '\n📅 Trial ends: ' + trialEnd +
    '\n🆔 ' + subscription.id +
    '\n\n_First payment will be charged after trial ends_');
}


// ============================================
// STRIPE — Invoice Lifecycle Handlers
// ============================================

function handleStripeInvoiceCreated(invoice) {
  // Only notify for subscription invoices (not manually created ones we already track)
  if (invoice.subscription) {
    var custEmail = invoice.customer_email || '';
    var amount = '£' + ((invoice.amount_due || 0) / 100).toFixed(2);
    Logger.log('Subscription invoice created: ' + invoice.id + ' for ' + custEmail + ' — ' + amount);
    // Don't notify for every subscription invoice creation — too noisy
    // The invoice.paid event handles the important bit
  }
}

function handleStripeInvoiceUpcoming(invoice) {
  // Stripe sends this ~3 days before a subscription invoice is due
  var custEmail = invoice.customer_email || '';
  var amount = '£' + ((invoice.amount_due || 0) / 100).toFixed(2);
  var dueDate = invoice.next_payment_attempt
    ? new Date(invoice.next_payment_attempt * 1000).toLocaleDateString('en-GB')
    : 'soon';

  notifyBot('moneybot', '📅 *Upcoming Subscription Payment*\n\n📧 ' + custEmail +
    '\n💰 ' + amount +
    '\n📅 Due: ' + dueDate +
    '\n\n_Auto-payment will be attempted_');
}


// ============================================
// STRIPE — Payment Intent Handlers (One-Off Bookings)
// ============================================

function handlePaymentIntentSucceeded(paymentIntent) {
  var custEmail = paymentIntent.receipt_email || '';
  var amount = '£' + ((paymentIntent.amount || 0) / 100).toFixed(2);
  var metadata = paymentIntent.metadata || {};
  var jobNum = metadata.jobNumber || '';

  Logger.log('PaymentIntent succeeded: ' + paymentIntent.id + ' — ' + amount + ' from ' + custEmail);

  // Handle quote deposit payments (especially after 3DS confirmation)
  if (metadata.type === 'quote_deposit' && metadata.quoteRef) {
    try {
      var qSheet = getOrCreateQuotesSheet();
      var qData = qSheet.getDataRange().getValues();
      for (var q = 1; q < qData.length; q++) {
        if (String(qData[q][0]) === metadata.quoteRef) {
          qSheet.getRange(q + 1, 17).setValue('Deposit Paid');  // Col Q = Status
          Logger.log('Quote ' + metadata.quoteRef + ' marked as Deposit Paid (via PI webhook)');
          break;
        }
      }
    } catch(qErr) { Logger.log('Quote deposit status update error: ' + qErr); }
    // Also update Jobs sheet
    var depAmt = (paymentIntent.amount || 0) / 100;
    try { markJobDepositPaid(metadata.jobNumber || '', depAmt, metadata.quoteRef); } catch(jdErr) { Logger.log('PI webhook job deposit update: ' + jdErr); }

    // Create Google Calendar event for the confirmed job
    try {
      var qSheet2 = getOrCreateQuotesSheet();
      var qData2 = qSheet2.getDataRange().getValues();
      for (var q2 = 1; q2 < qData2.length; q2++) {
        if (String(qData2[q2][0]) === metadata.quoteRef) {
          var qNotes = String(qData2[q2][21] || '');
          var calDate2 = '';
          var calTime2 = '';
          var pdm2 = qNotes.match(/PREFERRED_DATE:([^.]*)/);
          if (pdm2) calDate2 = pdm2[1].trim();
          var ptm2 = qNotes.match(/PREFERRED_TIME:([^.]*)/);
          if (ptm2) calTime2 = ptm2[1].trim();
          if (calDate2) {
            createCalendarEvent(
              metadata.customerName || String(qData2[q2][2] || ''),
              String(qData2[q2][7] || 'Garden Service'),
              calDate2, calTime2,
              String(qData2[q2][5] || ''), String(qData2[q2][6] || ''),
              metadata.jobNumber || ''
            );
            Logger.log('Google Calendar event created via PI webhook for ' + metadata.quoteRef);
          }
          break;
        }
      }
    } catch(calErr2) { Logger.log('PI webhook calendar event error: ' + calErr2); }
  }

  // Update job as paid if we have a job number
  if (jobNum) {
    try {
      markJobAsPaid(jobNum, 'Stripe');
    } catch(e) { Logger.log('PI succeeded markJobAsPaid error: ' + e); }
  }

  // Notify Telegram
  if (metadata.service || metadata.jobNumber || metadata.type === 'quote_deposit') {
    notifyBot('moneybot', '✅ *Payment Received*\n━━━━━━━━━━━━━━━━━━━━\n💵 ' + amount +
      '\n📧 ' + custEmail +
      (jobNum ? '\n🔖 ' + jobNum : '') +
      (metadata.quoteRef ? '\n📋 Quote: ' + metadata.quoteRef : '') +
      (metadata.service ? '\n📋 ' + metadata.service : '') +
      '\n🆔 ' + paymentIntent.id);
  }

  // Send payment confirmation email to customer
  if (custEmail) {
    try {
      sendPaymentReceivedEmail({
        email: custEmail,
        name: metadata.customerName || custEmail,
        amount: ((paymentIntent.amount || 0) / 100).toFixed(2),
        service: metadata.service || 'Quote Deposit',
        jobNumber: jobNum,
        paymentMethod: 'Stripe'
      });
    } catch(emailErr) { Logger.log('PI payment received email error: ' + emailErr); }
  }
}

function handlePaymentIntentFailed(paymentIntent) {
  var custEmail = paymentIntent.receipt_email || paymentIntent.last_payment_error?.payment_method?.billing_details?.email || '';
  var amount = '£' + ((paymentIntent.amount || 0) / 100).toFixed(2);
  var metadata = paymentIntent.metadata || {};
  var failReason = (paymentIntent.last_payment_error && paymentIntent.last_payment_error.message) || 'Unknown error';

  notifyBot('moneybot', '❌ *Payment FAILED*\n━━━━━━━━━━━━━━━━━━━━\n💵 ' + amount +
    '\n📧 ' + custEmail +
    (metadata.jobNumber ? '\n🔖 ' + metadata.jobNumber : '') +
    (metadata.service ? '\n📋 ' + metadata.service : '') +
    '\n❌ ' + failReason +
    '\n🆔 ' + paymentIntent.id +
    '\n\n⚠️ _Customer may need to retry with a different card_');
}

function handlePaymentIntentRequiresAction(paymentIntent) {
  var custEmail = paymentIntent.receipt_email || '';
  var amount = '£' + ((paymentIntent.amount || 0) / 100).toFixed(2);
  var metadata = paymentIntent.metadata || {};

  notifyBot('moneybot', '🔐 *3D Secure Required*\n\n💵 ' + amount +
    '\n📧 ' + custEmail +
    (metadata.jobNumber ? '\n🔖 ' + metadata.jobNumber : '') +
    '\n\n_Customer needs to complete 3D Secure authentication_');
}


// ============================================
// STRIPE — Checkout Session Handlers
// ============================================

function handleCheckoutExpired(session) {
  var custEmail = session.customer_email || (session.customer_details ? session.customer_details.email : '') || '';
  var amount = session.amount_total ? '£' + (session.amount_total / 100).toFixed(2) : '';
  var metadata = session.metadata || {};

  notifyBot('moneybot', '⏰ *Checkout Expired*\n\n💵 ' + amount +
    '\n📧 ' + custEmail +
    (metadata.type ? '\n📋 Type: ' + metadata.type : '') +
    '\n\n_Customer abandoned checkout — payment not completed_');
}


// ============================================
// STRIPE — Charge Event Handlers (Refunds & Disputes)
// ============================================

function handleChargeRefunded(charge) {
  var custEmail = charge.billing_details ? charge.billing_details.email : '';
  var refundedAmount = '£' + ((charge.amount_refunded || 0) / 100).toFixed(2);
  var totalAmount = '£' + ((charge.amount || 0) / 100).toFixed(2);
  var isFullRefund = charge.refunded;

  // Update Invoices sheet if we can find a matching record
  try {
    var invSheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName('Invoices');
    if (invSheet && charge.payment_intent) {
      var invData = invSheet.getDataRange().getValues();
      for (var r = invData.length - 1; r >= 0; r--) {
        // Check if Stripe invoice ID column contains our charge's payment intent
        if (String(invData[r][6]).indexOf(charge.payment_intent) >= 0) {
          invSheet.getRange(r + 1, 6).setValue(isFullRefund ? 'Refunded' : 'Partial Refund');
          break;
        }
      }
    }
  } catch(e) { Logger.log('Charge refunded sheet update: ' + e); }

  notifyBot('moneybot', '💸 *' + (isFullRefund ? 'Full' : 'Partial') + ' Refund Processed*\n━━━━━━━━━━━━━━━━━━━━\n💵 ' +
    refundedAmount + (isFullRefund ? '' : ' of ' + totalAmount) +
    '\n📧 ' + (custEmail || charge.customer || '') +
    '\n🆔 ' + charge.id);
}

function handleDisputeCreated(dispute) {
  var amount = '£' + ((dispute.amount || 0) / 100).toFixed(2);
  var reason = dispute.reason || 'unknown';
  var chargeId = dispute.charge || '';

  notifyBot('moneybot', '🚨🚨 *DISPUTE / CHARGEBACK* 🚨🚨\n━━━━━━━━━━━━━━━━━━━━\n💵 ' + amount +
    '\n📋 Reason: ' + reason +
    '\n🆔 Charge: ' + chargeId +
    '\n🆔 Dispute: ' + (dispute.id || '') +
    '\n\n⚠️ *URGENT — Respond in Stripe Dashboard within the deadline!*\n_Go to stripe.com/dashboard → Disputes_');
}

function handleDisputeClosed(dispute) {
  var amount = '£' + ((dispute.amount || 0) / 100).toFixed(2);
  var status = dispute.status || 'unknown';
  var won = status === 'won';

  notifyBot('moneybot', (won ? '✅' : '❌') + ' *Dispute Closed — ' + (won ? 'WON' : 'LOST') + '*\n━━━━━━━━━━━━━━━━━━━━\n💵 ' + amount +
    '\n📊 Status: ' + status +
    '\n🆔 ' + (dispute.id || ''));
}


// ============================================
// SUPABASE — DUAL-WRITE HELPERS
// All data writes should call supabaseUpsert() after Sheets write.
// Fails silently — Sheets remains the source of truth during migration.
// ============================================

/**
 * Upsert a row into a Supabase table.
 * @param {string} table - Table name (e.g. 'clients', 'quotes')
 * @param {Object} data - Row data to upsert
 * @param {string} [onConflict] - Conflict column for upsert (e.g. 'quote_number')
 * @returns {boolean} true if successful
 */
function supabaseUpsert(table, data, onConflict) {
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty('SUPABASE_URL');
  var key = props.getProperty('SUPABASE_SERVICE_KEY');
  if (!url || !key) return false;

  try {
    var endpoint = url + '/rest/v1/' + table;
    var headers = {
      'apikey': key,
      'Authorization': 'Bearer ' + key,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates'
    };
    if (onConflict) {
      headers['Prefer'] += ',on_conflict=' + onConflict;
      // PostgREST uses query param for on_conflict
      endpoint += '?on_conflict=' + onConflict;
    }

    var resp = UrlFetchApp.fetch(endpoint, {
      method: 'post',
      headers: headers,
      payload: JSON.stringify(data),
      muteHttpExceptions: true
    });

    var code = resp.getResponseCode();
    if (code >= 200 && code < 300) {
      return true;
    } else {
      Logger.log('Supabase upsert ' + table + ' failed (' + code + '): ' + resp.getContentText().substring(0, 200));
      return false;
    }
  } catch (e) {
    Logger.log('Supabase upsert ' + table + ' error: ' + e);
    return false;
  }
}

/**
 * Insert a row into a Supabase table (no conflict resolution).
 * @param {string} table - Table name
 * @param {Object} data - Row data
 * @returns {boolean} true if successful
 */
function supabaseInsert(table, data) {
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty('SUPABASE_URL');
  var key = props.getProperty('SUPABASE_SERVICE_KEY');
  if (!url || !key) return false;

  try {
    var resp = UrlFetchApp.fetch(url + '/rest/v1/' + table, {
      method: 'post',
      headers: {
        'apikey': key,
        'Authorization': 'Bearer ' + key,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      payload: JSON.stringify(data),
      muteHttpExceptions: true
    });

    var code = resp.getResponseCode();
    if (code >= 200 && code < 300) {
      return true;
    } else {
      Logger.log('Supabase insert ' + table + ' failed (' + code + '): ' + resp.getContentText().substring(0, 200));
      return false;
    }
  } catch (e) {
    Logger.log('Supabase insert ' + table + ' error: ' + e);
    return false;
  }
}

/**
 * Centralized Supabase dual-write mirror for POST actions.
 * Fire-and-forget: never blocks or affects the main Sheets flow.
 * Called from doPost() before each handler returns.
 */
function mirrorActionToSupabase(action, data) {
  try {
    switch(action) {

      // ── Invoices ──
      case 'mark_invoice_paid':
        supabaseUpsert('invoices', {
          invoice_number: data.invoiceNumber,
          status: 'Paid',
          paid_date: new Date().toISOString(),
          payment_method: data.paymentMethod || 'Bank Transfer'
        }, 'invoice_number');
        break;
      case 'mark_invoice_void':
        supabaseUpsert('invoices', {
          invoice_number: data.invoiceNumber,
          status: 'Void'
        }, 'invoice_number');
        break;
      case 'update_invoice':
        var invD = { invoice_number: data.invoiceNumber };
        if (data.clientName) invD.client_name = data.clientName;
        if (data.clientEmail) invD.client_email = data.clientEmail;
        if (data.amount) invD.amount = parseFloat(data.amount) || 0;
        if (data.status) invD.status = data.status;
        if (data.issueDate) invD.issue_date = data.issueDate;
        if (data.dueDate) invD.due_date = data.dueDate;
        if (data.paidDate) invD.paid_date = data.paidDate;
        if (data.notes !== undefined) invD.notes = data.notes;
        supabaseUpsert('invoices', invD, 'invoice_number');
        break;

      // ── Enquiries ──
      case 'update_enquiry':
        var enqD = {};
        if (data.email) enqD.email = data.email;
        if (data.status) enqD.status = data.status;
        if (data.notes !== undefined) enqD.notes = data.notes;
        if (data.name) enqD.name = data.name;
        if (data.phone) enqD.phone = data.phone;
        if (Object.keys(enqD).length > 1) supabaseUpsert('enquiries', enqD, 'email');
        break;
      case 'contact_enquiry':
        supabaseInsert('enquiries', {
          name: data.name || '',
          email: data.email || '',
          phone: data.phone || '',
          message: (data.subject ? data.subject + ': ' : '') + (data.message || ''),
          status: 'New',
          type: 'Contact'
        });
        break;

      // ── Blog ──
      case 'save_blog_post':
        var bpD = {
          title: data.title || '',
          content: data.content || '',
          status: data.status || 'draft',
          category: data.category || '',
          tags: data.tags || '',
          author: data.author || 'Chris',
          excerpt: data.excerpt || '',
          image_url: data.imageUrl || ''
        };
        if (data.postId) { bpD.id = data.postId; supabaseUpsert('blog_posts', bpD, 'id'); }
        else supabaseInsert('blog_posts', bpD);
        break;

      // ── Subscribers ──
      case 'subscribe_newsletter':
        supabaseUpsert('subscribers', {
          email: (data.email || '').toLowerCase().trim(),
          name: data.name || '',
          tier: data.tier || 'free',
          source: data.source || 'website',
          status: 'active'
        }, 'email');
        break;
      case 'unsubscribe_newsletter':
        supabaseUpsert('subscribers', {
          email: (data.email || '').toLowerCase().trim(),
          status: 'unsubscribed'
        }, 'email');
        break;

      // ── Newsletters ──
      case 'send_newsletter':
        supabaseInsert('newsletters', {
          subject: data.subject || '',
          content: (data.content || '').substring(0, 2000),
          target_tier: data.tier || 'all',
          status: 'sent'
        });
        break;

      // ── Complaints ──
      case 'submit_complaint':
        if (data.complaintRef || data.complaint_ref) {
          supabaseUpsert('complaints', {
            complaint_ref: data.complaintRef || data.complaint_ref,
            complaint_type: data.complaintType || '',
            name: data.name || '',
            email: data.email || '',
            phone: data.phone || '',
            job_ref: data.jobRef || '',
            service: data.service || '',
            service_date: data.serviceDate || null,
            severity: data.severity || '',
            description: data.description || '',
            desired_resolution: data.desiredResolution || '',
            amount_paid: parseFloat(data.amountPaid) || 0,
            status: 'open'
          }, 'complaint_ref');
        }
        break;
      case 'resolve_complaint':
        supabaseUpsert('complaints', {
          complaint_ref: data.complaintRef,
          status: 'resolved',
          resolution_type: data.resolutionType || '',
          resolution_notes: data.resolutionNotes || '',
          resolved_date: new Date().toISOString()
        }, 'complaint_ref');
        break;
      case 'update_complaint_status':
        supabaseUpsert('complaints', {
          complaint_ref: data.complaintRef,
          status: data.status
        }, 'complaint_ref');
        break;
      case 'update_complaint_notes':
        supabaseUpsert('complaints', {
          complaint_ref: data.complaintRef,
          admin_notes: data.notes || ''
        }, 'complaint_ref');
        break;

      // ── Remote Commands ──
      case 'update_remote_command':
        supabaseUpsert('remote_commands', {
          id: data.id,
          status: data.status || 'completed',
          result: data.result || '',
          completed_at: data.completed_at || new Date().toISOString()
        }, 'id');
        break;

      // ── Products / Orders ──
      case 'update_order_status':
        supabaseUpsert('orders', {
          order_id: data.orderId,
          order_status: data.orderStatus || data.status,
          notes: data.notes || ''
        }, 'order_id');
        break;

      // ── Vacancies / Applications ──
      case 'update_application_status':
        supabaseUpsert('applications', {
          id: data.applicationId,
          status: data.status,
          notes: data.notes || ''
        }, 'id');
        break;

      // ── Business Costs ──
      case 'save_business_costs':
        supabaseUpsert('business_costs', {
          month: data.month,
          vehicle_insurance: parseFloat(data.vehicleInsurance) || 0,
          public_liability: parseFloat(data.publicLiability) || 0,
          equipment_maint: parseFloat(data.equipmentMaint) || 0,
          vehicle_maint: parseFloat(data.vehicleMaint) || 0,
          fuel_rate: parseFloat(data.fuelRate) || 0,
          marketing: parseFloat(data.marketing) || 0,
          nat_insurance: parseFloat(data.natInsurance) || 0,
          income_tax: parseFloat(data.incomeTax) || 0,
          phone_internet: parseFloat(data.phoneInternet) || 0,
          software: parseFloat(data.software) || 0,
          accountancy: parseFloat(data.accountancy) || 0,
          other: parseFloat(data.other) || 0,
          notes: data.notes || '',
          waste_disposal: parseFloat(data.wasteDisposal) || 0,
          treatment_products: parseFloat(data.treatmentProducts) || 0,
          consumables: parseFloat(data.consumables) || 0
        }, 'month');
        break;

      // ── Client status (mobile) ──
      case 'update_booking_status':
        if (data.booking_id) {
          supabaseUpsert('clients', {
            job_number: data.booking_id,
            status: data.status
          }, 'job_number');
        }
        break;

      default:
        break;
    }
  } catch(e) {
    Logger.log('Supabase mirror error [' + action + ']: ' + e);
  }
}

// ============================================
// EMAIL — BREVO (PRIMARY) + MAILAPP (FALLBACK)
// All emails route through sendEmail() which tries Brevo SMTP API first,
// then falls back to Google MailApp if Brevo key isn't set or call fails.
// ============================================

/**
 * Send an email via Brevo (primary) or MailApp (fallback).
 * Includes retry on transient Brevo failures and detailed error logging.
 * @param {Object} opts - {to, subject, htmlBody, name, replyTo}
 * @returns {Object} {success: bool, provider: string, error: string}
 */
function sendEmail(opts) {
  if (!opts.to) {
    Logger.log('sendEmail: No recipient address provided');
    return { success: false, provider: '', error: 'No recipient email address' };
  }
  
  var brevoError = '';
  
  // ── SOLE PROVIDER: Brevo API (authenticated domain: gardnersgm.co.uk) ──
  var brevoKey = PropertiesService.getScriptProperties().getProperty('BREVO_API_KEY') || '';
  if (brevoKey && brevoKey !== 'DONE' && brevoKey.indexOf('xkeysib') === 0) {
    var maxRetries = 2;
    for (var attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        var payload = {
          sender: { name: opts.name || 'Gardners Ground Maintenance', email: 'info@gardnersgm.co.uk' },
          to: [{ email: opts.to, name: opts.toName || opts.to }],
          subject: opts.subject,
          htmlContent: opts.htmlBody
        };
        if (opts.replyTo) {
          payload.replyTo = { email: opts.replyTo || 'info@gardnersgm.co.uk' };
        }
        var response = UrlFetchApp.fetch('https://api.brevo.com/v3/smtp/email', {
          method: 'post',
          contentType: 'application/json',
          headers: { 'api-key': brevoKey },
          payload: JSON.stringify(payload),
          muteHttpExceptions: true
        });
        var code = response.getResponseCode();
        if (code >= 200 && code < 300) {
          var body = JSON.parse(response.getContentText());
          Logger.log('Email sent via Brevo to ' + opts.to + ' (messageId: ' + (body.messageId || '') + ')');
          return { success: true, provider: 'brevo', error: '' };
        } else {
          brevoError = 'Brevo HTTP ' + code + ': ' + response.getContentText();
          Logger.log('Brevo API error (attempt ' + (attempt + 1) + '): ' + brevoError);
          if (code >= 500 && attempt < maxRetries) {
            Utilities.sleep(1000 * (attempt + 1));
            continue;
          }
          break;
        }
      } catch(brevoErr) {
        brevoError = String(brevoErr);
        Logger.log('Brevo send failed (attempt ' + (attempt + 1) + '): ' + brevoErr);
        if (attempt < maxRetries) {
          Utilities.sleep(1000);
          continue;
        }
      }
    }
    Logger.log('Brevo FAILED after ' + (maxRetries + 1) + ' attempts for ' + opts.to + ' — error: ' + brevoError);
  } else {
    brevoError = 'Brevo API key not configured or invalid';
    Logger.log(brevoError);
  }
  
  // ── BREVO FAILED ──
  var fullError = 'Brevo email failed for ' + opts.to + ': ' + brevoError;
  Logger.log(fullError);
  try {
    notifyTelegram('🚨 *EMAIL FAILED*\n\n📧 To: ' + opts.to + '\n📋 Subject: ' + (opts.subject || '').substring(0, 80) + '\n❌ ' + brevoError);
  } catch(tgErr) {}
  throw new Error('EMAIL_SEND_FAILED: ' + fullError);
}


// ── SHARED BRANDED EMAIL HELPERS ──

/**
 * Returns the branded GGM email header HTML with logo.
 * @param {Object} opts - {title, subtitle, gradient, gradientEnd}
 */
function getGgmEmailHeader(opts) {
  opts = opts || {};
  var title = opts.title || '🌿 Gardners Ground Maintenance';
  var subtitle = opts.subtitle || 'Professional Garden Care in Cornwall';
  var gradient = opts.gradient || '#2E7D32';
  var gradientEnd = opts.gradientEnd || '#43A047';
  var logoUrl = 'https://raw.githubusercontent.com/christophergardner-star/gardnersgm-website/master/images/logo.png';
  
  return '<div style="background:linear-gradient(135deg,' + gradient + ',' + gradientEnd + ');padding:28px 30px;text-align:center;">'
    + '<img src="' + logoUrl + '" alt="GGM" width="70" height="70" style="border-radius:50%;border:3px solid rgba(255,255,255,0.3);display:block;margin:0 auto 12px;">'
    + '<h1 style="color:#fff;margin:0;font-size:22px;font-weight:bold;letter-spacing:0.5px;">' + title + '</h1>'
    + '<p style="color:rgba(255,255,255,0.85);margin:6px 0 0;font-size:13px;font-style:italic;">' + subtitle + '</p>'
    + '</div>';
}

/**
 * Returns the branded GGM email footer HTML with contact details.
 * @param {string} [email] - Recipient email for unsubscribe link (optional)
 */
function getGgmEmailFooter(email) {
  var unsubUrl = email ? (WEBHOOK_URL + '?action=unsubscribe_service&email=' + encodeURIComponent(email)) : '';
  var accountUrl = 'https://gardnersgm.co.uk/my-account.html';
  
  return '<div style="padding:0 30px 20px;">'
    + '<table width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #e9ecef;"><tr><td style="padding-top:14px;">'
    + '<p style="margin:0;font-size:13px;color:#636e72;line-height:1.6;">'
    + '<strong style="color:#2E7D32;">Chris Gardner</strong><br>'
    + 'Owner &amp; Lead Gardener<br>'
    + '<a href="tel:01726432051" style="color:#2E7D32;text-decoration:none;">01726 432051</a><br>'
    + '<a href="mailto:info@gardnersgm.co.uk" style="color:#2E7D32;text-decoration:none;">info@gardnersgm.co.uk</a>'
    + '</p></td></tr></table></div>'
    + '<div style="background:#f8f9fa;padding:18px 30px;border-top:1px solid #e9ecef;text-align:center;">'
    + '<p style="margin:0 0 6px;font-size:12px;color:#636e72;">'
    + 'Gardners Ground Maintenance &middot; Roche, Cornwall PL26 8HN<br>'
    + '<a href="https://www.gardnersgm.co.uk" style="color:#2E7D32;text-decoration:none;font-weight:bold;">www.gardnersgm.co.uk</a>'
    + '</p>'
    + (unsubUrl 
      ? '<p style="margin:0;font-size:11px;color:#b2bec3;"><a href="' + accountUrl + '" style="color:#b2bec3;text-decoration:underline;margin-right:10px;">Manage account</a><a href="' + unsubUrl + '" style="color:#b2bec3;text-decoration:underline;">Unsubscribe</a></p>'
      : '<p style="margin:0;font-size:11px;color:#b2bec3;"><a href="' + accountUrl + '" style="color:#b2bec3;text-decoration:underline;">Manage your account</a></p>')
    + '</div>';
}


// ── TEST FUNCTION: Run this to authorize all scopes + verify emails work ──
function testEmailSend() {
  var remaining = MailApp.getRemainingDailyQuota();
  Logger.log('Email quota remaining: ' + remaining);
  
  // Debug: check what Brevo key looks like
  var brevoKey = PropertiesService.getScriptProperties().getProperty('BREVO_API_KEY') || '';
  Logger.log('BREVO_API_KEY length: ' + brevoKey.length);
  Logger.log('BREVO_API_KEY starts with xkeysib: ' + (brevoKey.indexOf('xkeysib') === 0));
  Logger.log('BREVO_API_KEY first 15 chars: ' + brevoKey.substring(0, 15));
  
  try {
    var result = sendEmail({
      to: 'info@gardnersgm.co.uk',
      subject: 'Test Email — Gardners GM System Check',
      htmlBody: '<h2>✅ Email system working</h2><p>This is a test from your Apps Script. If you received this, all branded emails should work.</p><p>Provider: Brevo/MailApp auto-select</p><p>MailApp quota remaining: ' + remaining + ' emails today.</p>',
      name: 'Gardners Ground Maintenance',
      replyTo: 'info@gardnersgm.co.uk'
    });
    Logger.log('Test email sent via ' + result.provider + ' to info@gardnersgm.co.uk');
    notifyTelegram('✅ *Email System Test*\nSent via: ' + result.provider + '\nMailApp quota remaining: ' + remaining);
  } catch(e) {
    Logger.log('Test email FAILED: ' + e.message);
    notifyTelegram('❌ *Email System Test FAILED*\n' + e.message);
  }
}

// ============================================
// TELEGRAM — MULTI-BOT SYSTEM
// 4 bots: DayBot (schedule), MoneyBot (finance),
// ContentBot (blog/social), CoachBot (ADHD coaching)
// ============================================
var TG_BOT_TOKEN = PropertiesService.getScriptProperties().getProperty('TG_BOT_TOKEN') || '';
var TG_CHAT_ID = PropertiesService.getScriptProperties().getProperty('TG_CHAT_ID') || '6200151295';

var BOT_TOKENS = {
  daybot:     TG_BOT_TOKEN,
  moneybot:   PropertiesService.getScriptProperties().getProperty('MONEYBOT_TOKEN') || '',
  contentbot: PropertiesService.getScriptProperties().getProperty('CONTENTBOT_TOKEN') || '',
  coachbot:   PropertiesService.getScriptProperties().getProperty('COACHBOT_TOKEN') || ''
};

/** Send a message via a specific bot. Default = DayBot. */
function notifyBot(botName, msg) {
  if (!msg || !String(msg).trim()) return;
  var token = BOT_TOKENS[botName] || TG_BOT_TOKEN;
  if (!token) { Logger.log('No token for bot: ' + botName); return; }
  try {
    UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
      method: 'post', contentType: 'application/json',
      payload: JSON.stringify({
        chat_id: TG_CHAT_ID,
        parse_mode: 'Markdown',
        text: String(msg),
        disable_web_page_preview: true
      })
    });
  } catch(tgErr) {
    Logger.log('Bot ' + botName + ' notify failed: ' + tgErr);
  }
}

/** Original helper — sends via DayBot (backwards compatible with all existing calls) */
function notifyTelegram(msg) {
  notifyBot('daybot', msg);
}

// ============================================
// DATE NORMALISATION HELPER
// Handles: Date objects, "Monday, 14 March 2026",
// "2026-03-14", ISO timestamps, etc. → 'YYYY-MM-DD'
// ============================================
function normaliseDateToISO(val) {
  if (!val) return '';
  if (val instanceof Date) {
    return Utilities.formatDate(val, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  var s = String(val).trim();
  // Already YYYY-MM-DD or ISO timestamp
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.substring(0, 10);
  // Human-readable: "Monday, 14 March 2026" or "14 March 2026"
  var months = {
    'january':'01','february':'02','march':'03','april':'04','may':'05','june':'06',
    'july':'07','august':'08','september':'09','october':'10','november':'11','december':'12'
  };
  var match = s.match(/(\d{1,2})\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{4})/i);
  if (match) {
    var day = parseInt(match[1], 10);
    var month = months[match[2].toLowerCase()];
    var year = match[3];
    return year + '-' + month + '-' + (day < 10 ? '0' + day : day);
  }
  // Fallback: try native Date parse
  try {
    var d = new Date(s);
    if (!isNaN(d.getTime())) {
      return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    }
  } catch(e) {}
  return s;
}

function doPost(e) {
  try {
    // ── Telegram Webhook (photos & commands from any of the 4 bots) ──
    var rawContent = e.postData.contents;
    var data = JSON.parse(rawContent);
    
    // ── Route: Track pageview (lightweight analytics) ──
    if (data.action === 'track_pageview') {
      return trackPageview(data);
    }

    if (data.update_id !== undefined && data.message) {
      // Determine which bot received this via ?bot= query param
      var botParam = (e.parameter && e.parameter.bot) ? e.parameter.bot.toLowerCase() : 'daybot';
      return handleMultiBotWebhook(e, botParam);
    }
    
    // ── Stripe Webhook (explicit query param OR auto-detect Stripe event shape) ──
    if (e.parameter && e.parameter.action === 'stripe_webhook') {
      return handleStripeWebhook(e);
    }
    if (data.type && data.data && data.data.object && data.id && !data.action && !data.update_id) {
      // Auto-detected Stripe event payload (e.g. invoice.paid, checkout.session.completed)
      Logger.log('Auto-detected Stripe webhook event: ' + data.type);
      return handleStripeWebhook(e);
    }

    // ── Route: Subscription signup (Stripe) ──
    if (data.action === 'stripe_subscription') {
      return handleStripeSubscription(data);
    }

    // ── Route: Booking payment ──
    if (data.action === 'booking_payment') {
      return handleBookingPayment(data);
    }
    
    // ── Route: Booking deposit ──
    if (data.action === 'booking_deposit') {
      return handleBookingDeposit(data);
    }
    
    // ── Route: Create / send a quote ──
    if (data.action === 'create_quote') {
      return handleCreateQuote(data);
    }
    
    // ── Route: Update an existing quote ──
    if (data.action === 'update_quote') {
      return handleUpdateQuote(data);
    }
    
    // ── Route: Resend quote email ──
    if (data.action === 'resend_quote') {
      return handleResendQuote(data);
    }
    
    // ── Route: Customer accepts/declines quote (from email link) ──
    if (data.action === 'quote_response') {
      return handleQuoteResponse(data);
    }
    
    // ── Route: Process quote deposit payment ──
    if (data.action === 'quote_deposit_payment') {
      return handleQuoteDepositPayment(data);
    }
    
    // ── Route: Update client row in sheet ──
    if (data.action === 'update_client') {
      return updateClientRow(data);
    }
    
    // ── Route: Add note / update status ──
    if (data.action === 'update_status') {
      return updateClientStatus(data);
    }
    
    // ── Route: Submit a customer testimonial ──
    if (data.action === 'submit_testimonial') {
      return submitTestimonial(data);
    }
    
    // ── Route: Save a blog post (create or update) ──
    if (data.action === 'save_blog_post') {
      var r = saveBlogPost(data);
      mirrorActionToSupabase('save_blog_post', data);
      return r;
    }
    
    // ── Route: Delete a blog post ──
    if (data.action === 'delete_blog_post') {
      return deleteBlogPost(data);
    }
    
    // ── Route: Fetch image for a blog post ──
    if (data.action === 'fetch_blog_image') {
      return fetchImageForPost(data);
    }

    // ── Route: Cleanup blog (remove dupes + backfill images) ──
    if (data.action === 'cleanup_blog') {
      return cleanupBlogPosts();
    }

    // ── Route: Post to Facebook Page ──
    if (data.action === 'post_to_facebook') {
      return postToFacebookPage(data);
    }
    
    // ── Route: Save business costs (profitability tracker) ──
    if (data.action === 'save_business_costs') {
      var r = saveBusinessCosts(data);
      mirrorActionToSupabase('save_business_costs', data);
      return r;
    }
    
    // ── Route: Send job completion email with review request ──
    if (data.action === 'send_completion_email') {
      return sendCompletionEmail(data);
    }
    
    // ── Route: Write to arbitrary sheet range ──
    if (data.action === 'sheet_write') {
      return sheetWriteRange(data);
    }
    
    // ── Route: Subscribe to newsletter ──
    if (data.action === 'subscribe_newsletter') {
      var r = subscribeNewsletter(data);
      mirrorActionToSupabase('subscribe_newsletter', data);
      return r;
    }
    
    // ── Route: Unsubscribe from newsletter ──
    if (data.action === 'unsubscribe_newsletter') {
      var r = unsubscribeNewsletter(data);
      mirrorActionToSupabase('unsubscribe_newsletter', data);
      return r;
    }
    
    // ── Route: Send newsletter (admin) ──
    if (data.action === 'send_newsletter') {
      var r = sendNewsletter(data);
      mirrorActionToSupabase('send_newsletter', data);
      return r;
    }
    
    // ── Route: Generate schedule from subscriptions ──
    if (data.action === 'generate_schedule') {
      return generateSchedule(data);
    }
    
    // ── Route: Send Telegram schedule digest ──
    if (data.action === 'send_schedule_digest') {
      return sendScheduleDigest(data);
    }
    
    // ── Route: Cancel a one-off booking ──
    if (data.action === 'cancel_booking') {
      return cancelBooking(data);
    }
    
    // ── Route: Cancel a subscription ──
    if (data.action === 'cancel_subscription') {
      // Validate session before allowing cancellation
      var cancelEmail = validateSession(data.sessionToken || '');
      if (!cancelEmail) {
        return ContentService.createTextOutput(JSON.stringify({
          status: 'auth_required', message: 'Session expired. Please log in again.'
        })).setMimeType(ContentService.MimeType.JSON);
      }
      return cancelSubscription(data);
    }
    
    // ── Route: Reschedule a booking ──
    if (data.action === 'reschedule_booking') {
      return rescheduleBooking(data);
    }
    
    // ── Route: Process daily email lifecycle (agent call) ──
    if (data.action === 'process_email_lifecycle') {
      return processEmailLifecycle(data);
    }
    
    // ── Route: Run financial dashboard calculations (agent call) ──
    if (data.action === 'run_financial_dashboard') {
      return runFinancialDashboard(data);
    }
    
    // ── Route: Update pricing config (agent call) ──
    if (data.action === 'update_pricing_config') {
      return updatePricingConfig(data);
    }
    
    // ── Route: Save business recommendation (agent call) ──
    if (data.action === 'save_business_recommendation') {
      return saveBusinessRecommendation(data);
    }
    
    // ── Route: Send auto-reply to customer enquiry (agent call) ──
    if (data.action === 'send_enquiry_reply') {
      return sendEnquiryReply(data);
    }
    
    // ── Route: Update savings pots ──
    if (data.action === 'update_savings_pots') {
      return updateSavingsPots(data);
    }
    
    // ── Route: Request magic login link ──
    if (data.action === 'request_login_link') {
      return requestLoginLink(data);
    }
    
    // ── Route: Verify magic link token ──
    if (data.action === 'verify_login_token') {
      return verifyLoginToken(data);
    }
    
    // ── Route: Update customer profile (authenticated) ──
    if (data.action === 'update_customer_profile') {
      return updateCustomerProfile(data);
    }
    
    // ── Route: Update email preferences (authenticated) ──
    if (data.action === 'update_email_preferences') {
      return updateEmailPreferences(data);
    }
    
    // ── Route: Delete customer account (GDPR) ──
    if (data.action === 'delete_customer_account') {
      return deleteCustomerAccount(data);
    }
    
    // ── Route: Clear newsletter log for a month (admin) ──
    if (data.action === 'clear_newsletters_month') {
      return clearNewslettersMonth(data);
    }
    
    // ── Route: Create Stripe invoice (from invoice.html admin page) ──
    if (data.action === 'stripe_invoice') {
      return handleStripeInvoice(data);
    }
    
    // ── Route: Send invoice email to client (with photos) ──
    if (data.action === 'send_invoice_email') {
      var result = sendInvoiceEmail(data);
      return ContentService.createTextOutput(JSON.stringify({ status: 'success', invoiceNumber: result.invoiceNumber }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    
    // ── Route: Mark invoice as paid (manual / bank transfer) ──
    if (data.action === 'mark_invoice_paid') {
      var updated = updateInvoiceByNumber(data.invoiceNumber, 'Paid', new Date().toISOString(), data.paymentMethod || 'Bank Transfer');
      mirrorActionToSupabase('mark_invoice_paid', data);
      
      // Send payment received email if we have customer details
      if (updated && data.email) {
        try {
          sendPaymentReceivedEmail({
            email: data.email,
            name: data.name || '',
            service: data.service || '',
            amount: data.amount || '',
            jobNumber: data.jobNumber || '',
            paymentMethod: data.paymentMethod || 'Bank Transfer'
          });
        } catch(emailErr) { Logger.log('Manual payment email error: ' + emailErr); }
      }
      
      return ContentService.createTextOutput(JSON.stringify({ status: updated ? 'success' : 'not_found' }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    
    // ── Route: Void an invoice ──
    if (data.action === 'mark_invoice_void') {
      var voided = updateInvoiceByNumber(data.invoiceNumber, 'Void', '', '');
      mirrorActionToSupabase('mark_invoice_void', data);
      return ContentService.createTextOutput(JSON.stringify({ status: voided ? 'success' : 'not_found' }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    
    // ── Route: Bespoke work enquiry (chatbot → email + Telegram) ──
    if (data.action === 'bespoke_enquiry') {
      return handleBespokeEnquiry(data);
    }
    
    // ── Route: Service enquiry from booking form (no payment — enquiry only) ──
    if (data.action === 'service_enquiry') {
      return handleServiceEnquiry(data);
    }
    
    // ── Route: Test email sending (full diagnostic) ──
    if (data.action === 'test_email') {
      var testTo = data.email || 'info@gardnersgm.co.uk';
      var diag = { sentTo: testTo, hubOwnsEmails: HUB_OWNS_EMAILS };
      var brevoKey = PropertiesService.getScriptProperties().getProperty('BREVO_API_KEY') || '';
      diag.brevoKeyLength = brevoKey.length;
      diag.brevoKeyValid = brevoKey.indexOf('xkeysib') === 0;
      diag.brevoKeyFirst20 = brevoKey.substring(0, 20) + '...';
      diag.mailAppQuota = MailApp.getRemainingDailyQuota();

      // Test 1: Raw Brevo API call (capture FULL response)
      diag.brevo = { attempted: false };
      if (brevoKey && brevoKey.indexOf('xkeysib') === 0) {
        diag.brevo.attempted = true;
        try {
          var brevoPayload = {
            sender: { name: 'Gardners Ground Maintenance', email: 'info@gardnersgm.co.uk' },
            to: [{ email: testTo, name: 'Chris' }],
            subject: 'Test Email via Brevo — ' + new Date().toLocaleTimeString(),
            htmlContent: '<h2>Brevo Direct Test</h2><p>If you see this, Brevo delivery works to ' + testTo + '</p><p>Sent: ' + new Date().toISOString() + '</p>'
          };
          var brevoResp = UrlFetchApp.fetch('https://api.brevo.com/v3/smtp/email', {
            method: 'post',
            contentType: 'application/json',
            headers: { 'api-key': brevoKey },
            payload: JSON.stringify(brevoPayload),
            muteHttpExceptions: true
          });
          diag.brevo.httpCode = brevoResp.getResponseCode();
          diag.brevo.response = brevoResp.getContentText();
        } catch(be) {
          diag.brevo.error = String(be);
        }
      }

      // Test 2: Check Brevo account/senders
      diag.brevoAccount = {};
      try {
        var acctResp = UrlFetchApp.fetch('https://api.brevo.com/v3/account', {
          method: 'get',
          headers: { 'api-key': brevoKey },
          muteHttpExceptions: true
        });
        var acctData = JSON.parse(acctResp.getContentText());
        diag.brevoAccount.email = acctData.email || 'unknown';
        diag.brevoAccount.plan = (acctData.plan && acctData.plan[0]) ? acctData.plan[0].type : 'unknown';
        diag.brevoAccount.credits = (acctData.plan && acctData.plan[0]) ? acctData.plan[0].credits : 'unknown';
      } catch(ae) { diag.brevoAccount.error = String(ae); }

      // Test 3: Check verified senders
      diag.brevoSenders = {};
      try {
        var sendersResp = UrlFetchApp.fetch('https://api.brevo.com/v3/senders', {
          method: 'get',
          headers: { 'api-key': brevoKey },
          muteHttpExceptions: true
        });
        diag.brevoSenders.httpCode = sendersResp.getResponseCode();
        diag.brevoSenders.response = sendersResp.getContentText();
      } catch(se) { diag.brevoSenders.error = String(se); }

      // Test 4: MailApp fallback test
      diag.mailApp = { attempted: false };
      if (data.testMailApp) {
        diag.mailApp.attempted = true;
        try {
          MailApp.sendEmail({
            to: testTo,
            subject: 'Test Email via MailApp — ' + new Date().toLocaleTimeString(),
            htmlBody: '<h2>MailApp Direct Test</h2><p>If you see this, Google MailApp delivery works to ' + testTo + '</p>',
            name: 'Gardners Ground Maintenance',
            replyTo: 'info@gardnersgm.co.uk'
          });
          diag.mailApp.result = 'sent';
        } catch(me) {
          diag.mailApp.error = String(me);
        }
      }

      return ContentService.createTextOutput(JSON.stringify(diag, null, 2)).setMimeType(ContentService.MimeType.JSON);
    }
    
    // ── Route: Subscriber request from chatbot ──
    if (data.action === 'subscription_request') {
      return handleSubscriptionRequest(data);
    }
    
    // ── Route: Chatbot message relay (to Telegram) ──
    if (data.action === 'chatbot_message') {
      return handleChatbotMessage(data);
    }
    
    // ── Route: Generic Telegram message relay (from frontend) ──
    if (data.action === 'relay_telegram') {
      try {
        notifyTelegram(data.text || '', data.parse_mode || 'Markdown');
      } catch(e) { Logger.log('Relay telegram error: ' + e); }
      return ContentService.createTextOutput(JSON.stringify({ status: 'success' }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    
    // ── Route: Telegram document relay (from frontend, base64 encoded) ──
    if (data.action === 'relay_telegram_document') {
      try {
        var fileBytes = Utilities.base64Decode(data.fileContent || '');
        var blob = Utilities.newBlob(fileBytes, data.mimeType || 'application/octet-stream', data.fileName || 'file');
        var tgUrl = 'https://api.telegram.org/bot' + TG_BOT_TOKEN + '/sendDocument';
        UrlFetchApp.fetch(tgUrl, {
          method: 'post',
          payload: {
            chat_id: TG_CHAT_ID,
            caption: data.caption || '',
            document: blob
          }
        });
      } catch(e) { Logger.log('Relay telegram document error: ' + e); }
      return ContentService.createTextOutput(JSON.stringify({ status: 'success' }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    
    // ── Route: Telegram photo relay (from frontend, base64 encoded) ──
    if (data.action === 'relay_telegram_photo') {
      try {
        var photoBytes = Utilities.base64Decode(data.fileContent || '');
        var photoBlob = Utilities.newBlob(photoBytes, data.mimeType || 'image/jpeg', data.fileName || 'photo.jpg');
        var tgPhotoUrl = 'https://api.telegram.org/bot' + TG_BOT_TOKEN + '/sendPhoto';
        UrlFetchApp.fetch(tgPhotoUrl, {
          method: 'post',
          payload: {
            chat_id: TG_CHAT_ID,
            caption: data.caption || '',
            parse_mode: data.parse_mode || 'Markdown',
            photo: photoBlob
          }
        });
      } catch(e) { Logger.log('Relay telegram photo error: ' + e); }
      return ContentService.createTextOutput(JSON.stringify({ status: 'success' }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    
    // ── Route: Contact form enquiry (branded email + Telegram) ──
    if (data.action === 'contact_enquiry') {
      var r = handleContactEnquiry(data);
      mirrorActionToSupabase('contact_enquiry', data);
      return r;
    }
    
    // ── Route: Shop — Save/update a product (admin) ──
    if (data.action === 'save_product') {
      return saveProduct(data);
    }
    
    // ── Route: Shop — Delete a product (admin) ──
    if (data.action === 'delete_product') {
      return deleteProduct(data);
    }
    
    // ── Route: Shop — Create order (payment removed) ──
    if (data.action === 'shop_checkout') {
      return shopCheckout(data);
    }
    
    // ── Route: Shop — Update order status (admin) ──
    if (data.action === 'update_order_status') {
      var r = updateOrderStatus(data);
      mirrorActionToSupabase('update_order_status', data);
      return r;
    }
    
    // ── Route: Free quote visit request ──
    if (data.action === 'free_visit') {
      return handleFreeVisitRequest(data);
    }

    // ── Route: Careers — Post / update vacancy (admin) ──
    if (data.action === 'post_vacancy') {
      return postVacancy(data);
    }

    // ── Route: Careers — Delete vacancy (admin) ──
    if (data.action === 'delete_vacancy') {
      return deleteVacancy(data);
    }

    // ── Route: Delete client (admin/Hub) ──
    if (data.action === 'delete_client') {
      // Support both row-number (legacy) and name-based lookup
      if (data.name) {
        return deleteJobByName(data.name, data.email || '');
      }
      return deleteSheetRow('Jobs', data.row);
    }

    // ── Route: Delete invoice (admin/Hub) ──
    if (data.action === 'delete_invoice') {
      if (data.invoice_number) {
        return deleteRowByColumn('Invoices', 1, data.invoice_number);
      }
      return deleteSheetRow('Invoices', data.row);
    }

    // ── Route: Delete quote (admin/Hub) ──
    if (data.action === 'delete_quote') {
      if (data.quote_id) {
        return deleteRowByColumn('Quotes', 0, data.quote_id);
      }
      return deleteSheetRow('Quotes', data.row);
    }

    // ── Route: Delete enquiry (admin/Hub) ──
    if (data.action === 'delete_enquiry') {
      return deleteSheetRow('Enquiries', data.row);
    }

    // ── Route: Careers — Submit application (public) ──
    if (data.action === 'submit_application') {
      return submitApplication(data);
    }

    // ── Route: Careers — Update application status (admin) ──
    if (data.action === 'update_application_status') {
      var r = updateApplicationStatus(data);
      mirrorActionToSupabase('update_application_status', data);
      return r;
    }

    // ── Route: Complaints — Submit complaint (public) ──
    if (data.action === 'submit_complaint') {
      var r = submitComplaint(data);
      mirrorActionToSupabase('submit_complaint', data);
      return r;
    }

    // ── Route: Complaints — Resolve complaint (admin) ──
    if (data.action === 'resolve_complaint') {
      var r = resolveComplaint(data);
      mirrorActionToSupabase('resolve_complaint', data);
      return r;
    }

    // ── Route: Complaints — Update status (admin) ──
    if (data.action === 'update_complaint_status') {
      var r = updateComplaintStatus(data);
      mirrorActionToSupabase('update_complaint_status', data);
      return r;
    }

    // ── Route: Complaints — Save admin notes ──
    if (data.action === 'update_complaint_notes') {
      var r = updateComplaintNotes(data);
      mirrorActionToSupabase('update_complaint_notes', data);
      return r;
    }

    // ── Route: Finance — Save allocation config ──
    if (data.action === 'save_alloc_config') {
      return saveAllocConfig(data);
    }
    
    // ── Route: Setup sheets (rename Sheet1, add headers) ──
    if (data.action === 'setup_sheets') {
      setupSheetsOnce();
      return ContentService.createTextOutput(JSON.stringify({ status: 'success', message: 'Sheets setup complete' }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    
    // ── Route: Mobile — Update job status (field app) ──
    if (data.action === 'mobile_update_job_status') {
      return mobileUpdateJobStatus(data);
    }
    
    // ── Route: Mobile — Start job (field app, records start time) ──
    if (data.action === 'mobile_start_job') {
      return mobileStartJob(data);
    }
    
    // ── Route: Mobile — Complete job (field app, records end time) ──
    if (data.action === 'mobile_complete_job') {
      return mobileCompleteJob(data);
    }
    
    // ── Route: Mobile — Send invoice from field app ──
    if (data.action === 'mobile_send_invoice') {
      return mobileSendInvoice(data);
    }
    
    // ── Route: Mobile — Upload job photo from field app ──
    if (data.action === 'mobile_upload_photo') {
      return mobileUploadPhoto(data);
    }
    
    // ── Route: Remote Command Queue — laptop queues a command for PC ──
    if (data.action === 'queue_remote_command') {
      var r = queueRemoteCommand(data);
      // Mirror to Supabase (command ID is in the result)
      try {
        var cmdResult = JSON.parse(r.getContent ? r.getContent() : '{}');
        supabaseInsert('remote_commands', {
          id: (cmdResult && cmdResult.id) ? cmdResult.id : '',
          command: data.command || '',
          data: data.data || '{}',
          source: data.source || 'laptop',
          target: data.target || 'pc_hub',
          status: 'pending'
        });
      } catch(se) { Logger.log('Supabase queue_remote_command error: ' + se); }
      return r;
    }
    
    // ── Route: Remote Command Queue — PC marks a command done/failed ──
    if (data.action === 'update_remote_command') {
      var r = updateRemoteCommand(data);
      mirrorActionToSupabase('update_remote_command', data);
      return r;
    }
    
    // ── Route: Save field note from laptop ──
    if (data.action === 'save_field_note') {
      return saveFieldNote(data);
    }
    
    // ── Route: Update booking status (from field app) ──
    if (data.action === 'update_booking_status') {
      var r = updateBookingStatus(data);
      mirrorActionToSupabase('update_booking_status', data);
      return r;
    }
    
    // ── Route: Node heartbeat (PC Hub + laptop + mobile) ──
    if (data.action === 'node_heartbeat') {
      var hbResult = handleNodeHeartbeat(data);
      // Dual-write heartbeat to Supabase
      try {
        supabaseUpsert('node_heartbeats', {
          node_name: data.nodeId || data.node_name || '',
          version: data.version || '',
          status: 'online',
          ip_address: data.ip || ''
        }, 'node_name');
      } catch(se) { Logger.log('Supabase heartbeat error: ' + se); }
      return ContentService.createTextOutput(JSON.stringify(hbResult))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // ── Route: Update invoice row (PC Hub sync) ──
    if (data.action === 'update_invoice') {
      var r = handleUpdateInvoice(data);
      mirrorActionToSupabase('update_invoice', data);
      return r;
    }

    // ── Route: Update enquiry row (PC Hub sync) ──
    if (data.action === 'update_enquiry') {
      var r = handleUpdateEnquiry(data);
      mirrorActionToSupabase('update_enquiry', data);
      return r;
    }

    // ── Route: Log mobile activity (field app) ──
    if (data.action === 'log_mobile_activity') {
      var maResult = handleLogMobileActivity(data);
      return ContentService.createTextOutput(JSON.stringify(maResult))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // ── Route: Generic send_email (Hub fallback when Brevo is down) ──
    if (data.action === 'send_email') {
      var emailResult = sendEmail({
        to: data.to,
        toName: data.name || '',
        subject: data.subject,
        htmlBody: data.htmlBody,
        name: 'Gardners Ground Maintenance',
        replyTo: 'info@gardnersgm.co.uk'
      });
      // Log to Email Tracking sheet for dedup
      try {
        var etSheet = SpreadsheetApp.openById('1_Y7yHIpAvv_VNBhTrwNOQaBMAGa3UlVW_FKlf56ouHk').getSheetByName('Email Tracking');
        if (etSheet) {
          etSheet.appendRow([
            new Date(),
            data.name || '',
            data.to,
            data.emailType || 'generic',
            data.subject,
            emailResult.success ? 'sent' : 'failed',
            emailResult.provider || '',
            emailResult.error || ''
          ]);
        }
      } catch(logErr) { Logger.log('Email tracking log failed: ' + logErr); }
      // Dual-write email tracking to Supabase
      try {
        supabaseInsert('email_tracking', {
          client_name: data.name || '',
          client_email: data.to,
          email_type: data.emailType || 'generic',
          subject: data.subject,
          status: emailResult.success ? 'sent' : 'failed',
          provider: emailResult.provider || '',
          error: emailResult.error || ''
        });
      } catch(se) { Logger.log('Supabase email tracking failed: ' + se); }
      return ContentService.createTextOutput(JSON.stringify({
        status: emailResult.success ? 'success' : 'error',
        provider: emailResult.provider || '',
        error: emailResult.error || ''
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // ── Route: Test Supabase connectivity from GAS (temporary diagnostic) ──
    if (data.action === 'test_supabase') {
      var diag = {};
      var props = PropertiesService.getScriptProperties();
      diag.url = props.getProperty('SUPABASE_URL') ? 'SET (' + props.getProperty('SUPABASE_URL').length + ' chars)' : 'NOT SET';
      diag.key = props.getProperty('SUPABASE_SERVICE_KEY') ? 'SET (' + props.getProperty('SUPABASE_SERVICE_KEY').length + ' chars)' : 'NOT SET';
      try {
        var ok = supabaseUpsert('node_heartbeats', {node_name: 'gas_diag_test', version: '4.2.0', status: 'diag', ip_address: ''}, 'node_name');
        diag.upsert_result = ok;
      } catch(de) { diag.upsert_error = String(de); }
      return ContentService.createTextOutput(JSON.stringify(diag, null, 2)).setMimeType(ContentService.MimeType.JSON);
    }

    // ── Guard: Only process known form submissions (must have name + email) ──
    if (!data.name && !data.email) {
      return ContentService
        .createTextOutput(JSON.stringify({ status: 'error', message: 'Unknown action or missing data' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // ── Route: Sheet data (bookings, subscriptions, admin) ──
    var sheet = SpreadsheetApp.openById('1_Y7yHIpAvv_VNBhTrwNOQaBMAGa3UlVW_FKlf56ouHk').getSheetByName('Jobs');
    
    // ── Save-time re-verification: check slot is still available ──
    // Use LockService to prevent race conditions (two bookings for same slot)
    var bookingLock = LockService.getScriptLock();
    bookingLock.waitLock(10000); // wait up to 10 seconds
    try {
    if (data.type === 'booking' && data.date && data.time && data.service) {
      var verifyResult = JSON.parse(
        checkAvailability({ date: data.date, time: data.time, service: data.service })
        .getContent()
      );
      if (!verifyResult.available) {
        bookingLock.releaseLock();
        return ContentService
          .createTextOutput(JSON.stringify({
            status: 'error',
            message: 'Slot no longer available: ' + (verifyResult.reason || 'already booked'),
            slotConflict: true
          }))
          .setMimeType(ContentService.MimeType.JSON);
      }
    }
    
    var jobNum = generateJobNumber();
    
    var row = [
      data.timestamp || new Date().toISOString(),
      data.type || '',
      data.name || '',
      data.email || '',
      data.phone || '',
      data.address || '',
      data.postcode || '',
      data.service || data.package || '',
      data.date || data.startDate || '',
      data.time || '',
      data.preferredDay || '',
      'Active',
      data.price || '',
      data.distance || '',
      data.driveTime || '',
      data.googleMapsUrl || '',
      data.notes || '',
      'No',
      'No',
      jobNum,
      data.travelSurcharge || ''
    ];
    
    sheet.appendRow(row);
    } finally { bookingLock.releaseLock(); }
    
    // Send booking confirmation email (bespoke per payment type)
    try {
      var bookingType = data.termsType || 'pay-later';
      var confirmData = {
        name: data.name || '',
        email: data.email || '',
        service: data.service || data.package || '',
        date: data.date || data.startDate || '',
        time: data.time || '',
        jobNumber: jobNum,
        price: data.price || '',
        address: data.address || '',
        postcode: data.postcode || '',
        type: 'booking',
        paymentType: bookingType
      };
      sendBookingConfirmation(confirmData);
      
      // Pay-later: auto-send invoice email
      if (bookingType === 'pay-later') {
        sendPayLaterInvoiceEmail(confirmData);
      }
      
      // Log terms acceptance
      if (data.termsAccepted) {
        logTermsAcceptance({
          name: data.name, email: data.email, jobNumber: jobNum,
          termsType: bookingType, timestamp: data.termsTimestamp || new Date().toISOString(),
          service: data.service || data.package || ''
        });
      }
      
      // Track email in Email Tracking sheet
      trackEmail(data.email, data.name, 'Booking Confirmation', data.service || '', jobNum);
    } catch(emailErr) {
      notifyTelegram('⚠️ *EMAIL FAILED*\n\nBooking confirmation email failed for ' + (data.name || 'Unknown') + ' (' + (data.email || '') + ')\nJob: ' + jobNum + '\nError: ' + emailErr);
    }
    
    // Sync to Google Calendar
    try {
      syncBookingToCalendar({
        name: data.name || '', service: data.service || data.package || '',
        date: data.date || data.startDate || '', time: data.time || '',
        address: data.address || '', postcode: data.postcode || '', jobNumber: jobNum
      });
    } catch(calErr) { Logger.log('Calendar sync failed: ' + calErr); }
    
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'success', jobNumber: jobNum }))
      .setMimeType(ContentService.MimeType.JSON);
      
  } catch (error) {
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'error', message: error.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}


function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) ? e.parameter.action : '';
  
  // ── Route: Service enquiry via GET (image pixel fallback from booking form) ──
  if (action === 'service_enquiry') {
    try {
      var data = {
        action: 'service_enquiry',
        name: e.parameter.name || '',
        email: e.parameter.email || '',
        phone: e.parameter.phone || '',
        service: e.parameter.service || '',
        date: e.parameter.date || '',
        time: e.parameter.time || '',
        postcode: e.parameter.postcode || '',
        address: e.parameter.address || '',
        notes: e.parameter.notes || '',
        termsAccepted: true,
        termsTimestamp: new Date().toISOString(),
        source: 'get_fallback'
      };
      handleServiceEnquiry(data);
    } catch(err) {
      Logger.log('GET service_enquiry fallback error: ' + err);
    }
    // Return a 1x1 transparent pixel
    return ContentService.createTextOutput(JSON.stringify({status:'success'}))
      .setMimeType(ContentService.MimeType.JSON);
  }
  
  // ── Route: Check availability (double booking prevention) ──
  if (action === 'check_availability') {
    return checkAvailability(e.parameter);
  }
  
  // ── Route: Get all clients/bookings for CRM ──
  if (action === 'get_clients') {
    return getClients();
  }
  
  // ── Route: Get email workflow status (admin dashboard) ──
  if (action === 'get_email_workflow_status') {
    var wf = getEmailWorkflowStatus();
    return ContentService.createTextOutput(JSON.stringify({ status: 'success', workflow: wf }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  
  // ── Route: Get bookings for a specific date ──
  if (action === 'get_bookings') {
    return getBookingsForDate(e.parameter.date || '');
  }
  
  // ── Route: Verify a customer email for testimonials ──
  if (action === 'verify_customer') {
    return verifyCustomer(e.parameter.email || '');
  }
  
  // ── Route: Get approved testimonials ──
  if (action === 'get_testimonials') {
    return getApprovedTestimonials();
  }
  
  // ── Route: Get published blog posts (public) ──
  if (action === 'get_blog_posts') {
    return getBlogPosts('published');
  }
  
  // ── Route: Get all blog posts (editor) ──
  if (action === 'get_all_blog_posts') {
    return getBlogPosts('all');
  }
  
  // ── Route: Get business costs (profitability tracker) ──
  if (action === 'get_business_costs') {
    return getBusinessCosts();
  }
  
  // ── Route: Get all invoices (admin) ──
  if (action === 'get_invoices') {
    return getInvoices();
  }
  
  // ── Route: Get photos for a job ──
  if (action === 'get_job_photos') {
    var jobNum = e.parameter.job || '';
    var photos = getJobPhotos(jobNum);
    return ContentService.createTextOutput(JSON.stringify({ status: 'success', photos: photos }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  // ── Route: Get ALL job photos (for Hub sync) ──
  if (action === 'get_all_job_photos') {
    var sheet = ensureJobPhotosSheet();
    var data = sheet.getDataRange().getValues();
    var allPhotos = [];
    for (var i = 1; i < data.length; i++) {
      if (!data[i][0]) continue;
      allPhotos.push({
        jobNumber: String(data[i][0] || ''),
        type: String(data[i][1] || '').toLowerCase(),
        photoUrl: String(data[i][2] || ''),
        fileId: String(data[i][3] || ''),
        telegramFileId: String(data[i][4] || ''),
        uploaded: String(data[i][5] || ''),
        caption: String(data[i][6] || '')
      });
    }
    return ContentService.createTextOutput(JSON.stringify({ status: 'success', photos: allPhotos }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  
  // ── Route: List all sheet tabs ──
  if (action === 'sheet_tabs') {
    return sheetListTabs();
  }
  
  // ── Route: Mobile — Get today's jobs (field app) ──
  if (action === 'get_todays_jobs') {
    return getTodaysJobs();
  }
  
  // ── Route: Read arbitrary sheet range ──
  if (action === 'sheet_read') {
    var tab   = e.parameter.tab   || 'Jobs';
    var range = e.parameter.range || '';
    return sheetReadRange(tab, range);
  }
  
  // ── Route: Backfill job numbers for existing rows ──
  if (action === 'backfill_job_numbers') {
    return backfillJobNumbers();
  }
  
  // ── Route: Get newsletter subscribers (admin) ──
  if (action === 'get_subscribers') {
    return getSubscribers();
  }
  
  // ── Route: Get sent newsletters (admin) ──
  if (action === 'get_newsletters') {
    return getNewsletters();
  }
  
  // ── Route: Unsubscribe via link ──
  if (action === 'unsubscribe') {
    return handleUnsubscribeLink(e.parameter);
  }
  
  // ── Route: Get subscription schedule ──
  if (action === 'get_subscription_schedule') {
    return getSchedule(e.parameter);
  }

  // ── Route: Get jobs/bookings for a specific date (field app + laptop) ──
  if (action === 'get_schedule') {
    return getScheduleForDate(e.parameter.date || '');
  }
  
  // ── Route: Get active subscriptions ──
  if (action === 'get_subscriptions') {
    return getActiveSubscriptions();
  }
  
  // ── Route: Customer cancellation page (self-service) ──
  if (action === 'cancel_page') {
    return renderCancelPage(e.parameter);
  }
  
  // ── Route: Suggest alternative slots (smart fallback) ──
  if (action === 'suggest_alternatives') {
    return suggestAlternativeSlots(e.parameter);
  }
  
  // ── Route: Weather reschedule acceptance (from email link) ──
  if (action === 'weather_reschedule') {
    return handleWeatherReschedule(e.parameter);
  }
  
  // ── Route: Get current weather forecast (admin/morning planner) ──
  if (action === 'get_weather') {
    var fc = fetchWeatherForecast();
    if (!fc) return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: 'No forecast data' })).setMimeType(ContentService.MimeType.JSON);
    // Enrich with severity assessment
    for (var wi = 0; wi < fc.daily.length; wi++) {
      fc.daily[wi].severity = assessWeatherSeverity(fc.daily[wi]);
    }
    return ContentService.createTextOutput(JSON.stringify({ status: 'success', forecast: fc })).setMimeType(ContentService.MimeType.JSON);
  }
  
  // ── Route: Unsubscribe from service emails ──
  if (action === 'unsubscribe_service') {
    return handleServiceUnsubscribe(e.parameter);
  }
  
  // ── Route: Get email history for a client ──
  if (action === 'get_email_history') {
    return getEmailHistory(e.parameter);
  }
  
  // ── Route: Get financial dashboard data ──
  if (action === 'get_financial_dashboard') {
    return getFinancialDashboard(e.parameter);
  }
  
  // ── Route: Get pricing config ──
  if (action === 'get_pricing_config') {
    return getPricingConfig();
  }
  
  // ── Route: Get business recommendations ──
  if (action === 'get_business_recommendations') {
    return getBusinessRecommendations(e.parameter);
  }
  
  // ── Route: Get savings pots ──
  if (action === 'get_savings_pots') {
    return getSavingsPots();
  }
  
  // ── Route: Get full job cost breakdown per service ──
  if (action === 'get_job_costs') {
    return getJobCostBreakdown();
  }
  
  // ── Route: Get finance summary (all-in-one for dashboard UI) ──
  if (action === 'get_finance_summary') {
    return getFinanceSummary();
  }
  
  // ── Route: Get customer portal data (authenticated) ──
  if (action === 'get_customer_portal') {
    return getCustomerPortal(e.parameter);
  }
  
  // ── Route: Subscription portal (chatbot — by job number) ──
  if (action === 'get_subscription_portal') {
    return getSubscriptionPortal(e.parameter);
  }
  
  // ── Route: Get chatbot replies (polling from frontend) ──
  if (action === 'get_chat_replies') {
    return getChatReplies(e.parameter);
  }
  
  // ── Route: Get all quotes ──
  if (action === 'get_quotes') {
    return getQuotes();
  }
  
  // ── Route: Get single quote (for customer page) ──
  if (action === 'get_quote') {
    return getQuoteByToken(e.parameter.token);
  }
  
  // ── Route: Get busy dates for booking calendar ──
  if (action === 'get_busy_dates') {
    return getBusyDates();
  }
  
  // ── Route: Get shop products (public) ──
  if (action === 'get_products') {
    return getProducts(e.parameter);
  }
  
  // ── Route: Get shop orders (admin) ──
  if (action === 'get_orders') {
    return getOrders();
  }

  // ── Route: Get open vacancies (public) ──
  if (action === 'get_vacancies') {
    return getVacancies(false);
  }

  // ── Route: Get all vacancies (admin) ──
  if (action === 'get_all_vacancies') {
    return getVacancies(true);
  }

  // ── Route: Get job applications (admin) ──
  if (action === 'get_applications') {
    return getApplications();
  }

  // ── Route: Get complaints (admin) ──
  if (action === 'get_complaints') {
    return getComplaints();
  }

  // ── Route: Get allocation config (finance) ──
  if (action === 'get_alloc_config') {
    return getAllocConfig();
  }

  // ── Route: Get enquiries (admin — bespoke + contact) ──
  if (action === 'get_enquiries') {
    return getEnquiries();
  }

  // ── Route: Get free visit requests (admin) ──
  if (action === 'get_free_visits') {
    return getFreeVisits();
  }

  // ── Route: Get weather log (admin) ──
  if (action === 'get_weather_log') {
    return getWeatherLog();
  }

  // ── Route: Get testimonials for admin (all, not just approved) ──
  if (action === 'get_all_testimonials') {
    return getAllTestimonials();
  }

  // ── Route: Get site analytics (Hub dashboard) ──
  if (action === 'get_site_analytics') {
    return getSiteAnalytics(e.parameter);
  }

  // ── Route: Get remote commands (PC polling for laptop triggers) ──
  if (action === 'get_remote_commands') {
    return getRemoteCommands(e.parameter);
  }

  // ── Route: Get job tracking data (time tracking from mobile) ──
  if (action === 'get_job_tracking') {
    return getJobTracking(e.parameter);
  }

  // ── Route: Get field notes ──
  if (action === 'get_field_notes') {
    return getFieldNotes(e.parameter);
  }

  // ── Route: Get mobile activity feed (recent actions across all sheets) ──
  if (action === 'get_mobile_activity') {
    return getMobileActivity(e.parameter);
  }

  // ── Route: Get node status (heartbeats — all nodes) ──
  if (action === 'get_node_status') {
    var nsResult = handleGetNodeStatus();
    return ContentService.createTextOutput(JSON.stringify(nsResult))
      .setMimeType(ContentService.MimeType.JSON);
  }

  // ── Route: Get recent Telegram updates (admin — proxied to hide token) ──
  if (action === 'get_telegram_updates') {
    try {
      var limit = e.parameter.limit || '5';
      var offset = e.parameter.offset || '-5';
      var tgResp = UrlFetchApp.fetch('https://api.telegram.org/bot' + TG_BOT_TOKEN + '/getUpdates?limit=' + limit + '&offset=' + offset);
      return ContentService.createTextOutput(tgResp.getContentText()).setMimeType(ContentService.MimeType.JSON);
    } catch(tgErr) {
      return ContentService.createTextOutput(JSON.stringify({ ok: false, error: tgErr.toString() })).setMimeType(ContentService.MimeType.JSON);
    }
  }
  
  return ContentService
    .createTextOutput('Gardners GM webhook is active — Sheets + CRM')
    .setMimeType(ContentService.MimeType.TEXT);
}


// ============================================
// SITE ANALYTICS — Lightweight page view tracking
// ============================================

/**
 * Ensure the Site Analytics sheet exists with proper headers.
 */
function ensureSiteAnalyticsSheet() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName('Site Analytics');
  if (!sheet) {
    sheet = ss.insertSheet('Site Analytics');
    sheet.appendRow(['Timestamp', 'Page', 'Title', 'Referrer', 'ScreenWidth', 'ScreenHeight', 'Language', 'Date', 'Hour']);
    sheet.setFrozenRows(1);
    // Format header
    sheet.getRange(1, 1, 1, 9).setFontWeight('bold').setBackground('#e8f5e9');
    sheet.setColumnWidth(1, 170); // Timestamp
    sheet.setColumnWidth(2, 200); // Page
    sheet.setColumnWidth(3, 250); // Title
    sheet.setColumnWidth(4, 250); // Referrer
  }
  return sheet;
}

/**
 * Record a page view from the website tracker.
 * Called via POST with action='track_pageview'.
 * Stores minimal, non-PII data.
 */
function trackPageview(data) {
  try {
    var sheet = ensureSiteAnalyticsSheet();
    var now = new Date();
    var dateStr = Utilities.formatDate(now, 'Europe/London', 'yyyy-MM-dd');
    var hour = now.getHours();
    var page = String(data.page || '/').replace(/\.html$/, '') || '/';
    var title = String(data.title || '').substring(0, 200);
    var ref = String(data.ref || '').substring(0, 300);
    // Clean referrer — remove own domain
    if (ref.indexOf('gardnersgm.co.uk') !== -1) ref = '(internal)';
    var sw = parseInt(data.sw) || 0;
    var sh = parseInt(data.sh) || 0;
    var lang = String(data.lang || '').substring(0, 10);

    sheet.appendRow([now, page, title, ref, sw, sh, lang, dateStr, hour]);

    return ContentService.createTextOutput(JSON.stringify({ status: 'ok' }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch(err) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'error', error: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * Retrieve analytics summary for the Hub dashboard.
 * Accepts optional ?days=N parameter (default 30).
 * Returns: total views, unique pages, daily breakdown, top pages, top referrers, hourly distribution.
 */
function getSiteAnalytics(params) {
  try {
    var sheet = ensureSiteAnalyticsSheet();
    var data = sheet.getDataRange().getValues();
    var days = parseInt((params && params.days) || '30') || 30;
    var cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    var cutoffStr = Utilities.formatDate(cutoff, 'Europe/London', 'yyyy-MM-dd');

    var totalViews = 0;
    var dailyCounts = {};  // date -> count
    var pageCounts = {};   // page -> count
    var refCounts = {};    // referrer -> count
    var hourlyCounts = {}; // hour -> count
    for (var h = 0; h < 24; h++) hourlyCounts[h] = 0;

    for (var i = 1; i < data.length; i++) {
      var dateStr = String(data[i][7] || '');  // col H = Date
      if (dateStr < cutoffStr) continue;

      totalViews++;
      var page = String(data[i][1] || '/');
      var ref = String(data[i][3] || '');
      var hour = parseInt(data[i][8]) || 0;  // col I = Hour

      dailyCounts[dateStr] = (dailyCounts[dateStr] || 0) + 1;
      pageCounts[page] = (pageCounts[page] || 0) + 1;
      if (ref && ref !== '(internal)') {
        // Simplify referrer to domain
        try {
          var refDomain = ref.match(/^https?:\/\/([^/]+)/i);
          ref = refDomain ? refDomain[1] : ref;
        } catch(e) {}
        refCounts[ref] = (refCounts[ref] || 0) + 1;
      }
      hourlyCounts[hour]++;
    }

    // Sort and take top 10
    var topPages = Object.keys(pageCounts).map(function(k) {
      return { page: k, views: pageCounts[k] };
    }).sort(function(a,b) { return b.views - a.views; }).slice(0, 15);

    var topRefs = Object.keys(refCounts).map(function(k) {
      return { referrer: k, views: refCounts[k] };
    }).sort(function(a,b) { return b.views - a.views; }).slice(0, 10);

    // Daily array sorted by date
    var daily = Object.keys(dailyCounts).sort().map(function(d) {
      return { date: d, views: dailyCounts[d] };
    });

    // Hourly array
    var hourly = [];
    for (var h = 0; h < 24; h++) {
      hourly.push({ hour: h, views: hourlyCounts[h] });
    }

    var result = {
      status: 'success',
      period: days + ' days',
      totalViews: totalViews,
      uniquePages: Object.keys(pageCounts).length,
      avgPerDay: daily.length > 0 ? Math.round(totalViews / daily.length) : 0,
      daily: daily,
      topPages: topPages,
      topReferrers: topRefs,
      hourly: hourly
    };

    return ContentService.createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);

  } catch(err) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'error', error: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}


// ============================================
// SUBSCRIPTION SCHEDULING ENGINE
// ============================================

var SCHEDULE_SHEET_ID = SPREADSHEET_ID; // consolidated

// Package → interval in days + services
var PACKAGE_INTERVALS = {
  'lawn-care-weekly':      { days: 7,  winterDays: 14, services: ['Lawn Cutting'] },
  'lawn-care-fortnightly': { days: 14, winterDays: 28, services: ['Lawn Cutting'] },
  'just-mowing-weekly':    { days: 7,  winterDays: 14, services: ['Lawn Cutting'] },
  'just-mowing-fortnightly': { days: 14, winterDays: 28, services: ['Lawn Cutting'] },
  'garden-maintenance':    { days: 7,  winterDays: 14, services: ['Lawn Cutting'],
                             extras: [
                               { service: 'Hedge Trimming', every: 90 },
                               { service: 'Lawn Treatment', every: 90 },
                               { service: 'Scarifying', every: 365 },
                               { service: 'Border Weeding', every: 30 }
                             ] },
  'full-garden-care':      { days: 7,  winterDays: 14, services: ['Lawn Cutting'],
                             extras: [
                               { service: 'Hedge Trimming', every: 90 },
                               { service: 'Lawn Treatment', every: 90 },
                               { service: 'Scarifying', every: 365 },
                               { service: 'Border Weeding', every: 30 }
                             ] },
  'property-care':         { days: 91, winterDays: 91, services: ['Property Inspection'],
                             extras: [
                               { service: 'Gutter Cleaning', every: 182 },
                               { service: 'Power Washing', every: 182 },
                               { service: 'Drain Clearance', every: 365 }
                             ] },
  // Legacy keys for backward compatibility
  'essential':  { days: 14, winterDays: 28, services: ['Lawn Cutting'] },
  'standard':   { days: 7,  winterDays: 14, services: ['Lawn Cutting'] },
  'premium':    { days: 7,  winterDays: 14, services: ['Lawn Cutting'],
                  extras: [
                    { service: 'Hedge Trimming', every: 90 },
                    { service: 'Lawn Treatment', every: 90 },
                    { service: 'Scarifying', every: 365 }
                  ] }
};

function getOrCreateScheduleSheet() {
  var ss = SpreadsheetApp.openById(SCHEDULE_SHEET_ID);
  var sheet = ss.getSheetByName('Schedule');
  if (!sheet) {
    sheet = ss.insertSheet('Schedule');
    sheet.appendRow([
      'Visit Date', 'Client Name', 'Email', 'Phone', 'Address', 'Postcode',
      'Service', 'Package', 'Preferred Day', 'Status', 'Parent Job',
      'Distance', 'Drive Time', 'Google Maps', 'Notes', 'Created By'
    ]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// Get all active subscription rows from Jobs
function getActiveSubscriptions() {
  var ss = SpreadsheetApp.openById(SCHEDULE_SHEET_ID);
  var sheet = ss.getSheetByName('Jobs');
  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  var subs = [];
  
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var type = String(row[1] || '').toLowerCase();
    var status = String(row[11] || '').toLowerCase();
    // Match subscription types
    if ((type.indexOf('subscription') >= 0 || type.indexOf('stripe-subscription') >= 0) 
        && status !== 'cancelled' && status !== 'completed') {
      subs.push({
        rowIndex: i + 1,
        timestamp: row[0],
        type: row[1],
        name: row[2],
        email: row[3],
        phone: row[4],
        address: row[5],
        postcode: row[6],
        package: String(row[7] || '').toLowerCase(),
        startDate: row[8],
        preferredDay: row[10],
        status: row[11],
        price: row[12],
        distance: row[13],
        driveTime: row[14],
        googleMaps: row[15],
        notes: row[16],
        jobNumber: row[19]
      });
    }
  }
  
  return ContentService
    .createTextOutput(JSON.stringify({ status: 'success', subscriptions: subs }))
    .setMimeType(ContentService.MimeType.JSON);
}

// Generate upcoming schedule from active subscriptions
function generateSchedule(data) {
  var weeksAhead = data.weeksAhead || 4;
  var ss = SpreadsheetApp.openById(SCHEDULE_SHEET_ID);
  var mainSheet = ss.getSheetByName('Jobs');
  var schedSheet = getOrCreateScheduleSheet();
  
  // Get existing scheduled visits to avoid duplicates
  var existingData = schedSheet.getDataRange().getValues();
  var existingKeys = {};
  for (var e = 1; e < existingData.length; e++) {
    var dateStr = normaliseDateToISO(existingData[e][0]);
    var key = dateStr + '|' + String(existingData[e][1] || '') + '|' + String(existingData[e][6] || '');
    existingKeys[key] = true;
  }
  
  // Get all active subscriptions
  var mainData = mainSheet.getDataRange().getValues();
  var subs = [];
  for (var i = 1; i < mainData.length; i++) {
    var row = mainData[i];
    var type = String(row[1] || '').toLowerCase();
    var status = String(row[11] || '').toLowerCase();
    if ((type.indexOf('subscription') >= 0) && status !== 'cancelled') {
      subs.push({
        name: row[2], email: row[3], phone: row[4],
        address: row[5], postcode: row[6],
        package: String(row[7] || '').toLowerCase(),
        startDate: row[8], preferredDay: String(row[10] || ''),
        price: row[12], distance: row[13], driveTime: row[14],
        googleMaps: row[15], notes: row[16], jobNumber: row[19]
      });
    }
  }
  
  var today = new Date();
  today.setHours(0, 0, 0, 0);
  var endDate = new Date(today.getTime() + weeksAhead * 7 * 86400000);
  var newRows = [];
  
  var dayMap = { 'sunday':0, 'monday':1, 'tuesday':2, 'wednesday':3, 'thursday':4, 'friday':5, 'saturday':6 };
  
  for (var s = 0; s < subs.length; s++) {
    var sub = subs[s];
    var pkgKey = sub.package.replace(/\s+/g, '-');
    
    // Determine interval config
    var config = PACKAGE_INTERVALS[pkgKey];
    if (!config) {
      // Custom package — default to fortnightly
      config = { days: 14, winterDays: 28, services: ['Custom Service'] };
      // Try to parse custom services from notes
      if (sub.notes && sub.notes.indexOf('[Custom:') >= 0) {
        var match = sub.notes.match(/\[Custom:\s*(.+?)\]/);
        if (match) {
          config.services = match[1].split(',').map(function(s) {
            return s.trim().split('(')[0].trim();
          });
        }
      }
    }
    
    // Get preferred day index
    var prefDay = dayMap[sub.preferredDay.toLowerCase()] || 1; // default Monday
    
    // Find first visit date on/after start date
    var startD = sub.startDate instanceof Date ? sub.startDate : new Date(sub.startDate);
    if (isNaN(startD.getTime())) startD = today;
    
    // Generate main service visits
    generateVisitsForService(config.services, config.days, config.winterDays,
      sub, prefDay, startD, today, endDate, existingKeys, newRows);
    
    // Generate extras (Premium quarterly services etc)
    if (config.extras) {
      for (var x = 0; x < config.extras.length; x++) {
        var extra = config.extras[x];
        generateVisitsForService([extra.service], extra.every, extra.every,
          sub, prefDay, startD, today, endDate, existingKeys, newRows);
      }
    }
  }
  
  // Append all new rows
  if (newRows.length > 0) {
    schedSheet.getRange(schedSheet.getLastRow() + 1, 1, newRows.length, newRows[0].length).setValues(newRows);
  }
  
  return ContentService
    .createTextOutput(JSON.stringify({ status: 'success', generated: newRows.length, total: schedSheet.getLastRow() - 1 }))
    .setMimeType(ContentService.MimeType.JSON);
}

function generateVisitsForService(services, intervalDays, winterIntervalDays, sub, prefDay, startD, today, endDate, existingKeys, newRows) {
  // Walk from startDate forward in intervals, generate visits in the future window
  var cursor = new Date(startD);
  // Align to preferred day
  while (cursor.getDay() !== prefDay) {
    cursor.setDate(cursor.getDate() + 1);
  }
  
  // Walk forward until past endDate
  while (cursor <= endDate) {
    if (cursor >= today) {
      for (var sv = 0; sv < services.length; sv++) {
        var visitDateStr = Utilities.formatDate(cursor, Session.getScriptTimeZone(), 'yyyy-MM-dd');
        var key = visitDateStr + '|' + sub.name + '|' + services[sv];
        
        if (!existingKeys[key]) {
          existingKeys[key] = true;
          newRows.push([
            visitDateStr,                    // Visit Date
            sub.name || '',                  // Client Name
            sub.email || '',                 // Email
            sub.phone || '',                 // Phone
            sub.address || '',               // Address
            sub.postcode || '',              // Postcode
            services[sv],                    // Service
            sub.package || '',               // Package
            sub.preferredDay || '',          // Preferred Day
            'Scheduled',                     // Status
            sub.jobNumber || '',             // Parent Job
            sub.distance || '',              // Distance
            sub.driveTime || '',             // Drive Time
            sub.googleMaps || '',            // Google Maps
            sub.notes || '',                 // Notes
            'auto'                           // Created By
          ]);
        }
      }
    }
    
    // Advance by interval (winter = Nov-Feb)
    var month = cursor.getMonth();
    var isWinter = (month >= 10 || month <= 1);
    var interval = isWinter ? winterIntervalDays : intervalDays;
    cursor.setDate(cursor.getDate() + interval);
    // Re-align to preferred day if interval isn't exact weeks
    if (interval % 7 !== 0) {
      while (cursor.getDay() !== prefDay) {
        cursor.setDate(cursor.getDate() + 1);
      }
    }
  }
}

// Get schedule (upcoming visits)
function getSchedule(params) {
  var daysAhead = parseInt(params.days) || 28;
  var schedSheet;
  try {
    schedSheet = SpreadsheetApp.openById(SCHEDULE_SHEET_ID).getSheetByName('Schedule');
  } catch(e) {}
  
  if (!schedSheet || schedSheet.getLastRow() <= 1) {
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'success', visits: [], message: 'No schedule generated yet' }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  
  var data = schedSheet.getDataRange().getValues();
  var today = new Date();
  today.setHours(0, 0, 0, 0);
  var end = new Date(today.getTime() + daysAhead * 86400000);
  
  var visits = [];
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var d = row[0];
    var visitDate;
    if (d instanceof Date) {
      visitDate = d;
    } else {
      visitDate = new Date(String(d));
    }
    if (isNaN(visitDate.getTime())) continue;
    visitDate.setHours(0, 0, 0, 0);
    
    if (visitDate >= today && visitDate <= end) {
      visits.push({
        rowIndex: i + 1,
        visitDate: Utilities.formatDate(visitDate, Session.getScriptTimeZone(), 'yyyy-MM-dd'),
        name: row[1],
        email: row[2],
        phone: row[3],
        address: row[4],
        postcode: row[5],
        service: row[6],
        package: row[7],
        preferredDay: row[8],
        status: row[9],
        parentJob: row[10],
        distance: row[11],
        driveTime: row[12],
        googleMaps: row[13],
        notes: row[14],
        createdBy: row[15]
      });
    }
  }
  
  // Sort by date
  visits.sort(function(a, b) { return a.visitDate.localeCompare(b.visitDate); });
  
  return ContentService
    .createTextOutput(JSON.stringify({ status: 'success', visits: visits }))
    .setMimeType(ContentService.MimeType.JSON);
}

// Send weekly schedule digest via Telegram
function sendScheduleDigest(data) {
  var daysAhead = data.daysAhead || 7;
  
  // First generate any missing visits
  generateSchedule({ weeksAhead: Math.ceil(daysAhead / 7) + 1 });
  
  // Now fetch the schedule
  var schedSheet = SpreadsheetApp.openById(SCHEDULE_SHEET_ID).getSheetByName('Schedule');
  if (!schedSheet || schedSheet.getLastRow() <= 1) {
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'success', message: 'No visits to send' }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  
  var allData = schedSheet.getDataRange().getValues();
  var today = new Date();
  today.setHours(0, 0, 0, 0);
  var end = new Date(today.getTime() + daysAhead * 86400000);
  
  // Group by date
  var byDate = {};
  for (var i = 1; i < allData.length; i++) {
    var row = allData[i];
    var d = row[0] instanceof Date ? row[0] : new Date(String(row[0]));
    if (isNaN(d.getTime())) continue;
    d.setHours(0, 0, 0, 0);
    if (d < today || d > end) continue;
    if (String(row[9] || '').toLowerCase() === 'cancelled') continue;
    
    var dateKey = Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    if (!byDate[dateKey]) byDate[dateKey] = [];
    byDate[dateKey].push({
      name: row[1], service: row[6], address: row[4],
      postcode: row[5], distance: row[11], phone: row[3],
      status: row[9], package: row[7]
    });
  }
  
  var dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  var dates = Object.keys(byDate).sort();
  
  if (dates.length === 0) {
    UrlFetchApp.fetch('https://api.telegram.org/bot' + TG_BOT_TOKEN + '/sendMessage', {
      method: 'post', contentType: 'application/json',
      payload: JSON.stringify({
        chat_id: TG_CHAT_ID, parse_mode: 'Markdown',
        text: '📋 *SCHEDULE DIGEST*\n\nNo subscription visits in the next ' + daysAhead + ' days. Diary is clear! 🌿'
      })
    });
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'success', sent: true }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  
  var totalVisits = 0;
  var msg = '📋 *SUBSCRIPTION SCHEDULE*\n_Next ' + daysAhead + ' days_\n\n';
  
  for (var di = 0; di < dates.length; di++) {
    var dk = dates[di];
    var dd = new Date(dk + 'T12:00:00');
    var dayName = dayNames[dd.getDay()];
    var dayLabel = dayName + ' ' + dk.substring(8) + '/' + dk.substring(5, 7);
    var visits = byDate[dk];
    totalVisits += visits.length;
    
    msg += '📅 *' + dayLabel + '* (' + visits.length + ' job' + (visits.length > 1 ? 's' : '') + ')\n';
    for (var v = 0; v < visits.length; v++) {
      var vis = visits[v];
      msg += '  🌿 ' + vis.service + ' — ' + vis.name + '\n';
      var visAddr = (vis.address ? vis.address + ', ' : '') + (vis.postcode || '');
      msg += '     📍 ' + (vis.postcode || '') + (vis.distance ? ' (' + vis.distance + ' mi)' : '') + '\n';
      if (visAddr) msg += '     🗺 [Get Directions](https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(visAddr) + ')\n';
      if (vis.phone) msg += '     📞 ' + vis.phone + '\n';
    }
    msg += '\n';
  }
  
  msg += '━━━━━━━━━━━━━━\n';
  msg += '📊 *Total:* ' + totalVisits + ' visits across ' + dates.length + ' days\n';
  msg += '_Auto-generated from subscription data_';
  
  UrlFetchApp.fetch('https://api.telegram.org/bot' + TG_BOT_TOKEN + '/sendMessage', {
    method: 'post', contentType: 'application/json',
    payload: JSON.stringify({
      chat_id: TG_CHAT_ID, parse_mode: 'Markdown',
      text: msg, disable_web_page_preview: true
    })
  });
  
  return ContentService
    .createTextOutput(JSON.stringify({ status: 'success', sent: true, visits: totalVisits, days: dates.length }))
    .setMimeType(ContentService.MimeType.JSON);
}

// Time-driven trigger: run weekly to auto-generate schedule + send digest
// Set up via Apps Script triggers: generateWeeklySchedule, every Monday at 6am
function generateWeeklySchedule() {
  generateSchedule({ weeksAhead: 4 });
  sendScheduleDigest({ daysAhead: 7 });
}


// ============================================
// SHEET UTILITY ENDPOINTS (read / write / tabs)
// ============================================

function sheetListTabs() {
  var ss = SpreadsheetApp.openById('1_Y7yHIpAvv_VNBhTrwNOQaBMAGa3UlVW_FKlf56ouHk');
  var tabs = ss.getSheets().map(function(s) {
    return { name: s.getName(), rows: s.getLastRow(), cols: s.getLastColumn() };
  });
  return ContentService
    .createTextOutput(JSON.stringify({ status: 'success', tabs: tabs }))
    .setMimeType(ContentService.MimeType.JSON);
}

function sheetReadRange(tab, range) {
  var ss = SpreadsheetApp.openById('1_Y7yHIpAvv_VNBhTrwNOQaBMAGa3UlVW_FKlf56ouHk');
  var sheet = ss.getSheetByName(tab);
  if (!sheet) {
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'error', error: 'Tab not found: ' + tab }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  var data;
  if (range) {
    data = sheet.getRange(range).getValues();
  } else {
    data = sheet.getDataRange().getValues();
  }
  return ContentService
    .createTextOutput(JSON.stringify({ status: 'success', tab: tab, range: range || 'all', rows: data.length, data: data }))
    .setMimeType(ContentService.MimeType.JSON);
}

function sheetWriteRange(payload) {
  var ss = SpreadsheetApp.openById('1_Y7yHIpAvv_VNBhTrwNOQaBMAGa3UlVW_FKlf56ouHk');
  var tabName = payload.tab || 'Jobs';
  var sheet = ss.getSheetByName(tabName);
  if (!sheet) {
    sheet = ss.insertSheet(tabName);
  }
  // payload.range = 'A1:C3'  payload.values = [[...],[...],[...]]
  // OR payload.append = true  payload.values = [[...]]  (append rows)
  if (payload.append && payload.values) {
    for (var i = 0; i < payload.values.length; i++) {
      sheet.appendRow(payload.values[i]);
    }
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'success', message: 'Appended ' + payload.values.length + ' rows to ' + tabName }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  if (payload.range && payload.values) {
    var r = sheet.getRange(payload.range);
    r.setValues(payload.values);
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'success', message: 'Wrote to ' + tabName + '!' + payload.range }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  // Clear a range
  if (payload.clear && payload.range) {
    sheet.getRange(payload.range).clearContent();
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'success', message: 'Cleared ' + tabName + '!' + payload.range }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  return ContentService
    .createTextOutput(JSON.stringify({ status: 'error', error: 'Provide range+values, append+values, or clear+range' }))
    .setMimeType(ContentService.MimeType.JSON);
}


// ============================================
// UNIQUE JOB NUMBER GENERATOR
// ============================================

function generateJobNumber() {
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var sheet = SpreadsheetApp.openById('1_Y7yHIpAvv_VNBhTrwNOQaBMAGa3UlVW_FKlf56ouHk').getSheetByName('Jobs');
    var data = sheet.getDataRange().getValues();
    var maxNum = 0;
    
    // Column T (index 19) = jobNumber
    for (var i = 1; i < data.length; i++) {
      var jn = String(data[i][19] || '');
      var match = jn.match(/GGM-(\d+)/);
      if (match) {
        var num = parseInt(match[1]);
        if (num > maxNum) maxNum = num;
      }
    }
    
    var next = maxNum + 1;
    var jobNum = 'GGM-' + String(next).padStart(4, '0');
    
    // Reserve the number by writing a placeholder row
    // This prevents race conditions between lock release and row append
    Logger.log('Generated job number: ' + jobNum);
    return jobNum;
  } finally {
    lock.releaseLock();
  }
}

// Backfill job numbers for existing rows without one
function backfillJobNumbers() {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var sheet = SpreadsheetApp.openById('1_Y7yHIpAvv_VNBhTrwNOQaBMAGa3UlVW_FKlf56ouHk').getSheetByName('Jobs');
    var data = sheet.getDataRange().getValues();
    var count = 0;
    var nextNum = 1;
    
    // First find the highest existing job number
    for (var i = 1; i < data.length; i++) {
      var jn = String(data[i][19] || '');
      var match = jn.match(/GGM-(\d+)/);
      if (match) {
        var num = parseInt(match[1]);
        if (num >= nextNum) nextNum = num + 1;
      }
    }
    
    // Now assign numbers to rows without one
    for (var i = 1; i < data.length; i++) {
      var existing = String(data[i][19] || '').trim();
      if (!existing) {
        var jobNum = 'GGM-' + String(nextNum).padStart(4, '0');
        sheet.getRange(i + 1, 20).setValue(jobNum); // Column T = column 20
        nextNum++;
        count++;
      }
    }
    
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'success', message: count + ' rows backfilled with job numbers' }))
      .setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}


// ============================================
// DOUBLE BOOKING PREVENTION
// ============================================

function checkAvailability(params) {
  var date = params.date || '';
  var time = params.time || '';
  var service = params.service || '';
  
  if (!date) {
    return ContentService
      .createTextOutput(JSON.stringify({ available: true, slots: {}, dayBookings: [] }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  
  var targetDate = normaliseDateToISO(date);
  
  var ss = SpreadsheetApp.openById('1_Y7yHIpAvv_VNBhTrwNOQaBMAGa3UlVW_FKlf56ouHk');
  var sheet = ss.getSheetByName('Jobs');
  var data = sheet.getDataRange().getValues();
  
  // ── Service capacity rules (one-man band) ──
  // slots   = hours the job takes (1 slot = 1 hour)
  // buffer  = travel/pack-up buffer after the job (1 hour)
  // fullDay = blocks the entire day
  // maxPerDay = max bookings of this service type per day
  var serviceRules = {
    'garden-clearance': { fullDay: true,  slots: 9, buffer: 0, maxPerDay: 1 },
    'power-washing':    { fullDay: true,  slots: 9, buffer: 0, maxPerDay: 1 },
    'scarifying':       { fullDay: true,  slots: 9, buffer: 0, maxPerDay: 1 },
    'emergency-tree':   { fullDay: true,  slots: 9, buffer: 0, maxPerDay: 1 },
    'veg-patch':        { fullDay: true,  slots: 9, buffer: 0, maxPerDay: 1 },
    'hedge-trimming':   { fullDay: false, slots: 3, buffer: 1, maxPerDay: 1 },
    'fence-repair':     { fullDay: false, slots: 3, buffer: 1, maxPerDay: 1 },
    'lawn-treatment':   { fullDay: false, slots: 2, buffer: 1, maxPerDay: 2 },
    'weeding-treatment': { fullDay: false, slots: 2, buffer: 1, maxPerDay: 2 },
    'drain-clearance':  { fullDay: false, slots: 1, buffer: 1, maxPerDay: 2 },
    'gutter-cleaning':  { fullDay: false, slots: 1, buffer: 1, maxPerDay: 2 },
    'lawn-cutting':     { fullDay: false, slots: 1, buffer: 1, maxPerDay: 2 },
    'free-quote-visit': { fullDay: false, slots: 1, buffer: 1, maxPerDay: 2 }
  };
  
  // All time slots in the system (must match booking.html)
  var allSlots = [
    '08:00 - 09:00', '09:00 - 10:00', '10:00 - 11:00',
    '11:00 - 12:00', '12:00 - 13:00', '13:00 - 14:00',
    '14:00 - 15:00', '15:00 - 16:00', '16:00 - 17:00'
  ];
  
  // ── Gather all active bookings for this date (Sheet1) ──
  var dayBookings = [];
  for (var i = 1; i < data.length; i++) {
    var rowDate = normaliseDateToISO(data[i][8]);
    var rowStatus = String(data[i][11] || '').toLowerCase();
    
    if (rowStatus === 'cancelled' || rowStatus === 'canceled' || rowStatus === 'completed') continue;
    if (rowDate !== targetDate) continue;
    
    var rowTime = String(data[i][9] || '').trim();
    // Normalise time: if stored as just "09:00", convert to "09:00 - 10:00" format
    if (/^\d{2}:\d{2}$/.test(rowTime)) {
      var hr = parseInt(rowTime.split(':')[0], 10);
      rowTime = rowTime + ' - ' + String(hr + 1).padStart(2, '0') + ':00';
    }
    // If time is a Date object serialised as string, extract HH:MM
    var timeMatch = rowTime.match(/(\d{2}):(\d{2}):\d{2}/);
    if (timeMatch && allSlots.indexOf(rowTime) === -1) {
      var thr = parseInt(timeMatch[1], 10);
      rowTime = timeMatch[1] + ':' + timeMatch[2] + ' - ' + String(thr + 1).padStart(2, '0') + ':00';
    }
    var rowService = String(data[i][7] || '').toLowerCase()
      .replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    var rowName = String(data[i][2] || '');
    
    dayBookings.push({
      time: rowTime,
      service: rowService,
      name: rowName,
      source: 'booking'
    });
  }
  
  // ── Collect subscription visits from Schedule sheet (assigned times later) ──
  var subscriptionVisits = [];
  try {
    var schedSheet = ss.getSheetByName('Schedule');
    if (schedSheet && schedSheet.getLastRow() > 1) {
      var schedData = schedSheet.getDataRange().getValues();
      for (var j = 1; j < schedData.length; j++) {
        var schedDate = normaliseDateToISO(schedData[j][0]);
        var schedStatus = String(schedData[j][9] || '').toLowerCase();
        if (schedStatus === 'cancelled' || schedStatus === 'completed' || schedStatus === 'skipped') continue;
        if (schedDate !== targetDate) continue;
        
        var schedService = String(schedData[j][6] || '').toLowerCase()
          .replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
        var schedName = String(schedData[j][1] || '');
        
        // Default subscription visits to lawn-cutting if no service specified
        if (!schedService) schedService = 'lawn-cutting';
        
        subscriptionVisits.push({
          service: schedService,
          name: schedName + ' (subscription)',
          source: 'subscription'
        });
      }
    }
  } catch(e) {
    // Schedule sheet may not exist yet — safe to ignore
  }
  
  // ── Build slot availability map WITH travel buffers ──
  // PASS 1: Mark slots from ad-hoc bookings (which have real times)
  var slotMap = {};
  allSlots.forEach(function(s) {
    slotMap[s] = { booked: false, service: '', name: '', isBuffer: false };
  });
  
  var fullDayBooked = false;
  for (var b = 0; b < dayBookings.length; b++) {
    var booking = dayBookings[b];
    var bRule = serviceRules[booking.service] || { fullDay: false, slots: 1, buffer: 1, maxPerDay: 2 };
    
    if (bRule.fullDay) {
      // Full-day service: mark ALL slots as booked
      fullDayBooked = true;
      allSlots.forEach(function(s) {
        slotMap[s] = { booked: true, service: booking.service, name: booking.name, isBuffer: false };
      });
      break;
    } else {
      // Mark the job slots as booked
      var startIdx = allSlots.indexOf(booking.time);
      if (startIdx === -1) startIdx = 0;
      var jobEnd = Math.min(startIdx + bRule.slots, allSlots.length);
      for (var si = startIdx; si < jobEnd; si++) {
        slotMap[allSlots[si]] = { booked: true, service: booking.service, name: booking.name, isBuffer: false };
      }
      // Mark travel buffer slots AFTER the job
      var bufferEnd = Math.min(jobEnd + bRule.buffer, allSlots.length);
      for (var bi = jobEnd; bi < bufferEnd; bi++) {
        if (!slotMap[allSlots[bi]].booked) {
          slotMap[allSlots[bi]] = { booked: true, service: 'travel-buffer', name: '', isBuffer: true };
        }
      }
    }
  }
  
  // PASS 2: Fit subscription visits into the first available gap
  // This ensures subscriptions slot around existing ad-hoc bookings intelligently
  if (!fullDayBooked) {
    for (var sv = 0; sv < subscriptionVisits.length; sv++) {
      var subVisit = subscriptionVisits[sv];
      var subRule = serviceRules[subVisit.service] || { fullDay: false, slots: 1, buffer: 1, maxPerDay: 2 };
      
      if (subRule.fullDay) {
        // Full-day subscription visit: only fits if entire day is empty
        var anyBooked = false;
        for (var chk = 0; chk < allSlots.length; chk++) {
          if (slotMap[allSlots[chk]].booked) { anyBooked = true; break; }
        }
        if (!anyBooked) {
          fullDayBooked = true;
          allSlots.forEach(function(s) {
            slotMap[s] = { booked: true, service: subVisit.service, name: subVisit.name, isBuffer: false };
          });
          subVisit.time = allSlots[0];
          dayBookings.push(subVisit);
        }
      } else {
        // Find first contiguous gap that fits (slots + buffer)
        var needed = subRule.slots + subRule.buffer;
        var assignedTime = null;
        for (var g = 0; g <= allSlots.length - subRule.slots; g++) {
          var fits = true;
          var gapEnd = Math.min(g + needed, allSlots.length);
          for (var gc = g; gc < gapEnd; gc++) {
            if (slotMap[allSlots[gc]].booked) { fits = false; break; }
          }
          if (fits) {
            assignedTime = allSlots[g];
            // Mark job slots
            var subJobEnd = Math.min(g + subRule.slots, allSlots.length);
            for (var ssi = g; ssi < subJobEnd; ssi++) {
              slotMap[allSlots[ssi]] = { booked: true, service: subVisit.service, name: subVisit.name, isBuffer: false };
            }
            // Mark travel buffer
            var subBufEnd = Math.min(subJobEnd + subRule.buffer, allSlots.length);
            for (var sbi = subJobEnd; sbi < subBufEnd; sbi++) {
              if (!slotMap[allSlots[sbi]].booked) {
                slotMap[allSlots[sbi]] = { booked: true, service: 'travel-buffer', name: '', isBuffer: true };
              }
            }
            break;
          }
        }
        if (assignedTime) {
          subVisit.time = assignedTime;
          dayBookings.push(subVisit);
        }
        // If no gap found, subscription visit can't fit (day is overbooked)
      }
    }
  }
  
  // ── Count bookings by service type for maxPerDay limits ──
  var serviceCounts = {};
  dayBookings.forEach(function(b) {
    serviceCounts[b.service] = (serviceCounts[b.service] || 0) + 1;
  });
  
  // Total active bookings for the day
  var totalBookings = dayBookings.length;
  
  // ── Determine if the REQUESTED service+time is available ──
  var available = true;
  var reason = '';
  
  var requestedRule = serviceRules[service] || { fullDay: false, slots: 1, buffer: 1, maxPerDay: 2 };
  
  if (fullDayBooked) {
    available = false;
    reason = 'A full-day job is already booked on this date';
  } else if (requestedRule.fullDay && totalBookings > 0) {
    available = false;
    reason = 'This is a full-day service but other jobs are already booked on this date';
  } else if (time) {
    var reqStartIdx = allSlots.indexOf(time);
    if (reqStartIdx === -1) {
      available = false;
      reason = 'Invalid time slot';
    } else {
      // Check the job itself fits within the day
      if (reqStartIdx + requestedRule.slots > allSlots.length) {
        available = false;
        reason = 'Not enough time remaining in the day for this service';
      }
      // Check all slots the job + buffer would need are free
      if (available) {
        var totalNeeded = Math.min(reqStartIdx + requestedRule.slots + requestedRule.buffer, allSlots.length);
        for (var rs = reqStartIdx; rs < totalNeeded; rs++) {
          if (slotMap[allSlots[rs]].booked) {
            var conflictInfo = slotMap[allSlots[rs]];
            if (conflictInfo.isBuffer) {
              available = false;
              reason = 'This time is reserved as travel buffer between jobs';
            } else {
              available = false;
              reason = 'This time slot conflicts with an existing booking (' + conflictInfo.name + ' — ' + conflictInfo.service.replace(/-/g, ' ') + ')';
            }
            break;
          }
        }
      }
      // Check maxPerDay limit
      if (available) {
        var svcKey = service || 'unknown';
        var currentCount = serviceCounts[svcKey] || 0;
        if (currentCount >= requestedRule.maxPerDay) {
          available = false;
          reason = 'Maximum bookings for this service type reached today (limit: ' + requestedRule.maxPerDay + ')';
        }
      }
      // Check overall day capacity (max 3 separate jobs excl. full-day)
      if (available && totalBookings >= 3) {
        available = false;
        reason = 'Maximum of 3 jobs per day reached';
      }
    }
  }
  
  return ContentService
    .createTextOutput(JSON.stringify({
      available: available,
      reason: reason,
      slots: slotMap,
      dayBookings: dayBookings.map(function(b) {
        return { time: b.time, service: b.service, source: b.source || 'booking' };
      }),
      serviceCounts: serviceCounts,
      totalBookings: totalBookings,
      fullDayBooked: fullDayBooked
    }))
    .setMimeType(ContentService.MimeType.JSON);
}


// ============================================
// CANCELLATION ENGINE — ONE-OFF BOOKINGS
// ============================================

function cancelBooking(data) {
  var rowIndex = data.rowIndex;
  var jobNumber = data.jobNumber || '';
  var reason = data.reason || 'Customer requested cancellation';
  var refund = data.refund !== false; // default true
  
  var ss = SpreadsheetApp.openById('1_Y7yHIpAvv_VNBhTrwNOQaBMAGa3UlVW_FKlf56ouHk');
  var sheet = ss.getSheetByName('Jobs');
  var allData = sheet.getDataRange().getValues();
  
  // Find the row by rowIndex or jobNumber
  var row = null;
  var ri = 0;
  if (rowIndex && rowIndex >= 2) {
    ri = rowIndex;
    row = allData[ri - 1]; // 0-indexed
  } else if (jobNumber) {
    for (var i = 1; i < allData.length; i++) {
      if (String(allData[i][19] || '') === jobNumber) {
        ri = i + 1;
        row = allData[i];
        break;
      }
    }
  }
  
  if (!row) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: 'Booking not found' }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  
  var name = String(row[2] || '');
  var email = String(row[3] || '');
  var service = String(row[7] || '');
  var date = String(row[8] || '');
  var time = String(row[9] || '');
  var price = String(row[12] || '');
  var paid = String(row[17] || '');
  var paymentType = String(row[18] || '');
  var jn = String(row[19] || '');
  
  // 1) Update sheet status to Cancelled
  sheet.getRange(ri, 12).setValue('Cancelled');
  
  // 2) Stripe refund if paid via Stripe
  var refundResult = { refunded: false };
  if (refund && (paid === 'Yes' || paid === 'Auto') && paymentType.indexOf('Stripe') >= 0) {
    try {
      refundResult = processStripeRefund(email, service, price);
    } catch (e) {
      refundResult = { refunded: false, error: e.message };
    }
  }
  
  // 3) Remove from Google Calendar
  try { removeCalendarEvent(jn || (name + ' ' + service + ' ' + date)); } catch(e) {}
  
  // 4) Send cancellation confirmation email
  try {
    sendCancellationEmail({
      name: name, email: email, service: service, date: date,
      time: time, jobNumber: jn, price: price,
      refunded: refundResult.refunded, reason: reason, type: 'booking'
    });
  } catch(e) {}
  
  // 5) Telegram notification
  notifyTelegram('🚨 *CANCELLATION ALERT* 🚨\n━━━━━━━━━━━━━━━━━━━━\n\n❌ *Booking Cancelled*\n\n👤 ' + name + '\n📋 ' + service + '\n📅 ' + date + (time ? ' ' + time : '') + '\n🔖 ' + jn + '\n💷 ' + price + (refundResult.refunded ? ' ✅ REFUNDED' : ' ⚠️ No refund') + '\n📝 ' + reason + '\n\n⚡ _Slot now free — check schedule_');
  
  return ContentService.createTextOutput(JSON.stringify({
    status: 'success', message: 'Booking cancelled',
    refunded: refundResult.refunded,
    refundAmount: refundResult.amount || 0
  })).setMimeType(ContentService.MimeType.JSON);
}


// ============================================
// CANCELLATION ENGINE — SUBSCRIPTIONS
// ============================================

function cancelSubscription(data) {
  var rowIndex = data.rowIndex;
  var jobNumber = data.jobNumber || '';
  var reason = data.reason || 'Customer requested cancellation';
  
  var ss = SpreadsheetApp.openById('1_Y7yHIpAvv_VNBhTrwNOQaBMAGa3UlVW_FKlf56ouHk');
  var sheet = ss.getSheetByName('Jobs');
  var allData = sheet.getDataRange().getValues();
  
  // Find subscription row
  var row = null;
  var ri = 0;
  if (rowIndex && rowIndex >= 2) {
    ri = rowIndex;
    row = allData[ri - 1];
  } else if (jobNumber) {
    for (var i = 1; i < allData.length; i++) {
      if (String(allData[i][19] || '') === jobNumber) {
        ri = i + 1;
        row = allData[i];
        break;
      }
    }
  }
  
  if (!row) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: 'Subscription not found' }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  
  var name = String(row[2] || '');
  var email = String(row[3] || '');
  var service = String(row[7] || '');
  var jn = String(row[19] || '');
  var price = String(row[12] || '');
  
  // 1) Update Jobs sheet status to Cancelled
  sheet.getRange(ri, 12).setValue('Cancelled');
  
  // 2) Cancel Stripe subscription (find by customer email + metadata)
  var stripeCancelled = false;
  try {
    stripeCancelled = cancelStripeSubscription(email);
  } catch(e) {
    Logger.log('Stripe cancel failed: ' + e);
  }
  
  // 3) Remove future scheduled visits from Schedule sheet
  var removedVisits = 0;
  try {
    var schedSheet = ss.getSheetByName('Schedule');
    if (schedSheet) {
      var schedData = schedSheet.getDataRange().getValues();
      var today = new Date();
      today.setHours(0, 0, 0, 0);
      // Go backwards to avoid index shifting
      for (var s = schedData.length - 1; s >= 1; s--) {
        var schedName = String(schedData[s][1] || '');
        var schedJob = String(schedData[s][10] || '');
        if (schedName === name || schedJob === jn) {
          var visitDate = schedData[s][0] instanceof Date ? schedData[s][0] : new Date(String(schedData[s][0]));
          if (visitDate >= today) {
            schedSheet.deleteRow(s + 1);
            removedVisits++;
          }
        }
      }
    }
  } catch(e) {}
  
  // 4) Remove calendar events for future visits
  try { removeCalendarEvents(name); } catch(e) {}
  
  // 5) Send cancellation email
  try {
    sendCancellationEmail({
      name: name, email: email, service: service, date: '',
      time: '', jobNumber: jn, price: price,
      refunded: false, reason: reason, type: 'subscription',
      stripeCancelled: stripeCancelled
    });
  } catch(e) {}
  
  // 6) Telegram
  notifyBot('moneybot', '🚨 *SUBSCRIPTION LOST* 🚨\n━━━━━━━━━━━━━━━━━━━━\n\n❌ *Recurring Revenue Lost*\n\n👤 ' + name + '\n📦 ' + service + '\n🔖 ' + jn + '\n💷 ' + price + ' /period\n📅 ' + removedVisits + ' future visits removed' + (stripeCancelled ? '\n💳 Stripe sub cancelled' : '') + '\n📝 ' + reason + '\n\n⚡ _Review pricing & follow up_');
  
  return ContentService.createTextOutput(JSON.stringify({
    status: 'success', message: 'Subscription cancelled',
    stripeCancelled: stripeCancelled, removedVisits: removedVisits
  })).setMimeType(ContentService.MimeType.JSON);
}


// ============================================
// STRIPE REFUND — One-off payment refund
// ============================================

function processStripeRefund(email, service, priceStr) {
  try {
    // Find customer by email
    var customer = findOrCreateCustomer(email, '', '', '', '');
    if (!customer || !customer.id) return { refunded: false, note: 'Customer not found' };
    
    // Find latest charge for this customer
    var charges = stripeRequest('/v1/charges?customer=' + customer.id + '&limit=5', 'get');
    if (!charges.data || charges.data.length === 0) return { refunded: false, note: 'No charges found' };
    
    // Find matching charge by amount
    var amountPence = 0;
    if (priceStr) {
      var priceMatch = priceStr.match(/[\d.]+/);
      if (priceMatch) amountPence = Math.round(parseFloat(priceMatch[0]) * 100);
    }
    
    var chargeToRefund = null;
    for (var i = 0; i < charges.data.length; i++) {
      if (!charges.data[i].refunded) {
        if (!amountPence || charges.data[i].amount === amountPence) {
          chargeToRefund = charges.data[i];
          break;
        }
      }
    }
    
    if (!chargeToRefund) return { refunded: false, note: 'No matching charge found' };
    
    var refund = stripeRequest('/v1/refunds', 'post', { charge: chargeToRefund.id });
    notifyBot('moneybot', '💸 *Refund Processed*\n📧 ' + email + '\n💵 £' + (chargeToRefund.amount / 100).toFixed(2) + '\n🆔 ' + refund.id);
    return { refunded: true, refundId: refund.id, amount: chargeToRefund.amount };
  } catch(e) {
    Logger.log('Stripe refund error: ' + e);
    return { refunded: false, note: e.message };
  }
}


// ============================================
// STRIPE — Cancel subscription by customer email
// ============================================

function cancelStripeSubscription(email) {
  try {
    var customer = findOrCreateCustomer(email, '', '', '', '');
    if (!customer || !customer.id) return false;
    
    // List active subscriptions for this customer
    var subs = stripeRequest('/v1/subscriptions?customer=' + customer.id + '&status=active&limit=10', 'get');
    if (!subs.data || subs.data.length === 0) {
      Logger.log('No active Stripe subscriptions for ' + email);
      return false;
    }
    
    // Cancel all active subscriptions
    var cancelled = 0;
    for (var i = 0; i < subs.data.length; i++) {
      try {
        stripeRequest('/v1/subscriptions/' + subs.data[i].id, 'delete');
        cancelled++;
      } catch(e) { Logger.log('Cancel sub error: ' + e); }
    }
    
    if (cancelled > 0) {
      notifyBot('moneybot', '🔴 *Subscription Cancelled*\n📧 ' + email + '\n🔄 ' + cancelled + ' subscription(s) cancelled');
      return true;
    }
    return false;
  } catch(e) {
    Logger.log('Cancel subscription error: ' + e);
    return false;
  }
}


// ============================================
// RESCHEDULE BOOKING
// ============================================

function rescheduleBooking(data) {
  var rowIndex = data.rowIndex;
  var jobNumber = data.jobNumber || '';
  var newDate = data.newDate || '';
  var newTime = data.newTime || '';
  
  var ss = SpreadsheetApp.openById('1_Y7yHIpAvv_VNBhTrwNOQaBMAGa3UlVW_FKlf56ouHk');
  var sheet = ss.getSheetByName('Jobs');
  var allData = sheet.getDataRange().getValues();
  
  // Find row
  var row = null;
  var ri = 0;
  if (rowIndex && rowIndex >= 2) {
    ri = rowIndex;
    row = allData[ri - 1];
  } else if (jobNumber) {
    for (var i = 1; i < allData.length; i++) {
      if (String(allData[i][19] || '') === jobNumber) {
        ri = i + 1;
        row = allData[i];
        break;
      }
    }
  }
  
  if (!row) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: 'Booking not found' }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  
  var name = String(row[2] || '');
  var email = String(row[3] || '');
  var service = String(row[7] || '');
  var oldDate = String(row[8] || '');
  var oldTime = String(row[9] || '');
  var jn = String(row[19] || '');
  
  // Check new slot is available
  var svcKey = service.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  var check = JSON.parse(checkAvailability({ date: newDate, time: newTime, service: svcKey }).getContent());
  if (!check.available) {
    // Find alternatives
    var alts = JSON.parse(suggestAlternativeSlots({ date: newDate, service: svcKey }).getContent());
    return ContentService.createTextOutput(JSON.stringify({
      status: 'error', message: 'New slot not available: ' + check.reason,
      alternatives: alts.alternatives || []
    })).setMimeType(ContentService.MimeType.JSON);
  }
  
  // Update row
  sheet.getRange(ri, 9).setValue(newDate);
  sheet.getRange(ri, 10).setValue(newTime);
  
  // Update calendar
  try {
    removeCalendarEvent(jn || (name + ' ' + service));
    createCalendarEvent(name, service, newDate, newTime, String(row[5] || ''), String(row[6] || ''), jn);
  } catch(e) {}
  
  // Send reschedule email
  try {
    sendRescheduleEmail({
      name: name, email: email, service: service,
      oldDate: oldDate, oldTime: oldTime,
      newDate: newDate, newTime: newTime, jobNumber: jn
    });
  } catch(e) {}
  
  // Telegram
  notifyTelegram('� *RESCHEDULE NOTICE*\n\n👤 ' + name + '\n📋 ' + service + '\n📅 ' + oldDate + ' ' + oldTime + ' ➡️ ' + newDate + ' ' + newTime + '\n🔖 ' + jn + '\n\n_Check calendar for clashes_');
  
  return ContentService.createTextOutput(JSON.stringify({
    status: 'success', message: 'Booking rescheduled'
  })).setMimeType(ContentService.MimeType.JSON);
}


// ============================================
// SMART FALLBACK — Suggest alternative slots
// ============================================

function suggestAlternativeSlots(params) {
  var date = params.date || '';
  var service = params.service || '';
  var daysToCheck = parseInt(params.days) || 7;
  
  var serviceRules = {
    'garden-clearance': { fullDay: true, slots: 9, buffer: 0 },
    'power-washing':    { fullDay: true, slots: 9, buffer: 0 },
    'scarifying':       { fullDay: true, slots: 9, buffer: 0 },
    'hedge-trimming':   { fullDay: false, slots: 3, buffer: 1 },
    'lawn-treatment':   { fullDay: false, slots: 2, buffer: 1 },
    'lawn-cutting':     { fullDay: false, slots: 1, buffer: 1 }
  };
  
  var rule = serviceRules[service] || { fullDay: false, slots: 1, buffer: 1 };
  var alternatives = [];
  var startDate = date ? new Date(normaliseDateToISO(date) + 'T12:00:00') : new Date();
  
  for (var d = 0; d < daysToCheck && alternatives.length < 5; d++) {
    var checkDate = new Date(startDate.getTime() + d * 86400000);
    if (checkDate.getDay() === 0) continue; // Skip Sundays
    
    var dateStr = normaliseDateToISO(checkDate);
    var result = JSON.parse(checkAvailability({ date: dateStr, service: service }).getContent());
    
    if (result.fullDayBooked) continue;
    if (rule.fullDay && result.totalBookings > 0) continue;
    
    var allSlots = [
      '08:00 - 09:00', '09:00 - 10:00', '10:00 - 11:00',
      '11:00 - 12:00', '12:00 - 13:00', '13:00 - 14:00',
      '14:00 - 15:00', '15:00 - 16:00', '16:00 - 17:00'
    ];
    
    for (var s = 0; s < allSlots.length && alternatives.length < 5; s++) {
      var slotCheck = JSON.parse(checkAvailability({ date: dateStr, time: allSlots[s], service: service }).getContent());
      if (slotCheck.available) {
        var dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
        alternatives.push({
          date: dateStr,
          time: allSlots[s],
          dayName: dayNames[checkDate.getDay()],
          display: dayNames[checkDate.getDay()] + ' ' + dateStr.substring(8) + '/' + dateStr.substring(5,7) + ' at ' + allSlots[s].split(' - ')[0]
        });
        if (rule.fullDay) break; // Full-day only needs one slot per day
      }
    }
  }
  
  return ContentService.createTextOutput(JSON.stringify({
    status: 'success', alternatives: alternatives
  })).setMimeType(ContentService.MimeType.JSON);
}


// ============================================
// GOOGLE CALENDAR SYNC
// ============================================

function getGardenCalendar() {
  // Use default calendar or find one named 'Gardners GM'
  var cals = CalendarApp.getCalendarsByName('Gardners GM');
  if (cals.length > 0) return cals[0];
  // Create it
  var cal = CalendarApp.createCalendar('Gardners GM', { color: CalendarApp.Color.GREEN });
  return cal;
}

function createCalendarEvent(name, service, date, time, address, postcode, jobNumber) {
  var cal = getGardenCalendar();
  var isoDate = normaliseDateToISO(date);
  
  var serviceDurations = {
    'lawn-cutting': 1, 'hedge-trimming': 3, 'lawn-treatment': 2,
    'scarifying': 8, 'garden-clearance': 8, 'power-washing': 8,
    'veg-patch': 3, 'weeding-treatment': 2, 'fence-repair': 4,
    'emergency-tree': 4, 'drain-clearance': 2, 'gutter-cleaning': 2
  };
  var svcKey = (service || '').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  var hours = serviceDurations[svcKey] || 1;
  
  // Parse start time
  var startHour = 8, startMin = 0;
  if (time) {
    var tm = time.match(/^(\d{2}):(\d{2})/);
    if (tm) { startHour = parseInt(tm[1]); startMin = parseInt(tm[2]); }
  }
  
  var parts = isoDate.split('-');
  var start = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]), startHour, startMin);
  var end = new Date(start.getTime() + hours * 3600000);
  
  var title = '🌿 ' + service + ' — ' + name;
  var desc = 'Job: ' + (jobNumber || 'N/A') + '\nCustomer: ' + name + '\nAddress: ' + (address || '') + (postcode ? ', ' + postcode : '');
  var location = (address || '') + (postcode ? ', ' + postcode : '');
  
  var event = cal.createEvent(title, start, end, {
    description: desc,
    location: location
  });
  event.setColor(CalendarApp.EventColor.GREEN);
  
  return event.getId();
}

function removeCalendarEvent(searchTerm) {
  if (!searchTerm) return;
  var cal = getGardenCalendar();
  var now = new Date();
  var future = new Date(now.getTime() + 90 * 86400000);
  var events = cal.getEvents(now, future);
  
  for (var i = 0; i < events.length; i++) {
    var title = events[i].getTitle() || '';
    var desc = events[i].getDescription() || '';
    if (title.indexOf(searchTerm) >= 0 || desc.indexOf(searchTerm) >= 0) {
      events[i].deleteEvent();
    }
  }
}

function removeCalendarEvents(customerName) {
  if (!customerName) return;
  var cal = getGardenCalendar();
  var now = new Date();
  var future = new Date(now.getTime() + 365 * 86400000);
  var events = cal.getEvents(now, future);
  
  for (var i = 0; i < events.length; i++) {
    if ((events[i].getTitle() || '').indexOf(customerName) >= 0) {
      events[i].deleteEvent();
    }
  }
}

// Sync a booking to Google Calendar on creation
function syncBookingToCalendar(data) {
  try {
    createCalendarEvent(
      data.name || '', data.service || '', data.date || '',
      data.time || '', data.address || '', data.postcode || '',
      data.jobNumber || ''
    );
  } catch(e) {
    Logger.log('Calendar sync failed: ' + e);
  }
}


// ============================================
// CANCELLATION CONFIRMATION EMAIL
// ============================================

function sendCancellationEmail(data) {
  if (!data.email) return;
  // Hub owns cancellation emails when HUB_OWNS_EMAILS is true
  if (HUB_OWNS_EMAILS) {
    Logger.log('sendCancellationEmail: skipped (HUB_OWNS_EMAILS=true) for ' + (data.email || ''));
    return;
  }
  var firstName = (data.name || 'Customer').split(' ')[0];
  var isSub = data.type === 'subscription';
  
  var subject = '🚫 ' + (isSub ? 'Subscription' : 'Booking') + ' Cancelled — ' + (data.jobNumber || 'Gardners GM');
  
  var refundBlock = '';
  if (data.refunded) {
    refundBlock = '<div style="background:#E8F5E9;border:1px solid #A5D6A7;border-radius:8px;padding:15px;margin:15px 0;">'
      + '<p style="color:#2E7D32;font-weight:700;margin:0;">💰 Refund Processed</p>'
      + '<p style="color:#555;margin:5px 0 0;font-size:14px;">Your payment of ' + (data.price || '') + ' has been refunded to your original payment method. Please allow 5-10 business days for it to appear.</p>'
      + '</div>';
  }
  
  var html = '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:0;background:#f0f2f5;font-family:Georgia,\'Times New Roman\',serif;">'
    + '<div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.08);">'
    + getGgmEmailHeader({ title: '🚫 ' + (isSub ? 'Subscription' : 'Booking') + ' Cancelled', gradient: '#d32f2f', gradientEnd: '#e53935' })
    + '<div style="padding:30px;">'
    + '<h2 style="color:#333;margin:0 0 10px;">Hi ' + firstName + ',</h2>'
    + '<p style="color:#555;line-height:1.6;">We\'re sorry to see you go. Your ' + (isSub ? 'subscription' : 'booking') + ' has been cancelled as requested.</p>'
    + '<div style="background:#FFF3E0;border:1px solid #FFE0B2;border-radius:8px;overflow:hidden;margin:20px 0;">'
    + '<div style="background:#E65100;padding:10px 15px;"><h3 style="color:#fff;margin:0;font-size:15px;">📋 Cancellation Details</h3></div>'
    + '<table style="width:100%;border-collapse:collapse;">'
    + '<tr><td style="padding:8px 15px;color:#666;font-weight:600;width:130px;">Reference</td><td style="padding:8px 15px;">' + (data.jobNumber || 'N/A') + '</td></tr>'
    + '<tr style="background:#FFF8E1;"><td style="padding:8px 15px;color:#666;font-weight:600;">Service</td><td style="padding:8px 15px;">' + (data.service || '') + '</td></tr>'
    + (data.date ? '<tr><td style="padding:8px 15px;color:#666;font-weight:600;">Date</td><td style="padding:8px 15px;">' + data.date + (data.time ? ' at ' + data.time : '') + '</td></tr>' : '')
    + (data.price ? '<tr style="background:#FFF8E1;"><td style="padding:8px 15px;color:#666;font-weight:600;">Amount</td><td style="padding:8px 15px;">' + data.price + '</td></tr>' : '')
    + '</table></div>'
    + refundBlock
    + (isSub ? '<p style="color:#555;line-height:1.6;">All future scheduled visits have been removed. Your subscription has been ' + (data.stripeCancelled ? 'cancelled — no further payments will be taken.' : 'updated.') + '</p>' : '')
    + '<div style="background:#f8faf8;border-radius:8px;padding:20px;text-align:center;margin:20px 0;">'
    + '<p style="color:#2E7D32;font-weight:700;margin:0 0 8px;">Changed your mind?</p>'
    + '<p style="color:#555;font-size:13px;margin:0 0 12px;">We\'d love to have you back! Book a new service anytime.</p>'
    + '<a href="https://gardnersgm.co.uk/booking.html" style="display:inline-block;background:#2E7D32;color:#fff;padding:10px 24px;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px;">Book Again</a>'
    + '</div></div>'
    + getGgmEmailFooter(data.email)
    + '</div></body></html>';
  
  sendEmail({
    to: data.email, toName: '', subject: subject, htmlBody: html,
    name: 'Gardners Ground Maintenance', replyTo: 'info@gardnersgm.co.uk'
  });
}


// ============================================
// RESCHEDULE CONFIRMATION EMAIL
// ============================================

function sendRescheduleEmail(data) {
  if (!data.email) return;
  // Hub owns reschedule emails when HUB_OWNS_EMAILS is true
  if (HUB_OWNS_EMAILS) {
    Logger.log('sendRescheduleEmail: skipped (HUB_OWNS_EMAILS=true) for ' + (data.email || ''));
    return;
  }
  var firstName = (data.name || 'Customer').split(' ')[0];
  var svc = getServiceContent(data.service);
  var svcIcon = svc ? svc.icon : '🔄';
  var svcName = svc ? svc.name : (data.service || 'your service');
  
  var subject = '🔄 ' + svcName + ' Rescheduled — ' + (data.jobNumber || 'Gardners GM');
  
  // Service-specific preparation tips
  var prepHtml = '';
  if (svc && svc.preparation) {
    prepHtml = '<div style="background:#FFF8E1;border:1px solid #FFE082;border-radius:8px;padding:15px 20px;margin:20px 0;">'
      + '<h3 style="color:#F57F17;margin:0 0 8px;font-size:15px;">📋 Preparation Reminder — ' + svcName + '</h3>'
      + '<ul style="color:#555;line-height:1.8;margin:0;padding-left:18px;font-size:14px;">';
    for (var p = 0; p < svc.preparation.length; p++) {
      prepHtml += '<li>' + svc.preparation[p] + '</li>';
    }
    prepHtml += '</ul></div>';
  }
  
  var html = '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:0;background:#f0f2f5;font-family:Georgia,\'Times New Roman\',serif;">'
    + '<div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.08);">'
    + getGgmEmailHeader({ title: svcIcon + ' ' + svcName + ' Rescheduled', gradient: '#1565C0', gradientEnd: '#42A5F5' })
    + '<div style="padding:30px;">'
    + '<h2 style="color:#333;margin:0 0 10px;">Hi ' + firstName + ',</h2>'
    + '<p style="color:#555;line-height:1.6;">Your <strong>' + svcName + '</strong> appointment has been successfully rescheduled. Here are the updated details:</p>'
    // Updated booking card
    + '<div style="background:#E3F2FD;border:1px solid #90CAF9;border-radius:8px;overflow:hidden;margin:20px 0;">'
    + '<div style="background:#1565C0;padding:10px 15px;"><h3 style="color:#fff;margin:0;font-size:15px;">' + svcIcon + ' Updated Booking</h3></div>'
    + '<table style="width:100%;border-collapse:collapse;">'
    + '<tr><td style="padding:8px 15px;color:#666;font-weight:600;width:130px;">Reference</td><td style="padding:8px 15px;font-weight:700;color:#1565C0;">' + (data.jobNumber || 'N/A') + '</td></tr>'
    + '<tr style="background:#E8F4FD;"><td style="padding:8px 15px;color:#666;font-weight:600;">Service</td><td style="padding:8px 15px;">' + svcIcon + ' ' + svcName + '</td></tr>'
    + '<tr><td style="padding:8px 15px;color:#666;font-weight:600;">New Date</td><td style="padding:8px 15px;font-weight:700;color:#1565C0;">' + (data.newDate || '') + '</td></tr>'
    + '<tr style="background:#E8F4FD;"><td style="padding:8px 15px;color:#666;font-weight:600;">New Time</td><td style="padding:8px 15px;font-weight:700;color:#1565C0;">' + (data.newTime || '') + '</td></tr>'
    + '<tr><td style="padding:8px 15px;color:#999;font-weight:600;">Previous</td><td style="padding:8px 15px;color:#999;text-decoration:line-through;">' + (data.oldDate || '') + (data.oldTime ? ' at ' + data.oldTime : '') + '</td></tr>'
    + '</table></div>'
    // Service-specific preparation tips
    + prepHtml
    + '<p style="color:#555;font-size:14px;">Please ensure access to your garden at the new time. If you need to make further changes, please get in touch.</p>'
    // Manage booking link
    + '<div style="text-align:center;margin:20px 0;">'
    + '<a href="https://gardnersgm.co.uk/cancel.html?email=' + encodeURIComponent(data.email || '') + '&job=' + encodeURIComponent(data.jobNumber || '') + '" style="display:inline-block;background:#1565C0;color:#fff;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px;">Manage Booking</a>'
    + '</div>'
    + '</div>'
    + getGgmEmailFooter(data.email)
    + '</div></body></html>';
  
  sendEmail({
    to: data.email, toName: '', subject: subject, htmlBody: html,
    name: 'Gardners Ground Maintenance', replyTo: 'info@gardnersgm.co.uk'
  });
}


// ============================================
// CUSTOMER SELF-SERVICE CANCEL PAGE (GET)
// ============================================

function renderCancelPage(params) {
  var email = (params.email || '').toLowerCase().trim();
  var jobNumber = params.job || '';
  var token = params.token || '';
  var confirmed = params.confirmed === 'yes';
  
  var ss = SpreadsheetApp.openById('1_Y7yHIpAvv_VNBhTrwNOQaBMAGa3UlVW_FKlf56ouHk');
  var sheet = ss.getSheetByName('Jobs');
  var data = sheet.getDataRange().getValues();
  
  // Find booking
  var row = null;
  var ri = 0;
  for (var i = 1; i < data.length; i++) {
    var rowEmail = String(data[i][3] || '').toLowerCase().trim();
    var rowJob = String(data[i][19] || '');
    if (rowEmail === email && rowJob === jobNumber) {
      ri = i + 1;
      row = data[i];
      break;
    }
  }
  
  if (!row) {
    return ContentService.createTextOutput(
      '<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>'
      + '<body style="font-family:Arial;text-align:center;padding:60px;background:#f4f7f4;">'
      + '<div style="max-width:400px;margin:0 auto;background:#fff;padding:40px;border-radius:12px;box-shadow:0 2px 10px rgba(0,0,0,0.1);">'
      + '<div style="font-size:48px;">🔍</div>'
      + '<h2 style="color:#333;">Booking Not Found</h2>'
      + '<p style="color:#666;">We couldn\'t find a booking matching those details. Please check the link in your confirmation email.</p>'
      + '<a href="https://gardnersgm.co.uk" style="display:inline-block;background:#2E7D32;color:#fff;padding:10px 24px;border-radius:6px;text-decoration:none;margin-top:15px;">Return Home</a>'
      + '</div></body></html>'
    ).setMimeType(ContentService.MimeType.HTML);
  }
  
  var status = String(row[11] || '').toLowerCase();
  if (status === 'cancelled') {
    return ContentService.createTextOutput(
      '<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>'
      + '<body style="font-family:Arial;text-align:center;padding:60px;background:#f4f7f4;">'
      + '<div style="max-width:400px;margin:0 auto;background:#fff;padding:40px;border-radius:12px;box-shadow:0 2px 10px rgba(0,0,0,0.1);">'
      + '<div style="font-size:48px;">✅</div>'
      + '<h2 style="color:#333;">Already Cancelled</h2>'
      + '<p style="color:#666;">This booking has already been cancelled.</p>'
      + '</div></body></html>'
    ).setMimeType(ContentService.MimeType.HTML);
  }
  
  var name = String(row[2] || '');
  var service = String(row[7] || '');
  var date = String(row[8] || '');
  var time = String(row[9] || '');
  var jn = String(row[19] || '');
  var type = String(row[1] || '').toLowerCase();
  var isSub = type.indexOf('subscription') >= 0;
  
  // If confirmed, process the cancellation
  if (confirmed) {
    if (isSub) {
      cancelSubscription({ rowIndex: ri, reason: 'Customer self-service cancellation' });
    } else {
      cancelBooking({ rowIndex: ri, reason: 'Customer self-service cancellation', refund: true });
    }
    return ContentService.createTextOutput(
      '<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>'
      + '<body style="font-family:Arial;text-align:center;padding:60px;background:#f4f7f4;">'
      + '<div style="max-width:400px;margin:0 auto;background:#fff;padding:40px;border-radius:12px;box-shadow:0 2px 10px rgba(0,0,0,0.1);">'
      + '<div style="font-size:48px;">✅</div>'
      + '<h2 style="color:#2E7D32;">Cancellation Confirmed</h2>'
      + '<p style="color:#555;">Your ' + (isSub ? 'subscription' : 'booking') + ' for <strong>' + service + '</strong> has been cancelled.</p>'
      + '<p style="color:#555;">You\'ll receive a confirmation email shortly' + (isSub ? '' : ' with refund details') + '.</p>'
      + '<a href="https://gardnersgm.co.uk" style="display:inline-block;background:#2E7D32;color:#fff;padding:10px 24px;border-radius:6px;text-decoration:none;margin-top:15px;">Return Home</a>'
      + '</div></body></html>'
    ).setMimeType(ContentService.MimeType.HTML);
  }
  
  // Show confirmation page
  var webhookUrl = DEPLOYMENT_URL;
  var confirmUrl = webhookUrl + '?action=cancel_page&email=' + encodeURIComponent(email) + '&job=' + encodeURIComponent(jn) + '&confirmed=yes';
  
  return ContentService.createTextOutput(
    '<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>'
    + '<body style="font-family:Arial;text-align:center;padding:40px;background:#f4f7f4;">'
    + '<div style="max-width:450px;margin:0 auto;background:#fff;padding:40px;border-radius:12px;box-shadow:0 2px 10px rgba(0,0,0,0.1);">'
    + '<div style="font-size:48px;">⚠️</div>'
    + '<h2 style="color:#d32f2f;">Cancel ' + (isSub ? 'Subscription' : 'Booking') + '?</h2>'
    + '<p style="color:#555;margin-bottom:20px;">You\'re about to cancel:</p>'
    + '<div style="background:#FFF3E0;border-radius:8px;padding:15px;text-align:left;margin-bottom:20px;">'
    + '<p style="margin:4px 0;color:#333;"><strong>📋 ' + service + '</strong></p>'
    + (date ? '<p style="margin:4px 0;color:#555;">📅 ' + date + (time ? ' at ' + time : '') + '</p>' : '')
    + '<p style="margin:4px 0;color:#555;">🔖 ' + jn + '</p>'
    + '</div>'
    + (isSub ? '<p style="color:#d32f2f;font-size:13px;">⚠️ This will cancel your subscription and all future visits.</p>' : '<p style="color:#555;font-size:13px;">If you paid online, a refund will be processed automatically.</p>')
    + '<div style="margin-top:20px;">'
    + '<a href="' + confirmUrl + '" style="display:inline-block;background:#d32f2f;color:#fff;padding:12px 30px;border-radius:6px;text-decoration:none;font-weight:600;margin:5px;">Yes, Cancel</a>'
    + '<a href="https://gardnersgm.co.uk" style="display:inline-block;background:#666;color:#fff;padding:12px 30px;border-radius:6px;text-decoration:none;font-weight:600;margin:5px;">Keep My Booking</a>'
    + '</div></div></body></html>'
  ).setMimeType(ContentService.MimeType.HTML);
}


// ============================================
// CRM — GET ALL CLIENTS
// ============================================

function getClients() {
  var sheet = SpreadsheetApp.openById('1_Y7yHIpAvv_VNBhTrwNOQaBMAGa3UlVW_FKlf56ouHk').getSheetByName('Jobs');
  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  
  var clients = [];
  for (var i = 1; i < data.length; i++) {
    var row = {};
    row.rowIndex = i + 1; // 1-based sheet row number
    row.timestamp = data[i][0] || '';
    row.type = data[i][1] || '';
    row.name = data[i][2] || '';
    row.email = data[i][3] || '';
    row.phone = data[i][4] || '';
    row.address = data[i][5] || '';
    row.postcode = data[i][6] || '';
    row.service = data[i][7] || '';
    row.date = data[i][8] || '';
    row.time = data[i][9] || '';
    row.preferredDay = data[i][10] || '';
    row.status = data[i][11] || '';
    row.price = data[i][12] || '';
    row.distance = data[i][13] || '';
    row.driveTime = data[i][14] || '';
    row.googleMapsUrl = data[i][15] || '';
    row.notes = data[i][16] || '';
    row.paid = data[i][17] || '';
    row.paymentType = data[i][18] || '';
    row.jobNumber = data[i][19] || '';
    clients.push(row);
  }
  
  return ContentService
    .createTextOutput(JSON.stringify({ status: 'success', clients: clients }))
    .setMimeType(ContentService.MimeType.JSON);
}


// ============================================
// CRM — GET BOOKINGS FOR A DATE 
// ============================================

// ── Get busy/full dates for the booking calendar (next 60 days) ──
function getBusyDates() {
  var ss = SpreadsheetApp.openById('1_Y7yHIpAvv_VNBhTrwNOQaBMAGa3UlVW_FKlf56ouHk');
  var sheet = ss.getSheetByName('Jobs');
  var data = sheet.getDataRange().getValues();
  
  // Count bookings per date (only active ones)
  var dateCounts = {}; // ISO date → { total, hasFullDay }
  var fullDayServices = ['garden-clearance','power-washing','scarifying','emergency-tree','veg-patch'];
  
  for (var i = 1; i < data.length; i++) {
    var rowDate = normaliseDateToISO(data[i][8]);
    var rowStatus = String(data[i][11] || '').toLowerCase();
    if (!rowDate || rowStatus === 'cancelled' || rowStatus === 'canceled' || rowStatus === 'completed') continue;
    
    if (!dateCounts[rowDate]) dateCounts[rowDate] = { total: 0, hasFullDay: false };
    dateCounts[rowDate].total++;
    
    var svcKey = String(data[i][7] || '').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    if (fullDayServices.indexOf(svcKey) !== -1) {
      dateCounts[rowDate].hasFullDay = true;
    }
  }
  
  // Also check Schedule sheet for subscription visits
  var fullDaySubscriptionServices = ['garden-clearance','power-washing','scarifying','emergency-tree','veg-patch'];
  try {
    var schedSheet = ss.getSheetByName('Schedule');
    if (schedSheet && schedSheet.getLastRow() > 1) {
      var schedData = schedSheet.getDataRange().getValues();
      for (var j = 1; j < schedData.length; j++) {
        var schedDate = normaliseDateToISO(schedData[j][0]);
        var schedStatus = String(schedData[j][9] || '').toLowerCase();
        if (!schedDate || schedStatus === 'cancelled' || schedStatus === 'completed' || schedStatus === 'skipped') continue;
        
        if (!dateCounts[schedDate]) dateCounts[schedDate] = { total: 0, hasFullDay: false };
        dateCounts[schedDate].total++;
        
        // Check if this subscription service is a full-day service
        var schedSvcKey = String(schedData[j][6] || '').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
        if (fullDaySubscriptionServices.indexOf(schedSvcKey) !== -1) {
          dateCounts[schedDate].hasFullDay = true;
        }
      }
    }
  } catch(e) {}
  
  // Build lists: fully booked dates + partially busy dates
  var fullyBooked = []; // 3+ jobs or has full-day service
  var busyDates = [];   // 1-2 jobs (some slots taken)
  
  for (var d in dateCounts) {
    if (dateCounts[d].hasFullDay || dateCounts[d].total >= 3) {
      fullyBooked.push(d);
    } else if (dateCounts[d].total > 0) {
      busyDates.push(d);
    }
  }
  
  return ContentService
    .createTextOutput(JSON.stringify({
      status: 'success',
      fullyBooked: fullyBooked,
      busyDates: busyDates
    }))
    .setMimeType(ContentService.MimeType.JSON);
}

function getBookingsForDate(date) {
  var sheet = SpreadsheetApp.openById('1_Y7yHIpAvv_VNBhTrwNOQaBMAGa3UlVW_FKlf56ouHk').getSheetByName('Jobs');
  var data = sheet.getDataRange().getValues();
  var targetDate = normaliseDateToISO(date);
  
  var bookings = [];
  for (var i = 1; i < data.length; i++) {
    var rowDate = normaliseDateToISO(data[i][8]);
    var rowStatus = String(data[i][11] || '').toLowerCase();
    if (rowStatus === 'cancelled' || rowStatus === 'canceled') continue;
    if (rowDate === targetDate) {
      bookings.push({
        rowIndex: i + 1,
        time: data[i][9] || '',
        name: data[i][2] || '',
        service: data[i][7] || '',
        status: data[i][11] || ''
      });
    }
  }
  
  return ContentService
    .createTextOutput(JSON.stringify({ status: 'success', bookings: bookings }))
    .setMimeType(ContentService.MimeType.JSON);
}


// ============================================
// BOOKING — Request to Book (no payment gateway)
// Payment will be collected via Stripe or invoice after completion.
// ============================================

function handleBookingPayment(data) {
  // Full payment via Stripe — charge the customer immediately
  var jobNum = generateJobNumber();
  var price = data.amount ? (data.amount / 100).toFixed(2) : (data.price || '0.00');
  var customerName = (data.customer && data.customer.name) || '';
  var customerEmail = (data.customer && data.customer.email) || '';
  var customerPhone = (data.customer && data.customer.phone) || '';
  var customerAddress = (data.customer && data.customer.address) || '';
  var customerPostcode = (data.customer && data.customer.postcode) || '';
  
  // 1) Process Stripe payment
  var paymentStatus = 'succeeded';
  var paymentIntentId = '';
  var clientSecret = '';
  var paidFlag = 'Yes';
  var paymentType = 'Stripe One-Off';
  
  try {
    // Find or create Stripe customer
    var stripeCustomer = findOrCreateCustomer(customerEmail, customerName, customerPhone, customerAddress, customerPostcode);
    var customerId = stripeCustomer.id;
    
    // Attach payment method to customer
    stripeRequest('/v1/payment_methods/' + data.paymentMethodId + '/attach', 'post', {
      'customer': customerId
    });
    
    // Set as default payment method
    stripeRequest('/v1/customers/' + customerId, 'post', {
      'invoice_settings[default_payment_method]': data.paymentMethodId
    });
    
    // Create and confirm PaymentIntent
    var paymentIntent = stripeRequest('/v1/payment_intents', 'post', {
      'amount': String(data.amount),
      'currency': 'gbp',
      'customer': customerId,
      'payment_method': data.paymentMethodId,
      'confirm': 'true',
      'off_session': 'true',
      'description': (data.serviceName || 'Service') + ' — ' + customerName,
      'receipt_email': customerEmail,
      'metadata[service]': data.serviceName || '',
      'metadata[date]': data.date || '',
      'metadata[time]': data.time || '',
      'metadata[address]': customerAddress + ', ' + customerPostcode,
      'metadata[phone]': customerPhone,
      'metadata[jobNumber]': jobNum
    });
    
    paymentIntentId = paymentIntent.id;
    paymentStatus = paymentIntent.status;
    
    // Handle 3D Secure requirement
    if (paymentStatus === 'requires_action' || paymentStatus === 'requires_confirmation') {
      clientSecret = paymentIntent.client_secret;
      paidFlag = 'Pending 3DS';
    } else if (paymentStatus !== 'succeeded') {
      paidFlag = 'Payment ' + paymentStatus;
    }
  } catch(stripeErr) {
    Logger.log('Stripe payment error: ' + stripeErr);
    try { notifyBot('moneybot', '❌ *PAYMENT FAILED*\n\n👤 ' + customerName + '\n📧 ' + customerEmail + '\n📋 ' + (data.serviceName || '') + '\n💰 £' + price + '\n❌ ' + stripeErr); } catch(e) {}
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'error', message: 'Payment failed: ' + stripeErr.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  
  // 2) Log to spreadsheet
  try {
    var sheet = SpreadsheetApp.openById('1_Y7yHIpAvv_VNBhTrwNOQaBMAGa3UlVW_FKlf56ouHk').getSheetByName('Jobs');
    sheet.appendRow([
      new Date().toISOString(),
      'booking-payment',
      customerName,
      customerEmail,
      customerPhone,
      customerAddress,
      customerPostcode,
      data.serviceName || '',
      data.date || '',
      data.time || '',
      '',
      paymentStatus === 'succeeded' ? 'Confirmed' : 'Pending',
      price,
      data.distance || '',
      data.driveTime || '',
      data.googleMapsUrl || '',
      data.notes || '',
      paidFlag,
      paymentType,
      jobNum
    ]);
  } catch(logErr) { Logger.log('Booking log error: ' + logErr); }
  
  // 3) Return result IMMEDIATELY — don't block on email/calendar/telegram
  //    Those are deferred to a background trigger for speed
  var responseJson = {};
  if (clientSecret) {
    responseJson = { status: 'requires_action', clientSecret: clientSecret, jobNumber: jobNum };
  } else {
    responseJson = { status: 'success', jobNumber: jobNum, paymentStatus: paymentStatus, paymentIntentId: paymentIntentId };
  }
  
  // 4) Defer email/calendar/telegram to background trigger (runs ~5s later)
  try {
    var postTaskData = {
      name: customerName, email: customerEmail, service: data.serviceName || '',
      date: data.date || '', time: data.time || '', jobNumber: jobNum,
      price: price, address: customerAddress, postcode: customerPostcode,
      paymentIntentId: paymentIntentId, type: 'booking-payment', paymentType: 'pay-now'
    };
    PropertiesService.getScriptProperties().setProperty('BOOKING_POST_' + jobNum, JSON.stringify(postTaskData));
    ScriptApp.newTrigger('processBookingPostTasks')
      .timeBased()
      .after(3000)
      .create();
  } catch(deferErr) {
    // Fallback: send email synchronously if trigger fails
    Logger.log('Deferred trigger failed, sending synchronously: ' + deferErr);
    try {
      sendBookingConfirmation({
        name: customerName, email: customerEmail, service: data.serviceName || '',
        date: data.date || '', time: data.time || '', jobNumber: jobNum,
        price: price, address: customerAddress, postcode: customerPostcode,
        type: 'booking-payment', paymentType: 'pay-now'
      });
    } catch(emailErr) {
      try { notifyTelegram('⚠️ *EMAIL FAILED*\n\nBooking confirmation email failed for ' + customerName + ' (' + customerEmail + ')\nJob: ' + jobNum + '\nError: ' + emailErr); } catch(e) {}
    }
    try { notifyTelegram('📋 *NEW BOOKING — PAID*\n\n👤 ' + customerName + '\n📧 ' + customerEmail + '\n📋 ' + (data.serviceName || '') + '\n💰 £' + price + ' ✅ PAID\n📅 ' + (data.date || '') + ' ' + (data.time || '') + '\n🔖 ' + jobNum + '\n💳 Stripe ' + paymentIntentId); } catch(e) {}
  }
  
  return ContentService
    .createTextOutput(JSON.stringify(responseJson))
    .setMimeType(ContentService.MimeType.JSON);
}


// ============================================
// BOOKING DEPOSIT — 10% deposit via Stripe, remainder invoiced after completion
// ============================================

function handleBookingDeposit(data) {
  var jobNum = generateJobNumber();
  var totalPrice = data.totalAmount ? (data.totalAmount / 100).toFixed(2) : (data.price || '0.00');
  var depositPrice = data.amount ? (data.amount / 100).toFixed(2) : '0.00';
  var customerName = (data.customer && data.customer.name) || '';
  var customerEmail = (data.customer && data.customer.email) || '';
  var customerPhone = (data.customer && data.customer.phone) || '';
  var customerAddress = (data.customer && data.customer.address) || '';
  var customerPostcode = (data.customer && data.customer.postcode) || '';
  
  // 1) Process deposit payment via Stripe
  var paymentStatus = 'succeeded';
  var paymentIntentId = '';
  var clientSecret = '';
  var paidFlag = 'Deposit Paid';
  
  try {
    var stripeCustomer = findOrCreateCustomer(customerEmail, customerName, customerPhone, customerAddress, customerPostcode);
    var customerId = stripeCustomer.id;
    
    stripeRequest('/v1/payment_methods/' + data.paymentMethodId + '/attach', 'post', {
      'customer': customerId
    });
    
    stripeRequest('/v1/customers/' + customerId, 'post', {
      'invoice_settings[default_payment_method]': data.paymentMethodId
    });
    
    var paymentIntent = stripeRequest('/v1/payment_intents', 'post', {
      'amount': String(data.amount),
      'currency': 'gbp',
      'customer': customerId,
      'payment_method': data.paymentMethodId,
      'confirm': 'true',
      'off_session': 'true',
      'description': '10% Deposit — ' + (data.serviceName || 'Service') + ' — ' + customerName,
      'receipt_email': customerEmail,
      'metadata[service]': data.serviceName || '',
      'metadata[date]': data.date || '',
      'metadata[type]': 'deposit',
      'metadata[totalAmount]': totalPrice,
      'metadata[jobNumber]': jobNum
    });
    
    paymentIntentId = paymentIntent.id;
    paymentStatus = paymentIntent.status;
    
    if (paymentStatus === 'requires_action' || paymentStatus === 'requires_confirmation') {
      clientSecret = paymentIntent.client_secret;
      paidFlag = 'Pending 3DS';
    }
  } catch(stripeErr) {
    Logger.log('Deposit payment error: ' + stripeErr);
    try { notifyBot('moneybot', '❌ *DEPOSIT FAILED*\n\n👤 ' + customerName + '\n📧 ' + customerEmail + '\n📋 ' + (data.serviceName || '') + '\n💰 £' + depositPrice + ' deposit of £' + totalPrice + '\n❌ ' + stripeErr); } catch(e) {}
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'error', message: 'Deposit payment failed: ' + stripeErr.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  
  // 2) Log to spreadsheet
  try {
    var sheet = SpreadsheetApp.openById('1_Y7yHIpAvv_VNBhTrwNOQaBMAGa3UlVW_FKlf56ouHk').getSheetByName('Jobs');
    sheet.appendRow([
      new Date().toISOString(),
      'booking-deposit',
      customerName,
      customerEmail,
      customerPhone,
      customerAddress,
      customerPostcode,
      data.serviceName || '',
      data.date || '',
      data.time || '',
      '',
      paymentStatus === 'succeeded' ? 'Confirmed' : 'Pending',
      totalPrice,
      data.distance || '',
      data.driveTime || '',
      data.googleMapsUrl || '',
      data.notes || '',
      paidFlag,
      'Stripe Deposit (£' + depositPrice + ')',
      jobNum
    ]);
  } catch(logErr) { Logger.log('Booking log error: ' + logErr); }
  
  // 3) Return result IMMEDIATELY — defer email/calendar/telegram to background
  var responseJson = {};
  if (clientSecret) {
    responseJson = { status: 'requires_action', clientSecret: clientSecret, jobNumber: jobNum };
  } else {
    responseJson = { status: 'success', jobNumber: jobNum, paymentStatus: paymentStatus, paymentIntentId: paymentIntentId };
  }
  
  // 4) Defer email/calendar/telegram to background trigger
  try {
    var postTaskData = {
      name: customerName, email: customerEmail, service: data.serviceName || '',
      date: data.date || '', time: data.time || '', jobNumber: jobNum,
      price: totalPrice, depositPrice: depositPrice, address: customerAddress, postcode: customerPostcode,
      paymentIntentId: paymentIntentId, type: 'booking-deposit', paymentType: 'pay-later'
    };
    PropertiesService.getScriptProperties().setProperty('BOOKING_POST_' + jobNum, JSON.stringify(postTaskData));
    ScriptApp.newTrigger('processBookingPostTasks')
      .timeBased()
      .after(3000)
      .create();
  } catch(deferErr) {
    Logger.log('Deferred trigger failed, sending synchronously: ' + deferErr);
    try {
      sendBookingConfirmation({
        name: customerName, email: customerEmail, service: data.serviceName || '',
        date: data.date || '', time: data.time || '', jobNumber: jobNum,
        price: totalPrice, address: customerAddress, postcode: customerPostcode,
        type: 'booking', paymentType: 'pay-later'
      });
    } catch(emailErr) {
      try { notifyTelegram('⚠️ *EMAIL FAILED*\n\nDeposit confirmation email failed for ' + customerName + ' (' + customerEmail + ')\nJob: ' + jobNum + '\nError: ' + emailErr); } catch(e) {}
    }
    try { notifyTelegram('📋 *NEW BOOKING — DEPOSIT*\n\n👤 ' + customerName + '\n📧 ' + customerEmail + '\n📋 ' + (data.serviceName || '') + '\n💰 £' + depositPrice + ' deposit (of £' + totalPrice + ' total)\n📅 ' + (data.date || '') + ' ' + (data.time || '') + '\n🔖 ' + jobNum + '\n💳 Remainder invoiced after completion'); } catch(e) {}
  }
  
  return ContentService
    .createTextOutput(JSON.stringify(responseJson))
    .setMimeType(ContentService.MimeType.JSON);
}


// ============================================
// DEFERRED BOOKING POST-TASKS (Email, Calendar, Telegram)
// Runs ~3-5 seconds after handleBookingPayment/handleBookingDeposit returns.
// This keeps the booking page fast — Stripe + sheet log return immediately,
// then email/calendar/telegram fire in the background.
// ============================================

function processBookingPostTasks() {
  var props = PropertiesService.getScriptProperties();
  var allProps = props.getProperties();
  var processedKeys = [];
  
  for (var key in allProps) {
    if (key.indexOf('BOOKING_POST_') !== 0) continue;
    
    try {
      var task = JSON.parse(allProps[key]);
      var jobNum = task.jobNumber || '';
      
      // 1) Send booking confirmation email (Hub owns this if HUB_OWNS_EMAILS)
      try {
        if (!HUB_OWNS_EMAILS) {
        sendBookingConfirmation({
          name: task.name || '', email: task.email || '',
          service: task.service || '', date: task.date || '',
          time: task.time || '', jobNumber: jobNum,
          price: task.price || '', address: task.address || '',
          postcode: task.postcode || '',
          type: task.type || 'booking-payment',
          paymentType: task.paymentType || 'pay-now'
        });
        } // end HUB_OWNS_EMAILS guard
        trackEmail(task.email, task.name, 'Booking Confirmation', task.service || '', jobNum);
        logTermsAcceptance({
          name: task.name, email: task.email, jobNumber: jobNum,
          termsType: task.paymentType || 'pay-now',
          timestamp: new Date().toISOString(), service: task.service || ''
        });
      } catch(emailErr) {
        Logger.log('Post-task email error for ' + jobNum + ': ' + emailErr);
        try { notifyTelegram('⚠️ *EMAIL FAILED*\n\nBooking confirmation email failed for ' + (task.name || '') + ' (' + (task.email || '') + ')\nJob: ' + jobNum + '\nError: ' + emailErr); } catch(e) {}
      }
      
      // 2) Sync to Google Calendar
      try {
        syncBookingToCalendar({
          name: task.name || '', service: task.service || '',
          date: task.date || '', time: task.time || '',
          address: task.address || '', postcode: task.postcode || '',
          jobNumber: jobNum
        });
      } catch(calErr) { Logger.log('Post-task calendar error: ' + calErr); }
      
      // 3) Telegram notification
      try {
        var isDeposit = task.type === 'booking-deposit';
        if (isDeposit) {
          notifyTelegram('📋 *NEW BOOKING — DEPOSIT*\n\n👤 ' + (task.name || '') + '\n📧 ' + (task.email || '') + '\n📋 ' + (task.service || '') + '\n💰 £' + (task.depositPrice || '') + ' deposit (of £' + (task.price || '') + ' total)\n📅 ' + (task.date || '') + ' ' + (task.time || '') + '\n🔖 ' + jobNum + '\n💳 Remainder invoiced after completion');
        } else {
          notifyTelegram('📋 *NEW BOOKING — PAID*\n\n👤 ' + (task.name || '') + '\n📧 ' + (task.email || '') + '\n📋 ' + (task.service || '') + '\n💰 £' + (task.price || '') + ' ✅ PAID\n📅 ' + (task.date || '') + ' ' + (task.time || '') + '\n🔖 ' + jobNum + '\n💳 Stripe ' + (task.paymentIntentId || ''));
        }
      } catch(tgErr) { Logger.log('Post-task telegram error: ' + tgErr); }
      
      processedKeys.push(key);
    } catch(parseErr) {
      Logger.log('Post-task parse error for ' + key + ': ' + parseErr);
      processedKeys.push(key); // Remove bad data
    }
  }
  
  // Clean up processed tasks
  for (var i = 0; i < processedKeys.length; i++) {
    try { props.deleteProperty(processedKeys[i]); } catch(e) {}
  }
  
  // Clean up the trigger that called us
  try {
    var triggers = ScriptApp.getProjectTriggers();
    for (var t = 0; t < triggers.length; t++) {
      if (triggers[t].getHandlerFunction() === 'processBookingPostTasks') {
        ScriptApp.deleteTrigger(triggers[t]);
      }
    }
  } catch(e) { Logger.log('Trigger cleanup error: ' + e); }
}


// ============================================
// DEFERRED SUBSCRIPTION POST-TASKS (Email, Contract, Newsletter, Telegram)
// Runs ~3-5 seconds after handleStripeSubscription returns.
// ============================================

function processSubscriptionPostTasks() {
  var props = PropertiesService.getScriptProperties();
  var allProps = props.getProperties();
  var processedKeys = [];
  
  for (var key in allProps) {
    if (key.indexOf('SUB_POST_') !== 0) continue;
    
    try {
      var task = JSON.parse(allProps[key]);
      var jobNum = task.jobNumber || '';
      
      // 1) Send subscription confirmation email
      try {
        sendBookingConfirmation({
          name: task.name || '', email: task.email || '',
          service: task.service || '', date: task.date || '',
          time: '', jobNumber: jobNum, price: task.price || '',
          address: task.address || '', postcode: task.postcode || '',
          preferredDay: task.preferredDay || '',
          type: 'subscription', paymentType: 'subscription'
        });
        trackEmail(task.email, task.name, 'Subscription Confirmation', task.service || '', jobNum);
      } catch(emailErr) {
        Logger.log('Sub post-task confirmation email error for ' + jobNum + ': ' + emailErr);
        try { notifyTelegram('⚠️ *EMAIL FAILED*\n\nSubscription confirmation email failed for ' + (task.name || '') + ' (' + (task.email || '') + ')\nJob: ' + jobNum + '\nError: ' + emailErr); } catch(e) {}
      }
      
      // 2) Send subscriber contract email
      try {
        sendSubscriberContractEmail({
          name: task.name || '', email: task.email || '',
          package: task.packageName || task.service || '',
          price: task.price || '', startDate: task.date || '',
          preferredDay: task.preferredDay || '',
          address: task.address || '', postcode: task.postcode || '',
          jobNumber: jobNum, stripeSubscriptionId: task.stripeSubId || '',
          introVisit: task.introVisit || false,
          keepClippings: task.keepClippings || false
        });
        trackEmail(task.email, task.name, 'Subscriber Contract', task.service || '', jobNum);
        logTermsAcceptance({
          name: task.name, email: task.email, jobNumber: jobNum,
          termsType: 'subscription', timestamp: new Date().toISOString(), service: task.service || ''
        });
      } catch(contractErr) {
        Logger.log('Sub post-task contract email error for ' + jobNum + ': ' + contractErr);
      }
      
      // 3) Auto-subscribe to newsletter
      try {
        subscribeNewsletter({
          email: task.email || '', name: task.name || '',
          tier: task.packageKey || 'essential', source: 'subscription'
        });
      } catch(subErr) { Logger.log('Sub post-task newsletter error: ' + subErr); }
      
      // 4) Telegram notification
      try {
        var subAddr = ((task.address || '') + ', ' + (task.postcode || '')).replace(/^,\s*/, '');
        var subMapsLink = subAddr ? '\n🗺 [Get Directions](https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(subAddr) + ')' : '';
        var introLine = task.introVisit ? '\n🤝 *Intro Visit:* YES — free meet & greet before paid work' : '';
        var clippingsLine = task.keepClippings ? '\n♻️ *Clippings:* Keep for composting (−£5/visit discount)' : '';
        notifyBot('moneybot', '🚨🚨 *NEW SUBSCRIBER* 🚨🚨\n━━━━━━━━━━━━━━━━━━━━\n\n💰 *Recurring Revenue!*\n\n👤 ' + (task.name || 'Unknown') + '\n📦 ' + (task.packageName || task.service || '') + ' package\n📅 Starts: ' + (task.date || 'TBC') + '\n📆 Preferred day: ' + (task.preferredDay || 'Not set') + '\n📍 ' + (task.postcode || '') + subMapsLink + '\n💰 ' + (task.price || '') + introLine + clippingsLine + '\n🔖 Job: ' + jobNum + '\n💳 Stripe: ' + (task.stripeSubId || 'pending') + '\n\n⚡ _Add to schedule & confirm route_');
      } catch(tgErr) { Logger.log('Sub post-task telegram error: ' + tgErr); }
      
      processedKeys.push(key);
    } catch(parseErr) {
      Logger.log('Sub post-task parse error for ' + key + ': ' + parseErr);
      processedKeys.push(key);
    }
  }
  
  // Clean up processed tasks
  for (var i = 0; i < processedKeys.length; i++) {
    try { props.deleteProperty(processedKeys[i]); } catch(e) {}
  }
  
  // Clean up the trigger that called us
  try {
    var triggers = ScriptApp.getProjectTriggers();
    for (var t = 0; t < triggers.length; t++) {
      if (triggers[t].getHandlerFunction() === 'processSubscriptionPostTasks') {
        ScriptApp.deleteTrigger(triggers[t]);
      }
    }
  } catch(e) { Logger.log('Sub trigger cleanup error: ' + e); }
}


// ============================================
// DAILY JOB STATUS PROGRESSION (Trigger)
// Set up a daily trigger: processJobStatusProgression
// ============================================

function processJobStatusProgression() {
  var ss = SpreadsheetApp.openById('1_Y7yHIpAvv_VNBhTrwNOQaBMAGa3UlVW_FKlf56ouHk');
  var sheet = ss.getSheetByName('Jobs');
  if (!sheet) return;
  
  var data = sheet.getDataRange().getValues();
  var today = new Date();
  var todayISO = Utilities.formatDate(today, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var todayDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  var changes = 0;
  
  for (var i = 1; i < data.length; i++) {
    var status = String(data[i][11] || '').toLowerCase().trim();
    var paid = String(data[i][17] || '');
    var dateStr = String(data[i][8] || '');
    var jobNum = String(data[i][19] || '');
    var name = String(data[i][2] || '');
    var email = String(data[i][3] || '');
    var svc = String(data[i][7] || '');
    
    // Skip cancelled/completed jobs
    if (status === 'cancelled' || status === 'canceled' || status === 'completed' || status === 'job completed') continue;
    
    // Parse job date
    var jobDate = null;
    if (dateStr) {
      var d = normaliseDateToISO(dateStr);
      if (d) {
        var parts = d.split('-');
        jobDate = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
      }
    }
    if (!jobDate) continue;
    
    var rowIdx = i + 1;
    
    // RULE 1: Payment confirmed (Deposit or Yes) + status is Active/new/sent  \u2192 move to Confirmed
    if ((paid === 'Yes' || paid === 'Auto' || paid === 'Deposit') && 
        (status === 'active' || status === '' || status === 'sent' || status === 'new')) {
      sheet.getRange(rowIdx, 12).setValue('Confirmed');
      changes++;
      try { notifyTelegram('\u2705 *AUTO: Job Confirmed*\\n\ud83d\udc64 ' + name + '\\n\ud83d\udccb ' + svc + '\\n\ud83d\udd16 ' + jobNum); } catch(e) {}
    }
    
    // RULE 2: Job date is today + status is Confirmed \u2192 move to In Progress
    if (jobDate.getTime() === todayDate.getTime() && (status === 'confirmed' || status === 'succeeded')) {
      sheet.getRange(rowIdx, 12).setValue('In Progress');
      changes++;
      try { notifyTelegram('\ud83d\udd27 *AUTO: Job In Progress*\\n\ud83d\udc64 ' + name + '\\n\ud83d\udccb ' + svc + '\\n\ud83d\udcc5 TODAY\\n\ud83d\udd16 ' + jobNum); } catch(e) {}
    }
    
    // RULE 3: Job date has passed + status is In Progress → move to Completed + auto-invoice
    if (jobDate.getTime() < todayDate.getTime() && status === 'in progress') {
      sheet.getRange(rowIdx, 12).setValue('Completed');
      changes++;
      
      // Auto-invoice using shared function
      try {
        autoInvoiceOnCompletion(sheet, rowIdx);
      } catch(autoErr) {
        Logger.log('Auto-complete/invoice error for row ' + rowIdx + ': ' + autoErr);
      }
    }
  }
  
  if (changes > 0) {
    Logger.log('Daily job progression: ' + changes + ' job(s) updated');
  }
}


// ============================================
// SETUP DAILY TRIGGER — run once to install
// ============================================

function setupDailyJobProgressionTrigger() {
  // Remove any existing triggers for this function
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'processJobStatusProgression') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  // Create new daily trigger at 6am
  ScriptApp.newTrigger('processJobStatusProgression')
    .timeBased()
    .atHour(6)
    .everyDays(1)
    .create();
  Logger.log('Daily job progression trigger set for 6am');
}


// ============================================
// QUOTE BUILDER SYSTEM
// ============================================

var QUOTE_SHEET_ID = SPREADSHEET_ID; // consolidated

// Standard service prices (pence) — matches website
var STANDARD_SERVICE_PRICES = {
  'Lawn Cutting': 3400, 'Hedge Trimming': 5000, 'Scarifying': 9000,
  'Lawn Treatment': 3900, 'Garden Clearance': 11000, 'Power Washing': 5500,
  'Veg Patch Setup': 8000, 'Weeding Treatment': 4500, 'Fence Repair': 7500,
  'Emergency Tree Work': 20000, 'Drain Clearance': 5000, 'Gutter Cleaning': 5000,
  'Strimming': 4500, 'Leaf Clearance': 3900
};

function getOrCreateQuotesSheet() {
  var ss = SpreadsheetApp.openById(QUOTE_SHEET_ID);
  var sheet = ss.getSheetByName('Quotes');
  if (!sheet) {
    sheet = ss.insertSheet('Quotes');
    sheet.appendRow([
      'Quote ID', 'Created', 'Customer Name', 'Customer Email', 'Customer Phone',
      'Customer Address', 'Customer Postcode', 'Quote Title', 'Line Items JSON',
      'Subtotal', 'Discount %', 'Discount Amount', 'VAT Amount', 'Grand Total',
      'Deposit Required', 'Deposit Amount', 'Status', 'Token', 'Sent Date',
      'Response Date', 'Decline Reason', 'Notes', 'Valid Until', 'Job Number',
      'Deposit Paid', 'Deposit PI ID'
    ]);
    sheet.setFrozenRows(1);
    sheet.getRange('A1:Z1').setFontWeight('bold').setBackground('#1B5E20').setFontColor('#fff');
  }
  return sheet;
}

function generateQuoteId() {
  return 'QTE-' + new Date().getFullYear() + '-' + String(Math.floor(Math.random() * 9000) + 1000);
}

function generateQuoteToken() {
  var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  var token = '';
  for (var i = 0; i < 32; i++) token += chars.charAt(Math.floor(Math.random() * chars.length));
  return token;
}


// ── GET ALL QUOTES ──
function getQuotes() {
  var sheet = getOrCreateQuotesSheet();
  var data = sheet.getDataRange().getValues();
  var quotes = [];
  for (var i = 1; i < data.length; i++) {
    quotes.push({
      quoteId: data[i][0], created: data[i][1], name: data[i][2], email: data[i][3],
      phone: data[i][4], address: data[i][5], postcode: data[i][6], title: data[i][7],
      lineItems: data[i][8], subtotal: data[i][9], discountPct: data[i][10],
      discountAmt: data[i][11], vatAmt: data[i][12], grandTotal: data[i][13],
      depositRequired: data[i][14], depositAmount: data[i][15], status: data[i][16],
      token: data[i][17], sentDate: data[i][18], responseDate: data[i][19],
      declineReason: data[i][20], notes: data[i][21], validUntil: data[i][22],
      jobNumber: data[i][23], depositPaid: data[i][24], depositPiId: data[i][25],
      rowIndex: i + 1
    });
  }
  return ContentService.createTextOutput(JSON.stringify({ status: 'success', quotes: quotes }))
    .setMimeType(ContentService.MimeType.JSON);
}


// ── GET SINGLE QUOTE BY TOKEN (customer-facing) ──
function getQuoteByToken(token) {
  if (!token) return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: 'No token' })).setMimeType(ContentService.MimeType.JSON);
  var sheet = getOrCreateQuotesSheet();
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][17]) === token) {
      var q = {
        quoteId: data[i][0], name: data[i][2], email: data[i][3],
        title: data[i][7], lineItems: data[i][8], subtotal: data[i][9],
        discountPct: data[i][10], discountAmt: data[i][11], vatAmt: data[i][12],
        grandTotal: data[i][13], depositRequired: data[i][14], depositAmount: data[i][15],
        status: data[i][16], validUntil: data[i][22], notes: data[i][21],
        address: data[i][5], postcode: data[i][6], phone: data[i][4]
      };
      return ContentService.createTextOutput(JSON.stringify({ status: 'success', quote: q }))
        .setMimeType(ContentService.MimeType.JSON);
    }
  }
  return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: 'Quote not found' }))
    .setMimeType(ContentService.MimeType.JSON);
}


// ── CREATE QUOTE + OPTIONALLY SEND ──
function handleCreateQuote(data) {
  var sheet = getOrCreateQuotesSheet();
  var quoteId = generateQuoteId();
  var token = generateQuoteToken();
  var now = new Date().toISOString();
  
  var lineItems = typeof data.lineItems === 'string' ? data.lineItems : JSON.stringify(data.lineItems || []);
  var subtotal = parseFloat(data.subtotal) || 0;
  var discountPct = parseFloat(data.discountPct) || 0;
  var discountAmt = parseFloat(data.discountAmt) || 0;
  var vatAmt = parseFloat(data.vatAmt) || 0;
  var grandTotal = parseFloat(data.grandTotal) || 0;
  var depositRequired = data.depositRequired === true || data.depositRequired === 'true';
  var depositAmount = depositRequired ? (grandTotal * 0.10).toFixed(2) : '0.00';
  
  // Valid for configurable days (default 30)
  var validDays = parseInt(data.validDays) || 30;
  var validUntil = new Date();
  validUntil.setDate(validUntil.getDate() + validDays);
  var validUntilStr = Utilities.formatDate(validUntil, Session.getScriptTimeZone(), 'dd MMMM yyyy');
  
  sheet.appendRow([
    quoteId, now, data.name || '', data.email || '', data.phone || '',
    data.address || '', data.postcode || '', data.title || 'Custom Quote',
    lineItems, subtotal.toFixed(2), discountPct, discountAmt.toFixed(2),
    vatAmt.toFixed(2), grandTotal.toFixed(2), depositRequired ? 'Yes' : 'No',
    depositAmount, data.sendNow ? 'Sent' : 'Draft', token,
    data.sendNow ? now : '', '', '', data.notes || '', validUntilStr, '', '', ''
  ]);
  
  // Send email if requested
  if (data.sendNow && data.email) {
    sendQuoteEmail({
      quoteId: quoteId, token: token, name: data.name, email: data.email,
      title: data.title || 'Custom Quote', lineItems: data.lineItems || [],
      subtotal: subtotal, discountPct: discountPct, discountAmt: discountAmt,
      vatAmt: vatAmt, grandTotal: grandTotal, depositRequired: depositRequired,
      depositAmount: parseFloat(depositAmount), validUntil: validUntilStr,
      notes: data.notes || '', address: data.address || '', postcode: data.postcode || ''
    });
    trackEmail(data.email, data.name, 'quote-sent', data.title || 'Custom Quote', quoteId);
    try { notifyBot('moneybot', '\ud83d\udcdd *QUOTE SENT*\n\n\ud83d\udd16 ' + quoteId + '\n\ud83d\udc64 ' + (data.name || '') + '\n\ud83d\udce7 ' + (data.email || '') + '\n\ud83d\udcb0 \u00a3' + grandTotal.toFixed(2) + '\n\ud83d\udcc5 Valid until ' + validUntilStr); } catch(e) {}
  }
  
  // Dual-write to Supabase
  try {
    supabaseUpsert('quotes', {
      quote_number: quoteId, client_name: data.name || '', client_email: data.email || '',
      client_phone: data.phone || '', postcode: data.postcode || '', address: data.address || '',
      service: data.title || 'Custom Quote',
      items: data.lineItems || [], subtotal: subtotal, discount: discountAmt,
      vat: vatAmt, total: grandTotal, deposit_required: parseFloat(depositAmount),
      status: data.sendNow ? 'Sent' : 'Draft', date_created: now,
      valid_until: validUntilStr, token: token, notes: data.notes || ''
    }, 'quote_number');
  } catch(se) { Logger.log('Supabase create quote error: ' + se); }

  return ContentService.createTextOutput(JSON.stringify({
    status: 'success', quoteId: quoteId, token: token
  })).setMimeType(ContentService.MimeType.JSON);
}


// ── UPDATE EXISTING QUOTE ──
function handleUpdateQuote(data) {
  var sheet = getOrCreateQuotesSheet();
  var allData = sheet.getDataRange().getValues();
  for (var i = 1; i < allData.length; i++) {
    if (String(allData[i][0]) === data.quoteId) {
      var row = i + 1;
      // Customer details
      if (data.name) sheet.getRange(row, 3).setValue(data.name);
      if (data.email) sheet.getRange(row, 4).setValue(data.email);
      if (data.phone !== undefined) sheet.getRange(row, 5).setValue(data.phone);
      if (data.address !== undefined) sheet.getRange(row, 6).setValue(data.address);
      if (data.postcode !== undefined) sheet.getRange(row, 7).setValue(data.postcode);
      // Quote details
      if (data.title) sheet.getRange(row, 8).setValue(data.title);
      if (data.lineItems) sheet.getRange(row, 9).setValue(typeof data.lineItems === 'string' ? data.lineItems : JSON.stringify(data.lineItems));
      if (data.subtotal !== undefined) sheet.getRange(row, 10).setValue(parseFloat(data.subtotal).toFixed(2));
      if (data.discountPct !== undefined) sheet.getRange(row, 11).setValue(data.discountPct);
      if (data.discountAmt !== undefined) sheet.getRange(row, 12).setValue(parseFloat(data.discountAmt).toFixed(2));
      if (data.vatAmt !== undefined) sheet.getRange(row, 13).setValue(parseFloat(data.vatAmt).toFixed(2));
      if (data.grandTotal !== undefined) {
        var gt = parseFloat(data.grandTotal);
        sheet.getRange(row, 14).setValue(gt.toFixed(2));
        // Recalc deposit
        var depReq = data.depositRequired !== undefined ? (data.depositRequired === true || data.depositRequired === 'true') : (allData[i][14] === 'Yes');
        sheet.getRange(row, 15).setValue(depReq ? 'Yes' : 'No');
        sheet.getRange(row, 16).setValue(depReq ? (gt * 0.10).toFixed(2) : '0.00');
      }
      if (data.notes !== undefined) sheet.getRange(row, 22).setValue(data.notes);
      if (data.validDays) {
        var vu = new Date(); vu.setDate(vu.getDate() + parseInt(data.validDays));
        sheet.getRange(row, 23).setValue(Utilities.formatDate(vu, Session.getScriptTimeZone(), 'dd MMMM yyyy'));
      }
      if (data.status) sheet.getRange(row, 17).setValue(data.status);
      
      // If sendNow, send and update status
      if (data.sendNow && (data.email || allData[i][3])) {
        var email = data.email || allData[i][3];
        var gt2 = parseFloat(data.grandTotal || allData[i][13]) || 0;
        var depReq2 = data.depositRequired !== undefined ? (data.depositRequired === true) : (allData[i][14] === 'Yes');
        sendQuoteEmail({
          quoteId: allData[i][0], token: allData[i][17], name: data.name || allData[i][2], email: email,
          title: data.title || allData[i][7], lineItems: data.lineItems || JSON.parse(allData[i][8] || '[]'),
          subtotal: parseFloat(data.subtotal || allData[i][9]) || 0,
          discountPct: parseFloat(data.discountPct !== undefined ? data.discountPct : allData[i][10]) || 0,
          discountAmt: parseFloat(data.discountAmt !== undefined ? data.discountAmt : allData[i][11]) || 0,
          vatAmt: parseFloat(data.vatAmt !== undefined ? data.vatAmt : allData[i][12]) || 0,
          grandTotal: gt2, depositRequired: depReq2, depositAmount: depReq2 ? gt2 * 0.10 : 0,
          validUntil: sheet.getRange(row, 23).getValue() || allData[i][22],
          notes: data.notes !== undefined ? data.notes : allData[i][21],
          address: data.address || allData[i][5], postcode: data.postcode || allData[i][6]
        });
        sheet.getRange(row, 17).setValue('Sent');
        sheet.getRange(row, 19).setValue(new Date().toISOString());
        trackEmail(email, data.name || allData[i][2], 'quote-sent', data.title || allData[i][7], allData[i][0]);
        try { notifyBot('moneybot', '\ud83d\udcdd *QUOTE SENT*\n\ud83d\udd16 ' + allData[i][0] + '\n\ud83d\udc64 ' + (data.name || allData[i][2]) + '\n\ud83d\udcb0 \u00a3' + gt2.toFixed(2)); } catch(e) {}
      }
      
      // Dual-write updated quote to Supabase
      try {
        var supaData = { quote_number: String(allData[i][0]) };
        if (data.name) supaData.client_name = data.name;
        if (data.email) supaData.client_email = data.email;
        if (data.phone !== undefined) supaData.client_phone = data.phone;
        if (data.address !== undefined) supaData.address = data.address;
        if (data.postcode !== undefined) supaData.postcode = data.postcode;
        if (data.title) supaData.service = data.title;
        if (data.lineItems) supaData.items = typeof data.lineItems === 'string' ? JSON.parse(data.lineItems) : data.lineItems;
        if (data.subtotal !== undefined) supaData.subtotal = parseFloat(data.subtotal) || 0;
        if (data.discountAmt !== undefined) supaData.discount = parseFloat(data.discountAmt) || 0;
        if (data.vatAmt !== undefined) supaData.vat = parseFloat(data.vatAmt) || 0;
        if (data.grandTotal !== undefined) supaData.total = parseFloat(data.grandTotal) || 0;
        if (data.status) supaData.status = data.status;
        if (data.notes !== undefined) supaData.notes = data.notes;
        supabaseUpsert('quotes', supaData, 'quote_number');
      } catch(se) { Logger.log('Supabase update quote error: ' + se); }

      return ContentService.createTextOutput(JSON.stringify({ status: 'success' })).setMimeType(ContentService.MimeType.JSON);
    }
  }
  return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: 'Quote not found' })).setMimeType(ContentService.MimeType.JSON);
}


// ── RESEND QUOTE EMAIL ──
function handleResendQuote(data) {
  var sheet = getOrCreateQuotesSheet();
  var allData = sheet.getDataRange().getValues();
  for (var i = 1; i < allData.length; i++) {
    if (String(allData[i][0]) === data.quoteId) {
      var row = i + 1;
      var items = [];
      try { items = JSON.parse(allData[i][8]); } catch(e) {}
      
      sendQuoteEmail({
        quoteId: allData[i][0], token: allData[i][17], name: allData[i][2], email: allData[i][3],
        title: allData[i][7], lineItems: items, subtotal: parseFloat(allData[i][9]) || 0,
        discountPct: parseFloat(allData[i][10]) || 0, discountAmt: parseFloat(allData[i][11]) || 0,
        vatAmt: parseFloat(allData[i][12]) || 0, grandTotal: parseFloat(allData[i][13]) || 0,
        depositRequired: allData[i][14] === 'Yes', depositAmount: parseFloat(allData[i][15]) || 0,
        validUntil: allData[i][22], notes: allData[i][21], address: allData[i][5], postcode: allData[i][6]
      });
      
      sheet.getRange(row, 17).setValue('Sent');
      sheet.getRange(row, 19).setValue(new Date().toISOString());
      trackEmail(allData[i][3], allData[i][2], 'quote-resent', allData[i][7], allData[i][0]);
      
      return ContentService.createTextOutput(JSON.stringify({ status: 'success' })).setMimeType(ContentService.MimeType.JSON);
    }
  }
  return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: 'Quote not found' })).setMimeType(ContentService.MimeType.JSON);
}


// ── CUSTOMER ACCEPTS OR DECLINES QUOTE ──
function handleQuoteResponse(data) {
  var sheet = getOrCreateQuotesSheet();
  var allData = sheet.getDataRange().getValues();
  for (var i = 1; i < allData.length; i++) {
    if (String(allData[i][17]) === data.token) {
      var row = i + 1;
      var currentStatus = String(allData[i][16]);
      
      // Prevent double-response
      if (currentStatus === 'Declined' || currentStatus === 'Expired') {
        return ContentService.createTextOutput(JSON.stringify({
          status: 'already_responded', quoteStatus: currentStatus
        })).setMimeType(ContentService.MimeType.JSON);
      }
      // Awaiting Deposit — return deposit info so customer can still pay
      if (currentStatus === 'Awaiting Deposit') {
        var awJobNum = String(allData[i][23] || '');
        var awDepositAmt = String(allData[i][15]);
        var awGrandTotal = String(allData[i][13]);
        return ContentService.createTextOutput(JSON.stringify({
          status: 'success', quoteStatus: 'Awaiting Deposit', jobNumber: awJobNum,
          depositRequired: true, depositAmount: awDepositAmt, grandTotal: awGrandTotal
        })).setMimeType(ContentService.MimeType.JSON);
      }
      // Already accepted (no deposit) or deposit already paid
      if (currentStatus === 'Accepted' || currentStatus === 'Deposit Paid') {
        return ContentService.createTextOutput(JSON.stringify({
          status: 'already_responded', quoteStatus: currentStatus
        })).setMimeType(ContentService.MimeType.JSON);
      }
      
      // Check expiry
      var validUntilStr = String(allData[i][22]);
      if (validUntilStr) {
        var expiry = new Date(validUntilStr);
        if (!isNaN(expiry) && new Date() > expiry) {
          sheet.getRange(row, 17).setValue('Expired');
          return ContentService.createTextOutput(JSON.stringify({
            status: 'expired', message: 'This quote has expired. Please contact us for an updated quote.'
          })).setMimeType(ContentService.MimeType.JSON);
        }
      }
      
      var response = data.response; // 'accept' or 'decline'
      var now = new Date().toISOString();
      
      if (response === 'decline') {
        sheet.getRange(row, 17).setValue('Declined');
        sheet.getRange(row, 20).setValue(now);
        sheet.getRange(row, 21).setValue(data.reason || '');
        
        try {
          notifyBot('moneybot', '\u274c *QUOTE DECLINED*\n\n\ud83d\udd16 ' + allData[i][0] + '\n\ud83d\udc64 ' + allData[i][2] + '\n\ud83d\udcb0 \u00a3' + allData[i][13] + '\n\ud83d\udcdd Reason: ' + (data.reason || 'No reason given'));
        } catch(e) {}
        
        // Send Chris a notification email
        try {
          sendEmail({
            to: 'info@gardnersgm.co.uk',
            toName: '',
            subject: 'Quote ' + allData[i][0] + ' Declined — ' + allData[i][2],
            htmlBody: '<p><strong>' + allData[i][2] + '</strong> has declined quote ' + allData[i][0] + ' (\u00a3' + allData[i][13] + ').</p>' +
              '<p><strong>Reason:</strong> ' + (data.reason || 'No reason given') + '</p>',
            name: 'Gardners Ground Maintenance',
            replyTo: 'info@gardnersgm.co.uk'
          });
        } catch(e) {}
        
        return ContentService.createTextOutput(JSON.stringify({ status: 'success', quoteStatus: 'Declined' })).setMimeType(ContentService.MimeType.JSON);
      }
      
      if (response === 'accept') {
        var depositReq = allData[i][14] === 'Yes';
        sheet.getRange(row, 17).setValue(depositReq ? 'Awaiting Deposit' : 'Accepted');
        sheet.getRange(row, 20).setValue(now);
        
        // Create job from accepted quote
        var jobNum = generateJobNumber();
        sheet.getRange(row, 24).setValue(jobNum);
        
        // Add to Jobs sheet
        var jobSheet = SpreadsheetApp.openById(QUOTE_SHEET_ID).getSheetByName('Jobs');
        var grandTotal = String(allData[i][13]);
        var depositAmt = String(allData[i][15]);
        
        jobSheet.appendRow([
          now, 'quote-accepted', allData[i][2], allData[i][3], allData[i][4],
          allData[i][5], allData[i][6], allData[i][7], '', '', '',
          depositReq ? 'Awaiting Deposit' : 'Confirmed',
          grandTotal, '', '', '',
          'Quote ' + allData[i][0] + ' accepted.' + (depositReq ? ' Deposit \u00a3' + depositAmt + ' required.' : ''),
          depositReq ? 'No' : 'No', 'Quote', jobNum
        ]);
        
        // ── AUTO-SCHEDULE: Add to Schedule sheet with customer's requested date ──
        try {
          var schedSheet = SpreadsheetApp.openById(QUOTE_SHEET_ID).getSheetByName('Schedule');
          if (!schedSheet) schedSheet = getOrCreateScheduleSheet();
          var schedStatus = depositReq ? 'Awaiting Deposit' : 'Pending';
          var schedNotes = 'Auto-scheduled from accepted quote ' + allData[i][0] + '.' +
            (depositReq ? ' Deposit £' + depositAmt + ' required before scheduling.' : '') +
            ' Total: £' + grandTotal;

          // Parse preferred date/time from quote notes (stored as PREFERRED_DATE:... PREFERRED_TIME:...)
          var quoteNotes = String(allData[i][21] || '');
          var prefDate = '';
          var prefTime = '';
          var pdMatch = quoteNotes.match(/PREFERRED_DATE:([^.]*)/);
          if (pdMatch) prefDate = pdMatch[1].trim();
          var ptMatch = quoteNotes.match(/PREFERRED_TIME:([^.]*)/);
          if (ptMatch) prefTime = ptMatch[1].trim();

          // Use the customer's requested date if available
          var visitDate = prefDate || '';
          if (visitDate) {
            schedNotes = 'Booked for customer\'s requested date (' + visitDate + ' ' + prefTime + '). ' + schedNotes;
            if (!depositReq) schedStatus = 'Confirmed';
          }

          // Schedule columns: Visit Date, Client Name, Email, Phone, Address, Postcode,
          //   Service, Package, Preferred Day, Status, Parent Job, Distance, Drive Time,
          //   Google Maps, Notes, Created By
          schedSheet.appendRow([
            visitDate, allData[i][2], allData[i][3], allData[i][4],
            allData[i][5], allData[i][6], allData[i][7], '',
            prefTime, schedStatus, jobNum,
            '', '', '', schedNotes, 'Quote System'
          ]);

          // Create Google Calendar event if no deposit needed (immediate confirmation)
          if (!depositReq && visitDate) {
            try {
              createCalendarEvent(allData[i][2], allData[i][7], visitDate, prefTime, allData[i][5] || '', allData[i][6] || '', jobNum);
              Logger.log('Google Calendar event created for non-deposit job ' + jobNum + ' on ' + visitDate);
            } catch(calErr) { Logger.log('Calendar event on quote accept: ' + calErr); }
          }
        } catch(schedErr) {
          Logger.log('Auto-schedule failed for quote ' + allData[i][0] + ': ' + schedErr);
        }
        
        // ── ADMIN NOTIFICATION: Email Chris about accepted quote ──
        try {
          sendEmail({
            to: 'cgardner37@icloud.com',
            toName: 'Chris',
            subject: '✅ Quote Accepted — ' + allData[i][2] + ' — £' + grandTotal,
            htmlBody: '<h2>Quote Accepted!</h2>' +
              '<p><strong>Quote:</strong> ' + allData[i][0] + '</p>' +
              '<p><strong>Client:</strong> ' + allData[i][2] + '</p>' +
              '<p><strong>Email:</strong> ' + allData[i][3] + '</p>' +
              '<p><strong>Service:</strong> ' + allData[i][7] + '</p>' +
              '<p><strong>Total:</strong> £' + grandTotal + '</p>' +
              (depositReq ? '<p><strong>Deposit Required:</strong> £' + depositAmt + '</p>' : '') +
              '<p><strong>Job Number:</strong> ' + jobNum + '</p>' +
              (visitDate ? '<p><strong>📅 Scheduled:</strong> ' + visitDate + ' ' + prefTime + '</p>' : '') +
              '<p>This job has been auto-added to the Schedule (status: ' + schedStatus + ').' + (visitDate ? ' Customer\'s requested date has been set.' : ' No date was specified — you\'ll need to set one.') + '</p>',
            name: 'GGM Hub',
            replyTo: allData[i][3]
          });
        } catch(emailErr) {
          Logger.log('Admin accept notification failed: ' + emailErr);
        }
        
        // ── CUSTOMER CONFIRMATION EMAIL: Send booking confirmation to client ──
        try {
          var clientName = allData[i][2];
          var clientEmail = allData[i][3];
          var firstName = (clientName || '').split(' ')[0] || 'there';
          var serviceName = allData[i][7] || 'Garden Services';
          var quoteId = allData[i][0];

          var custSubject = '✅ Booking Confirmed — ' + serviceName + ' — Gardners GM';
          var custHtml = '<div style="max-width:600px;margin:0 auto;font-family:Georgia,\'Times New Roman\',serif;color:#333;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.08);">'
            + getGgmEmailHeader({ title: '🌿 Booking Confirmed!', subtitle: 'Gardners Ground Maintenance' })
            + '<div style="padding:30px;background:#fff;">'
            + '<p style="font-size:16px;color:#333;line-height:1.7;">Hi ' + firstName + ',</p>'
            + '<p style="font-size:15px;color:#333;line-height:1.7;">Great news — your quote has been <strong style="color:#2E7D32;">accepted</strong> and your booking is confirmed! 🎉</p>'
            + '<div style="background:#f0f7f0;border-left:4px solid #2E7D32;padding:16px 20px;margin:20px 0;border-radius:0 8px 8px 0;">'
            + '<p style="margin:0 0 8px;font-size:14px;"><strong>📋 Quote Reference:</strong> ' + quoteId + '</p>'
            + '<p style="margin:0 0 8px;font-size:14px;"><strong>🔧 Service:</strong> ' + serviceName + '</p>'
            + '<p style="margin:0 0 8px;font-size:14px;"><strong>💰 Total:</strong> £' + grandTotal + '</p>'
            + '<p style="margin:0;font-size:14px;"><strong>📄 Job Reference:</strong> ' + jobNum + '</p>'
            + '</div>'
            + (depositReq
              ? '<p style="font-size:15px;color:#E65100;line-height:1.7;">💳 <strong>A 10% deposit of £' + depositAmt + ' is required to secure your booking.</strong> You can pay via the link on your quote page.</p>'
              : '')
            + '<h3 style="color:#2E7D32;margin:24px 0 12px;">What happens next?</h3>'
            + '<ol style="font-size:14px;color:#555;line-height:1.8;padding-left:20px;">'
            + '<li>Your visit is booked for the date you requested' + (depositReq ? ' (once your deposit is paid)' : '') + '.</li>'
            + '<li>You\'ll receive a reminder email the day before your scheduled visit.</li>'
            + '<li>On the day, we\'ll arrive at the arranged time and get the job done!</li>'
            + '</ol>'
            + '<p style="font-size:15px;color:#333;line-height:1.7;">If you need to change anything or have any questions, just reply to this email or call us on <strong>01726 432051</strong>.</p>'
            + '<p style="font-size:15px;color:#333;line-height:1.7;">Thanks for choosing Gardners GM — we look forward to working on your garden! 🌿</p>'
            + '</div>'
            + getGgmEmailFooter(clientEmail)
            + '</div>';

          sendEmail({
            to: clientEmail,
            toName: clientName,
            subject: custSubject,
            htmlBody: custHtml,
            name: 'Gardners Ground Maintenance',
            replyTo: 'info@gardnersgm.co.uk'
          });
          Logger.log('Quote acceptance confirmation email sent to ' + clientEmail);
        } catch(custEmailErr) {
          Logger.log('Customer acceptance email failed: ' + custEmailErr);
        }

        try {
          notifyBot('moneybot', '✅ *QUOTE ACCEPTED!*\n\n🔖 ' + allData[i][0] + '\n👤 ' + allData[i][2] + '\n💰 £' + grandTotal + '\n' + (depositReq ? '💳 Deposit £' + depositAmt + ' required' : '✅ No deposit needed') + '\n📄 Job: ' + jobNum + '\n📅 Auto-added to Schedule');
        } catch(e) {}
        
        return ContentService.createTextOutput(JSON.stringify({
          status: 'success', quoteStatus: depositReq ? 'Awaiting Deposit' : 'Accepted', jobNumber: jobNum,
          depositRequired: depositReq, depositAmount: depositAmt, grandTotal: grandTotal
        })).setMimeType(ContentService.MimeType.JSON);
      }
      
      return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: 'Invalid response' })).setMimeType(ContentService.MimeType.JSON);
    }
  }
  return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: 'Quote not found' })).setMimeType(ContentService.MimeType.JSON);
}


// ── Helper: Update Jobs sheet when quote deposit is paid ──
function markJobDepositPaid(jobNumber, depositAmount, quoteRef) {
  if (!jobNumber) return;
  try {
    var jobSheet = SpreadsheetApp.openById(QUOTE_SHEET_ID).getSheetByName('Jobs');
    if (!jobSheet) return;
    var data = jobSheet.getDataRange().getValues();
    for (var r = data.length - 1; r >= 0; r--) {
      if (String(data[r][19]) === jobNumber) {
        var rowNum = r + 1;
        // Update status from "Awaiting Deposit" to "Confirmed"
        var currentStatus = String(data[r][11] || '');
        if (currentStatus === 'Awaiting Deposit') {
          jobSheet.getRange(rowNum, 12).setValue('Confirmed');  // Col L = Status
        }
        // Update notes to reflect deposit paid
        var currentNotes = String(data[r][16] || '');
        var updatedNotes = currentNotes.replace(/Deposit \u00a3[\d.]+ required\.?/i, 'Deposit \u00a3' + parseFloat(depositAmount).toFixed(2) + ' PAID.');
        if (updatedNotes === currentNotes && depositAmount > 0) {
          updatedNotes = currentNotes + ' Deposit \u00a3' + parseFloat(depositAmount).toFixed(2) + ' PAID.';
        }
        jobSheet.getRange(rowNum, 17).setValue(updatedNotes);  // Col Q = Notes
        Logger.log('Jobs sheet updated for ' + jobNumber + ': status → Confirmed, deposit £' + depositAmount + ' marked paid');
        break;
      }
    }
    // Also update Schedule sheet
    var schedSheet = SpreadsheetApp.openById(QUOTE_SHEET_ID).getSheetByName('Schedule');
    if (schedSheet) {
      var sData = schedSheet.getDataRange().getValues();
      for (var s = sData.length - 1; s >= 0; s--) {
        if (String(sData[s][10]) === jobNumber) {
          var sRow = s + 1;
          var schedStatus = String(sData[s][9] || '');
          if (schedStatus === 'Awaiting Deposit') {
            schedSheet.getRange(sRow, 10).setValue('Confirmed');  // Col J = Status
          }
          var schedNotes = String(sData[s][14] || '');
          var updatedSchedNotes = schedNotes.replace(/Deposit \u00a3[\d.]+ required[^.]*\.?/i, 'Deposit \u00a3' + parseFloat(depositAmount).toFixed(2) + ' PAID.');
          schedSheet.getRange(sRow, 15).setValue(updatedSchedNotes);  // Col O = Notes
          break;
        }
      }
    }
  } catch(e) {
    Logger.log('markJobDepositPaid error: ' + e);
  }
}


// ── PROCESS DEPOSIT PAYMENT FOR ACCEPTED QUOTE ──
function handleQuoteDepositPayment(data) {
  // Look up quote by token (primary) or quoteRef (fallback)
  var token = data.token || '';
  var sheet = getOrCreateQuotesSheet();
  var allData = sheet.getDataRange().getValues();
  var quoteRow = -1;
  var quoteRef = data.quoteRef || '';
  var amount = parseFloat(data.amount) || 0;
  var customerEmail = data.email || '';
  var customerName = data.name || '';
  var grandTotal = 0;
  var jobNumber = '';

  // Find quote by token
  for (var i = 1; i < allData.length; i++) {
    if (token && String(allData[i][17]) === token) {
      quoteRow = i;
      break;
    }
    if (quoteRef && String(allData[i][0]) === quoteRef) {
      quoteRow = i;
      break;
    }
  }

  if (quoteRow < 0) {
    return ContentService.createTextOutput(JSON.stringify({
      status: 'error', message: 'Quote not found'
    })).setMimeType(ContentService.MimeType.JSON);
  }

  // Extract quote data from sheet row
  var row = allData[quoteRow];
  if (!quoteRef) quoteRef = String(row[0]);
  if (!customerEmail) customerEmail = String(row[3]);
  if (!customerName) customerName = String(row[2]);
  grandTotal = parseFloat(row[13]) || 0;
  var depositAmount = parseFloat(row[15]) || 0;
  jobNumber = String(row[23] || '');

  // Use deposit amount from sheet if not provided
  if (!amount || amount <= 0) amount = depositAmount;

  if (!amount || amount <= 0) {
    return ContentService.createTextOutput(JSON.stringify({
      status: 'error', message: 'No deposit amount found for this quote'
    })).setMimeType(ContentService.MimeType.JSON);
  }

  var paymentMethodId = data.paymentMethodId || '';
  if (!paymentMethodId) {
    return ContentService.createTextOutput(JSON.stringify({
      status: 'error', message: 'No payment method provided'
    })).setMimeType(ContentService.MimeType.JSON);
  }

  try {
    // Find or create Stripe customer
    var customer = findOrCreateCustomer(
      customerEmail, customerName, String(row[4] || ''),
      String(row[5] || ''), String(row[6] || '')
    );

    // Create PaymentIntent with confirm=true (inline card payment)
    var amountPence = String(Math.round(amount * 100)).split('.')[0];
    var piParams = {
      'amount': amountPence,
      'currency': 'gbp',
      'customer': customer.id,
      'payment_method': paymentMethodId,
      'confirm': 'true',
      'description': 'Deposit for Quote ' + quoteRef,
      'receipt_email': customerEmail,
      'metadata[type]': 'quote_deposit',
      'metadata[quoteRef]': quoteRef,
      'metadata[jobNumber]': jobNumber,
      'metadata[customerName]': customerName,
      'metadata[customerEmail]': customerEmail,
      'return_url': 'https://gardnersgm.co.uk/quote-response.html?deposit=paid&token=' + token
    };

    var pi = stripeRequest('/v1/payment_intents', 'post', piParams);

    if (pi.status === 'requires_action' || pi.status === 'requires_source_action') {
      // 3D Secure required — return client secret for front-end confirmation
      return ContentService.createTextOutput(JSON.stringify({
        status: 'requires_action',
        clientSecret: pi.client_secret,
        depositAmount: amount.toFixed(2),
        remaining: (grandTotal - amount).toFixed(2),
        jobNumber: jobNumber
      })).setMimeType(ContentService.MimeType.JSON);
    }

    if (pi.status === 'succeeded') {
      // Payment succeeded — update quote status
      var sheetRow = quoteRow + 1;
      sheet.getRange(sheetRow, 17).setValue('Deposit Paid');  // Col Q = Status

      // Update Jobs sheet: notes + status
      try { markJobDepositPaid(jobNumber, amount, quoteRef); } catch(jErr) { Logger.log('Job deposit update error: ' + jErr); }

      // Create Google Calendar event for the confirmed job
      try {
        var quoteNotes = String(row[21] || '');
        var calDate = '';
        var calTime = '';
        var pdm = quoteNotes.match(/PREFERRED_DATE:([^.]*)/);
        if (pdm) calDate = pdm[1].trim();
        var ptm = quoteNotes.match(/PREFERRED_TIME:([^.]*)/);
        if (ptm) calTime = ptm[1].trim();
        if (calDate) {
          createCalendarEvent(customerName, String(row[7] || 'Garden Service'), calDate, calTime, String(row[5] || ''), String(row[6] || ''), jobNumber);
          Logger.log('Google Calendar event created for job ' + jobNumber + ' on ' + calDate);
        }
      } catch(calErr) { Logger.log('Calendar event creation error: ' + calErr); }

      // Send deposit confirmation email
      try {
        sendQuoteDepositConfirmationEmail({
          name: customerName, email: customerEmail, quoteId: quoteRef,
          jobNumber: jobNumber, title: String(row[7] || ''),
          depositAmount: amount.toFixed(2), grandTotal: grandTotal.toFixed(2),
          remaining: (grandTotal - amount).toFixed(2)
        });
      } catch(depEmailErr) { Logger.log('Deposit confirmation email error: ' + depEmailErr); }

      // Notify Telegram
      try {
        notifyBot('moneybot', '💰 *Quote Deposit Paid!*\n━━━━━━━━━━━━━━━━━━━━\n💵 £' + amount.toFixed(2) +
          '\n📧 ' + customerEmail +
          '\n🔖 Quote: ' + quoteRef +
          '\n📄 Job: ' + jobNumber);
      } catch(e) {}

      return ContentService.createTextOutput(JSON.stringify({
        status: 'success',
        depositAmount: amount.toFixed(2),
        remaining: (grandTotal - amount).toFixed(2),
        jobNumber: jobNumber
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // Unexpected status
    Logger.log('Quote deposit PI unexpected status: ' + pi.status);
    return ContentService.createTextOutput(JSON.stringify({
      status: 'error', message: 'Payment status: ' + pi.status + '. Please try again.'
    })).setMimeType(ContentService.MimeType.JSON);

  } catch(e) {
    Logger.log('Quote deposit payment error: ' + e);
    return ContentService.createTextOutput(JSON.stringify({
      status: 'error', message: 'Payment failed: ' + e.message
    })).setMimeType(ContentService.MimeType.JSON);
  }
}


// ── SEND QUOTE EMAIL (personalised from Chris) ──
function sendQuoteEmail(q) {
  var items = Array.isArray(q.lineItems) ? q.lineItems : [];
  var itemRows = '';
  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    var qty = parseFloat(item.qty) || 1;
    var unitPrice = parseFloat(item.unitPrice) || 0;
    var lineTotal = (qty * unitPrice).toFixed(2);
    var unitLabel = item.unit && item.unit !== 'job' ? ' / ' + item.unit : '';
    var qtyLabel = qty + (item.unit && item.unit !== 'job' && item.unit !== 'each' ? ' ' + item.unit : '');
    var catIcons = { service: '\ud83c\udf3f', labour: '\ud83d\udc77', materials: '\ud83d\udce6', equipment: '\ud83d\ude9c', traffic: '\ud83d\udea7', waste: '\u267b\ufe0f', surcharge: '\u26a1', custom: '\u2699\ufe0f' };
    var catIcon = catIcons[item.category] || '';
    itemRows += '<tr>' +
      '<td style="padding:10px 12px;border-bottom:1px solid #e0e0e0;">' + catIcon + ' ' + (item.description || '') + '</td>' +
      '<td style="padding:10px 12px;border-bottom:1px solid #e0e0e0;text-align:center;">' + qtyLabel + '</td>' +
      '<td style="padding:10px 12px;border-bottom:1px solid #e0e0e0;text-align:right;">\u00a3' + unitPrice.toFixed(2) + unitLabel + '</td>' +
      '<td style="padding:10px 12px;border-bottom:1px solid #e0e0e0;text-align:right;">\u00a3' + lineTotal + '</td>' +
      '</tr>';
  }
  
  var firstName = (q.name || 'there').split(' ')[0];
  var depositLine = '';
  if (q.depositRequired) {
    depositLine = '<tr><td colspan="3" style="padding:10px 12px;text-align:right;font-weight:bold;color:#E65100;">10% Booking Deposit</td>' +
      '<td style="padding:10px 12px;text-align:right;font-weight:bold;color:#E65100;">\u00a3' + (q.depositAmount || 0).toFixed(2) + '</td></tr>';
  }
  
  var discountLine = '';
  if (q.discountAmt > 0) {
    discountLine = '<tr><td colspan="3" style="padding:10px 12px;text-align:right;color:#2E7D32;">Discount' + (q.discountPct > 0 ? ' (' + q.discountPct + '%)' : '') + '</td>' +
      '<td style="padding:10px 12px;text-align:right;color:#2E7D32;">-\u00a3' + q.discountAmt.toFixed(2) + '</td></tr>';
  }
  
  var vatLine = '';
  if (q.vatAmt > 0) {
    vatLine = '<tr><td colspan="3" style="padding:10px 12px;text-align:right;">VAT (20%)</td>' +
      '<td style="padding:10px 12px;text-align:right;">\u00a3' + q.vatAmt.toFixed(2) + '</td></tr>';
  }
  
  var quoteUrl = 'https://gardnersgm.co.uk/quote-response.html?token=' + q.token;
  
  var html = '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:0;background:#f0f2f5;font-family:Georgia,\'Times New Roman\',serif;">' +
    '<div style="max-width:650px;margin:20px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.08);">' +
    
    // Header with logo
    getGgmEmailHeader({ title: '\ud83c\udf3f Gardners Ground Maintenance', subtitle: 'Professional Garden Services — Cornwall', gradient: '#1B5E20', gradientEnd: '#2E7D32' }) +
    
    // Personal greeting
    '<div style="padding:30px;">' +
    '<p style="font-size:16px;color:#333;">Hi ' + firstName + ',</p>' +
    '<p style="color:#555;line-height:1.6;">Thank you for your enquiry. I\'ve put together a detailed quote for the work we discussed. Please review the breakdown below and let me know if you have any questions.</p>' +
    
    // Quote header
    '<div style="background:#E8F5E9;border-radius:8px;padding:20px;margin:20px 0;">' +
    '<table style="width:100%;border-collapse:collapse;">' +
    '<tr><td style="color:#1B5E20;font-weight:bold;">Quote Reference</td><td style="text-align:right;font-weight:bold;">' + q.quoteId + '</td></tr>' +
    '<tr><td style="color:#666;">Quote Title</td><td style="text-align:right;">' + (q.title || 'Custom Work') + '</td></tr>' +
    '<tr><td style="color:#666;">Valid Until</td><td style="text-align:right;">' + (q.validUntil || '30 days') + '</td></tr>' +
    (q.address ? '<tr><td style="color:#666;">Property</td><td style="text-align:right;">' + q.address + (q.postcode ? ', ' + q.postcode : '') + '</td></tr>' : '') +
    '</table></div>' +
    
    // Line items table
    '<table style="width:100%;border-collapse:collapse;margin:20px 0;">' +
    '<thead><tr style="background:#1B5E20;color:#fff;">' +
    '<th style="padding:12px;text-align:left;border-radius:6px 0 0 0;">Description</th>' +
    '<th style="padding:12px;text-align:center;">Qty</th>' +
    '<th style="padding:12px;text-align:right;">Unit Price</th>' +
    '<th style="padding:12px;text-align:right;border-radius:0 6px 0 0;">Total</th>' +
    '</tr></thead><tbody>' + itemRows + '</tbody>' +
    '<tfoot>' +
    '<tr><td colspan="3" style="padding:10px 12px;text-align:right;">Subtotal</td>' +
    '<td style="padding:10px 12px;text-align:right;">\u00a3' + q.subtotal.toFixed(2) + '</td></tr>' +
    discountLine + vatLine +
    '<tr style="background:#1B5E20;color:#fff;">' +
    '<td colspan="3" style="padding:14px 12px;text-align:right;font-size:18px;font-weight:bold;border-radius:0 0 0 6px;">TOTAL</td>' +
    '<td style="padding:14px 12px;text-align:right;font-size:18px;font-weight:bold;border-radius:0 0 6px 0;">\u00a3' + q.grandTotal.toFixed(2) + '</td></tr>' +
    depositLine +
    '</tfoot></table>' +
    
    // Notes
    (q.notes ? '<div style="background:#FFF8E1;border-left:4px solid #FFC107;padding:15px;margin:20px 0;border-radius:4px;"><strong>Notes:</strong><br>' + q.notes.replace(/\n/g, '<br>') + '</div>' : '') +
    
    // Deposit info
    (q.depositRequired ? '<div style="background:#FFF3E0;border:1px solid #FFB74D;padding:15px;border-radius:8px;margin:20px 0;">' +
      '<p style="margin:0;color:#E65100;font-weight:bold;">\ud83d\udcb3 10% Booking Deposit Required</p>' +
      '<p style="margin:8px 0 0;color:#666;">A deposit of <strong>\u00a3' + (q.depositAmount || 0).toFixed(2) + '</strong> is required to secure this booking. ' +
      'This will be deducted from the total when the final invoice is issued.</p></div>' : '') +
    
    // Accept/Decline buttons
    '<div style="text-align:center;margin:30px 0;">' +
    '<p style="color:#666;margin-bottom:15px;">Ready to go ahead? Click below to accept or decline this quote:</p>' +
    '<a href="' + quoteUrl + '&action=accept" style="display:inline-block;background:#2E7D32;color:#fff;padding:14px 40px;border-radius:8px;text-decoration:none;font-weight:bold;font-size:16px;margin:5px;">\u2705 Accept Quote</a>' +
    '&nbsp;&nbsp;' +
    '<a href="' + quoteUrl + '&action=decline" style="display:inline-block;background:#C62828;color:#fff;padding:14px 40px;border-radius:8px;text-decoration:none;font-weight:bold;font-size:16px;margin:5px;">\u274c Decline Quote</a>' +
    '</div>' +
    
    // Footer
    '<hr style="border:none;border-top:1px solid #eee;margin:30px 0;">' +
    '<p style="color:#555;line-height:1.6;">If you have any questions about this quote, don\'t hesitate to get in touch. I\'m happy to adjust anything to suit your needs.</p>' +
    '</div>' +
    getGgmEmailFooter(q.email) +
    '</div></body></html>';
  
  sendEmail({
    to: q.email,
    toName: '',
    subject: '\ud83c\udf3f Quote ' + q.quoteId + ' from Gardners Ground Maintenance — ' + (q.title || 'Custom Work'),
    htmlBody: html,
    name: 'Gardners Ground Maintenance',
    replyTo: 'info@gardnersgm.co.uk'
  });
}


// ── QUOTE DEPOSIT CONFIRMATION EMAIL ──
function sendQuoteDepositConfirmationEmail(q) {
  var firstName = (q.name || 'there').split(' ')[0];
  
  var html = '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,sans-serif;">' +
    '<div style="max-width:600px;margin:20px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.1);">' +
    '<div style="background:linear-gradient(135deg,#1B5E20,#2E7D32);padding:30px;text-align:center;">' +
    '<h1 style="color:#fff;margin:0;font-size:22px;">\ud83c\udf3f Deposit Received — Thank You!</h1></div>' +
    '<div style="padding:30px;">' +
    '<p style="font-size:16px;color:#333;">Hi ' + firstName + ',</p>' +
    '<p style="color:#555;line-height:1.6;">Great news! Your deposit has been received and your booking is now confirmed.</p>' +
    '<div style="background:#E8F5E9;border-radius:8px;padding:20px;margin:20px 0;">' +
    '<table style="width:100%;border-collapse:collapse;">' +
    '<tr><td style="color:#666;padding:5px 0;">Quote Reference</td><td style="text-align:right;font-weight:bold;">' + q.quoteId + '</td></tr>' +
    '<tr><td style="color:#666;padding:5px 0;">Job Number</td><td style="text-align:right;font-weight:bold;">' + (q.jobNumber || '') + '</td></tr>' +
    '<tr><td style="color:#666;padding:5px 0;">Work</td><td style="text-align:right;">' + (q.title || '') + '</td></tr>' +
    '<tr><td style="color:#666;padding:5px 0;">Deposit Paid</td><td style="text-align:right;color:#2E7D32;font-weight:bold;">\u00a3' + q.depositAmount + '</td></tr>' +
    '<tr><td style="color:#666;padding:5px 0;">Total Quote</td><td style="text-align:right;">\u00a3' + q.grandTotal + '</td></tr>' +
    '<tr><td style="color:#666;padding:5px 0;">Remaining Balance</td><td style="text-align:right;font-weight:bold;color:#E65100;">\u00a3' + q.remaining + '</td></tr>' +
    '</table></div>' +
    '<p style="color:#555;line-height:1.6;">The remaining balance of \u00a3' + q.remaining + ' will be invoiced upon completion of the work. I\'ll be in touch to arrange a suitable date.</p>' +
    '<p style="color:#333;font-weight:bold;">Cheers,<br>Chris Gardner<br>Gardners Ground Maintenance</p>' +
    '<p style="color:#888;font-size:12px;">\ud83d\udcde 01726 432051 &nbsp; | &nbsp; \ud83d\udce7 info@gardnersgm.co.uk</p>' +
    '</div></div></body></html>';
  
  sendEmail({
    to: q.email,
    toName: '',
    subject: '\u2705 Deposit Confirmed — ' + (q.title || 'Your Booking') + ' — Gardners GM',
    htmlBody: html,
    name: 'Gardners Ground Maintenance',
    replyTo: 'info@gardnersgm.co.uk'
  });
}


// ============================================
// STRIPE SUBSCRIPTION CREATION
// ============================================

function handleStripeSubscription(data) {
  
  // Package pricing (not VAT registered — prices are final)
  var packagePricing = {
    'lawn-care-weekly':      { amount: 3400, interval: 'week', interval_count: 1, name: 'Just Mowing — Weekly' },
    'lawn-care-fortnightly': { amount: 3900, interval: 'week', interval_count: 2, name: 'Just Mowing — Fortnightly' },
    'just-mowing-weekly':    { amount: 3400, interval: 'week', interval_count: 1, name: 'Just Mowing — Weekly' },
    'just-mowing-fortnightly': { amount: 3900, interval: 'week', interval_count: 2, name: 'Just Mowing — Fortnightly' },
    'garden-maintenance':    { amount: 15700, interval: 'month', interval_count: 1, name: 'Full Garden Care — Monthly' },
    'full-garden-care':      { amount: 15700, interval: 'month', interval_count: 1, name: 'Full Garden Care — Monthly' },
    'property-care':         { amount: 6200, interval: 'month', interval_count: 1, name: 'Property Care — Monthly' }
  };

  // Apply clippings discount (-£5/visit = -500 pence) for mowing packages
  if (data.keepClippings) {
    var clippingsKeys = ['lawn-care-weekly','lawn-care-fortnightly','just-mowing-weekly','just-mowing-fortnightly'];
    if (clippingsKeys.indexOf(data.package) >= 0 && packagePricing[data.package]) {
      packagePricing[data.package].amount -= 500;
      packagePricing[data.package].name += ' (keep clippings — £5 off)';
    }
    if (data.package === 'garden-maintenance' || data.package === 'full-garden-care') {
      packagePricing[data.package].amount -= 2000;
      packagePricing[data.package].name += ' (keep clippings — £20 off)';
    }
  }
  
  var pricing = packagePricing[data.package];

  // Handle custom (Build Your Own) packages
  if (data.package === 'custom' && data.customMonthly) {
    var amountPence = String(Math.round(parseFloat(data.customMonthly) * 100)).split('.')[0];
    var servDesc = (data.customServices || []).map(function(s) {
      return s.service + ' (' + s.frequency + ')';
    }).join(', ');
    pricing = {
      amount: amountPence,
      interval: 'month',
      interval_count: 1,
      name: 'Custom Package — ' + (servDesc || 'Bespoke')
    };
  }

  if (!pricing) {
    throw new Error('Unknown package: ' + data.package);
  }
  
  // ── Create Stripe customer + subscription ──
  var stripeCustomer = null;
  var stripeSubscription = null;
  var stripeSubId = '';
  try {
    stripeCustomer = findOrCreateCustomer(
      data.customer.email, data.customer.name, data.customer.phone,
      data.customer.address, data.customer.postcode
    );
    
    // Attach payment method to customer if provided
    if (data.paymentMethodId) {
      stripeRequest('/v1/payment_methods/' + data.paymentMethodId + '/attach', 'post', { customer: stripeCustomer.id });
      stripeRequest('/v1/customers/' + stripeCustomer.id, 'post', {
        'invoice_settings[default_payment_method]': data.paymentMethodId
      });
    }
    
    // Create price
    var priceParams = {
      'unit_amount': pricing.amount,
      'currency': 'gbp',
      'recurring[interval]': pricing.interval,
      'recurring[interval_count]': pricing.interval_count,
      'product_data[name]': pricing.name
    };
    var price = stripeRequest('/v1/prices', 'post', priceParams);
    
    // Create subscription
    var subParams = {
      'customer': stripeCustomer.id,
      'items[0][price]': price.id,
      'payment_behavior': 'default_incomplete',
      'expand[]': 'latest_invoice.payment_intent'
    };
    if (data.paymentMethodId) {
      subParams['default_payment_method'] = data.paymentMethodId;
      subParams['payment_behavior'] = 'allow_incomplete';
    }
    stripeSubscription = stripeRequest('/v1/subscriptions', 'post', subParams);
    stripeSubId = stripeSubscription.id || '';
    Logger.log('Created Stripe subscription: ' + stripeSubId);
  } catch(stripeErr) {
    Logger.log('Stripe subscription creation error: ' + stripeErr);
    notifyBot('moneybot', '⚠️ Stripe subscription failed for ' + (data.customer.name || 'unknown') + ': ' + stripeErr.message);
  }
  
  // Log to spreadsheet
  var jobNum = '';
  try {
    var sheet = SpreadsheetApp.openById('1_Y7yHIpAvv_VNBhTrwNOQaBMAGa3UlVW_FKlf56ouHk').getSheetByName('Jobs');
    jobNum = generateJobNumber();
    
    // Build enriched notes
    var enrichedNotes = data.notes || '';
    if (data.introVisit) enrichedNotes += (enrichedNotes ? '\n' : '') + '🤝 INTRO VISIT REQUESTED — Free meet & greet before paid work starts';
    if (data.keepClippings) enrichedNotes += (enrichedNotes ? '\n' : '') + '♻️ KEEP CLIPPINGS — Customer wants clippings for composting (£5/visit discount applied)';
    
    sheet.appendRow([
      new Date().toISOString(),
      'subscription',
      data.customer.name || '',
      data.customer.email || '',
      data.customer.phone || '',
      data.customer.address || '',
      data.customer.postcode || '',
      data.packageName || data.package,
      data.startDate || '',
      '',
      data.preferredDay || '',
      'pending',
      data.price || '',
      data.distance || '',
      data.driveTime || '',
      data.googleMapsUrl || '',
      enrichedNotes,
      'Auto',
      stripeSubId ? ('Stripe — ' + stripeSubId) : 'Pending',
      jobNum
    ]);
    
    // If intro visit requested, also create a separate intro visit job entry
    if (data.introVisit) {
      var introJobNum = generateJobNumber();
      sheet.appendRow([
        new Date().toISOString(),
        'intro-visit',
        data.customer.name || '',
        data.customer.email || '',
        data.customer.phone || '',
        data.customer.address || '',
        data.customer.postcode || '',
        'Intro Visit — Meet & Greet (' + (data.packageName || data.package) + ')',
        data.startDate || '',
        '',
        data.preferredDay || '',
        'scheduled',
        'FREE',
        data.distance || '',
        data.driveTime || '',
        data.googleMapsUrl || '',
        'Free intro visit for new subscriber. Walk round garden, discuss requirements, confirm package details. Linked to job: ' + jobNum,
        'Manual',
        'Free — included with subscription',
        introJobNum
      ]);
    }
  } catch(logErr) { Logger.log('Subscription sheet log error: ' + logErr); }
  
  // 3) Return result IMMEDIATELY — defer emails/newsletter/telegram to background
  var responseJson = { 
    status: 'success',
    subscriptionId: stripeSubId,
    subscriptionStatus: stripeSubscription ? stripeSubscription.status : 'pending',
    jobNumber: jobNum
  };
  
  // 4) Defer email/contract/newsletter/telegram to background trigger
  try {
    var postTaskData = {
      name: data.customer.name || '', email: data.customer.email || '',
      service: data.packageName || data.package || '',
      packageName: data.packageName || data.package || '',
      packageKey: data.package || '',
      date: data.startDate || '', time: '',
      jobNumber: jobNum, price: data.price || '',
      address: data.customer.address || '', postcode: data.customer.postcode || '',
      preferredDay: data.preferredDay || '',
      stripeSubId: stripeSubId,
      introVisit: data.introVisit || false,
      keepClippings: data.keepClippings || false,
      type: 'subscription', paymentType: 'subscription'
    };
    PropertiesService.getScriptProperties().setProperty('SUB_POST_' + jobNum, JSON.stringify(postTaskData));
    ScriptApp.newTrigger('processSubscriptionPostTasks')
      .timeBased()
      .after(3000)
      .create();
  } catch(deferErr) {
    // Fallback: send emails synchronously if trigger fails
    Logger.log('Deferred sub trigger failed, sending synchronously: ' + deferErr);
    try {
      sendBookingConfirmation({
        name: data.customer.name || '', email: data.customer.email || '',
        service: data.packageName || data.package || '', date: data.startDate || '', time: '',
        jobNumber: jobNum, price: data.price || '', address: data.customer.address || '',
        postcode: data.customer.postcode || '', preferredDay: data.preferredDay || '',
        type: 'subscription', paymentType: 'subscription'
      });
    } catch(emailErr) {
      try { notifyTelegram('⚠️ *EMAIL FAILED*\n\nSubscription confirmation email failed for ' + (data.customer.name || '') + ' (' + (data.customer.email || '') + ')\nJob: ' + jobNum + '\nError: ' + emailErr); } catch(e) {}
    }
    var subAddr = ((data.customer.address || '') + ', ' + (data.customer.postcode || '')).replace(/^,\s*/, '');
    var subMapsLink = subAddr ? '\n🗺 [Get Directions](https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(subAddr) + ')' : '';
    var introLine = data.introVisit ? '\n🤝 *Intro Visit:* YES — free meet & greet before paid work' : '';
    var clippingsLine = data.keepClippings ? '\n♻️ *Clippings:* Keep for composting (−£5/visit discount)' : '';
    try { notifyBot('moneybot', '🚨🚨 *NEW SUBSCRIBER* 🚨🚨\n━━━━━━━━━━━━━━━━━━━━\n\n💰 *Recurring Revenue!*\n\n👤 ' + (data.customer.name || 'Unknown') + '\n📦 ' + (data.packageName || data.package || '') + ' package\n📅 Starts: ' + (data.startDate || 'TBC') + '\n📆 Preferred day: ' + (data.preferredDay || 'Not set') + '\n📍 ' + (data.customer.postcode || '') + subMapsLink + '\n💰 ' + (data.price || '') + introLine + clippingsLine + '\n🔖 Job: ' + jobNum + '\n💳 Stripe: ' + (stripeSubId || 'pending') + '\n\n⚡ _Add to schedule & confirm route_'); } catch(e) {}
  }
  
  return ContentService
    .createTextOutput(JSON.stringify({ 
      status: 'success',
      subscriptionId: stripeSubId,
      subscriptionStatus: stripeSubscription ? stripeSubscription.status : 'pending',
      jobNumber: jobNum
    }))
    .setMimeType(ContentService.MimeType.JSON);
}


// ============================================
// STRIPE INVOICE CREATION
// ============================================

function handleStripeInvoice(data) {
  
  var jobNum = data.jobNumber || generateJobNumber();
  var invoiceNumber = data.invoiceNumber || generateInvoiceNumber();
  
  // Calculate total from items
  var totalPence = 0;
  for (var i = 0; i < data.items.length; i++) {
    totalPence += (data.items[i].unitAmount || 0) * (data.items[i].qty || 1);
  }
  var invAmount = (totalPence / 100).toFixed(2);
  
  // Apply discounts
  if (data.discountPercent && data.discountPercent > 0) {
    invAmount = (totalPence / 100 * (1 - data.discountPercent / 100)).toFixed(2);
  } else if (data.discountFixed && data.discountFixed > 0) {
    invAmount = ((totalPence - data.discountFixed) / 100).toFixed(2);
  }
  
  // Create Stripe invoice
  var stripeInvoiceId = '';
  var stripeInvoiceUrl = '';
  var stripeInvoicePdf = '';
  try {
    var customer = findOrCreateCustomer(
      data.customer.email, data.customer.name, data.customer.phone,
      data.customer.address, data.customer.postcode
    );
    
    // Add invoice items
    for (var i = 0; i < data.items.length; i++) {
      var item = data.items[i];
      var itemAmount = String(Math.round((item.unitAmount || 0) * (item.qty || 1))).split('.')[0];
      stripeRequest('/v1/invoiceitems', 'post', {
        customer: customer.id,
        amount: itemAmount,
        currency: 'gbp',
        description: item.description || 'Service'
      });
    }
    
    // Apply discount if present
    if (data.discountPercent > 0 || data.discountFixed > 0) {
      var discountAmt = String(Math.round(data.discountPercent > 0 
        ? totalPence * data.discountPercent / 100 
        : (data.discountFixed || 0))).split('.')[0];
      stripeRequest('/v1/invoiceitems', 'post', {
        customer: customer.id,
        amount: '-' + discountAmt,
        currency: 'gbp',
        description: 'Discount'
      });
    }
    
    // Create and finalize the invoice
    var daysUntilDue = calculateDaysUntilDue(data.dueDate);
    var invoice = stripeRequest('/v1/invoices', 'post', {
      customer: customer.id,
      collection_method: 'send_invoice',
      days_until_due: daysUntilDue,
      'metadata[jobNumber]': jobNum,
      'metadata[invoiceNumber]': invoiceNumber
    });
    
    var finalized = stripeRequest('/v1/invoices/' + invoice.id + '/finalize', 'post', {});
    stripeInvoiceId = finalized.id;
    stripeInvoiceUrl = finalized.hosted_invoice_url || '';
    stripeInvoicePdf = finalized.invoice_pdf || '';
    
    // Send the invoice via Stripe
    stripeRequest('/v1/invoices/' + invoice.id + '/send', 'post', {});
  } catch(stripeErr) {
    Logger.log('Stripe invoice creation error: ' + stripeErr);
  }
  
  // Log to Jobs sheet
  try {
    var sheet = SpreadsheetApp.openById('1_Y7yHIpAvv_VNBhTrwNOQaBMAGa3UlVW_FKlf56ouHk').getSheetByName('Jobs');
    sheet.appendRow([
      new Date().toISOString(),
      'email-invoice',
      data.customer.name || '',
      data.customer.email || '',
      data.customer.phone || '',
      data.customer.address || '',
      data.customer.postcode || '',
      invoiceNumber,
      data.dueDate || '',
      '',
      '',
      'Invoiced',
      invAmount,
      '',
      '',
      '',
      data.notes || '',
      'Balance Due',
      'Email Invoice',
      jobNum
    ]);
  } catch(logErr) { Logger.log('Invoice job log error: ' + logErr); }
  
  // Log to Invoices sheet
  try {
    var photos = getJobPhotos(jobNum);
    var beforeUrls = photos.before.map(function(p) { return p.url; }).join(', ');
    var afterUrls = photos.after.map(function(p) { return p.url; }).join(', ');
    
    logInvoice({
      invoiceNumber: invoiceNumber,
      jobNumber: jobNum,
      clientName: data.customer.name || '',
      email: data.customer.email || '',
      amount: invAmount,
      status: 'Sent',
      stripeInvoiceId: stripeInvoiceId,
      paymentUrl: stripeInvoiceUrl,
      dateIssued: new Date().toISOString(),
      dueDate: data.dueDate || '',
      datePaid: '',
      paymentMethod: '',
      beforePhotos: beforeUrls,
      afterPhotos: afterUrls,
      notes: data.notes || ''
    });
  } catch(invLogErr) { Logger.log('Invoice log error: ' + invLogErr); }
  
  // Mark the source job as Balance Due
  if (data.jobNumber) {
    try { markJobBalanceDue(data.jobNumber); } catch(e) {}
  }
  
  // Send email invoice to client
  try {
    sendInvoiceEmail({
      customer: data.customer,
      invoiceNumber: invoiceNumber,
      jobNumber: jobNum,
      items: data.items ? data.items.map(function(it) {
        return { description: it.description, qty: it.qty, price: (it.unitAmount / 100) };
      }) : [],
      grandTotal: parseFloat(invAmount),
      subtotal: parseFloat((totalPence / 100).toFixed(2)),
      discountAmt: data.discountPercent > 0 ? (totalPence / 100 * data.discountPercent / 100) : (data.discountFixed > 0 ? data.discountFixed / 100 : 0),
      invoiceDate: new Date().toLocaleDateString('en-GB'),
      dueDate: data.dueDate || '',
      paymentUrl: stripeInvoiceUrl,
      notes: data.notes || ''
    });
  } catch(emailErr) {
    Logger.log('Invoice email failed: ' + emailErr);
  }
  
  return ContentService
    .createTextOutput(JSON.stringify({ 
      status: 'success',
      invoiceId: stripeInvoiceId,
      invoiceUrl: stripeInvoiceUrl,
      invoicePdf: stripeInvoicePdf,
      jobNumber: jobNum
    }))
    .setMimeType(ContentService.MimeType.JSON);
}


// ============================================
// CRM — UPDATE CLIENT ROW
// ============================================

// ── Shared auto-invoice logic when any job → Completed ──
function autoInvoiceOnCompletion(sheet, rowIndex) {
  var row = sheet.getRange(rowIndex, 1, 1, 20).getValues()[0];
  var custName = String(row[2] || '');
  var custEmail = String(row[3] || '');
  var custPhone = String(row[4] || '');
  var custAddr = String(row[5] || '');
  var custPostcode = String(row[6] || '');
  var svc = String(row[7] || '');
  var price = String(row[12] || '');
  var notes = String(row[16] || '');
  var paid = String(row[17] || '');
  var jn = String(row[19] || '');
  var dateStr = String(row[8] || '');
  var jobType = String(row[1] || '');
  
  // ── Double-invocation guard: prevent duplicate invoices ──
  // Multiple paths can trigger this (Hub update_status, DayBot /done, MoneyBot /invoice, updateClientRow)
  if (jn) {
    var cache = CacheService.getScriptCache();
    var guardKey = 'auto_inv_' + jn;
    if (cache.get(guardKey)) {
      Logger.log('Auto-invoice dedup: already processing job ' + jn + ' — skipping');
      return;
    }
    cache.put(guardKey, '1', 120); // Block repeats for 2 minutes
  }
  
  // Debug: confirm function is running and show key values
  notifyBot('moneybot', '🔧 *Auto-Invoice Starting*\n\n👤 ' + custName + '\n📧 ' + custEmail + '\n📋 ' + svc + '\n💰 Price: ' + price + '\n📝 Paid: ' + paid + '\n🔖 ' + jn + '\n💬 Notes: ' + (notes.substring(0, 80) || 'none'));
  
  // Always send completion email
  try {
    sendCompletionEmail({ name: custName, email: custEmail, service: svc, jobNumber: jn, date: dateStr });
    trackEmail(custEmail, custName, 'completion', svc, jn);
  } catch(compErr) {
    Logger.log('Completion email error: ' + compErr);
    notifyBot('moneybot', '\u26a0\ufe0f *Completion Email Error*\n\n\ud83d\udc64 ' + custName + '\n\ud83d\udd16 ' + jn + '\n\u274c ' + compErr);
  }
  
  // If this is a subscription visit, send visit summary with photos + next visit + calendar
  if (jobType === 'stripe-subscription' || jobType === 'subscription') {
    try {
      sendSubscriberVisitSummary({
        name: custName,
        email: custEmail,
        service: svc,
        packageName: svc || 'Subscription',
        jobNumber: jn,
        visitDate: dateStr ? new Date(dateStr).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : undefined,
        address: custAddr,
        postcode: custPostcode
      });
    } catch(subErr) {
      Logger.log('Subscriber visit summary error: ' + subErr);
    }
  }
  
  // Don't invoice if already fully paid
  if (paid === 'Yes' || paid === 'Auto') {
    notifyBot('moneybot', '\u2705 *Job Completed*\n\n\ud83d\udc64 ' + custName + '\n\ud83d\udccb ' + svc + '\n\ud83d\udcb0 Already fully paid\n\ud83d\udd16 ' + jn);
    return;
  }
  
  var priceNum = parseFloat(price.replace(/[^0-9.]/g, '')) || 0;
  if (priceNum <= 0) {
    notifyBot('moneybot', '\u2705 *Job Completed*\n\n\ud83d\udc64 ' + custName + '\n\ud83d\udccb ' + svc + '\n\ud83d\udcb0 No price set\n\ud83d\udd16 ' + jn);
    return;
  }
  
  // Detect deposit: first check Quotes sheet for reliable status, then fallback to notes regex
  var depositPaid = 0;
  try {
    // Look up quote linked to this job
    var qSheet = getOrCreateQuotesSheet();
    var qData = qSheet.getDataRange().getValues();
    for (var qi = 1; qi < qData.length; qi++) {
      if (String(qData[qi][23]) === jn && String(qData[qi][16]) === 'Deposit Paid') {
        depositPaid = parseFloat(qData[qi][15]) || 0;
        Logger.log('Deposit £' + depositPaid + ' confirmed from Quotes sheet for job ' + jn);
        break;
      }
    }
  } catch(qLookupErr) {
    Logger.log('Quote deposit lookup error: ' + qLookupErr);
  }
  // Fallback: parse notes if quote lookup found nothing
  if (depositPaid <= 0) {
    var depMatch = notes.match(/[Dd]eposit.*?\u00a3(\d+\.?\d*).*?paid/i);
    if (depMatch) depositPaid = parseFloat(depMatch[1]) || 0;
  }
  
  var remainingBalance = priceNum - depositPaid;
  if (remainingBalance < 0) remainingBalance = 0;
  var amountToInvoice = remainingBalance > 0 ? remainingBalance : priceNum;
  
  // Generate invoice number
  var invoiceNumber = generateInvoiceNumber();
  
  // Due date: 14 days
  var dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + 14);
  var dueDateStr = dueDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  
  // Create Stripe invoice for the remaining balance
  var stripeInvoiceUrl = '';
  var stripeInvoiceId = '';
  try {
    var customer = findOrCreateCustomer(custEmail, custName, custAddr, custPostcode);
    
    // Create invoice item for the full job price
    stripeRequest('/v1/invoiceitems', 'post', {
      'customer': customer.id,
      'amount': String(Math.round(priceNum * 100)).split('.')[0],
      'currency': 'gbp',
      'description': svc + ' — Job ' + jn + (depositPaid > 0 ? ' (full job total)' : '')
    });
    
    // Apply deposit as credit if applicable
    if (depositPaid > 0) {
      stripeRequest('/v1/invoiceitems', 'post', {
        'customer': customer.id,
        'amount': '-' + String(Math.round(depositPaid * 100)).split('.')[0],
        'currency': 'gbp',
        'description': '10% Deposit Already Paid (deducted)'
      });
    }
    
    // Create, finalize and send the invoice
    var inv = stripeRequest('/v1/invoices', 'post', {
      'customer': customer.id,
      'collection_method': 'send_invoice',
      'days_until_due': 14,
      'metadata[jobNumber]': jn,
      'metadata[invoiceNumber]': invoiceNumber
    });
    
    var finalised = stripeRequest('/v1/invoices/' + inv.id + '/finalize', 'post', {});
    stripeRequest('/v1/invoices/' + inv.id + '/send', 'post', {});
    
    stripeInvoiceId = finalised.id || inv.id;
    stripeInvoiceUrl = finalised.hosted_invoice_url || '';
  } catch(stripeErr) {
    Logger.log('Auto-invoice Stripe error: ' + stripeErr);
    notifyBot('moneybot', '\u26a0\ufe0f *Stripe Auto-Invoice Error*\n\n\ud83d\udc64 ' + custName + '\n\ud83d\udd16 ' + jn + '\n\u274c ' + stripeErr);
  }
  
  // Send email invoice with Stripe payment button + job photos
  try {
    sendInvoiceEmail({
      customer: { name: custName, email: custEmail, address: custAddr, postcode: custPostcode },
      jobNumber: jn,
      invoiceNumber: invoiceNumber,
      invoiceDate: new Date().toLocaleDateString('en-GB'),
      dueDate: dueDateStr,
      items: [{ description: svc, qty: 1, price: priceNum.toFixed(2) }],
      subtotal: priceNum,
      grandTotal: amountToInvoice,
      discountAmt: depositPaid > 0 ? depositPaid : 0,
      discountLabel: depositPaid > 0 ? '10% Deposit Already Paid' : '',
      paymentUrl: stripeInvoiceUrl
    });
    trackEmail(custEmail, custName, 'invoice', svc, jn);
  } catch(emailErr) {
    Logger.log('Invoice email error: ' + emailErr);
    notifyBot('moneybot', '\u274c *Invoice Email FAILED*\n\n\ud83d\udc64 ' + custName + '\n\ud83d\udce7 ' + custEmail + '\n\ud83d\udd16 ' + jn + '\n\u274c ' + emailErr);
  }
  
  // Log to Invoices sheet
  try {
    var photos = getJobPhotos(jn);
    var beforeUrls = photos.before.map(function(p) { return p.url; }).join(', ');
    var afterUrls = photos.after.map(function(p) { return p.url; }).join(', ');
    
    logInvoice({
      invoiceNumber: invoiceNumber,
      jobNumber: jn,
      clientName: custName,
      email: custEmail,
      amount: amountToInvoice.toFixed(2),
      status: 'Sent',
      stripeInvoiceId: stripeInvoiceId,
      paymentUrl: stripeInvoiceUrl,
      dateIssued: new Date().toISOString(),
      dueDate: dueDateStr,
      datePaid: '',
      paymentMethod: '',
      beforePhotos: beforeUrls,
      afterPhotos: afterUrls,
      notes: depositPaid > 0 ? 'Deposit \u00a3' + depositPaid.toFixed(2) + ' already paid' : ''
    });
  } catch(logErr) {
    Logger.log('Invoice log error: ' + logErr);
    notifyBot('moneybot', '\u26a0\ufe0f Invoice log error: ' + logErr);
  }
  
  // Mark job as Balance Due
  try { markJobBalanceDue(jn); } catch(e) {}
  
  // Telegram notification
  notifyBot('moneybot', '\ud83e\uddfe *Invoice Sent + Job Completed*\n\n\ud83d\udc64 ' + custName + '\n\ud83d\udce7 ' + custEmail + '\n\ud83d\udccb ' + svc + 
    '\n\ud83d\udcb0 \u00a3' + amountToInvoice.toFixed(2) + (depositPaid > 0 ? ' (deposit \u00a3' + depositPaid.toFixed(2) + ' deducted)' : '') + 
    '\n\ud83d\udd16 ' + jn + '\n\ud83d\udcc4 ' + invoiceNumber + 
    (stripeInvoiceUrl ? '\n\ud83d\udcb3 ' + stripeInvoiceUrl : ''));
}

function updateClientRow(data) {
  var sheet = SpreadsheetApp.openById('1_Y7yHIpAvv_VNBhTrwNOQaBMAGa3UlVW_FKlf56ouHk').getSheetByName('Jobs');
  var rowIndex = data.rowIndex;
  
  if (!rowIndex || rowIndex < 2) {
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'error', message: 'Invalid row index' }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  
  // Read current status BEFORE updating (to detect status changes)
  var previousStatus = String(sheet.getRange(rowIndex, 12).getValue() || '').toLowerCase().trim();
  
  // Update specific columns based on what's provided
  if (data.name !== undefined) sheet.getRange(rowIndex, 3).setValue(data.name);
  if (data.email !== undefined) sheet.getRange(rowIndex, 4).setValue(data.email);
  if (data.phone !== undefined) sheet.getRange(rowIndex, 5).setValue(data.phone);
  if (data.address !== undefined) sheet.getRange(rowIndex, 6).setValue(data.address);
  if (data.postcode !== undefined) sheet.getRange(rowIndex, 7).setValue(data.postcode);
  if (data.service !== undefined) sheet.getRange(rowIndex, 8).setValue(data.service);
  if (data.date !== undefined) sheet.getRange(rowIndex, 9).setValue(data.date);
  if (data.time !== undefined) sheet.getRange(rowIndex, 10).setValue(data.time);
  if (data.preferredDay !== undefined) sheet.getRange(rowIndex, 11).setValue(data.preferredDay);
  if (data.status !== undefined) sheet.getRange(rowIndex, 12).setValue(data.status);
  if (data.price !== undefined) sheet.getRange(rowIndex, 13).setValue(data.price);
  if (data.notes !== undefined) sheet.getRange(rowIndex, 17).setValue(data.notes);
  if (data.paid !== undefined) sheet.getRange(rowIndex, 18).setValue(data.paid);
  
  // Auto-invoice when status changes TO Completed
  if (data.status === 'Completed' && previousStatus !== 'completed' && previousStatus !== 'job completed') {
    try {
      autoInvoiceOnCompletion(sheet, rowIndex);
    } catch(autoErr) {
      Logger.log('Auto-invoice on completion error (updateClientRow): ' + autoErr);
      notifyBot('moneybot', '\u274c *Auto-Invoice Error*\n\n' + autoErr);
    }
  }
  
  return ContentService
    .createTextOutput(JSON.stringify({ status: 'success', message: 'Client updated' }))
    .setMimeType(ContentService.MimeType.JSON);
}


// ============================================
// CRM — UPDATE STATUS / QUICK UPDATE
// ============================================

function updateClientStatus(data) {
  var sheet = SpreadsheetApp.openById('1_Y7yHIpAvv_VNBhTrwNOQaBMAGa3UlVW_FKlf56ouHk').getSheetByName('Jobs');
  var rowIndex = data.rowIndex || data.row;  // Accept both 'rowIndex' and 'row' from Hub
  
  if (!rowIndex || rowIndex < 2) {
    // Fallback: try to find the row by client name if rowIndex is missing
    if (data.name) {
      var allData = sheet.getDataRange().getValues();
      for (var ri = 1; ri < allData.length; ri++) {
        if (String(allData[ri][2]).trim().toLowerCase() === String(data.name).trim().toLowerCase()) {
          rowIndex = ri + 1;
          break;
        }
      }
    }
    if (!rowIndex || rowIndex < 2) {
      return ContentService
        .createTextOutput(JSON.stringify({ status: 'error', message: 'Invalid row index' }))
        .setMimeType(ContentService.MimeType.JSON);
    }
  }
  
  // Read PREVIOUS status BEFORE updating (for auto-invoice detection)
  var previousStatus = String(sheet.getRange(rowIndex, 12).getValue() || '').toLowerCase().trim();
  
  if (data.status) sheet.getRange(rowIndex, 12).setValue(data.status);
  if (data.paid) sheet.getRange(rowIndex, 18).setValue(data.paid);
  if (data.notes) sheet.getRange(rowIndex, 17).setValue(data.notes);
  
  // Auto-generate invoice when status changes TO Completed (skip if was already completed)
  if (data.status === 'Completed' && previousStatus !== 'completed') {
    try {
      autoInvoiceOnCompletion(sheet, rowIndex);
    } catch(autoInvErr) {
      Logger.log('Auto-invoice on completion error: ' + autoInvErr);
    }
  }
  
  // Live Telegram push on every status change
  try {
    var row = sheet.getRange(rowIndex, 1, 1, 20).getValues()[0];
    var name = String(row[2] || '');
    var svc = String(row[7] || '');
    var jn = String(row[19] || '');
    var emoji = '📋';
    if (data.status === 'Completed') emoji = '✅';
    if (data.status === 'Cancelled') emoji = '❌';
    if (data.status === 'In Progress') emoji = '🔧';
    notifyTelegram(emoji + ' *STATUS UPDATE*\n\n👤 ' + name + '\n📋 ' + svc + '\n🔖 ' + jn + '\n📊 → *' + (data.status || 'Updated') + '*');
  } catch(tgErr) {}
  
  return ContentService
    .createTextOutput(JSON.stringify({ status: 'success', message: 'Status updated' }))
    .setMimeType(ContentService.MimeType.JSON);
}


// ── Calculate days until due date ──
function calculateDaysUntilDue(dueDateStr) {
  if (!dueDateStr) return 14;
  var due = new Date(dueDateStr + 'T00:00:00');
  var now = new Date();
  var diff = Math.ceil((due - now) / (1000 * 60 * 60 * 24));
  return Math.max(diff, 1); // minimum 1 day
}


// ============================================
// TESTIMONIALS — VERIFIED CUSTOMER REVIEWS
// ============================================

// Verify if an email exists in the bookings sheet (i.e. is a real customer)
function verifyCustomer(email) {
  if (!email) {
    return ContentService
      .createTextOutput(JSON.stringify({ verified: false }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  
  var sheet = SpreadsheetApp.openById('1_Y7yHIpAvv_VNBhTrwNOQaBMAGa3UlVW_FKlf56ouHk').getSheetByName('Jobs');
  var data = sheet.getDataRange().getValues();
  var emailLower = email.toLowerCase().trim();
  
  // Search for the email in col 4 (index 3)
  for (var i = 1; i < data.length; i++) {
    var rowEmail = String(data[i][3] || '').toLowerCase().trim();
    if (rowEmail === emailLower) {
      var rowStatus = String(data[i][11] || '').toLowerCase();
      // Only verify customers whose booking wasn't cancelled
      if (rowStatus !== 'cancelled' && rowStatus !== 'canceled') {
        return ContentService
          .createTextOutput(JSON.stringify({
            verified: true,
            name: data[i][2] || '',
            location: data[i][6] || '', // postcode column
            service: data[i][7] || ''   // service column
          }))
          .setMimeType(ContentService.MimeType.JSON);
      }
    }
  }
  
  return ContentService
    .createTextOutput(JSON.stringify({ verified: false }))
    .setMimeType(ContentService.MimeType.JSON);
}


// Save a customer testimonial to a "Testimonials" sheet tab
function submitTestimonial(data) {
  var ss = SpreadsheetApp.openById('1_Y7yHIpAvv_VNBhTrwNOQaBMAGa3UlVW_FKlf56ouHk');
  var sheet = ss.getSheetByName('Testimonials');
  
  // Create the Testimonials tab if it doesn't exist
  if (!sheet) {
    sheet = ss.insertSheet('Testimonials');
    sheet.appendRow([
      'Timestamp', 'Name', 'Email', 'Location', 'Service', 'Rating', 'Review', 'Status'
    ]);
    // Bold header row
    sheet.getRange(1, 1, 1, 8).setFontWeight('bold');
  }
  
  // Check they haven't already submitted a review with this email
  var existing = sheet.getDataRange().getValues();
  var emailLower = (data.email || '').toLowerCase().trim();
  for (var i = 1; i < existing.length; i++) {
    if (String(existing[i][2] || '').toLowerCase().trim() === emailLower) {
      return ContentService
        .createTextOutput(JSON.stringify({ success: false, error: 'You have already submitted a review. Thank you!' }))
        .setMimeType(ContentService.MimeType.JSON);
    }
  }
  
  sheet.appendRow([
    new Date().toISOString(),
    data.name || '',
    data.email || '',
    data.location || '',
    data.service || '',
    data.rating || 5,
    data.review || '',
    'pending'   // Admin must change to "approved" for it to show
  ]);
  
  // Notify Telegram — new review to approve
  var stars = '';
  for (var s = 0; s < (data.rating || 5); s++) stars += '⭐';
  notifyBot('contentbot', '📝 *NEW REVIEW SUBMITTED*\n\n' + stars + '\n👤 ' + (data.name || 'Anonymous') + '\n🔧 ' + (data.service || 'General') + '\n\n_"' + ((data.review || '').substring(0, 200)) + '"_\n\n⏳ Status: *Pending approval*\n_Go to your Google Sheet → Testimonials tab to approve_');
  
  return ContentService
    .createTextOutput(JSON.stringify({ success: true }))
    .setMimeType(ContentService.MimeType.JSON);
}


// Return only approved testimonials for the public page
function getApprovedTestimonials() {
  var ss = SpreadsheetApp.openById('1_Y7yHIpAvv_VNBhTrwNOQaBMAGa3UlVW_FKlf56ouHk');
  var sheet = ss.getSheetByName('Testimonials');
  
  if (!sheet) {
    return ContentService
      .createTextOutput(JSON.stringify({ testimonials: [] }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  
  var data = sheet.getDataRange().getValues();
  var testimonials = [];
  
  // Skip header
  for (var i = 1; i < data.length; i++) {
    var status = String(data[i][7] || '').toLowerCase().trim();
    if (status === 'approved') {
      testimonials.push({
        name: data[i][1] || '',
        location: data[i][3] || '',
        service: data[i][4] || '',
        rating: parseInt(data[i][5]) || 5,
        review: data[i][6] || ''
      });
    }
  }
  
  return ContentService
    .createTextOutput(JSON.stringify({ testimonials: testimonials }))
    .setMimeType(ContentService.MimeType.JSON);
}


// ============================================
// BLOG — POST MANAGEMENT
// ============================================

// Get blog posts (filtered by status or all)
function getBlogPosts(filter) {
  var ss = SpreadsheetApp.openById('1_Y7yHIpAvv_VNBhTrwNOQaBMAGa3UlVW_FKlf56ouHk');
  var sheet = ss.getSheetByName('Blog');
  
  if (!sheet) {
    return ContentService
      .createTextOutput(JSON.stringify({ posts: [] }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  
  var data = sheet.getDataRange().getValues();
  var posts = [];
  
  for (var i = 1; i < data.length; i++) {
    var status = String(data[i][7] || '').toLowerCase().trim();
    if (filter === 'published' && status !== 'published') continue;
    
    posts.push({
      id: data[i][0] || '',
      date: data[i][1] || '',
      title: data[i][2] || '',
      category: data[i][3] || '',
      author: data[i][4] || '',
      excerpt: data[i][5] || '',
      content: data[i][6] || '',
      status: status,
      tags: data[i][8] || '',
      socialFb: data[i][9] || '',
      socialIg: data[i][10] || '',
      socialX: data[i][11] || '',
      imageUrl: data[i][12] || ''
    });
  }
  
  return ContentService
    .createTextOutput(JSON.stringify({ posts: posts }))
    .setMimeType(ContentService.MimeType.JSON);
}


// Save (create or update) a blog post
function saveBlogPost(data) {
  var ss = SpreadsheetApp.openById('1_Y7yHIpAvv_VNBhTrwNOQaBMAGa3UlVW_FKlf56ouHk');
  var sheet = ss.getSheetByName('Blog');
  
  // Create Blog tab if it doesn't exist
  if (!sheet) {
    sheet = ss.insertSheet('Blog');
    sheet.appendRow([
      'ID', 'Date', 'Title', 'Category', 'Author', 'Excerpt', 'Content', 'Status', 'Tags', 'Social_FB', 'Social_IG', 'Social_X', 'ImageUrl'
    ]);
    sheet.getRange(1, 1, 1, 13).setFontWeight('bold');
  }
  
  var postId = data.id || '';
  
  // Update existing post — only overwrite fields that are explicitly provided
  if (postId) {
    var allData = sheet.getDataRange().getValues();
    for (var i = 1; i < allData.length; i++) {
      if (String(allData[i][0]) === String(postId)) {
        var rowIndex = i + 1;
        sheet.getRange(rowIndex, 2).setValue(new Date().toISOString());
        if (data.title !== undefined)    sheet.getRange(rowIndex, 3).setValue(data.title);
        if (data.category !== undefined) sheet.getRange(rowIndex, 4).setValue(data.category);
        if (data.author !== undefined)   sheet.getRange(rowIndex, 5).setValue(data.author);
        if (data.excerpt !== undefined)  sheet.getRange(rowIndex, 6).setValue(data.excerpt);
        if (data.content !== undefined)  sheet.getRange(rowIndex, 7).setValue(data.content);
        if (data.status !== undefined)   sheet.getRange(rowIndex, 8).setValue(data.status);
        if (data.tags !== undefined)     sheet.getRange(rowIndex, 9).setValue(data.tags);
        if (data.socialFb !== undefined) sheet.getRange(rowIndex, 10).setValue(data.socialFb);
        if (data.socialIg !== undefined) sheet.getRange(rowIndex, 11).setValue(data.socialIg);
        if (data.socialX !== undefined)  sheet.getRange(rowIndex, 12).setValue(data.socialX);
        
        // Auto-fetch image on update if none provided and none exists
        var updateImageUrl = (data.imageUrl !== undefined) ? data.imageUrl : '';
        if (!updateImageUrl && !String(allData[i][12] || '')) {
          try { var upImg = fetchBlogImage(data.title || String(allData[i][2]), data.category || String(allData[i][3]), data.tags || String(allData[i][8])); updateImageUrl = (typeof upImg === 'object') ? (upImg.url || '') : (upImg || ''); } catch(e) {}
        }
        if (updateImageUrl || data.imageUrl !== undefined) {
          sheet.getRange(rowIndex, 13).setValue(updateImageUrl);
        }
        
        return ContentService
          .createTextOutput(JSON.stringify({ success: true, id: postId }))
          .setMimeType(ContentService.MimeType.JSON);
      }
    }
  }
  
  // Duplicate title check — if a published post with the same title exists, update it instead
  var normalTitle = (data.title || '').trim().toLowerCase();
  if (normalTitle) {
    var existingData = sheet.getDataRange().getValues();
    for (var d = 1; d < existingData.length; d++) {
      if (String(existingData[d][2] || '').trim().toLowerCase() === normalTitle) {
        var dupRow = d + 1;
        Logger.log('saveBlogPost: duplicate title found at row ' + dupRow + ', updating instead of creating');
        sheet.getRange(dupRow, 2).setValue(new Date().toISOString());
        if (data.content !== undefined)  sheet.getRange(dupRow, 7).setValue(data.content);
        if (data.excerpt !== undefined)  sheet.getRange(dupRow, 6).setValue(data.excerpt);
        if (data.category !== undefined) sheet.getRange(dupRow, 4).setValue(data.category);
        if (data.author !== undefined)   sheet.getRange(dupRow, 5).setValue(data.author);
        if (data.status !== undefined)   sheet.getRange(dupRow, 8).setValue(data.status);
        if (data.tags !== undefined)     sheet.getRange(dupRow, 9).setValue(data.tags);
        // Update image if provided or if missing
        var existingImg = String(existingData[d][12] || '');
        var newImg = data.imageUrl || '';
        if (newImg) {
          sheet.getRange(dupRow, 13).setValue(newImg);
        } else if (!existingImg) {
          try { var fetchRes = fetchBlogImage(data.title, data.category, data.tags); var fetchUrl = (typeof fetchRes === 'object') ? fetchRes.url : fetchRes; if (fetchUrl) sheet.getRange(dupRow, 13).setValue(fetchUrl); } catch(e) {}
        }
        return ContentService
          .createTextOutput(JSON.stringify({ success: true, id: String(existingData[d][0]), updated: true }))
          .setMimeType(ContentService.MimeType.JSON);
      }
    }
  }

  // Create new post with unique ID
  var newId = 'post_' + Date.now();
  
  // Auto-fetch image if not provided
  var imageUrl = data.imageUrl || '';
  if (!imageUrl && data.title) {
    try {
      var autoImg = fetchBlogImage(data.title, data.category, data.tags);
      imageUrl = (typeof autoImg === 'object') ? (autoImg.url || '') : (autoImg || '');
    } catch(e) {}
  }
  
  sheet.appendRow([
    newId,
    new Date().toISOString(),
    data.title || '',
    data.category || '',
    data.author || 'Gardners GM',
    data.excerpt || '',
    data.content || '',
    data.status || 'draft',
    data.tags || '',
    data.socialFb || '',
    data.socialIg || '',
    data.socialX || '',
    imageUrl
  ]);
  
  return ContentService
    .createTextOutput(JSON.stringify({ success: true, id: newId }))
    .setMimeType(ContentService.MimeType.JSON);
}


// ============================================
// BLOG — AUTO IMAGE FETCHING (Pexels API)
// ============================================

var PEXELS_API_KEY = '0GXo7KBuIpZmVTWBlpnPqSySwPqteg5HXTpMC8fJrYlBeKuFPV1cACBs';

function fetchBlogImage(title, category, tags, usedUrls) {
  // usedUrls: array of image URLs already in use by other blog posts (for dedup)
  usedUrls = usedUrls || [];

  // --- Build a smarter search query ---
  var searchTerms = [];

  // Richer category terms
  var catTerms = {
    seasonal: 'english garden seasonal flowers',
    tips:     'garden tools lawn care tips',
    projects: 'landscape garden design project',
    news:     'beautiful cottage garden england',
    guides:   'garden guide tutorial outdoors',
    wildlife: 'wildlife garden birds bees nature',
    lawn:     'striped lawn green turf',
    plants:   'colourful garden plants border'
  };
  searchTerms.push(catTerms[category] || 'english cottage garden');

  // Extract meaningful keywords from the title (up to 4 words)
  var STOP_WORDS = ['this','that','with','your','from','have','been','they','will','what',
    'when','more','than','just','also','here','very','some','about','into','over',
    'like','know','need','make','best','good','great','ways','guide','ultimate',
    'essential','tips','tricks','every','should','could','would'];
  var titleWords = (title || '').toLowerCase()
    .replace(/[^a-z\s]/g, '')
    .split(/\s+/)
    .filter(function(w) { return w.length > 3 && STOP_WORDS.indexOf(w) === -1; });
  if (titleWords.length > 0) {
    searchTerms.push(titleWords.slice(0, 4).join(' '));
  }

  // Add first TWO tags for richer context
  if (tags) {
    var tagArr = tags.split(',').map(function(t) { return t.trim(); }).filter(Boolean);
    searchTerms.push(tagArr.slice(0, 2).join(' '));
  }

  var query = searchTerms.join(' ').substring(0, 100);

  // Helper: extract the Pexels photo ID from a URL (for dedup by photo, not just exact URL)
  function pexelsPhotoId(url) {
    var m = (url || '').match(/pexels-photo-(\d+)/);
    return m ? m[1] : url;
  }
  var usedIds = usedUrls.map(pexelsPhotoId);

  // Helper: pick the first photo whose ID isn't already used
  function pickUnused(photos) {
    for (var i = 0; i < photos.length; i++) {
      var url = photos[i].src.landscape || photos[i].src.large || photos[i].src.medium || '';
      var pid = pexelsPhotoId(url);
      if (usedIds.indexOf(pid) === -1) {
        return { url: url, photographer: photos[i].photographer || '', pexelsUrl: photos[i].url || '' };
      }
    }
    return null;
  }

  // --- Primary search (15 results for better dedup pool) ---
  try {
    var response = UrlFetchApp.fetch(
      'https://api.pexels.com/v1/search?query=' + encodeURIComponent(query)
        + '&per_page=15&orientation=landscape',
      { headers: { 'Authorization': PEXELS_API_KEY }, muteHttpExceptions: true }
    );
    var json = JSON.parse(response.getContentText());
    if (json.photos && json.photos.length > 0) {
      var pick = pickUnused(json.photos);
      if (pick) return pick;
    }
  } catch(e) {
    Logger.log('Pexels primary fetch error: ' + e.message);
  }

  // --- Fallback: broader garden query ---
  try {
    var fallback = UrlFetchApp.fetch(
      'https://api.pexels.com/v1/search?query=' + encodeURIComponent('cornwall garden nature landscape')
        + '&per_page=10&orientation=landscape',
      { headers: { 'Authorization': PEXELS_API_KEY }, muteHttpExceptions: true }
    );
    var fbJson = JSON.parse(fallback.getContentText());
    if (fbJson.photos && fbJson.photos.length > 0) {
      var fbPick = pickUnused(fbJson.photos);
      if (fbPick) return fbPick;
      // If ALL are used, at least return the first one (least-harm)
      var p = fbJson.photos[0];
      return { url: p.src.landscape || p.src.large || '', photographer: p.photographer || '', pexelsUrl: p.url || '' };
    }
  } catch(e) {
    Logger.log('Pexels fallback fetch error: ' + e.message);
  }

  // --- Final static fallbacks (ALL unique Pexels photo IDs) ---
  var FALLBACK_IMAGES = {
    seasonal: 'https://images.pexels.com/photos/1002703/pexels-photo-1002703.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200',
    tips:     'https://images.pexels.com/photos/1301856/pexels-photo-1301856.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200',
    projects: 'https://images.pexels.com/photos/1072824/pexels-photo-1072824.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200',
    news:     'https://images.pexels.com/photos/1105019/pexels-photo-1105019.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200',
    guides:   'https://images.pexels.com/photos/589/garden-gardening-grass-lawn.jpg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200',
    wildlife: 'https://images.pexels.com/photos/462118/pexels-photo-462118.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200',
    lawn:     'https://images.pexels.com/photos/589/garden-gardening-grass-lawn.jpg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200',
    plants:   'https://images.pexels.com/photos/60597/dahlia-red-blossom-bloom-60597.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200'
  };
  // 12 UNIQUE seasonal fallback images (no duplicates)
  var SEASONAL_FALLBACKS = [
    'https://images.pexels.com/photos/688903/pexels-photo-688903.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200',   // Jan - frosty winter garden
    'https://images.pexels.com/photos/1002703/pexels-photo-1002703.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200',  // Feb - snowdrops early spring
    'https://images.pexels.com/photos/931177/pexels-photo-931177.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200',   // Mar - spring blooms
    'https://images.pexels.com/photos/1301856/pexels-photo-1301856.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200',  // Apr - flower garden
    'https://images.pexels.com/photos/1105019/pexels-photo-1105019.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200',  // May - lush green
    'https://images.pexels.com/photos/1072824/pexels-photo-1072824.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200',  // Jun - summer border
    'https://images.pexels.com/photos/158028/bellingrath-gardens-702702-702703-702701-158028.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200', // Jul - formal garden
    'https://images.pexels.com/photos/462118/pexels-photo-462118.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200',    // Aug - wildflower meadow
    'https://images.pexels.com/photos/60597/dahlia-red-blossom-bloom-60597.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200', // Sep - autumn dahlia
    'https://images.pexels.com/photos/33109/fall-autumn-red-season.jpg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200',   // Oct - autumn leaves
    'https://images.pexels.com/photos/589/garden-gardening-grass-lawn.jpg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200', // Nov - quiet lawn
    'https://images.pexels.com/photos/699466/pexels-photo-699466.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200'     // Dec - winter robin
  ];

  var month = new Date().getMonth();
  var fb = FALLBACK_IMAGES[category] || SEASONAL_FALLBACKS[month] || SEASONAL_FALLBACKS[0];
  return { url: fb, photographer: '', pexelsUrl: '' };
}

// Route: Fetch image for a blog post (called from editor)
function fetchImageForPost(data) {
  // Collect all image URLs already used by other blog posts for dedup
  var usedUrls = [];
  try {
    var ss = SpreadsheetApp.openById('1_Y7yHIpAvv_VNBhTrwNOQaBMAGa3UlVW_FKlf56ouHk');
    var sheet = ss.getSheetByName('Blog');
    if (sheet) {
      var allData = sheet.getDataRange().getValues();
      for (var i = 1; i < allData.length; i++) {
        var postId = String(allData[i][0] || '');
        var imgUrl = String(allData[i][12] || '').trim();  // Column 13 = index 12
        // Exclude the current post's own image (so refresh can pick a different one)
        if (imgUrl && postId !== String(data.id || '')) {
          usedUrls.push(imgUrl);
        }
      }
    }
  } catch(e) {
    Logger.log('Failed to read used image URLs: ' + e.message);
  }

  // Also accept client-side excluded URLs (e.g. the current image being replaced)
  if (data.excludeUrls && Array.isArray(data.excludeUrls)) {
    usedUrls = usedUrls.concat(data.excludeUrls);
  }

  var result = fetchBlogImage(data.title || '', data.category || '', data.tags || '', usedUrls);

  // result is now {url, photographer, pexelsUrl} or {url: '...', ...} from fallback
  var imageUrl = (typeof result === 'object') ? result.url : result;
  var photographer = (typeof result === 'object') ? (result.photographer || '') : '';
  var pexelsUrl = (typeof result === 'object') ? (result.pexelsUrl || '') : '';

  // If post ID provided, update the sheet
  if (data.id && imageUrl) {
    try {
      var ss2 = SpreadsheetApp.openById('1_Y7yHIpAvv_VNBhTrwNOQaBMAGa3UlVW_FKlf56ouHk');
      var sh = ss2.getSheetByName('Blog');
      if (sh) {
        var rows = sh.getDataRange().getValues();
        for (var j = 1; j < rows.length; j++) {
          if (String(rows[j][0]) === String(data.id)) {
            sh.getRange(j + 1, 13).setValue(imageUrl);
            break;
          }
        }
      }
    } catch(e) {}
  }

  return ContentService
    .createTextOutput(JSON.stringify({
      status: 'success',
      imageUrl: imageUrl,
      photographer: photographer,
      pexelsUrl: pexelsUrl
    }))
    .setMimeType(ContentService.MimeType.JSON);
}


// ── BLOG CLEANUP: Remove duplicate posts + backfill missing images ──
function cleanupBlogPosts() {
  var ss = SpreadsheetApp.openById('1_Y7yHIpAvv_VNBhTrwNOQaBMAGa3UlVW_FKlf56ouHk');
  var sheet = ss.getSheetByName('Blog');
  if (!sheet) return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: 'No Blog sheet' })).setMimeType(ContentService.MimeType.JSON);

  var data = sheet.getDataRange().getValues();
  var seenTitles = {};
  var rowsToDelete = [];
  var backfilled = 0;
  var deduped = 0;

  // Pass 1: Identify duplicates (keep the first occurrence of each title)
  for (var i = 1; i < data.length; i++) {
    var title = String(data[i][2] || '').trim().toLowerCase();
    if (!title) continue;
    if (seenTitles[title] !== undefined) {
      rowsToDelete.push(i + 1);  // 1-indexed sheet row
      deduped++;
    } else {
      seenTitles[title] = i;
    }
  }

  // Delete duplicates (bottom-up to preserve row indices)
  rowsToDelete.sort(function(a, b) { return b - a; });
  for (var d = 0; d < rowsToDelete.length; d++) {
    sheet.deleteRow(rowsToDelete[d]);
  }

  // Pass 2: Backfill missing images (re-read after deletes)
  if (deduped > 0) {
    SpreadsheetApp.flush();
    data = sheet.getDataRange().getValues();
  }

  var usedUrls = [];
  for (var u = 1; u < data.length; u++) {
    var imgUrl = String(data[u][12] || '').trim();
    if (imgUrl) usedUrls.push(imgUrl);
  }

  for (var b = 1; b < data.length; b++) {
    var currentImg = String(data[b][12] || '').trim();
    // Also fix malformed entries (objects serialized as strings)
    var needsImage = !currentImg || !currentImg.match(/^https?:\/\//);
    if (needsImage) {
      var postTitle = String(data[b][2] || '');
      var postCat = String(data[b][3] || '');
      var postTags = String(data[b][8] || '');
      try {
        var imgResult = fetchBlogImage(postTitle, postCat, postTags, usedUrls);
        var fetchedUrl = (typeof imgResult === 'object') ? imgResult.url : imgResult;
        if (fetchedUrl) {
          sheet.getRange(b + 1, 13).setValue(fetchedUrl);
          usedUrls.push(fetchedUrl);
          backfilled++;
        }
      } catch(e) {
        Logger.log('Backfill failed for row ' + (b + 1) + ': ' + e);
      }
    }
  }

  return ContentService.createTextOutput(JSON.stringify({
    status: 'success', duplicatesRemoved: deduped, imagesBackfilled: backfilled
  })).setMimeType(ContentService.MimeType.JSON);
}


// ============================================
// FACEBOOK PAGE AUTO-POSTING (Meta Graph API)
// ============================================

/**
 * Post to the Facebook Business Page via the Meta Graph API.
 * Requires FB_PAGE_ACCESS_TOKEN and FB_PAGE_ID stored in the Settings sheet.
 *
 * data: { title, excerpt, blogUrl, imageUrl, tags, message }
 */
function postToFacebookPage(data) {
  // Read FB credentials from Settings sheet
  var ss = SpreadsheetApp.openById('1_Y7yHIpAvv_VNBhTrwNOQaBMAGa3UlVW_FKlf56ouHk');
  var settingsSheet = ss.getSheetByName('Settings');
  var fbToken = '';
  var fbPageId = '';

  if (settingsSheet) {
    var settingsData = settingsSheet.getDataRange().getValues();
    for (var i = 1; i < settingsData.length; i++) {
      var key = String(settingsData[i][0] || '').trim();
      var val = String(settingsData[i][1] || '').trim();
      if (key === 'FB_PAGE_ACCESS_TOKEN') fbToken = val;
      if (key === 'FB_PAGE_ID') fbPageId = val;
    }
  }

  if (!fbToken || !fbPageId) {
    return ContentService
      .createTextOutput(JSON.stringify({
        success: false,
        error: 'Facebook not configured. Add FB_PAGE_ACCESS_TOKEN and FB_PAGE_ID to the Settings sheet.'
      }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  // Build post message
  var message = data.message || '';
  if (!message) {
    var title = data.title || 'New Blog Post';
    var excerpt = data.excerpt || '';
    var blogUrl = data.blogUrl || '';
    var tags = data.tags || '';

    // Build hashtags
    var hashtags = '#CornwallGardening #GardnersGM #GardenMaintenance';
    if (tags) {
      var tagArr = tags.split(',').map(function(t) { return '#' + t.trim().replace(/\s+/g, ''); }).filter(Boolean);
      if (tagArr.length > 0) hashtags = tagArr.slice(0, 5).join(' ');
    }

    message = title + '\n\n';
    if (excerpt) message += excerpt + '\n\n';
    if (blogUrl) message += 'Read the full article: ' + blogUrl + '\n\n';
    message += 'Need help with your garden in Cornwall? Book online at www.gardnersgm.co.uk \uD83C\uDF3F\n\n';
    message += hashtags;
  }

  var imageUrl = data.imageUrl || '';

  try {
    var endpoint, payload;

    if (imageUrl) {
      // Photo post (better engagement)
      endpoint = 'https://graph.facebook.com/v19.0/' + fbPageId + '/photos';
      payload = {
        'url': imageUrl,
        'message': message,
        'access_token': fbToken
      };
    } else {
      // Text/link post
      endpoint = 'https://graph.facebook.com/v19.0/' + fbPageId + '/feed';
      payload = {
        'message': message,
        'access_token': fbToken
      };
      if (data.blogUrl) payload['link'] = data.blogUrl;
    }

    var resp = UrlFetchApp.fetch(endpoint, {
      method: 'post',
      payload: payload,
      muteHttpExceptions: true
    });

    var result = JSON.parse(resp.getContentText());

    if (result.id || result.post_id) {
      Logger.log('Facebook post created: ' + (result.id || result.post_id));
      return ContentService
        .createTextOutput(JSON.stringify({
          success: true,
          postId: result.id || result.post_id
        }))
        .setMimeType(ContentService.MimeType.JSON);
    } else {
      var errMsg = (result.error && result.error.message) ? result.error.message : JSON.stringify(result);
      Logger.log('Facebook post failed: ' + errMsg);
      return ContentService
        .createTextOutput(JSON.stringify({
          success: false,
          error: errMsg
        }))
        .setMimeType(ContentService.MimeType.JSON);
    }
  } catch(e) {
    Logger.log('Facebook post exception: ' + e.message);
    return ContentService
      .createTextOutput(JSON.stringify({
        success: false,
        error: e.message
      }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}


// Delete a blog post by ID
function deleteBlogPost(data) {
  var ss = SpreadsheetApp.openById('1_Y7yHIpAvv_VNBhTrwNOQaBMAGa3UlVW_FKlf56ouHk');
  var sheet = ss.getSheetByName('Blog');
  
  if (!sheet || !data.id) {
    return ContentService
      .createTextOutput(JSON.stringify({ success: false, error: 'Post not found' }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  
  var allData = sheet.getDataRange().getValues();
  for (var i = 1; i < allData.length; i++) {
    if (String(allData[i][0]) === String(data.id)) {
      sheet.deleteRow(i + 1);
      return ContentService
        .createTextOutput(JSON.stringify({ success: true }))
        .setMimeType(ContentService.MimeType.JSON);
    }
  }
  
  return ContentService
    .createTextOutput(JSON.stringify({ success: false, error: 'Post not found' }))
    .setMimeType(ContentService.MimeType.JSON);
}


// Generic delete-row helper — deletes row N from a named sheet tab
function deleteSheetRow(tabName, rowNumber) {
  try {
    if (!rowNumber || rowNumber < 2) {
      return ContentService
        .createTextOutput(JSON.stringify({ success: false, error: 'Invalid row number' }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    var ss = SpreadsheetApp.openById('1_Y7yHIpAvv_VNBhTrwNOQaBMAGa3UlVW_FKlf56ouHk');
    var sheet = ss.getSheetByName(tabName);
    if (!sheet) {
      return ContentService
        .createTextOutput(JSON.stringify({ success: false, error: 'Sheet not found: ' + tabName }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    if (rowNumber > sheet.getLastRow()) {
      return ContentService
        .createTextOutput(JSON.stringify({ success: false, error: 'Row out of range' }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    sheet.deleteRow(rowNumber);
    return ContentService
      .createTextOutput(JSON.stringify({ success: true }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ success: false, error: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}


// Delete a job row by matching name (col C) + email (col D)
function deleteJobByName(name, email) {
  try {
    var ss = SpreadsheetApp.openById('1_Y7yHIpAvv_VNBhTrwNOQaBMAGa3UlVW_FKlf56ouHk');
    var sheet = ss.getSheetByName('Jobs');
    if (!sheet) {
      return ContentService.createTextOutput(JSON.stringify({ success: false, error: 'Jobs sheet not found' }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    var data = sheet.getDataRange().getValues();
    for (var i = data.length - 1; i >= 1; i--) {
      var rowName = String(data[i][2] || '').trim().toLowerCase();
      var rowEmail = String(data[i][3] || '').trim().toLowerCase();
      if (rowName === String(name).trim().toLowerCase() &&
          (!email || rowEmail === String(email).trim().toLowerCase())) {
        sheet.deleteRow(i + 1);
        return ContentService.createTextOutput(JSON.stringify({ success: true }))
          .setMimeType(ContentService.MimeType.JSON);
      }
    }
    return ContentService.createTextOutput(JSON.stringify({ success: false, error: 'Client not found: ' + name }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ success: false, error: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}


// Delete a row by matching a value in a specific column (0-indexed)
function deleteRowByColumn(tabName, colIndex, value) {
  try {
    var ss = SpreadsheetApp.openById('1_Y7yHIpAvv_VNBhTrwNOQaBMAGa3UlVW_FKlf56ouHk');
    var sheet = ss.getSheetByName(tabName);
    if (!sheet) {
      return ContentService.createTextOutput(JSON.stringify({ success: false, error: 'Sheet not found: ' + tabName }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    var data = sheet.getDataRange().getValues();
    for (var i = data.length - 1; i >= 1; i--) {
      if (String(data[i][colIndex]).trim() === String(value).trim()) {
        sheet.deleteRow(i + 1);
        return ContentService.createTextOutput(JSON.stringify({ success: true }))
          .setMimeType(ContentService.MimeType.JSON);
      }
    }
    return ContentService.createTextOutput(JSON.stringify({ success: false, error: 'Row not found with ' + value + ' in ' + tabName }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ success: false, error: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}


// ============================================
// BUSINESS COSTS (Profitability Tracker)
// ============================================

function getBusinessCosts() {
  var ss = SpreadsheetApp.openById('1_Y7yHIpAvv_VNBhTrwNOQaBMAGa3UlVW_FKlf56ouHk');
  var sheet = ss.getSheetByName('Business Costs');
  
  if (!sheet) {
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'success', costs: [] }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  
  var data = sheet.getDataRange().getValues();
  var costs = [];
  
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (!row[0]) continue;
    costs.push({
      month:            String(row[0]),
      vehicleInsurance: Number(row[1]) || 0,
      publicLiability:  Number(row[2]) || 0,
      equipmentMaint:   Number(row[3]) || 0,
      vehicleMaint:     Number(row[4]) || 0,
      fuelRate:         Number(row[5]) || 0.45,
      marketing:        Number(row[6]) || 0,
      natInsurance:     Number(row[7]) || 0,
      incomeTax:        Number(row[8]) || 0,
      phoneInternet:    Number(row[9]) || 0,
      software:         Number(row[10]) || 0,
      accountancy:      Number(row[11]) || 0,
      other:            Number(row[12]) || 0,
      notes:            String(row[13] || ''),
      wasteDisposal:    Number(row[14]) || 0,
      treatmentProducts:Number(row[15]) || 0,
      consumables:      Number(row[16]) || 0
    });
  }
  
  return ContentService
    .createTextOutput(JSON.stringify({ status: 'success', costs: costs }))
    .setMimeType(ContentService.MimeType.JSON);
}

function saveBusinessCosts(data) {
  var ss = SpreadsheetApp.openById('1_Y7yHIpAvv_VNBhTrwNOQaBMAGa3UlVW_FKlf56ouHk');
  var sheet = ss.getSheetByName('Business Costs');
  
  // Auto-create the tab with headers if it doesn't exist
  if (!sheet) {
    sheet = ss.insertSheet('Business Costs');
    sheet.appendRow([
      'Month', 'Vehicle Insurance', 'Public Liability', 'Equipment Maint',
      'Vehicle Maint', 'Fuel Rate/Mile', 'Marketing', 'National Insurance',
      'Income Tax', 'Phone/Internet', 'Software', 'Accountancy', 'Other', 'Notes',
      'Waste Disposal', 'Treatment Products', 'Consumables'
    ]);
    sheet.getRange(1, 1, 1, 17).setFontWeight('bold');
  }
  
  var month = String(data.month || '');
  if (!month) {
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'error', error: 'Month is required' }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  
  var rowData = [
    month,
    Number(data.vehicleInsurance) || 0,
    Number(data.publicLiability) || 0,
    Number(data.equipmentMaint) || 0,
    Number(data.vehicleMaint) || 0,
    Number(data.fuelRate) || 0.45,
    Number(data.marketing) || 0,
    Number(data.natInsurance) || 0,
    Number(data.incomeTax) || 0,
    Number(data.phoneInternet) || 0,
    Number(data.software) || 0,
    Number(data.accountancy) || 0,
    Number(data.other) || 0,
    String(data.notes || ''),
    Number(data.wasteDisposal) || 0,
    Number(data.treatmentProducts) || 0,
    Number(data.consumables) || 0
  ];
  
  // Check if month row already exists — update it
  var allData = sheet.getDataRange().getValues();
  var found = false;
  for (var i = 1; i < allData.length; i++) {
    if (String(allData[i][0]) === month) {
      sheet.getRange(i + 1, 1, 1, 17).setValues([rowData]);
      found = true;
      break;
    }
  }
  
  if (!found) {
    sheet.appendRow(rowData);
  }
  
  return ContentService
    .createTextOutput(JSON.stringify({ status: 'success', message: 'Business costs saved for ' + month }))
    .setMimeType(ContentService.MimeType.JSON);
}


// ===== EMAIL & NEWSLETTER SYSTEM =====


// ============================================
// JOB COMPLETION EMAIL + REVIEW REQUEST
// ============================================

function sendCompletionEmail(data) {
  // Hub owns completion emails — only proceed if called via Hub send_email action
  // (data._fromHub is set by the Hub's GAS fallback path)
  if (HUB_OWNS_EMAILS && !data._fromHub) {
    Logger.log('sendCompletionEmail: skipped (HUB_OWNS_EMAILS=true) for ' + (data.email || ''));
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'skipped', reason: 'HUB_OWNS_EMAILS' }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  if (!data.email) {
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'error', error: 'No email provided' }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  
  var name = data.name || 'Valued Customer';
  var firstName = name.split(' ')[0];
  var service = data.service || 'your service';
  var svcKey = service.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  var content = AFTERCARE_CONTENT[svcKey];
  var svc = getServiceContent(service);
  var svcIcon = svc ? svc.icon : (content ? content.icon : '✅');
  var svcName = svc ? svc.name : service;
  var completionNote = svc ? svc.completionNote : '';
  
  // Build the completion email with integrated aftercare
  var subject = '✅ ' + svcName + ' Complete — ' + (data.jobNumber || '') + ' | Gardners GM';
  
  // Service-personalised completion message
  var completionHtml = '';
  if (completionNote) {
    completionHtml = '<div style="border-left:4px solid #4CAF50;padding:12px 18px;background:#f8faf8;margin:15px 0;border-radius:0 8px 8px 0;">'
      + '<p style="color:#2E7D32;font-weight:600;margin:0;font-size:15px;">' + svcIcon + ' ' + completionNote + '</p></div>';
  }
  
  var aftercareTipsHtml = '';
  if (content && content.tips) {
    aftercareTipsHtml = '<div style="background:#fff;border:1px solid #E8F5E9;border-radius:10px;overflow:hidden;margin:20px 0;">'
      + '<div style="background:#2E7D32;padding:10px 15px;"><h3 style="color:#fff;margin:0;font-size:15px;">' + (content.icon || '🌿') + ' ' + (content.title || 'Aftercare Guide') + '</h3></div>';
    for (var t = 0; t < content.tips.length; t++) {
      var bg = t % 2 === 0 ? '#fff' : '#F1F8E9';
      aftercareTipsHtml += '<div style="padding:10px 15px;background:' + bg + ';border-bottom:1px solid #E8F5E9;">'
        + '<span style="color:#2E7D32;font-weight:700;margin-right:6px;">✓</span>'
        + '<span style="color:#444;font-size:14px;">' + content.tips[t] + '</span></div>';
    }
    aftercareTipsHtml += '</div>';
    if (content.nextSteps) {
      aftercareTipsHtml += '<div style="border-left:4px solid #4CAF50;padding:12px 18px;background:#f8faf8;margin:15px 0;border-radius:0 8px 8px 0;">'
        + '<p style="color:#333;font-weight:600;margin:0 0 4px;">What\'s Next?</p>'
        + '<p style="color:#555;font-size:14px;margin:0;">' + content.nextSteps + '</p></div>';
    }
  }
  
  // Rebook CTA
  var rebookText = svc ? svc.rebookCta : 'Book Again';
  
  // Get before/after photos if job number provided
  var photosHtml = '';
  if (data.jobNumber) {
    try {
      var photos = getJobPhotos(data.jobNumber);
      if (photos.before.length > 0 || photos.after.length > 0) {
        photosHtml = '<div style="margin:20px 0;padding:16px;background:#f5f9f5;border-radius:8px;">'
          + '<h3 style="color:#2E7D32;margin:0 0 12px 0;font-size:15px;">📸 Your Job Photos</h3>';
        if (photos.before.length > 0) {
          photosHtml += '<p style="font-weight:600;margin:8px 0 4px;color:#666;">Before:</p>'
            + '<div style="text-align:center;">';
          photos.before.forEach(function(p) {
            photosHtml += '<a href="' + p.url + '" style="display:inline-block;margin:4px;">'
              + '<img src="' + p.url + '" style="width:200px;height:140px;object-fit:cover;border-radius:6px;border:2px solid #ddd;" alt="Before"></a>';
          });
          photosHtml += '</div>';
        }
        if (photos.after.length > 0) {
          photosHtml += '<p style="font-weight:600;margin:12px 0 4px;color:#666;">After:</p>'
            + '<div style="text-align:center;">';
          photos.after.forEach(function(p) {
            photosHtml += '<a href="' + p.url + '" style="display:inline-block;margin:4px;">'
              + '<img src="' + p.url + '" style="width:200px;height:140px;object-fit:cover;border-radius:6px;border:2px solid #2E7D32;" alt="After"></a>';
          });
          photosHtml += '</div>';
        }
        photosHtml += '</div>';
      }
    } catch(photoErr) { Logger.log('Completion email photo error: ' + photoErr); }
  }
  
  var unsubUrl = WEBHOOK_URL + '?action=unsubscribe_service&email=' + encodeURIComponent(data.email);
  
  var htmlBody = '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:0;background:#f0f2f5;font-family:Georgia,\'Times New Roman\',serif;">'
    + '<div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.08);">'
    + getGgmEmailHeader({ title: svcIcon + ' ' + svcName + ' Complete!', gradient: '#2E7D32', gradientEnd: '#1B5E20' })
    + '<div style="padding:25px 20px;">'
    + '<h2 style="color:#333;margin:0 0 10px;">Hi ' + firstName + ',</h2>'
    + '<p style="color:#555;line-height:1.6;">Your <strong>' + svcName + '</strong>' + (data.jobNumber ? ' (' + data.jobNumber + ')' : '') + ' has been completed. We hope you\'re happy with the results!</p>'
    + completionHtml
    + aftercareTipsHtml
    + photosHtml
    // Review CTA
    + '<div style="background:#f8fdf8;border:1px solid #C8E6C9;border-radius:8px;padding:15px;margin:20px 0;text-align:center;">'
    + '<p style="color:#333;font-weight:600;margin:0 0 10px;">How did we do? ⭐</p>'
    + '<p style="color:#555;font-size:14px;margin:0 0 15px;">Your feedback helps our small business grow.</p>'
    + '<a href="https://gardnersgm.co.uk/testimonials.html" style="display:inline-block;background:#2E7D32;color:#fff;padding:12px 30px;text-decoration:none;border-radius:8px;font-weight:600;">Leave a Review</a></div>'
    // Rebook CTA
    + '<div style="background:linear-gradient(135deg,#E8F5E9,#C8E6C9);border-radius:8px;padding:20px;text-align:center;margin:20px 0;">'
    + '<p style="color:#2E7D32;font-weight:700;margin:0 0 8px;font-size:15px;">Ready to book again?</p>'
    + '<a href="https://gardnersgm.co.uk/booking.html" style="display:inline-block;background:#2E7D32;color:#fff;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px;">' + rebookText + '</a></div>'
    + '<p style="color:#555;line-height:1.6;">If anything needs attention, just get in touch — we\'re always happy to help.</p>'
    + '</div>'
    + getGgmEmailFooter(data.email)
    + '</div></body></html>';
  
  try {
    sendEmail({
      to: data.email,
      toName: '',
      subject: subject,
      htmlBody: htmlBody,
      name: 'Gardners Ground Maintenance',
      replyTo: 'info@gardnersgm.co.uk'
    });
    logEmailSent(data.email, name, 'completion', service, data.jobNumber || '', subject);
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'success', message: 'Completion email sent to ' + data.email }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (e) {
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'error', error: e.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}


// ============================================
// SUBSCRIBER VISIT SUMMARY EMAIL + CALENDAR
// ============================================
// Sent after a subscription visit is completed — includes visit summary,
// before/after photos, next visit date, and .ics calendar invite attachment.

function sendSubscriberVisitSummary(visitData) {
  if (!visitData.email) return;
  
  var firstName = (visitData.name || 'Valued Customer').split(' ')[0];
  var service = visitData.service || 'Subscription Visit';
  var svc = getServiceContent(service);
  var svcIcon = svc ? svc.icon : '📦';
  var svcName = svc ? svc.name : service;
  var packageName = visitData.packageName || 'Subscription';
  var jobNumber = visitData.jobNumber || '';
  var visitDateStr = visitData.visitDate || new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  
  // Get next visit date from Schedule
  var nextVisit = null;
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var schedSheet = ss.getSheetByName('Schedule');
    if (schedSheet) {
      var schedData = schedSheet.getDataRange().getValues();
      var today = new Date();
      today.setHours(0, 0, 0, 0);
      for (var v = 1; v < schedData.length; v++) {
        if (String(schedData[v][2] || '').toLowerCase().trim() !== visitData.email.toLowerCase().trim()) continue;
        var vStatus = String(schedData[v][9] || '').toLowerCase();
        if (vStatus === 'cancelled' || vStatus === 'completed' || vStatus === 'skipped') continue;
        var vDate = schedData[v][0] instanceof Date ? schedData[v][0] : new Date(String(schedData[v][0]));
        if (isNaN(vDate.getTime())) continue;
        if (vDate > today) {
          nextVisit = {
            date: vDate,
            dateStr: Utilities.formatDate(vDate, Session.getScriptTimeZone(), 'EEEE d MMMM yyyy'),
            service: String(schedData[v][6] || schedData[v][7] || 'Subscription Visit'),
            address: String(schedData[v][4] || visitData.address || ''),
            postcode: String(schedData[v][5] || visitData.postcode || '')
          };
          break;
        }
      }
    }
  } catch(schedErr) { Logger.log('Next visit lookup error: ' + schedErr); }
  
  // Build photos section
  var photosHtml = '';
  if (jobNumber) {
    try {
      var photos = getJobPhotos(jobNumber);
      if (photos.before.length > 0 || photos.after.length > 0) {
        photosHtml = '<div style="margin:20px 0;padding:16px;background:#f5f9f5;border-radius:8px;">'
          + '<h3 style="color:#2E7D32;margin:0 0 12px 0;font-size:15px;">📸 Today\'s Visit Photos</h3>';
        if (photos.before.length > 0 && photos.after.length > 0) {
          // Side-by-side before/after
          photosHtml += '<table style="width:100%;border-collapse:collapse;"><tr>'
            + '<td style="width:50%;padding:4px;text-align:center;vertical-align:top;">'
            + '<p style="font-weight:600;margin:0 0 4px;color:#999;font-size:12px;">BEFORE</p>';
          photos.before.forEach(function(p) {
            photosHtml += '<img src="' + p.url + '" style="width:100%;max-width:220px;height:auto;border-radius:6px;border:2px solid #ddd;" alt="Before">';
          });
          photosHtml += '</td><td style="width:50%;padding:4px;text-align:center;vertical-align:top;">'
            + '<p style="font-weight:600;margin:0 0 4px;color:#2E7D32;font-size:12px;">AFTER ✨</p>';
          photos.after.forEach(function(p) {
            photosHtml += '<img src="' + p.url + '" style="width:100%;max-width:220px;height:auto;border-radius:6px;border:2px solid #2E7D32;" alt="After">';
          });
          photosHtml += '</td></tr></table>';
        } else {
          // Just one type
          var photoList = photos.after.length > 0 ? photos.after : photos.before;
          var label = photos.after.length > 0 ? 'After ✨' : 'Before';
          photosHtml += '<p style="font-weight:600;margin:4px 0;color:#666;">' + label + '</p><div style="text-align:center;">';
          photoList.forEach(function(p) {
            photosHtml += '<img src="' + p.url + '" style="width:200px;height:auto;border-radius:6px;margin:4px;" alt="Photo">';
          });
          photosHtml += '</div>';
        }
        photosHtml += '</div>';
      }
    } catch(pErr) { Logger.log('Visit summary photo error: ' + pErr); }
  }
  
  // Build next visit section
  var nextVisitHtml = '';
  if (nextVisit) {
    nextVisitHtml = '<div style="background:linear-gradient(135deg,#E8F5E9,#C8E6C9);border-radius:8px;padding:20px;margin:20px 0;">'
      + '<h3 style="color:#1B5E20;margin:0 0 10px;font-size:15px;">📅 Your Next Visit</h3>'
      + '<p style="margin:0;font-size:16px;font-weight:600;color:#2E7D32;">' + nextVisit.dateStr + '</p>'
      + '<p style="margin:4px 0 0;color:#555;font-size:13px;">' + nextVisit.service + (nextVisit.address ? ' at ' + nextVisit.address : '') + '</p>'
      + '<p style="margin:10px 0 0;font-size:12px;color:#888;">📎 A calendar invite is attached — add it to your phone!</p>'
      + '</div>';
  }
  
  // Chatbot CTA for subscription management
  var chatbotHtml = '<div style="background:#f0f7ff;border:1px solid #bbdefb;border-radius:8px;padding:16px;margin:20px 0;text-align:center;">'
    + '<p style="color:#1565C0;font-weight:600;margin:0 0 8px;font-size:14px;">💬 Want to customise your next visit?</p>'
    + '<p style="color:#555;font-size:13px;margin:0 0 12px;">Use our chatbot to change your preferred day, add extra services, or leave a note for Chris.</p>'
    + '<a href="https://gardnersgm.co.uk" style="display:inline-block;background:#1565C0;color:#fff;padding:10px 24px;border-radius:6px;text-decoration:none;font-weight:600;font-size:13px;">Open Chatbot</a>'
    + '<p style="color:#999;font-size:11px;margin:8px 0 0;">Your subscription code: <strong>' + (jobNumber || 'check your booking email') + '</strong></p></div>';
  
  var subject = svcIcon + ' Visit Complete — ' + packageName + ' | Gardners GM';
  var unsubUrl = WEBHOOK_URL + '?action=unsubscribe_service&email=' + encodeURIComponent(visitData.email);
  
  var htmlBody = '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:0;background:#f4f7f4;font-family:Arial,Helvetica,sans-serif;">'
    + '<div style="max-width:600px;margin:0 auto;background:#ffffff;">'
    + '<div style="background:linear-gradient(135deg,#2E7D32,#1B5E20);padding:30px;text-align:center;">'
    + '<h1 style="color:#fff;margin:0;font-size:22px;">' + svcIcon + ' Visit Complete!</h1>'
    + '<p style="color:#C8E6C9;margin:5px 0 0;">' + packageName + ' — Gardners Ground Maintenance</p></div>'
    + '<div style="padding:25px 20px;">'
    + '<h2 style="color:#333;margin:0 0 10px;">Hi ' + firstName + ',</h2>'
    + '<p style="color:#555;line-height:1.6;">Your ' + svcName + ' visit on <strong>' + visitDateStr + '</strong> has been completed.' + (jobNumber ? ' (Ref: ' + jobNumber + ')' : '') + '</p>'
    + '<p style="color:#555;line-height:1.6;">We hope everything looks great! Here\'s a summary of today\'s visit.</p>'
    + photosHtml
    + nextVisitHtml
    + chatbotHtml
    // Review CTA
    + '<div style="background:#f8fdf8;border:1px solid #C8E6C9;border-radius:8px;padding:15px;margin:20px 0;text-align:center;">'
    + '<p style="color:#333;font-weight:600;margin:0 0 10px;">How did we do? ⭐</p>'
    + '<p style="color:#555;font-size:14px;margin:0 0 15px;">Your feedback helps our small business grow.</p>'
    + '<a href="https://gardnersgm.co.uk/testimonials.html" style="display:inline-block;background:#2E7D32;color:#fff;padding:12px 30px;text-decoration:none;border-radius:8px;font-weight:600;">Leave a Review</a></div>'
    + '<p style="color:#555;line-height:1.6;">If anything needs attention, just get in touch — we\'re always happy to help.</p>'
    + '<p style="color:#555;line-height:1.6;margin-top:15px;"><a href="https://gardnersgm.co.uk/my-account.html" style="color:#2E7D32;font-weight:600;">Manage your subscription →</a></p>'
    + '</div>'
    + '<div style="background:#333;padding:20px;text-align:center;">'
    + '<p style="color:#aaa;font-size:12px;margin:0 0 5px;">Gardners Ground Maintenance</p>'
    + '<p style="color:#888;font-size:11px;margin:0 0 5px;">📞 01726 432051 | ✉️ info@gardnersgm.co.uk</p>'
    + '<p style="color:#888;font-size:11px;margin:0 0 8px;">Roche, Cornwall PL26 8HN</p>'
    + '<a href="' + unsubUrl + '" style="color:#999;font-size:10px;text-decoration:underline;">Unsubscribe from service emails</a>'
    + '</div></div></body></html>';
  
  // Build .ics calendar invite for next visit
  var attachments = [];
  if (nextVisit) {
    try {
      var icsStart = Utilities.formatDate(nextVisit.date, Session.getScriptTimeZone(), "yyyyMMdd'T'090000");
      var icsEnd = Utilities.formatDate(nextVisit.date, Session.getScriptTimeZone(), "yyyyMMdd'T'120000");
      var uid = 'ggm-' + (jobNumber || 'visit') + '-' + icsStart + '@gardnersgm.co.uk';
      var location = (nextVisit.address || '') + (nextVisit.postcode ? ', ' + nextVisit.postcode : '');
      
      var icsContent = 'BEGIN:VCALENDAR\r\n'
        + 'VERSION:2.0\r\n'
        + 'PRODID:-//Gardners GM//Visit//EN\r\n'
        + 'CALSCALE:GREGORIAN\r\n'
        + 'METHOD:PUBLISH\r\n'
        + 'BEGIN:VEVENT\r\n'
        + 'UID:' + uid + '\r\n'
        + 'DTSTART:' + icsStart + '\r\n'
        + 'DTEND:' + icsEnd + '\r\n'
        + 'SUMMARY:🌿 Gardners GM — ' + nextVisit.service + '\r\n'
        + 'DESCRIPTION:Your next garden maintenance visit from Gardners Ground Maintenance.\\n\\nService: ' + nextVisit.service + '\\nContact: 01726 432051\\nRef: ' + (jobNumber || '') + '\r\n'
        + (location ? 'LOCATION:' + location.replace(/,/g, '\\,') + '\r\n' : '')
        + 'STATUS:CONFIRMED\r\n'
        + 'BEGIN:VALARM\r\n'
        + 'TRIGGER:-PT1H\r\n'
        + 'ACTION:DISPLAY\r\n'
        + 'DESCRIPTION:Gardners GM visit today!\r\n'
        + 'END:VALARM\r\n'
        + 'END:VEVENT\r\n'
        + 'END:VCALENDAR';
      
      attachments.push(Utilities.newBlob(icsContent, 'text/calendar', 'next-visit.ics'));
    } catch(icsErr) { Logger.log('ICS creation error: ' + icsErr); }
  }
  
  try {
    var emailOpts = {
      to: visitData.email,
      subject: subject,
      htmlBody: htmlBody,
      name: 'Gardners Ground Maintenance',
      replyTo: 'info@gardnersgm.co.uk'
    };
    if (attachments.length > 0) emailOpts.attachments = attachments;
    sendEmail(emailOpts);
    logEmailSent(visitData.email, visitData.name, 'visit-summary', service, jobNumber, subject);
    Logger.log('Subscriber visit summary sent to ' + visitData.email + (nextVisit ? ' — next visit: ' + nextVisit.dateStr : ''));
  } catch(emailErr) {
    Logger.log('Visit summary email error: ' + emailErr);
  }
}


// ============================================
// BOOKING CONFIRMATION EMAIL
// ============================================

function sendBookingConfirmation(data) {
  if (!data.email) return;
  
  var isSubscription = (data.type === 'subscription');
  var isPayLater = (data.paymentType === 'pay-later');
  var isPayNow = (data.paymentType === 'pay-now' || data.type === 'booking-payment');
  var svc = getServiceContent(data.service);
  var svcIcon = svc ? svc.icon : '🌿';
  var svcName = svc ? svc.name : (data.service || 'General Service');
  
  var subject = isSubscription 
    ? '✅ Subscription Confirmed — ' + svcName + ' | Gardners GM'
    : '✅ Booking Confirmed — ' + svcName + ' | Gardners GM';
  
  var dateDisplay = data.date || 'To be confirmed';
  var timeDisplay = data.time || '';
  var priceDisplay = data.price ? '£' + data.price : '';
  var firstName = (data.name || 'there').split(' ')[0];
  
  var scheduleHtml = '';
  if (isSubscription) {
    scheduleHtml = '<tr><td style="padding:10px 15px;color:#666;font-weight:600;width:140px;">Start Date</td><td style="padding:10px 15px;">' + dateDisplay + '</td></tr>';
    if (data.preferredDay) {
      scheduleHtml += '<tr><td style="padding:10px 15px;color:#666;font-weight:600;">Preferred Day</td><td style="padding:10px 15px;">' + data.preferredDay + '</td></tr>';
    }
  } else {
    scheduleHtml = '<tr><td style="padding:10px 15px;color:#666;font-weight:600;width:140px;">Date</td><td style="padding:10px 15px;">' + dateDisplay + '</td></tr>';
    if (timeDisplay) {
      scheduleHtml += '<tr><td style="padding:10px 15px;color:#666;font-weight:600;">Time</td><td style="padding:10px 15px;">' + timeDisplay + '</td></tr>';
    }
  }
  
  // Service-specific "What to Expect" section
  var expectHtml = '';
  if (svc && svc.whatToExpect) {
    expectHtml = '<div style="border-left:4px solid #4CAF50;padding:15px 20px;background:#f8faf8;margin:20px 0;border-radius:0 8px 8px 0;">'
      + '<h3 style="color:#2E7D32;margin:0 0 8px;font-size:15px;">' + svcIcon + ' What to Expect — ' + svcName + '</h3>'
      + '<ul style="color:#555;line-height:1.8;margin:0;padding-left:18px;font-size:14px;">';
    for (var i = 0; i < svc.whatToExpect.length; i++) {
      expectHtml += '<li>' + svc.whatToExpect[i] + '</li>';
    }
    expectHtml += '</ul></div>';
  } else {
    expectHtml = '<div style="border-left:4px solid #4CAF50;padding:15px 20px;background:#f8faf8;margin:20px 0;border-radius:0 8px 8px 0;">'
      + '<h3 style="color:#2E7D32;margin:0 0 8px;font-size:15px;">🌱 What to Expect</h3>'
      + '<ul style="color:#555;line-height:1.8;margin:0;padding-left:18px;font-size:14px;">'
      + (isSubscription 
          ? '<li>Your first visit will be scheduled around your start date</li><li>We\'ll arrive on your preferred day each cycle</li><li>You\'ll receive a reminder before each visit</li><li>Manage or cancel your subscription anytime</li>'
          : '<li>We\'ll arrive at the scheduled date and time</li><li>Please ensure access to the garden area</li><li>The job typically takes 1-3 hours depending on scope</li><li>We\'ll clean up and leave your space tidy</li>')
      + '</ul></div>';
  }
  
  // Service-specific preparation tips
  var prepHtml = '';
  if (svc && svc.preparation) {
    prepHtml = '<div style="background:#FFF8E1;border:1px solid #FFE082;border-radius:8px;padding:15px 20px;margin:20px 0;">'
      + '<h3 style="color:#F57F17;margin:0 0 8px;font-size:15px;">📋 How to Prepare</h3>'
      + '<ul style="color:#555;line-height:1.8;margin:0;padding-left:18px;font-size:14px;">';
    for (var p = 0; p < svc.preparation.length; p++) {
      prepHtml += '<li>' + svc.preparation[p] + '</li>';
    }
    prepHtml += '</ul></div>';
  }
  
  var html = '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:0;background:#f0f2f5;font-family:Georgia,\'Times New Roman\',serif;">'
    + '<div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.08);">'
    // Header with logo
    + getGgmEmailHeader({ title: '🌿 Gardners Ground Maintenance', gradient: '#2E7D32', gradientEnd: '#4CAF50' })
    // Greeting
    + '<div style="padding:30px;">'
    + '<h2 style="color:#2E7D32;margin:0 0 10px;">Hi ' + firstName + ',</h2>'
    + '<p style="color:#333;line-height:1.6;margin:0 0 20px;">'
    + (isSubscription 
        ? 'Thank you for subscribing to our <strong>' + svcName + '</strong> plan! Your subscription is now active and we\'re excited to keep your garden looking its best.'
        : isPayNow
          ? 'Thank you for booking <strong>' + svcName + '</strong> with us! Your payment has been processed successfully and your booking is confirmed. No further action needed.'
          : isPayLater
            ? 'Thank you for booking <strong>' + svcName + '</strong> with us! Your booking is confirmed. We\'ll send you an invoice after the service is completed.'
            : 'Thank you for booking <strong>' + svcName + '</strong> with us! We\'ve confirmed your service and look forward to seeing you.')
    + '</p>'
    // Payment status banner
    + (isPayNow 
        ? '<div style="background:#E8F5E9;border:1px solid #A5D6A7;border-radius:8px;padding:12px 15px;margin:0 0 15px;text-align:center;"><span style="color:#2E7D32;font-weight:700;font-size:14px;">✅ Payment Received — ' + priceDisplay + '</span><br><span style="font-size:12px;color:#555;">Payment received. Receipt sent to your email.</span></div>'
        : isPayLater
          ? '<div style="background:#FFF3E0;border:1px solid #FFE0B2;border-radius:8px;padding:12px 15px;margin:0 0 15px;text-align:center;"><span style="color:#E65100;font-weight:700;font-size:14px;">📋 Invoice Pending — ' + priceDisplay + '</span><br><span style="font-size:12px;color:#555;">An invoice will be issued after service completion. Payment due within 14 days.</span></div>'
          : isSubscription
            ? '<div style="background:#E3F2FD;border:1px solid #90CAF9;border-radius:8px;padding:12px 15px;margin:0 0 15px;text-align:center;"><span style="color:#1565C0;font-weight:700;font-size:14px;">🔄 Recurring Subscription Active — ' + priceDisplay + '/visit</span><br><span style="font-size:12px;color:#555;">Your card will be charged automatically. Cancel anytime — no fees.</span></div>'
            : '')
    // Booking Details Card
    + '<div style="background:#f8faf8;border:1px solid #e0e8e0;border-radius:8px;overflow:hidden;margin:20px 0;">'
    + '<div style="background:#2E7D32;padding:12px 15px;"><h3 style="color:#fff;margin:0;font-size:16px;">' + svcIcon + ' ' + (isSubscription ? 'Subscription Details' : 'Booking Details') + '</h3></div>'
    + '<table style="width:100%;border-collapse:collapse;">'
    + '<tr><td style="padding:10px 15px;color:#666;font-weight:600;width:140px;">Job Reference</td><td style="padding:10px 15px;font-weight:700;color:#2E7D32;">' + (data.jobNumber || 'Pending') + '</td></tr>'
    + '<tr style="background:#f0f5f0;"><td style="padding:10px 15px;color:#666;font-weight:600;">Service</td><td style="padding:10px 15px;">' + svcIcon + ' ' + svcName + '</td></tr>'
    + scheduleHtml
    + (priceDisplay ? '<tr style="background:#f0f5f0;"><td style="padding:10px 15px;color:#666;font-weight:600;">Amount</td><td style="padding:10px 15px;font-weight:700;">' + priceDisplay + '</td></tr>' : '')
    + (data.address ? '<tr><td style="padding:10px 15px;color:#666;font-weight:600;">Address</td><td style="padding:10px 15px;">' + data.address + (data.postcode ? ', ' + data.postcode : '') + '</td></tr>' : '')
    + '</table></div>'
    // Service-specific What to Expect
    + expectHtml
    // Service-specific Preparation Tips
    + prepHtml
    // Manage Booking Link
    + '<div style="background:#FFF3E0;border:1px solid #FFE0B2;border-radius:8px;padding:15px;text-align:center;margin:20px 0;">'
    + '<p style="color:#E65100;font-weight:600;margin:0 0 5px;font-size:13px;">Need to change or cancel?</p>'
    + '<a href="https://gardnersgm.co.uk/cancel.html?email=' + encodeURIComponent(data.email || '') + '&job=' + encodeURIComponent(data.jobNumber || '') + '" style="color:#E65100;font-size:13px;">Manage your booking here</a>'
    + '</div>'
    // Newsletter CTA
    + '<div style="background:linear-gradient(135deg,#E8F5E9,#C8E6C9);border-radius:8px;padding:20px;text-align:center;margin:20px 0;">'
    + '<p style="color:#2E7D32;font-weight:700;margin:0 0 8px;font-size:15px;">🎉 Join Our Newsletter!</p>'
    + '<p style="color:#555;font-size:13px;margin:0 0 12px;">Get seasonal tips, exclusive discounts, and garden care guides straight to your inbox.</p>'
    + '<a href="https://gardnersgm.co.uk/#newsletter" style="display:inline-block;background:#2E7D32;color:#fff;padding:10px 24px;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px;">Subscribe Free</a>'
    + '</div>'
    + '</div>'
    // Footer with contact details
    + getGgmEmailFooter(data.email)
    + '</div></body></html>';
  
  var result = sendEmail({
    to: data.email,
    toName: data.name || '',
    subject: subject,
    htmlBody: html,
    name: 'Gardners Ground Maintenance',
    replyTo: 'info@gardnersgm.co.uk'
  });
  if (!result.success) {
    throw new Error('sendEmail failed for ' + data.email + ': ' + result.error);
  }
}


// ============================================
// NEWSLETTER — SUBSCRIBE
// ============================================

function subscribeNewsletter(data) {
  if (!data.email) {
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'error', message: 'Email is required' }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  
  var ss = SpreadsheetApp.openById('1_Y7yHIpAvv_VNBhTrwNOQaBMAGa3UlVW_FKlf56ouHk');
  var sheet = ss.getSheetByName('Subscribers');
  
  // Create Subscribers tab if it doesn't exist
  if (!sheet) {
    sheet = ss.insertSheet('Subscribers');
    sheet.appendRow(['Email', 'Name', 'Tier', 'Source', 'Date', 'Status', 'Token']);
    sheet.getRange(1, 1, 1, 7).setFontWeight('bold');
  }
  
  var emailLower = data.email.toLowerCase().trim();
  var existing = sheet.getDataRange().getValues();
  
  // Check if already subscribed
  for (var i = 1; i < existing.length; i++) {
    if (String(existing[i][0] || '').toLowerCase().trim() === emailLower) {
      // If resubscribing (was unsubscribed), reactivate
      if (String(existing[i][5] || '').toLowerCase() === 'unsubscribed') {
        sheet.getRange(i + 1, 6).setValue('active');
        // Update tier if upgrading from paid sub
        if (data.tier && data.tier !== 'free') {
          sheet.getRange(i + 1, 3).setValue(data.tier);
        }
        return ContentService
          .createTextOutput(JSON.stringify({ status: 'success', message: 'Welcome back! You\'ve been resubscribed.' }))
          .setMimeType(ContentService.MimeType.JSON);
      }
      // Update tier if upgrading
      if (data.tier && data.tier !== 'free') {
        sheet.getRange(i + 1, 3).setValue(data.tier);
      }
      return ContentService
        .createTextOutput(JSON.stringify({ status: 'success', message: 'You\'re already subscribed!' }))
        .setMimeType(ContentService.MimeType.JSON);
    }
  }
  
  // Generate unsubscribe token
  var token = Utilities.getUuid();
  
  sheet.appendRow([
    emailLower,
    data.name || '',
    data.tier || 'free',
    data.source || 'website',
    new Date().toISOString(),
    'active',
    token
  ]);
  
  // Send welcome email
  try {
    sendWelcomeEmail(emailLower, data.name || '', data.tier || 'free', token);
  } catch(e) {}
  
  // Notify Telegram — new newsletter subscriber
  var subSource = data.source || 'website';
  var subTier = data.tier || 'free';
  notifyBot('contentbot', '📬 *NEW SUBSCRIBER*\n\n👤 ' + (data.name || 'Anonymous') + '\n📧 ' + emailLower + '\n📦 Tier: ' + subTier + '\n🔗 Source: ' + subSource);
  
  return ContentService
    .createTextOutput(JSON.stringify({ status: 'success', message: 'Successfully subscribed!' }))
    .setMimeType(ContentService.MimeType.JSON);
}


// ============================================
// NEWSLETTER — WELCOME EMAIL
// ============================================

function sendWelcomeEmail(email, name, tier, token) {
  var isPaid = (tier === 'essential' || tier === 'standard' || tier === 'premium');
  
  var perksHtml = isPaid 
    ? '<li>🌟 <strong>Exclusive seasonal garden guides</strong></li>'
      + '<li>💰 <strong>Subscriber-only discounts (10% off extras)</strong></li>'
      + '<li>📅 <strong>Priority booking slots</strong></li>'
      + '<li>🌿 <strong>Monthly lawn care calendar</strong></li>'
      + '<li>📸 <strong>Before/after project showcases</strong></li>'
      + '<li>🎁 <strong>Annual subscriber appreciation gift</strong></li>'
    : '<li>🌱 Monthly gardening tips & tricks</li>'
      + '<li>📰 Company news & updates</li>'
      + '<li>🌿 Seasonal garden care advice</li>'
      + '<li>💡 DIY garden project ideas</li>';
  
  var upgradeBlock = !isPaid 
    ? '<div style="background:linear-gradient(135deg,#FFF8E1,#FFECB3);border-radius:8px;padding:20px;text-align:center;margin:20px 0;">'
      + '<p style="color:#F57F17;font-weight:700;margin:0 0 8px;">⭐ Want More?</p>'
      + '<p style="color:#666;font-size:13px;margin:0 0 12px;">Subscribe to a lawn care plan and unlock exclusive perks: priority booking, subscriber discounts, seasonal guides, and more!</p>'
      + '<a href="https://gardnersgm.co.uk/subscribe.html" style="display:inline-block;background:#F57F17;color:#fff;padding:10px 24px;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px;">View Plans</a>'
      + '</div>'
    : '<div style="background:linear-gradient(135deg,#E8F5E9,#C8E6C9);border-radius:8px;padding:15px 20px;text-align:center;margin:20px 0;">'
      + '<p style="color:#2E7D32;font-weight:700;margin:0;font-size:14px;">🏆 ' + tier.charAt(0).toUpperCase() + tier.slice(1) + ' Plan Member — Premium newsletter content unlocked!</p>'
      + '</div>';
  
  var webhookUrl = DEPLOYMENT_URL;
  var unsubUrl = webhookUrl + '?action=unsubscribe&email=' + encodeURIComponent(email) + '&token=' + token;
  
  var html = '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:0;background:#f0f2f5;font-family:Georgia,\'Times New Roman\',serif;">'  
    + '<div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.08);">'
    + getGgmEmailHeader({ title: '🌿 Welcome to the Garden!', subtitle: 'Gardners Ground Maintenance Newsletter' })
    + '<div style="padding:30px;">'
    + '<h2 style="color:#2E7D32;margin:0 0 10px;">Hi ' + (name || 'there') + '! 👋</h2>'
    + '<p style="color:#333;line-height:1.6;">Thanks for subscribing to our newsletter! You\'ll receive the latest gardening tips, seasonal advice, and exclusive updates from Gardners Ground Maintenance.</p>'
    + '<h3 style="color:#333;margin:20px 0 10px;">What you\'ll get:</h3>'
    + '<ul style="color:#555;line-height:2;padding-left:18px;">' + perksHtml + '</ul>'
    + upgradeBlock
    + '</div>'
    + getGgmEmailFooter(email)
    + '</div></body></html>';
  
  sendEmail({
    to: email,
    toName: '',
    subject: '🌿 Welcome to the Gardners GM Newsletter!',
    htmlBody: html,
    name: 'Gardners Ground Maintenance',
    replyTo: 'info@gardnersgm.co.uk'
  });
}


// ============================================
// NEWSLETTER — UNSUBSCRIBE
// ============================================

function unsubscribeNewsletter(data) {
  return handleUnsubscribeLink({ email: data.email, token: data.token });
}

function handleUnsubscribeLink(params) {
  var email = (params.email || '').toLowerCase().trim();
  var token = params.token || '';
  
  if (!email) {
    return ContentService.createTextOutput('<html><body style="font-family:Arial;text-align:center;padding:60px;"><h2>Invalid unsubscribe link</h2></body></html>')
      .setMimeType(ContentService.MimeType.HTML);
  }
  
  var ss = SpreadsheetApp.openById('1_Y7yHIpAvv_VNBhTrwNOQaBMAGa3UlVW_FKlf56ouHk');
  var sheet = ss.getSheetByName('Subscribers');
  
  if (!sheet) {
    return ContentService.createTextOutput('<html><body style="font-family:Arial;text-align:center;padding:60px;"><h2>Subscriber not found</h2></body></html>')
      .setMimeType(ContentService.MimeType.HTML);
  }
  
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0] || '').toLowerCase().trim() === email) {
      // Verify token if provided
      if (token && String(data[i][6] || '') !== token) continue;
      sheet.getRange(i + 1, 6).setValue('unsubscribed');
      
      // Notify Telegram — someone unsubscribed
      notifyBot('contentbot', '📭 *NEWSLETTER UNSUBSCRIBE*\n\n📧 ' + email + '\n_Removed from mailing list_');
      
      return ContentService.createTextOutput(
        '<html><head><meta charset="utf-8"></head><body style="font-family:Arial,sans-serif;text-align:center;padding:60px;background:#f4f7f4;">'
        + '<div style="max-width:500px;margin:0 auto;background:#fff;border-radius:12px;padding:40px;box-shadow:0 2px 10px rgba(0,0,0,0.1);">'
        + '<div style="font-size:48px;margin-bottom:15px;">🌿</div>'
        + '<h2 style="color:#2E7D32;">You\'ve Been Unsubscribed</h2>'
        + '<p style="color:#666;line-height:1.6;">You\'ll no longer receive newsletters from Gardners Ground Maintenance.</p>'
        + '<p style="color:#999;font-size:13px;margin-top:20px;">Changed your mind? You can resubscribe anytime at gardnersgm.co.uk</p>'
        + '</div></body></html>'
      ).setMimeType(ContentService.MimeType.HTML);
    }
  }
  
  return ContentService.createTextOutput('<html><body style="font-family:Arial;text-align:center;padding:60px;"><h2>Subscriber not found</h2></body></html>')
    .setMimeType(ContentService.MimeType.HTML);
}


// ============================================
// NEWSLETTER — GET SUBSCRIBERS (Admin)
// ============================================

function getSubscribers() {
  var ss = SpreadsheetApp.openById('1_Y7yHIpAvv_VNBhTrwNOQaBMAGa3UlVW_FKlf56ouHk');
  var sheet = ss.getSheetByName('Subscribers');
  
  if (!sheet) {
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'success', subscribers: [] }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  
  var data = sheet.getDataRange().getValues();
  var subscribers = [];
  
  for (var i = 1; i < data.length; i++) {
    subscribers.push({
      email: data[i][0] || '',
      name: data[i][1] || '',
      tier: data[i][2] || 'free',
      source: data[i][3] || '',
      date: data[i][4] || '',
      status: data[i][5] || 'active'
    });
  }
  
  return ContentService
    .createTextOutput(JSON.stringify({ status: 'success', subscribers: subscribers }))
    .setMimeType(ContentService.MimeType.JSON);
}


// ============================================
// NEWSLETTER — SEND NEWSLETTER (Admin)
// ============================================

function sendNewsletter(data) {
  // Accept both 'content' (legacy) and 'body' (Hub marketing tab) field names
  var content = data.content || data.body || '';
  var targetTierInput = data.targetTier || data.target || 'all';
  data.content = content;
  data.targetTier = targetTierInput;
  
  if (!data.subject || !content) {
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'error', message: 'Subject and content are required' }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  
  var ss = SpreadsheetApp.openById('1_Y7yHIpAvv_VNBhTrwNOQaBMAGa3UlVW_FKlf56ouHk');
  var subSheet = ss.getSheetByName('Subscribers');
  
  if (!subSheet) {
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'error', message: 'No subscribers found' }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  
  var subData = subSheet.getDataRange().getValues();
  var sent = 0;
  var failed = 0;
  var failErrors = [];
  var targetTier = data.targetTier || 'all'; // 'all', 'free', 'paid', 'essential', 'standard', 'premium'
  
  // Build exclusive content block for paid subscribers
  var exclusiveContent = data.exclusiveContent || '';
  
  for (var i = 1; i < subData.length; i++) {
    var email = String(subData[i][0] || '').trim();
    var name = String(subData[i][1] || '');
    var tier = String(subData[i][2] || 'free').toLowerCase();
    var status = String(subData[i][5] || '').toLowerCase();
    var token = String(subData[i][6] || '');
    
    if (!email || status !== 'active') continue;
    
    // Filter by target tier
    var isPaid = (tier === 'essential' || tier === 'standard' || tier === 'premium');
    if (targetTier === 'paid' && !isPaid) continue;
    if (targetTier === 'free' && isPaid) continue;
    if (targetTier === 'essential' && tier !== 'essential') continue;
    if (targetTier === 'standard' && tier !== 'standard') continue;
    if (targetTier === 'premium' && tier !== 'premium') continue;
    
    // Check email preferences for newsletter opt-out
    if (isServiceEmailOptedOut(email, 'newsletter')) continue;
    
    try {
      var personalHtml = buildNewsletterHtml(data.subject, data.content, exclusiveContent, name, tier, isPaid, email, token, data.headerImage || '');
      
      sendEmail({
        to: email,
        toName: '',
        subject: data.subject,
        htmlBody: personalHtml,
        name: 'Gardners Ground Maintenance',
        replyTo: 'info@gardnersgm.co.uk'
      });
      sent++;
    } catch(e) {
      failed++;
      failErrors.push(email + ': ' + e.message);
    }
  }
  
  // Log the newsletter
  var nlSheet = ss.getSheetByName('Newsletters');
  if (!nlSheet) {
    nlSheet = ss.insertSheet('Newsletters');
    nlSheet.appendRow(['Date', 'Subject', 'Target', 'Sent', 'Failed', 'Content Preview', 'Topics Covered', 'Blog Titles Suggested']);
    nlSheet.getRange(1, 1, 1, 8).setFontWeight('bold');
  }
  // Ensure new columns exist on old sheets
  var nlHeaders = nlSheet.getRange(1, 1, 1, nlSheet.getLastColumn()).getValues()[0];
  if (nlHeaders.length < 7) {
    nlSheet.getRange(1, 7).setValue('Topics Covered');
    nlSheet.getRange(1, 8).setValue('Blog Titles Suggested');
    nlSheet.getRange(1, 7, 1, 2).setFontWeight('bold');
  }
  nlSheet.appendRow([
    new Date().toISOString(),
    data.subject,
    targetTier,
    sent,
    failed,
    (data.content || '').substring(0, 500),
    data.topicsCovered || '',
    data.blogTitlesSuggested || ''
  ]);
  
  // Notify Telegram — newsletter results
  notifyBot('contentbot', '📰 *NEWSLETTER SENT*\n\n📋 Subject: ' + (data.subject || '') + '\n🎯 Audience: ' + targetTier + '\n✅ Sent: ' + sent + '\n' + (failed > 0 ? '❌ Failed: ' + failed + '\n📝 Errors: ' + failErrors.join(', ') : '🎉 Zero failures!'));
  
  return ContentService
    .createTextOutput(JSON.stringify({ status: 'success', sent: sent, failed: failed, errors: failErrors }))
    .setMimeType(ContentService.MimeType.JSON);
}


// Build newsletter HTML email
function buildNewsletterHtml(subject, content, exclusiveContent, name, tier, isPaid, email, token, headerImage) {
  var webhookUrl = DEPLOYMENT_URL;
  var unsubUrl = webhookUrl + '?action=unsubscribe&email=' + encodeURIComponent(email) + '&token=' + token;
  
  var tierBadge = isPaid 
    ? '<span style="display:inline-block;background:#FFD700;color:#333;padding:3px 10px;border-radius:12px;font-size:11px;font-weight:700;">⭐ ' + tier.charAt(0).toUpperCase() + tier.slice(1) + ' Member</span>'
    : '';
  
  var headerImgBlock = '';
  if (headerImage) {
    headerImgBlock = '<div style="width:100%;max-height:300px;overflow:hidden;">'
      + '<img src="' + headerImage + '" alt="Newsletter" style="width:100%;height:auto;display:block;" />'
      + '</div>';
  }
  
  var exclusiveBlock = '';
  if (isPaid && exclusiveContent) {
    exclusiveBlock = '<div style="background:linear-gradient(135deg,#FFF8E1,#FFECB3);border:2px solid #FFD700;border-radius:8px;padding:20px;margin:20px 0;">'
      + '<h3 style="color:#F57F17;margin:0 0 10px;">⭐ Exclusive Subscriber Content</h3>'
      + '<div style="color:#555;line-height:1.8;font-size:14px;">' + exclusiveContent + '</div>'
      + '</div>';
  } else if (!isPaid && exclusiveContent) {
    exclusiveBlock = '<div style="background:#f0f0f0;border:2px dashed #ccc;border-radius:8px;padding:20px;margin:20px 0;text-align:center;">'
      + '<p style="color:#999;margin:0 0 8px;">🔒 <strong>Exclusive content available for subscribers</strong></p>'
      + '<p style="color:#aaa;font-size:13px;margin:0 0 12px;">Upgrade to a lawn care plan to unlock exclusive tips, discounts & more.</p>'
      + '<a href="https://gardnersgm.co.uk/subscribe.html" style="display:inline-block;background:#2E7D32;color:#fff;padding:8px 20px;border-radius:6px;text-decoration:none;font-size:13px;font-weight:600;">View Plans</a>'
      + '</div>';
  }
  
  return '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:0;background:#f4f7f4;font-family:Arial,Helvetica,sans-serif;">'
    + '<div style="max-width:600px;margin:0 auto;background:#ffffff;">'
    // Header
    + '<div style="background:linear-gradient(135deg,#2E7D32,#4CAF50);padding:30px;text-align:center;">'
    + '<h1 style="color:#fff;margin:0;font-size:22px;">🌿 Gardners Ground Maintenance</h1>'
    + '<p style="color:rgba(255,255,255,0.9);margin:6px 0 0;font-size:13px;">Newsletter</p>'
    + '</div>'
    // Header Image
    + headerImgBlock
    // Body
    + '<div style="padding:30px;">'
    + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:15px;">'
    + '<h2 style="color:#2E7D32;margin:0;">Hi ' + (name || 'there') + '!</h2> ' + tierBadge
    + '</div>'
    + '<div style="color:#333;line-height:1.8;font-size:15px;">' + content + '</div>'
    + exclusiveBlock
    // CTA
    + '<div style="text-align:center;margin:25px 0;">'
    + '<a href="https://gardnersgm.co.uk/booking.html" style="display:inline-block;background:#2E7D32;color:#fff;padding:12px 30px;border-radius:6px;text-decoration:none;font-weight:600;">Book a Service</a>'
    + '</div>'
    + '</div>'
    // Footer
    + '<div style="background:#333;padding:20px;text-align:center;">'
    + '<p style="color:#aaa;font-size:12px;margin:0 0 5px;">Gardners Ground Maintenance | Roche, Cornwall PL26 8HN</p>'
    + '<p style="color:#888;font-size:11px;margin:0 0 5px;">📞 01726 432051 | ✉️ info@gardnersgm.co.uk</p>'
    + '<a href="' + unsubUrl + '" style="color:#888;font-size:11px;">Unsubscribe</a>'
    + '</div></div></body></html>';
}


// ============================================
// NEWSLETTER — GET SENT NEWSLETTERS (Admin)
// ============================================

function getNewsletters() {
  var ss = SpreadsheetApp.openById('1_Y7yHIpAvv_VNBhTrwNOQaBMAGa3UlVW_FKlf56ouHk');
  var sheet = ss.getSheetByName('Newsletters');
  
  if (!sheet) {
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'success', newsletters: [] }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  
  var data = sheet.getDataRange().getValues();
  var newsletters = [];
  
  for (var i = 1; i < data.length; i++) {
    newsletters.push({
      date: data[i][0] || '',
      subject: data[i][1] || '',
      target: data[i][2] || '',
      sent: data[i][3] || 0,
      failed: data[i][4] || 0,
      preview: data[i][5] || '',
      topicsCovered: data[i][6] || '',
      blogTitlesSuggested: data[i][7] || ''
    });
  }
  
  return ContentService
    .createTextOutput(JSON.stringify({ status: 'success', newsletters: newsletters }))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── Get recent newsletter history for AI content generation ──
// Returns last N newsletters with subjects, topics, and blog suggestions
// Used by cloudWeeklyNewsletter() and content-agent.js to avoid repetition
function getNewsletterContentHistory(count) {
  count = count || 6;
  var ss = SpreadsheetApp.openById('1_Y7yHIpAvv_VNBhTrwNOQaBMAGa3UlVW_FKlf56ouHk');
  var sheet = ss.getSheetByName('Newsletters');
  if (!sheet || sheet.getLastRow() <= 1) return [];

  var data = sheet.getDataRange().getValues();
  var history = [];
  // Read from most recent backwards
  for (var i = data.length - 1; i >= 1 && history.length < count; i--) {
    history.push({
      date: String(data[i][0] || '').substring(0, 10),
      subject: String(data[i][1] || ''),
      preview: String(data[i][5] || ''),
      topicsCovered: String(data[i][6] || ''),
      blogTitlesSuggested: String(data[i][7] || '')
    });
  }
  return history;
}

// Build a text summary of recent newsletter history for AI prompts
function buildNewsletterHistoryPrompt() {
  var history = getNewsletterContentHistory(6);
  if (history.length === 0) return '';

  var lines = ['PREVIOUS NEWSLETTERS (avoid repeating these topics and tips):'];
  for (var h = 0; h < history.length; h++) {
    var entry = history[h];
    lines.push('• ' + entry.date + ' — "' + entry.subject + '"');
    if (entry.topicsCovered) {
      lines.push('  Topics: ' + entry.topicsCovered);
    }
    if (entry.preview) {
      lines.push('  Summary: ' + entry.preview.substring(0, 200));
    }
    if (entry.blogTitlesSuggested) {
      lines.push('  Blog titles suggested: ' + entry.blogTitlesSuggested);
    }
  }
  lines.push('');
  lines.push('IMPORTANT: Generate FRESH content. Do NOT repeat tips, topics or advice that appeared in the newsletters above. Find new angles, different seasonal tasks, or fresh perspectives on ' + CLOUD_NEWSLETTER_THEMES[new Date().getMonth() + 1].theme + '.');
  return lines.join('\n');
}

// Get all published blog titles for cross-referencing
function getAllBlogTitles() {
  var ss = SpreadsheetApp.openById('1_Y7yHIpAvv_VNBhTrwNOQaBMAGa3UlVW_FKlf56ouHk');
  var blogSheet = ss.getSheetByName('Blog');
  if (!blogSheet || blogSheet.getLastRow() <= 1) return [];

  var data = blogSheet.getDataRange().getValues();
  var titles = [];
  for (var i = 1; i < data.length; i++) {
    var status = String(data[i][7] || '').toLowerCase();
    if (status === 'published' && data[i][2]) {
      titles.push(String(data[i][2]));
    }
  }
  return titles;
}

function clearNewslettersMonth(data) {
  if (!data.month) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: 'month required (YYYY-MM)' })).setMimeType(ContentService.MimeType.JSON);
  }
  var ss = SpreadsheetApp.openById('1_Y7yHIpAvv_VNBhTrwNOQaBMAGa3UlVW_FKlf56ouHk');
  var sheet = ss.getSheetByName('Newsletters');
  if (!sheet) return ContentService.createTextOutput(JSON.stringify({ status: 'success', removed: 0 })).setMimeType(ContentService.MimeType.JSON);
  var rows = sheet.getDataRange().getValues();
  var removed = 0;
  for (var i = rows.length - 1; i >= 1; i--) {
    var d = String(rows[i][0] || '').substring(0, 7);
    if (d === data.month) { sheet.deleteRow(i + 1); removed++; }
  }
  return ContentService.createTextOutput(JSON.stringify({ status: 'success', removed: removed })).setMimeType(ContentService.MimeType.JSON);
}


// ============================================
// EMAIL LIFECYCLE ENGINE
// Complete automated email chain from booking
// to aftercare, tied to Google Sheets + Telegram
// ============================================

// ────────────────────────────────────────────
// AFTERCARE CONTENT LIBRARY (per service)
// ────────────────────────────────────────────

var AFTERCARE_CONTENT = {
  'lawn-cutting': {
    icon: '🌱',
    title: 'Lawn Care Tips — After Your Cut',
    tips: [
      'Avoid walking on the lawn for a few hours to let the cut settle.',
      'If it\'s warm, give a light watering this evening to help recovery.',
      'Keep an eye out for any patches — these may benefit from overseeding.',
      'In summer, aim for a cutting height of about 3-4cm to keep grass healthy.',
      'Regular cutting encourages thicker, healthier growth and crowds out weeds.'
    ],
    nextSteps: 'Your lawn will look best with regular cuts. Between visits, a quick rake to remove leaves will help it breathe.',
    seasonalTip: true
  },
  'hedge-trimming': {
    icon: '🌳',
    title: 'Hedge Care Tips — After Your Trim',
    tips: [
      'New growth should appear within 2-3 weeks after trimming.',
      'If your hedge looks a bit bare after cutting back, don\'t worry — it\'ll fill in.',
      'A liquid feed (general garden fertiliser) will encourage thick regrowth.',
      'Water the base of hedges in dry spells to keep roots healthy.',
      'For evergreen hedges, avoid cutting into old wood as it may not regrow.'
    ],
    nextSteps: 'Most hedges benefit from 2-3 trims per year. We\'ll keep yours in shape on your schedule.',
    seasonalTip: true
  },
  'lawn-treatment': {
    icon: '🧪',
    title: 'Important — Your Lawn Treatment Aftercare',
    tips: [
      '⚠️ Keep children and pets off the treated area for at least 24 hours.',
      '💧 Do NOT water the lawn for at least 48 hours after treatment.',
      'If it rains within 6 hours of application, the treatment may need reapplying.',
      'You may notice the lawn looking slightly different initially — this is normal.',
      'Weeds may take 2-3 weeks to fully die back after weed treatment.',
      'Feed treatments take 1-2 weeks to show visible green-up results.'
    ],
    nextSteps: 'Your lawn treatment programme continues with your next scheduled visit. Consistent treatments are key to a weed-free, healthy lawn.',
    scheduleNote: true,
    seasonalTip: true
  },
  'scarifying': {
    icon: '🔧',
    title: 'Scarifying Recovery Guide',
    tips: [
      '⚠️ Your lawn will look rough/patchy for 2-4 weeks — this is completely normal and expected.',
      'Water lightly every day for the first 2 weeks if there\'s no rain.',
      'If we overseeded, avoid mowing until new grass reaches 5cm.',
      'Stay off the lawn as much as possible for the first 3 weeks.',
      'Apply a lawn feed 2 weeks after scarifying to boost recovery.',
      'New grass should be established within 4-6 weeks.'
    ],
    nextSteps: 'Scarifying is one of the most transformative lawn treatments. Trust the process — your lawn will come back thicker and healthier than before.',
    seasonalTip: false
  },
  'garden-clearance': {
    icon: '🏡',
    title: 'Maintaining Your Cleared Garden',
    tips: [
      'We\'ve cleared the area — now is the best time to plan new planting if desired.',
      'A weed membrane or bark mulch will help prevent regrowth in cleared beds.',
      'Check for new weed shoots every 2 weeks and pull them while small.',
      'If soil was compacted, consider adding compost to improve drainage.',
      'Any stumps left behind may attract re-growth — keep them treated.'
    ],
    nextSteps: 'Regular maintenance is the key to keeping on top of cleared areas. We recommend a follow-up check in 4-6 weeks.',
    seasonalTip: false
  },
  'power-washing': {
    icon: '💦',
    title: 'After Your Power Wash',
    tips: [
      'The surface may be slippery for 1-2 hours — take care walking on it.',
      'For patios and driveways, consider applying a sealant to keep it cleaner longer.',
      'Algae and moss re-growth can be slowed with a biocide treatment.',
      'Keep drains clear of the loosened debris — it may wash away in the next rain.',
      'Best results are maintained with an annual power wash.'
    ],
    nextSteps: 'An annual power wash keeps surfaces looking new and prevents permanent staining. Book your next session before winter.',
    seasonalTip: false
  }
};

var SEASONAL_TIPS = {
  spring: {
    icon: '🌸',
    title: 'Spring Garden Guide',
    tips: [
      'Now\'s the time to start regular mowing — set your mower higher for the first cuts.',
      'Apply a spring lawn feed to kick-start growth after winter.',
      'Edge your borders for a sharp, professional look.',
      'Prune any winter-damaged branches from shrubs before new growth.'
    ]
  },
  summer: {
    icon: '☀️',
    title: 'Summer Garden Guide',
    tips: [
      'Water lawns deeply but less frequently — early morning is best.',
      'Raise mowing height in hot weather to reduce stress on grass.',
      'Deadhead flowers to encourage more blooms throughout the season.',
      'Keep on top of weeds — they compete for water in dry spells.'
    ]
  },
  autumn: {
    icon: '🍂',
    title: 'Autumn Garden Prep',
    tips: [
      'Now is the best time for scarifying and overseeding your lawn.',
      'Apply an autumn lawn feed (high potassium) to strengthen roots for winter.',
      'Clear fallen leaves regularly to prevent damage to your lawn.',
      'Plant spring bulbs now for a colourful display next year.'
    ]
  },
  winter: {
    icon: '❄️',
    title: 'Winter Garden Care',
    tips: [
      'Avoid walking on frosty or waterlogged lawns — it damages grass.',
      'This is a good time to plan any major garden projects for spring.',
      'Check fences and structures for storm damage.',
      'Keep bird feeders topped up — they help with pest control in spring.'
    ]
  }
};

// ────────────────────────────────────────────
// SERVICE_CONTENT — Per-service personalisation for all emails
// ────────────────────────────────────────────
var SERVICE_CONTENT = {
  'lawn-cutting': {
    icon: '🌱',
    name: 'Lawn Cutting',
    whatToExpect: [
      'Professional mowing with cylinder or rotary mower',
      'Neat edging along all borders and pathways',
      'Striping for a classic finish (weather permitting)',
      'All clippings collected and removed'
    ],
    preparation: [
      'Clear any toys, furniture or obstacles from the lawn',
      'Ensure side gate or garden access is unlocked',
      'Let us know about any areas to avoid (pet zones, new planting, etc.)'
    ],
    completionNote: 'Your lawn is looking fantastic — freshly cut, edged and striped to perfection!',
    thankYouNote: 'Thanks for choosing us for your lawn care. A well-maintained lawn is the heart of any garden — we\'re proud to keep yours looking its best.',
    rebookCta: 'Book Your Next Cut'
  },
  'hedge-trimming': {
    icon: '🌳',
    name: 'Hedge Trimming',
    whatToExpect: [
      'Precision trimming to your desired shape and height',
      'Shaping and tidying of all hedge faces',
      'All hedge waste collected and removed from site',
      'Clean-up of surrounding paths and borders'
    ],
    preparation: [
      'Clear any items stored against or near the hedge',
      'Let us know your preferred height and shape',
      'Ensure we can access all sides of the hedge'
    ],
    completionNote: 'Your hedges are looking sharp and well-defined — a real improvement to your property\'s kerb appeal!',
    thankYouNote: 'Thanks for trusting us with your hedges. Regular trimming keeps them thick, healthy and looking their best year-round.',
    rebookCta: 'Book Your Next Trim'
  },
  'lawn-treatment': {
    icon: '🧪',
    name: 'Lawn Treatment',
    whatToExpect: [
      'Professional assessment of your lawn condition',
      'Targeted treatment applied (feed, weed-killer, or moss control)',
      'Treatment tailored to the current season and lawn needs',
      'Written aftercare instructions provided'
    ],
    preparation: [
      'Ideally mow the lawn 2-3 days before treatment',
      'Keep the lawn dry — do not water on the day of treatment',
      'Note any problem areas you\'d like us to focus on'
    ],
    completionNote: 'Your lawn treatment has been applied — give it a couple of weeks and you\'ll see a real transformation!',
    thankYouNote: 'Thanks for investing in your lawn\'s health. The treatment programme will deliver visible results over the coming weeks.',
    rebookCta: 'Book Next Treatment'
  },
  'scarifying': {
    icon: '🔧',
    name: 'Scarifying',
    whatToExpect: [
      'Deep scarification to remove thatch and moss',
      'Overseeding of thin or bare patches (if agreed)',
      'All debris collected and removed',
      'Your lawn may look rough initially — this is completely normal'
    ],
    preparation: [
      'Mow the lawn short (around 2cm) a few days before',
      'Water the lawn well the day before if conditions are dry',
      'Clear the lawn of any furniture or obstacles'
    ],
    completionNote: 'Scarifying is done! Your lawn will look rough for 2-4 weeks, but trust the process — it\'ll come back thicker and healthier than ever.',
    thankYouNote: 'Thanks for investing in this transformative treatment. Your lawn will reward you with lush, thick growth in the weeks ahead.',
    rebookCta: 'Book Follow-Up Visit'
  },
  'garden-clearance': {
    icon: '🏡',
    name: 'Garden Clearance',
    whatToExpect: [
      'Full clearance of overgrown vegetation and debris',
      'Cutting back, strimming and tidying of all areas',
      'All green waste removed and disposed of responsibly',
      'Site left clean, tidy and ready for your next plans'
    ],
    preparation: [
      'Let us know which areas need clearing',
      'Point out any plants, trees or features you want kept',
      'Ensure vehicle access if possible for waste removal'
    ],
    completionNote: 'Your garden has been fully cleared and is looking transformed! Now\'s the perfect time to plan what comes next.',
    thankYouNote: 'Thanks for choosing us for your garden clearance. It\'s been a big transformation — enjoy your reclaimed outdoor space!',
    rebookCta: 'Book Maintenance Visit'
  },
  'power-washing': {
    icon: '💦',
    name: 'Power Washing',
    whatToExpect: [
      'High-pressure cleaning of your patio, driveway or decking',
      'Removal of algae, moss, dirt and staining',
      'Careful attention to joints and edges',
      'Surfaces left clean and refreshed'
    ],
    preparation: [
      'Clear furniture, plant pots and vehicles from the area',
      'Ensure outdoor tap access or let us know water arrangements',
      'Note any loose slabs or fragile areas we should be careful with'
    ],
    completionNote: 'Your surfaces are sparkling clean — what a difference! They\'ll stay looking great for months to come.',
    thankYouNote: 'Thanks for booking a power wash with us. Your surfaces look brand new — an annual wash keeps them looking their best.',
    rebookCta: 'Book Annual Wash'
  },
  'veg-patch': {
    icon: '🥕',
    name: 'Vegetable Patch Preparation',
    whatToExpect: [
      'Marking out and clearing the designated area',
      'Soil turning, breaking up and levelling',
      'Compost and soil improver mixed in (if agreed)',
      'Raised bed construction or edging (if included)',
      'Ready-to-plant finish'
    ],
    preparation: [
      'Decide where you want the patch — sunny spot is best',
      'Let us know if you want raised beds or ground-level',
      'Clear any items from the area'
    ],
    completionNote: 'Your vegetable patch is prepped and ready for planting! Time to get those seeds in the ground.',
    thankYouNote: 'Thanks for letting us prepare your veg patch. There\'s nothing better than growing your own — enjoy the harvest!',
    rebookCta: 'Book Seasonal Prep'
  },
  'weeding-treatment': {
    icon: '🌿',
    name: 'Weeding Treatment',
    whatToExpect: [
      'Thorough hand weeding of beds and borders',
      'Selective herbicide spray treatment (if agreed)',
      'Removal of all weed material from site',
      'Mulch application to suppress regrowth (if included)'
    ],
    preparation: [
      'Point out any plants you want us to keep — especially self-seeded flowers',
      'Let us know if you prefer hand-weeding only (no chemicals)',
      'Ensure access to all beds and borders'
    ],
    completionNote: 'Your beds and borders are weed-free and looking pristine! Mulch will help keep them that way.',
    thankYouNote: 'Thanks for choosing our weeding service. Regular treatment is the secret to beautiful, low-maintenance borders.',
    rebookCta: 'Book Next Treatment'
  },
  'fence-repair': {
    icon: '🔨',
    name: 'Fence Repair',
    whatToExpect: [
      'Inspection and assessment of damaged sections',
      'Panel replacement or post repair as needed',
      'Timber treatment applied to new and adjacent panels',
      'Old materials removed and disposed of',
      'All work checked for stability and quality'
    ],
    preparation: [
      'Clear plants, bins or sheds away from the fenceline',
      'Let us know if the fence borders a neighbour\'s property',
      'Note any specific panel or post numbers that need work'
    ],
    completionNote: 'Your fence is repaired, solid and looking great — no more gaps or wobbles!',
    thankYouNote: 'Thanks for trusting us with your fence repair. A well-maintained fence keeps your garden secure and private.',
    rebookCta: 'Book Fence Check'
  },
  'emergency-tree': {
    icon: '🚨',
    name: 'Emergency Tree Surgery',
    whatToExpect: [
      'Rapid response to your emergency (usually same day)',
      'Safe removal of fallen or dangerous branches',
      'Crown reduction or emergency felling if required',
      'Full site clearance and waste removal',
      'Assessment of remaining tree health'
    ],
    preparation: [
      'Keep a safe distance from the damaged tree',
      'Photograph the damage if it is safe to do so',
      'Clear vehicles and valuables from the area if possible',
      'Let us know about any power lines, buildings or structures nearby'
    ],
    completionNote: 'The emergency has been dealt with safely — your property is secure. We\'ll follow up with any further recommendations.',
    thankYouNote: 'Thanks for calling us in the emergency. We know it can be stressful — glad we could help quickly and safely.',
    rebookCta: 'Book Follow-Up Visit'
  },
  'drain-clearance': {
    icon: '💧',
    name: 'Drain Clearance',
    whatToExpect: [
      'Assessment of the blockage and drain condition',
      'Manual rodding or pressure jetting to clear the drain',
      'Root ingress treatment if required',
      'Flushing and flow testing to confirm clearance',
      'Advice on preventing future blockages'
    ],
    preparation: [
      'Locate the blocked drain and note any visible issues',
      'Clear items away from the drain access point',
      'Let us know if the drain has backed up into the house',
      'Note if there are any nearby tree roots that could be the cause'
    ],
    completionNote: 'Your drain is cleared and flowing freely. We\'ve checked the flow rate and it\'s back to normal. Keep an eye on it over the next few days.',
    thankYouNote: 'Thanks for booking drain clearance with us. No more standing water! We\'re just a call away if it plays up again.',
    rebookCta: 'Book Follow-Up Check'
  },
  'gutter-cleaning': {
    icon: '🏠',
    name: 'Gutter Cleaning',
    whatToExpect: [
      'Full inspection of all gutters and downpipes',
      'Removal of leaves, moss, silt and debris',
      'Downpipe flushing to ensure clear flow',
      'Check for any damage, sagging or loose brackets',
      'Optional gutter guard fitting to prevent future blockages'
    ],
    preparation: [
      'Ensure we can access all sides of the property',
      'Move any vehicles, bins or garden furniture away from the walls',
      'Let us know if you\'ve noticed any specific problem areas or leaks',
      'Note any fragile plants or beds directly below the gutters'
    ],
    completionNote: 'Your gutters are cleared and flowing freely. We\'ve checked all downpipes and brackets. Any issues spotted have been noted in your report.',
    thankYouNote: 'Thanks for booking gutter cleaning with us. Clean gutters protect your home from damp and water damage — we recommend a clean every 12 months.',
    rebookCta: 'Book Next Clean'
  }
};

function getServiceContent(service) {
  if (!service) return null;
  var key = service.toLowerCase().replace(/\s+/g, '-');
  return SERVICE_CONTENT[key] || null;
}

function getCurrentSeason() {
  var month = new Date().getMonth(); // 0-11
  if (month >= 2 && month <= 4) return 'spring';
  if (month >= 5 && month <= 7) return 'summer';
  if (month >= 8 && month <= 10) return 'autumn';
  return 'winter';
}


// ────────────────────────────────────────────
// EMAIL TRACKING — log every email sent
// ────────────────────────────────────────────

function getOrCreateEmailTrackingSheet() {
  var ss = SpreadsheetApp.openById('1_Y7yHIpAvv_VNBhTrwNOQaBMAGa3UlVW_FKlf56ouHk');
  var sheet = ss.getSheetByName('Email Tracking');
  if (!sheet) {
    sheet = ss.insertSheet('Email Tracking');
    sheet.appendRow(['Date', 'Email', 'Name', 'Type', 'Service', 'Job Number', 'Subject', 'Status']);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function logEmailSent(email, name, type, service, jobNumber, subject) {
  var sheet = getOrCreateEmailTrackingSheet();
  sheet.appendRow([
    new Date().toISOString(),
    email || '',
    name || '',
    type || '',
    service || '',
    jobNumber || '',
    subject || '',
    'Sent'
  ]);
}

function wasEmailSentRecently(email, type, daysBack) {
  var sheet;
  try { sheet = getOrCreateEmailTrackingSheet(); } catch(e) { return false; }
  var data = sheet.getDataRange().getValues();
  var cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysBack);
  
  for (var i = data.length - 1; i >= 1; i--) {
    var sentDate = data[i][0] instanceof Date ? data[i][0] : new Date(String(data[i][0]));
    if (sentDate < cutoff) break; // old enough, stop checking
    if (String(data[i][1] || '').toLowerCase() === email.toLowerCase() && String(data[i][3] || '') === type) {
      return true;
    }
  }
  return false;
}


// ────────────────────────────────────────────
// SERVICE EMAIL UNSUBSCRIBE
// ────────────────────────────────────────────

function handleServiceUnsubscribe(params) {
  var email = (params.email || '').toLowerCase().trim();
  if (!email) {
    return ContentService.createTextOutput('<html><body style="font-family:Arial;text-align:center;padding:60px;"><h2>Invalid link</h2></body></html>')
      .setMimeType(ContentService.MimeType.HTML);
  }
  
  var ss = SpreadsheetApp.openById('1_Y7yHIpAvv_VNBhTrwNOQaBMAGa3UlVW_FKlf56ouHk');
  var sheet = ss.getSheetByName('Email Preferences');
  if (!sheet) {
    sheet = ss.insertSheet('Email Preferences');
    sheet.appendRow(['Email', 'Reminders', 'Aftercare', 'Follow-ups', 'Seasonal', 'Updated']);
    sheet.setFrozenRows(1);
  }
  
  var data = sheet.getDataRange().getValues();
  var found = false;
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0] || '').toLowerCase() === email) {
      // Set all to 'no'
      sheet.getRange(i + 1, 2, 1, 4).setValues([['no','no','no','no']]);
      sheet.getRange(i + 1, 6).setValue(new Date().toISOString());
      found = true;
      break;
    }
  }
  if (!found) {
    sheet.appendRow([email, 'no', 'no', 'no', 'no', new Date().toISOString()]);
  }
  
  notifyTelegram('📭 *SERVICE EMAIL UNSUBSCRIBE*\n\n📧 ' + email + '\n_Opted out of service emails_');
  
  return ContentService.createTextOutput(
    '<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>'
    + '<body style="font-family:Arial,sans-serif;text-align:center;padding:60px;background:#f4f7f4;">'
    + '<div style="max-width:500px;margin:0 auto;background:#fff;border-radius:12px;padding:40px;box-shadow:0 2px 10px rgba(0,0,0,0.1);">'
    + '<div style="font-size:48px;margin-bottom:15px;">🌿</div>'
    + '<h2 style="color:#2E7D32;">Unsubscribed from Service Emails</h2>'
    + '<p style="color:#666;line-height:1.6;">You\'ll no longer receive visit reminders, aftercare tips, or follow-up emails from us.</p>'
    + '<p style="color:#999;font-size:13px;margin-top:20px;">This won\'t affect your service bookings or subscription. You can manage your preferences any time via <a href="https://gardnersgm.co.uk/my-account.html" style="color:#2E7D32;">My Account</a>.</p>'
    + '<a href="https://gardnersgm.co.uk" style="display:inline-block;background:#2E7D32;color:#fff;padding:10px 24px;border-radius:6px;text-decoration:none;margin-top:15px;font-weight:600;">Back to Home</a>'
    + '</div></body></html>'
  ).setMimeType(ContentService.MimeType.HTML);
}

function isServiceEmailOptedOut(email, type) {
  // type: 'reminders', 'aftercare', 'follow-ups', 'seasonal' — if omitted, checks reminders as blanket
  try {
    var ss = SpreadsheetApp.openById('1_Y7yHIpAvv_VNBhTrwNOQaBMAGa3UlVW_FKlf56ouHk');
    var sheet = ss.getSheetByName('Email Preferences');
    if (!sheet) return false;
    var data = sheet.getDataRange().getValues();
    var colMap = { 'reminders': 1, 'aftercare': 2, 'follow-ups': 3, 'seasonal': 4 };
    var col = colMap[type || 'reminders'] || 1;
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0] || '').toLowerCase() === email.toLowerCase()) {
        return String(data[i][col] || '') === 'no';
      }
    }
  } catch(e) {}
  return false;
}

function getEmailHistory(params) {
  var email = (params.email || '').toLowerCase().trim();
  var sheet;
  try { sheet = getOrCreateEmailTrackingSheet(); } catch(e) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'success', emails: [] }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  var data = sheet.getDataRange().getValues();
  var emails = [];
  for (var i = 1; i < data.length; i++) {
    if (!email || String(data[i][1] || '').toLowerCase() === email) {
      emails.push({
        date: data[i][0] || '',
        email: data[i][1] || '',
        name: data[i][2] || '',
        type: data[i][3] || '',
        service: data[i][4] || '',
        jobNumber: data[i][5] || '',
        subject: data[i][6] || '',
        status: data[i][7] || ''
      });
    }
  }
  return ContentService.createTextOutput(JSON.stringify({ status: 'success', emails: emails }))
    .setMimeType(ContentService.MimeType.JSON);
}


// ────────────────────────────────────────────
// SHARED EMAIL WRAPPER (branded + unsubscribe)
// ────────────────────────────────────────────

var WEBHOOK_URL = DEPLOYMENT_URL;

function buildLifecycleEmail(options) {
  // options: headerColor, headerColorEnd, headerIcon, headerTitle, greeting, bodyHtml, ctaUrl, ctaText, email
  var headerTitle = (options.headerIcon || '🌿') + ' ' + (options.headerTitle || 'Gardners Ground Maintenance');
  
  return '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>'
    + '<body style="margin:0;padding:0;background:#f0f2f5;font-family:Georgia,\'Times New Roman\',serif;">'
    + '<div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.08);">'
    // Header with logo
    + getGgmEmailHeader({ title: headerTitle, gradient: options.headerColor, gradientEnd: options.headerColorEnd })
    // Body
    + '<div style="padding:30px;">'
    + '<h2 style="color:#333;margin:0 0 10px;font-size:18px;">' + (options.greeting || 'Hi there,') + '</h2>'
    + (options.bodyHtml || '')
    // CTA
    + (options.ctaUrl ? '<div style="text-align:center;margin:25px 0;"><a href="' + options.ctaUrl + '" style="display:inline-block;background:#2E7D32;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;">' + (options.ctaText || 'Visit Our Website') + '</a></div>' : '')
    + '</div>'
    // Footer with contact details
    + getGgmEmailFooter(options.email)
    + '</div></body></html>';
}


// ────────────────────────────────────────────
// EMAIL 1: DAY-BEFORE VISIT REMINDER
// ────────────────────────────────────────────

function sendVisitReminder(client) {
  if (!client.email || isServiceEmailOptedOut(client.email, 'reminders')) return false;
  if (wasEmailSentRecently(client.email, 'visit-reminder', 1)) return false;
  
  var firstName = (client.name || 'there').split(' ')[0];
  var svcKey = (client.service || '').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  var content = AFTERCARE_CONTENT[svcKey] || {};
  var icon = content.icon || '🌿';
  
  var subject = '📅 Reminder: Your ' + (client.service || 'garden service') + ' visit is tomorrow | Gardners GM';
  
  var body = '<p style="color:#555;line-height:1.6;">Just a friendly reminder that we\'ll be visiting you <strong>tomorrow</strong> for your <strong>' + (client.service || 'garden service') + '</strong>.</p>'
    + '<div style="background:#E8F5E9;border:1px solid #A5D6A7;border-radius:10px;overflow:hidden;margin:20px 0;">'
    + '<div style="background:#2E7D32;padding:10px 15px;"><h3 style="color:#fff;margin:0;font-size:15px;">📋 Visit Details</h3></div>'
    + '<table style="width:100%;border-collapse:collapse;">'
    + '<tr><td style="padding:8px 15px;color:#666;font-weight:600;width:120px;">Service</td><td style="padding:8px 15px;font-weight:700;">' + icon + ' ' + (client.service || '') + '</td></tr>'
    + '<tr style="background:#F1F8E9;"><td style="padding:8px 15px;color:#666;font-weight:600;">Date</td><td style="padding:8px 15px;font-weight:700;">' + (client.date || 'Tomorrow') + '</td></tr>'
    + (client.time ? '<tr><td style="padding:8px 15px;color:#666;font-weight:600;">Time</td><td style="padding:8px 15px;">' + client.time + '</td></tr>' : '')
    + '</table></div>'
    + '<div style="background:#FFF8E1;border-left:4px solid #FFA000;padding:12px 16px;border-radius:0 8px 8px 0;margin:15px 0;">'
    + '<p style="color:#333;margin:0;font-size:14px;"><strong>🏡 Quick checklist before we arrive:</strong></p>'
    + '<ul style="color:#555;margin:8px 0 0;padding-left:18px;font-size:13px;line-height:1.8;">'
    + '<li>Please ensure access to the garden area</li>'
    + '<li>Move any garden furniture or items from the work area</li>'
    + '<li>Ensure any side gates are unlocked</li>'
    + '<li>Let us know if anything has changed — text/call 01726 432051</li>'
    + '</ul></div>';
  
  var html = buildLifecycleEmail({
    headerColor: '#2E7D32', headerColorEnd: '#43A047',
    headerIcon: '📅', headerTitle: 'Visit Reminder',
    greeting: 'Hi ' + firstName + ',',
    bodyHtml: body, email: client.email
  });
  
  sendEmail({ to: client.email, toName: '', subject: subject, htmlBody: html, name: 'Gardners Ground Maintenance', replyTo: 'info@gardnersgm.co.uk' });
  logEmailSent(client.email, client.name, 'visit-reminder', client.service, client.jobNumber, subject);
  return true;
}


// ────────────────────────────────────────────
// EMAIL 2: AFTERCARE (sent day of completion)
// ────────────────────────────────────────────

function sendAftercareEmail(client) {
  if (!client.email || isServiceEmailOptedOut(client.email, 'aftercare')) return false;
  if (wasEmailSentRecently(client.email, 'aftercare', 3)) return false;
  
  var firstName = (client.name || 'there').split(' ')[0];
  var svcKey = (client.service || '').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  var content = AFTERCARE_CONTENT[svcKey];
  
  if (!content) {
    // Fallback generic
    content = {
      icon: '🌿', title: 'Garden Service Complete',
      tips: ['Your garden service has been completed.', 'Regular maintenance will keep things looking great.'],
      nextSteps: 'We recommend regular visits to maintain the results.'
    };
  }
  
  var subject = content.icon + ' ' + content.title + ' — ' + firstName + ' | Gardners GM';
  
  var tipsHtml = '';
  for (var t = 0; t < content.tips.length; t++) {
    var bgColor = t % 2 === 0 ? '#fff' : '#F1F8E9';
    tipsHtml += '<div style="padding:10px 15px;background:' + bgColor + ';border-bottom:1px solid #E8F5E9;">'
      + '<span style="color:#2E7D32;font-weight:700;margin-right:6px;">✓</span>'
      + '<span style="color:#444;font-size:14px;">' + content.tips[t] + '</span></div>';
  }
  
  // Add seasonal tip if applicable
  var seasonalBlock = '';
  if (content.seasonalTip) {
    var season = getCurrentSeason();
    var st = SEASONAL_TIPS[season];
    seasonalBlock = '<div style="background:linear-gradient(135deg,#E8F5E9,#C8E6C9);border-radius:10px;padding:18px;margin:20px 0;">'
      + '<h3 style="color:#1B5E20;margin:0 0 8px;font-size:15px;">' + st.icon + ' ' + st.title + '</h3>';
    for (var s = 0; s < Math.min(st.tips.length, 2); s++) {
      seasonalBlock += '<p style="color:#2E7D32;font-size:13px;margin:4px 0;">• ' + st.tips[s] + '</p>';
    }
    seasonalBlock += '</div>';
  }
  
  // Next visit info if subscription
  var nextVisitBlock = '';
  if (client.nextVisit) {
    nextVisitBlock = '<div style="background:#E3F2FD;border:1px solid #90CAF9;border-radius:8px;padding:15px;margin:15px 0;text-align:center;">'
      + '<p style="color:#1565C0;font-weight:700;margin:0 0 4px;">📅 Your Next Visit</p>'
      + '<p style="color:#333;font-size:16px;font-weight:700;margin:0;">' + client.nextVisit + '</p>'
      + '</div>';
  }
  
  var body = '<p style="color:#555;line-height:1.6;">Your <strong>' + (client.service || 'garden service') + '</strong> has been completed! Here\'s everything you need to know to get the best results:</p>'
    + '<div style="background:#fff;border:1px solid #E8F5E9;border-radius:10px;overflow:hidden;margin:20px 0;">'
    + '<div style="background:#2E7D32;padding:10px 15px;"><h3 style="color:#fff;margin:0;font-size:15px;">' + content.icon + ' ' + content.title + '</h3></div>'
    + tipsHtml + '</div>'
    + '<div style="border-left:4px solid #4CAF50;padding:12px 18px;background:#f8faf8;margin:15px 0;border-radius:0 8px 8px 0;">'
    + '<p style="color:#333;font-weight:600;margin:0 0 4px;">What\'s Next?</p>'
    + '<p style="color:#555;font-size:14px;margin:0;">' + content.nextSteps + '</p>'
    + '</div>'
    + nextVisitBlock
    + seasonalBlock;
  
  var html = buildLifecycleEmail({
    headerColor: '#2E7D32', headerColorEnd: '#388E3C',
    headerIcon: content.icon, headerTitle: 'Aftercare Guide',
    greeting: 'Hi ' + firstName + ',',
    bodyHtml: body, email: client.email,
    ctaUrl: 'https://gardnersgm.co.uk/testimonials.html',
    ctaText: 'Leave Us a Review ⭐'
  });
  
  sendEmail({ to: client.email, toName: '', subject: subject, htmlBody: html, name: 'Gardners Ground Maintenance', replyTo: 'info@gardnersgm.co.uk' });
  logEmailSent(client.email, client.name, 'aftercare', client.service, client.jobNumber, subject);
  return true;
}


// ────────────────────────────────────────────
// EMAIL 3: FOLLOW-UP CHECK (3 days after visit)
// ────────────────────────────────────────────

function sendFollowUpEmail(client) {
  if (!client.email || isServiceEmailOptedOut(client.email, 'follow-ups')) return false;
  if (wasEmailSentRecently(client.email, 'follow-up', 14)) return false;
  
  var firstName = (client.name || 'there').split(' ')[0];
  var svcKey = (client.service || '').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  
  var subject = '🌿 How\'s your garden looking, ' + firstName + '? | Gardners GM';
  
  var followUpTips = {
    'lawn-cutting': 'How\'s the lawn looking since our visit? Keep up with watering in warm weather and it\'ll stay lush.',
    'hedge-trimming': 'Your hedges should be settling in nicely. You may spot new growth shoots already appearing.',
    'lawn-treatment': 'It\'s been a few days since your treatment — you should start seeing results soon. Any yellowing weeds are a good sign that the treatment is working!',
    'scarifying': 'We know your lawn might still look a bit rough right now — don\'t worry, this is completely normal. Consistent watering is key to a great recovery.',
    'garden-clearance': 'How\'s the cleared area looking? Keep an eye out for any rogue regrowth and nip it in the bud.',
    'power-washing': 'Your surfaces should be looking great! Remember, a sealant can help keep them cleaner for longer.'
  };
  
  var personalNote = followUpTips[svcKey] || 'How\'s your garden looking since our visit? We hope you\'re happy with the results.';
  
  var body = '<p style="color:#555;line-height:1.6;">' + personalNote + '</p>'
    + '<div style="background:#f8faf8;border:1px solid #e0e8e0;border-radius:10px;padding:20px;margin:20px 0;text-align:center;">'
    + '<p style="color:#333;font-weight:600;font-size:15px;margin:0 0 8px;">Is everything looking good? 👍</p>'
    + '<p style="color:#555;font-size:13px;margin:0 0 15px;">If anything needs tweaking, just reply to this email or give us a call. We\'re always happy to come back and sort it out.</p>'
    + '<a href="https://gardnersgm.co.uk/testimonials.html" style="display:inline-block;background:#2E7D32;color:#fff;padding:10px 24px;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px;margin:5px;">Leave a Review</a>'
    + '&nbsp;&nbsp;'
    + '<a href="https://gardnersgm.co.uk/booking.html" style="display:inline-block;background:#1565C0;color:#fff;padding:10px 24px;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px;margin:5px;">Book Again</a>'
    + '</div>';
  
  if (client.nextVisit) {
    body += '<div style="background:#E3F2FD;border-radius:8px;padding:15px;text-align:center;margin:15px 0;">'
      + '<p style="color:#1565C0;font-weight:600;margin:0;">📅 Your next visit: <strong>' + client.nextVisit + '</strong></p></div>';
  }
  
  body += '<p style="color:#555;line-height:1.6;">We really appreciate your continued trust in Gardners. If you know anyone who could use our services, we\'d love a recommendation! 🙏</p>';
  
  var html = buildLifecycleEmail({
    headerColor: '#1B5E20', headerColorEnd: '#2E7D32',
    headerIcon: '🌿', headerTitle: 'How\'s Your Garden?',
    greeting: 'Hey ' + firstName + '! 👋',
    bodyHtml: body, email: client.email
  });
  
  sendEmail({ to: client.email, toName: '', subject: subject, htmlBody: html, name: 'Gardners Ground Maintenance', replyTo: 'info@gardnersgm.co.uk' });
  logEmailSent(client.email, client.name, 'follow-up', client.service, client.jobNumber, subject);
  return true;
}


// ────────────────────────────────────────────
// EMAIL 4: SUBSCRIPTION SCHEDULE UPDATE
// ────────────────────────────────────────────

function sendScheduleUpdateEmail(client) {
  if (!client.email || isServiceEmailOptedOut(client.email)) return false;
  
  var firstName = (client.name || 'there').split(' ')[0];
  var subject = '📅 Your Updated Visit Schedule | Gardners GM';
  
  var scheduleRows = '';
  if (client.upcomingVisits && client.upcomingVisits.length > 0) {
    for (var v = 0; v < client.upcomingVisits.length; v++) {
      var visit = client.upcomingVisits[v];
      var bg = v % 2 === 0 ? '#fff' : '#F1F8E9';
      scheduleRows += '<tr style="background:' + bg + ';"><td style="padding:8px 15px;font-weight:600;">' + (visit.date || '') + '</td>'
        + '<td style="padding:8px 15px;">' + (visit.service || '') + '</td>'
        + '<td style="padding:8px 15px;">' + (visit.status || 'Scheduled') + '</td></tr>';
    }
  }
  
  var body = '<p style="color:#555;line-height:1.6;">Here\'s an update to your upcoming visit schedule. Please check the dates below and let us know if anything needs adjusting.</p>'
    + (scheduleRows ? '<div style="border:1px solid #E8F5E9;border-radius:10px;overflow:hidden;margin:20px 0;">'
    + '<table style="width:100%;border-collapse:collapse;">'
    + '<tr style="background:#2E7D32;"><th style="padding:10px 15px;color:#fff;text-align:left;">Date</th><th style="padding:10px 15px;color:#fff;text-align:left;">Service</th><th style="padding:10px 15px;color:#fff;text-align:left;">Status</th></tr>'
    + scheduleRows + '</table></div>' : '')
    + '<p style="color:#555;font-size:14px;">Need to change a date? Just reply to this email or call us on 01726 432051.</p>';
  
  var html = buildLifecycleEmail({
    headerColor: '#1565C0', headerColorEnd: '#42A5F5',
    headerIcon: '📅', headerTitle: 'Schedule Update',
    greeting: 'Hi ' + firstName + ',',
    bodyHtml: body, email: client.email,
    ctaUrl: 'https://gardnersgm.co.uk/cancel.html?email=' + encodeURIComponent(client.email),
    ctaText: 'Manage Your Booking'
  });
  
  sendEmail({ to: client.email, toName: '', subject: subject, htmlBody: html, name: 'Gardners Ground Maintenance', replyTo: 'info@gardnersgm.co.uk' });
  logEmailSent(client.email, client.name, 'schedule-update', client.service, client.jobNumber, subject);
  return true;
}


// ────────────────────────────────────────────
// EMAIL 5: SEASONAL TIPS (quarterly)
// ────────────────────────────────────────────

function sendSeasonalTipsEmail(client) {
  if (!client.email || isServiceEmailOptedOut(client.email, 'seasonal')) return false;
  if (wasEmailSentRecently(client.email, 'seasonal-tips', 60)) return false; // max every 2 months
  
  var firstName = (client.name || 'there').split(' ')[0];
  var season = getCurrentSeason();
  var st = SEASONAL_TIPS[season];
  
  var subject = st.icon + ' ' + st.title + ' — Tips for Your Garden | Gardners GM';
  
  var tipsHtml = '';
  for (var t = 0; t < st.tips.length; t++) {
    tipsHtml += '<div style="display:flex;align-items:flex-start;margin:10px 0;">'
      + '<span style="color:#2E7D32;font-size:18px;margin-right:10px;flex-shrink:0;">✓</span>'
      + '<p style="color:#444;font-size:14px;line-height:1.5;margin:0;">' + st.tips[t] + '</p></div>';
  }
  
  var body = '<p style="color:#555;line-height:1.6;">Here are our top garden tips for this ' + season + '. A little care now goes a long way!</p>'
    + '<div style="background:linear-gradient(135deg,#E8F5E9,#C8E6C9);border-radius:10px;padding:20px;margin:20px 0;">'
    + '<h3 style="color:#1B5E20;margin:0 0 12px;">' + st.icon + ' ' + st.title + '</h3>'
    + tipsHtml + '</div>'
    + '<p style="color:#555;line-height:1.6;">Want us to help with any of these? We\'re just a call away — or you can book online anytime.</p>';
  
  var html = buildLifecycleEmail({
    headerColor: '#1B5E20', headerColorEnd: '#388E3C',
    headerIcon: st.icon, headerTitle: st.title,
    greeting: 'Hi ' + firstName + '! ' + st.icon,
    bodyHtml: body, email: client.email,
    ctaUrl: 'https://gardnersgm.co.uk/booking.html',
    ctaText: 'Book a Service'
  });
  
  sendEmail({ to: client.email, toName: '', subject: subject, htmlBody: html, name: 'Gardners Ground Maintenance', replyTo: 'info@gardnersgm.co.uk' });
  logEmailSent(client.email, client.name, 'seasonal-tips', '', '', subject);
  return true;
}


// ────────────────────────────────────────────
// EMAIL 6: RE-ENGAGEMENT (lapsed 30+ days)
// ────────────────────────────────────────────

function sendReEngagementEmail(client) {
  if (!client.email || isServiceEmailOptedOut(client.email, 'seasonal')) return false;
  if (wasEmailSentRecently(client.email, 're-engagement', 60)) return false;
  
  var firstName = (client.name || 'there').split(' ')[0];
  var subject = '🌿 We miss your garden, ' + firstName + '! | Gardners GM';
  
  var body = '<p style="color:#555;line-height:1.6;">It\'s been a little while since we last visited your garden. We hope everything is looking great!</p>'
    + '<div style="background:#FFF3E0;border-radius:10px;padding:20px;text-align:center;margin:20px 0;">'
    + '<div style="font-size:40px;margin-bottom:10px;">🌿🏡</div>'
    + '<h3 style="color:#E65100;margin:0 0 8px;">Garden needs a refresh?</h3>'
    + '<p style="color:#555;font-size:14px;margin:0 0 15px;">Whether it\'s a quick tidy-up or a full seasonal treatment, we\'re here to help your garden look its best.</p>'
    + '<a href="https://gardnersgm.co.uk/booking.html" style="display:inline-block;background:#2E7D32;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;">Book a Visit</a>'
    + '</div>'
    + '<p style="color:#555;line-height:1.6;">As a returning customer, you already know the quality of our work. We\'d love to have you back! 🙏</p>';
  
  var html = buildLifecycleEmail({
    headerColor: '#E65100', headerColorEnd: '#FF8F00',
    headerIcon: '🌿', headerTitle: 'We Miss You!',
    greeting: 'Hi ' + firstName + '! 👋',
    bodyHtml: body, email: client.email
  });
  
  sendEmail({ to: client.email, toName: '', subject: subject, htmlBody: html, name: 'Gardners Ground Maintenance', replyTo: 'info@gardnersgm.co.uk' });
  logEmailSent(client.email, client.name, 're-engagement', '', '', subject);
  return true;
}


// ────────────────────────────────────────────
// PROMOTIONAL UPSELL CONTENT LIBRARY
// Maps each service to smart recommendations
// ────────────────────────────────────────────

var PROMO_CONTENT = {
  'lawn-cutting': {
    upsells: [
      { service: 'Lawn Treatment Programme', icon: '🧪', desc: 'Your lawn\'s already looking great from regular cuts — imagine it weed-free and lush green too! Our treatment programme feeds, strengthens, and protects your lawn all year round.', cta: 'Upgrade Your Lawn', url: 'https://gardnersgm.co.uk/lawn-treatments.html' },
      { service: 'Scarifying & Aeration', icon: '🔧', desc: 'Noticed any moss or thatch? Scarifying removes the build-up that chokes your grass, giving it room to breathe and grow thicker. Best paired with your regular cuts.', cta: 'Learn About Scarifying', url: 'https://gardnersgm.co.uk/booking.html' },
      { service: 'Hedge Trimming', icon: '🌳', desc: 'We\'re already on site for your lawn — adding a hedge trim takes no extra travel time, keeping your whole front looking sharp for less.', cta: 'Add Hedge Trimming', url: 'https://gardnersgm.co.uk/booking.html' }
    ],
    headline: 'Take Your Lawn to the Next Level'
  },
  'hedge-trimming': {
    upsells: [
      { service: 'Regular Lawn Cutting', icon: '🌱', desc: 'Your hedges look fantastic — why not pair them with a regularly maintained lawn? We offer flexible packages to suit every budget.', cta: 'View Lawn Packages', url: 'https://gardnersgm.co.uk/pricing.html' },
      { service: 'Garden Clearance', icon: '🏡', desc: 'Got areas that need a proper tidy-up while we\'re on site? Our garden clearance service transforms overgrown spaces quickly.', cta: 'Book a Clearance', url: 'https://gardnersgm.co.uk/booking.html' },
      { service: 'Power Washing', icon: '💦', desc: 'Freshly trimmed hedges + a sparkling patio = kerb appeal perfection. Our power washing brings paths and driveways back to life.', cta: 'Book Power Washing', url: 'https://gardnersgm.co.uk/booking.html' }
    ],
    headline: 'Complete the Look'
  },
  'lawn-treatment': {
    upsells: [
      { service: 'Regular Lawn Cutting', icon: '🌱', desc: 'Your treatments are working hard — regular mowing at the right height maximises the results. We\'ll keep it at the perfect length between feeds.', cta: 'Add Regular Cuts', url: 'https://gardnersgm.co.uk/pricing.html' },
      { service: 'Scarifying', icon: '🔧', desc: 'For the ultimate lawn, combine your treatment programme with annual scarifying. It removes moss and thatch so treatments penetrate deeper.', cta: 'Book Scarifying', url: 'https://gardnersgm.co.uk/booking.html' }
    ],
    headline: 'Maximise Your Treatment Results'
  },
  'scarifying': {
    upsells: [
      { service: 'Lawn Treatment Programme', icon: '🧪', desc: 'Your scarified lawn is the perfect canvas for a treatment programme! Feed and protect that fresh growth to get the best possible results.', cta: 'Start a Treatment Plan', url: 'https://gardnersgm.co.uk/lawn-treatments.html' },
      { service: 'Regular Lawn Cutting', icon: '🌱', desc: 'Once your lawn recovers, regular cutting at the right height will keep it dense and weed-resistant. We\'ll maintain the results you\'ve paid for.', cta: 'View Packages', url: 'https://gardnersgm.co.uk/pricing.html' }
    ],
    headline: 'Protect Your Investment'
  },
  'garden-clearance': {
    upsells: [
      { service: 'Regular Maintenance Package', icon: '📋', desc: 'Now that your garden\'s been cleared, don\'t let it go back! Regular maintenance keeps everything in shape and costs less than another clearance.', cta: 'View Packages', url: 'https://gardnersgm.co.uk/pricing.html' },
      { service: 'Power Washing', icon: '💦', desc: 'While the garden looks fresh, why not get the patio and paths done too? Complete the transformation.', cta: 'Book Power Washing', url: 'https://gardnersgm.co.uk/booking.html' }
    ],
    headline: 'Keep Your Garden Looking Fresh'
  },
  'power-washing': {
    upsells: [
      { service: 'Regular Lawn Cutting', icon: '🌱', desc: 'Your patio\'s gleaming — time to match it with a perfectly maintained lawn! We offer flexible packages starting from £42/fortnight.', cta: 'View Lawn Packages', url: 'https://gardnersgm.co.uk/pricing.html' },
      { service: 'Garden Clearance', icon: '🏡', desc: 'While everything\'s looking fresh, tackle those overgrown borders and beds. A full garden clearance completes the picture.', cta: 'Book a Clearance', url: 'https://gardnersgm.co.uk/booking.html' }
    ],
    headline: 'While Everything\'s Looking Sharp…'
  }
};

// One-off → subscription upsell
var SUBSCRIPTION_PROMO = {
  headline: 'Save Money with a Regular Plan',
  icon: '💰',
  desc: 'Did you know our subscription customers save up to 20% compared to one-off bookings? You\'ll get a dedicated schedule, priority booking, and consistent results.',
  packages: [
    { name: 'Essential', price: '£42/fortnight', desc: 'Fortnightly lawn care — perfect for keeping things tidy', icon: '🌱' },
    { name: 'Standard', price: '£30/week', desc: 'Weekly visits — lawn cutting + seasonal extras', icon: '⭐' },
    { name: 'Premium', price: '£144/month', desc: 'The full works — lawn, hedges, treatments, priority scheduling', icon: '👑' }
  ],
  cta: 'View All Packages',
  url: 'https://gardnersgm.co.uk/pricing.html'
};

// Referral programme content
var REFERRAL_CONTENT = {
  headline: 'Know Someone Who Needs Us?',
  icon: '🎁',
  desc: 'We love getting new customers through word of mouth — it\'s the best compliment! If you know a friend, family member or neighbour who could use our help:',
  howItWorks: [
    'Tell them to mention your name when they book',
    'Once their first job is completed, you both benefit',
    'You get <strong>£10 off your next visit</strong> as a thank you',
    'They get <strong>10% off their first booking</strong>'
  ],
  cta: 'Share Our Booking Page',
  url: 'https://gardnersgm.co.uk/booking.html'
};


// EMAIL 7: SMART PROMOTIONAL / UPSELL
// ────────────────────────────────────────────

function sendPromotionalEmail(client) {
  if (!client.email || isServiceEmailOptedOut(client.email, 'seasonal')) return false;
  if (wasEmailSentRecently(client.email, 'promotional', 30)) return false;
  
  var firstName = (client.name || 'there').split(' ')[0];
  var svcKey = (client.service || '').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  var promo = PROMO_CONTENT[svcKey];
  if (!promo) return false;
  
  // Pick top 2 upsells (rotate based on month so content stays fresh)
  var month = new Date().getMonth();
  var upsells = promo.upsells.slice();
  // Rotate array by month
  for (var rot = 0; rot < (month % upsells.length); rot++) {
    upsells.push(upsells.shift());
  }
  var picks = upsells.slice(0, 2);
  
  var subject = '✨ ' + promo.headline + ', ' + firstName + '! | Gardners GM';
  
  // Build upsell cards
  var cardsHtml = '';
  for (var i = 0; i < picks.length; i++) {
    var p = picks[i];
    cardsHtml += '<div style="background:#f8f9fa;border-radius:12px;padding:20px;margin:12px 0;border-left:4px solid #2E7D32;">'
      + '<div style="font-size:28px;margin-bottom:8px;">' + p.icon + '</div>'
      + '<h3 style="color:#1B5E20;margin:0 0 8px;font-size:16px;">' + p.service + '</h3>'
      + '<p style="color:#555;font-size:14px;line-height:1.5;margin:0 0 12px;">' + p.desc + '</p>'
      + '<a href="' + p.url + '" style="display:inline-block;background:#2E7D32;color:#fff;padding:10px 22px;border-radius:6px;text-decoration:none;font-weight:600;font-size:13px;">' + p.cta + ' →</a>'
      + '</div>';
  }
  
  // If one-off customer, add subscription upsell
  var subBlock = '';
  if (client.type && client.type.toLowerCase().indexOf('subscription') < 0) {
    var sp = SUBSCRIPTION_PROMO;
    subBlock = '<div style="background:linear-gradient(135deg,#E8F5E9,#C8E6C9);border-radius:12px;padding:22px;margin:20px 0;text-align:center;">'
      + '<div style="font-size:36px;margin-bottom:8px;">' + sp.icon + '</div>'
      + '<h3 style="color:#1B5E20;margin:0 0 8px;">' + sp.headline + '</h3>'
      + '<p style="color:#555;font-size:14px;margin:0 0 15px;">' + sp.desc + '</p>'
      + '<div style="display:flex;flex-wrap:wrap;justify-content:center;gap:10px;margin:15px 0;">';
    for (var pk = 0; pk < sp.packages.length; pk++) {
      var pkg = sp.packages[pk];
      subBlock += '<div style="background:#fff;border-radius:8px;padding:12px 16px;min-width:140px;text-align:center;">'
        + '<div style="font-size:20px;">' + pkg.icon + '</div>'
        + '<div style="font-weight:700;color:#2E7D32;font-size:15px;">' + pkg.name + '</div>'
        + '<div style="color:#1B5E20;font-weight:600;font-size:13px;">' + pkg.price + '</div>'
        + '<div style="color:#777;font-size:11px;margin-top:4px;">' + pkg.desc + '</div>'
        + '</div>';
    }
    subBlock += '</div>'
      + '<a href="' + sp.url + '" style="display:inline-block;background:#2E7D32;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;margin-top:10px;">' + sp.cta + ' →</a>'
      + '</div>';
  }
  
  var body = '<p style="color:#555;line-height:1.6;">Thanks for choosing Gardners GM for your ' + (client.service || 'garden care') + '! Based on your garden, we think you\'d love these:</p>'
    + cardsHtml
    + subBlock
    + '<p style="color:#999;font-size:12px;text-align:center;margin-top:20px;">We only suggest services we genuinely think will benefit your garden. No spam, ever.</p>';
  
  var html = buildLifecycleEmail({
    headerColor: '#1565C0', headerColorEnd: '#1E88E5',
    headerIcon: '✨', headerTitle: promo.headline,
    greeting: 'Hi ' + firstName + '! 👋',
    bodyHtml: body, email: client.email
  });
  
  sendEmail({ to: client.email, toName: '', subject: subject, htmlBody: html, name: 'Gardners Ground Maintenance', replyTo: 'info@gardnersgm.co.uk' });
  logEmailSent(client.email, client.name, 'promotional', client.service || '', client.jobNumber || '', subject);
  return true;
}


// EMAIL 8: REFERRAL PROGRAMME
// ────────────────────────────────────────────

function sendReferralEmail(client) {
  if (!client.email || isServiceEmailOptedOut(client.email, 'seasonal')) return false;
  if (wasEmailSentRecently(client.email, 'referral', 60)) return false;
  
  var firstName = (client.name || 'there').split(' ')[0];
  var ref = REFERRAL_CONTENT;
  var subject = '🎁 ' + firstName + ', Get £10 Off — Refer a Friend! | Gardners GM';
  
  var stepsHtml = '<ol style="color:#555;line-height:2;padding-left:20px;">';
  for (var h = 0; h < ref.howItWorks.length; h++) {
    stepsHtml += '<li>' + ref.howItWorks[h] + '</li>';
  }
  stepsHtml += '</ol>';
  
  var body = '<p style="color:#555;line-height:1.6;">We hope you\'re loving the results from your recent visit! We\'ve got a little something for you…</p>'
    + '<div style="background:linear-gradient(135deg,#FFF8E1,#FFECB3);border-radius:12px;padding:22px;margin:20px 0;text-align:center;">'
    + '<div style="font-size:42px;margin-bottom:8px;">' + ref.icon + '</div>'
    + '<h3 style="color:#E65100;margin:0 0 10px;font-size:18px;">' + ref.headline + '</h3>'
    + '<p style="color:#555;font-size:14px;margin:0 0 15px;text-align:left;">' + ref.desc + '</p>'
    + stepsHtml
    + '<div style="background:#fff;border-radius:8px;padding:15px;margin:15px 0;border:2px dashed #FF8F00;">'
    + '<div style="font-size:22px;font-weight:700;color:#E65100;">You get £10 off • They get 10% off</div>'
    + '<div style="color:#777;font-size:12px;margin-top:4px;">It\'s a win-win! 🤝</div>'
    + '</div>'
    + '<a href="' + ref.url + '" style="display:inline-block;background:#E65100;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;">' + ref.cta + ' →</a>'
    + '</div>'
    + '<p style="color:#555;line-height:1.6;">Just ask your friend to mention your name (<strong>' + firstName + '</strong>) when they book. We\'ll handle the rest! 🙏</p>';
  
  var html = buildLifecycleEmail({
    headerColor: '#E65100', headerColorEnd: '#FF8F00',
    headerIcon: '🎁', headerTitle: 'Refer a Friend',
    greeting: 'Hi ' + firstName + '! 🌟',
    bodyHtml: body, email: client.email
  });
  
  sendEmail({ to: client.email, toName: '', subject: subject, htmlBody: html, name: 'Gardners Ground Maintenance', replyTo: 'info@gardnersgm.co.uk' });
  logEmailSent(client.email, client.name, 'referral', client.service || '', client.jobNumber || '', subject);
  return true;
}


// EMAIL 9: PACKAGE UPGRADE NUDGE (for existing subscribers)
// ────────────────────────────────────────────

function sendPackageUpgradeEmail(client) {
  if (!client.email || isServiceEmailOptedOut(client.email, 'seasonal')) return false;
  if (wasEmailSentRecently(client.email, 'upgrade', 60)) return false;
  
  var firstName = (client.name || 'there').split(' ')[0];
  var currentPkg = (client.package || '').toLowerCase();
  
  // Only nudge Essential → Standard or Standard → Premium
  var upgradeTarget = null;
  if (currentPkg.indexOf('essential') >= 0) {
    upgradeTarget = { name: 'Standard', price: '£30/week', icon: '⭐', benefits: [
      'Weekly visits instead of fortnightly — your lawn always looks fresh',
      'Seasonal extras included (edging, leaf clearance, feeding)',
      'Priority scheduling — first on the round',
      'Just £18/week more for double the visits + extras'
    ]};
  } else if (currentPkg.indexOf('standard') >= 0) {
    upgradeTarget = { name: 'Premium', price: '£144/month', icon: '👑', benefits: [
      'The full works — lawn, hedges, treatments all included',
      'Priority scheduling — you\'re always first',
      'Seasonal treatments (scarifying, aeration, overseeding)',
      'One monthly payment, everything covered — total peace of mind'
    ]};
  }
  
  if (!upgradeTarget) return false;
  
  var subject = '⬆️ Upgrade to ' + upgradeTarget.name + ', ' + firstName + '? | Gardners GM';
  
  var benefitsHtml = '<ul style="color:#555;line-height:1.8;padding-left:20px;">';
  for (var b = 0; b < upgradeTarget.benefits.length; b++) {
    benefitsHtml += '<li>' + upgradeTarget.benefits[b] + '</li>';
  }
  benefitsHtml += '</ul>';
  
  var body = '<p style="color:#555;line-height:1.6;">You\'ve been on the ' + (client.package || 'Essential') + ' plan for a while now, and we hope you\'re loving it! We thought you might like to know what the next level up offers:</p>'
    + '<div style="background:linear-gradient(135deg,#E8EAF6,#C5CAE9);border-radius:12px;padding:22px;margin:20px 0;">'
    + '<div style="text-align:center;">'
    + '<div style="font-size:40px;margin-bottom:8px;">' + upgradeTarget.icon + '</div>'
    + '<h3 style="color:#283593;margin:0 0 5px;font-size:20px;">' + upgradeTarget.name + ' Package</h3>'
    + '<div style="color:#3949AB;font-weight:700;font-size:18px;margin-bottom:12px;">' + upgradeTarget.price + '</div>'
    + '</div>'
    + benefitsHtml
    + '<div style="text-align:center;margin-top:15px;">'
    + '<a href="https://gardnersgm.co.uk/pricing.html" style="display:inline-block;background:#283593;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;">See Upgrade Options →</a>'
    + '</div>'
    + '</div>'
    + '<p style="color:#555;line-height:1.6;">No pressure at all — just wanted to make sure you knew the option was there. You can upgrade or change your plan any time by getting in touch. 📞</p>';
  
  var html = buildLifecycleEmail({
    headerColor: '#283593', headerColorEnd: '#3F51B5',
    headerIcon: '⬆️', headerTitle: 'Level Up Your Plan',
    greeting: 'Hi ' + firstName + '! 👋',
    bodyHtml: body, email: client.email
  });
  
  sendEmail({ to: client.email, toName: '', subject: subject, htmlBody: html, name: 'Gardners Ground Maintenance', replyTo: 'info@gardnersgm.co.uk' });
  logEmailSent(client.email, client.name, 'upgrade', client.package || '', '', subject);
  return true;
}


// ════════════════════════════════════════════
// MASTER DAILY EMAIL LIFECYCLE PROCESSOR
// Called by the agent daily — checks all sheets
// and sends the right emails at the right time
// ════════════════════════════════════════════

function processEmailLifecycle(data) {
  // When Hub owns emails, skip the GAS lifecycle engine entirely
  // (Hub email_automation.py runs all 19 stages on its own schedule)
  if (HUB_OWNS_EMAILS) {
    Logger.log('processEmailLifecycle: skipped (HUB_OWNS_EMAILS=true)');
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'skipped', reason: 'HUB_OWNS_EMAILS — Hub manages all lifecycle emails' }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  var results = {
    reminders: 0,
    aftercare: 0,
    followUps: 0,
    seasonal: 0,
    reEngagement: 0,
    promotional: 0,
    referral: 0,
    upgrade: 0,
    errors: [],
    details: []
  };
  
  var ss = SpreadsheetApp.openById('1_Y7yHIpAvv_VNBhTrwNOQaBMAGa3UlVW_FKlf56ouHk');
  var sheet = ss.getSheetByName('Jobs');
  var allData = sheet.getDataRange().getValues();
  
  // Load schedule for visit-based triggers
  var schedSheet = ss.getSheetByName('Schedule');
  var schedData = schedSheet ? schedSheet.getDataRange().getValues() : [];
  
  var today = new Date();
  today.setHours(0, 0, 0, 0);
  var tomorrow = new Date(today.getTime() + 86400000);
  var threeDaysAgo = new Date(today.getTime() - 3 * 86400000);
  var todayStr = normaliseDateToISO(today);
  var tomorrowStr = normaliseDateToISO(tomorrow);
  var threeDaysAgoStr = normaliseDateToISO(threeDaysAgo);
  
  // Build lookup of upcoming visits per client from Schedule
  var nextVisitMap = {};
  for (var s = 1; s < schedData.length; s++) {
    var visitDate = schedData[s][0] instanceof Date ? schedData[s][0] : new Date(String(schedData[s][0] || ''));
    var visitDateStr = normaliseDateToISO(visitDate);
    var visitName = String(schedData[s][1] || '');
    var visitEmail = String(schedData[s][2] || '').toLowerCase();
    var visitService = String(schedData[s][6] || '');
    var visitStatus = String(schedData[s][9] || '').toLowerCase();
    
    if (visitStatus === 'cancelled') continue;
    
    // ─── DAY-BEFORE REMINDERS ───
    if (visitDateStr === tomorrowStr) {
      try {
        var sent = sendVisitReminder({
          name: visitName, email: visitEmail, service: visitService,
          date: tomorrowStr, time: '', jobNumber: String(schedData[s][10] || '')
        });
        if (sent) {
          results.reminders++;
          results.details.push('📅 Reminder → ' + visitName + ' (' + visitService + ')');
        }
      } catch(e) { results.errors.push('Reminder fail: ' + visitName + ' — ' + e); }
    }
    
    // ─── AFTERCARE (visits that were today/yesterday — completed) ───
    if (visitDateStr === todayStr && (visitStatus === 'completed' || visitStatus === 'done')) {
      // Find next visit for this client
      var nv = '';
      for (var nvi = 1; nvi < schedData.length; nvi++) {
        var nvDate = schedData[nvi][0] instanceof Date ? schedData[nvi][0] : new Date(String(schedData[nvi][0] || ''));
        if (nvDate > today && String(schedData[nvi][2] || '').toLowerCase() === visitEmail) {
          nv = normaliseDateToISO(nvDate);
          break;
        }
      }
      
      try {
        var sent2 = sendAftercareEmail({
          name: visitName, email: visitEmail, service: visitService,
          jobNumber: String(schedData[s][10] || ''), nextVisit: nv
        });
        if (sent2) {
          results.aftercare++;
          results.details.push('🌱 Aftercare → ' + visitName + ' (' + visitService + ')');
        }
      } catch(e) { results.errors.push('Aftercare fail: ' + visitName + ' — ' + e); }
    }
    
    // ─── FOLLOW-UP (visits 3 days ago) ───
    if (visitDateStr === threeDaysAgoStr) {
      var nvForFollowUp = '';
      for (var fvi = 1; fvi < schedData.length; fvi++) {
        var fvDate = schedData[fvi][0] instanceof Date ? schedData[fvi][0] : new Date(String(schedData[fvi][0] || ''));
        if (fvDate > today && String(schedData[fvi][2] || '').toLowerCase() === visitEmail) {
          nvForFollowUp = normaliseDateToISO(fvDate);
          break;
        }
      }
      
      try {
        var sent3 = sendFollowUpEmail({
          name: visitName, email: visitEmail, service: visitService,
          jobNumber: String(schedData[s][10] || ''), nextVisit: nvForFollowUp
        });
        if (sent3) {
          results.followUps++;
          results.details.push('💬 Follow-up → ' + visitName + ' (' + visitService + ')');
        }
      } catch(e) { results.errors.push('Follow-up fail: ' + visitName + ' — ' + e); }
    }
    
    // Build next-visit lookup for main sheet checks
    if (visitDate > today && (!nextVisitMap[visitEmail] || visitDate < new Date(nextVisitMap[visitEmail]))) {
      nextVisitMap[visitEmail] = visitDateStr;
    }
  }
  
  // ─── Also check Sheet1 for one-off bookings ───
  for (var r = 1; r < allData.length; r++) {
    var row = allData[r];
    var email = String(row[3] || '').toLowerCase().trim();
    var name = String(row[2] || '');
    var service = String(row[7] || '');
    var date = row[8] instanceof Date ? normaliseDateToISO(row[8]) : normaliseDateToISO(String(row[8] || ''));
    var status = String(row[11] || '').toLowerCase();
    var type = String(row[1] || '').toLowerCase();
    var jn = String(row[19] || '');
    
    if (!email || status === 'cancelled') continue;
    
    // Day-before reminder for one-off bookings
    if (date === tomorrowStr && type.indexOf('subscription') < 0 && status !== 'completed') {
      try {
        var sent4 = sendVisitReminder({
          name: name, email: email, service: service,
          date: tomorrowStr, time: String(row[9] || ''), jobNumber: jn
        });
        if (sent4) {
          results.reminders++;
          results.details.push('📅 Reminder → ' + name + ' (' + service + ')');
        }
      } catch(e) { results.errors.push('Reminder fail: ' + name + ' — ' + e); }
    }
    
    // Re-engagement: last activity > 30 days ago, not a subscription
    if (type.indexOf('subscription') < 0 && status === 'completed') {
      try {
        var bookDate = row[8] instanceof Date ? row[8] : new Date(date + 'T12:00:00');
        var daysSince = Math.floor((today - bookDate) / 86400000);
        if (daysSince >= 30 && daysSince < 90) {
          var sent5 = sendReEngagementEmail({ name: name, email: email });
          if (sent5) {
            results.reEngagement++;
            results.details.push('👋 Re-engage → ' + name);
          }
        }
      } catch(e) {}
    }
  }
  
  // ─── Seasonal tips: send to all active subscribers (max once per 2 months) ───
  if (data && data.includeSeasonal) {
    for (var q = 1; q < allData.length; q++) {
      var qEmail = String(allData[q][3] || '').toLowerCase().trim();
      var qName = String(allData[q][2] || '');
      var qStatus = String(allData[q][11] || '').toLowerCase();
      if (!qEmail || qStatus === 'cancelled') continue;
      try {
        var sent6 = sendSeasonalTipsEmail({ name: qName, email: qEmail });
        if (sent6) {
          results.seasonal++;
          results.details.push('🌸 Seasonal → ' + qName);
        }
      } catch(e) {}
      if (results.seasonal >= 20) break; // daily cap
    }
  }
  
  // ─── PROMOTIONAL UPSELLS: 7+ days after first completed job ───
  var seenPromo = {};
  for (var pr = 1; pr < allData.length; pr++) {
    var prRow = allData[pr];
    var prEmail = String(prRow[3] || '').toLowerCase().trim();
    var prName = String(prRow[2] || '');
    var prService = String(prRow[7] || '');
    var prType = String(prRow[1] || '');
    var prStatus = String(prRow[11] || '').toLowerCase();
    var prJn = String(prRow[19] || '');
    
    if (!prEmail || prStatus !== 'completed' || seenPromo[prEmail]) continue;
    seenPromo[prEmail] = true;
    
    try {
      var prDate = prRow[8] instanceof Date ? prRow[8] : new Date(String(prRow[8] || '') + 'T12:00:00');
      var daysSinceJob = Math.floor((today - prDate) / 86400000);
      if (daysSinceJob >= 7 && daysSinceJob < 60) {
        var sent7 = sendPromotionalEmail({
          name: prName, email: prEmail, service: prService,
          type: prType, jobNumber: prJn
        });
        if (sent7) {
          results.promotional++;
          results.details.push('✨ Promo → ' + prName + ' (' + prService + ')');
        }
      }
    } catch(e) { results.errors.push('Promo fail: ' + prName + ' — ' + e); }
    if (results.promotional >= 10) break; // daily cap
  }
  
  // ─── REFERRAL: 14+ days after completed job ───
  var seenRef = {};
  for (var rf = 1; rf < allData.length; rf++) {
    var rfRow = allData[rf];
    var rfEmail = String(rfRow[3] || '').toLowerCase().trim();
    var rfName = String(rfRow[2] || '');
    var rfService = String(rfRow[7] || '');
    var rfStatus = String(rfRow[11] || '').toLowerCase();
    
    if (!rfEmail || rfStatus !== 'completed' || seenRef[rfEmail]) continue;
    seenRef[rfEmail] = true;
    
    try {
      var rfDate = rfRow[8] instanceof Date ? rfRow[8] : new Date(String(rfRow[8] || '') + 'T12:00:00');
      var daysSinceRef = Math.floor((today - rfDate) / 86400000);
      if (daysSinceRef >= 14 && daysSinceRef < 90) {
        var sent8 = sendReferralEmail({
          name: rfName, email: rfEmail, service: rfService
        });
        if (sent8) {
          results.referral++;
          results.details.push('🎁 Referral → ' + rfName);
        }
      }
    } catch(e) { results.errors.push('Referral fail: ' + rfName + ' — ' + e); }
    if (results.referral >= 10) break; // daily cap
  }
  
  // ─── PACKAGE UPGRADE: subscribers 30+ days into their plan ───
  var seenUpg = {};
  for (var ug = 1; ug < allData.length; ug++) {
    var ugRow = allData[ug];
    var ugEmail = String(ugRow[3] || '').toLowerCase().trim();
    var ugName = String(ugRow[2] || '');
    var ugPkg = String(ugRow[7] || '');
    var ugType = String(ugRow[1] || '').toLowerCase();
    var ugStatus = String(ugRow[11] || '').toLowerCase();
    
    if (!ugEmail || ugStatus === 'cancelled' || seenUpg[ugEmail]) continue;
    if (ugType.indexOf('subscription') < 0) continue; // only subscribers
    seenUpg[ugEmail] = true;
    
    try {
      var ugDate = ugRow[0] instanceof Date ? ugRow[0] : new Date(String(ugRow[0] || ''));
      var daysSinceStart = Math.floor((today - ugDate) / 86400000);
      if (daysSinceStart >= 30) {
        var sent9 = sendPackageUpgradeEmail({
          name: ugName, email: ugEmail, package: ugPkg
        });
        if (sent9) {
          results.upgrade++;
          results.details.push('⬆️ Upgrade → ' + ugName + ' (' + ugPkg + ')');
        }
      }
    } catch(e) { results.errors.push('Upgrade fail: ' + ugName + ' — ' + e); }
    if (results.upgrade >= 5) break; // daily cap
  }
  
  return ContentService.createTextOutput(JSON.stringify({
    status: 'success',
    results: results
  })).setMimeType(ContentService.MimeType.JSON);
}


// ════════════════════════════════════════════════════════════════
// FINANCIAL DASHBOARD ENGINE
// Automated takings breakdown, cost allocation, profit tracking,
// and dynamic pricing recommendations.
// ════════════════════════════════════════════════════════════════

// UK tax thresholds for 2025/26 tax year
var UK_TAX = {
  personalAllowance: 12570,
  basicRate: 0.20,
  basicBand: 50270,
  higherRate: 0.40,
  class2NI: 3.45,     // per week
  class4NIRate: 0.06,  // 6% on £12,570–£50,270
  class4NIUpper: 0.02, // 2% above £50,270
  vatThreshold: 90000,
  studentLoan: false
};

// Per-job material cost defaults (from business plan)
var JOB_MATERIAL_COSTS = {
  'lawn-cutting': 1.50,
  'hedge-trimming': 2.00,
  'lawn-treatment': 12.00,
  'scarifying': 15.00,
  'garden-clearance': 25.00,
  'power-washing': 5.00,
  'veg-patch': 15.00,
  'weeding-treatment': 3.00,
  'fence-repair': 20.00,
  'emergency-tree': 40.00,
  'drain-clearance': 5.00,
  'gutter-cleaning': 2.00
};

// Target profit margins by service
var TARGET_MARGINS = {
  'lawn-cutting': 0.75,
  'hedge-trimming': 0.70,
  'lawn-treatment': 0.65,
  'scarifying': 0.60,
  'garden-clearance': 0.55,
  'power-washing': 0.70,
  'veg-patch': 0.60,
  'weeding-treatment': 0.70,
  'fence-repair': 0.55,
  'emergency-tree': 0.50,
  'drain-clearance': 0.65,
  'gutter-cleaning': 0.75
};

// Cornwall-specific cost model (rural county — long travel, spread-out clients)
var CORNWALL_COSTS = {
  avgTravelMiles: 15,
  fuelPricePerLitre: 1.45,
  vanMPG: 35,
  litresPerGallon: 4.546,
  // Equipment fuel consumption (litres per job)
  equipmentFuel: {
    'lawn-cutting': 1.5,
    'hedge-trimming': 0.8,
    'lawn-treatment': 0.3,
    'scarifying': 2.0,
    'garden-clearance': 2.5,
    'power-washing': 3.0,
    'veg-patch': 1.5,
    'weeding-treatment': 0.3,
    'fence-repair': 0.5,
    'emergency-tree': 4.0,
    'drain-clearance': 1.0,
    'gutter-cleaning': 0.5
  },
  // Equipment wear cost per job (£) — blades, parts, servicing share
  equipmentWear: {
    'lawn-cutting': 1.50,
    'hedge-trimming': 1.80,
    'lawn-treatment': 0.50,
    'scarifying': 3.00,
    'garden-clearance': 2.00,
    'power-washing': 1.20,
    'veg-patch': 1.50,
    'weeding-treatment': 0.30,
    'fence-repair': 2.00,
    'emergency-tree': 8.00,
    'drain-clearance': 1.50,
    'gutter-cleaning': 0.80
  },
  // Waste disposal cost per job (£)
  wasteDisposal: {
    'lawn-cutting': 0,
    'hedge-trimming': 5.00,
    'lawn-treatment': 0,
    'scarifying': 3.00,
    'garden-clearance': 35.00,
    'power-washing': 0,
    'veg-patch': 5.00,
    'weeding-treatment': 2.00,
    'fence-repair': 10.00,
    'emergency-tree': 40.00,
    'drain-clearance': 5.00,
    'gutter-cleaning': 3.00
  },
  // Time on site (hours) — affects equipment fuel
  avgJobHours: {
    'lawn-cutting': 1.0,
    'hedge-trimming': 2.5,
    'lawn-treatment': 1.5,
    'scarifying': 5.0,
    'garden-clearance': 6.0,
    'power-washing': 5.0,
    'veg-patch': 4.0,
    'weeding-treatment': 2.0,
    'fence-repair': 3.5,
    'emergency-tree': 5.0,
    'drain-clearance': 2.0,
    'gutter-cleaning': 1.5
  }
};
// Calculate van fuel cost per mile at startup
CORNWALL_COSTS.fuelCostPerMile = CORNWALL_COSTS.fuelPricePerLitre * CORNWALL_COSTS.litresPerGallon / CORNWALL_COSTS.vanMPG;

// Savings pot definitions
var SAVINGS_POTS = [
  { id: 'tax',         name: 'Tax Reserve',           monthlyTarget: 0, pctOfRevenue: 0,   calcMethod: 'tax',    notes: 'Income tax on profit above £12,570' },
  { id: 'ni',          name: 'NI Reserve',            monthlyTarget: 0, pctOfRevenue: 0,   calcMethod: 'ni',     notes: 'Class 2 + Class 4 National Insurance' },
  { id: 'emergency',   name: 'Emergency Fund',        monthlyTarget: 250, pctOfRevenue: 0, calcMethod: 'fixed',  notes: '3 months operating costs target = £2,500' },
  { id: 'equipment',   name: 'Equipment Replacement', monthlyTarget: 42, pctOfRevenue: 0,  calcMethod: 'fixed',  notes: '£500/yr for blades, parts, eventual replacements' },
  { id: 'vehicle',     name: 'Vehicle Fund',          monthlyTarget: 100, pctOfRevenue: 0, calcMethod: 'fixed',  notes: 'MOT, service, tyres, eventual replacement' },
  { id: 'insurance',   name: 'Insurance Renewal',     monthlyTarget: 125, pctOfRevenue: 0, calcMethod: 'fixed',  notes: 'Vehicle £1,200 + PL £300 = £1,500/yr / 12' },
  { id: 'marketing',   name: 'Marketing',             monthlyTarget: 30, pctOfRevenue: 0,  calcMethod: 'fixed',  notes: 'Flyers, Facebook ads, seasonal campaigns' },
  { id: 'operating',   name: 'Operating Float',       monthlyTarget: 0,  pctOfRevenue: 10, calcMethod: 'pct',    notes: '10% of gross kept as working capital' }
];


// ─── Get or create the Financial Dashboard sheet ───

function getOrCreateFinancialDashboard() {
  var ss = SpreadsheetApp.openById('1_Y7yHIpAvv_VNBhTrwNOQaBMAGa3UlVW_FKlf56ouHk');
  var sheet = ss.getSheetByName('Financial Dashboard');
  if (!sheet) {
    sheet = ss.insertSheet('Financial Dashboard');
    sheet.appendRow([
      'Date', 'Period', 'Gross Revenue', 'Subscription Revenue', 'One-Off Revenue',
      'Total Jobs', 'Avg Job Value', 'Material Costs', 'Running Costs (Allocated)',
      'Stripe Fees', 'Fuel Estimate', 'Tax Reserve (Income)', 'NI Reserve (Class 2+4)',
      'Net Profit', 'Profit Margin %', 'Cash to Keep', 'Pricing Health',
      'YTD Revenue', 'YTD Costs', 'YTD Profit', 'Notes'
    ]);
    sheet.getRange(1, 1, 1, 21).setFontWeight('bold');
    sheet.setFrozenRows(1);
    // Apply column widths
    sheet.setColumnWidth(1, 100);  // Date
    sheet.setColumnWidth(2, 80);   // Period  
    sheet.setColumnWidth(17, 120); // Pricing Health
    sheet.setColumnWidth(21, 200); // Notes
  }
  return sheet;
}


// ─── Get or create the Pricing Config sheet ───

function getOrCreatePricingConfig() {
  var ss = SpreadsheetApp.openById('1_Y7yHIpAvv_VNBhTrwNOQaBMAGa3UlVW_FKlf56ouHk');
  var sheet = ss.getSheetByName('Pricing Config');
  if (!sheet) {
    sheet = ss.insertSheet('Pricing Config');
    sheet.appendRow([
      'Service', 'Current Min Price', 'Recommended Min', 'Current Avg Price',
      'Material Cost', 'Target Margin %', 'Break-Even Price', 'Status',
      'Last Updated', 'CPI Rate %', 'Inflation Adjustment', 'Notes'
    ]);
    sheet.getRange(1, 1, 1, 12).setFontWeight('bold');
    sheet.setFrozenRows(1);
    
    // Seed with default pricing from business plan
    var defaults = [
      ['Lawn Cutting',      34, 34, 45, 1.50, 75, 0, 'OK', '', 0, 0, 'Small garden minimum (+12% Feb 2026)'],
      ['Hedge Trimming',    50, 50, 95, 2.00, 70, 0, 'OK', '', 0, 0, 'Single small hedge minimum (+12%)'],
      ['Lawn Treatment',    39, 39, 67, 12.00, 65, 0, 'OK', '', 0, 0, 'Small garden feed & weed (+12%)'],
      ['Scarifying',        90, 90, 135, 15.00, 60, 0, 'OK', '', 0, 0, 'Small garden minimum (+12%)'],
      ['Garden Clearance', 110, 110, 224, 25.00, 55, 0, 'OK', '', 0, 0, 'Light clearance minimum (+12%)'],
      ['Power Washing',     55, 55, 106, 5.00, 70, 0, 'OK', '', 0, 0, 'Small patio minimum (+12%)'],
      ['Veg Patch Setup',   80, 80, 135, 15.00, 60, 0, 'OK', '', 0, 0, 'Small raised bed prep (+12%)'],
      ['Weeding Treatment', 45, 45, 78, 3.00, 70, 0, 'OK', '', 0, 0, 'Single border minimum (+12%)'],
      ['Fence Repair',      75, 75, 146, 20.00, 55, 0, 'OK', '', 0, 0, 'Single panel replacement (+12%)'],
      ['Emergency Tree Work', 200, 200, 448, 40.00, 50, 0, 'OK', '', 0, 0, 'Small tree call-out'],
      ['Drain Clearance',   50, 50, 84, 5.00, 65, 0, 'OK', '', 0, 0, 'Single blocked drain (+12%)'],
      ['Gutter Cleaning',   50, 50, 73, 2.00, 75, 0, 'OK', '', 0, 0, 'Small terraced house (+12%)'],
      ['Strimming',         45, 45, 78, 2.00, 70, 0, 'OK', '', 0, 0, 'Small area strimming (+12%)'],
      ['Leaf Clearance',    39, 39, 67, 1.00, 75, 0, 'OK', '', 0, 0, 'Small garden leaf clear (+12%)'],
      ['Essential Package', 42, 42, 42, 1.50, 75, 0, 'OK', '', 0, 0, '£42/fortnight subscription — LEGACY'],
      ['Standard Package',  30, 30, 30, 1.50, 75, 0, 'OK', '', 0, 0, '£30/week subscription — LEGACY'],
      ['Premium Package',  144, 144, 144, 5.00, 70, 0, 'OK', '', 0, 0, '£144/month subscription — LEGACY'],
      ['Lawn Care Weekly',  30, 30, 30, 1.50, 80, 0, 'OK', '', 0, 0, '£30/visit weekly subscription'],
      ['Lawn Care Fortnightly', 35, 35, 35, 1.50, 75, 0, 'OK', '', 0, 0, '£35/visit fortnightly subscription'],
      ['Garden Maintenance', 140, 140, 140, 5.00, 70, 0, 'OK', '', 0, 0, '£140/month complete care subscription'],
      ['Property Care',     55, 55, 55, 2.00, 75, 0, 'OK', '', 0, 0, '£55/month exterior maintenance subscription']
    ];
    for (var d = 0; d < defaults.length; d++) {
      sheet.appendRow(defaults[d]);
    }
  }
  return sheet;
}


// ─── Calculate financial snapshot for a given period ───

function calculateFinancials(periodStart, periodEnd, periodLabel) {
  var ss = SpreadsheetApp.openById('1_Y7yHIpAvv_VNBhTrwNOQaBMAGa3UlVW_FKlf56ouHk');
  var jobsSheet = ss.getSheetByName('Jobs');
  var schedSheet = ss.getSheetByName('Schedule');
  var costSheet = ss.getSheetByName('Business Costs');
  
  var data = jobsSheet.getDataRange().getValues();
  var schedData = schedSheet ? schedSheet.getDataRange().getValues() : [];
  var costData = costSheet ? costSheet.getDataRange().getValues() : [];
  
  // Current month key for costs lookup (e.g. "February 2026")
  var months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  var currentMonthKey = months[periodStart.getMonth()] + ' ' + periodStart.getFullYear();
  
  // Find this month's costs
  var monthlyCosts = {
    vehicleInsurance: 100, publicLiability: 25, equipmentMaint: 40,
    vehicleMaint: 60, fuelRate: 0.45, marketing: 30, natInsurance: 0,
    incomeTax: 0, phoneInternet: 25, software: 20, accountancy: 50,
    other: 0, wasteDisposal: 60, treatmentProducts: 65, consumables: 50
  };
  
  for (var c = 1; c < costData.length; c++) {
    if (String(costData[c][0]).indexOf(months[periodStart.getMonth()]) >= 0 ||
        String(costData[c][0]) === currentMonthKey) {
      monthlyCosts.vehicleInsurance = Number(costData[c][1]) || monthlyCosts.vehicleInsurance;
      monthlyCosts.publicLiability = Number(costData[c][2]) || monthlyCosts.publicLiability;
      monthlyCosts.equipmentMaint = Number(costData[c][3]) || monthlyCosts.equipmentMaint;
      monthlyCosts.vehicleMaint = Number(costData[c][4]) || monthlyCosts.vehicleMaint;
      monthlyCosts.fuelRate = Number(costData[c][5]) || monthlyCosts.fuelRate;
      monthlyCosts.marketing = Number(costData[c][6]) || monthlyCosts.marketing;
      monthlyCosts.phoneInternet = Number(costData[c][9]) || monthlyCosts.phoneInternet;
      monthlyCosts.software = Number(costData[c][10]) || monthlyCosts.software;
      monthlyCosts.accountancy = Number(costData[c][11]) || monthlyCosts.accountancy;
      monthlyCosts.other = Number(costData[c][12]) || 0;
      monthlyCosts.wasteDisposal = Number(costData[c][14]) || monthlyCosts.wasteDisposal;
      monthlyCosts.treatmentProducts = Number(costData[c][15]) || monthlyCosts.treatmentProducts;
      monthlyCosts.consumables = Number(costData[c][16]) || monthlyCosts.consumables;
      break;
    }
  }
  
  // Total monthly fixed costs
  var totalMonthlyCosts = monthlyCosts.vehicleInsurance + monthlyCosts.publicLiability
    + monthlyCosts.equipmentMaint + monthlyCosts.vehicleMaint + monthlyCosts.marketing
    + monthlyCosts.phoneInternet + monthlyCosts.software + monthlyCosts.accountancy
    + monthlyCosts.other + monthlyCosts.wasteDisposal + monthlyCosts.treatmentProducts
    + monthlyCosts.consumables;
  
  // Calculate days in period for cost allocation
  var periodDays = Math.max(1, Math.round((periodEnd - periodStart) / 86400000) + 1);
  var daysInMonth = new Date(periodStart.getFullYear(), periodStart.getMonth() + 1, 0).getDate();
  var costAllocationRatio = periodDays / daysInMonth;
  var allocatedCosts = Math.round(totalMonthlyCosts * costAllocationRatio * 100) / 100;
  
  // Scan Jobs sheet for revenue in the period
  var grossRevenue = 0;
  var subRevenue = 0;
  var oneOffRevenue = 0;
  var totalJobs = 0;
  var materialCosts = 0;
  var fuelEstimate = 0;
  var equipmentFuelCost = 0;
  var equipmentWearCost = 0;
  var wasteDisposalCost = 0;
  var serviceBreakdown = {};
  var jobValues = [];
  
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var status = String(row[11] || '').toLowerCase();
    if (status === 'cancelled') continue;
    
    // Parse the booking date
    var bookDate;
    if (row[8] instanceof Date) {
      bookDate = new Date(row[8]);
    } else {
      var dateStr = String(row[8] || '');
      if (!dateStr) continue;
      bookDate = new Date(dateStr + 'T12:00:00');
    }
    bookDate.setHours(0, 0, 0, 0);
    
    if (isNaN(bookDate.getTime())) continue;
    if (bookDate < periodStart || bookDate > periodEnd) continue;
    
    var price = parseFloat(String(row[12] || '0').replace(/[£,]/g, '')) || 0;
    if (price <= 0) continue;
    
    var type = String(row[1] || '').toLowerCase();
    var service = String(row[7] || '');
    var svcKey = service.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    var distance = parseFloat(row[13]) || 0;
    
    grossRevenue += price;
    totalJobs++;
    jobValues.push(price);
    
    if (type.indexOf('subscription') >= 0) {
      subRevenue += price;
    } else {
      oneOffRevenue += price;
    }
    
    // Material costs
    materialCosts += JOB_MATERIAL_COSTS[svcKey] || 3;
    
    // Fuel estimate (distance * 2 for round trip * rate per mile)
    var jobDist = distance > 0 ? distance : CORNWALL_COSTS.avgTravelMiles;
    fuelEstimate += jobDist * 2 * CORNWALL_COSTS.fuelCostPerMile;
    
    // Equipment fuel cost (litres × price per litre)
    equipmentFuelCost += (CORNWALL_COSTS.equipmentFuel[svcKey] || 1) * CORNWALL_COSTS.fuelPricePerLitre;
    
    // Equipment wear cost
    equipmentWearCost += CORNWALL_COSTS.equipmentWear[svcKey] || 1;
    
    // Waste disposal cost
    wasteDisposalCost += CORNWALL_COSTS.wasteDisposal[svcKey] || 0;
    
    // Service breakdown
    if (!serviceBreakdown[service]) {
      serviceBreakdown[service] = { jobs: 0, revenue: 0, avgPrice: 0 };
    }
    serviceBreakdown[service].jobs++;
    serviceBreakdown[service].revenue += price;
  }
  
  // Also scan Schedule for completed visits in the period (subscription visits)
  for (var s = 1; s < schedData.length; s++) {
    var visitDate;
    if (schedData[s][0] instanceof Date) {
      visitDate = new Date(schedData[s][0]);
    } else {
      visitDate = new Date(String(schedData[s][0] || '') + 'T12:00:00');
    }
    visitDate.setHours(0, 0, 0, 0);
    if (isNaN(visitDate.getTime())) continue;
    if (visitDate < periodStart || visitDate > periodEnd) continue;
    
    var schedStatus = String(schedData[s][9] || '').toLowerCase();
    if (schedStatus === 'cancelled') continue;
    if (schedStatus === 'completed' || schedStatus === 'done') {
      // Avoid double-counting — only count if not already in Sheet1 for this date
      var schedService = String(schedData[s][6] || '');
      var schedSvcKey = schedService.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
      materialCosts += JOB_MATERIAL_COSTS[schedSvcKey] || 2;
      var schedDist = parseFloat(schedData[s][5]) || 0;
      fuelEstimate += schedDist * 2 * monthlyCosts.fuelRate;
    }
  }
  
  // Finish service averages
  for (var svc in serviceBreakdown) {
    serviceBreakdown[svc].avgPrice = Math.round(serviceBreakdown[svc].revenue / serviceBreakdown[svc].jobs);
  }
  
  // Payment processing fees (Stripe: 1.4% + 20p per transaction)
  var stripeFeePerTransaction = 0.20;
  var stripeFeeRate = 0.014;
  var stripeFees = Math.round((grossRevenue * stripeFeeRate + totalJobs * stripeFeePerTransaction) * 100) / 100;
  
  // Average job value
  var avgJobValue = totalJobs > 0 ? Math.round(grossRevenue / totalJobs) : 0;
  
  // Annualise revenue for tax calculation
  var annualisedRevenue = (grossRevenue / Math.max(periodDays, 1)) * 365;
  var annualisedCosts = totalMonthlyCosts * 12;
  var annualisedProfit = annualisedRevenue - annualisedCosts;
  
  // Tax reserve calculation (proportion for the period)
  var taxableIncome = Math.max(0, annualisedProfit - UK_TAX.personalAllowance);
  var annualIncomeTax = 0;
  if (taxableIncome > 0) {
    var basicTaxable = Math.min(taxableIncome, UK_TAX.basicBand - UK_TAX.personalAllowance);
    annualIncomeTax = basicTaxable * UK_TAX.basicRate;
    if (taxableIncome > UK_TAX.basicBand - UK_TAX.personalAllowance) {
      annualIncomeTax += (taxableIncome - (UK_TAX.basicBand - UK_TAX.personalAllowance)) * UK_TAX.higherRate;
    }
  }
  var periodTaxReserve = Math.round(annualIncomeTax * (periodDays / 365) * 100) / 100;
  
  // NI reserve
  var annualClass2 = UK_TAX.class2NI * 52;
  var annualClass4 = Math.max(0, Math.min(annualisedProfit, UK_TAX.basicBand) - UK_TAX.personalAllowance) * UK_TAX.class4NIRate;
  if (annualisedProfit > UK_TAX.basicBand) {
    annualClass4 += (annualisedProfit - UK_TAX.basicBand) * UK_TAX.class4NIUpper;
  }
  var periodNIReserve = Math.round((annualClass2 + annualClass4) * (periodDays / 365) * 100) / 100;
  
  // Net profit (now includes equipment fuel, equipment wear, waste disposal)
  var totalDeductions = allocatedCosts + materialCosts + fuelEstimate + equipmentFuelCost + equipmentWearCost + wasteDisposalCost + stripeFees + periodTaxReserve + periodNIReserve;
  var netProfit = Math.round((grossRevenue - totalDeductions) * 100) / 100;
  var profitMargin = grossRevenue > 0 ? Math.round((netProfit / grossRevenue) * 100) : 0;
  
  // Cash to keep (what you can actually spend/save)
  var cashToKeep = Math.round(netProfit * 100) / 100;
  
  // Pricing health check
  var pricingHealth = 'OK';
  if (profitMargin < 50) pricingHealth = 'REVIEW';
  if (profitMargin < 35) pricingHealth = 'WARNING';
  if (profitMargin < 20) pricingHealth = 'CRITICAL';
  if (grossRevenue === 0) pricingHealth = 'NO DATA';
  
  return {
    periodLabel: periodLabel,
    periodStart: periodStart,
    periodEnd: periodEnd,
    periodDays: periodDays,
    grossRevenue: grossRevenue,
    subRevenue: subRevenue,
    oneOffRevenue: oneOffRevenue,
    totalJobs: totalJobs,
    avgJobValue: avgJobValue,
    materialCosts: Math.round(materialCosts * 100) / 100,
    allocatedCosts: allocatedCosts,
    stripeFees: stripeFees,
    fuelEstimate: Math.round(fuelEstimate * 100) / 100,
    equipmentFuelCost: Math.round(equipmentFuelCost * 100) / 100,
    equipmentWearCost: Math.round(equipmentWearCost * 100) / 100,
    wasteDisposalCost: Math.round(wasteDisposalCost * 100) / 100,
    taxReserve: periodTaxReserve,
    niReserve: periodNIReserve,
    netProfit: netProfit,
    profitMargin: profitMargin,
    cashToKeep: cashToKeep,
    pricingHealth: pricingHealth,
    serviceBreakdown: serviceBreakdown,
    monthlyCosts: monthlyCosts,
    totalMonthlyCosts: totalMonthlyCosts,
    annualisedRevenue: Math.round(annualisedRevenue),
    annualisedProfit: Math.round(annualisedProfit),
    annualisedTax: Math.round(annualIncomeTax),
    annualisedNI: Math.round(annualClass2 + annualClass4),
    allocations: {
      taxPot: periodTaxReserve,
      niPot: periodNIReserve,
      runningCosts: allocatedCosts,
      materials: Math.round(materialCosts * 100) / 100,
      fuel: Math.round(fuelEstimate * 100) / 100,
      equipmentFuel: Math.round(equipmentFuelCost * 100) / 100,
      equipmentWear: Math.round(equipmentWearCost * 100) / 100,
      wasteDisposal: Math.round(wasteDisposalCost * 100) / 100,
      stripeFees: stripeFees,
      yourPocket: cashToKeep
    }
  };
}


// ─── YTD (Year to Date) financials from April ───

function calculateYTD() {
  var now = new Date();
  // UK tax year starts 6 April
  var taxYearStart;
  if (now.getMonth() >= 3 && now.getDate() >= 6 || now.getMonth() > 3) {
    taxYearStart = new Date(now.getFullYear(), 3, 6);
  } else {
    taxYearStart = new Date(now.getFullYear() - 1, 3, 6);
  }
  taxYearStart.setHours(0, 0, 0, 0);
  
  var today = new Date();
  today.setHours(23, 59, 59, 999);
  
  return calculateFinancials(taxYearStart, today, 'YTD (Tax Year)');
}


// ─── GET /get_financial_dashboard ───

function getFinancialDashboard(params) {
  var today = new Date();
  today.setHours(0, 0, 0, 0);
  var todayEnd = new Date(today);
  todayEnd.setHours(23, 59, 59, 999);
  
  // This week (Mon-Sun)
  var dayOfWeek = today.getDay();
  var weekStart = new Date(today);
  weekStart.setDate(today.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
  var weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  weekEnd.setHours(23, 59, 59, 999);
  
  // This month
  var monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  var monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0, 23, 59, 59, 999);
  
  var daily = calculateFinancials(today, todayEnd, 'Today');
  var weekly = calculateFinancials(weekStart, weekEnd, 'This Week');
  var monthly = calculateFinancials(monthStart, monthEnd, 'This Month');
  var ytd = calculateYTD();
  
  // Get pricing config
  var pricingSheet = getOrCreatePricingConfig();
  var pricingData = pricingSheet.getDataRange().getValues();
  var pricingConfig = [];
  for (var p = 1; p < pricingData.length; p++) {
    if (!pricingData[p][0]) continue;
    pricingConfig.push({
      service: String(pricingData[p][0]),
      currentMin: Number(pricingData[p][1]) || 0,
      recommendedMin: Number(pricingData[p][2]) || 0,
      currentAvg: Number(pricingData[p][3]) || 0,
      materialCost: Number(pricingData[p][4]) || 0,
      targetMargin: Number(pricingData[p][5]) || 0,
      breakEvenPrice: Number(pricingData[p][6]) || 0,
      status: String(pricingData[p][7] || 'OK'),
      lastUpdated: String(pricingData[p][8] || ''),
      cpiRate: Number(pricingData[p][9]) || 0,
      inflationAdj: Number(pricingData[p][10]) || 0,
      notes: String(pricingData[p][11] || '')
    });
  }
  
  return ContentService.createTextOutput(JSON.stringify({
    status: 'success',
    daily: daily,
    weekly: weekly,
    monthly: monthly,
    ytd: ytd,
    pricingConfig: pricingConfig,
    generated: new Date().toISOString()
  })).setMimeType(ContentService.MimeType.JSON);
}


// ─── POST /run_financial_dashboard (agent call) ───
// Creates/updates rows in the Financial Dashboard sheet

function runFinancialDashboard(data) {
  var dashSheet = getOrCreateFinancialDashboard();
  getOrCreatePricingConfig(); // ensure exists
  
  var today = new Date();
  today.setHours(0, 0, 0, 0);
  var todayEnd = new Date(today);
  todayEnd.setHours(23, 59, 59, 999);
  
  var dayOfWeek = today.getDay();
  var weekStart = new Date(today);
  weekStart.setDate(today.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
  var weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  weekEnd.setHours(23, 59, 59, 999);
  
  var monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  var monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0, 23, 59, 59, 999);
  
  var daily = calculateFinancials(today, todayEnd, 'Daily');
  var weekly = calculateFinancials(weekStart, weekEnd, 'Weekly');
  var monthly = calculateFinancials(monthStart, monthEnd, 'Monthly');
  var ytd = calculateYTD();
  
  var todayISO = normaliseDateToISO(today);
  
  // Write/update rows in Financial Dashboard
  var periods = [
    { label: 'Daily', data: daily },
    { label: 'Weekly', data: weekly },
    { label: 'Monthly', data: monthly }
  ];
  
  var existingData = dashSheet.getDataRange().getValues();
  
  for (var pi = 0; pi < periods.length; pi++) {
    var pd = periods[pi].data;
    var rowData = [
      todayISO, periods[pi].label,
      pd.grossRevenue, pd.subRevenue, pd.oneOffRevenue,
      pd.totalJobs, pd.avgJobValue, pd.materialCosts, pd.allocatedCosts,
      pd.stripeFees, pd.fuelEstimate, pd.taxReserve, pd.niReserve,
      pd.netProfit, pd.profitMargin, pd.cashToKeep, pd.pricingHealth,
      ytd.grossRevenue, ytd.allocatedCosts + ytd.materialCosts + ytd.fuelEstimate + ytd.stripeFees,
      ytd.netProfit,
      'Auto-generated ' + new Date().toISOString().substring(0, 16)
    ];
    
    // Check if a row for this date+period already exists
    var found = false;
    for (var ex = 1; ex < existingData.length; ex++) {
      var exDate = existingData[ex][0] instanceof Date ? normaliseDateToISO(existingData[ex][0]) : String(existingData[ex][0]);
      if (exDate === todayISO && String(existingData[ex][1]) === periods[pi].label) {
        dashSheet.getRange(ex + 1, 1, 1, 21).setValues([rowData]);
        found = true;
        break;
      }
    }
    if (!found) {
      dashSheet.appendRow(rowData);
    }
  }
  
  // Update pricing config with actual averages from monthly data
  if (monthly.serviceBreakdown && Object.keys(monthly.serviceBreakdown).length > 0) {
    var pcSheet = getOrCreatePricingConfig();
    var pcData = pcSheet.getDataRange().getValues();
    
    for (var svc in monthly.serviceBreakdown) {
      var sb = monthly.serviceBreakdown[svc];
      for (var pcr = 1; pcr < pcData.length; pcr++) {
        if (String(pcData[pcr][0]).toLowerCase() === svc.toLowerCase()) {
          pcSheet.getRange(pcr + 1, 4).setValue(sb.avgPrice); // Update current avg
          pcSheet.getRange(pcr + 1, 9).setValue(new Date().toISOString().substring(0, 10)); // Last updated
          break;
        }
      }
    }
  }
  
  return ContentService.createTextOutput(JSON.stringify({
    status: 'success',
    daily: daily,
    weekly: weekly,
    monthly: monthly,
    ytd: ytd
  })).setMimeType(ContentService.MimeType.JSON);
}


// ─── GET /get_pricing_config ───

function getPricingConfig() {
  var sheet = getOrCreatePricingConfig();
  var data = sheet.getDataRange().getValues();
  var config = [];
  for (var i = 1; i < data.length; i++) {
    if (!data[i][0]) continue;
    config.push({
      service: String(data[i][0]),
      currentMin: Number(data[i][1]) || 0,
      recommendedMin: Number(data[i][2]) || 0,
      currentAvg: Number(data[i][3]) || 0,
      materialCost: Number(data[i][4]) || 0,
      targetMargin: Number(data[i][5]) || 0,
      breakEvenPrice: Number(data[i][6]) || 0,
      status: String(data[i][7] || 'OK'),
      lastUpdated: String(data[i][8] || ''),
      cpiRate: Number(data[i][9]) || 0,
      inflationAdj: Number(data[i][10]) || 0,
      notes: String(data[i][11] || '')
    });
  }
  return ContentService.createTextOutput(JSON.stringify({
    status: 'success', config: config
  })).setMimeType(ContentService.MimeType.JSON);
}


// ─── POST /update_pricing_config (agent writes recommendations) ───

function updatePricingConfig(data) {
  var sheet = getOrCreatePricingConfig();
  var existing = sheet.getDataRange().getValues();
  var updates = data.updates || [];
  var updatedCount = 0;
  
  for (var u = 0; u < updates.length; u++) {
    var upd = updates[u];
    if (!upd.service) continue;
    
    var found = false;
    for (var r = 1; r < existing.length; r++) {
      if (String(existing[r][0]).toLowerCase() === String(upd.service).toLowerCase()) {
        if (upd.recommendedMin !== undefined) sheet.getRange(r + 1, 3).setValue(Number(upd.recommendedMin));
        if (upd.breakEvenPrice !== undefined) sheet.getRange(r + 1, 7).setValue(Number(upd.breakEvenPrice));
        if (upd.status !== undefined) sheet.getRange(r + 1, 8).setValue(String(upd.status));
        if (upd.cpiRate !== undefined) sheet.getRange(r + 1, 10).setValue(Number(upd.cpiRate));
        if (upd.inflationAdj !== undefined) sheet.getRange(r + 1, 11).setValue(Number(upd.inflationAdj));
        if (upd.notes !== undefined) sheet.getRange(r + 1, 12).setValue(String(upd.notes));
        sheet.getRange(r + 1, 9).setValue(new Date().toISOString().substring(0, 10)); // Last updated
        found = true;
        updatedCount++;
        break;
      }
    }
    
    // If service not found, add it
    if (!found) {
      sheet.appendRow([
        upd.service, upd.currentMin || 0, upd.recommendedMin || 0, upd.currentAvg || 0,
        upd.materialCost || 0, upd.targetMargin || 70, upd.breakEvenPrice || 0,
        upd.status || 'NEW', new Date().toISOString().substring(0, 10),
        upd.cpiRate || 0, upd.inflationAdj || 0, upd.notes || ''
      ]);
      updatedCount++;
    }
  }
  
  return ContentService.createTextOutput(JSON.stringify({
    status: 'success',
    updated: updatedCount
  })).setMimeType(ContentService.MimeType.JSON);
}


// ============================================
// BUSINESS RECOMMENDATIONS — AI Strategy Tracking
// ============================================

function ensureBusinessRecommendationsSheet() {
  var ss = SpreadsheetApp.openById('1_Y7yHIpAvv_VNBhTrwNOQaBMAGa3UlVW_FKlf56ouHk');
  var sheet = ss.getSheetByName('Business Recommendations');
  if (!sheet) {
    sheet = ss.insertSheet('Business Recommendations');
    sheet.appendRow([
      'ID', 'Date', 'Type', 'Priority', 'Title', 'Description',
      'Action', 'Impact', 'Services Affected', 'Price Changes',
      'Status', 'Applied At', 'Analysis', 'Seasonal Focus', 'Promotion Idea'
    ]);
    sheet.getRange(1, 1, 1, 15).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function saveBusinessRecommendation(data) {
  var sheet = ensureBusinessRecommendationsSheet();
  var recs = data.recommendations || [];
  var analysis = data.analysis || '';
  var seasonalFocus = data.seasonal_focus || '';
  var promotionIdea = data.promotion_idea || '';
  var savedCount = 0;

  for (var i = 0; i < recs.length; i++) {
    var rec = recs[i];
    sheet.appendRow([
      rec.id || ('rec_' + Date.now() + '_' + i),
      new Date().toISOString().substring(0, 10),
      rec.type || '',
      rec.priority || 'medium',
      rec.title || '',
      rec.description || '',
      rec.action || '',
      rec.impact || '',
      JSON.stringify(rec.services_affected || []),
      JSON.stringify(rec.price_changes || []),
      'pending',
      '',
      analysis,
      seasonalFocus,
      promotionIdea
    ]);
    savedCount++;
  }

  return ContentService.createTextOutput(JSON.stringify({
    status: 'success',
    saved: savedCount
  })).setMimeType(ContentService.MimeType.JSON);
}

function getBusinessRecommendations(params) {
  var sheet;
  try {
    sheet = ensureBusinessRecommendationsSheet();
  } catch(e) {
    return ContentService.createTextOutput(JSON.stringify({
      status: 'success',
      recommendations: []
    })).setMimeType(ContentService.MimeType.JSON);
  }

  var data = sheet.getDataRange().getValues();
  var recs = [];
  var limit = parseInt(params.limit) || 50;

  for (var i = Math.max(1, data.length - limit); i < data.length; i++) {
    if (!data[i][0]) continue;
    
    var priceChanges = [];
    try { priceChanges = JSON.parse(data[i][9] || '[]'); } catch(e) {}
    var servicesAffected = [];
    try { servicesAffected = JSON.parse(data[i][8] || '[]'); } catch(e) {}

    recs.push({
      id: String(data[i][0]),
      date: String(data[i][1]),
      type: String(data[i][2]),
      priority: String(data[i][3]),
      title: String(data[i][4]),
      description: String(data[i][5]),
      action: String(data[i][6]),
      impact: String(data[i][7]),
      services_affected: servicesAffected,
      price_changes: priceChanges,
      status: String(data[i][10]),
      applied_at: String(data[i][11]),
      analysis: String(data[i][12]),
      seasonal_focus: String(data[i][13]),
      promotion_idea: String(data[i][14])
    });
  }

  return ContentService.createTextOutput(JSON.stringify({
    status: 'success',
    recommendations: recs
  })).setMimeType(ContentService.MimeType.JSON);
}


// ============================================
// SAVINGS POTS — Track money allocation
// ============================================

function getOrCreateSavingsPots() {
  var ss = SpreadsheetApp.openById('1_Y7yHIpAvv_VNBhTrwNOQaBMAGa3UlVW_FKlf56ouHk');
  var sheet = ss.getSheetByName('Savings Pots');
  if (!sheet) {
    sheet = ss.insertSheet('Savings Pots');
    sheet.appendRow([
      'Pot Name', 'Monthly Target (£)', 'Current Balance (£)', 'Monthly Deposit (£)',
      'Target Balance (£)', '% Funded', 'Calc Method', 'Last Updated', 'Notes'
    ]);
    sheet.getRange(1, 1, 1, 9).setFontWeight('bold');
    sheet.setFrozenRows(1);
    // Seed with default pots
    for (var p = 0; p < SAVINGS_POTS.length; p++) {
      var pot = SAVINGS_POTS[p];
      var targetBal = pot.calcMethod === 'fixed' ? pot.monthlyTarget * 12 : 0;
      sheet.appendRow([
        pot.name, pot.monthlyTarget, 0, 0, targetBal, 0, pot.calcMethod,
        new Date().toISOString().substring(0, 10), pot.notes
      ]);
    }
    sheet.setColumnWidth(1, 180);
    sheet.setColumnWidth(9, 300);
  }
  return sheet;
}

function getSavingsPots() {
  var sheet = getOrCreateSavingsPots();
  var data = sheet.getDataRange().getValues();
  var pots = [];
  for (var i = 1; i < data.length; i++) {
    if (!data[i][0]) continue;
    pots.push({
      name: String(data[i][0]),
      monthlyTarget: Number(data[i][1]) || 0,
      currentBalance: Number(data[i][2]) || 0,
      monthlyDeposit: Number(data[i][3]) || 0,
      targetBalance: Number(data[i][4]) || 0,
      pctFunded: Number(data[i][5]) || 0,
      calcMethod: String(data[i][6] || ''),
      lastUpdated: String(data[i][7] || ''),
      notes: String(data[i][8] || '')
    });
  }
  return ContentService.createTextOutput(JSON.stringify({
    status: 'success', pots: pots
  })).setMimeType(ContentService.MimeType.JSON);
}

function updateSavingsPots(data) {
  var sheet = getOrCreateSavingsPots();
  var existing = sheet.getDataRange().getValues();
  var updates = data.pots || [];
  var count = 0;
  for (var u = 0; u < updates.length; u++) {
    var upd = updates[u];
    if (!upd.name) continue;
    for (var r = 1; r < existing.length; r++) {
      if (String(existing[r][0]).toLowerCase() === String(upd.name).toLowerCase()) {
        if (upd.currentBalance !== undefined) sheet.getRange(r + 1, 3).setValue(Number(upd.currentBalance));
        if (upd.monthlyDeposit !== undefined) sheet.getRange(r + 1, 4).setValue(Number(upd.monthlyDeposit));
        if (upd.targetBalance !== undefined) sheet.getRange(r + 1, 5).setValue(Number(upd.targetBalance));
        if (upd.pctFunded !== undefined) sheet.getRange(r + 1, 6).setValue(Number(upd.pctFunded));
        sheet.getRange(r + 1, 8).setValue(new Date().toISOString().substring(0, 10));
        count++;
        break;
      }
    }
  }
  return ContentService.createTextOutput(JSON.stringify({
    status: 'success', updated: count
  })).setMimeType(ContentService.MimeType.JSON);
}


// ============================================
// JOB COST BREAKDOWN — Full per-service costs
// ============================================

function getJobCostBreakdown() {
  var services = ['lawn-cutting', 'hedge-trimming', 'lawn-treatment', 'scarifying', 'garden-clearance', 'power-washing', 'veg-patch', 'weeding-treatment', 'fence-repair', 'emergency-tree', 'drain-clearance', 'gutter-cleaning'];
  var names = {
    'lawn-cutting': 'Lawn Cutting', 'hedge-trimming': 'Hedge Trimming',
    'lawn-treatment': 'Lawn Treatment', 'scarifying': 'Scarifying',
    'garden-clearance': 'Garden Clearance', 'power-washing': 'Power Washing',
    'veg-patch': 'Veg Patch Setup', 'weeding-treatment': 'Weeding Treatment',
    'fence-repair': 'Fence Repair', 'emergency-tree': 'Emergency Tree Work',
    'drain-clearance': 'Drain Clearance', 'gutter-cleaning': 'Gutter Cleaning'
  };
  
  // Get average distance from recent jobs
  var ss = SpreadsheetApp.openById('1_Y7yHIpAvv_VNBhTrwNOQaBMAGa3UlVW_FKlf56ouHk');
  var jobsSheet = ss.getSheetByName('Jobs');
  var allData = jobsSheet.getDataRange().getValues();
  var svcStats = {};
  for (var i = 1; i < allData.length; i++) {
    var svc = String(allData[i][7] || '').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    var dist = parseFloat(allData[i][13]) || 0;
    var price = parseFloat(String(allData[i][12] || '0').replace(/[£,]/g, '')) || 0;
    var status = String(allData[i][11] || '').toLowerCase();
    if (status === 'cancelled' || price <= 0) continue;
    if (!svcStats[svc]) svcStats[svc] = { distances: [], prices: [], count: 0 };
    svcStats[svc].distances.push(dist);
    svcStats[svc].prices.push(price);
    svcStats[svc].count++;
  }
  
  var breakdown = [];
  for (var s = 0; s < services.length; s++) {
    var key = services[s];
    var stats = svcStats[key] || { distances: [], prices: [], count: 0 };
    
    // Average distance (or Cornwall default)
    var avgDist = CORNWALL_COSTS.avgTravelMiles;
    if (stats.distances.length > 0) {
      var sumDist = 0;
      for (var d = 0; d < stats.distances.length; d++) sumDist += stats.distances[d];
      var calcDist = sumDist / stats.distances.length;
      if (calcDist > 0) avgDist = calcDist;
    }
    
    // Average actual price
    var avgPrice = 0;
    if (stats.prices.length > 0) {
      var sumP = 0;
      for (var pp = 0; pp < stats.prices.length; pp++) sumP += stats.prices[pp];
      avgPrice = Math.round(sumP / stats.prices.length);
    }
    
    // COST BREAKDOWN
    var materialCost = JOB_MATERIAL_COSTS[key] || 3;
    var travelFuel = Math.round(avgDist * 2 * CORNWALL_COSTS.fuelCostPerMile * 100) / 100;
    var equipFuelLitres = CORNWALL_COSTS.equipmentFuel[key] || 1;
    var equipFuelCost = Math.round(equipFuelLitres * CORNWALL_COSTS.fuelPricePerLitre * 100) / 100;
    var equipWear = CORNWALL_COSTS.equipmentWear[key] || 1;
    var waste = CORNWALL_COSTS.wasteDisposal[key] || 0;
    var jobHours = CORNWALL_COSTS.avgJobHours[key] || 2;
    
    // Stripe fee estimate (1.4% + 20p per transaction)
    var stripeFeePerJob = avgPrice > 0 ? Math.round((avgPrice * 0.014 + 0.20) * 100) / 100 : 0.30;
    
    var totalCostPerJob = Math.round((materialCost + travelFuel + equipFuelCost + equipWear + waste + stripeFeePerJob) * 100) / 100;
    
    // Break-even price (cover all costs)
    var breakEven = Math.ceil(totalCostPerJob);
    
    // Target margin price
    var targetMargin = TARGET_MARGINS[key] || 0.65;
    var targetPrice = Math.ceil(totalCostPerJob / (1 - targetMargin));
    
    // Current minimum from pricing config
    var pcSheet = getOrCreatePricingConfig();
    var pcData = pcSheet.getDataRange().getValues();
    var currentMin = 0;
    for (var pc = 1; pc < pcData.length; pc++) {
      if (String(pcData[pc][0]).toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') === key) {
        currentMin = Number(pcData[pc][1]) || 0;
        break;
      }
    }
    
    // Profit per job at current min
    var profitAtMin = currentMin > 0 ? Math.round((currentMin - totalCostPerJob) * 100) / 100 : 0;
    var marginAtMin = currentMin > 0 ? Math.round((profitAtMin / currentMin) * 100) : 0;
    
    breakdown.push({
      service: names[key] || key,
      serviceKey: key,
      avgDistance: Math.round(avgDist * 10) / 10,
      avgPrice: avgPrice,
      jobCount: stats.count,
      jobHours: jobHours,
      costs: {
        materials: materialCost,
        travelFuel: travelFuel,
        equipmentFuel: equipFuelCost,
        equipmentWear: equipWear,
        wasteDisposal: waste,
        stripeFee: stripeFeePerJob,
        total: totalCostPerJob
      },
      breakEvenPrice: breakEven,
      targetPrice: targetPrice,
      targetMargin: Math.round(targetMargin * 100),
      currentMin: currentMin,
      profitAtMin: profitAtMin,
      marginAtMin: marginAtMin,
      status: currentMin >= targetPrice ? 'HEALTHY' : currentMin >= breakEven ? 'LOW MARGIN' : currentMin > 0 ? 'BELOW COST' : 'NOT SET'
    });
  }
  
  return ContentService.createTextOutput(JSON.stringify({
    status: 'success', breakdown: breakdown,
    cornwallCosts: {
      fuelPricePerLitre: CORNWALL_COSTS.fuelPricePerLitre,
      vanMPG: CORNWALL_COSTS.vanMPG,
      fuelCostPerMile: Math.round(CORNWALL_COSTS.fuelCostPerMile * 100) / 100,
      avgTravelMiles: CORNWALL_COSTS.avgTravelMiles
    }
  })).setMimeType(ContentService.MimeType.JSON);
}


// ============================================
// FINANCE SUMMARY — All-in-one for dashboard UI
// ============================================

function getFinanceSummary() {
  var today = new Date();
  today.setHours(0, 0, 0, 0);
  var todayEnd = new Date(today);
  todayEnd.setHours(23, 59, 59, 999);
  
  var dayOfWeek = today.getDay();
  var weekStart = new Date(today);
  weekStart.setDate(today.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
  var weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  weekEnd.setHours(23, 59, 59, 999);
  
  var monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  var monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0, 23, 59, 59, 999);
  
  var daily = calculateFinancials(today, todayEnd, 'Today');
  var weekly = calculateFinancials(weekStart, weekEnd, 'This Week');
  var monthly = calculateFinancials(monthStart, monthEnd, 'This Month');
  var ytd = calculateYTD();
  
  // Pricing config
  var pcSheet = getOrCreatePricingConfig();
  var pcData = pcSheet.getDataRange().getValues();
  var pricingConfig = [];
  for (var p = 1; p < pcData.length; p++) {
    if (!pcData[p][0]) continue;
    pricingConfig.push({
      service: String(pcData[p][0]),
      currentMin: Number(pcData[p][1]) || 0,
      recommendedMin: Number(pcData[p][2]) || 0,
      currentAvg: Number(pcData[p][3]) || 0,
      materialCost: Number(pcData[p][4]) || 0,
      targetMargin: Number(pcData[p][5]) || 0,
      breakEvenPrice: Number(pcData[p][6]) || 0,
      status: String(pcData[p][7] || 'OK')
    });
  }
  
  // Savings pots
  var potSheet = getOrCreateSavingsPots();
  var potData = potSheet.getDataRange().getValues();
  var pots = [];
  for (var i = 1; i < potData.length; i++) {
    if (!potData[i][0]) continue;
    pots.push({
      name: String(potData[i][0]),
      monthlyTarget: Number(potData[i][1]) || 0,
      currentBalance: Number(potData[i][2]) || 0,
      monthlyDeposit: Number(potData[i][3]) || 0,
      targetBalance: Number(potData[i][4]) || 0,
      pctFunded: Number(potData[i][5]) || 0,
      calcMethod: String(potData[i][6] || ''),
      notes: String(potData[i][8] || '')
    });
  }
  
  // Calculate recommended pot deposits based on monthly revenue
  var rev = monthly.grossRevenue;
  var potRecommendations = [];
  for (var sp = 0; sp < SAVINGS_POTS.length; sp++) {
    var def = SAVINGS_POTS[sp];
    var deposit = 0;
    if (def.calcMethod === 'tax') {
      deposit = monthly.taxReserve;
    } else if (def.calcMethod === 'ni') {
      deposit = monthly.niReserve;
    } else if (def.calcMethod === 'pct') {
      deposit = Math.round(rev * (def.pctOfRevenue / 100) * 100) / 100;
    } else {
      deposit = def.monthlyTarget;
    }
    potRecommendations.push({
      name: def.name,
      recommendedDeposit: Math.round(deposit * 100) / 100
    });
  }
  
  // Safe to pay yourself
  var totalBusinessCosts = (monthly.allocations.taxPot || 0) + (monthly.allocations.niPot || 0)
    + (monthly.allocations.runningCosts || 0) + (monthly.allocations.materials || 0)
    + (monthly.allocations.fuel || 0) + (monthly.allocations.stripeFees || 0);
  var totalPotDeposits = 0;
  for (var pd = 0; pd < potRecommendations.length; pd++) {
    if (SAVINGS_POTS[pd].calcMethod !== 'tax' && SAVINGS_POTS[pd].calcMethod !== 'ni') {
      totalPotDeposits += potRecommendations[pd].recommendedDeposit;
    }
  }
  var safeToTake = Math.max(0, rev - totalBusinessCosts - totalPotDeposits);
  
  return ContentService.createTextOutput(JSON.stringify({
    status: 'success',
    daily: daily, weekly: weekly, monthly: monthly, ytd: ytd,
    pricingConfig: pricingConfig,
    savingsPots: pots,
    potRecommendations: potRecommendations,
    safeToPayYourself: Math.round(safeToTake * 100) / 100,
    cornwallCosts: {
      fuelPricePerLitre: CORNWALL_COSTS.fuelPricePerLitre,
      vanMPG: CORNWALL_COSTS.vanMPG,
      fuelCostPerMile: Math.round(CORNWALL_COSTS.fuelCostPerMile * 100) / 100
    },
    generated: new Date().toISOString()
  })).setMimeType(ContentService.MimeType.JSON);
}


// ============================================
// CUSTOMER PORTAL — Magic Link Auth + Account Management
// ============================================

// ─── Auth Tokens Sheet ───
function getOrCreateAuthTokens() {
  var ss = SpreadsheetApp.openById('1_Y7yHIpAvv_VNBhTrwNOQaBMAGa3UlVW_FKlf56ouHk');
  var sheet = ss.getSheetByName('Auth Tokens');
  if (!sheet) {
    sheet = ss.insertSheet('Auth Tokens');
    sheet.appendRow(['Email', 'Token', 'Created', 'Expires', 'Used', 'Session Token', 'Session Expires']);
    sheet.setFrozenRows(1);
    sheet.getRange('1:1').setFontWeight('bold');
    sheet.setColumnWidth(1, 250);
    sheet.setColumnWidth(2, 320);
    sheet.setColumnWidth(6, 320);
  }
  return sheet;
}

// ─── REQUEST LOGIN LINK ───
// Customer enters email → we send a magic link with a one-time token
function requestLoginLink(data) {
  var email = String(data.email || '').toLowerCase().trim();
  if (!email || email.indexOf('@') < 1) {
    return ContentService.createTextOutput(JSON.stringify({
      status: 'error', message: 'Please enter a valid email address'
    })).setMimeType(ContentService.MimeType.JSON);
  }
  
  // Check if this email exists as a customer (Jobs) or subscriber (Subscribers)
  var ss = SpreadsheetApp.openById('1_Y7yHIpAvv_VNBhTrwNOQaBMAGa3UlVW_FKlf56ouHk');
  var jobsSheet = ss.getSheetByName('Jobs');
  var data1 = jobsSheet.getDataRange().getValues();
  var isCustomer = false;
  var customerName = '';
  for (var i = 1; i < data1.length; i++) {
    if (String(data1[i][3] || '').toLowerCase().trim() === email) {
      isCustomer = true;
      customerName = String(data1[i][2] || '');
      break;
    }
  }
  
  // Also check Subscribers sheet
  var subSheet = ss.getSheetByName('Subscribers');
  var isSubscriber = false;
  if (subSheet) {
    var subData = subSheet.getDataRange().getValues();
    for (var s = 1; s < subData.length; s++) {
      if (String(subData[s][0] || '').toLowerCase().trim() === email) {
        isSubscriber = true;
        if (!customerName) customerName = String(subData[s][1] || '');
        break;
      }
    }
  }
  
  if (!isCustomer && !isSubscriber) {
    // Don't reveal whether email exists — always show same message
    return ContentService.createTextOutput(JSON.stringify({
      status: 'success', message: 'If an account exists for this email, a login link has been sent.'
    })).setMimeType(ContentService.MimeType.JSON);
  }
  
  // Generate magic link token
  var token = Utilities.getUuid();
  var now = new Date();
  var expires = new Date(now.getTime() + 30 * 60 * 1000); // 30 minutes
  
  var authSheet = getOrCreateAuthTokens();
  authSheet.appendRow([email, token, now.toISOString(), expires.toISOString(), 'no', '', '']);
  
  // Send magic link email
  var loginUrl = 'https://gardnersgm.co.uk/my-account.html?token=' + token + '&email=' + encodeURIComponent(email);
  
  var html = '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family:Arial,sans-serif;background:#f4f7f4;padding:20px;">'
    + '<div style="max-width:500px;margin:0 auto;background:#fff;border-radius:12px;padding:40px;box-shadow:0 2px 10px rgba(0,0,0,0.08);">'
    + '<div style="text-align:center;margin-bottom:20px;">'
    + '<div style="font-size:42px;">🌿</div>'
    + '<h2 style="color:#2E7D32;margin:10px 0;">Your Login Link</h2>'
    + '</div>'
    + '<p style="color:#333;font-size:15px;line-height:1.6;">Hi ' + (customerName || 'there') + ',</p>'
    + '<p style="color:#555;font-size:15px;line-height:1.6;">Click the button below to access your Gardners Ground Maintenance account. This link expires in 30 minutes.</p>'
    + '<div style="text-align:center;margin:30px 0;">'
    + '<a href="' + loginUrl + '" style="display:inline-block;background:#2E7D32;color:#fff;padding:14px 36px;border-radius:8px;text-decoration:none;font-weight:700;font-size:16px;">Log In to My Account</a>'
    + '</div>'
    + '<p style="color:#999;font-size:12px;line-height:1.5;">If you didn\'t request this, you can safely ignore this email. The link will expire automatically.</p>'
    + '<p style="color:#999;font-size:12px;">If the button doesn\'t work, copy this link:<br><a href="' + loginUrl + '" style="color:#2E7D32;word-break:break-all;">' + loginUrl + '</a></p>'
    + '<hr style="border:none;border-top:1px solid #eee;margin:25px 0;">'
    + '<p style="color:#bbb;font-size:11px;text-align:center;">Gardners Ground Maintenance · Roche, Cornwall PL26 8HN</p>'
    + '</div></body></html>';
  
  try {
    sendEmail({
      to: email,
      toName: '',
      subject: 'Your Login Link — Gardners Ground Maintenance',
      htmlBody: html,
      name: 'Gardners Ground Maintenance',
      replyTo: 'info@gardnersgm.co.uk'
    });
  } catch (mailErr) {
    Logger.log('Magic link email failed: ' + mailErr.message);
  }
  
  return ContentService.createTextOutput(JSON.stringify({
    status: 'success', message: 'If an account exists for this email, a login link has been sent.'
  })).setMimeType(ContentService.MimeType.JSON);
}

// ─── VERIFY LOGIN TOKEN ───
// Customer clicks magic link → verify token → return session token
function verifyLoginToken(data) {
  var token = String(data.token || '').trim();
  var email = String(data.email || '').toLowerCase().trim();
  
  if (!token || !email) {
    return ContentService.createTextOutput(JSON.stringify({
      status: 'error', message: 'Invalid login link'
    })).setMimeType(ContentService.MimeType.JSON);
  }
  
  var authSheet = getOrCreateAuthTokens();
  var authData = authSheet.getDataRange().getValues();
  var now = new Date();
  
  for (var i = 1; i < authData.length; i++) {
    if (String(authData[i][1]) === token && String(authData[i][0]).toLowerCase() === email) {
      // Check if already used
      if (String(authData[i][4]) === 'yes') {
        return ContentService.createTextOutput(JSON.stringify({
          status: 'error', message: 'This login link has already been used. Please request a new one.'
        })).setMimeType(ContentService.MimeType.JSON);
      }
      // Check if expired
      var expires = new Date(authData[i][3]);
      if (now > expires) {
        return ContentService.createTextOutput(JSON.stringify({
          status: 'error', message: 'This login link has expired. Please request a new one.'
        })).setMimeType(ContentService.MimeType.JSON);
      }
      
      // Valid! Mark as used and create session
      var sessionToken = Utilities.getUuid();
      var sessionExpires = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24 hours
      
      authSheet.getRange(i + 1, 5).setValue('yes');
      authSheet.getRange(i + 1, 6).setValue(sessionToken);
      authSheet.getRange(i + 1, 7).setValue(sessionExpires.toISOString());
      
      return ContentService.createTextOutput(JSON.stringify({
        status: 'success',
        sessionToken: sessionToken,
        email: email,
        expiresAt: sessionExpires.toISOString()
      })).setMimeType(ContentService.MimeType.JSON);
    }
  }
  
  return ContentService.createTextOutput(JSON.stringify({
    status: 'error', message: 'Invalid login link. Please request a new one.'
  })).setMimeType(ContentService.MimeType.JSON);
}

// ─── VALIDATE SESSION ───
// Internal helper: checks session token and returns email if valid
function validateSession(sessionToken) {
  if (!sessionToken) return null;
  var authSheet = getOrCreateAuthTokens();
  var authData = authSheet.getDataRange().getValues();
  var now = new Date();
  
  for (var i = 1; i < authData.length; i++) {
    if (String(authData[i][5]) === sessionToken) {
      var sessionExpires = new Date(authData[i][6]);
      if (now <= sessionExpires) {
        return String(authData[i][0]).toLowerCase().trim();
      }
    }
  }
  return null;
}

// ─── GET CUSTOMER PORTAL DATA ───
// Authenticated GET — returns all customer info, bookings, preferences
function getCustomerPortal(params) {
  var sessionToken = params.session || '';
  var email = validateSession(sessionToken);
  
  if (!email) {
    return ContentService.createTextOutput(JSON.stringify({
      status: 'auth_required', message: 'Session expired. Please log in again.'
    })).setMimeType(ContentService.MimeType.JSON);
  }
  
  var ss = SpreadsheetApp.openById('1_Y7yHIpAvv_VNBhTrwNOQaBMAGa3UlVW_FKlf56ouHk');
  
  // ── Get customer bookings from Sheet1 ──
  var jobsSheet = ss.getSheetByName('Jobs');
  var allData = jobsSheet.getDataRange().getValues();
  var bookings = [];
  var profile = { name: '', email: email, phone: '', address: '', postcode: '' };
  
  for (var i = 1; i < allData.length; i++) {
    if (String(allData[i][3] || '').toLowerCase().trim() !== email) continue;
    
    // Build profile from most recent entry
    if (!profile.name || String(allData[i][2] || '')) profile.name = String(allData[i][2] || '');
    if (!profile.phone || String(allData[i][4] || '')) profile.phone = String(allData[i][4] || '');
    if (!profile.address || String(allData[i][5] || '')) profile.address = String(allData[i][5] || '');
    if (!profile.postcode || String(allData[i][6] || '')) profile.postcode = String(allData[i][6] || '');
    
    bookings.push({
      rowIndex: i + 1,
      type: String(allData[i][1] || ''),
      service: String(allData[i][7] || ''),
      date: allData[i][8] ? new Date(allData[i][8]).toISOString() : '',
      time: String(allData[i][9] || ''),
      preferredDay: String(allData[i][10] || ''),
      status: String(allData[i][11] || ''),
      price: String(allData[i][12] || ''),
      jobNumber: String(allData[i][19] || ''),
      notes: String(allData[i][16] || '')
    });
  }
  
  // ── Get scheduled visits ──
  var schedSheet = ss.getSheetByName('Schedule');
  var visits = [];
  if (schedSheet) {
    var schedData = schedSheet.getDataRange().getValues();
    for (var v = 1; v < schedData.length; v++) {
      if (String(schedData[v][2] || '').toLowerCase().trim() !== email) continue;
      visits.push({
        date: schedData[v][0] ? new Date(schedData[v][0]).toISOString() : '',
        service: String(schedData[v][6] || ''),
        package: String(schedData[v][7] || ''),
        status: String(schedData[v][9] || '')
      });
    }
  }
  
  // ── Get email preferences ──
  var prefSheet = ss.getSheetByName('Email Preferences');
  var preferences = { reminders: true, aftercare: true, followUps: true, seasonal: true };
  if (prefSheet) {
    var prefData = prefSheet.getDataRange().getValues();
    for (var p = 1; p < prefData.length; p++) {
      if (String(prefData[p][0] || '').toLowerCase().trim() === email) {
        preferences.reminders = String(prefData[p][1] || 'yes') !== 'no';
        preferences.aftercare = String(prefData[p][2] || 'yes') !== 'no';
        preferences.followUps = String(prefData[p][3] || 'yes') !== 'no';
        preferences.seasonal = String(prefData[p][4] || 'yes') !== 'no';
        break;
      }
    }
  }
  
  // ── Get newsletter status ──
  var subSheet = ss.getSheetByName('Subscribers');
  var newsletter = { subscribed: false, tier: '' };
  if (subSheet) {
    var subData = subSheet.getDataRange().getValues();
    for (var ns = 1; ns < subData.length; ns++) {
      if (String(subData[ns][0] || '').toLowerCase().trim() === email) {
        newsletter.subscribed = String(subData[ns][5] || '') !== 'unsubscribed';
        newsletter.tier = String(subData[ns][2] || '');
        break;
      }
    }
  }
  
  // Sort bookings by date descending
  bookings.sort(function(a, b) {
    return new Date(b.date || 0) - new Date(a.date || 0);
  });
  
  // Sort visits by date ascending (upcoming first)
  visits.sort(function(a, b) {
    return new Date(a.date || 0) - new Date(b.date || 0);
  });
  
  return ContentService.createTextOutput(JSON.stringify({
    status: 'success',
    profile: profile,
    bookings: bookings,
    upcomingVisits: visits.filter(function(v) { return new Date(v.date) >= new Date(); }),
    pastVisits: visits.filter(function(v) { return new Date(v.date) < new Date(); }),
    preferences: preferences,
    newsletter: newsletter
  })).setMimeType(ContentService.MimeType.JSON);
}

// ─── UPDATE CUSTOMER PROFILE ───
function updateCustomerProfile(data) {
  var sessionToken = String(data.sessionToken || '');
  var email = validateSession(sessionToken);
  if (!email) {
    return ContentService.createTextOutput(JSON.stringify({
      status: 'auth_required', message: 'Session expired'
    })).setMimeType(ContentService.MimeType.JSON);
  }
  
  var ss = SpreadsheetApp.openById('1_Y7yHIpAvv_VNBhTrwNOQaBMAGa3UlVW_FKlf56ouHk');
  var jobsSheet = ss.getSheetByName('Jobs');
  var allData = jobsSheet.getDataRange().getValues();
  var updated = 0;
  
  for (var i = 1; i < allData.length; i++) {
    if (String(allData[i][3] || '').toLowerCase().trim() !== email) continue;
    // Update phone, address, postcode on all rows for this customer
    if (data.phone !== undefined) jobsSheet.getRange(i + 1, 5).setValue(data.phone);
    if (data.address !== undefined) jobsSheet.getRange(i + 1, 6).setValue(data.address);
    if (data.postcode !== undefined) jobsSheet.getRange(i + 1, 7).setValue(data.postcode);
    if (data.name !== undefined) jobsSheet.getRange(i + 1, 3).setValue(data.name);
    updated++;
  }
  
  if (updated > 0 && data.name) {
    // Also update Subscribers sheet name
    var subSheet = ss.getSheetByName('Subscribers');
    if (subSheet) {
      var subData = subSheet.getDataRange().getValues();
      for (var s = 1; s < subData.length; s++) {
        if (String(subData[s][0] || '').toLowerCase().trim() === email) {
          subSheet.getRange(s + 1, 2).setValue(data.name);
          break;
        }
      }
    }
  }
  
  return ContentService.createTextOutput(JSON.stringify({
    status: 'success', message: 'Profile updated', rowsUpdated: updated
  })).setMimeType(ContentService.MimeType.JSON);
}

// ─── UPDATE EMAIL PREFERENCES ───
function updateEmailPreferences(data) {
  var sessionToken = String(data.sessionToken || '');
  var email = validateSession(sessionToken);
  if (!email) {
    return ContentService.createTextOutput(JSON.stringify({
      status: 'auth_required', message: 'Session expired'
    })).setMimeType(ContentService.MimeType.JSON);
  }
  
  var ss = SpreadsheetApp.openById('1_Y7yHIpAvv_VNBhTrwNOQaBMAGa3UlVW_FKlf56ouHk');
  
  // ── Service email preferences ──
  var prefSheet = ss.getSheetByName('Email Preferences');
  if (!prefSheet) {
    prefSheet = ss.insertSheet('Email Preferences');
    prefSheet.appendRow(['Email', 'Reminders', 'Aftercare', 'Follow-ups', 'Seasonal', 'Updated']);
    prefSheet.setFrozenRows(1);
  }
  
  var prefs = data.preferences || {};
  var reminders = prefs.reminders !== false ? 'yes' : 'no';
  var aftercare = prefs.aftercare !== false ? 'yes' : 'no';
  var followUps = prefs.followUps !== false ? 'yes' : 'no';
  var seasonal = prefs.seasonal !== false ? 'yes' : 'no';
  
  var prefData = prefSheet.getDataRange().getValues();
  var found = false;
  for (var i = 1; i < prefData.length; i++) {
    if (String(prefData[i][0] || '').toLowerCase().trim() === email) {
      prefSheet.getRange(i + 1, 2, 1, 4).setValues([[reminders, aftercare, followUps, seasonal]]);
      prefSheet.getRange(i + 1, 6).setValue(new Date().toISOString());
      found = true;
      break;
    }
  }
  if (!found) {
    prefSheet.appendRow([email, reminders, aftercare, followUps, seasonal, new Date().toISOString()]);
  }
  
  // ── Newsletter subscription ──
  if (data.newsletter !== undefined) {
    var subSheet = ss.getSheetByName('Subscribers');
    if (subSheet) {
      var subData = subSheet.getDataRange().getValues();
      for (var s = 1; s < subData.length; s++) {
        if (String(subData[s][0] || '').toLowerCase().trim() === email) {
          var newStatus = data.newsletter ? 'active' : 'unsubscribed';
          subSheet.getRange(s + 1, 6).setValue(newStatus);
          break;
        }
      }
    }
  }
  
  return ContentService.createTextOutput(JSON.stringify({
    status: 'success', message: 'Preferences updated'
  })).setMimeType(ContentService.MimeType.JSON);
}

// ─── DELETE CUSTOMER ACCOUNT (GDPR) ───
function deleteCustomerAccount(data) {
  var sessionToken = String(data.sessionToken || '');
  var email = validateSession(sessionToken);
  if (!email) {
    return ContentService.createTextOutput(JSON.stringify({
      status: 'auth_required', message: 'Session expired'
    })).setMimeType(ContentService.MimeType.JSON);
  }
  
  // Require confirmation phrase
  if (String(data.confirmation || '') !== 'DELETE MY ACCOUNT') {
    return ContentService.createTextOutput(JSON.stringify({
      status: 'error', message: 'Please type DELETE MY ACCOUNT to confirm'
    })).setMimeType(ContentService.MimeType.JSON);
  }
  
  var ss = SpreadsheetApp.openById('1_Y7yHIpAvv_VNBhTrwNOQaBMAGa3UlVW_FKlf56ouHk');
  var deletedItems = [];
  
  // ── Anonymise Sheet1 bookings (keep for financial records but scrub personal data) ──
  var jobsSheet = ss.getSheetByName('Jobs');
  var data1 = jobsSheet.getDataRange().getValues();
  for (var i = 1; i < data1.length; i++) {
    if (String(data1[i][3] || '').toLowerCase().trim() === email) {
      jobsSheet.getRange(i + 1, 3).setValue('[Deleted]');  // Name
      jobsSheet.getRange(i + 1, 4).setValue('[deleted@deleted.com]');  // Email
      jobsSheet.getRange(i + 1, 5).setValue('');  // Phone
      jobsSheet.getRange(i + 1, 6).setValue('');  // Address
      jobsSheet.getRange(i + 1, 7).setValue('');  // Postcode
      jobsSheet.getRange(i + 1, 17).setValue('Account deleted ' + new Date().toISOString());
      deletedItems.push('booking-' + String(data1[i][19] || i));
    }
  }
  
  // ── Remove from Subscribers ──
  var subSheet = ss.getSheetByName('Subscribers');
  if (subSheet) {
    var subData = subSheet.getDataRange().getValues();
    for (var s = subData.length - 1; s >= 1; s--) {
      if (String(subData[s][0] || '').toLowerCase().trim() === email) {
        subSheet.deleteRow(s + 1);
        deletedItems.push('subscriber');
      }
    }
  }
  
  // ── Remove from Email Preferences ──
  var prefSheet = ss.getSheetByName('Email Preferences');
  if (prefSheet) {
    var prefData = prefSheet.getDataRange().getValues();
    for (var p = prefData.length - 1; p >= 1; p--) {
      if (String(prefData[p][0] || '').toLowerCase().trim() === email) {
        prefSheet.deleteRow(p + 1);
        deletedItems.push('email-preferences');
      }
    }
  }
  
  // ── Remove from Schedule ──
  var schedSheet = ss.getSheetByName('Schedule');
  if (schedSheet) {
    var schedData = schedSheet.getDataRange().getValues();
    for (var sc = schedData.length - 1; sc >= 1; sc--) {
      if (String(schedData[sc][2] || '').toLowerCase().trim() === email) {
        schedSheet.deleteRow(sc + 1);
        deletedItems.push('schedule-entry');
      }
    }
  }
  
  // ── Invalidate all auth tokens ──
  var authSheet = getOrCreateAuthTokens();
  var authData = authSheet.getDataRange().getValues();
  for (var a = authData.length - 1; a >= 1; a--) {
    if (String(authData[a][0] || '').toLowerCase().trim() === email) {
      authSheet.deleteRow(a + 1);
    }
  }
  
  // ── Anonymise Email Tracking ──
  var trackSheet = ss.getSheetByName('Email Tracking');
  if (trackSheet) {
    var trackData = trackSheet.getDataRange().getValues();
    for (var t = 1; t < trackData.length; t++) {
      if (String(trackData[t][1] || '').toLowerCase().trim() === email) {
        trackSheet.getRange(t + 1, 2).setValue('[deleted]');
        trackSheet.getRange(t + 1, 3).setValue('[Deleted]');
      }
    }
  }
  
  notifyTelegram('🗑️ *ACCOUNT DELETED (GDPR)*\n\nA customer has deleted their account.\nItems removed: ' + deletedItems.length + '\n\n_Personal data anonymised from all sheets_');
  
  return ContentService.createTextOutput(JSON.stringify({
    status: 'success', message: 'Account deleted. All personal data has been removed.', itemsRemoved: deletedItems.length
  })).setMimeType(ContentService.MimeType.JSON);
}


// ============================================
// CHATBOT — SUBSCRIPTION PORTAL (by job number)
// ============================================

function getSubscriptionPortal(params) {
  var jobNumber = String(params.jobNumber || '').toUpperCase();
  if (!jobNumber || !jobNumber.match(/^GGM-\d{4}$/)) {
    return ContentService.createTextOutput(JSON.stringify({
      status: 'error', message: 'Invalid job number. Use format GGM-XXXX'
    })).setMimeType(ContentService.MimeType.JSON);
  }

  var ss = SpreadsheetApp.openById(SHEET_ID);
  var jobsSheet = ss.getSheetByName('Jobs');
  var jobsData = jobsSheet.getDataRange().getValues();
  var sub = null;

  for (var i = 1; i < jobsData.length; i++) {
    if (String(jobsData[i][19] || '').toUpperCase() === jobNumber) {
      sub = {
        name: String(jobsData[i][2] || ''),
        email: String(jobsData[i][3] || ''),
        phone: String(jobsData[i][4] || ''),
        address: String(jobsData[i][5] || ''),
        postcode: String(jobsData[i][6] || ''),
        service: String(jobsData[i][7] || ''),
        status: String(jobsData[i][11] || ''),
        preferredDay: String(jobsData[i][10] || ''),
        type: String(jobsData[i][1] || ''),
        jobNumber: jobNumber
      };
      break;
    }
  }

  if (!sub) {
    return ContentService.createTextOutput(JSON.stringify({
      status: 'not_found', message: 'No subscription found for ' + jobNumber
    })).setMimeType(ContentService.MimeType.JSON);
  }

  // Check it's actually a subscription
  if (sub.type !== 'stripe-subscription' && sub.type !== 'subscription') {
    return ContentService.createTextOutput(JSON.stringify({
      status: 'not_subscription', message: jobNumber + ' is a one-off booking, not a subscription. Use your account at gardnersgm.co.uk/my-account.html'
    })).setMimeType(ContentService.MimeType.JSON);
  }

  if (sub.status.toLowerCase() === 'cancelled') {
    return ContentService.createTextOutput(JSON.stringify({
      status: 'cancelled', message: 'This subscription has been cancelled.'
    })).setMimeType(ContentService.MimeType.JSON);
  }

  // Get upcoming visits from Schedule
  var schedSheet = ss.getSheetByName('Schedule');
  var upcomingVisits = [];
  var lastVisit = null;
  var today = new Date();
  today.setHours(0, 0, 0, 0);

  if (schedSheet && schedSheet.getLastRow() > 1) {
    var schedData = schedSheet.getDataRange().getValues();
    var email = sub.email.toLowerCase().trim();
    for (var v = 1; v < schedData.length; v++) {
      if (String(schedData[v][2] || '').toLowerCase().trim() !== email) continue;
      var vStatus = String(schedData[v][9] || '').toLowerCase();
      var vDate = schedData[v][0] instanceof Date ? schedData[v][0] : new Date(String(schedData[v][0]));
      if (isNaN(vDate.getTime())) continue;

      if (vDate >= today && vStatus !== 'cancelled' && vStatus !== 'skipped') {
        upcomingVisits.push({
          date: Utilities.formatDate(vDate, Session.getScriptTimeZone(), 'EEEE d MMMM yyyy'),
          dateISO: Utilities.formatDate(vDate, Session.getScriptTimeZone(), 'yyyy-MM-dd'),
          service: String(schedData[v][6] || schedData[v][7] || ''),
          status: String(schedData[v][9] || 'Scheduled'),
          notes: String(schedData[v][14] || ''),
          rowIndex: v + 1
        });
        if (upcomingVisits.length >= 3) break;
      }

      if (vDate < today && (vStatus === 'completed' || vStatus === '')) {
        var visitInfo = {
          date: Utilities.formatDate(vDate, Session.getScriptTimeZone(), 'EEEE d MMMM yyyy'),
          service: String(schedData[v][6] || schedData[v][7] || '')
        };
        if (!lastVisit || vDate > new Date(lastVisit.rawDate)) {
          visitInfo.rawDate = vDate.toISOString();
          lastVisit = visitInfo;
        }
      }
    }
  }

  return ContentService.createTextOutput(JSON.stringify({
    status: 'success',
    subscription: {
      name: sub.name,
      package: sub.service,
      preferredDay: sub.preferredDay,
      address: sub.address + (sub.postcode ? ', ' + sub.postcode : ''),
      jobStatus: sub.status,
      jobNumber: jobNumber
    },
    nextVisit: upcomingVisits.length > 0 ? upcomingVisits[0] : null,
    upcomingVisits: upcomingVisits,
    lastVisit: lastVisit
  })).setMimeType(ContentService.MimeType.JSON);
}

// ── Handle subscription change requests from chatbot ──
function handleSubscriptionRequest(data) {
  var jobNumber = String(data.jobNumber || '').toUpperCase();
  var requestType = String(data.requestType || '');
  var details = String(data.details || '');

  if (!jobNumber.match(/^GGM-\d{4}$/)) {
    return ContentService.createTextOutput(JSON.stringify({
      status: 'error', message: 'Invalid job number'
    })).setMimeType(ContentService.MimeType.JSON);
  }

  var ss = SpreadsheetApp.openById(SHEET_ID);
  var schedSheet = ss.getSheetByName('Schedule');
  if (!schedSheet) {
    return ContentService.createTextOutput(JSON.stringify({
      status: 'error', message: 'No schedule found'
    })).setMimeType(ContentService.MimeType.JSON);
  }

  // Find the subscription email from Jobs
  var jobsSheet = ss.getSheetByName('Jobs');
  var jobsData = jobsSheet.getDataRange().getValues();
  var subEmail = '';
  var subName = '';
  var subPackage = '';
  for (var j = 1; j < jobsData.length; j++) {
    if (String(jobsData[j][19] || '').toUpperCase() === jobNumber) {
      subEmail = String(jobsData[j][3] || '').toLowerCase().trim();
      subName = String(jobsData[j][2] || '');
      subPackage = String(jobsData[j][7] || '');
      break;
    }
  }

  if (!subEmail) {
    return ContentService.createTextOutput(JSON.stringify({
      status: 'error', message: 'Subscription not found'
    })).setMimeType(ContentService.MimeType.JSON);
  }

  // Find next upcoming visit for this subscriber
  var schedData = schedSheet.getDataRange().getValues();
  var today = new Date();
  today.setHours(0, 0, 0, 0);
  var nextVisitRow = -1;
  var nextVisitDate = '';

  for (var s = 1; s < schedData.length; s++) {
    if (String(schedData[s][2] || '').toLowerCase().trim() !== subEmail) continue;
    var sStatus = String(schedData[s][9] || '').toLowerCase();
    if (sStatus === 'cancelled' || sStatus === 'skipped') continue;
    var sDate = schedData[s][0] instanceof Date ? schedData[s][0] : new Date(String(schedData[s][0]));
    if (isNaN(sDate.getTime()) || sDate < today) continue;
    nextVisitRow = s + 1;
    nextVisitDate = Utilities.formatDate(sDate, Session.getScriptTimeZone(), 'EEEE d MMMM');
    break;
  }

  var resultMessage = '';

  switch(requestType) {
    case 'change_day':
      // Update preferred day on the Jobs row
      for (var jd = 1; jd < jobsData.length; jd++) {
        if (String(jobsData[jd][19] || '').toUpperCase() === jobNumber) {
          jobsSheet.getRange(jd + 1, 11).setValue(details); // Preferred Day column
          break;
        }
      }
      resultMessage = '✅ Preferred day updated to *' + details + '*. Future visits will be adjusted.';
      break;

    case 'add_service':
      if (nextVisitRow > 0) {
        var existingNotes = String(schedSheet.getRange(nextVisitRow, 15).getValue() || '');
        var newNotes = (existingNotes ? existingNotes + ' | ' : '') + '🔧 Customer requested: ' + details;
        schedSheet.getRange(nextVisitRow, 15).setValue(newNotes);
        resultMessage = '✅ Service request added to your next visit (' + nextVisitDate + '): *' + details + '*';
      } else {
        resultMessage = '⚠️ No upcoming visit found to add this to. Chris will be notified.';
      }
      break;

    case 'add_note':
      if (nextVisitRow > 0) {
        var existNotes = String(schedSheet.getRange(nextVisitRow, 15).getValue() || '');
        var updatedNotes = (existNotes ? existNotes + ' | ' : '') + '💬 Customer note: ' + details;
        schedSheet.getRange(nextVisitRow, 15).setValue(updatedNotes);
        resultMessage = '✅ Note added to your next visit (' + nextVisitDate + '): *' + details + '*';
      } else {
        resultMessage = '⚠️ No upcoming visit found. Chris will be notified.';
      }
      break;

    case 'skip_visit':
      if (nextVisitRow > 0) {
        schedSheet.getRange(nextVisitRow, 10).setValue('Skipped');
        resultMessage = '✅ Your next visit on ' + nextVisitDate + ' has been skipped.';
      } else {
        resultMessage = '⚠️ No upcoming visit found to skip.';
      }
      break;

    default:
      resultMessage = '❓ Unknown request type: ' + requestType;
  }

  // Always notify Chris via Telegram
  notifyTelegram('💬 *SUBSCRIBER REQUEST*\n'
    + '━━━━━━━━━━━━━━━━━━━━\n\n'
    + '👤 ' + subName + '\n'
    + '📦 ' + subPackage + '\n'
    + '🔖 ' + jobNumber + '\n'
    + '📋 *' + requestType.replace(/_/g, ' ').toUpperCase() + '*\n'
    + '💬 ' + details + '\n'
    + (nextVisitDate ? '📅 Next visit: ' + nextVisitDate + '\n' : '')
    + '\n_Via chatbot_');

  return ContentService.createTextOutput(JSON.stringify({
    status: 'success', message: resultMessage
  })).setMimeType(ContentService.MimeType.JSON);
}

// ── Handle chatbot message relay (to Telegram without deleteWebhook) ──
function handleChatbotMessage(data) {
  var message = String(data.message || '');
  var visitorName = String(data.visitorName || 'Website Visitor');
  if (!message) {
    return ContentService.createTextOutput(JSON.stringify({
      status: 'error', message: 'No message provided'
    })).setMimeType(ContentService.MimeType.JSON);
  }

  // Send to Telegram via bot API
  var tgText = '💬 *CHATBOT MESSAGE*\n━━━━━━━━━━━━━━━━━━━━\n\n'
    + '👤 ' + visitorName + '\n'
    + '💬 ' + message + '\n\n'
    + '_Reply to this message to respond in the chatbot_';

  try {
    var tgResp = UrlFetchApp.fetch('https://api.telegram.org/bot' + TG_BOT_TOKEN + '/sendMessage', {
      method: 'post',
      payload: {
        chat_id: TG_CHAT_ID,
        text: tgText,
        parse_mode: 'Markdown'
      }
    });
    var tgData = JSON.parse(tgResp.getContentText());
    var messageId = tgData.ok ? String(tgData.result.message_id) : '';

    return ContentService.createTextOutput(JSON.stringify({
      status: 'success', messageId: messageId
    })).setMimeType(ContentService.MimeType.JSON);
  } catch(tgErr) {
    return ContentService.createTextOutput(JSON.stringify({
      status: 'error', message: 'Failed to relay message: ' + tgErr.message
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

// ── Get chat replies for chatbot polling ──
function getChatReplies(params) {
  var messageId = String(params.messageId || '');
  if (!messageId) {
    return ContentService.createTextOutput(JSON.stringify({
      status: 'success', replies: []
    })).setMimeType(ContentService.MimeType.JSON);
  }

  try {
    var sheet = ensureChatRepliesSheet();
    var data = sheet.getDataRange().getValues();
    var replies = [];

    for (var i = 1; i < data.length; i++) {
      if (String(data[i][1] || '') === messageId && String(data[i][3] || '') === 'pending') {
        replies.push({
          text: String(data[i][2] || ''),
          timestamp: String(data[i][0] || '')
        });
        // Mark as delivered
        sheet.getRange(i + 1, 4).setValue('delivered');
      }
    }

    return ContentService.createTextOutput(JSON.stringify({
      status: 'success', replies: replies
    })).setMimeType(ContentService.MimeType.JSON);
  } catch(err) {
    return ContentService.createTextOutput(JSON.stringify({
      status: 'error', message: err.message
    })).setMimeType(ContentService.MimeType.JSON);
  }
}


// ============================================
// INVOICES SHEET — DEDICATED INVOICE TRACKING
// ============================================

function ensureInvoicesSheet() {
  var ss = SpreadsheetApp.openById('1_Y7yHIpAvv_VNBhTrwNOQaBMAGa3UlVW_FKlf56ouHk');
  var sheet = ss.getSheetByName('Invoices');
  if (!sheet) {
    sheet = ss.insertSheet('Invoices');
    sheet.appendRow([
      'Invoice Number',   // A - GGM-INV-XXXX
      'Job Number',       // B - GGM-XXXX (links to Jobs sheet)
      'Client Name',      // C
      'Email',            // D
      'Amount (£)',        // E
      'Status',           // F - Draft / Sent / Paid / Overdue / Void
      'Stripe Invoice ID', // G - Stripe inv_xxx
      'Payment URL',      // H - Stripe hosted_invoice_url
      'Date Issued',      // I
      'Due Date',         // J
      'Date Paid',        // K
      'Payment Method',   // L - Stripe / Bank Transfer / Cash
      'Before Photos',    // M - comma-separated Drive URLs
      'After Photos',     // N - comma-separated Drive URLs
      'Notes'             // O
    ]);
    // Bold the header row
    sheet.getRange(1, 1, 1, 15).setFontWeight('bold');
    // Freeze header row
    sheet.setFrozenRows(1);
    // Auto-resize columns
    for (var c = 1; c <= 15; c++) sheet.autoResizeColumn(c);
  }
  return sheet;
}

function ensureJobPhotosSheet() {
  var ss = SpreadsheetApp.openById('1_Y7yHIpAvv_VNBhTrwNOQaBMAGa3UlVW_FKlf56ouHk');
  var sheet = ss.getSheetByName('Job Photos');
  if (!sheet) {
    sheet = ss.insertSheet('Job Photos');
    sheet.appendRow([
      'Job Number',     // A - GGM-XXXX
      'Type',           // B - before / after
      'Photo URL',      // C - Google Drive URL
      'File ID',        // D - Drive file ID
      'Telegram File ID', // E
      'Uploaded',       // F - timestamp
      'Caption'         // G - original caption
    ]);
    sheet.getRange(1, 1, 1, 7).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// ── Ensure Chat Replies sheet (for chatbot ↔ Telegram relay) ──
function ensureChatRepliesSheet() {
  var ss = SpreadsheetApp.openById('1_Y7yHIpAvv_VNBhTrwNOQaBMAGa3UlVW_FKlf56ouHk');
  var sheet = ss.getSheetByName('Chat Replies');
  if (!sheet) {
    sheet = ss.insertSheet('Chat Replies');
    sheet.appendRow(['Timestamp', 'Reply To Message ID', 'Reply Text', 'Status']);
    sheet.getRange(1, 1, 1, 4).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// Generate next invoice number (thread-safe)
function generateInvoiceNumber() {
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var sheet = ensureInvoicesSheet();
    var data = sheet.getDataRange().getValues();
    var maxNum = 0;
    for (var i = 1; i < data.length; i++) {
      var inv = String(data[i][0] || '');
      var match = inv.match(/GGM-INV-(\d+)/);
      if (match) {
        var num = parseInt(match[1]);
        if (num > maxNum) maxNum = num;
      }
    }
    var invoiceNum = 'GGM-INV-' + String(maxNum + 1).padStart(4, '0');
    Logger.log('Generated invoice number: ' + invoiceNum);
    return invoiceNum;
  } finally {
    lock.releaseLock();
  }
}

// Log invoice to the Invoices sheet
function logInvoice(invoiceData) {
  var sheet = ensureInvoicesSheet();
  sheet.appendRow([
    invoiceData.invoiceNumber || '',
    invoiceData.jobNumber || '',
    invoiceData.clientName || '',
    invoiceData.email || '',
    invoiceData.amount || 0,
    invoiceData.status || 'Sent',
    invoiceData.stripeInvoiceId || '',
    invoiceData.paymentUrl || '',
    invoiceData.dateIssued || new Date().toISOString(),
    invoiceData.dueDate || '',
    invoiceData.datePaid || '',
    invoiceData.paymentMethod || '',
    invoiceData.beforePhotos || '',
    invoiceData.afterPhotos || '',
    invoiceData.notes || ''
  ]);
}

// Update invoice status (e.g. when Stripe payment comes in)
function updateInvoiceStatus(stripeInvoiceId, newStatus, datePaid, paymentMethod) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
  var sheet = ensureInvoicesSheet();
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][6]) === stripeInvoiceId) {
      sheet.getRange(i + 1, 6).setValue(newStatus);  // Status
      if (datePaid) sheet.getRange(i + 1, 11).setValue(datePaid); // Date Paid
      if (paymentMethod) sheet.getRange(i + 1, 12).setValue(paymentMethod); // Payment Method
      
      // Also update the job in Jobs sheet if we have a job number
      var jobNum = String(data[i][1]);
      if (jobNum && newStatus === 'Paid') {
        markJobAsPaid(jobNum, paymentMethod || 'Stripe');
      }
      return true;
    }
  }
  return false;
  } finally { lock.releaseLock(); }
}

// Update invoice status by invoice number (for non-Stripe payments)
function updateInvoiceByNumber(invoiceNumber, newStatus, datePaid, paymentMethod) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
  var sheet = ensureInvoicesSheet();
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === invoiceNumber) {
      sheet.getRange(i + 1, 6).setValue(newStatus);
      if (datePaid) sheet.getRange(i + 1, 11).setValue(datePaid);
      if (paymentMethod) sheet.getRange(i + 1, 12).setValue(paymentMethod);
      
      var jobNum = String(data[i][1]);
      if (jobNum && newStatus === 'Paid') {
        markJobAsPaid(jobNum, paymentMethod || 'Bank Transfer');
      }
      return true;
    }
  }
  return false;
  } finally { lock.releaseLock(); }
}

// Mark a job as paid on the Jobs sheet
function markJobAsPaid(jobNumber, paymentMethod) {
  var ss = SpreadsheetApp.openById('1_Y7yHIpAvv_VNBhTrwNOQaBMAGa3UlVW_FKlf56ouHk');
  var sheet = ss.getSheetByName('Jobs');
  if (!sheet) return;
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][19]) === jobNumber) {
      sheet.getRange(i + 1, 18).setValue('Yes');            // Col R = Paid
      sheet.getRange(i + 1, 19).setValue(paymentMethod);    // Col S = Payment Type
      sheet.getRange(i + 1, 12).setValue('Completed');      // Col L = Status
      return;
    }
  }
}

// Mark a job as Balance Due (when invoice is generated but not yet paid)
function markJobBalanceDue(jobNumber) {
  var ss = SpreadsheetApp.openById('1_Y7yHIpAvv_VNBhTrwNOQaBMAGa3UlVW_FKlf56ouHk');
  var sheet = ss.getSheetByName('Jobs');
  if (!sheet) return;
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][19]) === jobNumber) {
      sheet.getRange(i + 1, 18).setValue('Balance Due');    // Col R = Paid column
      return;
    }
  }
}

// Get all invoices (for admin dashboard)
function getInvoices() {
  var sheet = ensureInvoicesSheet();
  var data = sheet.getDataRange().getValues();
  var invoices = [];
  for (var i = 1; i < data.length; i++) {
    invoices.push({
      invoiceNumber: data[i][0] || '',
      jobNumber: data[i][1] || '',
      clientName: data[i][2] || '',
      email: data[i][3] || '',
      amount: data[i][4] || 0,
      status: data[i][5] || '',
      stripeInvoiceId: data[i][6] || '',
      paymentUrl: data[i][7] || '',
      dateIssued: data[i][8] || '',
      dueDate: data[i][9] || '',
      datePaid: data[i][10] || '',
      paymentMethod: data[i][11] || '',
      beforePhotos: data[i][12] || '',
      afterPhotos: data[i][13] || '',
      notes: data[i][14] || ''
    });
  }
  return ContentService.createTextOutput(JSON.stringify({
    status: 'success', invoices: invoices
  })).setMimeType(ContentService.MimeType.JSON);
}

// Get photos for a specific job
function getJobPhotos(jobNumber) {
  var sheet = ensureJobPhotosSheet();
  var data = sheet.getDataRange().getValues();
  var photos = { before: [], after: [] };
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === jobNumber) {
      var type = String(data[i][1]).toLowerCase();
      var entry = {
        url: data[i][2] || '',
        fileId: data[i][3] || '',
        uploaded: data[i][5] || '',
        caption: data[i][6] || ''
      };
      if (type === 'before') photos.before.push(entry);
      else if (type === 'after') photos.after.push(entry);
    }
  }
  return photos;
}


// ============================================
// MULTI-BOT TELEGRAM DISPATCHER
// Routes incoming webhooks to the correct bot handler
// ============================================

function handleMultiBotWebhook(e, botName) {
  try {
    var update = JSON.parse(e.postData.contents);
    var message = update.message;
    if (!message) return ContentService.createTextOutput('ok');
    
    // Only process messages from our chat
    if (String(message.chat.id) !== TG_CHAT_ID) {
      return ContentService.createTextOutput('ok');
    }
    
    // ── Dedup guard: prevent Telegram webhook retry loops ──
    // When GAS is slow (spreadsheet ops + API calls), Telegram retries the
    // webhook causing duplicate command processing and repeated messages.
    var updateId = String(update.update_id || '');
    if (updateId) {
      var cache = CacheService.getScriptCache();
      var cacheKey = 'tg_upd_' + botName + '_' + updateId;
      if (cache.get(cacheKey)) {
        Logger.log('Dedup: skipping duplicate update_id ' + updateId + ' for ' + botName);
        return ContentService.createTextOutput('ok');
      }
      cache.put(cacheKey, '1', 300); // Mark as processed for 5 minutes
    }
    
    switch (botName) {
      case 'moneybot':   return handleMoneyBotCommand(message);
      case 'contentbot': return handleContentBotCommand(message);
      case 'coachbot':   return handleCoachBotCommand(message);
      default:           return handleDayBotCommand(message);
    }
  } catch(err) {
    Logger.log('Multi-bot webhook error (' + botName + '): ' + err);
    return ContentService.createTextOutput('ok');
  }
}

// Keep old function name for backwards compat (redirects to DayBot)
function handleTelegramWebhook(e) {
  return handleMultiBotWebhook(e, 'daybot');
}
// ============================================
// DAYBOT — Schedule, Route, Jobs, Photos
// ============================================
function handleDayBotCommand(message) {
  try {
    // Check if the message has a photo
    if (message.photo && message.photo.length > 0) {
      var caption = (message.caption || '').trim();
      
      // Parse caption: expect "GGM-XXXX before" or "GGM-XXXX after"
      var captionMatch = caption.match(/(GGM-\d{4})\s+(before|after)/i);
      if (!captionMatch) {
        // Try just a job number without before/after
        var simpleMatch = caption.match(/(GGM-\d{4})/i);
        if (!simpleMatch) {
          notifyTelegram('📷 Photo received but no job number found.\n\nSend photos with a caption like:\n`GGM-0042 before` or `GGM-0042 after`');
          return ContentService.createTextOutput('ok');
        }
        // Default to 'before' if no type specified
        captionMatch = [null, simpleMatch[1], 'before'];
        notifyTelegram('📷 No before/after specified — saved as *before* photo for ' + simpleMatch[1] + '\n\nTip: Use `' + simpleMatch[1] + ' after` next time');
      }
      
      var jobNumber = captionMatch[1].toUpperCase();
      var photoType = captionMatch[2].toLowerCase();
      
      // Get the largest photo (last in the array)
      var photoObj = message.photo[message.photo.length - 1];
      var fileId = photoObj.file_id;
      
      // Get the file path from Telegram
      var fileInfo = JSON.parse(UrlFetchApp.fetch(
        'https://api.telegram.org/bot' + TG_BOT_TOKEN + '/getFile?file_id=' + fileId
      ).getContentText());
      
      if (!fileInfo.ok || !fileInfo.result.file_path) {
        notifyTelegram('❌ Could not download photo. Try again.');
        return ContentService.createTextOutput('ok');
      }
      
      // Download the photo
      var fileUrl = 'https://api.telegram.org/file/bot' + TG_BOT_TOKEN + '/' + fileInfo.result.file_path;
      var photoBlob = UrlFetchApp.fetch(fileUrl).getBlob();
      
      // Save to Google Drive
      var folderId = getOrCreatePhotosFolder();
      var folder = DriveApp.getFolderById(folderId);
      var fileName = jobNumber + '_' + photoType + '_' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd_HHmmss') + '.jpg';
      photoBlob.setName(fileName);
      var file = folder.createFile(photoBlob);
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      var driveUrl = 'https://drive.google.com/uc?id=' + file.getId();
      
      // Log to Job Photos sheet
      var sheet = ensureJobPhotosSheet();
      sheet.appendRow([
        jobNumber,
        photoType,
        driveUrl,
        file.getId(),
        fileId,
        new Date().toISOString(),
        caption
      ]);
      
      // Also update the Invoices sheet if there's an invoice for this job
      try {
        var invSheet = ensureInvoicesSheet();
        var invData = invSheet.getDataRange().getValues();
        for (var i = 1; i < invData.length; i++) {
          if (String(invData[i][1]) === jobNumber) {
            var colIdx = (photoType === 'before') ? 13 : 14; // M or N
            var existing = String(invData[i][colIdx - 1] || '');
            var newVal = existing ? existing + ', ' + driveUrl : driveUrl;
            invSheet.getRange(i + 1, colIdx).setValue(newVal);
            break;
          }
        }
      } catch(invErr) {}
      
      // Confirm via Telegram
      var emoji = (photoType === 'before') ? '📷' : '✅';
      notifyTelegram(emoji + ' *' + photoType.toUpperCase() + ' photo saved!*\n\n' +
        '🔖 Job: ' + jobNumber + '\n' +
        '📁 [View photo](' + driveUrl + ')\n\n' +
        '_Photo linked to job and available for invoices_');
      
      return ContentService.createTextOutput('ok');
    }
    
    // Handle text commands
    if (message.text) {
      var text = message.text.trim();
      
      // /photos GGM-XXXX — show all photos for a job
      if (text.match(/^\/photos\s+(GGM-\d{4})/i)) {
        var pJobNum = text.match(/^\/photos\s+(GGM-\d{4})/i)[1].toUpperCase();
        var photos = getJobPhotos(pJobNum);
        var msg = '📸 *Photos for ' + pJobNum + '*\n\n';
        
        if (photos.before.length === 0 && photos.after.length === 0) {
          msg += '_No photos found for this job._\n\nSend a photo with caption `' + pJobNum + ' before` or `' + pJobNum + ' after`';
        } else {
          if (photos.before.length > 0) {
            msg += '*Before (' + photos.before.length + '):*\n';
            photos.before.forEach(function(p, idx) {
              msg += (idx + 1) + '. [View](' + p.url + ')\n';
            });
          }
          if (photos.after.length > 0) {
            msg += '\n*After (' + photos.after.length + '):*\n';
            photos.after.forEach(function(p, idx) {
              msg += (idx + 1) + '. [View](' + p.url + ')\n';
            });
          }
        }
        notifyTelegram(msg);
        return ContentService.createTextOutput('ok');
      }
      
      // /invoice GGM-XXXX — trigger invoice for a specific job
      if (text.match(/^\/invoice\s+(GGM-\d{4})/i)) {
        var invJobNum = text.match(/^\/invoice\s+(GGM-\d{4})/i)[1].toUpperCase();
        try {
          var invSS = SpreadsheetApp.openById(SHEET_ID);
          var invSheet = invSS.getSheetByName('Jobs');
          var invData = invSheet.getDataRange().getValues();
          var invRowIdx = -1;
          for (var ij = 1; ij < invData.length; ij++) {
            if (String(invData[ij][19] || '').toUpperCase() === invJobNum) { invRowIdx = ij + 1; break; }
          }
          if (invRowIdx === -1) {
            notifyTelegram('❌ Job `' + invJobNum + '` not found');
            return ContentService.createTextOutput('ok');
          }
          var invRow = invData[invRowIdx - 1];
          var invPaid = String(invRow[17] || '');
          if (invPaid === 'Yes' || invPaid === 'Auto') {
            notifyTelegram('✅ `' + invJobNum + '` is already fully paid — no invoice needed');
            return ContentService.createTextOutput('ok');
          }
          // Set status to Completed and trigger auto-invoice
          invSheet.getRange(invRowIdx, 12).setValue('Completed');
          autoInvoiceOnCompletion(invSheet, invRowIdx);
          notifyTelegram('🧾 Invoice flow triggered for `' + invJobNum + '`\n\n_Completion email + invoice being sent now..._');
        } catch(invErr) {
          notifyTelegram('❌ Invoice error for `' + invJobNum + '`:\n' + invErr.message);
        }
        return ContentService.createTextOutput('ok');
      }
      
      // /invoice <client name> — find and invoice by name
      if (text.match(/^\/invoice\s+(.+)/i) && !text.match(/^\/invoice\s+GGM-/i)) {
        var invName = text.match(/^\/invoice\s+(.+)/i)[1].trim();
        var invResult = findJobsByClientName_(invName, { filterUnpaid: true, todayOnly: true });
        if (invResult.error) { notifyTelegram('❌ Error: ' + invResult.error); return ContentService.createTextOutput('ok'); }
        if (invResult.matches.length === 0) {
          // Widen search to all dates
          invResult = findJobsByClientName_(invName, { filterUnpaid: true });
          if (invResult.matches.length === 0) {
            notifyTelegram('❌ No uninvoiced jobs found for "' + invName + '"\n\nCheck the name or send `/invoice` to see all uninvoiced');
            return ContentService.createTextOutput('ok');
          }
        }
        if (invResult.matches.length === 1) {
          var m = invResult.matches[0];
          try {
            invResult.sheet.getRange(m.rowIdx, 12).setValue('Completed');
            autoInvoiceOnCompletion(invResult.sheet, m.rowIdx);
            notifyTelegram('🧾 Invoice triggered for *' + m.name + '* (`' + m.jobNum + '`)\n\n' + m.service + ' — £' + m.price.toFixed(2) + '\n_Completion email + invoice being sent now..._');
          } catch(invErr) {
            notifyTelegram('❌ Invoice error for ' + m.name + ': ' + invErr.message);
          }
        } else {
          var invMsg = '👤 *Multiple uninvoiced jobs for "' + invName + '":*\n\n';
          for (var im = 0; im < Math.min(invResult.matches.length, 10); im++) {
            var ij2 = invResult.matches[im];
            invMsg += '• `' + ij2.jobNum + '` ' + ij2.name + ' — ' + ij2.service + ' — £' + ij2.price.toFixed(2) + ' (' + ij2.date + ')\n';
          }
          invMsg += '\nSend `/invoice GGM-XXXX` to invoice a specific one';
          notifyTelegram(invMsg);
        }
        return ContentService.createTextOutput('ok');
      }
      
      // /invoice (no job number) — list today's uninvoiced jobs
      if (text.match(/^\/invoice$/i)) {
        try {
          var listSS = SpreadsheetApp.openById(SHEET_ID);
          var listSheet = listSS.getSheetByName('Jobs');
          var listData = listSheet.getDataRange().getValues();
          var todayDate = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
          var uninvoiced = [];
          for (var li = 1; li < listData.length; li++) {
            var liStatus = String(listData[li][11] || '').toLowerCase();
            if (liStatus === 'cancelled' || liStatus === 'completed') continue;
            var liDate = listData[li][8] instanceof Date ? listData[li][8] : new Date(String(listData[li][8]));
            if (isNaN(liDate.getTime())) continue;
            var liDateStr = Utilities.formatDate(liDate, Session.getScriptTimeZone(), 'yyyy-MM-dd');
            if (liDateStr !== todayDate) continue;
            var liPaid = String(listData[li][17] || '');
            if (liPaid === 'Yes' || liPaid === 'Auto') continue;
            var liPrice = parseFloat(String(listData[li][12] || '0').replace(/[^0-9.]/g, '')) || 0;
            if (liPrice <= 0) continue;
            uninvoiced.push({
              jobNum: String(listData[li][19] || ''),
              name: String(listData[li][2] || ''),
              service: String(listData[li][7] || ''),
              price: liPrice
            });
          }
          if (uninvoiced.length === 0) {
            notifyTelegram('✅ *All today\'s jobs are paid or invoiced!*\n\nNothing to invoice.');
          } else {
            var listMsg = '🧾 *Uninvoiced jobs today:*\n\n';
            for (var u = 0; u < uninvoiced.length; u++) {
              listMsg += '• `' + uninvoiced[u].jobNum + '` — ' + uninvoiced[u].name + ' — ' + uninvoiced[u].service + ' — £' + uninvoiced[u].price.toFixed(2) + '\n';
            }
            listMsg += '\nSend `/invoice GGM-XXXX` to invoice a specific job';
            notifyTelegram(listMsg);
          }
        } catch(listErr) {
          notifyTelegram('❌ Error listing jobs: ' + listErr.message);
        }
        return ContentService.createTextOutput('ok');
      }
      
      // /today — re-send today's briefing on demand
      if (text.match(/^\/today$/i)) {
        cloudMorningBriefingToday();
        return ContentService.createTextOutput('ok');
      }
      
      // /tomorrow — show tomorrow's jobs
      if (text.match(/^\/tomorrow$/i)) {
        dayBotBriefingForDate_(1);
        return ContentService.createTextOutput('ok');
      }
      
      // /week — show week overview
      if (text.match(/^\/week$/i)) {
        cloudMorningBriefingWeek();
        return ContentService.createTextOutput('ok');
      }
      
      // /done GGM-XXXX or /done <client name> — mark job completed
      if (text.match(/^\/done\s+(GGM-\d{4})/i)) {
        var doneJob = text.match(/^\/done\s+(GGM-\d{4})/i)[1].toUpperCase();
        dayBotMarkDone_(doneJob);
        return ContentService.createTextOutput('ok');
      }
      if (text.match(/^\/done\s+(.+)/i) && !text.match(/^\/done\s+GGM-/i)) {
        var doneName = text.match(/^\/done\s+(.+)/i)[1].trim();
        var doneResult = findJobsByClientName_(doneName, { filterUnpaid: false, filterActive: true, todayOnly: true });
        if (doneResult.error) { notifyBot('daybot', '❌ Error: ' + doneResult.error); return ContentService.createTextOutput('ok'); }
        if (doneResult.matches.length === 0) {
          // Widen to all dates if nothing today
          doneResult = findJobsByClientName_(doneName, { filterUnpaid: false, filterActive: true });
          if (doneResult.matches.length === 0) {
            notifyBot('daybot', '❌ No active jobs found for "' + doneName + '"\n\nTry `/done GGM-XXXX` or check the name');
            return ContentService.createTextOutput('ok');
          }
        }
        if (doneResult.matches.length === 1) {
          dayBotMarkDone_(doneResult.matches[0].jobNum);
        } else {
          var dMsg = '👤 *Multiple jobs for "' + doneName + '":*\n\n';
          for (var dm = 0; dm < Math.min(doneResult.matches.length, 10); dm++) {
            var dj = doneResult.matches[dm];
            dMsg += '• `' + dj.jobNum + '` ' + dj.name + ' — ' + dj.service + ' — ' + dj.date + '\n';
          }
          dMsg += '\nSend `/done GGM-XXXX` to mark a specific one';
          notifyBot('daybot', dMsg);
        }
        return ContentService.createTextOutput('ok');
      }
      
      // /route — build optimised Google Maps multi-stop link for today
      if (text.match(/^\/route$/i)) {
        dayBotRoute_();
        return ContentService.createTextOutput('ok');
      }
      
      // /late GGM-XXXX 30 — notify customer running late
      if (text.match(/^\/late\s+(GGM-\d{4})\s+(\d+)/i)) {
        var lateMatch = text.match(/^\/late\s+(GGM-\d{4})\s+(\d+)/i);
        dayBotLate_(lateMatch[1].toUpperCase(), parseInt(lateMatch[2]));
        return ContentService.createTextOutput('ok');
      }
      
      // /cancel GGM-XXXX [reason] — cancel job and notify customer
      if (text.match(/^\/cancel\s+(GGM-\d{4})\s*(.*)/i)) {
        var cancelMatch = text.match(/^\/cancel\s+(GGM-\d{4})\s*(.*)/i);
        dayBotCancel_(cancelMatch[1].toUpperCase(), cancelMatch[2] || 'weather');
        return ContentService.createTextOutput('ok');
      }
      
      // /reschedule GGM-XXXX Mon — reschedule a job
      if (text.match(/^\/reschedule\s+(GGM-\d{4})\s+(\w+)/i)) {
        var rescMatch = text.match(/^\/reschedule\s+(GGM-\d{4})\s+(\w+)/i);
        dayBotReschedule_(rescMatch[1].toUpperCase(), rescMatch[2]);
        return ContentService.createTextOutput('ok');
      }
      
      // /help — show available commands
      if (text.match(/^\/help$/i)) {
        notifyBot('daybot', '🌅 *GGM DayBot Commands*\n\n'
          + '📋 *Schedule*\n'
          + '`/today` — Today\'s job briefing\n'
          + '`/tomorrow` — Tomorrow\'s jobs\n'
          + '`/week` — Week overview\n'
          + '`/route` — Google Maps route for today\n\n'
          + '✅ *Job Management*\n'
          + '`/done GGM-XXXX` — Mark job complete\n'
          + '`/done Smith` — Mark done by client name\n'
          + '`/late GGM-XXXX 30` — Tell customer you\'re 30 mins late\n'
          + '`/cancel GGM-XXXX rain` — Cancel job + notify customer\n'
          + '`/reschedule GGM-XXXX Fri` — Move to next Friday\n\n'
          + '📷 *Photos & Invoices*\n'
          + '`/invoice GGM-XXXX` — Complete & invoice a job\n'
          + '`/invoice Smith` — Invoice by client name\n'
          + '`/invoice` — List uninvoiced jobs\n'
          + '`/photos GGM-XXXX` — View job photos\n'
          + '📷 Send photo: `GGM-XXXX before/after`\n'
          + '`/help` — Show this help');
        return ContentService.createTextOutput('ok');
      }
      
      // Unknown slash command → show help hint
      if (text.match(/^\//)) {
        notifyBot('daybot', '🤔 Unknown command: `' + text.split(' ')[0] + '`\n\nSend `/help` to see available commands.');
        return ContentService.createTextOutput('ok');
      }
      
      // Check if it's a chatbot relay message (reply from Chris)
      if (message.reply_to_message) {
        // Store reply for chatbot polling
        try {
          var chatSheet = ensureChatRepliesSheet();
          chatSheet.appendRow([
            new Date().toISOString(),
            String(message.reply_to_message.message_id || ''),
            text,
            'pending'
          ]);
        } catch(chatErr) { Logger.log('Chat reply store error: ' + chatErr); }
        return ContentService.createTextOutput('ok');
      }
    }
    
    return ContentService.createTextOutput('ok');
  } catch(err) {
    Logger.log('DayBot handler error: ' + err);
    return ContentService.createTextOutput('ok');
  }
}

// ── DayBot Helper: Briefing for a future date (N days ahead) ──
function dayBotBriefingForDate_(daysAhead) {
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var jobsSheet = ss.getSheetByName('Jobs');
    if (!jobsSheet || jobsSheet.getLastRow() <= 1) {
      notifyBot('daybot', '📋 *No jobs found* for ' + (daysAhead === 1 ? 'tomorrow' : 'that day'));
      return;
    }
    var data = jobsSheet.getDataRange().getValues();
    var target = new Date();
    target.setDate(target.getDate() + daysAhead);
    var targetStr = Utilities.formatDate(target, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    var dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    var jobs = [];
    var totalRev = 0;
    
    for (var i = 1; i < data.length; i++) {
      var status = String(data[i][11] || '').toLowerCase();
      if (status === 'cancelled' || status === 'completed') continue;
      var jobDate = data[i][8] instanceof Date ? data[i][8] : new Date(String(data[i][8]));
      if (isNaN(jobDate.getTime())) continue;
      var jobDateStr = Utilities.formatDate(jobDate, Session.getScriptTimeZone(), 'yyyy-MM-dd');
      if (jobDateStr !== targetStr) continue;
      var price = parseFloat(String(data[i][12] || '0').replace(/[^0-9.]/g, '')) || 0;
      totalRev += price;
      jobs.push({
        name: String(data[i][2] || ''), service: String(data[i][7] || ''),
        address: String(data[i][5] || ''), postcode: String(data[i][6] || ''),
        time: String(data[i][9] || ''), price: price,
        jobNum: String(data[i][19] || '')
      });
    }
    
    if (jobs.length === 0) {
      notifyBot('daybot', '📋 *' + dayNames[target.getDay()] + ' ' + targetStr.substring(8) + '/' + targetStr.substring(5,7) + '*\n\nNothing booked. Day off! ☀️');
      return;
    }
    
    var msg = '📋 *' + dayNames[target.getDay()] + ' ' + targetStr.substring(8) + '/' + targetStr.substring(5,7) + '*\n';
    msg += '📊 ' + jobs.length + ' job' + (jobs.length > 1 ? 's' : '') + ' | 💷 £' + totalRev.toFixed(0) + '\n\n';
    for (var j = 0; j < jobs.length; j++) {
      msg += (j+1) + '. ' + (jobs[j].jobNum ? '`' + jobs[j].jobNum + '` ' : '') + '*' + jobs[j].service + '*\n';
      msg += '   👤 ' + jobs[j].name;
      if (jobs[j].time) msg += ' | 🕐 ' + jobs[j].time;
      msg += ' | 💷 £' + jobs[j].price.toFixed(0) + '\n';
      if (jobs[j].address) msg += '   📍 ' + jobs[j].address + (jobs[j].postcode ? ', ' + jobs[j].postcode : '') + '\n';
    }
    notifyBot('daybot', msg);
  } catch(e) {
    notifyBot('daybot', '❌ Error: ' + e.message);
  }
}

// ── Shared Helper: Find jobs by client name ──
function findJobsByClientName_(searchName, opts) {
  opts = opts || {};
  var filterUnpaid = opts.filterUnpaid !== false; // default true
  var filterActive = opts.filterActive || false;  // only non-completed
  var todayOnly = opts.todayOnly || false;
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName('Jobs');
    var data = sheet.getDataRange().getValues();
    var search = searchName.toLowerCase().trim();
    var todayStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
    var matches = [];
    for (var i = 1; i < data.length; i++) {
      var clientName = String(data[i][2] || '');
      if (!clientName) continue;
      // Fuzzy match: check if search matches start of first name, last name, or full name
      var nameLower = clientName.toLowerCase();
      var parts = nameLower.split(/\s+/);
      var isMatch = nameLower.indexOf(search) !== -1; // substring match
      if (!isMatch) {
        // Also try matching each word separately
        for (var p = 0; p < parts.length; p++) {
          if (parts[p].indexOf(search) === 0) { isMatch = true; break; }
        }
      }
      if (!isMatch) continue;
      var status = String(data[i][11] || '').toLowerCase();
      if (status === 'cancelled') continue;
      if (filterActive && status === 'completed') continue;
      var paid = String(data[i][17] || '');
      if (filterUnpaid && (paid === 'Yes' || paid === 'Auto')) continue;
      if (todayOnly) {
        var jobDate = data[i][8] instanceof Date ? data[i][8] : new Date(String(data[i][8]));
        if (isNaN(jobDate.getTime())) continue;
        if (Utilities.formatDate(jobDate, Session.getScriptTimeZone(), 'yyyy-MM-dd') !== todayStr) continue;
      }
      var price = parseFloat(String(data[i][12] || '0').replace(/[^0-9.]/g, '')) || 0;
      var jobDate2 = data[i][8] instanceof Date ? data[i][8] : new Date(String(data[i][8]));
      var dateStr = !isNaN(jobDate2.getTime()) ? Utilities.formatDate(jobDate2, Session.getScriptTimeZone(), 'yyyy-MM-dd') : '';
      matches.push({
        rowIdx: i + 1,
        jobNum: String(data[i][19] || ''),
        name: clientName,
        service: String(data[i][7] || ''),
        price: price,
        date: dateStr,
        status: String(data[i][11] || ''),
        paid: paid
      });
    }
    // Sort by date descending (most recent first)
    matches.sort(function(a, b) { return b.date > a.date ? 1 : b.date < a.date ? -1 : 0; });
    return { sheet: sheet, data: data, matches: matches };
  } catch(e) {
    return { sheet: null, data: [], matches: [], error: e.message };
  }
}

// ── DayBot Helper: Mark job done ──
function dayBotMarkDone_(jobNum) {
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName('Jobs');
    var data = sheet.getDataRange().getValues();
    var rowIdx = -1;
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][19] || '').toUpperCase() === jobNum) { rowIdx = i + 1; break; }
    }
    if (rowIdx === -1) { notifyBot('daybot', '❌ Job `' + jobNum + '` not found'); return; }
    var currentStatus = String(data[rowIdx-1][11] || '');
    if (currentStatus.toLowerCase() === 'completed') {
      notifyBot('daybot', '✅ `' + jobNum + '` already marked complete');
      return;
    }
    sheet.getRange(rowIdx, 12).setValue('Completed');
    var paid = String(data[rowIdx-1][17] || '');
    if (paid === 'Yes' || paid === 'Auto') {
      notifyBot('daybot', '✅ *' + jobNum + ' — DONE!*\n\nAlready paid. No invoice needed. 💪');
    } else {
      var price = parseFloat(String(data[rowIdx-1][12] || '0').replace(/[^0-9.]/g, '')) || 0;
      notifyBot('daybot', '✅ *' + jobNum + ' — DONE!*\n\n💷 £' + price.toFixed(2) + ' to collect\n\nSend `/invoice ' + jobNum + '` to email the invoice now');
      // Also trigger auto-invoice
      try { autoInvoiceOnCompletion(sheet, rowIdx); } catch(e) {}
    }
  } catch(e) { notifyBot('daybot', '❌ Error: ' + e.message); }
}

// ── DayBot Helper: Google Maps route ──
function dayBotRoute_() {
  try {
    var HOME_POSTCODE = 'PL26 8HN';
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var jobsSheet = ss.getSheetByName('Jobs');
    var data = jobsSheet.getDataRange().getValues();
    var todayStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
    var stops = [];
    
    for (var i = 1; i < data.length; i++) {
      var status = String(data[i][11] || '').toLowerCase();
      if (status === 'cancelled' || status === 'completed') continue;
      var jobDate = data[i][8] instanceof Date ? data[i][8] : new Date(String(data[i][8]));
      if (isNaN(jobDate.getTime())) continue;
      if (Utilities.formatDate(jobDate, Session.getScriptTimeZone(), 'yyyy-MM-dd') !== todayStr) continue;
      var addr = String(data[i][5] || '') + ', ' + String(data[i][6] || '');
      if (addr.trim() !== ',') stops.push(addr.trim());
    }
    
    // Also check Schedule sheet for subscription visits
    var schedSheet = ss.getSheetByName('Schedule');
    if (schedSheet && schedSheet.getLastRow() > 1) {
      var schedData = schedSheet.getDataRange().getValues();
      for (var s = 1; s < schedData.length; s++) {
        var sStatus = String(schedData[s][9] || '').toLowerCase();
        if (sStatus === 'cancelled' || sStatus === 'skipped') continue;
        var sDate = schedData[s][0] instanceof Date ? schedData[s][0] : new Date(String(schedData[s][0]));
        if (isNaN(sDate.getTime())) continue;
        if (Utilities.formatDate(sDate, Session.getScriptTimeZone(), 'yyyy-MM-dd') !== todayStr) continue;
        var sAddr = String(schedData[s][4] || '') + ', ' + String(schedData[s][5] || '');
        if (sAddr.trim() !== ',') stops.push(sAddr.trim());
      }
    }
    
    if (stops.length === 0) {
      notifyBot('daybot', '🗺 No jobs with addresses today');
      return;
    }
    
    var mapsUrl = 'https://www.google.com/maps/dir/' + encodeURIComponent(HOME_POSTCODE);
    for (var m = 0; m < stops.length; m++) {
      mapsUrl += '/' + encodeURIComponent(stops[m]);
    }
    mapsUrl += '/' + encodeURIComponent(HOME_POSTCODE); // return home
    
    notifyBot('daybot', '🗺 *Today\'s Route — ' + stops.length + ' stops*\n\n[📍 Open in Google Maps](' + mapsUrl + ')\n\nStarts from ' + HOME_POSTCODE + ', returns home.');
  } catch(e) { notifyBot('daybot', '❌ Route error: ' + e.message); }
}

// ── DayBot Helper: Notify customer running late ──
function dayBotLate_(jobNum, mins) {
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName('Jobs');
    var data = sheet.getDataRange().getValues();
    var row = null;
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][19] || '').toUpperCase() === jobNum) { row = data[i]; break; }
    }
    if (!row) { notifyBot('daybot', '❌ Job `' + jobNum + '` not found'); return; }
    var email = String(row[3] || '');
    var name = String(row[2] || 'Customer');
    var firstName = name.split(' ')[0];
    if (!email) { notifyBot('daybot', '⚠️ No email on file for `' + jobNum + '` — call them instead'); return; }
    
    sendEmail({
      to: email,
      toName: '',
      subject: 'Running a bit late — Gardners GM',
      htmlBody: '<div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;padding:20px;">'
        + '<h2 style="color:#2E7D32;">Gardners Ground Maintenance</h2>'
        + '<p>Hi ' + firstName + ',</p>'
        + '<p>Just a quick heads up — I\'m running about <strong>' + mins + ' minutes</strong> behind schedule today. Apologies for the delay!</p>'
        + '<p>I\'ll be with you as soon as I can.</p>'
        + '<p>Cheers,<br>Chris</p></div>',
      name: 'Gardners Ground Maintenance',
      replyTo: 'info@gardnersgm.co.uk'
    });
    notifyBot('daybot', '📨 *Late notification sent* to ' + firstName + ' (' + email + ')\n\n"Running ' + mins + ' mins late"');
  } catch(e) { notifyBot('daybot', '❌ Late notify error: ' + e.message); }
}

// ── DayBot Helper: Cancel job ──
function dayBotCancel_(jobNum, reason) {
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName('Jobs');
    var data = sheet.getDataRange().getValues();
    var rowIdx = -1;
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][19] || '').toUpperCase() === jobNum) { rowIdx = i + 1; break; }
    }
    if (rowIdx === -1) { notifyBot('daybot', '❌ Job `' + jobNum + '` not found'); return; }
    var row = data[rowIdx - 1];
    sheet.getRange(rowIdx, 12).setValue('Cancelled');
    var email = String(row[3] || '');
    var name = String(row[2] || 'Customer');
    var firstName = name.split(' ')[0];
    var service = String(row[7] || 'your appointment');
    
    if (email) {
      sendEmail({
        to: email,
        toName: '',
        subject: 'Appointment Update — Gardners GM',
        htmlBody: '<div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;padding:20px;">'
          + '<h2 style="color:#2E7D32;">Gardners Ground Maintenance</h2>'
          + '<p>Hi ' + firstName + ',</p>'
          + '<p>Unfortunately I need to reschedule your <strong>' + service + '</strong> appointment due to <strong>' + (reason || 'unforeseen circumstances') + '</strong>.</p>'
          + '<p>I\'ll be in touch shortly to arrange a new date.</p>'
          + '<p>Sorry for any inconvenience.</p>'
          + '<p>Cheers,<br>Chris</p></div>',
        name: 'Gardners Ground Maintenance',
        replyTo: 'info@gardnersgm.co.uk'
      });
    }
    notifyBot('daybot', '❌ *' + jobNum + ' — Cancelled*\n\nReason: ' + (reason || 'not specified') + '\n' + (email ? '📨 Customer notified at ' + email : '⚠️ No email — call customer'));
  } catch(e) { notifyBot('daybot', '❌ Cancel error: ' + e.message); }
}

// ── DayBot Helper: Reschedule job ──
function dayBotReschedule_(jobNum, dayName) {
  try {
    var dayMap = {mon:'Monday',tue:'Tuesday',wed:'Wednesday',thu:'Thursday',fri:'Friday',sat:'Saturday',sun:'Sunday',
                  monday:'Monday',tuesday:'Tuesday',wednesday:'Wednesday',thursday:'Thursday',friday:'Friday',saturday:'Saturday',sunday:'Sunday'};
    var targetDay = dayMap[dayName.toLowerCase()];
    if (!targetDay) { notifyBot('daybot', '❌ Unknown day: ' + dayName + '\n\nUse: Mon, Tue, Wed, Thu, Fri, Sat'); return; }
    
    var dayIdx = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'].indexOf(targetDay);
    var next = new Date();
    while (next.getDay() !== dayIdx || next.toDateString() === new Date().toDateString()) {
      next.setDate(next.getDate() + 1);
    }
    var newDateStr = Utilities.formatDate(next, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    var newDateFriendly = Utilities.formatDate(next, Session.getScriptTimeZone(), 'EEEE, d MMMM yyyy');
    
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName('Jobs');
    var data = sheet.getDataRange().getValues();
    var rowIdx = -1;
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][19] || '').toUpperCase() === jobNum) { rowIdx = i + 1; break; }
    }
    if (rowIdx === -1) { notifyBot('daybot', '❌ Job `' + jobNum + '` not found'); return; }
    
    sheet.getRange(rowIdx, 9).setValue(newDateStr); // Column I = date
    sheet.getRange(rowIdx, 12).setValue('Confirmed'); // Reset status
    
    var email = String(data[rowIdx-1][3] || '');
    var name = String(data[rowIdx-1][2] || 'Customer');
    var firstName = name.split(' ')[0];
    
    if (email) {
      sendEmail({
        to: email,
        toName: '',
        subject: 'Appointment Rescheduled — Gardners GM',
        htmlBody: '<div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;padding:20px;">'
          + '<h2 style="color:#2E7D32;">Gardners Ground Maintenance</h2>'
          + '<p>Hi ' + firstName + ',</p>'
          + '<p>Your appointment has been moved to <strong>' + newDateFriendly + '</strong>.</p>'
          + '<p>If this doesn\'t work for you, just reply to this email or give me a call.</p>'
          + '<p>Cheers,<br>Chris</p></div>',
        name: 'Gardners Ground Maintenance',
        replyTo: 'info@gardnersgm.co.uk'
      });
    }
    notifyBot('daybot', '📅 *' + jobNum + ' rescheduled*\n\n➡️ ' + newDateFriendly + '\n' + (email ? '📨 Customer notified' : '⚠️ No email — tell customer'));
  } catch(e) { notifyBot('daybot', '❌ Reschedule error: ' + e.message); }
}


// ============================================
// MONEYBOT — Finance, Invoices, Quotes
// ============================================
function handleMoneyBotCommand(message) {
  try {
    var text = (message.text || '').trim();
    if (!text) return ContentService.createTextOutput('ok');
    
    // /money — today's financial snapshot
    if (text.match(/^\/money$/i) || text.match(/^\/start$/i)) {
      moneyBotSnapshot_('today');
      return ContentService.createTextOutput('ok');
    }
    
    // /week — weekly summary
    if (text.match(/^\/week$/i)) {
      moneyBotSnapshot_('week');
      return ContentService.createTextOutput('ok');
    }
    
    // /month — monthly summary
    if (text.match(/^\/month$/i)) {
      moneyBotSnapshot_('month');
      return ContentService.createTextOutput('ok');
    }
    
    // /invoice GGM-XXXX — invoice a specific job
    if (text.match(/^\/invoice\s+(GGM-\d{4})/i)) {
      var invJobNum = text.match(/^\/invoice\s+(GGM-\d{4})/i)[1].toUpperCase();
      moneyBotInvoice_(invJobNum);
      return ContentService.createTextOutput('ok');
    }
    
    // /invoice <client name> — find and invoice by name
    if (text.match(/^\/invoice\s+(.+)/i) && !text.match(/^\/invoice\s+GGM-/i)) {
      var mbInvName = text.match(/^\/invoice\s+(.+)/i)[1].trim();
      var mbResult = findJobsByClientName_(mbInvName, { filterUnpaid: true, todayOnly: true });
      if (mbResult.error) { notifyBot('moneybot', '❌ Error: ' + mbResult.error); return ContentService.createTextOutput('ok'); }
      if (mbResult.matches.length === 0) {
        mbResult = findJobsByClientName_(mbInvName, { filterUnpaid: true });
        if (mbResult.matches.length === 0) {
          notifyBot('moneybot', '❌ No uninvoiced jobs for "' + mbInvName + '"\n\nSend `/invoices` to see all uninvoiced');
          return ContentService.createTextOutput('ok');
        }
      }
      if (mbResult.matches.length === 1) {
        var mbM = mbResult.matches[0];
        try {
          mbResult.sheet.getRange(mbM.rowIdx, 12).setValue('Completed');
          try { autoInvoiceOnCompletion(mbResult.sheet, mbM.rowIdx); } catch(e) {}
          notifyBot('moneybot', '🧾 *Invoice triggered for ' + mbM.name + '* (`' + mbM.jobNum + '`)\n\n' + mbM.service + ' — £' + mbM.price.toFixed(2) + '\nCompletion email + invoice being sent.');
        } catch(mbErr) {
          notifyBot('moneybot', '❌ Invoice error for ' + mbM.name + ': ' + mbErr.message);
        }
      } else {
        var mbMsg = '👤 *Multiple uninvoiced jobs for "' + mbInvName + '":*\n\n';
        var mbTotal = 0;
        for (var mi = 0; mi < Math.min(mbResult.matches.length, 10); mi++) {
          var mj = mbResult.matches[mi];
          mbMsg += '• `' + mj.jobNum + '` ' + mj.name + ' — ' + mj.service + ' — *£' + mj.price.toFixed(2) + '* (' + mj.date + ')\n';
          mbTotal += mj.price;
        }
        mbMsg += '\n💷 Total: *£' + mbTotal.toFixed(2) + '*\nSend `/invoice GGM-XXXX` to invoice one';
        notifyBot('moneybot', mbMsg);
      }
      return ContentService.createTextOutput('ok');
    }
    
    // /invoice — list uninvoiced
    if (text.match(/^\/invoice$/i) || text.match(/^\/invoices$/i)) {
      moneyBotUninvoiced_();
      return ContentService.createTextOutput('ok');
    }
    
    // /paid — today's payments
    if (text.match(/^\/paid$/i)) {
      moneyBotPaid_();
      return ContentService.createTextOutput('ok');
    }
    
    // /overdue — list overdue unpaid invoices
    if (text.match(/^\/overdue$/i)) {
      moneyBotOverdue_();
      return ContentService.createTextOutput('ok');
    }
    
    // /tax — tax set-aside summary
    if (text.match(/^\/tax$/i)) {
      moneyBotTax_();
      return ContentService.createTextOutput('ok');
    }
    
    // /help
    if (text.match(/^\/help$/i)) {
      notifyBot('moneybot', '💰 *GGM MoneyBot Commands*\n\n'
        + '`/money` — Today\'s financial snapshot\n'
        + '`/week` — This week\'s summary\n'
        + '`/month` — This month\'s summary\n'
        + '`/invoice GGM-XXXX` — Invoice a job\n'
        + '`/invoice Smith` — Invoice by client name\n'
        + '`/invoices` — List all uninvoiced jobs\n'
        + '`/paid` — Today\'s payments received\n'
        + '`/overdue` — Overdue unpaid invoices\n'
        + '`/tax` — Tax/NI set-aside total\n'
        + '`/help` — Show this help');
      return ContentService.createTextOutput('ok');
    }
    
    // Unknown slash command → show help hint
    if (text.match(/^\//)) {
      notifyBot('moneybot', '🤔 Unknown command: `' + text.split(' ')[0] + '`\n\nSend `/help` to see available commands.');
    }
    return ContentService.createTextOutput('ok');
  } catch(err) {
    Logger.log('MoneyBot error: ' + err);
    notifyBot('moneybot', '❌ Error: ' + err.message);
    return ContentService.createTextOutput('ok');
  }
}

// ── MoneyBot Helper: Financial snapshot ──
function moneyBotSnapshot_(period) {
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName('Jobs');
    if (!sheet || sheet.getLastRow() <= 1) { notifyBot('moneybot', '💰 No job data found'); return; }
    var data = sheet.getDataRange().getValues();
    var now = new Date();
    var todayStr = Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    
    // Calculate period boundaries
    var startDate, periodLabel;
    if (period === 'week') {
      startDate = new Date(now);
      startDate.setDate(startDate.getDate() - startDate.getDay() + 1); // Monday
      periodLabel = 'THIS WEEK';
    } else if (period === 'month') {
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      periodLabel = 'THIS MONTH';
    } else {
      startDate = now;
      periodLabel = 'TODAY';
    }
    var startStr = Utilities.formatDate(startDate, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    
    var totalRev = 0, totalPaid = 0, totalOwed = 0, jobCount = 0, completedCount = 0;
    for (var i = 1; i < data.length; i++) {
      var jobDate = data[i][8] instanceof Date ? data[i][8] : new Date(String(data[i][8]));
      if (isNaN(jobDate.getTime())) continue;
      var jStr = Utilities.formatDate(jobDate, Session.getScriptTimeZone(), 'yyyy-MM-dd');
      if (period === 'today' && jStr !== todayStr) continue;
      if (period !== 'today' && jStr < startStr) continue;
      if (jStr > todayStr) continue;
      
      var status = String(data[i][11] || '').toLowerCase();
      if (status === 'cancelled') continue;
      
      var price = parseFloat(String(data[i][12] || '0').replace(/[^0-9.]/g, '')) || 0;
      var paid = String(data[i][17] || '');
      jobCount++;
      totalRev += price;
      if (paid === 'Yes' || paid === 'Auto') { totalPaid += price; completedCount++; }
      else totalOwed += price;
    }
    
    var taxRate = 0.20; // 20% income tax estimate
    var niRate = 0.06;  // Class 4 NI estimate
    var fuelEst = jobCount * 3.50; // rough fuel per job
    var taxSetAside = totalPaid * taxRate;
    var niSetAside = totalPaid * niRate;
    var pocket = totalPaid - taxSetAside - niSetAside - fuelEst;
    
    var msg = '💰 *' + periodLabel + '*\n━━━━━━━━━━━━━━━━━━━━\n';
    msg += '📊 Jobs: ' + jobCount + ' | Completed: ' + completedCount + '\n';
    msg += '💷 Revenue: *£' + totalRev.toFixed(2) + '*\n';
    msg += '✅ Paid: £' + totalPaid.toFixed(2) + '\n';
    if (totalOwed > 0) msg += '⚡ Owed: *£' + totalOwed.toFixed(2) + '*\n';
    msg += '\n💼 *Breakdown (from paid):*\n';
    msg += '  🏛 Tax (20%): £' + taxSetAside.toFixed(2) + '\n';
    msg += '  🏥 NI (6%): £' + niSetAside.toFixed(2) + '\n';
    msg += '  ⛽ Fuel est: £' + fuelEst.toFixed(2) + '\n';
    msg += '  👛 *Your pocket: £' + pocket.toFixed(2) + '*\n';
    
    notifyBot('moneybot', msg);
  } catch(e) { notifyBot('moneybot', '❌ Snapshot error: ' + e.message); }
}

// ── MoneyBot Helper: Invoice a job ──
function moneyBotInvoice_(jobNum) {
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName('Jobs');
    var data = sheet.getDataRange().getValues();
    var rowIdx = -1;
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][19] || '').toUpperCase() === jobNum) { rowIdx = i + 1; break; }
    }
    if (rowIdx === -1) { notifyBot('moneybot', '❌ Job `' + jobNum + '` not found'); return; }
    var row = data[rowIdx - 1];
    var paid = String(row[17] || '');
    if (paid === 'Yes' || paid === 'Auto') {
      notifyBot('moneybot', '✅ `' + jobNum + '` already paid — no invoice needed');
      return;
    }
    sheet.getRange(rowIdx, 12).setValue('Completed');
    try { autoInvoiceOnCompletion(sheet, rowIdx); } catch(e) {}
    notifyBot('moneybot', '🧾 *Invoice triggered for ' + jobNum + '*\n\nCompletion email + invoice being sent.');
  } catch(e) { notifyBot('moneybot', '❌ Invoice error: ' + e.message); }
}

// ── MoneyBot Helper: List uninvoiced jobs ──
function moneyBotUninvoiced_() {
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName('Jobs');
    var data = sheet.getDataRange().getValues();
    var todayStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
    var uninvoiced = [];
    for (var i = 1; i < data.length; i++) {
      var status = String(data[i][11] || '').toLowerCase();
      if (status === 'cancelled') continue;
      var jobDate = data[i][8] instanceof Date ? data[i][8] : new Date(String(data[i][8]));
      if (isNaN(jobDate.getTime())) continue;
      var jStr = Utilities.formatDate(jobDate, Session.getScriptTimeZone(), 'yyyy-MM-dd');
      if (jStr > todayStr) continue;
      var paid = String(data[i][17] || '');
      if (paid === 'Yes' || paid === 'Auto') continue;
      var price = parseFloat(String(data[i][12] || '0').replace(/[^0-9.]/g, '')) || 0;
      if (price <= 0) continue;
      uninvoiced.push({ jobNum: String(data[i][19] || ''), name: String(data[i][2] || ''),
        service: String(data[i][7] || ''), price: price, date: jStr });
    }
    if (uninvoiced.length === 0) {
      notifyBot('moneybot', '✅ *All jobs paid or invoiced!*');
    } else {
      var msg = '🧾 *Uninvoiced jobs (' + uninvoiced.length + '):*\n\n';
      var total = 0;
      for (var u = 0; u < Math.min(uninvoiced.length, 20); u++) {
        msg += '• `' + uninvoiced[u].jobNum + '` ' + uninvoiced[u].name + ' — ' + uninvoiced[u].service + ' — *£' + uninvoiced[u].price.toFixed(2) + '*\n';
        total += uninvoiced[u].price;
      }
      if (uninvoiced.length > 20) msg += '... and ' + (uninvoiced.length - 20) + ' more\n';
      msg += '\n💷 Total: *£' + total.toFixed(2) + '*\nSend `/invoice GGM-XXXX` to invoice';
      notifyBot('moneybot', msg);
    }
  } catch(e) { notifyBot('moneybot', '❌ Error: ' + e.message); }
}

// ── MoneyBot Helper: Today's payments ──
function moneyBotPaid_() {
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName('Jobs');
    var data = sheet.getDataRange().getValues();
    var todayStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
    var paid = [];
    for (var i = 1; i < data.length; i++) {
      var jobDate = data[i][8] instanceof Date ? data[i][8] : new Date(String(data[i][8]));
      if (isNaN(jobDate.getTime())) continue;
      if (Utilities.formatDate(jobDate, Session.getScriptTimeZone(), 'yyyy-MM-dd') !== todayStr) continue;
      var paidStatus = String(data[i][17] || '');
      if (paidStatus !== 'Yes' && paidStatus !== 'Auto') continue;
      var price = parseFloat(String(data[i][12] || '0').replace(/[^0-9.]/g, '')) || 0;
      paid.push({ jobNum: String(data[i][19] || ''), name: String(data[i][2] || ''), price: price });
    }
    if (paid.length === 0) {
      notifyBot('moneybot', '💳 No payments received today yet');
    } else {
      var total = 0;
      var msg = '💳 *Payments today:*\n\n';
      for (var p = 0; p < paid.length; p++) {
        msg += '✅ `' + paid[p].jobNum + '` ' + paid[p].name + ' — *£' + paid[p].price.toFixed(2) + '*\n';
        total += paid[p].price;
      }
      msg += '\n💷 Total received: *£' + total.toFixed(2) + '*';
      notifyBot('moneybot', msg);
    }
  } catch(e) { notifyBot('moneybot', '❌ Error: ' + e.message); }
}

// ── MoneyBot Helper: Overdue invoices ──
function moneyBotOverdue_() {
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName('Jobs');
    var data = sheet.getDataRange().getValues();
    var now = new Date();
    var overdue = [];
    for (var i = 1; i < data.length; i++) {
      var status = String(data[i][11] || '').toLowerCase();
      if (status === 'cancelled') continue;
      var paid = String(data[i][17] || '');
      if (paid === 'Yes' || paid === 'Auto') continue;
      var price = parseFloat(String(data[i][12] || '0').replace(/[^0-9.]/g, '')) || 0;
      if (price <= 0) continue;
      var jobDate = data[i][8] instanceof Date ? data[i][8] : new Date(String(data[i][8]));
      if (isNaN(jobDate.getTime())) continue;
      var daysDiff = Math.floor((now - jobDate) / (1000 * 60 * 60 * 24));
      if (daysDiff < 3) continue; // Only count 3+ days overdue
      overdue.push({ jobNum: String(data[i][19] || ''), name: String(data[i][2] || ''),
        service: String(data[i][7] || ''), price: price, daysOverdue: daysDiff });
    }
    overdue.sort(function(a,b) { return b.daysOverdue - a.daysOverdue; });
    
    if (overdue.length === 0) {
      notifyBot('moneybot', '✅ No overdue invoices! All caught up.');
    } else {
      var total = 0;
      var msg = '⚠️ *Overdue Invoices (' + overdue.length + '):*\n\n';
      for (var o = 0; o < Math.min(overdue.length, 15); o++) {
        var emoji = overdue[o].daysOverdue > 14 ? '🔴' : overdue[o].daysOverdue > 7 ? '🟡' : '🟠';
        msg += emoji + ' `' + overdue[o].jobNum + '` ' + overdue[o].name + ' — *£' + overdue[o].price.toFixed(2) + '* (' + overdue[o].daysOverdue + ' days)\n';
        total += overdue[o].price;
      }
      msg += '\n💷 Total overdue: *£' + total.toFixed(2) + '*';
      notifyBot('moneybot', msg);
    }
  } catch(e) { notifyBot('moneybot', '❌ Error: ' + e.message); }
}

// ── MoneyBot Helper: Tax set-aside ──
function moneyBotTax_() {
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName('Jobs');
    var data = sheet.getDataRange().getValues();
    var now = new Date();
    // Tax year: April 6 to April 5
    var taxYearStart = now.getMonth() >= 3 && (now.getMonth() > 3 || now.getDate() >= 6)
      ? new Date(now.getFullYear(), 3, 6) : new Date(now.getFullYear() - 1, 3, 6);
    var startStr = Utilities.formatDate(taxYearStart, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    
    var totalIncome = 0, monthIncome = 0;
    var monthStr = Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyy-MM');
    for (var i = 1; i < data.length; i++) {
      var paid = String(data[i][17] || '');
      if (paid !== 'Yes' && paid !== 'Auto') continue;
      var jobDate = data[i][8] instanceof Date ? data[i][8] : new Date(String(data[i][8]));
      if (isNaN(jobDate.getTime())) continue;
      var jStr = Utilities.formatDate(jobDate, Session.getScriptTimeZone(), 'yyyy-MM-dd');
      if (jStr < startStr) continue;
      var price = parseFloat(String(data[i][12] || '0').replace(/[^0-9.]/g, '')) || 0;
      totalIncome += price;
      if (jStr.substring(0, 7) === monthStr) monthIncome += price;
    }
    
    var personalAllowance = 12570;
    var taxable = Math.max(0, totalIncome - personalAllowance);
    var tax = taxable * 0.20;
    var ni = Math.max(0, totalIncome - 12570) * 0.06; // Class 4 simplified
    
    var msg = '🏛 *Tax Year Summary*\n';
    msg += '📅 ' + Utilities.formatDate(taxYearStart, Session.getScriptTimeZone(), 'd MMM yyyy') + ' → now\n';
    msg += '━━━━━━━━━━━━━━━━━━━━\n';
    msg += '💷 Total income: *£' + totalIncome.toFixed(2) + '*\n';
    msg += '📅 This month: £' + monthIncome.toFixed(2) + '\n\n';
    msg += '🏛 Personal allowance: £' + personalAllowance.toLocaleString() + '\n';
    msg += '📊 Taxable income: £' + taxable.toFixed(2) + '\n';
    msg += '💰 Tax estimate (20%): *£' + tax.toFixed(2) + '*\n';
    msg += '🏥 NI estimate (6%): *£' + ni.toFixed(2) + '*\n';
    msg += '━━━━━━━━━━━━━━━━━━━━\n';
    msg += '🏦 *Total to set aside: £' + (tax + ni).toFixed(2) + '*';
    
    notifyBot('moneybot', msg);
  } catch(e) { notifyBot('moneybot', '❌ Tax calc error: ' + e.message); }
}


// ============================================
// CONTENTBOT — Blog, Newsletter, Social
// ============================================
function handleContentBotCommand(message) {
  try {
    var text = (message.text || '').trim();
    if (!text) return ContentService.createTextOutput('ok');
    
    // /blog — generate and publish blog post
    if (text.match(/^\/blog$/i) || text.match(/^\/start$/i)) {
      notifyBot('contentbot', '✍️ *Generating blog post...*\n\nThis takes 30-60 seconds. I\'ll send it when ready.');
      cloudGenerateBlogPost(true); // force = true, ignore date check
      return ContentService.createTextOutput('ok');
    }
    
    // /newsletter — generate and send newsletter
    if (text.match(/^\/newsletter$/i)) {
      notifyBot('contentbot', '📰 *Generating newsletter...*\n\nThis takes a minute. Hold tight.');
      cloudWeeklyNewsletter(true); // force = true
      return ContentService.createTextOutput('ok');
    }
    
    // /preview — show what's scheduled next
    if (text.match(/^\/preview$/i)) {
      contentBotPreview_();
      return ContentService.createTextOutput('ok');
    }
    
    // /calendar — content calendar for this month
    if (text.match(/^\/calendar$/i)) {
      contentBotCalendar_();
      return ContentService.createTextOutput('ok');
    }
    
    // /stats — blog/subscriber stats
    if (text.match(/^\/stats$/i)) {
      contentBotStats_();
      return ContentService.createTextOutput('ok');
    }
    
    // /help
    if (text.match(/^\/help$/i)) {
      notifyBot('contentbot', '📝 *GGM ContentBot Commands*\n\n'
        + '`/blog` — Generate + publish blog post now\n'
        + '`/newsletter` — Generate + send newsletter now\n'
        + '`/preview` — Show next scheduled content\n'
        + '`/calendar` — This month\'s content calendar\n'
        + '`/stats` — Blog + subscriber stats\n'
        + '`/help` — Show this help');
      return ContentService.createTextOutput('ok');
    }
    
    // Unknown slash command → show help hint
    if (text.match(/^\//)) {
      notifyBot('contentbot', '🤔 Unknown command: `' + text.split(' ')[0] + '`\n\nSend `/help` to see available commands.');
    }
    return ContentService.createTextOutput('ok');
  } catch(err) {
    Logger.log('ContentBot error: ' + err);
    notifyBot('contentbot', '❌ Error: ' + err.message);
    return ContentService.createTextOutput('ok');
  }
}

// ── ContentBot Helper: Preview next content ──
function contentBotPreview_() {
  try {
    var now = new Date();
    var day = now.getDate();
    var month = now.getMonth() + 1;
    var cal = CLOUD_CONTENT_CALENDAR[month];
    if (!cal) { notifyBot('contentbot', '📅 No content calendar for this month'); return; }
    
    var nextBlogDay = day <= 1 ? 1 : day <= 11 ? 11 : day <= 21 ? 21 : -1;
    var topicIdx = nextBlogDay === 1 ? 0 : nextBlogDay === 11 ? 1 : nextBlogDay === 21 ? 2 : -1;
    
    var msg = '📅 *Upcoming Content*\n━━━━━━━━━━━━━━━━━━━━\n\n';
    if (topicIdx >= 0 && cal.topics[topicIdx]) {
      msg += '📝 *Next Blog:* ' + (nextBlogDay === day ? 'TODAY' : cal.month + ' ' + nextBlogDay) + '\n';
      msg += '   "' + cal.topics[topicIdx].title + '"\n';
      msg += '   Category: ' + cal.topics[topicIdx].cat + '\n\n';
    } else {
      msg += '📝 All 3 blog posts done this month ✅\n\n';
    }
    
    // Newsletter: first Monday of month
    var firstMon = new Date(now.getFullYear(), now.getMonth(), 1);
    while (firstMon.getDay() !== 1) firstMon.setDate(firstMon.getDate() + 1);
    if (now <= firstMon) {
      msg += '📰 *Newsletter:* ' + Utilities.formatDate(firstMon, Session.getScriptTimeZone(), 'EEEE d MMMM') + '\n';
    } else {
      msg += '📰 Newsletter sent this month ✅\n';
    }
    
    notifyBot('contentbot', msg);
  } catch(e) { notifyBot('contentbot', '❌ Preview error: ' + e.message); }
}

// ── ContentBot Helper: Calendar ──
function contentBotCalendar_() {
  try {
    var month = new Date().getMonth() + 1;
    var cal = CLOUD_CONTENT_CALENDAR[month];
    if (!cal) { notifyBot('contentbot', '📅 No calendar data for month ' + month); return; }
    
    var msg = '📅 *Content Calendar — ' + cal.month + '*\n━━━━━━━━━━━━━━━━━━━━\n\n';
    msg += '📝 *Blog Posts:*\n';
    for (var i = 0; i < cal.topics.length; i++) {
      var pubDay = i === 0 ? '1st' : i === 1 ? '11th' : '21st';
      msg += '  ' + pubDay + ': "' + cal.topics[i].title + '"\n';
      msg += '     🏷 ' + cal.topics[i].cat + ' | ' + cal.topics[i].tags.split(',').slice(0,3).join(', ') + '\n\n';
    }
    msg += '📰 *Newsletter:* First Monday\n';
    msg += '\n_Send `/blog` or `/newsletter` to publish now_';
    
    notifyBot('contentbot', msg);
  } catch(e) { notifyBot('contentbot', '❌ Calendar error: ' + e.message); }
}

// ── ContentBot Helper: Stats ──
function contentBotStats_() {
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var blogCount = 0, subCount = 0;
    
    var blogSheet = ss.getSheetByName('Blog');
    if (blogSheet) blogCount = Math.max(0, blogSheet.getLastRow() - 1);
    
    var subSheet = ss.getSheetByName('Subscribers');
    if (subSheet) subCount = Math.max(0, subSheet.getLastRow() - 1);
    
    var msg = '📊 *Content Stats*\n━━━━━━━━━━━━━━━━━━━━\n\n';
    msg += '📝 Blog posts published: *' + blogCount + '*\n';
    msg += '📧 Newsletter subscribers: *' + subCount + '*\n';
    
    notifyBot('contentbot', msg);
  } catch(e) { notifyBot('contentbot', '❌ Stats error: ' + e.message); }
}


// ============================================
// COACHBOT — ADHD Daily Structure & Coaching
// ============================================

// Checklist template — the daily routine
var COACH_DAILY_CHECKLIST = [
  { id: 'wake', label: '☀️ Up and moving', time: '06:30' },
  { id: 'briefing', label: '📋 Check DayBot briefing', time: '06:45' },
  { id: 'kit', label: '🧰 Van loaded + kit ready', time: '07:00' },
  { id: 'route', label: '🗺 Route checked (/route in DayBot)', time: '07:15' },
  { id: 'fuel', label: '⛽ Fuel check', time: '07:15' },
  { id: 'go', label: '🚗 On the road', time: '07:30' }
];

function handleCoachBotCommand(message) {
  try {
    var text = (message.text || '').trim();
    if (!text) return ContentService.createTextOutput('ok');
    
    // /morning or /start — send morning checklist
    if (text.match(/^\/morning$/i) || text.match(/^\/start$/i)) {
      coachSendChecklist_();
      return ContentService.createTextOutput('ok');
    }
    
    // /check [item] — tick an item
    if (text.match(/^\/check\s+(.+)/i)) {
      var checkItem = text.match(/^\/check\s+(.+)/i)[1].trim();
      coachTickItem_(checkItem);
      return ContentService.createTextOutput('ok');
    }
    
    // /focus — what should I do right now?
    if (text.match(/^\/focus$/i)) {
      coachFocus_();
      return ContentService.createTextOutput('ok');
    }
    
    // /break [mins] — set break reminder
    if (text.match(/^\/break\s*(\d*)/i)) {
      var breakMins = parseInt((text.match(/^\/break\s*(\d*)/i))[1] || '15');
      notifyBot('coachbot', '☕ *Break time!* Take ' + breakMins + ' minutes.\n\nYou\'ve earned it. Step away from the mower. 🌿\n\n_I\'ll remind you when it\'s time to crack on._');
      return ContentService.createTextOutput('ok');
    }
    
    // /done — end of day reflection
    if (text.match(/^\/done$/i)) {
      coachEndOfDay_();
      return ContentService.createTextOutput('ok');
    }
    
    // /wins or /win [text] — log a win
    if (text.match(/^\/wins?\s*(.*)/i)) {
      var winText = (text.match(/^\/wins?\s*(.*)/i))[1].trim();
      coachLogWin_(winText);
      return ContentService.createTextOutput('ok');
    }
    
    // /stuck — overwhelm helper
    if (text.match(/^\/stuck$/i)) {
      coachStuck_();
      return ContentService.createTextOutput('ok');
    }
    
    // /energy high|low — set energy level
    if (text.match(/^\/energy\s+(high|low|medium)/i)) {
      var energy = text.match(/^\/energy\s+(high|low|medium)/i)[1].toLowerCase();
      coachSetEnergy_(energy);
      return ContentService.createTextOutput('ok');
    }
    
    // /help
    if (text.match(/^\/help$/i)) {
      notifyBot('coachbot', '🧠 *GGM CoachBot Commands*\n\n'
        + '☀️ *Daily Routine*\n'
        + '`/morning` — Start morning checklist\n'
        + '`/check [item]` — Tick off a checklist item\n'
        + '`/focus` — What should I do RIGHT NOW?\n'
        + '`/break 15` — Take a 15-min break\n\n'
        + '🏁 *End of Day*\n'
        + '`/done` — End-of-day reflection\n'
        + '`/win Great hedge job` — Log a win\n'
        + '`/wins` — View this week\'s wins\n\n'
        + '🆘 *When Stuck*\n'
        + '`/stuck` — I\'m overwhelmed, help!\n'
        + '`/energy high` — Feeling good (fewer nudges)\n'
        + '`/energy low` — Need more reminders\n'
        + '`/help` — Show this help');
      return ContentService.createTextOutput('ok');
    }
    
    // Unknown slash command → show help hint
    if (text.match(/^\//)) {
      notifyBot('coachbot', '🤔 Unknown command: `' + text.split(' ')[0] + '`\n\nSend `/help` to see available commands.');
    }
    return ContentService.createTextOutput('ok');
  } catch(err) {
    Logger.log('CoachBot error: ' + err);
    notifyBot('coachbot', '❌ Error: ' + err.message);
    return ContentService.createTextOutput('ok');
  }
}

// ── CoachBot Helper: Send morning checklist ──
function coachSendChecklist_() {
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ensureCoachSheet_(ss);
    var todayStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
    
    // Check if we already have today's checklist
    var data = sheet.getDataRange().getValues();
    var todayItems = [];
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]) === todayStr) todayItems.push(data[i]);
    }
    
    // Create today's checklist if it doesn't exist
    if (todayItems.length === 0) {
      for (var c = 0; c < COACH_DAILY_CHECKLIST.length; c++) {
        sheet.appendRow([todayStr, COACH_DAILY_CHECKLIST[c].id, COACH_DAILY_CHECKLIST[c].label, 'pending', COACH_DAILY_CHECKLIST[c].time, '']);
      }
      todayItems = COACH_DAILY_CHECKLIST.map(function(item) {
        return [todayStr, item.id, item.label, 'pending', item.time, ''];
      });
    }
    
    var dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    var now = new Date();
    var msg = '☀️ *Good morning Chris!*\n';
    msg += '📅 ' + dayNames[now.getDay()] + ' ' + Utilities.formatDate(now, Session.getScriptTimeZone(), 'd MMMM') + '\n';
    msg += '━━━━━━━━━━━━━━━━━━━━\n\n';
    msg += '📋 *Morning Routine:*\n\n';
    
    for (var t = 0; t < todayItems.length; t++) {
      var done = String(todayItems[t][3]) === 'done';
      msg += (done ? '✅' : '⬜') + ' ' + String(todayItems[t][2]) + '\n';
    }
    
    msg += '\n_Tick items with `/check wake` `/check kit` etc._\n';
    msg += '_Or `/check all` to tick everything at once_';
    
    notifyBot('coachbot', msg);
  } catch(e) { notifyBot('coachbot', '❌ Checklist error: ' + e.message); }
}

// ── CoachBot Helper: Tick checklist item ──
function coachTickItem_(itemText) {
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ensureCoachSheet_(ss);
    var todayStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
    var data = sheet.getDataRange().getValues();
    var ticked = 0, total = 0;
    
    if (itemText.toLowerCase() === 'all') {
      // Tick everything
      for (var i = 1; i < data.length; i++) {
        if (String(data[i][0]) === todayStr) {
          sheet.getRange(i + 1, 4).setValue('done');
          sheet.getRange(i + 1, 6).setValue(new Date().toISOString());
          ticked++;
        }
      }
      notifyBot('coachbot', '✅ *All ' + ticked + ' items checked off!*\n\n💪 You\'re smashing it. Time to get out there!');
      return;
    }
    
    // Find matching item
    var found = false;
    for (var j = 1; j < data.length; j++) {
      if (String(data[j][0]) !== todayStr) continue;
      total++;
      if (String(data[j][3]) === 'done') { ticked++; continue; }
      var itemId = String(data[j][1]).toLowerCase();
      var itemLabel = String(data[j][2]).toLowerCase();
      if (itemId === itemText.toLowerCase() || itemLabel.indexOf(itemText.toLowerCase()) >= 0) {
        sheet.getRange(j + 1, 4).setValue('done');
        sheet.getRange(j + 1, 6).setValue(new Date().toISOString());
        found = true;
        ticked++;
        var encouragement = ['Nice one!', 'Sorted!', 'Boom!', 'Easy!', 'Done and dusted!'];
        notifyBot('coachbot', '✅ ' + String(data[j][2]) + '\n\n' + encouragement[Math.floor(Math.random() * encouragement.length)] + ' (' + ticked + '/' + total + ' done)');
        break;
      }
    }
    if (!found && total > 0) {
      notifyBot('coachbot', '🤔 Couldn\'t find "' + itemText + '" in today\'s checklist.\n\nAvailable items: ' + COACH_DAILY_CHECKLIST.map(function(c) { return '`' + c.id + '`'; }).join(', '));
    }
  } catch(e) { notifyBot('coachbot', '❌ Check error: ' + e.message); }
}

// ── CoachBot Helper: What should I do now? ──
function coachFocus_() {
  try {
    var now = new Date();
    var hour = now.getHours();
    var msg = '';
    
    if (hour < 7) {
      msg = '🌅 *It\'s early!*\n\nSend `/morning` to start your checklist.\nThen check DayBot for today\'s jobs.';
    } else if (hour < 8) {
      msg = '🚗 *Time to get moving!*\n\n1. Check your route: send `/route` in DayBot\n2. Load the van\n3. First job is waiting!\n\n_You\'ve got this. One job at a time._';
    } else if (hour < 12) {
      // Get current job from schedule
      msg = coachGetCurrentJob_();
    } else if (hour < 13) {
      msg = '🥪 *LUNCH BREAK*\n\nEat something proper. Drink water.\nYou\'ve been working hard.\n\n_Check MoneyBot `/money` while you eat — see those numbers going up!_';
    } else if (hour < 17) {
      msg = coachGetCurrentJob_();
    } else {
      msg = '🏁 *Wrapping up time*\n\n1. Send `/invoice` in MoneyBot for today\'s jobs\n2. Send photos: `GGM-XXXX after` in DayBot\n3. Send `/done` here for your reflection\n\n_Almost there. Strong finish!_';
    }
    
    notifyBot('coachbot', msg);
  } catch(e) { notifyBot('coachbot', '❌ Focus error: ' + e.message); }
}

// ── CoachBot Helper: Get current/next job info ──
function coachGetCurrentJob_() {
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName('Jobs');
    if (!sheet) return '🎯 *Focus on the job in front of you*\n\nOne thing at a time. Finish this, then move on.';
    var data = sheet.getDataRange().getValues();
    var todayStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
    var todayJobs = [];
    for (var i = 1; i < data.length; i++) {
      var status = String(data[i][11] || '').toLowerCase();
      if (status === 'cancelled' || status === 'completed') continue;
      var jobDate = data[i][8] instanceof Date ? data[i][8] : new Date(String(data[i][8]));
      if (isNaN(jobDate.getTime())) continue;
      if (Utilities.formatDate(jobDate, Session.getScriptTimeZone(), 'yyyy-MM-dd') !== todayStr) continue;
      todayJobs.push({ name: String(data[i][2] || ''), service: String(data[i][7] || ''),
        jobNum: String(data[i][19] || ''), time: String(data[i][9] || '') });
    }
    if (todayJobs.length === 0) return '✅ *No more jobs today!*\n\nTime to invoice and head home. Send `/done` when you\'re finished.';
    
    var msg = '🎯 *RIGHT NOW — Focus on:*\n\n';
    msg += '*' + todayJobs[0].service + '*\n';
    msg += '👤 ' + todayJobs[0].name + '\n';
    if (todayJobs[0].jobNum) msg += '🔖 `' + todayJobs[0].jobNum + '`\n';
    msg += '\n_' + todayJobs.length + ' job' + (todayJobs.length > 1 ? 's' : '') + ' remaining today._\n';
    msg += '\nWhen done: `/done ' + todayJobs[0].jobNum + '` in DayBot';
    return msg;
  } catch(e) {
    return '🎯 *Focus on the job in front of you*\n\nOne thing at a time.';
  }
}

// ── CoachBot Helper: End of day reflection ──
function coachEndOfDay_() {
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName('Jobs');
    var data = sheet.getDataRange().getValues();
    var todayStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
    var completed = 0, total = 0, revenue = 0;
    for (var i = 1; i < data.length; i++) {
      var jobDate = data[i][8] instanceof Date ? data[i][8] : new Date(String(data[i][8]));
      if (isNaN(jobDate.getTime())) continue;
      if (Utilities.formatDate(jobDate, Session.getScriptTimeZone(), 'yyyy-MM-dd') !== todayStr) continue;
      var status = String(data[i][11] || '').toLowerCase();
      if (status === 'cancelled') continue;
      total++;
      if (status === 'completed') {
        completed++;
        revenue += parseFloat(String(data[i][12] || '0').replace(/[^0-9.]/g, '')) || 0;
      }
    }
    
    var msg = '🌙 *End of Day — Well Done Chris!*\n━━━━━━━━━━━━━━━━━━━━\n\n';
    msg += '✅ Completed: ' + completed + '/' + total + ' jobs\n';
    msg += '💷 Revenue: £' + revenue.toFixed(2) + '\n\n';
    
    if (completed === total && total > 0) {
      msg += '🌟 *Perfect day!* Every job done. That\'s a win.\n\n';
    } else if (completed > 0) {
      msg += '👍 Good effort. ' + (total - completed) + ' job' + (total - completed > 1 ? 's' : '') + ' to catch up tomorrow.\n\n';
    }
    
    msg += '📝 *Quick reflection:*\n';
    msg += '• What went well? Send `/win [something good]`\n';
    msg += '• Any invoices left? Check `/invoices` in MoneyBot\n\n';
    msg += '🛏 Rest up. Tomorrow\'s a new day. 💪';
    
    notifyBot('coachbot', msg);
  } catch(e) { notifyBot('coachbot', '❌ End of day error: ' + e.message); }
}

// ── CoachBot Helper: Log/view wins ──
function coachLogWin_(winText) {
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ensureWinsSheet_(ss);
    var todayStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
    
    if (winText) {
      // Log a new win
      sheet.appendRow([todayStr, winText, new Date().toISOString()]);
      var encouragement = ['🎉 That\'s what I\'m talking about!', '💪 Logged! Keep stacking those wins!',
        '🌟 Another one for the books!', '🏆 Winner winner!', '👊 Yes! Love to see it.'];
      notifyBot('coachbot', encouragement[Math.floor(Math.random() * encouragement.length)] + '\n\n✅ "' + winText + '"');
    } else {
      // Show this week's wins
      var data = sheet.getDataRange().getValues();
      var weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);
      var weekStr = Utilities.formatDate(weekAgo, Session.getScriptTimeZone(), 'yyyy-MM-dd');
      var wins = [];
      for (var i = 1; i < data.length; i++) {
        if (String(data[i][0]) >= weekStr) wins.push(data[i]);
      }
      if (wins.length === 0) {
        notifyBot('coachbot', '📝 No wins logged this week yet.\n\nSend `/win Something awesome` to get started!');
      } else {
        var msg = '🏆 *This Week\'s Wins (' + wins.length + '):*\n━━━━━━━━━━━━━━━━━━━━\n\n';
        for (var w = 0; w < wins.length; w++) {
          msg += '⭐ ' + String(wins[w][1]) + ' _(' + String(wins[w][0]) + ')_\n';
        }
        msg += '\n_You\'re doing great. Keep going!_ 💪';
        notifyBot('coachbot', msg);
      }
    }
  } catch(e) { notifyBot('coachbot', '❌ Wins error: ' + e.message); }
}

// ── CoachBot Helper: Overwhelm — one next step ──
function coachStuck_() {
  try {
    var hour = new Date().getHours();
    var msg = '🧠 *Hey. Breathe. You\'re fine.*\n━━━━━━━━━━━━━━━━━━━━\n\n';
    msg += 'Everything feels like a lot right now. That\'s OK — it happens.\n\n';
    msg += '🎯 *Your ONE next step:*\n\n';
    
    if (hour < 8) {
      msg += 'Just get dressed and make a brew. That\'s it.\nThen send `/morning` when you\'re ready.';
    } else if (hour < 12) {
      msg += 'Just drive to the next job. Don\'t think about the rest.\nPark up. Get one tool out. Start.\n\nThe rest will follow.';
    } else if (hour < 14) {
      msg += 'Stop and eat something. Properly.\nSit down for 10 minutes. Then come back.\n\nSend `/focus` when you\'re ready.';
    } else if (hour < 17) {
      msg += 'Just finish the current job. Nothing else matters right now.\nWhen it\'s done, send `/done [jobnumber]` in DayBot.\n\nOne at a time.';
    } else {
      msg += 'You\'ve done enough today. Seriously.\nInvoice what you can (`/invoices` in MoneyBot) and head home.\n\nTomorrow is a fresh start.';
    }
    
    msg += '\n\n_You\'re running a business on your own. That takes guts. Give yourself some credit._ 💚';
    notifyBot('coachbot', msg);
  } catch(e) { notifyBot('coachbot', '🧠 Take a breath. One thing at a time. You\'ve got this.'); }
}

// ── CoachBot Helper: Set energy level ──
function coachSetEnergy_(level) {
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ensureCoachSheet_(ss);
    var todayStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
    // Store energy level in a special row
    var data = sheet.getDataRange().getValues();
    var found = false;
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]) === todayStr && String(data[i][1]) === 'energy') {
        sheet.getRange(i + 1, 4).setValue(level);
        found = true;
        break;
      }
    }
    if (!found) sheet.appendRow([todayStr, 'energy', 'Energy level', level, '', '']);
    
    var responses = {
      high: '⚡ *Energy: HIGH*\n\nBrilliant! I\'ll ease off the reminders. You\'ve got momentum — ride it!',
      medium: '👍 *Energy: MEDIUM*\n\nSteady pace. I\'ll check in at the usual times.',
      low: '🔋 *Energy: LOW*\n\nNo worries — we all have those days. I\'ll send more gentle nudges to keep you on track.\n\nRemember: some progress is better than no progress.'
    };
    notifyBot('coachbot', responses[level] || responses.medium);
  } catch(e) { notifyBot('coachbot', '❌ Energy error: ' + e.message); }
}

// ── CoachBot: Ensure Coach sheet exists ──
function ensureCoachSheet_(ss) {
  var sheet = ss.getSheetByName('CoachChecklist');
  if (!sheet) {
    sheet = ss.insertSheet('CoachChecklist');
    sheet.appendRow(['Date', 'ItemID', 'Label', 'Status', 'Time', 'CompletedAt']);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// ── CoachBot: Ensure Wins sheet exists ──
function ensureWinsSheet_(ss) {
  var sheet = ss.getSheetByName('Wins');
  if (!sheet) {
    sheet = ss.insertSheet('Wins');
    sheet.appendRow(['Date', 'Win', 'Timestamp']);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// ============================================
// COACHBOT SCHEDULED NUDGES
// ============================================

// 06:30 — Morning checklist
function coachMorningNudge() {
  var dayOfWeek = new Date().getDay();
  if (dayOfWeek === 0) return; // Skip Sunday
  coachSendChecklist_();
}

// 10:00 — Mid-morning check
function coachMidMorningNudge() {
  var dayOfWeek = new Date().getDay();
  if (dayOfWeek === 0) return;
  
  // Check energy level
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ensureCoachSheet_(ss);
    var todayStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]) === todayStr && String(data[i][1]) === 'energy' && String(data[i][3]) === 'high') return; // Skip if high energy
    }
  } catch(e) {}
  
  notifyBot('coachbot', '☕ *Mid-morning check*\n\nHow\'s it going? On track?\n\nSend `/focus` if you need direction\nSend `/stuck` if it\'s all a bit much');
}

// 12:30 — Lunch reminder
function coachLunchNudge() {
  var dayOfWeek = new Date().getDay();
  if (dayOfWeek === 0) return;
  notifyBot('coachbot', '🥪 *LUNCH BREAK*\n\nSeriously — stop and eat.\n\nYour brain and body need fuel.\nEven 15 minutes makes a difference.\n\n_Check `/money` in MoneyBot while you eat_ 💷');
}

// 15:00 — Afternoon push
function coachAfternoonNudge() {
  var dayOfWeek = new Date().getDay();
  if (dayOfWeek === 0) return;
  
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName('Jobs');
    if (!sheet) return;
    var data = sheet.getDataRange().getValues();
    var todayStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
    var remaining = 0;
    for (var i = 1; i < data.length; i++) {
      var status = String(data[i][11] || '').toLowerCase();
      if (status === 'cancelled' || status === 'completed') continue;
      var jobDate = data[i][8] instanceof Date ? data[i][8] : new Date(String(data[i][8]));
      if (isNaN(jobDate.getTime())) continue;
      if (Utilities.formatDate(jobDate, Session.getScriptTimeZone(), 'yyyy-MM-dd') === todayStr) remaining++;
    }
    if (remaining > 0) {
      notifyBot('coachbot', '💪 *Afternoon push*\n\n' + remaining + ' job' + (remaining > 1 ? 's' : '') + ' left today. You\'re in the home stretch!\n\nSend `/focus` for your next step.');
    }
  } catch(e) {}
}

// 17:30 — Wrapping up
function coachEveningNudge() {
  var dayOfWeek = new Date().getDay();
  if (dayOfWeek === 0) return;
  notifyBot('coachbot', '🏁 *Wrapping up time*\n\nGreat work today. Before you switch off:\n\n'
    + '1️⃣ Invoice today\'s jobs → `/invoices` in MoneyBot\n'
    + '2️⃣ Send after photos → `GGM-XXXX after` in DayBot\n'
    + '3️⃣ Daily reflection → `/done` here\n\n'
    + '_Then you\'re done. Feet up._ 🛋');
}

// Get or create a Google Drive folder for job photos
function getOrCreatePhotosFolder() {
  var folderName = 'GGM Job Photos';
  var folders = DriveApp.getFoldersByName(folderName);
  if (folders.hasNext()) {
    return folders.next().getId();
  }
  var newFolder = DriveApp.createFolder(folderName);
  return newFolder.getId();
}

// ============================================
// MULTI-BOT WEBHOOK SETUP — Run once after deploying
// ============================================
var DEPLOYMENT_URL = 'https://script.google.com/macros/s/AKfycbxaT1YOoDZtVHP9CztiUutYFqMiOyygDJon5BxCij14CWl91WgdmrYqpbG4KVAlFh5IiQ/exec';

function setupAllBotWebhooks() {
  var bots = [
    { name: 'DayBot',     token: BOT_TOKENS.daybot,     param: 'daybot' },
    { name: 'MoneyBot',   token: BOT_TOKENS.moneybot,   param: 'moneybot' },
    { name: 'ContentBot', token: BOT_TOKENS.contentbot,  param: 'contentbot' },
    { name: 'CoachBot',   token: BOT_TOKENS.coachbot,    param: 'coachbot' }
  ];
  
  var results = [];
  for (var i = 0; i < bots.length; i++) {
    if (!bots[i].token) { results.push(bots[i].name + ': SKIPPED (no token)'); continue; }
    var webhookUrl = DEPLOYMENT_URL + '?bot=' + bots[i].param;
    try {
      var resp = UrlFetchApp.fetch('https://api.telegram.org/bot' + bots[i].token + '/setWebhook', {
        method: 'post', contentType: 'application/json',
        payload: JSON.stringify({ url: webhookUrl })
      });
      results.push(bots[i].name + ': ' + resp.getContentText());
    } catch(e) {
      results.push(bots[i].name + ': ERROR — ' + e.message);
    }
  }
  
  Logger.log('Multi-bot webhook setup:\n' + results.join('\n'));
  notifyTelegram('🤖 *Multi-Bot Webhooks Registered*\n\n' + results.join('\n'));
  return results.join('\n');
}

// Set up BotFather commands for all bots (run once)
function setupAllBotCommands() {
  var botCommands = {
    daybot: [
      { command: 'today', description: 'Today\'s job briefing' },
      { command: 'tomorrow', description: 'Tomorrow\'s jobs' },
      { command: 'week', description: 'Week overview' },
      { command: 'route', description: 'Google Maps route for today' },
      { command: 'done', description: 'Mark job complete: /done GGM-0001' },
      { command: 'late', description: 'Tell customer you\'re late: /late GGM-0001 30' },
      { command: 'cancel', description: 'Cancel job: /cancel GGM-0001 rain' },
      { command: 'reschedule', description: 'Move job: /reschedule GGM-0001 Fri' },
      { command: 'invoice', description: 'Invoice a job or list uninvoiced' },
      { command: 'photos', description: 'View photos: /photos GGM-0001' },
      { command: 'help', description: 'Show all commands' }
    ],
    moneybot: [
      { command: 'money', description: 'Today\'s financial snapshot' },
      { command: 'week', description: 'This week\'s summary' },
      { command: 'month', description: 'This month\'s summary' },
      { command: 'invoice', description: 'Invoice a job: /invoice GGM-0001' },
      { command: 'invoices', description: 'List uninvoiced jobs' },
      { command: 'paid', description: 'Today\'s payments received' },
      { command: 'overdue', description: 'Overdue unpaid invoices' },
      { command: 'tax', description: 'Tax/NI set-aside total' },
      { command: 'help', description: 'Show all commands' }
    ],
    contentbot: [
      { command: 'blog', description: 'Generate + publish blog post' },
      { command: 'newsletter', description: 'Generate + send newsletter' },
      { command: 'preview', description: 'Show next scheduled content' },
      { command: 'calendar', description: 'This month\'s content calendar' },
      { command: 'stats', description: 'Blog + subscriber stats' },
      { command: 'help', description: 'Show all commands' }
    ],
    coachbot: [
      { command: 'morning', description: 'Start morning checklist' },
      { command: 'check', description: 'Tick item: /check wake' },
      { command: 'focus', description: 'What should I do RIGHT NOW?' },
      { command: 'break', description: 'Take a break: /break 15' },
      { command: 'done', description: 'End-of-day reflection' },
      { command: 'win', description: 'Log a win: /win Great job!' },
      { command: 'wins', description: 'View this week\'s wins' },
      { command: 'stuck', description: 'I\'m overwhelmed, help!' },
      { command: 'energy', description: 'Set energy: /energy high|low' },
      { command: 'help', description: 'Show all commands' }
    ]
  };
  
  var results = [];
  for (var botName in botCommands) {
    var token = BOT_TOKENS[botName];
    if (!token) { results.push(botName + ': SKIPPED'); continue; }
    try {
      var resp = UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/setMyCommands', {
        method: 'post', contentType: 'application/json',
        payload: JSON.stringify({ commands: botCommands[botName] })
      });
      results.push(botName + ': ' + resp.getContentText());
    } catch(e) { results.push(botName + ': ERROR — ' + e.message); }
  }
  
  Logger.log('Bot commands registered:\n' + results.join('\n'));
  notifyTelegram('🤖 *Bot Commands Registered*\n\n' + results.join('\n'));
}

// Legacy — now calls setupAllBotWebhooks
function setupTelegramWebhook() {
  return setupAllBotWebhooks();
}

// Remove all bot webhooks
function removeAllBotWebhooks() {
  for (var botName in BOT_TOKENS) {
    if (!BOT_TOKENS[botName]) continue;
    try {
      UrlFetchApp.fetch('https://api.telegram.org/bot' + BOT_TOKENS[botName] + '/deleteWebhook');
      Logger.log(botName + ' webhook removed');
    } catch(e) { Logger.log(botName + ' remove failed: ' + e); }
  }
  Logger.log('All bot webhooks removed');
}

function removeTelegramWebhook() {
  return removeAllBotWebhooks();
}


// ============================================
// SEND INVOICE WITH PHOTOS — EMAIL TO CLIENT
// ============================================

function sendInvoiceEmail(data) {
  var customer = data.customer || {};
  var email = customer.email;
  if (!email) throw new Error('Customer email is required');
  
  var invoiceNumber = data.invoiceNumber || generateInvoiceNumber();
  var jobNumber = data.jobNumber || '';
  
  // Get photos if job number provided
  var photos = { before: [], after: [] };
  if (jobNumber) {
    photos = getJobPhotos(jobNumber);
  }
  
  // Build items HTML
  var items = data.items || [];
  var itemsHtml = items.map(function(item) {
    return '<tr>' +
      '<td style="padding:10px 12px;border-bottom:1px solid #eee;">' + (item.description || '') + '</td>' +
      '<td style="padding:10px 12px;border-bottom:1px solid #eee;text-align:center;">' + (item.qty || 1) + '</td>' +
      '<td style="padding:10px 12px;border-bottom:1px solid #eee;text-align:right;">£' + parseFloat(item.price || 0).toFixed(2) + '</td>' +
      '<td style="padding:10px 12px;border-bottom:1px solid #eee;text-align:right;font-weight:600;">£' + (parseFloat(item.price || 0) * parseInt(item.qty || 1)).toFixed(2) + '</td>' +
      '</tr>';
  }).join('');
  
  var grandTotal = parseFloat(data.grandTotal || 0);
  var subtotal = parseFloat(data.subtotal || grandTotal);
  var discountAmt = parseFloat(data.discountAmt || 0);
  
  // Build photos HTML section
  var photosHtml = '';
  if (photos.before.length > 0 || photos.after.length > 0) {
    photosHtml = '<div style="margin:24px 0;padding:16px;background:#f5f9f5;border-radius:8px;">' +
      '<h3 style="color:#2E7D32;margin:0 0 12px 0;font-size:15px;">📸 Job Photos</h3>';
    
    if (photos.before.length > 0) {
      photosHtml += '<p style="font-weight:600;margin:8px 0 4px;">Before:</p>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap;">';
      photos.before.forEach(function(p) {
        photosHtml += '<a href="' + p.url + '" style="display:inline-block;">' +
          '<img src="' + p.url + '" style="width:150px;height:100px;object-fit:cover;border-radius:6px;border:2px solid #ddd;" alt="Before photo">' +
          '</a>';
      });
      photosHtml += '</div>';
    }
    
    if (photos.after.length > 0) {
      photosHtml += '<p style="font-weight:600;margin:12px 0 4px;">After:</p>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap;">';
      photos.after.forEach(function(p) {
        photosHtml += '<a href="' + p.url + '" style="display:inline-block;">' +
          '<img src="' + p.url + '" style="width:150px;height:100px;object-fit:cover;border-radius:6px;border:2px solid #2E7D32;" alt="After photo">' +
          '</a>';
      });
      photosHtml += '</div>';
    }
    
    photosHtml += '</div>';
  }
  
  // Build Stripe payment button if we have a URL
  var paymentButton = '';
  if (data.paymentUrl) {
    paymentButton = '<div style="text-align:center;margin:24px 0;">' +
      '<a href="' + data.paymentUrl + '" style="display:inline-block;padding:14px 36px;background:#2E7D32;color:#fff;text-decoration:none;border-radius:50px;font-weight:600;font-size:15px;">' +
      '💳 Pay Online Now</a>' +
      '<p style="font-size:11px;color:#999;margin-top:8px;">Secure payment via Direct Debit</p></div>';
  }
  
  var emailHtml = '<div style="max-width:600px;margin:0 auto;font-family:Georgia,\'Times New Roman\',serif;color:#333;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.08);">' +
    getGgmEmailHeader({ title: '🌿 Gardners Ground Maintenance', subtitle: 'Roche, Cornwall · 01726 432051' }) +
    
    '<div style="padding:24px;background:#fff;border:1px solid #e8ede8;border-top:none;">' +
    
    '<div style="display:flex;justify-content:space-between;margin-bottom:20px;">' +
    '<div><p style="margin:0;font-size:13px;color:#666;">Invoice</p>' +
    '<p style="margin:2px 0;font-weight:700;font-size:17px;">' + invoiceNumber + '</p></div>' +
    '<div style="text-align:right;"><p style="margin:0;font-size:13px;color:#666;">Date: ' + (data.invoiceDate || new Date().toLocaleDateString('en-GB')) + '</p>' +
    '<p style="margin:2px 0;font-size:13px;color:#666;">Due: ' + (data.dueDate || '') + '</p></div></div>' +
    
    '<div style="margin-bottom:20px;padding:12px;background:#f5f9f5;border-radius:8px;">' +
    '<p style="margin:0;font-size:12px;color:#666;">Bill To:</p>' +
    '<p style="margin:4px 0;font-weight:600;">' + (customer.name || '') + '</p>' +
    '<p style="margin:2px 0;font-size:13px;">' + (customer.address || '') + ', ' + (customer.postcode || '') + '</p></div>' +
    
    photosHtml +
    
    '<table style="width:100%;border-collapse:collapse;margin-bottom:16px;">' +
    '<thead><tr style="background:#2E7D32;color:#fff;">' +
    '<th style="padding:10px 12px;text-align:left;font-size:13px;">Description</th>' +
    '<th style="padding:10px 12px;text-align:center;font-size:13px;">Qty</th>' +
    '<th style="padding:10px 12px;text-align:right;font-size:13px;">Price</th>' +
    '<th style="padding:10px 12px;text-align:right;font-size:13px;">Total</th></tr></thead>' +
    '<tbody>' + itemsHtml + '</tbody></table>' +
    
    '<div style="text-align:right;margin-top:12px;border-top:2px solid #e0e0e0;padding-top:12px;">' +
    '<p style="margin:4px 0;font-size:14px;color:#666;">Job Total: <strong>£' + subtotal.toFixed(2) + '</strong></p>' +
    (discountAmt > 0 ? '<p style="margin:6px 0;font-size:14px;color:#2E7D32;font-weight:600;">✅ ' + (data.discountLabel || '10% Deposit Already Paid') + ': -£' + discountAmt.toFixed(2) + '</p>' : '') +
    (discountAmt > 0 ? '<div style="margin:10px 0;padding:12px;background:#FFF3E0;border-left:4px solid #E65100;border-radius:0 8px 8px 0;text-align:left;">' +
      '<p style="margin:0;font-size:13px;color:#E65100;"><strong>Outstanding Balance (90%)</strong></p>' +
      '<p style="margin:4px 0 0;font-size:22px;font-weight:700;color:#E65100;">£' + grandTotal.toFixed(2) + '</p></div>'
      : '<p style="margin:8px 0 0;font-size:20px;font-weight:700;color:#2E7D32;">Amount Due: £' + grandTotal.toFixed(2) + '</p>') +
    '</div>' +
    
    paymentButton +
    
    '<div style="margin-top:24px;padding:16px;background:#f5f9f5;border-radius:8px;">' +
    '<h3 style="color:#2E7D32;margin:0 0 12px 0;font-size:15px;">Payment Details</h3>' +
    '<p style="margin:4px 0;font-size:13px;"><strong>Bank Transfer:</strong></p>' +
    '<p style="margin:2px 0;font-size:13px;">Sort Code: 04-00-03</p>' +
    '<p style="margin:2px 0;font-size:13px;">Account: 39873874</p>' +
    '<p style="margin:2px 0;font-size:13px;">Name: Gardners Ground Maintenance</p>' +
    '<p style="margin:2px 0;font-size:13px;">Reference: ' + invoiceNumber + '</p></div>' +
    
    (data.notes ? '<div style="margin-top:20px;padding:12px;border-left:3px solid #2E7D32;background:#f9f9f9;font-size:13px;color:#666;">' + data.notes + '</div>' : '') +
    
    '<div style="margin-top:24px;text-align:center;">' +
    '<a href="https://gardnersgm.co.uk/my-account.html" style="color:#2E7D32;font-size:12px;">Manage your account</a></div>' +
    
    '</div>' +
    getGgmEmailFooter(email) +
    '</div>';
  
  // Send the email
  sendEmail({
    to: email,
    toName: '',
    subject: 'Invoice ' + invoiceNumber + ' from Gardners Ground Maintenance',
    htmlBody: emailHtml,
    name: 'Gardners Ground Maintenance',
    replyTo: 'info@gardnersgm.co.uk'
  });
  
  // Log to Email Tracking
  try {
    var trackSheet = SpreadsheetApp.openById('1_Y7yHIpAvv_VNBhTrwNOQaBMAGa3UlVW_FKlf56ouHk')
      .getSheetByName('Email Tracking');
    if (trackSheet) {
      trackSheet.appendRow([
        new Date().toISOString(), email, customer.name || '',
        'invoice', '', jobNumber, 'Invoice ' + invoiceNumber, 'sent'
      ]);
    }
  } catch(trackErr) {}
  
  return { success: true, invoiceNumber: invoiceNumber };
}


// ============================================
// PAYMENT RECEIVED — THANK YOU EMAIL
// ============================================

function sendPaymentReceivedEmail(data) {
  var email = data.email;
  if (!email) return;
  
  var firstName = (data.name || 'Valued Customer').split(' ')[0];
  var service = data.service || '';
  var svc = getServiceContent(service);
  var svcIcon = svc ? svc.icon : '💚';
  var svcName = svc ? svc.name : (service || 'your service');
  var thankYouNote = svc ? svc.thankYouNote : 'Thank you for choosing Gardners Ground Maintenance. We appreciate your business and look forward to helping with your garden again soon.';
  var rebookText = svc ? svc.rebookCta : 'Book Again';
  var amount = data.amount || '';
  var jobNumber = data.jobNumber || '';
  var paymentMethod = data.paymentMethod || 'Online Payment';
  
  var subject = '💚 Payment Received — ' + (svcName !== 'your service' ? svcName : '') + (jobNumber ? ' ' + jobNumber : '') + ' | Gardners GM';
  
  var html = '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:0;background:#f0f2f5;font-family:Georgia,\'Times New Roman\',serif;">'
    + '<div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.08);">'
    // Header with logo
    + getGgmEmailHeader({ title: '💚 Payment Received!', gradient: '#2E7D32', gradientEnd: '#66BB6A' })
    // Body
    + '<div style="padding:30px;">'
    + '<h2 style="color:#2E7D32;margin:0 0 10px;">Thank you, ' + firstName + '!</h2>'
    + '<p style="color:#555;line-height:1.6;margin:0 0 20px;">We\'ve received your payment' + (amount ? ' of <strong>£' + amount + '</strong>' : '') + '. Here\'s your receipt:</p>'
    // Receipt Card
    + '<div style="background:#f8faf8;border:1px solid #e0e8e0;border-radius:8px;overflow:hidden;margin:20px 0;">'
    + '<div style="background:#2E7D32;padding:10px 15px;"><h3 style="color:#fff;margin:0;font-size:15px;">🧾 Payment Receipt</h3></div>'
    + '<table style="width:100%;border-collapse:collapse;">'
    + (jobNumber ? '<tr><td style="padding:8px 15px;color:#666;font-weight:600;width:130px;">Reference</td><td style="padding:8px 15px;font-weight:700;color:#2E7D32;">' + jobNumber + '</td></tr>' : '')
    + '<tr style="background:#f0f5f0;"><td style="padding:8px 15px;color:#666;font-weight:600;">Service</td><td style="padding:8px 15px;">' + svcIcon + ' ' + svcName + '</td></tr>'
    + (amount ? '<tr><td style="padding:8px 15px;color:#666;font-weight:600;">Amount Paid</td><td style="padding:8px 15px;font-weight:700;font-size:18px;color:#2E7D32;">£' + amount + '</td></tr>' : '')
    + '<tr style="background:#f0f5f0;"><td style="padding:8px 15px;color:#666;font-weight:600;">Payment Method</td><td style="padding:8px 15px;">' + paymentMethod + '</td></tr>'
    + '<tr><td style="padding:8px 15px;color:#666;font-weight:600;">Date</td><td style="padding:8px 15px;">' + new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) + '</td></tr>'
    + '<tr style="background:#E8F5E9;"><td colspan="2" style="padding:10px 15px;text-align:center;font-weight:700;color:#2E7D32;">✅ PAID IN FULL</td></tr>'
    + '</table></div>'
    // Service-personalised thank you message
    + '<div style="border-left:4px solid #66BB6A;padding:15px 20px;background:#f8faf8;margin:20px 0;border-radius:0 8px 8px 0;">'
    + '<p style="color:#333;font-size:14px;line-height:1.6;margin:0;">' + svcIcon + ' ' + thankYouNote + '</p>'
    + '</div>'
    // Referral CTA
    + '<div style="background:#FFF8E1;border:1px solid #FFE082;border-radius:8px;padding:15px;text-align:center;margin:20px 0;">'
    + '<p style="color:#F57F17;font-weight:700;margin:0 0 5px;font-size:14px;">🎁 Know Someone Who Needs Garden Help?</p>'
    + '<p style="color:#555;font-size:13px;margin:0 0 10px;">Refer a friend and you both get 10% off your next service!</p>'
    + '<a href="https://gardnersgm.co.uk/booking.html" style="color:#F57F17;font-weight:600;font-size:13px;text-decoration:underline;">Share the love</a>'
    + '</div>'
    // Rebook CTA
    + '<div style="background:linear-gradient(135deg,#E8F5E9,#C8E6C9);border-radius:8px;padding:20px;text-align:center;margin:20px 0;">'
    + '<p style="color:#2E7D32;font-weight:700;margin:0 0 8px;font-size:15px;">See you next time!</p>'
    + '<p style="color:#555;font-size:13px;margin:0 0 12px;">Ready to book your next visit?</p>'
    + '<a href="https://gardnersgm.co.uk/booking.html" style="display:inline-block;background:#2E7D32;color:#fff;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px;">' + rebookText + '</a>'
    + '</div>'
    + '</div>'
    // Footer with contact details
    + getGgmEmailFooter(email)
    + '</div></body></html>';
  
  try {
    sendEmail({
      to: email,
      toName: '',
      subject: subject,
      htmlBody: html,
      name: 'Gardners Ground Maintenance',
      replyTo: 'info@gardnersgm.co.uk'
    });
    logEmailSent(email, data.name || '', 'payment-received', service, jobNumber, subject);
  } catch(e) {
    Logger.log('sendPaymentReceivedEmail error: ' + e);
  }
}


// ============================================
// ENQUIRY AUTO-REPLY (Agent call)
// ============================================

function sendEnquiryReply(data) {
  try {
    var email = data.email || '';
    var name = data.name || 'Customer';
    var subject = data.subject || 'Your enquiry — Gardners Ground Maintenance';
    var body = data.body || '';
    var enquiryDate = data.enquiryDate || '';
    var type = data.type || 'General';

    if (!email || !body) {
      return ContentService.createTextOutput(JSON.stringify({
        status: 'error', message: 'Missing email or body'
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // Send the email
    var htmlBody = '<div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;color:#333;">'
      + '<div style="background:#2E7D32;padding:20px;border-radius:8px 8px 0 0;text-align:center;">'
      + '<h2 style="color:#fff;margin:0;font-size:18px;">Gardners Ground Maintenance</h2>'
      + '</div>'
      + '<div style="padding:24px;background:#fff;border:1px solid #e0e0e0;">'
      + body.replace(/\n/g, '<br/>')
      + '</div>'
      + '<div style="padding:16px;background:#F1F8E9;border-radius:0 0 8px 8px;text-align:center;font-size:12px;color:#666;">'
      + '<p style="margin:4px 0;">Gardners Ground Maintenance | Roche, Cornwall</p>'
      + '<p style="margin:4px 0;">📞 01726 432051 | ✉️ info@gardnersgm.co.uk | 🌐 gardnersgm.co.uk</p>'
      + '</div></div>';

    sendEmail({
      to: email,
      toName: name || '',
      subject: subject,
      htmlBody: htmlBody,
      name: 'Chris — Gardners Ground Maintenance',
      replyTo: 'info@gardnersgm.co.uk'
    });

    // Update the enquiry status in the Enquiries sheet
    try {
      var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
      var sheet = ss.getSheetByName('Enquiries');
      if (sheet) {
        var data_range = sheet.getDataRange().getValues();
        for (var i = 1; i < data_range.length; i++) {
          // Match by email and approximate date
          if (String(data_range[i][2]).toLowerCase() === email.toLowerCase()) {
            var rowDate = data_range[i][0] ? new Date(data_range[i][0]).toISOString().substring(0, 10) : '';
            var matchDate = enquiryDate ? new Date(enquiryDate).toISOString().substring(0, 10) : '';
            if (!enquiryDate || rowDate === matchDate) {
              sheet.getRange(i + 1, 6).setValue('Responded');
              break;
            }
          }
        }
      }
    } catch(sheetErr) {
      // Non-fatal — email was sent, just couldn't update sheet
      Logger.log('Enquiry sheet update error: ' + sheetErr.toString());
    }

    // Log to Email Tracking
    try {
      var trackSheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName('Email Tracking');
      if (trackSheet) {
        trackSheet.appendRow([
          new Date().toISOString(),
          name,
          email,
          'Enquiry Auto-Reply',
          subject,
          'Sent',
          type
        ]);
      }
    } catch(trackErr) {}

    return ContentService.createTextOutput(JSON.stringify({
      status: 'success', message: 'Reply sent to ' + email
    })).setMimeType(ContentService.MimeType.JSON);

  } catch(err) {
    return ContentService.createTextOutput(JSON.stringify({
      status: 'error', message: err.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}


// ============================================
// READ ENDPOINTS FOR ORPHANED SHEETS
// ============================================

function getEnquiries() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName('Enquiries');
  if (!sheet) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'success', enquiries: [] }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  var data = sheet.getDataRange().getValues();
  var enquiries = [];
  for (var i = 1; i < data.length; i++) {
    enquiries.push({
      timestamp: data[i][0],
      name: data[i][1],
      email: data[i][2],
      phone: data[i][3],
      description: data[i][4],
      status: data[i][5],
      type: data[i][6] || 'Bespoke',
      rowIndex: i + 1
    });
  }
  return ContentService.createTextOutput(JSON.stringify({ status: 'success', enquiries: enquiries }))
    .setMimeType(ContentService.MimeType.JSON);
}

function getFreeVisits() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName('Free Visits');
  if (!sheet) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'success', freeVisits: [] }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  var data = sheet.getDataRange().getValues();
  var visits = [];
  for (var i = 1; i < data.length; i++) {
    visits.push({
      timestamp: data[i][0],
      name: data[i][1],
      email: data[i][2],
      phone: data[i][3],
      postcode: data[i][4],
      address: data[i][5],
      preferredDate: data[i][6],
      preferredTime: data[i][7],
      gardenSize: data[i][8],
      notes: data[i][9],
      status: data[i][10] || 'Pending',
      rowIndex: i + 1
    });
  }
  return ContentService.createTextOutput(JSON.stringify({ status: 'success', freeVisits: visits }))
    .setMimeType(ContentService.MimeType.JSON);
}

function getWeatherLog() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName('Weather Log');
  if (!sheet) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'success', weatherLog: [] }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  var data = sheet.getDataRange().getValues();
  var log = [];
  for (var i = 1; i < data.length; i++) {
    log.push({
      timestamp: data[i][0],
      date: data[i][1],
      condition: data[i][2],
      severity: data[i][3],
      action: data[i][4],
      affected: data[i][5],
      notes: data[i][6]
    });
  }
  return ContentService.createTextOutput(JSON.stringify({ status: 'success', weatherLog: log }))
    .setMimeType(ContentService.MimeType.JSON);
}

function getAllTestimonials() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName('Testimonials');
  if (!sheet) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'success', testimonials: [] }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  var data = sheet.getDataRange().getValues();
  var list = [];
  for (var i = 1; i < data.length; i++) {
    list.push({
      timestamp: data[i][0],
      name: data[i][1],
      email: data[i][2],
      service: data[i][3],
      rating: data[i][4],
      review: data[i][5],
      approved: data[i][6],
      featured: data[i][7] || false,
      rowIndex: i + 1
    });
  }
  return ContentService.createTextOutput(JSON.stringify({ status: 'success', testimonials: list }))
    .setMimeType(ContentService.MimeType.JSON);
}


// ============================================
// SETUP HELPERS — RENAME SHEET & ADD HEADERS
// ============================================

function setupSheetsOnce() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  
  // Rename the old default tab name to 'Jobs' if it still exists
  var sheets = ss.getSheets();
  for (var s = 0; s < sheets.length; s++) {
    if (sheets[s].getName() === 'Sheet1') {
      sheets[s].setName('Jobs');
      break;
    }
  }
  
  // Ensure Jobs sheet has proper headers
  var jobsSheet = ss.getSheetByName('Jobs');
  if (jobsSheet) {
    var firstRow = jobsSheet.getRange(1, 1, 1, 21).getValues()[0];
    // Only set headers if row 1 looks like data (no headers)
    if (!String(firstRow[0]).match(/timestamp/i)) {
      jobsSheet.insertRowBefore(1);
      jobsSheet.getRange(1, 1, 1, 21).setValues([[
        'Timestamp', 'Type', 'Name', 'Email', 'Phone',
        'Address', 'Postcode', 'Service', 'Date', 'Time',
        'Preferred Day', 'Status', 'Price (£)', 'Distance',
        'Drive Time', 'Maps/URL', 'Notes', 'Paid',
        'Payment Type', 'Job Number', 'Travel Surcharge'
      ]]);
      jobsSheet.getRange(1, 1, 1, 21).setFontWeight('bold');
      jobsSheet.setFrozenRows(1);
    }
  }
  
  // Ensure Invoices sheet exists
  ensureInvoicesSheet();
  
  // Ensure Job Photos sheet exists
  ensureJobPhotosSheet();
  
  Logger.log('Sheets setup complete');
}


// ────────────────────────────────────────────
// BESPOKE WORK ENQUIRY — Email + Telegram
// ────────────────────────────────────────────
/* ═══════════════════════════════════════════════════
   FREE QUOTE VISIT REQUEST HANDLER
   ═══════════════════════════════════════════════════ */

function handleFreeVisitRequest(data) {
  var name = data.name || 'Unknown';
  var email = data.email || '';
  var phone = data.phone || '';
  var postcode = data.postcode || '';
  var address = data.address || '';
  var preferredDate = data.preferredDate || '';
  var preferredDateDisplay = data.preferredDateDisplay || preferredDate;
  var preferredTime = data.preferredTime || '';
  var gardenSize = data.gardenSize || 'Not specified';
  var notes = data.notes || '';
  var timestamp = new Date().toISOString();

  // 0) Check availability if date + time provided
  if (preferredDate && preferredTime) {
    try {
      var avail = JSON.parse(
        checkAvailability({ date: preferredDate, time: preferredTime, service: 'free-quote-visit' })
        .getContent()
      );
      if (!avail.available) {
        return ContentService.createTextOutput(JSON.stringify({
          status: 'error',
          message: 'That time slot is already booked. Please choose a different date or time.',
          slotConflict: true
        })).setMimeType(ContentService.MimeType.JSON);
      }
    } catch(availErr) {
      Logger.log('Free visit availability check error: ' + availErr);
    }
  }

  var jobNum = generateJobNumber();

  // 1) Add to Jobs sheet so it blocks the calendar + appears in planner
  try {
    var ss = SpreadsheetApp.openById('1_Y7yHIpAvv_VNBhTrwNOQaBMAGa3UlVW_FKlf56ouHk');
    var jobsSheet = ss.getSheetByName('Jobs');
    var visitNotes = 'FREE QUOTE VISIT | Garden size: ' + gardenSize + (notes ? ' | ' + notes : '');
    jobsSheet.appendRow([
      timestamp,                    // A: Timestamp
      'Free Quote Visit',           // B: Type
      name,                         // C: Name
      email,                        // D: Email
      phone,                        // E: Phone
      address,                      // F: Address
      postcode,                     // G: Postcode
      'Free Quote Visit',           // H: Service
      preferredDate,                // I: Date
      preferredTime,                // J: Time
      '',                           // K: Preferred Day
      'Active',                     // L: Status
      '0',                          // M: Price (free!)
      data.distance || '',          // N: Distance
      data.driveTime || '',         // O: Drive Time
      '',                           // P: Maps URL
      visitNotes,                   // Q: Notes
      'N/A',                        // R: Paid (free visit)
      'Free',                       // S: Payment Type
      jobNum                        // T: Job Number
    ]);
  } catch(jobErr) {
    Logger.log('Free visit Jobs sheet error: ' + jobErr);
  }

  // 1b) Also log to dedicated Free Visits sheet for tracking
  try {
    var fvSheet = ss.getSheetByName('Free Visits');
    if (!fvSheet) {
      fvSheet = ss.insertSheet('Free Visits');
      fvSheet.appendRow(['Timestamp', 'Name', 'Email', 'Phone', 'Postcode', 'Address', 'Date', 'Time', 'Garden Size', 'Notes', 'Status', 'Job Number']);
      fvSheet.getRange(1, 1, 1, 12).setFontWeight('bold');
      fvSheet.setFrozenRows(1);
    }
    fvSheet.appendRow([timestamp, name, email, phone, postcode, address, preferredDate, preferredTime, gardenSize, notes, 'Booked', jobNum]);
  } catch(sheetErr) {
    Logger.log('Free visit sheet error: ' + sheetErr);
  }

  // 2) Send confirmation email to customer
  try {
    var subject = 'Your Free Quote Visit — Gardner\'s Ground Maintenance';
    var htmlBody = '<div style="font-family:Poppins,Arial,sans-serif;max-width:600px;margin:0 auto;">' +
      '<div style="background:linear-gradient(135deg,#43A047,#2E7D32);color:#fff;padding:24px;border-radius:12px 12px 0 0;text-align:center;">' +
      '<h1 style="margin:0;font-size:1.4rem;">🏡 Free Quote Visit Booked!</h1>' +
      '</div>' +
      '<div style="background:#fff;padding:24px;border:1px solid #e0e0e0;border-top:none;">' +
      '<p style="color:#333;font-size:1rem;line-height:1.6;">Hi ' + name.split(' ')[0] + ',</p>' +
      '<p style="color:#555;line-height:1.6;">Thanks for booking a free quote visit! Your appointment is confirmed for <strong>' + preferredDateDisplay + '</strong> at <strong>' + preferredTime + '</strong>.</p>' +
      '<div style="background:#f0faf0;padding:16px;border-radius:8px;border:1px solid #C8E6C9;margin:16px 0;">' +
      '<h3 style="margin:0 0 8px;color:#2E7D32;font-size:1rem;">📋 Visit Details</h3>' +
      '<table style="width:100%;border-collapse:collapse;">' +
      '<tr><td style="padding:4px 0;font-weight:600;color:#333;width:130px;">Address:</td><td style="color:#555;">' + address + '</td></tr>' +
      '<tr><td style="padding:4px 0;font-weight:600;color:#333;">Date:</td><td style="color:#555;">' + preferredDateDisplay + '</td></tr>' +
      '<tr><td style="padding:4px 0;font-weight:600;color:#333;">Time:</td><td style="color:#555;">' + preferredTime + '</td></tr>' +
      '<tr><td style="padding:4px 0;font-weight:600;color:#333;">Job Ref:</td><td style="color:#555;">' + jobNum + '</td></tr>' +
      '<tr><td style="padding:4px 0;font-weight:600;color:#333;">Garden Size:</td><td style="color:#555;">' + gardenSize + '</td></tr>' +
      (notes ? '<tr><td style="padding:4px 0;font-weight:600;color:#333;">Your Notes:</td><td style="color:#555;">' + notes + '</td></tr>' : '') +
      '</table>' +
      '</div>' +
      '<div style="background:#FFF8E1;padding:14px;border-radius:8px;border:1px solid #FFE082;margin:16px 0;">' +
      '<p style="margin:0;color:#F57F17;font-size:0.9rem;"><strong>💡 What happens next?</strong></p>' +
      '<ol style="margin:8px 0 0;padding-left:20px;color:#555;line-height:1.8;">' +
      '<li>Chris arrives at your property at the booked time</li>' +
      '<li>He walks your garden and takes measurements</li>' +
      '<li>You receive a written quote — no obligation</li>' +
      '<li>Take your time to decide — no pressure at all</li>' +
      '</ol>' +
      '</div>' +
      '<p style="color:#555;line-height:1.6;">If you have any questions before the visit, just reply to this email or call <strong>01726 432051</strong>.</p>' +
      '</div>' +
      '<div style="background:#f5f5f5;padding:16px 24px;border-radius:0 0 12px 12px;border:1px solid #e0e0e0;border-top:none;text-align:center;">' +
      '<p style="margin:0;color:#999;font-size:0.8rem;">Gardners Ground Maintenance · Roche, Cornwall · <a href="https://gardnersgm.co.uk" style="color:#4CAF50;">gardnersgm.co.uk</a></p>' +
      '</div></div>';

    sendEmail({
      to: email,
      toName: '',
      subject: subject,
      htmlBody: htmlBody,
      replyTo: 'info@gardnersgm.co.uk',
      name: 'Gardners Ground Maintenance'
    });
  } catch(emailErr) {
    Logger.log('Free visit confirmation email error: ' + emailErr);
  }

  // 3) Send email to info@ as well
  try {
    sendEmail({
      to: 'info@gardnersgm.co.uk',
      toName: '',
      subject: '🏡 Free Quote Visit Booked — ' + name + ' — ' + preferredDateDisplay,
      htmlBody: '<div style="font-family:Poppins,Arial,sans-serif;max-width:600px;margin:0 auto;">' +
        '<h2 style="color:#2E7D32;">Free Quote Visit Booked</h2>' +
        '<p style="color:#555;">This visit is in your calendar and blocks the <strong>' + preferredTime + '</strong> slot on <strong>' + preferredDateDisplay + '</strong>.</p>' +
        '<table style="width:100%;border-collapse:collapse;">' +
        '<tr><td style="padding:6px 0;font-weight:600;">Job Ref:</td><td>' + jobNum + '</td></tr>' +
        '<tr><td style="padding:6px 0;font-weight:600;">Name:</td><td>' + name + '</td></tr>' +
        '<tr><td style="padding:6px 0;font-weight:600;">Email:</td><td><a href="mailto:' + email + '">' + email + '</a></td></tr>' +
        '<tr><td style="padding:6px 0;font-weight:600;">Phone:</td><td><a href="tel:' + phone + '">' + phone + '</a></td></tr>' +
        '<tr><td style="padding:6px 0;font-weight:600;">Address:</td><td>' + address + ' (' + postcode + ')</td></tr>' +
        '<tr><td style="padding:6px 0;font-weight:600;">Date & Time:</td><td>' + preferredDateDisplay + ' — ' + preferredTime + '</td></tr>' +
        '<tr><td style="padding:6px 0;font-weight:600;">Garden Size:</td><td>' + gardenSize + '</td></tr>' +
        '<tr><td style="padding:6px 0;font-weight:600;">Notes:</td><td>' + (notes || 'None') + '</td></tr>' +
        '</table></div>',
      replyTo: email,
      name: 'Gardners Ground Maintenance'
    });
  } catch(e2) {
    Logger.log('Free visit admin email error: ' + e2);
  }

  return ContentService.createTextOutput(JSON.stringify({ status: 'success', message: 'Free visit booked', jobNumber: jobNum }))
    .setMimeType(ContentService.MimeType.JSON);
}


// ============================================
// SERVICE ENQUIRY (from booking/quote form — no payment)
// Customer fills in service + date + details → logged as enquiry + draft quote auto-created
// ============================================

function handleServiceEnquiry(data) {
  var name = data.name || 'Unknown';
  var email = data.email || '';
  var phone = data.phone || '';
  var address = data.address || '';
  var postcode = data.postcode || '';
  var service = data.service || '';
  var preferredDate = data.date || '';
  var preferredTime = data.time || '';
  var indicativeQuote = data.indicativeQuote || '';
  var quoteBreakdown = data.quoteBreakdown || '';
  var distance = data.distance || '';
  var driveTime = data.driveTime || '';
  var mapsUrl = data.googleMapsUrl || '';
  var notes = data.notes || '';
  var gardenDetails = data.gardenDetails || {};
  var timestamp = new Date().toISOString();
  var firstName = name.split(' ')[0] || 'there';
  var emailResults = { customer: 'not_attempted', admin: 'not_attempted' };

  // Build human-readable garden details summary
  var gardenSummary = '';
  var gardenParts = [];
  if (gardenDetails.gardenSize_text) gardenParts.push('Size: ' + gardenDetails.gardenSize_text);
  if (gardenDetails.gardenAreas_text) gardenParts.push('Areas: ' + gardenDetails.gardenAreas_text);
  if (gardenDetails.gardenCondition_text) gardenParts.push('Condition: ' + gardenDetails.gardenCondition_text);
  if (gardenDetails.hedgeCount_text) gardenParts.push('Hedges: ' + gardenDetails.hedgeCount_text);
  if (gardenDetails.hedgeSize_text) gardenParts.push('Hedge Size: ' + gardenDetails.hedgeSize_text);
  if (gardenDetails.clearanceLevel_text) gardenParts.push('Clearance: ' + gardenDetails.clearanceLevel_text);
  if (gardenDetails.wasteRemoval_text) gardenParts.push('Waste: ' + gardenDetails.wasteRemoval_text);
  if (gardenDetails.treatmentType_text) gardenParts.push('Treatment: ' + gardenDetails.treatmentType_text);
  if (gardenDetails.strimmingType_text) gardenParts.push('Work Type: ' + gardenDetails.strimmingType_text);
  if (gardenDetails.pwSurface_text) gardenParts.push('Surface: ' + gardenDetails.pwSurface_text);
  if (gardenDetails.pwArea_text) gardenParts.push('PW Area: ' + gardenDetails.pwArea_text);
  if (gardenDetails.weedArea_text) gardenParts.push('Weed Area: ' + gardenDetails.weedArea_text);
  if (gardenDetails.weedType_text) gardenParts.push('Weed Type: ' + gardenDetails.weedType_text);
  if (gardenDetails.fenceType_text) gardenParts.push('Fence Type: ' + gardenDetails.fenceType_text);
  if (gardenDetails.fenceHeight_text) gardenParts.push('Fence Height: ' + gardenDetails.fenceHeight_text);
  if (gardenDetails.drainType_text) gardenParts.push('Drain Type: ' + gardenDetails.drainType_text);
  if (gardenDetails.drainCondition_text) gardenParts.push('Drain Condition: ' + gardenDetails.drainCondition_text);
  if (gardenDetails.gutterSize_text) gardenParts.push('Gutter Size: ' + gardenDetails.gutterSize_text);
  if (gardenDetails.gutterCondition_text) gardenParts.push('Gutter Condition: ' + gardenDetails.gutterCondition_text);
  if (gardenDetails.vegSize_text) gardenParts.push('Veg Patch: ' + gardenDetails.vegSize_text);
  if (gardenDetails.vegCondition_text) gardenParts.push('Veg Condition: ' + gardenDetails.vegCondition_text);
  if (gardenDetails.treeSize_text) gardenParts.push('Tree Size: ' + gardenDetails.treeSize_text);
  if (gardenDetails.treeWork_text) gardenParts.push('Tree Work: ' + gardenDetails.treeWork_text);
  if (gardenDetails.extras_text) gardenParts.push('Extras: ' + gardenDetails.extras_text);
  if (gardenParts.length) gardenSummary = gardenParts.join(', ');

  // ── Step 1: Log to Enquiries sheet (always) ──
  try {
    var ss = SpreadsheetApp.openById('1_Y7yHIpAvv_VNBhTrwNOQaBMAGa3UlVW_FKlf56ouHk');
    var enqSheet = ss.getSheetByName('Enquiries');
    if (!enqSheet) {
      enqSheet = ss.insertSheet('Enquiries');
      enqSheet.appendRow(['Timestamp', 'Name', 'Email', 'Phone', 'Description', 'Status', 'Type']);
      enqSheet.getRange(1, 1, 1, 7).setFontWeight('bold');
      enqSheet.setFrozenRows(1);
    }
    var description = service + ' | Preferred: ' + preferredDate + ' ' + preferredTime
      + ' | Quote: ' + indicativeQuote
      + (quoteBreakdown ? ' | ' + quoteBreakdown : '')
      + ' | Address: ' + address + ', ' + postcode
      + (gardenSummary ? ' | Garden: ' + gardenSummary : '')
      + (notes ? ' | Notes: ' + notes : '');
    enqSheet.appendRow([timestamp, name, email, phone, description, 'New', 'Service Enquiry']);
  } catch(sheetErr) {
    Logger.log('Service enquiry sheet log error: ' + sheetErr);
  }

  // ── Step 2: Auto-create Draft Quote ──
  var quoteId = '';
  var validUntil = new Date();
  validUntil.setDate(validUntil.getDate() + 30);
  try {
    var quotesSheet = getOrCreateQuotesSheet();
    quoteId = generateQuoteId();
    var token = generateQuoteToken();
    quotesSheet.appendRow([
      quoteId, timestamp, name, email, phone, address, postcode, service,
      '[]', 0, 0, 0, 0, 0, 'No', 0, 'Draft', token, '', '', '',
      'Service enquiry from website. Preferred date: ' + preferredDate + ' ' + preferredTime + '. Indicative online quote: ' + indicativeQuote + (quoteBreakdown ? '. Breakdown: ' + quoteBreakdown : '') + (gardenSummary ? '. Garden details: ' + gardenSummary : '') + (notes ? '. Customer notes: ' + notes : '') + (Object.keys(gardenDetails).length ? '. GARDEN_JSON:' + JSON.stringify(gardenDetails) : '') + '. PREFERRED_DATE:' + preferredDate + '. PREFERRED_TIME:' + preferredTime,
      validUntil.toISOString(), '', 'No', ''
    ]);
    Logger.log('Auto-created draft quote ' + quoteId + ' for service enquiry from ' + name);
  } catch(quoteErr) {
    Logger.log('Service enquiry auto-create quote error: ' + quoteErr);
  }

  // ── Step 3: Check slot availability (information only — NO auto-booking) ──
  // Bookings are only created when the customer accepts the quote and pays.
  // This check is purely to inform Chris whether the requested slot is free.
  var slotAvailable = false;
  var isoDate = normaliseDateToISO(preferredDate);
  var normalTime = preferredTime;

  if (isoDate && normalTime) {
    try {
      var svcKey = service.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
      var availResult = checkAvailability({ date: isoDate, time: normalTime, service: svcKey });
      var availData = JSON.parse(availResult.getContent());
      slotAvailable = !!availData.available;
      Logger.log('Slot availability for ' + name + ' on ' + isoDate + ' ' + normalTime + ': ' + (slotAvailable ? 'AVAILABLE' : 'UNAVAILABLE — ' + (availData.reason || 'conflict')));
    } catch(availErr) {
      Logger.log('Availability check failed (non-critical): ' + availErr);
    }
  }

  // ── Step 4: Send customer email — always "Enquiry Received, Quote Coming" ──
  // (Booking only happens when customer accepts the quote and pays)
  try {
    var emailTitle = '🌿 Enquiry Received';
    var emailSubtitle = 'Your Quote Is On Its Way';
    var emailSubject = '🌿 Enquiry Received — ' + service + ' | Gardners GM';

    var availabilityNote = '';
    if (slotAvailable && preferredDate) {
      availabilityNote = '<div style="background:#E8F5E9;border:1px solid #A5D6A7;border-radius:8px;padding:14px;margin:16px 0;">'
        + '<strong style="color:#1B5E20;">🟢 Good news!</strong> '
        + '<span style="color:#333;">Your preferred date (' + preferredDate + ' ' + preferredTime + ') currently looks available. '
        + 'We\'ll confirm this in your quote.</span></div>';
    } else if (preferredDate && !slotAvailable) {
      availabilityNote = '<div style="background:#FFF3E0;border:1px solid #FFE0B2;border-radius:8px;padding:14px;margin:16px 0;">'
        + '<strong style="color:#E65100;">📅 Heads up:</strong> '
        + '<span style="color:#333;">Your preferred date (' + preferredDate + ' ' + preferredTime + ') may not be available, '
        + 'but we\'ll do our best to find a time that suits you.</span></div>';
    }

    var emailBody = '<h2 style="color:#333;margin:0 0 16px;font-size:1.2rem;">Hi ' + firstName + ',</h2>'
      + '<p style="color:#555;line-height:1.6;">Thank you for your enquiry about <strong>' + service + '</strong>. '
      + 'Chris will review your details and send you a personalised quote shortly — usually within a few hours.</p>'
      + availabilityNote
      + '<div style="background:#E8F5E9;border-radius:8px;padding:16px;margin:20px 0;">'
      + '<h3 style="margin:0 0 12px;color:#1B5E20;font-size:1rem;">📋 Your Enquiry Details</h3>'
      + '<table style="width:100%;border-collapse:collapse;">'
      + '<tr><td style="padding:6px 0;font-weight:600;color:#333;width:130px;">Service:</td><td style="color:#555;">' + service + '</td></tr>'
      + (preferredDate ? '<tr><td style="padding:6px 0;font-weight:600;color:#333;">Preferred Date:</td><td style="color:#555;">' + preferredDate + '</td></tr>' : '')
      + (preferredTime ? '<tr><td style="padding:6px 0;font-weight:600;color:#333;">Preferred Time:</td><td style="color:#555;">' + preferredTime + '</td></tr>' : '')
      + '<tr><td style="padding:6px 0;font-weight:600;color:#333;">Address:</td><td style="color:#555;">' + address + ', ' + postcode + '</td></tr>'
      + (gardenSummary ? '<tr><td style="padding:6px 0;font-weight:600;color:#333;">Garden Info:</td><td style="color:#555;">' + gardenSummary + '</td></tr>' : '')
      + (notes ? '<tr><td style="padding:6px 0;font-weight:600;color:#333;">Notes:</td><td style="color:#555;">' + notes + '</td></tr>' : '')
      + '</table></div>'
      + '<div style="background:#F5F5F5;border-radius:8px;padding:16px;margin:20px 0;">'
      + '<h3 style="margin:0 0 8px;color:#333;font-size:0.95rem;">📝 What happens next?</h3>'
      + '<ol style="color:#555;line-height:1.8;padding-left:20px;margin:0;">'
      + '<li>Chris reviews your enquiry and prepares a personalised quote</li>'
      + '<li>You\'ll receive an email with your quote — review it at your convenience</li>'
      + '<li>Accept the quote and pay a small deposit to confirm your booking</li>'
      + '<li>We\'ll lock in your date and you\'re all set!</li>'
      + '</ol></div>'
      + '<p style="color:#555;line-height:1.6;">No payment is taken until you\'re happy with the quote. '
      + 'If you have any questions, just reply to this email or call us on <strong>01726 432051</strong>.</p>';

    var customerHtml = '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>'
      + '<body style="margin:0;padding:0;background:#f0f2f5;font-family:Georgia,\'Times New Roman\',serif;">'
      + '<div style="max-width:600px;margin:20px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.08);">'
      + getGgmEmailHeader({ title: emailTitle, subtitle: emailSubtitle })
      + '<div style="padding:30px;">'
      + emailBody
      + '</div>'
      + getGgmEmailFooter(email)
      + '</div></body></html>';

    var custResult = sendEmail({
      to: email,
      toName: name,
      subject: emailSubject,
      htmlBody: customerHtml,
      replyTo: 'info@gardnersgm.co.uk',
      name: 'Gardners Ground Maintenance'
    });
    emailResults.customer = custResult.provider || 'sent';
    Logger.log('Customer email result (enquiry): ' + JSON.stringify(custResult));
  } catch(custErr) {
    emailResults.customer = 'error: ' + String(custErr);
    Logger.log('Service enquiry customer email error: ' + custErr);
  }

  // ── Step 5: Send notification email to admin ──
  try {
    var slotStatus = slotAvailable
      ? '🟢 SLOT AVAILABLE — ' + preferredDate + ' ' + preferredTime + ' is free. Price and send the quote to secure it.'
      : '🟡 NEEDS QUOTE — ' + (isoDate && normalTime ? 'Requested slot (' + preferredDate + ' ' + preferredTime + ') may be taken. Suggest alternatives.' : 'No date specified. Send quote with available dates.');
    var adminSubject = '📩 New Enquiry: ' + service + ' — ' + name + (slotAvailable ? ' (slot available)' : '');
    var adminHtml = '<div style="font-family:Poppins,Arial,sans-serif;max-width:600px;margin:0 auto;">'
      + '<div style="background:#2E7D32;color:#fff;padding:20px 24px;border-radius:12px 12px 0 0;">'
      + '<h2 style="margin:0;font-size:1.3rem;">📩 New Service Enquiry</h2>'
      + '<p style="margin:6px 0 0;font-size:0.9rem;opacity:0.9;">' + slotStatus + '</p>'
      + '</div>'
      + '<div style="background:#f9f9f9;padding:24px;border:1px solid #e0e0e0;border-top:none;border-radius:0 0 12px 12px;">'
      + '<table style="width:100%;border-collapse:collapse;">'
      + '<tr><td style="padding:8px 0;font-weight:600;color:#333;width:130px;">Customer:</td><td style="padding:8px 0;color:#555;">' + name + '</td></tr>'
      + '<tr><td style="padding:8px 0;font-weight:600;color:#333;">Email:</td><td style="padding:8px 0;color:#555;"><a href="mailto:' + email + '">' + email + '</a></td></tr>'
      + '<tr><td style="padding:8px 0;font-weight:600;color:#333;">Phone:</td><td style="padding:8px 0;color:#555;"><a href="tel:' + phone + '">' + phone + '</a></td></tr>'
      + '<tr><td style="padding:8px 0;font-weight:600;color:#333;">Address:</td><td style="padding:8px 0;color:#555;">' + address + ', ' + postcode + '</td></tr>'
      + '<tr><td style="padding:8px 0;font-weight:600;color:#333;">Service:</td><td style="padding:8px 0;color:#555;"><strong>' + service + '</strong></td></tr>'
      + '<tr><td style="padding:8px 0;font-weight:600;color:#333;">Date:</td><td style="padding:8px 0;color:#555;">' + preferredDate + '</td></tr>'
      + '<tr><td style="padding:8px 0;font-weight:600;color:#333;">Time:</td><td style="padding:8px 0;color:#555;">' + preferredTime + '</td></tr>'
      + (quoteId ? '<tr><td style="padding:8px 0;font-weight:600;color:#333;">Draft Quote:</td><td style="padding:8px 0;color:#555;"><strong>' + quoteId + '</strong></td></tr>' : '')
      + (indicativeQuote ? '<tr><td style="padding:8px 0;font-weight:600;color:#333;">Indicative Quote:</td><td style="padding:8px 0;color:#555;">' + indicativeQuote + '</td></tr>' : '')
      + (quoteBreakdown ? '<tr><td style="padding:8px 0;font-weight:600;color:#333;">Breakdown:</td><td style="padding:8px 0;color:#555;">' + quoteBreakdown + '</td></tr>' : '')
      + (distance ? '<tr><td style="padding:8px 0;font-weight:600;color:#333;">Distance:</td><td style="padding:8px 0;color:#555;">' + Math.round(distance) + ' miles (' + driveTime + ' min drive)</td></tr>' : '')
      + (gardenSummary ? '<tr><td style="padding:8px 0;font-weight:600;color:#333;">Garden Info:</td><td style="padding:8px 0;color:#555;">' + gardenSummary + '</td></tr>' : '')
      + (notes ? '<tr><td style="padding:8px 0;font-weight:600;color:#333;">Notes:</td><td style="padding:8px 0;color:#555;">' + notes + '</td></tr>' : '')
      + '</table>'
      + '<hr style="border:none;border-top:1px solid #e0e0e0;margin:16px 0;">'
      + '<p style="font-size:0.85rem;color:#1B5E20;font-weight:600;">💰 Open GGM Hub → Quotes to price this job and send the customer a formal quote.' + (slotAvailable ? ' Their requested slot is currently free — act fast!' : '') + '</p>'
      + '<p style="font-size:0.8rem;color:#999;">Submitted via booking form on ' + new Date().toLocaleDateString('en-GB') + '</p>'
      + '</div></div>';

    var adminResult = sendEmail({
      to: 'info@gardnersgm.co.uk',
      toName: '',
      subject: adminSubject,
      htmlBody: adminHtml,
      replyTo: email,
      name: 'Gardners Ground Maintenance'
    });
    emailResults.admin = adminResult.provider || 'sent';
  } catch(adminErr) {
    emailResults.admin = 'error: ' + String(adminErr);
    Logger.log('Service enquiry admin email error: ' + adminErr);
  }

  // ── Step 6: Dual-write to Supabase ──
  try {
    supabaseInsert('enquiries', {
      name: name, email: email, phone: phone, service: service,
      message: notes, type: 'Service Enquiry', status: 'New',
      date: timestamp, replied: 'No',
      garden_details: gardenDetails || {},
      notes: 'Preferred: ' + preferredDate + ' ' + preferredTime + '. Quote: ' + indicativeQuote + '. Slot: ' + (slotAvailable ? 'Available' : 'Unavailable')
    });
    if (quoteId) {
      supabaseUpsert('quotes', {
        quote_number: quoteId,
        client_name: name, client_email: email, client_phone: phone,
        postcode: postcode, address: address, service: service,
        items: [], subtotal: 0, discount: 0, vat: 0, total: 0,
        status: 'Draft', date_created: timestamp,
        valid_until: validUntil ? validUntil.toISOString() : '',
        notes: 'Service enquiry from website. Preferred date: ' + preferredDate + ' ' + preferredTime
          + (gardenSummary ? '. Garden: ' + gardenSummary : '')
          + (notes ? '. Notes: ' + notes : '')
      }, 'quote_number');
    }
  } catch(supaErr) {
    Logger.log('Supabase dual-write error (enquiry): ' + supaErr);
  }

  // ── Step 7: Telegram notification ──
  try {
    var tgEmoji = slotAvailable ? '🟢' : '📩';
    var tgTitle = 'NEW SERVICE ENQUIRY';
    var tgMsg = tgEmoji + ' *' + tgTitle + '*\n'
      + '━━━━━━━━━━━━━━━━━━━━\n\n'
      + '🌿 *Service:* ' + service + '\n'
      + (indicativeQuote ? '💰 *Indicative Quote:* ' + indicativeQuote + '\n' : '')
      + (quoteBreakdown ? '📋 *Breakdown:* ' + quoteBreakdown + '\n' : '')
      + '📆 *Date:* ' + preferredDate + (slotAvailable ? ' ✅ SLOT FREE' : (preferredDate ? ' ⚠️ May be taken' : ' _Not specified_')) + '\n'
      + '🕐 *Time:* ' + preferredTime + '\n'
      + (gardenSummary ? '\n📐 *Garden Info:* ' + gardenSummary + '\n' : '')
      + '\n👤 *Customer:* ' + name + '\n'
      + '📧 *Email:* ' + email + '\n'
      + '📞 *Phone:* ' + phone + '\n'
      + '📍 *Address:* ' + address + ', ' + postcode + '\n'
      + (mapsUrl ? '🗺 [Get Directions](' + mapsUrl + ')\n\n' : '\n')
      + '📝 *Draft Quote:* #' + quoteId + '\n'
      + '💰 *Action:* Price this job in GGM Hub → Quotes and send to customer';
    notifyTelegram(tgMsg);
  } catch(tgErr) {
    Logger.log('Service enquiry Telegram error: ' + tgErr);
  }

  return ContentService
    .createTextOutput(JSON.stringify({
      status: 'success',
      message: 'Enquiry submitted — quote will follow',
      autoBooked: false,
      jobNumber: '',
      quoteId: quoteId,
      slotAvailable: slotAvailable,
      emails: emailResults
    }))
    .setMimeType(ContentService.MimeType.JSON);
}


function handleBespokeEnquiry(data) {
  var name = data.name || 'Unknown';
  var email = data.email || '';
  var phone = data.phone || '';
  var description = data.description || '';
  var timestamp = new Date().toISOString();
  
  // 1) Send admin email to info@gardnersgm.co.uk
  try {
    var subject = '🔧 Bespoke Work Enquiry from ' + name;
    var htmlBody = '<div style="font-family:Poppins,Arial,sans-serif;max-width:600px;margin:0 auto;">' +
      '<div style="background:#2E7D32;color:#fff;padding:20px 24px;border-radius:12px 12px 0 0;">' +
      '<h2 style="margin:0;font-size:1.3rem;">🔧 Bespoke Work Enquiry</h2>' +
      '</div>' +
      '<div style="background:#f9f9f9;padding:24px;border:1px solid #e0e0e0;border-top:none;border-radius:0 0 12px 12px;">' +
      '<table style="width:100%;border-collapse:collapse;">' +
      '<tr><td style="padding:8px 0;font-weight:600;color:#333;width:120px;">Name:</td><td style="padding:8px 0;color:#555;">' + name + '</td></tr>' +
      '<tr><td style="padding:8px 0;font-weight:600;color:#333;">Email:</td><td style="padding:8px 0;color:#555;"><a href="mailto:' + email + '">' + email + '</a></td></tr>' +
      '<tr><td style="padding:8px 0;font-weight:600;color:#333;">Phone:</td><td style="padding:8px 0;color:#555;"><a href="tel:' + phone + '">' + phone + '</a></td></tr>' +
      '</table>' +
      '<hr style="border:none;border-top:1px solid #e0e0e0;margin:16px 0;">' +
      '<h3 style="margin:0 0 8px;color:#333;font-size:1rem;">Description of Work</h3>' +
      '<p style="color:#555;line-height:1.6;white-space:pre-wrap;">' + description + '</p>' +
      '<hr style="border:none;border-top:1px solid #e0e0e0;margin:16px 0;">' +
      '<p style="font-size:0.8rem;color:#999;">Submitted via website chatbot on ' + new Date().toLocaleDateString('en-GB') + '</p>' +
      '</div></div>';
    
    sendEmail({
      to: 'info@gardnersgm.co.uk',
      toName: '',
      subject: subject,
      htmlBody: htmlBody,
      replyTo: email,
      name: 'Gardners Ground Maintenance'
    });
  } catch(emailErr) {
    Logger.log('Bespoke enquiry admin email error: ' + emailErr);
  }
  
  // 1b) Send branded acknowledgement email to CUSTOMER
  if (email) {
    try {
      var firstName = name.split(' ')[0] || 'there';
      var custHtml = '<!DOCTYPE html><html><head><meta charset="utf-8"></head>'
        + '<body style="margin:0;padding:0;background:#f0f2f5;font-family:Georgia,\'Times New Roman\',serif;">'
        + '<div style="max-width:600px;margin:20px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.08);">'
        + getGgmEmailHeader({ title: '🔧 Enquiry Received', subtitle: 'Bespoke Work Request' })
        + '<div style="padding:30px;">'
        + '<h2 style="color:#333;margin:0 0 16px;font-size:1.2rem;">Hi ' + firstName + ',</h2>'
        + '<p style="color:#555;line-height:1.6;">Thank you for getting in touch about your bespoke work request. '
        + 'Chris will review your enquiry and get back to you with a personalised quote, usually within 24 hours.</p>'
        + '<div style="background:#E8F5E9;border-radius:8px;padding:16px;margin:20px 0;">'
        + '<h3 style="margin:0 0 8px;color:#1B5E20;font-size:1rem;">📋 Your Request</h3>'
        + '<p style="color:#555;line-height:1.6;white-space:pre-wrap;">' + description + '</p>'
        + '</div>'
        + '<p style="color:#555;line-height:1.6;">We\'ll be in touch shortly. No payment is required until you\'re happy to go ahead.</p>'
        + '</div>'
        + getGgmEmailFooter(email)
        + '</div></body></html>';
      
      sendEmail({
        to: email, toName: name,
        subject: '🔧 Enquiry Received — Bespoke Work | Gardners GM',
        htmlBody: custHtml,
        replyTo: 'info@gardnersgm.co.uk',
        name: 'Gardners Ground Maintenance'
      });
    } catch(custErr) { Logger.log('Bespoke enquiry customer ack email error: ' + custErr); }
  }
  
  // 2) Send Telegram notification
  try {
    var tgMsg = '🔧 *BESPOKE WORK ENQUIRY*\n' +
      '━━━━━━━━━━━━━━━━━━━━\n\n' +
      '👤 *Name:* ' + name + '\n' +
      '📧 *Email:* ' + email + '\n' +
      '📞 *Phone:* ' + phone + '\n\n' +
      '📝 *Description:*\n' + description + '\n\n' +
      '⚡ _Reply to this customer to discuss the job and quote._';
    notifyTelegram(tgMsg);
  } catch(tgErr) {
    Logger.log('Bespoke enquiry Telegram error: ' + tgErr);
  }
  
  // 3) Log to Enquiries sheet
  try {
    var ss = SpreadsheetApp.openById('1_Y7yHIpAvv_VNBhTrwNOQaBMAGa3UlVW_FKlf56ouHk');
    var sheet = ss.getSheetByName('Enquiries');
    if (!sheet) {
      sheet = ss.insertSheet('Enquiries');
      sheet.appendRow(['Timestamp', 'Name', 'Email', 'Phone', 'Description', 'Status', 'Type']);
      sheet.getRange(1, 1, 1, 7).setFontWeight('bold');
      sheet.setFrozenRows(1);
    }
    sheet.appendRow([timestamp, name, email, phone, description, 'New', 'Bespoke']);
  } catch(sheetErr) {
    Logger.log('Bespoke enquiry sheet log error: ' + sheetErr);
  }
  
  // 4) Auto-create Draft Quote in Quotes sheet so Chris can build it fast
  var quoteId = '';
  try {
    var quotesSheet = getOrCreateQuotesSheet();
    quoteId = generateQuoteId();
    var token = generateQuoteToken();
    var validUntil = new Date();
    validUntil.setDate(validUntil.getDate() + 30); // 30-day validity
    
    // Parse title from description if format is [Title] Description
    var quoteTitle = 'Bespoke Work Request';
    var quoteNotes = description;
    var titleMatch = description.match(/^\[([^\]]+)\]\s*([\s\S]*)$/);
    if (titleMatch) {
      quoteTitle = titleMatch[1];
      quoteNotes = titleMatch[2];
    }
    
    // Quotes sheet columns: Quote ID, Created, Customer Name, Customer Email, Customer Phone,
    // Customer Address, Customer Postcode, Quote Title, Line Items JSON, Subtotal, Discount %,
    // Discount Amount, VAT Amount, Grand Total, Deposit Required, Deposit Amount, Status, Token,
    // Sent Date, Response Date, Decline Reason, Notes, Valid Until, Job Number, Deposit Paid, Deposit PI ID
    quotesSheet.appendRow([
      quoteId,                              // Quote ID
      timestamp,                            // Created
      name,                                 // Customer Name
      email,                                // Customer Email
      phone,                                // Customer Phone
      data.address || '',                   // Customer Address
      data.postcode || '',                  // Customer Postcode
      quoteTitle,                           // Quote Title
      '[]',                                 // Line Items JSON (empty — Chris fills in)
      0,                                    // Subtotal
      0,                                    // Discount %
      0,                                    // Discount Amount
      0,                                    // VAT Amount
      0,                                    // Grand Total
      'Yes',                                // Deposit Required
      0,                                    // Deposit Amount
      'Draft',                              // Status
      token,                                // Token
      '',                                   // Sent Date
      '',                                   // Response Date
      '',                                   // Decline Reason
      quoteNotes,                           // Notes — full description
      validUntil.toISOString(),             // Valid Until
      '',                                   // Job Number
      'No',                                 // Deposit Paid
      ''                                    // Deposit PI ID
    ]);
    Logger.log('Auto-created draft quote ' + quoteId + ' for bespoke enquiry from ' + name);
  } catch(quoteErr) {
    Logger.log('Auto-create draft quote error: ' + quoteErr);
  }
  
  return ContentService
    .createTextOutput(JSON.stringify({ status: 'success', message: 'Enquiry submitted successfully', quoteId: quoteId }))
    .setMimeType(ContentService.MimeType.JSON);
}


// ============================================
// CONTACT FORM ENQUIRY (branded email)
// ============================================

function handleContactEnquiry(data) {
  var name = data.name || '';
  var email = data.email || '';
  var phone = data.phone || '';
  var subject = data.subject || 'General Enquiry';
  var message = data.message || '';
  var firstName = name.split(' ')[0] || 'there';
  
  // 1) Send branded confirmation email to customer
  try {
    var customerHtml = '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>'
      + '<body style="margin:0;padding:0;background:#f4f7f4;font-family:Arial,Helvetica,sans-serif;">'
      + '<div style="max-width:600px;margin:20px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.1);">'
      + '<div style="background:linear-gradient(135deg,#1B5E20,#2E7D32);padding:30px;text-align:center;">'
      + '<h1 style="color:#fff;margin:0;font-size:22px;">\ud83c\udf3f Gardners Ground Maintenance</h1>'
      + '<p style="color:rgba(255,255,255,0.85);margin:6px 0 0;font-size:13px;">Professional Garden Care in Cornwall</p>'
      + '</div>'
      + '<div style="padding:30px;">'
      + '<h2 style="color:#333;margin:0 0 10px;font-size:18px;">Hi ' + firstName + ',</h2>'
      + '<p style="color:#555;line-height:1.6;">Thanks for getting in touch! We\u2019ve received your message and will get back to you within 24 hours.</p>'
      + '<div style="background:#E8F5E9;border-radius:8px;padding:20px;margin:20px 0;">'
      + '<p style="margin:0 0 8px;font-weight:bold;color:#2E7D32;">Your Message</p>'
      + '<p style="color:#555;margin:0 0 4px;"><strong>Subject:</strong> ' + subject + '</p>'
      + '<p style="color:#555;margin:0;white-space:pre-wrap;">' + message + '</p>'
      + '</div>'
      + '<p style="color:#555;line-height:1.6;">In the meantime, feel free to call us on <strong>01726 432051</strong> if your enquiry is urgent.</p>'
      + '<p style="color:#333;font-weight:bold;margin-top:20px;">Best regards,<br>Chris Gardner<br>Gardners Ground Maintenance</p>'
      + '</div>'
      + '<div style="background:#f5f5f5;padding:16px;text-align:center;border-top:1px solid #eee;">'
      + '<p style="margin:0;color:#999;font-size:12px;">Gardners Ground Maintenance \u00b7 Roche, Cornwall \u00b7 <a href="https://gardnersgm.co.uk" style="color:#4CAF50;">gardnersgm.co.uk</a></p>'
      + '<p style="margin:4px 0 0;color:#bbb;font-size:11px;">\ud83d\udcde 01726 432051 \u00b7 \ud83d\udce7 info@gardnersgm.co.uk</p>'
      + '</div></div></body></html>';
    
    sendEmail({
      to: email,
      toName: '',
      subject: 'Thanks for your message \u2014 Gardners Ground Maintenance',
      htmlBody: customerHtml,
      name: 'Gardners Ground Maintenance',
      replyTo: 'info@gardnersgm.co.uk'
    });
  } catch(emailErr) {
    Logger.log('Contact confirmation email error: ' + emailErr);
  }
  
  // 2) Send notification email to admin
  try {
    sendEmail({
      to: 'info@gardnersgm.co.uk',
      toName: '',
      subject: '\ud83d\udcec Contact Enquiry \u2014 ' + name + ' \u2014 ' + subject,
      htmlBody: '<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">'
        + '<h2 style="color:#2E7D32;">New Contact Enquiry</h2>'
        + '<table style="width:100%;border-collapse:collapse;">'
        + '<tr><td style="padding:6px 0;font-weight:600;">Name:</td><td>' + name + '</td></tr>'
        + '<tr><td style="padding:6px 0;font-weight:600;">Email:</td><td><a href="mailto:' + email + '">' + email + '</a></td></tr>'
        + '<tr><td style="padding:6px 0;font-weight:600;">Phone:</td><td><a href="tel:' + phone + '">' + phone + '</a></td></tr>'
        + '<tr><td style="padding:6px 0;font-weight:600;">Subject:</td><td>' + subject + '</td></tr>'
        + '</table>'
        + '<hr style="border:none;border-top:1px solid #eee;margin:16px 0;">'
        + '<h3 style="margin:0 0 8px;color:#333;">Message</h3>'
        + '<p style="color:#555;line-height:1.6;white-space:pre-wrap;">' + message + '</p>'
        + '</div>',
      replyTo: email,
      name: 'Gardners Ground Maintenance'
    });
  } catch(e) {
    Logger.log('Contact admin email error: ' + e);
  }
  
  // 3) Telegram notification
  try {
    notifyTelegram('\ud83d\udcec *NEW CONTACT ENQUIRY*\n\n\ud83d\udc64 *Name:* ' + name + '\n\ud83d\udce7 *Email:* ' + email + '\n\ud83d\udcde *Phone:* ' + (phone || 'Not provided') + '\n\ud83d\udcdd *Subject:* ' + subject + '\n\n\ud83d\udcac *Message:*\n' + message);
  } catch(tgErr) {}
  
  // 4) Log to Enquiries sheet (so contact form submissions are never lost)
  try {
    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var enqSheet = ss.getSheetByName('Enquiries');
    if (!enqSheet) {
      enqSheet = ss.insertSheet('Enquiries');
      enqSheet.appendRow(['Timestamp', 'Name', 'Email', 'Phone', 'Description', 'Status', 'Type']);
      enqSheet.getRange(1, 1, 1, 7).setFontWeight('bold');
      enqSheet.setFrozenRows(1);
    }
    enqSheet.appendRow([new Date().toISOString(), name, email, phone, subject + ': ' + message, 'New', 'Contact']);
  } catch(sheetErr) {
    Logger.log('Contact enquiry sheet log error: ' + sheetErr);
  }
  
  return ContentService
    .createTextOutput(JSON.stringify({ status: 'success', message: 'Enquiry received' }))
    .setMimeType(ContentService.MimeType.JSON);
}


// ============================================
// TRACK EMAIL — HELPER
// ============================================

function trackEmail(email, name, type, service, jobNumber) {
  try {
    var sheet = getOrCreateEmailTrackingSheet();
    sheet.appendRow([
      new Date().toISOString(),
      email || '',
      name || '',
      type || '',
      service || '',
      jobNumber || '',
      type || '',
      'Sent'
    ]);
  } catch(e) {
    Logger.log('trackEmail error: ' + e);
  }
}


// ============================================
// LOG TERMS ACCEPTANCE
// ============================================

function logTermsAcceptance(data) {
  try {
    var ss = SpreadsheetApp.openById('1_Y7yHIpAvv_VNBhTrwNOQaBMAGa3UlVW_FKlf56ouHk');
    var sheet = ss.getSheetByName('Terms Acceptance');
    if (!sheet) {
      sheet = ss.insertSheet('Terms Acceptance');
      sheet.appendRow(['Timestamp', 'Name', 'Email', 'Job Number', 'Terms Type', 'Service', 'IP Timestamp', 'Status']);
      sheet.setFrozenRows(1);
      sheet.getRange(1, 1, 1, 8).setFontWeight('bold').setBackground('#2E7D32').setFontColor('#fff');
      sheet.setColumnWidth(1, 180);
      sheet.setColumnWidth(2, 150);
      sheet.setColumnWidth(3, 220);
      sheet.setColumnWidth(4, 120);
      sheet.setColumnWidth(5, 120);
      sheet.setColumnWidth(6, 160);
      sheet.setColumnWidth(7, 180);
    }
    sheet.appendRow([
      new Date().toISOString(),
      data.name || '',
      data.email || '',
      data.jobNumber || '',
      data.termsType || '',
      data.service || '',
      data.termsTimestamp || '',
      'Accepted'
    ]);
  } catch(e) {
    Logger.log('logTermsAcceptance error: ' + e);
  }
}


// ============================================
// PAY-LATER INVOICE EMAIL
// ============================================

function sendPayLaterInvoiceEmail(data) {
  if (!data.email) return;

  var firstName = (data.name || 'Valued Customer').split(' ')[0];
  var svc = getServiceContent(data.service);
  var svcIcon = svc ? svc.icon : '🌿';
  var svcName = svc ? svc.name : (data.service || 'Garden Service');
  var priceDisplay = data.price ? '£' + data.price : '';
  var dateDisplay = data.date || 'To be confirmed';
  var jobNumber = data.jobNumber || 'Pending';
  var dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + 14);
  var dueDateStr = dueDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

  var subject = '📋 Booking Confirmed — Payment Due After Service | ' + svcName + ' | Gardners GM';

  var html = '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:0;background:#f4f7f4;font-family:Arial,Helvetica,sans-serif;">'
    + '<div style="max-width:600px;margin:0 auto;background:#ffffff;">'
    // Header
    + '<div style="background:linear-gradient(135deg,#E65100,#FF8F00);padding:30px;text-align:center;">'
    + '<h1 style="color:#fff;margin:0;font-size:22px;">📋 Pay Later — Invoice Details</h1>'
    + '<p style="color:rgba(255,255,255,0.9);margin:8px 0 0;font-size:13px;">Gardners Ground Maintenance</p>'
    + '</div>'
    // Body
    + '<div style="padding:30px;">'
    + '<h2 style="color:#2E7D32;margin:0 0 10px;">Hi ' + firstName + ',</h2>'
    + '<p style="color:#333;line-height:1.6;margin:0 0 20px;">Thank you for choosing Gardners Ground Maintenance. You\'ve selected <strong>Pay Later</strong> for your booking. Here are the details and payment terms:</p>'

    // Invoice Details Card
    + '<div style="background:#f8faf8;border:1px solid #e0e8e0;border-radius:8px;overflow:hidden;margin:20px 0;">'
    + '<div style="background:#E65100;padding:12px 15px;"><h3 style="color:#fff;margin:0;font-size:15px;">📋 Invoice Summary</h3></div>'
    + '<table style="width:100%;border-collapse:collapse;">'
    + '<tr><td style="padding:10px 15px;color:#666;font-weight:600;width:140px;">Job Reference</td><td style="padding:10px 15px;font-weight:700;color:#2E7D32;">' + jobNumber + '</td></tr>'
    + '<tr style="background:#f0f5f0;"><td style="padding:10px 15px;color:#666;font-weight:600;">Service</td><td style="padding:10px 15px;">' + svcIcon + ' ' + svcName + '</td></tr>'
    + '<tr><td style="padding:10px 15px;color:#666;font-weight:600;">Service Date</td><td style="padding:10px 15px;">' + dateDisplay + '</td></tr>'
    + (priceDisplay ? '<tr style="background:#f0f5f0;"><td style="padding:10px 15px;color:#666;font-weight:600;">Amount Due</td><td style="padding:10px 15px;font-weight:700;font-size:18px;color:#E65100;">' + priceDisplay + '</td></tr>' : '')
    + '<tr><td style="padding:10px 15px;color:#666;font-weight:600;">Payment Due By</td><td style="padding:10px 15px;font-weight:700;color:#E65100;">' + dueDateStr + '</td></tr>'
    + '<tr style="background:#FFF3E0;"><td colspan="2" style="padding:10px 15px;text-align:center;font-weight:700;color:#E65100;">⏳ PAYMENT DUE AFTER SERVICE — 14 DAY TERMS</td></tr>'
    + '</table></div>'

    // Payment Terms
    + '<div style="border-left:4px solid #E65100;padding:15px 20px;background:#FFF8E1;margin:20px 0;border-radius:0 8px 8px 0;">'
    + '<h3 style="color:#E65100;margin:0 0 8px;font-size:15px;">📌 Payment Terms & Conditions</h3>'
    + '<ul style="color:#555;line-height:1.8;margin:0;padding-left:18px;font-size:14px;">'
    + '<li>Payment is due <strong>within 14 days</strong> of service completion</li>'
    + '<li>A full invoice with job photos will be sent after the work is done</li>'
    + '<li>Pay online via our secure Stripe payment link</li>'
    + '<li>Alternatively, pay by bank transfer:<br><strong>Sort Code:</strong> 04-00-03 &nbsp; <strong>Account:</strong> 39873874<br><strong>Reference:</strong> ' + jobNumber + '</li>'
    + '<li>Late payments may incur a £10 admin fee after 28 days</li>'
    + '<li>Regular non-payment may result in service suspension</li>'
    + '</ul></div>'

    // Customer Responsibilities
    + '<div style="border-left:4px solid #1565C0;padding:15px 20px;background:#E3F2FD;margin:20px 0;border-radius:0 8px 8px 0;">'
    + '<h3 style="color:#1565C0;margin:0 0 8px;font-size:15px;">👤 Your Responsibilities</h3>'
    + '<ul style="color:#555;line-height:1.8;margin:0;padding-left:18px;font-size:14px;">'
    + '<li>Ensure safe, clear access to the garden/work area</li>'
    + '<li>Inform us of any hazards, pets, or access codes beforehand</li>'
    + '<li>Move vehicles, furniture, or belongings from the work area</li>'
    + '<li>Provide at least 24 hours\' notice for cancellations or changes</li>'
    + '<li>Confirm you are the property owner or have authority to authorise work</li>'
    + '</ul></div>'

    // What to Expect
    + (svc && svc.whatToExpect 
        ? '<div style="border-left:4px solid #4CAF50;padding:15px 20px;background:#f8faf8;margin:20px 0;border-radius:0 8px 8px 0;">'
          + '<h3 style="color:#2E7D32;margin:0 0 8px;font-size:15px;">' + svcIcon + ' What to Expect</h3>'
          + '<ul style="color:#555;line-height:1.8;margin:0;padding-left:18px;font-size:14px;">' + svc.whatToExpect.map(function(item){ return '<li>' + item + '</li>'; }).join('') + '</ul></div>'
        : '')

    // Manage Booking
    + '<div style="text-align:center;margin:25px 0;">'
    + '<a href="https://gardnersgm.co.uk/cancel.html?email=' + encodeURIComponent(data.email) + '&job=' + encodeURIComponent(jobNumber) + '" style="display:inline-block;background:#E65100;color:#fff;padding:12px 30px;border-radius:50px;text-decoration:none;font-weight:600;font-size:14px;">Manage Booking</a>'
    + '</div>'

    // Contact
    + '<div style="background:#f5f5f5;border-radius:8px;padding:15px;text-align:center;margin:20px 0;">'
    + '<p style="color:#666;font-size:13px;margin:0;">Questions about payment? Call us on <strong>01726 432051</strong> or reply to this email.</p>'
    + '</div>'
    + '</div>'

    // Footer
    + '<div style="background:#333;padding:25px;text-align:center;">'
    + '<p style="color:#aaa;font-size:12px;margin:0 0 8px;">Gardners Ground Maintenance</p>'
    + '<p style="color:#888;font-size:11px;margin:0 0 5px;">📞 01726 432051 &nbsp;|&nbsp; ✉️ info@gardnersgm.co.uk</p>'
    + '<p style="color:#888;font-size:11px;margin:0 0 8px;">Roche, Cornwall PL26 8HN</p>'
    + '<p style="color:#666;font-size:10px;margin:0;"><a href="https://gardnersgm.co.uk/terms.html" style="color:#888;">Terms of Service</a> &nbsp;|&nbsp; <a href="https://gardnersgm.co.uk/privacy.html" style="color:#888;">Privacy Policy</a></p>'
    + '</div></div></body></html>';

  sendEmail({
    to: data.email,
    toName: '',
    subject: subject,
    htmlBody: html,
    name: 'Gardners Ground Maintenance',
    replyTo: 'info@gardnersgm.co.uk'
  });

  // Track the email
  try {
    logEmailSent(data.email, data.name, 'pay-later-invoice', data.service, jobNumber, subject);
  } catch(e) {
    Logger.log('Pay-later invoice email tracking error: ' + e);
  }
}


// ============================================
// SUBSCRIBER CONTRACT EMAIL (with PDF attachment)
// ============================================

function sendSubscriberContractEmail(data) {
  if (!data.email) return;

  var firstName = (data.name || 'Valued Customer').split(' ')[0];
  var packageName = data.package || 'Subscription';
  var priceDisplay = data.price ? '£' + data.price : '';
  var startDate = data.startDate || 'To be confirmed';
  var preferredDay = data.preferredDay || 'To be agreed';
  var address = data.address || '';
  var postcode = data.postcode || '';
  var jobNumber = data.jobNumber || '';
  var stripeSubId = data.stripeSubscriptionId || '';
  var todayStr = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

  // Determine billing cycle from package name
  var billingCycle = 'monthly';
  var visitFrequency = 'as scheduled';
  var priceLabel = 'per month';
  if (/lawn.care.weekly/i.test(packageName)) {
    billingCycle = 'weekly';
    visitFrequency = 'every week';
    priceLabel = 'per week';
  } else if (/lawn.care.fortnightly/i.test(packageName)) {
    billingCycle = 'fortnightly';
    visitFrequency = 'every 2 weeks';
    priceLabel = 'per fortnight';
  } else if (/garden.maintenance/i.test(packageName)) {
    billingCycle = 'monthly';
    visitFrequency = 'weekly (included in monthly fee)';
    priceLabel = 'per month';
  } else if (/property.care/i.test(packageName)) {
    billingCycle = 'monthly';
    visitFrequency = 'quarterly visits (gutters, power washing, drains)';
    priceLabel = 'per month';
  }

  // Generate the PDF contract
  var pdfBlob = null;
  try {
    pdfBlob = generateSubscriptionContractPDF({
      name: data.name || 'Valued Customer',
      email: data.email,
      address: address,
      postcode: postcode,
      packageName: packageName,
      priceDisplay: priceDisplay,
      priceLabel: priceLabel,
      billingCycle: billingCycle,
      visitFrequency: visitFrequency,
      startDate: startDate,
      preferredDay: preferredDay,
      jobNumber: jobNumber,
      stripeSubId: stripeSubId,
      todayStr: todayStr
    });
  } catch(e) {
    Logger.log('PDF contract generation error: ' + e);
  }

  var subject = '📄 Subscription Agreement — ' + packageName + ' | Gardners GM';

  var html = '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:0;background:#f4f7f4;font-family:Arial,Helvetica,sans-serif;">'
    + '<div style="max-width:600px;margin:0 auto;background:#ffffff;">'
    // Header
    + '<div style="background:linear-gradient(135deg,#1565C0,#42A5F5);padding:30px;text-align:center;">'
    + '<h1 style="color:#fff;margin:0;font-size:22px;">📄 Subscription Agreement</h1>'
    + '<p style="color:rgba(255,255,255,0.9);margin:8px 0 0;font-size:13px;">Gardners Ground Maintenance — Your Garden Care Contract</p>'
    + '</div>'
    // Body
    + '<div style="padding:30px;">'
    + '<h2 style="color:#2E7D32;margin:0 0 10px;">Hi ' + firstName + ',</h2>'
    + '<p style="color:#333;line-height:1.6;margin:0 0 20px;">Welcome to Gardners Ground Maintenance! Your subscription contract is attached to this email as a PDF. Below is a summary — please keep both this email and the attached contract for your records.</p>'

    // Intro Visit Welcome (if applicable)
    + (data.introVisit 
      ? '<div style="background:#E3F2FD;border:2px solid #1565C0;border-radius:8px;padding:15px;margin:0 0 20px;">'
        + '<p style="color:#1565C0;font-weight:700;margin:0 0 8px;font-size:15px;">🤝 Your Free Intro Visit</p>'
        + '<p style="color:#555;font-size:13px;line-height:1.6;margin:0;">Before any paid work starts, Chris will visit your property for a free meet-and-greet. He\'ll walk round with you, discuss your requirements, and make sure everything is set up exactly how you want it. We\'ll be in touch to arrange a time that suits you.</p>'
        + '</div>' 
      : '')

    // Clippings Discount Note (if applicable)  
    + (data.keepClippings 
      ? '<div style="background:#E8F5E9;border:2px solid #4CAF50;border-radius:8px;padding:15px;margin:0 0 20px;">'
        + '<p style="color:#2E7D32;font-weight:700;margin:0 0 8px;font-size:15px;">♻️ Clippings Kept for Composting</p>'
        + '<p style="color:#555;font-size:13px;line-height:1.6;margin:0;">You\'ve chosen to keep your grass clippings — great for your compost and your wallet! A <strong>£5/visit discount</strong> has been applied to your mowing visits. We\'ll leave clippings on the lawn or in your designated compost area.</p>'
        + '</div>' 
      : '')

    // Agreement Banner
    + '<div style="background:#E3F2FD;border:2px solid #1565C0;border-radius:8px;padding:15px;text-align:center;margin:0 0 20px;">'
    + '<span style="color:#1565C0;font-weight:700;font-size:16px;">🔄 SUBSCRIPTION CONTRACT</span><br>'
    + '<span style="color:#555;font-size:12px;">Agreement Date: ' + todayStr + '</span><br>'
    + '<span style="color:#1565C0;font-size:12px;font-weight:600;">📎 Full contract PDF attached to this email</span>'
    + '</div>'

    // IMPORTANT ROLLING CONTRACT NOTICE
    + '<div style="background:#FFF3E0;border:2px solid #E65100;border-radius:8px;padding:15px;margin:0 0 20px;">'
    + '<p style="color:#E65100;font-weight:700;margin:0 0 8px;font-size:14px;">⚠️ Rolling Contract — Please Read</p>'
    + '<p style="color:#555;font-size:13px;line-height:1.6;margin:0;">This is a <strong>rolling subscription</strong>. Unless you cancel, we will attend your property on each scheduled visit and your payment method will be charged automatically. You may cancel at any time — see Section 3 of the attached contract.</p>'
    + '</div>'

    // Subscription Details
    + '<div style="background:#f8faf8;border:1px solid #e0e8e0;border-radius:8px;overflow:hidden;margin:20px 0;">'
    + '<div style="background:#1565C0;padding:12px 15px;"><h3 style="color:#fff;margin:0;font-size:15px;">📦 Your Subscription Details</h3></div>'
    + '<table style="width:100%;border-collapse:collapse;">'
    + (jobNumber ? '<tr><td style="padding:10px 15px;color:#666;font-weight:600;width:150px;">Reference</td><td style="padding:10px 15px;font-weight:700;color:#1565C0;">' + jobNumber + '</td></tr>' : '')
    + '<tr style="background:#f0f5f0;"><td style="padding:10px 15px;color:#666;font-weight:600;">Package</td><td style="padding:10px 15px;font-weight:700;">' + packageName + '</td></tr>'
    + (priceDisplay ? '<tr><td style="padding:10px 15px;color:#666;font-weight:600;">Price</td><td style="padding:10px 15px;font-weight:700;font-size:18px;color:#2E7D32;">' + priceDisplay + ' ' + priceLabel + '</td></tr>' : '')
    + '<tr style="background:#f0f5f0;"><td style="padding:10px 15px;color:#666;font-weight:600;">Billing Cycle</td><td style="padding:10px 15px;">' + billingCycle.charAt(0).toUpperCase() + billingCycle.slice(1) + '</td></tr>'
    + '<tr><td style="padding:10px 15px;color:#666;font-weight:600;">Visit Frequency</td><td style="padding:10px 15px;">' + visitFrequency.charAt(0).toUpperCase() + visitFrequency.slice(1) + '</td></tr>'
    + '<tr style="background:#f0f5f0;"><td style="padding:10px 15px;color:#666;font-weight:600;">Start Date</td><td style="padding:10px 15px;">' + startDate + '</td></tr>'
    + '<tr><td style="padding:10px 15px;color:#666;font-weight:600;">Preferred Day</td><td style="padding:10px 15px;">' + preferredDay + '</td></tr>'
    + (address ? '<tr style="background:#f0f5f0;"><td style="padding:10px 15px;color:#666;font-weight:600;">Service Address</td><td style="padding:10px 15px;">' + address + (postcode ? ', ' + postcode : '') + '</td></tr>' : '')
    + (stripeSubId ? '<tr><td style="padding:10px 15px;color:#666;font-weight:600;">Subscription ID</td><td style="padding:10px 15px;font-size:12px;color:#999;">' + stripeSubId + '</td></tr>' : '')
    + (data.introVisit ? '<tr style="background:#E3F2FD;"><td style="padding:10px 15px;color:#1565C0;font-weight:600;">🤝 Intro Visit</td><td style="padding:10px 15px;font-weight:700;color:#1565C0;">FREE meet & greet — Chris will visit first to discuss your requirements</td></tr>' : '')
    + (data.keepClippings ? '<tr style="background:#E8F5E9;"><td style="padding:10px 15px;color:#2E7D32;font-weight:600;">♻️ Clippings</td><td style="padding:10px 15px;font-weight:700;color:#2E7D32;">Kept for composting — £5/visit discount applied</td></tr>' : '')
    + '</table></div>'

    // Key terms summary in email (full terms in PDF)
    + '<div style="border:2px solid #2E7D32;border-radius:8px;overflow:hidden;margin:20px 0;">'
    + '<div style="background:#2E7D32;padding:12px 15px;"><h3 style="color:#fff;margin:0;font-size:15px;">📜 Key Terms Summary</h3></div>'
    + '<div style="padding:20px;">'
    + '<p style="color:#555;font-size:13px;line-height:1.6;margin:0 0 12px;">The full binding contract is attached as a PDF. Here are the key points:</p>'
    + '<ul style="color:#555;font-size:13px;line-height:1.8;margin:0 0 15px;padding-left:18px;">'
    + '<li><strong>Rolling contract:</strong> This subscription continues automatically until you cancel</li>'
    + '<li><strong>Automatic attendance:</strong> Unless cancelled, we will attend your property on each scheduled visit</li>'
    + '<li><strong>Automatic billing:</strong> Your payment will be collected ' + billingCycle + ' via Direct Debit — charges continue until you cancel</li>'
    + '<li><strong>Cancel anytime:</strong> No exit fees, no penalties — just contact us</li>'
    + '<li><strong>Cancellation takes effect</strong> from the next billing cycle</li>'
    + '<li><strong>Quality guarantee:</strong> Not satisfied? Contact us within 48 hours and we\'ll return at no cost</li>'
    + '<li><strong>Weather:</strong> Rescheduled visits within 3 working days if weather prevents attendance</li>'
    + '</ul>'
    + '</div></div>'

    // Agreement acceptance note
    + '<div style="background:#E8F5E9;border:1px solid #A5D6A7;border-radius:8px;padding:15px;text-align:center;margin:20px 0;">'
    + '<p style="color:#2E7D32;font-weight:700;margin:0 0 5px;font-size:14px;">✅ Terms Accepted at Booking</p>'
    + '<p style="color:#555;font-size:12px;margin:0;">By completing your subscription on ' + todayStr + ', you agreed to these terms. The attached PDF is your binding contract. You may cancel at any time by contacting us.</p>'
    + '</div>'

    // Manage Subscription
    + '<div style="text-align:center;margin:25px 0;">'
    + '<a href="https://gardnersgm.co.uk/my-account.html" style="display:inline-block;background:#1565C0;color:#fff;padding:12px 30px;border-radius:50px;text-decoration:none;font-weight:600;font-size:14px;margin:0 6px;">Manage Subscription</a>'
    + '<a href="https://gardnersgm.co.uk/cancel.html?email=' + encodeURIComponent(data.email) + '&job=' + encodeURIComponent(jobNumber) + '" style="display:inline-block;background:#fff;color:#E65100;padding:12px 30px;border-radius:50px;text-decoration:none;font-weight:600;font-size:14px;border:2px solid #E65100;margin:0 6px;">Cancel Subscription</a>'
    + '</div>'

    // Contact
    + '<div style="background:#f5f5f5;border-radius:8px;padding:15px;text-align:center;margin:20px 0;">'
    + '<p style="color:#666;font-size:13px;margin:0;">Questions? Call <strong>01726 432051</strong> or email <strong>info@gardnersgm.co.uk</strong></p>'
    + '</div>'
    + '</div>'

    // Footer
    + '<div style="background:#333;padding:25px;text-align:center;">'
    + '<p style="color:#aaa;font-size:12px;margin:0 0 8px;">Gardners Ground Maintenance</p>'
    + '<p style="color:#888;font-size:11px;margin:0 0 5px;">📞 01726 432051 &nbsp;|&nbsp; ✉️ info@gardnersgm.co.uk</p>'
    + '<p style="color:#888;font-size:11px;margin:0 0 8px;">Roche, Cornwall PL26 8HN</p>'
    + '<p style="color:#666;font-size:10px;margin:0;"><a href="https://gardnersgm.co.uk/terms.html" style="color:#888;">Terms of Service</a> &nbsp;|&nbsp; <a href="https://gardnersgm.co.uk/privacy.html" style="color:#888;">Privacy Policy</a> &nbsp;|&nbsp; <a href="https://gardnersgm.co.uk/subscription-terms.html" style="color:#888;">Subscription Agreement</a></p>'
    + '</div></div></body></html>';

  // Build email params with optional PDF attachment
  var emailParams = {
    to: data.email,
    subject: subject,
    htmlBody: html,
    name: 'Gardners Ground Maintenance',
    replyTo: 'info@gardnersgm.co.uk'
  };
  if (pdfBlob) {
    emailParams.attachments = [pdfBlob];
  }
  sendEmail(emailParams);

  // Track the email
  try {
    logEmailSent(data.email, data.name, 'subscriber-contract', data.package || 'subscription', jobNumber, subject);
  } catch(e) {
    Logger.log('Subscriber contract email tracking error: ' + e);
  }

  // Notify admin via Telegram
  try {
    var contractAddr = (address || '') + (postcode ? ', ' + postcode : '');
    var contractMapsLink = contractAddr ? '\n🗺 [Get Directions](https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(contractAddr) + ')' : '';
    notifyBot('moneybot', '📄 *SUBSCRIBER CONTRACT SENT*\n\n👤 ' + (data.name || 'Unknown') + '\n📧 ' + data.email + '\n📦 ' + packageName + '\n💰 ' + priceDisplay + ' ' + priceLabel + '\n🔄 ' + billingCycle + '\n📅 Starts: ' + startDate + '\n🏠 ' + address + '\n📎 PDF contract attached: ' + (pdfBlob ? 'Yes' : 'Failed') + contractMapsLink);
  } catch(e) {
    Logger.log('Subscriber contract Telegram error: ' + e);
  }
}


// ============================================
// PDF CONTRACT GENERATOR
// ============================================

function generateSubscriptionContractPDF(contractData) {
  // Create a Google Doc, populate it with the contract, convert to PDF, delete the doc
  var doc = DocumentApp.create('GGM Contract — ' + contractData.name + ' — ' + contractData.jobNumber);
  var body = doc.getBody();

  // --- Styling helpers ---
  var headingStyle = {};
  headingStyle[DocumentApp.Attribute.FONT_SIZE] = 16;
  headingStyle[DocumentApp.Attribute.BOLD] = true;
  headingStyle[DocumentApp.Attribute.FOREGROUND_COLOR] = '#1565C0';
  headingStyle[DocumentApp.Attribute.FONT_FAMILY] = 'Arial';

  var subHeadingStyle = {};
  subHeadingStyle[DocumentApp.Attribute.FONT_SIZE] = 13;
  subHeadingStyle[DocumentApp.Attribute.BOLD] = true;
  subHeadingStyle[DocumentApp.Attribute.FOREGROUND_COLOR] = '#2E7D32';
  subHeadingStyle[DocumentApp.Attribute.FONT_FAMILY] = 'Arial';

  var normalStyle = {};
  normalStyle[DocumentApp.Attribute.FONT_SIZE] = 11;
  normalStyle[DocumentApp.Attribute.BOLD] = false;
  normalStyle[DocumentApp.Attribute.FOREGROUND_COLOR] = '#333333';
  normalStyle[DocumentApp.Attribute.FONT_FAMILY] = 'Arial';

  var boldStyle = {};
  boldStyle[DocumentApp.Attribute.FONT_SIZE] = 11;
  boldStyle[DocumentApp.Attribute.BOLD] = true;
  boldStyle[DocumentApp.Attribute.FOREGROUND_COLOR] = '#333333';
  boldStyle[DocumentApp.Attribute.FONT_FAMILY] = 'Arial';

  var smallStyle = {};
  smallStyle[DocumentApp.Attribute.FONT_SIZE] = 9;
  smallStyle[DocumentApp.Attribute.BOLD] = false;
  smallStyle[DocumentApp.Attribute.FOREGROUND_COLOR] = '#666666';
  smallStyle[DocumentApp.Attribute.FONT_FAMILY] = 'Arial';

  var warningStyle = {};
  warningStyle[DocumentApp.Attribute.FONT_SIZE] = 11;
  warningStyle[DocumentApp.Attribute.BOLD] = true;
  warningStyle[DocumentApp.Attribute.FOREGROUND_COLOR] = '#E65100';
  warningStyle[DocumentApp.Attribute.FONT_FAMILY] = 'Arial';

  // ===== TITLE SECTION =====
  var title = body.appendParagraph('GARDNERS GROUND MAINTENANCE');
  title.setAttributes(headingStyle);
  title.setAlignment(DocumentApp.HorizontalAlignment.CENTER);

  var subtitle = body.appendParagraph('SUBSCRIPTION SERVICE AGREEMENT');
  subtitle.setAttributes(headingStyle);
  subtitle.setAlignment(DocumentApp.HorizontalAlignment.CENTER);

  body.appendParagraph('').setAttributes(normalStyle);

  var dateLine = body.appendParagraph('Agreement Date: ' + contractData.todayStr);
  dateLine.setAttributes(normalStyle);
  dateLine.setAlignment(DocumentApp.HorizontalAlignment.CENTER);

  if (contractData.jobNumber) {
    var refLine = body.appendParagraph('Reference: ' + contractData.jobNumber);
    refLine.setAttributes(normalStyle);
    refLine.setAlignment(DocumentApp.HorizontalAlignment.CENTER);
  }

  body.appendParagraph('────────────────────────────────────────').setAttributes(normalStyle);

  // ===== PARTIES =====
  var partiesHead = body.appendParagraph('PARTIES TO THIS AGREEMENT');
  partiesHead.setAttributes(subHeadingStyle);

  body.appendParagraph('Provider: Gardners Ground Maintenance, operated by Chris Gardner, Roche, Cornwall PL26 8HN').setAttributes(normalStyle);
  body.appendParagraph('Phone: 01726 432051 | Email: info@gardnersgm.co.uk').setAttributes(normalStyle);
  body.appendParagraph('').setAttributes(normalStyle);
  body.appendParagraph('Customer: ' + contractData.name).setAttributes(normalStyle);
  body.appendParagraph('Email: ' + contractData.email).setAttributes(normalStyle);
  if (contractData.address) {
    body.appendParagraph('Service Address: ' + contractData.address + (contractData.postcode ? ', ' + contractData.postcode : '')).setAttributes(normalStyle);
  }

  body.appendParagraph('────────────────────────────────────────').setAttributes(normalStyle);

  // ===== SUBSCRIPTION DETAILS =====
  var detailsHead = body.appendParagraph('SUBSCRIPTION DETAILS');
  detailsHead.setAttributes(subHeadingStyle);

  // Build a details table
  var detailsTable = body.appendTable();
  var detailRows = [
    ['Package', contractData.packageName],
    ['Price', contractData.priceDisplay + ' ' + contractData.priceLabel],
    ['Billing Cycle', contractData.billingCycle.charAt(0).toUpperCase() + contractData.billingCycle.slice(1)],
    ['Visit Frequency', contractData.visitFrequency.charAt(0).toUpperCase() + contractData.visitFrequency.slice(1)],
    ['Start Date', contractData.startDate],
    ['Preferred Day', contractData.preferredDay]
  ];
  if (contractData.stripeSubId) {
    detailRows.push(['Subscription ID', contractData.stripeSubId]);
  }
  for (var i = 0; i < detailRows.length; i++) {
    var row = (i === 0) ? detailsTable.getRow(0) : detailsTable.appendTableRow();
    if (i === 0) {
      row.getCell(0).setText(detailRows[i][0]).setAttributes(boldStyle);
      row.appendTableCell(detailRows[i][1]).setAttributes(normalStyle);
    } else {
      row.appendTableCell(detailRows[i][0]).setAttributes(boldStyle);
      row.appendTableCell(detailRows[i][1]).setAttributes(normalStyle);
    }
    if (i % 2 === 0) {
      row.getCell(0).setBackgroundColor('#F5F5F5');
      row.getCell(1).setBackgroundColor('#F5F5F5');
    }
  }

  body.appendParagraph('').setAttributes(normalStyle);
  body.appendParagraph('────────────────────────────────────────').setAttributes(normalStyle);

  // ===== IMPORTANT NOTICE: ROLLING CONTRACT =====
  var rollingHead = body.appendParagraph('⚠ IMPORTANT: ROLLING CONTRACT');
  rollingHead.setAttributes(warningStyle);

  body.appendParagraph('This is a rolling subscription agreement. By subscribing, you authorise Gardners Ground Maintenance to:').setAttributes(normalStyle);
  body.appendParagraph('').setAttributes(normalStyle);

  var rollingItems = [
    'Attend your property on each scheduled visit date as outlined above',
    'Charge your registered payment method automatically at each billing cycle',
    'Continue providing services and collecting payment until you cancel'
  ];
  for (var r = 0; r < rollingItems.length; r++) {
    body.appendListItem(rollingItems[r]).setAttributes(normalStyle).setGlyphType(DocumentApp.GlyphType.BULLET);
  }

  body.appendParagraph('').setAttributes(normalStyle);
  var rollingBold = body.appendParagraph('If you do not cancel your subscription, we will continue to attend your property and your card will continue to be charged. This contract remains binding until cancelled by you.');
  rollingBold.setAttributes(warningStyle);

  body.appendParagraph('────────────────────────────────────────').setAttributes(normalStyle);

  // ===== SECTION 1: SERVICE COMMITMENT =====
  body.appendParagraph('1. SERVICE COMMITMENT').setAttributes(subHeadingStyle);
  body.appendParagraph('Gardners Ground Maintenance ("the Provider") agrees to provide regular garden maintenance services at the above address on a ' + contractData.billingCycle + ' basis. Services will be performed to a professional standard by trained operatives.').setAttributes(normalStyle);
  body.appendParagraph('The Provider will attend the property on each scheduled visit and carry out the agreed services unless:').setAttributes(normalStyle);
  var commitItems = [
    'The subscription has been cancelled by the customer',
    'Severe weather makes it unsafe or impractical (see Section 5)',
    'Access to the property is not available (see Section 7)'
  ];
  for (var c = 0; c < commitItems.length; c++) {
    body.appendListItem(commitItems[c]).setAttributes(normalStyle).setGlyphType(DocumentApp.GlyphType.BULLET);
  }

  body.appendParagraph('').setAttributes(normalStyle);

  // ===== SECTION 2: BILLING & PAYMENT =====
  body.appendParagraph('2. BILLING & PAYMENT').setAttributes(subHeadingStyle);
  var billingItems = [
    'Your payment will be collected ' + contractData.billingCycle + ' via Stripe',
    'Charges are automatic and will continue until you cancel your subscription',
    'All prices include VAT where applicable',
    'If a payment fails, we will retry once. After a second failure, services may be paused until the payment issue is resolved',
    'You will receive an email receipt for every payment',
    'Any outstanding balance must be paid regardless of cancellation'
  ];
  for (var b = 0; b < billingItems.length; b++) {
    body.appendListItem(billingItems[b]).setAttributes(normalStyle).setGlyphType(DocumentApp.GlyphType.BULLET);
  }

  body.appendParagraph('').setAttributes(normalStyle);

  // ===== SECTION 3: CANCELLATION POLICY =====
  body.appendParagraph('3. CANCELLATION POLICY').setAttributes(subHeadingStyle);
  body.appendParagraph('You may cancel your subscription at any time. There are no exit fees and no penalties.').setAttributes(boldStyle);
  body.appendParagraph('').setAttributes(normalStyle);
  var cancelItems = [
    'To cancel, email info@gardnersgm.co.uk, call 01726 432051, or use the cancellation link in your account',
    'Cancellations take effect from the next billing cycle',
    'Any visits already paid for will still be honoured',
    'If you do not cancel, this contract remains active and services will continue as scheduled',
    'We will continue to attend your property and charge your payment method until cancellation is confirmed',
    'A cancellation confirmation email will be sent to you'
  ];
  for (var ca = 0; ca < cancelItems.length; ca++) {
    body.appendListItem(cancelItems[ca]).setAttributes(normalStyle).setGlyphType(DocumentApp.GlyphType.BULLET);
  }

  body.appendParagraph('').setAttributes(normalStyle);

  // ===== SECTION 4: AUTOMATIC RENEWAL =====
  body.appendParagraph('4. AUTOMATIC RENEWAL & CONTINUATION').setAttributes(subHeadingStyle);
  body.appendParagraph('This subscription automatically renews each billing cycle. There is no fixed end date.').setAttributes(normalStyle);
  body.appendParagraph('').setAttributes(normalStyle);
  var renewItems = [
    'Your subscription will renew automatically at the end of each ' + contractData.billingCycle + ' period',
    'The same price will be charged unless we have given you at least 30 days\' written notice of a price change',
    'If you wish to stop the service, you must actively cancel — non-use does not constitute cancellation',
    'We will attend your property on every scheduled date until we receive your cancellation request'
  ];
  for (var rn = 0; rn < renewItems.length; rn++) {
    body.appendListItem(renewItems[rn]).setAttributes(normalStyle).setGlyphType(DocumentApp.GlyphType.BULLET);
  }

  body.appendParagraph('').setAttributes(normalStyle);

  // ===== SECTION 5: SCHEDULING & WEATHER =====
  body.appendParagraph('5. SCHEDULING & WEATHER').setAttributes(subHeadingStyle);
  var scheduleItems = [
    'Visits are scheduled on your preferred day where possible',
    'Visit times are between 8:00 AM and 5:00 PM',
    'Bad weather may require rescheduling — we will notify you by text or email',
    'Rescheduled visits will take place within 3 working days',
    'During winter months (November–February), visit frequency may be adjusted with prior notice',
    'Cornwall weather can be unpredictable — skipped visits due to severe conditions will be rescheduled or credited'
  ];
  for (var s = 0; s < scheduleItems.length; s++) {
    body.appendListItem(scheduleItems[s]).setAttributes(normalStyle).setGlyphType(DocumentApp.GlyphType.BULLET);
  }

  body.appendParagraph('').setAttributes(normalStyle);

  // ===== SECTION 6: QUALITY GUARANTEE =====
  body.appendParagraph('6. QUALITY GUARANTEE').setAttributes(subHeadingStyle);
  var qualityItems = [
    'If you are not satisfied with a visit, contact us within 48 hours',
    'We will return and rectify any issues at no extra cost',
    'Job photos (before/after) may be taken for quality assurance',
    'We welcome feedback — it helps us improve and tailor our service to your garden'
  ];
  for (var q = 0; q < qualityItems.length; q++) {
    body.appendListItem(qualityItems[q]).setAttributes(normalStyle).setGlyphType(DocumentApp.GlyphType.BULLET);
  }

  body.appendParagraph('').setAttributes(normalStyle);

  // ===== SECTION 7: CUSTOMER RESPONSIBILITIES =====
  body.appendParagraph('7. CUSTOMER RESPONSIBILITIES').setAttributes(subHeadingStyle);
  var custItems = [
    'Ensure safe, clear access to the garden on each scheduled visit',
    'Inform us of any changes to access arrangements, hazards, or pets',
    'Move vehicles, toys, or personal items from the work area before each visit',
    'Ensure your Direct Debit mandate remains active with your bank',
    'If we arrive and cannot access your property, the visit counts as attended and you will still be charged'
  ];
  for (var cu = 0; cu < custItems.length; cu++) {
    body.appendListItem(custItems[cu]).setAttributes(normalStyle).setGlyphType(DocumentApp.GlyphType.BULLET);
  }

  body.appendParagraph('').setAttributes(normalStyle);

  // ===== SECTION 8: LIABILITY & INSURANCE =====
  body.appendParagraph('8. LIABILITY & INSURANCE').setAttributes(subHeadingStyle);
  var liabItems = [
    'We hold full public liability insurance for all garden maintenance activities',
    'We are not responsible for damage to underground utilities not marked or disclosed by the customer',
    'Any pre-existing damage should be noted before the first visit',
    'We take reasonable care to avoid damage to plants, structures, and property'
  ];
  for (var l = 0; l < liabItems.length; l++) {
    body.appendListItem(liabItems[l]).setAttributes(normalStyle).setGlyphType(DocumentApp.GlyphType.BULLET);
  }

  body.appendParagraph('').setAttributes(normalStyle);

  // ===== SECTION 9: PRICE CHANGES =====
  body.appendParagraph('9. PRICE CHANGES').setAttributes(subHeadingStyle);
  var priceItems = [
    'We will give you at least 30 days\' written notice of any price changes',
    'If you do not agree to the new price, you may cancel at any time (see Section 3)',
    'If you continue receiving services after the new price takes effect, you accept the revised pricing'
  ];
  for (var p = 0; p < priceItems.length; p++) {
    body.appendListItem(priceItems[p]).setAttributes(normalStyle).setGlyphType(DocumentApp.GlyphType.BULLET);
  }

  body.appendParagraph('').setAttributes(normalStyle);

  // ===== SECTION 10: DATA & PRIVACY =====
  body.appendParagraph('10. DATA & PRIVACY').setAttributes(subHeadingStyle);
  body.appendParagraph('Your personal data is handled in accordance with our Privacy Policy (https://gardnersgm.co.uk/privacy.html). We use your information only to provide and improve our services. Payment information is processed securely via Stripe and is never stored on our systems.').setAttributes(normalStyle);

  body.appendParagraph('').setAttributes(normalStyle);

  // ===== SECTION 11: GOVERNING LAW =====
  body.appendParagraph('11. GOVERNING LAW').setAttributes(subHeadingStyle);
  body.appendParagraph('This Agreement is governed by the laws of England and Wales. By subscribing, you also agree to our Terms of Service (https://gardnersgm.co.uk/terms.html) and Privacy Policy (https://gardnersgm.co.uk/privacy.html).').setAttributes(normalStyle);

  body.appendParagraph('').setAttributes(normalStyle);
  body.appendParagraph('────────────────────────────────────────').setAttributes(normalStyle);

  // ===== ACCEPTANCE =====
  body.appendParagraph('ACCEPTANCE').setAttributes(subHeadingStyle);
  body.appendParagraph('By completing the subscription checkout on ' + contractData.todayStr + ', ' + contractData.name + ' agreed to all terms in this contract.').setAttributes(normalStyle);
  body.appendParagraph('This is a digitally generated contract and does not require a physical signature.').setAttributes(smallStyle);

  body.appendParagraph('').setAttributes(normalStyle);
  body.appendParagraph('────────────────────────────────────────').setAttributes(normalStyle);

  // ===== CONTACT =====
  body.appendParagraph('CONTACT US').setAttributes(subHeadingStyle);
  body.appendParagraph('Gardners Ground Maintenance').setAttributes(boldStyle);
  body.appendParagraph('Phone: 01726 432051').setAttributes(normalStyle);
  body.appendParagraph('Email: info@gardnersgm.co.uk').setAttributes(normalStyle);
  body.appendParagraph('Website: https://gardnersgm.co.uk').setAttributes(normalStyle);
  body.appendParagraph('Address: Roche, Cornwall PL26 8HN').setAttributes(normalStyle);

  body.appendParagraph('').setAttributes(normalStyle);
  body.appendParagraph('© 2026 Gardners Ground Maintenance. All rights reserved.').setAttributes(smallStyle).setAlignment(DocumentApp.HorizontalAlignment.CENTER);

  // Save and convert to PDF
  doc.saveAndClose();
  var docFile = DriveApp.getFileById(doc.getId());
  var pdfBlob = docFile.getAs('application/pdf').setName('GGM-Subscription-Contract-' + (contractData.jobNumber || 'Agreement') + '.pdf');

  // Move the doc to a contracts folder (or trash it)
  try {
    var folders = DriveApp.getFoldersByName('GGM Subscription Contracts');
    var folder;
    if (folders.hasNext()) {
      folder = folders.next();
    } else {
      folder = DriveApp.createFolder('GGM Subscription Contracts');
    }
    folder.addFile(docFile);
    DriveApp.getRootFolder().removeFile(docFile);
  } catch(e) {
    // If folder management fails, just leave the doc in root
    Logger.log('Contract folder management error: ' + e);
  }

  return pdfBlob;
}


// ============================================
// GET EMAIL WORKFLOW STATUS (for Admin Dashboard)
// ============================================

function getEmailWorkflowStatus() {
  var result = {
    recentEmails: [],
    emailStats: { today: 0, thisWeek: 0, thisMonth: 0 },
    termsAccepted: { total: 0, payNow: 0, payLater: 0, subscription: 0 }
  };

  try {
    var ss = SpreadsheetApp.openById('1_Y7yHIpAvv_VNBhTrwNOQaBMAGa3UlVW_FKlf56ouHk');

    // Email Tracking stats
    var emailSheet = ss.getSheetByName('Email Tracking');
    if (emailSheet) {
      var emailData = emailSheet.getDataRange().getValues();
      var now = new Date();
      var todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      var weekStart = new Date(todayStart);
      weekStart.setDate(weekStart.getDate() - 7);
      var monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

      for (var i = emailData.length - 1; i >= 1; i--) {
        var sentDate = emailData[i][0] instanceof Date ? emailData[i][0] : new Date(String(emailData[i][0]));
        if (isNaN(sentDate.getTime())) continue;

        if (sentDate >= monthStart) result.emailStats.thisMonth++;
        if (sentDate >= weekStart) result.emailStats.thisWeek++;
        if (sentDate >= todayStart) result.emailStats.today++;

        // Last 20 emails for the dashboard
        if (result.recentEmails.length < 20) {
          result.recentEmails.push({
            date: sentDate.toISOString(),
            email: String(emailData[i][1] || ''),
            name: String(emailData[i][2] || ''),
            type: String(emailData[i][3] || ''),
            service: String(emailData[i][4] || ''),
            jobNumber: String(emailData[i][5] || ''),
            status: String(emailData[i][7] || 'Sent')
          });
        }
      }
    }

    // Terms Acceptance stats
    var termsSheet = ss.getSheetByName('Terms Acceptance');
    if (termsSheet) {
      var termsData = termsSheet.getDataRange().getValues();
      for (var t = 1; t < termsData.length; t++) {
        result.termsAccepted.total++;
        var tType = String(termsData[t][4] || '').toLowerCase();
        if (tType === 'pay-now') result.termsAccepted.payNow++;
        else if (tType === 'pay-later') result.termsAccepted.payLater++;
        else if (tType === 'subscription') result.termsAccepted.subscription++;
      }
    }
  } catch(e) {
    Logger.log('getEmailWorkflowStatus error: ' + e);
  }

  return result;
}



// ============================================================
// SHOP — PRODUCT MANAGEMENT & ORDERS
// ============================================================

var SHOP_SHEET_ID = SPREADSHEET_ID; // consolidated

function getOrCreateProductsSheet() {
  var ss = SpreadsheetApp.openById(SHOP_SHEET_ID);
  var sheet = ss.getSheetByName('Products');
  if (!sheet) {
    sheet = ss.insertSheet('Products');
    sheet.appendRow(['ID','Name','Description','Price','Category','ImageUrl','Stock','Status','CreatedAt','UpdatedAt']);
    sheet.getRange(1, 1, 1, 10).setFontWeight('bold');
  }
  return sheet;
}

function getOrCreateOrdersSheet() {
  var ss = SpreadsheetApp.openById(SHOP_SHEET_ID);
  var sheet = ss.getSheetByName('Orders');
  if (!sheet) {
    sheet = ss.insertSheet('Orders');
    sheet.appendRow(['OrderID','Date','CustomerName','CustomerEmail','CustomerPhone','Address','Postcode','Items','Subtotal','Delivery','Total','PaymentStatus','PaymentIntentID','OrderStatus','Notes']);
    sheet.getRange(1, 1, 1, 15).setFontWeight('bold');
  }
  return sheet;
}


// ── Get Products (public or admin) ──
function getProducts(params) {
  var sheet = getOrCreateProductsSheet();
  if (sheet.getLastRow() <= 1) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'success', products: [] }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  var data = sheet.getDataRange().getValues();
  var products = [];
  var showAll = (params && params.showAll === 'true');

  for (var i = 1; i < data.length; i++) {
    var status = String(data[i][7] || 'active').toLowerCase();
    if (!showAll && status !== 'active') continue;

    products.push({
      id: String(data[i][0] || ''),
      name: String(data[i][1] || ''),
      description: String(data[i][2] || ''),
      price: Number(data[i][3] || 0),
      category: String(data[i][4] || ''),
      imageUrl: String(data[i][5] || ''),
      stock: Number(data[i][6] || 0),
      status: status,
      createdAt: String(data[i][8] || ''),
      updatedAt: String(data[i][9] || '')
    });
  }

  return ContentService.createTextOutput(JSON.stringify({ status: 'success', products: products }))
    .setMimeType(ContentService.MimeType.JSON);
}


// ── Save Product (create or update) — admin ──
function saveProduct(data) {
  var sheet = getOrCreateProductsSheet();
  var now = new Date().toISOString();
  var productId = data.id || '';

  // Update existing
  if (productId) {
    var allData = sheet.getDataRange().getValues();
    for (var i = 1; i < allData.length; i++) {
      if (String(allData[i][0]) === String(productId)) {
        var row = i + 1;
        sheet.getRange(row, 2).setValue(data.name || '');
        sheet.getRange(row, 3).setValue(data.description || '');
        sheet.getRange(row, 4).setValue(Number(data.price || 0));
        sheet.getRange(row, 5).setValue(data.category || '');
        sheet.getRange(row, 6).setValue(data.imageUrl || '');
        sheet.getRange(row, 7).setValue(Number(data.stock || 0));
        sheet.getRange(row, 8).setValue(data.status || 'active');
        sheet.getRange(row, 10).setValue(now);
        return ContentService.createTextOutput(JSON.stringify({ status: 'success', id: productId, action: 'updated' }))
          .setMimeType(ContentService.MimeType.JSON);
      }
    }
  }

  // Create new
  var newId = 'prod_' + Date.now();
  sheet.appendRow([
    newId,
    data.name || '',
    data.description || '',
    Number(data.price || 0),
    data.category || '',
    data.imageUrl || '',
    Number(data.stock || 0),
    data.status || 'active',
    now,
    now
  ]);

  return ContentService.createTextOutput(JSON.stringify({ status: 'success', id: newId, action: 'created' }))
    .setMimeType(ContentService.MimeType.JSON);
}


// ── Delete Product — admin ──
function deleteProduct(data) {
  if (!data.id) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: 'No product ID' }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  var sheet = getOrCreateProductsSheet();
  var allData = sheet.getDataRange().getValues();
  for (var i = 1; i < allData.length; i++) {
    if (String(allData[i][0]) === String(data.id)) {
      sheet.deleteRow(i + 1);
      return ContentService.createTextOutput(JSON.stringify({ status: 'success', deleted: data.id }))
        .setMimeType(ContentService.MimeType.JSON);
    }
  }

  return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: 'Product not found' }))
    .setMimeType(ContentService.MimeType.JSON);
}


// ── Shop Checkout — PaymentIntent-based checkout (matches shop.js frontend) ──
function shopCheckout(data) {
  var items = data.items;
  var customer = data.customer || {};
  var customerEmail = customer.email || data.email || '';
  var customerName = customer.name || data.name || '';
  var customerPhone = customer.phone || data.phone || '';
  var customerAddress = customer.address || data.address || '';
  var customerPostcode = customer.postcode || data.postcode || '';
  var paymentMethodId = data.paymentMethodId || '';
  
  if (!items || !items.length) {
    return ContentService.createTextOutput(JSON.stringify({
      status: 'error', message: 'No items in cart'
    })).setMimeType(ContentService.MimeType.JSON);
  }
  
  if (!paymentMethodId) {
    return ContentService.createTextOutput(JSON.stringify({
      status: 'error', message: 'No payment method provided'
    })).setMimeType(ContentService.MimeType.JSON);
  }
  
  try {
    // Look up product prices from Products sheet (server-side price validation)
    var prodSheet = getOrCreateProductsSheet();
    var prodData = prodSheet.getDataRange().getValues();
    var productMap = {};
    for (var p = 1; p < prodData.length; p++) {
      productMap[String(prodData[p][0])] = {
        name: String(prodData[p][1] || ''),
        price: Number(prodData[p][3] || 0) // price in pence
      };
    }
    
    var subtotalPence = 0;
    var itemDescriptions = [];
    var resolvedItems = [];
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var product = productMap[String(item.id)];
      if (!product) {
        return ContentService.createTextOutput(JSON.stringify({
          status: 'error', message: 'Product not found: ' + item.id
        })).setMimeType(ContentService.MimeType.JSON);
      }
      var qty = parseInt(item.qty) || 1;
      subtotalPence += product.price * qty;
      itemDescriptions.push(product.name + ' x' + qty);
      resolvedItems.push({ id: item.id, name: product.name, qty: qty, price: product.price });
    }
    
    // Delivery: free over £40 (4000 pence), otherwise £3.95 (395 pence)
    var deliveryPence = subtotalPence >= 4000 ? 0 : 395;
    var totalPence = subtotalPence + deliveryPence;
    
    if (totalPence <= 0) {
      return ContentService.createTextOutput(JSON.stringify({
        status: 'error', message: 'Invalid order total'
      })).setMimeType(ContentService.MimeType.JSON);
    }
    
    // Generate order ID
    var orderId = 'ORD-' + Date.now();
    
    // Find or create Stripe customer
    var stripeCustomer = findOrCreateCustomer(
      customerEmail, customerName, customerPhone, customerAddress, customerPostcode
    );
    
    // Create PaymentIntent with payment method
    var piParams = {
      'amount': String(totalPence),
      'currency': 'gbp',
      'customer': stripeCustomer.id,
      'payment_method': paymentMethodId,
      'confirm': 'true',
      'description': 'Shop Order ' + orderId + ': ' + itemDescriptions.join(', '),
      'receipt_email': customerEmail,
      'metadata[type]': 'shop_order',
      'metadata[order_id]': orderId,
      'metadata[customerName]': customerName,
      'metadata[customerEmail]': customerEmail,
      'return_url': 'https://gardnersgm.co.uk/payment-complete.html?type=shop&order=' + orderId
    };
    
    var pi = stripeRequest('/v1/payment_intents', 'post', piParams);
    
    if (pi.status === 'requires_action' || pi.status === 'requires_source_action') {
      // 3D Secure required — log order as pending, return client secret
      logShopOrder(orderId, customerName, customerEmail, customerPhone, customerAddress,
        customerPostcode, resolvedItems, subtotalPence, deliveryPence, totalPence, 'pending', pi.id);
      
      return ContentService.createTextOutput(JSON.stringify({
        status: 'requires_action',
        clientSecret: pi.client_secret,
        orderId: orderId,
        total: (totalPence / 100).toFixed(2)
      })).setMimeType(ContentService.MimeType.JSON);
    }
    
    if (pi.status === 'succeeded') {
      // Payment succeeded — log order as paid
      logShopOrder(orderId, customerName, customerEmail, customerPhone, customerAddress,
        customerPostcode, resolvedItems, subtotalPence, deliveryPence, totalPence, 'paid', pi.id);
      
      notifyBot('moneybot', '🛒 *Shop Order Paid!*\n💵 £' + (totalPence / 100).toFixed(2) +
        '\n📧 ' + customerEmail + '\n🔖 ' + orderId + '\n📦 ' + itemDescriptions.join(', '));
      
      return ContentService.createTextOutput(JSON.stringify({
        status: 'success',
        orderId: orderId,
        total: (totalPence / 100).toFixed(2)
      })).setMimeType(ContentService.MimeType.JSON);
    }
    
    // Unexpected status
    return ContentService.createTextOutput(JSON.stringify({
      status: 'error', message: 'Payment status: ' + pi.status
    })).setMimeType(ContentService.MimeType.JSON);
    
  } catch(e) {
    Logger.log('Shop checkout error: ' + e);
    return ContentService.createTextOutput(JSON.stringify({
      status: 'error', message: 'Checkout failed: ' + (e.message || e)
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * Log a shop order to the Orders sheet.
 */
function logShopOrder(orderId, name, email, phone, address, postcode, items, subtotal, delivery, total, status, piId) {
  try {
    var sheet = getOrCreateOrdersSheet();
    sheet.appendRow([
      orderId,
      new Date().toISOString(),
      name,
      email,
      phone,
      address,
      postcode,
      JSON.stringify(items),
      (subtotal / 100).toFixed(2),
      (delivery / 100).toFixed(2),
      (total / 100).toFixed(2),
      status,
      piId || '',
      'New',
      ''
    ]);
  } catch(e) {
    Logger.log('logShopOrder error: ' + e);
  }
}


// ── Get Orders — admin ──
function getOrders() {
  var sheet = getOrCreateOrdersSheet();
  if (sheet.getLastRow() <= 1) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'success', orders: [] }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  var data = sheet.getDataRange().getValues();
  var orders = [];
  for (var i = 1; i < data.length; i++) {
    orders.push({
      orderId: String(data[i][0] || ''),
      date: String(data[i][1] || ''),
      name: String(data[i][2] || ''),
      email: String(data[i][3] || ''),
      phone: String(data[i][4] || ''),
      address: String(data[i][5] || ''),
      postcode: String(data[i][6] || ''),
      items: String(data[i][7] || '[]'),
      subtotal: String(data[i][8] || '0'),
      delivery: String(data[i][9] || '0'),
      total: String(data[i][10] || '0'),
      paymentStatus: String(data[i][11] || ''),
      paymentIntentId: String(data[i][12] || ''),
      orderStatus: String(data[i][13] || ''),
      notes: String(data[i][14] || '')
    });
  }

  return ContentService.createTextOutput(JSON.stringify({ status: 'success', orders: orders }))
    .setMimeType(ContentService.MimeType.JSON);
}


// ── Update Order Status — admin ──
function updateOrderStatus(data) {
  if (!data.orderId || !data.orderStatus) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: 'Missing orderId or status' }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  var sheet = getOrCreateOrdersSheet();
  var allData = sheet.getDataRange().getValues();
  for (var i = 1; i < allData.length; i++) {
    if (String(allData[i][0]) === String(data.orderId)) {
      sheet.getRange(i + 1, 14).setValue(data.orderStatus);
      if (data.notes) sheet.getRange(i + 1, 15).setValue(data.notes);

      // Send status update email to customer if email exists
      var custEmail = String(allData[i][3] || '');
      var custName = String(allData[i][2] || 'there').split(' ')[0];
      if (custEmail && data.orderStatus.toLowerCase() !== 'processing') {
        try {
          var statusMessages = {
            'shipped': { icon: '🚚', title: 'Your Order is On Its Way!', msg: 'Your order has been dispatched and is on its way to you.' },
            'ready': { icon: '📦', title: 'Ready for Collection!', msg: 'Your order is ready to collect from us in Roche. Pop by when you\'re ready!' },
            'delivered': { icon: '✅', title: 'Order Delivered!', msg: 'Your order has been delivered. We hope you love your products!' },
            'cancelled': { icon: '❌', title: 'Order Cancelled', msg: 'Your order has been cancelled. If you didn\'t request this, please get in touch.' }
          };
          var sm = statusMessages[data.orderStatus.toLowerCase()] || { icon: '📋', title: 'Order Update', msg: 'Your order status has been updated to: ' + data.orderStatus };

          var statusHtml = '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:0;background:#f4f7f4;font-family:Arial,sans-serif;">'
            + '<div style="max-width:600px;margin:0 auto;background:#fff;">'
            + '<div style="background:linear-gradient(135deg,#2E7D32,#4CAF50);padding:30px;text-align:center;">'
            + '<h1 style="color:#fff;margin:0;font-size:22px;">' + sm.icon + ' ' + sm.title + '</h1>'
            + '<p style="color:rgba(255,255,255,0.9);margin:6px 0 0;font-size:13px;">Order ' + data.orderId + '</p>'
            + '</div><div style="padding:30px;">'
            + '<p style="color:#333;">Hi ' + custName + ',</p>'
            + '<p style="color:#555;line-height:1.6;">' + sm.msg + '</p>'
            + (data.notes ? '<p style="color:#555;line-height:1.6;"><strong>Note:</strong> ' + data.notes + '</p>' : '')
            + '<p style="color:#555;font-size:14px;margin-top:20px;">Questions? Call 01726 432051 or reply to this email.</p>'
            + '</div>'
            + '<div style="background:#333;padding:20px;text-align:center;">'
            + '<p style="color:#aaa;font-size:12px;margin:0;">Gardners Ground Maintenance | Roche, Cornwall PL26 8HN</p>'
            + '</div></div></body></html>';

          sendEmail({
            to: custEmail,
            toName: '',
            subject: sm.icon + ' Order Update — ' + data.orderId + ' | Gardners GM',
            htmlBody: statusHtml,
            name: 'Gardners Ground Maintenance',
            replyTo: 'info@gardnersgm.co.uk'
          });
        } catch(e) { Logger.log('Order status email error: ' + e); }
      }

      return ContentService.createTextOutput(JSON.stringify({ status: 'success', orderId: data.orderId, orderStatus: data.orderStatus }))
        .setMimeType(ContentService.MimeType.JSON);
    }
  }

  return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: 'Order not found' }))
    .setMimeType(ContentService.MimeType.JSON);
}


// ============================================================
// CLOUD AUTOMATION — replaces local Node.js agents
// All runs on Google's servers 24/7, no PC needed
// ============================================================

// ── Morning Briefing (6:15am) — Week Overview ──
function cloudMorningBriefingWeek() {
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var jobsSheet = ss.getSheetByName('Jobs');
    if (!jobsSheet || jobsSheet.getLastRow() <= 1) {
      notifyTelegram('📋 *WEEK AHEAD*\n\nNo jobs booked this week. Diary is clear! 🌿');
      return;
    }

    var data = jobsSheet.getDataRange().getValues();
    var today = new Date();
    today.setHours(0,0,0,0);
    var endOfWeek = new Date(today.getTime() + 7 * 86400000);

    var dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    var byDate = {};
    var totalRevenue = 0;
    var totalJobs = 0;

    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      var status = String(row[11] || '').toLowerCase();
      if (status === 'cancelled' || status === 'complete') continue;

      var jobDate = row[8] instanceof Date ? row[8] : new Date(String(row[8]));
      if (isNaN(jobDate.getTime())) continue;
      jobDate.setHours(0,0,0,0);
      if (jobDate < today || jobDate >= endOfWeek) continue;

      var dateKey = Utilities.formatDate(jobDate, Session.getScriptTimeZone(), 'yyyy-MM-dd');
      if (!byDate[dateKey]) byDate[dateKey] = [];

      var price = parseFloat(String(row[12] || '0').replace(/[^0-9.]/g, '')) || 0;
      totalRevenue += price;
      totalJobs++;

      byDate[dateKey].push({
        name: String(row[2] || ''),
        service: String(row[7] || ''),
        address: String(row[5] || ''),
        postcode: String(row[6] || ''),
        time: String(row[9] || ''),
        price: price
      });
    }

    // Also check subscription schedule
    var schedSheet = ss.getSheetByName('Schedule');
    if (schedSheet && schedSheet.getLastRow() > 1) {
      var schedData = schedSheet.getDataRange().getValues();
      for (var s = 1; s < schedData.length; s++) {
        var sRow = schedData[s];
        var sStatus = String(sRow[9] || '').toLowerCase();
        if (sStatus === 'cancelled') continue;
        var sDate = sRow[0] instanceof Date ? sRow[0] : new Date(String(sRow[0]));
        if (isNaN(sDate.getTime())) continue;
        sDate.setHours(0,0,0,0);
        if (sDate < today || sDate >= endOfWeek) continue;

        var sKey = Utilities.formatDate(sDate, Session.getScriptTimeZone(), 'yyyy-MM-dd');
        if (!byDate[sKey]) byDate[sKey] = [];
        totalJobs++;
        byDate[sKey].push({
          name: String(sRow[1] || ''),
          service: '📦 ' + String(sRow[6] || sRow[7] || 'Subscription'),
          address: String(sRow[4] || ''),
          postcode: String(sRow[5] || ''),
          time: String(sRow[8] || ''),
          price: 0
        });
      }
    }

    var dates = Object.keys(byDate).sort();
    if (dates.length === 0) {
      notifyTelegram('📋 *WEEK AHEAD*\n\nNo jobs booked for the next 7 days. Time to market! 📢');
      return;
    }

    var msg = '📋 *WEEK AHEAD — ' + totalJobs + ' Jobs*\n';
    msg += '💷 Est. revenue: £' + totalRevenue.toFixed(0) + '\n\n';

    for (var d = 0; d < dates.length; d++) {
      var dk = dates[d];
      var dd = new Date(dk + 'T12:00:00');
      var dayLabel = dayNames[dd.getDay()] + ' ' + dk.substring(8) + '/' + dk.substring(5, 7);
      var dayJobs = byDate[dk];

      msg += '📅 *' + dayLabel + '* (' + dayJobs.length + ' job' + (dayJobs.length > 1 ? 's' : '') + ')\n';
      for (var j = 0; j < dayJobs.length; j++) {
        var job = dayJobs[j];
        msg += '  • ' + job.service;
        if (job.name) msg += ' — ' + job.name;
        if (job.time) msg += ' @ ' + job.time;
        if (job.price > 0) msg += ' (£' + job.price.toFixed(0) + ')';
        msg += '\n';
      }
      msg += '\n';
    }

    notifyTelegram(msg);
    Logger.log('Morning week briefing sent: ' + totalJobs + ' jobs');
  } catch(e) {
    Logger.log('cloudMorningBriefingWeek error: ' + e);
    notifyTelegram('⚠️ *Morning Briefing Failed*\n\n' + e.message);
  }
}

// ── Postcode distance estimator (no API needed) ──
// Uses UK postcode area/district to estimate relative distance
// Returns a numeric score — lower = closer. Good enough for nearest-neighbour routing.
function postcodeDistance(pc1, pc2) {
  if (!pc1 || !pc2) return 999;
  pc1 = pc1.replace(/\s/g, '').toUpperCase();
  pc2 = pc2.replace(/\s/g, '').toUpperCase();
  if (pc1 === pc2) return 0;
  
  // Extract area (letters), district (first number group), and sector (after space / last 3)
  var parse = function(pc) {
    var m = pc.match(/^([A-Z]{1,2})(\d{1,2}[A-Z]?)\s*(\d)([A-Z]{2})$/);
    if (!m) return { area: pc.substring(0, 2), district: 0, sector: 0 };
    return { area: m[1], district: parseInt(m[2]) || 0, sector: parseInt(m[3]) || 0 };
  };
  
  var a = parse(pc1);
  var b = parse(pc2);
  
  // Same area (e.g. both PL) — compare district numbers
  if (a.area === b.area) {
    var distDiff = Math.abs(a.district - b.district);
    var sectDiff = Math.abs(a.sector - b.sector);
    return distDiff * 3 + sectDiff; // ~3 miles per district number difference
  }
  
  // Different areas — Cornwall postcodes: PL, TR, EX roughly
  var areaOrder = { 'PL': 0, 'TR': 1, 'EX': 2, 'TQ': 3, 'TA': 4 };
  var aOrd = areaOrder[a.area] !== undefined ? areaOrder[a.area] : 10;
  var bOrd = areaOrder[b.area] !== undefined ? areaOrder[b.area] : 10;
  return Math.abs(aOrd - bOrd) * 20 + Math.abs(a.district - b.district) * 3;
}

// ── Today's Job Sheet (6:45am) ──
function cloudMorningBriefingToday() {
  try {
    var HOME_POSTCODE = 'PL26 8HN'; // Base postcode for route optimisation
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var jobsSheet = ss.getSheetByName('Jobs');
    if (!jobsSheet || jobsSheet.getLastRow() <= 1) {
      notifyTelegram('📋 *TODAY\'S JOBS*\n\nNothing booked today. Enjoy the day off! ☀️');
      return;
    }

    var data = jobsSheet.getDataRange().getValues();
    var today = new Date();
    var todayStr = Utilities.formatDate(today, Session.getScriptTimeZone(), 'yyyy-MM-dd');

    var dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    var todayJobs = [];
    var totalRev = 0;
    var totalOwed = 0;

    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      var status = String(row[11] || '').toLowerCase();
      if (status === 'cancelled' || status === 'completed') continue;

      var jobDate = row[8] instanceof Date ? row[8] : new Date(String(row[8]));
      if (isNaN(jobDate.getTime())) continue;
      var jobDateStr = Utilities.formatDate(jobDate, Session.getScriptTimeZone(), 'yyyy-MM-dd');
      if (jobDateStr !== todayStr) continue;

      var price = parseFloat(String(row[12] || '0').replace(/[^0-9.]/g, '')) || 0;
      var paidStatus = String(row[17] || 'No');
      var notesStr = String(row[16] || '');
      var depositPaid = 0;
      var depMatch = notesStr.match(/[Dd]eposit.*?£(\d+\.?\d*)/);
      if (!depMatch) depMatch = notesStr.match(/[Dd]eposit.*?(\d+\.?\d*)\s*paid/);
      if (depMatch) depositPaid = parseFloat(depMatch[1]) || 0;
      var remaining = (paidStatus === 'Yes' || paidStatus === 'Auto') ? 0 : Math.max(0, price - depositPaid);
      
      totalRev += price;
      totalOwed += remaining;

      todayJobs.push({
        name: String(row[2] || ''),
        service: String(row[7] || ''),
        address: String(row[5] || ''),
        postcode: String(row[6] || ''),
        phone: String(row[4] || ''),
        time: String(row[9] || ''),
        price: price,
        paidStatus: paidStatus,
        depositPaid: depositPaid,
        remaining: remaining,
        distance: String(row[13] || ''),
        driveTime: String(row[14] || ''),
        mapsUrl: String(row[15] || ''),
        notes: notesStr,
        jobNum: String(row[19] || ''),
        isSub: false
      });
    }

    // Also check subscription schedule for today
    var schedSheet = ss.getSheetByName('Schedule');
    if (schedSheet && schedSheet.getLastRow() > 1) {
      var schedData = schedSheet.getDataRange().getValues();
      for (var s = 1; s < schedData.length; s++) {
        var sRow = schedData[s];
        var sStatus = String(sRow[9] || '').toLowerCase();
        if (sStatus === 'cancelled' || sStatus === 'skipped') continue;
        var sDate = sRow[0] instanceof Date ? sRow[0] : new Date(String(sRow[0]));
        if (isNaN(sDate.getTime())) continue;
        var sDateStr = Utilities.formatDate(sDate, Session.getScriptTimeZone(), 'yyyy-MM-dd');
        if (sDateStr !== todayStr) continue;

        todayJobs.push({
          name: String(sRow[1] || ''),
          service: '📦 ' + String(sRow[6] || sRow[7] || 'Subscription Visit'),
          address: String(sRow[4] || ''),
          postcode: String(sRow[5] || ''),
          phone: String(sRow[3] || ''),
          time: '',
          price: 0,
          paidStatus: 'Sub',
          depositPaid: 0,
          remaining: 0,
          distance: String(sRow[11] || ''),
          driveTime: String(sRow[12] || ''),
          mapsUrl: String(sRow[13] || ''),
          notes: String(sRow[14] || ''),
          jobNum: String(sRow[10] || ''),
          isSub: true
        });
      }
    }

    if (todayJobs.length === 0) {
      notifyTelegram('📋 *TODAY — ' + dayNames[today.getDay()] + '*\n\nNothing booked. Free day! ☀️');
      return;
    }

    // ── Route optimisation: nearest-neighbour by postcode ──
    // Sort jobs into an efficient visiting order starting from home base
    if (todayJobs.length > 1) {
      var sorted = [];
      var remaining_ = todayJobs.slice();
      var currentPC = HOME_POSTCODE.replace(/\s/g, '').toUpperCase();
      
      while (remaining_.length > 0) {
        var bestIdx = 0;
        var bestDist = Infinity;
        for (var r = 0; r < remaining_.length; r++) {
          var jobPC = (remaining_[r].postcode || '').replace(/\s/g, '').toUpperCase();
          // Simple postcode proximity: compare area + district codes
          var dist = postcodeDistance(currentPC, jobPC);
          // Timed jobs get priority — if a job has a specific time, weight it
          if (remaining_[r].time) {
            var timeParts = remaining_[r].time.match(/(\d{1,2})/);
            if (timeParts) {
              var hour = parseInt(timeParts[1]);
              // Earlier times get slight priority boost
              dist = dist - (24 - hour) * 0.01;
            }
          }
          if (dist < bestDist) { bestDist = dist; bestIdx = r; }
        }
        sorted.push(remaining_[bestIdx]);
        currentPC = (remaining_[bestIdx].postcode || HOME_POSTCODE).replace(/\s/g, '').toUpperCase();
        remaining_.splice(bestIdx, 1);
      }
      todayJobs = sorted;
    }

    // ── Build the ADHD-friendly briefing ──
    var msg = '🌅 *TODAY — ' + dayNames[today.getDay()] + ' ' + todayStr.substring(8) + '/' + todayStr.substring(5, 7) + '*\n';
    msg += '━━━━━━━━━━━━━━━━━━━━\n';
    msg += '📊 *' + todayJobs.length + ' job' + (todayJobs.length > 1 ? 's' : '') + '* | 💷 Revenue: £' + totalRev.toFixed(0);
    if (totalOwed > 0) msg += ' | ⚡ To collect: £' + totalOwed.toFixed(0);
    msg += '\n🏠 Route optimised from ' + HOME_POSTCODE + '\n\n';

    for (var t = 0; t < todayJobs.length; t++) {
      var tj = todayJobs[t];
      msg += '━━━━━━━━━━━━━━━\n';
      msg += '📍 *Stop ' + (t + 1) + ' of ' + todayJobs.length + ': ' + tj.service + '*\n';
      if (tj.jobNum) msg += '🔖 `' + tj.jobNum + '`\n';
      msg += '👤 ' + tj.name + '\n';
      if (tj.phone) msg += '📱 [' + tj.phone + '](tel:' + tj.phone.replace(/\s/g, '') + ')\n';
      if (tj.address) {
        msg += '📍 ' + tj.address;
        if (tj.postcode) msg += ', ' + tj.postcode;
        msg += '\n';
      }
      var tjAddr = (tj.address || '') + (tj.postcode ? ', ' + tj.postcode : '');
      if (tjAddr) {
        var prevAddr = t > 0 ? ((todayJobs[t-1].address || '') + (todayJobs[t-1].postcode ? ', ' + todayJobs[t-1].postcode : '')) : HOME_POSTCODE;
        msg += '🗺 [Navigate from ' + (t > 0 ? 'previous' : 'home') + '](https://www.google.com/maps/dir/' + encodeURIComponent(prevAddr) + '/' + encodeURIComponent(tjAddr) + ')\n';
      }
      if (tj.time) msg += '🕐 ' + tj.time + '\n';
      if (tj.distance) msg += '🚗 ' + tj.distance + (tj.driveTime ? ' · ' + tj.driveTime : '') + '\n';
      
      // Financial summary — ADHD-friendly at-a-glance
      if (tj.price > 0) {
        if (tj.paidStatus === 'Yes' || tj.paidStatus === 'Auto') {
          msg += '💰 £' + tj.price.toFixed(2) + ' ✅ *PAID*\n';
        } else if (tj.depositPaid > 0) {
          msg += '💰 £' + tj.price.toFixed(2) + ' total | 💳 Deposit £' + tj.depositPaid.toFixed(2) + ' paid\n';
          msg += '⚡ *£' + tj.remaining.toFixed(2) + ' TO COLLECT*\n';
        } else {
          msg += '⚡ *£' + tj.price.toFixed(2) + ' TO COLLECT*\n';
        }
      } else if (tj.isSub) {
        msg += '💰 Subscription visit (recurring)\n';
      }
      if (tj.notes) msg += '📝 ' + tj.notes + '\n';
      msg += '\n';
    }

    msg += '━━━━━━━━━━━━━━━━━━━━\n';
    msg += '📸 Photo tip: send `GGM-XXXX before` → do job → `GGM-XXXX after`\n';
    msg += '🧾 Invoice: send `/invoice GGM-XXXX` when done\n';
    msg += '🔄 Refresh: send `/today`\n\n';
    msg += '💪 *Have a great day!*';

    notifyTelegram(msg);
    Logger.log('Today briefing sent: ' + todayJobs.length + ' jobs (route-optimised)');
  } catch(e) {
    Logger.log('cloudMorningBriefingToday error: ' + e);
    notifyTelegram('⚠️ *Today Briefing Failed*\n\n' + e.message);
  }
}

// ── Daily Email Lifecycle (7:30am) ──
function cloudEmailLifecycle() {
  try {
    var result = processEmailLifecycle({ includeSeasonal: false });
    // processEmailLifecycle returns a ContentService response, parse it
    var resultText = result.getContent();
    var parsed = JSON.parse(resultText);

    if (parsed.status === 'success' && parsed.results) {
      var r = parsed.results;
      var total = (r.reminders || 0) + (r.aftercare || 0) + (r.followUps || 0) + (r.seasonal || 0) + (r.reEngagement || 0) + (r.promotional || 0) + (r.referral || 0) + (r.upgrade || 0);

      var msg = '📧 *EMAIL LIFECYCLE — Daily Report*\n';
      msg += '📅 ' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'EEE dd/MM/yyyy') + '\n\n';

      if (total === 0) {
        msg += '✅ No emails needed today — all customers up to date.\n';
      } else {
        if (r.reminders > 0)     msg += '📅 *' + r.reminders + '* reminder' + (r.reminders > 1 ? 's' : '') + '\n';
        if (r.aftercare > 0)     msg += '🌱 *' + r.aftercare + '* aftercare guide' + (r.aftercare > 1 ? 's' : '') + '\n';
        if (r.followUps > 0)     msg += '💬 *' + r.followUps + '* follow-up' + (r.followUps > 1 ? 's' : '') + '\n';
        if (r.seasonal > 0)      msg += '🌸 *' + r.seasonal + '* seasonal tip' + (r.seasonal > 1 ? 's' : '') + '\n';
        if (r.reEngagement > 0)  msg += '👋 *' + r.reEngagement + '* re-engagement' + (r.reEngagement > 1 ? 's' : '') + '\n';
        if (r.promotional > 0)   msg += '✨ *' + r.promotional + '* promo upsell' + (r.promotional > 1 ? 's' : '') + '\n';
        if (r.referral > 0)      msg += '🎁 *' + r.referral + '* referral invite' + (r.referral > 1 ? 's' : '') + '\n';
        if (r.upgrade > 0)       msg += '⬆️ *' + r.upgrade + '* package upgrade' + (r.upgrade > 1 ? 's' : '') + '\n';
        msg += '\n📊 *Total: ' + total + ' emails sent*\n';
      }

      if (r.errors && r.errors.length > 0) {
        msg += '\n⚠️ *' + r.errors.length + ' error' + (r.errors.length > 1 ? 's' : '') + ':*\n';
        for (var e = 0; e < Math.min(r.errors.length, 5); e++) {
          msg += '  ❌ ' + r.errors[e] + '\n';
        }
      }

      notifyTelegram(msg);
      Logger.log('Email lifecycle processed: ' + total + ' emails sent');
    }
  } catch(e) {
    Logger.log('cloudEmailLifecycle error: ' + e);
    notifyTelegram('⚠️ *Email Lifecycle Failed*\n\n' + e.message);
  }
}

// ── Weekly Newsletter Trigger (Monday 9am) — Gemini AI powered ──
var CLOUD_NEWSLETTER_THEMES = {
  1:  { subject: '🌿 January Garden Update — Winter Protection Tips', theme: 'winter protection, what to do in the garden in January, planning ahead for spring, protecting lawns from frost' },
  2:  { subject: '🌱 February Newsletter — Spring is Coming!', theme: 'spring preparation, early lawn care tasks, when to start mowing, checking garden boundaries' },
  3:  { subject: '🌸 March Garden News — Spring Has Sprung!', theme: 'first mowing of the year, spring feed recommendations, moss treatment timing, hedge trimming season starting' },
  4:  { subject: '🌷 April Update — Your Lawn is Waking Up', theme: 'lawn feeding schedule, weed control starting, mowing height guide, garden tidy services' },
  5:  { subject: '☀️ May Newsletter — Summer Prep Time', theme: 'summer preparation, regular mowing importance, hedge trimming, garden maintenance plans' },
  6:  { subject: '🌻 June Garden Update — Peak Growing Season', theme: 'peak season lawn care, watering in dry weather, keeping edges tidy, outdoor living spaces' },
  7:  { subject: '🌞 July Newsletter — Beating the Summer Heat', theme: 'drought care, raising mowing height, brown patch prevention, garden survival tips' },
  8:  { subject: '🍃 August Update — Late Summer Garden Care', theme: 'end of summer tasks, preparing for autumn renovation, late summer feeding, holiday garden care' },
  9:  { subject: '🍂 September Newsletter — Autumn Renovation Time', theme: 'scarifying, aeration, overseeding, autumn lawn feed, the most important month for lawns' },
  10: { subject: '🍁 October Garden Update — Winterising Your Space', theme: 'leaf clearance, last mowing tips, winter preparation, hard surface cleaning before frost' },
  11: { subject: '❄️ November Newsletter — Tucking Your Garden In', theme: 'final garden tasks, winter lawn treatment, tool maintenance, subscription benefits for next year' },
  12: { subject: '🎄 December Update — Happy Holidays from Gardners GM!', theme: 'year in review, thank you to customers, January booking slots, gift ideas for garden lovers' }
};

function cloudWeeklyNewsletter(force) {
  try {
    var today = new Date();
    var dayOfMonth = today.getDate();
    // Only send on the first Monday of the month (day 1-7) — unless forced via ContentBot
    if (!force && dayOfMonth > 7) {
      Logger.log('Not first week of month, skipping newsletter');
      return;
    }

    var month = today.getMonth() + 1;
    var theme = CLOUD_NEWSLETTER_THEMES[month];
    if (!theme) { Logger.log('No newsletter theme for month ' + month); return; }

    // Check if newsletter already sent this month
    var ss = SpreadsheetApp.openById('1_Y7yHIpAvv_VNBhTrwNOQaBMAGa3UlVW_FKlf56ouHk');
    var nlSheet = ss.getSheetByName('Newsletters');
    if (nlSheet && nlSheet.getLastRow() > 1) {
      var nlData = nlSheet.getDataRange().getValues();
      var thisMonth = Utilities.formatDate(today, Session.getScriptTimeZone(), 'yyyy-MM');
      for (var n = 1; n < nlData.length; n++) {
        var nlDate = String(nlData[n][0] || '');
        if (nlDate.substring(0, 7) === thisMonth) {
          Logger.log('Newsletter already sent this month. Skipping.');
          return;
        }
      }
    }

    Logger.log('Generating ' + theme.subject + ' with Gemini...');

    // Build context from previous newsletters so AI avoids repetition
    var historyContext = buildNewsletterHistoryPrompt();
    Logger.log('Newsletter history context: ' + (historyContext ? historyContext.split('\n').length + ' lines' : 'none (first newsletter)'));

    // Get all published blog titles for cross-referencing
    var existingBlogTitles = getAllBlogTitles();
    var blogTitlesContext = '';
    if (existingBlogTitles.length > 0) {
      blogTitlesContext = '\n\nEXISTING BLOG POSTS (you can recommend these to readers where relevant):\n'
        + existingBlogTitles.map(function(t) { return '• ' + t; }).join('\n')
        + '\n\nWhen recommending blog posts, pick 1-2 that are most relevant to this month\'s theme.';
    }

    // Generate main newsletter content with Gemini — founder's voice, company news, factual
    var nlPrompt = 'You are Chris, the founder of Gardners Ground Maintenance, writing your monthly email newsletter to customers and subscribers. You\'re based in Roche, Cornwall and you work across the whole county.\n\n'
      + 'MONTH: ' + theme.subject + '\n'
      + 'THEME: ' + theme.theme + '\n\n'
      + (historyContext ? historyContext + '\n\n' : '')
      + 'Write the newsletter body content in HTML format.\n\n'
      + 'YOUR VOICE:\n'
      + '- Write like you\'re emailing a mate who happens to also be a customer\n'
      + '- Open with a quick personal update — what the team\'s been up to, a funny thing that happened on a job, how busy it\'s been, weather gripes, anything real\n'
      + '- This is YOUR newsletter — you\'re Chris, a real bloke who runs a gardening company. Not a faceless brand\n'
      + '- Short paragraphs. Conversational. The odd "to be honest" or "I\'ll be straight with you" is fine\n'
      + '- Dry humour welcome — you\'re Cornish\n\n'
      + 'CONTENT STRUCTURE:\n'
      + '- 400-600 words\n'
      + '- Start with a quick "what we\'ve been up to" company update (2-3 sentences — new equipment, areas you\'ve been working in, team news, job highlights)\n'
      + '- Then 2-3 genuinely useful seasonal garden tips — these MUST be factually accurate horticultural advice with specific measurements/timings\n'
      + '- These tips MUST be different from previous newsletters listed above\n'
      + '- Reference Cornwall\'s specific climate: mild wet winters, clay soils inland, coastal salt, grass never fully stops growing\n'
      + '- End with a natural mention of bookings/subscriptions — not a hard sell\n'
      + '- Contact: 01726 432051, info@gardnersgm.co.uk, gardnersgm.co.uk — ONLY these, invent nothing\n\n'
      + 'FORMATTING:\n'
      + '- Use <h3> for section headings, <p> for paragraphs, <ul>/<li> for tips\n'
      + '- No <html>, <head>, <body>, or <style> tags — just the content HTML\n'
      + '- No header/footer — added automatically\n'
      + '- British English throughout\n\n'
      + 'IMPORTANT: At the end, on a new line, write IMAGE_HINTS: followed by 2 comma-separated short phrases describing photos that would match the tips (e.g. "frosty lawn morning, garden fork in soil").\n\n'
      + 'Write the newsletter HTML content now:';

    var mainContent = sanitiseBlogContent(askGemini(nlPrompt, 0.7));
    if (!mainContent || mainContent.length < 150) {
      throw new Error('Newsletter content too short (' + (mainContent || '').length + ' chars)');
    }

    // Extract image hints and insert inline images into newsletter
    var nlImageHints = [];
    var nlHintsMatch = mainContent.match(/IMAGE_HINTS:\s*(.+)/i);
    if (nlHintsMatch) {
      nlImageHints = nlHintsMatch[1].split(',').map(function(h) { return h.trim().replace(/<[^>]+>/g, ''); }).filter(Boolean).slice(0, 2);
      mainContent = mainContent.replace(/IMAGE_HINTS:.+/i, '').trim();
      Logger.log('Newsletter image hints: ' + nlImageHints.join(', '));
    }
    if (nlImageHints.length > 0) {
      var nlInlineImgs = [];
      for (var ni = 0; ni < nlImageHints.length; ni++) {
        var nlImg = fetchPexelsImageForBlog(nlImageHints[ni]);
        if (nlImg) nlInlineImgs.push({ url: nlImg, alt: nlImageHints[ni] });
      }
      if (nlInlineImgs.length > 0) {
        var h3Count = 0;
        var nlImgIdx = 0;
        mainContent = mainContent.replace(/<\/h3>/gi, function(match) {
          h3Count++;
          if ((h3Count === 1 || h3Count === 2) && nlImgIdx < nlInlineImgs.length) {
            var img = nlInlineImgs[nlImgIdx];
            nlImgIdx++;
            return match + '\n<div style="margin:16px 0;text-align:center;"><img src="' + img.url + '" alt="' + img.alt.replace(/"/g, '') + '" style="max-width:100%;height:auto;border-radius:8px;" /></div>';
          }
          return match;
        });
        Logger.log('Inserted ' + nlImgIdx + ' inline images into newsletter');
      }
    }

    Logger.log('Generated ' + mainContent.length + ' chars of newsletter content');

    // Generate exclusive content for paid subscribers — founder's insider knowledge
    var exclusivePrompt = 'You\'re Chris from Gardners GM. Write a short exclusive pro tip (100-150 words) in HTML for your paid subscribers — the ones on maintenance plans. This month\'s theme: ' + theme.theme + '.\n'
      + 'This should feel like insider knowledge from a tradesman — something you wouldn\'t put on the free blog. A specific technique, product recommendation (real products), timing trick, or common mistake you see homeowners making. Use <p> tags. One focused tip only. Be specific — real measurements, real timings. If mentioning contact details: 01726 432051 and info@gardnersgm.co.uk only.\n'
      + (historyContext ? '\nIMPORTANT: This tip must be DIFFERENT from any exclusive content in previous newsletters.\n' : '');

    var exclusiveContent = sanitiseBlogContent(askGemini(exclusivePrompt, 0.6));

    // Extract key topics from the generated content for future tracking
    var topicPrompt = 'Read this newsletter content and list the 3-5 main topics/tips covered, as a comma-separated list (no HTML, no numbering, just a plain comma-separated list):\n\n' + mainContent;
    var topicsSummary = '';
    try {
      topicsSummary = askGemini(topicPrompt, 0.2).replace(/<[^>]+>/g, '').trim();
    } catch(te) { Logger.log('Topic extraction failed: ' + te.message); }

    // Generate blog title suggestions based on what the newsletter discussed
    var blogSuggestPrompt = 'Based on this month\'s newsletter theme "' + theme.theme + '", suggest 3 blog post titles that would complement this newsletter. The blog is for a garden maintenance company in Cornwall, UK.\n\n'
      + 'Requirements:\n'
      + '- Titles should be specific, engaging, and SEO-friendly\n'
      + '- Each should go deeper into a topic briefly touched in the newsletter\n'
      + '- Write titles that a homeowner would search for on Google\n'
      + '- Return ONLY the 3 titles, one per line, no numbering or bullets\n';

    // Exclude existing blog titles from suggestions
    if (existingBlogTitles.length > 0) {
      blogSuggestPrompt += '\nDo NOT suggest these titles (they already exist):\n'
        + existingBlogTitles.map(function(t) { return '• ' + t; }).join('\n') + '\n';
    }

    // Exclude previously suggested titles too
    var history = getNewsletterContentHistory(6);
    var prevSuggested = history.map(function(h) { return h.blogTitlesSuggested; }).filter(Boolean).join(', ');
    if (prevSuggested) {
      blogSuggestPrompt += '\nAlso avoid re-suggesting these previously suggested titles: ' + prevSuggested + '\n';
    }

    var suggestedBlogTitles = '';
    try {
      suggestedBlogTitles = askGemini(blogSuggestPrompt, 0.8).replace(/<[^>]+>/g, '').trim();
    } catch(bte) { Logger.log('Blog suggestion failed: ' + bte.message); }

    Logger.log('Topics covered: ' + topicsSummary);
    Logger.log('Suggested blog titles: ' + suggestedBlogTitles);

    // Get recent blog posts to link — now styled as "Recommended Reading"
    var blogSheet = ss.getSheetByName('Blog');
    var blogLinks = '';
    if (blogSheet && blogSheet.getLastRow() > 1) {
      var blogData = blogSheet.getDataRange().getValues();
      var recentPosts = [];
      for (var b = blogData.length - 1; b >= 1 && recentPosts.length < 3; b--) {
        var status = String(blogData[b][7] || '').toLowerCase();
        if (status === 'published') {
          recentPosts.push({ title: blogData[b][2], excerpt: String(blogData[b][5] || '').substring(0, 100) });
        }
      }
      if (recentPosts.length > 0) {
        blogLinks = '<div style="background:#F1F8E9;border-left:4px solid #2E7D32;border-radius:6px;padding:16px 20px;margin:24px 0;">'
          + '<h3 style="color:#2E7D32;margin:0 0 12px 0;">📖 Recommended Reading</h3>'
          + '<p style="color:#555;font-size:14px;margin:0 0 12px 0;">Handpicked articles from our blog that complement this month\'s tips:</p><ul style="margin:0;padding-left:20px;">';
        for (var p = 0; p < recentPosts.length; p++) {
          blogLinks += '<li style="margin-bottom:8px;"><strong style="color:#1B5E20;">' + recentPosts[p].title + '</strong><br/><span style="color:#666;font-size:13px;">' + recentPosts[p].excerpt + '…</span></li>';
        }
        blogLinks += '</ul><p style="margin:12px 0 0 0;"><a href="https://gardnersgm.co.uk/blog.html" style="color:#2E7D32;font-weight:600;text-decoration:none;">Browse all articles →</a></p></div>';
      }
    }

    var fullContent = mainContent + blogLinks;

    // Fetch header image
    var headerImage = fetchPexelsImageForBlog(theme.theme.split(',')[0] + ' garden');

    // Send via existing sendNewsletter function — now includes topic tracking data
    var result = sendNewsletter({
      subject: theme.subject,
      content: fullContent,
      exclusiveContent: exclusiveContent || '',
      targetTier: 'all',
      headerImage: headerImage,
      topicsCovered: topicsSummary,
      blogTitlesSuggested: suggestedBlogTitles
    });

    var resultText = result.getContent();
    var parsed = JSON.parse(resultText);

    if (parsed.status === 'success') {
      var telegramMsg = '📬 *MONTHLY NEWSLETTER SENT*\n'
        + '━━━━━━━━━━━━━━━━━━━━\n\n'
        + '📋 *' + theme.subject + '*\n'
        + '✅ Delivered: ' + parsed.sent + '\n'
        + (parsed.failed > 0 ? '❌ Failed: ' + parsed.failed + '\n' : '')
        + '⭐ Exclusive subscriber content: Yes\n'
        + '📖 Blog recommendations: ' + (blogLinks ? 'Yes' : 'No') + '\n'
        + '📸 Header image: ' + (headerImage ? 'Yes' : 'No') + '\n';

      if (topicsSummary) {
        telegramMsg += '\n📝 *Topics covered:*\n' + topicsSummary + '\n';
      }
      if (suggestedBlogTitles) {
        telegramMsg += '\n💡 *Suggested blog titles:*\n' + suggestedBlogTitles + '\n';
      }
      telegramMsg += '\n_Generated by Gemini AI ☁️ — content history tracked_';

      notifyBot('contentbot', telegramMsg);
    } else {
      throw new Error('Newsletter send returned: ' + resultText);
    }

    Logger.log('Monthly newsletter sent successfully');
  } catch(e) {
    Logger.log('cloudWeeklyNewsletter error: ' + e);
    notifyBot('contentbot', '⚠️ *Newsletter Failed*\n\n' + e.message);
  }
}

// ============================================================
// SETUP ALL CLOUD TRIGGERS — run ONCE to install all
// ============================================================
function setupAllCloudTriggers() {
  // Remove existing cloud triggers first
  var functionNames = [
    'cloudMorningBriefingWeek',
    'cloudMorningBriefingToday',
    'cloudEmailLifecycle',
    'cloudWeeklyNewsletter',
    'cloudGenerateBlogPost',
    'processJobStatusProgression',
    'coachMorningNudge',
    'coachMidMorningNudge',
    'coachLunchNudge',
    'coachAfternoonNudge',
    'coachEveningNudge'
  ];

  var allTriggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < allTriggers.length; i++) {
    var handler = allTriggers[i].getHandlerFunction();
    for (var f = 0; f < functionNames.length; f++) {
      if (handler === functionNames[f]) {
        ScriptApp.deleteTrigger(allTriggers[i]);
        break;
      }
    }
  }

  // 1. Week briefing — 6:15am daily (Mon-Sat)
  ScriptApp.newTrigger('cloudMorningBriefingWeek')
    .timeBased()
    .atHour(6)
    .nearMinute(15)
    .everyDays(1)
    .create();

  // 2. Today's jobs — 6:45am daily
  ScriptApp.newTrigger('cloudMorningBriefingToday')
    .timeBased()
    .atHour(6)
    .nearMinute(45)
    .everyDays(1)
    .create();

  // 3. Email lifecycle — 7:30am daily
  ScriptApp.newTrigger('cloudEmailLifecycle')
    .timeBased()
    .atHour(7)
    .nearMinute(30)
    .everyDays(1)
    .create();

  // 4. Newsletter check — Monday 9am weekly
  ScriptApp.newTrigger('cloudWeeklyNewsletter')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.MONDAY)
    .atHour(9)
    .nearMinute(0)
    .create();

  // 5. Blog generation — 8am daily (only publishes on 1st, 11th, 21st)
  ScriptApp.newTrigger('cloudGenerateBlogPost')
    .timeBased()
    .atHour(8)
    .nearMinute(0)
    .everyDays(1)
    .create();

  // 6. Job progression — 6am daily (already existed)
  ScriptApp.newTrigger('processJobStatusProgression')
    .timeBased()
    .atHour(6)
    .everyDays(1)
    .create();

  // 7. CoachBot — Morning nudge 6:30am daily
  ScriptApp.newTrigger('coachMorningNudge')
    .timeBased()
    .atHour(6)
    .nearMinute(30)
    .everyDays(1)
    .create();

  // 8. CoachBot — Mid-morning check 10am daily
  ScriptApp.newTrigger('coachMidMorningNudge')
    .timeBased()
    .atHour(10)
    .nearMinute(0)
    .everyDays(1)
    .create();

  // 9. CoachBot — Lunch nudge 12:30pm daily
  ScriptApp.newTrigger('coachLunchNudge')
    .timeBased()
    .atHour(12)
    .nearMinute(30)
    .everyDays(1)
    .create();

  // 10. CoachBot — Afternoon check 3pm daily
  ScriptApp.newTrigger('coachAfternoonNudge')
    .timeBased()
    .atHour(15)
    .nearMinute(0)
    .everyDays(1)
    .create();

  // 11. CoachBot — Evening wrap-up 5:30pm daily
  ScriptApp.newTrigger('coachEveningNudge')
    .timeBased()
    .atHour(17)
    .nearMinute(30)
    .everyDays(1)
    .create();

  Logger.log('✅ All cloud triggers installed:\n' +
    '  06:00 — Job status progression\n' +
    '  06:15 — Week ahead briefing\n' +
    '  06:30 — 🧠 CoachBot morning nudge\n' +
    '  06:45 — Today\'s job sheet\n' +
    '  07:30 — Email lifecycle\n' +
    '  08:00 — Blog generation (1st/11th/21st)\n' +
    '  Mon 09:00 — Newsletter check\n' +
    '  10:00 — 🧠 CoachBot mid-morning check\n' +
    '  12:30 — 🧠 CoachBot lunch nudge\n' +
    '  15:00 — 🧠 CoachBot afternoon check\n' +
    '  17:30 — 🧠 CoachBot evening wrap-up');

  notifyTelegram('✅ *CLOUD AUTOMATION ACTIVE*\n\nAll triggers installed — your PC no longer needs to be running!\n\n' +
    '⏰ *Daily Schedule:*\n' +
    '  06:00 — Job status progression\n' +
    '  06:15 — Week ahead briefing\n' +
    '  06:30 — 🧠 CoachBot morning nudge\n' +
    '  06:45 — Today\'s job sheet\n' +
    '  07:30 — Email lifecycle\n' +
    '  08:00 — Blog post (1st/11th/21st)\n' +
    '  Mon 09:00 — Newsletter check\n' +
    '  10:00 — 🧠 CoachBot mid-morning check\n' +
    '  12:30 — 🧠 CoachBot lunch nudge\n' +
    '  15:00 — 🧠 CoachBot afternoon check\n' +
    '  17:30 — 🧠 CoachBot evening wrap-up\n\n' +
    '📝 Blog posts auto-generated by Gemini AI\n' +
    '🧠 CoachBot ADHD support running all day\n' +
    '📱 All delivered straight to Telegram.');
}


// ============================================================
// CLOUD BLOG GENERATION — Gemini AI + Pexels (no PC needed)
// ============================================================
// Runs on 1st, 11th, 21st of each month via daily trigger.
// Requires: GEMINI_API_KEY in Script Properties
//   (Get free key from https://aistudio.google.com/apikey)
//
// To set Script Properties in Apps Script Editor:
//   Project Settings (gear icon) → Script Properties → Add
//   Property: GEMINI_API_KEY   Value: your-key-here
// ============================================================

var CLOUD_CONTENT_CALENDAR = {
  1:  { month: 'January', topics: [
    { title: 'Winter Lawn Care: Protecting Your Grass in the Cold Months', cat: 'seasonal', tags: 'winter lawn care, frost protection, dormant grass, Cornwall gardens' },
    { title: 'Planning Your Garden for the Year Ahead', cat: 'tips', tags: 'garden planning, 2026 garden, seasonal planting, garden goals' },
    { title: 'How to Maintain Garden Tools During Winter', cat: 'tips', tags: 'garden tools, tool maintenance, winter storage, sharp blades' }
  ]},
  2:  { month: 'February', topics: [
    { title: 'Preparing Your Lawn for Spring: February Checklist', cat: 'seasonal', tags: 'spring prep, lawn checklist, February garden, early spring' },
    { title: 'When to Start Scarifying Your Lawn', cat: 'tips', tags: 'scarifying, lawn thatch, moss removal, lawn renovation' },
    { title: 'The Best Time to Trim Hedges in Cornwall', cat: 'tips', tags: 'hedge trimming, Cornwall hedges, hedge maintenance, nesting birds' }
  ]},
  3:  { month: 'March', topics: [
    { title: 'Spring Lawn Revival: Your Complete March Guide', cat: 'seasonal', tags: 'spring lawn care, March garden, first mow, lawn feed' },
    { title: 'Moss Control: Why Your Lawn Has Moss and How to Fix It', cat: 'tips', tags: 'moss control, lawn moss, scarifying, lawn drainage' },
    { title: 'Power Washing Patios After Winter: Tips for a Fresh Look', cat: 'projects', tags: 'power washing, patio cleaning, spring clean, algae removal' }
  ]},
  4:  { month: 'April', topics: [
    { title: 'April Lawn Care: Feeding, Seeding and Weeding', cat: 'seasonal', tags: 'lawn feed, overseeding, weed control, April lawn care' },
    { title: 'How Often Should You Mow Your Lawn?', cat: 'tips', tags: 'mowing frequency, cutting height, lawn mowing tips, grass growth' },
    { title: 'Creating a Low-Maintenance Garden That Still Looks Amazing', cat: 'projects', tags: 'low maintenance garden, easy garden, ground cover, mulching' }
  ]},
  5:  { month: 'May', topics: [
    { title: 'May Garden Blitz: Getting Summer-Ready', cat: 'seasonal', tags: 'May garden, summer prep, lawn care, garden tidy' },
    { title: 'The Science Behind Lawn Treatments: What Your Grass Actually Needs', cat: 'tips', tags: 'lawn treatment, fertiliser, NPK, grass nutrition' },
    { title: 'Dealing With Dandelions and Common Lawn Weeds', cat: 'tips', tags: 'dandelions, lawn weeds, weed killer, organic weed control' }
  ]},
  6:  { month: 'June', topics: [
    { title: 'Summer Lawn Care: How to Keep Grass Green in the Heat', cat: 'seasonal', tags: 'summer lawn care, watering lawn, heat stress, green grass' },
    { title: 'Hedge Trimming Season: Shape Up Your Boundaries', cat: 'tips', tags: 'hedge trimming, summer hedges, topiary, hedge shapes' },
    { title: 'Why Professional Garden Maintenance Saves You Money', cat: 'news', tags: 'professional garden care, garden service, save money, property value' }
  ]},
  7:  { month: 'July', topics: [
    { title: 'July Garden Survival Guide: Beating the Summer Drought', cat: 'seasonal', tags: 'drought gardening, water conservation, summer survival, dry lawn' },
    { title: 'How to Repair Brown Patches on Your Lawn', cat: 'tips', tags: 'brown patches, lawn repair, dry spots, lawn recovery' },
    { title: 'Garden Tidy-Up: Making the Most of Long Summer Evenings', cat: 'projects', tags: 'garden tidy, summer garden, outdoor living, garden makeover' }
  ]},
  8:  { month: 'August', topics: [
    { title: 'Late Summer Lawn Care: Preparing for Autumn', cat: 'seasonal', tags: 'late summer, autumn prep, lawn health, August garden' },
    { title: 'The Best Grass Types for Cornish Gardens', cat: 'tips', tags: 'grass types, Cornwall lawn, coastal garden, fescue, ryegrass' },
    { title: 'Before and After: Amazing Garden Transformations', cat: 'projects', tags: 'garden transformation, before after, garden makeover, curb appeal' }
  ]},
  9:  { month: 'September', topics: [
    { title: 'September: The Most Important Month for Your Lawn', cat: 'seasonal', tags: 'September lawn care, autumn feed, overseeding, aeration' },
    { title: 'Scarifying and Aerating: A Complete Autumn Guide', cat: 'tips', tags: 'scarifying, aeration, lawn renovation, thatch removal' },
    { title: 'How Regular Maintenance Prevents Expensive Garden Rescues', cat: 'news', tags: 'garden maintenance, prevention, regular care, garden rescue' }
  ]},
  10: { month: 'October', topics: [
    { title: "Autumn Leaf Management: Don't Let Fallen Leaves Kill Your Lawn", cat: 'seasonal', tags: 'autumn leaves, leaf removal, leaf mulch, lawn damage' },
    { title: 'Winterising Your Garden: October Task List', cat: 'tips', tags: 'winterise garden, October tasks, frost prep, garden protection' },
    { title: 'Power Washing Before Winter: Protecting Your Hard Surfaces', cat: 'projects', tags: 'power washing, winter prep, driveway cleaning, path safety' }
  ]},
  11: { month: 'November', topics: [
    { title: 'November Garden Care: Wrapping Up for Winter', cat: 'seasonal', tags: 'November garden, winter prep, last mow, garden shutdown' },
    { title: 'Why Autumn Lawn Treatment Gives You the Best Spring Lawn', cat: 'tips', tags: 'autumn lawn treatment, winter feed, spring lawn, root growth' },
    { title: 'The Benefits of a Garden Maintenance Subscription', cat: 'news', tags: 'garden subscription, maintenance plan, regular care, hassle free' }
  ]},
  12: { month: 'December', topics: [
    { title: 'December Garden: What to Do (and What to Leave Alone)', cat: 'seasonal', tags: 'December garden, winter garden, frost, dormant care' },
    { title: 'Gift Ideas for Garden Lovers This Christmas', cat: 'news', tags: 'garden gifts, Christmas gifts, gardener presents, garden tools' },
    { title: 'Year in Review: Looking After Cornish Gardens in 2026', cat: 'news', tags: 'year review, Cornwall gardens, 2026 roundup, garden highlights' }
  ]}
};


// ── Ask Gemini (free tier) — replaces local Ollama ──
function askGemini(prompt, temperature) {
  var apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!apiKey) throw new Error('GEMINI_API_KEY not set in Script Properties. Go to Project Settings → Script Properties → Add it.');

  var url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=' + apiKey;

  var payload = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: temperature || 0.7,
      maxOutputTokens: 2048
    }
  };

  var options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  var resp = UrlFetchApp.fetch(url, options);
  var code = resp.getResponseCode();
  if (code !== 200) {
    throw new Error('Gemini API error (' + code + '): ' + resp.getContentText().substring(0, 300));
  }

  var json = JSON.parse(resp.getContentText());
  var text = '';
  try {
    text = json.candidates[0].content.parts[0].text;
  } catch(e) {
    throw new Error('Gemini returned unexpected format: ' + resp.getContentText().substring(0, 300));
  }

  return text.trim();
}


// ── Sanitise content — fix any hallucinated contact details ──
function sanitiseBlogContent(text) {
  // Fix phone numbers — replace any invented ones with the real one
  text = text.replace(/(?:0\d{3,4}[\s-]?\d{5,7}|(?:\+44|0044)\s?\d{3,4}\s?\d{6,7})/g, '01726 432051');
  // Fix email addresses
  text = text.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, 'info@gardnersgm.co.uk');
  // Fix website URLs — various patterns
  text = text.replace(/(?:https?:\/\/)?(?:www\.)?gardners?(?:gm|groundmaintenance|grounds)?\.(?:co\.uk|com|uk)[^\s)"]*/gi, 'gardnersgm.co.uk');
  return text;
}


// ── Fetch Pexels image for blog hero ──
function fetchPexelsImageForBlog(query) {
  try {
    var url = 'https://api.pexels.com/v1/search?query=' + encodeURIComponent(query) + '&per_page=5&orientation=landscape';
    var resp = UrlFetchApp.fetch(url, {
      headers: { 'Authorization': PEXELS_API_KEY },
      muteHttpExceptions: true
    });

    if (resp.getResponseCode() === 200) {
      var data = JSON.parse(resp.getContentText());
      if (data.photos && data.photos.length > 0) {
        // Pick a random one from top 5 for variety
        var idx = Math.floor(Math.random() * Math.min(data.photos.length, 5));
        return data.photos[idx].src.landscape || data.photos[idx].src.large;
      }
    }
  } catch(e) {
    Logger.log('Pexels fetch failed: ' + e.message);
  }

  // Fallback images by month
  var FALLBACK_IMAGES = {
    1:  'https://images.pexels.com/photos/1002703/pexels-photo-1002703.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200',
    2:  'https://images.pexels.com/photos/1301856/pexels-photo-1301856.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200',
    3:  'https://images.pexels.com/photos/462118/pexels-photo-462118.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200',
    4:  'https://images.pexels.com/photos/589/garden-grass-meadow-green.jpg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200',
    5:  'https://images.pexels.com/photos/1072824/pexels-photo-1072824.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200',
    6:  'https://images.pexels.com/photos/1214394/pexels-photo-1214394.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200',
    7:  'https://images.pexels.com/photos/2132227/pexels-photo-2132227.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200',
    8:  'https://images.pexels.com/photos/1084540/pexels-photo-1084540.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200',
    9:  'https://images.pexels.com/photos/1459495/pexels-photo-1459495.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200',
    10: 'https://images.pexels.com/photos/1459505/pexels-photo-1459505.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200',
    11: 'https://images.pexels.com/photos/33109/fall-autumn-red-season.jpg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200',
    12: 'https://images.pexels.com/photos/688660/pexels-photo-688660.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200'
  };

  var m = new Date().getMonth() + 1;
  return FALLBACK_IMAGES[m] || FALLBACK_IMAGES[3];
}


// ── Main cloud blog generator (runs daily, publishes on 1st, 11th, 21st) ──
function cloudGenerateBlogPost(force) {
  try {
    var today = new Date();
    var day = today.getDate();

    // Only publish on the 1st, 11th, and 21st (3 posts per month) — unless forced via ContentBot
    if (!force && day !== 1 && day !== 11 && day !== 21) {
      Logger.log('Blog: Not a publish day (day ' + day + '). Runs on 1st, 11th, 21st.');
      return;
    }

    var month = today.getMonth() + 1;
    var monthData = CLOUD_CONTENT_CALENDAR[month];
    if (!monthData) {
      Logger.log('No content calendar for month ' + month);
      return;
    }

    // Check which topics are already published this month
    var ss = SpreadsheetApp.openById('1_Y7yHIpAvv_VNBhTrwNOQaBMAGa3UlVW_FKlf56ouHk');
    var blogSheet = ss.getSheetByName('Blog');

    var existingTitles = [];
    if (blogSheet && blogSheet.getLastRow() > 1) {
      var blogData = blogSheet.getDataRange().getValues();
      for (var i = 1; i < blogData.length; i++) {
        var title = String(blogData[i][2] || '').toLowerCase();
        if (title) existingTitles.push(title);
      }
    }

    // Find an unused topic for this month
    var topic = null;
    for (var t = 0; t < monthData.topics.length; t++) {
      var topicTitle = monthData.topics[t].title.toLowerCase();
      var alreadyPublished = false;
      for (var e = 0; e < existingTitles.length; e++) {
        if (existingTitles[e].indexOf(topicTitle.substring(0, 30)) >= 0) {
          alreadyPublished = true;
          break;
        }
      }
      if (!alreadyPublished) {
        topic = monthData.topics[t];
        break;
      }
    }

    if (!topic) {
      Logger.log('All ' + monthData.month + ' topics already published. Nothing to do.');
      notifyBot('contentbot', '📝 *Blog Auto-Check*\n\nAll 3 ' + monthData.month + ' blog topics already published. ✅');
      return;
    }

    Logger.log('Generating blog post: "' + topic.title + '"');

    // ── Generate main blog content with Gemini — founder's voice ──
    var blogPrompt = 'You are Chris, the founder of Gardners Ground Maintenance — a hands-on gardening and grounds company based in Roche, Cornwall. You actually do this work every day with your team across Cornwall.\n\n'
      + 'TITLE: ' + topic.title + '\n'
      + 'CATEGORY: ' + topic.cat + '\n'
      + 'MONTH: ' + monthData.month + '\n\n'
      + 'YOUR VOICE:\n'
      + '- You\'re a real person who gets muddy boots and drives a van around Cornwall\n'
      + '- Write like you\'re chatting to a customer over a cuppa, not writing an essay\n'
      + '- Share things you\'ve actually seen on jobs — "we had a customer in Truro last month whose lawn was 90% moss" type observations\n'
      + '- Drop in specifics about Cornwall — the clay soil around Bodmin, salt air near the coast, how the mild winters mean grass never fully stops growing\n'
      + '- Use short paragraphs. Mix in a one-liner paragraph now and then for pacing\n'
      + '- It\'s OK to say "honestly" or "to be fair" or "the truth is" — real people do\n'
      + '- Disagree with common myths if relevant — "I see this advice online all the time and it drives me mad"\n'
      + '- Occasional dry humour is fine — you\'re Cornish, not corporate\n\n'
      + 'FACTUAL RULES (NON-NEGOTIABLE):\n'
      + '- Every claim must be horticulturally accurate. If you\'re not sure, don\'t say it\n'
      + '- Use real measurements, real timings, real product types (e.g. "a 25-5-5 spring feed", "cut to 35mm")\n'
      + '- Don\'t generalise — be specific. Not "water your lawn" but "give it 25mm of water once a week if we get a dry spell"\n'
      + '- Cornwall\'s climate: USDA zone 9, mild wet winters (rarely below -3°C), warm summers (rarely above 28°C), heavy clay in mid-Cornwall, lighter sandy soils near the coast, high rainfall (1200mm+/year)\n'
      + '- Only factual contact details: Phone 01726 432051, Email info@gardnersgm.co.uk, Website gardnersgm.co.uk\n\n'
      + 'FORMATTING:\n'
      + '- 600-900 words\n'
      + '- Use ## for subheadings (3-5 of them)\n'
      + '- **Bold** key terms, bullet lists where it makes sense\n'
      + '- Do NOT include the title (it\'s handled separately)\n'
      + '- Do NOT start with "In this article" or end with "In conclusion"\n'
      + '- Do NOT use markdown link syntax — just mention names/numbers naturally\n'
      + '- End with a natural sign-off — not a hard sell, just something like "If you\'d rather we took care of it, give us a ring on 01726 432051"\n'
      + '- British English throughout\n\n'
      + 'IMPORTANT: At the end, on a new line, write IMAGE_HINTS: followed by 3 comma-separated short phrases describing photos that would suit different sections of this post (e.g. "mossy lawn close-up, garden rake on grass, green striped lawn"). These must relate to the actual content you wrote.\n\n'
      + 'Write the blog post now:';

    var content = askGemini(blogPrompt, 0.7);

    if (!content || content.length < 200) {
      throw new Error('Generated content too short (' + (content || '').length + ' chars)');
    }

    content = sanitiseBlogContent(content);

    // ── Extract image hints and fetch inline images ──
    var imageHints = [];
    var hintsMatch = content.match(/IMAGE_HINTS:\s*(.+)/i);
    if (hintsMatch) {
      imageHints = hintsMatch[1].split(',').map(function(h) { return h.trim(); }).filter(Boolean).slice(0, 3);
      content = content.replace(/IMAGE_HINTS:.+/i, '').trim();
      Logger.log('Image hints: ' + imageHints.join(', '));
    }

    // Fetch and insert inline images after 2nd and 4th subheadings
    var inlineImages = [];
    for (var ii = 0; ii < Math.min(imageHints.length, 2); ii++) {
      var inImg = fetchPexelsImageForBlog(imageHints[ii] + ' garden');
      if (inImg) inlineImages.push({ url: inImg, alt: imageHints[ii] });
    }
    if (inlineImages.length > 0) {
      var headingCount = 0;
      var lines = content.split('\n');
      var newLines = [];
      var imgIdx = 0;
      for (var li = 0; li < lines.length; li++) {
        newLines.push(lines[li]);
        if (lines[li].indexOf('## ') === 0 && imgIdx < inlineImages.length) {
          headingCount++;
          if (headingCount === 2 || headingCount === 4) {
            newLines.push('');
            newLines.push('![' + inlineImages[imgIdx].alt + '](' + inlineImages[imgIdx].url + ')');
            newLines.push('');
            imgIdx++;
          }
        }
      }
      content = newLines.join('\n');
      Logger.log('Inserted ' + imgIdx + ' inline images into blog post');
    }

    Logger.log('Generated ' + content.length + ' chars of blog content');

    // ── Generate excerpt ──
    var excerptPrompt = 'Write a compelling 1-2 sentence excerpt (max 160 characters) for this blog post titled "' + topic.title + '". Write it like Chris the founder would say it — natural, not salesy. Just output the excerpt, nothing else.';
    var excerpt = askGemini(excerptPrompt, 0.5);
    excerpt = (excerpt || '').substring(0, 200).replace(/"/g, "'");

    // ── Generate social media snippets ──
    var socialPrompt = 'You\'re Chris from Gardners Ground Maintenance in Cornwall. Write social media posts promoting this blog: "' + topic.title + '". Sound human — short, punchy, like a real tradesman sharing knowledge, not a marketing agency. Output EXACTLY in this format:\n\n'
      + 'FB: [Facebook post, 2-3 sentences max, like you\'re posting between jobs. Use one emoji max]\n'
      + 'IG: [Instagram caption, casual and helpful, include 5 relevant hashtags at the end]\n'
      + 'X: [Tweet, under 280 characters, punchy and real, 1-2 hashtags]';

    var socialRaw = sanitiseBlogContent(askGemini(socialPrompt, 0.6));
    var fbMatch = socialRaw.match(/FB:\s*(.+?)(?=\nIG:|$)/s);
    var igMatch = socialRaw.match(/IG:\s*(.+?)(?=\nX:|$)/s);
    var xMatch  = socialRaw.match(/X:\s*(.+?)$/s);
    var socialFb = (fbMatch ? fbMatch[1] : '').trim();
    var socialIg = (igMatch ? igMatch[1] : '').trim();
    var socialX  = (xMatch  ? xMatch[1]  : '').trim();

    // ── Fetch hero image — prefer first image hint for relevance ──
    var heroQuery = (imageHints.length > 0 ? imageHints[0] : topic.title.replace(/[^a-zA-Z\s]/g, '').split(/\s+/).filter(function(w) {
      return w.length > 3 && ['your','this','that','with','from','what','when','how','the','for','and','complete','guide'].indexOf(w.toLowerCase()) === -1;
    }).slice(0, 3).join(' ')) + ' garden';
    var imageUrl = fetchPexelsImageForBlog(heroQuery);

    // ── Save to Blog sheet (reuse existing saveBlogPost logic) ──
    if (!blogSheet) {
      blogSheet = ss.insertSheet('Blog');
      blogSheet.appendRow(['ID', 'Date', 'Title', 'Category', 'Author', 'Excerpt', 'Content', 'Status', 'Tags', 'Social_FB', 'Social_IG', 'Social_X', 'ImageUrl']);
      blogSheet.getRange(1, 1, 1, 13).setFontWeight('bold');
    }

    var postId = 'post_' + Date.now();
    blogSheet.appendRow([
      postId,
      new Date().toISOString(),
      topic.title,
      topic.cat,
      'Gardners GM',
      excerpt,
      content,
      'published',
      topic.tags,
      socialFb,
      socialIg,
      socialX,
      imageUrl
    ]);

    Logger.log('Blog post published: "' + topic.title + '" (ID: ' + postId + ')');

    // ── Telegram notification ──
    var msg = '📖 *NEW BLOG POST PUBLISHED* 📖\n'
      + '━━━━━━━━━━━━━━━━━━━━\n\n'
      + '📌 *' + topic.title + '*\n'
      + '📂 ' + topic.cat + '\n'
      + '📏 ' + content.length + ' chars\n'
      + '📸 Hero image: ' + (imageUrl ? 'Yes' : 'No') + '\n'
      + '🖼️ Inline images: ' + inlineImages.length + '\n'
      + '📊 Status: published\n\n'
      + '📱 *Social snippets ready:*\n'
      + (socialFb ? '  FB ✅\n' : '')
      + (socialIg ? '  IG ✅\n' : '')
      + (socialX  ? '  X ✅\n' : '')
      + '\n👉 gardnersgm.co.uk/blog.html\n\n'
      + '_Written as Chris - Gemini AI ☁️_';

    notifyBot('contentbot', msg);

  } catch(e) {
    Logger.log('cloudGenerateBlogPost error: ' + e);
    notifyBot('contentbot', '⚠️ *Blog Generation Failed*\n\n' + e.message + '\n\n_Check Script Properties for GEMINI\\_API\\_KEY_');
  }
}


// ── TEST: Force a blog post now (bypasses date check) ──
// Run this manually to test, then delete it when happy
function testCloudBlogPost() {
  try {
    var month = new Date().getMonth() + 1;
    var monthData = CLOUD_CONTENT_CALENDAR[month];
    if (!monthData) throw new Error('No content calendar for month ' + month);

    var ss = SpreadsheetApp.openById('1_Y7yHIpAvv_VNBhTrwNOQaBMAGa3UlVW_FKlf56ouHk');
    var blogSheet = ss.getSheetByName('Blog');
    var existingTitles = [];
    if (blogSheet && blogSheet.getLastRow() > 1) {
      var blogData = blogSheet.getDataRange().getValues();
      for (var i = 1; i < blogData.length; i++) {
        var t = String(blogData[i][2] || '').toLowerCase();
        if (t) existingTitles.push(t);
      }
    }

    var topic = null;
    for (var t = 0; t < monthData.topics.length; t++) {
      var topicTitle = monthData.topics[t].title.toLowerCase();
      var found = false;
      for (var e = 0; e < existingTitles.length; e++) {
        if (existingTitles[e].indexOf(topicTitle.substring(0, 30)) >= 0) { found = true; break; }
      }
      if (!found) { topic = monthData.topics[t]; break; }
    }

    if (!topic) { Logger.log('All Feb topics already done'); return; }

    Logger.log('TEST: Generating "' + topic.title + '"...');
    var content = askGemini('You are Chris, the founder of Gardners Ground Maintenance in Roche, Cornwall. Write a 600-900 word blog post titled "' + topic.title + '" for ' + monthData.month + '. Write like you\'re chatting to a customer — personal observations from real jobs, specific Cornwall details (clay soil, salt air, mild winters), real measurements and timings. Short paragraphs, dry humour OK, disagree with myths. Use markdown (## subheadings, **bold**, bullet lists). End with natural sign-off mentioning 01726 432051. British English. Do NOT include the title. At the end write IMAGE_HINTS: followed by 3 comma-separated photo descriptions matching the content.', 0.7);
    // Extract image hints
    var testHints = content.match(/IMAGE_HINTS:\s*(.+)/i);
    if (testHints) content = content.replace(/IMAGE_HINTS:.+/i, '').trim();
    content = sanitiseBlogContent(content);
    Logger.log('Generated ' + content.length + ' chars ✅');

    var excerpt = askGemini('Write a 1-2 sentence excerpt (max 160 chars) for a blog post titled "' + topic.title + '". Sound like a real person, not a marketing bot. Just the excerpt.', 0.5);
    var imageUrl = fetchPexelsImageForBlog((testHints ? testHints[1].split(',')[0].trim() : topic.title.split(' ').slice(0, 3).join(' ')) + ' garden');

    if (!blogSheet) {
      blogSheet = ss.insertSheet('Blog');
      blogSheet.appendRow(['ID','Date','Title','Category','Author','Excerpt','Content','Status','Tags','Social_FB','Social_IG','Social_X','ImageUrl']);
    }

    blogSheet.appendRow(['post_' + Date.now(), new Date().toISOString(), topic.title, topic.cat, 'Gardners GM', (excerpt || '').substring(0, 200), content, 'published', topic.tags, '', '', '', imageUrl]);
    Logger.log('Published to Blog sheet ✅');
    notifyBot('contentbot', '🧪 *TEST BLOG POST*\n\n📌 *' + topic.title + '*\n📏 ' + content.length + ' chars\n📸 Image: ' + (imageUrl ? 'Yes' : 'No') + '\n\n_Test run — Gemini AI working! ☁️_');
    Logger.log('Done! Check your Blog sheet and Telegram.');
  } catch(e) {
    Logger.log('TEST ERROR: ' + e);
    notifyBot('contentbot', '⚠️ *Test Blog Failed*\n\n' + e.message);
  }
}


// ============================================
// CAREERS SYSTEM — Vacancies & Applications
// ============================================

var SHEET_ID = SPREADSHEET_ID; // consolidated

/**
 * Get or create the Vacancies sheet
 */
function getVacanciesSheet() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName('Vacancies');
  if (!sheet) {
    sheet = ss.insertSheet('Vacancies');
    sheet.appendRow(['ID', 'Title', 'Type', 'Location', 'Salary', 'Description', 'Requirements', 'Status', 'ClosingDate', 'PostedDate', 'UpdatedDate']);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/**
 * Get or create the Applications sheet
 */
function getApplicationsSheet() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName('Applications');
  if (!sheet) {
    sheet = ss.insertSheet('Applications');
    sheet.appendRow(['ID', 'Timestamp', 'Position', 'FirstName', 'LastName', 'Email', 'Phone', 'Postcode', 'DOB', 'AvailableFrom', 'PreferredHours', 'DrivingLicence', 'OwnTransport', 'Experience', 'Qualifications', 'Message', 'CVFileId', 'CVFileName', 'Status', 'Notes']);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/**
 * GET: Return vacancies — if admin=true returns all, else only Open + not expired
 */
function getVacancies(includeAll) {
  try {
    var sheet = getVacanciesSheet();
    var rows = sheet.getDataRange().getValues();
    var vacancies = [];
    var now = new Date();

    for (var i = 1; i < rows.length; i++) {
      var v = {
        id: rows[i][0],
        title: rows[i][1],
        type: rows[i][2],
        location: rows[i][3],
        salary: rows[i][4],
        description: rows[i][5],
        requirements: rows[i][6],
        status: rows[i][7],
        closingDate: rows[i][8] ? new Date(rows[i][8]).toISOString() : '',
        postedDate: rows[i][9] ? new Date(rows[i][9]).toISOString() : '',
        updatedDate: rows[i][10] ? new Date(rows[i][10]).toISOString() : '',
        rowIndex: i + 1
      };

      if (includeAll) {
        vacancies.push(v);
      } else {
        // Public: only Open + not past closing date
        if (v.status === 'Open') {
          if (!v.closingDate || new Date(v.closingDate) >= now) {
            vacancies.push(v);
          }
        }
      }
    }

    return ContentService.createTextOutput(JSON.stringify({ status: 'success', vacancies: vacancies }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (e) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: e.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * POST: Create or update a vacancy
 */
function postVacancy(data) {
  try {
    var sheet = getVacanciesSheet();
    var now = new Date();

    if (data.vacancyId) {
      // Update existing
      var rows = sheet.getDataRange().getValues();
      for (var i = 1; i < rows.length; i++) {
        if (rows[i][0] === data.vacancyId) {
          var row = i + 1;
          sheet.getRange(row, 2).setValue(data.title || rows[i][1]);
          sheet.getRange(row, 3).setValue(data.type || rows[i][2]);
          sheet.getRange(row, 4).setValue(data.location || rows[i][3]);
          sheet.getRange(row, 5).setValue(data.salary || rows[i][4]);
          sheet.getRange(row, 6).setValue(data.description || rows[i][5]);
          sheet.getRange(row, 7).setValue(data.requirements || rows[i][6]);
          sheet.getRange(row, 8).setValue(data.status || rows[i][7]);
          sheet.getRange(row, 9).setValue(data.closingDate || rows[i][8]);
          sheet.getRange(row, 11).setValue(now);
          return ContentService.createTextOutput(JSON.stringify({ status: 'success', message: 'Vacancy updated' }))
            .setMimeType(ContentService.MimeType.JSON);
        }
      }
      return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: 'Vacancy not found' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // New vacancy
    var id = 'vac_' + Date.now();
    sheet.appendRow([
      id,
      data.title || '',
      data.type || 'Full-time',
      data.location || 'Cornwall',
      data.salary || '',
      data.description || '',
      data.requirements || '',
      data.status || 'Open',
      data.closingDate || '',
      now,
      now
    ]);

    // Telegram notification
    notifyBot('contentbot',
      '📋 *New Vacancy Posted*\n\n' +
      '🏷 *' + (data.title || 'Untitled') + '*\n' +
      '📍 ' + (data.location || 'Cornwall') + '\n' +
      '⏰ ' + (data.type || 'Full-time') + '\n' +
      (data.salary ? '💰 ' + data.salary + '\n' : '') +
      '\n_Check the careers page on your site._'
    );

    return ContentService.createTextOutput(JSON.stringify({ status: 'success', id: id, message: 'Vacancy posted' }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (e) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: e.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * POST: Delete a vacancy
 */
function deleteVacancy(data) {
  try {
    var sheet = getVacanciesSheet();
    var rows = sheet.getDataRange().getValues();
    for (var i = 1; i < rows.length; i++) {
      if (rows[i][0] === data.vacancyId) {
        sheet.deleteRow(i + 1);
        return ContentService.createTextOutput(JSON.stringify({ status: 'success', message: 'Vacancy deleted' }))
          .setMimeType(ContentService.MimeType.JSON);
      }
    }
    return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: 'Vacancy not found' }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (e) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: e.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * POST: Submit a job application (with optional CV as base64)
 */
function submitApplication(data) {
  try {
    var sheet = getApplicationsSheet();
    var now = new Date();
    var id = 'app_' + Date.now();

    // Handle CV upload — save to Google Drive
    var cvFileId = '';
    var cvFileName = '';
    if (data.cvBase64 && data.cvName) {
      try {
        cvFileName = data.cvName;
        var mimeType = 'application/octet-stream';
        if (cvFileName.endsWith('.pdf')) mimeType = 'application/pdf';
        else if (cvFileName.endsWith('.docx')) mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
        else if (cvFileName.endsWith('.doc')) mimeType = 'application/msword';

        var blob = Utilities.newBlob(Utilities.base64Decode(data.cvBase64), mimeType, cvFileName);
        
        // Create or find CV folder
        var folders = DriveApp.getFoldersByName('GGM Job Applications');
        var folder;
        if (folders.hasNext()) {
          folder = folders.next();
        } else {
          folder = DriveApp.createFolder('GGM Job Applications');
        }

        var file = folder.createFile(blob);
        file.setName(data.firstName + ' ' + data.lastName + ' - ' + cvFileName);
        cvFileId = file.getId();
      } catch (cvErr) {
        Logger.log('CV upload error: ' + cvErr);
        // Continue without CV if upload fails
      }
    }

    // Write to sheet
    sheet.appendRow([
      id,
      now,
      data.position || 'Speculative Application',
      data.firstName || '',
      data.lastName || '',
      data.email || '',
      data.phone || '',
      data.postcode || '',
      data.dob || '',
      data.availableFrom || '',
      data.preferredHours || 'Full-time',
      data.drivingLicence || '',
      data.ownTransport || '',
      data.experience || '',
      data.qualifications || '',
      data.message || '',
      cvFileId,
      cvFileName,
      'New',
      ''
    ]);

    // Send confirmation email to applicant
    if (data.email) {
      try {
        sendEmail({
          to: data.email,
          toName: data.firstName || '',
          subject: 'Application Received — Gardners Ground Maintenance',
          htmlBody: '<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">' +
            '<div style="background:#2E7D32;color:#fff;padding:20px;text-align:center;border-radius:8px 8px 0 0;">' +
            '<h2 style="margin:0;">Application Received ✅</h2></div>' +
            '<div style="padding:24px;background:#f9f9f9;border-radius:0 0 8px 8px;">' +
            '<p>Hi ' + (data.firstName || 'there') + ',</p>' +
            '<p>Thanks for applying for the <strong>' + (data.position || 'position') + '</strong> role at Gardners Ground Maintenance.</p>' +
            '<p>We\'ve received your application and will review it shortly. If your skills and experience are a good match, we\'ll be in touch to arrange the next steps.</p>' +
            '<p style="margin-top:20px;">Best wishes,<br><strong>Gardners Ground Maintenance</strong><br>01726 432051</p>' +
            '</div></div>',
          name: 'Gardners Ground Maintenance',
          replyTo: 'info@gardnersgm.co.uk'
        });
      } catch (emailErr) {
        Logger.log('Applicant email failed: ' + emailErr);
      }
    }

    // Telegram notification to admin
    var fullName = ((data.firstName || '') + ' ' + (data.lastName || '')).trim();
    notifyTelegram(
      '📨 *New Job Application*\n\n' +
      '👤 *' + fullName + '*\n' +
      '🏷 Position: ' + (data.position || 'Speculative') + '\n' +
      '📧 ' + (data.email || 'No email') + '\n' +
      '📞 ' + (data.phone || 'No phone') + '\n' +
      '📍 ' + (data.postcode || '—') + '\n' +
      '🪪 Licence: ' + (data.drivingLicence || '—') + '\n' +
      '📎 CV: ' + (cvFileId ? 'Uploaded ✅' : 'Not provided') + '\n' +
      '\n_Check the Careers tab in your admin dashboard._'
    );

    // Send admin email notification
    try {
      sendEmail({
        to: 'info@gardnersgm.co.uk',
        toName: '',
        subject: 'New Job Application — ' + fullName,
        htmlBody: '<div style="font-family:Arial,sans-serif;max-width:600px;">' +
            '<h2 style="color:#2E7D32;">New Job Application</h2>' +
            '<table style="border-collapse:collapse;width:100%;">' +
            '<tr><td style="padding:8px;font-weight:bold;border-bottom:1px solid #eee;">Name</td><td style="padding:8px;border-bottom:1px solid #eee;">' + fullName + '</td></tr>' +
            '<tr><td style="padding:8px;font-weight:bold;border-bottom:1px solid #eee;">Position</td><td style="padding:8px;border-bottom:1px solid #eee;">' + (data.position || 'Speculative') + '</td></tr>' +
            '<tr><td style="padding:8px;font-weight:bold;border-bottom:1px solid #eee;">Email</td><td style="padding:8px;border-bottom:1px solid #eee;">' + (data.email || '—') + '</td></tr>' +
            '<tr><td style="padding:8px;font-weight:bold;border-bottom:1px solid #eee;">Phone</td><td style="padding:8px;border-bottom:1px solid #eee;">' + (data.phone || '—') + '</td></tr>' +
            '<tr><td style="padding:8px;font-weight:bold;border-bottom:1px solid #eee;">Postcode</td><td style="padding:8px;border-bottom:1px solid #eee;">' + (data.postcode || '—') + '</td></tr>' +
            '<tr><td style="padding:8px;font-weight:bold;border-bottom:1px solid #eee;">Driving Licence</td><td style="padding:8px;border-bottom:1px solid #eee;">' + (data.drivingLicence || '—') + '</td></tr>' +
            '<tr><td style="padding:8px;font-weight:bold;border-bottom:1px solid #eee;">Available From</td><td style="padding:8px;border-bottom:1px solid #eee;">' + (data.availableFrom || '—') + '</td></tr>' +
            '<tr><td style="padding:8px;font-weight:bold;">CV</td><td style="padding:8px;">' + (cvFileId ? '<a href="https://drive.google.com/file/d/' + cvFileId + '/view">Download CV</a>' : 'Not provided') + '</td></tr>' +
            '</table>' +
            (data.experience ? '<h3 style="color:#2E7D32;margin-top:16px;">Experience</h3><p>' + data.experience + '</p>' : '') +
            (data.message ? '<h3 style="color:#2E7D32;margin-top:16px;">Cover Message</h3><p>' + data.message + '</p>' : '') +
            '</div>',
        name: 'Gardners Ground Maintenance',
        replyTo: 'info@gardnersgm.co.uk'
      });
    } catch (adminErr) {
      Logger.log('Admin email failed: ' + adminErr);
    }

    return ContentService.createTextOutput(JSON.stringify({ status: 'success', id: id, message: 'Application submitted' }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (e) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: e.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * GET: Return all applications (admin)
 */
function getApplications() {
  try {
    var sheet = getApplicationsSheet();
    var rows = sheet.getDataRange().getValues();
    var apps = [];

    for (var i = 1; i < rows.length; i++) {
      apps.push({
        id: rows[i][0],
        timestamp: rows[i][1] ? new Date(rows[i][1]).toISOString() : '',
        position: rows[i][2],
        firstName: rows[i][3],
        lastName: rows[i][4],
        email: rows[i][5],
        phone: rows[i][6],
        postcode: rows[i][7],
        dob: rows[i][8],
        availableFrom: rows[i][9],
        preferredHours: rows[i][10],
        drivingLicence: rows[i][11],
        ownTransport: rows[i][12],
        experience: rows[i][13],
        qualifications: rows[i][14],
        message: rows[i][15],
        cvFileId: rows[i][16],
        cvFileName: rows[i][17],
        status: rows[i][18],
        notes: rows[i][19],
        rowIndex: i + 1
      });
    }

    return ContentService.createTextOutput(JSON.stringify({ status: 'success', applications: apps }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (e) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: e.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * POST: Update application status
 */
function updateApplicationStatus(data) {
  try {
    var sheet = getApplicationsSheet();
    var rows = sheet.getDataRange().getValues();
    
    for (var i = 1; i < rows.length; i++) {
      if (rows[i][0] === data.applicationId) {
        var row = i + 1;
        if (data.status) sheet.getRange(row, 19).setValue(data.status);
        if (data.notes !== undefined) sheet.getRange(row, 20).setValue(data.notes);
        return ContentService.createTextOutput(JSON.stringify({ status: 'success', message: 'Application status updated' }))
          .setMimeType(ContentService.MimeType.JSON);
      }
    }

    return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: 'Application not found' }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (e) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: e.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}


// ===== END OF CAREERS =====


// ============================================
// COMPLAINTS SYSTEM
// ============================================

/**
 * Get or create the Complaints sheet
 */
function getComplaintsSheet() {
  var ss = SpreadsheetApp.openById('1_Y7yHIpAvv_VNBhTrwNOQaBMAGa3UlVW_FKlf56ouHk');
  var sheet = ss.getSheetByName('Complaints');
  if (!sheet) {
    sheet = ss.insertSheet('Complaints');
    sheet.appendRow([
      'ComplaintRef',     // A
      'Timestamp',        // B
      'ComplaintType',    // C  (single / subscriber)
      'Name',             // D
      'Email',            // E
      'Phone',            // F
      'JobRef',           // G
      'Package',          // H
      'SubscriptionId',   // I
      'Service',          // J
      'ServiceDate',      // K
      'Severity',         // L  (minor/moderate/major/critical)
      'Description',      // M
      'DesiredResolution', // N
      'AmountPaid',       // O
      'PhotoLinks',       // P  (comma-separated Drive URLs)
      'Status',           // Q  (open/investigating/resolved/closed)
      'AdminNotes',       // R
      'ResolutionType',   // S
      'ResolutionValue',  // T
      'ResolutionNotes',  // U
      'ResolvedDate',     // V
      'Resolution'        // W  (boolean flag)
    ]);
    sheet.getRange(1, 1, 1, 23).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/**
 * Generate complaint reference
 */
function generateComplaintRef() {
  var now = new Date();
  var datePart = Utilities.formatDate(now, 'Europe/London', 'yyyyMMdd');
  var rand = Math.floor(Math.random() * 9000) + 1000;
  return 'CMP-' + datePart + '-' + rand;
}

/**
 * GET: Get all complaints
 */
function getComplaints() {
  try {
    var sheet = getComplaintsSheet();
    var data = sheet.getDataRange().getValues();
    if (data.length <= 1) {
      return ContentService.createTextOutput(JSON.stringify({ status: 'success', complaints: [] }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    var complaints = [];
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      complaints.push({
        complaintRef: row[0],
        timestamp: row[1],
        complaintType: row[2],
        name: row[3],
        email: row[4],
        phone: row[5],
        jobRef: row[6],
        package: row[7],
        subscriptionId: row[8],
        service: row[9],
        serviceDate: row[10],
        severity: row[11],
        description: row[12],
        desiredResolution: row[13],
        amountPaid: row[14],
        photoLinks: row[15] ? row[15].split(',') : [],
        status: row[16] || 'open',
        adminNotes: row[17],
        resolutionType: row[18],
        resolutionValue: row[19],
        resolutionNotes: row[20],
        resolvedDate: row[21],
        resolution: row[22]
      });
    }

    return ContentService.createTextOutput(JSON.stringify({ status: 'success', complaints: complaints }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch(e) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: e.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * POST: Submit a new complaint (public)
 */
function submitComplaint(data) {
  try {
    var sheet = getComplaintsSheet();
    var complaintRef = generateComplaintRef();
    var timestamp = new Date().toISOString();

    // Save photos to Google Drive
    var photoLinks = [];
    if (data.photos && data.photos.length > 0) {
      var folders = DriveApp.getFoldersByName('GGM Complaint Photos');
      var folder;
      if (folders.hasNext()) {
        folder = folders.next();
      } else {
        folder = DriveApp.createFolder('GGM Complaint Photos');
      }

      for (var p = 0; p < data.photos.length; p++) {
        try {
          var photo = data.photos[p];
          var blob = Utilities.newBlob(Utilities.base64Decode(photo.data), photo.type, complaintRef + '-photo-' + (p + 1) + '.' + (photo.name.split('.').pop() || 'jpg'));
          var file = folder.createFile(blob);
          file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
          photoLinks.push(file.getUrl());
        } catch(pe) {
          Logger.log('Photo upload error: ' + pe);
        }
      }
    }

    // Write to sheet
    sheet.appendRow([
      complaintRef,                // A
      timestamp,                   // B
      data.complaintType || '',    // C
      data.name || '',             // D
      data.email || '',            // E
      data.phone || '',            // F
      data.jobRef || '',           // G
      data.package || '',          // H
      data.subscriptionId || '',   // I
      data.service || '',          // J
      data.serviceDate || '',      // K
      data.severity || '',         // L
      data.description || '',      // M
      data.desiredResolution || '', // N
      data.amountPaid || '',       // O
      photoLinks.join(','),        // P
      'open',                      // Q - Status
      '',                          // R - Admin notes
      '',                          // S - Resolution type
      '',                          // T - Resolution value
      '',                          // U - Resolution notes
      '',                          // V - Resolved date
      ''                           // W - Resolution flag
    ]);

    // Send confirmation email to customer
    try {
      var firstName = (data.name || 'Customer').split(' ')[0];
      var confirmHtml = '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:0;background:#f4f7f4;font-family:Arial,sans-serif;">'
        + '<div style="max-width:600px;margin:0 auto;background:#fff;">'
        + '<div style="background:linear-gradient(135deg,#E65100,#FF9800);padding:30px;text-align:center;">'
        + '<h1 style="color:#fff;margin:0;font-size:20px;">Complaint Received</h1></div>'
        + '<div style="padding:30px;">'
        + '<h2 style="color:#E65100;margin:0 0 10px;">Hi ' + firstName + ',</h2>'
        + '<p style="color:#333;line-height:1.6;">We have received your complaint and take it very seriously. A manager will review your case and respond within <strong>48 hours</strong>.</p>'
        + '<div style="background:#FFF3E0;border:2px solid #E65100;border-radius:8px;padding:15px;text-align:center;margin:20px 0;">'
        + '<span style="color:#E65100;font-weight:700;">Complaint Reference</span><br>'
        + '<span style="font-size:24px;font-weight:700;color:#E65100;font-family:monospace;">' + complaintRef + '</span></div>'
        + '<table style="width:100%;border-collapse:collapse;margin:15px 0;">'
        + '<tr><td style="padding:8px;color:#666;font-weight:600;">Service</td><td style="padding:8px;">' + (data.service || '—') + '</td></tr>'
        + '<tr style="background:#f8f8f8;"><td style="padding:8px;color:#666;font-weight:600;">Severity</td><td style="padding:8px;">' + (data.severity || '—') + '</td></tr>'
        + '<tr><td style="padding:8px;color:#666;font-weight:600;">Desired Resolution</td><td style="padding:8px;">' + (data.desiredResolution || '—') + '</td></tr>'
        + '</table>'
        + '<p style="color:#555;font-size:13px;line-height:1.6;">If you need to speak to someone urgently, please call <strong>01726 432051</strong>.</p>'
        + '</div>'
        + '<div style="background:#333;padding:20px;text-align:center;">'
        + '<p style="color:#aaa;font-size:12px;margin:0;">Gardners Ground Maintenance | 01726 432051 | info@gardnersgm.co.uk</p></div>'
        + '</div></body></html>';

      sendEmail({
        to: data.email,
        toName: '',
        subject: '⚠️ Complaint Received — ' + complaintRef + ' | Gardners GM',
        htmlBody: confirmHtml,
        name: 'Gardners Ground Maintenance',
        replyTo: 'info@gardnersgm.co.uk'
      });
    } catch(emailErr) {
      Logger.log('Complaint confirmation email error: ' + emailErr);
    }

    // Notify admin via Telegram
    try {
      var severityEmoji = { minor: '🟢', moderate: '🟡', major: '🔴', critical: '🚨' };
      notifyTelegram('⚠️ *NEW COMPLAINT*\n\n'
        + '📋 ' + complaintRef + '\n'
        + (severityEmoji[data.severity] || '❓') + ' Severity: *' + (data.severity || 'unknown').toUpperCase() + '*\n'
        + '👤 ' + (data.name || 'Unknown') + '\n'
        + '📧 ' + (data.email || '') + '\n'
        + '📦 Type: ' + (data.complaintType === 'subscriber' ? 'SUBSCRIBER' : 'One-Off') + '\n'
        + '🔧 Service: ' + (data.service || '—') + '\n'
        + '📅 Service Date: ' + (data.serviceDate || '—') + '\n'
        + '💰 Amount Paid: £' + (data.amountPaid || '0') + '\n'
        + '🎯 Wants: ' + (data.desiredResolution || '—') + '\n'
        + (photoLinks.length ? '📷 ' + photoLinks.length + ' photo(s) attached\n' : '')
        + '\n📝 ' + ((data.description || '').substring(0, 200)));
    } catch(tgErr) {
      Logger.log('Complaint Telegram error: ' + tgErr);
    }

    // Track the email
    try {
      logEmailSent(data.email, data.name, 'complaint-received', data.service || 'complaint', complaintRef, 'Complaint Received — ' + complaintRef);
    } catch(e) {}

    return ContentService.createTextOutput(JSON.stringify({
      status: 'success',
      message: 'Complaint submitted successfully',
      complaintRef: complaintRef
    })).setMimeType(ContentService.MimeType.JSON);

  } catch(e) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: e.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * POST: Resolve a complaint (admin)
 */
function resolveComplaint(data) {
  try {
    var sheet = getComplaintsSheet();
    var rows = sheet.getDataRange().getValues();

    for (var i = 1; i < rows.length; i++) {
      if (rows[i][0] === data.complaintRef) {
        var rowNum = i + 1;

        // Determine resolution value
        var resolutionValue = '';
        var resolutionType = data.resolutionType || '';
        var amountPaid = parseFloat(rows[i][14]) || 0;

        if (resolutionType.startsWith('refund-')) {
          var pct = parseInt(resolutionType.split('-')[1]);
          resolutionValue = '£' + (amountPaid * pct / 100).toFixed(2) + ' (' + pct + '% refund)';
        } else if (resolutionType.startsWith('discount-')) {
          var discPct = resolutionType.split('-')[1];
          resolutionValue = discPct + '% discount on next visit';
        } else if (resolutionType === 'free-visit') {
          resolutionValue = 'Free return visit';
        } else if (resolutionType === 'credit') {
          resolutionValue = '£' + (data.creditAmount || '0') + ' account credit';
        } else if (resolutionType === 'redo') {
          resolutionValue = 'Free redo / return visit';
        } else if (resolutionType === 'apology') {
          resolutionValue = 'Formal apology';
        }

        var resolvedDate = new Date().toLocaleDateString('en-GB');

        // Update sheet
        sheet.getRange(rowNum, 17).setValue('resolved');        // Q - Status
        sheet.getRange(rowNum, 19).setValue(resolutionType);    // S - Resolution type
        sheet.getRange(rowNum, 20).setValue(resolutionValue);   // T - Resolution value
        sheet.getRange(rowNum, 21).setValue(data.resolutionNotes || ''); // U - Resolution notes
        sheet.getRange(rowNum, 22).setValue(resolvedDate);      // V - Resolved date
        sheet.getRange(rowNum, 23).setValue('true');             // W - Resolution flag

        // Email customer with resolution
        if (data.notifyCustomer) {
          try {
            var customerEmail = rows[i][4];
            var customerName = rows[i][3];
            var firstName = (customerName || 'Customer').split(' ')[0];
            var complaintType = rows[i][2];
            var ref = rows[i][0];

            var resHtml = '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:0;background:#f4f7f4;font-family:Arial,sans-serif;">'
              + '<div style="max-width:600px;margin:0 auto;background:#fff;">'
              + '<div style="background:linear-gradient(135deg,#2E7D32,#66BB6A);padding:30px;text-align:center;">'
              + '<h1 style="color:#fff;margin:0;font-size:20px;">✅ Complaint Resolved</h1></div>'
              + '<div style="padding:30px;">'
              + '<h2 style="color:#2E7D32;margin:0 0 10px;">Hi ' + firstName + ',</h2>'
              + '<p style="color:#333;line-height:1.6;">We have reviewed your complaint <strong>' + ref + '</strong> and reached a resolution.</p>'
              + '<div style="background:#E8F5E9;border:2px solid #2E7D32;border-radius:8px;padding:20px;margin:20px 0;">'
              + '<h3 style="color:#2E7D32;margin:0 0 10px;">Resolution</h3>'
              + '<p style="font-size:18px;font-weight:700;color:#2E7D32;margin:0 0 8px;">' + resolutionValue + '</p>'
              + (data.resolutionNotes ? '<p style="color:#555;font-size:13px;margin:0;">' + data.resolutionNotes + '</p>' : '')
              + '</div>';

            if (complaintType === 'subscriber') {
              resHtml += '<p style="color:#555;font-size:13px;">As a valued subscriber, the approved discount will be applied to your next scheduled visit. You don\'t need to do anything else.</p>';
            } else {
              if (resolutionType.startsWith('refund-')) {
                resHtml += '<p style="color:#555;font-size:13px;">Your refund will be processed to your original payment method within 5–10 working days.</p>';
              } else if (resolutionType === 'redo') {
                resHtml += '<p style="color:#555;font-size:13px;">We will contact you to arrange a convenient time for the return visit.</p>';
              }
            }

            resHtml += '<p style="color:#555;font-size:13px;">If you have any questions about this resolution, please call <strong>01726 432051</strong>.</p>'
              + '</div>'
              + '<div style="background:#333;padding:20px;text-align:center;">'
              + '<p style="color:#aaa;font-size:12px;margin:0;">Gardners Ground Maintenance | 01726 432051 | info@gardnersgm.co.uk</p></div>'
              + '</div></body></html>';

            sendEmail({
              to: customerEmail,
              toName: '',
              subject: '✅ Complaint Resolved — ' + ref + ' | Gardners GM',
              htmlBody: resHtml,
              name: 'Gardners Ground Maintenance',
              replyTo: 'info@gardnersgm.co.uk'
            });

            logEmailSent(customerEmail, customerName, 'complaint-resolved', resolutionType, ref, 'Complaint Resolved — ' + ref);
          } catch(emailErr) {
            Logger.log('Resolution email error: ' + emailErr);
          }
        }

        // Telegram
        try {
          notifyTelegram('✅ *COMPLAINT RESOLVED*\n\n📋 ' + data.complaintRef + '\n👤 ' + rows[i][3] + '\n🎯 ' + resolutionValue + '\n📝 ' + (data.resolutionNotes || 'No notes'));
        } catch(e) {}

        return ContentService.createTextOutput(JSON.stringify({ status: 'success', message: 'Complaint resolved' }))
          .setMimeType(ContentService.MimeType.JSON);
      }
    }

    return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: 'Complaint not found' }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch(e) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: e.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * POST: Update complaint status
 */
function updateComplaintStatus(data) {
  try {
    var sheet = getComplaintsSheet();
    var rows = sheet.getDataRange().getValues();

    for (var i = 1; i < rows.length; i++) {
      if (rows[i][0] === data.complaintRef) {
        sheet.getRange(i + 1, 17).setValue(data.status);
        return ContentService.createTextOutput(JSON.stringify({ status: 'success', message: 'Status updated' }))
          .setMimeType(ContentService.MimeType.JSON);
      }
    }

    return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: 'Complaint not found' }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch(e) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: e.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * POST: Update admin notes on a complaint
 */
function updateComplaintNotes(data) {
  try {
    var sheet = getComplaintsSheet();
    var rows = sheet.getDataRange().getValues();

    for (var i = 1; i < rows.length; i++) {
      if (rows[i][0] === data.complaintRef) {
        sheet.getRange(i + 1, 18).setValue(data.notes || '');
        return ContentService.createTextOutput(JSON.stringify({ status: 'success', message: 'Notes saved' }))
          .setMimeType(ContentService.MimeType.JSON);
      }
    }

    return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: 'Complaint not found' }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch(e) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: e.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}


// ============================================
// ALLOCATION CONFIG — BANK ACCOUNT SPLIT
// ============================================

var ALLOC_CONFIG_SHEET_NAME = 'AllocationConfig';

function getAllocConfigSheet() {
  var ss = SpreadsheetApp.openById('1_Y7yHIpAvv_VNBhTrwNOQaBMAGa3UlVW_FKlf56ouHk');
  var sheet = ss.getSheetByName(ALLOC_CONFIG_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(ALLOC_CONFIG_SHEET_NAME);
    sheet.getRange('A1:B1').setValues([['Key', 'Value']]);
    // Set defaults
    sheet.getRange('A2:B6').setValues([
      ['taxReserve', 20],
      ['niReserve', 6],
      ['emergencyFund', 5],
      ['equipmentFund', 5],
      ['operatingFloat', 10]
    ]);
  }
  return sheet;
}

function getAllocConfig() {
  try {
    var sheet = getAllocConfigSheet();
    var data = sheet.getDataRange().getValues();
    var config = {};
    for (var i = 1; i < data.length; i++) {
      if (data[i][0]) {
        config[data[i][0]] = parseFloat(data[i][1]) || 0;
      }
    }
    return ContentService.createTextOutput(JSON.stringify({
      status: 'success',
      config: config
    })).setMimeType(ContentService.MimeType.JSON);
  } catch(e) {
    return ContentService.createTextOutput(JSON.stringify({
      status: 'error',
      message: e.message
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

function saveAllocConfig(data) {
  try {
    var sheet = getAllocConfigSheet();
    var keys = ['taxReserve', 'niReserve', 'emergencyFund', 'equipmentFund', 'operatingFloat'];
    
    // Clear existing data below header
    if (sheet.getLastRow() > 1) {
      sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).clearContent();
    }
    
    // Write new values
    var values = keys.map(function(k) {
      return [k, parseFloat(data[k]) || 0];
    });
    sheet.getRange(2, 1, values.length, 2).setValues(values);
    
    return ContentService.createTextOutput(JSON.stringify({
      status: 'success',
      message: 'Allocation config saved'
    })).setMimeType(ContentService.MimeType.JSON);
  } catch(e) {
    return ContentService.createTextOutput(JSON.stringify({
      status: 'error',
      message: e.message
    })).setMimeType(ContentService.MimeType.JSON);
  }
}


// ============================================
// SMART WEATHER ALERT SYSTEM
// Auto-checks Met Office warnings for Cornwall,
// cancels affected jobs, emails customers with
// reschedule options, alerts Chris via Telegram
// ============================================

var METOFFICE_API_KEY = ''; // Set your Met Office DataPoint API key here (free at https://www.metoffice.gov.uk/services/data/datapoint)
var OPENWEATHER_API_KEY = ''; // OR set OpenWeatherMap key (free at https://openweathermap.org/api)
var WEATHER_LAT = 50.3942; // PL26 8HN approximate lat
var WEATHER_LON = -4.8386; // PL26 8HN approximate lon
var WEATHER_LOCATION = 'Roche, Cornwall';

/**
 * Main weather check — run daily at 6pm via time-driven trigger
 * Checks tomorrow + day-after weather, auto-cancels if severe
 */
function checkWeatherAndAlert() {
  try {
    var forecast = fetchWeatherForecast();
    if (!forecast || !forecast.daily || forecast.daily.length === 0) {
      Logger.log('Weather: No forecast data received');
      return;
    }
    
    // Check tomorrow and day after
    var tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    var tomorrowISO = Utilities.formatDate(tomorrow, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    
    var dayAfter = new Date();
    dayAfter.setDate(dayAfter.getDate() + 2);
    var dayAfterISO = Utilities.formatDate(dayAfter, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    
    var alerts = [];
    
    // ── Check local forecast (Roche-specific) ──
    for (var d = 0; d < forecast.daily.length && d < 3; d++) {
      var day = forecast.daily[d];
      var dateISO = day.dateISO;
      if (dateISO !== tomorrowISO && dateISO !== dayAfterISO) continue;
      
      var severity = assessWeatherSeverity(day);
      if (severity.shouldCancel) {
        alerts.push({
          date: dateISO,
          severity: severity.level,
          reasons: severity.reasons,
          summary: severity.summary,
          weather: day,
          source: 'local-forecast'
        });
      }
    }
    
    // ── Check Met Office national/regional warnings (named storms, amber/red) ──
    var metWarnings = forecast.metOfficeWarnings || [];
    var activeMetWarnings = metWarnings.filter(function(w) { return w.shouldCancel; });
    
    if (activeMetWarnings.length > 0) {
      // National warnings can override local forecast for BOTH days
      var datesAlreadyAlerted = alerts.map(function(a) { return a.date; });
      var checkDates = [tomorrowISO, dayAfterISO];
      
      for (var cd = 0; cd < checkDates.length; cd++) {
        if (datesAlreadyAlerted.indexOf(checkDates[cd]) >= 0) {
          // Already alerting — just enrich with storm name
          for (var ea = 0; ea < alerts.length; ea++) {
            if (alerts[ea].date === checkDates[cd]) {
              for (var mw = 0; mw < activeMetWarnings.length; mw++) {
                var stormLabel = activeMetWarnings[mw].stormName 
                  ? '🌀 Storm ' + activeMetWarnings[mw].stormName + ' — ' 
                  : '⚠️ Met Office ' + activeMetWarnings[mw].severity.toUpperCase() + ' warning — ';
                if (alerts[ea].summary.indexOf(stormLabel) < 0) {
                  alerts[ea].summary = stormLabel + activeMetWarnings[mw].title + '; ' + alerts[ea].summary;
                  alerts[ea].reasons.unshift(stormLabel + activeMetWarnings[mw].title);
                }
              }
            }
          }
        } else {
          // Local forecast didn't trigger but national warning says cancel
          var warningReasons = activeMetWarnings.map(function(w) {
            return (w.stormName ? '🌀 Storm ' + w.stormName + ': ' : 'Met Office ' + w.severity.toUpperCase() + ': ') + w.title;
          });
          alerts.push({
            date: checkDates[cd],
            severity: 'cancel',
            reasons: warningReasons,
            summary: warningReasons.join('; '),
            weather: null,
            source: 'met-office-warning'
          });
        }
      }
    }
    
    // ── Build Telegram status ──
    var metWarningNote = '';
    if (metWarnings.length > 0) {
      metWarningNote = '\n\n🏴 *Met Office Warnings (' + metWarnings.length + ' active):*';
      for (var mi = 0; mi < metWarnings.length; mi++) {
        var mIcon = metWarnings[mi].severity === 'red' ? '🔴' : metWarnings[mi].severity === 'amber' ? '🟠' : '🟡';
        metWarningNote += '\n  ' + mIcon + ' ' + metWarnings[mi].title;
        if (metWarnings[mi].stormName) metWarningNote += ' 🌀 *Storm ' + metWarnings[mi].stormName + '*';
      }
    }
    
    if (alerts.length === 0) {
      // Good weather — send brief Telegram confirmation
      var tmrw = forecast.daily.length > 0 ? forecast.daily[0] : null;
      if (tmrw && tmrw.dateISO === tomorrowISO) {
        notifyTelegram('☀️ *Weather Check — All Clear*\n\n📅 Tomorrow (' + tomorrowISO + ')\n🌡️ ' + tmrw.tempMax + '°C / ' + tmrw.tempMin + '°C\n💨 Wind: ' + tmrw.windSpeed + 'mph\n🌧️ Rain: ' + tmrw.rainChance + '%' + metWarningNote + '\n\n✅ No cancellations needed');
      }
      Logger.log('Weather check: All clear, no cancellations');
      return;
    }
    
    // Process each alert day
    for (var a = 0; a < alerts.length; a++) {
      processWeatherCancellations(alerts[a]);
    }
    
  } catch(e) {
    Logger.log('Weather check error: ' + e.message);
    notifyTelegram('⚠️ *Weather System Error*\n\n' + e.message + '\n\nPlease check jobs manually.');
  }
}


/**
 * Fetch weather forecast + Met Office national warnings
 * Returns normalised forecast object with daily array + national warnings
 */
function fetchWeatherForecast() {
  var forecast;
  // Try OpenWeatherMap first (most reliable free tier)
  if (OPENWEATHER_API_KEY) {
    forecast = fetchOpenWeatherForecast();
  } else {
    // Fallback: Open-Meteo (no API key needed — totally free)
    forecast = fetchOpenMeteoForecast();
  }
  
  // Always check Met Office national warnings (storms, amber/red alerts)
  try {
    var metWarnings = fetchMetOfficeWarnings();
    if (forecast) {
      forecast.metOfficeWarnings = metWarnings;
    }
  } catch(e) {
    Logger.log('Met Office warnings fetch skipped: ' + e.message);
    if (forecast) forecast.metOfficeWarnings = [];
  }
  
  return forecast;
}


/**
 * Fetch Met Office national weather warnings for SW England
 * Uses the public Met Office RSS feed — no API key needed
 * Catches named storms, amber/red warnings that local forecasts may miss
 */
function fetchMetOfficeWarnings() {
  var warnings = [];
  
  try {
    // Met Office public warnings RSS for South West England
    var rssUrl = 'https://www.metoffice.gov.uk/public/data/PWSCache/WarningsRSS/Region/sw';
    var response = UrlFetchApp.fetch(rssUrl, { muteHttpExceptions: true });
    var xml = response.getContentText();
    
    // Parse RSS items
    var itemRegex = /<item>([\s\S]*?)<\/item>/g;
    var match;
    while ((match = itemRegex.exec(xml)) !== null) {
      var itemXml = match[1];
      var title = (itemXml.match(/<title>([^<]*)<\/title>/) || [])[1] || '';
      var desc = (itemXml.match(/<description>([^<]*)<\/description>/) || [])[1] || '';
      var link = (itemXml.match(/<link>([^<]*)<\/link>/) || [])[1] || '';
      var pubDate = (itemXml.match(/<pubDate>([^<]*)<\/pubDate>/) || [])[1] || '';
      
      if (!title) continue;
      
      // Determine severity from title (Yellow / Amber / Red)
      var severity = 'yellow';
      var titleLower = title.toLowerCase();
      if (titleLower.indexOf('red') >= 0) severity = 'red';
      else if (titleLower.indexOf('amber') >= 0) severity = 'amber';
      
      // Detect named storms
      var stormName = '';
      var stormMatch = title.match(/storm\s+(\w+)/i) || desc.match(/storm\s+(\w+)/i);
      if (stormMatch) stormName = stormMatch[1];
      
      // Detect warning type (wind, rain, snow, ice, thunderstorm, fog)
      var warningType = 'general';
      if (titleLower.indexOf('wind') >= 0) warningType = 'wind';
      else if (titleLower.indexOf('rain') >= 0) warningType = 'rain';
      else if (titleLower.indexOf('snow') >= 0 || titleLower.indexOf('ice') >= 0) warningType = 'snow-ice';
      else if (titleLower.indexOf('thunder') >= 0 || titleLower.indexOf('lightning') >= 0) warningType = 'thunderstorm';
      else if (titleLower.indexOf('fog') >= 0) warningType = 'fog';
      
      // Try to extract valid dates from description
      var validFrom = '';
      var validTo = '';
      var fromMatch = desc.match(/valid from[:\s]*(\d{4}\s+\w+\s+on\s+\w+day\s+\d+\s+\w+\s+\d+|[\d\/:\-\s]+\w+day)/i);
      var toMatch = desc.match(/valid to[:\s]*(\d{4}\s+\w+\s+on\s+\w+day\s+\d+\s+\w+\s+\d+|[\d\/:\-\s]+\w+day)/i);
      if (fromMatch) validFrom = fromMatch[1].trim();
      if (toMatch) validTo = toMatch[1].trim();
      
      warnings.push({
        title: title,
        description: desc,
        severity: severity,
        warningType: warningType,
        stormName: stormName,
        validFrom: validFrom,
        validTo: validTo,
        link: link,
        pubDate: pubDate,
        shouldCancel: severity === 'red' || severity === 'amber' || (severity === 'yellow' && (warningType === 'wind' || warningType === 'snow-ice' || warningType === 'thunderstorm'))
      });
    }
  } catch(e) {
    Logger.log('Met Office RSS parse error: ' + e.message);
    // Fallback: try scraping the JSON warnings endpoint
    try {
      var jsonUrl = 'https://www.metoffice.gov.uk/weather/warnings-and-advice/uk-warnings';
      // Can't reliably parse HTML, so just log and continue
      Logger.log('Met Office RSS unavailable, skipping national warnings');
    } catch(e2) {}
  }
  
  return warnings;
}


/**
 * Open-Meteo: Free, no API key, excellent for UK weather
 */
function fetchOpenMeteoForecast() {
  var url = 'https://api.open-meteo.com/v1/forecast'
    + '?latitude=' + WEATHER_LAT
    + '&longitude=' + WEATHER_LON
    + '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max,uv_index_max'
    + '&wind_speed_unit=mph'
    + '&timezone=Europe/London'
    + '&forecast_days=3';
  
  var response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  var json = JSON.parse(response.getContentText());
  
  if (!json.daily) return null;
  
  var daily = [];
  for (var i = 0; i < json.daily.time.length; i++) {
    daily.push({
      dateISO: json.daily.time[i],
      tempMax: json.daily.temperature_2m_max[i],
      tempMin: json.daily.temperature_2m_min[i],
      rainMM: json.daily.precipitation_sum[i] || 0,
      rainChance: json.daily.precipitation_probability_max[i] || 0,
      windSpeed: json.daily.wind_speed_10m_max[i] || 0,
      windGust: json.daily.wind_gusts_10m_max[i] || 0,
      weatherCode: json.daily.weather_code[i],
      uvIndex: json.daily.uv_index_max[i] || 0,
      description: describeWeatherCode(json.daily.weather_code[i])
    });
  }
  
  return { source: 'Open-Meteo', daily: daily };
}


/**
 * OpenWeatherMap: Requires free API key, good detail
 */
function fetchOpenWeatherForecast() {
  var url = 'https://api.openweathermap.org/data/3.0/onecall'
    + '?lat=' + WEATHER_LAT + '&lon=' + WEATHER_LON
    + '&exclude=minutely,hourly&units=metric'
    + '&appid=' + OPENWEATHER_API_KEY;
  
  var response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  var json = JSON.parse(response.getContentText());
  
  if (!json.daily) return null;
  
  var daily = [];
  for (var i = 0; i < Math.min(json.daily.length, 3); i++) {
    var d = json.daily[i];
    var dt = new Date(d.dt * 1000);
    daily.push({
      dateISO: Utilities.formatDate(dt, Session.getScriptTimeZone(), 'yyyy-MM-dd'),
      tempMax: d.temp.max,
      tempMin: d.temp.min,
      rainMM: d.rain || 0,
      rainChance: Math.round((d.pop || 0) * 100),
      windSpeed: Math.round((d.wind_speed || 0) * 2.237), // m/s to mph
      windGust: Math.round((d.wind_gust || 0) * 2.237),
      weatherCode: d.weather[0] ? d.weather[0].id : 800,
      uvIndex: d.uvi || 0,
      description: d.weather[0] ? d.weather[0].description : 'clear'
    });
  }
  
  // Check for alerts
  var owmAlerts = [];
  if (json.alerts) {
    for (var a = 0; a < json.alerts.length; a++) {
      owmAlerts.push({
        event: json.alerts[a].event,
        description: json.alerts[a].description,
        start: new Date(json.alerts[a].start * 1000),
        end: new Date(json.alerts[a].end * 1000)
      });
    }
  }
  
  return { source: 'OpenWeatherMap', daily: daily, alerts: owmAlerts };
}


/**
 * Convert WMO weather code to human-readable description
 */
function describeWeatherCode(code) {
  var codes = {
    0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
    45: 'Foggy', 48: 'Icing fog',
    51: 'Light drizzle', 53: 'Moderate drizzle', 55: 'Dense drizzle',
    56: 'Freezing drizzle', 57: 'Heavy freezing drizzle',
    61: 'Slight rain', 63: 'Moderate rain', 65: 'Heavy rain',
    66: 'Freezing rain', 67: 'Heavy freezing rain',
    71: 'Slight snow', 73: 'Moderate snow', 75: 'Heavy snow',
    77: 'Snow grains', 80: 'Slight showers', 81: 'Moderate showers', 82: 'Violent showers',
    85: 'Slight snow showers', 86: 'Heavy snow showers',
    95: 'Thunderstorm', 96: 'Thunderstorm + light hail', 99: 'Thunderstorm + heavy hail'
  };
  return codes[code] || 'Unknown (' + code + ')';
}


/**
 * Assess weather severity — decide if gardening is unsafe/impractical
 * Returns: { shouldCancel, level, reasons[], summary }
 */
function assessWeatherSeverity(day) {
  var reasons = [];
  var level = 'ok'; // ok → advisory → cancel
  
  // Heavy rain (>10mm = impractical, >20mm = dangerous ground conditions)
  if (day.rainMM >= 20) {
    reasons.push('Very heavy rain expected (' + day.rainMM + 'mm)');
    level = 'cancel';
  } else if (day.rainMM >= 10) {
    reasons.push('Heavy rain expected (' + day.rainMM + 'mm)');
    if (level !== 'cancel') level = 'cancel';
  } else if (day.rainMM >= 5 && day.rainChance >= 80) {
    reasons.push('Sustained rain likely (' + day.rainMM + 'mm, ' + day.rainChance + '% chance)');
    if (level !== 'cancel') level = 'advisory';
  }
  
  // High winds (>40mph gusts = dangerous for machinery, >30mph = difficult)
  if (day.windGust >= 50) {
    reasons.push('Dangerous wind gusts (' + day.windGust + 'mph)');
    level = 'cancel';
  } else if (day.windGust >= 40) {
    reasons.push('Very strong wind gusts (' + day.windGust + 'mph)');
    level = 'cancel';
  } else if (day.windSpeed >= 30) {
    reasons.push('Strong sustained winds (' + day.windSpeed + 'mph)');
    if (level !== 'cancel') level = 'cancel';
  }
  
  // Snow/ice
  if (day.weatherCode >= 71 && day.weatherCode <= 77) {
    reasons.push('Snow expected — unsafe ground conditions');
    level = 'cancel';
  }
  if (day.weatherCode === 56 || day.weatherCode === 57 || day.weatherCode === 66 || day.weatherCode === 67) {
    reasons.push('Freezing rain/ice expected');
    level = 'cancel';
  }
  
  // Thunderstorms
  if (day.weatherCode >= 95) {
    reasons.push('Thunderstorms forecast — unsafe for outdoor work');
    level = 'cancel';
  }
  
  // Extreme cold (sub-zero = frozen ground, can't mow/dig)
  if (day.tempMax <= 2) {
    reasons.push('Near-freezing temperatures (' + day.tempMax + '°C max)');
    if (level !== 'cancel') level = 'cancel';
  }
  
  // Very heavy rain probability alone (>90% + moderate rainfall)
  if (day.rainChance >= 90 && day.rainMM >= 8) {
    if (reasons.length === 0) reasons.push('Rain almost certain (' + day.rainChance + '%, ' + day.rainMM + 'mm)');
    if (level !== 'cancel') level = 'cancel';
  }
  
  // Violent showers
  if (day.weatherCode === 82) {
    if (reasons.indexOf('Violent showers expected') < 0) reasons.push('Violent showers expected');
    level = 'cancel';
  }
  
  var summary = reasons.length > 0 ? reasons.join('; ') : 'Weather suitable for gardening';
  
  return {
    shouldCancel: level === 'cancel',
    isAdvisory: level === 'advisory',
    level: level,
    reasons: reasons,
    summary: summary
  };
}


/**
 * Process weather cancellations for a specific date
 * Finds all affected jobs + schedule visits, auto-cancels, emails + Telegram
 */
function processWeatherCancellations(alert) {
  var ss = SpreadsheetApp.openById('1_Y7yHIpAvv_VNBhTrwNOQaBMAGa3UlVW_FKlf56ouHk');
  var jobsSheet = ss.getSheetByName('Jobs');
  var schedSheet = ss.getSheetByName('Schedule');
  var dateStr = alert.date;
  
  var affectedJobs = [];
  var affectedSchedule = [];
  
  // ── Check Jobs sheet ──
  var jobsData = jobsSheet.getDataRange().getValues();
  for (var i = 1; i < jobsData.length; i++) {
    var status = String(jobsData[i][11] || '').toLowerCase().trim();
    if (status === 'cancelled' || status === 'canceled' || status === 'completed' || status === 'job completed' || status === 'weather-cancelled') continue;
    
    var jobDate = normaliseDateToISO(jobsData[i][8]);
    if (jobDate === dateStr) {
      affectedJobs.push({
        rowIndex: i + 1,
        sheet: 'Jobs',
        name: String(jobsData[i][2] || ''),
        email: String(jobsData[i][3] || ''),
        phone: String(jobsData[i][4] || ''),
        address: String(jobsData[i][5] || ''),
        postcode: String(jobsData[i][6] || ''),
        service: String(jobsData[i][7] || ''),
        date: jobDate,
        time: String(jobsData[i][9] || ''),
        price: String(jobsData[i][12] || ''),
        jobNumber: String(jobsData[i][19] || ''),
        notes: String(jobsData[i][16] || '')
      });
    }
  }
  
  // ── Check Schedule sheet (subscription visits) ──
  if (schedSheet) {
    var schedData = schedSheet.getDataRange().getValues();
    for (var j = 1; j < schedData.length; j++) {
      var schedStatus = String(schedData[j][9] || '').toLowerCase().trim();
      if (schedStatus === 'cancelled' || schedStatus === 'canceled' || schedStatus === 'completed' || schedStatus === 'weather-cancelled') continue;
      
      var visitDate = normaliseDateToISO(schedData[j][0]);
      if (visitDate === dateStr) {
        affectedSchedule.push({
          rowIndex: j + 1,
          sheet: 'Schedule',
          name: String(schedData[j][1] || ''),
          email: String(schedData[j][2] || ''),
          phone: String(schedData[j][3] || ''),
          address: String(schedData[j][4] || ''),
          postcode: String(schedData[j][5] || ''),
          service: String(schedData[j][6] || ''),
          package: String(schedData[j][7] || ''),
          date: visitDate,
          parentJob: String(schedData[j][10] || ''),
          notes: String(schedData[j][14] || '')
        });
      }
    }
  }
  
  var totalAffected = affectedJobs.length + affectedSchedule.length;
  
  if (totalAffected === 0) {
    notifyTelegram('⛈️ *Weather Warning — No Jobs Affected*\n\n📅 ' + dateStr + '\n⚠️ ' + alert.summary + '\n\n✅ No bookings on this date');
    Logger.log('Weather alert for ' + dateStr + ' but no jobs affected');
    return;
  }
  
  // ── Generate rescue dates (next 10 days of good weather) ──
  var rescueDates = findGoodWeatherDates(dateStr, 10);
  
  // ── Process each affected one-off job ──
  for (var k = 0; k < affectedJobs.length; k++) {
    var job = affectedJobs[k];
    
    // Mark as weather-cancelled in sheet
    jobsSheet.getRange(job.rowIndex, 12).setValue('Weather-Cancelled');
    jobsSheet.getRange(job.rowIndex, 17).setValue((job.notes ? job.notes + ' | ' : '') + 'Weather-cancelled ' + dateStr + ': ' + alert.summary);
    
    // Remove calendar event
    try { removeCalendarEvent(job.jobNumber || (job.name + ' ' + job.service)); } catch(e) {}
    
    // Find available alternative slots for this service
    var svcKey = job.service.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    var alternatives = findAlternativeSlotsForWeather(svcKey, dateStr, rescueDates);
    
    // Email customer with reschedule options
    if (job.email) {
      sendWeatherCancellationEmail({
        name: job.name,
        email: job.email,
        service: job.service,
        date: job.date,
        time: job.time,
        jobNumber: job.jobNumber,
        price: job.price,
        weatherSummary: alert.summary,
        alternatives: alternatives,
        sheet: 'Jobs'
      });
    }
  }
  
  // ── Process each affected subscription visit ──
  for (var m = 0; m < affectedSchedule.length; m++) {
    var visit = affectedSchedule[m];
    
    // Mark as weather-cancelled in schedule
    schedSheet.getRange(visit.rowIndex, 10).setValue('Weather-Cancelled');
    schedSheet.getRange(visit.rowIndex, 15).setValue((visit.notes ? visit.notes + ' | ' : '') + 'Weather-cancelled: ' + alert.summary);
    
    // Find alternatives
    var visitSvcKey = visit.service.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    var visitAlts = findAlternativeSlotsForWeather(visitSvcKey, dateStr, rescueDates);
    
    // Email customer
    if (visit.email) {
      sendWeatherCancellationEmail({
        name: visit.name,
        email: visit.email,
        service: visit.service + (visit.package ? ' (' + visit.package + ')' : ''),
        date: visit.date,
        time: '',
        jobNumber: visit.parentJob,
        price: '',
        weatherSummary: alert.summary,
        alternatives: visitAlts,
        sheet: 'Schedule',
        isSubscription: true
      });
    }
  }
  
  // ── Log to Weather Log sheet ──
  logWeatherEvent(alert, affectedJobs, affectedSchedule);
  
  // ── Telegram summary ──
  var tgMsg = '⛈️ *WEATHER AUTO-CANCEL*\n\n'
    + '📅 *' + dateStr + '*\n'
    + '⚠️ ' + alert.summary + '\n\n'
    + '🔴 *' + totalAffected + ' job(s) cancelled:*\n';
  
  for (var tj = 0; tj < affectedJobs.length; tj++) {
    tgMsg += '  • ' + affectedJobs[tj].name + ' — ' + affectedJobs[tj].service + ' (' + affectedJobs[tj].jobNumber + ')\n';
  }
  for (var ts = 0; ts < affectedSchedule.length; ts++) {
    tgMsg += '  • ' + affectedSchedule[ts].name + ' — ' + affectedSchedule[ts].service + ' (subscription)\n';
  }
  
  tgMsg += '\n📧 Reschedule emails sent to all affected customers\n'
    + '📋 Jobs marked as "Weather-Cancelled"';
  
  notifyTelegram(tgMsg);
}


/**
 * Find good weather dates for rescheduling (skip bad weather days)
 */
function findGoodWeatherDates(fromDate, maxDays) {
  var goodDates = [];
  var start = new Date(fromDate + 'T12:00:00');
  
  // Fetch extended forecast
  var url = 'https://api.open-meteo.com/v1/forecast'
    + '?latitude=' + WEATHER_LAT
    + '&longitude=' + WEATHER_LON
    + '&daily=weather_code,temperature_2m_max,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max'
    + '&wind_speed_unit=mph'
    + '&timezone=Europe/London'
    + '&forecast_days=14';
  
  try {
    var response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    var json = JSON.parse(response.getContentText());
    
    if (json.daily) {
      for (var i = 0; i < json.daily.time.length && goodDates.length < maxDays; i++) {
        var d = json.daily.time[i];
        if (d <= fromDate) continue; // skip past dates and the cancelled date
        
        var checkDate = new Date(d + 'T12:00:00');
        if (checkDate.getDay() === 0) continue; // skip Sundays
        
        var dayData = {
          rainMM: json.daily.precipitation_sum[i] || 0,
          rainChance: json.daily.precipitation_probability_max[i] || 0,
          windSpeed: json.daily.wind_speed_10m_max[i] || 0,
          windGust: json.daily.wind_gusts_10m_max[i] || 0,
          weatherCode: json.daily.weather_code[i],
          tempMax: json.daily.temperature_2m_max[i]
        };
        
        var severity = assessWeatherSeverity(dayData);
        if (!severity.shouldCancel) {
          goodDates.push({
            dateISO: d,
            dayName: ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][checkDate.getDay()],
            weather: dayData,
            description: describeWeatherCode(dayData.weatherCode)
          });
        }
      }
    }
  } catch(e) {
    Logger.log('findGoodWeatherDates error: ' + e.message);
    // Fallback: just return next working days
    for (var f = 1; f <= 14 && goodDates.length < maxDays; f++) {
      var fallbackDate = new Date(start.getTime() + f * 86400000);
      if (fallbackDate.getDay() === 0) continue;
      goodDates.push({
        dateISO: Utilities.formatDate(fallbackDate, Session.getScriptTimeZone(), 'yyyy-MM-dd'),
        dayName: ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][fallbackDate.getDay()],
        weather: null,
        description: 'Forecast unavailable'
      });
    }
  }
  
  return goodDates;
}


/**
 * Find available alternative slots on good-weather dates for a specific service
 */
function findAlternativeSlotsForWeather(serviceKey, cancelledDate, goodWeatherDates) {
  var alternatives = [];
  
  for (var i = 0; i < goodWeatherDates.length && alternatives.length < 5; i++) {
    var gd = goodWeatherDates[i];
    
    try {
      var result = JSON.parse(checkAvailability({ date: gd.dateISO, service: serviceKey }).getContent());
      if (result.fullDayBooked) continue;
      
      // Find first available slot
      var slots = ['09:00 - 10:00', '10:00 - 11:00', '11:00 - 12:00', '13:00 - 14:00', '14:00 - 15:00'];
      for (var s = 0; s < slots.length && alternatives.length < 5; s++) {
        var slotCheck = JSON.parse(checkAvailability({ date: gd.dateISO, time: slots[s], service: serviceKey }).getContent());
        if (slotCheck.available) {
          alternatives.push({
            date: gd.dateISO,
            time: slots[s],
            dayName: gd.dayName,
            display: gd.dayName + ' ' + gd.dateISO.substring(8) + '/' + gd.dateISO.substring(5,7) + ' at ' + slots[s].split(' - ')[0],
            weatherNote: gd.description || 'Fair weather expected'
          });
          break; // One slot per day is enough
        }
      }
    } catch(e) {
      Logger.log('Slot check error for ' + gd.dateISO + ': ' + e.message);
    }
  }
  
  return alternatives;
}


/**
 * Weather cancellation email — branded, with clickable reschedule options
 */
function sendWeatherCancellationEmail(data) {
  if (!data.email) return;
  var firstName = (data.name || 'Customer').split(' ')[0];
  var svc = getServiceContent(data.service);
  var svcIcon = svc ? svc.icon : '🌿';
  var svcName = svc ? svc.name : (data.service || 'your service');
  
  var subject = '🌧️ Weather Cancellation — ' + svcName + ' on ' + (data.date || 'upcoming');
  
  // Build alternatives HTML
  var altHtml = '';
  if (data.alternatives && data.alternatives.length > 0) {
    altHtml = '<div style="background:#E8F5E9;border:1px solid #A5D6A7;border-radius:8px;overflow:hidden;margin:20px 0;">'
      + '<div style="background:#2E7D32;padding:12px 15px;"><h3 style="color:#fff;margin:0;font-size:15px;">📅 Available Reschedule Dates</h3></div>'
      + '<div style="padding:15px;">'
      + '<p style="color:#555;font-size:13px;margin:0 0 12px;">We\'ve checked the weather forecast and availability — pick a new date that works for you:</p>';
    
    for (var i = 0; i < data.alternatives.length; i++) {
      var alt = data.alternatives[i];
      var rescheduleUrl = 'https://gardnersgm.co.uk/cancel.html?action=weather_reschedule'
        + '&email=' + encodeURIComponent(data.email)
        + '&job=' + encodeURIComponent(data.jobNumber || '')
        + '&newDate=' + encodeURIComponent(alt.date)
        + '&newTime=' + encodeURIComponent(alt.time)
        + '&sheet=' + encodeURIComponent(data.sheet || 'Jobs');
      
      altHtml += '<a href="' + rescheduleUrl + '" style="display:block;background:#fff;border:1px solid #C8E6C9;border-radius:6px;padding:12px 15px;margin:8px 0;text-decoration:none;color:#333;">'
        + '<div style="display:flex;justify-content:space-between;align-items:center;">'
        + '<div>'
        + '<strong style="color:#2E7D32;font-size:15px;">' + alt.display + '</strong><br>'
        + '<span style="color:#888;font-size:12px;">⛅ ' + (alt.weatherNote || 'Fair weather') + '</span>'
        + '</div>'
        + '<span style="background:#2E7D32;color:#fff;padding:6px 14px;border-radius:4px;font-size:13px;font-weight:600;white-space:nowrap;">Book This →</span>'
        + '</div></a>';
    }
    
    altHtml += '</div></div>';
  } else {
    altHtml = '<div style="background:#FFF3E0;border:1px solid #FFE0B2;border-radius:8px;padding:15px;margin:20px 0;">'
      + '<p style="color:#E65100;font-weight:600;margin:0 0 5px;">📞 Give us a call to rebook</p>'
      + '<p style="color:#555;font-size:13px;margin:0;">Please call us on <strong>01726 432051</strong> or email <a href="mailto:info@gardnersgm.co.uk">info@gardnersgm.co.uk</a> and we\'ll get you rebooked as soon as the weather improves.</p>'
      + '</div>';
  }
  
  var html = '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:0;background:#f4f7f4;font-family:Arial,Helvetica,sans-serif;">'
    + '<div style="max-width:600px;margin:0 auto;background:#ffffff;">'
    // Header — storm theme
    + '<div style="background:linear-gradient(135deg,#37474F,#546E7A);padding:30px;text-align:center;">'
    + '<h1 style="color:#fff;margin:0;font-size:22px;">🌧️ Weather Cancellation</h1>'
    + '<p style="color:rgba(255,255,255,0.9);margin:8px 0 0;font-size:13px;">Gardners Ground Maintenance</p>'
    + '</div>'
    + '<div style="padding:30px;">'
    + '<h2 style="color:#333;margin:0 0 10px;">Hi ' + firstName + ',</h2>'
    + '<p style="color:#555;line-height:1.6;">Unfortunately, we\'ve had to cancel your <strong>' + svcName + '</strong> appointment due to severe weather conditions. Your safety and the quality of our work are our top priorities.</p>'
    // Weather warning box
    + '<div style="background:#FFF3E0;border-left:4px solid #FF9800;border-radius:4px;padding:15px;margin:20px 0;">'
    + '<p style="color:#E65100;font-weight:700;margin:0 0 5px;">⚠️ Weather Warning — ' + (data.date || '') + '</p>'
    + '<p style="color:#555;margin:0;font-size:14px;">' + (data.weatherSummary || 'Severe weather conditions expected') + '</p>'
    + '</div>'
    // Cancelled booking details
    + '<div style="background:#FFEBEE;border:1px solid #EF9A9A;border-radius:8px;overflow:hidden;margin:20px 0;">'
    + '<div style="background:#C62828;padding:10px 15px;"><h3 style="color:#fff;margin:0;font-size:15px;">❌ Cancelled Appointment</h3></div>'
    + '<table style="width:100%;border-collapse:collapse;">'
    + (data.jobNumber ? '<tr><td style="padding:8px 15px;color:#666;font-weight:600;width:130px;">Reference</td><td style="padding:8px 15px;">' + data.jobNumber + '</td></tr>' : '')
    + '<tr style="background:#FFF5F5;"><td style="padding:8px 15px;color:#666;font-weight:600;">Service</td><td style="padding:8px 15px;">' + svcIcon + ' ' + svcName + '</td></tr>'
    + '<tr><td style="padding:8px 15px;color:#666;font-weight:600;">Original Date</td><td style="padding:8px 15px;text-decoration:line-through;color:#999;">' + (data.date || '') + (data.time ? ' at ' + data.time : '') + '</td></tr>'
    + (data.price ? '<tr style="background:#FFF5F5;"><td style="padding:8px 15px;color:#666;font-weight:600;">Amount</td><td style="padding:8px 15px;">No charge — we\'ll honour the original price</td></tr>' : '')
    + '</table></div>'
    // No payment taken / refund note
    + '<div style="background:#E3F2FD;border:1px solid #90CAF9;border-radius:8px;padding:15px;margin:20px 0;">'
    + '<p style="color:#1565C0;font-weight:600;margin:0 0 5px;">💰 Payment Not Affected</p>'
    + '<p style="color:#555;font-size:13px;margin:0;">'
    + (data.isSubscription 
      ? 'Your subscription continues as normal. This visit will be rescheduled at no extra cost.' 
      : 'Any payment will be held and applied to your rescheduled date. If you\'d prefer a full refund, just let us know.')
    + '</p></div>'
    // Reschedule alternatives
    + altHtml
    // Manual contact fallback
    + '<p style="color:#555;font-size:14px;line-height:1.6;">If none of these times work, just give us a call on <strong>01726 432051</strong> or reply to this email and we\'ll find a time that suits you.</p>'
    + '</div>'
    // Footer
    + '<div style="background:#333;padding:20px;text-align:center;">'
    + '<p style="color:#aaa;font-size:12px;margin:0 0 5px;">Gardners Ground Maintenance</p>'
    + '<p style="color:#888;font-size:11px;margin:0 0 5px;">📞 01726 432051 | ✉️ info@gardnersgm.co.uk</p>'
    + '<p style="color:#888;font-size:11px;margin:0;">Roche, Cornwall PL26 8HN</p>'
    + '</div></div></body></html>';
  
  sendEmail({
    to: data.email, toName: '', subject: subject, htmlBody: html,
    name: 'Gardners Ground Maintenance', replyTo: 'info@gardnersgm.co.uk'
  });
}


/**
 * Log weather events to a Weather Log sheet
 */
function logWeatherEvent(alert, affectedJobs, affectedSchedule) {
  var ss = SpreadsheetApp.openById('1_Y7yHIpAvv_VNBhTrwNOQaBMAGa3UlVW_FKlf56ouHk');
  var sheet = ss.getSheetByName('Weather Log');
  if (!sheet) {
    sheet = ss.insertSheet('Weather Log');
    sheet.appendRow(['Timestamp', 'Alert Date', 'Severity', 'Reasons', 'Jobs Cancelled', 'Schedule Cancelled', 'Details']);
    sheet.getRange(1, 1, 1, 7).setFontWeight('bold').setBackground('#37474F').setFontColor('#fff');
    sheet.setColumnWidths(1, 7, 150);
  }
  
  var jobNames = affectedJobs.map(function(j) { return j.name + ' (' + j.service + ')'; }).join(', ');
  var schedNames = affectedSchedule.map(function(s) { return s.name + ' (' + s.service + ')'; }).join(', ');
  
  sheet.appendRow([
    new Date(),
    alert.date,
    alert.severity,
    alert.summary,
    affectedJobs.length,
    affectedSchedule.length,
    'Jobs: ' + (jobNames || 'none') + ' | Schedule: ' + (schedNames || 'none')
  ]);
}


/**
 * Handle weather reschedule acceptance from email link
 * Called via doGet with action=weather_reschedule
 */
function handleWeatherReschedule(params) {
  var email = params.email || '';
  var jobNumber = params.job || '';
  var newDate = params.newDate || '';
  var newTime = params.newTime || '';
  var sheet = params.sheet || 'Jobs';
  
  if (!email || !newDate || !newTime) {
    return ContentService.createTextOutput(JSON.stringify({
      status: 'error', message: 'Missing reschedule details'
    })).setMimeType(ContentService.MimeType.JSON);
  }
  
  var ss = SpreadsheetApp.openById('1_Y7yHIpAvv_VNBhTrwNOQaBMAGa3UlVW_FKlf56ouHk');
  
  if (sheet === 'Schedule') {
    // Reschedule subscription visit
    var schedSheet = ss.getSheetByName('Schedule');
    var schedData = schedSheet.getDataRange().getValues();
    var found = false;
    
    for (var i = 1; i < schedData.length; i++) {
      if (String(schedData[i][2] || '').toLowerCase() === email.toLowerCase() && 
          String(schedData[i][9] || '').toLowerCase() === 'weather-cancelled') {
        // Update to new date
        schedSheet.getRange(i + 1, 1).setValue(newDate);
        schedSheet.getRange(i + 1, 10).setValue('Rescheduled');
        schedSheet.getRange(i + 1, 15).setValue((String(schedData[i][14] || '') + ' | Rescheduled from weather cancel to ' + newDate + ' ' + newTime).trim());
        
        // Create calendar event
        try {
          createCalendarEvent(
            String(schedData[i][1] || ''), String(schedData[i][6] || ''),
            newDate, newTime, String(schedData[i][4] || ''), String(schedData[i][5] || ''),
            'SCHED-' + (i + 1)
          );
        } catch(e) {}
        
        // Send confirmation
        sendRescheduleEmail({
          name: String(schedData[i][1] || ''),
          email: email,
          service: String(schedData[i][6] || ''),
          oldDate: normaliseDateToISO(schedData[i][0]),
          oldTime: '',
          newDate: newDate,
          newTime: newTime,
          jobNumber: String(schedData[i][10] || '')
        });
        
        notifyTelegram('🔄 *Weather Reschedule Accepted*\n\n👤 ' + String(schedData[i][1] || '') + '\n📋 ' + String(schedData[i][6] || '') + '\n📅 → ' + newDate + ' at ' + newTime + '\n\n_Customer chose this from weather email_');
        
        found = true;
        break;
      }
    }
    
    if (!found) {
      return ContentService.createTextOutput(JSON.stringify({
        status: 'error', message: 'No weather-cancelled visit found for this email'
      })).setMimeType(ContentService.MimeType.JSON);
    }
    
  } else {
    // Reschedule one-off job
    var jobsSheet = ss.getSheetByName('Jobs');
    var jobsData = jobsSheet.getDataRange().getValues();
    var found2 = false;
    
    for (var j = 1; j < jobsData.length; j++) {
      var matchJob = jobNumber 
        ? String(jobsData[j][19] || '') === jobNumber
        : String(jobsData[j][3] || '').toLowerCase() === email.toLowerCase();
      
      if (matchJob && String(jobsData[j][11] || '').toLowerCase() === 'weather-cancelled') {
        var oldDate = normaliseDateToISO(jobsData[j][8]);
        var oldTime = String(jobsData[j][9] || '');
        var name = String(jobsData[j][2] || '');
        var svc = String(jobsData[j][7] || '');
        var jn = String(jobsData[j][19] || '');
        
        // Update job
        jobsSheet.getRange(j + 1, 9).setValue(newDate);
        jobsSheet.getRange(j + 1, 10).setValue(newTime);
        jobsSheet.getRange(j + 1, 12).setValue('Confirmed');
        jobsSheet.getRange(j + 1, 17).setValue((String(jobsData[j][16] || '') + ' | Rescheduled from weather: ' + oldDate + ' → ' + newDate).trim());
        
        // Calendar
        try {
          createCalendarEvent(name, svc, newDate, newTime, String(jobsData[j][5] || ''), String(jobsData[j][6] || ''), jn);
        } catch(e) {}
        
        // Send confirmation
        sendRescheduleEmail({
          name: name, email: email, service: svc,
          oldDate: oldDate, oldTime: oldTime,
          newDate: newDate, newTime: newTime, jobNumber: jn
        });
        
        notifyTelegram('🔄 *Weather Reschedule Accepted*\n\n👤 ' + name + '\n📋 ' + svc + '\n📅 ' + oldDate + ' → ' + newDate + ' at ' + newTime + '\n🔖 ' + jn + '\n\n_Customer chose this from weather email_');
        
        found2 = true;
        break;
      }
    }
    
    if (!found2) {
      return ContentService.createTextOutput(JSON.stringify({
        status: 'error', message: 'No weather-cancelled booking found'
      })).setMimeType(ContentService.MimeType.JSON);
    }
  }
  
  // Return success — redirect to a thank you message
  return ContentService.createTextOutput(JSON.stringify({
    status: 'success',
    message: 'Your appointment has been rescheduled to ' + newDate + ' at ' + newTime + '. A confirmation email is on its way!'
  })).setMimeType(ContentService.MimeType.JSON);
}


/**
 * Manual weather check — call from Apps Script editor to test
 */
function testWeatherCheck() {
  var forecast = fetchWeatherForecast();
  if (!forecast || !forecast.daily) {
    Logger.log('No forecast data');
    return;
  }
  
  Logger.log('Weather Source: ' + forecast.source);
  for (var i = 0; i < forecast.daily.length; i++) {
    var d = forecast.daily[i];
    var severity = assessWeatherSeverity(d);
    Logger.log(d.dateISO + ': ' + d.description 
      + ' | Temp: ' + d.tempMax + '/' + d.tempMin + '°C'
      + ' | Rain: ' + d.rainMM + 'mm (' + d.rainChance + '%)'  
      + ' | Wind: ' + d.windSpeed + 'mph (gusts ' + d.windGust + 'mph)'
      + ' | Severity: ' + severity.level
      + (severity.shouldCancel ? ' ← WOULD CANCEL' : '')
      + (severity.reasons.length > 0 ? ' — ' + severity.reasons.join('; ') : ''));
  }
}


/**
 * Set up the daily weather check trigger — run once from editor
 */
function setupWeatherTrigger() {
  // Remove existing weather triggers
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'checkWeatherAndAlert') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  
  // Create new daily trigger at 6pm
  ScriptApp.newTrigger('checkWeatherAndAlert')
    .timeBased()
    .atHour(18)
    .everyDays(1)
    .create();
  
  Logger.log('Weather check trigger set: daily at 6pm');
  notifyTelegram('✅ *Weather Alert System Active*\n\nDaily weather check will run at 6pm.\nWill auto-cancel jobs if severe weather detected for the next day.\n\n📍 Location: ' + WEATHER_LOCATION);
}


// ============================================
// MOBILE FIELD APP — ENDPOINTS 
// ============================================

/**
 * Get today's jobs for the field app.
 * Combines Jobs sheet (one-off bookings) and Schedule sheet (subscriptions)
 * filtered to today only.
 */
function getTodaysJobs() {
  var ss = SpreadsheetApp.openById('1_Y7yHIpAvv_VNBhTrwNOQaBMAGa3UlVW_FKlf56ouHk');
  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var jobs = [];
  
  // 1. Check Jobs sheet for today's one-off bookings
  var jobsSheet = ss.getSheetByName('Jobs');
  if (jobsSheet && jobsSheet.getLastRow() > 1) {
    var jobData = jobsSheet.getDataRange().getValues();
    for (var i = 1; i < jobData.length; i++) {
      var jobDate = normaliseDateToISO(jobData[i][8]);
      var status = String(jobData[i][11] || '').toLowerCase();
      if (jobDate === today && status !== 'cancelled' && status !== 'canceled') {
        jobs.push({
          source: 'booking',
          jobNumber: String(jobData[i][19] || 'JOB-' + (i+1)),
          ref: String(jobData[i][19] || 'JOB-' + (i+1)),
          name: String(jobData[i][2] || ''),
          clientName: String(jobData[i][2] || ''),
          email: String(jobData[i][3] || ''),
          clientEmail: String(jobData[i][3] || ''),
          phone: String(jobData[i][4] || ''),
          address: String(jobData[i][5] || ''),
          postcode: String(jobData[i][6] || ''),
          service: String(jobData[i][7] || ''),
          serviceName: String(jobData[i][7] || ''),
          date: jobDate,
          time: String(jobData[i][9] || ''),
          status: status || 'scheduled',
          price: String(jobData[i][12] || '0'),
          total: String(jobData[i][12] || '0'),
          distance: String(jobData[i][13] || ''),
          driveTime: String(jobData[i][14] || ''),
          googleMapsUrl: String(jobData[i][15] || ''),
          notes: String(jobData[i][16] || ''),
          rowIndex: i + 1,
          sheetName: 'Jobs'
        });
      }
    }
  }
  
  // 2. Check Schedule sheet for today's subscription visits
  try {
    var schedSheet = ss.getSheetByName('Schedule');
    if (schedSheet && schedSheet.getLastRow() > 1) {
      var schedData = schedSheet.getDataRange().getValues();
      for (var j = 1; j < schedData.length; j++) {
        var schedDate = normaliseDateToISO(schedData[j][0]);
        var schedStatus = String(schedData[j][9] || '').toLowerCase();
        if (schedDate === today && schedStatus !== 'cancelled' && schedStatus !== 'skipped') {
          jobs.push({
            source: 'schedule',
            jobNumber: 'SCHED-' + (j+1),
            ref: 'SCHED-' + (j+1),
            name: String(schedData[j][1] || ''),
            clientName: String(schedData[j][1] || ''),
            email: String(schedData[j][2] || ''),
            clientEmail: String(schedData[j][2] || ''),
            phone: String(schedData[j][3] || ''),
            address: String(schedData[j][4] || ''),
            postcode: String(schedData[j][5] || ''),
            service: String(schedData[j][6] || ''),
            serviceName: String(schedData[j][6] || ''),
            date: schedDate,
            time: '',
            status: schedStatus || 'scheduled',
            price: '',
            total: '',
            distance: String(schedData[j][11] || ''),
            driveTime: String(schedData[j][12] || ''),
            googleMapsUrl: String(schedData[j][13] || ''),
            notes: String(schedData[j][14] || ''),
            rowIndex: j + 1,
            sheetName: 'Schedule'
          });
        }
      }
    }
  } catch(e) { Logger.log('Schedule sheet error: ' + e); }
  
  // Sort by time (bookings with time first), then by name
  jobs.sort(function(a, b) {
    if (a.time && !b.time) return -1;
    if (!a.time && b.time) return 1;
    if (a.time && b.time) return a.time.localeCompare(b.time);
    return a.name.localeCompare(b.name);
  });
  
  return ContentService.createTextOutput(JSON.stringify({
    status: 'success',
    date: today,
    jobs: jobs,
    count: jobs.length
  })).setMimeType(ContentService.MimeType.JSON);
}

/**
 * Update job status from the field app.
 * Finds the job by jobNumber/ref and updates the status column.
 */
function mobileUpdateJobStatus(data) {
  var jobRef = data.jobRef || data.jobNumber || '';
  var newStatus = data.status || '';
  
  if (!jobRef || !newStatus) {
    return ContentService.createTextOutput(JSON.stringify({
      status: 'error', message: 'jobRef and status required'
    })).setMimeType(ContentService.MimeType.JSON);
  }
  
  var ss = SpreadsheetApp.openById('1_Y7yHIpAvv_VNBhTrwNOQaBMAGa3UlVW_FKlf56ouHk');
  var updated = false;
  
  // Check if it's a schedule ref
  if (jobRef.indexOf('SCHED-') === 0) {
    var rowIdx = parseInt(jobRef.replace('SCHED-', ''));
    var schedSheet = ss.getSheetByName('Schedule');
    if (schedSheet && rowIdx > 1) {
      schedSheet.getRange(rowIdx, 10).setValue(newStatus); // Column J = status
      updated = true;
    }
  } else {
    // Search Jobs sheet by job number (column T = 20)
    var jobsSheet = ss.getSheetByName('Jobs');
    if (jobsSheet) {
      var jobData = jobsSheet.getDataRange().getValues();
      for (var i = 1; i < jobData.length; i++) {
        if (String(jobData[i][19]) === jobRef) {
          jobsSheet.getRange(i + 1, 12).setValue(newStatus); // Column L = status
          updated = true;
          break;
        }
      }
    }
  }
  
  return ContentService.createTextOutput(JSON.stringify({
    status: updated ? 'success' : 'error',
    message: updated ? 'Status updated to ' + newStatus : 'Job not found'
  })).setMimeType(ContentService.MimeType.JSON);
}

/**
 * Start a job — records start time and updates status to in-progress.
 */
function mobileStartJob(data) {
  var jobRef = data.jobRef || data.jobNumber || '';
  if (!jobRef) {
    return ContentService.createTextOutput(JSON.stringify({
      status: 'error', message: 'jobRef required'
    })).setMimeType(ContentService.MimeType.JSON);
  }
  
  // Update status
  data.status = 'in-progress';
  mobileUpdateJobStatus(data);
  
  // Log start time to a tracking sheet
  var ss = SpreadsheetApp.openById('1_Y7yHIpAvv_VNBhTrwNOQaBMAGa3UlVW_FKlf56ouHk');
  var trackSheet = ss.getSheetByName('Job Tracking');
  if (!trackSheet) {
    trackSheet = ss.insertSheet('Job Tracking');
    trackSheet.appendRow(['Job Ref', 'Start Time', 'End Time', 'Duration (mins)', 'Notes', 'Photo Count']);
  }
  
  trackSheet.appendRow([
    jobRef,
    data.startTime || new Date().toISOString(),
    '', // end time
    '', // duration
    data.notes || '',
    0
  ]);
  
  // Telegram notification
  try {
    notifyTelegram('🔨 *Job Started*\n\nJob: ' + jobRef + '\nTime: ' + new Date().toLocaleTimeString());
  } catch(e) {}
  
  return ContentService.createTextOutput(JSON.stringify({
    status: 'success', message: 'Job started: ' + jobRef
  })).setMimeType(ContentService.MimeType.JSON);
}

/**
 * Complete a job — records end time, calculates duration, updates status.
 */
function mobileCompleteJob(data) {
  var jobRef = data.jobRef || data.jobNumber || '';
  if (!jobRef) {
    return ContentService.createTextOutput(JSON.stringify({
      status: 'error', message: 'jobRef required'
    })).setMimeType(ContentService.MimeType.JSON);
  }
  
  // Update status
  data.status = 'completed';
  mobileUpdateJobStatus(data);
  
  // Update tracking sheet with end time
  var ss = SpreadsheetApp.openById('1_Y7yHIpAvv_VNBhTrwNOQaBMAGa3UlVW_FKlf56ouHk');
  var trackSheet = ss.getSheetByName('Job Tracking');
  if (trackSheet && trackSheet.getLastRow() > 1) {
    var trackData = trackSheet.getDataRange().getValues();
    for (var i = trackData.length - 1; i >= 1; i--) {
      if (String(trackData[i][0]) === jobRef && !trackData[i][2]) {
        var endTime = data.endTime || new Date().toISOString();
        trackSheet.getRange(i + 1, 3).setValue(endTime); // end time
        
        // Calculate duration
        var startMs = new Date(trackData[i][1]).getTime();
        var endMs = new Date(endTime).getTime();
        var durationMins = Math.round((endMs - startMs) / 60000);
        trackSheet.getRange(i + 1, 4).setValue(durationMins);
        trackSheet.getRange(i + 1, 5).setValue(data.notes || trackData[i][4]);
        trackSheet.getRange(i + 1, 6).setValue(data.photoCount || 0);
        break;
      }
    }
  }
  
  // Telegram notification
  try {
    notifyTelegram('✅ *Job Completed*\n\nJob: ' + jobRef + '\nTime: ' + new Date().toLocaleTimeString());
  } catch(e) {}
  
  return ContentService.createTextOutput(JSON.stringify({
    status: 'success', message: 'Job completed: ' + jobRef
  })).setMimeType(ContentService.MimeType.JSON);
}

/**
 * Send an invoice from the field app.
 * Uses the existing sendInvoiceEmail function.
 */
function mobileSendInvoice(data) {
  var jobRef = data.jobRef || data.jobNumber || '';
  if (!jobRef) {
    return ContentService.createTextOutput(JSON.stringify({
      status: 'error', message: 'jobRef required'
    })).setMimeType(ContentService.MimeType.JSON);
  }
  
  // Look up job details if not fully provided
  var ss = SpreadsheetApp.openById('1_Y7yHIpAvv_VNBhTrwNOQaBMAGa3UlVW_FKlf56ouHk');
  var invoiceData = {
    jobNumber: jobRef,
    name: data.clientName || data.name || '',
    email: data.clientEmail || data.email || '',
    service: data.service || data.serviceName || '',
    price: data.amount || data.price || '0',
    address: data.address || '',
    postcode: data.postcode || ''
  };
  
  // If missing details, look up from Jobs sheet
  if (!invoiceData.email || !invoiceData.name) {
    var jobsSheet = ss.getSheetByName('Jobs');
    if (jobsSheet) {
      var jobData = jobsSheet.getDataRange().getValues();
      for (var i = 1; i < jobData.length; i++) {
        if (String(jobData[i][19]) === jobRef) {
          invoiceData.name = invoiceData.name || String(jobData[i][2]);
          invoiceData.email = invoiceData.email || String(jobData[i][3]);
          invoiceData.service = invoiceData.service || String(jobData[i][7]);
          invoiceData.price = invoiceData.price || String(jobData[i][12]);
          invoiceData.address = invoiceData.address || String(jobData[i][5]);
          invoiceData.postcode = invoiceData.postcode || String(jobData[i][6]);
          break;
        }
      }
    }
  }
  
  if (!invoiceData.email) {
    return ContentService.createTextOutput(JSON.stringify({
      status: 'error', message: 'No email address found for this job'
    })).setMimeType(ContentService.MimeType.JSON);
  }
  
  try {
    var result = sendInvoiceEmail(invoiceData);
    
    // Update job status to invoiced
    data.status = 'invoiced';
    mobileUpdateJobStatus(data);
    
    return ContentService.createTextOutput(JSON.stringify({
      status: 'success',
      message: 'Invoice sent to ' + invoiceData.email,
      invoiceNumber: result.invoiceNumber || ''
    })).setMimeType(ContentService.MimeType.JSON);
  } catch(err) {
    return ContentService.createTextOutput(JSON.stringify({
      status: 'error', message: 'Failed to send invoice: ' + err.message
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * Upload a job photo from the field app.
 * Saves base64 image to Google Drive and logs in Job Photos sheet.
 */
function mobileUploadPhoto(data) {
  var jobRef = data.jobRef || data.jobNumber || '';
  var photoBase64 = data.photo || '';
  var filename = data.filename || ('field-' + jobRef + '-' + Date.now() + '.jpg');
  
  if (!jobRef || !photoBase64) {
    return ContentService.createTextOutput(JSON.stringify({
      status: 'error', message: 'jobRef and photo (base64) required'
    })).setMimeType(ContentService.MimeType.JSON);
  }
  
  try {
    // Decode base64 and save to Drive
    var blob = Utilities.newBlob(Utilities.base64Decode(photoBase64), 'image/jpeg', filename);
    
    // Get or create the photos folder
    var folders = DriveApp.getFoldersByName('GGM Job Photos');
    var folder;
    if (folders.hasNext()) {
      folder = folders.next();
    } else {
      folder = DriveApp.createFolder('GGM Job Photos');
    }
    
    var file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    var fileUrl = 'https://drive.google.com/uc?id=' + file.getId();
    
    // Log to Job Photos sheet
    var sheet = ensureJobPhotosSheet();
    sheet.appendRow([
      jobRef,
      'field',
      fileUrl,
      file.getId(),
      '', // telegram file ID
      new Date().toISOString(),
      data.caption || 'Field photo'
    ]);
    
    return ContentService.createTextOutput(JSON.stringify({
      status: 'success',
      message: 'Photo uploaded',
      photoUrl: fileUrl,
      fileId: file.getId()
    })).setMimeType(ContentService.MimeType.JSON);
  } catch(err) {
    return ContentService.createTextOutput(JSON.stringify({
      status: 'error', message: 'Photo upload failed: ' + err.message
    })).setMimeType(ContentService.MimeType.JSON);
  }
}


// ===== END OF CODE TO PASTE =====


// ============================================
// REMOTE COMMAND QUEUE — Laptop ↔ PC Node Communication
// ============================================

/**
 * Ensure the RemoteCommands sheet exists with proper headers.
 */
function ensureRemoteCommandsSheet() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName('RemoteCommands');
  if (!sheet) {
    sheet = ss.insertSheet('RemoteCommands');
    sheet.appendRow(['ID', 'Command', 'Data', 'Source', 'Target', 'Status', 'Result', 'Created At', 'Completed At']);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, 9).setFontWeight('bold');
  } else {
    // Migrate: add Target column if missing
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    if (headers.indexOf('Target') === -1) {
      // Insert Target column after Source (col 4)
      sheet.insertColumnAfter(4);
      sheet.getRange(1, 5).setValue('Target').setFontWeight('bold');
    }
  }
  return sheet;
}

/**
 * Queue a remote command (called by laptop).
 */
function queueRemoteCommand(data) {
  try {
    var sheet = ensureRemoteCommandsSheet();
    var id = 'cmd_' + new Date().getTime() + '_' + Math.random().toString(36).substr(2, 6);
    var target = data.target || 'pc_hub';  // default target is PC Hub
    sheet.appendRow([
      id,
      data.command || '',
      data.data || '{}',
      data.source || 'laptop',
      target,
      'pending',
      '',
      data.created_at || new Date().toISOString(),
      ''
    ]);
    return ContentService.createTextOutput(JSON.stringify({
      status: 'success', id: id, message: 'Command queued'
    })).setMimeType(ContentService.MimeType.JSON);
  } catch(err) {
    return ContentService.createTextOutput(JSON.stringify({
      status: 'error', message: err.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * Get remote commands (called by PC node polling).
 * ?status=pending returns only pending, ?status=all returns last 20.
 */
function getRemoteCommands(params) {
  try {
    var sheet = ensureRemoteCommandsSheet();
    var data = sheet.getDataRange().getValues();
    var filterStatus = (params && params.status) ? params.status.toLowerCase() : 'pending';
    var filterTarget = (params && params.target) ? params.target.toLowerCase() : '';
    var limit = (params && params.limit) ? parseInt(params.limit) : 50;
    var commands = [];

    for (var i = data.length - 1; i >= 1; i--) {
      var row = data[i];
      var cmd = {
        id: String(row[0] || ''),
        command: String(row[1] || ''),
        data: String(row[2] || '{}'),
        source: String(row[3] || ''),
        target: String(row[4] || ''),
        status: String(row[5] || ''),
        result: String(row[6] || ''),
        created_at: String(row[7] || ''),
        completed_at: String(row[8] || ''),
        _row: i + 1
      };
      // Filter by status
      if (filterStatus !== 'all' && cmd.status.toLowerCase() !== filterStatus) continue;
      // Filter by target (if specified)
      if (filterTarget && cmd.target.toLowerCase() !== filterTarget) continue;
      commands.push(cmd);
      if (commands.length >= limit) break;
    }

    return ContentService.createTextOutput(JSON.stringify({
      status: 'success', commands: commands
    })).setMimeType(ContentService.MimeType.JSON);
  } catch(err) {
    return ContentService.createTextOutput(JSON.stringify({
      status: 'error', commands: [], message: err.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * Update a remote command status (called by PC after execution).
 */
function updateRemoteCommand(data) {
  try {
    var sheet = ensureRemoteCommandsSheet();
    var allData = sheet.getDataRange().getValues();

    for (var i = 1; i < allData.length; i++) {
      if (String(allData[i][0]) === String(data.id)) {
        sheet.getRange(i + 1, 6).setValue(data.status || 'completed');   // Status (col 6 after Target)
        sheet.getRange(i + 1, 7).setValue(data.result || '');            // Result (col 7)
        sheet.getRange(i + 1, 9).setValue(data.completed_at || new Date().toISOString()); // Completed At (col 9)
        return ContentService.createTextOutput(JSON.stringify({
          status: 'success', message: 'Command updated'
        })).setMimeType(ContentService.MimeType.JSON);
      }
    }

    return ContentService.createTextOutput(JSON.stringify({
      status: 'error', message: 'Command ID not found: ' + data.id
    })).setMimeType(ContentService.MimeType.JSON);
  } catch(err) {
    return ContentService.createTextOutput(JSON.stringify({
      status: 'error', message: err.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * Save a field note from the laptop.
 */
function saveFieldNote(data) {
  try {
    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheetByName('FieldNotes');
    if (!sheet) {
      sheet = ss.insertSheet('FieldNotes');
      sheet.appendRow(['Timestamp', 'Date', 'Category', 'Note']);
      sheet.setFrozenRows(1);
      sheet.getRange(1, 1, 1, 4).setFontWeight('bold');
    }
    sheet.appendRow([
      data.timestamp || new Date().toISOString(),
      data.date || new Date().toISOString().substr(0, 10),
      data.category || 'General',
      data.text || ''
    ]);
    return ContentService.createTextOutput(JSON.stringify({
      status: 'success', message: 'Note saved'
    })).setMimeType(ContentService.MimeType.JSON);
  } catch(err) {
    return ContentService.createTextOutput(JSON.stringify({
      status: 'error', message: err.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * Update a booking's status (e.g. mark complete from field app).
 */
function updateBookingStatus(data) {
  try {
    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheetByName('Jobs');
    if (!sheet) throw new Error('Jobs sheet not found');

    var allData = sheet.getDataRange().getValues();
    var bookingId = String(data.booking_id || '');
    if (!bookingId) throw new Error('No booking_id provided');

    // Find by job number (column 20, index 19) or row
    for (var i = 1; i < allData.length; i++) {
      var jobNum = String(allData[i][19] || '');
      if (jobNum === bookingId) {
        // Status is column 12 (index 11)
        sheet.getRange(i + 1, 12).setValue(data.status || 'Completed');
        return ContentService.createTextOutput(JSON.stringify({
          status: 'success', message: 'Booking ' + bookingId + ' updated to ' + (data.status || 'Completed')
        })).setMimeType(ContentService.MimeType.JSON);
      }
    }

    return ContentService.createTextOutput(JSON.stringify({
      status: 'error', message: 'Booking not found: ' + bookingId
    })).setMimeType(ContentService.MimeType.JSON);
  } catch(err) {
    return ContentService.createTextOutput(JSON.stringify({
      status: 'error', message: err.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * Get schedule/bookings for a specific date (field app).
 * Returns jobs matching the given date string (YYYY-MM-DD).
 */
function getScheduleForDate(dateStr) {
  try {
    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheetByName('Jobs');
    if (!sheet) throw new Error('Jobs sheet not found');

    var allData = sheet.getDataRange().getValues();
    var headers = allData[0];
    var jobs = [];

    // Find the date column (column 9, index 8 — 'Date / Start Date')
    for (var i = 1; i < allData.length; i++) {
      var row = allData[i];
      var rowDate = '';

      // Handle Date object or string in column 9 (index 8)
      if (row[8] instanceof Date) {
        var d = row[8];
        rowDate = d.getFullYear() + '-' +
          ('0' + (d.getMonth() + 1)).slice(-2) + '-' +
          ('0' + d.getDate()).slice(-2);
      } else {
        rowDate = String(row[8] || '').substr(0, 10);
      }

      if (rowDate === dateStr) {
        var status = String(row[11] || 'Scheduled');
        if (status.toLowerCase() === 'cancelled') continue;

        jobs.push({
          id: String(row[19] || ''),
          booking_id: String(row[19] || ''),
          client_name: String(row[2] || ''),
          name: String(row[2] || ''),
          email: String(row[3] || ''),
          phone: String(row[4] || ''),
          address: String(row[5] || ''),
          postcode: String(row[6] || ''),
          service: String(row[7] || ''),
          date: rowDate,
          time: String(row[9] || ''),
          status: status,
          price: String(row[12] || ''),
          notes: String(row[16] || '')
        });
      }
    }

    // Sort by time
    jobs.sort(function(a, b) { return (a.time || '').localeCompare(b.time || ''); });

    return ContentService.createTextOutput(JSON.stringify({
      status: 'success', jobs: jobs, date: dateStr
    })).setMimeType(ContentService.MimeType.JSON);
  } catch(err) {
    return ContentService.createTextOutput(JSON.stringify({
      status: 'error', jobs: [], message: err.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}


// ============================================
// JOB TRACKING — Time tracking data from mobile app
// ============================================

/**
 * Get job tracking records (start/end times, duration).
 * Params: ?date=YYYY-MM-DD (optional, defaults to all recent)
 *         ?limit=N (optional, defaults to 50)
 */
function getJobTracking(params) {
  try {
    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheetByName('Job Tracking');
    if (!sheet || sheet.getLastRow() < 2) {
      return ContentService.createTextOutput(JSON.stringify({
        status: 'success', records: [], message: 'No tracking data yet'
      })).setMimeType(ContentService.MimeType.JSON);
    }

    var data = sheet.getDataRange().getValues();
    // Headers: Job Ref, Start Time, End Time, Duration (mins), Notes, Photo Count
    var filterDate = (params && params.date) ? params.date : '';
    var limit = (params && params.limit) ? parseInt(params.limit) : 50;
    var records = [];

    for (var i = data.length - 1; i >= 1; i--) {
      var row = data[i];
      var startTime = String(row[1] || '');

      // Date filter: match against start time date portion
      if (filterDate && startTime.substr(0, 10) !== filterDate) continue;

      records.push({
        jobRef: String(row[0] || ''),
        startTime: startTime,
        endTime: String(row[2] || ''),
        durationMins: row[3] ? Number(row[3]) : null,
        notes: String(row[4] || ''),
        photoCount: row[5] ? Number(row[5]) : 0,
        isActive: !row[2] // no end time = still in progress
      });

      if (records.length >= limit) break;
    }

    return ContentService.createTextOutput(JSON.stringify({
      status: 'success', records: records
    })).setMimeType(ContentService.MimeType.JSON);
  } catch(err) {
    return ContentService.createTextOutput(JSON.stringify({
      status: 'error', records: [], message: err.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}


/**
 * Get field notes.
 * Params: ?date=YYYY-MM-DD (optional), ?limit=N (optional, default 50)
 */
function getFieldNotes(params) {
  try {
    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheetByName('FieldNotes');
    if (!sheet || sheet.getLastRow() < 2) {
      return ContentService.createTextOutput(JSON.stringify({
        status: 'success', notes: []
      })).setMimeType(ContentService.MimeType.JSON);
    }

    var data = sheet.getDataRange().getValues();
    // Headers: Timestamp, Date, Category, Note
    var filterDate = (params && params.date) ? params.date : '';
    var limit = (params && params.limit) ? parseInt(params.limit) : 50;
    var notes = [];

    for (var i = data.length - 1; i >= 1; i--) {
      var row = data[i];
      var noteDate = String(row[1] || '').substr(0, 10);
      if (filterDate && noteDate !== filterDate) continue;

      notes.push({
        timestamp: String(row[0] || ''),
        date: String(row[1] || ''),
        category: String(row[2] || 'General'),
        text: String(row[3] || '')
      });

      if (notes.length >= limit) break;
    }

    return ContentService.createTextOutput(JSON.stringify({
      status: 'success', notes: notes
    })).setMimeType(ContentService.MimeType.JSON);
  } catch(err) {
    return ContentService.createTextOutput(JSON.stringify({
      status: 'error', notes: [], message: err.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}


/**
 * Get a unified mobile activity feed — recent actions from Job Tracking,
 * Job Photos, FieldNotes, and RemoteCommands.
 * Returns the last N events sorted by timestamp, most recent first.
 * Params: ?limit=N (default 30)
 */
function getMobileActivity(params) {
  try {
    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var limit = (params && params.limit) ? parseInt(params.limit) : 30;
    var events = [];

    // 1. Job Tracking entries
    var trackSheet = ss.getSheetByName('Job Tracking');
    if (trackSheet && trackSheet.getLastRow() > 1) {
      var trackData = trackSheet.getDataRange().getValues();
      for (var i = 1; i < trackData.length; i++) {
        var startTs = String(trackData[i][1] || '');
        var endTs = String(trackData[i][2] || '');
        if (startTs) {
          events.push({
            type: 'job_start',
            icon: '🔨',
            title: 'Job Started: ' + String(trackData[i][0] || ''),
            detail: String(trackData[i][4] || ''),
            timestamp: startTs,
            source: 'mobile'
          });
        }
        if (endTs) {
          var dur = trackData[i][3] ? Number(trackData[i][3]) : 0;
          events.push({
            type: 'job_complete',
            icon: '✅',
            title: 'Job Completed: ' + String(trackData[i][0] || ''),
            detail: dur ? (Math.round(dur) + ' mins') : '',
            timestamp: endTs,
            source: 'mobile'
          });
        }
      }
    }

    // 2. Job Photos
    var photoSheet = ss.getSheetByName('Job Photos');
    if (photoSheet && photoSheet.getLastRow() > 1) {
      var photoData = photoSheet.getDataRange().getValues();
      for (var j = 1; j < photoData.length; j++) {
        var uploaded = String(photoData[j][5] || '');
        if (uploaded) {
          events.push({
            type: 'photo',
            icon: '📸',
            title: 'Photo: ' + String(photoData[j][0] || ''),
            detail: String(photoData[j][6] || ''),
            timestamp: uploaded,
            source: 'mobile',
            photoUrl: String(photoData[j][2] || '')
          });
        }
      }
    }

    // 3. Field Notes
    var noteSheet = ss.getSheetByName('FieldNotes');
    if (noteSheet && noteSheet.getLastRow() > 1) {
      var noteData = noteSheet.getDataRange().getValues();
      for (var k = 1; k < noteData.length; k++) {
        events.push({
          type: 'note',
          icon: '📝',
          title: String(noteData[k][2] || 'Note'),
          detail: String(noteData[k][3] || ''),
          timestamp: String(noteData[k][0] || ''),
          source: 'laptop'
        });
      }
    }

    // 4. Remote Commands
    var cmdSheet = ss.getSheetByName('RemoteCommands');
    if (cmdSheet && cmdSheet.getLastRow() > 1) {
      var cmdData = cmdSheet.getDataRange().getValues();
      for (var m = 1; m < cmdData.length; m++) {
        var cmdStatus = String(cmdData[m][4] || '');
        var cmdIcon = cmdStatus === 'completed' ? '✅' : cmdStatus === 'failed' ? '❌' : '⏳';
        events.push({
          type: 'command',
          icon: cmdIcon,
          title: String(cmdData[m][1] || 'Command'),
          detail: cmdStatus + (cmdData[m][5] ? ': ' + String(cmdData[m][5]).substr(0, 100) : ''),
          timestamp: String(cmdData[m][6] || ''),
          source: String(cmdData[m][3] || 'laptop')
        });
      }
    }

    // Sort by timestamp descending
    events.sort(function(a, b) {
      return (b.timestamp || '').localeCompare(a.timestamp || '');
    });

    // Limit
    events = events.slice(0, limit);

    return ContentService.createTextOutput(JSON.stringify({
      status: 'success', events: events, count: events.length
    })).setMimeType(ContentService.MimeType.JSON);
  } catch(err) {
    return ContentService.createTextOutput(JSON.stringify({
      status: 'error', events: [], message: err.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}


// ============================================
// NODE HEARTBEAT — Track all 3 nodes online/offline
// ============================================

/**
 * Ensure the NodeHeartbeats sheet exists with proper headers.
 */
function ensureNodeHeartbeatsSheet() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName('NodeHeartbeats');
  if (!sheet) {
    sheet = ss.insertSheet('NodeHeartbeats');
    sheet.appendRow(['NodeID', 'NodeType', 'Version', 'Host', 'Uptime', 'Details', 'LastSeen', 'Status']);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, 8).setFontWeight('bold').setBackground('#e8f5e9');
  }
  return sheet;
}

/**
 * Record a heartbeat from any node (PC Hub, laptop, mobile).
 * Updates existing row or creates new one.
 */
function handleNodeHeartbeat(data) {
  try {
    var sheet = ensureNodeHeartbeatsSheet();
    var nodeId = data.node_id || 'unknown';
    var nodeType = data.node_type || 'unknown';
    var now = new Date().toISOString();

    var rows = sheet.getDataRange().getValues();
    for (var i = 1; i < rows.length; i++) {
      if (String(rows[i][0]) === nodeId) {
        sheet.getRange(i + 1, 3).setValue(data.version || '');
        sheet.getRange(i + 1, 4).setValue(data.host || '');
        sheet.getRange(i + 1, 5).setValue(data.uptime || '');
        sheet.getRange(i + 1, 6).setValue(data.details || '');
        sheet.getRange(i + 1, 7).setValue(now);
        sheet.getRange(i + 1, 8).setValue('online');
        return { status: 'success', message: 'Heartbeat updated' };
      }
    }
    // New node — append row
    sheet.appendRow([nodeId, nodeType, data.version || '', data.host || '', data.uptime || '', data.details || '', now, 'online']);
    return { status: 'success', message: 'Node registered' };
  } catch (e) {
    Logger.log('Heartbeat error: ' + e);
    return { status: 'error', message: e.message };
  }
}

/**
 * Return all node statuses with online/offline detection (5-min threshold).
 */
function handleGetNodeStatus() {
  try {
    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheetByName('NodeHeartbeats');
    if (!sheet) return { status: 'success', nodes: [] };

    var rows = sheet.getDataRange().getValues();
    var nodes = [];
    var now = new Date();

    for (var i = 1; i < rows.length; i++) {
      if (!rows[i][0]) continue;
      var lastSeen = new Date(rows[i][6]);
      var ageMs = now - lastSeen;
      var ageMins = Math.floor(ageMs / 60000);
      var nodeStatus = ageMins < 5 ? 'online' : 'offline';
      var ageHuman = ageMins < 1 ? 'just now' : ageMins + ' min ago';

      // Update status on sheet if it changed
      if (nodeStatus !== String(rows[i][7])) {
        sheet.getRange(i + 1, 8).setValue(nodeStatus);
      }

      nodes.push({
        node_id: String(rows[i][0]),
        node_type: String(rows[i][1]),
        version: String(rows[i][2]),
        host: String(rows[i][3]),
        uptime: String(rows[i][4]),
        details: String(rows[i][5]),
        last_seen: String(rows[i][6]),
        status: nodeStatus,
        age_human: ageHuman
      });
    }
    return { status: 'success', nodes: nodes };
  } catch (e) {
    Logger.log('Node status error: ' + e);
    return { status: 'error', message: e.message, nodes: [] };
  }
}


// ============================================
// UPDATE INVOICE — PC Hub syncs dirty invoices back to Sheets
// ============================================

/**
 * Update an invoice row by invoice number.
 * Called by PC Hub sync.py _push_dirty_invoices().
 * Columns: A=InvoiceNumber, B=JobNumber, C=ClientName, D=Email,
 *          E=Amount, F=Status, G=StripeInvID, H=PaymentURL,
 *          I=DateIssued, J=DueDate, K=DatePaid, L=PaymentMethod,
 *          M=BeforePhotos, N=AfterPhotos, O=Notes
 */
function handleUpdateInvoice(data) {
  try {
    var sheet = ensureInvoicesSheet();
    var invoiceNumber = data.invoiceNumber || '';
    if (!invoiceNumber) {
      return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: 'Missing invoiceNumber' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    var rows = sheet.getDataRange().getValues();
    var found = false;
    for (var i = 1; i < rows.length; i++) {
      if (String(rows[i][0]) === invoiceNumber) {
        // Update editable fields (preserve Stripe-managed fields)
        if (data.clientName) sheet.getRange(i + 1, 3).setValue(data.clientName);     // C
        if (data.clientEmail) sheet.getRange(i + 1, 4).setValue(data.clientEmail);    // D
        if (data.amount !== undefined) sheet.getRange(i + 1, 5).setValue(data.amount); // E
        if (data.status) sheet.getRange(i + 1, 6).setValue(data.status);             // F
        if (data.issueDate) sheet.getRange(i + 1, 9).setValue(data.issueDate);       // I
        if (data.dueDate) sheet.getRange(i + 1, 10).setValue(data.dueDate);          // J
        if (data.paidDate) sheet.getRange(i + 1, 11).setValue(data.paidDate);        // K
        if (data.notes) sheet.getRange(i + 1, 15).setValue(data.notes);              // O

        // If status changed to Paid, also update Jobs sheet
        if (data.status === 'Paid') {
          var jobNum = String(rows[i][1]);
          if (jobNum) markJobAsPaid(jobNum, 'Hub Sync');
        }

        found = true;
        break;
      }
    }

    return ContentService.createTextOutput(JSON.stringify({
      status: found ? 'success' : 'not_found',
      message: found ? 'Invoice updated' : 'Invoice ' + invoiceNumber + ' not found'
    })).setMimeType(ContentService.MimeType.JSON);
  } catch (e) {
    Logger.log('Update invoice error: ' + e);
    return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: e.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}


// ============================================
// UPDATE ENQUIRY — PC Hub syncs dirty enquiries back to Sheets
// ============================================

/**
 * Update an enquiry row by row index or by name+email match.
 * Called by PC Hub sync.py _push_dirty_enquiries().
 * Columns: A=Timestamp, B=Name, C=Email, D=Phone, E=Description, F=Status, G=Type
 */
function handleUpdateEnquiry(data) {
  try {
    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheetByName('Enquiries');
    if (!sheet) {
      return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: 'Enquiries sheet not found' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    var rows = sheet.getDataRange().getValues();
    var found = false;
    var targetRow = data.row ? parseInt(data.row, 10) : 0;

    if (targetRow > 1 && targetRow <= rows.length) {
      // Direct row update
      var i = targetRow - 1; // row index in data array
      if (data.name) sheet.getRange(targetRow, 2).setValue(data.name);         // B
      if (data.email) sheet.getRange(targetRow, 3).setValue(data.email);       // C
      if (data.phone) sheet.getRange(targetRow, 4).setValue(data.phone);       // D
      if (data.message) sheet.getRange(targetRow, 5).setValue(data.message);   // E
      if (data.status) sheet.getRange(targetRow, 6).setValue(data.status);     // F
      if (data.type) sheet.getRange(targetRow, 7).setValue(data.type);         // G
      if (data.notes) {
        // Notes goes in col H if it exists, otherwise add it
        if (sheet.getLastColumn() < 8) {
          sheet.getRange(1, 8).setValue('Notes');
        }
        sheet.getRange(targetRow, 8).setValue(data.notes);
      }
      found = true;
    } else {
      // Fallback: find by email match
      var email = (data.email || '').toLowerCase();
      for (var i = 1; i < rows.length; i++) {
        if (String(rows[i][2]).toLowerCase() === email) {
          if (data.status) sheet.getRange(i + 1, 6).setValue(data.status);
          if (data.notes) {
            if (sheet.getLastColumn() < 8) sheet.getRange(1, 8).setValue('Notes');
            sheet.getRange(i + 1, 8).setValue(data.notes);
          }
          found = true;
          break;
        }
      }
    }

    return ContentService.createTextOutput(JSON.stringify({
      status: found ? 'success' : 'not_found',
      message: found ? 'Enquiry updated' : 'Enquiry not found'
    })).setMimeType(ContentService.MimeType.JSON);
  } catch (e) {
    Logger.log('Update enquiry error: ' + e);
    return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: e.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}


// ============================================
// MOBILE ACTIVITY LOG — Track field app actions
// ============================================

/**
 * Ensure the MobileActivity sheet exists.
 */
function ensureMobileActivitySheet() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName('MobileActivity');
  if (!sheet) {
    sheet = ss.insertSheet('MobileActivity');
    sheet.appendRow(['Timestamp', 'NodeID', 'ActivityType', 'Details', 'Lat', 'Lng']);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, 6).setFontWeight('bold').setBackground('#e3f2fd');
  }
  return sheet;
}

/**
 * Log a mobile activity event (job start, photo, invoice, etc.).
 * Called by the React Native field app.
 */
function handleLogMobileActivity(data) {
  try {
    var sheet = ensureMobileActivitySheet();
    var timestamp = data.timestamp || new Date().toISOString();
    var nodeId = data.node_id || 'mobile-field';
    var activityType = data.activityType || 'unknown';

    // Collect all extra fields into a details JSON blob
    var reserved = ['action', 'node_id', 'timestamp', 'activityType', 'lat', 'lng'];
    var details = {};
    for (var key in data) {
      if (reserved.indexOf(key) === -1) {
        details[key] = data[key];
      }
    }

    sheet.appendRow([timestamp, nodeId, activityType, JSON.stringify(details), data.lat || '', data.lng || '']);

    // Trim to last 500 rows to prevent unbounded growth
    var lastRow = sheet.getLastRow();
    if (lastRow > 501) {
      sheet.deleteRows(2, lastRow - 501);
    }
    return { status: 'success' };
  } catch (e) {
    Logger.log('Log mobile activity error: ' + e);
    return { status: 'error', message: e.message };
  }
}