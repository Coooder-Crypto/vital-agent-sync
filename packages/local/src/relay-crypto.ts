import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  randomUUID,
  timingSafeEqual,
  verify
} from "node:crypto";
import { HEALTHLINK_E2EE_PROTOCOL, readPrivateKey, type RelayRuntimeConfig } from "./relay-runtime.js";
import type { HealthSyncPayload } from "./schemas.js";

export const DEFAULT_MAX_ENVELOPE_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const DEFAULT_MAX_FUTURE_SKEW_MS = 10 * 60 * 1000;

export type HealthLinkEncryptedEnvelope = {
  protocol: typeof HEALTHLINK_E2EE_PROTOCOL;
  user_id: string;
  device_id: string;
  envelope_id: string;
  sequence: number;
  payload_type: "health.sync";
  created_at: string;
  content_encoding: "canonical-json";
  crypto: {
    alg: "x25519-hkdf-sha256-chacha20poly1305-hmac-sha256" | "x25519-chacha20poly1305-hmac-sha256" | "x25519-chacha20poly1305-ed25519";
    sender_public_key?: string;
    sender_public_key_x25519?: string;
    nonce: string;
    tag: string;
    ciphertext: string;
    signature: string;
  };
};

export type EnvelopeValidationOptions = {
  now?: Date | string;
  maxAgeMs?: number;
  maxFutureSkewMs?: number;
  minSequenceExclusive?: number;
  seenEnvelopeIds?: Iterable<string>;
  expectedDeviceId?: string;
};

export function encryptHealthSyncPayload(input: {
  config: RelayRuntimeConfig;
  payload: HealthSyncPayload;
  sequence?: number;
  createdAt?: string;
}): HealthLinkEncryptedEnvelope {
  const ephemeral = generateKeyPairSync("x25519");
  const recipientPublicKey = createPublicKey(input.config.encryption_public_key_pem);
  const shared = diffieHellman({
    privateKey: ephemeral.privateKey,
    publicKey: recipientPublicKey
  });
  const algorithm = "x25519-hkdf-sha256-chacha20poly1305-hmac-sha256" as const;
  const key = deriveSymmetricKey(shared, algorithm);
  const nonce = randomBytes(12);
  const plaintext = Buffer.from(canonicalJson(input.payload), "utf8");
  const cipher = createCipheriv("chacha20-poly1305", key, nonce, {
    authTagLength: 16
  });
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  const unsignedEnvelope: HealthLinkEncryptedEnvelope = {
    protocol: HEALTHLINK_E2EE_PROTOCOL,
    user_id: input.config.user_id,
    device_id: input.payload.device_id,
    envelope_id: `env_${randomUUID().replaceAll("-", "")}`,
    sequence: input.sequence ?? Date.now(),
    payload_type: "health.sync",
    created_at: input.createdAt ?? new Date().toISOString(),
    content_encoding: "canonical-json",
    crypto: {
      alg: algorithm,
      sender_public_key: ephemeral.publicKey.export({ type: "spki", format: "pem" }).toString(),
      sender_public_key_x25519: x25519PublicKeyPemToRawBase64Url(ephemeral.publicKey.export({ type: "spki", format: "pem" }).toString()),
      nonce: nonce.toString("base64url"),
      tag: tag.toString("base64url"),
      ciphertext: ciphertext.toString("base64url"),
      signature: ""
    }
  };
  const signature = signEnvelopeWithUploadSecret(input.config, unsignedEnvelope);
  return {
    ...unsignedEnvelope,
    crypto: {
      ...unsignedEnvelope.crypto,
      signature
    }
  };
}

export function decryptHealthSyncEnvelope(input: {
  config: RelayRuntimeConfig;
  envelope: HealthLinkEncryptedEnvelope;
  validation?: EnvelopeValidationOptions;
}): unknown {
  verifyEnvelope(input.config, input.envelope, input.validation);
  const privateKey = createPrivateKey(readPrivateKey(input.config.encryption_private_key_path));
  const senderPublicKey = getSenderPublicKey(input.envelope);
  const shared = diffieHellman({
    privateKey,
    publicKey: senderPublicKey
  });
  const key = deriveSymmetricKey(shared, input.envelope.crypto.alg);
  const decipher = createDecipheriv(
    "chacha20-poly1305",
    key,
    Buffer.from(input.envelope.crypto.nonce, "base64url"),
    { authTagLength: 16 }
  );
  decipher.setAuthTag(Buffer.from(input.envelope.crypto.tag, "base64url"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(input.envelope.crypto.ciphertext, "base64url")),
    decipher.final()
  ]);
  return JSON.parse(plaintext.toString("utf8")) as unknown;
}

