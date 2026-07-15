export type RelayServeConfigInput = {
  host: string;
  hostProvided: boolean;
  port: number;
  portProvided: boolean;
  databasePath?: string;
  databasePathProvided: boolean;
  relayRetentionDays: number;
  relayRetentionDaysProvided: boolean;
  relayMaxEnvelopeBytes: number;
  relayMaxEnvelopeBytesProvided: boolean;
  relayMaxUploadsPerMinute: number;
  relayMaxUploadsPerMinuteProvided: boolean;
  relayMaxQueuedEnvelopesPerUser: number;
  relayMaxQueuedEnvelopesPerUserProvided: boolean;
  relayMaxDevicesPerUser: number;
  relayMaxDevicesPerUserProvided: boolean;
  relayTrustProxy: boolean;
  relayTrustProxyProvided: boolean;
  relayApiToken?: string;
  relayApiTokenProvided: boolean;
  relayMetricsToken?: string;
  relayMetricsTokenProvided: boolean;
};

export type RelayServeConfig = {
  host: string;
  port: number;
  databasePath?: string;
  retentionDays: number;
  maxEnvelopeBytes: number;
  maxUploadsPerMinute: number;
  maxQueuedEnvelopesPerUser: number;
  maxDevicesPerUser: number;
  trustProxy: boolean;
  apiToken?: string;
  metricsToken?: string;
};

export function resolveRelayServeConfig(
  options: RelayServeConfigInput,
  env: NodeJS.ProcessEnv = process.env
): RelayServeConfig {
  return {
    host: options.hostProvided
      ? options.host
      : env.VITALMCP_RELAY_HOST ?? options.host,
    port: options.portProvided
      ? options.port
      : readPositiveIntegerEnv(env, "VITALMCP_RELAY_PORT") ?? 8790,
    databasePath: options.databasePathProvided ? options.databasePath : env.VITALMCP_RELAY_DB ?? options.databasePath,
    retentionDays: optionOrEnvNumber(
      env,
      options.relayRetentionDays,
      options.relayRetentionDaysProvided,
      "VITALMCP_RELAY_RETENTION_DAYS"
    ),
    maxEnvelopeBytes: optionOrEnvInteger(
      env,
      options.relayMaxEnvelopeBytes,
      options.relayMaxEnvelopeBytesProvided,
      "VITALMCP_RELAY_MAX_ENVELOPE_BYTES"
    ),
    maxUploadsPerMinute: optionOrEnvInteger(
      env,
      options.relayMaxUploadsPerMinute,
      options.relayMaxUploadsPerMinuteProvided,
      "VITALMCP_RELAY_MAX_UPLOADS_PER_MINUTE"
    ),
    maxQueuedEnvelopesPerUser: optionOrEnvInteger(
      env,
      options.relayMaxQueuedEnvelopesPerUser,
      options.relayMaxQueuedEnvelopesPerUserProvided,
      "VITALMCP_RELAY_MAX_QUEUED_ENVELOPES_PER_USER"
    ),
    maxDevicesPerUser: optionOrEnvInteger(
      env,
      options.relayMaxDevicesPerUser,
      options.relayMaxDevicesPerUserProvided,
      "VITALMCP_RELAY_MAX_DEVICES_PER_USER"
    ),
    trustProxy: options.relayTrustProxyProvided
      ? options.relayTrustProxy
      : readBooleanEnv(env, "VITALMCP_RELAY_TRUST_PROXY") ?? options.relayTrustProxy,
    apiToken: normalizeOptionalToken(
      options.relayApiTokenProvided
        ? options.relayApiToken
        : env.VITALMCP_RELAY_API_TOKEN ?? options.relayApiToken
    ),
    metricsToken: normalizeOptionalToken(
      options.relayMetricsTokenProvided
        ? options.relayMetricsToken
        : env.VITALMCP_RELAY_METRICS_TOKEN ?? options.relayMetricsToken
    )
  };
}

function normalizeOptionalToken(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function optionOrEnvInteger(
  env: NodeJS.ProcessEnv,
  optionValue: number,
  optionProvided: boolean,
  envName: string
): number {
  return optionProvided
    ? optionValue
    : readPositiveIntegerEnv(env, envName) ?? optionValue;
}

function optionOrEnvNumber(
  env: NodeJS.ProcessEnv,
  optionValue: number,
  optionProvided: boolean,
  envName: string
): number {
  return optionProvided
    ? optionValue
    : readPositiveNumberEnv(env, envName) ?? optionValue;
}

function readPositiveIntegerEnv(env: NodeJS.ProcessEnv, name: string): number | undefined {
  const value = env[name];
  if (value === undefined || value === "") {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}

function readPositiveNumberEnv(env: NodeJS.ProcessEnv, name: string): number | undefined {
  const value = env[name];
  if (value === undefined || value === "") {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive number.`);
  }
  return parsed;
}

function readBooleanEnv(env: NodeJS.ProcessEnv, name: string): boolean | undefined {
  const value = env[name]?.trim().toLowerCase();
  if (value === undefined || value === "") {
    return undefined;
  }
  if (value === "true" || value === "1") {
    return true;
  }
  if (value === "false" || value === "0") {
    return false;
  }
  throw new Error(`${name} must be true, false, 1, or 0.`);
}
