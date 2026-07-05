import type { HealthLinkDatabase } from "./database.js";
import { getHealthStatus } from "./health-ingest.js";

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

type CalendarDailyRow = {
  id: string;
  device_id: string;
  date: string;
  timezone: string;
  provider: string;
  busy_minutes: number;
  next_event_starts_at: string | null;
  next_event_duration_minutes: number | null;
  title_redacted: number;
  updated_at: string;
};

type FreeWindowRow = {
  start: string;
  end: string;
};

type SourceCoverageRow = {
  device_id: string;
  device_name: string;
  device_platform: string;
  last_sync_at: string | null;
  sync_count: number;
};

export function getAgentHealthStatus(database: HealthLinkDatabase): unknown {
  return getHealthStatus(database);
}

export function getPersonalContext(database: HealthLinkDatabase, options: QueryOptions = {}): unknown {
  const days = clampDays(options.days);

  return {
    purpose: "Use this HealthLink context to answer personal status, energy, recovery, workout readiness, sleep, schedule pressure, and day-planning questions. Do not invent health or calendar facts that are not present here.",
    metadata: buildQueryMetadata(database),
    status: getAgentHealthStatus(database),
    focus_date: options.date ?? "latest_synced_date",
    daily_health_summary: getDailyHealthSummary(database, { date: options.date }),
    calendar_availability: getCalendarAvailability(database, { date: options.date }),
    sleep_trend: getSleepTrend(database, { days }),
    workout_load: getWorkoutLoad(database, { days }),
    recovery_signals: getRecoverySignals(database, { days })
  };
}

export function getDailyHealthSummary(database: HealthLinkDatabase, options: QueryOptions = {}): unknown {
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
      workout_minutes: health.workout_minutes
    },
    workouts
  };
}

export function getCalendarAvailability(database: HealthLinkDatabase, options: QueryOptions = {}): unknown {
  const calendar = findCalendarDaily(database, options.date);
  if (!calendar) {
    return {
      metadata: buildQueryMetadata(database),
      date: options.date ?? null,
      calendar: null,
      free_windows: []
    };
  }

  const freeWindows = database.sqlite.prepare(`
    select start, end
    from calendar_free_windows
    where summary_id = ?
    order by start asc
  `).all(calendar.id) as FreeWindowRow[];

  return {
    metadata: buildQueryMetadata(database),
    date: calendar.date,
    timezone: calendar.timezone,
    provider: calendar.provider,
    updated_at: calendar.updated_at,
    calendar: {
      busy_minutes: calendar.busy_minutes,
      next_event: calendar.next_event_starts_at
        ? {
            starts_at: calendar.next_event_starts_at,
            duration_minutes: calendar.next_event_duration_minutes,
            title_redacted: calendar.title_redacted !== 0
          }
        : null
    },
    free_windows: freeWindows
  };
}

