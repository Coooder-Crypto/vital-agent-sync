# HealthLink Product Plan

HealthLink is a user-owned personal data bridge for AI agents. It lets a user connect authorized phone, watch, calendar, and feedback data to local or cloud-hosted agents without making every agent implement HealthKit, Calendar, pairing, permissions, and privacy controls.

The product is not an agent. It is an agent data gateway.

## Product Goal

The target experience:

```text
User asks an agent or runs a command to install HealthLink.
HealthLink starts a receiver and shows a QR code.
iOS app scans the QR code and pairs with the receiver.
User chooses which data to expose and grants Apple permissions once.
iOS app syncs compact summaries manually or automatically.
Agent queries the latest authorized personal context.
```

The user should not need to manually export files after setup. The iOS app syncs compact summaries to a user-controlled gateway endpoint. Agents query the latest available context through MCP or an SDK. The intended steady state is "pair once, authorize once, keep syncing, ask the Agent anytime."

For the detailed Agent connection UX, see [agent-connection.md](agent-connection.md). For the multi-source, multi-agent, multi-transport upgrade checklist, see [architecture-upgrade-todo.md](architecture-upgrade-todo.md).

## Principles

- User-owned by default.
- No cloud dependency required.
- Cloud or relay is optional, not mandatory.
- Sync summaries first, raw samples only by explicit advanced permission.
- Each agent gets a scoped token.
- Every agent access is auditable and revocable.
- Agents read context; they do not get direct HealthKit or calendar database access.
- The iOS app is the authority for Apple Health and iOS permissions.

## System Components

```text
healthlink-ios
  iOS app
  HealthKit / Calendar collection
  pairing UI
  connected-agent management

healthlink-local
  local daemon
  HTTP API
  SQLite store
  pairing sessions
  scoped agent tokens
  local MCP server
  optional reverse tunnel

@healthlink/mcp
  MCP server adapter for agents
  local or remote endpoint support
  pairing flow tools
  context query tools

@healthlink/sdk
  TypeScript client
  schemas
  webhook verifier
  scope helpers
```

The first implementation can combine `local`, `mcp`, and `sdk` into one npm package, then split them when the API stabilizes.

## Deployment Modes

### 1. Local Mode

Best for local MCP-compatible agents, desktop assistants, and developer machines.

```text
iPhone
  -> Wi-Fi / Tailscale
  -> local daemon on Mac/PC/NAS
  -> SQLite
  -> local MCP
  -> agent
```

User command:

```bash
npx -y healthlink-local init --hermes
```

The daemon prints:

```text
Local API: http://127.0.0.1:8787
LAN API:   http://192.168.31.25:8787
Pairing:   healthlink://pair?server=http://192.168.31.25:8787&code=8K2F-J91Q
```

The iOS app syncs summaries to the LAN or Tailscale endpoint. The agent talks to the local MCP stdio server. New syncs update SQLite; the agent reads fresh data on the next MCP tool call and does not need to reconnect after every sync.

Current development commands:

```bash
npm run dev:local
npm run build:local
node packages/local/dist/cli.js mcp
```

### 2. Tunnel Mode

Best for cloud-hosted agents where the user cannot run npm on the agent machine, but can run a local daemon on their own computer.

```text
iPhone
  -> public tunnel URL
  -> user computer local daemon
  -> SQLite

cloud agent
  -> remote MCP URL
  -> public tunnel URL
  -> user computer local daemon
```

User command:

```bash
npx -y healthlink-local --tunnel cloudflare
```

The daemon prints:

```text
Remote Pairing: healthlink://pair?server=https://abc.trycloudflare.com&code=8K2F-J91Q
Remote MCP:     https://abc.trycloudflare.com/mcp
```

The cloud agent should connect through a remote MCP endpoint or a tunnel-aware adapter. The tunnel only transports requests; the local daemon still enforces scopes and tokens.

Supported tunnel providers can be added progressively:

- Cloudflare Tunnel
- Tailscale Funnel
- ngrok
- user-provided reverse proxy

### 3. Self-Hosted Server Mode

Best for power users, teams, and users who already operate a VPS or home server.

```text
iPhone
  -> https://gateway.userdomain.com
  -> self-hosted HealthLink Server
  -> SQLite/Postgres

agents
  -> https://gateway.userdomain.com/mcp
```

Install options:

```bash
docker run personalgateway/server
```

or:

```bash
npx -y @healthlink/server
```

