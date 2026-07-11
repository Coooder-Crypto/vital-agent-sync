# HealthLink E2EE Relay Release Audit

This document maps the implementation plan to concrete verification evidence. It separates local engineering evidence from checks that must be performed against a real hosted environment, ClawHub listing, or iOS device.

## Local Engineering Evidence

Run these from the repository root before tagging a relay beta build:

```bash
npm run audit:relay-local
npm run audit:relay-container
npm run audit:relay-package
npm run audit:agent-adapters
npm run audit:dependencies
npm run audit:secrets
```

`audit:relay-local` covers TypeScript, Node tests, compiled fixture/CLI behavior, and iOS source/crypto interoperability. `audit:relay-container` requires a running Docker daemon and automates Compose validation, relay image build, runtime dependency/toolchain inspection, Caddy validation, hardened-container active audit, log scanning, SQLite cleanup checks, and teardown of uniquely named temporary resources. `audit:relay-package` packs `healthlink-local`, installs the tarball into an isolated temporary global prefix/cache, and uses only that installed CLI for encrypted fixture upload/pull/SQLite verification, active relay audit, and optional OpenClaw Skill export before removing all temporary state. Its cold dependency install prints a heartbeat every 15 seconds, bounds npm fetch retries, fails after five minutes, and cleans the child process plus temporary state on failure or interruption. `audit:agent-adapters` requires a locally installed Hermes CLI; it verifies the Agent-neutral CLI surface, a real generic MCP tool call, isolated Hermes config/skill installation, and a Hermes MCP handshake without changing the user's Hermes HOME.

Latest repository evidence, 2026-07-11:

- `audit:relay-local` passes, including 56 Node tests, compiled fixture flow, compiled CLI guards, passive and active compiled relay audits, full iOS source typecheck against the installed iPhoneOS SDK, and CryptoKit-to-Node envelope interoperability.
- `npm run pack:check --workspace healthlink-local` passes for `healthlink-local@0.2.0` with 101 package files.
- `audit:relay-package` passes against the local `healthlink-local@0.2.0` tarball, proving a clean temporary global install can run the relay crypto/pull path and export the two-file OpenClaw Skill package without relying on workspace modules. The latest cold-cache run completed its dependency install in about 225 seconds while emitting 15-second heartbeats, then passed fixture upload/pull, SQLite verification, active relay audit, skill export, and cleanup.
- `audit:agent-adapters` passes with Hermes Agent v0.17.0: a generic MCP client discovers 12 tools and calls `healthlink_status`, then Hermes loads an isolated HealthLink config, connects, and discovers the same 12 tools. A separate test against the user's configured Hermes instance also connects in 186 ms and discovers all 12 tools.
- `audit:dependencies` reports zero known production dependency vulnerabilities across all severities for the current lockfile (336 audited dependency nodes on 2026-07-11).
- `audit:secrets` passes its built-in positive/negative rule self-test and scans the non-website release scope for private keys, common provider tokens, literal HealthLink credentials, real environment files, SQLite/Keychain export artifacts, and runtime secret paths without printing matched values. The current scan covers 100 text files, skips 18 binary files, and reports zero findings.
- `audit:relay-container` passes: development and production Relay Compose files validate, the relay image builds successfully, Caddy 2.11.4 reports `Valid configuration`, and all uniquely named temporary containers/networks/volumes are removed. `App/Info.plist` plus non-website `git diff --check` also pass.
- The built runtime image reports Node 22.23.1 and UID 1000, loads the native `better-sqlite3` binding, contains no Python/make/g++ toolchain or empty API/metrics-token ENV defaults, and runs successfully with a read-only root filesystem, `cap_drop: ALL`, and `no-new-privileges`.
- A hardened temporary container passes the full active relay audit. Its logs contain startup metadata only; the final relay database contains zero envelopes, zero active audit identities, and two revoked disposable identities.
- Docker Hub authentication was unreachable from this verification host, so matching Docker Official Node/Caddy images were fetched through AWS ECR Public's `docker/library` mirror and tagged locally. Repository image references remain the standard Docker Official names.
- A paired iPhone 16 Pro Max running iOS 26.5 with Developer Mode enabled is visible. The selected toolchain is currently Xcode 26.6 (`17F113`) and marks the device's iOS 26.5 Platform component as unavailable even though SDK files exist. The user will complete build/install/workflow validation with the matching Xcode Beta required by macOS 27 beta; repository Swift/iPhoneOS typechecks remain green.
- `HEALTHLINK_HOSTED_RELAY_URL`, `HEALTHLINK_RELAY_API_TOKEN`, and `HEALTHLINK_RELAY_METRICS_TOKEN` are not configured in the current environment, so no real hosted deployment can be audited from this workspace yet.
- `preflight:relay-production` passes with disposable non-secret test values and proves the interpolated Compose model exposes only Caddy ports, keeps the relay private/read-only/capability-free, preserves named volumes and limits, pins the image, mounts Caddyfile read-only, and emits only token byte lengths. It fails closed without a valid domain or strong distinct tokens.
- The hosted audit wrapper fails closed without `--yes`, rejects HTTP relay URLs, requires all three hosted environment values, keeps tokens out of child-process arguments, and is ready to run both audits once a real deployment exists.
- `release:npm-preflight` passed from committed release source for publisher `coooder`, the 101-file `healthlink-local@0.2.0` artifact, a zero-finding secret scan, and the required version advance from registry `0.1.3`. `healthlink-local@0.2.0` was then published on 2026-07-11. The public registry reports `0.2.0` with an integrity hash, and an isolated `/tmp` install using a private npm cache/global prefix reports `healthlink-local 0.2.0` and successfully emits a `healthlink-e2ee-v1` encrypted fixture without private key material. No OpenClaw CLI is installed. A temporary ClawHub 0.23.0 `skill publish --dry-run --json` validation succeeded for `healthlink-personal-context@0.2.0` with exactly `SKILL.md` and `README.md`; the temporary CLI/cache was removed. ClawHub marketplace publication remains an explicit optional external action.

