import {
  createCipheriv,
  createDecipheriv,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  randomUUID
} from "node:crypto";
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import type { KeyObject } from "node:crypto";
import type { HealthLinkDatabase } from "./database.js";
import { canonicalJson } from "./relay-crypto.js";

export const DIRECT_TRANSPORT_PROTOCOL = "vitalmcp-direct-v1" as const;
export const DIRECT_TRANSPORT_ALGORITHM = "x25519-hkdf-sha256-chacha20poly1305" as const;
export const DIRECT_TRANSPORT_MAX_AGE_MS = 5 * 60 * 1000;
export const DIRECT_TRANSPORT_MAX_FUTURE_SKEW_MS = 60 * 1000;

export type DirectTransportPurpose =
  | "pair.status"
  | "pair.confirm"
  | "health.sync"
  | "device.revoke";

export type DirectEncryptedEnvelope = {
  protocol: typeof DIRECT_TRANSPORT_PROTOCOL;
  request_id: string;
  created_at: string;
  purpose: DirectTransportPurpose;
  crypto: {
    alg: typeof DIRECT_TRANSPORT_ALGORITHM;
    sender_public_key_x25519: string;
    nonce: string;
    tag: string;
    ciphertext: string;
  };
};

export type DirectTransportKey = {
  privateKey: KeyObject;
  publicKey: KeyObject;
  publicKeyRaw: string;
  privateKeyPath: string;
};

export type DirectResponseContext = {
  requestId: string;
  purpose: DirectTransportPurpose;
  responseKey: Buffer;
  receiverPublicKeyRaw: string;
};

export class DirectTransportError extends Error {
  constructor(
    readonly code: "invalid_envelope" | "stale_envelope" | "replayed_envelope" | "decrypt_failed",
    message: string
  ) {
    super(message);
  }
}

export function loadOrCreateDirectTransportKey(databasePath: string): DirectTransportKey {
  const privateKeyPath = `${databasePath}.direct-x25519.pem`;
  let privateKey: KeyObject;
  try {
    privateKey = createPrivateKey(readFileSync(privateKeyPath, "utf8"));
  } catch (error) {
    if (!isMissingFileError(error)) {
      throw error;
    }
    const generated = generateKeyPairSync("x25519");
    const pem = generated.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    try {
      writeFileSync(privateKeyPath, pem, { encoding: "utf8", flag: "wx", mode: 0o600 });
      privateKey = generated.privateKey;
    } catch (writeError) {
      if (!isExistingFileError(writeError)) {
        throw writeError;
      }
      privateKey = createPrivateKey(readFileSync(privateKeyPath, "utf8"));
    }
  }
  chmodIfPossible(privateKeyPath, 0o600);
  const publicKey = createPublicKey(privateKey);
  return {
    privateKey,
    publicKey,
    publicKeyRaw: publicKeyToRawBase64Url(publicKey),
    privateKeyPath
  };
}

export function decryptDirectRequest(input: {
  key: DirectTransportKey;
  envelope: unknown;
  now?: Date | string;
}): { plaintext: unknown; response: DirectResponseContext; envelope: DirectEncryptedEnvelope } {
  if (!isDirectEncryptedEnvelope(input.envelope)) {
    throw new DirectTransportError("invalid_envelope", "Direct transport envelope is invalid.");
  }
  validateFreshness(input.envelope, input.now);
  try {
    const senderPublicKey = createPublicKey({
      key: rawX25519PublicKeyToSpkiDer(Buffer.from(input.envelope.crypto.sender_public_key_x25519, "base64url")),
      type: "spki",
      format: "der"
    });
    const sharedSecret = diffieHellman({ privateKey: input.key.privateKey, publicKey: senderPublicKey });
    const requestKey = deriveKey(sharedSecret, "request");
    const decipher = createDecipheriv(
      "chacha20-poly1305",
      requestKey,
      Buffer.from(input.envelope.crypto.nonce, "base64url"),
      { authTagLength: 16 }
    );
    const ciphertext = Buffer.from(input.envelope.crypto.ciphertext, "base64url");
    decipher.setAAD(envelopeAAD(input.envelope), { plaintextLength: ciphertext.length });
    decipher.setAuthTag(Buffer.from(input.envelope.crypto.tag, "base64url"));
    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final()
    ]);
    return {
      plaintext: JSON.parse(plaintext.toString("utf8")) as unknown,
      envelope: input.envelope,
      response: {
        requestId: input.envelope.request_id,
        purpose: input.envelope.purpose,
        responseKey: deriveKey(sharedSecret, "response"),
        receiverPublicKeyRaw: input.key.publicKeyRaw
      }
    };
  } catch (error) {
    if (error instanceof DirectTransportError) {
      throw error;
    }
    throw new DirectTransportError("decrypt_failed", "Direct transport envelope could not be decrypted.");
  }
}