This mode gives stable URLs without the product owner hosting user data.

### 4. Optional Cloud Mode

This can be added later as a hosted convenience product.

```text
iPhone
  -> HealthLink Cloud
  -> hosted remote MCP
  -> agent
```

Cloud mode has the easiest UX but the highest privacy and compliance burden. It should not be required for the base product.

## Pairing Flow

The pairing flow should follow the shape of OAuth Device Code Flow, but the user-facing language should be "pairing code".

```text
1. User runs `healthlink-local init` or asks an agent to run it.
2. Gateway creates a short-lived pairing session.
3. Gateway displays a QR link.
4. iOS app scans the QR link.
5. iOS app shows server, transport mode, and requested scopes.
6. User selects scopes and approves.
7. Gateway issues a scoped device token.
8. iOS stores the paired server and token.
9. iOS pushes selected summaries to `/health/sync` manually or automatically.
10. Agent calls MCP tools against the local store.
```

After step 10, the link is persistent. Re-pairing is only needed when the user switches machines, revokes the device, deletes local data, changes the database path, or disconnects the iOS app.

Pairing session shape:

```json
{
  "pairing_code": "8K2F-J91Q",
  "pairing_url": "healthlink://pair?server=http://192.168.31.25:8787&code=8K2F-J91Q",
  "agent_name": "Desktop Assistant",
  "requested_scopes": [
    "health.daily.read",
    "calendar.availability.read",
    "feedback.write"
  ],
  "expires_in_seconds": 600
}
```

## iOS App Responsibilities

The iOS app owns:

- HealthKit authorization.
- Calendar authorization.
- Local sync endpoint configuration.
- Pairing code scan / input.
- Scope approval UI.
- Connected agents list.
- Agent revocation.
- Sync status and error visibility.
- Foreground auto-sync after pairing, app launch, and app foregrounding.
- Best-effort background sync through iOS-supported background mechanisms.

The iOS app does not need to run an agent, model, or MCP server.

Auto-sync should be user-controlled and throttled. It should not promise strict intervals because iOS background execution is opportunistic.

## Agent-Side Tools

The MCP server should expose a small, stable tool surface:

```text
healthlink_status
get_personal_context
get_daily_health_summary
get_calendar_availability
get_sleep_trend
get_workout_load
get_recovery_signals
list_devices
revoke_device
```

Tool behavior:

- `healthlink_status` returns device count, sync count, and latest sync time.
- `get_personal_context` returns the preferred combined context for broad questions about today, energy, recovery, schedule pressure, and planning.
- `get_daily_health_summary` returns daily health summary only.
- `get_calendar_availability` returns busy/free data, not event titles by default.
- Trend and load tools return compact multi-day signals.
- Device tools list and revoke paired devices.
- Missing data should be represented as `null`, empty arrays, or structured no-data responses.

Future tools:

```text
generate_weekly_health_report
record_feedback
request_refresh
```

## Agent Skill Layer

MCP remains the core protocol. A skill is an optional agent-specific usage guide.

HealthLink should ship a portable skill document, with Hermes as the first supported target. The skill should:

- trigger on natural-language questions about personal status, recovery, exercise readiness, daily planning, and schedule pressure
- call `get_personal_context` first
- use lower-level MCP tools for drill-down questions
- report data freshness
- avoid diagnosis, prescriptions, and unsupported medical claims
- keep calendar titles redacted

This should be additive. A generic MCP-compatible agent should still work without installing a HealthLink skill.

## Scope Model

Default scopes:

```text
health.daily.read
calendar.availability.read
feedback.write
```

Additional scopes:

```text
health.trends.read
health.workouts.read
calendar.next_event.read
profile.basic.read
sync.refresh.request
```

Sensitive scopes, disabled by default:

```text
health.raw_samples.read
calendar.events.read
location.coarse.read
location.history.read
```

The product should make sensitive scopes visibly different in the iOS approval UI.

## Data Model

The gateway should store compact normalized records.

```text
devices
agents
agent_tokens
pairing_sessions
health_daily_summary
calendar_daily_summary
feedback_events
refresh_requests
audit_log
```

The first local daemon can use SQLite. A self-hosted server can support Postgres later.

Daily health summary:

```json
{
  "date": "2026-06-22",
  "timezone": "Asia/Shanghai",
  "provider": "apple_health",
  "steps": 7320,
  "sleep_minutes": 386,
  "resting_heart_rate_bpm": 62,
  "avg_heart_rate_bpm": 82,
  "max_heart_rate_bpm": 146,
  "active_energy_kcal": 480,
  "workout_minutes": 45
}
```

