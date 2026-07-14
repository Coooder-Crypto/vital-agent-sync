import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { renderTerminalQr } from "./terminal-qr.js";

export const HEALTHLINK_E2EE_PROTOCOL = "healthlink-e2ee-v1" as const;
export const HEALTHLINK_ONBOARDING_TEXT_PREFIX = `${HEALTHLINK_E2EE_PROTOCOL}:`;
export const DEFAULT_RELAY_URL = "http://127.0.0.1:8790";
export const HEALTHLINK_HOSTED_RELAY_URL_ENV = "HEALTHLINK_HOSTED_RELAY_URL";
export const HEALTHLINK_SELF_HOSTED_RELAY_URL_ENV = "HEALTHLINK_SELF_HOSTED_RELAY_URL";
export const HEALTHLINK_RELAY_URL_ENV = "HEALTHLINK_RELAY_URL";
export const HEALTHLINK_RELAY_API_TOKEN_ENV = "HEALTHLINK_RELAY_API_TOKEN";

export type RelayRuntimeConfig = {
  protocol: typeof HEALTHLINK_E2EE_PROTOCOL;
  user_id: string;
  source_device_id: string;
  agent_name: string;
  relay_mode: "hosted_relay" | "self_hosted_relay";
  relay_url: string;
  requested_scopes: string[];
  created_at: string;
  encryption_public_key_pem: string;
  encryption_public_key_x25519: string;
  signing_public_key_pem: string;
  upload_auth_secret: string;
  relay_access_token: string;
  relay_api_token?: string;
  source_device_unlinked_at?: string;
  encryption_private_key_path: string;
  signing_private_key_path: string;
};

export type RelayOnboardingPayload = {
  protocol: typeof HEALTHLINK_E2EE_PROTOCOL;
  mode: "hosted_relay" | "self_hosted_relay";
  relay_url: string;
  user_id: string;
  source_device_id: string;
  agent_name: string;
  encryption_public_key: string;
  encryption_public_key_x25519: string;
  signing_public_key: string;
  upload_auth_secret: string;
  relay_access_token: string;
  relay_api_token?: string;
  fingerprint: string;
  requested_scopes: string[];
  created_at: string;
};

export type RelayRuntimeOptions = {
  stateDir?: string;
  relayUrl?: string;
  relayApiToken?: string;
  agentName?: string;
  mode?: "hosted_relay" | "self_hosted_relay";
};

export type RelayRuntimeReplacement = {
  config: RelayRuntimeConfig;
  encryptionPrivateKey: string;
  signingPrivateKey: string;
  previousPrivateKeyPaths: string[];
};

export function getDefaultStateDir(): string {
  return join(homedir(), ".healthlink");
}

export function initializeRelayRuntime(options: RelayRuntimeOptions = {}): RelayRuntimeConfig {
  const stateDir = resolveHomePath(options.stateDir ?? getDefaultStateDir());
  const configPath = getRelayConfigPath(stateDir);
  const secretsDir = join(stateDir, "secrets");
  ensurePrivateDirectory(stateDir);
  ensurePrivateDirectory(secretsDir);
  if (existsSync(configPath)) {
    return readRelayRuntimeConfig({ stateDir });
  }

  const encryption = generateKeyPairSync("x25519", {
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" }
  });
  const signing = generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" }
  });

  const encryptionPrivateKeyPath = join(secretsDir, "encryption_private_key.pem");
  const signingPrivateKeyPath = join(secretsDir, "signing_private_key.pem");
  writeSecretFile(encryptionPrivateKeyPath, encryption.privateKey);
  writeSecretFile(signingPrivateKeyPath, signing.privateKey);

  const config: RelayRuntimeConfig = {
    protocol: HEALTHLINK_E2EE_PROTOCOL,
    user_id: `usr_${randomUUID().replaceAll("-", "")}`,
    source_device_id: `dev_${randomUUID().replaceAll("-", "")}`,
    agent_name: options.agentName ?? "Local Agent",
    relay_mode: options.mode ?? "hosted_relay",
    relay_url: resolveDefaultRelayUrl(options),
    requested_scopes: ["health.daily_summary.write"],
    created_at: new Date().toISOString(),
    encryption_public_key_pem: encryption.publicKey,
    encryption_public_key_x25519: x25519PublicKeyPemToRawBase64Url(encryption.publicKey),
    signing_public_key_pem: signing.publicKey,
    upload_auth_secret: randomBytes(32).toString("base64url"),
    relay_access_token: randomBytes(32).toString("base64url"),
    relay_api_token: normalizeOptionalToken(options.relayApiToken ?? process.env[HEALTHLINK_RELAY_API_TOKEN_ENV]),
    encryption_private_key_path: encryptionPrivateKeyPath,
    signing_private_key_path: signingPrivateKeyPath
  };

  writePrivateJsonFileAtomic(configPath, config);
  return config;
}

