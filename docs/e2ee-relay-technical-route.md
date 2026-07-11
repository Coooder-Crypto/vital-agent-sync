# HealthLink E2EE Relay Technical Route

This document defines the next HealthLink architecture direction: keep HealthLink MCP-native and source-owned, while adding an end-to-end encrypted relay transport and Agent-specific onboarding adapters. The goal is to improve setup UX without coupling HealthLink to any one Agent. For the canonical install and onboarding state machine, see [agent-first-onboarding.md](agent-first-onboarding.md). For staged relay execution, see [e2ee-relay-implementation-plan.md](e2ee-relay-implementation-plan.md).

The product shape can learn from existing Apple Health sync products for agents, but HealthLink must use its own protocol, code, schemas, copy, assets, and branding.

## Summary

Current HealthLink is a direct receiver model:

```text
HealthLink iOS
  -> POST /health/sync
  -> healthlink-local HTTP receiver
  -> SQLite
  -> MCP tools
  -> Agent
```

The target model adds an E2EE pull relay transport:

```text
HealthLink iOS
  -> encrypt normalized health payload
  -> hosted or self-hosted relay stores opaque ciphertext
  -> healthlink-local pulls ciphertext
  -> local decrypt, validate, ingest
  -> SQLite
  -> MCP tools
  -> Agent
```

OpenClaw, Hermes, Codex, Claude, and other agents should continue to consume HealthLink through MCP. Agent-specific skills should install, initialize, trigger sync, and explain results; they should not become the core data layer.

## Product Goals

- Default setup should not require inbound ports, LAN reachability, public DNS, reverse proxies, or Tailscale.
- Health data plaintext should exist only on the source device and the user's local runtime.
- The hosted relay should only see encrypted envelopes and routing metadata.
- The self-hosted path should use the same protocol as the hosted relay.
- MCP should remain the stable agent interface.
- Generic MCP must work without an Agent-specific package; Hermes is the current executable compatibility baseline, and OpenClaw remains an optional first-class adapter.
- Existing direct LAN, Tailscale, Docker, and public HTTPS modes should remain available for users who want no hosted relay.

## Non-Goals

- Do not copy another product's code, skill text, assets, names, or protocol.
- Do not send Apple Health plaintext through URL callbacks, OpenClaw node responses, logs, or relay storage.
- Do not require the OpenClaw iOS app to read HealthKit.
- Do not make the relay a health data warehouse.
- Do not expose raw HealthKit samples by default.

## Layered Architecture

```text
Source adapters
  iOS HealthKit
  Android Health Connect
  future wearable connectors

Core schema
  normalized daily summaries
  workouts
  feedback events
  source metadata

Crypto protocol
  onboarding payloads
  device keys
  encrypted envelopes
  signatures
  replay protection

Transport adapters
  direct_lan
  public_https
  tailscale
  hosted_relay
  self_hosted_relay

Local runtime
  setup
  pull
  decrypt
  ingest
  SQLite
  MCP stdio server

Agent adapters
  generic MCP config
  Hermes skill
  OpenClaw skill
  future agent installers

Mobile trigger adapters
  healthlink:// deep links
  Universal Links
  App Intents / Shortcuts
  future OpenClaw node bridge
```

Each layer should be replaceable without leaking product semantics into the others. For example, OpenClaw skills should not know how HealthKit fields are aggregated, and the relay should not know what `sleep_minutes` means.

## Deployment Modes

### Hosted Relay Mode

Default consumer UX.

```text
iPhone
  -> HTTPS outbound
  -> HealthLink hosted relay
  -> healthlink-local pull
  -> ~/.healthlink/healthlink.sqlite
  -> MCP stdio
  -> Agent
```

Properties:

- no inbound traffic to the user's machine
- works across networks
- relay stores ciphertext only
- relay retention is short and explicit
- local runtime owns private keys and SQLite

### Self-Hosted Relay Mode

Power-user and open-source path.

