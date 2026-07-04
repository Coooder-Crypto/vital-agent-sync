# HealthLink iOS

HealthLink is a private iOS data gateway for agent systems. The MVP reads user-authorized Apple Health and Calendar summaries, uploads compact daily context to the user's Agent-side receiver, stores it locally, and exposes it to agents through MCP tools.

It is intentionally not an agent. It is a user-controlled data connector.

For the broader product plan covering local daemon, MCP, tunnel mode, self-hosting, pairing, scopes, and packaging, see [docs/product-plan.md](docs/product-plan.md). For the target "install, scan QR, sync, agent reads data" UX, see [docs/agent-connection.md](docs/agent-connection.md).

## Scope

- HealthKit daily summaries:
  - steps
  - active energy
  - heart-rate average / max
  - resting heart rate
  - sleep minutes
  - workouts
- Calendar daily summaries:
  - busy minutes
  - free windows
  - next event metadata with title redacted
- Local pairing configuration:
  - paired server URL in `UserDefaults`
  - paired device ID in `UserDefaults`
  - device token in Keychain
- Upload endpoint:
  - `POST /health/sync`
- Agent access:
  - MCP stdio tools from `@healthlink/local`

## Generate The Xcode Project

This repo uses XcodeGen so the generated `.xcodeproj` does not need to be hand-maintained.

```bash
xcodegen generate
open HealthLink.xcodeproj
```

## Agent-Side Local Package

This repo also contains the Agent-side npm workspace:

```bash
npm install
npm run dev:local
```

The local package lives in `packages/local` and is named `@healthlink/local`. It is private in this repository until the package is ready to publish.

The current local development loop is:

```text
iPhone app
  -> HealthKit / Calendar summaries
  -> POST /health/sync
  -> @healthlink/local
  -> SQLite
  -> MCP tools
  -> Hermes or another agent
```

MCP development command:

```bash
npm run build:local
node packages/local/dist/cli.js mcp --db ~/.healthlink/healthlink.sqlite
```

Published package shape:

```bash
npx -y @healthlink/local
npx -y @healthlink/local mcp
```

## Device Setup

HealthKit requires a real iPhone for meaningful testing. In Xcode:

1. Select the `HealthLink` target.
2. Set your Apple Developer Team.
3. Keep the HealthKit capability enabled.
4. Run on a physical iPhone.
5. Grant Health and Calendar permissions inside the app.

## Sync Contract

All requests use:

```http
Authorization: Bearer <token>
Content-Type: application/json
```

Unified payload:

```json
{
  "device_id": "device_...",
  "sync_id": "sync_...",
  "generated_at": "2026-06-21T10:20:00+08:00",
  "timezone": "Asia/Shanghai",
  "health_daily_summaries": [
    {
      "date": "2026-06-21",
      "timezone": "Asia/Shanghai",
      "provider": "apple_health",
      "steps": 8420,
      "sleep_minutes": 392,
      "resting_heart_rate_bpm": 63.0,
      "avg_heart_rate_bpm": 82.0,
      "max_heart_rate_bpm": 146.0,
      "active_energy_kcal": 480.0,
      "workout_minutes": 45,
      "workouts": []
    }
  ],
  "calendar_daily_summaries": [
    {
      "date": "2026-06-21",
      "timezone": "Asia/Shanghai",
      "provider": "apple_calendar",
      "busy_minutes": 240,
      "free_windows": [
        {"start": "2026-06-21T19:00:00+08:00", "end": "2026-06-21T21:00:00+08:00"}
      ],
      "next_event": {
        "starts_at": "2026-06-21T14:00:00+08:00",
        "duration_minutes": 60,
        "title_redacted": true
      }
    }
  ]
}
```

## Next Steps

- Add `@healthlink/local init` for one-command setup, QR pairing, and MCP config output.
- Add in-app QR scanner and pairing confirmation screen.
- Add `print-mcp-config` / `install-hermes` helper for foolproof agent linking.
- Add `HKAnchoredObjectQuery` for incremental sample sync.
- Add `HKObserverQuery` and background delivery as a best-effort trigger.
- Add Reminders summaries.
- Add a Watch app for quick feedback and training controls.
