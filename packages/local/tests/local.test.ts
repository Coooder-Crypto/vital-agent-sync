import assert from "node:assert/strict";
import {
  createCipheriv,
  createHash,
  createHmac,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  randomBytes,
  sign
} from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import {
  ensureDefaultMcpAgentClient,
  listAgentAuditLog,
  recordAgentRead
} from "../src/agent-audit.js";
import { detectPreferredAgentAdapter, getAgentAdapter } from "../src/agents.js";
import {
  bootstrapStageComplete,
  buildBootstrapPlan,
  createBootstrapState,
  markBootstrapStage,
  readBootstrapState,
  runBootstrapWorkflow,
  sanitizeAgentOutput,
  withBootstrapLock,
  writeBootstrapState
} from "../src/bootstrap.js";
import { openHealthLinkDatabase } from "../src/database.js";
import { listDevices, revokeDevice } from "../src/devices.js";
import { buildDockerComposeYaml, buildRelayDockerComposeYaml } from "../src/docker-compose.js";
import { listFeedbackEvents, recordFeedback } from "../src/feedback.js";
import { HealthIngestError, authenticateDevice, ingestHealthSync, ingestValidatedHealthSync } from "../src/health-ingest.js";
import {
  getDailyHealthSummary,
  getPersonalContext,
  getRecoverySignals,
  getSleepTrend,
  getWeeklySummary,
  getWorkoutLoad
} from "../src/health-query.js";
import {
  buildHealthLinkMcpServerConfig,
  getHermesMcpInstallStatus,
  getWorkBuddyMcpInstallStatus,
  installHermesMcpConfig,
  installWorkBuddyMcpConfig
} from "../src/mcp-config.js";
import { requestPairingSession } from "../src/pairing-client.js";
import { writeRelayOnboardingArtifact } from "../src/onboarding-artifact.js";
import { PairingStore } from "../src/pairing.js";
import { findAvailableTcpPort, parseLsofListenOutput } from "../src/port-diagnostics.js";
import { auditRelayDeployment } from "../src/relay-audit.js";
import { canonicalJson, decryptHealthSyncEnvelope, encryptHealthSyncPayload, isEncryptedEnvelope } from "../src/relay-crypto.js";
import { buildRelayFixtureEnvelope, buildRelayFixturePayload } from "../src/relay-fixture.js";
import { migrateRelayRuntime, resetRelayRuntime, rotateRelayRuntime, unlinkRelaySourceDevice } from "../src/relay-lifecycle.js";
import { ensureRelaySourceDevice, pullRelayEnvelopes } from "../src/relay-pull.js";
import {
  buildRelayOnboardingDeepLink,
  buildRelayOnboardingPayload,
  encodeRelayOnboardingPayload,
  formatRelayOnboarding,
  getRelayConfigPath,
  getRelayCursorPath,
  initializeRelayRuntime,
  readRelayRuntimeConfig,
  resolveDefaultRelayUrl,
  validateRelayRuntimeState
} from "../src/relay-runtime.js";
import { resolveRelayServeConfig } from "../src/relay-serve-config.js";
import { cleanupExpiredRelayEnvelopes, createRelayApp, openRelayDatabase, type RelayDatabase } from "../src/relay-server.js";
import {
  buildLaunchdPlist,
  buildRelayPullProgramArguments,
  buildSystemdUnit,
  getLaunchdServicePaths,
  getManualServiceStatus,
  getSystemdServicePaths,
  installLaunchdService,
  readLaunchdServiceLog,
  readLaunchdPlist,
  resolveServiceManagerId
} from "../src/service.js";
import { runServiceEnsureWorkflow, runServiceSetupWorkflow } from "../src/setup.js";
import {
  SOURCE_PLATFORM_CAPABILITIES,
  listSourceDevices,
  revokeSourceDevice
} from "../src/source-devices.js";
import {
  buildHealthLinkSkillMarkdown,
  exportHealthLinkSkillPackage,
  installHermesHealthLinkSkill,
  readInstalledHermesSkill
} from "../src/skill.js";
import { renderTerminalQr } from "../src/terminal-qr.js";
import {
  createTransportProvider,
  getServerUrlDiagnostics,
  inspectTailscaleServeConfig,
  parseLinuxRouteSource,
  parseSshConnectionLocalAddress,
  selectLanAdvertisedHost
} from "../src/transports.js";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function relayDataHeaders(
  config: { relay_access_token: string },
  relayApiToken?: string
): Record<string, string> {
  return {
    "content-type": "application/json",
    authorization: `Bearer ${config.relay_access_token}`,
    ...(relayApiToken ? { "x-healthlink-relay-api-key": relayApiToken } : {})
  };
}

function readDeviceRevokedAt(databasePath: string, deviceId: string): string | null | undefined {
  const database = openHealthLinkDatabase({ path: databasePath });
  try {
    const row = database.sqlite.prepare(`
      select revoked_at as revokedAt
      from devices
      where id = ?
    `).get(deviceId) as { revokedAt: string | null } | undefined;
    return row?.revokedAt;
  } finally {
    database.close();
  }
}

test("health and relay SQLite files use private POSIX permissions", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "healthlink-sqlite-mode-test-"));
  const healthPath = join(tempDir, "healthlink.sqlite");
  const relayPath = join(tempDir, "relay.sqlite");
  const health = openHealthLinkDatabase({ path: healthPath });
  const relay = openRelayDatabase(relayPath);
  try {
    assert.equal(health.sqlite.pragma("foreign_keys", { simple: true }), 1);
    assert.equal(relay.sqlite.pragma("foreign_keys", { simple: true }), 1);
    if (process.platform !== "win32") {
      for (const path of [healthPath, relayPath]) {
        assert.equal(statSync(path).mode & 0o777, 0o600);
        for (const suffix of ["-wal", "-shm"]) {
          const sidecar = `${path}${suffix}`;
          if (existsSync(sidecar)) {
            assert.equal(statSync(sidecar).mode & 0o777, 0o600);
          }
        }
      }
    }
  } finally {
    health.close();
    relay.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

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
            active_energy_kcal: 480,
            basal_energy_kcal: 1500,
            distance_walking_running_m: 3200,
            flights_climbed: 8,
            exercise_minutes: 35,
            heart_rate_variability_ms: 42,
            vo2_max_ml_kg_min: 38.5,
            oxygen_saturation_percent: 97.5,
            respiratory_rate_bpm: 15.2,
            body_mass_kg: 72.4,
            workouts: []
          }
        ]
      });

      const health = getDailyHealthSummary(database, { date: "2026-07-04" }) as {
        health: {
          steps: number;
          basal_energy_kcal: number;
          distance_walking_running_m: number;
          heart_rate_variability_ms: number;
          vo2_max_ml_kg_min: number;
          oxygen_saturation_percent: number;
        };
      };
      const context = getPersonalContext(database, { date: "2026-07-04", days: 7 }) as {
        metadata: { freshness: { latest_sync_at: string | null }; missing_metrics: string[] };
        daily_health_summary: { health: { steps: number } };
        recovery_signals: { signals: unknown[] };
      };
      assert.equal(health.health.steps, 3456);
      assert.equal(health.health.basal_energy_kcal, 1500);
      assert.equal(health.health.distance_walking_running_m, 3200);
      assert.equal(health.health.heart_rate_variability_ms, 42);
      assert.equal(health.health.vo2_max_ml_kg_min, 38.5);
      assert.equal(health.health.oxygen_saturation_percent, 97.5);
      assert.equal(context.daily_health_summary.health.steps, 3456);
      assert.equal(context.recovery_signals.signals.length, 1);
      assert.equal(context.metadata.freshness.latest_sync_at !== null, true);

      const weekly = getWeeklySummary(database, { days: 7 }) as {
        coverage: { health_days: number };
        activity: { total_steps: number };
      };
      assert.equal(weekly.coverage.health_days, 1);
      assert.equal(weekly.activity.total_steps, 3456);
    } finally {
      database.close();
    }
  });
});

test("shared health sync ingest validates payloads, scopes, devices, and idempotency", () => {
  withTempDatabase((databasePath) => {
    const database = openHealthLinkDatabase({ path: databasePath });
    try {
      const pairings = new PairingStore(database);
      const session = pairings.createSession({
        serverUrl: "http://127.0.0.1:8787",
        agentName: "Test Agent",
        transport: "lan"
      });
      const confirmed = pairings.confirm({
        pairing_code: session.pairing_code,
        device_name: "Test iPhone",
        device_platform: "ios",
        accepted_scopes: session.requested_scopes
      });
      const device = authenticateDevice(database, `Bearer ${confirmed.device_token}`);
      const payload = {
        device_id: confirmed.device_id,
        sync_id: "sync_shared_ingest_001",
        generated_at: "2026-07-08T08:00:00+08:00",
        timezone: "Asia/Shanghai",
        health_daily_summaries: [
          {
            date: "2026-07-08",
            provider: "apple_health",
            steps: 2222,
            workouts: []
          }
        ]
      };

      const first = ingestValidatedHealthSync(database, device, payload);
      const second = ingestValidatedHealthSync(database, device, payload);
      assert.equal(first.idempotent, false);
      assert.equal(second.idempotent, true);
      assert.equal(second.accepted_sync_id, "sync_shared_ingest_001");

      assert.throws(
        () => ingestValidatedHealthSync(database, device, {
          ...payload,
          sync_id: "sync_shared_ingest_wrong_device",
          device_id: "dev_wrong"
        }),
        (error: unknown) => error instanceof HealthIngestError && error.code === "device_mismatch"
      );

      assert.throws(
        () => ingestValidatedHealthSync(database, {
          ...device,
          scopes: []
        }, {
          ...payload,
          sync_id: "sync_shared_ingest_missing_scope"
        }),
        (error: unknown) => error instanceof HealthIngestError && error.code === "missing_scope"
      );

      assert.throws(
        () => ingestValidatedHealthSync(database, device, {
          ...payload,
          sync_id: "sync_shared_ingest_invalid",
          health_daily_summaries: [
            {
              date: "not-a-date",
              provider: "apple_health",
              workouts: []
            }
          ]
        }),
        (error: unknown) => error instanceof HealthIngestError && error.code === "invalid_payload"
      );
    } finally {
      database.close();
    }
  });
});

