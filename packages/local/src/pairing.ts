import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { HealthLinkDatabase } from "./database.js";
import type { SourcePlatform } from "./source-devices.js";
import type { TransportProviderId } from "./transports.js";

export const defaultScopes = [
  "health.daily_summary.write"
] as const;

export type HealthLinkScope = typeof defaultScopes[number];

export type PairingSession = {
  pairing_code: string;
  pairing_url: string;
  server_url: string;
  agent_name: string;
  transport: TransportProviderId;
  requested_scopes: string[];
  expires_in_seconds: number;
  expires_at: string;
};

export type PairingRecord = Omit<PairingSession, "expires_at"> & {
  created_at: Date;
  expires_at: Date;
  consumed_at?: Date;
};

export type ConfirmPairingInput = {
  pairing_code: string;
  device_name: string;
  device_platform: SourcePlatform;
  accepted_scopes: string[];
};

export type PairedDevice = {
  device_id: string;
  device_name: string;
  device_platform: SourcePlatform;
  token_hash: string;
  accepted_scopes: string[];
  created_at: Date;
};

export type ConfirmPairingResult = {
  device_id: string;
  device_token: string;
  server_time: string;
};

export class PairingStore {
  constructor(
    private readonly database: HealthLinkDatabase,
    private readonly directPublicKey?: string
  ) {}

  createSession(input: {
    serverUrl: string;
    agentName: string;
    transport?: TransportProviderId;
    expiresInSeconds?: number;
  }): PairingSession {
    this.pruneExpiredSessions();

    const expiresInSeconds = input.expiresInSeconds ?? 600;
    const code = createPairingCode();
    const pairingUrl = new URL("vitalmcp://pair");
    pairingUrl.searchParams.set("server", input.serverUrl);
    pairingUrl.searchParams.set("code", code);
    pairingUrl.searchParams.set("transport", input.transport ?? "lan");
    if (this.directPublicKey) {
      pairingUrl.searchParams.set("key", this.directPublicKey);
    }

    const now = new Date();
    const session: PairingRecord = {
      pairing_code: code,
      pairing_url: pairingUrl.toString(),
      server_url: input.serverUrl,
      agent_name: input.agentName,
      transport: input.transport ?? "lan",
      requested_scopes: [...defaultScopes],
      expires_in_seconds: expiresInSeconds,
      created_at: now,
      expires_at: new Date(now.getTime() + expiresInSeconds * 1000)
    };

    this.database.sqlite.prepare(`
      insert into pairing_sessions (
        code,
        pairing_url,
        server_url,
        agent_name,
        transport,
        requested_scopes_json,
        expires_in_seconds,
        created_at,
        expires_at,
        consumed_at
      ) values (
        @code,
        @pairingUrl,
        @serverUrl,
        @agentName,
        @transport,
        @requestedScopesJson,
        @expiresInSeconds,
        @createdAt,
        @expiresAt,
        null
      )
    `).run({
      code: session.pairing_code,
      pairingUrl: session.pairing_url,
      serverUrl: session.server_url,
      agentName: session.agent_name,
      transport: session.transport,
      requestedScopesJson: JSON.stringify(session.requested_scopes),
      expiresInSeconds: session.expires_in_seconds,
      createdAt: session.created_at.toISOString(),
      expiresAt: session.expires_at.toISOString()
    });

    return toPublicSession(session);
  }

  getSession(code: string): PairingRecord | undefined {
    const row = this.database.sqlite.prepare(`
      select
        code,
        pairing_url as pairingUrl,
        server_url as serverUrl,
        agent_name as agentName,
        transport,
        requested_scopes_json as requestedScopesJson,
        expires_in_seconds as expiresInSeconds,
        created_at as createdAt,
        expires_at as expiresAt,
        consumed_at as consumedAt
      from pairing_sessions
      where code = ?
    `).get(normalizePairingCode(code)) as PairingSessionRow | undefined;

    const session = row ? rowToPairingRecord(row) : undefined;
    if (!session) {
      return undefined;
    }
    if (isExpired(session)) {
      this.database.sqlite.prepare(`
        delete from pairing_sessions
        where code = ? and consumed_at is null
      `).run(session.pairing_code);
      return undefined;
    }
    return session;
  }

