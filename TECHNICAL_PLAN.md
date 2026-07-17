# Vital Agent Sync Technical Plan

## 1. Product Shape

Vital Agent Sync is a private data bridge between a user's iPhone and the user's own local Agent runtime.

It is not a cloud health platform, not a medical product, and not an AI coach by itself. The iOS app owns Apple permissions and data collection. The local Agent server owns storage, pairing, Agent-facing tools, and analysis.

The first production-worthy shape should be:

```text
Vital Agent iOS app
  -> local network sync
  -> vitalmcp
  -> SQLite
  -> MCP tools
  -> user's Agent
```

The system should keep three boundaries clear:

- iOS reads HealthKit and Calendar only after explicit user authorization.
- The phone pushes data to the Agent server; the Agent does not pull from the phone.
- The Agent server exposes summarized context to agents; it does not need raw HealthKit samples by default.

## 2. Development Strategy

Combine v0.1 and v0.2 into one Local Pairing MVP.

The goal is to make a user install and pair quickly:

```bash
npx -y vitalmcp init
```

Then:

```text
1. vitalmcp starts a local HTTP server.
2. It opens or prints a pairing URL.
3. The pairing page shows a QR code.
4. Vital Agent iOS app scans the QR code.
5. User confirms the server and requested scopes.
6. iOS stores the paired server and device token.
7. iOS manually syncs daily summaries.
8. Agent queries data through local MCP tools.
```

The current development command is `npm run dev:local`. The published-package target is `npx -y vitalmcp init`.

This gives a complete end-to-end product path before adding background sync, remote tunnel mode, or hosted cloud.

## 3. Repository And Package Plan

The current repository contains the iOS app and the first Agent-side Node package.

Current monorepo structure:

```text
Vital Agent Sync repo
  apps/
    ios/
      App/
      Resources/
      Tests/
      project.yml
    www/
  docs/
  packages/
    local/
      package.json
      src/
        cli.ts
        server.ts
        pairing.ts
        database.ts
        health-ingest.ts
        mcp.ts
        schemas.ts
      migrations/
      public/
        pair.html
```

Early package:

```text
vitalmcp
```

Do not split `@vital-agent-sync/mcp` or `@vital-agent-sync/sdk` yet. Keep MCP, schemas, SQLite, and HTTP ingest inside `vitalmcp` until the interfaces stabilize.

Later split:

```text
vitalmcp  local daemon, SQLite, pairing, HTTP ingest
@vital-agent-sync/mcp    MCP server adapter if it becomes reusable
@vital-agent-sync/sdk    schemas, typed client, verifier helpers
```

## 4. Local Agent Server

### CLI

The package exposes:

```bash
npx -y vitalmcp
npx -y vitalmcp --port 8787
npx -y vitalmcp --db ~/.vital-agent-sync/vital-agent.sqlite
npx -y vitalmcp mcp
```

The target setup command is:

```bash
npx -y vitalmcp init
```

`init` should wrap server startup, pairing session creation, QR display, and MCP config output.

Default startup output:

```text
Vital Agent Sync runtime running

Pairing page: http://127.0.0.1:8787/pair
LAN address:  http://192.168.1.23:8787
MCP command:  npx -y vitalmcp mcp
Database:     ~/.vital-agent-sync/vital-agent.sqlite
```

MCP currently runs over stdio, not HTTP.

### Server Binding

For the Local Pairing MVP, bind to `0.0.0.0` so the iPhone can reach the machine on LAN. Print both loopback and LAN addresses.

Admin-only routes should later bind to `127.0.0.1` or require an admin token. In the MVP, keep admin routes minimal and avoid destructive remote actions.

### Runtime Choice

Use Node.js with TypeScript.

Recommended stack:

- HTTP server: Fastify or Hono.
- Validation: Zod.
- SQLite: better-sqlite3 or node:sqlite if the chosen Node baseline supports it.
- QR: generated in the web page from the pairing payload.
- MCP: use the official MCP TypeScript SDK when adding MCP tools.

Keep the first server small and boring. Avoid queues, background workers, user accounts, OAuth, and cloud dependencies in the Local Pairing MVP.

## 5. Pairing Protocol

### Endpoints

```text
POST /pair/start
GET  /pair/status/:pairing_code
POST /pair/confirm
POST /health/sync
GET  /health/status
GET  /pair
```

