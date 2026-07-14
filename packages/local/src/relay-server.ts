import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import SqliteDatabase from "better-sqlite3";
import type { Database as BetterSqliteDatabase } from "better-sqlite3";
import { createHash, timingSafeEqual } from "node:crypto";
import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";
import { isEncryptedEnvelope, type HealthLinkEncryptedEnvelope } from "./relay-crypto.js";

export type RelayServerOptions = {
  host: string;
  port: number;
  databasePath?: string;
  retentionMs?: number;
  maxEnvelopeBytes?: number;
  maxUploadsPerMinute?: number;
  maxQueuedEnvelopesPerUser?: number;
  maxDevicesPerUser?: number;
  trustProxy?: boolean;
  apiToken?: string;
  metricsToken?: string;
};

export type RelayAppOptions = Pick<RelayServerOptions, "retentionMs" | "maxEnvelopeBytes" | "maxUploadsPerMinute" | "maxQueuedEnvelopesPerUser" | "maxDevicesPerUser" | "trustProxy" | "apiToken" | "metricsToken">;

export type RelayDatabase = {
  path: string;
  sqlite: BetterSqliteDatabase;
  close: () => void;
};

type RelayEnvelopeRow = {
  envelopeJson: string;
};

type RelayStatusRow = {
  queuedCount: number;
  ackedCount: number;
  userCount: number;
  oldestQueuedAt: string | null;
  newestQueuedAt: string | null;
};

const DEFAULT_RELAY_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_MAX_ENVELOPE_BYTES = 512 * 1024;
const DEFAULT_MAX_UPLOADS_PER_MINUTE = 120;
const DEFAULT_MAX_QUEUED_ENVELOPES_PER_USER = 1000;
const DEFAULT_MAX_DEVICES_PER_USER = 5;
const RELAY_UPLOAD_RATE_WINDOW_MS = 60_000;
const MAX_TRACKED_UPLOAD_CLIENTS = 10_000;
export const MAX_RELAY_LIST_PAGE_SIZE = 25;

export function getDefaultRelayDatabasePath(): string {
  return join(homedir(), ".healthlink", "relay.sqlite");
}

