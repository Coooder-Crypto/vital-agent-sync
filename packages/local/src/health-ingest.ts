import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { HealthLinkDatabase } from "./database.js";

export type AuthenticatedDevice = {
  device_id: string;
  device_name: string;
  scopes: string[];
};

export type HealthSyncResult = {
  ok: true;
  accepted_sync_id: string;
  health_daily_count: number;
  idempotent: boolean;
};

export class HealthIngestError extends Error {
  constructor(
    readonly code:
      | "missing_authorization"
      | "invalid_authorization"
      | "invalid_token"
      | "device_mismatch"
      | "missing_scope"
      | "invalid_payload",
    message: string
  ) {
    super(message);
  }
}

const workoutSummarySchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  started_at: z.string().min(1),
  duration_minutes: z.number().int().nonnegative(),
  active_energy_kcal: z.number().nullable().optional(),
  avg_heart_rate_bpm: z.number().nullable().optional()
});

const dailyHealthSummarySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  provider: z.string().min(1),
  steps: z.number().int().nonnegative().nullable().optional(),
  sleep_minutes: z.number().int().nonnegative().nullable().optional(),
  resting_heart_rate_bpm: z.number().nullable().optional(),
  avg_heart_rate_bpm: z.number().nullable().optional(),
  max_heart_rate_bpm: z.number().nullable().optional(),
  active_energy_kcal: z.number().nullable().optional(),
  basal_energy_kcal: z.number().nullable().optional(),
  distance_walking_running_m: z.number().nullable().optional(),
  distance_cycling_m: z.number().nullable().optional(),
  flights_climbed: z.number().int().nonnegative().nullable().optional(),
  exercise_minutes: z.number().int().nonnegative().nullable().optional(),
  stand_minutes: z.number().int().nonnegative().nullable().optional(),
  heart_rate_variability_ms: z.number().nullable().optional(),
  walking_heart_rate_average_bpm: z.number().nullable().optional(),
  vo2_max_ml_kg_min: z.number().nullable().optional(),
  oxygen_saturation_percent: z.number().nullable().optional(),
  respiratory_rate_bpm: z.number().nullable().optional(),
  body_temperature_c: z.number().nullable().optional(),
  body_mass_kg: z.number().nullable().optional(),
  body_fat_percentage: z.number().nullable().optional(),
  lean_body_mass_kg: z.number().nullable().optional(),
  body_mass_index: z.number().nullable().optional(),
  workout_minutes: z.number().int().nonnegative().nullable().optional(),
  workouts: z.array(workoutSummarySchema).default([])
});

export const healthSyncPayloadSchema = z.object({
  device_id: z.string().min(1),
  sync_id: z.string().min(1),
  generated_at: z.string().min(1),
  timezone: z.string().min(1),
  health_daily_summaries: z.array(dailyHealthSummarySchema).default([])
});

export type HealthSyncPayload = z.infer<typeof healthSyncPayloadSchema>;

type DeviceRow = {
  id: string;
  name: string;
  scopesJson: string;
};

type ExistingSyncRow = {
  syncId: string;
};

type HealthStatusRow = {
  lastSyncAt: string | null;
  syncCount: number;
  deviceCount: number;
};

export function authenticateDevice(database: HealthLinkDatabase, authorizationHeader: string | undefined): AuthenticatedDevice {
  if (!authorizationHeader) {
    throw new HealthIngestError("missing_authorization", "Authorization header is required.");
  }

  const match = authorizationHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    throw new HealthIngestError("invalid_authorization", "Authorization header must use Bearer token.");
  }

  const token = match[1]?.trim();
  if (!token) {
    throw new HealthIngestError("invalid_authorization", "Bearer token is empty.");
  }

  const tokenHash = hashToken(token);
  const row = database.sqlite.prepare(`
    select
      id,
      name,
      scopes_json as scopesJson
    from devices
    where token_hash = ? and revoked_at is null
  `).get(tokenHash) as DeviceRow | undefined;

  if (!row) {
    throw new HealthIngestError("invalid_token", "Device token is invalid or revoked.");
  }

  return {
    device_id: row.id,
    device_name: row.name,
    scopes: parseScopes(row.scopesJson)
  };
}

export function parseHealthSyncPayload(payload: unknown): HealthSyncPayload {
  const result = healthSyncPayloadSchema.safeParse(payload);
  if (!result.success) {
    throw new HealthIngestError("invalid_payload", result.error.issues[0]?.message ?? "Invalid sync payload.");
  }
  return result.data;
}

