import { randomBytes } from "node:crypto";

const defaultScopes = [
  "health.daily_summary.write",
  "calendar.daily_summary.write"
] as const;

export type PairingSession = {
  pairing_code: string;
  pairing_url: string;
  server_url: string;
  agent_name: string;
  requested_scopes: string[];
  expires_in_seconds: number;
};

export function createPairingSession(input: {
  serverUrl: string;
  agentName: string;
}): PairingSession {
  const code = createPairingCode();
  const pairingUrl = new URL("healthlink://pair");
  pairingUrl.searchParams.set("server", input.serverUrl);
  pairingUrl.searchParams.set("code", code);

  return {
    pairing_code: code,
    pairing_url: pairingUrl.toString(),
    server_url: input.serverUrl,
    agent_name: input.agentName,
    requested_scopes: [...defaultScopes],
    expires_in_seconds: 600
  };
}

function createPairingCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(8);
  const chars = Array.from(bytes, (byte) => alphabet[byte % alphabet.length]);
  return `${chars.slice(0, 4).join("")}-${chars.slice(4, 8).join("")}`;
}

