import Fastify from "fastify";
import QRCode from "qrcode";
import { z } from "zod";
import { openVitalAgentDatabase } from "./database.js";
import { listDevices, revokeDevice } from "./devices.js";
import {
  DirectTransportError,
  claimDirectRequest,
  decryptDirectRequest,
  encryptDirectResponse,
  loadOrCreateDirectTransportKey
} from "./direct-transport.js";
import {
  HealthIngestError,
  authenticateDevice,
  getHealthStatus,
  ingestValidatedHealthSync
} from "./health-ingest.js";
import { PairingError, PairingStore } from "./pairing.js";
import { getReceiverRuntimeStatus } from "./runtime-status.js";
import { SOURCE_PLATFORMS, listSourceDevices } from "./source-devices.js";
import { type TerminalQrRenderResult, renderTerminalQr } from "./terminal-qr.js";
import { createTransportProvider, TRANSPORT_PROVIDER_IDS, type TransportProviderId } from "./transports.js";

export type LocalServerOptions = {
  host: string;
  port: number;
  databasePath?: string;
  serverUrl?: string;
  tailscaleName?: string;
  transport?: TransportProviderId;
  agentName?: string;
  mode?: "server" | "init";
};

export async function startLocalServer(options: LocalServerOptions): Promise<void> {
  const app = Fastify({
    logger: true
  });
  const transport = createTransportProvider({
    id: options.transport,
    bindHost: options.host,
    port: options.port,
    serverUrl: options.serverUrl,
    tailscaleName: options.tailscaleName
  });
  await transport.start?.();
  const advertisedUrl = await transport.getAdvertisedUrl();
  const agentName = options.agentName ?? "Local Agent";
  const database = openVitalAgentDatabase({
    path: options.databasePath
  });
  const directTransportKey = loadOrCreateDirectTransportKey(database.path);
  const pairings = new PairingStore(database, directTransportKey.publicKeyRaw);

  app.addHook("onClose", async () => {
    await transport.stop?.();
    database.close();
  });

  app.get("/health/status", async () => getHealthStatus(database));

  app.get("/runtime/status", async (request, reply) => {
    if (!isLoopbackAddress(request.ip)) {
      return reply.code(403).send(errorResponse("local_status_only", "Runtime identity is only available from the receiver host."));
    }
    return getReceiverRuntimeStatus(database);
  });

  app.get("/devices", async () => ({
    ok: true,
    devices: listDevices(database)
  }));

  app.get("/source-devices", async () => ({
    ok: true,
    source_devices: listSourceDevices(database)
  }));

  app.post("/devices/:device_id/revoke", plaintextDirectTransportDisabled);
  app.post("/source-devices/:source_device_id/revoke", plaintextDirectTransportDisabled);
  app.post("/health/sync", plaintextDirectTransportDisabled);

  app.get("/pair", async (request, reply) => {
    if (!isLoopbackAddress(request.ip)) {
      return reply.code(403).send(errorResponse("local_pairing_only", "Pairing sessions can only be created from the receiver host."));
    }
    const session = pairings.createSession({
      serverUrl: advertisedUrl,
      agentName,
      transport: transport.id
    });
    const qrDataUrl = await QRCode.toDataURL(session.pairing_url, {
      margin: 1,
      width: 280
    });

    return reply
      .type("text/html; charset=utf-8")
      .send(renderPairingPage({
        pairingCode: session.pairing_code,
        pairingUrl: session.pairing_url,
        qrDataUrl,
        serverUrl: session.server_url,
        expiresInSeconds: session.expires_in_seconds,
        requestedScopes: session.requested_scopes
      }));
  });

  app.post("/pair/start", async (request, reply) => {
    if (!isLoopbackAddress(request.ip)) {
      return reply.code(403).send(errorResponse("local_pairing_only", "Pairing sessions can only be created from the receiver host."));
    }
    const body = startPairingSchema.safeParse(request.body ?? {});
    if (!body.success) {
      return reply.code(400).send(errorResponse("invalid_payload", body.error.issues[0]?.message ?? "Invalid payload."));
    }

    return pairings.createSession({
      serverUrl: body.data.server_url ?? advertisedUrl,
      agentName: body.data.agent_name ?? agentName,
      transport: body.data.transport ?? transport.id
    });
  });

  app.get("/pair/status/:pairing_code", plaintextDirectTransportDisabled);
  app.post("/pair/confirm", plaintextDirectTransportDisabled);

  app.post("/v1/direct", async (request, reply) => {
    let decrypted: ReturnType<typeof decryptDirectRequest>;
    try {
      decrypted = decryptDirectRequest({ key: directTransportKey, envelope: request.body });
      claimDirectRequest(database, decrypted.envelope.request_id, decrypted.envelope.created_at);
    } catch (error) {
      if (error instanceof DirectTransportError) {
        return reply
          .code(error.code === "replayed_envelope" ? 409 : 400)
          .send(errorResponse(error.code, error.message));
      }
      throw error;
    }

    try {
      const result = handleDirectRequest(database, pairings, decrypted.envelope.purpose, decrypted.plaintext);
      return encryptDirectResponse(decrypted.response, result);
    } catch (error) {
      if (error instanceof PairingError) {
        return reply
          .code(error.code === "pairing_not_found" ? 404 : 409)
          .send(errorResponse(error.code, error.message));
      }
      if (error instanceof z.ZodError) {
        return reply.code(400).send(errorResponse("invalid_payload", "Encrypted direct request payload is invalid."));
      }
      return sendHealthIngestError(reply, error);
    }
  });

  await app.listen({
    host: options.host,
    port: options.port
  });

  const initialSession = options.mode === "init"
    ? pairings.createSession({
        serverUrl: advertisedUrl,
        agentName,
        transport: transport.id
      })
    : undefined;

  const initialQr = initialSession
    ? renderTerminalQr(initialSession.pairing_url)
    : undefined;

  printStartupInfo(options, database.path, advertisedUrl, transport.label, initialSession, initialQr);
}

