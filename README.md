# Vital Agent Sync

Vital Agent Sync is a private iOS data gateway for agent systems. The MVP reads user-authorized Apple Health summaries, uploads compact daily context to the user's Agent-side receiver, stores it locally, and exposes it to agents through MCP tools.

The pre-release product is branded Vital Agent Sync, including the `vitalmcp` npm package and CLI. Protocol and persisted identifiers such as `healthlink-e2ee-v1`, `healthlink://`, `~/.healthlink`, and the internal Xcode target/module remain unchanged during the migration. See [docs/brand-identity.md](docs/brand-identity.md).

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
  - v0.1 promises manual sync plus catch-up when the app is active or returns to the foreground
  - iOS background opportunities are best-effort; no exact daily, weekly, or interval schedule is promised
- Upload endpoint:
  - encrypted direct `POST /v1/direct` envelope (the receiver decrypts locally)
- Agent access:
  - MCP stdio tools from `vitalmcp`

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

The local package lives in `packages/local` and is named `vitalmcp`. The package is prepared for public npm publishing and exposes the `vitalmcp` CLI.

The target product entry is Agent-first: the user asks an existing Agent to install Vital Agent Sync, the Agent adapter invokes the shared `vitalmcp` bootstrap, and the user receives one QR/deep-link action for the iOS app. The Skill is an orchestration layer only; MCP remains the data contract. See [Agent-First Onboarding And Runtime Bootstrap](docs/agent-first-onboarding.md).

## Local Preview Network Path

LAN is the default onboarding path. `vitalmcp setup` starts a receiver on the user's machine and creates a QR for an iPhone on the same reachable trusted network. This path needs no relay URL, VPS, domain, Vital Agent Sync account, or payment method.

Tailscale is the optional private remote path. It requires the user to install and sign in to Tailscale on both the iPhone and receiver machine, and to authorize both devices on the same tailnet. Vital Agent Sync uses the user-managed tailnet; it does not create an account or approve devices.

Hosted Relay remains future/experimental during Local Preview. Its implementation and protocol documentation remain in the repository, but it is not the default, recommended, or required onboarding route.

The current local development loop is:

```text
iPhone app
  -> HealthKit summaries
  -> POST /health/sync on manual or automatic sync
  -> vitalmcp
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
npx -y vitalmcp setup
```

Supported Agents can use the Skill-first flow instead: the generated Vital Agent Sync Skill requests a redacted setup plan, asks for consent, resumes the shared `vitalmcp` bootstrap, presents one private local onboarding page, and verifies the first sync through MCP. The Skill never owns keys, relay crypto, SQLite, or a separate health query path. See [docs/agent-first-onboarding.md](docs/agent-first-onboarding.md).

Portable no-sudo installer fallback:

```bash
curl -fsSL https://<healthlink-domain>/install.sh | sh
vitalmcp setup
```

Agent-safe setup commands:

```bash
vitalmcp setup --agent auto --transport lan --output json
vitalmcp setup --resume --yes --output json
vitalmcp setup --agent auto --transport tailscale --tailscale-name <host.tailnet.ts.net> --output json
vitalmcp setup --agent workbuddy --workbuddy-project ~/VitalAgentSync --transport lan --output json
vitalmcp status --output json
```

Development pairing loop:

```bash
npm run build:local
node packages/local/dist/cli.js setup
```

`setup` installs and starts the background receiver through the current platform's service manager, prints the iPhone pairing QR, and auto-detects WorkBuddy, Hermes, or OpenClaw. WorkBuddy setup defaults to the documented user-level `~/.workbuddy/mcp.json`; pass `--workbuddy-project <dir>` for `<dir>/.workbuddy/mcp.json`, or `--workbuddy-config <path>` for an explicit file. Existing MCP servers are preserved and changed files receive timestamped backups. If Hermes is detected, setup backs up and writes `~/.hermes/config.yaml`, installs the Vital Agent Sync Hermes Skill, and points Hermes at the same Vital Agent Sync database. macOS uses `launchd`; Linux servers use a user-level `systemd` service. Pass `--agent workbuddy`, `--agent hermes`, `--agent openclaw`, or `--agent generic` to force an adapter. After pairing and syncing, restart or reload the selected Agent when its config changed. If the QR expires, run `vitalmcp pair` or `npx -y vitalmcp pair`.

For the Agent-first WorkBuddy flow, export or publish the committed [`skills/vital-agent-sync`](skills/vital-agent-sync) package through SkillHub. After the user installs the Skill from a WorkBuddy conversation, WorkBuddy installs the pinned user-local runtime, requests a reviewed setup plan, opens the credential-bearing QR only on the user's local browser, and verifies the first sync through MCP. WorkBuddy may send returned MCP context to the model provider selected by the user; local storage does not imply local model inference.

