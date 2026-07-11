import { networkInterfaces, type NetworkInterfaceInfo } from "node:os";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

export const TRANSPORT_PROVIDER_IDS = [
  "lan",
  "tailscale",
  "cloudflare",
  "ngrok",
  "public_https",
  "relay",
  "self_hosted_relay"
] as const;

export type TransportProviderId = typeof TRANSPORT_PROVIDER_IDS[number];

export type TransportStatus = {
  status: "ok" | "warn" | "fail";
  detail: string;
  advertisedUrl?: string;
};

export type TransportProvider = {
  id: TransportProviderId;
  label: string;
  getAdvertisedUrl(): Promise<string>;
  start?(): Promise<void>;
  healthCheck?(): Promise<TransportStatus>;
  stop?(): Promise<void>;
};

export type TransportProviderOptions = {
  id?: TransportProviderId;
  bindHost: string;
  port: number;
  serverUrl?: string;
  tailscaleName?: string;
};

export function createTransportProvider(options: TransportProviderOptions): TransportProvider {
  const id = options.id ?? "lan";
  if (id === "lan") {
    return createLanTransportProvider(options);
  }
  if (id === "tailscale") {
    return createTailscaleTransportProvider(options);
  }

  return createFutureTransportProvider({ ...options, id });
}

export function isTransportProviderId(value: string): value is TransportProviderId {
  return TRANSPORT_PROVIDER_IDS.includes(value as TransportProviderId);
}

export function getAdvertisedServerUrl(options: {
  bindHost: string;
  port: number;
  serverUrl?: string;
}): string {
  return getLanAdvertisedServerUrl(options);
}

export function getServerUrlDiagnostics(options: {
  serverUrl?: string;
  runningInContainer?: boolean;
}): TransportStatus[] {
  const results: TransportStatus[] = [];
  if (options.serverUrl && isLoopbackServerUrl(options.serverUrl)) {
    results.push({
      status: "warn",
      detail: `${normalizeServerUrl(options.serverUrl)} only works from the same machine. For iPhone, Docker, or WSL pairing, use a host LAN, Tailscale, or public HTTPS URL.`
    });
  }
  if (options.runningInContainer) {
    results.push({
      status: "warn",
      detail: options.serverUrl
        ? "Container runtime detected. Confirm --server-url points to the Docker host address that the iPhone can reach, not a container-only address."
        : "Container runtime detected. Pass --server-url with the Docker host LAN, Tailscale, or public HTTPS URL before pairing an iPhone."
    });
  }
  return results;
}

export function isContainerRuntime(): boolean {
  if (existsSync("/.dockerenv")) {
    return true;
  }
  try {
    return /docker|containerd|kubepods|podman/i.test(readFileSync("/proc/1/cgroup", "utf8"));
  } catch {
    return false;
  }
}

function createLanTransportProvider(options: TransportProviderOptions): TransportProvider {
  return {
    id: "lan",
    label: "LAN",
    async getAdvertisedUrl() {
      return getLanAdvertisedServerUrl(options);
    },
    async healthCheck() {
      const advertisedUrl = getLanAdvertisedServerUrl(options);
      const host = getAdvertisedHost(options.bindHost);
      return {
        status: host === "127.0.0.1" ? "warn" : "ok",
        detail: host === "127.0.0.1"
          ? "No non-internal IPv4 address was found; iPhone pairing may need a manual --server-url."
          : `Advertising ${advertisedUrl}`,
        advertisedUrl
      };
    }
  };
}

