# @healthlink/local

Local Agent-side runtime for HealthLink.

This package provides:

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

## Commands

Current package commands:

```bash
npx -y @healthlink/local
npx -y @healthlink/local init
npx -y @healthlink/local --port 8787
npx -y @healthlink/local --db ~/.healthlink/healthlink.sqlite
npx -y @healthlink/local mcp
npx -y @healthlink/local print-mcp-config
npx -y @healthlink/local install-hermes
```

Foolproof local pairing command:

```bash
npx -y @healthlink/local init
```

`init` starts the receiver, creates a pairing session, prints a terminal QR code, shows the QR page URL, and prints MCP config hints for agents. It runs in the foreground.

## Pairing And Sync

Run the local receiver:

```bash
npm run dev:local
```

Expected output:

```text
HealthLink Local running

Pairing page: http://127.0.0.1:8787/pair
LAN address:  http://192.168.x.x:8787
Local API:    http://127.0.0.1:8787
Database:     ~/.healthlink/healthlink.sqlite
```

Open the pairing page or scan the terminal QR code with HealthLink iOS, approve the pairing, then sync from the iOS app.

The iPhone must use the LAN, Tailscale, tunnel, or public HTTPS address. `127.0.0.1` only works from the same machine as the receiver.

## Agent Integration

Use MCP mode for Hermes or any MCP-compatible agent:

```bash
npm run build:local
node packages/local/dist/cli.js mcp
node packages/local/dist/cli.js mcp --db ~/.healthlink/healthlink.sqlite
```

Local development MCP config:

```json
{
  "mcpServers": {
    "healthlink": {
      "command": "node",
      "args": [
        "/Users/coooder/Code/Agent/personal-gateway-ios/packages/local/dist/cli.js",
        "mcp",
        "--db",
        "/Users/coooder/.healthlink/healthlink.sqlite"
      ]
    }
  }
}
```

Published package MCP config:

```json
{
  "mcpServers": {
    "healthlink": {
      "command": "npx",
      "args": ["-y", "@healthlink/local", "mcp"]
    }
  }
}
```

Available MCP tools:

- `healthlink_status`
- `get_daily_health_summary`
- `get_calendar_availability`
- `get_sleep_trend`
- `get_workout_load`
- `get_recovery_signals`

## Install Helpers

```bash
npx -y @healthlink/local print-mcp-config
npx -y @healthlink/local install-hermes
```

`print-mcp-config` prints standard `mcpServers.healthlink` JSON. `install-hermes` backs up `~/.hermes/config.yaml`, writes `mcp_servers.healthlink`, and uses the same local database and tool surface as `@healthlink/local mcp`.