export function openRelayDatabase(path?: string): RelayDatabase {
  const usesDefaultPath = path === undefined;
  const databasePath = path ?? getDefaultRelayDatabasePath();
  const databaseDir = dirname(databasePath);
  mkdirSync(databaseDir, { recursive: true, mode: usesDefaultPath ? 0o700 : undefined });
  if (usesDefaultPath) {
    try {
      chmodSync(databaseDir, 0o700);
    } catch {
      // Windows and some filesystems may not support POSIX modes.
    }
  }
  const sqlite = new SqliteDatabase(databasePath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(`
    create table if not exists relay_envelopes (
      envelope_id text primary key,
      user_id text not null,
      sequence integer not null,
      received_at text not null,
      acked_at text,
      envelope_json text not null
    );

    create index if not exists idx_relay_envelopes_user_sequence
      on relay_envelopes(user_id, sequence);

    create table if not exists relay_users (
      user_id text primary key,
      access_token_hash text not null unique,
      created_at text not null,
      last_seen_at text not null,
      revoked_at text
    );

    create table if not exists relay_devices (
      user_id text not null,
      device_id text not null,
      created_at text not null,
      revoked_at text,
      primary key (user_id, device_id),
      foreign key (user_id) references relay_users(user_id)
    );
  `);
  hardenRelaySqliteFiles(databasePath);
  return {
    path: databasePath,
    sqlite,
    close: () => {
      hardenRelaySqliteFiles(databasePath);
      sqlite.close();
      hardenRelaySqliteFiles(databasePath);
    }
  };
}

function hardenRelaySqliteFiles(databasePath: string): void {
  for (const path of [databasePath, `${databasePath}-wal`, `${databasePath}-shm`]) {
    if (!existsSync(path)) {
      continue;
    }
    try {
      chmodSync(path, 0o600);
    } catch {
      // Windows and some filesystems may not support POSIX modes.
    }
  }
}

export function createRelayApp(database: RelayDatabase, options: RelayAppOptions = {}): FastifyInstance {
  const limits = resolveRelayLimits(options);
  const app = Fastify({
    logger: false,
    bodyLimit: limits.maxEnvelopeBytes,
    trustProxy: limits.trustProxy
  });
  const uploadRateLimiter = createUploadRateLimiter(limits.maxUploadsPerMinute);
  const retentionSweepIntervalMs = Math.min(60 * 60 * 1000, Math.max(1000, Math.floor(limits.retentionMs / 10)));
  let retentionSweep: ReturnType<typeof setInterval> | undefined;
  app.addHook("onReady", async () => {
    retentionSweep = setInterval(() => {
      cleanupExpiredRelayEnvelopes(database, limits.retentionMs);
    }, retentionSweepIntervalMs);
    retentionSweep.unref();
  });
  app.addHook("onClose", async () => {
    if (retentionSweep) {
      clearInterval(retentionSweep);
    }
  });

  app.get("/", async (_request, reply) => {
    cleanupExpiredRelayEnvelopes(database, limits.retentionMs);
    const row = getRelayStatusRow(database);
    return reply
      .type("text/html; charset=utf-8")
      .send(renderRelayStatusPage(row, limits));
  });

  app.get("/v1/status", async () => {
    cleanupExpiredRelayEnvelopes(database, limits.retentionMs);
    const row = getRelayStatusRow(database);
    return {
      ok: true,
      service: "healthlink-relay",
      queued_envelopes: row.queuedCount,
      acked_envelopes: row.ackedCount,
      users: row.userCount,
      oldest_queued_at: row.oldestQueuedAt,
      newest_queued_at: row.newestQueuedAt,
      limits: publicRelayLimits(limits)
    };
  });

  app.get("/v1/metrics", async (request, reply) => {
    if (!authorizeMetricsRequest(request, limits.metricsToken)) {
      return reply.code(401).send({
        ok: false,
        error: "unauthorized"
      });
    }
    cleanupExpiredRelayEnvelopes(database, limits.retentionMs);
    const row = getRelayStatusRow(database);
    return {
      ok: true,
      service: "healthlink-relay",
      metrics: {
        queued_envelopes: row.queuedCount,
        acked_envelopes: row.ackedCount,
        users: row.userCount,
        oldest_queued_at: row.oldestQueuedAt,
        newest_queued_at: row.newestQueuedAt
      },
      limits: publicRelayLimits(limits)
    };
  });

  app.post("/v1/envelopes", {
    preHandler: uploadRateLimiter
  }, async (request, reply) => {
    if (!authorizeGatewayRequest(request, limits.apiToken)) {
      return reply.code(401).send({
        ok: false,
        error: "unauthorized"
      });
    }
    cleanupExpiredRelayEnvelopes(database, limits.retentionMs);
    const envelope = request.body;
    if (!isEncryptedEnvelope(envelope)) {
      return reply.code(400).send({
        ok: false,
        error: "invalid_envelope"
      });
    }
    const userAuthorization = authorizeRelayUserRequest(database, request, envelope.user_id, true);
    if (userAuthorization !== "ok") {
      return sendRelayAuthorizationError(reply, userAuthorization);
    }
    const deviceAuthorization = authorizeRelayDevice(
      database,
      envelope.user_id,
      envelope.device_id,
      limits.maxDevicesPerUser
    );
    if (deviceAuthorization === "revoked") {
      return reply.code(403).send({
        ok: false,
        error: "device_unlinked"
      });
    }
    if (deviceAuthorization === "quota") {
      return reply.code(429).send({
        ok: false,
        error: "device_quota_exceeded"
      });
    }
    if (countQueuedRelayEnvelopes(database, envelope.user_id) >= limits.maxQueuedEnvelopesPerUser) {
      return reply.code(429).send({
        ok: false,
        error: "quota_exceeded"
      });
    }
    const storage = storeRelayEnvelope(database, envelope);
    if (storage === "conflict") {
      return reply.code(409).send({
        ok: false,
        error: "envelope_id_conflict"
      });
    }
    return {
      ok: true,
      envelope_id: envelope.envelope_id,
      duplicate: storage === "duplicate"
    };
  });

  app.get("/v1/envelopes", async (request, reply) => {
    if (!authorizeGatewayRequest(request, limits.apiToken)) {
      return reply.code(401).send({
        ok: false,
        error: "unauthorized"
      });
    }
    cleanupExpiredRelayEnvelopes(database, limits.retentionMs);
    const query = listQuerySchema.safeParse(request.query);
    if (!query.success) {
      return reply.code(400).send({
        ok: false,
        error: "invalid_query"
      });
    }
    const userAuthorization = authorizeRelayUserRequest(database, request, query.data.user_id, true);
    if (userAuthorization !== "ok") {
      return sendRelayAuthorizationError(reply, userAuthorization);
    }
    return {
      ok: true,
      envelopes: listRelayEnvelopes(
        database,
        query.data.user_id,
        query.data.after ?? 0,
        query.data.limit
      )
    };
  });

  app.post("/v1/envelopes/:envelope_id/ack", async (request, reply) => {
    if (!authorizeGatewayRequest(request, limits.apiToken)) {
      return reply.code(401).send({
        ok: false,
        error: "unauthorized"
      });
    }
    const params = envelopeParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({
        ok: false,
        error: "invalid_params"
      });
    }
    const authorizedUserId = resolveAuthorizedRelayUser(database, request);
    if (!authorizedUserId) {
      return reply.code(401).send({
        ok: false,
        error: "unauthorized"
      });
    }
    const changes = ackRelayEnvelope(database, params.data.envelope_id, authorizedUserId);
    return {
      ok: true,
      acked: changes > 0
    };
  });

  app.post("/v1/purge", async (request, reply) => {
    if (!authorizeGatewayRequest(request, limits.apiToken)) {
      return reply.code(401).send({
        ok: false,
        error: "unauthorized"
      });
    }
    const body = purgeSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({
        ok: false,
        error: "invalid_payload"
      });
    }
    const userAuthorization = authorizeRelayUserRequest(database, request, body.data.user_id, true);
    if (userAuthorization !== "ok") {
      return sendRelayAuthorizationError(reply, userAuthorization);
    }
    const result = database.sqlite.prepare(`
      delete from relay_envelopes
      where user_id = ?
    `).run(body.data.user_id);
    return {
      ok: true,
      purged: result.changes
    };
  });

  app.post("/v1/devices/:device_id/unlink", async (request, reply) => {
    if (!authorizeGatewayRequest(request, limits.apiToken)) {
      return reply.code(401).send({ ok: false, error: "unauthorized" });
    }
    const params = deviceParamsSchema.safeParse(request.params);
    const body = userActionSchema.safeParse(request.body);
    if (!params.success || !body.success) {
      return reply.code(400).send({ ok: false, error: "invalid_payload" });
    }
    const userAuthorization = authorizeRelayUserRequest(database, request, body.data.user_id, true);
    if (userAuthorization !== "ok") {
      return sendRelayAuthorizationError(reply, userAuthorization);
    }
    const result = unlinkRelayDevice(database, body.data.user_id, params.data.device_id);
    return {
      ok: true,
      device_id: params.data.device_id,
      unlinked: true,
      purged: result.purged
    };
  });

  app.post("/v1/credentials/rotate", async (request, reply) => {
    if (!authorizeGatewayRequest(request, limits.apiToken)) {
      return reply.code(401).send({ ok: false, error: "unauthorized" });
    }
    const body = rotateCredentialsSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ ok: false, error: "invalid_payload" });
    }
    const userAuthorization = authorizeRelayUserRequest(database, request, body.data.user_id, true);
    if (userAuthorization !== "ok") {
      return sendRelayAuthorizationError(reply, userAuthorization);
    }
    try {
      const purged = rotateRelayCredentials(database, body.data.user_id, body.data.new_access_token);
      return {
        ok: true,
        rotated: true,
        purged
      };
    } catch {
      return reply.code(409).send({ ok: false, error: "access_token_conflict" });
    }
  });

  app.post("/v1/users/revoke", async (request, reply) => {
    if (!authorizeGatewayRequest(request, limits.apiToken)) {
      return reply.code(401).send({ ok: false, error: "unauthorized" });
    }
    const body = userActionSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ ok: false, error: "invalid_payload" });
    }
    const userAuthorization = authorizeRelayUserRequest(database, request, body.data.user_id, true);
    if (userAuthorization !== "ok") {
      return sendRelayAuthorizationError(reply, userAuthorization);
    }
    const purged = revokeRelayUser(database, body.data.user_id);
    return {
      ok: true,
      revoked: true,
      purged
    };
  });

  return app;
}

