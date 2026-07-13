import { networkInterfaces, type NetworkInterfaceInfo } from "node:os";
import { execFileSync, spawnSync, type SpawnSyncReturns } from "node:child_process";
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
  tailscaleCommand?: string;
};

export type TailscaleServeInspection = {
  status: "ready" | "missing" | "conflict" | "public" | "unavailable";
  detail: string;
};

const TAILSCALE_HTTPS_PORT = 443;

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
  const tailscaleCommand = options.tailscaleCommand ?? "tailscale";
  return {
    id: "tailscale",
    label: "Tailscale",
    async start() {
      if (options.serverUrl) {
        requireSecureTailscaleServerUrl(options.serverUrl);
        return;
      }

      const magicDnsName = requireTailscaleMagicDnsName(options);
      assertTailscaleMagicDnsMatchesLocal(tailscaleCommand, magicDnsName);
      const backendUrl = tailscaleBackendUrl(options.port);
      const current = readTailscaleServeInspection(tailscaleCommand, magicDnsName, backendUrl);
      if (current.status === "ready") {
        return;
      }
      if (current.status === "conflict" || current.status === "public") {
        throw new Error(current.detail);
      }
      if (current.status === "unavailable") {
        throw new Error(`${current.detail} Tailscale 1.52 or newer with MagicDNS and HTTPS enabled is required.`);
      }

      const configured = runTailscale(tailscaleCommand, [
        "serve",
        "--bg",
        "--yes",
        `--https=${TAILSCALE_HTTPS_PORT}`,
        backendUrl
      ]);
      if (configured.status !== 0) {
        throw new Error(
          `Could not configure the private Tailscale HTTPS endpoint. Run \`tailscale serve --bg --yes --https=${TAILSCALE_HTTPS_PORT} ${backendUrl}\` after enabling MagicDNS and HTTPS for the tailnet, then retry. ${commandFailureDetail(configured)}`
        );
      }

      const verified = readTailscaleServeInspection(tailscaleCommand, magicDnsName, backendUrl);
      if (verified.status !== "ready") {
        throw new Error(`Tailscale Serve returned success but the expected private HTTPS route was not present. ${verified.detail}`);
      }
    },
    async getAdvertisedUrl() {
      if (options.serverUrl) {
        return requireSecureTailscaleServerUrl(options.serverUrl);
      }
      return tailscaleAdvertisedUrl(requireTailscaleMagicDnsName(options));
    },
    async healthCheck() {
      if (options.serverUrl) {
        try {
          const advertisedUrl = requireSecureTailscaleServerUrl(options.serverUrl);
          return {
            status: "ok",
            detail: `Using explicit secure Tailscale endpoint ${advertisedUrl}. Confirm it is private to the tailnet and has a certificate trusted by iOS.`,
            advertisedUrl
          };
        } catch (error) {
          return {
            status: "fail",
            detail: error instanceof Error ? error.message : String(error)
          };
        }
      }

      let magicDnsName: string;
      try {
        magicDnsName = requireTailscaleMagicDnsName(options);
        assertTailscaleMagicDnsMatchesLocal(tailscaleCommand, magicDnsName);
      } catch (error) {
        return {
          status: "fail",
          detail: error instanceof Error ? error.message : String(error)
        };
      }

      const advertisedUrl = tailscaleAdvertisedUrl(magicDnsName);
      const inspection = readTailscaleServeInspection(tailscaleCommand, magicDnsName, tailscaleBackendUrl(options.port));
      if (inspection.status === "ready") {
        return {
          status: "ok",
          detail: `Advertising ${advertisedUrl} through private Tailscale Serve HTTPS to http://127.0.0.1:${options.port}.`,
          advertisedUrl
        };
      }
      return {
        status: "fail",
        detail: inspection.detail,
        advertisedUrl
      };
    }
  };
}

function tailscaleAdvertisedUrl(magicDnsName: string): string {
  return `https://${magicDnsName}`;
}

function tailscaleBackendUrl(port: number): string {
  return `http://127.0.0.1:${port}`;
}

function requireSecureTailscaleServerUrl(serverUrl: string): string {
  const normalized = normalizeServerUrl(serverUrl);
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error(`Tailscale --server-url must be a valid HTTPS URL; received ${serverUrl}.`);
  }
  if (parsed.protocol !== "https:") {
    throw new Error("Tailscale iOS onboarding requires an HTTPS --server-url. Plain HTTP MagicDNS and 100.x endpoints are not advertised because they are not a supported iOS ATS route.");
  }
  if (parsed.username || parsed.password) {
    throw new Error("Tailscale --server-url must not include URL credentials.");
  }
  return normalized;
}