export function encryptDirectResponse(
  context: DirectResponseContext,
  payload: unknown,
  options: { now?: Date | string; nonce?: Buffer } = {}
): DirectEncryptedEnvelope {
  const createdAt = options.now ? new Date(options.now).toISOString() : new Date().toISOString();
  const nonce = options.nonce ?? randomBytes(12);
  const envelope: DirectEncryptedEnvelope = {
    protocol: DIRECT_TRANSPORT_PROTOCOL,
    request_id: context.requestId,
    created_at: createdAt,
    purpose: context.purpose,
    crypto: {
      alg: DIRECT_TRANSPORT_ALGORITHM,
      sender_public_key_x25519: context.receiverPublicKeyRaw,
      nonce: nonce.toString("base64url"),
      tag: "",
      ciphertext: ""
    }
  };
  const plaintext = Buffer.from(canonicalJson(payload), "utf8");
  const cipher = createCipheriv("chacha20-poly1305", context.responseKey, nonce, { authTagLength: 16 });
  cipher.setAAD(envelopeAAD(envelope), { plaintextLength: plaintext.length });
  const ciphertext = Buffer.concat([
    cipher.update(plaintext),
    cipher.final()
  ]);
  envelope.crypto.ciphertext = ciphertext.toString("base64url");
  envelope.crypto.tag = cipher.getAuthTag().toString("base64url");
  return envelope;
}

export function claimDirectRequest(
  database: HealthLinkDatabase,
  requestId: string,
  createdAt: string,
  now = new Date()
): void {
  database.sqlite.prepare(`
    delete from direct_transport_requests
    where received_at < ?
  `).run(new Date(now.getTime() - DIRECT_TRANSPORT_MAX_AGE_MS * 2).toISOString());
  try {
    database.sqlite.prepare(`
      insert into direct_transport_requests (request_id, created_at, received_at)
      values (?, ?, ?)
    `).run(requestId, createdAt, now.toISOString());
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new DirectTransportError("replayed_envelope", "Direct transport envelope was already processed.");
    }
    throw error;
  }
}

export function createDirectRequestForTest(input: {
  receiverPublicKeyRaw: string;
  payload: unknown;
  purpose: DirectTransportPurpose;
  senderPrivateKey?: KeyObject;
  requestId?: string;
  createdAt?: string;
  nonce?: Buffer;
}): { envelope: DirectEncryptedEnvelope; responseKey: Buffer } {
  const senderPrivateKey = input.senderPrivateKey ?? generateKeyPairSync("x25519").privateKey;
  const senderPublicKey = createPublicKey(senderPrivateKey);
  const receiverPublicKey = createPublicKey({
    key: rawX25519PublicKeyToSpkiDer(Buffer.from(input.receiverPublicKeyRaw, "base64url")),
    type: "spki",
    format: "der"
  });
  const sharedSecret = diffieHellman({ privateKey: senderPrivateKey, publicKey: receiverPublicKey });
  const nonce = input.nonce ?? randomBytes(12);
  const envelope: DirectEncryptedEnvelope = {
    protocol: DIRECT_TRANSPORT_PROTOCOL,
    request_id: input.requestId ?? `req_${randomUUID().replaceAll("-", "")}`,
    created_at: input.createdAt ?? new Date().toISOString(),
    purpose: input.purpose,
    crypto: {
      alg: DIRECT_TRANSPORT_ALGORITHM,
      sender_public_key_x25519: publicKeyToRawBase64Url(senderPublicKey),
      nonce: nonce.toString("base64url"),
      tag: "",
      ciphertext: ""
    }
  };
  const plaintext = Buffer.from(canonicalJson(input.payload), "utf8");
  const cipher = createCipheriv("chacha20-poly1305", deriveKey(sharedSecret, "request"), nonce, { authTagLength: 16 });
  cipher.setAAD(envelopeAAD(envelope), { plaintextLength: plaintext.length });
  const ciphertext = Buffer.concat([
    cipher.update(plaintext),
    cipher.final()
  ]);
  envelope.crypto.ciphertext = ciphertext.toString("base64url");
  envelope.crypto.tag = cipher.getAuthTag().toString("base64url");
  return { envelope, responseKey: deriveKey(sharedSecret, "response") };
}

