/**
 * Browser Context MCP — Dual-Protocol Server
 *
 * 1. HTTP on :3457  — receives ingested data from browser extension
 * 2. MCP stdio      — exposes tools for AI agents
 *
 * MCP Tools:
 *   get_recent_context(limit)         — recent pages + visits
 *   search_context(query)             — full-text search over page history
 *   get_auth_tokens(domain?)          — current auth tokens (domain optional filter)
 *   get_pages_by_entity(entityType)   — pages filtered by entity type
 *   get_recent_visits(limit)          — navigation history with time-spent
 *   get_token_for_domain(domain)      — full token entry including headers/JWT
 */

'use strict';

const readline = require('readline');
const express  = require('express');
const store    = require('./store');

const HTTP_PORT = 3457;

function log(...args) { console.error('[BCX]', ...args); }

// ─── HTTP Server (ingest receiver) ───────────────────────────────────────────

const app = express();
app.use(express.json({ limit: '2mb' }));

// CORS for extension — includes Private Network Access header required by Chrome 98+
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
    return res.sendStatus(204);
  }
  next();
});

// Health — includes retention policy info
app.get('/health', (req, res) => {
  res.json({
    ok: true,
    ...store.getStats(),
    retention: {
      historyDays:        store.HISTORY_TTL_DAYS,
      expiredTokenHours:  store.EXPIRED_TOKEN_TTL_HOURS,
      pruneIntervalHours: 1,
    },
  });
});

// Ingest page context
app.post('/ingest/page', (req, res) => {
  const page = req.body;
  if (!page || !page.url) return res.status(400).json({ error: 'Missing url' });
  store.upsertPage(page);
  log('Ingested page:', page.url.slice(0, 80));
  res.json({ ok: true });
});

// Ingest visits batch
app.post('/ingest/visits', (req, res) => {
  const batch = req.body;
  if (!Array.isArray(batch)) return res.status(400).json({ error: 'Expected array' });
  store.addVisits(batch);
  log(`Ingested ${batch.length} visit(s)`);
  res.json({ ok: true });
});

// Ingest tokens batch
app.post('/ingest/tokens', (req, res) => {
  const tokens = req.body;
  if (!Array.isArray(tokens)) return res.status(400).json({ error: 'Expected array' });
  store.upsertTokens(tokens);
  log(`Ingested ${tokens.length} token(s)`);
  res.json({ ok: true });
});

// Query endpoints (for popup)
app.get('/context/recent', (req, res) => {
  const limit = parseInt(req.query.limit || '20', 10);
  res.json({ pages: store.getRecentPages(limit) });
});

app.get('/context/search', (req, res) => {
  const { q } = req.query;
  if (!q) return res.status(400).json({ error: 'Missing q' });
  res.json({ results: store.searchPages(q) });
});

app.get('/tokens', (req, res) => {
  res.json(store.getTokens());
});

// Token health summary — shows fresh/expiring/expired breakdown
app.get('/tokens/health', (req, res) => {
  const health = store.getTokenHealth();
  res.json({
    summary: {
      fresh:        health.fresh.length,
      expiringSoon: health.expiringSoon.length,
      expired:      health.expired.length,
      unknown:      health.unknown.length,
    },
    ...health,
  });
});

// Check a specific domain's token validity
app.get('/tokens/check/:domain', (req, res) => {
  res.json(store.isTokenValid(req.params.domain));
});

// Force prune now (useful for testing or manual cleanup)
app.post('/context/prune', (req, res) => {
  const result = store.pruneOldData();
  log('Manual prune:', result);
  res.json({ ok: true, ...result });
});

app.post('/context/clear', (req, res) => {
  store.clearAll();
  log('Store cleared');
  res.json({ ok: true });
});

const httpServer = app.listen(HTTP_PORT, () => {
  log(`HTTP ingest server listening on :${HTTP_PORT}`);
});

