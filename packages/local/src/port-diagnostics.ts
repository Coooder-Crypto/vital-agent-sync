import { execFileSync } from "node:child_process";

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
