/* ══════════════════════════════════════════════════════
   Gardners GM — Listmonk API Helper
   
   Shared library for interacting with the self-hosted
   Listmonk email/newsletter engine.
   
   Functions:
     • sendTransactional(templateId, email, data) — Send a single email
     • createCampaign(name, subject, templateId, listIds) — Bulk send
     • addSubscriber(email, name, lists, attribs) — Add or update
     • getSubscribers(listId) — List all subscribers
     • getLists() — Get all mailing lists
     • getTemplates() — Get all templates
   
   Config (via .env):
     LISTMONK_URL=http://localhost:9000
     LISTMONK_USER=admin
     LISTMONK_PASSWORD=your-password
   ══════════════════════════════════════════════════════ */

const { CONFIG, fetchJSON, createLogger } = require('./shared');
const http  = require('http');
const https = require('https');

const log = createLogger('listmonk');

// Base URL and auth
function getBaseUrl() {
  return (CONFIG.LISTMONK_URL || 'http://localhost:9000').replace(/\/$/, '');
}

function getAuthHeader() {
  const user = CONFIG.LISTMONK_USER || 'admin';
  const pass = CONFIG.LISTMONK_PASS || '';
  return 'Basic ' + Buffer.from(user + ':' + pass).toString('base64');
}

/**
 * Generic Listmonk API request
 */
async function listmonkRequest(method, endpoint, body = null) {
  const baseUrl = getBaseUrl();
  const url = baseUrl + '/api' + endpoint;
  
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const client = parsed.protocol === 'https:' ? https : http;
    
    const options = {
      method,
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      headers: {
        'Authorization': getAuthHeader(),
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    };
    
    const req = client.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(json);
          } else {
            reject(new Error(`Listmonk ${method} ${endpoint}: ${res.statusCode} — ${json.message || data}`));
          }
        } catch(e) {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ status: 'ok', raw: data });
          } else {
            reject(new Error(`Listmonk ${method} ${endpoint}: ${res.statusCode} — ${data.substring(0, 200)}`));
          }
        }
      });
    });
    
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Listmonk request timeout')); });
    
    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

/**
 * Send a transactional email using a Listmonk template
 * @param {number} templateId - Listmonk template ID
 * @param {string} email - Recipient email address
 * @param {object} data - Template variables (accessible as {{ .Tx.Data.key }})
 * @param {string} [subject] - Email subject (optional, uses template default)
 */
async function sendTransactional(templateId, email, data = {}, subject = null) {
  const payload = {
    subscriber_email: email,
    template_id: templateId,
    data: data,
    content_type: 'html',
  };
  if (subject) payload.subject = subject;
  
  log(`Sending transactional email to ${email} (template ${templateId})`);
  return listmonkRequest('POST', '/tx', payload);
}

/**
 * Create and optionally send a campaign (newsletter/bulk email)
 * @param {string} name - Campaign name
 * @param {string} subject - Email subject line
 * @param {number} templateId - Template to use
 * @param {number[]} listIds - Subscriber list IDs to send to
 * @param {string} [body] - HTML body content (injected into template)
 * @param {boolean} [sendNow=false] - Start sending immediately
 */
async function createCampaign(name, subject, templateId, listIds, body = '', sendNow = false) {
  const campaign = await listmonkRequest('POST', '/campaigns', {
    name,
    subject,
    lists: listIds,
    type: 'regular',
    content_type: 'html',
    body: body || '<p>{{ template "content" . }}</p>',
    template_id: templateId,
    send_at: sendNow ? new Date().toISOString() : null,
  });
  
  if (sendNow && campaign.data && campaign.data.id) {
    await listmonkRequest('PUT', `/campaigns/${campaign.data.id}/status`, { status: 'running' });
    log(`Campaign "${name}" started — sending to ${listIds.length} list(s)`);
  }
  
  return campaign;
}

/**
 * Add or update a subscriber
 * @param {string} email
 * @param {string} name
 * @param {number[]} listIds - Lists to subscribe to
 * @param {object} [attribs] - Custom attributes (tier, postcode, etc.)
 */
async function addSubscriber(email, name, listIds = [], attribs = {}) {
  const payload = {
    email,
    name,
    status: 'enabled',
    lists: listIds,
    attribs: attribs,
    preconfirm_subscriptions: true,
  };
  
  log(`Adding/updating subscriber: ${email}`);
  return listmonkRequest('POST', '/subscribers', payload);
}

/**
 * Get all subscribers, optionally filtered by list
 */
async function getSubscribers(listId = null, page = 1, perPage = 100) {
  let endpoint = `/subscribers?page=${page}&per_page=${perPage}`;
  if (listId) endpoint += `&list_id=${listId}`;
  return listmonkRequest('GET', endpoint);
}

/**
 * Get all mailing lists
 */
async function getLists() {
  return listmonkRequest('GET', '/lists');
}

/**
 * Get all templates
 */
async function getTemplates() {
  return listmonkRequest('GET', '/templates');
}

/**
 * Create a mailing list
 * @param {string} name - List name
 * @param {string} type - 'public' or 'private'
 * @param {string} [optin] - 'single' or 'double'
 */
async function createList(name, type = 'private', optin = 'single') {
  return listmonkRequest('POST', '/lists', { name, type, optin });
}

/**
 * Create an email template
 * @param {string} name - Template name
 * @param {string} body - HTML body
 * @param {boolean} isDefault - Set as default template
 */
async function createTemplate(name, body, isDefault = false) {
  return listmonkRequest('POST', '/templates', {
    name,
    type: 'campaign',
    body,
    is_default: isDefault,
  });
}

/**
 * Check if Listmonk is running and accessible
 */
async function isListmonkRunning() {
  try {
    await listmonkRequest('GET', '/health');
    return true;
  } catch(e) {
    return false;
  }
}

module.exports = {
  sendTransactional,
  createCampaign,
  addSubscriber,
  getSubscribers,
  getLists,
  getTemplates,
  createList,
  createTemplate,
  isListmonkRunning,
  listmonkRequest,
};