// ─── MCP Tool Definitions ────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'get_recent_context',
    description: 'Get the most recently visited pages and browsing context. Includes page title, URL, entity type (ICM, ADO, GitHub, Teams, etc.), text snippet, and headings. Use this to understand what the user has been working on.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Number of pages to return (default 20, max 50)', default: 20 },
      },
    },
  },
  {
    name: 'search_context',
    description: 'Full-text search over the user\'s browsing history. Searches page titles, URLs, text snippets, descriptions, and headings. Use this to find pages related to a specific topic, incident ID, work item, or keyword.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query — can be a keyword, ID, GUID, or phrase' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_auth_tokens',
    description: 'Get current authentication tokens captured from the user\'s browser. Returns domain, status (fresh/expired/refreshed), expiry time, user identity, and JWT claims. Use this to understand which services the user is authenticated with and to detect expired sessions.',
    inputSchema: {
      type: 'object',
      properties: {
        domain: { type: 'string', description: 'Optional domain filter (e.g. "dev.azure.com"). If omitted, returns all tokens.' },
      },
    },
  },
  {
    name: 'get_pages_by_entity',
    description: 'Get recently visited pages filtered by entity type. Useful for finding all ICM incidents, ADO work items, GitHub PRs, Teams meetings, etc. the user has visited.',
    inputSchema: {
      type: 'object',
      properties: {
        entity_type: {
          type: 'string',
          description: 'Entity type to filter by',
          enum: ['icm_incident', 'ado_work_item', 'ado_pr', 'ado_build', 'github_pr', 'github_issue', 'teams_meeting', 'teams_channel', 'outlook_email', 'outlook_calendar', 'azure_portal', 'geneva_logs', 'geneva_health', 'sharepoint', 'onedrive', 'wiki_page', 'webpage'],
        },
      },
      required: ['entity_type'],
    },
  },
  {
    name: 'get_recent_visits',
    description: 'Get the user\'s navigation history including time spent on each page. Useful for understanding the user\'s work timeline and what they were investigating.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Number of visits to return (default 50, max 200)', default: 50 },
      },
    },
  },
  {
    name: 'get_token_for_domain',
    description: 'Get the full auth token entry for a specific domain, including all captured request headers and decoded JWT claims. Use this when you need to understand what scopes or roles the user has for a specific service.',
    inputSchema: {
      type: 'object',
      properties: {
        domain: { type: 'string', description: 'Domain to look up (e.g. "dev.azure.com", "microsofticm.com")' },
      },
      required: ['domain'],
    },
  },
  {
    name: 'check_token_health',
    description: 'Check the validity and expiry status of all captured auth tokens. Returns a breakdown of fresh, expiring-soon (< 10 min), expired, and unknown tokens. ALWAYS call this before making any API calls on behalf of the user to avoid using an expired token.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'check_token_for_domain',
    description: 'Check if the auth token for a specific domain is valid before using it. Returns whether the token is fresh, expiring soon, or expired — and how many minutes remain. Use this immediately before any API call to validate the token is still usable.',
    inputSchema: {
      type: 'object',
      properties: {
        domain: { type: 'string', description: 'Domain to check (e.g. "graph.microsoft.com", "dev.azure.com", "outlook.cloud.microsoft")' },
      },
      required: ['domain'],
    },
  },
];

// ─── MCP Tool Execution ───────────────────────────────────────────────────────