```text
iPhone
  -> user's relay URL
  -> healthlink-local pull
  -> SQLite
  -> MCP
  -> Agent
```

The self-hosted relay must implement the same relay API as the hosted service. Users should be able to switch from hosted to self-hosted without changing the iOS app's health schema or the MCP tools.

### Direct Gateway Mode

Existing mode, kept for fully local users.

```text
iPhone
  -> LAN / Tailscale / public HTTPS
  -> healthlink-local /health/sync
  -> SQLite
  -> MCP
  -> Agent
```

This remains the best path for users who refuse hosted infrastructure and can manage network reachability.

## Core Payload

The existing `HealthSyncPayload` remains the canonical plaintext sync object:

```json
{
  "device_id": "dev_...",
  "sync_id": "sync_...",
  "generated_at": "2026-07-08T10:20:00+08:00",
  "timezone": "Asia/Shanghai",
  "health_daily_summaries": [
    {
      "date": "2026-07-08",
      "timezone": "Asia/Shanghai",
      "provider": "apple_health",
      "steps": 8420,
      "sleep_minutes": 392,
      "resting_heart_rate_bpm": 63.0,
      "heart_rate_variability_ms": 41.2,
      "workout_minutes": 38,
      "workouts": []
    }
  ]
}
```

Rules:

- Keep the schema provider-neutral.
- Use `null` when a source supports a metric but cannot provide it.
- Omit fields only for older clients that do not know them.
- Do not encrypt each metric separately in v1; encrypt the whole canonical JSON payload.
- Keep the direct `/health/sync` payload and the encrypted relay plaintext payload aligned.

## E2EE Protocol

### Key Model

The local runtime generates and stores long-lived local secrets:

```text
~/.healthlink/
  config.json
  secrets/
    signing_private_key.pem
    encryption_private_key.pem
  relay-cursor.json
  healthlink.sqlite
```

The iOS app receives onboarding material containing public encryption data and sensitive source credentials:

- `user_id`
- relay URL
- local runtime public encryption key
- raw X25519 public encryption key for mobile CryptoKit clients
- upload authentication secret for HMAC envelope authentication
- per-runtime relay access token for tenant-scoped mailbox authorization
- optional deployment relay API key for closed-beta/edge access
- local runtime fingerprint
- requested scopes
- protocol version

The iOS app should not receive local private keys. The upload authentication secret and relay access credentials are included so the mobile app can authenticate envelopes and reach its mailbox; treat the complete onboarding payload as sensitive and never copy it into Agent chat or logs.

Final v1 primitives:

- X25519 key agreement
- HKDF-SHA256 with the fixed `healthlink-e2ee-v1 envelope` context
- ChaCha20-Poly1305 payload encryption
- HMAC-SHA256 over canonical envelope metadata and ciphertext using the onboarding upload authentication secret
- SHA-256 fingerprints for human-visible verification

The exact contract is defined in [e2ee-relay-protocol-v1.md](e2ee-relay-protocol-v1.md).

### Onboarding Payload

The local runtime creates an onboarding QR and optional hex/text fallback.

```json
{
  "protocol": "healthlink-e2ee-v1",
  "mode": "hosted_relay",
  "relay_url": "https://relay.healthlink.app",
  "user_id": "usr_...",
  "agent_name": "OpenClaw",
  "encryption_public_key": "...",
  "encryption_public_key_x25519": "...",
  "upload_auth_secret": "...",
  "relay_access_token": "...",
  "relay_api_token": "... optional ...",
  "fingerprint": "ABCD 1234 ...",
  "requested_scopes": [
    "health.daily_summary.write"
  ],
  "created_at": "2026-07-08T10:20:00Z"
}
```

The iOS app shows:

- relay host
- agent name
- requested scopes
- key fingerprint
- privacy warning that the relay sees ciphertext only

### Encrypted Envelope

The relay stores opaque envelopes:

```json
{
  "protocol": "healthlink-e2ee-v1",
  "user_id": "usr_...",
  "device_id": "dev_...",
  "envelope_id": "env_...",
  "sequence": 42,
  "payload_type": "health.sync",
  "created_at": "2026-07-08T10:25:00Z",
  "content_encoding": "canonical-json",
  "crypto": {
    "alg": "x25519-hkdf-sha256-chacha20poly1305-hmac-sha256",
    "sender_public_key_x25519": "...",
    "nonce": "...",
    "tag": "...",
    "ciphertext": "...",
    "signature": "..."
  }
}
```

Rules:

- `envelope_id` must be unique.
- `sequence` must be monotonic per source device when possible.
- `created_at` must be validated for freshness windows.
- HMAC signature covers the envelope metadata and ciphertext.
- Decrypted payload must validate against the core schema before ingestion.
- Replay attempts must not create duplicate sync batches.

## Relay API

The relay is a ciphertext mailbox, not a health API.

Minimum API:

```http
POST /v1/envelopes
GET /v1/envelopes?user_id=...&after=...
POST /v1/envelopes/:envelope_id/ack
POST /v1/devices/:device_id/unlink
POST /v1/purge
POST /v1/credentials/rotate
POST /v1/users/revoke
GET /v1/status
```

Relay responsibilities:

- authenticate envelope writers and pullers
- store encrypted envelopes
- enforce TTL
- enforce rate limits
- support explicit purge
- support device unlink
- expose delivery status
- avoid payload logging

Relay non-responsibilities:

- decrypt health data
- interpret metrics
- generate summaries
- expose MCP tools
- store long-term health history

Retention defaults:

- unacked envelopes expire after a short window, such as 7 days
- acked envelopes are deleted quickly, such as within 24 hours
- users can purge all queued data immediately

## Local Runtime

`healthlink-local` becomes the common runtime for direct and relay modes.

New commands:

```bash
healthlink-local setup --agent openclaw --transport relay
healthlink-local setup --agent generic --transport self-hosted-relay --relay-url https://...
healthlink-local print-onboarding
healthlink-local pull
healthlink-local pull --once
healthlink-local relay status
healthlink-local relay unlink --yes
healthlink-local relay rotate --yes
healthlink-local relay reset --yes
```

Existing commands continue:

```bash
healthlink-local setup
healthlink-local daemon
healthlink-local pair
healthlink-local mcp
healthlink-local status
healthlink-local doctor
```

`pull` flow:

```text
read local config and private keys
  -> authenticate to relay
  -> fetch encrypted envelopes after cursor
  -> verify HMAC signatures and freshness
  -> decrypt payloads
  -> validate HealthSyncPayload
  -> ingest into existing SQLite tables
  -> ack successfully processed envelopes
  -> update cursor
```

The ingestion layer should reuse existing database and query code. Direct mode and relay mode should converge before SQLite:

```text
direct mode: /health/sync -> parseHealthSyncPayload -> ingestHealthSync
relay mode: decrypt envelope -> parseHealthSyncPayload -> ingestHealthSync
```

## iOS App

The iOS app remains the authority for Apple Health authorization and HealthKit collection.

Required additions:

- parse E2EE onboarding QR/hex
- store relay pairing state
- generate or store source device identity
- encrypt `HealthSyncPayload`
- upload encrypted envelopes to relay
- retain direct `/health/sync` support
- support deep links for pairing and sync triggers

Deep links:

```text
healthlink://onboard?payload=...
healthlink://sync?source=<agent>&request_id=...
healthlink://status?callback=...
```

Callback rules:

- callbacks may report status, request ID, and freshness
- callbacks must not include health payloads or bearer tokens
- allowlist callback schemes, such as `openclaw://`
- support no-callback mode because many agents will read through MCP after sync

Example callback:

```text
openclaw://callback?request_id=req_123&status=ok&synced_days=1
```