export function ingestHealthSync(
  database: HealthLinkDatabase,
  device: AuthenticatedDevice,
  payload: HealthSyncPayload
): HealthSyncResult {
  if (payload.device_id !== device.device_id) {
    throw new HealthIngestError("device_mismatch", "Payload device_id does not match the authenticated device.");
  }

  if (payload.health_daily_summaries.length > 0 && !device.scopes.includes("health.daily_summary.write")) {
    throw new HealthIngestError("missing_scope", "Device is missing health.daily_summary.write scope.");
  }

  const existingSync = database.sqlite.prepare(`
    select sync_id as syncId
    from sync_batches
    where sync_id = ?
  `).get(payload.sync_id) as ExistingSyncRow | undefined;

  if (existingSync) {
    return {
      ok: true,
      accepted_sync_id: payload.sync_id,
      health_daily_count: payload.health_daily_summaries.length,
      idempotent: true
    };
  }

  const now = new Date().toISOString();
  const payloadHash = hashPayload(payload);

  const persist = database.sqlite.transaction(() => {
    database.sqlite.prepare(`
      insert into sync_batches (
        sync_id,
        device_id,
        generated_at,
        timezone,
        received_at,
        payload_hash
      ) values (
        @syncId,
        @deviceId,
        @generatedAt,
        @timezone,
        @receivedAt,
        @payloadHash
      )
    `).run({
      syncId: payload.sync_id,
      deviceId: payload.device_id,
      generatedAt: payload.generated_at,
      timezone: payload.timezone,
      receivedAt: now,
      payloadHash
    });

    for (const summary of payload.health_daily_summaries) {
      upsertHealthDailySummary(database, payload, summary, now);
    }
  });

  persist();

  return {
    ok: true,
    accepted_sync_id: payload.sync_id,
    health_daily_count: payload.health_daily_summaries.length,
    idempotent: false
  };
}

export function getHealthStatus(database: HealthLinkDatabase): {
  ok: true;
  service: "healthlink-local";
  status: "running";
  device_count: number;
  sync_count: number;
  last_sync_at: string | null;
} {
  const row = database.sqlite.prepare(`
    select
      (select max(received_at) from sync_batches) as lastSyncAt,
      (select count(*) from sync_batches) as syncCount,
      (select count(*) from devices where revoked_at is null) as deviceCount
  `).get() as HealthStatusRow;

  return {
    ok: true,
    service: "healthlink-local",
    status: "running",
    device_count: row.deviceCount,
    sync_count: row.syncCount,
    last_sync_at: row.lastSyncAt
  };
}

