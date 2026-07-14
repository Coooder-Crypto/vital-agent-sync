# Vital Agent Sync Product Plan

Vital Agent Sync is a user-owned personal data bridge for AI agents. It lets a user connect authorized phone, watch, and feedback data to local or cloud-hosted agents without making every agent implement HealthKit, pairing, permissions, and privacy controls.

The product is not an agent. It is an agent data gateway.

## Product Goal

The target experience:

```text
User asks an agent or runs a command to install Vital Agent Sync.
Vital Agent Sync starts a receiver and shows a QR code.
iOS app scans the QR code and pairs with the receiver.
User chooses which data to expose and grants Apple permissions once.
iOS app syncs compact summaries manually or automatically.
Agent queries the latest authorized personal context.
```

The user should not need to manually export files after setup. The iOS app syncs compact summaries to a user-controlled gateway endpoint. Agents query the latest available context through MCP or an SDK. The intended steady state is "pair once, authorize once, keep syncing, ask the Agent anytime."

For the canonical Agent-first install and onboarding flow, see [agent-first-onboarding.md](agent-first-onboarding.md). For the detailed Agent connection UX, see [agent-connection.md](agent-connection.md). For common deployment methods, see [deployment-methods.md](deployment-methods.md). For the multi-source, multi-agent, multi-transport upgrade checklist, see [architecture-upgrade-todo.md](architecture-upgrade-todo.md).

## Principles

- User-owned by default.
- No cloud dependency required.
- Cloud or relay is optional, not mandatory.
- Sync summaries first, raw samples only by explicit advanced permission.
- Each agent gets a scoped token.
- Every agent access is auditable and revocable.
- Agents read context; they do not get direct HealthKit database access.
- The iOS app is the authority for Apple Health and iOS permissions.

## System Components

```text
healthlink-ios
  iOS app
  HealthKit collection
  pairing UI
  connected-agent management

vitalmcp
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

## Common Deployment Methods

Vital Agent Sync deployment is about where the receiver, database, and MCP process run. Agent runtime choice is a separate adapter concern.

The first supported methods are documented in [deployment-methods.md](deployment-methods.md):

### 1. Mac Local Mode

Best for first-time setup, local MCP-compatible agents, and developer machines.

```text
iPhone
  -> same Wi-Fi / LAN
  -> macOS Vital Agent Sync receiver
  -> ~/.healthlink/healthlink.sqlite
  -> MCP stdio
  -> MCP-compatible Agent
```

Recommended command:

```bash
npx -y vitalmcp setup
```

The iOS app syncs summaries to the Mac receiver. The Agent reads the same SQLite database through MCP and does not need to reconnect after every iOS sync.

### 2. Home Server / NAS / N100 Mode

Best for users with an always-on machine at home.

```text
iPhone
  -> LAN or Tailscale
  -> home server receiver
  -> server-local SQLite
  -> MCP stdio on the server or LAN
  -> MCP-compatible Agent
```

Recommended receiver command on Linux home servers:

```bash
vitalmcp setup --agent generic --manager systemd
```

Tailscale is the preferred private remote-access option for this mode:

```bash
vitalmcp setup --transport tailscale --tailscale-name receiver.example-tailnet.ts.net --agent generic
```

This configures a tailnet-only Tailscale Serve HTTPS route and advertises its trusted `.ts.net` URL to iOS. See [Tailscale HTTPS Onboarding For iOS](tailscale-ios-onboarding.md).

This installs a user-level systemd service for the receiver, waits until it is reachable, and prints a pairing QR. If systemd is not available on the NAS, use PM2, Docker Compose, or the NAS vendor's process manager to keep the daemon running. Windows hosts are detected as manual until Task Scheduler or Windows Service support is added.

### 3. Docker Compose Mode

Best for NAS/N100, WSL, Windows Docker Desktop, and users who prefer container-managed receiver deployment.

```text
iPhone
  -> host LAN / Tailscale / HTTPS URL
  -> Docker host port 8787
  -> Vital Agent Sync receiver container
  -> /data/healthlink.sqlite mounted volume
  -> MCP-compatible Agent on the host or shared volume
