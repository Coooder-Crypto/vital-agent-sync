import SqliteDatabase from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import type { Database as BetterSqliteDatabase } from "better-sqlite3";

export type DatabaseConfig = {
  path: string;
};

export type VitalAgentDatabase = {
  path: string;
  sqlite: BetterSqliteDatabase;
  close: () => void;
};

const DATABASE_ID_KEY = "database_id";

export function getDefaultDatabasePath(): string {
  return join(homedir(), ".vital-agent-sync", "vital-agent.sqlite");
}

export function readExistingDatabaseId(path?: string): string | undefined {
  const databasePath = expandHomePath(path ?? getDefaultDatabasePath());
  if (!existsSync(databasePath)) return undefined;
  const sqlite = new SqliteDatabase(databasePath, { readonly: true, fileMustExist: true });
  try {
    const table = sqlite.prepare(`
      select 1 as present
      from sqlite_master
      where type = 'table' and name = 'runtime_metadata'
    `).get() as { present: number } | undefined;
    if (!table) return undefined;
    const row = sqlite.prepare(`
      select value
      from runtime_metadata
      where key = ?
    `).get(DATABASE_ID_KEY) as { value?: unknown } | undefined;
    return typeof row?.value === "string" && row.value.length > 0 ? row.value : undefined;
  } finally {
    sqlite.close();
  }
}

