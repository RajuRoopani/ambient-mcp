# ambient-mcp

> **Your browser becomes your AI's memory.**

[![npm version](https://img.shields.io/npm/v/ambient-mcp.svg)](https://www.npmjs.com/package/ambient-mcp)
[![MCP](https://img.shields.io/badge/MCP-2024--11--05-blue?logo=anthropic)](https://modelcontextprotocol.io)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-brightgreen?logo=nodedotjs)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/RajuRoopani/ambient-mcp/blob/main/LICENSE)

A Chrome extension + local MCP server that gives your AI agents real-time awareness of everything you're doing in the browser — pages visited, auth tokens captured, navigation history, entity detection (ICM, ADO, GitHub, Teams, Outlook, Azure).

```
You visit a page  →  Extension captures context  →  MCP server stores it
                                                           ↓
                                          AI agent calls get_recent_context()
                                          AI agent calls check_token_health()
                                          AI agent calls search_context("ICM")
                                               ↓
                                    Agent knows what you're working on
                                    Agent uses your live auth tokens
                                    Agent finds the incident you were viewing
```

---

## Quick Start

### 1. Start the MCP server

```bash
npx ambient-mcp
```

### 2. Register with Claude Code

Add to your `.mcp.json`:

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

### 3. Install the Chrome extension

Load from the [GitHub repo](https://github.com/RajuRoopani/ambient-mcp/tree/main/extension) or install from the Chrome Web Store.

Browse normally — within 15 seconds your first pages and tokens are available to your AI agent.

---

## What It Captures

| Data | Details |
|------|---------|
| **Pages** | Title, URL, text snippet, headings, entity type & ID, extracted GUIDs/ticket numbers, related links |
| **Auth tokens** | Bearer tokens from any request, decoded JWT (user, audience, scopes, expiry) |
| **Navigation history** | Time spent per page, tab activity timeline |

**Auto-detected entity types:** `icm_incident` · `ado_work_item` · `ado_pr` · `ado_build` · `github_pr` · `github_issue` · `teams_meeting` · `teams_channel` · `outlook_email` · `outlook_calendar` · `azure_portal` · `geneva_logs` · `sharepoint` · `onedrive` · `wiki_page`

---

## MCP Tools

| Tool | Description |
|------|-------------|
| `get_recent_context(limit?)` | Most recently visited pages with full context |
| `search_context(query)` | Full-text search over browsing history |
| `get_auth_tokens(domain?)` | All captured tokens with decoded JWT claims |
| `get_pages_by_entity(entity_type)` | Filter pages by type (ICM, ADO, GitHub…) |
| `get_recent_visits(limit?)` | Navigation timeline with time-spent per page |
| `get_token_for_domain(domain)` | Full token entry for a specific domain |
| `check_token_health()` | Breakdown of all tokens: fresh / expiring / expired |
| `check_token_for_domain(domain)` | Validate one token before an API call |

### Example: Agent checks token before an API call

```
Agent: check_token_for_domain("graph.microsoft.com")
→ { valid: true, reason: "fresh", minsLeft: 47,
    advice: "Token is valid (47 min remaining). Safe to use." }

Agent: get_recent_context()
→ [ { url: "https://portal.microsofticm.com/...", entityType: "icm_incident",
      entityId: "759120401", snippet: "Teams message delivery failure..." } ]
```

### Recommended CLAUDE.md snippet

```markdown
## Browser Context
Always call `check_token_health()` before making API calls on my behalf.
Call `get_recent_context()` at the start of any investigation.
Use `search_context(query)` to find pages related to a specific ticket or topic.
Use `get_token_for_domain(domain)` to get my auth token — never ask me to paste one.
```

---

## HTTP API

The server also runs on `http://localhost:3457` for the extension and your own scripts:

```bash
curl http://localhost:3457/health          # server stats
curl http://localhost:3457/tokens/health   # token validity summary
curl "http://localhost:3457/context/search?q=ICM"  # search your history
```

---

## Data & Privacy

- **Local only** — all data stays on `localhost:3457`, nothing leaves your machine
- **Persisted to** `~/.claude/browser-context-mcp/store.json` — shared across all Claude Code projects
- **5-day retention** — pages and visits auto-pruned after 5 days, expired tokens after 24h
- **No encryption at rest** — treat `store.json` like a `.env` file

---

## Architecture

```
browser-context-mcp/
├── extension/          Chrome MV3 extension (load from GitHub)
└── server/             ← this npm package
    ├── server.js       HTTP :3457 (ingest) + MCP stdio (agent tools)
    ├── store.js        In-memory store, JSON persistence, TTL pruning
    └── bin/
        └── ambient-mcp.js   npx entry point
```

---

## Links

- **GitHub**: [github.com/RajuRoopani/ambient-mcp](https://github.com/RajuRoopani/ambient-mcp)
- **Chrome Extension**: [GitHub extension folder](https://github.com/RajuRoopani/ambient-mcp/tree/main/extension)
- **MCP Protocol**: [modelcontextprotocol.io](https://modelcontextprotocol.io)

---

MIT License