export function decryptDirectResponseForTest(input: {
  envelope: DirectEncryptedEnvelope;
  responseKey: Buffer;
}): unknown {
  const decipher = createDecipheriv(
    "chacha20-poly1305",
    input.responseKey,
    Buffer.from(input.envelope.crypto.nonce, "base64url"),
    { authTagLength: 16 }
  );
  const ciphertext = Buffer.from(input.envelope.crypto.ciphertext, "base64url");
  decipher.setAAD(envelopeAAD(input.envelope), { plaintextLength: ciphertext.length });
  decipher.setAuthTag(Buffer.from(input.envelope.crypto.tag, "base64url"));
  return JSON.parse(Buffer.concat([
    decipher.update(ciphertext),
    decipher.final()
  ]).toString("utf8")) as unknown;
}

export function isDirectEncryptedEnvelope(value: unknown): value is DirectEncryptedEnvelope {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  const crypto = record.crypto as Record<string, unknown> | undefined;
  return record.protocol === DIRECT_TRANSPORT_PROTOCOL &&
    isIdentifier(record.request_id) &&
    typeof record.created_at === "string" && record.created_at.length <= 64 && Number.isFinite(Date.parse(record.created_at)) &&
    isPurpose(record.purpose) &&
    typeof crypto === "object" && crypto !== null &&
    crypto.alg === DIRECT_TRANSPORT_ALGORITHM &&
    isBase64UrlBytes(crypto.sender_public_key_x25519, 32) &&
    isBase64UrlBytes(crypto.nonce, 12) &&
    isBase64UrlBytes(crypto.tag, 16) &&
    isBase64UrlBytes(crypto.ciphertext, undefined, 1, 1_000_000);
}

function validateFreshness(envelope: DirectEncryptedEnvelope, nowValue?: Date | string): void {
  const createdAt = Date.parse(envelope.created_at);
  const now = nowValue ? new Date(nowValue).getTime() : Date.now();
  if (!Number.isFinite(now) || createdAt < now - DIRECT_TRANSPORT_MAX_AGE_MS || createdAt > now + DIRECT_TRANSPORT_MAX_FUTURE_SKEW_MS) {
    throw new DirectTransportError("stale_envelope", "Direct transport envelope is outside the freshness window.");
  }
}

function envelopeAAD(envelope: DirectEncryptedEnvelope): Buffer {
  return Buffer.from(canonicalJson({
    protocol: envelope.protocol,
    request_id: envelope.request_id,
    created_at: envelope.created_at,
    purpose: envelope.purpose,
    alg: envelope.crypto.alg,
    sender_public_key_x25519: envelope.crypto.sender_public_key_x25519
  }), "utf8");
}

function deriveKey(sharedSecret: Buffer, direction: "request" | "response"): Buffer {
  return Buffer.from(hkdfSync(
    "sha256",
    sharedSecret,
    Buffer.alloc(0),
    Buffer.from(`${DIRECT_TRANSPORT_PROTOCOL} ${direction}`, "utf8"),
    32
  ));
}

function publicKeyToRawBase64Url(publicKey: KeyObject): string {
  const der = publicKey.export({ type: "spki", format: "der" });
  return Buffer.from(der).subarray(-32).toString("base64url");
}

function rawX25519PublicKeyToSpkiDer(raw: Buffer): Buffer {
  if (raw.length !== 32) throw new DirectTransportError("invalid_envelope", "X25519 public key must be 32 bytes.");
  return Buffer.concat([Buffer.from("302a300506032b656e032100", "hex"), raw]);
}

function isIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= 128 && /^[A-Za-z0-9._-]+$/.test(value);
}

function isPurpose(value: unknown): value is DirectTransportPurpose {
  return value === "pair.status" || value === "pair.confirm" || value === "health.sync" || value === "device.revoke";
}

function isBase64UrlBytes(value: unknown, exactBytes?: number, minBytes = 0, maxBytes = Number.MAX_SAFE_INTEGER): value is string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) return false;
  const decoded = Buffer.from(value, "base64url");
  return decoded.length >= minBytes && decoded.length <= maxBytes &&
    (exactBytes === undefined || decoded.length === exactBytes) && decoded.toString("base64url") === value;
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function isExistingFileError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST";
}

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "SQLITE_CONSTRAINT_PRIMARYKEY";
}

function chmodIfPossible(path: string, mode: number): void {
  try {
    chmodSync(path, mode);
  } catch {
    // Windows and some filesystems do not expose POSIX permissions.
  }
}
