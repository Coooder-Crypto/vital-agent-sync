import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { openHealthLinkDatabase } from "../src/database.js";
import { listDevices, revokeDevice } from "../src/devices.js";
import { authenticateDevice, ingestHealthSync } from "../src/health-ingest.js";
import {
  getCalendarAvailability,
  getDailyHealthSummary,
  getPersonalContext,
  getRecoverySignals,
  getSleepTrend,
  getWorkoutLoad
} from "../src/health-query.js";
import { getHermesMcpInstallStatus, installHermesMcpConfig } from "../src/mcp-config.js";
import { PairingStore } from "../src/pairing.js";
import { renderTerminalQr } from "../src/terminal-qr.js";

test("pairing creates a scoped device that can sync and be queried", () => {
  withTempDatabase((databasePath) => {
    const database = openHealthLinkDatabase({ path: databasePath });
    try {
      const pairings = new PairingStore(database);
      const session = pairings.createSession({
        serverUrl: "http://127.0.0.1:8787",
        agentName: "Test Agent"
      });
      const confirmed = pairings.confirm({
        pairing_code: session.pairing_code,
        device_name: "Test iPhone",
        device_platform: "ios",
        accepted_scopes: session.requested_scopes
      });
      const device = authenticateDevice(database, `Bearer ${confirmed.device_token}`);

      ingestHealthSync(database, device, {
        device_id: confirmed.device_id,
        sync_id: "sync_test_001",
        generated_at: "2026-07-04T10:00:00+08:00",
        timezone: "Asia/Shanghai",
        health_daily_summaries: [
          {
            date: "2026-07-04",
            provider: "apple_health",
            steps: 3456,
            sleep_minutes: 420,
            workouts: []
          }
        ],
        calendar_daily_summaries: [
          {
            date: "2026-07-04",
            provider: "apple_calendar",
            busy_minutes: 90,
            free_windows: [
              {
                start: "2026-07-04T19:00:00+08:00",
                end: "2026-07-04T21:00:00+08:00"
              }
            ],
            next_event: null
          }
        ]
      });

      const health = getDailyHealthSummary(database, { date: "2026-07-04" }) as {
        health: { steps: number };
      };
      const calendar = getCalendarAvailability(database, { date: "2026-07-04" }) as {
        calendar: { busy_minutes: number };
      };
      const context = getPersonalContext(database, { date: "2026-07-04", days: 7 }) as {
        daily_health_summary: { health: { steps: number } };
        calendar_availability: { calendar: { busy_minutes: number } };
        recovery_signals: { signals: unknown[] };
      };
      assert.equal(health.health.steps, 3456);
      assert.equal(calendar.calendar.busy_minutes, 90);
      assert.equal(context.daily_health_summary.health.steps, 3456);
      assert.equal(context.calendar_availability.calendar.busy_minutes, 90);
      assert.equal(context.recovery_signals.signals.length, 1);
    } finally {
      database.close();
    }
  });
});

test("revoked device token can no longer authenticate", () => {
  withTempDatabase((databasePath) => {
    const database = openHealthLinkDatabase({ path: databasePath });
    try {
      const pairings = new PairingStore(database);
      const session = pairings.createSession({
        serverUrl: "http://127.0.0.1:8787",
        agentName: "Test Agent"
      });
      const confirmed = pairings.confirm({
        pairing_code: session.pairing_code,
        device_name: "Test iPhone",
        device_platform: "ios",
        accepted_scopes: session.requested_scopes
      });

      const revoked = revokeDevice(database, confirmed.device_id);
      assert.equal(revoked?.revoked_at !== null, true);
      assert.throws(
        () => authenticateDevice(database, `Bearer ${confirmed.device_token}`),
        /invalid or revoked/
      );
      assert.equal(listDevices(database)[0]?.device_id, confirmed.device_id);
    } finally {
      database.close();
    }
  });
});

