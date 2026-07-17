# Vital Agent Sync

[简体中文](README.zh-CN.md)

[![CI](https://github.com/Coooder-Crypto/vital-agent-sync/actions/workflows/ci.yml/badge.svg)](https://github.com/Coooder-Crypto/vital-agent-sync/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/vitalmcp)](https://www.npmjs.com/package/vitalmcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Vital Agent Sync is a local-first Apple Health connector for WorkBuddy and other MCP-compatible Agents. The iPhone app reads only user-authorized HealthKit data, sends compact summaries to a receiver the user controls, stores them in local SQLite, and exposes scoped context through MCP tools.

It is intentionally not an Agent, hosted health cloud, medical device, or source of medical advice. It is a user-controlled data connector.

The product name is Vital Agent Sync. The iOS project/module is `VitalAgentSync`, the npm package and CLI are `vitalmcp`, runtime state lives under `~/.vital-agent-sync`, and the app accepts the technical `vitalmcp://` deep-link scheme.

## Current release

Version `0.5.0` is a Local Preview:

- LAN is the default onboarding path.
- Tailscale Serve HTTPS is the optional private remote path.
- WorkBuddy, Hermes, OpenClaw, and generic MCP clients share the same runtime and database.
- Docker and self-hosted relay are advanced user-operated paths.
- Hosted relay is experimental and is not required or recommended for first-time setup.
- The iOS app is currently distributed as source. There is no App Store build yet.

## Quick start

### WorkBuddy and SkillHub

Install the `Vital Agent Sync` Skill from SkillHub, then tell WorkBuddy:

> 安装 Vital Agent Sync，并在本机显示 iPhone 配对二维码。

The Skill reviews a redacted setup plan, asks before persistent changes, installs the pinned `vitalmcp` runtime, configures MCP, and opens the credential-bearing QR only in the user's local browser.

### Manual runtime setup

```bash
npx -y vitalmcp@0.5.0 setup --agent auto --transport lan
```

The setup command installs the background receiver, preserves and backs up existing Agent configuration, and prints a short-lived iPhone pairing QR. After the first sync:

```bash
vitalmcp status --output json
vitalmcp doctor --transport lan
```

### iPhone app

HealthKit requires a real iPhone. Generate the project with XcodeGen, select your own Apple Developer Team and unique bundle identifier, keep the HealthKit capability enabled, then run the app on the device:

```bash
cd apps/ios
xcodegen generate
open VitalAgentSync.xcodeproj
```

Scan the QR, review the requested scopes and receiver address, grant the selected Health permissions, and sync once.

## Data path

```text
iPhone HealthKit
  -> encrypted direct sync over trusted LAN or the user's Tailscale network
  -> user-owned vitalmcp receiver
  -> local SQLite
  -> scoped MCP tools
  -> the user's Agent and selected model provider
```

The default route has no Vital Agent Sync account, VPS, domain, payment method, or hosted service. An Agent or model provider may receive the scoped context returned by MCP; local storage does not imply local model inference. Never paste pairing QR codes, onboarding links, keys, tokens, databases, or real health exports into Agent chats or public issues.

## Repository layout

| Path | Purpose |
| --- | --- |
| `apps/ios/` | SwiftUI HealthKit app, XcodeGen project, resources, and focused iOS tests |
| `packages/local/` | `vitalmcp` runtime, receiver, SQLite, MCP, Agent adapters, and transports |
| `skills/vital-agent-sync/` | Source Skill used for Agent packaging and release checks |
| `deploy/` | Docker and self-hosted relay deployment templates |
| `apps/www/` | Public product website source |
| `docs/` | Architecture, deployment, privacy, threat-model, and protocol documentation |

The independently publishable WorkBuddy package lives at [`Coooder-Crypto/vital-agent-sync-skill`](https://github.com/Coooder-Crypto/vital-agent-sync-skill). The complete public/private boundary is documented in [Open-source scope](docs/open-source-scope.md).

For the broader product plan covering local daemon, MCP, pairing, scopes, and packaging, see [docs/product-plan.md](docs/product-plan.md). For common deployment methods, see [docs/deployment-methods.md](docs/deployment-methods.md). For the target "install, scan QR, sync, agent reads data" UX, see [docs/agent-connection.md](docs/agent-connection.md). For security, start with [direct LAN security](docs/direct-lan-security.md), the [relay threat model](docs/e2ee-relay-threat-model.md), and the [privacy boundary](docs/e2ee-relay-privacy-boundary.md).

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
cd apps/ios
xcodegen generate
open VitalAgentSync.xcodeproj
```

See [apps/ios/README.md](apps/ios/README.md) for signing, simulator, and physical-device notes.

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
node packages/local/dist/cli.js mcp --db ~/.vital-agent-sync/vital-agent.sqlite
```

Current portable CLI fallback:

```bash
npx -y vitalmcp setup
```

Supported Agents can use the Skill-first flow instead: the generated Vital Agent Sync Skill requests a redacted setup plan, asks for consent, resumes the shared `vitalmcp` bootstrap, presents one private local onboarding page, and verifies the first sync through MCP. The Skill never owns keys, relay crypto, SQLite, or a separate health query path. See [docs/agent-first-onboarding.md](docs/agent-first-onboarding.md).

The repository includes a portable no-sudo `install.sh`, but no public installer domain is currently advertised. Prefer the pinned npm command above until an official HTTPS endpoint and checksum policy are published.

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
npm run audit:oss
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

HealthKit requires a real iPhone for meaningful testing. The public source does not include signing credentials or provisioning profiles. In Xcode:

1. Select the `VitalAgentSync` target.
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
iOS syncs latest summaries -> ~/.vital-agent-sync/vital-agent.sqlite
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

Direct LAN and Tailscale pairing/sync use the receiver-pinned `vital-agent-direct-v1` application envelope. The device token and canonical payload below are ciphertext inside `POST /v1/direct`; they are not an HTTP bearer header or plaintext JSON body. Hosted/self-hosted relay requests continue using their relay authorization and E2EE envelope. See [docs/direct-lan-security.md](docs/direct-lan-security.md) and [docs/server-contract.md](docs/server-contract.md).

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

## Contributing and support

Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request. Use synthetic data in tests and remove private health information, pairing artifacts, credentials, databases, and unredacted logs from all public reports. Security vulnerabilities must follow [SECURITY.md](SECURITY.md); general setup guidance is in [SUPPORT.md](SUPPORT.md).

User-visible releases are tracked in [CHANGELOG.md](CHANGELOG.md). Design and implementation work remains visible in GitHub Issues and the architecture TODO, but an unchecked planning item is not a product promise.

## License

Vital Agent Sync is available under the [MIT License](LICENSE). The name and visual identity are project identifiers; the software license does not grant rights to impersonate the project or misrepresent the origin of modified builds.