That command runs the local evidence suite:

```bash
npm run typecheck --workspace healthlink-local
npm test --workspace healthlink-local
npm run build --workspace healthlink-local
node packages/local/dist/relay-fixture-flow.js
swiftc -parse App/*.swift
swiftc -target arm64-apple-ios17.0 -sdk <installed-iphoneos-sdk> -typecheck App/*.swift
swiftc -module-cache-path <temporary-cache> -typecheck App/Models.swift App/GatewayAPIClient.swift
node scripts/e2ee-relay-ios-interop.mjs
node packages/local/dist/cli.js setup --transport relay --agent generic --state-dir <temporary-state> # expected fail without hosted URL
node packages/local/dist/cli.js relay audit --relay-url http://127.0.0.1:<temporary-port> --metrics-token <temporary-token> --relay-api-token <temporary-api-token> --active --yes
```

Expected coverage:

- Direct `/health/sync` and shared `ingestValidatedHealthSync` still write the same SQLite/MCP data model.
- Relay envelopes use X25519, HKDF-SHA256, ChaCha20-Poly1305, and HMAC-SHA256; they decrypt, validate freshness, reject tampering/replay, and ingest only after schema validation.
- Relay rejects malformed routing identifiers, non-integer sequences, invalid timestamps, and incorrectly encoded or sized X25519, nonce, tag, ciphertext, and signature fields before queueing; legacy HMAC and Ed25519 development envelopes remain covered as decrypt-only fixtures.
- Relay storage accepts opaque envelopes, stores tenant access tokens only as hashes, enforces per-tenant list/ack/purge isolation, TTL cleanup, upload size/rate, bounded rate-limit state and list pages, and per-user queue limits.
- Unlink, credential rotation, and identity reset/revoke purge superseded envelopes, block old identities, replace local keys, and require fresh iOS onboarding.
- `healthlink-local pull` decrypts relay envelopes into the local SQLite database and leaves failed envelopes unacked.
- MCP health tools expose freshness metadata and can read fixture data after relay pull.
- Generic MCP and Hermes expose the same 12-tool surface; Agent adapters only install config/skills and do not fork crypto, ingest, SQLite, or tool logic.
- Portable skill output is Agent-parameterized. Optional OpenClaw export includes setup, onboarding credential handling, pull/Cron guidance, freshness, reporting, lifecycle confirmation, and privacy guardrails.
- `swiftc -parse` and full iPhoneOS SDK typecheck confirm every current App source parses and typechecks for the iOS 17 arm64 target; they do not replace Xcode/device workflow validation.
- Swift typecheck plus the CryptoKit-to-Node fixture prove the current mobile envelope implementation agrees with Node on X25519, HKDF, ChaCha20-Poly1305, HMAC, canonical JSON, the explicit monotonic sequence field, and core schema validation; the same fixture verifies callback query/fragment stripping and scheme allowlisting.
- Relay runtime config, private keys, cursor files, health SQLite, relay SQLite, and existing WAL/SHM sidecars are permission-hardened; config/cursor replacement is atomic, SQLite foreign keys are enabled, and default state/secrets/database directories are private on POSIX filesystems.
- Hosted setup rejects a missing or non-HTTPS relay URL before writing runtime config or installing local integration state. Pull, status, and lifecycle operations reject HTTP overrides before sending tenant credentials; self-hosted mode retains its local HTTP fallback.
- The compiled relay CLI can serve a temporary local relay from `HEALTHLINK_RELAY_*` environment configuration, require per-user tokens plus an optional deployment API key for data endpoints, require a metrics token, and pass `relay audit --metrics-token`.
- The opt-in active audit uses two disposable random tenants and opaque test envelopes to prove deployment API-key enforcement, cross-tenant list/ack/purge/unlink/rotate/revoke isolation, own-tenant lifecycle behavior, old-token rejection, and envelope cleanup without printing generated credentials.

