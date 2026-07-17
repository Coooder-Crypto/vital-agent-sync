import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  decryptHealthSyncEnvelope
} from "../packages/local/dist/relay-crypto.js";
import {
  buildRelayOnboardingPayload,
  initializeRelayRuntime
} from "../packages/local/dist/relay-runtime.js";
import { healthSyncPayloadSchema } from "../packages/local/dist/schemas.js";

const root = resolve(import.meta.dirname, "..");
const tempDir = mkdtempSync(join(tmpdir(), "vital-agent-sync-ios-relay-interop-"));

try {
  const stateDir = join(tempDir, "state");
  const config = initializeRelayRuntime({
    stateDir,
    relayUrl: "https://relay.example.test",
    agentName: "iOS interop fixture"
  });
  const onboardingPath = join(tempDir, "onboarding.json");
  const payloadPath = join(tempDir, "payload.json");
  const executablePath = join(tempDir, "ios-relay-crypto-fixture");
  const moduleCachePath = join(tempDir, "swift-module-cache");
  const payload = {
    device_id: config.source_device_id,
    sync_id: "sync_ios_crypto_interop_001",
    generated_at: new Date().toISOString(),
    timezone: "Asia/Shanghai",
    health_daily_summaries: [
      {
        date: "2026-07-10",
        timezone: "Asia/Shanghai",
        provider: "apple_health",
        steps: 8123,
        sleep_minutes: 427,
        active_energy_kcal: 536.5,
        workouts: []
      }
    ]
  };
  writeFileSync(onboardingPath, JSON.stringify(buildRelayOnboardingPayload(config)), "utf8");
  writeFileSync(payloadPath, JSON.stringify(payload), "utf8");

  run("swiftc", [
    "-module-cache-path",
    moduleCachePath,
    join(root, "apps", "ios", "App", "Models.swift"),
    join(root, "scripts", "ios-relay-crypto-fixture.swift"),
    "-o",
    executablePath
  ]);
  const swift = run(executablePath, [onboardingPath, payloadPath], true);
  const envelope = JSON.parse(swift.stdout);
  const decrypted = decryptHealthSyncEnvelope({
    config,
    envelope,
    validation: {
      expectedDeviceId: config.source_device_id
    }
  });
  const validated = healthSyncPayloadSchema.parse(decrypted);

  assert.equal(envelope.crypto.alg, "x25519-hkdf-sha256-chacha20poly1305-hmac-sha256");
  assert.equal(envelope.sequence, 1_750_000_000_001);
  assert.equal(validated.sync_id, payload.sync_id);
  assert.equal(validated.health_daily_summaries[0]?.steps, 8123);
  assert.equal(validated.health_daily_summaries[0]?.sleep_minutes, 427);
  console.log(JSON.stringify({
    ok: true,
    algorithm: envelope.crypto.alg,
    sync_id: validated.sync_id,
    steps: validated.health_daily_summaries[0]?.steps
  }, null, 2));
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

function run(command, args, capture = false) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: capture ? "utf8" : undefined,
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit"
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    if (capture && result.stderr) {
      process.stderr.write(result.stderr);
    }
    process.exit(result.status ?? 1);
  }
  return result;
}
