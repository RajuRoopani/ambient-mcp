'use strict';

const SERVER = 'http://localhost:3457';

function timeAgo(isoStr) {
  if (!isoStr) return '';
  const mins = Math.round((Date.now() - new Date(isoStr).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  return `${Math.round(mins / 60)}h ago`;
}

function minsLeft(exp) {
  if (!exp) return null;
  return Math.round((new Date(exp).getTime() - Date.now()) / 60000);
}

function entityIcon(type) {
  const MAP = {
    icm_incident: '🔴', ado_work_item: '📋', ado_pr: '🔀', ado_build: '⚙️',
    github_pr: '🔀', github_issue: '🐛', teams_meeting: '📅', teams_channel: '💬',
    outlook_email: '📧', outlook_calendar: '📅', azure_portal: '☁️',
    geneva_logs: '📊', sharepoint: '📁', onedrive: '💾', wiki_page: '📖',
    project_board: '📋', issue: '🐛', dashboard: '📊',
  };
  return MAP[type] || '🌐';
}

function entityTag(type) {
  const MAP = {
    icm_incident:     { label: 'ICM',    bg: 'rgba(248,113,113,0.15)', color: '#f87171' },
    ado_work_item:    { label: 'ADO',    bg: 'rgba(99,102,241,0.15)',  color: '#818cf8' },
    ado_pr:           { label: 'PR',     bg: 'rgba(99,102,241,0.15)',  color: '#818cf8' },
    ado_build:        { label: 'Build',  bg: 'rgba(251,191,36,0.15)',  color: '#fbbf24' },
    github_pr:        { label: 'GH-PR',  bg: 'rgba(99,102,241,0.15)',  color: '#818cf8' },
    github_issue:     { label: 'Issue',  bg: 'rgba(236,72,153,0.15)',  color: '#f472b6' },
    teams_meeting:    { label: 'Teams',  bg: 'rgba(99,102,241,0.15)',  color: '#818cf8' },
    teams_channel:    { label: 'Channel',bg: 'rgba(99,102,241,0.15)',  color: '#818cf8' },
    outlook_email:    { label: 'Email',  bg: 'rgba(6,182,212,0.15)',   color: '#22d3ee' },
    outlook_calendar: { label: 'Cal',    bg: 'rgba(6,182,212,0.15)',   color: '#22d3ee' },
    azure_portal:     { label: 'Azure',  bg: 'rgba(6,182,212,0.15)',   color: '#22d3ee' },
    geneva_logs:      { label: 'Geneva', bg: 'rgba(251,191,36,0.15)',  color: '#fbbf24' },
    sharepoint:       { label: 'SP',     bg: 'rgba(6,182,212,0.15)',   color: '#22d3ee' },
    wiki_page:        { label: 'Wiki',   bg: 'rgba(6,182,212,0.15)',   color: '#22d3ee' },
  };
  const tag = MAP[type];
  if (!tag) return '';
  return `<span class="page-tag" style="background:${tag.bg};color:${tag.color}">${tag.label}</span>`;
}

function tokenBadge(t) {
  const mins = minsLeft(t.expiresAt);
  if (mins === null) return `<span class="token-badge badge-unknown">${t.status || '?'}</span>`;
  if (mins <= 0)   return `<span class="token-badge badge-expired">Expired</span>`;
  if (mins < 15)   return `<span class="token-badge badge-expiring">⚠ ${mins}m left</span>`;
  return `<span class="token-badge badge-fresh">✓ Fresh · ${mins}m</span>`;
}

function iconBg(type) {
  const warm = ['github_issue', 'icm_incident'];
  const cyan = ['outlook_email', 'outlook_calendar', 'azure_portal', 'geneva_logs', 'sharepoint'];
  if (warm.includes(type)) return 'rgba(236,72,153,0.18)';
  if (cyan.includes(type)) return 'rgba(6,182,212,0.18)';
  return 'rgba(99,102,241,0.18)';
}

async function refreshUI() {
  const dot     = document.getElementById('status-dot');
  const txt     = document.getElementById('status-text');
  const banner  = document.getElementById('offline-banner');

  try {
    const [healthRes, contextRes] = await Promise.all([
      fetch(`${SERVER}/health`),
      fetch(`${SERVER}/context/recent?limit=5`),
    ]);
    const health  = await healthRes.json();
    const context = await contextRes.json();

    dot.className = 'status-dot live';
    txt.textContent = 'Live';
    banner.classList.remove('show');

    const tokens    = health.tokenList || [];
    const freshCnt  = tokens.filter(t => {
      const m = minsLeft(t.expiresAt);
      return m === null ? t.status === 'fresh' : m > 0;
    }).length;

    document.getElementById('stat-pages').textContent  = health.pages  ?? '0';
    document.getElementById('stat-tokens').textContent = health.tokens ?? '0';
    document.getElementById('stat-fresh').textContent  = freshCnt;

    renderPages(context.pages   || []);
    renderTokens(tokens);
  } catch {
    dot.className = 'status-dot err';
    txt.textContent = 'Offline';
    banner.classList.add('show');

    document.getElementById('stat-pages').textContent  = '—';
    document.getElementById('stat-tokens').textContent = '—';
    document.getElementById('stat-fresh').textContent  = '—';
    document.getElementById('page-list').innerHTML  = '<div class="empty">Server offline.</div>';
    document.getElementById('token-list').innerHTML = '<div class="empty">Server offline.</div>';
  }
}

function renderPages(pages) {
  const el = document.getElementById('page-list');
  if (!pages.length) {
    el.innerHTML = '<div class="empty">No pages captured yet.<br>Start browsing to see context here.</div>';
    return;
  }
  el.innerHTML = pages.slice(0, 5).map(p => {
    const domain = (() => { try { return new URL(p.url).hostname; } catch { return p.url; } })();
    return `
      <div class="page-item">
        <div class="page-favicon" style="background:${iconBg(p.entityType)}">${entityIcon(p.entityType)}</div>
        <div class="page-info">
          <div class="page-title" title="${p.url}">${p.title || p.url}</div>
          <div class="page-meta">${domain} · ${timeAgo(p.capturedAt)}</div>
        </div>
        ${entityTag(p.entityType)}
      </div>
    `;
  }).join('');
}

function renderTokens(tokens) {
  const el = document.getElementById('token-list');
  if (!tokens.length) {
    el.innerHTML = '<div class="empty">No tokens captured yet.</div>';
    return;
  }
  el.innerHTML = tokens.slice(0, 6).map(t => `
    <div class="token-item">
      <div class="token-domain">${t.domain}</div>
      ${tokenBadge(t)}
    </div>
  `).join('');
}

document.getElementById('btn-flush').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'FORCE_FLUSH' }, () => setTimeout(refreshUI, 800));
});

document.getElementById('btn-open').addEventListener('click', () => {
  chrome.tabs.create({ url: `${SERVER}/context/recent` });
});

document.getElementById('btn-clear').addEventListener('click', () => {
  if (!confirm('Clear all cached tokens and page context? This cannot be undone.')) return;
  fetch(`${SERVER}/context/clear`, { method: 'POST' }).then(() => refreshUI()).catch(() => {});
});

refreshUI();
setInterval(refreshUI, 5000);