function createTailscaleTransportProvider(options: TransportProviderOptions): TransportProvider {
  return {
    id: "tailscale",
    label: "Tailscale",
    async getAdvertisedUrl() {
      if (options.serverUrl) {
        return normalizeServerUrl(options.serverUrl);
      }
      const magicDnsName = getTailscaleMagicDnsName(options);
      if (magicDnsName) {
        return `http://${magicDnsName}:${options.port}`;
      }
      const address = findTailscaleIpv4();
      if (!address) {
        throw new Error("Tailscale transport could not find a MagicDNS name or local 100.64.0.0/10 IPv4 address. Pass --tailscale-name, --server-url, or use --transport lan.");
      }
      return `http://${address}:${options.port}`;
    },
    async healthCheck() {
      if (options.serverUrl) {
        return {
          status: "warn",
          detail: "Using explicit --server-url for Tailscale; native MagicDNS detection is not implemented yet.",
          advertisedUrl: normalizeServerUrl(options.serverUrl)
        };
      }
      const magicDnsName = getTailscaleMagicDnsName(options);
      if (magicDnsName) {
        return {
          status: "ok",
          detail: `Advertising http://${magicDnsName}:${options.port} from Tailscale MagicDNS.`,
          advertisedUrl: `http://${magicDnsName}:${options.port}`
        };
      }
      const address = findTailscaleIpv4();
      if (!address) {
        return {
          status: "fail",
          detail: "No local Tailscale MagicDNS name or IPv4 address was found. Start Tailscale, pass --tailscale-name, pass --server-url, or use --transport lan."
        };
      }
      return {
        status: "ok",
        detail: `Advertising http://${address}:${options.port} from local Tailscale IPv4.`,
        advertisedUrl: `http://${address}:${options.port}`
      };
    }
  };
}

function createFutureTransportProvider(options: TransportProviderOptions & {
  id: Exclude<TransportProviderId, "lan">;
}): TransportProvider {
  const label = transportLabel(options.id);
  return {
    id: options.id,
    label,
    async getAdvertisedUrl() {
      if (options.serverUrl) {
        return normalizeServerUrl(options.serverUrl);
      }
      throw new Error(`${label} transport is not implemented yet. Pass --server-url to advertise an existing ${label} endpoint.`);
    },
    async healthCheck() {
      if (options.serverUrl) {
        return {
          status: "warn",
          detail: `${label} provider is not implemented yet; using explicit --server-url.`,
          advertisedUrl: normalizeServerUrl(options.serverUrl)
        };
      }
      return {
        status: "fail",
        detail: `${label} provider is not implemented yet. Use --transport lan or pass --server-url.`
      };
    }
  };
}

function getLanAdvertisedServerUrl(options: {
  bindHost: string;
  port: number;
  serverUrl?: string;
}): string {
  if (options.serverUrl) {
    return normalizeServerUrl(options.serverUrl);
  }

  return `http://${getAdvertisedHost(options.bindHost)}:${options.port}`;
}

function getAdvertisedHost(bindHost: string): string {
  return selectLanAdvertisedHost({
    bindHost,
    sshConnection: process.env.SSH_CONNECTION,
    routeHost: detectDefaultRouteIpv4(),
    interfaces: networkInterfaces()
  });
}

export function selectLanAdvertisedHost(options: {
  bindHost: string;
  sshConnection?: string;
  routeHost?: string;
  interfaces?: NodeJS.Dict<NetworkInterfaceInfo[]>;
}): string {
  if (options.bindHost !== "0.0.0.0" && options.bindHost !== "::") {
    return options.bindHost;
  }

  const sshLocalAddress = parseSshConnectionLocalAddress(options.sshConnection);
  if (sshLocalAddress) {
    return sshLocalAddress;
  }

  if (isUsableAdvertisedIpv4(options.routeHost)) {
    return options.routeHost;
  }

  const candidates: Array<{
    address: string;
    score: number;
    order: number;
  }> = [];
  let order = 0;
  for (const [name, addresses] of Object.entries(options.interfaces ?? {})) {
    for (const address of addresses ?? []) {
      if (address.family === "IPv4" && !address.internal && isUsableAdvertisedIpv4(address.address)) {
        candidates.push({
          address: address.address,
          score: scoreInterfaceAddress(name, address.address),
          order
        });
      }
      order += 1;
    }
  }

  const best = candidates.sort((left, right) => right.score - left.score || left.order - right.order)[0];
  return best?.address ?? "127.0.0.1";
}

export function parseSshConnectionLocalAddress(value: string | undefined): string | undefined {
  const parts = value?.trim().split(/\s+/) ?? [];
  const localAddress = parts[2];
  return isUsableAdvertisedIpv4(localAddress) ? localAddress : undefined;
}

export function parseLinuxRouteSource(value: string): string | undefined {
  const match = value.match(/\bsrc\s+(\d{1,3}(?:\.\d{1,3}){3})\b/);
  const source = match?.[1];
  return isUsableAdvertisedIpv4(source) ? source : undefined;
}

