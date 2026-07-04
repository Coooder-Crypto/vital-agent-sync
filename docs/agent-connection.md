# Agent Connection UX

This document defines the target "foolproof" path for connecting HealthLink iOS to Hermes Agent or any other agent runtime.

## Target User Experience

```text
1. User asks an agent or runs a command to install HealthLink.
2. HealthLink starts an Agent-side receiver and shows a QR code.
3. User scans the QR code with the iOS app.
4. User selects which data types to expose.
5. User taps sync in the iOS app.
6. The Agent-side receiver stores the data locally.
7. The agent reads the data through MCP tools.
```

The user should not manually copy tokens, edit SQLite, or understand HealthKit. The only manual steps should be "run install", "scan QR", "approve scopes", and "sync".

## Product Boundary

HealthLink has three roles:

```text
HealthLink iOS
  Apple permissions
  HealthKit / Calendar collection
  scope selection
  user-initiated sync

@healthlink/local
  pairing QR
  /health/sync receiver
  SQLite/Postgres storage
  MCP tools

Agent runtime
  calls MCP tools
  generates analysis, reports, advice, or automations
```

The agent never talks to HealthKit directly. The cloud should not become a health data warehouse by default.

## Connection Modes

HealthLink should expose one product flow with multiple transport modes underneath.

### Mode A: LAN

Default for MVP and local agents.

```text
iPhone -> http://192.168.x.x:8787 -> @healthlink/local -> SQLite -> MCP -> Agent
```

Pros:

- No cloud dependency.
- Best privacy story.
- Easy local debugging.

Limits:

- iPhone and Agent receiver must be on the same reachable network.
- The iPhone cannot use `127.0.0.1`; QR must use LAN, Tailscale, or public address.

### Mode B: Public HTTPS

For agents deployed on a VPS or a user-controlled server.

```text
iPhone -> https://agent.example.com/healthlink -> HealthLink receiver -> storage -> MCP -> Agent
```

Requirements:

- Public DNS name.
- HTTPS certificate.
- Firewall allows receiver port.
- QR uses the public URL.

### Mode C: Tunnel / Relay

For users who cannot expose a local machine or configure public HTTPS.

```text
iPhone -> tunnel or relay URL -> user Agent receiver -> storage -> MCP -> Agent
```

The relay must be a transport layer, not a data platform. Payloads should be end-to-end encrypted before this mode is treated as production-quality.

## CLI Shape

The final install command should be:

```bash
npx -y @healthlink/local init
```

`init` should:

- Check Node.js version.
- Create `~/.healthlink/`.
- Initialize SQLite.
- Generate or reuse local receiver identity.
- Start the HTTP receiver.
- Create a short-lived pairing session.
- Open or print the pairing page.
- Print MCP config for common agents.

Expected output:

```text
HealthLink Local running

Pair with iPhone:
  http://127.0.0.1:8787/pair

Reachable from phone:
  http://192.168.31.230:8787

Database:
  ~/.healthlink/healthlink.sqlite

MCP:
  npx -y @healthlink/local mcp
```

Current development command:

```bash
npm run dev:local
```

## Pairing QR Payload

The QR should carry a pairing URL or equivalent JSON payload:

```text
healthlink://pair?server=http%3A%2F%2F192.168.31.230%3A8787&code=8K2F-J91Q
```

Future payload fields:

```json
{
  "server_url": "http://192.168.31.230:8787",
  "pairing_code": "8K2F-J91Q",
  "transport": "lan",
  "agent_name": "Hermes Agent",
  "agent_public_key": "...",
  "requested_scopes": [
    "health.daily_summary.write",
    "calendar.daily_summary.write"
  ],
  "expires_at": "2026-07-04T06:00:00Z"
}
```

## Agent Integration

The Agent-facing interface is MCP.

Local development config:

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

Published package config:

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

Planned helpers:

```bash
npx -y @healthlink/local install-hermes
npx -y @healthlink/local install-claude
npx -y @healthlink/local print-mcp-config
```

The helpers should not invent new protocols. They should write or print the same MCP command with the correct database path.

## Current MCP Tools

Current implemented tools:

```text
healthlink_status
get_daily_health_summary
get_calendar_availability
get_sleep_trend
get_workout_load
get_recovery_signals
```

Tool rules:

- Return compact summaries, not raw samples.
- Include enough timestamps for freshness checks.
- Redact calendar event titles by default.
- Return empty structured data when a date has no samples.

## Development Priorities

Next work should focus on setup and pairing UX:

```text
P0  @healthlink/local init
P0  in-app QR scanner
P0  pairing confirmation screen with scopes
P0  print-mcp-config / install-hermes helper
P1  disconnect / revoke paired device
P1  public HTTPS mode docs
P2  tunnel mode
P2  payload signatures and E2E encryption
```

The current local data path is already proven:

```text
iOS app -> /health/sync -> SQLite -> MCP tools
```
