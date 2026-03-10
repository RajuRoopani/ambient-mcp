/**
 * Browser Context MCP — Popup UI
 */

'use strict';

const SERVER = 'http://localhost:3457';

function timeAgo(isoStr) {
  if (!isoStr) return '';
  const diff = Date.now() - new Date(isoStr).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  return `${Math.round(mins / 60)}h ago`;
}

function badgeClass(status) {
  const s = (status || '').toLowerCase();
  if (s === 'fresh') return 'badge-fresh';
  if (s === 'expired') return 'badge-expired';
  if (s === 'refreshed') return 'badge-refreshed';
  return 'badge-unknown';
}

function entityLabel(type) {
  const MAP = {
    icm_incident: 'ICM', ado_work_item: 'ADO', ado_pr: 'PR', ado_build: 'Build',
    github_pr: 'GH-PR', github_issue: 'GH-Issue', teams_meeting: 'Teams',
    teams_channel: 'Channel', outlook_email: 'Email', outlook_calendar: 'Cal',
    azure_portal: 'Azure', geneva_logs: 'Geneva', sharepoint: 'SP', wiki_page: 'Wiki',
  };
  return MAP[type] || '';
}

async function refreshUI() {
  const dot = document.getElementById('server-dot');
  const card = document.getElementById('server-card');
  const statusEl = document.getElementById('server-status');
  const subEl = document.getElementById('server-sub');

  try {
    const [healthRes, contextRes] = await Promise.all([
      fetch(`${SERVER}/health`),
      fetch(`${SERVER}/context/recent?limit=5`),
    ]);

    const health = await healthRes.json();
    const context = await contextRes.json();

    dot.className = 'dot ok';
    card.className = 'status-card ok';
    statusEl.textContent = `✓ Server running · localhost:3457`;
    subEl.innerHTML = `${health.tokens} token(s) · ${health.pages} page(s) · ${health.visits} visit(s)`;

    document.getElementById('stat-tokens').textContent = health.tokens ?? '0';
    document.getElementById('stat-pages').textContent = health.pages ?? '0';
    document.getElementById('stat-visits').textContent = health.visits ?? '0';

    renderTokens(health.tokenList || []);
    renderPages(context.pages || []);
  } catch {
    dot.className = 'dot err';
    card.className = 'status-card err';
    statusEl.textContent = '✗ Server offline';
    subEl.innerHTML = `Run: <code>cd browser-context-mcp/server && npm start</code>`;
    document.getElementById('stat-tokens').textContent = '—';
    document.getElementById('stat-pages').textContent = '—';
    document.getElementById('stat-visits').textContent = '—';
  }
}

function renderTokens(tokens) {
  const el = document.getElementById('token-list');
  if (!tokens.length) {
    el.innerHTML = '<div class="empty">No tokens captured yet.</div>';
    return;
  }
  el.innerHTML = tokens.slice(0, 8).map(t => `
    <div class="token-card">
      <div>
        <div class="token-domain">${t.domain}</div>
        <div class="token-user">${t.user || 'unknown user'} · ${timeAgo(t.capturedAt)}</div>
      </div>
      <span class="badge ${badgeClass(t.status)}">${t.status || '?'}</span>
    </div>
  `).join('');
}

function renderPages(pages) {
  const el = document.getElementById('recent-list');
  if (!pages.length) {
    el.innerHTML = '<div class="empty">No pages captured yet.<br>Browse some Microsoft/GitHub pages.</div>';
    return;
  }
  el.innerHTML = pages.map(p => {
    const label = entityLabel(p.entityType);
    return `
      <div class="recent-card">
        <div class="recent-title" title="${p.url}">${p.title || p.url}</div>
        <div class="recent-meta">
          ${label ? `<span class="entity-badge">${label}</span>` : ''}
          ${timeAgo(p.capturedAt)}
        </div>
      </div>
    `;
  }).join('');
}

// Buttons
document.getElementById('btn-flush').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'FORCE_FLUSH' }, () => {
    setTimeout(refreshUI, 800);
  });
});

document.getElementById('btn-open').addEventListener('click', () => {
  chrome.tabs.create({ url: `${SERVER}/context/recent` });
});

document.getElementById('btn-clear').addEventListener('click', () => {
  if (!confirm('Clear all cached tokens and page context? This cannot be undone.')) return;
  fetch(`${SERVER}/context/clear`, { method: 'POST' }).then(() => refreshUI()).catch(() => {});
});

// Boot
refreshUI();
setInterval(refreshUI, 3000);
