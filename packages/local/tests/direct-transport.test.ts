import assert from "node:assert/strict";
import { createPrivateKey, createPublicKey, type KeyObject } from "node:crypto";
import { mkdtempSync, rmSync, statSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { sanitizeAgentOutput } from "../src/bootstrap.js";
import { openVitalAgentDatabase } from "../src/database.js";
import {
  DirectTransportError,
  claimDirectRequest,
  createDirectRequestForTest,
  decryptDirectRequest,
  decryptDirectResponseForTest,
  encryptDirectResponse,
  loadOrCreateDirectTransportKey,
  type DirectTransportKey
} from "../src/direct-transport.js";
import { PairingStore } from "../src/pairing.js";
import { getDailyHealthSummary } from "../src/health-query.js";
import { handleDirectRequest, isLoopbackAddress } from "../src/server.js";

test("pairing session creation is restricted to the receiver host", () => {
  assert.equal(isLoopbackAddress("127.0.0.1"), true);
  assert.equal(isLoopbackAddress("::1"), true);
  assert.equal(isLoopbackAddress("::ffff:127.0.0.1"), true);
  assert.equal(isLoopbackAddress("192.168.1.20"), false);
  assert.equal(isLoopbackAddress("100.64.0.8"), false);
});

test("agent diagnostics redact direct pairing and credential fields", () => {
  assert.deepEqual(sanitizeAgentOutput({
    pairing_code: "ABCD-EFGH",
    pairing_url: "vitalmcp://pair?server=http%3A%2F%2F192.168.1.20%3A8787&code=ABCD-EFGH",
    device_token: "va_dev_secret",
    status: "waiting"
  }), {
    pairing_code: "[REDACTED]",
    pairing_url: "[REDACTED]",
    device_token: "[REDACTED]",
    status: "waiting"
  });
});

test("direct transport interoperates without exposing pairing, token, or health plaintext", () => {
  const receiver = fixedKey(9);
  const sender = fixedPrivateKey(5);
  const sensitive = {
    pairing_code: "PAIR-SECRET",
    device_token: "va_dev_reusable-secret",
    steps: 12_345
  };
  const request = createDirectRequestForTest({
    receiverPublicKeyRaw: receiver.publicKeyRaw,
    senderPrivateKey: sender,
    payload: sensitive,
    purpose: "health.sync",
    requestId: "req_interop_001",
    createdAt: "2026-07-13T02:00:00.000Z",
    nonce: Buffer.from(Array.from({ length: 12 }, (_, index) => index))
  });

  const wire = JSON.stringify(request.envelope);
  assert.equal(wire.includes(sensitive.pairing_code), false);
  assert.equal(wire.includes(sensitive.device_token), false);
  assert.equal(wire.includes(String(sensitive.steps)), false);
  assert.equal(request.envelope.crypto.nonce, "AAECAwQFBgcICQoL");
  assert.equal(request.envelope.crypto.sender_public_key_x25519, "UKYUCbHd0DJemxa3AOcZ6XcsBwALG9d4bpB8ZT0gSV0");
  assert.equal(request.envelope.crypto.tag, "bStRPqJ1xMlRiTdvafV7lA");
  assert.equal(
    request.envelope.crypto.ciphertext,
    "WKOcgHQ4DW2Fix9lHgyCrkdAOAK8XbsmTcPUuvA6FfZJxtLR5Tu_zOSzEPG9Q-ZMmXekdw0-fu1cD8vvTAQ5JRAtpGU16An8o9uCWPQR-BQKybDl"
  );

  const decrypted = decryptDirectRequest({
    key: receiver,
    envelope: request.envelope,
    now: "2026-07-13T02:00:30.000Z"
  });
  assert.deepEqual(decrypted.plaintext, sensitive);

  const response = encryptDirectResponse(decrypted.response, {
    ok: true,
    accepted_sync_id: "sync_interop_001"
  }, {
    now: "2026-07-13T02:00:31.000Z",
    nonce: Buffer.from(Array.from({ length: 12 }, (_, index) => 11 - index))
  });
  assert.deepEqual(decryptDirectResponseForTest({
    envelope: response,
    responseKey: request.responseKey
  }), {
    ok: true,
    accepted_sync_id: "sync_interop_001"
  });
});

test("encrypted pairing and one sync preserve the local SQLite and MCP data path", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "vitalmcp-direct-flow-"));
  const database = openVitalAgentDatabase({ path: join(tempDir, "health.sqlite") });
  try {
    const receiver = fixedKey(31);
    const pairings = new PairingStore(database, receiver.publicKeyRaw);
    const session = pairings.createSession({
      serverUrl: "http://192.168.1.20:8787",
      agentName: "Test Agent",
      transport: "lan"
    });
    const confirmEnvelope = createDirectRequestForTest({
      receiverPublicKeyRaw: receiver.publicKeyRaw,
      payload: {
        pairing_code: session.pairing_code,
        device_name: "Test iPhone",
        device_platform: "ios",
        accepted_scopes: session.requested_scopes
      },
      purpose: "pair.confirm"
    }).envelope;
    const confirmPlaintext = decryptDirectRequest({ key: receiver, envelope: confirmEnvelope }).plaintext;
    const confirmed = handleDirectRequest(database, pairings, "pair.confirm", confirmPlaintext) as {
      device_id: string;
      device_token: string;
    };

    const syncPayload = {
      device_id: confirmed.device_id,
      sync_id: "sync_direct_001",
      generated_at: "2026-07-13T10:00:00+08:00",
      timezone: "Asia/Shanghai",
      health_daily_summaries: [{
        date: "2026-07-13",
        provider: "apple_health",
        steps: 7_654,
        workouts: []
      }]
    };
    const syncEnvelope = createDirectRequestForTest({
      receiverPublicKeyRaw: receiver.publicKeyRaw,
      payload: { device_token: confirmed.device_token, payload: syncPayload },
      purpose: "health.sync"
    }).envelope;
    const syncWire = JSON.stringify(syncEnvelope);
    assert.equal(syncWire.includes(confirmed.device_token), false);
    assert.equal(syncWire.includes("7654"), false);
    const syncPlaintext = decryptDirectRequest({ key: receiver, envelope: syncEnvelope }).plaintext;
    const result = handleDirectRequest(database, pairings, "health.sync", syncPlaintext) as {
      accepted_sync_id: string;
    };
    assert.equal(result.accepted_sync_id, "sync_direct_001");

    const daily = getDailyHealthSummary(database, { date: "2026-07-13" }) as {
      health: { steps: number };
    };
    assert.equal(daily.health.steps, 7_654);
  } finally {
    database.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("direct transport rejects replay, stale, tampered, and rotated-key requests", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "vitalmcp-direct-negative-"));
  const database = openVitalAgentDatabase({ path: join(tempDir, "health.sqlite") });
  try {
    const receiver = fixedKey(21);
    const request = createDirectRequestForTest({
      receiverPublicKeyRaw: receiver.publicKeyRaw,
      senderPrivateKey: fixedPrivateKey(22),
      payload: { pairing_code: "ABCD-EFGH" },
      purpose: "pair.status",
      requestId: "req_replay_001",
      createdAt: "2026-07-13T02:00:00.000Z",
      nonce: Buffer.alloc(12, 3)
    });
    const decrypted = decryptDirectRequest({ key: receiver, envelope: request.envelope, now: "2026-07-13T02:00:01.000Z" });
    claimDirectRequest(database, decrypted.envelope.request_id, decrypted.envelope.created_at, new Date("2026-07-13T02:00:01.000Z"));
    assert.throws(
      () => claimDirectRequest(database, decrypted.envelope.request_id, decrypted.envelope.created_at, new Date("2026-07-13T02:00:02.000Z")),
      (error: unknown) => error instanceof DirectTransportError && error.code === "replayed_envelope"
    );
    assert.throws(
      () => decryptDirectRequest({ key: receiver, envelope: request.envelope, now: "2026-07-13T02:06:00.000Z" }),
      (error: unknown) => error instanceof DirectTransportError && error.code === "stale_envelope"
    );

    const tampered = structuredClone(request.envelope);
    tampered.crypto.ciphertext = replaceFirstBase64UrlCharacter(tampered.crypto.ciphertext);
    assert.throws(
      () => decryptDirectRequest({ key: receiver, envelope: tampered, now: "2026-07-13T02:00:01.000Z" }),
      (error: unknown) => error instanceof DirectTransportError && error.code === "decrypt_failed"
    );
    assert.throws(
      () => decryptDirectRequest({ key: fixedKey(23), envelope: request.envelope, now: "2026-07-13T02:00:01.000Z" }),
      (error: unknown) => error instanceof DirectTransportError && error.code === "decrypt_failed"
    );
  } finally {
    database.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("direct receiver key persists securely and a replacement requires re-pairing", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "vitalmcp-direct-key-"));
  const databasePath = join(tempDir, "health.sqlite");
  try {
    const first = loadOrCreateDirectTransportKey(databasePath);
    const restored = loadOrCreateDirectTransportKey(databasePath);
    assert.equal(restored.publicKeyRaw, first.publicKeyRaw);
    if (process.platform !== "win32") {
      assert.equal(statSync(first.privateKeyPath).mode & 0o777, 0o600);
    }

    unlinkSync(first.privateKeyPath);
    const rotated = loadOrCreateDirectTransportKey(databasePath);
    assert.notEqual(rotated.publicKeyRaw, first.publicKeyRaw);

    const pairingsDatabase = openVitalAgentDatabase({ path: databasePath });
    try {
      const session = new PairingStore(pairingsDatabase, rotated.publicKeyRaw).createSession({
        serverUrl: "http://192.168.1.20:8787",
        agentName: "Test Agent",
        transport: "lan"
      });
      const pairingUrl = new URL(session.pairing_url);
      assert.equal(pairingUrl.searchParams.get("key"), rotated.publicKeyRaw);
      assert.equal(pairingUrl.searchParams.get("code"), session.pairing_code);
    } finally {
      pairingsDatabase.close();
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

function fixedKey(byte: number): DirectTransportKey {
  const privateKey = fixedPrivateKey(byte);
  const publicKey = createPublicKey(privateKey);
  return {
    privateKey,
    publicKey,
    publicKeyRaw: Buffer.from(publicKey.export({ type: "spki", format: "der" })).subarray(-32).toString("base64url"),
    privateKeyPath: "<test>"
  };
}

function fixedPrivateKey(byte: number): KeyObject {
  return createPrivateKey({
    key: Buffer.concat([
      Buffer.from("302e020100300506032b656e04220420", "hex"),
      Buffer.alloc(32, byte)
    ]),
    type: "pkcs8",
    format: "der"
  });
}

function replaceFirstBase64UrlCharacter(value: string): string {
  return `${value[0] === "A" ? "B" : "A"}${value.slice(1)}`;
}
