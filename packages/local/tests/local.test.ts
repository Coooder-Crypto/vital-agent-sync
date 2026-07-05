import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  ensureDefaultMcpAgentClient,
  listAgentAuditLog,
  recordAgentRead
} from "../src/agent-audit.js";
import { getAgentAdapter } from "../src/agents.js";
import { openHealthLinkDatabase } from "../src/database.js";
import { listDevices, revokeDevice } from "../src/devices.js";
import { listFeedbackEvents, recordFeedback } from "../src/feedback.js";
import { authenticateDevice, ingestHealthSync } from "../src/health-ingest.js";
import {
  getCalendarAvailability,
  getDailyHealthSummary,
  getPersonalContext,
  getRecoverySignals,
  getSleepTrend,
  getWeeklySummary,
  getWorkoutLoad
} from "../src/health-query.js";
import { getHermesMcpInstallStatus, installHermesMcpConfig } from "../src/mcp-config.js";
import { requestPairingSession } from "../src/pairing-client.js";
import { PairingStore } from "../src/pairing.js";
import {
  buildLaunchdPlist,
  getLaunchdServicePaths,
  installLaunchdService,
  readLaunchdPlist
} from "../src/service.js";
import { runServiceSetupWorkflow } from "../src/setup.js";
import {
  SOURCE_PLATFORM_CAPABILITIES,
  listSourceDevices,
  revokeSourceDevice
} from "../src/source-devices.js";
import {
  buildHealthLinkSkillMarkdown,
  installHermesHealthLinkSkill,
  readInstalledHermesSkill
} from "../src/skill.js";
import { renderTerminalQr } from "../src/terminal-qr.js";
import { createTransportProvider } from "../src/transports.js";

test("pairing creates a scoped device that can sync and be queried", () => {
  withTempDatabase((databasePath) => {
    const database = openHealthLinkDatabase({ path: databasePath });
    try {
      const pairings = new PairingStore(database);
      const session = pairings.createSession({
        serverUrl: "http://127.0.0.1:8787",
        agentName: "Test Agent",
        transport: "lan"
      });
      const pairingStatus = pairings.getStatus(session.pairing_code);
      assert.equal(pairingStatus.transport, "lan");
      assert.match(session.pairing_url, /transport=lan/);
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
        metadata: { freshness: { latest_sync_at: string | null }; missing_metrics: string[] };
        daily_health_summary: { health: { steps: number } };
        calendar_availability: { calendar: { busy_minutes: number } };
        recovery_signals: { signals: unknown[] };
      };
      assert.equal(health.health.steps, 3456);
      assert.equal(calendar.calendar.busy_minutes, 90);
      assert.equal(context.daily_health_summary.health.steps, 3456);
      assert.equal(context.calendar_availability.calendar.busy_minutes, 90);
      assert.equal(context.recovery_signals.signals.length, 1);
      assert.equal(context.metadata.freshness.latest_sync_at !== null, true);

      const weekly = getWeeklySummary(database, { days: 7 }) as {
        coverage: { health_days: number; calendar_days: number };
        activity: { total_steps: number };
        calendar: { total_busy_minutes: number };
      };
      assert.equal(weekly.coverage.health_days, 1);
      assert.equal(weekly.coverage.calendar_days, 1);
      assert.equal(weekly.activity.total_steps, 3456);
      assert.equal(weekly.calendar.total_busy_minutes, 90);
    } finally {
      database.close();
    }
  });
});

test("agent audit log records MCP-style reads", () => {
  withTempDatabase((databasePath) => {
    const database = openHealthLinkDatabase({ path: databasePath });
    try {
      const agent = ensureDefaultMcpAgentClient(database);
      const entry = recordAgentRead(database, {
        agentClientId: agent.id,
        toolName: "get_personal_context"
      });
      const entries = listAgentAuditLog(database);

      assert.equal(entry.agent_client_id, agent.id);
      assert.equal(entries.length, 1);
      assert.equal(entries[0]?.tool_name, "get_personal_context");
      assert.deepEqual(entries[0]?.scopes_used, ["health.daily_summary.read", "calendar.daily_summary.read"]);
    } finally {
      database.close();
    }
  });
});

