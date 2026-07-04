import { networkInterfaces } from "node:os";

export type AdvertisedServerOptions = {
  bindHost: string;
  port: number;
  serverUrl?: string;
};

export function getAdvertisedServerUrl(options: AdvertisedServerOptions): string {
  if (options.serverUrl) {
    return options.serverUrl.replace(/\/+$/, "");
  }

  return `http://${getAdvertisedHost(options.bindHost)}:${options.port}`;
}

export function getAdvertisedHost(bindHost: string): string {
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