function executeTool(name, args) {
  args = args || {};

  if (name === 'get_recent_context') {
    const limit = Math.min(args.limit || 20, 50);
    const pages  = store.getRecentPages(limit);
    return {
      pages: pages.map(p => ({
        url:        p.url,
        title:      p.title,
        entityType: p.entityType,
        entityId:   p.entityId,
        description: p.description,
        snippet:    p.snippet?.slice(0, 500),
        headings:   p.headings,
        capturedAt: p.capturedAt,
        identifiers: p.identifiers,
      })),
      total: pages.length,
    };
  }

  if (name === 'search_context') {
    const { query } = args;
    if (!query) return { error: 'Missing query' };
    const results = store.searchPages(query);
    return {
      results: results.map(p => ({
        url:        p.url,
        title:      p.title,
        entityType: p.entityType,
        entityId:   p.entityId,
        snippet:    p.snippet?.slice(0, 400),
        capturedAt: p.capturedAt,
      })),
      total: results.length,
      query,
    };
  }

  if (name === 'get_auth_tokens') {
    let tokens = store.getTokens();
    if (args.domain) {
      const d = args.domain.toLowerCase();
      tokens = tokens.filter(t => t.domain.toLowerCase().includes(d));
    }
    // Return safe subset (no raw headers unless explicitly asked)
    return {
      tokens: tokens.map(t => ({
        domain:      t.domain,
        status:      t.status,
        capturedAt:  t.capturedAt,
        expiresAt:   t.expiresAt,
        expiredAt:   t.expiredAt,
        user:        t.jwt?.upn || t.jwt?.sub || null,
        jwt: t.jwt ? {
          sub:   t.jwt.sub,
          oid:   t.jwt.oid,
          upn:   t.jwt.upn,
          iss:   t.jwt.iss,
          aud:   t.jwt.aud,
          scp:   t.jwt.scp,
          roles: t.jwt.roles,
          exp:   t.jwt.exp,
        } : null,
        headerNames: Object.keys(t.headers || []),
      })),
      total: tokens.length,
    };
  }

  if (name === 'get_pages_by_entity') {
    const { entity_type } = args;
    if (!entity_type) return { error: 'Missing entity_type' };
    const pages = store.getPagesByEntity(entity_type);
    return { pages, total: pages.length, entity_type };
  }

  if (name === 'get_recent_visits') {
    const limit = Math.min(args.limit || 50, 200);
    const visits = store.getRecentVisits(limit);
    return { visits, total: visits.length };
  }

  if (name === 'get_token_for_domain') {
    const { domain } = args;
    if (!domain) return { error: 'Missing domain' };
    const token = store.getToken(domain);
    if (!token) return { error: `No token found for domain: ${domain}` };
    return {
      domain:      token.domain,
      status:      token.status,
      capturedAt:  token.capturedAt,
      expiresAt:   token.expiresAt,
      jwt:         token.jwt,
      headerNames: Object.keys(token.headers || {}),
      validity:    store.isTokenValid(domain),
    };
  }

  if (name === 'check_token_health') {
    const health = store.getTokenHealth();
    const warnings = [];
    if (health.expired.length > 0) {
      warnings.push(`${health.expired.length} expired token(s): ${health.expired.map(t => t.domain).join(', ')} — ask the user to re-authenticate by visiting those sites.`);
    }
    if (health.expiringSoon.length > 0) {
      warnings.push(`${health.expiringSoon.length} token(s) expiring within 10 minutes: ${health.expiringSoon.map(t => `${t.domain} (${t.expiresInMinutes}m left)`).join(', ')}`);
    }
    return {
      summary: {
        fresh:        health.fresh.length,
        expiringSoon: health.expiringSoon.length,
        expired:      health.expired.length,
        unknown:      health.unknown.length,
      },
      warnings,
      fresh:        health.fresh,
      expiringSoon: health.expiringSoon,
      expired:      health.expired,
      unknown:      health.unknown,
      advice: health.expired.length > 0
        ? 'Some tokens are expired. Tell the user to open the affected site(s) in their browser to re-authenticate before retrying.'
        : health.expiringSoon.length > 0
        ? 'Some tokens expire within 10 minutes. Consider completing any dependent API calls immediately.'
        : 'All tokens are fresh. Safe to proceed.',
    };
  }

  if (name === 'check_token_for_domain') {
    const { domain } = args;
    if (!domain) return { error: 'Missing domain' };
    const validity = store.isTokenValid(domain);
    return {
      domain,
      ...validity,
      advice: !validity.valid
        ? `Token for ${domain} is ${validity.reason}. Ask the user to open https://${domain} in their browser to re-authenticate.`
        : validity.reason === 'expiring_soon'
        ? `Token for ${domain} expires in ${validity.minsLeft} minutes. Make your API calls now.`
        : `Token for ${domain} is valid (${validity.minsLeft} minutes remaining). Safe to use.`,
    };
  }

  return { error: `Unknown tool: ${name}` };
}

// ─── MCP stdio Protocol (JSON-RPC 2.0) ───────────────────────────────────────

const rl = readline.createInterface({ input: process.stdin });

let initialized = false;

rl.on('line', (line) => {
  line = line.trim();
  if (!line) return;

  let msg;
  try { msg = JSON.parse(line); }
  catch { return; }

  const { id, method, params } = msg;

  function respond(result) {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
  }
  function error(code, message) {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n');
  }

  if (method === 'initialize') {
    initialized = true;
    respond({
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'browser-context-mcp', version: '1.0.0' },
    });
    return;
  }

  if (method === 'notifications/initialized') return;
  if (method === 'ping') { respond({}); return; }

  if (!initialized) { error(-32002, 'Not initialized'); return; }

  if (method === 'tools/list') {
    respond({ tools: TOOLS });
    return;
  }

  if (method === 'tools/call') {
    const { name, arguments: args } = params || {};
    if (!name) { error(-32602, 'Missing tool name'); return; }
    try {
      const result = executeTool(name, args);
      respond({
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      });
    } catch (err) {
      error(-32603, err.message);
    }
    return;
  }

  error(-32601, `Method not found: ${method}`);
});

rl.on('close', () => {
  log('stdin closed — HTTP server continues on :' + HTTP_PORT);
});

log('Browser Context MCP server started (stdio + HTTP :' + HTTP_PORT + ')');