export function verifyEnvelope(
  config: RelayRuntimeConfig,
  envelope: HealthLinkEncryptedEnvelope,
  options: EnvelopeValidationOptions = {}
): void {
  if (envelope.protocol !== HEALTHLINK_E2EE_PROTOCOL) {
    throw new Error(`Unsupported HealthLink envelope protocol: ${envelope.protocol}`);
  }
  if (envelope.user_id !== config.user_id) {
    throw new Error("HealthLink envelope user_id does not match local relay runtime.");
  }
  if (envelope.crypto.alg !== "x25519-hkdf-sha256-chacha20poly1305-hmac-sha256" &&
      envelope.crypto.alg !== "x25519-chacha20poly1305-hmac-sha256" &&
      envelope.crypto.alg !== "x25519-chacha20poly1305-ed25519") {
    throw new Error(`Unsupported HealthLink envelope algorithm: ${envelope.crypto.alg}`);
  }
  validateEnvelopeMetadata(config, envelope, options);
  const signature = Buffer.from(envelope.crypto.signature, "base64url");
  const unsignedEnvelope: HealthLinkEncryptedEnvelope = {
    ...envelope,
    crypto: {
      ...envelope.crypto,
      signature: ""
    }
  };
  const ok = envelope.crypto.alg === "x25519-hkdf-sha256-chacha20poly1305-hmac-sha256" ||
      envelope.crypto.alg === "x25519-chacha20poly1305-hmac-sha256"
    ? timingSafeEqualBase64Url(signEnvelopeWithUploadSecret(config, unsignedEnvelope), envelope.crypto.signature)
    : verifyLegacyLocalSignature(config, unsignedEnvelope, signature);
  if (!ok) {
    throw new Error("HealthLink envelope signature verification failed.");
  }
}

function validateEnvelopeMetadata(
  config: RelayRuntimeConfig,
  envelope: HealthLinkEncryptedEnvelope,
  options: EnvelopeValidationOptions
): void {
  if (options.expectedDeviceId && envelope.device_id !== options.expectedDeviceId) {
    throw new Error("HealthLink envelope device_id does not match the configured relay source.");
  }
  if (envelope.sequence <= (options.minSequenceExclusive ?? 0)) {
    throw new Error("HealthLink envelope sequence is not newer than the local relay cursor.");
  }
  if (options.seenEnvelopeIds && iterableIncludes(options.seenEnvelopeIds, envelope.envelope_id)) {
    throw new Error("HealthLink envelope was already processed.");
  }
  const createdAt = Date.parse(envelope.created_at);
  if (!Number.isFinite(createdAt)) {
    throw new Error("HealthLink envelope created_at is invalid.");
  }
  const now = options.now ? new Date(options.now).getTime() : Date.now();
  if (!Number.isFinite(now)) {
    throw new Error("HealthLink envelope validation time is invalid.");
  }
  const maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_ENVELOPE_AGE_MS;
  const maxFutureSkewMs = options.maxFutureSkewMs ?? DEFAULT_MAX_FUTURE_SKEW_MS;
  if (createdAt < now - maxAgeMs) {
    throw new Error("HealthLink envelope is older than the allowed relay freshness window.");
  }
  if (createdAt > now + maxFutureSkewMs) {
    throw new Error("HealthLink envelope was created too far in the future.");
  }
  if (envelope.device_id !== config.source_device_id) {
    throw new Error("HealthLink envelope device_id does not match local relay runtime.");
  }
}

function iterableIncludes(values: Iterable<string>, target: string): boolean {
  for (const value of values) {
    if (value === target) {
      return true;
    }
  }
  return false;
}

export function isEncryptedEnvelope(value: unknown): value is HealthLinkEncryptedEnvelope {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  const crypto = record.crypto as Record<string, unknown> | undefined;
  const algorithm = crypto?.alg;
  const hasValidSenderKey = algorithm === "x25519-hkdf-sha256-chacha20poly1305-hmac-sha256"
    ? isBase64UrlBytes(crypto?.sender_public_key_x25519, 32)
    : isBase64UrlBytes(crypto?.sender_public_key_x25519, 32) || isBoundedPemPublicKey(crypto?.sender_public_key);
  const expectedSignatureBytes = algorithm === "x25519-chacha20poly1305-ed25519" ? 64 : 32;
  return record.protocol === HEALTHLINK_E2EE_PROTOCOL &&
    isBoundedIdentifier(record.user_id) &&
    isBoundedIdentifier(record.device_id) &&
    isBoundedIdentifier(record.envelope_id) &&
    Number.isSafeInteger(record.sequence) &&
    (record.sequence as number) > 0 &&
    record.payload_type === "health.sync" &&
    isValidEnvelopeTimestamp(record.created_at) &&
    record.content_encoding === "canonical-json" &&
    typeof crypto === "object" &&
    crypto !== null &&
    (algorithm === "x25519-hkdf-sha256-chacha20poly1305-hmac-sha256" ||
      algorithm === "x25519-chacha20poly1305-hmac-sha256" ||
      algorithm === "x25519-chacha20poly1305-ed25519") &&
    hasValidSenderKey &&
    isBase64UrlBytes(crypto.nonce, 12) &&
    isBase64UrlBytes(crypto.tag, 16) &&
    isBase64UrlBytes(crypto.ciphertext, undefined, 1) &&
    isBase64UrlBytes(crypto.signature, expectedSignatureBytes);
}