const startPairingSchema = z.object({
  agent_name: z.string().trim().min(1).max(120).optional(),
  transport: z.enum(TRANSPORT_PROVIDER_IDS).optional(),
  server_url: z.string().url().optional()
});

const confirmPairingSchema = z.object({
  pairing_code: z.string().min(1),
  device_name: z.string().trim().min(1).max(120),
  device_platform: z.enum(SOURCE_PLATFORMS),
  accepted_scopes: z.array(z.string().min(1)).min(1)
});

const directPairingStatusSchema = z.object({
  pairing_code: z.string().min(1)
});

const directHealthSyncSchema = z.object({
  device_token: z.string().min(1),
  payload: z.unknown()
});

const directDeviceRevokeSchema = z.object({
  device_token: z.string().min(1),
  device_id: z.string().min(1)
});

export function handleDirectRequest(
  database: ReturnType<typeof openVitalAgentDatabase>,
  pairings: PairingStore,
  purpose: ReturnType<typeof decryptDirectRequest>["envelope"]["purpose"],
  plaintext: unknown
): unknown {
  switch (purpose) {
  case "pair.status":
    return pairings.getStatus(directPairingStatusSchema.parse(plaintext).pairing_code);
  case "pair.confirm":
    return pairings.confirm(confirmPairingSchema.parse(plaintext));
  case "health.sync": {
    const body = directHealthSyncSchema.parse(plaintext);
    const device = authenticateDevice(database, `Bearer ${body.device_token}`);
    return ingestValidatedHealthSync(database, device, body.payload);
  }
  case "device.revoke": {
    const body = directDeviceRevokeSchema.parse(plaintext);
    const device = authenticateDevice(database, `Bearer ${body.device_token}`);
    if (device.device_id !== body.device_id) {
      throw new HealthIngestError("device_mismatch", "Device token cannot revoke another device.");
    }
    const revoked = revokeDevice(database, body.device_id);
    if (!revoked) {
      throw new HealthIngestError("invalid_token", "Device was not found.");
    }
    return { ok: true, device: revoked };
  }
  }
}

function plaintextDirectTransportDisabled(_request: unknown, reply: {
  code: (statusCode: number) => { send: (payload: unknown) => unknown };
}): unknown {
  return reply.code(426).send(errorResponse(
    "encrypted_direct_transport_required",
    "Direct pairing and health sync require the encrypted vital-agent-direct-v1 transport."
  ));
}

export function isLoopbackAddress(address: string): boolean {
  const normalized = address.toLowerCase();
  return normalized === "127.0.0.1" || normalized === "::1" || normalized === "::ffff:127.0.0.1";
}

function sendPairingError(reply: {
  code: (statusCode: number) => { send: (payload: unknown) => unknown };
}, error: unknown): unknown {
  if (error instanceof PairingError) {
    const statusCode = error.code === "pairing_not_found" ? 404 : 409;
    return reply.code(statusCode).send(errorResponse(error.code, error.message));
  }

  throw error;
}

function sendHealthIngestError(reply: {
  code: (statusCode: number) => { send: (payload: unknown) => unknown };
}, error: unknown): unknown {
  if (error instanceof HealthIngestError) {
    const statusCode = healthIngestStatusCode(error.code);
    return reply.code(statusCode).send(errorResponse(error.code, error.message));
  }

  throw error;
}

