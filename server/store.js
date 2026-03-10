/**
 * Browser Context MCP — In-Memory Store with JSON Persistence
 *
 * Retention policy:
 *   - pages:          5 days (HISTORY_TTL_DAYS), hard cap MAX_PAGES
 *   - visits:         5 days (HISTORY_TTL_DAYS), hard cap MAX_VISITS
 *   - fresh tokens:   kept until expired (JWT exp claim) + 24h grace
 *   - expired tokens: pruned after EXPIRED_TOKEN_TTL_HOURS (24h)
 *
 * Pruning runs every PRUNE_INTERVAL_MS (1 hour) and on startup.
 */

'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');

const STORE_DIR              = path.join(os.homedir(), '.claude', 'browser-context-mcp');
const STORE_PATH             = path.join(STORE_DIR, 'store.json');
const MAX_PAGES              = 500;
const MAX_VISITS             = 2000;
const HISTORY_TTL_DAYS       = 5;           // pages + visits older than this are pruned
const EXPIRED_TOKEN_TTL_HOURS = 24;         // expired tokens are removed after this
const PRUNE_INTERVAL_MS      = 60 * 60_000; // prune every 1 hour

// ─── In-memory state ─────────────────────────────────────────────────────────

let tokens = new Map();   // domain → tokenEntry
let pages  = [];          // pageEntry[], newest first, capped
let visits = [];          // visitEntry[], newest first, capped

// ─── Persistence ─────────────────────────────────────────────────────────────

function load() {
  try {
    if (!fs.existsSync(STORE_PATH)) return;
    const raw = fs.readFileSync(STORE_PATH, 'utf8');
    const data = JSON.parse(raw);
    if (data.tokens) tokens = new Map(Object.entries(data.tokens));
    if (Array.isArray(data.pages))  pages  = data.pages;
    if (Array.isArray(data.visits)) visits = data.visits;
    console.error(`[BCX] Loaded store: ${tokens.size} tokens, ${pages.length} pages, ${visits.length} visits`);
  } catch (err) {
    console.error('[BCX] Failed to load store:', err.message);
  }
}

function save() {
  try {
    const data = {
      tokens: Object.fromEntries(tokens),
      pages,
      visits,
      savedAt: new Date().toISOString(),
    };
    fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error('[BCX] Failed to save store:', err.message);
  }
}

// Debounced save — avoid hammering disk on rapid ingestion
let saveTimer = null;
function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 2000);
}

// ─── Token operations ────────────────────────────────────────────────────────

function upsertTokens(entries) {
  for (const entry of entries) {
    if (!entry.domain) continue;
    tokens.set(entry.domain, entry);
  }
  scheduleSave();
}

function getTokens() {
  return Array.from(tokens.values());
}

function getToken(domain) {
  return tokens.get(domain) || null;
}

// ─── Page context operations ─────────────────────────────────────────────────

function upsertPage(page) {
  if (!page.url) return;
  // Deduplicate: replace existing entry for same URL
  const idx = pages.findIndex(p => p.url === page.url);
  if (idx !== -1) {
    pages.splice(idx, 1);
  }
  pages.unshift(page); // newest first
  if (pages.length > MAX_PAGES) pages.length = MAX_PAGES;
  scheduleSave();
}

function getRecentPages(limit = 20) {
  return pages.slice(0, limit);
}

function searchPages(query) {
  const q = query.toLowerCase();
  return pages.filter(p =>
    (p.title  || '').toLowerCase().includes(q) ||
    (p.url    || '').toLowerCase().includes(q) ||
    (p.snippet || '').toLowerCase().includes(q) ||
    (p.description || '').toLowerCase().includes(q) ||
    (p.headings || []).some(h => h.toLowerCase().includes(q))
  ).slice(0, 20);
}

function getPagesByEntity(entityType) {
  return pages.filter(p => p.entityType === entityType).slice(0, 20);
}

// ─── Visit operations ────────────────────────────────────────────────────────

function addVisits(batch) {
  for (const v of batch) {
    visits.unshift(v);
  }
  if (visits.length > MAX_VISITS) visits.length = MAX_VISITS;
  scheduleSave();
}

function getRecentVisits(limit = 50) {
  return visits.slice(0, limit);
}

// ─── Stats ───────────────────────────────────────────────────────────────────

function getStats() {
  return {
    tokens: tokens.size,
    pages:  pages.length,
    visits: visits.length,
    tokenList: Array.from(tokens.values()).map(t => ({
      domain:      t.domain,
      status:      t.status,
      capturedAt:  t.capturedAt,
      expiresAt:   t.expiresAt,
      user:        t.jwt?.upn || t.jwt?.sub || null,
      headerCount: Object.keys(t.headers || {}).length,
    })),
  };
}

// ─── Token health ────────────────────────────────────────────────────────────