export function readRelayRuntimeConfig(options: Pick<RelayRuntimeOptions, "stateDir"> = {}): RelayRuntimeConfig {
  const stateDir = resolveHomePath(options.stateDir ?? getDefaultStateDir());
  const configPath = getRelayConfigPath(stateDir);
  if (!existsSync(configPath)) {
    throw new Error(`Vital Agent Sync relay runtime is not initialized at ${configPath}. Run vitalmcp setup --transport relay first.`);
  }
  const parsed = JSON.parse(readFileSync(configPath, "utf8")) as unknown;
  const migrated = migrateRelayRuntimeConfig(parsed);
  if (!isRelayRuntimeConfig(migrated)) {
    throw new Error(`Vital Agent Sync relay runtime config is invalid at ${configPath}.`);
  }
  if (migrated !== parsed) {
    writePrivateJsonFileAtomic(configPath, migrated);
  }
  return migrated;
}

export function buildRelayOnboardingPayload(
  config: RelayRuntimeConfig,
  options: Pick<RelayRuntimeOptions, "mode"> = {}
): RelayOnboardingPayload {
  if (config.source_device_unlinked_at) {
    throw new Error("The configured relay source device is unlinked. Run vitalmcp relay rotate or relay reset before onboarding again.");
  }
  const mode = options.mode ?? config.relay_mode;
  const relayUrl = normalizeRelayUrlForMode(config.relay_url, mode);
  return {
    protocol: HEALTHLINK_E2EE_PROTOCOL,
    mode,
    relay_url: relayUrl,
    user_id: config.user_id,
    source_device_id: config.source_device_id,
    agent_name: config.agent_name,
    encryption_public_key: config.encryption_public_key_pem,
    encryption_public_key_x25519: config.encryption_public_key_x25519,
    signing_public_key: config.signing_public_key_pem,
    upload_auth_secret: config.upload_auth_secret,
    relay_access_token: config.relay_access_token,
    relay_api_token: config.relay_api_token,
    fingerprint: fingerprintPublicKeys(config),
    requested_scopes: config.requested_scopes,
    created_at: config.created_at
  };
}

export function formatRelayOnboarding(config: RelayRuntimeConfig, options: Pick<RelayRuntimeOptions, "mode"> = {}): string {
  const payload = buildRelayOnboardingPayload(config, options);
  const onboardingCode = encodeRelayOnboardingPayload(payload);
  const onboardingLink = buildRelayOnboardingDeepLink(payload);
  const qr = renderTerminalQr(onboardingLink);
  const lines = [
    "Vital Agent Sync relay onboarding",
    `Protocol:    ${payload.protocol}`,
    `Mode:        ${payload.mode}`,
    `Relay:       ${payload.relay_url}`,
    `User:        ${payload.user_id}`,
    `Source:      ${payload.source_device_id}`,
    `Fingerprint: ${payload.fingerprint}`,
    "",
    "Sensitive: this onboarding material contains upload authentication and relay access credentials.",
    "Show it only to the Vital Agent Sync source device. Do not paste it into Agent chats, logs, or support tickets.",
    "",
    "Onboarding link:",
    onboardingLink,
    "",
    "Onboarding text code:",
    onboardingCode,
    ""
  ];
  if (qr.rendered) {
    lines.push("Scan QR:", qr.text);
  } else {
    lines.push(`QR not rendered: terminal is too narrow (${qr.requiredColumns} columns needed).`);
  }
  return `${lines.join("\n")}\n`;
}

export function encodeRelayOnboardingPayload(payload: RelayOnboardingPayload): string {
  return `${HEALTHLINK_ONBOARDING_TEXT_PREFIX}${Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")}`;
}

