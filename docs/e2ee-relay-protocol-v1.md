# HealthLink E2EE Relay Protocol v1

This document is the implementation contract for `healthlink-e2ee-v1`. It covers the mobile source, relay mailbox, and `healthlink-local` runtime. Hosted and self-hosted relays use the same protocol.

## Trust Boundary

- The mobile source reads health data and encrypts it for one local runtime.
- The relay authenticates transport requests and stores opaque envelopes. It does not receive the decryption private key or HMAC upload secret outside the end-to-end onboarding transfer.
- `healthlink-local` owns the long-lived private key, verifies and decrypts envelopes, validates the plaintext schema, and writes SQLite.
- Agents read health summaries through MCP. The relay API is not a health-query API.

## Encodings

- JSON strings use UTF-8.
- Binary values use unpadded Base64URL as defined by RFC 4648 section 5.
- Timestamps use ISO 8601 with an explicit UTC offset.
- Canonical JSON recursively sorts object keys by their Unicode scalar order. Array order is preserved. No insignificant whitespace is emitted.

## Onboarding

The local runtime creates one payload with:

```json
{
  "protocol": "healthlink-e2ee-v1",
  "mode": "hosted_relay",
  "relay_url": "https://relay.example.com",
  "user_id": "usr_...",
  "source_device_id": "dev_...",
  "agent_name": "OpenClaw Agent",
  "encryption_public_key": "-----BEGIN PUBLIC KEY-----...",
  "encryption_public_key_x25519": "...",
  "signing_public_key": "-----BEGIN PUBLIC KEY-----...",
  "upload_auth_secret": "...",
  "relay_access_token": "...",
  "relay_api_token": "... optional ...",
  "fingerprint": "ABCD 1234 ...",
  "requested_scopes": ["health.daily_summary.write"],
  "created_at": "2026-07-10T12:00:00.000Z"
}
```

Supported handoff forms:

```text
raw JSON
healthlink-e2ee-v1:<base64url(JSON)>
healthlink://onboard?payload=healthlink-e2ee-v1:<base64url(JSON)>
```

The QR contains the deep link. HealthLink iOS accepts all three forms.

The complete onboarding value is sensitive. `upload_auth_secret`, `relay_access_token`, and optional `relay_api_token` are credentials. It may be shown directly to the intended source device, but must not be copied into Agent chat, logs, memory, analytics, issue trackers, or support messages.

Hosted onboarding requires an HTTPS relay URL. Self-hosted onboarding may use HTTP on a user-controlled network or HTTPS. Relay URLs must not embed usernames, passwords, query strings, or fragments.

## Key Agreement And Encryption

New v1 envelopes use this algorithm identifier:

```text
x25519-hkdf-sha256-chacha20poly1305-hmac-sha256
```

Encryption steps:

1. The source creates a fresh ephemeral X25519 key pair for each envelope.
2. It performs X25519 agreement with the runtime's long-lived public encryption key.
3. It derives 32 bytes with HKDF-SHA256:

```text
IKM  = X25519 shared secret
salt = empty byte string
info = UTF-8("healthlink-e2ee-v1 envelope")
L    = 32
```

4. It canonicalizes the complete `HealthSyncPayload` and encrypts it with ChaCha20-Poly1305 using a fresh random 12-byte nonce.
5. It stores the 16-byte Poly1305 tag separately from ciphertext.
6. It constructs the envelope with an empty `crypto.signature`, canonicalizes that envelope, and computes HMAC-SHA256 with the 32-byte `upload_auth_secret`.
7. It writes the unpadded Base64URL HMAC into `crypto.signature`.

Mobile sources persist a monotonic envelope sequence. Each new value is at least the current Unix time in milliseconds and strictly greater than the last locally issued value, so concurrent syncs and backward wall-clock adjustments cannot create a non-increasing sequence.

The runtime verifies metadata and HMAC before AEAD decryption. It schema-validates plaintext before SQLite ingestion.

The legacy development identifiers `x25519-chacha20poly1305-hmac-sha256` and `x25519-chacha20poly1305-ed25519` remain decrypt-only compatibility paths. New clients must emit the HKDF identifier.

## Envelope

```json
{
  "protocol": "healthlink-e2ee-v1",
  "user_id": "usr_...",
  "device_id": "dev_...",
  "envelope_id": "env_...",
  "sequence": 42,
  "payload_type": "health.sync",
  "created_at": "2026-07-10T12:05:00.000Z",
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

Validation fails closed when:

- protocol, algorithm, user ID, or device ID does not match;
- the envelope ID was already processed;
- sequence is not greater than the local cursor;
- `created_at` is older than seven days or more than ten minutes in the future;
- HMAC, AEAD tag, key material, JSON, scope, or health schema validation fails.

Failed envelopes are not acknowledged. Successful `sync_id` values remain idempotent at ingestion.

## Relay HTTP Authentication

Data endpoints always require tenant authorization:

```http
Authorization: Bearer <relay_access_token>
```

`relay_access_token` is a random 32-byte value generated per runtime. The relay stores only its SHA-256 hash. On the first authenticated request, the relay binds the unguessable `user_id` to that hash. Later requests must match both the tenant identity and token. Ack authorization is scoped to the tenant that owns the envelope.

A deployment can additionally require a gateway key:

```http
X-HealthLink-Relay-API-Key: <relay_api_token>
```

This optional shared key is an edge/closed-beta control, not a tenant boundary. Metrics use a separate operator-only Bearer token. Status and metrics never return credential values or hashes.

## Relay API

```http
POST /v1/envelopes
GET  /v1/envelopes?user_id=...&after=...
POST /v1/envelopes/:envelope_id/ack
POST /v1/purge
POST /v1/devices/:device_id/unlink
POST /v1/credentials/rotate
POST /v1/users/revoke
GET  /v1/status
GET  /v1/metrics
```

- Upload, list, ack, purge, unlink, rotate, and revoke require tenant authorization and the optional deployment gateway key when configured.
- Metrics require the independently configured metrics token when enabled.
- The relay enforces body size, per-IP upload rate, bounded in-memory rate-limit state, per-user queue quota, per-user active-device quota, bounded list pages, and TTL limits before or during storage. A periodic sweep enforces retention without relying on request traffic; local pull drains pages in sequence order and atomically advances its cursor.
- Duplicate `envelope_id` values do not overwrite stored envelope ownership or content.

## Lifecycle

- Unlink marks one `(user_id, device_id)` revoked and purges that device's envelopes. Future uploads from it return `403`.
- Rotate purges all queued envelopes for the user, clears device revocations, replaces the tenant access-token hash, and requires new iOS onboarding. The runtime also replaces encryption keys and `upload_auth_secret` and resets its cursor.
- Reset revokes and purges the old relay user, creates new user/device IDs and all new credentials, and resets the cursor. The old identity cannot upload again.

Queued envelopes are intentionally purged during rotate/reset because they are encrypted or authenticated with superseded material.

## Storage And Logging

Relay storage may contain queue identifiers, timestamps, ciphertext envelope JSON, tenant access-token hashes, and device revocation metadata. It must not contain health plaintext, local private keys, raw tenant access tokens, upload authentication secrets, or onboarding payloads.

Request bodies, authorization headers, onboarding values, ciphertext fields, and credential hashes must not be logged. Operational logs should be limited to route, method, status, duration, and aggregate counters.