Current iOS implementation keeps callbacks status-only and allowlisted. `healthlink://sync?...&callback=openclaw%3A%2F%2Fcallback` and `healthlink://status?...&callback=openclaw%3A%2F%2Fcallback` can return `request_id`, `status`, and `source=healthlink`; they do not return health payloads, bearer tokens, envelope IDs, or error details.

## Agent Adapter Contract

The core runtime exposes one stdio MCP server and one local SQLite model. Agent adapters may only:

- detect and write the Agent's MCP configuration
- install optional usage guidance or skills
- choose setup, pull, status, and deep-link control commands
- provide an Agent-specific reload hint

They must not implement relay cryptography, ingest health payloads, fork the tool schema, or read relay secrets. `generic` prints standard `mcpServers` JSON, Hermes writes `mcp_servers.healthlink`, and OpenClaw writes its adapter-specific MCP shape. All three point to the same `healthlink-local mcp --db <path>` process.

Agent-first setup does not change this boundary. Skills invoke the shared bootstrap, present a redacted plan, offer one onboarding action, and verify the first sync through MCP. The website installer and marketplace packages are distribution surfaces over the same setup state.

The repeatable compatibility gate is `npm run audit:agent-adapters`. It calls `healthlink_status` through a generic MCP client, installs Hermes config and skill state into a temporary HOME, then uses the locally installed Hermes CLI to connect and discover all 12 HealthLink tools. An Agent-specific marketplace package is not required for this gate.

## Optional OpenClaw Adapter

OpenClaw support should have two pieces:

1. MCP config installer in `healthlink-local`.
2. OpenClaw skill package for guided onboarding and operations.

The skill should guide the user through:

```text
install healthlink-local
  -> run setup --agent openclaw --transport relay
  -> show QR or hex onboarding payload
  -> ask user to onboard HealthLink iOS
  -> run pull after first iOS sync
  -> call MCP tools for analysis
  -> suggest CronJobs for recurring pull/report
```

The complete onboarding payload remains sensitive. Until a short-lived, single-use onboarding ticket exists, the Skill should prefer a local QR page/file and require explicit user intent before attaching a credential-bearing QR to a cloud-hosted Agent conversation.

The exported ClawHub folder uses `SKILL.md` frontmatter as the authoritative package metadata. Under `metadata.openclaw`, it declares the required `healthlink-local` binary and its Node install specification; no separate custom manifest is needed. ClawHub publication applies MIT-0, so the skill does not declare a conflicting license.

Skill responsibilities:

- choose the right CLI command
- avoid dumping raw health data
- mention freshness before analysis
- suggest `healthlink-local pull` when data is stale
- explain local state and privacy boundaries
- guide unlink/reset flows

Skill non-responsibilities:

- implement cryptography
- store health data itself
- parse HealthKit payloads
- bypass MCP
- expose private key material

## Future Mobile Agent Compatibility

OpenClaw iOS and future mobile agent apps should be treated as trigger surfaces, not health data stores.

Supported trigger shape:

```text
Agent mobile app
  -> opens HealthLink deep link
  -> HealthLink syncs
  -> local runtime pulls/ingests
  -> Agent reads MCP
```

If OpenClaw later exposes a stable node command extension model, HealthLink can add a node bridge with control commands only:

```text
healthlink.status
healthlink.sync
healthlink.open_onboarding
healthlink.unlink
```

Those commands should not return health plaintext. MCP remains the data access path.

## Package Plan

Near-term code can stay in the monorepo, but modules should be written toward these boundaries:

```text
packages/core
  normalized schemas
  canonical JSON helpers
  scope constants

packages/crypto
  onboarding payloads
  envelope types
  encryption/decryption helpers
  signature verification

packages/relay
  hosted/self-hosted relay server
  mailbox API
  retention and purge jobs

packages/local
  CLI runtime
  key generation
  relay pull
  direct HTTP receiver
  SQLite

packages/mcp
  MCP tools
  query envelopes

packages/agents
  generic MCP adapter
  OpenClaw skill installer
  Hermes skill installer

apps/ios
  HealthKit source adapter
  encrypted sync transport
  direct sync transport

apps/www
  product site and setup docs
```