export function buildRelayOnboardingDeepLink(payload: RelayOnboardingPayload): string {
  const url = new URL("vitalmcp://onboard");
  url.searchParams.set("payload", encodeRelayOnboardingPayload(payload));
  return url.toString();
}

export function getRelayConfigPath(stateDir: string): string {
  return join(resolveHomePath(stateDir), "config.json");
}

export function getRelayCursorPath(stateDir: string): string {
  return join(resolveHomePath(stateDir), "relay-cursor.json");
}

export function readPrivateKey(path: string): string {
  return readFileSync(resolveHomePath(path), "utf8");
}

export function validateRelayRuntimeState(config: RelayRuntimeConfig): string[] {
  const issues: string[] = [];
  validatePrivateKeyPair(
    config.encryption_private_key_path,
    config.encryption_public_key_pem,
    "encryption",
    issues
  );
  validatePrivateKeyPair(
    config.signing_private_key_path,
    config.signing_public_key_pem,
    "signing",
    issues
  );
  if (!isBase64UrlBytes(config.upload_auth_secret, 32)) {
    issues.push("upload authentication secret is invalid");
  }
  if (!isBase64UrlBytes(config.relay_access_token, 32)) {
    issues.push("relay access token is invalid");
  }
  try {
    normalizeRelayUrlForMode(config.relay_url, config.relay_mode);
  } catch (error) {
    issues.push(error instanceof Error ? error.message : "relay URL is invalid");
  }
  return issues;
}

export function createRelayRuntimeReplacement(
  current: RelayRuntimeConfig,
  options: { stateDir?: string; resetIdentity?: boolean } = {}
): RelayRuntimeReplacement {
  const stateDir = resolveHomePath(options.stateDir ?? getDefaultStateDir());
  const secretsDir = join(stateDir, "secrets");
  ensurePrivateDirectory(stateDir);
  ensurePrivateDirectory(secretsDir);
  const suffix = randomBytes(8).toString("hex");
  const encryption = generateKeyPairSync("x25519", {
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" }
  });
  const signing = generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" }
  });
  const encryptionPrivateKeyPath = join(secretsDir, `encryption_private_key_${suffix}.pem`);
  const signingPrivateKeyPath = join(secretsDir, `signing_private_key_${suffix}.pem`);
  const config: RelayRuntimeConfig = {
    ...current,
    user_id: options.resetIdentity ? `usr_${randomUUID().replaceAll("-", "")}` : current.user_id,
    source_device_id: options.resetIdentity ? `dev_${randomUUID().replaceAll("-", "")}` : current.source_device_id,
    created_at: new Date().toISOString(),
    encryption_public_key_pem: encryption.publicKey,
    encryption_public_key_x25519: x25519PublicKeyPemToRawBase64Url(encryption.publicKey),
    signing_public_key_pem: signing.publicKey,
    upload_auth_secret: randomBytes(32).toString("base64url"),
    relay_access_token: randomBytes(32).toString("base64url"),
    encryption_private_key_path: encryptionPrivateKeyPath,
    signing_private_key_path: signingPrivateKeyPath
  };
  delete config.source_device_unlinked_at;
  return {
    config,
    encryptionPrivateKey: encryption.privateKey,
    signingPrivateKey: signing.privateKey,
    previousPrivateKeyPaths: [current.encryption_private_key_path, current.signing_private_key_path]
  };
}

export function persistRelayRuntimeReplacement(
  replacement: RelayRuntimeReplacement,
  options: { stateDir?: string } = {}
): RelayRuntimeConfig {
  const stateDir = resolveHomePath(options.stateDir ?? getDefaultStateDir());
  const configPath = getRelayConfigPath(stateDir);
  writeSecretFile(replacement.config.encryption_private_key_path, replacement.encryptionPrivateKey);
  writeSecretFile(replacement.config.signing_private_key_path, replacement.signingPrivateKey);
  writePrivateJsonFileAtomic(configPath, replacement.config);
  rmSync(getRelayCursorPath(stateDir), { force: true });
  removeReplacedPrivateKeys(stateDir, replacement.previousPrivateKeyPaths, replacement.config);
  return replacement.config;
}

