import Fastify from "fastify";
import { networkInterfaces } from "node:os";
import { createPairingSession } from "./pairing.js";

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

  app.get("/health/status", async () => ({
    ok: true,
    service: "healthlink-local",
    status: "running"
  }));

  app.post("/pair/start", async () => createPairingSession({
    serverUrl: advertisedUrl,
    agentName: "Local Agent"
  }));

  await app.listen({
    host: options.host,
    port: options.port
  });

  printStartupInfo(options);
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
