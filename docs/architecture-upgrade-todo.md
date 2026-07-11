# HealthLink Architecture Upgrade TODO

This document tracks the architecture upgrade from the current local iOS + Hermes MVP to a multi-source, multi-agent, multi-transport personal data gateway.

Implementation guidance for the remaining adapter work lives in [architecture-adapter-design.md](architecture-adapter-design.md). Common deployment methods are tracked separately in [deployment-methods.md](deployment-methods.md), so deployment choices and Agent runtime choices can evolve independently. The next E2EE relay route, including hosted relay, self-hosted relay, OpenClaw skill onboarding, and mobile deep-link triggers, is defined in [e2ee-relay-technical-route.md](e2ee-relay-technical-route.md).

## Target

HealthLink should support:

- multiple data-source apps:
  - iOS app with Apple Health
  - Android app with Health Connect
  - Xiaomi / Mi Fitness / wearable connectors
  - future location, reminders, feedback, and app-context sources
- multiple Agent runtimes:
  - Hermes
  - OpenClaw
  - WorkBuddy
  - any generic MCP-compatible agent
- multiple connection modes:
  - LAN
  - Tailscale
  - hosted E2EE relay
  - self-hosted E2EE relay
  - tunnel providers such as Cloudflare Tunnel or ngrok
  - public HTTPS / self-hosted server

The first deployment pass should stay focused on Mac local mode, home server / NAS / N100 mode, and user-owned VPS / public HTTPS mode. The next productized setup path should add E2EE relay mode as the default no-inbound-ports UX while preserving direct local gateway modes. Agent-specific setup belongs to the Agent adapter work.

The product promise remains:

```text
Pair once. Authorize once. Keep syncing. Ask any connected Agent anytime.
```

## Architecture Direction

```text
Data Source Apps
  iOS / Android / Xiaomi / other connectors
  -> pairing
  -> scoped sync

Transport Providers
  LAN / Tailscale / tunnel / public HTTPS
  -> advertised URL
  -> reachability

HealthLink Gateway
  pairing
  source-device tokens
  agent-client registration
  scopes
  ingest API
  normalized storage
  audit and revocation
  query layer

Agent Adapters
  generic MCP
  Hermes installer + skill
  OpenClaw installer + rules/skill
  WorkBuddy installer + rules/skill
```

The stable core is:

```text
normalized data schemas + scoped pairing + Gateway store + MCP query tools
```

iOS, Android, Xiaomi, Hermes, OpenClaw, WorkBuddy, LAN, and tunnels should be adapters around that core.

## Package Boundaries

Short term, these can remain inside the current repo. Code should still move toward these boundaries.

```text
packages/core
  normalized schemas
  scopes
  query contracts
  shared validation

packages/gateway
  pairing
  auth/token hashing
  ingest routes
  storage
  audit
  revocation

packages/local
  CLI
  local SQLite runtime
  local HTTP receiver
  transport providers
  stdio MCP server

packages/mcp
  generic MCP tool registration
  shared tool descriptions

packages/agents
  hermes adapter
  openclaw adapter
  workbuddy adapter

packages/sdk
  TypeScript client
  HTTP client
  webhook verifier
  schemas

apps/ios
apps/android
```

## Data Model Upgrade

Current `devices` are effectively source devices. Future schema should distinguish data sources from agents.

Target tables:

```text
source_devices
  id
  name
  platform: ios | android | xiaomi | connector
  token_hash
  scopes_json
  created_at
  revoked_at

agent_clients
  id
  name
  runtime: hermes | openclaw | workbuddy | generic_mcp
  scopes_json
  created_at
  revoked_at

pairing_sessions
  type: source_pairing | agent_pairing
  code
  server_url
  requested_scopes_json
  expires_at
  consumed_at

sync_batches
  source_device_id
  sync_id
  generated_at
  received_at
  payload_hash

agent_audit_log
  agent_client_id
  tool_name
  scopes_used_json
  read_at
```

Normalized summary tables should stay provider-neutral:

```text
health_daily_summaries
sleep_daily_summaries
activity_daily_summaries
workout_records
recovery_signals
feedback_events
```

## Source Adapter TODO

Source adapters should only know how to collect data and sync normalized payloads. They should not know about Hermes, OpenClaw, or other Agents.

- [x] Rename internal "device" language toward "source device" in docs and types.
- [x] Keep backward compatibility for current `/devices` endpoint while introducing source-device naming.
- [x] Define `source_platform` values:
  - `ios`
  - `android`
  - `xiaomi`
  - `manual_import`
- [x] Define a provider-neutral health summary schema.
- [x] Add Health Connect mapping design for Android.
- [x] Add Xiaomi / Mi Fitness connector research notes.
- [x] Add connector capability metadata:
  - supported metrics
  - sync cadence
  - freshness
  - missing-data behavior

## Agent Adapter TODO

Agent adapters should install or print configuration. They should not own HealthLink data semantics.

Define an adapter interface:

```ts
type AgentAdapter = {
  id: "hermes" | "openclaw" | "workbuddy" | "generic";
  detect(): AgentInstallStatus;
  installMcp(config: McpServerConfig): InstallResult;
  installSkill?(skill: SkillPackage): InstallResult;
  test?(): TestResult;
  reloadHint(): string;
};
```

Tasks:

- [x] Move Hermes config writing behind `AgentAdapter`.
- [x] Add `healthlink-local init --agent hermes` as an alias for `--hermes`.
- [x] Keep `healthlink-local init --hermes` for compatibility.
- [x] Add `healthlink-local print-agent-config --agent generic`.
- [x] Add OpenClaw adapter research:
  - config location
  - MCP format
  - reload mechanism
  - skill/rule format
- [x] Add WorkBuddy adapter research:
  - config location
  - tool integration format
  - prompt/rule package format
- [x] Add `healthlink-local doctor --agent <id>`.
- [x] Add tests using temporary agent homes/config files.

## Skill Layer TODO

MCP is the product protocol. Skills are optional instructions that improve natural-language tool use.

Tasks:

- [x] Add a bundled HealthLink skill Markdown template.
- [x] Add `healthlink-local print-skill --format markdown`.
- [x] Add `healthlink-local install-hermes-skill`.
- [x] Add `healthlink-local init --hermes --install-skill`.
- [x] Define a generic skill contract:
  - when to call `get_personal_context`
  - how to use lower-level tools
  - freshness reporting
  - privacy and medical-safety boundaries
  - language matching
- [x] Document how non-Hermes agents can import the skill/rule text.

## Transport Provider TODO

Transport should only decide how iOS reaches the Gateway. It should not affect pairing, scopes, storage, or MCP semantics.

Define a transport interface:

```ts
type TransportProvider = {
  id: "lan" | "tailscale" | "cloudflare" | "ngrok" | "public_https";
  getAdvertisedUrl(): Promise<string>;
  start?(): Promise<void>;
  healthCheck?(): Promise<TransportStatus>;
  stop?(): Promise<void>;
};
```

Tasks:

- [x] Move LAN advertised URL logic behind `TransportProvider`.
- [x] Add `--transport lan` explicitly.
- [x] Keep current LAN behavior as default.
- [x] Add Tailscale detection:
  - local Tailscale IP
  - reachability hints
- [x] Add Tailscale MagicDNS name support.
- [x] Add tunnel provider design:
  - Cloudflare Tunnel
  - ngrok
  - user-provided tunnel URL
- [x] Add public HTTPS mode docs.
- [x] Add pairing status payload field `transport`.
- [x] Add `healthlink-local doctor --transport <id>`.

## iOS Auto Sync TODO

Expected product behavior is "authorize once, then keep syncing automatically." It must remain user-controlled and honest about iOS background limits.

Foreground auto-sync:

- [x] Add Auto Sync setting, default on after pairing.
- [x] Add minimum sync interval setting, default 30 minutes.
- [x] Record:
  - `lastAutoSyncAt`
  - `lastManualSyncAt`
  - `lastSyncAttemptAt`
  - `lastSyncError`
- [x] Trigger auto-sync after successful pairing.
- [x] Trigger auto-sync after HealthKit permission grant.
- [x] Trigger auto-sync on app launch.
- [x] Trigger auto-sync when app returns to foreground.
- [x] Skip when already syncing, unpaired, missing token, missing permissions, or throttled.
- [x] Keep manual Sync button.
- [x] Show last sync and next eligible auto-sync in UI.

Background best-effort:

- [x] Add `BGAppRefreshTask` design.
- [x] Add `BGProcessingTask` design only if needed.
- [x] Add HealthKit observer query design.
- [x] Add HealthKit background delivery design.
- [x] Avoid product copy that promises exact sync intervals.

## Query / MCP TODO

Current direction is good: keep Agent tools provider-neutral.

- [x] Keep `get_personal_context` as the first tool for broad personal-context questions.
- [x] Include freshness metadata in all high-level responses.
- [x] Add source coverage metadata:
  - which source devices contributed
  - which metrics are missing
  - last sync per source
- [x] Add agent audit logging for MCP reads.
- [x] Add weekly summary tool after daily flow stabilizes.
- [x] Add feedback write tool when user feedback loops are ready.

## Migration Plan

Do not break the current local MVP.

Phase 1:

- [x] Document architecture boundaries.
- [x] Add adapter interfaces without moving all code.
- [x] Keep existing commands working.

Phase 2:

- [x] Move Hermes install logic into `AgentAdapter`.
- [x] Move LAN URL logic into `TransportProvider`.
- [x] Rename docs/types from device to source device where safe.

Phase 3:

- [x] Add foreground auto-sync.
- [x] Add bundled skill installer.
- [x] Add agent audit logging.

Phase 4:

- [x] Add Android / Health Connect design.
- [x] Add OpenClaw adapter.
- [x] Add first non-LAN transport.

## Non-Goals For This Upgrade

- Do not expose raw health samples by default.
- Do not make the iOS app run an Agent.
- Do not require HealthLink Cloud for local use.
- Do not promise exact iOS background sync intervals.
- Do not make skills mandatory for generic MCP support.
