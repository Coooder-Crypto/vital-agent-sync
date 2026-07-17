# Vital Agent Sync E2EE Relay Threat Model

This document defines the security boundary for the Vital Agent Sync relay route. It covers hosted relay and self-hosted relay modes that use the same encrypted envelope protocol.

## Scope

In scope:

- Vital Agent iOS app or compatible mobile source app.
- `vitalmcp` runtime, local SQLite database, MCP server, and private key storage.
- Hosted or self-hosted relay API that stores encrypted envelopes.
- OpenClaw, Hermes, and generic MCP agents that read through MCP.

Out of scope for this document:

- Apple HealthKit platform security.
- The operating system account security of the user's local machine.
- Medical interpretation quality.
- Hosted relay infrastructure hardening details beyond data-boundary requirements.

## Assets

Sensitive assets:

- Health payload plaintext.
- `~/.vital-agent-sync/vital-agent.sqlite`.
- `~/.vital-agent-sync/secrets/*`.
- Relay onboarding payloads that include `upload_auth_secret`, `relay_access_token`, and optional `relay_api_token`.
- Generated health reports and exported summaries.
- Onboarding payloads before the user verifies fingerprint and relay URL.

Less sensitive but still private:

- `~/.vital-agent-sync/config.json`.
- Relay user IDs, source device IDs, envelope IDs, sequence numbers, timestamps, and envelope sizes.
- Relay access-token hashes and device revocation metadata.
- Agent audit and feedback logs.

## Trust Boundaries

```text
HealthKit
  -> iOS source app
  -> encrypted envelope
  -> hosted/self-hosted relay
  -> vitalmcp private key boundary
  -> SQLite
  -> MCP
  -> Agent
```

The relay is not trusted with health plaintext. The relay may be trusted for availability and envelope retention only.

The local runtime is trusted with private keys and decrypted health summaries. Agents are trusted only through scoped MCP tools and should not read the SQLite file directly during normal operation.

## Intended Security Properties

- Relay operators cannot decrypt health payloads.
- Relay storage contains opaque encrypted envelopes and minimal hashed tenant/revocation metadata, not health plaintext or local private keys.
- Local private keys never leave `vitalmcp`.
- Decryption happens only on the local runtime machine.
- Decrypted payloads are schema-validated before SQLite ingestion.
- Failed envelopes are not acknowledged.
- Replayed or stale envelopes fail closed.
- Direct gateway and relay mode reuse the same normalized payload and MCP query layer.

## Threats And Mitigations

| Threat | Impact | Mitigation |
| --- | --- | --- |
| Relay database disclosure | Metadata and ciphertext leak. | Payloads are encrypted before upload; relay stores opaque JSON. Keep retention short and support purge. |
| Relay operator attempts plaintext inspection | Health privacy violation. | Relay code must not have private keys and must not parse health payloads. Tests should verify relay only validates envelope shape. |
| Envelope tampering | Corrupt or malicious data could be ingested. | HMAC/signature verification and AEAD authentication fail closed before ingest. |
| Replay of old envelopes | Duplicate or stale health context. | Sequence cursor, processed envelope IDs, idempotent `sync_id`, and freshness window. |
| Stale envelope upload | Agent uses old context as current. | Created-at freshness validation and MCP freshness metadata. |
| Local private key disclosure | Full relay history may become decryptable while retained. | Restrictive file permissions, no key printing, clear local-state warnings, future OS keychain support. |
| Malicious or compromised Agent | Agent could over-read or summarize sensitive data. | MCP exposes scoped tools and audit logs; skill guardrails forbid raw dumps by default. |
| Callback URL leakage | Health plaintext or caller tokens leak through logs or browser history. | Only `openclaw://` is allowed; original query/fragment data is discarded; output is rebuilt from a bounded request ID and fixed status/source fields. |
| Hosted relay abuse | Storage, memory, or availability degradation. | Envelope size limits, upload rate limits with bounded client tracking, bounded queue-read pages, quotas, retention jobs, and purge. |
| Cross-tenant mailbox access | One beta user could read, ack, or purge another user's envelopes. | Per-runtime Bearer tokens are bound to random user IDs; only hashes are stored; ack and lifecycle operations are tenant-scoped. |
| Leaked onboarding value | An attacker could upload forged envelopes or access a mailbox. | Treat the complete QR/deep link/text code as a credential, store mobile values in Keychain, avoid Agent/log copies, and provide rotate/reset. |
| Downgraded or credential-bearing relay URL | Source credentials could be exposed or routed ambiguously. | Hosted setup, onboarding, pull, status, and lifecycle operations require HTTPS; all relay URLs reject embedded user info, query strings, and fragments. |
| iOS background unreliability | Data freshness confusion. | Present sync as best effort; surface last generated, last uploaded, and last pulled times. |