```

Recommended standalone compose generation command:

```bash
vitalmcp print-docker-compose --server-url http://192.168.31.53:8787 > docker-compose.yml
```

Docker mode requires an explicit iPhone-reachable `server_url`. `127.0.0.1`, `localhost`, container names, and WSL-only IPs should not be used in pairing URLs.

### 4. User-Owned VPS / Public HTTPS Mode

Best for users whose receiver and Agent already run on a user-controlled VPS.

```text
iPhone
  -> HTTPS
  -> user-owned VPS receiver
  -> VPS-local SQLite
  -> MCP stdio on the VPS
  -> MCP-compatible Agent
```

Recommended receiver command behind a user-managed reverse proxy:

```bash
vitalmcp daemon \
  --host 0.0.0.0 \
  --port 8787 \
  --transport public_https \
  --server-url https://healthlink.example.com
```

This mode requires the user to provide HTTPS, DNS, persistence, and server hardening. Health summaries leave the phone and home network, but remain on infrastructure controlled by the user.

Future deployment work can add tunnel managers, an official published Docker image, remote MCP over HTTPS, and a Vital Agent Sync-hosted relay. Those are intentionally not part of the first deployment pass.

## Pairing Flow

The pairing flow should follow the shape of OAuth Device Code Flow, but the user-facing language should be "pairing code".

```text
1. User runs `vitalmcp init` or asks an agent to run it.
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
  "pairing_url": "vitalmcp://pair?server=http://192.168.31.25:8787&code=8K2F-J91Q",
  "agent_name": "Desktop Assistant",
  "requested_scopes": [
    "health.daily.read",
    "feedback.write"
  ],
  "expires_in_seconds": 600
}
```

## iOS App Responsibilities

The iOS app owns:

- HealthKit authorization.
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
get_sleep_trend
get_workout_load
get_recovery_signals
list_devices
revoke_device
```

Tool behavior:

- `healthlink_status` returns device count, sync count, and latest sync time.
- `get_personal_context` returns the preferred combined context for broad questions about today, energy, recovery, and activity.
- `get_daily_health_summary` returns daily health summary only.
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

Vital Agent Sync should ship a portable skill document, with Hermes as the first supported target. The skill should:

- trigger on natural-language questions about personal status, recovery, exercise readiness, and activity
- call `get_personal_context` first
- use lower-level MCP tools for drill-down questions
- report data freshness
- avoid diagnosis, prescriptions, and unsupported medical claims

This should be additive. A generic MCP-compatible agent should still work without installing a Vital Agent Sync skill.

## Scope Model

Default scopes:

```text
health.daily.read
feedback.write
```

Additional scopes:

```text
health.trends.read
health.workouts.read
profile.basic.read
sync.refresh.request
```

Sensitive scopes, disabled by default:

```text
health.raw_samples.read
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
  "freshness": {
    "health_synced_at": "2026-06-22T08:31:00+08:00",
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

## MVP Roadmap

### Milestone 1: Local Daemon

- `vitalmcp`
- SQLite store
- health sync endpoints
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

- `vitalmcp init`
- `vitalmcp init --hermes`
- QR page opened or printed automatically
- `print-mcp-config`
- `install-hermes`
- `status` and `doctor`
- optional Vital Agent Sync skill installer
- generic MCP config docs for other agents

Exit criteria:

- A user can install the receiver with one command.
- The iOS app can pair by scanning, without copying URL/token text.
- An agent can query Vital Agent Sync without hand-authoring MCP JSON.
- After the first reload/restart, new iOS syncs are visible to the agent without reconnecting.

### Milestone 4: Common Deployment Methods

- Mac local deployment guide
- home server / NAS / N100 deployment guide
- Linux systemd user service installer
- Docker Compose and WSL deployment guide
- Tailscale pairing guidance
- user-owned VPS / public HTTPS deployment guide
- clear privacy boundary for each method

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
User runs vitalmcp or npm run dev:local.
Receiver shows pairing code.
iOS app pairs with receiver.
iOS app syncs Apple Health summaries.
Agent calls MCP tools and receives useful fresh context.
iOS syncs again and the agent reads updated context without re-pairing or reloading MCP.
```

Product-quality criteria:

- Setup under 5 minutes for a local user.
- Setup under 10 minutes for a cloud-agent user using tunnel mode.
- Default payloads contain no raw samples.
- Agent tools return freshness metadata.
- Revocation takes effect immediately.
