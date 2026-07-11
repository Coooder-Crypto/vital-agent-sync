import { execFileSync } from "node:child_process";
import { createServer } from "node:net";

export type PortListener = {
  command: string;
  pid: string;
  user: string;
  name: string;
};

export function getTcpPortListeners(port: number): PortListener[] {
  if (!Number.isInteger(port) || port <= 0) {
    return [];
  }

  try {
    const output = execFileSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    });
    return parseLsofListenOutput(output);
  } catch {
    return [];
  }
}

export function parseLsofListenOutput(output: string): PortListener[] {
  return output
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const parts = line.split(/\s+/);
      return {
        command: parts[0] ?? "",
        pid: parts[1] ?? "",
        user: parts[2] ?? "",
        name: parts.slice(8).join(" ")
      };
    })
    .filter((listener) => listener.command.length > 0 && listener.pid.length > 0);
}

export function describePortListeners(port: number): string | undefined {
  const listeners = getTcpPortListeners(port);
  if (listeners.length === 0) {
    return undefined;
  }
  return listeners
    .map((listener) => `${listener.command} pid=${listener.pid} user=${listener.user} ${listener.name}`.trim())
    .join("; ");
}

export type AvailablePortResult = {
  requestedPort: number;
  port: number;
  changed: boolean;
};

export async function findAvailableTcpPort(options: {
  preferredPort: number;
  host?: string;
  maxAttempts?: number;
}): Promise<AvailablePortResult> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 20);
  const startPort = options.preferredPort;
  for (let offset = 0; offset < maxAttempts; offset += 1) {
    const port = startPort + offset;
    if (port > 65535) {
      break;
    }
    if (await canListenOnTcpPort(port, options.host)) {
      return {
        requestedPort: startPort,
        port,
        changed: port !== startPort
      };
    }
  }
  throw new Error(`Could not find an available TCP port from ${startPort} to ${Math.min(startPort + maxAttempts - 1, 65535)}.`);
}

async function canListenOnTcpPort(port: number, host = "0.0.0.0"): Promise<boolean> {
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    return false;
  }

  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => {
      resolve(false);
    });
    server.once("listening", () => {
      server.close(() => {
        resolve(true);
      });
    });
    server.listen({
      host,
      port
    });
  });
}
