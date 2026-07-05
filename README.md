# HealthLink iOS

HealthLink is a private iOS data gateway for agent systems. The MVP reads user-authorized Apple Health summaries, uploads compact daily context to the user's Agent-side receiver, stores it locally, and exposes it to agents through MCP tools.

It is intentionally not an agent. It is a user-controlled data connector.

For the broader product plan covering local daemon, MCP, tunnel mode, self-hosting, pairing, scopes, and packaging, see [docs/product-plan.md](docs/product-plan.md). For the target "install, scan QR, sync, agent reads data" UX, see [docs/agent-connection.md](docs/agent-connection.md). For the multi-source, multi-agent, multi-transport upgrade TODO, see [docs/architecture-upgrade-todo.md](docs/architecture-upgrade-todo.md).

## Scope

- HealthKit daily summaries:
  - steps
  - active energy
  - heart-rate average / max
  - resting heart rate
  - sleep minutes
  - workouts
- Local pairing configuration:
  - paired server URL in `UserDefaults`
  - paired device ID in `UserDefaults`
  - device token in Keychain
- Sync lifecycle:
  - current MVP supports manual user-triggered sync
  - target UX is pair once, authorize once, then auto-sync when the app is active or iOS grants background time
- Upload endpoint:
  - `POST /health/sync`
- Agent access:
  - MCP stdio tools from `healthlink-local`

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

The local package lives in `packages/local` and is named `healthlink-local`. The package is prepared for public npm publishing and exposes the `healthlink-local` CLI.

The current local development loop is:

```text
iPhone app
  -> HealthKit summaries
  -> POST /health/sync on manual or automatic sync
  -> healthlink-local
  -> SQLite
  -> MCP tools
  -> Hermes or another agent
```

MCP development command:

```bash
npm run build:local
node packages/local/dist/cli.js mcp --db ~/.healthlink/healthlink.sqlite
```

Published-package pairing loop:

```bash
npx -y healthlink-local setup --agent hermes --service
```

Development pairing loop:

```bash
npm run build:local
node packages/local/dist/cli.js setup --agent hermes --service
```

`setup --agent hermes --service` backs up and writes `~/.hermes/config.yaml`, installs the HealthLink Hermes skill, installs and starts the macOS background receiver, prints the iPhone pairing QR, and points Hermes at the same HealthLink database. After pairing and syncing, restart Hermes or run `/reload-mcp`. If the QR expires, run `healthlink-local pair` or `npx -y healthlink-local pair`.

Foreground compatibility/debug command:

```bash
node packages/local/dist/cli.js init --hermes
```

`init --hermes` keeps the receiver attached to the terminal. Closing the terminal stops new iOS syncs, but already-synced data remains in SQLite for MCP tools.

After that first setup, Hermes does not need to reconnect for every sync. iOS writes new summaries to the same local database, and Hermes MCP tools read the latest rows when the user asks a question.

Agent integration helpers:

```bash
node packages/local/dist/cli.js print-mcp-config
node packages/local/dist/cli.js install-hermes
node packages/local/dist/cli.js status
node packages/local/dist/cli.js doctor
```

Published package shape:

```bash
npx -y healthlink-local init
npx -y healthlink-local init --hermes
npx -y healthlink-local setup --agent hermes --service
npx -y healthlink-local setup --agent openclaw --service
npx -y healthlink-local service status
npx -y healthlink-local logs
npx -y healthlink-local pair
npx -y healthlink-local mcp
npx -y healthlink-local print-mcp-config
npx -y healthlink-local install-hermes
npx -y healthlink-local status
npx -y healthlink-local doctor
```

Release check for the local package:

```bash
npm run typecheck --workspace healthlink-local
npm run test --workspace healthlink-local
npm run pack:check --workspace healthlink-local
```

Useful background-service diagnostics:

```bash
npx -y healthlink-local service status
npx -y healthlink-local logs
npx -y healthlink-local logs --lines 200
lsof -nP -iTCP:8787 -sTCP:LISTEN
```

## Device Setup

HealthKit requires a real iPhone for meaningful testing. In Xcode:

1. Select the `HealthLink` target.
2. Set your Apple Developer Team.
3. Keep the HealthKit capability enabled.
4. Run on a physical iPhone.
5. Run `node packages/local/dist/cli.js setup --agent hermes --service` on the Agent machine.
6. Scan the pairing QR in the app Settings tab.
7. Confirm the server/scopes, then grant Health permission.
8. Sync once, then restart Hermes or run `/reload-mcp`.
9. Ask Hermes a natural-language question, such as `我今天状态怎么样？`.

Normal use after setup:

```text
iOS syncs latest summaries -> ~/.healthlink/healthlink.sqlite
Hermes calls HealthLink MCP -> reads the latest summaries
```

No repeated QR scan, `install-hermes`, or `/reload-mcp` is needed unless the pairing, database path, MCP configuration, or skill files change.

## Agent Skills

MCP is the stable integration contract. Skills are optional agent-side usage guidance that help an AI decide when to call HealthLink and how to format analysis.

For Hermes, the preferred skill behavior is:

- use `get_personal_context` first for broad questions about today, energy, recovery, or exercise readiness
- call lower-level tools only for follow-up details
- mention data freshness before analysis
- avoid medical diagnosis or prescriptions

Product installs should keep the generic MCP path available for non-Hermes agents, while Hermes-first setup can install or update a HealthLink skill as an experience enhancement.

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
  ]
}
```

## Next Steps

- Add foreground auto sync after pairing, app launch, and app foregrounding with throttling.
- Add `HKAnchoredObjectQuery` for incremental sample sync.
- Add `HKObserverQuery`, `BGAppRefreshTask`, and background delivery as best-effort triggers.
- Add an optional bundled HealthLink skill installer for Hermes.
- Add automated iOS UI coverage after real-device workflow stabilizes.
- Add tunnel and public HTTPS transports.
- Add Reminders summaries.
- Add a Watch app for quick feedback and training controls.
