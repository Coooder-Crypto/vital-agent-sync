import { createHash, randomBytes, randomUUID } from "node:crypto";

export const defaultScopes = [
  "health.daily_summary.write",
  "calendar.daily_summary.write"
] as const;

export type HealthLinkScope = typeof defaultScopes[number];

export type PairingSession = {
  pairing_code: string;
  pairing_url: string;
  server_url: string;
  agent_name: string;
  requested_scopes: string[];
  expires_in_seconds: number;
};

export type PairingRecord = PairingSession & {
  created_at: Date;
  expires_at: Date;
  consumed_at?: Date;
};

export type ConfirmPairingInput = {
  pairing_code: string;
  device_name: string;
  device_platform: "ios";
  accepted_scopes: string[];
};

export type PairedDevice = {
  device_id: string;
  device_name: string;
  device_platform: "ios";
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
  private readonly sessions = new Map<string, PairingRecord>();
  private readonly devices = new Map<string, PairedDevice>();

  createSession(input: {
    serverUrl: string;
    agentName: string;
    expiresInSeconds?: number;
  }): PairingSession {
    this.pruneExpiredSessions();

    const expiresInSeconds = input.expiresInSeconds ?? 600;
    const code = createPairingCode();
    const pairingUrl = new URL("healthlink://pair");
    pairingUrl.searchParams.set("server", input.serverUrl);
    pairingUrl.searchParams.set("code", code);

    const now = new Date();
    const session: PairingRecord = {
      pairing_code: code,
      pairing_url: pairingUrl.toString(),
      server_url: input.serverUrl,
      agent_name: input.agentName,
      requested_scopes: [...defaultScopes],
      expires_in_seconds: expiresInSeconds,
      created_at: now,
      expires_at: new Date(now.getTime() + expiresInSeconds * 1000)
    };

    this.sessions.set(code, session);
    return toPublicSession(session);
  }

  getSession(code: string): PairingRecord | undefined {
    const session = this.sessions.get(normalizePairingCode(code));
    if (!session) {
      return undefined;
    }
    if (isExpired(session)) {
      this.sessions.delete(session.pairing_code);
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
    const device: PairedDevice = {
      device_id: `dev_${randomUUID().replaceAll("-", "")}`,
      device_name: input.device_name,
      device_platform: input.device_platform,
      token_hash: hashToken(deviceToken),
      accepted_scopes: [...input.accepted_scopes],
      created_at: new Date()
    };

    session.consumed_at = new Date();
    this.devices.set(device.device_id, device);

    return {
      device_id: device.device_id,
      device_token: deviceToken,
      server_time: new Date().toISOString()
    };
  }

  getStatus(code: string): {
    pairing_code: string;
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
      status: session.consumed_at ? "confirmed" : "pending",
      expires_at: session.expires_at.toISOString(),
      consumed_at: session.consumed_at?.toISOString()
    };
  }

  private pruneExpiredSessions(): void {
    for (const session of this.sessions.values()) {
      if (isExpired(session)) {
        this.sessions.delete(session.pairing_code);
      }
    }
  }
}

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
    requested_scopes: session.requested_scopes,
    expires_in_seconds: session.expires_in_seconds
  };
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