export async function startRelayServer(options: RelayServerOptions): Promise<void> {
  const database = openRelayDatabase(options.databasePath);
  const app = createRelayApp(database, options);
  app.addHook("onClose", async () => {
    database.close();
  });
  await app.listen({
    host: options.host,
    port: options.port
  });
  console.log("Vital Agent Sync relay running");
  console.log(`Relay API: http://127.0.0.1:${options.port}`);
  console.log(`Database:  ${database.path}`);
  console.log(`Retention: ${resolveRelayLimits(options).retentionMs} ms`);
}

export function cleanupExpiredRelayEnvelopes(
  database: RelayDatabase,
  retentionMs = DEFAULT_RELAY_RETENTION_MS,
  now = new Date()
): number {
  if (!Number.isFinite(retentionMs) || retentionMs <= 0) {
    return 0;
  }
  const cutoff = new Date(now.getTime() - retentionMs).toISOString();
  const result = database.sqlite.prepare(`
    delete from relay_envelopes
    where received_at < ?
  `).run(cutoff);
  return result.changes;
}

export function countQueuedRelayEnvelopes(database: RelayDatabase, userId: string): number {
  const row = database.sqlite.prepare(`
    select count(*) as count
    from relay_envelopes
    where user_id = ?
      and acked_at is null
  `).get(userId) as { count: number };
  return row.count;
}