### Pairing Session

`POST /pair/start` creates a short-lived session:

```json
{
  "pairing_code": "8K2F-J91Q",
  "pairing_url": "vitalmcp://pair?server=http://192.168.1.23:8787&code=8K2F-J91Q",
  "server_url": "http://192.168.1.23:8787",
  "agent_name": "Local Agent",
  "requested_scopes": [
    "health.daily_summary.write",
    "calendar.daily_summary.write"
  ],
  "expires_in_seconds": 600
}
```

The QR code can encode either the `vitalmcp://pair?...` URL or a JSON payload. Prefer the URL form first because it maps cleanly to an iOS deep link later. Until deep links are implemented, scanning can parse the same URL inside the app.

### Confirm Pairing

iOS calls `POST /pair/confirm`:

```json
{
  "pairing_code": "8K2F-J91Q",
  "device_name": "Alice's iPhone",
  "device_platform": "ios",
  "accepted_scopes": [
    "health.daily_summary.write",
    "calendar.daily_summary.write"
  ]
}
```

Server returns:

```json
{
  "device_id": "dev_01J...",
  "device_token": "va_dev_...",
  "server_time": "2026-06-23T10:15:00+08:00"
}
```

MVP security model:

- Pairing code expires after 10 minutes.
- Pairing code is single-use.
- Device token is random, high entropy, and stored only once on iOS.
- Device token is scoped to ingest routes, not admin routes.

Next security iteration:

- iOS generates a device key pair.
- Pairing confirm sends the device public key.
- Every sync request includes timestamp and body signature.
- Server verifies `device_id + timestamp + body`.

Do not start with mTLS or Noise-style encryption. They are valid later, but they add too much setup cost before the local product loop is proven.

## 6. Sync Protocol

### Endpoint

```http
POST /health/sync
Authorization: Bearer <device_token>
Content-Type: application/json
```

### Payload

Use one sync endpoint that can carry multiple summary types. This is easier for idempotency and later incremental sync than separate per-domain endpoints.

```json
{
  "device_id": "dev_01J...",
  "sync_id": "sync_01J...",
  "generated_at": "2026-06-23T10:20:00+08:00",
  "timezone": "Asia/Shanghai",
  "health_daily_summaries": [
    {
      "date": "2026-06-23",
      "provider": "apple_health",
      "steps": 8200,
      "active_energy_kcal": 460.0,
      "resting_heart_rate_bpm": 62.0,
      "avg_heart_rate_bpm": 82.0,
      "max_heart_rate_bpm": 146.0,
      "sleep_minutes": 410,
      "workout_minutes": 65,
      "workouts": [
        {
          "id": "3B8F6E1C-3DD8-47D1-82CB-891B62FA90CF",
          "type": "traditional_strength_training",
          "started_at": "2026-06-23T19:05:00+08:00",
          "duration_minutes": 65,
          "active_energy_kcal": 310.0,
          "avg_heart_rate_bpm": null
        }
      ]
    }
  ],
  "calendar_daily_summaries": [
    {
      "date": "2026-06-23",
      "provider": "apple_calendar",
      "busy_minutes": 240,
      "free_windows": [
        {
          "start": "2026-06-23T19:00:00+08:00",
          "end": "2026-06-23T21:00:00+08:00"
        }
      ],
      "next_event": {
        "starts_at": "2026-06-23T14:00:00+08:00",
        "duration_minutes": 60,
        "title_redacted": true
      }
    }
  ]
}
```

### Idempotency

The server should treat `sync_id` as idempotent. If the same `sync_id` is received twice, return success without duplicating rows.

For daily summaries:

```text
health_daily_summary unique key:
  device_id + provider + date + timezone

calendar_daily_summary unique key:
  device_id + provider + date + timezone

workouts unique key:
  device_id + provider + workout_id
```

### Responses

Success:

```json
{
  "ok": true,
  "accepted_sync_id": "sync_01J...",
  "health_daily_count": 2,
  "calendar_daily_count": 2
}
```

Error shape:

```json
{
  "ok": false,
  "error": {
    "code": "invalid_payload",
    "message": "health_daily_summaries[0].date is required"
  }
}
```

## 7. SQLite Schema

Initial tables:

```text
devices
pairing_sessions
sync_batches
health_daily_summaries
health_workouts
calendar_daily_summaries
calendar_free_windows
audit_log
```