Current context:

```json
{
  "date": "2026-06-22",
  "timezone": "Asia/Shanghai",
  "health": {
    "sleep_minutes": 386,
    "steps": 7320,
    "resting_heart_rate_bpm": 62,
    "workout_minutes": 45
  },
  "calendar": {
    "busy_level": "medium",
    "free_windows": [
      {"start": "2026-06-22T19:00:00+08:00", "end": "2026-06-22T21:00:00+08:00"}
    ]
  },
  "freshness": {
    "health_synced_at": "2026-06-22T08:31:00+08:00",
    "calendar_synced_at": "2026-06-22T10:12:00+08:00",
    "is_stale": false
  }
}
```

## Network Design

The iOS app syncs to one active gateway endpoint:

```text
http://192.168.31.25:8787
http://100.x.y.z:8787
https://abc.trycloudflare.com
https://gateway.userdomain.com
```

Endpoint discovery should progress in phases:

1. Manual URL input.
2. Pairing QR code.
3. Bonjour / mDNS local discovery.
4. Tailscale instructions / MagicDNS.
5. Tunnel setup from the npm daemon.

For MVP, local HTTP can be allowed for LAN development. Production should prefer HTTPS or pinned local certificates.

## Security Requirements

- Pairing code expires after 10 minutes.
- Pairing code is single-use.
- Agent tokens are scoped.
- Device tokens are separate from agent tokens.
- Tunnel URL alone must not grant data access.
- Every agent read/write action creates an audit log entry.
- iOS app can revoke any agent.
- Local daemon should bind admin APIs to `127.0.0.1` only.
- Remote tunnel should expose only MCP and approved public endpoints.
- Raw HealthKit samples are never exposed unless explicitly enabled.
- Calendar titles, notes, locations, attendees are redacted by default.

## MVP Roadmap

### Milestone 1: Local Daemon

- `healthlink-local`
- SQLite store
- health/calendar sync endpoints
- MCP query tools
- pairing sessions
- scoped agent tokens
- local MCP stdio support

Status: implemented for the local development path.

### Milestone 2: iOS Pairing

- scan QR / input code
- fetch pairing details
- approve scopes
- connected agents list
- revoke agent
- manual sync to paired local daemon
- foreground auto-sync with throttling
- best-effort background refresh

Status: partially implemented. QR scanner, scope confirmation, manual sync, connected device display, and revocation are implemented for the local path. Foreground auto-sync and background refresh remain.

### Milestone 3: Foolproof Agent Linking

- `healthlink-local init`
- `healthlink-local init --hermes`
- QR page opened or printed automatically
- `print-mcp-config`
- `install-hermes`
- `status` and `doctor`
- optional HealthLink skill installer
- generic MCP config docs for other agents

Exit criteria:

- A user can install the receiver with one command.
- The iOS app can pair by scanning, without copying URL/token text.
- An agent can query HealthLink without hand-authoring MCP JSON.
- After the first reload/restart, new iOS syncs are visible to the agent without reconnecting.

### Milestone 4: Remote Agent Support

- `--tunnel cloudflare`
- remote MCP endpoint
- token enforcement over tunnel
- audit log UI

### Milestone 5: SDK And Packaging

- `@healthlink/sdk`
- TypeScript types
- Zod schemas
- webhook verifier
- install docs for common agents

### Milestone 6: Self-Hosted Server

- Docker image
- HTTPS deployment guide
- Postgres option
- backup/restore docs

## Non-Goals For The First Version

- No full chat history import.
- No SMS or WeChat database extraction.
- No raw minute-level heart-rate export by default.
- No medical diagnosis.
- No always-on iPhone background service guarantee.
- No requirement to use a hosted cloud service.

## Success Criteria

First useful demo:

```text
User runs healthlink-local or npm run dev:local.
Receiver shows pairing code.
iOS app pairs with receiver.
iOS app syncs Apple Health and Calendar summaries.
Agent calls MCP tools and receives useful fresh context.
iOS syncs again and the agent reads updated context without re-pairing or reloading MCP.
```

Product-quality criteria:

- Setup under 5 minutes for a local user.
- Setup under 10 minutes for a cloud-agent user using tunnel mode.
- Default payloads contain no raw samples or calendar titles.
- Agent tools return freshness metadata.
- Revocation takes effect immediately.
