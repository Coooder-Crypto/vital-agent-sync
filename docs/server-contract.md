# Server Contract

This document describes the MVP server API expected by the iOS app.

## Authentication

All endpoints receive a bearer token:

```http
Authorization: Bearer <token>
Content-Type: application/json
```

Tokens should be scoped. For the MVP, one token can allow:

- `health.daily_summary.write`

## Health Daily Summary

```http
POST /api/health/daily-summary
```

Body:

```json
{
  "date": "2026-06-21",
  "timezone": "Asia/Shanghai",
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
      "started_at": "2026-06-21T19:05:00+08:00",
      "duration_minutes": 45,
      "active_energy_kcal": 260.0,
      "avg_heart_rate_bpm": null
    }
  ]
}
```

Recommended server behavior:

- Treat `(provider, date, timezone)` as an upsert key for daily summaries.
- Store workouts idempotently by provider + workout `id`.
- Keep raw payloads in a restricted raw-events table if needed.
- Expose summaries to agents, not high-frequency raw samples.

## Responses

Success:

```http
204 No Content
```

or:

```json
{"ok": true}
```

Client treats any `2xx` status as success.
