# Agent Connection UX

This document defines the target "foolproof" path for connecting HealthLink iOS to Hermes Agent or any other agent runtime.

For the canonical installation/bootstrap state machine, security boundary, and delivery slices, see [agent-first-onboarding.md](agent-first-onboarding.md).
For the longer-term adapter architecture and implementation checklist covering Android, Xiaomi, OpenClaw, WorkBuddy, Tailscale, tunnels, and public HTTPS, see [architecture-upgrade-todo.md](architecture-upgrade-todo.md).
For adapter implementation guidance, see [architecture-adapter-design.md](architecture-adapter-design.md).

## Target User Experience

```text
1. User asks an Agent to install HealthLink, or uses the portable CLI fallback.
2. The Agent shows a redacted setup plan and invokes the shared vitalmcp bootstrap.
3. HealthLink initializes local state, MCP, and the selected transport.
4. The user receives one QR/deep-link action and opens it with the iOS app.
5. The user selects which data types to expose and authorizes Apple Health once.
6. The iOS app sends compact summaries directly over LAN by default, or over the user's authorized tailnet when Tailscale is selected.
7. vitalmcp ingests the summaries into the same local SQLite model.
8. The Agent verifies freshness and reads data only through MCP tools.
```

The user should not manually copy tokens, edit SQLite, or understand HealthKit. The only required setup steps should be "approve install", "open onboarding", "approve scopes", and "grant Apple permissions". The v0.1 promise is manual sync plus catch-up while the app is active or returns to the foreground. Background opportunities are best-effort, not a scheduled delivery guarantee.

## Product Boundary

HealthLink has three roles:

```text
HealthLink iOS
  Apple permissions
  HealthKit collection
  scope selection
  manual and automatic sync

vitalmcp
  Agent-first bootstrap and onboarding artifact
  LAN/Tailscale receiver and experimental encrypted Relay pull
  SQLite/Postgres storage
  MCP tools

Agent runtime
  calls MCP tools
  generates analysis, reports, advice, or automations
  may load optional HealthLink skills
```

The agent never talks to HealthKit directly. Skills and Agent adapters do not become alternate data stores. Experimental Hosted Relay code handles opaque encrypted envelopes and must not become a health data warehouse.

## Persistent Link Model

HealthLink does not rely on a live socket between iOS and the Agent. Pairing creates persistent local state:

```text
iOS app
  server URL
  source_device_id
  device token in Keychain

vitalmcp
  paired source devices
  scoped token hashes
  ~/.healthlink/healthlink.sqlite

Hermes or another agent
  MCP config pointing to vitalmcp mcp
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
Pair once. Sync manually anytime; VitalMCP also catches up when the app is active. Ask your Agent after a fresh sync.
```

## Sync Lifecycle

Current MVP:

- user can trigger sync manually from the iOS app
- sync writes compact summaries to `/health/sync`
- MCP tools read the latest rows at query time

Current v0.1 behavior:

- sync immediately after successful pairing and permission grant when the app is active
- catch up when the app launches or returns to foreground
- throttle auto sync by a minimum interval, such as 30 minutes
- skip auto sync when not paired, already syncing, missing permissions, or recently attempted
- keep a manual Sync button for explicit refresh

Background sync should be best-effort, not a strict schedule:

- use `BGAppRefreshTask` / `BGProcessingTask` where appropriate
- use HealthKit observer queries and background delivery where possible
- never promise exact intervals like "every 30 minutes"

Required UX copy:

```text
Use Sync Now anytime. VitalMCP also catches up while the app is active or returns to the foreground. Background refresh is best-effort and has no guaranteed schedule.
```

## Connection Modes

VitalMCP exposes one product flow with LAN first, Tailscale as the optional private remote path, and advanced/experimental transports outside the Local Preview happy path.

### Mode A: LAN

This is the Local Preview default for new users.

```text
iPhone -> http://192.168.x.x:8787 -> vitalmcp -> SQLite -> MCP -> Agent
```

Pros:

- No cloud dependency.
- Best privacy story.
- Easy local debugging.

Limits:

- iPhone and Agent receiver must be on the same reachable network.
- The iPhone cannot use `127.0.0.1`; the QR must use the receiver's reachable LAN address.
- The network should be trusted; public Wi-Fi with client isolation may block the connection.

