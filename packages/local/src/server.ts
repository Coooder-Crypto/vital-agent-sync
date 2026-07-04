import Fastify from "fastify";
import QRCode from "qrcode";
import { z } from "zod";
import { openHealthLinkDatabase } from "./database.js";
import { listDevices, revokeDevice } from "./devices.js";
import {
  HealthIngestError,
  authenticateDevice,
  getHealthStatus,
  ingestHealthSync,
  parseHealthSyncPayload
} from "./health-ingest.js";
import { PairingError, PairingStore } from "./pairing.js";
import { SOURCE_PLATFORMS } from "./source-devices.js";
import { type TerminalQrRenderResult, renderTerminalQr } from "./terminal-qr.js";
import { createTransportProvider, TRANSPORT_PROVIDER_IDS, type TransportProviderId } from "./transports.js";

export type LocalServerOptions = {
  host: string;
  port: number;
  databasePath?: string;
  serverUrl?: string;
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
    serverUrl: options.serverUrl
  });
  await transport.start?.();
  const advertisedUrl = await transport.getAdvertisedUrl();
  const agentName = options.agentName ?? "Local Agent";
  const database = openHealthLinkDatabase({
    path: options.databasePath
  });
  const pairings = new PairingStore(database);

  app.addHook("onClose", async () => {
    await transport.stop?.();
    database.close();
  });

  app.get("/health/status", async () => getHealthStatus(database));

  app.get("/devices", async () => ({
    ok: true,
    devices: listDevices(database)
  }));

  app.post("/devices/:device_id/revoke", async (request, reply) => {
    const params = deviceParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send(errorResponse("invalid_params", "device_id is required."));
    }

    try {
      const device = authenticateDevice(database, request.headers.authorization);
      if (device.device_id !== params.data.device_id) {
        return reply.code(403).send(errorResponse("device_mismatch", "Device token cannot revoke another device."));
      }

      const revoked = revokeDevice(database, params.data.device_id);
      if (!revoked) {
        return reply.code(404).send(errorResponse("device_not_found", "Device was not found."));
      }

      return {
        ok: true,
        device: revoked
      };
    } catch (error) {
      return sendHealthIngestError(reply, error);
    }
  });

  app.post("/health/sync", async (request, reply) => {
    try {
      const device = authenticateDevice(database, request.headers.authorization);
      const payload = parseHealthSyncPayload(request.body);
      return ingestHealthSync(database, device, payload);
    } catch (error) {
      return sendHealthIngestError(reply, error);
    }
  });

  app.get("/pair", async (_request, reply) => {
    const session = pairings.createSession({
      serverUrl: advertisedUrl,
      agentName
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
    const body = startPairingSchema.safeParse(request.body ?? {});
    if (!body.success) {
      return reply.code(400).send(errorResponse("invalid_payload", body.error.issues[0]?.message ?? "Invalid payload."));
    }

    return pairings.createSession({
      serverUrl: body.data.server_url ?? advertisedUrl,
      agentName: body.data.agent_name ?? agentName
    });
  });

  app.get("/pair/status/:pairing_code", async (request, reply) => {
    const params = pairingStatusParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send(errorResponse("invalid_params", "pairing_code is required."));
    }

    try {
      return pairings.getStatus(params.data.pairing_code);
    } catch (error) {
      return sendPairingError(reply, error);
    }
  });

  app.post("/pair/confirm", async (request, reply) => {
    const body = confirmPairingSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send(errorResponse("invalid_payload", body.error.issues[0]?.message ?? "Invalid payload."));
    }

    try {
      return pairings.confirm(body.data);
    } catch (error) {
      return sendPairingError(reply, error);
    }
  });

  await app.listen({
    host: options.host,
    port: options.port
  });

  const initialSession = options.mode === "init"
    ? pairings.createSession({
        serverUrl: advertisedUrl,
        agentName
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

const pairingStatusParamsSchema = z.object({
  pairing_code: z.string().min(1)
});

const deviceParamsSchema = z.object({
  device_id: z.string().min(1)
});

const confirmPairingSchema = z.object({
  pairing_code: z.string().min(1),
  device_name: z.string().trim().min(1).max(120),
  device_platform: z.enum(SOURCE_PLATFORMS),
  accepted_scopes: z.array(z.string().min(1)).min(1)
});

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
  console.log("HealthLink Local running");
  console.log("");
  console.log(`Pairing page: ${loopback}/pair`);
  console.log(`${transportLabel} address:  ${advertisedUrl}`);
  console.log(`Local API:    ${loopback}`);
  console.log(`Bind host:    ${options.host}`);
  console.log(`Database:     ${databasePath}`);
  if (initialSession) {
    console.log("");
    console.log("Pair with iPhone:");
    console.log(`Pairing code: ${initialSession.pairing_code}`);
    console.log(`Pairing URL:  ${initialSession.pairing_url}`);
    console.log(`Expires:      ${Math.round(initialSession.expires_in_seconds / 60)} minutes`);
    if (initialQr) {
      console.log("");
      if (initialQr.rendered) {
        console.log("Scan QR:");
        console.log(initialQr.text);
      } else {
        console.log(`Scan QR: terminal is too narrow (${initialQr.requiredColumns} columns needed).`);
        console.log(`Open ${loopback}/pair to scan the browser QR, or paste the Pairing URL in the app.`);
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
    <title>Pair HealthLink</title>
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
      <h1>Pair HealthLink</h1>
      <p>Scan this QR code with HealthLink iOS to connect this local Agent server.</p>
      <div class="qr">
        <img src="${input.qrDataUrl}" alt="HealthLink pairing QR code">
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
