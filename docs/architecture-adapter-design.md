# HealthLink Adapter Architecture Design

This document turns the architecture upgrade TODO into implementation guidance for future source apps, agent runtimes, and transport modes. It is intentionally adapter-focused: the stable product surface remains scoped pairing, normalized storage, and MCP query tools.

## Current Status

Implemented in the local MVP branch:

- iOS source pairing and sync into local SQLite.
- Source-device compatibility wrappers over the legacy `devices` table.
- Generic MCP config output.
- Hermes MCP config install and optional HealthLink skill install.
- Agent adapter and transport provider interfaces.
- LAN default transport and Tailscale IPv4 detection.
- Foreground auto-sync in the iOS app.
- MCP freshness metadata, source coverage, audit logging, weekly summary, and feedback events.

Still intentionally future work:

- Android app implementation.
- Xiaomi / Mi Fitness connector implementation.
- Automatic WorkBuddy config installer.
- Native tunnel process management.
- Public HTTPS deployment automation.
- iOS background sync runtime tasks.

## Boundary Model

```mermaid
flowchart LR
  source["Source Apps\n(iOS, Android, Xiaomi, connectors)"]
  transport["Transport Providers\n(LAN, Tailscale, tunnel, HTTPS)"]
  gateway["HealthLink Gateway\n(pairing, auth, ingest, storage, audit)"]
  query["Query Layer\n(provider-neutral summaries)"]
  mcp["MCP Tools\n(context, status, feedback)"]
  agents["Agent Adapters\n(generic, Hermes, OpenClaw, WorkBuddy)"]

  source --> transport --> gateway --> query --> mcp --> agents
```

Adapters must not leak product semantics into each other:

- Source adapters collect user-authorized data and send normalized payloads.
- Transport providers only choose how the source reaches the gateway.
- Agent adapters only install, print, test, or reload MCP/skill config.
- Query tools hide provider-specific collection details behind provider-neutral summaries.

This means Android, Xiaomi, Hermes, OpenClaw, WorkBuddy, LAN, and tunnels can be added without changing the user-facing contract:

```text
Pair once. Authorize once. Keep syncing. Ask any connected Agent anytime.
```

## Package Boundaries

The current repo can keep code in `packages/local` while the MVP is small, but new modules should be written as if these packages exist:

```text
packages/core
  scopes
  normalized schemas
  query contracts
  shared validation

packages/gateway
  pairing sessions
  source-device auth
  ingest routes
  storage migrations
  revocation and audit

packages/local
  local CLI
  SQLite runtime
  foreground HTTP receiver
  local transport providers

packages/mcp
  MCP tool registration
  shared tool descriptions
  result envelopes and metadata

packages/agents
  generic MCP adapter
  Hermes adapter
  OpenClaw adapter
  WorkBuddy adapter

packages/sdk
  TypeScript client
  HTTP client
  schemas
  future webhook signatures

apps/ios
apps/android
```

Implementation rule: move behavior into a new package only when two callers need it, or when an adapter would otherwise depend on another adapter.

## Provider-Neutral Health Schema

All source apps should map into normalized daily summaries before ingest. Raw provider names stay in `provider`; query tools should reason over semantic fields.

```ts
type NormalizedHealthDailySummary = {
  date: string; // YYYY-MM-DD in source timezone
  timezone: string;
  provider: "apple_health" | "android_health_connect" | "xiaomi_mi_fitness" | string;
  steps?: number | null;
  sleep_minutes?: number | null;
  resting_heart_rate_bpm?: number | null;
  avg_heart_rate_bpm?: number | null;
  max_heart_rate_bpm?: number | null;
  active_energy_kcal?: number | null;
  workout_minutes?: number | null;
  workouts?: Array<{
    id: string;
    type: string;
    started_at: string;
    duration_minutes: number;
    active_energy_kcal?: number | null;
    avg_heart_rate_bpm?: number | null;
  }>;
};
```

Missing data must be explicit:

- Use `null` for a metric that the source supports but cannot provide for that date.
- Omit fields only when older clients do not know the field.
- Report source freshness through query metadata, not through invented metric values.
- Do not expose raw samples through default MCP tools.

Future schema splits can move `sleep_daily_summaries`, `activity_daily_summaries`, and `workout_records` into separate tables without changing MCP tool names.

## Android Health Connect Mapping

Android should be a source adapter, not a separate gateway.

Recommended mapping:

```text
Health Connect StepsRecord
  -> steps

Health Connect SleepSessionRecord
  -> sleep_minutes

Health Connect RestingHeartRateRecord
  -> resting_heart_rate_bpm

Health Connect HeartRateRecord
  -> avg_heart_rate_bpm / max_heart_rate_bpm after daily aggregation

Health Connect ActiveCaloriesBurnedRecord
  -> active_energy_kcal

Health Connect ExerciseSessionRecord
  -> workout_minutes and workouts[]
```

Android app responsibilities:

- Pair with the same `healthlink://pair?...` payload.
- Store server URL, source-device ID, and token in Android secure storage.
- Request Health Connect permissions once, with clear per-metric toggles when possible.
- Sync the same `/health/sync` payload shape.
- Treat background sync as best effort, using Android scheduling APIs instead of promising fixed cadence.

Gateway requirements before Android implementation:

- Keep provider strings open.
- Keep payload fields nullable.
- Include `source_platform: android` capability metadata.
- Keep `/source-devices` as the preferred API name while preserving `/devices`.

## Xiaomi / Mi Fitness Connector Notes

Xiaomi support should start as a connector adapter, not as a hard dependency in the gateway.

Likely data classes:

- daily steps
- sleep duration and sleep stages when available
- workout sessions
- active energy or equivalent activity calories when available
- heart-rate summaries when available

Connector rules:

- Normalize into the same daily summary payload.
- Use provider names such as `xiaomi_mi_fitness` or a connector-specific string.
- Mark unsupported metrics as missing instead of estimating them.
- Keep connector cadence in source metadata because wearable clouds can lag.
- Prefer local/export-based or user-authorized API access; do not require credential sharing as the default path.

The first Xiaomi milestone should be a documented import/connector path that can produce one valid `/health/sync` payload. Only after that should the gateway add Xiaomi-specific install helpers.

## Agent Adapter Contract

Agent adapters are installer helpers around the same MCP server:

```ts
type AgentAdapter = {
  id: "generic" | "hermes" | "openclaw" | "workbuddy";
  detect(): AgentInstallStatus;
  installMcp(config: McpServerConfig): InstallResult;
  installSkill?(skill: SkillPackage): InstallResult;
  formatMcpConfig(config: McpServerConfig): string;
  reloadHint(): string;
};
```

Before an adapter writes files automatically, it must have verified:

- config path discovery
- config file format
- MCP server declaration shape
- idempotent update behavior
- timestamped backups
- reload or restart instructions
- optional skill/rule import location

If any of those are unknown, the adapter should fall back to `print-agent-config --agent generic` and `print-skill`.

## OpenClaw Adapter Research

No local OpenClaw checkout was available under `/Users/coooder/Code/Agent/all-agents` during this pass. The implemented adapter therefore follows OpenClaw's documented `mcp.servers` config shape and remains conservative about writes: it only auto-writes configs that parse as JSON.

Implemented adapter behavior:

- `detect()` checks `~/.openclaw/openclaw.json`, or a custom `--openclaw-config` path.
- `formatMcpConfig()` returns OpenClaw-style `mcp.servers.healthlink` JSON.
- `installMcp()` backs up and writes `mcp.servers.healthlink` when the existing config is valid JSON.
- `reloadHint()` tells the user to restart OpenClaw if tools do not appear.

Open questions to close before expanding implementation:

- Does it support per-tool descriptions from MCP, separate rules, or both?
- Can reload happen in-session, or does it require restart?
- Should HealthLink install portable skill text into an OpenClaw skill directory, or should it keep skills manual through `print-skill`?

## WorkBuddy Adapter Research

No local WorkBuddy checkout was available under `/Users/coooder/Code/Agent/all-agents` during this pass, so this adapter should also remain research-mode until real files are inspected.

Target adapter behavior:

- `detect()` probes confirmed WorkBuddy config locations.
- `formatMcpConfig()` starts with generic MCP JSON.
- `installMcp()` writes only after WorkBuddy's tool integration format is known.
- `installSkill()` maps HealthLink skill Markdown into WorkBuddy's prompt/rule package only after that package format is documented.
- `reloadHint()` should provide the documented WorkBuddy refresh command or restart guidance.

Open questions to close before implementation:

- Does WorkBuddy consume MCP natively or through a plugin manifest?
- Where are user-level and workspace-level configs?
- Are tools scoped per project, per user, or per session?
- How are persistent rules/prompts packaged?
- How should a user revoke HealthLink access from WorkBuddy?

## Non-Hermes Skill Import