test("relay pull decrypts encrypted health sync envelopes into MCP-readable SQLite", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "healthlink-relay-test-"));
  let app: ReturnType<typeof createRelayApp> | undefined;
  let relayDb: RelayDatabase | undefined;
  try {
    const stateDir = join(tempDir, "state");
    const healthDbPath = join(tempDir, "healthlink.sqlite");
    relayDb = openRelayDatabase(join(tempDir, "relay.sqlite"));
    app = createRelayApp(relayDb);
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    assert.ok(address && typeof address !== "string");
    const relayUrl = `http://127.0.0.1:${(address as AddressInfo).port}`;
    const config = initializeRelayRuntime({
      stateDir,
      relayUrl,
      agentName: "Relay Test Agent",
      mode: "self_hosted_relay"
    });
    const onboarding = buildRelayOnboardingPayload(config, { mode: "self_hosted_relay" });
    assert.match(onboarding.encryption_public_key_x25519, /^[A-Za-z0-9_-]+$/);
    assert.match(onboarding.upload_auth_secret, /^[A-Za-z0-9_-]+$/);
    assert.match(onboarding.relay_access_token, /^[A-Za-z0-9_-]+$/);
    const envelope = encryptHealthSyncPayload({
      config,
      sequence: 1,
      createdAt: "2026-07-08T00:00:00.000Z",
      payload: {
        device_id: config.source_device_id,
        sync_id: "sync_relay_test_001",
        generated_at: "2026-07-08T08:00:00+08:00",
        timezone: "Asia/Shanghai",
        health_daily_summaries: [
          {
            date: "2026-07-08",
            provider: "apple_health",
            steps: 7777,
            sleep_minutes: 411,
            active_energy_kcal: 520,
            workouts: []
          }
        ]
      }
    });
    assert.equal(envelope.crypto.alg, "x25519-hkdf-sha256-chacha20poly1305-hmac-sha256");
    assert.match(envelope.crypto.sender_public_key_x25519 ?? "", /^[A-Za-z0-9_-]+$/);

    const post = await fetch(`${relayUrl}/v1/envelopes`, {
      method: "POST",
      headers: relayDataHeaders(config),
      body: JSON.stringify(envelope)
    });
    assert.equal(post.ok, true);

    for (let sequence = 2; sequence <= 26; sequence += 1) {
      const nextEnvelope = buildRelayFixtureEnvelope({
        config,
        options: {
          sequence,
          syncId: `sync_relay_test_${String(sequence).padStart(3, "0")}`,
          date: "2026-07-08",
          generatedAt: "2026-07-08T08:00:00+08:00",
          steps: 7777,
          sleepMinutes: 411,
          activeEnergyKcal: 520
        }
      });
      const nextPost = await fetch(`${relayUrl}/v1/envelopes`, {
        method: "POST",
        headers: relayDataHeaders(config),
        body: JSON.stringify(nextEnvelope)
      });
      assert.equal(nextPost.ok, true);
    }

    const oversizedPage = await fetch(
      `${relayUrl}/v1/envelopes?user_id=${encodeURIComponent(config.user_id)}&after=0&limit=26`,
      { headers: relayDataHeaders(config) }
    );
    assert.equal(oversizedPage.status, 400);

    const pull = await pullRelayEnvelopes({
      stateDir,
      databasePath: healthDbPath
    });
    assert.equal(pull.fetched, 26);
    assert.equal(pull.ingested, 26);
    assert.equal(pull.acked, 26);
    assert.equal(pull.latest_sequence, 26);
    assert.equal(readdirSync(stateDir).some((name) => name.endsWith(".tmp")), false);

    const database = openHealthLinkDatabase({ path: healthDbPath });
    try {
      const health = getDailyHealthSummary(database, { date: "2026-07-08" }) as {
        health: {
          steps: number;
          sleep_minutes: number;
          active_energy_kcal: number;
        };
      };
      const previousStateDir = process.env.HEALTHLINK_STATE_DIR;
      process.env.HEALTHLINK_STATE_DIR = stateDir;
      const context = getPersonalContext(database, { date: "2026-07-08" }) as {
        metadata: {
          relay: {
            transport_mode: string;
            last_successful_pull_at: string | null;
            suggested_next_action: string;
          };
          freshness: {
            latest_successful_relay_pull_at: string | null;
            latest_source_generated_at: string | null;
          };
        };
      };
      if (previousStateDir === undefined) {
        delete process.env.HEALTHLINK_STATE_DIR;
      } else {
        process.env.HEALTHLINK_STATE_DIR = previousStateDir;
      }
      assert.equal(health.health.steps, 7777);
      assert.equal(health.health.sleep_minutes, 411);
      assert.equal(health.health.active_energy_kcal, 520);
      assert.equal(context.metadata.relay.transport_mode, "self_hosted_relay");
      assert.equal(typeof context.metadata.relay.last_successful_pull_at, "string");
      assert.match(context.metadata.relay.suggested_next_action, /vitalmcp pull/);
      assert.equal(context.metadata.freshness.latest_source_generated_at, "2026-07-08T08:00:00+08:00");
      assert.equal(context.metadata.freshness.latest_successful_relay_pull_at, context.metadata.relay.last_successful_pull_at);
    } finally {
      database.close();
    }

    const secondPull = await pullRelayEnvelopes({
      stateDir,
      databasePath: healthDbPath
    });
    assert.equal(secondPull.fetched, 0);
    assert.equal(secondPull.acked, 0);
  } finally {
    if (app) {
      await app.close();
    }
    relayDb?.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("relay crypto rejects tampered, stale, duplicate, and mismatched envelopes", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "healthlink-crypto-negative-test-"));
  try {
    const config = initializeRelayRuntime({
      stateDir: tempDir,
      relayUrl: "http://127.0.0.1:8790",
      agentName: "Relay Crypto Test",
      mode: "self_hosted_relay"
    });
    const payload = {
      device_id: config.source_device_id,
      sync_id: "sync_crypto_negative_001",
      generated_at: new Date().toISOString(),
      timezone: "Asia/Shanghai",
      health_daily_summaries: [
        {
          date: "2026-07-08",
          provider: "apple_health",
          steps: 1000,
          workouts: []
        }
      ]
    };
    const envelope = encryptHealthSyncPayload({
      config,
      payload,
      sequence: 1,
      createdAt: new Date().toISOString()
    });

    assert.equal(
      (decryptHealthSyncEnvelope({ config, envelope }) as { sync_id: string }).sync_id,
      "sync_crypto_negative_001"
    );

    const tamperedCiphertext = structuredClone(envelope);
    tamperedCiphertext.crypto.ciphertext = tamperBase64UrlBytes(tamperedCiphertext.crypto.ciphertext);
    assert.throws(
      () => decryptHealthSyncEnvelope({ config, envelope: tamperedCiphertext }),
      /signature verification failed/
    );

    const badSignature = structuredClone(envelope);
    badSignature.crypto.signature = "bad-signature";
    assert.throws(
      () => decryptHealthSyncEnvelope({ config, envelope: badSignature }),
      /signature verification failed/
    );

    const stale = encryptHealthSyncPayload({
      config,
      payload: {
        ...payload,
        sync_id: "sync_crypto_negative_stale"
      },
      sequence: 2,
      createdAt: "2026-06-01T00:00:00.000Z"
    });
    assert.throws(
      () => decryptHealthSyncEnvelope({
        config,
        envelope: stale,
        validation: { now: "2026-07-08T00:00:00.000Z" }
      }),
      /freshness window/
    );

    assert.throws(
      () => decryptHealthSyncEnvelope({
        config,
        envelope,
        validation: { seenEnvelopeIds: [envelope.envelope_id] }
      }),
      /already processed/
    );

    const wrongDevice = structuredClone(envelope);
    wrongDevice.device_id = "dev_wrong";
    assert.throws(
      () => decryptHealthSyncEnvelope({ config, envelope: wrongDevice }),
      /device_id does not match/
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("relay envelope shape rejects malformed routing and cryptographic fields before queueing", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "healthlink-envelope-shape-test-"));
  try {
    const config = initializeRelayRuntime({ stateDir: tempDir, mode: "self_hosted_relay" });
    const envelope = buildRelayFixtureEnvelope({
      config,
      options: { sequence: 1, createdAt: new Date().toISOString() }
    });
    assert.equal(isEncryptedEnvelope(envelope), true);

    const invalidEnvelopes = [];
    const fractionalSequence = structuredClone(envelope);
    fractionalSequence.sequence = 1.5;
    invalidEnvelopes.push(fractionalSequence);
    const invalidUser = structuredClone(envelope);
    invalidUser.user_id = "usr/invalid";
    invalidEnvelopes.push(invalidUser);
    const invalidTimestamp = structuredClone(envelope);
    invalidTimestamp.created_at = "not-a-timestamp";
    invalidEnvelopes.push(invalidTimestamp);
    const shortSenderKey = structuredClone(envelope);
    shortSenderKey.crypto.sender_public_key_x25519 = Buffer.alloc(31).toString("base64url");
    invalidEnvelopes.push(shortSenderKey);
    const shortNonce = structuredClone(envelope);
    shortNonce.crypto.nonce = Buffer.alloc(11).toString("base64url");
    invalidEnvelopes.push(shortNonce);
    const shortTag = structuredClone(envelope);
    shortTag.crypto.tag = Buffer.alloc(15).toString("base64url");
    invalidEnvelopes.push(shortTag);
    const emptyCiphertext = structuredClone(envelope);
    emptyCiphertext.crypto.ciphertext = "";
    invalidEnvelopes.push(emptyCiphertext);
    const shortSignature = structuredClone(envelope);
    shortSignature.crypto.signature = Buffer.alloc(31).toString("base64url");
    invalidEnvelopes.push(shortSignature);

    for (const invalid of invalidEnvelopes) {
      assert.equal(isEncryptedEnvelope(invalid), false);
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("relay decrypts legacy HMAC and Ed25519 development envelopes without emitting them", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "healthlink-legacy-envelope-test-"));
  try {
    const config = initializeRelayRuntime({ stateDir: tempDir, mode: "self_hosted_relay" });
    const payload = buildRelayFixturePayload(config, {
      sequence: 7,
      generatedAt: new Date().toISOString()
    });
    const algorithms = [
      "x25519-chacha20poly1305-hmac-sha256",
      "x25519-chacha20poly1305-ed25519"
    ] as const;

    for (const algorithm of algorithms) {
      const envelope = buildLegacyRelayEnvelope(config, payload, algorithm);
      assert.equal(isEncryptedEnvelope(envelope), true);
      const decrypted = decryptHealthSyncEnvelope({ config, envelope }) as typeof payload;
      assert.equal(decrypted.sync_id, payload.sync_id);
      assert.equal(decrypted.device_id, config.source_device_id);
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("relay fixture generator creates decryptable health sync envelopes", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "healthlink-relay-fixture-test-"));
  try {
    const config = initializeRelayRuntime({
      stateDir: tempDir,
      relayUrl: "http://127.0.0.1:8790",
      agentName: "Relay Fixture Test",
      mode: "self_hosted_relay"
    });
    const payload = buildRelayFixturePayload(config, {
      date: "2026-07-08",
      steps: 8888,
      sleepMinutes: 399,
      activeEnergyKcal: 610,
      sequence: 42,
      generatedAt: "2026-07-08T08:00:00+08:00",
      timezone: "Asia/Shanghai"
    });
    const envelope = buildRelayFixtureEnvelope({
      config,
      options: {
        date: "2026-07-08",
        steps: 8888,
        sleepMinutes: 399,
        activeEnergyKcal: 610,
        sequence: 42,
        generatedAt: "2026-07-08T08:00:00+08:00",
        createdAt: "2026-07-08T00:00:00.000Z",
        timezone: "Asia/Shanghai"
      }
    });
    const decrypted = decryptHealthSyncEnvelope({
      config,
      envelope,
      validation: {
        now: "2026-07-08T00:00:00.000Z"
      }
    }) as typeof payload;

    assert.equal(payload.sync_id, "sync_fixture_20260708_42");
    assert.equal(envelope.sequence, 42);
    assert.equal(decrypted.device_id, config.source_device_id);
    assert.equal(decrypted.sync_id, "sync_fixture_20260708_42");
    assert.equal(decrypted.health_daily_summaries[0]?.steps, 8888);
    assert.equal(decrypted.health_daily_summaries[0]?.sleep_minutes, 399);
    assert.equal(decrypted.health_daily_summaries[0]?.active_energy_kcal, 610);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("relay runtime resolves hosted and self-hosted relay URLs from environment", () => {
  const previousHosted = process.env.HEALTHLINK_HOSTED_RELAY_URL;
  const previousSelfHosted = process.env.HEALTHLINK_SELF_HOSTED_RELAY_URL;
  const previousGeneric = process.env.HEALTHLINK_RELAY_URL;
  try {
    process.env.HEALTHLINK_HOSTED_RELAY_URL = "https://relay.example.test/";
    process.env.HEALTHLINK_SELF_HOSTED_RELAY_URL = "http://192.168.31.53:8790/";
    process.env.HEALTHLINK_RELAY_URL = "https://generic-relay.example.test/";

    assert.equal(resolveDefaultRelayUrl({ mode: "hosted_relay" }), "https://relay.example.test");
    assert.equal(resolveDefaultRelayUrl({ mode: "self_hosted_relay" }), "http://192.168.31.53:8790");
    assert.equal(resolveDefaultRelayUrl({
      mode: "hosted_relay",
      relayUrl: "https://explicit.example.test/"
    }), "https://explicit.example.test");

    delete process.env.HEALTHLINK_HOSTED_RELAY_URL;
    assert.equal(resolveDefaultRelayUrl({ mode: "hosted_relay" }), "https://generic-relay.example.test");
    assert.throws(
      () => resolveDefaultRelayUrl({ relayUrl: "ftp://relay.example.test" }),
      /must use HTTP or HTTPS/
    );
    assert.throws(
      () => resolveDefaultRelayUrl({ relayUrl: "https://user:secret@relay.example.test" }),
      /must not contain embedded credentials/
    );
    assert.throws(
      () => resolveDefaultRelayUrl({ relayUrl: "https://relay.example.test?token=secret" }),
      /must not contain a query string or fragment/
    );
    assert.throws(
      () => resolveDefaultRelayUrl({ mode: "hosted_relay", relayUrl: "http://relay.example.test" }),
      /must use HTTPS/
    );
    delete process.env.HEALTHLINK_RELAY_URL;
    assert.throws(
      () => resolveDefaultRelayUrl({ mode: "hosted_relay" }),
      /is not configured/
    );
    delete process.env.HEALTHLINK_SELF_HOSTED_RELAY_URL;
    assert.equal(resolveDefaultRelayUrl({ mode: "self_hosted_relay" }), "http://127.0.0.1:8790");
  } finally {
    restoreEnv("HEALTHLINK_HOSTED_RELAY_URL", previousHosted);
    restoreEnv("HEALTHLINK_SELF_HOSTED_RELAY_URL", previousSelfHosted);
    restoreEnv("HEALTHLINK_RELAY_URL", previousGeneric);
  }
});

test("relay runtime setup is idempotent, migrates access tokens, hardens files, and rejects malformed config", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "healthlink-relay-runtime-test-"));
  try {
    const first = initializeRelayRuntime({
      stateDir: tempDir,
      relayUrl: "https://first-relay.example.test",
      relayApiToken: "first-deployment-key",
      agentName: "First Agent"
    });
    const second = initializeRelayRuntime({
      stateDir: tempDir,
      relayUrl: "https://different-relay.example.test",
      relayApiToken: "different-deployment-key",
      agentName: "Different Agent"
    });
    assert.equal(second.user_id, first.user_id);
    assert.equal(second.source_device_id, first.source_device_id);
    assert.equal(second.encryption_public_key_pem, first.encryption_public_key_pem);
    assert.equal(second.upload_auth_secret, first.upload_auth_secret);
    assert.equal(second.relay_access_token, first.relay_access_token);
    assert.equal(second.relay_url, "https://first-relay.example.test");
    assert.deepEqual(validateRelayRuntimeState(first), []);

    if (process.platform !== "win32") {
      assert.equal(statSync(tempDir).mode & 0o777, 0o700);
      assert.equal(statSync(join(tempDir, "secrets")).mode & 0o777, 0o700);
      assert.equal(statSync(getRelayConfigPath(tempDir)).mode & 0o777, 0o600);
      assert.equal(statSync(first.encryption_private_key_path).mode & 0o777, 0o600);
      assert.equal(statSync(first.signing_private_key_path).mode & 0o777, 0o600);
    }

    const legacy = JSON.parse(readFileSync(getRelayConfigPath(tempDir), "utf8")) as Record<string, unknown>;
    delete legacy.relay_access_token;
    writeFileSync(getRelayConfigPath(tempDir), JSON.stringify(legacy), "utf8");
    const migrated = readRelayRuntimeConfig({ stateDir: tempDir });
    const migratedAgain = readRelayRuntimeConfig({ stateDir: tempDir });
    assert.match(migrated.relay_access_token, /^[A-Za-z0-9_-]{40,}$/);
    assert.equal(migratedAgain.relay_access_token, migrated.relay_access_token);

    rmSync(migrated.signing_private_key_path);
    assert.deepEqual(validateRelayRuntimeState(migrated), ["signing private key file is missing"]);

    writeFileSync(getRelayConfigPath(tempDir), JSON.stringify({ protocol: "healthlink-e2ee-v1" }), "utf8");
    assert.throws(
      () => readRelayRuntimeConfig({ stateDir: tempDir }),
      /runtime config is invalid/
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("relay onboarding supports deep-link and text-code handoff without private keys", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "healthlink-relay-onboarding-test-"));
  try {
    const config = initializeRelayRuntime({
      stateDir: tempDir,
      relayUrl: "https://relay.example.test",
      relayApiToken: "deployment-gateway-token",
      agentName: "OpenClaw Agent"
    });
    const payload = buildRelayOnboardingPayload(config);
    const code = encodeRelayOnboardingPayload(payload);
    const link = buildRelayOnboardingDeepLink(payload);
    const encoded = code.slice("healthlink-e2ee-v1:".length);
    const decoded = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as typeof payload;
    const linkURL = new URL(link);
    const output = formatRelayOnboarding(config);

    assert.equal(decoded.relay_access_token, config.relay_access_token);
    assert.equal(decoded.upload_auth_secret, config.upload_auth_secret);
    assert.equal(linkURL.protocol, "vitalmcp:");
    assert.equal(linkURL.host, "onboard");
    assert.equal(linkURL.searchParams.get("payload"), code);
    assert.match(output, /Sensitive: this onboarding material/);
    assert.match(output, /vitalmcp:\/\/onboard/);
    assert.match(output, /healthlink-e2ee-v1:/);
    assert.doesNotMatch(output, /BEGIN PRIVATE KEY/);
    assert.doesNotMatch(output, new RegExp(readFileSync(config.encryption_private_key_path, "utf8").slice(0, 32)));

    const invalidHostedConfig = {
      ...config,
      relay_url: "http://relay.example.test"
    };
    assert.throws(
      () => buildRelayOnboardingPayload(invalidHostedConfig),
      /must use HTTPS/
    );
    assert.match(validateRelayRuntimeState(invalidHostedConfig).join("; "), /must use HTTPS/);
    assert.equal(
      buildRelayOnboardingPayload(invalidHostedConfig, { mode: "self_hosted_relay" }).relay_url,
      "http://relay.example.test"
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("hosted relay operations reject HTTP overrides before sending credentials", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "healthlink-hosted-http-rejection-test-"));
  try {
    initializeRelayRuntime({
      stateDir: tempDir,
      relayUrl: "https://relay.example.test",
      mode: "hosted_relay"
    });
    await assert.rejects(
      () => pullRelayEnvelopes({
        stateDir: tempDir,
        relayUrl: "http://relay.example.test"
      }),
      /must use HTTPS/
    );
    let lifecycleRequestSent = false;
    await assert.rejects(
      () => unlinkRelaySourceDevice({
        stateDir: tempDir,
        relayUrl: "http://relay.example.test",
        fetchImpl: (async () => {
          lifecycleRequestSent = true;
          return new Response("{}", { status: 200 });
        }) as typeof fetch
      }),
      /must use HTTPS/
    );
    assert.equal(lifecycleRequestSent, false);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("relay pull records failed envelopes without acking or advancing past them", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "healthlink-relay-failure-test-"));
  let app: ReturnType<typeof createRelayApp> | undefined;
  let relayDb: RelayDatabase | undefined;
  try {
    const stateDir = join(tempDir, "state");
    const healthDbPath = join(tempDir, "healthlink.sqlite");
    relayDb = openRelayDatabase(join(tempDir, "relay.sqlite"));
    app = createRelayApp(relayDb);
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    assert.ok(address && typeof address !== "string");
    const relayUrl = `http://127.0.0.1:${(address as AddressInfo).port}`;
    const config = initializeRelayRuntime({
      stateDir,
      relayUrl,
      agentName: "Relay Failure Test",
      mode: "self_hosted_relay"
    });
    const envelope = encryptHealthSyncPayload({
      config,
      sequence: 1,
      createdAt: new Date().toISOString(),
      payload: {
        device_id: config.source_device_id,
        sync_id: "sync_relay_failure_001",
        generated_at: new Date().toISOString(),
        timezone: "Asia/Shanghai",
        health_daily_summaries: [
          {
            date: "2026-07-08",
            provider: "apple_health",
            steps: 1234,
            workouts: []
          }
        ]
      }
    });
    const badEnvelope = structuredClone(envelope);
    badEnvelope.crypto.signature = tamperBase64UrlBytes(badEnvelope.crypto.signature);

    const post = await fetch(`${relayUrl}/v1/envelopes`, {
      method: "POST",
      headers: relayDataHeaders(config),
      body: JSON.stringify(badEnvelope)
    });
    assert.equal(post.ok, true);

    await assert.rejects(
      () => pullRelayEnvelopes({
        stateDir,
        databasePath: healthDbPath
      }),
      /Failed to process relay envelope/
    );

    const cursor = JSON.parse(readFileSync(getRelayCursorPath(stateDir), "utf8")) as {
      latest_sequence: number;
      last_failed_envelope_id?: string;
      last_error?: string;
    };
    assert.equal(cursor.latest_sequence, 0);
    assert.equal(cursor.last_failed_envelope_id, badEnvelope.envelope_id);
    assert.match(cursor.last_error ?? "", /signature verification failed/);
    if (process.platform !== "win32") {
      assert.equal(statSync(getRelayCursorPath(stateDir)).mode & 0o777, 0o600);
    }

    const listResponse = await fetch(`${relayUrl}/v1/envelopes?user_id=${encodeURIComponent(config.user_id)}&after=0`, {
      headers: relayDataHeaders(config)
    });
    const listBody = await listResponse.json() as { envelopes: unknown[] };
    assert.equal(listBody.envelopes.length, 1);
  } finally {
    if (app) {
      await app.close();
    }
    relayDb?.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("relay server expires old envelopes and rate limits uploads", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "healthlink-relay-controls-test-"));
  let app: ReturnType<typeof createRelayApp> | undefined;
  let relayDb: RelayDatabase | undefined;
  try {
    const stateDir = join(tempDir, "state");
    relayDb = openRelayDatabase(join(tempDir, "relay.sqlite"));
    app = createRelayApp(relayDb, {
      retentionMs: 60_000,
      maxUploadsPerMinute: 1
    });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    assert.ok(address && typeof address !== "string");
    const relayUrl = `http://127.0.0.1:${(address as AddressInfo).port}`;
    const config = initializeRelayRuntime({
      stateDir,
      relayUrl,
      agentName: "Relay Controls Test",
      mode: "self_hosted_relay"
    });
    const firstEnvelope = encryptHealthSyncPayload({
      config,
      sequence: 1,
      createdAt: new Date().toISOString(),
      payload: {
        device_id: config.source_device_id,
        sync_id: "sync_relay_controls_001",
        generated_at: new Date().toISOString(),
        timezone: "Asia/Shanghai",
        health_daily_summaries: []
      }
    });
    const secondEnvelope = encryptHealthSyncPayload({
      config,
      sequence: 2,
      createdAt: new Date().toISOString(),
      payload: {
        device_id: config.source_device_id,
        sync_id: "sync_relay_controls_002",
        generated_at: new Date().toISOString(),
        timezone: "Asia/Shanghai",
        health_daily_summaries: []
      }
    });

    const firstPost = await fetch(`${relayUrl}/v1/envelopes`, {
      method: "POST",
      headers: relayDataHeaders(config),
      body: JSON.stringify(firstEnvelope)
    });
    assert.equal(firstPost.ok, true);

    const secondPost = await fetch(`${relayUrl}/v1/envelopes`, {
      method: "POST",
      headers: relayDataHeaders(config),
      body: JSON.stringify(secondEnvelope)
    });
    assert.equal(secondPost.status, 429);

    relayDb.sqlite.prepare(`
      update relay_envelopes
      set received_at = ?
      where envelope_id = ?
    `).run("2026-07-08T00:00:00.000Z", firstEnvelope.envelope_id);

    const deleted = cleanupExpiredRelayEnvelopes(
      relayDb,
      60_000,
      new Date("2026-07-08T00:02:00.000Z")
    );
    const remaining = relayDb.sqlite.prepare(`
      select count(*) as count
      from relay_envelopes
    `).get() as { count: number };

    assert.equal(deleted, 1);
    assert.equal(remaining.count, 0);
  } finally {
    if (app) {
      await app.close();
    }
    relayDb?.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("relay trusted-proxy mode rate limits distinct forwarded client IPs independently", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "healthlink-relay-trust-proxy-test-"));
  const stateDir = join(tempDir, "state");
  const relayDb = openRelayDatabase(join(tempDir, "relay.sqlite"));
  const app = createRelayApp(relayDb, {
    maxUploadsPerMinute: 1,
    trustProxy: true
  });
  try {
    const config = initializeRelayRuntime({
      stateDir,
      relayUrl: "http://127.0.0.1:8790",
      mode: "self_hosted_relay"
    });
    const envelopes = [1, 2, 3].map((sequence) => buildRelayFixtureEnvelope({
      config,
      options: { sequence, createdAt: new Date().toISOString() }
    }));
    const injectUpload = (envelope: (typeof envelopes)[number], clientIp: string) => app.inject({
      method: "POST",
      url: "/v1/envelopes",
      remoteAddress: "172.20.0.2",
      headers: {
        ...relayDataHeaders(config),
        "x-forwarded-for": clientIp
      },
      payload: envelope
    });

    assert.equal((await injectUpload(envelopes[0]!, "203.0.113.10")).statusCode, 200);
    assert.equal((await injectUpload(envelopes[1]!, "203.0.113.11")).statusCode, 200);
    assert.equal((await injectUpload(envelopes[2]!, "203.0.113.11")).statusCode, 429);

    const status = await app.inject({ method: "GET", url: "/v1/status" });
    assert.equal(status.json().limits.proxyAwareClientIp, true);
  } finally {
    await app.close();
    relayDb.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("relay server enforces per-user queue quota and exposes body-free metrics", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "healthlink-relay-quota-test-"));
  let app: ReturnType<typeof createRelayApp> | undefined;
  let relayDb: RelayDatabase | undefined;
  try {
    const stateDir = join(tempDir, "state");
    relayDb = openRelayDatabase(join(tempDir, "relay.sqlite"));
    app = createRelayApp(relayDb, {
      maxQueuedEnvelopesPerUser: 1,
      maxUploadsPerMinute: 100
    });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    assert.ok(address && typeof address !== "string");
    const relayUrl = `http://127.0.0.1:${(address as AddressInfo).port}`;
    const config = initializeRelayRuntime({
      stateDir,
      relayUrl,
      agentName: "Relay Quota Test",
      mode: "self_hosted_relay"
    });
    const firstEnvelope = encryptHealthSyncPayload({
      config,
      sequence: 1,
      createdAt: new Date().toISOString(),
      payload: {
        device_id: config.source_device_id,
        sync_id: "sync_relay_quota_001",
        generated_at: new Date().toISOString(),
        timezone: "Asia/Shanghai",
        health_daily_summaries: []
      }
    });
    const secondEnvelope = encryptHealthSyncPayload({
      config,
      sequence: 2,
      createdAt: new Date().toISOString(),
      payload: {
        device_id: config.source_device_id,
        sync_id: "sync_relay_quota_002",
        generated_at: new Date().toISOString(),
        timezone: "Asia/Shanghai",
        health_daily_summaries: []
      }
    });

    const firstPost = await fetch(`${relayUrl}/v1/envelopes`, {
      method: "POST",
      headers: relayDataHeaders(config),
      body: JSON.stringify(firstEnvelope)
    });
    assert.equal(firstPost.ok, true);

    const secondPost = await fetch(`${relayUrl}/v1/envelopes`, {
      method: "POST",
      headers: relayDataHeaders(config),
      body: JSON.stringify(secondEnvelope)
    });
    assert.equal(secondPost.status, 429);
    const secondBody = await secondPost.json() as { error: string };
    assert.equal(secondBody.error, "quota_exceeded");

    const metricsResponse = await fetch(`${relayUrl}/v1/metrics`);
    const metricsText = await metricsResponse.text();
    assert.match(metricsText, /queued_envelopes/);
    assert.match(metricsText, /maxQueuedEnvelopesPerUser/);
    assert.doesNotMatch(metricsText, /ciphertext/);
    assert.doesNotMatch(metricsText, new RegExp(firstEnvelope.envelope_id));

    const statusPageResponse = await fetch(`${relayUrl}/`);
    const statusPageText = await statusPageResponse.text();
    assert.equal(statusPageResponse.headers.get("content-type")?.includes("text/html"), true);
    assert.match(statusPageText, /Vital Agent Sync Relay Status/);
    assert.match(statusPageText, /Queued envelopes/);
    assert.doesNotMatch(statusPageText, /ciphertext/);
    assert.doesNotMatch(statusPageText, new RegExp(firstEnvelope.envelope_id));
    assert.doesNotMatch(statusPageText, new RegExp(firstEnvelope.crypto.ciphertext.slice(0, 16)));
  } finally {
    if (app) {
      await app.close();
    }
    relayDb?.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("relay enforces active device quotas and sweeps expired envelopes without request traffic", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "healthlink-relay-device-retention-test-"));
  let app: ReturnType<typeof createRelayApp> | undefined;
  let relayDb: RelayDatabase | undefined;
  try {
    const stateDir = join(tempDir, "state");
    relayDb = openRelayDatabase(join(tempDir, "relay.sqlite"));
    app = createRelayApp(relayDb, {
      retentionMs: 50,
      maxDevicesPerUser: 1,
      maxUploadsPerMinute: 100
    });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    assert.ok(address && typeof address !== "string");
    const relayUrl = `http://127.0.0.1:${(address as AddressInfo).port}`;
    const config = initializeRelayRuntime({
      stateDir,
      relayUrl,
      agentName: "Device Quota Test",
      mode: "self_hosted_relay"
    });
    const first = buildRelayFixtureEnvelope({ config, options: { sequence: 1, createdAt: new Date().toISOString() } });
    const firstPost = await fetch(`${relayUrl}/v1/envelopes`, {
      method: "POST",
      headers: relayDataHeaders(config),
      body: JSON.stringify(first)
    });
    assert.equal(firstPost.ok, true);

    const secondDevice = structuredClone(first);
    secondDevice.envelope_id = "env_second_device_quota";
    secondDevice.device_id = "dev_second_device";
    secondDevice.sequence = 2;
    const secondPost = await fetch(`${relayUrl}/v1/envelopes`, {
      method: "POST",
      headers: relayDataHeaders(config),
      body: JSON.stringify(secondDevice)
    });
    assert.equal(secondPost.status, 429);
    assert.deepEqual(await secondPost.json(), { ok: false, error: "device_quota_exceeded" });

    relayDb.sqlite.prepare(`
      update relay_envelopes
      set received_at = ?
      where envelope_id = ?
    `).run("2026-07-08T00:00:00.000Z", first.envelope_id);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 1100));
    const remaining = relayDb.sqlite.prepare(`
      select count(*) as count
      from relay_envelopes
    `).get() as { count: number };
    assert.equal(remaining.count, 0);
  } finally {
    if (app) {
      await app.close();
    }
    relayDb?.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("relay metrics can require a bearer token without exposing the token in status", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "healthlink-relay-metrics-token-test-"));
  let app: ReturnType<typeof createRelayApp> | undefined;
  let relayDb: RelayDatabase | undefined;
  try {
    relayDb = openRelayDatabase(join(tempDir, "relay.sqlite"));
    app = createRelayApp(relayDb, {
      metricsToken: "test-metrics-token"
    });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    assert.ok(address && typeof address !== "string");
    const relayUrl = `http://127.0.0.1:${(address as AddressInfo).port}`;

    const statusResponse = await fetch(`${relayUrl}/v1/status`);
    const statusText = await statusResponse.text();
    assert.equal(statusResponse.ok, true);
    assert.match(statusText, /"metricsProtected":true/);
    assert.doesNotMatch(statusText, /test-metrics-token/);

    const unauthorized = await fetch(`${relayUrl}/v1/metrics`);
    assert.equal(unauthorized.status, 401);
    assert.deepEqual(await unauthorized.json(), {
      ok: false,
      error: "unauthorized"
    });

    const authorized = await fetch(`${relayUrl}/v1/metrics`, {
      headers: {
        authorization: "Bearer test-metrics-token"
      }
    });
    const metricsText = await authorized.text();
    assert.equal(authorized.ok, true);
    assert.match(metricsText, /queued_envelopes/);
    assert.match(metricsText, /"metricsProtected":true/);
    assert.doesNotMatch(metricsText, /test-metrics-token/);
  } finally {
    if (app) {
      await app.close();
    }
    relayDb?.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("relay data endpoints can require a bearer token without exposing the token in status", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "healthlink-relay-api-token-test-"));
  let app: ReturnType<typeof createRelayApp> | undefined;
  let relayDb: RelayDatabase | undefined;
  try {
    const stateDir = join(tempDir, "state");
    relayDb = openRelayDatabase(join(tempDir, "relay.sqlite"));
    app = createRelayApp(relayDb, {
      apiToken: "test-relay-api-token"
    });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    assert.ok(address && typeof address !== "string");
    const relayUrl = `http://127.0.0.1:${(address as AddressInfo).port}`;
    const config = initializeRelayRuntime({
      stateDir,
      relayUrl,
      relayApiToken: "test-relay-api-token",
      agentName: "Relay API Token Test",
      mode: "self_hosted_relay"
    });
    const envelope = encryptHealthSyncPayload({
      config,
      sequence: 1,
      createdAt: new Date().toISOString(),
      payload: {
        device_id: config.source_device_id,
        sync_id: "sync_relay_api_token_001",
        generated_at: new Date().toISOString(),
        timezone: "Asia/Shanghai",
        health_daily_summaries: []
      }
    });

    const statusResponse = await fetch(`${relayUrl}/v1/status`);
    const statusText = await statusResponse.text();
    assert.equal(statusResponse.ok, true);
    assert.match(statusText, /"apiProtected":true/);
    assert.match(statusText, /"tenantProtected":true/);
    assert.doesNotMatch(statusText, /test-relay-api-token/);
    assert.doesNotMatch(statusText, new RegExp(config.relay_access_token));

    const unauthorizedPost = await fetch(`${relayUrl}/v1/envelopes`, {
      method: "POST",
      headers: relayDataHeaders(config),
      body: JSON.stringify(envelope)
    });
    assert.equal(unauthorizedPost.status, 401);

    const authorizedPost = await fetch(`${relayUrl}/v1/envelopes`, {
      method: "POST",
      headers: relayDataHeaders(config, "test-relay-api-token"),
      body: JSON.stringify(envelope)
    });
    assert.equal(authorizedPost.ok, true);

    const unauthorizedList = await fetch(`${relayUrl}/v1/envelopes?user_id=${encodeURIComponent(config.user_id)}&after=0`);
    assert.equal(unauthorizedList.status, 401);

    const missingTenantList = await fetch(`${relayUrl}/v1/envelopes?user_id=${encodeURIComponent(config.user_id)}&after=0`, {
      headers: {
        "x-healthlink-relay-api-key": "test-relay-api-token"
      }
    });
    assert.equal(missingTenantList.status, 401);

    const healthDbPath = join(tempDir, "healthlink.sqlite");
    const pull = await pullRelayEnvelopes({
      stateDir,
      databasePath: healthDbPath,
      relayUrl
    });
    assert.equal(pull.fetched, 1);
    assert.equal(pull.acked, 1);

    const unauthorizedPurge = await fetch(`${relayUrl}/v1/purge`, {
      method: "POST",
      headers: relayDataHeaders(config),
      body: JSON.stringify({ user_id: config.user_id })
    });
    assert.equal(unauthorizedPurge.status, 401);
  } finally {
    if (app) {
      await app.close();
    }
    relayDb?.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("relay tenant tokens isolate users and lifecycle commands unlink, rotate, and reset safely", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "healthlink-relay-lifecycle-test-"));
  let app: ReturnType<typeof createRelayApp> | undefined;
  let relayDb: RelayDatabase | undefined;
  try {
    const relayApiToken = "lifecycle-gateway-token";
    relayDb = openRelayDatabase(join(tempDir, "relay.sqlite"));
    app = createRelayApp(relayDb, { apiToken: relayApiToken });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    assert.ok(address && typeof address !== "string");
    const relayUrl = `http://127.0.0.1:${(address as AddressInfo).port}`;
    const stateDirA = join(tempDir, "state-a");
    const stateDirB = join(tempDir, "state-b");
    const healthDbPath = join(tempDir, "healthlink.sqlite");
    const configA = initializeRelayRuntime({
      stateDir: stateDirA,
      relayUrl,
      relayApiToken,
      agentName: "Tenant A",
      mode: "self_hosted_relay"
    });
    const configB = initializeRelayRuntime({
      stateDir: stateDirB,
      relayUrl,
      relayApiToken,
      agentName: "Tenant B",
      mode: "self_hosted_relay"
    });
    const healthDatabase = openHealthLinkDatabase({ path: healthDbPath });
    ensureRelaySourceDevice(healthDatabase, configA);
    healthDatabase.close();
    const envelopeA = buildRelayFixtureEnvelope({ config: configA, options: { sequence: 1, createdAt: new Date().toISOString() } });

    const uploadA = await fetch(`${relayUrl}/v1/envelopes`, {
      method: "POST",
      headers: relayDataHeaders(configA, relayApiToken),
      body: JSON.stringify(envelopeA)
    });
    assert.equal(uploadA.ok, true);
    const duplicateA = await fetch(`${relayUrl}/v1/envelopes`, {
      method: "POST",
      headers: relayDataHeaders(configA, relayApiToken),
      body: JSON.stringify(envelopeA)
    });
    assert.equal(duplicateA.ok, true);
    assert.equal((await duplicateA.json() as { duplicate: boolean }).duplicate, true);

    const registerB = await fetch(`${relayUrl}/v1/envelopes?user_id=${encodeURIComponent(configB.user_id)}&after=0`, {
      headers: relayDataHeaders(configB, relayApiToken)
    });
    assert.equal(registerB.ok, true);

    const conflictingEnvelope = structuredClone(envelopeA);
    conflictingEnvelope.user_id = configB.user_id;
    conflictingEnvelope.device_id = configB.source_device_id;
    const crossTenantConflict = await fetch(`${relayUrl}/v1/envelopes`, {
      method: "POST",
      headers: relayDataHeaders(configB, relayApiToken),
      body: JSON.stringify(conflictingEnvelope)
    });
    assert.equal(crossTenantConflict.status, 409);
    assert.deepEqual(await crossTenantConflict.json(), { ok: false, error: "envelope_id_conflict" });

    const crossTenantList = await fetch(`${relayUrl}/v1/envelopes?user_id=${encodeURIComponent(configA.user_id)}&after=0`, {
      headers: relayDataHeaders(configB, relayApiToken)
    });
    assert.equal(crossTenantList.status, 401);

    const crossTenantAck = await fetch(`${relayUrl}/v1/envelopes/${encodeURIComponent(envelopeA.envelope_id)}/ack`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${configB.relay_access_token}`,
        "x-healthlink-relay-api-key": relayApiToken
      }
    });
    assert.equal(crossTenantAck.ok, true);
    assert.deepEqual(await crossTenantAck.json(), { ok: true, acked: false });

    const crossTenantPurge = await fetch(`${relayUrl}/v1/purge`, {
      method: "POST",
      headers: relayDataHeaders(configB, relayApiToken),
      body: JSON.stringify({ user_id: configA.user_id })
    });
    assert.equal(crossTenantPurge.status, 401);

    const storedCredential = relayDb.sqlite.prepare(`
      select access_token_hash as accessTokenHash
      from relay_users
      where user_id = ?
    `).get(configA.user_id) as { accessTokenHash: string };
    assert.notEqual(storedCredential.accessTokenHash, configA.relay_access_token);
    assert.match(storedCredential.accessTokenHash, /^[a-f0-9]{64}$/);

    const unlink = await unlinkRelaySourceDevice({ stateDir: stateDirA, databasePath: healthDbPath });
    assert.equal(unlink.action, "unlink");
    assert.equal(unlink.purged, 1);
    assert.equal(typeof readRelayRuntimeConfig({ stateDir: stateDirA }).source_device_unlinked_at, "string");
    assert.notEqual(readDeviceRevokedAt(healthDbPath, configA.source_device_id), null);
    const rejectedUnlinkedUpload = await fetch(`${relayUrl}/v1/envelopes`, {
      method: "POST",
      headers: relayDataHeaders(configA, relayApiToken),
      body: JSON.stringify(envelopeA)
    });
    assert.equal(rejectedUnlinkedUpload.status, 403);

    const previousEncryptionKeyPath = configA.encryption_private_key_path;
    const previousAccessToken = configA.relay_access_token;
    const rotated = await rotateRelayRuntime({ stateDir: stateDirA, databasePath: healthDbPath });
    assert.equal(rotated.action, "rotate");
    assert.equal(rotated.user_id, configA.user_id);
    assert.equal(rotated.source_device_id, configA.source_device_id);
    assert.notEqual(rotated.config.relay_access_token, previousAccessToken);
    assert.equal(rotated.config.source_device_unlinked_at, undefined);
    assert.equal(existsSync(previousEncryptionKeyPath), false);
    assert.equal(readDeviceRevokedAt(healthDbPath, configA.source_device_id), null);

    const rotatedEnvelope = buildRelayFixtureEnvelope({
      config: rotated.config,
      options: { sequence: 2, createdAt: new Date().toISOString() }
    });
    const rotatedUpload = await fetch(`${relayUrl}/v1/envelopes`, {
      method: "POST",
      headers: relayDataHeaders(rotated.config, relayApiToken),
      body: JSON.stringify(rotatedEnvelope)
    });
    assert.equal(rotatedUpload.ok, true);

    const reset = await resetRelayRuntime({ stateDir: stateDirA, databasePath: healthDbPath });
    assert.equal(reset.action, "reset");
    assert.equal(reset.purged, 1);
    assert.notEqual(reset.user_id, rotated.user_id);
    assert.notEqual(reset.source_device_id, rotated.source_device_id);
    assert.notEqual(readDeviceRevokedAt(healthDbPath, rotated.source_device_id), null);
    const resetHealthDatabase = openHealthLinkDatabase({ path: healthDbPath });
    ensureRelaySourceDevice(resetHealthDatabase, reset.config);
    resetHealthDatabase.close();
    assert.equal(readDeviceRevokedAt(healthDbPath, reset.source_device_id), null);

    const revokedOldIdentity = await fetch(`${relayUrl}/v1/envelopes`, {
      method: "POST",
      headers: relayDataHeaders(rotated.config, relayApiToken),
      body: JSON.stringify(rotatedEnvelope)
    });
    assert.equal(revokedOldIdentity.status, 403);

    const resetEnvelope = buildRelayFixtureEnvelope({
      config: reset.config,
      options: { sequence: 1, createdAt: new Date().toISOString() }
    });
    const resetUpload = await fetch(`${relayUrl}/v1/envelopes`, {
      method: "POST",
      headers: relayDataHeaders(reset.config, relayApiToken),
      body: JSON.stringify(resetEnvelope)
    });
    assert.equal(resetUpload.ok, true);

    let invalidMigrationCalledRelay = false;
    await assert.rejects(
      () => migrateRelayRuntime({
        stateDir: stateDirA,
        databasePath: healthDbPath,
        targetRelayUrl: "http://hosted-relay.example.test",
        targetMode: "hosted_relay",
        fetchImpl: (async () => {
          invalidMigrationCalledRelay = true;
          return new Response("{}", { status: 200 });
        }) as typeof fetch
      }),
      /must use HTTPS/
    );
    assert.equal(invalidMigrationCalledRelay, false);
    assert.equal(readRelayRuntimeConfig({ stateDir: stateDirA }).user_id, reset.user_id);

    const migrated = await migrateRelayRuntime({
      stateDir: stateDirA,
      databasePath: healthDbPath,
      targetRelayUrl: "https://self-hosted-relay.example.test/",
      targetRelayApiToken: "target-deployment-key",
      targetMode: "self_hosted_relay"
    });
    assert.equal(migrated.action, "migrate");
    assert.equal(migrated.purged, 1);
    assert.equal(migrated.config.relay_url, "https://self-hosted-relay.example.test");
    assert.equal(migrated.config.relay_mode, "self_hosted_relay");
    assert.equal(migrated.config.relay_api_token, "target-deployment-key");
    assert.notEqual(migrated.user_id, reset.user_id);
    assert.notEqual(migrated.source_device_id, reset.source_device_id);
    assert.notEqual(readDeviceRevokedAt(healthDbPath, reset.source_device_id), null);

    const revokedMigratedSource = await fetch(`${relayUrl}/v1/envelopes`, {
      method: "POST",
      headers: relayDataHeaders(reset.config, relayApiToken),
      body: JSON.stringify(resetEnvelope)
    });
    assert.equal(revokedMigratedSource.status, 403);
  } finally {
    if (app) {
      await app.close();
    }
    relayDb?.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("relay deployment audit checks aggregate status without sensitive fields", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "healthlink-relay-audit-test-"));
  let app: ReturnType<typeof createRelayApp> | undefined;
  let relayDb: RelayDatabase | undefined;
  try {
    relayDb = openRelayDatabase(join(tempDir, "relay.sqlite"));
    app = createRelayApp(relayDb);
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    assert.ok(address && typeof address !== "string");
    const relayUrl = `http://127.0.0.1:${(address as AddressInfo).port}`;

    const audit = await auditRelayDeployment({ relayUrl });
    assert.equal(audit.ok, true);
    assert.equal(audit.mode, "passive");
    assert.equal(audit.checks.every((check) => check.status === "ok"), true);

    const leakyAudit = await auditRelayDeployment({
      relayUrl,
      fetchImpl: (async (input) => {
        const url = String(input);
        if (url.endsWith("/v1/metrics")) {
          return new Response(JSON.stringify({
            ok: true,
            metrics: {},
            limits: {},
            ciphertext: "leak"
          }), {
            status: 200,
            headers: { "content-type": "application/json" }
          });
        }
        return fetch(input);
      }) as typeof fetch
    });
    assert.equal(leakyAudit.ok, false);
    assert.equal(leakyAudit.checks.some((check) => check.id === "metrics_no_sensitive_fields" && check.status === "fail"), true);

    const unreachableAudit = await auditRelayDeployment({
      relayUrl,
      fetchImpl: (async () => {
        throw new Error("connection refused");
      }) as typeof fetch
    });
    assert.equal(unreachableAudit.ok, false);
    assert.equal(unreachableAudit.checks.some((check) => check.id === "status_http" && check.status === "fail"), true);
    assert.equal(unreachableAudit.checks.some((check) => check.detail.includes("connection refused")), true);
    await assert.rejects(
      () => auditRelayDeployment({ relayUrl: "https://user:secret@relay.example.test" }),
      /must not contain embedded credentials/
    );
  } finally {
    if (app) {
      await app.close();
    }
    relayDb?.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("relay deployment audit supports protected metrics", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "healthlink-relay-protected-audit-test-"));
  let app: ReturnType<typeof createRelayApp> | undefined;
  let relayDb: RelayDatabase | undefined;
  try {
    relayDb = openRelayDatabase(join(tempDir, "relay.sqlite"));
    app = createRelayApp(relayDb, {
      metricsToken: "audit-metrics-token"
    });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    assert.ok(address && typeof address !== "string");
    const relayUrl = `http://127.0.0.1:${(address as AddressInfo).port}`;

    const protectedAudit = await auditRelayDeployment({ relayUrl });
    assert.equal(protectedAudit.ok, true);
    assert.equal(protectedAudit.checks.some((check) => check.id === "metrics_http" && check.detail.includes("access-controlled")), true);

    const authorizedAudit = await auditRelayDeployment({
      relayUrl,
      metricsToken: "audit-metrics-token"
    });
    assert.equal(authorizedAudit.ok, true);
    assert.equal(authorizedAudit.checks.some((check) => check.id === "metrics_shape" && check.detail.includes("required aggregate fields")), true);
  } finally {
    if (app) {
      await app.close();
    }
    relayDb?.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("relay active deployment audit verifies tenant isolation and lifecycle controls", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "healthlink-relay-active-audit-test-"));
  let app: ReturnType<typeof createRelayApp> | undefined;
  let relayDb: RelayDatabase | undefined;
  try {
    relayDb = openRelayDatabase(join(tempDir, "relay.sqlite"));
    app = createRelayApp(relayDb, {
      apiToken: "active-audit-api-token",
      metricsToken: "active-audit-metrics-token"
    });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    assert.ok(address && typeof address !== "string");
    const relayUrl = `http://127.0.0.1:${(address as AddressInfo).port}`;

    const audit = await auditRelayDeployment({
      relayUrl,
      metricsToken: "active-audit-metrics-token",
      relayApiToken: "active-audit-api-token",
      active: true
    });
    assert.equal(audit.ok, true);
    assert.equal(audit.mode, "active");
    assert.equal(audit.checks.every((check) => check.status === "ok"), true);
    for (const checkId of [
      "active_deployment_api_key",
      "active_cross_tenant_list",
      "active_cross_tenant_ack",
      "active_cross_tenant_purge",
      "active_cross_tenant_lifecycle",
      "active_cross_tenant_no_effect",
      "active_own_purge",
      "active_own_unlink",
      "active_unlinked_device_rejected",
      "active_own_rotate",
      "active_old_credential_rejected",
      "active_own_revoke",
      "active_revoked_credential_rejected",
      "active_disposable_identity_cleanup"
    ]) {
      assert.equal(audit.checks.some((check) => check.id === checkId && check.status === "ok"), true);
    }
    assert.doesNotMatch(JSON.stringify(audit), /active-audit-(?:api|metrics)-token/);

    const stored = relayDb.sqlite.prepare(`
      select
        (select count(*) from relay_envelopes) as envelopeCount,
        (select count(*) from relay_users where revoked_at is null) as activeUserCount,
        (select count(*) from relay_users where revoked_at is not null) as revokedUserCount
    `).get() as { envelopeCount: number; activeUserCount: number; revokedUserCount: number };
    assert.deepEqual(stored, {
      envelopeCount: 0,
      activeUserCount: 0,
      revokedUserCount: 2
    });

    const unauthorized = await auditRelayDeployment({
      relayUrl,
      relayApiToken: "wrong-active-audit-api-token",
      active: true
    });
    assert.equal(unauthorized.ok, false);
    assert.equal(unauthorized.checks.some((check) =>
      check.id === "active_upload_tenant_a" && check.status === "fail"), true);
  } finally {
    if (app) {
      await app.close();
    }
    relayDb?.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
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
      assert.deepEqual(entries[0]?.scopes_used, ["health.daily_summary.read"]);
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
        ]
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
        ]
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

      assert.equal(sleep.trend.length, 1);
      assert.equal(sleep.trend[0]?.date, "2026-07-04");
      assert.equal(sleep.trend[0]?.sleep_minutes, 420);
      assert.equal(sleep.trend[0]?.active_energy_kcal, 250);
      assert.equal((sleep.trend[0] as { heart_rate_variability_ms?: number | null }).heart_rate_variability_ms, null);
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

test("WorkBuddy MCP install merges project config idempotently with backups and fails closed", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "healthlink-workbuddy-test-"));
  try {
    const configPath = join(tempDir, "workbuddy.mcp.json");
    const databasePath = join(tempDir, "healthlink.sqlite");
    writeFileSync(configPath, JSON.stringify({
      workspace: { name: "personal" },
      mcpServers: {
        existing: { command: "existing-mcp", args: ["serve"] }
      }
    }, null, 2), "utf8");

    const first = installWorkBuddyMcpConfig({ projectPath: tempDir, databasePath });
    const second = installWorkBuddyMcpConfig({ configPath, databasePath });
    const status = getWorkBuddyMcpInstallStatus({ projectPath: tempDir });
    const installed = JSON.parse(readFileSync(configPath, "utf8")) as {
      workspace: { name: string };
      mcpServers: Record<string, { command: string; args: string[] }>;
    };

    assert.equal(status.installed, true);
    assert.equal(first.configPath, configPath);
    assert.ok(first.backupPath);
    assert.ok(second.backupPath);
    assert.notEqual(first.backupPath, second.backupPath);
    assert.equal(installed.workspace.name, "personal");
    assert.deepEqual(installed.mcpServers.existing.args, ["serve"]);
    assert.deepEqual(installed.mcpServers.healthlink.args.slice(0, 2), ["mcp", "--db"]);
    assert.equal(installed.mcpServers.healthlink.args[2], databasePath);

    const invalidPath = join(tempDir, "invalid-workbuddy.mcp.json");
    const invalid = "{ invalid json";
    writeFileSync(invalidPath, invalid, "utf8");
    assert.throws(
      () => installWorkBuddyMcpConfig({ configPath: invalidPath, databasePath }),
      /WorkBuddy config must be valid JSON/
    );
    assert.equal(readFileSync(invalidPath, "utf8"), invalid);
    assert.equal(readdirSync(tempDir).some((name) => name.startsWith("invalid-workbuddy.mcp.json.healthlink-backup-")), false);
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

    const workbuddy = getAgentAdapter("workbuddy");
    const workbuddyProjectPath = join(tempDir, "workbuddy-project");
    const workbuddyInstalled = workbuddy.installMcp({
      databasePath: join(tempDir, "healthlink.sqlite")
    }, {
      workbuddyProjectPath
    });
    const workbuddyStatus = workbuddy.detect({ workbuddyProjectPath });
    const workbuddyConfig = JSON.parse(workbuddy.formatMcpConfig({
      databasePath: join(tempDir, "healthlink.sqlite")
    })) as {
      mcpServers: { healthlink: { args: string[] } };
    };
    assert.equal(workbuddyInstalled.id, "workbuddy");
    assert.equal(workbuddyStatus.installed, true);
    assert.equal(workbuddyInstalled.configPath, join(workbuddyProjectPath, "workbuddy.mcp.json"));
    assert.deepEqual(workbuddyConfig.mcpServers.healthlink.args.slice(0, 2), ["mcp", "--db"]);
    assert.match(workbuddy.reloadHint(), /Restart WorkBuddy/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("Agent auto-detection prefers installed or available specific adapters before generic MCP", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "healthlink-agent-autodetect-test-"));
  try {
    const hermesConfigPath = join(tempDir, "config.yaml");
    const openclawConfigPath = join(tempDir, "openclaw.json");
    const workbuddyProjectPath = join(tempDir, "workbuddy-project");

    assert.equal(detectPreferredAgentAdapter({
      hermesConfigPath,
      openclawConfigPath,
      workbuddyProjectPath
    }).id, "generic");

    writeFileSync(openclawConfigPath, JSON.stringify({ model: { provider: "test" } }, null, 2), "utf8");
    assert.equal(detectPreferredAgentAdapter({
      hermesConfigPath,
      openclawConfigPath,
      workbuddyProjectPath
    }).id, "openclaw");

    writeFileSync(hermesConfigPath, "model:\n  provider: test\n", "utf8");
    assert.equal(detectPreferredAgentAdapter({
      hermesConfigPath,
      openclawConfigPath,
      workbuddyProjectPath
    }).id, "hermes");

    mkdirSync(workbuddyProjectPath, { recursive: true });
    writeFileSync(join(workbuddyProjectPath, "workbuddy.mcp.json"), JSON.stringify({ mcpServers: {} }, null, 2), "utf8");
    assert.equal(detectPreferredAgentAdapter({
      hermesConfigPath,
      openclawConfigPath,
      workbuddyProjectPath
    }).id, "workbuddy");

    assert.equal(detectPreferredAgentAdapter({
      hermesConfigPath,
      openclawConfigPath,
      workbuddyProjectPath
    }).id, "workbuddy");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("Vital Agent Sync skill can be printed and installed for Hermes", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "healthlink-skill-test-"));
  try {
    const skillPath = join(tempDir, "skills", "health", "vitalmcp-personal-context", "SKILL.md");
    const markdown = buildHealthLinkSkillMarkdown();
    const hermesMarkdown = buildHealthLinkSkillMarkdown({ agent: "hermes" });
    const openclawMarkdown = buildHealthLinkSkillMarkdown({ agent: "openclaw" });
    const workbuddyMarkdown = buildHealthLinkSkillMarkdown({ agent: "workbuddy" });
    assert.match(markdown, /name: vitalmcp-personal-context/);
    assert.match(markdown, /get_personal_context/);
    assert.match(markdown, /vitalmcp setup --transport lan --agent generic/);
    assert.match(hermesMarkdown, /Target agent: Hermes/);
    assert.match(hermesMarkdown, /vitalmcp setup --transport lan --agent hermes/);
    assert.match(hermesMarkdown, /vitalmcp:\/\/sync\?source=hermes&request_id=/);
    assert.doesNotMatch(hermesMarkdown, /## OpenClaw Relay Setup Flow/);
    assert.match(openclawMarkdown, /Target agent: OpenClaw/);
    assert.match(openclawMarkdown, /### Local Preview: LAN By Default/);
    assert.match(openclawMarkdown, /vitalmcp setup --transport lan --agent openclaw/);
    assert.match(openclawMarkdown, /does not require a relay URL, VPS, domain, Vital Agent Sync account, or payment method/);
    assert.match(openclawMarkdown, /### Optional Private Remote Path: Tailscale/);
    assert.match(openclawMarkdown, /install and sign in to Tailscale on both the iPhone and receiver machine/);
    assert.match(openclawMarkdown, /authorized tailnet that includes both devices/);
    assert.match(openclawMarkdown, /vitalmcp setup --transport tailscale --tailscale-name <host\.tailnet\.ts\.net> --agent openclaw/);
    assert.match(openclawMarkdown, /### Relay: Future And Experimental/);
    assert.match(openclawMarkdown, /Hosted Relay is not available, recommended, or required in the Local Preview flow/);
    assert.match(openclawMarkdown, /vitalmcp setup --transport relay --relay-url https:\/\/HOSTED-RELAY --agent openclaw/);
    assert.match(openclawMarkdown, /Never invent a relay domain/);
    assert.match(openclawMarkdown, /npx -y vitalmcp@0\.4\.0 --version/);
    assert.match(openclawMarkdown, /prefix every local CLI invocation below with `npx -y vitalmcp@0\.4\.0`/);
    assert.match(openclawMarkdown, /Do not switch runners midway through setup/);
    assert.match(openclawMarkdown, /setup --resume --yes --output json/);
    assert.match(openclawMarkdown, /next_action\.url/);
    assert.match(openclawMarkdown, /Removing or upgrading it must not remove/);
    assert.match(openclawMarkdown, /Do not use `sudo npm install -g`/);
    assert.doesNotMatch(openclawMarkdown, /^\s*sudo npm install -g/m);
    assert.match(openclawMarkdown, /vitalmcp pull/);
    assert.match(openclawMarkdown, /Daily report:/);
    assert.match(openclawMarkdown, /Weekly report:/);
    assert.match(openclawMarkdown, /latest source generated time/);
    assert.match(openclawMarkdown, /healthlink_status\.relay\.suggested_next_action/);
    assert.match(openclawMarkdown, /Never print, request, summarize, or copy files under `~\/\.healthlink\/secrets`/);
    assert.match(openclawMarkdown, /upload_auth_secret/);
    assert.match(openclawMarkdown, /relay_access_token/);
    assert.match(openclawMarkdown, /vitalmcp relay unlink --yes/);
    assert.match(openclawMarkdown, /vitalmcp relay rotate --yes/);
    assert.match(openclawMarkdown, /vitalmcp relay reset --yes/);
    assert.match(openclawMarkdown, /vitalmcp relay migrate --yes/);
    assert.match(openclawMarkdown, /manual Sync Now plus catch-up when the iOS app is active or returns to the foreground/);
    assert.match(openclawMarkdown, /Never promise scheduled daily or weekly delivery/);
    assert.match(openclawMarkdown, /revoke_source_device/);
    assert.match(workbuddyMarkdown, /# Vital Agent Sync for WorkBuddy/);
    assert.match(workbuddyMarkdown, /Connect private Apple Health context to WorkBuddy/);
    assert.match(workbuddyMarkdown, /Target agent: WorkBuddy/);
    assert.match(workbuddyMarkdown, /--agent workbuddy/);

    const planIndex = openclawMarkdown.indexOf("setup --transport lan");
    const consentIndex = openclawMarkdown.indexOf("obtain explicit approval");
    const resumeIndex = openclawMarkdown.indexOf("setup --resume --yes --output json", consentIndex);
    const onboardingIndex = openclawMarkdown.indexOf("next_action.url", resumeIndex);
    const firstSyncIndex = openclawMarkdown.indexOf("healthlink_status", onboardingIndex);
    const firstAnswerIndex = openclawMarkdown.indexOf("get_personal_context", firstSyncIndex);
    assert.ok(planIndex >= 0 && planIndex < consentIndex);
    assert.ok(consentIndex < resumeIndex && resumeIndex < onboardingIndex);
    assert.ok(onboardingIndex < firstSyncIndex && firstSyncIndex < firstAnswerIndex);

    const first = installHermesHealthLinkSkill({ skillPath });
    const second = installHermesHealthLinkSkill({ skillPath });
    const installed = readInstalledHermesSkill({ skillPath });

    assert.equal(first.skillPath, skillPath);
    assert.ok(second.backupPath);
    assert.match(installed ?? "", /Vital Agent Sync Personal Context/);
    assert.match(installed ?? "", /Target agent: Hermes/);
    assert.match(installed ?? "", /--agent hermes/);
    assert.doesNotMatch(installed ?? "", /## OpenClaw Relay Setup Flow/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("Vital Agent Sync skill can be exported as an OpenClaw package", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "healthlink-openclaw-skill-test-"));
  try {
    const packageDir = join(tempDir, "vitalmcp-personal-context");
    mkdirSync(packageDir, { recursive: true });
    writeFileSync(join(packageDir, "clawhub.json"), "{\"legacy\":true}\n", "utf8");
    const result = exportHealthLinkSkillPackage({
      agent: "openclaw",
      outputDir: packageDir
    });
    const skill = readFileSync(result.skillPath, "utf8");
    const readme = readFileSync(result.readmePath, "utf8");
    const frontmatterMatch = skill.match(/^---\n([\s\S]*?)\n---/);
    assert.ok(frontmatterMatch);
    const frontmatter = YAML.parse(frontmatterMatch[1] ?? "") as {
      name: string;
      version: string;
      license?: string;
      metadata: {
        openclaw: {
          requires: { bins: string[] };
          install: Array<{ kind: string; package: string; bins: string[] }>;
          os: string[];
        };
      };
    };

    assert.equal(result.packageDir, packageDir);
    assert.deepEqual(readdirSync(packageDir).sort(), ["README.md", "SKILL.md"]);
    assert.equal(frontmatter.name, "vitalmcp-personal-context");
    assert.equal(frontmatter.version, "0.4.0");
    assert.equal(frontmatter.license, undefined);
    assert.deepEqual(frontmatter.metadata.openclaw.requires.bins, ["vitalmcp"]);
    assert.deepEqual(frontmatter.metadata.openclaw.install, [{
      kind: "node",
      package: "vitalmcp@0.4.0",
      bins: ["vitalmcp"]
    }]);
    assert.deepEqual(frontmatter.metadata.openclaw.os, ["macos", "linux", "windows"]);
    assert.match(skill, /Target agent: OpenClaw/);
    assert.match(skill, /vitalmcp setup --transport lan --agent openclaw/);
    assert.match(readme, /Before publishing/);
    assert.match(readme, /clawhub skill publish \./);
    assert.match(readme, /--dry-run/);
    assert.match(readme, /openclaw skills install <owner-or-final-slug>/);
    assert.match(readme, /MIT-0/);
    assert.doesNotMatch(skill, /BEGIN PRIVATE KEY/);
    assert.doesNotMatch(readme, /healthlink\.sqlite/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("removing or upgrading a Skill preserves runtime identity, history, and generic MCP", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "healthlink-skill-isolation-test-"));
  try {
    const stateDir = join(tempDir, ".healthlink");
    const databasePath = join(stateDir, "healthlink.sqlite");
    const skillPath = join(tempDir, "agent", "skills", "vitalmcp-personal-context", "SKILL.md");
    const runtime = initializeRelayRuntime({
      stateDir,
      relayUrl: "http://127.0.0.1:8790",
      mode: "self_hosted_relay"
    });
    const database = openHealthLinkDatabase({ path: databasePath });
    database.close();
    const genericMcpBefore = buildHealthLinkMcpServerConfig({ databasePath });

    installHermesHealthLinkSkill({ skillPath });
    installHermesHealthLinkSkill({ skillPath });
    rmSync(dirname(skillPath), { recursive: true, force: true });

    const preserved = readRelayRuntimeConfig({ stateDir });
    const genericMcpAfter = buildHealthLinkMcpServerConfig({ databasePath });
    assert.equal(preserved.user_id, runtime.user_id);
    assert.equal(preserved.source_device_id, runtime.source_device_id);
    assert.equal(preserved.encryption_public_key_x25519, runtime.encryption_public_key_x25519);
    assert.equal(preserved.relay_access_token, runtime.relay_access_token);
    assert.equal(existsSync(databasePath), true);
    assert.deepEqual(genericMcpAfter, genericMcpBefore);
    const reopened = openHealthLinkDatabase({ path: databasePath });
    reopened.close();
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("Transport providers keep LAN default and require secure iOS-compatible Tailscale URLs", async () => {
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
  assert.equal((await tailscale.healthCheck?.())?.status, "ok");

  const tailscaleMagicDns = createTransportProvider({
    id: "tailscale",
    bindHost: "0.0.0.0",
    port: 8787,
    tailscaleName: "healthlink.tailnet.ts.net."
  });
  assert.equal(await tailscaleMagicDns.getAdvertisedUrl(), "https://healthlink.tailnet.ts.net");

  const insecureTailscale = createTransportProvider({
    id: "tailscale",
    bindHost: "0.0.0.0",
    port: 8787,
    serverUrl: "http://100.86.131.13:8787"
  });
  await assert.rejects(() => insecureTailscale.getAdvertisedUrl(), /requires an HTTPS --server-url/);
  assert.equal((await insecureTailscale.healthCheck?.())?.status, "fail");

  const cloudflare = createTransportProvider({
    id: "cloudflare",
    bindHost: "0.0.0.0",
    port: 8787
  });
  await assert.rejects(() => cloudflare.getAdvertisedUrl(), /not implemented/);
});

test("Tailscale transport configures and verifies a private Serve HTTPS route", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "healthlink-tailscale-serve-test-"));
  try {
    const command = join(tempDir, "tailscale");
    const marker = join(tempDir, "configured");
    const log = join(tempDir, "calls.log");
    writeFileSync(command, `#!/bin/sh
printf '%s\\n' "$*" >> '${log}'
if [ "$1" = "status" ]; then
  printf '%s\\n' '{"BackendState":"Running","Self":{"DNSName":"healthlink.tailnet.ts.net."}}'
  exit 0
fi
if [ "$1" = "serve" ] && [ "$2" = "status" ]; then
  if [ -f '${marker}' ]; then
    printf '%s\\n' '{"TCP":{"443":{"HTTPS":true}},"Web":{"healthlink.tailnet.ts.net:443":{"Handlers":{"/":{"Proxy":"http://127.0.0.1:8787"}}}}}'
  else
    printf '%s\\n' '{}'
  fi
  exit 0
fi
touch '${marker}'
`, "utf8");
    chmodSync(command, 0o755);

    const mismatched = createTransportProvider({
      id: "tailscale",
      bindHost: "0.0.0.0",
      port: 8787,
      tailscaleName: "another.tailnet.ts.net",
      tailscaleCommand: command
    });
    await assert.rejects(() => mismatched.start?.(), /does not match this node's MagicDNS name/);
    assert.equal(existsSync(marker), false);

    const tailscale = createTransportProvider({
      id: "tailscale",
      bindHost: "0.0.0.0",
      port: 8787,
      tailscaleCommand: command
    });
    assert.equal((await tailscale.healthCheck?.())?.status, "fail");
    await tailscale.start?.();
    assert.equal(await tailscale.getAdvertisedUrl(), "https://healthlink.tailnet.ts.net");
    const health = await tailscale.healthCheck?.();
    assert.equal(health?.status, "ok");
    assert.match(health?.detail ?? "", /private Tailscale Serve HTTPS/);
    assert.match(readFileSync(log, "utf8"), /serve --bg --yes --https=443 http:\/\/127\.0\.0\.1:8787/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("Tailscale Serve inspection refuses conflicting or public routes", () => {
  const conflict = inspectTailscaleServeConfig(JSON.stringify({
    TCP: { "443": { HTTPS: true } },
    Web: { "healthlink.tailnet.ts.net:443": { Handlers: { "/": { Proxy: "http://127.0.0.1:9999" } } } }
  }), "healthlink.tailnet.ts.net", "http://127.0.0.1:8787");
  assert.equal(conflict.status, "conflict");
  assert.match(conflict.detail, /will not overwrite/);

  const funnel = inspectTailscaleServeConfig(JSON.stringify({
    TCP: { "443": { HTTPS: true } },
    Web: { "healthlink.tailnet.ts.net:443": { Handlers: { "/": { Proxy: "http://127.0.0.1:8787" } } } },
    AllowFunnel: { "healthlink.tailnet.ts.net:443": true }
  }), "healthlink.tailnet.ts.net", "http://127.0.0.1:8787");
  assert.equal(funnel.status, "public");
  assert.match(funnel.detail, /will not overwrite or advertise a public route/);
});

test("iOS ATS remains narrow while Tailscale onboarding uses trusted HTTPS", () => {
  const infoPlist = readFileSync(resolve(packageRoot, "..", "..", "App", "Info.plist"), "utf8");
  const projectYaml = readFileSync(resolve(packageRoot, "..", "..", "project.yml"), "utf8");
  for (const source of [infoPlist, projectYaml]) {
    assert.match(source, /NSAllowsLocalNetworking/);
    assert.doesNotMatch(source, /NSAllowsArbitraryLoads/);
    assert.doesNotMatch(source, /NSExceptionDomains/);
  }
});

test("LAN advertised host prefers SSH server address and default-route source before interface scan", () => {
  assert.equal(
    parseSshConnectionLocalAddress("192.168.31.230 62100 192.168.31.53 22"),
    "192.168.31.53"
  );
  assert.equal(parseSshConnectionLocalAddress("192.168.31.230 62100 127.0.0.1 22"), undefined);
  assert.equal(parseLinuxRouteSource("1.1.1.1 via 192.168.31.1 dev eth0 src 192.168.31.53 uid 1000"), "192.168.31.53");

  assert.equal(selectLanAdvertisedHost({
    bindHost: "0.0.0.0",
    sshConnection: "192.168.31.230 62100 192.168.31.53 22",
    routeHost: "10.0.0.12",
    interfaces: {
      docker0: [{
        address: "172.17.0.1",
        netmask: "255.255.0.0",
        family: "IPv4",
        mac: "00:00:00:00:00:00",
        internal: false,
        cidr: "172.17.0.1/16"
      }],
      eth0: [{
        address: "10.0.0.12",
        netmask: "255.255.255.0",
        family: "IPv4",
        mac: "00:00:00:00:00:00",
        internal: false,
        cidr: "10.0.0.12/24"
      }]
    }
  }), "192.168.31.53");

  assert.equal(selectLanAdvertisedHost({
    bindHost: "0.0.0.0",
    routeHost: "10.0.0.12",
    interfaces: {}
  }), "10.0.0.12");
});

test("LAN advertised host scores physical LAN addresses above Docker and Tailscale interfaces", () => {
  assert.equal(selectLanAdvertisedHost({
    bindHost: "0.0.0.0",
    interfaces: {
      docker0: [{
        address: "172.17.0.1",
        netmask: "255.255.0.0",
        family: "IPv4",
        mac: "00:00:00:00:00:00",
        internal: false,
        cidr: "172.17.0.1/16"
      }],
      tailscale0: [{
        address: "100.86.131.13",
        netmask: "255.255.255.255",
        family: "IPv4",
        mac: "00:00:00:00:00:00",
        internal: false,
        cidr: "100.86.131.13/32"
      }],
      en0: [{
        address: "192.168.31.53",
        netmask: "255.255.255.0",
        family: "IPv4",
        mac: "00:00:00:00:00:00",
        internal: false,
        cidr: "192.168.31.53/24"
      }]
    }
  }), "192.168.31.53");

  assert.equal(selectLanAdvertisedHost({
    bindHost: "127.0.0.1",
    interfaces: {}
  }), "127.0.0.1");
});

test("Docker Compose output uses persistent SQLite volume and explicit server URL", () => {
  const yaml = buildDockerComposeYaml({
    serverUrl: "http://192.168.31.53:8787",
    port: 8787
  });

  assert.match(yaml, /8787:8787/);
  assert.match(yaml, /\.\/healthlink-data:\/data/);
  assert.match(yaml, /HEALTHLINK_DB: \/data\/healthlink\.sqlite/);
  assert.match(yaml, /HEALTHLINK_SERVER_URL: "http:\/\/192\.168\.31\.53:8787"/);
  assert.match(yaml, /image: node:22-bookworm-slim/);
  assert.match(yaml, /npx -y vitalmcp daemon/);
});

test("relay Docker Compose output runs the self-hosted relay with persistent storage", () => {
  const yaml = buildRelayDockerComposeYaml({
    port: 8790
  });

  assert.match(yaml, /healthlink-relay:/);
  assert.match(yaml, /8790:8790/);
  assert.match(yaml, /\.\/healthlink-relay-data:\/data/);
  assert.match(yaml, /HEALTHLINK_RELAY_DB: \/data\/relay\.sqlite/);
  assert.match(yaml, /HEALTHLINK_RELAY_API_TOKEN: ""/);
  assert.match(yaml, /HEALTHLINK_RELAY_MAX_DEVICES_PER_USER: "5"/);
  assert.match(yaml, /HEALTHLINK_RELAY_TRUST_PROXY: "false"/);
  assert.match(yaml, /HEALTHLINK_RELAY_METRICS_TOKEN: ""/);
  assert.match(yaml, /npx -y vitalmcp relay serve/);
});

test("relay deployment artifacts build a bounded relay service", () => {
  const dockerignore = readFileSync(resolve(packageRoot, "..", "..", ".dockerignore"), "utf8");
  const gitignore = readFileSync(resolve(packageRoot, "..", "..", ".gitignore"), "utf8");
  const dockerfile = readFileSync(resolve(packageRoot, "..", "..", "deploy", "relay", "Dockerfile"), "utf8");
  const compose = readFileSync(resolve(packageRoot, "..", "..", "deploy", "relay", "docker-compose.yml"), "utf8");
  const productionComposeText = readFileSync(resolve(packageRoot, "..", "..", "deploy", "relay", "docker-compose.production.yml"), "utf8");
  const productionCompose = YAML.parse(productionComposeText) as {
    services: Record<string, {
      ports?: string[];
      expose?: string[];
      environment?: Record<string, string>;
      read_only?: boolean;
      user?: string;
      cap_drop?: string[];
    }>;
  };
  const caddyfile = readFileSync(resolve(packageRoot, "..", "..", "deploy", "relay", "Caddyfile"), "utf8");
  const productionEnv = readFileSync(resolve(packageRoot, "..", "..", "deploy", "relay", ".env.production.example"), "utf8");

  assert.match(dockerfile, /CMD \["node", "packages\/local\/dist\/cli\.js", "relay", "serve"\]/);
  assert.match(dockerfile, /HEALTHLINK_RELAY_RETENTION_DAYS=30/);
  assert.match(dockerfile, /HEALTHLINK_RELAY_MAX_ENVELOPE_BYTES=524288/);
  assert.match(dockerfile, /HEALTHLINK_RELAY_MAX_UPLOADS_PER_MINUTE=120/);
  assert.match(dockerfile, /HEALTHLINK_RELAY_MAX_QUEUED_ENVELOPES_PER_USER=1000/);
  assert.match(dockerfile, /HEALTHLINK_RELAY_MAX_DEVICES_PER_USER=5/);
  assert.match(dockerfile, /COPY tsconfig\.base\.json \.\//);
  assert.match(dockerfile, /npm prune --omit=dev --workspace vitalmcp/);
  assert.match(dockerfile, /COPY --from=build \/app\/node_modules node_modules/);
  assert.doesNotMatch(dockerfile, /^ENV HEALTHLINK_RELAY_(?:API|METRICS)_TOKEN=/m);
  assert.match(dockerfile, /HEALTHLINK_RELAY_TRUST_PROXY=false/);
  assert.match(dockerfile, /^USER node$/m);
  const runtimeStage = dockerfile.slice(dockerfile.lastIndexOf("FROM node:22-bookworm-slim"));
  assert.doesNotMatch(runtimeStage, /apt-get|python3|make g\+\+/);
  assert.match(compose, /dockerfile: deploy\/relay\/Dockerfile/);
  assert.match(compose, /healthlink-relay-data:\/data/);
  assert.match(compose, /HEALTHLINK_RELAY_DB: \/data\/relay\.sqlite/);
  assert.match(compose, /HEALTHLINK_RELAY_API_TOKEN: ""/);
  assert.match(compose, /HEALTHLINK_RELAY_MAX_DEVICES_PER_USER: "5"/);
  assert.match(compose, /HEALTHLINK_RELAY_METRICS_TOKEN: ""/);
  assert.match(compose, /HEALTHLINK_RELAY_TRUST_PROXY: "false"/);
  assert.match(dockerignore, /^\.git$/m);
  assert.match(dockerignore, /^\*\*\/node_modules$/m);
  assert.match(dockerignore, /^\*\*\/\*\.sqlite$/m);
  assert.match(dockerignore, /^\*\*\/\.env\.\*$/m);
  assert.match(dockerignore, /^\*\*\/healthlink-relay-data$/m);
  assert.match(gitignore, /^\*\*\/\.env\.\*$/m);
  assert.match(gitignore, /^!\*\*\/\.env\.\*\.example$/m);

  const productionRelay = productionCompose.services["healthlink-relay"]!;
  const productionCaddy = productionCompose.services.caddy!;
  assert.equal(productionRelay.ports, undefined);
  assert.deepEqual(productionRelay.expose, ["8790"]);
  assert.equal(productionRelay.environment?.HEALTHLINK_RELAY_TRUST_PROXY, "true");
  assert.match(productionRelay.environment?.HEALTHLINK_RELAY_API_TOKEN ?? "", /\?Set a random deployment API token/);
  assert.match(productionRelay.environment?.HEALTHLINK_RELAY_METRICS_TOKEN ?? "", /\?Set a separate random metrics token/);
  assert.equal(productionRelay.read_only, true);
  assert.deepEqual(productionRelay.cap_drop, ["ALL"]);
  assert.deepEqual(productionCaddy.ports, ["80:80", "443:443", "443:443/udp"]);
  assert.equal(productionCaddy.read_only, true);
  assert.match(productionComposeText, /caddy:2\.11\.4-alpine/);
  assert.match(caddyfile, /^\{\$HEALTHLINK_RELAY_DOMAIN\} \{/m);
  assert.match(caddyfile, /max_size 512KiB/);
  assert.match(caddyfile, /reverse_proxy healthlink-relay:8790/);
  assert.doesNotMatch(caddyfile, /^\s*log\s*\{/m);
  assert.match(productionEnv, /HEALTHLINK_RELAY_API_TOKEN=replace-with-a-random-32-byte-value/);
  assert.match(productionEnv, /HEALTHLINK_RELAY_METRICS_TOKEN=replace-with-a-different-random-32-byte-value/);
});

test("relay serve config reads deployment environment with CLI override precedence", () => {
  const defaults = {
    host: "0.0.0.0",
    hostProvided: false,
    port: 8787,
    portProvided: false,
    databasePathProvided: false,
    relayRetentionDays: 30,
    relayRetentionDaysProvided: false,
    relayMaxEnvelopeBytes: 512 * 1024,
    relayMaxEnvelopeBytesProvided: false,
    relayMaxUploadsPerMinute: 120,
    relayMaxUploadsPerMinuteProvided: false,
    relayMaxQueuedEnvelopesPerUser: 1000,
    relayMaxQueuedEnvelopesPerUserProvided: false,
    relayMaxDevicesPerUser: 5,
    relayMaxDevicesPerUserProvided: false,
    relayTrustProxy: false,
    relayTrustProxyProvided: false,
    relayApiTokenProvided: false,
    relayMetricsTokenProvided: false
  };
  const env = {
    HEALTHLINK_RELAY_HOST: "127.0.0.1",
    HEALTHLINK_RELAY_PORT: "9191",
    HEALTHLINK_RELAY_DB: "/tmp/relay-env.sqlite",
    HEALTHLINK_RELAY_RETENTION_DAYS: "7",
    HEALTHLINK_RELAY_MAX_ENVELOPE_BYTES: "123456",
    HEALTHLINK_RELAY_MAX_UPLOADS_PER_MINUTE: "44",
    HEALTHLINK_RELAY_MAX_QUEUED_ENVELOPES_PER_USER: "55",
    HEALTHLINK_RELAY_MAX_DEVICES_PER_USER: "3",
    HEALTHLINK_RELAY_TRUST_PROXY: "true",
    HEALTHLINK_RELAY_API_TOKEN: "env-api-token",
    HEALTHLINK_RELAY_METRICS_TOKEN: "env-metrics-token"
  };

  const fromEnv = resolveRelayServeConfig(defaults, env);
  assert.deepEqual(fromEnv, {
    host: "127.0.0.1",
    port: 9191,
    databasePath: "/tmp/relay-env.sqlite",
    retentionDays: 7,
    maxEnvelopeBytes: 123456,
    maxUploadsPerMinute: 44,
    maxQueuedEnvelopesPerUser: 55,
    maxDevicesPerUser: 3,
    trustProxy: true,
    apiToken: "env-api-token",
    metricsToken: "env-metrics-token"
  });

  const fromCli = resolveRelayServeConfig({
    ...defaults,
    host: "192.168.1.10",
    hostProvided: true,
    port: 9292,
    portProvided: true,
    databasePath: "/tmp/relay-cli.sqlite",
    databasePathProvided: true,
    relayRetentionDays: 14,
    relayRetentionDaysProvided: true,
    relayMaxEnvelopeBytes: 654321,
    relayMaxEnvelopeBytesProvided: true,
    relayMaxUploadsPerMinute: 66,
    relayMaxUploadsPerMinuteProvided: true,
    relayMaxQueuedEnvelopesPerUser: 77,
    relayMaxQueuedEnvelopesPerUserProvided: true,
    relayMaxDevicesPerUser: 2,
    relayMaxDevicesPerUserProvided: true,
    relayTrustProxy: false,
    relayTrustProxyProvided: true,
    relayApiToken: "cli-api-token",
    relayApiTokenProvided: true,
    relayMetricsToken: "cli-metrics-token",
    relayMetricsTokenProvided: true
  }, env);
  assert.deepEqual(fromCli, {
    host: "192.168.1.10",
    port: 9292,
    databasePath: "/tmp/relay-cli.sqlite",
    retentionDays: 14,
    maxEnvelopeBytes: 654321,
    maxUploadsPerMinute: 66,
    maxQueuedEnvelopesPerUser: 77,
    maxDevicesPerUser: 2,
    trustProxy: false,
    apiToken: "cli-api-token",
    metricsToken: "cli-metrics-token"
  });

  const explicitDefaults = resolveRelayServeConfig({
    ...defaults,
    host: "0.0.0.0",
    hostProvided: true,
    relayRetentionDays: 30,
    relayRetentionDaysProvided: true
  }, env);
  assert.equal(explicitDefaults.host, "0.0.0.0");
  assert.equal(explicitDefaults.retentionDays, 30);

  assert.throws(
    () => resolveRelayServeConfig(defaults, {
      HEALTHLINK_RELAY_PORT: "not-a-port"
    }),
    /HEALTHLINK_RELAY_PORT must be a positive integer/
  );
  assert.throws(
    () => resolveRelayServeConfig(defaults, {
      HEALTHLINK_RELAY_TRUST_PROXY: "sometimes"
    }),
    /HEALTHLINK_RELAY_TRUST_PROXY must be true, false, 1, or 0/
  );
});

test("server URL diagnostics warn for loopback and container deployment URLs", () => {
  const loopback = getServerUrlDiagnostics({
    serverUrl: "http://127.0.0.1:8787"
  });
  assert.equal(loopback[0]?.status, "warn");
  assert.match(loopback[0]?.detail ?? "", /only works from the same machine/);

  const lan = getServerUrlDiagnostics({
    serverUrl: "http://192.168.31.53:8787"
  });
  assert.equal(lan.length, 0);

  const container = getServerUrlDiagnostics({
    serverUrl: "http://192.168.31.53:8787",
    runningInContainer: true
  });
  assert.equal(container[0]?.status, "warn");
  assert.match(container[0]?.detail ?? "", /Docker host address/);
});

test("launchd service plist uses daemon command and expected keepalive settings", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "healthlink-service-test-"));
  try {
    const plist = buildLaunchdPlist({
      homeDir: tempDir,
      cliCommand: "/tmp/vitalmcp",
      databasePath: join(tempDir, "healthlink.sqlite"),
      host: "0.0.0.0",
      port: 8787,
      transport: "lan"
    });

    assert.match(plist, /<string>com\.vitalmcp\.local<\/string>/);
    assert.match(plist, /<string>\/tmp\/vitalmcp<\/string>/);
    assert.match(plist, /<string>daemon<\/string>/);
    assert.match(plist, /<string>--host<\/string>/);
    assert.match(plist, /<string>0\.0\.0\.0<\/string>/);
    assert.match(plist, /<string>--port<\/string>/);
    assert.match(plist, /<string>8787<\/string>/);
    assert.match(plist, /<string>--db<\/string>/);
    assert.match(plist, new RegExp(`<string>${escapeRegExp(join(tempDir, "healthlink.sqlite"))}</string>`));
    assert.match(plist, /<string>--transport<\/string>/);
    assert.match(plist, /<string>lan<\/string>/);
    assert.match(plist, /daemon\.out\.log/);
    assert.match(plist, /daemon\.err\.log/);
    assert.match(plist, /<key>RunAtLoad<\/key>\s*<true\/>/);
    assert.match(plist, /<key>KeepAlive<\/key>\s*<true\/>/);

    const status = installLaunchdService({
      platform: "darwin",
      homeDir: tempDir,
      cliCommand: "/tmp/vitalmcp",
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
    assert.equal(typeof status.running, "boolean");
    assert.equal(status.plistPath, paths.plistPath);
    assert.match(readLaunchdPlist({ homeDir: tempDir }) ?? "", /daemon\.out\.log/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("relay pull service units run periodic pull without receiver ports", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "healthlink-relay-pull-service-test-"));
  try {
    const databasePath = join(tempDir, "healthlink.sqlite");
    const stateDir = join(tempDir, "state");
    const options = {
      homeDir: tempDir,
      cliCommand: "/tmp/vitalmcp",
      mode: "relay_pull" as const,
      databasePath,
      stateDir,
      host: "0.0.0.0",
      port: 8787,
      transport: "relay" as const,
      relayUrl: "https://relay.example.test",
      pullIntervalSeconds: 120
    };
    const args = buildRelayPullProgramArguments(options, databasePath);
    const plist = buildLaunchdPlist(options);
    const unit = buildSystemdUnit(options);
    const launchdPaths = getLaunchdServicePaths({
      homeDir: tempDir,
      databasePath,
      mode: "relay_pull"
    });
    const systemdPaths = getSystemdServicePaths({
      homeDir: tempDir,
      databasePath,
      mode: "relay_pull"
    });

    assert.deepEqual(args, [
      "/tmp/vitalmcp",
      "pull",
      "--watch",
      "--interval-seconds",
      "120",
      "--db",
      databasePath,
      "--state-dir",
      stateDir,
      "--relay-url",
      "https://relay.example.test"
    ]);
    assert.match(plist, /<string>com\.vitalmcp\.local\.relay-pull<\/string>/);
    assert.match(plist, /<string>pull<\/string>/);
    assert.match(plist, /relay-pull\.out\.log/);
    assert.match(unit, /Description=Vital Agent Sync Relay Puller/);
    assert.match(unit, /ExecStart=\/tmp\/vitalmcp pull --watch --interval-seconds 120 --db /);
    assert.match(systemdPaths.configPath, /vitalmcp-relay-pull\.service$/);
    assert.match(launchdPaths.stdoutPath, /relay-pull\.out\.log$/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("systemd service unit uses daemon command and restart policy", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "healthlink-systemd-test-"));
  try {
    const databasePath = join(tempDir, "healthlink.sqlite");
    const unit = buildSystemdUnit({
      homeDir: tempDir,
      cliCommand: "/tmp/vitalmcp",
      databasePath,
      host: "0.0.0.0",
      port: 8787,
      transport: "tailscale",
      tailscaleName: "healthlink.tailnet.ts.net"
    });
    const paths = getSystemdServicePaths({
      homeDir: tempDir,
      databasePath
    });

    assert.equal(paths.manager, "systemd");
    assert.match(paths.configPath, /vitalmcp\.service$/);
    assert.match(unit, /\[Unit\]/);
    assert.match(unit, /Description=Vital Agent Sync Local Receiver/);
    assert.match(unit, /ExecStart=\/tmp\/vitalmcp daemon --host 0\.0\.0\.0 --port 8787 --db /);
    assert.match(unit, /--transport tailscale --tailscale-name healthlink\.tailnet\.ts\.net/);
    assert.match(unit, /Restart=on-failure/);
    assert.match(unit, /WantedBy=default\.target/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("service manager selection distinguishes macOS, Linux, Windows, and overrides", () => {
  assert.equal(resolveServiceManagerId({ platform: "darwin" }), "launchd");
  assert.equal(resolveServiceManagerId({ platform: "linux" }), "systemd");
  assert.equal(resolveServiceManagerId({ platform: "win32" }), "manual");
  assert.equal(resolveServiceManagerId({ manager: "systemd", platform: "darwin" }), "systemd");

  const windowsStatus = getManualServiceStatus({
    platform: "win32",
    homeDir: "/tmp/healthlink-win"
  });
  assert.equal(windowsStatus.manager, "manual");
  assert.match(windowsStatus.detail ?? "", /Windows background service installation is not implemented yet/);
});

test("port diagnostics parse lsof listener output", () => {
  const listeners = parseLsofListenOutput([
    "COMMAND   PID    USER   FD   TYPE             DEVICE SIZE/OFF NODE NAME",
    "node    91165 coooder   22u  IPv4 0x123456789      0t0  TCP *:8787 (LISTEN)",
    "launchd     1    root   10u  IPv6 0x987654321      0t0  TCP [::1]:8787 (LISTEN)"
  ].join("\n"));

  assert.deepEqual(listeners, [
    {
      command: "node",
      pid: "91165",
      user: "coooder",
      name: "*:8787 (LISTEN)"
    },
    {
      command: "launchd",
      pid: "1",
      user: "root",
      name: "[::1]:8787 (LISTEN)"
    }
  ]);
});

test("port diagnostics find the next available TCP port", async () => {
  const occupied = await findAvailableTcpPort({
    preferredPort: 30000,
    host: "127.0.0.1",
    maxAttempts: 200
  });
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen({
      host: "127.0.0.1",
      port: occupied.port
    }, resolve);
  });

  try {
    const available = await findAvailableTcpPort({
      preferredPort: occupied.port,
      host: "127.0.0.1",
      maxAttempts: 20
    });

    assert.equal(available.requestedPort, occupied.port);
    assert.ok(available.port > occupied.port);
    assert.equal(available.changed, true);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("launchd service log reader tails stdout and stderr logs", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "healthlink-service-log-test-"));
  try {
    const paths = getLaunchdServicePaths({ homeDir: tempDir });
    const missing = readLaunchdServiceLog({
      homeDir: tempDir,
      stream: "stderr",
      lines: 2
    });
    assert.equal(missing.exists, false);
    assert.equal(missing.path, paths.stderrPath);

    installLaunchdService({
      platform: "darwin",
      homeDir: tempDir,
      cliCommand: "/tmp/vitalmcp",
      databasePath: join(tempDir, "healthlink.sqlite"),
      host: "0.0.0.0",
      port: 8787,
      transport: "lan"
    });
    writeFileSync(paths.stdoutPath, "one\ntwo\nthree\n", "utf8");
    writeFileSync(paths.stderrPath, "alpha\nbeta\ngamma\n", "utf8");

    const stdout = readLaunchdServiceLog({
      homeDir: tempDir,
      stream: "stdout",
      lines: 2
    });
    const stderr = readLaunchdServiceLog({
      homeDir: tempDir,
      stream: "stderr",
      lines: 1
    });

    assert.equal(stdout.exists, true);
    assert.equal(stdout.content, "two\nthree");
    assert.equal(stderr.content, "gamma");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("local package manifest is ready for public npm packing", () => {
  const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as {
    name?: string;
    version?: string;
    private?: boolean;
    license?: string;
    bin?: Record<string, string>;
    files?: string[];
    publishConfig?: { access?: string };
    scripts?: Record<string, string>;
  };

  assert.equal(manifest.name, "vitalmcp");
  assert.equal(manifest.version, "0.4.0");
  assert.equal(manifest.private, undefined);
  assert.equal(manifest.license, "MIT");
  assert.equal(manifest.bin?.["vitalmcp"], "./dist/cli.js");
  assert.deepEqual(manifest.files, ["dist", "README.md"]);
  assert.equal(manifest.publishConfig?.access, "public");
  assert.equal(manifest.scripts?.prepack, "npm run build");
  assert.equal(manifest.scripts?.["pack:check"], "npm pack --dry-run");
  assert.equal(manifest.scripts?.["relay:fixture-flow"], "tsx src/relay-fixture-flow.ts");
});

test("root package exposes repeatable relay release audit gates", () => {
  const repositoryRoot = resolve(packageRoot, "..", "..");
  const manifest = JSON.parse(readFileSync(join(repositoryRoot, "package.json"), "utf8")) as {
    scripts?: Record<string, string>;
  };
  const auditScript = readFileSync(join(repositoryRoot, "scripts", "e2ee-relay-local-audit.mjs"), "utf8");
  const containerAuditScript = readFileSync(
    join(repositoryRoot, "scripts", "e2ee-relay-container-audit.mjs"),
    "utf8"
  );
  const packageAuditScript = readFileSync(
    join(repositoryRoot, "scripts", "e2ee-relay-package-audit.mjs"),
    "utf8"
  );
  const agentAdapterAuditScript = readFileSync(
    join(repositoryRoot, "scripts", "agent-adapter-audit.mjs"),
    "utf8"
  );
  const hostedAuditScript = readFileSync(
    join(repositoryRoot, "scripts", "e2ee-relay-hosted-audit.mjs"),
    "utf8"
  );
  const productionPreflightScript = readFileSync(
    join(repositoryRoot, "scripts", "e2ee-relay-production-preflight.mjs"),
    "utf8"
  );
  const npmReleasePreflightScript = readFileSync(
    join(repositoryRoot, "scripts", "npm-release-preflight.mjs"),
    "utf8"
  );
  const releaseSecretScanScript = readFileSync(
    join(repositoryRoot, "scripts", "release-secret-scan.mjs"),
    "utf8"
  );

  assert.equal(manifest.scripts?.["audit:relay-local"], "node scripts/e2ee-relay-local-audit.mjs");
  assert.equal(
    manifest.scripts?.["audit:relay-container"],
    "node scripts/e2ee-relay-container-audit.mjs"
  );
  assert.equal(
    manifest.scripts?.["audit:relay-package"],
    "node scripts/e2ee-relay-package-audit.mjs"
  );
  assert.equal(
    manifest.scripts?.["audit:agent-adapters"],
    "node scripts/agent-adapter-audit.mjs"
  );
  assert.equal(
    manifest.scripts?.["audit:dependencies"],
    "npm audit --omit=dev --workspace vitalmcp"
  );
  assert.equal(
    manifest.scripts?.["audit:secrets"],
    "node scripts/release-secret-scan.mjs"
  );
  assert.equal(
    manifest.scripts?.["audit:relay-hosted"],
    "node scripts/e2ee-relay-hosted-audit.mjs"
  );
  assert.equal(
    manifest.scripts?.["preflight:relay-production"],
    "node scripts/e2ee-relay-production-preflight.mjs"
  );
  assert.equal(
    manifest.scripts?.["release:npm-preflight"],
    "node scripts/npm-release-preflight.mjs"
  );
  assert.match(auditScript, /vitalmcp typecheck/);
  assert.match(auditScript, /compiled relay fixture flow/);
  assert.match(auditScript, /compiled CLI version/);
  assert.match(auditScript, /Swift source parse/);
  assert.match(auditScript, /iOS SDK full source typecheck/);
  assert.match(auditScript, /Swift relay crypto typecheck/);
  assert.match(auditScript, /e2ee-relay-ios-interop\.mjs/);
  assert.match(auditScript, /readdirSync\(join\(root, "App"\)\)/);
  assert.match(auditScript, /relay audit CLI/);
  assert.match(auditScript, /HEALTHLINK_RELAY_PORT/);
  assert.match(auditScript, /HEALTHLINK_RELAY_DB/);
  assert.match(auditScript, /HEALTHLINK_RELAY_MAX_QUEUED_ENVELOPES_PER_USER/);
  assert.match(auditScript, /HEALTHLINK_RELAY_MAX_DEVICES_PER_USER/);
  assert.match(auditScript, /HEALTHLINK_RELAY_API_TOKEN|fixture-flow-relay-api-token/);
  assert.match(auditScript, /HEALTHLINK_RELAY_METRICS_TOKEN/);
  assert.match(auditScript, /--metrics-token/);
  assert.match(auditScript, /compiled hosted setup fail-closed/);
  assert.match(auditScript, /HEALTHLINK_HOSTED_RELAY_URL/);
  assert.match(auditScript, /config\.json/);
  assert.match(auditScript, /compiled CLI argument validation/);
  assert.match(auditScript, /Unknown option/);
  assert.match(auditScript, /requires a value/);
  assert.match(auditScript, /compiled onboarding saved-mode inheritance/);
  assert.match(auditScript, /details\?\.relay_mode/);
  assert.match(containerAuditScript, /Docker daemon is unavailable/);
  assert.match(containerAuditScript, /--project-name/);
  assert.match(containerAuditScript, /--read-only/);
  assert.match(containerAuditScript, /--cap-drop/);
  assert.match(containerAuditScript, /no-new-privileges:true/);
  assert.match(containerAuditScript, /--active/);
  assert.match(containerAuditScript, /relay_envelopes/);
  assert.match(containerAuditScript, /forbiddenLogPatterns/);
  assert.match(containerAuditScript, /down/);
  assert.match(containerAuditScript, /--volumes/);
  assert.match(containerAuditScript, /SIGINT/);
  assert.match(packageAuditScript, /npm_config_cache/);
  assert.match(packageAuditScript, /--pack-destination/);
  assert.match(packageAuditScript, /--global/);
  assert.match(packageAuditScript, /pinned npx-compatible cold invocation/);
  assert.match(packageAuditScript, /"exec"/);
  assert.match(packageAuditScript, /"--package"/);
  assert.match(packageAuditScript, /self-hosted-relay/);
  assert.match(packageAuditScript, /fixture_uploaded/);
  assert.match(packageAuditScript, /--active/);
  assert.match(packageAuditScript, /export-skill/);
  assert.match(packageAuditScript, /openclaw-skill/);
  assert.match(packageAuditScript, /Package audit install still running/);
  assert.match(packageAuditScript, /timeoutMs: 5 \* 60_000/);
  assert.match(packageAuditScript, /npm_config_fetch_timeout/);
  assert.match(packageAuditScript, /let installProcess/);
  assert.match(packageAuditScript, /child\.kill\("SIGTERM"\)/);
  assert.match(packageAuditScript, /rmSync\(tempDir/);
  assert.match(agentAdapterAuditScript, /HEALTHLINK_HERMES_BIN/);
  assert.match(agentAdapterAuditScript, /HERMES_HOME/);
  assert.match(agentAdapterAuditScript, /Generic MCP discovered/);
  assert.match(agentAdapterAuditScript, /mcp", "test", "healthlink/);
  assert.match(agentAdapterAuditScript, /Tools discovered: 12/);
  assert.match(agentAdapterAuditScript, /rmSync\(tempDir/);
  assert.match(hostedAuditScript, /HEALTHLINK_HOSTED_RELAY_URL/);
  assert.match(hostedAuditScript, /HEALTHLINK_RELAY_API_TOKEN/);
  assert.match(hostedAuditScript, /HEALTHLINK_RELAY_METRICS_TOKEN/);
  assert.match(hostedAuditScript, /protocol !== "https:"/);
  assert.match(hostedAuditScript, /--active", "--yes"/);
  assert.doesNotMatch(hostedAuditScript, /--relay-api-token/);
  assert.doesNotMatch(hostedAuditScript, /--metrics-token/);
  assert.match(productionPreflightScript, /config",\s*"--format",\s*"json"/);
  assert.match(productionPreflightScript, /relayApiToken === metricsToken/);
  assert.match(productionPreflightScript, /service\.read_only === true/);
  assert.match(productionPreflightScript, /service\.cap_drop/);
  assert.match(productionPreflightScript, /no-new-privileges:true/);
  assert.match(productionPreflightScript, /secrets_printed: false/);
  assert.match(productionPreflightScript, /replaceAll\(relayApiToken/);
  assert.match(npmReleasePreflightScript, /publish_executed: false/);
  assert.match(npmReleasePreflightScript, /VITALMCP_NPM_RELEASE_ALLOW_DIRTY/);
  assert.match(npmReleasePreflightScript, /first_publish: true/);
  assert.match(npmReleasePreflightScript, /\\bE404\\b/);
  assert.match(npmReleasePreflightScript, /:\(exclude\)docs\/website-media-plan\.md/);
  assert.match(npmReleasePreflightScript, /npm", \["run", "audit:secrets"\]/);
  assert.match(npmReleasePreflightScript, /npm", \["whoami"\]/);
  assert.match(npmReleasePreflightScript, /npm", \["view", value\.name, "version"\]/);
  assert.doesNotMatch(npmReleasePreflightScript, /npm", \["publish"/);
  assert.match(releaseSecretScanScript, /git", \[\s*"ls-files"/);
  assert.match(releaseSecretScanScript, /private-key-pem/);
  assert.match(releaseSecretScanScript, /healthlink-secret-literal/);
  assert.match(releaseSecretScanScript, /sensitive_values_printed: false/);
  assert.match(releaseSecretScanScript, /runSelfTest\(\)/);
  assert.match(releaseSecretScanScript, /:\(exclude\)apps\/www/);
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
        pairing_url: "vitalmcp://pair?server=http%3A%2F%2F127.0.0.1%3A8787&code=ABCD-1234",
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

test("portable installer uses a user prefix and manages its PATH block idempotently", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "healthlink-installer-"));
  try {
    const home = join(tempDir, "home");
    const fakeBin = join(tempDir, "bin");
    const prefix = join(home, ".vitalmcp", "npm-global");
    const profile = join(home, ".profile");
    const npmLog = join(tempDir, "npm.log");
    const installScript = resolve(packageRoot, "..", "..", "install.sh");
    const websiteInstallScript = resolve(packageRoot, "..", "..", "apps", "www", "public", "install.sh");
    mkdirSync(fakeBin, { recursive: true });
    mkdirSync(join(home, ".healthlink"), { recursive: true });
    writeFileSync(join(home, ".healthlink", "preserve-me"), "local history", "utf8");
    writeFileSync(join(fakeBin, "node"), "#!/bin/sh\nprintf '24\\n'\n", "utf8");
    writeFileSync(join(fakeBin, "npm"), "#!/bin/sh\nprintf '%s\\n' \"$*\" >> \"$TEST_NPM_LOG\"\n", "utf8");
    writeFileSync(join(fakeBin, "uname"), "#!/bin/sh\nprintf 'Linux\\n'\n", "utf8");
    chmodSync(join(fakeBin, "node"), 0o755);
    chmodSync(join(fakeBin, "npm"), 0o755);
    chmodSync(join(fakeBin, "uname"), 0o755);
    const env = {
      ...process.env,
      HOME: home,
      SHELL: "/bin/sh",
      PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
      VITALMCP_PROFILE: profile,
      VITALMCP_INSTALL_PREFIX: prefix,
      WSL_DISTRO_NAME: "HealthLinkTestWSL",
      TEST_NPM_LOG: npmLog
    };

    let lastStdout = "";
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const result = spawnSync("sh", [installScript, "--version", "0.4.0"], { env, encoding: "utf8" });
      assert.equal(result.status, 0, result.stderr);
      lastStdout = result.stdout;
    }
    assert.match(lastStdout, /Platform:\s+wsl/);
    const installedProfile = readFileSync(profile, "utf8");
    assert.equal((installedProfile.match(/# >>> vitalmcp >>>/g) ?? []).length, 1);
    assert.match(installedProfile, new RegExp(escapeRegExp(`export PATH="${prefix}/bin:$PATH"`)));
    assert.match(readFileSync(npmLog, "utf8"), /install --global --prefix .*vitalmcp@0\.4\.0/);
    assert.equal(readFileSync(websiteInstallScript, "utf8"), readFileSync(installScript, "utf8"));

    const uninstall = spawnSync("sh", [installScript, "--uninstall"], { env, encoding: "utf8" });
    assert.equal(uninstall.status, 0, uninstall.stderr);
    assert.doesNotMatch(readFileSync(profile, "utf8"), /vitalmcp/);
    assert.equal(readFileSync(join(home, ".healthlink", "preserve-me"), "utf8"), "local history");
    assert.match(readFileSync(npmLog, "utf8"), /uninstall --global --prefix .*vitalmcp/);

    const malformedProfile = "user setting before\n# >>> vitalmcp >>>\nunrelated user setting after\n";
    writeFileSync(profile, malformedProfile, "utf8");
    const malformedUninstall = spawnSync("sh", [installScript, "--uninstall"], { env, encoding: "utf8" });
    assert.equal(malformedUninstall.status, 0, malformedUninstall.stderr);
    assert.equal(readFileSync(profile, "utf8"), malformedProfile);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("portable installer selects macOS, Linux, and WSL shell profiles without a system prefix", () => {
  const rootTemp = mkdtempSync(join(tmpdir(), "healthlink-installer-platforms-"));
  try {
    const installScript = resolve(packageRoot, "..", "..", "install.sh");
    const cases = [
      { name: "macos-zsh", uname: "Darwin", shell: "/bin/zsh", wsl: undefined, profile: ".zshrc", platform: "macos" },
      { name: "linux-bash", uname: "Linux", shell: "/bin/bash", wsl: undefined, profile: ".bashrc", platform: "linux" },
      { name: "wsl-bash", uname: "Linux", shell: "/bin/bash", wsl: "Ubuntu", profile: ".bashrc", platform: "wsl" }
    ];
    for (const testCase of cases) {
      const tempDir = join(rootTemp, testCase.name);
      const home = join(tempDir, "home");
      const fakeBin = join(tempDir, "bin");
      const npmLog = join(tempDir, "npm.log");
      mkdirSync(fakeBin, { recursive: true });
      mkdirSync(home, { recursive: true });
      writeFileSync(join(fakeBin, "node"), "#!/bin/sh\nprintf '24\\n'\n", "utf8");
      writeFileSync(join(fakeBin, "npm"), "#!/bin/sh\nprintf '%s\\n' \"$*\" >> \"$TEST_NPM_LOG\"\n", "utf8");
      writeFileSync(join(fakeBin, "uname"), `#!/bin/sh\nprintf '${testCase.uname}\\n'\n`, "utf8");
      for (const file of ["node", "npm", "uname"]) chmodSync(join(fakeBin, file), 0o755);
      const env = {
        ...process.env,
        HOME: home,
        SHELL: testCase.shell,
        PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
        VITALMCP_PROFILE: undefined,
        VITALMCP_INSTALL_PREFIX: undefined,
        WSL_DISTRO_NAME: testCase.wsl,
        npm_config_prefix: "/root/non-writable-system-prefix",
        TEST_NPM_LOG: npmLog
      };
      const result = spawnSync("sh", [installScript], { env, encoding: "utf8" });
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, new RegExp(`Platform:\\s+${testCase.platform}`));
      assert.equal(existsSync(join(home, testCase.profile)), true);
      const expectedPrefix = join(home, ".vitalmcp", "npm-global");
      assert.match(readFileSync(npmLog, "utf8"), new RegExp(escapeRegExp(`--prefix ${expectedPrefix}`)));
      assert.doesNotMatch(readFileSync(npmLog, "utf8"), /non-writable-system-prefix/);
    }
  } finally {
    rmSync(rootTemp, { recursive: true, force: true });
  }
});

test("CLI doctor reports the verified iOS-compatible Tailscale HTTPS endpoint", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "healthlink-cli-tailscale-doctor-"));
  try {
    const fakeBin = join(tempDir, "bin");
    mkdirSync(fakeBin, { recursive: true });
    const tailscale = join(fakeBin, "tailscale");
    writeFileSync(tailscale, `#!/bin/sh
if [ "$1" = "status" ]; then
  printf '%s\\n' '{"BackendState":"Running","Self":{"DNSName":"healthlink.tailnet.ts.net."}}'
  exit 0
fi
if [ "$1" = "serve" ] && [ "$2" = "status" ]; then
  printf '%s\\n' '{"TCP":{"443":{"HTTPS":true}},"Web":{"healthlink.tailnet.ts.net:443":{"Handlers":{"/":{"Proxy":"http://127.0.0.1:8787"}}}}}'
  exit 0
fi
exit 1
`, "utf8");
    chmodSync(tailscale, 0o755);
    const cliPath = join(packageRoot, "src", "cli.ts");
    const result = spawnSync(process.execPath, [
      "--import", "tsx", cliPath,
      "doctor",
      "--transport", "tailscale",
      "--tailscale-name", "healthlink.tailnet.ts.net",
      "--manager", "manual",
      "--db", join(tempDir, "healthlink.sqlite"),
      "--output", "json"
    ], {
      env: { ...process.env, HOME: tempDir, PATH: `${fakeBin}:${process.env.PATH ?? ""}` },
      encoding: "utf8"
    });
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout) as {
      status: string;
      details: { checks: Array<{ status: string; label: string; detail: string }> };
    };
    const transport = output.details.checks.find((check) => check.label === "Tailscale transport");
    assert.equal(output.status, "complete");
    assert.equal(transport?.status, "OK");
    assert.match(transport?.detail ?? "", /https:\/\/healthlink\.tailnet\.ts\.net/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("CLI setup emits one redacted JSON document for plan and resumable failure", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "healthlink-cli-bootstrap-"));
  try {
    const cliPath = join(packageRoot, "src", "cli.ts");
    const stateDir = join(tempDir, "state");
    const databasePath = join(tempDir, "healthlink.sqlite");
    const commonArgs = [
      "--import", "tsx", cliPath,
      "--state-dir", stateDir,
      "--db", databasePath
    ];
    const env = { ...process.env, HOME: tempDir };
    const emptyStateDir = join(tempDir, "empty-state");
    const missingOnboarding = spawnSync(process.execPath, [
      "--import", "tsx", cliPath,
      "print-onboarding",
      "--state-dir", emptyStateDir,
      "--transport", "self-hosted-relay",
      "--format", "qr",
      "--output", "json"
    ], { env, encoding: "utf8" });
    assert.equal(missingOnboarding.status, 1);
    const missingOutput = JSON.parse(missingOnboarding.stdout) as { status: string; error: { code: string } };
    assert.equal(missingOutput.status, "failed");
    assert.equal(typeof missingOutput.error.code, "string");
    assert.equal(missingOnboarding.stderr, "");
    assert.equal(existsSync(join(emptyStateDir, "config.json")), false);

    const plan = spawnSync(process.execPath, [
      ...commonArgs,
      "setup",
      "--agent", "generic",
      "--transport", "self-hosted-relay",
      "--relay-url", "http://127.0.0.1:8790",
      "--manager", "manual",
      "--output", "json"
    ], { env, encoding: "utf8" });
    assert.equal(plan.status, 0, plan.stderr);
    const planOutput = JSON.parse(plan.stdout) as { status: string; schema_version: number; next_action: { type: string } };
    assert.equal(planOutput.schema_version, 1);
    assert.equal(planOutput.status, "awaiting_consent");
    assert.equal(planOutput.next_action.type, "confirm");
    assert.equal(existsSync(databasePath), false);
    assert.equal(existsSync(join(stateDir, "config.json")), false);

    const resume = spawnSync(process.execPath, [
      ...commonArgs,
      "setup", "--resume", "--yes", "--output", "json"
    ], { env, encoding: "utf8" });
    assert.equal(resume.status, 1);
    const resumeOutput = JSON.parse(resume.stdout) as { status: string; error: { code: string; message: string } };
    assert.equal(resumeOutput.status, "failed");
    assert.equal(typeof resumeOutput.error.code, "string");
    assert.doesNotMatch(resume.stdout, /relay_access_token|upload_auth_secret|BEGIN PRIVATE KEY|healthlink-e2ee-v1:/);
    assert.equal(resume.stderr, "");

    for (const commandArgs of [
      ["status", "--output", "json"],
      ["doctor", "--transport", "self-hosted-relay", "--manager", "manual", "--output", "json"],
      ["print-onboarding", "--format", "qr", "--output", "json"]
    ]) {
      const result = spawnSync(process.execPath, [...commonArgs, ...commandArgs], { env, encoding: "utf8" });
      assert.doesNotMatch(result.stdout, /relay_access_token|upload_auth_secret|relay_api_token|BEGIN PRIVATE KEY|healthlink-e2ee-v1:/);
      assert.doesNotThrow(() => JSON.parse(result.stdout), `${commandArgs[0]} must emit one JSON document`);
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("CLI setup persists the WorkBuddy project path before consent", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "healthlink-cli-workbuddy-"));
  try {
    const cliPath = join(packageRoot, "src", "cli.ts");
    const stateDir = join(tempDir, "state");
    const projectPath = join(tempDir, "workbuddy-project");
    const result = spawnSync(process.execPath, [
      "--import", "tsx", cliPath,
      "setup",
      "--agent", "workbuddy",
      "--workbuddy-project", projectPath,
      "--transport", "lan",
      "--manager", "manual",
      "--state-dir", stateDir,
      "--db", join(tempDir, "healthlink.sqlite"),
      "--output", "json"
    ], {
      env: { ...process.env, HOME: tempDir },
      encoding: "utf8"
    });

    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout) as { status: string; next_action: { type: string } };
    assert.equal(output.status, "awaiting_consent");
    assert.equal(output.next_action.type, "confirm");
    const state = readBootstrapState({ stateDir });
    assert.equal(state?.config.agent_id, "workbuddy");
    assert.equal(state?.config.workbuddy_project_path, projectPath);
    assert.equal(state?.config.workbuddy_config_path, undefined);
    assert.equal(existsSync(join(projectPath, "workbuddy.mcp.json")), false);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
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

test("service ensure workflow installs missing service, starts it, waits, then prints status", async () => {
  const calls: string[] = [];
  let installed = false;
  let running = false;

  await runServiceEnsureWorkflow({
    getStatus: () => {
      calls.push(`status:${installed ? "installed" : "missing"}:${running ? "running" : "stopped"}`);
      return {
        installed,
        running
      };
    },
    installService: () => {
      calls.push("install-service");
      installed = true;
    },
    startService: () => {
      calls.push("start-service");
      running = true;
    },
    waitForReady: async () => {
      calls.push("wait-ready");
    },
    printStatus: () => {
      calls.push("print-status");
    }
  });

  assert.deepEqual(calls, [
    "status:missing:stopped",
    "install-service",
    "status:installed:stopped",
    "start-service",
    "wait-ready",
    "print-status"
  ]);
});

test("bootstrap plan and state are versioned, private, resumable, and idempotent", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "healthlink-bootstrap-"));
  try {
    const config = {
      agent_id: "openclaw" as const,
      transport_id: "relay" as const,
      service_manager: "manual" as const,
      service_mode: "relay_pull" as const,
      host: "0.0.0.0",
      port: 8787,
      pull_interval_seconds: 300,
      install_skill: false,
      state_dir: tempDir,
      relay_url: "https://relay.example.com"
    };
    const plan = buildBootstrapPlan(config);
    assert.equal(plan.length, 5);
    assert.equal(plan.some((item) => item.id === "configure_agent" && item.persistent_change), true);

    let state = createBootstrapState(config, new Date("2026-07-12T00:00:00.000Z"));
    state = writeBootstrapState(state, { stateDir: tempDir });
    assert.equal(readBootstrapState({ stateDir: tempDir })?.setup_id, state.setup_id);
    const statePath = join(tempDir, "setup", "state-v1.json");
    if (process.platform !== "win32") {
      assert.equal(statSync(statePath).mode & 0o777, 0o600);
      assert.equal(statSync(dirname(statePath)).mode & 0o777, 0o700);
    }

    state = markBootstrapStage(state, "consent_received", { status: "running", stateDir: tempDir });
    state = markBootstrapStage(state, "consent_received", { status: "running", stateDir: tempDir });
    assert.equal(state.completed_stages.filter((stage) => stage === "consent_received").length, 1);
    assert.equal(bootstrapStageComplete(state, "consent_received"), true);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("bootstrap workflow resumes safely after every mutating stage", async () => {
  const stages = ["runtime_initialized", "agent_configured", "service_installed", "service_started", "onboarding_created"] as const;
  for (const failingStage of stages) {
    const tempDir = mkdtempSync(join(tmpdir(), `healthlink-bootstrap-${failingStage}-`));
    try {
      const state = writeBootstrapState(createBootstrapState({
        agent_id: "generic",
        transport_id: "relay",
        service_manager: "manual",
        service_mode: "relay_pull",
        host: "0.0.0.0",
        port: 8787,
        pull_interval_seconds: 300,
        install_skill: false,
        state_dir: tempDir,
        relay_url: "https://relay.example.com"
      }), { stateDir: tempDir });
      const calls = new Map<string, number>();
      let shouldFail = true;
      const call = (stage: string) => {
        calls.set(stage, (calls.get(stage) ?? 0) + 1);
        if (stage === failingStage && shouldFail) {
          shouldFail = false;
          throw new Error(`fixture interruption at ${stage}`);
        }
      };
      const actions = {
        runtime_initialized: () => call("runtime_initialized"),
        agent_configured: () => call("agent_configured"),
        service_installed: () => call("service_installed"),
        service_started: () => call("service_started"),
        onboarding_created: () => {
          call("onboarding_created");
          return { onboarding_url: "file:///tmp/healthlink-onboarding-fixture.html" };
        },
        first_sync_observed: () => true
      };

      await assert.rejects(() => runBootstrapWorkflow(state, actions, { stateDir: tempDir }), /fixture interruption/);
      const interrupted = readBootstrapState({ stateDir: tempDir });
      assert.ok(interrupted);
      assert.equal(interrupted.completed_stages.includes(failingStage), false);
      const completed = await runBootstrapWorkflow(interrupted, actions, { stateDir: tempDir });
      assert.equal(completed.status, "complete");
      assert.equal(completed.completed_stages.includes("first_sync_observed"), true);

      const failingIndex = stages.indexOf(failingStage);
      for (let index = 0; index < failingIndex; index += 1) {
        assert.equal(calls.get(stages[index] ?? ""), 1, `${stages[index]} should not repeat after resume`);
      }
      assert.equal(calls.get(failingStage), 2);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }
});

test("bootstrap waits for first sync without repeating completed setup actions", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "healthlink-bootstrap-first-sync-"));
  try {
    const state = writeBootstrapState(createBootstrapState({
      agent_id: "generic",
      transport_id: "lan",
      service_manager: "manual",
      service_mode: "receiver",
      host: "0.0.0.0",
      port: 8787,
      pull_interval_seconds: 300,
      install_skill: false,
      state_dir: tempDir
    }), { stateDir: tempDir });
    const baselineState = writeBootstrapState({ ...state, initial_sync_count: 4 }, { stateDir: tempDir });
    let mutations = 0;
    let syncCount = 4;
    const actions = {
      runtime_initialized: () => { mutations += 1; },
      agent_configured: () => { mutations += 1; },
      service_installed: () => { mutations += 1; },
      service_started: () => { mutations += 1; },
      onboarding_created: () => {
        mutations += 1;
        return { onboarding_url: "http://127.0.0.1:8787/pair" };
      },
      first_sync_observed: () => syncCount > (baselineState.initial_sync_count ?? 0)
    };
    const waiting = await runBootstrapWorkflow(baselineState, actions, { stateDir: tempDir });
    assert.equal(waiting.status, "awaiting_first_sync");
    assert.equal(mutations, 5);
    syncCount = 5;
    const complete = await runBootstrapWorkflow(waiting, actions, { stateDir: tempDir });
    assert.equal(complete.status, "complete");
    assert.equal(mutations, 5);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("bootstrap lock rejects concurrent setup and recovers after release", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "healthlink-bootstrap-lock-"));
  try {
    await withBootstrapLock({ stateDir: tempDir }, async () => {
      await assert.rejects(
        () => withBootstrapLock({ stateDir: tempDir }, async () => undefined),
        /already running/
      );
    });
    await withBootstrapLock({ stateDir: tempDir }, async () => undefined);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("Agent output redaction removes secret fields and credential-bearing onboarding values", () => {
  const sanitized = sanitizeAgentOutput({
    status: "failed",
    relay_access_token: "fixture-secret-token-123456789",
    nested: {
      message: "healthlink://onboard?payload=fixture-sensitive-payload",
      safe: "https://relay.example.com"
    }
  });
  const serialized = JSON.stringify(sanitized);
  assert.doesNotMatch(serialized, /fixture-secret-token/);
  assert.doesNotMatch(serialized, /fixture-sensitive-payload/);
  assert.match(serialized, /\[REDACTED\]/);
  assert.match(serialized, /https:\/\/relay\.example\.com/);
});

test("relay onboarding artifact keeps credentials in a private local file", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "healthlink-onboarding-artifact-"));
  try {
    const config = initializeRelayRuntime({
      stateDir: tempDir,
      relayUrl: "http://127.0.0.1:8790",
      mode: "self_hosted_relay"
    });
    const artifact = await writeRelayOnboardingArtifact({ config, stateDir: tempDir });
    assert.equal(artifact.local_url.startsWith("file://"), true);
    assert.equal(artifact.contains_credentials, true);
    const html = readFileSync(artifact.local_path, "utf8");
    assert.match(html, /Connect Vital Agent/);
    assert.match(html, /Do not share or upload/);
    assert.match(html, /Vital Agent Sync onboarding QR code/);
    assert.doesNotMatch(html, />Open Vital Agent Sync</);
    assert.doesNotMatch(html, /<textarea/);
    assert.doesNotMatch(JSON.stringify(artifact), new RegExp(escapeRegExp(config.relay_access_token)));
    if (process.platform !== "win32") {
      assert.equal(statSync(artifact.local_path).mode & 0o777, 0o600);
    }

    const deepLinkArtifact = await writeRelayOnboardingArtifact({ config, stateDir: tempDir, format: "deeplink" });
    const deepLinkHtml = readFileSync(deepLinkArtifact.local_path, "utf8");
    assert.match(deepLinkHtml, />Open Vital Agent Sync</);
    assert.doesNotMatch(deepLinkHtml, /Vital Agent Sync onboarding QR code/);
    assert.doesNotMatch(deepLinkHtml, /<textarea/);

    const textArtifact = await writeRelayOnboardingArtifact({ config, stateDir: tempDir, format: "text" });
    const textHtml = readFileSync(textArtifact.local_path, "utf8");
    assert.match(textHtml, /<textarea/);
    assert.match(textHtml, /healthlink-e2ee-v1:/);
    assert.doesNotMatch(textHtml, />Open Vital Agent Sync</);
    assert.doesNotMatch(textHtml, /Vital Agent Sync onboarding QR code/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("Source platform capability metadata includes future app surfaces", () => {
  assert.deepEqual(Object.keys(SOURCE_PLATFORM_CAPABILITIES).sort(), [
    "android",
    "ios",
    "manual_import",
    "xiaomi"
  ]);
  assert.equal(SOURCE_PLATFORM_CAPABILITIES.ios.metrics.includes("health.daily_summary"), true);
  assert.equal(SOURCE_PLATFORM_CAPABILITIES.android.syncCadence, "background_best_effort");
});

test("terminal QR renders visible Unicode blocks without ANSI backgrounds", () => {
  const result = renderTerminalQr("vitalmcp://pair?server=http%3A%2F%2F192.168.31.230%3A8787&code=468P-RAL8", {
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
  const result = renderTerminalQr("vitalmcp://pair?server=http%3A%2F%2F192.168.31.230%3A8787&code=468P-RAL8", {
    columns: 24
  });

  assert.equal(result.rendered, false);
  if (!result.rendered) {
    assert.equal(result.requiredColumns > 24, true);
  }
});

function buildLegacyRelayEnvelope(
  config: ReturnType<typeof initializeRelayRuntime>,
  payload: ReturnType<typeof buildRelayFixturePayload>,
  algorithm: "x25519-chacha20poly1305-hmac-sha256" | "x25519-chacha20poly1305-ed25519"
): ReturnType<typeof encryptHealthSyncPayload> {
  const ephemeral = generateKeyPairSync("x25519");
  const sharedSecret = diffieHellman({
    privateKey: ephemeral.privateKey,
    publicKey: createPublicKey(config.encryption_public_key_pem)
  });
  const key = createHash("sha256")
    .update("healthlink-e2ee-v1 envelope")
    .update(sharedSecret)
    .digest();
  const nonce = randomBytes(12);
  const cipher = createCipheriv("chacha20-poly1305", key, nonce, { authTagLength: 16 });
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.from(canonicalJson(payload), "utf8")),
    cipher.final()
  ]);
  const unsigned: ReturnType<typeof encryptHealthSyncPayload> = {
    protocol: "healthlink-e2ee-v1",
    user_id: config.user_id,
    device_id: config.source_device_id,
    envelope_id: `env_legacy_${algorithm.endsWith("ed25519") ? "ed25519" : "hmac"}`,
    sequence: 7,
    payload_type: "health.sync",
    created_at: new Date().toISOString(),
    content_encoding: "canonical-json",
    crypto: {
      alg: algorithm,
      sender_public_key: ephemeral.publicKey.export({ type: "spki", format: "pem" }).toString(),
      nonce: nonce.toString("base64url"),
      tag: cipher.getAuthTag().toString("base64url"),
      ciphertext: ciphertext.toString("base64url"),
      signature: ""
    }
  };
  const signedBytes = Buffer.from(canonicalJson(unsigned), "utf8");
  const signature = algorithm === "x25519-chacha20poly1305-hmac-sha256"
    ? createHmac("sha256", Buffer.from(config.upload_auth_secret, "base64url"))
        .update(signedBytes)
        .digest("base64url")
    : sign(
        null,
        signedBytes,
        createPrivateKey(readFileSync(config.signing_private_key_path, "utf8"))
      ).toString("base64url");
  return {
    ...unsigned,
    crypto: {
      ...unsigned.crypto,
      signature
    }
  };
}

function withTempDatabase(callback: (databasePath: string) => void): void {
  const tempDir = mkdtempSync(join(tmpdir(), "healthlink-test-"));
  try {
    callback(join(tempDir, "healthlink.sqlite"));
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function tamperBase64UrlBytes(value: string): string {
  const bytes = Buffer.from(value, "base64url");
  bytes[bytes.length - 1] = (bytes[bytes.length - 1] ?? 0) ^ 1;
  return bytes.toString("base64url");
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}
