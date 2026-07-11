# HealthLink E2EE Relay Implementation Plan

This plan turns the E2EE relay technical route into executable milestones. It assumes the current direct receiver, SQLite, and MCP path continue to work while the relay path is added incrementally.

Current execution scope excludes product/marketing website implementation. Protocol, runtime, iOS, Agent skill, deployment assets, repository documentation, and release evidence remain in scope; website publication is a later, separate workstream.

Reference architecture: [e2ee-relay-technical-route.md](e2ee-relay-technical-route.md).
Security boundary: [e2ee-relay-threat-model.md](e2ee-relay-threat-model.md).
Protocol contract: [e2ee-relay-protocol-v1.md](e2ee-relay-protocol-v1.md).
User-facing privacy boundary: [e2ee-relay-privacy-boundary.md](e2ee-relay-privacy-boundary.md).
Hosted beta runbook: [e2ee-relay-hosted-runbook.md](e2ee-relay-hosted-runbook.md).
Data retention policy: [e2ee-relay-data-retention-policy.md](e2ee-relay-data-retention-policy.md).
Release audit gate: [e2ee-relay-release-audit.md](e2ee-relay-release-audit.md).

## Product Outcome

HealthLink should support two first-class setup paths:

```text
Default consumer path
  HealthLink iOS
    -> hosted E2EE relay
    -> healthlink-local pull/decrypt/ingest
    -> SQLite
    -> MCP
    -> OpenClaw / Hermes / generic Agent
```

```text
Self-owned path
  HealthLink iOS
    -> self-hosted relay or direct gateway
    -> healthlink-local
    -> SQLite
    -> MCP
    -> Agent
```

Every Agent should use the same MCP data interface. Hermes is the current executable compatibility baseline, generic MCP is the portability baseline, and OpenClaw can add a polished optional skill-style install flow without becoming a core dependency.

## Success Criteria

### User Experience

- A user can connect any MCP-compatible Agent to HealthLink.
- Agent-specific adapters can guide the user through local setup and iOS onboarding without owning health data or cryptography.
- The user does not need to expose a local port for hosted relay mode.
- The iOS app can sync health summaries over outbound HTTPS.
- The agent can answer health context questions through MCP after `healthlink-local pull`.
- Users can choose hosted relay, self-hosted relay, or direct gateway.

### Security

- Hosted relay stores encrypted envelopes plus minimal tenant/revocation metadata, never health plaintext or local private keys.
- Relay operators cannot decrypt health payloads.
- Local private keys never leave `healthlink-local`.
- iOS stores source-side pairing state, public encryption material, and source credentials in Keychain; it never receives local private keys.
- Decrypted data is schema-validated before SQLite ingestion.
- All generated reports and local state are documented as sensitive.

### Engineering

- Existing direct `/health/sync` path remains functional.
- Relay mode reuses existing normalized payload, ingestion, SQLite, and MCP query logic.
- Agent skill logic shells out to `healthlink-local`; it does not implement crypto or store data itself.
- Self-hosted relay uses the same protocol as hosted relay.

## Milestone 0: Route Alignment And Documentation

Status: complete for current relay architecture docs; revisit before hosted beta.

Deliverables:

- [x] E2EE relay technical route document.
- [x] This implementation plan.
- [x] Threat model outline.
- [x] User-facing privacy boundary draft.
- [x] Naming decision for hosted relay and local runtime.

Acceptance:

- Product, engineering, and privacy boundaries are written down.
- Direct mode and relay mode are described as transport alternatives over the same core data model.
- OpenClaw is positioned as a first-class adapter, not the core architecture.

## Milestone 1: Core Refactor For Shared Ingest

Status: canonical schema extraction, shared `ingestValidatedHealthSync`, direct/relay ingest convergence, validation tests, and server contract documentation are implemented.

Goal: make direct HTTP sync and future decrypted relay sync converge before database writes.