function upsertHealthDailySummary(
  database: HealthLinkDatabase,
  payload: HealthSyncPayload,
  summary: HealthSyncPayload["health_daily_summaries"][number],
  updatedAt: string
): void {
  const id = stableId("health_daily", payload.device_id, summary.provider, summary.date, payload.timezone);
  database.sqlite.prepare(`
    insert into health_daily_summaries (
      id,
      device_id,
      date,
      timezone,
      provider,
      steps,
      sleep_minutes,
      resting_heart_rate_bpm,
      avg_heart_rate_bpm,
      max_heart_rate_bpm,
      active_energy_kcal,
      basal_energy_kcal,
      distance_walking_running_m,
      distance_cycling_m,
      flights_climbed,
      exercise_minutes,
      stand_minutes,
      heart_rate_variability_ms,
      walking_heart_rate_average_bpm,
      vo2_max_ml_kg_min,
      oxygen_saturation_percent,
      respiratory_rate_bpm,
      body_temperature_c,
      body_mass_kg,
      body_fat_percentage,
      lean_body_mass_kg,
      body_mass_index,
      workout_minutes,
      updated_at
    ) values (
      @id,
      @deviceId,
      @date,
      @timezone,
      @provider,
      @steps,
      @sleepMinutes,
      @restingHeartRateBpm,
      @avgHeartRateBpm,
      @maxHeartRateBpm,
      @activeEnergyKcal,
      @basalEnergyKcal,
      @distanceWalkingRunningM,
      @distanceCyclingM,
      @flightsClimbed,
      @exerciseMinutes,
      @standMinutes,
      @heartRateVariabilityMs,
      @walkingHeartRateAverageBpm,
      @vo2MaxMlKgMin,
      @oxygenSaturationPercent,
      @respiratoryRateBpm,
      @bodyTemperatureC,
      @bodyMassKg,
      @bodyFatPercentage,
      @leanBodyMassKg,
      @bodyMassIndex,
      @workoutMinutes,
      @updatedAt
    )
    on conflict(device_id, provider, date, timezone) do update set
      steps = excluded.steps,
      sleep_minutes = excluded.sleep_minutes,
      resting_heart_rate_bpm = excluded.resting_heart_rate_bpm,
      avg_heart_rate_bpm = excluded.avg_heart_rate_bpm,
      max_heart_rate_bpm = excluded.max_heart_rate_bpm,
      active_energy_kcal = excluded.active_energy_kcal,
      basal_energy_kcal = excluded.basal_energy_kcal,
      distance_walking_running_m = excluded.distance_walking_running_m,
      distance_cycling_m = excluded.distance_cycling_m,
      flights_climbed = excluded.flights_climbed,
      exercise_minutes = excluded.exercise_minutes,
      stand_minutes = excluded.stand_minutes,
      heart_rate_variability_ms = excluded.heart_rate_variability_ms,
      walking_heart_rate_average_bpm = excluded.walking_heart_rate_average_bpm,
      vo2_max_ml_kg_min = excluded.vo2_max_ml_kg_min,
      oxygen_saturation_percent = excluded.oxygen_saturation_percent,
      respiratory_rate_bpm = excluded.respiratory_rate_bpm,
      body_temperature_c = excluded.body_temperature_c,
      body_mass_kg = excluded.body_mass_kg,
      body_fat_percentage = excluded.body_fat_percentage,
      lean_body_mass_kg = excluded.lean_body_mass_kg,
      body_mass_index = excluded.body_mass_index,
      workout_minutes = excluded.workout_minutes,
      updated_at = excluded.updated_at
  `).run({
    id,
    deviceId: payload.device_id,
    date: summary.date,
    timezone: payload.timezone,
    provider: summary.provider,
    steps: summary.steps ?? null,
    sleepMinutes: summary.sleep_minutes ?? null,
    restingHeartRateBpm: summary.resting_heart_rate_bpm ?? null,
    avgHeartRateBpm: summary.avg_heart_rate_bpm ?? null,
    maxHeartRateBpm: summary.max_heart_rate_bpm ?? null,
    activeEnergyKcal: summary.active_energy_kcal ?? null,
    basalEnergyKcal: summary.basal_energy_kcal ?? null,
    distanceWalkingRunningM: summary.distance_walking_running_m ?? null,
    distanceCyclingM: summary.distance_cycling_m ?? null,
    flightsClimbed: summary.flights_climbed ?? null,
    exerciseMinutes: summary.exercise_minutes ?? null,
    standMinutes: summary.stand_minutes ?? null,
    heartRateVariabilityMs: summary.heart_rate_variability_ms ?? null,
    walkingHeartRateAverageBpm: summary.walking_heart_rate_average_bpm ?? null,
    vo2MaxMlKgMin: summary.vo2_max_ml_kg_min ?? null,
    oxygenSaturationPercent: summary.oxygen_saturation_percent ?? null,
    respiratoryRateBpm: summary.respiratory_rate_bpm ?? null,
    bodyTemperatureC: summary.body_temperature_c ?? null,
    bodyMassKg: summary.body_mass_kg ?? null,
    bodyFatPercentage: summary.body_fat_percentage ?? null,
    leanBodyMassKg: summary.lean_body_mass_kg ?? null,
    bodyMassIndex: summary.body_mass_index ?? null,
    workoutMinutes: summary.workout_minutes ?? null,
    updatedAt
  });

  for (const workout of summary.workouts) {
    database.sqlite.prepare(`
      insert into health_workouts (
        id,
        device_id,
        provider,
        workout_id,
        type,
        started_at,
        duration_minutes,
        active_energy_kcal,
        avg_heart_rate_bpm,
        updated_at
      ) values (
        @id,
        @deviceId,
        @provider,
        @workoutId,
        @type,
        @startedAt,
        @durationMinutes,
        @activeEnergyKcal,
        @avgHeartRateBpm,
        @updatedAt
      )
      on conflict(device_id, provider, workout_id) do update set
        type = excluded.type,
        started_at = excluded.started_at,
        duration_minutes = excluded.duration_minutes,
        active_energy_kcal = excluded.active_energy_kcal,
        avg_heart_rate_bpm = excluded.avg_heart_rate_bpm,
        updated_at = excluded.updated_at
    `).run({
      id: stableId("workout", payload.device_id, summary.provider, workout.id),
      deviceId: payload.device_id,
      provider: summary.provider,
      workoutId: workout.id,
      type: workout.type,
      startedAt: workout.started_at,
      durationMinutes: workout.duration_minutes,
      activeEnergyKcal: workout.active_energy_kcal ?? null,
      avgHeartRateBpm: workout.avg_heart_rate_bpm ?? null,
      updatedAt
    });
  }
}

function parseScopes(value: string): string[] {
  const parsed = JSON.parse(value) as unknown;
  return Array.isArray(parsed) ? parsed.filter((scope): scope is string => typeof scope === "string") : [];
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function hashPayload(payload: HealthSyncPayload): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function stableId(...parts: string[]): string {
  return randomUUIDFromHash(parts.join("\u001f"));
}

function randomUUIDFromHash(value: string): string {
  const hash = createHash("sha256").update(value).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}
