# HealthLink iOS

HealthLink is a private iOS data gateway for agent systems. The MVP reads user-authorized Apple Health summaries, uploads compact daily context to the user's Agent-side receiver, stores it locally, and exposes it to agents through MCP tools.

It is intentionally not an agent. It is a user-controlled data connector.

For the broader product plan covering local daemon, MCP, pairing, scopes, and packaging, see [docs/product-plan.md](docs/product-plan.md). For common deployment methods, see [docs/deployment-methods.md](docs/deployment-methods.md). For the target "install, scan QR, sync, agent reads data" UX, see [docs/agent-connection.md](docs/agent-connection.md). For the multi-source, multi-agent, multi-transport upgrade TODO, see [docs/architecture-upgrade-todo.md](docs/architecture-upgrade-todo.md). For the E2EE relay, self-hosted relay, OpenClaw skill, mobile deep-link route, and beta release gate, see [docs/e2ee-relay-technical-route.md](docs/e2ee-relay-technical-route.md), [docs/e2ee-relay-protocol-v1.md](docs/e2ee-relay-protocol-v1.md), [docs/e2ee-relay-implementation-plan.md](docs/e2ee-relay-implementation-plan.md), [docs/e2ee-relay-threat-model.md](docs/e2ee-relay-threat-model.md), [docs/e2ee-relay-privacy-boundary.md](docs/e2ee-relay-privacy-boundary.md), [docs/e2ee-relay-data-retention-policy.md](docs/e2ee-relay-data-retention-policy.md), [docs/e2ee-relay-hosted-runbook.md](docs/e2ee-relay-hosted-runbook.md), [docs/e2ee-relay-release-audit.md](docs/e2ee-relay-release-audit.md), [docs/e2ee-relay-hosted-to-self-hosted-migration.md](docs/e2ee-relay-hosted-to-self-hosted-migration.md), and [docs/e2ee-relay-mode-comparison.md](docs/e2ee-relay-mode-comparison.md).

## Scope

- HealthKit daily summaries:
  - steps
  - active / basal energy
  - walking/running and cycling distance
  - flights climbed
  - exercise and stand minutes
  - heart-rate average / max
  - resting heart rate
  - HRV, walking heart-rate average, VO2 max
  - blood oxygen, respiratory rate, body temperature
  - body mass, body fat, lean body mass, BMI
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

The target product entry is Agent-first: the user asks an existing Agent to install HealthLink, the Agent adapter invokes the shared `healthlink-local` bootstrap, and the user receives one QR/deep-link action for the iOS app. The Skill is an orchestration layer only; MCP remains the data contract. See [Agent-First Onboarding And Runtime Bootstrap](docs/agent-first-onboarding.md).

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

Current portable CLI fallback:

```bash
npx -y healthlink-local setup
```

Supported Agents can use the Skill-first flow instead: the generated HealthLink Skill requests a redacted setup plan, asks for consent, resumes the shared `healthlink-local` bootstrap, presents one private local onboarding page, and verifies the first sync through MCP. The Skill never owns keys, relay crypto, SQLite, or a separate health query path. See [docs/agent-first-onboarding.md](docs/agent-first-onboarding.md).

Portable no-sudo installer fallback:

```bash
curl -fsSL https://<healthlink-domain>/install.sh | sh
healthlink-local setup
```

Agent-safe setup commands:

```bash
healthlink-local setup --agent auto --transport relay --output json
healthlink-local setup --resume --yes --output json
healthlink-local status --output json
```

Development pairing loop:

```bash
npm run build:local
node packages/local/dist/cli.js setup
```

`setup` installs and starts the background receiver through the current platform's service manager, prints the iPhone pairing QR, and auto-detects Hermes/OpenClaw when their config exists. If Hermes is detected, it backs up and writes `~/.hermes/config.yaml`, installs the HealthLink Hermes skill, and points Hermes at the same HealthLink database. macOS uses `launchd`; Linux servers use a user-level `systemd` service. Pass `--agent hermes`, `--agent openclaw`, or `--agent generic` to force an adapter. After pairing and syncing, restart Hermes or run `/reload-mcp` when an Agent config was changed. If the QR expires, run `healthlink-local pair` or `npx -y healthlink-local pair`.

The planned one-command installer only bootstraps this package into a user-writable prefix. It must not create a second setup implementation. Agent-first, website, and manual CLI entry points all converge on `healthlink-local setup`, the same local state, and the same MCP tools.

Common deployment choices are documented separately:

- Mac local mode: receiver, SQLite, and MCP run on the user's Mac.
- Home server / NAS / N100 mode: receiver and SQLite run on an always-on home machine, usually via `systemd`.
- Docker Compose mode: receiver runs in a container and SQLite lives in a mounted host volume.
- User-owned VPS / public HTTPS mode: receiver and SQLite run on the user's server with user-managed HTTPS.

Foreground compatibility/debug command:

```bash
node packages/local/dist/cli.js init --hermes
```

`init --hermes` keeps the receiver attached to the terminal. Closing the terminal stops new iOS syncs, but already-synced data remains in SQLite for MCP tools.

After that first setup, Hermes does not need to reconnect for every sync. iOS writes new summaries to the same local database, and Hermes MCP tools read the latest rows when the user asks a question.

If an Agent supports a startup hook, it can run this idempotent command before loading MCP tools:

```bash
npx -y healthlink-local ensure
```

`ensure` makes sure the background receiver service exists and is running. It is intentionally separate from `setup`: it does not print a QR, rewrite Agent config, or install skills, so it is safe to call repeatedly when an Agent starts.

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
npx -y healthlink-local setup
npx -y healthlink-local setup --agent hermes
npx -y healthlink-local setup --agent openclaw
npx -y healthlink-local ensure
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
npm run audit:relay-local
npm run audit:agent-adapters
npm run audit:dependencies
npm run audit:secrets
npm run release:npm-preflight -- --local
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
5. Run `node packages/local/dist/cli.js setup` on the Agent machine.
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

Skills may also guide installation, onboarding, first-sync verification, and Agent-native scheduling by invoking `healthlink-local`. They must not implement relay cryptography, store a separate copy of health data, expose onboarding credentials, or bypass MCP. OpenClaw marketplace publication is optional; Hermes and generic MCP remain supported without it.

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
      "basal_energy_kcal": 1500.0,
      "distance_walking_running_m": 3200.0,
      "distance_cycling_m": null,
      "flights_climbed": 8,
      "exercise_minutes": 35,
      "stand_minutes": 120,
      "heart_rate_variability_ms": 42.0,
      "walking_heart_rate_average_bpm": 98.0,
      "vo2_max_ml_kg_min": 38.5,
      "oxygen_saturation_percent": 97.5,
      "respiratory_rate_bpm": 15.2,
      "body_temperature_c": null,
      "body_mass_kg": 72.4,
      "body_fat_percentage": null,
      "lean_body_mass_kg": null,
      "body_mass_index": null,
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
