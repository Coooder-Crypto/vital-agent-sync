import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { openHealthLinkDatabase, type HealthLinkDatabase } from "./database.js";
import { ingestValidatedHealthSync, type AuthenticatedDevice } from "./health-ingest.js";
import { decryptHealthSyncEnvelope, isEncryptedEnvelope, type HealthLinkEncryptedEnvelope } from "./relay-crypto.js";
import {
  getDefaultStateDir,
  getRelayCursorPath,
  normalizeRelayUrlForMode,
  readRelayRuntimeConfig,
  type RelayRuntimeConfig
} from "./relay-runtime.js";
import { MAX_RELAY_LIST_PAGE_SIZE } from "./relay-server.js";

export type RelayPullOptions = {
  stateDir?: string;
  databasePath?: string;
  relayUrl?: string;
  relayAccessToken?: string;
  relayApiToken?: string;
};

export type RelayPullResult = {
  fetched: number;
  ingested: number;
  acked: number;
  latest_sequence: number;
  failed?: RelayFailureState;
};

type RelayCursor = {
  latest_sequence: number;
  processed_envelope_ids?: string[];
  last_successful_pull_at?: string;
  last_failed_envelope_id?: string;
  last_failed_at?: string;
  last_error?: string;
};

export type RelayFailureState = {
  envelope_id: string;
  failed_at: string;
  error: string;
};

export async function pullRelayEnvelopes(options: RelayPullOptions = {}): Promise<RelayPullResult> {
  const stateDir = options.stateDir ?? getDefaultStateDir();
  const config = readRelayRuntimeConfig({ stateDir });
  const relayUrl = normalizeRelayUrlForMode(options.relayUrl ?? config.relay_url, config.relay_mode);
  const relayAccessToken = normalizeOptionalToken(options.relayAccessToken ?? config.relay_access_token);
  const relayApiToken = normalizeOptionalToken(options.relayApiToken ?? config.relay_api_token ?? process.env.HEALTHLINK_RELAY_API_TOKEN);
  const cursor = readRelayCursor(stateDir);
  const database = openHealthLinkDatabase({ path: options.databasePath });
  try {
    ensureRelaySourceDevice(database, config);
    let fetched = 0;
    let ingested = 0;
    let acked = 0;
    let latestSequence = cursor.latest_sequence;
    const processedEnvelopeIds = new Set(cursor.processed_envelope_ids ?? []);
    while (true) {
      const envelopes = await fetchRelayEnvelopes(
        relayUrl,
        config.user_id,
        latestSequence,
        relayAccessToken,
        relayApiToken
      );
      fetched += envelopes.length;
      for (const envelope of envelopes) {
        try {
          const decrypted = decryptHealthSyncEnvelope({
            config,
            envelope,
            validation: {
              minSequenceExclusive: latestSequence,
              seenEnvelopeIds: processedEnvelopeIds,
              expectedDeviceId: config.source_device_id
            }
          });
          const device = relayAuthenticatedDevice(config);
          const result = ingestValidatedHealthSync(database, device, decrypted);
          ingested += result.idempotent ? 0 : 1;
          await ackRelayEnvelope(relayUrl, envelope.envelope_id, relayAccessToken, relayApiToken);
          acked += 1;
          processedEnvelopeIds.add(envelope.envelope_id);
          latestSequence = Math.max(latestSequence, envelope.sequence);
        } catch (error) {
          const failure = {
            envelope_id: envelope.envelope_id,
            failed_at: new Date().toISOString(),
            error: error instanceof Error ? error.message : String(error)
          };
          writeRelayCursor(stateDir, {
            ...cursor,
            latest_sequence: latestSequence,
            processed_envelope_ids: capProcessedEnvelopeIds(processedEnvelopeIds),
            last_failed_envelope_id: failure.envelope_id,
            last_failed_at: failure.failed_at,
            last_error: failure.error
          });
          throw new Error(`Failed to process relay envelope ${failure.envelope_id}: ${failure.error}`);
        }
      }
      if (envelopes.length < MAX_RELAY_LIST_PAGE_SIZE) {
        break;
      }
      writeRelayCursor(stateDir, {
        latest_sequence: latestSequence,
        processed_envelope_ids: capProcessedEnvelopeIds(processedEnvelopeIds)
      });
    }
    writeRelayCursor(stateDir, {
      latest_sequence: latestSequence,
      processed_envelope_ids: capProcessedEnvelopeIds(processedEnvelopeIds),
      last_successful_pull_at: new Date().toISOString()
    });
    return {
      fetched,
      ingested,
      acked,
      latest_sequence: latestSequence
    };
  } finally {
    database.close();
  }
}