HealthLink skills must be portable text, not Hermes-only behavior.

Recommended generic import path:

1. User runs:

   ```bash
   healthlink-local print-skill --format markdown
   ```

2. User or adapter places the rendered Markdown into the agent's documented skill, rule, memory, or instruction location.
3. Agent uses MCP tool descriptions plus the skill text.
4. If the agent has no skill system, generic MCP still works because `get_personal_context` has a broad description.

Non-Hermes adapters should not install skill files until their rule format is verified. The fallback is always:

```bash
healthlink-local print-agent-config --agent generic
healthlink-local print-skill --format markdown
```

## Transport Provider Design

Transport providers answer one question: what URL should the phone use to reach the gateway?

They must not change:

- pairing code semantics
- source-device token behavior
- database path
- MCP tool behavior
- agent adapter behavior

### Tailscale MagicDNS

Current support detects local Tailscale IPv4 addresses and supports MagicDNS through `--tailscale-name`, `HEALTHLINK_TAILSCALE_NAME`, or best-effort `tailscale status --json` detection. MagicDNS support includes:

- optional hostname discovery through Tailscale status output or a user-provided hostname
- URL shape such as `http://machine.tailnet.ts.net:8787`
- `doctor --transport tailscale` checks for local address and hostname consistency
- a fallback to explicit `--server-url` when hostname discovery is unavailable

Do not block Tailscale use on MagicDNS; the current 100.64.0.0/10 URL path is valid.

### Cloudflare Tunnel

Future native provider:

- verifies `cloudflared` exists
- starts or references a named tunnel
- returns an HTTPS advertised URL
- warns that the tunnel is transport only, not HealthLink Cloud
- records no health data outside the user's receiver by default

Until then, users can pass:

```bash
healthlink-local init --transport cloudflare --server-url https://example.trycloudflare.com
```

### ngrok

Future native provider:

- verifies `ngrok` exists and is authenticated
- starts a local HTTP tunnel to the receiver port
- returns the HTTPS forwarding URL
- clearly marks ephemeral URLs unless the user has a reserved domain

Until then, users can pass:

```bash
healthlink-local init --transport ngrok --server-url https://example.ngrok-free.app
```

### Public HTTPS

Public HTTPS mode is for user-controlled servers, VPS deployments, or reverse proxies.

Requirements:

- stable DNS name
- valid HTTPS certificate
- receiver reachable from the phone
- persistent database volume
- firewall limited to the intended receiver port
- backups and revocation behavior documented by the deployment owner

HealthLink should provide config output and diagnostics first. It should not become a hosted health-data cloud by default.

## iOS Background Sync Design

Foreground auto-sync is implemented. Background sync should be honest best-effort behavior.

### BGAppRefreshTask

Use for lightweight refresh opportunities:

- register a HealthLink refresh task identifier
- schedule after successful sync and app foregrounding
- check pairing, permissions, battery/network conditions, and throttle interval
- call the same sync coordinator used by foreground auto-sync
- reschedule after completion

### BGProcessingTask

Use only if refresh work becomes too heavy for `BGAppRefreshTask`.

Conditions before adopting:

- sync payload generation is consistently too slow for refresh windows
- calendar/health aggregation requires larger batches
- user-visible benefit is clear

This should not be the first background implementation because it has higher system cost and more review surface.

### HealthKit Observer Queries

Use observer queries to learn that HealthKit data changed:

- register observers for selected metric types after permission grant
- set a "sync needed" flag
- trigger sync immediately only when foreground or background execution is granted
- never assume every observer callback can complete a network sync

### HealthKit Background Delivery

Enable background delivery for metric types the user authorized:

- request after HealthKit authorization succeeds
- use `.immediate` only where appropriate and allowed
- still apply HealthLink throttling before network sync
- surface last attempt and last successful sync in UI

Product copy must say "when iOS allows" or "best effort." It must not promise exact intervals.

## Migration Gates

Before merging a future adapter implementation:

- existing `init`, `init --hermes`, `print-mcp-config`, and `mcp` still work
- `/devices` compatibility remains until the iOS app has moved to `/source-devices`
- `/source-devices` is the preferred name in new docs and UI
- `list_source_devices` and `revoke_source_device` are preferred MCP tools for new integrations
- `list_devices` and `revoke_device` remain MCP aliases for compatibility
- every automatic config writer creates backups and is idempotent
- every transport can be diagnosed with `doctor --transport <id>`
- every agent can fall back to generic MCP config
- query tools keep returning provider-neutral summaries
