# Vital Agent Sync Hosted Relay Beta Runbook

This runbook describes the hosted relay beta operating boundary. The same API and envelope protocol are used by self-hosted relay.

Use [e2ee-relay-release-audit.md](e2ee-relay-release-audit.md) as the beta release gate. This runbook covers the hosted service operation side of that gate.

## Service Role

The hosted relay is a ciphertext queue. It accepts encrypted Vital Agent Sync envelopes from mobile source apps, lets `vitalmcp pull` fetch queued envelopes, acknowledges processed envelopes, and purges user queues on request.

The hosted relay must not decrypt, parse, log, or inspect health payload plaintext.

## Runtime Configuration

Set the hosted relay base URL for local setup before publishing beta onboarding instructions:

```bash
export HEALTHLINK_HOSTED_RELAY_URL=https://relay.example.com
vitalmcp setup --transport relay --agent hermes
```

Use `--agent generic` for any MCP-compatible runtime without a dedicated installer. OpenClaw and future Agent adapters use the same relay state, pull service, SQLite database, and MCP tools.

`--relay-url` overrides this value for a single command. `HEALTHLINK_RELAY_URL` is a generic configured fallback for hosted or self-hosted testing. Hosted mode fails before setup when no URL is configured or when it is not HTTPS. The `http://127.0.0.1:8790` development fallback is available only in self-hosted relay mode.

## Production VPS Compose