test("trend queries collapse duplicate dates to the newest summary", () => {
  withTempDatabase((databasePath) => {
    const database = openHealthLinkDatabase({ path: databasePath });
    try {
      const pairings = new PairingStore(database);
      const firstSession = pairings.createSession({
        serverUrl: "http://127.0.0.1:8787",
        agentName: "Test Agent"
      });
      const secondSession = pairings.createSession({
        serverUrl: "http://127.0.0.1:8787",
        agentName: "Test Agent"
      });
      const firstConfirmed = pairings.confirm({
        pairing_code: firstSession.pairing_code,
        device_name: "Old iPhone",
        device_platform: "ios",
        accepted_scopes: firstSession.requested_scopes
      });
      const secondConfirmed = pairings.confirm({
        pairing_code: secondSession.pairing_code,
        device_name: "New iPhone",
        device_platform: "ios",
        accepted_scopes: secondSession.requested_scopes
      });
      const firstDevice = authenticateDevice(database, `Bearer ${firstConfirmed.device_token}`);
      const secondDevice = authenticateDevice(database, `Bearer ${secondConfirmed.device_token}`);

      ingestHealthSync(database, firstDevice, {
        device_id: firstConfirmed.device_id,
        sync_id: "sync_old_device",
        generated_at: "2026-07-04T09:00:00+08:00",
        timezone: "Asia/Shanghai",
        health_daily_summaries: [
          {
            date: "2026-07-04",
            provider: "apple_health",
            sleep_minutes: 300,
            active_energy_kcal: 100,
            avg_heart_rate_bpm: 70,
            workouts: []
          }
        ],
        calendar_daily_summaries: []
      });
      ingestHealthSync(database, secondDevice, {
        device_id: secondConfirmed.device_id,
        sync_id: "sync_new_device",
        generated_at: "2026-07-04T10:00:00+08:00",
        timezone: "Asia/Shanghai",
        health_daily_summaries: [
          {
            date: "2026-07-04",
            provider: "apple_health",
            sleep_minutes: 420,
            active_energy_kcal: 250,
            avg_heart_rate_bpm: 62,
            workouts: []
          }
        ],
        calendar_daily_summaries: []
      });
      database.sqlite.prepare(`
        update health_daily_summaries
        set updated_at = ?
        where device_id = ?
      `).run("2026-07-04T01:00:00.000Z", firstConfirmed.device_id);
      database.sqlite.prepare(`
        update health_daily_summaries
        set updated_at = ?
        where device_id = ?
      `).run("2026-07-04T02:00:00.000Z", secondConfirmed.device_id);

      const sleep = getSleepTrend(database, { days: 7 }) as {
        trend: Array<{ date: string; sleep_minutes: number }>;
      };
      const workout = getWorkoutLoad(database, { days: 7 }) as {
        daily: Array<{ date: string; active_energy_kcal: number }>;
      };
      const recovery = getRecoverySignals(database, { days: 7 }) as {
        signals: Array<{ date: string; avg_heart_rate_bpm: number }>;
      };

      assert.deepEqual(sleep.trend, [
        {
          date: "2026-07-04",
          sleep_minutes: 420,
          resting_heart_rate_bpm: null,
          active_energy_kcal: 250,
          workout_minutes: null
        }
      ]);
      assert.equal(workout.daily.length, 1);
      assert.equal(workout.daily[0]?.active_energy_kcal, 250);
      assert.equal(recovery.signals.length, 1);
      assert.equal(recovery.signals[0]?.avg_heart_rate_bpm, 62);
    } finally {
      database.close();
    }
  });
});

test("Hermes MCP install writes healthlink server idempotently with backups", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "healthlink-hermes-test-"));
  try {
    const configPath = join(tempDir, "config.yaml");
    writeFileSync(configPath, "model:\n  provider: test\n", "utf8");

    const first = installHermesMcpConfig({
      configPath,
      databasePath: join(tempDir, "healthlink.sqlite")
    });
    const second = installHermesMcpConfig({
      configPath,
      databasePath: join(tempDir, "healthlink.sqlite")
    });
    const status = getHermesMcpInstallStatus({ configPath });

    assert.equal(status.installed, true);
    assert.ok(first.backupPath);
    assert.ok(second.backupPath);
    assert.notEqual(first.backupPath, second.backupPath);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("terminal QR renders visible Unicode blocks without ANSI backgrounds", () => {
  const result = renderTerminalQr("healthlink://pair?server=http%3A%2F%2F192.168.31.230%3A8787&code=468P-RAL8", {
    columns: 80
  });

  assert.equal(result.rendered, true);
  if (result.rendered) {
    assert.match(result.text, /[█▀▄]/u);
    assert.doesNotMatch(result.text, /\u001b\[/u);
    assert.match(result.text.split("\n")[0] ?? "", /^ █+$/u);
  }
});

test("terminal QR reports narrow terminals instead of wrapping", () => {
  const result = renderTerminalQr("healthlink://pair?server=http%3A%2F%2F192.168.31.230%3A8787&code=468P-RAL8", {
    columns: 24
  });

  assert.equal(result.rendered, false);
  if (!result.rendered) {
    assert.equal(result.requiredColumns > 24, true);
  }
});

function withTempDatabase(callback: (databasePath: string) => void): void {
  const tempDir = mkdtempSync(join(tmpdir(), "healthlink-test-"));
  try {
    callback(join(tempDir, "healthlink.sqlite"));
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}
