#!/usr/bin/env node
'use strict';

/**
 * ambient-mcp CLI entry point
 *
 * Usage:
 *   npx ambient-mcp          # Start the MCP + HTTP server
 *   npx ambient-mcp --help   # Show help
 *   npx ambient-mcp --port   # Show which port is used
 */

const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
ambient-mcp — Browser Context for AI Agents

USAGE
  npx ambient-mcp          Start the MCP server (stdio) + HTTP ingest server (:3457)

DESCRIPTION
  Starts a dual-protocol server:
    • MCP stdio  — AI agents connect via JSON-RPC over stdin/stdout
    • HTTP :3457 — Chrome extension POSTs captured browsing context here

  Data is persisted to: ~/.claude/browser-context-mcp/store.json

MCP TOOLS EXPOSED
  get_recent_context      Recently visited pages with entity type, snippet, headings
  search_context          Full-text search over browsing history
  get_auth_tokens         All captured auth tokens with JWT claims
  get_pages_by_entity     Filter pages by type (ICM, ADO, GitHub, Teams...)
  get_recent_visits       Navigation history with time-spent per page
  get_token_for_domain    Full token entry for a specific domain
  check_token_health      Validity breakdown of all tokens (fresh/expiring/expired)
  check_token_for_domain  Check if a specific domain token is safe to use

ADD TO CLAUDE CODE (.mcp.json):
  {
    "mcpServers": {
      "browser-context": {
        "command": "npx",
        "args": ["ambient-mcp"]
      }
    }
  }

CHROME EXTENSION
  Install from the Chrome Web Store:
  https://chrome.google.com/webstore/detail/ambient-mcp

  Or load unpacked from: https://github.com/RajuRoopani/ambient-mcp/tree/main/extension

GITHUB
  https://github.com/RajuRoopani/ambient-mcp
`);
  process.exit(0);
}

if (args.includes('--version') || args.includes('-v')) {
  const pkg = require('../package.json');
  console.log(pkg.version);
  process.exit(0);
}

// Start the server
require('../server.js');