export function markRelaySourceDeviceUnlinked(
  config: RelayRuntimeConfig,
  options: { stateDir?: string; unlinkedAt?: string } = {}
): RelayRuntimeConfig {
  const stateDir = resolveHomePath(options.stateDir ?? getDefaultStateDir());
  const next: RelayRuntimeConfig = {
    ...config,
    source_device_unlinked_at: options.unlinkedAt ?? new Date().toISOString()
  };
  const configPath = getRelayConfigPath(stateDir);
  writePrivateJsonFileAtomic(configPath, next);
  return next;
}

export function resolveDefaultRelayUrl(options: Pick<RelayRuntimeOptions, "mode" | "relayUrl"> = {}): string {
  const mode = options.mode ?? "hosted_relay";
  const modeSpecific = mode === "self_hosted_relay"
    ? process.env[HEALTHLINK_SELF_HOSTED_RELAY_URL_ENV]
    : process.env[HEALTHLINK_HOSTED_RELAY_URL_ENV];
  const configured = options.relayUrl ?? modeSpecific ?? process.env[HEALTHLINK_RELAY_URL_ENV];
  if (!configured && mode === "hosted_relay") {
    throw new Error(
      `Hosted Vital Agent Sync relay URL is not configured. Pass --relay-url https://... or set ${HEALTHLINK_HOSTED_RELAY_URL_ENV}.`
    );
  }
  return normalizeRelayUrlForMode(configured ?? DEFAULT_RELAY_URL, mode);
}

function fingerprintPublicKeys(config: RelayRuntimeConfig): string {
  const hash = createHash("sha256")
    .update(config.encryption_public_key_pem)
    .update("\n")
    .update(config.signing_public_key_pem)
    .digest("hex")
    .toUpperCase();
  return hash.match(/.{1,4}/g)?.slice(0, 8).join(" ") ?? hash;
}

function writeSecretFile(path: string, value: string): void {
  ensurePrivateDirectory(dirname(path));
  writeFileSync(path, value, { encoding: "utf8", mode: 0o600 });
  chmodIfPossible(path, 0o600);
}