Move code into a package only when there are two callers or a boundary becomes hard to enforce inside `packages/local`.

## Security Requirements

HealthLink should publish an explicit threat model before hosted relay launch.

Required guarantees:

- relay cannot decrypt health payloads
- relay does not log ciphertext bodies by default
- local private keys never leave the local runtime
- iOS never receives local private keys
- all decrypted payloads are schema-validated before ingestion
- sync batches are idempotent
- stale, replayed, or malformed envelopes fail closed
- local state directory is treated as sensitive
- saved reports clearly warn that they contain health-derived data

Operational requirements:

- document relay retention
- provide purge
- provide unlink
- provide key rotation or reset
- provide `doctor` diagnostics without dumping secrets
- make backups and file locations explicit

## Implementation Phases

### Phase 1: Refactor For Shared Ingest

- Keep direct mode working.
- Isolate core schema validation from HTTP handlers.
- Add internal ingestion entry point that can accept plaintext payloads from either HTTP or decrypted relay envelopes.
- Add docs for the new route.

### Phase 2: Local Runtime Keys And Onboarding

- Add key generation to `healthlink-local setup --transport relay`.
- Add `print-onboarding`.
- Store config and secrets under `~/.healthlink`.
- Add QR and hex onboarding output.

### Phase 3: Relay MVP

- Add a minimal self-hostable relay.
- Store encrypted envelopes and minimal hashed tenant/revocation metadata only; never health plaintext or raw onboarding credentials.
- Add pull, ack, TTL, purge, and status endpoints.
- Add `healthlink-local pull --once`.

### Phase 4: iOS Encrypted Sync

- Add relay onboarding parser.
- Add encrypted sync transport.
- Preserve direct transport.
- Add sync status that distinguishes direct vs relay mode.

### Phase 5: Agent Adapters And Mobile Trigger

- Verify generic MCP and Hermes as the baseline Agent paths.
- Optionally publish an OpenClaw skill that wraps setup, onboarding, pull, summaries, and CronJob guidance.
- Add `healthlink://sync` deep link.
- Add safe callback status support.
- Keep MCP as the health data access path.

### Phase 6: Hosted Relay Beta

- Use the same relay API and envelope protocol as self-hosted mode.
- Deploy the relay container behind managed HTTPS and infrastructure rate limits.
- Run the passive `healthlink-local relay audit --relay-url <hosted-url>` and the opt-in disposable-tenant `--active --yes` audit after each deploy.
- Publish privacy boundary, threat model, data retention policy, hosted runbook, and release audit gate.
- Keep the self-hosted relay available from the same codebase.

## V1 Decisions

- Crypto and canonicalization remain under `packages/local` until a second runtime caller justifies `packages/crypto`; the protocol boundary is already documented separately.
- Local private keys use restrictive files for v1. OS keychain integration remains a hardening follow-up.
- Hosted beta uses anonymous random user IDs with per-runtime access tokens stored only as hashes on the relay.
- Beta envelope retention defaults to 30 days and must be revisited before public beta.
- App Intents are deferred; URL deep-link triggers are the v1 mobile-agent control surface.
- Generic MCP remains the release contract; Hermes is the executable adapter audit target.
- OpenClaw skill metadata is generated by `healthlink-local` and exported as a reviewable optional ClawHub package.

## Positioning

HealthLink should not be positioned as an OpenClaw clone or an OpenClaw-only Apple Health app. The stronger positioning is:

```text
HealthLink is a private Apple Health gateway for MCP-compatible agents.
It keeps the data model, relay protocol, and MCP surface portable, then
adds replaceable adapters for Hermes, OpenClaw, and future Agent runtimes.
```

The differentiator is the combination of:

- E2EE relay mode for simple setup
- self-hosted relay and direct gateway modes for ownership
- normalized SQLite storage for auditability
- MCP-native agent access
- source-device scopes and revocation
- multi-agent support from the same synced health context