  confirm(input: ConfirmPairingInput): ConfirmPairingResult {
    const code = normalizePairingCode(input.pairing_code);
    const session = this.getSession(code);
    if (!session) {
      throw new PairingError("pairing_not_found", "Pairing code was not found or has expired.");
    }
    if (session.consumed_at) {
      throw new PairingError("pairing_already_used", "Pairing code has already been used.");
    }

    for (const scope of input.accepted_scopes) {
      if (!session.requested_scopes.includes(scope)) {
        throw new PairingError("invalid_scope", `Scope is not requested by this session: ${scope}`);
      }
    }

    const deviceToken = `hl_dev_${randomBytes(32).toString("base64url")}`;
    const consumedAt = new Date();
    const device: PairedDevice = {
      device_id: `dev_${randomUUID().replaceAll("-", "")}`,
      device_name: input.device_name,
      device_platform: input.device_platform,
      token_hash: hashToken(deviceToken),
      accepted_scopes: [...input.accepted_scopes],
      created_at: consumedAt
    };

    const persist = this.database.sqlite.transaction(() => {
      const updateResult = this.database.sqlite.prepare(`
        update pairing_sessions
        set consumed_at = ?
        where code = ? and consumed_at is null
      `).run(consumedAt.toISOString(), session.pairing_code);

      if (updateResult.changes !== 1) {
        throw new PairingError("pairing_already_used", "Pairing code has already been used.");
      }

      this.database.sqlite.prepare(`
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
          @platform,
          @tokenHash,
          @scopesJson,
          @createdAt,
          null
        )
      `).run({
        id: device.device_id,
        name: device.device_name,
        platform: device.device_platform,
        tokenHash: device.token_hash,
        scopesJson: JSON.stringify(device.accepted_scopes),
        createdAt: device.created_at.toISOString()
      });
    });

    persist();

    return {
      device_id: device.device_id,
      device_token: deviceToken,
      server_time: new Date().toISOString()
    };
  }

  getStatus(code: string): {
    pairing_code: string;
    server_url: string;
    agent_name: string;
    transport: TransportProviderId;
    requested_scopes: string[];
    status: "pending" | "confirmed";
    expires_at: string;
    consumed_at?: string;
  } {
    const session = this.getSession(code);
    if (!session) {
      throw new PairingError("pairing_not_found", "Pairing code was not found or has expired.");
    }

    return {
      pairing_code: session.pairing_code,
      server_url: session.server_url,
      agent_name: session.agent_name,
      transport: session.transport,
      requested_scopes: session.requested_scopes,
      status: session.consumed_at ? "confirmed" : "pending",
      expires_at: session.expires_at.toISOString(),
      consumed_at: session.consumed_at?.toISOString()
    };
  }

  private pruneExpiredSessions(): void {
    this.database.sqlite.prepare(`
      delete from pairing_sessions
      where consumed_at is null and expires_at <= ?
    `).run(new Date().toISOString());
  }
}

type PairingSessionRow = {
  code: string;
  pairingUrl: string;
  serverUrl: string;
  agentName: string;
  transport: TransportProviderId;
  requestedScopesJson: string;
  expiresInSeconds: number;
  createdAt: string;
  expiresAt: string;
  consumedAt: string | null;
};

function createPairingCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(8);
  const chars = Array.from(bytes, (byte) => alphabet[byte % alphabet.length]);
  return `${chars.slice(0, 4).join("")}-${chars.slice(4, 8).join("")}`;
}

function normalizePairingCode(code: string): string {
  return code.trim().toUpperCase();
}

function isExpired(session: PairingRecord): boolean {
  return session.expires_at.getTime() <= Date.now();
}

function toPublicSession(session: PairingRecord): PairingSession {
  return {
    pairing_code: session.pairing_code,
    pairing_url: session.pairing_url,
    server_url: session.server_url,
    agent_name: session.agent_name,
    transport: session.transport,
    requested_scopes: session.requested_scopes,
    expires_in_seconds: session.expires_in_seconds,
    expires_at: session.expires_at.toISOString()
  };
}

function rowToPairingRecord(row: PairingSessionRow): PairingRecord {
  return {
    pairing_code: row.code,
    pairing_url: row.pairingUrl,
    server_url: row.serverUrl,
    agent_name: row.agentName,
    transport: row.transport,
    requested_scopes: parseScopes(row.requestedScopesJson),
    expires_in_seconds: row.expiresInSeconds,
    created_at: new Date(row.createdAt),
    expires_at: new Date(row.expiresAt),
    consumed_at: row.consumedAt ? new Date(row.consumedAt) : undefined
  };
}

function parseScopes(value: string): string[] {
  const parsed = JSON.parse(value) as unknown;
  return Array.isArray(parsed) ? parsed.filter((scope): scope is string => typeof scope === "string") : [];
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export class PairingError extends Error {
  constructor(
    readonly code: "pairing_not_found" | "pairing_already_used" | "invalid_scope",
    message: string
  ) {
    super(message);
  }
}