function writePrivateJsonFileAtomic(path: string, value: unknown): void {
  ensurePrivateDirectory(dirname(path));
  const pendingPath = `${path}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    writeFileSync(pendingPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    chmodIfPossible(pendingPath, 0o600);
    renameSync(pendingPath, path);
    chmodIfPossible(path, 0o600);
  } finally {
    rmSync(pendingPath, { force: true });
  }
}

function ensurePrivateDirectory(path: string): void {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  chmodIfPossible(path, 0o700);
}

function chmodIfPossible(path: string, mode: number): void {
  try {
    chmodSync(path, mode);
  } catch {
    // Windows and some filesystems may not support POSIX modes.
  }
}

export function normalizeRelayUrl(value: string): string {
  const url = new URL(value.trim());
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Vital Agent Sync relay URL must use HTTP or HTTPS.");
  }
  if (url.username || url.password) {
    throw new Error("Vital Agent Sync relay URL must not contain embedded credentials.");
  }
  if (url.search || url.hash) {
    throw new Error("Vital Agent Sync relay URL must not contain a query string or fragment.");
  }
  return url.toString().replace(/\/+$/, "");
}

export function normalizeRelayUrlForMode(
  value: string,
  mode: "hosted_relay" | "self_hosted_relay"
): string {
  const normalized = normalizeRelayUrl(value);
  if (mode === "hosted_relay" && new URL(normalized).protocol !== "https:") {
    throw new Error("Hosted Vital Agent Sync relay URL must use HTTPS. Use self-hosted-relay mode for an HTTP relay you control.");
  }
  return normalized;
}

function resolveHomePath(path: string): string {
  if (path === "~") {
    return homedir();
  }
  if (path.startsWith("~/")) {
    return join(homedir(), path.slice(2));
  }
  return path;
}

function isRelayRuntimeConfig(value: unknown): value is RelayRuntimeConfig {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return record.protocol === HEALTHLINK_E2EE_PROTOCOL &&
    typeof record.user_id === "string" &&
    typeof record.source_device_id === "string" &&
    typeof record.agent_name === "string" &&
    (record.relay_mode === "hosted_relay" || record.relay_mode === "self_hosted_relay") &&
    typeof record.relay_url === "string" &&
    Array.isArray(record.requested_scopes) &&
    typeof record.created_at === "string" &&
    typeof record.encryption_public_key_pem === "string" &&
    typeof record.encryption_public_key_x25519 === "string" &&
    typeof record.signing_public_key_pem === "string" &&
    typeof record.upload_auth_secret === "string" &&
    typeof record.relay_access_token === "string" &&
    (record.relay_api_token === undefined || typeof record.relay_api_token === "string") &&
    (record.source_device_unlinked_at === undefined || typeof record.source_device_unlinked_at === "string") &&
    typeof record.encryption_private_key_path === "string" &&
    typeof record.signing_private_key_path === "string";
}

function x25519PublicKeyPemToRawBase64Url(publicKeyPem: string): string {
  const der = createPublicKey(publicKeyPem).export({ type: "spki", format: "der" });
  return Buffer.from(der).subarray(-32).toString("base64url");
}

function migrateRelayRuntimeConfig(value: unknown): unknown {
  if (typeof value !== "object" || value === null) {
    return value;
  }
  const record = value as Partial<RelayRuntimeConfig>;
  if (record.protocol !== HEALTHLINK_E2EE_PROTOCOL || typeof record.encryption_public_key_pem !== "string") {
    return value;
  }
  let changed = false;
  const next: Partial<RelayRuntimeConfig> = { ...record };
  if (typeof next.encryption_public_key_x25519 !== "string") {
    next.encryption_public_key_x25519 = x25519PublicKeyPemToRawBase64Url(record.encryption_public_key_pem);
    changed = true;
  }
  if (typeof next.upload_auth_secret !== "string") {
    next.upload_auth_secret = randomBytes(32).toString("base64url");
    changed = true;
  }
  if (typeof next.relay_access_token !== "string" || next.relay_access_token.trim() === "") {
    next.relay_access_token = randomBytes(32).toString("base64url");
    changed = true;
  }
  if (typeof next.relay_api_token === "string" && next.relay_api_token.trim() === "") {
    delete next.relay_api_token;
    changed = true;
  }
  if (next.relay_mode !== "hosted_relay" && next.relay_mode !== "self_hosted_relay") {
    next.relay_mode = record.relay_url?.includes("127.0.0.1") || record.relay_url?.includes("localhost")
      ? "self_hosted_relay"
      : "hosted_relay";
    changed = true;
  }
  return changed ? next : value;
}

function normalizeOptionalToken(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function removeReplacedPrivateKeys(
  stateDir: string,
  previousPaths: string[],
  nextConfig: RelayRuntimeConfig
): void {
  const secretsRoot = `${resolve(stateDir, "secrets")}${sep}`;
  const currentPaths = new Set([
    resolve(nextConfig.encryption_private_key_path),
    resolve(nextConfig.signing_private_key_path)
  ]);
  for (const path of previousPaths) {
    const resolvedPath = resolve(resolveHomePath(path));
    if (resolvedPath.startsWith(secretsRoot) && !currentPaths.has(resolvedPath)) {
      rmSync(resolvedPath, { force: true });
    }
  }
}

function validatePrivateKeyPair(
  privateKeyPath: string,
  expectedPublicKeyPem: string,
  label: string,
  issues: string[]
): void {
  const resolvedPath = resolveHomePath(privateKeyPath);
  if (!existsSync(resolvedPath)) {
    issues.push(`${label} private key file is missing`);
    return;
  }
  try {
    const privateKey = createPrivateKey(readFileSync(resolvedPath, "utf8"));
    const actualPublicKeyPem = createPublicKey(privateKey).export({ type: "spki", format: "pem" }).toString();
    const expectedPublicKey = createPublicKey(expectedPublicKeyPem).export({ type: "spki", format: "der" });
    const actualPublicKey = createPublicKey(actualPublicKeyPem).export({ type: "spki", format: "der" });
    if (!Buffer.from(expectedPublicKey).equals(Buffer.from(actualPublicKey))) {
      issues.push(`${label} private key does not match the configured public key`);
    }
  } catch {
    issues.push(`${label} private key is invalid`);
  }
}

function isBase64UrlBytes(value: string, expectedBytes: number): boolean {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    return false;
  }
  try {
    return Buffer.from(value, "base64url").length === expectedBytes;
  } catch {
    return false;
  }
}
