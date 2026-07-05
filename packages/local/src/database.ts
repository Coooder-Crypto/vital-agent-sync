import SqliteDatabase from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import type { Database as BetterSqliteDatabase } from "better-sqlite3";

export type DatabaseConfig = {
  path: string;
};

export type HealthLinkDatabase = {
  path: string;
  sqlite: BetterSqliteDatabase;
  close: () => void;
};

export function getDefaultDatabasePath(): string {
  return join(homedir(), ".healthlink", "healthlink.sqlite");
}

export function openHealthLinkDatabase(config: Partial<DatabaseConfig> = {}): HealthLinkDatabase {
  const databasePath = expandHomePath(config.path ?? getDefaultDatabasePath());
  mkdirSync(dirname(databasePath), { recursive: true });

  const sqlite = new SqliteDatabase(databasePath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  migrate(sqlite);

  return {
    path: databasePath,
    sqlite,
    close: () => sqlite.close()
  };
}

function migrate(sqlite: BetterSqliteDatabase): void {
  sqlite.exec(`
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

    create table if not exists calendar_daily_summaries (
      id text primary key,
      device_id text not null references devices(id),
      date text not null,
      timezone text not null,
      provider text not null,
      busy_minutes integer not null,
      next_event_starts_at text,
      next_event_duration_minutes integer,
      title_redacted integer not null default 1,
      updated_at text not null,
      unique(device_id, provider, date, timezone)
    );

    create table if not exists calendar_free_windows (
      id text primary key,
      summary_id text not null references calendar_daily_summaries(id) on delete cascade,
      start text not null,
      end text not null
    );
  `);

  ensureColumn(sqlite, "pairing_sessions", "transport", "text not null default 'lan'");
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
