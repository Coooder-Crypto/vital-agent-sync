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
