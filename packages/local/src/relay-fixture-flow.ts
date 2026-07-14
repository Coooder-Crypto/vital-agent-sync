import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openHealthLinkDatabase } from "./database.js";
import { getDailyHealthSummary } from "./health-query.js";
import { buildRelayFixtureEnvelope } from "./relay-fixture.js";
import { pullRelayEnvelopes } from "./relay-pull.js";
import { initializeRelayRuntime } from "./relay-runtime.js";
import { createRelayApp, openRelayDatabase, type RelayDatabase } from "./relay-server.js";

async function main(): Promise<void> {
  const tempDir = mkdtempSync(join(tmpdir(), "healthlink-relay-flow-"));
  let app: ReturnType<typeof createRelayApp> | undefined;
  let relayDb: RelayDatabase | undefined;
  try {
    const stateDir = join(tempDir, "state");
    const healthDbPath = join(tempDir, "healthlink.sqlite");
    const relayApiToken = "fixture-flow-relay-api-token";
    relayDb = openRelayDatabase(join(tempDir, "relay.sqlite"));
    app = createRelayApp(relayDb, {
      apiToken: relayApiToken
    });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    assert.ok(address && typeof address !== "string");
    const relayUrl = `http://127.0.0.1:${(address as AddressInfo).port}`;
    const config = initializeRelayRuntime({
      stateDir,
      relayUrl,
      relayApiToken,
      agentName: "Vital Agent Sync Fixture Flow",
      mode: "self_hosted_relay"
    });
    const envelope = buildRelayFixtureEnvelope({
      config,
      options: {
        date: "2026-07-08",
        steps: 7777,
        sleepMinutes: 420,
        activeEnergyKcal: 520,
        sequence: 1,
        generatedAt: "2026-07-08T08:00:00+08:00",
        createdAt: new Date().toISOString(),
        timezone: "Asia/Shanghai"
      }
    });
    const post = await fetch(`${relayUrl}/v1/envelopes`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.relay_access_token}`,
        "x-healthlink-relay-api-key": relayApiToken
      },
      body: JSON.stringify(envelope)
    });
    if (!post.ok) {
      throw new Error(`Fixture upload failed with HTTP ${post.status}: ${await post.text()}`);
    }
    const pull = await pullRelayEnvelopes({
      stateDir,
      databasePath: healthDbPath,
      relayUrl,
      relayApiToken
    });
    const database = openHealthLinkDatabase({ path: healthDbPath });
    const previousStateDir = process.env.HEALTHLINK_STATE_DIR;
    process.env.HEALTHLINK_STATE_DIR = stateDir;
    try {
      const summary = getDailyHealthSummary(database, { date: "2026-07-08" });
      console.log(JSON.stringify({
        ok: true,
        relay_url: relayUrl,
        state_dir: stateDir,
        database: healthDbPath,
        envelope_id: envelope.envelope_id,
        pull,
        summary
      }, null, 2));
    } finally {
      if (previousStateDir === undefined) {
        delete process.env.HEALTHLINK_STATE_DIR;
      } else {
        process.env.HEALTHLINK_STATE_DIR = previousStateDir;
      }
      database.close();
    }
  } finally {
    if (app) {
      await app.close();
    }
    relayDb?.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
