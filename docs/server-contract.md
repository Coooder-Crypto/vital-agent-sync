# Server Contract

This document describes the canonical Vital Agent Sync sync contract used by both direct receiver mode and E2EE relay mode.

## Shared Data Model

`HealthSyncPayload` is the canonical plaintext object inside the trusted iPhone and local receiver. It is validated by `packages/local/src/schemas.ts` and ingested through `ingestValidatedHealthSync`, whether it arrives after direct-envelope decryption or local relay decryption.

Direct mode:

```text
iOS
  -> encrypt device token + HealthSyncPayload into vital-agent-direct-v1
  -> POST /v1/direct
  -> decrypt and authenticate at the local receiver
  -> ingestValidatedHealthSync
  -> SQLite
```

Relay mode:

```text
iOS
  -> encrypt HealthSyncPayload into VitalAgentEncryptedEnvelope
  -> POST /v1/envelopes to relay
  -> vitalmcp pull
  -> decrypt envelope locally
  -> parse HealthSyncPayload
  -> ingestValidatedHealthSync
  -> SQLite
```

The relay never receives plaintext `HealthSyncPayload`; it stores encrypted envelopes plus minimal hashed tenant/revocation metadata.

## Direct Encrypted Endpoint

```http
POST /v1/direct
Content-Type: application/json
```

The outer body is a `vital-agent-direct-v1` X25519/HKDF/ChaCha20-Poly1305 envelope. Its authenticated purpose is one of `pair.status`, `pair.confirm`, `health.sync`, or `device.revoke`. For `health.sync`, the decrypted object contains `{ "device_token": "...", "payload": HealthSyncPayload }`. The token authenticates the paired source device and provides write scopes, but it is never an HTTP authorization header or plaintext body field. A payload with daily summaries requires `health.daily_summary.write`.

The old plaintext `/pair/status/:pairing_code`, `/pair/confirm`, `/health/sync`, and device-revoke routes return HTTP 426. See [direct-lan-security.md](direct-lan-security.md) for the protocol and LAN/Tailscale/relay trust boundaries.

## HealthSyncPayload

```json
{
  "device_id": "dev_123",
  "sync_id": "sync_20260708_001",
  "generated_at": "2026-07-08T08:00:00+08:00",
  "timezone": "Asia/Shanghai",
  "health_daily_summaries": [
    {
      "date": "2026-07-08",
      "provider": "apple_health",
      "steps": 8420,
      "sleep_minutes": 392,
      "resting_heart_rate_bpm": 63.0,
      "avg_heart_rate_bpm": 82.0,
      "max_heart_rate_bpm": 146.0,
      "active_energy_kcal": 480.0,
      "basal_energy_kcal": 1500.0,
      "distance_walking_running_m": 3200.0,
      "distance_cycling_m": null,
      "flights_climbed": 8,
      "exercise_minutes": 35,
      "stand_minutes": 120,
      "heart_rate_variability_ms": 42.0,
      "walking_heart_rate_average_bpm": 98.0,
      "vo2_max_ml_kg_min": 38.5,
      "oxygen_saturation_percent": 97.5,
      "respiratory_rate_bpm": 15.2,
      "body_temperature_c": null,
      "body_mass_kg": 72.4,
      "body_fat_percentage": null,
      "lean_body_mass_kg": null,
      "body_mass_index": null,
      "workout_minutes": 45,
      "workouts": [
        {
          "id": "3B8F6E1C-3DD8-47D1-82CB-891B62FA90CF",
          "type": "traditional_strength_training",
          "started_at": "2026-07-08T19:05:00+08:00",
          "duration_minutes": 45,
          "active_energy_kcal": 260.0,
          "avg_heart_rate_bpm": null
        }
      ]
    }
  ]
}
```

Validation rules:

- `device_id`, `sync_id`, `generated_at`, and `timezone` are required non-empty strings.
- `health_daily_summaries` defaults to an empty array.
- `date` must use `YYYY-MM-DD`.
- Numeric counters that cannot be negative are non-negative integers.
- Optional metrics can be omitted or set to `null`.
- `workouts` defaults to an empty array per daily summary.

## Canonical JSON For Transport Encryption

Direct and relay encryption use the same `HealthSyncPayload` object after schema-compatible construction on iOS. Object keys are serialized in deterministic sorted-key order before encryption or HMAC. Consumers must not rely on raw JSON string order after decryption; they must parse and validate the object.

Envelope metadata, signatures, freshness, device matching, and replay checks are defined in the E2EE relay documents:

- [e2ee-relay-technical-route.md](e2ee-relay-technical-route.md)
- [e2ee-relay-protocol-v1.md](e2ee-relay-protocol-v1.md)
- [e2ee-relay-threat-model.md](e2ee-relay-threat-model.md)

## Ingest Semantics

- `sync_id` is idempotent. Reusing an existing `sync_id` returns success with `idempotent: true` and does not insert another sync batch.
- Daily summaries upsert by `(device_id, provider, date, timezone)`.
- Workouts upsert by `(device_id, provider, workout id)`.
- `payload_hash` is stored for accepted sync batches.
- MCP tools read normalized SQLite rows, not raw payloads.

## Success Response

```json
{
  "ok": true,
  "accepted_sync_id": "sync_20260708_001",
  "health_daily_count": 1,
  "idempotent": false
}
```

## Error Responses

Errors use this shape:

```json
{
  "ok": false,
  "error": {
    "code": "invalid_payload",
    "message": "date is invalid"
  }
}
```

Common direct-sync errors:

| HTTP | Code | Meaning |
| --- | --- | --- |
| 401 | `invalid_token` | The token does not match an active paired source device. |
| 403 | `device_mismatch` | Payload `device_id` does not match the authenticated source device. |
| 403 | `missing_scope` | The device token lacks a required write scope. |
| 400 | `invalid_payload` | The request body does not match `HealthSyncPayload`. |
| 400 | `invalid_envelope` / `decrypt_failed` | The direct envelope is malformed, unpinned, or fails authentication. |
| 400 | `stale_envelope` | The request is outside the direct freshness window. |
| 409 | `replayed_envelope` | The direct request ID was already processed. |
| 426 | `encrypted_direct_transport_required` | A removed plaintext direct route was used. |

Relay pull surfaces equivalent validation failures through `vitalmcp pull` and records failed envelope metadata in relay cursor state without acking the envelope.
