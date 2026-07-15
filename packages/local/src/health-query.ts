import type { VitalAgentDatabase } from "./database.js";
import { getHealthStatus } from "./health-ingest.js";
import { getRelayLocalStatus, type RelayLocalStatus } from "./relay-status.js";

export type QueryOptions = {
  date?: string;
  days?: number;
};

type HealthDailyRow = {
  id: string;
  device_id: string;
  date: string;
  timezone: string;
  provider: string;
  steps: number | null;
  sleep_minutes: number | null;
  resting_heart_rate_bpm: number | null;
  avg_heart_rate_bpm: number | null;
  max_heart_rate_bpm: number | null;
  active_energy_kcal: number | null;
  basal_energy_kcal: number | null;
  distance_walking_running_m: number | null;
  distance_cycling_m: number | null;
  flights_climbed: number | null;
  exercise_minutes: number | null;
  stand_minutes: number | null;
  heart_rate_variability_ms: number | null;
  walking_heart_rate_average_bpm: number | null;
  vo2_max_ml_kg_min: number | null;
  oxygen_saturation_percent: number | null;
  respiratory_rate_bpm: number | null;
  body_temperature_c: number | null;
  body_mass_kg: number | null;
  body_fat_percentage: number | null;
  lean_body_mass_kg: number | null;
  body_mass_index: number | null;
  workout_minutes: number | null;
  updated_at: string;
};

type WorkoutRow = {
  workout_id: string;
  type: string;
  started_at: string;
  duration_minutes: number;
  active_energy_kcal: number | null;
  avg_heart_rate_bpm: number | null;
};

type SourceCoverageRow = {
  device_id: string;
  device_name: string;
  device_platform: string;
  last_sync_at: string | null;
  sync_count: number;
};

export function getAgentHealthStatus(database: VitalAgentDatabase): unknown {
  return {
    ...getHealthStatus(database),
    relay: getRelayLocalStatus()
  };
}

export function getPersonalContext(database: VitalAgentDatabase, options: QueryOptions = {}): unknown {
  const days = clampDays(options.days);

  return {
    purpose: "Use this Vital Agent Sync context to answer personal status, energy, recovery, workout readiness, sleep, activity, and day-planning questions. Do not invent health facts that are not present here.",
    metadata: buildQueryMetadata(database),
    status: getAgentHealthStatus(database),
    focus_date: options.date ?? "latest_synced_date",
    daily_health_summary: getDailyHealthSummary(database, { date: options.date }),
    sleep_trend: getSleepTrend(database, { days }),
    workout_load: getWorkoutLoad(database, { days }),
    recovery_signals: getRecoverySignals(database, { days })
  };
}

export function getDailyHealthSummary(database: VitalAgentDatabase, options: QueryOptions = {}): unknown {
  const health = findHealthDaily(database, options.date);
  if (!health) {
    return {
      metadata: buildQueryMetadata(database),
      date: options.date ?? null,
      health: null,
      workouts: []
    };
  }

  const workouts = database.sqlite.prepare(`
    select
      workout_id,
      type,
      started_at,
      duration_minutes,
      active_energy_kcal,
      avg_heart_rate_bpm
    from health_workouts
    where device_id = ?
      and provider = ?
      and substr(started_at, 1, 10) = ?
    order by started_at asc
  `).all(health.device_id, health.provider, health.date) as WorkoutRow[];

  return {
    metadata: buildQueryMetadata(database),
    date: health.date,
    timezone: health.timezone,
    provider: health.provider,
    updated_at: health.updated_at,
    health: {
      steps: health.steps,
      sleep_minutes: health.sleep_minutes,
      resting_heart_rate_bpm: health.resting_heart_rate_bpm,
      avg_heart_rate_bpm: health.avg_heart_rate_bpm,
      max_heart_rate_bpm: health.max_heart_rate_bpm,
      active_energy_kcal: health.active_energy_kcal,
      basal_energy_kcal: health.basal_energy_kcal,
      distance_walking_running_m: health.distance_walking_running_m,
      distance_cycling_m: health.distance_cycling_m,
      flights_climbed: health.flights_climbed,
      exercise_minutes: health.exercise_minutes,
      stand_minutes: health.stand_minutes,
      heart_rate_variability_ms: health.heart_rate_variability_ms,
      walking_heart_rate_average_bpm: health.walking_heart_rate_average_bpm,
      vo2_max_ml_kg_min: health.vo2_max_ml_kg_min,
      oxygen_saturation_percent: health.oxygen_saturation_percent,
      respiratory_rate_bpm: health.respiratory_rate_bpm,
      body_temperature_c: health.body_temperature_c,
      body_mass_kg: health.body_mass_kg,
      body_fat_percentage: health.body_fat_percentage,
      lean_body_mass_kg: health.lean_body_mass_kg,
      body_mass_index: health.body_mass_index,
      workout_minutes: health.workout_minutes
    },
    workouts
  };
}