function getRelayStatusRow(database: RelayDatabase): RelayStatusRow {
  return database.sqlite.prepare(`
    select
      (select count(*) from relay_envelopes where acked_at is null) as queuedCount,
      (select count(*) from relay_envelopes where acked_at is not null) as ackedCount,
      (select count(*) from relay_users where revoked_at is null) as userCount,
      (select min(received_at) from relay_envelopes where acked_at is null) as oldestQueuedAt,
      (select max(received_at) from relay_envelopes where acked_at is null) as newestQueuedAt
  `).get() as RelayStatusRow;
}

function resolveRelayLimits(options: RelayAppOptions) {
  return {
    retentionMs: options.retentionMs ?? DEFAULT_RELAY_RETENTION_MS,
    maxEnvelopeBytes: options.maxEnvelopeBytes ?? DEFAULT_MAX_ENVELOPE_BYTES,
    maxUploadsPerMinute: options.maxUploadsPerMinute ?? DEFAULT_MAX_UPLOADS_PER_MINUTE,
    maxQueuedEnvelopesPerUser: options.maxQueuedEnvelopesPerUser ?? DEFAULT_MAX_QUEUED_ENVELOPES_PER_USER,
    maxDevicesPerUser: options.maxDevicesPerUser ?? DEFAULT_MAX_DEVICES_PER_USER,
    trustProxy: options.trustProxy ?? false,
    apiToken: normalizeOptionalToken(options.apiToken),
    metricsToken: normalizeOptionalToken(options.metricsToken)
  };
}

function publicRelayLimits(limits: ReturnType<typeof resolveRelayLimits>) {
  return {
    retentionMs: limits.retentionMs,
    maxEnvelopeBytes: limits.maxEnvelopeBytes,
    maxUploadsPerMinute: limits.maxUploadsPerMinute,
    maxQueuedEnvelopesPerUser: limits.maxQueuedEnvelopesPerUser,
    maxDevicesPerUser: limits.maxDevicesPerUser,
    proxyAwareClientIp: limits.trustProxy,
    apiProtected: Boolean(limits.apiToken),
    tenantProtected: true,
    metricsProtected: Boolean(limits.metricsToken)
  };
}

function authorizeMetricsRequest(request: FastifyRequest, metricsToken: string | undefined): boolean {
  return authorizeBearerRequest(request, metricsToken);
}

function authorizeGatewayRequest(request: FastifyRequest, expectedToken: string | undefined): boolean {
  if (!expectedToken) {
    return true;
  }
  const header = request.headers["x-healthlink-relay-api-key"];
  const providedToken = Array.isArray(header) ? header[0] : header;
  return secureTokenEqual(expectedToken, providedToken);
}