test("feedback events persist user corrections for agent loops", () => {
  withTempDatabase((databasePath) => {
    const database = openHealthLinkDatabase({ path: databasePath });
    try {
      const first = recordFeedback(database, {
        source: "agent",
        category: "analysis_quality",
        rating: 7,
        note: "Consider sleep debt before recommending late work.",
        occurred_at: "2026-07-04T10:00:00.000Z"
      });
      const second = recordFeedback(database, {
        category: "preference",
        rating: 0,
        note: "Prefer concise plans.",
        occurred_at: "2026-07-04T11:00:00.000Z"
      });
      const events = listFeedbackEvents(database);

      assert.equal(first.rating, 5);
      assert.equal(second.source, "agent");
      assert.equal(second.rating, 1);
      assert.equal(events.length, 2);
      assert.equal(events[0]?.category, "preference");
      assert.equal(events[1]?.note, "Consider sleep debt before recommending late work.");
      assert.throws(() => recordFeedback(database, { category: "   " }), /category is required/);
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

test("source-device wrapper preserves device compatibility", () => {
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

      const sourceDevice = listSourceDevices(database)[0];
      assert.equal(sourceDevice?.source_device_id, confirmed.device_id);
      assert.equal(sourceDevice?.legacy_device_id, confirmed.device_id);
      assert.equal(sourceDevice?.platform, "ios");

      const revoked = revokeSourceDevice(database, confirmed.device_id);
      assert.equal(revoked?.revoked_at !== null, true);
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

test("Agent adapters expose generic MCP config and Hermes install behavior", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "healthlink-agent-test-"));
  try {
    const generic = getAgentAdapter("generic");
    const genericConfig = JSON.parse(generic.formatMcpConfig({
      databasePath: join(tempDir, "healthlink.sqlite")
    })) as {
      mcpServers: { healthlink: { args: string[] } };
    };
    assert.deepEqual(genericConfig.mcpServers.healthlink.args.slice(0, 2), ["mcp", "--db"]);
    assert.equal(generic.detect().installed, true);

    const hermes = getAgentAdapter("hermes");
    const configPath = join(tempDir, "config.yaml");
    writeFileSync(configPath, "model:\n  provider: test\n", "utf8");
    const installed = hermes.installMcp({
      databasePath: join(tempDir, "healthlink.sqlite")
    }, {
      hermesConfigPath: configPath
    });
    const status = hermes.detect({ hermesConfigPath: configPath });

    assert.equal(installed.id, "hermes");
    assert.equal(status.installed, true);
    assert.match(hermes.formatMcpConfig({ databasePath: join(tempDir, "healthlink.sqlite") }), /mcp_servers:/);

    const openclaw = getAgentAdapter("openclaw");
    const openclawConfigPath = join(tempDir, "openclaw.json");
    writeFileSync(openclawConfigPath, JSON.stringify({ model: { provider: "test" } }, null, 2), "utf8");
    const openclawInstalled = openclaw.installMcp({
      databasePath: join(tempDir, "healthlink.sqlite")
    }, {
      openclawConfigPath
    });
    const openclawStatus = openclaw.detect({ openclawConfigPath });
    const openclawConfig = JSON.parse(openclaw.formatMcpConfig({
      databasePath: join(tempDir, "healthlink.sqlite")
    })) as {
      mcp: { servers: { healthlink: { args: string[] } } };
    };

    assert.equal(openclawInstalled.id, "openclaw");
    assert.equal(openclawStatus.installed, true);
    assert.deepEqual(openclawConfig.mcp.servers.healthlink.args.slice(0, 2), ["mcp", "--db"]);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("HealthLink skill can be printed and installed for Hermes", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "healthlink-skill-test-"));
  try {
    const skillPath = join(tempDir, "skills", "health", "healthlink-personal-context", "SKILL.md");
    const markdown = buildHealthLinkSkillMarkdown();
    assert.match(markdown, /name: healthlink-personal-context/);
    assert.match(markdown, /get_personal_context/);

    const first = installHermesHealthLinkSkill({ skillPath });
    const second = installHermesHealthLinkSkill({ skillPath });
    const installed = readInstalledHermesSkill({ skillPath });

    assert.equal(first.skillPath, skillPath);
    assert.ok(second.backupPath);
    assert.match(installed ?? "", /HealthLink Personal Context/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("Transport providers keep LAN default and allow explicit future URLs", async () => {
  const lan = createTransportProvider({
    id: "lan",
    bindHost: "127.0.0.1",
    port: 8787,
    serverUrl: "http://127.0.0.1:8787/"
  });
  assert.equal(await lan.getAdvertisedUrl(), "http://127.0.0.1:8787");
  assert.equal((await lan.healthCheck?.())?.status, "warn");

  const tailscale = createTransportProvider({
    id: "tailscale",
    bindHost: "0.0.0.0",
    port: 8787,
    serverUrl: "https://healthlink.example.ts.net/"
  });
  assert.equal(await tailscale.getAdvertisedUrl(), "https://healthlink.example.ts.net");
  assert.equal((await tailscale.healthCheck?.())?.status, "warn");

  const tailscaleMagicDns = createTransportProvider({
    id: "tailscale",
    bindHost: "0.0.0.0",
    port: 8787,
    tailscaleName: "healthlink.tailnet.ts.net."
  });
  assert.equal(await tailscaleMagicDns.getAdvertisedUrl(), "http://healthlink.tailnet.ts.net:8787");
  assert.match((await tailscaleMagicDns.healthCheck?.())?.detail ?? "", /MagicDNS/);

  const cloudflare = createTransportProvider({
    id: "cloudflare",
    bindHost: "0.0.0.0",
    port: 8787
  });
  await assert.rejects(() => cloudflare.getAdvertisedUrl(), /not implemented/);
});

test("launchd service plist uses daemon command and expected keepalive settings", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "healthlink-service-test-"));
  try {
    const plist = buildLaunchdPlist({
      homeDir: tempDir,
      cliCommand: "/tmp/healthlink-local",
      databasePath: join(tempDir, "healthlink.sqlite"),
      host: "0.0.0.0",
      port: 8787,
      transport: "lan"
    });

    assert.match(plist, /<string>com\.healthlink\.local<\/string>/);
    assert.match(plist, /<string>\/tmp\/healthlink-local<\/string>/);
    assert.match(plist, /<string>daemon<\/string>/);
    assert.match(plist, /<string>--db<\/string>/);
    assert.match(plist, /<string>--transport<\/string>/);
    assert.match(plist, /<string>lan<\/string>/);
    assert.match(plist, /<key>RunAtLoad<\/key>\s*<true\/>/);
    assert.match(plist, /<key>KeepAlive<\/key>\s*<true\/>/);

    const status = installLaunchdService({
      homeDir: tempDir,
      cliCommand: "/tmp/healthlink-local",
      databasePath: join(tempDir, "healthlink.sqlite"),
      host: "0.0.0.0",
      port: 8787,
      transport: "lan"
    });
    const paths = getLaunchdServicePaths({
      homeDir: tempDir,
      databasePath: join(tempDir, "healthlink.sqlite")
    });

    assert.equal(status.installed, true);
    assert.equal(status.running, false);
    assert.equal(status.plistPath, paths.plistPath);
    assert.match(readLaunchdPlist({ homeDir: tempDir }) ?? "", /daemon\.out\.log/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("pairing client reports unreachable daemon and parses pair/start responses", async () => {
  await assert.rejects(
    () => requestPairingSession({
      port: 8787,
      agentName: "Hermes Agent",
      transport: "lan",
      fetchImpl: (async () => {
        throw new Error("connection refused");
      }) as typeof fetch
    }),
    /receiver is not reachable/
  );

  const session = await requestPairingSession({
    port: 8787,
    agentName: "Hermes Agent",
    transport: "lan",
    fetchImpl: (async (_input, init) => {
      assert.equal(init?.method, "POST");
      const body = JSON.parse(String(init?.body)) as { agent_name: string; transport: string };
      assert.equal(body.agent_name, "Hermes Agent");
      assert.equal(body.transport, "lan");
      return new Response(JSON.stringify({
        pairing_code: "ABCD-1234",
        pairing_url: "healthlink://pair?server=http%3A%2F%2F127.0.0.1%3A8787&code=ABCD-1234",
        expires_in_seconds: 600
      }), {
        status: 200,
        headers: {
          "content-type": "application/json"
        }
      });
    }) as typeof fetch
  });

  assert.equal(session.pairing_code, "ABCD-1234");
  assert.equal(session.expires_in_seconds, 600);
});

test("service setup workflow installs agent, starts service, waits, pairs, then prints reload hint", async () => {
  const calls: string[] = [];
  await runServiceSetupWorkflow({
    installAgent: () => calls.push("install-agent"),
    installSkill: () => calls.push("install-skill"),
    installService: () => calls.push("install-service"),
    startService: () => calls.push("start-service"),
    waitForReady: async () => {
      calls.push("wait-ready");
    },
    pair: async () => {
      calls.push("pair");
    },
    printReloadHint: () => calls.push("reload-hint")
  }, {
    installSkill: true
  });

  assert.deepEqual(calls, [
    "install-agent",
    "install-skill",
    "install-service",
    "start-service",
    "wait-ready",
    "pair",
    "reload-hint"
  ]);
});

test("Source platform capability metadata includes future app surfaces", () => {
  assert.deepEqual(Object.keys(SOURCE_PLATFORM_CAPABILITIES).sort(), [
    "android",
    "calendar_connector",
    "ios",
    "manual_import",
    "xiaomi"
  ]);
  assert.equal(SOURCE_PLATFORM_CAPABILITIES.ios.metrics.includes("health.daily_summary"), true);
  assert.equal(SOURCE_PLATFORM_CAPABILITIES.android.syncCadence, "background_best_effort");
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