The planned one-command installer only bootstraps this package into a user-writable prefix. It must not create a second setup implementation. Agent-first, website, and manual CLI entry points all converge on `vitalmcp setup`, the same local state, and the same MCP tools.

Common deployment choices are documented separately:

- [iOS-compatible Tailscale HTTPS onboarding](docs/tailscale-ios-onboarding.md)
- Mac local LAN mode (default): receiver, SQLite, and MCP run on the user's Mac.
- Tailscale (optional): the same receiver stays private on the user's authorized tailnet for remote sync.
- Home server / NAS / N100 mode: receiver and SQLite run on an always-on home machine over LAN or Tailscale, usually via `systemd`.
- Docker Compose mode: receiver runs in a container and SQLite lives in a mounted host volume.
- User-owned VPS / public HTTPS mode: advanced path with user-managed DNS, TLS, and infrastructure.

For connection problems, run `vitalmcp service status`, `vitalmcp logs`, and `vitalmcp doctor --transport lan`. For Tailscale, first confirm both devices are signed in to the same authorized tailnet, then run `vitalmcp doctor --transport tailscale --tailscale-name <host.tailnet.ts.net>`. If a QR expires, run `vitalmcp pair`. To disconnect a phone, revoke it with the MCP `revoke_source_device` tool, remove the saved connection in the iOS app, and pair again; local SQLite history is preserved.

Foreground compatibility/debug command:

```bash
node packages/local/dist/cli.js init --hermes
```

`init --hermes` keeps the receiver attached to the terminal. Closing the terminal stops new iOS syncs, but already-synced data remains in SQLite for MCP tools.

After that first setup, Hermes does not need to reconnect for every sync. iOS writes new summaries to the same local database, and Hermes MCP tools read the latest rows when the user asks a question.

If an Agent supports a startup hook, it can run this idempotent command before loading MCP tools:

```bash
npx -y vitalmcp ensure
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
npx -y vitalmcp init
npx -y vitalmcp init --hermes
npx -y vitalmcp setup
npx -y vitalmcp setup --agent hermes
npx -y vitalmcp setup --agent openclaw
npx -y vitalmcp setup --agent workbuddy --workbuddy-project ~/VitalAgentSync
npx -y vitalmcp ensure
npx -y vitalmcp service status
npx -y vitalmcp logs
npx -y vitalmcp pair
npx -y vitalmcp mcp
npx -y vitalmcp print-mcp-config
npx -y vitalmcp install-hermes
npx -y vitalmcp status
npx -y vitalmcp doctor
```

Release check for the local package:

```bash
npm run typecheck --workspace vitalmcp
npm run test --workspace vitalmcp
npm run audit:relay-local
npm run audit:agent-adapters
npm run audit:dependencies
npm run audit:secrets
npm run release:npm-preflight -- --local
npm run pack:check --workspace vitalmcp
```

Useful background-service diagnostics:

```bash
npx -y vitalmcp service status
npx -y vitalmcp logs
npx -y vitalmcp logs --lines 200
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
Hermes calls Vital Agent Sync MCP -> reads the latest summaries
```

No repeated QR scan, `install-hermes`, or `/reload-mcp` is needed unless the pairing, database path, MCP configuration, or skill files change.

## Agent Skills

MCP is the stable integration contract. Skills are optional agent-side usage guidance that help an AI decide when to call Vital Agent Sync and how to format analysis.

Skills may also guide installation, onboarding, and first-sync verification by invoking `vitalmcp`. They must not promise scheduled iOS delivery, implement relay cryptography, store a separate copy of health data, expose onboarding credentials, or bypass MCP. OpenClaw marketplace publication is optional; Hermes and generic MCP remain supported without any marketplace listing.

For Hermes, the preferred skill behavior is:

- use `get_personal_context` first for broad questions about today, energy, recovery, or exercise readiness
- call lower-level tools only for follow-up details
- mention data freshness before analysis
- avoid medical diagnosis or prescriptions

Product installs should keep the generic MCP path available for non-Hermes agents, while Hermes-first setup can install or update a Vital Agent Sync Skill as an experience enhancement.

## Sync Contract

Direct LAN and Tailscale pairing/sync use the receiver-pinned `vitalmcp-direct-v1` application envelope. The device token and canonical payload below are ciphertext inside `POST /v1/direct`; they are not an HTTP bearer header or plaintext JSON body. Hosted/self-hosted relay requests continue using their relay authorization and E2EE envelope. See [docs/direct-lan-security.md](docs/direct-lan-security.md) and [docs/server-contract.md](docs/server-contract.md).

Canonical plaintext payload after local receiver decryption:

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
- Add an optional bundled Vital Agent Sync Skill installer for Hermes.
- Add automated iOS UI coverage after real-device workflow stabilizes.
- Add tunnel and public HTTPS transports.
- Add Reminders summaries.
- Add a Watch app for quick feedback and training controls.