Minimum fields:

```sql
devices(
  id text primary key,
  name text not null,
  platform text not null,
  token_hash text not null,
  scopes_json text not null,
  created_at text not null,
  revoked_at text
)

pairing_sessions(
  code text primary key,
  agent_name text not null,
  requested_scopes_json text not null,
  expires_at text not null,
  consumed_at text,
  created_at text not null
)

sync_batches(
  sync_id text primary key,
  device_id text not null,
  received_at text not null,
  payload_hash text not null
)

health_daily_summaries(
  id text primary key,
  device_id text not null,
  date text not null,
  timezone text not null,
  provider text not null,
  steps integer,
  sleep_minutes integer,
  resting_heart_rate_bpm real,
  avg_heart_rate_bpm real,
  max_heart_rate_bpm real,
  active_energy_kcal real,
  workout_minutes integer,
  updated_at text not null,
  unique(device_id, provider, date, timezone)
)

health_workouts(
  id text primary key,
  device_id text not null,
  provider text not null,
  workout_id text not null,
  type text not null,
  started_at text not null,
  duration_minutes integer not null,
  active_energy_kcal real,
  avg_heart_rate_bpm real,
  unique(device_id, provider, workout_id)
)

calendar_daily_summaries(
  id text primary key,
  device_id text not null,
  date text not null,
  timezone text not null,
  provider text not null,
  busy_minutes integer not null,
  next_event_starts_at text,
  next_event_duration_minutes integer,
  title_redacted integer not null default 1,
  updated_at text not null,
  unique(device_id, provider, date, timezone)
)

calendar_free_windows(
  id text primary key,
  summary_id text not null,
  start text not null,
  end text not null
)

audit_log(
  id text primary key,
  actor_type text not null,
  actor_id text,
  action text not null,
  created_at text not null,
  metadata_json text
)
```

## 8. MCP Tools

For the Local Pairing MVP, expose a small MCP stdio tool surface.

Implemented tools:

```text
vital_agent_status
get_daily_health_summary
get_calendar_availability
get_sleep_trend
get_workout_load
get_recovery_signals
```

Next tools:

```text
get_current_context
generateWeeklyHealthReport()
listDevices()
revokeDevice(device_id)
```

Tool rules:

- Return freshness metadata with every health/calendar result.
- Do not expose raw samples unless a future explicit sensitive scope enables it.
- Do not return calendar event titles, notes, locations, or attendees by default.
- If data is missing or stale, return a structured status instead of hallucinating.

Example future `get_current_context` response:

```json
{
  "date": "2026-06-23",
  "timezone": "Asia/Shanghai",
  "health": {
    "steps": 8200,
    "sleep_minutes": 410,
    "resting_heart_rate_bpm": 62,
    "workout_minutes": 65
  },
  "calendar": {
    "busy_minutes": 240,
    "free_windows": [
      {
        "start": "2026-06-23T19:00:00+08:00",
        "end": "2026-06-23T21:00:00+08:00"
      }
    ]
  },
  "freshness": {
    "last_sync_at": "2026-06-23T10:20:00+08:00",
    "is_stale": false
  }
}
```

## 9. iOS App Changes

The existing app already supports manual URL/token sync. Convert that into paired-server sync.

Required screens:

- Settings: paired server, device name, disconnect.
- Pairing scanner: scan QR or paste pairing URL.
- Pair confirmation: server address, requested scopes, confirm/cancel.
- Sync dashboard: last sync, last error, manual sync button.

Required storage:

- `server_url`: UserDefaults.
- `device_id`: Keychain or UserDefaults. Prefer Keychain if treating it as identity.
- `device_token`: Keychain.
- accepted scopes: UserDefaults.
- last sync status: UserDefaults.

Required client changes:

- Replace separate `/api/health/daily-summary` and `/api/calendar/daily-summary` calls with `POST /health/sync`.
- Generate `sync_id` per sync batch.
- Upload yesterday and today in one payload for the MVP.
- Preserve existing summary builders.
- Keep manual token/server input behind an advanced/debug section until QR pairing is stable.

## 10. Privacy And Safety Defaults

Default allowed data:

```text
health.daily_summary.write
calendar.daily_summary.write
```

Default denied data:

```text
health.raw_samples.write
calendar.events.write
location.history.write
```

App copy should be explicit:

- Vital Agent Sync sends selected summaries to the user's configured Agent server.
- Vital Agent Sync does not send data to a Vital Agent Sync cloud service in local mode.
- Calendar titles are redacted by default.
- Raw HealthKit samples are not uploaded by default.
- User can disconnect a paired server.

## 11. Testing Plan

### Agent Server

Add tests for:

- Pairing code creation and expiry.
- Pairing code single-use behavior.
- Device token hashing and validation.
- Invalid payload rejection.
- Idempotent `sync_id`.
- Daily summary upsert behavior.
- MCP tool output when data exists, is missing, or is stale.

### iOS

Add focused unit tests where feasible:

- Pairing URL parsing.
- Sync payload encoding.
- URL construction.
- Calendar free-window logic.
- Settings persistence.

HealthKit integration still needs real device validation. Do not rely on simulator-only testing for HealthKit correctness.

## 12. Implementation Milestones

### Milestone A: Local Package Skeleton

- Create `packages/local`.
- Add TypeScript build and CLI.
- Start HTTP server.
- Print loopback and LAN URLs.
- Add SQLite database initialization.

Exit criteria:

- `npx` or local package command starts the server.
- `/health/status` returns JSON.

Status: complete.

### Milestone B: Pairing MVP

- Add `/pair/start`.
- Add web pairing page with QR.
- Add `/pair/confirm`.
- Store devices and token hash.
- Add iOS QR scanner/paste flow.

Exit criteria:

- User can pair iOS app without manually typing token.
- iOS stores server URL and device token.

Status: mostly complete. Current iOS flow supports pasted pairing URL; in-app QR scanner is still needed.

### Milestone C: Unified Sync

- Add `/health/sync`.
- Add Zod schemas.
- Store health and calendar summaries in SQLite.
- Update iOS to send unified sync payload.

Exit criteria:

- iOS uploads yesterday and today.
- Server stores idempotent rows.
- `/health/status` shows last sync.

Status: complete for manual sync.

### Milestone D: First MCP Tools

- Add MCP server entry point.
- Implement `getDailyHealthSummary`.
- Implement `getCalendarAvailability`.
- Implement trend and recovery query tools.

Exit criteria:

- Local Agent can query Vital Agent Sync through MCP.
- Tool responses include freshness metadata.

Status: partially complete. MCP stdio exists and tools can query SQLite; freshness metadata needs to be normalized across all tools.

### Milestone E: Foolproof Agent Linking

- Add `vitalmcp init`.
- Add `print-mcp-config`.
- Add `install-hermes`.
- Add `install-claude` or generic MCP install docs.
- Add in-app QR scanner.
- Add pairing confirmation screen with scopes.

Exit criteria:

- User can ask an agent to install Vital Agent Sync or run one command.
- User scans QR instead of copying a pairing URL.
- Agent config can be written or printed without hand-authoring JSON.

### Milestone F: Hardening

- Add token revocation.
- Add audit log entries.
- Add payload size limits.
- Add structured errors.
- Add retry-friendly iOS sync behavior.

Exit criteria:

- Basic local use is safe and debuggable.
- Failure states are visible to the user.

## 13. Later Roadmap

After Local Pairing MVP:

```text
v0.3  Foolproof install: init command, QR scanner, MCP config helpers
v0.4  HealthKit incremental sync with anchors
v0.5  Background best-effort sync and retry queue
v0.6  Rich MCP tools and weekly report generation
v0.7  Tailscale / Cloudflare Tunnel / self-hosted HTTPS support
v0.8  Device key signatures for sync payloads
v0.9  Optional raw sample scopes for advanced users
```

Avoid building a Vital Agent Sync-hosted cloud until the local product loop is proven.

## 14. Current Project Alignment

The current iOS app already has:

- HealthKit daily summary builder.
- Calendar daily summary builder.
- Paired server settings.
- Keychain token storage.
- Manual sync UI.
- Unified `/health/sync` upload.

The current Agent-side package already has:

- Local HTTP receiver.
- QR pairing page.
- Pairing confirm endpoint.
- SQLite storage.
- MCP stdio tools.

The next code work should be:

1. Add `vitalmcp init`.
2. Add iOS QR scanner.
3. Add iOS pairing confirmation UI with scopes.
4. Add `print-mcp-config`.
5. Add `install-hermes`.
6. Add disconnect/revoke flow.