function detectDefaultRouteIpv4(): string | undefined {
  if (process.platform === "linux") {
    try {
      return parseLinuxRouteSource(execFileSync("ip", ["route", "get", "1.1.1.1"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 1000
      }));
    } catch {
      return undefined;
    }
  }
  if (process.platform === "darwin") {
    try {
      const route = execFileSync("route", ["-n", "get", "default"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 1000
      });
      const iface = route.match(/\binterface:\s+(\S+)/)?.[1];
      if (!iface) {
        return undefined;
      }
      const address = execFileSync("ipconfig", ["getifaddr", iface], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 1000
      }).trim();
      return isUsableAdvertisedIpv4(address) ? address : undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function scoreInterfaceAddress(name: string, address: string): number {
  const lowerName = name.toLowerCase();
  let score = 50;
  if (isPrivateLanIpv4(address)) {
    score = 100;
  } else if (isTailscaleIpv4(address)) {
    score = 60;
  } else if (!isLinkLocalIpv4(address)) {
    score = 80;
  }

  if (/^(docker|br-|veth|virbr|vmnet|podman|container)/.test(lowerName)) {
    score -= 50;
  }
  if (/(tailscale|utun|wg|tun)/.test(lowerName)) {
    score -= 20;
  }
  return score;
}

function isUsableAdvertisedIpv4(value: string | undefined): value is string {
  return typeof value === "string"
    && isValidIpv4(value)
    && value !== "0.0.0.0"
    && !value.startsWith("127.")
    && !isLinkLocalIpv4(value);
}

function isValidIpv4(value: string): boolean {
  const parts = value.split(".");
  return parts.length === 4 && parts.every((part) => {
    if (!/^\d{1,3}$/.test(part)) {
      return false;
    }
    const number = Number(part);
    return number >= 0 && number <= 255;
  });
}

function isPrivateLanIpv4(value: string): boolean {
  const [first = 0, second = 0] = value.split(".").map(Number);
  return first === 10
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168);
}

function isLinkLocalIpv4(value: string): boolean {
  return value.startsWith("169.254.");
}

function findTailscaleIpv4(): string | undefined {
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === "IPv4" && !address.internal && isTailscaleIpv4(address.address)) {
        return address.address;
      }
    }
  }
  return undefined;
}

function getTailscaleMagicDnsName(options: TransportProviderOptions): string | undefined {
  const explicit = normalizeTailscaleName(options.tailscaleName ?? process.env.HEALTHLINK_TAILSCALE_NAME ?? process.env.TAILSCALE_HOSTNAME);
  if (explicit) {
    return explicit;
  }
  return detectTailscaleMagicDnsName();
}

function detectTailscaleMagicDnsName(): string | undefined {
  try {
    const raw = execFileSync("tailscale", ["status", "--json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 1000
    });
    const parsed = JSON.parse(raw) as {
      Self?: {
        DNSName?: unknown;
      };
    };
    return normalizeTailscaleName(typeof parsed.Self?.DNSName === "string" ? parsed.Self.DNSName : undefined);
  } catch {
    return undefined;
  }
}

function normalizeTailscaleName(value: string | undefined): string | undefined {
  const trimmed = value?.trim().replace(/^https?:\/\//, "").replace(/\/+$/, "").replace(/\.$/, "");
  return trimmed || undefined;
}

function isTailscaleIpv4(address: string): boolean {
  const parts = address.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  return parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127;
}

function normalizeServerUrl(serverUrl: string): string {
  return serverUrl.replace(/\/+$/, "");
}

function isLoopbackServerUrl(serverUrl: string): boolean {
  try {
    const parsed = new URL(serverUrl);
    const hostname = parsed.hostname.toLowerCase();
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
  } catch {
    return false;
  }
}

function transportLabel(id: TransportProviderId): string {
  switch (id) {
  case "lan":
    return "LAN";
  case "tailscale":
    return "Tailscale";
  case "cloudflare":
    return "Cloudflare Tunnel";
  case "ngrok":
    return "ngrok";
  case "public_https":
    return "public HTTPS";
  case "relay":
    return "HealthLink Relay";
  case "self_hosted_relay":
    return "self-hosted HealthLink Relay";
  }
}