export function openVitalAgentDatabase(config: Partial<DatabaseConfig> = {}): VitalAgentDatabase {
  const usesDefaultPath = config.path === undefined;
  const databasePath = expandHomePath(config.path ?? getDefaultDatabasePath());
  const databaseDir = dirname(databasePath);
  mkdirSync(databaseDir, { recursive: true, mode: usesDefaultPath ? 0o700 : undefined });
  if (usesDefaultPath) {
    chmodIfPossible(databaseDir, 0o700);
  }

  const sqlite = new SqliteDatabase(databasePath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  migrate(sqlite);
  hardenSqliteFiles(databasePath);

  return {
    path: databasePath,
    sqlite,
    close: () => {
      hardenSqliteFiles(databasePath);
      sqlite.close();
      hardenSqliteFiles(databasePath);
    }
  };
}

function hardenSqliteFiles(databasePath: string): void {
  for (const path of [databasePath, `${databasePath}-wal`, `${databasePath}-shm`]) {
    if (existsSync(path)) {
      chmodIfPossible(path, 0o600);
    }
  }
}

function chmodIfPossible(path: string, mode: number): void {
  try {
    chmodSync(path, mode);
  } catch {
    // Windows and some filesystems may not support POSIX modes.
  }
}

function migrate(sqlite: BetterSqliteDatabase): void {
  sqlite.exec(`
    create table if not exists runtime_metadata (
      key text primary key,
      value text not null
    );

    create table if not exists pairing_sessions (
      code text primary key,
      pairing_url text not null,
      server_url text not null,
      agent_name text not null,
      transport text not null default 'lan',
      requested_scopes_json text not null,
      expires_in_seconds integer not null,
      created_at text not null,
      expires_at text not null,
      consumed_at text
    );

    create index if not exists idx_pairing_sessions_expires_at
      on pairing_sessions(expires_at);

    create table if not exists direct_transport_requests (
      request_id text primary key,
      created_at text not null,
      received_at text not null
    );

    create index if not exists idx_direct_transport_requests_received_at
      on direct_transport_requests(received_at);

    create table if not exists devices (
      id text primary key,
      name text not null,
      platform text not null,
      token_hash text not null,
      scopes_json text not null,
      created_at text not null,
      revoked_at text
    );

    create unique index if not exists idx_devices_token_hash
      on devices(token_hash);

    create table if not exists agent_clients (
      id text primary key,
      name text not null,
      runtime text not null,
      scopes_json text not null,
      created_at text not null,
      revoked_at text
    );

    create table if not exists agent_audit_log (
      id text primary key,
      agent_client_id text not null references agent_clients(id),
      tool_name text not null,
      scopes_used_json text not null,
      read_at text not null
    );

    create index if not exists idx_agent_audit_log_client_read_at
      on agent_audit_log(agent_client_id, read_at);

    create table if not exists sync_batches (
      sync_id text primary key,
      device_id text not null references devices(id),
      generated_at text not null,
      timezone text not null,
      received_at text not null,
      payload_hash text not null
    );

    create index if not exists idx_sync_batches_device_received_at
      on sync_batches(device_id, received_at);

    create table if not exists health_daily_summaries (
      id text primary key,
      device_id text not null references devices(id),
      date text not null,
      timezone text not null,
      provider text not null,
      steps integer,
      sleep_minutes integer,
      resting_heart_rate_bpm real,
      avg_heart_rate_bpm real,
      max_heart_rate_bpm real,
      active_energy_kcal real,
      basal_energy_kcal real,
      distance_walking_running_m real,
      distance_cycling_m real,
      flights_climbed integer,
      exercise_minutes integer,
      stand_minutes integer,
      heart_rate_variability_ms real,
      walking_heart_rate_average_bpm real,
      vo2_max_ml_kg_min real,
      oxygen_saturation_percent real,
      respiratory_rate_bpm real,
      body_temperature_c real,
      body_mass_kg real,
      body_fat_percentage real,
      lean_body_mass_kg real,
      body_mass_index real,
      workout_minutes integer,
      updated_at text not null,
      unique(device_id, provider, date, timezone)
    );

    create table if not exists health_workouts (
      id text primary key,
      device_id text not null references devices(id),
      provider text not null,
      workout_id text not null,
      type text not null,
      started_at text not null,
      duration_minutes integer not null,
      active_energy_kcal real,
      avg_heart_rate_bpm real,
      updated_at text not null,
      unique(device_id, provider, workout_id)
    );

    create table if not exists feedback_events (
      id text primary key,
      source text not null,
      category text not null,
      rating integer,
      note text,
      occurred_at text not null,
      created_at text not null
    );

    create index if not exists idx_feedback_events_occurred_at
      on feedback_events(occurred_at);
  `);

  ensureColumn(sqlite, "pairing_sessions", "transport", "text not null default 'lan'");
  ensureColumn(sqlite, "health_daily_summaries", "basal_energy_kcal", "real");
  ensureColumn(sqlite, "health_daily_summaries", "distance_walking_running_m", "real");
  ensureColumn(sqlite, "health_daily_summaries", "distance_cycling_m", "real");
  ensureColumn(sqlite, "health_daily_summaries", "flights_climbed", "integer");
  ensureColumn(sqlite, "health_daily_summaries", "exercise_minutes", "integer");
  ensureColumn(sqlite, "health_daily_summaries", "stand_minutes", "integer");
  ensureColumn(sqlite, "health_daily_summaries", "heart_rate_variability_ms", "real");
  ensureColumn(sqlite, "health_daily_summaries", "walking_heart_rate_average_bpm", "real");
  ensureColumn(sqlite, "health_daily_summaries", "vo2_max_ml_kg_min", "real");
  ensureColumn(sqlite, "health_daily_summaries", "oxygen_saturation_percent", "real");
  ensureColumn(sqlite, "health_daily_summaries", "respiratory_rate_bpm", "real");
  ensureColumn(sqlite, "health_daily_summaries", "body_temperature_c", "real");
  ensureColumn(sqlite, "health_daily_summaries", "body_mass_kg", "real");
  ensureColumn(sqlite, "health_daily_summaries", "body_fat_percentage", "real");
  ensureColumn(sqlite, "health_daily_summaries", "lean_body_mass_kg", "real");
  ensureColumn(sqlite, "health_daily_summaries", "body_mass_index", "real");
  sqlite.prepare(`
    insert or ignore into runtime_metadata (key, value)
    values (?, ?)
  `).run(DATABASE_ID_KEY, randomUUID());
}

export function getDatabaseId(database: VitalAgentDatabase): string {
  const row = database.sqlite.prepare(`
    select value
    from runtime_metadata
    where key = ?
  `).get(DATABASE_ID_KEY) as { value?: unknown } | undefined;
  if (!row || typeof row.value !== "string" || row.value.length === 0) {
    throw new Error("Vital Agent Sync database identity is missing.");
  }
  return row.value;
}

function ensureColumn(sqlite: BetterSqliteDatabase, table: string, column: string, definition: string): void {
  const rows = sqlite.prepare(`pragma table_info(${table})`).all() as Array<{ name: string }>;
  if (!rows.some((row) => row.name === column)) {
    sqlite.exec(`alter table ${table} add column ${column} ${definition}`);
  }
}

function expandHomePath(path: string): string {
  if (path === "~") {
    return homedir();
  }
  if (path.startsWith("~/")) {
    return join(homedir(), path.slice(2));
  }
  return path;
}
