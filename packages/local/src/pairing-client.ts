import type { TransportProviderId } from "./transports.js";

export type PairingClientOptions = {
  port: number;
  agentName: string;
  transport: TransportProviderId;
  serverUrl?: string;
  fetchImpl?: typeof fetch;
};

export type PairingClientSession = {
  pairing_code: string;
  pairing_url: string;
  expires_in_seconds: number;
};

export async function requestPairingSession(options: PairingClientOptions): Promise<PairingClientSession> {
  const endpoint = `http://127.0.0.1:${options.port}/pair/start`;
  const fetchImpl = options.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        agent_name: options.agentName,
        transport: options.transport,
        server_url: options.serverUrl
      })
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Vital Agent Sync receiver is not reachable at ${endpoint}. Run vitalmcp service start or vitalmcp setup first. ${detail}`);
  }
  if (!response.ok) {
    throw new Error(`Vital Agent Sync receiver rejected pairing request: HTTP ${response.status}`);
  }
  const body = await response.json() as {
    pairing_code?: unknown;
    pairing_url?: unknown;
    expires_in_seconds?: unknown;
  };
  if (typeof body.pairing_code !== "string" || typeof body.pairing_url !== "string" || typeof body.expires_in_seconds !== "number") {
    throw new Error("Vital Agent Sync receiver returned an invalid pairing response.");
  }
  return {
    pairing_code: body.pairing_code,
    pairing_url: body.pairing_url,
    expires_in_seconds: body.expires_in_seconds
  };
}
