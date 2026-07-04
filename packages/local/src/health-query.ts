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

export function getAgentHealthStatus(database: HealthLinkDatabase): unknown {
  return getHealthStatus(database);
}

export function getPersonalContext(database: HealthLinkDatabase, options: QueryOptions = {}): unknown {
  const days = clampDays(options.days);

  return {
    purpose: "Use this HealthLink context to answer personal status, energy, recovery, workout readiness, sleep, schedule pressure, and day-planning questions. Do not invent health or calendar facts that are not present here.",
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
    days,
    signals: rows.reverse()
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

function clampDays(days?: number): number {
  if (typeof days !== "number" || !Number.isInteger(days)) {
    return 7;
  }
  return Math.max(1, Math.min(days, 90));
}