## Local Deployment Evidence

Run a local relay and audit it:

```bash
npm --workspace healthlink-local run dev -- relay serve \
  --host 127.0.0.1 \
  --port 8790 \
  --retention-days 30 \
  --max-envelope-bytes 524288 \
  --max-uploads-per-minute 120 \
  --max-queued-envelopes-per-user 1000 \
  --max-devices-per-user 5 \
  --relay-api-token local-relay-api-token \
  --metrics-token local-metrics-token
```

In another terminal:

```bash
npm --workspace healthlink-local run dev -- relay audit --relay-url http://127.0.0.1:8790 --metrics-token local-metrics-token

npm --workspace healthlink-local run dev -- relay audit \
  --relay-url http://127.0.0.1:8790 \
  --metrics-token local-metrics-token \
  --relay-api-token local-relay-api-token \
  --active \
  --yes
```

Both audits must return `ok: true`. Passive mode verifies `/v1/status`, `/v1/metrics`, `/`, an anonymous data-endpoint rejection probe, tenant protection, configured limits, and absence of known sensitive field names in public relay responses. Active mode additionally verifies real tenant isolation and lifecycle behavior with disposable identities and random opaque envelopes.

For container deployment shape:

```bash
npm run audit:relay-container

# Equivalent individual commands:
docker compose -f deploy/relay/docker-compose.yml config
docker compose -f deploy/relay/docker-compose.yml build healthlink-relay
docker compose --env-file deploy/relay/.env.production.example -f deploy/relay/docker-compose.production.yml config
docker compose --env-file deploy/relay/.env.production.example -f deploy/relay/docker-compose.production.yml run --rm --no-deps caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
```

The container audit uses a unique Compose project, random container name, random disposable tokens, an anonymous data volume, and a random loopback port. Its `finally` and signal handlers stop only that temporary container and remove only that project's network/volumes. The repository `.dockerignore` excludes source-control metadata, dependencies, local databases, `.env` files, state directories, and unrelated app/site sources from the build context. The multi-stage relay image copies the root `tsconfig.base.json`, compiles native dependencies only in its build stage, prunes development dependencies, and leaves Python/compiler tooling plus secret-shaped empty ENV defaults out of the runtime image. The production template requires a domain plus separate API/metrics tokens, exposes only Caddy, keeps the relay on the private network, enables proxy-aware client IPs, runs the relay as non-root, and disables Caddy access logs. `config` validates Compose syntax and declared service shape; the completed image/Caddy/container checks additionally prove the local deployment artifacts run with their declared security settings. None of these local checks proves that DNS, certificates, edge rate limits, backups, or runtime error logs are correct on the production host.

## Hosted Environment Gate

These checks cannot be completed inside the repository and must be performed against the actual beta relay URL:

```bash
export HEALTHLINK_HOSTED_RELAY_URL=https://relay.example.com
export HEALTHLINK_RELAY_DOMAIN=relay.example.com
export HEALTHLINK_RELAY_API_TOKEN=<deployment-api-token>
export HEALTHLINK_RELAY_METRICS_TOKEN=<operator-metrics-token>
npm run preflight:relay-production
npm run audit:relay-hosted -- --yes
```

The production preflight parses the final Compose JSON without starting services and verifies domain, token, image, network exposure, filesystem, capability, privilege, persistence, healthcheck, limit, logging, and Caddy controls without printing secrets. The hosted wrapper then builds the current local CLI, validates that the URL is HTTPS and contains no credentials, query, or fragment, and runs both passive and disposable-tenant active audits. API and metrics tokens stay in the environment and are never passed as process arguments or printed. `--yes` is mandatory because active mode creates, rotates, unlinks, and revokes disposable relay identities.