function authorizeBearerRequest(request: FastifyRequest, expectedToken: string | undefined): boolean {
  if (!expectedToken) {
    return true;
  }
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return false;
  }
  return secureTokenEqual(expectedToken, header.slice("Bearer ".length));
}

type RelayUserAuthorization = "ok" | "unauthorized" | "revoked";

function authorizeRelayUserRequest(
  database: RelayDatabase,
  request: FastifyRequest,
  userId: string,
  allowCreate: boolean
): RelayUserAuthorization {
  const token = bearerToken(request);
  if (!token) {
    return "unauthorized";
  }
  const tokenHash = hashRelayAccessToken(token);
  const row = database.sqlite.prepare(`
    select access_token_hash as accessTokenHash, revoked_at as revokedAt
    from relay_users
    where user_id = ?
  `).get(userId) as { accessTokenHash: string; revokedAt: string | null } | undefined;
  if (!row) {
    if (!allowCreate) {
      return "unauthorized";
    }
    const now = new Date().toISOString();
    try {
      database.sqlite.prepare(`
        insert into relay_users (user_id, access_token_hash, created_at, last_seen_at, revoked_at)
        values (?, ?, ?, ?, null)
      `).run(userId, tokenHash, now, now);
      return "ok";
    } catch {
      return "unauthorized";
    }
  }
  if (row.revokedAt) {
    return "revoked";
  }
  if (!secureTokenEqual(row.accessTokenHash, tokenHash)) {
    return "unauthorized";
  }
  database.sqlite.prepare(`
    update relay_users
    set last_seen_at = ?
    where user_id = ?
  `).run(new Date().toISOString(), userId);
  return "ok";
}

function resolveAuthorizedRelayUser(database: RelayDatabase, request: FastifyRequest): string | undefined {
  const token = bearerToken(request);
  if (!token) {
    return undefined;
  }
  const row = database.sqlite.prepare(`
    select user_id as userId
    from relay_users
    where access_token_hash = ?
      and revoked_at is null
  `).get(hashRelayAccessToken(token)) as { userId: string } | undefined;
  if (!row) {
    return undefined;
  }
  database.sqlite.prepare(`
    update relay_users
    set last_seen_at = ?
    where user_id = ?
  `).run(new Date().toISOString(), row.userId);
  return row.userId;
}

function sendRelayAuthorizationError(reply: FastifyReply, result: Exclude<RelayUserAuthorization, "ok">) {
  return reply.code(result === "revoked" ? 403 : 401).send({
    ok: false,
    error: result === "revoked" ? "user_revoked" : "unauthorized"
  });
}

function bearerToken(request: FastifyRequest): string | undefined {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return undefined;
  }
  return normalizeOptionalToken(header.slice("Bearer ".length));
}

function hashRelayAccessToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function secureTokenEqual(expectedToken: string, providedToken: string | undefined): boolean {
  if (!providedToken) {
    return false;
  }
  const expected = Buffer.from(expectedToken);
  const provided = Buffer.from(providedToken);
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}

