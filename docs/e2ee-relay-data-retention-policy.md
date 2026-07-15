# Vital Agent Sync Relay Data Retention Policy

This policy applies to hosted Vital Agent Sync relay beta deployments. Self-hosted operators can use it as a default template.

Release verification for this policy is tracked in [e2ee-relay-release-audit.md](e2ee-relay-release-audit.md).

## Data Classes

### Encrypted Envelopes

Relay envelope records include:

- `user_id`
- `device_id`
- `envelope_id`
- `sequence`
- `created_at`
- received timestamp
- ack timestamp
- encrypted envelope JSON

The encrypted envelope JSON includes ciphertext and authentication metadata. It must not include health plaintext.

Default retention: 30 days from relay receipt.

### Operational Metadata

Operational metadata includes:

- request timestamp
- route
- HTTP status
- duration
- IP-level rate-limit counters
- aggregate queue metrics
- per-runtime access-token hashes
- device unlink/revocation records

Access-token hashes and device revocation records remain while the anonymous relay identity is active so tenant isolation and unlink enforcement continue to work. Reset revokes the old identity. Other operational metadata should use the minimum needed for beta operations; avoid storing IP-level logs longer than necessary.

### Local Runtime Data

Local runtime data is not hosted relay data:

- `~/.vital-agent-sync/secrets/*`
- `~/.vital-agent-sync/vital-agent.sqlite`
- MCP responses
- generated reports

This data stays on the user's runtime machine unless the user exports or shares it.

## Deletion And Purge

The relay must support purging all queued and acked envelopes for a `user_id` through `POST /v1/purge`.

`relay unlink`, `relay rotate`, and `relay reset` also purge affected queued envelopes. Rotation/reset intentionally delete unpulled envelopes because their old encryption or authentication material is no longer valid.

Purge deletes relay rows. It does not delete:

- the user's local SQLite database
- generated reports
- agent memories or summaries
- device-side HealthKit data

## Retention Jobs

The relay removes rows older than the configured retention window. The app-level implementation performs cleanup during status/list/upload paths and through a periodic in-process retention sweep while the service is running. Hosted infrastructure may add an independent scheduled cleanup job, but it must use the same retention window or a shorter one.

## User-Facing Statement

Use this language in beta docs:

> Vital Agent Sync hosted relay keeps encrypted envelopes for up to 30 days by default so your local runtime can pull them. The relay can see operational metadata such as upload time, envelope size, and queue identifiers, but it is not designed to read your health summaries.

## Review Before Public Beta

- [ ] Confirm actual hosted retention matches this document.
- [ ] Confirm backups do not retain relay rows longer than stated.
- [ ] Confirm logs do not include envelope bodies.
- [ ] Confirm purge behavior is tested.
- [ ] Publish any hosted relay subprocessor or infrastructure notes if required.