LAN setup needs no relay URL, VPS, domain, VitalMCP account, payment method, or Agent marketplace listing.

### Mode B: Tailscale

Use Tailscale when the user needs private remote access outside the receiver's LAN. It is optional and user-managed.

Prerequisites:

- install and sign in to Tailscale on the iPhone and receiver machine
- use a Tailscale account with both devices authorized on the same tailnet
- keep the receiver online and reachable through its MagicDNS name or Tailscale address

```bash
vitalmcp setup --transport tailscale --tailscale-name my-mac.tailnet.ts.net
```

VitalMCP verifies a tailnet-only Tailscale Serve HTTPS route to the loopback receiver and advertises its trusted `.ts.net` URL. It fails safely rather than advertising plain HTTP or a raw `100.x` address. It does not install Tailscale, create an account, or authorize devices. See [Tailscale HTTPS Onboarding For iOS](tailscale-ios-onboarding.md).

### Mode C: Public HTTPS

For agents deployed on a VPS or a user-controlled server.

```text
iPhone -> https://agent.example.com/healthlink -> HealthLink receiver -> storage -> MCP -> Agent
```

Requirements:

- Public DNS name.
- HTTPS certificate.
- Firewall allows receiver port.
- QR uses the public URL.

This is an advanced user-operated path, not the Local Preview default.

### Mode D: Relay (Future / Experimental)

Hosted Relay is not available, recommended, or required in Local Preview. Keep it out of the normal onboarding flow. The implementation remains for explicit experiments and future hosted work.

```text
iPhone -> encrypted Relay -> vitalmcp pull/decrypt -> SQLite -> MCP -> Agent
```

The relay is a transport layer, not a data platform. It stores opaque, bounded, expiring envelopes; decryption, validation, normalized storage, and MCP access stay in vitalmcp. This technical boundary does not make the relay a current product recommendation.

### LAN / Tailscale Troubleshooting And Reset

- Run `vitalmcp service status`, `vitalmcp logs`, and `vitalmcp doctor --transport lan`.
- Confirm the QR uses an address the iPhone can reach, not `127.0.0.1` or `localhost`.
- For Tailscale, confirm both devices are online in the same authorized tailnet, then run `vitalmcp doctor --transport tailscale --tailscale-name <host.tailnet.ts.net>`.
- If the QR expires, run `vitalmcp pair`.
- To revoke/reset a source connection, call MCP `revoke_source_device`, remove the saved connection in the iOS app, and pair again. This preserves local SQLite history.

Generic MCP clients remain supported through the printed MCP configuration; no OpenClaw or other marketplace listing is required.

## CLI Shape

The current portable fallback is:

```bash
npx -y vitalmcp setup
```

`setup` should:

- Check Node.js version.
- Create `~/.healthlink/`.
- Initialize SQLite.
- Auto-detect a supported Agent config such as Hermes or OpenClaw.
- Back up and write the selected Agent MCP config.
- Install or update the HealthLink Hermes skill when Hermes is selected.
- Install and start the background HTTP receiver.
- Create a short-lived pairing session.
- Open or print the pairing page.
- Print MCP config for common agents.
- Tell the user to restart Hermes or run `/reload-mcp`.

The Agent-first target adds versioned machine-readable setup state, safe resume behavior, and first-sync verification. Agent adapters invoke that same command rather than reimplementing setup. A future website `install.sh` only makes the package available in a user-writable prefix and then delegates to `setup`.

Agent-facing output may include setup stage, detected adapter, service status, a locally rendered onboarding artifact, reload hint, freshness, and a suggested next action. It must not include private keys, complete onboarding payloads, relay access tokens, upload secrets, or health plaintext.

Advanced users can still force an adapter or manager:

```bash
npx -y vitalmcp setup --agent hermes
npx -y vitalmcp setup --agent openclaw --manager systemd
```

The foreground compatibility receiver remains:

```bash
npx -y vitalmcp init
```

It starts the same receiver without writing a Hermes config and remains attached to the terminal.

The background service commands are:

```bash
npx -y vitalmcp daemon
npx -y vitalmcp ensure
npx -y vitalmcp pair
npx -y vitalmcp service install
npx -y vitalmcp service start
npx -y vitalmcp service status
npx -y vitalmcp logs
npx -y vitalmcp service stop
npx -y vitalmcp service uninstall
```

Agents that provide lifecycle hooks should call `vitalmcp ensure` during startup. This command is an idempotent receiver check: it installs the supported platform service if missing, starts it if stopped, waits for the local receiver to answer `/health/status`, and prints service status. It intentionally does not create a pairing QR, rewrite Agent config, or reinstall skills.

First-time user onboarding should still use `setup`, because setup writes the Agent MCP config and creates the initial pairing QR. Long-running non-service deployments, such as Docker, PM2, Task Scheduler, or custom cloud process managers, should run `vitalmcp daemon` under their own supervisor instead of relying on `ensure`.

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
  npx -y vitalmcp mcp
```

Current development command:

```bash
npm run dev:local
```

Implemented local MVP command:

```bash
npm run build:local
node packages/local/dist/cli.js setup
```

## Pairing QR Payload

The QR should carry a pairing URL or equivalent JSON payload:

```text
vitalmcp://pair?server=http%3A%2F%2F192.168.31.230%3A8787&code=8K2F-J91Q
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
    "health.daily_summary.write"
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
      "args": ["-y", "vitalmcp", "mcp"]
    }
  }
}
```

Implemented helpers:

```bash
npx -y vitalmcp print-mcp-config
npx -y vitalmcp install-hermes
npx -y vitalmcp init --hermes
npx -y vitalmcp setup
npx -y vitalmcp service status
npx -y vitalmcp logs
npx -y vitalmcp pair
npx -y vitalmcp status
npx -y vitalmcp doctor
```

The helpers should not invent new protocols. They should write or print the same MCP command with the correct database path. `setup` uses the same install logic as the selected Agent adapter, installs the HealthLink Hermes skill by default when Hermes is selected, installs/starts the receiver service, and folds pairing into one Agent-driven flow. `init --hermes` remains the foreground compatibility path.

## Skill Layer

MCP is the product protocol. Skills are optional agent-specific instructions that improve natural-language tool use.

HealthLink should provide small, portable skill documents for agents that support them. OpenClaw and Hermes can provide first-class onboarding adapters, while generic MCP remains the mandatory fallback.

Skill responsibilities:

- invoke the shared setup, status, pull, and lifecycle commands
- present a setup plan before persistent changes
- offer one onboarding format at a time
- verify the first sync through MCP
- recognize questions such as "How am I today?", "Should I exercise?", and "Am I recovered?"
- call `get_personal_context` first for broad personal-context questions
- use lower-level tools only for drill-down questions
- report data freshness before analysis
- combine health, sleep, activity, and recovery
- avoid diagnosis, prescriptions, or unsupported medical claims

Skill non-responsibilities:

- generating a separate health schema or database
- implementing E2EE or parsing HealthKit payloads
- reading SQLite or Relay secrets directly
- dumping decoded onboarding fields into Agent chat
- returning health data through deep-link callbacks

Potential helper commands:

```bash
npx -y vitalmcp print-skill --format markdown
npx -y vitalmcp install-hermes-skill
npx -y vitalmcp init --hermes --install-skill
```

These should remain additive. Non-Hermes agents should still work through generic MCP config alone.

## Current MCP Tools

Current implemented tools:

```text
healthlink_status
get_personal_context
get_daily_health_summary
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

- Use `get_personal_context` first for broad natural-language questions about today, energy, recovery, and exercise readiness.
- Use `list_source_devices` and `revoke_source_device` for setup and troubleshooting. `list_devices` and `revoke_device` remain legacy aliases.
- Use `record_feedback` only when the user explicitly gives a correction, preference, or usefulness rating.
- Return compact summaries, not raw samples.
- Include enough timestamps for freshness checks.
- Return empty structured data when a date has no samples.

## Development Priorities

Next work after the local pairing MVP should focus on lifecycle and transport:

```text
P1  foreground auto sync with throttling
P1  auto sync after pairing / permission grant
P1  disconnect / revoke paired device
P1  richer local diagnostics
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