function normalizeOptionalToken(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function renderRelayStatusPage(row: RelayStatusRow, limits: ReturnType<typeof resolveRelayLimits>): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Vital Agent Sync Relay Status</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 2rem; color: #151515; background: #fafafa; }
    main { max-width: 760px; }
    h1 { font-size: 1.6rem; margin-bottom: 0.25rem; }
    p { color: #555; }
    dl { display: grid; grid-template-columns: minmax(12rem, 1fr) 2fr; gap: 0.65rem 1rem; background: #fff; border: 1px solid #ddd; padding: 1rem; }
    dt { font-weight: 600; }
    dd { margin: 0; }
  </style>
</head>
<body>
  <main>
    <h1>Vital Agent Sync Relay Status</h1>
    <p>This page exposes aggregate relay health only. Private payload, authentication, and per-device materials are not shown.</p>
    <dl>
      <dt>Queued envelopes</dt><dd>${row.queuedCount}</dd>
      <dt>Acked envelopes</dt><dd>${row.ackedCount}</dd>
      <dt>Users</dt><dd>${row.userCount}</dd>
      <dt>Oldest queued at</dt><dd>${escapeHtml(row.oldestQueuedAt ?? "none")}</dd>
      <dt>Newest queued at</dt><dd>${escapeHtml(row.newestQueuedAt ?? "none")}</dd>
      <dt>Retention</dt><dd>${limits.retentionMs} ms</dd>
      <dt>Max envelope size</dt><dd>${limits.maxEnvelopeBytes} bytes</dd>
      <dt>Max uploads/minute</dt><dd>${limits.maxUploadsPerMinute}</dd>
      <dt>Max queued/user</dt><dd>${limits.maxQueuedEnvelopesPerUser}</dd>
      <dt>Max devices/user</dt><dd>${limits.maxDevicesPerUser}</dd>
      <dt>Tenant access</dt><dd>per-user token required</dd>
      <dt>Gateway access</dt><dd>${limits.apiToken ? "deployment key required" : "no deployment key"}</dd>
      <dt>Metrics access</dt><dd>${limits.metricsToken ? "token required" : "public aggregate endpoint"}</dd>
    </dl>
  </main>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function storeRelayEnvelope(
  database: RelayDatabase,
  envelope: HealthLinkEncryptedEnvelope
): "stored" | "duplicate" | "conflict" {
  const envelopeJson = JSON.stringify(envelope);
  const result = database.sqlite.prepare(`
    insert into relay_envelopes (
      envelope_id,
      user_id,
      sequence,
      received_at,
      acked_at,
      envelope_json
    ) values (
      @envelopeId,
      @userId,
      @sequence,
      @receivedAt,
      null,
      @envelopeJson
    )
    on conflict(envelope_id) do nothing
  `).run({
    envelopeId: envelope.envelope_id,
    userId: envelope.user_id,
    sequence: envelope.sequence,
    receivedAt: new Date().toISOString(),
    envelopeJson
  });
  if (result.changes > 0) {
    return "stored";
  }
  const existing = database.sqlite.prepare(`
    select user_id as userId, envelope_json as envelopeJson
    from relay_envelopes
    where envelope_id = ?
  `).get(envelope.envelope_id) as { userId: string; envelopeJson: string } | undefined;
  return existing?.userId === envelope.user_id && existing.envelopeJson === envelopeJson
    ? "duplicate"
    : "conflict";
}

export function listRelayEnvelopes(
  database: RelayDatabase,
  userId: string,
  after: number,
  limit = MAX_RELAY_LIST_PAGE_SIZE
): HealthLinkEncryptedEnvelope[] {
  const rows = database.sqlite.prepare(`
    select envelope_json as envelopeJson
    from relay_envelopes
    where user_id = ?
      and sequence > ?
      and acked_at is null
    order by sequence asc
    limit ?
  `).all(userId, after, Math.min(Math.max(1, limit), MAX_RELAY_LIST_PAGE_SIZE)) as RelayEnvelopeRow[];
  return rows.map((row) => JSON.parse(row.envelopeJson) as HealthLinkEncryptedEnvelope);
}

export function ackRelayEnvelope(database: RelayDatabase, envelopeId: string, userId: string): number {
  const result = database.sqlite.prepare(`
    update relay_envelopes
    set acked_at = ?
    where envelope_id = ?
      and user_id = ?
      and acked_at is null
  `).run(new Date().toISOString(), envelopeId, userId);
  return result.changes;
}

function authorizeRelayDevice(
  database: RelayDatabase,
  userId: string,
  deviceId: string,
  maxDevicesPerUser: number
): "ok" | "revoked" | "quota" {
  const row = database.sqlite.prepare(`
    select revoked_at as revokedAt
    from relay_devices
    where user_id = ? and device_id = ?
  `).get(userId, deviceId) as { revokedAt: string | null } | undefined;
  if (row) {
    return row.revokedAt ? "revoked" : "ok";
  }
  const active = database.sqlite.prepare(`
    select count(*) as count
    from relay_devices
    where user_id = ? and revoked_at is null
  `).get(userId) as { count: number };
  if (active.count >= maxDevicesPerUser) {
    return "quota";
  }
  database.sqlite.prepare(`
    insert into relay_devices (user_id, device_id, created_at, revoked_at)
    values (?, ?, ?, null)
  `).run(userId, deviceId, new Date().toISOString());
  return "ok";
}

function unlinkRelayDevice(database: RelayDatabase, userId: string, deviceId: string): { purged: number } {
  return database.sqlite.transaction(() => {
    const now = new Date().toISOString();
    database.sqlite.prepare(`
      insert into relay_devices (user_id, device_id, created_at, revoked_at)
      values (?, ?, ?, ?)
      on conflict(user_id, device_id) do update set revoked_at = excluded.revoked_at
    `).run(userId, deviceId, now, now);
    const purged = database.sqlite.prepare(`
      delete from relay_envelopes
      where user_id = ? and json_extract(envelope_json, '$.device_id') = ?
    `).run(userId, deviceId).changes;
    return { purged };
  })();
}

function rotateRelayCredentials(database: RelayDatabase, userId: string, newAccessToken: string): number {
  return database.sqlite.transaction(() => {
    const purged = database.sqlite.prepare(`
      delete from relay_envelopes
      where user_id = ?
    `).run(userId).changes;
    database.sqlite.prepare(`
      delete from relay_devices
      where user_id = ?
    `).run(userId);
    database.sqlite.prepare(`
      update relay_users
      set access_token_hash = ?, last_seen_at = ?, revoked_at = null
      where user_id = ?
    `).run(hashRelayAccessToken(newAccessToken), new Date().toISOString(), userId);
    return purged;
  })();
}

function revokeRelayUser(database: RelayDatabase, userId: string): number {
  return database.sqlite.transaction(() => {
    const now = new Date().toISOString();
    const purged = database.sqlite.prepare(`
      delete from relay_envelopes
      where user_id = ?
    `).run(userId).changes;
    database.sqlite.prepare(`
      update relay_users
      set revoked_at = ?, last_seen_at = ?
      where user_id = ?
    `).run(now, now, userId);
    database.sqlite.prepare(`
      update relay_devices
      set revoked_at = ?
      where user_id = ?
    `).run(now, userId);
    return purged;
  })();
}

const listQuerySchema = z.object({
  user_id: z.string().min(1),
  after: z.coerce.number().int().nonnegative().optional(),
  limit: z.coerce.number().int().min(1).max(MAX_RELAY_LIST_PAGE_SIZE).default(MAX_RELAY_LIST_PAGE_SIZE)
});

const envelopeParamsSchema = z.object({
  envelope_id: z.string().min(1)
});

const deviceParamsSchema = z.object({
  device_id: z.string().min(1)
});

const purgeSchema = z.object({
  user_id: z.string().min(1)
});

const userActionSchema = z.object({
  user_id: z.string().min(1)
});

const rotateCredentialsSchema = z.object({
  user_id: z.string().min(1),
  new_access_token: z.string().min(32).max(512)
});

function createUploadRateLimiter(maxUploadsPerMinute: number) {
  const windows = new Map<string, {
    startedAt: number;
    count: number;
  }>();
  let nextSweepAt = 0;
  return async (
    request: FastifyRequest,
    reply: FastifyReply
  ) => {
    if (!Number.isFinite(maxUploadsPerMinute) || maxUploadsPerMinute <= 0) {
      return;
    }
    const now = Date.now();
    if (now >= nextSweepAt) {
      for (const [client, window] of windows) {
        if (now - window.startedAt >= RELAY_UPLOAD_RATE_WINDOW_MS) {
          windows.delete(client);
        }
      }
      nextSweepAt = now + RELAY_UPLOAD_RATE_WINDOW_MS;
    }
    const key = request.ip || "unknown";
    const current = windows.get(key);
    if (!current || now - current.startedAt >= RELAY_UPLOAD_RATE_WINDOW_MS) {
      if (!current && windows.size >= MAX_TRACKED_UPLOAD_CLIENTS) {
        return reply.code(429).send({
          ok: false,
          error: "rate_limited"
        });
      }
      windows.set(key, { startedAt: now, count: 1 });
      return;
    }
    current.count += 1;
    if (current.count > maxUploadsPerMinute) {
      return reply.code(429).send({
        ok: false,
        error: "rate_limited"
      });
    }
  };
}