function getTokenHealth() {
  const now = Date.now();
  const result = { fresh: [], expiringSoon: [], expired: [], unknown: [] };

  for (const t of tokens.values()) {
    const entry = {
      domain:     t.domain,
      status:     t.status,
      capturedAt: t.capturedAt,
      expiresAt:  t.expiresAt,
      user:       t.jwt?.upn || t.jwt?.sub || null,
      expiresInMinutes: null,
      isValid: false,
    };

    if (!t.expiresAt) {
      entry.isValid = t.status !== 'expired';
      result.unknown.push(entry);
      continue;
    }

    const expiresMs   = new Date(t.expiresAt).getTime();
    const minsLeft    = Math.round((expiresMs - now) / 60000);
    entry.expiresInMinutes = minsLeft;

    if (minsLeft <= 0 || t.status === 'expired') {
      entry.isValid = false;
      result.expired.push(entry);
    } else if (minsLeft <= 10) {
      entry.isValid = true;
      result.expiringSoon.push(entry);
    } else {
      entry.isValid = true;
      result.fresh.push(entry);
    }
  }

  return result;
}

function isTokenValid(domain) {
  const t = tokens.get(domain);
  if (!t) return { valid: false, reason: 'not_found' };
  if (t.status === 'expired') return { valid: false, reason: 'expired', expiresAt: t.expiresAt };
  if (!t.expiresAt) return { valid: true, reason: 'no_expiry_claim' };
  const minsLeft = Math.round((new Date(t.expiresAt).getTime() - Date.now()) / 60000);
  if (minsLeft <= 0)  return { valid: false, reason: 'expired', expiresAt: t.expiresAt, minsLeft };
  if (minsLeft <= 5)  return { valid: true,  reason: 'expiring_soon', expiresAt: t.expiresAt, minsLeft };
  return { valid: true, reason: 'fresh', expiresAt: t.expiresAt, minsLeft };
}

// ─── Pruning ─────────────────────────────────────────────────────────────────

function pruneOldData() {
  const now          = Date.now();
  const historyTTL   = HISTORY_TTL_DAYS * 24 * 60 * 60_000;
  const tokenTTL     = EXPIRED_TOKEN_TTL_HOURS * 60 * 60_000;
  const cutoffHistory = now - historyTTL;
  const cutoffToken   = now - tokenTTL;

  // Prune pages older than HISTORY_TTL_DAYS
  const pagesBefore = pages.length;
  pages = pages.filter(p => {
    const ts = p.capturedAt ? new Date(p.capturedAt).getTime() : 0;
    return ts > cutoffHistory;
  });
  const pagesRemoved = pagesBefore - pages.length;

  // Prune visits older than HISTORY_TTL_DAYS
  const visitsBefore = visits.length;
  visits = visits.filter(v => {
    const ts = v.startTime ? new Date(v.startTime).getTime() : 0;
    return ts > cutoffHistory;
  });
  const visitsRemoved = visitsBefore - visits.length;

  // Prune expired tokens that have been expired for > EXPIRED_TOKEN_TTL_HOURS
  let tokensRemoved = 0;
  for (const [domain, t] of tokens) {
    const isExpired = t.status === 'expired' ||
      (t.expiresAt && new Date(t.expiresAt).getTime() < now);
    if (isExpired) {
      const expiredAt = t.expiredAt
        ? new Date(t.expiredAt).getTime()
        : (t.expiresAt ? new Date(t.expiresAt).getTime() : 0);
      if (now - expiredAt > tokenTTL) {
        tokens.delete(domain);
        tokensRemoved++;
      }
    }
  }

  if (pagesRemoved > 0 || visitsRemoved > 0 || tokensRemoved > 0) {
    console.error(`[BCX] Pruned: ${pagesRemoved} pages, ${visitsRemoved} visits, ${tokensRemoved} tokens`);
    scheduleSave();
  }

  return { pagesRemoved, visitsRemoved, tokensRemoved };
}

// ─── Clear ───────────────────────────────────────────────────────────────────

function clearAll() {
  tokens = new Map();
  pages  = [];
  visits = [];
  scheduleSave();
}

// ─── Boot ────────────────────────────────────────────────────────────────────

// Ensure shared store directory exists
fs.mkdirSync(STORE_DIR, { recursive: true });

load();

// Prune on startup to clean stale data from previous sessions
pruneOldData();

// Periodic save every 60s as safety net
setInterval(save, 60_000);

// Periodic prune every hour
setInterval(pruneOldData, PRUNE_INTERVAL_MS);

module.exports = {
  upsertTokens,
  getTokens,
  getToken,
  getTokenHealth,
  isTokenValid,
  upsertPage,
  getRecentPages,
  searchPages,
  getPagesByEntity,
  addVisits,
  getRecentVisits,
  getStats,
  pruneOldData,
  clearAll,
  HISTORY_TTL_DAYS,
  EXPIRED_TOKEN_TTL_HOURS,
};
