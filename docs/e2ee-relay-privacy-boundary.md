# Vital Agent Sync Relay Privacy Boundary

This document is user-facing language for the relay route. It should guide product copy, onboarding screens, README text, and support answers.

## Short Version

Vital Agent Sync relay mode is designed so the relay forwards encrypted envelopes. The relay should not be able to read Apple Health summaries. Your local `vitalmcp` runtime owns the private keys, decrypts data, stores it in your SQLite database, and exposes it to your chosen Agent through MCP.

## What Each Mode Means

### Hosted Relay

Use this when you want the easiest setup and do not want to expose a local port.

Data path:

```text
iPhone -> Vital Agent Sync hosted relay -> vitalmcp pull -> SQLite -> MCP -> Agent
```

The hosted relay can see:

- Relay user ID.
- Source device ID.
- Envelope ID and sequence.
- Upload time, envelope size, and IP-level operational metadata.
- Encrypted envelope JSON.
- A SHA-256 hash of the per-runtime relay access token.
- Device unlink/revocation metadata.

The hosted relay should not see:

- Apple Health plaintext.
- Local private keys.
- SQLite database contents.
- MCP tool responses.

### Self-Hosted Relay

Use this when you want the relay under your own infrastructure but still want the outbound-HTTPS mobile sync shape.

Data path:

```text
iPhone -> your relay -> vitalmcp pull -> SQLite -> MCP -> Agent
```

Your relay stores the same encrypted envelope format as the hosted relay. Anyone operating the relay can see metadata and ciphertext, but not health plaintext unless they also have your local private keys.

### Direct Gateway

Use this when your iPhone can reach your local receiver through LAN, Tailscale, or your own HTTPS endpoint.

Data path:

```text
iPhone -> vitalmcp receiver -> SQLite -> MCP -> Agent
```

There is no relay queue. The receiver sees plaintext because it is the trusted local runtime that stores data.

## Local State Is Sensitive

Treat these files as sensitive:

- `~/.vital-agent-sync/secrets/*`
- `~/.vital-agent-sync/vital-agent.sqlite`
- `~/.vital-agent-sync/config.json`
- relay onboarding QR codes, links, and text values, which include `upload_auth_secret`, `relay_access_token`, and sometimes `relay_api_token`
- generated health reports
- exported summaries

Do not paste private keys or complete onboarding values into OpenClaw, Hermes, chat windows, Agent memory, logs, issue trackers, or support messages.

## What Agents Can Read

Agents should read Vital Agent Sync data through MCP tools, not by opening SQLite directly. MCP tools return scoped summaries such as daily health, sleep trend, workout load, recovery signals, source device status, and freshness metadata.

Agents should mention freshness when answering health-context questions. If data is stale, the expected next step is:

- relay mode: run `vitalmcp pull`, then ask the user to sync from iOS if no new envelopes are available.
- direct mode: ask the user to sync from iOS or check the local receiver.

## What Not To Promise

Do not promise:

- exact iOS background sync timing
- medical diagnosis
- that relay metadata is invisible
- that deleting local SQLite deletes already exported reports
- that self-hosting removes all risk

Do promise:

- relay payloads are designed to be end-to-end encrypted
- local private keys stay local
- users can choose hosted relay, self-hosted relay, or direct gateway
- users can purge relay envelopes
- users can revoke source devices and stop future sync
- users can rotate credentials or reset the relay identity when onboarding material may have leaked

## User Copy Building Blocks

Use:

> Vital Agent Sync relay forwards encrypted health envelopes. Your local Vital Agent Sync runtime decrypts them and stores summaries on your machine for MCP-compatible agents.

Use:

> The relay can see operational metadata such as upload time and envelope size, but it is not designed to read your health summaries.

Use:

> Keep your `~/.vital-agent-sync/secrets` folder private. Vital Agent Sync and your Agent should never ask you to paste those private keys.

Avoid:

> Your data is completely anonymous.

Avoid:

> Background sync always happens every N minutes.

Avoid:

> The relay has zero information about your usage.