export function getSleepTrend(database: VitalAgentDatabase, options: QueryOptions = {}): unknown {
  const days = clampDays(options.days);
  const rows = database.sqlite.prepare(`
    select
      date,
      sleep_minutes,
      resting_heart_rate_bpm,
      active_energy_kcal,
      basal_energy_kcal,
      heart_rate_variability_ms,
      oxygen_saturation_percent,
      respiratory_rate_bpm,
      workout_minutes
    from (
      select
        *,
        row_number() over (
          partition by date
          order by updated_at desc, id desc
        ) as row_number
      from health_daily_summaries
    )
    where row_number = 1
    order by date desc
    limit ?
  `).all(days) as Pick<
    HealthDailyRow,
    | "date"
    | "sleep_minutes"
    | "resting_heart_rate_bpm"
    | "active_energy_kcal"
    | "basal_energy_kcal"
    | "heart_rate_variability_ms"
    | "oxygen_saturation_percent"
    | "respiratory_rate_bpm"
    | "workout_minutes"
  >[];

  return {
    metadata: buildQueryMetadata(database),
    days,
    trend: rows.reverse()
  };
}

export function getWorkoutLoad(database: VitalAgentDatabase, options: QueryOptions = {}): unknown {
  const days = clampDays(options.days);
  const daily = database.sqlite.prepare(`
    select
      date,
      workout_minutes,
      exercise_minutes,
      stand_minutes,
      distance_walking_running_m,
      distance_cycling_m,
      flights_climbed,
      active_energy_kcal,
      avg_heart_rate_bpm,
      max_heart_rate_bpm,
      vo2_max_ml_kg_min
    from (
      select
        *,
        row_number() over (
          partition by date
          order by updated_at desc, id desc
        ) as row_number
      from health_daily_summaries
    )
    where row_number = 1
    order by date desc
    limit ?
  `).all(days) as Pick<
    HealthDailyRow,
    | "date"
    | "workout_minutes"
    | "exercise_minutes"
    | "stand_minutes"
    | "distance_walking_running_m"
    | "distance_cycling_m"
    | "flights_climbed"
    | "active_energy_kcal"
    | "avg_heart_rate_bpm"
    | "max_heart_rate_bpm"
    | "vo2_max_ml_kg_min"
  >[];

  const workouts = database.sqlite.prepare(`
    select
      workout_id,
      type,
      started_at,
      duration_minutes,
      active_energy_kcal,
      avg_heart_rate_bpm
    from health_workouts
    order by started_at desc
    limit 50
  `).all() as WorkoutRow[];

  return {
    metadata: buildQueryMetadata(database),
    days,
    daily: daily.reverse(),
    workouts: workouts.reverse()
  };
}

export function getRecoverySignals(database: VitalAgentDatabase, options: QueryOptions = {}): unknown {
  const days = clampDays(options.days);
  const rows = database.sqlite.prepare(`
    select
      date,
      sleep_minutes,
      resting_heart_rate_bpm,
      avg_heart_rate_bpm,
      max_heart_rate_bpm,
      heart_rate_variability_ms,
      walking_heart_rate_average_bpm,
      vo2_max_ml_kg_min,
      oxygen_saturation_percent,
      respiratory_rate_bpm,
      body_temperature_c,
      active_energy_kcal,
      basal_energy_kcal,
      workout_minutes
    from (
      select
        *,
        row_number() over (
          partition by date
          order by updated_at desc, id desc
        ) as row_number
      from health_daily_summaries
    )
    where row_number = 1
    order by date desc
    limit ?
  `).all(days) as Pick<
    HealthDailyRow,
    | "date"
    | "sleep_minutes"
    | "resting_heart_rate_bpm"
    | "avg_heart_rate_bpm"
    | "max_heart_rate_bpm"
    | "heart_rate_variability_ms"
    | "walking_heart_rate_average_bpm"
    | "vo2_max_ml_kg_min"
    | "oxygen_saturation_percent"
    | "respiratory_rate_bpm"
    | "body_temperature_c"
    | "active_energy_kcal"
    | "basal_energy_kcal"
    | "workout_minutes"
  >[];

  return {
    metadata: buildQueryMetadata(database),
    days,
    signals: rows.reverse()
  };
}