export function ensureRelaySourceDevice(database: HealthLinkDatabase, config: RelayRuntimeConfig): void {
  const existing = database.sqlite.prepare(`
    select id
    from devices
    where id = ?
  `).get(config.source_device_id) as { id: string } | undefined;
  if (existing) {
    return;
  }
  database.sqlite.prepare(`
    insert into devices (
      id,
      name,
      platform,
      token_hash,
      scopes_json,
      created_at,
      revoked_at
    ) values (
      @id,
      @name,
      'ios',
      @tokenHash,
      @scopesJson,
      @createdAt,
      null
    )
  `).run({
    id: config.source_device_id,
    name: "Vital Agent Sync Relay Source",
    tokenHash: `relay:${config.user_id}`,
    scopesJson: JSON.stringify(config.requested_scopes),
    createdAt: new Date().toISOString()
  });
}

function relayAuthenticatedDevice(config: RelayRuntimeConfig): AuthenticatedDevice {
  return {
    device_id: config.source_device_id,
    device_name: "Vital Agent Sync Relay Source",
    scopes: config.requested_scopes
  };
}

async function fetchRelayEnvelopes(
  relayUrl: string,
  userId: string,
  after: number,
  relayAccessToken: string | undefined,
  relayApiToken: string | undefined
): Promise<HealthLinkEncryptedEnvelope[]> {
  const url = new URL(`${relayUrl}/v1/envelopes`);
  url.searchParams.set("user_id", userId);
  url.searchParams.set("after", String(after));
  url.searchParams.set("limit", String(MAX_RELAY_LIST_PAGE_SIZE));
  const response = await fetch(url, {
    headers: relayDataHeaders(relayAccessToken, relayApiToken)
  });
  if (!response.ok) {
    throw new Error(`Relay returned HTTP ${response.status} while fetching envelopes.`);
  }
  const body = await response.json() as unknown;
  if (!isRelayListResponse(body)) {
    throw new Error("Relay returned an invalid envelope list response.");
  }
  const envelopes: HealthLinkEncryptedEnvelope[] = [];
  for (const envelope of body.envelopes) {
    if (!isEncryptedEnvelope(envelope)) {
      throw new Error("Relay returned an invalid encrypted envelope.");
    }
    envelopes.push(envelope);
  }
  return envelopes;
}

async function ackRelayEnvelope(
  relayUrl: string,
  envelopeId: string,
  relayAccessToken: string | undefined,
  relayApiToken: string | undefined
): Promise<void> {
  const response = await fetch(`${relayUrl}/v1/envelopes/${encodeURIComponent(envelopeId)}/ack`, {
    method: "POST",
    headers: relayDataHeaders(relayAccessToken, relayApiToken)
  });
  if (!response.ok) {
    throw new Error(`Relay returned HTTP ${response.status} while acking envelope ${envelopeId}.`);
  }
}

function readRelayCursor(stateDir: string): RelayCursor {
  const cursorPath = getRelayCursorPath(stateDir);
  if (!existsSync(cursorPath)) {
    return { latest_sequence: 0 };
  }
  const parsed = JSON.parse(readFileSync(cursorPath, "utf8")) as unknown;
  if (!isRelayCursor(parsed)) {
    throw new Error(`Vital Agent Sync relay cursor is invalid at ${cursorPath}.`);
  }
  return parsed;
}

function writeRelayCursor(stateDir: string, cursor: RelayCursor): void {
  const cursorPath = getRelayCursorPath(stateDir);
  const pendingPath = `${cursorPath}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  mkdirSync(dirname(cursorPath), { recursive: true });
  try {
    writeFileSync(pendingPath, `${JSON.stringify(cursor, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    try {
      chmodSync(pendingPath, 0o600);
    } catch {
      // Windows and some filesystems may not support POSIX modes.
    }
    renameSync(pendingPath, cursorPath);
  } finally {
    rmSync(pendingPath, { force: true });
  }
}

function isRelayCursor(value: unknown): value is RelayCursor {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const cursor = value as RelayCursor;
  return Number.isInteger(cursor.latest_sequence) &&
    cursor.latest_sequence >= 0 &&
    (cursor.processed_envelope_ids === undefined || Array.isArray(cursor.processed_envelope_ids)) &&
    (cursor.last_successful_pull_at === undefined || typeof cursor.last_successful_pull_at === "string") &&
    (cursor.last_failed_envelope_id === undefined || typeof cursor.last_failed_envelope_id === "string") &&
    (cursor.last_failed_at === undefined || typeof cursor.last_failed_at === "string") &&
    (cursor.last_error === undefined || typeof cursor.last_error === "string");
}

function isRelayListResponse(value: unknown): value is { envelopes: unknown[] } {
  return typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { envelopes?: unknown }).envelopes);
}

function relayDataHeaders(accessToken: string | undefined, apiToken: string | undefined): HeadersInit {
  const headers: Record<string, string> = {};
  const normalizedAccessToken = normalizeOptionalToken(accessToken);
  const normalizedApiToken = normalizeOptionalToken(apiToken);
  if (normalizedAccessToken) {
    headers.authorization = `Bearer ${normalizedAccessToken}`;
  }
  if (normalizedApiToken) {
    headers["x-healthlink-relay-api-key"] = normalizedApiToken;
  }
  return headers;
}

function normalizeOptionalToken(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function capProcessedEnvelopeIds(values: Set<string>, max = 1000): string[] {
  return Array.from(values).slice(-max);
}
