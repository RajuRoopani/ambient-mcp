# 🧠 Ambient MCP — Browser Memory for Claude

> **Claude knows your code. Now it knows your day.**

[![npm](https://img.shields.io/npm/v/ambient-mcp.svg?style=flat-square&logo=npm&color=cb3837)](https://www.npmjs.com/package/ambient-mcp)
[![MCP](https://img.shields.io/badge/MCP-compatible-blue?style=flat-square&logo=anthropic)](https://modelcontextprotocol.io)
[![Chrome](https://img.shields.io/badge/Chrome-Manifest%20V3-green?style=flat-square&logo=googlechrome)](https://developer.chrome.com/docs/extensions/mv3/)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-brightgreen?style=flat-square&logo=nodedotjs)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow?style=flat-square)](LICENSE)
[![Privacy](https://img.shields.io/badge/Privacy-100%25%20Local-purple?style=flat-square)](PRIVACY.md)

---

![Ambient MCP — Claude knows your code. Now it knows your day.](docs/screenshot1-hero.png)

---

## The Gap Nobody Talks About

**Claude Code is brilliant at understanding your local files, your code, your repo.**

But the moment you open a browser, it goes completely blind.

It has no idea:
- You just spent 45 minutes on an incident page trying to figure out what broke
- The GitHub PR you had open is exactly what you're asking about
- You've already checked three dashboards and have auth tokens for all of them
- You looked at an ADO work item that explains exactly what the bug is

**Every conversation with Claude starts cold.** You paste URLs, re-explain context, copy-paste error messages, and manually hand over auth tokens — over and over again.

Your browsing history is your work memory. And Claude has none of it.

---

## Ambient MCP fixes this

**Ambient MCP** is a Chrome extension + zero-install MCP server that gives Claude access to your real-time browsing context — pages you visited, time you spent, auth tokens you hold — all local, all private, all instantly available to your AI agent.

```
┌─────────────────────────────────────────────────────────────────┐
│                     YOUR BROWSER                                │
│                                                                 │
│  webRequest     ──► Auth tokens (JWT decoded, expiry tracked)   │
│  webNavigation  ──► Page visits (URL, title, time spent)        │
│  content script ──► Page context (text, headings, entity IDs)   │
│                                    │                            │
└────────────────────────────────────┼────────────────────────────┘
                                     │  POST localhost:3457
                          ┌──────────▼─────────────┐
                          │   ambient-mcp server    │
                          │   ~/.claude/store.json  │
                          └──────────┬──────────────┘
                                     │  MCP stdio JSON-RPC
                    ┌────────────────▼────────────────────────┐
                    │             Claude Code                   │
                    │                                          │
                    │  get_recent_context()   ─► "User was on │
                    │  search_context("ICM")  ─►  ICM #759120 │
                    │  check_token_health()   ─►  token valid, │
                    │  get_token_for_domain() ─►  52 min left" │
                    └──────────────────────────────────────────┘
```

---

## What It Looks Like in Practice

![Popup showing live captured pages and fresh auth tokens](docs/screenshot2-agent.png)

The extension popup shows live stats and recent activity. On the right, Claude sees exactly what you've been doing — without you typing a word.

---

## Before vs After

### "This TypeError keeps crashing my app. Can you help?"

You've had four tabs open for an hour: a GitHub issue, a Stack Overflow thread, the React docs, and a migration guide. Claude has no idea.

**Without Ambient MCP:**
> Claude: "Can you share the error message? Which file? What framework? What have you already tried?"
> *(You spend 5 minutes copy-pasting stack traces and explaining context you've already researched)*

**With Ambient MCP:**
> Claude calls `get_recent_context()` → sees GitHub issue #1089, your Stack Overflow tab about React 18 async timing, the React docs on useEffect cleanup, and a TanStack Query v5 migration guide
> Claude: *"I can see exactly what you've been debugging. You've got a React 18 async race condition — your fetch resolves after the component unmounts. Quick fix: add an isMounted cleanup flag. Better fix: you were already reading the TanStack Query migration guide — switching to `useQuery` handles this automatically. Want me to show both?"*

---

### "Write a PR description for my changes"

**Without Ambient MCP:**
> Claude: "What repo? What issue does this fix? What's the context?"

**With Ambient MCP:**
> Claude calls `get_pages_by_entity("github_issue")` → finds the bug report you read, the PR you have open, and the related issues you visited
> Claude: *"Based on issue #1089 you were investigating and PR #234 you opened, here's a description that captures the full context..."*

---

### "Deploy this to production"

**Without Ambient MCP:**
> Claude: "I'll need your Vercel token. Can you paste it?"

**With Ambient MCP:**
> Claude calls `check_token_for_domain("vercel.com")` → `{ valid: true, minsLeft: 61 }`
> Claude calls `get_token_for_domain("vercel.com")` → uses your live session token directly
> Claude: *"Using your existing Vercel token (61 minutes remaining)..."*

---

### "What did I work on today?"

**Without Ambient MCP:**
> Claude: "I don't have visibility into what you worked on outside this conversation."

**With Ambient MCP:**
> Claude calls `get_recent_visits(limit=100)` → 40 min debugging the React TypeError, 25 min on code review, 20 min reading deployment docs
> Claude: *"Today you spent most of your time on the undefined map() bug in your fetch logic. You also reviewed a PR and read through the Vercel deployment docs. The bug investigation is still open — want to pick up where you left off?"*

---

## The Popup

![Ambient MCP Extension Popup](docs/popup-preview.png)

A live status dashboard in your browser toolbar. See pages captured, tokens stored, which tokens are fresh vs expiring — all in real time. One-click flush, view, or clear.

---

## 8 MCP Tools for Claude

| Tool | What it does |
|------|-------------|
| `get_recent_context(limit?)` | N most recently visited pages with full structured context |
| `search_context(query)` | Full-text search across all visited pages and headings |
| `check_token_health()` | Health summary of all captured auth tokens |
| `check_token_for_domain(domain)` | Validate a specific token before making an API call |
| `get_auth_tokens(domain?)` | Get all captured tokens with decoded JWT claims |
| `get_token_for_domain(domain)` | Retrieve a specific token for use in API calls |
| `get_pages_by_entity(type)` | Filter pages by entity type (ICM / ADO / GitHub / Teams…) |
| `get_recent_visits(limit?)` | Navigation timeline with time spent per page |

**Entity types detected automatically:**
`github_pr` · `github_issue` · `stackoverflow` · `npm_package` · `docs_page` · `jira_issue` · `linear_issue` · `notion_page` · `figma_file` · `confluence_page` · `teams_meeting` · `outlook_email` · `azure_portal` · `vercel_deployment` · `cloudflare_dashboard` · `aws_console` · `wiki_page`

---

## Setup in 3 Steps

### 1. Start the MCP server

```bash
npx ambient-mcp
```

Zero install. No git clone. No `npm install`. The server starts on port 3457 and persists your context to `~/.claude/browser-context-mcp/store.json`.

> Requires Node.js 18+

### 2. Register with Claude Code

Add to `.mcp.json` in your project root (or `~/.claude/mcp.json` for global):

```json
{
  "mcpServers": {
    "browser-context": {
      "command": "npx",
      "args": ["ambient-mcp"]
    }
  }
}
```

Restart Claude Code — the server starts automatically.

### 3. Install the Chrome extension

```bash
git clone https://github.com/RajuRoopani/ambient-mcp.git
```

1. Open Chrome → `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** → select the `extension/` folder

The extension icon appears in your toolbar. Browse normally — context is captured silently in the background.

**First capture takes ~15 seconds** (the flush interval). After that, every new page is immediately available to Claude.

---

## Privacy First

**Everything stays on your machine.** The server binds to `localhost:3457` only. Nothing is sent to any cloud service, analytics platform, or third party — not even to us.

- Page context stored in `~/.claude/browser-context-mcp/store.json`
- Auth tokens stored in plaintext — treat this file like `.env`
- Pages auto-expire after 5 days, expired tokens pruned after 24h
- Store file is gitignored — tokens never committed to git

[Full Privacy Policy →](PRIVACY.md)

---

## Add Context to Your Claude System Prompt

Put this in your `CLAUDE.md` or system prompt:

```markdown
## Browser Context
You have access to a `browser-context` MCP server that captures my real-time browsing activity.
- ALWAYS call `check_token_health()` before making any API calls on my behalf
- Call `get_recent_context()` at the start of any investigation — I may have already been working on it
- Use `search_context(query)` to find any page I've visited related to a topic
- Use `get_token_for_domain(domain)` to get auth tokens — never ask me to paste tokens manually
```

---

## Architecture

```
browser-context-mcp/
├── extension/               # Chrome Extension (Manifest V3)
│   ├── background.js        # Service worker: JWT intercept, nav tracking, expiry alerts
│   ├── content.js           # Page context extraction, entity detection, SPA support
│   ├── popup.html / .js     # Live status dashboard (dark purple/indigo theme)
│   └── manifest.json
│
└── server/                  # Published to npm as `ambient-mcp`
    ├── server.js            # HTTP :3457 ingest + MCP stdio JSON-RPC agent tools
    └── store.js             # In-memory store, JSON persistence, TTL pruning
```

### Data flow

```
1. Page visited → content.js extracts title, text, entity type, GUIDs, headings
2. API request made → background.js intercepts Authorization header, decodes JWT
3. Every 15s → visit batch POSTed to localhost:3457/ingest/visits
4. Every 30s → token expiry check → browser notification if <5 min remaining
5. Claude asks → MCP tool → server queries store → structured context returned
```

---

## HTTP API

```
GET  /health                    Server stats + token list
POST /ingest/page               Ingest a page context object
POST /ingest/visits             Ingest page visit array
POST /ingest/tokens             Ingest auth tokens array
GET  /context/recent?limit=N    Recent pages (default 20)
GET  /context/search?q=QUERY    Full-text search
GET  /tokens                    All captured tokens
GET  /tokens/health             Token health summary
GET  /tokens/check/:domain      Validate a specific domain token
POST /context/clear             Clear all stored data
```

---

## Configuration

Set constants in `server/store.js`:

| Setting | Default | Description |
|---------|---------|-------------|
| `HISTORY_TTL_DAYS` | `5` | Auto-prune pages/visits older than this |
| `EXPIRED_TOKEN_TTL_HOURS` | `24` | Grace period before removing expired tokens |
| `MAX_PAGES` | `500` | Hard cap on stored pages |
| `MAX_VISITS` | `2000` | Hard cap on stored visits |

---

## Contributing

- [ ] Firefox / Safari support
- [ ] Encrypted store (system keychain)
- [ ] Per-domain capture opt-out
- [ ] More entity types (ServiceNow, Jira, Notion, Confluence)
- [ ] Semantic search with embeddings
- [ ] OAuth2 token auto-refresh
- [ ] SSE streaming for real-time agent updates

```bash
# Dev mode
cd server && node --watch server.js
# Chrome: chrome://extensions → Load unpacked → extension/
```

---

## License

MIT — use it, fork it, build on it.

---

<p align="center">
  <strong>Claude Code lives in your terminal. Ambient MCP gives it a window into your day.</strong>
</p>
