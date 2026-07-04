# @healthlink/local

Local Agent-side runtime for HealthLink.

This package will provide:

- LAN pairing page with QR code.
- Device pairing endpoints.
- Health and calendar sync ingest.
- SQLite local storage.
- MCP tools for agents.

## Development

From the repository root:

```bash
npm install
npm run dev:local
```

The default local server will use port `8787`.

## Planned Commands

```bash
npx -y @healthlink/local
npx -y @healthlink/local --port 8787
npx -y @healthlink/local --db ~/.healthlink/healthlink.sqlite
npx -y @healthlink/local mcp
```