function signEnvelopeWithUploadSecret(config: RelayRuntimeConfig, unsignedEnvelope: HealthLinkEncryptedEnvelope): string {
  return createHmac("sha256", Buffer.from(config.upload_auth_secret, "base64url"))
    .update(Buffer.from(canonicalJson(unsignedEnvelope), "utf8"))
    .digest("base64url");
}

function verifyLegacyLocalSignature(
  config: RelayRuntimeConfig,
  unsignedEnvelope: HealthLinkEncryptedEnvelope,
  signature: Buffer
): boolean {
  const signingPublicKey = createPublicKey(config.signing_public_key_pem);
  return verify(null, Buffer.from(canonicalJson(unsignedEnvelope), "utf8"), signingPublicKey, signature);
}

function timingSafeEqualBase64Url(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "base64url");
  const rightBuffer = Buffer.from(right, "base64url");
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function getSenderPublicKey(envelope: HealthLinkEncryptedEnvelope) {
  if (envelope.crypto.sender_public_key_x25519) {
    return createPublicKey({
      key: rawX25519PublicKeyToSpkiDer(Buffer.from(envelope.crypto.sender_public_key_x25519, "base64url")),
      type: "spki",
      format: "der"
    });
  }
  if (envelope.crypto.sender_public_key) {
    return createPublicKey(envelope.crypto.sender_public_key);
  }
  throw new Error("HealthLink envelope is missing sender public key.");
}

function isBoundedIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= 256 && /^[A-Za-z0-9._-]+$/.test(value);
}

function isValidEnvelopeTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= 64 && Number.isFinite(Date.parse(value));
}

function isBoundedPemPublicKey(value: unknown): value is string {
  return typeof value === "string" &&
    value.length >= 64 &&
    value.length <= 1024 &&
    value.startsWith("-----BEGIN PUBLIC KEY-----") &&
    value.includes("-----END PUBLIC KEY-----");
}

function isBase64UrlBytes(value: unknown, exactBytes?: number, minimumBytes = 0): value is string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) {
    return false;
  }
  try {
    const decoded = Buffer.from(value, "base64url");
    return decoded.length >= minimumBytes &&
      (exactBytes === undefined || decoded.length === exactBytes) &&
      decoded.toString("base64url") === value;
  } catch {
    return false;
  }
}

function x25519PublicKeyPemToRawBase64Url(publicKeyPem: string): string {
  const der = createPublicKey(publicKeyPem).export({ type: "spki", format: "der" });
  return Buffer.from(der).subarray(-32).toString("base64url");
}

function rawX25519PublicKeyToSpkiDer(raw: Buffer): Buffer {
  if (raw.length !== 32) {
    throw new Error("HealthLink X25519 sender public key must be 32 bytes.");
  }
  return Buffer.concat([
    Buffer.from("302a300506032b656e032100", "hex"),
    raw
  ]);
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortCanonical(value));
}

function deriveSymmetricKey(sharedSecret: Buffer, algorithm: HealthLinkEncryptedEnvelope["crypto"]["alg"]): Buffer {
  if (algorithm === "x25519-hkdf-sha256-chacha20poly1305-hmac-sha256") {
    return Buffer.from(hkdfSync(
      "sha256",
      sharedSecret,
      Buffer.alloc(0),
      Buffer.from("healthlink-e2ee-v1 envelope", "utf8"),
      32
    ));
  }
  return createHash("sha256")
    .update("healthlink-e2ee-v1 envelope")
    .update(sharedSecret)
    .digest();
}

function sortCanonical(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortCanonical);
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.keys(record)
      .sort()
      .reduce<Record<string, unknown>>((next, key) => {
        next[key] = sortCanonical(record[key]);
        return next;
      }, {});
  }
  return value;
}