function requireTailscaleMagicDnsName(options: TransportProviderOptions): string {
  const magicDnsName = getTailscaleMagicDnsName(options);
  if (!magicDnsName || !isTailscaleCertificateName(magicDnsName)) {
    const address = findTailscaleIpv4();
    const addressHint = address ? ` A local Tailscale IPv4 address (${address}) exists, but certificates are issued for MagicDNS names rather than 100.x addresses.` : "";
    throw new Error(`Tailscale iOS onboarding requires a MagicDNS name ending in .ts.net so Tailscale Serve can publish a trusted HTTPS endpoint.${addressHint} Enable MagicDNS and tailnet HTTPS, start Tailscale, or pass --tailscale-name <device>.<tailnet>.ts.net.`);
  }
  return magicDnsName;
}

function isTailscaleCertificateName(value: string): boolean {
  return value.toLowerCase().endsWith(".ts.net") && !value.includes(":") && !value.includes("/");
}

function assertTailscaleMagicDnsMatchesLocal(tailscaleCommand: string, advertisedName: string): void {
  const detectedName = detectTailscaleMagicDnsName(tailscaleCommand);
  if (detectedName && detectedName.toLowerCase() !== advertisedName.toLowerCase()) {
    throw new Error(`Configured Tailscale name ${advertisedName} does not match this node's MagicDNS name ${detectedName}. Use the exact Self.DNSName from \`tailscale status --json\`; HealthLink will not change Serve configuration for a mismatched hostname.`);
  }
}

function readTailscaleServeInspection(tailscaleCommand: string, magicDnsName: string, backendUrl: string): TailscaleServeInspection {
  const result = runTailscale(tailscaleCommand, ["serve", "status", "--json"]);
  if (result.status !== 0) {
    return { status: "unavailable", detail: `Could not inspect Tailscale Serve. ${commandFailureDetail(result)}` };
  }
  return inspectTailscaleServeConfig(result.stdout, magicDnsName, backendUrl);
}

export function inspectTailscaleServeConfig(raw: string, magicDnsName: string, backendUrl: string): TailscaleServeInspection {
  let parsed: {
    TCP?: Record<string, { HTTPS?: boolean; HTTP?: boolean; TCPForward?: string }>;
    Web?: Record<string, { Handlers?: Record<string, { Proxy?: string }> }>;
    AllowFunnel?: Record<string, boolean>;
  };
  try {
    parsed = JSON.parse(raw || "{}") as typeof parsed;
  } catch {
    return { status: "unavailable", detail: "Tailscale Serve status did not return valid JSON. Tailscale 1.52 or newer is required." };
  }

  const hostPort = `${magicDnsName}:${TAILSCALE_HTTPS_PORT}`;
  const tcp = parsed.TCP?.[String(TAILSCALE_HTTPS_PORT)];
  const rootProxy = parsed.Web?.[hostPort]?.Handlers?.["/"]?.Proxy;
  if (parsed.AllowFunnel?.[hostPort]) {
    return { status: "public", detail: `Tailscale Funnel is enabled for ${hostPort}. HealthLink will not overwrite or advertise a public route; disable Funnel on port ${TAILSCALE_HTTPS_PORT} before setup.` };
  }
  if (tcp?.HTTPS === true && rootProxy === backendUrl) {
    return { status: "ready", detail: `Private HTTPS route ${tailscaleAdvertisedUrl(magicDnsName)} proxies to ${backendUrl}.` };
  }
  if (rootProxy && rootProxy !== backendUrl) {
    return { status: "conflict", detail: `Tailscale Serve already uses ${hostPort}/ for ${rootProxy}. HealthLink will not overwrite that route; move the existing handler or pass a separate secure --server-url.` };
  }
  if (tcp && tcp.HTTPS !== true) {
    return { status: "conflict", detail: `Tailscale Serve port ${TAILSCALE_HTTPS_PORT} is already configured for a non-HTTPS handler. HealthLink will not overwrite it.` };
  }
  return { status: "missing", detail: `Private Tailscale HTTPS is not configured. Run \`tailscale serve --bg --yes --https=${TAILSCALE_HTTPS_PORT} ${backendUrl}\`, then rerun pairing or doctor.` };
}

function runTailscale(command: string, args: string[]): SpawnSyncReturns<string> {
  return spawnSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 5000 });
}

function commandFailureDetail(result: SpawnSyncReturns<string>): string {
  if (result.error) return result.error.message;
  const output = `${result.stderr ?? ""}\n${result.stdout ?? ""}`.trim().replace(/\s+/g, " ");
  return output || `tailscale exited with status ${result.status ?? "unknown"}.`;
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
  return detectTailscaleMagicDnsName(options.tailscaleCommand ?? "tailscale");
}

function detectTailscaleMagicDnsName(tailscaleCommand: string): string | undefined {
  try {
    const raw = execFileSync(tailscaleCommand, ["status", "--json"], {
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
  return trimmed?.toLowerCase() || undefined;
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
    return "VitalMCP Relay";
  case "self_hosted_relay":
    return "self-hosted VitalMCP Relay";
  }
}
