/**
 * Browser Context MCP — Content Script
 *
 * Extracts page context for every page the user visits:
 *  - Title, URL, description
 *  - Entity type detection (ICM incident, ADO work item, Teams meeting, GitHub PR, etc.)
 *  - Main text snippet (for search/summary)
 *  - Key identifiers found on the page (GUIDs, IDs, ticket numbers)
 *  - Links to related resources
 *
 * Sends to background.js → MCP server.
 */

'use strict';

// ─── Entity type detection ────────────────────────────────────────────────────

const ENTITY_PATTERNS = [
  { type: 'icm_incident',    regex: /microsofticm\.com\/imp\/.*\/incidents\/details\/(\d+)/ },
  { type: 'ado_work_item',   regex: /dev\.azure\.com\/.+\/_workitems\/edit\/(\d+)/ },
  { type: 'ado_pr',          regex: /dev\.azure\.com\/.+\/pullrequest\/(\d+)/ },
  { type: 'ado_build',       regex: /dev\.azure\.com\/.+\/_build\/results\?buildId=(\d+)/ },
  { type: 'github_pr',       regex: /github\.com\/.+\/pull\/(\d+)/ },
  { type: 'github_issue',    regex: /github\.com\/.+\/issues\/(\d+)/ },
  { type: 'teams_meeting',   regex: /teams\.microsoft\.com\/.+meeting/ },
  { type: 'teams_channel',   regex: /teams\.microsoft\.com\/.+channel/ },
  { type: 'outlook_email',   regex: /outlook\.office\.com\/mail/ },
  { type: 'outlook_calendar',regex: /outlook\.office\.com\/calendar/ },
  { type: 'azure_portal',    regex: /portal\.azure\.com/ },
  { type: 'geneva_logs',     regex: /microsoftgeneva\.com\/logs\/dgrep/ },
  { type: 'geneva_health',   regex: /microsoftgeneva\.com.*health/ },
  { type: 'sharepoint',      regex: /sharepoint\.com/ },
  { type: 'onedrive',        regex: /onedrive\.live\.com|1drv\.ms/ },
  { type: 'wiki_page',       regex: /dev\.azure\.com\/.+\/_wiki/ },
];

function detectEntityType(url) {
  for (const { type, regex } of ENTITY_PATTERNS) {
    const m = url.match(regex);
    if (m) return { type, id: m[1] || null };
  }
  return { type: 'webpage', id: null };
}

// ─── Text extraction ──────────────────────────────────────────────────────────

function extractMainText() {
  // Remove noise elements
  const SKIP = new Set(['script', 'style', 'nav', 'header', 'footer', 'noscript', 'svg', 'img']);

  function walk(el, depth = 0) {
    if (SKIP.has(el.tagName?.toLowerCase())) return '';
    if (depth > 6) return '';
    let text = '';
    for (const child of el.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        text += child.textContent.replace(/\s+/g, ' ');
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        text += walk(child, depth + 1);
      }
    }
    return text;
  }

  const main = document.querySelector('main') ||
               document.querySelector('[role="main"]') ||
               document.querySelector('article') ||
               document.body;

  return walk(main).replace(/\s+/g, ' ').trim().slice(0, 2000);
}

function extractDescription() {
  return (
    document.querySelector('meta[name="description"]')?.content ||
    document.querySelector('meta[property="og:description"]')?.content ||
    ''
  ).trim().slice(0, 300);
}

// ─── Identifier extraction ─────────────────────────────────────────────────────

const GUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const ICM_RE = /\bICM[:\s#]*(\d{6,12})\b/gi;
const TICKET_RE = /\b(?:bug|task|ticket|issue|item|id)[:\s#]*(\d{4,10})\b/gi;

function extractIdentifiers() {
  const text = document.body.innerText || '';
  const ids = {
    guids: [...new Set(text.match(GUID_RE) || [])].slice(0, 10),
    icmIds: [...new Set([...text.matchAll(ICM_RE)].map(m => m[1]))].slice(0, 5),
    ticketIds: [...new Set([...text.matchAll(TICKET_RE)].map(m => m[1]))].slice(0, 5),
  };
  return ids;
}

// ─── Related links extraction ──────────────────────────────────────────────────

const IMPORTANT_DOMAINS = [
  'microsofticm.com', 'dev.azure.com', 'github.com', 'microsoftgeneva.com',
  'portal.azure.com', 'teams.microsoft.com', 'outlook.office.com',
];

function extractRelatedLinks() {
  const links = [];
  for (const a of document.querySelectorAll('a[href]')) {
    try {
      const href = new URL(a.href);
      if (IMPORTANT_DOMAINS.some(d => href.hostname.endsWith(d))) {
        links.push({
          text: a.textContent.trim().slice(0, 80),
          url: a.href,
        });
      }
    } catch { /* ignore */ }
  }
  // Deduplicate by URL
  const seen = new Set();
  return links.filter(l => {
    if (seen.has(l.url)) return false;
    seen.add(l.url);
    return true;
  }).slice(0, 15);
}

// ─── Headings (for structure-aware search) ────────────────────────────────────

function extractHeadings() {
  return Array.from(document.querySelectorAll('h1, h2, h3'))
    .map(h => h.textContent.trim())
    .filter(t => t.length > 2 && t.length < 200)
    .slice(0, 10);
}

// ─── Main extraction ──────────────────────────────────────────────────────────

function extractAndSend() {
  const url = location.href;

  // Skip non-content pages
  if (url.startsWith('chrome') || url.startsWith('about') || url.startsWith('data')) return;

  const entity = detectEntityType(url);
  const payload = {
    type: 'PAGE_CONTEXT',
    url,
    title: document.title,
    description: extractDescription(),
    entityType: entity.type,
    entityId: entity.id,
    snippet: extractMainText(),
    headings: extractHeadings(),
    identifiers: extractIdentifiers(),
    relatedLinks: extractRelatedLinks(),
    capturedAt: new Date().toISOString(),
  };

  chrome.runtime.sendMessage(payload);
}

// ─── Boot ─────────────────────────────────────────────────────────────────────

// Wait for SPA content to settle
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => setTimeout(extractAndSend, 1500));
} else {
  setTimeout(extractAndSend, 1500);
}

// Re-extract on SPA navigation (URL change without full reload)
let lastUrl = location.href;
new MutationObserver(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    setTimeout(extractAndSend, 1500);
  }
}).observe(document.body, { childList: true, subtree: true });
