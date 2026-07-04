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
npx -y @healthlink/local init --hermes
npx -y @healthlink/local --port 8787
npx -y @healthlink/local --db ~/.healthlink/healthlink.sqlite
npx -y @healthlink/local mcp
npx -y @healthlink/local print-mcp-config
npx -y @healthlink/local install-hermes
npx -y @healthlink/local status
npx -y @healthlink/local doctor
```

Foolproof local pairing command:

```bash
npx -y @healthlink/local init --hermes
```

`init` starts the receiver, creates a pairing session, prints a terminal QR code, shows the QR page URL, and prints MCP config hints for agents. It runs in the foreground. Add `--hermes` to also back up and write `~/.hermes/config.yaml` before the receiver starts, so Hermes uses the same default database after restart or `/reload-mcp`.

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
- `get_personal_context`
- `get_daily_health_summary`
- `get_calendar_availability`
- `get_sleep_trend`
- `get_workout_load`
- `get_recovery_signals`
- `list_devices`
- `revoke_device`

Use `get_personal_context` as the default high-level entry for natural language questions like "How am I today?", "How should I plan today?", "Should I exercise?", "Am I recovered?", or "Is my schedule overloaded?". It returns sync status, latest health, calendar availability, sleep trend, workout load, and recovery signals together.

## Install Helpers

```bash
npx -y @healthlink/local print-mcp-config
npx -y @healthlink/local install-hermes
npx -y @healthlink/local init --hermes
```

`print-mcp-config` prints standard `mcpServers.healthlink` JSON. `install-hermes` backs up `~/.hermes/config.yaml`, writes `mcp_servers.healthlink`, and uses the same local database and tool surface as `@healthlink/local mcp`. `init --hermes` performs the same Hermes install step as part of the foreground pairing flow.

Use `status` to inspect the local database and paired devices. Use `doctor` to check Node.js, the SQLite database, MCP command generation, and whether Hermes has a HealthLink MCP entry.
