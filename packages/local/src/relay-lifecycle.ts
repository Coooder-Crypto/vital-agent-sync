import {
  createRelayRuntimeReplacement,
  markRelaySourceDeviceUnlinked,
  normalizeRelayUrlForMode,
  persistRelayRuntimeReplacement,
  readRelayRuntimeConfig,
  type RelayRuntimeConfig
} from "./relay-runtime.js";
import { openHealthLinkDatabase } from "./database.js";
import { join } from "node:path";

export type RelayLifecycleOptions = {
  stateDir?: string;
  relayUrl?: string;
  relayApiToken?: string;
  databasePath?: string;
  fetchImpl?: typeof fetch;
};

export type RelayLifecycleResult = {
  action: "unlink" | "rotate" | "reset" | "migrate";
  relay_url: string;
  user_id: string;
  source_device_id: string;
  purged: number;
  onboarding_required: boolean;
  config: RelayRuntimeConfig;
};

export type RelayMigrationOptions = Omit<RelayLifecycleOptions, "relayUrl" | "relayApiToken"> & {
  targetRelayUrl: string;
  targetRelayApiToken?: string;
  targetMode: "hosted_relay" | "self_hosted_relay";
};

export async function unlinkRelaySourceDevice(options: RelayLifecycleOptions = {}): Promise<RelayLifecycleResult> {
  const config = readRelayRuntimeConfig({ stateDir: options.stateDir });
  const relayUrl = normalizeRelayUrlForMode(options.relayUrl ?? config.relay_url, config.relay_mode);
  const response = await postRelayLifecycle(
    options.fetchImpl ?? fetch,
    `${relayUrl}/v1/devices/${encodeURIComponent(config.source_device_id)}/unlink`,
    { user_id: config.user_id },
    config,
    options.relayApiToken
  );
  const next = markRelaySourceDeviceUnlinked(config, { stateDir: options.stateDir });
  setLocalRelayDeviceRevoked(config.source_device_id, true, options);
  return {
    action: "unlink",
    relay_url: relayUrl,
    user_id: config.user_id,
    source_device_id: config.source_device_id,
    purged: readPurgedCount(response),
    onboarding_required: true,
    config: next
  };
}

export async function rotateRelayRuntime(options: RelayLifecycleOptions = {}): Promise<RelayLifecycleResult> {
  const current = readRelayRuntimeConfig({ stateDir: options.stateDir });
  const replacement = createRelayRuntimeReplacement(current, { stateDir: options.stateDir });
  const relayUrl = normalizeRelayUrlForMode(options.relayUrl ?? current.relay_url, current.relay_mode);
  const response = await postRelayLifecycle(
    options.fetchImpl ?? fetch,
    `${relayUrl}/v1/credentials/rotate`,
    {
      user_id: current.user_id,
      new_access_token: replacement.config.relay_access_token
    },
    current,
    options.relayApiToken
  );
  const next = persistRelayRuntimeReplacement(replacement, { stateDir: options.stateDir });
  setLocalRelayDeviceRevoked(next.source_device_id, false, options);
  return {
    action: "rotate",
    relay_url: relayUrl,
    user_id: next.user_id,
    source_device_id: next.source_device_id,
    purged: readPurgedCount(response),
    onboarding_required: true,
    config: next
  };
}

export async function resetRelayRuntime(options: RelayLifecycleOptions = {}): Promise<RelayLifecycleResult> {
  const current = readRelayRuntimeConfig({ stateDir: options.stateDir });
  const replacement = createRelayRuntimeReplacement(current, {
    stateDir: options.stateDir,
    resetIdentity: true
  });
  const relayUrl = normalizeRelayUrlForMode(options.relayUrl ?? current.relay_url, current.relay_mode);
  const response = await postRelayLifecycle(
    options.fetchImpl ?? fetch,
    `${relayUrl}/v1/users/revoke`,
    { user_id: current.user_id },
    current,
    options.relayApiToken
  );
  const next = persistRelayRuntimeReplacement(replacement, { stateDir: options.stateDir });
  setLocalRelayDeviceRevoked(current.source_device_id, true, options);
  return {
    action: "reset",
    relay_url: relayUrl,
    user_id: next.user_id,
    source_device_id: next.source_device_id,
    purged: readPurgedCount(response),
    onboarding_required: true,
    config: next
  };
}

export async function migrateRelayRuntime(options: RelayMigrationOptions): Promise<RelayLifecycleResult> {
  const current = readRelayRuntimeConfig({ stateDir: options.stateDir });
  const replacement = createRelayRuntimeReplacement(current, {
    stateDir: options.stateDir,
    resetIdentity: true
  });
  const sourceRelayUrl = normalizeRelayUrlForMode(current.relay_url, current.relay_mode);
  const targetRelayUrl = normalizeRelayUrlForMode(options.targetRelayUrl, options.targetMode);
  replacement.config.relay_url = targetRelayUrl;
  replacement.config.relay_mode = options.targetMode;
  const targetApiToken = normalizeOptionalToken(options.targetRelayApiToken);
  if (targetApiToken) {
    replacement.config.relay_api_token = targetApiToken;
  } else {
    delete replacement.config.relay_api_token;
  }
  const response = await postRelayLifecycle(
    options.fetchImpl ?? fetch,
    `${sourceRelayUrl}/v1/users/revoke`,
    { user_id: current.user_id },
    current,
    undefined
  );
  const next = persistRelayRuntimeReplacement(replacement, { stateDir: options.stateDir });
  setLocalRelayDeviceRevoked(current.source_device_id, true, options);
  return {
    action: "migrate",
    relay_url: targetRelayUrl,
    user_id: next.user_id,
    source_device_id: next.source_device_id,
    purged: readPurgedCount(response),
    onboarding_required: true,
    config: next
  };
}

async function postRelayLifecycle(
  fetchImpl: typeof fetch,
  url: string,
  body: Record<string, string>,
  config: RelayRuntimeConfig,
  relayApiTokenOverride: string | undefined
): Promise<unknown> {
  const relayApiToken = normalizeOptionalToken(
    relayApiTokenOverride ?? config.relay_api_token ?? process.env.HEALTHLINK_RELAY_API_TOKEN
  );
  const headers: Record<string, string> = {
    "content-type": "application/json",
    authorization: `Bearer ${config.relay_access_token}`
  };
  if (relayApiToken) {
    headers["x-healthlink-relay-api-key"] = relayApiToken;
  }
  const response = await fetchImpl(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    throw new Error(`Relay lifecycle request failed with HTTP ${response.status}. Local relay state was not changed.`);
  }
  try {
    return await response.json() as unknown;
  } catch {
    return {};
  }
}

function readPurgedCount(value: unknown): number {
  if (typeof value !== "object" || value === null) {
    return 0;
  }
  const purged = (value as { purged?: unknown }).purged;
  return typeof purged === "number" && Number.isInteger(purged) && purged >= 0 ? purged : 0;
}

function normalizeOptionalToken(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function setLocalRelayDeviceRevoked(
  deviceId: string,
  revoked: boolean,
  options: Pick<RelayLifecycleOptions, "stateDir" | "databasePath">
): void {
  const databasePath = options.databasePath ?? (options.stateDir ? join(options.stateDir, "healthlink.sqlite") : undefined);
  const database = openHealthLinkDatabase({ path: databasePath });
  try {
    database.sqlite.prepare(`
      update devices
      set revoked_at = ?
      where id = ?
    `).run(revoked ? new Date().toISOString() : null, deviceId);
  } finally {
    database.close();
  }
}
