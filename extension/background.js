/**
 * Browser Context MCP — Background Service Worker
 *
 * Captures:
 *  1. Page visits (URL, title, time spent, entity type)
 *  2. Auth tokens from request headers (Authorization, x-ms-*, x-auth-*, api-key)
 *  3. Token expiry detection via 401 responses → user notification
 *  4. Token refresh detection via 200 responses after re-auth
 *
 * Sends everything to localhost:3457/ingest so the MCP server can serve it to agents.
 */

'use strict';

const SERVER = 'http://localhost:3457';

// ─── In-memory buffers (flushed to server periodically) ───────────────────────

const visitBuffer = [];       // pending page visits
const tokenBuffer = new Map(); // domain → latest token info

// Active tabs: tabId → { url, title, startTime }
const activeTabs = new Map();

// Known expired domains (got 401)
const expiredDomains = new Set();

// ─── Utilities ────────────────────────────────────────────────────────────────

function domainOf(url) {
  try { return new URL(url).hostname; } catch { return url; }
}

function now() { return new Date().toISOString(); }

/** Decode JWT payload (base64url → JSON) without verification */
function decodeJwt(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = atob(payload);
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/** Extract auth-relevant headers from a request header list */
function extractAuthHeaders(headers) {
  const AUTH_PATTERNS = [
    'authorization', 'x-ms-', 'x-auth-', 'x-api-key', 'api-key',
    'x-csrf-token', 'x-xsrf-token', 'x-client-', 'ocp-apim-subscription-key',
  ];

  const captured = {};
  for (const { name, value } of (headers || [])) {
    const lower = name.toLowerCase();
    if (AUTH_PATTERNS.some(p => lower.startsWith(p))) {
      captured[name] = value;
    }
  }
  return captured;
}

/** Parse a token entry from captured headers */
function buildTokenEntry(domain, headers) {
  const entry = {
    domain,
    capturedAt: now(),
    status: 'fresh',
    headers: {},
    jwt: null,
    expiresAt: null,
  };

  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase();

    // Store partial token (first 40 chars + "...") for safety in logs
    // Store FULL token for agent use — agents need real tokens to replay requests
    entry.headers[name] = value;

    // Try to decode Bearer JWT
    if (lower === 'authorization' && value.startsWith('Bearer ')) {
      const token = value.slice(7);
      const claims = decodeJwt(token);
      if (claims) {
        entry.jwt = {
          sub: claims.sub,
          oid: claims.oid,
          upn: claims.upn || claims.unique_name,
          iss: claims.iss,
          aud: claims.aud,
          exp: claims.exp,
          iat: claims.iat,
          scp: claims.scp,
          roles: claims.roles,
        };
        if (claims.exp) {
          entry.expiresAt = new Date(claims.exp * 1000).toISOString();
          // Mark expired if past expiry
          if (Date.now() > claims.exp * 1000) {
            entry.status = 'expired';
          }
        }
      }
    }
  }

  return entry;
}

// ─── Token capture via webRequest ─────────────────────────────────────────────

chrome.webRequest.onSendHeaders.addListener(
  (details) => {
    // Only capture from top-level requests with auth headers
    if (details.type !== 'xmlhttprequest' && details.type !== 'fetch' && details.type !== 'main_frame') return;

    const domain = domainOf(details.url);
    const authHeaders = extractAuthHeaders(details.requestHeaders);
    if (Object.keys(authHeaders).length === 0) return;

    // Don't capture our own server
    if (domain === 'localhost' || domain === '127.0.0.1') return;

    const entry = buildTokenEntry(domain, authHeaders);

    // If this domain was expired but now sends headers again, mark recovering
    if (expiredDomains.has(domain)) {
      expiredDomains.delete(domain);
      entry.status = 'refreshed';
    }

    tokenBuffer.set(domain, entry);
  },
  { urls: ['<all_urls>'] },
  ['requestHeaders']
);

// ─── 401 detection — mark domain tokens as expired ────────────────────────────

chrome.webRequest.onCompleted.addListener(
  (details) => {
    if (details.statusCode !== 401) return;
    const domain = domainOf(details.url);
    if (domain === 'localhost') return;

    expiredDomains.add(domain);

    // Update token status in buffer
    const existing = tokenBuffer.get(domain);
    if (existing) {
      existing.status = 'expired';
      existing.expiredAt = now();
      tokenBuffer.set(domain, existing);
    }

    // Show browser notification
    chrome.notifications.create(`token-expired-${domain}`, {
      type: 'basic',
      iconUrl: 'icon.png',
      title: 'Token Expired',
      message: `Authentication expired for ${domain}. Open the site to re-authenticate.`,
      buttons: [{ title: 'Open Tab' }],
      requireInteraction: false,
    });

    // Flush expired token to server immediately
    flushTokens();
  },
  { urls: ['<all_urls>'] }
);

// ─── Navigation tracking ───────────────────────────────────────────────────────

chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId !== 0) return; // top frame only
  if (!details.url || details.url.startsWith('chrome') || details.url.startsWith('about')) return;

  const prev = activeTabs.get(details.tabId);
  if (prev && prev.url) {
    // Record the previous page with time spent
    const spent = Date.now() - prev.startTime;
    if (spent > 2000) { // ignore sub-2s flashes
      visitBuffer.push({
        url: prev.url,
        title: prev.title || '',
        startTime: new Date(prev.startTime).toISOString(),
        durationMs: spent,
        tabId: details.tabId,
      });
    }
  }

  activeTabs.set(details.tabId, {
    url: details.url,
    title: '',
    startTime: Date.now(),
  });
});