Work:

- [x] Extract canonical core schemas from `packages/local/src/health-ingest.ts`.
- [x] Add a shared `ingestValidatedHealthSync` or equivalent internal function.
- [x] Keep HTTP-specific auth and error formatting in the server layer.
- [x] Add unit tests for:
  - valid health sync payload
  - idempotent `sync_id`
  - device mismatch
  - missing scope
  - malformed payload
- [x] Document canonical JSON expectations for encrypted payloads.

Target files:

```text
packages/local/src/health-ingest.ts
packages/local/src/schemas.ts
packages/local/tests/local.test.ts
docs/server-contract.md
```

Acceptance:

- `POST /health/sync` behavior is unchanged.
- Tests prove ingestion can be called without Fastify request/response objects.
- MCP query results are unchanged for existing direct sync fixtures.

## Milestone 2: Local Runtime State And Key Material

Status: relay config/key generation, sensitive onboarding output, idempotent setup, malformed-config checks, atomic config replacement, `0700` default state/secrets/database directories, and `0600` config/key/cursor/health-SQLite/relay-SQLite files are implemented in `packages/local`. The packaged-runtime gate additionally proves these behaviors survive tarball installation outside the workspace.

Goal: let `healthlink-local` initialize relay-mode local state without contacting a production relay.

Work:

- Add runtime config file under `~/.healthlink/config.json`.
- Add secrets directory under `~/.healthlink/secrets`.
- Add key generation command:

```bash
healthlink-local setup --transport relay --agent hermes
healthlink-local print-onboarding
```

Hosted mode requires an operator-provided HTTPS URL through `--relay-url` or `HEALTHLINK_HOSTED_RELAY_URL`. The localhost fallback is self-hosted-only.

- Add onboarding payload generation with:
  - protocol version
  - relay URL
  - user ID
  - agent name
  - public encryption key
  - raw X25519 public encryption key
  - upload authentication secret for mobile HMAC envelope authentication
  - per-runtime relay access token for tenant-scoped mailbox authorization
  - optional deployment relay API key
  - fingerprint
  - requested scopes
- Add QR and hex/text output.
- Add `doctor` checks for missing keys and invalid config.

Implementation note:

- Use Node's built-in crypto only if it cleanly supports the selected primitives.
- If a third-party crypto dependency is needed, choose a small audited library and document why.
- Avoid OpenSSL shell-outs for new code.

Acceptance:

- Running setup creates deterministic directory structure with restrictive permissions where possible.
- `print-onboarding` does not print private key material.
- Re-running setup is idempotent and does not silently rotate keys.
- Tests cover config loading and malformed config failure.

## Milestone 3: Crypto Envelope Library

Status: the v1 protocol spec, X25519 + HKDF-SHA256 + ChaCha20-Poly1305 + HMAC envelope implementation, strict opaque-envelope field validation, freshness/replay validation, tested legacy decrypt compatibility, and negative fixtures are implemented in `packages/local`.

Goal: define and test encrypted envelope creation/decryption independent of relay networking.

Work:

- Add envelope types:

```text
HealthLinkEncryptedEnvelope
HealthLinkOnboardingPayload
HealthLinkRelayCursor
```

- Add encrypt/decrypt helpers.
- Add sign/verify helpers.
- Add replay/freshness validation helpers.
- Add canonical serialization helper for payloads.
- Add fixtures:
  - valid v1 envelope
  - tampered ciphertext
  - bad signature or HMAC
  - stale timestamp
  - duplicate envelope ID

Potential package path:

```text
packages/local/src/crypto/
```

Future package boundary:

```text
packages/crypto
```

Acceptance:

- A local fixture can encrypt a `HealthSyncPayload`, decrypt it, validate it, and ingest it.
- Bad signatures and tampered ciphertext fail closed.
- Crypto tests do not require network or platform-specific binaries.

## Milestone 4: Self-Hosted Relay MVP

