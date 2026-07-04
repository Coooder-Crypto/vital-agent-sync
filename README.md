# HealthLink iOS

HealthLink is a small iOS data gateway for agent systems. The first MVP reads user-authorized Apple Health and Calendar summaries, then uploads compact daily context to a configurable server.

It is intentionally not an agent. It is a user-controlled data connector.

For the broader product plan covering local daemon, MCP, tunnel mode, self-hosting, pairing, scopes, and packaging, see [docs/product-plan.md](docs/product-plan.md).

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
- Local configuration:
  - server URL in `UserDefaults`
  - API token in Keychain
- Upload endpoints:
  - `POST /api/health/daily-summary`
  - `POST /api/calendar/daily-summary`

## Generate The Xcode Project

This repo uses XcodeGen so the generated `.xcodeproj` does not need to be hand-maintained.

```bash
xcodegen generate
open HealthLink.xcodeproj
```

## Agent-Side Local Package

This repo also contains the first Agent-side npm workspace:

```bash
npm install
npm run dev:local
```

The local package lives in `packages/local` and is planned to become `@healthlink/local`.

## Device Setup

HealthKit requires a real iPhone for meaningful testing. In Xcode:

1. Select the `HealthLink` target.
2. Set your Apple Developer Team.
3. Keep the HealthKit capability enabled.
4. Run on a physical iPhone.
5. Grant Health and Calendar permissions inside the app.

## Server Contract

All requests use:

```http
Authorization: Bearer <token>
Content-Type: application/json
```

Health payload:

```json
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
```

Calendar payload:

```json
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
```

## Next Steps

- Add `HKAnchoredObjectQuery` for incremental sample sync.
- Add `HKObserverQuery` and background delivery as a best-effort trigger.
- Add Reminders summaries.
- Add an MCP bridge on the server side.
- Add a Watch app for quick feedback and training controls.