- Hosted relay is reachable over HTTPS before traffic enters the public internet.
- Edge rate limits are configured outside the Node process.
- `HEALTHLINK_RELAY_API_TOKEN` is set unless the hosting layer provides equivalent upload/list/ack/purge access control.
- `/v1/status` reports `tenantProtected: true`; two disposable identities prove one tenant cannot list, ack, purge, unlink, rotate, or revoke the other.
- Passive `healthlink-local relay audit --relay-url <hosted-url> --metrics-token <operator-token>` returns `ok: true`.
- Active `healthlink-local relay audit --relay-url <hosted-url> --metrics-token <operator-token> --relay-api-token <deployment-token> --active --yes` returns `ok: true` and leaves no disposable test envelopes queued or acknowledged.
- Logs exclude request bodies and do not contain envelope JSON, ciphertext fields, upload secrets, or health plaintext.
- `/v1/metrics` is internal or access-controlled; hosted deployments should set `HEALTHLINK_RELAY_METRICS_TOKEN` unless infrastructure already restricts access.
- Relay SQLite backups are encrypted or disabled and do not retain rows longer than the retention policy.
- Purge deletes queued and acked envelopes for a test `user_id`; unlink blocks future device uploads; rotate/reset reject old credentials.
- Retention cleanup removes old test envelopes in the deployed environment.
- Hosted runbook, privacy boundary, threat model, and data retention policy are published or linked from beta onboarding.

## iOS Device Gate

These checks require a machine with the matching iOS SDK/runtime and a test device or simulator setup:

- Xcode build succeeds for the app target.
- Direct pairing still works through `healthlink://pair?...`.
- Relay onboarding works through QR/text code and `healthlink://onboard?payload=...`.
- Relay upload sends encrypted envelopes to a local or hosted relay.
- `healthlink://sync?source=<agent>&request_id=...` triggers sync for any Agent. An adapter may include an explicitly allowlisted callback scheme; callbacks return only status metadata.
- Callback URLs never contain health data, tokens, envelope bodies, upload secrets, or detailed error payloads.
- Callback output contains only a validated `request_id`, fixed status, and `source=healthlink`; original callback query items and fragments are discarded.

## Optional OpenClaw Publishing Gate

The generated skill requires the relay-capable `healthlink-local@0.2.0` runtime. The npm runtime publication gate completed with:

```bash
npm run pack:check --workspace healthlink-local
npm run release:npm-preflight
npm publish --workspace healthlink-local
npm view healthlink-local version
```

`release:npm-preflight` requires a clean non-website worktree, validates the public package manifest and dry-run artifact, checks `npm whoami`, and requires the local version to be newer than the registry version. It never executes `npm publish`. Set `HEALTHLINK_NPM_RELEASE_ALLOW_DIRTY=1` only when testing the preflight script itself; do not use that override for a real release. For `0.2.0`, the normal preflight passed before publication, npm now serves `0.2.0`, and a clean isolated global install plus version/E2EE fixture smoke test passed. After publication, the same-version preflight is expected to fail closed until the package version is bumped for the next release.

Before each registry publication, run `npm run audit:relay-package`. It proves the exact local tarball installs into an isolated global prefix and that its installed binary completes relay and Skill workflows without importing workspace code. Registry metadata and a fresh install must still be checked independently after publication.

Local skill generation and ClawHub dry-run validation are implemented, but account publication and listing installation are separate:

```bash
npm --workspace healthlink-local run dev -- export-skill --agent openclaw --output-dir /tmp/healthlink-openclaw-skill
```

Before publishing:

- Review generated `SKILL.md` and `README.md`; ClawHub reads publication and runtime metadata from `SKILL.md` frontmatter.
- Confirm `metadata.openclaw.requires.bins` and the Node install specification both identify `healthlink-local`.
- Confirm install instructions use the intended package source and hosted relay URL.
- Confirm `healthlink-local --version` reports `0.2.0` after installation from npm.
- Confirm the skill tells the agent to use MCP tools for health claims.
- Confirm the skill does not ask the user to paste `~/.healthlink/secrets` or raw SQLite contents.
- Confirm the skill never transcribes onboarding QR/deep-link/text credentials into Agent messages, logs, memory, or tool arguments.
- Re-run `clawhub skill publish /tmp/healthlink-openclaw-skill --slug healthlink-personal-context --name "HealthLink Personal Context" --version 0.2.0 --changelog "Initial E2EE relay release" --dry-run` with the release toolchain.
- Publish to ClawHub, then smoke test `openclaw skills install <owner-or-final-slug>` from the published listing.

## Release Decision

The relay implementation is ready for a local alpha when local engineering evidence and the generic MCP/Hermes adapter gate pass.

It is ready for a generic MCP/Hermes hosted private beta after the hosted environment gate and iOS device gate pass for the same build and hosted URL. The optional OpenClaw publishing gate blocks only an OpenClaw marketplace release, not the Agent-neutral relay product.