Status: local MVP API, opaque SQLite storage, mandatory per-tenant token hashing/isolation, optional deployment API key, request-triggered plus periodic TTL cleanup, bounded upload-rate state, paginated queue reads, queue/device quotas, unlink/rotate/revoke lifecycle endpoints, and relay Docker Compose output are implemented.

Goal: provide a minimal relay implementation that stores ciphertext envelopes and minimal authorization metadata without health plaintext.

Work:

- Add relay server command:

```bash
healthlink-local relay serve --host 0.0.0.0 --port 8790
```

- Add relay API:

```http
POST /v1/envelopes
GET /v1/envelopes?user_id=...&after=...
POST /v1/envelopes/:envelope_id/ack
POST /v1/purge
POST /v1/devices/:device_id/unlink
POST /v1/credentials/rotate
POST /v1/users/revoke
GET /v1/status
```

- Store relay envelopes in a separate SQLite database or separate tables.
- Add TTL cleanup.
- Add basic rate limiting.
- Ensure logs never include ciphertext bodies.
- Add Docker Compose template for self-hosted relay.

Acceptance:

- Relay can accept opaque envelopes and return them to the local runtime.
- Relay can purge all envelopes for a user.
- Acked envelopes are not returned again.
- Relay tests verify it cannot parse or inspect health payloads.

## Milestone 5: Local Pull Pipeline

Status: fixture pull/decrypt/ingest path, automatic bounded-page draining, mobile-compatible HMAC envelopes, atomic failed/success cursor metadata, `pull --once`, foreground `pull --watch --interval-seconds`, and managed launchd/systemd `relay-pull` service mode are implemented.

Goal: make `healthlink-local` pull encrypted envelopes, decrypt them, and write existing HealthLink SQLite tables.

Work:

- Add commands:

```bash
healthlink-local pull
healthlink-local pull --once
healthlink-local relay status
```

- Pull flow:

```text
load config and secrets
  -> fetch envelopes after cursor
  -> verify envelope HMAC/signature
  -> decrypt payload
  -> parse HealthSyncPayload
  -> ingest into SQLite
  -> ack successful envelope
  -> update cursor
```

- Add failure behavior:
  - do not ack undecryptable envelopes
  - track last failed envelope ID
  - expose actionable CLI error messages
  - preserve idempotency via `sync_id`
- Add service manager support for periodic pull where appropriate.

Acceptance:

- A fixture envelope sent to relay becomes rows in `health_daily_summaries`.
- `get_personal_context` sees pulled data.
- Re-running pull is idempotent.
- Failed envelope processing is visible in `status` or `doctor`.

## Milestone 6: iOS Relay Onboarding And Encrypted Sync

Status: raw JSON/deep-link/text-code onboarding, Keychain-backed mobile credentials, relay pairing state, a persisted monotonic envelope sequence, UI confirmation copy, `healthlink://onboard` / `healthlink://sync` / status-only allowlisted callback handling, CryptoKit HKDF envelope encryption, tenant/deployment HTTP authentication, and relay upload are implemented in iOS. Swift typecheck and a CryptoKit-to-Node decrypt/schema/sequence interop gate pass locally; full Xcode/device workflow validation is user-owned on macOS 27 beta with the matching Xcode Beta and the paired iOS 26.5 device.

Goal: add relay mode to the iOS app while preserving direct mode.

Work:

- Add onboarding payload parser for QR/hex/deep link.
- Add new local pairing state for relay mode.
- Add encrypted sync transport.
- Add UI copy for:
  - relay host
  - fingerprint
  - scopes
  - plaintext boundary
  - sync status
- Keep direct `healthlink://pair?...` flow working.
- Add `healthlink://onboard?payload=...`.
- Add `healthlink://sync?source=<agent>&request_id=...`.
- [x] Add safe callback status support with scheme allowlisting, bounded request IDs, and complete original query/fragment stripping.