## Current Implementation Evidence

Implemented in the local package:

- Envelope encryption/decryption and HMAC/signature verification: `packages/local/src/relay-crypto.ts`.
- Strict envelope routing/encoding/size validation before relay queue insertion: `packages/local/src/relay-crypto.ts`.
- Freshness, sequence, duplicate, and device validation: `packages/local/src/relay-crypto.ts`.
- Pull failure cursor metadata with no ack on failure: `packages/local/src/relay-pull.ts`.
- Relay API with opaque storage, purge, ack, status, TTL cleanup, upload size limit, and upload rate limit: `packages/local/src/relay-server.ts`.
- Mandatory per-user access-token protection plus optional deployment API-key protection for data endpoints: `packages/local/src/relay-server.ts`.
- Tenant-scoped unlink, credential rotation, user reset/revoke, queue purge, and local key replacement: `packages/local/src/relay-server.ts`, `packages/local/src/relay-lifecycle.ts`, and `packages/local/src/relay-runtime.ts`.
- Body-free aggregate metrics and relay status page: `packages/local/src/relay-server.ts`.
- Proxy-aware per-client rate limiting is explicit and disabled by default; the production Caddy Compose keeps port 8790 private before enabling it.
- Structured deployment audit for status, metrics, limits, public page, and known sensitive field names: `packages/local/src/relay-audit.ts`.
- OpenClaw skill export with privacy and freshness guardrails: `packages/local/src/skill.ts`.
- Repository release secret scan with built-in rule self-tests and value-redacted findings: `scripts/release-secret-scan.mjs`.
- MCP/query freshness metadata and stale-pull next actions: `packages/local/src/health-query.ts`.
- iOS relay onboarding, encrypted upload, and status-only callback code paths: `apps/ios/App/VitalAgentSyncApp.swift`, `apps/ios/App/GatewayAPIClient.swift`, `apps/ios/App/SyncCoordinator.swift`, and related app files.
- Positive and negative relay tests, deployment audit tests, and fixture-flow coverage: `packages/local/tests/local.test.ts`.
- CryptoKit-to-Node envelope compatibility gate: `scripts/e2ee-relay-ios-interop.mjs` and `scripts/ios-relay-crypto-fixture.swift`.
- Private local relay directories, config/cursor/key files, health and relay SQLite files, a sensitive-context Docker build ignore policy, and a non-root/Caddy production deployment template: `packages/local/src/database.ts`, `packages/local/src/relay-runtime.ts`, `packages/local/src/relay-pull.ts`, `packages/local/src/relay-server.ts`, `.dockerignore`, and `deploy/relay`.

Implemented but still needs environment validation:

- iOS relay onboarding and encrypted upload require full Xcode/device validation on an installed matching iOS SDK/runtime.
- Hosted relay quotas, metrics, status page, purge, and retention are implemented in app code, but must be verified in the deployed hosting environment.

Not yet implemented:

- Hosted relay production deployment.
- OS keychain-backed local private key storage.
- External ClawHub publication of the generated OpenClaw skill package.

## Security Review Checklist

- [x] Relay API responses and status pages do not include request bodies, ciphertext bodies, or health plaintext in tests.
- [x] Relay implementation has no code path that imports local private keys.
- [x] Bad signatures, tampered ciphertext, stale timestamps, duplicate IDs, wrong devices, and non-increasing sequences fail tests.
- [x] Malformed identifiers, fractional sequences, timestamps, key material, nonce, tag, ciphertext, and signatures are rejected before relay queue insertion.
- [x] `vitalmcp print-onboarding` does not print private keys.
- [x] Skill instructions forbid printing or copying `~/.vital-agent-sync/secrets`.
- [x] Skill instructions classify the complete onboarding value as credentials and require confirmation for lifecycle commands.
- [x] Cross-tenant list, ack, and purge attempts fail without modifying another tenant's queue in tests.
- [x] Unlink, rotate, and reset replace or revoke credentials and purge superseded envelopes in tests.
- [x] iOS deep links and callbacks are designed to contain control/status metadata only.
- [x] Privacy boundary states relay metadata exposure clearly.
- [ ] Hosted production logs are verified to exclude request bodies, ciphertext bodies, and health plaintext.
- [ ] Envelope size limits and retention are enabled in hosted deployment.
- [ ] Purge removes queued and acked envelopes for a user in the deployed environment.
- [ ] iOS deep links and encrypted upload are validated on a real device or matching simulator runtime.