export function getSleepTrend(database: HealthLinkDatabase, options: QueryOptions = {}): unknown {
  const days = clampDays(options.days);
  const rows = database.sqlite.prepare(`
    select
      date,
      sleep_minutes,
      resting_heart_rate_bpm,
      active_energy_kcal,
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
    "date" | "sleep_minutes" | "resting_heart_rate_bpm" | "active_energy_kcal" | "workout_minutes"
  >[];

  return {
    metadata: buildQueryMetadata(database),
    days,
    trend: rows.reverse()
  };
}

export function getWorkoutLoad(database: HealthLinkDatabase, options: QueryOptions = {}): unknown {
  const days = clampDays(options.days);
  const daily = database.sqlite.prepare(`
    select
      date,
      workout_minutes,
      active_energy_kcal,
      avg_heart_rate_bpm,
      max_heart_rate_bpm
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
    "date" | "workout_minutes" | "active_energy_kcal" | "avg_heart_rate_bpm" | "max_heart_rate_bpm"
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

export function getRecoverySignals(database: HealthLinkDatabase, options: QueryOptions = {}): unknown {
  const days = clampDays(options.days);
  const rows = database.sqlite.prepare(`
    select
      date,
      sleep_minutes,
      resting_heart_rate_bpm,
      avg_heart_rate_bpm,
      active_energy_kcal,
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
    | "active_energy_kcal"
    | "workout_minutes"
  >[];

  return {
    metadata: buildQueryMetadata(database),
    days,
    signals: rows.reverse()
  };
}

export function getWeeklySummary(database: HealthLinkDatabase, options: QueryOptions = {}): unknown {
  const days = Math.max(1, Math.min(options.days ?? 7, 14));
  const healthRows = latestHealthRows(database, days);
  const calendarRows = latestCalendarRows(database, days);

  const sleepValues = healthRows
    .map((row) => row.sleep_minutes)
    .filter((value): value is number => typeof value === "number");
  const stepsValues = healthRows
    .map((row) => row.steps)
    .filter((value): value is number => typeof value === "number");
  const activeEnergyValues = healthRows
    .map((row) => row.active_energy_kcal)
    .filter((value): value is number => typeof value === "number");
  const workoutMinutesValues = healthRows
    .map((row) => row.workout_minutes)
    .filter((value): value is number => typeof value === "number");
  const busyMinutesValues = calendarRows.map((row) => row.busy_minutes);

  return {
    metadata: buildQueryMetadata(database),
    days,
    date_range: {
      start: minString([...healthRows.map((row) => row.date), ...calendarRows.map((row) => row.date)]),
      end: maxString([...healthRows.map((row) => row.date), ...calendarRows.map((row) => row.date)])
    },
    coverage: {
      health_days: healthRows.length,
      calendar_days: calendarRows.length
    },
    sleep: {
      average_minutes: average(sleepValues),
      total_minutes: sum(sleepValues)
    },
    activity: {
      average_steps: average(stepsValues),
      total_steps: sum(stepsValues),
      total_active_energy_kcal: sum(activeEnergyValues)
    },
    workouts: {
      total_minutes: sum(workoutMinutesValues),
      days_with_workouts: workoutMinutesValues.filter((value) => value > 0).length
    },
    calendar: {
      total_busy_minutes: sum(busyMinutesValues),
      average_busy_minutes: average(busyMinutesValues)
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

export function buildQueryMetadata(database: HealthLinkDatabase): {
  freshness: {
    latest_sync_at: string | null;
    latest_health_updated_at: string | null;
    latest_calendar_updated_at: string | null;
  };
  source_coverage: SourceCoverageRow[];
  missing_metrics: string[];
} {
  const status = getHealthStatus(database);
  const latestHealthUpdatedAt = database.sqlite.prepare(`
    select max(updated_at) as value
    from health_daily_summaries
  `).get() as { value: string | null };
  const latestCalendarUpdatedAt = database.sqlite.prepare(`
    select max(updated_at) as value
    from calendar_daily_summaries
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
      latest_calendar_updated_at: latestCalendarUpdatedAt.value
    },
    source_coverage: sourceCoverage,
    missing_metrics: missingMetrics({
      healthCount: countRows(database, "health_daily_summaries"),
      calendarCount: countRows(database, "calendar_daily_summaries"),
      workoutCount: countRows(database, "health_workouts")
    })
  };
}

function findHealthDaily(database: HealthLinkDatabase, date?: string): HealthDailyRow | undefined {
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

function findCalendarDaily(database: HealthLinkDatabase, date?: string): CalendarDailyRow | undefined {
  if (date) {
    return database.sqlite.prepare(`
      select *
      from calendar_daily_summaries
      where date = ?
      order by updated_at desc
      limit 1
    `).get(date) as CalendarDailyRow | undefined;
  }

  return database.sqlite.prepare(`
    select *
    from calendar_daily_summaries
    order by date desc, updated_at desc
    limit 1
  `).get() as CalendarDailyRow | undefined;
}

function latestHealthRows(database: HealthLinkDatabase, days: number): HealthDailyRow[] {
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

function latestCalendarRows(database: HealthLinkDatabase, days: number): CalendarDailyRow[] {
  const rows = database.sqlite.prepare(`
    select *
    from (
      select
        *,
        row_number() over (
          partition by date
          order by updated_at desc, id desc
        ) as row_number
      from calendar_daily_summaries
    )
    where row_number = 1
    order by date desc
    limit ?
  `).all(days) as CalendarDailyRow[];

  return rows.reverse();
}

function countRows(database: HealthLinkDatabase, table: string): number {
  const row = database.sqlite.prepare(`select count(*) as value from ${table}`).get() as { value: number };
  return row.value;
}

function missingMetrics(input: {
  healthCount: number;
  calendarCount: number;
  workoutCount: number;
}): string[] {
  const missing: string[] = [];
  if (input.healthCount === 0) {
    missing.push("health.daily_summary");
  }
  if (input.calendarCount === 0) {
    missing.push("calendar.daily_summary");
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