Acceptance:

- iOS can onboard against a local self-hosted relay.
- iOS can upload encrypted envelopes.
- No health plaintext appears in callback URLs.
- Direct mode regression test path still works on device.

## Milestone 7: Agent Skills And Adapters

Status: the Agent-neutral MCP surface is implemented, the Hermes config/skill installer is implemented, and `npm run audit:agent-adapters` proves a generic MCP tool call plus a real Hermes CLI handshake and discovery of all 12 tools. Portable skill output is parameterized by Agent. `export-skill --agent openclaw` remains an optional ClawHub package; its ClawHub dry-run succeeds, while account publication and listing install are deferred.

Goal: provide native install and operation experiences for individual Agents without moving core logic out of MCP and `healthlink-local`.

Work:

- [x] Create Agent-neutral skill content that instructs the agent to:
  - install/check `healthlink-local`
  - run relay setup
  - show onboarding QR/hex
  - ask user to sync in iOS
  - run `healthlink-local pull`
  - query MCP tools
  - suggest CronJobs for recurring pull/report
- Include guardrails:
  - do not print private keys
  - do not dump raw health data by default
  - mention data freshness
  - explain local state directory
  - warn when saving summaries
- [x] Add `healthlink-local print-skill --agent <agent>` and a Hermes-targeted installed skill.
- [x] Add an optional OpenClaw/ClawHub package export.
- [x] Add a repeatable generic MCP and Hermes CLI compatibility audit.

Acceptance:

- Generic MCP and Hermes install paths are documented and executable.
- Optional OpenClaw packaging remains isolated in the adapter layer.
- The skill can guide a first-time user from setup to first MCP answer.
- The skill does not include crypto implementation or copied third-party content.

## Milestone 8: Hosted Relay Beta

Status: relay server now has configurable retention, periodic sweep, size/rate/queue/device limits, mandatory tenant isolation, optional deployment API-key protection, lifecycle controls, protected body-free metrics, aggregate status page, hosted URL override, source-built development and Caddy-backed production Compose assets, trusted-proxy client-IP handling, a pruned compiler-free non-root/read-only runtime image, a sensitive-context `.dockerignore`, production configuration preflight, passive status audit plus opt-in disposable-tenant active audit, runbook, retention policy, and release gates. Both Compose files pass local syntax validation; `preflight:relay-production` validates the fully interpolated production model without exposing secrets, while `audit:relay-container` proves the relay image build, runtime dependency/security probe, Caddy 2.11.4 validation, hardened-container active audit, sensitive-log scan, database cleanup, and isolated resource teardown. Actual hosted deployment remains.

Goal: launch a hosted relay with the same API as self-hosted relay.

Work:

- Deploy hosted relay.
- [x] Add deployable hosted relay container assets.
- [ ] Bind the production hosted relay base URL into the distributed default after the hosted environment exists; explicit HTTPS URL/env configuration is implemented and fail-closed today.
- [x] Add abuse controls:
  - rate limits
  - envelope size limits
  - user/device quotas
  - retention jobs
- [x] Add operational controls:
  - purge endpoint
  - status page
  - metrics that do not expose payloads
  - incident runbook
  - post-deploy audit command
- [x] Add documentation drafts for:
  - privacy policy
  - threat model
  - data retention policy
  - self-hosting docs

Acceptance:

- Hosted relay can complete first-run setup with iOS and local pull.
- Relay operators cannot decrypt test payloads.
- Purge and retention are verified.
- Production logs do not contain ciphertext bodies or health plaintext.

## Milestone 9: MCP And Agent UX Polish

Status: MCP/query metadata, `healthlink-local status`, `doctor`, skill freshness handling, daily/weekly report templates, and relay pull next-action prompting are implemented.

Goal: make relay mode feel native once data is available.

Work:

- [x] Add MCP freshness metadata:
  - latest pulled envelope time
  - latest source generated time
  - latest successful local pull
  - relay transport mode
- [x] Add MCP tool or status field that suggests `healthlink-local pull` when data is stale.
- [x] Add weekly/daily report templates.
- [x] Add OpenClaw/Hermes skill instructions for freshness handling.
- [x] Add optional deep link prompt from agent:

```text
Open HealthLink on your iPhone to sync now:
healthlink://sync?source=<agent>&request_id=...
```

Acceptance:

- Agent answers include data freshness.
- Stale data produces a clear next action.
- No user has to know where SQLite lives during normal operation.

## Milestone 10: Self-Hosted And Developer Experience

Status: self-hosted relay Compose output, self-hosted setup, executable hosted-to-self-hosted identity migration, encrypted fixture generation, local relay fixture-flow script, migration docs, and direct gateway vs relay comparison docs are implemented.

Goal: make open-source/self-owned deployment credible.

Work:

- [x] Add self-hosted relay Docker image and Compose file.
- [x] Add `healthlink-local setup --transport self-hosted-relay --relay-url ...`.
- [x] Add migration docs from hosted to self-hosted.
- [x] Add direct gateway vs relay comparison docs.
- [x] Add test fixture generator for encrypted envelopes.
- [x] Add local integration test script:

```text
start relay
  -> generate onboarding
  -> submit fixture encrypted envelope
  -> pull
  -> query MCP/status
```

Acceptance:

- A developer can run the full relay path locally with `npm --workspace healthlink-local run relay:fixture-flow`.
- Hosted and self-hosted relay APIs stay compatible.
- Docs make the tradeoffs explicit.

## Workstream Breakdown

### iOS Workstream

- HealthKit collection remains current source adapter.
- Add relay onboarding parser.
- Add encrypted transport.
- Add direct/relay mode selection.
- Add deep link handling.
- Add foreground sync and best-effort background sync for relay mode.

### Local Runtime Workstream

- Config/secrets management.
- Crypto envelope handling.
- Relay pull.
- Shared ingest.
- MCP freshness metadata.
- Agent installer updates.

### Relay Workstream

- API and storage.
- TTL/purge/ack.
- Rate limits.
- Hosted deployment.
- Self-hosted Docker path.

### Agent Workstream

- OpenClaw skill package.
- Hermes skill updates.
- Generic MCP docs.
- CronJob guidance.
- Safe report generation.

### Security/Privacy Workstream

- Threat model.
- Privacy policy.
- Secret handling docs.
- Local state hardening.
- Logging policy.
- Security scan checklist before public release.

## Suggested First Sprint

Sprint goal: make relay mode possible without iOS changes by using fixture envelopes.

Tasks:

1. [x] Reuse existing validated ingest path for decrypted payloads.
2. [x] Add local runtime config skeleton under `~/.healthlink`.
3. [x] Add crypto envelope types and a positive-path fixture.
4. [x] Add a fake/self-host relay server that stores opaque envelopes.
5. [x] Add `healthlink-local pull`.
6. [x] Prove a fixture encrypted payload becomes MCP-readable health context.
7. [x] Add negative crypto fixtures for tampering, bad signatures, stale timestamps, and replay.
8. [x] Add relay TTL cleanup, rate limiting, and self-host Docker packaging.
9. [x] Add iOS relay onboarding and encrypted upload.
10. [x] Add fixture generator and local relay fixture-flow smoke script.

Exit criteria:

```text
fixture HealthSyncPayload
  -> encrypt envelope
  -> POST relay
  -> healthlink-local pull --once
  -> SQLite rows
  -> get_daily_health_summary returns fixture values
```

This sprint avoids iOS, hosted infra, and OpenClaw packaging until the core relay pipeline is proven.

## Risks And Mitigations

