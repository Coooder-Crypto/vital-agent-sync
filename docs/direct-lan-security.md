# Secure direct LAN transport

VitalMCP direct mode uses the `vitalmcp-direct-v1` application-layer envelope for pairing, sync, and device revocation. An `http://` LAN or Tailscale URL identifies how to reach the receiver; it does not mean that credentials or health summaries are sent as plaintext HTTP bodies.

## Trust boundaries

| Mode | Network path | Trusted decrypting endpoint | Payload protection |
| --- | --- | --- | --- |
| Trusted LAN | User-controlled local network | The local VitalMCP receiver | Receiver-pinned application-layer encryption |
| Tailscale | WireGuard tailnet | The local VitalMCP receiver | Tailscale tunnel plus the same receiver-pinned application-layer encryption |
| Hosted or self-hosted relay | Relay service | The user's local relay-pull runtime | Existing E2EE relay envelope; the relay stores opaque ciphertext |

Direct LAN mode is not described as network-layer E2EE. The receiver terminates the direct encrypted envelope, validates the paired device, writes the existing local SQLite schema, and serves the existing MCP data path. The relay protocol and relay trust boundary are unchanged.

## Protocol flow

1. The receiver creates a persistent X25519 key beside its SQLite database with owner-only file permissions.
2. A locally rendered pairing QR includes the receiver's raw X25519 public key and a short-lived pairing code. Neither value is fetched in a plaintext LAN status URL.
3. iOS pins that QR key and sends `pair.status` and `pair.confirm` as ChaCha20-Poly1305 ciphertext using an ephemeral X25519 key and HKDF-SHA256 direction-specific keys.
4. The receiver returns the new device token inside the encrypted response envelope. iOS keeps the token in Keychain and the non-secret receiver public key in app preferences.
5. Direct `health.sync` and `device.revoke` requests put the device token and request payload inside the encrypted envelope. The reusable token is never an HTTP authorization header.
6. The receiver rejects duplicate request IDs, stale requests, tampered metadata/ciphertext, and the former plaintext pairing and sync routes. Valid sync plaintext enters `ingestValidatedHealthSync`, so SQLite and MCP behavior remain unchanged.

Authenticated envelope metadata includes the protocol, purpose, request ID, timestamp, algorithm, and sender public key. The wire-visible fields are routing/freshness metadata, ephemeral public-key material, nonce, authentication tag, and ciphertext. Pairing codes, device tokens, and HealthKit values are ciphertext.

## Rotation and recovery

The receiver key persists across normal restarts. If the key file is deliberately removed or replaced, existing iPhones can no longer authenticate encrypted responses or sync to that receiver. Revoke affected device records when possible, create a new pairing QR, and re-pair each iPhone so it pins the new receiver key. A previously captured request cannot be reused after re-pairing: pairing codes are single-use, device tokens are rotated, authenticated encryption binds the request metadata, and processed request IDs are stored in SQLite for the replay window.

## Logging and diagnostics

Normal receiver logs contain the request route and generic error codes only. They must not include decrypted envelopes, device tokens, pairing URLs/codes, private keys, authorization headers, or health values. The terminal may render a QR for the user, but it does not print the underlying pairing URL or code. Treat the database, its adjacent direct-transport private key, and the iPhone Keychain as sensitive local state.

## Verification limits

Automated interoperability tests use fixed X25519 keys and nonces to exercise the same canonical JSON, HKDF, ChaCha20-Poly1305, freshness, replay, tamper, key persistence, and key-rotation behavior used by the receiver and iOS code. External release validation still requires a physical iPhone: scan a newly generated QR, perform one HealthKit sync, inspect the local SQLite/MCP result, and confirm with a packet capture that the pairing code, device token, and known health values do not occur on the wire.