The production template uses Caddy as the only public listener. The relay service is exposed only on the private Compose network, runs as the unprivileged `node` user with a read-only root filesystem, and trusts forwarded client IPs only in this proxy-only shape. Caddy obtains and renews HTTPS certificates automatically when the configured DNS name points to the host and public ports 80/443 reach Caddy. See the [Caddy automatic HTTPS and reverse-proxy documentation](https://caddyserver.com/docs/quick-starts/reverse-proxy).

Prepare DNS and firewall rules first:

- Create an A/AAAA record for the relay hostname.
- Allow inbound TCP 80 and TCP/UDP 443 to the host.
- Do not publish or forward port 8790.
- Put infrastructure/CDN rate limiting in front of Caddy for a public beta; the relay's per-client-IP limiter remains the application fallback.

Create a private environment file from the committed template, set the real domain, and replace both token placeholders with different random values:

```bash
install -m 600 deploy/relay/.env.production.example deploy/relay/.env.production
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

The real `.env.production` file is Git-ignored. Never commit it or paste it into Agent chat. Review the file, load it into the current deployment shell, and run the production preflight before starting:

```bash
set -a
. deploy/relay/.env.production
set +a
npm run preflight:relay-production
```

The preflight parses the fully interpolated Compose model without starting containers. It rejects placeholder, short, reused, or whitespace-containing tokens; invalid domains; unpinned images; unexpected public relay ports; and missing read-only, capability, privilege, volume, healthcheck, limit, or Caddy controls. Its output contains token lengths only, never token values.

Then validate Compose and the Caddyfile:

```bash
docker compose \
  --env-file deploy/relay/.env.production \
  -f deploy/relay/docker-compose.production.yml \
  config

docker compose \
  --env-file deploy/relay/.env.production \
  -f deploy/relay/docker-compose.production.yml \
  run --rm --no-deps caddy \
  caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
```

Start the production stack:

```bash
docker compose \
  --env-file deploy/relay/.env.production \
  -f deploy/relay/docker-compose.production.yml \
  up --build -d
```

The Caddyfile deliberately does not enable Caddy's access-log `log` directive. Caddy still emits runtime/error logs; inspect them during the hosted log-redaction gate. Its persisted `/data` volume contains TLS private keys and must be protected. The relay volume contains ciphertext and tenant metadata and must follow the retention/backup policy.

## Local Or Process-Manager Deployment

For local/self-hosted smoke testing without automatic public HTTPS, use the development Compose file:

```bash
docker compose -f deploy/relay/docker-compose.yml up --build -d
```

For process-manager deployments, run the same command directly:

```bash
vitalmcp relay serve \
  --host 0.0.0.0 \
  --port 8790 \
  --db /data/relay.sqlite \
  --retention-days 30 \
  --max-envelope-bytes 524288 \
  --max-uploads-per-minute 120 \
  --max-queued-envelopes-per-user 1000 \
  --max-devices-per-user 5
```

The same relay serve settings can be provided through environment variables. Command-line flags take precedence over these values:

```bash
export HEALTHLINK_RELAY_HOST=0.0.0.0
export HEALTHLINK_RELAY_PORT=8790
export HEALTHLINK_RELAY_DB=/data/relay.sqlite
export HEALTHLINK_RELAY_RETENTION_DAYS=30
export HEALTHLINK_RELAY_MAX_ENVELOPE_BYTES=524288
export HEALTHLINK_RELAY_MAX_UPLOADS_PER_MINUTE=120
export HEALTHLINK_RELAY_MAX_QUEUED_ENVELOPES_PER_USER=1000
export HEALTHLINK_RELAY_MAX_DEVICES_PER_USER=5
export HEALTHLINK_RELAY_TRUST_PROXY=false
export HEALTHLINK_RELAY_API_TOKEN=<ios-and-local-runtime-random-token>
export HEALTHLINK_RELAY_METRICS_TOKEN=<operator-only-random-token>
vitalmcp relay serve
```

Put this process behind managed HTTPS and infrastructure-level rate limits. The app-level controls above are a second line of defense, not a replacement for edge protection.

Set `HEALTHLINK_RELAY_TRUST_PROXY=true` only when the relay port is private and every request comes through a trusted proxy that rebuilds `X-Forwarded-For`. The production Compose template satisfies that condition. Leave it false when port 8790 is directly reachable.

## Post-Deploy Audit

Run the built-in relay audit after every deploy and before opening the relay to beta users:

```bash
vitalmcp relay audit \
  --relay-url https://relay.example.com
```

The command above is passive. After it passes, run the opt-in active gate with the deployment API key:

```bash
vitalmcp relay audit \
  --relay-url https://relay.example.com \
  --active \
  --yes
```

Active mode creates two random disposable tenant identities, uploads only randomly generated opaque ciphertext-shaped envelopes, tests both directions of tenant isolation, and exercises ack, purge, unlink, credential rotation, and identity revocation. It does not upload health plaintext or print generated credentials. It revokes both disposable identities and verifies that no test envelopes remain; minimal revoked identity/device metadata remains until the relay database is retired.

For the release gate, prefer the repository wrapper so operator tokens do not appear in shell history or process arguments:

```bash
export HEALTHLINK_HOSTED_RELAY_URL=https://relay.example.com
export HEALTHLINK_RELAY_API_TOKEN=<deployment-api-token>
export HEALTHLINK_RELAY_METRICS_TOKEN=<operator-metrics-token>
npm run audit:relay-hosted -- --yes
```

The wrapper runs both passive and active audits and refuses non-HTTPS URLs, missing credentials, or execution without explicit `--yes`.

The audit checks:

- `/v1/status`, `/v1/metrics`, and `/` are reachable.
- status and metrics return aggregate fields.
- token-protected metrics can be inspected when a metrics token is supplied.
- configured retention, size, rate, and queued-envelope limits are present.
- anonymous data-endpoint access is rejected without creating a relay identity.
- public responses do not expose known sensitive field names such as envelope bodies, signatures, upload secrets, private keys, or health payload fields.
- active mode proves one disposable tenant cannot list, acknowledge, purge, unlink, rotate, or revoke another tenant.
- when a deployment API key is supplied, active mode verifies that missing and incorrect keys are rejected.
- active mode verifies own-tenant purge, unlink, credential rotation, old-token rejection, identity revocation, and cleanup.

The audit does not replace infrastructure review. HTTPS, edge rate limits, backup policy, and log redaction still need to be verified in the hosting environment.

## Endpoints

- `GET /v1/status`: health and aggregate queue status.
- `GET /v1/metrics`: aggregate metrics and configured limits; must not include envelope bodies. Set `HEALTHLINK_RELAY_METRICS_TOKEN` or `--metrics-token` in hosted deployments so this endpoint requires `Authorization: Bearer <token>`.
- `POST /v1/envelopes`: upload one encrypted envelope.
- `GET /v1/envelopes?user_id=...&after=...&limit=25`: fetch a bounded page of unacked envelopes after a sequence cursor. The server caps pages at 25 and `vitalmcp pull` drains successive pages automatically.
- `POST /v1/envelopes/:envelope_id/ack`: acknowledge a processed envelope.
- `POST /v1/purge`: delete all envelopes for one user.
- `POST /v1/devices/:device_id/unlink`: revoke one source device and purge its envelopes.
- `POST /v1/credentials/rotate`: replace tenant access credentials and purge superseded envelopes.
- `POST /v1/users/revoke`: revoke an old relay identity during reset and purge its envelopes.

All data and lifecycle endpoints require the per-runtime `relay_access_token` as `Authorization: Bearer <token>`. The relay stores only its SHA-256 hash and binds it to the random `user_id`. This tenant credential is generated automatically and included in onboarding.

Set `HEALTHLINK_RELAY_API_TOKEN` or `--relay-api-token` in hosted deployments to add a closed-beta/edge gate through `X-HealthLink-Relay-API-Key`. This optional shared deployment key is included in onboarding for the iOS source app and local pull runtime, but it is not the tenant isolation boundary.

## Operational Limits

Default beta limits:

- Retention: 30 days.
- Max envelope size: 512 KiB.
- Max uploads per IP per minute: 120.
- Max queued unacked envelopes per user: 1000.
- Max active source devices per user: 5.

The relay also runs an in-process retention sweep while serving, so expired envelopes are removed even when no status/list/upload request arrives.

Change limits only with a matching update to the privacy boundary and retention policy.

## Logging Rules

Allowed:

- Request path, method, status code, duration.
- Aggregate counts from `/v1/status` or `/v1/metrics`.
- Operational errors without request bodies.

Forbidden:

- Health plaintext.
- Envelope JSON request bodies.
- `ciphertext`, `tag`, `nonce`, `signature`, `upload_auth_secret`, `relay_access_token`, `relay_api_token`, access-token hashes, or private keys.
- Full onboarding payloads.

## Incident Response

### Suspected Plaintext Logging

1. Stop log ingestion for the affected service.
2. Preserve access-controlled evidence for investigation.
3. Rotate log sinks or delete affected logs according to legal/privacy review.
4. Confirm relay code paths do not log request bodies.
5. Notify beta users if user data exposure is plausible.

### Queue Growth Or Abuse

1. Check `/v1/metrics`.
2. Confirm edge rate limits are active.
3. Lower `--max-uploads-per-minute` or `--max-queued-envelopes-per-user`.
4. Purge abusive `user_id` queues when needed.
5. Review whether retention cleanup is running by checking oldest queued timestamp.

### Relay Database Disclosure

1. Treat metadata and ciphertext as exposed.
2. Confirm no private keys exist on relay hosts.
3. Reduce retention if necessary.
4. Notify beta users that relay metadata and ciphertext may have been exposed.
5. Advise affected users to run `vitalmcp relay rotate --yes` or `relay reset --yes`, then reconnect iOS with fresh onboarding.

## Deployment Checklist

- [x] Local engineering evidence in [e2ee-relay-release-audit.md](e2ee-relay-release-audit.md) passes for the release build.
- [ ] HTTPS terminates before relay traffic reaches the public internet.
- [ ] App-level limits are set explicitly.
- [ ] Infrastructure-level rate limits are configured.
- [ ] Backups are encrypted or disabled for relay SQLite.
- [ ] Logs exclude request bodies.
- [ ] `/v1/metrics` is access-controlled or exposed only internally.
- [ ] The passive and `--active --yes` relay audits both return `ok: true` against the hosted URL.
- [ ] `/v1/status` reports `tenantProtected: true`, and active cross-tenant list/ack/purge/unlink/rotate/revoke probes cannot affect another test tenant.
- [ ] Purge, unlink, credential rotation, and revoke pass against disposable beta identities.
- [ ] Retention cleanup is verified with old test envelopes.
- [ ] Threat model and privacy boundary are published.