export function getWeeklySummary(database: VitalAgentDatabase, options: QueryOptions = {}): unknown {
  const days = Math.max(1, Math.min(options.days ?? 7, 14));
  const healthRows = latestHealthRows(database, days);

  const sleepValues = healthRows
    .map((row) => row.sleep_minutes)
    .filter((value): value is number => typeof value === "number");
  const stepsValues = healthRows
    .map((row) => row.steps)
    .filter((value): value is number => typeof value === "number");
  const activeEnergyValues = healthRows
    .map((row) => row.active_energy_kcal)
    .filter((value): value is number => typeof value === "number");
  const exerciseMinutesValues = healthRows
    .map((row) => row.exercise_minutes)
    .filter((value): value is number => typeof value === "number");
  const standMinutesValues = healthRows
    .map((row) => row.stand_minutes)
    .filter((value): value is number => typeof value === "number");
  const walkingRunningDistanceValues = healthRows
    .map((row) => row.distance_walking_running_m)
    .filter((value): value is number => typeof value === "number");
  const workoutMinutesValues = healthRows
    .map((row) => row.workout_minutes)
    .filter((value): value is number => typeof value === "number");

  return {
    metadata: buildQueryMetadata(database),
    days,
    date_range: {
      start: minString(healthRows.map((row) => row.date)),
      end: maxString(healthRows.map((row) => row.date))
    },
    coverage: {
      health_days: healthRows.length
    },
    sleep: {
      average_minutes: average(sleepValues),
      total_minutes: sum(sleepValues)
    },
    activity: {
      average_steps: average(stepsValues),
      total_steps: sum(stepsValues),
      total_active_energy_kcal: sum(activeEnergyValues),
      total_exercise_minutes: sum(exerciseMinutesValues),
      total_stand_minutes: sum(standMinutesValues),
      total_walking_running_distance_m: sum(walkingRunningDistanceValues)
    },
    workouts: {
      total_minutes: sum(workoutMinutesValues),
      days_with_workouts: workoutMinutesValues.filter((value) => value > 0).length
    },
    daily: healthRows.map((row) => ({
      date: row.date,
      steps: row.steps,
      sleep_minutes: row.sleep_minutes,
      active_energy_kcal: row.active_energy_kcal,
      workout_minutes: row.workout_minutes
    }))
  };
}

export function buildQueryMetadata(database: VitalAgentDatabase): {
  freshness: {
    latest_sync_at: string | null;
    latest_health_updated_at: string | null;
    latest_source_generated_at: string | null;
    latest_successful_relay_pull_at: string | null;
  };
  relay: RelayLocalStatus;
  source_coverage: SourceCoverageRow[];
  missing_metrics: string[];
} {
  const status = getHealthStatus(database);
  const relay = getRelayLocalStatus();
  const latestHealthUpdatedAt = database.sqlite.prepare(`
    select max(updated_at) as value
    from health_daily_summaries
  `).get() as { value: string | null };
  const latestSourceGeneratedAt = database.sqlite.prepare(`
    select max(generated_at) as value
    from sync_batches
  `).get() as { value: string | null };
  const sourceCoverage = database.sqlite.prepare(`
    select
      devices.id as device_id,
      devices.name as device_name,
      devices.platform as device_platform,
      max(sync_batches.received_at) as last_sync_at,
      count(sync_batches.sync_id) as sync_count
    from devices
    left join sync_batches on sync_batches.device_id = devices.id
    where devices.revoked_at is null
    group by devices.id
    order by devices.created_at desc
  `).all() as SourceCoverageRow[];

  return {
    freshness: {
      latest_sync_at: status.last_sync_at,
      latest_health_updated_at: latestHealthUpdatedAt.value,
      latest_source_generated_at: latestSourceGeneratedAt.value,
      latest_successful_relay_pull_at: relay.last_successful_pull_at
    },
    relay,
    source_coverage: sourceCoverage,
    missing_metrics: missingMetrics({
      healthCount: countRows(database, "health_daily_summaries"),
      workoutCount: countRows(database, "health_workouts")
    })
  };
}

function findHealthDaily(database: VitalAgentDatabase, date?: string): HealthDailyRow | undefined {
  if (date) {
    return database.sqlite.prepare(`
      select *
      from health_daily_summaries
      where date = ?
      order by updated_at desc
      limit 1
    `).get(date) as HealthDailyRow | undefined;
  }

  return database.sqlite.prepare(`
    select *
    from health_daily_summaries
    order by date desc, updated_at desc
    limit 1
  `).get() as HealthDailyRow | undefined;
}

function latestHealthRows(database: VitalAgentDatabase, days: number): HealthDailyRow[] {
  const rows = database.sqlite.prepare(`
    select *
    from (
      select
        *,
        row_number() over (
          partition by date
          order by updated_at desc, id desc
        ) as row_number
      from health_daily_summaries
    )
    where row_number = 1
    order by date desc
    limit ?
  `).all(days) as HealthDailyRow[];

  return rows.reverse();
}

function countRows(database: VitalAgentDatabase, table: string): number {
  const row = database.sqlite.prepare(`select count(*) as value from ${table}`).get() as { value: number };
  return row.value;
}

function missingMetrics(input: {
  healthCount: number;
  workoutCount: number;
}): string[] {
  const missing: string[] = [];
  if (input.healthCount === 0) {
    missing.push("health.daily_summary");
  }
  if (input.workoutCount === 0) {
    missing.push("health.workouts");
  }
  return missing;
}

function sum(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  return values.reduce((total, value) => total + value, 0);
}

function average(values: number[]): number | null {
  const total = sum(values);
  return total === null ? null : Math.round((total / values.length) * 10) / 10;
}

function minString(values: string[]): string | null {
  return values.length === 0 ? null : values.reduce((min, value) => value < min ? value : min);
}

function maxString(values: string[]): string | null {
  return values.length === 0 ? null : values.reduce((max, value) => value > max ? value : max);
}

function clampDays(days?: number): number {
  if (typeof days !== "number" || !Number.isInteger(days)) {
    return 7;
  }
  return Math.max(1, Math.min(days, 90));
}
