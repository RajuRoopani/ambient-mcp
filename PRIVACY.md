# Privacy Policy — Ambient MCP

**Last updated:** March 2026

## Overview

Ambient MCP is a Chrome extension that captures browsing context (page titles, URLs, text snippets) and auth tokens from your browser and makes them available to AI agents running locally on your machine via the Model Context Protocol (MCP).

**All data stays on your machine. Nothing is sent to any external server.**

---

## What data is collected

| Data | What is captured |
|------|-----------------|
| Page context | Page title, URL, visible text snippet, headings, time spent |
| Auth tokens | Bearer tokens from outgoing HTTP request headers, decoded JWT claims (user, audience, expiry) |
| Navigation history | URLs visited, timestamps, time-on-page |

## What data is NOT collected

- No passwords or form inputs
- No credit card or payment information
- No personal messages or email content
- No file system access
- No microphone, camera, or location data
- No analytics, crash reports, or telemetry of any kind

---

## How data is stored

All captured data is written to a local file on your own machine:

```
~/.claude/browser-context-mcp/store.json
```

This file is created and managed by the local MCP server (`npx ambient-mcp`) that you run yourself. It is never uploaded anywhere.

**Retention:** Page context entries are automatically deleted after 5 days. Expired auth tokens are deleted after 24 hours.

---

## How data is transmitted

The extension sends captured data via HTTP POST to `http://localhost:3457` — a local server running on your own computer. This is a loopback connection that never leaves your machine.

No data is sent to:
- The extension developer
- Any cloud service, analytics platform, or third party
- Any server outside your local network

---

## Who can access the data

Only you. The data is stored in your home directory and served on localhost. No remote party has access to it.

---

## Open source

This extension is fully open source. You can inspect every line of code at:

**https://github.com/RajuRoopani/ambient-mcp**

---

## Contact

If you have questions about this privacy policy, open an issue at:

**https://github.com/RajuRoopani/ambient-mcp/issues**

---

*This extension does not collect, transmit, or share any personal data with the developer or any third party.*