| Risk | Mitigation |
| --- | --- |
| Crypto implementation mistakes | Use standard primitives, small reviewed libraries, fixtures, negative tests, and a dedicated crypto spec. |
| Hosted relay trust concerns | Keep self-hosted relay first-class, publish the threat model, and store no health plaintext or raw tenant credentials. |
| OpenClaw coupling | Keep OpenClaw in adapter/skill layer; MCP remains the data API. |
| Local secret leakage | Restrictive file permissions, clear docs, no key printing, future OS keychain support. |
| iOS background sync unreliability | Use foreground sync, HealthKit/background best-effort, and agent-triggered deep links. |
| Product confusion with existing competitors | Use distinct branding, protocol, docs, and position around MCP-native multi-agent support. |
| Overbuilding hosted infra too early | Build self-hosted relay and fixture pipeline first; hosted beta after local proof. |

## Release Plan

### Alpha

- Self-hosted relay only.
- Fixture and developer flow.
- Direct mode unchanged.
- No hosted relay.
- No App Store release dependency.

### Private Beta

- iOS encrypted sync.
- Hosted relay test environment.
- Generic MCP and Hermes adapter verified.
- Optional OpenClaw skill draft.
- Manual onboarding.
- Limited users.

### Public Beta

- Hosted relay default.
- Self-host docs.
- Generic MCP path and at least one executable Agent adapter published.
- Optional Agent marketplace packages can ship independently.
- MCP freshness UX.
- Privacy policy and threat model published.

### Stable v1

- Hosted relay production.
- Self-host relay production.
- Direct gateway retained.
- Generic MCP and Hermes install paths stable; additional Agent adapters remain independently replaceable.
- [x] Key rotation/reset/unlink supported in the local runtime and relay protocol; production verification remains part of the hosted gate.

## V1 Decisions

- Crypto: X25519 + HKDF-SHA256 + ChaCha20-Poly1305 + HMAC-SHA256, fixed in the protocol spec.
- Relay authentication: per-runtime tenant Bearer token stored as a hash, plus optional shared deployment API key and separate metrics token.
- Relay state: separate relay SQLite database.
- Package boundary: keep crypto/relay modules under `packages/local` until a second caller justifies extraction.
- Hosted identity: anonymous random identifiers for beta; no account dependency in v1.
- Defaults: 30-day envelope retention, 512 KiB envelope limit, 120 uploads/IP/minute, 1000 queued envelopes/user, and 5 active source devices/user.
- Mobile control: deep links in v1; App Intents deferred.
- Agent compatibility: generic MCP is the stable contract and Hermes is the current real-runtime audit target.
- OpenClaw packaging: generated reviewable `SKILL.md` package from `healthlink-local`; ClawHub publication is an optional adapter release gate, not a core relay beta dependency.

## Immediate Next Actions

1. [x] Run `npm run audit:relay-local` from [e2ee-relay-release-audit.md](e2ee-relay-release-audit.md).
2. [x] Run `npm run audit:agent-adapters`; generic MCP calls `healthlink_status` and Hermes v0.17.0 discovers all 12 tools.
3. [ ] User device gate: validate the iOS relay path with the matching Xcode Beta on macOS 27 beta and the paired iOS 26.5 iPhone.
4. [ ] Deploy a hosted relay beta environment, export its URL/API/metrics credentials, and run `npm run audit:relay-hosted -- --yes`; the wrapper performs passive and active audits without putting tokens in process arguments.
5. [x] Commit/review the release worktree, run the authenticated `release:npm-preflight`, publish `healthlink-local@0.2.0`, confirm registry metadata, and smoke test an isolated global install plus encrypted fixture generation.
6. [ ] Complete the hosted environment gate: HTTPS, edge rate limits, log redaction, backups, metrics access control, purge, retention cleanup, and distributed privacy docs. Website work remains out of scope for this execution.
7. [ ] Optional adapter release: publish the generated OpenClaw package on ClawHub and smoke test installation from the listing when OpenClaw validation resumes.