function healthIngestStatusCode(code: HealthIngestError["code"]): number {
  switch (code) {
  case "missing_authorization":
  case "invalid_authorization":
  case "invalid_token":
    return 401;
  case "device_mismatch":
  case "missing_scope":
    return 403;
  case "invalid_payload":
    return 400;
  }
}

function errorResponse(code: string, message: string): {
  ok: false;
  error: {
    code: string;
    message: string;
  };
} {
  return {
    ok: false,
    error: {
      code,
      message
    }
  };
}

function printStartupInfo(
  options: LocalServerOptions,
  databasePath: string,
  advertisedUrl: string,
  transportLabel: string,
  initialSession?: {
    pairing_code: string;
    pairing_url: string;
    expires_in_seconds: number;
  },
  initialQr?: TerminalQrRenderResult
): void {
  const loopback = `http://127.0.0.1:${options.port}`;
  console.log("");
  console.log("Vital Agent Sync running");
  console.log("");
  console.log(`Pairing page: ${loopback}/pair`);
  console.log(`${transportLabel} address:  ${advertisedUrl}`);
  console.log(`Local API:    ${loopback}`);
  console.log(`Bind host:    ${options.host}`);
  console.log(`Database:     ${databasePath}`);
  if (initialSession) {
    console.log("");
    console.log("Pair with iPhone:");
    console.log(`Expires:      ${Math.round(initialSession.expires_in_seconds / 60)} minutes`);
    if (initialQr) {
      console.log("");
      if (initialQr.rendered) {
        console.log("Scan QR:");
        console.log(initialQr.text);
      } else {
        console.log(`Scan QR: terminal is too narrow (${initialQr.requiredColumns} columns needed).`);
        console.log(`Open ${loopback}/pair on the receiver host to scan the browser QR.`);
      }
    }
  }
  console.log("");
}

function renderPairingPage(input: {
  pairingCode: string;
  pairingUrl: string;
  qrDataUrl: string;
  serverUrl: string;
  expiresInSeconds: number;
  requestedScopes: string[];
}): string {
  const scopes = input.requestedScopes
    .map((scope) => `<li>${escapeHtml(scope)}</li>`)
    .join("");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Pair Vital Agent Sync</title>
    <style>
      :root {
        color-scheme: light dark;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: #f3f4f6;
        color: #111827;
      }
      main {
        width: min(92vw, 520px);
        padding: 28px;
        border: 1px solid #d1d5db;
        border-radius: 8px;
        background: #ffffff;
        box-shadow: 0 18px 45px rgba(17, 24, 39, 0.08);
      }
      h1 {
        margin: 0 0 8px;
        font-size: 28px;
        line-height: 1.1;
      }
      p {
        margin: 0;
        color: #4b5563;
        line-height: 1.5;
      }
      .qr {
        display: grid;
        place-items: center;
        margin: 24px 0;
      }
      .qr img {
        width: 280px;
        height: 280px;
        border: 1px solid #e5e7eb;
        border-radius: 8px;
      }
      .code {
        margin: 18px 0 12px;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 34px;
        font-weight: 700;
        letter-spacing: 2px;
        text-align: center;
      }
      dl {
        display: grid;
        grid-template-columns: 120px 1fr;
        gap: 8px 12px;
        margin: 18px 0 0;
        font-size: 14px;
      }
      dt {
        color: #6b7280;
      }
      dd {
        margin: 0;
        overflow-wrap: anywhere;
      }
      ul {
        margin: 6px 0 0;
        padding-left: 18px;
      }
      @media (prefers-color-scheme: dark) {
        body {
          background: #111827;
          color: #f9fafb;
        }
        main {
          background: #1f2937;
          border-color: #374151;
          box-shadow: none;
        }
        p, dt {
          color: #d1d5db;
        }
        .qr img {
          border-color: #374151;
        }
      }
    </style>
  </head>
  <body>
    <main>
      <h1>Pair Vital Agent Sync</h1>
      <p>Scan this QR code with the Vital Agent app to connect this local Agent server.</p>
      <div class="qr">
        <img src="${input.qrDataUrl}" alt="Vital Agent Sync pairing QR code">
      </div>
      <div class="code">${escapeHtml(input.pairingCode)}</div>
      <dl>
        <dt>Server</dt>
        <dd>${escapeHtml(input.serverUrl)}</dd>
        <dt>Expires</dt>
        <dd>${Math.round(input.expiresInSeconds / 60)} minutes</dd>
        <dt>Scopes</dt>
        <dd><ul>${scopes}</ul></dd>
        <dt>Pairing URL</dt>
        <dd>${escapeHtml(input.pairingUrl)}</dd>
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
    .replaceAll("'", "&#039;");
}
