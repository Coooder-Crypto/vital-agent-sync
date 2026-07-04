import { networkInterfaces } from "node:os";

export const TRANSPORT_PROVIDER_IDS = [
  "lan",
  "tailscale",
  "cloudflare",
  "ngrok",
  "public_https"
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
};

export function createTransportProvider(options: TransportProviderOptions): TransportProvider {
  const id = options.id ?? "lan";
  if (id === "lan") {
    return createLanTransportProvider(options);
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

function normalizeServerUrl(serverUrl: string): string {
  return serverUrl.replace(/\/+$/, "");
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
  }
}
