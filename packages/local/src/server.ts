import Fastify from "fastify";
import { networkInterfaces } from "node:os";
import QRCode from "qrcode";
import { z } from "zod";
import { PairingError, PairingStore } from "./pairing.js";

export type LocalServerOptions = {
  host: string;
  port: number;
  databasePath?: string;
};

export async function startLocalServer(options: LocalServerOptions): Promise<void> {
  const app = Fastify({
    logger: true
  });
  const advertisedUrl = `http://${getAdvertisedHost(options.host)}:${options.port}`;
  const pairings = new PairingStore();

  app.get("/health/status", async () => ({
    ok: true,
    service: "healthlink-local",
    status: "running"
  }));

  app.get("/pair", async (_request, reply) => {
    const session = pairings.createSession({
      serverUrl: advertisedUrl,
      agentName: "Local Agent"
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

  app.post("/pair/start", async () => pairings.createSession({
    serverUrl: advertisedUrl,
    agentName: "Local Agent"
  }));

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

  printStartupInfo(options);
}

const pairingStatusParamsSchema = z.object({
  pairing_code: z.string().min(1)
});

const confirmPairingSchema = z.object({
  pairing_code: z.string().min(1),
  device_name: z.string().trim().min(1).max(120),
  device_platform: z.literal("ios"),
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

function printStartupInfo(options: LocalServerOptions): void {
  const loopback = `http://127.0.0.1:${options.port}`;
  const lan = `http://${getAdvertisedHost(options.host)}:${options.port}`;
  console.log("");
  console.log("HealthLink Local running");
  console.log("");
  console.log(`Pairing page: ${loopback}/pair`);
  console.log(`LAN address:  ${lan}`);
  console.log(`Local API:    ${loopback}`);
  console.log(`Bind host:    ${options.host}`);
  console.log(`Database:     ${options.databasePath ?? "~/.healthlink/healthlink.sqlite"}`);
  console.log("");
}

function getAdvertisedHost(bindHost: string): string {
  if (bindHost !== "0.0.0.0" && bindHost !== "::") {
    return bindHost;
  }

  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === "IPv4" && !address.internal) {
        return address.address;
      }
    }
  }

  return "127.0.0.1";
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