// Update title when tab finishes loading
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.title && activeTabs.has(tabId)) {
    const entry = activeTabs.get(tabId);
    activeTabs.set(tabId, { ...entry, title: changeInfo.title });
  }
});

// Tab closed — flush final visit
chrome.tabs.onRemoved.addListener((tabId) => {
  const entry = activeTabs.get(tabId);
  if (entry?.url) {
    const spent = Date.now() - entry.startTime;
    if (spent > 2000) {
      visitBuffer.push({
        url: entry.url,
        title: entry.title || '',
        startTime: new Date(entry.startTime).toISOString(),
        durationMs: spent,
        tabId,
      });
    }
  }
  activeTabs.delete(tabId);
});

// ─── Flush to MCP server ──────────────────────────────────────────────────────

async function flushVisits() {
  if (visitBuffer.length === 0) return;
  const batch = visitBuffer.splice(0);
  try {
    const r = await fetch(`${SERVER}/ingest/visits`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(batch),
    });
    console.log('[BCX] visits flushed', r.status, batch.length);
  } catch (err) {
    console.error('[BCX] visits flush failed:', err.message);
    visitBuffer.unshift(...batch);
  }
}

async function flushTokens() {
  if (tokenBuffer.size === 0) return;
  const tokens = Array.from(tokenBuffer.values());
  try {
    const r = await fetch(`${SERVER}/ingest/tokens`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(tokens),
    });
    console.log('[BCX] tokens flushed', r.status, tokens.length);
  } catch (err) {
    console.error('[BCX] tokens flush failed:', err.message);
  }
}

// Flush every 15 seconds
setInterval(() => {
  flushVisits();
  flushTokens();
}, 15_000);

// ─── Proactive token expiry checking ─────────────────────────────────────────

// Track which domains we've already warned about (avoid repeat notifications)
const warnedExpiry = new Map(); // domain → expiry ISO string

function checkTokenExpiry() {
  const now = Date.now();
  for (const [domain, entry] of tokenBuffer) {
    if (!entry.expiresAt) continue;
    const expiresMs = new Date(entry.expiresAt).getTime();
    const minsLeft  = Math.round((expiresMs - now) / 60000);
    const key       = `${domain}:${entry.expiresAt}`;

    if (entry.status === 'expired') continue; // already handled by 401 listener

    // Already sent this exact warning
    if (warnedExpiry.get(domain) === entry.expiresAt) continue;

    if (minsLeft <= 0) {
      // Expired without a 401 (e.g. tab was not active) — mark it
      entry.status   = 'expired';
      entry.expiredAt = now();
      tokenBuffer.set(domain, entry);
      expiredDomains.add(domain);

      chrome.notifications.create(`token-expired-${domain}`, {
        type: 'basic', iconUrl: 'icon.png',
        title: '🔒 Session Expired',
        message: `Your session for ${domain} has expired. Open the site to re-authenticate.`,
        buttons: [{ title: 'Re-authenticate' }],
        requireInteraction: true,
      });
      warnedExpiry.set(domain, entry.expiresAt);
      flushTokens();

    } else if (minsLeft <= 5) {
      // About to expire — warn once per expiry timestamp
      chrome.notifications.create(`token-expiring-${domain}`, {
        type: 'basic', iconUrl: 'icon.png',
        title: '⚠️ Session Expiring Soon',
        message: `Your ${domain} session expires in ${minsLeft} minute${minsLeft === 1 ? '' : 's'}. Open the site to keep it alive.`,
        buttons: [{ title: 'Open Tab' }],
        requireInteraction: false,
      });
      warnedExpiry.set(domain, entry.expiresAt);
    }
  }
}

// Notification button clicks
chrome.notifications.onButtonClicked.addListener((notifId, btnIdx) => {
  const m = notifId.match(/^token-(?:expired|expiring)-(.+)$/);
  if (m && btnIdx === 0) {
    chrome.tabs.create({ url: `https://${m[1]}` });
  }
});

// Alarm: flush + expiry check every 30s
chrome.alarms.create('flush',        { periodInMinutes: 0.5 });
chrome.alarms.create('expiry-check', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'flush') {
    flushVisits();
    flushTokens();
  }
  if (alarm.name === 'expiry-check') {
    checkTokenExpiry();
  }
});

// ─── Messages from content script and popup ────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Page context from content.js
  if (msg.type === 'PAGE_CONTEXT') {
    const tabEntry = activeTabs.get(sender.tab?.id);
    if (tabEntry) {
      activeTabs.set(sender.tab.id, { ...tabEntry, title: msg.title || tabEntry.title });
    }

    // Send enriched page context to server
    fetch(`${SERVER}/ingest/page`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...msg, capturedAt: now() }),
      keepalive: true,
    }).then(r => console.log('[BCX] page ingested', r.status, msg.url?.slice(0, 60)))
      .catch(err => console.error('[BCX] page ingest failed:', err.message, msg.url?.slice(0, 60)));

    return false;
  }

  // Popup asking for status
  if (msg.type === 'GET_STATUS') {
    sendResponse({
      tokens: Array.from(tokenBuffer.values()).map(t => ({
        domain: t.domain,
        status: t.status,
        capturedAt: t.capturedAt,
        expiresAt: t.expiresAt,
        user: t.jwt?.upn || t.jwt?.sub || null,
        headerCount: Object.keys(t.headers).length,
      })),
      pendingVisits: visitBuffer.length,
      activeTabs: activeTabs.size,
      expiredDomains: Array.from(expiredDomains),
    });
    return false;
  }

  // Popup: force flush
  if (msg.type === 'FORCE_FLUSH') {
    Promise.all([flushVisits(), flushTokens()]).then(() => sendResponse({ ok: true }));
    return true;
  }
});

console.log('[BCX] Browser Context MCP background started');
