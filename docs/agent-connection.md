# Agent Connection UX

This document defines the target "foolproof" path for connecting HealthLink iOS to Hermes Agent or any other agent runtime.

For the longer-term adapter architecture and implementation checklist covering Android, Xiaomi, OpenClaw, WorkBuddy, Tailscale, tunnels, and public HTTPS, see [architecture-upgrade-todo.md](architecture-upgrade-todo.md).
For adapter implementation guidance, see [architecture-adapter-design.md](architecture-adapter-design.md).

## Target User Experience

```text
1. User asks an agent or runs a command to install HealthLink.
2. HealthLink starts an Agent-side receiver and shows a QR code.
3. User scans the QR code with the iOS app.
4. User selects which data types to expose.
5. User authorizes Apple Health / Calendar once.
6. The Agent-side receiver stores the data locally.
7. The iOS app syncs compact summaries manually or automatically.
8. The agent reads the latest stored data through MCP tools.
```

The user should not manually copy tokens, edit SQLite, or understand HealthKit. The only required setup steps should be "run install", "scan QR", "approve scopes", and "grant Apple permissions". Manual sync remains available, but the product expectation is pair once, authorize once, then keep the local Agent context fresh automatically when iOS allows it.

## Product Boundary

HealthLink has three roles:

```text
HealthLink iOS
  Apple permissions
  HealthKit / Calendar collection
  scope selection
  manual and automatic sync

@healthlink/local
  pairing QR
  /health/sync receiver
  SQLite/Postgres storage
  MCP tools

Agent runtime
  calls MCP tools
  generates analysis, reports, advice, or automations
  may load optional HealthLink skills
```

The agent never talks to HealthKit directly. The cloud should not become a health data warehouse by default.

## Persistent Link Model

HealthLink does not rely on a live socket between iOS and the Agent. Pairing creates persistent local state:

```text
iOS app
  server URL
  source_device_id
  device token in Keychain

@healthlink/local
  paired source devices
  scoped token hashes
  ~/.healthlink/healthlink.sqlite

Hermes or another agent
  MCP config pointing to healthlink-local mcp
  optional HealthLink skill instructions
```

Normal use after setup is:

```text
iOS sync -> SQLite updated
Agent question -> MCP tool reads SQLite
```

The Agent does not need to reload MCP after each sync. Reload or restart is only needed when the MCP configuration, tool code, database path, or skill files change.

Reconnect or re-pair only when:

- the user switches Agent machines
- the database path changes
- the device token is revoked
- the user disconnects in the iOS app
- local HealthLink data is deleted
- Hermes config is removed or rewritten

Product language:

```text
Pair once. HealthLink keeps your local Agent updated automatically. Ask your Agent anytime.
```

## Sync Lifecycle

Current MVP:

- user can trigger sync manually from the iOS app
- sync writes compact summaries to `/health/sync`
- MCP tools read the latest rows at query time

Expected near-term iOS behavior:

- auto sync immediately after successful pairing and permission grant
- auto sync when the app launches or returns to foreground
- throttle auto sync by a minimum interval, such as 30 minutes
- skip auto sync when not paired, already syncing, missing permissions, or recently attempted
- keep a manual Sync button for explicit refresh

Background sync should be best-effort, not a strict schedule:

- use `BGAppRefreshTask` / `BGProcessingTask` where appropriate
- use HealthKit observer queries and background delivery where possible
- never promise exact intervals like "every 30 minutes"

Recommended UX copy:

```text
HealthLink syncs automatically after authorization and when iOS allows background refresh. You can also sync manually anytime.
```

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

### Mode D: Tailscale

For users who already run a tailnet:

```bash
healthlink-local init --transport tailscale --tailscale-name my-mac.tailnet.ts.net
```

HealthLink can also try to read Tailscale MagicDNS from `tailscale status --json`, or fall back to the local 100.64.0.0/10 address when available.

## CLI Shape

The Hermes-first local install command should be:

```bash
npx -y @healthlink/local setup --agent hermes --service
```

`setup --agent hermes --service` should:

- Check Node.js version.
- Create `~/.healthlink/`.
- Initialize SQLite.
- Back up and write `~/.hermes/config.yaml`.
- Install and start the background HTTP receiver.
- Create a short-lived pairing session.
- Open or print the pairing page.
- Print MCP config for common agents.
- Tell the user to restart Hermes or run `/reload-mcp`.
- Optional future behavior: install or update a HealthLink skill for Hermes.

The foreground compatibility receiver remains:

```bash
npx -y @healthlink/local init
```

It starts the same receiver without writing a Hermes config and remains attached to the terminal.

The background service commands are:

```bash
npx -y @healthlink/local daemon
npx -y @healthlink/local pair
npx -y @healthlink/local service install
npx -y @healthlink/local service start
npx -y @healthlink/local service status
npx -y @healthlink/local service stop
npx -y @healthlink/local service uninstall
```

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

Implemented local MVP command:

```bash
npm run build:local
node packages/local/dist/cli.js setup --agent hermes --service
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

Implemented helpers:

```bash
npx -y @healthlink/local print-mcp-config
npx -y @healthlink/local install-hermes
npx -y @healthlink/local init --hermes
npx -y @healthlink/local setup --agent hermes --service
npx -y @healthlink/local service status
npx -y @healthlink/local pair
npx -y @healthlink/local status
npx -y @healthlink/local doctor
```

The helpers should not invent new protocols. They should write or print the same MCP command with the correct database path. `setup --agent hermes --service` uses the same install logic as `install-hermes`, installs/starts the receiver service, and folds pairing into one Agent-driven flow. `init --hermes` remains the foreground compatibility path.

## Skill Layer

MCP is the product protocol. Skills are optional agent-specific instructions that improve natural-language tool use.

HealthLink should provide a small, portable skill document for agents that support skills. Hermes can be the first-class target.

Skill responsibilities:

- recognize questions such as "How am I today?", "Should I exercise?", "How should I plan today?", "Am I recovered?", and "Is my schedule overloaded?"
- call `get_personal_context` first for broad personal-context questions
- use lower-level tools only for drill-down questions
- report data freshness before analysis
- combine health, sleep, activity, recovery, and calendar pressure
- avoid diagnosis, prescriptions, or unsupported medical claims
- keep calendar titles redacted

Potential helper commands:

```bash
npx -y @healthlink/local print-skill --format markdown
npx -y @healthlink/local install-hermes-skill
npx -y @healthlink/local init --hermes --install-skill
```

These should remain additive. Non-Hermes agents should still work through generic MCP config alone.

## Current MCP Tools

Current implemented tools:

```text
healthlink_status
get_personal_context
get_daily_health_summary
get_calendar_availability
get_sleep_trend
get_workout_load
get_recovery_signals
get_weekly_summary
record_feedback
list_source_devices
revoke_source_device
list_devices
revoke_device
```

Tool rules:

- Use `get_personal_context` first for broad natural-language questions about today, energy, recovery, exercise readiness, schedule pressure, and day planning.
- Use `list_source_devices` and `revoke_source_device` for setup and troubleshooting. `list_devices` and `revoke_device` remain legacy aliases.
- Use `record_feedback` only when the user explicitly gives a correction, preference, or usefulness rating.
- Return compact summaries, not raw samples.
- Include enough timestamps for freshness checks.
- Redact calendar event titles by default.
- Return empty structured data when a date has no samples.

## Development Priorities

Next work after the local pairing MVP should focus on lifecycle and transport:

```text
P1  foreground auto sync with throttling
P1  auto sync after pairing / permission grant
P1  disconnect / revoke paired device
P1  richer local diagnostics
P1  optional Hermes skill installer
P1  background refresh as best-effort, not guaranteed cadence
P1  public HTTPS mode docs
P2  tunnel mode
P2  payload signatures and E2E encryption
```

The current local data path is implemented:

```text
iOS app -> /health/sync -> SQLite -> MCP tools
```

The target steady-state behavior is:

```text
pair once -> authorize once -> auto/manual sync -> ask Agent anytime
```
